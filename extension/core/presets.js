/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-067: five presets for the Save sheet, and the one zip a client can be handed.
 *
 * A preset only ticks boxes; it names a destination ("for the developer"), not a format. Every id
 * must be a retained format (T-049) so a preset can never point at a removed one: the contract test
 * fails if it does. Pure: no chrome, no DOM, so the Save sheet, the offscreen builder and Node tests
 * all read the same table.
 */
import { zipStored, fromBase64 } from './xlsx.js';

export const PRESETS = Object.freeze({
  developer: ['markdown', 'github', 'har', 'playwright'],
  client: ['html', 'markdown', 'sheet-xlsx'],
  manager: ['html', 'sheet-xlsx'],
  ci: ['junit', 'playwright', 'postman'],
  everything: ['markdown', 'html', 'json', 'har', 'jira', 'github', 'junit', 'playwright', 'sheet-xlsx', 'postman'],
});

export const presetFormats = (id) => [...(PRESETS[id] || [])];

/** What a bundle builds: the ticked parts (or the client preset), the session JSON, and the session card that carries the checksums; never the bundle itself. */
export const bundleIds = (parts) => [...new Set([...(parts?.length ? parts : PRESETS.client), 'json', 'session-manifest'])].filter((id) => id !== 'bundle');

/**
 * D-1010-122: the slug in an export name keeps letters and digits of any script (`\p{L}\p{M}\p{N}`, marks kept so a vowelled word is not cut), collapses runs to one hyphen,
 * and falls back to the short session id when nothing is left, so an Arabic charter keeps its name and two do not collide.
 */
export function exportSlug(charter, sessionId) {
  const keep = (x) => String(x || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return keep(charter).slice(0, 48).replace(/-$/, '') || keep(sessionId).replace(/-/g, '').slice(0, 8) || 'session';
}

/** `qaw-bundle-<slug>-<stamp>.zip`. */
export function bundleFilename(charter, startedAt, sessionId) {
  return `qaw-bundle-${exportSlug(charter, sessionId)}-${new Date(startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
}

/** `report.part.bundle`: the one-zip file, its extension and the entry folder for pictures. */
export const BUNDLE_SHOTS = 'Screenshots';

const unique = (name, taken) => {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) if (!taken.has(`${stem} (${n})${ext}`)) return `${stem} (${n})${ext}`;
};

const dataUrlBytes = (u) => {
  const m = /^data:[^;,]*;base64,(.*)$/s.exec(String(u || ''));
  return m ? fromBase64(m[1]) : null;
};

/**
 * `parts`: `[{ filename, content, encoding? }]` as the builders return them (`encoding: 'base64'`
 * for workbooks and gzip). `screenshots`: `[{ name, dataUrl }]`; one without a readable data URL is
 * skipped, not written empty. Entries are stored (not deflated): a workbook is already a zip.
 * ponytail: stored entries make text larger than the sum of single gzips; deflate if a bundle
 * outgrows a mail attachment.
 */
export function buildBundleZip({ parts = [], screenshots = [] }) {
  const taken = new Set();
  const files = [];
  const add = (name, data) => { const n = unique(name, taken); taken.add(n); files.push({ name: n, data }); };
  for (const p of parts) add(p.filename, p.encoding === 'base64' ? fromBase64(p.content) : String(p.content ?? ''));
  for (const s of screenshots) {
    const bytes = dataUrlBytes(s.dataUrl);
    if (bytes) add(`${BUNDLE_SHOTS}/${s.name}`, bytes);
  }
  return zipStored(files);
}
