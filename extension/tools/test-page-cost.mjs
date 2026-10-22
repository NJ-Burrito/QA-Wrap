/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-075: the heavy-page guard, the per-event caps, and the page-cost baseline.
 * The guard test runs the shipped content/replay-recorder.js against 5,000 mutations in one second.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { sanitiseEvent } from '../core/events.js';
import { workerSrc } from './lib-worker-src.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
let n = 0;
const test = (name, fn) => { n++; fn(); console.log(`  ok  ${name}`); };

function loadRecorder() {
  const clock = { t: 0 };
  const watch = { disconnects: 0 };
  const sent = [];
  const sandbox = {
    console,
    chrome: { runtime: { sendMessage: (m, cb) => { sent.push(...m.entries); cb?.({ ok: true }); } } },
    performance: { now: () => clock.t },
    requestAnimationFrame: (fn) => fn(),
    setInterval: () => 0,
    clearInterval: () => {},
    MutationObserver: class { observe() {} disconnect() { watch.disconnects++; } },
    document: { documentElement: null, title: 'busy' },
    location: { href: 'https://example.test/busy' },
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1280, innerHeight: 800, scrollX: 0, scrollY: 0,
  };
  sandbox.window = sandbox; sandbox.top = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('content', 'replay-recorder.js'), sandbox, { filename: 'content/replay-recorder.js' });
  return { api: sandbox.window.UQAReplayRecorder, clock, watch, log: () => [...sent, ...sandbox.window.UQAReplayRecorder._buffer()] };
}
const el = { nodeType: 1, tagName: 'DIV', _attrs: { class: 'x' }, childNodes: [], parentElement: null, getAttribute(k) { return this._attrs[k] ?? null; }, hasAttribute(k) { return k in this._attrs; }, matches() { return false; }, attributes: [] };
const rec = () => ({ type: 'attributes', target: el, attributeName: 'class' });
const batch = (k) => Array.from({ length: k }, rec);

test('one 5,000-record render (a single-page app on a normal page) does not stop the recorder', () => {
  const { api, clock, log } = loadRecorder();
  api._start('s1');
  for (let i = 0; i < 5; i++) api.onMutations(batch(1000));
  clock.t = 3000; api.onMutations(batch(10)); // quiet afterwards
  assert.equal(api.isFollowing(), true);
  assert.ok(!log().some((e) => e.k === 'heavy'));
  api._stop();
});

test('5,000 mutations a second for two seconds: the recorder stops following, keeps the log so far, and writes one heavy marker', () => {
  const { api, clock, watch, log } = loadRecorder();
  api._start('s1');
  for (let i = 0; i < 5; i++) api.onMutations(batch(1000));
  clock.t = 1200;
  for (let i = 0; i < 5; i++) api.onMutations(batch(1000)); // a second second over the limit
  const k = log().map((e) => e.k);
  assert.equal(k.filter((x) => x === 'heavy').length, 1, `entries: ${k.join(',')}`);
  assert.equal(k[0], 'snapshot');
  assert.equal(api.isFollowing(), false);
  assert.ok(watch.disconnects >= 1, 'the observer was not disconnected');
  const after = log().length;
  api.onMutations(batch(1000));
  assert.equal(log().length, after, 'it kept following after the switch');
  api._stop();
});

test('a runaway page (ten times the limit in one second) stops at once', () => {
  const { api, log } = loadRecorder();
  api._start('s1');
  for (let i = 0; i < 25; i++) api.onMutations(batch(1000));
  assert.equal(api.isFollowing(), false);
  assert.equal(log().filter((e) => e.k === 'heavy').length, 1);
  api._stop();
});

test('a quiet page and a busy-but-ordinary burst never trip the guard', () => {
  const { api, clock, log } = loadRecorder();
  api._start('s1');
  for (let s = 0; s < 10; s++) { clock.t = s * 1000; api.onMutations(batch(300)); } // 300 a second for ten seconds
  assert.equal(api.isFollowing(), true);
  assert.ok(!log().some((e) => e.k === 'heavy'));
  api._stop();
});

test('the window resets: 1,500 + 1,500 in different seconds is not heavy', () => {
  const { api, clock } = loadRecorder();
  api._start('s1');
  api.onMutations(batch(1500)); clock.t = 1500; api.onMutations(batch(1500));
  assert.equal(api.isFollowing(), true);
  api._stop();
});

test('the replay viewer says so, in both languages', () => {
  assert.match(read('replay', 'replay.js'), /replay\.status\.heavy/);
  for (const lang of ['en', 'ar']) assert.ok(JSON.parse(read('platform', 'i18n', `${lang}.json`))['replay.status.heavy']);
});

test('sanitiseEvent cuts any string field of a page event at 32,768 characters and leaves short ones alone', () => {
  const big = sanitiseEvent({ kind: 'note', text: 'x'.repeat(200000) }, { now: 1 });
  assert.equal(big.text.length, 32768);
  assert.equal(sanitiseEvent({ kind: 'note', text: 'short' }, { now: 1 }).text, 'short');
});

test('the worker refuses page events past the per-second cap, per session, and lets pre-roll through', () => {
  const src = workerSrc();
  const cap = /const EVENTS_PER_SEC = (\d+);/.exec(src)[1];
  const fnSrc = /const rateCap = [^\n]+/.exec(src)[0];
  const later = [];
  const noted = [];
  const rateCap = new Function('later', 'noted', `const EVENTS_PER_SEC = ${cap}; const rate = new Map(); const setTimeout = (f, ms, ...a) => later.push(() => f(...a)); const droppedNote = (id, r) => noted.push(r[1]); ${fnSrc}; return rateCap;`)(later, noted);
  let refused = 0;
  for (let i = 0; i < 1000; i++) if (rateCap('a', 7)) refused++;
  assert.equal(refused, 1000 - Number(cap));
  assert.equal(later.length, 1, 'one marker is scheduled for a second that went over, not one per refused event');
  later[0]();
  assert.deepEqual(noted, [1000], 'the marker carries the final count, so the note can say how many were dropped');
  assert.match(src, /const droppedNote = [\s\S]{0,300}?kind: 'note', tag: 'dropped'/,'the worker records a visible note for the dropped events');
  assert.equal(rateCap('b', 7), false, 'another session shares the count');
  assert.equal(rateCap('a', 8), false, 'the next second did not reset');
  assert.match(src, /!preRoll && rateCap\(sessionId\)\) return \{ stored: false, reason: 'rate' \}/);
});

test('r3-01-4: stopSession deletes the session entry from the rate map, so the map cannot grow for the worker lifetime', () => {
  const src = workerSrc();
  const from = src.indexOf('async function runStop(which) {');
  const to = src.indexOf('\nasync function ', from + 10);
  assert.ok(from > 0 && to > from, 'stopSession moved');
  assert.match(src.slice(from, to), /\brate\.delete\(id\)/);
});

test('the page-cost tool exists and its baseline carries the numbers', () => {
  assert.ok(fs.existsSync(path.join(root, 'tools', 'perf-page.mjs')));
  const b = JSON.parse(read('tools', 'perf-page-baseline.json'));
  assert.deepEqual(Object.keys(b.states).sort(), ['asleep', 'awake', 'installed', 'none']);
  for (const s of Object.values(b.states)) {
    for (const page of ['light', 'frames', 'busy']) for (const rate of [1, 6]) {
      const c = s[`${page}@${rate}x`];
      assert.ok(c && Number.isFinite(c.lcp) && Number.isFinite(c.tbt) && Number.isFinite(c.p50) && Number.isFinite(c.p95) && Number.isFinite(c.heapMB), `${page}@${rate}x`);
    }
  }
  assert.ok(Number.isFinite(b.states.awake.replayBytesPerMin), 'replay growth per minute not measured');
  assert.equal(typeof b.splitStartScript, 'boolean');
  assert.equal(b.splitStartScript, Math.max(b.asleepDeltaMs.lcp, b.asleepDeltaMs.tbt) > 20, 'the split decision does not follow the 20 ms rule');
});

/* ── T-075: asleep registers only the cheap start script; wake registers the rest; sleep removes them ── */
const atest = async (name, fn) => { n++; await fn(); console.log(`  ok  ${name}`); };

async function world(origins = ['https://app.test/*'], preset = []) {
  const session = new Map(); const listeners = [];
  const calls = { register: [], update: [], unregister: [], executed: [] };
  let registered = [...preset];
  globalThis.chrome = {
    runtime: { id: 'x', getURL: (p) => `chrome-extension://x/${p}` },
    storage: { session: {
      get: async (k) => ({ [k]: session.get(k) }),
      set: async (o) => { for (const [k, v] of Object.entries(o)) session.set(k, v); for (const f of listeners) f(o); },
      remove: async (k) => { session.delete(k); for (const f of listeners) f({ [k]: undefined }); },
      onChanged: { addListener: (f) => listeners.push(f) },
    } },
    tabs: { get: async () => null, query: async () => [{ id: 5, url: 'https://app.test/' }], onRemoved: { addListener() {} }, onAttached: { addListener() {} }, onDetached: { addListener() {} }, onReplaced: { addListener() {} } },
    windows: { onRemoved: { addListener() {} } },
    permissions: { getAll: async () => ({ origins }), contains: async ({ origins: w = [] }) => w.every((o) => origins.includes(o)) },
    scripting: {
      getRegisteredContentScripts: async ({ ids } = {}) => registered.filter((x) => !ids || ids.includes(x.id)),
      registerContentScripts: async (specs) => { calls.register.push(specs); registered = [...registered, ...specs]; },
      updateContentScripts: async (specs) => { calls.update.push(specs); registered = registered.map((x) => specs.find((y) => y.id === x.id) || x); },
      unregisterContentScripts: async ({ ids }) => { calls.unregister.push(ids); registered = registered.filter((x) => !ids.includes(x.id)); },
      executeScript: async (o) => { calls.executed.push(o); return []; },
      insertCSS: async (o) => { calls.executed.push({ css: o.files, target: o.target }); },
    },
  };
  const q = `?t75=${Math.random()}`;
  const site = await import(`../background/site-access.js${q}`);
  const armed = await import(`../background/armed.js${q}`);
  armed.watchWindows(); // the cache invalidation a real worker registers at the top level
  return { site, armed, calls, ids: () => registered.map((x) => x.id).sort(), specs: () => registered };
}
const ALL_JS = ['content/selector-engine.js', 'content/replay-buffer.js', 'content/bridge.js', 'content/recorder.js', 'content/ui-host.js', 'content/mask.js', 'content/replay-recorder.js', 'content/vitals.js', 'content/checks.js', 'content/keymap.js', 'content/autopilot.js'];

await atest('granted and asleep: only the cheap start script (bridge.js, no stylesheet) is registered', async () => {
  const w = await world();
  await w.site.syncSiteScripts();
  assert.deepEqual(w.ids(), ['uqa-site-start']);
  const [spec] = w.specs();
  assert.deepEqual(spec.js, ['content/bridge.js']);
  assert.equal(spec.css, undefined);
  assert.equal(spec.runAt, 'document_start');
  assert.equal(spec.allFrames, true);
  assert.deepEqual(spec.matches, ['https://app.test/*']);
});

await atest('asleep, granting a site injects only the cheap script into the open tab', async () => {
  const w = await world();
  await w.site.injectSiteScripts();
  assert.deepEqual(w.calls.executed.map((x) => x.files), [['content/bridge.js']]);
});

await atest('wake registers every heavy script (same files, order, run_at as before, not persisted); sleep removes them', async () => {
  const w = await world();
  await w.site.syncSiteScripts();
  await w.armed.arm(1);
  assert.deepEqual(w.ids(), ['uqa-page-hooks', 'uqa-site-idle-heavy', 'uqa-site-start', 'uqa-site-start-heavy']);
  const heavy = w.specs().filter((x) => x.id.endsWith('-heavy'));
  assert.deepEqual(heavy.flatMap((x) => x.js), ALL_JS, 'the heavy set is the whole former set');
  assert.ok(heavy.every((x) => x.persistAcrossSessions === false && x.allFrames === true));
  assert.deepEqual(heavy.map((x) => x.runAt).sort(), ['document_idle', 'document_start']);
  assert.ok(w.calls.executed.some((x) => x.css?.includes('content/overlay.css')), 'the open tab gets the stylesheet at wake');
  const before = w.calls.register.length;
  await w.armed.arm(2);
  assert.equal(w.calls.register.length, before, 'a second window registers nothing new');
  await w.armed.disarm(1);
  assert.ok(w.ids().includes('uqa-site-start-heavy'), 'window 2 still needs them');
  await w.armed.disarm(2);
  assert.deepEqual(w.ids(), ['uqa-site-start'], 'asleep again: the cheap script only');
});

await atest('a worker that restarts asleep removes heavy scripts left behind; one that restarts awake keeps them', async () => {
  const w = await world();
  await w.site.syncSiteScripts();
  await w.armed.arm(1);
  await w.armed.syncHooks();
  assert.ok(w.ids().includes('uqa-site-idle-heavy'));
  await chrome.storage.session.remove('armedWindows');
  await w.armed.syncHooks();
  assert.deepEqual(w.ids(), ['uqa-site-start']);
});

await atest('an upgrade: the old full uqa-site-start and the old uqa-site-idle are cut down on the first sync', async () => {
  const old = [
    { id: 'uqa-site-start', js: ['content/selector-engine.js', 'content/replay-buffer.js', 'content/bridge.js', 'content/recorder.js', 'content/ui-host.js'], css: ['content/overlay.css'], matches: ['https://app.test/*'], allFrames: true, runAt: 'document_start', world: 'ISOLATED' },
    { id: 'uqa-site-idle', js: ['content/mask.js'], matches: ['https://app.test/*'], allFrames: true, runAt: 'document_idle', world: 'ISOLATED' },
  ];
  const w = await world(['https://app.test/*'], old);
  await w.site.syncSiteScripts();
  assert.deepEqual(w.ids(), ['uqa-site-start']);
  assert.deepEqual(w.specs()[0].js, ['content/bridge.js']);
});

await atest('revoking every site removes the cheap and the heavy scripts', async () => {
  const w = await world();
  await w.site.syncSiteScripts();
  await w.armed.arm(1);
  chrome.permissions.getAll = async () => ({ origins: [] });
  await w.site.syncSiteScripts();
  assert.deepEqual(w.ids().filter((id) => id.startsWith('uqa-site')), []);
});

await atest('the cheap script is under a fifth of what wake adds, computed from the files on disk', () => {
  const size = (fs_) => fs_.reduce((a, f) => a + fs.statSync(path.join(root, f)).size, 0);
  assert.ok(size(['content/bridge.js']) * 5 < size([...ALL_JS, 'content/overlay.css']), 'bridge.js is no longer the small half');
});

console.log(`${n} passed, 0 failed`);
