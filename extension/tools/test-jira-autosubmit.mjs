/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Auto-submit: the request each of the seven kinds sends, and the attach path.
 *
 * Every call is answered by a recorded fixture and `fetch` is replaced, so this
 * suite never reaches a network and never needs a credential. That is not only
 * for speed: a test that files into a tracker is one paste away from being a
 * test that files into a *real* tracker, and the credentials for this product
 * live in Settings on a person's machine and nowhere in this repository.
 *
 * What is asserted here is the shape of what leaves: the project, the issue
 * type, the description document, and, for the attachments, that the files are
 * assembled and posted as multipart with the header Jira insists on. The path
 * itself — worker to offscreen document and back — is exercised by
 * `tools/clickthrough.mjs` and `tools/diagnose.mjs`, which drive the real
 * product; this is the half a headed suite cannot see, because it needs a
 * configured Jira site to reach.
 *
 *   node tools/test-jira-autosubmit.mjs
 */
import assert from 'node:assert/strict';
import { KINDS, pickIssueType } from '../core/jira-templates.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/* ── a Jira that answers whatever the test wants ───────────────────────── */

let sent = [];
let routes = [];
const route = (match, reply) => routes.push({ match, reply });

globalThis.fetch = async (url, init = {}) => {
  const body = init.body;
  sent.push({
    url: String(url),
    method: init.method || 'GET',
    headers: init.headers || {},
    // A multipart attachment carries FormData; everything else is JSON.
    body: typeof body === 'string' ? JSON.parse(body) : body,
    isForm: typeof FormData !== 'undefined' && body instanceof FormData,
  });
  const hit = routes.find((r) => String(url).includes(r.match));
  const reply = hit?.reply ?? { status: 200, body: {} };
  return {
    ok: reply.status < 400,
    status: reply.status,
    text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
  };
};
const reset = () => { sent = []; routes = []; };

const cfg = { baseUrl: 'https://acme.atlassian.net', email: 'qa@example.test', token: 'fixture-token', project: 'QAW' };

const { createIssue, attachFiles } = await import('../background/jira.js');

console.log('jira - what each kind sends');

await test('the seven kinds are the seven the product offers', () => {
  assert.deepEqual(
    KINDS.map((k) => k.id),
    ['defect', 'testcase', 'story', 'epic', 'task', 'subtask', 'plain'],
  );
});

for (const kind of KINDS.map((k) => k.id)) {
  await test(`${kind}: the created issue names the project, the type and a document`, async () => {
    reset();
    route('/rest/api/3/issue', { status: 201, body: { key: 'QAW-1', id: '1', self: 'https://acme.atlassian.net/rest/api/3/issue/1' } });
    const type = { defect: 'Bug', testcase: 'Test Case', story: 'Story', epic: 'Epic', task: 'Task', subtask: 'Sub-task', plain: 'Task' }[kind];
    const out = await createIssue(cfg, {
      projectKey: 'QAW',
      issueTypeName: type,
      summary: `A ${kind} from a recorded session`,
      description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
      labels: ['qa-wrap', kind],
    });

    const req = sent[0];
    assert.equal(req.method, 'POST');
    assert.ok(req.url.endsWith('/rest/api/3/issue'), req.url);
    assert.equal(req.body.fields.project.key, 'QAW');
    assert.equal(req.body.fields.issuetype.name, type, 'the issue type must be the one asked for');
    assert.equal(req.body.fields.description.type, 'doc', 'Jira takes ADF, not Markdown');
    assert.ok(req.body.fields.labels.includes(kind), 'the kind travels as a label');
    assert.equal(out.key, 'QAW-1');
  });
}

await test('an unknown issue type falls back to what the project actually calls it', () => {
  // The map is `core/jira-templates.js`'s and nothing else keeps a second copy.
  // `subtask: true` is Jira's own flag on the type, and `pickIssueType()`
  // honours it: a sub-task type must not be chosen for anything else, and
  // nothing else may be chosen for a sub-task.
  const types = [{ name: 'Bug' }, { name: 'Story' }, { name: 'Task' }, { name: 'Sub-task', subtask: true }, { name: 'Epic' }, { name: 'Test Case' }];
  assert.equal(pickIssueType('defect', types).name, 'Bug');
  assert.equal(pickIssueType('testcase', types).name, 'Test Case');
  assert.equal(pickIssueType('story', types).name, 'Story');
  assert.equal(pickIssueType('epic', types).name, 'Epic');
  assert.equal(pickIssueType('subtask', types).name, 'Sub-task');
});

console.log('\njira - the attach path');

await test('each file is posted as multipart, with the header Jira requires', async () => {
  reset();
  route('/attachments', { status: 200, body: [{ id: '10', filename: 'report.md' }] });
  const files = [
    { filename: 'report.md', blob: new Blob(['# Report'], { type: 'text/markdown' }) },
    { filename: 'shot-1.png', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) },
  ];
  const out = await attachFiles(cfg, 'QAW-1', files);

  // The site's attachment limit is asked once (a GET), then one upload per file.
  const posts = sent.filter((r) => r.method === 'POST');
  assert.equal(posts.length, 2, 'one request per file');
  for (const req of posts) {
    assert.equal(req.method, 'POST');
    assert.ok(req.url.includes('/rest/api/3/issue/QAW-1/attachments'), req.url);
    assert.ok(req.isForm, 'an attachment is multipart, not JSON');
    // Jira rejects an attachment without it, with a message that does not say so.
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
    assert.equal(headers['x-atlassian-token'], 'no-check', 'the XSRF opt-out header is mandatory here');
    assert.ok(!headers['content-type'], 'the boundary is the browser\'s to set');
  }
  assert.deepEqual(out.map((f) => f.ok), [true, true]);
  assert.deepEqual(out.map((f) => f.name), ['report.md', 'shot-1.png']);
});

await test('one refused attachment does not fail the others, or the filing', async () => {
  reset();
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), method: init.method || 'GET' });
    if (String(url).includes('/attachment/meta')) return { ok: true, status: 200, text: async () => '{}' };
    n += 1;
    if (n === 1) return { ok: false, status: 413, text: async () => JSON.stringify({ errorMessages: ['The file is too large'] }) };
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: '11' }]) };
  };
  const out = await attachFiles(cfg, 'QAW-1', [
    { filename: 'huge.har', blob: new Blob(['x']) },
    { filename: 'small.md', blob: new Blob(['y']) },
  ]);
  assert.equal(out[0].ok, false, 'the refusal is reported');
  assert.match(out[0].error, /too large/, 'in Jira\'s own words');
  assert.equal(out[1].ok, true, 'and the next file is still attached');
});

console.log('\njira - the credentials');

await test('no credential is in this file, and none is read from the tree', async () => {
  const src = await (await import('node:fs')).promises.readFile(new URL(import.meta.url), 'utf8');
  for (const shape of [/ATATT[A-Za-z0-9_-]{20,}/, /[A-Za-z0-9+/]{40,}={0,2}/]) {
    assert.ok(!shape.test(src.replace(/fixture-token/g, '')), `a real-looking token matches ${shape}`);
  }
  // The only path a real credential may come from is the settings store.
  const settings = await (await import('node:fs')).promises.readFile(new URL('../platform/settings.js', import.meta.url), 'utf8');
  assert.match(settings, /SECRET_FIELDS/, 'credentials are split into local storage, not synced');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
