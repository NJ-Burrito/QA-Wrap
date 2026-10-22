/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * A strict XML 1.0 reader for the tests: an oracle independent of the code that writes the files
 * (T-067). It refuses what a real consumer refuses: a character outside the XML Char production,
 * a bare `&`, an unquoted attribute, mismatched tags, `--` inside a comment, a second root.
 * Returns the elements flat, in document order, each with its parent index and text.
 */
const CHAR_BAD = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/u;
const ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

export function parseXml(src) {
  const text = String(src).replace(/^﻿/, '');
  const bad = text.match(CHAR_BAD);
  if (bad) throw new Error(`character U+${bad[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} is not allowed in XML 1.0`);
  const els = [];
  const stack = [];
  let roots = 0, i = 0;
  const unescape = (s) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] ?? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))));
  while (i < text.length) {
    if (text[i] !== '<') {
      const j = text.indexOf('<', i);
      const chunk = text.slice(i, j < 0 ? text.length : j);
      if (ENTITY.test(chunk)) throw new Error(`bare "&" in text near "${chunk.slice(0, 40)}"`);
      if (stack.length) els[stack.at(-1)].text += unescape(chunk);
      else if (chunk.trim()) throw new Error('text outside the root element');
      i = j < 0 ? text.length : j;
    } else if (text.startsWith('<?', i)) {
      const j = text.indexOf('?>', i); if (j < 0) throw new Error('unterminated <? ?>'); i = j + 2;
    } else if (text.startsWith('<!--', i)) {
      const j = text.indexOf('-->', i); if (j < 0) throw new Error('unterminated comment');
      if (text.slice(i + 4, j).includes('--')) throw new Error('"--" inside a comment');
      i = j + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const j = text.indexOf(']]>', i); if (j < 0) throw new Error('unterminated CDATA');
      if (stack.length) els[stack.at(-1)].text += text.slice(i + 9, j); i = j + 3;
    } else if (text.startsWith('</', i)) {
      const m = /^<\/([A-Za-z_][\w.:-]*)\s*>/.exec(text.slice(i, i + 200));
      if (!m) throw new Error(`malformed end tag at ${i}`);
      const top = stack.pop();
      if (top === undefined || els[top].name !== m[1]) throw new Error(`</${m[1]}> does not close <${els[top]?.name}>`);
      i += m[0].length;
    } else {
      const m = /^<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/.exec(text.slice(i, i + 20000));
      if (!m) throw new Error(`malformed start tag at ${i}: ${text.slice(i, i + 60)}`);
      const attrs = {};
      for (const a of m[2].matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const v = a[2] ?? a[3];
        if (ENTITY.test(v)) throw new Error(`bare "&" in attribute ${a[1]}`);
        if (a[1] in attrs) throw new Error(`duplicate attribute ${a[1]}`);
        attrs[a[1]] = unescape(v);
      }
      if (!stack.length && ++roots > 1) throw new Error('more than one root element');
      els.push({ name: m[1], attrs, text: '', parent: stack.length ? stack.at(-1) : -1 });
      if (!m[3]) stack.push(els.length - 1);
      i += m[0].length;
    }
  }
  if (stack.length) throw new Error(`<${els[stack.at(-1)].name}> is never closed`);
  if (!roots) throw new Error('no root element');
  return els;
}
