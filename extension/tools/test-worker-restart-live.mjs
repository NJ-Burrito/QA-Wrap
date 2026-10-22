/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * A killed service worker comes back with the session intact, whatever wakes it (test pipeline P5, 12 Oct 2026).
 *
 *   node tools/test-worker-restart-live.mjs
 *
 * `test-worker-restart.mjs` stops workers with `ServiceWorker.stopAllWorkers` and checks the headers listener, the
 * burst-loss limit and the retention alarm. This one is the lifecycle itself, with the kill Chrome would do when a
 * worker idles out - `Target.closeTarget` on the extension's worker target over a browser CDP session (rehearsal R3:
 * a worker Playwright is attached to never idles out by itself, so an explicit kill is the only honest restart) - and
 * three different things waking the next one:
 *
 *   message     a page sends `UQA_GET_STATE`
 *   alarm       a `chrome.alarms` alarm set before the kill fires, with no page talking to the worker
 *   navigation  a page commits a navigation (`webNavigation.onCommitted` is registered at the top of the worker)
 *
 * After every wake the same facts must hold, and they must come from storage, not memory: the in-memory marker the
 * old worker held is gone (a fresh isolate, not a resumed one), `chrome.storage.local` and `.session` still hold their
 * probe values, `UQA_GET_STATE` still says `recording` for the same session id with no fewer events, and the toolbar
 * badge is not blank while the session runs.
 *
 * Revival is detected by polling the browser's target list, never Playwright's `serviceworker` event (it did not fire
 * for a revived worker in R3). Headless-new on the bundled Chrome for Testing; loopback only; a temp profile; the
 * engine build id is on every row.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { grantedExtension, seedConsent, awaitSiteScripts } from './lib-granted.mjs';
import { engineId, killWorkers, plannedEngine, poll, waitForWorker, workerTargets } from './lib-worker-live.mjs';

import { TRASH } from './lib-trash.mjs';
const PLANNED = plannedEngine();
let ENGINE = `engine=${PLANNED.tag}`;
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  [${ENGINE}] ${name}`); }
  else { failures.push(name); console.log(`  FAIL  [${ENGINE}] ${name}${detail ? `\n        ${detail}` : ''}`); }
};
const recycle = (p) => {
  if (!p || !fs.existsSync(p)) return;
  try { execFileSync('python', [TRASH, p], { stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } }); } catch { console.log(`note: could not recycle ${p}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-restart-live-'));
const ext = grantedExtension({ label: 'p5-restart-live' });
let browserPid = null;
let ctx = null;
const watchdog = setTimeout(() => {
  if (browserPid) spawnSync('taskkill', ['/PID', String(browserPid), '/T', '/F']);
  console.log('WATCHDOG: restart-live exceeded 150 s; killed the browser this run started');
  process.exit(9);
}, 150000);
watchdog.unref();

const html = (label) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${label}</title></head><body><h1>${label}</h1><script>fetch('/api/${label}').catch(()=>{});</script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"boom"}'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html(req.url.replace(/\W/g, '') || 'home'));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

try {
  console.log('worker restart (live): kill by CDP, wake by message / alarm / navigation, state from storage');
  ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--no-default-browser-check'],
  });
  const cdp = await ctx.browser().newBrowserCDPSession();
  try { browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find((p) => p.type === 'browser')?.id ?? null; } catch { /* watchdog has no pid */ }
  const eng = await engineId(ctx, { headless: 'new', exe: chromium.executablePath() });
  console.log(`  engine: ${eng.label}`);
  check(eng.tag === PLANNED.tag, `the running build is the one Playwright's browsers.json pins (${eng.tag})`, `planned ${PLANNED.tag}`);
  ENGINE = `engine=${eng.tag}`;

  let worker = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  await awaitSiteScripts(worker);

  const page = await ctx.newPage();
  await page.goto(`${origin}/start`, { waitUntil: 'domcontentloaded' });
  const ctl = await ctx.newPage();
  await ctl.goto(`chrome-extension://${id}/welcome/welcome.html`);
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, (resp) => r(resp ?? { lastError: chrome.runtime.lastError?.message || null }))), m);
  const tab = await ctl.evaluate(async (o) => { const [t] = await chrome.tabs.query({ url: `${o}/*` }); return { id: t.id, windowId: t.windowId }; }, origin);

  const armed = await call({ type: 'UQA_ARM', windowId: tab.windowId });
  check(armed?.ok === true, 'the window is armed', JSON.stringify(armed));
  const start = await call({ type: 'UQA_START', charter: 'Worker restart (live)', tabId: tab.id, startUrl: `${origin}/start` });
  check(start?.ok === true, 'a session starts', JSON.stringify(start));
  const sessionId = start?.result?.id;
  await page.reload({ waitUntil: 'domcontentloaded' });
  const state = async () => (await call({ type: 'UQA_GET_STATE', tabId: tab.id }))?.result;
  const before = (await poll(async () => { const s = await state(); return s?.eventCount > 0 ? s : null; }, 15000, 250)).value;
  check(!!before, 'events are captured before the first kill', JSON.stringify(before && { n: before.eventCount }));
  // The fixture page makes one failing request; wait for it to be a recorded finding, so the badge has settled on its count
  // before the first kill (a finding arriving later would change the badge for a reason that has nothing to do with restarts).
  const settled = (await poll(async () => { const s = await state(); return s?.failureCount >= 1 ? s : null; }, 15000, 250)).value;
  check(!!settled, 'the fixture failing request is recorded as a finding before the first kill', JSON.stringify(settled && { n: settled.eventCount, failures: settled.failureCount }));

  // Memory vs storage: a marker only the live isolate holds, and two probes only storage holds.
  const nonce = `p5-${Date.now().toString(36)}`;
  const currentWorker = () => ctx.serviceWorkers().find((w) => w.url().includes(id)) || null;
  await worker.evaluate(async (n) => {
    globalThis.__p5Memory = n;
    await chrome.storage.local.set({ p5ProbeLocal: n });
    await chrome.storage.session.set({ p5ProbeSession: n });
  }, nonce);

  // The toolbar badge belongs to the browser, not the worker; a live session reads at least a dot. Settle on the value
  // the session shows before the first kill (a finding turns the dot into a count), then expect that value after each wake.
  const badgeNow = (w) => w.evaluate(() => chrome.action.getBadgeText({}));
  const badgeBefore = (await poll(async () => (await badgeNow(currentWorker())) || null, 10000, 200)).value;
  check(!!badgeBefore, `the toolbar badge is not blank before the first kill (${JSON.stringify(badgeBefore)})`);
  let lastCount = settled?.eventCount ?? before?.eventCount ?? 0;
  const afterWake = async (label, waited) => {
    check(waited < 12000, `${label}: a new worker target exists ${waited} ms after the kill`);
    const w = (await poll(async () => currentWorker(), 8000, 100)).value;
    check(!!w, `${label}: Playwright sees the new worker`);
    if (!w) return;
    const probe = await w.evaluate(async () => ({
      memory: globalThis.__p5Memory ?? null,
      local: (await chrome.storage.local.get('p5ProbeLocal')).p5ProbeLocal ?? null,
      session: (await chrome.storage.session.get('p5ProbeSession')).p5ProbeSession ?? null,
    }));
    check(probe.memory === null, `${label}: the in-memory marker is gone (a fresh worker, not a resumed one)`, JSON.stringify(probe));
    check(probe.local === nonce && probe.session === nonce, `${label}: storage.local and storage.session probes survived`, JSON.stringify(probe));
    const s = (await poll(async () => { const x = await state(); return x?.recording === true ? x : null; }, 8000, 200)).value;
    check(!!s && s.session?.id === sessionId, `${label}: UQA_GET_STATE still says recording the same session (${sessionId})`, JSON.stringify(s && { rec: s.recording, id: s.session?.id }));
    check((s?.eventCount ?? 0) >= lastCount, `${label}: no stored event was lost (${s?.eventCount} >= ${lastCount})`);
    lastCount = Math.max(lastCount, s?.eventCount ?? 0);
    // Not blank, not "the same string": the wake repaints from the session, so the dot may become the problem count (a navigation's repaint reads "2").
    const b = await poll(async () => ((await badgeNow(w)) ? true : null), 8000, 200);
    check(!!b.value, `${label}: the toolbar badge is not blank after the wake (was ${JSON.stringify(badgeBefore)})`, b.error || `read ${JSON.stringify(await badgeNow(w).catch((e) => String(e.message)))}`);
    await w.evaluate((n) => { globalThis.__p5Memory = n; }, nonce); // the next round again expects it to vanish
  };

  const kill = async (label) => {
    const k = await killWorkers(cdp, id);
    check(k.stopped >= 1 && k.gone, `${label}: Target.closeTarget stops the worker (${k.stopped} target, gone after ${k.waited} ms, ${k.rounds} close${k.rounds === 1 ? '' : 's'})`);
    check((await workerTargets(cdp, id)).length === 0, `${label}: no worker target is alive after the kill (nothing respawned it by itself)`);
    return k;
  };

  // 1. woken by a message
  await kill('message');
  const t1 = Date.now();
  const reply = await call({ type: 'UQA_GET_STATE', tabId: tab.id });
  check(!!reply?.ok || reply?.result !== undefined, `message: a page message to the dead worker is answered (${Date.now() - t1} ms)`, JSON.stringify(reply).slice(0, 160));
  await afterWake('message', (await waitForWorker(cdp, id, 8000)).waited);

  // 2. woken by an alarm, with no page talking to the worker. The recorded page and the session have their own reasons
  // to wake the worker now and then; an attempt where it came back before the alarm was due did not test the alarm, so it
  // is counted, named and repeated (at most 3 times) rather than passed or failed.
  let aWaited = 0;
  let early = 0;
  let revived = { target: null };
  for (let attempt = 1; attempt <= 3 && !(aWaited >= 1000 && revived.target); attempt++) {
    if (!currentWorker()) { await call({ type: 'UQA_GET_STATE', tabId: tab.id }); await waitForWorker(cdp, id, 8000); await poll(async () => currentWorker(), 5000, 100); }
    await currentWorker().evaluate(() => chrome.alarms.create('p5-wake', { when: Date.now() + 2500 }));
    await kill(`alarm (attempt ${attempt})`);
    const tAlarm = Date.now();
    revived = await waitForWorker(cdp, id, 15000);
    aWaited = Date.now() - tAlarm;
    if (aWaited < 1000) { early++; console.log(`  note: attempt ${attempt}: the worker was woken after ${aWaited} ms by something other than the alarm; repeating`); }
  }
  check(!!revived.target, `alarm: a worker is back with no message sent (${aWaited} ms after the kill, ${early} early wake${early === 1 ? '' : 's'} by other events)`);
  check(aWaited >= 1000, `alarm: it came back because the alarm fired, not at once (waited ${aWaited} ms of a 2500 ms alarm)`);
  await afterWake('alarm', aWaited);
  // The worker can boot a few ms before Chrome removes a fired one-shot alarm, so wait for it to go.
  const gone = await poll(async () => (await currentWorker()?.evaluate(async () => ((await chrome.alarms.get('p5-wake')) ? null : true))) || null, 5000, 100);
  check(!!gone.value, `alarm: the one-shot alarm has fired and is gone (${gone.waited} ms after the worker was back)`);

  // 3. woken by a navigation
  await kill('navigation');
  const tNav = Date.now();
  await page.goto(`${origin}/after-kill`, { waitUntil: 'domcontentloaded' });
  const navWake = await waitForWorker(cdp, id, 12000);
  check(!!navWake.target, `navigation: a committed navigation wakes the worker (${Date.now() - tNav} ms after the kill)`);
  await afterWake('navigation', Date.now() - tNav);

  // 4. an in-flight call into a worker that is killed rejects; it does not hang or resolve
  const w4 = currentWorker();
  const pending = w4.evaluate(() => new Promise((r) => setTimeout(() => r('late'), 15000))).then((v) => `resolved ${v}`, (e) => `rejected: ${String(e.message).split('\n')[0]}`);
  await new Promise((r) => setTimeout(r, 300));
  await kill('in-flight');
  const verdict = await Promise.race([pending, new Promise((r) => setTimeout(() => r('hung'), 8000))]);
  console.log(`  in-flight worker.evaluate on kill -> ${verdict}`);
  check(String(verdict).startsWith('rejected'), 'in-flight: a call pending in the killed worker rejects (it neither hangs nor resolves)', String(verdict));
  await call({ type: 'UQA_GET_STATE', tabId: tab.id }); // wake it for the rounds below
  await waitForWorker(cdp, id, 8000);

  // 5. three kills in a row: the session id never changes and the stored events only grow
  for (let i = 1; i <= 3; i++) {
    await kill(`repeat ${i}`);
    await call({ type: 'UQA_GET_STATE', tabId: tab.id });
    const wk = await waitForWorker(cdp, id, 8000);
    const s = (await poll(async () => { const x = await state(); return x?.recording === true ? x : null; }, 8000, 200)).value;
    check(!!wk.target && s?.session?.id === sessionId && (s?.eventCount ?? 0) >= lastCount, `repeat ${i}: back in ${wk.waited} ms, same session, events ${s?.eventCount} >= ${lastCount}`, JSON.stringify(s && { id: s.session?.id, n: s.eventCount }));
    lastCount = Math.max(lastCount, s?.eventCount ?? 0);
  }

  // 6. the session ends normally after all of that, and its events are on disk
  const stopped = await call({ type: 'UQA_STOP', tabId: tab.id });
  check(stopped?.ok === true, 'the session stops normally after four restarts', JSON.stringify(stopped).slice(0, 160));
  const timeline = await call({ type: 'UQA_GET_TIMELINE', sessionId });
  const stored = timeline?.result?.events?.length ?? 0;
  const first = settled?.eventCount ?? before?.eventCount ?? 0;
  check(stored >= first, `the stored timeline holds the events from before the first kill (${stored} >= ${first})`);
} catch (err) {
  failures.push(`aborted: ${String(err.message || err).split('\n')[0]}`);
  console.log(`  FAIL  [${ENGINE}] aborted: ${String(err.stack || err).split('\n').slice(0, 4).join(' | ')}`);
} finally {
  if (ctx) await ctx.close().catch(() => {});
  server.close();
  clearTimeout(watchdog);
  recycle(tmp);
  recycle(ext);
}

console.log(`\n${passed} passed, ${failures.length} failed  [${ENGINE}]`);
process.exit(failures.length ? 1 : 0);
