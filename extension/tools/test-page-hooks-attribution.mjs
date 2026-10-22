/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Chrome must not blame this extension for a website's own console messages.
 *
 *   node tools/test-page-hooks-attribution.mjs
 *
 * **The bug this exists to stop coming back.** `content/page-hooks.js` wraps
 * `console.warn` and `console.error` in the MAIN world of every page, which is
 * how the console tool sees what a site logged. Chrome attributes a console
 * message to an extension when the *script name* of the top JS frame at the
 * moment the native method runs carries the chrome-extension scheme — and our
 * wrapper is that frame. So on a machine with the extension awake, every
 * deprecation warning on every site was landing on QA Wrap's card at
 * chrome://extensions, which reads to anyone who opens it as an extension that
 * is broken on every page it touches. Nader's screenshots of a Jira instance
 * were forty of them, all page-owned, all attributed to us.
 *
 * The fix is one line at the foot of that file: a `//# sourceURL=` magic
 * comment. V8 takes it as the script name in stack traces
 * (`GetScriptNameOrSourceURL`) and Blink's SourceLocation capture reads the
 * same value, so a scheme-less name keeps the file's identity in DevTools and
 * leaves Chrome no extension URL to blame.
 *
 * This test is static on purpose. The end-to-end proof needs a fresh profile,
 * developer mode, a page that logs from its own script and the extensions
 * manager's shadow DOM read three levels down; it is in the headed probe and in
 * `research/38`. What a future edit will actually do is move or delete the line
 * while refactoring the wrapper, and this catches exactly that, in Node, in a
 * second, on every run.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { isFailure, liteFp, sanitiseEvent } from '../core/events.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(EXT, 'content', 'page-hooks.js');
const src = fs.readFileSync(file, 'utf8');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

await test('page-hooks.js names itself, so Chrome has no extension URL to blame', () => {
  const matches = [...src.matchAll(/^\/\/# sourceURL=(.+)$/gm)].map((m) => m[1].trim());
  assert.equal(matches.length, 1, `${matches.length} sourceURL comments; there must be exactly one`);
  const name = matches[0];
  assert.ok(!/^\w+:/.test(name), `"${name}" carries a scheme: a scheme-less name is the whole point`);
  assert.ok(!name.includes('chrome-extension'), 'the extension scheme in the name defeats the fix');
  assert.match(name, /qa-wrap/i, 'the name should still say whose file this is, for DevTools');
});

await test('it is the last line, where V8 reads it', () => {
  const lines = src.trimEnd().split('\n');
  assert.match(lines[lines.length - 1], /^\/\/# sourceURL=/, 'the magic comment must end the file');
});

await test('the reason is written down beside it', () => {
  // lastIndexOf, not indexOf: the comment above the line quotes the directive
  // by name, so the first occurrence is inside the explanation itself.
  const at = src.lastIndexOf('//# sourceURL=');
  const before = src.slice(Math.max(0, at - 1800), at);
  for (const word of ['chrome-extension', 'sourceURL', 'console']) {
    assert.ok(before.includes(word), `the comment above it never mentions ${word}`);
  }
  assert.match(before, /product feature/i, 'it must say the console capture itself stays');
});

await test('the console capture is still there: the fix removes the attribution, not the hook', () => {
  assert.match(src, /console\[level\]|console\.\w+ = function|original\.apply/, 'the wrapper is gone');
  assert.match(src, /kind: 'console'/, 'nothing emits a console event any more');
  assert.match(src, /for \(const level of/, 'the levels are no longer wrapped in a loop');
});

await test('r5-05-1: a failing response reaches the page at once and is reported once, after a bounded detached read', async () => {
  const posted = [];
  const handlers = {};
  const never = new Promise(() => {});
  const win = {
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    postMessage(m) { posted.push(m); },
    setTimeout,
    console,
  };
  win.window = win;
  let cancelled = 0;
  const res500 = {
    ok: false, status: 500, headers: { forEach() {} },
    // The clone's reader never answers: a stalled body must not hold the response back.
    clone: () => ({ body: { getReader: () => ({ read: () => never, cancel: () => { cancelled++; return Promise.resolve(); } }) } }),
  };
  win.fetch = () => Promise.resolve(res500);
  const ctx = vm.createContext({
    window: win, console, performance, URL, TextDecoder, Date, Promise, Map, Set, Math, Object, Array, String, Number, Error, TypeError,
    JSON, RegExp, WeakMap, Symbol, location: { href: 'https://site.test/', origin: 'https://site.test' },
    document: { addEventListener() {}, readyState: 'complete' }, navigator: {}, setTimeout, clearTimeout,
  });
  vm.runInContext(src, ctx);
  for (const fn of handlers.message || []) fn({ source: win, data: { source: 'uqa-awake', awake: true } });
  const t0 = Date.now();
  let got = null;
  win.fetch('/api/x').then((r) => { got = r; });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(got, res500, 'the page has its response while the body read is still pending');
  assert.equal(posted.filter((m) => m.event?.kind === 'net').length, 0, 'nothing reported before the read ends');
  await new Promise((r) => setTimeout(r, 2300));
  const reports = posted.filter((m) => m.event?.kind === 'net');
  assert.equal(reports.length, 1, 'reported exactly once after the timeout');
  assert.equal(reports[0].event.status, 500);
  assert.ok(reports[0].event.ts - t0 < 500, 'ts is the response time, not the end of the body read');
  assert.equal(reports[0].event.responsePreview, undefined);
  assert.equal(cancelled, 1, 'the stalled reader was cancelled');
});

await test('r2-05-1 / D-1010-20: the bridge relays only the kinds page-hooks.js posts; a page-posted dom event is not recorded', async () => {
  const bridgeSrc = fs.readFileSync(path.join(EXT, 'content', 'bridge.js'), 'utf8');
  // The kinds page-hooks.js can post at top level, read from its source: every literal `kind: '...'`, minus the body kinds nested in a net event.
  const posted = new Set([...src.matchAll(/\bkind: '(\w+)'/g)].map((m) => m[1]));
  for (const body of ['json', 'form', 'text', 'FormData']) posted.delete(body);
  assert.deepEqual([...posted].sort(), ['console', 'net', 'pageerror', 'rep'], 'page-hooks.js posts exactly these top-level kinds');
  const sent = [];
  const handlers = [];
  const sandbox = {
    console,
    chrome: { runtime: { id: 'ext', lastError: null, sendMessage(msg, cb) { sent.push(msg); cb?.(null); }, onMessage: { addListener() {} } } },
    location: { href: 'https://app.test/' },
    document: { visibilityState: 'visible', querySelectorAll: () => [], baseURI: 'https://app.test/', addEventListener() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    postMessage() {}, dispatchEvent() { return true; },
    addEventListener(type, fn) { if (type === 'message') handlers.push(fn); },
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bridgeSrc, sandbox, { filename: 'content/bridge.js' });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  sandbox.UQABridge.setRecording(true);
  const inWindow = vm.runInContext('window', sandbox); // the context's own global, which is what e.source is compared with
  // D-1010-78: the page end of the channel; the bridge keeps the first port it is handed and acknowledges it.
  const chan = new MessageChannel();
  for (const fn of handlers) fn({ source: inWindow, data: { source: 'uqa-port' }, ports: [chan.port2], stopImmediatePropagation() {} });
  const post = (event) => { chan.port1.postMessage({ t: 'event', event }); };
  const recorded = () => sent.filter((m) => m.type === 'UQA_EVENT').map((m) => m.event.kind);
  for (const kind of ['net', 'console', 'pageerror', 'rep']) post({ kind, ts: 1 });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(recorded(), ['net', 'console', 'pageerror', 'rep'], 'the four hook kinds are relayed');
  post({ kind: 'dom', ts: 2, action: 'click', selector: '#x' });
  post({ kind: 'nav', ts: 3, url: 'https://evil.test/' });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(recorded(), ['net', 'console', 'pageerror', 'rep'], 'a dom or nav event posted by the page is dropped');
  chan.port1.close();
});

/* ── round 3 (council-1010): capture correctness, in a vm with fakes ── */
function mkEnv({ XHR, navigator = {}, WebSocket, EventSource } = {}) {
  const posted = [];
  const handlers = {};
  const win = {
    addEventListener(type, fn, cap) { (handlers[type] ||= []).push({ fn, cap: cap === true }); },
    postMessage(m) { posted.push(m); },
    setTimeout,
    console,
    XMLHttpRequest: XHR,
    WebSocket,
    EventSource,
  };
  win.window = win;
  const ctx = vm.createContext({
    window: win, console, performance, URL, TextDecoder, Date, Promise, Map, Set, Math, Object, Array, String, Number, Error, TypeError,
    JSON, RegExp, WeakMap, Symbol, location: { href: 'https://site.test/', origin: 'https://site.test' },
    document: { addEventListener() {}, readyState: 'complete' }, navigator, setTimeout, clearTimeout, FormData, URLSearchParams,
  });
  return {
    win, posted, handlers,
    start() {
      vm.runInContext(src, ctx);
      this.fire('message', { source: win, data: { source: 'uqa-awake', awake: true } });
      return this;
    },
    fire(type, e, capOnly) { for (const h of handlers[type] || []) if (capOnly === undefined || h.cap === capOnly) h.fn(e); },
    nets: () => posted.filter((m) => m.event?.kind === 'net').map((m) => m.event),
    kinds: (k) => posted.filter((m) => m.event?.kind === k).map((m) => m.event),
  };
}

await test('r3-05-1: a failing request is stamped with the action current when it STARTED, not when its answer came back', async () => {
  const env = mkEnv();
  let answer;
  env.win.fetch = () => new Promise((r) => { answer = r; });
  env.start();
  env.fire('message', { source: env.win, data: { source: 'uqa-act', act: 2 } });
  const p = env.win.fetch('/api/slow');
  env.fire('message', { source: env.win, data: { source: 'uqa-act', act: 3 } }); // the tester clicks again while it is in flight
  answer(new Response('{"e":1}', { status: 500, headers: { 'content-type': 'application/json' } }));
  await p;
  await new Promise((r) => setTimeout(r, 50));
  const rows = env.nets();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].act, 2, 'epoch at request start');
  const env2 = mkEnv();
  env2.win.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  env2.start();
  env2.fire('message', { source: env2.win, data: { source: 'uqa-act', act: 3 } });
  await env2.win.fetch('/api/later').catch(() => {});
  assert.equal(env2.nets()[0].act, 3, 'a request started after the click carries the later epoch');
});

await test('r3-05-5 / D-1010-48: XHR records request headers and body (redacted) and response headers; an abort is error:false and not a failure', async () => {
  class FakeXHR {
    constructor() { this.l = {}; this.status = 0; this.responseText = ''; this.sentHeaders = {}; }
    open() {}
    setRequestHeader(n, v) { this.sentHeaders[n] = v; }
    send() {}
    addEventListener(t, f) { (this.l[t] ||= []).push(f); }
    getAllResponseHeaders() { return ['content-type: application/json', 'set-cookie: sid=abc', ''].join(String.fromCharCode(13, 10)); }
    fire(t) { for (const f of this.l[t] || []) f(); }
  }
  const env = mkEnv({ XHR: FakeXHR }).start();
  const x = new env.win.XMLHttpRequest();
  x.open('POST', '/api/save');
  x.setRequestHeader('Authorization', 'Bearer SECRET-TOKEN');
  x.setRequestHeader('X-Trace', 'abc');
  x.send(JSON.stringify({ name: 'n', password: 'hunter2' }));
  assert.equal(x.sentHeaders.Authorization, 'Bearer SECRET-TOKEN', 'the page still sends its real header');
  x.status = 500;
  x.responseText = 'boom';
  x.fire('load');
  const r = env.nets()[0];
  assert.equal(r.reqHeaders.Authorization, '«redacted»');
  assert.equal(r.reqHeaders['X-Trace'], 'abc');
  assert.ok(!JSON.stringify(r).includes('SECRET-TOKEN') && !JSON.stringify(r).includes('hunter2'));
  assert.equal(r.reqBody.kind, 'json');
  assert.equal(r.resHeaders['set-cookie'], '«redacted»');
  assert.equal(r.resHeaders['content-type'], 'application/json');
  const a = new env.win.XMLHttpRequest();
  a.open('GET', '/api/suggest?q=a');
  a.send();
  a.fire('abort');
  const ab = env.nets()[1];
  assert.equal(ab.error, false);
  assert.equal(ab.ev, 'abort');
  assert.ok(!isFailure(ab), 'events.js isFailure does not count a cancel');
  assert.ok(isFailure({ kind: 'net', error: true, ev: 'timeout' }), 'a timeout still counts');
});

await test('r3-05-2: a GraphQL 200 with errors is reported as one failing row; one without errors, or a REST 200, is not', async () => {
  const env = mkEnv();
  const answers = [
    JSON.stringify({ data: null, errors: [{ message: 'nope', token: 'T0P' }] }),
    JSON.stringify({ data: { ok: true } }),
  ];
  env.win.fetch = () => Promise.resolve(new Response(answers.shift(), { status: 200, headers: { 'content-type': 'application/json' } }));
  env.start();
  const body = JSON.stringify({ query: 'mutation Pay { pay }', operationName: 'Pay' });
  await env.win.fetch('/graphql', { method: 'POST', body });
  await env.win.fetch('/graphql', { method: 'POST', body });
  await new Promise((r) => setTimeout(r, 50));
  const rows = env.nets();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ev, 'gql');
  assert.equal(rows[0].text, 'GraphQL: 1 error');
  assert.equal(rows[0].error, false);
  assert.equal(rows[0].status, 200);
  assert.equal(rows[0].operation, 'Pay');
  assert.ok(rows[0].responsePreview.includes('nope') && !rows[0].responsePreview.includes('T0P'), 'the preview is redacted');
  assert.ok(isFailure(rows[0]) && !isFailure(rows[1]));
  assert.notEqual(liteFp(rows[0]), liteFp({ ...rows[0], operation: 'Other' }), 'two operations on one endpoint are two problems');
  const sanitised = sanitiseEvent(rows[0], { frameUrl: 'https://site.test/' });
  assert.equal(sanitised.ev, 'gql', 'the marker survives the ingest allow-list');
  assert.equal(sanitised.operation, 'Pay');
});

await test('r3-05-4: a resource that failed to load and a CSP violation are reported through report(); window-target errors are left to the bubbling listener', async () => {
  const env = mkEnv().start();
  env.fire('error', { target: { tagName: 'IMG', src: 'https://site.test/missing.png' } }, true);
  env.fire('error', { target: { tagName: 'SCRIPT', src: 'data:text/javascript,1' } }, true);
  env.fire('error', { target: env.win, message: 'boom', filename: 'https://site.test/a.js', lineno: 1, colno: 2 });
  const res = env.nets();
  assert.equal(res.length, 1, 'one resource row (a data: URL is not a request)');
  assert.deepEqual([res[0].via, res[0].error, res[0].ev, res[0].url], ['resource', true, 'error', '/missing.png']);
  assert.equal(env.kinds('pageerror').length, 1, 'the window error is the bubbling listener\'s, once');
  assert.ok(env.handlers.error.some((h) => h.cap) && env.handlers.error.some((h) => !h.cap), 'one capture and one bubbling listener');
  env.fire('securitypolicyviolation', { violatedDirective: 'script-src', blockedURI: 'https://evil.test/x.js?k=1', sourceFile: 'https://site.test/app.js' });
  const csp = env.kinds('console')[0];
  assert.equal(csp.level, 'warn'); // cap1022: a CSP block is a logged line, not an uncaught error
  assert.equal(csp.text, 'CSP: script-src blocked https://evil.test/x.js');
});

await test('r3-05-6 / D-1010-49: WebSocket, EventSource and sendBeacon failures are failure-only net rows with a URL and a code, never a payload', async () => {
  class Sock {
    constructor(url) { this.url = url; this.l = {}; this.readyState = 0; }
    addEventListener(t, f) { (this.l[t] ||= []).push(f); }
    fire(t, e = {}) { for (const f of this.l[t] || []) f(e); }
    send() {}
  }
  Sock.OPEN = 1;
  class ES extends Sock {}
  const navigator = { sendBeacon: (u) => u.includes('ok') };
  const env = mkEnv({ WebSocket: Sock, EventSource: ES, navigator }).start();
  const W = env.win.WebSocket;
  const ok = new W('wss://site.test/live');
  assert.ok(ok instanceof Sock && W.OPEN === 1, 'the wrapper keeps instanceof and statics');
  ok.fire('close', { code: 1000 });
  assert.equal(env.nets().length, 0, 'a normal close is not a failure');
  const bad = new W('wss://site.test/dead');
  bad.fire('error');
  bad.fire('close', { code: 1006 });
  const live = new W('wss://site.test/live2');
  live.fire('close', { code: 4001, reason: 'secret reason' });
  const sse = new env.win.EventSource('/stream');
  sse.readyState = 0;
  sse.fire('error'); // reconnecting: not a failure
  sse.readyState = 2;
  sse.fire('error');
  navigator.sendBeacon('/beacon-ok', 'payload-1');
  navigator.sendBeacon('/beacon-no', 'payload-2');
  const rows = env.nets();
  assert.deepEqual(rows.map((r) => r.via), ['ws', 'ws', 'sse', 'beacon'], JSON.stringify(rows.map((r) => [r.via, r.text])));
  assert.equal(rows[1].text, 'WebSocket closed: 4001');
  assert.ok(rows.every((r) => r.error === true && r.method === 'GET' && !('reqBody' in r)), 'no payload field');
  assert.ok(!JSON.stringify(rows).includes('payload') && !JSON.stringify(rows).includes('secret reason'));
});

await test('r4-11-3 / D-1010-69: a FormData body is recorded as parts (secret names redacted, 50 parts, 2,000 chars, files by name/type/size)', async () => {
  const env = mkEnv();
  env.win.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  env.start();
  const fd = new FormData();
  fd.append('title', 'a'.repeat(2500));
  fd.append('password', 'hunter2');
  fd.append('doc', new Blob(['12345'], { type: 'text/plain' }), 'notes.txt');
  await env.win.fetch('/api/upload', { method: 'POST', body: fd }).catch(() => {});
  const body = env.nets()[0].reqBody;
  assert.equal(body.kind, 'FormData');
  assert.equal(body.parts[0].value.length, 2000, 'a value is cut at 2,000 characters');
  assert.equal(body.truncated, true);
  assert.deepEqual(JSON.parse(JSON.stringify(body.parts[1])), { name: 'password', value: '«redacted»' });
  assert.deepEqual(JSON.parse(JSON.stringify(body.parts[2])), { name: 'doc', file: { name: 'notes.txt', type: 'text/plain', size: 5 } });
  assert.ok(!JSON.stringify(body).includes('hunter2') && !JSON.stringify(body).includes('12345'), 'a secret value or file bytes leaked');
  const many = new FormData();
  for (let i = 0; i < 60; i++) many.append(`f${i}`, 'v');
  const env2 = mkEnv();
  env2.win.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  env2.start();
  await env2.win.fetch('/api/upload', { method: 'POST', body: many }).catch(() => {});
  const b2 = env2.nets()[0].reqBody;
  assert.equal(b2.parts.length, 50);
  assert.equal(b2.truncated, true);
});

await test('D-1010-100 / r5-05-6: a URLSearchParams body takes the redacting form branch', async () => {
  const env = mkEnv();
  env.win.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  env.start();
  await env.win.fetch('/api/login', { method: 'POST', body: new URLSearchParams({ user: 'sam', password: 'hunter2' }) }).catch(() => {});
  const body = env.nets()[0].reqBody;
  assert.equal(body.kind, 'form');
  assert.ok(body.text.includes('user=sam'), body.text);
  assert.ok(!JSON.stringify(body).includes('hunter2'), 'the password leaked');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
