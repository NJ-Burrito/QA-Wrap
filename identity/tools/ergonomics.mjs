/**
 * Palette ergonomics audit.
 *
 *   node tools/ergonomics.mjs
 *
 * WCAG contrast answers "can this be read at all". It says nothing about
 * whether a person can look at it for seven hours. This checks both, using
 * OKLCH for the perceptual measures because sRGB numbers do not correspond to
 * what an eye actually experiences.
 *
 * The thresholds below are the ones that matter for sustained work:
 *
 *   contrast 4.5   the floor. Below it, text fails WCAG AA outright.
 *   contrast 7-12  the comfortable band for body text over long sessions.
 *   contrast >15   harsh. In dark mode it produces halation — light text
 *                  blooming into the background — which is worst for readers
 *                  with astigmatism, i.e. a large minority of any team.
 *   chroma <=0.045 for any large surface. A saturated ground drives chromatic
 *                  adaptation: stare at it long enough and the rest of the
 *                  screen shifts colour. Warmth is fine; saturation is not.
 *   dark L >=0.17  a near-black ground maximises halation. Material and the
 *                  Apple HIG both land around #121212-#1E1E1E for this reason.
 */
import { neutral, surface, semantic, brand } from './tokens.source.mjs';

/* ── colour maths ─────────────────────────────────────────────────────── */

const hex = (h) => {
  const s = h.replace('#', '');
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
};

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function relLuminance(h) {
  const [r, g, b] = hex(h).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [relLuminance(a), relLuminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** sRGB → OKLab → OKLCH. Perceptual lightness and chroma. */
export function oklch(h) {
  const [r, g, b] = hex(h).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI };
}

/* ── the pairs that actually appear on screen ─────────────────────────── */

const resolve = (token, mode) => {
  const v = token?.[mode];
  if (!v) return null;
  if (!v.startsWith('var(')) return v.startsWith('#') ? v : null;
  const name = v.slice(6, -1); // var(--n-900) → n-900
  const step = name.replace('n-', '');
  return neutral[step]?.[mode] ?? null;
};

function palette(mode) {
  const p = {};
  for (const [k, v] of Object.entries(neutral)) p[`n-${k}`] = v[mode];
  for (const [k, v] of Object.entries(surface)) p[k] = resolve(v, mode);
  for (const [k, v] of Object.entries(semantic)) p[k] = resolve(v, mode);
  for (const [k, v] of Object.entries(brand)) p[`brand-${k}`] = v[mode];
  return p;
}

/** foreground, background, what it is, and whether it is body text. */
const PAIRS = [
  ['text', 'surface', 'body text on a card', true],
  ['text', 'surface-sunken', 'body text on the ground', true],
  ['text', 'surface-raised', 'body text on a raised surface', true],
  ['text-muted', 'surface', 'muted text on a card', false],
  ['text-muted', 'surface-sunken', 'muted text on the ground', false],
  ['accent-ink', 'accent-soft', 'accent text on its own tint', false],
  ['accent-ink', 'surface', 'accent text on a card', false],
  ['accent-text', 'accent', 'text on an accent fill', false],
  ['fail', 'surface', 'FAIL text', false],
  ['fail', 'fail-soft', 'FAIL on its tint', false],
  ['pass', 'surface', 'PASS text', false],
  ['pass', 'pass-soft', 'PASS on its tint', false],
  ['blocked', 'surface', 'BLOCKED text', false],
  ['blocked', 'blocked-soft', 'BLOCKED on its tint', false],
  ['skipped', 'surface', 'SKIPPED text', false],
  ['skipped', 'skipped-soft', 'SKIPPED on its tint', false],
];

/** Surfaces a person stares at for hours. */
const LARGE_SURFACES = ['surface', 'surface-sunken', 'surface-raised'];

/* ── report ───────────────────────────────────────────────────────────── */

let problems = 0;
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 5) => String(v).padStart(n);

for (const mode of ['light', 'dark']) {
  const p = palette(mode);
  console.log(`\n══ ${mode} ═══════════════════════════════════════════════════════════════`);
  console.log(`  ${pad('pair', 34)}${num('ratio')}  verdict`);
  console.log('  ' + '─'.repeat(62));

  for (const [fg, bg, label, isBody] of PAIRS) {
    if (!p[fg] || !p[bg]) continue;
    const r = +contrast(p[fg], p[bg]).toFixed(2);

    let verdict = 'ok';
    if (r < 4.5) { verdict = 'FAILS AA'; problems++; }
    else if (isBody && r > 15) { verdict = 'harsh for long sessions'; problems++; }
    else if (isBody && r < 7) { verdict = 'thin for body text'; problems++; }
    else if (!isBody && r < 4.5) { verdict = 'FAILS AA'; problems++; }

    console.log(`  ${pad(label, 34)}${num(r)}  ${verdict}`);
  }

  console.log(`\n  ${pad('large surface', 34)}${num('L')}${num('C', 8)}  verdict`);
  console.log('  ' + '─'.repeat(62));
  for (const name of LARGE_SURFACES) {
    const v = p[name];
    if (!v) continue;
    const { L, C } = oklch(v);
    const verdicts = [];
    if (C > 0.045) { verdicts.push('saturated — drives colour adaptation'); problems++; }
    if (mode === 'dark' && L < 0.17) { verdicts.push('near-black — halation risk'); problems++; }
    if (mode === 'light' && L > 0.985) verdicts.push('near-white — glare');
    console.log(
      `  ${pad(`${name}  ${v}`, 34)}${num(L.toFixed(3))}${num(C.toFixed(3), 8)}  ${verdicts.join('; ') || 'ok'}`
    );
  }
}

console.log(
  `\n${problems ? `${problems} comfort issue(s)` : 'palette is comfortable for sustained work'}`
);
process.exitCode = problems ? 1 : 0;
