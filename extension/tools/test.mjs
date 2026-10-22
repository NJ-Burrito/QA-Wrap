/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Unit tests for the pure logic in core/artifact.js.
 *
 *   node tools/test.mjs
 *
 * Only the DOM-free parts are covered here. The selector engine, recorder,
 * picker and RTL stress mode need a real browser — see README "Manual test pass".
 */
import assert from 'node:assert/strict';
import { PRODUCT } from '../core/product.js';
import {
  correlate,
  isFailure,
  reproSteps,
  buildPlaywrightSpec,
  durationBand,
  areasCovered,
  setCausalWindowMs,
  causalWindowMs,
  DEFAULT_CAUSAL_WINDOW_MS,
} from '../core/artifact.js';
// The three document builders live in their own module since 8 Sept 2026,
// out of the service worker's static boot graph. See core/artifact-docs.js.
import {
  buildMarkdown,
  buildJson,
  buildSessionSheet,
} from '../core/artifact-docs.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

const T0 = 1_700_000_000_000;
const session = {
  id: 's_test',
  charter: 'Submit an application with an expired document',
  startedAt: T0,
  endedAt: T0 + 12_000,
  startUrl: 'https://example.test/apply',
  env: { viewport: '1920×1080 @1x', userAgent: 'Chrome/126', platform: 'Win32', language: 'en-US' },
  status: 'stopped',
};

const events = [
  { kind: 'nav', ts: T0 + 100, url: 'https://example.test/apply', frameUrl: 'https://example.test/apply' },
  {
    kind: 'dom', ts: T0 + 2000, action: 'input', value: 'nader',
    label: 'اسم المستخدم', locator: "getByLabel('اسم المستخدم')", framePrefix: '',
    frameUrl: 'https://example.test/apply', tag: 'input',
  },
  {
    kind: 'dom', ts: T0 + 3000, action: 'click', label: 'إرسال',
    locator: "getByRole('button', { name: 'إرسال', exact: true })", framePrefix: '',
    frameUrl: 'https://example.test/apply', tag: 'button',
  },
  {
    kind: 'net', ts: T0 + 3400, method: 'POST', url: '/api/applications', status: 500,
    durationMs: 380, error: false, responsePreview: '{"error":"NullPointerException"}',
    frameUrl: 'https://example.test/apply',
  },
  {
    kind: 'console', ts: T0 + 3450, level: 'error', text: 'Submit failed: 500',
    frameUrl: 'https://example.test/apply',
  },
  { kind: 'note', ts: T0 + 4000, text: 'Reproduced three times in a row.' },
  {
    kind: 'net', ts: T0 + 9000, method: 'GET', url: '/api/heartbeat', status: 200,
    durationMs: 20, error: false, frameUrl: 'https://example.test/apply',
  },
];

console.log('artifact.js');

test('isFailure flags 5xx, console errors and page errors only', () => {
  assert.equal(isFailure({ kind: 'net', status: 500 }), true);
  assert.equal(isFailure({ kind: 'net', status: 404 }), true);
  assert.equal(isFailure({ kind: 'net', status: 200 }), false);
  assert.equal(isFailure({ kind: 'net', status: 0, error: true }), true);
  assert.equal(isFailure({ kind: 'console', level: 'error' }), true);
  assert.equal(isFailure({ kind: 'console', level: 'warn' }), false);
  assert.equal(isFailure({ kind: 'pageerror' }), true);
  assert.equal(isFailure({ kind: 'dom', action: 'click' }), false);
});

test('correlate links the 500 back to the click that caused it', () => {
  const chains = correlate(events);
  assert.equal(chains.length, 1, 'the two simultaneous failures collapse into one chain');
  const [chain] = chains;
  assert.equal(chain.trigger.action, 'click');
  assert.equal(chain.trigger.label, 'إرسال');
  assert.equal(chain.failure.status, 500);
  assert.equal(chain.gapMs, 400);
  assert.equal(chain.confidence, 'high');
  assert.equal(chain.siblings.length, 1, 'the console error rides along as a sibling');
  assert.equal(chain.siblings[0].text, 'Submit failed: 500');
});

test('correlate reports no trigger when the failure is outside the causal window', () => {
  const lateFailure = [
    { kind: 'dom', ts: T0, action: 'click', label: 'X', frameUrl: 'a' },
    { kind: 'net', ts: T0 + 20_000, method: 'GET', url: '/late', status: 503, durationMs: 5, frameUrl: 'a' },
  ];
  const [chain] = correlate(lateFailure);
  assert.equal(chain.trigger, null);
  assert.equal(chain.confidence, 'none');
});

test('the causal window is the setting, not a constant this module keeps to itself', () => {
  // The report page and the DevTools panel both correlate through
  // `settings.causalWindowMs`; every export, ISTQB defect and Jira issue came
  // through this module's hard-coded 5000 ms. Widening the setting changed the
  // report and not the filed defect, so two documents about one session named
  // different clicks as the cause and nothing said why.
  const lateFailure = [
    { kind: 'dom', ts: T0, action: 'click', label: 'X', frameUrl: 'a' },
    { kind: 'net', ts: T0 + 8000, method: 'GET', url: '/late', status: 503, durationMs: 5, frameUrl: 'a' },
  ];
  assert.equal(DEFAULT_CAUSAL_WINDOW_MS, 5000, 'the same default as settings.js DEFAULTS.causalWindowMs');
  assert.equal(correlate(lateFailure)[0].trigger, null, 'at 5 s the click is out of reach');

  // Per call, which is what a surface holding a fresh settings object passes.
  assert.equal(correlate(lateFailure, 10_000)[0].trigger.label, 'X');

  // And as a primed default, for the exporters and document builders that
  // reach correlate() indirectly and have no settings object to hand.
  try {
    assert.equal(setCausalWindowMs(10_000), 10_000);
    assert.equal(causalWindowMs(), 10_000);
    assert.equal(correlate(lateFailure)[0].trigger.label, 'X', 'the exporters and document builders follow');

    // Rubbish is refused rather than clamped: a surface that hands over a
    // string or a number outside RANGES gets the documented default back, not
    // a silently invented window.
    for (const bad of ['soon', null, 0, 25_000, -1, NaN]) {
      assert.equal(setCausalWindowMs(bad), DEFAULT_CAUSAL_WINDOW_MS, `${bad} must not become the window`);
    }
  } finally {
    setCausalWindowMs(DEFAULT_CAUSAL_WINDOW_MS);
  }
  assert.equal(correlate(lateFailure)[0].trigger, null, 'and the default is restored');
});

test('correlate prefers a same-frame trigger over a more recent cross-frame one', () => {
  const mixed = [
    { kind: 'dom', ts: T0 + 1000, action: 'click', label: 'in-frame', frameUrl: 'https://f/inner' },
    { kind: 'dom', ts: T0 + 1500, action: 'click', label: 'top', frameUrl: 'https://f/top' },
    { kind: 'net', ts: T0 + 2000, method: 'GET', url: '/x', status: 500, durationMs: 5, frameUrl: 'https://f/inner' },
  ];
  const [chain] = correlate(mixed);
  assert.equal(chain.trigger.label, 'in-frame');
});

test('reproSteps numbers only the DOM and navigation stream', () => {
  const steps = reproSteps(events);
  assert.equal(steps.length, 3);
  assert.match(steps[0], /^1\. Navigate to https:\/\/example.test\/apply$/);
  assert.match(steps[1], /^2\. Fill/);
  assert.match(steps[2], /^3\. Click/);
});

test('buildMarkdown includes correlation, repro steps and the response body', () => {
  const md = buildMarkdown(session, events, {});
  assert.match(md, /# Submit an application with an expired document/);
  assert.match(md, /## Correlated failures/);
  assert.match(md, /Triggered by/);
  assert.match(md, /high confidence/);
  assert.match(md, /NullPointerException/);
  assert.match(md, /## Steps to reproduce/);
  assert.match(md, /Reproduced three times in a row/);
  assert.match(md, /1920×1080/);
});

test('buildMarkdown omits cookie values but keeps names and flags', () => {
  const withCookies = {
    ...session,
    cookies: [{ name: 'JSESSIONID', domain: '.example.test', path: '/', httpOnly: true, secure: true, sameSite: 'lax' }],
  };
  const md = buildMarkdown(withCookies, events, {});
  assert.match(md, /JSESSIONID/);
  assert.match(md, /Cookie values are deliberately omitted/);
});

test('buildJson round-trips and carries the correlation', () => {
  const parsed = JSON.parse(buildJson(session, events, {}));
  assert.equal(parsed.tool, 'QA Wrap');
  assert.equal(parsed.events.length, events.length);
  assert.equal(parsed.correlatedFailures.length, 1);
  assert.equal(parsed.correlatedFailures[0].confidence, 'high');
  assert.equal(parsed.reproSteps.length, 3);
});

test('buildPlaywrightSpec emits a runnable spec from the recorded locators', () => {
  const spec = buildPlaywrightSpec(session, events);
  assert.match(spec, /import \{ test, expect \} from '@playwright\/test';/);
  assert.match(spec, /await page\.goto\('https:\/\/example.test\/apply'\);/);
  assert.match(spec, /await page\.getByLabel\('اسم المستخدم'\)\.fill\('nader'\);/);
  assert.match(spec, /await page\.getByRole\('button', \{ name: 'إرسال', exact: true \}\)\.click\(\);/);
  assert.match(spec, /POST \/api\/applications → 500/);
});

test('buildPlaywrightSpec flags an ambiguous locator instead of pretending it works', () => {
  const spec = buildPlaywrightSpec(session, [
    {
      kind: 'dom', ts: T0, action: 'click', label: 'Delete',
      locator: "getByRole('button', { name: 'Delete' })", framePrefix: '',
      locatorAmbiguous: true, locatorMatches: 7,
    },
  ]);
  assert.match(spec, /FIXME: locator matched 7 elements/);
});

test('buildPlaywrightSpec escapes quotes in recorded values', () => {
  const spec = buildPlaywrightSpec(session, [
    { kind: 'dom', ts: T0, action: 'input', value: "O'Brien", locator: "getByLabel('Name')", framePrefix: '' },
  ]);
  assert.match(spec, /fill\('O\\'Brien'\)/);
});

test('buildPlaywrightSpec threads a frameLocator prefix through', () => {
  const spec = buildPlaywrightSpec(session, [
    {
      kind: 'dom', ts: T0, action: 'click', label: 'OK',
      locator: "getByRole('button', { name: 'OK' })",
      framePrefix: "frameLocator('iframe#content').",
    },
  ]);
  assert.match(spec, /page\.frameLocator\('iframe#content'\)\.getByRole/);
});

test('an empty session still produces a valid, honest spec', () => {
  const spec = buildPlaywrightSpec({ ...session, charter: 'empty' }, []);
  assert.match(spec, /No replayable interactions were recorded/);
  // The spec opens with its provenance block, then the import. The header is
  // not decoration: a generated file that looks hand-written gets edited
  // instead of regenerated, and one with no charter in it cannot be traced
  // back to the run that produced it.
  // The banner is a comment, so it can never interfere with the code below
  // it, and it carries a machine-readable token as well as a readable line.
  // The product names itself; the rights line names the publisher who holds
  // them. Pinned separately so a rename of either is a deliberate edit.
  assert.match(spec, new RegExp(`^// ◈ QA Wrap · © \\d{4}(-\\d{4})? ${PRODUCT.maker}\\. Released under the MIT licence\\.$`, 'm'));
  assert.match(spec, /^\/\/ qaw1:[A-Za-z0-9_-]+\.[0-9a-f]{8}$/m, 'no verifiable token in the spec');
  assert.match(spec, /^import /m, 'the import must still be there, on a line of its own');
  assert.ok(spec.indexOf('//') < spec.indexOf('import '), 'banner first, then code');
});

test('buildPlaywrightSpec seeds goto from session.startUrl when no nav was recorded', () => {
  // A session started on an already-open tab records no navigation. Without a
  // seeded entry point the exported spec has nowhere to go and cannot run.
  const spec = buildPlaywrightSpec(session, [
    { kind: 'dom', ts: T0, action: 'click', label: 'Go', locator: "getByRole('button')", framePrefix: '' },
  ]);
  assert.match(spec, /await page\.goto\('https:\/\/example.test\/apply'\);/);
});

test('buildPlaywrightSpec does not emit the entry goto twice', () => {
  const spec = buildPlaywrightSpec(session, [
    { kind: 'nav', ts: T0, url: 'https://example.test/apply' },
    { kind: 'dom', ts: T0 + 10, action: 'click', label: 'Go', locator: "getByRole('button')", framePrefix: '' },
  ]);
  assert.equal((spec.match(/page\.goto\(/g) || []).length, 1);
});

test('buildPlaywrightSpec never fills a masked secret literally', () => {
  const spec = buildPlaywrightSpec(session, [
    {
      kind: 'dom', ts: T0, action: 'input', value: '••••••••', masked: true,
      locator: "getByLabel('Password')", framePrefix: '',
    },
  ]);
  assert.ok(!spec.includes("fill('••••••••')"), 'mask characters would be typed into the field');
  assert.match(spec, /process\.env\.UQA_SECRET/);
  assert.match(spec, /FIXME: secret field/);
});

test('buildMarkdown renders accessibility results instead of "undefined"', () => {
  const withA11y = [
    ...events,
    {
      kind: 'a11y', ts: T0 + 6000, url: 'https://example.test/apply', total: 7,
      byImpact: { critical: 0, serious: 2, moderate: 5, minor: 0 },
      violations: [
        { id: 'html-lang-valid', impact: 'serious', help: 'html element must have a valid lang', count: 1, nodes: [] },
        { id: 'region', impact: 'moderate', help: 'All page content should be contained by landmarks', count: 6, nodes: [] },
      ],
    },
  ];
  const md = buildMarkdown(session, withA11y, {});
  assert.ok(!md.includes('undefined'), 'the export contains the literal string "undefined"');
  assert.match(md, /## Accessibility/);
  assert.match(md, /html-lang-valid/);
  assert.match(md, /\| serious \|/);
  // Most severe first.
  assert.ok(md.indexOf('html-lang-valid') < md.indexOf('region'), 'violations were not sorted by impact');
});

test('buildMarkdown renders injected test data', () => {
  const md = buildMarkdown(session, [
    ...events,
    {
      kind: 'inject', ts: T0 + 5000, label: 'Max + 1 (41)', group: 'Boundary',
      fieldKind: 'name', fieldLabel: 'اسم المستخدم', truncated: true, actualLength: 40, valueLength: 41,
    },
  ], {});
  assert.ok(!md.includes('undefined'), 'the export contains the literal string "undefined"');
  assert.match(md, /Injected \*\*Max \+ 1 \(41\)\*\*/);
  assert.match(md, /truncated to 40 chars/);
});

/* ------------------------------------------------------- SBTM session sheet */

console.log('\nsession sheet (SBTM)');

const sbtmSession = {
  ...session,
  timeboxMinutes: 60,
  startedAt: T0,
  endedAt: T0 + 75 * 60_000, // 15 minutes over the box
  breakdown: { design: 70, bugs: 20, setup: 10, charter: 80 },
};

const sbtmEvents = [
  ...events,
  { kind: 'note', ts: T0 + 60_000, tag: 'bug', text: 'Submit returns 500 with an expired document.' },
  { kind: 'note', ts: T0 + 90_000, tag: 'issue', text: 'Test account keeps getting locked out.' },
  { kind: 'note', ts: T0 + 120_000, tag: 'question', text: 'Should an expired document be rejected client-side?' },
  { kind: 'nav', ts: T0 + 150_000, url: 'https://example.test/apply/step2', frameUrl: 'https://example.test/apply/step2' },
  { kind: 'inject', ts: T0 + 160_000, label: 'Max + 1', fieldLabel: 'Name', truncated: false, actualLength: 41 },
];

test('durationBand follows the classic SBTM short/normal/long split', () => {
  assert.equal(durationBand(20), 'short');
  assert.equal(durationBand(30), 'short');
  assert.equal(durationBand(45), 'normal');
  assert.equal(durationBand(60), 'normal');
  assert.equal(durationBand(90), 'long');
});

test('areasCovered derives distinct pages rather than asserting coverage', () => {
  const areas = areasCovered(sbtmEvents);
  const urls = areas.map((a) => a.url);
  assert.ok(urls.includes('https://example.test/apply'), 'the start page is missing');
  assert.ok(urls.includes('https://example.test/apply/step2'), 'the second page is missing');
  // Query strings must not split one page into many "areas".
  const dupes = new Set(urls);
  assert.equal(dupes.size, urls.length, 'areas contain duplicates');
});

test('the session sheet carries every SBTM section', () => {
  const sheet = buildSessionSheet(sbtmSession, sbtmEvents);
  for (const section of ['CHARTER', 'START', 'DURATION', 'TASK BREAKDOWN', 'AREAS COVERED', 'BUGS', 'ISSUES', 'TEST NOTES']) {
    assert.match(sheet, new RegExp(`## ${section}`), `missing section ${section}`);
  }
  assert.ok(!sheet.includes('undefined'), 'the sheet contains the literal string "undefined"');
});

test('the sheet reports going over the time-box, in plain numbers', () => {
  const sheet = buildSessionSheet(sbtmSession, sbtmEvents);
  assert.match(sheet, /75 min actual against a 60 min time-box/);
  assert.match(sheet, /\*\*15 min over\*\*/);
  assert.match(sheet, /^long: /m);
});

test('the sheet separates bugs, issues and questions by tag', () => {
  const sheet = buildSessionSheet(sbtmSession, sbtmEvents);
  const bugsAt = sheet.indexOf('## BUGS');
  const issuesAt = sheet.indexOf('## ISSUES');
  const questionsAt = sheet.indexOf('## QUESTIONS');
  assert.ok(sheet.slice(bugsAt, issuesAt).includes('expired document'), 'the bug is not under BUGS');
  assert.ok(sheet.slice(issuesAt, questionsAt).includes('locked out'), 'the issue is not under ISSUES');
  assert.ok(sheet.slice(questionsAt).includes('client-side'), 'the question is not under QUESTIONS');
});

test('the sheet lists machine-found failures the tester did not flag', () => {
  const sheet = buildSessionSheet(sbtmSession, sbtmEvents);
  assert.match(sheet, /QA Wrap also correlated \*\*1\*\* failure/);
  assert.match(sheet, /after Click إرسال/);
});

test('the sheet reports the self-declared task breakdown', () => {
  const sheet = buildSessionSheet(sbtmSession, sbtmEvents);
  assert.match(sheet, /\| Test design and execution \| 70 \|/);
  assert.match(sheet, /Charter \/ opportunity: \*\*80 \/ 20\*\*/);
});

test('a sheet with no breakdown says so rather than inventing numbers', () => {
  const sheet = buildSessionSheet({ ...sbtmSession, breakdown: null }, sbtmEvents);
  assert.match(sheet, /Not reported\. SBTM asks the tester to estimate this/);
  assert.ok(!/\| Test design and execution \|/.test(sheet), 'it rendered a breakdown table anyway');
});

test('a sheet with no time-box does not pretend there was one', () => {
  const sheet = buildSessionSheet({ ...sbtmSession, timeboxMinutes: null }, sbtmEvents);
  assert.ok(!/time-?box/i.test(sheet), 'time-box wording on a session without one'); // r7-14-3
  assert.match(sheet, /\d+ min/, 'the duration is still printed');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
