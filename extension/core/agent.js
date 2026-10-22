/* QA Wrap — local-first QA toolkit in the ISTQB shape. */

/**
 * Whose failure is whose, shared with the report.
 *
 * These three used to be private copies here. The report had none at all,
 * which is how the headline came to count other people's servers — and two
 * copies of a rule this load-bearing is one copy too many.
 */
import { hostOf, sessionHosts, isFirstParty } from './origins.js';
/**
 * The agent brief — one file an AI assistant can read and act on.
 *
 * Every other export answers "what happened?". A coding agent needs a different
 * question answered: **"what should I do about it, and how sure are you?"**
 *
 * Three things go wrong when an agent is handed the raw JSON instead, and each
 * one is fixed here rather than in the prompt of whoever is unlucky enough to
 * read it:
 *
 * 1. **Third-party noise reads as application failure.** A session on a site
 *    carrying Optimizely or a crash reporter produces dozens of blocked beacons.
 *    They are real network failures and the recorder is right to keep them, but
 *    an agent summarising "27 problems found" is reporting the ad blocker, not
 *    the product. Every failure here is therefore classified against the origins
 *    the session actually visited, and third-party ones are counted separately
 *    and never promoted into findings.
 *
 * 2. **Severity is implied, never stated.** A tester's `bug` tag, an axe
 *    *critical*, and a poor INP all matter differently, and an agent asked to
 *    "fix the issues" cannot tell without being told. Findings carry an explicit
 *    severity and the basis it came from.
 *
 * 3. **Confidence gets dropped in the retelling.** `correlate()` is careful to
 *    say `none` when no action lines up with a failure. That honesty is worth
 *    keeping, so it is attached to the finding and restated in words.
 *
 * The shape is deliberately flat and small. It is meant to fit in a context
 * window next to the code being fixed, not to be a second copy of the database —
 * for that, `json` is still the right export.
 */

import { correlate, isFailure, reproSteps, areasCovered } from './artifact.js';
import { liteProblem, isTesterNote } from './events.js';
import { PRODUCT } from './product.js';
import { visibleProblems } from './signal.js';
import { headline, byPageOf } from './artifact-docs.js';
import { problemCounts } from './finding-count.js';

export const AGENT_SCHEMA = 'njb.agent-brief/1';

const secs = (ts, start) => Number(((ts - start) / 1000).toFixed(2));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();




const CONFIDENCE_WORDS = {
  high: 'The action and the failure share a frame and are less than 1.5s apart. Treat the link as reliable.',
  low: 'An action precedes the failure inside the causal window but in a different frame, or further back. A possible link only: confirm before acting.',
  none: 'No recorded action lines up with this failure. It is probably background activity. Do not attribute it to a user step.',
};

const A11Y_SEVERITY = { critical: 'critical', serious: 'high', moderate: 'medium', minor: 'low' };

/**
 * Findings, in one list, ordered by how much they should worry a reader.
 *
 * Everything a human would call "a thing to fix" ends up here regardless of
 * which subsystem noticed it, because an agent should not have to join four
 * arrays to answer "what is wrong with this page".
 */
function buildFindings(session, events, hosts) {
  const start = session.startedAt;
  const out = [];

  /* -- what the tester said, with the tag they chose ---------------------- */
  const TAG_SEVERITY = { bug: 'high', issue: 'medium', question: 'info', null: 'info' };
  for (const e of events.filter(isTesterNote)) {
    const tag = e.tag || 'note';
    out.push({
      id: `note-${e.seq}`,
      source: 'tester-note',
      severity: TAG_SEVERITY[e.tag] ?? 'info',
      tag,
      title: clean(e.text).slice(0, 120),
      detail: clean(e.text),
      atSeconds: secs(e.ts, start),
      url: e.frameUrl || null,
      confidence: 'observed',
      basis: 'A person watched this happen and wrote it down. It is the most reliable item in this file.',
      actionable: tag === 'bug' || tag === 'issue',
    });
  }

  /* -- failures the tool correlated, first party only --------------------- */
  for (const c of correlate(events)) {
    const f = c.failure;
    // Tester-induced noise (an overridden response, an API-test call, a
    // hook-hinted dev console error) is not a finding, and a repeat of an
    // earlier chain is folded into that chain's `occurrences`.
    if (!liteProblem(f) || c.repeatOf) continue;
    if (f.kind === 'net' && !isFirstParty(f.url, hosts)) continue;
    const what =
      f.kind === 'net'
        ? `${f.method} ${f.url} → ${f.error ? 'network error' : f.status}`
        : clean(f.text || f.kind);
    out.push({
      id: `fail-${f.seq}`,
      source: 'correlated-failure',
      severity: c.confidence === 'high' ? 'high' : 'medium',
      title: clean(what).slice(0, 160),
      detail: f.responsePreview ? `${what}\nResponse: ${clean(f.responsePreview).slice(0, 400)}` : what,
      atSeconds: secs(f.ts, start),
      url: f.url || f.frameUrl || null,
      triggeredBy: c.trigger
        ? {
            action: c.trigger.action || c.trigger.kind,
            label: clean(c.trigger.label || c.trigger.url || ''),
            locator: c.trigger.locator || null,
            gapMs: c.gapMs,
          }
        : null,
      confidence: c.confidence,
      basis: CONFIDENCE_WORDS[c.confidence] || '',
      siblingCount: c.siblings?.length || 0,
      occurrences: c.count || 1,
      actionable: c.confidence === 'high' || c.confidence === 'medium',
    });
  }

  /* -- accessibility, one finding per rule -------------------------------- */
  for (const e of events.filter((x) => x.kind === 'a11y')) {
    for (const v of e.violations || []) {
      out.push({
        id: `a11y-${e.seq}-${v.id}`,
        source: 'accessibility',
        severity: A11Y_SEVERITY[v.impact] || 'low',
        title: clean(v.help || v.description || v.id),
        detail: clean(v.description || v.help || ''),
        rule: v.id,
        impact: v.impact || null,
        elementCount: v.count ?? (v.nodes || []).length ?? null,
        helpUrl: v.helpUrl || null,
        selectors: (v.nodes || []).slice(0, 5).map((n) => String(n.target || '')),
        howToFix: clean((v.nodes || [])[0]?.summary || ''),
        atSeconds: secs(e.ts, start),
        url: e.url || e.frameUrl || null,
        confidence: 'measured',
        basis: 'axe-core, the engine Chrome DevTools uses. A pass here is not proof of accessibility: 12 checks still need a person.',
        actionable: true,
      });
    }
  }

  /* -- web vitals the recorder itself rated as missing target ------------ */
  const VITAL_TARGET = { lcp: '2500ms', inp: '200ms', cls: '0.1', fcp: '1800ms', ttfb: '800ms' };
  for (const e of events.filter((x) => x.kind === 'perf')) {
    for (const [metric, rating] of Object.entries(e.ratings || {})) {
      if (rating !== 'poor' && rating !== 'needs-improvement') continue;
      const value = e.metrics?.[metric];
      out.push({
        id: `perf-${e.seq}-${metric}`,
        source: 'performance',
        severity: rating === 'poor' ? 'medium' : 'low',
        title: `${metric.toUpperCase()} is ${metric === 'cls' ? value : Math.round(value) + 'ms'}, rated ${rating}`,
        detail: `Target is ${VITAL_TARGET[metric] || 'the Core Web Vitals threshold'}. Measured in the page as the tester used it (logged in and mid-flow), not a synthetic lab run.`,
        metric,
        value,
        rating,
        target: VITAL_TARGET[metric] || null,
        atSeconds: secs(e.ts, start),
        url: e.url || e.frameUrl || null,
        confidence: 'measured',
        basis: 'One real navigation. Confirm across several before treating it as a trend.',
        actionable: true,
      });
    }
  }

  const ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return out.sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9) || a.atSeconds - b.atSeconds);
}

/**
 * A paragraph an agent reads first.
 *
 * Written as prose on purpose: a model given a table of counts will invent a
 * narrative to go with it, and the invented one is usually wrong about which
 * numbers matter. Saying it plainly costs a hundred tokens and removes the guess.
 */
function briefing(session, events, findings, signal) {
  const bugs = findings.filter((f) => f.source === 'tester-note' && f.tag === 'bug').length;
  const questions = findings.filter((f) => f.tag === 'question').length;
  const linked = findings.filter((f) => f.source === 'correlated-failure' && f.confidence === 'high').length;
  const a11y = findings.filter((f) => f.source === 'accessibility').length;
  const perf = findings.filter((f) => f.source === 'performance').length;

  const parts = [
    `An exploratory test session against ${hostOf(session.startUrl) || 'the application'}, lasting ${Math.round((session.endedAt - session.startedAt) / 1000)}s.`,
    `The charter was: ${clean(session.charter) || '(none recorded)'}.`,
  ];
  parts.push(
    bugs
      ? `The tester flagged ${bugs} defect${bugs === 1 ? '' : 's'} by hand. Those are observations, not inferences, and should be trusted first.`
      : `The tester flagged no defects by hand.`
  );
  parts.push(`${signal.problems} problem${signal.problems === 1 ? "" : "s"} (after the noise rules plus the tester tool findings; ruleset v${signal.ruleset}); ${signal.hiddenNotes} known-benign notes are hidden and kept in the events.`);
  if (linked) parts.push(`${linked} request failure${linked === 1 ? ' was' : 's were'} linked to a specific user action with high confidence.`);
  if (a11y) parts.push(`${a11y} accessibility rule${a11y === 1 ? '' : 's'} failed.`);
  if (perf) parts.push(`${perf} web vital${perf === 1 ? '' : 's'} missed its target.`);
  if (signal.thirdPartyFailures) {
    parts.push(
      `${signal.thirdPartyFailures} further request failure${signal.thirdPartyFailures === 1 ? '' : 's'} came from third-party hosts (${signal.thirdPartyHosts.slice(0, 3).join(', ')}) and have been excluded: they are analytics and crash-reporting beacons, not defects in this application. Do not report them.`
    );
  }
  parts.push(
    `Absence of a finding is not evidence of correctness: only what was exercised in this session was tested, and only by the checks listed under coverage.`
  );
  return parts.join(' ');
}

export function buildAgentBrief(session, events, captures = {}) {
  const hosts = sessionHosts(session, events);
  const findings = buildFindings(session, events, hosts);

  const netFailures = events.filter((e) => e.kind === 'net' && isFailure(e));
  const thirdParty = netFailures.filter((e) => !isFirstParty(e.url, hosts));
  const sg = visibleProblems(events);
  const signal = {
    problems: problemCounts(events).groups, // distinct problems: the same number as the screens, the Markdown row and session.json
    afterNoiseRules: sg.problems,
    toolFindings: headline(events, session).tool,
    ruleset: sg.ruleset,
    hiddenNotes: sg.notes,
    firstPartyFailures: netFailures.length - thirdParty.length,
    thirdPartyFailures: thirdParty.length,
    thirdPartyHosts: [...new Set(thirdParty.map((e) => hostOf(e.url)).filter(Boolean))],
    note: 'Third-party failures are counted but never turned into findings. They belong to the host that sent them.',
  };

  const locators = events
    .filter((e) => e.kind === 'dom' && e.locator)
    .map((e) => ({
      atSeconds: secs(e.ts, session.startedAt),
      action: e.action,
      label: clean(e.label || e.tag || ''),
      locator: e.locator,
      cssSelector: e.selector || null,
      strategy: e.strategy || null,
      matchedAtCapture: e.locatorMatches ?? null,
      ambiguous: Boolean(e.locatorAmbiguous),
      trustworthy: e.locatorMatches === 1 && !e.locatorAmbiguous,
    }));

  const openQuestions = findings.filter((f) => f.tag === 'question').map((f) => f.detail);

  return JSON.stringify(
    {
      schema: AGENT_SCHEMA,
      tool: PRODUCT.name,
      generatedAt: new Date().toISOString(),

      briefing: briefing(session, events, findings, signal),

      howToUse: [
        'Read `briefing` first, then `findings`. Findings are already ordered by severity.',
        'Trust `source: "tester-note"` above everything else. A person saw it.',
        'Never report an item that is not in `findings`; `signal.thirdPartyFailures` is deliberately excluded.',
        'Respect `confidence`. Where it is "none", do not claim a cause.',
        'Use `locators` when writing or repairing a test. Each was checked against the live page at capture time.',
        '`coverage` says what was exercised. Anything outside it is untested, not passing.',
      ],

      session: {
        id: session.id,
        charter: clean(session.charter),
        startedAt: new Date(session.startedAt).toISOString(),
        endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
        durationSeconds: session.endedAt ? Math.round((session.endedAt - session.startedAt) / 1000) : null,
        startUrl: session.startUrl,
        firstPartyHosts: [...hosts],
        environment: session.env || null,
      },

      counts: {
        findings: findings.length,
        bySeverity: findings.reduce((acc, f) => ((acc[f.severity] = (acc[f.severity] || 0) + 1), acc), {}),
        bySource: findings.reduce((acc, f) => ((acc[f.source] = (acc[f.source] || 0) + 1), acc), {}),
        eventsRecorded: events.length,
        screenshots: events.filter((e) => e.kind === 'screenshot').length,
      },

      signal,
      findings,
      openQuestions,

      coverage: {
        areas: areasCovered(events),
        checksRun: [...new Set(events.map((e) => e.kind))].filter((k) => ['a11y', 'perf', 'rtl', 'inject'].includes(k)),
        toolsUsed: session.toolsUsed || {},
        notExercised:
          'Anything not listed under areas was not visited in this session. No pass may be inferred for it.',
      },

      reproSteps: reproSteps(events, byPageOf(session, events)),
      locators,
    },
    null,
    2
  );
}
