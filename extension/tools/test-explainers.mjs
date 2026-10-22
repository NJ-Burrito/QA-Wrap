/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The explainers keep the rules they were drawn to (DESIGN-SPEC §11, UI round 2 S3).
 *
 * Reads only ui/scenes.js and ui/visuals.css. No browser: the drawing is a string and the motion
 * is a stylesheet, so every rule that can be a list comparison is one. What a picture looks like
 * is Nader's eye, not this file's.
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

const SRC = fs.readFileSync(path.join(EXT, 'ui', 'scenes.js'), 'utf8');
const CSS = fs.readFileSync(path.join(EXT, 'ui', 'visuals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The 22 scenes (visuals.json: 8 animated + 14 later), and the class prefix each one's motion uses. */
const PREFIX = {
  start: 'rs', pick: 'pk', report: 're', shot: 'sh', mask: 'mk', a11y: 'ay', links: 'ln', break: 'bk',
  record: 'rc', viewport: 'vp', perf: 'pf', whitebox: 'wb', blackbox: 'bb', inject: 'ij', autofill: 'af',
  harvest: 'hv', api: 'ap', spec: 'sp', fineprint: 'fp', rtl: 'rt', jira: 'jr', diagram: 'dg',
};

let loadError = null;
const win = {};
try { new Function('window', SRC)(win); } catch (err) { loadError = err; }
const S = win.UQAScenes;
const svgs = S ? Object.fromEntries(S.ids().map((id) => [id, S.svg(id)])) : {};

/** `@keyframes name { ... }` bodies, with their nested offset blocks. */
const KEYFRAMES = Object.fromEntries(
  [...CSS.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((m) => [m[1], m[2]])
);
/** `--loop` per scene, from the `[data-scene="…"]` selector lists that set it. */
const LOOP = {};
for (const m of CSS.matchAll(/([^{}]+)\{\s*--loop:\s*(\d+)ms;\s*\}/g)) {
  for (const s of m[1].matchAll(/data-scene="([\w-]+)"/g)) LOOP[s[1]] = Number(m[2]);
}

console.log('the explainers — frame, words, colour, motion');

test('loading the file in a bare window throws nothing and publishes the contract', () => {
  assert.equal(loadError, null, `ui/scenes.js threw at load: ${loadError && loadError.message}`);
  assert.ok(S && typeof S.svg === 'function' && typeof S.ids === 'function' && typeof S.play === 'function',
    'UQAScenes must publish svg(), ids() and play()');
});

test('there are exactly the 22 scenes, each on the 240x144 frame', () => {
  assert.deepEqual([...S.ids()].sort(), Object.keys(PREFIX).sort());
  for (const [id, svg] of Object.entries(svgs)) {
    assert.match(svg, /^<svg class="qaw-x" data-scene="[\w-]+" data-loop viewBox="0 0 240 144" aria-hidden="true"/, `${id} is not a looping 240x144 explainer`);
    assert.ok(svg.includes(`data-scene="${id}"`), `${id} carries another scene's name`);
  }
  assert.equal(S.svg('nothing-by-this-name'), null);
  assert.equal(S.svg('record-session'), svgs.start, 'the prototype id record-session no longer reaches start');
  assert.equal(S.svg('read-export'), svgs.report, 'the prototype id read-export no longer reaches report');
});

test('no words: no <text>, no font, no text node between the tags', () => {
  for (const [id, svg] of Object.entries(svgs)) {
    assert.ok(!/<text|<tspan|font-/.test(svg), `${id} carries type, which would need translating and a font inside SVG`);
    const between = svg.replace(/<[^>]*>/g, '').trim();
    assert.equal(between, '', `${id} has text between its tags: "${between.slice(0, 40)}"`);
  }
});

test('no colour literal and no id: paint is a token class, and many explainers share one page', () => {
  for (const [id, svg] of Object.entries(svgs)) {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(svg), `${id} hard-codes a colour`);
    assert.ok(!/\sid="|url\(#|\sstyle="|\sfill="|\sstroke="/.test(svg), `${id} carries an id, a url(#…), an inline style or a paint attribute`);
    assert.ok(!/NaN|undefined/.test(svg), `${id} drew a NaN or an undefined`);
  }
});

test('every paint class a scene uses is painted by visuals.css', () => {
  const used = new Set();
  for (const svg of Object.values(svgs)) {
    for (const m of svg.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (/^[fs]-/.test(c)) used.add(c);
  }
  const unpainted = [...used].filter((c) => !new RegExp(`\\.qaw-x \\.${c}\\s*\\{\\s*(fill|stroke):\\s*(var\\(--|color-mix\\()`).test(CSS));
  assert.deepEqual(unpainted, [], `used and never painted: ${unpainted.join(', ')}`);
});

test('keyframes animate only transform, opacity and clip-path', () => {
  const bad = [];
  for (const [name, body] of Object.entries(KEYFRAMES)) {
    for (const m of body.matchAll(/\{([^{}]*)\}/g)) {
      for (const decl of m[1].split(';')) {
        const prop = decl.split(':')[0].trim();
        if (prop && !['transform', 'opacity', 'clip-path'].includes(prop)) bad.push(`${name}: ${prop}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('every animation name has its keyframes, and every animated class is drawn', () => {
  const names = [...CSS.matchAll(/animation-name:\s*([\w-]+)/g)].map((m) => m[1]);
  const missing = names.filter((n) => !KEYFRAMES[n]);
  assert.deepEqual(missing, [], `animation-name with no @keyframes: ${missing.join(', ')}`);
  const all = Object.values(svgs).join('');
  const classes = [...CSS.matchAll(/\.qaw-x\.is-on \.([\w-]+)/g)].map((m) => m[1]);
  const undrawn = classes.filter((c) => !new RegExp(`class="[^"]*\\b${c}\\b`).test(all));
  assert.deepEqual(undrawn, [], `motion for a class no scene draws: ${undrawn.join(', ')}`);
});

test('every loop is 4 s or less, and holds its final beat for at least 1.2 s', () => {
  const late = [];
  for (const [id, prefix] of Object.entries(PREFIX)) {
    const loop = LOOP[id];
    assert.ok(loop, `${id} has no --loop`);
    assert.ok(loop <= 4000, `${id} loops for ${loop} ms`);
    const own = Object.entries(KEYFRAMES).filter(([n]) => n.startsWith(`${prefix}-`));
    assert.ok(own.length, `${id} has no keyframes of its own (${prefix}-*)`);
    const offsets = own.flatMap(([, body]) => [...body.matchAll(/([\d.]+)%/g)].map((m) => Number(m[1])).filter((o) => o < 100));
    const lastChange = (Math.max(...offsets) / 100) * loop;
    if (loop - lastChange < 1200) late.push(`${id}: last change at ${Math.round(lastChange)} ms of ${loop}`);
  }
  for (const m of CSS.matchAll(/animation(?:-duration)?:[^;]*?(\d+(?:\.\d+)?)(ms|s)\b/g)) {
    const ms = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
    assert.ok(ms <= 4000, `a duration of ${m[1]}${m[2]}`);
  }
  assert.deepEqual(late, []);
});

test('motion eases out on the token and plays twice, then rests on the poster', () => {
  const on = CSS.match(/\.qaw-x\.is-on \*\s*\{([^}]*)\}/);
  assert.ok(on, 'no rule sets the loop on the playing explainer');
  assert.match(on[1], /animation-duration:\s*var\(--loop\)/);
  assert.match(on[1], /animation-timing-function:\s*var\(--motion-ease\)/);
  assert.match(on[1], /animation-iteration-count:\s*1\.96/, 'two plays that stop inside the final hold');
  assert.match(CSS, /\.qaw-x\.is-on \.x-root\s*\{\s*animation-name:\s*x-loop/);
  assert.ok(!/cubic-bezier\([^)]*,\s*1\.\d|cubic-bezier\([^)]*,\s*-/.test(CSS), 'an easing that overshoots');
});

test('reduced motion switches the animation off, leaving the poster', () => {
  const block = CSS.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/);
  assert.ok(block, 'no prefers-reduced-motion block');
  assert.match(block[1], /\.qaw-x \*[^{]*\{\s*animation:\s*none/);
});

test('RTL mirrors the drawing and flips back what must stay as drawn', () => {
  assert.match(CSS, /\[dir="rtl"\] \.qaw-x \.x-root\s*\{\s*transform:\s*scaleX\(-1\)/);
  assert.match(CSS, /\[dir="rtl"\] \.qaw-x \.cm\s*\{\s*transform:\s*scaleX\(-1\)/);
  for (const [id, svg] of Object.entries(svgs)) assert.match(svg, /<g class="x-root">/, `${id} has no root to mirror`);
});

test('play() plays an explainer only while at least half of it is visible', () => {
  const observed = [];
  let callback = null;
  const classes = () => {
    const set = new Set();
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)) };
  };
  const el = { classList: classes(), getBoundingClientRect: () => ({}) };
  const listeners = {};
  const doc = { addEventListener: (t, fn) => { listeners[t] = fn; } };
  const root = { ownerDocument: doc, querySelectorAll: (sel) => (/\.qaw-x\[data-loop\]/.test(sel) ? [el] : []) };
  const w = {
    IntersectionObserver: class { constructor(cb, opts) { callback = cb; this.opts = opts; } observe(t) { observed.push(t); } },
  };
  new Function('window', SRC)(w);
  w.UQAScenes.play(root);
  assert.deepEqual(observed, [el], 'the explainer is not observed');
  callback([{ target: el, isIntersecting: true, intersectionRatio: 0.6 }]);
  assert.ok(el.classList.contains('is-on'), 'half visible and not playing');
  callback([{ target: el, isIntersecting: true, intersectionRatio: 0.3 }]);
  assert.ok(!el.classList.contains('is-on'), 'still playing with less than half in view');
  el.classList.add('is-on');
  listeners.animationend({ animationName: 'x-loop', target: { closest: () => el } });
  assert.ok(!el.classList.contains('is-on'), 'the second play does not hand back to the poster');
  listeners.pointerover({ target: { closest: () => el } });
  assert.ok(el.classList.contains('is-on'), 'hovering does not play it again');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
