/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-066: a SHA-256 per artifact, called a checksum. It shows a stored file is the file that was
 * written; it is not a signature and proves nothing about who wrote it (SECURITY.md).
 *
 * Offscreen, the export builders and `tools/origin-check.mjs` use it; the service worker's cold
 * start does not, so it stays out of `provenance.js`.
 */

export const SEAL = 'qaw-sha256';

const toBytes = async (data) =>
  data instanceof Uint8Array ? data : data?.arrayBuffer ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data);

/** Lower-case hex SHA-256 of a Blob, Uint8Array or ArrayBuffer (`crypto.subtle`: no bytes through the worker). */
export async function sha256Hex(data) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await toBytes(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The PNG with its last `qaw-sha256` chunk taken out: the bytes the seal was computed over. */
function splitSeal(bytes) {
  let at = 8;
  let seal = null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'tEXt') {
      const data = bytes.subarray(at + 8, at + 8 + length);
      const nul = data.indexOf(0);
      if (nul > 0 && String.fromCharCode(...data.subarray(0, nul)) === SEAL) {
        seal = { at, end: at + 12 + length, hex: String.fromCharCode(...data.subarray(nul + 1)) };
      }
    }
    if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!seal) return null;
  const rest = new Uint8Array(bytes.length - (seal.end - seal.at));
  rest.set(bytes.subarray(0, seal.at), 0);
  rest.set(bytes.subarray(seal.end), seal.at);
  return { expected: seal.hex, rest };
}

const isPng = (b) => [0x89, 0x50, 0x4e, 0x47].every((v, i) => b[i] === v);

/**
 * The Origin check for a file. A PNG carries its own seal; any other file is checked against the
 * `sha256` the session manifest recorded for it.
 * Status: `intact` | `content changed` | `no checksum` (nothing to compare against).
 */
export async function originCheck(data, { sha256 = '' } = {}) {
  const bytes = await toBytes(data);
  const sealed = isPng(bytes) ? splitSeal(bytes) : null;
  const expected = (sealed?.expected || sha256 || '').toLowerCase();
  if (!expected) return { status: 'no checksum', expected: null, actual: await sha256Hex(bytes) };
  const actual = await sha256Hex(sealed ? sealed.rest : bytes);
  return { status: actual === expected ? 'intact' : 'content changed', expected, actual };
}

/** One printed line for a document footer: the first 16 hex of each artifact's checksum. */
export function checksumLine(hashes) {
  const rows = Object.entries(hashes || {}).filter(([, h]) => h);
  return rows.length ? `SHA-256 checksums: ${rows.map(([id, h]) => `${id} ${h.slice(0, 16)}`).join(' · ')}` : '';
}

/** `{id: hex}` for capture records, using the hash stored at write or computing it from the blob. */
export async function captureHashes(records) {
  const out = {};
  for (const [id, rec] of Object.entries(records || {})) {
    out[id] = rec?.sha256 || (rec?.blob ? await sha256Hex(rec.blob) : '');
  }
  return out;
}
