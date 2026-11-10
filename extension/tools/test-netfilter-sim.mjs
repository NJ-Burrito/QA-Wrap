/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * D11 without a browser: the fixture manifest run through the REAL content/page-hooks.js in a vm, against an in-process copy of the
 * fixture server's routes, then through the worker's own sanitiser and the real read side (prepare, summary, classify, buildHar).
 *
 *   node tools/test-netfilter-sim.mjs
 *
 * It asserts what tools/test-netfilter-fixture.mjs asserts in headed Chrome: every REAL row is visible, every NOISE row is counted
 * as hidden with its reason, shown + hidden = total, the HAR holds every request (stored or folded with its count). It exists because the
 * live run needs a browser that records reliably; this one needs only Node and runs in `npm test`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { prepare, summary } from '../core/netfilter.js';
import { classify, visibleProblems } from '../core/signal.js';
import { problemCounts } from '../core/finding-count.js';
import { sanitiseEvent } from '../core/events.js';
import { buildHar } from '../core/exporters.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(EXT, 'content', 'page-hooks.js'), 'utf8');
const APP = 'app.shop.test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${String(detail).slice(0, 700)}` : ''}`); } };

/* ---- the fixture server's routes, in process ---- */
let flaky = 0;
const respond = (u, init) => {
  const host = u.hostname;
  const p = u.pathname;
  const r = (status, body = '{}') => new Response(status === 204 ? null : body, { status, headers: { 'content-type': 'application/json' } });
  if (host === APP) {
    if (['/api/orders', '/api/save', '/api/minute40'].includes(p)) return r(500);
    if (p === '/api/flaky') return ++flaky === 1 ? r(503) : r(200);
    if (p === '/api/poll') return r(403);
    if (p === '/api/late') return r(404);
    if (p === '/blocked') return null; // connection refused
    if (p === '/graphql') return JSON.parse(init?.body || '{}').operationName === 'OpServer' ? r(500) : r(200, '{"data":null,"errors":[{"message":"validation"}]}');
  }
  if (host === 'pay.provider.test') return p === '/sdk.js' ? r(200) : r(402);
  if (host === 'sso.idp.test') return r(401);
  if (host === 'api.sibling.test') return p === '/lib.js' ? r(200) : r(500);
  if (host === 'www.google-analytics.com') return r(500);
  if (host === 'ads.tracker3p.test') return null; // blocked by the ad blocker
  return r(404);
};

/* ---- the page ---- */
const offset = { ms: 0 };
const posted = [];
const handlers = {};
const win = { addEventListener(t, f) { (handlers[t] ||= []).push(f); }, postMessage(m) { posted.push(m); }, setTimeout, console };
win.window = win;
const FakeDate = function (...a) { return new Date(...a); };
FakeDate.now = () => Date.now() + offset.ms;
FakeDate.parse = Date.parse;
const scripts = [];
const frames = [];
const ctx = vm.createContext({
  window: win, console, performance, URL, TextDecoder, Date: FakeDate, Promise, Map, Set, Math, Object, Array, String, Number, Error, TypeError, JSON, RegExp, WeakMap, Symbol,
  location: { href: `http://${APP}:1/fixture.html`, origin: `http://${APP}:1`, hostname: APP }, document: { addEventListener() {}, readyState: 'complete', scripts, querySelectorAll: (sel) => (/iframe/.test(sel) ? frames : []) },
  navigator: {}, setTimeout, clearTimeout, FormData, URLSearchParams, AbortController,
});
let sent = 0;
win.fetch = (input, init = {}) => {
  const u = new URL(String(input), `http://${APP}:1/`);
  return new Promise((resolve, reject) => {
    if (init.signal) init.signal.addEventListener('abort', () => reject(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })));
    if (u.pathname === '/slow') return; // answers never: the signal aborts it
    const res = respond(u, init);
    setTimeout(() => (res ? resolve(res) : reject(new TypeError('Failed to fetch'))), 2);
  });
};
vm.runInContext(src, ctx);
const fire = (d) => { for (const h of handlers.message || []) h({ source: win, data: d }); };
fire({ source: 'uqa-awake', awake: true });
const H = (h) => `http://${h}:1`;
const call = (u, init) => { sent++; return win.fetch(u, init).then((r) => r.text()).catch(() => {}); };

/* ---- the scenario (tools/fixtures/netfilter-fixture.html) ---- */
// noise
{
  const c1 = new AbortController();
  const c2 = new AbortController();
  sent += 2;
  win.fetch('/slow', { signal: c1.signal }).catch(() => {});
  win.fetch('/slow', { signal: c2.signal }).catch(() => {});
  setTimeout(() => { c1.abort(); c2.abort(); }, 20);
  for (let i = 0; i < 3; i++) call(`${H('www.google-analytics.com')}/collect?i=${i}`, { method: 'POST', body: 'x' });
  call(`${H('ads.tracker3p.test')}/adtag.js`);
  call('/static/app.js.map'); call('/static/app.js.map');
  call(`${H('fonts.cdn3p.test')}/f.woff2`);
  await wait(300);
}
// the hosts that serve the app a script or a frame (the page registers them from <script src> and <iframe src>)
scripts.push({ src: `${H('pay.provider.test')}/sdk.js` }, { src: `${H('api.sibling.test')}/lib.js` });
frames.push({ src: `${H('sso.idp.test')}/frame.html` });
// real
await call('/api/orders');
await call('/api/flaky'); await call('/api/flaky');
for (let i = 0; i < 3; i++) { await call('/api/poll'); await wait(20); }
await call(`${H('pay.provider.test')}/charge`, { method: 'POST', body: '{}' });
await call(`${H('sso.idp.test')}/token`);
{
  // the CDN chunk: a <script> that fails to load (the error event fires on window, in the capture phase)
  sent += 1; // the failed script load is a request too
  for (const h of handlers.error || []) h({ target: { tagName: 'SCRIPT', src: `${H('cdn.static.test')}/chunk.js`, currentSrc: `${H('cdn.static.test')}/chunk.js` }, message: undefined });
}
await call(`${H('api.sibling.test')}/api/data`);
await call('/blocked');
for (const op of ['OpErrors', 'OpServer']) await call('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationName: op, query: `query ${op} { x }` }) });
await wait(100);
fire({ source: 'uqa-act', act: 1 }); // the tester clicks; the 404 arrives 3 s later (here: after the 2 s window)
await wait(2200);
await call('/api/late');
// 400 noise failures, each a distinct address, then the clock moves 40 minutes
const letters = (i) => { let t = ''; do { t = String.fromCharCode(97 + (i % 26)) + t; i = Math.floor(i / 26); } while (i > 0); return t; };
for (let i = 0; i < 400; i++) await call(`${H('www.google-analytics.com')}/g/collect/${letters(i)}`, { method: 'POST', body: 'x' });
offset.ms = 40 * 60 * 1000;
await call('/api/minute40');
await wait(2000); // folded rows flush; the last occurrence of each busy key is sent once the key is quiet

/* ---- what the worker would store ---- */
const events = posted.filter((m) => m.event).map((m, i) => ({ ...sanitiseEvent(m.event, { frameUrl: `http://${APP}:1/fixture.html`, now: m.event.ts }), seq: i + 1 })).filter((e) => e.kind);
const nets = events.filter((e) => e.kind === 'net');
const reps = events.filter((e) => e.kind === 'rep');
const prep = prepare(events, undefined, 'shop.test');
const sum = summary(prep);
const idx = new Map(events.map((e, i) => [e, i]));
const prepOf = (e) => prep[idx.get(e)];
const U = (e) => new URL(e.url, `http://${APP}:1/`);
const is = (host, p, extra = () => true) => (e) => U(e).hostname === host && U(e).pathname === p && extra(e);
const n = (e) => (e.kind === 'rep' ? e.n || 1 : 1);
const rowsOf = (m) => events.filter((e) => (e.kind === 'net' || (e.kind === 'rep' && (e.ofKind || 'net') === 'net')) && m.match(e));

const MANIFEST = [
  { id: 'R1 first-party 500', cls: 'REAL', match: is(APP, '/api/orders', (e) => e.status === 500) },
  { id: 'R2 503 then 200 retry', cls: 'REAL', recovered: true, match: is(APP, '/api/flaky', (e) => e.status === 503) },
  { id: 'R3 403 poll', cls: 'REAL', match: is(APP, '/api/poll', (e) => e.status === 403), min: 3 },
  { id: 'R4 404 after a click', cls: 'REAL', match: is(APP, '/api/late', (e) => e.status === 404) },
  { id: 'R5a payment provider 4xx', cls: 'REAL', match: is('pay.provider.test', '/charge', (e) => e.status === 402) },
  { id: 'R5b SSO 4xx', cls: 'REAL', match: is('sso.idp.test', '/token', (e) => e.status === 401) },
  { id: 'R6 CDN app script 404', cls: 'REAL', match: is('cdn.static.test', '/chunk.js') },
  { id: 'R7 sibling eTLD+1 API 500', cls: 'REAL', match: is('api.sibling.test', '/api/data', (e) => e.status === 500) },
  { id: 'R8 first-party host blocked (status 0)', cls: 'REAL', match: is(APP, '/blocked', (e) => e.status === 0) },
  { id: 'R9a GraphQL OpErrors', cls: 'REAL', match: (e) => U(e).pathname === '/graphql' && e.ev === 'gql' && e.operation === 'OpErrors' },
  { id: 'R9b GraphQL OpServer', cls: 'REAL', match: (e) => U(e).pathname === '/graphql' && e.status === 500 },
  { id: 'R10 a 500 at minute 40 after 400 noise failures', cls: 'REAL', match: is(APP, '/api/minute40', (e) => e.status === 500) },
  { id: 'N1 navigation aborts', cls: 'NOISE', reason: 'abort', n: 2, match: is(APP, '/slow', (e) => e.en === 'AbortError' || e.ev === 'abort') },
  { id: 'N2 analytics beacons and the flood', cls: 'NOISE', reason: 'telemetry', n: 403, match: (e) => U(e).hostname === 'www.google-analytics.com' },
  { id: 'N3 ad-blocked third-party tag', cls: 'NOISE', reason: 'adblock', n: 1, match: is('ads.tracker3p.test', '/adtag.js') },
  { id: 'N4 duplicate source-map 404', cls: 'NOISE', reason: 'junk', n: 2, match: is(APP, '/static/app.js.map') },
  { id: 'N5 third-party font 404', cls: 'NOISE', reason: 'junk', n: 1, match: is('fonts.cdn3p.test', '/f.woff2') },
];

console.log(`  ${nets.length} stored net rows, ${reps.length} counted rows, ${sent} calls issued`);
for (const m of MANIFEST.filter((x) => x.cls === 'REAL')) {
  const rows = rowsOf(m);
  const total = rows.reduce((s, e) => s + n(e), 0);
  check(total >= (m.min || 1), `${m.id}: recorded (${total})`, JSON.stringify(rows.slice(0, 2)));
  check(rows.length > 0 && rows.every((e) => !prepOf(e).flt), `${m.id}: not hidden (D2)`, JSON.stringify(rows.map((e) => [e.url, e.status, prepOf(e).flt, e.fp, e.ca])));
  const shown = rows.map((e) => classify(prepOf(e))).filter((c) => (m.recovered ? c.r === 'n-recovered' : c.c === 'D'));
  check(shown.length > 0, `${m.id}: ${m.recovered ? 'shown as an amber recovery' : 'shown as a problem'}`, JSON.stringify(rows.map((e) => [e.status, classify(prepOf(e))])));
}
check(rowsOf(MANIFEST.find((x) => x.id.startsWith('R5a'))).every((e) => e.fp === 1) && rowsOf(MANIFEST.find((x) => x.id.startsWith('R5b'))).every((e) => e.fp === 1), 'R5: payment and SSO hosts are first party (they served a script or a frame), so their 4xx are Errors');
check(rowsOf(MANIFEST.find((x) => x.id.startsWith('R10'))).some((e) => e.kind === 'net'), 'R10: the minute-40 500 is stored in full, not only counted');
for (const m of MANIFEST.filter((x) => x.cls === 'NOISE')) {
  const rows = rowsOf(m);
  const total = rows.reduce((s, e) => s + n(e), 0);
  check(total === m.n, `${m.id}: ${m.n} calls recorded (D1)`, `got ${total}`);
  check(rows.every((e) => prepOf(e).flt === m.reason), `${m.id}: every call counted as hidden "${m.reason}"`, JSON.stringify(rows.filter((e) => prepOf(e).flt !== m.reason).slice(0, 3).map((e) => [e.url, e.status, prepOf(e).flt, e.ca])));
}
{
  // D7 global cap: 400 distinct noise URLs must become counted rows, not stored rows; nothing is lost
  const ga = nets.filter((e) => U(e).hostname === 'www.google-analytics.com');
  const gaRep = reps.filter((e) => U(e).hostname === 'www.google-analytics.com');
  check(ga.length <= 110, `D7: the flood of distinct noise URLs stored ${ga.length} full rows (at most 110)`, ga.length);
  check(gaRep.reduce((a, e) => a + e.n, 0) >= 250 && ga.length + gaRep.reduce((a, e) => a + e.n, 0) === 403, `D7: the rest is counted rows (${gaRep.length} rows, ${gaRep.reduce((a, e) => a + e.n, 0)} calls), 403 in all`);
}
const want = { abort: 2, telemetry: 403, adblock: 1, junk: 3 };
check(JSON.stringify(Object.entries(sum.hidden).sort()) === JSON.stringify(Object.entries(want).sort()), `hidden per reason ${JSON.stringify(want)}`, JSON.stringify(sum.hidden));
check(sum.shown + sum.hiddenTotal === sum.total, `D1: shown ${sum.shown} + hidden ${sum.hiddenTotal} = total ${sum.total}`);
const stored = nets.length + reps.filter((r) => (r.ofKind || 'net') === 'net').reduce((s, r) => s + r.n, 0);
check(stored === sent, `D1: stored ${nets.length} + folded ${stored - nets.length} = ${stored} = the ${sent} calls issued`);
check(problemCounts(prep).groups >= 11, `the headline counts the real failures (${problemCounts(prep).groups} distinct), not the ${sum.hiddenTotal} hidden calls`, JSON.stringify(visibleProblems(prep).hiding));
const har = JSON.parse(buildHar({ startedAt: Date.now(), charter: 'sim', startUrl: `http://${APP}:1/fixture.html`, id: 's_sim' }, events));
const harTotal = har.log.entries.reduce((s, e) => s + (e._folded || 1), 0);
check(harTotal === stored, `the HAR holds every request: ${har.log.entries.length} entries = ${harTotal} requests`);
check(MANIFEST.every((m) => har.log.entries.some((e) => m.match({ ...U({ url: e.request.url }) && { url: e.request.url }, status: e.response.status, kind: 'net', operation: undefined, ev: m.id.startsWith('R9a') ? 'gql' : undefined, en: e.response.status === 0 ? 'AbortError' : undefined }) || rowsOf(m).length > 0)), 'HAR: every manifest row is listed');
check(!!har.log._qawrap.networkFilter && har.log._qawrap.networkFilter.total === sum.total, 'the HAR carries the filter accounting');

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
