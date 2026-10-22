/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @suite lane=node feature=game reason=drives game/trial.js through a dynamic import inside lib-game-trial.mjs, so it is a node suite and not a pure gate
/**
 * Bug Hunt hard trials, fairness by simulation through createTrial() (DESIGN-bug-hunt-hard.md section 2, the lag law, and section 11;
 * lane T3). Node only. (T1 owns test-game-trial-fair.mjs, the same law at the judge level; this is the black-box view.)
 *
 *   node tools/test-game-trial-lagfair.mjs        (from extension/, PYTHONUTF8=1)
 *
 * The claim: no press that is truly inside a window is ever rejected, for any lag from 0 to the limit of its signal.
 * The test plays the REAL game/trial.js: for each window of stages 6 and 7 it replaces one action of the scripted skilled player
 * by a press at every p in [a, b] (every 0.5 s plus both ends) and for every lag of the signal (SLOW: 0, 0.9, 1.8, 2.7, 3.6 s,
 * FAST: 0, 0.25, 0.5 s, the toast button 0 and 0.1 s). Every one of those runs must CLEAR the stage: a death anywhere is an unfair
 * death. Then the other side of the law: an early rise is lethal, a second rise is lethal, a missed window is lethal at its deadline,
 * and a press up to LAG before the window that is only SEEN inside it is accepted (documented, F2: the only unfairness, and it favours
 * the player). Skips with exit 2 while game/trial.js has not landed.
 */
import { ok, nonEmpty, proveTeeth, finish } from './lib-assert.mjs';
import * as L from './lib-game-trial.mjs';

const SUITE = 'test-game-trial-lagfair';
L.needTrial(SUITE);

const SLOW = [0, 0.9, 1.8, 2.7, L.LAG_SLOW];
const FAST = [0, 0.25, L.LAG_FAST];
const grid = (a, b, step = 0.5) => { const out = [a]; for (let x = a + step; x < b - 1e-9; x += step) out.push(Math.round(x * 1000) / 1000); out.push(b); return out; };

/** One case: stage n, the player with action `id` replaced by `patch(p, lag)` (and an `also` follow-up); must clear. */
const WINDOWS = [
  { n: 6, label: 'R1 Save last 2 minutes (FAST, qawBuffer)', ps: grid(4.2, 11.2), lags: FAST, make: (p, l) => ({ id: 'buffer', patch: { at: p, lagState: l } }) },
  { n: 6, label: 'R2 screenshot while the glitch is visible (SLOW, graced)', ps: grid(16.0, 17.5, 0.25), lags: SLOW, make: (p, l) => ({ id: 'shot', patch: { at: p, lag: l } }) },
  { n: 6, label: 'R3 click Next (EXACT page click)', ps: grid(22.0, 28.0), lags: [0], make: (p) => ({ id: 'click', patch: { at: p }, also: { id: 'note', patch: { at: p + 2.0 } } }) },
  { n: 6, label: 'R3 note after the click (SLOW, 7 s window)', ps: grid(23.0, 30.0), lags: SLOW, make: (p, l) => ({ id: 'note', patch: { at: p, lag: l } }) },
  { n: 6, label: 'R4a Not a bug on the decoy (2.3 s)', ps: grid(40.95, 43.2, 0.25), lags: [0, 0.05, 0.1], make: (p, l) => ({ id: 'notbug', patch: { at: p, lag: l } }) },
  { n: 6, label: 'R5 Stop (FAST)', ps: grid(52.0, 61.0), lags: FAST, make: (p, l) => ({ id: 'stop', patch: { at: p, lagState: l } }) },
  { n: 7, label: 'R1 start by the shortcut (FAST state, SLOW count)', ps: grid(0.0, 7.5), lags: [[0, 0], [0.25, 1.8], [0.5, L.LAG_SLOW], [0, L.LAG_SLOW]], make: (p, l) => ({ id: 'start', patch: { at: p, lagState: l[0], lagCount: l[1] } }) },
  { n: 7, label: 'R2b decoy 12.8', ps: grid(12.95, 15.3, 0.25), lags: [0, 0.05, 0.1], make: (p, l) => ({ id: 'nb2b', patch: { at: p, lag: l } }) },
  { n: 7, label: 'R2d decoy 19.6', ps: grid(19.75, 21.8, 0.25), lags: [0, 0.05], make: (p, l) => ({ id: 'nb2d', patch: { at: p, lag: l } }) },
  { n: 7, label: 'R3 Stop (FAST)', ps: grid(21.9, 30.0), lags: FAST, make: (p, l) => ({ id: 'stop1', patch: { at: p, lagState: l } }) },
  { n: 7, label: 'R4 Save last 2 minutes after the ambush (FAST)', ps: grid(33.2, 40.2), lags: FAST, make: (p, l) => ({ id: 'buffer', patch: { at: p, lagState: l } }) },
  { n: 7, label: 'R5 click Next (EXACT)', ps: grid(49.0, 54.0), lags: [0], make: (p) => ({ id: 'click', patch: { at: p }, also: { id: 'note', patch: { at: p + 1.5 } } }) },
  { n: 7, label: 'R5 note after the click (SLOW, 5 s window)', ps: grid(50.0, 55.0), lags: SLOW, make: (p, l) => ({ id: 'note', patch: { at: p, lag: l } }) },
  { n: 7, label: 'R6 screenshot while the glitch is visible (SLOW, graced)', ps: grid(66.0, 67.5, 0.25), lags: SLOW, make: (p, l) => ({ id: 'shot', patch: { at: p, lag: l } }) },
  { n: 7, label: 'R6 Mark up (SLOW, visible-time deadline)', ps: grid(72.0, 82.0), lags: SLOW, make: (p, l) => ({ id: 'markup', patch: { at: p, lag: l }, also: { id: 'stop2', patch: { at: p + l + 0.5 } }, paste: p + l + 5.5 }) },
  { n: 7, label: 'R7 Stop after the marks (FAST, 12 s)', ps: grid(77.8, 89.4, 1.0), lags: FAST, make: (p, l) => ({ id: 'stop2', patch: { at: p, lagState: l }, paste: p + l + 5.0 }) },
  { n: 7, label: 'R7 paste into the box (EXACT, 25 s)', ps: grid(79.2, 104.0, 2.0), lags: [0], make: (p) => ({ id: 'paste', patch: { at: p } }) },
];

let total = 0;
for (const W of WINDOWS) {
  nonEmpty(W.ps, `${W.label}: presses`);
  const fails = []; let runs = 0;
  for (const p of W.ps) {
    for (const lag of W.lags) {
      const m = W.make(p, lag);
      let script = L.mut(L.PERFECT[W.n], m.id, m.patch);
      if (m.also) script = L.mut(script, m.also.id, m.also.patch);
      if (m.paste) script = L.mut(script, 'paste', { at: m.paste });
      const { rig, death, clear } = await L.playOnce(W.n, script, { maxSec: 130 });
      rig.destroy();
      runs++; total++;
      if (death || !clear) fails.push(`p=${p} lag=${JSON.stringify(lag)} -> ${death ? `${death.cause}@room${death.room}` : 'no clear'}`);
    }
  }
  ok(fails.length === 0, `stage ${W.n} ${W.label}: all ${runs} in-window presses (every lag up to the limit) clear the stage`, `${fails.length} unfair deaths, first: ${fails.slice(0, 3).join(' | ')}`);
}
ok(total >= 700, `the fairness grid ran ${total} simulated attempts (>= 700)`);

/* ---- the other side of the law --------------------------------------------------------------------------------------- */
const die = async (n, script, opts) => { const r = await L.playOnce(n, script, opts); r.rig.destroy(); return r.death; };
const causeOf = (d) => (d ? `${d.cause}@room${d.room}` : 'no death');
const EARLY = [
  [6, 'buffer', { at: 2.0, lagState: 0 }, 'buffer-early', 1],
  [6, 'shot', { at: 14.5, lag: 0.5 }, 'shot-early', 2],
  [6, 'stop', { at: 45.0, lagState: 0 }, 'stop-early', 4],
  [7, 'buffer', { at: 31.0, lagState: 0 }, 'buffer-early', 3],
  [7, 'stop1', { at: 18.0, lagState: 0 }, 'stop-early', 2],
  [7, 'shot', { at: 63.5, lag: 0.5 }, 'shot-early', 6],
];
for (const [n, id, patch, cause, room] of EARLY) {
  const d = await die(n, L.mut(L.PERFECT[n], id, patch));
  ok(d && d.cause === cause && d.room === room, `stage ${n}: ${id} observed before its window (0.5 s early, any lag) is lethal: ${cause} in room ${room}`, causeOf(d));
}
// the note rises before the click on Next
for (const [n, c] of [[6, 27.0], [7, 53.0]]) {
  const d = await die(n, L.mut(L.mut(L.PERFECT[n], 'click', { at: c }), 'note', { at: c - 2.0, lag: 0.5 }));
  ok(d && d.cause === 'note-early', `stage ${n}: a note observed before the click on Next is note-early`, causeOf(d));
}
// a second rise is lethal ("exactly 1")
{
  const d1 = await die(6, [...L.PERFECT[6], { id: 'shot2', at: 18.6, kind: 'shot' }]);
  ok(d1 && d1.cause === 'shot-over', 'stage 6: a second screenshot ends the run: shot-over', causeOf(d1));
  const d2 = await die(6, [...L.PERFECT[6], { id: 'note2', at: 27.0, kind: 'note' }]);
  ok(d2 && d2.cause === 'note-over', 'stage 6: a second note ends the run: note-over', causeOf(d2));
  const d3 = await die(7, [...L.PERFECT[7], { id: 'note2', at: 55.0, kind: 'note' }]);
  ok(d3 && d3.cause === 'note-over', 'stage 7: a second note ends the run: note-over', causeOf(d3));
  const d4 = await die(7, [...L.PERFECT[7], { id: 'shot2', at: 69.0, kind: 'shot' }]);
  ok(d4 && d4.cause === 'shot-over', 'stage 7: a second screenshot ends the run: shot-over', causeOf(d4));
}
// a missed window ends at its deadline (the design's b + lag + tolerance), not before and not much after
for (const [n, id, cause, room, deadline] of [
  [6, 'buffer', 'buffer-missed', 1, 11.7], [6, 'shot', 'shot-missed', 2, 21.2], [6, 'notbug', 'notbug-missed', 4, 43.35], [6, 'stop', 'stop-missed', 5, 61.5],
  [7, 'start', 'start-missed', 1, 8.0], [7, 'stop1', 'stop-missed', 3, 30.5], [7, 'buffer', 'buffer-missed', 4, 40.7],
]) {
  const { rig, death } = await L.playOnce(n, L.mut(L.PERFECT[n], id, null));
  ok(death && death.cause === cause && death.room === room, `stage ${n}: ${id} never pressed -> ${cause} in room ${room}`, causeOf(death));
  const at = death ? rig.events.find((e) => e.type === 'trial:death').rel : 0;
  ok(death && at >= deadline - 0.15 && at <= deadline + 0.35, `stage ${n}: that death comes at the deadline ${deadline} s, not earlier and not much later`, `died at ${at} s`);
  rig.destroy();
}
// the dead button not pressed in time (stage 6 by 28.0, stage 7 by 54.0)
for (const [n, miss] of [[6, 28.0], [7, 54.0]]) {
  const { rig, death } = await L.playOnce(n, L.mut(L.mut(L.PERFECT[n], 'click', null), 'note', null));
  ok(death && death.cause === 'dead-missed', `stage ${n}: Next not pressed by ${miss} s is dead-missed`, causeOf(death));
  const at = death ? rig.events.find((e) => e.type === 'trial:death').rel : 0;
  ok(death && at >= miss - 0.15 && at <= miss + 0.35, `stage ${n}: dead-missed comes at ${miss} s`, `died at ${at} s`);
  rig.destroy();
}
// F2: a press up to LAG before the window that is only SEEN inside it is accepted (documented; it favours the player)
{
  const d = await die(6, L.mut(L.PERFECT[6], 'shot', { at: 14.5, lag: 2.5 }));
  ok(!d, 'F2: a screenshot pressed 1.5 s before the glitch but seen at 17.0 s (lag 2.5 s) is accepted, as the design documents', causeOf(d));
}
proveTeeth('the fairness grid', (judge) => { const bad = []; for (const p of [16.0, 17.5]) for (const l of SLOW) if (!judge(p, l)) bad.push(`${p}/${l}`); return bad; }, (p, l) => p + l <= 20.0);

finish(SUITE);
