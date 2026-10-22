/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Message handlers for the testing tools: masking, rules, page tools, replay, storage editor, ISTQB, workspaces, black-box, white-box, trackers and chat. Moved out of service-worker.js (OF-18), unchanged. */

import { putReplayChunk as putReplayChunkRaw, replaySize, getReplay, getSession, deleteReplay } from '../core/db.js';
import * as armed from './armed.js';
import * as sessionState from './session-state.js';
import { contextMenuState } from './context-menus.js';
import { LOW_DISK } from './write-queue.js';
import { policy, getSettings } from '../platform/settings.js';
import {
  listCookies, setCookie, removeCookie, clearCookies, importCookies, exportCookies, listCookieProfiles,
  saveCookieProfile, restoreCookieProfile, deleteCookieProfile, listWebStorage, setWebStorage, removeWebStorage,
  clearWebStorage,
} from './storage-editor.js';
import {
  cookieFormatsOp, suiteRelations, partitions, boundaries, decisionTable, stateTransitions, trackerOp, scanOutbound,
} from './media.js';
import {
  SEVERITY, PRIORITY, TEST_LEVELS, TEST_TYPES, PRINCIPLES, ACTIVITIES, TOOL_ACTIVITY, coverage, buildDefectReport,
} from '../core/istqb.js';
import { detect as detectCapabilities } from '../core/capabilities.js';
import { ruleOutcomes } from '../core/events.js';
import * as whitebox from './whitebox.js';
import * as jira from './jira-door.js';
import { TRACKER_SPECS, isConfiguredSpec, trackerUrl, specById } from '../core/tracker-specs.js';
import { defectToMarkdown } from './istqb-render-door.js';
import * as chat from './notify.js';
import { summarisePostman } from './postman-door.js';
import { activeSessionId, coded, hintFor } from './worker-base.js';
import { isExtensionPage, maskKey, openOwnPage, sendToFeature, sendToTab, tabUrl, testableTabId } from './worker-tabs.js';
import { scrubReplay } from './worker-scrub.js';
import {
  QUICK_ATTACH, addNote, addRule, appendEvent, belongsToSession, dropRule, fileInJira, getEvents, getRules, jiraConfig,
  jiraReady, loadSession, mustSession, noteRuleFired, noteUse, paintBadge, quickFileInJira, rememberFiled, setRules,
} from './worker-session.js';
import {
  GUIDED_CHECKS, a11yRules, autofillPage, checkFinePrint, checkLinks, harvestPage, reporterContext, reporterFile,
  reverseSpec, scanAccessibility, scanPerformance, shootBeforeReporter,
} from './worker-scans.js';
import {
  draftForJira, fileSuiteInJira, findJiraDuplicates, istqbDefect, istqbSuite, istqbTestCase, notifyAll, quickFilePlan,
  suiteRelate, syncJiraStatus,
} from './worker-filing.js';
import { coverageStopping, purgeExpired } from './worker-lifecycle.js';

/** Every write to the replay store passes through the scrub, whichever handler makes it (r3-03-1). */
const putReplayChunk = async (chunk) => {
  if (await replayRefused(chunk.sessionId)) throw Object.assign(new Error('Replay size limit reached'), { code: 'REPLAY_CAP' }); // D-206
  const out = await putReplayChunkRaw({ ...chunk, entries: await scrubReplay(chunk.entries) });
  replayBytes.set(chunk.sessionId, (replayBytes.get(chunk.sessionId) || 0) + (out?.stored || 0));
  return out;
};

/** Masking, retention purges and value injection. */
export const maskingHandlers = {
  /* ---- masking ---------------------------------------------------------
     A tester on a staging system is looking at real people's records. What
     they mask has to stay masked across every navigation for the rest of the
     run, so the list lives with the session and every page asks for it on
     load. */
  UQA_MASK_PICK: async (msg) => {
    const tabId = msg.tabId ?? (await testableTabId());
    const res = await sendToTab(tabId, { type: 'UQA_MASK_PICK' });
    return res || { picking: false, count: 0 };
  },

  UQA_MASK_SET: async (msg, sender) => {
    const sessionId = await activeSessionId(sender);
    if (!sessionId) return { saved: 0 };
    const masks = Array.isArray(msg.masks) ? msg.masks : [];
    await chrome.storage.session.set({ [maskKey(sessionId)]: masks });
    // Every other tab in the session gets the same list, so masking a column
    // in one tab covers the same column in the one beside it.
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id === sender?.tab?.id) continue;
      if (!(await armed.isArmedTab(t.id))) continue;
      await sendToTab(t.id, { type: 'UQA_MASK_APPLY', masks });
    }
    return { saved: masks.length };
  },

  UQA_MASK_GET: async (msg, sender) => {
    const sessionId = await activeSessionId(hintFor(msg, sender));
    if (!sessionId) return { masks: [] };
    const store = await chrome.storage.session.get(maskKey(sessionId));
    return { masks: store[maskKey(sessionId)] || [] };
  },

  UQA_PURGE_NOW: () => purgeExpired(),

  UQA_MASK_CLEAR: async (msg, sender) => {
    const sessionId = await activeSessionId(hintFor(msg, sender));
    if (sessionId) await chrome.storage.session.remove(maskKey(sessionId));
    // The same boundary `UQA_MASK_SET` keeps. Masks were only ever applied in
    // armed windows, so clearing them anywhere else is a message to a page that
    // is not part of the run.
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!(await armed.isArmedTab(t.id))) continue;
      await sendToTab(t.id, { type: 'UQA_MASK_CLEAR' });
    }
    return { masks: 0 };
  },
  /**
   * Uncover everything on one tab, and leave the session holding it.
   */
  UQA_CLEAR_MASKS: async (msg, sender) => {
    const tabId = msg.tabId ?? sender?.tab?.id ?? (await testableTabId(sender));
    if (tabId == null) throw new Error('Open the page you want to uncover first.');
    const res = await sendToTab(tabId, { type: 'UQA_CLEAR_MASKS' });
    // `null` is a tab with no content script — a `chrome://` page, or one that
    // has not finished loading. Saying so beats reporting an uncover that did
    // not happen.
    if (!res) throw new Error('That tab has nothing of ours in it to uncover. Open a normal web page.');
    return res;
  },

  UQA_INJECT: async (msg, sender) =>
    sendToFeature(msg.tabId ?? sender?.tab?.id ?? (await testableTabId()), 'injector', { type: 'UQA_INJECT' }),
};

/** Request rules, and the session state they are held in. */
export const ruleHandlers = {
  /** The rule list, and who is allowed to see it. */
  UQA_GET_RULES: async (msg, sender) => {
    const tabId = isExtensionPage(sender) ? null : sender?.tab?.id; // content scripts only: the float panel is a tab in a window never woken (H1)
    if (tabId != null && !(await armed.isArmedTab(tabId))) return [];
    // The hint is the sender: a content script asking for its rules is asking
    // about the session running in ITS window, and with two sessions live the
    // wrong answer arms a page against a run it is not part of.
    return getRules(hintFor(msg, sender));
  },
  UQA_SET_RULES: (msg, sender) => setRules(msg.rules, hintFor(msg, sender)),
  UQA_ADD_RULE: (msg, sender) => addRule(msg.rule, hintFor(msg, sender)),
  UQA_DROP_RULE: (msg, sender) => dropRule(msg.id, hintFor(msg, sender)),
  UQA_RULE_FIRED: (msg, sender) => noteRuleFired(msg, sender),
  UQA_SESSION_STATE: async (msg, sender) => sessionState.getState(await activeSessionId(hintFor(msg, sender))),
  UQA_USED: async (msg, sender) => sessionState.getUsed(await activeSessionId(hintFor(msg, sender))),

};

/** The tools that read the page under test. */
export const pageToolHandlers = {
  UQA_SCAN_A11Y: (msg) => scanAccessibility(msg),
  UQA_A11Y_RULES: (msg) => a11yRules(msg),
  UQA_A11Y_GUIDED: () => GUIDED_CHECKS,
  UQA_A11Y_GUIDED_RESULT: async (msg) => {
    const check = GUIDED_CHECKS.find((c) => c.id === msg.id);
    if (!check) throw new Error(`Unknown check: ${msg.id}`);
    // Filed as a tagged note, so a guided answer lands in the same report, the
    // same session sheet and the same ticket as everything else.
    return addNote(
      `WCAG ${check.wcag}, ${check.title}: ${msg.verdict}${msg.comment ? `, ${msg.comment}` : ''}`,
      msg.verdict === 'fail' ? 'bug' : msg.verdict === 'unsure' ? 'question' : 'issue'
    );
  },
  /** Put the offending element on screen, outlined, so a finding can be seen. */
  UQA_HIGHLIGHT: async (msg) => {
    const id = msg.tabId ?? (await testableTabId());
    if (id == null) throw new Error('No tab to highlight in.');
    const res = await sendToFeature(id, 'picker', { type: 'UQA_HIGHLIGHT_SELECTOR', selector: msg.selector });
    if (!res?.found) throw new Error(`Nothing on the page matches "${msg.selector}" any more.`);
    return res;
  },
  UQA_SCAN_PERF: (msg) => scanPerformance(msg),
  UQA_HARVEST: (msg) => harvestPage(msg),
  UQA_READ_SPEC: (msg) => reverseSpec(msg),
  UQA_FINE_PRINT: (msg) => checkFinePrint(msg),
  UQA_REPORTER_CONTEXT: () => reporterContext(),
  UQA_REPORTER_FILE: (msg) => reporterFile(msg),
  UQA_OPEN_REPORTER: async () => {
    await shootBeforeReporter();
    await openOwnPage('reporter/reporter.html');
    return true;
  },
  UQA_CHECK_LINKS: (msg) => checkLinks(msg),
  UQA_AUTOFILL: (msg) => autofillPage(msg),
  UQA_MENU_STATE: async () => contextMenuState({ recording: !!(await activeSessionId()) }),

};

/** Session replay. */
const replayGapPages = new Set();

const replayBytes = new Map(); // D-206: sessionId -> stored replay bytes, seeded from the store after a wake

/** D-206: past 256 MiB of replay for this session, or browser storage is low. */
async function replayRefused(sessionId) {
  if (!replayBytes.has(sessionId)) replayBytes.set(sessionId, (await replaySize(sessionId).catch(() => null))?.stored || 0);
  if (replayBytes.get(sessionId) >= 256 * 1024 * 1024) return true;
  try { const e = await navigator.storage.estimate(); return e.quota - e.usage < LOW_DISK; } catch { return false; }
}

export const replayHandlers = {
  /*
   * session replay: `content/replay-recorder.js` writes the DOM and its changes to the `replay` store. The recorder asks
   * rather than being told: an empty chunk means "is a session running?", a chunk with entries is the answer plus the work.
   * With no session the chunk is DROPPED: a replay belongs to a session and nothing outside one would delete it.
   */
  UQA_REPLAY_CHUNK: async (msg, sender) => {
    const sessionId = await activeSessionId(sender);
    if (!sessionId) return { recording: false, sessionId: null };
    if ((await policy()).replayAllowed === false) return { recording: false, sessionId: null, stored: false, reason: 'policy' }; // T-068 last line: the recorder stops
    // ingest()'s two doors (T-010); recording:false makes that tab's recorder stop
    try {
      await armed.assertMayRecord(sender, { belongs: (tabId) => belongsToSession(sessionId, tabId) });
    } catch (err) {
      if (err?.reason) return { recording: false, sessionId: null, stored: false, reason: err.reason };
      throw err;
    }
    const entries = Array.isArray(msg.entries) ? msg.entries : [];
    if (!entries.length) return { recording: true, sessionId };
    let stored;
    try { stored = await putReplayChunk({ sessionId, entries }); } catch (err) {
      if (err?.code === 'REPLAY_CAP') { // D-206
        if (!replayGapPages.has(sessionId)) { replayGapPages.add(sessionId); await appendEvent({ sessionId, kind: 'note', tag: 'capture-gap', gap: 'replay-cap', ts: Date.now(), text: 'Capture gap: this recording reached its replay size limit, so later replay was not stored.' }).catch(() => {}); }
        return { recording: true, sessionId, stored: false, reason: 'replay-cap' };
      } // D-1010-104
      const page = `${sessionId}:${sender?.tab?.id}`;
      if (!replayGapPages.has(page)) { replayGapPages.add(page); await appendEvent({ sessionId, kind: 'note', tag: 'replay-gap', ts: Date.now(), text: 'Replay gap: a chunk could not be saved.' }).catch(() => {}); }
      return { recording: true, sessionId, stored: false };
    }
    return { recording: true, sessionId, ...stored };
  },

  /* The log, inflated, plus the marks the scrubber puts on the timeline. The
     failures come from the session's own events: the replay knows the DOM
     changed, not that a request came back 500. */
  UQA_REPLAY_GET: async (msg) => {
    const sessionId = msg.sessionId || (await activeSessionId());
    if (!sessionId) throw coded('No session to replay.', 'NO_SESSION');
    const [replay, session, events] = await Promise.all([
      getReplay(sessionId),
      getSession(sessionId),
      getEvents(sessionId).catch(() => []),
    ]);
    return {
      sessionId,
      startedAt: session?.startedAt || 0,
      title: session?.charter || session?.title || '',
      events: (events || []).map((e) => ({ ts: e.ts, fail: e.fail, kind: e.kind, method: e.method, url: e.url })),
      ...replay,
    };
  },

  /* How big it is, without inflating a byte — what the report prints beside
     "Watch the replay" so a tester knows before they open it. */
  UQA_REPLAY_INFO: async (msg) => replaySize(msg.sessionId || (await activeSessionId())),

  UQA_REPLAY_DELETE: async (msg) => {
    await deleteReplay(msg.sessionId);
    return { ok: true };
  },

  UQA_OPEN_REPLAY: async (msg) => {
    const sessionId = msg.sessionId || (await activeSessionId());
    if (!sessionId) throw coded('No session to replay.', 'NO_SESSION');
    return openOwnPage(`replay/replay.html?session=${encodeURIComponent(sessionId)}`);
  },

};

/** The cookie and web-storage editor, and cookie profiles. */
export const storageHandlers = {
  /* ---- cookie & storage editor (9) ------------------------------------
     Values are readable and writable here and nowhere else. Nothing in this
     group touches the database, so an artefact still carries names and flags
     only — see safeCookies(). */
  UQA_COOKIES: async (msg) => listCookies({ url: msg.url || (await tabUrl(msg.tabId)) }),
  UQA_COOKIE_SET: async (msg) =>
    setCookie({ url: msg.url || (await tabUrl(msg.tabId)), cookie: msg.cookie, previous: msg.previous }),
  UQA_COOKIE_DELETE: async (msg) =>
    removeCookie({ url: msg.url || (await tabUrl(msg.tabId)), name: msg.name, storeId: msg.storeId }),
  UQA_COOKIES_CLEAR: async (msg) => clearCookies({ url: msg.url || (await tabUrl(msg.tabId)) }),
  UQA_COOKIES_IMPORT: async (msg) =>
    importCookies({
      url: msg.url || (await tabUrl(msg.tabId)),
      text: msg.text ?? msg.json,
      format: msg.format,
    }),
  UQA_COOKIES_EXPORT: async (msg) =>
    exportCookies({ url: msg.url || (await tabUrl(msg.tabId)), format: msg.format }),
  UQA_COOKIE_FORMATS: () => cookieFormatsOp('FORMATS'),
  UQA_COOKIE_DETECT: (msg) => cookieFormatsOp('detectFormat', [msg.text]),

  /* ---- cookie profiles ------------------------------------------------
     The one place this extension keeps cookie *values* at rest, because a
     profile that vanished with the session could not do its job. Said out loud
     in the UI rather than buried. */
  UQA_COOKIE_PROFILES: () => listCookieProfiles(),
  UQA_COOKIE_PROFILE_SAVE: async (msg) =>
    saveCookieProfile({ url: msg.url || (await tabUrl(msg.tabId)), name: msg.name }),
  UQA_COOKIE_PROFILE_RESTORE: async (msg) =>
    restoreCookieProfile({
      url: msg.url || (await tabUrl(msg.tabId)),
      name: msg.name,
      clearFirst: msg.clearFirst,
    }),
  UQA_COOKIE_PROFILE_DELETE: (msg) => deleteCookieProfile({ name: msg.name }),
  UQA_WEBSTORAGE: async (msg) => listWebStorage({ tabId: msg.tabId ?? (await testableTabId()) }),
  UQA_WEBSTORAGE_SET: async (msg) =>
    setWebStorage({ tabId: msg.tabId ?? (await testableTabId()), area: msg.area, key: msg.key, value: msg.value }),
  UQA_WEBSTORAGE_DELETE: async (msg) =>
    removeWebStorage({ tabId: msg.tabId ?? (await testableTabId()), area: msg.area, key: msg.key }),
  UQA_WEBSTORAGE_CLEAR: async (msg) =>
    clearWebStorage({ tabId: msg.tabId ?? (await testableTabId()), area: msg.area }),
};

/** Filing a session out, the ISTQB artefacts, and what this browser can do. */
export const istqbHandlers = {

  /* ---- ISTQB artefacts ------------------------------------------------ */
  UQA_TEST_CASE: (msg) => istqbTestCase(msg),
  UQA_DEFECT: (msg) => istqbDefect(msg),
  UQA_ISTQB_VOCAB: async () => ({
    severity: SEVERITY, priority: PRIORITY, levels: TEST_LEVELS, types: TEST_TYPES,
    relations: await suiteRelations(),
  }),
  UQA_TEST_SUITE: (msg) => istqbSuite(msg),
  UQA_SUITE_RELATE: (msg) => suiteRelate(msg),
  UQA_SUITE_FILE: (msg) => fileSuiteInJira(msg),

  /**
   * The syllabus model the popup is built from.
   *
   * Sent rather than duplicated. The popup is a classic script and cannot
   * import the module, and a second hand-maintained copy of the seven
   * activities is a second copy to drift — which is how a tool ends up filed
   * under one activity in the popup and another in the report.
   */
  UQA_ISTQB_MODEL: () => ({ principles: PRINCIPLES, activities: ACTIVITIES, tools: TOOL_ACTIVITY }),

  /**
   * What this browser can do, detected rather than assumed.
   *
   * The popup asks once at boot and disables what cannot work, so a Firefox
   * user meets a greyed-out button with a sentence naming the browser instead
   * of `chrome.offscreen is undefined` — which reads as a broken extension
   * rather than a platform limit.
   */
  UQA_CAPABILITIES: () => detectCapabilities(),

};

const WORKSPACES_OFF = 'Team workspaces are switched off in this version.';

/** Team workspaces (off), and the coverage they are measured by. */
export const workspaceHandlers = {
  /* ---- team workspaces: OFF (T-045) -----------------------------------
     A workspace file was an unauthenticated configuration channel (it could
     repoint the tracker and replace credential entries on join). The owner
     gated it off, not deleted: core/workspace.js stays on disk, out of the
     worker's boot graph, and every door below refuses. To bring it back,
     import the module again and restore these four handlers. */

  UQA_WORKSPACE: async () => ({ workspace: null, roles: [], abilities: {}, disabled: true }),
  UQA_WORKSPACE_EXPORT: () => { throw new Error(WORKSPACES_OFF); },
  UQA_WORKSPACE_PREVIEW: () => { throw new Error(WORKSPACES_OFF); },
  UQA_WORKSPACE_JOIN: () => { throw new Error(WORKSPACES_OFF); },
  UQA_WORKSPACE_LEAVE: async () => ({ left: true }),

  /** Which activities this session has actually reached. */
  UQA_COVERAGE: async (msg, sender) => coverage(await sessionState.getUsed(await activeSessionId(hintFor(msg, sender)))),

};

/** Black-box design techniques (CTFL 4.2). */
export const blackboxHandlers = {
  /* ---- black-box design (CTFL 4.2) ------------------------------------ */

  /**
   * The partitions and boundaries a field's own constraints define.
   *
   * Read from the page rather than asked for, because the field already
   * declares its specification — `min`, `maxlength`, `required`, `pattern` —
   * and a partition invented without one is a guess wearing a technique's name.
   */
  /**
   * Put one chosen value into the field the tester is standing in.
   *
   * The whole point of designing values while standing in a field is not having
   * to leave it, so this sets the value directly rather than putting it on the
   * clipboard for a paste that loses the focus anyway.
   */
  UQA_INJECT_VALUE: async (msg) =>
    sendToFeature(msg.tabId ?? (await testableTabId()), 'injector', {
      type: 'UQA_SET_FIELD_VALUE',
      value: msg.value,
      selector: msg.selector,
    }),

  UQA_PARTITIONS: async (msg) => {
    const field = msg.field || (await sendToFeature(msg.tabId ?? (await testableTabId()), 'injector', {
      type: 'UQA_DESCRIBE_FIELD',
      selector: msg.selector,
    }));
    if (!field) throw new Error('Pick a field first. There is nothing to derive partitions from.');
    return {
      field,
      partitions: await partitions(field),
      boundaries: await boundaries(field, { form: msg.form || 'three' }),
    };
  },

  /** Forget the field the tester picked, and close the panel over it. */
  UQA_CLEAR_FIELD: async (msg, sender) =>
    sendToFeature(msg.tabId ?? sender?.tab?.id ?? (await testableTabId(sender)), 'injector', {
      type: 'UQA_CLEAR_FIELD',
    }),

  // Outcomes arrive as a map keyed by the rule's bit pattern (a function cannot
  // cross the message channel); the door turns it back into one.
  UQA_DECISION_TABLE: async (msg) => decisionTable(msg.conditions, ruleOutcomes(msg.conditions, msg.outcomes)),

  UQA_STATE_MODEL: async (msg) => {
    const events = await getEvents(msg.sessionId || (await activeSessionId()));
    return stateTransitions(events, { states: msg.states });
  },

};

async function onDebuggerDetach({ tabId }) {
  if (tabId == null || coverageStopping.has(tabId) || (await chrome.storage.session.get('coverageTab')).coverageTab !== tabId) return;
  await chrome.storage.session.remove(['coverageTab', 'coverageMode']);
  const sessionId = await activeSessionId({ tabId });
  if (sessionId) await appendEvent({ sessionId, kind: 'note', tag: 'capture-gap', gap: 'coverage-detached', ts: Date.now(), tabId, text: 'Capture gap: coverage stopped when the debugger was detached.' });
}

export const watchDebuggerDetach = () => { try { chrome.debugger?.onDetach?.addListener(onDebuggerDetach); } catch { /* no permission */ } };

export const whiteboxHandlers = {
  /* ---- white-box coverage (CTFL 4.3) ---------------------------------- */

  UQA_COVERAGE_PERMISSION: () => whitebox.hasPermission(),
  UQA_COVERAGE_REQUEST: () => whitebox.requestPermission(),
  UQA_COVERAGE_DROP: () => whitebox.dropPermission(),

  UQA_COVERAGE_START: async (msg, sender) => {
    const tabId = msg.tabId ?? (await testableTabId(sender));
    if (tabId == null) throw new Error('Open the page you want to measure first.');
    // Reloading is the default because coverage measured without it is
    // coverage of the tail of a run; see whitebox.js startCoverage. The mode
    // is remembered so the stop can say which question it answered.
    const started = await whitebox.startCoverage(tabId, { reload: msg.reload !== false });
    await chrome.storage.session.set({ coverageTab: tabId, coverageMode: started.mode });
    watchDebuggerDetach();
    await noteUse('whitebox', undefined, { tabId });
    return started;
  },

  UQA_COVERAGE_STOP: async (msg) => {
    const { coverageTab, coverageMode } = await chrome.storage.session.get(['coverageTab', 'coverageMode']);
    const tabId = msg.tabId ?? coverageTab;
    if (tabId == null) throw new Error('Nothing is being measured.');
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const origin = tab?.url ? new URL(tab.url).origin : null;

    coverageStopping.add(tabId);
    let result;
    try {
      result = await whitebox.stopCoverage(tabId, { origin, mode: coverageMode || 'from-reload' });
    } finally {
      coverageStopping.delete(tabId);
      await chrome.storage.session.remove(['coverageTab', 'coverageMode']);
    }

    const sessionId = await activeSessionId({ tabId });
    if (sessionId) {
      await appendEvent({
        sessionId,
        kind: 'coverage',
        ts: Date.now(),
        ...result,
        frameUrl: tab?.url || null,
        tabId,
      });
      paintBadge();
    }
    return result;
  },

};

/** Jira, and the five trackers that are not Jira. */
export const trackerHandlers = {
  /* ---- Jira, discovered rather than assumed --------------------------- */
  UQA_JIRA_TEST: async () => jira.testConnection(await jiraConfig()),
  UQA_JIRA_PROJECTS: async () => jira.projects(await jiraConfig()),
  UQA_JIRA_TYPES: async (msg) => jira.issueTypes(await jiraConfig(), msg.projectKey),
  UQA_JIRA_TARGETS: async (msg) =>
    jira.linkTargets(await jiraConfig(), msg.projectKey, { query: msg.query, max: msg.max }),
  UQA_JIRA_LINK_TYPES: async () => jira.linkTypes(await jiraConfig()),
  UQA_JIRA_FILE: (msg) => fileInJira(msg),
  UQA_JIRA_QUICK: (msg) => quickFileInJira(msg),
  UQA_JIRA_SCAN: (msg) => fileInJira({ ...msg, dryRun: true, attach: msg.attach || QUICK_ATTACH[msg.kind || 'defect'] }),
  UQA_JIRA_DUPES: (msg) => findJiraDuplicates(msg),
  // What the confirmation shows. Reads the saved configuration; sends nothing.
  UQA_JIRA_QUICK_PLAN: (msg) => quickFilePlan(msg),
  UQA_JIRA_DRAFT: (msg) => draftForJira(msg),
  UQA_JIRA_CONFIGURED: async () => {
    const c = await jiraConfig();
    return { configured: jiraReady(c), project: c.project || '', issueType: c.issueType || 'Bug' };
  },

  /**
   * What happened to what we filed.
   *
   * The half of an integration everybody skips. Filing is easy; the useful
   * question a week later is whether it was fixed.
   */
  UQA_JIRA_SYNC: (msg) => syncJiraStatus(msg),
  UQA_FILED: async (msg) => {
    const session = await getSession(msg.sessionId);
    return { filed: session?.filed || [], summary: session?.filedSummary || null };
  },

  /* ---- other trackers -------------------------------------------------
     GitHub, Linear, Trello, ClickUp and Asana. Jira keeps its own module
     because Jira is genuinely more complicated; these five reduce to the same
     three questions and share one adapter shape. See background/trackers.js. */

  // Data, not adapters: answered from `core/tracker-specs.js` so that opening
  // Settings does not create a hidden media document to ask what GitLab needs.
  UQA_TRACKERS: () => TRACKER_SPECS,

  UQA_TRACKER_STATE: async () => {
    const settings = await getSettings();
    return TRACKER_SPECS.map((t) => ({
      ...t,
      configured: isConfiguredSpec(t.id, settings.trackers?.[t.id] || {}),
      url: trackerUrl(t.id, settings.trackers?.[t.id] || {}),
    }));
  },

  UQA_TRACKER_TEST: async (msg) => {
    const settings = await getSettings();
    return trackerOp('test', {
      tracker: msg.tracker,
      cfg: msg.config || settings.trackers?.[msg.tracker] || {},
    });
  },

  UQA_TRACKER_TARGETS: async (msg) => {
    const settings = await getSettings();
    return trackerOp('targets', {
      tracker: msg.tracker,
      cfg: settings.trackers?.[msg.tracker] || {},
    });
  },

  /**
   * File the session's defect report into a tracker that is not Jira.
   */
  UQA_TRACKER_FILE: async (msg) => {
    const settings = await getSettings();
    const cfg = settings.trackers?.[msg.tracker] || {};
    // The spec, not the adapter: this worker no longer holds the adapters and
    // only needs to know the tracker exists.
    const tracker = specById(msg.tracker);
    if (!tracker) throw new Error(`Unknown tracker: ${msg.tracker}`);

    const { session, events } = await loadSession(msg.sessionId);

    const defect = buildDefectReport(session, events, msg.options || {});
    const markdown = await defectToMarkdown(defect);
    // trackers.js renders the Markdown into the body format this tracker takes (D-1010-79).
    const body = markdown;

    const created = await trackerOp('file', { tracker: msg.tracker, cfg, payload: {
      title: defect.summary,
      body,
      target: msg.target,
      labels: msg.labels || ['qa-wrap', `severity-${defect.severity}`],
      /** The evidence, named rather than carried. */
      sessionId: msg.sessionId,
      attach: msg.attach ?? { screenshots: true },
      // Which of the seven documents this is, so an adapter with real work
      // item types files it as the right one. Defaults to a defect, which is
      // what this handler filed before any tracker had types.
      kind: msg.kind || 'defect',
    } });

    await addNote(`Filed in ${created.label} as ${created.key}: ${created.url}`, 'issue').catch(() => {});
    await rememberFiled(msg.sessionId, [
      { key: created.key, url: created.url, kind: 'defect', tracker: created.tracker },
    ]).catch(() => {});

    return { ...created, severity: defect.severity };
  },

};

/** Chat and bots. */
export const chatHandlers = {
  /* ---- chat and bots -------------------------------------------------- */
  UQA_NOTIFY: (msg) => notifyAll(msg),
  UQA_SCAN: (msg) => scanOutbound(msg.fields), // Reporter and .eml bodies
  UQA_NOTIFY_PROVIDERS: () => chat.PROVIDERS,
  UQA_NOTIFY_TEST: async (msg) => {
    // A dry run against one destination, with an obviously synthetic payload —
    // finding out a webhook is wrong when you are filing a real defect is the
    // worst possible moment.
    const summary = chat.summarise({
      session: { charter: 'QA Wrap connection test', startedAt: Date.now(), startUrl: 'https://example.test/' },
      events: [],
      defect: null,
      links: {},
    });
    summary.title = 'QA Wrap connection test, which you can ignore';
    return chat.send(msg.destination, summary);
  },
  /**
   * What a Postman export would contain, before it is made.
   *
   * Said first because the answer is often "nothing": a session spent on a
   * static page has no requests to collect, and finding that out from an empty
   * file is worse than being told.
   */
  UQA_POSTMAN_SUMMARY: async (msg) => {
    const session = await mustSession(msg.sessionId);
    return summarisePostman(session, await getEvents(msg.sessionId));
  },

};
