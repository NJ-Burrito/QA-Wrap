/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Submission-pack images for the free stores, resized from the listing shots and the brand icons.
 *
 *   node tools/store-shots.mjs && node tools/store-packs.mjs     # shots first, then this
 *
 * Writes store/<edge|firefox|opera>/images/. Sizes are the stores' own (see each SUBMIT.md for the page that says so):
 *   edge:    logo 300x300, promo 440x280 and 1400x560, screenshots 1280x800 (max 6) EN + AR
 *   firefox: icon 128x128, screenshots 1280x800 EN + AR
 *   opera:   icon 64x64, screenshots 612x408 (preferred) and 800x600 (maximum) on white, EN + AR
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VER = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;
const url = (p) => pathToFileURL(p).href;
const shots = (ar) => fs.readdirSync(path.join(EXT, 'store/shots', ar ? 'ar' : '')).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(EXT, 'store/shots', ar ? 'ar' : '', f));
const nice = (f) => path.basename(f).replace(`-${VER}`, ''); // "1-report-broke.png": a pack file name is the picture, not the build

const browser = await chromium.launch({ headless: true });
/** Draw `src` inside a w x h canvas: `fit` = contain on `bg`, otherwise stretched to fill (same aspect, so no distortion). */
async function render(src, out, w, h, { fit = false, bg = '#fff' } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const tmp = path.join(EXT, 'store', '_img.html');
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;background:${bg};display:grid;place-items:center;overflow:hidden}img{display:block;${fit ? 'max-width:100%;max-height:100%' : `width:${w}px;height:${h}px`}}</style><img src="${url(src)}">`);
  await page.goto(url(tmp), { waitUntil: 'load' });
  await page.screenshot({ path: out });
  await page.close();
  fs.rmSync(tmp, { force: true });
  console.log(`  ${path.relative(EXT, out)} ${w}x${h}`);
}

try {
  const icon = path.join(EXT, 'icons/icon512.png');
  const icon128 = path.join(EXT, 'icons/icon128.png');
  const promoS = path.join(EXT, `store/promo-440x280-${VER}.png`);
  const promoL = path.join(EXT, `store/promo-1400x560-${VER}.png`);
  const E = path.join(EXT, 'store/edge/images');
  await render(icon, path.join(E, 'logo-300x300.png'), 300, 300);
  fs.copyFileSync(promoS, path.join(E, 'promo-small-440x280.png'));
  fs.copyFileSync(promoL, path.join(E, 'promo-large-1400x560.png'));
  const F = path.join(EXT, 'store/firefox/images');
  fs.mkdirSync(F, { recursive: true });
  fs.copyFileSync(icon128, path.join(F, 'icon-128x128.png'));
  const O = path.join(EXT, 'store/opera/images');
  await render(icon, path.join(O, 'icon-64x64.png'), 64, 64);
  for (const ar of [false, true]) {
    const sub = ar ? 'ar' : 'en';
    for (const s of shots(ar)) {
      for (const d of [E, F]) { fs.mkdirSync(path.join(d, `screenshots-${sub}`), { recursive: true }); fs.copyFileSync(s, path.join(d, `screenshots-${sub}`, nice(s))); }
      await render(s, path.join(O, `screenshots-${sub}-612x408`, nice(s)), 612, 408, { fit: true });
      await render(s, path.join(O, `screenshots-${sub}-800x600`, nice(s)), 800, 600, { fit: true });
    }
  }
} finally {
  await browser.close();
}
