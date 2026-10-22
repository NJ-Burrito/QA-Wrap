/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * There are two Jiras, and this is the file that keeps us able to talk to both.
 *
 * ── the bug ────────────────────────────────────────────────────────────────
 *
 * `background/jira.js` sent `Authorization: Basic base64(email:token)` to every
 * site it was pointed at. That is Atlassian Cloud's scheme. A self-hosted Jira,
 * which Atlassian calls Data Center, signs with `Authorization: Bearer <token>`
 * and refuses Basic carrying a personal access token with a bare 401 that reads
 * exactly like a wrong password. The product could not file into any Jira that
 * was not `*.atlassian.net`, and the refusal told nobody why.
 *
 * ── what is asserted, and why against fixtures ─────────────────────────────
 *
 * `fetch` is replaced, so nothing here reaches a network and no credential is
 * needed. Four things are checked, because four things can each break on their
 * own:
 *
 * 1. **the header for each mode** — Basic with the pair, Bearer with the token
 *    alone, and the REST version that goes with each.
 * 2. **the host detection** — `*.atlassian.net` is Cloud, everything else is
 *    Data Center.
 * 3. **the override winning over the detection**, in both directions, because a
 *    setting that is quietly ignored is worse than no setting.
 * 4. **the connection test refusing a personal access token in Cloud mode with
 *    a plain sentence**, because that combination is the one a person actually
 *    creates, and the 401 it produces says nothing.
 *
 * And one structural check: that `background/jira.js` builds no Authorization
 * header of its own and writes no REST version into a string. A second copy of
 * the auth logic is how the first bug survived as long as it did.
 *
 *   node tools/test-jira-auth.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  authHeader,
  credentialProblem,
  detectAuthMode,
  isAutoMode,
  jiraTransport,
  refusedCredentialsMessage,
  resolveAuthMode,
} from '../core/jira-auth.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/* ── a Jira that records what it was asked, and answers what the test says ── */

let sent = [];
let reply = { status: 200, body: {} };
globalThis.fetch = async (url, init = {}) => {
  sent.push({
    url: String(url),
    method: init.method || 'GET',
    headers: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
  });
  return {
    ok: reply.status < 400,
    status: reply.status,
    text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
  };
};
const reset = (r = { status: 200, body: {} }) => { sent = []; reply = r; };

/* Two sites, one of each kind. Neither token is real: both are the word. */
const CLOUD = { baseUrl: 'https://acme.atlassian.net', email: 'qa@example.test', token: 'fixture-cloud-token' };
const SERVER = { baseUrl: 'https://jira.example.test', token: 'fixture-server-token' };

const { whoAmI, projects, testConnection, createIssue, attachFile } = await import('../background/jira.js');

console.log('jira auth - the header for each mode');

await test('cloud signs with Basic, the email and the token joined by a colon', () => {
  const expected = `Basic ${Buffer.from('qa@example.test:fixture-cloud-token', 'binary').toString('base64')}`;
  assert.equal(authHeader({ ...CLOUD, authMode: 'cloud' }), expected);
  assert.equal(jiraTransport(CLOUD).headers.authorization, expected, 'the transport must use the same builder');
});

await test('server signs with Bearer, the token alone and no email anywhere in it', () => {
  const header = authHeader({ ...SERVER, authMode: 'server' });
  assert.equal(header, 'Bearer fixture-server-token');
  assert.ok(!/Basic/.test(header), 'Data Center refuses Basic with a personal access token');
});

await test('an email in the settings does not leak into a Bearer header', () => {
  assert.equal(authHeader({ ...SERVER, email: 'qa@example.test', authMode: 'server' }), 'Bearer fixture-server-token');
});

await test('the REST version travels with the mode: 3 for cloud, 2 for data center', () => {
  assert.equal(jiraTransport(CLOUD).api, '/rest/api/3');
  assert.equal(jiraTransport(SERVER).api, '/rest/api/2');
});

await test('a real request carries the right header and the right version', async () => {
  reset({ status: 200, body: { displayName: 'A Tester', accountId: '1' } });
  await whoAmI(CLOUD);
  assert.equal(sent[0].url, 'https://acme.atlassian.net/rest/api/3/myself');
  assert.match(sent[0].headers.authorization, /^Basic /);

  reset({ status: 200, body: { name: 'A Tester' } });
  await whoAmI(SERVER);
  assert.equal(sent[0].url, 'https://jira.example.test/rest/api/2/myself');
  assert.equal(sent[0].headers.authorization, 'Bearer fixture-server-token');
});

await test('the attachment path takes its header from the same builder', async () => {
  reset({ status: 200, body: [{ id: '10' }] });
  await attachFile(SERVER, 'QAW-1', { filename: 'a.md', blob: new Blob(['x']) });
  assert.equal(sent[0].url, 'https://jira.example.test/rest/api/2/issue/QAW-1/attachments');
  assert.equal(sent[0].headers.authorization, 'Bearer fixture-server-token',
    'multipart cannot go through call(), so this is the path a second copy of the auth logic appears in');
  assert.equal(sent[0].headers['x-atlassian-token'], 'no-check');
});

console.log('\njira auth - reading the site URL');

await test('*.atlassian.net is cloud, and every other host is data center', () => {
  for (const url of ['https://acme.atlassian.net', 'http://x.atlassian.net/', 'https://a.b.atlassian.net/jira']) {
    assert.equal(detectAuthMode(url), 'cloud', url);
  }
  for (const url of ['https://jira.acme.example', 'https://jira.example.test:8443', 'jira.internal', 'https://atlassian.net.example.com']) {
    assert.equal(detectAuthMode(url), 'server', url);
  }
});

await test('a site with nothing typed into it yet is not called data center', () => {
  // The field's own placeholder is a Cloud URL, and an empty site never reaches
  // a network: the transport refuses it before the header is built.
  assert.equal(detectAuthMode(''), 'cloud');
  assert.match(credentialProblem({ baseUrl: '', token: 'x' }), /site URL is missing/);
});

await test('with no override, the detected mode is the one in force', () => {
  assert.equal(resolveAuthMode({ baseUrl: 'https://jira.acme.example', authMode: 'auto' }), 'server');
  assert.equal(resolveAuthMode({ baseUrl: 'https://acme.atlassian.net' }), 'cloud', 'a missing setting is auto');
  assert.ok(isAutoMode({ baseUrl: 'https://x.atlassian.net' }));
});

console.log('\njira auth - the override wins over the detection');

await test('server is honoured on an atlassian.net host', () => {
  const cfg = { ...CLOUD, authMode: 'server' };
  assert.equal(resolveAuthMode(cfg), 'server');
  assert.equal(authHeader(cfg), 'Bearer fixture-cloud-token');
  assert.equal(jiraTransport(cfg).api, '/rest/api/2');
  assert.ok(!isAutoMode(cfg));
});

await test('cloud is honoured on a self-hosted host', () => {
  const cfg = { ...SERVER, email: 'qa@example.test', authMode: 'cloud' };
  assert.equal(resolveAuthMode(cfg), 'cloud');
  assert.match(authHeader(cfg), /^Basic /);
  assert.equal(jiraTransport(cfg).api, '/rest/api/3');
});

await test('an unknown value is auto rather than a silent cloud', () => {
  assert.equal(resolveAuthMode({ baseUrl: 'https://jira.example.test', authMode: 'Bearer' }), 'server');
  assert.equal(resolveAuthMode({ baseUrl: 'https://jira.example.test', authMode: '' }), 'server');
});

await test('the two endpoints that differ follow the mode, not the host', async () => {
  reset({ status: 200, body: { values: [{ key: 'AAA' }] } });
  await projects({ ...CLOUD, authMode: 'cloud' });
  assert.match(sent[0].url, /\/rest\/api\/3\/project\/search\?/, 'cloud paginates its project list');

  reset({ status: 200, body: [{ key: 'ACME' }, { key: 'WEBP' }] });
  const list = await projects({ ...SERVER, authMode: 'server' });
  assert.match(sent[0].url, /\/rest\/api\/2\/project\?/, 'data center returns the array whole');
  assert.deepEqual(list.map((p) => p.key), ['ACME', 'WEBP'], 'and the bare array is read, not dropped');
});

console.log('\njira auth - a personal access token in cloud mode');

await test('the connection test refuses it in one plain sentence', async () => {
  // The exact configuration a person creates: a self-hosted site, the personal
  // access token it issued, and the sign-in left saying Cloud. Jira answers
  // 401 with nothing in the body, so the sentence has to come from what we
  // sent and where we sent it.
  reset({ status: 401, body: '' });
  const cfg = { baseUrl: 'https://jira.acme.example', email: 'qa@example.test', token: 'fixture-pat', authMode: 'cloud' };
  const err = await testConnection(cfg).then(() => null, (e) => e);
  assert.ok(err, 'a 401 must not be reported as a working connection');
  assert.match(err.message, /not a Jira Cloud site/);
  assert.match(err.message, /personal access token/);
  assert.ok(!/\{|\[|undefined|null/.test(err.message), 'a plain sentence, not a dump of the response');
  assert.ok(!err.message.includes('fixture-pat'), 'and never the token');
});

await test('the same 401 in the right mode blames the token, not the mode', async () => {
  reset({ status: 401, body: '' });
  const err = await testConnection({ ...SERVER, authMode: 'server' }).then(() => null, (e) => e);
  assert.match(err.message, /Check the personal access token/);
  assert.ok(!/not a Jira Cloud site/.test(err.message));
  assert.equal(refusedCredentialsMessage(CLOUD), 'Jira refused the credentials. Check the email and API token in Settings.');
});

await test('cloud mode with no email is refused before anything is sent', async () => {
  reset();
  const err = await testConnection({ baseUrl: 'https://acme.atlassian.net', token: 'fixture' }).then(() => null, (e) => e);
  assert.match(err.message, /the email is missing/);
  assert.match(err.message, /personal access token on its own/, 'and it says what the other Jira wants instead');
  assert.equal(sent.length, 0, 'a header that cannot be built must not become a request');
});

await test('a missing token is named as the thing that mode calls it', () => {
  assert.match(credentialProblem({ baseUrl: 'https://jira.example.test' }), /personal access token is missing/);
  assert.match(credentialProblem({ baseUrl: 'https://x.atlassian.net', email: 'a@b.test' }), /API token is missing/);
});

console.log('\njira auth - data center with a username and password');

await test('server-basic signs with Basic on /rest/api/2 and the data center paths', () => {
  const cfg = { ...SERVER, email: 'fixture-user', token: 'fixture-pass', authMode: 'server-basic' };
  assert.equal(resolveAuthMode(cfg), 'server-basic');
  assert.equal(isAutoMode(cfg), false);
  assert.equal(authHeader(cfg), `Basic ${Buffer.from('fixture-user:fixture-pass').toString('base64')}`);
  const t = jiraTransport(cfg);
  assert.equal(t.api, '/rest/api/2');
  assert.equal(t.searchPath, '/search');
  assert.match(t.projectsPath, /^\/project\?/);
  assert.equal(t.adf, false, 'data center takes wiki markup whichever way it signs in');
});

await test('a non-Latin password is sent as UTF-8 rather than thrown on', () => {
  const cfg = { ...SERVER, email: 'u', token: 'fixture-كلمة', authMode: 'server-basic' };
  assert.equal(authHeader(cfg), 'Basic ' + Buffer.from('u:fixture-كلمة', 'utf8').toString('base64'));
});

await test('server-basic with no username is refused before anything is sent', async () => {
  reset();
  const err = await testConnection({ ...SERVER, token: 'fixture-pass', authMode: 'server-basic' }).then(() => null, (e) => e);
  assert.match(err.message, /the username is missing/);
  assert.match(credentialProblem({ ...SERVER, email: 'u', token: '', authMode: 'server-basic' }), /password is missing/);
  assert.equal(sent.length, 0);
});

await test('auto never picks server-basic, and a bearer 401 points at the choice without retrying', async () => {
  assert.equal(resolveAuthMode({ baseUrl: 'https://jira.example.test' }), 'server');
  reset({ status: 401, body: '' });
  const err = await testConnection({ ...SERVER, email: 'fixture-user' }).then(() => null, (e) => e);
  assert.equal(sent.length, 1, 'no second request with a password');
  assert.match(sent[0].headers.authorization, /^Bearer /);
  assert.match(err.message, /choose that under Sign-in/);
});

await test('an HTML page with a 200 is a sentence, not a SyntaxError', async () => {
  reset({ status: 200, body: '<html>login</html>' });
  const err = await testConnection({ ...SERVER, authMode: 'server' }).then(() => null, (e) => e);
  assert.equal(err.message, 'Jira returned a login page: check the address and the sign-in type.');
});

await test('a 404 and a 403 HTML page each read as one sentence', async () => {
  reset({ status: 404, body: '<html>nope</html>' });
  let err = await testConnection({ ...SERVER, authMode: 'server' }).then(() => null, (e) => e);
  assert.match(err.message, /no such resource \(404\) at \/myself: check the site URL and the sign-in type\.$/);
  reset({ status: 403, body: '<html>forbidden</html>' });
  err = await testConnection({ ...SERVER, authMode: 'server' }).then(() => null, (e) => e);
  assert.ok(!/</.test(err.message), 'no HTML quoted back');
});

console.log('\njira auth - the description each Jira accepts');

await test('cloud is sent the ADF document, data center the wiki markup', async () => {
  const doc = {
    type: 'doc',
    version: 1,
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What broke' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'The total was ' }, { type: 'text', text: 'wrong', marks: [{ type: 'strong' }] }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open the cart' }] }] }] },
    ],
  };

  let body = null;
  const record = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    body = init.body ? JSON.parse(init.body) : null;
    return record(url, init);
  };

  reset({ status: 201, body: { key: 'QAW-1', id: '1' } });
  await createIssue({ ...CLOUD, authMode: 'cloud' }, { projectKey: 'QAW', issueTypeName: 'Bug', summary: 's', description: doc });
  assert.equal(body.fields.description.type, 'doc', 'cloud takes Atlassian Document Format');

  reset({ status: 201, body: { key: 'ACME-1', id: '2' } });
  await createIssue({ ...SERVER, authMode: 'server' }, { projectKey: 'ACME', issueTypeName: 'Bug', summary: 's', description: doc });
  assert.equal(typeof body.fields.description, 'string', 'data center takes a string, and refuses the object without saying so');
  assert.match(body.fields.description, /^h2\. What broke/);
  assert.match(body.fields.description, /\*wrong\*/, 'bold survives as wiki markup');
  assert.match(body.fields.description, /^\* Open the cart$/m, 'and so does the list');

  globalThis.fetch = record;
});

console.log('\njira auth - one copy of the auth logic');

await test('background/jira.js builds no Authorization header of its own', () => {
  const src = fs.readFileSync(path.join(EXT, 'background/jira.js'), 'utf8');
  assert.ok(!/btoa\(/.test(src), 'a Basic header assembled here is a second copy of the auth logic');
  assert.ok(!/Basic \$\{|Bearer \$\{/.test(src), 'the scheme is chosen in core/jira-auth.js and nowhere else');
  assert.match(src, /jiraTransport/, 'and the one builder is what it uses');
});

await test('no module writes a REST version into a request path', () => {
  // `/rest/api/3` in a string is how the product came to speak only to Cloud.
  // Comments may name it; a path may not.
  for (const rel of ['background/jira.js', 'background/service-worker.js', 'background/jira-door.js']) {
    const src = fs.readFileSync(path.join(EXT, rel), 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!/rest\/api\/[23]/.test(code), `${rel} writes a REST version into its own path`);
  }
});

await test('the settings default leaves the choice to the host', () => {
  const src = fs.readFileSync(path.join(EXT, 'platform/settings.js'), 'utf8');
  assert.match(src, /authMode: 'auto'/, 'a fresh profile must detect rather than assume');
});

await test('the settings page offers all four values and no others', () => {
  const html = fs.readFileSync(path.join(EXT, 'options/options.html'), 'utf8');
  const select = /<select id="jira-authMode">([\s\S]*?)<\/select>/.exec(html);
  assert.ok(select, 'there is no visible override on the settings page');
  const values = [...select[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ['auto', 'cloud', 'server', 'server-basic']);
  assert.match(html, /id="jira-auth-help"/, 'the help line has to exist to be filled');
});

await test('the settings page reads the mode from the same module the client does', () => {
  const js = fs.readFileSync(path.join(EXT, 'options/options.js'), 'utf8');
  assert.match(js, /from '\.\.\/core\/jira-auth\.js'/, 'a second detector on the page would drift');
  assert.ok(!/atlassian\.net/.test(js), 'the host rule lives in core/jira-auth.js and nowhere else');
});

console.log('\njira auth - the live script');

await test('JIRA_AUTH is read, and an unknown value falls back to the host', () => {
  const src = fs.readFileSync(path.join(EXT, 'tools/jira-live.mjs'), 'utf8');
  assert.match(src, /env\.JIRA_AUTH/, 'the env file must be able to say which Jira this is');
  assert.match(src, /'bearer'/);
  assert.match(src, /'basic'/);
  assert.match(src, /from '\.\.\/core\/jira-auth\.js'/, 'and it must agree with the extension');
});

await test('the token is never printed, and --check files nothing', () => {
  const src = fs.readFileSync(path.join(EXT, 'tools/jira-live.mjs'), 'utf8');
  // Every `console.log` in the file, read for the one thing none of them may
  // carry. `cfg.token` in a template is the whole shape of that mistake, and so
  // is a prefix of it.
  for (const line of src.split('\n')) {
    if (!/console\.(log|error)/.test(line)) continue;
    assert.ok(!/cfg\.token|env\.JIRA_TOKEN|\.token\b/.test(line), `a printed line reaches for the token: ${line.trim()}`);
  }
  const check = /if \(checkOnly\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(check, '--check has no block of its own');
  assert.ok(!/createIssue|attachFiles|attachProvenance/.test(check[1]), '--check must not write anything');
  assert.match(check[1], /\/myself/);
  assert.match(check[1], /projects\(cfg\)/);
  assert.match(check[1], /process\.exit\(0\)/, 'and it must stop there');
});

await test('this file holds no credential, and reads none from the tree', () => {
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8').replace(/fixture-[a-z-]+/g, '');
  for (const shape of [/ATATT[A-Za-z0-9_-]{20,}/, /[A-Za-z0-9+/]{40,}={0,2}/]) {
    assert.ok(!shape.test(src), `a real-looking token matches ${shape}`);
  }
  assert.equal(sent.filter((r) => /acme\.example/.test(r.url) && r.method !== 'GET').length, 0,
    'nothing here writes to a real host');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
