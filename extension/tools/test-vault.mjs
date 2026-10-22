/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The token vault (platform/vault.js + the secret handling in platform/settings.js).
 *
 *   node tools/test-vault.mjs
 *
 * Canary strings only. Asserts what an attacker reading the disk would find: after a
 * token is saved, no dump of storage.local, storage.sync or IndexedDB holds it in any of
 * plaintext, base64, hex or URL-encoded form; migration from the old plaintext record is
 * idempotent and cannot lose a token; the passphrase lock refuses, opens, expires and
 * removes; pages get "••••last4" and never the value; exports carry no canary.
 * The real-browser half (profile directory grep, mock Jira) is tools/test-vault-live.mjs.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { installIdbStub } from './lib-idb-stub.mjs';

const sync = {}, local = {}, session = {};
const area = (bag) => ({
  get: async (key) => (key === null ? { ...bag } : { [key]: bag[key] }),
  set: async (obj) => { if (area.failOn && area.failOn in obj && bag === local) throw new Error('disk full'); Object.assign(bag, obj); },
  remove: async (key) => delete bag[key],
});
globalThis.chrome = { storage: { sync: area(sync), local: area(local), session: area(session), managed: { get: async () => ({}) } } };
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32' }, configurable: true });
const idb = installIdbStub();

const { getSettings, setSettings, resetSettings, publicSettings, redact, unmask } = await import('../platform/settings.js');
const vault = await import('../platform/vault.js');
const { exportWorkspace } = await import('../core/workspace.js');

const JIRA = 'CANARY/jira+TOKEN=7f3a91xq';
const GH = 'CANARY_gh_TOKEN_5c2e08zz';
const HOOK = 'https://hooks.slack.com/services/T0/B0/CANARY-HOOK-9d41ab7e';
const DEST = 'https://discord.com/api/webhooks/123/CANARY-DEST-3b7c60aa';
const CANARIES = [JIRA, GH, HOOK, DEST];

/** Every way a scanner might match a canary in a dump. */
function variants(c) {
  const out = new Set([c, encodeURIComponent(c), Buffer.from(c).toString('hex'), Buffer.from(c).toString('hex').toUpperCase()]);
  for (let pad = 0; pad < 3; pad++) {
    const b = Buffer.from('x'.repeat(pad) + c).toString('base64');
    out.add(b.slice(4, -4));
    out.add(b.slice(4, -4).replace(/\+/g, '-').replace(/\//g, '_'));
  }
  return [...out].filter((v) => v.length >= 8);
}
const leaks = (dump) => CANARIES.flatMap(variants).filter((v) => dump.includes(v));
const dumpAll = () => JSON.stringify({ sync, local, idb: [...idb].map(([n, m]) => [n, [...m].map(([s, r]) => [s, [...r.keys()], [...r.values()].map((v) => Object.prototype.toString.call(v) + (v?.extractable ?? ''))])]) });

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

// What the options page does with the passphrase: PBKDF2-SHA256, 600000 rounds, 256 bits, base64.
async function derive(pass, salt, iters = 600000) {
  const km = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  return Buffer.from(await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, km, 256)).toString('base64');
}

const SECRETS = () => ({
  jira: { baseUrl: 'https://real.atlassian.net', email: 'a@b.c', token: JIRA },
  slack: { webhookUrl: HOOK },
  trackers: { github: { token: GH, repo: 'a/b' } },
  webhooks: [{ id: 'd1', provider: 'discord', url: DEST, label: 'chan' }],
});

await test('the scanner itself catches every encoding (so an empty result means something)', () => {
  for (const c of CANARIES) for (const v of variants(c)) assert.ok(leaks(`junk${v}junk`).length, `blind to ${v}`);
  assert.ok(leaks(Buffer.from('zz' + JIRA).toString('base64')).length, 'blind to a shifted base64');
});

console.log('\nvault — migration from the old plaintext record');
await test('plaintext in storage.local and in the synced record is encrypted on first read, tokens intact', async () => {
  local.secrets = SECRETS();
  sync.settings = { soundEnabled: true, jira: { token: 'STALE-SYNCED-TOKEN' }, slack: { webhookUrl: 'https://old.example/x' } };
  const s = await getSettings();
  assert.equal(s.jira.token, JIRA);
  assert.equal(s.slack.webhookUrl, HOOK);
  assert.equal(s.trackers.github.token, GH);
  assert.equal(s.webhooks[0].url, DEST);
  assert.ok(!('secrets' in local), 'plaintext record still in storage.local');
  assert.ok(local.qw0?.ct && local.qw0?.iv, 'no ciphertext record');
  assert.equal(JSON.stringify(sync).includes('STALE-SYNCED-TOKEN'), false, 'synced record still carries a credential');
});
await test('after migration a raw dump of local, sync and IndexedDB holds no canary in any encoding', () => {
  const found = leaks(dumpAll());
  assert.deepEqual(found, [], `found: ${found.join(' | ')}`);
});
await test('the device key is non-extractable and never in storage', () => {
  const dump = dumpAll();
  assert.ok(dump.includes('CryptoKey'), 'no key in IndexedDB');
  const key = [...idb.get('qw').get('k').values()][0];
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, 'AES-GCM');
  assert.equal(key.algorithm.length, 256);
});
await test('a second read changes nothing (idempotent) and the ciphertext is stable', async () => {
  const before = JSON.stringify(local.qw0);
  const s = await getSettings();
  assert.equal(s.jira.token, JIRA);
  assert.equal(JSON.stringify(local.qw0), before);
});
await test('every write uses a fresh IV', async () => {
  const a = local.qw0.iv;
  await setSettings({ jira: { project: 'QA' } });
  const b = local.qw0.iv;
  await setSettings({ jira: { project: 'QB' } });
  assert.notEqual(a, b);
  assert.notEqual(b, local.qw0.iv);
  assert.equal((await getSettings()).jira.token, JIRA, 'a non-secret patch lost the token');
});
await test('a migration that cannot write never loses the token', async () => {
  await resetSettings();
  local.secrets = SECRETS();
  area.failOn = 'qw0';
  const s = await getSettings();
  assert.equal(s.jira.token, JIRA, 'token missing while the vault is unwritable');
  assert.ok(local.secrets, 'plaintext removed although the vault write failed');
  area.failOn = null;
  await getSettings();
  assert.ok(!('secrets' in local) && local.qw0, 'migration did not complete on the next read');
  assert.equal((await getSettings()).jira.token, JIRA);
});

console.log('\nvault — after connecting through the settings path');
await test('saving a token leaves nothing recoverable on disk', async () => {
  await resetSettings();
  await setSettings({ jira: { baseUrl: 'https://real.atlassian.net', token: JIRA }, slack: { webhookUrl: HOOK }, trackers: { github: { token: GH } }, webhooks: [{ id: 'd1', url: DEST }] });
  assert.deepEqual(leaks(dumpAll()), []);
  assert.equal((await getSettings()).jira.token, JIRA);
});
await test('forgetting a token removes it from the vault', async () => {
  await setSettings({ jira: { token: '' } });
  assert.equal((await getSettings()).jira.token, '');
  await setSettings({ jira: { token: JIRA } });
});

console.log('\nvault — what pages and exports see');
await test('extension pages get "••••last4", the webhook keeps only its origin', async () => {
  const r = redact(await getSettings());
  assert.equal(r.jira.token, '••••' + JIRA.slice(-4));
  assert.equal(r.trackers.github.token, '••••' + GH.slice(-4));
  assert.equal(r.slack.webhookUrl, 'https://hooks.slack.com/••••' + HOOK.slice(-4));
  assert.equal(r.webhooks[0].url, 'https://discord.com/••••' + DEST.slice(-4));
  assert.deepEqual(CANARIES.flatMap(variants).filter((v) => JSON.stringify(r).includes(v)), []);
  assert.equal(r.jira.baseUrl, 'https://real.atlassian.net');
});
await test('a masked value sent back means "unchanged"; a typed one replaces it', async () => {
  const page = redact(await getSettings());
  await setSettings({ jira: page.jira, slack: page.slack, trackers: page.trackers, webhooks: page.webhooks });
  const s = await getSettings();
  assert.equal(s.jira.token, JIRA);
  assert.equal(s.slack.webhookUrl, HOOK);
  assert.equal(s.trackers.github.token, GH);
  assert.equal(s.webhooks[0].url, DEST);
  await setSettings({ jira: { token: 'NEW-TYPED-TOKEN-1234' } });
  assert.equal((await getSettings()).jira.token, 'NEW-TYPED-TOKEN-1234');
  await setSettings({ jira: { token: JIRA } });
  assert.equal(unmask({ jira: { token: '••••ab' } }, { jira: { token: 'real' } }).jira.token, 'real');
});
await test('content scripts get nothing: publicSettings has no secret field and no lock flag', async () => {
  const p = publicSettings(await getSettings());
  for (const k of ['jira', 'slack', 'trackers', 'webhooks', 'vaultLocked']) assert.ok(!(k in p), k);
  assert.deepEqual(leaks(JSON.stringify(p)), []);
});
await test('a workspace export carries no canary', async () => {
  const out = JSON.stringify(exportWorkspace({ name: 'team', settings: await getSettings() }));
  assert.deepEqual(leaks(out), []);
});

console.log('\nvault — the optional passphrase lock');
const salt = webcrypto.getRandomValues(new Uint8Array(16));
const saltB64 = Buffer.from(salt).toString('base64');
const ITERS = 600000;
await test('setting a passphrase re-encrypts under it; disk still holds no canary', async () => {
  await vault.setPass(await derive('correct horse', salt), saltB64, ITERS, 30);
  assert.equal(local.qw0.m, 'p');
  assert.equal(local.qw0.i, ITERS);
  assert.ok(ITERS >= 600000);
  assert.deepEqual(leaks(dumpAll()), []);
  assert.deepEqual(leaks(JSON.stringify(session)), [], 'the session area must hold only a key, never a token');
  assert.equal((await getSettings()).jira.token, JIRA, 'unlocked after setting');
});
await test('locking hides every secret; filing-relevant reads see vaultLocked', async () => {
  await vault.lockVault();
  const s = await getSettings();
  assert.equal(s.vaultLocked, true);
  assert.ok(!s.jira.token && !s.slack.webhookUrl && !s.webhooks?.length);
  assert.deepEqual(await vault.vaultState(), { pass: true, locked: true, salt: saltB64, iters: ITERS, idle: 30 });
});
await test('while locked, a secret write is refused and a plain one leaves the vault intact', async () => {
  const ct = local.qw0.ct;
  await assert.rejects(() => setSettings({ jira: { token: 'OVERWRITE' } }), /Unlock QA Wrap/);
  await assert.rejects(() => setSettings({ webhooks: [] }), /Unlock QA Wrap/);
  await setSettings({ soundEnabled: true });
  assert.equal(local.qw0.ct, ct, 'vault changed while locked');
  assert.equal(vault.LOCKED, 'Unlock QA Wrap to file');
});
await test('the wrong passphrase is refused and stays locked', async () => {
  await assert.rejects(async () => vault.unlockVault(await derive('wrong horse', salt)), /Wrong passphrase/);
  assert.equal((await getSettings()).vaultLocked, true);
});
await test('the right passphrase unlocks; tokens are back', async () => {
  await vault.unlockVault(await derive('correct horse', salt));
  const s = await getSettings();
  assert.ok(!s.vaultLocked);
  assert.equal(s.jira.token, JIRA);
  assert.equal(s.trackers.github.token, GH);
});
await test('it re-locks after the idle period, and after a browser restart (session cleared)', async () => {
  session.qwk = { ...session.qwk, t: Date.now() - 31 * 60000 };
  assert.equal((await getSettings()).vaultLocked, true, 'still open after 31 idle minutes');
  assert.ok(!session.qwk, 'the expired key stayed in the session area');
  await vault.unlockVault(await derive('correct horse', salt));
  delete session.qwk; // what a restart does to storage.session
  assert.equal((await getSettings()).vaultLocked, true);
  await vault.unlockVault(await derive('correct horse', salt));
});
await test('the idle setting is honoured', async () => {
  await vault.setPass(await derive('correct horse', salt), saltB64, ITERS, 5);
  session.qwk = { ...session.qwk, t: Date.now() - 6 * 60000 };
  assert.equal((await getSettings()).vaultLocked, true);
  await vault.unlockVault(await derive('correct horse', salt));
});
await test('changing the passphrase works while unlocked and the old one stops working', async () => {
  const salt2 = webcrypto.getRandomValues(new Uint8Array(16));
  await vault.setPass(await derive('second phrase', salt2), Buffer.from(salt2).toString('base64'), ITERS, 30);
  await vault.lockVault();
  await assert.rejects(async () => vault.unlockVault(await derive('correct horse', salt)), /Wrong passphrase/);
  await vault.unlockVault(await derive('second phrase', salt2));
  assert.equal((await getSettings()).jira.token, JIRA);
});
await test('removing the passphrase returns to the device key, tokens kept', async () => {
  await vault.setPass(null);
  assert.ok(!local.qw0.m);
  assert.equal((await vault.vaultState()).pass, false);
  delete session.qwk;
  assert.equal((await getSettings()).jira.token, JIRA);
  assert.deepEqual(leaks(dumpAll()), []);
});
await test('D-1010-56: setPass refuses weak parameters with a coded error and writes nothing; an old low-iteration record opens but asks for a new passphrase', async () => {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const sb = Buffer.from(salt).toString('base64');
  const key = await derive('floor test', salt);
  const before = JSON.stringify(local.qw0 ?? null);
  const bad = [
    [key, sb, 1000, 30, 'iters'], [key, sb, 599999, 30, 'iters'], [key, sb, 600000.5, 30, 'iters'], [key, sb, '600000', 30, 'iters'],
    [key, Buffer.from(salt.slice(0, 8)).toString('base64'), ITERS, 30, 'salt'], [key, undefined, ITERS, 30, 'salt'],
    [Buffer.alloc(16).toString('base64'), sb, ITERS, 30, 'key'], ['not base64 !!', sb, ITERS, 30, 'key'],
    [key, sb, ITERS, 0, 'idle'], [key, sb, ITERS, 241, 'idle'], [key, sb, ITERS, 1.5, 'idle'],
  ];
  for (const [k, s, i, idle, field] of bad) {
    await assert.rejects(() => vault.setPass(k, s, i, idle), (e) => e.code === 'VAULT_PASS_INVALID' && e.field === field, `${field} ${i} ${idle}`);
  }
  assert.equal(JSON.stringify(local.qw0 ?? null), before, 'a refused call writes nothing');
  await vault.setPass(key, sb, ITERS, 240); // the edges pass
  await vault.setPass(key, sb, ITERS, 1);
  // an older record below the floor: unlock verifies the key, opens the vault, then asks for a new passphrase
  local.qw0 = { ...local.qw0, i: 1000 };
  await vault.lockVault();
  await assert.rejects(() => vault.unlockVault(key), (e) => e.code === 'VAULT_REKEY');
  assert.equal((await vault.vaultState()).locked, false, 'the key was right, so the vault is open for setPass');
  await vault.setPass(null);
});

await test('"forgot passphrase" forgets every token and leaves an unlocked, empty vault', async () => {
  const salt3 = webcrypto.getRandomValues(new Uint8Array(16));
  await vault.setPass(await derive('to be forgotten', salt3), Buffer.from(salt3).toString('base64'), ITERS, 30);
  await vault.lockVault();
  await vault.forgetVault();
  const s = await getSettings();
  assert.ok(!s.vaultLocked);
  assert.ok(!s.jira.token && !s.slack.webhookUrl);
  assert.ok(!local.qw0, 'record survived');
  await setSettings({ jira: { token: 'FRESH-AFTER-FORGET-1' } });
  assert.equal((await getSettings()).jira.token, 'FRESH-AFTER-FORGET-1');
});
await test('reset settings forgets the vault too', async () => {
  await resetSettings();
  assert.ok(!local.qw0 && !local.secrets);
  assert.deepEqual(leaks(dumpAll()), []);
});

console.log('\nvault — sealed blobs: cookie profiles and API variables (r4-02-2, D-1010-71)');
const PROFILES = { admin: { url: 'https://app.test/', savedAt: 1, cookies: [{ name: 'sid', value: 'CANARY-COOKIE-VALUE-4e9a1c' }] } };
const ENVS = { active: 'Default', list: { Default: { apiToken: 'CANARY-ENV-TOKEN-8b3d02' } } };
const COOKIE_CANARIES = ['CANARY-COOKIE-VALUE-4e9a1c', 'CANARY-ENV-TOKEN-8b3d02'];
const sealedLeaks = () => COOKIE_CANARIES.flatMap(variants).filter((v) => JSON.stringify(local).includes(v));
await test('a saved profile and a saved environment are ciphertext on disk and read back whole', async () => {
  await resetSettings();
  await vault.saveSealed('cookieProfiles', PROFILES);
  await vault.saveSealed('apiEnvironments', ENVS);
  assert.equal(local.cookieProfiles.qws, 1);
  assert.deepEqual(sealedLeaks(), [], 'a cookie value or pasted token is on disk in the clear');
  assert.deepEqual(await vault.loadSealed('cookieProfiles'), PROFILES);
  assert.deepEqual(await vault.loadSealed('apiEnvironments'), ENVS);
  assert.equal(await vault.loadSealed('nothingHere'), undefined);
});
await test('plaintext from an older build is sealed on first read, and kept if the vault write fails', async () => {
  local.cookieProfiles = structuredClone(PROFILES);
  area.failOn = 'cookieProfiles';
  try { assert.deepEqual(await vault.loadSealed('cookieProfiles'), PROFILES, 'the profiles still show'); } finally { area.failOn = null; }
  assert.deepEqual(local.cookieProfiles, PROFILES, 'the plaintext stays when the vault write fails');
  assert.deepEqual(await vault.loadSealed('cookieProfiles'), PROFILES);
  assert.equal(local.cookieProfiles.qws, 1, 'sealed on the next read');
  assert.deepEqual(sealedLeaks(), []);
});
await test('a failed save keeps the old copy; a blob this profile cannot open is never overwritten', async () => {
  area.failOn = 'apiEnvironments';
  try { await assert.rejects(() => vault.saveSealed('apiEnvironments', { active: 'X', list: { X: {} } }), /disk full/); } finally { area.failOn = null; }
  assert.deepEqual(await vault.loadSealed('apiEnvironments'), ENVS);
  const keep = structuredClone(local.apiEnvironments);
  local.apiEnvironments = { ...keep, ct: keep.ct.slice(0, -8) + 'AAAAAAAA' };
  await assert.rejects(() => vault.loadSealed('apiEnvironments'), (e) => e.code === 'VAULT_UNREADABLE');
  await assert.rejects(() => vault.saveSealed('apiEnvironments', ENVS), (e) => e.code === 'VAULT_UNREADABLE');
  local.apiEnvironments = keep;
});
await test('a locked vault says the existing locked sentence with its code, for read and write; unlocking brings the blobs back; a passphrase change re-seals them', async () => {
  const saltS = webcrypto.getRandomValues(new Uint8Array(16));
  const saltSB = Buffer.from(saltS).toString('base64');
  await vault.setPass(await derive('seal phrase', saltS), saltSB, ITERS, 30);
  assert.deepEqual(await vault.loadSealed('cookieProfiles'), PROFILES, 're-sealed under the passphrase key');
  await vault.lockVault();
  for (const call of [() => vault.loadSealed('cookieProfiles'), () => vault.saveSealed('cookieProfiles', PROFILES)]) {
    await assert.rejects(call, (e) => e.code === 'VAULT_LOCKED' && e.message === vault.LOCKED);
  }
  await vault.unlockVault(await derive('seal phrase', saltS));
  assert.deepEqual(await vault.loadSealed('apiEnvironments'), ENVS);
  const saltT = webcrypto.getRandomValues(new Uint8Array(16));
  await vault.setPass(await derive('other phrase', saltT), Buffer.from(saltT).toString('base64'), ITERS, 30);
  assert.deepEqual(await vault.loadSealed('cookieProfiles'), PROFILES, 'changed passphrase');
  await vault.setPass(null);
  delete session.qwk;
  assert.deepEqual(await vault.loadSealed('cookieProfiles'), PROFILES, 'passphrase removed: device key again');
  assert.deepEqual(sealedLeaks(), []);
});
await test('Erase all removes the sealed copies by key, with no unlock', async () => {
  const { eraseLocalKeys } = await import('../core/store-registry.js');
  assert.ok(eraseLocalKeys().includes('cookieProfiles') && eraseLocalKeys().includes('apiEnvironments'));
  await vault.setPass(await derive('seal phrase', salt), saltB64, ITERS, 30);
  await vault.lockVault();
  for (const k of eraseLocalKeys()) await chrome.storage.local.remove(k); // the stub takes one key at a time
  assert.ok(!local.cookieProfiles && !local.apiEnvironments);
  await resetSettings();
});

await test('cookie profiles: save, list, restore and delete go through the sealed blob; a locked vault refuses with the locked sentence', async () => {
  const jar = [{ name: 'sid', value: 'CANARY-COOKIE-VALUE-4e9a1c', domain: 'app.test', path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true, storeId: '0' }];
  const setCalls = [];
  chrome.cookies = { getAll: async () => jar, set: async (c) => { setCalls.push(c); return c; }, remove: async () => ({}) };
  try {
    await resetSettings();
    const ed = await import('../background/storage-editor.js');
    assert.deepEqual(await ed.listCookieProfiles(), []);
    assert.deepEqual(await ed.saveCookieProfile({ url: 'https://app.test/', name: ' admin ' }), { name: 'admin', count: 1 });
    assert.equal(local.cookieProfiles.qws, 1, 'sealed on disk');
    assert.deepEqual(sealedLeaks(), []);
    const list = await ed.listCookieProfiles();
    assert.equal(list.length, 1); assert.equal(list[0].name, 'admin'); assert.deepEqual(list[0].names, ['sid']);
    const back = await ed.restoreCookieProfile({ url: 'https://app.test/', name: 'admin', clearFirst: false });
    assert.equal(back.applied, 1); assert.equal(setCalls[0].value, 'CANARY-COOKIE-VALUE-4e9a1c');
    // an older build's plaintext map is listed, and sealed on that read
    local.cookieProfiles = { old: { url: 'https://x.test/', savedAt: 1, cookies: [{ name: 'a', value: 'CANARY-COOKIE-VALUE-4e9a1c' }] } };
    assert.equal((await ed.listCookieProfiles())[0].name, 'old');
    assert.equal(local.cookieProfiles.qws, 1);
    await ed.deleteCookieProfile({ name: 'old' });
    assert.deepEqual(await ed.listCookieProfiles(), []);
    // a locked vault: the existing sentence, nothing written
    const saltP = webcrypto.getRandomValues(new Uint8Array(16));
    await vault.setPass(await derive('profile phrase', saltP), Buffer.from(saltP).toString('base64'), ITERS, 30);
    await vault.lockVault();
    const before = JSON.stringify(local.cookieProfiles);
    await assert.rejects(() => ed.saveCookieProfile({ url: 'https://app.test/', name: 'user' }), (e) => e.code === 'VAULT_LOCKED' && e.message === vault.LOCKED);
    await assert.rejects(() => ed.listCookieProfiles(), (e) => e.message === vault.LOCKED);
    assert.equal(JSON.stringify(local.cookieProfiles), before, 'nothing was written while locked');
  } finally { delete chrome.cookies; await resetSettings(); }
});

await test('r8-13-1: a 400 KB blob seals and opens (the encoder is not one spread), and survives a passphrase set and removal', async () => {
  const big = { rows: Array.from({ length: 20000 }, (_, i) => `row-${i}-${'x'.repeat(10)}`), tail: 'é'.repeat(1000) };
  assert.ok(JSON.stringify(big).length > 400 * 1024);
  delete local.cookieProfiles; // a clean slate: an earlier case left a copy under another key
  await vault.saveSealed('cookieProfiles', big);
  assert.ok(local.cookieProfiles.ct.length > 400 * 1024, 'the ciphertext is as large as the value');
  assert.deepEqual(await vault.loadSealed('cookieProfiles'), big, 'device key: opens whole');
  await vault.setPass(await derive('big phrase', salt), saltB64, ITERS, 30);
  assert.deepEqual(await vault.loadSealed('cookieProfiles'), big, 'change passphrase: re-sealed whole');
  await vault.setPass(null);
  assert.deepEqual(await vault.loadSealed('cookieProfiles'), big, 'back to the device key: opens whole');
  delete local.cookieProfiles;
  await resetSettings();
});

await test('D-208 / r9-02-4: a cookie profile restores only on its own origin (a legacy profile with no url still restores), and __proto__, constructor and prototype are refused as names', async () => {
  const jar = [{ name: 'sid', value: 'v', domain: 'a.test', path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true, storeId: '0' }];
  const sets = [];
  globalThis.chrome.cookies = { getAll: async () => jar, set: async (c) => { sets.push(c); return c; }, remove: async () => ({}) };
  const ed = await import('../background/storage-editor.js');
  await ed.saveCookieProfile({ url: 'https://a.test/x', name: 'admin' });
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    await assert.rejects(() => ed.saveCookieProfile({ url: 'https://a.test/x', name: bad }), (e) => e.code === 'COOKIE_BAD_NAME' && e.message === 'That name cannot be used for a cookie profile.');
  }
  await assert.rejects(() => ed.restoreCookieProfile({ url: 'https://evil.test/', name: 'admin' }), (e) => e.code === 'COOKIE_OTHER_SITE' && e.message === 'This cookie profile was saved for another site. Open that site to restore it.');
  assert.equal(sets.length, 0, 'nothing is written on another site');
  const ok = await ed.restoreCookieProfile({ url: 'https://a.test/y', name: 'admin' });
  assert.equal(ok.applied, 1);
  await assert.rejects(() => ed.restoreCookieProfile({ url: 'https://a.test/', name: 'constructor' }), /No cookie profile called/);
  await assert.rejects(() => ed.deleteCookieProfile({ name: 'toString' }), /No cookie profile called/);
  const key = 'cookieProfiles';
  const { loadSealed, saveSealed } = vault;
  await saveSealed(key, { legacy: { savedAt: 1, cookies: jar } }); // no url: allowed anywhere
  assert.equal((await ed.restoreCookieProfile({ url: 'https://other.test/', name: 'legacy' })).applied, 1);
});

await test('D-210 / r9-02-5: five wrong passphrases start a back-off of 2 s (doubling to 30 s) that refuses even the right one; unlocking arms the qaw-vault-idle alarm, whose worker handler locks', async () => {
  const salt9 = webcrypto.getRandomValues(new Uint8Array(16));
  await vault.setPass(await derive('right phrase', salt9), Buffer.from(salt9).toString('base64'), ITERS, 7);
  await vault.lockVault();
  const made = [];
  globalThis.chrome.alarms = { create: (name, o) => made.push([name, o]) };
  const wrong = await derive('wrong phrase', salt9);
  const right = await derive('right phrase', salt9);
  const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(() => vault.unlockVault(wrong), (e) => e.message === 'Wrong passphrase.' && e.code === undefined);
    await assert.rejects(() => vault.unlockVault(right), (e) => e.code === 'VAULT_BACKOFF' && e.retryMs > 0 && e.retryMs <= 2000);
    skew += 2500; // the 2 s wait is over: the sixth wrong try waits 4 s
    await assert.rejects(() => vault.unlockVault(wrong), (e) => e.code === undefined);
    await assert.rejects(() => vault.unlockVault(right), (e) => e.code === 'VAULT_BACKOFF' && e.retryMs > 2000 && e.retryMs <= 4000);
    for (let i = 0; i < 8; i++) { skew += 31000; await assert.rejects(() => vault.unlockVault(wrong), (e) => e.code === undefined); }
    await assert.rejects(() => vault.unlockVault(right), (e) => e.code === 'VAULT_BACKOFF' && e.retryMs > 16000 && e.retryMs <= 30000, 'capped at 30 s');
    skew += 31000;
    await vault.unlockVault(right);
    await vault.lockVault();
    await assert.rejects(() => vault.unlockVault(wrong), (e) => e.code === undefined);
    await vault.unlockVault(right); // a right passphrase cleared the counter: one wrong try costs nothing
  } finally { Date.now = realNow; }
  assert.deepEqual(made.at(-1), ['qaw-vault-idle', { delayInMinutes: 7 }]);
  const sw = fs.readFileSync(new URL('../background/service-worker.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("alarm.name === 'qaw-vault-idle') return void (await lockVault())"));
  await vault.setPass(null);
  delete globalThis.chrome.alarms;
});


await test('r10-02-2: VAULT_BACKOFF shows its wait in seconds and VAULT_REKEY asks for a new passphrase, in both languages', async () => {
  const WE = await import('../platform/worker-errors.js');
  const read = (n) => JSON.parse(fs.readFileSync(new URL(`../platform/i18n/${n}.json`, import.meta.url), 'utf8'));
  const tables = { en: read('en'), ar: read('ar') };
  const tOf = (lang) => (key, vars = {}) => String(tables[lang][key] ?? key).replace(/\{(\w+)\}/g, (w, n) => (n in vars ? String(vars[n]) : w));
  for (const lang of ['en', 'ar']) {
    const t = tOf(lang);
    const backoff = WE.localizeError({ ok: false, error: 'Wrong passphrase.', code: 'VAULT_BACKOFF', retryMs: 2300 }, t, lang);
    assert.ok(backoff.includes('3') && !backoff.includes('2300') && !backoff.includes('{secs}'), `${lang}: 2300 ms reads as 3 seconds: ${backoff}`);
    assert.equal(WE.localizeError({ ok: false, error: 'Wrong passphrase.', code: 'VAULT_BACKOFF', data: { retryMs: 30000 } }, t, lang).includes('30'), true, `${lang}: retryMs inside data`);
    const none = WE.localizeError({ ok: false, error: 'Wrong passphrase.', code: 'VAULT_BACKOFF' }, t, lang);
    assert.ok(none && !none.includes('{secs}') && none !== 'Wrong passphrase.' || lang === 'en', `${lang}: no number still gives a sentence`);
    const rekey = WE.localizeError({ ok: false, error: 'This passphrase was set with too few key-derivation rounds. Set a new passphrase.', code: 'VAULT_REKEY' }, t, lang);
    assert.equal(rekey, tables[lang]['common.worker.err.vaultRekey']);
  }
  assert.ok(/[؀-ۿ]/.test(WE.localizeError({ code: 'VAULT_BACKOFF', retryMs: 1000 }, tOf('ar'), 'ar')), 'Arabic is Arabic');
  const ui = fs.readFileSync(new URL('../options/vault-ui.js', import.meta.url), 'utf8');
  assert.ok(ui.includes("res.code === 'VAULT_REKEY'") && ui.includes("type: 'UQA_VAULT_STATE'") && ui.includes("$('vault-pass')?.focus()"), 'the options page does not refresh the state and ask for a new passphrase on REKEY');
  assert.ok(ui.includes('say(werr(res), true)'), 'the vault line is not worded by code');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
