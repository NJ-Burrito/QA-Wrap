/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The report opens on «What broke» with one primary «Copy as Markdown» (features-1010, lane R, item 2).
 *
 *   node tools/test-r-bugfirst.mjs
 *
 * The page needs a browser, so this settles what a source read can: the default tab, the one primary action, the
 * demoted File control, that nothing was removed, and that the Markdown the button copies has the four things a
 * bug report needs. The live check of the click is `npm run clickthrough`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarkdown } from '../core/artifact-docs.js';
import { SESSION, click, net, logline } from './lib-r-fixture.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('\nbug-first report');

test('with no #hash the report opens on «What broke», and it is the first tab of the first section', () => {
  const js = read('report/report.js');
  assert.match(js, /showTab\(TABS\.includes\(want\) \? want : bySection \? bySection\[1\]\[0\] : 'broke'\)/);
  assert.match(js, /\['findings', \['broke', /);
});

test('the verdict card has ONE primary action: Copy as Markdown; Copy for AI, the File menu and the rest are not primary', () => {
  const js = read('report/report.js');
  const bf = read('report/bugfirst.js');
  assert.match(bf, /make\('btn btn-primary', 'report\.v\.copyMarkdown'/);
  assert.match(bf, /make\('btn btn-secondary', 'report\.ai\.copy'/);
  assert.equal((bf.match(/'btn btn-primary'/g) || []).length, 1, 'one primary button in the bug-first module');
  assert.match(js, /acts\.append\(copyMd, copyAi, file, copy, jump\)/);
  const f = read('report/filing.js');
  assert.match(f, /class="btn btn-secondary" id="btn-file"/);
  assert.match(f, /a\.className = 'btn btn-secondary'/);
  assert.ok(!/class="btn btn-primary" id="btn-file"/.test(f));
  const card = js.slice(js.indexOf('async function renderVerdict'), js.indexOf('async function emlScreens'));
  assert.equal((card.match(/'btn btn-primary'/g) || []).length, 0, 'no other primary button in the verdict card');
});

test('nothing was removed: Jira, the File menu, the tabs and the Raw export are all still there', () => {
  const html = read('report/report.html');
  for (const id of ['tab-broke', 'tab-timeline', 'tab-overview', 'tab-media', 'tab-quality', 'tab-diagram', 'tab-file', 'tab-raw', 'jira-block', 'trackers-block']) assert.ok(html.includes(`id="${id}"`), id);
  const f = read('report/filing.js');
  for (const w of ["'jira'", "'chat'", "'eml'", 'tracker:']) assert.ok(f.includes(w), w);
});

test('the clipboard copy drops embedded screenshots (a data URI would paste megabytes)', () => {
  const bf = read('report/bugfirst.js');
  assert.match(bf, /export const withoutInlineImages/);
  assert.match(bf, /writeText\(withoutInlineImages\(text\)\)/);
});

test('the Markdown it copies has the title, the steps, the failing request and the console error', () => {
  const md = buildMarkdown(SESSION, [click(0, 'Submit order'), net(300, { url: 'https://app.test/api/orders' }), logline(350)], {});
  assert.match(md, /^# Apply for a licence/m);
  assert.match(md, /Click .*Submit order/);
  assert.match(md, /\*\*POST\*\* https:\/\/app\.test\/api\/orders/);
  assert.match(md, /500/);
  assert.match(md, /TypeError: x is undefined/);
});

test('the strings exist in both languages, in plain words', () => {
  for (const lang of ['en', 'ar']) {
    const m = JSON.parse(read(`platform/i18n/${lang}.json`));
    for (const k of ['report.v.copyMarkdown', 'report.v.copiedMarkdown', 'report.v.copyMarkdownEmpty']) assert.ok(m[k], `${lang} ${k}`);
  }
  assert.equal(JSON.parse(read('platform/i18n/en.json'))['report.v.copyMarkdown'], 'Copy as Markdown');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
