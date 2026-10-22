/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * REQ AUTO-5, data side (autopilot 1011, contract C1): "Not a bug" demotes a group to "marked expected by tester".
 * Demote is not delete: the group stays in the counts, the Markdown, the JSON and the AI brief, with the flag.
 * Also: the two event shapes the page sends pass `sanitiseEvent` and nothing else rides along.
 *
 *   node tools/test-not-a-bug.mjs
 */
import assert from 'node:assert/strict';
import { sanitiseEvent, EVENT_FIELDS } from '../core/events.js';
import { dupeKey, groupFailures, groupChains } from '../core/dupes.js';
import { correlate } from '../core/correlate.js';
import { problemCounts } from '../core/finding-count.js';
import { redact } from '../core/privacy.js';
import { buildMarkdown, buildJson } from '../core/artifact-docs.js';
import { buildAiBlock, buildSessionJson, autoLines } from '../core/ai-brief.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_791_724_838_000;
const U = 'https://app.test/';
const SESSION = { id: 's-nab', charter: 'Pay flow', startedAt: T0 - 1000, endedAt: T0 + 60_000, startUrl: U, env: { viewport: '1280x720' } };
const click = (at) => ({ kind: 'dom', action: 'click', label: 'Pay', locator: 'button', ts: T0 + at, frameUrl: U });
const net = (at, over = {}) => ({ kind: 'net', method: 'POST', url: `${U}api/orders`, status: 500, ts: T0 + at, frameUrl: U, durationMs: 40, ...over });
const logline = (at) => ({ kind: 'console', level: 'error', text: 'TypeError: x is undefined', ts: T0 + at, frameUrl: U });

const failA = net(300);
const keyA = dupeKey(failA);
const events = [click(0), failA, net(5000, { url: `${U}api/orders/9` }), click(8000), logline(8100)];
const marked = [...events, { kind: 'expected', forKey: keyA, ts: T0 + 9000 }];

console.log('\n"Not a bug" is a flag, not a removal');

test('C1: an expected event and an auto screenshot pass sanitiseEvent with only forKey / auto', () => {
  const e = sanitiseEvent({ kind: 'expected', forKey: keyA, sessionId: 'forged', fail: 1, extra: 'x' }, { frameUrl: U, now: T0 });
  assert.deepEqual(Object.keys(e).sort(), ['forKey', 'frameUrl', 'kind', 'ts']);
  const s = sanitiseEvent({ kind: 'screenshot', auto: true, forKey: keyA, captureId: 'forged' }, { frameUrl: U, now: T0 });
  assert.equal(s.auto, true);
  assert.equal(s.forKey, keyA);
  assert.equal(s.captureId, undefined, 'the page does not name a stored capture');
  assert.ok(EVENT_FIELDS.expected && EVENT_FIELDS.screenshot);
});

test('C1: forKey is cut at 200 characters and must be a string; an expected event without one marks nothing', () => {
  assert.equal(sanitiseEvent({ kind: 'expected', forKey: 'k'.repeat(900) }, { now: T0 }).forKey.length, 200);
  assert.equal('forKey' in sanitiseEvent({ kind: 'expected', forKey: { a: 1 } }, { now: T0 }), false);
  assert.equal(groupFailures([net(0), sanitiseEvent({ kind: 'expected' }, { now: T0 })]).filter((g) => g.expected).length, 0);
  assert.equal('auto' in sanitiseEvent({ kind: 'screenshot', auto: 'yes', forKey: 'k' }, { now: T0 }), false, 'auto is true or absent');
});

test('the group with that key is marked expected; the other group is not', () => {
  const g = groupFailures(marked);
  assert.equal(g.length, 3);
  assert.equal(g.find((x) => x.key === keyA).expected, true);
  assert.equal(g.filter((x) => x.expected).length, 1);
  assert.ok(groupFailures(events).every((x) => x.expected === undefined), 'no mark without the press');
});

test('an expected event for a key nobody has seen marks nothing and breaks nothing', () => {
  assert.equal(groupFailures([...events, { kind: 'expected', forKey: 'net|GET|nowhere|404', ts: T0 }]).filter((x) => x.expected).length, 0);
});

test('chains carry the flag into their group', () => {
  const g = groupChains(correlate(marked), marked);
  assert.equal(g.filter((x) => x.expected).length, 1);
});

test('counts are unchanged by the press (raw totals and groups)', () => {
  assert.deepEqual(problemCounts(marked), problemCounts(events));
  assert.equal(groupFailures(marked).reduce((n, g) => n + g.count, 0), groupFailures(events).reduce((n, g) => n + g.count, 0));
});

test('Markdown: the failure is still listed, with the flag, and the Problems row is unchanged', () => {
  const md = buildMarkdown(SESSION, marked);
  assert.match(md, /Marked expected by tester/);
  assert.match(md, /\*\*POST\*\* https:\/\/app\.test\/api\/orders → 500/);
  assert.equal(md.match(/\| Problems \| (\d+) \|/)[1], String(problemCounts(events).groups));
  assert.ok(!/Marked expected by tester/.test(buildMarkdown(SESSION, events).split('## Full timeline')[0]));
});

test('JSON: the events stay, the marked keys are listed', () => {
  const j = JSON.parse(buildJson(SESSION, marked));
  assert.deepEqual(j.markedExpected, [keyA]);
  assert.equal(j.events.filter((e) => e.kind === 'net').length, 2);
});

test('AI brief and session.json mirror the flag and keep the failure', () => {
  const block = buildAiBlock(SESSION, marked);
  assert.match(block, /POST https:\/\/app\.test\/api\/orders -> 500.*\(marked expected by tester\)/);
  const sj = JSON.parse(buildSessionJson(SESSION, marked));
  assert.equal(sj.failures.length, 3);
  assert.equal(sj.failures.filter((f) => f.expectedByTester).length, 1);
  assert.equal(sj.totals.failures, 3, 'raw totals still count it');
  assert.ok(!/marked expected/.test(buildAiBlock(SESSION, events)));
});

console.log('\nthe brief says what started by itself');

test('auto-start and auto-screenshot lines appear only when they happened', () => {
  assert.deepEqual(autoLines(SESSION, events), []);
  assert.ok(!/## Started by itself/.test(buildAiBlock(SESSION, events)));
  const shot = { kind: 'screenshot', auto: true, forKey: keyA, ts: T0 + 400 };
  const sess = { ...SESSION, autoStarted: true, stopReason: 'idle' };
  assert.deepEqual(autoLines(sess, [...events, shot]), ['auto-start: on for this site', 'screenshots on failure: on for this site', 'recording stopped by itself after 30 minutes without activity']);
  const block = buildAiBlock(sess, [...events, shot]);
  assert.match(block, /## Started by itself\n- auto-start: on for this site\n- screenshots on failure: on for this site/);
  assert.ok(!/screenshots \(none were taken\)/.test(block));
  assert.deepEqual(autoLines({ ...SESSION, autoStarted: true }, events), ['auto-start: on for this site']);
});

test('a failure whose text carried a secret still matches the press: both sides are compared after the same redact', () => {
  const raw = { kind: 'console', level: 'error', text: 'Login failed for jane@corp.example with token=sk_live_abcdefghijklmnop1234567890', ts: T0 + 100, frameUrl: U };
  const stored = { ...raw, text: redact(raw.text).text }; // what the worker kept
  const press = { kind: 'expected', forKey: dupeKey(raw), ts: T0 + 200 }; // what the page keyed, from the raw text
  const g = groupFailures([stored, press]);
  assert.equal(g.length, 1);
  assert.equal(g[0].expected, true);
  assert.equal(groupFailures([stored, { ...press, forKey: 'console|something else' }])[0].expected, undefined, 'a different key still does not match');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
