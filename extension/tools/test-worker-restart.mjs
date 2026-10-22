/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * A sleeping worker must not lose the session (r2-01-2, D-1010-14). Headed.
 *
 *   node tools/test-worker-restart.mjs
 *
 * Real Chrome, the unpacked extension (the shipping copy with the site grant, `lib-granted.mjs`),
 * a fresh profile tagged council-1010 and removed through safe-delete on exit. A session is started,
 * then the browser stops every service worker (`ServiceWorker.stopAllWorkers` over CDP) and the next
 * page event wakes a new one. After the wake:
 *   1. capture continues (the event count grows),
 *   2. the toolbar badge still reads the problems count,
 *   3. the armed window is still armed,
 *   4. UQA_GET_STATE still answers `recording: true` for the same session,
 *   5. the security-headers listener is registered again (D-1010-01: registered once the grants are read),
 *   6. a document loaded after the wake has its headers row,
 *   7. a second armed window keeps its own session recording across the same restart (r7-06-1, r7-06-4 a),
 *   8. a burst of 40 requests followed at once by a stop loses at most one batch of 32 events (r5-06-4, crash).
 * The FIRST document loaded while the worker was down is the D-1010-01 falsifier. If its row is missed
 * the limit is pinned and printed (the accepted cost of not registering a listener at load), not failed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from './lib-granted.mjs';
import { profile } from './lib-paths.mjs';

import { TRASH } from './lib-trash.mjs';
const EXT = grantedExtension({ label: 'council-1010-restart' });
const PROFILE = profile('.council-1010-restart-profile');
const recycle = (p) => {
  if (!fs.existsSync(p)) return;
  try { execFileSync('python', [TRASH, p], { stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } }); } catch { console.log(`note: could not recycle ${p}`); }
};

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};
// PENDING <lane>: a check whose code another lane has not landed yet. It prints PENDING and stays green, unless QAW_STRICT_PENDING=1 (the verifier's run).
const pendings = [];
const pending = (lane, ok, name, detail = '') => {
  if (ok) return check(true, name);
  if (process.env.QAW_STRICT_PENDING === '1') return check(false, name, detail);
  pendings.push(`${name} (pending ${lane})`);
  console.log(`  PENDING ${lane}  ${name}${detail ? `\n        ${detail}` : ''}`);
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

// A page that makes one failing request as it loads, so every navigation produces a recorded event and wakes the worker.
const html = (label) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${label}</title></head><body><h1>${label}</h1><script>fetch('/api/${label}').catch(()=>{});</script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"boom"}'); return; }
    const csp = req.url.startsWith('/csp') ? { 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'" } : {};
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', ...csp });
  res.end(html(req.url.replace(/\W/g, '') || 'home'));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

recycle(PROFILE);
purgeWorkerCache(PROFILE);
const ctx = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT));
const top = await keepOnTop(ctx);
console.log('worker restart, real Chrome');
try {
  const worker0 = await freshWorker(ctx);
  const id = new URL(worker0.url()).host;
  await seedConsent(worker0);
  await awaitSiteScripts(worker0);

  const page = await ctx.newPage();
  await page.goto(`${origin}/start`, { waitUntil: 'domcontentloaded' });
  const ctl = await ctx.newPage();
  await ctl.goto(`chrome-extension://${id}/welcome/welcome.html`);
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const tab = await ctl.evaluate(async (o) => { const [t] = await chrome.tabs.query({ url: o + '/*' }); return { id: t.id, windowId: t.windowId }; }, origin);

  const armed0 = await call({ type: 'UQA_ARM', windowId: tab.windowId });
  check(armed0?.ok === true, 'the window is armed', JSON.stringify(armed0));
  const start = await call({ type: 'UQA_START', charter: 'Worker restart', tabId: tab.id, startUrl: `${origin}/start` });
  check(start?.ok === true, 'a session starts', JSON.stringify(start));
  const sessionId = start?.result?.id;
  await page.reload({ waitUntil: 'domcontentloaded' });
  const state = async () => (await call({ type: 'UQA_GET_STATE', tabId: tab.id }))?.result;
  const before = await until(async () => { const s = await state(); return s?.eventCount > 0 ? s : null; });
  check(!!before, 'events are captured before the stop', JSON.stringify(before && { n: before.eventCount }));
  const badge0 = await until(async () => (await worker0.evaluate(() => chrome.action.getBadgeText({}))) || null);
  check(!!badge0, 'the badge shows the problems count before the stop', String(badge0));
  const hasListener = (w) => w.evaluate(() => chrome.webRequest.onHeadersReceived.hasListeners());
  check((await until(() => hasListener(worker0))) === true, 'the security-headers listener is registered while armed');

  // r7-06-1 / r7-06-4 (a): a second armed window with its own live session. Placed next to the first one (the
  // test window is already on the secondary monitor), never focused, closed with the context.
  const win2 = await ctl.evaluate(async (o) => {
    const cur = await chrome.windows.getCurrent();
    const w = await chrome.windows.create({ url: o + '/win2', left: (cur.left || 0) + 40, top: (cur.top || 0) + 40, width: Math.min(cur.width || 900, 900), height: Math.min(cur.height || 700, 700), focused: false });
    return { windowId: w.id, tabId: w.tabs[0].id };
  }, origin);
  const armed2 = await call({ type: 'UQA_ARM', windowId: win2.windowId });
  check(armed2?.ok === true, 'a second window is armed', JSON.stringify(armed2));
  const start2 = await call({ type: 'UQA_START', charter: 'Worker restart, second window', tabId: win2.tabId, startUrl: `${origin}/win2` });
  check(start2?.ok === true && start2?.result?.id !== sessionId, 'a second session starts in the second window', JSON.stringify(start2));
  const session2 = start2?.result?.id;
  const page2 = ctx.pages().find((pg) => pg.url().startsWith(`${origin}/win2`));
  if (page2) await page2.reload({ waitUntil: 'domcontentloaded' });
  const state2 = async () => (await call({ type: 'UQA_GET_STATE', tabId: win2.tabId }))?.result;
  const before2 = await until(async () => { const s = await state2(); return s?.eventCount > 0 ? s : null; });
  check(!!before2, 'events are captured in the second window before the stop', JSON.stringify(before2 && { n: before2.eventCount }));

  await worker0.evaluate(() => { globalThis.__councilMarker = 1; }); // a new worker has no such global: proof of a real restart
  // Stop every service worker, the way the browser does when it is idle (CDP, no real mouse).
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  // The handle may linger in Playwright's list for a moment; what matters is that the old context is gone (checked after the wake).
  await until(async () => (ctx.serviceWorkers().length === 0 ? true : null), 5000);

  // The D-1010-01 falsifier: a document loaded while no worker is running.
  await page.goto(`${origin}/first`, { waitUntil: 'domcontentloaded' });
  const w1 = await until(async () => ctx.serviceWorkers().find((w) => w.url().includes(id)) || null, 15000);
  check(!!w1, 'the next page event woke a new worker');
  const worker1 = w1 || (await freshWorker(ctx));
  const marker = await until(async () => ({ v: await worker1.evaluate(() => globalThis.__councilMarker ?? null) }), 5000);
  check(marker?.v === null, 'the worker really restarted (its globals are gone)', JSON.stringify(marker));
  const after = await until(async () => { const s = await state(); return s?.recording ? s : null; });
  check(after?.recording === true && after?.session?.id === sessionId, 'UQA_GET_STATE: still recording the same session', JSON.stringify(after && { rec: after.recording, id: after.session?.id }));
  const grew = await until(async () => { const s = await state(); return s?.eventCount > before.eventCount ? s : null; });
  check(!!grew, 'capture continues: the event count grew after the wake', JSON.stringify({ before: before?.eventCount, after: grew?.eventCount }));
  const after2 = await until(async () => { const s = await state2(); return s?.recording ? s : null; });
  check(after2?.recording === true && after2?.session?.id === session2, 'the second window: still recording its own session (r7-06-1)', JSON.stringify(after2 && { rec: after2.recording, id: after2.session?.id, want: session2 }));
  const armed2After = await call({ type: 'UQA_ARMED', windowId: win2.windowId });
  check(armed2After?.result?.armed === true, 'the second window is still armed after the restart', JSON.stringify(armed2After?.result));
  const firstStill = await state();
  check(firstStill?.recording === true && firstStill?.session?.id === sessionId, 'and the first window is not disturbed by the second one', JSON.stringify(firstStill && { rec: firstStill.recording, id: firstStill.session?.id }));
  if (page2) {
    await page2.goto(`${origin}/win2b`, { waitUntil: 'domcontentloaded' });
    const grew2 = await until(async () => { const s = await state2(); return s?.eventCount > before2.eventCount ? s : null; });
    check(!!grew2, 'the second window: capture continues after the wake', JSON.stringify({ before: before2?.eventCount, after: grew2?.eventCount }));
  }
  const badge1 = await until(async () => (await worker1.evaluate(() => chrome.action.getBadgeText({}))) || null);
  check(!!badge1, 'the badge still shows a count after the wake', String(badge1));
  const armedAfter = await call({ type: 'UQA_ARMED', windowId: tab.windowId });
  check(armedAfter?.result?.armed === true, 'the armed window survived the restart', JSON.stringify(armedAfter?.result));
  check((await until(() => hasListener(worker1))) === true, 'the security-headers listener is registered again');

  await page.goto(`${origin}/second`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 4500)); // the seen map is saved after a pause (SAVE_MS)
  const urls = (await worker1.evaluate(async () => (await chrome.storage.session.get('uqa.secHeaders.seen'))['uqa.secHeaders.seen'] || [])).map(([, v]) => v.url);
  check(urls.some((u) => u.endsWith('/second')), 'a document loaded after the wake has its headers row', JSON.stringify(urls));
  const firstSeen = urls.some((u) => u.endsWith('/first'));
  // Not a failure either way: D-1010-01 trades the first post-wake row for no listener at load (Chrome flags one without a host origin).
  check(true, `D-1010-01 limit pinned: the first document loaded while the worker was down ${firstSeen ? 'has its headers row' : 'has NO headers row (accepted cost)'}`);

  // r5-06-4 (crash): a burst of requests, then the worker is stopped at once, mid-batch. "The tail is never short"
  // (write-queue.js) means at most one batch is lost, so the stored count must reach emitted - MAX_BATCH.
  const stored = async () => (await call({ type: 'UQA_GET_TIMELINE', sessionId }))?.result?.events?.length ?? 0;
  const settled = async () => { let last = -1; for (let i = 0; i < 40; i++) { const n = await stored(); if (n === last) return n; last = n; await new Promise((r) => setTimeout(r, 400)); } return last; };
  const BURST = 40;
  // Notes, not requests: the recorder coalesces identical failing requests (40 fetches stored 5 events), a note is one event each.
  // The second window's session is stopped and its window closed first, so the one live session is unambiguous.
  await call({ type: 'UQA_STOP', tabId: win2.tabId });
  await ctl.evaluate((wid) => chrome.windows.remove(wid).catch(() => {}), win2.windowId);
  const fire = (tag) => Promise.all(Array.from({ length: BURST }, (_, i) => call({ type: 'UQA_NOTE', text: `${tag} ${i}`, tag }))).then((rs) => rs.filter((r) => r?.ok !== false).length);
  const n0 = await settled();
  const sentControl = await fire('control');
  const nBase = await settled();
  const control = nBase - n0;
  check(sentControl === BURST && control === BURST, `crash case: the control burst (nothing killed) stores all ${BURST} notes`, JSON.stringify({ sentControl, control }));
  const sentBurst = await fire('burst');
  const cdp2 = await ctx.newCDPSession(page);
  await cdp2.send('ServiceWorker.enable');
  await cdp2.send('ServiceWorker.stopAllWorkers');
  await until(async () => (ctx.serviceWorkers().length === 0 ? true : null), 5000);
  await page.goto(`${origin}/third`, { waitUntil: 'domcontentloaded' });
  const w2 = await until(async () => ctx.serviceWorkers().find((w) => w.url().includes(id)) || null, 15000);
  check(!!w2, 'crash case: the next page event woke a new worker');
  const nAfter = await settled();
  const want = nBase + sentBurst - 32;
  check(nAfter >= want, `crash case: the stored event count reaches burst - 32 after the kill (base ${nBase}, burst ${sentBurst}, after ${nAfter})`, JSON.stringify({ nBase, sentBurst, nAfter, want }));
  const stateAfter = await state();
  check(stateAfter?.recording === true && stateAfter?.session?.id === sessionId, 'crash case: the session is still the same live recording', JSON.stringify(stateAfter && { rec: stateAfter.recording, id: stateAfter.session?.id }));
  // r8-01-1 (D-1010-182, L2 code): every worker start re-creates the retention alarm. Clear every alarm, stop the worker, wake it,
  // and expect the alarm back. Until L2's code lands this prints PENDING L2 (QAW_STRICT_PENDING=1 makes it a FAIL).
  const stopWorkers = async () => {
    const c = await ctx.newCDPSession(page);
    await c.send('ServiceWorker.enable');
    await c.send('ServiceWorker.stopAllWorkers');
    await until(async () => (ctx.serviceWorkers().length === 0 ? true : null), 5000);
    await c.detach().catch(() => {});
  };
  const alarmNames = () => ctl.evaluate(async () => (await chrome.alarms.getAll()).map((a) => a.name)).catch(() => null);
  const cleared = await ctl.evaluate(async () => { await chrome.alarms.clearAll(); return (await chrome.alarms.getAll()).length; });
  check(cleared === 0, 'r8-01-1: every alarm is cleared before the stop', String(cleared));
  await stopWorkers();
  await call({ type: 'UQA_GET_STATE', tabId: tab.id }); // a message wakes the worker
  const retention = await until(async () => ((await alarmNames()) || []).includes('retention') ? true : null, 10000);
  pending('L2', !!retention, 'r8-01-1: the retention alarm is back after a worker restart', JSON.stringify(await alarmNames()));

  // r8-01-2 (D-1010-01 falsifier): arm a window, stop the worker, load a CSP document while no worker runs, wake the worker, read the
  // snapshot. "seen" = the headers listener caught a document that loaded while the worker was down; "missed" = the accepted cost.
  await stopWorkers();
  await page.goto(`${origin}/csp-down`, { waitUntil: 'domcontentloaded' });
  await call({ type: 'UQA_GET_STATE', tabId: tab.id });
  await until(async () => ctx.serviceWorkers().find((w) => w.url().includes(id)) || null, 10000);
  await new Promise((r) => setTimeout(r, 4500)); // the seen map is saved after a pause (SAVE_MS)
  const cspWorker = ctx.serviceWorkers().find((w) => w.url().includes(id)) || (await freshWorker(ctx));
  const cspRows = await cspWorker.evaluate(async () => ((await chrome.storage.session.get('uqa.secHeaders.seen'))['uqa.secHeaders.seen'] || []).map(([, v]) => ({ url: v.url, csp: Object.keys(v.headers || {}).filter((k) => /content-security-policy/i.test(k)).length })));
  const cspSeen = cspRows.some((r) => r.url.endsWith('/csp-down') && r.csp > 0);
  console.log(`  FALSIFIER r8-01-2 (D-1010-01): a CSP document loaded while the worker was down was ${cspSeen ? 'SEEN' : 'MISSED'} in the snapshot (${JSON.stringify(cspRows.map((r) => r.url.replace(origin, '')))})`);
  check(true, `r8-01-2: falsifier recorded, ${cspSeen ? 'seen' : 'missed (round 9 states the limit in the copy)'}`);
  await page.goto(`${origin}/csp-up`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 4500));
  const upRows = await cspWorker.evaluate(async () => ((await chrome.storage.session.get('uqa.secHeaders.seen'))['uqa.secHeaders.seen'] || []).map(([, v]) => ({ url: v.url, csp: Object.keys(v.headers || {}).filter((k) => /content-security-policy/i.test(k)).length })));
  check(upRows.some((r) => r.url.endsWith('/csp-up') && r.csp > 0), 'r8-01-2 control: a CSP document loaded after the wake has its content-security-policy row', JSON.stringify(upRows));
  // NOT covered here, by design: the clip case (offscreen document closed mid-recording) needs a tab-capture user gesture,
  // and a browser-level hang cannot be produced from CDP. Reported to the director as open (r5-06-4, second half).
} catch (err) {
  check(false, 'the worker-restart run reached the end', err.stack || err.message);
} finally {
  await top?.release?.().catch?.(() => {});
  await ctx.close().catch(() => {});
  server.close();
  recycle(PROFILE);
  recycle(EXT);
}
for (const p of pendings) console.log('pending: ' + p);
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
