/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt signal (DESIGN-bug-hunt section 9, lane D): content/bridge.js writes `dataset.qawState`, `qawNotes`, `qawShots`
 * and fires `qaw:state` on http://localhost:4173, top frame only, and nowhere else.
 *
 *   node tools/test-game-signal.mjs        (from extension/, PYTHONUTF8=1)
 *
 * The real bridge.js runs in a node:vm context with a fake window, document and chrome. No browser, no network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EXT } from './lib-paths.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const SRC = fs.readFileSync(path.join(EXT, 'content', 'bridge.js'), 'utf8');
const ID = 'ext-id';
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

/** Boot the real bridge. `armed` and `stateReply` are what the worker answers; `hold` makes it never answer. */
async function boot({ origin = 'http://localhost:4173', sub = false, armed = true, stateReply = { recording: false, used: {} }, hold = false, gamePage = true, nonce = 'a1b2c3d4e5f60718293a4b5c6d7e8f90', href = '' } = {}) {
  const listeners = { window: 0, document: 0, onMessage: 0 };
  const events = [];
  const dataset = {};
  const reply = { armed, stateReply };
  let onMsg = null;
  const win = {};
  const doc = {
    visibilityState: 'visible',
    documentElement: { dataset },
    getElementById: (id) => (gamePage && id === 'qawLine' ? { id } : id === 'qawRun' && nonce !== null ? { id, content: nonce } : null),
    addEventListener() { listeners.document++; },
    dispatchEvent(e) { events.push(e); return true; },
  };
  Object.assign(win, {
    document: doc,
    location: { origin, href: origin + (href || '/') },
    addEventListener() { listeners.window++; },
    dispatchEvent() { return true; },
    postMessage() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    chrome: {
      runtime: {
        id: ID,
        getURL: (p) => `chrome-extension://${ID}/${p}`,
        lastError: null,
        sendMessage(msg, cb) {
          if (hold) return;
          const t = msg.type;
          const out = t === 'UQA_ARMED' ? { result: { armed: reply.armed } }
            : t === 'UQA_GET_STATE' ? { ok: true, result: reply.stateReply }
              : t === 'UQA_GET_SETTINGS' ? { ok: true, result: {} } : null;
          setImmediate(() => cb(out));
        },
        onMessage: { addListener(fn) { listeners.onMessage++; onMsg = fn; } },
      },
    },
    setInterval: () => 0,
    setTimeout: () => 0,
    clearInterval() {},
    console,
  });
  win.window = win;
  win.top = sub ? {} : win;
  win.self = win;
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: 'bridge.js' });
  await tick();
  return {
    dataset, events, listeners, win,
    /** The worker's answer changed and the page is told: UQA_STATE_CHANGED (then the bridge asks) and UQA_ARMED_CHANGED. */
    async change({ armed: a, stateReply: s } = {}) {
      if (a !== undefined) { reply.armed = a; onMsg({ type: 'UQA_ARMED_CHANGED', armed: a }, { id: ID }, () => {}); }
      if (s !== undefined) { reply.stateReply = s; onMsg({ type: 'UQA_STATE_CHANGED', recording: !!s.recording }, { id: ID }, () => {}); }
      await tick();
    },
  };
}

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`  ok  ${name}`); };
const ALL = ['qawBuffer', 'qawExpected', 'qawMarks', 'qawNoteTypes', 'qawNotes', 'qawShortcut', 'qawShots', 'qawState'];
const ENUM = ['asleep', 'ready', 'recording', 'stopped'];
const REC = (notes, shots) => ({ recording: true, used: { note: { count: notes }, shot: { count: shots } } });
const STOP = { recording: false, used: {} };

await test('absent until the bridge has its first answer', async () => {
  const p = await boot({ hold: true });
  assert.deepEqual(Object.keys(p.dataset), []);
  assert.equal(p.events.length, 0);
});

await test('asleep: armed answer false, not recording', async () => {
  const p = await boot({ armed: false });
  assert.equal(p.dataset.qawState, 'asleep');
  assert.equal(p.dataset.qawNotes, '0');
  assert.equal(p.dataset.qawShots, '0');
  assert.equal(p.events.at(-1).type, 'qaw:state');
});

await test('ready: awake and not recording, never recorded on this page load', async () => {
  const p = await boot({ armed: true });
  assert.equal(p.dataset.qawState, 'ready');
});

await test('recording: counts come from the answer the bridge already receives (used.note / used.shot)', async () => {
  const p = await boot({ armed: true });
  await p.change({ stateReply: REC(2, 1) });
  assert.equal(p.dataset.qawState, 'recording');
  assert.equal(p.dataset.qawNotes, '2');
  assert.equal(p.dataset.qawShots, '1');
  await p.change({ stateReply: REC(3, 1) });
  assert.equal(p.dataset.qawNotes, '3');
});

await test('stopped: was recording, now is not (awake) - counts of the session are kept', async () => {
  const p = await boot({ armed: true });
  await p.change({ stateReply: REC(2, 4) });
  await p.change({ stateReply: STOP });
  assert.equal(p.dataset.qawState, 'stopped');
  assert.equal(p.dataset.qawNotes, '2');
  assert.equal(p.dataset.qawShots, '4');
});

await test('stopped wins over asleep once a session ran on this page load', async () => {
  const p = await boot({ armed: true });
  await p.change({ stateReply: REC(1, 0) });
  await p.change({ armed: false, stateReply: STOP });
  assert.equal(p.dataset.qawState, 'stopped');
});

await test('asleep -> ready -> recording -> stopped, one event per change, detail is the state string', async () => {
  const p = await boot({ armed: false });
  await p.change({ armed: true });
  await p.change({ stateReply: REC(0, 0) });
  await p.change({ stateReply: STOP });
  const seen = p.events.map((e) => e.detail);
  assert.deepEqual(seen.filter((v, i) => v !== seen[i - 1]), ['asleep', 'ready', 'recording', 'stopped']);
  assert.equal(seen.length, 4, `no event without a change: ${seen}`);
});

await test('an unchanged answer fires nothing', async () => {
  const p = await boot({ armed: true });
  const n = p.events.length;
  await p.change({ stateReply: STOP });
  await p.change({ stateReply: STOP });
  assert.equal(p.events.length, n);
});

await test('values are always one of the four states; counts are non-negative integers', async () => {
  const p = await boot({ armed: true });
  await p.change({ stateReply: { recording: true, used: { note: { count: 'evil<script>' }, shot: { count: -5.7 } } } });
  assert.ok(ENUM.includes(p.dataset.qawState));
  assert.match(p.dataset.qawNotes, /^\d+$/);
  assert.match(p.dataset.qawShots, /^\d+$/);
  assert.equal(p.dataset.qawShots, '0');
  assert.equal(p.dataset.qawNotes, '0');
  for (const e of p.events) assert.ok(ENUM.includes(e.detail));
  assert.deepEqual(Object.keys(p.dataset).sort(), ALL);
});

await test('no other origin ever gets the attribute or the event', async () => {
  for (const origin of ['http://localhost:4174', 'http://localhost', 'https://localhost:4173', 'http://127.0.0.1:4173', 'http://localhost:4173.evil.test', 'https://example.com', 'null']) {
    const p = await boot({ origin, armed: true });
    await p.change({ stateReply: REC(1, 1) });
    await p.change({ stateReply: STOP });
    assert.deepEqual(Object.keys(p.dataset), [], `${origin}: dataset stays empty`);
    assert.equal(p.events.length, 0, `${origin}: no event`);
  }
});

await test('S-13: another app on the game port, without the status line of the game page, gets nothing', async () => {
  const p = await boot({ armed: true, gamePage: false });
  await p.change({ stateReply: REC(1, 1) });
  await p.change({ stateReply: STOP });
  assert.deepEqual(Object.keys(p.dataset), []);
  assert.equal(p.events.length, 0);
  const g = await boot({ armed: true });
  await g.change({ stateReply: REC(1, 1) });
  assert.equal(g.dataset.qawState, 'recording', 'the game page itself still gets the signal');
});

await test('S-13: a page with the status line but no (or a malformed) per-run nonce gets nothing', async () => {
  for (const nonce of [null, '', '__QAW_RUN__', 'zz'.repeat(16), 'a1b2c3']) {
    const p = await boot({ armed: true, nonce });
    await p.change({ stateReply: REC(1, 1) });
    assert.deepEqual(Object.keys(p.dataset), [], `nonce ${JSON.stringify(nonce)}`);
    assert.equal(p.events.length, 0);
  }
});

await test('S-13: the game server stamps index.html with a fresh nonce per run, and the bridge reads it', async () => {
  const { createGameServer } = await import('../game/server.mjs');
  const get = (srv) => new Promise((resolve, reject) => srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    import('node:http').then(({ default: http }) => http.get({ host: '127.0.0.1', port, path: '/' }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => { srv.close(); resolve(b); }); }).on('error', reject));
  }));
  const a = /id="qawRun" name="qaw-run" content="([0-9a-f]{32})"/.exec(await get(createGameServer({ port: 0 })));
  const b = /id="qawRun" name="qaw-run" content="([0-9a-f]{32})"/.exec(await get(createGameServer({ port: 0 })));
  assert.ok(a && b, 'the served page carries a 32-hex nonce');
  assert.notEqual(a[1], b[1], 'a new server run, a new nonce');
});

await test('the packaged practice page (the game inside the extension) gets the signal; another extension page does not', async () => {
  const origin = `chrome-extension://${ID}`;
  const practice = await boot({ origin, href: '/practice/practice.html', armed: true });
  await practice.change({ stateReply: REC(2, 1) });
  assert.equal(practice.dataset.qawState, 'recording');
  assert.equal(practice.dataset.qawNotes, '2');
  const other = await boot({ origin, href: '/popup/popup.html', armed: true });
  await other.change({ stateReply: REC(2, 1) });
  assert.deepEqual(Object.keys(other.dataset), [], 'an extension page that is not the practice page gets no game signal');
  const fixed = await boot({ origin, href: '/practice/practice.html', armed: true, nonce: '0'.repeat(32) });
  assert.equal(fixed.dataset.qawState, 'ready', 'the fixed nonce build-practice.mjs writes is a valid one');
});

await test('a subframe on the game origin gets nothing', async () => {
  const p = await boot({ sub: true, armed: true });
  await p.change({ stateReply: REC(1, 1) });
  assert.deepEqual(Object.keys(p.dataset), []);
  assert.equal(p.events.length, 0);
});

await test('no listener leak: state changes add no listener beyond the ones the bridge already had', async () => {
  const game = await boot({ armed: true });
  const other = await boot({ origin: 'https://example.com', armed: true });
  const before = JSON.stringify(game.listeners);
  await game.change({ stateReply: REC(1, 1) });
  await game.change({ stateReply: STOP });
  await game.change({ armed: false });
  assert.equal(JSON.stringify(game.listeners), before, 'no listener added per change');
  assert.equal(JSON.stringify(game.listeners), JSON.stringify(other.listeners), 'the game origin adds no listener over any other page');
});

await test('more signals: shortcut, note types and mark ups come from used.* of the answer the bridge already gets', async () => {
  const p = await boot({ armed: true });
  await p.change({ stateReply: { recording: true, used: { note: { count: 3 }, notetype: { count: 1 }, shortcut: { count: 1 }, markup: { count: 2 }, shot: { count: 2 } } } });
  assert.equal(p.dataset.qawShortcut, '1');
  assert.equal(p.dataset.qawNoteTypes, '1');
  assert.equal(p.dataset.qawMarks, '2');
  assert.equal(p.dataset.qawNotes, '3');
  assert.equal(p.dataset.qawShots, '2');
  await p.change({ stateReply: STOP });
  assert.equal(p.dataset.qawMarks, '2', 'kept after Stop');
  assert.equal(p.dataset.qawState, 'stopped');
});

await test('more signals: a trusted Not a bug press (emit kind expected) counts; other kinds do not', async () => {
  const p = await boot({ armed: true });
  await p.change({ stateReply: REC(0, 0) });
  assert.equal(p.dataset.qawExpected, '0');
  p.win.UQABridge.emit({ kind: 'expected', forKey: 'k' });
  p.win.UQABridge.emit({ kind: 'expected', forKey: 'k2' });
  p.win.UQABridge.emit({ kind: 'dom' });
  assert.equal(p.dataset.qawExpected, '2');
  assert.equal(p.events.at(-1).detail, 'recording');
});

await test('more signals: a Save last 2 minutes start (non-empty handoff) counts once; an empty handoff does not', async () => {
  const p = await boot({ armed: true });
  let once = [{ kind: 'dom', ts: 1 }, { kind: 'net', ts: 2 }]; // the real handoff gives the frozen events away once
  p.win.UQABuffer = { on: false, handoff: () => { const out = once; once = []; return out; } };
  await p.change({ stateReply: REC(0, 0) });
  assert.equal(p.dataset.qawBuffer, '1');
  const q = await boot({ armed: true });
  q.win.UQABuffer = { on: false, handoff: () => [] };
  await q.change({ stateReply: REC(0, 0) });
  assert.equal(q.dataset.qawBuffer, '0');
});

await test('more signals: nothing appears on other origins or in a subframe, and no text or URL is ever in a value', async () => {
  for (const o of [{ origin: 'https://example.com' }, { sub: true }]) {
    const p = await boot({ ...o, armed: true });
    p.win.UQABuffer = { on: false, handoff: () => [{ kind: 'dom' }] };
    await p.change({ stateReply: { recording: true, used: { shortcut: { count: 4 }, markup: { count: 4 }, notetype: { count: 4 } } } });
    p.win.UQABridge.emit({ kind: 'expected', forKey: 'secret' });
    assert.deepEqual(Object.keys(p.dataset), []);
    assert.equal(p.events.length, 0);
  }
  const g = await boot({ armed: true });
  let once = [{ kind: 'dom' }];
  g.win.UQABuffer = { on: false, handoff: () => { const out = once; once = []; return out; } };
  await g.change({ stateReply: { recording: true, used: { note: { count: 1, text: 'tester secret' }, markup: { count: 1 } } } });
  g.win.UQABridge.emit({ kind: 'expected', forKey: 'secret https://x.test' });
  for (const k of ALL.filter((k) => k !== 'qawState')) assert.match(g.dataset[k], /^\d+$/, k);
  assert.ok(!JSON.stringify([g.dataset, g.events]).includes('secret'));
});

await test('worker side: the three worker-reported counts exist (markup in COUNTS_AS, notetype and shortcut in the worker) and the worker did not grow a line', async () => {
  const dt = fs.readFileSync(path.join(EXT, 'background', 'dispatch-tables.js'), 'utf8');
  const entry = fs.readFileSync(path.join(EXT, 'background', 'service-worker.js'), 'utf8');
  const sw = workerSrc(); // OF-18: the entry and the modules split out of it
  assert.match(dt, /UQA_MEDIA_SAVE_EDIT: 'markup'/);
  assert.match(sw, /noteUse\('notetype'/);
  assert.match(sw, /noteUse\(session\.id, 'shortcut'\)/); // via startSession({ shortcut: true }), so the toggle-recording harnesses need no new free variable
  const max = JSON.parse(fs.readFileSync(path.join(EXT, 'tools', 'line-ratchet.json'), 'utf8')).lines['background/service-worker.js'];
  const lines = entry.split(/\r?\n/).length;
  assert.ok(lines <= max, `service-worker.js ${lines} lines vs ratchet ${max}`);
});

await test('source: the origin is one named const, read-only, and the manifest is untouched', async () => {
  assert.equal((SRC.match(/GAME_ORIGIN/g) || []).length, 2, 'declared once, used once');
  assert.equal((SRC.match(/location\.origin/g) || []).length, 1, 'the origin is read once');
  assert.match(SRC, /location\.origin === GAME_ORIGIN \|\| location\.href\.startsWith\(chrome\.runtime\?\.getURL\?\.\('practice\/'\) \|\| '\\0'\)\) && window\.top === window/);
  const m = fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8');
  assert.ok(!/4173/.test(m) && !/localhost/.test(m), 'no localhost host or permission in manifest.json');
});

console.log(`test-game-signal: ${passed} passed`);
