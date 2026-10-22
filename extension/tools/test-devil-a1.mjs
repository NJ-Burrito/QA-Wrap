/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Capture reliability (devil points 1, 5, 6, 18).   node tools/test-devil-a1.mjs
 * Runs the real source text of each fix in a vm with stubs, since the worker and
 * db.js cannot be imported in Node.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createWriteQueue } from '../background/write-queue.js';
import { workerSrc } from './lib-worker-src.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const worker = workerSrc();
const db = read('core/db.js');
const bridge = read('content/bridge.js');
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };
const cut = (src, from, to) => { const i = src.indexOf(from); assert.ok(i >= 0, from); return src.slice(i, src.indexOf(to, i)); };

await test('1: replay chunks from two pages get distinct, monotonic seqs (also after restart)', async () => {
  const code = cut(db, 'const replaySeqs = new Map();', '/** Store one chunk');
  const stored = [4]; // a restarted worker: chunk 4 already on disk
  // r8-06-5: the seed is the last key of the [sessionId, seq] range, read through a reverse key cursor
  const tx = async (_store, _mode, fn) => {
    let cursor; const box = fn({ openKeyCursor: () => (cursor = {}) });
    cursor.result = stored.length ? { key: ['s', Math.max(...stored)] } : null; cursor.onsuccess();
    return box.__value;
  };
  const ctx = vm.createContext({ tx, IDBKeyRange: { bound: () => ({}) }, Map, Promise, WeakSet });
  vm.runInContext(code.replace(/^export /gm, '') + ';globalThis.next = nextReplaySeq;', ctx);
  const got = await Promise.all([ctx.next('s'), ctx.next('s'), ctx.next('s')]);
  assert.deepEqual(got, [5, 6, 7]);
  assert.match(worker, /putReplayChunk\(\{ sessionId, entries \}\)/, 'the worker must not pass the page seq');
});

await test('5: bridge holds early events, sends them on recording, drops them on not-recording', async () => {
  const sent = [];
  const mk = () => {
    const w = { addEventListener() {}, postMessage() {}, dispatchEvent() {}, top: null, location: { href: 'http://x/' } };
    w.top = w;
    const chrome = {
      runtime: { id: 'me', lastError: null, onMessage: { addListener() {} }, sendMessage: (m, cb) => { sent.push(m); cb && cb(null); } },
    };
    const ctx = vm.createContext({ window: w, chrome, location: w.location, document: { visibilityState: 'hidden', addEventListener() {} }, CustomEvent: class {}, Date, Object, Promise, Set, setInterval() {} });
    vm.runInContext(bridge, ctx);
    return w.UQABridge;
  };
  let b = mk();
  sent.length = 0;
  for (let i = 0; i < 250; i++) b.emit({ kind: 'fetch', i });
  b.setRecording(true);
  const evs = sent.filter((m) => m.type === 'UQA_EVENT');
  assert.equal(evs.length, 200, 'buffer must be capped at 200');
  assert.ok(evs[0].event.ts && evs[0].event.frameUrl);
  b = mk(); sent.length = 0;
  b.emit({ kind: 'fetch' }); b.setRecording(false); b.setRecording(true);
  assert.equal(sent.filter((m) => m.type === 'UQA_EVENT').length, 0, 'not-recording answer must discard the buffer');
  assert.match(read('content/page-hooks.js'), /undecided/);
});

await test('6: a failed batch is retried once, then counted with a capture-gap note', async () => {
  const gaps = [];
  const ctx = vm.createContext({ console, Map, String, Date, appendEvents: async (b) => { gaps.push(...b); return []; } });
  vm.runInContext(cut(worker, 'const captureLost = new Map();', 'const writeQueue'), ctx);
  let calls = 0;
  const q = createWriteQueue({ write: async () => { calls++; throw new Error('quota'); }, onError: (e, b) => ctx.noteCaptureGap(e, b) });
  await q.push({ sessionId: 's1', kind: 'fetch' }).catch(() => {});
  await q.flush();
  assert.equal(calls, 2, 'one write plus exactly one retry');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].tag, 'capture-gap');
  assert.equal(gaps[0].lost, 1);
  assert.match(worker, /captureLost: captureLost\.get\(id\)/);
});

await test('18: window-map writers are serialised and seqChain survives a rejection', async () => {
  const code = cut(worker, 'let mapLock = Promise.resolve();', 'async function noteSessionStarted');
  const ctx = vm.createContext({ Promise, setTimeout });
  vm.runInContext(code + ';globalThis.lock = withMapLock;', ctx);
  let map = {};
  const add = (k) => ctx.lock(async () => { const m = { ...map }; await new Promise((r) => setTimeout(r, 5)); m[k] = 1; map = m; });
  await Promise.all([add('a'), add('b'), add('c')]);
  assert.deepEqual(Object.keys(map).sort(), ['a', 'b', 'c'], 'a concurrent start lost its window entry');
  const bad = ctx.lock(async () => { throw new Error('x'); });
  await assert.rejects(bad);
  await ctx.lock(async () => {}); // lock not poisoned
  const fn = cut(worker, 'let seqChain = Promise.resolve(0);', 'function newId');
  let fail = true; let store = 0;
  const c2 = vm.createContext({ Promise, chrome: { storage: { local: {
    get: async () => { if (fail) { fail = false; throw new Error('once'); } return { sessionSeq: store }; },
    set: async (o) => { store = o.sessionSeq; } } } } });
  vm.runInContext(fn + ';globalThis.next = nextSessionSeq;', c2);
  await assert.rejects(c2.next());
  assert.equal(await c2.next(), 1, 'Start is stuck after one rejection');
});

console.log(`\n${n} passed, 0 failed`);
