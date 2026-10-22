/* QA Wrap - Bug Hunt hard trials, lane T1: FAIRNESS PROOF BY SIMULATION of the lag law (design s2, s11).
 * For every SLOW window and every press p in [a, b] and every lag in [0, LAG_SLOW] the judge accepts; same for FAST with LAG_FAST; EXACT windows
 * have no lag. Early observations are lethal, a second rise is lethal, and no death is reachable by a press inside any window.
 *   node tools/test-game-trial-fair.mjs   (from extension/, PYTHONUTF8=1) */
import assert from 'node:assert/strict';
import { runner } from './lib-game-b.mjs';
import { trialMod, t6, t7, drive, perfect6, perfect7, REPORT } from './lib-game-t1.mjs';

const { test, done } = runner('Bug Hunt hard trials: fairness by simulation (lane T1)');
const T = trialMod;
const range = (a, b, step) => { const o = []; for (let x = a; x <= b; x += step) o.push(x); return o; };
const without = (steps, atTimes) => steps.filter((s) => !atTimes.includes(s[0]));
const okAt = (res, id) => res.events.find((e) => e.type === 'ok' && e.id === id);

/** Every (press, lag) in the window is accepted: no death before `end`, and the rule's ok event appears. */
function sweep(label, stage, prefix, ruleId, presses, lags, patchAt, end, n = { count: 0 }) {
  for (const p of presses) for (const lag of lags) {
    const made = patchAt(p, lag);
    const res = drive(stage, [...prefix, ...(Array.isArray(made) ? made : [[p + lag, made]])], end);
    n.count += 1;
    assert.equal(res.dead, null, `${label}: press ${p} lag ${lag} died: ${res.dead && res.dead.cause}`);
    assert.ok(okAt(res, ruleId) || res.events.some((e) => e.type === 'resolved' && e.id === ruleId), `${label}: press ${p} lag ${lag} not accepted`);
  }
  return n.count;
}
const slowLags = range(0, T.LAG_SLOW, 200).concat([T.LAG_SLOW]);
const fastLags = range(0, T.LAG_FAST, 50);

await test('FAST windows (buffer, Stop, start by state): every press x every lag <= LAG_FAST is accepted', () => {
  let c = 0;
  c += sweep('t6 buffer', t6, [], 'buffer', range(4200, 11200, 100), fastLags, () => ({ s: 'recording', inc: { buffer: 1 } }), 11800);
  c += sweep('t6 stop', t6, perfect6().slice(0, 5), 'stop', range(52000, 61000, 250), fastLags, () => ({ s: 'stopped' }), 62000);
  c += sweep('t7 start', t7, [], 'start', range(0, 7500, 100), fastLags, () => ({ s: 'recording', inc: { shortcut: 1 } }), 8100, { count: 0 });
  c += sweep('t7 stop3', t7, perfect7().slice(0, 4), 'stop3', range(21900, 30000, 250), fastLags, () => ({ s: 'stopped' }), 31000);
  c += sweep('t7 buffer', t7, perfect7().slice(0, 5), 'buffer', range(33200, 40200, 100), fastLags, () => ({ s: 'recording', inc: { buffer: 1 }, set: { notes: 0, shots: 0, marks: 0, shortcut: 0 } }), 41000);
  c += sweep('t7 stop7', t7, perfect7().slice(0, 10), 'stop7', range(73000, 85000, 250), fastLags, () => ({ s: 'stopped' }), 86000);
  assert.ok(c > 1000, `${c} scenarios`);
});

await test('SLOW windows (screenshot, note after click, mark-up): every press x every lag <= LAG_SLOW is accepted', () => {
  let c = 0;
  c += sweep('t6 shot', t6, [perfect6()[0]], 'shot', range(16000, 17500, 100), slowLags, () => ({ inc: { shots: 1 } }), 21300);
  for (const click of [22000, 25000, 28000]) {
    c += sweep(`t6 note after click ${click}`, t6, [...perfect6().slice(0, 2), [click, { click: 'next' }]], 'note', range(click, click + 7000, 250), slowLags, () => ({ inc: { notes: 1 } }), click + 10800);
  }
  for (const click of [49000, 51500, 54000]) {
    c += sweep(`t7 note after click ${click}`, t7, [...perfect7().slice(0, 6), [click, { click: 'next' }]].filter((s, i, a) => i < 6 || s[0] === click), 'note', range(click, click + 5000, 250), slowLags, () => ({ inc: { notes: 1 } }), click + 8800);
  }
  c += sweep('t7 shot', t7, perfect7().slice(0, 8), 'shot', range(66000, 67500, 100), slowLags, () => ({ inc: { shots: 1 } }), 71300);
  c += sweep('t7 mark-up', t7, perfect7().slice(0, 9), 'markup', range(68000, 82000, 500), slowLags, (p, lag) => [[p + lag, { inc: { marks: 1 } }], [p + lag + 300, { s: 'stopped' }]], 85800);
  c += sweep('t7 shortcut after the start', t7, [[3000, { s: 'recording' }]], 'shortcut', range(3000, 3000, 1), slowLags, () => ({ inc: { shortcut: 1 } }), 6800);
  assert.ok(c > 1500, `${c} scenarios`);
});

await test('EXACT windows (Not a bug on a decoy, Next click, paste): accepted at every ms-step inside, nothing is lagged', () => {
  let c = 0;
  c += sweep('t6 notbug', t6, perfect6().slice(0, 4), 'notbug', range(40950, 43350, 50), [0], () => ({ inc: { expected: 1 } }), 43500);
  c += sweep('t7 nb_b', t7, perfect7().slice(0, 2), 'nb_b', range(12950, 15450, 50), [0], () => ({ inc: { expected: 1 } }), 15600);
  c += sweep('t7 nb_d', t7, [...perfect7().slice(0, 3)], 'nb_d', range(19750, 21900, 50), [0], () => ({ inc: { expected: 1 } }), 22000);
  c += sweep('t6 click', t6, perfect6().slice(0, 2), 'click', range(22000, 28000, 100), [0], () => ({ click: 'next' }), 28100);
  c += sweep('t7 click', t7, perfect7().slice(0, 6), 'click', range(49000, 54000, 100), [0], () => ({ click: 'next' }), 54100);
  for (const p of range(100, 25000, 1000).concat([25000])) {
    const res = drive(t7, [...perfect7().slice(0, 11).filter((s) => s[0] !== 90000), [76000 + p, { paste: REPORT('basil') }]], 110000);
    assert.equal(res.cleared, true, `paste ${p} ms after the stop`); c += 1;
  }
  assert.ok(c > 200, `${c} scenarios`);
});

await test('early observations are lethal, at every time before the window opens', () => {
  const cases = [
    [t6, [], 'buffer', range(0, 4100, 100), () => ({ s: 'recording', inc: { buffer: 1 } }), 'buffer-early'],
    [t6, [perfect6()[0]], 'shot', range(5100, 15900, 300), () => ({ inc: { shots: 1 } }), 'shot-early'],
    [t6, perfect6().slice(0, 3), 'note', range(23100, 27900, 300).filter((x) => x > 23000), () => ({ inc: { notes: 1 } }), null],
    [t6, perfect6().slice(0, 5), 'stop', range(41600, 51900, 400), () => ({ s: 'stopped' }), 'stop-early'],
    [t7, perfect7().slice(0, 5), 'buffer', range(23500, 33100, 400), () => ({ s: 'recording', inc: { buffer: 1 } }), 'buffer-early'],
    [t7, perfect7().slice(0, 8), 'shot', range(56000, 65900, 400), () => ({ inc: { shots: 1 } }), 'shot-early'],
    [t7, perfect7().slice(0, 10), 'stop7', range(68100, 72900, 300), () => ({ s: 'stopped' }), 'stop-early'],
  ];
  for (const [stage, prefix, id, times, patch, cause] of cases) {
    for (const p of times) {
      const res = drive(stage, [...prefix, [p, patch()]], p + 200);
      if (cause === null) continue;
      assert.ok(res.dead, `${id} at ${p} should die`);
      assert.equal(res.dead.cause, cause, `${id} at ${p}`);
    }
  }
  // note before the click, any time, is lethal
  for (const p of range(1000, 22900, 700)) assert.equal(drive(t6, [...perfect6().slice(0, 2), [p, { inc: { notes: 1 } }]], p + 200).dead.cause, p < 18500 ? 'note-early' : 'note-early');
});

await test('a second rise is lethal (max 1), a rise after the window with a rule already accepted is lethal, a missed window is lethal at its end', () => {
  for (const gap of [200, 1000, 4000]) {
    assert.equal(drive(t6, [perfect6()[0], [18500, { inc: { shots: 1 } }], [18500 + gap, { inc: { shots: 1 } }]], 60000).dead.cause, 'shot-over');
    assert.equal(drive(t6, [...perfect6().slice(0, 4), [28000 + gap, { inc: { notes: 1 } }]], 60000).dead.cause, 'note-over');
  }
  const twoAtOnce = drive(t6, [perfect6()[0], [18500, { inc: { shots: 2 } }]], 60000);
  assert.equal(twoAtOnce.dead.cause, 'shot-over', 'two screenshots seen in one poll');
  const ends = [[t6, [], 11750, 'buffer-missed'], [t6, perfect6().slice(0, 1), 21250, 'shot-missed'], [t6, perfect6().slice(0, 6).slice(0, 5), 61550, 'stop-missed'], [t7, [], 8050, 'start-missed']];
  for (const [stage, prefix, at, cause] of ends) {
    const res = drive(stage, prefix, at + 100);
    assert.equal(res.dead && res.dead.cause, cause);
    assert.ok(res.dead.t > at - 100 && res.dead.t <= at + 100, `died at ${res.dead.t}, window closes at ${at}`);
  }
});

await test('no death is reachable by a press inside any window: random-free sweep over the whole timeline of both stages', () => {
  let c = 0;
  const jitter = [0, 120, 410, 1000, 2330, 3600];
  for (const j of jitter) {
    // the slow presses of the perfect scripts were made at (obs - lag); here the lag becomes j
    const r6 = drive(t6, [[5000, { s: 'recording', inc: { buffer: 1 } }], [16500 + j, { inc: { shots: 1 } }], [23000, { click: 'next' }], [25000 + j, { inc: { notes: 1 } }], [41500, { inc: { expected: 1 } }], [54000, { s: 'stopped' }]], 70000);
    assert.equal(r6.cleared, true, `stage 6 with lag ${j}: ${r6.dead && r6.dead.cause}`); c += 1;
    const r7 = drive(t7, [[3000, { s: 'recording' }], [3000 + j, { inc: { shortcut: 1 } }], [13500, { inc: { expected: 1 } }], [20500, { inc: { expected: 1 } }], [23000, { s: 'stopped' }],
      [34000, { s: 'recording', inc: { buffer: 1 }, set: { notes: 0, shots: 0, marks: 0, shortcut: 0 } }], [50000, { click: 'next' }], [52000 + j, { inc: { notes: 1 } }],
      [66500 + j, { inc: { shots: 1 } }], [70000 + j, { inc: { marks: 1 } }], [76000 + j, { s: 'stopped' }], [90000 + j, { paste: REPORT('basil') }]], 120000);
    assert.equal(r7.cleared, true, `stage 7 with lag ${j}: ${r7.dead && r7.dead.cause}`); c += 1;
  }
  assert.equal(c, jitter.length * 2);
});

await test('pause ghost rule: a slow rise seen within LAG_SLOW of a pause is not counted in the restarted room; later rises are', () => {
  const j = T.createJudge(t6, {});
  const snap = (v) => ({ state: 'recording', counts: { notes: 0, shots: v, shortcut: 0, expected: 0, marks: 0, buffer: 1 } });
  j.start({ state: 'ready', counts: { notes: 0, shots: 0, shortcut: 0, expected: 0, marks: 0, buffer: 0 } });
  j.step(5000, snap(0));
  j.step(12000, snap(0));
  // paused 1 s in room 2 (starts at 13 s): ghosts of presses made before the pause are muted until 13 s + (3.7 - 1.0) s
  j.restartRoom(2, snap(0), 13000 + 2700);
  j.step(14000, snap(1));
  j.step(14500, snap(2));
  assert.equal(j.dead, null, 'a rise at 14.0 s is a ghost of a press made before the pause: not early, not over');
  const ev = j.step(16000, snap(3));
  assert.ok(ev.some((e) => e.type === 'ok' && e.id === 'shot'), 'after the mute a press in the window counts');
});

done();
