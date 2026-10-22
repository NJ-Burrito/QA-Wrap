/* =============================================================================
   QA Wrap identity — the product wordmark and lockups, as OUTLINES.

     node tools/product-lockup.mjs

   The product is QA Wrap; the brand behind it is QA Wrap. The lockup
   says both, in that order and at two sizes: "QA Wrap" in Thmanyah Serif Display Black,
   the by-line (meta.byline) in Thmanyah Sans Medium at a third of the height. The mark
   (the burrito) comes from marks.mjs and is inlined, so there is one burrito
   everywhere.

     logo/qa-wrap-wordmark.svg          QA Wrap
     logo/qa-wrap-lockup.svg            burrito + QA Wrap + by-line
     logo/qa-wrap-lockup-stacked.svg    burrito over QA Wrap over by-line
     ../extension/brand/lockup.svg      the horizontal one, copied

   Outlines, not text, for the same reason as wordmark.mjs: the file must
   look the same where Thmanyah is not installed and where remote fonts are
   blocked.

   ── which colours ─────────────────────────────────────────────
   Same rule as marks.mjs: the ground decides, and the ground is a fact about
   the placement, not about the reader's operating system. These files each
   used to carry `@media (prefers-color-scheme: dark)`, which is why a viewer
   in night mode opening the wordmark on a white page measured **1.20:1** —
   near-white ink on white. Three files come out of each shape instead:

     <name>.svg         `currentColor`, so the HOST decides. This is the one
                        the extension copies, because its only embed is an
                        inline one: `brand/lockup.svg` is read as text and
                        pasted into the cover of every exported document,
                        where the document's own ink is exactly right. Opened
                        on its own it is black on white, which is also right.
     <name>-light.svg   committed: basalt ink, Petra accent, for a light ground.
     <name>-dark.svg    committed: limestone ink, the night Petra, for a dark one.

   The accent in the host version is `var(--bad, PETRA)`. `--bad` is the name
   the exported document shell (`extension/lib/docshell.js`) gives to the
   failure colour, and the failure colour IS Petra in both of its themes — so
   inside a cover the check tracks the document, and the literal fallback keeps
   it Petra everywhere else. The fallback is what a consumer that defines no
   variables gets, which is the common case.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { brand, meta } from './tokens.source.mjs';

const require = createRequire(import.meta.url);
const opentype = require('../../extension/node_modules/opentype.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// D-1010-43: Thmanyah only (Cairo is banned). The staged copies in work/fonts-staged (or QAW_FONT_DIR).
const STAGED = path.join(ROOT, '..', 'work', 'fonts-staged');
// r10-14-3 (D-245): QAW_FONT_DIR, when set, is the only place searched (a test points it at an empty folder). A missing face is one
// error naming every place looked and the licence (extension/NOTICE), never a bare ENOENT. The faces are never committed (work/* is ignored).
const FONT_DIRS = process.env.QAW_FONT_DIR ? [process.env.QAW_FONT_DIR] : [STAGED];
const face = (file) => {
  const hit = FONT_DIRS.map((d) => path.join(d, file)).find((f) => fs.existsSync(f));
  if (!hit) {
    throw new Error(`product-lockup: cannot find ${file}. Looked in: ${FONT_DIRS.join(' ; ')}. These are the Thmanyah faces; they are licensed, not open, and are not in git (see the Thmanyah entry in extension/NOTICE and "Where the faces come from" in identity/BRAND.md). Put the OTF in one of those folders, or point QAW_FONT_DIR at a folder that holds it.`);
  }
  return opentype.loadSync(hit);
};
const heavy = face('thmanyahserifdisplay-Black.otf');
const light = face('thmanyahsans-Medium.otf');

const out = (rel, data) => {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data, 'utf8');
  console.log('  ' + rel.padEnd(40) + (data.length / 1024).toFixed(1) + ' KB');
};
const CREDIT = (name) => `<!-- QA Wrap identity — ${name}. Thmanyah as outlines, by identity/tools/product-lockup.mjs. © ${new Date().getFullYear()} ${meta.owner}. -->\n`;

function outline(font, text, size, letterSpacing = 0) {
  const p = font.getPath(text, 0, 0, size, { kerning: true, letterSpacing });
  return { d: p.toPathData(2), box: p.getBoundingBox(), width: font.getAdvanceWidth(text, size, { kerning: true, letterSpacing }) };
}
const metrics = (font, size) => ({
  asc: (font.ascender / font.unitsPerEm) * size,
  desc: (Math.abs(font.descender) / font.unitsPerEm) * size,
});

const SIZE = 64;
const BY = 22;
const big = outline(heavy, 'QA Wrap', SIZE, -1 / SIZE);
const by = outline(light, meta.byline, BY, 0.4 / BY);
const mb = metrics(heavy, SIZE);
const ms = metrics(light, BY);
const TOP = mb.asc * 0.78;
const H = TOP + mb.desc * 0.55;
const W = Math.ceil(Math.max(big.width, by.width));

/**
 * The colours, three ways. See the header for why there is no media query.
 */
const GROUNDS = {
  light: { ink: brand.basalt.light, accent: brand.petra.light },
  dark: { ink: brand.limestone.dark, accent: brand.petra.dark },
};
const committed = (g) => `<style>.ink{fill:${g.ink}}.by{fill:${g.ink};opacity:.72}.accent{fill:${g.accent}}
    .ring{stroke:${g.ink}}.check{stroke:${g.accent}}</style>`;
const hostLed = `<style>.ink{fill:currentColor}.by{fill:currentColor;opacity:.72}.accent{fill:var(--bad,${brand.petra.light})}
    .ring{stroke:currentColor}.check{stroke:var(--bad,${brand.petra.light})}</style>`;

/**
 * The three variants, in the order they are written.
 *
 * `suffix` is the filename tail; `sheet` is the <style> block; `mark` names
 * which generated mark file the burrito is lifted from, so the presentation
 * attributes inside it — the ones that survive a consumer stripping <style> —
 * are already right for that ground rather than being right only by accident.
 */
const VARIANTS = [
  { suffix: '', sheet: hostLed, mark: 'logo/mark-mono.svg' },
  { suffix: '-light', sheet: committed(GROUNDS.light), mark: 'logo/mark.svg' },
  { suffix: '-dark', sheet: committed(GROUNDS.dark), mark: 'logo/mark-dark.svg' },
];

/** One SVG's contents, without its comment, its metadata, or its own <style>. */
const inner = (file) => {
  const svg = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return svg
    .slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
    // The mark brings its own two-line stylesheet. Inside a lockup the lockup's
    // sheet is the one that decides, and two <style> blocks each setting .ring
    // is a file whose colour depends on which one the reader applied last.
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .trim();
};
const MARK = (v, x, y, s) =>
  `<g transform="translate(${x} ${y}) scale(${(s / 64).toFixed(4)})">${inner(v.mark)}</g>`;

/* ── 1. wordmark with by-line ─────────────────────────────────────────── */
{
  const gap = 4;
  const total = H + gap + ms.asc * 0.78 + ms.desc * 0.4;
  for (const v of VARIANTS) {
    out(`logo/qa-wrap-wordmark${v.suffix}.svg`, CREDIT(`wordmark${v.suffix}`) +
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Math.ceil(total)}" width="${W}" height="${Math.ceil(total)}" role="img" aria-label="QA Wrap ${meta.byline}">
  ${v.sheet}
  <path class="ink" transform="translate(0 ${TOP.toFixed(2)})" d="${big.d}"/>
  <path class="by" transform="translate(1 ${(H + gap + ms.asc * 0.78).toFixed(2)})" d="${by.d}"/>
</svg>
`);
  }
}

/* ── 2. lockup, horizontal: mark, then the two lines ─────────────────── */
{
  const gap = 4;
  const textH = H + gap + ms.asc * 0.78 + ms.desc * 0.4;
  const m = Math.ceil(textH * 1.05);
  const g = 12;
  const total = m + g + W;
  const y = (m - textH) / 2;
  for (const v of VARIANTS) {
    out(`logo/qa-wrap-lockup${v.suffix}.svg`, CREDIT(`lockup, horizontal${v.suffix}`) +
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(total)} ${m}" width="${Math.ceil(total)}" height="${m}" role="img" aria-label="QA Wrap ${meta.byline}">
  ${v.sheet}
  ${MARK(v, 0, 0, m)}
  <path class="ink" transform="translate(${(m + g).toFixed(2)} ${(y + TOP).toFixed(2)})" d="${big.d}"/>
  <path class="by" transform="translate(${(m + g + 1).toFixed(2)} ${(y + H + gap + ms.asc * 0.78).toFixed(2)})" d="${by.d}"/>
</svg>
`);
  }

  /* The extension gets the host-led one, for the reason in the header: its only
     embed is an inline one, into a cover whose ink is already decided.

     It carries no by-line: the maker is text read from extension/brand/brand.json
     (the document cover prints it beside the lockup), so a rebrand never needs
     new outlines in the extension. The mark, the wordmark and the host-led sheet
     are the same as the horizontal lockup above; only the by-line path is left
     out and the wordmark is centred on the mark by its ink box. A change made in `extension/brand/lockup.svg`
     alone is undone by the next run of this file; the shape lives here. */
  fs.writeFileSync(path.join(ROOT, '../extension/brand/lockup.svg'), `<!-- QA Wrap identity — lockup, horizontal, no by-line (the maker is text from brand/brand.json). Thmanyah as outlines. © ${new Date().getFullYear()} ${meta.owner}. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(total)} ${m}" width="${Math.ceil(total)}" height="${m}" role="img" aria-label="QA Wrap">
  ${hostLed.replace(/\.by\{[^}]*\}/, '')}
  ${MARK(VARIANTS[0], 0, 0, m)}
  <path class="ink" transform="translate(${(m + g).toFixed(2)} ${(m / 2 - (big.box.y1 + big.box.y2) / 2).toFixed(2)})" d="${big.d}"/>
</svg>
`);
  console.log('  ../extension/brand/lockup.svg           written (no by-line)');
}

/* ── 3. lockup, stacked ───────────────────────────────────────────────── */
{
  const m = 104;
  const g = 12;
  const gap = 6;
  const total = m + g + H + gap + ms.asc * 0.78 + ms.desc * 0.4;
  for (const v of VARIANTS) {
    out(`logo/qa-wrap-lockup-stacked${v.suffix}.svg`, CREDIT(`lockup, stacked${v.suffix}`) +
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Math.ceil(total)}" width="${W}" height="${Math.ceil(total)}" role="img" aria-label="QA Wrap ${meta.byline}">
  ${v.sheet}
  ${MARK(v, (W - m) / 2, 0, m)}
  <path class="ink" transform="translate(${((W - big.width) / 2).toFixed(2)} ${(m + g + TOP).toFixed(2)})" d="${big.d}"/>
  <path class="by" transform="translate(${((W - by.width) / 2).toFixed(2)} ${(m + g + H + gap + ms.asc * 0.78).toFixed(2)})" d="${by.d}"/>
</svg>
`);
  }
}


console.log('\nQA Wrap wordmark and lockups regenerated as outlines (Thmanyah Serif Display Black + Sans Medium); the burrito came from marks.mjs');
