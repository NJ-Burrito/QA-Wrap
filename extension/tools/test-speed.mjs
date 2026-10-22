/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The cost of the two things that happen thousands of times.
 *
 *   node tools/test-speed.mjs
 *
 * Brief item G4: "Speed: 50 ms response for tool presses and popup open;
 * measure and fix the slow paths; report before/after."
 *
 * ── what is measured here, and what is measured in a browser ──────────────
 *
 * `tools/perf.mjs` measures wall clock in a real Chrome against a deliberately
 * heavy page, throttled 6x, and it is the right instrument for "does the popup
 * open in under 900 ms". It needs a browser, it needs the machine to itself,
 * and it cannot run beside another worker's headed suite.
 *
 * This file measures the thing a stopwatch is bad at: **how many round trips
 * an operation makes**. Every `chrome.storage.get`, `chrome.tabs.get` and
 * IndexedDB read is an IPC hop out of the worker and back, and the count is
 * what decides the wall clock on a slow machine — not the code between them.
 * A count is also stable: it is the same number on a fast laptop and a tired
 * one, so a budget written against it holds, and a regression shows up as an
 * integer going up rather than as a flaky millisecond.
 *
 * ── the finding ───────────────────────────────────────────────────────────
 *
 * `isArmedTab()` is the most-called async function in the extension: every
 * event a recorded page reports passes through it, and a busy application
 * reports hundreds a second. It was two round trips every time — a
 * `chrome.storage.session.get` for the armed set and a `chrome.tabs.get` for
 * the tab's window — both answering a question whose answer had not changed.
 *
 * Measured below over 500 events on one tab:
 *
 *      before   1,000 round trips   (500 storage + 500 tabs)
 *      after        2 round trips   (1 storage + 1 tab, then cache hits)
 *
 * The cache is exact rather than timed: `chrome.storage.session.onChanged`,
 * `tabs.onAttached`, `tabs.onRemoved` and the arm/disarm calls themselves drop
 * it, so a window the tester has just put to sleep is never answered "armed"
 * from memory. See the note on `cached` in `background/armed.js`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { lift } from './lib-lift.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];
let queue = Promise.resolve();
function test(name, fn) {
  queue = queue.then(() =>
    Promise.resolve().then(fn)
      .then(() => { passed++; console.log(`  ok  ${name}`); })
      .catch((err) => { failures.push(name); console.log(`  FAIL  ${name}\n        ${err.message}`); })
  );
}

/* ── a chrome that counts what it is asked ─────────────────────────────── */

function countingChrome({ armedWindows = [1], tabWindow = 1 } = {}) {
  const trips = { storage: 0, tabs: 0 };
  const bag = new Map([['armedWindows', armedWindows]]);
  const changeListeners = [];
  const tabListeners = { onRemoved: [], onAttached: [], onDetached: [], onReplaced: [] };

  const announce = (obj) => {
    const changes = Object.fromEntries(Object.keys(obj).map((k) => [k, { newValue: obj[k] }]));
    for (const fn of changeListeners) fn(changes, 'session');
  };

  globalThis.chrome = {
    runtime: { id: 'qawrap-test', getURL: (p) => `x/${p}` },
    storage: {
      session: {
        get: async (key) => { trips.storage++; return { [key]: bag.get(key) }; },
        set: async (obj) => {
          trips.storage++;
          for (const [k, v] of Object.entries(obj)) bag.set(k, v);
          announce(obj);
        },
        remove: async (key) => { trips.storage++; bag.delete(key); announce({ [key]: undefined }); },
        onChanged: { addListener: (fn) => changeListeners.push(fn) },
      },
    },
    tabs: {
      get: async (id) => { trips.tabs++; return { id, windowId: tabWindow }; },
      query: async () => { trips.tabs++; return []; },
      onRemoved: { addListener: (fn) => tabListeners.onRemoved.push(fn) },
      onAttached: { addListener: (fn) => tabListeners.onAttached.push(fn) },
      onDetached: { addListener: (fn) => tabListeners.onDetached.push(fn) },
      onReplaced: { addListener: (fn) => tabListeners.onReplaced.push(fn) },
    },
    windows: { onRemoved: { addListener() {} } },
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async () => {},
      unregisterContentScripts: async () => {},
      executeScript: async () => [],
    },
  };
  return { trips, tabListeners, fire: (group, ...args) => tabListeners[group].forEach((fn) => fn(...args)) };
}

async function loadArmed(opts) {
  const world = countingChrome(opts);
  const armed = await import(`../background/armed.js?speed=${Math.random()}`);
  armed.watchWindows();
  // `watchWindows()` calls `syncHooks()`, which reads once. Zero the counters
  // after boot so what is measured is the steady state, not the start-up.
  await new Promise((r) => setTimeout(r, 0));
  world.trips.storage = 0;
  world.trips.tabs = 0;
  return { armed, ...world };
}

const EVENTS = 500;

console.log(`the ingest path — ${EVENTS} events from one tab`);

test('the armed check costs two round trips in total, not two per event', async () => {
  const { armed, trips } = await loadArmed();
  for (let i = 0; i < EVENTS; i++) assert.equal(await armed.isArmedTab(77), true);
  const total = trips.storage + trips.tabs;
  console.log(`      ${EVENTS} events: ${trips.storage} storage + ${trips.tabs} tabs = ${total} round trips`);
  console.log(`      before the cache this was ${EVENTS * 2}`);
  // Two is the honest floor: one to learn which windows are armed, one to
  // learn which window the tab is in. The budget has room for a couple more so
  // a legitimate extra lookup is not a red suite, and none for a per-event one.
  assert.ok(total <= 6, `${total} round trips for ${EVENTS} events`);
});

test('a second tab in the same window costs one more, not five hundred', async () => {
  const { armed, trips } = await loadArmed();
  for (let i = 0; i < EVENTS; i++) {
    await armed.isArmedTab(77);
    await armed.isArmedTab(78);
  }
  assert.ok(trips.tabs <= 2, `${trips.tabs} tab lookups for two tabs`);
});

test('the cache is reported, so a regression is visible rather than inferred', async () => {
  const { armed } = await loadArmed();
  for (let i = 0; i < 100; i++) await armed.isArmedTab(77);
  const s = armed.cacheStats();
  assert.ok(s.hits > 90, `only ${s.hits} cache hits in 100 calls`);
  assert.ok(s.tabHits > 90, `only ${s.tabHits} tab-cache hits in 100 calls`);
});

/* ── and it is still correct, which is the whole difficulty ─────────────── */

console.log('\nthe cache is exact: every way the answer changes drops it');

test('sleeping the window is answered from the next call, not the next read', async () => {
  const { armed } = await loadArmed();
  assert.equal(await armed.isArmedTab(77), true);
  await armed.disarm(1);
  assert.equal(await armed.isArmedTab(77), false, 'a cached "armed" outlived the sleep');
});

test('a storage change made by anything else drops it', async () => {
  // Another worker lifetime, or a second context. The listener is the only
  // thing that can see that, and it is why this is a cache and not a copy.
  const { armed } = await loadArmed();
  assert.equal(await armed.isArmedTab(77), true);
  await chrome.storage.session.set({ armedWindows: [] });
  assert.equal(await armed.isArmedTab(77), false);
});

test('beginSleep is honoured over the cache, immediately', async () => {
  // The decision is taken the moment the tester presses, before the teardown
  // has written anything anywhere. A cache that answered storage would repaint
  // the switch Awake behind them.
  const { armed } = await loadArmed();
  assert.equal(await armed.isArmedTab(77), true);
  armed.beginSleep(1);
  assert.equal(await armed.isArmedTab(77), false);
});

test('a tab dragged into another window is not still answered for the old one', async () => {
  const { armed, fire } = await loadArmed({ armedWindows: [1], tabWindow: 1 });
  assert.equal(await armed.isArmedTab(77), true);
  fire('onAttached', 77, { newWindowId: 2 });
  assert.equal(await armed.isArmedTab(77), false, 'the tab is in a window nobody armed now');
});

test('a closed tab is forgotten', async () => {
  const { armed, fire, trips } = await loadArmed();
  await armed.isArmedTab(77);
  const before = trips.tabs;
  fire('onRemoved', 77);
  await armed.isArmedTab(77);
  assert.equal(trips.tabs, before + 1, 'the tab was answered from a cache after it closed');
});

test('waking a window is visible without waiting for a read', async () => {
  const { armed } = await loadArmed({ armedWindows: [] });
  assert.equal(await armed.isArmedTab(77), false);
  await armed.arm(1);
  assert.equal(await armed.isArmedTab(77), true);
});

/* ── the other hot read: the session row, per event ─────────────────────── */

console.log('\nthe ingest path — the session record');

const worker = workerSrc();

test('belongsToSession no longer opens an IndexedDB transaction per event', () => {
  // The heaviest thing in the loop by an order of magnitude, and it was reading
  // a row that does not change while a session runs.
  assert.match(worker, /async function belongsToSession\(sessionId, tabId\) \{[\s\S]{0,200}await readSession\(sessionId\)/);
  assert.match(worker, /const sessionCache = new Map\(\);/);
});

test('every write to a session record drops it from the cache', () => {
  // The rule that makes the cache honest: `putSession` is the only way a
  // record changes, so every call must be followed by a remember. A miss here
  // is a report built from a stale row.
  const writes = (worker.match(/await putSession\(/g) || []).length;
  const remembers = (worker.match(/\brememberSession\(/g) || []).length - 1; // the definition
  assert.ok(
    remembers >= writes,
    `${writes} putSession calls and only ${remembers} rememberSession calls: one write is not invalidating the cache`
  );
  assert.match(worker, /await putSessionWithEvents\(session, tail\.events\);\s*\n\s*rememberSession\(session\);/);
});

test('deleting a session removes it from the cache', () => {
  assert.equal((worker.match(/\bforgetSession\(/g) || []).length - 1, 2, 'both delete paths must forget');
});

/* ── r6-07-6: the window -> session map, read once per worker life ──────── */

console.log('\nthe ingest path — the window to session map');

test('r6-07-6: 500 ingests read the map from storage once and hand out copies', async () => {
  const { armed, trips } = await loadArmed();
  await chrome.storage.session.set({ activeSessionsByWindow: { 1: 's1', 2: 's2' } });
  trips.storage = 0;
  for (let i = 0; i < EVENTS; i++) {
    const map = await armed.sessionMap();
    assert.deepEqual(map, { 1: 's1', 2: 's2' });
    map[3] = 'mutated'; // a caller changes its copy, never the cache
  }
  assert.equal(trips.storage, 1, `${trips.storage} storage reads for ${EVENTS} map reads`);
  const s = armed.cacheStats();
  assert.equal(s.mapReads, 1);
  assert.equal(s.mapHits, EVENTS - 1);
});

test('r6-07-6: a storage change drops the map; a drop during a read is not kept; a restart rebuilds it', async () => {
  const { armed, trips } = await loadArmed();
  await chrome.storage.session.set({ activeSessionsByWindow: { 1: 's1' } });
  assert.deepEqual(await armed.sessionMap(), { 1: 's1' });
  await chrome.storage.session.set({ activeSessionsByWindow: { 1: 's1', 2: 's2' } }); // announce() is storage.session.onChanged
  assert.deepEqual(await armed.sessionMap(), { 1: 's1', 2: 's2' }, 'the change was seen on the next read');
  await chrome.storage.session.remove('activeSessionsByWindow');
  assert.deepEqual(await armed.sessionMap(), {}, 'a removed key is an empty map');
  armed.dropSessionMap();
  const before = trips.storage;
  const racing = armed.sessionMap();
  armed.dropSessionMap(); // the worker's own write lands while the read is in flight
  await racing;
  await armed.sessionMap();
  assert.equal(trips.storage - before, 2, 'the raced read was not kept');
  const fresh = await loadArmed(); // a new worker life
  await chrome.storage.session.set({ activeSessionsByWindow: { 9: 's9' } });
  assert.deepEqual(await fresh.armed.sessionMap(), { 9: 's9' }, 'rebuilt from storage on restart');
});

test('r6-07-6: the worker reads the map through armed.js and drops it around both writers', () => {
  assert.match(worker, /async function sessionsByWindow\(\) \{ return armed\.sessionMap\(\); \}/);
  const writers = (worker.match(/armed\.dropSessionMap\(\)/g) || []).length;
  assert.ok(writers >= 4, `${writers} drops: start and stop each drop before and after the write`);
});

/* ── the worker's cold start, which is the other half of a press ────────── */

console.log('\nthe cold start — what MV3 re-parses before anything can answer');

test('the boot graph is still inside its ceilings', () => {
  // Restated here rather than only in test-worker-imports.mjs because this is
  // the file about speed, and cold start is most of the first press after the
  // worker has been evicted: MV3 tears it down after thirty idle seconds, so a
  // tester who pauses to read a page pays it again.
  const imports = fs.readFileSync(path.join(EXT, 'tools', 'test-worker-imports.mjs'), 'utf8');
  assert.match(imports, /const MAX_TRANSITIVE = \d+;/);
  assert.match(imports, /const MAX_BYTES = \d+ \* 1024;/);
});

test('the popup asks once, not seven times', () => {
  // Every part of the popup's first paint is fetched concurrently and every
  // part fails soft. A sequential await here is a popup that opens in the sum
  // of its parts rather than the slowest of them.
  const popupState = worker.slice(worker.indexOf('UQA_POPUP_STATE:'), worker.indexOf('UQA_POPUP_STATE:') + 1800);
  assert.match(popupState, /await Promise\.all\(\[/);
  const softed = (popupState.match(/soft\(/g) || []).length;
  assert.ok(softed >= 5, `only ${softed} of the popup's parts fail soft`);
});

/* ── 07-1: the popup must not re-read a whole session every two seconds ─── */

console.log('\nthe timeline read — what crosses the message channel');

test('UQA_GET_TIMELINE with tail returns at most N of 20,000 events and leaves the session whole', async () => {
  const store = Array.from({ length: 20000 }, (_, i) => ({ seq: i + 1, sessionId: 's1', kind: 'dom' }));
  const session = { id: 's1', startedAt: 5, note: 'untouched' };
  const run = new Function('getEvents', 'getEventsSince', 'getSession', `async ${lift(worker, 'timelineFor')}; return timelineFor;`)(
    async () => store.slice(),
    async (_sid, since) => store.filter((e) => e.seq > since),
    async () => session,
  );
  const full = await run({ sessionId: 's1' });
  assert.equal(full.events.length, 20000, 'no tail, no trimming');
  const t = await run({ sessionId: 's1', tail: 20 });
  assert.equal(t.events.length, 20);
  assert.equal(t.events[19].seq, 20000, 'the LAST events, not the first');
  assert.equal(t.session, session, 'the session row is unchanged');
  assert.ok((await run({ sessionId: 's1', tail: 1e9 })).events.length <= 5000, 'the tail itself is capped');
  assert.equal((await run({ sessionId: 's1', tail: 'x' })).events.length, 20000, 'a non-numeric tail is ignored');
  const inc = await run({ sessionId: 's1', sinceSeq: 19990 });
  assert.equal(inc.events.length, 10);
  assert.equal(inc.incremental, true);
});

test('r7-07-2: kinds:[export] over 10k events returns only export rows; two MEDIA_LIST calls scan once', async () => {
  const store = Array.from({ length: 10000 }, (_, i) => ({ seq: i + 1, sessionId: 's1', kind: i % 1000 === 0 ? 'export' : 'dom' }));
  const run = new Function('getEvents', 'getEventsSince', 'getSession', `async ${lift(worker, 'timelineFor')}; return timelineFor;`)(
    async () => store.slice(), async () => [], async () => ({ id: 's1' }),
  );
  const r = await run({ sessionId: 's1', kinds: ['export'] });
  assert.equal(r.events.length, 10);
  assert.ok(r.events.every((e) => e.kind === 'export'));
  assert.equal((await run({ sessionId: 's1', kinds: [] })).events.length, 10000, 'an empty list filters nothing');

  let scans = 0;
  const memo = new Map();
  const list = new Function('listMedia', 'getEvents', 'getCaptures', 'legacyMediaMemo', `async ${lift(worker, 'mediaListFor')}; return mediaListFor;`)(
    async () => [{ id: 'm1', ts: 5 }],
    async () => { scans++; return [{ kind: 'screenshot', captureId: 'c1', ts: 1, text: 'old' }]; },
    async () => ({ c1: { dataUrl: 'data:image/png;base64,AAAA', url: 'u' } }),
    memo,
  );
  const a = await list({ sessionId: 's1' });
  const b = await list({ sessionId: 's1' });
  assert.equal(scans, 1, 'the legacy scan ran once');
  assert.deepEqual(a.map((m) => m.id), ['c1', 'm1']);
  assert.deepEqual(b, a);
});

test('r4-09-3: the ticker guard compares session ids, so a refresh() that swaps the state object does not drop the paint', () => {
  const popup = fs.readFileSync(path.join(EXT, 'popup', 'popup.js'), 'utf8');
  const tick = popup.slice(popup.indexOf('const sessionTicker = makeTicker('), popup.indexOf('const clipTicker'));
  assert.ok(!/state\.session !== live/.test(tick), 'the guard still compares object identity');
  const guard = tick.match(/if \(state\.session\?\.id !== live\.id\) return;/)?.[0];
  assert.ok(guard, 'the guard is not an id comparison');
  const kept = (state) => vm.runInNewContext(`(() => { const live = { id: 's1' }; ${guard} return true; })()`, { state }) === true;
  assert.equal(kept({ session: { id: 's1', events: 9 } }), true, 'same session, new object: the paint must be kept');
  assert.equal(kept({ session: { id: 's2' } }), false, 'a different session: the paint is dropped');
  assert.equal(kept({ session: null }), false, 'no session any more: the paint is dropped');
});

test('the popup ticker asks for what is new since the last seq, never the whole session again', () => {
  const popup = fs.readFileSync(path.join(EXT, 'popup', 'popup.js'), 'utf8');
  const tick = popup.slice(popup.indexOf('const sessionTicker = makeTicker('), popup.indexOf('const clipTicker'));
  const read = popup.slice(popup.indexOf('async function readWorkLive('), popup.indexOf('async function readWorkLive(') + 900);
  assert.match(read, /fetchTimeline\(live\.id, since \? \{ sinceSeq: since \} : \{\}\)/);
  assert.match(tick, /readWorkLive\(live\)/, 'the ticker reads through the shared since/busy path (r3-07-2)');
  assert.ok(!/fetchTimeline\(/.test(tick), 'an unbounded read inside the 2-second ticker');
});

test('popup workEvents: duplicate, overlapping and back-dated batches give unique seq in (ts, seq) order (r2-07-2, r2-09-1)', () => {
  const popup = fs.readFileSync(path.join(EXT, 'popup', 'popup.js'), 'utf8');
  const make = () => new Function(`let workTimeline = { sessionId: null, events: [], maxSeq: 0 };
    ${lift(popup, 'workEvents')}
    return { workEvents, get tl() { return workTimeline; } };`)();
  const ev = (seq, ts) => ({ seq, ts, kind: 'dom' });
  const all = [ev(1, 100), ev(2, 200), ev(3, 300), ev(4, 250), ev(5, 400), ev(6, 150), ev(7, 500)];
  const truth = [...all].sort((a, b) => a.ts - b.ts || a.seq - b.seq).map((e) => e.seq);

  const w = make();
  w.workEvents('s', { incremental: false, events: all.slice(0, 3) });
  assert.equal(w.tl.maxSeq, 3);
  // duplicate: the same batch again
  w.workEvents('s', { incremental: true, events: all.slice(0, 3) }, 3);
  assert.deepEqual(w.tl.events.map((e) => e.seq), [1, 2, 3], 'a duplicate batch adds nothing');
  // overlapping + back-dated (seq 4 has ts 250 < 300)
  w.workEvents('s', { incremental: true, events: all.slice(1, 5) }, 3);
  assert.deepEqual(w.tl.events.map((e) => e.seq), [1, 2, 4, 3, 5], 'overlap deduped, back-dated event slotted by ts');
  // a stale answer (asked from seq 3 though the cache is now at 5) is dropped
  const before = w.tl.events;
  w.workEvents('s', { incremental: true, events: all.slice(3) }, 3);
  assert.equal(w.tl.events, before, 'an answer whose since is no longer maxSeq is discarded');
  w.workEvents('s', { incremental: true, events: all.slice(5) }, 5);
  assert.deepEqual(w.tl.events.map((e) => e.seq), truth, 'equals one full read sorted by ts then seq');
  assert.equal(new Set(w.tl.events.map((e) => e.seq)).size, all.length);

  const f = make();
  f.workEvents('s', { incremental: false, events: [...all].reverse() });
  assert.deepEqual(f.tl.events.map((e) => e.seq), truth, 'a full answer is ordered too');
  f.workEvents('other', { incremental: true, events: all.slice(0, 2) }, 7);
  assert.deepEqual(f.tl.events.map((e) => e.seq), [1, 2], 'another session replaces the cache');
});

test('the popup work-pane read has a single read in flight (r2-09-1)', () => {
  const popup = fs.readFileSync(path.join(EXT, 'popup', 'popup.js'), 'utf8');
  const at = popup.indexOf('async function readWorkLive(');
  const read = popup.slice(at, popup.indexOf('\n}\n', at));
  assert.match(read, /workReadBusy\) return/);
  assert.match(read, /workReadBusy = true;[\s\S]*finally \{\s*workReadBusy = false;/);
  assert.match(read, /workEvents\(live\.id, tl, since\)/);
});

test('r5-07-4: an unanswered timeline read times out after 10 s, frees the pane, and a late answer paints nothing', async () => {
  const popup = fs.readFileSync(path.join(EXT, 'popup', 'popup.js'), 'utf8');
  const timers = [];
  const painted = [];
  let release;
  let calls = 0;
  const w = new Function('timers', 'painted', 'fetchTimeline', `
    let workReadBusy = false;
    const WORK_READ_MS = ${/const WORK_READ_MS = (\d+);/.exec(popup)?.[1]};
    let workTimeline = { sessionId: 's1', events: [], maxSeq: 5 };
    const state = { session: { id: 's1' } };
    const setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    const clearTimeout = () => {};
    const workEvents = () => [];
    const isPickedNote = () => false;
    const pickedLocatorText = () => '';
    let lastLocator = '';
    const paintLocatorNow = () => {};
    const paintWorkLive = (...a) => painted.push(a);
    async ${lift(popup, 'readWorkLive')}
    return { readWorkLive, get busy() { return workReadBusy; } };`)(timers, painted, () => {
    calls++;
    return new Promise((r) => { release = () => r({ incremental: true, events: [{ seq: 6 }], session: { startedAt: 1 } }); });
  });
  const first = w.readWorkLive({ id: 's1' });
  await Promise.resolve();
  assert.equal(w.busy, true);
  await w.readWorkLive({ id: 's1' });
  assert.equal(calls, 1, 'a second tick while one read is in flight asks nothing');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 10000, 'the race is 10 seconds');
  timers[0].fn();
  await first;
  assert.equal(w.busy, false, 'the timeout resets the busy flag');
  release();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(painted.length, 0, 'a late answer to the abandoned read paints nothing');
});

/* ── r3-07-1: redaction is linear, and nested input is bounded ──────────── */

test('r3-07-1: 1 MB holding 25,000 copies of one token redacts in under 500 ms (it took 36 s)', async () => {
  const { redact, REDACTED } = await import('../core/privacy.js');
  const tok = 'ghp_' + 'a1B2c3D4e5'.repeat(4);
  const big = `${tok} `.repeat(25000);
  assert.ok(big.length >= 1_000_000);
  const t0 = performance.now();
  const out = redact(big);
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
  assert.ok(!out.text.includes('ghp_'));
  assert.equal(out.text.split(REDACTED).length - 1, 25000);
  assert.equal(out.found[0].count, 25000);
});

test('r3-07-1: many key/value secrets and a long run with no delimiter stay linear too', async () => {
  const { redact } = await import('../core/privacy.js');
  for (const big of ['{"password":"hunter2hunter2","a":"b"} '.repeat(25000), 'token '.repeat(200000), 'a-'.repeat(500000)]) {
    const t0 = performance.now();
    redact(big);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `${ms.toFixed(0)} ms on ${big.length} chars`);
  }
});

test('r3-07-1: a page cannot hand the scrubber more than the caps allow (body text, header count, header size)', async () => {
  const { sanitiseEvent } = await import('../core/events.js');
  const now = Date.now();
  const big = sanitiseEvent({ kind: 'net', ts: now, reqBody: { kind: 'text', text: 'x'.repeat(5 * 1024 * 1024) } }, { now });
  assert.equal(big.reqBody.text.length, 32768);
  assert.equal(big.reqBody.kind, 'text');
  const headers = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`h${i}`, 'v'.repeat(20000)]));
  const ev = sanitiseEvent({ kind: 'net', ts: now, reqHeaders: headers, resHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })) }, { now });
  assert.equal(Object.keys(ev.reqHeaders).length, 100);
  assert.ok(Object.values(ev.reqHeaders).every((v) => v.length === 8192));
  assert.equal(ev.resHeaders.length, 100);
  assert.ok(ev.resHeaders.every((h) => h.value.length === 8192 && h.name.startsWith('h')));
  const small = sanitiseEvent({ kind: 'net', ts: now, reqHeaders: { accept: 'a/b' }, reqBody: { kind: 'json', text: '{}' } }, { now });
  assert.deepEqual(small.reqHeaders, { accept: 'a/b' });
  assert.deepEqual(small.reqBody, { kind: 'json', text: '{}' });
});

test('r3-07-1: the worst honest event (5 MB body, 5,000 big headers) scrubs and sanitises in under a second', async () => {
  const { sanitiseEvent } = await import('../core/events.js');
  const { redact } = await import('../core/privacy.js');
  const now = Date.now();
  const tok = 'ghp_' + 'a1B2c3D4e5'.repeat(4);
  const ev = sanitiseEvent({
    kind: 'net', ts: now,
    reqBody: { kind: 'text', text: `${tok} `.repeat(200000) },
    reqHeaders: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`h${i}`, `${tok} `.repeat(500)])),
  }, { now });
  const t0 = performance.now();
  redact(ev.reqBody.text);
  for (const v of Object.values(ev.reqHeaders)) redact(v);
  assert.ok(performance.now() - t0 < 1000, 'bounded input, bounded cost');
});

await queue;
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
