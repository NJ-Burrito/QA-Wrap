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
async function runComposite(sizes, cursor = false, frames = false, hint = null) {
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
  const mixer = composite({ feed, fps: 15, cursor, hint });
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
  assert.match(start, /mixer = composite\(\{ feed, fps: fps \|\| 15, cursor: drawnCursor, hint, urgent: /, 'the compositor is optional again');
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

/* ── 3.8.3: the late HiDPI step on a still page (B's round-3 residual) ── */

// 1438x476 CSS pixels at 125 %: the capture settles on 1798x595. One frame at the low size, nothing new
// until the step at `ms`, one frame at the full size, then nothing (a still page sends frames only on change).
const lateStep = (ms) => {
  const before = Math.round(ms / 66);
  return [[1438, 476, true], ...Array(before - 1).fill([1438, 476, false]), [1798, 595, true], ...Array(20).fill([1798, 595, false])];
};
// The real target computation, lifted from offscreen.js: Nader's tab, 1438x476 DIPs at 125 %.
const lockTargets = new Function(`${lift(OFF, 'lockTargets')}
return lockTargets;`)();
const HINT = lockTargets({ w: 1438, h: 476, px: [1797.5, 595] }, 1920, 1);
// A 1100x674 window at 125 % (B's window-drag tab), measured right after the drag back.
const TAB = lockTargets({ w: 1100, h: 674, px: [1375, 842.5] }, 1920, 1);
for (const ms of [700, 1500, 3000]) {
  await test(`a still page whose scale step lands at ${ms} ms locks at the full size, not the soft one`, async () => {
    const run = await runComposite(lateStep(ms), false, true, HINT);
    assert.ok(run.lockedAt >= Math.round(ms / 66), `locked at tick ${run.lockedAt}, before the scale step: the soft frame was locked`);
    assert.deepEqual(run.canvas, { w: 1798, h: 594 }, `locked at ${run.canvas.w}x${run.canvas.h}: the whole clip is scaled down`);
    assert.equal(run.resizes.length, run.startedResizes, 'the canvas changed size after the encoder started');
  });
  // B's live late-scale shape: the capture fitted to the 1920 edge in the passing shape, then in the tab's.
  await test(`a stale shape at the capture edge, replaced at ${ms} ms, locks at the tab's shape`, async () => {
    const before = Math.round(ms / 66);
    const run = await runComposite([[1920, 896, true], ...Array(before - 1).fill([1920, 896, false]), [1920, 1176, true], ...Array(20).fill([1920, 1176, false])],
      false, true, TAB);
    assert.deepEqual(run.canvas, { w: 1920, h: 1176 }, `locked at ${run.canvas.w}x${run.canvas.h}`);
  });
}

await test('a window drag stale shape on a still page is waited out (B: 1894x1194 locked instead of 1920x1176)', async () => {
  const run = await runComposite([[1894, 1194, true], ...Array(25).fill([1894, 1194, false]), [1920, 1176, true], ...Array(10).fill([1920, 1176, false])],
    false, true, TAB);
  assert.deepEqual(run.canvas, { w: 1920, h: 1176 });
});

await test('DevTools device mode (390x844 @3 in a 1100x760 tab) locks at once at the emulated shape', async () => {
  const device = lockTargets({ w: 1100, h: 760, px: [390 * 3, 844 * 3] }, 1920, 1.25);
  const run = await runComposite(Array(10).fill([887, 1920, false]), false, true, device);
  assert.deepEqual(run.canvas, { w: 886, h: 1920 }, `locked at ${run.canvas.w}x${run.canvas.h}`);
  assert.ok(run.lockedMs < 300, `device mode waited ${run.lockedMs} ms before the encoder could start`);
  assert.equal((await run.ready).by, 'hint');
});

await test('a capture locks at the size Chrome delivers, 1:1 or edge-fit, at once and never resampled (Lead, 2026-10-27)', async () => {
  const win = lockTargets({ w: 1086, h: 806, px: [1357.5, 1007.5] }, 1920, 1.25);
  const a = await runComposite(Array(4).fill([1358, 1008, false]), false, true, win);
  const b = await runComposite(Array(4).fill([1920, 1424, false]), false, true, win);
  assert.deepEqual([a.canvas, b.canvas], [{ w: 1358, h: 1008 }, { w: 1920, h: 1424 }]);
  assert.equal(a.lockedAt, 0); assert.equal(b.lockedAt, 0);
});

await test('device mode as measured live (390x844 @3: frames 854x1846, computed 887x1920) locks at once, phone-shaped', async () => {
  const device = lockTargets({ w: 1086, h: 806, px: [1170, 2532] }, 1920, 1.25);
  const run = await runComposite(Array(10).fill([854, 1846, false]), false, true, device);
  assert.equal(run.lockedAt, 0, `waited ${run.lockedMs} ms (was the 4 s bound live: 4196 ms Record to recording)`);
  assert.deepEqual(run.canvas, { w: 854, h: 1846 });
  // A soft frame of the tab's own shape is not taken for the phone.
  const tabShaped = await runComposite(Array(3).fill([1086, 806, false]), false, true, device);
  assert.equal(tabShaped.lockedAt, -1);
});

await test('the targets: the tab fitted to the edge and 1:1, and the page as it sees itself', () => {
  assert.deepEqual(HINT, [{ w: 1920, h: 636 }, { w: 1798, h: 595 }], 'the page has the tab shape: no device-mode target');
  assert.deepEqual(lockTargets({ w: 1438, h: 476 }, 1920, 1.5), [{ w: 1920, h: 636 }, { w: 1920, h: 636 }], 'no in-tab measure: the offscreen ratio, capped');
  const device = lockTargets({ w: 1086, h: 806, px: [1170, 2532] }, 1920, 1.25);
  assert.deepEqual(device.at(-1), { w: 887, h: 1920, shape: true });
  assert.equal(lockTargets(null, 1920, 1), null);
});

await test('a capture already at the known size locks on its first frame', async () => {
  const run = await runComposite(Array(6).fill([1798, 595, false]), false, true, HINT);
  assert.equal(run.lockedAt, 0, `waited ${run.lockedMs} ms for a size already known`);
  assert.equal((await run.ready).by, 'hint');
});

await test('a known size that never arrives still locks within the 4 s bound', async () => {
  const run = await runComposite(Array(80).fill([1438, 476, false]), false, true, HINT);
  assert.ok(run.lockedAt >= 0 && run.lockedMs <= 4100, `locked at ${run.lockedMs} ms`);
  assert.equal((await run.ready).by, 'bound');
});

await test('without a hint (a screen capture) the frame rule alone locks, within 0.6 s on a still page', async () => {
  const run = await runComposite(Array(30).fill([1900, 700, false]), false, true, null);
  assert.deepEqual(run.canvas, { w: 1900, h: 700 });
  assert.ok(run.lockedMs <= 700, `locked at ${run.lockedMs} ms`);
});

await test('the tab start passes the viewport, and the offscreen start turns it into the hint', () => {
  const MEDIA = fs.readFileSync(path.join(HERE, '..', 'background', 'media.js'), 'utf8');
  assert.ok(MEDIA.includes('view: tab && { w: tab.width, h: tab.height, px: px?.result }'), 'the worker no longer sends the tab size');
  assert.ok(MEDIA.includes('func: () => [innerWidth * devicePixelRatio, innerHeight * devicePixelRatio]'), 'the pixel size is no longer measured in the tab');
  const start = OFF.slice(OFF.indexOf('async function startRecording'));
  assert.ok(start.includes('const hint = desktop ? null : lockTargets(view, edge, devicePixelRatio);'), 'the start no longer derives the targets from the tab');
  assert.ok(start.includes('lock: frame }'), 'the start reply no longer says how the frame locked');
});

await test('the lock reports the presented-frame count (null without requestVideoFrameCallback)', async () => {
  const withRvfc = await (await runComposite(Array(5).fill([800, 600]), false, true)).ready;
  assert.ok(withRvfc.rvfc >= 3, JSON.stringify(withRvfc));
  const without = await (await runComposite(Array(12).fill([800, 600]), false, false)).ready;
  assert.equal(without.rvfc, null);
});

await test('the webcam fault seam is inert unless a harness sets __qawFault', () => {
  const root = path.join(HERE, '..');
  const shipped = fs.readdirSync(root, { recursive: true })
    .filter((f) => /\.(js|html)$/.test(f) && !/^(node_modules|dist|tools|store|site)[\\/]/.test(f));
  const setters = shipped.filter((f) => /__qawFault\s*=/.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(setters, [], 'shipped code sets the test fault');
  assert.ok(OFF.includes("const fault = (m) => /^video\\/mp4/.test(m) && globalThis.__qawFault;"), 'the seam is gone or no longer MP4-only');
});

await test('a Record pressed while «Save last 1 minute» is opening the tab wins the tab (recording.mjs step 10)', async () => {
  // The failing run's state: {"recording":false,"rolling":true}. The buffer's capture resolved after the Record
  // had claimed the document, kept the tab, and the Record's own capture failed.
  const stopped = [];
  globalThis.navigator ??= {};
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped.push('v') }] }) } });
  globalThis.chrome ??= { runtime: { id: 'x', onMessage: { addListener() {} } } };
  globalThis.MediaRecorder ??= { isTypeSupported: () => true };
  const roll = await import('../offscreen/rolling.js');
  const out = await roll.rollOp({ op: 'start', streamId: 's', sessionId: 'x', tabId: 1 }, () => true);
  assert.deepEqual(out, { rolling: false, why: 'recording' });
  assert.deepEqual(stopped, ['v'], 'the buffer kept the tab capture it opened');
  assert.equal(roll.rolling(), false);
  const start = OFF.slice(OFF.indexOf('async function startRecording'));
  const wait = start.indexOf('if (rollBusy) { await rollBusy; await rollMod?.stopRoll(); }');
  assert.ok(wait > 0 && wait < start.indexOf('navigator.mediaDevices.getUserMedia'), 'the Record opens the tab before an opening buffer let go');
  assert.ok(OFF.includes("rollOp(msg, () => !!active || rollCancel)"), 'the buffer is not told a Record holds the document');
  // The worker stops the buffer BEFORE it mints the Record's id: an id minted while the buffer's capture opens is
  // invalidated when that capture starts (live: "Invalid state", every run with the stop after the mint).
  const MEDIA = fs.readFileSync(path.join(HERE, '..', 'background', 'media.js'), 'utf8');
  const rec = MEDIA.slice(MEDIA.indexOf('export async function startRecording'));
  const stop = rec.indexOf("await rollOp({ op: 'stop' }).catch(() => {});");
  assert.ok(stop > 0 && stop < rec.indexOf('chrome.tabCapture.getMediaStreamId'), 'the Record id is minted while the buffer may still be opening the tab');
  assert.ok(OFF.includes("if (msg.op === 'stop') { rollCancel = true; await rollBusy; }"), 'a stop does not wait for a buffer still opening the tab');
});

await test('a webcam that will not record is said in EN and AR, and the screen clip goes on', () => {
  const read = (p) => fs.readFileSync(path.join(HERE, '..', p), 'utf8');
  const start = OFF.slice(OFF.indexOf('async function startRecording'));
  assert.ok(start.includes("camRecorder = null;") && start.includes("refused.push('webcam-not-saved');"), 'the cam failure is no longer a coded refusal');
  assert.ok(read('popup/tool-actions.js').includes("r === 'webcam-not-saved' ? t('popup.record.camNotSaved')"), 'the popup prints the code, not the sentence');
  assert.ok(read('background/notify.js').includes("r === 'webcam-not-saved' ? f('camNotSaved'"), 'the notification prints the code, not the sentence');
  for (const lang of ['en', 'ar']) {
    const cat = JSON.parse(read(`platform/i18n/${lang}.json`));
    assert.ok(cat['popup.record.camNotSaved'] && cat['common.worker.note.camNotSaved'], `${lang}: the webcam notice is missing`);
  }
});

/* ── 3.8.3 round 6 (A3): one lifecycle, idle -> starting -> recording -> finishing -> idle, every interleaving ── */

const CANCEL = () => Object.assign(new Error('Stopped before the recording began. Nothing was recorded.'), { code: 'REC_CANCELLED' });
/** The shipped stopRecording, `active` in a closure the test can set; fileClip answers what it was given; timers run at once. */
function liftStop({ hang = false } = {}) {
  const within = (p, ms, v) => (hang ? Promise.resolve(v) : Promise.resolve(p));
  const make = new Function('fileClip', 'releaseElements', 'setTimeout', 'cancelled', 'within',
    `let active = null;\nasync ${lift(OFF, 'stopRecording')}\nreturn { stop: stopRecording, set: (a) => { active = a; }, get: () => active };`);
  return make((session, extra) => ({ id: session.id, stored: true, ...extra }), () => {}, (fn) => fn(), CANCEL, within);
}
const recorder = (id, extra = {}) => ({ kind: 'recorder', id, startedAt: 1, stop: async () => ({ ok: true }), flushed: async () => {}, tailChunks: () => [], ...extra });
const starting = (id) => { let begin; const c = { kind: 'starting', id, cancel: false, begun: new Promise((r) => { begin = r; }) }; return [c, begin]; };

await test('Stop while idle: "Nothing is being recorded" (the worker turns a pending start into REC_CANCELLED first)', async () => {
  await assert.rejects(liftStop().stop({}), /Nothing is being recorded/);
});

await test('Stop while starting, the start sees the cancel: coded REC_CANCELLED, nothing filed, nothing left recording', async () => {
  const off = liftStop();
  const [claim, begin] = starting('m1');
  off.set(claim);
  const stopping = off.stop({});
  await null;
  assert.equal(claim.cancel, true, 'the start is not told to stop');
  claim.error = CANCEL(); off.set(null); begin(); // what startRecording's live() + abort() do
  await assert.rejects(stopping, (e) => e.code === 'REC_CANCELLED');
  assert.equal(off.get(), null);
});

await test('Stop while starting, the start was already past its last check: the clip is filed', async () => {
  const off = liftStop();
  const [claim, begin] = starting('m2');
  off.set(claim);
  const stopping = off.stop({});
  off.set(recorder('m2')); begin();
  assert.equal((await stopping).id, 'm2');
});

await test('Stop while starting, the start then fails on its own: its coded refusal, never an uncoded sentence', async () => {
  const off = liftStop();
  const [claim, begin] = starting('m3');
  off.set(claim);
  const stopping = off.stop({});
  claim.error = Object.assign(new Error('The tab or screen sent nothing to record.'), { code: 'NO_PICTURE' }); off.set(null); begin();
  await assert.rejects(stopping, (e) => e.code === 'NO_PICTURE');
  const [c2, b2] = starting('m4'); off.set(c2); const s2 = off.stop({}); c2.error = new Error('raw'); off.set(null); b2();
  await assert.rejects(s2, (e) => e.code === 'REC_CANCELLED');
});

await test('a double Stop: the second answers "already being saved", the first files once', async () => {
  const off = liftStop();
  let release;
  off.set(recorder('m5', { stop: () => new Promise((r) => { release = r; }) }));
  const first = off.stop({});
  await null;
  await assert.rejects(off.stop({}), /already being saved/);
  release({ ok: true });
  assert.equal((await first).id, 'm5');
});

await test('Record during finishing is refused (one clip at a time), and the start claims before any wait', () => {
  const start = OFF.slice(OFF.indexOf('async function startRecording'));
  assert.ok(start.indexOf("if (active) throw new Error('Already recording.") < start.indexOf('await '), 'a start can yield before checking the lifecycle');
  assert.ok(start.indexOf('active = claim;') < start.indexOf('await '), 'the claim is made after a wait: a Stop right behind the start finds idle');
  assert.ok(start.indexOf('if (cancelNext) { cancelNext = false; throw cancelled(); }') > 0, 'a worker cancel that arrived first is ignored');
  for (const after of ['live();\n    const gotAudio', 'camStream = gotCam;\n    live();', "{ code: 'NO_PICTURE' });\n    live();"]) assert.ok(start.includes(after), `a check is missing: ${after.split('\n')[0]}`);
  assert.ok(start.indexOf("{ code: 'NO_PICTURE' });\n    live();") < start.indexOf('recorder.start(2000);'), 'the last check is after recorder.start(): a cancelled start would record');
  assert.ok(/case 'UQA_OFF_START':\s*return startRecording\(msg\);/.test(OFF), 'the offscreen start waits before claiming again');
});

await test('a stop whose encoder never answers is bounded and files what reached the disk (B: 270 s hang)', async () => {
  const off = liftStop({ hang: true });
  off.set(recorder('m6', { stop: () => new Promise(() => {}) }));
  const meta = await off.stop({});
  assert.equal(meta.id, 'm6');
  assert.equal(meta.outcome.ok, false);
});

await test('SW restart during starting: a fresh worker\'s Stop still cancels in the document (no worker state needed)', async () => {
  const off = liftStop();
  const [claim, begin] = starting('m7');
  off.set(claim);
  const stopping = off.stop({});
  claim.error = CANCEL(); off.set(null); begin();
  await assert.rejects(stopping, (e) => e.code === 'REC_CANCELLED');
});

await test('the worker: a Stop with a start in flight cancels it, waits, answers REC_CANCELLED in EN and AR; starting is not "recording"', () => {
  const H = fs.readFileSync(path.join(HERE, '..', 'background', 'handlers-session.js'), 'utf8');
  const stop = H.slice(H.indexOf('UQA_RECORD_STOP: async'));
  assert.ok(stop.indexOf('await cancelStart();') < stop.indexOf('const meta = await stopRecording(msg);'), 'the Stop reaches the document before the pending start is cancelled');
  assert.ok(stop.includes("code: 'REC_CANCELLED'"));
  assert.ok(H.includes('const gate = (startGate = run.then(() => true, () => false));'), 'the start is not tracked from its first line');
  assert.ok(H.includes('if (!state?.recording && !state?.starting) return;'), 'a start during another start is let through after a worker restart');
  assert.ok(OFF.includes("recording: active.kind !== 'starting'"), 'the UI is told "recording" before it is');
  assert.ok(/case 'UQA_OFF_CANCEL':\s*if \(msg\.clear\) cancelNext = false;\s*else if \(!active\) cancelNext = true;\s*else if \(active\.kind === 'starting'\) active\.cancel = true;/.test(OFF));
  const SW = fs.readFileSync(path.join(HERE, '..', 'background', 'service-worker.js'), 'utf8');
  assert.ok(SW.includes('if (state.recording || state.starting) {'), 'the shortcut starts a second clip while one is starting');
  for (const lang of ['en', 'ar']) assert.ok(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'platform', 'i18n', `${lang}.json`), 'utf8'))['popup.refusal.recCancelled'], lang);
  assert.ok(fs.readFileSync(path.join(HERE, '..', 'popup', 'popup.js'), 'utf8').includes("REC_CANCELLED: { key: 'popup.refusal.recCancelled'"));
  assert.ok(OFF.includes(".replace(/\\.$/, '')}. ` +"), 'the store refusal doubles its full stop again');
});

await test('the start locks on the frame it has when Stop is asked (by: stop), so the encoder starts at once', async () => {
  let asked = false;
  const make = new Function('document', 'setInterval', 'clearInterval', 'lockFrame', 'fitRect', 'drawPointer', 'Date',
    `${lift(OFF, 'composite')}\nreturn composite;`);
  let tick = null;
  const canvas = { width: 300, height: 150, getContext: () => ({ fillRect() {}, drawImage() {} }), captureStream: () => ({ getTracks: () => [], getVideoTracks: () => [{ requestFrame() {} }] }) };
  const composite = make({ createElement: () => canvas }, (fn) => { tick = fn; return 1; }, () => {}, lockFrame, fitRect, () => {}, { now: () => 5 });
  const feed = { videoWidth: 1200, videoHeight: 700 };
  const mixer = composite({ feed, fps: 15, hint: [{ w: 1920, h: 1120 }], urgent: () => asked });
  tick(); tick();
  assert.equal(canvas.width, 300, 'a stale size locked without a Stop');
  asked = true;
  tick();
  const lock = await mixer.ready;
  assert.equal(lock.by, 'stop');
  assert.deepEqual([canvas.width, canvas.height], [1200, 700]);
  mixer.stop();
  const start = OFF.slice(OFF.indexOf('async function startRecording'));
  assert.ok(start.includes('urgent: () => claim.cancel'), 'the start does not hand the compositor the Stop');
  assert.ok(/\} finally \{\s*begun\(\);\s*\}/.test(start), 'the claim\'s `begun` is not settled on every exit of the start');
});

await test('frames are requested one per draw and never closer than 0.9 of a tick (the duplicate-dts note)', async () => {
  const make = new Function('document', 'setInterval', 'clearInterval', 'lockFrame', 'fitRect', 'drawPointer', 'Date',
    `${lift(OFF, 'composite')}\nreturn composite;`);
  let tick = null;
  let clock = 0;
  const asked = [];
  let rate = null;
  const canvas = { width: 300, height: 150, getContext: () => ({ fillRect() {}, drawImage() {} }),
    captureStream: (r) => { rate = r; return { getTracks: () => [], getVideoTracks: () => [{ requestFrame: () => asked.push(clock) }] }; } };
  const composite = make({ createElement: () => canvas }, (fn) => { tick = fn; return 1; }, () => {}, lockFrame, fitRect, () => {}, { now: () => clock });
  const mixer = composite({ feed: { videoWidth: 1920, videoHeight: 1120 }, fps: 15, hint: [{ w: 1920, h: 1120 }] });
  for (const at of [0, 67, 134, 170, 201, 268, 290, 335]) { clock = at; tick(); } // two late ticks bunch up
  mixer.stop();
  assert.equal(rate, 0, 'the canvas is captured on Chrome\'s own clock again (captureStream(fps))');
  assert.deepEqual(asked, [0, 67, 134, 201, 268, 335]);
});

await test("the 'cam-mp4-error' seam fails the webcam the way Chrome does: error, then the recorder stops", async () => {
  const timers = [];
  const made = [];
  class FakeRecorder {
    constructor(_s, o) { this.mimeType = o.mimeType; this.state = 'inactive'; this.l = {}; made.push(this); }
    start() { this.state = 'recording'; }
    stop() { if (this.state === 'inactive') throw new Error('InvalidState'); this.state = 'inactive'; this.ondataavailable?.({ data: { size: 9 } }); this.onstop?.(); }
    dispatchEvent(e) { if (e.type === 'error') this.onerror?.(e); }
  }
  const make = new Function('pickMime', 'extForMime', 'partWriter', 'putMediaPart', 'putMediaPending', 'warnDisk', 'MediaRecorder', 'MediaStream', 'setTimeout', 'Event',
    `${lift(OFF, 'startCamRecorder')}\nreturn startCamRecorder;`);
  const start = make((f) => (f === 'mp4' ? 'video/mp4' : 'video/webm'), () => 'mp4', () => ({ add() {}, chain: Promise.resolve(), chunks: [] }), () => {}, async () => {}, () => {},
    FakeRecorder, class {}, (fn) => timers.push(fn), class { constructor(t) { this.type = t; } });
  globalThis.__qawFault = 'cam-mp4-error';
  try {
    const cam = start({ id: 'm', sessionId: 's', camStream: { getVideoTracks: () => [{}] }, quality: 'medium', startedAt: 1 });
    timers.forEach((fn) => fn());
    assert.equal(made[0].state, 'inactive', 'the seam leaves the recorder running, so the face is saved whole and nothing failed');
    assert.ok(cam.failed, 'the webcam is not marked failed');
    assert.ok(cam.stoppedAt, 'the webcam stop time is not stamped at the failure');
    assert.deepEqual(await cam.stop(), { ok: false, error: cam.failed }, 'a Stop after the failure throws or reports success');
  } finally { delete globalThis.__qawFault; }
  // The parent records the problem and the popup says it in both languages.
  assert.ok(OFF.includes('if (cam.failed) webcamProblem ||= cam.failed;'));
  assert.ok(OFF.includes('...(cam.failed ? { failed: cam.failed } : {}), blob: camTail.size'), 'the companion record does not say its camera failed');
  const read = (p) => fs.readFileSync(path.join(HERE, '..', p), 'utf8');
  assert.ok(read('popup/tool-actions.js').includes("out.result.webcamProblem ? 'popup.record.savedCamShort'"), 'the popup does not say the webcam stopped early');
  for (const lang of ['en', 'ar']) assert.ok(JSON.parse(read(`platform/i18n/${lang}.json`))['popup.record.savedCamShort'], `${lang}: savedCamShort missing`);
});

await test('the webcam keeps what it wrote: requestData before every stop, on Stop and on an encoder error; 0 bytes is WEBCAM_NOT_SAVED', async () => {
  const calls = [];
  const parts = [];
  const made = [];
  class FakeRecorder {
    constructor(_s, o) { this.mimeType = o.mimeType; this.state = 'inactive'; made.push(this); }
    start() { this.state = 'recording'; }
    // Chrome's MP4 recorder [V, live probe 3.8.3]: stopped before its first 2 s chunk it writes 0 bytes unless asked.
    requestData() { calls.push('requestData'); this.asked = true; }
    stop() { calls.push('stop'); this.state = 'inactive'; this.ondataavailable?.({ data: { size: this.asked ? 45790 : 0 } }); this.onstop?.(); }
    dispatchEvent(e) { if (e.type === 'error') this.onerror?.(e); }
  }
  const make = new Function('pickMime', 'extForMime', 'partWriter', 'putMediaPart', 'putMediaPending', 'warnDisk', 'MediaRecorder', 'MediaStream', 'setTimeout', 'Event',
    `${lift(OFF, 'startCamRecorder')}\nreturn startCamRecorder;`);
  const timers = [];
  const start = make(() => 'video/mp4', () => 'mp4', () => ({ add(b) { parts.push(b.size); }, chain: Promise.resolve(), chunks: [] }), () => {}, async () => {}, () => {},
    FakeRecorder, class {}, (fn) => timers.push(fn), class { constructor(t) { this.type = t; } });
  const cam = start({ id: 'm', sessionId: 's', camStream: { getVideoTracks: () => [{}] }, quality: 'medium', startedAt: 1 });
  assert.deepEqual(await cam.stop(), { ok: true });
  assert.deepEqual(calls, ['requestData', 'stop'], 'Stop does not ask for the held frames first');
  assert.deepEqual(parts, [45790], 'a camera stopped before its first chunk lost its frames');
  calls.length = 0; parts.length = 0;
  // Once a chunk exists, requestData on Chrome's MP4 recorder cut a 5 s face to 1.6 s [V, live]: a plain stop() then.
  const mid = start({ id: 'k', sessionId: 's', camStream: { getVideoTracks: () => [{}] }, quality: 'medium', startedAt: 1 });
  made.at(-1).ondataavailable({ data: { size: 758 } });
  await mid.stop();
  assert.deepEqual(calls, ['stop'], 'requestData after the first chunk truncates the MP4 face');
  calls.length = 0; parts.length = 0;
  globalThis.__qawFault = 'cam-mp4-error';
  try {
    const failing = start({ id: 'n', sessionId: 's', camStream: { getVideoTracks: () => [{}] }, quality: 'medium', startedAt: 1 });
    timers.forEach((fn) => fn());
    assert.deepEqual(calls, ['requestData', 'stop'], 'an encoder error does not ask for the held frames before the recorder stops');
    assert.deepEqual(parts, [45790]);
    assert.deepEqual(await failing.stop(), { ok: false, error: failing.failed });
  } finally { delete globalThis.__qawFault; }
  // 0 bytes: no companion, a coded warning on the stop result, and the popup says it in EN and AR.
  assert.ok(OFF.includes("webcamCode: webcamTrackId ? 'WEBCAM_SHORT' : 'WEBCAM_NOT_SAVED'"), 'the stop result carries no coded webcam warning');
  const read = (p) => fs.readFileSync(path.join(HERE, '..', p), 'utf8');
  assert.ok(read('popup/tool-actions.js').includes("out.result.webcamCode === 'WEBCAM_NOT_SAVED' ? 'popup.record.savedCamLost'"), 'the popup does not say the webcam was not saved');
  for (const lang of ['en', 'ar']) {
    const cat = JSON.parse(read(`platform/i18n/${lang}.json`));
    assert.ok(cat['popup.record.savedCamLost']?.includes('{mb}'), `${lang}: savedCamLost missing`);
    assert.notEqual(cat['popup.record.savedCamLost'], cat['popup.record.savedCamShort']);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
