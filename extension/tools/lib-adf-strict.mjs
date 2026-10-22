/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-049: a strict reader for Atlassian Document Format, written from Atlassian's node list and
 * sharing no code with core/adf.js, core/formats.js or core/istqb-render.js. It answers a list of
 * what is wrong with a document, empty when Jira's create call would accept it.
 *
 *   validateAdf(doc) -> string[]
 *
 * The rules are the ones that make Jira answer INVALID_INPUT: an unknown node or mark type, a
 * child the parent does not allow, an empty `text`, a list without items, a heading level outside
 * 1 to 6, a `code` mark beside another mark, a control character in a text.
 */
const INLINE = ['text', 'hardBreak', 'mention', 'emoji', 'inlineCard', 'status', 'date'];
const BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList', 'codeBlock', 'blockquote', 'rule', 'table', 'panel'];
const CELL = ['paragraph', 'heading', 'bulletList', 'orderedList', 'codeBlock', 'blockquote', 'panel', 'rule'];

/** node type -> { kids: allowed child types, min: fewest children }. */
export const NODE_TYPES = {
  doc: { kids: BLOCKS, min: 1 },
  paragraph: { kids: INLINE, min: 0 },
  heading: { kids: INLINE, min: 0 },
  bulletList: { kids: ['listItem'], min: 1 },
  orderedList: { kids: ['listItem'], min: 1 },
  listItem: { kids: ['paragraph', 'bulletList', 'orderedList', 'codeBlock', 'blockquote'], min: 1 },
  codeBlock: { kids: ['text'], min: 0 },
  blockquote: { kids: ['paragraph', 'bulletList', 'orderedList', 'codeBlock'], min: 1 },
  panel: { kids: ['paragraph', 'heading', 'bulletList', 'orderedList', 'codeBlock', 'rule'], min: 1 },
  rule: { kids: [], min: 0 },
  table: { kids: ['tableRow'], min: 1 },
  tableRow: { kids: ['tableHeader', 'tableCell'], min: 1 },
  tableHeader: { kids: CELL, min: 1 },
  tableCell: { kids: CELL, min: 1 },
  text: { kids: [], min: 0 },
  hardBreak: { kids: [], min: 0 },
  mention: { kids: [], min: 0 }, emoji: { kids: [], min: 0 }, inlineCard: { kids: [], min: 0 }, status: { kids: [], min: 0 }, date: { kids: [], min: 0 },
};
export const MARKS = ['strong', 'em', 'code', 'link', 'strike', 'underline', 'subsup', 'textColor'];
const PANELS = ['info', 'note', 'warning', 'error', 'success'];
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

export function validateAdf(doc) {
  const bad = [];
  if (!doc || doc.type !== 'doc' || doc.version !== 1) bad.push('the envelope is not {type: "doc", version: 1}');
  if (!Array.isArray(doc?.content)) { bad.push('doc has no content array'); return bad; }
  try { if (JSON.stringify(JSON.parse(JSON.stringify(doc))) !== JSON.stringify(doc)) bad.push('the document does not survive a JSON round trip'); } catch (e) { bad.push(`not JSON: ${e.message}`); }

  const walk = (node, at) => {
    const spec = NODE_TYPES[node?.type];
    if (!spec) { bad.push(`${at}: unknown node type "${node?.type}"`); return; }
    const kids = node.content;
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || node.text === '') bad.push(`${at}: empty text node`);
      else if (CONTROL.test(node.text)) bad.push(`${at}: control character in text`);
      if (node.content) bad.push(`${at}: a text node cannot have content`);
      const marks = node.marks || [];
      for (const m of marks) {
        if (!MARKS.includes(m?.type)) bad.push(`${at}: unknown mark "${m?.type}"`);
        if (m?.type === 'link' && !/^[a-z][a-z0-9+.-]*:/i.test(m.attrs?.href || '')) bad.push(`${at}: link without an absolute href`);
      }
      if (marks.some((m) => m.type === 'code') && marks.some((m) => !['code', 'link'].includes(m.type))) bad.push(`${at}: the code mark beside another mark`);
      return;
    }
    if (kids !== undefined && !Array.isArray(kids)) { bad.push(`${at}: content is not an array`); return; }
    const list = kids || [];
    if (list.length < spec.min) bad.push(`${at}: ${node.type} needs at least ${spec.min} child(ren)`);
    if (node.type === 'heading' && !(Number.isInteger(node.attrs?.level) && node.attrs.level >= 1 && node.attrs.level <= 6)) bad.push(`${at}: heading level ${node.attrs?.level}`);
    if (node.type === 'panel' && !PANELS.includes(node.attrs?.panelType)) bad.push(`${at}: panelType ${node.attrs?.panelType}`);
    if (node.type === 'codeBlock' && list.some((c) => c.marks?.length)) bad.push(`${at}: a code block carries marks`);
    list.forEach((c, i) => {
      if (!spec.kids.includes(c?.type)) bad.push(`${at}.${node.type}[${i}]: ${c?.type} is not allowed inside ${node.type}`);
      walk(c, `${at}.${node.type}[${i}]`);
    });
  };
  doc.content.forEach((c, i) => {
    if (!NODE_TYPES.doc.kids.includes(c?.type)) bad.push(`doc[${i}]: ${c?.type} is not a top-level node`);
    walk(c, `doc[${i}]`);
  });
  return bad;
}
