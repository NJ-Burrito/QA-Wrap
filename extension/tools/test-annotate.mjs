/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The markup editor, checked without a browser.
 *
 * Three things landed in `annotate/` on 7 September and all three are the kind
 * that rot quietly:
 *
 * 1. **The text tool did not work.** The input was focused inside the very
 *    pointerdown that revealed it, the press's default action moved focus
 *    straight back off it, and the blur handler committed an empty label and
 *    hid the box before a key could be typed. Nobody noticed for weeks, because
 *    a text tool that silently does nothing looks exactly like a text tool
 *    somebody has not clicked properly. The guard flag that fixes it is one
 *    line, which is precisely why it needs a test standing over it.
 * 2. **Nine geometry buttons became one Shapes button** with a grid behind it.
 *    A picker is a second list of shapes, and a second list is a list that goes
 *    out of date: a button whose id has no `case` in `paint()` is a button that
 *    draws nothing at all and says nothing about it.
 * 3. **The palette is computed from the image** rather than fixed. That is
 *    arithmetic, and arithmetic either has a test or has a bug.
 *
 * None of this can open a page, so it does what a static check honestly can:
 * it reads the structure, and for the colour half it lifts the pure functions
 * out of the source and runs them for real. `annotate.html` loads the script
 * with a plain `<script src>`, so annotate.js cannot carry a top-level
 * `export` — a classic script with one would not parse and the editor would be
 * a blank page. Evaluating the section is how the maths gets tested without
 * costing the page its only script tag.
 *
 *   node tools/test-annotate.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const html = fs.readFileSync(path.join(EXT, 'annotate', 'annotate.html'), 'utf8');
const src = fs.readFileSync(path.join(EXT, 'annotate', 'annotate.js'), 'utf8');
const css = fs.readFileSync(path.join(EXT, 'annotate', 'annotate.css'), 'utf8');

/**
 * The script without its prose.
 *
 * Every rule below asks what the editor *does*, and the comments in that file
 * quote the very bug each rule prevents. A naive grep would pass on the
 * paragraph explaining the fix and fail to notice the fix had been deleted.
 */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * The body of one function, from its declaration to the next top-level one.
 *
 * `to` is optional, for the last thing in the file: bounding by the next
 * declaration is only a way of not reading the whole script, and the boot
 * function has nothing after it to bound against.
 */
function bodyOf(from, to = null) {
  const start = code.indexOf(from);
  assert.notEqual(start, -1, `${from} is gone`);
  if (!to) return code.slice(start);
  const end = code.indexOf(to, start);
  assert.notEqual(end, -1, `${to} is gone, so ${from} cannot be bounded`);
  return code.slice(start, end);
}

console.log('the markup editor — the rail, the text tool and the colour grid');

/* ── the rail ──────────────────────────────────────────────────────────── */

const railTools = [...html.matchAll(/data-tool="([^"]+)"/g)].map((m) => m[1]);

test('the rail has exactly one shapes button', () => {
  const shapes = railTools.filter((t) => t === 'shape');
  assert.equal(shapes.length, 1, `${shapes.length} shapes buttons on the rail, expected one`);
});

test('the geometry buttons are gone from the rail', () => {
  const gone = ['box', 'ellipse', 'line', 'circle', 'triangle', 'star', 'diamond'];
  const still = gone.filter((t) => railTools.includes(t));
  assert.deepEqual(still, [], `these belong in the shapes grid, not on the rail: ${still.join(', ')}`);
});

test('every mode that is not a shape is still its own rail button', () => {
  // These are different ways of drawing, not different geometries, so
  // collapsing them into the shapes picker would have hidden them behind a
  // menu for nothing.
  const modes = ['arrow', 'pen', 'text', 'step', 'highlight', 'blur', 'crop'];
  const missing = modes.filter((t) => !railTools.includes(t));
  assert.deepEqual(missing, [], `lost from the rail: ${missing.join(', ')}`);
});

test('the shapes button announces the grid it opens', () => {
  const btn = html.match(/<button[^>]*id="shapes-btn"[\s\S]*?>/);
  assert.ok(btn, 'no shapes button in the page');
  assert.match(btn[0], /aria-haspopup="true"/, 'the shapes button does not say it opens anything');
  assert.match(btn[0], /aria-expanded="false"/, 'the shapes button has no expanded state to toggle');
  assert.match(html, /id="shape-grid"[^>]*hidden/, 'the shapes grid is not closed to begin with');
});

/* ── the shapes table ──────────────────────────────────────────────────── */

/** The picker is built from this table, so the table is the picker. */
const shapeIds = [...src.matchAll(/\{\s*id:\s*'([^']+)',\s*kind:\s*'(drag|mark)'/g)].map((m) => ({
  id: m[1],
  kind: m[2],
}));

test('the shapes table holds the geometry and the marks it promised', () => {
  const want = [
    'rect', 'rounded', 'ellipse', 'circle', 'line', 'double-arrow', 'triangle', 'diamond', 'star',
    'tick', 'cross', 'question', 'exclaim', 'dot',
  ];
  const have = shapeIds.map((s) => s.id);
  const missing = want.filter((id) => !have.includes(id));
  assert.deepEqual(missing, [], `promised in the brief, absent from the grid: ${missing.join(', ')}`);
  assert.ok(shapeIds.some((s) => s.kind === 'mark'), 'no stamped marks at all');
});

test('every shape in the grid has a case in paint()', () => {
  // The failure this prevents is the quiet one: a button that arms a shape
  // `paint()` has never heard of draws nothing and reports nothing.
  const paint = bodyOf('function paint(s) {', 'function arrow(s) {');
  const unpainted = shapeIds.filter((s) => !paint.includes(`case '${s.id}':`)).map((s) => s.id);
  assert.deepEqual(unpainted, [], `armed by the grid, drawn by nothing: ${unpainted.join(', ')}`);
});

test('a stamped mark is pushed as a shape object, like every other shape', () => {
  // Shapes are objects redrawn from a list; that is what makes undo a pop
  // rather than a bitmap restore. A mark painted straight onto the canvas
  // would be the one thing undo could not take back.
  // T-060: the press and the Enter key share one stamping function.
  const down = bodyOf('function stampAt(', 'function finishShape(');
  assert.match(down, /kind === 'mark'/, 'nothing distinguishes a stamped mark from a dragged shape');
  assert.match(down, /shapes\.push\(\{ tool: armed\.id/, 'a mark is not pushed onto the shape list');
});

test('a stamped mark scales with the thickness and text size controls', () => {
  // A tick sized in absolute pixels is a speck on a 3000px screenshot.
  const size = bodyOf('function markSize(s) {', 'function markStroke(s) {');
  const stroke = bodyOf('function markStroke(s) {', 'function strokeMark(s, lines) {');
  assert.match(size, /s\.fontSize/, 'mark size ignores the text size control');
  assert.match(stroke, /s\.width/, 'mark stroke ignores the thickness control');
});

/* ── the text tool ─────────────────────────────────────────────────────── */

test('the text tool takes the press instead of letting it move focus', () => {
  const down = bodyOf("canvas.addEventListener('pointerdown'", "canvas.addEventListener('pointermove'");
  const textBranch = down.slice(down.indexOf("tool === 'text'"), down.indexOf("tool === 'step'"));
  assert.match(textBranch, /e\.preventDefault\(\)/, 'the text press still runs its default action, which blurs the input');
  // And the pointer is not captured for it: capture routes the gesture to the
  // canvas, and this tool needs the press to reach the input.
  const capture = down.indexOf('setPointerCapture');
  const text = down.indexOf("tool === 'text'");
  assert.ok(capture > text, 'the pointer is captured before the text branch gets a chance to opt out');
});

test('a blur that arrives before focus commits nothing', () => {
  const place = bodyOf('function placeText(p) {', 'function commit() {');
  assert.match(place, /let focused = false/, 'no guard flag: the opening click will commit an empty label again');
  assert.match(place, /onfocus = \(\) => \{\s*focused = true;\s*\}/, 'nothing ever sets the guard flag');
  assert.match(place, /onblur = \(\) => \{\s*if \(focused\) finish\(true\);\s*\}/, 'blur commits without checking that focus ever arrived');
  assert.doesNotMatch(place, /onblur = \(\) => finish\(true\)/, 'the unguarded blur-commit is back');
});

test('the caret is put in the box on the next frame, not inside the press', () => {
  const place = bodyOf('function placeText(p) {', 'function commit() {');
  assert.match(place, /requestAnimationFrame\(\(\) => \{\s*if \(!done\) input\.focus\(\);/, 'focus() is not deferred past the press');
  assert.match(place, /let done = false/, 'finishing is not idempotent, so Enter will commit the label twice');
});

test('Enter commits and Escape cancels', () => {
  const place = bodyOf('function placeText(p) {', 'function commit() {');
  assert.match(place, /if \(e\.key === 'Enter'\) finish\(true\)/, 'Enter does not commit the label');
  assert.match(place, /if \(e\.key === 'Escape'\) finish\(false\)/, 'Escape does not cancel the label');
  assert.match(place, /if \(keep && text\)/, 'an empty label would be committed as a shape');
});

/* ── the colour grid ───────────────────────────────────────────────────── */

test('the panel offers both suggestion sets and a way out of them', () => {
  assert.match(html, /id="swatches-image"/, 'no grid of colours taken from the image');
  assert.match(html, /id="swatches-visible"/, 'no grid of the most visible pens');
  assert.match(html, /From this image/, 'the sampled set is not labelled');
  assert.match(html, /Easiest to see on it/, 'the visibility set is not labelled');
  assert.match(html, /<input type="color" id="colour-custom"/, 'no way to choose a colour that is in neither set');
  assert.doesNotMatch(html, /id="swatches"/, 'the old fixed strip is still in the page');
});

test('a swatch is a labelled, pressable control and the top pick is marked', () => {
  const build = bodyOf('function swatchButton(hex, label, best = false) {', 'function buildSwatches() {');
  assert.match(build, /setAttribute\('aria-label', label\)/, 'a swatch with no label is a coloured circle');
  assert.match(build, /setAttribute\('aria-pressed'/, 'nothing says which swatch is armed');
  assert.match(build, /'swatch best'/, 'the top pick has no marker');
  assert.match(css, /\.swatch\.best/, 'the top pick is marked in the markup and nowhere on screen');
});

/**
 * The pure half of the colour work, lifted out of the source and run.
 *
 * The section is bounded by its own headers, which is also what keeps it pure:
 * anything reaching for the DOM or for editor state does not belong above the
 * `colour panel` header, and would fail here loudly the moment it moved.
 */
const start = src.indexOf('/* ── colour maths');
const end = src.indexOf('/* ── colour panel');
assert.ok(start > -1 && end > start, 'the colour maths section is not where the test can find it');
const maths = new Function(
  `${src.slice(start, end)}\nreturn { rgbOf, toHex, colourDistance, dominantColours, rankByVisibility };`
)();

test('toHex clamps and pads rather than emitting a broken colour', () => {
  assert.equal(maths.toHex(255, 0, 0), '#FF0000');
  assert.equal(maths.toHex(0, 0, 8), '#000008');
  assert.equal(maths.toHex(300, -20, 7.6), '#FF0008', 'out-of-range channels are not clamped');
});

test('colour distance is zero for a colour against itself, and symmetric', () => {
  assert.equal(maths.colourDistance('#B5432B', '#B5432B'), 0);
  assert.equal(
    Math.round(maths.colourDistance('#FFFFFF', '#111111')),
    Math.round(maths.colourDistance('#111111', '#FFFFFF'))
  );
  // Green carries the brightness, so a green shift must read as further than a
  // blue shift of the same numeric size. This is the whole reason the weighting
  // is there rather than a plain Euclidean distance.
  assert.ok(
    maths.colourDistance('#000000', '#008000') > maths.colourDistance('#000000', '#000080'),
    'the weighting has been lost: green and blue read as equally far from black'
  );
});

test('the sampler reports what an image is mostly made of', () => {
  // 100 red pixels, 50 blue, and 200 fully transparent green: the green is the
  // most common thing in the buffer and the one thing nobody can see.
  const px = [];
  const push = (r, g, b, a, n) => { for (let i = 0; i < n; i++) px.push(r, g, b, a); };
  push(255, 0, 0, 255, 100);
  push(0, 0, 255, 255, 50);
  push(0, 255, 0, 0, 200);
  const got = maths.dominantColours(Uint8ClampedArray.from(px), 6);
  assert.deepEqual(got, ['#FF0000', '#0000FF'], `sampled ${got.join(', ')}`);
});

test('the sampler averages a bucket rather than snapping it to a corner', () => {
  const px = [];
  const push = (r, g, b, a, n) => { for (let i = 0; i < n; i++) px.push(r, g, b, a); };
  push(200, 200, 200, 255, 1);
  push(206, 206, 206, 255, 1);
  const got = maths.dominantColours(Uint8ClampedArray.from(px), 6);
  assert.deepEqual(got, ['#CBCBCB'], `two near-identical greys should average to one, got ${got.join(', ')}`);
});

test('the ranking picks the pen that stands out on THIS image', () => {
  const pens = ['#B5432B', '#E2AE38', '#2A7A3B', '#2563EB', '#C2249B', '#111111', '#FFFFFF'];

  const onWhite = maths.rankByVisibility(pens, ['#FFFFFF', '#F4F4F4']);
  assert.equal(onWhite[0], '#111111', 'on a white page the top pick is not the darkest pen');
  assert.equal(onWhite.at(-1), '#FFFFFF', 'white is still offered first-class on a white page');

  const onDark = maths.rankByVisibility(pens, ['#111111', '#1A1A1A']);
  assert.equal(onDark[0], '#FFFFFF', 'on a dark page the top pick is not the lightest pen');
  assert.equal(onDark.at(-1), '#111111', 'black is still offered first-class on a black page');
});

test('a pen is scored by its worst moment, not its average one', () => {
  // A page that is mostly white with one red button: the red pen is a long way
  // from the white and no distance at all from the button, so it must not win.
  const pens = ['#B5432B', '#2563EB'];
  const image = ['#FFFFFF', '#FFFFFF', '#B5432B'];
  assert.equal(maths.rankByVisibility(pens, image)[0], '#2563EB', 'the ranking averaged instead of taking the worst case');
});

test('with nothing to rank against, the declared order stands', () => {
  const pens = ['#B5432B', '#E2AE38', '#2A7A3B'];
  assert.deepEqual(maths.rankByVisibility(pens, []), pens);
});

test('the panel reads the image before it ranks anything', () => {
  const boot = bodyOf('async function boot() {');
  assert.match(code, /function readImageColours\(\)/, 'nothing samples the image');
  assert.match(code, /getImageData\(0, 0, size, size\)\.data/, 'the sampler does not read pixels');
  assert.ok(
    boot.indexOf('readImageColours()') < boot.indexOf('buildSwatches()', boot.indexOf('readImageColours()')),
    'the swatches are built before the image has been read'
  );
  assert.match(boot, /if \(imageColours\.length && !shapes\.length\)/, 'the armed colour would be changed under a tester mid-markup');
});

// r7-09-3 (D-1010-160): marks, a crop or an unsaved trim are not lost to a stray tab close; a save records what it stored first.
test('r7-09-3: annotate.js asks before unload while marks or a crop are unsaved, and a save records its state before the reload', () => {
  const chunk = src.match(/let savedState = null;[\s\S]*?addEventListener\('beforeunload'[^\n]*\n/);
  assert.ok(chunk, 'annotate.js has no dirty check with a beforeunload handler');
  const listeners = {};
  const sandbox = { window: { addEventListener: (t, f) => { listeners[t] = f; } } };
  vm.runInNewContext(`const shapes = []; let crop = null; ${chunk[0]}
    globalThis.h = { shapes, setCrop(c) { crop = c; }, saved() { savedState = stateKey(); } };`, sandbox);
  const fire = () => { const e = { prevented: false, preventDefault() { this.prevented = true; } }; listeners.beforeunload(e); return e.prevented; };
  assert.equal(fire(), false, 'a clean editor must close without a prompt');
  sandbox.h.shapes.push({ tool: 'arrow' });
  assert.equal(fire(), true, 'a mark on the canvas must ask');
  sandbox.h.saved();
  assert.equal(fire(), false, 'a saved editor must not ask');
  sandbox.h.shapes.push({ tool: 'rect' });
  assert.equal(fire(), true, 'a mark added after the save must ask again');
  sandbox.h.shapes.length = 0;
  assert.equal(fire(), false, 'cleared marks are not a loss');
  sandbox.h.setCrop({ x: 1, y: 1, w: 5, h: 5 });
  assert.equal(fire(), true, 'a crop must ask');
  const save = code.slice(code.indexOf('async function save('));
  assert.ok(save.indexOf('savedState = stateKey()') > 0 && save.indexOf('savedState = stateKey()') < save.indexOf('location.replace'), 'a successful save must record its state before location.replace');
});

test('r7-09-3: videoedit.js asks before unload while an edit is unsaved, and a save clears the flag before the reload', () => {
  const vsrc = fs.readFileSync(path.join(EXT, 'videoedit', 'videoedit.js'), 'utf8');
  const vcode = vsrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const flag = vsrc.match(/let dirty = false;\r?\nwindow\.addEventListener\('beforeunload'[^\n]*\n/);
  const rem = vsrc.match(/function remember\(\) \{[\s\S]*?\n\}\n/);
  assert.ok(flag && rem, 'videoedit.js has no dirty flag with a beforeunload handler');
  const chunk = [`${flag[0]}\n${rem[0]}`];
  const listeners = {};
  const sandbox = { window: { addEventListener: (t, f) => { listeners[t] = f; } }, $: () => ({}) };
  vm.runInNewContext(`const history = []; const redoStack = []; let edit = {}; ${chunk[0]}
    globalThis.h = { remember, clear() { dirty = false; } };`, sandbox);
  const fire = () => { const e = { prevented: false, preventDefault() { this.prevented = true; } }; listeners.beforeunload(e); return e.prevented; };
  assert.equal(fire(), false, 'a clean editor must close without a prompt');
  sandbox.h.remember();
  assert.equal(fire(), true, 'an unsaved edit must ask');
  sandbox.h.clear();
  assert.equal(fire(), false, 'a saved edit must not ask');
  const exp = vcode.slice(vcode.indexOf('async function exportAndSave('));
  assert.ok(exp.indexOf('dirty = false') > 0 && exp.indexOf('dirty = false') < exp.indexOf('location.replace'), 'a successful save must clear the flag before location.replace');
  assert.match(vcode, /function restore\(json\) \{\s*dirty = true;/, 'undo and redo no longer mark the edit unsaved');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
