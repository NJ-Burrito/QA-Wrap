/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt hard trials, the ONE calibration run (DESIGN-bug-hunt-hard.md sections 11 and 12). BY HAND: the real extension, the real
 * game on http://localhost:4173/, one headed browser on the SECONDARY monitor, Playwright only (no OS mouse), a fresh profile.
 *
 *   node tools/test-game-trial-live.mjs --by-hand        (from extension/, PYTHONUTF8=1; or QAW_BY_HAND=1)
 *
 * Without --by-hand it prints SKIPPED and exits 2. With it, the owner presses Allow once (one bubble) and, at the shortcut step,
 * Alt+Shift+Q once. The run measures and prints (run once; it is a calibration, the owner reads the lines):
 *   LAG <signal> n=<k> p50=<ms> p99=<ms>    press-to-page latency of qawNotes, qawShots, qawState (start, stop), qawBuffer
 *   RESTART <ms>                            an early Stop kills the stage: death to the next room 1, door open
 *   U1 .. U10                               the answers to the unknowns of section 12, one line each
 * It FAILS when the p99 of a SLOW signal (notes, shots) is above LAG_SLOW (3.6 s) or the restart is above 1.0 s (the constants
 * in trial.js are then re-pinned from these lines). At the end rememberedSites, autoStartSites, autoShotSites and bufferSites are
 * empty again (the buffer switch this run turned on is turned off).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ok, skipNotEnforced, finish } from './lib-assert.mjs';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker } from './lib-fresh.mjs';
import { seedConsent } from './lib-granted.mjs';
import { shipping, copyShipping } from './lib-ship.mjs';
import { recycle } from './lib-trash.mjs';
import { EXT } from './lib-paths.mjs';
import { LAG_SLOW, missingT1 } from './lib-game-trial.mjs';

const SUITE = 'test-game-trial-live';
const GAME = path.join(EXT, 'game');
const ORIGIN = 'http://localhost:4173';
const byHand = process.argv.includes('--by-hand') || process.env.QAW_BY_HAND === '1';
if (!byHand) {
  skipNotEnforced({ rule: 'game-trial', what: 'the calibration run with the real extension', why: 'by hand only: the owner presses Allow and Alt+Shift+Q. Run: node tools/test-game-trial-live.mjs --by-hand' });
  finish(SUITE, { skipped: 1 });
}
if (missingT1().length) {
  skipNotEnforced({ rule: 'game-trial', what: 'the calibration run', why: `game/${missingT1().join(', game/')} have not landed` });
  finish(SUITE, { skipped: 1 });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 100) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };
const OBSERVE = `window.__qawLog = []; const rec = () => { const d = document.documentElement.dataset; window.__qawLog.push({ at: performance.timeOrigin + performance.now(), state: d.qawState || '', notes: +d.qawNotes || 0, shots: +d.qawShots || 0, shortcut: +d.qawShortcut || 0, expected: +d.qawExpected || 0, marks: +d.qawMarks || 0, buffer: +d.qawBuffer || 0 }); };
new MutationObserver(rec).observe(document.documentElement, { attributes: true }); document.addEventListener('qaw:state', rec);`;

const lags = { notes: [], shots: [], start: [], stop: [], buffer: [] };
const answers = {};
let server; let context; let profile; let ext; let topmost;
try {
  const { createGameServer } = await import(pathToFileURL(path.join(GAME, 'server.mjs')).href);
  server = createGameServer({ port: 4173 });
  const bound = await new Promise((res) => { server.once('error', () => res(false)); server.listen(4173, '127.0.0.1', () => res(true)); });
  if (!bound) { console.log('ENV-BLOCKED: port 4173 is in use (is the game already running?); stop it and run again'); process.exit(2); }

  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-trial-live-'));
  ext = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-trial-ext-'));
  for (const e of shipping(fs.readdirSync(EXT))) copyShipping(path.join(EXT, e), path.join(ext, e));
  context = await chromium.launchPersistentContext(profile, launchOptions(ext, { width: 1360, height: 900, headed: true }));
  topmost = await keepOnTop(context);
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);

  const game = await context.newPage();
  await game.addInitScript(OBSERVE);
  const errors = [];
  game.on('pageerror', (e) => errors.push(e.message));
  await game.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 348, height: 600 });
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
  await popup.evaluate(() => { window.close = () => {}; window.__clip = []; navigator.clipboard.writeText = async (s) => { window.__clip.push(String(s)); }; });
  const storage = () => popup.evaluate(() => chrome.storage.local.get(['rememberedSites', 'autoStartSites', 'autoShotSites', 'bufferSites']));
  const granted = () => popup.evaluate((o) => chrome.permissions.contains({ origins: [`${o}/*`] }), ORIGIN);
  const log = () => game.evaluate(() => window.__qawLog);
  const last = async () => (await log()).at(-1) || {};
  /** Press (node clock, epoch ms taken just before the press returns) -> the first log entry where pick(entry) is true. */
  async function measure(press, pick, ms = 12000) {
    const before = (await log()).length;
    const t = Date.now();
    await press();
    const hit = await until(async () => (await log()).slice(before).find(pick), ms, 40);
    return hit ? Math.max(0, Math.round(hit.at - t)) : null;
  }

  console.log('\n>>> OWNER: a permission bubble for http://localhost:4173/ is about to appear in the test browser (secondary monitor). Press ALLOW once.\n');
  await popup.bringToFront().catch(() => {});
  await popup.click('#start');
  ok(!!(await until(granted, 180000, 1000)), 'the owner pressed Allow: the grant for http://localhost:4173/ exists');
  await game.reload({ waitUntil: 'domcontentloaded' });
  ok(!!(await until(async () => ['ready', 'recording'].includes((await last()).state), 20000)), 'QA Wrap is awake for the game');
  if ((await last()).state === 'recording') { await popup.click('#stop'); await sleep(1000); }

  /* ---- SLOW signals: notes and screenshots, five presses each (U3, U10) ------------------------------------------------- */
  await popup.click('#start');
  ok(!!(await until(async () => (await last()).state === 'recording', 15000)), 'a session is recording');
  for (let i = 0; i < 5; i++) {
    const base = (await last()).notes;
    const ms = await measure(async () => { await popup.fill('#note-text', `lag note ${i}`); await popup.press('#note-text', 'Enter'); }, (e) => e.notes > base);
    if (ms !== null) lags.notes.push(ms);
    await sleep(900);
  }
  for (let i = 0; i < 5; i++) {
    const base = (await last()).shots;
    const ms = await measure(async () => { await popup.click('#shot').catch(() => {}); }, (e) => e.shots > base);
    if (ms !== null) lags.shots.push(ms);
    await sleep(900);
  }
  answers.U10 = lags.shots.length ? `a screenshot press reached the page after p50 ${pct(lags.shots, 50)} ms, max ${Math.max(...lags.shots)} ms (>= 1500 ms means the 1.5 s glitch needs the graced rule; the full 3.6 s is the limit)` : 'no screenshot count rose (the shot flow may need an area drag): widen the glitch to 2.5 s in t6/t7';
  answers.U3 = `notes p99 ${pct(lags.notes, 99)} ms, shots p99 ${pct(lags.shots, 99)} ms, limit ${LAG_SLOW * 1000} ms`;
  answers.U9 = (await last()).shots === lags.shots.length ? 'qawShots counted only the five screenshots this run took: no auto-screenshot is on' : `qawShots is ${(await last()).shots} after ${lags.shots.length} presses: check autoShotSites`;
  answers.U2 = 'Mark up leaves the tab? not measured by this run (needs the editor window): the owner notes it during the cold run';

  /* ---- FAST: stop, start ----------------------------------------------------------------------------------------------- */
  const msStop = await measure(async () => { await popup.click('#stop'); }, (e) => e.state === 'stopped');
  if (msStop !== null) lags.stop.push(msStop);
  const afterStop = await last();
  const bufferRowOpen = await popup.evaluate(() => { const r = document.getElementById('buffer-row'); return r ? !r.hidden : null; });
  answers.U1 = `after Stop qawState is "${afterStop.state}" and the popup's buffer row is ${bufferRowOpen === null ? 'absent' : bufferRowOpen ? 'shown (the window is still awake)' : 'hidden (NOT awake: add the wake step)'}`;
  const msStart = await measure(async () => { await popup.click('#start'); }, (e) => e.state === 'recording');
  if (msStart !== null) lags.start.push(msStart);

  /* ---- buffer: switch it on for this site, plant a failure, Save last 2 minutes (U4, U8) --------------------------------- */
  await popup.click('#stop'); await sleep(800);
  if (await popup.locator('#buffer-site').count()) {
    await popup.check('#buffer-site').catch(() => {});
    await sleep(800);
    await game.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2500);
    await game.evaluate(() => fetch('/api/orders/almond', { method: 'POST' }).catch(() => {}));
    await sleep(1500);
    const base = (await last()).buffer;
    const msBuf = await measure(async () => { await popup.click('#buffer-save').catch(() => {}); }, (e) => e.buffer > base);
    if (msBuf !== null) lags.buffer.push(msBuf);
    const afterBuf = await last();
    // U8: the session survives a reload, the per-site switch is kept
    await game.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const reloaded = await last();
    const sites = (await storage()).bufferSites || [];
    answers.U8 = `after a reload the page reads qawState "${reloaded.state}" (recording expected), bufferSites ${sites.includes(ORIGIN) ? 'kept' : 'LOST'}`;
    await popup.click('#stop').catch(() => {}); await sleep(1200);
    await popup.waitForSelector('#copy-report:not([disabled])', { timeout: 20000 }).catch(() => {});
    await popup.click('#copy-report').catch(() => {});
    const report = await until(() => popup.evaluate(() => window.__clip.slice(-1)[0] || ''), 8000);
    answers.U4 = report ? `the buffer-start report ${/\/api\/orders\/almond/.test(report) ? 'PRINTS' : /503/.test(report) && /POST/.test(report) ? 'prints POST + 503 but not the path (use the fallback token)' : 'does NOT print the planted request'} (first line: ${report.split('\n')[0].slice(0, 60)})` : 'no report was copied';
    ok(afterBuf.state === 'recording' || afterBuf.buffer > base, 'Save last 2 minutes started a session carrying the frozen events', JSON.stringify(afterBuf));
    await popup.uncheck('#buffer-site').catch(() => {});
    await sleep(600);
  } else answers.U8 = 'the popup has no buffer switch for this page: not measured';

  /* ---- the shortcut: the owner presses Alt+Shift+Q once (U5, U6) ------------------------------------------------------ */
  await game.reload({ waitUntil: 'domcontentloaded' });
  await sleep(2500);
  if ((await last()).state === 'recording') { await popup.click('#stop'); await sleep(1000); }
  console.log('\n>>> OWNER: press Alt+Shift+Q ONCE now, with the game tab in front (30 s). The run records whether it starts a session.\n');
  await game.bringToFront().catch(() => {});
  const base7 = (await last()).shortcut;
  const key = await until(async () => { const e = await last(); return e.state === 'recording' && e.shortcut > base7 ? e : null; }, 30000, 150);
  answers.U5 = key ? 'Alt+Shift+Q worked on this machine and layout' : 'Alt+Shift+Q did NOT start a session within 30 s: the "no shortcut" allowance is needed';
  answers.U6 = key ? 'toggle-recording from ready/stopped started a session and qawShortcut rose' : 'not shown';
  if ((await last()).state === 'recording') { await popup.click('#stop'); await sleep(1000); }

  /* ---- restart: a real trial, an early Stop, death to the next room 1 (door open) ------------------------------------- */
  const link = game.locator('a, button, [role=button]').filter({ hasText: 'Hard trials' }).first();
  if (await link.count()) {
    await game.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    await link.click(); await sleep(500);
    await game.locator('button, [role=button]').filter({ hasText: 'Begin' }).first().click();
    const room = () => game.evaluate(() => { const e = document.querySelector('[data-trial-room]'); const m = e && ((e.getAttribute('data-trial-room') || e.textContent || '').match(/\d+/)); return m ? Number(m[0]) : 0; }).catch(() => 0);
    ok(!!(await until(async () => (await room()) >= 1, 20000, 25)), 'the trial started on the real page (room 1)');
    await popup.click('#start'); await sleep(300); // a session so that Stop is a real state change
    const tStop = Date.now();
    await popup.click('#stop');
    await until(async () => (await room()) === 0, 4000, 20);
    const tDown = Date.now();
    const back = await until(async () => (await room()) >= 1, 8000, 20);
    const restartMs = back ? Date.now() - tStop : null;
    console.log(`RESTART ${restartMs} ms from the Stop press to the next room 1 (died after ${tDown - tStop} ms)`);
    ok(restartMs !== null && restartMs <= 1500, 'a death restarts the stage within 1.5 s of the press including QA Wrap\'s own lag (the engine budget is 1.0 s from the death)', `${restartMs} ms`);
  } else console.log('RESTART not measured: the title has no "Hard trials" entry (T2 has not landed)');

  /* ---- numbers --------------------------------------------------------------------------------------------------------- */
  for (const [name, a] of Object.entries(lags)) console.log(`LAG ${name} n=${a.length} p50=${pct(a, 50)} p99=${pct(a, 99)} max=${a.length ? Math.max(...a) : null}`);
  for (const [k, v] of Object.entries(answers).sort()) console.log(`${k}: ${v}`);
  for (const name of ['notes', 'shots']) {
    ok(lags[name].length >= 3, `${name}: at least 3 of 5 presses were seen by the page`, `n=${lags[name].length}`);
    ok(lags[name].length === 0 || pct(lags[name], 99) <= LAG_SLOW * 1000, `${name}: p99 ${pct(lags[name], 99)} ms is within LAG_SLOW ${LAG_SLOW * 1000} ms (re-pin the constant if not)`);
  }
  const st = await storage();
  ok(['rememberedSites', 'autoStartSites', 'autoShotSites', 'bufferSites'].every((k) => !st[k] || st[k].length === 0), 'at the end rememberedSites, autoStartSites, autoShotSites and bufferSites are all empty', JSON.stringify(st));
  ok(errors.length === 0, 'no page error in the game', errors.join(' | '));
} catch (err) {
  ok(false, `live run stopped: ${err.stack || err.message}`);
} finally {
  try { await topmost?.release?.(); } catch { /* closed */ }
  try { await context?.close(); } catch { /* closed */ }
  try { await new Promise((r) => (server ? server.close(r) : r())); } catch { /* closed */ }
  for (const p of [profile, ext]) if (p) recycle(p);
}
finish(SUITE);
