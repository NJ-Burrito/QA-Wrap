/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The 2-minute replay buffer (features-1010, decision 4).   node tools/test-replay-buffer.mjs
 *
 * The real content/replay-buffer.js and the real content/bridge.js run in one vm with a fake chrome that has NO storage at all
 * (the worker closes storage to content scripts) and no indexedDB, fetch or localStorage: any disk or network touch would
 * throw. The only thing the buffer asks the worker is UQA_BUFFER_ON, "is this site switched on". What is proved:
 *   - off by default, and only on a site that is listed;
 *   - the 120 s drop (older events are gone, and gone from the saved result too);
 *   - bounded in count and in size;
 *   - nothing is written and nothing is sent to the worker while buffering;
 *   - masking: no body, no header, no credential in a URL, a token or a bearer in console text, masked field values;
 *   - «Save last 2 minutes» hands over exactly the frozen events as pre-roll; a plain Start hands over nothing and empties it;
 *   - recording sessions are not buffered; the freeze message is honoured only from the extension itself.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { workerSrc } from './lib-worker-src.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const bufferSrc = read('content/replay-buffer.js');
const bridgeSrc = read('content/bridge.js');
const recorderSrc = read('content/recorder.js');
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

const ORIGIN = 'https://app.test';

async function load({ sites = [ORIGIN], awake = true } = {}) {
  const sent = [];
  const listeners = [];
  const state = { sites };
  let clock = 1_800_000_000_000;
  const FakeDate = class { static now() { return clock; } };
  const trap = (what) => ({ get() { throw new Error(`the buffer touched ${what}`); } });
  const win = { top: null, addEventListener() {}, dispatchEvent() {}, postMessage() {}, location: { href: `${ORIGIN}/page?x=1`, origin: ORIGIN }, UQASettings: {} };
  win.top = win;
  const chrome = {
    runtime: {
      id: 'me', lastError: null,
      onMessage: { addListener: (f) => listeners.push(f) },
      sendMessage: (m, cb) => {
        sent.push(m);
        cb(m.type === 'UQA_BUFFER_ON' ? { ok: true, result: state.sites.includes(ORIGIN) } : m.type === 'UQA_ARMED' ? { result: { armed: awake } } : m.type === 'UQA_GET_STATE' ? { result: { recording: false } } : m.type === 'UQA_GET_SETTINGS' ? { ok: true, result: {} } : null);
      },
    },
  };
  const ctx = vm.createContext({ window: win, chrome, document: { visibilityState: 'hidden', addEventListener() {} }, location: win.location, CustomEvent: class {}, Promise, Date: FakeDate, setInterval() { return 1; }, clearInterval() {}, setTimeout, clearTimeout });
  for (const k of ['indexedDB', 'fetch', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'navigator']) Object.defineProperty(ctx, k, trap(k));
  Object.defineProperty(chrome, 'storage', trap('chrome.storage'));
  vm.runInContext(bufferSrc, ctx);
  vm.runInContext(bridgeSrc, ctx);
  await new Promise((r) => setTimeout(r, 20));
  win.UQAAwake = awake;
  const tell = (msg, sender = { id: 'me' }) => { let res; listeners.forEach((f) => f(msg, sender, (r) => { res = r; })); return res; };
  return { win, sent, tell, B: win.UQABridge, U: win.UQABuffer, tick: (ms) => { clock += ms; }, state, events: () => sent.filter((m) => m.type === 'UQA_EVENT') };
}

await test('off by default and off on a site that is not listed: nothing is kept', async () => {
  const none = await load({ sites: [] });
  none.B.emit({ kind: 'console', text: 'a', level: 'error' });
  assert.equal(none.U.size(), 0);
  const other = await load({ sites: ['https://other.test'] });
  other.B.emit({ kind: 'console', text: 'a', level: 'error' });
  assert.equal(other.U.size(), 0);
  const asleep = await load({ awake: false });
  asleep.B.emit({ kind: 'console', text: 'a', level: 'error' });
  assert.equal(asleep.U.size(), 0, 'a window that is asleep keeps nothing');
});

await test('on for a listed site: events are kept in this page and none is sent to the worker', async () => {
  const { B, U, events } = await load();
  B.emit({ kind: 'console', text: 'boom', level: 'error' });
  B.emit({ kind: 'dom', action: 'click', label: 'Save', locator: "getByRole('button', { name: 'Save' })" });
  B.emit({ kind: 'net', method: 'POST', url: `${ORIGIN}/api/x`, status: 500 });
  assert.equal(U.size(), 3);
  assert.equal(events().length, 0, 'nothing reached the worker');
  assert.equal(B.buffering(), true);
});

await test('the 120 s drop: older events are dropped on the next event, and are absent from what is saved', async () => {
  const { B, U, tick, tell, events } = await load();
  B.emit({ kind: 'console', text: 'old one', level: 'error' });
  tick(60_000);
  B.emit({ kind: 'console', text: 'middle', level: 'error' });
  tick(60_000); // the first is exactly 120 s old: kept
  B.emit({ kind: 'console', text: 'edge', level: 'error' });
  assert.equal(U.size(), 3);
  tick(1);      // now the first is 120.001 s old
  B.emit({ kind: 'console', text: 'new', level: 'error' });
  assert.equal(U.size(), 3, 'the oldest is gone');
  assert.equal(tell({ type: 'UQA_BUFFER_FREEZE' }).count, 3);
  tell({ type: 'UQA_STATE_CHANGED', recording: true });
  const texts = events().map((m) => m.event.text);
  assert.deepEqual(texts, ['middle', 'edge', 'new']);
  assert.ok(!texts.includes('old one'));
});

await test('bounded: count and size never pass their ceilings', async () => {
  const { B, U } = await load();
  for (let i = 0; i < 3000; i++) B.emit({ kind: 'console', text: 'x'.repeat(900), stack: 'y'.repeat(900), level: 'error', a: 'z'.repeat(900), b: 'z'.repeat(900) });
  assert.ok(U.size() <= 1500, `count ${U.size()}`);
  assert.ok(U.bytes() <= 1_500_000, `bytes ${U.bytes()}`);
});

await test('no disk and no network: the fake chrome has no write, and the source names none', async () => {
  // load() already proves it by construction (a set(), indexedDB, fetch, localStorage would throw). The source says so too.
  const code = bufferSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const word of ['indexedDB', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'localStorage', 'sessionStorage', 'chrome.storage', 'storage.local', 'storage.session', 'sendMessage', 'WebSocket', 'importScripts', 'import(']) {
    assert.ok(!code.includes(word), `replay-buffer.js must not contain ${word}`);
  }
  const { B, tell, events } = await load();
  B.emit({ kind: 'console', text: 'kept in memory', level: 'error' });
  tell({ type: 'UQA_BUFFER_FREEZE' });
  assert.equal(events().length, 0, 'freezing is not saving: nothing leaves until a session starts');
});

await test('masking: no body, header, credential or token survives into what is saved', async () => {
  const { B, tell, events } = await load();
  B.emit({ kind: 'net', method: 'POST', url: `${ORIGIN}/api/login?token=SECRETTOKEN1234&access_key=AKIAABCDEF&page=2#frag`, status: 401, durationMs: 120,
    reqBody: { kind: 'text', text: 'password=hunter2hunter2' }, resBody: { kind: 'text', text: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk' },
    reqHeaders: [['Authorization', 'Bearer abcdefghijklmnopqrstuv']], resHeaders: [['Set-Cookie', 'sid=ZZZZSECRETCOOKIEVALUE']], responsePreview: 'secret preview' });
  B.emit({ kind: 'console', level: 'error', text: 'request failed: Authorization: Bearer abcdefghijklmnopqrstuvwxyz and password=hunter2hunter2 for 4111 1111 1111 1111', stack: 'at f (https://app.test/a.js:1:1)' });
  B.emit({ kind: 'dom', action: 'input', label: 'Password', value: '••••••••', masked: true, locator: "getByLabel('Password')" });
  B.emit({ kind: 'dom', action: 'input', label: 'City', value: 'Amman', locator: "getByLabel('City')" });
  tell({ type: 'UQA_BUFFER_FREEZE' });
  tell({ type: 'UQA_STATE_CHANGED', recording: true });
  const all = JSON.stringify(events().map((m) => m.event));
  for (const leak of ['SECRETTOKEN1234', 'AKIAABCDEF', 'hunter2', 'eyJhbGci', 'abcdefghijklmnop', 'SECRETCOOKIE', 'secret preview', '4111 1111']) assert.ok(!all.includes(leak), `leaked: ${leak}`);
  const net = events().map((m) => m.event).find((e) => e.kind === 'net');
  assert.equal(net.status, 401);
  assert.equal(net.method, 'POST');
  assert.match(net.url, /page=2/, 'the harmless parameter stays');
  assert.ok(!('reqBody' in net) && !('resBody' in net) && !('reqHeaders' in net) && !('resHeaders' in net));
  assert.ok(all.includes('Amman'), 'ordinary typed text is kept');
});

await test('Save last 2 minutes: exactly the frozen events go in as pre-roll; a plain Start takes nothing and empties the buffer', async () => {
  const a = await load();
  a.B.emit({ kind: 'console', text: 'one', level: 'error' });
  a.B.emit({ kind: 'console', text: 'two', level: 'error' });
  a.tell({ type: 'UQA_STATE_CHANGED', recording: true }); // a plain Start
  assert.equal(a.events().length, 0, 'nothing handed over without the Save press');
  assert.equal(a.U.size(), 0, 'and the buffer is empty now that a session records');

  const b = await load();
  b.B.emit({ kind: 'console', text: 'one', level: 'error' });
  assert.equal(b.tell({ type: 'UQA_BUFFER_FREEZE' }).count, 1);
  b.B.emit({ kind: 'console', text: 'after the press', level: 'error' });
  b.tell({ type: 'UQA_STATE_CHANGED', recording: true });
  const ev = b.events();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].preRoll, true);
  assert.equal(ev[0].event.text, 'one');
  assert.equal(b.U.size(), 0);
});

await test('while a session records nothing is buffered; the freeze message from a page or another extension is ignored', async () => {
  const { B, U, tell } = await load();
  B.emit({ kind: 'console', text: 'before', level: 'error' });
  assert.equal(tell({ type: 'UQA_BUFFER_FREEZE' }, { id: 'someone-else' }), undefined);
  assert.equal(tell({ type: 'UQA_BUFFER_FREEZE' }, { id: 'me', tab: { id: 1 } }), undefined);
  tell({ type: 'UQA_STATE_CHANGED', recording: true });
  B.emit({ kind: 'console', text: 'during', level: 'error' });
  assert.equal(U.size(), 0);
});

await test('switching the site off in Settings empties the buffer at once', async () => {
  const { B, U, state, tell } = await load();
  B.emit({ kind: 'console', text: 'a', level: 'error' });
  assert.equal(U.size(), 1);
  state.sites = [];
  tell({ type: 'UQA_BUFFER_REFRESH' }); // what the popup and Settings send to the page
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(U.size(), 0);
  B.emit({ kind: 'console', text: 'b', level: 'error' });
  assert.equal(U.size(), 0);
});

await test('wiring: the recorder keeps its actions while the buffer is on; the worker allows the 2-minute skew; the page note has a string', async () => {
  const sw = workerSrc();
  assert.match(sw, /UQA_BUFFER_ON: \(msg, sender\) => draftDoor\.bufferOn\(sender\?\.url\)/);
  assert.match(sw.slice(sw.indexOf('const CONTENT_SCRIPT_TYPES')), /'UQA_BUFFER_ON'/, 'a content script may ask it');
  assert.ok(!/UQA_BUFFER_(FREEZE|REFRESH)/.test(sw), 'the freeze and refresh messages go page-ward only, never to the worker');
  assert.match(recorderSrc, /B\?\.isRecording\(\) \|\| B\?\.buffering\?\.\(\)/);
  assert.match(workerSrc(), /const PREROLL_SKEW_MS = 130_000;/);
  assert.match(workerSrc(), /OVERLAY_KEYS = \/\^\(overlay\\\.\|buffer\\\.pill\$/);
  const en = JSON.parse(read('platform/i18n/en.json'));
  const ar = JSON.parse(read('platform/i18n/ar.json'));
  for (const k of Object.keys(en).filter((x) => /^(buffer|bridge)\./.test(x))) assert.ok(ar[k] && ar[k] !== en[k], `${k} has its own Arabic`);
  assert.equal(Object.keys(en).filter((x) => /^(buffer|bridge)\./.test(x)).length, Object.keys(ar).filter((x) => /^(buffer|bridge)\./.test(x)).length);
});

console.log(`\n${n} passed, 0 failed`);
process.exit(0); // the page's 20 s freeze timer is real inside the vm
