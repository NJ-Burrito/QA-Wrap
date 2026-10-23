/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Defect filing, both Jira modes, against a mocked fetch: the "Expected vs actual"
 * header is text (never "[object Object]") and tester notes arrive numbered, Arabic included.
 *
 *   node tools/test-jira-defect-table-notes.mjs
 */
import assert from 'node:assert/strict';
import { buildDefectReport } from '../core/istqb.js';
import { defectToAdf } from '../core/istqb-render.js';
import { createIssue } from '../background/jira.js';

let body = null;
globalThis.fetch = async (_u, init) => { body = JSON.parse(init.body); return { ok: true, status: 201, text: async () => '{"key":"DEMO-12","id":"1"}' }; };

const session = { id: 'ses-demo-0001', startedAt: Date.now(), startUrl: 'https://acme.example.test/', env: { language: 'en' } };
const events = [
  { kind: 'note', tag: 'bug', text: 'The save button does nothing', ts: 1 },
  { kind: 'note', tag: 'bug', text: 'زر الحفظ لا يعمل', ts: 2 },
  { kind: 'note', tag: 'capture-gap', text: 'machine note', ts: 3 },
];
const adf = defectToAdf(buildDefectReport(session, events, {}));
const modes = { cloud: { baseUrl: 'https://acme.atlassian.net', email: 'qa@example.test', token: 'x' }, dc: { baseUrl: 'https://jira.acme.example.test', token: 'x', authMode: 'server' } };

for (const [mode, cfg] of Object.entries(modes)) {
  await createIssue(cfg, { projectKey: 'DEMO', issueTypeName: 'Bug', summary: 's', description: adf });
  const d = body.fields.description;
  const flat = JSON.stringify(d);
  assert.ok(!flat.includes('[object Object]'), `${mode}: [object Object] in description`);
  if (mode === 'dc') {
    assert.match(d, /\|\|\s*\|\|\*Result\*\|\|/, 'dc: table header');
    assert.ok(d.includes('# \\[bug\\] The save button does nothing\n# \u200F\\[bug\\] زر الحفظ لا يعمل'), 'dc: numbered notes');
    assert.ok(!d.includes('machine note'));
  } else {
    assert.ok(flat.includes('"text":"Result"'), 'cloud: header text');
    const list = d.content.find((n) => n.type === 'orderedList' && JSON.stringify(n).includes('زر'));
    assert.equal(list.content.length, 2, 'cloud: two numbered notes');
  }
  console.log(`  ok  ${mode}: header text and numbered notes`);
}
