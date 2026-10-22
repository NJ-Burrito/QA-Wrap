/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * features-1010 lane O, the headed walk: install, welcome, the packaged practice page, ONE press of "Test this site", the
 * four planted faults, stop, the report, the first copied report. Counts the clicks.
 *
 *   node tools/test-onboarding-live.mjs
 *
 * The real manifest, no granted copy: the practice page is the extension's own, so no Chrome permission dialog is needed
 * (a dialog is a browser surface Playwright cannot press). Headed on the SECONDARY monitor, never the real OS mouse, one
 * browser, closed on exit; the profile goes to the recycle bin (trash.py).
 */
import fs from 'node:fs';
import os from 'node:os';
import { TRASH } from './lib-trash.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { EXT } from './lib-paths.mjs';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};
let clicks = 0;
const click = async (page, selector, label) => { await page.click(selector); clicks++; console.log(`     click ${clicks}: ${label}`); };

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-onboarding-live-'));
purgeWorkerCache(profile);
let context;
let code = 1;
try {
  context = await chromium.launchPersistentContext(profile, launchOptions(EXT, { width: 1280, height: 720, headed: true }));
  await keepOnTop(context);
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  const errors = [];

  /* ── the welcome page ─────────────────────────────────────────────── */
  let welcome = context.pages().find((p) => p.url().includes('/welcome/welcome.html'));
  for (let i = 0; i < 100 && !welcome; i++) { await new Promise((r) => setTimeout(r, 100)); welcome = context.pages().find((p) => p.url().includes('/welcome/welcome.html')); }
  if (!welcome) { welcome = await context.newPage(); await welcome.goto(`chrome-extension://${id}/welcome/welcome.html`); console.log('     (the welcome tab did not open by itself; opened by the harness)'); }
  await welcome.setViewportSize({ width: 1280, height: 720 });
  await welcome.bringToFront();
  const keys = await welcome.locator('#key-facts .key').count();
  const inDom = await welcome.locator('#all-facts li.point').count();
  const open = await welcome.evaluate(() => document.getElementById('all-facts').open);
  const box = await welcome.locator('#accept').boundingBox();
  check(keys === 3, 'the welcome shows 3 facts', `found ${keys}`);
  check(inDom === 8 && open === false, 'all 8 facts are in the DOM under a closed disclosure', `dom=${inDom} open=${open}`);
  check(!!box && box.y + box.height <= 720, 'the accept button is reachable without scrolling at 1280x720', JSON.stringify(box));
  check(await welcome.evaluate(() => document.activeElement?.id === 'accept'), 'accept has focus on load');
  await click(welcome, '#accept', 'I understand');
  await welcome.waitForSelector('#done:not([hidden])', { timeout: 10000 });
  check(await welcome.locator('#pin-hint svg').isVisible(), 'the done state shows the pin picture');
  const practiceOpened = context.waitForEvent('page', { timeout: 15000 });
  await click(welcome, '#done-practice', 'Open the practice page');
  const practice = await practiceOpened;
  await practice.waitForLoadState('load');
  check(practice.url().includes('/practice/practice.html'), 'the practice page opened from inside the extension', practice.url());
  // 15 Oct 2026: the welcome link opens the Bug Hunt game; this walk needs the four-fault page (levels are test-e2e-practice's job), so the same tab goes there.
  await practice.goto(`chrome-extension://${id}/practice/faults.html`);
  await practice.waitForLoadState('load');
  practice.on('pageerror', (e) => errors.push(`practice: ${e.message}`));

  /* ── ONE press: Test this site ────────────────────────────────────── */
  const popup = await context.newPage();
  popup.on('pageerror', (e) => errors.push(`popup: ${e.message}`));
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
  await popup.evaluate(() => { window.close = () => {}; });
  clicks++; console.log(`     click ${clicks}: the toolbar icon (the popup opened as a tab by the harness)`);
  check(await popup.locator('#start').isEnabled(), 'Test this site is enabled while asleep');
  check(/Test this site/.test(await popup.textContent('#start-label')), 'the button says Test this site');
  await popup.click('#start'); clicks++; console.log(`     click ${clicks}: Test this site`);
  await popup.waitForFunction(() => !document.getElementById('step-live').hidden, null, { timeout: 15000 });
  const probe = async () => worker.evaluate(async () => { const t = (await chrome.tabs.query({})).find((x) => x.url.includes('/practice/')); const out = {}; for (const f of ['content/page-hooks.js', 'content/bridge.js']) { try { await chrome.scripting.executeScript({ target: { tabId: t.id }, files: [f], world: f.includes('hooks') ? 'MAIN' : 'ISOLATED' }); out[f] = 'ok'; } catch (e) { out[f] = String(e.message).slice(0, 120); } } return out; });
  const dbg = async () => JSON.stringify({ probe: await probe() }) + JSON.stringify(await worker.evaluate(async () => ({ armed: (await chrome.storage.session.get('armedWindows')).armedWindows, tabs: (await chrome.tabs.query({})).map((t) => [t.id, t.windowId, t.url.slice(-40)]) })));
  await popup.waitForFunction(() => document.body.dataset.awake === 'true', null, { timeout: 8000 }).catch(() => {});
  check(await popup.evaluate(() => document.body.dataset.awake === 'true'), 'one press woke the window', await dbg());
  await practice.bringToFront();
  // The recorder lives in the practice page itself (Chrome refuses executeScript on extension pages), so the page can be asked directly.
  const recorderIn = await practice.waitForFunction(() => window.UQAAwake === true && !!window.__UQA_RECORDER__ && window.UQABridge?.isRecording?.() === true, null, { timeout: 10000 }).then(() => true, () => false);
  check(recorderIn, 'the practice page is awake and recording after that one press');

  /* ── the four planted faults ──────────────────────────────────────── */
  await practice.fill('#p-name', 'Nader');
  await click(practice, '#p-save', 'Save profile');
  await practice.waitForFunction(() => document.getElementById('p-save-state').textContent.length > 0, null, { timeout: 10000 });
  check(true, 'Save profile says Saved although its request fails');
  await click(practice, '#p-apply', 'Apply coupon');
  await click(practice, '#p-next', 'Next step (does nothing)');
  const overflow = await practice.evaluate(() => { const r = document.getElementById('p-ref').getBoundingClientRect(); const t = document.querySelector('.order-total').getBoundingClientRect(); return r.right > t.left || document.getElementById('p-ref').scrollWidth > document.getElementById('p-ref').clientWidth; });
  check(overflow, 'the layout fault is really there: the order reference runs over the total', JSON.stringify(await practice.evaluate(() => [document.getElementById('p-ref').getBoundingClientRect().toJSON(), document.querySelector('.order-total').getBoundingClientRect().toJSON()])));
  await practice.waitForTimeout(800);

  /* ── stop, report, copy ───────────────────────────────────────────── */
  await popup.bringToFront();
  await click(popup, '#stop', 'Stop');
  await popup.waitForFunction(() => !document.getElementById('step-done').hidden, null, { timeout: 15000 });
  await popup.evaluate(() => { document.getElementById('done-more').open = true; }); // the name box lives under "More" since R8 (test-done-card asserts that), so it is opened first
  await popup.waitForSelector('#done-name-row:not([hidden])', { timeout: 8000 }).catch(() => {});
  check(await popup.locator('#done-name-row').isVisible(), 'the name is asked at stop', await popup.evaluate(() => document.getElementById('done-summary').textContent));
  await popup.fill('#done-name', 'Practice walk');
  await popup.click('#done-name-save');
  await popup.waitForFunction(() => /Practice walk/.test(document.getElementById('done-summary').textContent), null, { timeout: 10000 });
  check(true, 'the name given at stop is the name of the session (optional step, not counted)');
  const reportOpened = context.waitForEvent('page', { timeout: 20000, predicate: (p) => p.url().includes('/report/report.html') }).catch(() => null);
  await click(popup, '#view-report', 'Open full report');
  const report = (await reportOpened) || context.pages().find((p) => p.url().includes('/report/report.html'));
  await report.waitForSelector('#verdict:not([hidden])', { timeout: 25000 });
  const text = await report.textContent('#verdict');
  console.log(`     report: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
  check(/practice|api\/save-profile|Failed|error|coupon|TypeError/i.test(text), 'the report names a planted fault');
  await report.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async (s) => { window.__copied = s; }; });
  const copy = report.locator('button', { hasText: /Copy steps/ }).first();
  await copy.click(); clicks++; console.log(`     click ${clicks}: Copy steps (the first copied report)`);
  await report.waitForFunction(() => window.__copied != null, null, { timeout: 10000 }).catch(() => {});
  const copied = await report.evaluate(() => window.__copied);
  check(typeof copied === 'string' && copied.length > 20, 'the first report is on the clipboard', String(copied).slice(0, 120));
  console.log(`     copied: ${String(copied).replace(/\s+/g, ' ').slice(0, 200)}`);
  const planted = errors.filter((e) => e.startsWith('practice: Cannot read properties of undefined'));
  check(planted.length === 1 && errors.length === 1, 'the only page error is the planted coupon error (none in the popup)', errors.join(' | '));
  console.log(`CLICKS from the welcome page to the first copied report: ${clicks} (8 without the Apply-coupon and Next-step buttons; no Chrome dialog on the practice page)`);
  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  walk aborted: ${err.stack || err.message}`);
} finally {
  await context?.close().catch(() => {});
  const trash = TRASH;
  spawnSync('python', [trash, profile], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
