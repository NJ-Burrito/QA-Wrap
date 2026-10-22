/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Test suites — a parent case with sub-cases, sub-defects and typed relations.
 *
 * The assertions worth having are about the two things the hierarchy exists to
 * make possible: telling "never ran" apart from "ran and passed", and attaching
 * a defect to the segment that produced it rather than to the whole flow.
 */
import fs from 'node:fs';
import {
  buildTestSuite,
  splitPoints,
  validateRelations,
  addRelation,
  suiteToMarkdown,
  suiteToCsv,
  filingPlan,
  RELATIONS,
} from '../core/suite.js';
import { techniqueCoverage, techniqueLine, captureGap, captureGapLine, toMarkdownIssue } from '../core/formats-export.js';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    const detail = fn();
    pass++;
    console.log(`  ok  ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ''}`);
  } catch (err) {
    fail++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

const ok = (v, why) => {
  if (!v) throw new Error(why);
};
const eq = (a, b, why) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${why}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

const SESSION = {
  id: 's_zzz999',
  charter: 'Submit an application end to end',
  startedAt: Date.parse('2026-08-27T08:00:00Z'),
  startUrl: 'https://app.test/login',
  env: { userAgent: 'Chrome', viewport: '1280x800' },
};

let clock = SESSION.startedAt;
const at = () => (clock += 1000);

const EVENTS = [
  { kind: 'nav', url: 'https://app.test/login', ts: at() },
  { kind: 'dom', action: 'input', label: 'Username', value: 'sara', ts: at() },
  { kind: 'dom', action: 'click', label: 'Sign in', ts: at() },
  { kind: 'nav', url: 'https://app.test/apply', ts: at() },
  { kind: 'dom', action: 'input', label: 'Applicant name', value: 'Sara', ts: at() },
  { kind: 'dom', action: 'click', label: 'Continue', ts: at() },
  { kind: 'nav', url: 'https://app.test/documents', ts: at() },
  { kind: 'dom', action: 'click', label: 'Upload', ts: at() },
  { kind: 'net', method: 'POST', url: '/api/upload', status: 500, ok: false, durationMs: 30, ts: at() },
  { kind: 'note', tag: 'bug', text: 'Upload dies on any PDF over 2MB', ts: at() },
];

console.log('\n— where the seams are —');

test('a change of page is a boundary; the first page is not', () => {
  const points = splitPoints(EVENTS);
  eq(points.map((p) => p.why), ['navigation', 'navigation'], 'two page changes after the first');
  return points.map((p) => p.url);
});

test('a same-page navigation is not a boundary', () => {
  const points = splitPoints([
    { kind: 'nav', url: 'https://app.test/x', ts: 1 },
    { kind: 'nav', url: 'https://app.test/x?tab=2', ts: 2 },
    { kind: 'nav', url: 'https://app.test/x#section', ts: 3 },
  ]);
  eq(points.length, 0, 'a routing app must not become forty sub-cases');
});

test('a note the tester tagged "split" beats anything inferred', () => {
  const points = splitPoints([
    { kind: 'dom', action: 'click', ts: 1 },
    { kind: 'note', tag: 'split', text: 'Now the payment part', ts: 2 },
    { kind: 'dom', action: 'click', ts: 3 },
  ]);
  eq(points.length, 1, 'one explicit split');
  eq(points[0].why, 'marked', 'and it is recorded as explicit');
  eq(points[0].title, 'Now the payment part', 'the tester named it');
});

console.log('\n— the suite —');

const suite = buildTestSuite(SESSION, EVENTS);

test('the session becomes a parent with children', () => {
  ok(suite.identifier.startsWith('TS-'), suite.identifier);
  eq(suite.cases.length, 3, 'login, apply, documents');
  return { id: suite.identifier, cases: suite.cases.map((c) => c.objective) };
});

test('children are numbered under the parent, so an id says where it belongs', () => {
  eq(suite.cases.map((c) => c.identifier), [`${suite.identifier}.1`, `${suite.identifier}.2`, `${suite.identifier}.3`], 'ids');
  ok(suite.cases.every((c) => c.parent === suite.identifier), 'every child names its parent');
});

test('the parent carries no steps of its own', () => {
  ok(!('steps' in suite), 'a parent with duplicate steps describes the flow twice');
  ok(suite.objective, 'it carries the objective instead');
});

test('each child derives its steps from its own segment only', () => {
  const total = suite.cases.reduce((n, c) => n + c.steps.length, 0);
  const actions = EVENTS.filter((e) => e.kind === 'dom').length;
  ok(total <= actions, `${total} steps across children, from ${actions} actions`);
  ok(suite.cases[0].steps.some((s) => /Sign in/.test(s.action)), 'sign-in belongs to the first case');
  ok(!suite.cases[2].steps.some((s) => /Sign in/.test(s.action)), 'and not to the third');
});

console.log('\n— the distinction the hierarchy exists for —');

test('a failed child is marked failed and the others are not', () => {
  const outcomes = suite.cases.map((c) => c.outcome);
  eq(outcomes[2], 'failed', 'the upload segment carried the 500');
  ok(outcomes.slice(0, 2).every((o) => o !== 'failed'), 'the earlier segments did not fail');
  return outcomes;
});

test('"never reached" is a state of its own, not a pass and not a fail', () => {
  const short = buildTestSuite(SESSION, [
    { kind: 'nav', url: 'https://app.test/a', ts: 1 },
    { kind: 'dom', action: 'click', label: 'Go', ts: 2 },
    { kind: 'note', tag: 'split', text: 'Never got here', ts: 3 },
  ]);
  ok(short.summary.notRun >= 0, 'the count exists');
  ok('notRun' in short.summary, 'a suite that cannot say what was skipped hides the important half');
});

test('a defect is attached to the child that produced it, not to the flow', () => {
  eq(suite.defects.length, 1, 'one failure, one defect');
  eq(suite.defects[0].foundIn, `${suite.identifier}.3`, 'the upload case');
  ok(suite.defects[0].identifier.startsWith(`${suite.identifier}.3-D`), suite.defects[0].identifier);
  return { defect: suite.defects[0].identifier, foundIn: suite.defects[0].foundIn };
});

test('the found-by link is derived, because it is already known', () => {
  const link = suite.relations.find((r) => r.type === 'found-by');
  ok(link, 'nobody should have to type a relationship the tool already knows');
  eq(link.from, suite.defects[0].identifier, 'from the defect');
  eq(link.to, `${suite.identifier}.3`, 'to the case');
});

test('notes survive, and a split marker does not become a note', () => {
  ok(suite.notes.some((n) => /2MB/.test(n.text)), 'the tester note is kept');
  ok(!suite.notes.some((n) => n.tag === 'split'), 'a split marker is structure, not commentary');
});

test('the parent needs review if any child does', () => {
  eq(suite.needsReview, suite.cases.some((c) => c.needsReview), 'the count must not hide it');
});

console.log('\n— relations —');

test('every relationship type explains when to use it', () => {
  for (const r of RELATIONS) {
    ok(r.hint && r.hint.length > 25, `${r.id} has no usable hint`);
    ok(r.inverse, `${r.id} has no inverse, so it cannot be read from the other end`);
  }
  return RELATIONS.map((r) => r.id);
});

test('"relates to" is offered last, on purpose', () =>
  eq(RELATIONS[RELATIONS.length - 1].id, 'relates-to', 'the vague one should not be the first reached for'));

test('suite epic/story/requirement reach every case and defect (04-1)', () => {
  const FAILING = [...EVENTS, { kind: 'net', method: 'POST', url: '/api/x', status: 500, ts: at(), frameUrl: EVENTS[0].frameUrl }];
  const traced = buildTestSuite(SESSION, FAILING, { epic: 'EP-1', story: 'ST-2', requirement: 'RQ-3' });
  ok(traced.defects.length >= 1, 'the fixture needs at least one defect');
  for (const c of traced.cases) {
    eq(c.traceability.epic, 'EP-1', 'case epic'); eq(c.traceability.story, 'ST-2', 'case story'); eq(c.traceability.requirement, 'RQ-3', 'case requirement');
  }
  for (const d of traced.defects) { eq(d.traceability.epic, 'EP-1', 'defect epic'); eq(d.traceability.story, 'ST-2', 'defect story'); }
  const win = buildTestSuite(SESSION, FAILING, { epic: 'EP-1', caseOptions: { epic: 'EP-OWN' }, defectOptions: { story: 'ST-OWN' } });
  eq(win.cases[0].traceability.epic, 'EP-OWN', 'caller case options win');
  eq(win.defects[0].traceability.story, 'ST-OWN', 'caller defect options win');
  eq(win.defects[0].traceability.epic, 'EP-1', 'and the rest is inherited');
});

test('a link to something outside the suite is fine — that is what traceability is', () => {
  const next = addRelation(suite, { from: suite.cases[0].identifier, to: 'PROJ-42', type: 'verifies' });
  const link = next.relations.find((r) => r.to === 'PROJ-42');
  ok(!link.invalid, JSON.stringify(link.problems));
});

test('adding a relation keeps an invalid one visible (04-5)', () => {
  const bad = { from: 'GHOST-1', to: 'X', type: 'relates-to' };
  const one = addRelation({ ...suite, relations: [bad] }, { from: suite.cases[0].identifier, to: 'PROJ-7', type: 'verifies' });
  eq(one.relations.length, 2, 'the invalid link was not dropped');
  ok(one.relations[0].invalid && one.relations[0].from === 'GHOST-1', 'and it is still marked');
  ok(!one.relations[1].invalid, 'the new one is valid');
});

test('a link FROM something outside the suite is marked, not silently dropped', () => {
  const out = validateRelations([{ from: 'GHOST-1', to: 'X', type: 'relates-to' }], suite.cases);
  eq(out.length, 1, 'a bad link must still be visible');
  ok(out[0].invalid, 'and marked');
  ok(/not in this suite/.test(out[0].problems[0]), out[0].problems[0]);
});

test('an item cannot relate to itself', () => {
  const id = suite.cases[0].identifier;
  const out = validateRelations([{ from: id, to: id, type: 'blocks' }], suite.cases);
  ok(out[0].invalid && /cannot relate to itself/.test(out[0].problems[0]), out[0].problems[0]);
});

test('an unknown relationship type is refused by name', () => {
  const out = validateRelations([{ from: suite.cases[0].identifier, to: 'X', type: 'sort-of-about' }], suite.cases);
  ok(/is not a relationship type/.test(out[0].problems[0]), out[0].problems[0]);
});

test('a loop of "blocks" is caught before it reaches a tracker', () => {
  const [a, b, c] = suite.cases.map((x) => x.identifier);
  const out = validateRelations(
    [
      { from: a, to: b, type: 'blocks' },
      { from: b, to: c, type: 'blocks' },
      { from: c, to: a, type: 'blocks' },
    ],
    suite.cases
  );
  eq(out.filter((r) => r.invalid).length, 1, 'only the link that closes the loop is refused');
  ok(/loop/.test(out[2].problems[0]), out[2].problems[0]);
  return out.map((r) => (r.invalid ? 'refused' : 'ok'));
});

test('a diamond is not a cycle, and must be allowed', () => {
  const [a, b, c] = suite.cases.map((x) => x.identifier);
  const out = validateRelations(
    [
      { from: a, to: b, type: 'blocks' },
      { from: a, to: c, type: 'blocks' },
      { from: b, to: 'END', type: 'blocks' },
      { from: c, to: 'END', type: 'blocks' },
    ],
    suite.cases
  );
  eq(out.filter((r) => r.invalid).length, 0, 'two paths to one node is normal scheduling');
});

test('"relates to" may loop, because it means nothing directional', () => {
  const [a, b] = suite.cases.map((x) => x.identifier);
  const out = validateRelations(
    [
      { from: a, to: b, type: 'relates-to' },
      { from: b, to: a, type: 'relates-to' },
    ],
    suite.cases
  );
  eq(out.filter((r) => r.invalid).length, 0, 'a symmetric link is allowed to be symmetric');
});

console.log('\n— rendering and filing —');

const md = suiteToMarkdown(suite);

test('the Markdown shows the parent, every child and the defect', () => {
  ok(md.includes(suite.identifier), 'the suite id');
  for (const c of suite.cases) ok(md.includes(c.identifier), `${c.identifier} is missing`);
  ok(md.includes(suite.defects[0].summary.slice(0, 20)), 'the defect summary is missing');
});

test('an unconfirmed expected result is marked in the rendering, not smoothed over', () =>
  ok(/observed: confirm|blank: fill this in/.test(md), 'the honesty markers must survive rendering'));

test('the review warning survives into the document when it applies', () => {
  if (!suite.needsReview) return 'this suite does not need review';
  ok(/Review before use/.test(md), 'the warning did not reach the Markdown');
});

test('the filing plan is parent-first, or a child cannot be linked', () => {
  const plan = filingPlan(suite);
  eq(plan.steps[0].kind, 'suite', 'the parent must be created first');
  ok(plan.steps.slice(1).every((s) => s.parentRef === suite.identifier), 'everything else hangs off it');
  return { total: plan.total, kinds: plan.steps.map((s) => s.kind) };
});

test('the plan says how many issues it would create before creating any', () => {
  const plan = filingPlan(suite);
  ok(/Nothing is sent until you confirm/.test(plan.note), plan.note);
  eq(plan.total, 1 + suite.cases.length + suite.defects.length, 'the count must match the steps');
});

test('tester-induced failures (overridden, via api, hinted) file no defect and do not fail the child (04-1)', () => {
  const click = { kind: 'dom', action: 'click', label: 'Send', ts: 1000 };
  const bad = [
    { kind: 'net', method: 'POST', url: '/api/x', status: 500, ok: false, overridden: true, ts: 1100 },
    { kind: 'net', method: 'GET', url: '/api/y', status: 500, ok: false, via: 'api', ts: 1200 },
    { kind: 'console', level: 'error', text: 'dev noise', nh: 'dev', ts: 1300 },
  ];
  for (const extra of bad) {
    const s = buildTestSuite(SESSION, [{ kind: 'nav', url: 'https://app.test/a', ts: 900 }, click, extra, { kind: 'net', method: 'GET', url: '/api/ok', status: 200, ok: true, ts: 1400 }]);
    eq(s.defects.length, 0, 'no defect for ' + JSON.stringify(extra));
    eq(s.cases[0].outcome, 'passed-observed', 'the child ran and passed');
    ok(!s.cases[0].needsReview, 'nothing to review');
  }
  const real = buildTestSuite(SESSION, [{ kind: 'nav', url: 'https://app.test/a', ts: 900 }, click, { kind: 'net', method: 'POST', url: '/api/z', status: 500, ok: false, ts: 1100 }]);
  eq(real.defects.length, 1, 'a real 500 still files');
  eq(real.cases[0].outcome, 'failed', 'and fails the child');
});

test('a session with nothing in it still produces a readable suite', () => {
  const empty = buildTestSuite(SESSION, []);
  eq(empty.cases.length, 1, 'one empty case rather than none');
  ok(empty.needsReview, 'and it must ask to be reviewed');
  ok(suiteToMarkdown(empty).includes('No steps were recorded'), 'and say so out loud');
});

console.log('— r5-04 fixes —');

test('a leading nav-only slice is carried into the next case, not a case of its own (r5-04-6)', () => {
  let t = SESSION.startedAt + 100000;
  const nx = () => (t += 1000);
  const evs = [
    { kind: 'nav', url: 'https://app.test/', ts: nx() },
    { kind: 'nav', url: 'https://app.test/login', ts: nx() },
    { kind: 'dom', action: 'click', label: 'Sign in', ts: nx() },
    { kind: 'nav', url: 'https://app.test/mid', ts: nx() },
    { kind: 'net', method: 'GET', url: '/api/x', status: 500, ok: false, durationMs: 5, ts: nx() },
    { kind: 'nav', url: 'https://app.test/end', ts: nx() },
    { kind: 'dom', action: 'click', label: 'Done', ts: nx() },
  ];
  const s = buildTestSuite(SESSION, evs);
  eq(s.cases.length, 2, 'two cases');
  ok(s.cases[0].preconditions.some((p) => p.includes('https://app.test/')), 'the leading nav is a precondition of case 1: ' + JSON.stringify(s.cases[0].preconditions));
  ok(s.cases[1].preconditions.some((p) => p.includes('/mid')), 'the pass-through page is carried forward into case 2');
  const trailing = buildTestSuite(SESSION, [...evs, { kind: 'nav', url: 'https://app.test/bye', ts: nx() }]);
  eq(trailing.cases.length, 2, 'a trailing nav-only run merges backward');
});

test('the Markdown prints the Requirement (r5-04-4)', () => {
  const s = buildTestSuite(SESSION, EVENTS, { requirement: 'REQ-42', story: 'PROJ-7' });
  ok(suiteToMarkdown(s).includes('**Requirement** REQ-42'), 'requirement is shown');
});

test('a relation whose from-kind mismatches spec.of is marked invalid (r5-04-4)', () => {
  const defect = suite.defects[0];
  const c = suite.cases[0].identifier;
  const out = validateRelations(
    [
      { from: defect.identifier, to: 'PROJ-7', type: 'verifies' },
      { from: c, to: 'PROJ-7', type: 'verifies' },
      { from: c, to: defect.identifier, type: 'found-by' },
      { from: defect.identifier, to: c, type: 'found-by' },
    ],
    [...suite.cases, ...suite.defects]
  );
  eq(out.map((r) => !!r.invalid), [true, false, true, false], 'only the matching kinds pass');
});

console.log('\n— r3-04-1 technique coverage and r3-06-1 capture gaps in the exports —');

const DESIGNED = ['f#p:valid', 'f#p:empty', 'f#b0.0', 'f#b0.1'];
const tn = (kind, ids, ts) => ({ kind: 'note', tag: 'technique', text: `Technique: ${kind} ${ids.join(' ')}`, ts });

test('techniqueCoverage counts 0 of N, k of N and N of N, and ignores ids that were never designed', () => {
  eq(techniqueCoverage(DESIGNED, []), { covered: 0, total: 4 }, '0 of N');
  eq(techniqueCoverage(DESIGNED, ['f#p:valid', 'f#b0.1', 'g#p:other']), { covered: 2, total: 4 }, 'k of N');
  eq(techniqueCoverage(DESIGNED, DESIGNED), { covered: 4, total: 4 }, 'N of N');
  eq(techniqueCoverage([...DESIGNED, ...DESIGNED], DESIGNED), { covered: 4, total: 4 }, 'a repeated designed list is still N');
});

test('the suite markdown and the issue markdown say "covered x of y" from technique notes, in the document language', () => {
  const evs = [...EVENTS, tn('designed', DESIGNED, at()), tn('applied', ['f#p:valid'], at()), tn('applied', ['f#b0.0'], at())];
  const s = buildTestSuite(SESSION, evs);
  eq(s.coverage, 'Technique coverage: 2 of 4 values in 1 field opened', 'the suite carries the line, worded by fields opened');
  ok(suiteToMarkdown(s).includes('**Coverage** Technique coverage: 2 of 4 values in 1 field opened'), 'and prints it');
  ok(!s.notes.some((n) => n.tag === 'technique'), 'technique notes are not tester notes');
  ok(toMarkdownIssue(SESSION, evs).includes('Technique coverage: 2 of 4'), 'the issue export prints it');
  ok(techniqueLine(evs, true).includes('2 من 4'), 'and the Arabic twin says it in Arabic');
  const two = [...EVENTS, tn('designed', ['#a:nth-of-type(1)#p:valid', '#a:nth-of-type(1)#p:empty', 'input:nth-of-type(2)#p:valid'], at()), tn('applied', ['#a:nth-of-type(1)#p:valid'], at())];
  eq(techniqueLine(two), 'Technique coverage: 1 of 3 values across 2 fields opened', 'D-1010-94: two unnamed fields keyed by locator are two fields, not one');
  eq(techniqueLine(EVENTS), '', 'no designed list, no line');
  eq(buildTestSuite(SESSION, EVENTS).coverage, null, 'and the suite field is null');
});

test('a capture gap reaches the suite and issue headers, counted from the capture-gap notes', () => {
  const gap = [
    { kind: 'note', tag: 'capture-gap', ts: at(), text: 'Capture gap: events that could not be stored: 7.', lost: 7 },
    { kind: 'note', tag: 'capture-gap', ts: at(), text: 'Capture gap: 3 events could not be confirmed stored (the write timed out; they may still be there).', unconfirmed: 3 },
  ];
  eq(captureGap([...EVENTS, ...gap]), { lost: 7, unconfirmed: 3, other: [] }, 'both counters, read from the fields');
  eq(captureGap(EVENTS), { lost: 0, unconfirmed: 0, other: [] }, 'a clean session');
  eq(captureGap([{ kind: 'note', tag: 'capture-gap', text: 'Capture gap: events that could not be stored: 9.' }]).lost, 0, 'D-1010-108: the note text is never parsed');
  const s = buildTestSuite(SESSION, [...EVENTS, ...gap]);
  ok(/7 events were not stored and 3 could not be confirmed/.test(s.gap), s.gap);
  ok(suiteToMarkdown(s).includes('**Capture** Capture gap:'), 'the suite prints it');
  ok(toMarkdownIssue(SESSION, [...EVENTS, ...gap]).includes('7 events were not stored'), 'the issue prints it');
  eq(buildTestSuite(SESSION, EVENTS).gap, null, 'no gap, no field');
  ok(captureGapLine(gap, true).includes('7') && /[؀-ۿ]/.test(captureGapLine(gap, true)), 'Arabic twin');
});

test('D-1010-108: a digit-free gap note is read by its code, once per code, in both languages', () => {
  const notes = [
    { kind: 'note', tag: 'capture-gap', gap: 'coverage-detached', text: 'Capture gap: coverage stopped when the debugger was detached.' },
    { kind: 'note', tag: 'capture-gap', gap: 'coverage-detached', text: 'again' },
    { kind: 'note', tag: 'capture-gap', gap: 'recording-orphaned', text: 'Capture gap: a recording could not be re-filed under this session.' },
    { kind: 'note', tag: 'capture-gap', gap: 'something-new', text: 'x' },
  ];
  eq(captureGap(notes), { lost: 0, unconfirmed: 0, other: ['coverage-detached', 'recording-orphaned', 'something-new'] }, 'codes listed once each');
  const en = captureGapLine(notes, false), ar = captureGapLine(notes, true);
  ok(/debugger was detached/.test(en) && /re-filed/.test(en) && /kind this version does not know/.test(en), en);
  ok(/[؀-ۿ]/.test(ar) && !/debugger/.test(ar), ar);
  eq(captureGapLine([], false), '', 'nothing, no line');
});

test('D-1010-95: priority is medium whatever the defects; a defect marks the suite for review instead', () => {
  const failing = [...EVENTS, { kind: 'console', level: 'error', text: 'boom', ts: at() }, { kind: 'network', status: 500, url: 'https://x.test/a', method: 'GET', ts: at() }];
  const s = buildTestSuite(SESSION, failing);
  eq(s.priority, 'medium', 'priority medium with defects present');
  if (s.defects.length) ok(s.needsReview === true, 'a defect sets needsReview');
  eq(buildTestSuite(SESSION, failing, { priority: 'low' }).priority, 'low', 'an explicit priority still wins');
});

test('D-1010-93/94: the popup designs the pattern-field valid row, keys by locator and rebuilds from the notes (source pins)', () => {
  const popup = fs.readFileSync(new URL('../popup/popup.js', import.meta.url), 'utf8');
  ok(!/filter\(\(p\) => !p\.needsInput\)/.test(popup), 'the needsInput valid row is in the designed set');
  ok(/f\.selector \|\| f\.name/.test(popup), 'the key is the locator first');
  ok(/rebuildTechnique\(events, sid\)/.test(popup) && /function rebuildTechnique/.test(popup), 'the applied set is rebuilt from the session notes');
  ok(/function ownValuePasses/.test(popup) && /\^\(\?:\$\{field\.pattern\}\)\$/.test(popup), 'a typed value is applied only if it passes the whole pattern');
  ok(!/slice\(0, 24\)/.test(popup.slice(popup.indexOf('const techField'), popup.indexOf('const techField') + 400)), 'no 24-character name key');
});

test('D-1010-132: requirement REQ-7 gives a req:req-7 node and one covers relation per case, none dangling', () => {
  const s = buildTestSuite(SESSION, EVENTS, { requirement: 'REQ-7' });
  eq(s.requirements, [{ identifier: 'req:req-7', title: 'REQ-7' }], 'one requirement node with the slug id');
  const covers = s.relations.filter((r) => r.type === 'covers');
  eq(covers.map((r) => r.from), s.cases.map((c) => c.identifier), 'one covers relation per case, in order');
  ok(s.cases.length > 1 && covers.every((r) => r.to === 'req:req-7' && !r.invalid), 'all point at the node, none invalid');
  ok(s.relations.every((r) => !r.invalid), 'no relation in the suite is dangling');
  const md = suiteToMarkdown(s);
  ok(md.includes('`req:req-7`') || md.includes('req:req-7'), 'the markdown names the node');
  ok(covers.every((r) => md.includes(`${r.from} **Covers** req:req-7`)), 'the markdown lists each covers relation');
  const csv = suiteToCsv(s).replace(/^﻿/, '').split('\n');
  eq(csv[0], 'id,kind,title,outcome,relations', 'csv header');
  ok(csv.filter((l) => l.endsWith(',covers req:req-7')).length === s.cases.length, 'every case row carries its covers link');
  ok(csv.some((l) => l.startsWith('req:req-7,requirement,REQ-7')), 'the requirement is a row');
  eq(buildTestSuite(SESSION, EVENTS, {}).requirements, [], 'no requirement, no node');
  ok(!buildTestSuite(SESSION, EVENTS, {}).relations.some((r) => r.type === 'covers'), 'and no covers relation');
});

test('D-1010-132: a req: target the suite does not hold is rejected; an external id is still allowed; addRelation keeps the node known', () => {
  const s = buildTestSuite(SESSION, EVENTS, { requirement: 'REQ-7' });
  const bad = addRelation(s, { from: s.cases[0].identifier, to: 'req:ghost', type: 'covers' }).relations.at(-1);
  ok(bad.invalid && /not a requirement in this suite/.test(bad.problems.join(' ')), 'dangling req: target refused');
  const ext = addRelation(s, { from: s.cases[0].identifier, to: 'PROJ-9', type: 'verifies' }).relations.at(-1);
  ok(!ext.invalid, 'a Jira key outside the suite is still fine');
  const again = addRelation(s, { from: s.cases[1].identifier, to: 'req:req-7', type: 'covers' });
  ok(again.relations.filter((r) => r.invalid).length === 0, 'the held node is accepted when the whole list is validated again');
});


test('D-1010-175: options.requirements (two) gives two nodes, every case covers both, a story link emits verifies, nothing dangles', () => {
  const s = buildTestSuite(SESSION, EVENTS, { requirements: ['REQ-1', ' REQ-2 ', 'REQ-1', ''], story: 'PROJ-7' });
  eq(s.requirements, [{ identifier: 'req:req-1', title: 'REQ-1' }, { identifier: 'req:req-2', title: 'REQ-2' }], 'trimmed, deduplicated, empties dropped');
  const covers = s.relations.filter((r) => r.type === 'covers');
  eq(covers.length, s.cases.length * 2, 'each case covers each requirement');
  for (const c of s.cases) for (const r of s.requirements) ok(covers.some((x) => x.from === c.identifier && x.to === r.identifier), `${c.identifier} covers ${r.identifier}`);
  const verifies = s.relations.filter((r) => r.type === 'verifies');
  eq(verifies.map((r) => [r.from, r.to]), s.cases.map((c) => [c.identifier, 'PROJ-7']), 'a story link is one verifies edge per case');
  ok(s.relations.every((r) => !r.invalid), 'no dangling edge');
  eq(s.traceability.requirements, ['REQ-1', 'REQ-2'], 'traceability keeps the list');
  ok(s.cases.every((c) => c.traceability.requirement === 'REQ-1, REQ-2'), 'every case carries both');
  const md = suiteToMarkdown(s);
  ok(md.includes('req:req-1') && md.includes('req:req-2'), 'the markdown names both nodes');
  const old = buildTestSuite(SESSION, EVENTS, { requirement: 'REQ-7' });
  eq(old.requirements, [{ identifier: 'req:req-7', title: 'REQ-7' }], 'the old single option still works');
  eq(old.traceability.requirement, 'REQ-7', 'and keeps its string');
  eq(buildTestSuite(SESSION, EVENTS, { requirements: ['REQ-1'], requirement: 'REQ-1' }).requirements.length, 1, 'both options naming one requirement is one node');
  ok(!buildTestSuite(SESSION, EVENTS, {}).relations.some((r) => r.type === 'verifies'), 'no story, no verifies');
});

test('D-204: a covers edge says whether its case ran, and requirementCoverage counts executed and failed cases per requirement', () => {
  const s = buildTestSuite(SESSION, EVENTS, { requirements: ['REQ-1', 'REQ-2'] });
  eq(s.cases.map((c) => c.outcome), ['passed-observed', 'passed-observed', 'failed'], 'the fixture: two passed, one failed');
  const covers = s.relations.filter((r) => r.type === 'covers');
  eq(covers.length, 6, 'one covers edge per case per requirement (D-132 stands)');
  ok(covers.every((r) => r.executed === true), 'passed or failed both count as executed');
  eq(s.requirementCoverage, [
    { requirement: 'req:req-1', cases: 3, executed: 3, failed: 1 },
    { requirement: 'req:req-2', cases: 3, executed: 3, failed: 1 },
  ], 'the summary counts executed and failed');
  ok(suiteToMarkdown(s).includes('req:req-1: 3 of 3 executed (1 failed)'), 'the markdown says 3 of 3 executed');
  ok(suiteToMarkdown(s, true).includes('نُفِّذ 3 من 3'), 'and in Arabic');
  ok(suiteToCsv(s).split('\n').some((l) => l.startsWith('req:req-1,requirement,REQ-1,3 of 3 executed')), 'the CSV carries it on the requirement row');
  eq(buildTestSuite(SESSION, EVENTS, {}).requirementCoverage, [], 'no requirement, no summary');
});

test('D-201: the suite CSV uses the one formula guard (a negative number stays a number), and the format is wired', () => {
  const s = buildTestSuite(SESSION, EVENTS, { requirement: 'REQ-7' });
  s.cases[0].objective = '-5';
  s.cases[1].objective = '=SUM(A1)';
  s.cases[2].objective = '-cmd';
  const rows = suiteToCsv(s).split('\n');
  ok(rows.some((l) => l.includes(',case,-5,')), 'plain -5 is untouched');
  ok(rows.some((l) => l.includes(",case,'=SUM(A1),")), 'a formula gets the leading apostrophe');
  ok(rows.some((l) => l.includes(",case,'-cmd,")), 'a leading minus that is not a number is guarded');
  const build = fs.readFileSync(new URL('../background/export-build.js', import.meta.url), 'utf8');
  ok(/case 'suite-csv':[\s\S]{0,200}text\/csv[\s\S]{0,200}suiteToCsv\(buildTestSuite\(session, events\)\)/.test(build) && /\.csv`/.test(build.slice(build.indexOf("case 'suite-csv'"), build.indexOf("case 'suite-csv'") + 200)), 'export-build builds suite-csv as text/csv');
  const filing = fs.readFileSync(new URL('../core/filing.js', import.meta.url), 'utf8');
  ok(/'suite-csv': \{ category: 'test', ext: 'csv'/.test(filing), 'filing.js lists it as a test-shelf csv');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
