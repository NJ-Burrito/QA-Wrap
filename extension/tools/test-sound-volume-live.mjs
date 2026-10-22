/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * 1011 B4: the Settings sound-volume slider is not dead. Pressing it with the keyboard and with the pointer moves the
 * thumb, rewrites the "%" next to it, and the new level is saved (read back from the worker, not from the page).
 *
 *   node tools/test-sound-volume-live.mjs
 *
 * Headed Chromium on the secondary monitor (pinned topmost), Playwright input only, one browser, closed on exit; the
 * profile goes to the recycle bin.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { TRASH } from './lib-trash.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { grantedExtension, seedConsent } from './lib-granted.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};
const EXT = grantedExtension({ label: 'volume-1011' });
let profile;
let context;
let top;
const trash = (d) => {
  if (!d || !fs.existsSync(d)) return;
  const r = spawnSync('python', [TRASH, d], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  if (r.status !== 0) check(false, `recycle ${path.basename(d)}`, (r.stderr || r.stdout || '').trim().slice(0, 200));
};

let code = 1;
try {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-volume-1011-'));
  purgeWorkerCache(profile);
  context = await chromium.launchPersistentContext(profile, launchOptions(EXT, { width: 1100, height: 900, headed: true }));
  top = await keepOnTop(context);
  const worker = await freshWorker(context);
  await seedConsent(worker);
  const id = new URL(worker.url()).host;
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/options/options.html`);
  await page.waitForFunction(() => document.body.dataset.ready === 'true' || document.getElementById('soundEnabled'), null, { timeout: 20000 });
  await page.bringToFront();
  const saved = () => page.evaluate(() => chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS' }).then((r) => r?.result?.soundVolume));

  // The save is debounced (250 ms) and answered by the worker: poll the worker, not the page.
  const settled = async (want) => { for (let i = 0; i < 40 && (await saved()) !== want; i++) await page.waitForTimeout(150); };

  // Sound on, through the checkbox a person would tick.
  await page.evaluate(() => { for (let n = document.getElementById('soundEnabled'); n; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true; document.getElementById('soundEnabled').scrollIntoView({ block: 'center' }); });
  if (!(await page.locator('#soundEnabled').isChecked())) await page.locator('#soundEnabled').check();
  await page.waitForSelector('#soundVolume', { state: 'visible', timeout: 8000 });
  // The slider is only settled once the page has painted the saved level beside it; a key pressed earlier is overwritten by that paint.
  await page.waitForFunction(() => document.getElementById('soundVolume-out')?.textContent, null, { timeout: 8000 });
  const before = await page.evaluate(() => ({ v: document.getElementById('soundVolume').value, out: document.getElementById('soundVolume-out').textContent }));

  await page.locator('#soundVolume').focus();
  // An RTL options page (Arabic browser locale) flips the slider: the low end is on the right, so key and click by direction.
  const rtl = await page.evaluate(() => getComputedStyle(document.getElementById('soundVolume')).direction === 'rtl');
  for (let i = 0; i < 3; i++) await page.keyboard.press(rtl ? 'ArrowRight' : 'ArrowLeft');
  const key = await page.evaluate(() => ({ v: document.getElementById('soundVolume').value, out: document.getElementById('soundVolume-out').textContent }));
  check(Number(key.v) < Number(before.v), `the keyboard moves the slider (${before.v} to ${key.v})`, JSON.stringify({ before, key }));
  check(key.out !== before.out && key.out.includes(key.v), `the percentage beside it is rewritten (${before.out} to ${key.out})`, JSON.stringify({ before, key }));
  await settled(Number(key.v));
  check((await saved()) === Number(key.v), 'the keyboard level is saved', `saved ${await saved()} want ${key.v}`);

  // And the pointer, near the right-hand end.
  const box = await page.locator('#soundVolume').boundingBox();
  await page.mouse.click(box.x + box.width * (rtl ? 0.1 : 0.9), box.y + box.height / 2);
  const ptr = await page.evaluate(() => ({ v: document.getElementById('soundVolume').value, out: document.getElementById('soundVolume-out').textContent }));
  check(Number(ptr.v) > Number(key.v), `a press on the track moves the slider (${key.v} to ${ptr.v})`, JSON.stringify(ptr));
  await settled(Number(ptr.v));
  check((await saved()) === Number(ptr.v), 'the pointer level is saved', `saved ${await saved()} want ${ptr.v}`);
  check(errors.length === 0, 'no page error on the settings page', errors.join(' | '));
  code = failures.length ? 1 : 0;
} catch (err) {
  check(false, 'the volume run reached the end', err.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await top?.release?.().catch(() => {});
  await context?.close().catch(() => {});
  for (const d of [profile, EXT]) trash(d);
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code || failures.length ? 1 : 0);
