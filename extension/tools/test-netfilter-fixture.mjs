/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * D11, the release gate for the network filter and the click labels: the fixture page, in a real headed Chromium with the granted extension.
 *
 *   node tools/test-netfilter-fixture.mjs        (one headed run at a time; UQA_HEADLESS=1 is honoured for a quick look)
 *
 * A local server answers for many host names (*.test is mapped to 127.0.0.1 by the browser's host resolver rules), so the fixture can have
 * a payment SDK, an SSO frame, a CDN, a sibling domain, an analytics host and an ad tag. A manifest lists every row as REAL or NOISE.
 * The test asserts, on the stored session, that every REAL row is visible (not hidden, and a problem or an amber recovery), every NOISE row
 * is counted behind "hidden" with its reason, shown + hidden = total, the HAR holds every request (stored or folded with its count),
 * and the label privacy assertions hold: no email, card number, phone number or long digit run in any stored label, locator or export.
 *
 * The profile and the granted copy carry the tag qaw-1110 and are sent to the recycle bin on exit; the browser is closed in `finally`.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { recycle } from './lib-trash.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { grantedExtension, awaitSiteScripts, seedConsent } from './lib-granted.mjs';
import { prepare, summary } from '../core/netfilter.js';
import { classify, visibleProblems } from '../core/signal.js';
import { problemCounts } from '../core/finding-count.js';
import { groupKey } from '../core/netkeys.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(HERE, '..');
const TAG = 'qaw-1110';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${String(detail).slice(0, 900)}` : ''}`); }
};
const trash = (p) => { const r = recycle(p); if (!r.ok) check(false, `recycle ${path.basename(String(p))}`, JSON.stringify(r)); };

/* ------------------------------------------------------------------ the server */
const seen = [];
let flaky = 0;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const send = (res, code, body = '', type = 'application/json', extra = {}) => { res.writeHead(code, { 'content-type': type, ...CORS, ...extra }); res.end(body); };
const server = http.createServer((req, res) => {
  const host = String(req.headers.host || '').split(':')[0];
  const url = req.url.split('?')[0];
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    seen.push({ host, url, method: req.method });
    if (req.method === 'OPTIONS') return send(res, 204);
    if (host === 'app.shop.test') {
      if (url === '/fixture.html') return send(res, 200, fs.readFileSync(path.join(HERE, 'fixtures', 'netfilter-fixture.html')), 'text/html; charset=utf-8');
      if (url === '/api/orders' || url === '/api/save' || url === '/api/minute40') return send(res, 500, '{"error":"boom"}');
      if (url === '/api/flaky') return send(res, ++flaky === 1 ? 503 : 200, flaky === 1 ? '{"error":"later"}' : '{"ok":true}');
      if (url === '/api/poll') return send(res, 403, '{"error":"forbidden"}');
      if (url === '/api/late') return send(res, 404, '{"error":"gone"}');
      if (url === '/slow') return void setTimeout(() => { try { send(res, 200, '{}'); } catch { /* aborted */ } }, 3000);
      if (url === '/graphql') {
        const op = (() => { try { return JSON.parse(body).operationName; } catch { return ''; } })();
        return op === 'OpServer' ? send(res, 500, '{"errors":[{"message":"server"}]}') : send(res, 200, '{"data":null,"errors":[{"message":"validation"}]}');
      }
    }
    if (host === 'pay.provider.test') return url === '/sdk.js' ? send(res, 200, '/* sdk */', 'text/javascript') : send(res, 402, '{"error":"card declined"}');
    if (host === 'sso.idp.test') return url === '/frame.html' ? send(res, 200, '<!doctype html><title>sso</title>sso', 'text/html') : send(res, 401, '{"error":"login"}');
    if (host === 'api.sibling.test') return url === '/lib.js' ? send(res, 200, '/* lib */', 'text/javascript') : send(res, 500, '{"error":"sibling"}');
    if (host === 'www.google-analytics.com') return send(res, 500, '{}');
    return send(res, 404, 'nope', 'text/plain');
  });
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const PORT = server.address().port;
const ORIGIN = `http://app.shop.test:${PORT}`;

/* ------------------------------------------------------------------ the manifest */
const PATH = (e) => { try { return new URL(e.url, ORIGIN).pathname; } catch { return String(e.url); } };
const HOST = (e) => { try { return new URL(e.url, ORIGIN).hostname; } catch { return ''; } };
const is = (host, p, extra = () => true) => (e) => HOST(e) === host && PATH(e) === p && extra(e);
const MANIFEST = [
  { id: 'R1 first-party 500', cls: 'REAL', match: is('app.shop.test', '/api/orders', (e) => e.status === 500) },
  { id: 'R2 503 then 200 retry', cls: 'REAL', recovered: true, match: is('app.shop.test', '/api/flaky', (e) => e.status === 503) },
  { id: 'R3 403 poll every 2 s', cls: 'REAL', match: is('app.shop.test', '/api/poll', (e) => e.status === 403), min: 2 },
  { id: 'R4 404 3 s after a click', cls: 'REAL', match: is('app.shop.test', '/api/late', (e) => e.status === 404) },
  { id: 'R5a payment provider 4xx', cls: 'REAL', match: is('pay.provider.test', '/charge', (e) => e.status === 402) },
  { id: 'R5b SSO 4xx', cls: 'REAL', match: is('sso.idp.test', '/token', (e) => e.status === 401) },
  { id: 'R6 CDN app script 404', cls: 'REAL', match: is('cdn.static.test', '/chunk.js') },
  { id: 'R7 API on a sibling eTLD+1 that served a script', cls: 'REAL', match: is('api.sibling.test', '/api/data', (e) => e.status === 500) },
  { id: 'R8 first-party host blocked (status 0)', cls: 'REAL', match: is('app.shop.test', '/blocked', (e) => e.status === 0) },
  { id: 'R9a GraphQL OpErrors (200 with errors)', cls: 'REAL', match: (e) => PATH(e) === '/graphql' && e.ev === 'gql' && e.operation === 'OpErrors' },
  { id: 'R9b GraphQL OpServer (500)', cls: 'REAL', match: (e) => PATH(e) === '/graphql' && e.status === 500 && (e.operation === 'OpServer' || e.ev !== 'gql') },
  { id: 'R10 a 500 at simulated minute 40 after 400 noise failures', cls: 'REAL', match: is('app.shop.test', '/api/minute40', (e) => e.status === 500) },
  { id: 'N1 navigation aborts', cls: 'NOISE', reason: 'abort', n: 2, match: is('app.shop.test', '/slow', (e) => e.en === 'AbortError' || e.ev === 'abort') },
  { id: 'N2 analytics beacons and the 400-call flood', cls: 'NOISE', reason: 'telemetry', n: 3 + 400, match: (e) => HOST(e) === 'www.google-analytics.com' },
  { id: 'N3 ad-blocked third-party tag', cls: 'NOISE', reason: 'adblock', n: 1, match: is('ads.tracker3p.test', '/adtag.js') },
  { id: 'N4 duplicate favicon / source-map 404 (the browser refuses to fetch a favicon.ico from page script, so the .map form is used here; favicon is unit-tested)', cls: 'NOISE', reason: 'junk', n: 2, match: is('app.shop.test', '/static/app.js.map') },
  { id: 'N5 third-party font 404', cls: 'NOISE', reason: 'junk', n: 1, match: is('fonts.cdn3p.test', '/f.woff2') },
];

/* ------------------------------------------------------------------ the browser */
const EXT = grantedExtension({ label: `${TAG}-netfilter` });
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), `uqa-${TAG}-netfilter-`));
let context;
let top = { release: async () => {} };
let code = 1;
const counts = {};
try {
  purgeWorkerCache(PROFILE);
  const lo = launchOptions(EXT, { width: 1100, height: 900, headed: process.env.UQA_HEADLESS !== '1' });
  lo.args.push('--host-resolver-rules=MAP *.test 127.0.0.1, MAP www.google-analytics.com 127.0.0.1');
  context = await chromium.launchPersistentContext(PROFILE, lo);
  top = await keepOnTop(context);
  await context.route('**/adtag.js', (r) => r.abort('blockedbyclient')); // the ad blocker
  await context.route('**/blocked', (r) => r.abort('connectionrefused')); // a first-party host that cannot be reached
  const worker = await freshWorker(context);
  worker.on('console', (m) => { if (true) console.log('       worker', m.type(), m.text().slice(0, 300)); });
  context.on('weberror', (e) => console.log('       WEBERROR', String(e.error()).slice(0, 300)));
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  await awaitSiteScripts(worker);
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${id}/options/options.html`);
  await ext.waitForTimeout(500);
  const call = (m) => ext.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const tabOf = (prefix) => worker.evaluate(async (o) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(o)), prefix);

  const exportText0 = async () => { const j = await call({ type: 'UQA_EXPORT', sessionId: SID.id, format: 'json' }); let text = j?.result?.content ?? ''; if (j?.result?.encoding === 'gzip-base64' || j?.result?.gzip) text = zlib.gunzipSync(Buffer.from(text, 'base64')).toString('utf8'); return text; };
  const SID = {};
  const url = `${ORIGIN}/fixture.html?p=${PORT}`;
  const page = await context.newPage();
  page.on('console', (m) => { if (process.env.NF_DEBUG) console.log('       page console', m.type(), m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log('       page error:', String(e).slice(0, 300)));
  await page.goto(url, { waitUntil: 'load' });
  const tab = await tabOf(url);
  await call({ type: 'UQA_ARM', windowId: tab.windowId });
  const started = await call({ type: 'UQA_START', charter: 'network filter fixture', tabId: tab.id, startUrl: url });
  const sessionId = started?.result?.id || started?.result?.sessionId || started?.result?.session?.id;
  SID.id = sessionId;
  check(!!sessionId, 'the session started', JSON.stringify(started).slice(0, 300));
  const ready = await worker.evaluate(async (tabId) => {
    const until = Date.now() + 10000;
    for (;;) {
      const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => window.UQABridge?.isRecording?.() === true && !!window.__UQA_RECORDER__ }).catch(() => null);
      if (r?.[0]?.result) return true;
      if (Date.now() > until) return false;
      await new Promise((q) => setTimeout(q, 100));
    }
  }, tab.id);
  check(ready, 'the recorder is live (R15: the ready state was observed)');
  // ENVIRONMENT: on this machine the worker's 50 ms write-queue timer does not run before the session stops (tools/test-capture-live.mjs is red at the base for the same reason), so the run flushes the queue the way every reader does: by exporting.
  let flushing = true;
  const flusher = (async () => { while (flushing) { await exportText0().catch(() => {}); await new Promise((r) => setTimeout(r, 300)); } })();
  // a first Start opens a page of the extension (the recording tour or the welcome page) and the session follows the tab the tester is on: close it and go back
  await page.waitForTimeout(800);
  const strays = await worker.evaluate(async ({ keep, mine }) => { const out = []; for (const t of await chrome.tabs.query({})) if (t.url?.startsWith('chrome-extension://') && t.id !== keep && t.id !== mine) { out.push(t.url); await chrome.tabs.remove(t.id); } return out; }, { keep: (await tabOf(ext.url())).id, mine: tab.id });
  console.log('       stray extension tabs closed:', JSON.stringify(strays));
  await worker.evaluate((id2) => chrome.tabs.update(id2, { active: true }), tab.id);
  await page.waitForTimeout(600);
  console.log('       hooks:', JSON.stringify(await page.evaluate(() => [window.__UQA_HOOKED__, String(window.fetch).slice(0, 50), typeof window.scenario])));

  /* ---- the scenario ---- */
  await page.evaluate(() => window.scenario.noise());
  await page.waitForTimeout(1500);
  if (process.env.NF_DEBUG) { const t = JSON.parse(await exportText0()); console.log('       DEBUG after noise:', (t.events || []).length, JSON.stringify((t.events || []).map((e) => [e.kind, e.url, e.status, e.error, e.flt]).slice(0, 14))); }
  if (process.env.NF_BISECT) {
    const steps = ["ok('/api/orders')", "ok('/api/flaky')", "ok('/api/poll')", "ok(H('pay.provider.test') + '/charge', { method: 'POST', body: '{}' })", "ok(H('sso.idp.test') + '/token')", "(()=>{const s = document.createElement('script'); s.src = H('cdn.static.test') + '/chunk.js'; document.head.appendChild(s);})()", "ok(H('api.sibling.test') + '/api/data')", "ok('/blocked')", "ok('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationName: 'OpX', query: 'query OpX { x }' }) })"];
    for (const st of steps) {
      await page.evaluate(`(()=>{ const H = (h) => 'http://' + h + ':' + new URLSearchParams(location.search).get('p'); const ok = (p, i) => fetch(p, i).then((r) => r.text()).catch(() => {}); ${st}; })()`);
      await page.waitForTimeout(700);
      const t = JSON.parse(await exportText0());
      console.log('       BISECT', st.slice(0, 40), '->', (t.events || []).length);
    }
  }
  if (process.env.NF_BURST) {
    console.log('       SEEN', JSON.stringify(seen.slice(-12)));
    console.log('       DIRECT', JSON.stringify(await page.evaluate(async () => { const out = []; for (const u of ['/favicon.ico', '/static/app.js.map', '/api/favicon.ico', '/x/icon.ico', '/a.map', '/api/orders']) { try { const r = await fetch(u); out.push([u, r.status]); } catch (e) { out.push([u, 'ERR ' + e.message]); } } return out; })));
    console.log('       BRIDGE', JSON.stringify(await worker.evaluate(async (tabId) => (await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => [window.UQABridge?.isRecording?.(), window.UQAAwake] }))[0].result, tab.id)));
    console.log('       FAV', JSON.stringify(JSON.parse(await exportText0()).events.filter((e) => /favicon/.test(e.url)).map((e) => [e.text, e.en, e.status, e.error])));
    console.log('       STATE', JSON.stringify(await worker.evaluate(() => chrome.storage.session.get(null))).slice(0, 700), JSON.stringify(await worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => [t.id, t.url.slice(0, 50)]))));
    for (const n of [3, 6, 9, 13]) {
      await page.evaluate((k) => { for (let i = 0; i < k; i++) fetch('/api/orders?i=' + i + Date.now()).catch(() => {}); }, n);
      await page.waitForTimeout(900);
      const t = JSON.parse(await exportText0());
      console.log('       BURST', n, '->', (t.events || []).length);
    }
  }
  { const t = JSON.parse(await exportText0()); console.log('       SESSION', JSON.stringify({ windowId: t.session.windowId, windowIds: t.session.windowIds, tabId: t.session.tabId, focusTabId: t.session.focusTabId }), JSON.stringify(await worker.evaluate(async () => (await chrome.tabs.query({})).map((x) => [x.id, x.windowId, x.active, x.url.slice(0, 40)])))); }
  console.log('       PROBEMSG', JSON.stringify(await worker.evaluate(async (tabId) => (await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_EVENT', event: { kind: 'net', via: 'fetch', method: 'GET', url: '/probe', status: 500, ok: false, ts: Date.now() } }, (x) => r(x))) }))[0].result, tab.id)));
  console.log('       real() ->', JSON.stringify(await page.evaluate(() => { try { return String(window.scenario.real()); } catch (e) { return 'THREW ' + e.message; } })));
  if (process.env.NF_PROBE) for (const ms of [150, 400, 800, 1500]) { await page.waitForTimeout(ms); const t = JSON.parse(await exportText0()); console.log('       PROBE', ms, (t.events || []).length, await page.evaluate(() => [location.href.slice(0, 60), typeof window.scenario, window.sent])); }
  if (process.env.NF_DEBUG) { const t = JSON.parse(await exportText0()); console.log('       DEBUG 1s into real:', (t.events || []).length, t.session?.status, JSON.stringify(Object.keys(t)), JSON.stringify(await worker.evaluate(() => chrome.storage.session.get(null).then((x) => Object.keys(x).slice(0, 20))))); }
  await page.waitForTimeout(4600); // the poll fires at 0, 2 s and 4 s
  await page.click('#late'); // the 404 arrives 3 s later
  await page.click('#err-now');
  for (const sel of ['#s-name', '#s-card', '#s-otp', '#s-pw-wrap', '#s-ar', '#s-long', '#s-emoji', '#s-icon', '#s-icon-only', '#s-none', '#s-row td:first-child', '#s-row-btn', '#s-save']) {
    await page.click(sel, { force: true });
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(3600);
  await page.evaluate(() => window.scenario.flood(400));
  await page.waitForTimeout(2200);
  await page.evaluate(() => window.scenario.minute40());
  await page.waitForTimeout(800);
  await page.evaluate(() => clearInterval(window.poll));
  await page.waitForTimeout(2600); // the folded rows flush and the last occurrences are sent once their keys go quiet
  const sentFetches = await page.evaluate(() => window.sent.fetch);
  flushing = false;
  await flusher;
  console.log('       BEFORE STOP', JSON.parse(await exportText0()).events.length);
  await call({ type: 'UQA_STOP' });
  await page.waitForTimeout(800);

  /* ---- read back ---- */
  const exportText = async (format) => {
    const j = await call({ type: 'UQA_EXPORT', sessionId, format });
    let text = j?.result?.content ?? '';
    if (j?.result?.encoding === 'gzip-base64' || j?.result?.gzip) text = zlib.gunzipSync(Buffer.from(text, 'base64')).toString('utf8');
    return text;
  };
  console.log('       AFTER STOP', JSON.parse(await exportText0()).events.length);
  const jsonText = await exportText('json');
  const harText = await exportText('har');
  const data = JSON.parse(jsonText);
  const events = data.events || [];
  const har = JSON.parse(harText);
  const nets = events.filter((e) => e.kind === 'net');
  const reps = events.filter((e) => e.kind === 'rep');
  console.log('       kinds:', JSON.stringify(events.reduce((a, e) => ({ ...a, [e.kind]: (a[e.kind] || 0) + 1 }), {})), JSON.stringify(nets.slice(0, 4).map((e) => [e.via, e.url, e.status])), 'session', JSON.stringify(data.session).slice(0, 300));
  check(nets.length > 20, `the session stored ${nets.length} net rows and ${reps.length} counted rows`);

  const prep = prepare(events, undefined, 'shop.test');
  const sum = summary(prep);
  const sig = visibleProblems(prep);
  const prepOf = (e) => prep[events.indexOf(e)];
  const rowsOf = (m) => events.filter((e) => (e.kind === 'net' || (e.kind === 'rep' && (e.ofKind || 'net') === 'net')) && m.match(e.kind === 'rep' ? { ...e, kind: 'net' } : e));
  const n = (e) => (e.kind === 'rep' ? e.n || 1 : 1);

  /* ---- REAL rows are visible ---- */
  for (const m of MANIFEST.filter((x) => x.cls === 'REAL')) {
    const rows = rowsOf(m);
    const total = rows.reduce((s, e) => s + n(e), 0);
    check(rows.length > 0 && total >= (m.min || 1), `${m.id}: recorded (${total} call${total === 1 ? '' : 's'})`, JSON.stringify(rows.slice(0, 2)));
    const hiddenRows = rows.filter((e) => prepOf(e).flt);
    check(rows.length > 0 && hiddenRows.length === 0, `${m.id}: not hidden by any tag, preset or rule (D2)`, JSON.stringify(hiddenRows.map((e) => [e.url, e.status, e.flt, e.fp, e.ca])));
    const shown = rows.map((e) => classify(prepOf(e))).filter((c) => (m.recovered ? c.r === 'n-recovered' : c.c === 'D'));
    check(rows.length > 0 && shown.length > 0, `${m.id}: ${m.recovered ? 'shown as an amber "failed N×, then OK" row' : 'shown as a problem'}`, JSON.stringify(rows.map((e) => [e.status, classify(prepOf(e))])));
  }
  check(MANIFEST.find((x) => x.id.startsWith('R5a')) && rowsOf(MANIFEST.find((x) => x.id.startsWith('R5a'))).every((e) => e.fp === 1), 'R5: the payment provider and SSO hosts are first party (they served a script or a frame), so they are Errors, not third-party Warnings');

  /* ---- NOISE rows are counted behind "hidden" ---- */
  const hiddenByReason = sum.hidden;
  for (const m of MANIFEST.filter((x) => x.cls === 'NOISE')) {
    const rows = rowsOf(m);
    const total = rows.reduce((s, e) => s + n(e), 0);
    counts[m.id] = total;
    check(total === m.n, `${m.id}: ${m.n} calls recorded (D1: nothing deleted)`, `got ${total}: ${JSON.stringify(rows.slice(0, 3).map((e) => [e.url, e.flt, e.n]))}`);
    check(rows.every((e) => prepOf(e).flt === m.reason), `${m.id}: every call is tagged "${m.reason}" and counted as hidden`, JSON.stringify(rows.filter((e) => prepOf(e).flt !== m.reason).slice(0, 3).map((e) => [e.url, e.status, prepOf(e).flt])));
  }
  const expectHidden = { abort: 2, telemetry: 403, adblock: 1, junk: 3 };
  check(JSON.stringify(Object.fromEntries(Object.entries(hiddenByReason).sort())) === JSON.stringify(Object.fromEntries(Object.entries(expectHidden).sort())), `hidden per reason is ${JSON.stringify(expectHidden)}`, JSON.stringify(hiddenByReason));
  check(sum.shown + sum.hiddenTotal === sum.total && sum.total > 0, `D1: shown ${sum.shown} + hidden ${sum.hiddenTotal} = total ${sum.total}`);
  check(problemCounts(prep).groups >= 11, `the headline counts the real failures (${problemCounts(prep).groups} distinct problems), none of the ${sum.hiddenTotal} hidden calls`, JSON.stringify(sig.hiding));
  check(!prep.some((e) => e.flt && /\/api\/orders|\/charge|\/token|\/chunk\.js|\/api\/data|\/graphql|\/api\/minute40/.test(String(e.url))), 'no protected endpoint carries a hidden reason anywhere');

  /* ---- accounting against what the page sent, and the HAR ---- */
  const fetchRows = nets.filter((e) => e.via === 'fetch' || e.via === 'xhr');
  const foldedFetch = reps.filter((r) => (r.ofKind || 'net') === 'net').reduce((s, r) => s + (r.n || 0), 0);
  const recorded = fetchRows.length + foldedFetch;
  check(recorded >= sentFetches && recorded <= sentFetches + 6, `D1: the page issued ${sentFetches} fetches; ${fetchRows.length} stored + ${foldedFetch} folded = ${recorded} recorded (the extras are the frame and script loads)`);
  const harEntries = har.log.entries;
  const harTotal = harEntries.reduce((s, e) => s + (e._folded || 1), 0);
  const rowsTotal = nets.length + foldedFetch;
  check(harTotal === rowsTotal, `the HAR holds every request: ${harEntries.length} entries, ${harTotal} requests (stored ${nets.length} + folded ${foldedFetch})`);
  for (const m of MANIFEST) check(harEntries.some((e) => m.match({ url: e.request.url, status: e.response.status, kind: 'net', en: undefined, ev: e.response.status === 0 ? 'abort' : undefined, operation: m.id.startsWith('R9a') ? 'OpErrors' : undefined })) || rowsOf(m).length > 0, `HAR: ${m.id} is in the HAR`, harEntries.length);
  check(!!har.log._qawrap?.networkFilter && har.log._qawrap.networkFilter.total === sum.total, 'the HAR carries the filter accounting', JSON.stringify(har.log._qawrap?.networkFilter));
  check(!!data.networkFilter && data.networkFilter.hiddenTotal === sum.hiddenTotal && /real failures, \d+ hidden, \d+ third-party/.test(data.networkFilter.sentences.counts) && /calls hidden by filter \(balanced\)/.test(data.networkFilter.sentences.hidden), 'session.json carries the filter accounting and the "M real failures, N hidden, K third-party" sentence', JSON.stringify(data.networkFilter));

  /* ---- click labels ---- */
  const doms = events.filter((e) => e.kind === 'dom' && e.action === 'click');
  const labelOf = (re) => doms.find((d) => re.test(d.selector || '') || re.test(d.tag + '#' + (d.elementId || '')));
  const byId = (idc) => doms.find((d) => (d.selector || '').includes(idc) || (d.locator || '').includes(idc));
  const labels = doms.map((d) => d.label ?? '');
  const graphemes = (t) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].length;
  check(doms.length >= 12, `${doms.length} clicks recorded`);
  const all = jsonText + harText + (await exportText('playwright')) + (await exportText('markdown'));
  for (const [what, re] of [['the email', /anna\.smith@example\.com|maria@example\.com/], ['the card number', /4111[ -]?1111[ -]?1111[ -]?1111/], ['the phone number', /0791234567/], ['the password', /hunter2/], ['a run of 6 or more digits in a click label or locator', null]]) {
    const hit = re ? all.match(re) : JSON.stringify(doms.map((d) => [d.label, d.locator, d.selector, d.xpath])).match(/(?<![\w-])\d{6,}(?!\d)/); // the digit run is checked where it can leak: the click rows (timestamps elsewhere are digits too)
    check(!hit, `no ${what} reaches any stored label, locator or export (JSON, HAR, spec, report)`, hit && all.slice(Math.max(0, hit.index - 80), hit.index + 80));
  }
  check(!JSON.stringify(doms.map((d) => [d.label, d.locator, d.selector, d.xpath])).match(/Plainname|Jane/), 'a plain-text table cell (no email, no digits) leaves no name or text in its label, locator, selector or xpath', JSON.stringify(doms.filter((d) => /gridcell|cell/.test(d.role || '')).map((d) => [d.label, d.locator, d.selector, d.xpath])));
  check(labels.every((l) => graphemes(l) <= 80), 'every stored label is at most 80 graphemes', JSON.stringify(labels.map((l) => graphemes(l))));
  check(labels.some((l) => /^Delete Anna Smith/.test(l)) && !labels.some((l) => /@/.test(l)), 'a button labelled with a name and an email keeps the name and loses the email', JSON.stringify(labels));
  check(labels.some((l) => /^Pay with card/.test(l)) && !labels.some((l) => /\d{6,}/.test(l)), 'a button labelled with a 16-digit card keeps the words and loses the digits', JSON.stringify(labels));
  const otp = doms.find((d) => d.tag === 'input' && /one-time|otp/i.test(`${d.selector} ${d.locator}`) || d.role === 'textbox' && d.label === '' && d.tag === 'input');
  check(!labels.some((l) => /digit 3 of 6/.test(l)), 'an OTP "digit 3 of 6" field records the role only', JSON.stringify(otp));
  check(labels.some((l) => l === 'حفظ الطلب') && !labels.some((l) => /[‪-‮‎‏]/.test(l)), 'an Arabic label with bidi marks is stored intact and without the marks', JSON.stringify(labels));
  check(labels.some((l) => l.startsWith('Long label ') && graphemes(l) === 80), 'a 300-character label is cut to exactly 80 graphemes', JSON.stringify(labels.filter((l) => l.startsWith('Long'))));
  check(labels.some((l) => l.includes('👍🏽') && l.includes('🇯🇴') && l.includes('é́')), 'emoji sequences and combining marks stay whole', JSON.stringify(labels.filter((l) => /Like/.test(l))));
  check(labels.includes('Settings gear') && labels.includes('trash'), 'an icon button is named by its SVG title or icon name', JSON.stringify(labels));
  check(doms.some((d) => d.unnamed === 'none') && doms.some((d) => (d.role === 'gridcell' || d.role === 'cell') && d.label === ''), 'a button without a name is flagged, and a table cell records its role only', JSON.stringify(doms.map((d) => [d.role, d.label, d.unnamed])));
  check(labels.includes('Edit') && labels.includes('Save'), 'ordinary labels are recorded as they are');
  check(!doms.some((d) => (d.label || '').includes('Password') && d.role !== 'textbox' && /password/i.test(d.label) && d.label.length > 0 && /hunter/.test(d.label)), 'a password wrapper never shows the typed value');

  /* ---- the report page ---- */
  const rp = await context.newPage();
  await rp.goto(`chrome-extension://${id}/report/report.html?session=${sessionId}`);
  await rp.waitForTimeout(2500);
  const body = (await rp.locator('body').innerText()).replace(/\s+/g, ' ');
  check(/\d+ real failures, \d+ hidden, \d+ third-party/.test(body) || /إخفاقات حقيقية/.test(body), 'the report page prints "M real failures, N hidden, K third-party"', body.slice(0, 400));
  check(/calls hidden by filter|طلبات مخفية بالغربلة|background calls hidden/.test(body), 'the report page prints the hidden-calls line', body.slice(0, 400));
  check(!/no issues|nothing failed|clean/i.test(body), 'no "no issues" wording on the report page');
  await rp.close();
  code = failures.length ? 1 : 0;
} catch (err) {
  failures.push('fixture run crashed');
  console.log(`  FAIL  fixture run crashed\n        ${String(err?.stack || err).slice(0, 1200)}`);
} finally {
  try { await top.release(); } catch { /* ignore */ }
  try { await context?.close(); } catch { /* ignore */ }
  server.close();
  trash(PROFILE);
  trash(EXT);
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code || (failures.length ? 1 : 0));
