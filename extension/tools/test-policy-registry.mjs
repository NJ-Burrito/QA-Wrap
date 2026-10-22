/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-068: the policy registry, each key refusing or clamping at the seam and again at the last line.
 *
 *   node tools/test-policy-registry.mjs
 *
 * Behaviour runs against the real platform/policy.js, settings.js, whitebox.js and the options panel with a fake
 * `storage.managed`. The worker cannot be imported, so its seam and its last-line sites are asserted against the
 * source (as test-handlers.mjs does); a missing line fails by file name.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r) => fs.readFileSync(path.join(EXT, r), 'utf8');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

const bag = (o) => ({ get: async (k) => (typeof k === 'string' ? { [k]: o[k] } : { ...o }), set: async (x) => Object.assign(o, x), remove: async (k) => delete o[k] });
const sync = {};
const managed = {};
const calls = [];
globalThis.chrome = {
  storage: { sync: bag(sync), local: bag({}), managed: { get: async () => ({ ...managed }) } },
  debugger: { attach: () => calls.push('attach'), sendCommand() {}, detach() {}, onEvent: { addListener() {}, removeListener() {} } },
  runtime: {},
  permissions: { contains: async () => true },
};
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32' }, configurable: true });

const P = await import('../platform/policy.js');
const S = await import('../platform/settings.js');
const W = await import('../background/whitebox.js');
const setManaged = (o) => { for (const k of Object.keys(managed)) delete managed[k]; Object.assign(managed, o); };
const refuses = (fn, key) => assert.rejects(fn, (e) => e.code === 'POLICY_BLOCKED' && e.key === key && e.message.includes(key), `refusal must name ${key}`);

console.log('policy registry (T-068)');

await t('every key has a default that restricts nothing, and a typo restricts nothing', () => {
  const d = P.normalisePolicy({});
  assert.deepEqual(d, P.normalisePolicy(undefined));
  assert.deepEqual(Object.keys(d).sort(), Object.keys(P.POLICY_DEFAULTS).sort());
  const typo = P.normalisePolicy({ replayAllowed: 'no', integrationsAllowed: 0, debuggerToolsAllowed: null, redactionLocked: 'yes', retentionDaysMax: 'x', integrationHosts: 'jira.example.com', hostPermissionsPolicy: 'sometimes' });
  assert.deepEqual(typo, d);
  assert.equal(P.normalisePolicy({ retentionDaysMax: -5 }).retentionDaysMax, 0);
  assert.equal(P.normalisePolicy({ retentionDaysMax: 7.5 }).retentionDaysMax, 0);
  assert.deepEqual(P.allows(P.normalisePolicy({ replayAllowed: false }), 'replay'), { code: 'POLICY', key: 'replayAllowed' });
  assert.equal(P.allows(d, 'replay'), null);
});

await t('replayAllowed:false refuses at the seam and names its key', async () => {
  assert.equal(P.featureOf('UQA_REPLAY_GET'), 'replay');
  assert.equal(P.featureOf('UQA_OPEN_REPLAY'), 'replay');
  setManaged({ replayAllowed: false });
  await refuses(() => S.assertPolicy('replay'), 'replayAllowed');
  setManaged({});
  await S.assertPolicy('replay');
});

await t('integrationsAllowed:false refuses every filing message; a host list matches the host and its subdomains only', async () => {
  for (const type of ['UQA_JIRA_FILE', 'UQA_TRACKER_FILE', 'UQA_NOTIFY', 'UQA_NOTIFY_TEST', 'UQA_JIRA_SYNC']) assert.equal(P.featureOf(type), 'integrations', type);
  assert.equal(P.featureOf('UQA_EXPORT'), null, 'saving to disk is never an integration');
  setManaged({ integrationsAllowed: false });
  await refuses(() => S.assertPolicy('integrations', 'https://jira.example.com'), 'integrationsAllowed');
  setManaged({ integrationHosts: ['Jira.Example.com'] });
  await S.assertPolicy('integrations', 'https://jira.example.com/rest');
  await S.assertPolicy('integrations', 'https://eu.jira.example.com');
  await refuses(() => S.assertPolicy('integrations', 'https://evil-jira.example.com'), 'integrationHosts');
  await refuses(() => S.assertPolicy('integrations', 'https://example.org'), 'integrationHosts');
  await refuses(() => S.assertPolicy('integrations', 'not a url'), 'integrationHosts');
  setManaged({});
  await S.assertPolicy('integrations', 'https://anything.example');
});

await t('debuggerToolsAllowed:false refuses at the seam and at the attach; nothing attaches', async () => {
  assert.equal(P.featureOf('UQA_COVERAGE_START'), 'debugger');
  assert.equal(P.featureOf('UQA_COVERAGE_REQUEST'), 'debugger');
  setManaged({ debuggerToolsAllowed: false });
  await refuses(() => S.assertPolicy('debugger'), 'debuggerToolsAllowed');
  chrome.tabs = { get: async () => ({ id: 1, url: 'https://example.com/' }), reload() {} };
  calls.length = 0;
  await assert.rejects(() => W.startCoverage(1, { reload: false }), (e) => e.code === 'POLICY_BLOCKED' && e.key === 'debuggerToolsAllowed');
  assert.deepEqual(calls, [], 'chrome.debugger.attach was never called');
  setManaged({});
});

await t('retentionDaysMax clamps what getSettings returns: longer, and keep-for-ever, become the ceiling; shorter stays', async () => {
  setManaged({ retentionDaysMax: 14 });
  for (const [saved, want] of [[365, 14], [0, 14], [7, 7], [14, 14]]) {
    sync.settings = { retentionDays: saved };
    assert.equal((await S.getSettings()).retentionDays, want, `saved ${saved}`);
  }
  setManaged({});
  sync.settings = { retentionDays: 0 };
  assert.equal((await S.getSettings()).retentionDays, 0, 'no ceiling, no change; an upgraded profile still keeps everything');
  delete sync.settings;
});

await t('redactionLocked overrides a synced redact:false and keeps both optional families on', async () => {
  sync.settings = { redact: false, redactExtra: [] };
  assert.equal((await S.getSettings()).redact, false, 'unmanaged: the tester decides');
  setManaged({ redactionLocked: true });
  const s = await S.getSettings();
  assert.equal(s.redact, true);
  assert.deepEqual([...s.redactExtra].sort(), ['email', 'nationalId']);
  assert.equal(s.policy.redactionLocked, true);
  setManaged({});
  delete sync.settings;
});

await t('the worker seam and every last line are in the source', () => {
  const sw = workerSrc();
  assert.match(sw, /featureOf\(type\)[\s\S]{0,120}assertPolicy\(feature, service\)/, 'guardSender asks the registry');
  assert.match(sw, /replayAllowed === false\) return \{ recording: false/, 'the replay write door stops the recorder');
  assert.match(read('background/media.js'), /export async function trackerOp[\s\S]{0,260}assertPolicy\('integrations', trackerUrl\(tracker, cfg\)\)/, 'the offscreen door, with the host');
  assert.match(read('background/media.js'), /export async function jiraOp[\s\S]{0,160}assertPolicy\('integrations', \(await getSettings\(\)\)\.jira\?\.baseUrl\)/, 'the Jira door, with the host');
  // T-068 fault 4: the popup and the report disable what the organisation took away
  assert.match(read('popup/popup.js'), /debuggerToolsAllowed === false\) for \(const b of document\.querySelectorAll\('\.tool-row\[data-tool="whitebox"\] button'\)\) \{ b\.disabled = true/);
  const rep = read('report/report.js');
  assert.match(rep, /managed\(btn, 'replayAllowed'\)/);
  assert.match(rep, /managed\(\$\(id\), 'integrationsAllowed'\)/);
  assert.match(read('background/notify.js'), /assertPolicy\('integrations', url\)/);
  assert.match(read('background/whitebox.js'), /assertPolicy\('debugger'\)/);
});

await t('the options panel lists every key, says default | managed | not reachable, and replaces the blocked controls', async () => {
  const { policyRows, managedStatus } = await import('../options/policy-panel.js');
  const rows = policyRows(P.normalisePolicy({ retentionDaysMax: 30, replayAllowed: false }), (k) => k);
  assert.equal(rows.length, Object.keys(P.POLICY_DEFAULTS).length);
  assert.deepEqual(rows.filter((r) => r.set).map((r) => r.key).sort(), ['replayAllowed', 'retentionDaysMax']);
  assert.equal(await managedStatus(async () => ({})), 'default');
  assert.equal(await managedStatus(async () => ({ replayAllowed: false })), 'managed');
  assert.equal(await managedStatus(async () => { throw new Error('no manifest'); }), 'unreachable');
  assert.equal(await managedStatus(() => new Promise(() => {}), 20), 'unreachable', 'a read that never answers');
  assert.match(read('options/options.html'), /id="policy-list"/);
  assert.match(read('options/options.html'), /id="policy-status"/);
  assert.match(read('options/options.js'), /paintPolicy\(document, \{ \.\.\.DEFAULTS_POLICY, \.\.\.settings\.policy \}/);
});

console.log(`\n${n} passed, 0 failed`);
