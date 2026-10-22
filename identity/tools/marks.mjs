/* =============================================================================
   QA Wrap identity — the mark.

     node tools/marks.mjs

   ── the idea ───────────────────────────────────────────────────────────────
   One shape, three readings, and they are the product:

     the ring    a wrap. A session — every click, request and error — closed
                 into one thing you can hold. The ring is open at the lower
                 right: a wrap has a seam.
     the check   the verdict. It starts inside the ring, passes out through
                 the seam, and finishes above it: evidence going out as an
                 answer.
     together    a Q. QA Wrap's initial, drawn rather than typed.

   ── the rules it was drawn to ──────────────────────────────────────────────
   · one stroke weight, round caps, no gradient, no shadow, no second idea;
   · legible at 16 px — the size that actually matters — and in one colour;
   · the check never crosses the ring's stroke, so the mark can never be
     mistaken for a "prohibited" sign;
   · geometry on a 64 grid: ring r 17 at (30,30), stroke 7, seam ±28° about
     the 45° diagonal, check 36,36 → 42.5,44 → 55,20;
   · a heavier variant for ≤ 24 px, because a hairline disappears there —
     a responsive logo, not a shrunken one.

   ── which colours, and who decides ──────────────────────────────
   A mark's colours follow its HOST, never the machine.

   Every one of these files used to carry its own
   `@media (prefers-color-scheme: dark)`. That is the machine deciding, and the
   machine is not what the mark is sitting on. A viewer whose OS is set to dark,
   opening the wordmark on a page that is white — a print preview, a store
   listing, an exported cover, anything with a fixed ground — got the night
   palette on white: measured 1.20:1 for the wordmark and 2.30:1 for the mark
   and the lockup, against the 4.5:1 a word has to clear. The media query was
   answering exactly the question it was asked. It was the wrong question.

   So no mark carries a media query now. Instead:

     <name>.svg        the light-ground mark: ink ring, Petra check. What most
                       placements want, and what an <img> gets when nobody has
                       said otherwise.
     <name>-dark.svg   the same mark, drawn for a dark ground.
     mark-mono.svg     one colour, `currentColor` — for anywhere the mark is
                       INLINED into a document, where the host's own text
                       colour is the right answer and no file has to choose.

   Choosing is the embed's job, and every embed now does it on purpose:
   `extension/ui/identity-tokens.css` swaps the file by the extension's own
   theme rather than the OS, for every `<img class="brand-mark">`; the site
   inlines the geometry and paints it `currentColor`; the exported document
   covers inline `brand/lockup.svg`, which is drawn in `currentColor` and takes
   the cover's own ink.

   Writes:
     logo/mark.svg            light ground: ink ring, accent check
     logo/mark-dark.svg       the same mark, drawn for a dark ground
     logo/mark-small.svg      light ground, ≤24px geometry: heavier stroke,
                               check pushed outward, so it doesn't fuse (I01)
     logo/mark-small-dark.svg the same, for a dark ground
     logo/mark-mono.svg       one colour, currentColor — for inlining
     logo/mark-motion.svg     mark.svg plus the two named states
     logo/mark-motion-dark.svg    the same, for a dark ground
     icons/favicon.svg        the mark on the Petra ground
     icons/app-icon.svg       the same at 512
     icons/app-icon-small.svg the heavy variant for 16–24 px
     logo/construction.svg    the grid, the radii, the angles
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brand, semantic, meta } from './tokens.source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.resolve(ROOT, '..', 'work', 'ui-rework', 'logo');

/* Which glass-plate icon variant (`icon-variants.mjs`, applied by
   `apply-icon-variant.mjs`) ships as the actual extension icon. `null` would
   leave the tile drawn by `onPetra()` below in place. This used to be a
   separate manual step, so regenerating the marks silently reverted the icon
   to the tile (handoff.md, 21 Sept: "generator drift"); folded in here so one
   `node tools/marks.mjs` run always reproduces the shipped icon. */
const ACTIVE_ICON_VARIANT = 'A';

const out = (rel, data) => {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data, 'utf8');
  console.log('  ' + rel.padEnd(30) + (data.length / 1024).toFixed(1) + ' KB');
};
const CREDIT = (name) => `<!-- QA Wrap identity — ${name}. Geometry from identity/tools/marks.mjs. © ${new Date().getFullYear()} ${meta.owner}. -->\n`;

/* ── the geometry, in one place ─────────────────────────────────────────── */

const G = {
  cx: 30, cy: 30, r: 17,          // the ring
  stroke: 7,                      // one weight for everything
  seam: 45, half: 28,             // the opening, centred on the diagonal
  check: [[36, 36], [42.5, 44], [55, 20]],
  nudge: [-2, 1],                  // optical centring inside the 64 box (I02)
};

const rad = (deg) => (deg * Math.PI) / 180;
const on = (deg, r = G.r) => [G.cx + r * Math.cos(rad(-deg)), G.cy + r * Math.sin(rad(-deg))];
const f = (n) => Number(n.toFixed(2));

/** The open ring: from one lip of the seam, the long way round, to the other. */
function ring(r = G.r) {
  const [ax, ay] = on(-(G.half - G.seam) - 2 * G.seam + G.seam, r); // −19°
  const [bx, by] = on(-(G.seam + G.half), r); // −71°
  return `M${f(ax)} ${f(ay)} A${r} ${r} 0 1 0 ${f(bx)} ${f(by)}`;
}

/** The check: inside the ring, out through the seam, up. */
function check(scale = 1) {
  const [s, v, e] = G.check.map(([x, y]) => [G.cx + (x - G.cx) * scale, G.cy + (y - G.cy) * scale]);
  return `M${f(s[0])} ${f(s[1])}L${f(v[0])} ${f(v[1])}L${f(e[0])} ${f(e[1])}`;
}

/**
 * The mark.
 *
 * `weight` is the stroke; the ≤24 px variant uses a heavier one and a slightly
 * smaller ring so the counters stay open when the whole thing is 16 px wide.
 */
function markPaths({ weight = G.stroke, r = G.r, scale = 1, ink = brand.basalt.light, accent = brand.petra.light } = {}) {
  // The colours are presentation attributes AND classes. The attribute is what
  // survives when the mark is inlined into another file (a lockup, a board, a
  // report cover) and that file's <style> is stripped; the class is what the
  // dark-mode rule overrides when the SVG stands on its own. Without the
  // attribute the mark rendered as nothing at all inside the lockups.
  return `<g transform="translate(${G.nudge[0]} ${G.nudge[1]})" fill="none" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round">
    <path class="ring" stroke="${ink}" d="${ring(r)}"/>
    <path class="check" stroke="${accent}" d="${check(scale)}"/>
  </g>`;
}

const svg = (size, label, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${label}">${extra}\n  ${body}\n</svg>\n`;

/* ── 1. the mark, once per ground ─────────────────────────────── */

/**
 * The two grounds a mark can be asked to sit on.
 *
 * Named for the ground and not for a theme: `dark` here means "the thing behind
 * this mark is dark", which is a fact about the placement and can be known at
 * the moment of placing it. Whether the reader's operating system is in night
 * mode is a different fact, about a different machine, and it was the wrong one
 * to draw from.
 */
const GROUNDS = {
  light: { ink: brand.basalt.light, accent: brand.petra.light },
  dark: { ink: brand.limestone.dark, accent: brand.petra.dark },
};

/* Classes as well as presentation attributes, for the reason markPaths gives:
   the attribute survives being inlined into a file whose <style> is stripped,
   the class is what a host can still override when it wants to. */
const sheet = (g) => `
  <style>
    .ring{stroke:${g.ink}}
    .check{stroke:${g.accent}}
  </style>`;

out('logo/mark.svg', CREDIT('mark, light ground') + svg(64, 'QA Wrap', markPaths(GROUNDS.light), sheet(GROUNDS.light)));
out('logo/mark-dark.svg', CREDIT('mark, dark ground') + svg(64, 'QA Wrap', markPaths(GROUNDS.dark), sheet(GROUNDS.dark)));

/* ── 1b. the small mark, once per ground ──────────────────────────────────
   Same file pair, same idea, but geometry from the ≤24px master (I01/I03):
   heavier stroke, check pushed outward, so the ring and the check don't fuse
   into a blob once the whole mark is 14–26px on the page. The app-icon-small
   variant below is this same geometry laid on the Petra tile; this pair is
   the transparent, on-any-ground version any <img class="brand-mark"> at a
   small size should use instead of shrinking the 64px master. */
const SMALL = { weight: 6, r: 17, scale: 1.06 };
out('logo/mark-small.svg', CREDIT('mark, small, light ground') + svg(64, 'QA Wrap', markPaths({ ...GROUNDS.light, ...SMALL }), sheet(GROUNDS.light)));
out('logo/mark-small-dark.svg', CREDIT('mark, small, dark ground') + svg(64, 'QA Wrap', markPaths({ ...GROUNDS.dark, ...SMALL }), sheet(GROUNDS.dark)));

/* ── 2. one colour, for anywhere the mark must take the text's colour ───── */
out('logo/mark-mono.svg', CREDIT('mark, one colour') + svg(64, 'QA Wrap', markPaths({ ink: 'currentColor', accent: 'currentColor' })));

/* ── 3. the ground: the identity colour in every theme, so the icon is one
       icon and not two ──────────────────────────────────────────────────── */
const onPetra = (label, size, opts = {}) => {
  const { weight = G.stroke, r = G.r, scale = 1 } = opts;
  const paper = brand.limestone.light;
  const tile = brand.petra.light;
  // On the accent tile both ring and check are paper, so at small sizes they
  // fuse where the check's vertex sits inside the ring's stroke band (I01).
  // Fixed by painting the check a second time first, as a knockout: same path,
  // tile-coloured, 8 units wider, laid down before the real paper check. That
  // cuts a trench of tile colour between ring and check wherever they would
  // otherwise share ink — three paths, not two, so a single `stroke="..."`
  // replace can no longer paint both objects the same colour by accident.
  return (
    CREDIT(label) +
    svg(
      size,
      'QA Wrap',
      `<rect width="64" height="64" rx="14" fill="${tile}"/>
  <g transform="translate(${G.nudge[0]} ${G.nudge[1]})" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path stroke="${paper}" stroke-width="${weight}" d="${ring(r)}"/>
    <path stroke="${tile}" stroke-width="${weight + 8}" d="${check(scale)}"/>
    <path stroke="${paper}" stroke-width="${weight}" d="${check(scale)}"/>
  </g>`
    )
  );
};
out('icons/favicon.svg', onPetra('favicon', 64));
out('icons/app-icon.svg', onPetra('app icon', 512));

/* ── 4. the small variant: lighter stroke, check pushed outward, so the I01
       knockout has room and 16 px is still the mark (I03) ─────────────────── */
out('icons/app-icon-small.svg', onPetra('app icon, 16–24 px', 64, { weight: 6, r: 17, scale: 1.06 }));

/* ── 4b. the shipped variant overrides the tile above ─────────────────────
   Same files, written a second time: `ACTIVE_ICON_VARIANT` is what the
   product actually ships (glass plate, ui-icons-2026-09-21), the tile above
   is `marks.mjs`'s own older design. Raw file, no CREDIT wrapper, matching
   what `apply-icon-variant.mjs` writes. */
if (ACTIVE_ICON_VARIANT) {
  const full = fs.readFileSync(path.join(WORK, ACTIVE_ICON_VARIANT, 'icon.svg'), 'utf8');
  const small = fs.readFileSync(path.join(WORK, ACTIVE_ICON_VARIANT, 'icon-small.svg'), 'utf8');
  out('icons/app-icon.svg', full);
  out('icons/app-icon-small.svg', small);
  out('icons/favicon.svg', small);
}

/* ── 5. the construction sheet: why the shape is the shape ──────────────── */
{
  const grid = [];
  for (let i = 8; i <= 56; i += 8) {
    grid.push(`<line x1="${i}" y1="4" x2="${i}" y2="60" stroke="${brand.tortilla.light}" stroke-width=".3"/>`);
    grid.push(`<line x1="4" y1="${i}" x2="60" y2="${i}" stroke="${brand.tortilla.light}" stroke-width=".3"/>`);
  }
  const [lx, ly] = on(-(G.seam - G.half));
  const [hx, hy] = on(-(G.seam + G.half));
  out(
    'logo/construction.svg',
    CREDIT('construction') +
      svg(
        512,
        'QA Wrap mark construction',
        `<g transform="translate(${G.nudge[0]} ${G.nudge[1]})">
    ${grid.join('\n    ')}
    <circle cx="${G.cx}" cy="${G.cy}" r="${G.r}" fill="none" stroke="${brand.petra.light}" stroke-width=".4" stroke-dasharray="2 2"/>
    <line x1="${G.cx}" y1="${G.cy}" x2="${f(lx)}" y2="${f(ly)}" stroke="${brand.petra.light}" stroke-width=".4"/>
    <line x1="${G.cx}" y1="${G.cy}" x2="${f(hx)}" y2="${f(hy)}" stroke="${brand.petra.light}" stroke-width=".4"/>
    <circle cx="${G.cx}" cy="${G.cy}" r=".8" fill="${brand.petra.light}"/>
  </g>
  <g transform="translate(${G.nudge[0]} ${G.nudge[1]})" fill="none" stroke-width="${G.stroke}" stroke-linecap="round" stroke-linejoin="round" opacity=".92">
    <path d="${ring()}" stroke="${brand.basalt.light}"/>
    <path d="${check()}" stroke="${brand.petra.light}"/>
  </g>`
      )
  );
}

/* ── 6. the motion variant: the same mark, told to move ─────────────────── */
/**
 * `logo/mark-motion.svg` is mark.svg plus two named states. It is a second
 * file rather than a flag on the first because the static mark is what every
 * document cover, store tile and report embeds, and those must never move.
 *
 * Two ways in, because the mark is used both ways:
 *
 *   inlined    a class on any ancestor — `qaw-wake`, `qaw-recording` — reaches
 *              the paths, because an inlined <style> becomes part of the host
 *              page's stylesheet.
 *   in <img>   the SVG is its own isolated document there, so no host class can
 *              reach inside it. The state travels in the URL fragment instead
 *              (`mark-motion.svg#wake`) and `:target` picks it up; the two
 *              empty <g> elements exist only to be targeted. This was measured
 *              in Chromium before it was written this way — `:target` inside an
 *              image document is the one hook that survives the isolation.
 *
 * The dash lengths are the paths' own lengths, computed here rather than
 * guessed: a dasharray shorter than its path draws a gap, which on a ring
 * reads as a second seam.
 */

/**
 * How much of the circle `ring()` actually draws.
 *
 * Not `360 − 2·half`. `ring()` starts its arc at −28° and ends at −73°, and
 * asks for the large arc the counter-clockwise way, so what it draws is the
 * 315° that are left after that 45° hop — the seam on the page is narrower
 * than the ±28° the construction sheet marks out. The number matters here and
 * nowhere else: a dasharray of 304°-worth on a 315° path draws a nick at the
 * seam that reads as a second opening. Measured against getTotalLength():
 * 93.4655 for the ring, 37.3679 for the check.
 */
const ringSweep = () => {
  const a = -(G.half - G.seam) - 2 * G.seam + G.seam; // ring()'s own start angle
  const b = -(G.seam + G.half);                       // and its end
  return 360 - ((((a - b) % 360) + 360) % 360);
};
const ringLength = (r = G.r) => (2 * Math.PI * r * ringSweep()) / 360;

/** The check's length: two straight segments, so Pythagoras twice. */
function checkLength(scale = 1) {
  const p = G.check.map(([x, y]) => [G.cx + (x - G.cx) * scale, G.cy + (y - G.cy) * scale]);
  return Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) + Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
}

{
  // Rounded up, so the dash is never a hair shorter than what it must cover.
  const dashRing = f(Math.ceil(ringLength() * 10) / 10);
  const dashCheck = f(Math.ceil(checkLength() * 10) / 10);

  /**
   * One motion file per ground, for the reason in the header: an animated mark
   * that flips palette on a fixed background is the same bug as a static one
   * that flips, only it moves while it does it.
   */
  const motion = (g) => `
  <style>
    .ring{stroke:${g.ink}}
    .check{stroke:${g.accent}}

    /* At rest this file is mark.svg exactly. The dashes are longer than the
       paths they sit on, so nothing is hidden until an offset moves. */
    .ring{stroke-dasharray:${dashRing};stroke-dashoffset:0}
    .check{stroke-dasharray:${dashCheck};stroke-dashoffset:0;transform-box:fill-box;transform-origin:50% 50%}

    @keyframes qaw-ring-draw{from{stroke-dashoffset:${dashRing}}to{stroke-dashoffset:0}}
    /* The check overshoots by 4% as it lands and settles back: the verdict
       arrives, it does not glide in. */
    @keyframes qaw-check-in{
      0%{stroke-dashoffset:${dashCheck};transform:scale(1)}
      70%{stroke-dashoffset:0;transform:scale(1.04)}
      100%{stroke-dashoffset:0;transform:scale(1)}
    }
    /* a tiny settle after the draw finishes — the only thing ever animated
       on the group itself, and it never loops. */
    @keyframes qaw-mark-settle{0%{transform:scale(1.015)}100%{transform:scale(1)}}

    /* wake: the wrap closes, then the verdict comes out of the seam. 520 + 260,
       so the whole thing is done in 780 ms and never outlives the window
       opening it. */
    #wake:target ~ .mark .ring,.qaw-wake .ring{animation:qaw-ring-draw 520ms cubic-bezier(.2,.8,.2,1) both}
    #wake:target ~ .mark .check,.qaw-wake .check{animation:qaw-check-in 260ms cubic-bezier(.2,.8,.2,1) 520ms both}
    /* recording: no longer breathes — the status chip's own timer is the
       sign of life now (DESIGN-SPEC §1.11, UI rework round 2). The hooks
       stay wired so a future state has somewhere to attach. */
    #recording:target ~ .mark .check,.qaw-recording .check{}

    /* draw: the large mark's own first-paint entrance (welcome, empty report,
       tutorials) — never the popup header. Same ring+check as wake, plus a
       140ms settle, ~900ms total; SMIL/CSS only, no script, hooked the same
       two ways: :target for an image src, a class for an inlined copy. */
    #draw:target ~ .mark .ring,.qaw-draw .ring{animation:qaw-ring-draw 520ms cubic-bezier(.2,.8,.2,1) both}
    #draw:target ~ .mark .check,.qaw-draw .check{animation:qaw-check-in 260ms cubic-bezier(.2,.8,.2,1) 520ms both}
    #draw:target ~ .mark,.qaw-draw .mark{transform-origin:50% 50%;animation:qaw-mark-settle 140ms cubic-bezier(.2,.8,.2,1) 780ms both}

    @media (prefers-reduced-motion:reduce){
      .ring,.check,.mark{animation:none!important;stroke-dashoffset:0!important;opacity:1!important;transform:none!important}
    }
  </style>`;

  const moving = (g) =>
    svg(
      64,
      'QA Wrap',
      `<g id="wake"/><g id="recording"/><g id="draw"/>
  ${markPaths(g).replace('<g transform=', '<g class="mark" transform=')}`,
      motion(g)
    );

  out('logo/mark-motion.svg', CREDIT('mark, animated, light ground') + moving(GROUNDS.light));
  out('logo/mark-motion-dark.svg', CREDIT('mark, animated, dark ground') + moving(GROUNDS.dark));
}

console.log(`\nMark regenerated: ring r${G.r}, stroke ${G.stroke}, seam ${G.seam}°±${G.half}°. ${semantic ? '' : ''}`);
console.log('Run tools/preview.mjs --icons for the PNG sizes, then tools/product-lockup.mjs for the lockups.');
