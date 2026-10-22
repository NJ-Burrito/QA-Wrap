/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The agent brief reports problems, not the tester's own noise.
 *
 *   node tools/test-agent-brief.mjs
 *
 * `buildFindings` turned every correlated chain into a finding, including a
 * 500 the tester forced with an override rule and a dev-only console error a
 * hook had hinted as a note. The headline, the report and the live badge all
 * skip those through `liteProblem`; the brief must agree with them, and a
 * failure that repeats is one finding with a count, not many.
 */
import assert from 'node:assert/strict';
import { buildAgentBrief } from '../core/agent.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_757_000_000_000;
const URL0 = 'https://app.test/apply';
const SESSION = { id: 's1', charter: 'brief', startedAt: T0 - 1000, endedAt: T0 + 20000, startUrl: URL0, env: {} };
let seq = 0;
const click = (at) => ({ kind: 'dom', action: 'click', label: 'Submit', ts: T0 + at, frameUrl: URL0, seq: ++seq });
const net = (at, over = {}) => ({ kind: 'net', method: 'POST', url: 'https://app.test/api/x', status: 500, ts: T0 + at, frameUrl: URL0, seq: ++seq, ...over });
const logline = (at, over = {}) => ({ kind: 'console', level: 'error', text: 'boom', ts: T0 + at, frameUrl: URL0, seq: ++seq, ...over });

const findingsOf = (events) => JSON.parse(buildAgentBrief(SESSION, events)).findings
  .filter((f) => f.source === 'correlated-failure');

console.log('\nagent brief — correlated-failure findings');

test('a real 500 after a click is a finding (known-true sample)', () => {
  const f = findingsOf([click(0), net(300)]);
  assert.equal(f.length, 1);
  assert.equal(f[0].triggeredBy?.action, 'click');
});

test('a 500 the tester forced with an override rule is not a finding (05-3)', () => {
  assert.equal(findingsOf([click(0), net(300, { overridden: true })]).length, 0);
});

test('an API-test call is not a finding (05-3)', () => {
  assert.equal(findingsOf([click(0), net(300, { via: 'api' })]).length, 0);
});

test("a hook-hinted dev console error (nh:'dev') is not a finding (05-3)", () => {
  assert.equal(findingsOf([click(0), logline(300, { nh: 'dev' })]).length, 0);
});

test('a hinted note never hides an HTTP error (05-3)', () => {
  assert.equal(findingsOf([click(0), net(300, { nh: 'dev', status: 500 })]).length, 1);
});

test('the same failure after two clicks is one finding with a count (05-3)', () => {
  const f = findingsOf([click(0), net(300), click(6000), net(6300)]);
  assert.equal(f.length, 1, 'repeats fold into the first');
  assert.equal(f[0].occurrences, 2);
});

test('different failures stay separate findings', () => {
  const f = findingsOf([click(0), net(300), click(6000), net(6300, { url: 'https://app.test/api/other' })]);
  assert.equal(f.length, 2);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
