/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt logic (DESIGN-bug-hunt sections 10-12, owner changes of 2026-10-12): the five level detectors with every negative
 * case, the quiet combo, stars and score, the paste gate pinned to the REAL report output, and the storage shape.
 *
 *   node tools/test-game-levels.mjs        (from extension/, PYTHONUTF8=1)
 *
 * Plain node, no browser. detect() of each level is pure (event in, verdict out). The engine is the real engine.js on a fake
 * clock with stand-in levels (lib-game-engine.mjs). The DOM side of the levels (mutations outside #app, real overflow, the
 * 1200 ms dead-click window) is test-game-levels-dom.mjs. Until extension/game/ lands the suite exits 2, never green.
 */
import { assert, ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import { has, gameSources, loadLevel, makeEngine, STORE_KEY, imp } from './lib-game-engine.mjs';
import { buildMarkdown } from '../core/artifact-docs.js';

if (!has('engine.js', 'scoring.js', 'levels/l1.js', 'levels/l5.js')) {
  skipNotEnforced({ rule: 'game', what: 'level detectors, combo, stars, paste gate, storage', why: 'extension/game/engine.js and levels/ (lane B) have not landed' });
  finish('test-game-levels', { skipped: 1 });
}

/* ---- section 11, every level: positive and negatives --------------------------------------------------------------- */
const L = {};
for (let n = 1; n <= 5; n++) {
  L[n] = await loadLevel(n);
  for (const f of ['mount', 'arm', 'detect', 'proveSignal', 'dispose']) ok(typeof L[n][f] === 'function', `levels/l${n}.js exports ${f}()`);
}
const det = (n, evt) => L[n].detect(evt);
const yes = (n, evt) => det(n, evt).caught === true;

ok(yes(1, { type: 'save', status: 500, saidSaved: true, qaw: 'ready' }), 'L1: status 500 + the page said Saved + QA Wrap ready catches');
ok(yes(1, { type: 'save', status: 503, saidSaved: true, qaw: 'recording' }), 'L1: ... also while recording and for any status >= 500');
ok(!yes(1, { type: 'save', status: 200, saidSaved: true, qaw: 'ready' }), 'L1 negative: status 200 does not catch');
ok(!yes(1, { type: 'save', status: 500, saidSaved: false, qaw: 'ready' }), 'L1 negative: 500 but the page did not say Saved does not catch');
ok(!yes(1, { type: 'load', qaw: 'ready' }) && !yes(1, undefined) && !yes(1, null), 'L1 negative: Save never pressed (load, nothing, null)');
{
  const r = det(1, { type: 'save', status: 500, saidSaved: true, qaw: 'asleep' });
  ok(!r.caught && r.nudge === 'rail.nudgeAsleep', 'L1 negative: QA Wrap asleep does not catch and asks for the nudge ("QA Wrap is asleep. Press its main button.")');
  ok(yes(1, { type: 'save', status: 500, saidSaved: true, qaw: 'ready' }), 'L1: pure detect keeps no state, so the bug stays armed and catches once QA Wrap is awake');
  ok(!yes(1, { type: 'save', status: 500, saidSaved: true, qaw: 'stopped' }) && !yes(1, { type: 'save', status: 500, saidSaved: true }), 'L1 negative: "stopped" or an unknown state is not awake');
}
ok(yes(2, { type: 'error', error: { __game: 'l2' }, qaw: 'ready' }), 'L2: an error marked __game:l2 + QA Wrap ready catches');
ok(!yes(2, { type: 'error', error: new TypeError('foreign'), qaw: 'ready' }), 'L2 negative: a foreign error (no marker) does not catch');
ok(!yes(2, { type: 'error', error: { __game: 'l3' }, qaw: 'ready' }), 'L2 negative: another level\'s marker does not catch');
ok(!yes(2, { type: 'error', error: { __game: 'l2' }, qaw: 'asleep' }) && det(2, { type: 'error', error: { __game: 'l2' }, qaw: 'asleep' }).nudge, 'L2 negative: the marker error while asleep does not catch (nudge)');
ok(!yes(2, { type: 'error', qaw: 'ready' }) && !yes(2, { type: 'error', error: null, qaw: 'ready' }), 'L2 negative: an error event with no error object does not catch');

ok(yes(3, { type: 'click', id: 'next', mutated: false, fetched: false }), 'L3: click #next, no #app change and no fetch in the window, catches');
ok(!yes(3, { type: 'click', id: 'next', mutated: true, fetched: false }), 'L3 negative: a mutation inside #app does not catch');
ok(!yes(3, { type: 'click', id: 'next', mutated: false, fetched: true }), 'L3 negative: a fetch after the click does not catch');
ok(!yes(3, { type: 'click', id: 'save', mutated: false, fetched: false }), 'L3 negative: a click elsewhere does not catch');
ok(!yes(3, { type: 'load' }), 'L3 negative: loading alone does not catch');

ok(yes(4, { type: 'click', id: 'ref', overflow: true }), 'L4: click #ref while the overflow is true catches');
ok(!yes(4, { type: 'click', id: 'ref', overflow: false }), 'L4 negative: overflow false (window widened) does not catch');
ok(!yes(4, { type: 'click', id: 'next', overflow: true }), 'L4 negative: a click elsewhere does not catch');
ok(!yes(4, { type: 'load', overflow: true }), 'L4 negative: load alone does not catch');

ok(yes(5, { type: 'pay', durationMs: 4000, ok: true }), 'L5: pay duration > 3000 ms catches');
ok(!yes(5, { type: 'pay', durationMs: 1200, ok: true }), 'L5 negative: pay in 1200 ms does not catch');
ok(!yes(5, { type: 'pay', durationMs: 3000, ok: true }), 'L5 negative: exactly 3000 ms is not "more than 3000"');
ok(!yes(5, { type: 'pay', durationMs: 4000, ok: false }), 'L5 negative: a slow FAILED pay is not the slow-call bug');

for (let n = 1; n <= 5; n++) {
  ok(det(n, { type: 'bonus-click' }).bonus === true && !det(n, { type: 'bonus-click' }).caught, `L${n}: the hidden bonus is a bonus, never a catch`);
  const dc = det(n, { type: 'decoy-click', id: 'x' });
  ok(dc.decoy === 'x' && !dc.caught, `L${n}: a decoy click is flagged, never a catch`);
}
proveTeeth('the detector table', ([a, b]) => (a === b ? [] : ['mismatch']), [yes(1, { type: 'save', status: 200, saidSaved: true, qaw: 'ready' }), true]);

/* ---- the paste gate, pinned to the real report ---------------------------------------------------------------------- */
{
  const { inspectReport } = await imp('engine.js');
  const T0 = 1_791_724_838_000;
  const PRACTICE = 'http://localhost:4173/';
  const sess = { id: 's_x', charter: 'Untitled session', startedAt: T0, endedAt: T0 + 5000, startUrl: PRACTICE, env: {} };
  const note = { kind: 'note', tag: 'bug', text: 'Save says Saved but fails', ts: T0 + 4000, frameUrl: PRACTICE };
  const net = { kind: 'net', method: 'POST', url: `${PRACTICE}api/save-profile`, status: 500, durationMs: 4, ts: T0 + 2000, frameUrl: PRACTICE };
  const withBug = buildMarkdown(sess, [{ kind: 'dom', action: 'click', label: 'Save', tag: 'button', locator: "getByRole('button', { name: 'Save' })", ts: T0 + 1000, frameUrl: PRACTICE }, net, note]);
  const clean = buildMarkdown({ ...sess, id: 's_y' }, [{ kind: 'dom', action: 'click', label: 'Save', tag: 'button', locator: "getByRole('button', { name: 'Save' })", ts: T0 + 1000, frameUrl: PRACTICE }]);
  const a = inspectReport(withBug);
  ok(a.ok && a.heading.startsWith('# ') && a.heading.length <= 60 && a.lines >= 3, 'paste gate: the REAL buildMarkdown output with a problem is accepted', JSON.stringify({ ...a, withBug: withBug.slice(0, 80) }));
  ok(a.bug === true, 'paste gate: a report with problems is marked as listing a bug');
  const c = inspectReport(clean);
  ok(c.ok && c.bug === false, 'paste gate: a real report with 0 problems is accepted but marked "no bug" (it scores a deduction)', JSON.stringify(c));
  ok(/\n## /.test(withBug), 'the real report has a "## " section (the stable token the gate relies on)');
  ok(!inspectReport('# x').ok, 'paste gate negative: "# x" alone is not a report');
  ok(!inspectReport('just words\nmore words\neven more\nSteps').ok, 'paste gate negative: no "# " heading is not a report');
  ok(!inspectReport('# x\nplain\nplain').ok, 'paste gate negative: three lines but no "Steps" or "## " line is not a report');
  ok(!inspectReport('').ok && !inspectReport(null).ok && !inspectReport('   \n  \n').ok, 'paste gate negative: empty, null, blank');
  const long = inspectReport(`# ${'T'.repeat(120)}\n## a\nb`);
  ok(long.ok && long.heading.length <= 60, 'paste gate: a long heading is cut to 60 characters');
  ok(!('text' in a) && !JSON.stringify(a).includes('save-profile') && withBug.includes('save-profile'), 'paste gate: the verdict carries the heading and the line count, never the body');
  proveTeeth('the paste gate', (t) => (inspectReport(t).ok ? [] : ['rejected']), '# nope');
}

/* ---- combo (owner change 1): quick catches multiply, a miss resets quietly ---------------------------------------- */
{
  const E = await makeEngine();
  const gained = [];
  await E.engine.start();
  for (let k = 1; k <= 5; k++) {
    await E.engine.go();
    E.clk.advance(5000);
    E.L.ctxs[k].emit({ type: 'catch' });
    gained.push(E.ev('level:catch').at(-1).gained);
    E.L.flags[k].prove = true; E.clk.advance(500); // a level is won with its feature (amend 3): the prove signal first
    E.engine.finish();
    E.engine.next();
  }
  ok(gained.join() === '100,200,300,400,500', 'combo: five quick catches in a row score 100 x1, x2, x3, x4, x5', gained.join());
  const chain = E.ev('level:chain');
  ok(chain.length === 5 && chain.every((c) => c.quiet === true && c.reset === false), 'combo: every step is a quiet "level:chain" event (no sound or animation asked for)');
  ok(Math.max(...chain.map((c) => c.mult)) === 5, 'combo: the multiplier is capped at x5');

  const F = await makeEngine();
  F.engine.start();
  const mult = [];
  for (let k = 1; k <= 4; k++) {
    await F.engine.go();
    F.clk.advance(k === 4 ? 80_000 : 5000); // level 4 is caught slowly: past its 50 s par
    F.L.ctxs[k].emit({ type: 'catch' });
    mult.push(F.ev('level:catch').at(-1).mult);
    F.L.flags[k].prove = true; F.clk.advance(500);
    F.engine.finish();
    F.engine.next();
  }
  ok(mult.join() === '1,2,3,1', 'combo: a slow catch resets the multiplier to x1', mult.join());
  const rs = F.ev('level:chain').at(-1);
  ok(rs.reset === true && rs.quiet === true && rs.mult === 1, 'combo: the reset is a quiet event (reset:true, quiet:true)', JSON.stringify(rs));
  const names = new Set(F.log.map((e) => e.type));
  ok([...names].every((t) => !/sad|shake|buzz|penalt|fail|lose|wrong|mistake|error/i.test(t)), 'combo: no sad / shake / penalty / error event exists in the whole run', [...names].join(','));
  ok(F.ev('level:chain').every((c) => !('sound' in c) && !('sfx' in c) && !('anim' in c)), 'combo: no chain event asks for a sound or an animation');

  const G = await makeEngine();
  await G.at(2, { play: true, score: true });
  G.L.ctxs[2].emit({ type: 'wrong', kind: 'decoy', id: 'remove' });
  const last = G.ev('level:chain').at(-1);
  ok(G.ev('score:tool').some((e) => e.outcome === 'wrong') && (!last || last.mult === 1), 'combo: a wrong action also resets it (x1)');
}

/* ---- stars and score (section 2.5) ---------------------------------------------------------------------------------- */
{
  const { PAR_S, NUM } = await imp('scoring.js');
  ok(JSON.stringify(PAR_S) === JSON.stringify({ 1: 60, 2: 45, 3: 60, 4: 50, 5: 80 }), 'par seconds are 60 / 45 / 60 / 50 / 80', JSON.stringify(PAR_S));
  ok(NUM.SPEED_MAX === 50, 'the speed bonus is capped at +50');
  async function run({ catchIt = true, prove = false, bonus = false, ms = 70_000 } = {}) {
    const E = await makeEngine();
    await E.at(1);
    E.clk.advance(ms);
    if (bonus) E.L.ctxs[1].emit({ type: 'bonus' });
    if (catchIt) E.L.ctxs[1].emit({ type: 'catch' });
    if (prove) { E.L.flags[1].prove = true; E.clk.advance(500); }
    const before = E.ev('level:clear').length;
    if (E.engine.status === 'play') { if (catchIt) E.engine.finish(); else E.engine.skip(); } // Finish clears a caught level (Nader, 15 Oct 2026); Skip the uncaught one
    if (E.ev('level:clear').length === before) E.clk.advance(10_000); // the auto-clear beat after the prove step
    return E.ev('level:clear').at(-1);
  }
  const skipped = await run({ catchIt: false });
  ok(skipped.stars === 1 && skipped.skipped, 'stars: a skipped level is 1 star ("try later")', JSON.stringify(skipped.stars));
  { const E = await makeEngine(); await E.at(1); E.clk.advance(70_000); E.L.ctxs[1].emit({ type: 'catch' });
    ok(E.ev('level:clear').length === 0 && E.engine.view().canFinish === true, 'caught but not proved: nothing clears by itself, Finish is enabled (Nader, 15 Oct 2026)');
    ok(E.engine.finish() === true && E.ev('level:clear').at(-1).stars === 1 && E.ev('level:clear').at(-1).proved === false, 'Finish clears it anyway: 1 star, unmet goal not proved'); }
  ok((await run({ ms: 70_000 })).stars === 1, 'stars: caught only, then Skip = 1 star');
  ok((await run({ prove: true, ms: 70_000 })).stars === 2, 'stars: caught + proved, over par = 2 stars');
  ok((await run({ prove: true, ms: 30_000 })).stars === 3, 'stars: caught + proved + under par = 3 stars');
  ok((await run({ prove: true, bonus: true, ms: 70_000 })).stars === 3, 'stars: caught + proved + the hidden bug = 3 stars');
  ok((await run({ prove: false, bonus: true, ms: 30_000 })).stars === 1, 'stars: the hidden bug alone (not proved) stays 1 star');
  const slow = await run({ prove: true, ms: 70_000 });
  const fast = await run({ prove: true, ms: 30_000 });
  ok(fast.score - slow.score >= 29 && fast.score - slow.score <= 50, 'score: +1 per second under par, at most +50', `${slow.score} -> ${fast.score}`);
}

/* ---- storage shape and forbidden tokens (section 10) -------------------------------------------------------------- */
{
  const E = await makeEngine();
  await E.at(1);
  E.clk.advance(30_000);
  E.L.ctxs[1].emit({ type: 'catch' });
  E.L.flags[1].prove = true; E.clk.advance(500);
  E.engine.finish();
  E.engine.setPref('lang', 'ar');
  const raw = E.storage.getItem(STORE_KEY);
  ok(raw !== null, `storage: progress is written under the key ${STORE_KEY}`);
  const data = JSON.parse(raw);
  ok(Object.keys(data).sort().join() === 'best,bonus,prefs,stars,stickers', 'storage: top-level keys are exactly prefs, best, stars, stickers, bonus', Object.keys(data).join());
  ok(!/\d{4}-\d{2}-\d{2}|"(?:date|day|streak|lastPlayed|runIndex|seed)"|\b1[5-9]\d{11}\b/.test(raw), 'storage: no dates, no day keys, no epoch timestamps', raw.slice(0, 120));
  ok(data.stickers['failed-request'] === true && data.stars.l1 === 3 && data.best.l1 === 30_500, /* the clock freezes at the prove step, 500 ms after the catch */ 'storage: the L1 sticker, stars and best time were saved');
  ok(!JSON.stringify(E.log).includes('http'), 'engine events carry no URL');
  proveTeeth('the storage date check', (s) => (/\d{4}-\d{2}-\d{2}/.test(s) ? ['date'] : []), '{"best":{"run":"2026-10-12"}}');
  const dirty = await makeEngine({ storageSeed: { prefs: { lang: 'xx', volume: 9999, theme: 'neon' }, stars: { l1: 7 }, best: { l1: -5 }, evil: 1 } });
  const p = dirty.engine.getPrefs();
  ok(p.lang === 'en' && p.volume === 100 && p.theme === 'auto' && dirty.engine.view().stars.l1 === 0 && dirty.engine.view().best.l1 === null, 'storage: a corrupt or hostile saved value is sanitised on load');
}
{
  // `combo` is allowed again (owner change 1); `Object.freeze` is not the streak-freeze feature.
  const BAD = /\b(?:streak|daily|flame|leaderboard|notification|alarm)\b|(?<!Object\.)\bfreeze\b|Math\.random/i;
  const src = nonEmpty(gameSources().filter(([f]) => !/^audio\/narration-manifest\.json$/.test(f)), 'game/ text files');
  const hits = src.flatMap(([f, text]) => text.split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => BAD.test(l)).map(([ff, i, l]) => `${ff}:${i} ${l.trim().slice(0, 80)}`));
  ok(hits.length === 0, 'no streak / daily / freeze / flame / leaderboard / notification / alarm / Math.random anywhere in game/', hits.slice(0, 5).join(' | '));
  proveTeeth('the forbidden-token scan', (s) => (BAD.test(s) ? ['token'] : []), 'const n = Math.random()');
  proveTeeth('the forbidden-token scan (streak freeze)', (s) => (BAD.test(s) ? ['token'] : []), 'const streakFreeze = 1; freeze()');
  ok(!BAD.test('Object.freeze({})') && !BAD.test('combo-up'), 'the scan lets Object.freeze and combo through');
}
assert.ok(true);
finish('test-game-levels');
