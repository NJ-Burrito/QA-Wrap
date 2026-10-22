/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R4 (REQ-P1-4, draft half): typed text survives a closed popup.
 *
 *   node tools/test-draft-and-cap.mjs
 *
 * Plain Node with a fake `chrome.storage.session` area. Two halves, both enforced:
 *   - the draft half (REQ-P1-4): typed text survives a closed popup, masked;
 *   - the cap half (REQ-P2-1): the real write queue admits tester-authored rows (a note, a screenshot) at the row cap and under
 *     queue pressure, keyed on the worker-built kind only (a forged note from a page is refused), and reports the cap once
 *     (the worker rolls the session to "part 2" from that call).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, finish } from './lib-assert.mjs';
import { DRAFT_KEY, capBytes, createDraft } from '../popup/draft.js';
import { createWriteQueue, isTesterRow, TESTER_ALLOW } from '../background/write-queue.js';
import { workerSrc } from './lib-worker-src.mjs';

const fakeArea = () => {
  const m = {};
  return {
    m,
    get: async (k) => (k in m ? { [k]: structuredClone(m[k]) } : {}),
    set: async (o) => { Object.assign(m, structuredClone(o)); },
    remove: async (k) => { delete m[k]; },
  };
};
const D = 5; // short debounce for the test; the shipped default is 400
const bytes = (s) => new TextEncoder().encode(s).length;

// 1. type, "close", reopen in the same session: text is back, stored value masked
const area = fakeArea();
let d = createDraft({ area, delay: D });
assert.equal(await d.restore('s1'), null, 'nothing to restore at first');
await d.save('Submit fails when password=hunter2 is typed');
const rec = area.m[DRAFT_KEY];
assert.ok(rec, 'draft written to the session area');
assert.equal(rec.sessionId, 's1');
assert.ok(!JSON.stringify(rec).includes('hunter2'), 'stored value is masked');
assert.ok(rec.note.includes('Submit fails'), 'rest of the text kept');
assert.ok(rec.ts > 0);
d = createDraft({ area, delay: D }); // the popup was reopened
const back = await d.restore('s1');
assert.ok(back?.note.includes('Submit fails'), 'text is back after reopening');
assert.ok(!back.note.includes('hunter2'));

// 2. debounce: five quick keystrokes make one write, the last text
let writes = 0;
const counting = fakeArea();
const realSet = counting.set;
counting.set = async (o) => { writes++; return realSet(o); };
const d2 = createDraft({ area: counting, delay: 30 });
await d2.restore('s2');
const ps = ['a', 'ab', 'abc', 'abcd', 'abcde'].map((t) => d2.save(t));
assert.equal(writes, 0, 'nothing written before the debounce elapses');
assert.deepEqual(await Promise.all(ps), [true, true, true, true, true]);
assert.equal(writes, 1, 'one write for five keystrokes');
assert.equal(counting.m[DRAFT_KEY].note, 'abcde');

// 3. charter is its own field, both kept in one record
await d2.save('Checkout charter', 'charter');
assert.equal(counting.m[DRAFT_KEY].note, 'abcde');
assert.equal(counting.m[DRAFT_KEY].charter, 'Checkout charter');
assert.equal(await d2.save('x', 'bogus'), false, 'unknown field refused');

// 4. cap 2 KB per field, by bytes (Arabic is two bytes a letter)
const big = createDraft({ area, delay: D });
await big.restore('s1');
await big.save('x'.repeat(5000));
assert.ok(bytes(area.m[DRAFT_KEY].note) <= 2048, 'latin text capped at 2 KB');
await big.save('ب'.repeat(5000));
const ar = area.m[DRAFT_KEY].note;
assert.ok(bytes(ar) <= 2048, 'arabic text capped at 2 KB in bytes');
assert.ok(ar.length >= 1000, 'arabic keeps as much as fits');
assert.equal(capBytes('\u{1F600}'.repeat(10), 9), '\u{1F600}\u{1F600}', 'a surrogate pair is never split');
assert.equal(capBytes('abc', 2048), 'abc');

// 5. a draft of another session is not shown, and is dropped
const other = createDraft({ area, delay: D });
assert.equal(await other.restore('s-other'), null);
assert.equal(area.m[DRAFT_KEY], undefined, 'a stale session draft is removed');

// 6. clear() on send removes the key, and a pending write cannot bring it back
const area3 = fakeArea();
const d3 = createDraft({ area: area3, delay: 20 });
await d3.restore('s3');
const pending = d3.save('half typed');
await d3.clear();
assert.equal(await pending, false);
await new Promise((r) => setTimeout(r, 60));
assert.equal(area3.m[DRAFT_KEY], undefined, 'cleared draft stays cleared');
assert.equal(await createDraft({ area: area3 }).restore('s3'), null);

// 7. empty text removes the key (no empty record lingers)
await d3.save('word');
assert.ok(area3.m[DRAFT_KEY]);
await d3.save('');
assert.equal(area3.m[DRAFT_KEY], undefined);

// 8. flush() writes at once (popup pagehide)
const d4 = createDraft({ area: area3, delay: 10_000 });
await d4.restore('s3');
d4.save('typed just before closing');
assert.equal(await d4.flush(), true);
assert.ok(area3.m[DRAFT_KEY].note.includes('just before closing'));
await d4.clear();

// 9. a masker that throws stores nothing (fail closed), and the injected masker is used
const area5 = fakeArea();
const bad = createDraft({ area: area5, delay: D, mask: () => { throw new Error('boom'); } });
await bad.restore('s5');
assert.equal(await bad.save('secret thing'), false);
assert.equal(area5.m[DRAFT_KEY], undefined, 'nothing stored when the masker fails');
const upper = createDraft({ area: area5, delay: D, mask: (t) => t.toUpperCase() });
await upper.restore('s5');
await upper.save('abc');
assert.equal(area5.m[DRAFT_KEY].note, 'ABC');

// 10. no storage at all (a context without chrome.storage.session) is a quiet no-op
const none = createDraft({ delay: D });
assert.equal(await none.restore('s'), null);
assert.equal(await none.save('x'), false);

console.log('draft half passed');

// ---- cap half (REQ-P2-1) ----
const queue = (opts = {}) => {
  const stored = [];
  const caps = [];
  const q = createWriteQueue({ write: async (b) => { stored.push(...b); return b; }, schedule: () => 0, cancel: () => {}, estimate: null, onCap: (id) => caps.push(id), onError: () => {}, ...opts });
  return { q, stored, caps };
};
const telemetry = (i) => ({ sessionId: 'c1', kind: 'click', ts: i, text: `t${i}` });
const noteOf = (i) => ({ sessionId: 'c1', kind: 'note', tag: 'bug', ts: i, text: `note ${i}` });
const verdict = (p, yes, no) => p.then(() => yes, () => no);

// 11. rowCap + 100 telemetry events with 20 tester rows mixed in: all 20 stored, the telemetry past the cap refused, ONE gap row, onCap once
{
  const { q, stored, caps } = queue({ rowCap: 200 });
  const out = [];
  for (let i = 0; i < 300; i++) {
    out.push(verdict(q.push(telemetry(i)), 'ok', 'refused'));
    if (i % 15 === 0 && i >= 150) out.push(verdict(q.pushTester(noteOf(i)), 'tester', 'tester-refused'));
  }
  for (let i = 0; i < 10; i++) out.push(verdict(q.pushTester({ ...noteOf(1000 + i), kind: i % 2 ? 'screenshot' : 'note' }), 'tester', 'tester-refused'));
  await q.flush();
  const res = await Promise.all(out);
  assert.equal(res.filter((r) => r === 'tester-refused').length, 0, 'no tester row is refused at the cap');
  assert.equal(res.filter((r) => r === 'tester').length, 20, '20 tester rows were pushed');
  const testerStored = stored.filter((e) => e.kind === 'screenshot' || (e.kind === 'note' && e.tag === 'bug'));
  assert.equal(testerStored.length, 20, 'all 20 tester rows are stored');
  const clicks = stored.filter((e) => e.kind === 'click').length;
  assert.ok(clicks > 150 && clicks < 200, 'telemetry stops before the row cap because tester rows count toward it (' + clicks + ')');
  assert.equal(stored.filter((e) => e.tag === 'capture-gap' && e.gap === 'session-cap').length, 1, 'exactly one capture-gap row');
  assert.deepEqual(caps, ['c1'], 'onCap fires once per session');
}

// 12. a forged note from a page never gets the bypass: push() (the ingest path) refuses at the cap, whatever the event carries
{
  const { q, stored } = queue({ rowCap: 3 });
  for (let i = 0; i < 3; i++) q.push(telemetry(i));
  await q.flush();
  const forged = [
    { ...noteOf(1), tester: true, priority: true },
    { sessionId: 'c1', kind: 'screenshot', ts: 5, auto: true },
    noteOf(2),
  ];
  for (const f of forged) assert.equal(await verdict(q.push(f), 'stored', 'refused'), 'refused', `page-sourced ${f.kind} is refused at the cap`);
  assert.equal(await verdict(q.push(noteOf(3), 'yes'), 'stored', 'refused'), 'refused', 'only a literal true from the worker counts');
  assert.equal(await verdict(q.pushTester(telemetry(9)), 'stored', 'refused'), 'refused', 'pushTester on a non-tester kind (a click) is refused at the cap');
  assert.equal(await verdict(q.pushTester({ sessionId: 'c1', kind: 'note', tag: 'capture-gap', ts: 1, text: 'machine' }), 'stored', 'refused'), 'refused', 'a machine note (capture-gap) is not tester-authored');
  await q.flush();
  assert.equal(stored.filter((e) => /^note \d$/.test(e.text || '')).length, 0, 'no forged note was stored');
  assert.ok(isTesterRow({ kind: 'note', tag: 'bug' }) && isTesterRow({ kind: 'screenshot' }) && !isTesterRow({ kind: 'click' }) && !isTesterRow({ kind: 'note', tag: 'dropped' }));
}

// 13. queue pressure: with a stalled store and a tiny maxPending, telemetry is shed and tester rows are not
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const stored = [];
  const q = createWriteQueue({ write: async (b) => { await gate; stored.push(...b); return b; }, schedule: () => 0, cancel: () => {}, estimate: null, maxPending: 10, maxBatch: 1000, onError: () => {} });
  const out = [];
  for (let i = 0; i < 40; i++) out.push(verdict(q.push(telemetry(i)), 'ok', 'shed'));
  for (let i = 0; i < 5; i++) out.push(verdict(q.pushTester(noteOf(i)), 'tester', 'tester-shed'));
  const flushed = q.flush();
  release();
  await flushed;
  const res = await Promise.all(out);
  assert.equal(res.filter((r) => r === 'shed').length, 30, 'telemetry past maxPending is shed (the pressure is real)');
  assert.equal(res.filter((r) => r === 'tester').length, 5, 'all 5 tester rows survive the pressure');
  assert.equal(stored.filter((e) => e.kind === 'note').length, 5);
}

// 14. the tester allowance is bounded: past TESTER_ALLOW over the cap, even tester rows are refused
{
  const { q, stored } = queue({ rowCap: 1 });
  q.push(telemetry(0));
  await q.flush();
  const out = [];
  for (let i = 0; i < TESTER_ALLOW + 3; i++) out.push(verdict(q.pushTester(noteOf(i)), 1, 0));
  await q.flush();
  const got = (await Promise.all(out)).reduce((a, b) => a + b, 0);
  assert.equal(got, TESTER_ALLOW, 'exactly the allowance is admitted past the cap');
  assert.equal(stored.filter((e) => e.kind === 'note' && e.tag === 'bug').length, TESTER_ALLOW);
}

// 15. the worker wiring: tester rows reach the queue through pushTester only from appendEvent; page ingest never passes the flag
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sw = workerSrc();
  assert.ok(/isTesterRow\(event\)\) return appendEventNow\(event\)/.test(sw), 'appendEvent writes machine rows directly');
  assert.ok(/writeQueue\.pushTester\(event\), flushEvents\(\)/.test(sw), 'a tester row is queued past the cap and flushed before the answer');
  assert.ok(!/writeQueue\.push\([^)]*,\s*true\)/.test(sw), 'no ingest path passes the tester flag');
  assert.ok(/onCap:[^\n]*remember\.rollPart/.test(sw), 'the cap rolls the recording to the next part');
}
console.log('cap half passed');
finish('test-draft-and-cap');
