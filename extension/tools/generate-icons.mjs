/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Renders the extension's icons from the identity, rather than drawing new ones.
 *
 *   node tools/generate-icons.mjs
 *
 * The previous generator hand-plotted a crosshair reticle in raw PNG bytes. It
 * worked, but it meant the toolbar icon was the one thing in the product that
 * was not the identity — and an identity that the product itself does not use
 * is not an identity.
 *
 * The source is `identity/icons/favicon.svg`: the [N] mark on tide. Pure
 * geometry, no font, so it is the same shape at 16px in the toolbar and at
 * 512px on the store listing.
 *
 * Rendering is done by Chromium, which is already a dev dependency, so the SVG
 * stays the single source of truth. Hand-rasterising it again would just be a
 * second copy of the artwork waiting to drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { profile } from './lib-paths.mjs';
import { BRAND } from './lib-brand.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const IDENTITY = path.resolve(EXT, '..', 'identity');
const OUT = path.join(EXT, 'icons');

const SIZES = Object.keys(BRAND.icons.action).map(Number); // brand/brand.json icons.action
/** The Web Store listing wants one big one; it is not referenced by the manifest. */
const STORE_SIZE = Number(/icon(\d+)\.png$/.exec(BRAND.icons.store)[1]);

const source = path.join(IDENTITY, 'icons', 'favicon.svg');
if (!fs.existsSync(source)) throw new Error(`The identity mark is missing: ${source}`);
const svg = fs.readFileSync(source, 'utf8');

// The 64px master, rendered small, loses the check (I01/I03 in research/96).
// `identity/tools/marks.mjs` also writes a purpose-drawn 16-24px master with a
// lighter stroke and a check pushed outward; use it for the sizes it was
// drawn for instead of shrinking the 64px one.
const smallSource = path.join(IDENTITY, 'icons', 'app-icon-small.svg');
if (!fs.existsSync(smallSource)) throw new Error(`The identity small mark is missing: ${smallSource}`);
const smallSvg = fs.readFileSync(smallSource, 'utf8');

fs.mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(profile('.icons-profile'), launchOptions(EXT));
await keepOnTop(context); // test window stays above others; released on close
try {
  const page = await context.newPage();

  for (const size of [...SIZES, STORE_SIZE]) {
    // The mark carries no prefers-color-scheme rule any more — a mark's
    // colours follow its host, and `identity/tools/marks.mjs` says why. This
    // one is the favicon, which is the mark on the Petra tile: both strokes are
    // paper on terracotta whatever the machine is set to. The light emulation
    // below is kept so the render can never depend on the OS of whoever ran it.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: size, height: size });
    const art = size <= 32 ? smallSvg : svg;
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>
         html,body{margin:0;padding:0;background:transparent}
         svg{display:block;width:${size}px;height:${size}px}
       </style>
       ${art}`,
      { waitUntil: 'load' }
    );
    const buffer = await page.locator('svg').screenshot({ omitBackground: true, type: 'png' });
    const file = path.join(OUT, `icon${size}.png`);
    fs.writeFileSync(file, buffer);
    console.log(`  icon${size}.png  ${buffer.length.toLocaleString()} bytes`);
  }
} finally {
  await context.close(); // only ours
}

/* The in-UI marks are the SVGs themselves — copied, never redrawn, so the
   extension and the identity cannot fall out of step. */
const BRAND = path.join(EXT, 'brand');
fs.mkdirSync(BRAND, { recursive: true });
const marks = [
  ['icons/favicon.svg', 'favicon.svg'],
  // Two grounds, not one file with a media query in it. Which of the two an
  // <img class="brand-mark"> shows is decided by the extension's own theme, in
  // ui/identity-tokens.css — not by the machine the tester happens to be on.
  ['logo/mark.svg', 'mark.svg'],
  ['logo/mark-dark.svg', 'mark-dark.svg'],
  // The ≤24px geometry, for every in-product placement at 14-26px — the same
  // fix that was just made for the toolbar icon (I01/I03), reaching the
  // header and footer marks too, not just the rendered PNGs.
  ['logo/mark-small.svg', 'mark-small.svg'],
  ['logo/mark-small-dark.svg', 'mark-small-dark.svg'],
  ['logo/mark-mono.svg', 'mark-mono.svg'],
  // The animated mark travels with the static one, or the popup would ask
  // for a file the identity has and the extension does not. Both grounds, for
  // the same reason and swapped by the same rules.
  ['logo/mark-motion.svg', 'mark-motion.svg'],
  ['logo/mark-motion-dark.svg', 'mark-motion-dark.svg'],
  // The host-led lockup: `currentColor`, because its only embed is an inline
  // one into an exported document cover, whose ink is the right answer.
  ['logo/qa-wrap-lockup.svg', 'lockup.svg'],
];
let copied = 0;
// The identity is the source and these are copies, so a retired brand name left
// in the identity walks straight into `brand/` and from there onto the cover of
// every exported document. That is caught where it matters — in the shipped
// package, by `tools/release-check.mjs` — rather than by a line of console
// output in the middle of a build nobody reads the middle of.
for (const [from, to] of marks) {
  const src = path.join(IDENTITY, from);
  if (!fs.existsSync(src)) {
    console.log(`  (skipped ${from} — not in the identity)`);
    continue;
  }
  fs.copyFileSync(src, path.join(BRAND, to));
  copied++;
}
console.log(`\n${SIZES.length + 1} icons rendered, ${copied} marks copied from the identity.`);
