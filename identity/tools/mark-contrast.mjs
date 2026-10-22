/* =============================================================================
   QA Wrap identity — does a mark stay readable on the ground it is drawn on?

     node tools/mark-contrast.mjs

   ── the bug this measures ──────────────────────────────────────────────────
   Every mark used to carry its own `@media (prefers-color-scheme: dark)`, so
   its colours followed the reader's OPERATING SYSTEM rather than the page
   under it. A reader in night mode opening the wordmark on a white page got
   near-white ink on white — measured 1.20:1, against the 4.5:1 a word must
   clear.

   ── the two renders, and why they are these two ────────────────────────────
   Both are deliberate mismatches, because a match proves nothing:

     1. the OS says dark, the page is forced white
     2. the OS says light, the page is the product's dark surface

   Nothing about the mark changes between them except which file the embed
   picked. Each render is screenshotted, the ink is read back out of the PIXELS
   rather than out of the CSS — the CSS is the thing under test — and the WCAG
   ratio against the ground is computed.

   The last row of each render is a CONTROL: the same geometry with the old
   media query put back. It is expected to FAIL. If it ever passes, the harness
   is measuring nothing and the rows above it prove nothing either.

   Writes the frames to research/40-frames/.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '../../extension/node_modules/playwright/index.mjs';
import pngjs from '../../extension/node_modules/pngjs/lib/png.js';

const { PNG } = pngjs;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, '../research/40-frames');
fs.mkdirSync(OUT, { recursive: true });

const THEME = 'extension-theme-beats-the-os';
const WHITE = '#FFFFFF';
const DARK = '#1D2125'; // --surface, dark: the product's own night ground

/* ── WCAG, from the numbers rather than from memory ─────────────────────── */
const chan = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * chan(r / 255) + 0.7152 * chan(g / 255) + 0.0722 * chan(b / 255);
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hex = ([r, g, b]) => '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join('');
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * The ink, read off the render.
 *
 * Not "the darkest pixel": antialiasing produces pixels beyond the fill in
 * whichever direction the ground lies, and either extreme is a blend rather
 * than a colour anybody chose. The most common colour that is not the ground
 * is the fill, because every stroke and glyph here is flat.
 */
function ink(buffer, ground, band = [0, 1]) {
  const png = PNG.sync.read(buffer);
  const g = rgb(ground);
  const counts = new Map();
  for (let y = Math.floor(png.height * band[0]); y < Math.ceil(png.height * band[1]); y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      if (png.data[i + 3] < 250) continue;
      const px = [png.data[i], png.data[i + 1], png.data[i + 2]];
      // Within a hair of the ground IS the ground.
      if (Math.abs(px[0] - g[0]) + Math.abs(px[1] - g[1]) + Math.abs(px[2] - g[2]) < 12) continue;
      const key = px.join(',');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  if (!counts.size) return null;
  return [...counts].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
}

const dataUri = (file) =>
  'data:image/svg+xml;base64,' + Buffer.from(fs.readFileSync(file, 'utf8'), 'utf8').toString('base64');

/** The wordmark as it was before this fix: the same paths, media query intact. */
const CONTROL = path.join(OUT, 'control-old-wordmark.svg');
fs.writeFileSync(
  CONTROL,
  fs
    .readFileSync(path.join(ROOT, 'logo/qa-wrap-wordmark-light.svg'), 'utf8')
    .replace(
      /<style>[\s\S]*?<\/style>/,
      '<style>.ink{fill:#1D2024}.by{fill:#1D2024;opacity:.72}' +
        '@media (prefers-color-scheme:dark){.ink{fill:#ECEAE3}.by{fill:#ECEAE3;opacity:.72}}</style>'
    ),
  'utf8'
);

/* The wordmark's top 62% is the word; below it is the dimmed by-line, which is
   a different size and a different opacity and would drag the modal colour. */
const WORD = [0, 0.62];

const RENDERS = [
  {
    id: 'os-dark-white-page',
    scheme: 'dark',
    ground: WHITE,
    what: 'the OS says dark; the page is forced white',
    rows: [
      { name: 'wordmark, light ground', file: 'logo/qa-wrap-wordmark-light.svg', band: WORD },
      { name: 'wordmark, host-led, inlined', file: 'logo/qa-wrap-wordmark.svg', band: WORD, inline: true },
      { name: 'lockup, light ground', file: 'logo/qa-wrap-lockup-light.svg', band: WORD },
      { name: 'mark, light ground', file: 'logo/mark.svg' },
      { name: 'CONTROL, the wordmark as it was', file: CONTROL, band: WORD, control: true },
    ],
  },
  {
    id: 'os-light-dark-page',
    scheme: 'light',
    ground: DARK,
    what: "the OS says light; the page is the product's dark surface",
    rows: [
      { name: 'wordmark, dark ground', file: 'logo/qa-wrap-wordmark-dark.svg', band: WORD },
      { name: 'wordmark, host-led, inlined', file: 'logo/qa-wrap-wordmark.svg', band: WORD, inline: true },
      { name: 'lockup, dark ground', file: 'logo/qa-wrap-lockup-dark.svg', band: WORD },
      { name: 'mark, dark ground', file: 'logo/mark-dark.svg' },
      { name: 'CONTROL, the wordmark as it was', file: CONTROL, band: WORD, control: true },
    ],
  },
];

/* ── 3. the extension's own choice, in the extension's own CSS ────────────
 *
 * The two renders above measure files. This one measures the DECISION: an
 * <img class="brand-mark"> is an isolated document, so no host colour reaches
 * inside it and the only thing that can choose for it is the URL. That choice
 * is made in `extension/ui/identity-tokens.css`, by the extension's own theme
 * and not by the machine — so this probe holds the OS at LIGHT and moves the
 * theme, which is exactly the pair that used to put a dark-ink mark on a night
 * surface. The page is written beside the frames so `../..` reaches the
 * extension; the swapped URL inside the stylesheet resolves against the
 * stylesheet, so it is right from wherever the page is.
 */
const PROBE = path.join(OUT, 'theme-probe.html');
fs.writeFileSync(
  PROBE,
  `<!doctype html><meta charset="utf-8">
   <link rel="stylesheet" href="../../extension/ui/identity-tokens.css">
   <style>html,body{margin:0;padding:24px}
          img{display:block;width:120px;height:120px}</style>
   <img id="m" class="brand-mark" src="../../extension/brand/mark.svg" alt="">`,
  'utf8'
);

const browser = await chromium.launch();
const results = [];
try {
  for (const r of RENDERS) {
    const page = await browser.newPage({ viewport: { width: 520, height: 220 } });
    await page.emulateMedia({ colorScheme: r.scheme });
    for (const row of r.rows) {
      const file = path.isAbsolute(row.file) ? row.file : path.join(ROOT, row.file);
      // `inline` puts the SVG in the document, which is the only way
      // currentColor can reach it. Everything else is an <img> — an isolated
      // document, and the case the bug lived in.
      const body = row.inline
        ? fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
        : `<img id="m" src="${dataUri(file)}">`;
      await page.setContent(
        `<!doctype html><meta charset="utf-8">
         <style>
           html,body{margin:0;padding:24px;background:${r.ground};
                     color:${r.ground === WHITE ? '#1D2024' : '#ECEAE3'}}
           img,svg{display:block;width:400px;height:auto}
         </style>${body}`,
        { waitUntil: 'load' }
      );
      const shot = await page.locator(row.inline ? 'svg' : '#m').screenshot({ type: 'png' });
      const slug = `${r.id}-${row.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
      fs.writeFileSync(path.join(OUT, `${slug}.png`), shot);
      const px = ink(shot, r.ground, row.band || [0, 1]);
      // No pixel that differs from the ground means the mark is invisible on
      // it, which is a 1:1 result and belongs in the table as one rather than
      // as a missing measurement.
      results.push({ render: r.id, ...row, ink: px ? hex(px) : 'invisible', ratio: px ? contrast(px, rgb(r.ground)) : 1 });
    }
    await page.close();
  }
  /* the theme probe */
  {
    const page = await browser.newPage({ viewport: { width: 260, height: 200 } });
    await page.emulateMedia({ colorScheme: 'light' });
    for (const theme of ['light', 'dark']) {
      await page.goto(pathToFileURL(PROBE).href, { waitUntil: 'load' });
      const ground = theme === 'light' ? WHITE : DARK;
      await page.evaluate(
        ([t, g]) => {
          document.documentElement.setAttribute('data-theme', t);
          document.body.style.background = g;
        },
        [theme, ground]
      );
      const shot = await page.locator('#m').screenshot({ type: 'png' });
      fs.writeFileSync(path.join(OUT, `theme-${theme}-os-light.png`), shot);
      const px = ink(shot, ground);
      results.push({
        render: THEME,
        name: `mark, theme "${theme}", OS light`,
        ink: px ? hex(px) : 'invisible',
        ratio: px ? contrast(px, rgb(ground)) : 1,
      });
    }
    await page.close();
  }
} finally {
  await browser.close();
}

let wrong = 0;
for (const r of RENDERS) {
  console.log(`\n${r.id} — ${r.what}`);
  console.log(`  ground ${r.ground}`);
  for (const row of results.filter((x) => x.render === r.id)) {
    const asExpected = row.control ? row.ratio < 4.5 : row.ratio >= 4.5;
    if (!asExpected) wrong++;
    console.log(
      `  ${asExpected ? 'ok  ' : 'FAIL'}  ${row.name.padEnd(32)} ink ${String(row.ink).padEnd(9)} ` +
        `${row.ratio.toFixed(2)}:1${row.control ? '   (must fail: it is the old file)' : ''}`
    );
  }
}
console.log(`\n${THEME} — the OS says light throughout; only the theme moves`);
for (const row of results.filter((x) => x.render === THEME)) {
  const asExpected = row.ratio >= 4.5;
  if (!asExpected) wrong++;
  console.log(`  ${asExpected ? 'ok  ' : 'FAIL'}  ${row.name.padEnd(32)} ink ${String(row.ink).padEnd(9)} ${row.ratio.toFixed(2)}:1`);
}

console.log('\nframes in research/40-frames/');
console.log(`${results.length - wrong} of ${results.length} as expected, ${wrong} not`);
process.exit(wrong ? 1 : 0);
