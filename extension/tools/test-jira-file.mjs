/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The Jira client behind the one filing path, against a local mock Jira:
 * current createmeta endpoints, typed fields refused rather than dropped,
 * secrets scanned and redacted, duplicate search, comment on an existing issue.
 * `fetch` is replaced; nothing here reaches a network or holds a credential.
 *
 *   node tools/test-jira-file.mjs
 */
import assert from 'node:assert/strict';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}

let sent = [];
let routes = [];
const route = (method, match, reply) => routes.push({ method, match, reply });
globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET';
  const body = init.body;
  const rec = { url: String(url), method, body: typeof body === 'string' ? JSON.parse(body) : body };
  sent.push(rec);
  const hit = routes.find((r) => r.method === method && String(url).includes(r.match));
  const reply = typeof hit?.reply === 'function' ? hit.reply(rec) : hit?.reply ?? { status: 404, body: { errorMessages: ['no such route'] } };
  return { ok: reply.status < 400, status: reply.status, text: async () => JSON.stringify(reply.body ?? {}) };
};
const reset = () => { sent = []; routes = []; };

const cloud = { baseUrl: 'https://mock.atlassian.net', email: 'qa@example.test', token: 'fixture-token', project: 'QAW' };
const dc = { baseUrl: 'https://jira.example.test', token: 'fixture-pat', project: 'QAW', authMode: 'server' };
const jira = await import('../background/jira.js');

const cloudTypes = { issueTypes: [{ id: '10', name: 'Bug' }, { id: '11', name: 'Task' }] };
const cloudFields = { fields: [
  { fieldId: 'summary', name: 'Summary', required: true, schema: { type: 'string' } },
  { fieldId: 'priority', name: 'Priority', required: false, schema: { type: 'priority' }, allowedValues: [{ id: '1', name: 'Highest' }, { id: '3', name: 'Medium' }] },
  { fieldId: 'customfield_10500', name: 'Build', required: true, schema: { type: 'string', custom: 'x:textfield' } },
  { fieldId: 'labels', name: 'Labels', required: false, schema: { type: 'array', items: 'string', system: 'labels' } },
] };
const meta = () => {
  route('GET', '/issue/createmeta/QAW/issuetypes/10', { status: 200, body: cloudFields });
  route('GET', '/issue/createmeta/QAW/issuetypes/11', { status: 200, body: { fields: [] } });
  route('GET', '/issue/createmeta/QAW/issuetypes?', { status: 200, body: cloudTypes });
};

console.log('jira - createmeta, current endpoints');
await test('Cloud: types then fields per type, on the new endpoints only; handled fields left out; required first', async () => {
  reset(); meta();
  const types = await jira.issueTypes(cloud, 'QAW');
  assert.ok(sent.every((r) => !/createmeta\?projectKeys/.test(r.url)), 'the removed endpoint was called');
  assert.ok(sent.some((r) => r.url.includes('/rest/api/3/issue/createmeta/QAW/issuetypes/10')));
  const bug = types.find((t) => t.name === 'Bug');
  assert.deepEqual(bug.fields.map((f) => f.key), ['customfield_10500', 'labels', 'priority']);
  assert.equal(bug.required.length, 1);
  assert.equal(bug.looksLikeDefect, true);
});
await test('fieldsFor limits the calls to the one type (filing asks for its own only)', async () => {
  reset(); meta();
  await jira.issueTypes(cloud, 'QAW', { fieldsFor: 'bug' });
  assert.equal(sent.filter((r) => /issuetypes\/\d+/.test(r.url)).length, 1);
  reset(); meta();
  await jira.issueTypes(cloud, 'QAW', { fieldsFor: false });
  assert.equal(sent.filter((r) => /issuetypes\/\d+/.test(r.url)).length, 0);
});
await test('Data Center 8.4+: values shape on /rest/api/2', async () => {
  reset();
  route('GET', '/issuetypes/10', { status: 200, body: { values: cloudFields.fields } });
  route('GET', '/issuetypes?', { status: 200, body: { values: [{ id: '10', name: 'Bug' }] } });
  const types = await jira.issueTypes(dc, 'QAW');
  assert.ok(sent[0].url.includes('/rest/api/2/issue/createmeta/QAW/issuetypes'));
  assert.equal(types[0].fields.length, 3);
});
await test('older Data Center (404 on the new endpoint) falls back to the expanded call', async () => {
  reset();
  route('GET', 'createmeta/QAW/issuetypes', { status: 404, body: {} });
  route('GET', 'createmeta?projectKeys=QAW', { status: 200, body: { projects: [{ issuetypes: [{ id: '10', name: 'Bug', fields: { customfield_1: { name: 'Build', required: true, schema: { type: 'string' } } } }] }] } });
  const types = await jira.issueTypes(dc, 'QAW');
  assert.equal(types[0].fields[0].key, 'customfield_1');
});
await test('a 500 is not swallowed into the legacy path', async () => {
  reset(); route('GET', 'createmeta/QAW/issuetypes', { status: 500, body: {} });
  await assert.rejects(() => jira.issueTypes(cloud, 'QAW'), /500/);
});

console.log('\njira - typed fields are shaped or refused');
await test('a shaped field is sent; priority mapped from severity goes in when allowed', async () => {
  reset(); meta();
  const r = await jira.resolveFields(cloud, 'QAW', 'Bug', { customfield_10500: 'build 42' }, { priority: 'highest' });
  assert.deepEqual(r.dropped, []);
  assert.equal(r.extra.customfield_10500, 'build 42');
  assert.deepEqual(r.extra.priority, { name: 'Highest' });
});
await test('a typed field not on the create screen is dropped, so the caller refuses (JIRA_FIELD_DROPPED)', async () => {
  reset(); meta();
  const r = await jira.resolveFields(cloud, 'QAW', 'Bug', { customfield_99999: 'x', customfield_10500: 'ok' });
  assert.deepEqual(r.dropped.map((d) => [d.key, d.reason]), [['customfield_99999', 'not-on-screen']]);
});
await test('metadata unavailable: every typed field is reported, none silently lost', async () => {
  reset(); route('GET', 'createmeta', { status: 500, body: {} });
  const r = await jira.resolveFields(cloud, 'QAW', 'Bug', { customfield_10500: 'x', components: [{ id: '1' }] });
  assert.deepEqual(r.dropped.map((d) => d.key).sort(), ['components', 'customfield_10500']);
  assert.ok(r.dropped.every((d) => d.reason === 'no-metadata'));
});
await test('an unknown issue type reports its fields as dropped with the reason', async () => {
  reset(); meta();
  const r = await jira.resolveFields(cloud, 'QAW', 'Nonesuch', { customfield_10500: 'x' });
  assert.equal(r.dropped[0].reason, 'no-such-type');
});
await test('a mapped priority the site does not allow is skipped, not fatal; a typed priority wins', async () => {
  reset(); meta();
  let r = await jira.resolveFields(cloud, 'QAW', 'Bug', {}, { priority: 'Blocker' });
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.skipped, [{ key: 'priority', reason: 'value-not-allowed' }]);
  reset(); meta();
  r = await jira.resolveFields(cloud, 'QAW', 'Bug', { priority: 'Medium' }, { priority: 'Highest' });
  assert.deepEqual(r.extra.priority, { id: '3' });
});
await test('no typed fields and no priority: no metadata call at all', async () => {
  reset();
  const r = await jira.resolveFields(cloud, 'QAW', 'Bug', {});
  assert.equal(sent.length, 0);
  assert.deepEqual(r, { extra: {}, dropped: [], skipped: [] });
});

console.log('\njira - secrets before send');
const GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
await test('scanSecrets: editor body scanned as typed (offsets index the body), cleaned copy has no value', () => {
  const body = `steps\nHeader Authorization: Bearer ${GH}\n`;
  const r = jira.scanSecrets({ summary: 'ok', body, fields: { customfield_1: `k ${GH}`, n: 3 } });
  assert.deepEqual(r.findings.map((f) => f.field).sort(), ['description', 'field:customfield_1']);
  const d = r.findings.find((f) => f.field === 'description');
  assert.equal(body.slice(d.start, d.end), `Bearer ${GH}`);
  assert.ok(!JSON.stringify(r.redacted).includes(GH));
  assert.equal(r.redacted.fields.n, 3);
});
await test('scanSecrets: model document (no body) is scanned and cleaned as ADF', () => {
  const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: `pw ${GH}` }] }] };
  const r = jira.scanSecrets({ summary: 's', adf });
  assert.equal(r.findings.length, 1);
  assert.ok(!JSON.stringify(r.redacted.adf).includes(GH));
});
await test('scanSecrets: the vault token is found by exact match', () => {
  const r = jira.scanSecrets({ summary: 'token was CANARY-7f3a91xq-token ok', adf: { type: 'doc', content: [] } }, ['CANARY-7f3a91xq-token']);
  assert.equal(r.findings[0].kind, 'saved-token');
});
await test('scanFiles reads text attachments and skips images', async () => {
  const f = await jira.scanFiles([
    { filename: 'a.har', blob: new Blob([`{"authorization":"Bearer ${GH}"}`], { type: 'application/json' }) },
    { filename: 'a.png', blob: new Blob([GH], { type: 'image/png' }) },
    { filename: 'clean.md', blob: new Blob(['nothing here'], { type: 'text/markdown' }) },
  ]);
  assert.deepEqual(f.map((x) => x.field), ['attachment:a.har']);
});
await test('attachFiles with redact uploads cleaned text and the image untouched; without it, bytes as-is', async () => {
  reset();
  const uploaded = [];
  route('POST', '/attachments', (rec) => { uploaded.push(rec.body.get('file')); return { status: 200, body: [{ id: '1' }] }; });
  const files = [
    { filename: 'a.har', blob: new Blob([`x ${GH} y`], { type: 'application/json' }) },
    { filename: 'a.png', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) },
  ];
  const out = await jira.attachFiles(cloud, 'QAW-1', files, { redact: true });
  assert.deepEqual(out.map((o) => [o.name, o.ok, o.redacted]), [['a.har', true, 1], ['a.png', true, undefined]]);
  assert.equal(await uploaded[0].text(), 'x [REDACTED] y');
  assert.equal(uploaded[1].size, 3);
  uploaded.length = 0;
  await jira.attachFiles(cloud, 'QAW-1', files);
  assert.ok((await uploaded[0].text()).includes(GH));
});

console.log('\njira - duplicates and existing issues');
await test('fingerprint: ids in the path do not change it; another path does', () => {
  const s = 'Checkout fails with error 500 after Pay';
  const a = jira.fingerprint({ url: 'https://app.test/orders/123/edit?x=1', summary: s });
  const b = jira.fingerprint({ url: 'https://app.test/orders/98765/edit', summary: s });
  const c = jira.fingerprint({ url: 'https://app.test/cart', summary: s });
  assert.equal(a.label, b.label);
  assert.notEqual(a.label, c.label);
  assert.equal(a.path, '/orders/:id/edit');
  assert.match(a.label, /^qaw-fp-[0-9a-f]{8}$/);
});
await test('findDuplicates: one open-issues JQL in the project, fingerprint match first, at most three', async () => {
  reset();
  const fp = jira.fingerprint({ url: 'https://app.test/pay', summary: 'Payment button does nothing' }).label;
  route('POST', '/search/jql', {
    status: 200,
    body: { issues: [
      { key: 'QAW-1', fields: { summary: 'By words', status: { name: 'Open', statusCategory: { key: 'new' } }, labels: [] } },
      { key: 'QAW-2', fields: { summary: 'By label', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, labels: [fp] } },
      { key: 'QAW-3', fields: { summary: 'c', labels: [] } },
      { key: 'QAW-4', fields: { summary: 'd', labels: [] } },
    ] },
  });
  const r = await jira.findDuplicates(cloud, { projectKey: 'QAW', url: 'https://app.test/pay', summary: 'Payment button does nothing' });
  const jql = sent[0].body.jql;
  assert.match(jql, /project = "QAW" AND statusCategory != Done/);
  assert.ok(jql.includes(`labels = "${fp}"`) && jql.includes('summary ~ "payment button nothing"'), jql);
  assert.equal(r.candidates.length, 3);
  assert.deepEqual([r.candidates[0].key, r.candidates[0].match], ['QAW-2', 'fingerprint']);
  assert.equal(r.candidates[0].url, 'https://mock.atlassian.net/browse/QAW-2');
});
await test('findDuplicates refuses a project key that could carry JQL', async () => {
  reset();
  const r = await jira.findDuplicates(cloud, { projectKey: 'X" OR 1=1 --', summary: 'a b' });
  assert.deepEqual(r.candidates, []);
  assert.equal(sent.length, 0);
});
await test('addComment: ADF body on Cloud, wiki string on Data Center', async () => {
  reset();
  route('POST', '/comment', { status: 201, body: { id: '77' } });
  const doc = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'retest failed' }] }] };
  const r = await jira.addComment(cloud, 'QAW-5', doc);
  assert.equal(r.id, '77');
  assert.equal(sent[0].url, 'https://mock.atlassian.net/rest/api/3/issue/QAW-5/comment');
  assert.equal(sent[0].body.body.type, 'doc');
  await jira.addComment(dc, 'QAW-5', doc);
  assert.equal(typeof sent[1].body.body, 'string');
  assert.match(sent[1].body.body, /retest failed/);
});

console.log('\njira - fileIssue: the one filing path');
const doc = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const evidence = (extra = '') => ({
  files: [
    { filename: 'shot-1.png', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) },
    { filename: 'network.har', blob: new Blob([`{"log":"ok ${extra}"}`], { type: 'application/json' }) },
  ],
  failed: [],
});
const io = (extra) => ({ buildFiles: async () => evidence(extra) });
const filing = (over = {}) => ({
  project: 'QAW', typeName: 'Bug', kind: 'defect', sessionId: 's1', summary: 'Pay button does nothing', adf: doc('steps'),
  fields: {}, labels: ['qa-wrap', 'defect'], url: 'https://app.test/pay', attach: { screenshots: true, formats: ['har'] }, known: [], ...over,
});
const jiraApi = () => {
  route('POST', '/rest/api/3/issue', { status: 201, body: { key: 'QAW-9', id: '9' } });
  route('POST', '/attachments', { status: 200, body: [{ id: '1' }] });
  route('PUT', '/properties/qaw-provenance', { status: 200, body: {} });
  route('GET', '/issuelinktype', { status: 200, body: { issueLinkTypes: [{ name: 'Relates' }] } });
  route('POST', '/issueLink', { status: 201, body: {} });
  route('POST', '/comment', { status: 201, body: { id: '5' } });
};
const posts = (re) => sent.filter((r) => r.method === 'POST' && re.test(r.url));

await test('files the issue, then uploads every evidence file, then the provenance property (attachments included)', async () => {
  reset(); jiraApi(); meta();
  const r = await jira.fileIssue(cloud, filing({ provenance: { by: 'qa-wrap' } }), io());
  assert.equal(r.key, 'QAW-9');
  assert.equal(r.mode, 'created');
  assert.deepEqual(r.attachments.map((a) => [a.name, a.ok]), [['shot-1.png', true], ['network.har', true]]);
  assert.equal(posts(/\/attachments$/).length, 2);
  assert.ok(sent.some((x) => x.method === 'PUT' && x.url.includes('qaw-provenance')));
  assert.equal(r.attachedBytes, 3 + evidence().files[1].blob.size, 'D-1010-150: attachedBytes is the sum of the uploaded blob sizes');
  const create = posts(/\/issue$/)[0].body.fields;
  assert.ok(create.labels.includes('qa-wrap') && create.labels.some((l) => /^qaw-fp-/.test(l)), 'fingerprint label added');
  assert.equal(create.issuetype.name, 'Bug');
});
await test('SECRET_FOUND: a token in the HAR refuses the filing and nothing is created or uploaded', async () => {
  reset(); jiraApi(); meta();
  const r = await jira.fileIssue(cloud, filing(), io(`Authorization: Bearer ${GH}`));
  assert.equal(r.refused.code, 'SECRET_FOUND');
  assert.equal(r.refused.data.canRedact, true);
  assert.deepEqual(r.refused.data.findings.map((f) => f.field), ['attachment:network.har']);
  assert.ok(!JSON.stringify(r).includes(GH), 'the refusal carries no value');
  assert.equal(posts(/\/issue$|\/attachments$/).length, 0, 'nothing was sent');
});
await test('SECRET_FOUND in the description names the field; redact:true files with the value gone everywhere', async () => {
  reset(); jiraApi(); meta();
  const p = filing({ body: `steps\nAuthorization: Bearer ${GH}\n`, adf: undefined });
  const refused = await jira.fileIssue(cloud, p, io(`Authorization: Bearer ${GH}`));
  assert.deepEqual([...new Set(refused.refused.data.findings.map((f) => f.field))].sort(), ['attachment:network.har', 'description']);
  reset(); jiraApi(); meta();
  const uploaded = [];
  routes.unshift({ method: 'POST', match: '/attachments', reply: (rec) => { uploaded.push(rec.body.get('file')); return { status: 200, body: [{ id: '1' }] }; } });
  const r = await jira.fileIssue(cloud, { ...p, redact: true }, io(`Authorization: Bearer ${GH}`));
  assert.equal(r.key, 'QAW-9');
  assert.equal(r.redacted, 2);
  const all = JSON.stringify(sent.map((x) => (typeof x.body === 'object' && !(x.body instanceof FormData) ? x.body : null)));
  assert.ok(!all.includes(GH), 'the create body holds no value');
  assert.ok(!(await uploaded[1].text()).includes(GH), 'the uploaded HAR holds no value');
});
await test('allowSecrets sends as-is', async () => {
  reset(); jiraApi(); meta();
  const r = await jira.fileIssue(cloud, filing({ allow: true }), io(`Authorization: Bearer ${GH}`));
  assert.equal(r.key, 'QAW-9');
  assert.equal(r.redacted, 0);
});
await test('the vault token, saved elsewhere in the text, is refused by exact match', async () => {
  reset(); jiraApi(); meta();
  const r = await jira.fileIssue(cloud, filing({ summary: 'used CANARY-jira-token-1234 here', known: ['CANARY-jira-token-1234'] }), io());
  assert.equal(r.refused.code, 'SECRET_FOUND');
  assert.equal(r.refused.data.findings[0].kind, 'saved-token');
});
await test('JIRA_FIELD_DROPPED: a typed field the screen lacks refuses the filing, nothing is created', async () => {
  reset(); jiraApi(); meta();
  const r = await jira.fileIssue(cloud, filing({ fields: { customfield_99999: 'x' } }), io());
  assert.equal(r.refused.code, 'JIRA_FIELD_DROPPED');
  assert.deepEqual(r.refused.data.fields, [{ key: 'customfield_99999', reason: 'not-on-screen' }]);
  assert.equal(posts(/\/issue$/).length, 0);
});
await test('a shaped required field and the mapped priority are sent in the create call', async () => {
  reset(); jiraApi(); meta();
  await jira.fileIssue(cloud, filing({ fields: { customfield_10500: 'build 7' }, priority: 'Highest' }), io());
  const f = posts(/\/issue$/)[0].body.fields;
  assert.equal(f.customfield_10500, 'build 7');
  assert.deepEqual(f.priority, { name: 'Highest' });
});
await test('existingKey: a comment and the evidence go to that issue, no new issue, no provenance', async () => {
  reset(); jiraApi(); meta();
  const r = await jira.fileIssue(cloud, filing({ existingKey: 'QAW-2', provenance: { by: 'x' } }), io());
  assert.equal(r.mode, 'commented');
  assert.equal(r.key, 'QAW-2');
  assert.equal(posts(/\/issue$/).length, 0);
  assert.equal(posts(/QAW-2\/comment$/).length, 1);
  assert.equal(posts(/QAW-2\/attachments$/).length, 2);
  assert.ok(!sent.some((x) => x.url.includes('qaw-provenance')));
});
await test('dryRun answers what would stop the filing and sends nothing', async () => {
  reset(); jiraApi(); meta();
  const r = await jira.fileIssue(cloud, filing({ dryRun: true, fields: { customfield_99999: 'x' } }), io(`Authorization: Bearer ${GH}`));
  assert.equal(r.scan.clean, false);
  assert.equal(r.scan.findings.length, 1);
  assert.equal(r.scan.dropped.length, 1);
  assert.equal(posts(/\/issue$|\/attachments$|\/comment$/).length, 0);
});
await test('story and epic links are made; a failed link is reported and does not lose the issue', async () => {
  reset(); jiraApi(); meta();
  routes.unshift({ method: 'POST', match: '/issueLink', reply: { status: 403, body: { errorMessages: ['nope'] } } });
  const r = await jira.fileIssue(cloud, filing({ storyKey: 'QAW-1' }), io());
  assert.equal(r.key, 'QAW-9');
  assert.deepEqual(r.relationships.map((x) => [x.as, x.linked]), [['story', false]]);
  assert.equal(r.attachments.length, 2);
});
await test('fileSuite: scanned before the first create; a secret anywhere refuses the whole suite', async () => {
  reset(); jiraApi(); meta();
  const steps = [
    { ref: 'TS-1', kind: 'suite', summary: 'Suite', typeName: 'Task', labels: ['qa-wrap'], adf: doc('parent') },
    { ref: 'TC-1', kind: 'case', summary: 'Case', typeName: 'Task', labels: ['qa-wrap'], adf: doc(`leak ${GH}`), links: [] },
    { ref: 'D-1', kind: 'defect', summary: 'Defect', typeName: 'Bug', labels: ['qa-wrap'], adf: doc('ok'), evidence: true, links: [{ to: 'TC-1', type: 'found in' }] },
  ];
  const r = await jira.fileSuite(cloud, { project: 'QAW', steps, sessionId: 's1', attach: { screenshots: true }, known: [] }, io());
  assert.equal(r.refused.code, 'SECRET_FOUND');
  assert.equal(r.refused.data.findings[0].field, 'TC-1:description');
  assert.equal(posts(/\/issue$/).length, 0);
});
await test('fileSuite: parent, children, links; only defects carry the evidence', async () => {
  reset(); jiraApi(); meta();
  let n = 0;
  routes.unshift({ method: 'POST', match: '/rest/api/3/issue', reply: () => ({ status: 201, body: { key: `QAW-${++n}`, id: String(n) } }) });
  const steps = [
    { ref: 'TS-1', kind: 'suite', summary: 'Suite', typeName: 'Task', labels: ['qa-wrap'], adf: doc('parent') },
    { ref: 'TC-1', kind: 'case', summary: 'Case', typeName: 'Task', labels: ['qa-wrap'], adf: doc('c'), links: [] },
    { ref: 'D-1', kind: 'defect', summary: 'Defect', typeName: 'Bug', labels: ['qa-wrap'], adf: doc('ok'), evidence: true, links: [{ to: 'TC-1', type: 'found in' }] },
  ];
  const r = await jira.fileSuite(cloud, { project: 'QAW', steps, sessionId: 's1', attach: { screenshots: true }, known: [] }, io());
  assert.deepEqual(r.created.map((c) => [c.ref, c.key, c.attachments.length]), [['TS-1', 'QAW-1', 0], ['TC-1', 'QAW-2', 0], ['D-1', 'QAW-3', 2]]);
  assert.equal(r.parentKey, 'QAW-1');
  assert.equal(r.links.length, 3, 'two parent links and one cross link');
  assert.ok(r.links.every((l) => l.linked));
});

await test('priorityFor: settings.jira.priorityMap overrides DEFAULT_PRIORITY_MAP key by key', async () => {
  assert.equal(jira.priorityFor({}, 'major'), 'High');
  assert.equal(jira.priorityFor({ priorityMap: { major: 'Blocker' } }, 'major'), 'Blocker');
  assert.equal(jira.priorityFor({ priorityMap: { major: 'Blocker' } }, 'minor'), 'Low');
  assert.equal(jira.priorityFor({}, 'nonsense'), null);
});

console.log('jira - r9-11-4: a summary cut never ends on half an emoji');
await test('a 250-unit summary whose 250th unit is a high surrogate is sent without it', async () => {
  reset();
  route('POST', '/rest/api/3/issue', { status: 201, body: { id: '1', key: 'QAW-1' } });
  const summary = `${'a'.repeat(249)}\u{1F600}tail`;
  await jira.createIssue(cloud, { projectKey: 'QAW', issueTypeName: 'Bug', summary, description: { type: 'doc', version: 1, content: [] } });
  const made = sent.find((r) => r.method === 'POST' && /\/issue$/.test(r.url));
  assert.equal(made.body.fields.summary, 'a'.repeat(249), 'the lone high surrogate is dropped');
  assert.ok(!/[\ud800-\udbff]$/.test(made.body.fields.summary));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
