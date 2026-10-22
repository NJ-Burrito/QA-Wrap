/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/**
 * T-011: the vault refuses to overwrite what it cannot read.
 *
 *   node tools/test-vault-unreadable.mjs
 *
 * The device key is deleted from IndexedDB (a reset or lost profile), then an
 * unrelated setting is saved: the vault blob must be byte-identical afterwards,
 * the settings must say the vault is unreadable, and a credential save must be
 * refused with a named code. A first-run save must still work.
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { installIdbStub } from './lib-idb-stub.mjs';

const sync = {}, local = {}, session = {};
const area = (bag) => ({
  get: async (key) => (key === null ? { ...bag } : { [key]: bag[key] }),
  set: async (obj) => { Object.assign(bag, obj); },
  remove: async (key) => delete bag[key],
});
globalThis.chrome = { storage: { sync: area(sync), local: area(local), session: area(session), managed: { get: async () => ({}) } } };
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32' }, configurable: true });
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const idb = installIdbStub();
const { getSettings, setSettings } = await import('../platform/settings.js');
const vault = await import('../platform/vault.js');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL  ${name}\n        ${e.message}`); }
}
const TOKEN = 'CANARY_tok_41d9';

await test('first-run save of a credential still works and reads back', async () => {
  await setSettings({ jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.c', token: TOKEN } });
  assert.equal((await getSettings()).jira.token, TOKEN);
  assert.ok(local.qw0, 'vault blob written');
});

const blob = JSON.stringify(local.qw0);

await test('after the device key is lost, an unrelated save leaves the vault byte-identical and says unreadable', async () => {
  idb.get('qw').get('k').clear();   // the profile lost its IndexedDB key
  vault.dropKeyCache();                  // ...and the worker restarted
  await setSettings({ retentionDays: 14 });
  assert.equal(JSON.stringify(local.qw0), blob, 'vault blob changed');
  const s = await getSettings();
  assert.equal(s.vaultUnreadable, true);
  assert.equal(s.retentionDays, 14, 'the unrelated setting must still save');
  assert.equal(idb.get('qw').get('k').size, 0, 'a device key was minted silently');
});

await test('a credential save is refused with a named code, and the blob is still untouched', async () => {
  await assert.rejects(setSettings({ slack: { webhookUrl: 'https://hooks.slack.com/services/T/B/x' } }), (e) => e.code === 'VAULT_UNREADABLE' && /nothing was overwritten/.test(e.message));
  assert.equal(JSON.stringify(local.qw0), blob);
});

await test('writeVault and setPass refuse directly', async () => {
  await assert.rejects(vault.writeVault({}), (e) => e.code === 'VAULT_UNREADABLE');
  await assert.rejects(vault.setPass('AAAA', 's', 1, 5), (e) => e.code === 'VAULT_UNREADABLE');
  assert.equal(JSON.stringify(local.qw0), blob);
});

await test('forgetting the unreadable vault is the way out: a fresh save then works', async () => {
  await vault.forgetVault();
  await setSettings({ jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.c', token: 'NEW_tok_77' } });
  const s = await getSettings();
  assert.ok(!s.vaultUnreadable);
  assert.equal(s.jira.token, 'NEW_tok_77');
});

await test('an unrelated save with a healthy vault does not rewrite it', async () => {
  const before = JSON.stringify(local.qw0);
  await setSettings({ retentionDays: 7 });
  assert.equal(JSON.stringify(local.qw0), before);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
