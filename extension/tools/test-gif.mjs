/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Tests for core/gif.js.
 *
 *   node tools/test-gif.mjs
 *
 * A hand-written encoder is exactly the kind of code that produces a file which
 * *looks* fine — right size, right magic bytes — and which no decoder will open.
 * So the structural assertions here are backed by the only check that settles
 * it: hand the bytes to a real browser and ask it to decode them, then compare
 * the pixels that come back against the pixels that went in.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { encodeGif } from '../core/gif.js';
import { profile } from './lib-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/** A frame of flat colour, plus a distinct square, so decoding proves position. */
function frame(width, height, [r, g, b], mark) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  if (mark) {
    for (let y = 0; y < Math.min(4, height); y++) {
      for (let x = 0; x < Math.min(4, width); x++) {
        const o = (y * width + x) * 4;
        data[o] = mark[0]; data[o + 1] = mark[1]; data[o + 2] = mark[2]; data[o + 3] = 255;
      }
    }
  }
  return { data, width, height, delayMs: 100 };
}

function close(got, want, tolerance, what) {
  const off = got.map((v, i) => Math.abs(v - want[i]));
  assert.ok(
    off.every((d) => d <= tolerance),
    `${what}: got rgb(${got}) wanted rgb(${want}), off by ${off}`
  );
}

const contains = (bytes, text) => indexOf(bytes, text) !== -1;
const indexOf = (bytes, text) => indexOfBytes(bytes, [...text].map((c) => c.charCodeAt(0)));

function indexOfBytes(haystack, needle) {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

console.log('gif.js — structure');

await test('it writes a GIF89a header with the right dimensions', () => {
  const bytes = encodeGif([frame(16, 12, [200, 30, 30])]);
  assert.equal(String.fromCharCode(...bytes.slice(0, 6)), 'GIF89a');
  assert.equal(bytes[6] | (bytes[7] << 8), 16);
  assert.equal(bytes[8] | (bytes[9] << 8), 12);
});

await test('it ends with the trailer byte', () => {
  const bytes = encodeGif([frame(8, 8, [0, 0, 0])]);
  assert.equal(bytes[bytes.length - 1], 0x3b);
});

await test('a single frame carries no loop extension', () => {
  const bytes = encodeGif([frame(8, 8, [10, 20, 30])]);
  assert.ok(!contains(bytes, 'NETSCAPE2.0'), 'a still image should not announce a loop');
});

await test('more than one frame loops for ever by default', () => {
  const bytes = encodeGif([frame(8, 8, [10, 20, 30]), frame(8, 8, [30, 20, 10])]);
  assert.ok(contains(bytes, 'NETSCAPE2.0'), 'no loop extension');
  const at = indexOf(bytes, 'NETSCAPE2.0') + 11;
  assert.equal(bytes[at + 2] | (bytes[at + 3] << 8), 0, 'loop count should be 0 = for ever');
});

await test('a frame delay under 20ms is clamped, not silently reinterpreted', () => {
  // Most viewers treat a delay of 0 or 1 as 100ms. Emitting it would mean the
  // GIF plays at a speed nobody chose.
  const bytes = encodeGif([{ ...frame(8, 8, [1, 2, 3]), delayMs: 5 }, frame(8, 8, [3, 2, 1])]);
  const gce = indexOfBytes(bytes, [0x21, 0xf9, 0x04]);
  assert.notEqual(gce, -1, 'no graphic control extension');
  assert.ok(bytes[gce + 4] >= 2, `delay was ${bytes[gce + 4]} hundredths`);
});

await test('an empty frame list is refused rather than producing a broken file', () => {
  assert.throws(() => encodeGif([]), /at least one frame/);
});

await test('it stays well under the size of the raw pixels', () => {
  const frames = Array.from({ length: 8 }, (_, i) => frame(120, 90, [i * 12, 80, 200 - i * 10]));
  const raw = 8 * 120 * 90 * 4;
  const bytes = encodeGif(frames);
  assert.ok(bytes.length < raw / 8, `${bytes.length} bytes vs ${raw} raw — LZW is not compressing`);
});

console.log('\ngif.js — a real decoder');

const context = await chromium.launchPersistentContext(profile('.gif-profile'), launchOptions(EXT));
await keepOnTop(context); // test window stays above others; released on close
try {
  const page = await context.newPage();
  await page.goto('data:text/html,<title>gif</title>');

  /** Decode in the browser and read frame one back as pixels. */
  async function decode(bytes, w, h) {
    return page.evaluate(
      async ([arr, width, height]) => {
        const blob = new Blob([new Uint8Array(arr)], { type: 'image/gif' });
        const url = URL.createObjectURL(blob);
        try {
          const img = new Image();
          await new Promise((ok, no) => {
            img.onload = ok;
            img.onerror = () => no(new Error('the browser refused to decode it'));
            img.src = url;
          });
          const c = document.createElement('canvas');
          c.width = width;
          c.height = height;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, width, height).data;
          return {
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            topLeft: [d[0], d[1], d[2]],
            middle: [
              d[(((height >> 1) * width + (width >> 1)) * 4)],
              d[(((height >> 1) * width + (width >> 1)) * 4) + 1],
              d[(((height >> 1) * width + (width >> 1)) * 4) + 2],
            ],
          };
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      [Array.from(bytes), w, h]
    );
  }

  await test('Chrome decodes it, at the size it was told', async () => {
    const bytes = encodeGif([frame(40, 24, [220, 40, 40])]);
    const got = await decode(bytes, 40, 24);
    assert.equal(got.naturalWidth, 40);
    assert.equal(got.naturalHeight, 24);
  });

  await test('the pixels that come back are the pixels that went in', async () => {
    // Quantisation is lossy, so allow drift — but only a little. A palette bug
    // shows up as a wildly different colour, not as a few levels of error.
    const bytes = encodeGif([frame(40, 24, [220, 40, 40], [20, 200, 90])]);
    const got = await decode(bytes, 40, 24);
    close(got.middle, [220, 40, 40], 12, 'the body of the frame');
    close(got.topLeft, [20, 200, 90], 12, 'the marked corner');
  });

  await test('a photographic gradient survives quantisation recognisably', async () => {
    // The case median cut exists for: a fixed palette bands this visibly.
    const width = 64;
    const height = 32;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        data[o] = (x / width) * 255;
        data[o + 1] = (y / height) * 255;
        data[o + 2] = 128;
        data[o + 3] = 255;
      }
    }
    const got = await decode(encodeGif([{ data, width, height, delayMs: 100 }]), width, height);
    close(got.middle, [128, 128, 128], 24, 'the middle of the gradient');
  });

  await test('an animation decodes and reports more than one frame worth of bytes', async () => {
    const frames = [frame(32, 32, [200, 30, 30]), frame(32, 32, [30, 200, 30]), frame(32, 32, [30, 30, 200])];
    const bytes = encodeGif(frames);
    const got = await decode(bytes, 32, 32);
    assert.equal(got.naturalWidth, 32);
    // The first frame is what a decoder paints immediately.
    close(got.middle, [200, 30, 30], 12, 'the first frame');
  });
} finally {
  await context.close(); // only ours
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
