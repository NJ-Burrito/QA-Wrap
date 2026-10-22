/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * OF-5 (06-8): chunk numbers stay unique and contiguous per session across 1000 chunks,
 * and the per-session seq map stays bounded across many sessions.
 *
 *   node tools/test-of-a-replayseq.mjs
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import * as db from '../core/db.js';

await Promise.all(Array.from({ length: 1000 }, async () => {
  await db.putReplayChunk({ sessionId: 's-seq', entries: [{ t: 1 }] });
}));
const rows = await db.getReplay('s-seq');
assert.equal(rows.entries.length, 1000, '1000 chunks stored, none overwritten');
assert.equal((await db.replaySize('s-seq')).chunks, 1000, 'seq 0..999, one row each');
assert.ok(db.replaySeqCount() <= db.REPLAY_SEQ_MAX, 'one session: map is small');
console.log('  ok  OF-5: 1000 concurrent chunks get 1000 distinct seqs');

for (let i = 0; i < 300; i++) await db.putReplayChunk({ sessionId: `s-many-${i}`, entries: [{ t: i }] });
assert.ok(db.replaySeqCount() <= db.REPLAY_SEQ_MAX + 1, `map bounded after 300 sessions: ${db.replaySeqCount()}`);
// a pruned session is re-seeded from the store, never restarted at 0
await db.putReplayChunk({ sessionId: 's-many-0', entries: [{ t: 'again' }] });
assert.equal((await db.replaySize('s-many-0')).chunks, 2, 'a pruned session continues after its stored chunks');
assert.equal((await db.replaySize('s-seq')).chunks, 1000);
console.log('  ok  OF-5: the map stays bounded and a pruned session re-seeds (3 checks)');
