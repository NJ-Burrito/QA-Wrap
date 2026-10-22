/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Unit tests for core/sessions.js — closing the sessions a crash left open.
 *
 *   node tools/test-sessions.mjs
 *
 * This is the half of the recovery that can be tested at all. Producing the
 * situation for real means killing Chrome mid-session, which no suite can do,
 * so the decision was split out of the worker as a pure function precisely so
 * that the decision — not the storage round trip — is the thing under test.
 *
 * No Chrome, no IndexedDB: node:assert and plain objects.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  reconcile, PURGEABLE_STATUS, ERASABLE_STORES, eraseKeys, sessionFootprint, describeFootprint,
  describePersistence, countFindings, foldFinding, findingTotals, carriesFinding,
  BLANK_FINDINGS, describeFindings,
} from '../core/sessions.js';
import { REGISTRY } from '../core/store-registry.js';
import { workerSrc } from './lib-worker-src.mjs';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const T0 = 1_757_000_000_000;
const stranded = (over = {}) => ({
  id: 's1', seq: 1, charter: 'Apply for a permit',
  startedAt: T0, endedAt: null, status: 'recording',
  tabId: 4, windowId: 2, startUrl: 'https://example.test/', keep: false,
  ...over,
});

console.log('\nsessions.js — reconcile()');

test('a stranded session is closed at its last event', () => {
  const [out] = reconcile([stranded()], { s1: T0 + 90_000 }, null);
  assert.equal(out.endedAt, T0 + 90_000);
  assert.equal(out.status, 'interrupted');
});

test('D-211: a session that started after the worker did (bornBefore) is live, not stranded; an older one still closes', () => {
  assert.deepEqual(reconcile([stranded()], {}, null, T0 - 1), []);
  assert.equal(reconcile([stranded()], {}, null, T0).length, 1);
  assert.equal(reconcile([stranded({ id: 'n', startedAt: T0 + 10 }), stranded()], {}, null, T0 + 5).map((x) => x.id).join(), 's1');
  assert.ok(workerSrc().includes('Date.now() - performance.now() - 5000'));
});

test('a stranded session with no events ends where it started', () => {
  const [out] = reconcile([stranded()], {}, null);
  assert.equal(out.endedAt, T0);
  assert.equal(out.status, 'interrupted');
});

test('the four unknowable counts are null, never zero', () => {
  // Zero reads as "a clean session"; null reads as "nobody knows", which is the
  // truth. `stopSession()` computes all four from state the crash destroyed.
  const [out] = reconcile([stranded({ masked: 3, cookies: [{ name: 'a' }], rulesFired: 2, toolsUsed: ['pick'] })], {}, null);
  assert.equal(out.masked, null);
  assert.equal(out.cookies, null);
  assert.equal(out.rulesFired, null);
  assert.equal(out.toolsUsed, null);
});

test('the session recording right now is left alone', () => {
  assert.deepEqual(reconcile([stranded()], { s1: T0 + 10 }, 's1'), []);
});

test('r7-06-1: two windows recording, both ids (array or Set) are left alone, a third is closed', () => {
  const list = [stranded({ id: 'a' }), stranded({ id: 'b' }), stranded({ id: 'c' })];
  assert.deepEqual(reconcile(list, {}, ['a', 'b']).map((x) => x.id), ['c']);
  assert.deepEqual(reconcile(list, {}, new Set(['a', 'b'])).map((x) => x.id), ['c']);
  assert.deepEqual(reconcile(list, {}, 'a').map((x) => x.id), ['b', 'c']);
  assert.deepEqual(reconcile(list, {}, []).map((x) => x.id), ['a', 'b', 'c']);
});

test('a stopped session is untouched, and so is one that already has an end', () => {
  const stopped = stranded({ id: 's2', status: 'stopped', endedAt: T0 + 5 });
  const halfWritten = stranded({ id: 's3', endedAt: T0 + 5 });
  assert.deepEqual(reconcile([stopped, halfWritten], {}, null), []);
});

test('every other field survives, and the input is not mutated', () => {
  const input = stranded();
  const [out] = reconcile([input], { s1: T0 + 1 }, null);
  assert.equal(out.charter, 'Apply for a permit');
  assert.equal(out.startUrl, 'https://example.test/');
  assert.equal(out.windowId, 2);
  assert.equal(input.status, 'recording', 'the stored record was mutated in place');
  assert.equal(input.endedAt, null, 'the stored record was mutated in place');
});

test('a Map of timestamps works as well as an object', () => {
  const [out] = reconcile([stranded()], new Map([['s1', T0 + 42]]), null);
  assert.equal(out.endedAt, T0 + 42);
});

test('an event timestamp before the start does not invent a negative duration', () => {
  // Clock skew across a suspend/resume is real, and an endedAt earlier than
  // startedAt makes every duration in the report negative.
  const [out] = reconcile([stranded()], { s1: T0 - 60_000 }, null);
  assert.equal(out.endedAt, T0);
});

test('a rubbish timestamp falls back to the start rather than to NaN', () => {
  for (const bad of [null, undefined, 'yesterday', NaN, 0]) {
    const [out] = reconcile([stranded()], { s1: bad }, null);
    assert.equal(out.endedAt, T0, `${String(bad)} did not fall back`);
  }
});

test('several stranded sessions are all closed, in one pass', () => {
  const rows = [stranded(), stranded({ id: 's2', startedAt: T0 + 1000 }), stranded({ id: 's3', status: 'stopped', endedAt: T0 })];
  const out = reconcile(rows, { s1: T0 + 5, s2: T0 + 2000 }, null);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => s.id), ['s1', 's2']);
});

test('nothing at all is not an error', () => {
  assert.deepEqual(reconcile(undefined, undefined, undefined), []);
  assert.deepEqual(reconcile([null, undefined], {}, null), []);
});

console.log('\nsessions.js — what retention may delete');

test('interrupted is purgeable; recording is not', () => {
  // The whole point: a crashed session used to be exempt from the 30-day purge
  // for ever, while PRIVACY.md promised it would go.
  assert.ok(PURGEABLE_STATUS.has('interrupted'));
  assert.ok(PURGEABLE_STATUS.has('stopped'));
  assert.ok(!PURGEABLE_STATUS.has('recording'));
});

/* ── erasing ───────────────────────────────────────────────────────────── */

test('every store a session can leave bytes in is on the erase list', () => {
  /*
   * "Delete everything" goes wrong in exactly one way: the store nobody
   * remembered, still holding a recording after the tester has been told the
   * machine is clean. `mediaParts` and `mediaPending` are the two that were
   * missing from the first draft of this — a clip is written in parts, and a
   * clip interrupted mid-write leaves a pending row behind.
   */
  for (const store of ['sessions', 'events', 'captures', 'media', 'mediaParts', 'mediaPending']) {
    assert.ok(ERASABLE_STORES.includes(store), `${store} would survive an erase`);
  }
  assert.ok(Object.isFrozen(ERASABLE_STORES), 'the list can be edited by accident');
});

test('the keys outside IndexedDB are erased with the sessions they belong to', () => {
  const keys = eraseKeys(['s1', 's2']);
  assert.ok(keys.includes('masks:s1') && keys.includes('masks:s2'), 'a mask list would outlive its session');
  assert.ok(keys.includes('lastSessionId'), 'the popup would still offer a deleted session');
  // The expected count comes from the registry: its session rows (not the masks: prefix row) plus one masks:<id> per session.
  const sessionRows = REGISTRY.filter((r) => r.kind === 'session' && !r.prefix && r.erasedBy === 'eraseAll'); // r2-03-3: transient rows are left to closing the browser
  for (const k of ['uqa.secHeaders.windows', 'uqa.secHeaders.seen']) {
    assert.ok(keys.includes(k), `${k} would outlive an erase`);
  }
  assert.ok(keys.includes('sessionState:s1') && keys.includes('suiteDraft') && keys.includes('qawReporterShot'), 'r2-03-3: state, draft and shot must go');
  assert.ok(!keys.includes('activeSessionId') && !keys.includes('armedWindows'), 'a runtime pointer is not erased');
  assert.equal(keys.length, sessionRows.length + 4, `${keys.join(', ')} sweeps up more than it should`);
  assert.equal(eraseKeys([]).length, sessionRows.length, 'with no sessions only the registry session rows remain');
});

test('the footprint counts what Settings offers to clear', () => {
  const fp = sessionFootprint(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    [{ bytes: 12 * 1024 * 1024 }, { bytes: 4 * 1024 * 1024 }, { bytes: 0 }, { bytes: undefined }],
  );
  assert.equal(fp.sessions, 3);
  assert.equal(fp.media, 4);
  assert.equal(fp.mb, 16, 'the megabytes are what the tester is deciding about');
  assert.equal(sessionFootprint([{ id: 'a' }], []).sessions, 1, 'a session with no media is still a session');
  assert.ok(Number.isFinite(sessionFootprint([], [{ bytes: undefined }]).bytes), 'a missing size must not be NaN');
  assert.equal(describeFootprint(sessionFootprint([], [])), 'No sessions on this machine yet.');
  assert.equal(describeFootprint(fp), 'Sessions on this machine: 3, 16 MB.');
});


/* ── how many findings a session holds ──────────────────────────────────── */

console.log('\nsessions.js — countFindings()');

const F0 = 1_757_100_000_000;
const site = 'https://portal.test/apply';
const inner = 'https://widget.other/pay';

/*
 * One session, and every kind of thing a tester can find in it. The numbers are
 * the ones from the earlier site run in research/58, because that is the run whose
 * report opened with "0 problems found".
 */
const walked = [
  { kind: 'nav', url: site, ts: F0, frameUrl: site },
  { kind: 'dom', action: 'click', ts: F0 + 100, frameUrl: site },
  { kind: 'net', url: 'https://beacon.ads-co.test/t', status: 503, ts: F0 + 200, frameUrl: site },
  { kind: 'net', url: 'https://portal.test/api/save', status: 500, ts: F0 + 300, frameUrl: site },
  { kind: 'console', level: 'error', text: 'boom', ts: F0 + 400, frameUrl: site },
  { kind: 'a11y', total: 83, ts: F0 + 500, frameUrl: site },
  { kind: 'links', broken: [{ href: 'a' }, { href: 'b' }], ts: F0 + 600, frameUrl: site },
  { kind: 'rtl', enabled: true, overflowCount: 2, ts: F0 + 700, frameUrl: site },
  { kind: 'rtl', enabled: true, overflowCount: 2, ts: F0 + 800, frameUrl: inner },
  { kind: 'fineprint', counts: { gaps: 5, declared: 13, manual: 18 }, ts: F0 + 900, frameUrl: site },
];

test('a scan, a link check, layout stress and the fine print all count', () => {
  const t = countFindings(walked, { session: { startUrl: site } });
  assert.equal(t.a11y, 83);
  assert.equal(t.links, 2, 'broken links only; redirected and slow are not defects');
  assert.equal(t.rtl, 4, 'two frames, two clipped elements each');
  assert.equal(t.finePrint, 5, 'the gaps, not the twenty-two checks and not the questions');
  assert.equal(t.failures, 2, 'the 500 and the console error; the advertiser is not this site');
  assert.equal(t.thirdParty, 1);
  assert.deepEqual(t.theirHosts, ['beacon.ads-co.test']);
  assert.equal(t.total, 96, '83 + 2 + 4 + 5 + 2, and the advertiser is not in it');
});

test('the headline is not zero when a tool found something', () => {
  // The exact shape of research/58: no failing request at all, and four tools
  // that each found something. This is the assertion that would have caught it.
  const quiet = walked.filter((e) => e.kind !== 'net' && e.kind !== 'console');
  const t = countFindings(quiet, { session: { startUrl: site } });
  assert.equal(t.failures, 0);
  assert.ok(t.total > 0, 'a session with 83 violations and 5 gaps must not read as clean');
  assert.equal(t.total, 94);
});

test('running a scan twice does not double its findings', () => {
  const twice = [...walked, { kind: 'a11y', total: 12, ts: F0 + 1000, frameUrl: site }];
  assert.equal(countFindings(twice, { session: { startUrl: site } }).a11y, 12,
    'the latest scan replaces the previous one; it does not add to it');
});

test('turning layout stress off clears that frame and leaves the others', () => {
  const off = [...walked, { kind: 'rtl', enabled: false, overflowCount: 0, ts: F0 + 1100, frameUrl: site }];
  assert.equal(countFindings(off, { session: { startUrl: site } }).rtl, 2, 'the iframe is still clipped');
});

test('a host visited after its request failed is the site, not a third party', () => {
  // Order matters here and it is why the split happens when the tally is read
  // rather than when it is folded.
  const late = [
    { kind: 'net', url: 'https://api.portal.test/x', status: 500, ts: F0, frameUrl: null },
    { kind: 'nav', url: 'https://portal.test/', ts: F0 + 10, frameUrl: 'https://portal.test/' },
  ];
  const t = countFindings(late);
  assert.equal(t.failures, 1, 'api.portal.test is not third party to portal.test');
  assert.equal(t.thirdParty, 0);
});

test('the running tally and the whole-session fold give the same answer', () => {
  /*
   * The worker advances the tally one event at a time so the popup's ticker
   * costs nothing; the report folds the whole session at once. Two routes to one
   * number is the shape that drifts, so it is asserted rather than assumed.
   */
  let tally = foldFinding(BLANK_FINDINGS, { kind: 'nav', url: site, ts: F0 });
  for (const e of walked) tally = foldFinding(tally, e);
  assert.deepEqual(findingTotals(tally), countFindings(walked, { session: { startUrl: site } }));
});

test('only the events that can move the number touch the tally', () => {
  assert.equal(carriesFinding({ kind: 'dom', action: 'click' }), false);
  assert.equal(carriesFinding({ kind: 'screenshot' }), false);
  assert.equal(carriesFinding({ kind: 'nav', url: site }), true);
  assert.equal(carriesFinding({ kind: 'a11y', total: 0 }), true);
  assert.equal(carriesFinding({ kind: 'net', status: 500 }), true);
  assert.equal(carriesFinding({ kind: 'net', status: 200 }), false);
  assert.equal(carriesFinding(null), false);
  // And the gate is the same one countFindings applies, or the two would see
  // different events and collect different hosts.
  const ignored = walked.filter((e) => !carriesFinding(e));
  assert.deepEqual(
    countFindings(walked.filter(carriesFinding), { session: { startUrl: site } }),
    countFindings(walked, { session: { startUrl: site } }),
    `dropping ${ignored.length} event(s) the tally ignores must not change the answer`
  );
});

test('an empty session says so rather than printing a bare zero', () => {
  assert.match(describeFindings(countFindings([])), /^Nothing was found\./);
  assert.equal(describeFindings({ failures: 1, a11y: 0, links: 0, rtl: 0, finePrint: 0 }),
    '1 failed request or error.');
  assert.ok(!describeFindings(countFindings(walked, { session: { startUrl: site } })).includes('\u2014'),
    'no em dash in a string a tester reads');
});

console.log('\nsessions.js — will the browser keep any of it');

test('the footprint line says whether the data is safe from eviction', () => {
  assert.equal(describePersistence(null), '');
  assert.match(describePersistence({ supported: true, persisted: true, asked: true }), /agreed to keep them/);
  assert.match(describePersistence({ supported: true, persisted: false, asked: true }), /would not promise/);
  assert.match(describePersistence({ supported: true, persisted: false, asked: false }), /has not been asked/);
  assert.match(describePersistence({ supported: false, persisted: false, asked: false }), /cannot promise/);
  for (const p of [
    { supported: true, persisted: true, asked: true },
    { supported: true, persisted: false, asked: true },
    { supported: true, persisted: false, asked: false },
    { supported: false, persisted: false, asked: false },
  ]) {
    assert.ok(!describePersistence(p).includes('\u2014'), 'no em dash in a string a tester reads');
  }
  const withGrant = describeFootprint({ ...sessionFootprint([{ id: 'a' }], []), persistence: { supported: true, persisted: true, asked: true } });
  assert.match(withGrant, /^Sessions on this machine: 1, 0 MB\. The browser has agreed/);
  assert.equal(describeFootprint(sessionFootprint([], [])), 'No sessions on this machine yet.',
    'a footprint with no persistence answer reads exactly as it always did');
});


// Next-review T-054 pair gap: the footprint line speaks Arabic when the surface passes its t().
{
  const fs = await import('node:fs');
  const ar = JSON.parse(fs.readFileSync(new URL('../platform/i18n/ar.json', import.meta.url), 'utf8'));
  const tr = (k, v = {}) => (ar[k] || k).replace(/\{(\w+)\}/g, (_, x) => v[x]);
  const line = describeFootprint({ ...sessionFootprint([{ id: 'a', startedAt: 1e12 }], []), totalBytes: 5 * 1048576, quotaWarn: true, persistence: { supported: true, persisted: true, asked: true } }, tr);
  assert.ok(!/[A-Za-z]{4,}/.test(line.replace(/QA Wrap/g, '')), `Latin words left in the Arabic footprint line: ${line}`);
  assert.match(line, /الجلسات على هذا الجهاز: 1/);
}
// r2-01-3 / r2-06-4: the lost count and the raw start URL survive a worker restart (memory cleared, storage kept).
{
  const name = 'r2-01-3: captureLost, unconfirmed and rawStartUrl are read back from chrome.storage.session after a simulated restart';
  try {
    const store = {};
    globalThis.chrome = { storage: { session: {
      get: async (k) => (k == null ? { ...store } : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]]))),
      set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
      remove: async (k) => { for (const x of [].concat(k)) delete store[x]; },
    } } };
    const fs = await import('node:fs');
    const { lift } = await import('./lib-lift.mjs');
    const worker1 = await import('../background/session-state.js?worker1');
    await worker1.resetFor('s1');
    await worker1.setState('s1', { rawStartUrl: 'https://example.test/pay?token=raw' });
    const src = workerSrc();
    const mk = (sessionState) => {
      const captureLost = new Map(); const notes = [];
      const run = new Function('sessionState', 'captureLost', 'appendEvents', 'console', `${lift(src, 'noteCaptureGap')}; return noteCaptureGap;`)(sessionState, captureLost, async (b) => { notes.push(...b); }, { warn() {} });
      return { run, captureLost, notes };
    };
    const w1 = mk(worker1);
    w1.run(new Error('quota'), [{ sessionId: 's1' }, { sessionId: 's1' }]);
    w1.run(Object.assign(new Error('slow'), { code: 'SLOW', unconfirmed: true }), [{ sessionId: 's1' }]);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(w1.captureLost.get('s1'), 2);
    // the restart: a fresh module instance and an empty in-memory map, the same storage
    const worker2 = await import('../background/session-state.js?worker2');
    const state = await worker2.getState('s1');
    assert.equal(state.captureLost, 2, 'the loss count survived');
    assert.equal(state.unconfirmed, 1, 'a timed-out write is counted apart from lost');
    assert.equal(state.rawStartUrl, 'https://example.test/pay?token=raw');
    const w2 = mk(worker2);
    w2.run(new Error('quota'), [{ sessionId: 's1' }]);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(w2.captureLost.get('s1'), 3, 'counting continues from the persisted total, not from zero');
    assert.ok(w1.notes.some((n) => n.unconfirmed === 1 && /could not be confirmed/.test(n.text)) && w1.notes.some((n) => n.lost === 2));
    await worker2.clearState('s1');
    await worker2.addLost('s1', 5, false);
    assert.equal(Object.keys(store).filter((k) => k.startsWith('sessionState:')).length, 0, 'a stopped session gets no record back');
    assert.match(src, /state\.rawStartUrl\) rawStartUrl\.set\(id, state\.rawStartUrl\)/, 'the end-of-session cookie read restores the raw URL');
    assert.match(src, /captureLost: captureLost\.get\(id\) \|\| state\.captureLost/, 'UQA_GET_STATE reads the persisted count');
    passed++; console.log(`  ok  ${name}`);
  } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
// D-1010-107 / r5-06-6: consumeRule, noteUse, addRule and removeRule read inside the update chain, so overlapping calls do not lose a write.
{
  const name = 'D-1010-107: concurrent consumeRule, noteUse, addRule and removeRule calls lose no update; a forged rule id writes nothing';
  try {
    const store = {}; let sets = 0;
    globalThis.chrome = { storage: { session: {
      get: async (k) => { await new Promise((r) => setTimeout(r, 2)); return Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]])); },
      set: async (o) => { sets++; Object.assign(store, JSON.parse(JSON.stringify(o))); },
      remove: async (k) => { for (const x of [].concat(k)) delete store[x]; },
    } } };
    const st = await import('../background/session-state.js?concurrent');
    await st.resetFor('c1');
    await st.replaceRules('c1', [{ id: 'a', remaining: 2 }]);
    await Promise.all([st.consumeRule('c1', 'a'), st.consumeRule('c1', 'a')]);
    const state = await st.getState('c1');
    assert.equal(state.rules[0].remaining, 0, 'both consumptions counted');
    assert.equal(state.fired.a, 2);
    await Promise.all([st.noteUse('c1', 'shot'), st.noteUse('c1', 'shot'), st.noteUse('c1', 'shot')]);
    assert.equal((await st.getUsed('c1')).shot.count, 3, 'three overlapping noteUse calls');
    await Promise.all([st.addRule('c1', { id: 'b' }), st.addRule('c1', { id: 'c' })]);
    assert.deepEqual((await st.getRules('c1')).map((r) => r.id).sort(), ['a', 'b', 'c'], 'both added rules survive');
    await Promise.all([st.removeRule('c1', 'b'), st.removeRule('c1', 'c')]);
    assert.deepEqual((await st.getRules('c1')).map((r) => r.id), ['a']);
    const before = sets;
    assert.equal(await st.consumeRule('c1', 'forged'), null);
    assert.equal(sets, before, 'a forged id writes nothing');
    passed++; console.log(`  ok  ${name}`);
  } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
/* 1015 lane P3: a Stop that arrives mid-Start waits for it; one Opera predicate for the worker, Settings and the popup. */
{
  const name = 'start/stop lock: Stop waits for an in-flight Start, a failed Start does not wedge it, the Start body is not locked against itself';
  try {
    const { startStopLock } = await import('../core/sessions.js');
    const log = [];
    const lock = startStopLock();
    const slow = lock.start(async () => { log.push('start:begin'); await new Promise((r) => setTimeout(r, 15)); log.push('start:end'); return 'S'; });
    const stop = lock.settled().then(() => log.push('stop'));
    assert.equal(await slow, 'S');
    await stop;
    assert.deepEqual(log, ['start:begin', 'start:end', 'stop'], 'the Stop ran after the Start finished');
    const bad = lock.start(async () => { throw new Error('asleep'); });
    await assert.rejects(bad, /asleep/);
    await Promise.race([lock.settled(), new Promise((_, no) => setTimeout(() => no(new Error('deadlock')), 200))]);
    const src = fs.readFileSync(new URL('../background/worker-session.js', import.meta.url), 'utf8');
    assert.match(src, /await runStop\(here\)/, 'the Start body calls the unlocked stop (else it waits for itself)');
    assert.match(src, /export const stopSession = async[^\n]*await lock\.settled\(\)/, 'the exported stop waits on the lock');
    assert.match(src, /export const startSession = [^\n]*lock\.start\(/, 'the exported start goes through the lock');
    passed++; console.log(`  ok  ${name}`);
  } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
{
  const name = 'Opera: the module predicate refuses the side panel in Opera and keeps it in Chrome/Edge; the popup copy has the same two tests';
  try {
    const { hasSidePanel } = await import('../platform/settings.js');
    const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const setNav = (userAgent, brands) => Object.defineProperty(globalThis, 'navigator', { value: { userAgent, userAgentData: brands && { brands: brands.map((brand) => ({ brand })) } }, configurable: true });
    try {
      globalThis.chrome = { sidePanel: { open() {} } };
      setNav('Mozilla/5.0 Chrome/130 Safari/537.36', ['Chromium', 'Google Chrome']);
      assert.equal(hasSidePanel(), true, 'Chrome');
      setNav('Mozilla/5.0 Chrome/130 Safari/537.36 Edg/130', ['Chromium', 'Microsoft Edge']);
      assert.equal(hasSidePanel(), true, 'Edge');
      setNav('Mozilla/5.0 Chrome/130 Safari/537.36 OPR/115', undefined);
      assert.equal(hasSidePanel(), false, 'Opera by user agent');
      setNav('Mozilla/5.0 Chrome/130 Safari/537.36', ['Chromium', 'Opera GX']);
      assert.equal(hasSidePanel(), false, 'Opera GX by brand');
      setNav('Mozilla/5.0 Chrome/130', ['Chromium']);
      globalThis.chrome = {};
      assert.equal(hasSidePanel(), false, 'no API');
    } finally {
      if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
      delete globalThis.chrome;
    }
    const popup = fs.readFileSync(new URL('../popup/guards.js', import.meta.url), 'utf8');
    assert.ok(popup.includes('/\\bOPR\\//') && popup.includes('/opera/i') && popup.includes('!isOpera'), 'popup/guards.js keeps the user-agent test, the brand test and the gate');
    for (const f of ['../options/options.js', '../background/worker-lifecycle.js', '../background/service-worker.js', '../background/handlers-session.js']) {
      const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
      assert.match(src, /hasSidePanel[^;]*\} from '\.\.\/platform\/settings\.js'/, `${f} imports the shared predicate`);
      assert.doesNotMatch(src, /chrome\.sidePanel\?\.open/, `${f} no longer tests the bare API`);
    }
    passed++; console.log(`  ok  ${name}`);
  } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
