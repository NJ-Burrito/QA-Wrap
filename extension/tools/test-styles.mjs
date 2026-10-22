/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The stylesheets, checked against the palette.
 *
 * CSS fails quietly. `background: var(--bg)`, where nothing ever defined
 * `--bg`, does not fall back to a default and does not log: the declaration is
 * computed as though it were never written, so the element keeps whatever it
 * inherited. On a white page that looks correct. In dark mode it is white text
 * on a white card, and nobody notices until a screenshot.
 *
 * That is exactly what happened here: the save dialog, the diagram page, the
 * tutorials page, the popup footer and every field on the File tab drew with no
 * background for as long as those files existed. One person looking at one
 * light-mode screenshot cannot catch it. A list comparison can.
 *
 * The rules, all cheap:
 *   1. a property read without a fallback is defined somewhere;
 *   2. a property declared as script-set really is written by a script;
 *   3. anything the light theme defines, the dark theme defines too;
 *   4. no component hard-codes a palette colour without saying why;
 *   5. the palette loads before any stylesheet that reads from it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/* ── gather ────────────────────────────────────────────────────────────── */

const SKIP = new Set(['node_modules', 'dist', 'vendor', 'store', 'tutorials-src', 'game', 'practice.html']); // game/ = Bug Hunt: its own page and palette; practice/practice.html is that page generated for the extension (15 Oct 2026); test-game-contrast-fonts and test-game-i18n cover it
const sheets = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(css|html)$/.test(entry.name)) sheets.push(full);
  }
})(EXT);

const rel = (f) => path.relative(EXT, f).replace(/\\/g, '/');
const defined = new Set();
const used = new Map(); // property -> Set of files

const bare = new Map(); // property -> files that read it with NO fallback

for (const file of sheets) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
  for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,?)/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(rel(file));
    if (!m[2]) {
      if (!bare.has(m[1])) bare.set(m[1], new Set());
      bare.get(m[1]).add(rel(file));
    }
  }
}

/**
 * Properties a script sets on an element at runtime: an animation's distance,
 * a bar's fill, the colours the in-page overlay inherits from the host. These
 * are declared here rather than inferred, so adding one is a decision.
 */
const SET_FROM_SCRIPT = new Set([
  '--band',      // report/diagram: a bar's width, written by the renderer
  '--fill',      // options + tokens: a range track's filled portion
  // Which END of that track is the filled one. A gradient line is physical
  // (CSS has no 'to inline-end'), and Chrome mirrors a range input itself
  // under dir=rtl, so options.js swaps the two stops rather than adding a
  // [dir=rtl] rule to the stylesheet.
  '--fill-from', '--fill-to',
  '--dx', '--dy', '--rot', // ui/vfx.js: where a particle travels
  // content/bar.js: where the purpose thumb slides to; content/picker.js: which
  // way the name chip rises (away from the element).
  '--thumb-x', '--thumb-y', '--thumb-w', '--thumb-h', '--chip-from',
]);

console.log('the stylesheets — every colour comes from the palette');

test('every custom property a stylesheet reads is set by something', () => {
  // The first version of this asked only about `var(--x)` with no fallback,
  // on the theory that a declared fallback means the property is an optional
  // override. That let `var(--band, #E8E3D6)` through in three places, where
  // nothing anywhere set `--band` — so the "fallback" was the value, a
  // hard-coded tan on every theme, and the box it painted was invisible in
  // dark mode.
  //
  // The honest question is not "does this read have a fallback" but "can
  // anything ever supply this property". A fallback is a hook only if there is
  // something on the other end of it.
  const missing = [...used.keys()]
    .filter((k) => !defined.has(k) && !SET_FROM_SCRIPT.has(k))
    .map((k) => `${k} (read in ${[...used.get(k)].join(', ')})`);
  assert.deepEqual(
    missing,
    [],
    `nothing sets these, so their var() fallbacks are just hard-coded values:\n       ${missing.join('\n       ')}`
  );
});

test('a property set from a script is actually set by one', () => {
  const js = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) js.push(fs.readFileSync(full, 'utf8'));
    }
  })(EXT);
  const all = js.join('\n');
  const stale = [...SET_FROM_SCRIPT].filter((k) => !all.includes(k));
  assert.deepEqual(stale, [], `claimed to come from a script, but no script writes it: ${stale.join(', ')}`);
});

test('the identity tokens define both themes', () => {
  const text = fs.readFileSync(path.join(EXT, 'ui', 'identity-tokens.css'), 'utf8');
  const light = text.slice(0, text.search(/prefers-color-scheme/));
  const dark = text.slice(text.search(/prefers-color-scheme/));
  const names = (s) => new Set([...s.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const inLight = names(light);
  const inDark = names(dark);
  // Scales and radii are theme-independent by design; surfaces and text are not.
  const themed = [...inLight].filter((n) => /^--(surface|text|border|accent|ok|warn|danger|info|pass|fail|skipped|blocked)/.test(n));
  const unthemed = themed.filter((n) => !inDark.has(n));
  assert.deepEqual(unthemed, [], `defined for light only: ${unthemed.join(', ')}`);
});

test('no component hard-codes a palette colour', () => {
  // A hex code in a component is how a colour escapes the theme: it survives
  // the switch to dark and nothing complains. Two things are not offences — a
  // declared var() fallback and a line that states why it is literal.
  //
  // The in-page overlay used to be exempt as a whole (it renders inside a
  // stranger's document and cannot assume the palette was ever loaded). Since
  // UI rework round 2 (S8) it carries a GENERATED copy of the palette as
  // `--uqa-*` (identity/tools/extension-tokens.mjs), so only the lines between
  // its `uqa-tokens` markers are literal by design, and only they are skipped.
  const offenders = [];
  for (const file of sheets) {
    if (!file.endsWith('.css')) continue;
    if (/identity-tokens\.css$|tokens\.css$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const region = generatedLines(text);
    for (const [i, line] of text.split('\n').entries()) {
      if (region.has(i)) continue;
      if (/var\(--[a-z0-9-]+,\s*#/.test(line)) continue;
      if (line.includes('/* literal:')) continue;
      const hex = line.match(/#[0-9a-fA-F]{6}\b/g);
      if (hex) offenders.push(`${rel(file)}:${i + 1} ${hex.join(' ')}`);
    }
  }
  assert.deepEqual(offenders, [], `hard-coded colours — add /* literal: why */ if deliberate:\n       ${offenders.join('\n       ')}`);
});

/** Line indexes between the `uqa-tokens:start` / `:end` markers, the one generated region. */
function generatedLines(text) {
  const out = new Set();
  let inside = false;
  for (const [i, line] of text.split('\n').entries()) {
    if (line.includes('uqa-tokens:start')) inside = true;
    if (inside) out.add(i);
    if (line.includes('uqa-tokens:end')) inside = false;
  }
  return out;
}

const OVERLAY_CSS = fs.readFileSync(path.join(EXT, 'content', 'overlay.css'), 'utf8');

test('the in-page overlay has no literal colour outside its generated region (hex, rgb, rgba)', () => {
  // The hex rule above only matches six-digit hex. The overlay's old palette
  // was mostly rgba() — 36 of 75 literals (critic §6-K) — so it gets its own,
  // wider check: any #rgb/#rrggbb and any rgb()/rgba() outside the markers.
  const region = generatedLines(OVERLAY_CSS);
  assert.ok(region.size > 0, 'content/overlay.css lost its uqa-tokens region: run identity/tools/extension-tokens.mjs');
  const offenders = [];
  const text = OVERLAY_CSS.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  for (const [i, line] of text.split('\n').entries()) {
    if (region.has(i)) continue;
    const hit = line.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g);
    if (hit) offenders.push(`content/overlay.css:${i + 1} ${hit.join(' ')}`);
  }
  assert.deepEqual(offenders, [], `a literal colour escaped the overlay's tokens:\n       ${offenders.join('\n       ')}`);
});

test('every --uqa-* token equals its --X in the palette, light and dark', () => {
  // The overlay's copy is generated, and this is what keeps it generated: a
  // hand edit to the region, or a palette change nobody regenerated for,
  // shows up here as the one token that drifted.
  const maps = (text) => {
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
        const into = !at && sel === ':root' ? light : !at && sel === ':root[data-theme="dark"]' ? dark : null;
        if (into) for (const m of src.slice(start, i).matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) into[m[1]] = m[2].trim();
        start = i + 1;
      } else if (src[i] === ';' && !stack.length) start = i + 1;
    }
    return { light, dark: { ...light, ...dark } };
  };
  const resolve = (map, name, seen = new Set()) => {
    assert.ok(!seen.has(name) && map[name] != null, `--${name} does not resolve in the palette`);
    seen.add(name);
    return map[name].replace(/var\(\s*--([a-z0-9-]+)\s*(?:,[^)]*)?\)/g, (_, n) => resolve(map, n, new Set(seen)));
  };
  const palette = maps(
    fs.readFileSync(path.join(EXT, 'ui', 'identity-tokens.css'), 'utf8') + '\n' +
    fs.readFileSync(path.join(EXT, 'ui', 'motion.css'), 'utf8')
  );
  const region = OVERLAY_CSS.slice(OVERLAY_CSS.indexOf('uqa-tokens:start'), OVERLAY_CSS.indexOf('uqa-tokens:end'));
  const hostLight = region.slice(region.indexOf(':host {'), region.indexOf('}', region.indexOf(':host {')));
  const hostDark = region.slice(region.indexOf(':host([data-theme="dark"])'));
  const drift = [];
  let seen = 0;
  for (const [mode, block] of [['light', hostLight], ['dark', hostDark.slice(0, hostDark.indexOf('}'))]]) {
    for (const m of block.matchAll(/--uqa-([a-z0-9-]+):\s*([^;]+);/g)) {
      seen++;
      const want = resolve(palette[mode], m[1]);
      if (m[2].trim() !== want) drift.push(`--uqa-${m[1]} (${mode}) is ${m[2].trim()}, the palette says ${want}`);
    }
  }
  assert.ok(seen > 40, `only ${seen} --uqa-* declarations found in the generated region`);
  assert.deepEqual(drift, [], `regenerate with node identity/tools/extension-tokens.mjs:\n       ${drift.join('\n       ')}`);
});

/* ── contrast, where a token is used on the wrong ground ────────────────── */

/**
 * Every declaration block in every stylesheet, as { file, line, selector, body }.
 *
 * A regex and not a parser, deliberately: these sheets are hand-written CSS with
 * no nesting and no at-rule bodies other than @media and @keyframes, and the two
 * questions below are about one block at a time.
 */
function blocks() {
  const out = [];
  for (const file of sheets) {
    if (!file.endsWith('.css')) continue;
    /*
     * Comments are blanked, not removed.
     *
     * The declaration pattern below captures everything between the previous
     * `}` and the next `{` as the selector, so a comment sitting directly above
     * a rule was captured as part of it — and the `startsWith('/*')` guard on
     * the next line then skipped the whole rule. Every well-commented rule in
     * this codebase was therefore exempt from the contrast and opacity checks:
     * the rules somebody had thought hard enough about to explain were exactly
     * the ones nothing was checking. Two real offences were hiding behind it.
     *
     * Blanked rather than stripped so every byte keeps its offset — the line
     * numbers reported below, and `inKeyframes`, are computed from `m.index`
     * into this same string, and deleting characters would move all of them.
     * Newlines are preserved for the same reason.
     */
    const raw = fs.readFileSync(file, 'utf8');
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    for (const m of text.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, ' ');
      if (!selector) continue;
      out.push({
        file: rel(file),
        line: text.slice(0, m.index).split('\n').length,
        selector,
        body: m[2],
        /*
         * The comment directly above this rule, from the source.
         *
         * The exemption markers in this file — `accent-text ok:`, `dim ok:` —
         * are written by whoever made the deliberate exception, and half of
         * them are written above the rule rather than inside it. Blanking
         * comments to close the hole above would have blanked those too, and
         * turned every documented exception into a failure. So the raw text
         * before this rule's `{` is carried along — the very span the selector
         * pattern matches, which is where a comment above a rule lives. Offsets
         * are identical in both strings, which is the whole reason comments are
         * blanked rather than removed.
         */
        above: raw.slice(m.index, m.index + m[1].length),
        // Whether this block sits inside a @keyframes, which is motion rather
        // than a resting state and so is not a contrast question.
        inKeyframes: /@keyframes[^{]*\{(?:[^{}]|\{[^{}]*\})*$/.test(text.slice(0, m.index)),
        text,
        at: m.index,
      });
    }
  }
  return out;
}

const BLOCKS = blocks();

/** A ground `--accent-text` was never tuned for. The audit measured two of these. */
const WRONG_GROUND = ['--accent-soft', '--surface', '--surface-sunken', '--surface-raised'];

test('--accent-text is never painted on a surface or the accent tint', () => {
  /*
   * `--accent-text` and `--accent-ink` are two different answers to two
   * different questions, and their names do not say which is which.
   *
   * `--accent-text` is the colour to put ON a solid accent fill — corn on
   * ochre. `--accent-ink` is the accent tuned to stay legible on the pale
   * grounds. Using the first where the second belongs produces corn on
   * parchment: measured 1.16:1 on the ticked capture chips and 1.02:1 on the
   * help button's hover, which is not "low contrast" but literally invisible,
   * on the one control that tells a tester whether their microphone is going
   * into the clip.
   *
   * A block is judged on the ground it declares. `background: none` is read as
   * "whatever is behind me", which is a surface unless the same selector paints
   * an accent in a ::before — the one legitimate case here, where a pill is
   * drawn behind a transparent button to keep a 44px target.
   */
  const offenders = [];
  for (const b of BLOCKS) {
    if (!/color\s*:\s*[^;]*--accent-text/.test(b.body)) continue;
    if (/accent-text ok:/.test(b.body) || /accent-text ok:/.test(b.above)) continue;

    const bg = b.body.match(/background(?:-color)?\s*:\s*([^;]+)/);
    const ground = bg ? bg[1].trim() : null;

    if (ground && /var\(\s*--accent\s*[,)]/.test(ground)) continue;
    if (ground && !WRONG_GROUND.some((t) => ground.includes(t)) && !/^(none|transparent)$/.test(ground)) continue;

    // A transparent element whose own ::before paints the accent behind it.
    const pseudo = BLOCKS.find(
      (o) => o.file === b.file && new RegExp(`^${b.selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}::(before|after)$`).test(o.selector)
    );
    if (pseudo && /background(?:-color)?\s*:\s*[^;]*var\(\s*--accent\s*[,)]/.test(pseudo.body)) continue;

    offenders.push(`${b.file}:${b.line} ${b.selector} — on ${ground || 'the inherited surface'}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `--accent-text belongs on a solid accent fill; use --accent-ink on a surface:\n       ${offenders.join('\n       ')}`
  );
});

/**
 * Classes that hold text a person has to read — derived from the shipped HTML
 * rather than listed by hand, so a new container is covered the day it appears.
 *
 * "Holds text" means the element has a descendant carrying a real word. A leaf
 * that only draws something — an icon, a caret, a meter — is not one of these,
 * and dimming it costs nobody a sentence.
 */
function textBearingClasses() {
  const out = new Set();
  for (const file of sheets) {
    if (!file.endsWith('.html')) continue;
    const html = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const m of html.matchAll(/<(\w+)([^>]*\sclass="([^"]+)"[^>]*)>/g)) {
      const [, tag, attrs, classes] = m;
      if (/\/>$/.test(attrs)) continue;
      // The element's own subtree, taken by matching its closing tag naively —
      // good enough, because the question is only "is there a word in here".
      const rest = html.slice(m.index + m[0].length);
      const close = rest.indexOf(`</${tag}>`);
      const inner = close < 0 ? rest.slice(0, 400) : rest.slice(0, close);
      const words = inner.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').trim();
      if (!/[A-Za-z]{3}/.test(words)) continue;
      for (const c of classes.split(/\s+/)) if (c) out.add(c);
    }
  }
  return out;
}

/**
 * Classes that are containers because the stylesheets treat them as one.
 *
 * The HTML scan above cannot see a row the popup builds in JavaScript, and
 * `.tool-row` — the one this rule exists to catch — is exactly that. But a
 * class that appears as an ANCESTOR in a descendant selector is, by
 * construction, something with styled things inside it; if one of those
 * descendants carries type, the ancestor is a container of text whatever built
 * it. That is a signal the stylesheet gives up on its own.
 */
function containerClassesFromCss() {
  const typographic = /(^|[;{\s])(font|font-size|font-weight|line-height|color|letter-spacing|text-transform)\s*:/;
  const withText = new Set();
  for (const b of BLOCKS) {
    if (!typographic.test(b.body)) continue;
    for (const part of b.selector.split(',')) {
      const compounds = part.trim().split(/\s+|>/).filter(Boolean);
      // Every compound except the last is an ancestor of something with type.
      for (const c of compounds.slice(0, -1)) {
        for (const m of c.matchAll(/\.([A-Za-z0-9_-]+)/g)) withText.add(m[1]);
      }
    }
  }
  return withText;
}

const TEXT_CLASSES = new Set([...textBearingClasses(), ...containerClassesFromCss()]);

test('nothing dims a container of text below 0.85', () => {
  /*
   * Opacity multiplies every colour underneath it, including the text.
   *
   * Putting the extension to sleep dimmed the whole tool list with
   * `opacity: 0.72` on `.tool-row`, and the scrolling body with 0.62 — which
   * took the tool names and their one-line explanations to between 2.5:1 and
   * 4.0:1. That fails AA, and it fails it on the one screen a new tester spends
   * longest on: reading about the tools is exactly what someone does BEFORE
   * deciding to wake anything. "Unavailable" belongs in a border and a ground,
   * which cost no contrast.
   *
   * Three things are not offences. A `@keyframes` step is motion, not a resting
   * state. A genuinely disabled control is exempt from WCAG 1.4.3 by the
   * standard's own wording, so a selector that names one is allowed to dim it.
   * And a block that says `/* dim ok: why *\/` has been thought about.
   */
  const DISABLED = /:disabled|\[disabled\]|input:disabled/;
  const offenders = [];
  for (const b of BLOCKS) {
    if (b.inKeyframes) continue;
    if (/dim ok:/.test(b.body) || /dim ok:/.test(b.above)) continue;
    if (DISABLED.test(b.selector)) continue;
    const m = b.body.match(/(?:^|[;{\s])opacity\s*:\s*(0?\.\d+|0)\s*(?:;|$)/);
    if (!m) continue;
    if (Number(m[1]) >= 0.85) continue;
    // The rightmost compound is what the rule actually paints.
    const target = b.selector.split(',')[0].trim().split(/\s+|>/).pop() || '';
    if (/::(before|after)/.test(target)) continue;
    const classes = [...target.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((x) => x[1]);
    if (!classes.some((c) => TEXT_CLASSES.has(c))) continue;
    offenders.push(`${b.file}:${b.line} ${b.selector} — opacity ${m[1]}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `opacity dims the text too; use a border or a ground instead:\n       ${offenders.join('\n       ')}`
  );
});

let fontScan = () => [];
test('every font-family resolves to Thmanyah, inherit, or a font token (Cairo is accepted nowhere)', () => {
  // Cairo is banned (owner decision, research/138, 21 Sept 2026); Thmanyah
  // Sans/Serif Display replace it everywhere except the frozen film
  // pipeline, which keeps its own stage. A first family of anything else —
  // system-ui, a named system face, a
  // stray ui-monospace — is the fallback a browser reaches for the instant
  // the bundled face fails to load, and it is invisible until that happens:
  // the page looks identical on a machine that already has the fallback
  // installed. This walks every first-party CSS, HTML and JS file (not just
  // stylesheets — flow.js and docshell.js write font-family into template
  // strings) and checks only the FIRST family in each declaration, which is
  // the one a browser actually tries first.
  const FONT_TOKENS = /^var\(\s*--(font|display|mono)\b/;
  /*
   * `Cairo Film` is the frozen film pipeline's own scoped name (out of scope
   * for research/138 Stage 1 — `tools/film/**` stays untouched, still Cairo
   * until its own stage). Everything else in the live product is Thmanyah
   * now (research/138, 21 Sept 2026): no more `Cairo Overlay` — the overlay
   * dropped its custom face entirely rather than re-embed it (see
   * `content/ui-host.js`), so there is no private overlay name to exempt.
   */
  // "QAW Thmanyah Sans" is the in-page overlay's private name for the same
  // face (UI rework round 2, S8): registered from bytes by content/ui-host.js,
  // so a page that uses "Thmanyah Sans" itself is never re-rendered by us.
  const THMANYAH_LITERAL = /^(['"]?)(?:QAW )?Thmanyah\s+(Sans|Serif Display)\1$/i;
  // Decision 5 (research/138): exported documents, film/test tooling and
  // fixtures drop font embedding entirely and use a plain system stack — no
  // Thmanyah name, no licence exposure, since nothing there is redistributed.
  // (T-024: the system-stack exemption now covers tools/** only. A system face leading a stack in the product is the leak.)
  const CANVAS_REF = /^\$\{CANVAS_FACE\}$/;
  const SYSTEM_FIXTURES = new Set(['tools/inpage-shots.mjs', 'tools/reel-shots.mjs', 'tools/test-frames.mjs', 'tools/test-styles.mjs', 'tools/lib-report.mjs']); // lib-report: the pipeline's own run report page, build tooling

  /*
   * "No exceptions" (research/68, tightened in research/72): the exemption
   * list is now exactly three things, and nothing else in the tree gets a
   * pass. Two of them never reach `files` in the first place — `vendor/` and
   * `node_modules/` are in `SKIP` above, at the directory-walk level, the same
   * way every other test in this file already ignores them. The third is
   * `exempt()` below:
   *
   *   tools/film/**          — frozen. The film pipeline (scripts, storyboards,
   *                           composited video) is round-3 work nobody on this
   *                           sweep may open or edit, Cairo sweep included.
   *   tools/tutorials.mjs    — frozen: tutorials. Same round-3 pipeline, one
   *   tools/tutorial-index.mjs  directory up. Restored to its pre-5bba45c text
   *                           on 9 September 2026 and exempted rather than
   *                           edited, because a font-family sweep is not worth
   *                           a diff in frozen film code.
   *
   * `content/overlay.css`, `background/signature.js` and `core/provenance.js`
   * used to be exempted here with their own reasons (a stranger's page, a
   * DevTools console banner, a watermark) — research/72 fixed the first
   * families in all three instead of carving them out, so they are checked
   * like everything else now. Real gaps are reported as LEFTOVERS, not
   * silently dropped.
   */
  const FROZEN_TOOLS = new Set(['tools/tutorials.mjs', 'tools/tutorial-index.mjs']);
  // `background/signature.js` (research/138 row 50): DevTools console banner
  // only, never shipped in a document. Its format strings mix backtick
  // template literals with plain-quoted string arguments in a way this
  // regex's line/terminator matching cannot follow without misreading
  // adjacent strings as part of the same declaration — the plan names no
  // test for this file for exactly that reason.
  const NO_TEST_FILES = new Set(['background/signature.js']);
  const exempt = (full) => rel(full).startsWith('tools/film/') || FROZEN_TOOLS.has(rel(full)) || NO_TEST_FILES.has(rel(full));

  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(css|html|js|mjs)$/.test(entry.name) && !exempt(full)) files.push(full);
    }
  })(EXT);

  // The first family in a comma-separated value: the text up to the first
  // comma, then — because a `font:` shorthand carries size/weight/
  // line-height before the family list — either the quoted string in it, a
  // leading var(...) reference, or (shorthand's plain case) its last
  // whitespace-separated word.
  const firstFamily = (value) => {
    const head = value.split(',')[0].trim();
    const quoted = head.match(/(['"])((?:(?!\1).)*)\1\s*$/);
    if (quoted) return quoted[0].trim();
    // A whole-head var() is the family only when the head IS that one call —
    // `font-family: var(--font)`. In the `font` SHORTHAND (weight, size/
    // line-height, family all space-separated: `font: 600 11px/1 var(--font)`)
    // the head starts with an unrelated var() for the weight, and this used
    // to return that whole string as "the family", flagging ui/tokens.css:22
    // (`font: var(--weight-body) var(--t-body)/var(--lead-body) var(--font)`)
    // even though its real, last-word family IS a Cairo token. Falling
    // through to the last-word split (below) reads the family the browser
    // actually uses in both the longhand and shorthand cases.
    if (/^var\([^)]*\)$/.test(head)) return head;
    const words = head.split(/\s+/);
    return words[words.length - 1];
  };

  const check = (file, text, value, index) => {
    const trimmed = value.trim();
    if (!trimmed || /^(inherit|initial|unset|normal)$/i.test(trimmed)) return;
    const first = firstFamily(trimmed);
    if (!first || first === 'inherit') return;
    if (FONT_TOKENS.test(first)) return;
    if (THMANYAH_LITERAL.test(first)) return;
    if (CANVAS_REF.test(first)) return;
    // Four scripts paint a stand-in for SOMEONE ELSE'S page (inpage-shots, reel-shots, test-frames) or are this gate's own scratch input; a system face is the point there. Cairo is exempt nowhere.
    if (SYSTEM_FIXTURES.has(rel(file)) && /^['"]?(system-ui|ui-monospace|-apple-system|Segoe UI)/i.test(first)) return;
    // Build and test tooling is not product output: its screenshots and fixtures may use a plain system stack.
    const line = text.slice(0, index).split('\n').length;
    offenders.push(`${rel(file)}:${line} first family "${first}" (in "${trimmed.slice(0, 60)}")`);
  };

  let offenders = [];
  fontScan = (list) => {
  offenders = [];
  for (const [file, raw] of list) {
    let text = raw;
    // Strip comments so a mention of "font-family:" in prose (this very
    // block, for instance) is never read as a declaration.
    text = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    if (/\.(js|mjs)$/.test(file)) text = text.replace(/(^|[^:])\/\/[^\n]*/g, (c) => c[0] + c.slice(1).replace(/[^\n]/g, ' '));
    // font-face declarations name the face being defined, not a usage site —
    // Cairo/'Cairo Film' there is the point, so those blocks are skipped.
    text = text.replace(/@font-face\s*\{[^}]*\}/g, (c) => c.replace(/[^\n]/g, ' '));
    // CSS/JS declaration syntax: `font: ...;` or `font-family: ...;`. The
    // terminator is a semicolon OR a closing brace (the last declaration in a
    // block often carries no trailing `;`) — true even inside a JS template
    // string, since every occurrence in this codebase is a literal CSS rule.
    for (const m of text.matchAll(/font(?:-family)?\s*:\s*([^;{}]+)[;}]/g)) check(file, text, m[1], m.index);
    // SVG/HTML attribute syntax: `font-family="value"` — no colon, no
    // semicolon, terminated by the closing quote (core/flow.js).
    for (const m of text.matchAll(/font-family\s*=\s*"([^"]+)"/g)) check(file, text, m[1], m.index);
    // Canvas text: ctx.font = `700 16px FAMILY, ...` (T-024; core/shapes.js burns these into a PNG)
    for (const m of text.matchAll(/\.font\s*=\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g)) check(file, text, m[1] ?? m[2] ?? m[3], m.index);
  }
  return offenders;
  };
  const found = fontScan(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
  assert.deepEqual(
    found,
    [],
    `first font family is not Thmanyah, inherit or a font token:\n       ${found.join('\n       ')}`
  );
});

test('every page loads the palette before anything that reads it', () => {
  // The font face may come first — it defines no colour. Everything that does
  // read a colour must come after the palette, or its var()s resolve to
  // nothing on the first paint.
  const pages = sheets.filter((f) => f.endsWith('.html') && !/store|research/.test(f));
  const bad = [];
  for (const file of pages) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/<link[^>]+stylesheet/.test(text)) continue;
    const links = [...text.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
    const at = links.findIndex((h) => h.includes('identity-tokens.css'));
    if (at < 0) { bad.push(`${rel(file)}: no palette`); continue; }
    const before = links.slice(0, at).filter((h) => !/fonts\.css$/.test(h));
    if (before.length) bad.push(`${rel(file)}: ${before.join(', ')} loads before the palette`);
  }
  assert.deepEqual(bad, [], bad.join(' | '));
});

/* ── the type scale: no bare px outside the allow-list ──────────────────── */

/**
 * `font-size: <n>px` outside a marked declaration is a step that escaped the
 * scale (research/89, R09).
 *
 * This used to be a `file:line` allow-list, hand-copied from wherever the
 * exceptions sat the day the check was written: `report/report.css:333`,
 * `:476`, `:653`, `:749`. Two ordinary edits to that file later (still
 * research/89, then research/90) shifted those same four declarations to
 * `:344`, `:487`, `:664`, `:760` — nothing about the exceptions changed, only
 * their position — and the gate started failing on the very lines it was
 * written to permit. A line number is not an identity; it is a position that
 * moves on the next unrelated edit above it, so a list keyed on it goes stale
 * on schedule, not on mistake.
 *
 * The list is gone. An exception is now a marker comment on the declaration
 * itself: `font-size: 18px; /* scale-exception: reason *\/`. That survives
 * edits because it moves WITH the line it documents, and it puts the reason
 * where the next reader is already looking instead of in a second file that
 * can drift out of step with the first. The four genuine exceptions in
 * `report/report.css` (`.chart-meter-v`, `.flow-arrow::before`, the play
 * triangle, `.metric-v`) carry the marker now.
 *
 * `options/options.css:363`, `devtools/panel.css:107` and
 * `annotate/annotate.css:83`/`:139` (the R09 gap-close, research/90) are the
 * same kind of exception but are out of this fix's scope (`brief-2026-09-16`
 * owns only `test-styles.mjs`, `report/report.css`, `replay/replay.css`), so
 * they carry no marker yet and will fail this test until someone who owns
 * those files adds one.
 */
const EXCEPTION_MARKER = /\/\*\s*scale-exception:\s*(.+?)\s*\*\//;

/*
 * Scoped to the sheets the typography rebuild actually converted to the
 * `--t-*` scale. Deliberately NOT `content/overlay.css`: it is injected into
 * a customer's page, and `rem` there would resolve against THAT page's root
 * font-size rather than QA Wrap's own — so it keeps px on purpose, and
 * nobody should "fix" it onto the scale.
 */
// options/options.css, devtools/panel.css and annotate/annotate.css closed
// the gap research/89 flagged (research/90, 2026-09-17): every var(--t-*)
// site in the three sheets was already on the scale, and the four remaining
// bare px sites (options.css:363, devtools/panel.css:107,
// annotate/annotate.css:83, :139) are >1px from any step and icon-glyph or
// display-numeral, not body text — each needs a `scale-exception` marker
// comment (see EXCEPTION_MARKER above) rather than a step they don't fit.
// Not added here: those three files are outside this fix's scope.
const SCALED_SHEETS = [
  'report/report.css',
  'replay/replay.css',
  'popup/popup.css',
  'ui/tokens.css',
  'options/options.css',
  'devtools/panel.css',
  'annotate/annotate.css',
];

test('no bare font-size px without a scale-exception marker, on the converted sheets', () => {
  const offenders = [];
  for (const rel_ of SCALED_SHEETS) {
    const full = path.join(EXT, rel_.replace(/\//g, path.sep));
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const [i, line] of text.split('\n').entries()) {
      // 10–19.x px only, same as research/89's own sweep for R09: the small
      // steps the type scale actually ties over. A display heading at 22px,
      // 30px, 36px etc. is a bespoke size outside that scale, not a tie this
      // check exists to catch, and converting it is not what was asked.
      const m = line.match(/font-size\s*:\s*1[0-9](?:\.[0-9])?px/);
      if (!m) continue;
      const key = `${rel_}:${i + 1}`;
      // A marker anywhere on the same line is the exception, not a
      // remembered position — check the line's own text, not a list.
      if (EXCEPTION_MARKER.test(line)) continue;
      offenders.push(`${key} ${m[0]} — no scale-exception marker on this line`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `bare font-size px with no marker (use the --t-* scale, or mark it: /* scale-exception: reason */):\n       ${offenders.join('\n       ')}`
  );
});

/* ── red stays FAIL-only (D4, owned by S1) ───────────────────────────────── */
/**
 * Red is Petra, and Petra means a caught FAIL — nothing else. Before this
 * rework the recording dot, a running tool's pulse and the toolbar badge all
 * borrowed --fail/--danger, so a tester glancing at red could not tell "this
 * caught a FAIL" from "this happens to be recording". UI rework round 2 moves
 * every live/recording/running state onto --live (ochre, Lead decision
 * 27 Sept 2026, research/56) and reserves red for the one thing it should mean.
 *
 * PENDING names a violation this suite already knows about, in a file some
 * later stage owns (content/overlay.css → S8; the Stage-2 pages → S11b) — so
 * a stage that has not run yet does not fail S1's gate, but a name that stops
 * violating fails the test until it is deleted: the list only ever shrinks.
 */
const RED_FAIL_ONLY_PENDING = new Set([
  // Empty at S1: a full sweep of every stylesheet found no current violation
  // outside what S1 itself fixed (popup.css, ui/tokens.css, identity-tokens.css).
  // S8 and S11b add their own file here only if their own work introduces one.
]);

test('red is reserved for a caught fail — a live/record/running rule never reads it', () => {
  const BANNED = /var\(\s*--(?:fail|danger|uqa-fail|uqa-danger)\b/;
  const seenPending = new Set();
  const violations = [];
  for (const b of BLOCKS) {
    if (b.inKeyframes) continue;
    if (!/live|record|running/i.test(b.selector)) continue;
    if (!BANNED.test(b.body)) continue;
    if (RED_FAIL_ONLY_PENDING.has(b.file)) { seenPending.add(b.file); continue; }
    violations.push(`${b.file}:${b.line} ${b.selector} — ${b.body.trim().replace(/\s+/g, ' ')}`);
  }
  assert.deepEqual(
    violations,
    [],
    `red must stay FAIL-only (D4) — this reads the fail colour on a live/record/running rule:\n       ${violations.join('\n       ')}`
  );
  const resolved = [...RED_FAIL_ONLY_PENDING].filter((f) => !seenPending.has(f));
  assert.deepEqual(
    resolved,
    [],
    `PENDING entry no longer violates — delete it from RED_FAIL_ONLY_PENDING, the list only shrinks: ${resolved.join(', ')}`
  );
});

test('--ring-live and the toolbar badge use --live, not the fail colour', () => {
  const css = fs.readFileSync(path.join(EXT, 'ui', 'identity-tokens.css'), 'utf8');
  // The bare word appears in this file's own header comment first — anchor on
  // the at-rule itself, not the word, so the light slice is not truncated.
  const at = css.indexOf('@media (prefers-color-scheme: dark)');
  for (const [name, block] of [['light', css.slice(0, at)], ['dark', css.slice(at)]]) {
    assert.match(block, /--ring-live:\s*0 0 0 2px var\(--live\)\s*;/, `--ring-live does not read --live in ${name}`);
  }
  // The badge dot has no stylesheet to read a token from (background/action-icon.js
  // is a worker module, not a page) — it carries the literal, and the literal must
  // equal --live's LIGHT value (the ochre the Lead picked, research/56 tail).
  const js = fs.readFileSync(path.join(EXT, 'background', 'action-icon.js'), 'utf8');
  const m = js.match(/export const BADGE = '(#[0-9A-Fa-f]{6})'/);
  assert.ok(m, 'action-icon.js no longer exports BADGE as a literal hex');
  assert.equal(m[1].toUpperCase(), '#8E5A10', "BADGE must equal --live's light value (#8E5A10, Lead 27 Sept 2026)");
});

/* ── T-023: theming that is true ───────────────────────────────────────── */

/** Page CSS (not the token files) whose `prefers-color-scheme` block has no `[data-theme]` twin. Each entry needs a reason; at most ten (T-023). */
const SCHEME_ALLOW = new Map([
  ['content/overlay.css::.uqa-injecting', 'generated uqa-tokens block: styles elements of the host page, which has no [data-theme] to read'],
]);

function mediaBlocks(text, needle) {
  const out = [];
  let at = text.indexOf(needle);
  while (at !== -1) {
    let depth = 0, i = text.indexOf('{', at);
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) break;
    }
    out.push(text.slice(at, i + 1));
    at = text.indexOf(needle, start + 1);
  }
  return out;
}

/** Offenders: every unguarded prefers-color-scheme block outside the token files. */
function unguardedSchemeBlocks(files) {
  const bad = [];
  for (const [file, text] of files) {
    if (/(^|\/)(identity-)?tokens\.css$/.test(file)) continue;
    for (const block of mediaBlocks(text, '@media (prefers-color-scheme')) {
      const sel = block.slice(block.indexOf('{') + 1).trim();
      if ([...SCHEME_ALLOW.keys()].some((k) => k.startsWith(`${file}::`) && sel.startsWith(k.split('::')[1]))) continue;
      if (!/data-theme/.test(block)) bad.push(`${file}: ${block.slice(0, 70).replace(/\s+/g, ' ')}`);
    }
  }
  return bad;
}

const cssFiles = sheets.filter((f) => f.endsWith('.css')).map((f) => [rel(f), fs.readFileSync(f, 'utf8')]);

test('T-023: no page CSS follows prefers-color-scheme without a [data-theme] twin', () => {
  assert.ok(SCHEME_ALLOW.size <= 10, 'the allow-list is capped at ten');
  for (const reason of SCHEME_ALLOW.values()) assert.ok(String(reason).length > 10, 'an allow-list entry needs a reason');
  assert.ok(cssFiles.length > 10, 'the gate saw no stylesheets, so it proved nothing');
  assert.deepEqual(unguardedSchemeBlocks(cssFiles), []);
});

test('T-023: the gate fails on a scratch unguarded prefers-color-scheme block', () => {
  const scratch = [['scratch/page.css', '@media (prefers-color-scheme: dark) {\n  .toast { background: #000; }\n}']];
  assert.equal(unguardedSchemeBlocks(scratch).length, 1);
  const twin = [['scratch/page.css', "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) .toast { background: #000; }\n}"]];
  assert.equal(unguardedSchemeBlocks(twin).length, 0);
});

test('T-023: the shared token file declares color-scheme, forced-colors and a no-blur fallback', () => {
  const tokens = fs.readFileSync(path.join(EXT, 'ui', 'tokens.css'), 'utf8');
  assert.match(tokens, /color-scheme:\s*light dark/);
  assert.match(tokens, /:root\[data-theme='dark'\]\s*\{\s*color-scheme:\s*dark/);
  assert.match(tokens, /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\), \(forced-colors: active\)/);
  assert.match(tokens, /@supports not \(backdrop-filter: blur\(1px\)\)/);
  assert.match(tokens, /--blur:\s*0px/);
  assert.ok(cssFiles.some(([f, t]) => /forced-colors/.test(t) && /tokens\.css$/.test(f)), 'forced-colors lives in no token file');
});

/* ── T-024: the font gate above, proven to fail ───────────────────────── */

test('T-024: the font gate fails on a scratch system-ui or monospace first family', () => {
  const mono = 'font' + '-family: monospace;';
  assert.equal(fontScan([['scratch/a.css', mono]]).length, 1);
  assert.equal(fontScan([['scratch/b.css', 'p { font: 500 13px/1.4 ui-monospace, Consolas, monospace; }']]).length, 1);
  assert.equal(fontScan([['scratch/c.js', 'ctx.font = `700 ${r}px system-ui, sans-serif`;']]).length, 1);
  assert.equal(fontScan([['scratch/q.js', "ctx.font = '700 16px system-ui, sans-serif';"]]).length, 1, 'a single-quoted canvas font is read too');
  assert.equal(fontScan([['scratch/d.css', 'p { font: 500 13px/1.4 "QAW Thmanyah Sans", monospace; }']]).length, 0);
  assert.equal(fontScan([['scratch/e.js', 'ctx.font = `700 ${r}px ${CANVAS_FACE}`;']]).length, 0);
});

test('T-024: canvas text names Thmanyah first and each editor waits for the face once', () => {
  const shapes = fs.readFileSync(path.join(EXT, 'core', 'shapes.js'), 'utf8');
  assert.match(shapes, /CANVAS_FACE = '"Thmanyah Sans"/);
  assert.equal((shapes.match(/\$\{CANVAS_FACE\}/g) || []).length, 3, 'a canvas label is still set in another face');
  assert.doesNotMatch(shapes, /px system-ui/);
  for (const f of ['annotate/annotate.js', 'videoedit/videoedit.js']) {
    assert.match(fs.readFileSync(path.join(EXT, f), 'utf8'), /ensureCanvasFont\(\)/, `${f} paints before the face has loaded`);
  }
});

/* ── r3-08-1 (D-1010-60): a selected or pressed state survives forced colours ───────────────── */

/** The text of every forced-colors media block in a stylesheet (brace-balanced). */
function forcedBlocks(css) {
  const out = [];
  for (const m of css.matchAll(/@media \(forced-colors: active\)\s*\{/g)) {
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth) { depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0; i++; }
    out.push(css.slice(start, i - 1));
  }
  return out;
}

test('r3-08-1: each state that is only a colour has exactly one forced-colors rule', () => {
  const want = {
    'report/report.css': [
      [".seg-btn[aria-selected='true']", /Highlight/, /HighlightText/],
      [".flist button[aria-selected='true']", /Highlight/, /HighlightText/],
      [".tab[aria-selected='true']", /text-decoration:\s*underline/],
      [".sec-btn[aria-selected='true']", /text-decoration:\s*underline/],
    ],
    'popup/popup.css': [
      ['.activity-meter i.on', /outline:\s*2px solid/],
      [".tool[aria-pressed='true']", /outline:\s*2px solid/],
    ],
  };
  for (const [file, rules] of Object.entries(want)) {
    const blocks = forcedBlocks(fs.readFileSync(path.join(EXT, file), 'utf8')).join('\n');
    for (const [selector, ...needles] of rules) {
      const hits = [...blocks.matchAll(/(^|\n)\s*([^{}\n]+)\{([^}]*)\}/g)].filter((m) => m[2].trim() === selector);
      assert.equal(hits.length, 1, `${file}: ${hits.length} forced-colors rules for ${selector}, want exactly 1`);
      for (const n of needles) assert.match(hits[0][3], n, `${file}: ${selector} rule lacks ${n}`);
    }
  }
});

test('r3-10-8: the page overlay count asks for weight 500, because only 400 and 500 ship', () => {
  const css = fs.readFileSync(path.join(EXT, 'content', 'overlay.css'), 'utf8');
  const rule = /\.uqa-problems \{[^}]*\}/.exec(css)?.[0] || '';
  assert.match(rule, /font-weight:\s*500/);
  assert.doesNotMatch(css, /font-weight:\s*600/, 'a weight that does not ship renders as 500 anyway');
});

test('D-1010-121: no Cairo and no Google font URL under identity/tokens or identity/tools/tokens*.mjs', () => {
  const ID = path.resolve(EXT, '..', 'identity');
  const files = [
    ...fs.readdirSync(path.join(ID, 'tokens')).map((f) => path.join(ID, 'tokens', f)),
    ...fs.readdirSync(path.join(ID, 'tools')).filter((f) => /^tokens.*\.mjs$/.test(f)).map((f) => path.join(ID, 'tools', f)),
  ].filter((f) => fs.statSync(f).isFile());
  assert.ok(files.length >= 7, `expected the token files, found ${files.length}`);
  const bad = files.filter((f) => /cairo|fonts\.googleapis|fonts\.gstatic/i.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(path.join(ID, '..'), f));
  assert.deepEqual(bad, [], 'the identity kit still names Cairo or a Google font URL');
  const json = JSON.parse(fs.readFileSync(path.join(ID, 'tokens', 'tokens.json'), 'utf8'));
  assert.match(json.type.font, /Thmanyah Sans/);
  assert.match(json.type.display, /Thmanyah Serif Display/);
});

test("[lang='ar'] sets every --track-* token to 0 (D-1010-177: tracking breaks Arabic joining)", () => {
  const text = fs.readFileSync(path.join(EXT, 'ui', 'identity-tokens.css'), 'utf8');
  const tokens = [...new Set([...text.matchAll(/(--track-[a-z]+)\s*:/g)].map((m) => m[1]))];
  assert.ok(tokens.length >= 7, `expected the track scale, found ${tokens.join(', ')}`);
  const block = /\[lang='ar'\]\s*\{([^}]*)\}/.exec(text);
  assert.ok(block, "no bare [lang='ar'] { … } block");
  const set = new Map([...block[1].matchAll(/(--track-[a-z]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const wrong = tokens.filter((n) => set.get(n) !== '0');
  assert.deepEqual(wrong, [], `not reset to 0 under [lang='ar']: ${wrong.join(', ')}`);
  assert.ok(text.indexOf(block[0]) > text.lastIndexOf('--track-micro: 0.02em'), 'the Arabic reset must come after the last declaration it overrides');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
