/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * exp1022: export naming, per-test folders and the notes file.   node tools/test-exports-1022.mjs
 * The real core/filing.js path builders and report/notes-file.js (md numbering, a .docx unzipped and read back).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { EXT } from './lib-paths.mjs';
import { exportPath, evidencePath, filePath, notesPath, sessionTitle, testFolder, useTitle } from '../core/filing.js';
import { notesMarkdown, notesDocx, noteRows } from '../report/notes-file.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };
const when = new Date(2026, 9, 22, 9, 5).getTime();
const AR = 'طلب فتح لغايات الإخلاء';
const sess = { startedAt: when, charter: AR };
const day = '2026-10-22';

test('test folder = title + date, Arabic kept', () => assert.equal(testFolder(sess), `${AR} ${day}`));
test('illegal characters stripped, length capped, empty becomes QA session', () => {
  assert.equal(sessionTitle({ charter: 'a/b\\c:d*e?"f<g>h|i' }), 'a b c d e f g h i');
  assert.ok(sessionTitle({ charter: 'x'.repeat(200) }).length <= 40);
  assert.equal(sessionTitle({ charter: 'Untitled session' }), 'QA session');
  assert.equal(sessionTitle({}), 'QA session');
});
test('screenshot / recording / audio: per type, then per test, name carries title and date', () => {
  const shot = evidencePath({ ts: when, type: 'image/png', label: 'Error shown', kind: 'screenshot' }, 2, sess);
  assert.equal(shot, `QA Wrap/Screenshots/${AR} ${day}/02 Error shown - ${AR} ${day}.png`);
  const clip = evidencePath({ ts: when, type: 'video/mp4', kind: 'recording' }, 1, sess);
  assert.equal(clip, `QA Wrap/Recordings/${AR} ${day}/01 Recording - ${AR} ${day}.mp4`);
  assert.ok(evidencePath({ type: 'audio/wav', kind: 'recording' }, 1, sess).startsWith(`QA Wrap/Recordings/${AR} ${day}/`));
});
test('documents and other exports sit in their type folder, per test', () => {
  assert.equal(exportPath('srs-html', sess), `QA Wrap/Documents/${AR} ${day}/Requirements specification - ${AR} ${day}.html`);
  assert.equal(exportPath('markdown', sess), `QA Wrap/Reports/${AR} ${day}/Bug report - ${AR} ${day}.md`);
  assert.equal(filePath({ part: 'Workflow diagram', kind: 'docs', ext: 'svg', session: sess }), `QA Wrap/Documents/${AR} ${day}/Workflow diagram - ${AR} ${day}.svg`);
});
test('notes path: Documents/<title> <date>/<title> <date> notes.docx and .md, remembered folder in front', () => {
  assert.equal(notesPath(sess, 'docx'), `QA Wrap/Documents/${AR} ${day}/${AR} ${day} notes.docx`);
  assert.equal(notesPath(sess, 'md', { folder: 'Clients' }), `Clients/QA Wrap/Documents/${AR} ${day}/${AR} ${day} notes.md`);
});
test('the report header title wins over the charter when useTitle is set', () => {
  useTitle(() => 'Bug title');
  assert.equal(testFolder({ startedAt: when, charter: 'Untitled session' }), `Bug title ${day}`);
  useTitle(null);
});

const events = [
  { kind: 'note', tag: 'bug', ts: when + 9000, text: 'second' },
  { kind: 'note', tag: 'idea', ts: when + 2500, text: `${AR}\nline two` },
  { kind: 'note', tag: 'technique', ts: when + 3000, text: 'generated' },
];
test('markdown notes are numbered 1., 2. in time order, not bullets', () => {
  const md = notesMarkdown('T', noteRows(sess, events));
  assert.match(md, /\n1\. \*\*\+2\.50s\*\* `idea`: /);
  assert.match(md, /\n2\. \*\*\+9\.00s\*\* `bug`: second/);
  assert.ok(!/^- /m.test(md));
});

// minimal stored-zip reader for the test
function unzip(buf) {
  const files = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18), nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28), method = buf.readUInt16LE(p + 8);
    const name = buf.toString('utf8', p + 30, p + 30 + nlen);
    const data = buf.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    files[name] = (method ? zlib.inflateRawSync(data) : data).toString('utf8');
    p += 30 + nlen + xlen + size;
  }
  return files;
}
test('docx: valid parts, Arabic paragraph is bidi + rtl, real numbering, Thmanyah only', () => {
  const f = unzip(Buffer.from(notesDocx(AR, noteRows(sess, events))));
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/numbering.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) assert.ok(f[n], n);
  const doc = f['word/document.xml'];
  assert.match(doc, /<w:bidi\/>/);
  assert.match(doc, /<w:rtl\/>/);
  assert.equal((doc.match(/<w:numPr>/g) || []).length, 2);
  assert.match(f['word/numbering.xml'], /<w:numFmt w:val="decimal"\/>/);
  assert.ok(doc.includes(AR));
  const all = Object.values(f).join('');
  assert.ok(all.includes('Thmanyah Sans') && !/cairo/i.test(all));
  assert.ok([...all.matchAll(/w:ascii="([^"]+)"/g)].every((m) => m[1] === 'Thmanyah Sans'));
});

test('Save sheet wiring: Notes checkbox in Evidence, strings in EN and AR', () => {
  const js = fs.readFileSync(path.join(EXT, 'report', 'report.js'), 'utf8');
  assert.match(js, /\['media:notes', t\('report\.part\.exp1022Notes'/);
  assert.match(js, /chosen\.includes\('media:notes'\)/);
  for (const l of ['en', 'ar']) {
    const d = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', `${l}.json`), 'utf8'));
    for (const k of ['report.part.exp1022Notes', 'report.part.exp1022NotesNote', 'report.exp1022NoNotes']) assert.ok(d[k], `${l} ${k}`);
  }
});
console.log(`test-exports-1022: ${passed} passed`);
