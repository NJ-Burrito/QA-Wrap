/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Secret scan before anything is sent to a tracker.
 *
 * Pure text in, offsets out. Findings never carry the value itself: a scan
 * result travels to a page, and a page must not learn what it found. Patterns
 * are by shape (JWT, vendor prefixes, Authorization and Cookie header values,
 * password=… pairs, user:pass@ URLs, private-key blocks) plus an exact-match
 * list for the tokens the vault already holds, which no shape can find.
 * Placeholders left by capture-time redaction ("«redacted»", "••••") are not
 * secrets and are skipped, or every HAR would be flagged.
 */
import { readZip } from './zip-read.js';
import { zipStored } from './xlsx.js';

import { REDACTION, scanText, redactText, scanFields, adfText, redactAdf } from './secret-scan-text.js';
export { REDACTION, scanText, redactText, scanFields, adfText, redactAdf };

/* ── attachments ───────────────────────────────────────────────────────── */


const MEDIA_NAME = /\.(png|jpe?g|gif|webp|webm|mp4|mov|mp3|wav|ogg|pdf|ico|woff2?|ttf|otf|zip|gz)$/i;
const isZip = (f) => /\.zip$/i.test(f.filename || '') || f.blob?.type === 'application/zip';

/** Text can be scanned; images, video, audio and archives cannot (declared, never silently skipped). Zips are opened separately. */
export const isTextFile = (f) => !/^(image|video|audio)\//.test(f.blob?.type || '') && !/\.(png|jpe?g|gif|webp|webm|mp4|zip|gz)$/i.test(f.filename || '');

const decode = new TextDecoder();

/** The zip's entries, or null when it cannot be read faithfully. */
async function openZip(f) {
  try { return await readZip(new Uint8Array(await f.blob.arrayBuffer())); } catch { return null; }
}

/** Every scannable text of a file: itself, or each text entry of a zip. `{ name, text }`. */
export async function fileTexts(f) {
  if (isZip(f)) return ((await openZip(f)) || []).filter((e) => !MEDIA_NAME.test(e.name)).map((e) => ({ name: `${f.filename}!${e.name}`, text: decode.decode(e.data) }));
  return isTextFile(f) ? [{ name: f.filename, text: await f.blob.text() }] : [];
}

/** A text file (or the text entries of a zip) with its secrets replaced; anything else unchanged. */
export async function redactFile(f, known = []) {
  if (isZip(f)) {
    const entries = await openZip(f);
    if (!entries) return f;
    let n = 0;
    const next = entries.map((e) => {
      if (MEDIA_NAME.test(e.name)) return e;
      const text = decode.decode(e.data);
      const hits = scanText(text, known);
      if (!hits.length) return e;
      n += hits.length;
      return { name: e.name, data: redactText(text, hits) };
    });
    return n ? { ...f, blob: new Blob([zipStored(next)], { type: 'application/zip' }), redacted: n } : f;
  }
  if (!isTextFile(f)) return f;
  const text = await f.blob.text();
  const hits = scanText(text, known);
  return hits.length ? { ...f, blob: new Blob([redactText(text, hits)], { type: f.blob.type }), redacted: hits.length } : f;
}

/** Names of the files no scanner looked inside: media, and any zip that is unreadable or holds media. */
export async function unscannedNames(files) {
  const out = [];
  for (const f of files || []) {
    if (isZip(f)) {
      const entries = await openZip(f);
      if (!entries || entries.some((e) => MEDIA_NAME.test(e.name))) out.push(f.filename);
    } else if (!isTextFile(f)) out.push(f.filename);
  }
  return out;
}
