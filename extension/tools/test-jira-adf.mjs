/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// Text → ADF, field coercion against Jira's schema, and the issue templates.
import { textToAdf, coerce, controlFor } from '../core/adf.js';
import { draft, pickIssueType, KINDS } from '../core/jira-templates.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/* ── textToAdf ─────────────────────────────────────────────────────────── */
{
  const doc = textToAdf('# Title\n\nA line with **bold** and `code`.\n- one\n- two\n\n1. first\n2. second\n\n```\nlet x = 1;\n```\n');
  check('adf: doc envelope', doc.type === 'doc' && doc.version === 1);
  const types = doc.content.map((n) => n.type);
  check('adf: block order', JSON.stringify(types) === JSON.stringify(['heading', 'paragraph', 'bulletList', 'orderedList', 'codeBlock']), types.join(','));
  check('adf: heading level', doc.content[0].attrs.level === 1);
  const para = doc.content[1].content;
  check('adf: strong mark', para.some((t) => t.marks?.[0]?.type === 'strong' && t.text === 'bold'));
  check('adf: code mark', para.some((t) => t.marks?.[0]?.type === 'code' && t.text === 'code'));
  check('adf: bullet items', doc.content[2].content.length === 2 && doc.content[2].content[0].type === 'listItem');
  check('adf: ordered items', doc.content[3].content.length === 2);
  check('adf: code block text', doc.content[4].content[0].text === 'let x = 1;');
  check('adf: empty input still a doc', textToAdf('').content.length === 1);
  check('adf: CRLF tolerated', textToAdf('a\r\n\r\nb').content.length === 2);
  check('adf: adjacent lines join one paragraph', textToAdf('a\nb').content.length === 1);
  { const nested = textToAdf('````\nbefore\n```\ninner\n```\nafter\n````\n\nAfter.');
    check('adf: a 4-backtick fence holding 3-backtick lines is one codeBlock', nested.content.length === 2 && nested.content[0].type === 'codeBlock' && nested.content[0].content[0].text === 'before\n```\ninner\n```\nafter', JSON.stringify(nested.content.map((n) => n.type)));
    check('adf: an info string does not close a fence', textToAdf('```\na\n```js\nb\n```').content.length === 1); }
  check('adf: unterminated fence closes', textToAdf('```\nx').content[0].type === 'codeBlock');

  const tbl = textToAdf('| Field | Value |\n|---|---|\n| Identifier | `DEF-1` |\n| Severity | **critical** |\n\nAfter.');
  check('adf: table node', tbl.content[0].type === 'table', tbl.content[0].type);
  check('adf: header row from separator', tbl.content[0].content[0].content[0].type === 'tableHeader');
  check('adf: three rows, separator dropped', tbl.content[0].content.length === 3);
  check('adf: body cells', tbl.content[0].content[1].content[1].type === 'tableCell');
  check('adf: cell inline marks', tbl.content[0].content[2].content[1].content[0].content[0].marks?.[0]?.type === 'strong');
  check('adf: paragraph after the table', tbl.content[1].type === 'paragraph');
  const headerless = textToAdf('|||\n|---|---|\n| a | b |');
  check('adf: empty header row still a header', headerless.content[0].content[0].content[0].type === 'tableHeader');
  check('adf: ragged rows padded', headerless.content[0].content.every((r) => r.content.length === 2));
  const bq = textToAdf('> **Severity and priority are suggestions.** Severity is impact;\n> priority is urgency.\n\nPlain.');
  check('adf: blockquote', bq.content[0].type === 'blockquote');
  check('adf: quote lines joined', bq.content[0].content[0].content.map((t) => t.text).join('').includes('impact; priority'));
  check('adf: paragraph after quote', bq.content[1].type === 'paragraph');
}

/* ── coerce ───────────────────────────────────────────────────────────── */
{
  const opt = { key: 'priority', schema: { type: 'priority' }, allowedValues: [{ id: '3', name: 'Medium' }] };
  check('coerce: option by name → id', JSON.stringify(coerce(opt, 'Medium')) === '{"id":"3"}');
  check('coerce: option by id', JSON.stringify(coerce(opt, '3')) === '{"id":"3"}');
  check('coerce: unknown option → value', JSON.stringify(coerce(opt, 'Urgent')) === '{"value":"Urgent"}');
  check('coerce: empty → undefined', coerce(opt, '') === undefined && coerce(opt, []) === undefined);
  check('coerce: string', coerce({ schema: { type: 'string' } }, 'x') === 'x');
  check('coerce: number', coerce({ schema: { type: 'number' } }, '4.5') === 4.5);
  check('coerce: date trims', coerce({ schema: { type: 'date' } }, '2026-09-03T10:00') === '2026-09-03');
  check('coerce: labels array from csv', JSON.stringify(coerce({ schema: { type: 'array', items: 'string' } }, 'a, b ,c')) === '["a","b","c"]');
  const comp = { schema: { type: 'array', items: 'component' }, allowedValues: [{ id: '10', name: 'Web' }] };
  check('coerce: array of options', JSON.stringify(coerce(comp, ['Web'])) === '[{"id":"10"}]');
  check('coerce: user', JSON.stringify(coerce({ schema: { type: 'user' } }, 'abc')) === '{"accountId":"abc"}');
  check('coerce: parent by key', JSON.stringify(coerce({ key: 'parent', schema: { type: 'issuelink' } }, 'QA-1')) === '{"key":"QA-1"}');
  check('coerce: unknown custom passes JSON', coerce({ schema: { type: 'any' } }, '{"a":1}').a === 1);

  check('control: select for allowed values', controlFor(opt) === 'select');
  check('control: multiselect', controlFor(comp) === 'multiselect');
  check('control: tags for free array', controlFor({ schema: { type: 'array', items: 'string' } }) === 'tags');
  check('control: date', controlFor({ schema: { type: 'date' } }) === 'date');
  check('control: textarea for paragraph custom', controlFor({ schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } }) === 'textarea');
  check('control: text default', controlFor({ schema: { type: 'string' } }) === 'text');
}

/* ── templates ────────────────────────────────────────────────────────── */
{
  const session = { id: 's1', charter: 'Check the sign-in flow', startedAt: 1_750_000_000_000, startUrl: 'https://example.test/login', env: { userAgent: 'x', platform: 'Win', viewport: '1280×720', language: 'en' } };
  const events = [
    { kind: 'nav', ts: 1, url: 'https://example.test/login' },
    { kind: 'dom', ts: 2, action: 'click', target: { tag: 'button', text: 'Sign in' }, frameUrl: 'https://example.test/login' },
    { kind: 'net', ts: 3, url: 'https://example.test/api/session', status: 500, method: 'POST' },
    { kind: 'screenshot', ts: 4, captureId: 'c1' },
  ];
  for (const k of ['story', 'epic', 'task', 'subtask', 'plain']) {
    const d = draft(k, session, events);
    check(`template ${k}: summary`, typeof d.summary === 'string' && d.summary.length > 0);
    check(`template ${k}: evidence block`, d.body.includes('## Evidence') && d.body.includes('s1'));
  }
  const story = draft('story', session, events);
  check('story: as-a / I-want', story.body.includes('**As a**') && story.body.includes('**I want**'));
  check('story: acceptance criteria numbered', /\n1\. Given/.test(story.body));
  const epic = draft('epic', session, events);
  check('epic: scope lists the area', epic.body.includes('example.test/login'));
  const task = draft('task', session, events);
  check('task: steps numbered', /## Steps\n1\. /.test(task.body));

  const types = [
    { name: 'Bug', subtask: false }, { name: 'Story', subtask: false }, { name: 'Epic', subtask: false },
    { name: 'Task', subtask: false }, { name: 'Sub-task', subtask: true }, { name: 'Test', subtask: false },
  ];
  check('pick: defect → Bug', pickIssueType('defect', types).name === 'Bug');
  check('pick: story', pickIssueType('story', types).name === 'Story');
  check('pick: epic', pickIssueType('epic', types).name === 'Epic');
  check('pick: task is exact', pickIssueType('task', types).name === 'Task');
  check('pick: subtask wants a subtask type', pickIssueType('subtask', types).name === 'Sub-task');
  check('pick: testcase', pickIssueType('testcase', types).name === 'Test');
  check('pick: plain never picks a subtask', !pickIssueType('plain', types).subtask);
  check('pick: falls back on an odd site', pickIssueType('story', [{ name: 'Ticket', subtask: false }]).name === 'Ticket');
  check('kinds: seven', KINDS.length === 7);
}

console.log(`test-jira-adf: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
