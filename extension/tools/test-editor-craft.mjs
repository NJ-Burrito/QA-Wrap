/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-072 / T-073: editor craft and the replay iframe.
 *
 * Replay: the shipped `render()` is lifted out of replay/replay.js and ticked
 * ten times a second over a quiet log; the iframe's `srcdoc` must be written
 * under once per second (it is written once, for the first frame).
 * Annotate: the structure that makes copy, redo, nudge and the coalesced
 * repaint real is checked on the shipped source, comments removed.
 *
 *   node tools/test-editor-craft.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as Shapes from '../core/shapes.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(EXT, ...p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const rjs = read('replay', 'replay.js');
let clock = 0;
const fn = rjs.match(/function render\(ms\) \{[\s\S]*?\n\}\n/)[0];

test('replay: a quiet minute of 100 ms ticks writes srcdoc under once per second', () => {
  const stage = {};
  let writes = 0;
  Object.defineProperty(stage, 'srcdoc', { set() { writes++; } });
  const el = { textContent: '', value: '' };
  const ctx = {
    log: [{ k: 'snapshot', t: 0 }, { k: 'attr', t: 30000 }],
    shownIdx: -1, at: 0, window: {}, timer: null, lastWrite: 0, Date: { now: () => clock },
    $: (id) => (id === 'stage' ? stage : el),
    stateAt: () => ({}), toDocument: () => '<html></html>', mmss: () => '0:00', setScrubText: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(`${fn}; this.render = render;`, ctx);
  for (let ms = 0; ms < 20000; ms += 100) ctx.render(ms); // 20 s, 200 ticks, no entry inside
  assert.ok(writes / 20 < 1, `${writes} writes in 20 s`);
  ctx.render(30000);
  assert.equal(writes, 2, 'an entry inside the step does redraw');
});

test('replay: a mutation every 100 ms while playing reloads the frame at most twice a second; pausing draws the exact one (T-073)', () => {
  const stage = {};
  let writes = 0;
  Object.defineProperty(stage, 'srcdoc', { set() { writes++; } });
  const el = { textContent: '', value: '' };
  const busy = Array.from({ length: 200 }, (_, i) => ({ k: 'attr', t: i * 100 + 50 }));
  const ctx = {
    log: busy, shownIdx: -1, at: 0, window: {}, timer: 1, lastWrite: 0, Date: { now: () => clock },
    $: (id) => (id === 'stage' ? stage : el),
    stateAt: () => ({}), toDocument: () => '<html></html>', mmss: () => '0:00', setScrubText: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(`${fn}; this.render = render;`, ctx);
  for (let ms = 0; ms < 20000; ms += 100) { clock = ms + 1000; ctx.render(ms); } // 20 s of playback
  assert.ok(writes <= 41, `${writes} writes in 20 s of a busy page (was 200)`);
  ctx.timer = null;
  ctx.shownIdx = -1;
  const before = writes;
  ctx.render(20000);
  assert.equal(writes, before + 1, 'a paused or scrubbed frame is always exact');
  assert.match(rjs, /for \(let hi = log\.length; idx < hi;\)/, 'the entry count is bisected, not scanned');
  assert.match(read('replay', 'replay.css'), /\.marks button \{[^}]*width: 24px;[^}]*height: 24px;/, 'marks are 24 px targets');
});

test('replay: marks are buttons that seek; opens at the first failure', () => {
  const c = strip(rjs);
  assert.match(c, /createElement\('button'\)/);
  assert.match(c, /render\(m\.t\)/);
  assert.match(c, /render\(first \? first\.t : 0\)/);
  assert.match(c, /aria-valuetext/);
  assert.ok(!/id="marks"[^>]*aria-hidden/.test(read('replay', 'replay.html')));
});

const aj = strip(read('annotate', 'annotate.js'));
test('annotate: copy writes a ClipboardItem of image/png', () => {
  assert.match(aj, /new ClipboardItem\(\{ 'image\/png': blob \}\)/);
  assert.match(aj, /exportBlob\('image\/png'\)/);
});
test('annotate: redo stack, cleared by a new shape, kept by undo and redo', () => {
  assert.match(aj, /redoStack\.push\(last\)/);
  assert.match(aj, /function commit\(\) \{\s*redoStack\.length = 0/);
  assert.match(aj, /shapes\.push\(s\);\s*settle\(\)/);
});
test('annotate: a pointer move schedules one frame; committed layer is cached in a second canvas', () => {
  assert.match(aj, /scheduleRender\(\);\s*\}\);/);
  assert.match(aj, /function scheduleRender\(\)[\s\S]*requestAnimationFrame/);
  assert.match(aj, /ctx\.drawImage\(base, 0, 0\)/);
});
test('annotate: arrow keys nudge the last shape', () => {
  assert.match(aj, /startsWith\('Arrow'\)/);
  assert.match(aj, /function nudge\(dx, dy\)/);
});
test('annotate: nudge moves the last shape, stays inside the image, and a focused button keeps its arrow keys (T-072)', () => {
  const src = aj.slice(aj.indexOf('function nudge('), aj.indexOf('function undo('));
  const run = (shapes) => { const calls = []; vm.runInNewContext(`${src}; nudge(dx, dy)`, { shapes, source: { width: 100, height: 50 }, settle: () => calls.push(1), dx: -10, dy: 10 }); return calls.length; };
  const a = [{ x: 3, y: 49 }];
  assert.equal(run(a), 1);
  assert.equal(JSON.stringify(a[0]), JSON.stringify({ x: 0, y: 50 }), 'clamped to the image, not off it');
  const p = [{ points: [{ x: 5, y: 5 }, { x: 40, y: 20 }] }];
  run(p);
  assert.equal(JSON.stringify(p[0].points), JSON.stringify([{ x: 0, y: 15 }, { x: 35, y: 30 }]), 'the whole line moves together and stops at the edge');
  assert.match(aj, /\^\(INPUT\|SELECT\|TEXTAREA\|BUTTON\|A\)\$/, 'arrow keys on a focused control are left to it');
});
test('annotate: buttons and key pairs exist in both languages', () => {
  const h = read('annotate', 'annotate.html');
  assert.match(h, /id="redo"/); assert.match(h, /id="copy"/);
  for (const l of ['en', 'ar']) {
    const j = JSON.parse(read('platform', 'i18n', `${l}.json`));
    for (const k of ['annotate.header.redo', 'annotate.header.copy', 'annotate.status.copied', 'annotate.status.copyFailed', 'replay.marks.jump'])
      assert.ok(j[k], `${l} ${k}`);
  }
});

/* ── T-072 / T-060: the video editor's redo, nudge and keyboard trim ─────── */

const vsrc = read('videoedit', 'videoedit.js');
const vhtml = read('videoedit', 'videoedit.html');
const vcss = read('videoedit', 'videoedit.css');

/** The shipped state section and the shipped maths, run against stub elements. */
function videoEditor({ edit, tool = 'arrow', duration = 10000, frame = { width: 200, height: 100 } }) {
  const maths = vsrc.slice(vsrc.indexOf('/* ── edit maths'), vsrc.indexOf('/* ── editor state'));
  const state = vsrc.slice(vsrc.indexOf('/** Snapshots, newest last.'), vsrc.indexOf('/* ── the stage'));
  const els = {};
  const stub = (id) => (els[id] ||= { disabled: false, value: '', max: '', textContent: '', setAttribute(k, v) { this[k] = v; } });
  const ctx = {
    Shapes, $: stub, say: () => {}, t: (k, v) => `${k}${v ? JSON.stringify(v) : ''}`,
    render: () => {}, syncControls: () => {}, drawTimeline: () => ctx.api.syncTrim(),
    performance: { now: () => ctx.clock }, clock: 0,
    overlay: frame, edit, tool, duration,
  };
  vm.createContext(ctx);
  vm.runInContext(`${maths}\n${state}\nthis.api = { remember, undo, redo, nudge, trim, syncTrim, get edit() { return edit; }, set tool(v) { tool = v; } };`, ctx);
  return { api: ctx.api, els, ctx };
}

const sample = () => ({ crop: null, segments: [{ from: 0, to: 10000 }], overlays: [{ tool: 'rect', x: 10, y: 10, w: 20, h: 10 }], webcam: null, camLayer: { x: 50, y: 40, w: 40, h: 30 }, mute: false, format: 'webm' });
const plain = (v) => JSON.parse(JSON.stringify(v)); // out of the vm realm
const xy = (o) => JSON.stringify([o.x, o.y]);

test('video editor: redo brings back what undo took, and a new edit ends the redo branch', () => {
  const { api, els } = videoEditor({ edit: sample() });
  api.remember();
  api.edit.mute = true;
  api.undo();
  assert.equal(api.edit.mute, false);
  assert.equal(els.redo.disabled, false, 'the Redo button wakes after an undo');
  api.redo();
  assert.equal(api.edit.mute, true, 'redo restores the undone edit');
  assert.equal(els.redo.disabled, true);
  api.undo();
  api.remember();
  assert.equal(els.redo.disabled, true, 'a fresh edit clears the redo stack');
  api.redo();
  assert.equal(api.edit.mute, false, 'and redo then does nothing');
});

test('video editor: arrow nudge moves the newest mark inside the frame, and a run of presses is one undo', () => {
  const { api, ctx } = videoEditor({ edit: sample() });
  assert.equal(api.nudge(1, 0), true);
  api.nudge(10, 0);
  api.nudge(0, 1);
  assert.equal(xy(api.edit.overlays[0]), '[21,11]');
  ctx.clock = 100;
  api.nudge(1, 0); // still inside the same 800 ms run
  api.undo();
  assert.equal(xy(api.edit.overlays[0]), '[10,10]', 'the whole run is one undo');
  api.redo();
  assert.equal(api.edit.overlays[0].x, 22, 'and redo puts the whole run back');
  api.nudge(-500, 0);
  assert.equal(api.edit.overlays[0].x, 0, 'stops at the left edge');
  ctx.clock = 5000; // a pause starts a new run
  api.nudge(1, 0);
  api.undo();
  assert.equal(api.edit.overlays[0].x, 0, 'a later press is its own undo');
});

test('video editor: a nudge with no mark leaves the key alone; one at the edge records nothing', () => {
  const e = sample();
  e.overlays = [];
  assert.equal(videoEditor({ edit: e }).api.nudge(1, 0), false, 'no mark yet, so the key keeps its default');
  const f = sample();
  f.overlays[0].x = 180;
  const g = videoEditor({ edit: f });
  g.api.nudge(5, 0);
  assert.equal(g.api.edit.overlays[0].x, 180);
  assert.ok(!g.els.undo, 'nothing was remembered, so Undo was never touched');
});

test('video editor: with the webcam tool armed the arrows move the webcam layer instead', () => {
  const { api } = videoEditor({ edit: sample() });
  api.tool = 'webcam';
  api.nudge(10, 5);
  assert.equal(xy(api.edit.camLayer), '[60,45]');
  assert.equal(api.edit.overlays[0].x, 10, 'the mark stayed');
});

test('video editor: a trim handle trims, never closes below 100 ms, shows its time, and one run is one undo', () => {
  const { api, els, ctx } = videoEditor({ edit: sample() });
  api.syncTrim();
  assert.equal(els['trim-end'].value, '10000');
  assert.equal(els['trim-end']['aria-valuetext'], '0:10');
  api.trim('start', 1000);
  api.trim('start', 2000);
  assert.deepEqual(plain(api.edit.segments), [{ from: 2000, to: 10000 }]);
  assert.equal(els['trim-start'].value, '2000', 'the handle shows where the clip now begins');
  api.trim('end', 1900);
  assert.deepEqual(plain(api.edit.segments), [{ from: 2000, to: 2100 }], 'the end cannot come closer than 100 ms to the start');
  ctx.clock = 100;
  api.undo();
  assert.deepEqual(plain(api.edit.segments), [{ from: 2000, to: 10000 }], 'one undo takes back the end handle run');
  api.undo();
  assert.deepEqual(plain(api.edit.segments), [{ from: 0, to: 10000 }], 'and one the whole start-handle run');
  api.redo();
  api.redo();
  assert.deepEqual(plain(api.edit.segments), [{ from: 2000, to: 2100 }]);
});

test('video editor: the page wires Ctrl+Y, Ctrl+Shift+Z, a Redo button, arrow keys and both trim handles', () => {
  const c = strip(vsrc);
  assert.match(c, /key === 'y'/);
  assert.match(c, /e\.shiftKey\) redo\(\)/);
  assert.match(c, /\$\('redo'\)\.addEventListener\('click', redo\)/);
  assert.match(c, /startsWith\('Arrow'\)/);
  assert.match(c, /\^\(INPUT\|SELECT\|TEXTAREA\|BUTTON\|A\)\$/, 'a focused slider or button keeps its arrow keys');
  assert.match(c, /\$\('trim-start'\)\.addEventListener\('input'/);
  assert.match(c, /\$\('trim-end'\)\.addEventListener\('input'/);
  assert.match(vhtml, /id="redo"[^>]*disabled/);
  for (const id of ['trim-start', 'trim-end']) assert.match(vhtml, new RegExp(`<input type="range" id="${id}"[^>]*step="100"`));
});

test('video editor: the trim handles keep 24 px targets, and the new keys exist in both languages', () => {
  assert.match(vcss, /\.trim input\[type='range'\] \{[^}]*min-height: 24px/);
  const keys = ['videoedit.header.redo', 'videoedit.status.nudged', 'videoedit.status.trimmed', 'videoedit.trim.end', 'videoedit.trim.groupAria', 'videoedit.trim.start'];
  const lang = (l) => JSON.parse(read('platform', 'i18n', `${l}.json`));
  for (const k of keys) {
    for (const l of ['en', 'ar']) assert.ok(lang(l)[k], `${l} ${k}`);
    assert.deepEqual(lang('en')[k].match(/\{\w+\}/g) || [], lang('ar')[k].match(/\{\w+\}/g) || [], `${k}: same placeholders`);
  }
});

test('perf-editor is a by-hand tool: it measures with the paint counter against the pre-T-072 commit and is not in npm test', () => {
  const perf = read('tools', 'perf-editor.mjs');
  assert.match(perf, /__uqaPaintCount/);
  assert.match(perf, /5f79dd1\^/);
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!/perf-editor/.test(pkg.scripts.test), 'a by-hand tool is not part of npm test');
  assert.match(pkg.scripts['perf:editor'] || '', /perf-editor/, 'and it has its own script');
});

/* ── T-060: both editors without a pointer (WCAG 2.1.1, 2.5.7) ─────────── */

test('shapes: keyboardBox is centred; resizeShape sizes about the centre, stays in frame, leaves a mark alone', () => {
  const c = Shapes.keyboardBox(1000, 500);
  assert.deepEqual(c, { x: 350, y: 200, w: 300, h: 100 });
  const s = { x: 350, y: 200, w: 300, h: 100 };
  assert.equal(Shapes.resizeShape(s, 1.1, 1000, 500), true);
  assert.deepEqual([s.x, s.y, Math.round(s.w), Math.round(s.h)], [335, 195, 330, 110]);
  const edge = { x: 0, y: 0, w: 1000, h: 500 };
  assert.equal(Shapes.resizeShape(edge, 1.1, 1000, 500), false, 'a shape at the frame edge does not grow out of it');
  assert.equal(Shapes.resizeShape({ x: 5, y: 5 }, 1.1, 100, 100), false, 'a mark has no extent');
  const pen = { points: [{ x: 40, y: 50 }, { x: 60, y: 50 }] };
  assert.equal(Shapes.resizeShape(pen, 1.1, 100, 100), true);
  assert.equal(Math.round((pen.points[1].x - pen.points[0].x) * 10) / 10, 22);
});

const vj = strip(vsrc);
const eq = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b)); // vm objects have another realm's prototypes
const lift = (src, from, to, ctx, call) => vm.runInNewContext(`${src.slice(src.indexOf(from), src.indexOf(to))}; ${call}`, ctx);
const KEY_TOOLS = ['arrow', 'highlight', 'redact', 'blur', 'line', 'crop'];

test('annotate: Enter places every tool at the centre with no pointer, and the key handler runs only on the focused canvas', () => {
  for (const tool of [...KEY_TOOLS, 'pen', 'step', 'text', 'shape']) {
    const shapes = []; let typed = null;
    const ctx = { tool, shape: 'tick', SHAPE_BY_ID: new Map([['tick', { id: 'tick', kind: 'mark' }]]), shapes, crop: null, stepCounter: 0, source: { width: 1000, height: 500 }, colour: '#f00', width: 4, fontSize: 20, blurStrength: 8, commit: () => {}, render: () => {}, say: () => {}, t: (k) => k, placeText: (p) => { typed = p; } };
    lift(aj, 'function stampAt(', "canvas.addEventListener('pointerdown'", ctx, 'keyPlace()');
    if (tool === 'text') eq(typed, { x: 500, y: 250 });
    else if (tool === 'crop') eq(ctx.crop, { x: 350, y: 200, w: 300, h: 100 });
    else if (tool === 'pen') assert.equal(shapes[0].points.length, 2);
    else if (tool === 'shape') eq([shapes[0].tool, shapes[0].x, shapes[0].y], ['tick', 500, 250]);
    else if (tool === 'step') eq([shapes[0].tool, shapes[0].n, shapes[0].x], ['step', 1, 500]);
    else eq([shapes[0].tool, shapes[0].x, shapes[0].y, shapes[0].w, shapes[0].h], [tool, 350, 200, 300, 100]);
  }
  assert.match(aj, /document\.activeElement === canvas && \(e\.key === 'Enter'/);
  assert.match(read('annotate', 'annotate.html'), /<canvas id="canvas" tabindex="0"[^>]*data-i18n-aria="annotate\.stage\.aria"/);
});

test('videoedit: Enter places every tool at the centre, the webcam tool leaves a real cam layer alone, + and - size the last overlay', () => {
  for (const tool of [...KEY_TOOLS, 'step', 'text', 'shape', 'webcam']) {
    const edit = { overlays: [], crop: null, webcam: null }; let typed = null;
    const ctx = { tool, shape: 'dot', edit, video: { videoWidth: 1000 }, exporting: null, overlay: { width: 1000, height: 500 }, Shapes, hasCamTrack: () => false, remember: () => {}, rememberRun: () => {}, render: () => {}, say: () => {}, t: (k) => k, $: () => ({ value: '' }), windowNow: () => ({ from: 0, to: 9 }), placeText: (p) => { typed = p; }, stepCounter: 0, colour: '#f00', width: 4, fontSize: 20, blurStrength: 8 };
    lift(vj, 'const MARKS =', "overlay.addEventListener('pointerdown'", ctx, 'keyPlace()');
    if (tool === 'text') eq(typed, { x: 500, y: 250 });
    else if (tool === 'crop') eq(edit.crop, { x: 350, y: 200, w: 300, h: 100 });
    else if (tool === 'webcam') assert.equal(edit.webcam.from.x, 350);
    else assert.equal(edit.overlays[0].tool === (tool === 'shape' ? 'dot' : tool), true, `${tool}: ${JSON.stringify(edit.overlays)}`);
  }
  const edit = { overlays: [{ tool: 'blur', x: 350, y: 200, w: 300, h: 100 }] };
  lift(vj, 'function keySize(', "overlay.addEventListener('pointerdown'", { edit, overlay: { width: 1000, height: 500 }, Shapes, rememberRun: () => {}, render: () => {}, say: () => {}, t: (k) => k }, 'keySize(1.1)');
  assert.equal(Math.round(edit.overlays[0].w), 330);
  assert.match(vj, /document\.activeElement === overlay && \(e\.key === 'Enter'/);
  assert.match(vhtml, /<canvas id="overlay" tabindex="0"[^>]*data-i18n-aria="videoedit\.stage\.aria"/);
});

test('both stages have an accessible name and a resize message in both languages', () => {
  for (const l of ['en', 'ar']) {
    const j = JSON.parse(read('platform', 'i18n', `${l}.json`));
    for (const k of ['annotate.stage.aria', 'annotate.status.sized', 'videoedit.stage.aria', 'videoedit.status.sized']) assert.ok(j[k], `${l} ${k}`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
