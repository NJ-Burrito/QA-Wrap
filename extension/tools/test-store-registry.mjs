/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/**
 * T-054: the store registry matches what the code really holds, erase-all and
 * delete-session obey it, and PRIVACY.md's table is generated from it.
 *   node tools/test-store-registry.mjs [--write]   (--write refreshes PRIVACY.md: a manual owner command, QAW_REBASELINE_REASON="why", refused under `npm run`)
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REGISTRY, dataSessionKeys, eraseStores, sessionStores, privacyTable, quotaWarn, resetLocalKeys, eraseLocalKeys, erasedText, erasedSays } from '../core/store-registry.js';
import { ERASABLE_STORES, ERASABLE_LOCAL_KEYS, eraseKeys, sessionFootprint, describeFootprint } from '../core/sessions.js';
import * as db from '../core/db.js';
import { rebaselineGuard } from './lib-assert.mjs';
import { workerSrc, WORKER_MODULES } from './lib-worker-src.mjs';
const WORKER_FILES = WORKER_MODULES().map((f) => 'background/' + f);

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const dbName = read('core/db.js').match(/DB_NAME = '([^']+)'/)[1];
const open = () => new Promise((res, rej) => { const r = indexedDB.open(dbName); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const count = async (store, d) => new Promise((res) => { const c = d.transaction(store).objectStore(store).count(); c.onsuccess = () => res(c.result); });

console.log('store registry');

await test('every IndexedDB store the real schema creates is a registry row', async () => {
  await db.putSession({ id: 'probe', startedAt: 1, endedAt: 2, status: 'stopped' }); // runs onupgradeneeded
  const d = await open();
  const real = [...d.objectStoreNames]; d.close();
  const known = REGISTRY.filter((r) => r.kind === 'idb').map((r) => r.store);
  assert.deepEqual([...real].sort(), [...known].sort(), 'db.js and store-registry.js disagree');
});

await test('every chrome.storage key literal in the source is a registry row', () => {
  const have = new Set(REGISTRY.map((r) => r.key).filter(Boolean));
  const consts = { PROFILE_KEY: 'background/storage-editor.js', PERSIST_KEY: 'background/media.js', REC: 'platform/vault.js', SECRET_KEY: 'platform/settings.js', KEY: 'platform/chat-mattermost.js', STORE: 'api/api.js' };
  for (const [name, f] of Object.entries(consts)) {
    const v = read(f).match(new RegExp(`const ${name} = '([^']+)'`))?.[1];
    assert.ok(have.has(v), `${f} ${name}='${v}' is not in the registry`);
  }
  const lit = /storage\.(local|sync)\.(?:get|set|remove)\(\s*'([A-Za-z0-9_.]+)'/g;
  for (const f of ['background/service-worker.js', ...WORKER_FILES, 'background/media.js', 'platform/settings.js', 'platform/chat-mattermost.js', 'platform/vault.js', 'background/storage-editor.js', 'api/api.js']) {
    for (const m of read(f).matchAll(lit)) assert.ok(have.has(m[2]), `${f}: '${m[2]}' not in the registry`);
  }
  for (const k of ['consentedAt', 'sessionSeq', 'floatBounds', 'qawTheme', 'lastPurgeAt', 'purgeLog']) assert.ok(have.has(k), k);
});

await test('r4-02-3 / r4-03-3: apiEnvironments (pasted tokens) is a registry row that Erase all removes and PRIVACY.md lists', () => {
  const r = REGISTRY.find((x) => x.key === 'apiEnvironments');
  assert.ok(r && r.kind === 'local' && r.erasedBy === 'eraseAll', 'apiEnvironments must be an erasable local row');
  assert.ok(ERASABLE_LOCAL_KEYS.includes('apiEnvironments'));
  assert.match(read('api/api.js'), /const STORE = 'apiEnvironments';/, 'the scan reads the key from api/api.js: rename it there and this goes red');
  assert.ok(read('PRIVACY.md').includes('`apiEnvironments`'), 'PRIVACY.md does not list apiEnvironments');
});

await test('r3-03-4 (D8): the uqa.secHeaders.* session keys are registry rows, listed in PRIVACY.md and removed by Erase all', () => {
  const src = read('background/security-headers.js');
  for (const key of [src.match(/WINDOWS_KEY = '([^']+)'/)[1], src.match(/SEEN_KEY = '([^']+)'/)[1]]) {
    const r = REGISTRY.find((x) => x.key === key);
    assert.ok(r && r.kind === 'session' && r.erasedBy === 'eraseAll', `${key} must be a session row erased by Erase all`);
    assert.ok(eraseKeys([]).includes(key), `${key} is not in the Erase all key list`);
    assert.ok(read('PRIVACY.md').includes('`' + key + '`'), `PRIVACY.md does not list ${key}`);
  }
});

await test('erase-all lists are derived from the registry', () => {
  assert.deepEqual([...ERASABLE_STORES], eraseStores());
  assert.ok(ERASABLE_LOCAL_KEYS.includes('cookieProfiles') && ERASABLE_LOCAL_KEYS.includes('purgeLog'));
  assert.deepEqual(eraseKeys(['a']), ['lastSessionId', 'suiteDraft', 'qawReporterShot', 'popupDraft', 'uqa.secHeaders.windows', 'uqa.secHeaders.seen', 'masks:a', 'sessionState:a']);
});

await test('eraseEverything empties every eraseAll store; deleteSession clears one session from every session store', async () => {
  const seed = async (id) => {
    await db.putSession({ id, startedAt: 1, endedAt: 2, status: 'stopped' });
    await db.appendEvents([{ sessionId: id, kind: 'screenshot', ts: 2, captureId: `c-${id}` }]);
    await db.putCapture({ id: `c-${id}`, sessionId: id, dataUrl: 'data:' });
    await db.putMedia({ id: `m-${id}`, sessionId: id, ts: 1, blob: new Blob(['abc']), type: 'video/webm' });
    await db.putMediaPart(`m-${id}`, 0, new Blob(['a']));
    await db.putMediaPending({ id: `p-${id}`, sessionId: id });
    await db.putReplayChunk({ sessionId: id, seq: 0, entries: [{ t: 1 }] });
  };
  await seed('a'); await seed('b');
  await db.deleteSession('a');
  let d = await open();
  const gone = { sessions: 'a', captures: 'c-a', media: 'm-a' };
  for (const s of ['sessions', 'captures', 'media']) {
    assert.equal(await new Promise((r) => { const q = d.transaction(s).objectStore(s).get(gone[s]); q.onsuccess = () => r(q.result); }), undefined, `${s} kept a`);
  }
  d.close();
  const out = await db.eraseEverything(eraseStores());
  assert.deepEqual(out.failed, []);
  d = await open();
  for (const s of eraseStores()) assert.equal(await count(s, d), 0, `${s} not empty`);
  d.close();
  assert.ok(sessionStores().every((s) => eraseStores().includes(s)));
});

await test('adding a store to db.js without a registry row turns the derive check red', () => {
  const mutated = read('core/db.js').replace("db.createObjectStore('captures'", "db.createObjectStore('scratchNew', { keyPath: 'id' });\n        db.createObjectStore('captures'");
  assert.notEqual(mutated, read('core/db.js'));
  const known = new Set(REGISTRY.filter((r) => r.kind === 'idb').map((r) => r.store));
  const real = [...mutated.matchAll(/createObjectStore\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(real.some((s) => !known.has(s)), 'scratch store should be unknown to the registry');
});

await test('footprint: oldest session, total bytes and the 80 percent warning', () => {
  const f = sessionFootprint([{ startedAt: 5000 }, { startedAt: 3000 }], []);
  assert.equal(f.oldest, 3000);
  assert.ok(quotaWarn({ usage: 80, quota: 100 }) && !quotaWarn({ usage: 79, quota: 100 }) && !quotaWarn(null));
  const t = describeFootprint({ ...f, totalBytes: 5 * 1048576, quotaWarn: true });
  assert.match(t, /Total used by QA Wrap: 5 MB/); assert.match(t, /Oldest: 1970-01-01/); assert.match(t, /80 percent/);
});

await test('T-063: boot times and the use count are registry rows that Settings reset erases and the bundle alone shows', () => {
  for (const k of ['bootMs', 'toolUseTicks']) {
    const r = REGISTRY.find((x) => x.key === k);
    assert.ok(r, `${k} is a registry row`);
    assert.equal(r.erasedBy, 'reset'); assert.equal(r.shownIn, 'support bundle');
    assert.ok(resetLocalKeys().includes(k), `${k} is in resetLocalKeys()`);
  }
  // D-1010-57: the failure ring holds error text, so Erase all removes it (Reset still clears it in code, as a bonus).
  assert.ok(eraseLocalKeys().includes('handlerRing') && REGISTRY.find((r) => r.key === 'handlerRing').erasedBy === 'eraseAll');
  assert.ok(!resetLocalKeys().includes('firstReportOpenedAt'), 'a KEEP row is not erased by reset');
});

await test('T-054 every row that erases says what the confirm sentence calls it (or null), in both languages', () => {
  const en = JSON.parse(read('platform/i18n/en.json')); const ar = JSON.parse(read('platform/i18n/ar.json'));
  for (const r of REGISTRY.filter((x) => x.erasedBy !== 'KEEP')) {
    assert.ok(r.says === null || typeof r.says === 'string', `${r.id} erases but declares no \`says\``);
    if (r.says) for (const d of [en, ar]) assert.ok(d[`options.reset.erases.${r.says}`], `${r.id}: no words for "${r.says}"`);
  }
});

await test('T-054 a scratch registry row changes the reset and erase text; a KEEP row does not', () => {
  const tr = (k, v = {}) => ({ 'options.reset.erasesIntro': 'R[{list}]', 'options.reset.erasesAllIntro': 'E[{list}]', 'options.reset.erasesGone': 'G[{list}]', 'options.reset.erasesJoin': '|', 'options.reset.erases.zz': 'SCRATCH', 'options.reset.erases.sessions': 'S', 'options.reset.erases.settings': 'T' }[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x]);
  const row = (erasedBy, says) => ({ id: 'local:scratch', kind: 'local', key: 'scratch', holds: 'x', erasedBy, retention: 'x', syncs: false, shownIn: 'footprint', says });
  for (const mode of ['reset', 'eraseAll']) {
    const base = erasedText(tr, mode);
    assert.ok(base && !base.includes('SCRATCH'), base);
    assert.match(erasedText(tr, mode, { reg: [...REGISTRY, row(mode, 'zz')] }), /SCRATCH/);
    assert.equal(erasedText(tr, mode, { reg: [...REGISTRY, row('KEEP', 'zz')] }), base);
    assert.equal(erasedText(tr, mode, { reg: [...REGISTRY, row(mode, null)] }), base, 'a null-says row is bookkeeping and stays out of the sentence');
  }
  assert.match(erasedText(tr, 'eraseAll', { gone: true }), /^G\[S\|/);
  assert.equal(erasedText(tr, 'eraseAll', { reg: [] }), '');
  assert.deepEqual(erasedSays('reset'), ['settings', 'credentials', 'passphrase', 'diagnostics']);
  // completion review 7: the Reset sentence says chat webhooks go, so the Mattermost webhook is a reset key (it was KEPT).
  assert.ok(resetLocalKeys().includes('mattermost') && !REGISTRY.some((r) => r.key === 'mattermost' && r.erasedBy === 'KEEP'));
});

await test('r2-03-3 (D-1010-31): every chrome.storage.session key the worker writes is a registry row; Erase all removes the content ones, closing the browser drops the transient ones', () => {
  const have = new Map(REGISTRY.filter((r) => r.kind === 'session').map((r) => [r.key, r]));
  const files = ['background/service-worker.js', ...WORKER_FILES, 'background/armed.js', 'background/media.js', 'background/security-headers.js', 'background/context-menus.js', 'background/session-state.js', 'platform/settings.js', 'platform/vault.js'];
  const found = new Set();
  const strip = (f) => read(f).replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // OF-18: a key constant may now be declared in one worker module and used in another, so the names are read across all of them.
  const allConsts = Object.fromEntries(files.flatMap((f) => [...strip(f).matchAll(/\bconst ([A-Z][A-Z_]*) = '([^']+)'/g)].map((m) => [m[1], m[2]])));
  for (const f of files) {
    const src = strip(f);
    const consts = { ...allConsts, ...Object.fromEntries([...src.matchAll(/\bconst ([A-Z][A-Z_]*) = '([^']+)'/g)].map((m) => [m[1], m[2]])) }; // the file's own names win
    for (const m of src.matchAll(/(?:storage\.session|sess)\??\.(?:get|set|remove)\??\.?\(([^;]*?)\)\s*(?:;|\.catch|\)|,|$)/gm)) {
      const arg = m[1];
      for (const lit of arg.matchAll(/'([A-Za-z0-9_.:]+)'/g)) found.add(lit[1]);
      for (const id of arg.matchAll(/\[?\b([A-Z][A-Z_]+)\b\]?/g)) if (consts[id[1]]) found.add(consts[id[1]]);
      for (const key of arg.matchAll(/[{,]\s*([a-z]\w{2,})\s*[:,}]/g)) found.add(key[1]); // lower-case start (an UPPER_CASE const in an array is a name, resolved above); 3+ letters: skips the nested { k, t } of the vault record
    }
  }
  found.delete('sessionState:'); found.delete('masks:');
  for (const k of ['suiteDraft', 'qawReporterShot', 'recordingViewportRun', 'uqa.diskWarn', 'activeSessionsByWindow', 'activeSessionId', 'coverageTab', 'floatWindowId', 'armedWindows', 'recordingWindowId', 'qwk', 'managedPolicy']) assert.ok(found.has(k), `the scan no longer sees ${k}: it is blind, not clean`);
  const missing = [...found].filter((k) => !have.has(k));
  assert.deepEqual(missing, [], `storage.session keys with no registry row: ${missing.join(', ')}`);
  for (const k of ['suiteDraft', 'qawReporterShot']) assert.ok(have.get(k).erasedBy === 'eraseAll' && have.get(k).data, `${k} must be erased and removed with a deleted session`);
  assert.ok(dataSessionKeys().includes('suiteDraft') && dataSessionKeys().includes('qawReporterShot'));
  assert.ok(eraseKeys([]).includes('suiteDraft') && eraseKeys([]).includes('qawReporterShot') && eraseKeys(['z']).includes('sessionState:z'));
  assert.ok([...have.values()].filter((r) => r.transient).every((r) => r.erasedBy === 'browser' && !eraseKeys([]).includes(r.key)), 'a transient row is marked and is not erased by Erase all');
  const sw = workerSrc();
  assert.match(sw, /storage\.session\.remove\(\[\.\.\.dataSessionKeys\(\), \.\.\.eraseKeys\(\[id\]\)\]\)/, 'deleting a session removes the draft, the shot, and its masks and state');
});

await test('r10-03-3: UQA_DELETE_SESSION leaves no storage.session key that holds the deleted id, and spares another session', async () => {
  const { endOfBlock } = await import('./lib-lift.mjs');
  const sw = workerSrc();
  const at = sw.indexOf('UQA_DELETE_SESSION: async (msg) => {');
  const open = sw.indexOf('{', sw.indexOf('=>', at));
  const body = sw.slice(open, endOfBlock(sw, open) + 1);
  const mem = { lastSessionId: 'del', 'masks:del': [1], 'sessionState:del': { x: 1 }, 'masks:keep': [2], 'sessionState:keep': { y: 2 }, suiteDraft: {}, qawReporterShot: 'png' };
  const chrome = { storage: { session: {
    get: async (k) => ({ [k]: mem[k] }),
    remove: async (ks) => { for (const k of [].concat(ks)) delete mem[k]; },
  } } };
  const calls = [];
  const run = new Function('liveSessionIds', 'recordingState', 'flushEvents', 'bounded', 'deleteSession', 'forgetSession', 'chrome', 'LAST', 'dataSessionKeys', 'eraseKeys', 'broadcast', `return async (msg) => ${body};`)(
    async () => [], async () => ({ recording: false }), async () => {}, (p) => p, async (id) => { calls.push(id); }, () => {}, chrome, 'lastSessionId', dataSessionKeys, eraseKeys, async () => {});
  assert.deepEqual(await run({ sessionId: 'del' }), { deleted: 'del' });
  assert.deepEqual(calls, ['del']);
  assert.deepEqual(Object.keys(mem).filter((k) => k.includes('del')), [], 'no key holds the deleted id');
  assert.ok('masks:keep' in mem && 'sessionState:keep' in mem, 'another session keeps its masks and state');
});

await test('PRIVACY.md carries the generated table', () => {
  const A = '<!-- store-registry:start -->'; const B = '<!-- store-registry:end -->';
  const block = `${A}\n${privacyTable()}\n${B}`;
  let md = read('PRIVACY.md');
  if (process.argv.includes('--write')) {
    const reason = rebaselineGuard('--write');
    console.log(`PRIVACY.md table rewrite, reason: ${reason}; the generated block replaces the one in PRIVACY.md (git diff shows the change)`);
    md = md.includes(A) ? md.replace(new RegExp(`${A}[\\s\\S]*${B}`), block) : md.replace('## The standards this is built against', `### Everything stored, by place\n\n${block}\n\n## The standards this is built against`);
    fs.writeFileSync(new URL('PRIVACY.md', root), md);
  }
  assert.ok(md.includes(block), 'PRIVACY.md table is stale: run QAW_REBASELINE_REASON="why" node tools/test-store-registry.mjs --write (manual owner command)');
});

await test('r1-03-1: the mattermost row says account (not webhook), PRIVACY.md and the site say so, and no code path writes a token into storage.local', () => {
  const row = REGISTRY.find((r) => r.id === 'local:mattermost');
  assert.ok(row && /account/i.test(row.holds) && !/webhook/i.test(row.holds), row?.holds);
  assert.match(row.holds, /vault/);
  assert.ok(read('PRIVACY.md').includes(row.holds), 'the generated table carries the new label');
  assert.ok(read('PRIVACY.md').includes('Mattermost (as a signed-in account'), 'PRIVACY.md names the account route');
  assert.ok(fs.readFileSync(new URL('../site/privacy.html', root), 'utf8').includes('Mattermost (as a signed-in account'), 'the site names it too');
  const src = read('platform/chat-mattermost.js').replace(/\/\*[^]*?\*\//g, '');
  const sets = [...src.matchAll(/chrome\.storage\.local\.set\(([^;]*)\)/g)].map((m) => m[1]);
  assert.ok(sets.length >= 2 && sets.every((x) => x.includes('[KEY]: rest')), `every write to storage.local carries the record without its token: ${sets.join(' | ')}`);
});

await test('r4-02-2 (D-1010-71): cookie profiles and API variables go through the vault; no code path writes them to storage.local as plain JSON, and the vault names both keys', () => {
  const editor = read('background/storage-editor.js');
  assert.match(editor, /saveSealed\(PROFILE_KEY, profiles\)/);
  assert.doesNotMatch(editor, /storage\.local\.(set|get)\([^)]*PROFILE_KEY/, 'storage-editor.js writes or reads the profiles outside the vault');
  const api = read('api/api.js');
  assert.doesNotMatch(api, /storage\.local\.(set|get)\([^)]*STORE/, 'api.js writes or reads the environments outside the vault');
  const vault = read('platform/vault.js');
  assert.match(vault, /const SEALED = \['cookieProfiles', 'apiEnvironments'\]/);
  for (const k of ['cookieProfiles', 'apiEnvironments']) assert.ok(ERASABLE_LOCAL_KEYS.includes(k), `Erase all removes ${k}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
