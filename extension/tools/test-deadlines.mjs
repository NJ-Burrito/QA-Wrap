/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The "service worker stops answering" regression (work/sw-hang-1004).
 *
 *   node tools/test-deadlines.mjs
 *
 * A promise that never settles used to wedge the settings read path until the worker restarted. Asserts:
 *   1. a stalled IndexedDB open rejects (SLOW), never mints a key, and the next call returns the ORIGINAL key
 *   2. a stalled storage.sync read rejects a save (SLOW), writes nothing, and the next save answers
 *   3. a stalled write cannot block later saves, and the late stale write is skipped
 *   4. a stalled offscreen round trip rejects with its own code (not STALE) and the next call is not stuck
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { installIdbStub } from './lib-idb-stub.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const sync = {}, local = {}, session = {};
const gates = {}; // name -> { hang: n } hang the next n calls until released
const hangs = [];
const area = (name, bag) => ({
  get: async (key) => {
    if (gates[name]?.hang > 0 && (gates[name].only == null || gates[name].only === key)) { gates[name].hang--; await new Promise((r) => hangs.push(r)); }
    return key === null ? { ...bag } : { [key]: bag[key] };
  },
  set: async (obj) => { Object.assign(bag, obj); },
  remove: async (key) => delete bag[key],
});
const sent = [];
globalThis.chrome = {
  storage: { sync: area('sync', sync), local: area('local', local), session: area('session', session), managed: { get: async () => ({}) } },
  runtime: { getURL: (p) => 'chrome-extension://x/' + p, getContexts: async () => [{}], sendMessage: async (m) => { sent.push(m); return await new Promise((ok) => (globalThis.__offscreenReply = ok)); } },
  offscreen: { createDocument: async () => {} },
};
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32' }, configurable: true });
const idb = installIdbStub();
const goodIdb = globalThis.indexedDB;
const stalledIdb = { open: () => ({}) }; // never fires anything
const warns = [];
console.warn = (...a) => warns.push(a.join(' '));

const { DEADLINES } = await import('../platform/deadline.js');
Object.assign(DEADLINES, { deviceKey: 40, sync: 40, write: 150, offscreen: 40 });
const { getSettings, setSettings } = await import('../platform/settings.js');
const vault = await import('../platform/vault.js');
const media = await import('../background/media.js');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
const release = () => hangs.splice(0).forEach((r) => r());

await setSettings({ jira: { token: 'CANARY-ORIGINAL' }, soundEnabled: false });
const keyOf = () => idb.get('qw').get('k').get(0);
const original = keyOf();

await test('stalled indexedDB open rejects SLOW, mints nothing, and the next call gets the ORIGINAL key', async () => {
  vault.dropKeyCache();
  globalThis.indexedDB = stalledIdb;
  await assert.rejects(vault.readVault(), (e) => e.code === 'SLOW' && e.stage === 'deviceKey');
  globalThis.indexedDB = goodIdb;
  const v = await vault.readVault();
  assert.equal(v.data?.jira?.token, 'CANARY-ORIGINAL');
  assert.equal(keyOf(), original, 'the key must be the one made first');
  assert.ok(warns.some((w) => w.includes('[uqa] deadline deviceKey')), 'the deadline logs its stage');
});

await test('a save while storage.sync stalls rejects SLOW and persists nothing; the next save answers', async () => {
  const before = JSON.stringify(sync);
  gates.sync = { hang: 1 };
  await assert.rejects(setSettings({ soundEnabled: true }), (e) => e.code === 'SLOW' && e.stage === 'sync');
  assert.equal(JSON.stringify(sync), before, 'nothing written on a timed-out read');
  release();
  const s = await setSettings({ soundEnabled: true });
  assert.equal(s.soundEnabled, true);
});

await test('getSettings on a stalled sync read serves the last good snapshot, not defaults', async () => {
  await setSettings({ keymap: { start: 'Alt+Q' } });
  const good = await getSettings();
  gates.sync = { hang: 1 };
  const slow = await getSettings();
  release();
  assert.equal(slow.soundEnabled, good.soundEnabled);
  assert.equal(slow.jira.token ? 'has' : 'none', good.jira.token ? 'has' : 'none');
});

await test('a stalled write does not block the next save, and the late stale write is skipped', async () => {
  gates.local = { hang: 1, only: 'qw0' }; // first vault read of the first save hangs (inside writeSettings)
  const first = setSettings({ recordMic: false, marker: 'A' });
  const firstSettled = first.then(() => 'ok', (e) => e.code);
  // wait for the first to run into the hang, then let the write deadline fire
  assert.equal(await firstSettled, 'SLOW');
  const s = await setSettings({ marker: 'B' });
  assert.equal(s.marker, 'B');
  release(); // the stalled first save resumes now
  await new Promise((r) => setTimeout(r, 30));
  // D-1010-58 / D-1010-65: a key off the sync allow-list lives in storage.local.settingsLocal, never in sync.settings
  assert.equal(local.settingsLocal.marker, 'B', 'the late stale write must not land after the newer one');
  assert.ok(!('marker' in (sync.settings || {})), 'marker is off the sync allow-list: it must not appear in sync.settings');
});

await test('a stalled offscreen round trip rejects with its own code, and the next call is not stuck', async () => {
  const slow = media.copyToClipboard('x');
  await assert.rejects(slow, (e) => e.code === 'MEDIA_SLOW' && e.code !== 'STALE');
  setTimeout(() => globalThis.__offscreenReply?.({ ok: true, result: 'done' }), 10);
  assert.equal(await media.copyToClipboard('y'), 'done');
});

await test('r7-06-5: a session-state get that never answers rejects SLOW, and two noteUse calls after it both settle', async () => {
  const ss = await import('../background/session-state.js');
  gates.session = { hang: 1 };
  const first = ss.noteUse('s-r7', 'pick').then(() => 'ok', (e) => e.code);
  const second = ss.noteUse('s-r7', 'pick').then((v) => v.count, (e) => e.code);
  const both = await Promise.race([Promise.all([first, second]), new Promise((r) => setTimeout(() => r('wedged'), 1000))]);
  release();
  assert.notEqual(both, 'wedged', 'the chain moved on');
  assert.equal(both[0], 'SLOW');
  assert.equal(both[1], 1, 'the second call counted once');
  assert.equal((await ss.noteUse('s-r7', 'pick')).count, 2, 'and the chain still works');
});

await test('r7-06-3: startSession bounds its putSession write by the tx deadline (rejects SLOW within 8 s)', async () => {
  const { readFileSync } = await import('node:fs');
  const worker = workerSrc();
  assert.match(worker, /await bounded\(putSession\(session\), 'tx'\);/, 'startSession wraps the write');
  assert.ok(DEADLINES.tx <= 8000, 'the tx deadline is at most 8 s');
  const { withDeadline } = await import('../platform/deadline.js');
  const hung = () => new Promise(() => {}); // a putSession stub that never answers
  const t0 = Date.now();
  await assert.rejects(withDeadline(hung(), 'tx', 60), (e) => e.code === 'SLOW' && e.stage === 'tx');
  assert.ok(Date.now() - t0 < 8000);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(`FAIL ${failures.join('; ')}`); process.exit(1); }
console.log('test-deadlines: PASS');
