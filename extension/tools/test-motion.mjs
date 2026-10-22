/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The mark's motion, checked where it can go wrong quietly.
 *
 * Three things here fail without anyone noticing, which is why they are tests
 * and not a review:
 *
 *   1. **A malformed animated SVG still renders.** Chrome is forgiving; a
 *      stray attribute or an unclosed <g> draws fine in the popup and then
 *      throws in anything stricter — the packager, a document that inlines it,
 *      an XML tool. So the file is parsed strictly here, once.
 *   2. **A dasharray shorter than its path draws a nick.** The ring's arc is
 *      315°, not 2 × 28° as the construction sheet implies, because `ring()`
 *      starts where it starts. Measured against getTotalLength(): 93.4655.
 *      Two files carry that number — the generated SVG and ui/motion.css — and
 *      nothing but this test would notice them drifting apart.
 *   3. **Reduced motion is a promise, not a preference.** If the block goes
 *      missing the animation simply plays, and the person it was for is the
 *      one person who will not report it.
 *
 * The frame maths for the toolbar icon is tested with a canvas that draws
 * nothing. Node has no OffscreenCanvas, and background/action-icon.js takes
 * its canvas as an argument for exactly this reason: the question worth asking
 * is "eight frames, three sizes, the right dimensions", and that question does
 * not need pixels.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startRecordingIcon,
  stopRecordingIcon,
  buildFrames,
  frameOpacities,
  variantFor,
  ringSweep,
  checkPoints,
  FRAMES,
  SIZES,
  STEP_MS,
} from '../background/action-icon.js';
import { workerSrc } from './lib-worker-src.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const IDENTITY = path.resolve(EXT, '..', 'identity');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const read = (f) => fs.readFileSync(f, 'utf8');
const MOTION_SVG = path.join(IDENTITY, 'logo', 'mark-motion.svg');
const STATIC_SVG = path.join(IDENTITY, 'logo', 'mark.svg');
const BRAND = path.join(EXT, 'brand');
const MOTION_CSS = path.join(EXT, 'ui', 'motion.css');

/**
 * A strict-enough XML check: every tag opens and closes in order, every
 * attribute is quoted, there is exactly one root. Not a full parser — it does
 * not need to be, because the file is generated and the failure mode being
 * caught is a hand-edit or a template slip, not exotic XML.
 */
function parseXml(text) {
  const body = text.replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  let roots = 0;
  for (const m of body.matchAll(/<\/?([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const [, name, attrs] = m;
    // The attribute run swallows a trailing slash, so self-closing is read
    // back off the end of it rather than matched separately.
    const selfClose = /\/\s*$/.test(attrs);
    const closing = m[0].startsWith('</');
    if (!closing) {
      // Unbalanced quotes leave an odd count behind — the classic way a
      // generated attribute goes wrong.
      assert.equal((attrs.match(/"/g) || []).length % 2, 0, `unbalanced quotes on <${name}>`);
      if (!stack.length) roots++;
      if (!selfClose) stack.push(name);
    } else {
      const open = stack.pop();
      assert.equal(open, name, `</${name}> closes <${open}>`);
    }
  }
  assert.deepEqual(stack, [], `unclosed: ${stack.join(', ')}`);
  assert.equal(roots, 1, `expected one root element, found ${roots}`);
  // Any leftover bracket outside a tag is a truncation.
  assert.equal(/<(?![/!?A-Za-z])/.test(body), false, 'a bare "<" outside a tag');
  return body;
}

/**
 * One `@keyframes` block's body, found by counting braces rather than by
 * pattern.
 *
 * A regex cannot do this. Half the keyframes in this codebase are written on
 * one line — `@keyframes vfx-glow { 0%, 100% { opacity: 1; } 50% { ... } }` —
 * so a lazy `{ ... \n}` runs past the end of the rule and swallows whatever
 * comes next, which is how the loop check below first reported that a two-step
 * opacity breathe was animating `z-index` and `pointer-events`.
 */
function keyframeBody(text, name) {
  const at = text.search(new RegExp('@keyframes\\s+' + name + '\\s*\\{'));
  if (at === -1) return null;
  let depth = 0;
  for (let i = text.indexOf('{', at); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(at, i + 1);
  }
  return null;
}

/** The `d` attributes, in document order. */
const paths = (svg) => [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);

console.log('the mark in motion — one idea, and it stops when asked');

/* ── the animated mark ─────────────────────────────────────────────────── */

test('the animated mark exists in the identity and in the extension', () => {
  for (const f of [MOTION_SVG, path.join(BRAND, 'mark-motion.svg')]) {
    assert.equal(fs.existsSync(f), true, `missing: ${f}`);
  }
});

test('the animated mark parses as XML', () => {
  parseXml(read(MOTION_SVG));
});

test('the extension copy is the identity file, not a second drawing', () => {
  // generate-icons.mjs copies; it never redraws. A difference here means
  // somebody hand-edited extension/brand.
  assert.equal(
    fs.readFileSync(path.join(BRAND, 'mark-motion.svg'), 'utf8'),
    read(MOTION_SVG),
    'extension/brand/mark-motion.svg has drifted from the identity — re-run tools/generate-icons.mjs'
  );
});

test('the animated mark is the static mark, geometry for geometry', () => {
  // The whole point of the motion file is that it moves the same shape. If the
  // paths differ, there are now two marks.
  assert.deepEqual(paths(read(MOTION_SVG)), paths(read(STATIC_SVG)));
});

test('the static mark still draws the geometry BRAND.md documents', () => {
  // Ring r17 centred 30,30 with the seam on the diagonal; check 36,36 →
  // 42.5,44 → 55,20. These are the numbers in identity/BRAND.md §3, quoted
  // here so a change to marks.mjs that moves the mark has to be deliberate.
  assert.deepEqual(paths(read(STATIC_SVG)), [
    'M45.01 37.98 A17 17 0 1 0 34.97 46.26',
    'M36 36L42.5 44L55 20',
  ]);
  assert.equal(
    fs.readFileSync(path.join(BRAND, 'mark.svg'), 'utf8'),
    read(STATIC_SVG),
    'the extension copy of the static mark has drifted from the identity'
  );
});

test('both states are in the file, and reachable from an <img> and from inline', () => {
  const svg = read(MOTION_SVG);
  for (const hook of ['#wake:target', '#recording:target', '.qaw-wake', '.qaw-recording']) {
    assert.equal(svg.includes(hook), true, `no way in via ${hook}`);
  }
  // The :target hooks need something to target.
  assert.equal(/<g id="wake"\/>/.test(svg), true, 'no #wake anchor');
  assert.equal(/<g id="recording"\/>/.test(svg), true, 'no #recording anchor');
});

test('the swap knows the small mark, so the header logo never becomes a broken image', () => {
  // motion.js stripped only mark.svg / mark-motion.svg from the URL; the header
  // uses mark-small.svg, so waking produced `…/mark-small.svgmark-motion.svg#wake`.
  const js = read(path.join(EXT, 'ui', 'motion.js'));
  const m = js.match(/const MARK_FILE = (\/.+\/);/);
  assert.ok(m, 'motion.js no longer names the pattern it strips from a mark URL');
  const re = new RegExp(m[1].slice(1, -1));
  for (const file of ['mark.svg', 'mark-small.svg', 'mark-motion.svg#wake', 'mark-small-dark.svg', 'mark-motion-dark.svg?w=3#wake']) {
    const url = `chrome-extension://abc/brand/${file}`;
    assert.equal(url.replace(re, ''), 'chrome-extension://abc/brand/', `the pattern leaves "${file}" in the URL`);
  }
  assert.match(js, /qawMarkHome/, 'a release must put back the mark the element started with, not always mark.svg');
});

test('wake is under 900 ms, start to finish', () => {
  const svg = read(MOTION_SVG);
  const ring = svg.match(/qaw-ring-draw (\d+)ms/);
  const check = svg.match(/qaw-check-in (\d+)ms cubic-bezier\([^)]*\) (\d+)ms/);
  assert.ok(ring, 'the ring draw has no duration');
  assert.ok(check, 'the check has no duration and delay');
  const total = Number(check[2]) + Number(check[1]);
  assert.equal(Number(ring[1]), Number(check[2]), 'the check should start as the ring finishes');
  assert.ok(total < 900, `wake takes ${total} ms; the budget is 900`);
});

test('nothing in the mark loops', () => {
  // UI rework round 2 (DESIGN-SPEC §1.11): no idle loop on the mark any more —
  // the status chip's own timer is the sign of life while recording. The
  // #recording hook stays wired (both `<img>` and inline still reach it), it
  // just does nothing yet.
  const svg = read(MOTION_SVG);
  for (const hook of ['#recording:target ~ .mark .check', '.qaw-recording .check']) {
    assert.equal(svg.includes(hook), true, `the recording hook is gone: ${hook}`);
  }
  const loops = [...svg.matchAll(/([^{}]+)\{[^}]*infinite[^}]*\}/g)].map((m) => m[1].trim());
  assert.equal(loops.length, 0, `something still loops forever: ${loops.join(' | ')}`);
});

test('the animated mark honours prefers-reduced-motion', () => {
  const svg = read(MOTION_SVG);
  const block = svg.match(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(block, 'no prefers-reduced-motion block');
  assert.match(block[1], /animation:\s*none\s*!important/);
  assert.match(block[1], /stroke-dashoffset:\s*0\s*!important/);
});

test('ui/motion.css honours it too, and says the same about it', () => {
  const css = read(MOTION_CSS);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation: none !important/);
});

/* ── the number that quietly breaks the ring ───────────────────────────── */

test('the dash lengths cover the paths they sit on, in both files', () => {
  // Measured with getTotalLength() in Chromium: 93.4655 and 37.3679. A dash
  // shorter than that leaves a gap at the seam that reads as a second opening.
  const MEASURED = { ring: 93.4655, check: 37.3679 };
  const svg = read(MOTION_SVG);
  const css = read(MOTION_CSS);
  const dashes = (text) => [...text.matchAll(/stroke-dash(?:array|offset):\s*([\d.]+)/g)].map((m) => Number(m[1])).filter((n) => n > 0);

  const inSvg = new Set(dashes(svg));
  const inCss = new Set(dashes(css));
  for (const set of [inSvg, inCss]) {
    for (const n of set) {
      const covers = n >= MEASURED.ring - 0.001 ? 'ring' : n >= MEASURED.check - 0.001 ? 'check' : null;
      assert.ok(covers, `${n} is shorter than either path — it will draw a gap`);
    }
  }
  assert.deepEqual(
    [...inSvg].sort((a, b) => a - b),
    [...inCss].sort((a, b) => a - b),
    'the SVG and ui/motion.css disagree about the path lengths'
  );
});

test('the ring sweeps 315°, which is what marks.mjs actually draws', () => {
  assert.equal(ringSweep().sweep, 315);
});

/* ── the toolbar icon ──────────────────────────────────────────────────── */

test('action-icon.js exports the two functions the worker calls', () => {
  assert.equal(typeof startRecordingIcon, 'function');
  assert.equal(typeof stopRecordingIcon, 'function');
});

test('the breath is eight frames, 1 down to 0.55 and back', () => {
  const a = frameOpacities();
  assert.equal(a.length, FRAMES);
  assert.equal(a.length, 8);
  assert.equal(a[0], 1);
  assert.equal(Math.min(...a), 0.55);
  assert.equal(a[FRAMES / 2], 0.55, 'the trough should be halfway through');
  // Symmetric, so the loop has no seam.
  for (let i = 1; i < FRAMES / 2; i++) assert.equal(a[i], a[FRAMES - i], `frame ${i} does not mirror ${FRAMES - i}`);
  assert.equal(FRAMES * STEP_MS, 1760, 'the cycle should be ~1.8 s, like the popup');
});

test('the frame generator yields 8 frames at 16, 32 and 48', () => {
  // A canvas that records its size and draws nothing: the frame maths is what
  // is under test, not Chromium's rasteriser.
  const calls = [];
  const make = (size) => ({
    getContext: () => new Proxy({}, {
      get: (_t, k) => {
        if (k === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        return (...args) => calls.push([size, k, args]);
      },
      set: () => true,
    }),
  });

  const cycle = buildFrames({ make });
  assert.equal(cycle.length, 8);
  for (const frame of cycle) {
    assert.deepEqual(Object.keys(frame).map(Number), SIZES);
    for (const size of SIZES) {
      assert.equal(frame[size].width, size);
      assert.equal(frame[size].height, size);
      assert.equal(frame[size].data.length, size * size * 4);
    }
  }
  // Each frame draws each size once: a tile, a ring, a check, and (2026-09-21)
  // the recording-dot state badge — one more `arc` call per size per frame.
  assert.equal(calls.filter(([, k]) => k === 'arc').length, 8 * SIZES.length * 2);
  assert.equal(calls.filter(([, k]) => k === 'roundRect').length, 8 * SIZES.length);
});

test('16 px gets the heavy variant, 32 and 48 do not', () => {
  assert.equal(variantFor(16).weight, 8.5);
  assert.equal(variantFor(24).weight, 8.5);
  assert.equal(variantFor(32).weight, 7);
  assert.equal(variantFor(48).weight, 7);
  // The heavy variant shrinks the check with the ring, or it outgrows it.
  assert.equal(checkPoints(1)[2][0], 55);
  assert.ok(checkPoints(0.94)[2][0] < 55);
});

/* ── the wiring ────────────────────────────────────────────────────────── */

test('the worker starts and stops the icon where recording changes', () => {
  const sw = workerSrc();
  for (const fn of ['startRecordingIcon', 'stopRecordingIcon', 'syncRecordingIcon']) assert.match(sw, new RegExp(String.raw`import \{[^}]*\b${fn}\b[^}]*\} from '\./action-icon\.js'`), fn);
  // `startRecordingIcon(` and not `startRecordingIcon()`: both call sites now
  // carry an argument, because the icon takes the microphone flag since the
  // mic-live indicator went on the toolbar title (action-icon.js setMicLive).
  // What this asserts is the number of call sites, not their punctuation.
  const starts = sw.split('\n').filter((l) => /(?<![.\w])startRecordingIcon\(/.test(l)).length;
  const stops = sw.split('\n').filter((l) => l.includes('stopRecordingIcon()')).length;
  // Two ways into recording — the tab recorder and the screen recorder — one
  // way out, and the startup sweep that clears a frame a killed worker left.
  assert.equal(starts, 2, `startRecordingIcon() called ${starts} times, expected 2`);
  assert.equal(stops, 2, `stopRecordingIcon() called ${stops} times, expected 2`);
  assert.match(sw, /onStartup[\s\S]{0,200}stopRecordingIcon\(\)/);
  /*
   * And the resync at module scope, which is the one that matters most.
   *
   * `action-icon.js` keeps its interval in a module variable, and an MV3 worker
   * is torn down after thirty seconds of idleness - so the animation stopped on
   * its own over a recording that was still running, and `onStartup` fires once
   * per browser launch, not once per worker. The stop on the way out of a clip
   * is now reconciled from `recordingState()` rather than asserted, for the
   * same reason: a stop that failed must not report success.
   */
  assert.match(sw, /recordingState\(\)\s*\n\s*\.then\(\(state\) => syncRecordingIcon/);
  assert.match(sw, /if \(!st\.recording\) await stopRecordingIcon\(\)/);
});

test('ui/motion.js listens to signals the popup already gives off', () => {
  const js = read(path.join(EXT, 'ui', 'motion.js'));
  assert.match(js, /window\.UQAMotion = \{[^}]*wake[^}]*\}/);
  assert.match(js, /recording: recordingState/);
  assert.match(js, /data-awake/);
  assert.match(js, /#step-live/);
  assert.match(js, /prefers-reduced-motion/);
  const popup = read(path.join(EXT, 'popup', 'popup.html'));
  assert.match(popup, /data-awake/, 'the popup no longer has the data-awake hook');
  assert.match(popup, /id="step-live"/, 'the popup no longer has the step-live hook');
});

test('every surface that loads vfx also loads motion', () => {
  const pages = ['popup/popup.html', 'options/options.html', 'report/report.html', 'diagram/diagram.html', 'tutorials/tutorials.html'];
  const missing = [];
  for (const rel of pages) {
    const text = read(path.join(EXT, rel.replace('/', path.sep)));
    if (!text.includes('ui/motion.css')) missing.push(`${rel}: no motion.css`);
    if (!text.includes('ui/motion.js')) missing.push(`${rel}: no motion.js`);
    // The palette still has to come first, same rule as every other sheet.
    if (text.indexOf('identity-tokens.css') > text.indexOf('ui/motion.css')) missing.push(`${rel}: motion.css before the palette`);
  }
  assert.deepEqual(missing, [], missing.join(' | '));
});

/* ── the motion system: one set of tokens, and every surface on it ──────── */
/**
 * Why these are here and not in a browser.
 *
 * The brief asked for computed-style assertions. A computed style needs a
 * layout engine, and this suite runs in Node inside `npm test`, on every
 * machine that clones the repository — a suite that needs Chromium on the PATH
 * is a suite that gets skipped, which is decision 72's argument applied to a
 * different scanner. So the computed values were read by hand in the headed
 * pass (research/70 records the numbers Chromium actually reports), and what
 * runs here is the half that is decidable from the text: that the tokens
 * exist, that every rule spends them rather than a number of its own, and that
 * each surface still promises reduced motion.
 *
 * The failure this catches is the one that made the work necessary. Nothing
 * breaks when a stylesheet invents `160ms ease-out` next to a rule using
 * `var(--motion-base)`; the page renders, the animation plays, and the product
 * drifts back into having five timings by the end of the next round.
 */

const MOTION_JS = path.join(EXT, 'ui', 'motion.js');
const SURFACES = [
  ['popup/popup.css', true],
  ['options/options.css', true],
  ['report/report.css', true],
  ['welcome/welcome.css', true],
];

/** The motion block of a sheet: everything from the v5 banner to the end. */
const motionBlock = (text) => {
  const at = text.indexOf('in motion (v5)');
  return at === -1 ? '' : text.slice(at);
};

test('the motion system defines three durations and one curve, and no more', () => {
  const css = read(MOTION_CSS);
  const root = css.slice(css.indexOf('the motion system (v5)'));
  for (const [name, value] of [
    // Re-valued, UI rework round 2 (IMPLEMENTATION-PLAN.md §2, 27 Sept 2026).
    ['--motion-fast', '150ms'],
    ['--motion-base', '200ms'],
    ['--motion-slow', '250ms'],
    ['--motion-step', '18ms'],
    ['--motion-shift', '6px'],
    ['--motion-dir', '1'],
  ]) {
    // Every value is a plain number and a unit, so this is a string search and
    // not a pattern — the declaration is generated by nobody and hand-written
    // in one place, and `--motion-fast: 150ms;` is exactly what is there.
    assert.ok(root.includes(`${name}: ${value};`), `${name} is not ${value}`);
  }
  assert.match(root, /--motion-ease:\s*cubic-bezier\([^)]+\);/, 'no standard curve');
  // UI rework round 2, S11b: --motion-emphasis (and --motion-exit,
  // --motion-spring before it) were aliases of this one curve with no curve
  // of their own; once their last reader moved onto --motion-ease directly,
  // the alias was deleted rather than kept as a second name for one value.
  assert.equal(/--motion-emphasis\s*:/.test(root), false, '--motion-emphasis should be gone, not aliased');
  // One curve NAME, not five — a second one is how a system becomes a pile.
  const curves = [...root.matchAll(/--motion-[a-z-]*ease[a-z-]*/g)].map((m) => m[0]);
  assert.deepEqual(
    [...new Set(curves)].sort(),
    ['--motion-ease'],
    `more than one easing token: ${[...new Set(curves)].join(', ')}`
  );
});

test('the leading edge is a token, so Arabic mirrors without a second rule', () => {
  const css = read(MOTION_CSS);
  assert.match(css, /\[dir='rtl'\]\s*\{\s*--motion-dir:\s*-1;/, 'nothing flips --motion-dir in RTL');
  // Every horizontal keyframe has to multiply by it, or it is left-to-right only.
  for (const name of ['qaw-in-lead', 'qaw-in-trail', 'qaw-sweep']) {
    const frames = keyframeBody(css, name);
    assert.ok(frames, `no @keyframes ${name}`);
    assert.match(frames, /var\(--motion-dir\)/, `${name} does not mirror in RTL`);
    assert.equal(/translateX\(|translateY\(/.test(frames), false, `${name} should use translate3d, for its own layer`);
  }
});

test('every surface spends the tokens instead of inventing a timing', () => {
  const offenders = [];
  for (const [rel] of SURFACES) {
    const block = motionBlock(read(path.join(EXT, rel.replace('/', path.sep))));
    assert.ok(block, `${rel} has no motion block`);
    for (const [i, line] of block.split('\n').entries()) {
      if (!/(?:^|[;{\s])(?:transition|animation)(?:-duration|-delay|-timing-function)?\s*:/.test(line)) continue;
      // A raw duration is only allowed where the comment beside it says why —
      // the popup's entrance is faster than --motion-base on purpose.
      if (/entrance|on purpose|160ms|180ms/.test(line) && /1[68]0ms/.test(line)) continue;
      const raw = line.match(/\b\d+(?:\.\d+)?m?s\b/g) || [];
      const bad = raw.filter((v) => !/^0m?s$/.test(v) && !/^1\.8s$/.test(v) && !/^1\.15s$/.test(v));
      if (bad.length) offenders.push(`${rel}:${i + 1} ${bad.join(' ')} — ${line.trim()}`);
      // `ease-in-out` on a 1.8 s breathe is the house's own convention and
      // predates the system; a hand-written cubic-bezier is what drifts.
      if (/cubic-bezier/.test(line) && !/var\(--motion-/.test(line)) {
        offenders.push(`${rel}:${i + 1} a curve of its own — ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `these invent a timing instead of using the tokens:\n       ${offenders.join('\n       ')}`);
});

test('the key state changes each have an animation, on the shared keyframes', () => {
  const popup = read(path.join(EXT, 'popup', 'popup.css'));
  const block = motionBlock(popup);
  const wanted = [
    ['the tool cards enter with a stagger', /\.tiles > \.tool-row \{ animation: qaw-in-up/],
    ['the stagger is capped', /\.tiles > \.tool-row:nth-child\(5\) \{ animation-delay/],
    // S6: a state layer, not a lift (DESIGN-SPEC §8 #1); the menu enters.
    ['a row answers the pointer', /\.tool-row \.tool:hover,\n\.fav-run:hover \{ background: color-mix\(in srgb, currentColor calc\(var\(--state-hover\)/],
    ['a row answers a press', /\.tool-row \.tool:active,\n\.fav-run:active \{ background: color-mix\(in srgb, currentColor calc\(var\(--state-press\)/],
    ['the ⋯ menu enters', /\.menu\.is-entering \{ animation: qaw-menu-in/],
    ['the options panel unfolds', /\.opts-tool:not\(\[hidden\]\)/],
    ['the session steps cross-fade', /#step-live:not\(\[hidden\]\)/],
    ['a running tool is visibly running', /data-health='running'\]\)::after/],
  ];
  const missing = wanted.filter(([, re]) => !re.test(block)).map(([what]) => what);
  assert.deepEqual(missing, [], `the popup no longer animates: ${missing.join('; ')}`);
});

test('the height animation is behind @supports, and never fills forwards', () => {
  const css = read(MOTION_CSS);
  assert.match(css, /@supports \(interpolate-size: allow-keywords\)/, 'the unfold height is not feature-gated');
  // `forwards` on an unfold keeps `overflow: hidden` and `clip-path: inset(0)`
  // for the life of the panel, which clips the focus ring of the first control
  // inside it. Every unfold in the product fills backwards.
  const forwards = [];
  for (const [rel] of [...SURFACES, ['ui/motion.css']]) {
    const text = read(path.join(EXT, rel.replace('/', path.sep)));
    for (const [i, line] of motionBlock(text).split('\n').entries()) {
      if (/qaw-unfold/.test(line) && /\b(forwards|both)\b/.test(line)) forwards.push(`${rel}:${i + 1} ${line.trim()}`);
    }
  }
  assert.deepEqual(forwards, [], `an unfold that fills forwards clips what is inside it:\n       ${forwards.join('\n       ')}`);
});

test('nothing animates a layout property in a loop', () => {
  // Rule 2 of the system. An infinite animation runs while somebody is using
  // the surface, so its keyframes may touch transform and opacity and nothing
  // else. A one-shot may animate a height; a loop may not.
  const offenders = [];
  for (const [rel] of [...SURFACES, ['ui/motion.css'], ['ui/vfx.css']]) {
    const text = read(path.join(EXT, rel.replace('/', path.sep)));
    const looping = new Set(
      [...text.matchAll(/animation:[^;]*?\b([a-z-]+)\b[^;]*infinite/g)].map((m) => m[1])
        .concat([...text.matchAll(/animation-name:\s*([a-z-]+)[^;]*;[^}]*infinite/g)].map((m) => m[1]))
    );
    for (const name of looping) {
      const frames = keyframeBody(text, name);
      if (!frames) continue;
      for (const prop of frames[0].matchAll(/\n?\s*([a-z-]+)\s*:/g)) {
        if (['transform', 'opacity', 'background-position', 'stroke-dashoffset'].includes(prop[1])) continue;
        offenders.push(`${rel} @keyframes ${name} animates ${prop[1]} forever`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n       '));
});

test('every surface with motion still promises reduced motion', () => {
  const missing = [];
  for (const [rel, wants] of SURFACES) {
    if (!wants) continue;
    const text = read(path.join(EXT, rel.replace('/', path.sep)));
    if (!/@media \(prefers-reduced-motion: reduce\)/.test(text)) missing.push(`${rel}: no block at all`);
  }
  // The system's own block has to turn the stagger off too — a delay is the
  // part of a stagger that actually costs somebody time.
  const css = read(MOTION_CSS);
  const reduce = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduce, /animation-delay: 0ms !important/, 'reduced motion keeps the stagger');
  assert.match(reduce, /\.qaw-working::after \{ animation: none !important/, 'the working band keeps sweeping');
  assert.deepEqual(missing, [], missing.join(' | '));
});

test('the side panel and the welcome sheet are on the system too', () => {
  const panel = read(path.join(EXT, 'sidepanel', 'sidepanel.html'));
  assert.match(panel, /@keyframes panel-dock/, 'the panel appears with no dock');
  assert.match(panel, /prefers-reduced-motion: reduce/, 'the panel dock cannot be turned off');
  const welcome = read(path.join(EXT, 'welcome', 'welcome.html'));
  assert.match(welcome, /ui\/motion\.css/, 'the welcome sheet has no motion tokens');
  assert.ok(
    welcome.indexOf('identity-tokens.css') < welcome.indexOf('ui/motion.css'),
    'motion.css before the palette on the welcome sheet'
  );
});

test('ui/motion.js is the single entry point for motion a script drives', () => {
  const js = read(MOTION_JS);
  assert.match(js, /window\.UQAMotion = \{[^}]*replay[^}]*\}/, 'replay() is not exported');
  assert.match(js, /window\.UQAMotion = \{[^}]*notice[^}]*\}/, 'notice() is not exported');
  // The restart is remove / reflow / add. Without the reflow the browser
  // coalesces the two class changes and nothing plays.
  assert.match(js, /classList\.remove\(name\);\s*\n\s*void el\.offsetWidth;\s*\n\s*el\.classList\.add\(name\)/);
  assert.match(js, /if \(!el \|\| reduced\(\)\) return false;/, 'replay() plays under reduced motion');

  // And nobody restarts an animation any other way.
  const callers = [
    ['popup/popup.js', /window\.UQAMotion\?\.notice\(line\)/],
    ['options/options.js', /window\.UQAMotion\?\.notice\(el\)/],
  ];
  for (const [rel, re] of callers) {
    assert.match(read(path.join(EXT, rel.replace('/', path.sep))), re, `${rel} does not go through UQAMotion`);
  }
  // A toned status message already gets pop or shake from vfx.js, and two
  // animations on one element is the second one winning.
  assert.match(read(path.join(EXT, 'popup', 'popup.js')), /if \(!tone\) window\.UQAMotion\?\.notice\(line\)/);
});

test('no :active rule on report/replay/motion sets a press transform outside --press-scale', () => {
  // Scoped to this worker's owned sheets (report.css/replay.css/motion.css —
  // research/85 R06). Other surfaces (popup, options, devtools, tokens.css)
  // have their own deliberate :active transforms (checkbox ticks, range
  // thumbs, chart bars, reduced-motion overrides to `none`) that are not this
  // finding's bypass and are out of scope for this worker to touch.
  const offenders = [];
  const OWNED = ['report/report.css', 'replay/replay.css', 'ui/motion.css', 'ui/tokens.css'];
  for (const rel of OWNED) {
    const text = read(path.join(EXT, rel.replace('/', path.sep)));
    // A rule whose selector names :active, whose body sets `transform` to
    // something other than `none`/`none !important` (a reduced-motion or
    // disabled override) without `var(--press-scale)` inside it — the exact
    // shape of report.css:1213's deleted `.tab:active { transform: translateY(1px) }`.
    for (const m of text.matchAll(/([^{}]*:active[^{}]*)\{([^}]*)\}/g)) {
      const [, selector, body] = m;
      const tm = body.match(/transform\s*:\s*([^;]+);/);
      if (!tm) continue;
      if (/^none(\s*!important)?$/.test(tm[1].trim())) continue;
      if (/var\(--press-scale\)/.test(tm[1])) continue;
      // .chart-bar:active is a data bar's own scaleY, not a button press —
      // uniform --press-scale would distort the bar's height reading.
      if (/\.chart-bar/.test(selector)) continue;
      // checkbox/radio ticks scale in place on purpose (qaw-tick companion),
      // not a directional button press — same reasoning as .chart-bar above.
      if (/input\[type='checkbox'\], input\[type='radio'\]/.test(selector)) continue;
      offenders.push(`${rel} ${selector.trim()} — ${body.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `a hardcoded press magnitude bypasses the shared token:\n       ${offenders.join('\n       ')}`);
});

test('08-2: the popup spotlight scrolls instantly under reduced motion', () => {
  const code = read(path.join(EXT, 'popup', 'popup.js'));
  const fn = code.slice(code.indexOf('function spotlight('), code.indexOf('function spotlight(') + 700);
  assert.match(fn, /behavior: matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches \? 'auto' : 'smooth'/, 'scrollIntoView must not be smooth when the person asked for reduced motion');
  assert.ok(!/behavior: 'smooth' \}\)/.test(fn), 'an unconditional smooth scroll is left in spotlight()');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
