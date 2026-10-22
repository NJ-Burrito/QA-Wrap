/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-040: runs the real content/page-hooks.js in a vm with a fake window and
 * drives the fetch and XHR wrappers. Before the fix, `mock` and `graphqlError`
 * on fetch threw ReferenceError (`sent` was used before its declaration) and a
 * header rule rebuilt a `Request` as a bodyless GET.
 *
 *   node tools/test-wrappers.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'content', 'page-hooks.js'), 'utf8');

function boot(rules) {
  const posted = [];
  const listeners = [];
  const calls = [];
  class FakeXHR {
    open() {} setRequestHeader() {} send() { calls.push('xhr-native'); }
    dispatchEvent(e) { (this._ev ||= []).push(e.type); return true; }
  }
  const win = {
    addEventListener: (t, f) => t === 'message' && listeners.push(f),
    postMessage: (d) => posted.push(d),
    setTimeout, performance, Request, Response, Headers, XMLHttpRequest: FakeXHR,
    console: { ...console }, location: { href: 'https://app.test/', origin: 'https://app.test' },
    fetch: async (r, i) => { calls.push({ r, i }); return new Response('{}', { status: 200 }); },
  };
  win.window = win;
  const ctx = vm.createContext({ ...win, window: win, Event, URL, TextEncoder, JSON, Promise, Error });
  Object.assign(win, { Request, Response, Event });
  vm.runInContext(SRC, ctx);
  const fire = (data) => listeners.forEach((f) => f({ source: win, data }));
  fire({ source: 'uqa-awake', awake: true });
  fire({ source: 'uqa-rules', rules: rules.map((r) => ({ enabled: true, method: 'ANY', pattern: '', ...r })) });
  return { win, posted, calls };
}

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

await t('fetch mock answers with a Response and does not throw', async () => {
  const { win, posted } = boot([{ action: 'mock', pattern: '/api', status: 201, body: '{"a":1}' }]);
  const res = await win.fetch('/api/x');
  assert.equal(res.status, 201);
  assert.equal(await res.text(), '{"a":1}');
  assert.ok(posted.some((m) => m.event?.mocked));
});

await t('fetch graphqlError is HTTP 200 with an errors array', async () => {
  const { win } = boot([{ action: 'graphqlError', pattern: '/gql' }]);
  const res = await win.fetch('/gql', { method: 'POST', body: '{"query":"query Q{a}"}' });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).errors));
});

await t('a header rule keeps a Request POST and its body', async () => {
  const { win, calls } = boot([{ action: 'headers', pattern: '/api', headers: { 'x-qa': '1' } }]);
  await win.fetch(new Request('https://app.test/api/save', { method: 'POST', body: 'hello', headers: { a: 'b' } }));
  const sent = calls[0].r;
  assert.ok(sent instanceof Request);
  assert.equal(sent.method, 'POST');
  assert.equal(await sent.text(), 'hello');
  assert.equal(sent.headers.get('x-qa'), '1');
  assert.equal(sent.headers.get('a'), 'b');
});

await t('a redirect rule keeps the Request method and body', async () => {
  const { win, calls } = boot([{ action: 'redirect', pattern: '/api', redirectTo: '/v2' }]);
  await win.fetch(new Request('https://app.test/api', { method: 'PUT', body: 'z' }));
  assert.equal(calls[0].r.url, 'https://app.test/v2');
  assert.equal(calls[0].r.method, 'PUT');
  assert.equal(await calls[0].r.text(), 'z');
});

await t('string url with a header rule still works', async () => {
  const { win, calls } = boot([{ action: 'headers', pattern: '/api', headers: { 'x-qa': '1' } }]);
  await win.fetch('/api', { method: 'POST', body: 'q' });
  assert.equal(calls[0].i.method, 'POST');
  assert.equal(calls[0].i.headers['x-qa'], '1');
});

await t('XHR mock and graphqlError finish without throwing', async () => {
  for (const [action, status] of [['mock', 200], ['graphqlError', 200]]) {
    const { win } = boot([{ action, pattern: '/x' }]);
    const x = new win.XMLHttpRequest();
    x.open('POST', '/x'); x.send('{"query":"query Q{a}"}');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(x.status, status);
    assert.ok(x._ev.includes('load'));
  }
});

// Route events: recorded in the worker from webNavigation, with qualifiers.
const SW = workerSrc();
await t('worker records SPA route changes with qualifiers', () => {
  assert.match(SW, /transitionQualifiers/);
});

// Next-review T-040: run the real recordNav and its three registrations; a pushState, a hash change and a
// replaceState after a full load must appear as route events, in order, filed under the tab's own session.
await t('a recorded SPA session shows the route events in order', async () => {
  const from = SW.indexOf('async function recordNav(details, route)');
  const end = SW.indexOf("'webNavigation.onReferenceFragmentUpdated'", from);
  const src = SW.slice(from, SW.indexOf('\n', end));
  const events = []; const handlers = {}; const hints = [];
  const env = {
    forgetInvoked: async () => {}, armed: { isArmedTab: async () => true }, isInternalUrl: () => false, belongsToSession: async (sid) => sid === 'B',
    activeSessionId: async (h) => { hints.push(h); return h?.tabId === 22 ? 'B' : 'A'; }, appendEvent: async (e) => { events.push(e); }, paintBadge: () => {},
    on: (ev, name, fn) => { handlers[ev] = fn; },
    chrome: { webNavigation: { onCommitted: 'C', onHistoryStateUpdated: 'H', onReferenceFragmentUpdated: 'R' } },
  };
  new Function('env', `const { forgetInvoked, armed, isInternalUrl, belongsToSession, activeSessionId, appendEvent, paintBadge, on, chrome } = env; ${src}`)(env);
  const d = (url, extra = {}) => ({ tabId: 22, frameId: 0, url, ...extra });
  await handlers.C(d('https://app.test/', { transitionType: 'typed' }));
  await handlers.H(d('https://app.test/cart', { transitionType: 'link', transitionQualifiers: ['client_redirect'] }));
  await handlers.R(d('https://app.test/cart#pay'));
  await handlers.H(d('https://app.test/done'));
  await handlers.H({ ...d('https://app.test/frame'), frameId: 3 });
  assert.deepEqual(events.map((e) => e.url), ['https://app.test/', 'https://app.test/cart', 'https://app.test/cart#pay', 'https://app.test/done']);
  assert.deepEqual(events.map((e) => !!e.route), [false, true, true, true], 'a full load is not a route; the three SPA kinds are');
  assert.deepEqual(events[1].qualifiers, ['client_redirect']);
  assert.ok(events.every((e) => e.sessionId === 'B' && e.kind === 'nav'), "filed under the tab's own window session");
  assert.ok(hints.every((h) => h?.tabId === 22), 'the lookup carries the tab');
});

// Harvest 1004: closing the browser rejects storage.session.set with "The browser is shutting down."; that
// one is dropped silently, any other failure still reaches on() and is logged.
await t('forgetInvoked drops the shutdown rejection and rethrows any other', async () => {
  const from = SW.indexOf('async function forgetInvoked(tabId)');
  const src = SW.slice(from, SW.indexOf('\n}\n', from) + 3);
  const make = (msg) => {
    const chrome = { storage: { session: { set: async () => { throw new Error(msg); } } } };
    return new Function('env', `const { chrome, grantedTabs, GRANTED } = env; ${src}; return forgetInvoked;`)(
      { chrome, grantedTabs: async () => new Set([7]), GRANTED: 'g' });
  };
  await make('The browser is shutting down.')(7);
  await assert.rejects(make('quota exceeded')(7), /quota exceeded/);
});

console.log(`${n} passed`);
