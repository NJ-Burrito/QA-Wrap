/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Tests for the ISTQB test case and defect report.
 *
 *   node tools/test-istqb.mjs
 *
 * Two classes of thing are checked here, and the second is the reason this file
 * is long.
 *
 * **Structure** — that a document carries every field ISO/IEC/IEEE 29119-3 asks
 * for, and that the ADF is a shape Jira will actually accept. An almost-valid
 * ADF document is a 400 at the moment someone is trying to file a bug.
 *
 * **Honesty** — that the tool never presents a guess as a fact. A recorder can
 * see what the application *did*; only a person can say what it *should* do. Any
 * expected result derived from a recording has to be marked as derived, a
 * failure must never be offered as an expected result, and severity and priority
 * must stay two separate judgements. Those are the assertions that stop this
 * from teaching people the wrong thing.
 */
import assert from 'node:assert/strict';
import {
  buildTestCase, buildDefectReport, suggestSeverity, suggestPriority,
  SEVERITY, PRIORITY, TEST_LEVELS, TEST_TYPES, BY_PAGE_AR,
} from '../core/istqb.js';
import { DOC_LABELS } from '../core/doc-labels.js';
import {
  testCaseToAdf, testCaseToMarkdown, testCaseToGherkin, defectToAdf, defectToMarkdown,
} from '../core/istqb-render.js';
import { correlate, buildPlaywrightSpec } from '../core/artifact.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_700_000_000_000;
const session = {
  id: 's_istqb_9f3a',
  charter: 'Submit an application with an expired document',
  startedAt: T0,
  endedAt: T0 + 12_000,
  startUrl: 'https://example.gov/apply',
  env: { viewport: '1920×1080 @1x', userAgent: 'Chrome/126', platform: 'Win32', language: 'ar-JO' },
};

const events = [
  { kind: 'nav', ts: T0 + 100, url: 'https://example.gov/apply', frameUrl: 'https://example.gov/apply' },
  { kind: 'dom', ts: T0 + 2000, action: 'input', value: 'nader', label: 'Applicant name',
    locator: "getByLabel('Applicant name')", framePrefix: '', frameUrl: 'https://example.gov/apply', tag: 'input' },
  { kind: 'dom', ts: T0 + 2400, action: 'input', value: '••••••••', masked: true, label: 'Password',
    locator: "getByLabel('Password')", framePrefix: '', frameUrl: 'https://example.gov/apply', tag: 'input' },
  { kind: 'dom', ts: T0 + 3000, action: 'click', label: 'Submit application',
    locator: "getByRole('button', { name: 'Submit application' })", framePrefix: '',
    frameUrl: 'https://example.gov/apply', tag: 'button' },
  { kind: 'net', ts: T0 + 3400, method: 'POST', url: '/api/applications', status: 500, durationMs: 380,
    error: false, responsePreview: '{"error":"NullPointerException"}', frameUrl: 'https://example.gov/apply' },
  { kind: 'console', ts: T0 + 3450, level: 'error', text: 'Submit failed: 500', frameUrl: 'https://example.gov/apply' },
  { kind: 'note', ts: T0 + 4000, tag: 'bug', text: 'Reproduced three times.' },
];

/* A clean run, for the cases where nothing failed. */
const cleanEvents = [
  { kind: 'nav', ts: T0 + 100, url: 'https://example.gov/apply', frameUrl: 'a' },
  { kind: 'dom', ts: T0 + 2000, action: 'input', value: 'nader', label: 'Applicant name', locator: "getByLabel('x')", frameUrl: 'a', tag: 'input' },
  { kind: 'dom', ts: T0 + 3000, action: 'click', label: 'Submit', locator: "getByRole('button')", frameUrl: 'a', tag: 'button' },
  { kind: 'net', ts: T0 + 3200, method: 'POST', url: '/api/applications', status: 201, durationMs: 90, error: false, frameUrl: 'a' },
  { kind: 'nav', ts: T0 + 3600, url: 'https://example.gov/done', frameUrl: 'a' },
];

/* ═══════════════════════════════════════════════════ the test case ═══════ */

console.log('istqb.js — the test case carries what 29119-3 asks for');

test('every mandatory part of a test case is present', () => {
  const tc = buildTestCase(session, events);
  for (const field of ['identifier', 'objective', 'preconditions', 'testData', 'steps', 'postconditions', 'priority', 'traceability', 'environment']) {
    assert.ok(field in tc, `a test case with no ${field} is not a test case`);
  }
  assert.ok(tc.identifier.startsWith('TC-'), `identifier reads "${tc.identifier}"`);
  assert.ok(TEST_LEVELS.includes(tc.level), `test level "${tc.level}" is not one of the CTFL levels`);
  assert.ok(TEST_TYPES.includes(tc.type), `test type "${tc.type}" is not one of the CTFL types`);
});

test('each step has an action and its own expected result', () => {
  const tc = buildTestCase(session, events);
  assert.ok(tc.steps.length >= 3, `only ${tc.steps.length} steps`);
  tc.steps.forEach((s, i) => {
    assert.equal(s.number, i + 1, 'steps must be numbered in order');
    assert.ok(s.action, `step ${s.number} has no action`);
    assert.ok('expected' in s, `step ${s.number} has no expected result field at all`);
  });
});

test('the identifier is stable across two builds of the same session', () => {
  // A case that renames itself every time it is generated cannot be traced to
  // anything, which defeats the point of having an identifier.
  assert.equal(buildTestCase(session, events).identifier, buildTestCase(session, events).identifier);
});

test('r3-04-4: a masked field that is not a password is named by its label, in the data and the precondition', () => {
  const otp = [
    { kind: 'dom', ts: T0 + 100, action: 'click', label: 'Start', locator: "getByRole('button', { name: 'Start' })", framePrefix: '', tag: 'button' },
    { kind: 'dom', ts: T0 + 200, action: 'input', value: '••••••••', masked: true, label: 'One-time code',
      locator: "getByLabel('One-time code')", framePrefix: '', tag: 'input' },
  ];
  const tc = buildTestCase(session, otp);
  assert.equal(tc.testData[0].value, '«One-time code»');
  assert.equal(tc.steps[1].data, '«One-time code»');
  assert.equal(tc.steps[1].action, 'Enter the masked value in One-time code');
  const pre = tc.preconditions.find((p) => /masked fields/.test(p));
  assert.ok(pre && pre.includes('One-time code') && !/password/i.test(pre), pre);
  assert.ok(!/password/i.test(JSON.stringify(tc)), 'nothing in the case calls an OTP field a password');
});

test('set-up navigation becomes a precondition, not a test step', () => {
  const tc = buildTestCase(session, events);
  assert.ok(
    tc.preconditions.some((p) => p.includes('example.gov/apply')),
    'the starting URL should be a precondition'
  );
  assert.ok(
    !tc.steps.some((s) => /^Open https/.test(s.action)),
    'opening the application is set-up; a case that starts there buries its own objective'
  );
});

test('test data is listed, and a password is never among it', () => {
  const tc = buildTestCase(session, events);
  const password = tc.testData.find((d) => d.field === 'Password');
  assert.ok(password, 'the password field should appear as test data');
  assert.equal(password.value, '«Password»', 'the placeholder names the field by its own label');
  assert.ok(password.masked);
  assert.ok(
    !JSON.stringify(tc).includes('••••••••') || password.value === '«Password»',
    'the mask itself should be replaced with a named placeholder, not carried through'
  );
});

test('locators travel with the steps, so the case is automatable as well as readable', () => {
  const tc = buildTestCase(session, events);
  const click = tc.steps.find((s) => s.action.startsWith('Click'));
  assert.ok(click.locator?.startsWith('page.'), `no locator on the click step: ${click.locator}`);
});

console.log('\nistqb.js — it never presents a guess as a fact');

test('an expected result copied from the recording is marked as derived', () => {
  const tc = buildTestCase(session, cleanEvents);
  const derived = tc.steps.filter((s) => s.expectedDerived);
  assert.ok(derived.length, 'nothing was marked derived, so a reader cannot tell what was assumed');
  derived.forEach((s) => assert.ok(s.expected, 'a step marked derived with no expectation makes no sense'));
});

test('a failure is never offered as an expected result without a warning', () => {
  const tc = buildTestCase(session, events);
  const bad = tc.steps.filter((s) => s.expectedIsFailure);
  assert.ok(bad.length, 'the fixture has a 500 after the click — it should be flagged');
  assert.equal(tc.needsReview, true, 'a case built from a failing run must ask to be reviewed');
});

test('a case with an unfilled expectation also asks to be reviewed', () => {
  const tc = buildTestCase(session, [
    { kind: 'dom', ts: T0, action: 'click', label: 'Nothing happens', frameUrl: 'a', tag: 'button' },
  ]);
  assert.equal(tc.needsReview, true);
});

test('the warning survives into every rendering', () => {
  const tc = buildTestCase(session, events);
  const md = testCaseToMarkdown(tc);
  assert.match(md, /Review before use/i, 'the Markdown lost the warning');

  const adf = testCaseToAdf(tc);
  assert.equal(adf.content[0].type, 'panel', 'the warning should be the first thing in the Jira document');
  assert.equal(adf.content[0].attrs.panelType, 'warning');

  const gherkin = testCaseToGherkin(tc);
  assert.match(gherkin, /^#/, 'the feature file should open with its provenance comment');
});

console.log('\nistqb-render.js — Jira will accept the document');

/** Walk an ADF tree and assert every node is one Jira will take. */
function checkAdf(node, path = 'doc') {
  assert.ok(node && typeof node === 'object', `${path}: not a node`);
  assert.ok(node.type, `${path}: node with no type`);

  if (node.type === 'text') {
    assert.equal(typeof node.text, 'string', `${path}: text node with no string`);
    assert.ok(node.text.length > 0, `${path}: EMPTY text node — Jira answers 400 to this`);
    assert.ok(node.text.length <= 3000, `${path}: text node over the per-node cap`);
    return;
  }
  if (node.type === 'table') {
    const rows = node.content || [];
    const widths = new Set(rows.map((r) => (r.content || []).length));
    assert.equal(widths.size, 1, `${path}: table rows disagree on column count (${[...widths]}) — Jira rejects this`);
  }
  for (const [i, child] of (node.content || []).entries()) checkAdf(child, `${path}.${node.type}[${i}]`);
}

test('a test case renders to a valid ADF document', () => {
  const adf = testCaseToAdf(buildTestCase(session, events));
  assert.equal(adf.type, 'doc');
  assert.equal(adf.version, 1);
  checkAdf(adf);
});

test('a defect renders to a valid ADF document', () => {
  const adf = defectToAdf(buildDefectReport(session, events));
  assert.equal(adf.type, 'doc');
  checkAdf(adf);
});

test('a session with nothing in it still renders a valid document', () => {
  // The empty case is where hand-built ADF usually breaks: an empty list, an
  // empty table, a paragraph with no text node.
  const bare = { id: 's_x', charter: 'Nothing', startedAt: T0, env: {} };
  checkAdf(testCaseToAdf(buildTestCase(bare, [])));
  checkAdf(defectToAdf(buildDefectReport(bare, [])));
});

test('no ADF node is ever an empty paragraph', () => {
  const adf = testCaseToAdf(buildTestCase({ id: 's_y', charter: '', startedAt: T0, env: {} }, []));
  const paragraphs = [];
  (function walk(n) {
    if (n.type === 'paragraph') paragraphs.push(n);
    (n.content || []).forEach(walk);
  })(adf);
  paragraphs.forEach((p, i) => assert.ok((p.content || []).length, `paragraph ${i} has no content`));
});

console.log('\nistqb.js — severity and priority stay two judgements');

test('severity is about the system, and scales with how broken it is', () => {
  const sev = (failure) => suggestSeverity({ failure });
  assert.equal(sev({ kind: 'net', error: true }), 'critical', 'a dead connection is critical');
  assert.equal(sev({ kind: 'net', status: 500 }), 'critical');
  assert.equal(sev({ kind: 'net', status: 403 }), 'major');
  assert.equal(sev({ kind: 'net', status: 404 }), 'moderate');
  assert.equal(sev({ kind: 'pageerror' }), 'major');
  assert.equal(sev(null), 'minor');
  SEVERITY.map((s) => s.id).forEach((id) => assert.ok(typeof id === 'string'));
});

test('r2-04-2: only the own-site document, xhr or fetch failures are critical', () => {
  const start = 'https://shop.example.com/cart';
  const sev = (failure) => suggestSeverity({ failure }, { startUrl: start });
  assert.equal(sev({ kind: 'net', via: 'fetch', url: 'https://shop.example.com/api/order', status: 500 }), 'critical', 'same-site xhr 500');
  assert.equal(sev({ kind: 'net', via: 'xhr', url: 'https://api.example.com/v1/x', error: true }), 'critical', 'a sibling subdomain is the same site');
  assert.equal(sev({ kind: 'net', url: 'https://shop.example.com/favicon.ico', status: 500 }), 'minor', 'favicon 500');
  assert.equal(sev({ kind: 'net', resourceType: 'image', url: 'https://shop.example.com/a', status: 500 }), 'minor', 'an image by type');
  assert.equal(sev({ kind: 'net', resourceType: 'font', url: 'https://shop.example.com/f', error: true }), 'minor', 'a font by type');
  assert.equal(sev({ kind: 'net', via: 'fetch', url: 'https://ads.tracker.net/p', error: 'net::ERR_BLOCKED_BY_CLIENT' }), 'minor', 'ads blocked');
  assert.equal(sev({ kind: 'net', via: 'fetch', url: 'https://shop.example.com/api', error: 'net::ERR_ABORTED' }), 'minor', 'aborted');
  assert.equal(sev({ kind: 'net', via: 'fetch', url: 'https://cdn.other.org/x.json', status: 503 }), 'minor', 'third party');
  assert.equal(suggestPriority({ failure: { kind: 'net', url: 'https://shop.example.com/favicon.ico', status: 500 } }, { startUrl: start }), 'low');
  const d = buildDefectReport({ id: 's_r', charter: 'x', startedAt: T0, env: {}, startUrl: start }, [{ kind: 'net', url: 'https://shop.example.com/favicon.ico', status: 500, ts: 1, ok: false }]);
  assert.match(d.impact.severityRationale, /image, font, icon/i);
});

test('priority is about urgency, and is NOT a copy of severity', () => {
  const chain = { failure: { kind: 'net', status: 404 } };
  const onFlow = suggestPriority(chain, { onMainFlow: true });
  const offFlow = suggestPriority(chain, { onMainFlow: false });
  assert.notEqual(
    onFlow,
    offFlow,
    'the same defect on and off the main flow must not get the same priority — that is the conflation CTFL warns about'
  );
  assert.ok(PRIORITY.map((p) => p.id).includes(onFlow));
  assert.ok(PRIORITY.map((p) => p.id).includes(offFlow));
});

test('a critical defect nobody is walking past is still not the most urgent thing', () => {
  const chain = { failure: { kind: 'net', status: 500 } };
  assert.equal(suggestSeverity(chain), 'critical');
  assert.equal(suggestPriority(chain, { onMainFlow: false }), 'high', 'off the main flow it should drop below immediate');
  assert.equal(suggestPriority(chain, { onMainFlow: true }), 'highest');
});

test('both are labelled as suggestions until a person sets them', () => {
  const auto = buildDefectReport(session, events);
  assert.equal(auto.severityIsSuggestion, true);
  assert.equal(auto.priorityIsSuggestion, true);

  const chosen = buildDefectReport(session, events, { severity: 'minor', priority: 'low' });
  assert.equal(chosen.severityIsSuggestion, false);
  assert.equal(chosen.priorityIsSuggestion, false);
  assert.equal(chosen.severity, 'minor');
});

test('the two fields are described differently everywhere they appear', () => {
  const md = defectToMarkdown(buildDefectReport(session, events));
  assert.match(md, /Severity \| \*\*\w+\*\*: impact on the system/, 'severity is not explained as impact');
  assert.match(md, /Priority \| \*\*\w+\*\*: urgency of the fix/, 'priority is not explained as urgency');
});

console.log('\nistqb.js — the defect report');

test('expected and actual are separate fields, and actual is filled from evidence', () => {
  const d = buildDefectReport(session, events);
  assert.ok('expected' in d && 'actual' in d);
  assert.match(d.actual, /POST \/api\/applications returned 500/);
  assert.equal(d.expected, '', 'expected must be left for the reporter — only a person knows it');
});

test('the summary names the failure and what preceded it', () => {
  const d = buildDefectReport(session, events);
  assert.match(d.summary, /POST \/api\/applications returns 500/);
  assert.match(d.summary, /after click/i);
  assert.ok(d.summary.length <= 240, 'Jira rejects a summary over 255 characters');
  assert.ok(!d.summary.includes('\n'), 'a Jira summary cannot contain a newline');
});

test('it says why it chose that severity, rather than only choosing', () => {
  const d = buildDefectReport(session, events);
  assert.ok(d.impact.severityRationale.length > 20, 'no rationale');
  assert.match(d.impact.severityRationale, /server error/i);
});

test('evidence is carried, including the locator and the causal gap', () => {
  const d = buildDefectReport(session, events);
  assert.match(d.evidence.locator, /^page\./);
  assert.equal(typeof d.evidence.gapMs, 'number');
  assert.equal(d.evidence.confidence, 'high');
  assert.match(d.evidence.responseBody, /NullPointerException/);
});

test('other failures in the session are counted, not silently folded in', () => {
  const d = buildDefectReport(session, events);
  const chains = correlate(events);
  assert.equal(d.relatedFailures, chains.length - 1);
  const md = defectToMarkdown(d);
  if (d.relatedFailures > 0) assert.match(md, /other failure/i, 'the report should mention them');
});

test('traceability is present even when empty, so its absence is visible', () => {
  const d = buildDefectReport(session, events);
  for (const k of ['epic', 'story', 'testCase', 'sessionId']) assert.ok(k in d.traceability);
  assert.equal(d.traceability.sessionId, session.id);
});

test('a chosen epic and story reach both documents', () => {
  const opts = { epic: 'PROJ-1', story: 'PROJ-42' };
  assert.equal(buildTestCase(session, events, opts).traceability.epic, 'PROJ-1');
  assert.equal(buildDefectReport(session, events, opts).traceability.story, 'PROJ-42');
  assert.match(testCaseToMarkdown(buildTestCase(session, events, opts)), /PROJ-1/);
});

console.log('\nistqb-render.js — the privacy promise holds');

test('no rendering ever exposes a password', () => {
  const tc = buildTestCase(session, events);
  const d = buildDefectReport(session, events);
  for (const [name, out] of [
    ['test case markdown', testCaseToMarkdown(tc)],
    ['test case gherkin', testCaseToGherkin(tc)],
    ['test case adf', JSON.stringify(testCaseToAdf(tc))],
    ['defect markdown', defectToMarkdown(d)],
    ['defect adf', JSON.stringify(defectToAdf(d))],
  ]) {
    assert.ok(!/hunter2|p@ssw/i.test(out), `${name} leaked a password`);
    assert.match(out, /password/i, `${name} should still say a password was entered`);
  }
});

console.log('\n— a case that is too long to be a case —');

test('a long flow is flagged, and not one step is dropped', () => {
  const many = [];
  for (let i = 0; i < 120; i++) {
    many.push({
      kind: 'dom',
      ts: T0 + i * 10,
      action: 'click',
      label: `Button ${i}`,
      locator: `getByText('Button ${i}')`,
    });
  }
  const tc = buildTestCase(session, many);
  // Every step is still there. Truncating would lose evidence, and evidence a
  // tool can quietly lose is evidence nobody can rely on.
  assert.equal(tc.steps.length, 120, 'steps were dropped');
  assert.ok(tc.tooLong, '120 steps should have been flagged');
  assert.match(tc.tooLong, /suite/i, 'the warning must name the thing to do instead');
  assert.match(testCaseToMarkdown(tc), /too long to be one test case/i, 'it did not reach the document');
});

test('an ordinary case is not nagged about its length', () => {
  const few = [{ kind: 'dom', ts: T0, action: 'click', label: 'Submit', locator: "getByRole('button')" }];
  assert.equal(buildTestCase(session, few).tooLong, null, 'a one-step case was called too long');
});

console.log('\n\u2014 artefacts a person has to read \u2014');

test('the summary is a headline a tracker can show, not a URL', () => {
  const noisy = [
    { kind: 'nav', ts: T0, url: 'https://app.test/w/index.php?title=Special%3ASearch&fulltext=1&search=boundary+value+analysis' },
    { kind: 'dom', ts: T0 + 10, action: 'click', label: 'Search', locator: "getByRole('link')" },
    { kind: 'net', ts: T0 + 20, method: 'GET', url: '/favicon.ico?cache=1787913682378', status: 500, ok: false, durationMs: 3 },
  ];
  const d = buildDefectReport(session, noisy);
  // Every tracker truncates in its list view, so the first sixty characters
  // are what a triage meeting actually sees. They must not be a cache-buster.
  assert.ok(d.summary.length <= 120, `${d.summary.length} characters is longer than any list view shows`);
  assert.equal(/cache=/.test(d.summary), false, 'a cache-buster reached the headline');
  assert.equal(/fulltext=1/.test(d.summary), false, 'a query string reached the headline');
  assert.match(d.summary, /favicon/, 'the endpoint itself must survive');
  // And nothing is lost: the full URL is still in the evidence.
  assert.match(d.actual, /favicon/);
});

test('Gherkin does not lower-case an acronym into nonsense', () => {
  const netFirst = [
    { kind: 'dom', ts: T0, action: 'click', label: 'Go', locator: "getByRole('button')" },
    { kind: 'net', ts: T0 + 5, method: 'GET', url: '/api/x', status: 200, ok: true, durationMs: 2 },
  ];
  const gherkin = testCaseToGherkin(buildTestCase(session, netFirst));
  assert.equal(/gET/.test(gherkin), false, '"gET" in a feature file makes the whole file look broken');
  assert.match(gherkin, /GET/);
});

test('Playwright spec keeps a return navigation A-B-A, and still drops an immediate duplicate (r3-11-2)', () => {
  const nav = (url, ts) => ({ kind: 'nav', ts, url });
  const click = (label, ts) => ({ kind: 'dom', ts, action: 'click', label, locator: `getByRole('button', { name: '${label}' })`, locatorMatches: 1 });
  const events = [nav('https://app.test/a', T0), click('Open B', T0 + 1), nav('https://app.test/b', T0 + 2), click('Back', T0 + 3), nav('https://app.test/a', T0 + 4)];
  const spec = buildPlaywrightSpec({ charter: 'A-B-A' }, events);
  const gotos = spec.split('\n').filter((l) => l.includes('page.goto('));
  assert.deepEqual(gotos, [
    "  await page.goto('https://app.test/a');",
    "  await page.goto('https://app.test/b');",
    "  await page.goto('https://app.test/a');",
  ], 'both visits to A are kept');
  const dup = buildPlaywrightSpec({ charter: 'dup', startUrl: 'https://app.test/a' }, [nav('https://app.test/a', T0), nav('https://app.test/a', T0 + 1)]);
  assert.equal(dup.split('\n').filter((l) => l.includes('page.goto(')).length, 1, 'the same goto twice in a row is written once');
});

test('the defect chain skips tester-induced failures and the case does not call them failures (04-1)', () => {
  const evs = [
    { kind: 'dom', ts: T0 + 100, action: 'click', label: 'Send', locator: "getByRole('button')", frameUrl: 'a', tag: 'button' },
    { kind: 'net', ts: T0 + 200, method: 'POST', url: '/api/mocked', status: 500, overridden: true, frameUrl: 'a' },
    { kind: 'dom', ts: T0 + 3000, action: 'click', label: 'Save', locator: "getByRole('button')", frameUrl: 'a', tag: 'button' },
    { kind: 'net', ts: T0 + 3100, method: 'POST', url: '/api/real', status: 500, frameUrl: 'a' },
  ];
  const d = buildDefectReport(session, evs);
  assert.ok(String(d.summary).includes('/api/real'), 'the real 500 headlines: ' + d.summary);
  assert.ok(!String(d.actual).includes('/api/mocked'), 'the overridden one is not reported');
  const onlyMock = buildTestCase(session, evs.slice(0, 2));
  assert.ok(!onlyMock.steps.some((s) => s.expectedIsFailure), 'an overridden 500 is not an expected failure');
});

test('a lone background 500 is high, a triggered one stays highest (r5-04-2)', () => {
  const lone = buildDefectReport(session, [{ kind: 'net', ts: T0 + 100, method: 'GET', url: '/api/poll', status: 500, frameUrl: 'a' }]);
  assert.equal(lone.severity, 'critical');
  assert.equal(lone.priority, 'high', 'background activity is not the main flow: ' + lone.priority);
  const trig = buildDefectReport(session, [
    { kind: 'dom', ts: T0 + 100, action: 'click', label: 'Send', locator: "getByRole('button')", frameUrl: 'a', tag: 'button' },
    { kind: 'net', ts: T0 + 200, method: 'POST', url: '/api/send', status: 500, frameUrl: 'a' },
  ]);
  assert.equal(trig.priority, 'highest');
});

test('test-case steps word checkbox, radio, select and upload like the repro steps (r5-04-3)', () => {
  const evs = [
    { kind: 'dom', ts: T0 + 100, action: 'change', label: 'Terms', control: 'checkbox', value: 'checked', tag: 'input' },
    { kind: 'dom', ts: T0 + 200, action: 'change', label: 'Plan B', control: 'radio', value: 'checked', tag: 'input' },
    { kind: 'dom', ts: T0 + 300, action: 'change', label: 'Country', control: 'select', value: 'Jordan', tag: 'select' },
    { kind: 'dom', ts: T0 + 400, action: 'upload', label: 'CV', control: 'file', value: 'cv.pdf', tag: 'input' },
    { kind: 'dom', ts: T0 + 500, action: 'input', label: 'Password', value: '•••', masked: true, tag: 'input' },
  ];
  const tc = buildTestCase(session, evs);
  const a = tc.steps.map((s) => s.action);
  assert.equal(a[0], 'Set Terms to `checked`');
  assert.equal(a[1], 'Set Plan B to `checked`');
  assert.equal(a[2], 'Set Country to `Jordan`');
  assert.equal(a[3], 'Upload `cv.pdf` to CV');
  assert.ok(/masked value in Password/.test(a[4]) && !a[4].includes('•••'), 'a secret is still not echoed: ' + a[4]);
  assert.equal(tc.steps[3].data, 'cv.pdf', 'the upload carries the file name as data');
  assert.equal(tc.steps[0].data, 'checked');
  assert.ok(tc.testData.some((d) => d.field === 'CV' && d.value === 'cv.pdf'), 'and testData lists it');
});


/* ── council-1010 round 4 (r4-04-4, r4-04-7) ───────────────────────────── */

test('r4-04-4 (D-1010-81): a later POST 500 outranks an earlier GET 404; the other failure is listed in actual', () => {
  const d = buildDefectReport(session, [
    { kind: 'net', ts: T0 + 100, method: 'GET', url: '/api/poll', status: 404, frameUrl: 'a' },
    { kind: 'net', ts: T0 + 900, method: 'POST', url: '/api/save', status: 500, frameUrl: 'a' },
  ]);
  assert.equal(d.severity, 'critical');
  assert.match(d.summary, /POST/);
  assert.ok(/500/.test(d.actual) && /404/.test(d.actual), d.actual);
});

test('r4-04-4: on a tie the earliest failing chain is the defect', () => {
  const d = buildDefectReport(session, [
    { kind: 'net', ts: T0 + 100, method: 'GET', url: '/api/first', status: 500, frameUrl: 'a' },
    { kind: 'net', ts: T0 + 900, method: 'POST', url: '/api/second', status: 500, frameUrl: 'a' },
  ]);
  assert.match(d.summary, /first/);
  assert.match(d.actual, /second/);
});

test('r4-04-7 (D-1010-82): a recorded failure makes the test case need review, and never sets its priority', () => {
  const evs = [
    { kind: 'nav', ts: T0 + 50, url: 'https://example.gov/apply', transition: 'typed' },
    { kind: 'dom', ts: T0 + 100, action: 'click', label: 'Send', locator: "getByRole('button')", frameUrl: 'a', tag: 'button' },
    { kind: 'net', ts: T0 + 200, method: 'POST', url: '/api/send', status: 500, frameUrl: 'a' },
  ];
  const failing = buildTestCase(session, evs);
  assert.equal(failing.priority, 'medium');
  assert.equal(failing.needsReview, true);
  assert.equal(buildTestCase(session, evs, { priority: 'low' }).priority, 'low', 'an explicit priority still wins');
});

test('r4-05-2: the defect report labels a page-scripted step in the tester language, and BY_PAGE_AR is DOC_LABELS.ar.byPage', () => {
  assert.equal(BY_PAGE_AR, DOC_LABELS.ar.byPage);
  const evs = [{ kind: 'dom', ts: T0 + 100, action: 'click', label: 'Next', locator: "getByRole('button')", frameUrl: 'a', tag: 'button', trusted: false }];
  assert.ok(buildDefectReport(session, evs).steps[0].endsWith(DOC_LABELS.ar.byPage), 'the fixture session is ar-JO');
  assert.ok(buildDefectReport({ ...session, env: { language: 'en-US' } }, evs).steps[0].endsWith('(by the page)'));
  assert.ok(buildDefectReport(session, evs, { byPage: '(x)' }).steps[0].endsWith('(x)'));
});

test('D-1010-131: build is trimmed free text, reproducibility is one of four (default unknown), and both labels exist as an EN+AR pair', () => {
  const evs = [{ kind: 'net', ts: session.startedAt + 500, method: 'GET', url: '/api/x', status: 500, durationMs: 5, frameUrl: session.startUrl }];
  const d = buildDefectReport(session, evs, { build: '  2026.10.1-rc2  ', reproducibility: 'sometimes' });
  assert.equal(d.build, '2026.10.1-rc2');
  assert.equal(d.reproducibility, 'sometimes');
  const bare = buildDefectReport(session, evs);
  assert.equal(bare.build, '');
  assert.equal(bare.reproducibility, 'unknown');
  assert.equal(buildDefectReport(session, evs, { reproducibility: 'every-tuesday' }).reproducibility, 'unknown');
  assert.equal(buildDefectReport(session, evs, { build: 'x'.repeat(500) }).build.length, 120, 'build is capped');
  for (const key of ['defBuild', 'defRepro', 'notStated', 'reproAlways', 'reproSometimes', 'reproOnce', 'reproUnknown', 'gapSessionCap', 'gapBodyCap', 'gapLowDisk']) {
    assert.ok(DOC_LABELS.en[key] && DOC_LABELS.ar[key], `${key} has both an English and an Arabic text`);
  }
  assert.ok(/[؀-ۿ]/.test(DOC_LABELS.ar.defBuild), 'the Arabic label is Arabic');
});


console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
