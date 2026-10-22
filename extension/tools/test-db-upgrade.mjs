/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-038: a v4 profile with history upgrades to v5 by opening: 200 events, one
 * clip row survive untouched, and the new `replay` store takes one chunk.
 * fake-indexeddb here; the same fixture runs in real Chromium in test-truth.mjs.
 *
 *   node tools/test-db-upgrade.mjs
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { seedV4, V4_EVENTS, seedLegacy, LEGACY_EVENTS, LEGACY_FAILS } from './lib-db-fixture.mjs';
import * as db from '../core/db.js';
import { workerSrc } from './lib-worker-src.mjs';

await seedV4(indexedDB);
assert.equal((await db.listSessions()).length, 1, 'the v4 session is listed after the upgrade');
assert.equal((await db.getEvents('s-v4')).length, V4_EVENTS, 'all 200 v4 events survive');
assert.equal((await db.listMedia('s-v4')).length, 1, 'the v4 clip row survives');
await db.putReplayChunk({ sessionId: 's-v4', seq: 0, entries: [{ t: 1 }] });
assert.equal((await db.getReplay('s-v4')).entries.length, 1, 'the new replay store takes a chunk');
console.log('  ok  v4 to v5 upgrade keeps history (4 checks)');
/* ── 06-2: only an EMPTY recording may have its parts cleared ──────────── */
{
  await db.putMediaPending({ id: 'c-empty', sessionId: 's-v4', ts: 1 });
  await assert.rejects(() => db.assembleMedia({ id: 'c-empty', type: 'video/webm' }), (e) => e.code === 'EMPTY', 'nothing written: code EMPTY');

  await db.putMediaPending({ id: 'c-quota', sessionId: 's-v4', ts: 2 });
  await db.putMediaPart('c-quota', 0, new Blob(['aaaa']));
  await db.putMediaPart('c-quota', 1, new Blob(['bbbb']));
  // A record the store refuses (not cloneable) stands in for a quota failure in putMedia.
  await assert.rejects(() => db.assembleMedia({ id: 'c-quota', type: 'video/webm', refuse() {} }), (e) => e.code !== 'EMPTY', 'a store failure is not EMPTY');
  assert.equal((await db.mediaParts('c-quota')).length, 2, 'putMedia failed: the parts survive');
  assert.ok((await db.listMediaPending()).some((r) => r.id === 'c-quota'), 'and so does the pending marker');

  await db.clearMediaParts('c-empty');
  const src = workerSrc();
  assert.match(src, /catch \(err\) \{[^}]*\n[^}]*\n[^}]*\n\s*if \(err\?\.code === 'EMPTY'\) await clearMediaParts\(row\.id\)/, 'recoverPendingClips clears only for EMPTY');
  assert.ok(!/\n\s*await clearMediaParts\(row\.id\)\.catch\(\(\) => \{\}\);\n\s*\}\n\s*\}\n\s*if \(recovered\)/.test(src), 'no unconditional clear left');
  console.log('  ok  06-2: EMPTY clears parts, any other failure keeps parts and marker (5 checks)');
}

/* ── 06-5: a connection that arrives after the open already failed is closed ── */
{
  const real = globalThis.indexedDB;
  let closed = 0;
  let req;
  globalThis.indexedDB = { open() { req = {}; return req; } };
  try {
    const late = await import('../core/db.js?late');
    const first = late.listSessions();
    req.onblocked(); // the open is rejected as blocked
    await assert.rejects(() => first, /held open by another/);
    req.result = { close() { closed += 1; } };
    req.onsuccess(); // ...and the connection arrives anyway
    assert.equal(closed, 1, 'the late handle is closed, not held for the life of the worker');
    assert.equal(req.result.onversionchange, undefined, 'and not wired in as the live database');
  } finally {
    globalThis.indexedDB = real;
  }
  console.log('  ok  06-5: a late openDb handle is closed (2 checks)');
}

/* ── r3-06-1: boot recovery never overwrites a clip that was already assembled ── */
{
  const fs = await import('node:fs');
  const { lift } = await import('./lib-lift.mjs');
  const src = workerSrc();
  const events = [];
  const run = new Function('recordingState', 'listMediaPending', 'getMedia', 'assembleMedia', 'clearMediaParts', 'getSession', 'appendEvent', 'QAConsole', 'plural',
    `${'async ' + lift(src, 'recoverPendingClips')}\nreturn recoverPendingClips;`)(
    async () => ({ recording: false }), db.listMediaPending, db.getMedia, db.assembleMedia, db.clearMediaParts,
    async (id) => ({ id }), async (e) => { events.push(e); }, { info() {} }, (n, w) => `${n} ${w}`);

  // The worker died between putMedia and clearMediaParts: the finished record, its leftover parts, the marker.
  const done = { id: 'c-done', sessionId: 's-v4', kind: 'recording', label: 'Checkout flow', type: 'video/webm', ext: 'webm', durationMs: 4321, sha256: 'abc123', ts: 5, blob: new Blob(['the whole clip']), bytes: 14 };
  await db.putMedia(done);
  await db.putMediaPending({ id: 'c-done', sessionId: 's-v4', ts: 5 });
  await db.putMediaPart('c-done', 0, new Blob(['leftover']));
  // A genuinely interrupted clip beside it: parts and a marker, no record.
  await db.putMediaPending({ id: 'c-cut', sessionId: 's-v4', ts: 6, label: 'Cut short' });
  await db.putMediaPart('c-cut', 0, new Blob(['half a clip']));

  const before = await db.getMedia('c-done');
  const out = await run();
  const after = await db.getMedia('c-done');

  assert.ok(out.recovered >= 1, 'the interrupted clip is recovered');
  assert.equal(after.label, 'Checkout flow', 'the finished record is not relabelled "(recovered)"');
  assert.equal(after.durationMs, 4321, 'and keeps its duration');
  assert.equal(after.sha256, 'abc123', 'and its hash');
  assert.equal(after.incomplete, undefined, 'and is not marked incomplete');
  assert.equal(after.bytes, before.bytes);
  assert.equal(await after.blob.text(), 'the whole clip', 'byte-identical');
  assert.equal((await db.mediaParts('c-done')).length, 0, 'the leftover parts are cleared');
  assert.ok(!(await db.listMediaPending()).some((r) => r.id === 'c-done'), 'and so is the marker');
  assert.ok(!events.some((e) => e.mediaId === 'c-done'), 'no second recording event for the finished clip');
  assert.ok(events.some((e) => e.mediaId === 'c-cut'), 'the cut one still gets its event');
  assert.equal((await db.getMedia('c-cut')).label, 'Cut short (recovered)', 'a really interrupted clip is still recovered');
  console.log('  ok  r3-06-1: a clip assembled before the crash is kept as is (parts and marker cleared, no event); an interrupted one is still recovered (10 checks)');
}

/* ── r4-06-3: a failed replay seq seed is not cached ───────────────────── */
{
  for (let i = 0; i < 4; i++) await db.putReplayChunk({ sessionId: 's-seed', seq: i, entries: [{ i }] });
  const proto = IDBObjectStore.prototype; // r8-06-5: the seed is a reverse key cursor now, not a getAll
  const real = proto.openKeyCursor;
  let thrown = 0;
  proto.openKeyCursor = function (...args) {
    if (this.name === 'replay' && thrown === 0) { thrown++; throw new Error('read failed'); }
    return real.apply(this, args);
  };
  try {
    await assert.rejects(() => db.putReplayChunk({ sessionId: 's-seed', entries: [{ late: 1 }] }), /read failed/, 'the failed seed is reported');
  } finally { proto.openKeyCursor = real; }
  assert.equal((await db.replaySize('s-seed')).chunks, 4, 'chunks 0..3 are untouched by the failed call');
  await db.putReplayChunk({ sessionId: 's-seed', entries: [{ late: 2 }] });
  const got = await db.getReplay('s-seed');
  assert.equal((await db.replaySize('s-seed')).chunks, 5, 'the next call re-seeds from the store and appends chunk 4');
  assert.deepEqual(got.entries.slice(0, 4), [{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }], 'chunks 0..3 are intact');
  console.log('  ok  r4-06-3: a failed replay seq seed is retried, never cached as -1 (4 checks)');
}

/* ── r3-07-4: getEventsSince walks one session's index and stops at the seen seq ─ */
{
  for (let i = 0; i < 3; i++) {
    await db.appendEvents([{ sessionId: 'e-one', kind: 'note', ts: 10 + i, text: `one${i}` }]);
    await db.appendEvents([{ sessionId: 'e-two', kind: 'note', ts: 10 + i, text: `two${i}` }]);
  }
  const all = await db.getEvents('e-one');
  assert.equal(all.length, 3);
  const protoS = IDBObjectStore.prototype;
  const realAll = protoS.getAll;
  protoS.getAll = function (...a) { if (this.name === 'events') throw new Error('whole-store scan'); return realAll.apply(this, a); };
  let since;
  try { since = await db.getEventsSince('e-one', all[0].seq); } finally { protoS.getAll = realAll; }
  assert.deepEqual(since.map((e) => e.text), ['one1', 'one2'], 'only the newer events of this session, in order');
  assert.deepEqual((await db.getEventsSince('e-one', all[2].seq)).length, 0, 'nothing newer: empty');
  const two = await db.getEvents('e-two');
  assert.deepEqual((await db.getEventsSince('e-two', two[0].seq)).map((e) => e.text), ['two1', 'two2'], 'the other session has its own cursor');
  console.log('  ok  r3-07-4: getEventsSince reads only its own session (5 checks)');
}

/* ── r6-06-2: a v1 and a v3 profile upgrade to the current schema by opening ── */
for (const version of [1, 3]) {
  const sid = `s-v${version}`;
  await seedLegacy(indexedDB, version);
  const fresh = await import(`../core/db.js?legacy${version}`);
  assert.equal((await fresh.listSessions()).length, 1, `the v${version} session is listed after the upgrade`);
  assert.equal((await fresh.getEvents(sid)).length, LEGACY_EVENTS, `all v${version} events survive`);
  assert.equal(await fresh.countEvents(sid), LEGACY_EVENTS, 'the sessionId index count matches the rows');
  assert.equal(await fresh.countFailures(sid), LEGACY_FAILS, 'the bySessionFail index counts every failure, backfilled or kept');
  if (version >= 3) assert.equal((await fresh.listMedia(sid)).length, 1, 'the v3 clip row survives');
  await fresh.putReplayChunk({ sessionId: sid, seq: 0, entries: [{ t: 1 }] });
  assert.equal((await fresh.getReplay(sid)).entries.length, 1, 'the replay store takes a chunk');
  const raw = await new Promise((resolve, reject) => { const r = indexedDB.open('uqa'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try {
    assert.equal(raw.version, 5, 'the file is at the current version');
    const names = [...raw.objectStoreNames].sort();
    assert.deepEqual(names, ['captures', 'events', 'media', 'mediaParts', 'mediaPending', 'replay', 'sessions'], 'every store exists, including media and replay');
    const rows = await new Promise((resolve, reject) => {
      const tx = raw.transaction('events', 'readonly');
      const idx = [...tx.objectStore('events').indexNames].sort();
      const all = tx.objectStore('events').getAll();
      all.onsuccess = () => resolve({ idx, rows: all.result });
      all.onerror = () => reject(all.error);
    });
    assert.deepEqual(rows.idx, ['bySessionFail', 'bySessionTs', 'sessionId'], 'the events store has all three indexes');
    assert.equal(rows.rows.length, LEGACY_EVENTS);
    assert.ok(rows.rows.every((r) => r.fail === 0 || r.fail === 1), 'the fail flag is set on every row');
    assert.equal(rows.rows.filter((r) => r.fail === 1).length, LEGACY_FAILS, 'and set correctly');
  } finally { raw.close(); }
  console.log(`  ok  r6-06-2: v${version} to v5 upgrade keeps history, sets fail on every row, builds the bySessionFail index, adds media and replay (10 checks)`);
}

/* ── r7-06-2: a throw midway through a batch commits nothing ──────────── */
{
  const before = await db.countEvents('s-r7062');
  await assert.rejects(() => db.appendEvents([
    { sessionId: 's-r7062', ts: 1, seq: 1, kind: 'click' },
    { sessionId: 's-r7062', ts: 2, seq: 2, kind: 'click', bad() {} },
  ]), 'the function property cannot be cloned');
  assert.equal(before, 0);
  assert.equal(await db.countEvents('s-r7062'), 0, 'the good event before the bad one was not stored');
  console.log('  ok  r7-06-2: tx() aborts on a throw, a good + a bad event store 0 rows (3 checks)');
}

/* ── r10-07-3 / r10-06-2: kind cursor and the seed scan (2,000 rows: fake-indexeddb cursors are quadratic, 10k rows take 67 s) ── */
{
  const S = 's-r10k';
  const big = 'x'.repeat(9000);
  const rows = [];
  for (let i = 0; i < 2000; i++) {
    if (i % 100 === 0) rows.push({ sessionId: S, ts: 20000 - i, kind: 'viewport', runId: `r${i}`, phase: 'opened' }); // 20 viewport rows, ts descending so the sort has work to do
    else if (i % 5 === 0) rows.push({ sessionId: S, ts: i, kind: 'net', url: `/u${i}`, reqBody: big + i }); // 380 gzipped bodies
    else rows.push({ sessionId: S, ts: i, kind: 'note', text: `n${i}` });
  }
  for (let i = 0; i < rows.length; i += 500) await db.appendEvents(rows.slice(i, i + 500));
  assert.equal(await db.countEvents(S), 2000);
  const RealDS = globalThis.DecompressionStream;
  let inflated = 0;
  globalThis.DecompressionStream = class extends RealDS { constructor(...a) { super(...a); inflated++; } };
  try {
    const v = await db.getEventsByKind(S, ['viewport']);
    assert.equal(v.length, 20, 'only the viewport rows come back');
    assert.equal(inflated, 0, 'no body of the 380 net rows was inflated');
    assert.ok(v.every((e, i) => e.kind === 'viewport' && (i === 0 || v[i - 1].ts <= e.ts)), 'ts order is kept');
    const n = await db.getEventsByKind(S, ['net']);
    assert.equal(n.length, 380);
    assert.equal(inflated, 380, 'matching rows are inflated, one each');
    assert.ok(n.every((e) => typeof e.reqBody === 'string' && e.reqBody.length > 9000 && !e.bodyGz));
  } finally { globalThis.DecompressionStream = RealDS; }
  assert.equal((await db.getEventsByKind('nobody', ['viewport'])).length, 0);
  // seedStats: newest-first, bounded, gap codes de-duplicated, bytes counted
  await db.appendEvents([{ sessionId: S, ts: 30000, kind: 'note', tag: 'capture-gap', gap: 'body-cap', text: 'g' }, { sessionId: S, ts: 30001, kind: 'note', tag: 'capture-gap', gap: 'body-cap', text: 'g2' }]);
  const st = await db.seedStats(S);
  assert.deepEqual(st.gaps, ['body-cap']);
  assert.ok(st.bytes > 0 && st.bytes < 380 * 9000, 'the estimate counts compressed bodies, never more than the raw size');
  assert.deepEqual((await db.seedStats(S, 1)).gaps, ['body-cap'], 'the limit bounds the scan to the newest rows');
  assert.deepEqual((await db.seedStats(S, 1)).bytes, 0);
  assert.deepEqual(await db.seedStats('nobody'), { gaps: [], bytes: 0 });
  console.log('  ok  r10-07-3 / r10-06-2: getEventsByKind inflates only matching kinds in order; seedStats reads gap codes and bytes (11 checks)');
}

process.exit(0);
