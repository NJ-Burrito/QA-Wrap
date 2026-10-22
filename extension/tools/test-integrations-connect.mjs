/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The nine non-Jira trackers against a real local HTTP server (T-TR-NET-02/03, FX-3).
 *
 * `test-trackers.mjs` stubs `fetch` itself; this one lets the adapters' own requests travel over a socket
 * to 127.0.0.1, so the real `fetch`, timeout and error paths run. Each tracker's vendor host is rewritten to
 * the mock and named in an `x-mock-host` header, so one server answers for all nine.
 *
 * For every tracker: connect + list + file succeed with the right method, path, auth and body; and every
 * failure (401, 403, 404, 500, an HTML sign-in page, a wrong-shaped answer, a timeout, an unknown host, a
 * closed port) ends in one short sentence that names the fix, never a raw TypeError or `fetch failed`.
 */
import assert from 'node:assert/strict';
import http from 'node:http';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/* ── one mock for all nine ─────────────────────────────────────────────── */

let mode = 'ok';
let log = [];

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

/** The happy answers, by vendor host and path, shaped like each real API's documented reply. */
function okReply(host, method, path, body) {
  const p = path.split('?')[0];
  if (host === 'api.github.com') {
    if (p === '/user') return { login: 'tess', name: 'Tess' };
    if (p === '/repos/a/b') return { full_name: 'a/b', private: true, permissions: { push: true } };
    if (p === '/repos/a/b/issues' && method === 'POST') return [201, { number: 7, html_url: 'https://github.com/a/b/issues/7' }];
  }
  if (host === 'gitlab.example') {
    if (p === '/api/v4/user') return { name: 'Tess', username: 'tess' };
    if (p === '/api/v4/projects/5') return { id: 5, path_with_namespace: 'g/p', visibility: 'private' };
    if (p === '/api/v4/projects/5/issues' && method === 'POST') return [201, { id: 55, iid: 3, web_url: 'https://gitlab.example/g/p/-/issues/3' }];
  }
  if (host === 'dev.azure.com') {
    if (p === '/acme/_apis/projects') return { value: [{ name: 'portal' }] };
    if (p === '/acme/portal/_apis/wit/workitemtypes') return { value: [{ name: 'Bug' }, { name: 'Task' }] };
    if (p.startsWith('/acme/portal/_apis/wit/workitems/$') && method === 'POST') return { id: 9, _links: { html: { href: 'https://dev.azure.com/acme/portal/_workitems/edit/9' } } };
  }
  if (host === 'api.linear.app' && p === '/graphql') {
    const q = body?.query || '';
    if (q.includes('viewer')) return { data: { viewer: { id: 'u1', name: 'Tess' } } };
    if (q.includes('teams')) return { data: { teams: { nodes: [{ id: 'T1', key: 'ENG', name: 'Engineering' }] } } };
    if (q.includes('issueCreate')) return { data: { issueCreate: { success: true, issue: { id: 'i1', identifier: 'ENG-1', url: 'https://linear.app/x/issue/ENG-1' } } } };
  }
  if (host === 'api.trello.com') {
    if (p === '/1/members/me') return { fullName: 'Tess', username: 'tess' };
    if (p === '/1/members/me/boards') return [{ id: 'B1', name: 'Board' }];
    if (p === '/1/boards/B1/lists') return [{ id: 'L1', name: 'To do' }];
    if (p === '/1/cards' && method === 'POST') return { id: 'c1', idShort: 4, shortUrl: 'https://trello.com/c/c1' };
  }
  if (host === 'api.clickup.com') {
    if (p === '/api/v2/user') return { user: { id: 1, username: 'tess' } };
    if (p === '/api/v2/team') return { teams: [{ id: 'W1' }] };
    if (p === '/api/v2/team/W1/space') return { spaces: [{ id: 'S1', name: 'Space' }] };
    if (p === '/api/v2/space/S1/list') return { lists: [{ id: 'L1', name: 'Bugs' }] };
    if (p === '/api/v2/list/L1/task' && method === 'POST') return { id: 'k1', url: 'https://app.clickup.com/t/k1' };
  }
  if (host === 'app.asana.com') {
    if (p === '/api/1.0/users/me') return { data: { gid: 'g1', name: 'Tess', workspaces: [{ gid: 'W1', name: 'Acme' }] } };
    if (p === '/api/1.0/projects') return { data: [{ gid: 'P1', name: 'Portal' }] };
    if (p === '/api/1.0/tasks' && method === 'POST') return [201, { data: { gid: 't1' } }];
  }
  if (host === 'api.app.shortcut.com') {
    if (p === '/api/v3/member') return { id: 'm1', profile: { name: 'Tess' } };
    if (p === '/api/v3/groups') return [{ id: 'G1', name: 'QA' }];
    if (p === '/api/v3/projects') return [{ id: 11, name: 'Portal' }];
    if (p === '/api/v3/stories' && method === 'POST') return [201, { id: 21, app_url: 'https://app.shortcut.com/x/story/21' }];
  }
  if (host === 'yt.example') {
    if (p === '/api/admin/projects') return [{ id: '0-1', shortName: 'QA' }];
    if (p === '/api/users/me') return { login: 'tess', name: 'Tess' };
    if (p === '/api/issues' && method === 'POST') return { id: '2-1', idReadable: 'QA-1' };
  }
  return null;
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const host = req.headers['x-mock-host'];
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    log.push({ host, method: req.method, path: req.url, headers: req.headers, body });
    if (mode === 'timeout') return; // never answers; the client's own deadline ends it
    if (mode === 'html' || (mode === 'htmlpost' && req.method === 'POST')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><body>Sign in</body></html>'); }
    if (/^\d+$/.test(mode)) return json(res, Number(mode), { message: 'mock says no' });
    if (mode === 'null' || (mode === 'nullpost' && req.method === 'POST')) return json(res, 200, 'null');
    const hit = okReply(host, req.method, req.url, body);
    if (!hit) return json(res, 404, { message: `mock has no route for ${req.method} ${host}${req.url}` });
    const [status, out] = Array.isArray(hit) && typeof hit[0] === 'number' ? hit : [200, hit];
    return json(res, status, out);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
// A port that was free a moment ago (fetch itself blocks 9 and 1 as "bad ports" before trying them).
const CLOSED = await new Promise((r) => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const realFetch = globalThis.fetch;
let target = () => `http://127.0.0.1:${PORT}`;
globalThis.fetch = (url, init = {}) => {
  const u = new URL(String(url));
  return realFetch(`${target()}${u.pathname}${u.search}`, { ...init, headers: { ...init.headers, 'x-mock-host': u.host } });
};

const { testConnection, listTargets, fileIssue } = await import('../background/trackers.js');

/* ── the nine, with what each real API wants to see ────────────────────── */

const TRACKERS = {
  github: {
    cfg: { token: 'tok_github', repo: 'a/b' },
    auth: (r) => r.headers.authorization === 'Bearer tok_github' && r.headers['x-github-api-version'],
    file: (r) => r.path === '/repos/a/b/issues' && r.body.title === 'Login fails' && r.body.body.includes('Steps'),
  },
  gitlab: {
    cfg: { host: 'https://gitlab.example', token: 'tok_gitlab', project: '5' },
    auth: (r) => r.headers['private-token'] === 'tok_gitlab',
    file: (r) => r.path === '/api/v4/projects/5/issues' && r.body.title === 'Login fails' && r.body.description.includes('Steps') && r.body.issue_type,
  },
  azure: {
    cfg: { org: 'acme', project: 'portal', token: 'tok_azure' },
    auth: (r) => r.headers.authorization === `Basic ${btoa(':tok_azure')}`,
    file: (r) => r.path.startsWith('/acme/portal/_apis/wit/workitems/$Bug?api-version=7.0') && r.headers['content-type'] === 'application/json-patch+json'
      && r.body.some((op) => op.op === 'add' && op.path === '/fields/System.Title' && op.value === 'Login fails'),
  },
  linear: {
    cfg: { token: 'tok_linear' },
    auth: (r) => r.headers.authorization === 'tok_linear' && r.method === 'POST' && r.path === '/graphql',
    file: (r) => r.body.query.includes('issueCreate') && r.body.variables.input.teamId === 'T1' && r.body.variables.input.title === 'Login fails',
  },
  trello: {
    cfg: { key: 'k1', token: 'tok_trello', list: 'L1' },
    auth: (r) => /[?&]key=k1/.test(r.path) && /[?&]token=tok_trello/.test(r.path) && !r.headers.authorization,
    file: (r) => r.path.startsWith('/1/cards?') && /idList=L1/.test(r.path) && r.body.name === 'Login fails' && r.body.desc.includes('Steps'),
  },
  clickup: {
    cfg: { token: 'tok_clickup', list: 'L1' },
    auth: (r) => r.headers.authorization === 'tok_clickup',
    file: (r) => r.path === '/api/v2/list/L1/task' && r.body.name === 'Login fails' && r.body.markdown_description.includes('Steps'),
  },
  asana: {
    cfg: { token: 'tok_asana', project: 'P1' },
    auth: (r) => r.headers.authorization === 'Bearer tok_asana',
    file: (r) => r.path === '/api/1.0/tasks' && r.body.data.name === 'Login fails' && r.body.data.projects[0] === 'P1',
  },
  shortcut: {
    cfg: { token: 'tok_shortcut', project_id: '11' },
    auth: (r) => r.headers['shortcut-token'] === 'tok_shortcut',
    file: (r) => r.path === '/api/v3/stories' && r.body.name === 'Login fails' && r.body.project_id === 11 && r.body.story_type === 'bug',
  },
  youtrack: {
    cfg: { host: 'https://yt.example', token: 'tok_youtrack', shortName: 'QA' },
    auth: (r) => r.headers.authorization === 'Bearer tok_youtrack',
    file: (r) => r.path.startsWith('/api/issues') && r.body.project.id === '0-1' && r.body.summary === 'Login fails',
  },
};

const ISSUE = { title: 'Login fails', body: '## Steps to reproduce\n\n1. Open the page', dedupe: false };
const RAW = /TypeError|SyntaxError|Cannot read|undefined|null|fetch failed|Failed to fetch|<html|\[object/;

/** One readable sentence or two, with no code fault leaking through. */
function readable(err, re) {
  assert.ok(err instanceof Error, 'an Error');
  assert.doesNotMatch(err.message, RAW, `raw fault leaked: ${err.message}`);
  assert.ok(err.message.length <= 320, `too long (${err.message.length}): ${err.message}`);
  assert.match(err.message, re);
  // F1: every sentence is keyed (common.worker.err.tr*), the English table rebuilds it word for word, and Arabic changes it.
  const hit = WE.workerErrorKey(err.message);
  if (!/^No project "/.test(err.message)) {
    assert.ok(hit, `not keyed in platform/worker-errors.js: ${err.message}`);
    assert.equal(WE.fillHit(hit, tOf(EN)), err.message, 'the English table drifted from the worker sentence');
    const ar = WE.fillHit(hit, tOf(AR));
    assert.ok(/[؀-ۿ]/.test(ar) && !/\{\w+\}|common\.worker/.test(ar), `Arabic not filled: ${ar}`);
  }
  return true;
}
const WE = await import('../platform/worker-errors.js');
const readJson = async (f) => JSON.parse((await import('node:fs')).readFileSync(new URL(`../platform/i18n/${f}`, import.meta.url), 'utf8'));
const EN = await readJson('en.json'), AR = await readJson('ar.json');
const tOf = (table) => (key, vars = {}) => String(table[key] ?? key).replace(/\{(\w+)\}/g, (w, n) => (n in vars ? String(vars[n]) : w));

const shortTimers = async (fn) => {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (f, ms, ...a) => real(f, Math.min(ms, 150), ...a);
  try { return await fn(); } finally { globalThis.setTimeout = real; }
};

const table = [];

for (const [id, t] of Object.entries(TRACKERS)) {
  console.log(`\n${id}`);
  const row = { id };

  await test(`${id}: connect, list and file against the mock, with the API's own auth and body`, async () => {
    mode = 'ok'; log = [];
    const out = await testConnection(id, t.cfg);
    assert.ok(out.account.name, 'an account name to show');
    assert.ok(log.length && log.every(t.auth), `auth scheme wrong on ${log.find((r) => !t.auth(r))?.path}`);
    const targets = await listTargets(id, t.cfg);
    assert.ok(targets.length >= 1, 'at least one target');
    log = [];
    const filed = await fileIssue(id, t.cfg, ISSUE);
    assert.ok(filed.key && filed.url, 'a key and a link back');
    const post = log.filter((r) => r.method === 'POST').at(-1);
    assert.ok(post && t.file(post), `file request shape: ${JSON.stringify(post && { path: post.path, body: post.body })}`);
    assert.ok(log.every(t.auth), 'every filing request carries the credential the right way');
    row.ok = 'pass';
  });

  const cases = [
    ['401', /refused this \(401\).*Check the token/],
    ['403', /refused this \(403\).*not allowed to do this/],
    ['404', /refused this \(404\).*Check the host/],
    ['500', /refused this \(500\).*try again in a few minutes/],
    ['html', /sent back a web page instead of data\. Check the host address/],
    // YouTrack proves the project first, so an empty answer there is "no project", already a sentence.
    ['null', id === 'youtrack' ? /No project "QA" on https:\/\/yt\.example/ : /answered, but not with what QA Wrap expected\. Check the host address and the token/],
  ];
  for (const [m, re] of cases) {
    await test(`${id}: ${m} → ${re.source.slice(0, 40)}`, async () => {
      mode = m;
      await assert.rejects(() => testConnection(id, t.cfg), (err) => { row[m] = err.message; return readable(err, re); });
    });
  }

  await test(`${id}: no answer → a timeout sentence`, async () => {
    mode = 'timeout';
    await shortTimers(() => assert.rejects(() => testConnection(id, t.cfg), (err) => { row.timeout = err.message; return readable(err, /Could not reach .*No answer after 20 s\. Check the host address and your network/); }));
  });

  await test(`${id}: unknown host → says the name does not exist`, async () => {
    target = () => 'http://qawrap-nohost-1020.invalid';
    try {
      await assert.rejects(() => testConnection(id, t.cfg), (err) => { row.dns = err.message; return readable(err, /Could not reach .*host name does not exist/); });
    } finally { target = () => `http://127.0.0.1:${PORT}`; }
  });

  await test(`${id}: closed port → says nothing answered`, async () => {
    target = () => `http://127.0.0.1:${CLOSED}`;
    try {
      await assert.rejects(() => testConnection(id, t.cfg), (err) => readable(err, /Could not reach .*Nothing answered at that address/));
    } finally { target = () => `http://127.0.0.1:${PORT}`; }
  });

  await test(`${id}: filing refused (401) and filing answered wrongly both read as sentences`, async () => {
    mode = '401';
    await assert.rejects(() => fileIssue(id, t.cfg, ISSUE), (err) => readable(err, /\(401\).*Check the token/));
    mode = 'nullpost';
    await assert.rejects(() => fileIssue(id, t.cfg, ISSUE), (err) => readable(err, new RegExp(`whether the issue was created before filing again|refused this|No project`)));
  });
  table.push(row);
}

console.log('\nshared');

await test('a token pasted with characters btoa cannot encode (Azure) is a sentence, not InvalidCharacterError', async () => {
  mode = 'ok';
  await assert.rejects(() => testConnection('azure', { org: 'acme', project: 'portal', token: '••••abcd' }),
    (err) => readable(err, /token contains characters a token cannot have; paste it again/));
});

await test('an HTML 200 on a YouTrack create is not re-sent without the Type field (it may be a login page, not a refusal)', async () => {
  mode = 'htmlpost'; log = [];
  await assert.rejects(() => fileIssue('youtrack', TRACKERS.youtrack.cfg, ISSUE), (err) => readable(err, /sent back a web page/));
  assert.equal(log.filter((r) => r.method === 'POST').length, 1, 'one POST, no blind retry');
});

await test('F1: the shapes the mock does not reach (429, cert, may-have-gone-through, a code with no fix) are keyed too', () => {
  for (const s of ['GitHub refused this (429): slow down. Rate-limited; try again in 30 s; nothing was created twice.',
    'GitHub refused this (429): no reason given. Rate-limited; nothing was created twice.',
    'GitLab refused this (422): it sent a web page, not an error message.',
    'Linear refused this: Argument Validation Error; Team not found',
    'No Trello list chosen.', 'No ClickUp list chosen.', 'No Asana project chosen.', 'No Shortcut project, team or workflow state chosen.',
    'Linear refused this (502): Bad gateway. The service failed on its side; try again in a few minutes.',
    'Could not reach Asana. Its security certificate is not trusted. Check the host address and your network.',
    'Could not reach Trello. No answer after 20 s. It may have gone through: check before filing again. Check the host address and your network.',
    'ClickUp answered, but not with what QA Wrap expected. Check in ClickUp whether the issue was created before filing again.']) readable(new Error(s), /./);
  for (const s of ['No Linear team you can file into.', 'Linear accepted the request but did not create the issue.', 'Linear gave no upload address.', 'upload refused (403)',
    'Linear did not link the file to the issue.', 'GitLab gave no link for the upload.', 'Azure DevOps gave no address for the upload.',
    'That token reaches Acme but not the project "Web".', 'No YouTrack project short name given.', 'No project "WEB" on https://yt.example.com.',
    'You can read acme/web but not file issues on it.', 'Jira needs API token and Email.', 'An issue needs a title.']) readable(new Error(s), /./); // F4: the last plain throws of trackers.js
  assert.ok(WE.translateWorkerError('That token reaches Acme but not the project "Web".', tOf(AR), 'ar').includes('«Web»'), 'F4: holes are filled in Arabic');
  const ar = WE.translateWorkerError('GitHub refused this (403): Resource not accessible. The token works but is not allowed to do this: give it access to this project, or use one that has it.', tOf(AR), 'ar');
  assert.ok(ar.includes('«Resource not accessible»') && ar.includes(AR['common.worker.err.trFixAccess']), ar);
  assert.equal(WE.translateWorkerError('Could not reach Jira. Blocked by policy. Check the host address and your network.', tOf(AR), 'ar'), null, 'an unknown reason stays as it came');
});

server.closeAllConnections?.();
await new Promise((r) => server.close(r));

if (process.argv.includes('--table')) {
  for (const r of table) console.log(`| ${r.id} | ${r.ok || 'FAIL'} | ${['401', 'html', 'timeout', 'dns'].map((k) => r[k] || '').join(' | ')} |`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
