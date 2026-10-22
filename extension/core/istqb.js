/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Test cases and defect reports in the shape ISTQB teaches.
 *
 * The Foundation syllabus points at **ISO/IEC/IEEE 29119-3**; these two models follow it. A test case
 * without preconditions cannot be re-run by anyone but its author, and a defect report that folds
 * severity into priority makes the triage meeting an argument.
 *
 * ── the test case (29119-3 §8, CTFL 1.4.4 / 4.x) ─────────────────────────────
 *
 *   identifier, objective, preconditions, test data, steps (action and expected
 *   result), postconditions, priority, traceability.
 *
 * ── the defect report (29119-3 §9, CTFL 5.5) ─────────────────────────────────
 *
 * The part practitioners most often get wrong, and the syllabus is emphatic
 * about it:
 *
 *   **Severity** is the impact on the system.
 *   **Priority** is the urgency of fixing it.
 *
 * They are independent. A typo on the login page is *trivial* severity and can
 * be *highest* priority; a crash in a report nobody runs until year end is
 * *critical* severity and *low* priority. A tool that offers one field for both
 * teaches the wrong thing, so this one always asks for two and derives sensible
 * starting values from the evidence rather than guessing a single number.
 */

import { correlate } from './correlate.js';
import { liteProblem, isTesterNote } from './events.js';
import { describeDom, reproSteps, stepLabel, clampLabel } from './steps.js';

/* ── vocabulary ────────────────────────────────────────────────────────── */

/** D-1010-131: how often the tester saw it fail (29119-3). */
export const REPRODUCIBILITY = ['always', 'sometimes', 'once', 'unknown'];

/** Impact on the system. 29119-3 severity classification. */
export const SEVERITY = [
  { id: 'critical', label: 'Critical', hint: 'The system, or a whole function, is unusable. No workaround.',
    ar: { label: 'حرجة', hint: 'النظام أو وظيفة كاملة فيه غير قابل للاستخدام. لا يوجد حل بديل.' } },
  { id: 'major', label: 'Major', hint: 'A main function is badly wrong. A workaround exists but is painful.',
    ar: { label: 'رئيسية', hint: 'وظيفة أساسية تعمل بشكل خاطئ جدًا. يوجد حل بديل لكنه مرهق.' } },
  { id: 'moderate', label: 'Moderate', hint: 'A function behaves wrongly in a way users will notice and can work around.',
    ar: { label: 'متوسطة', hint: 'وظيفة تعمل بشكل خاطئ يلاحظه المستخدمون ويمكنهم تجاوزه.' } },
  { id: 'minor', label: 'Minor', hint: 'Cosmetic, or an edge case. Nothing is lost.',
    ar: { label: 'بسيطة', hint: 'شكلية أو حالة حدّية. لا يضيع شيء.' } },
];

/** Urgency of the fix. Deliberately a separate axis from severity. */
export const PRIORITY = [
  { id: 'highest', label: 'Immediate', hint: 'Blocks the release, or is on fire in production.',
    ar: { label: 'فورية', hint: 'تمنع الإصدار، أو تسبب عطلًا حادًا في الإنتاج.' } },
  { id: 'high', label: 'High', hint: 'Fix in this iteration.',
    ar: { label: 'عالية', hint: 'تُعالَج في هذه الدورة.' } },
  { id: 'medium', label: 'Medium', hint: 'Fix when convenient, before the next release.',
    ar: { label: 'متوسطة', hint: 'تُعالَج عند التيسّر، قبل الإصدار التالي.' } },
  { id: 'low', label: 'Low', hint: 'Fix if there is time. A known issue is acceptable.',
    ar: { label: 'منخفضة', hint: 'تُعالَج إن اتسع الوقت. يُقبل بقاء مشكلة معروفة.' } },
];

/** CTFL test levels — which stage of testing this case belongs to. */
export const TEST_LEVELS = ['Component', 'Component integration', 'System', 'System integration', 'Acceptance'];

/** CTFL test types — what quality characteristic it is aimed at. */
export const TEST_TYPES = ['Functional', 'Non-functional', 'Black-box', 'White-box', 'Change-related (regression)', 'Confirmation'];

/* ── the fundamentals, as a model the UI can be built from ─────────────── */

/**
 * The seven testing principles (CTFL 1.3).
 *
 * Not decoration. Each one is attached below to the tool it actually governs,
 * and shown at the moment it applies — the first principle belongs on the
 * screen where a scan comes back clean, because "no violations found" is
 * exactly where a tester is most likely to hear "the page is accessible".
 */
export const PRINCIPLES = [
  { n: 1, id: 'presence', title: 'Testing shows the presence, not the absence, of defects',
    plain: 'Finding nothing is not proof there is nothing. It only means these checks did not find it.' },
  { n: 2, id: 'exhaustive', title: 'Exhaustive testing is impossible',
    plain: 'You cannot try every value. Choose the ones most likely to break it, and say why you chose them.' },
  { n: 3, id: 'early', title: 'Early testing saves time and money',
    plain: 'A defect found in a design review costs a fraction of the same defect found in production.' },
  { n: 4, id: 'clustering', title: 'Defects cluster together',
    plain: 'A small number of screens usually holds most of the problems. Where you found one, look again.' },
  { n: 5, id: 'pesticide', title: 'Beware the pesticide paradox',
    plain: 'Tests that keep passing stop finding anything. Change them, or they only prove they still run.' },
  { n: 6, id: 'context', title: 'Testing is context dependent',
    plain: 'A payment page and an internal report are not tested the same way, and should not be.' },
  { n: 7, id: 'fallacy', title: 'Absence-of-errors is a fallacy',
    plain: 'A system with no known defects can still be the wrong system. Working is not the same as useful.' },
];

/**
 * The test activities (CTFL 1.4.1), in the order the syllabus lists them.
 *
 * The spine the tool list hangs on: each capability sits under the activity it serves, so the list
 * is the process and "what have I not done yet" is a question the screen can answer.
 */
export const ACTIVITIES = [
  { id: 'planning', n: 1, label: 'Planning', labelAr: 'التخطيط',
    what: 'Decide what this run is for, and where it applies.',
    ref: 'CTFL 1.4.1 / 5.1' },
  { id: 'monitoring', n: 2, label: 'Monitoring & control', labelAr: 'المراقبة والتحكم',
    what: 'Watch what the run is actually producing while it happens.',
    ref: 'CTFL 1.4.1 / 5.3' },
  { id: 'analysis', n: 3, label: 'Analysis', labelAr: 'التحليل',
    what: 'Work out what there is to test: the conditions, from the test basis.',
    ref: 'CTFL 1.4.1 / 4.1' },
  { id: 'design', n: 4, label: 'Design', labelAr: 'التصميم',
    what: 'Turn those conditions into concrete cases and data.',
    ref: 'CTFL 1.4.1 / 4.2–4.4' },
  { id: 'implementation', n: 5, label: 'Implementation', labelAr: 'التهيئة',
    what: 'Get everything ready to run: locators, environment, state.',
    ref: 'CTFL 1.4.1' },
  { id: 'execution', n: 6, label: 'Execution', labelAr: 'التنفيذ',
    what: 'Run it, and record what actually happened.',
    ref: 'CTFL 1.4.1' },
  { id: 'completion', n: 7, label: 'Completion', labelAr: 'الإكمال',
    what: 'Turn the run into testware somebody else can use: report, defect, hand-over.',
    ref: 'CTFL 1.4.1 / 5.5' },
];

/**
 * Which activity each capability serves, and by which technique.
 *
 * The technique and test-type names are the syllabus's own vocabulary, so a tester can say
 * "boundary value analysis on the amount field" in the words their certification uses.
 */
export const TOOL_ACTIVITY = {
  session: { activity: 'planning', technique: 'Session-based test management', testType: null, principle: 'context' },
  charter: { activity: 'planning', technique: 'Test charter', testType: null, principle: 'context' },
  pick: { activity: 'implementation', technique: 'Testware: reusable locators', testType: null, principle: null },
  mask: { activity: 'execution', technique: 'Test data protection: redaction at capture', testType: 'Non-functional (security, privacy)', principle: 'context' },
  storage: { activity: 'implementation', technique: 'Test environment and data setup', testType: null, principle: null },
  inject: { activity: 'design', technique: 'Equivalence partitioning · boundary value analysis', testType: 'Black-box', principle: 'exhaustive' },
  blackbox: { activity: 'design', technique: 'Equivalence partitioning · BVA · decision tables · state transition', testType: 'Black-box (CTFL 4.2)', principle: 'exhaustive' },
  whitebox: { activity: 'design', technique: 'Statement coverage, measured by V8', testType: 'White-box (CTFL 4.3)', principle: 'presence' },
  viewport: { activity: 'execution', technique: 'Portability testing at real viewport sizes', testType: 'Non-functional (portability)', principle: 'context' },
  crossbrowser: { activity: 'implementation', technique: 'Compatibility testing: a runnable Playwright project', testType: 'Non-functional (compatibility)', principle: 'context' },
  break: { activity: 'design', technique: 'Error guessing · negative testing', testType: 'Experience-based', principle: 'exhaustive' },
  rtl: { activity: 'design', technique: 'Checklist-based, localisation', testType: 'Non-functional', principle: 'context' },
  a11y: { activity: 'analysis', technique: 'Static analysis and checklist-based review', testType: 'Non-functional (accessibility)', principle: 'presence' },
  perf: { activity: 'execution', technique: 'Dynamic measurement', testType: 'Non-functional (performance efficiency)', principle: 'presence' },
  record: { activity: 'execution', technique: 'Evidence capture', testType: null, principle: null },
  shot: { activity: 'execution', technique: 'Evidence capture', testType: null, principle: null },
  note: { activity: 'monitoring', technique: 'Test log', testType: null, principle: 'clustering' },
  testcase: { activity: 'completion', technique: 'Test case (ISO/IEC/IEEE 29119-3 §8)', testType: null, principle: 'pesticide' },
  defect: { activity: 'completion', technique: 'Defect report (29119-3 §9)', testType: null, principle: 'clustering' },
  file: { activity: 'completion', technique: 'Defect management (CTFL 5.5)', testType: null, principle: null },
  tell: { activity: 'completion', technique: 'Test progress reporting (CTFL 5.3)', testType: null, principle: null },
  export: { activity: 'completion', technique: 'Testware hand-over', testType: null, principle: null },
};

/**
 * How much of the test process this session has actually touched.
 *
 * Deliberately coverage of the activities, not a score out of ten. A run that
 * never reached completion is not a bad run — it is an unfinished one, and the
 * difference matters. Nothing here judges; it reports.
 */
export function coverage(used = {}) {
  const byActivity = ACTIVITIES.map((a) => {
    const tools = Object.entries(TOOL_ACTIVITY)
      .filter(([, m]) => m.activity === a.id)
      .map(([id]) => id);
    const done = tools.filter((t) => (used[t]?.count ?? 0) > 0);
    return {
      ...a,
      tools,
      done,
      count: done.reduce((n, t) => n + used[t].count, 0),
      touched: done.length > 0,
    };
  });
  const touched = byActivity.filter((a) => a.touched).length;
  return {
    activities: byActivity,
    touched,
    total: ACTIVITIES.length,
    // The first activity with nothing in it — what to suggest next, if anything.
    next: byActivity.find((a) => !a.touched) || null,
  };
}

/**
 * Past this many steps a test case has stopped being one.
 *
 * Not a hard limit and not a truncation point — see `tooLong` below. It is the
 * number at which the document starts recommending a suite instead.
 */
export const TOO_MANY_STEPS = 40;

/* ── deriving a test case from what was recorded ───────────────────────── */

const isAction = (e) => e.kind === 'dom' || e.kind === 'nav';

/** A masked field is named by its own label, not assumed to be a password. */
const maskName = (e) => clampLabel(stepLabel(e) || e.label || e.tag || 'field', 40);

function describeAction(ev) {
  if (ev.kind === 'nav') return `Open ${ev.url}`;
  // r5-04-3: one wording with the repro steps and the spec; a masked secret is never echoed.
  if (ev.action === 'input' && ev.masked) return `Enter the masked value in ${ev.label || ev.tag || 'the element'}`;
  return describeDom(ev).replace(/\*\*/g, '');
}

/**
 * What the system did immediately after a step — the observed result.
 *
 * Used to *seed* the expected result, never to assert it. A recorder can say
 * what happened; only a person can say what should have happened, and a test
 * case whose expected result was copied from a buggy run is worse than no test
 * case at all. Anything derived this way is marked, and the exporters flag it.
 */
function observedAfter(events, step, next) {
  const until = next ? next.ts : step.ts + 5000;
  const after = events.filter((e) => e.ts > step.ts && e.ts <= until);

  const failure = after.find(liteProblem);
  if (failure) {
    if (failure.kind === 'net') {
      return {
        text: `The request ${failure.method} ${failure.url} returned ${failure.error ? 'a network error' : failure.status}.`,
        observed: true,
        failed: true,
      };
    }
    return { text: failure.text, observed: true, failed: true };
  }

  const nav = after.find((e) => e.kind === 'nav');
  if (nav) return { text: `The page moves to ${nav.url}.`, observed: true };

  const net = after.find((e) => e.kind === 'net' && e.status >= 200 && e.status < 400);
  if (net) return { text: `${net.method} ${net.url} succeeds (${net.status}).`, observed: true };

  return { text: '', observed: false };
}

/**
 * Turn a recorded session into an ISTQB-shaped test case.
 *
 * Everything derivable is derived; everything that needs judgement is left
 * blank and named, so the tester fills it rather than discovering later that the
 * tool invented it.
 */
export function buildTestCase(session, events, options = {}) {
  const actions = events.filter(isAction);
  const failures = events.filter(liteProblem);

  // Navigation before the first real interaction is set-up, not a test step.
  // A case that starts "1. Open the login page" when the point is what happens
  // after login buries its own objective.
  const firstInteraction = actions.findIndex((e) => e.kind === 'dom');
  const setup = firstInteraction > 0 ? actions.slice(0, firstInteraction) : [];
  const body = firstInteraction > 0 ? actions.slice(firstInteraction) : actions;

  const steps = body.map((ev, i) => {
    const expected = observedAfter(events, ev, body[i + 1]);
    return {
      number: i + 1,
      action: describeAction(ev),
      // The locator makes the step automatable as well as readable.
      locator: ev.locator ? `page.${ev.framePrefix || ''}${ev.locator}` : null,
      data: ev.action === 'input' || ev.action === 'change' || ev.action === 'upload' ? (ev.masked ? `«${maskName(ev)}»` : ev.value ?? '') : null,
      expected: expected.text,
      // Marked, so nobody mistakes "what happened" for "what should happen".
      expectedDerived: expected.observed,
      // A step whose observed result was a failure cannot be the expected one.
      expectedIsFailure: !!expected.failed,
    };
  });

  const testData = body
    .filter((e) => e.action === 'input' || e.action === 'change' || e.action === 'upload')
    .map((e) => ({ field: e.label || e.tag || 'field', value: e.masked ? `«${maskName(e)}»` : e.value ?? '', masked: !!e.masked }));

  return {
    identifier: options.identifier || `TC-${new Date(session.startedAt).toISOString().slice(0, 10).replace(/-/g, '')}-${session.id.slice(-4).toUpperCase()}`,
    objective: options.objective || session.charter || 'Verify the recorded flow',
    level: options.level || 'System',
    type: options.type || 'Functional',
    priority: options.priority || 'medium',

    preconditions: [
      session.startUrl ? `The application is reachable at ${session.startUrl}` : null,
      ...setup.map(describeAction),
      ...(options.preconditions || []),
      testData.some((d) => d.masked) ? `Valid values for the masked fields (${[...new Set(testData.filter((d) => d.masked).map((d) => d.field))].slice(0, 5).join(', ')}) are available; they are held outside this document` : null,
    ].filter(Boolean),

    testData,
    steps,

    postconditions: options.postconditions || [],

    environment: {
      url: session.startUrl || null,
      browser: session.env?.userAgent || null,
      viewport: session.env?.viewport || null,
      platform: session.env?.platform || null,
      language: session.env?.language || null,
    },

    // The traceability CTFL insists on: a case that traces to nothing cannot be
    // shown to cover anything.
    traceability: {
      epic: options.epic || null,
      story: options.story || null,
      requirement: options.requirement || null,
    },

    // Honesty markers the exporters surface.
    derivedFrom: { sessionId: session.id, recordedAt: session.startedAt, events: events.length },

    /**
     * A case this long is not a case.
     *
     * A 20,000-event session derives a 13,333-step test case and 704KB of
     * Markdown, and nobody will ever run it. The syllabus has an answer to this
     * and it is not truncation — it is that a long flow is a *suite* of cases,
     * each independently runnable and independently reportable. So the document
     * is built in full and says so, rather than being silently cut (which would
     * lose evidence) or presented as usable (which would waste an afternoon).
     */
    tooLong: steps.length > TOO_MANY_STEPS
      ? `${steps.length} steps. A case anyone will actually run is closer to ${TOO_MANY_STEPS}. ` +
        'Build a test suite instead. It splits this flow into sub-cases at its own seams, ' +
        'so a failure halfway through no longer hides everything after it.'
      : null,

    // A case with no steps needs review most of all: `.some()` on an empty array is false, and a clean bill of health there would mislead.
    needsReview:
      !steps.length ||
      steps.some((s) => s.expectedIsFailure) ||
      steps.some((s) => !s.expected) ||
      failures.length > 0,
  };
}

/* ── the defect report ─────────────────────────────────────────────────── */

/**
 * Starting severity, from the evidence.
 *
 * A suggestion, never a verdict — the exporters say so, and the UI lets it be
 * changed before anything is filed. But an unhandled exception really is worse
 * than a 404, and starting from that beats starting from "Medium" every time.
 */
export function suggestSeverity(chain, { startUrl = '' } = {}) {
  const f = chain?.failure;
  if (!f) return 'minor';
  if (f.kind === 'pageerror') return 'major';
  if (f.kind === 'net') {
    if (peripheralFailure(f, startUrl)) return 'minor';
    if (f.error) return 'critical';
    if (f.status >= 500) return 'critical';
    if (f.status === 403 || f.status === 401) return 'major';
    if (f.status >= 400) return 'moderate';
  }
  if (f.kind === 'console') return 'moderate';
  return 'minor';
}

const ASSET_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav|m4a|map)(?:$|[?#])/i;
const hostOf = (u) => { try { return new URL(String(u)).hostname.toLowerCase(); } catch { return ''; } };

/** shop.example.com and api.example.com are one site; example.co.uk keeps three labels. */
const siteOf = (h) => {
  const p = h.split('.');
  const keep = p.length > 2 && p[p.length - 1].length === 2 && /^(?:co|com|org|net|gov|edu|ac)$/.test(p[p.length - 2]) ? 3 : 2;
  return p.slice(-keep).join('.');
};

/**
 * r2-04-2: a failed request that does not stop the task: an image, icon, font or media load, another site, or one
 * the browser blocked or aborted. The resource type wins; else the URL extension and the start host decide.
 */
function peripheralFailure(f, startUrl) {
  if (/ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/i.test(`${typeof f.error === 'string' ? f.error : ''} ${f.errorText || ''}`)) return true;
  const type = String(f.resourceType || f.type || '').toLowerCase();
  if (/^(?:image|font|media|stylesheet|ping|beacon)$/.test(type)) return true;
  if (!type && !/^(?:fetch|xhr|document)$/.test(String(f.via || '')) && ASSET_EXT.test(String(f.url || ''))) return true;
  const h = hostOf(f.url);
  const s = hostOf(startUrl);
  if (h && s && siteOf(h) !== siteOf(s)) return true;
  return false;
}

/**
 * Starting priority.
 *
 * Deliberately *not* a copy of severity — that is the exact conflation the
 * syllabus warns against. Urgency comes from where the failure sits: something
 * that broke on the main flow the tester was walking is urgent regardless of
 * how dramatic it looked.
 */
export function suggestPriority(chain, { onMainFlow = true, startUrl = '' } = {}) {
  const severity = suggestSeverity(chain, { startUrl });
  if (!onMainFlow) return severity === 'critical' ? 'high' : 'low';
  if (severity === 'critical') return 'highest';
  if (severity === 'major') return 'high';
  if (severity === 'moderate') return 'medium';
  return 'low';
}

// A copy of DOC_LABELS.ar.byPage (doc-labels.js is 11 KB and this module loads on every worker start); test-istqb pins that they agree.
export const BY_PAGE_AR = '(نفذته الصفحة)';

export function buildDefectReport(session, events, options = {}) {
  const chains = correlate(events);
  // D-1010-81: the worst chain by suggested severity, the earliest on a tie; the rest go in `actual`.
  const problems = chains.filter((c) => liteProblem(c.failure));
  const rank = (c) => SEVERITY.findIndex((s) => s.id === suggestSeverity(c, { startUrl: session.startUrl }));
  const worst = problems.reduce((w, c) => (!w || rank(c) < rank(w) ? c : w), null);
  const chain = options.chain || worst;
  const failures = events.filter(liteProblem);
  const notes = events.filter(isTesterNote);
  const perf = [...events].reverse().find((e) => e.kind === 'perf');
  const a11y = [...events].reverse().find((e) => e.kind === 'a11y');

  const what = chain
    ? chain.failure.kind === 'net'
      ? `${chain.failure.method} ${shortUrl(chain.failure.url)} returns ${chain.failure.error ? 'a network error' : chain.failure.status}`
      : chain.failure.text
    : session.charter;

  return {
    identifier: options.identifier || `DEF-${new Date(session.startedAt).toISOString().slice(0, 10).replace(/-/g, '')}-${session.id.slice(-4).toUpperCase()}`,
    /**
     * A headline: query strings dropped, the trigger shortened to the action, 120 characters at most (list views
     * show about sixty). The full URL stays in `actual`, the steps and the evidence.
     */
    summary: (chain && chain.trigger ? `${what} after ${lowerFirst(triggerPhrase(chain.trigger))}` : what || 'Defect')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120),

    // The two axes, always both, never merged.
    severity: options.severity || suggestSeverity(chain, { startUrl: session.startUrl }),
    priority: options.priority || suggestPriority(chain, { ...options, startUrl: session.startUrl, onMainFlow: options.onMainFlow ?? !!chain?.trigger }),
    severityIsSuggestion: !options.severity,
    priorityIsSuggestion: !options.priority,

    status: options.status || 'new',
    reportedAt: Date.now(),
    reportedBy: options.reportedBy || options.tester || null,

    // When in the lifecycle it was seen and how it was tested (CTFL 5.5, 29119-3): the Jira tab's two selects.
    testLevel: options.level || null,
    testType: options.type || null,
    build: String(options.build ?? '').trim().slice(0, 120), // D-1010-131: free text; empty renders "not stated"
    reproducibility: REPRODUCIBILITY.includes(options.reproducibility) ? options.reproducibility : 'unknown',

    // 29119-3 wants these as separate fields, because "it did not work" is the
    // single least actionable sentence in testing.
    expected: options.expected || '',
    actual: chain ? [...new Set([describeFailure(chain.failure), ...problems.filter((c) => c !== chain).map((c) => describeFailure(c.failure))])].join('; ') : failures.map(describeFailure).join('; '),

    steps: reproSteps(events, options.byPage || (/^ar/i.test(session?.env?.language || '') ? BY_PAGE_AR : undefined)).map((s) => s.replace(/^\d+\.\s*/, '')),

    // What the failure touches, and who it touches. CTFL calls this the impact.
    impact: {
      scope: options.scope || (chain?.trigger ? 'The flow the tester was walking' : 'Background activity'),
      severityRationale: severityRationale(chain, session.startUrl),
      affectedArea: chain?.failure?.frameUrl || session.startUrl || null,
    },

    environment: {
      url: session.startUrl || null,
      browser: session.env?.userAgent || null,
      viewport: session.env?.viewport || null,
      platform: session.env?.platform || null,
      language: session.env?.language || null,
      recordedAt: new Date(session.startedAt).toISOString(),
    },

    evidence: {
      responseBody: chain?.failure?.responsePreview || null,
      stack: chain?.failure?.stack || null,
      locator: chain?.trigger?.locator ? `page.${chain.trigger.framePrefix || ''}${chain.trigger.locator}` : null,
      gapMs: chain?.gapMs ?? null,
      confidence: chain?.confidence || 'none',
      screenshots: events.filter((e) => e.kind === 'screenshot').length,
      recordings: events.filter((e) => e.kind === 'recording').length,
      pageSpeed: perf ? { lcp: perf.metrics?.lcp, cls: perf.metrics?.cls, requests: perf.resources?.count } : null,
      accessibility: a11y ? { total: a11y.total, rules: a11y.violations.length } : null,
    },

    notes: notes.map((n) => ({ tag: n.tag || null, text: n.text })),

    traceability: {
      epic: options.epic || null,
      story: options.story || null,
      testCase: options.testCase || null,
      sessionId: session.id,
    },

    // How many other failures rode along, so a report is not filed as one bug
    // when it is really five.
    relatedFailures: chains.length - (chain ? 1 : 0),
  };
}

/**
 * A URL short enough to read, keeping the part that identifies the endpoint.
 *
 * The path is what a person recognises; the query string is usually a token, a
 * timestamp or a cache-buster, and it is always the longest part.
 */
function shortUrl(url) {
  const text = String(url || '');
  try {
    const u = new URL(text, 'https://placeholder.invalid');
    const path = u.pathname || '/';
    return u.origin === 'https://placeholder.invalid' ? path : `${u.host}${path}`;
  } catch {
    return text.split('?')[0].slice(0, 80);
  }
}

/** The trigger, as a phrase rather than as a whole navigation. */
function triggerPhrase(trigger) {
  const said = describeAction(trigger);
  // "Open https://…?a=1&b=2" is the one action whose description is mostly URL.
  return trigger.kind === 'nav' ? `opening ${shortUrl(trigger.url)}` : said;
}

const lowerFirst = (s) => {
  const first = String(s).split(/\s/, 1)[0] || '';
  if (first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first)) return String(s);
  return String(s).replace(/^./, (c) => c.toLowerCase());
};

function describeFailure(f) {
  if (!f) return '';
  if (f.kind === 'net') {
    return `${f.method} ${f.url} returned ${f.error ? 'a network error' : f.status} after ${Math.round(f.durationMs || 0)}ms`;
  }
  if (f.kind === 'console') return `The console reported: ${f.text}`;
  if (f.kind === 'pageerror') return `An uncaught error was thrown: ${f.text}`;
  return f.text || String(f.kind);
}

function severityRationale(chain, startUrl = '') {
  const f = chain?.failure;
  if (!f) return 'No failure was captured.';
  if (f.kind === 'pageerror') return 'An uncaught exception leaves the page in an unknown state.';
  if (f.kind === 'net' && peripheralFailure(f, startUrl)) return 'An image, font, icon, third-party or browser-blocked request failed; the page still does what the user came to do.';
  if (f.kind === 'net' && f.error) return 'The request never completed, so the user sees nothing at all.';
  if (f.kind === 'net' && f.status >= 500) return 'A server error means the action did not happen and cannot be retried by the user.';
  if (f.kind === 'net' && (f.status === 401 || f.status === 403)) return 'The user is refused access to something the flow requires.';
  if (f.kind === 'net') return 'The request failed but the application may still be usable.';
  if (f.kind === 'console') return 'The application logged an error; user impact needs confirming.';
  return 'Impact needs confirming by the tester.';
}
