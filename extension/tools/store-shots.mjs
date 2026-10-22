/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The Web Store assets, composed from the surfaces the suites already shoot.
 *
 *   node tools/ui-shots.mjs        # first: the raw surfaces, both themes
 *   node tools/store-shots.mjs     # then: store/shots/*.png, store/promo-*.png
 *
 *   node tools/ui-shots.mjs --lang=ar && node tools/store-shots.mjs --lang=ar
 *                                  # T-058: the Arabic set, store/shots/ar/*.png (RTL boards, Arabic captions)
 *
 * A store screenshot is 1280×800. None of the product's surfaces is that
 * shape — the popup is 380 wide, the report is a full tab — so each one is
 * placed on a quiet board with the mark and one line of caption, at the size
 * the store wants. The captions are the listing's own claims, so the pictures
 * and the text cannot say different things.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { BRAND } from './lib-brand.mjs';
import { UI_SHOTS } from './lib-paths.mjs';
import { sourceHash, SHOTS_SOURCE_FILE } from './shots-source.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const AR = process.argv.includes('--lang=ar');
const SHOTS = AR ? path.join(UI_SHOTS, 'ar-store') : UI_SHOTS;
const OUT = path.join(EXT, 'store', 'shots', ...(AR ? ['ar'] : []));
fs.mkdirSync(OUT, { recursive: true });

const url = (p) => pathToFileURL(p).href;
const mark = url(path.join(EXT, 'brand', 'lockup.svg'));
const lockup = url(path.join(EXT, 'brand', 'lockup.svg'));
const fonts = url(path.join(EXT, 'ui', 'fonts.css'));
const tokens = url(path.join(EXT, 'ui', 'identity-tokens.css'));

/** [file in .ui-shots, anchor, outcome (a true number from the shot itself), how wide the picture sits on the board] — T-058 order: the failure and its click, the popup, the bar chip, the values, the filing dialog */
const BOARDS = [
  ['report-broke-light.png', 'The failure and the click before it.', 'POST /api/applications returned 500 right after Submit; the report names that click as step 3 of 3.', 1040],
  ['popup-recording-light.png', 'The whole session in one small window.', '10 events and 9 problems counted so far.', 380],
  ['inpage-bar.png', 'Problems counted while you test.', 'The bar keeps a live count, 4 here, so you know a failure happened before you open the report.', 1040],
  ['inpage-palette.png', 'Awkward values, from the field itself.', 'A field that declares max 40 gets Exactly max (40) and Max + 1 (41), plus Arabic and tatweel cases.', 1040],
  ['report-filing.png', 'A ticket, with nothing hidden.', 'File 4 problems to Jira in one dialog that lists what is sent and what is not: cookies, passwords, other tabs.', 1040],
];

/** The same five, in Modern Standard Arabic. Numbers are the shot's own (Western digits, the artefacts' numerals), and the sentences are the Arabic site captions' claims. */
const BOARDS_AR = [
  ['report-broke-light.png', 'العطل والضغطة التي سبقته.', 'طلب POST إلى /api/applications أعاد 500 مباشرة بعد الضغط على «إرسال الطلب»، والتقرير يسمّي تلك الضغطة الخطوة 3 من 3.', 1040],
  ['popup-recording-light.png', 'الجلسة كلها في نافذة صغيرة.', '10 أحداث و9 مشكلات حتى الآن.', 380],
  ['inpage-bar.png', 'المشكلات تُعدّ أثناء الاختبار.', 'الشريط يعدّ المشكلات لحظة وقوعها، وهي 4 هنا، فتعرف أن عطلا وقع قبل أن تفتح التقرير.', 1040],
  ['inpage-palette.png', 'قيم غريبة، من الخانة نفسها.', 'خانة تعلن حدا أقصى 40 تعطيك «الحد الأقصى بالضبط (40)» و«الحد الأقصى + 1 (41)»، مع حالات عربية وتطويل.', 1040],
  ['report-filing.png', 'تذكرة، بلا شيء مخفي.', 'ارفع 4 مشكلات إلى Jira في نافذة واحدة تسرد ما يُرسل وما لا يُرسل: ملفات تعريف الارتباط وكلمات المرور والتبويبات الأخرى.', 1040],
];

const board = ({ title, caption, image, width }) => `<!doctype html><html lang="${AR ? 'ar' : 'en'}" dir="${AR ? 'rtl' : 'ltr'}"><meta charset="utf-8">
<link rel="stylesheet" href="${fonts}"><link rel="stylesheet" href="${tokens}">
<style>
  html,body{margin:0;width:1280px;height:800px;overflow:hidden;background:var(--surface-sunken);color:var(--text);font:15px/1.5 var(--font)}
  .top{display:flex;align-items:center;gap:14px;padding:34px 56px 0}
  .top img{height:36px}
  h1{margin:22px 56px 6px;font:800 30px/1.15 var(--display);letter-spacing:${AR ? 0 : -0.3}px;max-width:900px}
  p{margin:0 56px;color:var(--text-muted);max-width:760px;font-size:15.5px}
  .stage{position:absolute;left:0;right:0;bottom:0;top:196px;display:flex;justify-content:center;align-items:flex-start;overflow:hidden}
  .shot{width:${width}px;border-radius:10px;box-shadow:0 18px 48px rgba(20,35,42,.22), 0 0 0 1px var(--border);overflow:hidden;background:var(--surface)}
  .shot img{display:block;width:100%}
</style>
<div class="top"><img src="${mark}" alt=""></div>
<h1>${title}</h1><p>${caption}</p>
<div class="stage"><div class="shot"><img src="${image}" alt=""></div></div>`;

const promo = ({ w, h }) => `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${fonts}"><link rel="stylesheet" href="${tokens}">
<style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#F1EFE9;color:#1D2024;font:15px/1.4 var(--font)}
  body::before{content:"";position:absolute;inset:0 0 auto 0;height:${h > 400 ? 10 : 6}px;background:repeating-linear-gradient(90deg,#B5432B 0 22px,#F1EFE9 22px 30px,#1D2024 30px 52px,#F1EFE9 52px 60px)}
  .wrap{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:${h > 400 ? 22 : 10}px;text-align:center;padding:0 40px}
  .lockup{height:${h > 400 ? 150 : 76}px;width:auto}
  .pub{position:absolute;left:0;right:0;bottom:${h > 400 ? 26 : 12}px;margin:0;text-align:center;font-size:${h > 400 ? 13 : 9.5}px;font-weight:600;letter-spacing:.06em;color:#8A9096}
  p{margin:0;font-size:${h > 400 ? 24 : 14}px;font-weight:600;color:#1D2024}
  small{display:block;margin-top:${h > 400 ? 6 : 2}px;font-size:${h > 400 ? 15 : 11}px;font-weight:500;color:#5D646B}
</style>
<div class="wrap">
  <img class="lockup" src="${lockup}" alt="${BRAND.name} by ${BRAND.publisher.en}">
  <p>Every failure, traced.<small>Records a test session, links each failure to its cause, files the report. Local-first.</small></p>
</div>
<p class="pub">${BRAND.madeBy.en.replace('{maker}', BRAND.publisher.en)}</p>`;

const VER = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version; // every file name carries the build (T-031)
const browser = await chromium.launch({ headless: true });
try {
  let n = 0;
  for (const [file, title, caption, width] of AR ? BOARDS_AR : BOARDS) {
    const src = path.join(SHOTS, file);
    if (!fs.existsSync(src)) {
      console.log(`  (skipped ${file} — run tools/ui-shots.mjs first)`);
      continue;
    }
    // A file, not setContent: a page on about:blank cannot load file:// fonts,
    // tokens or the screenshot, and the board came out as unstyled text.
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const tmp = path.join(OUT, '_board.html');
    fs.writeFileSync(tmp, board({ title, caption, image: url(src), width }));
    await page.goto(url(tmp), { waitUntil: 'load' });
    await page.waitForTimeout(600);
    fs.rmSync(tmp, { force: true });
    const out = path.join(OUT, `${++n}-${file.replace(/-light|-dark/, '').replace('.png', '')}-${VER}.png`);
    await page.screenshot({ path: out });
    await page.close();
    console.log(`  store/shots/${path.basename(out)}`);
  }
  for (const [w, h] of AR ? [] : [[440, 280], [1400, 560]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const tmp = path.join(EXT, 'store', '_promo.html');
    fs.writeFileSync(tmp, promo({ w, h }));
    await page.goto(url(tmp), { waitUntil: 'load' });
    await page.waitForTimeout(500);
    fs.rmSync(tmp, { force: true });
    const out = path.join(EXT, 'store', `promo-${w}x${h}-${VER}.png`);
    await page.screenshot({ path: out });
    await page.close();
    console.log(`  store/${path.basename(out)}`);
  }
  fs.writeFileSync(path.join(EXT, SHOTS_SOURCE_FILE), `${JSON.stringify({ version: VER, sourceHash: sourceHash(EXT) }, null, 2)}
`);
} finally {
  await browser.close();
}
