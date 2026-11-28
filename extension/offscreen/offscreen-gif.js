/* QA Wrap — offscreen document: GIF capture (split from offscreen.js). */
import { encodeGifAsync, buildPalette } from '../core/gif.js';

/**
 * GIF has no encoder in the browser, so frames are grabbed by hand.
 *
 * **Quantised at grab time, and bounded by bytes.** Holding raw RGBA meant a
 * 900-frame cap at 1280x720 retained about 1.3 GB before a single byte was
 * encoded, on the one thread this document has — the tab froze, then the whole
 * encode ran synchronously and the worker's handler deadline expired while it
 * was still working. A palette is seeded from the first few frames and every
 * frame after that is stored as one byte per pixel instead of four, the total
 * retained is capped in bytes rather than in frames (a frame at 'high' quality
 * is not the same size as one at 'low'), and the encode itself hands the thread
 * back every few frames.
 *
 * Geometry is locked at the first grab. A tab resized mid-capture used to
 * change the canvas under a single global palette and a single logical screen
 * size, which decodes as garbage from the resize onwards.
 *
 * **The webcam is still composited inline here, and that is not an oversight.**
 * The picture path stopped burning it in (see `composite`) because a video clip
 * can carry a second track that the editor moves afterwards. A GIF cannot: it
 * is one indexed image stream, one palette, one frame after another, with no
 * layer to put anything on and no container to put a second stream in. So for a
 * GIF the choice is the inset painted where the tester put it, or no face at
 * all — and `paint()` below paints it.
 */
const GIF_MAX_BYTES = 192 * 1024 * 1024;
const GIF_SEED_FRAMES = 4;
const GIF_MAX_WIDTH = 800;

function startGifCapture({ id, sessionId, stream, feed, cam, fps, startedAt, webcamPosition = 'bottom-right', webcamSize = 22 }) {
  // Its own canvas, not the shared `#scratch`. This is the only writer that
  // runs on a timer, so it is the one that could be halfway through a frame
  // when a transcode or a full-page stitch resized the same element underneath
  // it — which decodes as a torn frame, or throws.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const frames = [];
  const seeds = [];
  const interval = Math.round(1000 / fps);

  let palette = null;
  let map = null;
  let bytes = 0;
  let width = 0;
  let height = 0;
  let lastGrab = 0;
  let timer = null;
  let full = false;

  const paint = () => {
    ctx.drawImage(feed, 0, 0, width, height);
    if (cam && cam.videoWidth) {
      const side = Math.round((height * webcamSize) / 100);
      const margin = Math.round(side * 0.18);
      const x = webcamPosition.includes('left') ? margin : width - side - margin;
      const y = webcamPosition.includes('top') ? margin : height - side - margin;
      const crop = Math.min(cam.videoWidth, cam.videoHeight);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + side / 2, y + side / 2, side / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(cam, (cam.videoWidth - crop) / 2, (cam.videoHeight - crop) / 2, crop, crop, x, y, side, side);
      ctx.restore();
    }
  };

  const seal = () => {
    // Seed the palette from the first few frames rather than from one: the
    // opening frame of a capture is often a blank page, and a palette built
    // from it has nothing to say about the colours that follow.
    ({ palette, map } = buildPalette(seeds, 256));
    for (const seed of seeds) {
      const indices = new Uint8Array(seed.data.length / 4);
      for (let i = 0, j = 0; i < seed.data.length; i += 4, j++) {
        indices[j] = map(seed.data[i], seed.data[i + 1], seed.data[i + 2]);
      }
      frames.push({ indices, width: seed.width, height: seed.height, delayMs: seed.delayMs });
      bytes += indices.length;
    }
    seeds.length = 0;
  };

  const stopCapturing = () => {
    if (timer == null) return;
    clearInterval(timer);
    timer = null;
  };

  const grab = () => {
    if (full || !feed.videoWidth) return;

    if (!width) {
      // Locked once, at the first frame that has a size.
      const scale = Math.min(1, GIF_MAX_WIDTH / feed.videoWidth);
      width = Math.max(2, Math.round(feed.videoWidth * scale));
      height = Math.max(2, Math.round(feed.videoHeight * scale));
      canvas.width = width;
      canvas.height = height;
    }

    const now = Date.now();
    // The real gap, not the nominal one. A timer that slips — and one on a
    // never-rendered document slips constantly — produced a GIF whose stated
    // delays did not match the moments the frames were taken, so playback ran
    // at a speed nobody chose.
    const delayMs = lastGrab ? Math.min(2000, now - lastGrab) : interval;
    lastGrab = now;

    paint();
    const rgba = ctx.getImageData(0, 0, width, height).data;

    if (!palette) {
      seeds.push({ data: rgba, width, height, delayMs });
      if (seeds.length >= GIF_SEED_FRAMES) seal();
      return;
    }

    const indices = new Uint8Array(rgba.length / 4);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) indices[j] = map(rgba[i], rgba[i + 1], rgba[i + 2]);
    frames.push({ indices, width, height, delayMs });
    bytes += indices.length;

    if (bytes >= GIF_MAX_BYTES) {
      // The cap is reached, so stop capturing AND say so. It used to stop
      // silently while every surface went on counting the seconds up, so the
      // tester believed they were recording a minute they were not.
      full = true;
      stopCapturing();
      chrome.runtime.sendMessage({ type: 'UQA_SOURCE_ENDED', id, reason: 'gif-full' }).catch(() => {});
    }
  };

  timer = setInterval(grab, interval);

  return {
    kind: 'gif',
    id,
    sessionId,
    stream,
    startedAt,
    mime: 'image/gif',
    frameCount: () => frames.length + seeds.length,
    gifStop: stopCapturing,
    settled: () => Promise.resolve({ ok: true }),
    tailChunks: () => [],
    flushed: () => Promise.resolve(),
    partsProblem: () => null,
    stop: async () => {
      stopCapturing();
      if (seeds.length && !palette) seal();
      if (!frames.length) throw new Error('Nothing was captured. The tab produced no frames.');
      // Chunked, so this document can still answer a message while it encodes.
      const out = await encodeGifAsync(frames, { loop: 0, palette });
      return new Blob([out], { type: 'image/gif' });
    },
  };
}

export { startGifCapture };
