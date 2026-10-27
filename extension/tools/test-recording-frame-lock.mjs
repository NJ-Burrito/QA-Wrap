/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * A recording's frame never changes size (rec-resize-1027).
 *
 * The defect: 3.8.1 let tab capture follow the tab's own size, and the
 * compositor resized its canvas to every new feed size. Chrome's MP4 muxer keeps
 * the FIRST SPS only, so once the tab changed shape (DevTools, a side panel, a
 * window drag) every later frame decoded as vertical smear: the 2026-10-27 clip
 * has one SPS of 1438x476 and slices addressing macroblock 4520 of a 2700-block
 * frame, 2514 decoder errors in 70 s. Reproduced in real Chrome by resizing a
 * recorded canvas mid-clip; a locked canvas gives 0 errors
 * (research/rca-recording-2026-10-27-A.md).
 *
 * These assertions run the shipped `composite()` with a feed that changes size
 * and fail if the recorded canvas is ever resized after the encoder starts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift } from './lib-lift.mjs';
import { lockFrame, fitRect } from '../core/file-probe.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OFF = fs.readFileSync(path.join(HERE, '..', 'offscreen', 'offscreen.js'), 'utf8');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/**
 * Run the real composite() over a feed whose size follows `sizes`, one per 66 ms draw tick.
 * With `frames`, the feed reports presented frames (requestVideoFrameCallback); an entry's third
 * item `false` means no new frame arrived that tick (a still page), else one did.
 */
async function runComposite(sizes, cursor = false, frames = false) {
  const resizes = [];
  const draws = [];
  let fills = 0;
  let w = 300, h = 150; // a fresh canvas
  const canvas = {
    get width() { return w; }, set width(v) { w = v; resizes.push(['w', v]); },
    get height() { return h; }, set height(v) { h = v; resizes.push(['h', v]); },
    getContext: () => ({ fillRect() { fills++; }, drawImage: (_f, x, y, dw, dh) => draws.push({ x, y, w: dw, h: dh, cw: w, ch: h }) }),
    captureStream: () => ({ getTracks: () => [], getVideoTracks: () => [{}] }),
  };
  let tick = null;
  let clock = 1_000_000;
  const doc = { createElement: () => canvas };
  const feed = { videoWidth: 0, videoHeight: 0 };
  let frameCb = null;
  if (frames) feed.requestVideoFrameCallback = (cb) => { frameCb = cb; };
  const pointers = [];
  const make = new Function('document', 'setInterval', 'clearInterval', 'lockFrame', 'fitRect', 'drawPointer', 'Date',
    `${lift(OFF, 'composite')}\nreturn composite;`);
  const composite = make(doc, (fn) => { tick = fn; return 1; }, () => {}, lockFrame, fitRect, (_c, r) => pointers.push(r), { now: () => clock });
  const mixer = composite({ feed, fps: 15, cursor });
  let lockedAt = -1;
  let startedResizes = 0;
  for (let i = 0; i < sizes.length; i++) {
    const [sw, sh, fresh = true] = sizes[i];
    [feed.videoWidth, feed.videoHeight] = [sw, sh];
    if (frames && fresh && frameCb) { const cb = frameCb; frameCb = null; cb(); }
    tick();
    clock += 66;
    // eslint-disable-next-line no-await-in-loop
    await null;
    if (lockedAt < 0 && draws.length) { lockedAt = i; startedResizes = resizes.length; }
  }
  mixer.stop();
  return { resizes, draws, pointers, fills, lockedAt, lockedMs: lockedAt * 66, startedResizes, canvas: { w, h }, ready: mixer.ready };
}

console.log('recording frame lock — the encoder never sees a new frame size');

await test('lockFrame is even and fitRect fits and centres', () => {
  assert.deepEqual(lockFrame(1437, 979), { w: 1436, h: 978 });
  assert.deepEqual(fitRect(1438, 979, 1438, 979), { x: 0, y: 0, w: 1438, h: 979 });
  const r = fitRect(1438, 979, 1438, 476);
  assert.equal(r.h, 476);
  assert.ok(r.x > 0 && r.w < 1438, 'a taller tab is pillar-boxed inside the locked frame');
  const q = fitRect(1200, 300, 1438, 978);
  assert.equal(q.w, 1438);
  assert.ok(q.y > 0, 'a shorter tab is letter-boxed inside the locked frame');
});

await test('the canvas is never resized after the first painted frame (the 2026-10-27 clip)', async () => {
  // A passing first size, the real tab, then a window drag and DevTools: the shapes the clip went through.
  const sizes = [[1438, 476], [1438, 979], [1438, 979], [1438, 979], [1438, 979], [1300, 979], [1200, 700], [1438, 979], [1438, 600]];
  const run = await runComposite(sizes);
  assert.ok(run.lockedAt >= 0, 'nothing was ever drawn');
  assert.equal(run.resizes.length, run.startedResizes, `the canvas was resized after the encoder's first frame: ${JSON.stringify(run.resizes)}`);
  assert.deepEqual(run.canvas, { w: 1438, h: 978 }, 'the frame did not settle on the tab\'s real size');
  for (const d of run.draws) {
    assert.equal(d.cw, 1438); assert.equal(d.ch, 978);
    assert.ok(d.x >= 0 && d.y >= 0 && d.x + d.w <= d.cw + 1 && d.y + d.h <= d.ch + 1, `a frame was drawn outside the locked frame (beyond the 1 px odd-size crop):${JSON.stringify(d)}`);
  }
});

await test('a passing first size is not locked: the size must hold for 3 frames', async () => {
  const run = await runComposite([[1438, 476], [1438, 979], [1438, 979], [1438, 979]]);
  assert.notDeepEqual(run.canvas, { w: 1438, h: 476 }, 'locked on the passing first frame: the whole clip would be a strip');
  assert.ok(await run.ready, 'ready never resolved with the locked frame');
});

await test('the drawn pointer is mapped into the fitted picture, not the whole frame', async () => {
  const run = await runComposite([[1438, 979], [1438, 979], [1438, 979], [1200, 979]], true);
  const last = run.pointers.at(-1);
  assert.ok(last && last.x > 0 && last.w < 1438, 'drawPointer did not receive the fitted rectangle');
  assert.match(OFF, /ctx\.translate\(r\.x \+ x, r\.y \+ y\)/, 'drawPointer ignores the fitted rectangle\'s offset');
});

await test('every clip records the locked canvas, and only after it locked', () => {
  const start = OFF.slice(OFF.indexOf('async function startRecording'));
  assert.ok(!/const videoTrack = mixer \? mixer\.stream\.getVideoTracks\(\)\[0\] : sourceTrack/.test(start),
    'a clip without the drawn cursor records the raw source track again, which changes size with the tab');
  assert.match(start, /mixer = composite\(\{ feed, fps: fps \|\| 15, cursor: drawnCursor \}\)/, 'the compositor is optional again');
  const ready = start.indexOf('await Promise.race([mixer.ready');
  assert.ok(ready > 0 && ready < start.indexOf('recorder.start('), 'the encoder can start before the frame size is locked');
  assert.match(start, /if \(!frame\) throw Object\.assign\(new Error\(/, 'no picture is filed as an empty clip instead of refused');
});

/* ── B's review holes (rec-resize-1027 round 2) ── */

await test('a still page locks on the settled HiDPI size, not on the passing CSS-pixel size', async () => {
  // First frame 1438x476 (CSS pixels), no new frame for 400 ms, then one frame at 1798x595 and nothing after.
  const still = [[1438, 476, true], ...Array(5).fill([1438, 476, false]), [1798, 595, true], ...Array(30).fill([1798, 595, false])];
  const run = await runComposite(still, false, true);
  assert.deepEqual(run.canvas, { w: 1798, h: 594 }, `locked at ${run.canvas.w}x${run.canvas.h}: every frame would be scaled down`);
  assert.ok(run.lockedMs <= 1500, `a still page took ${run.lockedMs} ms to lock`);
});

await test('a page that never settles still locks within 4 s (inside the 5 s refusal bound)', async () => {
  const restless = Array.from({ length: 80 }, (_v, i) => [1200 + (i % 7) * 10, 700, true]);
  const run = await runComposite(restless, false, true);
  assert.ok(run.lockedAt >= 0 && run.lockedMs <= 4100, `locked at ${run.lockedMs} ms`);
});

await test('a moving page locks after 3 new frames of one size', async () => {
  const run = await runComposite([[1438, 476], [1798, 595], [1798, 595], [1798, 595], [1798, 595]], false, true);
  assert.deepEqual(run.canvas, { w: 1798, h: 594 });
  assert.ok(run.lockedAt <= 3, `locked at tick ${run.lockedAt}`);
});

await test('an odd size draws 1:1 (the odd pixel cropped), never resampled, no bars', async () => {
  assert.deepEqual(fitRect(1798, 595, 1798, 594), { x: 0, y: 0, w: 1798, h: 595 });
  assert.deepEqual(fitRect(1437, 979, 1436, 978), { x: 0, y: 0, w: 1437, h: 979 });
  const run = await runComposite(Array(6).fill([1798, 595]), false, true);
  assert.ok(run.draws.every((d) => d.x === 0 && d.y === 0 && d.w === 1798 && d.h === 595), JSON.stringify(run.draws.at(-1)));
  assert.equal(run.fills, 0, 'black bars are painted behind a picture that fills the frame');
});

await test('the stored duration runs from the recorder start, not from the press', () => {
  const start = OFF.slice(OFF.indexOf('async function startRecording'));
  const rs = start.indexOf('recorder.start(2000);');
  const from = start.indexOf('const recordingFrom = Date.now();');
  assert.ok(rs > 0 && from > rs, 'recordingFrom is not taken after recorder.start()');
  assert.match(start, /startedAt: recordingFrom,/, 'the active clip still counts from the press (the lock wait inflates every duration)');
});

await test('the no-picture refusal has a code and a sentence in both languages', () => {
  const read = (p) => fs.readFileSync(path.join(HERE, '..', p), 'utf8');
  assert.match(OFF, /code: 'NO_PICTURE'/);
  assert.match(OFF, /\.\.\.\(err\?\.code \? \{ code: err\.code \} : \{\}\)/, 'the offscreen reply drops the code');
  assert.match(read('background/media.js'), /res\.code \? \{ code: res\.code \}/, 'media.js drops the code');
  assert.match(read('popup/popup.js'), /NO_PICTURE: \{ key: 'popup\.refusal\.noPicture'/);
  for (const lang of ['en', 'ar']) {
    const cat = JSON.parse(read(`platform/i18n/${lang}.json`));
    assert.ok(cat['popup.refusal.noPicture'], `${lang}: popup.refusal.noPicture missing`);
    assert.ok(!/\btab sent\b/.test(cat['popup.refusal.noPicture']), `${lang}: names only the tab`);
  }
});

await test('«Save last 1 minute» records WebM only (it records the raw, resizing tab track)', () => {
  const ROLL = fs.readFileSync(path.join(HERE, '..', 'offscreen', 'rolling.js'), 'utf8');
  assert.match(ROLL, /const mime = videoMime\('webm'\);/);
  assert.ok(!/videoMime\('mp4'\)/.test(ROLL), 'the rolling buffer can fall back to MP4 again');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
