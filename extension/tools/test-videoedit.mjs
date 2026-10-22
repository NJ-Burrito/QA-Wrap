/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The video editor, checked without a browser.
 *
 * Almost everything that can go wrong in a video editor is arithmetic, and
 * arithmetic under a canvas is the kind that fails silently: a cut that keeps
 * one millisecond too much, a crop half a pixel wide, an overlay that shows a
 * frame late, a webcam square patched off the edge of the frame. None of it
 * throws. All of it ships.
 *
 * So the pure half of `videoedit/videoedit.js` is bounded by its own headers in
 * that file, lifted out here and run for real. The page loads the script as an
 * ES module, so it could have exported these — but then the test would import a
 * file whose first statements reach for `document`, and a test that needs a DOM
 * is a test that needs a browser. Evaluating the section is how the maths gets
 * tested at the cost of nothing.
 *
 * The other half of this file is structural, and it is one question: does the
 * shared drawing engine still draw every shape the markup editor's grid can
 * arm. `core/shapes.js` is now the only copy of that geometry, so a shape that
 * loses its case there loses it in both editors at once.
 *
 *   node tools/test-videoedit.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as Shapes from '../core/shapes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const src = fs.readFileSync(path.join(EXT, 'videoedit', 'videoedit.js'), 'utf8');
const html = fs.readFileSync(path.join(EXT, 'videoedit', 'videoedit.html'), 'utf8');
const annotate = fs.readFileSync(path.join(EXT, 'annotate', 'annotate.js'), 'utf8');

/* ── the pure section, lifted and run ──────────────────────────────────── */

const start = src.indexOf('/* ── edit maths');
const end = src.indexOf('/* ── editor state');
assert.ok(start > -1 && end > start, 'the edit maths section is not where the test can find it');
const maths = new Function(
  `${src.slice(start, end)}\nreturn { clamp, fmtClock, keptDuration, segmentAt, splitAt, removeRange, trimBounds, trimEdges, overlaysAt, cropRect, webcamTarget, pickMime, camRect, camLayerFrom, camTimeFor, gifPlan, GIF_CAPS, clipDurationMs };`
)();

console.log('the video editor — the cuts, the crop, the windows and the patch');

/* ── cuts ──────────────────────────────────────────────────────────────── */

test('T-036: an Infinity video.duration falls back to the stored durationMs, never to an empty editor', () => {
  assert.equal(maths.clipDurationMs(Infinity, 12345), 12345);
  assert.equal(maths.clipDurationMs(NaN, 800), 800);
  assert.equal(maths.clipDurationMs(7.5, 12345), 7500);
  assert.equal(maths.clipDurationMs(Infinity, undefined), 0);
});


const whole = [{ from: 0, to: 10000 }];

test('a clip starts as one kept segment and keeps its whole length', () => {
  assert.equal(maths.keptDuration(whole), 10000);
});

test('a split keeps both halves and changes nothing that is kept', () => {
  const after = maths.splitAt(whole, 4000);
  assert.deepEqual(after, [{ from: 0, to: 4000 }, { from: 4000, to: 10000 }]);
  assert.equal(maths.keptDuration(after), 10000, 'splitting dropped video');
});

test('a split outside every segment is left alone', () => {
  assert.deepEqual(maths.splitAt(whole, 0), whole, 'a split at the very start invented an empty block');
  assert.deepEqual(maths.splitAt(whole, 10000), whole, 'a split at the very end invented an empty block');
});

test('a cut in the middle leaves two blocks and a gap between them', () => {
  const after = maths.removeRange(whole, 3000, 5000);
  assert.deepEqual(after, [{ from: 0, to: 3000 }, { from: 5000, to: 10000 }]);
  assert.equal(maths.keptDuration(after), 8000);
});

test('a cut is the same whichever way round the two presses came', () => {
  assert.deepEqual(maths.removeRange(whole, 5000, 3000), maths.removeRange(whole, 3000, 5000));
});

test('a cut that spans several blocks takes the whole span', () => {
  const three = [{ from: 0, to: 2000 }, { from: 4000, to: 6000 }, { from: 8000, to: 10000 }];
  const after = maths.removeRange(three, 1000, 9000);
  assert.deepEqual(after, [{ from: 0, to: 1000 }, { from: 9000, to: 10000 }]);
});

test('a cut that swallows a whole block leaves no empty block behind', () => {
  const two = [{ from: 0, to: 2000 }, { from: 4000, to: 6000 }];
  assert.deepEqual(maths.removeRange(two, 4000, 6000), [{ from: 0, to: 2000 }]);
});

test('cutting everything leaves nothing, and says so as an empty list', () => {
  const after = maths.removeRange(whole, 0, 10000);
  assert.deepEqual(after, []);
  assert.equal(maths.keptDuration(after), 0, 'an export of nothing must not look like an export of everything');
});

test('the playhead knows which block it is in, and when it is in a gap', () => {
  const two = [{ from: 0, to: 2000 }, { from: 5000, to: 6000 }];
  assert.deepEqual(maths.segmentAt(two, 1999), { from: 0, to: 2000 });
  assert.equal(maths.segmentAt(two, 3000), null, 'a time inside a cut was reported as kept');
  // The end of a block is the start of the gap, not the last kept frame.
  assert.equal(maths.segmentAt(two, 2000), null);
});

/* ── overlay windows ───────────────────────────────────────────────────── */

test('an overlay shows inside its window and nowhere else', () => {
  const marks = [
    { tool: 'arrow', from: 0, to: 1000 },
    { tool: 'text', from: 500, to: 4000 },
    { tool: 'step', from: 9000, to: 10000 },
  ];
  assert.deepEqual(maths.overlaysAt(marks, 0).map((o) => o.tool), ['arrow']);
  assert.deepEqual(maths.overlaysAt(marks, 700).map((o) => o.tool), ['arrow', 'text']);
  assert.deepEqual(maths.overlaysAt(marks, 5000).map((o) => o.tool), []);
  // Half-open on purpose: `to` is the first frame the mark is gone, so two
  // marks handing over at the same millisecond never both draw.
  assert.deepEqual(maths.overlaysAt(marks, 1000).map((o) => o.tool), ['text']);
});

/* ── crop ──────────────────────────────────────────────────────────────── */

test('no crop is the whole frame', () => {
  assert.deepEqual(maths.cropRect(null, 1280, 720), { x: 0, y: 0, w: 1280, h: 720 });
});

test('a crop is whole pixels, because a canvas cannot be half a pixel wide', () => {
  const r = maths.cropRect({ x: 10.4, y: 20.6, w: 100.5, h: 50.4 }, 1280, 720);
  assert.deepEqual(r, { x: 10, y: 21, w: 101, h: 50 });
  assert.ok(Number.isInteger(r.w) && Number.isInteger(r.h));
});

test('a crop dragged backwards is the same rectangle', () => {
  assert.deepEqual(
    maths.cropRect({ x: 200, y: 200, w: -100, h: -50 }, 1280, 720),
    { x: 100, y: 150, w: 100, h: 50 }
  );
});

test('a crop cannot reach outside the frame', () => {
  const r = maths.cropRect({ x: 1200, y: 700, w: 400, h: 400 }, 1280, 720);
  assert.deepEqual(r, { x: 1200, y: 700, w: 80, h: 20 }, 'the crop escaped the frame');
});

test('a crop too small to record is no crop at all', () => {
  // A stray click is a 0x0 drag, and a zero-width canvas records nothing.
  assert.deepEqual(maths.cropRect({ x: 5, y: 5, w: 1, h: 1 }, 1280, 720), { x: 0, y: 0, w: 1280, h: 720 });
});

/* ── the webcam patch ──────────────────────────────────────────────────── */

const frame = { w: 1280, h: 720 };
const box = { w: 240, h: 180 };

test('every corner the picker offers maps to a place in the frame', () => {
  assert.deepEqual(maths.webcamTarget('top-left', frame, box), { x: 16, y: 16 });
  assert.deepEqual(maths.webcamTarget('top-right', frame, box), { x: 1024, y: 16 });
  assert.deepEqual(maths.webcamTarget('bottom-left', frame, box), { x: 16, y: 524 });
  assert.deepEqual(maths.webcamTarget('bottom-right', frame, box), { x: 1024, y: 524 });
});

test('the corners the picker offers are exactly the corners the map knows', () => {
  const offered = [...html.matchAll(/<option value="([a-z-]+)"/g)].map((m) => m[1]);
  const unmapped = offered.filter((corner) => !maths.webcamTarget(corner, frame, box));
  assert.deepEqual(unmapped, [], `offered by the picker, unknown to the map: ${unmapped.join(', ')}`);
  assert.equal(offered.length, 4, 'the four corners are the whole promise');
});

test('leaving the inset alone is not a corner', () => {
  assert.equal(maths.webcamTarget('', frame, box), null);
  assert.equal(maths.webcamTarget('middle', frame, box), null, 'an unknown corner must not land somewhere');
});

test('a square bigger than what is left of the frame lands inside it anyway', () => {
  const tight = maths.webcamTarget('bottom-right', { w: 200, h: 120 }, box);
  assert.deepEqual(tight, { x: 0, y: 0 }, 'the patch was drawn off the edge of the picture');
});

/* ── the container ─────────────────────────────────────────────────────── */

test('the export keeps the container the clip already had, when it can', () => {
  // No MediaRecorder in Node, so this asserts the floor: never undefined, and
  // never a container a browser has no encoder for.
  assert.equal(maths.pickMime('video/webm;codecs=vp8,opus'), 'video/webm');
  assert.equal(maths.pickMime(null), 'video/webm');
});

/* ── the clock ─────────────────────────────────────────────────────────── */

test('the clock reads as a clock, and never as a negative one', () => {
  assert.equal(maths.fmtClock(0), '0:00');
  assert.equal(maths.fmtClock(7400), '0:07');
  assert.equal(maths.fmtClock(64000), '1:04');
  assert.equal(maths.fmtClock(750000), '12:30');
  assert.equal(maths.fmtClock(-500), '0:00');
});

/* ── the shared drawing engine ─────────────────────────────────────────── */

test('core/shapes.js draws every shape the markup editor can arm', () => {
  // The grid is built from the table in annotate.js, so the table is the
  // promise: a shape armed there and unknown here draws nothing at all.
  const armed = [...annotate.matchAll(/\{\s*id:\s*'([^']+)',\s*kind:\s*'(?:drag|mark)'/g)].map((m) => m[1]);
  assert.ok(armed.length >= 14, `only found ${armed.length} shapes in the markup editor's table`);
  const missing = armed.filter((id) => !Shapes.SHAPE_IDS.includes(id));
  assert.deepEqual(missing, [], `armed by the grid, unknown to the shared engine: ${missing.join(', ')}`);
});

test('the modes the rail carries are in the engine too', () => {
  const modes = ['arrow', 'pen', 'text', 'step', 'highlight', 'blur'];
  const missing = modes.filter((id) => !Shapes.SHAPE_IDS.includes(id));
  assert.deepEqual(missing, [], `lost from the shared engine: ${missing.join(', ')}`);
});

test('every id the engine lists is a case the engine actually paints', () => {
  const engine = fs.readFileSync(path.join(EXT, 'core', 'shapes.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const draw = engine.slice(engine.indexOf('export function drawShape'));
  const unpainted = Shapes.SHAPE_IDS.filter((id) => !draw.includes(`case '${id}':`));
  assert.deepEqual(unpainted, [], `listed but never drawn: ${unpainted.join(', ')}`);
});

test('the engine is pure enough to be imported without a browser', () => {
  // It is, or this file would not have run: the import at the top would have
  // thrown on `document`. Stated as a test so the reason survives.
  const engine = fs.readFileSync(path.join(EXT, 'core', 'shapes.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const forbidden of ['document.', 'window.', 'chrome.']) {
    assert.ok(!engine.includes(forbidden), `core/shapes.js reaches for ${forbidden}, so it cannot be tested or reused`);
  }
  assert.equal(typeof Shapes.drawShape, 'function');
  assert.equal(typeof Shapes.downscaleBlur, 'function', 'the injected blur helper is gone');
});

/* ── the page ──────────────────────────────────────────────────────────── */

test('the editor reads and writes the store itself, never through a message', () => {
  // A Blob serialises to `{}` across `chrome.runtime` with no error at all.
  assert.match(src, /import \{ getMedia, putMedia, appendEvent \} from '\.\.\/core\/db\.js'/, 'the page does not open the store');
  assert.doesNotMatch(src, /UQA_MEDIA_BLOB/, 'a clip is being pushed through the message port');
});

test('saving a copy is the default and replacing asks first', () => {
  assert.match(html, /id="save-copy"[^>]*checked/, 'replacing the original is the default');
  assert.match(src, /window\.confirm\(t\('videoedit\.save\.confirmReplace'\)\)/, 'a replace happens with no confirmation');
});

test('an export can be cancelled, and a cancelled export saves nothing', () => {
  assert.match(src, /exporting\.cancelled = true/, 'nothing sets the cancel flag');
  assert.match(src, /if \(cancelled\) return null/, 'a cancelled export still returns a blob to save');
});

test('the page says what it cannot do about the webcam', () => {
  assert.match(html, /data-i18n="videoedit\.webcam\.honest"/, 'the webcam patch is presented as a move');
});

/* ── the webcam as a layer ─────────────────────────────────────────────────
   The other half of research/106: a clip whose recorder gave the webcam a
   track of its own has a rectangle the tester drags, and the arithmetic under
   that rectangle fails the same silent way the crop's does. */

test('a hidden layer is nothing to draw, and no layer at all is not an error', () => {
  assert.equal(maths.camRect(null, frame), null);
  assert.equal(maths.camRect({ x: 0, y: 0, w: 100, h: 60, hidden: true }, frame), null, 'a hidden webcam was still handed to the export');
});

test('the layer is whole pixels and cannot leave the picture', () => {
  const r = maths.camRect({ x: 1200.6, y: 700.4, w: 240.5, h: 180.2 }, frame);
  assert.ok(Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w) && Number.isInteger(r.h));
  assert.deepEqual(r, { x: 1039, y: 540, w: 241, h: 180, round: false }, 'the layer was drawn off the edge of the frame');
});

test('a layer bigger than the frame is shrunk to it rather than clipped away', () => {
  const r = maths.camRect({ x: 0, y: 0, w: 4000, h: 4000 }, frame);
  assert.deepEqual(r, { x: 0, y: 0, w: 1280, h: 720, round: false });
});

test('round or square is carried, because the export has to clip a circle', () => {
  assert.equal(maths.camRect({ x: 0, y: 0, w: 100, h: 60, round: true }, frame).round, true);
});

test('the recorder geometry is a starting rectangle in the corner that was ticked', () => {
  const layer = maths.camLayerFrom({ position: 'bottom-right', size: 22 }, frame);
  assert.equal(layer.w, 282, '22% of 1280 is the width that was ticked');
  assert.deepEqual(maths.camRect(layer, frame), {
    ...maths.camRect(layer, frame),
    x: 1280 - layer.w - 16,
    y: 720 - layer.h - 16,
  });
  assert.equal(layer.hidden, false);
  assert.equal(layer.round, false);
});

test('a missing or absurd geometry still lands somewhere sane', () => {
  // `geometry` is "a starting point, not a truth" (research/106), so nothing
  // downstream may depend on the recorder having written a sensible one.
  const none = maths.camLayerFrom(null, frame);
  assert.ok(none.w > 0 && none.h > 0);
  assert.deepEqual(maths.camLayerFrom({ position: 'nowhere', size: 900 }, frame), { ...maths.camLayerFrom({ position: 'nowhere', size: 900 }, frame) });
  const huge = maths.camLayerFrom({ position: 'top-left', size: 900 }, frame);
  assert.ok(huge.w <= frame.w, 'a nonsense size produced a layer wider than the picture');
});

test('the two recorders are aligned by offsetMs, and never by a negative time', () => {
  // offsetMs is the cam's first chunk minus the clip's, so the cam is behind.
  assert.equal(maths.camTimeFor(5000, 800), 4.2);
  assert.equal(maths.camTimeFor(5000, 0), 5);
  assert.equal(maths.camTimeFor(5000, undefined), 5, 'a companion with no offset must still play');
  // `currentTime = -0.4` is dropped in silence by every browser.
  assert.equal(maths.camTimeFor(200, 800), 0);
});

/* ── the export formats ───────────────────────────────────────────────────── */

test('a GIF is capped at sixty seconds, eight hundred pixels, and silence', () => {
  assert.deepEqual(maths.GIF_CAPS, { maxMs: 60000, maxWidth: 800, fps: 10 });
  const plan = maths.gifPlan({ x: 0, y: 0, w: 1280, h: 720 }, 90000);
  assert.equal(plan.w, 800, 'the width cap was not applied');
  assert.equal(plan.h, 450, 'the height did not follow the width');
  assert.equal(plan.ms, 60000, 'the length cap was not applied');
  assert.equal(plan.truncated, true, 'a clip that will be cut short must say so before the run');
  assert.equal(plan.silent, true);
  assert.equal(plan.delayMs, 100, 'ten frames a second is a 100ms delay per frame');
});

test('a clip already inside the caps is not scaled or truncated', () => {
  const plan = maths.gifPlan({ x: 0, y: 0, w: 640, h: 360 }, 12000);
  assert.deepEqual([plan.w, plan.h, plan.ms, plan.truncated], [640, 360, 12000, false]);
});

test('an edit that kept nothing still plans a GIF rather than dividing by zero', () => {
  const plan = maths.gifPlan({ x: 0, y: 0, w: 320, h: 240 }, 0);
  assert.equal(plan.ms, 0);
  assert.ok(plan.w >= 2 && plan.h >= 2);
});

test('the picker is built from the catalogue, and a format the browser refuses is disabled', () => {
  assert.match(src, /import \{[^}]*probeFormats[^}]*\} from '\.\.\/core\/file-probe\.js'/, 'the formats are not probed');
  assert.match(src, /option\.disabled = !available/, 'an unavailable format is offered and then fails');
  assert.match(src, /option\.title = available \? type\.note/, "the catalogue's own note is not the help text");
  assert.doesNotMatch(html, /<option value="(?:mp4|webm|mkv|gif|png)"/, 'the formats are hard-coded in the HTML, where a probe cannot reach them');
});

test('each of the four containers, the GIF and the still are reachable', () => {
  assert.match(src, /videoMime\(edit\.format\)/, 'the chosen container never reaches MediaRecorder');
  assert.match(src, /encodeGifAsync\(frames/, 'the GIF is not encoded by core/gif.js');
  assert.match(src, /toBlob\(\(blob\).*'image\/png'\)/, 'there is no current-frame-as-PNG');
  assert.match(src, /videoedit\.format\.gifCaps/, 'the GIF caps are not shown anywhere');
});

test('the caps are shown before the run, not reported after it', () => {
  const note = src.slice(src.indexOf('function showFormatNote'), src.indexOf('function showFormatNote') + 1200);
  assert.ok(note.includes('gifPlan('), 'the note does not compute the plan it is describing');
  assert.match(src, /\$\('mute'\)\.disabled = silent/, 'the mute control still implies a choice a GIF does not have');
});

/* ── the two clips, told apart ────────────────────────────────────────────── */

test('the editor says in one line which of the two clips it is holding', () => {
  assert.match(src, /videoedit\.mode\.layer/, 'a real webcam track is not announced');
  assert.match(src, /videoedit\.mode\.baked/, 'a baked-in inset is not announced');
  assert.match(html, /id="mode-note"/, 'there is nowhere to say it');
});

test('a clip with a track gets the layer panel and a baked one gets the patch', () => {
  assert.match(src, /\$\('webcam-layer-panel'\)\.hidden = !layer/);
  assert.match(src, /\$\('webcam-patch-panel'\)\.hidden = layer/, 'the patch is offered for a clip that has a real layer');
  // The legacy path is kept, not replaced: research/106 says so in as many words.
  assert.match(src, /function patchWebcam/, 'the lift-and-patch path for legacy clips is gone');
});

test('the companion is read by the parent id and drawn from its own video', () => {
  assert.match(src, /getMedia\(record\.webcamTrackId\)/, 'the companion is searched for rather than read off the parent');
  assert.match(src, /ctx\.drawImage\(camVideo/, 'the export does not draw the second video');
});

/* ── the report obeys the same contract ───────────────────────────────────── */

const report = fs.readFileSync(path.join(EXT, 'report', 'report.js'), 'utf8');

test("a webcam companion is never its own card, count, row or export part", () => {
  assert.match(report, /const isCompanion = \(m\) => m\.role === 'webcam'/, 'nothing in the report knows what a companion is');
  assert.match(report, /media = allMedia\.filter\(\(m\) => !isCompanion\(m\)\)/, 'the list every renderer reads still holds the companions');
  // One list, set in one place: the gallery, count-media, the timeline rows and
  // both export pickers all read `media`, so filtering it once is the contract.
  assert.match(report, /!\(e\.kind === 'recording' && isCompanionId\(e\.mediaId \|\| e\.captureId\)\)/, 'a companion can still take a timeline row');
  assert.doesNotMatch(report, /\n\s*media = mediaRes/, 'a media list is assigned without filtering the companions out');
});

test("the parent's card says the webcam is on its own track", () => {
  assert.match(report, /report\.media\.webcamTrack/, 'nothing tells the tester where the face went');
});

test('the report overlays the cam with CSS and never re-encodes to watch', () => {
  assert.match(report, /function stackWebcam/, 'there is no overlay');
  assert.match(report, /cam\.offsetMs/, 'the two videos are not aligned by the stored offset');
  const stack = report.slice(report.indexOf('function stackWebcam'), report.indexOf('function stackWebcam') + 1600);
  for (const forbidden of ['MediaRecorder', 'captureStream']) {
    assert.ok(!stack.includes(forbidden), `the report re-encodes to play a clip: ${forbidden}`);
  }
});

test('deleting a clip takes its companion with it', () => {
  assert.match(report, /m\.id !== item\.id && m\.parentId !== item\.id/, 'a layer outlives the clip it belongs to');
});

/* ── T-025: redact is an opaque fill; blur is "soften" ─────────────────── */

test('T-025: the redact tool paints an opaque block and the pixel under it is no longer the original', () => {
  const W = 20, H = 20, px = new Uint8Array(W * H).fill(200); // 200 = "the original"
  const ctx = {
    globalAlpha: 0.3, fillStyle: '#ff0000', save() {}, restore() {},
    fillRect(x, y, w, h) {
      assert.equal(this.globalAlpha, 1, 'a translucent redaction leaves the original legible');
      assert.equal(this.fillStyle, Shapes.REDACT_FILL);
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px[j * W + i] = 0;
    },
  };
  Shapes.drawShape(ctx, { tool: 'redact', colour: '#ff0000', x: 15, y: 12, w: -10, h: -8 }, {});
  assert.equal(px[8 * W + 10], 0, 'the pixel under the region is still the original');
  assert.equal(px[0], 200, 'the fill leaked outside the region');
});

/* ── T-072 / T-060: the keyboard trim ───────────────────────────────────── */

test('T-060: a clip that was never cut has handles at its two ends', () => {
  assert.deepEqual(maths.trimBounds([{ from: 0, to: 10000 }], 10000), { start: 0, end: 10000 });
  assert.deepEqual(maths.trimBounds([], 10000), { start: 0, end: 10000 }, 'no segments reads as the whole clip');
});

test('T-060: moving the start handle inward removes what it passes over, and outward gives it back', () => {
  const whole = [{ from: 0, to: 10000 }];
  const t1 = maths.trimEdges(whole, 2000, 10000, 10000);
  assert.deepEqual(t1, [{ from: 2000, to: 10000 }]);
  assert.deepEqual(maths.trimEdges(t1, 500, 10000, 10000), [{ from: 500, to: 10000 }], 'the edge comes back');
  assert.deepEqual(maths.trimEdges(whole, 0, 10000, 10000), whole, 'handles at the ends change nothing');
});

test('T-060: the end handle trims the tail the same way', () => {
  const t1 = maths.trimEdges([{ from: 0, to: 10000 }], 0, 7000, 10000);
  assert.deepEqual(t1, [{ from: 0, to: 7000 }]);
  assert.deepEqual(maths.trimEdges(t1, 0, 9000, 10000), [{ from: 0, to: 9000 }]);
});

test('T-060: a cut in the middle survives a trim at either end; a trim into a cut lands past it', () => {
  const cut = [{ from: 0, to: 3000 }, { from: 5000, to: 10000 }];
  assert.deepEqual(maths.trimEdges(cut, 1000, 9000, 10000), [{ from: 1000, to: 3000 }, { from: 5000, to: 9000 }]);
  assert.deepEqual(maths.trimEdges(cut, 4000, 10000, 10000), [{ from: 5000, to: 10000 }], 'the gap is not kept');
  assert.equal(maths.keptDuration(maths.trimEdges(cut, 1000, 9000, 10000)), 6000);
});

test('T-060: a trim never keeps nothing and never leaves the clip', () => {
  const whole = [{ from: 0, to: 10000 }];
  assert.deepEqual(maths.trimEdges(whole, 4000, 4000, 10000), whole, 'zero width is refused');
  const far = maths.trimEdges(whole, -500, 99999, 10000);
  assert.deepEqual(far, whole, 'handles are clamped to the clip');
  assert.deepEqual(maths.trimEdges([{ from: 0, to: 1000 }], 5000, 8000, 10000), [{ from: 5000, to: 8000 }], 'past every kept block still keeps what was asked');
});

test('T-072: nudgeShape moves a shape, a whole pen line, and a width-less mark, and stops at the frame', () => {
  const r = { x: 10, y: 10, w: 20, h: 10 };
  assert.equal(Shapes.nudgeShape(r, 5, -3, 100, 50), true);
  assert.deepEqual(r, { x: 15, y: 7, w: 20, h: 10 });
  const back = { x: 30, y: 20, w: -10, h: -5 }; // drawn right to left: its box starts at 20, 15
  Shapes.nudgeShape(back, -50, 0, 100, 50);
  assert.equal(back.x, 10, 'the left edge of a backwards box stops at 0');
  const pen = { points: [{ x: 90, y: 5 }, { x: 98, y: 9 }] };
  Shapes.nudgeShape(pen, 10, 0, 100, 50);
  assert.deepEqual(pen.points, [{ x: 92, y: 5 }, { x: 100, y: 9 }], 'the line keeps its shape and stops at the edge');
  const step = { x: 100, y: 3 };
  assert.equal(Shapes.nudgeShape(step, 5, 0, 100, 50), false, 'at the edge there is nothing to move');
  assert.deepEqual(step, { x: 100, y: 3 });
});

test('T-025: both editors arm redact first and call blur "soften", en and ar', () => {
  for (const page of ['annotate', 'videoedit']) {
    const h = fs.readFileSync(path.join(EXT, page, `${page}.html`), 'utf8');
    assert.match(h, /data-tool="redact"/, `${page} has no redact tool`);
    assert.ok(h.indexOf('data-tool="redact"') < h.indexOf('data-tool="blur"'), `${page}: redact must come before soften`);
    for (const lang of ['en', 'ar']) {
      const j = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', `${lang}.json`), 'utf8'));
      assert.ok(j[`${page}.tools.redact.name`] && j[`${page}.tools.redact.title`], `${page}.${lang}: redact strings missing`);
      assert.ok(!/blur|طمس/i.test(j[`${page}.tools.blur.name`]), `${page}.${lang}: the blur tool is still named blur`);
    }
  }
  assert.match(src, /'step', 'redact', 'blur'/, 'video editor does not accept redact');
  assert.match(annotate, /case 'redact':/, 'markup editor does not paint redact');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
