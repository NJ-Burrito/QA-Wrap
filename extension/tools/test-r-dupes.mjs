/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Duplicate collapse (features-1010, lane R, item 3).
 *
 *   node tools/test-r-dupes.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dupeKey, groupFailures, groupChains } from '../core/dupes.js';
import { correlate } from '../core/correlate.js';
import { buildMarkdown } from '../core/artifact-docs.js';
import { SESSION, click, net, logline, fortyFiveHundreds, T0 } from './lib-r-fixture.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('\nduplicate collapse');

test('40 identical 500s (other ids, other query values) are ONE group with count 40', () => {
  const g = groupFailures(fortyFiveHundreds());
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 40);
  assert.equal(g[0].occurrences.length, 40, 'every occurrence is kept');
});

test('the group count equals the raw failure total, hook repeat rows included', () => {
  const ev = [click(0), net(300), { kind: 'rep', ofKind: 'net', method: 'POST', url: 'https://app.test/api/orders', status: 500, n: 7, ts: T0 + 900 }];
  const g = groupFailures(ev);
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 8);
});

test('another status, another method, another path or another message is a different group', () => {
  const ev = [net(0), net(1000, { status: 502 }), net(2000, { method: 'PUT' }), net(3000, { url: 'https://app.test/api/users' }), logline(4000), logline(5000, { text: 'ReferenceError: y is not defined' })];
  assert.equal(groupFailures(ev).length, 6);
});

test('console errors fold across counts and ids in the message, and by file and line', () => {
  const a = logline(0, { text: 'Failed to load item 12', stack: 'Error\n    at f (https://app.test/app.js:10:5)' });
  const b = logline(1000, { text: 'Failed to load item 98', stack: 'Error\n    at f (https://app.test/app.js:10:77)' });
  const c = logline(2000, { text: 'Failed to load item 98', stack: 'Error\n    at f (https://app.test/app.js:55:1)' });
  assert.equal(dupeKey(a), dupeKey(b));
  assert.notEqual(dupeKey(a), dupeKey(c), 'a different line is a different place');
});

test('the order of first occurrence is kept; a quiet session has no groups', () => {
  const g = groupFailures([logline(5000), net(100)]);
  assert.deepEqual(g.map((x) => x.kind), ['net', 'console']);
  assert.equal(groupFailures([click(0)]).length, 0);
});

test('chains fold into groups: 40 chains, one card, count 40, expansion lists all 40', () => {
  const ev = fortyFiveHundreds();
  const chains = correlate(ev);
  assert.ok(chains.length >= 1);
  const groups = groupChains(chains, ev);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 40);
  assert.equal(groups[0].occurrences.length, 40);
});

test('Markdown shows the group once with the count, and says the Raw JSON keeps all', () => {
  const md = buildMarkdown(SESSION, fortyFiveHundreds(), {});
  assert.equal((md.match(/^### \d+\./gm) || []).length, 1, 'one card in the export');
  assert.match(md, /### 1\..*×40/);
  assert.match(md, /40 times in this session/);
});

test('the report draws the folded cards with the count and an expandable list of every occurrence', () => {
  const js = read('report/report.js');
  const bf = read('report/bugfirst.js');
  assert.match(js, /BF\.groups\(chains, shownEvents\(events\)\)/);
  assert.match(js, /BF\.occurrences\(/);
  assert.match(bf, /report\.dup\.times/);
  assert.match(bf, /report\.dup\.showAll/);
  assert.match(bf, /core\/dupes\.js/);
});

test('both languages carry the dup strings (the pair is the unit)', () => {
  for (const lang of ['en', 'ar']) {
    const m = JSON.parse(read(`platform/i18n/${lang}.json`));
    for (const k of ['report.dup.times', 'report.dup.showAll', 'report.dup.more']) assert.ok(m[k], `${lang} ${k}`);
  }
  assert.match(JSON.parse(read('platform/i18n/ar.json'))['report.dup.showAll'], /[؀-ۿ]/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
