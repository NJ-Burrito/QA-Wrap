/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The specification read back from a page.
 *
 *   node tools/test-srs-reverse.mjs
 *
 * The reader runs in a page and the builder is pure, so the split is the same
 * one the rest of this codebase uses: a fixture DOM model stands in for what
 * `content/spec-reader.js` produces, and every assertion here is about the
 * document — the requirement lines, their sources, their statuses and their
 * acceptance criteria.
 *
 * The fixture is a permit form with the four shapes that matter: a required
 * field, a pattern, a range, a select with options; a field with no label at
 * all (which must become a GAP and never a confident sentence); links inside a
 * nav and one that leaves the site; and an error message the page is already
 * showing, which is observed behaviour rather than a guess.
 */
import assert from 'node:assert/strict';
import { buildReverseSrs, formRequirements, navigationRequirements, errorRequirements, walkRequirements, ruleSentence, fieldName } from '../core/srs-reverse.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const model = {
  url: 'https://permits.example.gov/apply',
  title: 'Apply for an import permit',
  lang: 'en',
  dir: 'ltr',
  headings: [{ level: 1, text: 'Apply for an import permit' }, { level: 2, text: 'Applicant' }],
  regions: [{ tag: 'main', role: '', label: '' }, { tag: 'nav', role: '', label: 'Primary' }],
  forms: [
    {
      n: 0,
      name: 'Application',
      implicit: false,
      action: '/api/permits',
      method: 'post',
      fields: [
        { n: 0, tag: 'input', type: 'text', name: 'applicant', id: 'a', label: 'Applicant name', help: '', rules: { required: true, maxLength: 60 }, options: [], state: {} },
        { n: 1, tag: 'input', type: 'email', name: 'email', id: 'e', label: 'Email address', help: '', rules: { required: true, format: 'email', pattern: '.+@.+' }, options: [], state: {} },
        { n: 2, tag: 'input', type: 'number', name: 'qty', id: 'q', label: 'Quantity', help: '', rules: { min: '1', max: '500', step: '1' }, options: [], state: {} },
        { n: 3, tag: 'select', type: 'select', name: 'country', id: 'c', label: 'Country of origin', help: '', rules: { required: true }, options: [{ value: 'jo', label: 'Jordan' }, { value: 'eg', label: 'Egypt' }], state: {} },
        { n: 4, tag: 'input', type: 'text', name: '', id: '', label: '', help: '', rules: { required: true }, options: [], state: {} },
      ],
      submits: [{ label: 'Submit application', type: 'submit', disabled: false }],
    },
  ],
  buttons: [{ label: 'Submit application', type: 'submit', inForm: true, disabled: false }],
  links: [
    { label: 'Permits', href: 'https://permits.example.gov/', internal: true, inNav: true },
    { label: 'Help', href: 'https://permits.example.gov/help', internal: true, inNav: true },
    { label: 'The ministry', href: 'https://ministry.example.gov/', internal: false, inNav: false },
  ],
  messages: [{ text: 'Something went wrong. Please try again.', role: 'alert', near: 'Submit application' }],
  tables: [{ caption: 'Fees', columns: ['Kind', 'Amount'], rows: 3 }],
  counts: { forms: 1, fields: 5, buttons: 1, links: 3, navLinks: 2, messages: 1, tables: 1 },
  ms: 12,
};

const T0 = 1_800_000_000_000;
const session = { id: 's_rev', charter: 'Apply for an import permit', startedAt: T0, startUrl: model.url };
const events = [
  { kind: 'nav', ts: T0 + 500, url: model.url },
  { kind: 'dom', ts: T0 + 1000, action: 'input', tag: 'input', label: 'Applicant name', frameUrl: model.url },
  { kind: 'dom', ts: T0 + 2000, action: 'click', tag: 'button', label: 'Submit application', frameUrl: model.url },
  { kind: 'net', ts: T0 + 2200, method: 'POST', url: 'https://permits.example.gov/api/permits', status: 500, durationMs: 90, frameUrl: model.url },
];

/* ── the rules a page declares are requirements already written ────────── */

test('a declared rule becomes a sentence, not a list of attributes', () => {
  assert.deepEqual(ruleSentence(model.forms[0].fields[0]), ['is required', 'must be at most 60 characters']);
  assert.deepEqual(ruleSentence(model.forms[0].fields[1]), ['is required', 'must be a valid email', 'must match the pattern `.+@.+`']);
  assert.deepEqual(ruleSentence(model.forms[0].fields[2]), ['must be between 1 and 500', 'moves in steps of 1']);
  assert.deepEqual(ruleSentence(model.forms[0].fields[3]), ['is required', 'is one of 2 listed values']);
  assert.deepEqual(ruleSentence({ rules: {}, options: [] }), [], 'a field with no rules must not invent one');
});

test('every form and every rule produces a requirement, with its source', () => {
  const reqs = formRequirements(model);
  const form = reqs.find((r) => r.id === 'FR-F1');
  assert.match(form.text, /The system shall offer "Application" with 5 fields, of which 4 are required\./);
  assert.equal(form.status, 'DECLARED', 'the page said it: nothing here is observed or guessed');
  assert.match(form.source, /action="\/api\/permits"/);
  assert.equal(form.criteria.length, 2);
  assert.match(form.criteria[1], /^Given "Application", when the user submits it with 4 required fields empty, then the system shall refuse/);

  const email = reqs.find((r) => r.text.startsWith('"Email address"'));
  assert.match(email.text, /is required, and must be a valid email, and must match the pattern/);
  const qty = reqs.find((r) => r.text.startsWith('"Quantity"'));
  assert.match(qty.criteria[0], /outside its rule, then the system shall say so before submitting/);
});

test('a field with no name at all is a GAP, never a confident sentence', () => {
  const gap = formRequirements(model).find((r) => r.status === 'GAP');
  assert.ok(gap, 'the unlabelled required field must be reported');
  assert.match(gap.text, /no label, no name and no aria-label/);
  assert.match(gap.text, /must be named by the product owner/);
  assert.deepEqual(gap.criteria, [], 'a gap cannot carry an acceptance criterion');
  assert.equal(fieldName(model.forms[0].fields[4]), 'the unlabelled text field');
});

/* ── where the page goes, and what it says when it refuses ─────────────── */

test('navigation is read from the landmark, and leaving the site is called out', () => {
  const nav = navigationRequirements(model);
  const map = nav.find((r) => r.id === 'FR-N1');
  assert.match(map.text, /2 navigation links from this page: "Permits", "Help"/);
  assert.equal(map.status, 'DECLARED');
  const away = nav.find((r) => r.id === 'FR-N2');
  assert.match(away.text, /1 link leaves this site/);

  // Links with no landmark are ambiguous, and ambiguity is a question.
  const loose = navigationRequirements({ links: [{ label: 'Somewhere', href: '/x', internal: true, inNav: false }] });
  assert.equal(loose[0].status, 'GAP');
  assert.match(loose[0].text, /none of them is inside a navigation landmark/);
});

test('an error already on screen is observed behaviour', () => {
  const errs = errorRequirements(model);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].status, 'OBSERVED');
  assert.match(errs[0].text, /Something went wrong\. Please try again\./);
  assert.match(errs[0].criteria[0], /shall not lose what the user typed/);
  assert.deepEqual(errorRequirements({ messages: [] }), []);
});

/* ── the walk, folded in ───────────────────────────────────────────────── */

test('a recorded session adds what the page could never say on its own', () => {
  const walk = walkRequirements(session, events);
  assert.match(walk[0].text, /The recorded walk covered 1 page/);
  const clicked = walk.find((r) => /click "Submit application"/.test(r.text));
  assert.equal(clicked.status, 'OBSERVED: FAILED', 'the click that caused the 500 must say so');
  const reliability = walk.find((r) => r.id === 'NFR-R1');
  assert.equal(reliability.status, 'OBSERVED: NOT MET');
  assert.match(reliability.text, /1 failure was recorded in this walk\./);
  assert.deepEqual(walkRequirements(null, []), [], 'no session, no observed half');
});

/* ── the document ──────────────────────────────────────────────────────── */

test('the document is bilingual, sourced, and honest about what it guessed', () => {
  const doc = buildReverseSrs({ model, session, events });
  for (const heading of ['المقدمة · Introduction', 'المتطلبات الوظيفية · Functional requirements', 'أسئلة مفتوحة · Open questions', 'التحقق · Verification']) {
    assert.ok(doc.includes(heading), `the ${heading} section is missing`);
  }
  assert.match(doc, /\*\*DECLARED\*\* means the page itself says so/);
  assert.match(doc, /- \*\*FR-F1\*\* The system shall offer "Application"/);
  assert.match(doc, /_\(page: <form action="\/api\/permits">; DECLARED\)_/);
  assert.match(doc, /\| FR-N1 \| page: <nav> \/ role=navigation \| DECLARED \|/);
  assert.match(doc, /Fees: 2 columns \(Kind, Amount\), 3 rows shown\./);
  assert.match(doc, /1 marked GAP/);
  assert.ok(!doc.includes('—'), 'no em dash in anything a tester reads');
  assert.ok(!/\(s\)/.test(doc), 'no bracketed plural either');
});

test('with no session it says which half is missing, rather than inventing it', () => {
  const doc = buildReverseSrs({ model });
  assert.match(doc, /Record a session and this section fills itself in\./);
  assert.ok(!doc.includes('The recorded walk'), 'nothing observed should be claimed');
  assert.ok(!doc.includes('OBSERVED: FAILED'));
});

test('a page with nothing on it produces a document that says so, not a crash', () => {
  const bare = { url: 'https://example.test/', title: '', forms: [], links: [], messages: [], tables: [], headings: [], counts: {} };
  const doc = buildReverseSrs({ model: bare });
  assert.match(doc, /Nothing on this page declares a rule, offers a form or navigates anywhere\./);
  assert.throws(() => buildReverseSrs({}), /Nothing was read from the page\./);
});

test('T-043: other frames are their own labelled groups, an unread frame and masking are GAP lines', () => {
  const inner = { url: 'https://p.test/in', forms: [{ name: 'Inner', implicit: false, fields: [{ label: 'Age', name: 'age', type: 'number', tag: 'input', rules: { required: true } }] }], links: [], messages: [], withheld: 1 };
  const doc = buildReverseSrs({ model: { ...model, withheld: 2, framesCapped: 3, frames: [{ url: 'https://p.test/in?x=1', model: inner }, { url: 'https://p.test/dead', model: null, why: 'no answer in 6 s' }] } });
  assert.match(doc, /\*\*Frame: https:\/\/p\.test\/in\*\*/);
  assert.match(doc, /\*\*F2:FR-F1\*\*/);
  assert.match(doc, /Frame not read \(no answer in 6 s\)/);
  assert.match(doc, /3 further frames not read, past the limit of 8/);
  assert.match(doc, /3 items withheld by masking/);
  assert.ok(!doc.includes('—'), 'no em dash');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
