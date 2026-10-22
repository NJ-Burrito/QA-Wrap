/* QA Wrap - Bug Hunt hard trials, lane T1: schedules, judge truth table, determinism, door/death/restart, pause, unlock, storage, attunement,
 * planted routes. Node only, virtual clock, no browser, no model call.   node tools/test-game-trial-engine.mjs   (from extension/, PYTHONUTF8=1) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { GAME_DIR, imp, runner } from './lib-game-b.mjs';
import { trialMod, t6, t7, attuneMod, zero, REPORT, drive, perfect6, perfect7, rig, act6, act7, memStorage } from './lib-game-t1.mjs';

const { test, done } = runner('Bug Hunt hard trials: engine (lane T1)');
const T = trialMod;
const S = await imp('scoring.js');
const rule = (st, id) => st.rules.find((r) => r.id === id);
const walk = (el, out = []) => { out.push(el); for (const c of el.children || []) if (c.attrs !== undefined) walk(c, out); return out; };
const attr = (r, k, v) => walk(r.root).filter((e) => e.attrs && e.attrs[k] !== undefined && (v === undefined || e.attrs[k] === v));

await test('constants of the lag law are pinned', () => {
  assert.equal(T.LAG_SLOW, 3600); assert.equal(T.LAG_FAST, 500); assert.equal(T.TOL, 100);
  assert.deepEqual(T.GRACE, { slow: 3700, fast: 500, exact: 0 });
  assert.equal(T.WORDS.length, 12); assert.equal(new Set(T.WORDS).size, 12);
  assert.ok(T.RELOAD_MS + T.RESTART_BEAT_MS + 2 * T.TICK_MS <= 1000, 'death to running stays under 1 s (virtual)');
});

await test('stage 6 schedule equals the design table (s5)', () => {
  assert.deepEqual(t6.rooms.map((r) => r.start), [0, 13000, 22000, 40000, 52000]);
  const g = (id) => { const r = rule(t6, id); return [r.a, r.b + (T.GRACE[r.cls] || 0)]; };
  assert.deepEqual(g('buffer'), [4200, 11700]);
  assert.deepEqual(g('shot'), [16000, 21200]);
  assert.deepEqual(g('click'), [22000, 28000]);
  assert.deepEqual([rule(t6, 'note').from, rule(t6, 'note').a, rule(t6, 'note').b + T.GRACE.slow], ['click', 0, 10700]);
  assert.deepEqual(g('notbug'), [40950, 43350]);
  assert.equal(rule(t6, 'real').a, 43350); assert.equal(rule(t6, 'real').b, Infinity);
  assert.deepEqual(g('stop'), [52000, 61500]);
  const at = (op, t) => t6.scene.find((e) => e.op === op && e.t === t);
  assert.ok(at('tell', 3000) && at('glitch', 4200) && at('ring', 22000) && at('fire', 40800) && at('fire', 43000));
  assert.deepEqual(t6.scene.filter((e) => e.op === 'fire').map((e) => e.fetch.url), ['/api/telemetry', '/api/checkout']);
  assert.deepEqual(t6.decoyRooms, [3]);
});

await test('stage 7 schedule equals the design table (s6)', () => {
  assert.deepEqual(t7.rooms.map((r) => r.start ?? `from:${r.from}`), [0, 8000, 21900, 32000, 49000, 63000, 'from:markup']);
  const g = (id) => { const r = rule(t7, id); return [r.a, r.b + (T.GRACE[r.cls] || 0)]; };
  assert.deepEqual(g('start'), [0, 8000]);
  assert.equal(rule(t7, 'shortcut').from, 'start'); assert.equal(rule(t7, 'shortcut').b + T.GRACE.slow, 3700);
  assert.deepEqual([rule(t7, 'real_a').a, rule(t7, 'real_a').b], [9150, 12950]);
  assert.deepEqual(g('nb_b'), [12950, 15450]);
  assert.deepEqual([rule(t7, 'real_c').a, rule(t7, 'real_c').b], [15450, 19750]);
  assert.deepEqual(g('nb_d'), [19750, 21900]);
  assert.deepEqual(g('stop3'), [21900, 30500]);
  assert.deepEqual(g('buffer'), [33200, 40700]);
  assert.deepEqual(g('click'), [49000, 54000]);
  assert.equal(rule(t7, 'note').b + T.GRACE.slow, 8700);
  assert.deepEqual(g('shot'), [66000, 71200]);
  assert.deepEqual(g('markup'), [66000, 85700]);
  assert.deepEqual(g('stop7'), [0, 12500]); assert.equal(rule(t7, 'stop7').from, 'markup');
  assert.equal(rule(t7, 'paste').b, 25000); assert.equal(rule(t7, 'paste').from, 'stop7');
  assert.deepEqual(t7.decoyRooms, [5]); assert.deepEqual(t7.decoys, ['back', 'cancel', 'remove']);
  assert.deepEqual(t7.hiddenSafeRooms, [6]);
  assert.equal(t7.scene.find((e) => e.op === 'glitch' && e.text === 'kitchen').fetch.url, '/api/orders/{word}');
});

await test('lag isolation: slow windows of one signal are at least LAG + 1 s apart', () => {
  for (const st of [t6, t7]) {
    const bySig = {};
    for (const r of st.rules) if (r.type === 'rise' && T.GRACE[r.cls] === T.GRACE.slow && r.from === undefined) (bySig[r.sig] ||= []).push(r);
    for (const list of Object.values(bySig)) for (let i = 1; i < list.length; i++) assert.ok(list[i].a - (list[i - 1].b + T.GRACE.slow) >= 1000 - T.TOL, 'windows overlap');
  }
  assert.ok(rule(t7, 'note').a === 0 && rule(t7, 'click').b + rule(t7, 'note').b + T.GRACE.slow <= 54000 + 8700);
  assert.ok(54000 + 8700 < 63000 + 3000, 'stage 7 notes end before the shot tell');
});

await test('scoring.json trial block: points follow the tools table x2 and sum to the design totals', () => {
  assert.equal(S.TRIAL.factor, 2);
  const pts = (a) => S.trialPoints(a);
  assert.deepEqual(['shortcut', 'buffer', 'shot', 'note', 'markup', 'notbug', 'recorder', 'stop', 'copy'].map(pts), [100, 100, 200, 200, 100, 200, 100, 200, 200]);
  const sum = (st) => st.rules.filter((r) => r.award).reduce((n, r) => n + pts(r.award), 0);
  assert.equal(sum(t6), 1000); assert.equal(sum(t7), 1900);
  assert.equal(S.TRIAL.clearBonus['6'], 500); assert.equal(S.TRIAL.clearBonus['7'], 1000);
  assert.equal(S.TRIAL.restEvery, 8); assert.equal(S.TRIAL.stillHereAt, 10);
  const allCauses = new Set(); for (const st of [t6, t7]) for (const r of st.rules) for (const k of ['early', 'missed', 'over', 'cause']) if (r[k]) allCauses.add(r[k]);
  allCauses.add('decoy-click');
  for (const c of allCauses) assert.ok(c in S.TRIAL.causes, `cause ${c} has a scoring row`);
  for (const row of Object.values(S.TRIAL.causes)) if (row.wrong) { const [tool, kind] = row.wrong.split('/'); assert.ok(S.ruleFor(tool, kind) && S.ruleFor(tool, kind).outcome === 'wrong', row.wrong); }
  assert.equal(S.TRIAL.causes['note-early'].wrong, 'note/early'); assert.equal(S.TRIAL.causes['stop-early'].wrong, 'stop/early'); assert.equal(S.TRIAL.causes['decoy-click'].wrong, 'page/decoy');
});

await test('perfect player clears both stages with the design score and is deterministic (same log twice)', () => {
  const a = drive(t6, perfect6(), 70000); const b = drive(t6, perfect6(), 70000);
  assert.equal(a.cleared, true); assert.equal(a.points, 1000); assert.equal(a.clearT, 54000);
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
  assert.deepEqual(a.events.filter((e) => e.type === 'room').map((e) => e.room), [2, 3, 4, 5]);
  const c = drive(t7, perfect7(), 110000); const d = drive(t7, perfect7(), 110000);
  assert.equal(c.cleared, true); assert.equal(c.points, 1900); assert.equal(c.clearT, 90000);
  assert.equal(JSON.stringify(c.events), JSON.stringify(d.events));
  assert.deepEqual(c.events.filter((e) => e.type === 'room').map((e) => e.room), [2, 3, 4, 5, 6, 7]);
  assert.ok(c.events.find((e) => e.type === 'resolved' && e.id === 'markup').t === 73000);
});

const M6 = [
  ['buffer pressed before the glitch', [[3000, { s: 'recording', inc: { buffer: 1 } }]], 'buffer-early', 1],
  ['buffer never pressed', [], 'buffer-missed', 1],
  ['screenshot before the glitch', [[5000, { s: 'recording', inc: { buffer: 1 } }], [14000, { inc: { shots: 1 } }]], 'shot-early', 2],
  ['screenshot never taken', [[5000, { s: 'recording', inc: { buffer: 1 } }]], 'shot-missed', 2],
  ['second screenshot', [[5000, { s: 'recording', inc: { buffer: 1 } }], [18000, { inc: { shots: 1 } }], [19500, { inc: { shots: 1 } }]], 'shot-over', 2],
  ['Next never pressed', [[5000, { s: 'recording', inc: { buffer: 1 } }], [18500, { inc: { shots: 1 } }]], 'dead-missed', 3],
  ['a decoy pressed in room 3', [[5000, { s: 'recording', inc: { buffer: 1 } }], [18500, { inc: { shots: 1 } }], [24000, { click: { decoy: 'back' } }]], 'decoy-click', 3],
  ['note before the click', [[5000, { s: 'recording', inc: { buffer: 1 } }], [18500, { inc: { shots: 1 } }], [23000, { inc: { notes: 1 } }]], 'note-early', 3],
  ['second note', [[5000, { s: 'recording', inc: { buffer: 1 } }], [18500, { inc: { shots: 1 } }], [23000, { click: 'next' }], [26000, { inc: { notes: 1 } }], [27000, { inc: { notes: 1 } }]], 'note-over', 3],
  ['note too late', [[5000, { s: 'recording', inc: { buffer: 1 } }], [18500, { inc: { shots: 1 } }], [23000, { click: 'next' }]], 'note-missed', 3],
  ['harmless failure never marked', [...perfect6().slice(0, 4)], 'notbug-missed', 4],
  ['Not a bug on the real failure', [...perfect6().slice(0, 4), [41500, { inc: { expected: 1 } }], [44000, { inc: { expected: 1 } }]], 'notbug-real', 4],
  ['Stop in room 4', [...perfect6().slice(0, 5), [48000, { s: 'stopped' }]], 'stop-early', 4],
  ['Stop never pressed', [...perfect6().slice(0, 5)], 'stop-missed', 5],
];
await test('stage 6 mutation table: every single mistake is a death with the expected cause and room', () => {
  for (const [name, steps, cause, room] of M6) {
    const r = drive(t6, steps, 80000);
    assert.ok(r.dead, `${name}: no death`);
    assert.equal(r.dead.cause, cause, `${name}: ${r.dead.cause}`); assert.equal(r.dead.room, room, `${name}: room ${r.dead.room}`);
  }
});

const P7 = perfect7();
const M7 = [
  ['start missed', [], 'start-missed', 1],
  ['started from the popup, not the shortcut', [[3000, { s: 'recording' }]], 'start-nokey', 1],
  ['Not a bug on the lie', [P7[0], P7[1], [10000, { inc: { expected: 1 } }]], 'notbug-real', 2],
  ['harmless failure b missed', [P7[0], P7[1]], 'notbug-missed', 2],
  ['Not a bug on the disguised 404', [P7[0], P7[1], P7[2], [17000, { inc: { expected: 1 } }]], 'notbug-real', 2],
  ['harmless failure d missed', [P7[0], P7[1], P7[2]], 'notbug-missed', 2],
  ['third press in the decoy window', [P7[0], P7[1], P7[2], P7[3], [20800, { inc: { expected: 1 } }]], 'notbug-real', 2],
  ['Stop never pressed in room 3', P7.slice(0, 4), 'stop-missed', 3],
  ['Stop in room 2', [...P7.slice(0, 3), [20000, { s: 'stopped' }]], 'stop-early', 2],
  ['buffer start before the ambush', [...P7.slice(0, 5), [31000, { s: 'recording', inc: { buffer: 1 } }]], 'buffer-early', 3],
  ['buffer start missed', P7.slice(0, 5), 'buffer-missed', 4],
  ['Next never pressed', P7.slice(0, 6), 'dead-missed', 5],
  ['decoy Remove in room 5', [...P7.slice(0, 6), [51000, { click: { decoy: 'remove' } }]], 'decoy-click', 5],
  ['shot before the glitch', [...P7.slice(0, 8), [60000, { inc: { shots: 1 } }]], 'shot-early', 5],
  ['note too late', P7.slice(0, 7), 'note-missed', 5],
  ['mark-up never made', P7.slice(0, 9), 'markup-missed', 6],
  ['Stop before the mark-up', [...P7.slice(0, 9), [70000, { s: 'stopped' }]], 'stop-early', 6],
  ['no paste in 25 s', P7.slice(0, 11), 'paste-missed', 7],
  ['Stop too late in room 7', P7.slice(0, 10), 'stop-missed', 7],
];
await test('stage 7 mutation table: every single mistake is a death with the expected cause and room', () => {
  for (const [name, steps, cause, room] of M7) {
    const r = drive(t7, steps, 130000);
    assert.ok(r.dead, `${name}: no death`);
    assert.equal(r.dead.cause, cause, `${name}: ${r.dead.cause}`); assert.equal(r.dead.room, room, `${name}: room ${r.dead.room}`);
  }
});

await test('paste: a junk or stale report is ignored (no death), the right word clears; allowed-no-shortcut drops only the shortcut check', () => {
  const base = P7.slice(0, 11);
  const junk = drive(t7, [...base, [80000, { paste: 'hello' }], [81000, { paste: REPORT('olive') }], [90000, { paste: REPORT('basil') }]], 110000);
  assert.equal(junk.cleared, true);
  const results = junk.events.filter((e) => e.type === 'paste-result').map((e) => [e.ok, e.reason]);
  assert.deepEqual(results, [[false, 'format'], [false, 'format'], [true, undefined]]);
  const nk = drive(t7, [[3000, { s: 'recording' }], ...P7.slice(2)], 110000, { noShortcut: true });
  assert.equal(nk.cleared, true); assert.equal(nk.points, 1800);
});

await test('observer baselines: a drop is a new session (rises since 0), the first value only sets the baseline', () => {
  const o = T.makeObserver();
  o.prime({ state: 'ready', counts: { ...zero(), notes: 3 } });
  const c = (v) => ({ state: 'ready', counts: { ...zero(), ...v } });
  assert.deepEqual(o.read(c({ notes: 3 })).rises, []);
  assert.deepEqual(o.read(c({ notes: 0 })).rises, [], 'drop to 0 is no rise');
  assert.deepEqual(o.read(c({ notes: 1 })).rises, [{ sig: 'notes', delta: 1 }]);
  assert.deepEqual(o.read(c({ notes: 3 })).rises, [{ sig: 'notes', delta: 2 }]);
  assert.deepEqual(o.read(c({ notes: 2 })).rises, [{ sig: 'notes', delta: 2 }], 'new session already at 2');
  const o2 = T.makeObserver(); o2.prime({ state: null, counts: null });
  assert.deepEqual(o2.read(c({ shots: 4 })).rises, [], 'first value is a baseline');
  assert.deepEqual(o2.read({ state: 'recording', counts: null }).changes, [{ from: 'ready', to: 'recording' }]);
});

await test('ambiguous toast overlap goes to the decoy; forbid starts exactly where the decoy window ends', () => {
  const edge = (t) => drive(t6, [...perfect6().slice(0, 4), [t, { inc: { expected: 1 } }], [54000, { s: 'stopped' }]], 70000);
  assert.equal(edge(43300).cleared, true, 'a press at 43.3 s (real toast already visible) passes as the decoy');
  assert.equal(edge(43400).dead.cause, 'notbug-missed');
  const r = drive(t6, [...perfect6().slice(0, 4), [41500, { inc: { expected: 1 } }], [43350, { inc: { expected: 1 } }]], 70000);
  assert.equal(r.dead.cause, 'notbug-real', 'a second press (accepted rule, window ended) hits the forbid');
});

await test('trial rig: stage 6 perfect clear writes bughunt.trial.v1 only, score 1500, badges, planted requests; bughunt.v1 bytes unchanged', async () => {
  const r = rig();
  const before = r.storage.getItem('bughunt.v1');
  assert.deepEqual((await r.startRun(6)), { ok: true });
  assert.equal(r.find('#trial-arena') !== null, true);
  assert.equal(attr(r, 'data-decoy').length, 0, 'no decoys in room 1');
  const seen = [];
  r.trial.on('trial:room', (p) => { seen.push([p.room, attr(r, 'data-decoy').length]); });
  assert.equal(r.play(act6()), 'clear');
  const clr = r.types('trial:clear')[0].p;
  assert.equal(clr.score, 1500); assert.equal(clr.deaths, 0); assert.deepEqual(clr.badges, ['trial6', 'nodeath6']);
  assert.ok(clr.ms >= 53900 && clr.ms <= 54100, `clear at ${clr.ms}`);
  assert.deepEqual(seen.map((x) => x[0]), [2, 3, 4, 5]);
  assert.deepEqual(seen.find((x) => x[0] === 3), [3, 2], 'two decoys in room 3');
  assert.equal(seen.find((x) => x[0] === 4)[1], 0, 'decoys leave with the room');
  assert.deepEqual(r.fetched, [['POST', '/api/sync'], ['POST', '/api/telemetry'], ['POST', '/api/checkout']]);
  assert.equal(r.storage.getItem('bughunt.v1'), before);
  assert.deepEqual(r.storage.writes().map((w) => w[0]).sort(), ['bughunt.trial.v1', 'bughunt.v1']);
  const st = JSON.parse(r.storage.getItem('bughunt.trial.v1'));
  assert.equal(st['6'].clears, 1); assert.equal(st.score['6'], 1500); assert.equal(st.badges.trial6, true); assert.equal(st.badges.nodeath6, true);
  assert.equal(r.trial.view().unlocked[7], true);
  assert.equal(JSON.stringify(r.types('trial:ok').map((e) => e.p.points)), JSON.stringify([100, 200, 200, 200, 100, 200]));
});

await test('trial rig: stage 7 perfect clear (shortcut, triage, ambush, evidence, paste) -> 2900, sekiro; arena shows pings and the paste box', async () => {
  const r = rig({ clears6: 1 });
  assert.deepEqual((await r.startRun(7)), { ok: true });
  const pings = [];
  r.trial.on('trial:tell', (p) => pings.push(p.cls));
  const acts = act7();
  assert.equal(r.play(acts.filter((a) => a.at < 90000), 89500), 'run');
  assert.equal(r.trial.view().room, 7);
  assert.ok(r.find('#trial-paste'), 'the paste box exists in room 7');
  r.play(acts.filter((a) => a.at >= 90000), 5000);
  assert.equal(r.status(), 'clear');
  const c = r.types('trial:clear')[0].p;
  assert.equal(c.score, 2900); assert.deepEqual(c.badges, ['trial7', 'sekiro']);
  assert.ok(pings.includes('sync') && pings.includes('line') && pings.includes('bar') && pings.includes('underline'));
  assert.deepEqual(r.fetched.map((f) => f[1]), ['/api/save-profile', '/api/telemetry', '/api/menu', '/favicon.ico', '/api/orders/basil']);
  assert.equal(attr(r, 'value').length, 0);
});

await test('paste box: text is cleared at once and never stored; heading and line count only', async () => {
  const r = rig({ clears6: 1 });
  await r.startRun(7);
  r.play(act7().filter((a) => a.at < 90000), 80000);
  const ta = r.find('#trial-paste');
  ta.value = 'x';
  const notyet = [];
  r.trial.on('trial:notyet', (p) => notyet.push(p));
  r.trial.pasteText('not a report');
  assert.equal(notyet.length, 1);
  const pasted = [];
  r.trial.on('trial:pasted', (p) => pasted.push(p));
  const ta2 = r.paste(REPORT('basil'));
  assert.equal(ta2.value, '');
  assert.equal(pasted.length, 1); assert.deepEqual(Object.keys(pasted[0]).sort(), ['heading', 'lines']);
  assert.ok(pasted[0].heading.length <= 60);
  for (const [, v] of r.storage.writes().concat(r.session.writes())) assert.ok(!v.includes('api/orders'), 'no report text anywhere in storage');
});

await test('death: counter, cover flag for the next page, reload after 150 ms, never reload while recording', async () => {
  const r = rig();
  await r.startRun(6);
  const deaths = [];
  r.trial.on('trial:death', (p) => deaths.push(p));
  assert.equal(r.play([]), 'death');
  assert.equal(deaths.length, 1);
  assert.deepEqual([deaths[0].deaths, deaths[0].cause, deaths[0].room, deaths[0].rest, deaths[0].badge], [1, 'buffer-missed', 1, false, null]);
  assert.deepEqual(Object.keys(deaths[0]).sort(), ['badge', 'cause', 'deaths', 'n', 'rest', 'room', 't']);
  const cover = r.trial.view().cover;
  assert.deepEqual([cover.n, cover.deaths, cover.room, cover.kind], [6, 1, 1, 'death']);
  assert.equal(JSON.stringify(r.trial.view()).includes('buffer-missed'), false, 'the cause is not in the view (owner: no hints of any kind)');
  const died = r.clock.now();
  r.clock.advance(400);
  assert.equal(r.reloads.length, 1); assert.ok(r.reloads[0] - died >= 100 && r.reloads[0] - died <= 250, `reload ${r.reloads[0] - died} ms after death`);
  // a death while the session is recording waits for Stop
  const q = rig();
  await q.startRun(6);
  q.play([{ at: 5000, do: (x) => { x.qaw.state = 'recording'; x.qaw.counts.buffer += 1; } }, { at: 100, do: () => {} }]);
  assert.equal(q.play([]), 'death');
  q.clock.advance(3000);
  assert.equal(q.reloads.length, 0, 'recording: no reload, the cover waits');
  q.qaw.state = 'stopped'; q.clock.advance(300);
  assert.equal(q.reloads.length, 1, 'after Stop the restart goes ahead');
});

await test('restart: the next page restores from the cover flag, door opens, run starts <= 1 s after the reload (virtual); Rest every 8th death; Still here at 10', async () => {
  const storage = memStorage(); const session = memStorage();
  const log = [];
  let rg = rig({ storage, session });
  await rg.startRun(6);
  for (let i = 1; i <= 10; i++) {
    const dead = [];
    rg.trial.on('trial:death', (p) => dead.push(p));
    assert.equal(rg.play([]), 'death', `death ${i}`);
    rg.clock.advance(400);
    assert.equal(rg.reloads.length, 1);
    log.push(dead[0]);
    if (i === 10) break;
    // the browser reloads: a new page, same storages, new trial object
    rg = rig({ storage, session });
    assert.equal(await rg.trial.restoreRestart(), true);
    const rg2 = rig({ storage, session }); const o2 = await rg2.trial.open(6); assert.deepEqual([o2.ok, o2.restarting, rg2.status()], [true, true, 'door'], 'open() alone restarts a reloaded page'); rg2.trial.destroy();
    assert.equal(rg.trial.view().cover.deaths, i, 'cover repaints from sessionStorage until the run starts');
    const t0 = rg.clock.now();
    assert.equal(rg.until(() => rg.status() === 'run', 3000), true);
    assert.ok(rg.clock.now() - t0 <= 400, `door to running ${rg.clock.now() - t0} ms`);
    assert.equal(rg.trial.view().cover, null, 'cover flag cleared once running');
    assert.equal(rg.trial.view().attempt, i + 1);
  }
  assert.deepEqual(log.map((d) => d.rest), [false, false, false, false, false, false, false, true, false, false]);
  assert.deepEqual(log.map((d) => d.badge), [null, null, null, null, null, null, null, null, null, 'stillhere']);
  assert.equal(JSON.parse(storage.getItem('bughunt.trial.v1')).badges.stillhere, true);
  assert.equal(JSON.parse(storage.getItem('bughunt.trial.v1'))['6'].deaths, 10);
  assert.equal(JSON.parse(storage.getItem('bughunt.trial.v1'))['6'].bestRoom, 1);
});

await test('Rest: leaving cancels the restart and the cover; deaths are kept', async () => {
  const r = rig();
  await r.startRun(6); r.play([]);
  r.trial.leave();
  r.clock.advance(1000);
  assert.equal(r.reloads.length, 0); assert.equal(r.trial.view().cover, null); assert.equal(r.status(), 'idle');
  assert.equal(JSON.parse(r.storage.getItem('bughunt.trial.v1'))['6'].deaths, 1);
});

await test('door: closed unless qawState is ready; the clock does not run while it is closed; stopped reloads first', async () => {
  const r = rig({ state: 'asleep' });
  await r.trial.open(6); r.trial.begin();
  r.clock.advance(5000);
  assert.equal(r.status(), 'door'); assert.equal(r.trial.view().door, false); assert.equal(r.trial.view().t, 0);
  r.qaw.state = 'recording'; r.clock.advance(2000); assert.equal(r.status(), 'door');
  r.qaw.state = 'ready'; r.clock.advance(300); assert.equal(r.status(), 'door', 'the 0.8 s ready beat');
  r.clock.advance(700); assert.equal(r.status(), 'run');
  assert.ok(r.trial.view().t <= 250);
  const s = rig({ state: 'stopped' });
  await s.trial.open(6);
  assert.deepEqual(s.trial.begin(), { ok: true, reload: true }); assert.equal(s.reloads.length, 1); assert.equal(s.trial.view().cover.kind, 'begin');
  const needsAttune = rig({ attuned: false });
  await needsAttune.trial.open(6);
  assert.deepEqual(needsAttune.trial.begin(), { ok: true, attune: true }); assert.equal(needsAttune.status(), 'attune', 'Begin on an un-attuned stage opens the attunement, never a timed room');
});

await test('pause restarts the current room without a death; presses made while paused count for nothing', async () => {
  const r = rig();
  await r.startRun(6);
  r.play(act6().filter((a) => a.at <= 23000), 25000);
  assert.equal(r.trial.view().room, 3);
  assert.equal(r.trial.pause(), true); assert.equal(r.status(), 'paused');
  r.qaw.counts.notes += 1; r.qaw.counts.shots += 1;
  r.clock.advance(6000);
  assert.equal(r.trial.resume(), true); assert.equal(r.status(), 'run');
  assert.equal(r.trial.view().room, 3); assert.ok(Math.abs(r.trial.view().t - 22000) <= 50, `t after resume ${r.trial.view().t}`);
  r.clock.advance(1000); assert.equal(r.status(), 'run', 'pressed-while-paused counts did not kill (no shot-over, no note-early)');
  const rest = [{ at: 23000, do: (x) => x.click('#next') }, { at: 28000, do: (x) => { x.qaw.counts.notes += 1; } }, ...act6().filter((a) => a.at >= 41500)];
  assert.equal(r.play(rest), 'clear');
  assert.equal(r.types('trial:death').length, 0);
});

await test('hidden tab: room 2 of stage 7 pauses; room 6 stops the clock instead and gives LAG_SLOW back', async () => {
  const a = rig({ clears6: 1 });
  await a.startRun(7);
  a.play(act7().filter((x) => x.at <= 4500), 9000);
  a.doc.hidden = true; a.doc.dispatch('visibilitychange');
  assert.equal(a.status(), 'paused');
  const b = rig({ clears6: 1 });
  await b.startRun(7);
  b.play(act7().filter((x) => x.at <= 68000), 64500);
  assert.equal(b.trial.view().room, 6);
  const t1 = b.trial.view().t;
  b.doc.hidden = true; b.doc.dispatch('visibilitychange');
  assert.equal(b.status(), 'run');
  b.clock.advance(20000);
  assert.equal(b.status(), 'run'); assert.equal(b.trial.view().t, t1);
  b.doc.hidden = false; b.doc.dispatch('visibilitychange');
  b.clock.advance(100);
  assert.ok(b.trial.view().t - t1 <= 150, 'the room clock resumed where it stopped');
});

await test('unlock: all five levels need >= 2 stars; stage 7 needs stage 6 cleared; bughunt.v1 is never written; reset clears the trial key', async () => {
  const none = rig({ noStars: true });
  assert.deepEqual(await none.trial.open(6), { ok: false, reason: 'locked' }); assert.equal(none.status(), 'locked');
  const one = rig({ noStars: true });
  one.storage.setItem('bughunt.v1', JSON.stringify({ stars: { l1: 3, l2: 3, l3: 3, l4: 3, l5: 1 } }));
  assert.equal((await one.trial.open(6)).ok, false);
  assert.deepEqual(one.trial.view().unlocked, { 6: false, 7: false });
  const ok = rig();
  assert.equal((await ok.trial.open(7)).reason, 'locked');
  assert.equal((await ok.trial.open(6)).ok, true);
  assert.deepEqual(ok.trial.view().unlocked, { 6: true, 7: false });
  assert.equal((await ok.trial.open(5)).ok, false);
  const writes = ok.storage.writes().filter((w) => w[0] === 'bughunt.v1').length;
  assert.equal(writes, 1, 'only the test seeded it');
  ok.trial.reset();
  assert.equal(ok.storage.getItem('bughunt.trial.v1'), null);
  const src = fs.readFileSync(path.join(GAME_DIR, 'trial.js'), 'utf8');
  assert.ok(!/setItem\(\s*GAME_KEY|removeItem\(\s*GAME_KEY/.test(src), 'trial.js never writes bughunt.v1');
});

await test('attunement: six ticks from real signals; auto-screenshot warning; shortcut offer after two starts without it', async () => {
  const r = rig({ attuned: false, state: 'asleep' });
  await r.trial.open(6);
  assert.deepEqual(await r.trial.attune(), { ok: true });
  const ev = []; r.trial.on('trial:attune', (p) => ev.push(p));
  r.clock.advance(200); assert.equal(ev.length, 0, 'asleep: nothing lit');
  r.qaw.state = 'ready'; r.clock.advance(100);
  r.qaw.counts.buffer += 1; r.qaw.state = 'recording'; r.clock.advance(100);
  r.qaw.state = 'stopped'; r.clock.advance(100);
  // two starts from the popup (no shortcut rise)
  r.qaw.state = 'recording'; r.clock.advance(4000); r.qaw.state = 'stopped'; r.clock.advance(100);
  r.qaw.state = 'recording'; r.clock.advance(4000);
  assert.ok(ev.some((e) => e.offer === 'nokey'), 'offer shown after two failed starts');
  assert.equal(r.trial.view().attune.fails, 2);
  r.qaw.state = 'stopped'; r.clock.advance(100);
  r.qaw.counts.shortcut += 1; r.qaw.state = 'recording'; r.clock.advance(100);
  r.qaw.counts.shots += 1; r.clock.advance(100);
  assert.ok(ev.some((e) => e.warn === 'autoshot'), 'a shot rise while only the noise step runs warns about auto-screenshot');
  r.qaw.counts.expected += 1; r.clock.advance(100);
  r.qaw.counts.shots += 1; r.qaw.counts.notes += 1; r.clock.advance(100);
  r.qaw.state = 'stopped'; r.clock.advance(100);
  assert.deepEqual(ev.filter((e) => e.ok && !e.done).map((e) => e.step), [1, 2, 3, 4, 5, 6]);
  assert.ok(ev.some((e) => e.done));
  const st = JSON.parse(r.storage.getItem('bughunt.trial.v1'));
  assert.equal(st['6'].attuned, true); assert.equal(st['7'].attuned, true); assert.equal(st.shortcutOk, true);
  assert.equal(r.status(), 'card');
  assert.equal(r.trial.fire('glitch'), true); assert.equal(r.trial.fire('noise'), true); assert.equal(r.trial.fire('x'), false);
  assert.deepEqual(r.fetched, [['POST', '/api/sync'], ['POST', '/api/telemetry']]);
  r.trial.allowNoShortcut();
  assert.equal(JSON.parse(r.storage.getItem('bughunt.trial.v1')).shortcutOk, false);
});

await test('planted routes and the trial files are served by game/server.mjs; only the trial files are cacheable', async () => {
  const srv = await imp('server.mjs');
  const seen = [];
  const server = srv.createGameServer({ onRequest: (q) => seen.push(q) });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  const req = (method, p) => new Promise((resolve, reject) => {
    const rq = http.request({ host: '127.0.0.1', port, method, path: p }, (res) => { const b = []; res.on('data', (c) => b.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(b).toString() })); });
    rq.on('error', reject); rq.end();
  });
  try {
    const want = [['POST', '/api/sync', 503], ['POST', '/api/telemetry', 500], ['POST', '/api/checkout', 500], ['POST', '/api/orders/basil', 503], ['POST', '/api/orders/thyme', 503],
      ['GET', '/api/menu', 404], ['GET', '/api/sync', 405], ['GET', '/api/orders/basil', 405], ['POST', '/api/menu', 405], ['POST', '/api/orders/a/b', 405], ['POST', '/api/orders/', 405], ['GET', '/favicon.ico', 404], ['GET', '/trials/t8.js', 404], ['GET', '/trials/../engine.js', 200]];
    for (const [m, p, s] of want) { const r = await req(m, p); assert.equal(r.status, s, `${m} ${p}`); assert.equal(r.headers['content-security-policy'], srv.CSP); }
    for (const p of ['/trial.js', '/trials/t6.js', '/trials/t7.js', '/trials/attune.js']) { const r = await req('GET', p); assert.equal(r.status, 200, p); assert.equal(r.headers['cache-control'], 'max-age=30', p); assert.ok(r.headers['content-type'].startsWith('text/javascript')); }
    for (const p of ['/engine.js', '/scoring.json', '/levels/l1.js']) assert.equal((await req('GET', p)).headers['cache-control'], 'no-store', p);
    assert.ok(seen.every((q) => q.contentLength === 0), 'no request body');
    const src = fs.readFileSync(path.join(GAME_DIR, 'server.mjs'), 'utf8');
    assert.doesNotMatch(src, /req\.on\(\s*['"]data|req\.read\(|for await \(const \w+ of req\)/);
  } finally { server.closeAllConnections?.(); await new Promise((res) => server.close(res)); }
});

await test('trial sources: no forbidden token, no randomness or Date, no external URL, no clipboard read, LF, no confirm, no model call', () => {
  for (const f of ['trial.js', 'trials/t6.js', 'trials/t7.js', 'trials/attune.js', 'scoring.js', 'scoring.json', 'server.mjs']) {
    const src = fs.readFileSync(path.join(GAME_DIR, f), 'utf8');
    assert.doesNotMatch(src, /streak|daily|freeze|flame|combo|leaderboard|notification|alarm|Math\.random/i, f);
    assert.doesNotMatch(src, /https?:\/\/(?!localhost|127\.0\.0\.1)/i, `${f} names an external URL`);
    assert.doesNotMatch(src, /new Date|Date\.now|crypto\.getRandomValues|font-family|Cairo/, f);
    assert.doesNotMatch(src, /clipboard\s*\.\s*read|\bconfirm\s*\(|\balert\s*\(|\bprompt\s*\(|XMLHttpRequest|WebSocket|sendBeacon|openrouter|gemini/i, f);
    assert.ok(!src.includes('\r'), `${f} is LF`);
  }
  const src = fs.readFileSync(path.join(GAME_DIR, 'trial.js'), 'utf8');
});

done();
