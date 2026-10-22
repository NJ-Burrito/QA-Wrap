/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Jira status, coming back the other way.
 *
 * `issueStatus` needs a Jira site, so it is exercised against a stub `fetch`
 * rather than mocked out — the request it builds is half of what can go wrong,
 * and a test that skips it only proves the roll-up compiles.
 *
 * The roll-up itself is pure, and its one real subtlety is worth stating:
 * **branch on the status *category*, never the status name.** Every Jira site
 * renames its statuses, so "Done" is "Closed" somewhere and "منجز" somewhere
 * else, and only the category is stable.
 */
import assert from 'node:assert/strict';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/* A Jira that answers, and records what it was asked. */
let lastRequest = null;
let reply = { issues: [] };

globalThis.fetch = async (url, init) => {
  lastRequest = { url: String(url), init, body: init?.body ? JSON.parse(init.body) : null };
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(typeof reply === 'function' ? reply(String(url)) : reply),
    json: async () => reply,
  };
};
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');

const { issueStatus, summariseStatuses, issueTypes } = await import('../background/jira.js');

const CFG = { baseUrl: 'https://site.atlassian.net', email: 'a@b.test', token: 'x' };

const issue = (key, categoryKey, statusName, extra = {}) => ({
  key,
  fields: {
    summary: `${key} summary`,
    status: { name: statusName, statusCategory: { key: categoryKey, name: categoryKey } },
    ...extra,
  },
});

console.log('jira.js — asking about what we filed');

await test('one request for every key, not one per issue', async () => {
  reply = { issues: [issue('QA-1', 'done', 'Done'), issue('QA-2', 'new', 'To Do')] };
  await issueStatus(CFG, ['QA-1', 'QA-2']);
  assert.match(lastRequest.url, /search\/jql/);
  assert.equal(lastRequest.body.jql, 'key in (QA-1,QA-2)');
});

await test('duplicate keys are asked about once', async () => {
  reply = { issues: [issue('QA-1', 'done', 'Done')] };
  await issueStatus(CFG, ['QA-1', 'QA-1', 'QA-1']);
  assert.equal(lastRequest.body.jql, 'key in (QA-1)');
});

await test('a key that is not a key is never put into the JQL', async () => {
  reply = { issues: [] };
  // Keys come out of stored session records, and a stored value is still input.
  await issueStatus(CFG, ['QA-1', 'QA-2) OR project = EVIL --', 'nonsense', '']);
  assert.equal(lastRequest.body.jql, 'key in (QA-1)', 'only the well-formed key survives');
});

await test('no keys at all makes no request', async () => {
  lastRequest = null;
  const out = await issueStatus(CFG, []);
  assert.deepEqual(out, []);
  assert.equal(lastRequest, null, 'asking about nothing should cost nothing');
});

await test('the category is read, because the status name is site-specific', async () => {
  reply = { issues: [issue('QA-1', 'done', 'Shipped to production')] };
  const [s] = await issueStatus(CFG, ['QA-1']);
  assert.equal(s.status, 'Shipped to production', 'the name is kept, for display');
  assert.equal(s.category, 'done', 'and the category, for deciding');
});

await test('an issue that has vanished is reported, not dropped', async () => {
  reply = { issues: [issue('QA-1', 'done', 'Done')] };
  const out = await issueStatus(CFG, ['QA-1', 'QA-99']);
  assert.equal(out.length, 2, 'both keys must come back');
  assert.equal(out[1].gone, true, 'a defect that vanished from the tracker is worth knowing about');
});

await test('the order asked for is the order returned', async () => {
  reply = { issues: [issue('QA-2', 'new', 'To Do'), issue('QA-1', 'done', 'Done')] };
  const out = await issueStatus(CFG, ['QA-1', 'QA-2']);
  assert.deepEqual(out.map((s) => s.key), ['QA-1', 'QA-2'], 'Jira answers in its own order; ours must be stable');
});

console.log('\njira.js — the roll-up');

const S = (key, category) => ({ key, category, gone: false });

await test('all done says so plainly', () => {
  const out = summariseStatuses([S('A', 'done'), S('B', 'done')]);
  assert.equal(out.allDone, true);
  assert.match(out.line, /All 2 issues .*are done/, 'the count and the noun have to agree');
});

await test('a mix counts each state', () => {
  const out = summariseStatuses([S('A', 'done'), S('B', 'indeterminate'), S('C', 'new')]);
  assert.equal(out.allDone, false);
  assert.deepEqual([out.done, out.inProgress, out.todo], [1, 1, 1]);
  assert.match(out.line, /1 done · 1 in progress · 1 to do/);
});

await test('an empty set is not "all done"', () => {
  // The dangerous default: zero of zero is technically all, and reporting
  // "everything is fixed" for a session that filed nothing would be a lie.
  const out = summariseStatuses([]);
  assert.equal(out.allDone, false);
  assert.match(out.line, /Nothing was filed/);
});

await test('a set of only-vanished issues is not "all done" either', () => {
  const out = summariseStatuses([{ key: 'A', gone: true }, { key: 'B', gone: true }]);
  assert.equal(out.allDone, false, 'deleted is not fixed');
  assert.equal(out.gone, 2);
  assert.match(out.line, /2 no longer in Jira/);
});

await test('vanished issues are counted but do not block "all done"', () => {
  const out = summariseStatuses([S('A', 'done'), { key: 'B', gone: true }]);
  assert.equal(out.allDone, true, 'the one issue that still exists is done');
  assert.equal(out.gone, 1);
});

console.log('\njira.js — the fields a type accepts, from createmeta');

await test('issueTypes keeps every field with its schema, required first, and a control for each', async () => {
  const asList = (o) => Object.entries(o).map(([fieldId, f]) => ({ fieldId, ...f }));
  const bugFields = {
    summary: { required: true, name: 'Summary', schema: { type: 'string' } },
    description: { required: false, name: 'Description', schema: { type: 'string' } },
    project: { required: true, name: 'Project', schema: { type: 'project' } },
    issuetype: { required: true, name: 'Issue Type', schema: { type: 'issuetype' } },
    reporter: { required: true, name: 'Reporter', schema: { type: 'user' } },
    attachment: { required: false, name: 'Attachment', schema: { type: 'array', items: 'attachment' } },
    priority: { required: false, name: 'Priority', hasDefaultValue: true, schema: { type: 'priority' }, allowedValues: [{ id: '3', name: 'Medium' }] },
    labels: { required: false, name: 'Labels', schema: { type: 'array', items: 'string' }, autoCompleteUrl: 'x' },
    customfield_10050: { required: true, name: 'Environment', schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' }, allowedValues: [{ id: '9', value: 'Staging' }] },
    duedate: { required: false, name: 'Due date', schema: { type: 'date' } },
  };
  reply = (url) =>
    /issuetypes\/1\?/.test(url) ? { fields: asList(bugFields) }
      : /issuetypes\/5\?/.test(url) ? { fields: asList({ parent: { required: true, name: 'Parent', schema: { type: 'issuelink', system: 'parent' } } }) }
        : { issueTypes: [{ id: '1', name: 'Bug', subtask: false }, { id: '5', name: 'Sub-task', subtask: true }] };
  const types = await issueTypes(CFG, 'QA');
  assert.match(lastRequest.url, /createmeta\/QA\/issuetypes\/\d+\?/, 'the per-type createmeta endpoint, not the removed expanded call');
  const bug = types.find((t) => t.name === 'Bug');
  assert.deepEqual(bug.fields.map((f) => f.key), ['customfield_10050', 'duedate', 'labels', 'priority'], 'required first, then by name; handled fields dropped');
  assert.equal(bug.required.length, 1);
  assert.equal(bug.fields[0].control, 'select');
  assert.deepEqual(bug.fields[0].allowedValues, [{ id: '9', name: 'Staging', value: 'Staging' }]);
  assert.equal(bug.fields.find((f) => f.key === 'labels').control, 'tags');
  assert.equal(bug.fields.find((f) => f.key === 'duedate').control, 'date');
  assert.equal(bug.fields.find((f) => f.key === 'priority').hasDefault, true);
  const sub = types.find((t) => t.subtask);
  assert.equal(sub.fields[0].key, 'parent');
  assert.equal(sub.fields[0].control, 'text');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
