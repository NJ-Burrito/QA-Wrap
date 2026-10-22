/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * exp1022: the session's notes as one file in Documents/<title> <date>/, as BOTH .docx and .md, numbered 1., 2., 3.
 * Lazily loaded by the Save sheet ("Notes" under Evidence) and by the Timeline export. Pure builders plus one saver.
 *
 * The .docx is a hand-made package (zipStored from core/xlsx.js, no dependency). Arabic: a paragraph that contains
 * Arabic is `bidi` and its runs `rtl`. The numbers are Word's own numbering (numbering.xml), not typed text, because a
 * typed "1." in a right-to-left paragraph displays as ".1". Thmanyah is the only face named; it is not embedded, so a
 * machine without it shows Word's fallback.
 */
import { sessionNotes, clean } from './notes-build.js';
import { zipStored } from '../core/xlsx.js';

const FONT = 'Thmanyah Sans';
const AR = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
// XML 1.0 forbids control characters; the text is also escaped.
const xml = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); // glyph-ok: XML control-char strip

/** The notes, oldest first, secrets masked again. */
export function noteRows(session, events) {
  return sessionNotes(events).map((e) => ({
    at: Number.isFinite(session?.startedAt) ? Math.max(0, (e.ts - session.startedAt) / 1000).toFixed(2) : '',
    tag: clean(e.tag || 'note'),
    text: clean(e.text).replace(/\r\n?/g, '\n').trim(),
  }));
}

/** Markdown: a title, then a real ordered list. */
export function notesMarkdown(title, rows) {
  const body = rows.map((n, i) => `${i + 1}. **+${n.at}s** \`${n.tag}\`: ${n.text.replace(/\n/g, '\n   ')}`).join('\n');
  return `# ${title}\n\n${body}\n`;
}

const rPr = (rtl, bold) => `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" w:eastAsia="${FONT}"/>${bold ? '<w:b/><w:bCs/>' : ''}${rtl ? '<w:rtl/>' : ''}<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>`;
function para(text, { numbered = false, bold = false } = {}) {
  const rtl = AR.test(text);
  const pPr = `<w:pPr>${numbered ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}${rtl ? '<w:bidi/>' : ''}</w:pPr>`;
  const runs = String(text).split('\n').map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${rPr(rtl, bold)}<w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join('');
  return `<w:p>${pPr}${runs}</w:p>`;
}

/** The .docx bytes. Every part is a plain string, so the package can be unzipped and read in a test. */
export function notesDocx(title, rows) {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const paras = [para(title, { bold: true }), ...rows.map((n) => para(`+${n.at}s · ${n.tag}: ${n.text}`, { numbered: true }))].join('');
  const rtlDefault = rows.concat([{ text: title }]).some((n) => AR.test(n.text));
  return zipStored([
    { name: '[Content_Types].xml', data: `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'word/styles.xml', data: `${head}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" w:eastAsia="${FONT}"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/>${rtlDefault ? '<w:bidi/>' : ''}</w:pPr></w:pPrDefault></w:docDefaults></w:styles>` },
    { name: 'word/numbering.xml', data: `${head}<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="567" w:hanging="567"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>` },
    { name: 'word/document.xml', data: `${head}<w:document ${W}><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>` },
  ]);
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Save both files. Returns what the Save sheet's loop needs: paths written, failures, routes taken.
 * @param {{ session: any, events: object[], filing: typeof import('../core/filing.js'), settings?: any, say?: (k: string, v?: object) => string }} a
 */
export async function saveNotes({ session, events, filing, settings, say }) {
  const out = { written: [], failed: [], routes: [] };
  const rows = noteRows(session, events);
  if (!rows.length) { out.failed.push(say ? say('report.exp1022NoNotes') : 'no notes'); return out; }
  const title = clean(filing.sessionTitle(session));
  const folder = settings?.downloadFolder || '';
  const files = [
    ['md', new Blob([notesMarkdown(title, rows)], { type: 'text/markdown' }), 'text/markdown'],
    ['docx', new Blob([notesDocx(title, rows)], { type: DOCX_MIME }), DOCX_MIME],
  ];
  for (const [ext, blob, mime] of files) {
    const res = await window.UQADownload.saveFiled(blob, filing.notesPath(session, ext, { folder }), mime);
    if (res.how) out.routes.push(res.how);
    if (res.ok) out.written.push(res.path || filing.notesPath(session, ext)); else out.failed.push(`notes.${ext}: ${res.error || ''}`);
  }
  return out;
}
