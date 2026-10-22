/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Everything a feature holds that belongs to *this* session and nothing else.
 *
 * The bug this exists to kill: state that outlives the session that created it.
 * A break-a-request rule armed on Tuesday was still armed on Wednesday, layout
 * stress left on stayed on, and the tester's next session inherited a browser
 * that had been quietly reconfigured by the last one. Every one of those looks
 * like a product bug in the app under test, which is the worst possible failure
 * for a tool whose whole job is to tell you what the app did.
 *
 * So: one record per session, cleared and rebuilt whenever a session starts, and
 * discarded when it stops. `chrome.storage.session` is the right home — it is
 * wiped when the browser closes, which is exactly the lifetime wanted, and a
 * service worker that gets suspended mid-session finds it intact on wake.
 *
 * "Per session, not per extension" is the rule. If a feature needs to remember
 * something, it remembers it here.
 */

/**
 * One record per session, and the session id is in the key.
 *
 * It used to be a single `sessionState` key, so a second window starting a session overwrote the first one's rules,
 * tool counts and layout-stress flag. Keying by session is what lets two windows record at once (brief item G3);
 * everything else is unchanged: `chrome.storage.session`, wiped when the browser closes, reset on every start.
 *
 * `none` is the key for state that belongs to no session. Nothing writes there
 * today; it exists so a caller that has lost its session id corrupts nothing.
 */
import { withDeadline } from '../platform/deadline.js';

const PREFIX = 'sessionState:';

const keyFor = (sessionId) => `${PREFIX}${sessionId || 'none'}`;

/** The clean slate. Anything not listed here is not session state. */
export const BLANK = {
  sessionId: null,
  /** Request rules armed for this session. Each carries its own countdown. */
  rules: [],
  /** How many times each rule has actually fired, for the report. */
  fired: {},
  /** Whether layout stress was left on, so it can be turned off at stop. */
  rtl: false,
  /** Which timeline kinds the tester has filtered out, in this session only. */
  hiddenKinds: [],
  /** Capture choices made for this session — mic, tab audio, webcam. */
  capture: null,
  /**
   * Which tools have actually been used in this session.
   *
   * Keyed by tool id: `{ count, firstAt, lastAt }`. This is what lets the popup
   * answer the question a tester actually has in front of them — "have I
   * checked accessibility on this run, or am I thinking of the last one?" —
   * without them having to remember. It resets with the session, like
   * everything else here, so a tick always means *this* run.
   */
  used: {},
  /** r2-01-3: refused events, timed-out (unconfirmed) events, and the raw start URL for the cookie read. */
  captureLost: 0,
  unconfirmed: 0,
  rawStartUrl: null,
};

/* ── which tools have been used ─────────────────────────────────────────── */

/**
 * Record that a tool ran.
 *
 * Counted rather than flagged, because "I took a screenshot" and "I took
 * eleven" are different states of a session, and a tester glancing at the popup
 * should be able to tell them apart.
 */
export async function noteUse(sessionId, tool, extra = {}) {
  let entry; // D-1010-107: the read happens inside the chain, so two overlapping calls both count
  await update(sessionId, (state) => {
    const prev = state.used[tool] || { count: 0, firstAt: null };
    const now = Date.now();
    entry = { ...prev, ...extra, count: prev.count + 1, firstAt: prev.firstAt ?? now, lastAt: now };
    return { used: { ...state.used, [tool]: entry } };
  });
  return entry;
}

/** Everything used so far, for painting the popup. */
export async function getUsed(sessionId) {
  return (await getState(sessionId)).used;
}

export async function getState(sessionId) {
  const key = keyFor(sessionId);
  const { [key]: state } = await chrome.storage.session.get(key);
  return { ...BLANK, sessionId: sessionId ?? null, ...(state || {}) };
}

// One chain for every read-modify-write (r2-01-3).
let chain = Promise.resolve();
function update(sessionId, make, live) {
  const run = chain.then(async () => {
    const cur = await withDeadline(getState(sessionId), 'sync');
    if (live && !(await withDeadline(chrome.storage.session.get(keyFor(sessionId)), 'sync'))[keyFor(sessionId)]) return cur; // a stopped session gets no record back
    const patch = make(cur);
    if (!patch) return cur; // nothing to write (a forged rule id)
    const next = { ...cur, ...patch };
    await withDeadline(chrome.storage.session.set({ [keyFor(sessionId)]: next }), 'sync');
    return next;
  });
  chain = run.catch(() => {});
  return run;
}

export const setState = (sessionId, patch) => update(sessionId, () => patch);

/** Add to the lost / unconfirmed counters; returns the new state. */
export const addLost = (sessionId, lost, unconfirmed) =>
  update(sessionId, (s) => (unconfirmed ? { unconfirmed: s.unconfirmed + lost } : { captureLost: s.captureLost + lost }), true);

/**
 * Start fresh for a new session.
 *
 * Called on every start, not only the first: opening a second session must put
 * every feature back to its default, or the second run is measuring the first
 * one's leftovers.
 */
export async function resetFor(sessionId) {
  const state = { ...BLANK, sessionId };
  await chrome.storage.session.set({ [keyFor(sessionId)]: state });
  return state;
}

export async function clearState(sessionId) {
  await chrome.storage.session.remove(keyFor(sessionId));
}

/**
 * Every session that still has state in this browser session.
 *
 * Used by the reconciliation sweep: a worker that was killed between
 * `putSession` and `clearState` leaves a record behind, and with the key now
 * carrying the id there is no single key to remove blindly.
 */
export async function knownSessions() {
  const all = await chrome.storage.session.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(PREFIX))
    .map((k) => k.slice(PREFIX.length))
    .filter((id) => id && id !== 'none');
}

/* ── request rules, which are the reason this file exists ───────────────── */

/**
 * Rules stack. Arming a second one does not replace the first.
 *
 * The old model kept a single rule under a fixed id, so every new rule silently
 * overwrote the last — a tester who armed "fail /login" and then "500 on
 * /submit" had only the second, and no way to tell. Now each gets its own id and
 * its own countdown, and the UI lists all of them.
 */
export async function getRules(sessionId) {
  return (await getState(sessionId)).rules;
}

export async function addRule(sessionId, rule) {
  const id = rule.id || `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  return (await update(sessionId, (state) => ({ rules: [...state.rules.filter((r) => r.id !== id), { ...rule, id, armedAt: Date.now() }] }))).rules;
}

export async function replaceRules(sessionId, rules) {
  await setState(sessionId, { rules: rules || [] });
  return rules || [];
}

export async function removeRule(sessionId, id) {
  return (await update(sessionId, (state) => ({ rules: state.rules.filter((r) => r.id !== id) }))).rules;
}

/**
 * Count one firing against a rule's budget.
 *
 * The page holds its own copy of the rules and decrements as it goes, but the
 * page is torn down on every navigation — so the authoritative countdown has to
 * live here, where it survives. Without this, "break the next 3 requests"
 * silently became "break 3 requests per page load".
 */
export async function consumeRule(sessionId, id) {
  // 02-4: the id comes from a page. An id that is not a short string, or names no rule of this
  // session, writes nothing (a forged one used to grow `fired` without limit).
  if (typeof id !== 'string' || !id || id.length > 64) return null;
  const next = await update(sessionId, (state) => (!state.rules.some((r) => r.id === id) ? null : {
    rules: state.rules.map((r) => (r.id === id && r.remaining != null ? { ...r, remaining: Math.max(0, r.remaining - 1) } : r)),
    fired: { ...state.fired, [id]: (state.fired[id] || 0) + 1 },
  }));
  return next.rules.find((r) => r.id === id) || null;
}

/** A rule with no budget left is spent, but stays listed so the tester can see it fired. */
export const isSpent = (rule) => rule.remaining != null && rule.remaining <= 0;
export const isLive = (rule) => rule.enabled !== false && !isSpent(rule);
