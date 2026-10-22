/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * REQ-P0-1 and REQ-P1-15: the practice page after Save, in English and in Arabic.
 *
 *   node tools/test-practice-1011.mjs
 *
 * Before the fix, faults.js asked `t()` for the "Saved" line while the dictionary was still on its way, so the page showed
 * the raw key `welcome.practice.saved`. The page is served from a throwaway local server (no extension needed: the recorder
 * scripts in the page are inert without `chrome.runtime`), driven with headless Playwright, and closed again.
 * What it holds:
 *   - after Save, the status line equals the EN (then AR) value of the key, and no visible text node looks like a raw key;
 *   - the static text is translated too (step 3 reads "Press Stop. Copy the report." / the Arabic pair);
 *   - the answers are behind a closed "Show me" disclosure, and open when pressed;
 *   - the planted faults still work (the coupon button throws, "Next step" does nothing).
 *
 * Until lane INT merges work/sdlc/build/i18n/WORD.json into platform/i18n, the expected values are read with that fragment
 * laid over the tables, and the server serves the same overlay, so the page and the test agree on what "shipped" means.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(EXT, ...p), 'utf8'));
const tables = { en: readJson('platform', 'i18n', 'en.json'), ar: readJson('platform', 'i18n', 'ar.json') };
const fragmentPath = path.join(EXT, '..', 'work', 'sdlc', 'build', 'i18n', 'WORD.json');
if (fs.existsSync(fragmentPath)) {
  const frag = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
  Object.assign(tables.en, frag.en || {});
  Object.assign(tables.ar, frag.ar || {});
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const m = rel.match(/^platform\/i18n\/(en|ar)\.json$/);
  if (m) { res.writeHead(200, { 'content-type': TYPES['.json'] }); res.end(JSON.stringify(tables[m[1]])); return; }
  const file = path.resolve(EXT, rel);
  if (!file.startsWith(EXT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  n++;
  try { await fn(); console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

const RAW_KEY = /^[a-z]+(\.[a-zA-Z]+)+$/;
/** Visible text nodes (an element with display:none, or inside a closed details, is not visible). */
async function visibleRawKeys(page) {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (!text || !re.test(text)) continue;
      const el = node.parentElement;
      if (el && el.checkVisibility && el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })) out.push(text);
    }
    return out;
  }, RAW_KEY.source);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const lang of ['en', 'ar']) {
    const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
    await context.addInitScript((l) => { try { localStorage.setItem('qaw-lang', l); } catch { /* no storage */ } }, lang);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    await page.goto(`${base}/practice/faults.html`, { waitUntil: 'load' });
    const L = tables[lang];

    await test(`${lang}: Save shows the translated line, never the raw key`, async () => {
      await page.click('#p-save');
      await page.waitForFunction(() => document.getElementById('p-save-state').textContent.trim() !== '', null, { timeout: 5000 });
      const text = (await page.textContent('#p-save-state')).trim();
      assert.equal(text, L['welcome.practice.saved']);
      assert.notEqual(text, 'welcome.practice.saved');
      assert.deepEqual(await visibleRawKeys(page), []);
    });

    await test(`${lang}: the static text is translated and step 3 names the button`, async () => {
      assert.equal(await page.getAttribute('html', 'lang'), lang);
      assert.equal(await page.getAttribute('html', 'dir'), lang === 'ar' ? 'rtl' : 'ltr');
      assert.equal((await page.textContent('h1')).trim(), L['welcome.practice.title']);
      const steps = await page.$$eval('.steps li', (els) => els.map((e) => e.textContent.trim()));
      assert.equal(steps[2], L['welcome.practice.step3']);
      assert.equal(steps[2], lang === 'en' ? 'Press Stop. Copy the report.' : 'اضغط «أوقف». انسخ التقرير.');
    });

    await test(`${lang}: the answers sit behind a closed "Show me" disclosure`, async () => {
      assert.match(await page.textContent('details.answers > summary'), lang === 'en' ? /Show me/ : /أرني/);
      assert.equal(await page.$eval('details.answers', (d) => d.open), false);
      assert.equal(await page.isVisible('details.answers > p'), false);
      await page.click('details.answers > summary');
      assert.equal(await page.isVisible('details.answers > p'), true);
    });

    await test(`${lang}: the planted faults are still there`, async () => {
      const before = errors.length;
      await page.click('#p-apply');
      await page.waitForTimeout(100);
      assert.ok(errors.length > before, 'the coupon button no longer throws');
      const next = await page.$eval('#p-next', (b) => b.outerHTML);
      assert.ok(next.includes('p-next'));
      assert.equal((await page.textContent('#p-apply-state')).trim(), '');
    });
    await context.close();
  }

  /* A language switch after Save repaints the status line instead of leaving the old language behind. */
  await test('switching language after Save repaints the status line', async () => {
    const context = await browser.newContext();
    await context.addInitScript(() => { try { localStorage.setItem('qaw-lang', 'en'); } catch { /* no storage */ } });
    const page = await context.newPage();
    await page.goto(`${base}/practice/faults.html`, { waitUntil: 'load' });
    await page.click('#p-save');
    await page.waitForFunction(() => document.getElementById('p-save-state').textContent.trim() !== '');
    await page.evaluate(() => globalThis.QAWi18n.setLang('ar'));
    await page.waitForFunction((want) => document.getElementById('p-save-state').textContent.trim() === want, tables.ar['welcome.practice.saved'], { timeout: 5000 });
    await context.close();
  });
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${n - failed}/${n} passed`);
if (failed) process.exit(1);
