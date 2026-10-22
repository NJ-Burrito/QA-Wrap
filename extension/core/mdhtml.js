/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The Markdown QA Wrap writes → HTML QA Wrap styles.
 *
 * Only the shapes our own documents use: headings, paragraphs, bullet and
 * numbered lists, tables with a separator row, blockquotes, fenced code,
 * images, and inline bold / code / links. It is the same grammar as
 * `core/adf.js` reads, so a document looks the same in Jira and in a browser.
 * Anything else stays as text, escaped — never a script, never raw HTML.
 */
import { escHtml as esc } from './docshell.js';
import { docLabels } from './doc-labels.js';

function inline(text) {
  let out = '';
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|_([^_]+)_)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    if (m[2] != null) out += `<strong>${esc(m[2])}</strong>`;
    else if (m[3] != null) out += `<code>${esc(m[3])}</code>`;
    else if (m[4] != null) out += /^(data:image\/|https?:\/\/)/.test(m[5]) ? `<img alt="${esc(m[4])}" src="${esc(m[5])}">` : esc(m[0]);
    else if (m[6] != null) out += /^https?:\/\//.test(m[7]) ? `<a href="${esc(m[7])}" rel="noopener">${esc(m[6])}</a>` : esc(m[0]);
    else if (m[8] != null) out += `<em>${esc(m[8])}</em>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

const slug = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Markdown → `{ html, headings: [{level, text, id}] }`. */
export function mdToHtml(source, lang = /[\u0600-\u06ff]/.test(String(source)) ? 'ar' : 'en') {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let para = [];
  let list = null;
  let table = null;
  let quote = null;
  let code = null;

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  const flushTable = () => {
    if (!table) return;
    const rows = table.rows.map((cells, i) => `<tr>${cells.map((c) => (table.header && i === 0 ? `<th scope="col">${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`);
    out.push(`<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(docLabels(lang).tableScroll)}"><table>${rows.join('')}</table></div>`);
    table = null;
  };
  const flushQuote = () => { if (quote) { out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`); quote = null; } };
  const flushAll = () => { flushPara(); flushList(); flushTable(); flushQuote(); };
  const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (code) {
      if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; }
      else code.push(raw);
      continue;
    }
    if (/^```/.test(line)) { flushAll(); code = []; continue; }
    if (/^---+$/.test(line.trim())) { flushAll(); out.push('<hr>'); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushAll();
      const level = h[1].length;
      const text = h[2].replace(/\*\*/g, '');
      const id = `${slug(text)}-${headings.length + 1}`;
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(); flushList(); flushQuote();
      if (/^\s*\|\s*:?-{2,}/.test(line)) { if (table && table.rows.length === 1) table.header = true; continue; }
      if (!table) table = { rows: [], header: false };
      table.rows.push(splitRow(line));
      continue;
    }
    if (table) flushTable();
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { flushPara(); flushList(); if (!quote) quote = []; if (q[1].trim()) quote.push(q[1].trim()); continue; }
    if (quote) flushQuote();
    const b = line.match(/^\s*[-*•]\s+(.*)$/);
    if (b) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(b[1]); continue; }
    const n = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (n) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(n[1]); continue; }
    if (!line.trim()) { flushAll(); continue; }
    if (list) flushList();
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flushAll();
  return { html: out.join('\n'), headings };
}
