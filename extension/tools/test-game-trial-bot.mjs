/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @suite lane=node feature=game reason=drives game/trial.js through a dynamic import inside lib-game-trial.mjs, so it is a node suite and not a pure gate
/**
 * Bug Hunt hard trials, the scripted player (DESIGN-bug-hunt-hard.md section 11; lane T3). Node only, virtual clock.
 *
 *   node tools/test-game-trial-bot.mjs        (from extension/, PYTHONUTF8=1)
 *
 * 1. A perfect, human-paced player clears stage 6 in 52-60 s and stage 7 in 80-95 s of stage time (the "skilled clear" claim),
 *    with no death, and a player who plays the same stage twice gets the same result.
 * 2. A mutation table: ONE mistake per row of the tables of sections 5 and 6 (early, late, double, decoy, real marked, stop too
 *    early, wrong order, stale report), each ends the run in a death in the expected room with the expected cause id.
 * 3. After each death the stage restarts by itself in <= 1.0 s when QA Wrap is not recording, and waits for Stop when it is.
 * Skips with exit 2 while game/trial.js has not landed.
 */
import { ok, nonEmpty, proveTeeth, finish } from './lib-assert.mjs';
import * as L from './lib-game-trial.mjs';

const SUITE = 'test-game-trial-bot';
L.needTrial(SUITE);

/* ---- 1. the skilled clear ---------------------------------------------------------------------------------------------- */
for (const n of [6, 7]) {
  const O = L.ORACLE[n];
  const { rig, death, clear } = await L.playOnce(n, L.PERFECT[n]);
  ok(!death && !!clear, `stage ${n}: the perfect player clears without a death`, death ? JSON.stringify(death) : 'no clear');
  const sec = clear ? clear.ms / 1000 : 0;
  ok(sec >= O.skilled[0] - 1 && sec <= O.skilled[1], `stage ${n}: the skilled clear is ${O.skilled[0]}-${O.skilled[1]} s on the stage clock`, `${sec} s`);
  ok(sec >= O.floor - 0.5, `stage ${n}: nobody clears under the schedule floor of ${O.floor} s (rooms are time-locked)`, `${sec} s`);
  ok(clear && clear.deaths === 0, `stage ${n}: the clear event carries deaths 0`, JSON.stringify(clear));
  const badges = JSON.stringify(clear && clear.badges);
  ok(badges.includes(n === 6 ? 'trial6' : 'trial7') && badges.includes(n === 6 ? 'nodeath6' : 'sekiro'), `stage ${n}: a clear with 0 deaths earns ${n === 6 ? 'Steady hands + Clean hands' : 'Night shift + One breath'}`, badges);
  const tr = JSON.parse(rig.storage.getItem(L.TRIAL_KEY) || '{}');
  ok(tr[n] && tr[n].clears >= 1, `stage ${n}: the clear is stored in bughunt.trial.v1`, JSON.stringify(tr[n]));
  rig.destroy();
}
// a clear after deaths: same score, no "no death" badge
{
  const rig = await L.makeRig({ n: 6, scripts: (k) => (k < 3 ? [{ id: 'stop', at: 1.0, kind: 'stop' }] : L.PERFECT[6]) });
  await rig.start();
  await rig.until(() => rig.clears().length > 0, 400);
  const c = rig.clears()[0];
  ok(!!c && c.deaths === 3 && c.score === L.ORACLE[6].total, 'stage 6: three deaths, then a clear: deaths 3 and the same score 1500 (the run\'s points are lost with each death, the clear is whole)', JSON.stringify(c));
  ok(c && !JSON.stringify(c.badges).includes('nodeath6') && JSON.stringify(c.badges).includes('trial6'), 'stage 6: a clear after deaths earns Steady hands but not Clean hands', c && JSON.stringify(c.badges));
  rig.destroy();
}

/* ---- 2. the mutation table --------------------------------------------------------------------------------------------- */
const P6 = L.PERFECT[6]; const P7 = L.PERFECT[7];
const without = (s, ...ids) => ids.reduce((acc, id) => L.mut(acc, id, null), s);
const add = (s, a) => [...s, a];
/** [stage, name, script, cause (null = any), room] */
const ROWS = [
  [6, 'Save last 2 minutes before the glitch', L.mut(P6, 'buffer', { at: 2.0, lagState: 0 }), 'buffer-early', 1],
  [6, 'Save last 2 minutes never pressed', without(P6, 'buffer'), 'buffer-missed', 1],
  [6, 'screenshot before the glitch', L.mut(P6, 'shot', { at: 14.0, lag: 1.0 }), 'shot-early', 2],
  [6, 'screenshot never taken', without(P6, 'shot'), 'shot-missed', 2],
  [6, 'second screenshot', add(P6, { id: 'shot2', at: 18.6, kind: 'shot' }), 'shot-over', 2],
  [6, 'Next never pressed', without(P6, 'click', 'note'), 'dead-missed', 3],
  [6, 'a decoy button pressed instead of Next', L.mut(P6, 'click', { sel: '[data-decoy]' }), 'decoy-click', 3],
  [6, 'note before the click', L.mut(L.mut(P6, 'click', { at: 27.0 }), 'note', { at: 25.0, lag: 0.5 }), 'note-early', 3],
  [6, 'second note', add(P6, { id: 'note2', at: 27.0, kind: 'note' }), 'note-over', 3],
  [6, 'note never added', without(P6, 'note'), 'note-missed', 3],
  [6, 'Not a bug never pressed on the harmless failure', without(P6, 'notbug'), 'notbug-missed', 4],
  [6, 'Not a bug pressed on the real failure too', add(P6, { id: 'nbReal', at: 44.0, kind: 'notbug' }), 'notbug-real', 4],
  [6, 'Not a bug pressed only after the real failure fired', L.mut(P6, 'notbug', { at: 44.0 }), 'notbug-missed', 4],
  [6, 'Stop too early', L.mut(P6, 'stop', { at: 50.0, lagState: 0 }), 'stop-early', 4],
  [6, 'Stop never pressed', without(P6, 'stop'), 'stop-missed', 5],
  [6, 'wrong order: Stop first', add(without(P6, 'buffer'), { id: 'stop0', at: 5.0, kind: 'stop' }), 'stop-early', 1],
  [7, 'QA Wrap never started', without(P7, 'start'), 'start-missed', 1],
  [7, 'started from the popup, not the shortcut', L.mut(P7, 'start', { kind: 'popupStart' }), 'start-nokey', 1],
  [7, 'Not a bug on the lie "Saved" (2a)', add(P7, { id: 'nbA', at: 10.0, kind: 'notbug' }), 'notbug-real', 2],
  [7, 'decoy 2b left alone', without(P7, 'nb2b'), 'notbug-missed', 2],
  [7, 'Not a bug on the empty menu (2c, a 404 that looks like noise)', add(P7, { id: 'nbC', at: 17.0, kind: 'notbug' }), 'notbug-real', 2],
  [7, 'decoy 2d left alone', without(P7, 'nb2d'), 'notbug-missed', 2],
  [7, 'a third Not a bug in the decoy window of 2d', add(P7, { id: 'nbX', at: 21.0, kind: 'notbug' }), null, 2],
  [7, 'Stop before the bar', L.mut(P7, 'stop1', { at: 21.0, lagState: 0 }), 'stop-early', 2],
  [7, 'Stop never pressed (act I)', without(P7, 'stop1'), 'stop-missed', 3],
  [7, 'Save last 2 minutes before the ambush', L.mut(P7, 'buffer', { at: 31.0, lagState: 0 }), 'buffer-early', 3],
  [7, 'Save last 2 minutes never pressed', without(P7, 'buffer'), 'buffer-missed', 4],
  [7, 'note before the click', L.mut(L.mut(P7, 'click', { at: 53.0 }), 'note', { at: 51.0, lag: 0.5 }), 'note-early', 5],
  [7, 'second note', add(P7, { id: 'note2', at: 55.0, kind: 'note' }), 'note-over', 5],
  [7, 'Next never pressed', without(P7, 'click', 'note'), 'dead-missed', 5],
  [7, 'a decoy button (Back / Cancel / Remove) pressed', L.mut(P7, 'click', { sel: '[data-decoy]' }), 'decoy-click', 5],
  [7, 'screenshot before the glitch', L.mut(P7, 'shot', { at: 63.5, lag: 0.5 }), 'shot-early', 6],
  [7, 'screenshot never taken', without(P7, 'shot', 'markup', 'stop2', 'paste'), 'shot-missed', 6],
  [7, 'second screenshot', add(P7, { id: 'shot2', at: 69.0, kind: 'shot' }), 'shot-over', 6],
  [7, 'screenshot never marked up', without(P7, 'markup', 'stop2', 'paste'), 'markup-missed', 6],
  [7, 'Stop before the mark-up is seen', L.mut(P7, 'stop2', { at: 74.0, lagState: 0 }), 'stop-early', 6],
  [7, 'Stop never pressed (hand-off)', without(P7, 'stop2', 'paste'), 'stop-missed', 7],
  [7, 'report never pasted', without(P7, 'paste'), 'paste-missed', 7],
  [7, 'a stale report pasted (another attempt\'s word)', L.mut(P7, 'paste', { stale: true }), 'paste-missed', 7],
];
nonEmpty(ROWS, 'mutation rows');
const gaps = [];
for (const [n, name, script, cause, room] of ROWS) {
  const rig = await L.makeRig({ n, scripts: (k) => (k === 0 ? script : null) });
  await rig.start();
  await rig.until(() => rig.deaths().length > 0 || rig.clears().length > 0, 140);
  const d = rig.deaths()[0];
  const label = `stage ${n}: ${name}`;
  ok(!!d, `${label} -> a death`, rig.clears().length ? 'cleared instead (the mistake was forgiven)' : 'no death within 140 s');
  if (d) {
    if (cause) ok(d.cause === cause, `${label} -> cause ${cause}`, `got ${d.cause}`);
    ok(d.room === room, `${label} -> room ${room}`, `got room ${d.room}`);
    // restart (A2/A3): by itself in <= 1.0 s when QA Wrap is not recording; waits for Stop when it is
    await rig.run(0.45);
    const recording = rig.sim.state === 'recording';
    await rig.run(0.6);
    const again = rig.events.filter((e) => e.type === 'trial:room' && e.room === 1 && e.t > rig.events.find((x) => x.type === 'trial:death').t);
    if (!recording) {
      ok(again.length === 1, `${label} -> restarts by itself (QA Wrap not recording)`, `room-1 events after the death: ${again.length}`);
      if (again.length) gaps.push(again[0].t - rig.events.find((x) => x.type === 'trial:death').t);
    } else {
      ok(again.length === 0, `${label} -> waits at the door while QA Wrap is recording (Stop opens it)`, `room-1 events after the death: ${again.length}`);
    }
  }
  ok(rig.errors.length === 0, `${label} -> no error thrown`, rig.errors.join());
  rig.destroy();
}
nonEmpty(gaps, 'restart gaps measured');
ok(Math.max(...gaps) <= 1000, `every restart with the door open takes <= 1000 ms from the death to the running schedule (${gaps.length} measured, max ${Math.max(...gaps)} ms)`);
proveTeeth('the mutation table', (clear) => (clear ? [] : ['no death']), false);

finish(SUITE);
