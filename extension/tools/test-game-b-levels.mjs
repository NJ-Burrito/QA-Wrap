/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt lane B: the five level modules. Every detector has its positive case and the negatives that must NOT catch
 * (DESIGN-bug-hunt.md section 11), then each level is driven through a fake DOM with the real engine, and one scripted run
 * plays all five and pastes a real report. Plain node; no browser, no network.
 *
 *   node tools/test-game-b-levels.mjs        (from extension/, PYTHONUTF8=1)
 */
import assert from 'node:assert/strict';
import { buildMarkdown } from '../core/artifact-docs.js';
import { imp, runner, fakeClock, memStorage, FakeEl, fakeDoc, fakeWin, byId } from './lib-game-b.mjs';

const { test, done } = runner('Bug Hunt levels (lane B)');
const { createEngine } = await imp('engine.js');
const S = await imp('scoring.js');
const L = {};
for (let k = 1; k <= 5; k++) L[k] = await imp(`levels/l${k}.js`);

/* ------------------------------------------------------------------ pure detectors */
await test('module contract: each level exports id, mount, arm, detect, proveSignal, dispose', () => {
  for (let k = 1; k <= 5; k++) {
    for (const f of ['mount', 'arm', 'detect', 'proveSignal', 'dispose']) assert.equal(typeof L[k][f], 'function', `l${k}.${f}`);
    assert.equal(L[k].id, `l${k}`); assert.equal(L[k].default.id, `l${k}`);
  }
});

await test('L1: 500 + "Saved" + QA Wrap awake catches; asleep nudges and stays armed; 200, no Saved text, other events do not', () => {
  const d = L[1].detect;
  for (const qaw of ['ready', 'recording']) assert.equal(d({ type: 'save', status: 500, saidSaved: true, qaw }).caught, true, qaw);
  assert.equal(d({ type: 'save', status: 503, saidSaved: true, qaw: 'ready' }).caught, true);
  const asleep = d({ type: 'save', status: 500, saidSaved: true, qaw: 'asleep' });
  assert.deepEqual([asleep.caught, asleep.reason, asleep.nudge], [false, 'asleep', 'rail.nudgeAsleep']);
  for (const qaw of [null, undefined, 'stopped']) assert.equal(d({ type: 'save', status: 500, saidSaved: true, qaw }).caught, false, String(qaw));
  assert.equal(d({ type: 'save', status: 200, saidSaved: true, qaw: 'ready' }).caught, false);
  assert.equal(d({ type: 'save', status: 0, saidSaved: true, qaw: 'ready' }).caught, false, 'a network error is not the planted 500');
  assert.equal(d({ type: 'save', status: 500, saidSaved: false, qaw: 'ready' }).caught, false);
  assert.equal(d({ type: 'load', qaw: 'ready' }).caught, false, 'Save never pressed');
  assert.equal(d(null).caught, false); assert.equal(d({}).caught, false);
  assert.equal(d({ type: 'bonus-click' }).bonus, true);
  assert.equal(d({ type: 'decoy-click', id: 'cancel' }).decoy, 'cancel');
});

await test('L2: a marked error with QA Wrap awake catches; a foreign error and a marked error while asleep do not', () => {
  const d = L[2].detect;
  const mark = (id) => Object.assign(new TypeError('x'), { __game: id });
  assert.equal(d({ type: 'error', error: mark('l2'), qaw: 'recording' }).caught, true);
  assert.equal(d({ type: 'error', error: new TypeError('x'), qaw: 'recording' }).caught, false, 'foreign error (no marker)');
  assert.equal(d({ type: 'error', error: mark('l3'), qaw: 'recording' }).caught, false, 'another level\'s marker');
  assert.equal(d({ type: 'error', error: 'l2', qaw: 'ready' }).caught, false, 'a string is not a marked error');
  assert.equal(d({ type: 'error', error: null, qaw: 'ready' }).caught, false);
  const asleep = d({ type: 'error', error: mark('l2'), qaw: 'asleep' });
  assert.deepEqual([asleep.caught, asleep.nudge], [false, 'rail.nudgeAsleep']);
  assert.equal(L[2].proveSignal(), false, 'Not a bug is a self-reported chip');
  assert.deepEqual(d({ type: 'noise' }), { caught: false, noise: true, reason: 'expected-failure' });
});

await test('L3: a click on #next with no #app change and no fetch catches; a change inside #app, a fetch or another click does not', () => {
  const d = L[3].detect;
  assert.equal(d({ type: 'click', id: 'next', mutated: false, fetched: false }).caught, true);
  assert.equal(d({ type: 'click', id: 'next', mutated: true, fetched: false }).caught, false, 'mutation inside #app');
  assert.equal(d({ type: 'click', id: 'next', mutated: false, fetched: true }).caught, false, 'a request went out');
  assert.equal(d({ type: 'click', id: 'back', mutated: false, fetched: false }).caught, false, 'click elsewhere');
  assert.equal(d({ type: 'click', id: undefined, mutated: false, fetched: false }).caught, false);
  assert.equal(L[3].DEAD_MS, 1700);
});

await test('L4: a click on #ref while it overflows catches; not when it fits (resized wide), not elsewhere, not on load alone', () => {
  const d = L[4].detect;
  assert.equal(d({ type: 'click', id: 'ref', overflow: true }).caught, true);
  assert.equal(d({ type: 'click', id: 'ref', overflow: false }).caught, false);
  assert.equal(d({ type: 'click', id: 'thanks', overflow: true }).caught, false);
  assert.equal(d({ type: 'load', overflow: true }).caught, false);
  assert.equal(d({ type: 'click', id: 'ref' }).caught, false);
});

await test('L5: a pay call over 3000 ms catches; 1200 ms, exactly 3000 ms and a failed call do not', () => {
  const d = L[5].detect;
  assert.equal(d({ type: 'pay', durationMs: 4000, ok: true }).caught, true);
  assert.equal(d({ type: 'pay', durationMs: 3001, ok: true }).caught, true);
  assert.equal(d({ type: 'pay', durationMs: 1200, ok: true }).caught, false);
  assert.equal(d({ type: 'pay', durationMs: 3000, ok: true }).caught, false);
  assert.equal(d({ type: 'pay', durationMs: 9000, ok: false }).caught, false);
  assert.equal(d({ type: 'click', id: 'pay' }).caught, false);
});

/* ------------------------------------------------------------------ DOM + engine, one level at a time */
class FakeMO {
  static all = [];
  constructor(cb) { this.cb = cb; this.on = false; FakeMO.all.push(this); }
  observe() { this.on = true; }
  disconnect() { this.on = false; }
  takeRecords() { return []; }
}

function rig() {
  const clk = fakeClock();
  const sig = { state: 'ready', counts: { notes: 0, shots: 0 } };
  const doc = fakeDoc(); const win = fakeWin();
  const root = new FakeEl('div', doc); root.setAttribute('id', 'app');
  const calls = []; const waiting = [];
  const fetch = (url, init) => {
    calls.push({ url, method: init && init.method, body: init && init.body });
    if (url === '/api/save-profile') return Promise.resolve({ status: 500, ok: false });
    if (url === '/api/coupons') return Promise.resolve({ status: 404, ok: false });
    return new Promise((res) => waiting.push(res)); // /api/pay: answered by the test after the fake clock moved
  };
  const storage = memStorage();
  const eng = createEngine({ clock: clk, storage, doc, win, root, levels: [1, 2, 3, 4, 5].map((k) => L[k]), t: (k) => k, fetch, MutationObserver: FakeMO, qawState: () => sig.state, qawCounts: () => sig.counts });
  const log = [];
  eng.on('*', (t, p) => log.push({ t, ...p }));
  return { clk, sig, doc, win, root, calls, waiting, eng, log, storage, ev: (t) => log.filter((e) => e.t === t), last: (t) => log.filter((e) => e.t === t).at(-1) };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
async function toLevel(r, k) { r.eng.start(); for (let i = 1; i < k; i++) { r.eng.skip(); r.eng.next(); } assert.equal(await r.eng.go(), true); }

await test('L1 in the page: Save while asleep nudges and says Saved; awake catches; a 200 never would; "Saved" is the planted lie', async () => {
  const r = rig(); await toLevel(r, 1);
  r.sig.state = 'asleep';
  byId(r.root, 'save').fire('click'); await flush();
  assert.equal(byId(r.root, 'save-state').textContent, 'shop.l1.saved', 'the page says Saved although the call failed');
  assert.equal(r.ev('level:catch').length, 0);
  assert.equal(r.last('level:nudge').key, 'rail.nudgeAsleep');
  r.sig.state = 'ready';
  byId(r.root, 'save').fire('click'); await flush();
  assert.equal(r.ev('level:catch').length, 1, 'still armed after the nudge');
  assert.deepEqual(r.calls.map((c) => [c.url, c.method, c.body]), [['/api/save-profile', 'POST', undefined], ['/api/save-profile', 'POST', undefined]], 'empty-body POSTs to its own origin only');
  r.clk.advance(500);
  assert.equal(r.last('level:prove').tool, 'wake', 'QA Wrap is awake: the objective prove step');
});

await test('L1 bonus (typo label) and decoy (Cancel): bonus +150 once, decoy -25 once; both only inside #app', async () => {
  const r = rig(); await toLevel(r, 1);
  const label = r.root.querySelector('[data-bonus="l1"]');
  label.fire('click'); label.fire('click');
  assert.equal(r.ev('level:bonus').length, 1); assert.equal(r.eng.score, 150);
  byId(r.root, 'cancel').fire('click'); byId(r.root, 'cancel').fire('click');
  assert.equal(r.ev('score:tool').filter((e) => e.kind === 'decoy').length, 1);
  assert.equal(r.eng.score, 150 - 25);
  const outside = new FakeEl('i', r.doc); outside.setAttribute('data-bonus', 'l1'); outside.fire('click');
  assert.equal(r.ev('level:bonus').length, 1, 'a bonus-looking element outside #app is not the bonus');
});

await test('L2 in the page: Apply raises a marked TypeError as an error EVENT, never thrown (no row on chrome://extensions Errors); asleep nudges; a foreign error is no catch', async () => {
  const a = rig(); await toLevel(a, 2);
  a.sig.state = 'asleep'; byId(a.root, 'apply').fire('click'); // would throw out of the click handler if the fault were thrown
  assert.equal(a.win.dispatched, 1, 'raised as one dispatched error event');
  assert.equal(a.ev('level:catch').length, 0); assert.equal(a.last('level:nudge').key, 'rail.nudgeAsleep');
  const f = rig(); await toLevel(f, 2); f.sig.state = 'recording'; f.win.ErrorEvent = undefined;
  assert.throws(() => byId(f.root, 'apply').fire('click'), TypeError, 'a window without ErrorEvent keeps the old throw');
  const r = rig(); await toLevel(r, 2);
  let seen = null; r.win.addEventListener('error', (e) => { seen = e.error; });
  r.win.dispatch('error', { error: new Error('extension noise') });
  assert.equal(r.ev('level:catch').length, 0);
  r.sig.state = 'recording'; byId(r.root, 'apply').fire('click');
  assert.ok(seen instanceof TypeError && seen.__game === 'l2', 'the same event the recorder listens to carries the marked TypeError');
  assert.equal(r.ev('level:catch').length, 1);
  assert.equal(r.last('score:tool').tool, 'recorder', 'the recorder is credited with the catch');
  assert.equal(r.eng.view().needs, 'noise'); assert.equal(r.eng.view().chipAvailable, false);
  assert.equal(r.eng.claimProve('notbug'), false, 'Not a bug needs the harmless failure to have happened');
  byId(r.root, 'refresh').fire('click'); await flush();
  assert.equal(r.eng.view().needs, 'feature'); assert.equal(r.eng.view().chipAvailable, true);
  assert.deepEqual(r.calls.at(-1).url, '/api/coupons');
  assert.equal(r.ev('level:noise').length, 1);
  assert.equal(r.ev('level:catch').length, 1, 'the harmless 404 is not a catch');
  assert.equal(r.ev('score:tool').filter((e) => e.outcome === 'wrong').length, 0, 'and not a deduction');
  assert.equal(r.eng.claimProve('notbug'), true);
  r.root.querySelector('[data-bonus="l2"]').fire('click'); assert.equal(r.ev('level:bonus').length, 1);
});

await test('L3 in the page: Next with nothing changing for 1.7 s catches; a change inside #app or a fetch cancels the catch; decoration does not', async () => {
  const r = rig(); await toLevel(r, 3);
  const next = byId(r.root, 'next');
  next.fire('click'); r.clk.advance(L[3].DEAD_MS - 1); assert.equal(r.ev('level:catch').length, 0, 'not before 1.7 s');
  r.clk.advance(1); assert.equal(r.ev('level:catch').length, 1);
  // attempt 2: a mutation INSIDE #app during the window
  const a = rig(); await toLevel(a, 3);
  byId(a.root, 'next').fire('click'); FakeMO.all.at(-1).cb([{ type: 'childList' }]); a.clk.advance(L[3].DEAD_MS);
  assert.equal(a.ev('level:catch').length, 0, 'the page did something');
  byId(a.root, 'next').fire('click'); a.clk.advance(L[3].DEAD_MS);
  assert.equal(a.ev('level:catch').length, 1, 'quiet second try catches (mutations outside #app never reach the observer)');
  // attempt 3: decoration (class / ring) is not a reaction
  const b = rig(); await toLevel(b, 3);
  byId(b.root, 'next').fire('click'); FakeMO.all.at(-1).cb([{ type: 'attributes', attributeName: 'class' }, { type: 'attributes', attributeName: 'data-ring' }]); b.clk.advance(L[3].DEAD_MS);
  assert.equal(b.ev('level:catch').length, 1);
  // attempt 4: a request goes out during the window (through the counted fetch the engine hands every level)
  const c = rig(); let seen = null;
  const spy = { ...L[3], mount(root, ctx) { seen = ctx; return L[3].mount(root, ctx); } };
  const eng4 = createEngine({ clock: c.clk, storage: memStorage(), doc: c.doc, win: c.win, root: c.root, levels: [L[1], L[2], spy, L[4], L[5]], t: (k) => k, fetch: () => Promise.resolve({ status: 200, ok: true }), MutationObserver: FakeMO, qawState: () => 'ready', qawCounts: () => null });
  const caught4 = [];
  eng4.on('level:catch', (p) => caught4.push(p));
  eng4.start(); eng4.skip(); eng4.next(); eng4.skip(); eng4.next(); await eng4.go();
  byId(c.root, 'next').fire('click'); c.clk.advance(300); seen.fetch('/anything'); c.clk.advance(900);
  assert.equal(caught4.length, 0, 'a fetch inside the window means the button did something');
  // another click while the check runs is ignored (one check at a time)
  const d = rig(); await toLevel(d, 3);
  byId(d.root, 'next').fire('click'); byId(d.root, 'next').fire('click'); d.clk.advance(L[3].DEAD_MS);
  assert.equal(d.ev('level:catch').length, 1);
  // the observer is released when the level ends
  const e = rig(); await toLevel(e, 3);
  byId(e.root, 'next').fire('click'); e.eng.skip();
  assert.ok(FakeMO.all.at(-1).on === false, 'observer disconnected on dispose');
  e.clk.advance(5000); assert.equal(e.ev('level:catch').length, 0, 'no late catch after the level ended');
});

await test('L3 prove: a note added AFTER the catch proves it (+100); a note before the catch does not; no signal -> the chip is offered', async () => {
  const r = rig(); await toLevel(r, 3);
  byId(r.root, 'next').fire('click'); r.clk.advance(L[3].DEAD_MS);
  r.sig.counts = { notes: 1, shots: 0 }; r.clk.advance(500);
  assert.equal(r.last('level:prove').tool, 'note'); assert.equal(r.last('level:prove').points, 100);
  const early = rig(); await toLevel(early, 3);
  early.sig.counts = { notes: 1, shots: 0 }; early.clk.advance(500);
  byId(early.root, 'next').fire('click'); early.clk.advance(L[3].DEAD_MS); early.clk.advance(500);
  assert.equal(early.ev('level:prove').length, 0, 'the early note is not evidence for a bug found later');
  assert.equal(early.ev('score:tool').filter((e) => e.kind === 'early').length, 1);
  const none = rig(); none.sig.counts = null; await toLevel(none, 3);
  byId(none.root, 'next').fire('click'); none.clk.advance(L[3].DEAD_MS);
  assert.equal(none.eng.view().chipAvailable, true); assert.equal(none.eng.claimProve('note'), true);
  assert.equal(none.last('level:prove').points, 50);
});

await test('L4 in the page: the order number really overflows; clicking it catches only while it overflows; a screenshot after proves it', async () => {
  const r = rig(); await toLevel(r, 4);
  const ref = byId(r.root, 'ref');
  assert.match(ref.getAttribute('style'), /overflow:hidden/); assert.match(ref.getAttribute('style'), /white-space:nowrap/);
  assert.ok(r.root.querySelector('[data-bonus="l4"]').getAttribute('style').includes('font-size:9px'));
  ref.scrollWidth = 150; ref.clientWidth = 150; ref.fire('click');
  assert.equal(r.ev('level:catch').length, 0, 'it fits');
  byId(r.root, 'thanks').fire('click'); assert.equal(r.ev('level:catch').length, 0);
  ref.scrollWidth = 210; ref.clientWidth = 150; ref.fire('click');
  assert.equal(r.ev('level:catch').length, 1);
  r.sig.counts = { notes: 0, shots: 1 }; r.clk.advance(500);
  assert.deepEqual([r.last('level:prove').tool, r.last('level:prove').points], ['shot', 100]);
});

await test('L4 in Ready (the screenshot is taken outside a session, so the count never rises): the chip is offered, Finish advances; while recording the count is read instead', async () => {
  const r = rig(); await toLevel(r, 4);
  const ref = byId(r.root, 'ref'); ref.scrollWidth = 210; ref.clientWidth = 150; ref.fire('click');
  assert.equal(r.eng.view().chipAvailable, true, 'Ready: the shared count cannot move, so the self-report chip shows');
  assert.equal(r.eng.view().canFinish, true, 'Finish is there once the bug is caught');
  assert.equal(r.eng.claimProve('shot'), true);
  assert.equal(r.last('level:prove').tool, 'shot');
  const rec = rig(); await toLevel(rec, 4); rec.sig.state = 'recording';
  const ref2 = byId(rec.root, 'ref'); ref2.scrollWidth = 210; ref2.clientWidth = 150; ref2.fire('click');
  assert.equal(rec.eng.view().chipAvailable, false, 'recording: the count is read, no self-report');
  assert.equal(rec.eng.claimProve('shot'), false);
  assert.equal(rec.eng.finish(), true, 'Finish still advances with the goal unmet');
});

await test('L5 in the page: Pay answered after 4 s catches; answered in 1.2 s does not; stop AFTER the catch proves; one press at a time', async () => {
  const slow = rig(); await toLevel(slow, 5);
  byId(slow.root, 'pay').fire('click'); byId(slow.root, 'pay').fire('click');
  assert.equal(slow.calls.length, 1, 'a second press while paying is ignored');
  assert.equal(byId(slow.root, 'pay-state').textContent, 'shop.l5.paying');
  slow.clk.advance(4000); slow.waiting[0]({ status: 200, ok: true }); await flush();
  assert.equal(slow.ev('level:catch').length, 1); assert.equal(byId(slow.root, 'pay-state').textContent, '', 'the paying line clears when the answer arrives');
  slow.sig.state = 'stopped'; slow.clk.advance(500);
  assert.deepEqual([slow.last('level:prove').tool, slow.last('level:prove').points], ['stop', 100]);
  const fast = rig(); await toLevel(fast, 5);
  byId(fast.root, 'pay').fire('click'); fast.clk.advance(1200); fast.waiting[0]({ status: 200, ok: true }); await flush();
  assert.equal(fast.ev('level:catch').length, 0);
  const early = rig(); await toLevel(early, 5);
  early.sig.state = 'stopped'; early.clk.advance(500);
  assert.equal(early.ev('score:tool').filter((e) => e.kind === 'early' && e.tool === 'stop').length, 1, 'stopping before the catch is a deduction');
  byId(early.root, 'pay').fire('click'); early.clk.advance(4000); early.waiting[0]({ status: 200, ok: true }); await flush();
  early.clk.advance(2000);
  assert.equal(early.ev('level:prove').length, 0, 'already stopped at the catch: a stop before it is not the proof');
  early.sig.state = 'recording'; early.clk.advance(500); early.sig.state = 'stopped'; early.clk.advance(500);
  assert.equal(early.ev('level:prove').length, 1, 'a fresh recording stopped after the catch is');
});

await test('every level\'s text comes through ctx.t (keys only): the keys the page must supply are listed and stable', async () => {
  const keys = new Set();
  for (let k = 1; k <= 5; k++) {
    const r = rig(); const orig = r.root;
    const eng = createEngine({ clock: r.clk, storage: memStorage(), doc: r.doc, win: r.win, root: orig, levels: [1, 2, 3, 4, 5].map((j) => L[j]), t: (key) => { keys.add(key); return key; }, qawState: () => 'ready', qawCounts: () => null });
    eng.start(); for (let i = 1; i < k; i++) { eng.skip(); eng.next(); }
    await eng.go();
  }
  const list = [...keys].sort();
  assert.ok(list.every((x) => /^shop\.l[1-5]\.[A-Za-z]+$/.test(x)), list.join(','));
  assert.ok(list.length >= 33, `${list.length} keys`);
  console.log(`       keys: ${list.length}`);
});

await test('L2 clear path, no count shared: Apply (caught) -> Refresh offers (harmless 404) -> the Not a bug chip -> clear card', async () => {
  const r = rig(); r.sig.counts = { notes: 0, shots: 0 }; await toLevel(r, 2);
  let err; try { byId(r.root, 'apply').fire('click'); } catch (e) { err = e; }
  r.win.dispatch('error', { error: err });
  assert.equal(r.eng.view().featureAuto, false);
  byId(r.root, 'refresh').fire('click'); await flush();
  assert.equal(r.eng.claimProve('notbug'), true);
  assert.equal(r.eng.finish(), true);
  const c = r.last('level:clear');
  assert.deepEqual([c.n, c.proved, c.learned.primary.id, c.learned.with[0].name], [2, true, 'recorder', 'Not a bug']);
});

await test('L2 clear path with the shared qawExpected count: only a press AFTER the harmless failure proves it; the chip is refused', async () => {
  const r = rig(); r.sig.counts = { notes: 0, shots: 0, expected: 0 }; await toLevel(r, 2);
  r.sig.counts = { ...r.sig.counts, expected: 1 }; r.clk.advance(500);   // a press before anything happened
  let err; try { byId(r.root, 'apply').fire('click'); } catch (e) { err = e; }
  r.win.dispatch('error', { error: err });
  assert.equal(r.eng.view().featureAuto, true); assert.equal(r.eng.view().chipAvailable, false);
  r.sig.counts = { ...r.sig.counts, expected: 2 }; r.clk.advance(500);
  assert.equal(r.ev('level:prove').length, 0, 'the harmless failure has not happened yet');
  byId(r.root, 'refresh').fire('click'); await flush();
  assert.equal(r.eng.claimProve('notbug'), false, 'QA Wrap counts the press: nothing to self-report');
  r.clk.advance(500); assert.equal(r.ev('level:prove').length, 0);
  r.sig.counts = { ...r.sig.counts, expected: 3 }; r.clk.advance(500);
  assert.deepEqual([r.last('level:prove').tool, r.last('level:prove').points], ['notbug', 100]);
  assert.equal(r.eng.finish(), true);
});

await test('L1 / L3 / L4 / L5 extras are read from the shared counts after the catch (shortcut, note type, mark up, replay buffer)', async () => {
  const all = { notes: 0, shots: 0, shortcut: 0, expected: 0, noteTypes: 0, marks: 0, buffer: 0 };
  const r1 = rig(); r1.sig.counts = { ...all }; await toLevel(r1, 1);
  r1.sig.counts = { ...all, shortcut: 1 }; r1.clk.advance(500);
  assert.deepEqual([r1.last('level:chip').id, r1.last('level:chip').points], ['shortcut', 50]);
  const r3 = rig(); r3.sig.counts = { ...all }; await toLevel(r3, 3);
  byId(r3.root, 'next').fire('click'); r3.clk.advance(L[3].DEAD_MS);
  r3.sig.counts = { ...all, noteTypes: 1 }; r3.clk.advance(500);
  assert.equal(r3.last('level:chip').id, 'notetype');
  const r4 = rig(); r4.sig.counts = { ...all }; await toLevel(r4, 4);
  const ref = byId(r4.root, 'ref'); ref.scrollWidth = 200; ref.clientWidth = 100; ref.fire('click');
  r4.sig.counts = { ...all, marks: 1 }; r4.clk.advance(500);
  assert.equal(r4.last('level:chip').id, 'markup');
  const r5 = rig(); r5.sig.counts = { ...all }; await toLevel(r5, 5);
  byId(r5.root, 'pay').fire('click'); r5.clk.advance(4000); r5.waiting[0]({ status: 200, ok: true }); await flush();
  r5.sig.counts = { ...all, buffer: 1 }; r5.clk.advance(500);
  assert.equal(r5.last('level:chip').id, 'buffer');
});

/* ------------------------------------------------------------------ one scripted run through all five levels */
const T0 = 1_791_724_838_000;
const report = buildMarkdown({ id: 's_run', charter: 'Untitled session', startedAt: T0, endedAt: T0 + 9000, startUrl: 'http://localhost:4173/', env: {} }, [
  { kind: 'net', method: 'POST', url: 'http://localhost:4173/api/save-profile', status: 500, error: true, durationMs: 3, ts: T0 + 110, frameUrl: 'http://localhost:4173/' },
  { kind: 'note', tag: 'bug', text: 'Save says Saved but fails', ts: T0 + 300, frameUrl: 'http://localhost:4173/' },
]);

await test('scripted run: five levels caught and proved with the real engine and modules, then the report is pasted in the finale', async () => {
  const r = rig();
  r.eng.start();
  // 1 wake
  await r.eng.go(); r.clk.advance(8000); byId(r.root, 'save').fire('click'); await flush(); r.clk.advance(500);
  r.clk.advance(S.NUM.CLEAR_GRACE_BONUS_MS); assert.equal(r.last('level:clear').n, 1); r.eng.next();
  // 2 console
  await r.eng.go(); r.clk.advance(5000);
  byId(r.root, 'apply').fire('click'); byId(r.root, 'refresh').fire('click'); await flush(); r.eng.claimProve('notbug'); r.clk.advance(S.NUM.CLEAR_GRACE_BONUS_MS); r.eng.next();
  // 3 note
  await r.eng.go(); r.clk.advance(5000); byId(r.root, 'next').fire('click'); r.clk.advance(L[3].DEAD_MS);
  r.sig.counts = { notes: 1, shots: 0 }; r.clk.advance(500); r.clk.advance(S.NUM.CLEAR_GRACE_BONUS_MS); r.eng.next();
  // 4 screenshot
  await r.eng.go(); r.clk.advance(5000); const ref = byId(r.root, 'ref'); ref.scrollWidth = 200; ref.clientWidth = 100; ref.fire('click');
  r.sig.counts = { notes: 1, shots: 1 }; r.clk.advance(500); r.clk.advance(S.NUM.CLEAR_GRACE_BONUS_MS); r.eng.next();
  // 5 slow + stop
  await r.eng.go(); r.clk.advance(5000); byId(r.root, 'pay').fire('click'); r.clk.advance(4000); r.waiting[0]({ status: 200, ok: true }); await flush();
  r.sig.state = 'stopped'; r.clk.advance(500); r.clk.advance(S.NUM.CLEAR_GRACE_BONUS_MS);
  assert.equal(r.last('level:clear').n, 5);
  r.eng.next();
  assert.equal(r.eng.status, 'finale');
  const f = r.last('finale');
  assert.equal(f.bugs, 5); assert.equal(f.starsMax, 15); assert.ok(f.stars >= 10, `stars ${f.stars}`);
  assert.equal(r.ev('score:tool').filter((e) => e.outcome === 'wrong').length, 0, 'a clean run has no deduction');
  assert.ok(f.score > 1000, `score ${f.score}`);
  assert.equal(r.eng.pasteText(report).ok, true);
  const after = r.last('finale:pasted');
  assert.deepEqual(Object.keys(after).filter((k) => k !== 't').sort(), ['board', 'bug', 'heading', 'lines', 'score']);
  const saved = JSON.parse(r.storage.getItem('bughunt.v1'));
  assert.deepEqual(Object.values(saved.stickers), [true, true, true, true, true]);
  assert.ok(!JSON.stringify(saved).includes('Save says Saved'), 'the pasted text is not stored');
  assert.ok(saved.best.run > 0);
  for (const c of r.calls) assert.ok(c.url.startsWith('/api/') && c.body === undefined);
});

await test('speed bonus is capped at +50 and a skipped level adds nothing', async () => {
  const r = rig(); await toLevel(r, 1);
  r.clk.advance(1000); byId(r.root, 'save').fire('click'); await flush(); r.clk.advance(500);
  r.clk.advance(S.NUM.CLEAR_GRACE_BONUS_MS);
  const c = r.last('level:clear');
  assert.equal(c.levelScore, 100 + 50 + 50, 'catch + wake + capped speed bonus');
  r.eng.next(); r.eng.skip();
  assert.equal(r.last('level:clear').levelScore, 0);
});

/* Nader, 15 Oct 2026: Finish level always advances; every level is played; Session complete only after level 5; Stop in QA Wrap never ends the game. */
await test('finish flow: bug caught, no goal met, Finish pressed on every level -> 5 clear cards, Session complete only after level 5; QA Wrap stopped mid-game changes nothing', async () => {
  const r = rig(); r.eng.start();
  const stops = [];
  for (let k = 1; k <= 5; k++) {
    assert.equal(r.eng.status, 'card'); assert.equal(r.eng.n, k, `card ${k}`);
    await r.eng.go(); r.clk.advance(5000);
    assert.equal(r.eng.finish(), false, 'nothing caught yet: Finish is not offered (Skip is)');
    if (k === 1) byId(r.root, 'save').fire('click');
    if (k === 2) byId(r.root, 'apply').fire('click');
    if (k === 3) { byId(r.root, 'next').fire('click'); r.clk.advance(L[3].DEAD_MS); }
    if (k === 4) { const ref = byId(r.root, 'ref'); ref.scrollWidth = 200; ref.clientWidth = 100; ref.fire('click'); }
    if (k === 5) { byId(r.root, 'pay').fire('click'); r.clk.advance(4000); r.waiting[0]({ status: 200, ok: true }); await flush(); }
    await flush();
    assert.equal(r.ev('level:catch').length, k, `bug ${k} caught`);
    if (k < 5) { assert.equal(r.eng.view().canFinish, true, `Finish is enabled on level ${k} with nothing proved`); } else { r.sig.state = 'recording'; }
    assert.equal(r.eng.finish(), true, `Finish advances level ${k}`);
    assert.equal(r.last('level:clear').n, k); assert.equal(r.last('level:clear').proved, k === 1, 'unmet goal: no prove step (level 1 proves itself: QA Wrap is awake)'); if (k > 1) assert.equal(r.last('level:clear').stars, 1);
    assert.notEqual(r.eng.status, 'finale', `no Session complete after level ${k}`);
    if (k === 2) { r.sig.state = 'stopped'; r.clk.advance(1000); stops.push(r.eng.status); } // Stop / Copy report in QA Wrap while the clear card is up
    if (k < 5) { assert.equal(r.eng.next(), true); }
  }
  assert.deepEqual(stops, ['clear'], 'a Stop in QA Wrap does not move the game');
  assert.equal(r.ev('level:clear').length, 5); assert.equal(r.ev('finale').length, 0, 'not yet: level 5 clear card is still showing');
  assert.equal(r.eng.next(), true); assert.equal(r.eng.status, 'finale'); assert.equal(r.ev('finale').length, 1);
  assert.equal(r.last('finale').bugs, 5);
  assert.ok(r.last('level:clear').levelScore > 0, 'points earned are kept');
});

await test('skip flow: skipping levels 1-4 and then the last still ends only after level 5, never earlier', async () => {
  const r = rig(); r.eng.start();
  for (let k = 1; k <= 5; k++) { assert.equal(r.eng.n, k); r.eng.skip(); assert.notEqual(r.eng.status, 'finale'); if (k < 5) r.eng.next(); }
  r.eng.next(); assert.equal(r.eng.status, 'finale');
});

done();
