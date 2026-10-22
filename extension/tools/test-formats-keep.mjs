/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** T-049: the default keep-list is ten formats; every other one sits on the "More" shelf of both pickers. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FORMATS, KEEP_FORMATS, isMoreFormat } from '../core/filing.js';

let failed = 0;
const test = (n, f) => { try { f(); console.log(`  ok  ${n}`); } catch (e) { failed++; console.log(`  FAIL ${n}\n       ${e.message}`); } };
const html = readFileSync(new URL('../report/report.html', import.meta.url), 'utf8');
const sel = html.slice(html.indexOf('<select id="format"'), html.indexOf('</select>', html.indexOf('<select id="format"')));
const moreGroup = sel.slice(sel.indexOf('report.raw.groupMore'));
const inMore = (id) => moreGroup.includes(`<option value="${id}"`);

test('the keep-list is exactly the ten the owner approved', () =>
  assert.deepEqual([...KEEP_FORMATS].sort(), ['github', 'har', 'html', 'jira', 'json', 'junit', 'markdown', 'playwright', 'postman', 'sheet-xlsx']));
test('every kept format is a real format', () => { for (const id of KEEP_FORMATS) assert.ok(FORMATS[id], id); });
test('the session card is internal, never on the More shelf', () => assert.equal(isMoreFormat('session-manifest'), false));
test('every format in the raw-report picker is in the keep-list or under More, never both', () => {
  for (const [, id] of sel.matchAll(/<option value="([^"]+)"/g)) assert.equal(inMore(id), isMoreFormat(id), id);
});
test('the Save sheet puts More unticked (source check)', () => {
  const js = readFileSync(new URL('../report/report.js', import.meta.url), 'utf8');
  assert.ok(js.includes("box.checked = g.id !== 'more'") && js.includes('isMoreFormat'));
});
console.log(`\n${5 - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
