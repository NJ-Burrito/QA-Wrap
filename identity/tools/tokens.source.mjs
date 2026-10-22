/* =============================================================================
   QA Wrap — the single source of truth for the identity.
   Edit HERE, then run `node tools/tokens.mjs` to regenerate every format.

   Third identity, 3 September 2026: "Salsa & Slate — Amman edition".
   Approved from identity/proposals/2026-09-03-palette-v2.png.

     The tool is an instrument for evidence, and it comes from Amman.
     Limestone grounds and basalt ink carry the work. The four results a
     tester reports — PASS, FAIL, BLOCKED, SKIPPED — are the only colours
     that speak. Petra sandstone is the failure colour; the one action
     colour is ochre (decision 118, 17 Sept 2026), no longer the same hue as
     FAIL. Wadi Rum ochre was BLOCKED's colour until then — BLOCKED is now
     re-pitched to an olive-mustard so it cannot collide with the new
     accent. The burrito keeps the warmth: tortilla for borders and foil,
     corn as the small highlight, guac for a pass.

   Two theme states, both first-class: LIGHT (limestone) and DARK (basalt
   night). Midnight retired (Nader, 27 Sept 2026, UI rework round 2): a third
   near-black mode was one mode too many for the value it added. Thmanyah is
   the only family (owner, 18 and 27 Sept 2026): Serif Display for display
   moments, Sans everywhere else.

   Two layers, deliberately kept apart:

   BRAND    the expressive palette. Marks, the icon, marketing, large tints.
   COMFORT  These values are tuned for sustained work, and verified by
            `node tools/ergonomics.mjs`. Large surfaces stay below OKLCH
            chroma 0.045; the dark ground stays above L 0.17; body-text
            contrast is aimed at 7-13:1.

   SEMANTIC the UI palette. Text, states, borders, and the four results.
            `ok / danger / warn / info` are kept as aliases of
            pass / fail / blocked / skipped so nothing already written breaks.
   ========================================================================== */

import fs from 'node:fs';

/** The maker is not typed here: extension/brand/brand.json is the one place a human edits it (rebrand = one edit, then re-run the identity tools). */
const BRAND = JSON.parse(fs.readFileSync(new URL('../../extension/brand/brand.json', import.meta.url), 'utf8'));

export const meta = {
  name: BRAND.name,
  /** The rights holder: a legal entity or a person, never the product's own name. From brand.json `maker`. */
  owner: BRAND.maker.en,
  /** The by-line under the wordmark, the only place the maker is named in the lockup. From brand.json `maker`. */
  byline: `by ${BRAND.maker.en}`,
  /** Whoever publishes it. From brand.json `publisher`. */
  publisher: BRAND.publisher.en,
  version: '3.1.0',
};

/* ------------------------------------------------------------------- brand */
export const brand = {
  petra:     { light: '#B5432B', dark: '#FF8A6E', use: 'Rose-red sandstone. FAIL. Never decoration. (Was also the one action colour; accent moved to ochre, decision 118.)' },
  guac:      { light: '#2A7A3B', dark: '#7ED08A', use: 'A pass. Saved, complete, verified.' },
  corn:      { light: '#E2AE38', dark: '#FFD166', use: 'The small warm highlight — foil catching light. Never carries small text.' },
  tortilla:  { light: '#D8C6A4', dark: '#6F5C40', use: 'Borders, the foil, the burrito.' },
  limestone: { light: '#F1EFE9', dark: '#ECEAE3', use: 'Amman by day: the ground in light, the ink at night.' },
  basalt:    { light: '#1D2024', dark: '#15181B', use: 'The northern basalt: the ink by day, the ground at night.' },
  wadirum:   { light: '#8E5A10', dark: '#F1BE5C', use: 'Ochre. BLOCKED, and nothing else.' },
};

/* ---------------------------------------------------------------- neutrals */
/* One ramp, limestone to basalt, warm-grey in the middle. Never a blue grey. */
export const neutral = {
  0:   { light: '#FAF8F4', dark: '#262B30' },
  25:  { light: '#F6F4EF', dark: '#20252A' },
  50:  { light: '#F1EFE9', dark: '#15181B' },
  100: { light: '#E8E5DE', dark: '#2C3238' },
  200: { light: '#DAD6CD', dark: '#323940' },
  300: { light: '#B4B0A6', dark: '#454C53' },
  500: { light: '#5D646B', dark: '#A3A9AF' },
  600: { light: '#4C535A', dark: '#B9BFC4' },
  700: { light: '#353B41', dark: '#CDD2D6' },
  900: { light: '#262B30', dark: '#ECEAE3' },
};

/* ---------------------------------------------------------------- surfaces */
/* 'border'/'border-strong' and 'surface-raised' re-valued to the prototype's
   --line/--line-strong/--surface-2 (UI rework round 2, work/ui-rework-0927/
   prototype/tokens.css §2; extension keeps its own names, S1). */
export const surface = {
  'surface':         { light: 'var(--n-0)',   dark: '#1D2125' },
  'surface-sunken':  { light: 'var(--n-50)',  dark: '#15181B' },
  'surface-raised':  { light: '#F7F5F1',      dark: '#272A2F' },
  'border':          { light: 'rgba(29, 32, 36, 0.12)',  dark: 'rgba(239, 237, 232, 0.12)' },
  'border-strong':   { light: '#82868D',                  dark: '#7A7F86' },
  'text':            { light: 'var(--n-900)', dark: 'var(--n-900)' },
  'text-muted':      { light: 'var(--n-500)', dark: 'var(--n-500)' },
};

/* ---------------------------------------------------------------- semantic */
/* pass/fail/blocked(warn)/skipped + their -soft and new -ink pairs re-valued
   to the prototype's --pass/--fail/--warn/--skipped (UI rework round 2,
   work/ui-rework-0927/prototype/tokens.css §2). 'blocked' keeps its name
   (extension convention) but takes the prototype's --warn value: the
   prototype folds BLOCKED into the same "warn" bucket as restricted/worker
   errors, so red stays FAIL-only (D4). accent-text re-valued to the
   prototype's --on-accent. */
export const semantic = {
  /* the one action colour */
  accent:        { light: '#8E5A10', dark: '#F1BE5C', use: 'Ochre, as the interactive fill (decision 118). Was Petra.' },
  'accent-hover':{ light: '#794D0E', dark: '#F3C670' },
  'accent-soft': { light: '#F8EBD8', dark: '#3B2E15' },
  'accent-text': { light: '#FFFFFF', dark: '#1D1405', use: 'Text ON an accent fill.' },
  'accent-ink':  { light: '#633F0B', dark: '#F5D08A', use: 'Accent-coloured TEXT on a pale ground or on its tint. AA at 14px.' },

  /* the four results — the only colours that speak */
  pass:           { light: '#2A7A3B', dark: '#7ED08A', use: 'PASS. Guac.' },
  'pass-soft':    { light: '#E1F0E3', dark: '#1B3321' },
  'pass-ink':     { light: '#1E6630', dark: '#8FDB9A', use: 'PASS text on its own tint or on a pale ground.' },
  fail:           { light: '#B5432B', dark: '#FF9270', use: 'FAIL. Petra.' },
  'fail-soft':    { light: '#FAE5E0', dark: '#3D2019' },
  'fail-ink':     { light: '#9C3520', dark: '#FFA487', use: 'FAIL text on its own tint or on a pale ground.' },
  blocked:        { light: '#6E5B14', dark: '#D4C274', use: 'BLOCKED / restricted / worker errors. Olive-mustard — re-pitched off ochre (decision 118) so it cannot collide with the accent, and off Petra so red stays FAIL-only.' },
  'blocked-soft': { light: '#F3EBCF', dark: '#352D13' },
  'blocked-ink':  { light: '#5C4C10', dark: '#DDCD85', use: 'BLOCKED/warn text on its own tint or on a pale ground.' },
  skipped:        { light: '#5D646B', dark: '#B3B8BE', use: 'SKIPPED. Slate.' },
  'skipped-soft': { light: '#ECECEA', dark: '#2A2D31' },
  'skipped-ink':  { light: '#4D535A', dark: '#BFC4C9', use: 'SKIPPED text on its own tint or on a pale ground.' },

  /* aliases, so nothing already written breaks */
  ok:            { light: 'var(--pass)',         dark: 'var(--pass)' },
  'ok-soft':     { light: 'var(--pass-soft)',    dark: 'var(--pass-soft)' },
  danger:        { light: 'var(--fail)',         dark: 'var(--fail)' },
  'danger-soft': { light: 'var(--fail-soft)',    dark: 'var(--fail-soft)' },
  warn:          { light: 'var(--blocked)',      dark: 'var(--blocked)' },
  'warn-soft':   { light: 'var(--blocked-soft)', dark: 'var(--blocked-soft)' },
  'warn-ink':    { light: 'var(--blocked-ink)',  dark: 'var(--blocked-ink)' },
  info:          { light: 'var(--skipped)',      dark: 'var(--skipped)' },
  'info-soft':   { light: 'var(--skipped-soft)', dark: 'var(--skipped-soft)' },
};

/* ------------------------------------------------------------------- type */
/* Thmanyah, and only Thmanyah (D-1010-121). Bundled inside the extension; --mono has no Thmanyah monospace, so code text uses Thmanyah Sans (T-024). */
export const type = {
  display: '"Thmanyah Serif Display", "Thmanyah Sans", system-ui, "Segoe UI", Tahoma, sans-serif',
  font:    '"Thmanyah Sans", system-ui, "Segoe UI", Tahoma, sans-serif',
  mono:    '"Thmanyah Sans", system-ui, sans-serif',
};

export const weights = { thin: 200, light: 300, body: 400, medium: 500, emphasis: 600, heading: 700, name: 800, critical: 900 };

/* No webfont URL: the faces ship inside the extension and nothing is fetched from a font service. */
export const webfont = null;

/* ----------------------------------------------------------------- shape */
/*
 * One radius scale, three steps of 3px, and the top of it is 10.
 *
 * WHY: 12 and 16 were the two most common radii in the sheets, which is the
 * softness every generated interface arrives with. A tool that photographs
 * evidence should look like an instrument, not like a card in a feed, so the
 * corners are eased just enough to stop a hairline border reading as a hard
 * cut. `pill` stays 999 because a pill is a shape, not a radius.
 */
export const radius = { sm: '4px', md: '8px', lg: '12px', xl: '16px', pill: '999px' };

/*
 * Two shadows, and only one of them lifts anything.
 *
 * WHY: every card, row and tile in the extension carried `--shadow-1`, which
 * on a 348px panel is forty stacked drop shadows saying nothing. Depth is only
 * information when something genuinely floats over something else. So:
 *
 *   `--shadow-1` is a hairline. It sits UNDER a border, not instead of one,
 *   and it is tinted with the ink rather than black, so it reads as the edge
 *   of paper rather than as a glow.
 *
 *   `--shadow-2` is the one real shadow, reserved for a thing that is actually
 *   over the page: a dialog, a popover, a menu. It is tinted with the ink too,
 *   and it is softer and shorter than it was, because the old 18px blur at
 *   0.18 was doing the work of a modal backdrop the dialogs already have.
 */
/* shadow[2] re-valued to the prototype's --elev-2 (UI rework round 2). */
export const shadow = {
  1: { light: '0 1px 1px rgba(29, 32, 36, 0.05)',
       dark:  '0 1px 1px rgba(0, 0, 0, 0.35)' },
  2: { light: '0 8px 24px rgba(29, 32, 36, 0.12), 0 1px 2px rgba(29, 32, 36, 0.06)',
       dark:  '0 8px 24px rgba(0, 0, 0, 0.45), 0 1px 2px rgba(0, 0, 0, 0.30)' },
};

/* ---------------------------------------------------------------- motion */
/* `dur-move` / `dur-panel` / `dur-turn` used to live here as three more
 * durations. They are gone, not aliased (F06): the extension has its own
 * one motion system in ui/motion.css, and identity-tokens.css's generator
 * (tools/extension-tokens.mjs) re-points `ease` / `ease-pop` / `dur-tap`
 * onto it. Nothing should ask identity for a fourth duration. */
export const motion = {
  'ease':     'cubic-bezier(.22, .9, .28, 1)',
  'ease-pop': 'cubic-bezier(.34, 1.56, .64, 1)',
  'dur-tap':  '120ms',
};

/* ------------------------------------------------------------------- type scale */
/* Thmanyah, 200–900. One weight/tracking/leading triple per step (F23, F24).
 * Tracking never goes positive above 13px and never negative below 12px;
 * sizes are rem so the layout scales with the user's text-size setting
 * (F25, shared with `spacing` below). */
/* Sizes/weights re-valued per work/ui-rework-0927/IMPLEMENTATION-PLAN.md §2
 * (UI rework round 2, 27 Sept 2026); `label` is new, added for the same
 * reason: the prototype's --type-label has no extension equivalent yet.
 * Track/lead left as they were except where the plan names a new value. */
export const typeScale = {
  display: { size: '1.75rem',   weight: 400, track: '-0.02em',  lead: 1.15 },
  title:   { size: '1.25rem',   weight: 700, track: '-0.015em', lead: 1.2 },
  head:    { size: '1rem',      weight: 700, track: '-0.01em',  lead: 1.3 },
  body:    { size: '0.875rem',  weight: 400, track: '0',        lead: 1.5 },
  label:   { size: '0.875rem',  weight: 500, track: '0',        lead: 1.43 },
  small:   { size: '0.8125rem', weight: 400, track: '0.005em',  lead: 1.45 },
  micro:   { size: '0.75rem',   weight: 500, track: '0.02em',   lead: 1.35 },
};

/* ---------------------------------------------------------------- spacing */
/* rem, so it scales with text size. Hit targets stay px, tracked elsewhere
 * (F25). */
export const spacing = { 1: '0.25rem', 2: '0.5rem', 3: '0.75rem', 4: '1rem', 5: '1.5rem', 6: '2rem' };
