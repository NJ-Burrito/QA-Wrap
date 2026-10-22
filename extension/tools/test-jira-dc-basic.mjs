/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Jira Data Center signed in with a username and password (`server-basic`),
 * against a local Jira that answers the way a real one does (integ-1020 FX-2).
 *
 * The live probe found a Data Center site where only Basic on `/rest/api/2`
 * signs in, a shape the extension could not build, and a Jira login page
 * reaching the tester as "SyntaxError: Unexpected token '<'". Asserted here,
 * through the real `fetch` and the product's own `testConnection()`:
 *
 * 1. the right pair, Basic on /rest/api/2/myself, signs in;
 * 2. a wrong password is a 401 sentence naming the username and password;
 * 3. an HTML login page answering 200 is a sentence, never a parse error;
 * 4. auto mode on a Data Center host never retries with a password after a 401;
 * 5. a Jira that never answers is a sentence naming the site and the network.
 *
 *   node tools/test-jira-dc-basic.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';

import { testConnection } from '../background/jira.js';

const USER = 'fixture-user';
const PASS = 'fixture-pass-كلمة';
const good = `Basic ${Buffer.from(`${USER}:${PASS}`, 'utf8').toString('base64')}`;

let behaviour = 'ok';
const seen = [];
const server = http.createServer((req, res) => {
  seen.push({ url: req.url, auth: req.headers.authorization || '' });
  if (behaviour === 'hang') return; // never answers
  if (behaviour === 'html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!DOCTYPE html><html><body>Log in to Jira</body></html>');
  }
  if (req.headers.authorization !== good) {
    res.writeHead(401, { 'content-type': 'text/html' });
    return res.end('<html>Unauthorized (401)</html>');
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  if (req.url === '/rest/api/2/myself') return res.end(JSON.stringify({ name: USER, displayName: 'Fixture User' }));
  if (req.url.startsWith('/rest/api/2/project')) return res.end(JSON.stringify([{ key: 'QA' }]));
  if (req.url.startsWith('/rest/api/2/field')) return res.end('[]');
  res.writeHead(404);
  return res.end('{}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const DC = { baseUrl, authMode: 'server-basic', email: USER, token: PASS };

// The transport's own 20 s timeout, shortened for this file only.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms === 20000 ? 300 : ms, ...a);

let passed = 0;
const failures = [];
async function test(name, fn) {
  seen.length = 0;
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
const failOf = (cfg) => testConnection(cfg).then(() => null, (e) => e);
const plain = (err) => {
  assert.ok(err, 'must not be reported as a working connection');
  assert.ok(!/SyntaxError|Unexpected token|<|\{|undefined/.test(err.message), `a plain sentence, got: ${err.message}`);
  assert.ok(!err.message.includes(PASS) && !err.message.includes(USER), 'and never a credential');
};

console.log('jira data center - username and password');

await test('the right pair signs in with Basic on /rest/api/2/myself', async () => {
  behaviour = 'ok';
  const r = await testConnection(DC);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'server-basic');
  assert.equal(seen[0].url, '/rest/api/2/myself', 'sign-in is proved by /myself first');
  assert.equal(seen[0].auth, good, 'UTF-8 Basic pair, so a non-Latin password works');
});

await test('a wrong password is one sentence about the username and password', async () => {
  behaviour = 'ok';
  const err = await failOf({ ...DC, token: 'fixture-wrong' });
  plain(err);
  assert.equal(err.status, 401);
  assert.match(err.message, /refused the username and password/);
});

await test('an HTML login page answering 200 is a sentence, not a parse error', async () => {
  behaviour = 'html';
  const err = await failOf(DC);
  plain(err);
  assert.match(err.message, /returned a login page: check the address and the sign-in type/);
});

await test('auto mode on a data center host sends Bearer once and never a password', async () => {
  behaviour = 'ok';
  const err = await failOf({ baseUrl, email: USER, token: 'fixture-pass', authMode: 'auto' });
  plain(err);
  assert.equal(err.status, 401);
  assert.equal(seen.length, 1, 'one request, no fallback');
  assert.match(seen[0].auth, /^Bearer /);
  assert.match(err.message, /if you sign in with a username and password, choose that under Sign-in/);
});

// Last: a hung socket can poison the client pool for whatever runs after it.
await test('a Jira that never answers names the site and the network', async () => {
  behaviour = 'hang';
  const err = await failOf(DC);
  plain(err);
  assert.match(err.message, /^Could not reach http:\/\/127\.0\.0\.1:\d+: no answer after 20 s, so check the site URL and your network\.$/);
});

globalThis.setTimeout = realSetTimeout;
server.closeAllConnections?.();
server.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
