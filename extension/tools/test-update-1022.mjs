/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The automatic update (1022): the native host swaps the folder in place and rolls back on failure, the profile is untouched,
 * the extension ID is pinned by the manifest key, the only request of a fresh profile is the one release check, and the What's new hook.
 *   node tools/test-update-1022.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { open as openWhatsNew } from '../core/whats-new-open.js';
import { checkLatest } from '../core/update-check.js';
import { EXT, makeStorage, read } from './test-site-powers.mjs';

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n++; console.log(`  ok  ${name}`); } catch (e) { n++; failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};
const manifest = JSON.parse(read('manifest.json'));

await test('the extension ID is pinned by the manifest key, and the installer derives the same ID from it', () => {
  assert.ok(manifest.key && manifest.key.length > 300, 'manifest.json carries the key');
  const h = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
  const id = [...h].map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join('');
  assert.match(id, /^[a-p]{32}$/);
  const ps = read('updater', 'install-host.ps1');
  assert.ok(ps.includes('[Convert]::FromBase64String($man.key)') && ps.includes('SHA256') && ps.includes('97 + ($_ -shr 4)'), 'same derivation in install-host.ps1');
  assert.ok(ps.includes('allowed_origins = @("chrome-extension://$id/")'), 'only this extension may talk to the host');
  assert.ok(!/\.pem/.test(JSON.stringify(manifest)), 'no private key in the manifest');
});

await test('the private key never enters the repo: .gitignore holds *.pem and keys/', () => {
  const gi = fs.readFileSync(path.join(EXT, '..', '.gitignore'), 'utf8');
  assert.match(gi, /^\*\.pem$/m);
  assert.match(gi, /^keys\/$/m);
});

await test('rule 12: a fresh profile makes exactly one request, the release check, with no body, no cookies and no session data', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return { status: 404, ok: false, headers: { get: () => null }, json: async () => ({}) }; };
  const src = JSON.parse(read('core', 'update-source.json'));
  assert.equal(src.repo, 'NJ-Burrito/QA-Wrap');
  await checkLatest({ repo: src.repo, current: manifest.version, fetch });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/NJ-Burrito/QA-Wrap/releases/latest');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.deepEqual(Object.keys(calls[0].init.headers), ['Accept']);
  // the check is on by default: no "off" key is needed, and the alarm is armed without any user press
  assert.match(read('background', 'worker-lifecycle.js'), /s\.checkUpdates === false \? null/);
  assert.match(read('background', 'worker-lifecycle.js'), /chrome\.alarms\?\.create\?\.\('qaw-update'/);
});

await test('What\'s new opens after an update only, and writes nothing', async () => {
  const st = makeStorage();
  const tabs = [];
  const api = { runtime: { getManifest: () => ({ version: '3.6.0' }), getURL: (p) => `chrome-extension://x/${p}` }, storage: { local: st.local }, tabs: { create: async (o) => tabs.push(o.url) } };
  await st.local.set({ qawPendingNotes: { version: '3.6.0', notes: '- a' } });
  assert.equal(await openWhatsNew({ reason: 'update', previousVersion: '3.5.3' }, api), true);
  assert.deepEqual(tabs, ['chrome-extension://x/whatsnew/whatsnew.html']);
  assert.equal(st.writes.n, 1, 'only our own setup write');
  assert.equal(await openWhatsNew({ reason: 'update', previousVersion: '3.6.0' }, { ...api, storage: { local: makeStorage().local } }), false, 'a plain reload opens nothing');
  assert.match(read('background', 'service-worker.js'), /onInstalled, "runtime\.onInstalled › what's new", async \(d\) => d\?\.reason === 'update'/);
});

await test('the page shows release notes as text only (no innerHTML, no eval), EN and AR keys exist', () => {
  const js = read('whatsnew', 'whatsnew.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(js));
  for (const lang of ['en', 'ar']) {
    const t = JSON.parse(read('platform', 'i18n', `${lang}.json`));
    for (const k of ['update.upd1022.pageTitle', 'update.upd1022.updating', 'update.upd1022.failed', 'update.upd2.turnOn', 'update.upd2.youreOn', 'update.upd1022.tokenLabel']) assert.ok(t[k], `${lang}:${k}`);
  }
});

await test('the update never touches the tester\'s data: storage keys and session count identical before and after (additive keys only)', async () => {
  const st = makeStorage();
  await st.local.set({ sessions: [{ id: 's1' }, { id: 's2' }, { id: 's3' }], settings: { lang: 'ar' }, notes: { a: 'x' }, consentedAt: 1, qawUpdate: { latest: { version: '3.6.0' } } });
  await st.session.set({ 'uqa.active': 'k' });
  const snap = () => JSON.stringify(Object.entries(st.data).filter(([k]) => !/^qawUpdate|^qawPending|^uqa\.updateNew$/.test(k)).sort());
  const before = snap();
  await st.local.set({ qawPendingNotes: { version: '3.6.0' } }); // what the Update press adds
  await openWhatsNew({ reason: 'update', previousVersion: '3.5.3' }, { runtime: { getManifest: () => ({ version: '3.6.0' }), getURL: (p) => p }, storage: { local: st.local }, tabs: { create: async () => {} } });
  assert.equal(snap(), before);
  assert.equal(st.data.sessions.length, 3);
});

console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n} passed`);
process.exit(failed ? 1 : 0);
