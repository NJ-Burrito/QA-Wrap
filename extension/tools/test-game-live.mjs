/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt, live (DESIGN-bug-hunt sections 9, 12, 14): the real extension, the real game on http://localhost:4173/, one browser
 * on the SECONDARY monitor, Playwright only (no OS mouse), a fresh sandboxed profile. BY HAND: the browser's permission bubble
 * for the session grant cannot be clicked by a script, so the owner presses Allow once when the run asks.
 *
 *   node tools/test-game-live.mjs --by-hand        (from extension/, PYTHONUTF8=1; or QAW_BY_HAND=1)
 *
 * Without --by-hand it prints SKIPPED and exits 2. With it, the run:
 *   1. serves the game on 127.0.0.1:4173 (exit 2 ENV-BLOCKED when the port is taken);
 *   2. opens the game and the QA Wrap popup, presses "Test this site" (the owner presses Allow: ONE bubble expected);
 *   3. plays L1-L5 with real clicks, adds a note (L3), takes a screenshot (L4), stops and copies the report (L5), and pastes
 *      the copy into the finale;
 *   4. asserts: dataset.qawState was seen as ready/recording and ended "stopped"; chrome.storage.local rememberedSites,
 *      autoStartSites, autoShotSites and bufferSites are all empty; the grant is gone once the session is over; no state
 *      attribute on any other origin; every level's seconds are logged (the owner reads them; run once).
 * Run once: a failure prints the failing line and stops.
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

const GAME = path.join(EXT, 'game');
const ORIGIN = 'http://localhost:4173';
const byHand = process.argv.includes('--by-hand') || process.env.QAW_BY_HAND === '1';
if (!byHand) {
  skipNotEnforced({ rule: 'game', what: 'the live run with the real extension', why: 'by hand only: the owner presses Allow in the browser\'s permission bubble. Run: node tools/test-game-live.mjs --by-hand' });
  finish('test-game-live', { skipped: 1 });
}
if (!fs.existsSync(path.join(GAME, 'server.mjs')) || !fs.existsSync(path.join(GAME, 'game.js'))) {
  skipNotEnforced({ rule: 'game', what: 'the live run', why: 'extension/game/ has not landed' });
  finish('test-game-live', { skipped: 1 });
}

const en = JSON.parse(fs.readFileSync(path.join(GAME, 'strings', 'en.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 200) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } };
const OBSERVE = `window.__qawSeq = []; const rec = () => { const v = document.documentElement.dataset.qawState; if (v && window.__qawSeq[window.__qawSeq.length - 1] !== v) window.__qawSeq.push(v); };
new MutationObserver(rec).observe(document.documentElement, { attributes: true }); document.addEventListener('qaw:state', rec); document.addEventListener('DOMContentLoaded', rec);`;

let server; let context; let profile; let ext; let topmost;
const seconds = {};
let code = 0;
try {
  /* ---- the game server on the real port ------------------------------------------------------------------------ */
  const { createGameServer } = await import(pathToFileURL(path.join(GAME, 'server.mjs')).href);
  server = createGameServer({ port: 4173 });
  const bound = await new Promise((res) => { server.once('error', () => res(false)); server.listen(4173, '127.0.0.1', () => res(true)); });
  if (!bound) { console.log('ENV-BLOCKED: port 4173 is in use (is the game already running?); stop it and run again'); process.exit(2); }

  /* ---- the real extension, ungranted, fresh profile ------------------------------------------------------------ */
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-game-live-'));
  ext = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-game-ext-'));
  for (const e of shipping(fs.readdirSync(EXT))) copyShipping(path.join(EXT, e), path.join(ext, e));
  context = await chromium.launchPersistentContext(profile, launchOptions(ext, { width: 1360, height: 900, headed: true }));
  topmost = await keepOnTop(context);
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  const popupErrors = [];

  const game = await context.newPage();
  await game.addInitScript(OBSERVE);
  const gameErrors = [];
  game.on('pageerror', (e) => gameErrors.push(e.message));
  await game.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  const popup = await context.newPage();
  popup.on('pageerror', (e) => popupErrors.push(e.message));
  await popup.setViewportSize({ width: 348, height: 600 });
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
  await popup.evaluate(() => { window.close = () => {}; window.__clip = []; navigator.clipboard.writeText = async (s) => { window.__clip.push(String(s)); }; });
  const granted = () => popup.evaluate((o) => chrome.permissions.contains({ origins: [`${o}/*`] }), ORIGIN);
  const storage = () => popup.evaluate(() => chrome.storage.local.get(['rememberedSites', 'autoStartSites', 'autoShotSites', 'bufferSites']));
  ok(!(await granted()), 'a fresh profile has no grant for http://localhost:4173/');
  ok(Object.values(await storage()).every((v) => !v || v.length === 0), 'a fresh profile has rememberedSites, autoStartSites, autoShotSites and bufferSites empty');

  /* ---- the one press, and the one bubble ----------------------------------------------------------------------- */
  console.log('\n>>> OWNER: a permission bubble for http://localhost:4173/ is about to appear in the test browser (secondary monitor). Press ALLOW once. Count the bubbles: expected 1.\n');
  await popup.bringToFront().catch(() => {});
  await popup.click('#start');
  const grant = await until(granted, 180000, 1000);
  ok(!!grant, 'the owner pressed Allow: the grant for http://localhost:4173/ exists (session grant)');
  if (!grant) throw new Error('no grant within 3 minutes');
  await game.reload({ waitUntil: 'domcontentloaded' });
  const seen = await until(() => game.evaluate(() => document.documentElement.dataset.qawState || ''), 20000);
  ok(['ready', 'recording', 'asleep'].includes(seen || ''), `the game page sees dataset.qawState after the grant: "${seen}"`);
  if (!['ready', 'recording'].includes(seen || '')) { await popup.click('#start').catch(() => {}); }
  ok(!!(await until(async () => ['ready', 'recording'].includes(await game.evaluate(() => document.documentElement.dataset.qawState)), 20000)), 'QA Wrap is awake for the game (qawState ready or recording)');

  /* ---- play ---------------------------------------------------------------------------------------------------- */
  const clearShown = () => game.evaluate(() => !document.getElementById('ov-clear').hidden);
  const finishLabel = en['rail.finish'];
  async function level(n, { trigger, prove }) {
    const t0 = Date.now();
    if (n === 1) await game.click('#btnStart');
    await game.waitForSelector('#btnGo', { state: 'visible', timeout: 15000 });
    await game.waitForFunction((k) => /\d/.test(document.getElementById('hudLevel').textContent) && document.getElementById('hudLevel').textContent.includes(String(k)), n, { timeout: 15000 });
    await game.click('#btnGo');
    await game.waitForSelector('#app *', { state: 'attached', timeout: 10000 });
    const t1 = Date.now();
    await trigger();
    const caught = await until(async () => (await clearShown()) || (await game.evaluate((l) => document.getElementById('btnPrimaryTxt').textContent === l, finishLabel)), 20000);
    ok(!!caught, `L${n}: the planted bug was caught (the rail offers Finish, or the level cleared)`);
    if (prove) await prove();
    if (!(await until(clearShown, 14000))) {
      if (await game.evaluate((l) => document.getElementById('btnPrimaryTxt').textContent === l, finishLabel)) await game.click('#btnPrimary');
      ok(!!(await until(clearShown, 8000)), `L${n}: the clear card opened`);
    }
    const stars = await game.evaluate(() => document.getElementById('clearStars').getAttribute('aria-label') || document.getElementById('clearStars').textContent);
    seconds[`l${n}`] = { total: Math.round((Date.now() - t0) / 100) / 10, play: Math.round((Date.now() - t1) / 100) / 10, stars: String(stars).trim().slice(0, 30) };
    console.log(`  LEVEL-SECONDS l${n}: play ${seconds[`l${n}`].play} s, with cards ${seconds[`l${n}`].total} s, stars ${seconds[`l${n}`].stars}`);
    await game.click('#btnNext');
  }
  const note = async (text) => { await popup.fill('#note-text', text); await popup.press('#note-text', 'Enter'); };
  const chip = async () => { if (await game.locator('#chipProve').count()) await game.click('#chipProve'); };

  await level(1, { trigger: () => game.click('#save') });
  await level(2, { trigger: () => game.click('#apply'), prove: chip });
  await level(3, { trigger: () => game.click('#next'), prove: async () => { await sleep(1500); await note('Next does nothing'); await sleep(3500); await chip(); } });
  await level(4, { trigger: () => game.click('#ref'), prove: async () => { await popup.click('#shot').catch(() => {}); await sleep(3500); await chip(); } });
  await level(5, {
    trigger: () => game.click('#pay'),
    prove: async () => { await popup.click('#stop'); await sleep(3500); },
  });

  /* ---- finale: copy the real report, paste it ------------------------------------------------------------------ */
  await game.waitForSelector('#pasteBox', { state: 'visible', timeout: 15000 });
  await popup.waitForSelector('#copy-report:not([disabled])', { timeout: 20000 });
  await popup.click('#copy-report');
  const report = await until(() => popup.evaluate(() => window.__clip.slice(-1)[0] || ''), 8000);
  ok(!!report && /^# \S/.test(report), 'the popup copied a real report (starts with "# <title>")', String(report).slice(0, 60));
  await game.evaluate((t) => {
    const ta = document.getElementById('pasteBox'); const dt = new DataTransfer(); dt.setData('text/plain', t); ta.focus();
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, report || '');
  await sleep(500);
  const shown = await game.evaluate(() => ({ result: document.getElementById('pasteResult').innerText, box: document.getElementById('pasteBox').value }));
  ok(shown.box === '' && shown.result.includes(String(report || '').split('\n')[0].slice(0, 40)), 'the real report is accepted: the textarea is emptied and the first line is shown', shown.result.slice(0, 80));

  /* ---- what must be true at the end ----------------------------------------------------------------------------- */
  const seq = await game.evaluate(() => window.__qawSeq);
  console.log(`  qawState sequence seen by the page: ${seq.join(' -> ')}`);
  ok(seq.includes('recording') || seq.includes('ready'), 'the page saw ready or recording');
  ok(seq.at(-1) === 'stopped' && seq.includes('recording'), 'qawState went ... recording -> stopped', seq.join(','));
  ok(seq.every((s) => ['asleep', 'ready', 'recording', 'stopped'].includes(s)), 'qawState was only ever one of the four fixed values');
  const st = await storage();
  ok(['rememberedSites', 'autoStartSites', 'autoShotSites', 'bufferSites'].every((k) => !st[k] || st[k].length === 0), 'after a full play rememberedSites, autoStartSites, autoShotSites and bufferSites are all empty', JSON.stringify(st));
  await game.close();
  await sleep(1500);
  const still = await until(async () => !(await granted()), 15000, 500);
  ok(!!still, 'the session grant for http://localhost:4173/ is gone once the session ended and the game tab closed', 'a grant that survives means the site is remembered');
  const other = await context.newPage();
  await other.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  ok((await other.evaluate(() => document.documentElement.dataset.qawState || '')) === '', 'on 127.0.0.1:4173 (another origin) no state attribute is ever written');
  await other.close();
  ok(gameErrors.length === 0, 'no page error in the game', gameErrors.join(' | '));
  ok(popupErrors.length === 0, 'no page error in the popup', popupErrors.join(' | '));
  console.log(`  LEVEL-SECONDS-JSON ${JSON.stringify(seconds)}`);
} catch (err) {
  ok(false, `live run stopped: ${err.stack || err.message}`);
  code = 1;
} finally {
  try { await topmost?.release?.(); } catch { /* closed */ }
  try { await context?.close(); } catch { /* closed */ }
  try { await new Promise((r) => (server ? server.close(r) : r())); } catch { /* closed */ }
  for (const p of [profile, ext]) if (p) recycle(p);
}
void code;
finish('test-game-live');
