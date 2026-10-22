/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The flush rules of the event write queue.
 *
 * `ingest()` no longer writes an event the moment it arrives; it pushes onto a
 * queue that batches. That is only safe if three things are true, and all three
 * are what this file checks:
 *
 *   1. **A batch is written when it should be** — at 32 events, or 50 ms after
 *      the first one, whichever comes first.
 *   2. **Order survives.** `seq` is the store's auto-increment, so the order a
 *      batch is handed to the store is the order the timeline is numbered in.
 *      Sessions are queued separately for the same reason.
 *   3. **A flush means it is written.** Everything downstream — stopping a
 *      session, an export, the panel's poll — depends on `flush()` not
 *      resolving until the store has the events. If that is ever untrue, a
 *      report is quietly short and nothing anywhere reports an error.
 *
 * The store is a fake, and time is a fake: `schedule`/`cancel` are injected, so
 * the 50 ms rule is tested by driving the clock rather than by sleeping. A test
 * that waits 50 ms of real time is a test that is flaky on a loaded machine.
 */
import assert from 'node:assert/strict';
import { createWriteQueue, FLUSH_MS, MAX_BATCH, MAX_PENDING, ROW_CAP, BODY_CAP, LOW_DISK, DISK_CHECK_MS } from '../background/write-queue.js';
import 'fake-indexeddb/auto';
import fsSync from 'node:fs';
import { DEADLINES, withDeadline } from '../platform/deadline.js';
import { lift } from './lib-lift.mjs';
import * as dbm from '../core/db.js';
import { workerSrc } from './lib-worker-src.mjs';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/** A clock the test drives by hand. */
function fakeClock() {
  let next = 1;
  const timers = new Map();
  return {
    schedule(fn, ms) { const id = next++; timers.set(id, { fn, ms }); return id; },
    cancel(id) { timers.delete(id); },
    pending: () => timers.size,
    /** Fire every timer that is due, the way setTimeout would. */
    async tick() {
      const due = [...timers.entries()];
      timers.clear();
      for (const [, t] of due) await t.fn();
      // The flush a timer starts is async; let its microtasks run.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

/** A store that records what it was given, and can be told to stall or fail. */
function fakeStore() {
  const batches = [];
  let gate = null;
  let fail = null;
  let failTimes = 0;
  return {
    batches,
    get written() { return batches.flat(); },
    stall() { let open; gate = new Promise((r) => { open = r; }); return open; },
    failNext(err, times = 2) { fail = err; failTimes = times; }, // 2 = the first write and its one retry
    async write(events) {
      if (fail) { const e = fail; if (--failTimes <= 0) fail = null; throw e; }
      if (gate) { const g = gate; gate = null; await g; }
      batches.push(events);
      return events.map((e, i) => ({ ...e, seq: batches.flat().length - events.length + i + 1 }));
    },
  };
}

const ev = (sessionId, n) => ({ sessionId, kind: 'net', ts: 1000 + n, url: `/r/${n}` });

console.log('write-queue — when a batch is written, and in what order');

/* ── the two rules ──────────────────────────────────────────────────────── */

await test('the published rules are the ones the audit asked for', () => {
  assert.equal(FLUSH_MS, 50);
  assert.equal(MAX_BATCH, 32);
});

await test('one event is not written immediately — it waits for the timer', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  q.push(ev('s1', 1));
  await Promise.resolve();
  assert.equal(store.batches.length, 0, 'nothing may reach the store before the timer or a full batch');
  assert.equal(q.size(), 1);
  assert.equal(clock.pending(), 1, 'a timer must be armed, or the event never lands');
});

await test('the timer writes what is waiting, once', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  q.push(ev('s1', 1));
  q.push(ev('s1', 2));
  await clock.tick();
  assert.equal(store.batches.length, 1, 'two events, one transaction — that is the whole point');
  assert.equal(store.written.length, 2);
  assert.equal(q.size(), 0);
});

await test('a full batch is written without waiting for the timer', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  for (let i = 0; i < MAX_BATCH; i++) q.push(ev('s1', i));
  // No tick: the 32nd push is what fires it.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(store.batches.length, 1, 'the 32nd event must flush by itself');
  assert.equal(store.written.length, MAX_BATCH);
});

await test('a batch never exceeds the cap in one transaction', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  for (let i = 0; i < MAX_BATCH * 3; i++) q.push(ev('s1', i));
  await q.flush();
  assert.equal(store.written.length, MAX_BATCH * 3, 'every event lands');
  for (const batch of store.batches) {
    assert.ok(batch.length <= MAX_BATCH, `a batch of ${batch.length} exceeds the cap`);
  }
});

await test('the timer is disarmed once the queue is empty', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  q.push(ev('s1', 1));
  assert.equal(q.armed, true);
  await q.flush();
  assert.equal(q.armed, false, 'a timer left armed over an empty queue wakes the worker for nothing');
});

/* ── order ──────────────────────────────────────────────────────────────── */

await test('events reach the store in the order they were pushed', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  for (let i = 0; i < 20; i++) q.push(ev('s1', i));
  await q.flush();
  assert.deepEqual(store.written.map((e) => e.url), Array.from({ length: 20 }, (_, i) => `/r/${i}`));
});

await test('two sessions are never interleaved in one batch', async () => {
  // `seq` is assigned by the store in write order. Two sessions in one
  // transaction would number them as though they had happened alternately.
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  q.push(ev('s1', 1));
  q.push(ev('s2', 1));
  q.push(ev('s1', 2));
  q.push(ev('s2', 2));
  await q.flush();
  for (const batch of store.batches) {
    const ids = new Set(batch.map((e) => e.sessionId));
    assert.equal(ids.size, 1, `a batch mixed ${[...ids].join(' and ')}`);
  }
  assert.equal(store.written.length, 4);
});

await test('each session keeps its own order inside its own batch', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  for (let i = 0; i < 6; i++) { q.push(ev('s1', i)); q.push(ev('s2', i)); }
  await q.flush();
  for (const id of ['s1', 's2']) {
    const seen = store.written.filter((e) => e.sessionId === id).map((e) => e.url);
    assert.deepEqual(seen, Array.from({ length: 6 }, (_, i) => `/r/${i}`), `${id} came back out of order`);
  }
});

/* ── the flush contract ─────────────────────────────────────────────────── */

await test('flush does not resolve until the store has actually written', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  q.push(ev('s1', 1));
  const open = store.stall();
  let done = false;
  const flushing = q.flush().then(() => { done = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(done, false, 'flush resolved while the store was still writing');
  open();
  await flushing;
  assert.equal(done, true);
  assert.equal(store.written.length, 1);
});

await test('flush on an empty queue is a no-op, not a wasted transaction', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  await q.flush();
  assert.equal(store.batches.length, 0);
});

await test('two flushes at once write each event exactly once', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  for (let i = 0; i < 5; i++) q.push(ev('s1', i));
  const open = store.stall();
  const a = q.flush();
  const b = q.flush();
  open();
  await Promise.all([a, b]);
  assert.equal(store.written.length, 5, 'a duplicated batch would duplicate the timeline');
});

await test('an event pushed while a batch commits is included by the flush that is running', async () => {
  // This is the rule stopping a session depends on: a request that lands in the
  // gap between "flush" and "written" must not be the one that goes missing.
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  q.push(ev('s1', 1));
  const open = store.stall();
  const flushing = q.flush();
  await Promise.resolve();
  q.push(ev('s1', 2));
  open();
  await flushing;
  assert.equal(store.written.length, 2, 'the late event was left behind');
  assert.equal(q.size(), 0);
});

await test('the promise push returns settles when the event is stored', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  const written = q.push(ev('s1', 1));
  let settled = false;
  written.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  await q.flush();
  assert.equal(settled, true);
});

/* ── failure ────────────────────────────────────────────────────────────── */

await test('a failed batch is reported, not retried for ever', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const errors = [];
  const q = createWriteQueue({ write: store.write, ...clock, onError: (err, batch) => errors.push([err, batch]) });
  store.failNext(new Error('QuotaExceededError'));
  q.push(ev('s1', 1)).catch(() => {});
  await q.flush();
  assert.equal(errors.length, 1, 'a full disk must be said out loud');
  assert.equal(errors[0][0].message, 'QuotaExceededError');
  assert.equal(errors[0][1].length, 1);
  assert.equal(q.size(), 0, 'a failed batch is dropped, not left to block every later write');
});

await test('one transient failure is retried once and lands', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const errors = [];
  const q = createWriteQueue({ write: store.write, ...clock, onError: (e) => errors.push(e) });
  store.failNext(new Error('blip'), 1);
  const written = q.push(ev('s1', 1));
  await q.flush();
  await written;
  assert.equal(errors.length, 0, 'a batch that landed on the retry is not a failure');
  assert.equal(store.written.length, 1);
});

await test('a failed batch rejects the promises it handed out', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  store.failNext(new Error('nope'));
  const written = q.push(ev('s1', 1));
  await q.flush();
  await assert.rejects(() => written, /nope/);
});

await test('one session failing does not lose another session s batch', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock, onError: () => {} });
  store.failNext(new Error('first batch only'));
  q.push(ev('s1', 1)).catch(() => {});
  q.push(ev('s2', 1)).catch(() => {});
  await q.flush();
  assert.equal(store.written.length, 1, 'the second session must still be written');
  assert.equal(store.written[0].sessionId, 's2');
});

/* ── take(), the atomic stop ────────────────────────────────────────────── */

await test('take removes a session s events and hands them over', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  q.push(ev('s1', 1));
  q.push(ev('s1', 2));
  q.push(ev('s2', 1));
  const taken = q.take('s1');
  assert.equal(taken.events.length, 2);
  assert.deepEqual(taken.events.map((e) => e.url), ['/r/1', '/r/2']);
  assert.equal(q.size('s1'), 0);
  assert.equal(q.size('s2'), 1, 'another session must not be taken with it');
  taken.resolve();
  await q.flush();
  // Only s2 reached the store: s1's events are the caller's to write, in its
  // own transaction with the session row.
  assert.equal(store.written.length, 1);
  assert.equal(store.written[0].sessionId, 's2');
});

await test('take on a session with nothing waiting is empty, not an error', () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  const taken = q.take('never-seen');
  assert.deepEqual(taken.events, []);
  taken.resolve();
});

await test('a failed stop rejects the promises of the events it took', async () => {
  const clock = fakeClock();
  const store = fakeStore();
  const q = createWriteQueue({ write: store.write, ...clock });
  const written = q.push(ev('s1', 1));
  q.take('s1').reject(new Error('the stop transaction aborted'));
  await assert.rejects(() => written, /the stop transaction aborted/);
});

await test('06-1: a retry that never settles cannot wedge the queue (deadline on the retry too)', async () => {
  const keep = DEADLINES.tx;
  DEADLINES.tx = 30;
  try {
    const clock = fakeClock();
    const written = [];
    let calls = 0;
    const write = (events) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('transient abort')); // not SLOW, so it is retried once
      if (calls === 2) return new Promise(() => {}); // the retry hangs for ever
      written.push(...events);
      return Promise.resolve(events);
    };
    const q = createWriteQueue({ write, ...clock, onError: () => {} });
    const first = q.push(ev('s1', 1));
    first.catch(() => {});
    await q.flush();
    await assert.rejects(() => first, (e) => e.code === 'SLOW');
    q.push(ev('s1', 2));
    await q.flush();
    assert.equal(written.length, 1, 'a later push still flushes after the hung retry');
    assert.equal(written[0].url, '/r/2');
  } finally {
    DEADLINES.tx = keep;
  }
});

await test('r2-06-4: a QuotaExceededError is written once, never retried', async () => {
  const clock = fakeClock();
  let calls = 0; const seen = [];
  const quota = Object.assign(new Error('the disk is full'), { name: 'QuotaExceededError' });
  const q = createWriteQueue({ write: async () => { calls += 1; throw quota; }, ...clock, onError: (e) => seen.push(e) });
  const written = q.push(ev('s1', 1));
  written.catch(() => {});
  await q.flush();
  await assert.rejects(() => written, (e) => e.name === 'QuotaExceededError');
  assert.equal(calls, 1, 'one call and no retry');
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].unconfirmed, 'a refused write is lost, not unconfirmed');
});

await test('r2-06-4: a batch that hit the SLOW deadline is reported unconfirmed (it may still commit), once', async () => {
  const keep = DEADLINES.tx; DEADLINES.tx = 20;
  try {
    const clock = fakeClock();
    let calls = 0; const seen = [];
    const q = createWriteQueue({ write: () => { calls += 1; return new Promise(() => {}); }, ...clock, onError: (e, batch) => seen.push([e, batch]) });
    const written = q.push(ev('s1', 1));
    written.catch(() => {});
    await q.flush();
    await assert.rejects(() => written, (e) => e.code === 'SLOW');
    assert.equal(calls, 1, 'a timed-out write is never retried');
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0].unconfirmed, true, 'tagged unconfirmed, not lost');
    assert.equal(seen[0][1].length, 1);
  } finally { DEADLINES.tx = keep; }
});

await test('r2-06-3: a store whose transaction never completes rejects with SLOW inside the shrunk deadline and is not retried', async () => {
  const keep = DEADLINES.tx; DEADLINES.tx = 25;
  const warn = console.warn; console.warn = () => {};
  try {
    const clock = fakeClock();
    const hung = { tx: () => new Promise(() => {}) }; // a stub store: the transaction never fires oncomplete
    let calls = 0;
    const q = createWriteQueue({ write: () => { calls += 1; return hung.tx(); }, ...clock, onError: () => {} });
    const p = q.push(ev('s1', 1));
    p.catch(() => {});
    const t0 = Date.now();
    await q.flush();
    await assert.rejects(() => p, (e) => e.code === 'SLOW' && e.stage === 'tx');
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(calls, 1);
  } finally { DEADLINES.tx = keep; console.warn = warn; }
});

await test('r4-06-1: a failing stop write reaches onError with the taken events', async () => {
  const seen = [];
  const q = createWriteQueue({ write: fakeStore().write, ...fakeClock(), onError: (err, batch) => seen.push([err.message, batch.map((e) => e.url)]) });
  const written = q.push(ev('s1', 1));
  q.push(ev('s1', 2)).catch(() => {});
  const taken = q.take('s1');
  taken.reject(new Error('stop tx aborted'));
  await assert.rejects(() => written, /stop tx aborted/);
  assert.deepEqual(seen, [['stop tx aborted', ['/r/1', '/r/2']]]);
  const thrower = createWriteQueue({ write: fakeStore().write, ...fakeClock(), onError: () => { throw new Error('reporter broke'); } });
  const w2 = thrower.push(ev('s1', 3));
  thrower.take('s1').reject(new Error('x'));
  await assert.rejects(() => w2, /x/, 'a throwing reporter does not strand the promise');
});

await test('r4-06-1: the stop path bounds its write with the tx deadline and retries once', async () => {
  const src = workerSrc();
  const stop = lift(src, 'writeStopped');
  assert.match(src, /let stored = true/, 'stopSession keeps the verdict');
  assert.match(src, /saved: false, error: 'The session was stopped, but its last events could not be saved\.'/, 'D-1010-235: the exact reply text');
  assert.match(stop, /bounded\(\(async \(\) => \{\s*await putSessionWithEvents\(session, tail\.events\);[\s\S]*?\}\)\(\), 'tx'\)/, 'deadline on the stop transaction');
  assert.match(stop, /e\?\.code === 'SLOW'/, 'a timeout is never retried');
  assert.match(stop, /tail\.reject\(err\)/);
  assert.match(stop, /putSession\(session\)/, 'the row still ends');
  assert.ok(!/throw err/.test(stop), 'a lost tail does not leave the session running');
});

await test('r5-07-3: a never-resolving write plus 10,000 pushes stays under the cap and reports the drops', async () => {
  const seen = [];
  // maxBatch is huge so no flush (and no real 'tx' deadline timer) starts: the store is stalled, nothing drains.
  const q = createWriteQueue({ write: () => new Promise(() => {}), maxBatch: 1e9, ...fakeClock(), onError: (err, batch) => seen.push(...batch) });
  const results = [];
  for (let i = 0; i < 10000; i++) results.push(q.push(ev('s1', i)).then(() => 'ok', () => 'dropped'));
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(q.size() <= MAX_PENDING, `size ${q.size()} must be <= ${MAX_PENDING}`);
  assert.ok(seen.length > 0 && seen.length + q.size() === 10000, 'every event over the cap reaches onError');
  assert.ok(seen.every((e) => e.sessionId === 's1'), 'onError gets the dropped events themselves');
  assert.equal(await results[9999], 'dropped');
});

/* ── D-1010-129 storage guard (codes per D-1010-130) ───────────────────── */
/** A store with no per-event bookkeeping, for the 200,000-row cases. */
const lightStore = () => { const written = []; return { written, async write(events) { for (const e of events) written.push(e); return events; } }; };
const gapNotes = (store, code) => store.written.filter((e) => e.tag === 'capture-gap' && e.gap === code);

await test('D-1010-129: the published limits are 200,000 rows, 256 MiB of bodies, 200 MiB free, one check a minute', () => {
  assert.equal(ROW_CAP, 200000);
  assert.equal(BODY_CAP, 256 * 1024 * 1024);
  assert.equal(LOW_DISK, 200 * 1024 * 1024);
  assert.equal(DISK_CHECK_MS, 60000);
});

await test('r6-06-3: at 200,000 rows a session stops queuing, adds the drops to captureLost, and writes one digit-free session-cap note', async () => {
  const store = lightStore();
  const lost = [];
  const q = createWriteQueue({ write: store.write, maxPending: 1e9, maxBatch: 5000, ...fakeClock(), onLost: (id, n) => lost.push([id, n]) });
  const results = [];
  for (let i = 0; i < ROW_CAP + 25; i++) results.push(q.push(ev('s1', i)).then(() => 'ok', () => 'refused'));
  q.push(ev('s2', 1)).catch(() => {});
  await q.flush();
  assert.equal(results.slice(0, ROW_CAP).includes('refused'), false, 'every row up to the cap is queued');
  assert.equal((await Promise.all(results.slice(ROW_CAP))).every((r) => r === 'refused'), true, 'later events are refused');
  const notes = gapNotes(store, 'session-cap');
  assert.equal(notes.length, 1, 'exactly one session-cap note');
  assert.equal(notes[0].sessionId, 's1');
  assert.ok(!/\d/.test(notes[0].text), 'the note text has no digit');
  assert.equal(store.written.filter((e) => e.sessionId === 's1' && e.kind === 'net').length, ROW_CAP, 'rows stored = the cap');
  assert.equal(store.written.filter((e) => e.sessionId === 's2').length, 1, 'another session is untouched');
  assert.deepEqual(lost, [['s1', 25]], 'the refused events are reported once, as a count');
});

await test('r6-07-4: 10,000 events of 100 KB give exactly one body-cap note; the events are kept, the bodies stop at 256 MiB', async () => {
  const store = lightStore();
  const q = createWriteQueue({ write: store.write, maxPending: 1e9, maxBatch: 5000, ...fakeClock() });
  const body = 'x'.repeat(100 * 1024);
  for (let i = 0; i < 10000; i++) q.push({ ...ev('s1', i), reqBody: body }).catch(() => {});
  await q.flush();
  const notes = gapNotes(store, 'body-cap');
  assert.equal(notes.length, 1, 'exactly one body-cap note');
  assert.ok(!/\d/.test(notes[0].text), 'the note text has no digit');
  const nets = store.written.filter((e) => e.kind === 'net');
  assert.equal(nets.length, 10000, 'no event is dropped');
  const withBody = nets.filter((e) => 'reqBody' in e).length;
  assert.equal(withBody, Math.floor(BODY_CAP / body.length), 'bodies stop at the cap');
  assert.ok(withBody * body.length <= BODY_CAP);
  assert.equal(gapNotes(store, 'session-cap').length, 0);
});

await test('r6-06-3: low disk warns once per session, checks at most once a minute, and never stops the recording', async () => {
  const store = fakeStore();
  let t = 1e6, calls = 0, free = 100 * 1024 * 1024;
  const q = createWriteQueue({ write: store.write, ...fakeClock(), now: () => t, estimate: async () => { calls++; return { quota: 1e12, usage: 1e12 - free }; } });
  for (let i = 0; i < 5; i++) q.push(ev('s1', i)).catch(() => {});
  await new Promise((r) => setImmediate(r));
  q.push(ev('s1', 6)).catch(() => {});
  await q.flush();
  assert.equal(calls, 1, 'one estimate inside a minute');
  assert.equal(gapNotes(store, 'low-disk').length, 1, 'one warning');
  t += DISK_CHECK_MS;
  q.push(ev('s1', 7)).catch(() => {});
  q.push(ev('s2', 1)).catch(() => {});
  await new Promise((r) => setImmediate(r));
  await q.flush();
  assert.equal(calls, 2, 'a second estimate after a minute');
  assert.deepEqual(gapNotes(store, 'low-disk').map((n) => n.sessionId).sort(), ['s1', 's2'], 'still one per session');
  assert.equal(store.written.filter((e) => e.kind === 'net').length, 8, 'every event was still stored');
  assert.ok(!/\d/.test(gapNotes(store, 'low-disk')[0].text));
  free = 500 * 1024 * 1024;
  const ok = fakeStore();
  const q2 = createWriteQueue({ write: ok.write, ...fakeClock(), estimate: async () => ({ quota: 1e12, usage: 1e12 - free }) });
  q2.push(ev('s1', 1)).catch(() => {});
  await new Promise((r) => setImmediate(r));
  await q2.flush();
  assert.equal(gapNotes(ok, 'low-disk').length, 0, 'plenty of space means no warning');
});

await test('D-1010-129: the guard adds no timer, alarm or stop to the worker source', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../background/write-queue.js', import.meta.url), 'utf8');
  assert.ok(!/chrome\.alarms|setInterval/.test(src), 'no alarm or interval');
});
await test('r9-06-1: queue B on the same store seeds its row count and gap notes on the first push after a wake, refuses at the cap, and writes no second gap note', async () => {
  const store = fakeStore();
  const A = createWriteQueue({ write: store.write, rowCap: 5, estimate: undefined });
  for (let i = 0; i < 6; i++) await A.push(ev('s1', i)).catch(() => {}); // five stored, the sixth refused with one gap note
  await A.flush();
  const notes = () => store.written.filter((e) => e.tag === 'capture-gap');
  assert.equal(notes().length, 1);
  const stored = store.written.length;
  const B = createWriteQueue({ write: store.write, rowCap: 5, estimate: undefined, seed: async () => ({ rows: stored, gaps: ['session-cap'] }) });
  const out = B.push(ev('s1', 99)).then(() => 'stored', () => 'refused');
  await B.flush();
  assert.equal(await out, 'refused', 'a fresh queue does not restart the count at zero');
  await B.flush();
  assert.equal(notes().length, 1, 'no second gap note');
  const C = createWriteQueue({ write: store.write, rowCap: 5, estimate: undefined, seed: async () => { throw new Error('db'); } });
  const c = C.push(ev('s9', 1)).then(() => 'stored', () => 'refused');
  await new Promise((r) => setTimeout(r, 0)); await C.flush();
  assert.equal(await c, 'stored', 'a failed seed degrades to the old behaviour, it never blocks the event');
});

/* ── r10-06-1 (D-235): the stop write, run for real from the worker source ── */
const swSrc = workerSrc();
function stopHarness(stubs) {
  const calls = { rowOnly: 0, remembered: 0, lost: [], notes: [], captureLost: new Map() };
  const sessionState = { async addLost(id, n, slow) { calls.lost.push([id, n, slow]); return { captureLost: n }; } };
  const appendEvents = async (e) => { calls.notes.push(...e); };
  const noteCaptureGap = new Function('console', 'sessionState', 'captureLost', 'appendEvents', `${lift(swSrc, 'noteCaptureGap')}\nreturn noteCaptureGap;`)({ warn() {} }, sessionState, calls.captureLost, appendEvents);
  const writeStopped = new Function('bounded', 'putSessionWithEvents', 'putSession', 'rememberSession', `async ${lift(swSrc, 'writeStopped')}\nreturn writeStopped;`)(
    (p, stage) => withDeadline(p, stage),
    stubs.withEvents,
    (...a) => { calls.rowOnly++; return stubs.rowOnly(...a); },
    () => { calls.remembered++; },
  );
  const q = createWriteQueue({ write: fakeStore().write, ...fakeClock(), onError: noteCaptureGap });
  return { calls, writeStopped, q };
}
await test('r10-06-1: a stop write that times out counts the tail as unconfirmed, not lost, and the row is still saved', async () => {
  const keep = DEADLINES.tx; DEADLINES.tx = 30;
  const warn = console.warn; console.warn = () => {};
  try {
    const h = stopHarness({ withEvents: () => new Promise(() => {}), rowOnly: async () => {} }); // putSessionWithEvents never settles
    h.q.push(ev('s1', 1)).catch(() => {}); h.q.push(ev('s1', 2)).catch(() => {});
    const saved = await h.writeStopped({ id: 's1' }, h.q.take('s1'));
    await new Promise((r) => setImmediate(r));
    assert.equal(saved, true, 'the fallback putSession saved the row');
    assert.deepEqual(h.calls.lost, [['s1', 2, true]], 'two events counted, flagged slow (unconfirmed)');
    assert.equal(h.calls.captureLost.has('s1'), false, 'the definite-loss counter is not touched');
    assert.equal(h.calls.notes[0].unconfirmed, 2);
    assert.ok(!('lost' in h.calls.notes[0]), 'the note says unconfirmed, not lost');
    assert.equal(h.calls.rowOnly, 1);
  } finally { DEADLINES.tx = keep; console.warn = warn; }
});
await test('r10-06-1: when the tail write and the row-only write both reject, the stop reports saved:false', async () => {
  const keep = DEADLINES.tx; DEADLINES.tx = 30;
  const warn = console.warn; console.warn = () => {};
  try {
    let tries = 0;
    const h = stopHarness({ withEvents: async () => { tries++; throw new Error('QuotaExceededError'); }, rowOnly: async () => { throw new Error('QuotaExceededError'); } });
    h.q.push(ev('s1', 1)).catch(() => {});
    assert.equal(await h.writeStopped({ id: 's1' }, h.q.take('s1')), false);
    assert.equal(tries, 2, 'a plain failure is retried once');
    assert.equal(h.calls.remembered, 0, 'an unsaved row is not remembered as saved');
    const h2 = stopHarness({ withEvents: () => new Promise(() => {}), rowOnly: () => new Promise(() => {}) }); // everything stalls
    h2.q.push(ev('s1', 1)).catch(() => {});
    assert.equal(await h2.writeStopped({ id: 's1' }, h2.q.take('s1')), false, 'a stalled row-only write is not a success either');
  } finally { DEADLINES.tx = keep; console.warn = warn; }
});

/* ── r10-06-2 (D-246): the production seed against a real (fake-indexeddb) store ── */
const seedWith = (bodyCap) => new Function('countEventsRaw', 'seedStats', 'ROW_CAP', 'BODY_CAP', `async ${lift(swSrc, 'seedSession')}\nreturn seedSession;`)(dbm.countEvents, dbm.seedStats, ROW_CAP, bodyCap);
await test('r10-06-2: after a wake a stored body-cap note is seeded, bodies stay off, and no second note is written', async () => {
  await dbm.appendEvents([
    { sessionId: 'w1', kind: 'net', ts: 1, url: '/a' },
    { sessionId: 'w1', kind: 'note', tag: 'capture-gap', gap: 'body-cap', ts: 2, text: 'Capture gap: body size' },
  ]);
  const before = await dbm.countEvents('w1');
  const q = createWriteQueue({ write: dbm.appendEvents, estimate: undefined, seed: seedWith(BODY_CAP) });
  await q.push({ sessionId: 'w1', kind: 'net', ts: 3, url: '/b', reqBody: 'secret-body' });
  await q.flush();
  const rows = await dbm.getEvents('w1');
  assert.equal(rows.length, before + 1, 'the event is kept');
  assert.equal(rows.filter((e) => e.tag === 'capture-gap').length, 1, 'no second capture-gap note');
  assert.equal(rows.find((e) => e.url === '/b').reqBody, undefined, 'the body stays off');
  const fresh = createWriteQueue({ write: dbm.appendEvents, estimate: undefined, seed: seedWith(BODY_CAP) });
  await fresh.push({ sessionId: 'w2', kind: 'net', ts: 1, url: '/c', reqBody: 'kept' });
  await fresh.flush();
  assert.equal((await dbm.getEvents('w2'))[0].reqBody, 'kept', 'a session with no stored gap still keeps its bodies');
});
await test('r10-06-2: stored bodies past the cap seed a body-cap gap even when the note is missing', async () => {
  await dbm.appendEvents([{ sessionId: 'w3', kind: 'net', ts: 1, url: '/a', reqBody: 'x'.repeat(2000) }]);
  const seed = seedWith(1000);
  assert.deepEqual((await seed('w3')).gaps, ['body-cap']);
  assert.deepEqual(await seed('nobody'), { rows: 0, gaps: [] });
  assert.equal((await seedWith(BODY_CAP)('w3')).gaps.length, 0, 'under the real cap there is no gap');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
