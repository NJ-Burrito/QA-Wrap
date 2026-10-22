/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * "Check another size": what the popup says the new window took with it.
 *
 * E16, and the popup's half of `docs/window-sizes-contract.md`. The
 * worker decides what a window-size run inherits and reports it; the popup's
 * whole job is to turn that into a true sentence, and a sentence assembled from
 * two lists and four booleans is exactly the kind that is wrong for six weeks
 * before anybody notices.
 *
 * `inheritLine()` is written as a pure function of the worker's `run` object so
 * that every combination can be checked here without a browser and without
 * Group G having shipped their half yet. The last group is the one that matters
 * most today: **a reply with no `run` must read exactly as it read before this
 * feature existed**, so the popup is shippable while the other half is still
 * being written.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift } from './lib-lift.mjs';

import { surfaceSource } from './lib-src.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const JS = surfaceSource('popup/popup.js');
const HTML = fs.readFileSync(path.join(EXT, 'popup', 'popup.html'), 'utf8');
const CONTRACT_PATH = path.join(EXT, 'docs', 'window-sizes-contract.md');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const inheritLine = new Function(`${lift(JS, 'inheritLine')}\nreturn inheritLine;`)();

console.log('the sentence the popup prints after opening a window at another size');

test('no run at all reads exactly as it did before this feature existed', () => {
  // Group G has not shipped its half yet. Until it does, every press takes this
  // branch, and a half-built feature must not degrade the sentence that worked.
  assert.equal(inheritLine(null), 'Awake there too.');
  assert.equal(inheritLine(undefined), 'Awake there too.');
});

test('a run that inherited nothing says only what is true', () => {
  const line = inheritLine({ inherited: { video: false, mask: false }, refused: [] });
  assert.equal(line, 'Awake there too.');
  assert.ok(!/record|mask/i.test(line), 'it claims something the window did not take');
});

test('video alone, masking alone, and both', () => {
  assert.match(inheritLine({ inherited: { video: true } }), /with recording\./);
  assert.match(inheritLine({ inherited: { mask: true } }), /with masking\./);
  const both = inheritLine({ inherited: { video: true, mask: true } });
  assert.match(both, /with recording and masking\./);
  assert.ok(both.split(/\s+/).length <= 8, 'the line is one short line (ui-1016 H2)');
});

test('a refusal is named rather than swallowed', () => {
  const line = inheritLine({ inherited: { video: true }, refused: ['webcam'] });
  assert.match(line, /could not take: webcam\./);
});

test('several refusals are listed, and a refusal with no inheritance still shows', () => {
  assert.match(
    inheritLine({ inherited: { video: true, mask: true }, refused: ['webcam', 'mic'] }),
    /could not take: webcam, mic\./
  );
  assert.match(inheritLine({ inherited: {}, refused: ['mask'] }), /could not take: mask\./);
});

test('every combination produces one finished sentence and never an empty one', () => {
  for (const video of [true, false]) {
    for (const mask of [true, false]) {
      for (const refused of [[], ['webcam'], ['webcam', 'mic']]) {
        const line = inheritLine({ inherited: { video, mask }, refused });
        assert.ok(line.length > 10, `empty sentence for ${JSON.stringify({ video, mask, refused })}`);
        assert.match(line, /\.$/, `unfinished sentence for ${JSON.stringify({ video, mask, refused })}`);
        assert.ok(!/undefined|null|\[object/.test(line), `a value leaked into the sentence: ${line}`);
      }
    }
  }
});

console.log('\nthe contract the three groups agreed before any of them coded');

test('the contract exists, and this half was written against it', () => {
  assert.ok(fs.existsSync(CONTRACT_PATH), 'docs/window-sizes-contract.md is gone');
  const contract = fs.readFileSync(CONTRACT_PATH, 'utf8');
  for (const term of ['UQA_OPEN_VIEWPORT', 'UQA_VIEWPORT_CHANGED', 'runId', 'Window sizes', 'refused']) {
    assert.ok(contract.includes(term), `the contract no longer fixes ${term}`);
  }
});

test('the popup sends what the contract says it sends, and nothing the worker owns', () => {
  const at = JS.indexOf("type: 'UQA_OPEN_VIEWPORT'");
  assert.ok(at > -1, 'the popup no longer opens a window at another size');
  const call = JS.slice(at, at + 200);
  assert.match(call, /inherit: true/, 'the popup does not ask for inheritance');
  assert.match(call, /tabId: ctx\.tabId/, 'the window under test is left for the worker to guess');
  // The popup must not decide what is inherited: it cannot see whether a clip
  // is running without a second round trip, and a second round trip is a second
  // chance for the two halves to disagree. See the contract, §2.
  assert.ok(!/video: (true|false)/.test(call), 'the popup is deciding inheritance instead of reporting it');
});

test('the popup listens for the broadcast the contract names', () => {
  assert.match(JS, /UQA_VIEWPORT_CHANGED/, 'a run opening or closing leaves the popup stale');
});

test('the sizes panel says what a new window will carry, before it is opened', () => {
  assert.match(HTML, /id="viewport-inherit"/, 'the panel makes no promise');
  const panel = HTML.slice(HTML.indexOf('id="viewport-inherit"'), HTML.indexOf('id="viewport-list"'));
  assert.match(panel, /masked/i, 'masking inheritance, which already works, is not mentioned');
  assert.match(panel, /Window sizes/, 'the report section is not named where the tester decides to press');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
