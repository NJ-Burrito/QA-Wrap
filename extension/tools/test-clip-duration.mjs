/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-036 Accept, measured in a real browser: a clip the recorder stored (MediaRecorder webm, which reports
 * video.duration === Infinity until it is seeked) loads in a <video>, and the editor's own clipDurationMs
 * (lifted from videoedit/videoedit.js) turns it into a finite, positive length from the stored milliseconds.
 *
 *   node tools/test-clip-duration.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(EXT, 'videoedit/videoedit.js'), 'utf8');
const a = src.indexOf('function clipDurationMs(');
assert.ok(a >= 0, 'videoedit.js defines clipDurationMs');
const fnSrc = src.slice(a, src.indexOf('\n}\n', a) + 3);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const r = await page.evaluate(async (code) => {
    const clipDurationMs = new Function(`${code}; return clipDurationMs;`)();
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 48;
    const ctx = canvas.getContext('2d');
    const rec = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const t0 = performance.now();
    const done = new Promise((res) => { rec.onstop = res; });
    rec.start();
    for (let i = 0; i < 20; i++) { ctx.fillStyle = `hsl(${i * 18},80%,50%)`; ctx.fillRect(0, 0, 64, 48); await new Promise((q) => setTimeout(q, 60)); }
    rec.stop();
    await done;
    const storedMs = Math.round(performance.now() - t0);
    const video = document.createElement('video');
    video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    await new Promise((res, rej) => { video.addEventListener('loadedmetadata', res, { once: true }); video.addEventListener('error', () => rej(new Error('clip did not load')), { once: true }); });
    return { blobBytes: chunks.reduce((n, c) => n + c.size, 0), videoDuration: video.duration, storedMs, ms: clipDurationMs(video.duration, storedMs), msNoStore: clipDurationMs(video.duration, undefined) };
  }, fnSrc);
  assert.ok(r.blobBytes > 500, `a real clip was recorded (${r.blobBytes} bytes)`); // R15: the browser really produced a webm
  assert.ok(Number.isFinite(r.ms) && r.ms > 0, `the editor's duration is finite and positive: ${r.ms}`);
  assert.ok(Math.abs(r.ms - (Number.isFinite(r.videoDuration) ? r.videoDuration * 1000 : r.storedMs)) < 2, 'it is the video length when finite, else the stored length');
  if (!Number.isFinite(r.videoDuration)) assert.equal(r.msNoStore, 0, 'with a non-finite video length and no stored length the editor opens at 0, which the stored length exists to prevent');
  console.log(`  ok  clip duration: video.duration=${r.videoDuration}, stored=${r.storedMs} ms, editor=${r.ms} ms`);
} finally {
  await browser.close();
}
