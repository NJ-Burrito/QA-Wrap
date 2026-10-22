/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/**
 * T-009: "Erase all", delete-session and retention purge reach the `replay`
 * store and the `cookieProfiles` key. Real IndexedDB semantics (fake-indexeddb),
 * every store seeded, then erased and counted.
 *
 *   node tools/test-erase.mjs
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ERASABLE_STORES, ERASABLE_LOCAL_KEYS } from '../core/sessions.js';
import * as db from '../core/db.js';
import { workerSrc } from './lib-worker-src.mjs';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const dbName = fs.readFileSync(new URL('../core/db.js', import.meta.url), 'utf8').match(/DB_NAME = '([^']+)'/)[1];
const rows = (store) => new Promise((resolve, reject) => {
  const r = indexedDB.open(dbName);
  r.onsuccess = () => {
    const c = r.result.transaction(store).objectStore(store).count();
    c.onsuccess = () => { r.result.close(); resolve(c.result); };
    c.onerror = () => reject(c.error);
  };
  r.onerror = () => reject(r.error);
});

async function seed(id) {
  await db.putSession({ id, startedAt: 1, endedAt: 2, status: 'stopped' });
  await db.appendEvents([{ sessionId: id, kind: 'note', ts: 1, text: 'x' }, { sessionId: id, kind: 'screenshot', ts: 2, captureId: `c-${id}` }]);
  await db.putCapture({ id: `c-${id}`, sessionId: id, dataUrl: 'data:' });
  await db.putMedia({ id: `m-${id}`, sessionId: id, ts: 1, blob: new Blob(['abc']), type: 'video/webm' });
  await db.putMediaPart(`m-${id}`, 0, new Blob(['a']));
  await db.putMediaPending({ id: `p-${id}`, sessionId: id });
  await db.putReplayChunk({ sessionId: id, seq: 0, entries: [{ typed: 'secret' }] });
}

console.log('erase - every store and key');

await test('ERASABLE_STORES names replay, and ERASABLE_LOCAL_KEYS equals the cookie profile key', () => {
  assert.ok(ERASABLE_STORES.includes('replay'));
  const key = fs.readFileSync(new URL('../background/storage-editor.js', import.meta.url), 'utf8').match(/PROFILE_KEY = '([^']+)'/)[1];
  assert.ok(ERASABLE_LOCAL_KEYS.includes(key));
});

await test('erase-all leaves every named store empty', async () => {
  await seed('a'); await seed('b');
  for (const s of ERASABLE_STORES) assert.ok((await rows(s)) > 0, `${s} should be seeded`);
  const out = await db.eraseEverything(ERASABLE_STORES);
  assert.deepEqual(out.failed, []);
  for (const s of ERASABLE_STORES) assert.equal(await rows(s), 0, `${s} still holds rows`);
});

await test('D-1010-103 / r5-06-1: a store that fails to clear is reported in failed (with its name), the rest are cleared, and a second erase finishes', async () => {
  await seed('fs1');
  const proto = IDBObjectStore.prototype;
  const real = proto.clear;
  proto.clear = function (...args) { if (this.name === 'replay') throw new Error('locked'); return real.apply(this, args); };
  let out;
  try { out = await db.eraseEverything(ERASABLE_STORES); } finally { proto.clear = real; }
  assert.equal(out.failed.length, 1, JSON.stringify(out.failed));
  assert.match(out.failed[0], /^replay: /);
  assert.ok(!out.cleared.includes('replay') && out.cleared.includes('events'));
  assert.ok((await rows('replay')) > 0, 'the failed store still holds its rows');
  const again = await db.eraseEverything(ERASABLE_STORES);
  assert.deepEqual(again.failed, []);
  assert.equal(await rows('replay'), 0);
});

await test('D-1010-105 / r5-06-3: an open failure carries DB_BROKEN and eraseEverything falls back to deleteDatabase', async () => {
  await seed('ob1');
  await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase(dbName); r.onsuccess = resolve; r.onerror = () => reject(r.error); }); // closes the cached connection (versionchange)
  const realOpen = indexedDB.open.bind(indexedDB); const realDel = indexedDB.deleteDatabase.bind(indexedDB);
  let deletes = 0;
  indexedDB.open = () => { const r = {}; Object.defineProperty(r, 'error', { value: Object.assign(new Error('Internal error opening backing store'), { name: 'UnknownError' }) }); setTimeout(() => r.onerror?.(), 0); return r; };
  indexedDB.deleteDatabase = (...a) => { deletes++; return realDel(...a); };
  try {
    await assert.rejects(() => db.getSession('x'), (err) => err.code === 'DB_BROKEN');
    const out = await db.eraseEverything(ERASABLE_STORES);
    assert.equal(deletes, 1, 'deleteDatabase must be called once');
    assert.deepEqual(out.failed, []);
    assert.deepEqual(out.cleared, [...ERASABLE_STORES]);
  } finally { indexedDB.open = realOpen; indexedDB.deleteDatabase = realDel; }
  await seed('ob2'); // the database works again afterwards
  assert.ok(await db.getSession('ob2'));
  await db.eraseEverything(ERASABLE_STORES);
});

await test('D-207 / r9-06-5: a VersionError opens as DB_NEWER with the exact text, and a plain failure is still DB_BROKEN', async () => {
  await seed('nw1');
  await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase(dbName); r.onsuccess = resolve; r.onerror = () => reject(r.error); });
  const realOpen = indexedDB.open.bind(indexedDB);
  indexedDB.open = () => { const r = {}; Object.defineProperty(r, 'error', { value: Object.assign(new Error('The requested version is less than the existing version'), { name: 'VersionError' }) }); setTimeout(() => r.onerror?.(), 0); return r; };
  try {
    await assert.rejects(() => db.getSession('x'), (err) => err.code === 'DB_NEWER' && err.message === 'This QA Wrap database was saved by a newer version. Update the extension, or erase all data to start again.');
  } finally { indexedDB.open = realOpen; }
  await seed('nw2');
  assert.ok(await db.getSession('nw2'));
  await db.eraseEverything(ERASABLE_STORES);
});

await test('D-1010-105: the three open failures carry DB_SLOW, DB_BLOCKED and DB_BROKEN with their texts unchanged', () => {
  const src = fs.readFileSync(new URL('../core/db.js', import.meta.url), 'utf8');
  for (const [text, code] of [['did not open within', 'DB_SLOW'], ['is held open by another QA Wrap page at an older version', 'DB_BLOCKED'], ['The QA Wrap database failed to open.', 'DB_BROKEN']]) {
    const at = src.indexOf(text); assert.ok(at > 0, `${text} text is gone`);
    assert.ok(src.slice(at, at + 400).includes(`'${code}'`), `${code} is not attached next to "${text}"`);
  }
});

await test('D-1010-106 / r5-06-5: deleteSession clears the unfinished recording parts and pending row of that session, and spares another session', async () => {
  await seed('pd1'); await seed('pd2');
  for (const [pid, sid] of [['pend-1', 'pd1'], ['pend-2', 'pd2']]) {
    await db.putMediaPending({ id: pid, sessionId: sid, startedAt: 1 });
    await db.putMediaPart(pid, 0, new Blob(['a'])); await db.putMediaPart(pid, 1, new Blob(['b']));
  }
  await db.deleteSession('pd1');
  assert.equal((await db.mediaParts('pend-1')).length, 0, 'parts of the deleted session survived');
  assert.ok(!(await db.listMediaPending()).some((r) => r.sessionId === 'pd1'), 'the pending row survived');
  assert.equal((await db.mediaParts('pend-2')).length, 2, 'the other session lost its parts');
  await db.deleteSession('pd2');
});

await test('D-1010-106: purgeExpired sweeps pending parts before the keep-forever guard', () => {
  const sw = workerSrc();
  const a = sw.indexOf('async function purgeExpired()'); const body = sw.slice(a, sw.indexOf('keptForever: true', a));
  assert.ok(body.includes('await sweepPendingMedia('), 'the pending sweep is not before the retention guard');
});

await test('the worker removes the cookieProfiles key on erase-all', () => {
  const sw = workerSrc();
  assert.match(sw, /chrome\.storage\.local\.remove\(\['lastPurgeAt', 'purgeLog', \.\.\.ERASABLE_LOCAL_KEYS\]\)/);
});

await test('delete-session (and so retention purge) leaves no replay row, and spares the other session', async () => {
  await seed('a'); await seed('b');
  await db.deleteSession('a');
  assert.equal((await db.replaySize('a')).chunks, 0);
  assert.equal((await db.replaySize('b')).chunks, 1);
  assert.equal(await db.getSession('a'), null);
});

await test('deleteSession deletes the replay before the session row', () => {
  const src = fs.readFileSync(new URL('../core/db.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function deleteSession'));
  assert.ok(body.indexOf('deleteReplay(id)') > 0 && body.indexOf('deleteReplay(id)') < body.indexOf("txMulti(['events', 'captures', 'sessions']"));
});

await test('r4-06-2: when the events delete throws, the session row survives and a second deleteSession succeeds', async () => {
  await seed('f1');
  const proto = IDBObjectStore.prototype;
  const real = proto.delete;
  let thrown = 0;
  proto.delete = function (...args) {
    if (this.name === 'events' && thrown === 0) { thrown++; throw new Error('boom'); }
    return real.apply(this, args);
  };
  try {
    await assert.rejects(() => db.deleteSession('f1'), /boom|AbortError/); // thrown inside the cursor callback, so the transaction aborts
  } finally { proto.delete = real; }
  assert.ok(await db.getSession('f1'), 'the session row is still there, so the delete can be retried');
  await db.deleteSession('f1');
  assert.equal(await db.getSession('f1'), null);
  assert.equal((await db.getEvents('f1')).length, 0, 'no orphaned events');
});

await test('r2-06-1: a failure in the last delete transaction loses nothing; the second delete empties events, captures, mediaParts; a late event is swept', async () => {
  await db.eraseEverything(ERASABLE_STORES);
  await seed('g1'); await seed('live');
  const proto = IDBObjectStore.prototype;
  const real = proto.delete;
  let thrown = 0;
  proto.delete = function (...args) {
    if (this.name === 'sessions' && thrown === 0) { thrown++; throw new Error('boom'); }
    return real.apply(this, args);
  };
  try { await assert.rejects(() => db.deleteSession('g1'), /boom/); } finally { proto.delete = real; }
  assert.ok(await db.getSession('g1'), 'the session row survives, so the delete can be repeated');
  assert.equal((await db.getEvents('g1')).length, 2, 'events, captures and the row are one transaction: the failure removed none of them');
  assert.equal(await rows('captures'), 2);
  await db.deleteSession('g1');
  assert.equal(await db.getSession('g1'), null);
  assert.equal((await db.getEvents('g1')).length, 0);
  assert.equal(await rows('captures'), 1, 'only the live session screenshot is left');
  assert.equal(await rows('mediaParts'), 1, 'the clip parts went with their clip');
  await db.appendEvents([{ sessionId: 'g1', kind: 'note', ts: 9, text: 'late' }]); // the dropped-events note that fires after a delete
  const out = await db.sweepOrphanRows(['live']);
  assert.equal(out.events, 1);
  assert.equal((await db.getEvents('g1')).length, 0, 'the sweep removed the late event');
  assert.equal((await db.getEvents('live')).length, 2, 'a live session is never swept');
});

await test('r4-06-3: sweepOrphanRows also removes replay chunks no session owns, counts them, and leaves a live session replay', async () => {
  await db.eraseEverything(ERASABLE_STORES);
  await seed('live2'); // seeds one replay chunk
  await db.putReplayChunk({ sessionId: 'gone', entries: [{ t: 2 }] }); // a late chunk after its session was deleted
  await db.putReplayChunk({ sessionId: 'gone', entries: [{ t: 3 }] });
  const out = await db.sweepOrphanRows(['live2']);
  assert.equal(out.replay, 2, 'the orphan chunks are counted');
  assert.equal((await db.getReplay('gone')).chunks, 0, 'the orphan replay is gone');
  assert.equal((await db.getReplay('live2')).chunks, 1, 'a live session replay is never swept');
});

await test('r2-06-3: db.js reads reject SLOW when the transaction never completes', async () => {
  const { withDeadline, DEADLINES } = await import('../platform/deadline.js');
  const keep = DEADLINES.tx; DEADLINES.tx = 30;
  db.bindTxDeadline((p) => withDeadline(p, 'tx'));
  const realTx = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (stores, mode) {
    const t = realTx.call(this, stores, mode);
    if (mode === 'readonly') { Object.defineProperty(t, 'oncomplete', { set() {}, get() { return null; } }); } // the completion callback is never installed
    return t;
  };
  const warn = console.warn; console.warn = () => {};
  try { await assert.rejects(() => db.listSessions(), (e) => e.code === 'SLOW'); }
  finally { IDBDatabase.prototype.transaction = realTx; DEADLINES.tx = keep; db.bindTxDeadline(null); console.warn = warn; }
  assert.ok(Array.isArray(await db.listSessions()), 'reads work again once the hang is gone');
});

await test('r5-06-4: UQA_DELETE_SESSION flushes the write queue before it deletes', () => {
  const sw = workerSrc();
  const at = sw.indexOf('UQA_DELETE_SESSION: async (msg) => {');
  const body = sw.slice(at, sw.indexOf('UQA_EXPORT:', at));
  assert.ok(body.indexOf('await flushEvents()') > 0 && body.indexOf('await flushEvents()') < body.indexOf('deleteSession(id)'), 'flush must come first');
  assert.match(body, /bounded\(deleteSession\(id\), 'tx'\)/, 'r10-06-4: the delete answers SLOW instead of hanging');
});

await test('r10-06-3: deleting a session with screenshots leaves no captures rows, and another session keeps its own', async () => {
  await seed('keep');
  await db.putSession({ id: 'shots', startedAt: 1, endedAt: 2, status: 'stopped' });
  const evs = [];
  for (let i = 0; i < 5; i++) { evs.push({ sessionId: 'shots', kind: 'screenshot', ts: i, captureId: `sc-${i}` }); await db.putCapture({ id: `sc-${i}`, sessionId: 'shots', dataUrl: 'data:' }); }
  evs.push({ sessionId: 'shots', kind: 'note', ts: 9, text: 'n' });
  await db.appendEvents(evs);
  const before = await rows('captures');
  await db.deleteSession('shots');
  assert.equal(await rows('captures'), before - 5, 'all five screenshot captures went in the same transaction');
  assert.equal((await db.getEvents('shots')).length, 0, 'and so did the events');
  assert.equal((await db.getEvents('keep')).length, 2, 'another session is untouched');
  assert.ok((await db.getCaptures(['c-keep']))['c-keep'], 'its capture is still there');
  const src = fs.readFileSync(new URL('../core/db.js', import.meta.url), 'utf8');
  assert.ok(!/const events = await rawEvents\(id\)/.test(src), 'the full pre-read is gone');
});

await test('r10-06-4: a store whose clear() never completes is listed in failed inside the deadline, without a retry', async () => {
  const { withDeadline, DEADLINES } = await import('../platform/deadline.js');
  const keep = DEADLINES.tx; DEADLINES.tx = 40;
  db.bindTxDeadline((p) => withDeadline(p, 'tx'));
  const realTx = IDBDatabase.prototype.transaction;
  let clears = 0;
  IDBDatabase.prototype.transaction = function (stores, mode) {
    if (stores === 'media') return { objectStore: () => ({ clear() { clears++; return {}; } }) }; // never completes
    return realTx.call(this, stores, mode);
  };
  const warn = console.warn; console.warn = () => {};
  const t0 = Date.now();
  let out;
  try { out = await db.eraseEverything(['media', 'sessions']); }
  finally { IDBDatabase.prototype.transaction = realTx; DEADLINES.tx = keep; db.bindTxDeadline(null); console.warn = warn; }
  assert.ok(Date.now() - t0 < 1500, 'answers within the deadline, not never');
  assert.deepEqual(out.failed, ['media: did not answer in time']);
  assert.deepEqual(out.cleared, ['sessions'], 'the next store is still cleared');
  assert.equal(clears, 1, 'SLOW is never retried: the clear may still commit');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
