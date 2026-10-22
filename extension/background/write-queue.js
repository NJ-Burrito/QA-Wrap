/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/* The event write queue: */

import { withDeadline } from '../platform/deadline.js';
import { isTesterNote } from '../core/events.js';
export const FLUSH_MS = 50;
export const MAX_BATCH = 32;
export const MAX_PENDING = 5000;
export const ROW_CAP = 200000;
export const BODY_CAP = 256 * 1024 * 1024;
export const LOW_DISK = 200 * 1024 * 1024;
export const DISK_CHECK_MS = 60000;
export const TESTER_ALLOW = 5000; // per session, past the row cap (rule 4)
/** Tester-authored rows (a note the tester wrote, a screenshot). Decided here from the worker-built event, never from a field a page sends. */
export const isTesterRow = (e) => e?.kind === 'screenshot' || isTesterNote(e);
const GAP_TEXT = {
  'session-cap': 'Capture gap: this recording reached its event limit, so later events were not stored.',
  'body-cap': 'Capture gap: this recording reached its body size limit, so later request and response bodies were not stored.',
  'low-disk': 'Capture gap: free browser storage is low, so this recording may not save completely.',
};
const BODY_FIELDS = ['reqBody', 'responsePreview'];

/**
 * @param {object} opts
 * @param {(batch: object[]) => Promise<any>} opts.write  what actually stores a
 *   batch — `appendEvents` in the worker, a fake in the tests
 * @param {number} [opts.flushMs]   idle time before an unfilled batch is written
 * @param {number} [opts.maxBatch]  events that force a flush without waiting
 * @param {number} [opts.maxPending] total events held before new ones are shed
 * @param {typeof setTimeout} [opts.schedule]
 * @param {typeof clearTimeout} [opts.cancel]
 * @param {(err: Error, batch: object[]) => void} [opts.onError]
 * @param {(sessionId: string, n: number) => void} [opts.onLost]  events refused by the row cap
 * @param {(sessionId: string) => void} [opts.onCap]  once per session when the row cap first refuses a page event (the worker rolls to the next part)
 * @param {() => Promise<{quota?: number, usage?: number}>} [opts.estimate]  navigator.storage.estimate
 * @param {() => number} [opts.now]
 * @param {number} [opts.rowCap]
 * @param {number} [opts.bodyCap]
 * @param {number} [opts.lowDisk]
 * @param {(sessionId: string) => Promise<{rows?: number, gaps?: string[]}>} [opts.seed]  r9-06-1: a session's stored rows and gap codes, read on its first push after a wake
 */
export function createWriteQueue({
  write,
  flushMs = FLUSH_MS,
  maxBatch = MAX_BATCH,
  maxPending = MAX_PENDING,
  schedule = setTimeout,
  cancel = clearTimeout,
  onError = () => {},
  onLost = () => {},
  onCap = () => {},
  estimate = globalThis.navigator?.storage?.estimate?.bind(navigator.storage),
  now = Date.now,
  rowCap = ROW_CAP,
  bodyCap = BODY_CAP,
  lowDisk = LOW_DISK,
  seed,
} = /** @type {any} */ ({})) {
  /** One queue per session: `seq` is the store's auto-increment, so a batch must be one session's contiguous run. */
  const queues = new Map();
  let timer = null;
  /** The flush in progress, so two callers never write the same batch twice. */
  let inFlight = null;
  const shed = []; // dropped events awaiting one onError call
  const stats = new Map(); // sessionId -> { rows, bytes, gaps }
  const lost = new Map(); // sessionId -> events refused by the row cap, reported at the next flush
  let lastCheck = -Infinity;
  let low = false;

  function arm() {
    if (timer != null) return;
    timer = schedule(() => {
      timer = null;
      flush().catch(() => {});
    }, flushMs);
  }

  function disarm() {
    if (timer == null) return;
    cancel(timer);
    timer = null;
  }

  /** How many events are waiting, in total or for one session. */
  function size(sessionId) {
    if (sessionId != null) return queues.get(sessionId)?.length || 0;
    let n = 0;
    for (const list of queues.values()) n += list.length;
    return n;
  }

  /** Add one event; the promise settles when it is written (or refused). */
  function gap(id, st, code) {
    if (st.gaps.has(code)) return;
    st.gaps.add(code);
    enqueue({ sessionId: id, kind: 'note', tag: 'capture-gap', gap: code, ts: now(), text: GAP_TEXT[code] }).catch(() => {});
  }

  /** Page telemetry. `tester` is passed only by the worker, for events it built itself (see `pushTester`); an event's own fields never grant it. */
  function push(event, tester = false) {
    tester = tester === true && isTesterRow(event);
    if (!tester && size() >= maxPending) { // r5-07-3
      const err = new Error('Write queue full');
      if (!shed.length) Promise.resolve().then(() => { try { onError(err, shed.splice(0)); } catch { /* ignore */ } });
      shed.push(event);
      return Promise.reject(err);
    }
    const id = event?.sessionId ?? null;
    let st = stats.get(id);
    if (!st) {
      stats.set(id, st = { rows: 0, bytes: 0, gaps: new Set(), ready: null });
      const mine = st;
      if (seed && id != null) mine.ready = Promise.resolve().then(() => seed(id)).then((s) => { mine.rows = Number(s?.rows) || 0; for (const g of s?.gaps || []) mine.gaps.add(g); }, () => {}).then(() => { mine.ready = null; });
    }
    return st.ready ? st.ready.then(() => admit(event, id, st, tester)) : admit(event, id, st, tester);
  }

  /** A tester-authored row is admitted past the row cap (own allowance) and past queue pressure, and is never shed. */
  const pushTester = (event) => push(event, true);

  function admit(event, id, st, tester) {
    if (estimate && now() - lastCheck >= DISK_CHECK_MS) {
      lastCheck = now();
      Promise.resolve().then(estimate).then((e) => {
        low = e.quota - e.usage < lowDisk;
        if (low) for (const [k, v] of stats) gap(k, v, 'low-disk');
      }).catch(() => {});
    }
    if (low) gap(id, st, 'low-disk');
    if (st.rows >= rowCap && !(tester && (st.tester = (st.tester || 0) + 1) <= TESTER_ALLOW)) {
      gap(id, st, 'session-cap');
      if (!st.capped) { st.capped = true; try { onCap(id); } catch { /* the roll is best effort */ } }
      lost.set(id, (lost.get(id) || 0) + 1);
      arm();
      return Promise.reject(new Error('Session event limit reached'));
    }
    let bytes = 0;
    for (const f of BODY_FIELDS) if (typeof event[f] === 'string') bytes += event[f].length;
    if (bytes) {
      if (st.gaps.has('body-cap') || st.bytes + bytes > bodyCap) {
        event = { ...event };
        for (const f of BODY_FIELDS) delete event[f];
        gap(id, st, 'body-cap');
      } else st.bytes += bytes;
    }
    st.rows++;
    return enqueue(event);
  }

  function enqueue(event) {
    const sessionId = event?.sessionId ?? null;
    if (!queues.has(sessionId)) queues.set(sessionId, []);
    const list = queues.get(sessionId);
    let settle;
    const written = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    list.push({ event, settle });

    // A full batch beats the timer.
    if (list.length >= maxBatch) flush().catch(() => {});
    else arm();
    return written;
  }

  /** Write everything waiting; resolves only once it is on disk. Re-entrant: waits for the batch in flight, then re-checks. */
  async function flush() {
    for (const [id, n] of lost) { try { onLost(id, n); } catch { /* a throwing reporter must not block the flush */ } }
    lost.clear();
    while (inFlight) await inFlight.catch(() => {});
    if (!size()) return;
    disarm();

    inFlight = (async () => {
      // Taken before the first await, capped at maxBatch so one transaction stays small; the rest goes in the trailing pass.
      const batches = [];
      for (const [sessionId, list] of queues) {
        if (!list.length) continue;
        batches.push([sessionId, list.splice(0, maxBatch)]);
      }
      for (const [, list] of batches) {
        const events = list.map((entry) => entry.event);
        try {
          let records;
          try {
            records = await withDeadline(write(events), 'tx');
          } catch (e) {
            // A timed-out write may still commit, so it is never retried (that would duplicate the batch);
            // it is reported and the queue moves on instead of freezing every flush behind it.
            if (e?.code === 'SLOW' || e?.name === 'QuotaExceededError') throw e; // r2-06-4
            // One retry: a transient abort should not cost the batch. A second
            // failure is reported, never looped.
            records = await withDeadline(write(events), 'tx');
          }
          list.forEach((entry, i) => entry.settle.resolve(records?.[i] ?? events[i]));
        } catch (err) {
          // The batch is all-or-nothing at the store, so it is all-or-nothing
          // here too. Retried once above, then reported: a retry loop against a full
          // disk is how a worker stops answering anything at all.
          if (err?.code === 'SLOW') err.unconfirmed = true; // r2-06-4: may still have committed
          try { onError(err, events); } catch { /* a throwing reporter must not strand the promises */ }
          list.forEach((entry) => entry.settle.reject(err));
        }
      }
    })();

    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    // A batch that filled up while the previous one was committing.
    if (size()) await flush();
  }

  /** Hand one session's waiting events to the stop path, which writes them in the same transaction as the session row. */
  function take(sessionId) {
    const list = queues.get(sessionId) || [];
    queues.delete(sessionId);
    stats.delete(sessionId);
    if (!size()) disarm();
    return {
      events: list.map((entry) => entry.event),
      resolve: (records) => list.forEach((entry, i) => entry.settle.resolve(records?.[i] ?? entry.event)),
      // r4-06-1: a failed stop write reports the taken events like a failed flush does.
      reject: (err) => {
        try { onError(err, list.map((entry) => entry.event)); } catch { /* the promises settle regardless */ }
        list.forEach((entry) => entry.settle.reject(err));
      },
    };
  }

  return { push, pushTester, flush, take, size, get armed() { return timer != null; } };
}
