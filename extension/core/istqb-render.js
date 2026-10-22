/* QA Wrap — local-first QA toolkit in the ISTQB shape. */

import { SHORT, copyright, token } from './provenance.js';
import { stripControl } from './exporters.js';
import { fenceFor, mdEsc, mdCell, mdCode } from './docshell.js';
import { buildFields } from './formats-export.js';
/**
 * Rendering an ISTQB test case or defect report into the shapes people file.
 *
 * The models in `istqb.js` carry two flags this module must never drop:
 * `expectedDerived` (the expected result was copied from what actually happened)
 * and `severityIsSuggestion` / `priorityIsSuggestion`. A rendered document that
 * quietly presents a derived expectation as a specification is worse than no
 * document — the next person reads it as agreed behaviour. Every renderer here
 * marks them.
 */

/* ── Atlassian Document Format ─────────────────────────────────────────────
   Jira's REST API takes ADF, not wiki markup, and it is fussy: an empty text
   node is a 400, and so is a table whose rows disagree on column count. These
   helpers exist so nothing hand-builds a node. */

// stripControl: a console line's ESC colour code is not a valid ADF character (completion review 6).
const text = (s) => ({ type: 'text', text: stripControl(s).slice(0, 3000) || ' ' });
const strong = (s) => ({ type: 'text', text: String(s ?? '') || ' ', marks: [{ type: 'strong' }] });
const code = (s) => ({ type: 'text', text: stripControl(s) || ' ', marks: [{ type: 'code' }] });
const para = (...content) => ({ type: 'paragraph', content: content.length ? content : [text(' ')] });
const heading = (level, s) => ({ type: 'heading', attrs: { level }, content: [text(s)] });

const bullets = (items) => ({
  type: 'bulletList',
  content: (items.length ? items : ['—']).map((i) => ({
    type: 'listItem',
    content: [Array.isArray(i) ? para(...i) : para(text(i))],
  })),
});

const codeBlock = (s) => ({
  type: 'codeBlock',
  attrs: {},
  content: [text(String(s ?? '').slice(0, 3000) || ' ')],
});

const panel = (kind, ...content) => ({ type: 'panel', attrs: { panelType: kind }, content });

/** Every row must have the same number of cells or Jira rejects the document. */
function table(header, rows) {
  const cell = (node, type) => ({ type, attrs: {}, content: [Array.isArray(node) ? para(...node) : para(text(node))] });
  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: [
      { type: 'tableRow', content: header.map((h) => cell(strong(h), 'tableHeader')) },
      ...rows.map((r) => ({
        type: 'tableRow',
        content: header.map((_, i) => cell(r[i] ?? '—', 'tableCell')),
      })),
    ],
  };
}

/**
 * Every ADF document this file builds, ending with its colophon.
 *
 * Put here rather than at each call site so a document cannot be added later
 * that forgets it — which is the only way a mark like this ever goes missing.
 */
const doc = (...content) => ({
  type: 'doc',
  version: 1,
  content: [...content.filter(Boolean), provenanceBlock()],
});

/* ── test case ─────────────────────────────────────────────────────────── */

export function testCaseToAdf(tc) {
  const stepRows = tc.steps.map((s) => [
    String(s.number),
    s.locator ? [text(s.action), text('  '), code(s.locator)] : s.action,
    s.data ?? '—',
    s.expected || '⚠ to be filled in',
  ]);

  return doc(
    tc.needsReview
      ? panel(
          'warning',
          para(
            strong('Review before use. '),
            text(
              'Expected results marked ⚠ were left blank, and any marked "observed" were copied from what the ' +
                'application actually did during recording, which is not the same as what it should do.'
            )
          )
        )
      : null,

    heading(3, 'Objective'),
    para(text(tc.objective)),

    heading(3, 'Preconditions'),
    bullets(tc.preconditions),

    heading(3, 'Test data'),
    tc.testData.length
      ? table(['Field', 'Value'], tc.testData.map((d) => [d.field, d.masked ? '«held outside this document»' : d.value]))
      : para(text('None beyond the preconditions.')),

    heading(3, 'Steps'),
    table(['#', 'Action', 'Data', 'Expected result'], stepRows),

    tc.postconditions.length ? heading(3, 'Postconditions') : null,
    tc.postconditions.length ? bullets(tc.postconditions) : null,

    heading(3, 'Environment'),
    table(
      ['Item', 'Value'],
      [
        ['URL', tc.environment.url || '—'],
        ['Browser', tc.environment.browser || '—'],
        ['Viewport', tc.environment.viewport || '—'],
        ['Platform', tc.environment.platform || '—'],
        ['Language', tc.environment.language || '—'],
      ]
    ),

    heading(3, 'Classification'),
    table(
      ['Attribute', 'Value'],
      [
        ['Identifier', tc.identifier],
        ['Test level', tc.level],
        ['Test type', tc.type],
        ['Priority', tc.priority],
      ]
    ),

    para(
      text('Derived from a recorded session with QA Wrap · '),
      code(tc.derivedFrom.sessionId),
      text(` · ${tc.derivedFrom.events} events · passwords and cookie values were never recorded.`)
    )
  );
}

/**
 * The colophon on a filed document.
 *
 * One ADF paragraph at the very bottom, in the smallest voice the format has.
 * A triager should never have to scroll past it, and it should be unmistakable
 * to anybody who does look — which is why it is a glyph, a name and a token
 * rather than a sentence about ownership.
 */
export function provenanceBlock(options) {
  return {
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: `${SHORT} · ${copyright(options?.when)} · ${token(options || {})}`,
        marks: [{ type: 'em' }],
      },
    ],
  };
}

export function testCaseToMarkdown(tc) {
  const L = [];
  L.push(`# ${mdEsc(tc.identifier)}: ${mdEsc(tc.objective)}`, '');

  if (tc.needsReview) {
    L.push(
      '> **Review before use.** Expected results marked ⚠ were left blank, and any marked',
      '> _observed_ were copied from what the application actually did during recording,',
      '> which is not the same as what it should do.',
      ''
    );
  }

  // Said at the top, where somebody scrolling a 700KB document will actually
  // meet it, rather than at the bottom after 13,000 steps.
  if (tc.tooLong) {
    L.push(`> **This is too long to be one test case.** ${mdEsc(tc.tooLong)}`, '');
  }

  L.push('| | |', '|---|---|');
  L.push(`| Identifier | ${mdCode(tc.identifier, true)} |`);
  L.push(`| Test level | ${mdEsc(tc.level)} |`);
  L.push(`| Test type | ${mdEsc(tc.type)} |`);
  L.push(`| Priority | ${mdEsc(tc.priority)} |`);
  if (tc.traceability.epic) L.push(`| Epic | ${mdEsc(tc.traceability.epic)} |`);
  if (tc.traceability.story) L.push(`| Story | ${mdEsc(tc.traceability.story)} |`);
  if (tc.traceability.requirement) L.push(`| Requirement | ${mdEsc(tc.traceability.requirement)} |`);
  L.push('');

  L.push('## Preconditions', '');
  tc.preconditions.forEach((p) => L.push(`- ${mdEsc(p)}`));
  if (!tc.preconditions.length) L.push('- None');
  L.push('');

  if (tc.testData.length) {
    L.push('## Test data', '', '| Field | Value |', '|---|---|');
    tc.testData.forEach((d) => L.push(`| ${mdEsc(d.field)} | ${d.masked ? '«held outside this document»' : mdEsc(d.value)} |`));
    L.push('');
  }

  L.push('## Steps', '', '| # | Action | Data | Expected result |', '|---|---|---|---|');
  tc.steps.forEach((s) => {
    const action = s.locator ? `${mdEsc(s.action)}<br>${mdCode(s.locator, true)}` : mdEsc(s.action); // the <br> is ours; everything page-derived is escaped
    const expected = s.expected ? (s.expectedDerived ? `${mdEsc(s.expected)} _(observed)_` : mdEsc(s.expected)) : '⚠ to be filled in';
    L.push(`| ${s.number} | ${action} | ${s.data == null ? '—' : mdEsc(s.data)} | ${expected} |`);
  });
  L.push('');

  if (tc.postconditions.length) {
    L.push('## Postconditions', '');
    tc.postconditions.forEach((p) => L.push(`- ${mdEsc(p)}`));
    L.push('');
  }

  L.push('## Environment', '', '| Item | Value |', '|---|---|');
  L.push(`| URL | ${mdCell(tc.environment.url || '—')} |`);
  L.push(`| Browser | ${mdCell(tc.environment.browser || '—')} |`);
  L.push(`| Viewport | ${mdCell(tc.environment.viewport || '—')} |`);
  L.push(`| Platform | ${mdCell(tc.environment.platform || '—')} |`);
  L.push(`| Language | ${mdCell(tc.environment.language || '—')} |`);
  L.push('');
  L.push(
    `_Derived from session ${mdCode(tc.derivedFrom.sessionId)} (${tc.derivedFrom.events} events) with QA Wrap. ` +
      'Passwords and cookie values were never recorded._'
  );
  return L.join('\n');
}

/**
 * Gherkin, for teams whose test management speaks it.
 *
 * A deliberate compromise is being made and it should be said out loud: a
 * recorded click sequence is a *procedure*, and Gherkin wants *behaviour*. The
 * mapping puts preconditions in Given, actions in When and expectations in Then,
 * which is structurally right and semantically shallow — the scenario will read
 * like a script until someone rewrites the steps in the language of the domain.
 * The header says so, rather than letting a team discover it in review.
 */
export function testCaseToGherkin(tc) {
  const L = [];
  L.push('# Generated from a recorded session by QA Wrap.');
  L.push('# The steps below describe *what was done*, not yet *what the system is for*.');
  L.push('# Rewrite them in the language of the domain before this becomes a living document.');
  L.push('');
  if (tc.traceability.story) L.push(`@story-${String(tc.traceability.story).replace(/\s+/g, '-')}`);
  if (tc.traceability.epic) L.push(`@epic-${String(tc.traceability.epic).replace(/\s+/g, '-')}`);
  L.push(`@${tc.level.toLowerCase().replace(/\s+/g, '-')} @${tc.type.toLowerCase().replace(/[^a-z]+/g, '-')} @priority-${tc.priority}`);
  L.push(`Feature: ${tc.objective}`);
  L.push('');
  L.push(`  Scenario: ${tc.identifier}, ${tc.objective}`);

  tc.preconditions.forEach((p, i) => L.push(`    ${i === 0 ? 'Given' : 'And'} ${lower(p)}`));

  tc.steps.forEach((s, i) => {
    L.push(`    ${i === 0 ? 'When' : 'And'} ${lower(s.action)}`);
    if (s.expected) L.push(`    Then ${lower(s.expected)}${s.expectedDerived ? '   # observed, confirm this is intended' : ''}`);
    else L.push('    Then # ⚠ expected result to be filled in');
  });

  tc.postconditions.forEach((p) => L.push(`    And ${lower(p)}`));
  return L.join('\n');
}

/**
 * Lower-case the first letter so a step reads on from Given/When/Then.
 *
 * Except when the first word is an acronym. It produced
 * `Then gET /w/rest.php/v1/search succeeds` on a real run, and a feature file
 * with `gET` in it looks broken to everyone who opens it — including the
 * parser's reader, who now doubts the rest of the file.
 *
 * The rule: only lower the first character when the first word is not already
 * shouting. `GET`, `POST`, `API`, `URL`, `RTL` all stay as they are.
 */
const lower = (s) => {
  const text = String(s).replace(/\.$/, '');
  const firstWord = text.split(/\s/, 1)[0] || '';
  if (firstWord.length > 1 && firstWord === firstWord.toUpperCase() && /[A-Z]/.test(firstWord)) return text;
  return text.replace(/^./, (c) => c.toLowerCase());
};

/* ── defect report ─────────────────────────────────────────────────────── */

export function defectToAdf(d) {
  const suggestion =
    d.severityIsSuggestion || d.priorityIsSuggestion
      ? panel(
          'note',
          para(
            strong('Severity and priority are suggestions. '),
            text(
              'Severity is the impact on the system; priority is the urgency of the fix. They are separate ' +
                'judgements and this tool can only see the evidence, not the release plan.'
            )
          )
        )
      : null;

  return doc(
    suggestion,

    heading(3, 'Summary'),
    para(text(d.summary)),

    heading(3, 'Expected vs actual'),
    table(
      ['', 'Result'],
      [
        ['Expected', d.expected || '⚠ to be filled in by the reporter'],
        ['Actual', d.actual || '—'],
      ]
    ),

    heading(3, 'Steps to reproduce'),
    {
      type: 'orderedList',
      attrs: { order: 1 },
      content: (d.steps.length ? d.steps : ['—']).map((s) => ({
        type: 'listItem',
        content: [para(text(s))],
      })),
    },

    d.evidence.responseBody ? heading(3, 'What the server sent back') : null,
    d.evidence.responseBody ? codeBlock(d.evidence.responseBody) : null,

    d.evidence.stack ? heading(3, 'Stack trace') : null,
    d.evidence.stack ? codeBlock(d.evidence.stack) : null,

    heading(3, 'Classification'),
    table(
      ['Attribute', 'Value'],
      [
        ['Identifier', d.identifier],
        ['Severity (impact on the system)', `${d.severity}${d.severityIsSuggestion ? ', suggested' : ''}`],
        ['Priority (urgency of the fix)', `${d.priority}${d.priorityIsSuggestion ? ', suggested' : ''}`],
        ['Status', d.status],
        // Who saw it, when, and what kind of testing they were doing. The
        // ISTQB Foundation syllabus names all four among the contents of a
        // defect report, and the ticket filed into Jira carried none of them:
        // it said what broke and never said who found it or at what level.
        ['Reported', new Date(d.reportedAt).toISOString().replace('T', ' ').slice(0, 16)],
        ...(d.reportedBy ? [['Reported by', d.reportedBy]] : []),
        ...(d.testLevel ? [['Test level', d.testLevel]] : []),
        ...(d.testType ? [['Test type', d.testType]] : []),
        ...buildFields(d, /^ar/i.test(d.environment?.language || '')), // D-1010-131
        ['Why this severity', d.impact.severityRationale],
        ['Scope', d.impact.scope],
      ]
    ),

    heading(3, 'Environment'),
    table(
      ['Item', 'Value'],
      [
        ['URL', d.environment.url || '—'],
        ['Browser', d.environment.browser || '—'],
        ['Viewport', d.environment.viewport || '—'],
        ['Platform', d.environment.platform || '—'],
        ['Language', d.environment.language || '—'],
        ['Recorded', d.environment.recordedAt],
      ]
    ),

    d.evidence.locator ? heading(3, 'Where it happened') : null,
    d.evidence.locator
      ? para(code(d.evidence.locator), text(`, the failure followed ${d.evidence.gapMs}ms later (${d.evidence.confidence} confidence)`))
      : null,

    d.notes.length ? heading(3, 'Tester notes') : null,
    d.notes.length ? bullets(d.notes.map((n) => (n.tag ? `[${n.tag}] ${n.text}` : n.text))) : null,

    d.relatedFailures > 0
      ? para(
          strong('Note: '),
          text(
            `${d.relatedFailures} other failure${d.relatedFailures === 1 ? ' was' : 's were'} recorded in the same session. ` +
              'Check whether they belong in this report or in their own.'
          )
        )
      : null,

    para(
      text('Captured locally with QA Wrap · '),
      code(d.traceability.sessionId),
      text(' · passwords and cookie values were never recorded.')
    )
  );
}

export function defectToMarkdown(d) {
  const L = [];
  L.push(`# ${mdEsc(d.identifier)}: ${mdEsc(d.summary)}`, '');

  if (d.severityIsSuggestion || d.priorityIsSuggestion) {
    L.push(
      '> **Severity and priority are suggestions.** Severity is the impact on the system;',
      '> priority is the urgency of the fix. They are separate judgements, and this tool',
      '> can see the evidence but not the release plan.',
      ''
    );
  }

  L.push('| | |', '|---|---|');
  L.push(`| Identifier | ${mdCode(d.identifier, true)} |`);
  L.push(`| Severity | **${mdEsc(d.severity)}**: impact on the system |`);
  L.push(`| Priority | **${mdEsc(d.priority)}**: urgency of the fix |`);
  L.push(`| Status | ${mdEsc(d.status)} |`);
  /*
   * Who, when, and at what level. All four are named in the ISTQB Foundation
   * syllabus as contents of a defect report and none of them was printed: the
   * document said what broke and never said who saw it break, when they wrote
   * it down, or what kind of testing they were doing at the time. A triager
   * reading a ticket a week later needs all four before the technical detail.
   */
  L.push(`| Reported | ${new Date(d.reportedAt).toISOString().replace('T', ' ').slice(0, 16)} |`);
  if (d.reportedBy) L.push(`| Reported by | ${mdEsc(d.reportedBy)} |`);
  if (d.testLevel) L.push(`| Test level | ${mdEsc(d.testLevel)} |`);
  if (d.testType) L.push(`| Test type | ${mdEsc(d.testType)} |`);
  buildFields(d, /^ar/i.test(d.environment?.language || '')).forEach(([k, v]) => L.push(`| ${k} | ${mdEsc(v)} |`)); // D-1010-131
  if (d.traceability.story) L.push(`| Story | ${mdEsc(d.traceability.story)} |`);
  if (d.traceability.epic) L.push(`| Epic | ${mdEsc(d.traceability.epic)} |`);
  if (d.traceability.testCase) L.push(`| Found by | ${mdEsc(d.traceability.testCase)} |`);
  L.push('');

  L.push('## Expected vs actual', '');
  L.push(`**Expected**: ${d.expected ? mdEsc(d.expected) : '⚠ to be filled in by the reporter'}`, '');
  L.push(`**Actual**: ${d.actual ? mdEsc(d.actual) : '—'}`, '');

  L.push('## Steps to reproduce', '');
  d.steps.forEach((s, i) => L.push(`${i + 1}. ${mdEsc(s)}`));
  L.push('');

  if (d.evidence.responseBody) { const f = fenceFor(d.evidence.responseBody); L.push('## What the server sent back', '', f, d.evidence.responseBody, f, ''); }
  if (d.evidence.stack) { const f = fenceFor(d.evidence.stack); L.push('## Stack trace', '', f, d.evidence.stack, f, ''); }

  L.push('## Why this severity', '', mdEsc(d.impact.severityRationale), '');

  L.push('## Environment', '', '| Item | Value |', '|---|---|');
  L.push(`| URL | ${mdCell(d.environment.url || '—')} |`);
  L.push(`| Browser | ${mdCell(d.environment.browser || '—')} |`);
  L.push(`| Viewport | ${mdCell(d.environment.viewport || '—')} |`);
  L.push(`| Platform | ${mdCell(d.environment.platform || '—')} |`);
  L.push(`| Language | ${mdCell(d.environment.language || '—')} |`);
  L.push(`| Recorded | ${mdCell(d.environment.recordedAt)} |`);
  L.push('');

  if (d.evidence.locator) {
    L.push('## Where it happened', '');
    L.push(`${mdCode(d.evidence.locator)}, the failure followed ${d.evidence.gapMs}ms later (${mdEsc(d.evidence.confidence)} confidence).`, '');
  }

  if (d.notes.length) {
    L.push('## Tester notes', '');
    d.notes.forEach((n) => L.push(`- ${n.tag ? `**${mdEsc(n.tag)}** ` : ''}${mdEsc(n.text)}`));
    L.push('');
  }

  if (d.relatedFailures > 0) {
    L.push(
      `> ${d.relatedFailures} other failure${d.relatedFailures === 1 ? ' was' : 's were'} recorded in the same session. ` +
        'Check whether they belong here or in their own report.',
      ''
    );
  }

  L.push('_Captured locally with QA Wrap. Passwords and cookie values were never recorded._');
  return L.join('\n');
}
