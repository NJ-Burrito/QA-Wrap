/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt lane B: the engine (state machine, scoring, per-tool deductions, stars, best time, hint clock, pause, storage,
 * paste gate). Plain node with a fake clock, fake storage and fake DOM; no browser, no network.
 *
 *   node tools/test-game-b-engine.mjs        (from extension/, PYTHONUTF8=1)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMarkdown } from '../core/artifact-docs.js';
import { GAME_DIR, imp, runner, fakeClock, memStorage, FakeEl, fakeDoc, fakeWin } from './lib-game-b.mjs';

const { test, done } = runner('Bug Hunt engine (lane B)');
const { createEngine, inspectReport, readQawState, readQawCounts, featureFor, STORAGE_KEY } = await imp('engine.js');
const S = await imp('scoring.js');

/* ---- harness: fake levels whose prove step the test flips by hand, so the engine rules are tested alone */
function fakeLevel(k) {
  const lv = { n: k, ctx: null, proveNow: false, pend: false, signal: k === 3 || k === 4 ? false : undefined };
  lv.mount = (root, ctx) => { lv.ctx = ctx; };
  lv.arm = () => {};
  lv.dispose = () => {};
  lv.proveSignal = () => lv.proveNow;
  lv.signalAvailable = () => lv.signal === true;
  lv.pending = () => lv.pend;
  lv.chipOk = true;
  if (k === 2) { lv.catchFeature = { tool: 'recorder', kind: 'caught' }; lv.chipReady = () => lv.chipOk; lv.chips = []; }
  else lv.chips = [{ id: ['shortcut', null, 'notetype', 'markup', 'buffer'][k - 1], tool: ['shortcut', null, 'notetype', 'markup', 'buffer'][k - 1], after: k === 1 ? 'any' : 'caught', signal: ['shortcut', null, 'noteTypes', 'marks', 'buffer'][k - 1] }];
  return lv;
}
function harness(over = {}) {
  const clk = fakeClock();
  const sig = { state: 'ready', counts: null };
  const storage = over.storage || memStorage();
  const lvs = [1, 2, 3, 4, 5].map(fakeLevel);
  const doc = fakeDoc();
  const win = fakeWin();
  const eng = createEngine({ clock: clk, storage, doc, win, root: new FakeEl('div', doc), levels: lvs, qawState: () => sig.state, qawCounts: () => sig.counts, fetch: async () => ({ status: 200, ok: true }) });
  const log = [];
  eng.on('*', (t, p) => log.push({ t, ...p }));
  return { eng, clk, sig, storage, lvs, log, doc, win, ctxOf: (k) => lvs[k - 1].ctx, ev: (t) => log.filter((e) => e.t === t) };
}
/** Jump to the play screen of level k (earlier levels skipped, so they score nothing). */
async function toLevel(h, k) {
  h.eng.start();
  for (let i = 1; i < k; i++) { h.eng.skip(); h.eng.next(); }
  assert.equal(await h.eng.go(), true);
}
const catchNow = (h, k) => h.ctxOf(k).emit({ type: 'catch', reason: 'test' });
const tick = (h, ms = 500) => h.clk.advance(ms);
/** The feature signal arrives together with the catch (so the level time is exact): level 2 needs its chip, the others their prove signal. */
const featureReady = (h, k) => { if (k !== 2) h.lvs[k - 1].proveNow = true; };
const useFeature = (h, k) => { if (k === 2) h.eng.claimProve('notbug'); };
/** Win a level the way a player does: catch it, use its feature, then clear. */
const winNow = (h, k) => { featureReady(h, k); catchNow(h, k); useFeature(h, k); return h.eng.finish(); };
/** A level-2 screen with some points on the board, so a deduction is visible. */
async function level2WithScore() {
  const h = harness();
  await toLevel(h, 1); h.clk.advance(5000); assert.equal(winNow(h, 1), true); h.eng.next();
  assert.equal(await h.eng.go(), true);
  assert.ok(h.eng.score > 0);
  return h;
}
const last = (h, t) => h.ev(t).at(-1);

/* ------------------------------------------------------------------ state machine */
await test('flow: title -> card -> play -> clear -> card ... -> finale; Skip works from card and play', async () => {
  const h = harness();
  assert.equal(h.eng.status, 'title');
  assert.equal(await h.eng.go(), false, 'go() only from a card');
  assert.equal(h.eng.next(), false);
  assert.equal(h.eng.start(), true);
  assert.deepEqual([h.eng.status, h.eng.n], ['card', 1]);
  assert.equal(h.eng.start(), false, 'second start ignored');
  assert.equal(await h.eng.go(), true);
  assert.equal(h.eng.status, 'play');
  assert.equal(h.eng.skip(), true);
  assert.equal(h.eng.status, 'clear');
  assert.equal(h.eng.next(), true);
  assert.deepEqual([h.eng.status, h.eng.n], ['card', 2]);
  assert.equal(h.eng.skip(), true, 'skip from the card itself');
  assert.equal(last(h, 'level:clear').stars, 1);
  assert.equal(last(h, 'level:clear').skipped, true);
  for (let k = 3; k <= 5; k++) { h.eng.next(); await h.eng.go(); h.eng.skip(); }
  assert.equal(h.eng.next(), true);
  assert.equal(h.eng.status, 'finale');
  const f = last(h, 'finale');
  assert.equal(f.starsMax, 15);
  assert.equal(f.stars, 5);
  assert.equal(h.eng.skip(), false, 'nothing to skip in the finale');
});

await test('no fail state: nothing in the engine can end a level badly (no lives, no deadline)', async () => {
  const h = harness();
  await toLevel(h, 1);
  h.clk.advance(30 * 60 * 1000);
  assert.equal(h.eng.status, 'play', 'half an hour of idle play changes nothing');
  assert.equal(h.ev('level:clear').length, 0);
});

await test('invalid calls are ignored, never thrown', async () => {
  const h = harness();
  assert.equal(h.eng.finish(), false);
  assert.equal(h.eng.hint(), false);
  assert.equal(h.eng.claimProve('notbug'), false);
  assert.equal(h.eng.pasteText('# x\na\nb\n## s').ok, false);
  await toLevel(h, 1);
  assert.equal(h.eng.finish(), false, 'finish needs a catch');
  assert.equal(h.eng.claimProve('notbug'), false, 'chip needs a catch');
});

/* ------------------------------------------------------------------ scoring, stars, multiplier */
await test('catch +100, prove (wake) +50, speed bonus capped at +50, 3 stars under par; clear after the grace beat', async () => {
  const h = harness();
  await toLevel(h, 1);
  h.clk.advance(10000);
  catchNow(h, 1);
  assert.equal(last(h, 'level:catch').gained, 100);
  h.lvs[0].proveNow = true;
  tick(h);
  assert.equal(last(h, 'level:prove').points, 50);
  assert.equal(h.eng.status, 'play', 'the clear card waits for the beat');
  h.clk.advance(S.NUM.CLEAR_GRACE_BONUS_MS);
  assert.equal(h.eng.status, 'clear');
  const c = last(h, 'level:clear');
  assert.equal(c.stars, 3);
  assert.equal(c.score, 100 + 50 + 49, 'speed bonus = floor(60 - 10.5)');
  assert.equal(c.ms, 10500, 'time freezes at the prove step, not at the auto-clear');
  assert.equal(c.sticker, 'failed-request');
});

await test('stars: 2 caught+proved over par, 3 needs under par OR the hidden bug; Skip = 1; a caught level cannot be cleared without its feature', async () => {
  const h = harness();
  await toLevel(h, 1);
  h.clk.advance(70000); catchNow(h, 1);
  assert.equal(h.ev('level:clear').length, 0, 'caught only: nothing clears by itself');
  h.lvs[0].proveNow = true; tick(h); h.eng.finish();
  assert.equal(last(h, 'level:clear').stars, 2, 'caught + proved, 70 s on a 60 s par');
  h.eng.next(); await h.eng.go();
  h.clk.advance(50000); catchNow(h, 2); h.eng.claimProve('notbug');
  h.clk.advance(S.NUM.CLEAR_GRACE_BONUS_MS);
  assert.equal(last(h, 'level:clear').stars, 2, '50 s on a 45 s par, no hidden bug');
  h.eng.next(); await h.eng.go();
  h.clk.advance(70000); h.ctxOf(3).emit({ type: 'bonus' }); catchNow(h, 3); h.lvs[2].proveNow = true; tick(h);
  h.clk.advance(S.NUM.CLEAR_GRACE_MS);
  assert.equal(last(h, 'level:clear').stars, 3, 'hidden bug counts for the third star');
});

await test('multiplier: quick catches in a row give x2..x5, the first is x1; a slow catch or a Skip resets it quietly', async () => {
  const h = harness();
  h.eng.start();
  const mults = [];
  for (let k = 1; k <= 5; k++) {
    await h.eng.go(); h.clk.advance(5000); featureReady(h, k); catchNow(h, k);
    mults.push(last(h, 'level:catch').mult); useFeature(h, k); h.eng.finish(); h.eng.next();
  }
  assert.deepEqual(mults, [1, 2, 3, 4, 5]);
  assert.equal(last(h, 'level:catch').gained, 500, 'x5 on the +100 catch');
  const h2 = harness();
  h2.eng.start(); await h2.eng.go(); h2.clk.advance(5000); winNow(h2, 1); h2.eng.next();
  await h2.eng.go(); h2.clk.advance(5000); catchNow(h2, 2); assert.equal(last(h2, 'level:catch').mult, 2);
  useFeature(h2, 2); h2.eng.finish(); h2.eng.next(); await h2.eng.go(); h2.clk.advance(61000); featureReady(h2, 3); catchNow(h2, 3);
  const reset = h2.ev('level:chain').at(-1);
  assert.equal(reset.reset, true); assert.equal(reset.quiet, true); assert.equal(last(h2, 'level:catch').mult, 1);
  h2.eng.finish(); h2.eng.next(); await h2.eng.go(); h2.clk.advance(5000); winNow(h2, 4);
  h2.eng.next(); await h2.eng.go(); h2.eng.skip();
  assert.equal(h2.ev('level:chain').at(-1).reset, true, 'a skipped level resets');
});

await test('the score never goes below 0; the applied delta is clamped, the nominal points are still reported', async () => {
  const h = harness();
  await toLevel(h, 1);
  h.ctxOf(1).emit({ type: 'wrong', kind: 'decoy', id: 'a' });
  const r = last(h, 'score:tool');
  assert.equal(r.points, -25); assert.equal(r.delta, 0); assert.equal(h.eng.score, 0);
  catchNow(h, 1); h.clk.advance(1);
  h.ctxOf(1).emit({ type: 'wrong', kind: 'decoy', id: 'b' });
  assert.equal(h.eng.score, 75);
  h.ctxOf(1).emit({ type: 'wrong', kind: 'decoy', id: 'c' });
  assert.equal(h.eng.score, 50);
});

/* ------------------------------------------------------------------ per-tool deductions: every one has a negative case */
function assertQuietDeduction(h, tool, kind, points) {
  const r = h.ev('score:tool').filter((e) => e.tool === tool && e.kind === kind).at(-1);
  assert.ok(r, `${tool}/${kind} was not deducted`);
  assert.equal(r.outcome, 'wrong'); assert.equal(r.points, points); assert.ok(r.delta < 0 || r.delta === 0);
  assert.equal(r.quiet, true, 'quiet: no shake, no sad sound');
  assert.match(r.reasonKey, /^score\.wrong\./);
  assert.equal(r.reasonKey, S.ruleFor(tool, kind).reasonKey);
  return r;
}
const noDeduction = (h, tool, kind) => assert.equal(h.ev('score:tool').filter((e) => e.tool === tool && e.kind === kind).length, 0, `${tool}/${kind} must not be deducted here`);

await test('wrong page element (decoy): -25 once per element, resets the multiplier, the target itself is never a decoy', async () => {
  const h = await level2WithScore();
  const before = h.eng.score;
  h.ctxOf(2).emit({ type: 'wrong', kind: 'decoy', id: 'remove' });
  const r = assertQuietDeduction(h, 'page', 'decoy', -25);
  assert.equal(r.delta, -25); assert.equal(h.eng.score, before - 25);
  h.ctxOf(2).emit({ type: 'wrong', kind: 'decoy', id: 'remove' });
  assert.equal(h.ev('score:tool').filter((e) => e.kind === 'decoy').length, 1, 'same element twice = one deduction');
  assert.equal(h.ev('level:chain').at(-1).reset, true);
  assert.equal(h.eng.view().mult, 1);
  h.ctxOf(2).emit({ type: 'wrong', kind: 'other', id: 'x' });
  assert.equal(h.ev('score:tool').filter((e) => e.kind === 'decoy').length, 1, 'only decoys deduct');
});

await test('note too early: -25 before the bug is caught; not after; not while the dead-click check runs', async () => {
  const h = await level2WithScore();
  h.sig.counts = { notes: 0, shots: 0 }; tick(h);
  h.sig.counts = { notes: 1, shots: 0 }; tick(h);
  assertQuietDeduction(h, 'note', 'early', -25);
  const h2 = await level2WithScore();
  h2.sig.counts = { notes: 0, shots: 0 }; tick(h2);
  catchNow(h2, 2);
  h2.sig.counts = { notes: 1, shots: 0 }; tick(h2);
  noDeduction(h2, 'note', 'early');
  const h3 = harness();
  await toLevel(h3, 3);
  h3.sig.counts = { notes: 0, shots: 0 }; tick(h3);
  h3.lvs[2].pend = true;
  h3.sig.counts = { notes: 1, shots: 0 }; tick(h3);
  noDeduction(h3, 'note', 'early');
});

await test('duplicate note: a second one within 3 s is -25 once; a later one is fine', async () => {
  const h = await level2WithScore();
  h.sig.counts = { notes: 0, shots: 0 }; tick(h); catchNow(h, 2);
  h.sig.counts = { notes: 1, shots: 0 }; tick(h);
  noDeduction(h, 'note', 'duplicate');
  h.sig.counts = { notes: 2, shots: 0 }; tick(h);
  assertQuietDeduction(h, 'note', 'duplicate', -25);
  h.sig.counts = { notes: 3, shots: 0 }; tick(h);
  assert.equal(h.ev('score:tool').filter((e) => e.kind === 'duplicate').length, 1, 'once per level');
  const h2 = await level2WithScore();
  h2.sig.counts = { notes: 0, shots: 0 }; tick(h2); catchNow(h2, 2);
  h2.sig.counts = { notes: 1, shots: 0 }; tick(h2);
  h2.clk.advance(4000);
  h2.sig.counts = { notes: 2, shots: 0 }; tick(h2);
  noDeduction(h2, 'note', 'duplicate');
  const h3 = await level2WithScore();
  h3.sig.counts = { notes: 0, shots: 0 }; tick(h3); catchNow(h3, 2);
  h3.sig.counts = { notes: 2, shots: 0 }; tick(h3);
  assertQuietDeduction(h3, 'note', 'duplicate', -25);
});

await test('screenshot: wrong level -25 (levels 1,2,3,5); level 4 before the catch -25 (early); level 4 after the catch is fine', async () => {
  const h = await level2WithScore();
  h.sig.counts = { notes: 0, shots: 0 }; tick(h);
  h.sig.counts = { notes: 0, shots: 1 }; tick(h);
  assertQuietDeduction(h, 'shot', 'wrong-level', -25);
  noDeduction(h, 'shot', 'early');
  const h4 = harness();
  await toLevel(h4, 4); h4.sig.counts = { notes: 0, shots: 0 }; tick(h4);
  h4.sig.counts = { notes: 0, shots: 1 }; tick(h4);
  assertQuietDeduction(h4, 'shot', 'early', -25);
  noDeduction(h4, 'shot', 'wrong-level');
  const h4b = harness();
  await toLevel(h4b, 4); h4b.sig.counts = { notes: 0, shots: 0 }; tick(h4b);
  catchNow(h4b, 4);
  h4b.sig.counts = { notes: 0, shots: 1 }; tick(h4b);
  noDeduction(h4b, 'shot', 'early'); noDeduction(h4b, 'shot', 'wrong-level');
});

await test('stop before the bug is caught: -50 (quiet); after the catch it is the right move', async () => {
  const h = await level2WithScore();
  h.sig.state = 'stopped'; tick(h);
  assertQuietDeduction(h, 'stop', 'early', -50);
  const h2 = await level2WithScore();
  catchNow(h2, 2);
  h2.sig.state = 'stopped'; tick(h2);
  noDeduction(h2, 'stop', 'early');
  const h3 = await level2WithScore();
  h3.sig.state = 'recording'; tick(h3);
  noDeduction(h3, 'stop', 'early');
});

await test('correct tool uses score and use the multiplier: note +100, screenshot +100, stop +100, wake +50, chips +50 / 0', async () => {
  const h = harness();
  await toLevel(h, 3); h.clk.advance(2000);
  h.sig.counts = { notes: 0, shots: 0 }; tick(h); catchNow(h, 3);
  h.lvs[2].proveNow = true; tick(h);
  const p = last(h, 'level:prove');
  assert.deepEqual([p.tool, p.points], ['note', 100]);
  const c = harness();
  await toLevel(c, 2); catchNow(c, 2);
  assert.equal(c.eng.claimProve('notbug'), true);
  assert.deepEqual([last(c, 'level:prove').tool, last(c, 'level:prove').points], ['notbug', 100]);
  const d = harness();
  await toLevel(d, 3); catchNow(d, 3);
  assert.equal(d.eng.claimProve('note'), true, 'no qawNotes signal: the chip is offered');
  assert.equal(last(d, 'level:prove').points, 50);
  const e = harness();
  await toLevel(e, 3); e.lvs[2].signal = true; catchNow(e, 3);
  assert.equal(e.eng.claimProve('note'), false, 'with the signal the chip is not accepted');
  assert.equal(e.eng.claimProve('shot'), false, 'wrong chip for the level');
});

await test('scoreboard: per tool correct / wrong / points for the level and the run; same rows the clear card and finale carry', async () => {
  const h = await level2WithScore();
  h.ctxOf(2).emit({ type: 'wrong', kind: 'decoy', id: 'remove' });
  catchNow(h, 2);
  h.eng.claimProve('notbug');
  h.clk.advance(S.NUM.CLEAR_GRACE_BONUS_MS);
  const clear = last(h, 'level:clear');
  assert.deepEqual(clear.board.map((r) => r.tool), S.TOOLS);
  const page = clear.board.find((r) => r.tool === 'page');
  assert.equal(page.wrong, 1); assert.equal(page.correct, 1);
  assert.ok(page.points >= 100 - 25 && page.points <= 100 - 25 + 50, `catch + speed - decoy (${page.points})`);
  const nb = clear.board.find((r) => r.tool === 'notbug');
  assert.deepEqual([nb.correct, nb.wrong, nb.points], [1, 0, 100]);
  const rec = clear.board.find((r) => r.tool === 'recorder');
  assert.deepEqual([rec.correct, rec.wrong, rec.points], [1, 0, 50], 'the recorder caught it');
  const runPage = clear.runBoard.find((r) => r.tool === 'page');
  assert.equal(runPage.correct, 2, 'the run board includes level 1');
  assert.deepEqual(h.eng.scoreboard('run'), clear.runBoard);
  assert.equal(h.eng.scoreboard('level', 2).length, S.TOOLS.length);
});

/* ------------------------------------------------------------------ hint clock, pause */
await test('hint ping: once per level after 8 s of play with no catch; never after a catch; a nudge restarts the idle clock', async () => {
  const h = harness();
  await toLevel(h, 1);
  h.clk.advance(7999); assert.equal(h.ev('level:hint').length, 0);
  h.clk.advance(1); assert.equal(h.ev('level:hint').length, 1);
  assert.equal(last(h, 'level:hint').kind, 'ping');
  h.clk.advance(60000); assert.equal(h.ev('level:hint').length, 1, 'once per level');
  const g = harness(); await toLevel(g, 1); g.clk.advance(1000); catchNow(g, 1); g.clk.advance(30000);
  assert.equal(g.ev('level:hint').length, 0);
  const n = harness(); await toLevel(n, 1); n.clk.advance(5000); n.ctxOf(1).emit({ type: 'nudge', key: 'rail.nudgeAsleep' });
  n.clk.advance(7999); assert.equal(n.ev('level:hint').length, 0); n.clk.advance(1); assert.equal(n.ev('level:hint').length, 1);
  assert.equal(last(n, 'level:nudge').key, 'rail.nudgeAsleep');
  const o = harness(); await toLevel(o, 2); assert.equal(o.eng.hint(), true);
  assert.deepEqual([last(o, 'level:hint').kind, last(o, 'level:hint').key], ['open', 'hint.2']);
});

await test('pause stops the stopwatch and the hint clock and resumes exactly where they were', async () => {
  const h = harness();
  await toLevel(h, 1);
  h.clk.advance(5000);
  assert.equal(h.eng.pause('manual'), true);
  h.clk.advance(60000);
  assert.equal(h.ev('level:hint').length, 0, 'no ping while paused');
  assert.equal(h.eng.view().elapsedMs, 5000);
  assert.equal(h.eng.resume(), true);
  h.clk.advance(2999); assert.equal(h.ev('level:hint').length, 0);
  h.clk.advance(1); assert.equal(h.ev('level:hint').length, 1, 'the remaining 3 s of the 8 s idle clock');
  featureReady(h, 1); catchNow(h, 1);
  assert.equal(last(h, 'level:catch').n, 1);
  h.eng.finish();
  assert.equal(last(h, 'level:clear').ms, 8000, 'the minute of pause is not in the time');
});

await test('auto-pause on a hidden tab ONLY; window blur never pauses; resuming is the player\'s press', async () => {
  const h = harness();
  await toLevel(h, 1);
  const off = h.eng.bindPage(h.doc);
  assert.deepEqual(Object.keys(h.doc.listeners).filter((k) => h.doc.listeners[k].size).sort(), ['qaw:state', 'visibilitychange']);
  assert.equal(Object.keys(h.win.listeners).length, 0, 'nothing is registered on window (no blur)');
  h.win.dispatch('blur'); h.doc.dispatch('blur');
  assert.equal(h.eng.paused, false);
  h.doc.hidden = false; h.doc.dispatch('visibilitychange'); assert.equal(h.eng.paused, false);
  h.doc.hidden = true; h.doc.dispatch('visibilitychange');
  assert.equal(h.eng.paused, true);
  assert.equal(last(h, 'pause').reason, 'hidden');
  h.doc.hidden = false; h.doc.dispatch('visibilitychange');
  assert.equal(h.eng.paused, true, 'coming back does not resume by itself');
  h.eng.togglePause(); assert.equal(h.eng.paused, false);
  off();
  assert.ok(!h.doc.listeners.visibilitychange.size);
});

await test('events while paused do not run the tool watcher (no deduction behind the overlay)', async () => {
  const h = await level2WithScore();
  h.sig.counts = { notes: 0, shots: 0 }; tick(h);
  h.eng.pause('esc');
  h.sig.state = 'stopped'; h.sig.counts = { notes: 5, shots: 5 };
  tick(h, 5000);
  assert.equal(h.ev('score:tool').filter((e) => e.outcome === 'wrong').length, 0);
});

/* ------------------------------------------------------------------ storage and prefs */
await test('storage: key bughunt.v1, exact shape, best time only improves, skipped levels earn no time or sticker, Reset clears progress and keeps prefs', async () => {
  const st = memStorage();
  const h = harness({ storage: st });
  await toLevel(h, 1); h.clk.advance(20000); winNow(h, 1);
  const saved = JSON.parse(st.getItem(STORAGE_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ['best', 'bonus', 'prefs', 'stars', 'stickers']);
  assert.deepEqual(Object.keys(saved.prefs).sort(), ['calm', 'lang', 'sound', 'theme', 'voice', 'volume']);
  assert.deepEqual(Object.keys(saved.best).sort(), ['l1', 'l2', 'l3', 'l4', 'l5', 'run']);
  assert.deepEqual(Object.keys(saved.stickers).sort(), ['console', 'dead-button', 'failed-request', 'layout', 'slow-call']);
  assert.equal(saved.best.l1, 20000); assert.equal(saved.stickers['failed-request'], true); assert.equal(saved.stars.l1, 3, 'proved and under par');
  assert.doesNotMatch(JSON.stringify(saved), /\d{4}-\d{2}-\d{2}|date|day|stamp/i, 'no date-keyed state');
  h.eng.next(); await h.eng.go(); h.eng.skip();
  const s2 = JSON.parse(st.getItem(STORAGE_KEY));
  assert.equal(s2.best.l2, null); assert.equal(s2.stickers.console, false); assert.equal(s2.stars.l2, 1);
  const h2 = harness({ storage: st });
  await toLevel(h2, 1); h2.clk.advance(30000); winNow(h2, 1);
  assert.equal(h2.eng.view().best.l1, 20000, 'a slower run does not replace the best');
  h2.eng.next(); h2.eng.restart(); await h2.eng.go(); h2.clk.advance(9000); winNow(h2, 1);
  assert.equal(last(h2, 'level:clear').newBest, true); assert.equal(h2.eng.view().best.l1, 9000);
  assert.equal(h2.eng.setPref('lang', 'ar'), true);
  h2.eng.resetProgress();
  const s3 = JSON.parse(st.getItem(STORAGE_KEY));
  assert.equal(s3.best.l1, null); assert.equal(s3.stickers['failed-request'], false); assert.equal(s3.prefs.lang, 'ar');
});

await test('storage: corrupt JSON, wrong types and a throwing localStorage all fall back to defaults and never throw', async () => {
  const bad = memStorage(); bad.setItem(STORAGE_KEY, '{not json');
  assert.equal(harness({ storage: bad }).eng.getPrefs().lang, 'en');
  const odd = memStorage(); odd.setItem(STORAGE_KEY, JSON.stringify({ prefs: { lang: 'fr', volume: 'x', sound: 'yes' }, best: { l1: -5, run: 'a' }, stars: { l1: 9 }, stickers: { console: 1 } }));
  const h = harness({ storage: odd });
  assert.deepEqual(h.eng.getPrefs(), { lang: 'en', theme: 'auto', sound: true, voice: true, volume: 60, calm: false });
  assert.equal(h.eng.view().best.l1, null); assert.equal(h.eng.view().stars.l1, 0); assert.equal(h.eng.view().stickers.console, false);
  const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() {} };
  const hb = harness({ storage: boom });
  await toLevel(hb, 1); assert.equal(winNow(hb, 1), true);
  const none = createEngine({ clock: fakeClock(), storage: null, levels: [1, 2, 3, 4, 5].map(fakeLevel), root: new FakeEl('div', fakeDoc()), qawState: () => null, qawCounts: () => null });
  assert.equal(none.setPref('volume', 150), true); assert.equal(none.getPrefs().volume, 100);
  assert.equal(none.setPref('theme', 'neon'), false); assert.equal(none.setPref('sound', 'on'), false);
});

/* ------------------------------------------------------------------ the shared signals */
await test('readQawState / readQawCounts: fixed enum and integers only; nothing else is believed', () => {
  const mk = (ds) => ({ documentElement: { dataset: ds } });
  for (const s of ['asleep', 'ready', 'recording', 'stopped']) assert.equal(readQawState(mk({ qawState: s })), s);
  for (const s of ['', 'READY', 'https://x', undefined, '<b>']) assert.equal(readQawState(mk({ qawState: s })), null);
  assert.equal(readQawCounts(mk({})), null);
  const full = (o) => ({ notes: null, shots: null, shortcut: null, expected: null, noteTypes: null, marks: null, buffer: null, ...o });
  assert.deepEqual(readQawCounts(mk({ qawNotes: '3', qawShots: '0' })), full({ notes: 3, shots: 0 }));
  assert.deepEqual(readQawCounts(mk({ qawNotes: '2' })), full({ notes: 2 }));
  assert.deepEqual(readQawCounts(mk({ qawNotes: '0', qawShots: '0', qawShortcut: '1', qawExpected: '2', qawNoteTypes: '0', qawMarks: '4', qawBuffer: '1' })),
    { notes: 0, shots: 0, shortcut: 1, expected: 2, noteTypes: 0, marks: 4, buffer: 1 }, 'all seven count-only signals');
  assert.deepEqual(readQawCounts(mk({ qawExpected: 'x', qawMarks: '-3', qawBuffer: '' })), null, 'only whole numbers are believed');
  assert.deepEqual(readQawCounts(mk({ qawNotes: '-1', qawShots: '1.5' })), null);
  assert.equal(readQawState(null), null);
});

/* ------------------------------------------------------------------ the paste-only finale */
const T0 = 1_791_724_838_000;
const session = { id: 's_x', charter: 'Untitled session', startedAt: T0, endedAt: T0 + 5000, startUrl: 'http://localhost:4173/', env: {} };
const bugEvents = [
  { kind: 'dom', action: 'click', label: 'Save', tag: 'button', locator: "getByRole('button', { name: 'Save' })", ts: T0 + 100, frameUrl: 'http://localhost:4173/' },
  { kind: 'net', method: 'POST', url: 'http://localhost:4173/api/save-profile', status: 500, error: true, durationMs: 3, ts: T0 + 110, frameUrl: 'http://localhost:4173/' },
  { kind: 'note', tag: 'bug', text: 'Save says Saved but fails', ts: T0 + 300, frameUrl: 'http://localhost:4173/' },
];
const bugReport = buildMarkdown(session, bugEvents);
const cleanReport = buildMarkdown(session, []);

await test('inspectReport accepts the real copied report format (pinned against buildMarkdown), EN and the AR row label', () => {
  const r = inspectReport(bugReport);
  assert.equal(r.ok, true, bugReport.slice(0, 200));
  assert.match(r.heading, /^# \S/); assert.ok(r.heading.length <= 60); assert.ok(r.lines >= 3); assert.equal(r.bug, true);
  const c = inspectReport(cleanReport);
  assert.equal(c.ok, true); assert.equal(c.bug, false, 'a report whose Problems row is 0 has no bug in it');
  assert.equal(inspectReport('# عنوان\n\n| المشكلات | ٠ |\n\n## خطوات\nx').bug, false);
  assert.equal(inspectReport('# عنوان\n\n| المشكلات | ٣ |\n\n## خطوات\nx').bug, true);
  assert.equal(inspectReport('# t\nSteps\nsomething\nelse').ok, true, 'a line starting with Steps also satisfies the token');
});

await test('inspectReport refuses everything else: `# x` alone, plain text, too few lines, no token, typed markdown, non-strings; heading cut at 60', () => {
  for (const bad of ['# x', '# x\n\n\n', 'hello\nworld\nthree\n## s', '#nospace\na\nb\n## s', '# t\nb\nc', '', null, undefined, 42, '## s\n# t\nc\nd']) assert.equal(inspectReport(bad).ok, false, String(bad));
  const long = inspectReport(`# ${'x'.repeat(200)}\na\nb\n## s`);
  assert.equal(long.ok, true); assert.equal(long.heading.length, 60); assert.ok(long.heading.endsWith('…'));
  assert.equal(inspectReport(`﻿# t\r\na\r\nb\r\n## s\r\n`).lines, 4);
});

async function finale() {
  const h = harness();
  h.eng.start();
  for (let k = 1; k <= 5; k++) { await h.eng.go(); h.eng.skip(); h.eng.next(); }
  assert.equal(h.eng.status, 'finale');
  return h;
}

await test('paste gate: only the paste event; the textarea is emptied; only heading + line count come back; nothing is stored or sent', async () => {
  const h = await finale();
  const ta = new FakeEl('textarea', h.doc); ta.value = 'typed';
  const before = JSON.stringify(h.storage.writes());
  let fetches = 0;
  const realFetch = globalThis.fetch; globalThis.fetch = () => { fetches++; return Promise.reject(new Error('no')); };
  const results = [];
  const off = h.eng.bindPasteGate(ta, (r) => results.push(r));
  try {
    assert.deepEqual(Object.keys(ta.listeners).filter((k) => ta.listeners[k].size), ['paste'], 'no input, keydown or change listener');
    let prevented = 0;
    ta.fire('paste', { preventDefault() { prevented++; }, clipboardData: { getData: () => bugReport } });
    assert.equal(prevented, 1); assert.equal(ta.value, '');
    assert.equal(results[0].ok, true);
    const shown = JSON.stringify([results[0], h.ev('finale:pasted')]);
    assert.ok(!shown.includes('api/save-profile'), 'body text never comes back');
    assert.ok(!shown.includes('Steps to reproduce'));
    assert.deepEqual(Object.keys(results[0]).sort(), ['bug', 'heading', 'lines', 'ok']);
    ta.fire('paste', { preventDefault() {}, clipboardData: { getData: () => 'just some words' } });
    assert.equal(results[1].ok, false); assert.equal(h.ev('finale:notyet').length, 1);
    assert.equal(ta.value, '');
    ta.fire('paste', { preventDefault() {}, clipboardData: { getData: () => { throw new Error('denied'); } } });
    assert.equal(results[2].ok, false);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(JSON.stringify(h.storage.writes()), before, 'nothing written to storage');
  assert.equal(fetches, 0);
  off();
  assert.ok(!ta.listeners.paste.size);
  const src = fs.readFileSync(path.join(GAME_DIR, 'engine.js'), 'utf8');
  assert.doesNotMatch(src, /clipboard\.read|readText|execCommand|sendBeacon|XMLHttpRequest|WebSocket|indexedDB|document\.cookie/);
});

await test('copy tool: a valid report with a bug +100 (once per run); a report with no bug -50 quietly; junk costs nothing', async () => {
  const h = await finale();
  const s0 = h.eng.score;
  assert.equal(h.eng.pasteText('nonsense').ok, false);
  assert.equal(h.eng.score, s0);
  assert.equal(h.eng.pasteText(bugReport).ok, true);
  const ok = h.ev('score:tool').at(-1);
  assert.deepEqual([ok.tool, ok.kind, ok.delta], ['copy', 'report', 100]);
  h.eng.pasteText(bugReport);
  assert.equal(h.ev('score:tool').filter((e) => e.tool === 'copy').length, 1, 'scored once per run');
  const g = await finale();
  assert.equal(g.eng.pasteText(cleanReport).ok, true);
  const bad = g.ev('score:tool').at(-1);
  assert.deepEqual([bad.tool, bad.kind, bad.outcome, bad.points, bad.quiet, bad.reasonKey], ['copy', 'no-bug', 'wrong', -50, true, 'score.wrong.copy-no-bug']);
  assert.equal(g.eng.score, 0, 'clamped at 0');
  assert.equal(last(g, 'finale:pasted').bug, false);
  assert.equal(g.eng.scoreboard('run').find((r) => r.tool === 'copy').wrong, 1);
});

/* ------------------------------------------------------------------ feature chips (owner amend: each level teaches one real QA Wrap feature) */
await test('optional feature chips: self-reported, once per level, only when due, bonus points with the multiplier, never required', async () => {
  const h = harness();
  await toLevel(h, 1);
  assert.equal(h.eng.claimChip('shortcut'), true);
  assert.deepEqual([last(h, 'level:chip').tool, last(h, 'level:chip').points], ['shortcut', 50]);
  assert.equal(h.eng.claimChip('shortcut'), false, 'once per level');
  assert.equal(h.eng.claimChip('buffer'), false, 'another level chip');
  assert.equal(h.eng.claimChip('nope'), false);
  const h3 = harness();
  await toLevel(h3, 3);
  assert.equal(h3.eng.claimChip('notetype'), false, 'after:caught chips wait for the catch');
  assert.equal(h3.eng.view().chips[0].available, false);
  catchNow(h3, 3);
  assert.equal(h3.eng.view().chips[0].available, true);
  assert.equal(h3.eng.claimChip('notetype'), true);
  assert.equal(h3.eng.scoreboard('level', 3).find((r) => r.tool === 'notetype').points, 50);
  h3.eng.pause('x'); assert.equal(h3.eng.claimChip('notetype'), false);
  const h5 = harness();
  await toLevel(h5, 5); catchNow(h5, 5);
  assert.equal(h5.eng.claimChip('buffer'), true);
  assert.equal(h5.eng.view().proved, false, 'a chip is not the feature: the level still needs Stop');
  h5.lvs[4].proveNow = true; tick(h5);
  assert.equal(h5.eng.finish(), true);
  assert.equal(last(h5, 'level:clear').stars, 3);
});

await test('level 2 teaches the recorder + Not a bug: the recorder is credited with the catch; the Not-a-bug chip needs the harmless failure first', async () => {
  const h = harness();
  await toLevel(h, 2);
  h.ctxOf(2).emit({ type: 'noise' });
  assert.equal(last(h, 'level:noise').n, 2);
  assert.equal(h.ev('score:tool').length, 0, 'noise is never a deduction or a catch');
  h.lvs[1].chipOk = false;
  catchNow(h, 2);
  assert.deepEqual([last(h, 'score:tool').tool, last(h, 'score:tool').delta], ['recorder', 50]);
  assert.equal(last(h, 'level:catch').feature, 'recorder');
  assert.equal(h.eng.view().chipAvailable, false, 'the chip waits for the harmless failure');
  assert.equal(h.eng.view().needs, 'noise');
  assert.equal(h.eng.claimProve('notbug'), false, 'the harmless failure has not happened yet');
  assert.equal(h.eng.claimProve('console'), false, 'the old chip id is gone');
  h.lvs[1].chipOk = true;
  assert.equal(h.eng.view().needs, 'feature'); assert.equal(h.eng.view().chipAvailable, true);
  assert.equal(h.eng.claimProve('notbug'), true);
  assert.equal(h.eng.view().needs, null);
});

await test('featureFor: the level card names the feature and its icon, the clear card the one-line lesson, in EN and AR', () => {
  for (let k = 1; k <= 5; k++) {
    const e = featureFor(k, 'en'); const a = featureFor(k, 'ar');
    assert.ok(e.primary.name && a.primary.name && e.primary.icon === a.primary.icon);
    assert.ok(e.learn.length > 20 && a.learn.length > 20);
    assert.ok(e.learn.split(/\s+/).length <= 20, `L${k} lesson is one short line`);
    assert.equal(e.n, k);
  }
  assert.equal(featureFor(1, 'en').primary.name, 'Test this site');
  assert.equal(featureFor(1, 'ar').primary.name, 'اختبر هذا الموقع');
  assert.equal(featureFor(5, 'en').names, 'Stop -> Copy report');
  assert.equal(featureFor(2, 'en').with[0].name, 'Not a bug');
  assert.deepEqual(featureFor(1, 'en').extras.map((x) => x.id), ['shortcut']);
  assert.equal(featureFor(1, 'en').extras[0].chip, 'I used the shortcut');
  assert.equal(featureFor(6, 'en'), null);
});

/* ------------------------------------------------------------------ amend: a level is won with its feature; counts from the extension replace the chips */
await test('finish() clears a caught level at once (unmet goals score 0, 1 star); with the feature used it is 2+ stars; Skip still works; the clear event names the learned feature', async () => {
  const h = harness();
  await toLevel(h, 1);
  assert.equal(h.eng.view().needs, 'catch');
  catchNow(h, 1);
  assert.equal(h.eng.view().needs, 'feature'); assert.equal(h.eng.view().canFinish, true, 'Nader 15 Oct 2026: Finish level always advances');
  { const u = harness(); await toLevel(u, 1); catchNow(u, 1); assert.equal(u.eng.finish(), true); const c0 = last(u, 'level:clear'); assert.deepEqual([c0.caught, c0.proved, c0.stars], [true, false, 1]); assert.ok(c0.levelScore > 0, 'points earned are kept'); }
  assert.equal(h.eng.status, 'play'); assert.equal(h.ev('level:clear').length, 0);
  h.lvs[0].proveNow = true; tick(h);
  assert.equal(h.eng.view().canFinish, true);
  assert.equal(h.eng.finish(), true);
  const c = last(h, 'level:clear');
  assert.ok(c.proved && c.stars >= 2);
  assert.equal(c.learned.primary.name, 'Test this site', 'QA Wrap own name, not "Wake up"');
  assert.equal(c.learned.n, 1); assert.ok(c.learned.learn.length > 20);
  const row = c.board.find((r) => r.tool === 'wake');
  assert.deepEqual([row.name, row.icon], ['Test this site', 'awake']);
  assert.equal(c.board.find((r) => r.tool === 'page').key, 'score.tool.page');
  const g = harness(); await toLevel(g, 1); catchNow(g, 1);
  assert.equal(g.eng.skip(), true, 'Skip is always there'); assert.equal(last(g, 'level:clear').skipped, true);
});

await test('the learned feature follows the player language (AR name on the clear card, scoreboard and finale) and the finale lists all five', async () => {
  const h = harness();
  h.eng.setPref('lang', 'ar');
  h.eng.start(); await h.eng.go();
  winNow(h, 1);
  const c = last(h, 'level:clear');
  assert.equal(c.learned.primary.name, 'اختبر هذا الموقع');
  assert.equal(c.board.find((r) => r.tool === 'wake').name, 'اختبر هذا الموقع');
  h.eng.next();
  for (let k = 2; k <= 5; k++) { await h.eng.go(); h.eng.skip(); h.eng.next(); }
  const f = last(h, 'finale');
  assert.equal(f.learned.length, 5);
  assert.deepEqual(f.learned.map((x) => x.primary.id), ['wake', 'recorder', 'note', 'shot', 'stop']);
  assert.equal(f.learned[0].primary.name, 'اختبر هذا الموقع');
  assert.equal(f.board.find((r) => r.tool === 'notbug').name, 'ليست علّة');
});

await test('feature chips follow the extension counts when shared: a rise AFTER the catch claims the chip by itself; the self-report is refused', async () => {
  const h = harness();
  h.sig.counts = { notes: 0, shots: 0, shortcut: 0, expected: 0, noteTypes: 0, marks: 0, buffer: 0 };
  await toLevel(h, 3);
  h.sig.counts = { ...h.sig.counts, noteTypes: 1 }; tick(h);
  assert.equal(h.ev('level:chip').length, 0, 'a note type chosen before the catch does not count');
  assert.equal(h.eng.view().chips[0].auto, true);
  catchNow(h, 3);
  assert.equal(h.eng.claimChip('notetype'), false, 'read, not claimed');
  h.sig.counts = { ...h.sig.counts, noteTypes: 2 }; tick(h);
  const chip = last(h, 'level:chip');
  assert.deepEqual([chip.id, chip.points, chip.via], ['notetype', 50, 'signal']);
  h.sig.counts = { ...h.sig.counts, noteTypes: 3 }; tick(h);
  assert.equal(h.ev('level:chip').length, 1, 'once per level');
  const s = harness();
  s.sig.counts = { notes: 0, shots: 0, shortcut: 0 };
  await toLevel(s, 1);
  s.sig.counts = { ...s.sig.counts, shortcut: 1 }; tick(s);
  assert.deepEqual([last(s, 'level:chip').id, last(s, 'level:chip').via], ['shortcut', 'signal']);
  const m = harness(); m.sig.counts = { notes: 0, shots: 0, marks: 0 };
  await toLevel(m, 4); catchNow(m, 4);
  m.sig.counts = { ...m.sig.counts, marks: 1 }; tick(m);
  assert.equal(last(m, 'level:chip').id, 'markup');
  const b = harness(); b.sig.counts = { notes: 0, shots: 0, buffer: 0 };
  await toLevel(b, 5); catchNow(b, 5);
  b.sig.counts = { ...b.sig.counts, buffer: 1 }; tick(b);
  assert.equal(last(b, 'level:chip').id, 'buffer');
  const none = harness(); none.sig.counts = { notes: 0, shots: 0 };
  await toLevel(none, 4); catchNow(none, 4);
  assert.equal(none.eng.view().chips[0].auto, false); assert.equal(none.eng.claimChip('markup'), true, 'no count shared: the self-report works');
});

/* ------------------------------------------------------------------ the data file and the source hygiene */
await test('scoring table: one JSON file; every wrong row has a reason key; every tool has a label key; wrong rows negative, correct rows >= 0', async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(GAME_DIR, 'scoring.json'), 'utf8'));
  assert.deepEqual(Object.keys(raw.tools), S.TOOLS);
  for (const r of S.RULES) {
    if (r.outcome === 'wrong') { assert.ok(r.points < 0 && r.points >= -50, `${r.tool}/${r.kind}`); assert.match(r.reasonKey, /^score\.wrong\.[a-z-]+$/); } else assert.ok(r.points >= 0);
  }
  for (const tool of S.TOOLS) assert.equal(S.TOOL_KEY[tool], `score.tool.${tool}`);
  for (const [tool, def] of Object.entries(raw.tools)) if (def.wrong) assert.ok(def.wrong.reason && def.wrong.points < 0, tool);
  assert.equal(S.scoringKeys().length, 1 + 7, 'page label + seven reasons; feature tools are labelled from features.json');
  const { toolLabel } = await imp('engine.js');
  assert.deepEqual(toolLabel('notbug', 'ar'), { tool: 'notbug', icon: 'event-request', name: 'ليست علّة' });
  assert.equal(toolLabel('page').key, 'score.tool.page');
  assert.equal(S.ruleFor('note', 'nope'), null);
});

await test('game logic source: no forbidden token, no randomness, no external URL, no network API beyond the injected fetch', () => {
  const files = ['engine.js', 'scoring.js', 'scoring.json', 'features.json', 'server.mjs', ...[1, 2, 3, 4, 5].map((k) => `levels/l${k}.js`)];
  for (const f of files) {
    const src = fs.readFileSync(path.join(GAME_DIR, f), 'utf8');
    assert.doesNotMatch(src, /streak|daily|freeze|flame|combo|leaderboard|notification|alarm|Math\.random/i, f);
    assert.doesNotMatch(src, /https?:\/\/(?!localhost|127\.0\.0\.1)/i, `${f} names an external URL`);
    assert.doesNotMatch(src, /\bimport\s*\(\s*['"]https?|new Date|Date\.now|crypto\.getRandomValues/, f);
    assert.doesNotMatch(src, /font-family|Cairo/, f);
    assert.ok(!src.includes('\r'), `${f} is LF`);
  }
});

done();
