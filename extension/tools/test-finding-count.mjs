/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * REQ P0-3 (autopilot 1011, contract C5): one problem number. `problemCounts(events)` -> { groups, events, dupes }.
 * The popup, the report headline and the Markdown "Problems" row print `groups`; `events` appears only beside the word "events".
 *
 *   node tools/test-finding-count.mjs
 */
import assert from 'node:assert/strict';
import { problemCounts } from '../core/finding-count.js';
import { countFindings } from '../core/sessions.js';
import { buildMarkdown, buildJson } from '../core/artifact-docs.js';
import { buildAgentBrief } from '../core/agent.js';
import { buildSessionJson } from '../core/ai-brief.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_791_724_838_000;
const U = 'https://app.test/';
const net = (at, over = {}) => ({ kind: 'net', method: 'POST', url: `${U}api/orders`, status: 500, ts: T0 + at, frameUrl: U, durationMs: 20, ...over });
const logline = (at, over = {}) => ({ kind: 'console', level: 'error', text: 'TypeError: x is undefined', ts: T0 + at, frameUrl: U, ...over });
const click = (at) => ({ kind: 'dom', action: 'click', label: 'Pay', ts: T0 + at, frameUrl: U });

console.log('\none problem number');

test('2 distinct failure groups and 1 duplicate: groups 2, events 3, dupes 1', () => {
  const ev = [click(0), net(100, { url: `${U}api/orders/41?x=1` }), net(5000, { url: `${U}api/orders/77?x=2` }), logline(6000)];
  assert.deepEqual(problemCounts(ev), { groups: 2, events: 3, dupes: 1 });
});

test('the hook\'s folded repeats are events, not groups', () => {
  const ev = [net(0), { kind: 'rep', ofKind: 'net', method: 'POST', url: `${U}api/orders`, status: 500, n: 7, ts: T0 + 900 }];
  assert.deepEqual(problemCounts(ev), { groups: 1, events: 8, dupes: 7 });
});

test('a quiet session, an empty list and null are all 0', () => {
  for (const v of [[click(0)], [], null, undefined]) assert.deepEqual(problemCounts(v), { groups: 0, events: 0, dupes: 0 });
});

test('hidden notes and requests the tester sent by hand are not problems', () => {
  const ev = [net(0, { via: 'api' }), net(10, { overridden: true }), { kind: 'pageerror', text: 'ResizeObserver loop completed with undelivered notifications.', ts: T0 + 20, frameUrl: U }, logline(30, { text: 'Warning: Each child should have a key' })];
  assert.equal(problemCounts(ev).groups, 0);
});

test('a group marked "Not a bug" is still counted (demote is not delete)', () => {
  const ev = [net(0), { kind: 'expected', forKey: 'net|POST|app.test/api/orders|500', ts: T0 + 50 }];
  assert.deepEqual(problemCounts(ev), { groups: 1, events: 1, dupes: 0 });
});

test('the order of events does not change the answer', () => {
  const ev = [net(0), logline(10), net(20, { url: `${U}api/orders/9` })];
  assert.deepEqual(problemCounts([...ev].reverse()), problemCounts(ev));
});

test('the Markdown "Problems" row prints groups, the same number', () => {
  const ev = [click(0), net(100), net(200), logline(300)];
  const md = buildMarkdown({ id: 's1', charter: 'Pay', startedAt: T0 - 1000, endedAt: T0 + 5000, startUrl: U, env: {} }, ev);
  assert.match(md, new RegExp(`\\| Problems \\| ${problemCounts(ev).groups} \\|`));
  assert.equal(problemCounts(ev).groups, 2);
});

test('D5: Markdown row, Raw JSON `problems`, session.json `totals.problems` and the agent handoff print one number (2 groups, 1 duplicate, 3 tool findings)', () => {
  const tools = [{ kind: 'a11y', total: 2, byImpact: {}, violations: [], ts: T0 + 400, frameUrl: U }, { kind: 'links', broken: [{ href: `${U}x` }], redirected: [], slow: [], ts: T0 + 410, frameUrl: U }];
  const ev = [click(0), net(100, { url: `${U}api/orders/41?x=1` }), net(5000, { url: `${U}api/orders/77?x=2` }), logline(6000), ...tools];
  const session = { id: 's1', charter: 'Pay', startedAt: T0 - 1000, endedAt: T0 + 9000, startUrl: U, env: {} };
  const want = problemCounts(ev).groups;
  assert.equal(want, 2);
  assert.match(buildMarkdown(session, ev), new RegExp(`\\| Problems \\| ${want} \\|`));
  const raw = JSON.parse(buildJson(session, ev));
  assert.equal(raw.problems, want, 'Raw JSON problems');
  assert.equal(raw.problemsBreakdown.occurrences, 3, 'the occurrence count is labelled, not the headline');
  assert.equal(raw.problemsBreakdown.toolFindings, 3, 'tool findings stay their own labelled field');
  assert.equal(JSON.parse(buildAgentBrief(session, ev)).signal.problems, want, 'agent handoff');
  assert.equal(JSON.parse(buildSessionJson(session, ev)).totals.problems, want, 'session.json');
});

test('ui-1016 L: the report body headline and the Findings row agree with Problems (report1.md shape: a third-party beacon failing twice + two first-party 500s: 4 failures, 3 problems, 2 first-party)', () => {
  const login = 'https://the-internet.herokuapp.com/login';
  const session = { id: 's9', charter: 'Broken requests', startedAt: T0 - 1000, endedAt: T0 + 400_000, startUrl: login, env: {} };
  const beacon = { kind: 'net', method: 'GET', url: 'https://298279967.log.optimizely.com/event?a=1', status: 0, error: true, errorText: 'network error', ts: T0 + 100, frameUrl: login, durationMs: 15 };
  const broken = (at) => ({ kind: 'net', method: 'POST', url: 'https://the-internet.herokuapp.com/authenticate', status: 500, ts: T0 + at, frameUrl: login, durationMs: 1 });
  const ev = [click(0), beacon, { ...beacon, ts: T0 + 150 }, broken(200), { ...broken(300), method: 'GET', url: 'https://the-internet.herokuapp.com/status_codes/500' }];
  assert.ok(countFindings(ev, { session }).failures < problemCounts(ev).groups, JSON.stringify([countFindings(ev, { session }), problemCounts(ev)]) + 'the fixture must make the old headline disagree');
  const problems = problemCounts(ev).groups;
  assert.ok(problems >= 3, `fixture should hold at least 3 groups, has ${problems}`);
  const md = buildMarkdown(session, ev);
  assert.match(md, new RegExp(`\| Problems \| ${problems} \|`));
  assert.match(md, new RegExp(`\| Findings \| ${problems} \|`), 'Findings row is the problem count when no tool finding exists');
  assert.match(md, new RegExp(`\n${problems} failed requests or errors\.\n`), 'the body headline uses the same number');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
