/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Sessions and their event store: the write queue, appending and counting events, start and stop, the active-session map, the badge, notes, rules, and the Jira filing that a stop can trigger. Moved out of service-worker.js (OF-18), unchanged. */

import * as sessionState from './session-state.js';
import {
  appendEvents, countEvents as countEventsRaw, seedStats, getSession, putSession, appendEvent as appendEventNow,
  countFailures as countFailuresRaw, getEventsByKind as readEventsByKindRaw, getEvents as readEventsRaw,
  getEventsSince as readEventsSinceRaw, putSessionWithEvents, listMedia,
} from '../core/db.js';
import { ROW_CAP, BODY_CAP, createWriteQueue, isTesterRow } from './write-queue.js';
import * as remember from './remember.js';
import { carriesFinding, foldFinding, BLANK_FINDINGS, findingTotals, viewportRuns, startStopLock } from '../core/sessions.js';
import * as draftDoor from './draft-door.js';
import * as armed from './armed.js';
import { badgeFor } from './action-icon.js';
import { redact } from '../core/privacy.js';
import * as site from './site-access.js';
import { withDeadline as bounded } from '../platform/deadline.js';
import { requestPersistence, recordingState, problemCounts } from './media.js';
import * as secHeaders from './security-headers.js';
import { getSettings } from '../platform/settings.js';
import { sanitiseEvent, problemEvents } from '../core/events.js';
import { buildTestCase, buildDefectReport } from '../core/istqb.js';
import * as jira from './jira-door.js';
import { testCaseToAdf, defectToAdf } from './istqb-render-door.js';
import { provenance } from '../core/provenance.js';
import {
  ACTIVE, DISK_WARN, DISMISSED, LAST, QAConsole, activeSessionId, announceL, coded, handlers, isInternalUrl,
  liveSessionIds, sessionsByWindow, tw,
} from './worker-base.js';
import { broadcast, maskKey, pushRulesToPages, redactedMaskList, sendToTab, testableTabId } from './worker-tabs.js';
import { loadScrubCfg, scrub } from './worker-scrub.js';

/* ------------------------------------------------------------- event writes */

/** Every event this worker stores goes through one queue. */
/** Events lost per session, surfaced in UQA_GET_STATE. A cache of the persisted count (r2-01-3). */
export const captureLost = new Map();

/**
 * A batch the store refused twice. Counted, and a `capture-gap` note is written
 * straight to the store (not through the queue it just failed in) so the report
 * can show the hole instead of a timeline that looks complete. Best effort: if
 * the store is still refusing, the counter is the only trace and it says so.
 */
function noteCaptureGap(err, batch) {
  console.warn('[QA Wrap] a batch of events could not be stored:', err);
  const bySession = new Map();
  for (const ev of batch || []) bySession.set(ev.sessionId, (bySession.get(ev.sessionId) || 0) + 1);
  const slow = err?.unconfirmed === true; // r2-06-4: a timed-out write may still have committed
  for (const [sessionId, lost] of bySession) {
    if (!sessionId) continue;
    Promise.resolve().then(() => sessionState.addLost(sessionId, lost, slow))
      .then((st) => { if (!slow) captureLost.set(sessionId, st.captureLost); })
      .catch(() => { if (!slow) captureLost.set(sessionId, (captureLost.get(sessionId) || 0) + lost); });
    appendEvents([{
      sessionId, kind: 'note', tag: 'capture-gap', ts: Date.now(),
      text: slow ? `Capture gap: ${lost} events could not be confirmed stored (the write timed out; they may still be there).` : `Capture gap: events that could not be stored: ${lost}.`,
      ...(slow ? { unconfirmed: lost } : { lost }), reason: String(err?.message || err).slice(0, 200),
    }]).catch(() => {});
  }
}

/** A session's stored rows and gap codes; a body total over BODY_CAP counts as a body-cap gap (the queue starts its bytes at 0). */
async function seedSession(id) {
  const rows = await countEventsRaw(id);
  const st = rows ? await seedStats(id) : { gaps: [], bytes: 0 };
  const gaps = new Set(st.gaps);
  if (rows > ROW_CAP) gaps.add('session-cap');
  if (st.bytes > BODY_CAP) gaps.add('body-cap');
  return { rows, gaps: [...gaps] };
}

const writeQueue = createWriteQueue({
  write: appendEvents,
  seed: seedSession, // r9-06-1, r10-06-2: caps and gap notes survive a wake
  onCap: (id) => remember.rollPart(id, { getSession, putSession, startSession, rememberSession, live: liveSessionIds }).catch((e) => QAConsole.warn('could not roll to the next part:', e)), // rule 5: the full recording goes on as "part 2"
  onError: noteCaptureGap,
  // D-1010-129: events refused by the per-session row cap are counted like a failed batch, with no second note
  onLost: (sessionId, n) => sessionState.addLost(sessionId, n, false).then((st) => captureLost.set(sessionId, st.captureLost)).catch(() => captureLost.set(sessionId, (captureLost.get(sessionId) || 0) + n)),
});

/** Everything waiting is on disk when this resolves. */
export const flushEvents = () => writeQueue.flush();

/**
 * A direct write, flushed behind whatever is queued.
 *
 * The flush is not optional: `seq` is the store's auto-increment, so an event
 * written directly while others wait would be numbered before them and sort
 * ahead of things that happened earlier. Everything the worker itself records —
 * a note, a screenshot, a clip, an export — comes through here; only page
 * telemetry, which arrives in bursts, is queued.
 */
export async function appendEvent(event) {
  await flushEvents();
  event = await scrub(event);
  await noteFinding(event.sessionId, event);
  if (!isTesterRow(event)) return appendEventNow(event);
  return (await Promise.all([writeQueue.pushTester(event), flushEvents()]))[0]; // rule 4: a tester row counts toward the cap, passes it, and is on disk before the popup is answered
}

/**
 * Advance the session's running finding tally by one event, so the popup's two-second poll
 * never reads every event out of IndexedDB. `carriesFinding()` is the same gate
 * `countFindings()` applies to the whole session (tools/test-sessions.mjs asserts they agree).
 */
// One chain for every tally write: get-then-set across two awaits raced (popup 137 vs 215).
let noteChain = Promise.resolve();

function noteFinding(sessionId, event) {
  if (!sessionId || !carriesFinding(event)) return noteChain;
  noteChain = noteChain.then(async () => {
    try {
      const state = await sessionState.getState(sessionId);
      await sessionState.setState(sessionId, {
        findings: foldFinding(state.findings || BLANK_FINDINGS, event),
      });
    } catch {
      /* the tally is a convenience; losing it must never lose the event */
    }
  });
  return noteChain;
}

/**
 * The counts the badge and the popup ticker read.
 *
 * Flushed as well, and not because a badge that is 50 ms stale would matter —
 * because `UQA_GET_STATE` answers with `eventCount`, and a test or a tester who
 * does a thing and immediately asks how many events there are is entitled to
 * see the one they just caused.
 */
export async function countEvents(sessionId) {
  await flushEvents();
  return countEventsRaw(sessionId);
}

export async function countFailures(sessionId) {
  await flushEvents();
  return countFailuresRaw(sessionId);
}

/** r10-07-3: viewport rows only; every other row stays compressed. */
export async function viewportEvents(sessionId) {
  await flushEvents();
  return readEventsByKindRaw(sessionId, ['viewport']);
}

/** Reads that must see the tail. Both flush; neither call site had to know. */
export async function getEvents(sessionId) {
  await flushEvents();
  return readEventsRaw(sessionId);
}

export async function getEventsSince(sessionId, sinceSeq = 0) {
  await flushEvents();
  return readEventsSinceRaw(sessionId, sinceSeq);
}

/** The draft door reads events itself, so the queue is flushed here, once, before it does (T-075 bytes). */
export async function draft(op, args) {
  await flushEvents();
  return draftDoor[op](args);
}

/* --------------------------------------------------------------- session state */

/** One session per window, not one per extension (brief item G3): Start in a second window used to end */
const BY_WINDOW = 'activeSessionsByWindow';

/** The window map is read, changed and written back: one writer at a time. */
let mapLock = Promise.resolve();

function withMapLock(fn) {
  const run = mapLock.then(fn);
  mapLock = run.catch(() => {});
  return run;
}

/**
 * Record that a session has started in a window.
 *
 * `'none'` for a session that could not be placed in a window — a start from
 * the right-click menu on a tab that has since gone, say. It is a real key, so
 * such a session is still findable and still stoppable, rather than being a
 * session the map has no way to name.
 */
async function noteSessionStarted(session) {
  await withMapLock(async () => {
    const map = await sessionsByWindow();
    map[session.windowId ?? 'none'] = session.id;
    armed.dropSessionMap();
    try { await chrome.storage.session.set({ [BY_WINDOW]: map, [ACTIVE]: session.id }); } finally { armed.dropSessionMap(); }
  });
  await paintBadge();
}

/** Forget one session, by id, wherever it was. */
async function noteSessionStopped(sessionId) {
  await withMapLock(async () => {
    const map = await sessionsByWindow();
    for (const [windowId, id] of Object.entries(map)) {
      if (id === sessionId) delete map[windowId];
    }
    const left = Object.values(map).filter(Boolean);
    armed.dropSessionMap();
    try {
      if (left.length) await chrome.storage.session.set({ [BY_WINDOW]: map, [ACTIVE]: left[left.length - 1] });
      else await chrome.storage.session.remove([BY_WINDOW, ACTIVE]);
    } finally { armed.dropSessionMap(); }
  });
  await paintBadge();
}

/**
 * Kept because eleven call sites and two other modules use it, and because
 * `setActiveSessionId(null)` reads better at the end of `stopSession` than the
 * two branches it now stands in front of.
 */
export async function setActiveSessionId(id, windowId = null) {
  if (id) await noteSessionStarted({ id, windowId });
  else {
    const current = await activeSessionId();
    if (current) await noteSessionStopped(current);
    else await paintBadge();
  }
}

/**
 * The badge counts the session in the window the tester is looking at.
 *
 * With two sessions running there is still one toolbar, and a sum across both
 * would be a number that matches no report. `hint` is passed where the caller
 * knows; without one it falls back to the single session, which is what it
 * counted before any of this existed.
 */
export async function paintBadge(hint) {
  const id = await activeSessionId(hint);
  const got = await chrome.storage.session.get([DONE_KEY, DISK_WARN, 'uqa.updateNew']).catch(() => ({}));
  const done = got[DONE_KEY];
  let words = done ? await tw('common.worker.badge.done', 'Task finished') : '';
  let t = { problems: 0, errors: 0 };
  if (id) {
    await flushEvents();
    await noteChain;
    t = findingTotals((await sessionState.getState(id)).findings);
    if (t.problems) words += `${words && ' · '}${await tw('common.worker.badge.errors', 'Errors')}: ${t.errors}, ${await tw('common.worker.badge.warnings', 'Warnings')}: ${t.problems - t.errors}`;
  }
  const b = badgeFor({ disk: !!got[DISK_WARN], live: !!id, problems: t.problems, errors: t.errors, mark: done ? '✓' : '', update: !!got['uqa.updateNew'] }); // glyph-ok
  if (b.color) await chrome.action.setBadgeBackgroundColor({ color: b.color });
  await chrome.action.setBadgeText({ text: b.text });
  if (!/MICROPHONE/.test(await chrome.action.getTitle({}).catch(() => ''))) await chrome.action.setTitle({ title: `QA Wrap ${words}`.trim() }).catch(() => {});
}

export const DONE_KEY = 'uqa.doneJob';

export const signalDone = async () => { await chrome.storage.session.set({ [DONE_KEY]: 1 }).catch(() => {}); await paintBadge(); };

/**
 * The next session number on this machine, without two windows taking the same one.
 */
let seqChain = Promise.resolve(0);

function nextSessionSeq() {
  const run = seqChain.then(async () => {
    const { sessionSeq = 0 } = await chrome.storage.local.get('sessionSeq');
    const seq = sessionSeq + 1;
    await chrome.storage.local.set({ sessionSeq: seq });
    return seq;
  });
  // One rejected start must not reject every start after it.
  seqChain = run.catch(() => {});
  return run;
}

function newId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------------------------------------------------------- session API */

/** r4-03-1: a URL is stored masked (magic links, signed URLs); the raw one stays in memory for the cookie read. */
const rawStartUrl = new Map();

function storedUrl(u, cfg) { return u && cfg.on ? redact(u, { extra: cfg.extra }).text : u || null; }

async function runStart({ charter, tabId, env, startUrl, shortcut = false }) {
  // Recording is a capability like any other: it does not start in a window
  // that is still asleep.
  const startTab = tabId ?? (await testableTabId());
  const tab = startTab != null ? await chrome.tabs.get(startTab).catch(() => null) : null;
  const windowId = tab?.windowId ?? null;
  if (!(await armed.isArmedWindow(windowId))) throw armed.asleepError();
  // And allowed here, which since decision 8 is a separate question. Recording
  // a page the extension was never let into would produce a session with a
  // charter, a duration and no events in it.
  if (site.originPattern(tab?.url || '') && !(await site.hasSiteAccess(tab.url))) {
    throw site.notAllowedError();
  }

  // Restarting in THIS window replaces this window's session (another window's is left alone — see `BY_WINDOW`); Start twice is "start again".
  const map = await sessionsByWindow();
  const here = map[windowId ?? 'none'];
  if (here) await runStop(here); // the unlocked stop: this Start is itself in the lock

  // The session's number on this machine: S001, S002 … A folder listing then
  // sorts runs in the order they happened whatever their charters say.
  const seq = await nextSessionSeq();

  const session = {
    id: newId(),
    seq,
    charter: charter || 'Untitled session',
    startedAt: Date.now(),
    endedAt: null,
    tabId: tabId ?? null,
    // The window is what the session actually covers. Every tab inside it is
    // recorded, kept apart by tab so a flow that opens a new one stays readable.
    windowId,
    startUrl: storedUrl(startUrl, await loadScrubCfg()),
    env: env || null,
    // r4-09-2 (D-1010-85): the time-box is gone. The fields stay null so older sessions and exports read the same shape.
    timeboxMinutes: null,
    expiresAt: null,
    breakdown: null,
    status: 'recording',
  };
  await bounded(putSession(session), 'tx');
  rememberSession(session);
  if (startUrl) rawStartUrl.set(session.id, startUrl);
  await noteSessionStarted(session);

  // Planning is an activity like any other, and starting a session with a
  // charter *is* the planning. Logged after the id exists, because the usage
  // log belongs to the session and there is nothing to belong to before this.
  // The first session on this profile asks for persistence; not awaited, the answer lands in storage for Settings.
  requestPersistence().catch(() => { /* reported in Settings as "not asked" */ });

  // Watch the six security headers for this window and session (decision 33; see background/security-headers.js).
  secHeaders.arm(windowId);

  await sessionState.resetFor(session.id);
  // The host the tester started on, so the very first failure can be told apart
  // from an advertiser's before any navigation has been recorded.
  await sessionState.setState(session.id, {
    rawStartUrl: startUrl || null,
    findings: foldFinding(BLANK_FINDINGS, { kind: 'nav', url: session.startUrl, ts: session.startedAt }),
  });
  await sessionState.noteUse(session.id, 'session', { charter: session.charter }); if (shortcut) await sessionState.noteUse(session.id, 'shortcut').catch(() => null); // the Alt+Shift+Q start: a count for the Bug Hunt page

  // A new session starts from defaults, always. Rules armed in the last one,
  // layout stress left on, filters switched off — all of it belongs to the
  // session that created it, and inheriting any of it makes the next run a
  // measurement of the previous one's leftovers. (resetFor ran above, before
  // the first thing was logged against it.)
  await pushRulesToPages(session.id, windowId);
  // Armed tabs only. Resetting a page's session state means reaching into it,
  // and a window the tester never woke is a window this extension has no
  // business touching — that is the whole contract of the master switch.
  await Promise.all(
    (await chrome.tabs.query({})).map(async (t) =>
      t.id == null || !(await armed.isArmedTab(t.id))
        ? null
        : sendToTab(t.id, { type: 'UQA_SESSION_RESET' })
    )
  );

  // The flag rides along. The bridge used to answer this message by asking
  // for the state — a second round trip — so a session was "started" while
  // every page still dropped its events. A burst fired within a second of
  // Start lost 2,000 of 2,000 under load. With the value in the message the
  // page sets it before it lets go of the message, and `broadcast` awaits.
  await broadcast({ type: 'UQA_STATE_CHANGED', recording: true });
  return session;
}

const lock = startStopLock();
export const startSession = (/** @type {Parameters<typeof runStart>[0]} */ a) => lock.start(() => runStart(a));
export const stopSession = async (/** @type {Parameters<typeof runStop>[0]} */ which) => { await lock.settled(); return runStop(which); };

/** The stopped row and the queue tail in one bounded write. False when not even the row was saved (D-1010-235). */
async function writeStopped(session, tail) {
  const put = () => bounded((async () => {
    await putSessionWithEvents(session, tail.events);
    rememberSession(session);
  })(), 'tx');
  try {
    // r4-06-1: deadline plus one retry (never after a timeout, which may have committed).
    try { await put(); } catch (e) { if (e?.code === 'SLOW') throw e; await put(); }
    tail.resolve();
  } catch (err) {
    if (err?.code === 'SLOW') err.unconfirmed = true; // r10-06-1: may have committed
    tail.reject(err); // reaches the queue's onError: noteCaptureGap(err, tail.events)
    // The session still ends: the row alone, without the lost tail.
    try { await bounded(putSession(session), 'tx'); } catch { return false; }
    rememberSession(session);
  }
  return true;
}

/**
 * @param {string|object} [which] the session id to stop, or a hint (a windowId,
 *        a `{tabId}`, a sender) naming the window whose session should stop.
 *        Omitted means the single running session, which is what every caller
 *        meant before there could be more than one.
 */
async function runStop(which) {
  const id = typeof which === 'string' ? which : await activeSessionId(which);
  if (!id) return null;

  /*
   * The clip goes first, and here rather than at each caller: a session that ended used to leave the offscreen
   * recorder filming, and the clip was later filed against a closed session (or a wedged recorder could not be stopped
   * at all). Stopping first lets `appendEvent` land while the session is open. Tolerant on purpose: a failed clip
   * stop must not stop the session ending. Inside `stopSession`, so `startSession` and window-close get it free.
   */
  try {
    const clip = await recordingState().catch(() => null);
    if (clip?.recording && !clip.finishing) {
      await handlers.UQA_RECORD_STOP({ label: 'Session ended' });
    }
  } catch (err) {
    QAConsole.warn('the clip could not be stopped with the session:', err);
  }

  const session = await getSession(id);

  // Read the session's own state BEFORE the record is written and before it is
  // cleared. This used to run after putSession(), so the count of how many
  // requests were actually broken — and which tools were used — was assigned to
  // an object nobody wrote back, and was gone by the time the report opened.
  const state = await sessionState.getState(id);
  rate.delete(id); // r3-01-4: the per-second counter dies with its session

  let stored = true; // false: not even the stopped row was saved (D-1010-235)
  if (session) {
    session.endedAt = Date.now();
    session.status = 'stopped';
    if (!rawStartUrl.has(id) && state.rawStartUrl) rawStartUrl.set(id, state.rawStartUrl); // r2-01-3: after a restart
    session.cookies = await safeCookies(rawStartUrl.get(id) ?? session.startUrl);
    rawStartUrl.delete(id);
    session.rulesArmed = state.rules.length;
    session.rulesFired = state.fired;
    session.toolsUsed = state.used;
    // How much was hidden by hand. The report says this out loud: a document
    // that quietly omits evidence is worse than one that says what it is not
    // showing, and a reviewer who knows three values were masked can ask for
    // them through a channel that is allowed to carry them.
    const maskStore = await chrome.storage.session.get(maskKey(id));
    const maskEntries = redactedMaskList(maskStore[maskKey(id)]);
    session.masked = maskEntries.length;
    session.maskList = maskEntries;

    // The stopped row and the queue tail in ONE transaction: a worker torn down between the two would leave "stopped" without the last events. `take()` pulls the tail out.
    stored = await writeStopped(session, writeQueue.take(id));
  }
  // Any other session's events — a clip still filing into an earlier one — are
  // not part of that transaction, but they must not be left in memory either.
  await flushEvents();

  // Any window-size run still open ends with the session, so a run always has
  // both of its events and a duration that is a real one. Before the state is
  // cleared, because the events belong to a session that is still open.
  await closeViewportRuns({ sessionId: id, reason: 'session-stopped' }).catch(() => {});

  // Whatever this session switched on, switch off. A tester who stops recording
  // and keeps browsing must not still be behind a rule that fails every request.
  // Cleared before the map forgets the session, and pushed after: the pages of
  // this window have to be told there are no rules left, and telling them is
  // scoped to the window so another window's rules are not cleared with it.
  await sessionState.clearState(id);
  await noteSessionStopped(id);
  await pushRulesToPages(null, session?.windowId ?? null);
  if (state.rtl) {
    // Armed tabs only — layout stress was never switched on anywhere else, so
    // asking a sleeping window to undo it is a message it should never have
    // been sent in the first place.
    await Promise.all(
      (await chrome.tabs.query({})).map(async (t) =>
        t.id == null || !(await armed.isArmedTab(t.id))
          ? null
          : sendToTab(t.id, { type: 'UQA_RTL_OFF' })
      )
    );
  }

  // The worker drops the active id on stop, but the popup still needs to offer
  // this session's exports — so remember which one just finished.
  if (session) {
    await chrome.storage.session.set({ [LAST]: session.id });
    await chrome.storage.session.remove(DISMISSED);
  }
  await paintBadge();
  await armed.releaseJoined(session?.joinedWindows); // ui-1019: the windows followFocus woke go back to sleep with the session; the window Start was pressed in keeps the tester's switch
  // Stop watching response headers when the LAST session ends (a second window may still be recording).
  // r2-01-3: with others still live, release only this session's window; its record goes with it.
  if (!(await liveSessionIds()).length) secHeaders.disarm();
  else if (session) secHeaders.disarm(session.windowId ?? null);

  // `recording: false` only when nothing is left recording (a flat false silenced a second window's run).
  await broadcast({ type: 'UQA_STATE_CHANGED', recording: (await liveSessionIds()).length > 0 });

  /** The session is over, said where the tester will see it. */
  if (session) {
    getEvents(session.id)
      .then(async (rows) => rows.length && announceL('session', 'titleSession', 'Session finished', 'sessionStopped', { charter: session.charter, events: rows.length, failures: (await problemCounts(rows)).groups }))
      .catch(() => {});
  }

  // Auto-submit, if the tester asked for it and only then (off by default, read fresh): the one thing that files a document off the machine without a button press for it. After the session is written and broadcast; failures become a note, never thrown.
  if (session) await autoSubmitOnStop(session).catch(() => {});
  return stored ? session : { ...session, saved: false, error: 'The session was stopped, but its last events could not be saved.' };
}

/** File this session's defect report into Jira, if Settings says to. Silent when the toggle is off or Jira is not set up. Never for a session the idle sweep stopped: nobody pressed Stop, so nobody asked (autopilot 1011 D4). */
async function autoSubmitOnStop(session) {
  if (session.stopReason === 'idle') return null;
  const settings = await getSettings();
  if (!settings.autoSubmitDefect) return null;
  const cfg = await jiraConfig();
  if (!jiraReady(cfg) || !cfg.project) return null;
  try {
    const created = await quickFileInJira({ sessionId: session.id, kind: 'defect' });
    await addNote(`Auto-submitted to Jira as ${created.key}: ${created.url}`, 'issue').catch(() => {});
    await broadcast({ type: 'UQA_FILED_CHANGED', sessionId: session.id, key: created.key });
    return created;
  } catch (err) {
    // Recorded where the tester will see it, rather than thrown into a stop
    // that has already succeeded.
    await addNote(`Auto-submit to Jira failed: ${err.message}`, 'issue').catch(() => {});
    return null;
  }
}

/** Names and flags only — never values. A bug report should not leak a session token. */
async function safeCookies(url) {
  if (!url) return [];
  try {
    const cookies = await chrome.cookies.getAll({ url });
    return cookies.map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
      session: c.session,
    }));
  } catch {
    return [];
  }
}

/**
 * Mark a tool as used in this session.
 *
 * Only while a session is live — outside one there is nothing for it to belong
 * to, and a tick that survives into the next run is worse than no tick at all.
 * Failures are swallowed on purpose: a bookkeeping write must never be the
 * reason a tool the tester actually pressed reports an error.
 */
export async function noteUse(tool, extra, hint) {
  const sessionId = await activeSessionId(hint);
  if (!sessionId) return null;
  return sessionState.noteUse(sessionId, tool, extra).catch(() => null);
}

/* ------------------------------------------------------------------- ingestion */

let badgeTimer = null;

/**
 * Only events from the tab under test belong in the session. Without this, a
 * tester who checks their email in another tab while recording gets that tab's
 * requests and clicks in the bug report.
 */
/**
 * Does this event belong to the session?
 *
 * It used to mean "is it the one tab the session started in", which quietly
 * threw away everything a tester did after a flow opened a second tab — the
 * payment window, the print preview, the OAuth hand-off. The scope is the
 * **window** now: every tab in it is recorded, and each event carries its tab so
 * the report can keep them in separate lanes.
 */
/** The running session's record, held for the life of the worker. */
const sessionCache = new Map();

export function rememberSession(session) {
  if (session?.id) sessionCache.set(session.id, session);
}

export function forgetSession(sessionId) {
  if (sessionId == null) sessionCache.clear();
  else { sessionCache.delete(sessionId); remember.forget(sessionId); } // the auto rows go with a deleted or purged session
}

async function readSession(sessionId) {
  if (sessionCache.has(sessionId)) return sessionCache.get(sessionId);
  const session = await getSession(sessionId);
  // A miss is remembered too, so a stream of events for a session that has
  // been deleted does not open a transaction each time to learn it is gone.
  sessionCache.set(sessionId, session || null);
  return session;
}

/** ui-1019: with one session running only the tab the tester is on records (`focusTabId`, kept by followFocus; the start tab until they move); a tab they left is silent until they return. */
async function onFocus(s, tabId) { const on = s.focusTabId ?? s.tabId; return on == null || on === tabId || (await liveSessionIds()).length > 1; } // several sessions: each window keeps its own

export async function belongsToSession(sessionId, tabId) {
  if (tabId == null) return true; // no tab context — keep it rather than lose it
  const session = await readSession(sessionId);
  if (!session) return true;

  if (session.windowId != null) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    // A closed tab cannot be placed; keeping the event beats losing the last one before a crash.
    if (!tab) return true;
    // The session's own window, its window-size runs (research/55) and the windows the tester moved on to (followFocus).
    return (tab.windowId === session.windowId || (session.windowIds || []).includes(tab.windowId)) && onFocus(session, tabId);
  }

  // Sessions recorded before windows were the scope keep their old behaviour.
  if (session.tabId == null) return true;
  return session.tabId === tabId;
}

/** Pre-roll events are up to two minutes old (the replay buffer) when the session starts; the clock-skew guard allows that and no more. */
const PREROLL_SKEW_MS = 130_000;

const EVENTS_PER_SEC = 400; // T-075: per session per second, the rest refused

const rate = new Map();

// r2-06-1: via the write queue, and only while the session is active.
const droppedNote = async (id, r) => {
  if (id !== (await activeSessionId().catch(() => null))) return;
  writeQueue.push(await scrub({ sessionId: id, kind: 'note', tag: 'dropped', ts: Date.now(), text: `${r[1] - EVENTS_PER_SEC} events were not recorded (limit ${EVENTS_PER_SEC} a second)`, frameUrl: null, tabId: null })).catch(() => {});
};

const rateCap = (id, s = Math.floor(Date.now() / 1000), r = rate.get(id)) => (r?.[0] !== s ? (rate.set(id, [s, 1]), false) : (++r[1] === EVENTS_PER_SEC + 1 && setTimeout(droppedNote, 1000, id, r), r[1] > EVENTS_PER_SEC));

export async function ingest(event, sender, preRoll = false) {
  const sessionId = await activeSessionId(sender);
  if (!sessionId) return { stored: false };

  // Before anything else: take the page's word for nothing it does not own.
  // This used to be a raw `{ ...event }` spread into the store — see
  // `core/events.js` for the four different ways a page could abuse that.
  const clean = sanitiseEvent(event, /** @type {any} */ ({ frameUrl: sender?.url ?? null, frameId: sender?.frameId, ...(preRoll ? { skewMs: PREROLL_SKEW_MS } : {}) })); // frameId: D-1010-128 (core/events.js JSDoc lacks it)
  if (!clean) return { stored: false, reason: 'unknown-kind' };
  if (!preRoll && rateCap(sessionId)) return { stored: false, reason: 'rate' };

  // Asleep or foreign tab: nothing recorded. Consent is not re-asked (a bump never sleeps a live window).
  try {
    await armed.assertMayRecord(sender, { belongs: (tabId) => belongsToSession(sessionId, tabId) });
  } catch (err) {
    if (err?.reason) return { stored: false, reason: err.reason };
    throw err;
  }
  if (isInternalUrl(clean.frameUrl)) {
    return { stored: false, reason: 'internal-page' };
  }

  // Queued, not written one at a time, and deliberately not awaited (awaiting puts every ingest
  // back on the 50 ms timer). Failures go to the queue's onError; every reader flushes first.
  writeQueue.push(await scrub({
    ...clean,
    ...(preRoll ? { preRoll: true } : {}),
    sessionId,
    tabId: sender?.tab?.id ?? null,
    // The title, not just the id: a tab id means nothing to the person reading
    // the report a week later, and the tab itself is long gone by then.
    tabTitle: sender?.tab?.title || null,
  })).catch(() => { /* reported by the queue; the sender is not owed the error */ });

  // The same tally the worker's own events feed. Gated on `carriesFinding`
  // inside, so the hot path pays one synchronous predicate and nothing else.
  await noteFinding(sessionId, { ...clean, sessionId });

  // Badge repaint is debounced — a chatty page must not thrash storage.
  if (!badgeTimer) {
    badgeTimer = setTimeout(() => {
      badgeTimer = null;
      paintBadge();
    }, 500);
  }
  return { stored: true };
}

/**
 * A note is the tester speaking, not page telemetry — so it bypasses the tab and
 * internal-URL filters above. It is sent from the popup, whose sender URL is a
 * chrome-extension: one; routing it through ingest() silently swallowed it.
 */
export async function addNote(text, tag, hint) {
  const sessionId = await activeSessionId(hint);
  if (!sessionId) throw coded('Start a session before adding notes.', 'NO_SESSION');
  const session = await getSession(sessionId);
  await appendEvent({
    sessionId,
    kind: 'note',
    ts: Date.now(),
    text,
    tag: tag || null,
    frameUrl: session?.startUrl || null,
    tabId: session?.tabId ?? null,
  });
  paintBadge();
  return { stored: true };
}

/* --------------------------------------------------------------------- export */

/**
 * One session, or a refusal that says which one.
 */
export async function mustSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Unknown session ${sessionId}`);
  return session;
}

/** The session and its timeline, the pair almost every caller wants. */
export async function loadSession(sessionId) {
  const session = await mustSession(sessionId);
  return { session, events: await getEvents(sessionId) };
}

/* -------------------------------------------------------- override rules (6) */

/**
 * Rules live with the session, not with the extension.
 *
 * They used to sit in `chrome.storage.local` under a single fixed id, which had
 * two consequences the tester never asked for: a rule armed yesterday was still
 * armed today, and arming a second rule silently replaced the first. Both are
 * now impossible — `background/session-state.js` owns them, they stack, and each
 * carries its own countdown.
 */
/** @param {*} [hint] which window is asking; see activeSessionId(). */
export async function getRules(hint) {
  const sessionId = await activeSessionId(hint);
  return sessionId ? sessionState.getRules(sessionId) : [];
}

/**
 * The session a rule operation belongs to: made, never guessed at.
 *
 * @param {*} [hint] which window is asking; see activeSessionId().
 * @param {{create?: boolean}} [opts] `create` starts this window's run if it has none.
 */
async function rulesSession(hint, { create = false } = {}) {
  let sessionId = await activeSessionId(hint);
  if (!sessionId && create) {
    // An explicit tab wins; otherwise `testableTabId()` reads the sender and
    // answers with a real page in the asking window rather than the popup that
    // sent the message, which is an extension page and not a thing to record.
    const asked = hint && typeof hint === 'object' ? hint.tabId ?? null : null;
    const tabId = asked ?? (await testableTabId(hint && typeof hint === 'object' ? hint : undefined));
    const tab = tabId == null ? null : await chrome.tabs.get(tabId).catch(() => null);
    const started = await startSession({
      charter: 'Broken requests',
      tabId: tabId ?? undefined,
      startUrl: tab?.url || null,
    });
    sessionId = started.id;
  }
  if (!sessionId) return { sessionId: null, windowId: null };
  const session = await getSession(sessionId);
  return { sessionId, windowId: session?.windowId ?? null };
}

/** Arm one more. The existing ones stay armed. */
export async function addRule(rule, hint) {
  const { sessionId, windowId } = await rulesSession(hint, { create: true });
  const rules = await sessionState.addRule(sessionId, rule);
  await pushRulesToPages(sessionId, windowId);
  await broadcast({ type: 'UQA_RULES_CHANGED' });
  if (sessionId) {
    await appendEvent({
      sessionId,
      kind: 'rule',
      ts: Date.now(),
      label: rule.label,
      pattern: rule.pattern,
      action: rule.action,
      remaining: rule.remaining,
      armed: true,
    });
  }
  return rules;
}

export async function setRules(rules, hint) {
  const { sessionId, windowId } = await rulesSession(hint);
  // Nothing is armed when nothing is running, so there is nothing to replace
  // and no reason to start a run in order to say so.
  if (!sessionId) return [];
  const next = await sessionState.replaceRules(sessionId, rules);
  await pushRulesToPages(sessionId, windowId);
  await broadcast({ type: 'UQA_RULES_CHANGED' });
  return next;
}

export async function dropRule(id, hint) {
  const { sessionId, windowId } = await rulesSession(hint);
  if (!sessionId) return [];
  const rules = await sessionState.removeRule(sessionId, id);
  await pushRulesToPages(sessionId, windowId);
  await broadcast({ type: 'UQA_RULES_CHANGED' });
  return rules;
}

/**
 * The countdown is kept here, not in the page.
 *
 * A page holds its own copy of the rules and decrements as requests go by — but
 * a page is torn down on every navigation, so its count resets. "Break the next
 * three requests" quietly became "break three per page load". The page now
 * reports each firing and the authoritative budget lives in session state.
 */
export async function noteRuleFired({ ruleId }, hint) {
  // The page that fired it says which window it is in, so a rule armed in one
  // window is counted down by that window's traffic and no other's.
  const sessionId = await activeSessionId(hint);
  if (!sessionId) return null;
  const session = await getSession(sessionId);
  const rule = await sessionState.consumeRule(sessionId, ruleId);
  if (!rule) return null; // a forged or stale id: nothing changed, nothing to push or broadcast
  await pushRulesToPages(sessionId, session?.windowId ?? null);
  await broadcast({ type: 'UQA_RULES_CHANGED' });
  return rule;
}

/** Remember what this session filed (on the session record, not the timeline); status sync needs the keys. */
export async function rememberFiled(sessionId, entries) {
  if (!sessionId || !entries?.length) return null;
  const session = await getSession(sessionId);
  if (!session) return null;

  const existing = session.filed || [];
  const byKey = new Map(existing.map((f) => [f.key, f]));
  for (const entry of entries) {
    if (!entry?.key) continue;
    byKey.set(entry.key, { ...byKey.get(entry.key), ...entry, filedAt: entry.filedAt || Date.now() });
  }

  session.filed = [...byKey.values()];
  await putSession(session);
  rememberSession(session);
  return session.filed;
}

/* -------------------------------------------------- filing into Jira (26) */

export const jiraConfig = async () => (await getSettings()).jira || {};

/** Enough of a credential to try with (no email: Data Center signs in with a PAT alone); `core/jira-auth.js` says what is missing. */
export const jiraReady = (cfg) => !!(cfg?.baseUrl && cfg?.token);

/**
 * File a test case or a defect, then wire up its relationships.
 *
 * Links are attempted after the issue exists and each is reported on its own.
 * A tester who filled in a whole defect report and then hit a permissions error
 * on the epic link should still have their defect report.
 */
const KIND_LABEL = {
  defect: 'defect report', testcase: 'test case', story: 'user story', epic: 'epic',
  task: 'task', subtask: 'sub-task', plain: 'issue',
};

/** Everything the vault holds, for the exact-match half of the secret scan. */
export async function knownSecrets() {
  const s = await getSettings();
  const tracker = (t) => Object.entries(t || {}).filter(([k, v]) => /token|key|secret|password|url/i.test(k) && typeof v === 'string').map(([, v]) => v);
  return [s.jira?.token, s.slack?.webhookUrl, ...(s.webhooks || []).map((w) => w.url), ...Object.values(s.trackers || {}).flatMap(tracker)].filter(
    (v) => typeof v === 'string' && v.length >= 8
  );
}

/** The worker's half of a refusal decided behind the door: same message, plus `code` and `data`. */
export function refuse(out) {
  if (out.refused) throw coded(out.refused.message, out.refused.code, out.refused.data);
  return out;
}

/**
 * The one path every "file to Jira" route takes (report button, quick file,
 * full form, add-to-existing, suite). Documents are built here; scanning,
 * field shaping, create/comment, links and attachments run behind the door.
 * `dryRun` answers "what would stop this" without sending anything.
 */
export async function fileInJira(msg) {
  const { sessionId, kind = 'defect', options = {}, epicKey, storyKey, testCaseKey, labels, summary, body, fields, attach, existingKey, redact, allowSecrets, dryRun } = msg;
  const cfg = await jiraConfig();
  const project = msg.projectKey || cfg.project;
  if (!project) throw new Error('No Jira project chosen. Open Settings › Integrations, or pick one in the report.');

  const loaded = await loadSession(sessionId);
  const { session } = loaded;
  // Notes and Induced are not filed unless the dialog's "include notes" is ticked.
  const events = msg.includeNotes ? loaded.events : problemEvents(loaded.events);
  const isTest = kind === 'testcase';
  const isDefect = kind === 'defect';
  const built = isTest
    ? buildTestCase(session, events, { ...options, epic: epicKey, story: storyKey })
    : isDefect
      ? buildDefectReport(session, events, { ...options, epic: epicKey, story: storyKey, testCase: testCaseKey })
      : null;
  const drafted = built ? null : await draft('draftIssue', { kind, sessionId, problemsOnly: !msg.includeNotes });

  // What is sent is what the tester saw: the model's document until they edit
  // the text, then their words.
  const typedBody = String(body || '').trim();
  const finalSummary = String(summary || '').trim() || (isTest ? `${built.identifier}: ${built.objective}` : isDefect ? built.summary : drafted.summary);

  // The issue type: what the tester chose, else the saved default, else the type whose name matches the kind.
  let typeName = msg.issueTypeName || (isTest ? cfg.testIssueType : isDefect ? cfg.issueType : '') || '';
  if (!typeName && !existingKey) {
    const types = await jira.issueTypes(cfg, project, { fieldsFor: false }).catch(() => []);
    typeName = (await draft('pickIssueType', { kind, types }))?.name || (isDefect ? 'Bug' : 'Task');
  }

  const version = chrome.runtime.getManifest().version;
  const out = refuse(await jira.fileIssue(cfg, {
    sessionId, project, typeName, kind, isTest, epicKey, storyKey, testCaseKey, existingKey, dryRun,
    summary: finalSummary,
    ...(typedBody || !built ? { body: typedBody || drafted.body } : { adf: isTest ? await testCaseToAdf(built) : await defectToAdf(built) }),
    fields: fields || {},
    // The priority is resolved behind the door (jira.js priorityFor: settings map over DEFAULT_PRIORITY_MAP).
    severity: isDefect ? built.severity : null,
    labels: labels || ['qa-wrap', isTest ? 'test-case' : kind, ...(isDefect ? [`severity-${built.severity}`] : [])],
    url: session.startUrl,
    attach: attach && { ...attach, version },
    redact, allow: allowSecrets, known: await knownSecrets(),
    provenance: provenance({ session, version, kind }),
  }));
  if (dryRun) return { ...out.scan, issueType: typeName };

  await addNote(`${existingKey ? 'Added to' : 'Filed in'} Jira as ${out.key} (${KIND_LABEL[kind] || kind}): ${out.url}`, 'issue').catch(() => {});
  await rememberFiled(sessionId, [{ key: out.key, url: out.url, kind, ...(existingKey ? { commentedAt: Date.now() } : { summary: finalSummary }) }]).catch(() => {});
  return { ...out, kind, artefact: built || drafted };
}

/** One press with the saved credentials, project and issue type; attachments per kind below. */
/** What travels with each kind: defects carry screenshots and the network log, test cases the report, the rest the session sheet. */
export const QUICK_ATTACH = {
  defect: { screenshots: true, formats: ['markdown', 'sbtm', 'har'] },
  testcase: { screenshots: false, formats: ['markdown'] },
  story: { screenshots: false, formats: ['sbtm'] },
  epic: { screenshots: false, formats: ['sbtm'] },
  task: { screenshots: false, formats: ['sbtm'] },
  subtask: { screenshots: false, formats: ['sbtm'] },
  plain: { screenshots: true, formats: ['markdown'] },
};

/** One press, any of the seven kinds; the issue type resolves the way `fileInJira()` resolves it. */
export async function quickFileInJira(msg) {
  const { kind = 'defect' } = msg;
  const cfg = await jiraConfig();
  if (!jiraReady(cfg)) throw new Error('No Jira credentials saved. Settings › Integrations.');
  if (!cfg.project) throw new Error('No default Jira project saved. Settings › Integrations, or use the form below.');
  return fileInJira({
    ...msg,
    kind,
    projectKey: cfg.project,
    issueTypeName:
      kind === 'defect' ? cfg.issueType || undefined
        : kind === 'testcase' ? cfg.testIssueType || undefined
          : undefined,
    attach: QUICK_ATTACH[kind] || QUICK_ATTACH.defect,
  });
}

/* ---- the size a window actually got ---------------------------------- */

/** The floor and the tolerance for a window size, both stated rather than assumed. */
const MIN_WINDOW = 50;

/** A size that is a number, is positive, and fits on the screen. */
export function clampWindowSize(width, height, screen) {
  const capW = screen?.w > 0 ? screen.w : 20000;
  const capH = screen?.h > 0 ? screen.h : 20000;
  return {
    width: Math.max(MIN_WINDOW, Math.min(Math.round(width) || MIN_WINDOW, capW)),
    height: Math.max(MIN_WINDOW, Math.min(Math.round(height) || MIN_WINDOW, capH)),
  };
}

/** The id of the last clip stamped with this run, or null. */
async function lastMediaForRun(sessionId, runId) {
  const clips = await listMedia(sessionId).catch(() => []);
  const mine = clips.filter((m) => m.runId === runId);
  return mine.length ? mine[mine.length - 1].id : null;
}

/**
 * Put a window back the way the tester had it.
 *
 * `state` goes in a second call on purpose: `chrome.windows.update` ignores
 * width and height in the same call that sets a state, so a window that was
 * maximized has to be given its normal bounds first and then re-maximized —
 * otherwise un-maximizing it to measure a viewport leaves it un-maximized for
 * good.
 */
async function restoreWindowBounds(windowId, restore) {
  if (windowId == null || !restore) return;
  const bounds = {};
  for (const key of ['left', 'top', 'width', 'height']) {
    if (Number.isFinite(restore[key])) bounds[key] = restore[key];
  }
  if (Number.isFinite(bounds.width)) {
    ({ width: bounds.width, height: bounds.height } = clampWindowSize(bounds.width, bounds.height, null));
  }
  if (Object.keys(bounds).length) await chrome.windows.update(windowId, bounds).catch(() => {});
  if (restore.state && restore.state !== 'normal') {
    await chrome.windows.update(windowId, { state: restore.state }).catch(() => {});
  }
}

export async function closeViewportRuns({
  sessionId, windowId = null, reason = 'closed', mode = null, restoreBounds = true,
}) {
  if (!sessionId) return 0;
  const runs = viewportRuns(await viewportEvents(sessionId)).filter(
    (r) =>
      !r.closedAt &&
      (windowId == null || r.windowId === windowId) &&
      (mode == null || (r.mode || 'window') === mode)
  );
  for (const r of runs) {
    const ts = Date.now();
    // Only a resize-in-place run has anything to put back. A run that opened
    // its own window has no bounds to restore and, by the time this is called
    // from windows.onRemoved, no window either.
    if (restoreBounds && r.mode === 'resized') await restoreWindowBounds(r.windowId, r.restore);
    await appendEvent({
      sessionId,
      kind: 'viewport',
      phase: 'closed',
      ts,
      runId: r.runId,
      durationMs: ts - r.openedAt,
      mode: r.mode || 'window',
      // The clip filmed inside this run, when the tester started one there.
      // See runForWindow(): a window the extension opened cannot be filmed
      // automatically, but it can be filmed by the tester pressing the record
      // shortcut in it, and that clip is this run's. A resize-in-place run
      // never claims a clip this way — it is inside the session's own clip,
      // which stays the session's, and `clip` below is how the report finds
      // the stretch of it that belongs to this run.
      mediaId: r.mode === 'resized' ? null : (await lastMediaForRun(sessionId, r.runId)) || null,
      clip:
        r.mode === 'resized' && r.clip?.startedAt
          ? { ...r.clip, endOffsetMs: Math.max(0, ts - r.clip.startedAt) }
          : null,
      reason,
    });
    await broadcast({ type: 'UQA_VIEWPORT_CHANGED', runId: r.runId, phase: 'closed', sessionId });
  }
  return runs.length;
}
