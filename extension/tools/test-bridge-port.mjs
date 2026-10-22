/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * D-1010-78 (r4-02-1): evidence travels on a MessageChannel port, never as a window message.
 *
 * content/page-hooks.js (MAIN world) and content/bridge.js (ISOLATED world) run in two vm
 * contexts that share one message bus, the way the two worlds share one window. The ports are
 * Node's real MessageChannel. What is asserted: a forged `uqa-page` window message is dropped,
 * the real handshake delivers a recorded request, a second port is ignored (the first wins),
 * a port event of a kind the hooks never post is dropped, and rule-fired travels the same way.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = fs.readFileSync(path.join(EXT, 'content', 'page-hooks.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(EXT, 'content', 'bridge.js'), 'utf8');
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

/** One bus, two worlds: a post from either reaches the listeners of both, with `source` = that world's own window. */
function makeBus() {
  const worlds = [];
  const world = () => {
    const listeners = [];
    const win = {
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
      removeEventListener() {},
      postMessage(data, _origin, transfer) {
        setTimeout(() => {
          for (const w of worlds) {
            let stopped = false;
            for (const fn of [...w.listeners]) {
              if (stopped) break;
              fn({ source: w.win, data, ports: transfer || [], stopImmediatePropagation() { stopped = true; } });
            }
          }
        }, 0);
      },
      dispatchEvent() { return true; },
      setTimeout, clearTimeout,
    };
    win.window = win;
    win.top = win;
    worlds.push({ win, listeners });
    return win;
  };
  return {
    world,
    forge: (data, ports = []) => {
      for (const w of worlds) for (const fn of [...w.listeners]) fn({ source: w.win, data, ports, stopImmediatePropagation() {} });
    },
  };
}

function boot({ hooks = true, bridge = true, armed = true } = {}) {
  const bus = makeBus();
  const sent = [];
  const out = { bus, sent };
  if (hooks) {
    const win = bus.world();
    win.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    win.XMLHttpRequest = class { open() {} send() {} setRequestHeader() {} addEventListener() {} };
    win.console = console;
    const ctx = vm.createContext({
      window: win, console, performance, URL, TextDecoder, Date, Promise, Map, Set, Math, Object, Array, String, Number, Error, TypeError,
      JSON, RegExp, WeakMap, Symbol, MessageChannel, Response, Headers, setTimeout, clearTimeout,
      location: { href: 'https://site.test/', origin: 'https://site.test' }, document: { addEventListener() {}, readyState: 'complete' }, navigator: {},
    });
    vm.runInContext(HOOKS, ctx, { filename: 'page-hooks.js' });
    out.main = win;
  }
  if (bridge) {
    const win = bus.world();
    const ctx = vm.createContext({
      window: win, top: win, console, setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
      chrome: { runtime: { id: 'ext', lastError: null, sendMessage(msg, cb) { sent.push(msg); cb?.(msg.type === 'UQA_ARMED' ? { ok: true, result: { armed } } : null); }, onMessage: { addListener() {} } } },
      location: { href: 'https://app.test/' },
      document: { visibilityState: 'visible', querySelectorAll: () => [], baseURI: 'https://app.test/', addEventListener() {} },
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    });
    vm.runInContext(BRIDGE, ctx, { filename: 'content/bridge.js' });
    out.iso = win;
  }
  return out;
}
const events = (sent) => sent.filter((m) => m.type === 'UQA_EVENT').map((m) => m.event);

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.stack || err.message}`); }
}

console.log('bridge port — evidence only over the handed-over channel');

await test('a forged uqa-page window message is dropped, before and after the handshake', async () => {
  const e = boot();
  await tick();
  e.iso.UQABridge.setRecording(true);
  e.bus.forge({ source: 'uqa-page', event: { kind: 'net', ts: 1, url: '/forged' } });
  await tick();
  e.bus.forge({ source: 'uqa-page', event: { kind: 'net', ts: 2, url: '/forged-late' } });
  e.bus.forge({ source: 'uqa-rule-fired', ruleId: 'forged' });
  await tick();
  assert.deepEqual(events(e.sent), []);
  assert.equal(e.sent.filter((m) => m.type === 'UQA_RULE_FIRED').length, 0, 'a window uqa-rule-fired is still read');
});

await test('the real handshake delivers a recorded request over the port, once awake', async () => {
  const e = boot();
  await tick();
  e.iso.UQABridge.setRecording(true);
  await tick(60); // the bridge's armed answer reaches the hooks over the port
  await e.main.fetch('https://app.test/api/x').catch(() => {});
  await tick(40);
  const nets = events(e.sent).filter((x) => x.kind === 'net');
  assert.equal(nets.length, 1, `expected one relayed net event, got ${JSON.stringify(events(e.sent))}`);
});

await test('a second port is ignored: the first one wins', async () => {
  const e = boot();
  await tick();
  e.iso.UQABridge.setRecording(true);
  const forged = new MessageChannel();
  e.bus.forge({ source: 'uqa-port' }, [forged.port2]);
  forged.port1.postMessage({ t: 'event', event: { kind: 'net', ts: 9, url: '/forged-port' } });
  await tick();
  forged.port1.close();
  assert.deepEqual(events(e.sent), []);
});

await test('with no hooks yet, the first port offered is the one kept, and a kind the hooks never post is dropped', async () => {
  const e = boot({ hooks: false });
  await tick();
  e.iso.UQABridge.setRecording(true);
  const first = new MessageChannel();
  const second = new MessageChannel();
  const acks = [];
  first.port1.onmessage = (m) => acks.push(m.data);
  e.bus.forge({ source: 'uqa-port' }, [first.port2]);
  e.bus.forge({ source: 'uqa-port' }, [second.port2]);
  first.port1.postMessage({ t: 'event', event: { kind: 'dom', ts: 1, action: 'click' } });
  first.port1.postMessage({ t: 'event', event: { kind: 'net', ts: 2, url: '/ok' } });
  first.port1.postMessage({ t: 'rule-fired', ruleId: 'r1' });
  second.port1.postMessage({ t: 'event', event: { kind: 'net', ts: 3, url: '/second' } });
  await tick(40);
  assert.deepEqual(acks.filter((a) => typeof a === 'string'), ['uqa-ack'], 'receipt is acknowledged over the port');
  assert.deepEqual(acks.filter((a) => typeof a !== 'string').map((a) => a.t), ['awake', 'rules'], 'OF-10: the armed answer reaches the page end over the same port, after the ack');
  assert.deepEqual(events(e.sent).map((x) => x.url), ['/ok'], 'only the first port, only the hook kinds');
  assert.deepEqual(e.sent.filter((m) => m.type === 'UQA_RULE_FIRED').map((m) => m.ruleId), ['r1']);
  first.port1.close();
  second.port1.close();
});

await test('a port message that is not an object of the agreed shape is dropped', async () => {
  const e = boot({ hooks: false });
  await tick();
  e.iso.UQABridge.setRecording(true);
  const ch = new MessageChannel();
  e.bus.forge({ source: 'uqa-port' }, [ch.port2]);
  for (const junk of [null, 'x', 7, { t: 'event' }, { t: 'nope', event: { kind: 'net' } }]) ch.port1.postMessage(junk);
  await tick(30);
  ch.port1.close();
  assert.deepEqual(events(e.sent), []);
});

await test('D-1010-89: after pairing a page hello is not answered, and events after forged hellos still reach the real port', async () => {
  const e = boot();
  await tick();
  e.iso.UQABridge.setRecording(true);
  await tick(60); // the bridge's ack has reached the hooks: paired
  let offers = 0;
  e.main.addEventListener('message', (m) => { if (m.data?.source === 'uqa-port') offers++; });
  e.bus.forge({ source: 'uqa-hello' });
  e.bus.forge({ source: 'uqa-hello' });
  await tick(30);
  assert.equal(offers, 0, 'no port is re-offered after the ack');
  await e.main.fetch('https://app.test/api/after-hello').catch(() => {});
  await tick(40);
  assert.equal(events(e.sent).filter((x) => x.kind === 'net').length, 1, 'events after forged hellos still reach the real port');
});

await test('D-1010-89: before pairing one offer is outstanding; a stale or forged ack never pairs, the current one does, then hellos are ignored', async () => {
  const e = boot({ bridge: false });
  const got = [];
  e.main.addEventListener('message', (m) => { if (m.data?.source === 'uqa-port') got.push(m.ports[0]); });
  await tick();
  e.bus.forge({ source: 'uqa-hello' });
  await tick(30);
  assert.ok(got.length >= 2, 'a hello before pairing is answered');
  const stale = got[0];
  const live = got[got.length - 1];
  let queued = 0;
  live.onmessage = (m) => { if (m.data?.t === 'event') queued++; };
  stale.postMessage('uqa-ack'); // its offer was replaced and closed: must not pair
  await tick(30);
  live.postMessage('uqa-ack'); // the current offer: pairs, flushes the outbox
  await tick(30);
  const before = got.length;
  e.bus.forge({ source: 'uqa-hello' });
  await tick(30);
  assert.equal(got.length, before, 'paired: a hello is not answered');
  stale.close(); live.close();
});

await test('OF-10: awake, act and rules are accepted only from the paired port; forged window messages of the old shape do nothing', async () => {
  const e = boot({ armed: false });
  await tick(60); // paired; the bridge said "asleep"
  e.bus.forge({ source: 'uqa-awake', awake: true });
  e.bus.forge({ source: 'uqa-rules', rules: [{ id: 'f', enabled: true, action: 'status', status: 500, pattern: '/api' }] });
  e.bus.forge({ source: 'uqa-act', act: 9 });
  e.iso.UQABridge.setRecording(true);
  const r = await e.main.fetch('https://app.test/api/forged').then((x) => 'resolved ' + x.status, (x) => String(x));
  await tick(40);
  assert.match(r, /Failed to fetch/, 'a forged rules message must not turn the request into a 500');
  assert.deepEqual(events(e.sent), [], 'a forged awake does not wake the page');
});

await test('OF-10: the page end applies awake, rules and act sent on the port, and drops the rules when put back to sleep', async () => {
  const e = boot({ bridge: false });
  await tick();
  const got = [];
  e.main.addEventListener('message', (m) => { if (m.data?.source === 'uqa-port') got.push(m.ports[0]); });
  e.bus.forge({ source: 'uqa-hello' });
  await tick(30);
  const live = got[got.length - 1];
  const seen = [];
  live.onmessage = (m) => seen.push(m.data);
  live.postMessage('uqa-ack');
  live.postMessage({ t: 'awake', awake: true });
  live.postMessage({ t: 'act', act: 4 });
  live.postMessage({ t: 'rules', rules: [{ id: 'r', enabled: true, action: 'status', status: 500, method: 'ANY', pattern: '/api/z' }] });
  await tick(30);
  const res = await e.main.fetch('https://app.test/api/z');
  assert.equal(res.status, 500, 'a rule delivered on the port is applied');
  await tick(40);
  const rows = seen.filter((m) => m?.t === 'event' && m.event.kind === 'net');
  assert.ok(rows.length >= 1, 'the overridden request is reported');
  live.postMessage({ t: 'awake', awake: false });
  await tick(30);
  const res2 = await e.main.fetch('https://app.test/api/z').then((x) => 'resolved ' + x.status, (x) => String(x));
  assert.match(res2, /Failed to fetch/, 'asleep again: the rules went with it');
  live.close();
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
