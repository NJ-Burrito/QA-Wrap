/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * What goes into an issue that is not a defect report or a test case.
 *
 * A session is evidence of how a feature behaves. That evidence writes a
 * defect (what broke), a test case (how to check it), and — with the same
 * facts arranged differently — a story (what the user needs), an epic (the
 * scope that was walked), a task (the steps to redo it) or a sub-task. Each
 * template is a starting text the tester edits before filing; none is sent
 * unread.
 *
 * Every template ends with the evidence block, because a ticket that names
 * its session id can always be traced back to the run that produced it.
 */

import { correlate, reproSteps, areasCovered } from './artifact.js';
import { byPageOf } from './artifact-docs.js';

export const KINDS = [
  { id: 'defect', label: 'Defect report', jira: /bug|defect|incident|fault/i, hint: 'ISO/IEC/IEEE 29119-3 defect report: what broke, where, how to see it again.' },
  { id: 'testcase', label: 'Test case', jira: /test|scenario/i, hint: '29119-3 test case: preconditions, steps, expected results.' },
  { id: 'story', label: 'User story', jira: /story/i, hint: 'As a … I want … so that …, with acceptance criteria drawn from the steps you took.' },
  { id: 'epic', label: 'Epic', jira: /epic/i, hint: 'The scope this session walked: the pages, the flows, what passed and what did not.' },
  { id: 'task', label: 'Task', jira: /^task$/i, hint: 'A plain unit of work: the steps, the result, the evidence.' },
  { id: 'subtask', label: 'Sub-task', jira: /sub-?task/i, hint: 'The same as a task, filed under a parent issue you choose.' },
  { id: 'plain', label: 'Plain issue', jira: /./, hint: 'A title and a description you write, with the evidence attached.' },
];

const when = (ts) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
const host = (url) => { try { return new URL(url).host; } catch { return url || ''; } };

/** The evidence block every template ends with. */
function evidence(session, events) {
  const failures = correlate(events).length;
  const shots = events.filter((e) => e.kind === 'screenshot').length;
  const lines = [
    '## Evidence',
    `- Session \`${session.id}\`, recorded ${when(session.startedAt)} on ${host(session.startUrl)}`,
    `- ${events.filter((e) => e.kind === 'dom').length} interactions, ${events.filter((e) => e.kind === 'net').length} requests, ${failures} failure${failures === 1 ? '' : 's'}, ${shots} screenshot${shots === 1 ? '' : 's'}`,
  ];
  const env = session.env || {};
  if (env.userAgent) lines.push(`- ${env.platform || ''} · ${env.viewport || ''} · ${env.language || ''}`.replace(/\s·\s$/, ''));
  lines.push('- Screenshots, the session sheet and the network log are attached by QA Wrap.');
  return lines.join('\n');
}

/** Numbered steps from what the tester did, in plain words. */
function steps(session, events) {
  const list = reproSteps(events, byPageOf(session, events)).map((s) => s.replace(/^\d+\.\s*/, ''));
  return list.length ? list.map((s, i) => `${i + 1}. ${s}`).join('\n') : '1. (no interactions were recorded)';
}

export function draft(kind, session, events, { defect, testcase } = {}) {
  const charter = session.charter || 'Recorded session';
  const areas = areasCovered(events);
  const fails = correlate(events);
  const shotCount = events.filter((e) => e.kind === 'screenshot').length;

  switch (kind) {
    case 'story':
      return {
        summary: charter,
        body: [
          `## Story`,
          `**As a** user of ${host(session.startUrl) || 'the application'},`,
          `**I want** ${charter.replace(/^[A-Z]/, (c) => c.toLowerCase())},`,
          `**so that** I can complete the task without a failure.`,
          '',
          '## Acceptance criteria',
          ...reproSteps(events, byPageOf(session, events)).slice(0, 12).map((s, i) => `${i + 1}. Given the page, when I ${s.replace(/^\d+\.\s*/, '').replace(/^[A-Z]/, (c) => c.toLowerCase())}, then it succeeds.`),
          ...(fails.length ? ['', `Currently ${fails.length} of these fail. See the attached defect report.`] : []),
          '',
          evidence(session, events),
        ].join('\n'),
      };
    case 'epic':
      return {
        summary: `${charter}: scope walked on ${when(session.startedAt).slice(0, 10)}`,
        body: [
          '## Scope',
          `The session "${charter}" covered ${areas.length ? areas.length : 'these'} area${areas.length === 1 ? '' : 's'}:`,
          ...areas.map((a) => `- ${a.url} (${a.hits} event${a.hits === 1 ? "" : "s"})`),
          '',
          '## Outcome',
          `- ${fails.length} failure${fails.length === 1 ? '' : 's'} linked to the actions that caused them`,
          `- ${shotCount} screenshot${shotCount === 1 ? '' : 's'} kept as evidence`,
          '',
          '## Child issues to create',
          '- One defect per failure in the attached defect report',
          '- One test case per acceptance criterion in the attached test case',
          '',
          evidence(session, events),
        ].join('\n'),
      };
    case 'task':
    case 'subtask':
      return {
        summary: charter,
        body: ['## Steps', steps(session, events), '', '## Result', fails.length ? `${fails.length} failure${fails.length === 1 ? '' : 's'}. See the defect report.` : 'No failures recorded.', '', evidence(session, events)].join('\n'),
      };
    case 'plain':
      return { summary: charter, body: ['', evidence(session, events)].join('\n') };
    case 'testcase':
      return { summary: testcase ? `${testcase.identifier}: ${testcase.objective}` : charter, body: testcase?.markdown || '' };
    case 'defect':
    default:
      return { summary: defect?.summary || charter, body: defect?.markdown || '' };
  }
}

/** The Jira issue type that best matches a kind, from the project's own list. */
export function pickIssueType(kind, types) {
  const k = KINDS.find((x) => x.id === kind) || KINDS[KINDS.length - 1];
  const named = types.find((t) => k.jira.test(t.name) && (kind === 'subtask' ? t.subtask : !t.subtask));
  return named || types.find((t) => !t.subtask) || types[0] || null;
}
