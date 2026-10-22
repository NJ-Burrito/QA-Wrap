/* T-071: organisation consent mode. The real install hook, run against stubs: no tab in organisation mode, a tab otherwise; acceptance is never pre-recorded. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalisePolicy, POLICY_DEFAULTS } from '../platform/policy.js';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(EXT, ...p), 'utf8');
const worker = workerSrc();
let n = 0;
const test = async (name, fn) => { n++; await fn(); console.log(`  ok  ${name}`); };

const at = worker.indexOf("'runtime.onInstalled › the welcome page', ") + "'runtime.onInstalled › the welcome page', ".length;
const hookSrc = worker.slice(at, worker.indexOf('\n});', at) + 3);
const run = async (managed, { reason = 'install', consentedAt = null, unreadable = false } = {}) => {
  const opened = [];
  const hook = new Function('chrome', 'policy', 'openOwnPage', `return (${hookSrc.replace(/\);?\s*$/, '')})`)(
    { storage: { local: { get: async () => ({ consentedAt }) }, managed: { get: async () => { if (unreadable) throw new Error('managed storage not ready'); return {}; } } } },
    async () => normalisePolicy(managed),
    async (page) => { opened.push(page); },
  );
  await hook({ reason });
  return opened;
};
const ORG = { consentMode: 'organisation', consentUrl: 'https://intranet.example.com/qa-wrap-notice' };

await test('user mode (the default): the welcome tab opens on install', async () => {
  assert.deepEqual(await run({}), ['welcome/welcome.html']);
});
await test('organisation mode: no tab on install', async () => {
  assert.deepEqual(await run(ORG), []);
});
await test('organisation mode without an https link falls back to the welcome tab', async () => {
  assert.deepEqual(await run({ consentMode: 'organisation' }), ['welcome/welcome.html']);
  assert.deepEqual(await run({ consentMode: 'organisation', consentUrl: 'http://x.example.com' }), ['welcome/welcome.html']);
  assert.deepEqual(await run({ consentMode: 'organisation', consentUrl: 'javascript:alert(1)' }), ['welcome/welcome.html']);
});
await test('managed storage unreadable at install: no tab (the popup card is the gate), never the welcome tab that organisation mode forbids (T-071 fault 12)', async () => {
  assert.deepEqual(await run({}, { unreadable: true }), []);
  assert.match(worker, /unreadable twice: no tab/);
});
await test('the organisation wording is bound to its i18n key, so a language switch keeps it (T-071 fault 12)', () => {
  assert.match(read('popup', 'popup.js'), /body\.dataset\.i18n = 'popup\.consent\.orgBody'/);
});
await test('an update never opens a tab either way', async () => {
  assert.deepEqual(await run({}, { reason: 'update' }), []);
});
await test('the policy keeps the https link only in organisation mode, and defaults are user / empty', () => {
  assert.equal(POLICY_DEFAULTS.consentMode, 'user');
  assert.equal(normalisePolicy(ORG).consentUrl, ORG.consentUrl);
  assert.equal(normalisePolicy({ consentMode: 'weird', consentUrl: ORG.consentUrl }).consentMode, 'user');
});
await test('the first step is the same and acceptance is never pre-recorded', () => {
  assert.doesNotMatch(worker, /consentPreAccepted/);
  const consent = worker.slice(worker.indexOf('UQA_CONSENT: async'), worker.indexOf('UQA_CONSENT_ACCEPT'));
  assert.match(consent, /consented: !!consentedAt && \(await armed\.consentCurrent\(\)\)/);
  assert.match(consent, /consentUrl: p\.consentMode === 'organisation'/);
});
await test('the popup card links the notice from the worker answer, https only, with the same button', () => {
  const html = read('popup', 'popup.html');
  assert.match(html, /id="consent-org"[^>]*rel="noopener noreferrer"/);
  assert.match(html, /id="consent-open"/);
  const js = read('popup', 'popup.js');
  assert.match(js, /paintOrgNotice\(gotConsent\?\.ok \? gotConsent\.result\.consentUrl : ''\)/);
  assert.match(js, /\^https:/);
});
await test('schema, ADMIN.md and both catalogues carry the keys', () => {
  const schema = JSON.parse(read('managed-schema.json'));
  assert.deepEqual(schema.properties.consentMode.enum, ['user', 'organisation']);
  assert.equal(schema.properties.consentUrl.type, 'string');
  const admin = read('ADMIN.md');
  assert.ok(admin.includes('`consentMode`') && admin.includes('`consentUrl`'));
  for (const lang of ['en', 'ar']) {
    const c = JSON.parse(read('platform', 'i18n', `${lang}.json`));
    for (const k of ['popup.consent.orgBody', 'popup.consent.orgNotice', 'options.policy.k.consentMode', 'options.policy.k.consentUrl']) assert.ok(c[k], `${lang} ${k}`);
  }
});
console.log(`${n} passed, 0 failed`);
