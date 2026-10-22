/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * r8-14-1 falsifier (D-1010-170). Headed.
 *
 *   node tools/test-origin-gate-live.mjs
 *
 * The claim under test: the security-headers listener only ever sees responses from origins the person granted, because Chrome
 * delivers webRequest events only for URLs the extension holds a host permission for (manifest.json optional_host_permissions,
 * none required). The shipping copy is rebuilt here with ONE grant, http://127.0.0.1/*. A page on that origin embeds a
 * http://localhost frame (a different host, not granted). The session-storage snapshot of the security-headers listener
 * must hold the 127.0.0.1 documents (the control) and must not hold the localhost URL. If it does, round 9 adds the origin
 * check in onHeaders (background/security-headers.js) and the copy stays as it is.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from './lib-granted.mjs';
import { profile } from './lib-paths.mjs';
import { recycle } from './lib-trash.mjs';

const EXT = grantedExtension({ label: 'council-1010-origin' });
// Narrow the grant: 127.0.0.1 only, on every port.
const mfPath = path.join(EXT, 'manifest.json');
const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
mf.host_permissions = ['http://127.0.0.1/*'];
fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
const PROFILE = profile('.council-1010-origin-profile');

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};
const until = async (fn, ms = 15000, step = 250) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, step));
  }
};

let port = 0;
const served = [];
const server = http.createServer((req, res) => {
  served.push(`${(req.headers.host || '').split(':')[0]}${req.url}`);
  const csp = { 'content-security-policy': "default-src 'self'; frame-src http://127.0.0.1:* http://localhost:*; script-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' };
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...csp });
  if (req.url.startsWith('/parent')) {
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>parent</title></head><body><h1>parent</h1>
<iframe id="same" src="http://127.0.0.1:${port}/same-child"></iframe><iframe id="other" src="http://localhost:${port}/localhost-child"></iframe></body></html>`);
  } else res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>child</title></head><body><p>${req.url}</p></body></html>`);
});
// Dual stack when the host allows it, so "localhost" reaches this server whether it resolves to ::1 or 127.0.0.1.
await new Promise((resolve) => { server.once('error', () => server.listen(0, '127.0.0.1', resolve)); server.listen(0, '::', resolve); });
port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

recycle(PROFILE);
purgeWorkerCache(PROFILE);
const ctx = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT));
const top = await keepOnTop(ctx);
console.log('origin gate falsifier, real Chrome, grant = http://127.0.0.1/* only');
try {
  const worker0 = await freshWorker(ctx);
  const id = new URL(worker0.url()).host;
  await seedConsent(worker0);
  await awaitSiteScripts(worker0).catch(() => {});

  const page = await ctx.newPage();
  await page.goto(`${origin}/start`, { waitUntil: 'domcontentloaded' });
  const ctl = await ctx.newPage();
  await ctl.goto(`chrome-extension://${id}/welcome/welcome.html`);
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const tab = await ctl.evaluate(async (o) => { const [t] = await chrome.tabs.query({ url: o + '/*' }); return { id: t.id, windowId: t.windowId }; }, origin);

  const held = await ctl.evaluate(() => chrome.permissions.getAll());
  check(JSON.stringify(held.origins) === JSON.stringify(['http://127.0.0.1/*']), 'the only host grant is http://127.0.0.1/*', JSON.stringify(held.origins));
  const armed = await call({ type: 'UQA_ARM', windowId: tab.windowId });
  check(armed?.ok === true, 'the window is armed', JSON.stringify(armed));
  const start = await call({ type: 'UQA_START', charter: 'Origin gate falsifier', tabId: tab.id, startUrl: `${origin}/start` });
  check(start?.ok === true, 'a session starts', JSON.stringify(start));
  check((await until(() => worker0.evaluate(() => chrome.webRequest.onHeadersReceived.hasListeners()))) === true, 'the security-headers listener is registered while armed');

  await page.goto(`${origin}/parent`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await new Promise((r) => setTimeout(r, 4500)); // the seen map is saved after a pause (SAVE_MS)
  const worker = ctx.serviceWorkers().find((w) => w.url().includes(id)) || worker0;
  const urls = (await worker.evaluate(async () => (await chrome.storage.session.get('uqa.secHeaders.seen'))['uqa.secHeaders.seen'] || [])).map(([, v]) => v.url);
  check(urls.some((u) => u.endsWith('/parent')), 'control: the granted 127.0.0.1 parent document has its headers row', JSON.stringify(urls));
  check(urls.some((u) => u.endsWith('/same-child')), 'control: the granted 127.0.0.1 frame has its headers row', JSON.stringify(urls));
  check(served.includes('localhost/localhost-child'), 'control: the localhost frame really loaded (the server saw Host: localhost), so its absence means something', JSON.stringify(served));
  const leaked = urls.filter((u) => /\/\/localhost[:/]/.test(u));
  console.log(`  FALSIFIER r8-14-1 (D-1010-170): the localhost frame ${leaked.length ? 'LEAKED into' : 'is absent from'} the snapshot (${JSON.stringify(urls.map((u) => u.replace(/:\d+/, ':PORT')))})`);
  check(leaked.length === 0, 'r8-14-1: the snapshot holds no localhost URL (webRequest stops at the granted origin)', JSON.stringify(leaked));
} catch (err) {
  check(false, 'the origin-gate run reached the end', err.stack || err.message);
} finally {
  await top?.release?.().catch?.(() => {});
  await ctx.close().catch(() => {});
  server.close();
  recycle(PROFILE);
  recycle(EXT);
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
