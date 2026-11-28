/* QA Wrap — offscreen document: image transcode, tile stitching and saving (split from offscreen.js). */
import { putMedia, getMedia } from '../core/db.js';
import { IMAGE_TYPES, byId } from '../core/file-types.js';
import { stampPng } from '../core/provenance-stamp.js';
import { sha256Hex } from '../core/integrity.js';
import { withHash } from './offscreen-base.js';

/* ── stills ────────────────────────────────────────────────────────────── */

/**
 * Chrome's captureVisibleTab only ever returns PNG or JPEG. Anything else — and
 * a JPEG at a chosen quality rather than Chrome's default — has to be re-encoded
 * through a canvas, which is why this lives here rather than in the worker.
 */
async function transcodeImage({ dataUrl, format, quality }) {
  const target = byId(IMAGE_TYPES, format === 'jpg' ? 'jpeg' : format)?.mime || 'image/png';

  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  // Its own canvas. `#scratch` was shared with the GIF capture, which writes on
  // a timer: a screenshot taken during a GIF recording resized the element
  // between that timer's `drawImage` and its `getImageData`, so one path got a
  // torn frame and the other got a picture of the wrong size.
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  // JPEG has no alpha; without a ground, transparent regions come out black.
  if (target === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const lossless = target === 'image/png' || target === 'image/bmp';
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, target, lossless ? undefined : (quality ?? 92) / 100)
  );
  if (!blob) throw new Error(`This browser cannot encode ${format}.`);

  // Confirm the browser produced what was asked for. canvas.toBlob silently
  // falls back to PNG for a type it does not support, which would otherwise
  // ship a .webp file that is really a PNG.
  if (blob.type !== target) {
    throw new Error(`Asked for ${target}, got ${blob.type}. This browser cannot encode ${format}.`);
  }
  return blob;
}

/**
 * Draw the tiles of a full-page capture onto one image.
 *
 * The two things that make this correct rather than merely working:
 *
 * **Tiles are placed at their real scroll offset**, which the worker measured
 * from the page rather than assuming. The last tile is always clamped — the
 * document will not scroll past its own end — so placing it at `index × height`
 * repeats a strip of the page, and the repeat lands exactly where the footer
 * is, which is where anyone checking the screenshot looks first.
 *
 * **The canvas is in device pixels.** The worker reports CSS pixels because
 * that is what the page thinks in, but `captureVisibleTab` returns the physical
 * bitmap — on a 2× display that is twice the size. Building the canvas from the
 * CSS numbers throws away half the resolution of every screenshot taken on a
 * laptop, which is most of them.
 */
async function stitchTiles({ tiles, width, height, dpr, format, quality, sessionId, label, url, session, version }) {
  if (!tiles?.length) throw new Error('Nothing was captured.');

  /*
   * An `OffscreenCanvas` of its own, not the shared `#scratch` element.
   *
   * Two reasons, and the second is why it is this class and not another
   * `<canvas>`. A full-page stitch is the largest bitmap this document ever
   * builds — a tall page on a 2x display is easily 2000x20000 device pixels —
   * and holding it in an element in the DOM keeps it resident for the life of
   * the document. `convertToBlob` also settles the type honestly, where
   * `toBlob` on an element hands back a PNG for a type it cannot encode with no
   * error at all, which is how a `.webp` that was really a PNG used to ship.
   */
  const canvas = new OffscreenCanvas(Math.round(width * dpr), Math.round(height * dpr));
  const ctx = canvas.getContext('2d');

  const target = byId(IMAGE_TYPES, format === 'jpg' ? 'jpeg' : format)?.mime || 'image/png';
  if (target === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  for (const tile of tiles) {
    const bitmap = await createImageBitmap(await (await fetch(tile.dataUrl)).blob());
    ctx.drawImage(bitmap, 0, Math.round(tile.y * dpr));
    bitmap.close();
  }

  const lossless = target === 'image/png' || target === 'image/bmp';
  const blob = await canvas
    .convertToBlob({ type: target, ...(lossless ? {} : { quality: (quality ?? 92) / 100 }) })
    .catch(() => null);
  if (!blob) throw new Error(`This browser cannot encode ${format}.`);
  if (blob.type !== target) {
    throw new Error(`Asked for ${target}, got ${blob.type}. This browser cannot encode ${format}.`);
  }

  // Free it now rather than leaving a full-page bitmap resident in a document
  // that Chrome keeps alive for the next recording. (The 1x1 trick that used to
  // stand here existed because the canvas was a shared element; this one is a
  // local, so shrinking it is all that is needed before it is collected.)
  canvas.width = 1;
  canvas.height = 1;

  // The stitched page carries the same invisible mark as a single frame.
  const marked = blob.type === 'image/png'
    ? await stampPng(blob, { session, version, kind: 'screenshot', label: label || 'Full page' })
    : blob;

  const record = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    kind: 'screenshot',
    label: label || 'Full page',
    blob: marked,
    type: marked.type,
    bytes: marked.size,
    url,
    ts: Date.now(),
    fullPage: true,
    tiles: tiles.length,
    provenance: marked !== blob,
  };
  record.sha256 = await sha256Hex(record.blob);
  await putMedia(record);
  const { blob: _omit, ...meta } = record;
  return meta;
}




/**
 * Provenance goes into the file, never onto the picture.
 *
 * This replaces a function that painted a plate of text into the corner of every
 * screenshot. That was the wrong instinct twice over: it was ugly, and a QA tool
 * exists to record what a screen showed — drawing on that record is the same
 * contamination the shadow-root work removed from the other direction.
 *
 * PNG `tEXt` chunks carry it instead. Invisible, standard, read by ImageMagick,
 * ExifTool, Pillow and any model with an image-metadata step, and they survive
 * the file being copied, emailed and attached to a ticket. Not one pixel moves.
 */
async function markImage({ id, session, version, label }) {
  const original = await getMedia(id);
  if (!original) throw new Error('That image is no longer stored.');
  if (original.type !== 'image/png') {
    // Only PNG has a text chunk. Saying so beats silently doing nothing, and
    // beats re-encoding somebody's JPEG evidence to add a comment to it.
    throw new Error('Only PNG evidence carries embedded provenance. This image is ' + original.type + '.');
  }

  const blob = await stampPng(original.blob, { session, version, kind: 'screenshot', label: label || original.label });

  // Replaces in place: no pixel changed, so there is no unmarked original to
  // preserve. That is the difference from the version this replaces.
  await putMedia(await withHash({ ...original, blob, bytes: blob.size, provenance: true }));
  return { id: original.id, bytes: blob.size, embedded: true };
}

async function saveImage({ dataUrl, format, quality, sessionId, label, url, session, version }) {
  const raw = await transcodeImage({ dataUrl, format, quality });
  /*
   * Marked on the way in, not as a separate action.
   *
   * It costs nothing — a few hundred bytes of `tEXt` and no re-encode — and it
   * is invisible, so there is no reason to make somebody ask for it. Every
   * screenshot therefore carries its origin from the moment it exists, which is
   * the only version of this that actually protects anything: a mark you have
   * to remember to apply is a mark that is missing from the file that mattered.
   */
  const blob = raw.type === 'image/png'
    ? await stampPng(raw, { session, version, kind: 'screenshot', label })
    : raw;
  const record = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    kind: 'screenshot',
    label: label || 'Screenshot',
    blob,
    type: blob.type,
    bytes: blob.size,
    url,
    ts: Date.now(),
    provenance: blob !== raw,
  };
  record.sha256 = await sha256Hex(record.blob);
  await putMedia(record);
  const { blob: _omit, ...meta } = record;
  return meta;
}

export { markImage, saveImage, stitchTiles };
