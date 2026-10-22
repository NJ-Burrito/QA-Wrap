/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/* What to do with a session the browser never let finish. */

import { isFailure, dupeKey, liteProblem } from './events.js';
import { hostOf, isFirstPartyHost } from './origins.js';
import { eraseStores, eraseLocalKeys, eraseSessionKeys, maskPrefix, statePrefix } from './store-registry.js';

/** Read `id` out of either a Map or a plain object of last-event timestamps. */
function lastTs(lastTsById, id) {
  if (!lastTsById) return undefined;
  if (typeof lastTsById.get === 'function') return lastTsById.get(id);
  return Object.prototype.hasOwnProperty.call(lastTsById, id) ? lastTsById[id] : undefined;
}

/**
 * The sessions a crash stranded, with the fields a stop would have written.
 *
 * @param {object[]} sessions        every stored session
 * @param {Map<string,number>|Record<string,number>} lastTsById
 *        the timestamp of each session's last stored event, where it has one
 * @param {string|string[]|Set<string>|null} runningId    the session(s) recording right now, if any (r7-06-1: one per window)
 * @returns {object[]} new session records to write back; the input is not mutated
 */
export function reconcile(sessions, lastTsById, runningId = null, bornBefore = Infinity) {
  const live = new Set(runningId == null ? [] : typeof runningId === 'string' ? [runningId] : runningId);
  const out = [];
  for (const session of sessions || []) {
    if (!session || session.status !== 'recording') continue;
    if (session.endedAt) continue;
    if (live.has(session.id)) continue;
    if (Number(session.startedAt) > bornBefore) continue; // D-211: started after this worker did, so a crash cannot have stranded it

    // The last thing the session recorded is the closest honest answer to when
    // it stopped; a session that recorded nothing gets its own start, which
    // gives it a zero-length duration rather than a false one.
    const last = Number(lastTs(lastTsById, session.id));
    const started = Number(session.startedAt) || 0;
    const endedAt = Number.isFinite(last) && last > 0 ? Math.max(last, started) : started;

    out.push({
      ...session,
      endedAt,
      status: 'interrupted',
      // Explicitly unknown, and explicitly not zero. These four are counted by
      // `stopSession()` from state that the crash destroyed, so any number here
      // would be an invention — and "0 requests broken, 0 values masked" reads
      // as a clean session rather than a lost one, which is the worse lie.
      masked: null,
      cookies: null,
      rulesFired: null,
      toolsUsed: null,
    });
  }
  return out;
}

/**
 * Statuses a finished session can carry, and whether retention may delete it.
 *
 * `interrupted` is purgeable: it is a finished session, just not one anybody
 * chose to finish, and exempting it is exactly the hole this file exists to
 * close.
 */
export const PURGEABLE_STATUS = new Set(['stopped', 'interrupted']);

/** Rule 5: the cleanup takes only a session whose owner was told at least NOTICE_MS earlier, and never a kept one. `warn` = tell now (due within 8 days or past). */
export const NOTICE_MS = 7 * 864e5;
export function purgePlan(sessions, { days, now = Date.now(), running = null }) {
  const plan = { purge: [], warn: [] };
  for (const s of days ? sessions : []) {
    if (s.id === running || !s.endedAt || s.keep || (s.status && !PURGEABLE_STATUS.has(s.status))) continue;
    if (s.purgeNotice) { if (now - s.purgeNotice >= NOTICE_MS && s.endedAt <= now - days * 864e5) plan.purge.push(s); } else if (s.endedAt <= now - (days - 8) * 864e5) plan.warn.push(s);
  }
  return plan;
}

/* ── erasing ───────────────────────────────────────────────────────────── */

/**
 * Every store a session's bytes can be in.
 *
 * Written as a list rather than as four calls in the worker because the thing
 * that goes wrong with "delete everything" is never the deleting: it is the one
 * store nobody remembered, still holding a recording after the tester was told
 * the machine was clean. `mediaParts` and `mediaPending` are the two that were
 * forgotten in the first draft of this — a clip is written in parts, and a clip
 * interrupted mid-write leaves a pending row behind.
 */
export const ERASABLE_STORES = Object.freeze(eraseStores());

/** Local keys erase-all also removes: derived from the registry (T-054). */
export const ERASABLE_LOCAL_KEYS = Object.freeze(eraseLocalKeys());

/** The session-scoped keys that are not in IndexedDB at all. */
export const eraseKeys = (ids) => [...eraseSessionKeys(), ...ids.flatMap((id) => [`${maskPrefix()}${id}`, `${statePrefix()}${id}`])];

/**
 * What "sessions on this machine" says: how many, and how much room they take.
 *
 * Media is the only part worth counting — a session row is a few hundred bytes
 * and its events are compressed — so the number is honest about being the size
 * of the recordings and screenshots, which is what a tester is deciding about
 * when they read it. Sessions with no media count as sessions and add nothing.
 */
export function sessionFootprint(sessions = [], media = []) {
  const bytes = media.reduce((n, m) => n + (Number(m.bytes) || 0), 0);
  const starts = sessions.map((x) => Number(x.startedAt)).filter((n) => n > 0);
  return {
    oldest: starts.length ? Math.min(...starts) : null,
    sessions: sessions.length,
    media: media.length,
    bytes,
    mb: Math.round((bytes / (1024 * 1024)) * 10) / 10,
  };
}

/** English defaults for the footprint line; the same text lives in the en/ar pair under these keys, so a surface that passes `tr` speaks its own language. */
const FP_EN = {
  'options.safe.fp.none': 'No sessions on this machine yet.',
  'options.safe.fp.sessions': 'Sessions on this machine: {n}, {mb} MB.',
  'options.safe.fp.total': 'Total used by QA Wrap: {mb} MB.',
  'options.safe.fp.oldest': 'Oldest: {date}.',
  'options.safe.fp.quota': 'Storage is over 80 percent full; export or erase old sessions.',
  'options.safe.fp.unsupported': 'This browser cannot promise to keep them; it may clear them when the disk fills.',
  'options.safe.fp.persisted': 'The browser has agreed to keep them until you delete them.',
  'options.safe.fp.asked': 'The browser would not promise to keep them, so it may clear them when the disk fills. Save anything you need to keep.',
  'options.safe.fp.pending': 'The browser has not been asked to keep them yet. It will be at your next session.',
};
const say = (tr, key, vars = {}) => {
  const got = tr ? tr(key, vars) : null;
  const text = got && got !== key && !/MISSING/.test(got) ? got : FP_EN[key];
  return got && text === got ? got : text.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
};

/** "3 sessions, 41.2 MB", or the empty state, in the words both surfaces use. `tr` is the surface's t(); omitted, English. */
export function describeFootprint(footprint, tr) {
  const { sessions, mb } = footprint;
  let head = sessions ? say(tr, 'options.safe.fp.sessions', { n: sessions, mb }) : say(tr, 'options.safe.fp.none');
  if (footprint.totalBytes) head += ` ${say(tr, 'options.safe.fp.total', { mb: Math.round(footprint.totalBytes / 104857.6) / 10 })}`;
  if (footprint.oldest) head += ` ${say(tr, 'options.safe.fp.oldest', { date: new Date(footprint.oldest).toISOString().slice(0, 10) })}`;
  if (footprint.quotaWarn) head += ` ${say(tr, 'options.safe.fp.quota')}`;
  const tail = describePersistence(footprint?.persistence, tr);
  return tail ? `${head} ${tail}` : head;
}

/**
 * Whether the browser has promised to keep any of it.
 *
 * `unlimitedStorage` removes the quota, not the eviction: without a persistence
 * grant Chrome may clear this extension's whole origin when the disk fills, and
 * a tester who was promised thirty days would find an empty report instead. So
 * the answer is said out loud on the one line that is already about what is
 * stored, rather than being a fact only the console knows.
 *
 * Tester-facing, so no em dash.
 */
export function describePersistence(p, tr) {
  if (!p) return '';
  if (!p.supported) return say(tr, 'options.safe.fp.unsupported');
  if (p.persisted) return say(tr, 'options.safe.fp.persisted');
  if (p.asked) return say(tr, 'options.safe.fp.asked');
  return say(tr, 'options.safe.fp.pending');
}

/* ── how many findings this session holds ───────────────────────────────── */

/* The one answer to "how many problems did this run find". */

/** A session that has recorded nothing. */
export const BLANK_FINDINGS = Object.freeze({
  /** Every host the tester actually went to. The third-party split needs it. */
  hosts: [],
  /** How many failures came from each host; `''` means a failure with no URL. */
  failureHosts: {},
  /** The latest answer from each scan that replaces its own previous answer. */
  a11y: 0,
  links: 0,
  finePrint: 0,
  /** Clipped elements under layout stress, per frame. */
  rtl: {},
  /** Distinct problems: lite fingerprint -> host of the failing URL. The badge number. */
  fps: {},
});

/** Bounds tally storage; a session past this shows the badge stuck here, and the popup number wins. */
const FP_CAP = 500;

/** How many hosts a tally will remember. A session touching more is not what this number is for. */
const HOST_CAP = 200;

/**
 * Advance the tally by one event. Pure: the input is never mutated.
 *
 * @param {object} tally  the tally so far, or `BLANK_FINDINGS`
 * @param {object} event  one stored event
 */
export const FINDING_KINDS = Object.freeze(new Set(['a11y', 'links', 'fineprint', 'rtl']));

/** Whether this event can move the count; the worker's tally and countFindings() must see the same events. */
export function carriesFinding(event) {
  if (!event || typeof event !== 'object') return false;
  return event.kind === 'nav' || FINDING_KINDS.has(event.kind) || isFailure(event);
}

export function foldFinding(tally, event) {
  const t = { ...BLANK_FINDINGS, ...(tally || {}) };
  if (!carriesFinding(event)) return t;

  const hosts = new Set(t.hosts);
  // Where the tester went, which is the only thing the first-party test reads.
  if (event.kind === 'nav') {
    const h = hostOf(event.url);
    if (h) hosts.add(h);
  }
  if (event.frameUrl) {
    const h = hostOf(event.frameUrl);
    if (h) hosts.add(h);
  }
  const out = { ...t, hosts: hosts.size > HOST_CAP ? [...hosts].slice(0, HOST_CAP) : [...hosts] };

  if (isFailure(event)) {
    const key = hostOf(event.url) || '';
    out.failureHosts = { ...out.failureHosts, [key]: (out.failureHosts[key] || 0) + 1 };
    if (liteProblem(event)) {
      const fp = dupeKey(event);
      if (fp in out.fps || Object.keys(out.fps).length < FP_CAP) out.fps = { ...out.fps, [fp]: hostOf(event.url || event.src) || '' };
    }
    return out;
  }

  switch (event.kind) {
    case 'a11y':
      out.a11y = Number(event.total) || 0;
      return out;
    case 'links':
      // `broken` is an array on the stored event and a number on the summary
      // the popup gets back, so both shapes are read rather than one assumed.
      out.links = Array.isArray(event.broken) ? event.broken.length : Number(event.broken) || 0;
      return out;
    case 'fineprint':
      out.finePrint = Number(event.counts?.gaps) || 0;
      return out;
    case 'rtl': {
      const frame = event.frameUrl || '';
      // Turning the stress off is an event too, and it reports nothing clipped.
      const n = event.enabled === false ? 0 : Number(event.overflowCount) || 0;
      out.rtl = { ...out.rtl, [frame]: n };
      return out;
    }
    default:
      return out;
  }
}

/**
 * Read a tally as numbers a surface can print.
 *
 * The third-party split is applied here rather than in the fold, so that a host
 * the tester navigated to *after* its beacon failed is still counted as their
 * own. Doing it at fold time would have classified that failure for ever on the
 * evidence of the moment it arrived.
 */
export function findingTotals(tally) {
  const t = { ...BLANK_FINDINGS, ...(tally || {}) };
  const hosts = new Set(t.hosts);
  let failures = 0;
  let thirdParty = 0;
  const theirHosts = [];
  for (const [host, n] of Object.entries(t.failureHosts || {})) {
    const count = Number(n) || 0;
    if (host && !isFirstPartyHost(host, hosts)) {
      thirdParty += count;
      if (count) theirHosts.push(host);
    } else {
      failures += count;
    }
  }
  let errors = 0;
  let warnings = 0;
  for (const h of Object.values(t.fps || {})) {
    if (h && !isFirstPartyHost(h, hosts)) warnings++;
    else errors++;
  }
  const rtl = Object.values(t.rtl || {}).reduce((n, x) => n + (Number(x) || 0), 0);
  const a11y = Number(t.a11y) || 0;
  const links = Number(t.links) || 0;
  const finePrint = Number(t.finePrint) || 0;
  return {
    failures,
    thirdParty,
    theirHosts,
    a11y,
    links,
    rtl,
    finePrint,
    /** Distinct fingerprints: what the badge shows. Errors are first party, warnings third party. */
    problems: errors + warnings,
    errors,
    warnings,
    total: failures + a11y + links + rtl + finePrint,
  };
}

/**
 * Every finding in a session, in one call.
 *
 * @param {object[]} events   the session's events, in any order
 * @param {object} [opts]
 * @param {object} [opts.session] the session record, for its start URL
 */
export function countFindings(events = [], { session = null } = {}) {
  let tally = BLANK_FINDINGS;
  const start = hostOf(session?.startUrl);
  if (start) tally = { ...tally, hosts: [start] };
  for (const e of events) tally = foldFinding(tally, e);
  return findingTotals(tally);
}

/**
 * The headline sentence, written once so three surfaces cannot word it three
 * ways. Tester-facing, so no em dash.
 */
export function describeFindings(totals) {
  const t = totals || findingTotals(BLANK_FINDINGS);
  const parts = [];
  if (t.failures) parts.push(t.failures === 1 ? '1 failed request or error' : `${t.failures} failed requests or errors`);
  if (t.a11y) parts.push(`${t.a11y} accessibility violation${t.a11y === 1 ? '' : 's'}`);
  if (t.links) parts.push(`${t.links} broken link${t.links === 1 ? '' : 's'}`);
  if (t.rtl) parts.push(`${t.rtl} element${t.rtl === 1 ? '' : 's'} clipped under layout stress`);
  if (t.finePrint) parts.push(`${t.finePrint} fine print gap${t.finePrint === 1 ? '' : 's'}`);
  if (!parts.length) return 'Nothing was found. The checks a machine cannot make still apply.';
  const last = parts.pop();
  return `${parts.length ? `${parts.join(', ')} and ` : ''}${last}.`;
}

/* ── window-size runs ───────────────────────────────────────────────────── */

/**
 * The fold, in the shape §8 fixes: oldest first, an array and never null.
 *
 * Here rather than in the worker for the reason everything else in this file is
 * here: the decision is arithmetic on records and the storage round trip is
 * not, so `tools/test-sessions.mjs` can check it in plain Node. It also makes
 * `UQA_VIEWPORT_RUNS` provably a fold over the two events rather than a second
 * store that can disagree with them.
 */
export function viewportRuns(events = []) {
  const byRun = new Map();
  for (const e of events) {
    if (e?.kind !== 'viewport' || !e.runId) continue;
    if (e.phase === 'opened') {
      byRun.set(e.runId, {
        runId: e.runId,
        viewport: e.viewport || null,
        measured: e.measured || null,
        // Whether the browser gave the size that was asked for. Absent on runs
        // recorded before 8 September 2026, and absent means "nobody checked",
        // which is not the same as "no" — so it is only ever false when the
        // event said so.
        exact: e.exact !== false,
        // 'window' — a window the worker opened. 'resized' — the session's own
        // window, put at the size in place so the clip already running keeps
        // filming it. Older events carry neither and are windows.
        mode: e.mode || 'window',
        // Where in the session's own clip a resize-in-place run sits:
        // `{ mediaId, startedAt, offsetMs, endOffsetMs }`. Null for a run that
        // opened its own window.
        clip: e.clip || null,
        // The bounds to put the window back to. The worker's business; the
        // report ignores it.
        restore: e.restore || null,
        openedAt: e.ts,
        closedAt: null,
        durationMs: null,
        windowId: e.windowId ?? null,
        tabId: e.tabId ?? null,
        url: e.url || null,
        inherited: e.inherited || { video: false, mask: false, mic: false, tabAudio: false },
        refused: e.refused || [],
        mediaId: null,
        reason: null,
      });
    } else if (e.phase === 'closed') {
      const run = byRun.get(e.runId);
      if (!run) continue;
      run.closedAt = e.ts;
      run.durationMs = e.durationMs ?? e.ts - run.openedAt;
      run.mediaId = e.mediaId ?? null;
      run.reason = e.reason || 'closed';
      // The end of the stretch of the clip this run occupies. Only the closed
      // event knows it, and it is merged rather than replacing what the open
      // event said, so a close that carried no clip cannot erase one.
      if (e.clip) run.clip = { ...(run.clip || {}), ...e.clip };
    }
  }
  return [...byRun.values()].sort((a, b) => a.openedAt - b.openedAt);
}

/** Stop waits for a Start in flight (1015: Stop mid-Start said "nothing to stop", then the session started). A failed Start still settles. Chrome-free for test-sessions. */
export function startStopLock() {
  /** @type {Set<Promise<unknown>>} */
  const pending = new Set();
  return {
    /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
    start(fn) { const p = Promise.resolve().then(fn); const done = () => pending.delete(p); pending.add(p); p.then(done, done); return p; },
    settled: () => Promise.allSettled([...pending]),
  };
}
