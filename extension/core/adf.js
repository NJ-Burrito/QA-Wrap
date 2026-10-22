/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * Text the tester edited → Atlassian Document Format, and Jira field values.
 *
 * The structured documents (a defect report, a test case) are rendered to ADF
 * by core/istqb-render.js from their model. Once a tester has edited the text
 * in the report page there is no model any more, only their words — so this
 * turns Markdown-shaped text into the ADF Jira insists on: headings, bullets,
 * numbered steps, code fences, bold, and paragraphs. Enough to keep what a
 * person writes readable in Jira; nothing more, because a full Markdown parser
 * in an extension is a second product.
 *
 * The other half is `coerce()`: a Jira field arrives with a schema, and the
 * create call refuses a value in the wrong shape with a message that names the
 * field and nothing else. Every schema Jira's createmeta can return is mapped
 * here, once.
 */

const text = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });

/** Inline **bold**, `code` and plain runs. */
function inline(line) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(text(line.slice(last, m.index)));
    if (m[2] != null) out.push(text(m[2], [{ type: 'strong' }]));
    else out.push(text(m[3], [{ type: 'code' }]));
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(text(line.slice(last)));
  return out; // an empty line is an empty paragraph: Jira refuses {type:"text",text:""} (completion review 6)
}

export function textToAdf(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const content = [];
  let para = [];
  let list = null; // { type: 'bulletList'|'orderedList', items: [] }
  let code = null; // { lines: [] }
  let table = null; // { rows: [[cell]] , header: bool }
  let quote = null; // [lines]

  const flushPara = () => {
    if (!para.length) return;
    content.push({ type: 'paragraph', content: inline(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    content.push({
      type: list.type,
      content: list.items.map((item) => ({ type: 'listItem', content: [{ type: 'paragraph', content: inline(item) }] })),
    });
    list = null;
  };
  const flushTable = () => {
    if (!table) return;
    const width = Math.max(...table.rows.map((r) => r.length), 1);
    const rows = table.rows.map((cells, i) => ({
      type: 'tableRow',
      content: Array.from({ length: width }, (_, c) => ({
        type: table.header && i === 0 ? 'tableHeader' : 'tableCell',
        attrs: {},
        content: [{ type: 'paragraph', content: inline(cells[c] ?? '') }],
      })),
    }));
    content.push({ type: 'table', attrs: { isNumberColumnEnabled: false, layout: 'default' }, content: rows });
    table = null;
  };
  const flushQuote = () => {
    if (!quote) return;
    content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: inline(quote.join(' ')) }] });
    quote = null;
  };
  const flushAll = () => { flushPara(); flushList(); flushTable(); flushQuote(); };
  const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (code) {
      const close = line.match(/^(`{3,})\s*$/);
      if (close && close[1].length >= code.fence) {
        content.push({ type: 'codeBlock', content: code.lines.length ? [text(code.lines.join('\n'))] : [] });
        code = null;
      } else code.lines.push(raw);
      continue;
    }
    const open = line.match(/^(`{3,})/);
    if (open) { flushAll(); code = { lines: [], fence: open[1].length }; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushAll(); content.push({ type: 'heading', attrs: { level: Math.min(h[1].length, 6) }, content: inline(h[2]) }); continue; }
    // A table row: pipes at both ends. The separator row (|---|---|) marks the
    // row above it as the header and is itself dropped.
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
    if (b) { flushPara(); if (!list || list.type !== 'bulletList') { flushList(); list = { type: 'bulletList', items: [] }; } list.items.push(b[1]); continue; }
    const n = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (n) { flushPara(); if (!list || list.type !== 'orderedList') { flushList(); list = { type: 'orderedList', items: [] }; } list.items.push(n[1]); continue; }
    if (!line.trim()) { flushAll(); continue; }
    if (list) flushList();
    para.push(line.trim());
  }
  if (code) content.push({ type: 'codeBlock', content: [text(code.lines.join('\n'))] });
  flushAll();
  if (!content.length) content.push({ type: 'paragraph', content: [text('')] });
  return { type: 'doc', version: 1, content };
}

/* ── back out again, for the Jira that never learned ADF ────────────────── */

/**
 * An ADF document as Jira wiki markup, for a Data Center site.
 *
 * Atlassian Document Format is a Cloud invention. A Data Center site's
 * `description` field is a string of wiki markup, and handed a JSON object it
 * answers "data was not an array" and names no field, which is among the least
 * helpful refusals in the API.
 *
 * Rather than build every document twice, the documents stay ADF everywhere and
 * are flattened here at the last moment, in the one place that knows which Jira
 * is being talked to. Only the node types this product actually emits are
 * handled, which is the same short list `textToAdf()` above produces plus what
 * `core/istqb-render.js` renders; anything else falls through to its text, which
 * is always better than dropping it.
 */
export function adfToWiki(doc) {
  if (typeof doc === 'string') return doc;
  if (!doc || typeof doc !== 'object') return '';

  /*
   * r4-11-2: the text is data. Wiki markup in it ("[~user]" mentions, "!img!", "{macro}", "*bold*", a leading "h1." or "#")
   * is escaped with a backslash, so a page title or a log line cannot become a mention, an embed or a macro in Jira.
   */
  const wikiEsc = (t) => String(t).replace(/[\\{}[\]*_+^~|!?]/g, '\\$&').replace(/^(\s*)([#-]|h[1-6]\.|bq\.)/gm, (m, sp, lead) => `${sp}\\${lead}`);
  const hrefOk = (h) => (/^(https?:|mailto:)/i.test(String(h).trim()) ? String(h).trim().replace(/[\s|[\]]/g, (c) => encodeURIComponent(c)) : null);

  /** Marks are the inline formatting; Jira wiki spells them with punctuation. */
  const marked = (node) => {
    const code = (node.marks || []).some((m) => m.type === 'code');
    let s = code ? String(node.text ?? '').replace(/[\\{}]/g, '\\$&') : wikiEsc(node.text ?? '');
    for (const mark of node.marks || []) {
      if (mark.type === 'strong') s = `*${s}*`;
      else if (mark.type === 'em') s = `_${s}_`;
      else if (mark.type === 'code') s = `{{${s}}}`;
      else if (mark.type === 'link' && hrefOk(mark.attrs?.href)) s = `[${s}|${hrefOk(mark.attrs.href)}]`;
    }
    return s;
  };

  /** A code block is raw text; the only thing that can break out of it is a closing macro, so the brace is split from the name. */
  const codeText = (nodes = []) => nodes.map((n) => (n.type === 'text' ? String(n.text ?? '') : n.type === 'hardBreak' ? '\n' : codeText(n.content))).join('')
    .replace(/\{(code|noformat)/gi, '{\u200b$1');

  const inlineOf = (nodes = []) =>
    nodes
      .map((n) => (n.type === 'text' ? marked(n) : n.type === 'hardBreak' ? '\n' : inlineOf(n.content)))
      .join('');

  /** Lists nest, so the bullet is a prefix that grows rather than a constant. */
  const listItems = (node, bullet) =>
    (node.content || []).flatMap((item) =>
      (item.content || []).map((child) =>
        child.type === 'bulletList' || child.type === 'orderedList'
          ? listItems(child, bullet + (child.type === 'orderedList' ? '#' : '*'))
          : `${bullet} ${inlineOf(child.content)}`
      )
    ).flat();

  const block = (node) => {
    switch (node.type) {
      case 'paragraph':
        return inlineOf(node.content);
      case 'heading':
        return `h${Math.min(6, node.attrs?.level || 2)}. ${inlineOf(node.content)}`;
      case 'bulletList':
        return listItems(node, '*').join('\n');
      case 'orderedList':
        return listItems(node, '#').join('\n');
      case 'codeBlock':
        return `{code}\n${codeText(node.content)}\n{code}`;
      case 'blockquote':
        return `{quote}\n${(node.content || []).map(block).join('\n')}\n{quote}`;
      case 'rule':
        return '----';
      case 'table':
        return (node.content || [])
          .map((row) => {
            const header = (row.content || [])[0]?.type === 'tableHeader';
            const cells = (row.content || []).map((c) => (c.content || []).map(block).join(' ').trim().replace(/(?<!\\)\|/g, '\\|'));
            return header ? `||${cells.join('||')}||` : `|${cells.join('|')}|`;
          })
          .join('\n');
      default:
        return (node.content || []).map(block).join('\n');
    }
  };

  return (doc.content || []).map(block).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ── field values, in the shape Jira wants ──────────────────────────────── */

/**
 * Turn what a person typed or chose into the value Jira's schema expects.
 *
 * `field` is one entry from createmeta: `{ key, schema: { type, items, custom }, allowedValues }`.
 * `raw` is a string, a number, a boolean, or an array of strings (ids or names).
 * Returns `undefined` for an empty value, so the caller can leave the field out.
 */
export function coerce(field, raw) {
  const schema = field?.schema || {};
  const empty = raw == null || raw === '' || (Array.isArray(raw) && !raw.length);
  if (empty) return undefined;

  const option = (v) => {
    const s = String(v);
    const hit = (field.allowedValues || []).find((o) => o.id === s || o.value === s || o.name === s);
    if (hit) return hit.id ? { id: hit.id } : { value: hit.value ?? hit.name };
    return /^\d+$/.test(s) ? { id: s } : { value: s };
  };

  switch (schema.type) {
    case 'string':
      return String(raw);
    case 'number':
      return Number(raw);
    case 'date':
      return String(raw).slice(0, 10);
    case 'datetime':
      return new Date(raw).toISOString();
    case 'priority':
      return option(raw);
    case 'option':
    case 'issuetype':
    case 'resolution':
    case 'version':
    case 'component':
    case 'securitylevel':
      return option(raw);
    case 'user':
      return { accountId: String(raw) };
    case 'issuelink':
      return { key: String(raw) };
    case 'array': {
      const list = Array.isArray(raw) ? raw : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
      if (schema.items === 'string') return list;
      if (schema.items === 'user') return list.map((v) => ({ accountId: v }));
      return list.map(option);
    }
    default:
      // A custom shape nobody has seen: pass JSON through if it is JSON, else the text.
      if (typeof raw === 'string' && /^[[{]/.test(raw.trim())) {
        try { return JSON.parse(raw); } catch { /* fall through */ }
      }
      return raw;
  }
}

/** Which control a field wants on screen. */
export function controlFor(field) {
  const s = field?.schema || {};
  if (s.type === 'array' && field.allowedValues?.length) return 'multiselect';
  if (field.allowedValues?.length) return 'select';
  if (s.type === 'date') return 'date';
  if (s.type === 'datetime') return 'datetime';
  if (s.type === 'number') return 'number';
  if (s.type === 'user' || s.items === 'user') return 'user';
  if (s.type === 'array') return 'tags';
  if (s.custom && /textarea|paragraph/i.test(s.custom)) return 'textarea';
  return 'text';
}
