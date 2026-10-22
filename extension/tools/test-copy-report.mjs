/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * REQ P0-5 (autopilot 1011, rule R9): the copied Markdown is already a bug report.
 * Golden inputs are the two clipboards seat 3 copied on 11 Oct 2026 (tools/fixtures/copy-report-b.md and -c.md): they show
 * the faults (a "# Untitled session" heading, "—" rows, `\(` in tester text). The sessions that produced them are rebuilt
 * here and run through buildMarkdown, which must have none of the faults.
 *
 *   node tools/test-copy-report.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarkdown, reportTitle } from '../core/artifact-docs.js';
import { scanOutbound } from '../core/secret-scan-text.js';
import { problemCounts } from '../core/finding-count.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = (n) => fs.readFileSync(path.join(here, 'fixtures', n), 'utf8');
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_791_724_838_000;
const PRACTICE = 'chrome-extension://dbdhilacpjeojfnmdbnpcbmohkhgaihn/practice/practice.html';
const bare = (over = {}) => ({ id: 's_test_1', charter: 'Untitled session', startedAt: T0, endedAt: T0 + 5000, startUrl: PRACTICE, env: {}, ...over });
const click = (at, label = 'Save profile') => ({ kind: 'dom', action: 'click', label, tag: 'button', locator: `getByRole('button', { name: '${label}' })`, ts: T0 + at, frameUrl: PRACTICE });
const fetchFail = (at) => ({ kind: 'net', method: 'POST', url: `${PRACTICE.replace('practice.html', '')}api/save-profile?token=abc`, error: true, durationMs: 3, ts: T0 + at, frameUrl: PRACTICE, tabTitle: 'Invoice for Jane Doe 4111 1111 1111 1111' });
const consoleErr = (at) => ({ kind: 'console', level: 'error', text: 'Save profile failed: TypeError: Failed to fetch', ts: T0 + at, frameUrl: PRACTICE });
const bugNote = (at, text) => ({ kind: 'note', tag: 'bug', text, ts: T0 + at, frameUrl: PRACTICE });

const sessionB = bare();
const eventsB = [click(2380), fetchFail(2390), consoleErr(2391), bugNote(4240, 'Save says Saved but fails (30th bug)')];
const sessionC = bare({ id: 's_test_2', endedAt: T0 + 108_000 });
const eventsC = [click(2370), fetchFail(2371), consoleErr(2372), bugNote(105_570, 'Save says Saved but request fails'),
  click(106_360, 'Apply coupon'), { kind: 'pageerror', text: "Uncaught TypeError: Cannot read properties of undefined (reading '')", ts: T0 + 106_361, frameUrl: PRACTICE }];

console.log('\ncopied Markdown is a bug report');

test('the golden clipboards do show the faults this test guards against', () => {
  for (const f of ['copy-report-b.md', 'copy-report-c.md']) {
    const md = golden(f);
    assert.match(md, /^# Untitled session/);
    assert.match(md, /\| — \|/);
    assert.match(md, /\\\(/);
  }
});

for (const [name, session, events] of [['b', sessionB, eventsB], ['c', sessionC, eventsC]]) {
  const md = buildMarkdown(session, events);
  test(`${name}: first line is "# <title>" and the title is the first Bug note, never "Untitled session"`, () => {
    const first = md.split('\n')[0];
    assert.match(first, /^# \S/);
    assert.ok(!/untitled/i.test(first), first);
    assert.ok(first.startsWith(`# ${events.find((e) => e.tag === 'bug').text.replace(/[[\]<|]/g, '')}`.slice(0, 20)), first);
  });
  test(`${name}: no table row whose value is "—" or empty`, () => {
    const rows = md.split('\n').filter((l) => /^\| .* \| .* \|$/.test(l) && !/^\|[-| ]+\|$/.test(l));
    assert.ok(rows.length >= 3, 'the table is still there');
    for (const r of rows) assert.ok(!/\|\s*—\s*\|\s*$/.test(r) && !/\|\s*\|\s*$/.test(r.replace(/^\| \| \|$/, 'x |')), r);
    assert.equal((md.match(/\| — \|/g) || []).length, 0);
  });
  test(`${name}: tester text is not backslash-escaped (0 matches of \\( or \\))`, () => {
    assert.equal(md.match(/\\[()]/g), null, 'a bracket carries a backslash');
    assert.ok(md.includes('(30th bug)') || name === 'c');
  });
  test(`${name}: the leak check passes on the text`, () => {
    const { findings } = scanOutbound({ content: md });
    assert.deepEqual(findings, []);
  });
}

test('the Problems row is the one number problemCounts prints: 3 distinct problems in c, 2 in b', () => {
  assert.match(buildMarkdown(sessionC, eventsC), /\| Problems \| 3 \|/);
  assert.match(buildMarkdown(sessionB, eventsB), /\| Problems \| 2 \|/);
});

test('title order: set name, first Bug note, METHOD /path STATUS without the query, then the host', () => {
  assert.equal(reportTitle(bare({ charter: 'Checkout flow' }), eventsB), 'Checkout flow');
  assert.equal(reportTitle(bare(), eventsB), 'Save says Saved but fails (30th bug)');
  assert.equal(reportTitle(bare(), [click(1), fetchFail(2)]), 'POST /practice/api/save-profile network error');
  const five = { kind: 'net', method: 'GET', url: 'https://app.test/api/orders/42?x=secret&y=1', status: 500, ts: T0, frameUrl: 'https://app.test/' };
  assert.equal(reportTitle(bare({ charter: '' }), [five]), 'GET /api/orders/42 500');
  assert.equal(reportTitle(bare({ startUrl: 'https://app.test/a?b=1' }), [click(1)]), 'app.test');
  assert.equal(reportTitle(bare({ charter: 'جلسة بلا عنوان' }), [bugNote(1, 'حفظ فاشل')]), 'حفظ فاشل');
});

test('a page titled "Invoice for Jane Doe 4111..." never reaches the title', () => {
  const ev = [click(1), fetchFail(2), { ...consoleErr(3), tabTitle: 'Invoice for Jane Doe 4111 1111 1111 1111' }];
  const s = { ...bare(), tabTitle: 'Invoice for Jane Doe 4111 1111 1111 1111', title: 'Invoice for Jane Doe 4111 1111 1111 1111' };
  const t = reportTitle(s, ev);
  assert.ok(!/Jane|4111/.test(t), t);
  assert.ok(!/Jane|4111/.test(buildMarkdown(s, ev).split('\n')[0]));
});

test('page text is still escaped: a hostile note cannot plant a link, an image, HTML or a table cell', () => {
  const md = buildMarkdown(bare(), [bugNote(1, '[click](https://evil.test) <img src=x> | cell')]);
  const line = md.split('\n').find((l) => l.includes('evil.test') && l.startsWith('- '));
  assert.ok(line.includes('\\['), line);
  assert.ok(line.includes('\\<'), line);
  assert.ok(line.includes('\\|'), line);
  assert.ok(!/(^|[^\\])\[click\]/.test(line));
});

test('the qaw1 marker and the footer are kept (consumers: provenance readToken, signature verify, uat, test-provenance)', () => {
  const md = buildMarkdown(sessionB, eventsB);
  assert.match(md, /<!-- qaw1:[^>]*-->\s*$/);
});

test('ui-1016 K3: the header never says "N failures" next to a Problems row; Events is the raw count and Problems is problemCounts().groups', () => {
  for (const [session, events] of [[sessionB, eventsB], [sessionC, eventsC], [sessionC, [...eventsC, fetchFail(3000), fetchFail(3001), fetchFail(3002)]]]) {
    const md = buildMarkdown(session, events);
    const row = (k) => (md.split('\n').find((l) => l.startsWith(`| ${k} |`)) || '').split('|')[2].trim();
    assert.equal(row('Events'), String(events.length), 'Events is the count of events and nothing else');
    assert.equal(row('Problems'), String(problemCounts(events).groups));
    assert.ok(!/failures?\)/.test(md.split('\n').slice(0, 14).join('\n')), 'no "(N failures)" in the header');
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
