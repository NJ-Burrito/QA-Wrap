/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * ui-1019 lane A: «Export notes» on the Timeline tab.   node tools/test-notes-export.mjs
 * The real report/notes-build.js: Markdown (default) and CSV, only written notes, oldest first, secrets masked again,
 * spreadsheet formulas defused; and the page wiring: both buttons exist, the script is loaded, EN and AR carry every key.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from './lib-paths.mjs';
import { buildNotesExport, sessionNotes } from '../report/notes-build.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

const session = { startedAt: Date.UTC(2026, 9, 19, 8, 0, 0), charter: 'Checkout, login' };
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const events = [
  { kind: 'note', tag: 'bug', ts: session.startedAt + 9000, text: `Token leaked: Bearer ${jwt}` },
  { kind: 'note', tag: 'idea', ts: session.startedAt + 2500, text: '=HYPERLINK("http://x","y"), "quoted"' },
  { kind: 'note', tag: 'technique', ts: session.startedAt + 3000, text: 'generated technique prompt' },
  { kind: 'note', tag: 'bug', ts: session.startedAt + 4000, text: '   ' },
  { kind: 'net', ts: session.startedAt + 5000, url: 'https://x/' },
];

test('only written notes, oldest first', () => assert.deepEqual(sessionNotes(events).map((e) => e.tag), ['idea', 'bug']));

test('markdown is the default: title, one line per note with its time, no secret', () => {
  const out = buildNotesExport(session, events);
  assert.equal(out.mime, 'text/markdown');
  assert.match(out.filename, /^notes-2026-10-19-08-00-00\.md$/);
  assert.ok(out.content.startsWith('# Checkout, login\n'));
  assert.match(out.content, /- \*\*\+2\.50s\*\* `idea`: /);
  assert.match(out.content, /- \*\*\+9\.00s\*\* `bug`: /);
  assert.ok(!out.content.includes(jwt), 'the token reached the file');
  assert.ok(!out.content.includes('technique prompt'));
  assert.equal(out.count, 2);
});

test('csv: header, quoting, formula defused, secret masked', () => {
  const out = buildNotesExport(session, events, 'csv');
  assert.equal(out.mime, 'text/csv');
  const lines = out.content.split('\r\n');
  assert.equal(lines[0], 'seconds,type,note');
  assert.equal(lines[1], `2.50,idea,"'=HYPERLINK(""http://x"",""y""), ""quoted"""`);
  assert.ok(!out.content.includes(jwt));
});

test('no notes: count 0 (the page then says so instead of saving an empty file)', () => assert.equal(buildNotesExport(session, [events[4]]).count, 0));

test('the page: both buttons, the script, and every string in EN and AR', () => {
  const html = fs.readFileSync(path.join(EXT, 'report', 'report.html'), 'utf8');
  for (const id of ['export-notes', 'export-notes-csv']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<script src="notes-export\.js"><\/script>/);
  const js = fs.readFileSync(path.join(EXT, 'report', 'notes-export.js'), 'utf8');
  const keys = [...new Set([...html.matchAll(/data-i18n="(report\.timeline\.export[^"]+)"/g)].map((m) => m[1]).concat([...js.matchAll(/'(report\.timeline\.export\w+|report\.timeline\.exported)'/g)].map((m) => m[1])))];
  assert.ok(keys.length >= 5, `found only ${keys.join(',')}`);
  for (const l of ['en', 'ar']) {
    const j = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', `${l}.json`), 'utf8'));
    for (const k of keys) assert.ok(j[k], `${l} lacks ${k}`);
  }
});

console.log(`test-notes-export: ${passed} passed`);
