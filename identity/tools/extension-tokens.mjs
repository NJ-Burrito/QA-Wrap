/* =============================================================================
   QA Wrap identity — the extension's copy of the tokens.

     node tools/extension-tokens.mjs

   Writes extension/ui/identity-tokens.css from the generated tokens.css plus
   the one block the extension has and the kit does not: the two state rings
   the popup draws around a live recording and around a control being reached
   for. They are re-expressed in the current palette here, so the kit stays the
   single source and the extension never carries a hand-edited copy that drifts.

   These were five --neon-* tokens, and they were neon in the literal sense: a
   1px ring plus up to three stacked blurs reaching 34px, which is a glow and
   not a border. Three of the five (--neon-accent, --neon-ok, --neon-rail) were
   read by no stylesheet at all. What survives is two rings with no blur:

     --ring-live   the recording state, the one state where being wrong about
                   it matters, drawn as a 2px ring in the failure colour.
     --ring-quiet  a control under the pointer or holding a choice: 1px, the
                   accent, and nothing else.

   A ring is a border you can put on an element that already has one. A glow is
   a claim that light is coming off a QA panel.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { semantic } from './tokens.source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'tokens/tokens.css');
const DST = path.resolve(ROOT, '../extension/ui/identity-tokens.css');

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/* No blur in either theme. The night values carry more alpha because the same
   ring on a basalt ground is doing more work to be seen at all.
   --ring-live re-points to --live (D4, UI rework round 2, S1): red stays
   FAIL-only, so the recording ring is no longer built from the fail colour. */
const rings = (mode) => {
  const a = semantic.accent[mode];
  const quiet = mode === 'light' ? 0.55 : 0.7;
  return `  --ring-live: 0 0 0 2px var(--live);
  --ring-quiet: 0 0 0 1px ${rgba(a, quiet)};`;
};

/* ── extension-only additions, UI rework round 2 (S1) ────────────────────────
 *
 * These have no equivalent in the shared identity kit (they are popup/in-page
 * concepts: pick purposes, the glass surfaces, the state-layer opacities) —
 * same reason the two rings above live here and not in tokens.source.mjs.
 * Values are the prototype's (work/ui-rework-0927/prototype/tokens.css §2).
 *
 * The glass block (surface-glass, backdrop, shadow-glass, ...) REPLACES what
 * used to be hand-patched directly into extension/ui/identity-tokens.css
 * (research/138 Stage 1b) — this generator now owns it, so a regeneration
 * from tools.source.mjs never again silently drops it.
 */
const GLASS_RGB = { light: '255, 255, 255', dark: '22, 27, 34' };
const BACKDROP = {
  light: 'radial-gradient(120% 90% at 12% 0%, #F6EBD9 0%, #F4F2ED 55%, #EFECE6 100%)',
  dark: 'radial-gradient(120% 90% at 12% 0%, #2A2418 0%, #16181B 55%, #141619 100%)',
};
const SHADOW_GLASS = {
  light: '0 16px 40px rgba(29, 32, 36, 0.18), 0 2px 6px rgba(29, 32, 36, 0.08)',
  dark: '0 16px 40px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.35)',
};
const GLASS_LINE = { light: 'rgba(29, 32, 36, 0.10)', dark: 'rgba(239, 237, 232, 0.10)' };
const GLASS_EDGE = { light: 'rgba(255, 255, 255, 0.90)', dark: 'rgba(255, 255, 255, 0.14)' };
const GLASS_HIGHLIGHT = { light: 'rgba(255, 255, 255, 0.55)', dark: 'rgba(255, 255, 255, 0.08)' };
const STATE = { light: [0.08, 0.14], dark: [0.10, 0.16] };
const P_INK = {
  light: { any: '#7B4E0E', step: '#1553AE', element: '#1F6650', sensitive: '#6A3C78' },
  dark: { any: '#F1BE5C', step: '#8AB6F5', element: '#7FCCAE', sensitive: '#CDA6DE' },
};
const INVERSE = {
  light: { surface: '#1D2024', text: '#F4F2ED' },
  dark: { surface: '#EFEDE8', text: '#1D2024' },
};

/* Themed: present in :root, the dark media block and [data-theme="dark"]. */
const extras = (mode) => `  --surface-glass: rgba(${GLASS_RGB[mode]}, 0.86);
  --surface-glass-strong: rgba(${GLASS_RGB[mode]}, 0.86);
  --backdrop: ${BACKDROP[mode]};
  --glass-edge: ${GLASS_EDGE[mode]};
  --glass-highlight: ${GLASS_HIGHLIGHT[mode]};
  --glass-line: ${GLASS_LINE[mode]};
  --shadow-glass: ${SHADOW_GLASS[mode]};
  --state-hover: ${STATE[mode][0]};
  --state-press: ${STATE[mode][1]};
  --p-any-ink: ${P_INK[mode].any};
  --p-step-ink: ${P_INK[mode].step};
  --p-element-ink: ${P_INK[mode].element};
  --p-sensitive-ink: ${P_INK[mode].sensitive};
  --surface-inverse: ${INVERSE[mode].surface};
  --text-inverse: ${INVERSE[mode].text};
  --live: var(--accent);
  --focus: var(--accent);`;

/* Theme-independent (the prototype defines these once, in :root, with no
   dark override — same pattern the pre-existing --blur/--ring-glass used). */
const UNTHEMED = `  --blur: 20px;
  --ring-glass: 0 0 0 2px var(--border-strong);
  --glass-sat: 140%;
  --p-any: #8E5A10;
  --p-step: #1760C8;
  --p-element: #2E7D62;
  --p-sensitive: #6A3C78;
  --on-purpose: #FFFFFF;
  --ring-halo: #FFFFFF;`;

/* Type — Thmanyah (owner decision, research/138, 21 Sept 2026; Cairo banned, no exceptions). Since D-1010-121 the kit's own
   `S.type` names the Thmanyah families, so the generated CSS already carries them; this only refuses a regression. Serif Display
   for display moments only, Sans everywhere else; --mono has no Thmanyah monospace: code text uses Thmanyah Sans (T-024). */
const TYPE_OVERRIDE = `--display: "Thmanyah Serif Display", "Thmanyah Sans", system-ui, "Segoe UI", Tahoma, sans-serif;
  --font: "Thmanyah Sans", system-ui, "Segoe UI", Tahoma, sans-serif;
  --mono: "Thmanyah Sans", system-ui, sans-serif;`;

let css = fs.readFileSync(SRC, 'utf8');

if (!css.includes(TYPE_OVERRIDE)) throw new Error('identity/tokens/tokens.css no longer carries the Thmanyah type tokens: run `node identity/tools/tokens.mjs` after fixing tokens.source.mjs');

/* Motion — aliases onto the one system in ui/motion.css (F06). The old
 * names survive so the ~30 existing call sites keep working; identity no
 * longer ships dur-move/dur-panel/dur-turn at all, so there is nothing left
 * to alias for those three. */
css = css.replace(
  /--ease: cubic-bezier\([^)]*\);\n  --ease-pop: cubic-bezier\([^)]*\);\n  --dur-tap: \d+ms;/,
  `/* Motion — aliases onto the one system in ui/motion.css (F06). --ease and
     --dur-tap survive so the ~30 existing call sites keep working. --ease-pop
     is deleted (UI rework round 2, S11b): no stylesheet read it, and its
     value was --motion-emphasis, which is itself gone — a curve of its own
     for a caller that never existed. */
  --ease: var(--motion-ease);
  --dur-tap: var(--motion-fast);`
);

/* Reduced-motion, per-surface (F07): identity leaves the comment generic
 * because it has no motion.css of its own; the extension does, so it names
 * it here. */
css = css.replace(
  /\/\* Reduced-motion is handled per-surface, by name, in each consumer's own\n   motion system — never as a global `\*` sledgehammer \(F07\)\. \*\//,
  `/* Reduced-motion is handled per-surface, by name, in ui/motion.css and each
   surface's own stylesheet (F07) — never as a global \`*\` sledgehammer. */`
);

// Light block: the bare :root. Dark: both the media block and the explicit override.
// Each closing brace of those three blocks gets the neon lines before it.
/*
 * `closer` is a parameter and not a constant because of a bug this file shipped
 * with. The dark block inside `@media (prefers-color-scheme: dark)` closes with
 * an INDENTED `}`, so `indexOf('\n}')` walked straight past it to the media
 * query's own closing brace, and every dark-mode glow was written at the top
 * level of an at-rule, where a declaration is not allowed. The browser dropped
 * all five, silently, for as long as the tokens have existed.
 */
const inject = (source, opener, lines, closer = '\n}') => {
  const i = source.indexOf(opener);
  if (i < 0) throw new Error(`token block not found: ${opener}`);
  const close = source.indexOf(closer, i);
  if (close < 0) throw new Error(`block never closes: ${opener}`);
  return source.slice(0, close) + '\n\n  /* state rings, from tools/extension-tokens.mjs */\n' + lines + source.slice(close);
};
css = inject(css, ':root {', rings('light'));
css = inject(css, ':root {', extras('light'));
css = inject(css, ':root {', UNTHEMED);
css = inject(css, ':root:not([data-theme="light"]) {', rings('dark').replace(/^  /gm, '    '), '\n  }');
css = inject(css, ':root:not([data-theme="light"]) {', extras('dark').replace(/^  /gm, '    '), '\n  }');
css = inject(css, ':root[data-theme="dark"] {', rings('dark'));
css = inject(css, ':root[data-theme="dark"] {', extras('dark'));

/* ── which mark an <img> shows ─────────────────────────────────────────────
 *
 * A mark's colours follow its HOST. Inside the extension the host is a page
 * whose theme the tester chose — light, dark, midnight, or "follow my machine"
 * — and that choice is not the same fact as the operating system's colour
 * scheme. It used to be treated as the same fact, because the mark carried its
 * own `@media (prefers-color-scheme: dark)`: a tester on a light machine who
 * set QA Wrap to night got the light-ground mark, dark ink, on the night
 * surface. The measurement that started this was the other direction — a night
 * machine opening a mark on a forced-white page, 1.20:1 on the wordmark.
 *
 * An `<img>` renders an isolated document, so `currentColor` cannot reach into
 * it and no host class can either. The only thing that can is the URL, so the
 * URL is what the theme picks. `content: url()` swaps the image the element
 * renders; the `src` attribute is left alone, which matters because ui/motion.js
 * drives the wake and the recording breathe by rewriting `src` — including the
 * `#wake` / `#recording` fragment that the animation is keyed on. Each state
 * gets its own rule so the fragment survives the swap.
 *
 * `-light` is not listed: the light-ground files ARE `mark.svg` and
 * `mark-motion.svg`, so a light theme needs no rule at all and the default is
 * already right.
 */
const markSwap = (scope, indent) =>
  [
    'img[src*="mark.svg"] { content: url("../brand/mark-dark.svg"); }',
    // Same swap, for the ≤24px master (I01/I03). The selector is
    // `mark-small.svg` and not `small.svg`, so it cannot also catch a future
    // `*-small.svg` file that isn't this mark.
    'img[src*="mark-small.svg"] { content: url("../brand/mark-small-dark.svg"); }',
    'img[src*="mark-motion.svg"][src$="#wake"] { content: url("../brand/mark-motion-dark.svg#wake"); }',
    'img[src*="mark-motion.svg"][src$="#recording"] { content: url("../brand/mark-motion-dark.svg#recording"); }',
    'img[src*="mark-motion.svg"]:not([src*="#"]) { content: url("../brand/mark-motion-dark.svg"); }',
  ]
    .map((rule) => `${indent}${scope} ${rule}`)
    .join('\n');

/* These are rules, not custom properties, so they cannot live inside the
   `:root { … }` blocks the tokens are injected into — a declaration block holds
   declarations. They are appended after them instead, each carrying the same
   condition as the token block it belongs to, so the three theme states stay in
   step with the palette. */
const marks = `

/* ── the mark takes its ground from the theme, not from the machine ──────── */
@media (prefers-color-scheme: dark) {
${markSwap(':root:not([data-theme="light"])', '  ')}
}
${markSwap(':root[data-theme="dark"]', '')}
`;

const header = `/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/* QA Wrap design tokens — the identity, as values.
 *
 * GENERATED by identity/tools/extension-tokens.mjs from identity/tokens/tokens.css,
 * which is itself generated from identity/tools/tokens.source.mjs. Edit the
 * source, run \`node tools/tokens.mjs && node tools/extension-tokens.mjs\` in
 * identity/, and this file follows. Hand edits here are overwritten.
 *
 * Three theme states, and all three are deliberate: bare \`:root\` is the light
 * palette, \`prefers-color-scheme: dark\` covers the default "follow my machine"
 * setting where nothing is stamped on the root, and \`[data-theme]\` lets an
 * explicit choice beat the OS in either direction.
 */
`;

fs.writeFileSync(DST, header + css.replace(/^\/\*[\s\S]*?\*\/\n/, '') + marks, 'utf8');
console.log('  wrote ' + path.relative(ROOT, DST) + ` (${(fs.statSync(DST).size / 1024).toFixed(1)} KB)`);

/* ── the in-page overlay's copy (UI rework round 2, S8) ─────────────────────
 *
 * content/overlay.css draws inside a closed shadow root on a stranger's page,
 * where identity-tokens.css is never loaded (it styles `body` and `*`). So the
 * tokens the overlay reads are written into a marked region at the top of that
 * file as `--uqa-<name>`, resolved to plain values: light on `:host`, dark in
 * the same three theme states the palette uses (the host carries
 * `data-theme`, content/ui-host.js). Declared on `:host`, every layer inherits
 * them — the tip-only declaration that left the pick box with no colour
 * (decision 132) cannot recur. A second, page-scope block carries the few
 * values the masking and injector rules paint into the page itself.
 * tools/test-styles.mjs re-resolves each one and fails when they drift.
 */
const OVERLAY = path.resolve(ROOT, '../extension/content/overlay.css');
const MOTION = path.resolve(ROOT, '../extension/ui/motion.css');
const HOST_TOKENS = [
  'surface', 'surface-sunken', 'surface-raised', 'surface-glass', 'text', 'text-muted',
  'border', 'border-strong', 'accent', 'accent-text', 'accent-ink', 'live', 'focus',
  'pass-ink', 'warn-soft', 'warn-ink', 'glass-line', 'glass-edge', 'shadow-2', 'shadow-glass',
  'blur', 'glass-sat', 'state-hover', 'state-press',
  'p-any', 'p-step', 'p-element', 'p-sensitive', 'p-any-ink', 'p-step-ink', 'p-element-ink', 'p-sensitive-ink',
  'on-purpose', 'ring-halo', 'surface-inverse', 'text-inverse', 'brand-basalt', 'brand-limestone', 'brand-petra',
  'r-sm', 'r-md', 'r-lg', 'r-xl', 'r-pill', 'motion-fast', 'motion-base', 'motion-slow', 'motion-ease',
];
const PAGE_TOKENS = ['brand-basalt', 'brand-limestone', 'ring-halo', 'accent'];
const PAGE_SCOPE = '.uqa-injecting, [data-uqa-masked], [data-uqa-masked-media], [data-uqa-masked-field]';

/** `{ light, dark }` maps of every custom property a sheet declares, by theme. */
function tokenMaps(text) {
  const light = {};
  const dark = {};
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') { stack.push(src.slice(start, i).trim()); start = i + 1; }
    else if (src[i] === '}') {
      const sel = stack.pop();
      const at = stack.join(' ');
      const into = sel === ':root' && !at ? light
        : sel === ':root[data-theme="dark"]' && !at ? dark : null;
      if (into) for (const m of src.slice(start, i).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) into[m[1].slice(2)] = m[2].trim();
      start = i + 1;
    } else if (src[i] === ';' && !stack.length) start = i + 1;
  }
  return { light, dark: { ...light, ...dark } };
}

/** A value with every `var(--x)` it reads replaced by x's own value. */
function resolveToken(map, name, seen = new Set()) {
  if (seen.has(name) || map[name] == null) throw new Error(`token --${name} does not resolve`);
  seen.add(name);
  return map[name].replace(/var\(\s*--([a-z0-9-]+)\s*(?:,[^)]*)?\)/g, (_, n) => resolveToken(map, n, new Set(seen)));
}

const written = fs.readFileSync(DST, 'utf8') + '\n' + fs.readFileSync(MOTION, 'utf8');
const maps = tokenMaps(written);
const decl = (mode, names, indent) =>
  names.map((n) => `${indent}--uqa-${n}: ${resolveToken(maps[mode], n)};`).join('\n');
const themed = HOST_TOKENS.filter((n) => resolveToken(maps.light, n) !== resolveToken(maps.dark, n));
const region = `/* uqa-tokens:start — GENERATED by identity/tools/extension-tokens.mjs; edit the source, not these lines. */
:host {
  color-scheme: light;
${decl('light', HOST_TOKENS, '  ')}
}
@media (prefers-color-scheme: dark) {
  :host(:not([data-theme="light"])) {
    color-scheme: dark;
${decl('dark', themed, '    ')}
  }
}
:host([data-theme="dark"]) {
  color-scheme: dark;
${decl('dark', themed, '  ')}
}
${PAGE_SCOPE} {
${decl('light', PAGE_TOKENS, '  ')}
}
@media (prefers-color-scheme: dark) {
  ${PAGE_SCOPE} {
${decl('dark', ['accent'], '    ')}
  }
}
/* uqa-tokens:end */`;

const overlay = fs.readFileSync(OVERLAY, 'utf8');
const marked = /\/\* uqa-tokens:start[\s\S]*?\/\* uqa-tokens:end \*\//;
if (!marked.test(overlay)) throw new Error('content/overlay.css has no uqa-tokens region to fill');
fs.writeFileSync(OVERLAY, overlay.replace(marked, region), 'utf8');
console.log(`  wrote the uqa-tokens region of content/overlay.css (${HOST_TOKENS.length} host tokens, ${themed.length} themed)`);
