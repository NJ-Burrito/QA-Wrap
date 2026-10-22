/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * ui-1019 lane A: the markup editor keeps its shape at any window size.
 *
 *   node tools/test-markup-layout.mjs            (run from extension/, headless Chromium)
 *
 * The real annotate.html and annotate.css, a large canvas (the worst case: a full-page capture), and three
 * non-symmetric windows. At each: the page never scrolls sideways or down, and the bar, rail, stage and side panel are
 * inside the window. The canvas is inside the stage cell, and no child spills out of its parent's box.
 * `QAW_OLD_CSS=<file>` serves that stylesheet instead, to prove the test fails on the old layout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [[1280, 500], [600, 1000], [900, 700]];
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; } else { failures.push(name); console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); } };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => { window.chrome = { runtime: { id: 'x', getURL: (p) => p, sendMessage() {}, onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } }, i18n: { getMessage: () => '' } }; });
if (process.env.QAW_OLD_CSS) await page.route('**/annotate/annotate.css', (r) => r.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.QAW_OLD_CSS, 'utf8') }));
await page.goto(pathToFileURL(path.join(EXT, 'annotate', 'annotate.html')).href);
await page.evaluate(() => { const c = document.getElementById('canvas'); c.width = 3200; c.height = 2400; });

for (const [w, h] of SIZES) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => {
    const de = document.documentElement;
    const out = [];
    const inside = (a, b) => a.left >= b.left - 0.5 && a.top >= b.top - 0.5 && a.right <= b.right + 0.5 && a.bottom <= b.bottom + 0.5;
    const win = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (const sel of ['.app-bar', '.status', '.rail', '.stage-wrap', '.side']) {
      const e = document.querySelector(sel); const b = e.getBoundingClientRect();
      if (!inside(b, win)) out.push(`${sel} leaves the window: ${[b.left, b.top, b.right, b.bottom].map(Math.round)}`);
      if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible') out.push(`${sel} overflows sideways`);
    }
    const cell = document.querySelector('.stage-wrap'); const cb = cell.getBoundingClientRect();
    const cs = getComputedStyle(cell);
    const content = { left: cb.left + parseFloat(cs.paddingLeft), top: cb.top + parseFloat(cs.paddingTop), right: cb.right - parseFloat(cs.paddingRight), bottom: cb.bottom - parseFloat(cs.paddingBottom) };
    const canvas = document.getElementById('canvas').getBoundingClientRect();
    if (!inside(canvas, content)) out.push(`canvas ${Math.round(canvas.width)}x${Math.round(canvas.height)} spills out of the stage cell ${Math.round(content.right - content.left)}x${Math.round(content.bottom - content.top)}`);
    if (de.scrollWidth > innerWidth || de.scrollHeight > innerHeight) out.push(`page scrolls: ${de.scrollWidth}x${de.scrollHeight} in ${innerWidth}x${innerHeight}`);
    const side = document.querySelector('.side'); const rail = document.querySelector('.rail');
    if (side.getBoundingClientRect().height < 40 || rail.getBoundingClientRect().width < 40) out.push('side panel or rail collapsed');
    return out;
  });
  check(r.length === 0, `${w}x${h}: no gap, no spill`, r.join(' | '));
}

await browser.close();
console.log(`test-markup-layout: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
