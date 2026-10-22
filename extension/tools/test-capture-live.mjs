/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * D-1010-14 / r4-05-1: the capture pipeline end to end, in a real HEADED Chromium with the granted extension.
 *
 *   node tools/test-capture-live.mjs        (one headed run at a time; UQA_HEADLESS=1 is honoured for a quick look)
 *
 * A local server (127.0.0.1, a secure origin) serves tools/fixtures/capture-*.html and the endpoints they call.
 * Recording runs through the worker's own messages (UQA_ARM, UQA_START, UQA_STOP, UQA_EXPORT), then the
 * stored session is read back and the 12 cases of work/council-1010/r3/L2-detail.md:44-57 are asserted on its rows:
 *
 *    1 typing attribution        2 slow failure            3 GraphQL 200            4 resources + CSP
 *    5 XHR headers + abort       6 ws, sse, beacon + CSP   7 scripted click         8 dblclick/contextmenu/auxclick
 *    9 multi-select              10 multi-tab spec (RUN in Playwright, r3-11-2)       11 forged kind
 *   12 masked non-password       + 11b a forged NET event (green only once L2's MessageChannel lands: reported, not fixed here)
 *
 * The profile and the granted copy carry the tag council-1010 and are sent to the recycle bin on exit
 * (safe-delete trash.py), never deleted outright. The browser is closed in `finally`.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { TRASH } from './lib-trash.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { grantedExtension, awaitSiteScripts, seedConsent } from './lib-granted.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(HERE, '..');
const FIX = path.join(HERE, 'fixtures');

let passed = 0;
const failures = [];
const notes = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${String(detail).slice(0, 700)}` : ''}`); }
};
// PENDING <lane>: a case whose code another lane has not landed yet prints PENDING and stays green, unless QAW_STRICT_PENDING=1 (the verifier's run).
const pendings = [];
const pending = (lane, ok, name, detail = '') => {
  if (ok) return check(true, name);
  if (process.env.QAW_STRICT_PENDING === '1') return check(false, name, detail);
  pendings.push(`${name} (pending ${lane})`);
  console.log(`  PENDING ${lane}  ${name}${detail ? `\n        ${String(detail).slice(0, 500)}` : ''}`);
};
const trash = (p) => {
  if (!p || !fs.existsSync(p)) return;
  const r = spawnSync('python', [TRASH, p], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  // D-1010-118: a profile that could not be recycled is a leftover, so the suite is red.
  if (r.status !== 0) check(false, `recycle ${path.basename(p)}`, `could not send ${p} to the recycle bin: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`);
};

/* ---------------------------------------------------------------- the local server */
const hits = [];
const send = (res, code, body, type = 'application/json', extra = {}) => { res.writeHead(code, { 'content-type': type, ...extra }); res.end(body); };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    hits.push({ method: req.method, url, body });
    if (url === '/capture-fixture.html') return send(res, 200, fs.readFileSync(path.join(FIX, url)), 'text/html; charset=utf-8', { 'content-security-policy': "script-src 'self' 'unsafe-inline'" });
    if (url === '/capture-beacon.html') return send(res, 200, fs.readFileSync(path.join(FIX, url)), 'text/html; charset=utf-8', { 'content-security-policy': "connect-src 'none'" });
    if (url === '/capture-spec.html') return send(res, 200, fs.readFileSync(path.join(FIX, url)), 'text/html; charset=utf-8');
    if (url === '/capture-dialog.html' || url === '/capture-range-color.html') return send(res, 200, fs.readFileSync(path.join(FIX, url)), 'text/html; charset=utf-8');
    if (url === '/capture-spa.html') return send(res, 200, fs.readFileSync(path.join(FIX, url)), 'text/html; charset=utf-8');
    if (url === '/spa-sse-500') return send(res, 500, 'no', 'text/plain');
    if (url === '/long-500') return void setTimeout(() => { try { send(res, 500, '{"error":"long-500"}'); } catch { /* closed */ } }, 6000);
    if (url === '/capture-second.html') return send(res, 200, fs.readFileSync(path.join(FIX, url)), 'text/html; charset=utf-8');
    if (url === '/locators/shadow.html') return send(res, 200, fs.readFileSync(path.join(FIX, 'locators', 'shadow.html')), 'text/html; charset=utf-8');
    if (url === '/form-500' || url === '/hello-500') return send(res, 500, '{"error":"typed-500"}');
    if (url === '/fail-500') return send(res, 500, '{"error":"typed-500"}');
    if (url === '/slow-500') return void setTimeout(() => send(res, 500, '{"error":"slow-500"}'), 1500);
    if (url === '/graphql') {
      const op = (() => { try { return JSON.parse(body).operationName; } catch { return ''; } })();
      return send(res, 200, op === 'Pay' ? '{"data":null,"errors":[{"message":"x"}]}' : '{"data":{"ping":true}}');
    }
    if (url === '/xhr-ok') return send(res, 200, '{"ok":true}', 'application/json', { 'x-canary-response': 'seen' });
    if (url === '/xhr-slow') return void setTimeout(() => { try { send(res, 200, '{}'); } catch { /* aborted */ } }, 4000);
    if (url === '/sse-500') return send(res, 500, 'no', 'text/plain');
    if (url === '/missing.png' || url === '/missing.css') return send(res, 404, 'nope', 'text/plain');
    if (url === '/b') return send(res, 204, '');
    return send(res, 404, 'nope', 'text/plain');
  });
});
// r10-05-2: a WebSocket that is accepted at the TCP level and then cut dead, so the page sees close code 1006
server.on('upgrade', (req, socket) => { hits.push({ method: 'UPGRADE', url: req.url.split('?')[0], body: '' }); socket.destroy(); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* ---------------------------------------------------------------- the browser */
const TAG = 'council-1010';
const EXT = grantedExtension({ label: `${TAG}-capture` });
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), `uqa-${TAG}-capture-`));
let context;
let top = { release: async () => {} };
const SPEC_DIRS = [];
let code = 1;

const rowsOf = (events, kind) => events.filter((e) => e.kind === kind);
const netRows = (events) => rowsOf(events, 'net');

try {
  purgeWorkerCache(PROFILE);
  context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT, { width: 1100, height: 900, headed: process.env.UQA_HEADLESS !== '1' }));
  top = await keepOnTop(context);
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  await awaitSiteScripts(worker);
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${id}/options/options.html`);
  await ext.waitForTimeout(500);
  const call = (m) => ext.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);

  const tabOf = (prefix) => worker.evaluate(async (o) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(o)), prefix);
  async function openRecorded(url, charter) {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    const tab = await tabOf(url);
    await call({ type: 'UQA_ARM', windowId: tab.windowId });
    const started = await call({ type: 'UQA_START', charter, tabId: tab.id, startUrl: url });
    const sessionId = started?.result?.id || started?.result?.sessionId || started?.result?.session?.id;
    // the recorder wakes a moment after the start message: wait for the content script's own answer (R15), not a fixed sleep
    const ready = await worker.evaluate(async (tabId) => {
      const until = Date.now() + 10000;
      for (;;) {
        const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => window.UQABridge?.isRecording?.() === true && !!window.__UQA_RECORDER__ }).catch(() => null);
        if (r?.[0]?.result) return true;
        if (Date.now() > until) return false;
        await new Promise((q) => setTimeout(q, 100));
      }
    }, tab.id);
    check(ready, `recorder is live on ${new URL(url).pathname}`);
    await page.waitForTimeout(300);
    return { page, tab, sessionId };
  }
  async function readSession(sessionId, extra = {}) {
    const j = await call({ type: 'UQA_EXPORT', sessionId, format: 'json' });
    let text = j?.result?.content ?? '';
    if (j?.result?.encoding === 'gzip-base64' || j?.result?.gzip) text = zlib.gunzipSync(Buffer.from(text, 'base64')).toString('utf8');
    let data = {};
    try { data = JSON.parse(text); } catch { /* the check below says it */ }
    const events = data.events || data.session?.events || [];
    if (process.env.QAW_DUMP) fs.writeFileSync(path.join(os.tmpdir(), `qaw-capture-${extra.label || 'a'}.json`), text);
    return { raw: j, data, events };
  }
  const spec = async (sessionId, label = 'a') => {
    const text = (await call({ type: 'UQA_EXPORT', sessionId, format: 'playwright' }))?.result?.content || '';
    if (process.env.QAW_DUMP) fs.writeFileSync(path.join(os.tmpdir(), `qaw-capture-spec-${label}.js`), text);
    return text;
  };

  /* ============================================================ session A: the fixture page */
  const A = await openRecorded(`${ORIGIN}/capture-fixture.html`, 'capture fixture A');
  check(!!A.sessionId, 'session A started', JSON.stringify(A));
  const p = A.page;

  // 1 typing attribution: a timer started by typing makes the failing request
  await p.locator('#typed').pressSequentially('abc', { delay: 40 });
  await p.waitForTimeout(700);
  // 2 slow failure: click, then another click at 0.5 s; the 500 lands at 1.5 s
  await p.click('#slow');
  await p.waitForTimeout(500);
  await p.click('#second');
  await p.waitForTimeout(1700);
  // 3 GraphQL 200 with errors, then one without
  await p.click('#pay');
  await p.waitForTimeout(400);
  await p.click('#ping');
  await p.waitForTimeout(400);
  // 4 resources and CSP
  await p.click('#broken');
  await p.waitForTimeout(800);
  // 5 XHR with secrets, then an abort
  await p.click('#xhr');
  await p.waitForTimeout(500);
  await p.click('#xhr-abort');
  await p.waitForTimeout(700);
  // 6 ws, sse
  await p.click('#sockets');
  await p.waitForTimeout(1200);
  // 7 scripted click between two real clicks
  await p.click('#scripted');
  await p.evaluate(() => window.fireScripted());
  await p.waitForTimeout(150);
  await p.click('#second');
  // 8 dblclick, right click, middle click
  await p.dblclick('#dbl');
  await p.click('#ctx', { button: 'right' });
  await p.click('#aux', { button: 'middle' });
  // 9 multi-select
  // real clicks with Control held: selectOption() dispatches page-made events, which the recorder rightly marks (by the page)
  await p.click('#multi option >> text=Red');
  await p.click('#multi option >> text=Green', { modifiers: ['Control'] });
  await p.click('#multi option >> text=Blue', { modifiers: ['Control'] });
  // 12 a text field that autocompletes as a one-time code
  await p.fill('#otp', '123456');
  await p.click('#second');
  // 11 forged kind (a dom event posted from the page onto QA Wrap's channel)
  await p.evaluate(() => window.forge('dom'));
  await p.waitForTimeout(500);
  // 11b forged net event (needs L2's MessageChannel handshake; reported by the verifier after both lanes)
  await p.evaluate(() => window.forge('net'));
  await p.waitForTimeout(700);
  await call({ type: 'UQA_STOP' });
  await p.waitForTimeout(600);

  const sA = await readSession(A.sessionId, { label: 'A' });
  const ev = sA.events;
  check(ev.length > 10, `session A stored ${ev.length} events`, JSON.stringify(sA.raw).slice(0, 300));
  const nets = netRows(ev);
  const doms = rowsOf(ev, 'dom');
  const consoles = rowsOf(ev, 'console');

  // case 1 and 2: the worker pairs each failure with the step that caused it (the net row's `act` epoch drives that pairing)
  const pairs = sA.data.correlatedFailures || [];
  const triggerOf = (re) => pairs.find((c) => re.test(c.failure?.url || ''))?.trigger;
  const typedTrigger = triggerOf(/\/fail-500/);
  check(!!typedTrigger && typedTrigger.action === 'input' && typedTrigger.label === 'Name', '1 typing: the failing request is paired with the typing step, not the step before', JSON.stringify(typedTrigger && [typedTrigger.action, typedTrigger.label]));
  const typed500 = nets.filter((n) => /\/fail-500/.test(n.url));
  check(typed500.length === 3 && new Set(typed500.map((n) => n.act)).size === 1, '1 typing: the three failing rows of one typing burst share one act epoch', JSON.stringify(typed500.map((n) => n.act)));
  const slowTrigger = triggerOf(/\/slow-500/);
  check(!!slowTrigger && slowTrigger.label === 'Slow failure', '2 slow failure: the 500 that lands 1.5 s later is paired with the first click, not the second', JSON.stringify(slowTrigger && [slowTrigger.action, slowTrigger.label]));
  // case 3
  const gqlRows = nets.filter((n) => n.ev === 'gql');
  check(gqlRows.length === 1 && gqlRows[0].status === 200 && gqlRows[0].operation === 'Pay', '3 GraphQL: one gql row (Pay, status 200); the clean Ping adds none', JSON.stringify(gqlRows));
  // case 4
  const res = nets.filter((n) => n.via === 'resource');
  const csp = consoles.filter((c) => /^CSP: script-src/.test(c.text || ''));
  check(res.some((r) => /missing\.png$/.test(r.url)) && res.some((r) => /missing\.css$/.test(r.url)) && csp.length >= 1, '4 resources + CSP: a resource row each for the image and the stylesheet, and a console error starting "CSP: script-src"', JSON.stringify({ res: res.map((r) => r.url), csp: csp.map((c) => c.text) }));
  // case 5
  const xhr = nets.find((n) => /\/xhr-ok/.test(n.url));
  const reqAuth = xhr && (xhr.reqHeaders?.Authorization ?? xhr.reqHeaders?.authorization);
  check(!!xhr && !!reqAuth && !/abc|Bearer/.test(reqAuth), '5 XHR: the bearer header value is masked, never the token', JSON.stringify(xhr?.reqHeaders));
  check(!!xhr && /«redacted»/.test(xhr.reqBody?.text || '') && !/"password":"p"/.test(JSON.stringify(xhr.reqBody)), '5 XHR: the password in the body is redacted', JSON.stringify(xhr?.reqBody));
  check(!!xhr && !!xhr.resHeaders && Object.keys(xhr.resHeaders).length > 0, '5 XHR: response headers are present', JSON.stringify(xhr?.resHeaders));
  const abort = nets.find((n) => /\/xhr-slow/.test(n.url));
  check(!!abort && abort.error === false && abort.ev === 'abort', '5 XHR abort: a row with error:false, ev:abort', JSON.stringify(abort));
  // case 6
  const ws = nets.find((n) => n.via === 'ws');
  const sse = nets.find((n) => n.via === 'sse');
  check(!!ws && !!sse && !!ws.url && !!sse.url && !ws.reqBody && !sse.reqBody, '6 ws and sse: a row each with a URL and no payload bytes', JSON.stringify({ ws, sse }));
  // case 7
  const scripted = doms.filter((d) => d.action === 'click' && d.trusted === false);
  check(scripted.length === 1, '7 scripted click: one click step with trusted:false between the two real ones', JSON.stringify(doms.map((d) => [d.type, d.trusted])));
  // case 8
  const dbl = doms.filter((d) => d.action === 'dblclick');
  const right = doms.filter((d) => d.action === 'click' && d.button === 2);
  const mid = doms.filter((d) => d.action === 'click' && d.button === 1);
  check(dbl.length === 1 && right.length === 1 && mid.length === 1, '8 mouse: one dblclick step, one right click, one middle click', JSON.stringify({ dbl: dbl.length, right: right.length, mid: mid.length }));
  // case 9
  const multi = doms.find((d) => d.control === 'select-multiple');
  check(!!multi, '9 multi-select: control select-multiple', JSON.stringify(doms.filter((d) => /select/.test(d.type || d.control || '')).slice(0, 3)));
  // case 11
  check(!doms.some((d) => /forged-canary/.test(JSON.stringify(d))) && !JSON.stringify(ev).includes('forged-canary'), '11 forged kind: a dom event posted onto the page channel is not in the stored rows');
  // case 11b
  check(!JSON.stringify(ev).includes('net-canary'), '11b forged net: a net event posted by the page onto the channel is not in the stored rows (needs L2 MessageChannel, D-1010-78)', 'the page forged a net row and it was stored');

  // the generated Playwright spec for session A
  const specA = await spec(A.sessionId, 'A');
  check(/dblclick\(/.test(specA) && /button: 'right'/.test(specA) && /button: 'middle'/.test(specA), '8 spec: .dblclick(), click({ button: right }), click({ button: middle })', specA.slice(0, 300));
  check(/selectOption\(\s*\[\s*\{ label: 'Red' \}/.test(specA), '9 spec: selectOption([{ label }, ...])', specA.slice(0, 300));
  check((specA.match(/Scripted target/g) || []).length === 1, '7 spec: the scripted click is not replayed (one Scripted target line, the real click)', specA.slice(-900));

  // case 12
  const tcRes = (await call({ type: 'UQA_TEST_CASE', sessionId: A.sessionId }))?.result || {};
  const tc = tcRes.testCase || {};
  const tcMd = tcRes.markdown || '';
  check((tc.testData || []).some((d) => d.masked && d.value === '«One-time code»') && tcMd.includes('«One-time code»'), '12 masked non-password: the test data placeholder is «One-time code»', JSON.stringify(tc.testData));
  check(!/password/i.test((tc.preconditions || []).join(' | ')), '12 masked non-password: no "password" wording in the preconditions', JSON.stringify(tc.preconditions));
  check(!JSON.stringify(ev).includes('123456'), '12 masked non-password: the typed code is not stored');

  /* ============================================================ session B: the beacon page */
  await p.close();
  const B = await openRecorded(`${ORIGIN}/capture-beacon.html`, 'capture beacon');
  await B.page.click('#beacon');
  await B.page.waitForTimeout(900);
  await call({ type: 'UQA_STOP' });
  await B.page.waitForTimeout(500);
  const sB = await readSession(B.sessionId, { label: 'B' });
  const cspB = rowsOf(sB.events, 'console').filter((c) => /^CSP: connect-src/.test(c.text || ''));
  check(cspB.length >= 1, '6 beacon: the blocked beacon is a console row "CSP: connect-src blocked" (r4-05-5)', JSON.stringify(rowsOf(sB.events, 'console').map((c) => c.text)));
  const beaconRows = netRows(sB.events).filter((n) => n.via === 'beacon');
  if (beaconRows.length) check(beaconRows.every((b) => !b.reqBody && !b.body), '6 beacon: a beacon row carries a URL and no payload bytes', JSON.stringify(beaconRows));
  else notes.push('beacon: no via:beacon row (sendBeacon returned true under connect-src none, so only the CSP row exists)');
  check(!hits.some((h) => h.url === '/b'), '6 beacon: the server never saw the blocked beacon');
  await B.page.close();

  /* ============================================================ session C: two tabs, then the spec RUN */
  const C = await openRecorded(`${ORIGIN}/capture-fixture.html`, 'capture multi-tab');
  const popupP = context.waitForEvent('page');
  await C.page.click('#newtab');
  const second = await popupP;
  await second.waitForLoadState('load');
  await second.waitForTimeout(900);
  await second.click('#second-tab-button');
  await second.waitForTimeout(400);
  await C.page.bringToFront().catch(() => {});
  await C.page.click('#second');
  await C.page.waitForTimeout(500);
  await call({ type: 'UQA_STOP' });
  await C.page.waitForTimeout(500);
  const specC = await spec(C.sessionId, 'C');
  check(/context\.waitForEvent\('page'\)/.test(specC) && /page2\./.test(specC) && /bringToFront\(\)/.test(specC), '10 multi-tab: the spec has context.waitForEvent(page), page2. and bringToFront()', specC.slice(0, 500));

  // r3-11-2: run the generated spec with Playwright; it must pass
  const runSpec = async (text, extraEnv = {}) => {
    const dir = fs.mkdtempSync(path.join(EXT_DIR, `.${TAG}-spec-`));
    SPEC_DIRS.push(dir);
    fs.writeFileSync(path.join(dir, 'generated.spec.js'), text.replace(/^﻿/, ''));
    fs.writeFileSync(path.join(dir, 'playwright.config.mjs'), "export default { testDir: '.', testMatch: /generated\\.spec\\.js$/, outputDir: './out', timeout: 30000, retries: 0, reporter: 'line', use: { headless: true } };\n");
    // async, not spawnSync: the fixture server lives in THIS process and must keep answering while the spec runs
    return new Promise((done) => {
      const child = spawn(process.execPath, [path.join(EXT_DIR, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--config', path.join(dir, 'playwright.config.mjs')], { cwd: dir, env: { ...process.env, PYTHONUTF8: '1', ...extraEnv } });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (c) => { stdout += c; });
      child.stderr.on('data', (c) => { stderr += c; });
      const timer = setTimeout(() => child.kill(), 120000);
      child.on('close', (status) => { clearTimeout(timer); done({ status, stdout, stderr }); });
    });
  };
  const run = await runSpec(specC);
  if (process.env.QAW_DUMP) fs.writeFileSync(path.join(os.tmpdir(), 'qaw-capture-run.txt'), `${run.stdout}\n${run.stderr}`);
  check(run.status === 0, '10 multi-tab: the generated spec passes when run with Playwright', `${(run.stdout || '').slice(-600)} ${(run.stderr || '').slice(-300)}`);

  /* ============================================================ session D: forged hello, FormData scrub, replaceState storm, mask pixels */
  await C.page.close().catch(() => {});
  await second.close().catch(() => {});
  const D = await openRecorded(`${ORIGIN}/capture-fixture.html?s=d`, 'capture council-1010 r5');
  const dp = D.page;
  // r5-02-1: the page sends a hello after pairing and acks any port it is handed; capture must still reach the real port
  await dp.evaluate(() => window.forgeHello());
  await dp.waitForTimeout(500);
  const portSeen = await dp.evaluate(() => window.__portSeen);
  check(portSeen === 0, 'r5-02-1 forged hello: the page, after pairing, is never handed a port', `the page received ${portSeen} port(s)`);
  await dp.evaluate(() => fetch('/hello-500').catch(() => {}));
  await dp.waitForTimeout(700);
  // r5-05-1: a FormData part value that is a card number
  await dp.click('#formdata');
  await dp.waitForTimeout(800);
  // r5-05-5: five replaceState calls to one URL
  await dp.click('#replace');
  await dp.waitForTimeout(600);
  // r5-03-3 (r4-03-1): mask the field, photograph the page, decode the PNG
  const samplePixels = async (sel) => {
    await dp.locator(sel).scrollIntoViewIfNeeded();
    const box = await dp.locator(sel).boundingBox();
    const png = await dp.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    return dp.evaluate(async (b64) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const cv = new OffscreenCanvas(bmp.width, bmp.height); const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0);
      const out = [];
      for (const fx of [0.05, 0.3, 0.55, 0.8, 0.95]) for (const fy of [0.1, 0.5, 0.9]) {
        const d = cx.getImageData(Math.min(bmp.width - 1, Math.floor(bmp.width * fx)), Math.min(bmp.height - 1, Math.floor(bmp.height * fy)), 1, 1).data;
        out.push([d[0], d[1], d[2]]);
      }
      return out;
    }, png.toString('base64'));
  };
  const magenta = ([r, g, b]) => r > 200 && g < 60 && b > 200;
  const before = await samplePixels('#secret');
  check(before.filter(magenta).length >= 8, 'r5-03-3 mask pixels: before the mask the field photographs in its own colour (magenta)', JSON.stringify(before.slice(0, 5)));
  const applied = await worker.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'UQA_MASK_APPLY', masks: [{ id: 'council-1010-m1', path: '#secret', index: 0, name: 'Card number', tag: 'input', at: Date.now(), page: 'http://127.0.0.1' }] }), D.tab.id);
  await dp.waitForTimeout(500);
  const after = await samplePixels('#secret');
  const inkLike = ([r, g, b]) => r < 100 && g < 100 && b < 100;
  check(applied?.count === 1 && after.filter(inkLike).length >= 13 && !after.some(magenta), 'r5-03-3 mask pixels: after the mask every sampled pixel of the field rectangle is the opaque mask colour, none is the original', JSON.stringify({ applied, after: after.slice(0, 6) }));
  await call({ type: 'UQA_STOP' });
  await dp.waitForTimeout(500);
  const sD = await readSession(D.sessionId, { label: 'D' });
  const netD = netRows(sD.events);
  const textD = JSON.stringify(sD.events);
  check(netD.some((n) => /\/hello-500/.test(n.url)), 'r5-02-1 forged hello: a request made after the forged hello is still captured on the real port', JSON.stringify(netD.map((n) => n.url)));
  check(netD.some((n) => /\/form-500/.test(n.url)), 'r5-05-1 FormData: the failing multipart post is a recorded row', JSON.stringify(netD.map((n) => [n.url, n.status])));
  check(!/4111[ -]?1111[ -]?1111[ -]?1111/.test(textD), 'r5-05-1 FormData: the card number in an innocuous FormData part is nowhere in the stored session (end to end)', (textD.match(/.{40}4111.{40}/) || [''])[0]);
  const routeNavs = sD.events.filter((e) => e.kind === 'nav' && e.route && /replaced=1/.test(e.url || ''));
  check(routeNavs.length === 1, 'r5-05-5 replaceState x5 to one URL gives exactly one Navigate step', `${routeNavs.length} route nav row(s)`);
  await dp.close();

  /* ============================================================ session E: a shadow-root locator resolves to exactly one element */
  const E = await openRecorded(`${ORIGIN}/locators/shadow.html`, 'capture shadow locators');
  await E.page.locator('button[data-truth="dup-shadow"]').click();
  await E.page.waitForTimeout(300);
  await E.page.locator('button[data-truth="shadow-only"]').click();
  await E.page.waitForTimeout(300);
  await call({ type: 'UQA_STOP' });
  await E.page.waitForTimeout(500);
  const specE = await spec(E.sessionId, 'E');
  const clickExprs = [...specE.matchAll(/await (page\.[^\n;]*?)\.click\(/g)].map((m) => m[1]);
  check(clickExprs.length === 2, 'r5-05-3 shadow locator: the spec has one click line per shadow-root click', specE.slice(0, 500));
  for (const [i, truth] of ['dup-shadow', 'shadow-only'].entries()) {
    if (!clickExprs[i]) { check(false, `r5-05-3 shadow locator: ${truth} resolves to count 1`, 'no click line'); continue; }
    const loc = new Function('page', `return ${clickExprs[i]};`)(E.page);
    const n = await loc.count();
    const which = n === 1 ? await loc.getAttribute('data-truth') : null;
    check(n === 1 && which === truth, `r5-05-3 shadow locator: ${truth} resolves to count 1 in Playwright (${clickExprs[i]})`, `count ${n}, resolves to ${which}`);
  }
  await E.page.close();

  /* ============================================================ session F: r6-11-2, a recorded spec with a secret fill, an assertion, goBack and reload is RUN */
  const F = await openRecorded(`${ORIGIN}/capture-spec.html`, 'capture spec run');
  const fp = F.page;
  await fp.fill('#name', 'Sara');
  await fp.fill('#pw', 'hunter2-canary');
  await fp.click('#save');
  await fp.waitForTimeout(400);
  // the assert pick: picker on, hover the element, Ctrl+Shift+click (CDP input, not the OS mouse)
  await call({ type: 'UQA_PICK', tabId: F.tab.id });
  await fp.waitForTimeout(500);
  await fp.hover('#out');
  await fp.waitForTimeout(400);
  await fp.click('#out', { modifiers: ['Control', 'Shift'] });
  await fp.waitForTimeout(600);
  await fp.click('#go');
  await fp.waitForURL(/capture-second/);
  await fp.waitForTimeout(900);
  await fp.goBack();
  await fp.waitForURL(/capture-spec/);
  await fp.waitForTimeout(900);
  await fp.reload();
  await fp.waitForTimeout(900);
  await call({ type: 'UQA_STOP' });
  await fp.waitForTimeout(500);
  let specF = await spec(F.sessionId, 'F');
  // D-1010-168: the assert pick (Ctrl+Shift+click) must not also be recorded as a click step. recorder.js skips clicks while
  // UQAPicker.isActive() (r7 F3), so nothing is spliced out of the spec any more: a click on the asserted element right before the expect fails.
  const specLines = specF.split('\n');
  const expectAt = specLines.findIndex((l) => /^\s*await expect\(/.test(l));
  const strayLoc = expectAt > 0 ? (specLines[expectAt - 1].match(/^\s*await (.+)\.click\(\);$/) || [])[1] : null;
  check(expectAt > 0 && !(strayLoc && specLines[expectAt].includes(strayLoc)), 'r8-12-2 spec F: no click step on the asserted element sits before the expect (the assert pick is not also a click)', specLines.slice(Math.max(0, expectAt - 2), expectAt + 1).join(' | '));
  const sF = await readSession(F.sessionId, { label: 'F' });
  const secretVar = (specF.match(/process\.env\.(QAW_SECRET_\w+)/) || [])[1];
  const expects = specF.match(/await expect\(/g) || [];
  check(!!secretVar && /\.toHaveText\('Saved'\)/.test(specF) && /\.goBack\(\)/.test(specF) && /\.reload\(\)/.test(specF) && expects.length === 1,
    'r6-11-2 spec F: has the QAW_SECRET fill, one expect toHaveText(Saved), goBack() and reload()', specF.slice(0, 900));
  check(!specF.includes('hunter2-canary') && !JSON.stringify(sF.events).includes('hunter2-canary'), 'r6-11-2 spec F: the typed password is nowhere in the spec or the stored session');
  const runF = await runSpec(specF, secretVar ? { [secretVar]: 'hunter2-canary' } : {});
  if (process.env.QAW_DUMP) fs.writeFileSync(path.join(os.tmpdir(), 'qaw-capture-run-F.txt'), `${runF.stdout}\n${runF.stderr}`);
  check(runF.status === 0 && /\b1 passed\b/.test(runF.stdout) && !/\bfailed\b/.test(runF.stdout), 'r6-11-2 spec F: npx playwright test exits 0 with 1 passed (the one recorded assertion ran)', `${(runF.stdout || '').slice(-700)} ${(runF.stderr || '').slice(-300)}`);
  await fp.close().catch(() => {});


  /* ============================================================ session G: r8-05-1, a navigation that fails (closed local port) */
  const closed = http.createServer();
  await new Promise((ok) => closed.listen(0, '127.0.0.1', ok));
  const closedPort = closed.address().port;
  await new Promise((ok) => closed.close(ok)); // nothing listens on this port now
  const G = await openRecorded(`${ORIGIN}/capture-second.html`, 'capture failed navigation');
  await G.page.goto(`http://127.0.0.1:${closedPort}/gone`, { waitUntil: 'load' }).catch(() => {});
  await G.page.waitForTimeout(1200);
  await call({ type: 'UQA_STOP' });
  await G.page.waitForTimeout(500);
  const sG = await readSession(G.sessionId, { label: 'G' });
  const netErr = rowsOf(sG.events, 'net').filter((e) => String(e.url || '').includes(`:${closedPort}`) && e.error === true);
  const errNavs = sG.events.filter((e) => e.kind === 'nav' && /^chrome-error:/.test(String(e.url || '')));
  pending('L2', netErr.length >= 1, 'r8-05-1 failed navigation: the closed port has a net row with error true', JSON.stringify(rowsOf(sG.events, 'net').map((e) => ({ u: e.url, error: e.error, status: e.status })).slice(-4)));
  check(errNavs.length === 0, 'r8-05-1 failed navigation: no chrome-error nav step is recorded', JSON.stringify(errNavs.map((e) => e.url)));
  await G.page.close().catch(() => {});

  /* ============================================================ session H: r8-05-3, a listener div inside role=dialog */
  const H = await openRecorded(`${ORIGIN}/capture-dialog.html`, 'capture dialog child');
  await H.page.click('#plan-card');
  await H.page.waitForTimeout(500);
  await call({ type: 'UQA_STOP' });
  await H.page.waitForTimeout(500);
  const specH = await spec(H.sessionId, 'H');
  const clickH = [...specH.matchAll(/await (page\.[^\n;]*?)\.click\(/g)].map((m) => m[1]);
  let hId = null;
  let hCount = 0;
  if (clickH.length === 1) {
    const loc = new Function('page', `return ${clickH[0]};`)(H.page);
    hCount = await loc.count();
    hId = hCount === 1 ? await loc.getAttribute('id') : null;
  }
  pending('L4', clickH.length === 1 && hCount === 1 && hId === 'plan-card', 'r8-05-3 dialog child: the click step locator is the div (#plan-card), not the role=dialog', JSON.stringify({ clickH, hCount, hId }));
  await H.page.close().catch(() => {});

  /* ============================================================ session I: r8-05-4, a range step and a color step, then the spec is RUN */
  const I = await openRecorded(`${ORIGIN}/capture-range-color.html`, 'capture range and colour');
  // OF-11: fill() sets the value from script, so its events are untrusted and the recorder rightly leaves them out of the spec
  // (D-1010-47). A real slider move is keyboard input: focus, then four ArrowRight presses take 3 to 7. The colour picker is a native
  // popup no automation can drive with trusted input; its replay line is proved from a recorded step in test-of-c-spec.mjs.
  await I.page.focus('#vol');
  for (let i = 0; i < 4; i++) await I.page.keyboard.press('ArrowRight');
  await I.page.waitForTimeout(500);
  await call({ type: 'UQA_STOP' });
  await I.page.waitForTimeout(500);
  const specI = await spec(I.sessionId, 'I');
  const hasRange = /['"]7['"]/.test(specI);
  check(hasRange && /\.evaluate\(\(el, v\) => \{ el\.value = v;/.test(specI), 'r8-05-4 range (OF-11): a real slider move is a replayable step carrying the value 7', specI.slice(0, 600));
  if (hasRange) {
    const runI = await runSpec(specI);
    check(runI.status === 0 && /\b1 passed\b/.test(runI.stdout), 'r8-05-4 range: the generated spec runs and passes', `${(runI.stdout || '').slice(-600)} ${(runI.stderr || '').slice(-300)}`);
  }
  await I.page.close().catch(() => {});

  /* ============================================================ session J: r10-05-2 SPA routes, ws 1006, sse 500, a sub-frame to a closed port, Space on a div role=button; r10-05-3 a 6 s request (record only) */
  const closedJ = http.createServer();
  await new Promise((ok) => closedJ.listen(0, '127.0.0.1', ok));
  const closedJPort = closedJ.address().port;
  await new Promise((ok) => closedJ.close(ok));
  const J = await openRecorded(`${ORIGIN}/capture-spa.html`, 'capture spa');
  const jp = J.page;
  await jp.click('#push');
  await jp.waitForTimeout(400);
  await jp.click('#hash');
  await jp.waitForTimeout(400);
  await jp.click('#back');
  await jp.waitForTimeout(600);
  await jp.evaluate((u) => window.openWs(u), `ws://127.0.0.1:${server.address().port}/ws-1006`);
  await jp.evaluate((u) => window.openSse(u), `${ORIGIN}/spa-sse-500`);
  await jp.evaluate((u) => window.openFrame(u), `http://127.0.0.1:${closedJPort}/sub-gone`);
  await jp.waitForTimeout(1500);
  await jp.focus('#spacebtn');
  await jp.keyboard.press('Space');
  await jp.waitForTimeout(400);
  // OF-12: Shift+Enter in a textarea is one keydown step named 'Shift+Enter', and the spec replays it as press('Shift+Enter')
  await jp.focus('#note');
  await jp.keyboard.press('Shift+Enter');
  await jp.waitForTimeout(400);
  // r10-05-3 (headed, record only): a click starts a 6 s request; a second click lands 2 s later; the 500 arrives at 6 s
  await jp.click('#long');
  await jp.waitForTimeout(2000);
  await jp.click('#other');
  await jp.waitForTimeout(4800);
  await call({ type: 'UQA_STOP' });
  await jp.waitForTimeout(500);
  const sJ = await readSession(J.sessionId, { label: 'J' });
  const specJ = await spec(J.sessionId, 'J');
  const jShift = rowsOf(sJ.events, 'dom').filter((d) => d.action === 'keydown' && d.key === 'Shift+Enter');
  check(jShift.length === 1, "OF-12 Shift+Enter: one keydown step with key 'Shift+Enter' in the textarea", JSON.stringify(rowsOf(sJ.events, 'dom').map((d) => [d.action, d.key, d.label]).slice(-6)));
  check(/\.press\('Shift\+Enter'\)/.test(specJ), "OF-12 Shift+Enter: the generated spec carries press('Shift+Enter')", specJ.slice(-700));
  const jNets = netRows(sJ.events);
  const jRoute = sJ.events.filter((e) => e.kind === 'nav' && e.route === true);
  const pushNav = jRoute.filter((e) => /\?step=push$/.test(e.url || ''));
  const hashNav = jRoute.filter((e) => /#frag$/.test(e.url || ''));
  check(pushNav.length >= 1 && hashNav.length === 1 && jRoute.length === 3, 'r10-05-2 SPA: pushState, hash change and back are one nav row each with route:true (3 rows)', JSON.stringify(jRoute.map((e) => [e.url, e.route, e.transition])));
  const jWs = jNets.find((n) => n.via === 'ws' && /\/ws-1006/.test(n.url || ''));
  check(!!jWs && jWs.error === true && /WebSocket (error|closed: 1006)/.test(jWs.text || ''), 'r10-05-2 ws: a socket cut dead is a net row via ws with error true', JSON.stringify(jWs));
  if (jWs) notes.push(`r10-05-2 ws row text: ${jWs.text}`);
  const jSse = jNets.find((n) => n.via === 'sse' && /\/spa-sse-500/.test(n.url || ''));
  check(!!jSse && jSse.error === true, 'r10-05-2 sse: an EventSource on a 500 is a net row via sse with error true', JSON.stringify(jSse));
  const jSub = jNets.find((n) => n.via === 'subframe' && String(n.url || '').includes(`:${closedJPort}`));
  check(!!jSub && jSub.error === true, 'r10-05-2 sub-frame: an iframe to a closed port is a net row via subframe with error true', JSON.stringify(jNets.map((n) => [n.via, n.url, n.error]).slice(-6)));
  const jSpace = rowsOf(sJ.events, 'dom').filter((d) => d.action === 'keydown' && d.key === 'Space');
  check(jSpace.length === 1, 'r10-05-2 Space: a div role=button operated by Space is one keydown Space step', JSON.stringify(rowsOf(sJ.events, 'dom').map((d) => [d.action, d.key, d.label]).slice(-6)));
  const jLong = jNets.filter((n) => /\/long-500/.test(n.url || ''));
  const jPair = (sJ.data.correlatedFailures || []).find((c) => /\/long-500/.test(c.failure?.url || ''))?.trigger;
  notes.push(`r10-05-3 6 s request + second click at 2 s (record only, D-234): ${jLong.length} row(s) ${JSON.stringify(jLong.map((n) => ({ status: n.status, act: n.act, durationMs: n.durationMs })))}; paired trigger: ${jPair ? JSON.stringify([jPair.action, jPair.label]) : 'none'}`);
  await jp.close().catch(() => {});
  code = failures.length ? 1 : 0;
} catch (err) {
  check(false, 'the live capture run reached the end', err.stack?.split('\n').slice(0, 4).join(' | '));
} finally {
  await top.release?.().catch(() => {});
  await context?.close().catch(() => {});
  await new Promise((ok) => server.close(ok));
  trash(PROFILE);
  trash(EXT);
  for (const d of SPEC_DIRS) trash(d);
}
for (const p of pendings) console.log(`  PENDING: ${p}`);
for (const n of notes) console.log(`  NOTE: ${n}`);
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) console.log(`failed: ${failures.join(' | ')}`);
process.exit(failures.length ? 1 : code);
