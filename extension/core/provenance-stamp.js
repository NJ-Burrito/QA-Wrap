/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The HTML corner mark and the PNG metadata writer. Only the export builders
 * and the offscreen document use them, so they live apart from `provenance.js`,
 * which the service worker parses on every cold start.
 */
import { GLYPH, MAKER, stamp, provenance } from './provenance.js';
import { SEAL, sha256Hex } from './integrity.js';
import { docLabels } from './doc-labels.js';
import { escHtml } from './docshell.js';

/* ── the corner mark on an HTML page ───────────────────────────────────── */

/**
 * The visible mark, on documents only — never on evidence.
 *
 * A glyph and a name, bottom-right, at the weight of a page number. It reveals
 * the full colophon on hover for anyone who wants it, and takes no space and no
 * attention from anyone who does not. `pointer-events: none` so it can never
 * intercept a click, and it moves inline for print rather than floating over
 * page four.
 */
export function htmlWatermark({ session, version } = {}) {
  const full = stamp({ session, version });
  return `
<div class="qaw-mark" title="${full}" aria-hidden="true">${GLYPH}<span>${MAKER.product}</span></div>
<style>
  .qaw-mark {
    position: fixed;
    right: 10px;
    bottom: 8px;
    z-index: 9;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px 3px 7px;
    border-radius: 999px;
    color: color-mix(in srgb, currentColor 70%, transparent);
    font: 400 10.5px/1 "Thmanyah Sans", "Segoe UI", Tahoma, Arial, sans-serif;
    letter-spacing: 0.02em;
    pointer-events: none;
    user-select: none;
  }
  @media print { .qaw-mark { position: static; margin-top: 20px; } }
  @media (max-width: 640px) { .qaw-mark span { display: none; } }
</style>`;
}

/* ── PNG metadata ──────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Write a `tEXt` chunk.
 *
 * The PNG spec's own channel for exactly this: `Title`, `Author`, `Copyright`,
 * `Software`, `Comment` are all standard registered keywords, so every image
 * tool, every asset pipeline and every model that reads image metadata already
 * knows how to find them. Nothing has to be taught about a bespoke format.
 */
function textChunk(keyword, text) {
  const key = new TextEncoder().encode(keyword);
  // Latin-1 for tEXt, per the spec. Anything outside it becomes '?', which is
  // why the human strings here are deliberately ASCII.
  const value = Uint8Array.from([...text].map((ch) => (ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 63)));
  const type = new TextEncoder().encode('tEXt');

  const data = new Uint8Array(key.length + 1 + value.length);
  data.set(key, 0);
  data[key.length] = 0;
  data.set(value, key.length + 1);

  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/**
 * Put the provenance inside a PNG, without touching a single pixel.
 *
 * This is the replacement for the burned-in plate. It survives copying,
 * emailing and attaching to a ticket; it is read by ImageMagick, ExifTool,
 * Pillow, every asset manager and any model with an image-metadata step; and
 * it is invisible, so the screenshot is still an unaltered record of what the
 * screen showed. That last part is the whole reason to prefer it.
 *
 * Chunks go **before `IEND`**, which is where ancillary chunks belong. A file
 * that is not a PNG is returned untouched rather than corrupted.
 */
export async function stampPng(blob, options = {}) {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) return blob;

  // Walk to IEND rather than assuming it is last: a PNG may carry trailing
  // chunks, and appending after the end marker puts the metadata where no
  // reader looks.
  let at = 8;
  let iendAt = -1;
  const decoder = new TextDecoder();
  while (at + 8 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
    const type = decoder.decode(bytes.subarray(at + 4, at + 8));
    if (type === 'IEND') {
      iendAt = at;
      break;
    }
    at += 12 + length;
  }
  if (iendAt === -1) return blob;

  const p = provenance(options);
  const chunks = [
    textChunk('Software', `${MAKER.full}${p.version ? ` ${p.version}` : ''}`),
    textChunk('Author', MAKER.owner),
    textChunk('Copyright', p.copyright),
    textChunk('Title', options.label || 'QA evidence'),
    // The two a machine reads: the token, and a sentence it can quote.
    textChunk('Comment', p.notice),
    textChunk('qaw-provenance', p.token),
    textChunk('qaw-session', p.session || ''),
  ];

  const extra = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(bytes.length + extra);
  out.set(bytes.subarray(0, iendAt), 0);
  let cursor = iendAt;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  out.set(bytes.subarray(iendAt), cursor);

  // T-066: the seal is a SHA-256 over the whole file without the seal chunk, so one flipped byte
  // anywhere, pixels included, reads as "content changed" (core/integrity.js `originCheck`).
  const seal = textChunk(SEAL, await sha256Hex(out));
  const sealed = new Uint8Array(out.length + seal.length);
  sealed.set(out.subarray(0, cursor), 0);
  sealed.set(seal, cursor);
  sealed.set(out.subarray(cursor), cursor + seal.length);

  return new Blob([sealed], { type: 'image/png' });
}

/* ── the checksum under an exported document (T-066) ─────────────────── */


/**
 * One line naming each stored screenshot's SHA-256, in full: a cut hash cannot be compared with `sha256sum`.
 * `html` returns markup (in Arabic the hex is in `<bdi>` so it keeps its direction); otherwise plain text.
 */
export function checksumFooter(hashes, lang = 'en', html = false) {
  const rows = Object.entries(hashes || {}).filter(([, h]) => h);
  if (!rows.length) return '';
  const label = docLabels(lang).checksums;
  if (!html) return `${label}: ${rows.map(([id, h]) => `${id} ${h}`).join(' · ')}`;
  const hex = (h) => (docLabels(lang) === docLabels('ar') ? `<bdi>${escHtml(h)}</bdi>` : escHtml(h));
  return `${escHtml(label)}: ${rows.map(([id, h]) => `${escHtml(id)} ${hex(h)}`).join(' · ')}`;
}

/** Documents that end in a footer: the Markdown ones that can show the session's screenshots. */
const FOOTED = new Set(['markdown', 'manual', 'srs', 'sbtm']);

const hashOfOut = async (out) => {
  const bytes = out.encoding === 'base64'
    ? Uint8Array.from(atob(out.content), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(out.content);
  return sha256Hex(bytes);
};

/**
 * T-066: what the offscreen door does to a built export before it is saved.
 *  - Markdown documents end with the checksum line (full hex); the session JSON gains `checksums`
 *    (screenshot id to SHA-256), so a JSON export without pictures still names them;
 *  - `sha256` on the result is the checksum of the exact bytes handed over (a gzip, a workbook, a text), for any
 *    surface that wants to show it. A file cannot contain its own hash, so none of them embeds it.
 * A text that cannot take the stamp (JSON that does not parse) is passed on unchanged.
 */
export async function stampDocument(out, { format = '', hashes = {} } = {}) {
  let next = out;
  if (typeof out.content === 'string' && !out.encoding && Object.values(hashes).some(Boolean)) {
    if (FOOTED.has(format)) {
      next = { ...out, content: `${out.content.replace(/\s+$/, '')}\n\n${checksumFooter(hashes)}\n` };
    } else if (format === 'json') {
      try {
        const doc = JSON.parse(out.content);
        next = { ...out, content: JSON.stringify({ ...doc, checksums: Object.fromEntries(Object.entries(hashes).filter(([, h]) => h)) }, null, 2) };
      } catch { /* not JSON after all: leave it */ }
    }
  }
  return next;
}

/** Add `sha256` of the final bytes to a finished export (after any gzip). */
export async function withSha256(out) {
  return typeof out.content === 'string' ? { ...out, sha256: await hashOfOut(out) } : out;
}
