/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Worker lifecycle and housekeeping: per-tab grants, the retention purge, interrupted-session recovery, the retention alarm, the floating window, sleep and the armed announcements. Moved out of service-worker.js (OF-18), unchanged. */

import { withDeadline as bounded } from '../platform/deadline.js';
import * as whitebox from './whitebox.js';
import * as armed from './armed.js';
import { recordingState, closeOffscreen, exportOp } from './media.js';
import {
  getSession, listSessions, sweepOrphanRows, putSession, listMedia, deleteMedia, deleteSession, listOrphanMedia,
  listMediaPending, clearMediaParts, getMedia, assembleMedia, lastEventTs,
} from '../core/db.js';
import { getSettings, hasSidePanel } from '../platform/settings.js';
import { purgePlan, reconcile } from '../core/sessions.js';
import * as remember from './remember.js';
import * as chat from './notify.js';
import { placeFloat } from './float-place.js';
import { QAConsole, activeSessionId, announceL, handlers, liveSessionIds, plural, refreshMenus, tw } from './worker-base.js';
import { maskKey, sendToTab, tellPages } from './worker-tabs.js';
import { appendEvent, countEvents, flushEvents, forgetSession, paintBadge, rememberSession, stopSession } from './worker-session.js';

// B15/F1: no `windows` API on Firefox for Android: the float is a tab, id = tab id + 1e9; any other id is the one browser window.
/** @param {any} T @returns {any} */
function tabWindows(T) {
  const F = 1e9, w = (id, focused = true) => ({ id, focused, state: 'normal' }), here = () => T.query({ active: true }).then(([t]) => t && w(t.windowId));
  return { create: async (o) => { const t = await T.create({ url: o.url, active: true }); return w(o.type === 'popup' ? t.id + F : t.windowId); }, get: async (id) => (id < F ? w(id) : w(id, (await T.get(id - F)).active)), update: async (id, o) => id >= F && o.focused && T.update(id - F, { active: true }), remove: async (id) => id >= F && T.remove(id - F), getCurrent: here, getLastFocused: here };
}
if (!chrome.windows) chrome.windows = tabWindows(chrome.tabs);

/** White-box coverage (CTFL 4.3). */
// D-1010-70: the debugger can be taken away mid-measurement. `debugger` is required; `chrome.debugger` is missing only if a policy removed it.
export const coverageStopping = new Set();

/* Sleep means stop, shut down and reset. */
async function stopMeasureIn(windowId) {
  const id = Number((await chrome.storage.session.get('coverageTab')).coverageTab);
  if ((await chrome.tabs.get(id).catch(() => null))?.windowId !== windowId) return;
  coverageStopping.add(id);
  await bounded(whitebox.ensureDetached(id), 'tab').catch(() => {});
  coverageStopping.delete(id);
  await chrome.storage.session.remove(['coverageTab', 'coverageMode']);
}

export async function sleepWindow(windowId) {
  const did = { clip: null, session: null, grants: 0 };
  if (windowId == null) return did;
  // Before the first stop, and so before the first broadcast one of them fires.
  armed.beginSleep(windowId);

  // 1 — a clip filming this window. `windowId === undefined` means the worker
  // does not know which window owns it, and an unknown owner is treated as
  // possibly this one: leaving a recording running through a sleep is the worse
  // of the two mistakes.
  try {
    const clip = await recordingState();
    if (clip?.recording && !clip.finishing && (clip.windowId === windowId || clip.windowId === undefined)) {
      const meta = await handlers.UQA_RECORD_STOP({ label: 'Stopped by sleep' });
      did.clip = meta?.id || true;
    }
  } catch (err) {
    QAConsole.warn('the clip could not be stopped by sleep:', err);
  }

  // 2 — the session, stopped so its report exists. Never deleted.
  try {
    const activeId = await activeSessionId();
    if (activeId) {
      const session = await getSession(activeId);
      if (session?.windowId === windowId || session?.windowId == null) {
        const stopped = await stopSession();
        did.session = stopped?.id || null;
      }
    }
  } catch (err) {
    QAConsole.warn('the session could not be stopped by sleep:', err);
  }

  // 4, 5 — the page modes, while this window is still armed enough to be told.
  // Masks themselves belong to the session, which has just been stopped; what
  // has to end here is the picking mode a tester may have left switched on.
  await tellWindow(windowId, { type: 'UQA_ARMED_CHANGED', armed: false }).catch(() => {});
  await stopMeasureIn(windowId).catch(() => {});

  await Promise.all(
    [
      { type: 'UQA_MASK_CLEAR' },
      { type: 'UQA_MASK_PICK', off: true },
      { type: 'UQA_ACTIVATE_PICKER', off: true },
      { type: 'UQA_RTL_OFF' },
    ].map((msg) => tellWindow(windowId, msg).catch(() => {}))
  );

  // 3 — the recording grants held by this window's tabs.
  did.grants = await forgetWindowGrants(windowId).catch(() => 0);

  // 6 — the hidden document, and everything it might still be holding.
  await closeOffscreen().catch(() => {});

  // Nothing of this window's session stays in memory: sleep can run with no session at all, and its queued events still count as doing something.
  await flushEvents().catch(() => {});

  // Say what sleep stopped (clip, session) and that both were kept: that is what makes the switch trustworthy.
  announceL('sleep', 'titleAsleep', 'QA Wrap is asleep', 'slept', did).catch(() => {});

  return did;
}

/** Tell everyone the switch moved, without making the caller wait. Errors are swallowed: arming has already happened. */
export function announceArmed(windowId, isArmed) {
  Promise.all([
    tellWindow(windowId, { type: 'UQA_ARMED_CHANGED', armed: isArmed }),
    refreshMenus(),
    // Pages, not tabs (a broadcast reached every window): `tellWindow` above told this window's tabs; `tellPages` repaints our own surfaces.
    tellPages({ type: 'UQA_ARMED_CHANGED', armed: isArmed, windowId }),
  ]).catch(() => {});
}

/** ui-1019: Start is the consent, and the tab the tester moves to carries the one session: its window joins and wakes. */
let focusChain = Promise.resolve(); // serialised: two quick tab switches must not both read the session and overwrite each other's window list
export const followFocus = () => (focusChain = focusChain.then(followFocusOnce, followFocusOnce));
async function followFocusOnce() {
  if ((await liveSessionIds()).length !== 1) return; // one main timeline; several sessions keep a window each
  const [tab] = await chrome.tabs.query({ active: true, windowId: (await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null))?.id }).catch(() => []);
  const s = tab && (await getSession(await activeSessionId()));
  if (!s) return;
  const joined = s.windowId === tab.windowId || (s.windowIds || []).includes(tab.windowId);
  if (joined && (s.focusTabId ?? s.tabId) === tab.id) return;
  const woke = !joined && !(await armed.isArmedWindow(tab.windowId));
  // joinedWindows: the windows followFocus itself woke; Stop puts exactly these back to sleep (runStop).
  const next = { ...s, focusTabId: tab.id, ...(joined ? {} : { windowIds: [...(s.windowIds || []), tab.windowId], ...(woke ? { joinedWindows: [...(s.joinedWindows || []), tab.windowId] } : {}) }) };
  await putSession(next);
  rememberSession(next);
  if (joined) return;
  if (woke) await armed.arm(tab.windowId, { inherit: true });
  announceArmed(tab.windowId, true);
  await tellWindow(tab.windowId, { type: 'UQA_STATE_CHANGED', recording: true });
}

/** Say something to every tab in one window, and nowhere else. */
export async function tellWindow(windowId, msg) {
  const tabs = await chrome.tabs.query({ windowId });
  await Promise.all(tabs.map((t) => (t.id == null ? null : bounded(sendToTab(t.id, msg), 'tab').catch(() => null))));
}

/** Which tabs currently hold Chrome's `activeTab` grant. */
const GRANTED = 'recordableTabs';

export async function grantedTabs() {
  const store = await chrome.storage.session.get(GRANTED);
  return new Set(store[GRANTED] || []);
}

/** Called wherever the user invokes the extension on a tab. */
export async function noteInvoked(tabId) {
  if (tabId == null) return;
  const tabs = await grantedTabs();
  tabs.add(tabId);
  await chrome.storage.session.set({ [GRANTED]: [...tabs] });
}

/** Drop every recording grant held by the tabs of one window. */
export async function forgetWindowGrants(windowId) {
  if (windowId == null) return 0;
  const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
  const ids = new Set(tabs.map((t) => t.id).filter((id) => id != null));
  if (!ids.size) return 0;
  const granted = await grantedTabs();
  let dropped = 0;
  for (const id of ids) if (granted.delete(id)) dropped += 1;
  if (dropped) await chrome.storage.session.set({ [GRANTED]: [...granted] });
  return dropped;
}

/** Called when a tab navigates or closes — Chrome revokes the grant at both. */
export async function forgetInvoked(tabId) {
  if (tabId == null) return;
  const tabs = await grantedTabs();
  if (!tabs.delete(tabId)) return;
  try {
    await chrome.storage.session.set({ [GRANTED]: [...tabs] });
  } catch (err) {
    // Tabs close one by one while the browser shuts down and session storage is
    // discarded anyway, so that one rejection is not worth a warning.
    if (!/shutting down/i.test(String(err?.message ?? err))) throw err;
  }
}

/** Delete finished sessions past the retention window: media first and by id (no orphaned clip), a running session never. */
export async function purgeExpired() {
  const settings = await getSettings();
  const days = Number(settings?.retentionDays || 0);
  // r2-06-1: orphan rows go whatever the window.
  const liveIds = (await listSessions()).map((x) => x.id);
  await sweepOrphanRows(liveIds).catch(() => {});
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : -1;
  await sweepPendingMedia(cutoff, await recordingState().catch(() => null), new Set(liveIds));
  if (!days) return { purged: 0, failed: 0, keptForever: true };

  const running = await activeSessionId();
  const sessions = await listSessions();
  let purged = 0;
  let failed = 0;

  const plan = purgePlan(sessions, { days, running }); // rule 5: kept sessions are skipped; one told a week ahead is taken
  await remember.warnPurge(plan.warn, { putSession, rememberSession, say: async (n) => chat.announce('session', await tw('common.worker.note.titleSession', 'Session finished'), (await tw('common.worker.note.purgeSoon', '{n} saved tests will be deleted in 7 days. Open one and press Keep to save it.')).replace('{n}', String(n))) }).catch((e) => QAConsole.warn('could not announce the purge notice:', e));
  for (const session of plan.purge) {
    // r2-06-2: one failure must not strand the rest.
    try {
      for (const media of await listMedia(session.id)) await deleteMedia(media.id);
      await deleteSession(session.id);
      forgetSession(session.id);
      await chrome.storage.session.remove(maskKey(session.id));
      purged += 1;
    } catch (err) {
      failed += 1;
      console.warn('[uqa] retention: could not delete', session.id, err?.code || err?.message || err);
    }
  }
  /*
   * Clips that belong to no session at all.
   */
  const live = new Set((await listSessions()).map((x) => x.id));
  const clip = await recordingState().catch(() => null);
  let orphans = 0;
  for (const media of await listOrphanMedia(live).catch(() => [])) {
    if (clip?.recording && clip.id === media.id) continue;
    if ((media.ts || 0) > cutoff) continue;
    await deleteMedia(media.id).catch(() => {});
    orphans += 1;
  }

  if (purged) QAConsole.info(`retention: ${plural(purged, 'session')} older than ${days} days deleted`);
  if (orphans) QAConsole.info(`retention: ${plural(orphans, 'unfiled recording')} older than ${days} days deleted`);
  return { purged, failed, orphans, days };
}

/** r4-03-6: recording parts a clip left behind age out with the retention window; the clip being recorded is exempt. */
async function sweepPendingMedia(cutoff, clip, live) {
  for (const row of await listMediaPending().catch(() => [])) {
    const gone = row.sessionId && row.sessionId !== 'unfiled' && !live.has(row.sessionId);
    if ((row.startedAt < cutoff || gone) && !(clip?.recording && clip.id === row.id)) await clearMediaParts(row.id).catch(() => {});
  }
}

/** Recover clips a crash left half-written. */
export async function recoverPendingClips() {
  const clip = await recordingState().catch(() => null);
  const pending = await listMediaPending().catch(() => []);
  let recovered = 0;
  for (const row of pending) {
    if (clip?.recording && clip.id === row.id) continue;
    try {
      // Already assembled (killed between the two writes): the finished clip stays, only the leftovers go (r3-06-1).
      if (await getMedia(row.id)) { await clearMediaParts(row.id); continue; }
      const stored = await assembleMedia({
        id: row.id,
        sessionId: row.sessionId || 'unfiled',
        kind: 'recording',
        label: `${row.label || 'Screen recording'} (recovered)`,
        type: row.type || 'video/webm',
        ext: row.ext || 'webm',
        durationMs: 0,
        ts: row.startedAt || Date.now(),
        sources: row.sources || { tab: true },
        /** A recovered companion is recovered as a companion. */
        ...(row.role ? { role: row.role, parentId: row.parentId || null } : {}),
        ...(row.webcam ? { webcam: row.webcam } : {}),
        // The pair as recorded: a recovered clip was not baked, so the reference is kept even if the companion is lost.
        ...(row.role ? {} : { webcamTrackId: row.webcamTrackId ?? null }),
        incomplete: 'The browser stopped before this clip was finished; what was written to disk is here.',
        blob: null,
      });
      recovered += 1;
      if (stored.sessionId && stored.sessionId !== 'unfiled' && (await getSession(stored.sessionId))) {
        await appendEvent({
          sessionId: stored.sessionId,
          kind: 'recording',
          ts: stored.ts,
          mediaId: stored.id,
          label: stored.label,
          durationMs: 0,
          bytes: stored.bytes,
          mediaType: stored.type,
          sources: stored.sources,
        });
      }
    } catch (err) {
      // Nothing usable was written (code EMPTY): drop the marker so the next boot does not try again
      // for ever. Any other failure (quota, a locked database) keeps the parts and the marker for the next boot.
      if (err?.code === 'EMPTY') await clearMediaParts(row.id).catch(() => {});
    }
  }
  if (recovered) QAConsole.info(`recovered ${plural(recovered, 'interrupted recording')}`);
  return { recovered };
}

/**
 * Close the sessions a crash left open. Only `stopSession()` writes `endedAt`, so a killed Chrome leaves `status: 'recording'`
 * rows that `purgeExpired()` skips. Registered before the purge pair and awaited through `reconcileOnce()`; the decision is
 * `reconcile()` in `core/sessions.js` (tools/test-sessions.mjs).
 */
async function reconcileInterrupted() {
  // The active id lives in `chrome.storage.session`, which a crash clears; it only spares a plain worker restart mid-recording.
  const running = new Set(await liveSessionIds()); // r7-06-1
  const sessions = await listSessions();
  const bornBefore = Date.now() - performance.now() - 5000; // D-211: a session born after this worker is live, not stranded
  const stranded = sessions.filter((s) => s?.status === 'recording' && !s.endedAt && !running.has(s.id) && !(Number(s.startedAt) > bornBefore));
  await sweepOrphanRows(sessions.map((x) => x.id)).catch(() => {}); // r2-06-1
  if (!stranded.length) return { reconciled: 0 };

  const lastTsById = new Map();
  for (const session of stranded) lastTsById.set(session.id, await lastEventTs(session.id));

  const closed = reconcile(sessions, lastTsById, running, bornBefore);
  for (const session of closed) {
    await putSession(session);
    rememberSession(session);
  }
  await remember.noteInterrupted(closed, countEvents).catch((e) => QAConsole.warn('could not record the interrupted sessions:', e)); // rule 5: the first popup open shows one card
  if (closed.length) {
    QAConsole.info(`${plural(closed.length, 'session')} ${closed.length === 1 ? 'was' : 'were'} interrupted and ${closed.length === 1 ? 'has' : 'have'} been closed; retention can now reach them`);
  }
  return { reconciled: closed.length };
}

/** One reconciliation pass per worker lifetime: `onStartup`, `onInstalled` and the retention sweep share it. */
let reconcilePass = null;

export const reconcileOnce = () => (reconcilePass ??= reconcileInterrupted());

/**
 * Arm the daily retention sweep, once per profile, not once per worker start.
 */
export async function ensureRetentionAlarm() {
  if (!(await chrome.alarms?.get?.('qaw-update'))) chrome.alarms?.create?.('qaw-update', { delayInMinutes: 1, periodInMinutes: 24 * 60 });
  const existing = await chrome.alarms?.get?.('retention');
  if (existing) return existing;
  return chrome.alarms?.create?.('retention', { periodInMinutes: 24 * 60 });
}

export async function checkUpdates() { // update check, run in the offscreen page: a minute after start, then daily
  const s = { ...(await chrome.storage.local.get(['checkUpdates', 'qawUpdate', 'qawUpdateToken'])), ...(await chrome.storage.session.get('qawUpdateDismissed')) }; const r = s.checkUpdates === false ? null : await exportOp('update', { state: s.qawUpdate, token: s.qawUpdateToken }).catch(() => null);
  if (r) { await chrome.storage.local.set({ qawUpdate: r }); await chrome.storage.session.set({ 'uqa.updateNew': !!r.latest && r.latest.version !== s.qawUpdateDismissed }); await paintBadge(); } // paintBadge keeps the session badge first; NEW only when idle
}

// Icon toggles a floating window ("Dock to the side" uses the panel); placement and its
// 560x720 size: float-place.js (a `{ width, height }` size here once made every click NaN).

async function displayWorkAreas() {
  if (!chrome.system?.display?.getInfo) return [];
  try {
    return (await chrome.system.display.getInfo()).map((d) => d.workArea);
  } catch {
    return [];
  }
}

/** What the toolbar icon does follows Settings, and Chrome does it itself: a worker that awaits (a settings read, a window lookup) before `sidePanel.open()` has already lost the click's gesture, so the panel never opened. */
export const syncPanelBehavior = async () => { try { if (hasSidePanel()) await chrome.sidePanel.setPanelBehavior?.({ openPanelOnActionClick: (await getSettings()).launchSurface === 'panel' }); } catch { /* a failed settings read must not become an unhandled rejection (the error badge); the next change syncs again */ } };

export async function floatWindow() {
  const { floatWindowId } = await chrome.storage.session.get('floatWindowId');
  if (floatWindowId == null) return null;
  return chrome.windows.get(floatWindowId).catch(() => null);
}

export async function openFloat(anchorWindowId) {
  const { floatBounds, floatBoundsV } = await chrome.storage.local.get(['floatBounds', 'floatBoundsV']);
  const anchor = anchorWindowId != null ? await chrome.windows.get(anchorWindowId).catch(() => null) : null;
  const workAreas = await displayWorkAreas();
  const placed = placeFloat({
    stored: floatBounds ? { ...floatBounds, floatBoundsV } : null,
    anchor,
    workAreas,
  });
  if (placed.migrate) {
    // Separate key: onBoundsChanged overwrites floatBounds wholesale.
    await chrome.storage.local.set({
      floatBounds: { left: placed.left, top: placed.top, width: placed.width, height: placed.height },
      floatBoundsV: 2,
    });
  }
  const create = (bounds) =>
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/popup.html?surface=float'),
      type: 'popup',
      width: bounds.width,
      height: bounds.height,
      ...(bounds.left != null ? { left: Math.round(bounds.left) } : {}),
      ...(bounds.top != null ? { top: Math.round(bounds.top) } : {}),
      focused: true,
    });
  // Retry with no position: a stored spot Chrome rejects (monitor unplugged).
  const win = await create(placed).catch(() => create({ width: placed.width, height: placed.height }));
  // Chrome run with --window-size opens a popup at that size, whatever was asked, and can take the first correction back: ask again.
  const off = (w) => Math.abs(w.width - placed.width) > 8 || Math.abs(w.height - placed.height) > 8;
  for (let i = 0; i < 3; i++) {
    const w = await chrome.windows.get(win.id).catch(() => null);
    if (!w || !off(w)) break;
    await chrome.windows.update(win.id, { width: placed.width, height: placed.height, ...(placed.left != null ? { left: Math.round(placed.left), top: Math.round(placed.top) } : {}) }).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  }
  await chrome.storage.session.set({ floatWindowId: win.id });
  return win;
}
