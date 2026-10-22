/* Renders every SVG in the kit to a contact sheet so breakage is visible.
     node tools/preview.mjs            -> dist/contact-sheet.png
   Also exports the PNG sizes a Chrome extension needs.
     node tools/preview.mjs --icons    -> dist/icon16|48|128.png */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '../../extension/node_modules/playwright/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

const files = [];
for (const dir of ['logo', 'icons', 'palette']) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter(f => f.endsWith('.svg')).sort())
    files.push({ rel: `${dir}/${f}`, abs: path.join(d, f) });
}

const browser = await chromium.launch();

if (process.argv.includes('--icons')) {
  // Extension / favicon PNGs, exported from the vector source.
  for (const size of [16, 32, 48, 128, 512]) {
    // Below 48px the small variant keeps its strokes readable.
    const src = pathToFileURL(path.join(ROOT, size < 48 ? 'icons/app-icon-small.svg' : 'icons/app-icon.svg')).href;
    const ctx = await browser.newContext({ viewport: { width: size, height: size } });
    const page = await ctx.newPage();
    const tmp = path.join(DIST, '_icon.html');
    fs.writeFileSync(tmp, `<body style="margin:0"><img src="${src}" width="${size}" height="${size}"></body>`);
    await page.goto(pathToFileURL(tmp).href);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(DIST, `icon${size}.png`), omitBackground: true });
    await ctx.close();
    fs.rmSync(tmp, { force: true });
    console.log(`  dist/icon${size}.png`);
  }
} else {
  const cards = files.map(f =>
    `<figure><img src="${pathToFileURL(f.abs).href}"><figcaption>${f.rel}</figcaption></figure>`
  ).join('');
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const sheet = path.join(DIST, '_sheet.html');
  fs.writeFileSync(sheet, `<body style="margin:0;padding:22px;background:#EAEFF0;font:12px system-ui;color:#22333A">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:18px">${cards}</div>
    <style>
      figure{margin:0;display:flex;flex-direction:column;gap:7px;align-items:center;
             background:#F7F9F9;border:1px solid rgba(20,35,42,.14);border-radius:12px;padding:12px}
      img{width:150px;height:150px;object-fit:contain}
      figcaption{font:10px ui-monospace,monospace;color:#5B6E76;text-align:center;word-break:break-all}
    </style></body>`);
  await page.goto(pathToFileURL(sheet).href);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(DIST, 'contact-sheet.png'), fullPage: true });
  console.log(`  dist/contact-sheet.png  (${files.length} assets)`);
  if (errs.length) console.log('  ERRORS:', errs.join('\n'));
}

await browser.close();
