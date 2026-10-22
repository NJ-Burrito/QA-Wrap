/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * One rule for "what caused this failure", proved to be one rule.
 *
 *   node tools/test-correlate.mjs
 *
 * ── the fault this closes ─────────────────────────────────────────────────
 *
 * `isFailure` and `correlate` were written three times: once in `core/`, once
 * in `report/report.js` and once in `devtools/panel.js`. The two copies were
 * not laziness — both files are classic scripts in extension pages, and a
 * classic script cannot `import` — but the consequence was that one session
 * could be described three ways, and the description that reached the
 * developer was whichever surface the tester happened to export from. Drift
 * between them is invisible: nothing throws, the numbers just disagree.
 *
 * So this suite does two things a fixture alone cannot. It exercises the one
 * implementation against the union of the cases the three call sites cared
 * about, and it reads the two page sources back and refuses to let a second
 * definition reappear in either. The source assertion is the one that would
 * have caught the original triplication, and it is the same technique
 * `tools/test-report.mjs` already uses to pin the charts' dynamic import.
 *
 * No Chrome, no DOM: node:assert, plain objects, and two files read as text.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  correlate,
  isFailure,
  setCausalWindowMs,
  causalWindowMs,
  DEFAULT_CAUSAL_WINDOW_MS,
} from '../core/correlate.js';
import * as artifact from '../core/artifact.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_757_000_000_000;
const A = 'https://app.test/apply';
const B = 'https://widget.other/pay';

const click = (at, frameUrl = A) => ({ kind: 'dom', action: 'click', label: 'Submit', ts: T0 + at, frameUrl });
const net = (at, over = {}) => ({ kind: 'net', method: 'POST', url: '/api/x', status: 500, ts: T0 + at, frameUrl: A, ...over });
const logline = (at, over = {}) => ({ kind: 'console', level: 'error', text: 'boom', ts: T0 + at, frameUrl: A, ...over });

console.log('\ncorrelate.js — what counts as a failure');

test('the three failing kinds, and only those', () => {
  assert.equal(isFailure(net(0)), true, 'a 500 is a failure');
  assert.equal(isFailure(net(0, { status: 404 })), true);
  assert.equal(isFailure(net(0, { status: 200, error: true })), true, 'a network error with no status is a failure');
  assert.equal(isFailure(net(0, { status: 200 })), false);
  assert.equal(isFailure(net(0, { status: 302 })), false, 'a redirect is not a failure');
  assert.equal(isFailure(logline(0)), true);
  assert.equal(isFailure(logline(0, { level: 'assert' })), true);
  assert.equal(isFailure(logline(0, { level: 'warn' })), false);
  assert.equal(isFailure({ kind: 'pageerror', ts: T0 }), true);
  assert.equal(isFailure({ kind: 'rtl', ts: T0 }), false, 'a layout finding is not a failure by this rule');
  assert.equal(isFailure(null), false, 'a missing event must not throw');
});

console.log('\ncorrelate.js — chains');

test('a failure is attributed to the click just before it', () => {
  const [chain] = correlate([click(0), net(300)]);
  assert.equal(chain.trigger.action, 'click');
  assert.equal(chain.gapMs, 300);
  assert.equal(chain.confidence, 'high', 'same frame, well inside 1500ms');
});

test('a same-frame action beats a more recent one from another frame', () => {
  const chains = correlate([click(0, A), click(100, B), net(300, { frameUrl: A })]);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].trigger.ts, T0, 'the older same-frame click wins');
});

test('a cross-frame attribution is offered, and marked low', () => {
  const [chain] = correlate([click(0, B), net(300, { frameUrl: A })]);
  assert.equal(chain.trigger.frameUrl, B);
  assert.equal(chain.confidence, 'low');
});

test('D-1010-98: a click in another tab does not explain a failure (tabId), events without a tabId are unchanged', () => {
  const [other] = correlate([{ ...click(0), tabId: 1 }, net(300, { tabId: 2 })]);
  assert.equal(other.trigger, null, 'a tab-1 click is not the cause of a tab-2 failure');
  assert.equal(other.confidence, 'none');
  const [same] = correlate([{ ...click(0), tabId: 2 }, net(300, { tabId: 2 })]);
  assert.equal(same.confidence, 'high');
  const [legacy] = correlate([click(0), net(300)]);
  assert.equal(legacy.confidence, 'high', 'no tabId on either event: as before');
});

test('D-1010-98 / D-1010-127: same origin + same path (query or hash differs) stays high; a different path or origin is another frame; frameId wins when both carry one', () => {
  const [spa] = correlate([click(0, 'https://app.test/apply'), net(300, { frameUrl: 'https://app.test/apply?step=2#top' })]);
  assert.equal(spa.confidence, 'high', 'query and hash are not part of the frame identity');
  const [samePathSpa] = correlate([{ ...click(0, 'https://app.test/apply'), frameId: 0 }, net(300, { frameUrl: 'https://app.test/apply/step-2', frameId: 0 })]);
  assert.equal(samePathSpa.confidence, 'high', 'a SPA pushState keeps the browser frameId, so it stays one frame');
  const [samePath] = correlate([click(0, 'https://f.test/inner'), net(300, { frameUrl: 'https://f.test/top' })]);
  assert.equal(samePath.confidence, 'low', 'D-1010-127: same host, different path is a different frame');
  const [oneSided] = correlate([click(0, A), net(300, { frameUrl: null })]);
  assert.equal(oneSided.confidence, 'low', 'D-1010-127: a URL on one side only is not the same frame');
  const [neither] = correlate([click(0, null), net(300, { frameUrl: null })]);
  assert.equal(neither.confidence, 'high', 'D-1010-127: no URL on either side counts as the same frame');
  const [mixed] = correlate([
    { kind: 'dom', action: 'click', label: 'in-frame', ts: T0, frameUrl: 'https://f.test/inner' },
    { kind: 'dom', action: 'click', label: 'top', ts: T0 + 100, frameUrl: 'https://f.test/top' },
    net(300, { frameUrl: 'https://f.test/inner' }),
  ]);
  assert.equal(mixed.trigger.label, 'in-frame', 'same host, different path: the same-frame trigger still wins');
  const [cross] = correlate([click(0, B), net(300, { frameUrl: A })]);
  assert.equal(cross.confidence, 'low');
  const [sameId] = correlate([{ ...click(0, B), frameId: 3 }, net(300, { frameUrl: A, frameId: 3 })]);
  assert.equal(sameId.confidence, 'high', 'the browser frameId is the identity when both events carry one');
  const [diffId] = correlate([{ ...click(0, A), frameId: 0 }, net(300, { frameUrl: A, frameId: 5 })]);
  assert.equal(diffId.confidence, 'low');
});

test('failures that fire together on one trigger are one incident', () => {
  const chains = correlate([click(0), net(300), logline(400), logline(1000)]);
  assert.equal(chains.length, 2, 'the two within 250ms merge, the late one does not');
  assert.equal(chains[0].siblings.length, 1);
  assert.equal(chains[1].siblings.length, 0);
});

test('a failure with nothing in the window is reported, not dropped', () => {
  const [chain] = correlate([click(0), net(9000)]);
  assert.equal(chain.trigger, null);
  assert.equal(chain.gapMs, null);
  assert.equal(chain.confidence, 'none');
});

test('the causal window is data, per call', () => {
  assert.equal(correlate([click(0), net(8000)])[0].trigger, null, 'outside the default 5s');
  assert.equal(correlate([click(0), net(8000)], 10000)[0].trigger.ts, T0, 'inside a widened window');
});

test('a slow failing request is blamed on the click that started it (05-1)', () => {
  // The 500 lands at +7000 after a 6800 ms request: it began at +200, not +7000.
  const [chain] = correlate([click(0), click(6900), net(7000, { durationMs: 6800 })]);
  assert.equal(chain.trigger.ts, T0, 'the click at 0, not the later click at 6900');
  assert.equal(chain.startGapMs, 200, 'the click preceded the request start by 200 ms');
  assert.equal(chain.gapMs, 7000, 'gapMs stays the elapsed time to the failure (surfaces say "N ms earlier")');
  assert.equal(chain.confidence, 'high', 'a request started right after the click is a confident link');
  const [guarded] = correlate([click(0), net(300, { durationMs: -5 })]);
  assert.equal(guarded.trigger.ts, T0, 'a nonsense duration falls back to the response time');
  const [huge] = correlate([click(0), net(300, { durationMs: 9e9 })]);
  assert.equal(huge.trigger.ts, T0, 'an absurd duration falls back to the response time');
});

test('the module default can be primed, and rubbish is refused', () => {
  try {
    assert.equal(setCausalWindowMs(10000), 10000);
    assert.equal(causalWindowMs(), 10000);
    assert.equal(correlate([click(0), net(8000)])[0].trigger.ts, T0);
    assert.equal(setCausalWindowMs('nonsense'), DEFAULT_CAUSAL_WINDOW_MS, 'a bad value gets the documented default, never an invented one');
    assert.equal(setCausalWindowMs(40), DEFAULT_CAUSAL_WINDOW_MS, 'below the range');
    assert.equal(setCausalWindowMs(999999), DEFAULT_CAUSAL_WINDOW_MS, 'above the range');
  } finally {
    setCausalWindowMs(DEFAULT_CAUSAL_WINDOW_MS);
  }
});

console.log('\ncorrelate.js — one implementation, not three');

test('core/artifact.js re-exports it rather than redefining it', () => {
  assert.equal(artifact.correlate, correlate, 'the same function object, not a copy');
  assert.equal(artifact.isFailure, isFailure);
  assert.ok(
    !/export function correlate\b/.test(read('core/artifact.js')),
    'core/artifact.js must not define correlate() again'
  );
});

/*
 * The two pages, read as text.
 *
 * A behavioural test cannot see a second definition: both copies were correct
 * on the day they were written, and would have passed every fixture above.
 * What is being defended is that there is only one of them, and that is a
 * property of the source.
 */
const REDEFINED = [
  [/status >= 400 && ev\.status < 600/, 'still spells out the failing status range from isFailure()'],
  [/level === 'error' \|\| ev\.level === 'assert'/, 'still spells out the failing console levels'],
  [/const domEvents = all\.filter/, 'still carries its own copy of correlate()'],
  [/const acts = all\.filter/, 'still carries its own copy of correlate()'],
  [/chains\.push\(\{/, 'still builds causal chains of its own'],
];

for (const file of ['report/report.js', 'devtools/panel.js']) {
  test(`${file} imports the rule instead of restating it`, () => {
    const src = read(file);
    assert.ok(
      /import\(\s*'\.\.\/core\/correlate\.js'\s*\)/.test(src),
      `${file} must pull the rule from core/correlate.js`
    );
    for (const [pattern, why] of REDEFINED) {
      assert.ok(!pattern.test(src), `${file} ${why}`);
    }
  });
}

test('the shared rule is awaited before either page renders', () => {
  assert.match(read('report/report.js'), /await rulesReady;/, 'report/report.js must await the import in boot()');
  assert.match(read('devtools/panel.js'), /await rulesReady;/, 'devtools/panel.js must await the import in boot()');
});

test('a back-dated settled input is the trigger, not the later click or key (r2-05-2)', () => {
  const key = (at, seq) => ({ kind: 'dom', action: 'keydown', key: 'Enter', ts: T0 + at, seq, frameUrl: A });
  const input = { kind: 'dom', action: 'input', value: 'x', ts: T0 + 1250, seq: 4, frameUrl: A };
  // arrival order: click, keydown, input (emitted after its debounce), failure
  const [chain] = correlate([{ ...click(1000), seq: 1 }, key(1300, 3), input, net(1280)]);
  assert.equal(chain.trigger.action, 'input', 'ts 1250 is the newest action at or before 1280');
});

test('equal timestamps fall back to seq order (r2-05-2)', () => {
  const a = { kind: 'dom', action: 'click', label: 'A', ts: T0 + 100, seq: 9, frameUrl: A };
  const b = { kind: 'dom', action: 'click', label: 'B', ts: T0 + 100, seq: 5, frameUrl: A };
  const [chain] = correlate([a, b, net(200)]);
  assert.equal(chain.trigger.label, 'A', 'higher seq is the later action');
});

// r10-05-3 (D-234) falsifier: is a slow first request misattributed to a quick second click? Measured: no. A net failure is
// compared by when it STARTED (ts - durationMs), so the click that began it wins, with no act or frameId needed. Pinned; bridge.js untouched.
test('r10-05-3: a request that resolves after 6 s is blamed on the first click, not on the second click at 2 s', () => {
  const first = { ...click(0), label: 'First' };
  const second = { ...click(2000), label: 'Second' };
  const slow = net(6100, { durationMs: 6000, act: 1 });          // started at +100 ms, inside click 1's act
  const [chain] = correlate([first, second, slow]);
  assert.equal(chain.trigger.label, 'First');
  assert.equal(chain.startGapMs, 100);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
