/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Jira Test and filing over a real socket (integrations-1020, H4).
 *
 *   node tools/test-jira-connect.mjs
 *
 * test-jira-auth.mjs replaces `fetch`; this one does not. A local HTTP server plays Jira, and the real
 * `fetch` behind core/egress.js talks to it, so the header, the REST prefix, the status handling and
 * the timeout are the ones a tester's browser would meet. Both sign-ins: Cloud (email + API token,
 * Basic) and Data Center (personal access token, Bearer). Outcomes: success, 401, bad URL, refused
 * connection, timeout. Canary credentials only; nothing leaves 127.0.0.1.
 */
import http from 'node:http';

const { testConnection, createIssue } = await import('../background/jira.js');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
const expect = (ok, msg) => { if (!ok) throw new Error(msg); };

/* a Jira that checks the header it is sent */
const CLOUD_AUTH = `Basic ${Buffer.from('qa@canary.test:canary-cloud-token').toString('base64')}`;
const SERVER_AUTH = 'Bearer canary-server-pat';
const seen = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() });
    if (req.url.startsWith('/hang/')) return; // never answers: the timeout case
    const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    const cloud = req.url.includes('/rest/api/3/');
    const ok = req.headers.authorization === (cloud ? CLOUD_AUTH : SERVER_AUTH);
    if (!ok) return send(401, {});
    if (req.url.endsWith('/myself')) return send(200, { accountId: 'a1', displayName: 'Canary QA', emailAddress: 'qa@canary.test' });
    if (req.url.includes('/project')) {
      const list = [{ id: '1', key: 'QAC', name: 'Canary' }];
      return send(200, cloud ? { values: list } : list);
    }
    if (req.url.endsWith('/field')) return send(200, []);
    if (req.url.endsWith('/issue') && req.method === 'POST') return send(201, { id: '10001', key: 'QAC-1' });
    send(404, { errorMessages: ['no such path'] });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const CLOUD = { baseUrl: BASE, email: 'qa@canary.test', token: 'canary-cloud-token', authMode: 'cloud' };
const SERVER = { baseUrl: BASE, token: 'canary-server-pat', authMode: 'server' };
const issue = { projectKey: 'QAC', issueTypeName: 'Bug', summary: 'Canary', description: { type: 'doc', version: 1, content: [] } };

for (const [name, cfg, auth, api] of [['cloud', CLOUD, CLOUD_AUTH, '/rest/api/3/'], ['data center', SERVER, SERVER_AUTH, '/rest/api/2/']]) {
  await test(`${name}: Test connection succeeds, signed ${auth.split(' ')[0]}, on ${api}`, async () => {
    seen.length = 0;
    const r = await testConnection(cfg);
    expect(r.ok && r.mode === cfg.authMode && r.projects === 1 && r.account.name === 'Canary QA', JSON.stringify(r));
    expect(seen.every((s) => s.auth === auth && s.url.startsWith(api)), JSON.stringify(seen.map((s) => [s.url, s.auth])));
  });
  await test(`${name}: filing creates the issue`, async () => {
    const r = await createIssue(cfg, issue);
    expect(r.key === 'QAC-1' && r.url === `${BASE}/browse/QAC-1`, JSON.stringify(r));
    const body = JSON.parse(seen.at(-1).body);
    expect(body.fields.project.key === 'QAC' && typeof body.fields.description === (cfg.authMode === 'cloud' ? 'object' : 'string'), seen.at(-1).body);
  });
  await test(`${name}: a wrong token is a 401 with a sentence, not a crash`, async () => {
    const err = await testConnection({ ...cfg, token: 'wrong' }).then(() => null, (e) => e);
    expect(err?.status === 401 && /refused the credentials|token/i.test(err.message), String(err?.message));
  });
}

await test('a bad URL says it could not reach the site', async () => {
  const err = await testConnection({ ...CLOUD, baseUrl: 'not a url' }).then(() => null, (e) => e);
  expect(/Could not reach not a url/.test(err?.message || ''), String(err?.message));
});

await test('a refused connection says it could not reach the site', async () => {
  const closed = http.createServer();
  await new Promise((r) => closed.listen(0, '127.0.0.1', r));
  const port = closed.address().port;
  await new Promise((r) => closed.close(r));
  const err = await testConnection({ ...SERVER, baseUrl: `http://127.0.0.1:${port}` }).then(() => null, (e) => e);
  expect(/Could not reach/.test(err?.message || ''), String(err?.message));
});

// ponytail: waits the real 20 s TIMEOUT_MS (call() passes no override); add a test seam if the chain gets slow.
await test('a site that never answers times out with a sentence, and a timed-out create warns it may have landed', async () => {
  const err = await createIssue({ ...SERVER, baseUrl: `${BASE}/hang` }, issue).then(() => null, (e) => e);
  expect(/no answer after 20 s/.test(err?.message || '') && /may have gone through/.test(err.message), String(err?.message));
});

server.closeAllConnections?.();
server.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
