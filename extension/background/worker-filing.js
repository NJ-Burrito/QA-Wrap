/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Test-case, defect and suite drafting and filing: ISTQB drafts, Jira suite filing and status sync, duplicates, quick filing and chat notification. Moved out of service-worker.js (OF-18), unchanged. */

import { buildTestCase, buildDefectReport } from '../core/istqb.js';
import { testCaseToMarkdown, testCaseToGherkin, defectToMarkdown, testCaseToAdf, defectToAdf } from './istqb-render-door.js';
import { buildTestSuite, suiteToMarkdown, filingPlan, addRelation, scanOutbound } from './media.js';
import * as jira from './jira-door.js';
import { putSession } from '../core/db.js';
import { getSettings } from '../platform/settings.js';
import * as chat from './notify.js';
import { plural } from './worker-base.js';
import {
  QUICK_ATTACH, addNote, draft, jiraConfig, jiraReady, knownSecrets, loadSession, mustSession, refuse, rememberFiled,
  rememberSession,
} from './worker-session.js';

/* ------------------------------------------------- ISTQB artefacts (25) */

/**
 * The two documents the standard describes, built from what was recorded.
 *
 * Both are returned as data, not text: the UI shows the fields, lets the tester
 * correct the judgement calls a recorder cannot make — the expected result, the
 * severity, the priority — and only then renders and files. Generating straight
 * to a ticket would bake in guesses.
 */
/**
 * Options travel nested, deliberately.
 */
export async function istqbTestCase({ sessionId, options = {} }) {
  const { session, events } = await loadSession(sessionId);
  const tc = buildTestCase(session, events, options);
  const [markdown, gherkin] = await Promise.all([testCaseToMarkdown(tc), testCaseToGherkin(tc)]);
  return { testCase: tc, markdown, gherkin };
}

export async function istqbDefect({ sessionId, options = {} }) {
  const { session, events } = await loadSession(sessionId);
  const report = buildDefectReport(session, events, options);
  return { defect: report, markdown: await defectToMarkdown(report) };
}

/**
 * A session as a parent case with children.
 *
 * Held in session storage between building and filing, because filing needs the
 * exact object the tester looked at — rebuilding it at file time would quietly
 * file a different document if anything changed in between, and "it filed
 * something other than what I approved" is the one failure this feature cannot
 * have.
 */
export async function istqbSuite({ sessionId, options = {} }) {
  const { session, events } = await loadSession(sessionId);
  const suite = await buildTestSuite(session, events, options);
  await chrome.storage.session.set({ suiteDraft: suite });
  return { suite, markdown: await suiteToMarkdown(suite), plan: await filingPlan(suite) };
}

export async function suiteRelate({ relation }) {
  const { suiteDraft } = await chrome.storage.session.get('suiteDraft');
  if (!suiteDraft) throw new Error('Build the suite first.');
  const next = await addRelation(suiteDraft, relation);
  await chrome.storage.session.set({ suiteDraft: next });
  return { suite: next, markdown: await suiteToMarkdown(next) };
}

/** File the whole tree: parent, children, defects, then links. A failed step does not stop the rest. */
export async function fileSuiteInJira({ projectKey, parentType, caseType, defectType, epicKey, redact, allowSecrets }) {
  const { suiteDraft: suite } = await chrome.storage.session.get('suiteDraft');
  if (!suite) throw new Error('Build the suite first.');

  const cfg = await jiraConfig();
  const project = projectKey || cfg.project;
  if (!project) throw new Error('No Jira project chosen.');

  const plan = await filingPlan(suite, {
    parentType: parentType || cfg.testIssueType || 'Task',
    caseType: caseType || cfg.testIssueType || 'Task',
    defectType: defectType || cfg.issueType || 'Bug',
  });

  const sessionId = suite.derivedFrom?.sessionId;
  const steps = [];
  for (const step of plan.steps) {
    const source =
      step.kind === 'suite' ? suite
        : step.kind === 'case' ? suite.cases.find((c) => c.identifier === step.ref)
          : suite.defects.find((d) => d.identifier === step.ref);
    steps.push({
      ref: step.ref, kind: step.kind, summary: step.summary, typeName: step.issueType, links: step.links,
      labels: ['qa-wrap', step.kind, ...(step.kind === 'defect' ? [`severity-${source.severity}`] : [])],
      evidence: step.kind === 'defect', // defects carry the screenshots and the network log
      adf: step.kind === 'suite' ? suiteToAdf(suite) : step.kind === 'case' ? await testCaseToAdf(source) : await defectToAdf(source),
    });
  }

  const out = refuse(await jira.fileSuite(cfg, {
    project, steps, epicKey, redact, allow: allowSecrets, known: await knownSecrets(),
    attach: sessionId ? { ...QUICK_ATTACH.defect, version: chrome.runtime.getManifest().version } : null,
    sessionId,
  }));

  await addNote(
    `Filed a suite in Jira: ${out.created.filter((c) => c.key).length} of ${plan.total} issues, parent ${out.parentKey || 'not created'}`,
    'issue'
  ).catch(() => {});
  await rememberFiled(sessionId, out.created.filter((c) => c.key).map((c) => ({ key: c.key, url: c.url, kind: c.kind, ref: c.ref }))).catch(() => {});
  return { ...out, attempted: plan.total };
}

/** The parent's Jira document: a summary and a list of children, not a copy of every step. */
function suiteToAdf(suite) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: suite.objective || suite.title }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text:
              `${plural(suite.summary.cases, 'case')} · ${suite.summary.failed} failed · ` +
              `${suite.summary.notRun} never reached · ${plural(suite.summary.defects, 'defect')}.`,
          },
        ],
      },
      ...(suite.needsReview
        ? [{
            type: 'panel',
            attrs: { panelType: 'warning' },
            content: [{
              type: 'paragraph',
              content: [{
                type: 'text',
                text:
                  'Review before use. One or more expected results were copied from what the ' +
                  'application did, or are blank. A recording cannot know what should have happened.',
              }],
            }],
          }]
        : []),
      {
        type: 'bulletList',
        content: suite.cases.map((c) => ({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `${c.identifier}: ${c.objective} (${c.outcome})` }],
          }],
        })),
      },
    ],
  };
}

/** Ask the tracker what happened to what we filed. On demand only, never on a timer. */
const SYNC_TTL = 60_000; // an answer this young is served from the session

const SYNC_MIN_GAP = 10_000; // `force` cannot ask Jira more often than this

export async function syncJiraStatus({ sessionId, force = false }) {
  const session = await mustSession(sessionId);

  const filed = session.filed || [];
  if (!filed.length) {
    return { synced: 0, filed: [], summary: await jira.summariseStatuses([]), cached: false, checkedAt: null };
  }

  const age = Date.now() - (session.filedCheckedAt || 0);
  if (session.filedSummary && age < (force ? SYNC_MIN_GAP : SYNC_TTL)) {
    return { synced: 0, filed, summary: session.filedSummary, cached: true, checkedAt: session.filedCheckedAt, retryAfterMs: (force ? SYNC_MIN_GAP : SYNC_TTL) - age };
  }

  const cfg = await jiraConfig();
  if (!jiraReady(cfg)) {
    throw new Error('Jira is not configured, so there is nothing to ask. Open Settings › Integrations.');
  }

  const statuses = await jira.issueStatus(cfg, filed.map((f) => f.key));
  const byKey = new Map(statuses.map((s) => [s.key, s]));

  session.filed = filed.map((f) => ({ ...f, ...(byKey.get(f.key) || {}), checkedAt: Date.now() }));
  session.filedSummary = await jira.summariseStatuses(statuses);
  session.filedCheckedAt = Date.now();
  await putSession(session);
  rememberSession(session);

  return { synced: statuses.length, filed: session.filed, summary: session.filedSummary, cached: false, checkedAt: session.filedCheckedAt };
}

/** Open issues that look like this one (fingerprint label, then summary terms), at most three. */
export async function findJiraDuplicates({ sessionId, projectKey, summary, url }) {
  const cfg = await jiraConfig();
  if (!jiraReady(cfg)) throw new Error('No Jira credentials saved. Settings › Integrations.');
  const project = projectKey || cfg.project;
  if (!project) throw new Error('No Jira project chosen.');
  const { session } = sessionId ? await loadSession(sessionId) : {};
  return jira.findDuplicates(cfg, { projectKey: project, url: url || session?.startUrl, summary: summary || (session ? await draft('ticketTitle', { sessionId }) : '') });
}

/** The draft the report page shows and lets the tester edit; built by the same functions the ISTQB panel calls. */
export async function draftForJira({ sessionId, kind = 'defect', options = {} }) {
  if (kind === 'testcase') {
    const { testCase, markdown } = await istqbTestCase({ sessionId, options });
    return { summary: `${testCase.identifier}: ${testCase.objective}`, body: markdown };
  }
  if (kind === 'defect') {
    const { defect, markdown } = await istqbDefect({ sessionId, options });
    return { summary: defect.summary, body: markdown };
  }
  await mustSession(sessionId);
  return draft('draftIssue', { kind, sessionId });
}

/** What a confirmation shows; answered here because the page must not hold credentials. */
export async function quickFilePlan({ kind = 'defect' } = {}) {
  const cfg = await jiraConfig();
  const attach = QUICK_ATTACH[kind] || QUICK_ATTACH.defect;
  return {
    kind,
    configured: jiraReady(cfg) && !!cfg.project,
    site: cfg.baseUrl || '',
    project: cfg.project || '',
    issueType:
      kind === 'defect' ? cfg.issueType || '' : kind === 'testcase' ? cfg.testIssueType || '' : '',
    screenshots: !!attach.screenshots,
    formats: attach.formats || [],
  };
}

/* --------------------------------------------------- chat and bots (27) */

export async function notifyAll({ sessionId, defectOptions, links = {}, only }) {
  const settings = await getSettings();
  const all = [...(settings.webhooks || [])];

  // The legacy single Slack webhook still works; it is simply the first
  // destination rather than a special case. It joins the list *before* the
  // filter, not after — added afterwards it ignored `only`, so "send a test to
  // this one destination" also posted to the team's real Slack channel.
  if (settings.slack?.webhookUrl && !all.some((d) => d.url === settings.slack.webhookUrl)) {
    all.unshift({
      id: 'slack-legacy',
      label: 'Slack',
      provider: 'slack',
      url: settings.slack.webhookUrl,
      mention: settings.slack.mention,
    });
  }

  const destinations = all.filter((d) => !only || d.id === only);
  if (only && !destinations.length) {
    throw new Error('That destination is no longer configured.');
  }
  if (!destinations.length) {
    throw new Error('No chat destination is configured. Open Settings › Integrations and add one.');
  }

  const { session, events } = await loadSession(sessionId);
  const defect = defectOptions === null ? null : buildDefectReport(session, events, defectOptions || {});

  const summary = chat.summarise({ session, events, defect, links });
  // T-012: no catch, a dead scan door fails the post like export
  const flds = { title: summary.title, charter: summary.charter, expected: summary.expected, actual: summary.actual };
  const sc = await scanOutbound({ ...flds, ...summary.steps }, { extra: ['email', 'phone'] }); // R-04: a customer's email or phone typed into a step must not reach a team channel
  chat.noteScan('webhook', sc.findings.length);
  for (const k in flds) if (flds[k]) summary[k] = sc.redacted[k];
  summary.steps = summary.steps.map((_, i) => sc.redacted[i]);
  const results = await chat.broadcast(destinations, summary);

  const sent = results.filter((r) => r.sent).map((r) => r.label);
  if (sent.length) {
    await addNote(`Posted to ${sent.join(', ')}: ${summary.title}`, 'issue').catch(() => {});
  }
  return { results, summary: { title: summary.title, severity: summary.severity }, secretScan: sc.findings };
}
