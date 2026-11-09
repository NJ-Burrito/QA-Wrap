/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * Where the profile's trace line (core/profile.js `traceLine`) goes in each export format. Kept apart from profile.js so
 * the small profile module stays out of the service worker's boot graph and this one can use the shared HTML escaper.
 */
import { escHtml } from './docshell.js';

/** Text inside an XML/HTML comment: `--` is illegal inside one. */
const inComment = (s) => String(s).replace(/-(?=-)/g, '- ');

/**
 * Add the trace line to a finished text export, in the form its format can carry without breaking it:
 * Markdown/text a closing line, HTML a small footer, JSON a `_trace` field (HAR: `log.comment`), CSV/YAML/TS a comment
 * line, XML/SVG a comment. Binary (`encoding`) outputs are left to their builders (workbooks take it as a row; a zip
 * carries it in every part). Returns a new object; an unknown or unparsable text is returned unchanged.
 *
 * @param {{ filename?: string, content?: any, encoding?: string }} out
 * @param {string} line
 */
export function withTrace(out, line) {
  if (!out || !line || out.encoding || typeof out.content !== 'string') return out;
  const name = String(out.filename || '').toLowerCase();
  const ext = name.slice(name.lastIndexOf('.') + 1);
  const text = out.content;
  const tail = text.replace(/\s+$/, '');
  let content;
  switch (ext) {
    case 'md': case 'txt':
      content = `${tail}\n\n${line}\n`; break;
    case 'html': {
      const p = `<p class="qaw-trace" style="margin:24px 0 8px;font-size:11px;color:#595959;text-align:center">${escHtml(line)}</p>`;
      const at = text.toLowerCase().lastIndexOf('</body>');
      content = at >= 0 ? `${text.slice(0, at)}${p}\n${text.slice(at)}` : `${tail}\n${p}\n`;
      break;
    }
    case 'json': case 'har': {
      try {
        const doc = JSON.parse(text);
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return out;
        if (ext === 'har' && doc.log && typeof doc.log === 'object') doc.log = { ...doc.log, comment: line };
        else doc._trace = line;
        content = JSON.stringify(doc, null, 2);
      } catch { return out; }
      break;
    }
    case 'csv': case 'yaml': case 'yml': case 'ts':
      content = `${tail}\n${ext === 'ts' ? '//' : '#'} ${line.replace(/[\r\n]+/g, ' ')}\n`; break;
    case 'xml': case 'svg':
      content = `${tail}\n<!-- ${inComment(line)} -->\n`; break;
    default:
      return out;
  }
  return { ...out, content };
}
