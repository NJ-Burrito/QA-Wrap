/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** The defect fingerprint: one stable label per page path and summary, shared by Jira and the trackers. */
const STOP = new Set('after when that this with from have been were will there their about which into then than also does not the and for are was but you your'.split(' '));

/** Arabic spelling variants folded together: alef forms, yaa/alef-maqsura, taa marbuta/haa; marks and tatweel dropped. */
export function normaliseArabic(s) {
  // \u escapes: no Arabic-script literals outside the Thmanyah cmap (test-glyphs)
  return String(s).normalize('NFKC')
    .replace(/[\u064B-\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/[\u0649\u06CC]/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u06A9/g, '\u0643')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x6F0));
}

/** A stable label + search terms from the page path and the summary. */
export function fingerprint({ url = '', summary = '' } = {}) {
  let path = '';
  try { path = new URL(url).pathname; } catch { /* not a URL: no path */ }
  path = path.toLowerCase().replace(/\/(?:\d+|[0-9a-f]{8,}(?:-[0-9a-f-]+)?)(?=\/|$)/g, '/:id').replace(/\/+$/, '') || '/';
  // Letters and digits of any script (Arabic included); 4+ for Latin as before, 3+ for Arabic where roots are short.
  // The search terms keep the tester's own spelling; only the hash reads the folded form, so variants share a label.
  const seen = new Set();
  const terms = [];
  const folded = [];
  for (const w of String(summary).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    const n = normaliseArabic(w);
    if (n.length < (/\p{Script=Arabic}/u.test(n) ? 3 : 4) || STOP.has(n) || seen.has(n)) continue;
    seen.add(n); terms.push(w); folded.push(n);
    if (terms.length === 4) break;
  }
  let h = 2166136261; // FNV-1a
  for (const c of `${path}|${folded.join(' ')}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return { label: `qaw-fp-${h.toString(16).padStart(8, '0')}`, path, terms };
}

