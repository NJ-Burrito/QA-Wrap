/* =============================================================================
   QA Wrap identity — extension icon variants (ui-icons-2026-09-21, lane D).

   The extension's own icon (toolbar/store/favicon) was a flat #B5432B tile,
   the mark in one cream colour. The owner likes the two-tone in-product logo
   and wants the extension icon to carry it too. This writes three glass-plate
   variants (A light, B dark, C warm-two-tone) as SVG sources, full-size and a
   flat small-size (no gradient/highlight — they muddy at 16px).

     node tools/icon-variants.mjs

   Geometry is the frozen mark (do not touch): ring, check, stroke 7, round
   caps/joins, translate(-2 1), viewBox 64. Copied here as literals rather than
   imported from marks.mjs's private ring()/check() closures, since the spec
   pins the exact path strings.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.resolve(ROOT, '..', 'work', 'ui-rework', 'logo');
const out = (p, data) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data, 'utf8');
  console.log('  ' + path.relative(path.resolve(ROOT, '..'), p).padEnd(50) + (data.length / 1024).toFixed(1) + ' KB');
};

const RING = 'M45.01 37.98 A17 17 0 1 0 34.97 46.26';
const CHECK = [[36, 36], [42.5, 44], [55, 20]];
const checkPath = (scale = 1, cx = 30, cy = 30) => {
  const p = CHECK.map(([x, y]) => [cx + (x - cx) * scale, cy + (y - cy) * scale]);
  return `M${p[0][0]} ${p[0][1]}L${p[1][0]} ${p[1][1]}L${p[2][0]} ${p[2][1]}`;
};

const svg = (size, label, defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${label}">${defs}\n  ${body}\n</svg>\n`;

/**
 * Full-size plate: rounded-square (rx14), vertical gradient, 1px hairline
 * edge, faint top inner highlight, mark on top. `id` keeps each variant's
 * gradient/highlight ids unique when a page inlines more than one.
 */
function plateFull(id, top, bottom, edge, highlight, ring, check, scale = 1) {
  const defs = `
  <defs>
    <linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
    <linearGradient id="${id}-h" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${highlight}" stop-opacity=".35"/>
      <stop offset="1" stop-color="${highlight}" stop-opacity="0"/>
    </linearGradient>
  </defs>`;
  const body = `<rect x=".5" y=".5" width="63" height="63" rx="14" fill="url(#${id}-g)" stroke="${edge}" stroke-width="1"/>
  <path d="M14 1.5h36a13.5 13.5 0 0 1 13.5 13.5v14A28 28 0 0 1 14 1.5z" fill="url(#${id}-h)"/>
  <g transform="translate(-2 1)" fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <path stroke="${ring}" d="${RING}"/>
    <path stroke="${check}" d="${checkPath(scale)}"/>
  </g>`;
  return { defs, body };
}

/**
 * Flat small-size plate (16/32px source): no gradient, no highlight — they
 * measured muddy at that size — heavier stroke, check pushed outward (I01),
 * plus a plate-coloured knockout trench between ring and check so the two
 * tones stay crisp where the check's vertex sits inside the ring's stroke
 * band (same fix marks.mjs's onPetra() uses for the single-colour icon).
 */
function plateSmall(plate, ring, check, weight = 6, scale = 1.06) {
  const body = `<rect width="64" height="64" rx="14" fill="${plate}"/>
  <g transform="translate(-2 1)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path stroke="${ring}" stroke-width="${weight}" d="${RING}"/>
    <path stroke="${plate}" stroke-width="${weight + 8}" d="${checkPath(scale)}"/>
    <path stroke="${check}" stroke-width="${weight}" d="${checkPath(scale)}"/>
  </g>`;
  return body;
}

const VARIANTS = {
  A: {
    label: 'light glass plate',
    what: 'Rounded plate, limestone-to-white gradient, ink ring + red check (the light-ground two-tone).',
    weakness: 'Lowest contrast of the three against a dark browser toolbar background strip itself (the plate, not the mark, sits closer to the strip tone).',
    full: () => plateFull('a', '#FDFCFA', '#F1EFE9', '#D8C6A4', '#FFFFFF', '#1D2024', '#B5432B'),
    small: () => plateSmall('#F1EFE9', '#1D2024', '#B5432B'),
  },
  B: {
    label: 'dark glass plate',
    what: 'Rounded plate, basalt gradient, limestone ring + bright coral check (the dark-ground two-tone).',
    weakness: 'On a light toolbar the plate itself reads as a dark hole unless the browser already frames icons; least "warm brand" of the three.',
    full: () => plateFull('b', '#2A2F36', '#1D2024', 'rgba(255,255,255,.14)', '#FFFFFF', '#ECEAE3', '#FF8A6E'),
    small: () => plateSmall('#1D2024', '#ECEAE3', '#FF8A6E'),
  },
  C: {
    label: 'warm plate, two tones kept',
    what: 'The old red plate, now with glass depth; white ring + corn check (fallback pair — see contrast note).',
    weakness: 'Ring/check luminance contrast to each other is low (1.44:1); the two are told apart by hue (white vs gold), not brightness — watch this one first if legibility complaints come in.',
    full: () => plateFull('c', '#C24E33', '#B5432B', '#8E3A22', '#FFFFFF', '#F1EFE9', '#FFD166'),
    small: () => plateSmall('#B5432B', '#FFFFFF', '#FFD166'),
  },
};

const WORK_ROOT = WORK;
for (const [key, v] of Object.entries(VARIANTS)) {
  const { defs, body } = v.full();
  out(path.join(WORK_ROOT, key, 'icon.svg'), svg(512, `QA Wrap — variant ${key}`, defs, body));
  out(path.join(WORK_ROOT, key, 'icon-small.svg'), svg(64, `QA Wrap — variant ${key}, small`, '', v.small()));
}

console.log('\nThree variants written under work/ui-rework/logo/{A,B,C}/{icon.svg,icon-small.svg}.');
console.log('Apply one with tools/apply-icon-variant.mjs <A|B|C>.');
