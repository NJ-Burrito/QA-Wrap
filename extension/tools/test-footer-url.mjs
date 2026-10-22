/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-057 (owner answer Q-16): the document footer carries the product URL as plain text, no anchor,
 * no query string; the same URL as PRODUCT.urls.homepage; docs, JUnit, HTML shell show it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAKER, docFooter } from '../core/provenance.js';
import { PRODUCT } from '../core/product.js';

let passed = 0; const failures = [];
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL  ${name}\n        ${e.message}`); } };
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the footer URL is the product homepage: empty (none shown) or https with no query and no fragment', () => {
  assert.equal(MAKER.url, PRODUCT.urls.homepage);
  if (MAKER.url) assert.match(MAKER.url, /^https:\/\/[^?#\s]+$/);
});
test('docFooter ends in the plain URL (when there is one) and is not an anchor', () => {
  const f = docFooter({ session: { id: 's1', startedAt: 0 }, version: '3.3.0' });
  if (MAKER.url) assert.ok(f.endsWith(` ${MAKER.url}`), f);
  else assert.ok(f.endsWith('Released under the MIT licence.') && !/https?:/.test(f), f);
  assert.doesNotMatch(f, /<a |href=|\]\(/);
});
test('the HTML document shell footer prints it as text, never as an anchor', () => {
  const s = read('core/docshell.js');
  const footer = s.match(/<footer>[\s\S]*?<\/footer>/)[0];
  assert.match(footer, /MAKER\.url/);
  assert.doesNotMatch(footer, /<a /);
});
test('the QA Wrap provenance token is untouched', () => {
  assert.match(read('core/docshell.js'), /\$\{provenance\}/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
