/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Test suites: a parent case, its sub-cases, and everything hanging off them.
 *
 * ── why a flat list is not enough ─────────────────────────────────────────
 *
 * A recorded session is almost never one test case. "Submit an application" is
 * really sign in, then fill the form, then upload the documents, then submit —
 * four things that fail independently, are re-run independently, and are
 * assigned to different people. Filing that as a single case has two costs that
 * show up immediately:
 *
 *   A case that fails at step 14 of 30 tells you nothing about steps 15–30.
 *   They were never run, and a single pass/fail cannot say so.
 *
 *   A defect found at step 14 gets attached to the whole flow, so the triage
 *   meeting cannot tell whether the upload is broken or the sign-in is.
 *
 * So the shape is a parent and children, which is what ISO/IEC/IEEE 29119-3
 * calls a test design specification containing test cases, and what every
 * tracker models as an epic or a parent issue.
 *
 * ── relations are typed, and the type carries meaning ─────────────────────
 *
 * "Related to" is what a tracker offers when nobody decided what the
 * relationship was, and a board full of "relates to" is a board where nothing
 * can be traced. Each type here answers a question somebody actually asks:
 *
 *   `verifies`     which story does this case prove?          → traceability
 *   `covers`       which requirement does it exercise?        → coverage
 *   `found-by`     which case found this defect?              → regression
 *   `blocks`       what cannot run until this is fixed?       → scheduling
 *   `duplicates`   which report came first?                   → triage
 *   `relates-to`   everything else, deliberately last
 *
 * ── the rule that keeps the tree a tree ───────────────────────────────────
 *
 * Parent/child and `blocks` are directed and must stay acyclic. A cycle in
 * `blocks` is a schedule that cannot be satisfied and it will be discovered by
 * a person, in a meeting, a week later. It is cheap to detect here.
 */

import { buildTestCase, buildDefectReport } from './istqb.js';
import { docFooter, embed } from './provenance.js';
import { mdEsc } from './docshell.js';
import { captureGapLine, techniqueLine, csvCell } from './formats-export.js';
import { docLabels, fill } from './doc-labels.js';
import { liteProblem } from './events.js';
import { exportSlug } from './presets.js';


/** A count and its noun, agreeing. Local: see `background/service-worker.js`. */
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

/** The relationship types, in the order they should be offered. */
export const RELATIONS = [
  { id: 'verifies', label: 'Verifies', inverse: 'verified by', of: 'case',
    hint: 'This case proves that story or requirement works. The link traceability is built on.' },
  { id: 'covers', label: 'Covers', inverse: 'covered by', of: 'case',
    hint: 'This case exercises that requirement. Several cases may cover one requirement.' },
  { id: 'found-by', label: 'Found by', inverse: 'found', of: 'defect',
    hint: 'The case that surfaced this defect, so the fix has a test to re-run.' },
  { id: 'blocks', label: 'Blocks', inverse: 'blocked by', of: 'any', directed: true, acyclic: true,
    hint: 'Nothing on the other end can run until this is dealt with.' },
  { id: 'duplicates', label: 'Duplicates', inverse: 'duplicated by', of: 'defect',
    hint: 'The same defect, reported twice. Points at the one that came first.' },
  { id: 'relates-to', label: 'Relates to', inverse: 'relates to', of: 'any',
    hint: 'Deliberately last. If one of the types above fits, it is the better link.' },
];

export const relationById = (id) => RELATIONS.find((r) => r.id === id) || null;

/* ── splitting a session into sub-cases ────────────────────────────────── */

/**
 * Where one sub-case ends and the next begins.
 *
 * Three signals, in order of how much they mean:
 *
 *   1. A note the tester tagged `split`. Explicit beats inferred, always — the
 *      person who was there knows where the seam is.
 *   2. A top-level navigation. A new page is usually a new thing being tested,
 *      and it is the boundary a reader will expect.
 *   3. Nothing. One sub-case, which is the honest answer for a session that
 *      never left the page.
 *
 * A same-page navigation — a hash change, a query string — is not a boundary.
 * Splitting a single-page app into forty sub-cases because it routes with the
 * history API produces a suite nobody can read.
 */
export function splitPoints(events) {
  const points = [];
  let lastPath = null;

  for (const [index, event] of events.entries()) {
    if (event.kind === 'note' && event.tag === 'split') {
      points.push({ index, why: 'marked', title: event.text || null });
      continue;
    }
    if (event.kind !== 'nav') continue;
    let path;
    try {
      path = new URL(event.url).origin + new URL(event.url).pathname;
    } catch {
      path = event.url;
    }
    if (lastPath !== null && path !== lastPath) {
      points.push({ index, why: 'navigation', title: null, url: event.url });
    }
    lastPath = path;
  }
  return points;
}

/** A readable name for a sub-case, from what it actually did. */
function nameSegment(events, fallback) {
  const marked = events.find((e) => e.kind === 'note' && e.tag === 'split' && e.text);
  if (marked) return marked.text.slice(0, 90);

  const nav = events.find((e) => e.kind === 'nav');
  if (nav) {
    try {
      const path = new URL(nav.url).pathname.replace(/\/+$/, '');
      const last = path.split('/').filter(Boolean).pop();
      if (last) return last.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    } catch {
      /* not a URL */
    }
  }
  const submit = events.find((e) => e.kind === 'dom' && e.action === 'submit');
  if (submit?.label) return `Submit ${submit.label}`;
  const click = events.find((e) => e.kind === 'dom' && e.action === 'click' && e.label);
  if (click) return click.label.slice(0, 90);
  return fallback;
}

/* ── building the suite ────────────────────────────────────────────────── */

/**
 * Turn a session into a parent case with children.
 *
 * The parent is not a test case with steps of its own — it is the thing the
 * children add up to, and giving it duplicate steps is how a suite ends up
 * describing the same flow twice. It carries the objective, the environment and
 * the traceability; the children carry the procedure.
 */
export function buildTestSuite(session, events, options = {}) {
  const points = options.splitAt || splitPoints(events);
  const stamp = new Date(session.startedAt).toISOString().slice(0, 10).replace(/-/g, '');
  const tail = session.id.slice(-4).toUpperCase();
  const suiteId = options.identifier || `TS-${stamp}-${tail}`;

  // Cut the event stream at the split points. Each slice keeps its own events,
  // so every child derives its preconditions and steps from what really
  // happened inside it rather than from the whole session.
  const cuts = [0, ...points.map((p) => p.index), events.length];
  const slices = [];
  // r5-04-6: a slice with no action in it is a page that was passed through, not a test. It is carried
  // FORWARD and prepended to the next slice that has an action, where it becomes that case's precondition;
  // only a trailing run (nothing after it holds an action) merges backward into the last case.
  let carry = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const slice = events.slice(cuts[i], cuts[i + 1]);
    if (!slice.some((e) => e.kind === 'dom')) {
      carry.push(...slice);
      continue;
    }
    slices.push([...carry, ...slice]);
    carry = [];
  }
  if (carry.length) {
    if (slices.length) slices[slices.length - 1].push(...carry);
    else slices.push(carry);
  }
  if (!slices.length) slices.push(events);

  // The suite's own traceability reaches every child; a caller's per-child
  // options still win.
  const inherited = {};
  // D-1010-175: options.requirements (an array) and the old options.requirement (one string) are one list: trimmed, deduplicated, empties dropped.
  const reqList = [...new Set([...(Array.isArray(options.requirements) ? options.requirements : []), options.requirement].map((r) => String(r ?? '').trim()).filter(Boolean))];
  for (const k of ['epic', 'story']) if (options[k]) inherited[k] = options[k];
  if (reqList.length) inherited.requirement = reqList.join(', ');
  const { requirement: _requirement, ...inheritedDefect } = inherited;

  const cases = slices.map((slice, index) => {
    const child = buildTestCase(session, slice, {
      ...inherited,
      ...options.caseOptions,
      identifier: `${suiteId}.${index + 1}`,
      objective: nameSegment(slice, `Step ${index + 1} of ${session.charter || 'the flow'}`),
    });
    return {
      ...child,
      parent: suiteId,
      order: index + 1,
      // Whether this child actually got as far as being exercised. A suite
      // where child 3 failed and children 4–6 never ran is a different picture
      // from one where all six ran and three failed, and only this field tells
      // them apart.
      outcome: slice.some(liteProblem) ? 'failed' : child.steps.length ? 'passed-observed' : 'not-run',
    };
  });

  // One defect per child that saw a real failure (all that child's failures go
  // in its one report), attached to the child it happened in — which is the
  // whole reason for splitting in the first place.
  const defects = [];
  slices.forEach((slice, index) => {
    const failures = slice.filter(liteProblem);
    if (!failures.length) return;
    const report = buildDefectReport(session, slice, {
      ...inheritedDefect,
      ...options.defectOptions,
      identifier: `${suiteId}.${index + 1}-D1`,
      testCase: cases[index].identifier,
    });
    defects.push({ ...report, parent: suiteId, foundIn: cases[index].identifier });
  });

  const notes = events
    .filter((e) => e.kind === 'note' && e.tag !== 'split' && e.tag !== 'technique')
    .map((e) => ({ ts: e.ts, tag: e.tag || null, text: e.text }));

  // D-1010-132: a stated requirement is a node (req:<slug>, the D-1010-122 slug rule), and every case covers it.
  const requirements = [...new Map(reqList.map((t) => [`req:${exportSlug(t, session.id)}`, t]))].map(([identifier, title]) => ({ identifier, title }));
  const relations = [
    // Derived, not typed by hand: the case that produced a defect is known.
    ...defects.map((d) => ({ from: d.identifier, to: d.foundIn, type: 'found-by' })),
    ...requirements.flatMap((r) => cases.map((c) => ({ from: c.identifier, to: r.identifier, type: 'covers', executed: c.outcome !== 'not-run' }))), // D-204: a case that never ran covers on paper only
    ...(options.story ? cases.map((c) => ({ from: c.identifier, to: String(options.story), type: 'verifies' })) : []), // D-1010-175: a story link is a verifies edge
    ...(options.relations || []),
  ];

  return {
    identifier: suiteId,
    title: options.title || session.charter || 'Recorded flow',
    objective: options.objective || session.charter || 'Verify the recorded flow end to end',
    level: options.level || 'System',
    type: options.type || 'Functional',
    priority: options.priority || 'medium', // D-1010-95 (extends D-82): impact never sets priority (istqb.js:24-26); a defect sets needsReview below

    environment: cases[0]?.environment || {},
    traceability: {
      epic: options.epic || null,
      story: options.story || null,
      requirement: reqList.join(', ') || null,
      requirements: reqList,
      sessionId: session.id,
    },

    cases,
    defects,
    notes,
    // r3-06-1 / r3-04-1: what the recording lost, and how much of the designed black-box rows was applied.
    gap: captureGapLine(events) || null,
    coverage: techniqueLine(events) || null,
    requirements,
    // D-204: ISTQB coverage is measured on executed tests; `cases` counts the covers edges, `executed` those whose case ran.
    requirementCoverage: requirements.map((r) => {
      const own = cases.filter((c) => relations.some((x) => x.type === 'covers' && x.to === r.identifier && x.from === c.identifier));
      return { requirement: r.identifier, cases: own.length, executed: own.filter((c) => c.outcome !== 'not-run').length, failed: own.filter((c) => c.outcome === 'failed').length };
    }),
    relations: validateRelations(relations, [...cases, ...defects, ...requirements]),

    summary: {
      cases: cases.length,
      failed: cases.filter((c) => c.outcome === 'failed').length,
      notRun: cases.filter((c) => c.outcome === 'not-run').length,
      defects: defects.length,
      needsReview: cases.filter((c) => c.needsReview).length,
    },

    derivedFrom: { sessionId: session.id, recordedAt: session.startedAt, events: events.length },
    // The parent inherits its children's honesty. A suite that presents itself
    // as ready when three of its cases have blank expected results is worse
    // than one case with the same problem, because the count hides it.
    needsReview: cases.some((c) => c.needsReview) || defects.length > 0,
  };
}

/* ── relations ─────────────────────────────────────────────────────────── */

/**
 * Check the links before they are filed.
 *
 * Three ways a relation is wrong, and all three are cheap to catch here and
 * expensive to discover in a tracker:
 *
 *   it points at something that is not in the suite,
 *   it points at itself,
 *   or it closes a cycle in a type that must not have one.
 *
 * Bad links are returned marked rather than dropped. Silently discarding a link
 * the tester typed is how a traceability matrix ends up with a hole nobody can
 * account for.
 */
export function validateRelations(relations, items) {
  const known = new Set(items.map((i) => i.identifier));
  const out = [];
  const edges = new Map();

  for (const relation of relations || []) {
    const spec = relationById(relation.type);
    const problems = [];

    if (!spec) problems.push(`"${relation.type}" is not a relationship type.`);
    if (relation.from === relation.to) problems.push('An item cannot relate to itself.');
    // `to` may legitimately be outside the suite — a Jira story, a requirement
    // id — so only `from` has to be something we hold. D-1010-132: except a `req:` id, which this suite mints and must hold.
    if (/^req:/.test(relation.to) && !known.has(relation.to)) problems.push(`${relation.to} is not a requirement in this suite.`);
    if (!known.has(relation.from)) problems.push(`${relation.from} is not in this suite.`);
    // r5-04-4: `of` names what the link may start from; a defect cannot "verify" and a case cannot be "found by".
    else if (spec && spec.of !== 'any') {
      const item = items.find((i) => i.identifier === relation.from);
      const kind = item && (item.severity || item.foundIn) ? 'defect' : 'case';
      if (kind !== spec.of) problems.push(`"${spec.label}" starts from a ${spec.of}, and ${relation.from} is a ${kind}.`);
    }

    if (spec?.acyclic && !problems.length) {
      const list = edges.get(relation.type) || [];
      list.push([relation.from, relation.to]);
      edges.set(relation.type, list);
      if (hasCycle(list)) {
        problems.push(`This would make a loop of "${spec.label}" links, which can never be satisfied.`);
        list.pop();
      }
    }

    out.push(problems.length ? { ...relation, invalid: true, problems } : relation);
  }
  return out;
}

/** Depth-first cycle detection over a directed edge list. */
function hasCycle(edges) {
  const graph = new Map();
  for (const [from, to] of edges) {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push(to);
  }
  const state = new Map(); // 1 = on the current path, 2 = finished

  const walk = (node) => {
    if (state.get(node) === 1) return true;
    if (state.get(node) === 2) return false;
    state.set(node, 1);
    for (const next of graph.get(node) || []) if (walk(next)) return true;
    state.set(node, 2);
    return false;
  };

  return [...graph.keys()].some((node) => state.get(node) === undefined && walk(node));
}

/** Add one relation to a suite, returning a new suite rather than mutating it. */
export function addRelation(suite, relation) {
  const relations = validateRelations(
    // r4-04-5: invalid relations stay visible; the whole list is validated again with the new one appended.
    [...suite.relations.map(({ invalid, problems, ...r }) => r), relation],
    [...suite.cases, ...suite.defects, ...(suite.requirements || [])]
  );
  return { ...suite, relations };
}

/* ── rendering ─────────────────────────────────────────────────────────── */

const bar = (done, total) => {
  if (!total) return '';
  const filled = Math.round((done / total) * 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${done}/${total}`;
};

/** The suite as Markdown — the parent, then each child, then the links. */
export function suiteToMarkdown(suite, ar = false) {
  const out = [];
  const W = docLabels(ar ? 'ar' : 'en');
  out.push(`# ${mdEsc(suite.identifier)}: ${mdEsc(suite.title)}`, '');

  if (suite.needsReview) {
    out.push(
      '> **Review before use.** One or more cases below have an expected result that was ' +
        'copied from what the application did, or none at all. A recording can say what ' +
        'happened; only a person can say what should have.',
      ''
    );
  }

  out.push(`**Objective** ${mdEsc(suite.objective)}`);
  out.push(`**Level** ${mdEsc(suite.level)} · **Type** ${mdEsc(suite.type)} · **Priority** ${mdEsc(suite.priority)}`);
  if (suite.traceability.requirement) out.push(`**Requirement** ${mdEsc(suite.traceability.requirement)}${suite.requirements?.length ? ` (${suite.requirements.map((r) => mdEsc(r.identifier)).join(', ')})` : ''}`);
  if (suite.traceability.story) out.push(`**Story** ${mdEsc(suite.traceability.story)}`);
  if (suite.traceability.epic) out.push(`**Epic** ${mdEsc(suite.traceability.epic)}`);
  if (suite.gap) out.push(`**Capture** ${mdEsc(suite.gap)}`);
  if (suite.coverage) out.push(`**Coverage** ${mdEsc(suite.coverage)}`);
  out.push('');

  const s = suite.summary;
  out.push('## Where this run got to', '');
  out.push(`| | |`, `| --- | --- |`);
  out.push(`| Cases | ${s.cases} |`);
  out.push(`| Failed | ${s.failed} |`);
  out.push(`| Never reached | ${s.notRun} |`);
  out.push(`| Defects | ${s.defects} |`);
  out.push('');
  out.push(`\`${bar(s.cases - s.failed - s.notRun, s.cases)}\` exercised without a failure`);
  out.push('');

  if (suite.requirementCoverage?.length) {
    out.push('## Requirement coverage', '');
    suite.requirementCoverage.forEach((c) => out.push(`- ${mdEsc(c.requirement)}: ${fill(W.reqExecuted, { n: c.executed, m: c.cases })}${c.failed ? ` (${c.failed} failed)` : ''}`));
    out.push('');
  }

  out.push('## Cases', '');
  for (const c of suite.cases) {
    const mark = { failed: '✗', 'not-run': '·', 'passed-observed': '✓' }[c.outcome] || '?';
    out.push(`### ${mark} ${mdEsc(c.identifier)}: ${mdEsc(c.objective)}`, '');
    if (c.preconditions.length) {
      out.push('**Preconditions**');
      c.preconditions.forEach((p) => out.push(`- ${mdEsc(p)}`));
      out.push('');
    }
    if (c.steps.length) {
      out.push('| # | Action | Expected result |', '| --- | --- | --- |');
      for (const step of c.steps) {
        const expected = step.expected
          ? `${mdEsc(step.expected)}${step.expectedDerived ? ' _(observed: confirm)_' : ''}${step.expectedIsFailure ? ' ⚠' : ''}`
          : '_blank: fill this in_';
        out.push(`| ${step.number} | ${mdEsc(step.action)} | ${expected} |`);
      }
      out.push('');
    } else {
      out.push('_No steps were recorded in this segment._', '');
    }
  }

  if (suite.defects.length) {
    out.push('## Defects found', '');
    for (const d of suite.defects) {
      out.push(`### ${mdEsc(d.identifier)}: ${mdEsc(d.summary)}`, '');
      out.push(`**Severity** ${mdEsc(d.severity)}${d.severityIsSuggestion ? ' _(suggested)_' : ''} · ` +
        `**Priority** ${mdEsc(d.priority)}${d.priorityIsSuggestion ? ' _(suggested)_' : ''}`);
      out.push(`**Found in** ${mdEsc(d.foundIn)}`);
      out.push('', `**Expected** ${d.expected ? mdEsc(d.expected) : '_not yet stated: only a person knows this_'}`);
      out.push(`**Actual** ${mdEsc(d.actual)}`, '');
    }
  }

  if (suite.notes.length) {
    out.push('## Tester notes', '');
    suite.notes.forEach((n) => out.push(`- ${n.tag ? `**${mdEsc(n.tag)}** ` : ''}${mdEsc(n.text)}`));
    out.push('');
  }

  const links = suite.relations.filter((r) => !r.invalid);
  if (links.length) {
    out.push('## Relationships', '');
    for (const r of links) {
      out.push(`- ${mdEsc(r.from)} **${mdEsc(relationById(r.type)?.label || r.type)}** ${mdEsc(r.to)}`);
    }
    out.push('');
  }

  const broken = suite.relations.filter((r) => r.invalid);
  if (broken.length) {
    out.push('## Links that could not be made', '');
    broken.forEach((r) => out.push(`- ${mdEsc(r.from)} → ${mdEsc(r.to)}: ${mdEsc(r.problems.join(' '))}`));
    out.push('');
  }

  const origin = { id: suite.derivedFrom.sessionId, startedAt: suite.derivedFrom.recordedAt };
  out.push('---', `Derived from ${suite.derivedFrom.events} recorded events.`, '', docFooter({ session: origin }));
  out.push('', embed.markdown({ session: origin, kind: 'test-suite' }));
  return out.join('\n');
}

/** D-1010-132: the suite as CSV, one row per case, defect and requirement, with the links that start from it ("covers req:req-7"). */
export function suiteToCsv(suite, ar = false) {
  const q = csvCell; // D-201: the one formula guard (formats-export.js), so -5 stays a number here too
  const W = docLabels(ar ? 'ar' : 'en');
  const cov = new Map((suite.requirementCoverage || []).map((c) => [c.requirement, fill(W.reqExecuted, { n: c.executed, m: c.cases })]));
  const links = (id) => suite.relations.filter((r) => !r.invalid && r.from === id).map((r) => `${r.type} ${r.to}`).join('; ');
  const rows = [['id', 'kind', 'title', 'outcome', 'relations'],
    ...suite.cases.map((c) => [c.identifier, 'case', c.objective, c.outcome, links(c.identifier)]),
    ...suite.defects.map((d) => [d.identifier, 'defect', d.summary, '', links(d.identifier)]),
    ...(suite.requirements || []).map((r) => [r.identifier, 'requirement', r.title, cov.get(r.identifier) || '', ''])];
  return String.fromCharCode(0xFEFF) + rows.map((r) => r.map(q).join(',')).join('\n');
}

/**
 * The shape a tracker needs to create the whole thing.
 *
 * Ordered parent-first, because a child cannot be linked to a parent that does
 * not exist yet. Returned as a plan rather than executed, so the caller can
 * show it before anything is created — filing eleven issues by surprise is not
 * something to find out about afterwards.
 */
export function filingPlan(suite, { parentType = 'Task', caseType = 'Test', defectType = 'Bug' } = {}) {
  const plan = [
    { ref: suite.identifier, kind: 'suite', issueType: parentType, summary: `${suite.identifier}: ${suite.title}` },
  ];
  for (const c of suite.cases) {
    plan.push({
      ref: c.identifier,
      kind: 'case',
      issueType: caseType,
      summary: `${c.identifier}: ${c.objective}`,
      parentRef: suite.identifier,
    });
  }
  for (const d of suite.defects) {
    plan.push({
      ref: d.identifier,
      kind: 'defect',
      issueType: defectType,
      summary: d.summary,
      parentRef: suite.identifier,
      links: [{ type: 'found-by', to: d.foundIn }],
    });
  }
  return {
    steps: plan,
    total: plan.length,
    note:
      `${plural(plan.length, 'issue')} would be created: 1 parent, ${plural(suite.cases.length, 'case')} and ` +
      `${plural(suite.defects.length, 'defect')}. Nothing is sent until you confirm.`,
  };
}
