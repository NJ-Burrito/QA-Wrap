/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** UQA background service worker. MV3 kills it when idle: no session state in memory, every event goes to IndexedDB on arrival. */

import { watchPolicy, getSettings, hasSidePanel, unmask, assertPolicy, policy } from '../platform/settings.js';
import { bindTxDeadline, lastEventTs, getSession, putSession } from '../core/db.js';
import { withDeadline as bounded, noteSlow } from '../platform/deadline.js';
import { cueOp, jiraOp, recordingState } from './media.js';
import { trackerUrl } from '../core/tracker-specs.js';
import {
  RECORDING_DOORS, NEEDS_ARMING, TAB_ID_MEANS_SOMETHING_ELSE, WAITS_FOR_A_PERSON, HANDLER_TIMEOUT_MS, TIMEOUT_ADVICE,
  COUNTS_AS,
} from './dispatch-tables.js';
import * as armed from './armed.js';
import { LOCKED, UNREADABLE, lockVault } from '../platform/vault.js';
import { featureOf, hasServiceAccess, notAllowedMessage } from '../platform/policy.js';
import { ledgerRow, recordEgress } from '../core/egress.js';
import * as site from './site-access.js';
import { installContextMenus } from './context-menus.js';
import { on } from '../core/on.js';
import { stopRecordingIcon, syncRecordingIcon } from './action-icon.js';
import * as draftDoor from './draft-door.js';
import * as whitebox from './whitebox.js';
import * as remember from './remember.js';
import { installConsoleApi, signConsole } from './signature.js';
import * as sessionState from './session-state.js';
import {
  QAConsole, activeSessionId, coded, currentWindowId, dropCat, handlers, isInternalUrl, liveSessionIds, refreshMenus,
  refusalText, sessionIn, sessionsByWindow, tw,
} from './worker-base.js';
import { TESTABLE, broadcast, isExtensionPage, openOwnPage, sendToTab, testableTabId } from './worker-tabs.js';
import { dropScrubCfg } from './worker-scrub.js';
import {
  DONE_KEY, appendEvent, belongsToSession, closeViewportRuns, jiraConfig, noteUse, paintBadge, setActiveSessionId,
  signalDone, startSession, stopSession,
} from './worker-session.js';
import {
  checkUpdates, ensureRetentionAlarm, floatWindow, followFocus, forgetInvoked, noteInvoked, openFloat, purgeExpired, reconcileOnce,
  recoverPendingClips, syncPanelBehavior,
} from './worker-lifecycle.js';
import {
  blackboxHandlers, chatHandlers, istqbHandlers, maskingHandlers, pageToolHandlers, replayHandlers, ruleHandlers,
  storageHandlers, trackerHandlers, watchDebuggerDetach, whiteboxHandlers, workspaceHandlers,
} from './handlers-tools.js';
import { autopilot, libraryHandlers, recordingHandlers, sessionHandlers } from './handlers-session.js';
import { armedHandlers, browserHandlers, settingsHandlers } from './handlers-app.js';

/** Stamped so a stale, cached worker can be detected rather than guessed at. */
globalThis.__UQA_BUILD = chrome.runtime.getManifest().version;

/** `chrome.storage.local` is for this extension's own contexts, and nothing else. */
chrome.storage.local
  .setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  ?.catch?.(() => {});

/** Admin policy, read once at boot, never awaited: `storage.managed.get` never answers on a clean profile (see `policy()` in platform/settings.js). */
watchPolicy();

bindTxDeadline((p) => bounded(p, 'tx')); // r2-06-3

chrome.storage.onChanged.addListener((c, a) => { if (a === 'session' && 'armedWindows' in c) paintBadge(); if (a === 'session' && DONE_KEY in c && !c[DONE_KEY].newValue) paintBadge(); });

const SETTINGS_WRITERS = new Set(['UQA_SET_SETTINGS', 'UQA_RESET_SETTINGS', 'UQA_WORKSPACE_JOIN', 'UQA_WORKSPACE_LEAVE', 'UQA_VAULT_STATE', 'UQA_VAULT_PASS', 'UQA_VAULT_UNLOCK', 'UQA_VAULT_LOCK', 'UQA_VAULT_FORGET']);

// Content scripts cannot read local storage (TRUSTED_CONTEXTS above), so a theme change reaches the page by message.
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'managed' || 'settings' in c) dropScrubCfg(); if ('settings' in c || (area === 'managed' && 'launchSurface' in c)) syncPanelBehavior();
  if (area === 'sync' && c.qawLanguage) { dropCat(); refreshMenus().catch(() => {}); }
  if (area === 'local' && c.qawTheme) broadcast({ type: 'UQA_THEME', theme: c.qawTheme.newValue }).catch(() => {});
});

watchDebuggerDetach();

/** The message table, assembled from the groups above. */
Object.assign(handlers, {
  ...sessionHandlers,
  ...recordingHandlers,
  ...libraryHandlers,
  ...maskingHandlers,
  ...settingsHandlers,
  ...ruleHandlers,
  ...armedHandlers,
  ...pageToolHandlers,
  ...replayHandlers,
  ...storageHandlers,
  ...istqbHandlers,
  ...workspaceHandlers,
  ...blackboxHandlers,
  ...whiteboxHandlers,
  ...trackerHandlers,
  ...chatHandlers,
  ...browserHandlers,
  UQA_CUE: async (msg) => { const why = await cueOp(msg?.name, { forwarded: true }); if (why === 'off') signalDone(); return why; }, // a hidden tab's result sound; sound off leaves the visual twin
});

// Finish cues, after the job resolved (a stop cue must not meet its own recording).
for (const [t, cue, timed] of /** @type {[string, (r: any) => string, number?][]} */ ([
  ['UQA_RECORD_STOP', () => 'record.stop'],
  ['UQA_CHECK_LINKS', (r) => (r?.broken > 0 ? 'links.broken' : 'links.clean'), 1],
  ['UQA_HARVEST', () => 'harvest.done', 1],
])) {
  const run = handlers[t];
  handlers[t] = async (m, s) => {
    const startedAt = timed ? Date.now() : undefined;
    const r = await run(m, s);
    const name = cue(r);
    cueOp(name, { startedAt }).then((why) => { if (why === 'off' && timed && Date.now() - startedAt >= 5000) signalDone(); });
    return r;
  };
}

const FILING = /^UQA_(JIRA_(TEST|PROJECTS|TYPES|TARGETS|LINK_TYPES|FILE|QUICK|SYNC|SCAN|DUPES)|TRACKER_(TEST|TARGETS|FILE)|NOTIFY(_TEST)?)$/;

async function serviceUrlFor(type, msg) {
  if (type === 'UQA_NOTIFY_TEST') return msg.destination?.provider === 'telegram' ? 'https://api.telegram.org/' : msg.destination?.url;
  if (/^UQA_JIRA_(TEST|PROJECTS|TYPES|TARGETS|LINK_TYPES|FILE|QUICK|SYNC|SCAN|DUPES)$/.test(type)) return (await jiraConfig()).baseUrl;
  if (/^UQA_TRACKER_(TEST|TARGETS|FILE)$/.test(type)) {
    const cfg = (type === 'UQA_TRACKER_TEST' && msg.config) || (await getSettings()).trackers?.[msg.tracker] || {};
    return trackerUrl(msg.tracker, cfg);
  }
  return null;
}

/**
 * What a content script may ask for, and nothing else (allow-list, not a denylist).
 * A content script runs beside the page under test; anything not named here
 * (settings, vault, cookies, filing, tools) is for the extension's own pages.
 */
const CONTENT_SCRIPT_TYPES = new Set([
  'UQA_ARMED', 'UQA_BAR', 'UQA_BUFFER_ON', 'UQA_CAPTURE', 'UQA_COPY_TEXT', 'UQA_CURSOR', 'UQA_EVENT', 'UQA_FRAME_CHAIN',
  'UQA_GET_RULES', 'UQA_GET_SETTINGS', 'UQA_GET_STATE', 'UQA_INJECT', 'UQA_MASK_DONE', 'UQA_MASK_GET', 'UQA_MASK_SET',
  'UQA_NOTE', 'UQA_OPEN_FLOAT', 'UQA_OVERLAY_ASSETS', 'UQA_PICK', 'UQA_PICK_OFF', 'UQA_PICKED', 'UQA_REPLAY_CHUNK',
  'UQA_RECORD_SCREEN', 'UQA_RULE_FIRED', 'UQA_SCAN_A11Y', 'UQA_SHOT_AUTO', 'UQA_SHOT_URL', 'UQA_STOP', 'UQA_TOGGLE_RTL',
]);

/** Who may send it, and whether the service it calls has been allowed. */
async function guardSender(type, msg, sender) {
  if (sender?.tab && !isExtensionPage(sender) && !CONTENT_SCRIPT_TYPES.has(type)) {
    throw new Error('That request cannot be made from a web page.');
  }
  // Page write doors (EVENT and REPLAY_CHUNK refuse softly themselves): a sleeping or foreign tab writes nothing.
  if (sender?.tab && !isExtensionPage(sender) && RECORDING_DOORS.has(type)) {
    const sid = await activeSessionId(sender);
    await armed.assertMayRecord(sender, { belongs: sid ? (tabId) => belongsToSession(sid, tabId) : undefined });
  }
  if (SETTINGS_WRITERS.has(type) && !isExtensionPage(sender)) {
    throw new Error('Settings can only be changed from the QA Wrap settings page.');
  }
  if (FILING.test(type)) {
    const cur = await getSettings();
    if (cur.vaultLocked) throw coded(LOCKED, 'VAULT_LOCKED');
    if (cur.vaultUnreadable) throw coded(UNREADABLE, 'VAULT_UNREADABLE');
    // A masked value from a page means "the saved one": swap it in, here, where secrets may live.
    if (msg.config) msg.config = unmask({ trackers: { t: msg.config } }, { trackers: { t: cur.trackers?.[msg.tracker] } }).trackers.t;
    if (msg.destination) msg.destination = unmask({ webhooks: [msg.destination] }, cur).webhooks[0];
  }
  const service = await serviceUrlFor(type, msg);
  const feature = featureOf(type); // T-068: the managed policy, at the seam
  if (feature) await assertPolicy(feature, service);
  if (service && !(await hasServiceAccess(service))) throw coded(notAllowedMessage(service), 'NEEDS_GRANT');
  return service; // T-070: ledgered after the handler (LEDGERED)
}

const LEDGERED = /^UQA_(JIRA_(FILE|QUICK|SYNC|DUPES)|TRACKER_FILE)$/;

function ledgerSend(type, service, msg, result) { // r7-02-1: one row, message plus attachment bytes
  const row = ledgerRow(type.startsWith('UQA_J') ? 'jira' : 'tracker', service, JSON.stringify(msg));
  return recordEgress({ ...row, bytes: row.bytes + (Number(result?.attachedBytes) || 0), findingsCount: null, scanned: null }); // the scan runs offscreen
}

async function guard(type, msg, sender) {
  if (!NEEDS_ARMING.has(type)) return;
  const tabId = msg?.tabId ?? sender?.tab?.id ?? (await testableTabId());
  const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  const windowId = tabId != null ? tab?.windowId : await currentWindowId(sender);
  if (!(await armed.isArmedWindow(windowId))) throw armed.asleepError();

  // The second gate: no host permission at install, so armed in this window is not allowed on this page; one sentence for every tool (not on chrome://, about: or the Web Store: no grant could cover them).
  if (site.originPattern(tab?.url || '') && !(await site.hasSiteAccess(tab.url))) {
    throw site.notAllowedError();
  }
}

/** A toast in the page, because a service worker has nowhere of its own to speak. */
async function notify(tabId, text, kind = 'ok') {
  await sendToTab(tabId, { type: 'UQA_FLASH', text, kind });
}

installContextMenus({
  // The menu calls the very same handlers the popup does. Two implementations
  // of "start recording" is how the two end up doing different things.
  handlers: new Proxy(
    {},
    { get: (_t, name) => (msg = {}) => Promise.resolve(handlers[name](msg, { url: 'contextMenu' })) }
  ),
  notify,
  refreshMenus,
  isArmed: (tabId) => armed.isArmedTab(tabId),
  asleep: armed.ASLEEP,
  tr: tw,
  windowSession: async (windowId) => sessionIn(await sessionsByWindow(), windowId),
  stopSession,
});

/** Anything that still gets past is reported, not swallowed. */
self.addEventListener('unhandledrejection', (event) => {
  QAConsole.warn('unhandled rejection:', event.reason?.message || event.reason);
  event.preventDefault();
});

on(chrome.runtime?.onInstalled, 'runtime.onInstalled › refreshMenus', refreshMenus);

on(chrome.notifications?.onClicked, 'notifications.onClicked', (id) => id.startsWith('qaw-jira|') && chrome.tabs.create({ url: id.slice(9) }));

on(chrome.runtime?.onStartup, 'runtime.onStartup › refreshMenus', refreshMenus);

// Through `on()` like every other async registration. The `.catch(() => {})`
// inside makes a rejection unlikely rather than impossible — `chrome.sidePanel`
// is absent on Gecko, so the optional call can return undefined and the `.catch`
// is never reached — and an unhandled rejection here is an error badge on the
// extension's card that a tester has to clear by hand.
on(chrome.runtime?.onInstalled, 'runtime.onInstalled › panel behaviour', syncPanelBehavior);

on(chrome.runtime?.onStartup, 'runtime.onStartup › panel behaviour', syncPanelBehavior);

syncPanelBehavior();

// An MV3 worker can be killed mid-clip, and a killed worker leaves whichever
// animated frame it painted last sitting on the toolbar for ever. Stopping on
// startup costs nothing and is the only thing that clears it.
// Crashed sessions are closed before anything sweeps, on both paths. See
// reconcileInterrupted(): registering first is necessary and not sufficient,
// which is why the sweep below awaits the same pass rather than assuming it ran.
on(chrome.runtime?.onStartup, 'runtime.onStartup › reconcile interrupted sessions', reconcileOnce);

on(chrome.runtime?.onInstalled, 'runtime.onInstalled › reconcile interrupted sessions', reconcileOnce);

on(chrome.runtime?.onStartup, 'runtime.onStartup', async () => {
  await reconcileOnce();
  await recoverPendingClips().catch(() => {});
  return Promise.all([ensureRetentionAlarm(), purgeExpired(), stopRecordingIcon(), chrome.alarms.clear('timebox'), chrome.storage.local.remove('qawJiraDir')]); // the bare legacy alarm has no session id; the Jira RTL/LTR pick lasts until Chrome closes
});

on(chrome.runtime?.onInstalled, 'runtime.onInstalled', async () => {
  await reconcileOnce();
  await recoverPendingClips().catch(() => {});
  return Promise.all([ensureRetentionAlarm(), purgeExpired(), chrome.alarms.clear('timebox')]);
});

/*
 * The toolbar, put back in step on every worker start — not only on onStartup.
 */
recordingState()
  .then((state) => syncRecordingIcon(!!state?.recording, { mic: !!state?.sources?.mic })).finally(() => paintBadge()) // the sync hands back '' over paintBadge's own session dot on every wake: repaint
  .catch(() => {});

on(chrome.action?.onClicked, 'action.onClicked', async (tab) => {
  // Clicking the icon is an invocation, so Chrome has just granted activeTab
  // on this tab. Remember it: without this the popup cannot tell a recordable
  // tab from one where Record will refuse.
  await noteInvoked(tab?.id);
  const open = await floatWindow();
  if (open) {
    // T-044 G4 (Q-12): the float is usually hidden behind the browser; a click brings it forward, it never closes it.
    await chrome.windows.update(open.id, { focused: true, drawAttention: true, ...(open.state === 'minimized' ? { state: 'normal' } : {}) }).catch(() => {});
    return;
  }
  const settings = await getSettings();
  if (settings.launchSurface === 'panel' && hasSidePanel()) {
    await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => openFloat(tab.windowId));
    return;
  }
  await openFloat(tab.windowId);
});

on(chrome.tabs?.onRemoved, 'tabs.onRemoved', (tabId) => forgetInvoked(tabId));

on(chrome.windows?.onRemoved, 'windows.onRemoved', async (id) => {
  const { floatWindowId } = await chrome.storage.session.get('floatWindowId');
  if (floatWindowId === id) await chrome.storage.session.remove('floatWindowId');

  /** A window closing ends two different things, and both have to be told. */
  for (const sessionId of await liveSessionIds()) {
    await closeViewportRuns({ sessionId, windowId: id, reason: 'closed' }).catch(() => {});
  }
  const map = await sessionsByWindow();
  if (map[id]) await stopSession(map[id]).catch(() => {});
});

on(chrome.windows?.onBoundsChanged, 'windows.onBoundsChanged', async (win) => {
  const { floatWindowId } = await chrome.storage.session.get('floatWindowId');
  if (win.id !== floatWindowId) return;
  await chrome.storage.local.set({ floatBounds: { left: win.left, top: win.top, width: win.width, height: win.height } });
});

armed.watchWindows(); on(chrome.tabs?.onActivated, 'tabs.onActivated › follow focus', followFocus); on(chrome.windows?.onFocusChanged, 'windows.onFocusChanged › follow focus', followFocus);

/**
 * The registered page scripts, kept equal to the granted origins.
 */
/* store build: new version staged, the card offers Restart (never automatic) */ on(chrome.runtime?.onUpdateAvailable, 'runtime.onUpdateAvailable', (d) => d?.version && chrome.storage.local.set({ qawUpdateReady: d.version })); site.watchSiteAccess(() => armed.syncHooks({ inject: true }).catch(() => {})); draftDoor.bridgeSync(); // the agent bridge port, only while the user has it on on(chrome.runtime?.onInstalled, "runtime.onInstalled › what's new", async (d) => d?.reason === 'update' && (await import('../core/whats-new-open.js')).open(d));

/** The first-run notice: on install only (not update), and not again when consent is already recorded. */
on(chrome.runtime?.onInstalled, 'runtime.onInstalled › the welcome page', async (details) => {
  if (details?.reason !== 'install') return;
  const { consentedAt } = await chrome.storage.local.get('consentedAt');
  const probe = () => chrome.storage.managed?.get('consentMode'); // policy() would fail open to "user" on an unreadable area
  try { await probe(); } catch { await new Promise((r) => setTimeout(r, 1000)); try { await probe(); } catch { return; } } // unreadable twice: no tab, the popup card still asks
  if (consentedAt || (await policy()).consentMode === 'organisation') return;
  await openOwnPage('welcome/welcome.html').catch(() => {});
});

/** The page under test, for a message from one of our own pages open as a tab. */
async function hintTabId(msg, sender) {
  if (msg?.tabId != null || sender?.tab?.windowId == null) return msg;
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return msg;
  if (TAB_ID_MEANS_SOMETHING_ELSE.has(msg.type)) return msg;
  const tabId = await testableTabId(sender);
  return tabId == null ? msg : { ...msg, tabId };
}

chrome.runtime.onMessage.addListener((incoming, sender, sendResponse) => {
  // Only this extension's own pages and content scripts. Nothing is declared
  // externally connectable, so this cannot fire today; the guard is here so a
  // future manifest change cannot open the whole handler table by accident.
  if (sender?.id && sender.id !== chrome.runtime.id) return false;
  const handler = Object.hasOwn(handlers, incoming?.type) ? handlers[incoming.type] : undefined; // D-1010-181: not 'constructor'
  if (!handler) return false;
  let msg = incoming;

  let answered = false;
  const answer = (payload) => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    try {
      sendResponse(payload);
    } catch {
      /* the caller (usually a popup) closed before we got back to it */
    }
  };

  const deadline = WAITS_FOR_A_PERSON[msg.type] || HANDLER_TIMEOUT_MS;
  /*
   * What to say when the deadline is reached, per handler.
   *
   * "Reload the extension at chrome://extensions" is right for a hung tool and
   * catastrophic for a clip that is still being written: reloading is what
   * destroys it. A handler that is slow because it is doing something large
   * says so, and says to wait.
   */
  const patience = TIMEOUT_ADVICE[msg.type] || 'Reload the extension at chrome://extensions and try again.';
  let stage = 'hint';
  let seamUrl = '';
  const timer = setTimeout(() => {
    console.warn('[uqa] deadline', `handler:${msg.type}@${stage}`, deadline); noteSlow(`handler:${msg.type}@${stage}`, deadline);
    answer({
      ok: false,
      error: `${msg.type} did not finish within ${Math.round(deadline / 1000)}s. ${patience}`,
      timedOut: true,
      stage,
      ...(TIMEOUT_ADVICE[msg.type] ? {} : { code: 'SLOW' }),
    });
  }, deadline);

  Promise.resolve(hintTabId(msg, sender))
    .then((hinted) => {
      msg = hinted;
      stage = 'guardSender';
      return guardSender(msg.type, msg, sender).then((svc) => ((seamUrl = svc || ''), (stage = 'guard'), guard(msg.type, msg, sender)));
    })
    .then(() => ((stage = 'handler'), handler(msg, sender)))
    .then((result) => {
      if (LEDGERED.test(msg.type)) ledgerSend(msg.type, seamUrl, msg, result);
      // After it worked, never before. A scan that threw is not a scan the
      // tester did, and a tick earned by a failure is a lie the popup tells.
      if (COUNTS_AS[msg.type]) { noteUse(COUNTS_AS[msg.type]); keepLocal('toolUseTicks', (n) => (Number(n) || 0) + 1); }
      return answer({ ok: true, result });
    })
    .catch(async (err) => {
      if (stage === 'handler' && LEDGERED.test(msg.type)) ledgerSend(msg.type, seamUrl, msg);
      const p = whitebox.policyRefusal(err?.message);
      answer({ ok: false, error: p ? await tw(p.key, p.en) : String(err?.message || err), ...(p ? { code: p.code } : err?.code ? { code: err.code, data: err.data, retryMs: err.retryMs } : {}) });
    });

  return true; // async
});

/* -------------------------------------------------------------------- events */

async function recordNav(details, route) {
  if (details.frameId !== 0) return;
  if (!route) lastRouteUrl.delete(details.tabId);
  // Chrome drops activeTab on navigation, so we do too; a route change keeps it.
  if (!route) await forgetInvoked(details.tabId);
  // The tab's own window: with two live sessions the last-active one is not necessarily this tab's.
  const sessionId = await activeSessionId({ tabId: details.tabId });
  if (!sessionId) return;
  if (!(await armed.isArmedTab(details.tabId))) return;
  // Same two filters as ingest(): the extension's own popup opening must not
  // show up as a navigation step in the tester's repro.
  if (isInternalUrl(details.url)) return;
  if (!(await belongsToSession(sessionId, details.tabId))) return;
  if (route) { if (lastRouteUrl.get(details.tabId) === details.url) return; lastRouteUrl.set(details.tabId, details.url); }
  await appendEvent({
    sessionId,
    kind: 'nav',
    ts: Date.now(),
    url: details.url,
    transition: details.transitionType,
    // forward_back, client_redirect ...: how the tester got there
    ...(details.transitionQualifiers?.length ? { qualifiers: details.transitionQualifiers } : {}),
    ...(route ? { route: true } : {}),
    tabId: details.tabId,
    frameUrl: details.url,
  });
  paintBadge();
}

const lastRouteUrl = new Map(); // D-1010-99

on(chrome.webNavigation?.onCommitted, 'webNavigation.onCommitted', (d) => recordNav(d, false));

// SPA routes (pushState, replaceState, popstate, hash): no new document, so onCommitted is silent.
on(chrome.webNavigation?.onHistoryStateUpdated, 'webNavigation.onHistoryStateUpdated', (d) => recordNav(d, true));

on(chrome.webNavigation?.onReferenceFragmentUpdated, 'webNavigation.onReferenceFragmentUpdated', (d) => recordNav(d, true));

on(chrome.webNavigation?.onCommitted, 'remember.autoWake', (d) => remember.autoWake(d, autopilot).then(() => remember.autoStart(d, autopilot)));

/** The status of the page itself. */
on(chrome.webNavigation?.onCompleted, 'webNavigation.onCompleted', async (details) => {
  // Frame 0 only. An advertising iframe returning 404 is not a finding about
  // the application, and counting it would repeat the mistake this fixes.
  if (details.frameId !== 0) return;
  const sessionId = await activeSessionId({ tabId: details.tabId });
  if (!sessionId) return;
  if (!(await armed.isArmedTab(details.tabId))) return;
  if (isInternalUrl(details.url)) return;
  if (!(await belongsToSession(sessionId, details.tabId))) return;

  let nav = null;
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: details.tabId, frameIds: [0] },
      func: () => {
        const entry = performance.getEntriesByType('navigation')[0];
        if (!entry) return null;
        return {
          // Chrome 109+. Older builds report 0, and a 0 must never read as a
          // failure — a status the browser will not tell us is not a bad one.
          status:
            typeof entry.responseStatus === 'number' && entry.responseStatus > 0
              ? entry.responseStatus
              : null,
          durationMs: Math.round(entry.responseEnd - entry.startTime),
        };
      },
    });
    nav = frame?.result ?? null;
  } catch {
    // The tab navigated again, or is not scriptable. Silence is correct here:
    // a missing status is not a failing one.
    return;
  }

  if (!nav || nav.status == null || nav.status < 400) return;

  // A `net` event, so the existing definition of a failure picks it up and the
  // count, the correlation engine, the timeline, the session sheet and every
  // export follow with no further change.
  await appendEvent({
    sessionId,
    kind: 'net',
    via: 'document',
    method: 'GET',
    url: details.url,
    status: nav.status,
    ok: false,
    error: false,
    durationMs: nav.durationMs,
    ts: Date.now(),
    tabId: details.tabId,
    frameUrl: details.url,
  });
  paintBadge();
});

// D-1010-183: a load that failed has no status to read; Chrome says why. Aborts are the tester moving on. r9-05-2: a sub-frame is a row with via 'subframe'.
on(chrome.webNavigation?.onErrorOccurred, 'webNavigation.onErrorOccurred', async (details) => {
  if (details.error === 'net::ERR_ABORTED') return;
  const sessionId = await activeSessionId({ tabId: details.tabId });
  if (!sessionId || !(await armed.isArmedTab(details.tabId)) || isInternalUrl(details.url)) return;
  if (!(await belongsToSession(sessionId, details.tabId))) return;
  await appendEvent({ sessionId, kind: 'net', via: details.frameId > 0 ? 'subframe' : 'document', ...(details.frameId > 0 && { frameId: details.frameId }), method: 'GET', url: details.url, status: 0, ok: false, error: true, text: details.error, durationMs: 0, ts: Date.now(), tabId: details.tabId, frameUrl: details.url });
  paintBadge();
});

/**
 * A refusal the tester can see, from a handler with nowhere to draw one.
 *
 * `notify` injects into the page, so it cannot reach `chrome://`, the Web Store
 * or a PDF viewer — which are exactly the pages a recording refusal is most
 * likely to be about. The badge is the fallback that always works: three
 * letters, cleared after a few seconds, so it cannot be mistaken for state.
 */
async function sayLoudly(tabId, text, tone = 'err') {
  await notify(tabId, text, tone).catch(() => {});
  if (tone !== 'err') return;
  const before = await chrome.action.getBadgeText({}).catch(() => '');
  await chrome.action.setBadgeBackgroundColor({ color: '#B5321F' }).catch(() => {});
  await chrome.action.setBadgeText({ text: 'ERR' }).catch(() => {});
  setTimeout(async () => {
    const now = await chrome.action.getBadgeText({}).catch(() => '');
    if (now === 'ERR') await chrome.action.setBadgeText({ text: before || '' }).catch(() => {});
  }, 6000);
}

/** D-1010-172: the shortcut as a phrase in the tester's language, never its slug. */
async function commandLabel(command) {
  const camel = String(command).replace(/^_/, '').replace(/[-_](.)/g, (_m, c) => c.toUpperCase());
  return (await tw(`common.worker.command.${camel}`, '')) || tw('common.worker.command.other', 'the shortcut');
}

on(chrome.commands?.onCommand, 'commands.onCommand', async (command, tab) => {
  /*
   * Chrome hands the invoked tab as the second argument, and it was dropped.
   */
  const invokedTab = tab?.url && TESTABLE.test(tab.url) && !isInternalUrl(tab.url) ? tab : null;
  const invoked = invokedTab?.id ?? null;
  const tabId = invoked ?? (await testableTabId());
  // Only what Chrome actually granted. Never the guess.
  await noteInvoked(invoked);
  // toggle-recording wakes a sleeping window itself (below); every other command needs it awake already.
  if (command !== 'toggle-recording' && !(await armed.isArmedTab(tabId))) {
    const woke = await remember.wakeForShortcut(invokedTab ?? (await chrome.tabs.get(tabId).catch(() => null)), { armed, site, arm: (m) => handlers.UQA_ARM(m) });
    if (woke !== 'woke') return void (woke || (await sayLoudly(tabId, await tw('popup.refusal.asleep', armed.ASLEEP))));
  }

  // A video of this tab. It has to happen *here*, in the handler for the
  // invocation, because that is the only moment Chrome guarantees the
  // activeTab grant — asking the popup to do it later is how this feature
  // came to look unreliable.
  if (command === 'record-tab') {
    /*
     * Wrapped, because a throw in here reaches nobody.
     *
     * There was no try/catch at all: a refusal from `UQA_RECORD_START` — which
     * is where the whole activeTab explanation in `media.js` lives — threw past
     * the `notify` below and landed in `on()`'s `console.warn`, in the service
     * worker's console. The one route the refusal text names is the one route
     * that could not show it.
     */
    try {
      if (!invoked) {
        await sayLoudly(
          tabId,
          await tw('common.worker.toast.shortcutNotGranted', 'Chrome grants permission to record only the page the shortcut was pressed on, ' +
            'and this is not one it will capture. Open the site you are testing and press it there.')
        );
        return;
      }
      const state = await recordingState();
      if (state.recording) {
        const meta = await handlers.UQA_RECORD_STOP({});
        await notify(invoked, (await tw('common.worker.toast.videoSaved', 'Video saved: {s}s.')).replace('{s}', Math.round((meta.durationMs || 0) / 1000)), 'ok');
      } else {
        await handlers.UQA_RECORD_START({ tabId: invoked });
        await notify(invoked, await tw('common.worker.toast.recordingShortcut', 'Recording this tab. Press the shortcut again to stop.'), 'ok');
      }
    } catch (err) {
      await sayLoudly(invoked ?? tabId, await refusalText(err));
    }
    return;
  }

  // T-015: a throw here used to land in on()'s console.warn, where no tester looks.
  try {
  if (command === 'toggle-recording') {
    // The window the key was pressed in (r3-09-1): a session in another window is not this one's to stop.
    const here = tab?.windowId != null ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    const id = here?.windowId != null ? sessionIn(await sessionsByWindow(), here.windowId) : await activeSessionId();
    const said = (key, en) => tw(key, en).then((text) => notify(here?.id ?? tabId, text, 'ok')).catch(() => {}); // r4-09-2: the key press answers
    if (id) {
      await stopSession(id);
      await said('common.worker.toast.recStopped', 'Recording stopped. The report is ready in the popup.');
    } else if (here?.url && (!TESTABLE.test(here.url) || isInternalUrl(here.url))) {
      await sayLoudly(here.id ?? tabId, await tw('popup.err.needsPage', 'Open a normal web page first.')); // r5-09-2
    } else {
      // A sleeping window is woken when the site is allowed (it used to throw asleepError); otherwise one clear next step.
      const woke = await remember.wakeForShortcut(here, { armed, site, arm: (m) => handlers.UQA_ARM(m) });
      if (!woke || woke === 'open-popup') return void (woke || (await sayLoudly(here?.id ?? tabId, await tw('common.worker.shortcutNeedsSite', 'QA Wrap is not allowed on this site yet. Open QA Wrap and press "Test this site" once. After that Alt+Shift+Q works here.'))));
      await startSession({ charter: await tw('common.worker.quickCharter', 'Quick session'), tabId: here?.id, startUrl: here?.url, shortcut: true });
      await said('common.worker.toast.recStarted', 'Recording. Everything you do here is on the clock.');
    }
  } else if (command === 'pick-element') {
    await handlers.UQA_PICK({ tabId });
  } else if (command === 'toggle-rtl') {
    await handlers.UQA_TOGGLE_RTL({ tabId });
  } else if (command === 'inject-data') {
    await handlers.UQA_INJECT({ tabId });
  }
  } catch (err) {
    await sayLoudly(tabId, (await tw('common.worker.toast.commandFailed', 'QA Wrap: {command} failed. {message}')).replace('{command}', await commandLabel(command)).replace('{message}', await refusalText(err)));
  }
});

on(chrome.alarms?.onAlarm, 'alarms.onAlarm', async (alarm) => {
  if (alarm.name === 'retention' || alarm.name === 'qaw-update') return void (await (alarm.name === 'retention' ? purgeExpired() : checkUpdates()));
  if (alarm.name === 'qaw-vault-idle') return void (await lockVault()); // D-210
  if (alarm.name === 'qaw-jira') { // Jira helper poll
    return void (await chrome.storage.local.get(['qawJira', 'qawJiraSeen']).then(({ qawJira: s, qawJiraSeen: seen }) => jiraOp('poll', [{ ...(/** @type {any} */ (s)), seen }])).then((l) => Promise.all(l.map(async (n) => chrome.notifications.create(`qaw-jira|${n.url}`, { type: 'basic', iconUrl: 'icons/icon128.png', title: `${await tw(`options.jira.kind.${n.kind}`, n.kind)} ${n.key}`, message: n.summary })))).catch((err) => QAConsole.warn('jira poll:', err?.message)));
  }
  if (alarm.name === 'qaw-autoidle') return void (await remember.idleStop({ lastEventTs, stopSession, getSession, putSession }));
  // r4-09-2: the time-box is gone; an alarm an older version left behind is dropped when it fires.
  if (alarm.name.startsWith('timebox')) await chrome.alarms.clear(alarm.name);
});

on(chrome.runtime?.onStartup, 'runtime.onStartup › clear active session', () => setActiveSessionId(null));

on(chrome.runtime?.onInstalled, 'runtime.onInstalled › clear active session', () => setActiveSessionId(null));

/* ------------------------------------------------------------- the mark */

/**
 * Sign the console, and hand it a handle.
 *
 * Deferred past the listener registrations above on purpose: MV3 requires every
 * event listener to be registered synchronously during the worker's first turn,
 * and an await before them silently loses events. So the banner reads state
 * afterwards, and the listeners are already in place by the time it does.
 */
installConsoleApi({ handlers, sessionState, armed });

Promise.all([activeSessionId(), armed.armedWindows()])
  .then(([sessionId, windows]) =>
    signConsole({
      version: chrome.runtime.getManifest().version,
      sessionId,
      armedWindows: windows,
    })
  )
  .catch(() => {});

/**
 * T-063: two local rows for the support bundle, never sent and erased by Reset.
 * Read-modify-write without a lock: two ticks in one turn can lose one (a count, not a ledger).
 */
function keepLocal(key, next) {
  return chrome.storage.local.get(key).then((r) => chrome.storage.local.set({ [key]: next(r[key]) })).catch(() => {});
}

// performance.now() in a worker counts from its start, so this is the whole cold boot.
keepLocal('bootMs', (a) => [...(Array.isArray(a) ? a : []), Math.round(performance.now())].slice(-5));

// D-1010-182: once per worker start (a disable then enable fires neither onStartup nor onInstalled), after every listener.
reconcileOnce().catch(() => {}).then(ensureRetentionAlarm).catch(() => {});
