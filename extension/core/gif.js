/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * An animated GIF encoder, in about 200 lines and with no dependencies.
 *
 * Why write one at all: Chrome encodes MP4 and WebM natively through
 * MediaRecorder, and PNG, JPEG and WebP through canvas — but it has never been
 * able to *write* a GIF. `canvas.toDataURL('image/gif')` silently hands back a
 * PNG. So a GIF option that is honest has to build the file itself.
 *
 * Why bother, when MP4 is smaller and sharper: a GIF plays inline in Jira, in a
 * GitHub comment, in Slack, and in every ticket system that will not embed a
 * video. For a five-second "here is the bug happening" clip, that is the whole
 * point.
 *
 * The format, briefly: GIF is palette-based, so the truecolour frames have to be
 * quantised to 256 colours first, and then the index stream is compressed with
 * LZW. Both halves are here.
 */

/* ── colour quantisation: median cut ───────────────────────────────────────
   Median cut splits the colour cube along whichever axis a box is widest on,
   repeatedly, until there are as many boxes as palette slots. It handles the
   screenshots this is used for — large flat areas of UI chrome plus a few
   photographic regions — better than a fixed web palette, which visibly bands
   any gradient, and it is far cheaper than neural quantisation. */

function medianCut(pixels, maxColors) {
  // One box holding every distinct colour, counted. Working on distinct colours
  // rather than every pixel is what makes this fast on a 1280×800 frame: a UI
  // screenshot usually has a few thousand distinct colours, not a million.
  const counts = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    // 5 bits per channel: 32³ buckets. Finer than the eye needs at GIF depth,
    // and it collapses antialiasing noise that would otherwise eat the palette.
    const key = ((pixels[i] >> 3) << 10) | ((pixels[i + 1] >> 3) << 5) | (pixels[i + 2] >> 3);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const colors = [];
  for (const [key, n] of counts) {
    colors.push({
      r: ((key >> 10) & 31) << 3,
      g: ((key >> 5) & 31) << 3,
      b: (key & 31) << 3,
      n,
    });
  }
  if (colors.length <= maxColors) return colors.map(({ r, g, b }) => [r, g, b]);

  let boxes = [colors];
  while (boxes.length < maxColors) {
    // Split the box with the widest spread, not simply the largest: splitting a
    // big box of near-identical greys buys nothing.
    let target = -1;
    let widest = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const range = spread(boxes[i]);
      if (range.width > widest) {
        widest = range.width;
        target = i;
      }
    }
    if (target === -1) break;

    const box = boxes[target];
    const { axis } = spread(box);
    box.sort((a, b) => a[axis] - b[axis]);

    // Split at the weighted median so both halves carry a similar number of
    // *pixels*, which is what actually matters for perceived error.
    const total = box.reduce((sum, c) => sum + c.n, 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i].n;
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(target, 1, box.slice(0, cut), box.slice(cut));
  }

  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const c of box) {
      r += c.r * c.n;
      g += c.g * c.n;
      b += c.b * c.n;
      n += c.n;
    }
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
  });
}

function spread(box) {
  let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
  for (const c of box) {
    if (c.r < rmin) rmin = c.r;
    if (c.r > rmax) rmax = c.r;
    if (c.g < gmin) gmin = c.g;
    if (c.g > gmax) gmax = c.g;
    if (c.b < bmin) bmin = c.b;
    if (c.b > bmax) bmax = c.b;
  }
  const dr = rmax - rmin;
  const dg = gmax - gmin;
  const db = bmax - bmin;
  // Green is weighted because luminance is mostly green; an error there shows.
  const width = Math.max(dr, dg * 1.2, db);
  return { width, axis: width === dr ? 'r' : width === db ? 'b' : 'g' };
}

/** Nearest palette entry, cached — the same colours repeat across a whole frame. */
function makeMapper(palette) {
  const cache = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const dr = r - palette[i][0];
      const dg = g - palette[i][1];
      const db = b - palette[i][2];
      const dist = dr * dr + dg * dg * 1.4 + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    cache.set(key, best);
    return best;
  };
}

/* ── LZW, as GIF specifies it ─────────────────────────────────────────────
   Variable-width codes starting at colour depth + 1, a clear code that resets
   the dictionary when it fills, and the whole stream cut into sub-blocks of at
   most 255 bytes. */

function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  const out = [];
  let bitBuffer = 0;
  let bitCount = 0;

  const emit = (code, width) => {
    bitBuffer |= code << bitCount;
    bitCount += width;
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  let dict = new Map();
  let next = endCode + 1;
  let codeWidth = minCodeSize + 1;
  const resetDict = () => {
    dict = new Map();
    next = endCode + 1;
    codeWidth = minCodeSize + 1;
  };

  emit(clearCode, codeWidth);
  resetDict();

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix, codeWidth);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeWidth && codeWidth < 12) codeWidth++;
    } else {
      emit(clearCode, codeWidth);
      resetDict();
    }
    prefix = k;
  }
  emit(prefix, codeWidth);
  emit(endCode, codeWidth);
  if (bitCount > 0) out.push(bitBuffer & 0xff);

  // Sub-blocks: one length byte, up to 255 bytes of data, terminated by zero.
  const blocked = new Uint8Array(out.length + Math.ceil(out.length / 255) + 2);
  let at = 0;
  blocked[at++] = minCodeSize;
  for (let i = 0; i < out.length; i += 255) {
    const n = Math.min(255, out.length - i);
    blocked[at++] = n;
    for (let j = 0; j < n; j++) blocked[at++] = out[i + j];
  }
  blocked[at++] = 0;
  return blocked.subarray(0, at);
}

/**
 * Build a palette from raw RGBA frames, and the mapper that uses it.
 *
 * Exported because the GIF capture path in the offscreen document needs the
 * palette *before* it has all the frames. Holding 900 frames of RGBA to build
 * one palette at the end is what made a sixty-second GIF retain about 1.3 GB
 * and then die: quantising at grab time costs a palette seeded from the first
 * few frames and retains a quarter of the bytes.
 */
export function buildPalette(sampleFrames, maxColors = 256) {
  const merged = new Uint8ClampedArray(sampleFrames.reduce((n, f) => n + f.data.length, 0));
  let at = 0;
  for (const f of sampleFrames) {
    merged.set(f.data, at);
    at += f.data.length;
  }
  const palette = medianCut(merged, maxColors);
  return { palette, map: makeMapper(palette) };
}

/**
 * The encoder itself, as a generator that yields once per frame.
 *
 * A generator rather than a plain loop because this has to serve two callers
 * with opposite needs. `encodeGif` below drains it in one go, which is what
 * every test and every small still wants. `encodeGifAsync` steps it and hands
 * the thread back every few frames, which is what a sixty-second capture needs:
 * the offscreen document has one thread, and encoding a nine-hundred-frame GIF
 * on it synchronously froze the only context that could answer "have you
 * finished yet" — so the worker's handler deadline expired and the tester was
 * told the recording had failed while it was still being written.
 *
 * `consume` empties the array as it goes (`shift()` per frame), so peak memory
 * is the output buffer plus one frame rather than the whole animation twice.
 * It defaults to false: a caller that passes an array it still owns must get it
 * back intact.
 *
 * A frame may arrive as raw RGBA (`data`) or already quantised (`indices`,
 * with the palette that made them passed in `palette`). The second shape is
 * what the capture path produces.
 */
function* gifEncoder(frames, { loop = 0, maxColors = 256, palette: given = null, consume = false } = {}) {
  if (!frames.length) throw new Error('A GIF needs at least one frame.');
  const { width, height } = frames[0];

  // One palette for the whole animation. Per-frame palettes would be sharper,
  // but they cost a 768-byte table per frame and make the file bigger than the
  // MP4 it was meant to be a lightweight alternative to.
  let palette = given;
  let map = null;
  if (!palette) {
    const sample = frames.length > 8 ? frames.filter((_, i) => i % Math.ceil(frames.length / 8) === 0) : frames;
    ({ palette, map } = buildPalette(sample, maxColors));
  }

  let depth = 1;
  while (1 << depth < palette.length) depth++;
  const tableSize = 1 << depth;

  // A growable byte buffer, not an array with spread appends: `push(...arr)`
  // throws RangeError once the argument list passes ~100k entries, and one
  // 1280x800 frame produces far more than that.
  let bytes = new Uint8Array(1 << 16);
  let len = 0;
  const room = (n) => {
    if (len + n <= bytes.length) return;
    let size = bytes.length;
    while (size < len + n) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(bytes.subarray(0, len));
    bytes = bigger;
  };
  const push = (...b) => {
    room(b.length);
    bytes.set(b, len);
    len += b.length;
  };
  const pushAll = (arr) => {
    room(arr.length);
    bytes.set(arr, len);
    len += arr.length;
  };
  const short = (n) => push(n & 0xff, (n >> 8) & 0xff);
  const ascii = (s) => push(...[...s].map((c) => c.charCodeAt(0)));

  ascii('GIF89a');
  short(width);
  short(height);
  push(0x80 | (depth - 1), 0, 0); // global table, its size, background, aspect
  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] || [0, 0, 0];
    push(c[0], c[1], c[2]);
  }

  // Netscape application extension — the only way to say "loop".
  if (frames.length > 1) {
    push(0x21, 0xff, 11);
    ascii('NETSCAPE2.0');
    push(3, 1);
    short(loop);
    push(0);
  }

  let cursor = 0;
  while (consume ? frames.length : cursor < frames.length) {
    const frame = consume ? frames.shift() : frames[cursor];
    cursor += 1;
    // Delay is in hundredths of a second. Anything under 2 is treated as 10 by
    // most viewers, so clamp rather than emit a value that silently changes.
    const delay = Math.max(2, Math.round((frame.delayMs ?? 100) / 10));
    push(0x21, 0xf9, 4, 0x04, delay & 0xff, (delay >> 8) & 0xff, 0, 0);

    push(0x2c);
    short(0);
    short(0);
    short(frame.width);
    short(frame.height);
    push(0); // no local table, not interlaced

    let indices = frame.indices;
    if (!indices) {
      const px = frame.data;
      indices = new Uint8Array(px.length / 4);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) indices[j] = map(px[i], px[i + 1], px[i + 2]);
    }
    pushAll(lzwEncode(indices, Math.max(2, depth)));
    yield cursor;
  }

  push(0x3b);
  return bytes.slice(0, len);
}

/**
 * Encode frames into a GIF89a.
 *
 * @param frames  [{ data: Uint8ClampedArray RGBA | indices: Uint8Array, width, height, delayMs }]
 * @param loop    0 = forever, which is what a bug repro wants
 */
export function encodeGif(frames, options = {}) {
  const it = gifEncoder(frames, options);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/**
 * The same encoder, with the thread handed back every `every` frames.
 *
 * `await new Promise(setTimeout)` and not a microtask on purpose: a microtask
 * queue is drained before the event loop turns, so `await Promise.resolve()`
 * would have yielded to nothing and the document would still have been frozen
 * for the whole encode. A macrotask is what lets a message be answered.
 */
export async function encodeGifAsync(frames, { every = 6, ...options } = {}) {
  const it = gifEncoder(frames, { ...options, consume: true });
  let done = 0;
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
    if (++done % every === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
