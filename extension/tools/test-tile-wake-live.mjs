/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * 1011 B1 (the owner's "buttons don't work"): while the window is asleep a tool tile is never disabled and silent.
 * Pressing it wakes this site in the same user gesture, then opens or runs the tool. Refused at the permission bubble,
 * it leaves one plain line that says why and a "Test this site" button, and nothing wakes.
 *
 *   node tools/test-tile-wake-live.mjs
 *
 * Headed Chromium on the secondary monitor (pinned topmost), Playwright clicks only, one browser, closed on exit; the
 * profile goes to the recycle bin. The permission bubble itself is Chrome's and cannot be clicked from a harness
 * (lib-granted.mjs), so the refusal is staged by answering `requestSite()` with false: the popup code after it is the real one.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { TRASH } from './lib-trash.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { grantedExtension, awaitSiteScripts, seedConsent } from './lib-granted.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.otf': 'font/otf', '.png': 'image/png' };
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const file = path.join(SITE, u);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const EXT = grantedExtension({ label: 'tilewake-1011' });
let profile;
let context;
let top;
const errors = [];
const trash = (d) => {
  if (!d || !fs.existsSync(d)) return;
  const r = spawnSync('python', [TRASH, d], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  if (r.status !== 0) check(false, `recycle ${path.basename(d)}`, (r.stderr || r.stdout || '').trim().slice(0, 200));
};

const openPopup = async (id) => {
  const popup = await context.newPage();
  popup.on('pageerror', (e) => errors.push(`popup: ${e.message}`));
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
  await popup.evaluate(() => { window.close = () => {}; });
  await popup.setViewportSize({ width: 400, height: 600 }); // the real popup size; wider, the session strip overlaps the rows
  return popup;
};
// A tool that opens a panel (so "it opened" is observable), whichever of these the mode draws.
const ROW = '[data-action="partitions"]';
const showTool = (popup) => popup.evaluate((sel) => {
  for (const d of document.querySelectorAll('details')) if (d.id === 'tools-fold') d.open = true;
  document.querySelector(sel)?.scrollIntoView({ block: 'center' });
}, ROW);

/** A real pointer press at the tile's centre (Playwright mouse, so the page gets a live user gesture). */
const pressTile = async (popup) => {
  const at = await popup.evaluate((sel) => {
    const b = document.querySelector(sel);
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2; const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, covered: !(top === b || b.contains(top)) };
  }, ROW);
  check(!at.covered, 'the tile is the topmost element at its centre, so a real press reaches it');
  await popup.mouse.click(at.x, at.y);
};

let code = 1;
try {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-tilewake-1011-'));
  purgeWorkerCache(profile);
  context = await chromium.launchPersistentContext(profile, launchOptions(EXT, { width: 1100, height: 900, headed: true }));
  top = await keepOnTop(context);
  const worker = await freshWorker(context);
  await seedConsent(worker);
  await awaitSiteScripts(worker);
  const id = new URL(worker.url()).host;

  const page = await context.newPage();
  await page.goto(`${ORIGIN}/try/`, { waitUntil: 'load' });
  let popup = await openPopup(id);
  await showTool(popup);

  console.log('asleep: no tile is disabled in silence');
  const asleep = await popup.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-action]')];
    return {
      awake: document.body.dataset.awake,
      total: tiles.length,
      actions: tiles.map((b) => b.dataset.action).join(','),
      silent: tiles.filter((b) => b.disabled && b.dataset.unavailable !== 'true').map((b) => b.dataset.action),
      unmarked: tiles.filter((b) => !b.disabled && b.dataset.asleep !== 'true').map((b) => b.dataset.action),
      primary: document.getElementById('start-label')?.textContent,
      primaries: [...document.querySelectorAll('.btn-primary')].filter((b) => b.offsetParent).length,
    };
  });
  check(asleep.awake === 'false' && asleep.total > 10, `the popup comes up asleep with ${asleep.total} tiles`, JSON.stringify(asleep));
  check(asleep.silent.length === 0, 'no tile is disabled with no way to wake it', asleep.silent.join(', '));
  check(asleep.unmarked.length === 0, 'every pressable tile is marked asleep', asleep.unmarked.join(', '));
  check(/Test this site/i.test(asleep.primary || '') && asleep.primaries === 1, '"Test this site" stays the one filled primary', JSON.stringify(asleep));

  console.log('refused at the permission bubble: one plain line and a Test this site button, nothing wakes');
  await popup.evaluate(() => { siteAccess.granted = false; window.requestSite = () => Promise.resolve(false); });
  await popup.bringToFront();
  await pressTile(popup);
  await popup.waitForFunction(() => /permission was not given/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const refused = await popup.evaluate((sel) => ({
    awake: document.body.dataset.awake,
    line: document.getElementById('status').firstChild?.textContent?.trim(),
    fix: document.querySelector('#status .status-fix')?.textContent?.trim(),
    open: document.querySelector(sel)?.getAttribute('aria-expanded'),
  }), ROW);
  check(refused.awake === 'false', 'a refused wake leaves the window asleep', JSON.stringify(refused));
  check(/needs QA Wrap awake on this site/.test(refused.line || ''), 'one plain line says why', JSON.stringify(refused));
  check(/Test this site/i.test(refused.fix || ''), 'the line carries a "Test this site" button', JSON.stringify(refused));
  check(refused.open !== 'true', 'the tool did not open without permission', JSON.stringify(refused));
  await popup.close();

  console.log('allowed: the press wakes this site in the same gesture, then opens the tool');
  popup = await openPopup(id);
  await showTool(popup);
  await popup.bringToFront();
  await pressTile(popup);
  await popup.waitForFunction(() => document.body.dataset.awake === 'true', null, { timeout: 10000 });
  const woke = await popup.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-expanded') === 'true', ROW, { timeout: 8000 }).then(() => true).catch(() => false);
  check(woke, 'the pressed tool opened after the wake');
  const armed = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'UQA_ARMED' }));
  check(armed?.ok && armed.result?.armed === true, 'the worker reports this window awake', JSON.stringify(armed));
  const marks = await popup.evaluate(() => [...document.querySelectorAll('[data-action]')].filter((b) => b.dataset.asleep !== 'false').length);
  check(marks === 0, 'after waking no tile is still marked asleep', String(marks));
  check(errors.length === 0, 'no page error in the popup', errors.join(' | '));
  await page.close().catch(() => {});
  code = failures.length ? 1 : 0;
} catch (err) {
  check(false, 'the tile-wake run reached the end', err.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await top?.release?.().catch(() => {});
  await context?.close().catch(() => {});
  await new Promise((ok) => server.close(ok));
  for (const d of [profile, EXT]) trash(d);
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code || failures.length ? 1 : 0);
