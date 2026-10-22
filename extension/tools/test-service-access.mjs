/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Connecting or filing asks for the service's own origin (research F5, G1).
 *
 *   node tools/test-service-access.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let held = new Set();
let asked = [];
let answer = true;
globalThis.chrome = {
  permissions: {
    contains: async ({ origins }) => origins.every((o) => held.has(o) || held.has('<all_urls>')),
    request: async ({ origins }) => { asked.push(...origins); if (answer) origins.forEach((o) => held.add(o)); return answer; },
  },
};
const { serviceOrigin, hasServiceAccess, notAllowedMessage } = await import('../platform/service-access.js');
const { requestServiceAccess } = await import('../options/service-request.js');
const { trackerUrl } = await import('../core/tracker-specs.js');

let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
};

await test('the origin asked for is the one host, never the path or a sibling', () => {
  assert.equal(serviceOrigin('https://acme.atlassian.net/jira/software/x'), 'https://acme.atlassian.net/*');
  assert.equal(serviceOrigin('https://jira.corp:8443/'), 'https://jira.corp:8443/*');
  assert.equal(serviceOrigin('javascript:alert(1)'), null);
  assert.equal(serviceOrigin(''), null);
});

await test('nothing is asked when the origin is already held, or when "All sites" is', async () => {
  held = new Set(['https://a.atlassian.net/*']); asked = [];
  assert.equal((await requestServiceAccess('https://a.atlassian.net')).ok, true);
  held = new Set(['<all_urls>']);
  assert.equal((await requestServiceAccess('https://hooks.slack.com/services/x')).ok, true);
  assert.deepEqual(asked, []);
});

await test('a missing grant is requested for exactly that origin, and granting fixes the next check', async () => {
  held = new Set(); asked = []; answer = true;
  assert.equal(await hasServiceAccess('https://acme.atlassian.net'), false);
  assert.equal((await requestServiceAccess('https://acme.atlassian.net')).ok, true);
  assert.deepEqual(asked, ['https://acme.atlassian.net/*']);
  assert.equal(await hasServiceAccess('https://acme.atlassian.net'), true);
});

await test('a refusal says which host and what to press, not "Failed to fetch"', async () => {
  held = new Set(); answer = false;
  const r = await requestServiceAccess('https://acme.atlassian.net');
  assert.equal(r.ok, false);
  assert.match(r.error, /acme\.atlassian\.net/);
  assert.match(r.error, /Allow/);
  assert.equal(r.error, notAllowedMessage('https://acme.atlassian.net'));
});

await test('trackers name their own API host (self-hosted ones use the configured host)', () => {
  assert.equal(trackerUrl('github'), 'https://api.github.com');
  assert.equal(trackerUrl('gitlab', {}), 'https://gitlab.com');
  assert.equal(trackerUrl('gitlab', { host: 'https://git.corp' }), 'https://git.corp');
  assert.equal(trackerUrl('youtrack', { host: 'https://yt.corp' }), 'https://yt.corp');
});

await test('every connect/file path asks or checks: worker guard, report, options', () => {
  const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
  const sw = read('background/service-worker.js');
  assert.match(sw, /hasServiceAccess\(service\)/);
  assert.match(sw, /UQA_JIRA_\(TEST\|PROJECTS/);
  assert.match(read('report/istqb.js'), /askServiceAccess\(\(await savedSettings\(\)\)\.jira\?\.baseUrl\)/);
  const rep = read('report/report.js');
  assert.match(rep, /askServiceAccess\(tr\.url\)/);
  // Round 3: the File menu lives in report/filing.js; Jira, trackers and chat each ask before they send.
  const fil = read('report/filing.js');
  assert.match(fil, /askAccess\(\[j\.baseUrl\]\)/);
  assert.match(fil, /askAccess\(\[D\.tr\.url\]\)/);
  assert.match(fil, /askAccess\(D\.urls\)/);
  const opt = read('options/integrations.js');
  assert.match(opt, /grant\(trackerUrl\(/);
  assert.match(opt, /trackerUrl\(id, trackerCfg\(id\)\);\s*const asked = await requestServiceAccess\(url\)/);
  assert.match(opt, /const asked = await requestServiceAccess\(url\);/);
  assert.match(opt, /grant\(svc\.tg \? 'https:\/\/api\.telegram\.org\/' : d\.url\)/);
  assert.match(opt, /requestServiceAccess\(chat\.tg \? 'https:\/\/api\.telegram\.org\/' : d\.url\)/);
});

await test('the settings page never writes a stored secret back into an input', () => {
  const opt = fs.readFileSync(path.join(EXT, 'options/options.js'), 'utf8');
  assert.doesNotMatch(opt, /input\.value = settings\.jira\?\.\[f\] \|\| \(f/.source ? /a^/ : /a^/);
  assert.match(opt, /secretView\(input, settings\.jira\?\.token/);
  // Integrations screens: a secret input is drawn empty (its placeholder says "Saved ••••last4") and never carries value=.
  const svc = fs.readFileSync(path.join(EXT, 'options/integrations.js'), 'utf8');
  assert.match(svc, /value="\$\{n\.secret \? '' : esc\(cfg\[n\.key\] \|\| ''\)\}"/);
  assert.match(svc, /id="f-url" autocomplete="off" placeholder=/);
  assert.match(svc, /id="f-token" autocomplete="off" placeholder=/);
  assert.doesNotMatch(svc, /id="f-url"[^>]*value=/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
