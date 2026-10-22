/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The five trackers that are not Jira.
 *
 * Every adapter is exercised against a stub `fetch` that records what was sent,
 * because the request an adapter builds is most of what can go wrong with it —
 * a wrong auth scheme, a body under the wrong key, a 200 read as success when
 * the vendor put the failure in the payload.
 *
 * Three properties are asserted for all five, because all five get them wrong
 * in the wild:
 *
 *   the credential is proved before anything real is sent,
 *   a failure surfaces the **vendor's** message, not a status code,
 *   and success is judged by what that API actually signals.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/* ── a network that answers whatever the test wants ───────────────────── */

let sent = [];
let routes = [];

const route = (match, reply) => routes.push({ match, reply });

globalThis.fetch = async (url, init = {}) => {
  // Shortcut and YouTrack upload attachments as multipart/form-data, which is
  // not JSON: recorded as the field/filename pairs instead, so a test can
  // still assert what was sent without teaching the mock to read a real body.
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const record = {
    url: String(url),
    method: init.method || 'GET',
    headers: init.headers || {},
    body: isForm ? null : (init.body ? JSON.parse(init.body) : null),
    form: isForm ? [...init.body.entries()].map(([field, value]) => ({ field, filename: value?.name })) : null,
  };
  sent.push(record);

  const hit = routes.find((r) => record.url.includes(r.match));
  // A function reply can look at what was actually sent — YouTrack's
  // Type-field retry answers the same URL twice with different bodies, and a
  // static fixture cannot tell those two requests apart.
  const reply = (typeof hit?.reply === 'function' ? hit.reply(record) : hit?.reply) ?? { status: 200, body: {} };
  return {
    ok: reply.status < 400,
    status: reply.status,
    text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
  };
};

const reset = () => {
  sent = [];
  routes = [];
};

const {
  TRACKERS, trackerById, trackerCatalogue, isConfigured, testConnection, listTargets, fileIssue,
} = await import('../background/trackers.js');

console.log('trackers.js — the catalogue');

await test('every tracker declares what it needs, and explains each field', () => {
  for (const t of trackerCatalogue()) {
    assert.ok(t.needs.length, `${t.id} asks for nothing`);
    for (const need of t.needs) {
      assert.ok(need.label, `${t.id}.${need.key} has no label`);
      assert.ok(need.hint && need.hint.length > 20, `${t.id}.${need.key} does not say where to get it`);
    }
  }
  assert.equal(TRACKERS.length, 9, 'github, gitlab, azure, linear, trello, clickup, asana, shortcut, youtrack');
});

await test('every tracker declares the body format it can actually render', () => {
  for (const t of trackerCatalogue()) {
    // Azure DevOps renders HTML in System.Description and nothing else: it is
    // the one tracker here whose body is not Markdown or plain text.
    assert.ok(['markdown', 'text', 'html'].includes(t.bodyFormat), `${t.id} has no body format`);
  }
  // Asana genuinely has no Markdown, and pretending otherwise sends asterisks.
  assert.equal(trackerById('asana').bodyFormat, 'text');
  assert.equal(trackerById('github').bodyFormat, 'markdown');
  assert.equal(trackerById('gitlab').bodyFormat, 'markdown');
  assert.equal(trackerById('azure').bodyFormat, 'html');
});

await test('a token is required before a button is offered, a list is not', () => {
  assert.equal(isConfigured('github', {}), false);
  assert.equal(isConfigured('github', { token: 't', repo: 'a/b' }), true);
  // The target can be chosen at filing time, so it must not gate the button.
  assert.equal(isConfigured('linear', { token: 't' }), true);
  // Shortcut's project, team and workflow state are the same "chosen later"
  // idea in three vendor-named fields: none of them gates the button.
  assert.equal(isConfigured('shortcut', {}), false);
  assert.equal(isConfigured('shortcut', { token: 't' }), true);
  // YouTrack's project short name is not optional the way GitLab's and
  // Azure's `project` key already is — it is what resolves the numeric id
  // everything else needs, so it must gate the button.
  assert.equal(isConfigured('youtrack', {}), false);
  assert.equal(isConfigured('youtrack', { host: 'h', token: 't' }), false);
  assert.equal(isConfigured('youtrack', { host: 'h', token: 't', shortName: 'DEMO' }), true);
});

console.log('\ntrackers.js — proving the credential first');

await test('GitHub sends a Bearer token and the API version', async () => {
  reset();
  route('api.github.com/user', { status: 200, body: { login: 'layla', name: 'Layla' } });
  const out = await testConnection('github', { token: 'ghp_x', repo: 'a/b' });
  assert.equal(out.account.name, 'Layla');
  assert.equal(sent[0].headers.authorization, 'Bearer ghp_x');
  assert.ok(sent[0].headers['x-github-api-version'], 'GitHub pins its API by header');
});

await test('Linear sends the key with NO scheme, which is the classic mistake', async () => {
  reset();
  route('api.linear.app', { status: 200, body: { data: { viewer: { id: '1', name: 'Layla' } } } });
  await testConnection('linear', { token: 'lin_api_x' });
  assert.equal(sent[0].headers.authorization, 'lin_api_x', '"Bearer <key>" fails with an unhelpful 400');
});

await test('ClickUp also sends the token with no scheme', async () => {
  reset();
  route('api.clickup.com/api/v2/user', { status: 200, body: { user: { id: 9, username: 'layla' } } });
  await testConnection('clickup', { token: 'pk_x', list: '1' });
  assert.equal(sent[0].headers.authorization, 'pk_x');
});

await test('Asana sends a Bearer token', async () => {
  reset();
  route('users/me', { status: 200, body: { data: { gid: '1', name: 'Layla', workspaces: [] } } });
  await testConnection('asana', { token: 'a_x', project: '1' });
  assert.equal(sent[0].headers.authorization, 'Bearer a_x');
});

await test('Trello puts its credentials in the query string, as it requires', async () => {
  reset();
  route('members/me', { status: 200, body: { username: 'layla', fullName: 'Layla' } });
  await testConnection('trello', { key: 'k', token: 't', list: 'L' });
  assert.match(sent[0].url, /key=k/);
  assert.match(sent[0].url, /token=t/);
});

await test('a missing token is refused by name before any request is made', async () => {
  reset();
  await assert.rejects(() => testConnection('github', { repo: 'a/b' }), /Personal access token/);
  assert.equal(sent.length, 0, 'nothing should have been sent');
});

console.log('\ntrackers.js — a 200 is not success');

await test('Linear answers 200 with an errors array, and it is caught', async () => {
  reset();
  route('api.linear.app', { status: 200, body: { errors: [{ message: 'Team not found' }] } });
  await assert.rejects(
    () => fileIssue('linear', { token: 't' }, { title: 'x', body: 'y' }),
    /Team not found/,
    'a GraphQL failure is HTTP 200 — trusting the status files nothing and reports success'
  );
});

await test('the vendor’s own message survives, not a status code', async () => {
  reset();
  route('api.github.com/repos', { status: 422, body: { message: 'Issues are disabled for this repo' } });
  await assert.rejects(
    () => fileIssue('github', { token: 't', repo: 'a/b' }, { title: 'x', body: 'y' }),
    /Issues are disabled for this repo/
  );
});

await test('a non-JSON error body is still reported rather than swallowed', async () => {
  reset();
  route('api.trello.com/1/cards', { status: 400, body: 'invalid value for idList' });
  await assert.rejects(
    () => fileIssue('trello', { key: 'k', token: 't', list: 'L' }, { title: 'x', body: 'y' }),
    /invalid value for idList/
  );
});

await test('an unreachable host says which one, and what to check', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Failed to fetch');
  };
  await assert.rejects(
    () => testConnection('github', { token: 't', repo: 'a/b' }),
    /Could not reach GitHub.*network/s
  );
  globalThis.fetch = realFetch;
});

console.log('\ntrackers.js — every failure ends in a sentence that names the fix (FX-3)');

await test('F-4: a GitLab sign-in page answered with 200 is a sentence, not a TypeError', async () => {
  reset();
  route('/api/v4/user', { status: 200, body: '<html><body>Sign in</body></html>' });
  await assert.rejects(
    () => testConnection('gitlab', { host: 'https://gitlab.example', token: 't', project: '1' }),
    (err) => /GitLab sent back a web page instead of data\. Check the host address/.test(err.message) && !/TypeError|Cannot read/.test(err.message),
  );
});

await test('a 401 keeps the vendor words and adds what to do', async () => {
  reset();
  route('api.github.com/user', { status: 401, body: { message: 'Bad credentials' } });
  await assert.rejects(() => testConnection('github', { token: 't', repo: 'a/b' }), /GitHub refused this \(401\): Bad credentials\. Check the token, or paste a new one\./);
});

await test('an HTML error page (502 from a proxy) is named as a web page, not pasted as markup', async () => {
  reset();
  route('api.clickup.com', { status: 502, body: '<html><h1>Bad Gateway</h1></html>' });
  await assert.rejects(() => testConnection('clickup', { token: 't' }), (err) => /\(502\): it sent a web page.*try again in a few minutes/.test(err.message) && !err.message.includes('<'));
});

await test('an answer of the wrong shape is a sentence; while filing it says to check before filing again', async () => {
  reset();
  route('api.asana.com', { status: 200, body: {} });
  route('app.asana.com', { status: 200, body: {} });
  await assert.rejects(() => testConnection('asana', { token: 't' }), /Asana answered, but not with what QA Wrap expected\. Check the host address and the token\./);
  await assert.rejects(() => fileIssue('asana', { token: 't', project: 'P' }, { title: 'x', dedupe: false }), /Check in Asana whether the issue was created before filing again/);
});

await test('a timed-out Linear query is not called a possible filing; a timed-out mutation is', async () => {
  const realFetch = globalThis.fetch;
  const realST = globalThis.setTimeout;
  globalThis.setTimeout = (f, ms, ...a) => realST(f, Math.min(ms, 20), ...a);
  globalThis.fetch = (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  try {
    await assert.rejects(() => testConnection('linear', { token: 't' }), (err) => /Could not reach Linear\. No answer after 20 s\./.test(err.message) && !/may have gone through/.test(err.message));
    await assert.rejects(() => trackerById('linear').gql({ token: 't' }, 'mutation X { a }'), /may have gone through/);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realST;
  }
});

console.log('\ntrackers.js — filing');

await test('GitHub files an issue and returns a link back', async () => {
  reset();
  route('api.github.com/repos', {
    status: 201,
    body: { number: 42, html_url: 'https://github.com/a/b/issues/42' },
  });
  const out = await fileIssue('github', { token: 't', repo: 'a/b' }, { dedupe: false, title: 'Broken', body: '## Steps', labels: ['qa-wrap'] });
  assert.equal(out.key, '#42');
  assert.equal(out.url, 'https://github.com/a/b/issues/42');
  assert.equal(sent[0].body.title, 'Broken');
  assert.deepEqual(sent[0].body.labels, ['qa-wrap']);
});

await test('Linear files through issueCreate and reads the identifier back', async () => {
  reset();
  route('api.linear.app', {
    status: 200,
    body: {
      data: {
        teams: { nodes: [{ id: 'team1', key: 'ENG', name: 'Engineering' }] },
        issueCreate: { success: true, issue: { identifier: 'ENG-7', url: 'https://linear.app/x/issue/ENG-7' } },
      },
    },
  });
  const out = await fileIssue('linear', { token: 't', team: 'ENG' }, { dedupe: false, title: 'Broken', body: 'body' });
  assert.equal(out.key, 'ENG-7');
});

await test('Asana puts the body under data.notes, where Asana expects it', async () => {
  reset();
  route('app.asana.com/api/1.0/tasks', { status: 201, body: { data: { gid: '77' } } });
  const out = await fileIssue('asana', { token: 't', project: '5' }, { title: 'Broken', body: 'plain text' });
  assert.equal(sent[0].body.data.notes, 'plain text', 'Asana wraps everything in a data envelope');
  assert.deepEqual(sent[0].body.data.projects, ['5']);
  assert.match(out.url, /5\/77/);
});

await test('ClickUp uses markdown_description, not description', async () => {
  reset();
  route('api.clickup.com/api/v2/list', { status: 200, body: { id: 'abc', url: 'https://app.clickup.com/t/abc' } });
  await fileIssue('clickup', { token: 't', list: '1' }, { title: 'Broken', body: '## Steps' });
  assert.ok('markdown_description' in sent[0].body, 'the plain description field renders the asterisks literally');
});

await test('a long title is trimmed before it is sent, not by the server', async () => {
  reset();
  route('api.github.com/repos', { status: 201, body: { number: 1, html_url: 'u' } });
  await fileIssue('github', { token: 't', repo: 'a/b' }, { dedupe: false, title: 'x'.repeat(400), body: '' });
  assert.ok(sent[0].body.title.length <= 240, `sent ${sent[0].body.title.length} characters`);
});

await test('an empty title is refused here rather than at the far end', async () => {
  reset();
  await assert.rejects(() => fileIssue('github', { token: 't', repo: 'a/b' }, { title: '  ' }), /needs a title/);
  assert.equal(sent.length, 0);
});

await test('filing without a target is refused by name', async () => {
  reset();
  await assert.rejects(() => fileIssue('trello', { key: 'k', token: 't' }, { title: 'x' }), /No Trello list/);
  await assert.rejects(() => fileIssue('clickup', { token: 't' }, { title: 'x' }), /No ClickUp list/);
});

console.log('\ntrackers.js — choosing where to file');

await test('Trello lists every board’s lists, labelled by board', async () => {
  reset();
  route('members/me/boards', { status: 200, body: [{ id: 'b1', name: 'QA' }] });
  route('boards/b1/lists', { status: 200, body: [{ id: 'l1', name: 'Bugs' }] });
  const out = await listTargets('trello', { key: 'k', token: 't' });
  assert.deepEqual(out, [{ id: 'l1', label: 'QA › Bugs' }]);
});

await test('GitHub refuses a repo you can read but not file on', async () => {
  reset();
  route('api.github.com/repos', { status: 200, body: { full_name: 'a/b', permissions: { pull: true } } });
  await assert.rejects(() => listTargets('github', { token: 't', repo: 'a/b' }), /not file issues/);
});

console.log('trackers.js - GitLab');

await test('GitLab files into the configured host, never gitlab.com by default', async () => {
  reset();
  route('/api/v4/projects/', { status: 201, body: { iid: 12, id: 900, web_url: 'https://git.acme.example/g/p/-/issues/12' } });
  const cfg = { host: 'https://git.acme.example/', token: 'glpat_x', project: '42' };
  const out = await fileIssue('gitlab', cfg, { dedupe: false, title: 'Submit fails', body: '## Steps', kind: 'defect', labels: ['qa-wrap'] });

  // The host is a field because half of GitLab is self-hosted. A hard-coded
  // gitlab.com here would send a defect report to the wrong company.
  assert.ok(sent[0].url.startsWith('https://git.acme.example/api/v4/'), sent[0].url);
  assert.ok(!sent[0].url.includes('gitlab.com'), 'the configured host is the only host');
  assert.equal(sent[0].headers['private-token'], 'glpat_x', 'GitLab does not take a Bearer token');
  assert.equal(out.key, '#12');
  assert.equal(out.url, 'https://git.acme.example/g/p/-/issues/12');
});

await test('GitLab maps the seven kinds onto its own issue types', async () => {
  const want = {
    defect: 'incident', testcase: 'test_case', task: 'task', subtask: 'task',
    story: 'issue', epic: 'issue', plain: 'issue',
  };
  for (const [kind, type] of Object.entries(want)) {
    reset();
    route('/api/v4/projects/', { status: 201, body: { iid: 1, id: 1, web_url: 'https://gitlab.com/x/-/issues/1' } });
    await fileIssue('gitlab', { host: 'https://gitlab.com', token: 't', project: '1' }, { dedupe: false, title: 'T', body: 'B', kind });
    assert.equal(sent[0].body.issue_type, type, `${kind} should file as ${type}`);
  }
  // The map is the adapter's, and the catalogue hands it to the settings page
  // rather than the page keeping a second copy.
  assert.deepEqual(trackerById('gitlab').types, want);
});

await test('a GitLab error carries GitLab\'s own words', async () => {
  reset();
  route('/api/v4/projects/', { status: 403, body: { message: '403 Forbidden - not authorized to create issue' } });
  await assert.rejects(
    () => fileIssue('gitlab', { host: 'https://gitlab.com', token: 't', project: '1' }, { title: 'T', body: 'B' }),
    /not authorized to create issue/,
  );
});

console.log('\ntrackers.js - Azure DevOps');

await test('Azure sends a JSON Patch document, with the type in the URL', async () => {
  reset();
  route('/_apis/wit/workitems/', { status: 200, body: { id: 77, _links: { html: { href: 'https://dev.azure.com/acme/portal/_workitems/edit/77' } } } });
  const out = await fileIssue('azure', { org: 'acme', project: 'portal', token: 'pat_x' },
    { dedupe: false, title: 'Submit fails', body: '<p>Steps</p>', kind: 'defect', labels: ['qa-wrap', 'severity-major'] });

  // The work item type is a path segment, not a field: `$Bug`, escaped.
  assert.ok(sent[0].url.includes('/_apis/wit/workitems/$Bug'), sent[0].url);
  assert.equal(sent[0].headers['content-type'], 'application/json-patch+json',
    'Azure refuses a plain application/json body with an unhelpful 400');
  assert.ok(Array.isArray(sent[0].body), 'the body is a patch document, not an object');
  assert.deepEqual(sent[0].body[0], { op: 'add', path: '/fields/System.Title', value: 'Submit fails' });
  assert.equal(sent[0].body[2].path, '/fields/System.Tags');
  assert.equal(sent[0].body[2].value, 'qa-wrap; severity-major', 'Azure separates tags with a semicolon');
  assert.equal(out.key, '#77');
  assert.equal(out.url, 'https://dev.azure.com/acme/portal/_workitems/edit/77');
});

await test('Azure maps the seven kinds onto Agile work item types', async () => {
  const want = {
    defect: 'Bug', testcase: 'Test Case', story: 'User Story', epic: 'Epic',
    task: 'Task', subtask: 'Task', plain: 'Issue',
  };
  for (const [kind, type] of Object.entries(want)) {
    reset();
    route('/_apis/wit/workitems/', { status: 200, body: { id: 1 } });
    await fileIssue('azure', { org: 'o', project: 'p', token: 't' }, { dedupe: false, title: 'T', body: 'B', kind });
    assert.ok(sent[0].url.includes(`workitems/$${encodeURIComponent(type)}`), `${kind} -> ${type}: ${sent[0].url}`);
  }
  assert.deepEqual(trackerById('azure').types, want);
});

await test('Azure authenticates a PAT the way Azure asks: Basic, empty user', async () => {
  reset();
  route('/_apis/projects', { status: 200, body: { value: [{ name: 'portal' }] } });
  const who = await testConnection('azure', { org: 'acme', project: 'portal', token: 'pat_x' });
  assert.equal(sent[0].headers.authorization, `Basic ${btoa(':pat_x')}`);
  assert.equal(who.account.id, 'portal');
});

await test('Azure says which of the two names is wrong, not just "no"', async () => {
  reset();
  route('/_apis/projects', { status: 200, body: { value: [{ name: 'something-else' }] } });
  await assert.rejects(
    () => testConnection('azure', { org: 'acme', project: 'portal', token: 'pat_x' }),
    /reaches acme but not the project "portal"/,
  );
});

await test('no request goes anywhere but the configured host', async () => {
  // The egress rule, asserted rather than trusted: every URL any adapter builds
  // has to be on the host the tester configured, or on that vendor's own API
  // where the adapter has no host field.
  const cases = [
    ['gitlab', { host: 'https://git.acme.example', token: 't', project: '1' }, 'git.acme.example'],
    ['azure', { org: 'acme', project: 'portal', token: 't' }, 'dev.azure.com'],
    ['github', { token: 't', repo: 'a/b' }, 'api.github.com'],
    ['youtrack', { host: 'https://git.acme.example', token: 't', shortName: 'X' }, 'git.acme.example'],
    ['shortcut', { token: 't', project_id: '1' }, 'api.app.shortcut.com'],
  ];
  for (const [id, cfg, host] of cases) {
    reset();
    route('', { status: 200, body: { id: 1, iid: 1, number: 1, value: [{ name: 'portal' }] } });
    await fileIssue(id, cfg, { title: 'T', body: 'B', kind: 'defect' }).catch(() => {});
    for (const req of sent) assert.equal(new URL(req.url).host, host, `${id} reached ${req.url}`);
  }
});

console.log('\ntrackers.js - Shortcut');

await test('Shortcut sends the token in a Shortcut-Token header, never Bearer', async () => {
  reset();
  route('api.app.shortcut.com/api/v3/member', { status: 200, body: { id: 'm1', profile: { name: 'Layla' } } });
  const out = await testConnection('shortcut', { token: 'sc_x', project_id: '42' });
  assert.equal(sent[0].headers['Shortcut-Token'], 'sc_x');
  assert.equal(out.account.name, 'Layla');
});

await test('Shortcut refuses to file with no project, team or workflow state chosen', async () => {
  reset();
  await assert.rejects(
    () => fileIssue('shortcut', { token: 't' }, { title: 'x' }),
    /No Shortcut project, team or workflow state chosen/,
  );
  assert.equal(sent.length, 0, 'nothing should have been sent');
});

await test('Shortcut turns plain label strings into the objects the API expects', async () => {
  reset();
  route('api.app.shortcut.com/api/v3/stories', { status: 200, body: { id: 5, app_url: 'https://app.shortcut.com/org/story/5' } });
  const out = await fileIssue('shortcut', { token: 't', project_id: '7' }, { title: 'Broken', body: '## Steps', labels: ['qa-wrap'] });
  assert.deepEqual(sent[0].body.labels, [{ name: 'qa-wrap' }]);
  assert.equal(sent[0].body.project_id, 7, 'project_id is sent as a number, not the string a form field gives it');
  assert.equal(out.key, 'sc-5');
  assert.equal(out.url, 'https://app.shortcut.com/org/story/5');
});

await test('Shortcut maps the seven kinds onto its three story types', async () => {
  const want = {
    defect: 'bug', testcase: 'chore', task: 'chore', subtask: 'chore',
    story: 'feature', epic: 'feature', plain: 'chore',
  };
  for (const [kind, type] of Object.entries(want)) {
    reset();
    route('api.app.shortcut.com/api/v3/stories', { status: 200, body: { id: 1, app_url: 'u' } });
    await fileIssue('shortcut', { token: 't', group_id: 'g1' }, { title: 'T', body: 'B', kind });
    assert.equal(sent[0].body.story_type, type, `${kind} should file as ${type}`);
  }
  assert.deepEqual(trackerById('shortcut').types, want);
});

await test('Shortcut uploads each attachment, in order, then links the story by file_ids', async () => {
  reset();
  route('api.app.shortcut.com/api/v3/stories', { status: 200, body: { id: 5, app_url: 'https://app.shortcut.com/org/story/5' } });
  route('api.app.shortcut.com/api/v3/files', { status: 200, body: [{ id: 201 }] });
  const files = [
    { filename: 'before.png', blob: new Blob(['a'], { type: 'image/png' }) },
    { filename: 'after.png', blob: new Blob(['b'], { type: 'image/png' }) },
  ];
  const out = await fileIssue('shortcut', { token: 't', project_id: '7' }, { title: 'T', body: 'B', attachments: files });

  // [0] creates the story, [1] and [2] upload the two files in the order
  // given, [3] links both uploaded ids onto the story that was just made.
  assert.equal(sent.length, 4);
  assert.ok(sent[1].url.includes('/api/v3/files'));
  assert.deepEqual(sent[1].form, [{ field: 'file0', filename: 'before.png' }]);
  assert.deepEqual(sent[2].form, [{ field: 'file0', filename: 'after.png' }]);
  assert.ok(sent[3].url.endsWith('/api/v3/stories/5'), sent[3].url);
  assert.equal(sent[3].method, 'PUT');
  assert.deepEqual(sent[3].body.file_ids, [201, 201]);
  assert.deepEqual(out.attached, [{ name: 'before.png', ok: true }, { name: 'after.png', ok: true }]);
  assert.equal(out.attachedBytes, 2, 'D-1010-150: the two one-byte blobs that went up');
});

await test('a Shortcut attachment Jira-style refusal is reported per file, not read as a failed filing', async () => {
  reset();
  route('api.app.shortcut.com/api/v3/stories', { status: 200, body: { id: 5, app_url: 'u' } });
  route('api.app.shortcut.com/api/v3/files', { status: 413, body: { message: 'file too large' } });
  const out = await fileIssue('shortcut', { token: 't', project_id: '7' }, {
    title: 'T', body: 'B', attachments: [{ filename: 'huge.mp4', blob: new Blob(['x']) }],
  });
  assert.equal(out.key, 'sc-5', 'the story still exists');
  assert.deepEqual(out.attached, [{ name: 'huge.mp4', ok: false, error: 'file too large' }]);
  assert.equal(out.attachedBytes, 0, 'a refused upload counts no bytes');
});

console.log('\ntrackers.js - YouTrack');

await test('YouTrack resolves the project id from its short name before filing', async () => {
  reset();
  route('/api/admin/projects', { status: 200, body: [{ id: '0-1', shortName: 'DEMO' }] });
  route('/api/issues', { status: 200, body: { id: '2-38', idReadable: 'DEMO-38' } });
  const out = await fileIssue('youtrack', { host: 'https://y.example', token: 't', shortName: 'DEMO' }, { title: 'T', body: 'B' });

  assert.ok(sent[0].url.includes('/api/admin/projects'), 'the short name is resolved first');
  assert.ok(sent[1].url.includes('/api/issues'));
  assert.equal(sent[1].headers.authorization, 'Bearer t');
  assert.deepEqual(sent[1].body.project, { id: '0-1' }, 'the resolved database id, not the short name, goes in the body');
  assert.equal(out.key, 'DEMO-38');
  assert.equal(out.url, 'https://y.example/issue/DEMO-38');
});

await test('YouTrack says which project short name is missing, not just "no"', async () => {
  reset();
  route('/api/admin/projects', { status: 200, body: [{ id: '0-1', shortName: 'DEMO' }] });
  await assert.rejects(
    () => testConnection('youtrack', { host: 'https://y.example', token: 't', shortName: 'NOPE' }),
    /No project "NOPE" on https:\/\/y\.example/,
  );
});

await test('YouTrack maps the seven kinds onto its default Type values', async () => {
  const want = {
    defect: 'Bug', testcase: 'Task', task: 'Task', subtask: 'Task',
    story: 'Story', epic: 'Epic', plain: 'Task',
  };
  for (const [kind, type] of Object.entries(want)) {
    reset();
    route('/api/admin/projects', { status: 200, body: [{ id: '0-1', shortName: 'DEMO' }] });
    route('/api/issues', { status: 200, body: { id: '2-1', idReadable: 'DEMO-1' } });
    await fileIssue('youtrack', { host: 'https://y.example', token: 't', shortName: 'DEMO' }, { title: 'T', body: 'B', kind });
    assert.deepEqual(sent[1].body.customFields, [{ name: 'Type', $type: 'SingleEnumIssueCustomField', value: { name: type } }]);
  }
  assert.deepEqual(trackerById('youtrack').types, want);
});

await test('YouTrack never loses the report over a Type field the project does not have', async () => {
  reset();
  route('/api/admin/projects', { status: 200, body: [{ id: '0-1', shortName: 'DEMO' }] });
  // The same URL, twice: once with the Type field, refused, and once without.
  route('/api/issues', (record) => (
    record.body?.customFields
      ? { status: 400, body: { error: 'Custom field not found: Type' } }
      : { status: 200, body: { id: '2-38', idReadable: 'DEMO-38' } }
  ));
  const out = await fileIssue('youtrack', { host: 'https://y.example', token: 't', shortName: 'DEMO' }, { title: 'T', body: 'B' });

  assert.equal(out.typeApplied, false, 'the caller can tell the field did not make it');
  assert.equal(out.key, 'DEMO-38', 'the issue was filed anyway');
});

await test('YouTrack attaches files by the issue id, one request per file, after it exists', async () => {
  reset();
  route('/api/admin/projects', { status: 200, body: [{ id: '0-1', shortName: 'DEMO' }] });
  route('/api/issues', { status: 200, body: { id: '2-38', idReadable: 'DEMO-38' } });
  const out = await fileIssue('youtrack', { host: 'https://y.example', token: 't', shortName: 'DEMO' }, {
    title: 'T', body: 'B', attachments: [{ filename: 'shot.png', blob: new Blob(['x'], { type: 'image/png' }) }],
  });

  assert.equal(sent.length, 3, 'resolve project, create issue, attach file');
  assert.ok(sent[2].url.includes('/api/issues/2-38/attachments'), sent[2].url);
  assert.deepEqual(sent[2].form, [{ field: 'shot.png', filename: 'shot.png' }]);
  assert.deepEqual(out.attached, [{ name: 'shot.png', ok: true }]);
});

await test('no fixture in this file carries a real credential', () => {
  // A test that files into a tracker is one paste away from being a test that
  // files into a *real* tracker. Every token here is obviously synthetic.
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const shapes = [/ghp_[A-Za-z0-9]{20,}/, /glpat-[A-Za-z0-9_-]{20,}/, /xox[baprs]-/, /AKIA[0-9A-Z]{16}/];
  for (const shape of shapes) assert.ok(!shape.test(src), `a real-looking secret matches ${shape}`);
});

console.log('\ntrackers.js: the specs the worker reads');

await test('the declarative specs and the adapters cannot drift apart', async () => {
  // `core/tracker-specs.js` is what the service worker reads, because the
  // adapters themselves are behind the offscreen document and must not be in
  // its boot graph. Two lists means drift unless something says otherwise.
  const { TRACKER_SPECS, specById, isConfiguredSpec } = await import('../core/tracker-specs.js');
  assert.deepEqual(
    TRACKER_SPECS.map((t) => t.id),
    trackerCatalogue().map((t) => t.id),
    'the specs list a different set of trackers from the adapters',
  );
  for (const spec of TRACKER_SPECS) {
    const live = trackerCatalogue().find((t) => t.id === spec.id);
    assert.deepEqual(spec, live, spec.id + ': the spec and the adapter disagree');
    assert.ok(specById(spec.id), spec.id + ' is not findable by id');
    // The same question, answered the same way on both sides of the door.
    const cfg = Object.fromEntries(spec.needs.map((n) => [n.key, 'x']));
    assert.equal(isConfiguredSpec(spec.id, cfg), isConfigured(spec.id, cfg), spec.id);
    assert.equal(isConfiguredSpec(spec.id, {}), isConfigured(spec.id, {}), spec.id);
  }
});


console.log('\ntrackers.js: the evidence actually reaching the adapters that can take it');

await test('the filing route names the screenshots, and the door reads them', async () => {
  /*
   * `attach()` exists on Shortcut and YouTrack and was dormant.
   *
   * `fileIssue()` only calls an adapter's `attach()` when the payload carries
   * `attachments`, and `UQA_TRACKER_FILE` built its payload without one, so the
   * two upload routines above were tested here and reached by nobody. Nothing
   * failed; tickets simply arrived with no screenshots on them, which reads as
   * a tracker that cannot take attachments rather than as a defect.
   *
   * Blobs cannot cross `chrome.runtime.sendMessage` — they serialise to `{}` —
   * so the fix is split across the door and both halves are asserted here, from
   * the source, because neither half means anything alone: the worker sends a
   * plan, the offscreen document turns it into files through the same
   * `sessionFiles()` that Jira's attachments come from.
   */
  const sw = workerSrc();
  const filing = sw.slice(sw.indexOf('UQA_TRACKER_FILE:'), sw.indexOf('UQA_TRACKER_FILE:') + 3000);
  assert.match(filing, /sessionId: msg\.sessionId/, 'the tracker payload does not name the session to read evidence from');
  assert.match(filing, /attach: msg\.attach \?\? \{ screenshots: true \}/, 'the tracker payload does not ask for the screenshots');

  const off = fs.readFileSync(path.join(EXT, 'offscreen', 'offscreen.js'), 'utf8');
  assert.match(off, /async function sessionFiles\(sessionId, attach\)/, 'the shared evidence reader is gone');
  assert.match(
    off,
    /\(await sessionFiles\(payload\.sessionId, plan\)\)\.files/,
    'the tracker door no longer turns the plan into files',
  );
  assert.match(off, /lib\.fileIssue\(tracker, cfg, \{ \.\.\.payload, attachments \}\)/, 'fileIssue is not given the attachments');
  // And Jira still reads its evidence through the very same function, which is
  // the whole point of splitting it out.
  assert.match(off, /buildFiles: \(attach\) => sessionFiles\(args\[1\]\.sessionId, attach\)/, 'Jira stopped sharing the reader');
});

/* ── council-1010 round 4: r4-11-1 (D-1010-79) the body, rendered per tracker format ── */
const BS = String.fromCharCode(92);
const hasEscape = (t) => [...'*_[]()!<>|~@`'].some((c) => t.includes(BS + c));

await test('r4-11-1: text (Asana) carries no Markdown escape backslash; html (Azure) is escaped and structured with <p>, <br>, <pre>, <table>', async () => {
  const { render } = await import('../background/trackers.js');
  const { buildDefectReport } = await import('../core/istqb.js');
  const { defectToMarkdown } = await import('../core/istqb-render.js');
  const T0 = 1_700_000_000_000;
  const session = { id: 's_t', charter: 'Pay [now] *fast*', startedAt: T0, endedAt: T0 + 9000, startUrl: 'https://example.gov/pay', env: { language: 'en-US' } };
  const evs = [
    { kind: 'dom', ts: T0 + 100, action: 'click', label: 'Send *now* [a] (b) <i> a_b', locator: "getByRole('button')", frameUrl: 'https://example.gov/pay', tag: 'button' },
    { kind: 'net', ts: T0 + 200, method: 'POST', url: 'https://example.gov/api/save?x=1', status: 500, frameUrl: 'https://example.gov/pay' },
    { kind: 'note', ts: T0 + 300, tag: 'bug', text: 'Fails <script>alert(1)</script> & more | pipe' },
  ];
  const md = await defectToMarkdown(buildDefectReport(session, evs));
  assert.ok(hasEscape(md), 'the fixture must contain mdEsc escapes, or this test proves nothing');
  const text = render(md, 'text');
  assert.ok(!hasEscape(text) && !text.includes(BS + BS), `a backslash escape reached the Asana body:\n${text}`);
  assert.ok(text.includes('Send now [a] (b) <i> a_b') || text.includes('Send *now* [a] (b) <i> a_b'), text);
  assert.ok(!/^#{1,6}\s/m.test(text) && !text.includes('**'));
  const html = render(md, 'html');
  assert.ok(html.includes('<p>') && html.includes('&lt;script&gt;'), html);
  assert.ok(!/<script/i.test(html) && !html.replace(/<\/?(p|br|pre|table|tr|td)>/g, '').includes('<i>'), 'markup from the page reached the Azure body');
  assert.ok(!hasEscape(html), 'an escape backslash reached the Azure body');
  assert.equal(render(md, 'markdown'), md, 'a Markdown tracker gets the Markdown unchanged');
});

await test('r4-11-1: render turns a table into <table>, a fenced block into <pre>, and keeps a literal backslash in code', async () => {
  const { render } = await import('../background/trackers.js');
  const md = ['## Head', '', '| a | b |', '| --- | --- |', `| 1 ${BS}| 2 | ${'`'}x${BS}y${'`'} |`, '', '```', `raw <tag> ${BS}*`, '```', '', 'line one', 'line two'].join('\n');
  const html = render(md, 'html');
  assert.ok(html.includes(`<table><tr><td>a</td><td>b</td></tr><tr><td>1 | 2</td><td>x${BS}y</td></tr></table>`), html);
  assert.ok(html.includes(`<pre>raw &lt;tag&gt; ${BS}*</pre>`), html);
  assert.ok(html.includes('<p>line one<br>line two</p>'), html);
  assert.ok(render(md, 'text').includes(`1 | 2  x${BS}y`), render(md, 'text'));
});

console.log('\nD-1010-189: a 600-step body keeps the first and last 40 steps, per adapter');

await test('every adapter cuts a 600-step body to its cap, in English and Arabic, with the omission line', async () => {
  const { fitBody } = await import('../background/trackers.js');
  const { DOC_LABELS, fill } = await import('../core/doc-labels.js');
  const specs = (await import('../core/tracker-specs.js')).TRACKER_SPECS;
  assert.equal(trackerById('github').maxBody, 65536); assert.equal(trackerById('trello').maxBody, 16384);
  assert.equal(specs.find((s) => s.id === 'github').maxBody, 65536); assert.equal(specs.find((s) => s.id === 'trello').maxBody, 16384);
  for (const lang of ['en', 'ar']) {
    const W = DOC_LABELS[lang];
    const steps = Array.from({ length: 600 }, (_, i) => `${i + 1}. ${'step '.repeat(26)}#${i + 1}.`);
    const body = ['## What', '', 'x', '', `## ${W.jSteps}`, '', ...steps, '', '## Environment', '', 'tail'].join('\n');
    for (const t of TRACKERS) {
      const out = fitBody(body, t);
      const id = `${t.id}/${lang}`;
      assert.ok(out.length <= (t.maxBody || 32767), `${id}: ${out.length} is over the cap`);
      for (const k of [1, 40, 561, 600]) assert.ok(out.includes(`#${k}.`), `${id}: step ${k} was dropped`);
      for (const k of [41, 300, 560]) assert.ok(!out.includes(`#${k}.`), `${id}: step ${k} should be omitted`);
      assert.ok(out.includes(fill(W.stepsOmitted, { n: 520 })), `${id}: omission line missing`);
      assert.ok(out.includes('tail'), `${id}: the sections after the steps are kept`);
    }
    assert.equal(fitBody('## short', trackerById('github')), '## short', 'a body under the cap is untouched');
  }
});

console.log('\nr9-11-4: a cut body ends on a line, closes its fence and says it was cut; a cut title never ends on half an emoji');

await test('every adapter: a 70,000-character body with an open fence is cut at a line, the fence is closed, the note follows, in English and Arabic', async () => {
  const { fitBody } = await import('../background/trackers.js');
  const { DOC_LABELS } = await import('../core/doc-labels.js');
  for (const lang of ['en', 'ar']) {
    const W = DOC_LABELS[lang];
    const lines = Array.from({ length: 1400 }, (_, i) => `console line ${i + 1} ${'x'.repeat(40)}`);
    const body = [`## ${W.jWhat}`, '', 'intro', '', '```', ...lines, '```', '', 'tail'].join('\n');
    for (const t of TRACKERS) {
      const out = fitBody(body, t);
      const id = `${t.id}/${lang}`;
      assert.ok(out.length <= (t.maxBody || 32767), `${id}: ${out.length} is over the cap`);
      assert.ok(out.includes(W.cutNote), `${id}: the cut note is missing`);
      assert.ok(!out.includes('tail'), `${id}: the cut should have dropped the tail`);
      const kept = out.split('\n').filter((l) => /^console line \d+ x{40}$/.test(l));
      assert.ok(kept.length > 0 && kept.length < 1400, `${id}: whole lines kept (${kept.length})`);
      if (!t.bodyFormat || t.bodyFormat === 'markdown') assert.equal(out.split('\n').filter((l) => l.trim() === '```').length % 2, 0, `${id}: the fence is left open`);
    }
  }
});

await test('clipTitle drops a trailing high surrogate; the GitHub issue title that goes out is whole', async () => {
  const { clipTitle } = await import('../background/trackers.js');
  assert.equal(clipTitle('a'.repeat(239) + '\u{1F600}', 240), 'a'.repeat(239));
  assert.equal(clipTitle('abc', 240), 'abc');
  reset();
  route('api.github.com/repos', { status: 201, body: { number: 8, html_url: 'https://github.com/a/b/issues/8' } });
  await fileIssue('github', { token: 't', repo: 'a/b' }, { dedupe: false, title: 'a'.repeat(239) + '\u{1F600}', body: 'x' });
  assert.equal(sent[0].body.title, 'a'.repeat(239));
});

await test('GitHub filing sends the capped body', async () => {
  reset();
  route('api.github.com/repos', { status: 201, body: { number: 7, html_url: 'https://github.com/a/b/issues/7' } });
  const steps = Array.from({ length: 600 }, (_, i) => `${i + 1}. ${'step '.repeat(30)}#${i + 1}.`);
  await fileIssue('github', { token: 't', repo: 'a/b' }, { dedupe: false, title: 'Long', body: ['## Steps to reproduce', '', ...steps].join('\n') });
  assert.ok(sent[0].body.body.length <= 65536 && sent[0].body.body.includes('520 steps omitted'), 'the body that went out is capped');
});

await test('Jira ADF: an ordered list over 80 items keeps the first and last 40 and an omission item, English and Arabic', async () => {
  const { capAdf, DOC_LABELS, fill } = await import('../core/doc-labels.js');
  const item = (t) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  for (const lang of ['en', 'ar']) {
    const doc = { type: 'doc', version: 1, content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Steps to reproduce' }] }, { type: 'orderedList', attrs: { order: 1 }, content: Array.from({ length: 600 }, (_, i) => item(lang === 'ar' ? `خطوة ${i + 1}` : `step ${i + 1}`)) }] };
    const out = capAdf(doc);
    const list = out.content[1].content;
    assert.equal(list.length, 81, `${lang}: 40 + omission + 40`);
    assert.equal(list[40].content[0].content[0].text, fill(DOC_LABELS[lang].stepsOmitted, { n: 520 }));
    assert.equal(list[0], doc.content[1].content[0]); assert.equal(list[80], doc.content[1].content[599]);
    assert.equal(capAdf({ type: 'doc', content: [{ type: 'orderedList', content: doc.content[1].content.slice(0, 80) }] }).content[0].content.length, 80, 'at the limit nothing is cut');
  }
  assert.match(fs.readFileSync(path.join(EXT, 'background/jira.js'), 'utf8'), /adfText\(full\)\.length > 32767 \? capAdf\(full\) : full/, 'the Jira filing path caps its description');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
