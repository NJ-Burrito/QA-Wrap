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

/** Run the real composite() over a feed whose size follows `sizes`, one per tick. */
async function runComposite(sizes, cursor = false) {
  const resizes = [];
  const draws = [];
  let w = 300, h = 150; // a fresh canvas
  const canvas = {
    get width() { return w; }, set width(v) { w = v; resizes.push(['w', v]); },
    get height() { return h; }, set height(v) { h = v; resizes.push(['h', v]); },
    getContext: () => ({ fillRect() {}, drawImage: (_f, x, y, dw, dh) => draws.push({ x, y, w: dw, h: dh, cw: w, ch: h }) }),
    captureStream: () => ({ getTracks: () => [], getVideoTracks: () => [{}] }),
  };
  let tick = null;
  const doc = { createElement: () => canvas };
  const feed = { videoWidth: 0, videoHeight: 0 };
  const pointers = [];
  const make = new Function('document', 'setInterval', 'clearInterval', 'lockFrame', 'fitRect', 'drawPointer',
    `${lift(OFF, 'composite')}\nreturn composite;`);
  const composite = make(doc, (fn) => { tick = fn; return 1; }, () => {}, lockFrame, fitRect, (_c, r) => pointers.push(r));
  const mixer = composite({ feed, fps: 15, cursor });
  let lockedAt = -1;
  let startedResizes = 0;
  mixer.ready?.then(() => {});
  for (let i = 0; i < sizes.length; i++) {
    [feed.videoWidth, feed.videoHeight] = sizes[i];
    tick();
    // eslint-disable-next-line no-await-in-loop
    await null;
    if (lockedAt < 0 && draws.length) { lockedAt = i; startedResizes = resizes.length; }
  }
  mixer.stop();
  return { resizes, draws, pointers, lockedAt, startedResizes, canvas: { w, h }, ready: mixer.ready };
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
    assert.ok(d.x >= 0 && d.y >= 0 && d.x + d.w <= d.cw && d.y + d.h <= d.ch, `a frame was drawn outside the locked frame: ${JSON.stringify(d)}`);
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
  assert.match(start, /if \(!frame\) throw new Error\(/, 'no picture is filed as an empty clip instead of refused');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
