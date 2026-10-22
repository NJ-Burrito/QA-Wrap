/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Message handlers for the extension itself: settings, the armed switch, and the browser (viewport runs, windows). Moved out of service-worker.js (OF-18), unchanged. */

import { getSettings, redact as maskSecrets, publicSettings, setSettings, resetSettings, policy } from '../platform/settings.js';
import { vaultState, setPass, unlockVault, lockVault, forgetVault } from '../platform/vault.js';
import { resetLocalKeys, quotaWarn } from '../core/store-registry.js';
import { recordingState, storagePersistence, viewports, viewportById, crossBrowserProject, runCommand } from './media.js';
import { listSessions, listMedia, eraseEverything, getSession, putSession } from '../core/db.js';
import { sessionFootprint, ERASABLE_STORES, eraseKeys, ERASABLE_LOCAL_KEYS, viewportRuns } from '../core/sessions.js';
import * as armed from './armed.js';
import * as site from './site-access.js';
import * as sessionState from './session-state.js';
import { LAST, activeSessionId, coded, currentWindowId, hintFor, isInternalUrl, tw } from './worker-base.js';
import { broadcast, isExtensionPage, maskKey, openOwnPage, sendToFeature, sendToTab, tellPages, testableTabId } from './worker-tabs.js';
import {
  appendEvent, clampWindowSize, closeViewportRuns, draft, flushEvents, mustSession, noteUse, paintBadge,
  rememberSession, viewportEvents,
} from './worker-session.js';
import { captureScreenshot } from './worker-scans.js';
import { announceArmed, forgetWindowGrants, sleepWindow, tellWindow } from './worker-lifecycle.js';

/** Settings, erasure, shortcuts, and the extension’s own pages. */
export const settingsHandlers = {
  UQA_GET_SETTINGS: async (msg, sender) => {
    if (msg?.jira) return site.jiraPage(msg.jira, sender); // the Jira helper's own keys, for its own host (site-access.js)
    const all = await getSettings();
    return !sender || isExtensionPage(sender) ? maskSecrets(all) : publicSettings(all);
  },
  UQA_SET_SETTINGS: async (msg) => {
    const next = await setSettings(msg.patch || {});
    // The save is done; telling the pages is a courtesy and must never hold the answer back.
    broadcast({ type: 'UQA_SETTINGS_CHANGED', settings: next }).catch(() => {});
    return maskSecrets(next);
  },
  // The passphrase lock. The page derives the key (PBKDF2); the worker only ever holds and checks it.
  UQA_VAULT_STATE: () => vaultState(),
  UQA_VAULT_PASS: async (msg) => (await setPass(msg.key, msg.salt, msg.iters, msg.idle), vaultState()),
  UQA_VAULT_UNLOCK: async (msg) => (await unlockVault(msg.key), vaultState()),
  UQA_VAULT_LOCK: async () => (await lockVault(), vaultState()),
  UQA_VAULT_FORGET: async () => (await forgetVault(), vaultState()),
  UQA_RESET_SETTINGS: async () => {
    /*
     * The queue first, always.
     *
     * A reset that lands while events are still queued repaints every surface
     * from the new settings and then the queue writes the old world underneath
     * it. Nothing here touches sessions — a tester resetting their preferences
     * is not asking to lose their work, and saying so in the button is not
     * enough on its own.
     */
    await flushEvents();
    const next = await resetSettings();
    await chrome.storage.local.remove(resetLocalKeys()).catch(() => {}); // T-063: the boot times and the use count go with the ring
    broadcast({ type: 'UQA_SETTINGS_CHANGED', settings: next }).catch(() => {});
    broadcast({ type: 'UQA_STATE_CHANGED' }).catch(() => {});
    return maskSecrets(next);
  },

  /**
   * Everything the tester recorded, gone, because they asked twice.
   *
   * The confirmation is the surface's job (Settings types the word); the worker makes it total: write queue flushed first,
   * every store a clip can be in, the mask lists and last-session pointer in `chrome.storage.session`, and a refusal while a
   * session is running.
   */
  UQA_ERASE_ALL: async () => {
    if (await activeSessionId()) {
      throw new Error('A session is still running. Stop it first, then erase.');
    }
    const clip = await recordingState().catch(() => null);
    if (clip?.recording) throw new Error('A recording is still running. Stop the clip first, then erase.');

    await flushEvents();
    const sessions = await listSessions();
    // `companions: true`: this is a byte count, not a clip count. A webcam
    // track is not its own card, but it is certainly its own megabytes, and a
    // figure the tester is deciding whether to clear must not be short of them.
    const media = (
      await Promise.all(sessions.map((x) => listMedia(x.id, { companions: true }).catch(() => [])))
    ).flat();
    const before = sessionFootprint(sessions, media);

    const out = await eraseEverything(ERASABLE_STORES);
    await chrome.storage.session.remove(eraseKeys(sessions.map((x) => x.id))).catch(() => {});
    // The retention sweep's bookkeeping goes with it: it counts what it has
    // purged, and after this there is nothing it has ever seen.
    await chrome.storage.local.remove(['lastPurgeAt', 'purgeLog', ...ERASABLE_LOCAL_KEYS]).catch(() => {});

    await broadcast({ type: 'UQA_STATE_CHANGED' });
    await broadcast({ type: 'UQA_SESSIONS_ERASED', erased: before });
    return { ...before, ...out };
  },

  /** How much the tester is holding, for the Settings line that offers to clear it. */
  UQA_SESSION_FOOTPRINT: async () => {
    const sessions = await listSessions();
    // Bytes, so companions are counted. See the note in UQA_ERASE_ALL.
    const media = (
      await Promise.all(sessions.map((x) => listMedia(x.id, { companions: true }).catch(() => [])))
    ).flat();
    // Whether the browser has promised to keep any of it. Asked once, at the
    // first session start; read here, never asked again from a paint.
    const est = await navigator.storage?.estimate?.().catch(() => null);
    return { ...sessionFootprint(sessions, media), totalBytes: est?.usage || 0, quotaWarn: quotaWarn(est), persistence: await storagePersistence() };
  },
  UQA_COMMANDS: () => chrome.commands.getAll(),
  UQA_OPEN_SHORTCUTS: async () => {
    // Extensions may not set command shortcuts programmatically; opening
    // Chrome's own editor is the supported route.
    await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    return true;
  },
  UQA_OPEN_REPORT: async (msg) => {
    // Showing the report beats silently writing a file the tester never finds.
    const id = msg.sessionId || (await chrome.storage.session.get(LAST))[LAST];
    // `report.js:1728` picks its opening tab from the fragment, so a caller
    // that knows which tab it means can say so and land there. Whitelisted,
    // because this string goes into a URL.
    const TABS = ['overview', 'broke', 'timeline', 'media', 'quality', 'file', 'raw'];
    const hash = TABS.includes(msg.tab) ? `#${msg.tab}` : '';
    return openOwnPage(
      `report/report.html?session=${encodeURIComponent(id || '')}&format=${encodeURIComponent(msg.format || 'markdown')}${hash}`
    );
  },
  UQA_OPEN_OPTIONS: async () => {
    await chrome.runtime.openOptionsPage();
    return true;
  },
};

/** The master switch: which windows this extension is awake in. */
export const armedHandlers = {
  /* ---- the master switch ---------------------------------------------- */
  UQA_ARMED: async (msg, sender) => {
    const windowId = msg.windowId ?? (await askingAboutWindow(sender));
    return {
      windowId,
      armed: await armed.isArmedWindow(windowId),
      windows: await armed.armedWindows(),
    };
  },
  /** Where this extension has been let in, and where it is standing right now. */
  UQA_SITE_ACCESS: async (msg, sender) => {
    const tabId = msg.tabId ?? (await testableTabId(sender));
    const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
    const url = tab?.url || '';
    const settings = await getSettings().catch(() => null);
    const [granted, origins] = await Promise.all([
      site.hasSiteAccess(url),
      site.grantedOrigins(),
    ]);
    return {
      url,
      tabId,
      pattern: site.originPattern(url) || (site.isPracticeUrl(url) ? 'practice' : null),
      granted,
      origins,
      policy: settings?.policy?.hostPermissionsPolicy ?? 'ask',
    };
  },

  /** The tester has just said yes. Make the browser agree before Wake returns. */
  UQA_SITE_GRANTED: async (msg, sender) => {
    const windowId = msg.windowId ?? (await currentWindowId(sender));
    const { matches } = await site.syncSiteScripts();
    const injected = await site.injectSiteScripts(windowId);
    await armed.syncHooks({ inject: true });
    return { matches, injected, origins: await site.grantedOrigins() };
  },

  /* ---- the consent this product may not run without --------------------- */

  /**
   * Has the first-run notice been read and accepted, and when?
   *
   * The store's rule (`research/51d` section 1, FAQ Q10) is that prominent
   * disclosure and consent live **in the product's UI**, with a specific
   * affirmative action; a store description and a privacy policy do not count.
   * So this is a gate rather than a greeting: until `consentedAt` is set the
   * popup shows the consent card and nothing else.
   */
  UQA_CONSENT: async () => {
    const { consentedAt = null, consentVersion = null } = await chrome.storage.local.get([
      'consentedAt',
      'consentVersion',
    ]);
    const p = await policy();
    return { consentedAt, consentVersion, consented: !!consentedAt && (await armed.consentCurrent()), consentUrl: p.consentMode === 'organisation' ? p.consentUrl : '' };
  },

  /** The affirmative action, recorded with the build it was given for. */
  UQA_CONSENT_ACCEPT: async () => {
    const consentedAt = Date.now();
    const consentVersion = chrome.runtime.getManifest().version;
    await chrome.storage.local.set({ consentedAt, consentVersion, consentRevision: armed.CONSENT_REVISION });
    return { consentedAt, consentVersion, consented: true };
  },

  /** Settings' "Show the welcome page again", and the first-run open itself. */
  UQA_OPEN_WELCOME: async () => openOwnPage('welcome/welcome.html'),

  UQA_ARM: async (msg, sender) => {
    const windowId = msg.windowId ?? (await currentWindowId(sender));
    if (windowId == null) throw new Error('No window to wake up.');
    // Waking starts from nothing: no session, clip or grants come back from a previous arming.
    try {
      await armed.assertMayRecord({ windowId }, { consent: true });
    } catch (err) {
      if (err?.code === 'NEEDS_CONSENT') throw coded(await tw('common.worker.needsConsent', err.message), err.code);
      throw err;
    }
    await forgetWindowGrants(windowId).catch(() => {});
    const list = await armed.arm(windowId);
    // Hooks read settings once at load; hand them the current ones on wake.
    const settings = await getSettings().catch(() => null);
    if (settings) tellWindow(windowId, { type: 'UQA_SETTINGS_CHANGED', settings }).catch(() => {});
    tellWindow(windowId, { type: 'UQA_SESSION_RESET' }).catch(() => {});
    // Announce, do not wait: one slow tab must not close the port before the caller hears yes.
    announceArmed(windowId, true);
    return { windowId, armed: true, windows: list };
  },
  UQA_DISARM: async (msg, sender) => {
    const windowId = msg.windowId ?? (await currentWindowId(sender));
    if (windowId == null) throw new Error('No window to put to sleep.');
    // Everything stops, and everything that stopped is saved. See sleepWindow.
    const did = await sleepWindow(windowId);
    const list = await armed.disarm(windowId);
    announceArmed(windowId, false);
    return { windowId, armed: false, windows: list, stopped: did };
  },

  /**
   * Every window at once — the panic switch.
   *
   * Each window is put to sleep in full, not merely forgotten: a `disarmAll`
   * that only cleared the list left exactly the running clip and live crosshair
   * that `UQA_DISARM` was fixed to stop.
   */
  UQA_DISARM_ALL: async () => {
    const windows = await armed.armedWindows();
    const stopped = [];
    for (const windowId of windows) {
      stopped.push({ windowId, ...(await sleepWindow(windowId)) });
      announceArmed(windowId, false);
    }
    await armed.disarmAll();
    // The pages, which have no window of their own to be told through.
    await tellPages({ type: 'UQA_ARMED_CHANGED', armed: false });
    return { windows: [], stopped };
  },
};

/** `vr_<base36 time>_<2 base36 chars>`. Opaque to E and F; see §3. */
function newRunId() {
  return `vr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 4)}`;
}

/**
 * What this run copied from its parent, decided once, here, at creation.
 *
 * "Decided by the worker" is the load-bearing half: the popup cannot see
 * whether a clip is running without a second round trip, and a second round
 * trip is a second chance for the sentence on screen to disagree with what
 * happened.
 */
async function inheritanceFor(sessionId, { mode = 'window', sources = null } = {}) {
  const inherited = { video: false, mask: false, mic: false, tabAudio: false };
  const refused = [];

  if (!sessionId) {
    refused.push('mask');
    return { inherited, refused };
  }

  const store = await chrome.storage.session.get(maskKey(sessionId));
  inherited.mask = (store[maskKey(sessionId)] || []).length > 0;

  if (mode === 'resized') {
    // Nothing was opened, so nothing can be refused: same tab, same window, the one unbroken clip, so every source it holds is still in it.
    inherited.video = true;
    inherited.mic = !!sources?.mic;
    inherited.tabAudio = !!sources?.tabAudio;
    return { inherited, refused };
  }

  const clip = await recordingState().catch(() => null);
  if (clip?.recording && !clip.finishing) {
    // Reached only when a clip is running in a *different* window from the tab
    // under test: this run has to open its own window, and a window this
    // extension opened is one `chrome.tabCapture` will not film. See the note
    // above the two routes.
    inherited.video = false;
    refused.push('video');
    // One camera cannot be in two clips, and a second window seizing it would
    // stop the parent's clip mid-recording. Refused by name, per §5.
    if (clip.sources?.webcam) refused.push('webcam');
    if (clip.sources?.mic) inherited.mic = false;
    if (clip.sources?.tabAudio) inherited.tabAudio = false;
  }

  return { inherited, refused };
}

const SIZE_TOLERANCE = 2;

/**
 * What the page inside a window is actually given, measured in the page.
 *
 * `settle` is there because a window that has just been created or resized has
 * not laid out yet, and a measurement taken before it has is a measurement of
 * the previous size.
 */
async function innerSizeOf(tabId, settle = 350) {
  if (tabId == null) return null;
  await new Promise((resolve) => setTimeout(resolve, settle));
  const got = await chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => ({
        w: window.innerWidth,
        h: window.innerHeight,
        sw: window.screen?.availWidth || 0,
        sh: window.screen?.availHeight || 0,
      }),
    })
    .then(([r]) => r?.result)
    .catch(() => null) // a new window's page has no host grant: the tab's own width and height need none
    || (await chrome.tabs.get(tabId).then((t) => ({ w: t.width, h: t.height, sw: 0, sh: 0 }), () => null));
  return got && got.w > 0 && got.h > 0 ? got : null;
}

/**
 * Put a window at a viewport size, and report the size it really got. Used by both routes. Ask (clamped), measure, distrust
 * a measurement bigger than its window, correct once from the real outer size, measure again; `exact` says whether the size
 * asked for was reached. `exact: false` is not an error: it is the answer a broken breakpoint hides behind.
 */
async function fitWindowTo(windowId, tabId, spec) {
  const first = await innerSizeOf(tabId, 120);
  const screen = first && first.sw > 0 ? { w: first.sw, h: first.sh } : null;

  await chrome.windows
    .update(windowId, clampWindowSize(spec.width, spec.height, screen))
    .catch(() => {});

  let inner = await innerSizeOf(tabId);
  const outer = await chrome.windows.get(windowId).catch(() => null);
  // Step 3. A page cannot be wider than the window around it.
  if (inner && outer && ((outer.width > 0 && inner.w > outer.width) || (outer.height > 0 && inner.h > outer.height))) {
    inner = null;
  }

  if (inner && outer?.width > 0 && (inner.w !== spec.width || inner.h !== spec.height)) {
    const want = clampWindowSize(
      outer.width + (spec.width - inner.w),
      outer.height + (spec.height - inner.h),
      screen
    );
    await chrome.windows.update(windowId, want).catch(() => {});
    inner = (await innerSizeOf(tabId)) || inner;
  }

  const measured = inner ? { w: inner.w, h: inner.h } : null;
  const exact =
    !!measured &&
    Math.abs(measured.w - spec.width) <= SIZE_TOLERANCE &&
    Math.abs(measured.h - spec.height) <= SIZE_TOLERANCE;
  return { measured, exact };
}

/**
 * Open a run: mint it, widen the session to cover the new window, record it.
 *
 * The `windowIds` line is what makes everything else work. `belongsToSession`
 * matches one window id, so without it every click, request and console error
 * in the new window was sanitised, matched, and discarded as "other-tab".
 */
async function openViewportRun({
  sessionId, windowId, tabId, url, viewport, measured,
  exact = true, mode = 'window', clip = null, restore = null, sources = null,
}) {
  if (!sessionId) return null;
  const session = await getSession(sessionId);
  if (!session) return null;

  /*
   * A second size on the same window replaces the first.
   */
  let bounds = restore;
  if (mode === 'resized') {
    const already = viewportRuns(await viewportEvents(sessionId)).filter(
      (r) => r.mode === 'resized' && r.windowId === windowId && !r.closedAt
    );
    if (already.length) {
      bounds = already[0].restore || bounds;
      await closeViewportRuns({ sessionId, windowId, reason: 'closed', mode: 'resized', restoreBounds: false });
    }
  }

  const { inherited, refused } = await inheritanceFor(sessionId, { mode, sources });
  const run = {
    id: newRunId(),
    sessionId,
    tabId,
    startedAt: Date.now(),
    mode,
    inherited,
    refused,
  };

  const windowIds = [...new Set([...(session.windowIds || []), windowId])];
  const widened = { ...session, windowIds };
  await putSession(widened);
  rememberSession(widened);

  await appendEvent({
    sessionId,
    kind: 'viewport',
    phase: 'opened',
    ts: run.startedAt,
    runId: run.id,
    windowId,
    tabId,
    url,
    viewport: { id: viewport.id, label: viewport.label, width: viewport.width, height: viewport.height },
    measured: measured || null,
    // Whether the browser actually gave the size asked for. `measured` alone
    // was not enough: a caller that only looked at `ok` read a clamped 502 as a
    // successful 768.
    exact: !!exact,
    // 'window' — a window this worker opened. 'resized' — the session's own
    // window, resized in place so the clip that is already running keeps it.
    mode,
    // Where in the session's clip this run is, when it is inside one.
    clip:
      mode === 'resized' && clip?.startedAt
        ? {
            mediaId: clip.mediaId || null,
            startedAt: clip.startedAt,
            offsetMs: Math.max(0, run.startedAt - clip.startedAt),
          }
        : null,
    // The bounds to put back at the end, kept on the event because MV3 tears
    // this worker down between the resize and the restore.
    restore: bounds,
    inherited,
    refused,
  });
  paintBadge();
  await broadcast({ type: 'UQA_VIEWPORT_CHANGED', runId: run.id, phase: 'opened', sessionId });
  return run;
}

/** Cross-browser: viewports, projects, and layout stress. */
export const browserHandlers = {
  /* ---- cross-browser -------------------------------------------------- */

  UQA_VIEWPORTS: () => viewports(),

  /** Check the page at another size, in this window or in a new one. */
  UQA_OPEN_VIEWPORT: async (msg) => {
    const spec = await viewportById(msg.viewport);
    if (!spec) throw new Error(`Unknown viewport: ${msg.viewport}`);

    const tabId = msg.tabId ?? (await testableTabId());
    const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
    const url = msg.url || tab?.url;
    if (!url || isInternalUrl(url)) throw new Error('Open the page you want to check first.');

    // `inherit` defaults true; `false` is a plain window with no run attached,
    // and a plain window is never the tester's own window.
    const sessionId = msg.inherit === false ? null : await activeSessionId({ tabId });
    const clip = sessionId ? await recordingState().catch(() => null) : null;
    const filming = !!(clip?.recording && !clip.finishing);
    const resizeInPlace =
      filming && tab?.windowId != null && clip.windowId === tab.windowId && tab.id != null;

    if (resizeInPlace) {
      const windowId = tab.windowId;
      const before = await chrome.windows.get(windowId).catch(() => null);
      // A maximized or full-screen window ignores width and height. It is
      // brought back to a normal window first, and which it was is remembered
      // so the restore puts it back the way the tester had it.
      if (before?.state && before.state !== 'normal') {
        await chrome.windows.update(windowId, { state: 'normal' }).catch(() => {});
      }
      const restore = before
        ? {
            left: before.left, top: before.top,
            width: before.width, height: before.height,
            state: before.state || 'normal',
          }
        : null;

      const { measured, exact } = await fitWindowTo(windowId, tab.id, spec);
      await noteUse('viewport', { viewport: spec.id }, { tabId: tab.id });

      const run = await openViewportRun({
        sessionId, windowId, tabId: tab.id, url,
        viewport: spec, measured, exact,
        mode: 'resized',
        clip: { mediaId: clip.id || null, startedAt: clip.startedAt || null },
        restore,
        sources: clip.sources || null,
      });
      return { windowId, viewport: spec, measured, exact, mode: 'resized', run };
    }

    const created = await chrome.windows.create({
      url,
      type: 'normal',
      focused: true,
      ...clampWindowSize(spec.width, spec.height, null),
    });

    // The tester was awake when they asked for this window, and it exists to
    // carry the same session on at another size. Left asleep, the first thing
    // they met there was "Wake it up" — a switch they had already thrown.
    if (created?.id != null) {
      await armed.arm(created.id, { inherit: true });
      announceArmed(created.id, true);
    }

    // Measure what the page actually got and correct once. The difference is
    // the browser chrome, and it varies by platform, by theme and by whether a
    // bookmarks bar is showing — so it is measured rather than assumed.
    const openedTab = created.tabs?.[0];
    const { measured, exact } = await fitWindowTo(created.id, openedTab?.id ?? null, spec);

    // Arm it, or the tester opens a window in which nothing works and has to
    // find out why. A window this extension created for testing is a window the
    // tester asked for.
    if (await armed.isArmedTab(tabId)) await armed.arm(created.id, { inherit: true });
    await noteUse('viewport', { viewport: spec.id }, { tabId });

    const run = await openViewportRun({
      sessionId,
      windowId: created.id,
      tabId: openedTab?.id ?? null,
      url,
      viewport: spec,
      measured,
      exact,
      mode: 'window',
    });

    return { windowId: created.id, viewport: spec, measured, exact, mode: 'window', run };
  },

  /**
   * Put the window back to the size it was before "Check another size".
   *
   * The other half of resizing in place. A run that opened its own window ends
   * when the tester shuts it; a run that resized theirs has no window to shut,
   * so without this the only ways out were to stop the session or to pick a
   * different size — which is a trap rather than a feature.
   */
  UQA_RESTORE_WINDOW_SIZE: async (msg, sender) => {
    const sessionId = msg.sessionId || (await activeSessionId(sender));
    if (!sessionId) return { closed: 0 };
    const closed = await closeViewportRuns({
      sessionId,
      windowId: msg.windowId ?? null,
      mode: 'resized',
      reason: 'closed',
    });
    return { closed };
  },

  /**
   * Every window-size run of one session, folded from the two events.
   *
   * §8 of the contract: the events are the source of truth and this is only
   * ever allowed to be a fold over them. Built rather than left to the report
   * because the fold needs the whole event stream, and the worker is already
   * holding it.
   */
  UQA_VIEWPORT_RUNS: async (msg, sender) => {
    const sessionId = msg.sessionId || (await activeSessionId(sender));
    if (!sessionId) return [];
    return viewportRuns(await viewportEvents(sessionId));
  },

  /**
   * The runnable project for the engines this browser is not.
   *
   * Files, not a zip: the caller writes them into the category tree, where a
   * folder of readable files beats an archive nobody unpacks.
   */
  UQA_CROSS_BROWSER: async (msg) => {
    const session = await mustSession(msg.sessionId);
    const spec = await draft('playwrightSpec', { sessionId: msg.sessionId });
    return {
      files: await crossBrowserProject(session, spec, { title: msg.title }),
      command: await runCommand(),
      note:
        'A browser extension cannot start another browser. Playwright can, and it ships real ' +
        'Firefox and WebKit builds, so this is the project to run rather than an emulation.',
    };
  },

  UQA_TICKET_TITLE: async (msg) => {
    const session = await getSession(msg.sessionId);
    return session ? draft('ticketTitle', { sessionId: msg.sessionId }) : null;
  },
  UQA_CAPTURE_TAB: (msg) => captureScreenshot(msg),
  /**
   * Layout stress, remembered.
   */
  UQA_TOGGLE_RTL: async (msg, sender) => {
    const res = await sendToFeature(msg.tabId ?? sender?.tab?.id ?? (await testableTabId()), 'rtl', {
      type: 'UQA_TOGGLE_RTL',
      options: msg.options,
    });
    if (res) {
      await sessionState.setState(await activeSessionId(hintFor(msg, sender)), { rtl: !!res.enabled });
      if (res.enabled) await noteUse('rtl');
    }
    return res;
  },
  UQA_RTL_STATE: async (msg) => sendToTab(msg.tabId ?? (await testableTabId()), { type: 'UQA_RTL_STATE' }),
};

/**
 * Which window an "am I awake?" question is really about. `currentWindowId` answers `sender.tab.windowId` first, wrong for the
 * extension's own surfaces (the float's tab is a never-armed window). Matched on the extension's own URL, not the literal
 * `chrome-extension:` scheme (the Gecko build serves `moz-extension:`).
 */
async function askingAboutWindow(sender) {
  const ownOrigin = chrome.runtime.getURL('');
  if (sender?.url?.startsWith(ownOrigin)) {
    const tabId = await testableTabId(sender);
    const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
    if (tab?.windowId != null) return tab.windowId;
  }
  return currentWindowId(sender);
}
