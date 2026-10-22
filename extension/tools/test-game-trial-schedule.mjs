/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @suite lane=node feature=game reason=drives game/trial.js through a dynamic import inside lib-game-trial.mjs, so it is a node suite and not a pure gate
/**
 * Bug Hunt hard trials, schedule and rules (DESIGN-bug-hunt-hard.md sections 3, 5, 6, 11; lane T3). Node only, virtual clock.
 * (T1 owns test-game-trial-engine.mjs, the unit view of the same code; this suite is the black-box view through createTrial().)
 *
 *   node tools/test-game-trial-schedule.mjs        (from extension/, PYTHONUTF8=1)
 *
 * The real game/trial.js is driven through createTrial() with a fake DOM, a fake clock and a QA Wrap simulator (lib-game-trial.mjs):
 *   - the schedules equal the tables of sections 5 and 6 (tells, planted requests, rooms), the same on two runs and for any lag;
 *   - the scripted perfect player clears both stages with the scores of section 3.10;
 *   - the judge: stale counts, a count that drops on a new session, the toast overlap that is decided for the decoy;
 *   - pause and hidden tab restart the room, never a death; the door opens only while QA Wrap is not recording;
 *   - a death restarts in under a second; the counter; the "Still here" badge; Rest never blocks the restart;
 *   - Calm mode keeps every window identical; no Math.random; no hint text in stages 6-7 (EN and AR); trial.* parity.
 * Skips with exit 2 while game/trial.js has not landed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import * as L from './lib-game-trial.mjs';

const SUITE = 'test-game-trial-schedule';
const trialsLanded = L.missingT1().length === 0;
let skipped = 0;

/* ---- static halves that need only the files -------------------------------------------------------------------------- */
{
  const src = L.trialSources();
  if (!src.length) { skipNotEnforced({ rule: 'game-trial', what: 'static scans of the trial sources', why: 'game/trial*.js and game/trials/** have not landed' }); skipped++; } else {
    nonEmpty(src, 'trial source files');
    const js = src.filter(([f]) => /\.m?js$/.test(f)).map(([f, s]) => [f, L.stripComments(s)]);
    const bad = js.filter(([, s]) => /Math\s*\.\s*random/.test(s)).map(([f]) => f);
    ok(bad.length === 0, 'no Math.random in any trial file (the pattern is fixed, identical every attempt)', bad.join());
    const tok = js.flatMap(([f, s]) => (s.match(L.FORBIDDEN_TOKENS) || []).map((m) => `${f}: ${m}`));
    ok(tok.length === 0, 'no streak / daily / freeze / flame / combo / leaderboard / notification / alarm token in the trial code', tok.slice(0, 4).join(' | '));
    proveTeeth('the Math.random scan', (s) => (/Math\s*\.\s*random/.test(s) ? ['x'] : []), 'const x = Math.random()');
    proveTeeth('the forbidden-token scan', (s) => (s.match(L.FORBIDDEN_TOKENS) || []), 'const dailyStreak = 1');
    const ext = js.filter(([, s]) => /\bchrome\s*\.\s*(?:runtime|storage|tabs|permissions)|clipboard\s*\.\s*read|document\s*\.\s*cookie|indexedDB|XMLHttpRequest|WebSocket|sendBeacon/.test(s)).map(([f]) => f);
    ok(ext.length === 0, 'the trial code uses no chrome.*, clipboard read, cookie, IndexedDB or side channel', ext.join());
  }
}
{
  const en = L.loadStrings('en'); const ar = L.loadStrings('ar');
  const tk = (o) => Object.keys(o).filter((k) => k.startsWith('trial.')).sort();
  if (!tk(en).length) { skipNotEnforced({ rule: 'game-trial', what: 'trial.* strings (hints, parity, banned terms)', why: 'game/strings has no trial.* keys yet (T2)' }); skipped++; } else {
    ok(JSON.stringify(tk(en)) === JSON.stringify(tk(ar)), 'trial.* has the same key set in EN and AR', `only EN: ${tk(en).filter((k) => !(k in ar)).join()} only AR: ${tk(ar).filter((k) => !(k in en)).join()}`);
    const runKeys = tk(en).filter(L.inRunKey);
    nonEmpty(runKeys, 'in-run string keys (trial.shop.*, trial.deaths, trial.pause.note, trial.paste.*, ...)');
    const hintEn = runKeys.filter((k) => L.HINT_WORDS_EN.test(en[k]));
    const hintAr = runKeys.filter((k) => L.HINT_WORDS_AR.test(ar[k] || ''));
    ok(hintEn.length === 0, 'NO hint text anywhere a trial run can paint (EN): no hint / tip / try / should / press / click / now ...', hintEn.map((k) => `${k}="${en[k]}"`).join(' | '));
    ok(hintAr.length === 0, 'NO hint text anywhere a trial run can paint (AR)', hintAr.map((k) => `${k}="${ar[k]}"`).join(' | '));
    proveTeeth('the hint-word scan (EN)', (s) => (L.HINT_WORDS_EN.test(s) ? ['hit'] : []), 'Try pressing Next now');
    proveTeeth('the hint-word scan (AR)', (s) => (L.HINT_WORDS_AR.test(s) ? ['hit'] : []), 'جرّب أن تضغط الآن');
    const hintKeys = tk(en).filter((k) => /(^|\.)(hint|nudge|needs|voice|skip|finish|chip|caption)(\.|$)/.test(k));
    ok(hintKeys.length === 0, 'no trial.* key is named hint / nudge / needs / voice / skip / finish / chip / caption', hintKeys.join());
    const bannedKeys = tk(en).filter((k) => L.BANNED_TERMS.test(en[k]));
    ok(bannedKeys.length === 0, 'trial.* EN strings carry none of the banned terms (photograph, harvest, arm, crosshair, "Stop &")', bannedKeys.join());
    const amp = tk(en).filter((k) => /^trial\.(begin|later|next|death\.restbtn|attune\.(open|back|allow|fire\.))/.test(k) && /[&+]/.test(en[k]));
    ok(amp.length === 0, 'no trial button label contains "&" or "+"', amp.join());
    const stopLabels = tk(en).filter((k) => /^Stop\b/.test(en[k]) && en[k] !== 'Stop');
    ok(stopLabels.length === 0, 'any trial label starting "Stop" is exactly "Stop"', stopLabels.join());
    const noRed = tk(en).filter((k) => /\b(you died|failed|fail|dead|game over|wasted|wrong)\b/i.test(en[k]) && !/^trial\.(shop\.|cause\.)/.test(k));
    ok(noRed.length === 0, 'no "you died / failed / game over / wrong" wording in the cover, card or HUD (neutral Again / Deaths N)', noRed.map((k) => `${k}="${en[k]}"`).join(' | '));
    ok(/^Deaths \{n\}$/.test(en['trial.deaths'] || '') && /^Again$/.test(en['trial.death.again'] || ''), 'the counter reads "Deaths {n}" and the cover "Again"');
    const aid = tk(en).filter((k) => /^trial\.(notes|cause)\b/.test(k));
    ok(aid.length === 0, 'APPROVAL-hard: the "Field notes" / cause text aid is REMOVED (no trial.notes.* or trial.cause.* string)', aid.join());
  }
}
{
  // scoring: the main `tools` table is untouched (stars 1-5 keep their rules); the trial block exists next to it
  const sc = JSON.parse(fs.readFileSync(path.join(L.GAME, 'scoring.json'), 'utf8'));
  if (!sc.trial) { skipNotEnforced({ rule: 'game-trial', what: 'scoring.json key trial', why: 'T1 has not added it yet' }); skipped++; } else {
    const blob = JSON.stringify(sc.trial);
    ok(/factor/.test(blob) && /clearBonus/.test(blob) && /500/.test(blob) && /1000/.test(blob), 'scoring.json has a trial block with factor and clearBonus 500 / 1000', blob.slice(0, 120));
    try {
      const head = JSON.parse(execFileSync('git', ['show', 'HEAD:extension/game/scoring.json'], { cwd: path.join(L.EXT, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
      ok(JSON.stringify(head.tools) === JSON.stringify(sc.tools) && JSON.stringify(head.par) === JSON.stringify(sc.par), 'the main scoring tools and par tables are byte-identical to HEAD (levels 1-5 and their stars are untouched)');
    } catch { console.log('  --  git HEAD not readable here; the tools-table comparison is skipped'); }
  }
}
if (!trialsLanded) {
  skipNotEnforced({ rule: 'game-trial', what: 'the schedule, judge, door, restart and Calm checks', why: `game/${L.missingT1().join(', game/')} have not landed (T1)` });
  finish(SUITE, { skipped: 1 });
}

/* ---- 1. the schedules equal the tables ------------------------------------------------------------------------------- */
const near = (a, b, tol = L.FRAMES) => Math.abs(a - b) <= tol;
const clean = {};
for (const n of [6, 7]) {
  const O = L.ORACLE[n];
  const { rig, death, clear } = await L.playOnce(n, L.PERFECT[n]);
  clean[n] = { rig, death, clear };
  ok(!death && !!clear, `stage ${n}: the scripted skilled player clears with no death`, death ? `died: ${JSON.stringify(death)}` : 'no clear event');
  ok(rig.missing.length === 0, `stage ${n}: every scripted click found its target (${rig.missing.join(', ') || 'none missing'})`);
  ok(rig.errors.length === 0, `stage ${n}: no error thrown by the harness or destroy()`, rig.errors.join());
  const fetches = L.fetchTimeline(rig, 0);
  ok(fetches.length === O.fetches.length, `stage ${n}: exactly ${O.fetches.length} planted requests in a clean run`, JSON.stringify(fetches));
  for (const [method, p, status, sec] of O.fetches) {
    const f = fetches.find((x) => x.method === method && (p.endsWith('/') ? x.path.startsWith(p) : x.path === p));
    ok(!!f && near(f.sec, sec), `stage ${n}: ${method} ${p} fires at ${sec} s`, f ? `fired at ${f.sec}` : 'never fired');
    ok(!!f && f.status === status, `stage ${n}: ${method} ${p} answers ${status}`, f ? String(f.status) : '');
  }
  const rooms = L.roomTimeline(rig, 0);
  O.rooms.forEach((sec, i) => { const r = rooms.find((x) => x.room === i + 1); ok(!!r && near(r.sec, sec), `stage ${n}: room ${i + 1} starts at ${sec} s`, r ? `at ${r.sec}` : 'no room event'); });
  ok(rooms.some((x) => x.room === (n === 6 ? 5 : 7)), `stage ${n}: the last room (${n === 6 ? 5 : 7}) was reached`, JSON.stringify(rooms));
  const tells = rig.tellsOf(0).map((x) => ({ cls: x.cls, sec: x.rel }));
  for (const [cls, sec] of O.tells) ok(tells.some((x) => x.cls === cls && near(x.sec, sec)), `stage ${n}: the ${cls} tell starts at ${sec} s`, JSON.stringify(tells));
  const pts = rig.ev('trial:ok').reduce((s, e) => s + e.points, 0);
  ok(clear && clear.score === O.total, `stage ${n}: a full clear scores ${O.total} (${O.subtotal} + clear bonus ${O.bonus})`, `score ${clear && clear.score}`);
  ok(pts === O.subtotal, `stage ${n}: the correct actions add up to ${O.subtotal}`, `sum ${pts}`);
  const sec = clear ? clear.ms / 1000 : 0;
  ok(sec >= O.skilled[0] - 1 && sec <= O.skilled[1], `stage ${n}: the skilled clear takes ${O.skilled[0]}-${O.skilled[1]} s (floor ${O.floor} s)`, `${sec} s`);
  ok(clear && Array.isArray(clear.badges) && clear.badges.length >= 1, `stage ${n}: the clear event lists badges`, JSON.stringify(clear && clear.badges));
}
// the steady ring on Next: dark before the room, lit from the room's second
for (const n of [6, 7]) {
  const rig = await L.makeRig({ n, scripts: (k) => (k === 0 ? L.PERFECT[n].filter((a) => a.at < (n === 6 ? 21 : 48)) : null) });
  await rig.start();
  await rig.until(() => rig.rel() !== null && rig.rel() >= L.ORACLE[n].ring - 0.3, 90);
  const ring = () => rig.page.doc.querySelector('#next')?.getAttribute('data-ring');
  ok(ring() === '0', `stage ${n}: the ring on Next is off 0.3 s before ${L.ORACLE[n].ring} s`, String(ring()));
  await rig.run(0.5);
  ok(ring() === '1', `stage ${n}: the ring on Next is on from ${L.ORACLE[n].ring} s (steady, not blinking)`, String(ring()));
  rig.destroy();
}
// a mistake in the oracle would make everything above vacuous
proveTeeth('the schedule check', (f) => (near(f, 4.2) ? [] : ['off']), 5.2);

/* ---- 2. determinism: same log twice, and the schedule does not depend on the player's lag ------------------------------- */
{
  const strip = (r) => JSON.stringify(r.events.map((e) => { const { t, ...rest } = e; return { ...rest, rel: e.rel === null ? null : Math.round(e.rel * 1000) }; })) + JSON.stringify(L.fetchTimeline(r, 0));
  for (const n of [6, 7]) {
    const again = await L.playOnce(n, L.PERFECT[n]);
    ok(strip(again.rig) === strip(clean[n].rig), `stage ${n}: two runs with the same player give the same event log and the same requests (deterministic)`);
    const slow = await L.playOnce(n, L.PERFECT[n], { rigOpts: { lagSlow: 3.0, lagFast: 0.3 } });
    const sched = (r) => JSON.stringify([L.fetchTimeline(r, 0).map((f) => [f.path.replace(/\/[a-z]+$/, ''), Math.round(f.sec * 20)]), L.roomTimeline(r, 0).filter((x) => x.room <= 6).map((x) => [x.room, Math.round(x.sec * 20)]), r.tellsOf(0).filter((x) => x.rel < 70).map((x) => [x.cls, Math.round(x.rel * 20)])]);
    ok(sched(slow.rig) === sched(clean[n].rig), `stage ${n}: the planted schedule is identical for a slower QA Wrap (lag 3.0 s / 0.3 s)`);
    ok(!slow.death && !!slow.clear, `stage ${n}: a slow QA Wrap (lag 3.0 / 0.3) still clears with the same player`, slow.death ? JSON.stringify(slow.death) : '');
  }
}

/* ---- 3. the judge ------------------------------------------------------------------------------------------------------ */
{
  // a count left over from an earlier session is not an early press, and a count that drops on a new session is rebased
  const stale = await L.makeRig({ n: 6, scripts: (k) => (k === 0 ? L.PERFECT[6] : null) });
  stale.set({ shots: 5, notes: 3, marks: 2, expected: 4 });
  await stale.start();
  await stale.until(() => stale.deaths().length + stale.clears().length > 0, 100);
  ok(stale.clears().length === 1 && stale.deaths().length === 0, 'stage 6: leftover counts from an earlier session (shots 5, notes 3) are a baseline, not an early press (F5)', JSON.stringify(stale.deaths()[0] || {}));
  const stale7 = await L.makeRig({ n: 7, scripts: (k) => (k === 0 ? L.PERFECT[7] : null) });
  stale7.set({ shots: 5, notes: 3, marks: 2, expected: 4, shortcut: 2 });
  await stale7.start();
  await stale7.until(() => stale7.deaths().length + stale7.clears().length > 0, 130);
  ok(stale7.clears().length === 1 && stale7.deaths().length === 0, 'stage 7: leftover counts (shortcut 2, shots 5) do not count as presses; the report session\'s counts start again from 0', JSON.stringify(stale7.deaths()[0] || {}));
  // the toast overlap is decided for the decoy: an observation at 15.40 s (decoy 2b runs to 15.45) passes
  const pass = await L.playOnce(7, L.mut(L.PERFECT[7], 'nb2b', { at: 15.35 }));
  ok(!pass.death && !!pass.clear, 'stage 7: a Not a bug observed at 15.40 s (overlap of decoy 2b and real 2c) passes for the decoy', pass.death ? JSON.stringify(pass.death) : '');
  const dead = await L.playOnce(7, L.mut(L.PERFECT[7], 'nb2b', { at: 15.45 }));
  ok(dead.death && dead.death.room === 2, 'stage 7: a Not a bug observed at 15.50 s (decoy 2b window is over) ends the run in room 2', JSON.stringify(dead.death));
  const early7 = await L.playOnce(7, L.mut(L.PERFECT[7], 'nb2b', { at: 10.0 }));
  ok(early7.death && early7.death.cause === 'notbug-real', 'stage 7: Not a bug while the lie "Saved" (2a) is on screen is lethal (notbug-real)', JSON.stringify(early7.death));
}

/* ---- 4. pause and hidden tab: the room restarts, nothing dies ---------------------------------------------------------- */
{
  const script = [...L.PERFECT[6].filter((a) => a.at < 40), { id: 'p1', at: 41.0, kind: 'pause' }, { id: 'press', at: 45.0, kind: 'notbug' }];
  const rig = await L.makeRig({ n: 6, scripts: (k) => (k === 0 ? script : null) });
  await rig.start();
  await rig.until(() => rig.rel() !== null && rig.rel() >= 49.9, 80);
  ok(rig.deaths().length === 0 && L.statusOf(rig.view) === 'paused', 'pause: pausing in room 4 and pressing Not a bug while paused does not kill (status paused)', `${L.statusOf(rig.view)} ${JSON.stringify(rig.deaths()[0] || {})}`);
  const nowAt = rig.clock.now();
  const before = rig.events.filter((e) => e.type === 'trial:room' && e.room === 4).length;
  rig.page.trial.resume();
  await rig.run(0.2);
  const after = rig.events.filter((e) => e.type === 'trial:room' && e.room === 4).length;
  ok(after === before + 1, 'pause: resuming restarts the CURRENT room from its tell (a second room-4 event)', `room-4 events ${before} -> ${after}`);
  const fetchesBefore = rig.fetches.length;
  await rig.run(0.8);
  rig.perform({ kind: 'notbug' }); // the harmless failure of the restarted room, pressed 1.05 s into it
  await rig.run(3.2);
  const fired = rig.fetches.slice(fetchesBefore).map((f) => ({ path: f.path, sec: (f.t - nowAt) / 1000 }));
  ok(fired.some((f) => f.path === '/api/telemetry' && near(f.sec, 0.8, 0.12)) && fired.some((f) => f.path === '/api/checkout' && near(f.sec, 3.0, 0.12)), 'pause: after resume the decoy and the real failure fire 0.8 s and 3.0 s into the restarted room', JSON.stringify(fired));
  ok(rig.deaths().length === 0, 'pause: the press made while paused counts for nothing and the restarted room judges only what happens after (no death)', JSON.stringify(rig.deaths()[0] || {}));
  rig.destroy();

  // hidden tab in a room that waits on nothing slow: acts as a pause; the room restarts when the player resumes
  const h = await L.makeRig({ n: 6, scripts: (k) => (k === 0 ? L.PERFECT[6].filter((a) => a.at < 40) : null) });
  await h.start();
  await h.until(() => h.rel() !== null && h.rel() >= 41, 60);
  h.hide(true); await h.run(12); h.hide(false); await h.run(0.3);
  ok(h.deaths().length === 0 && L.statusOf(h.view) === 'paused', 'hidden tab: 12 s hidden in room 4 is a pause, not a death', `${L.statusOf(h.view)} ${JSON.stringify(h.deaths()[0] || {})}`);
  h.page.trial.resume(); await h.run(0.3);
  ok(h.events.filter((e) => e.type === 'trial:room' && e.room === 4).length >= 2, 'hidden tab: resuming restarts the room from its tell');
  h.destroy();

  // hidden tab while the room waits on a SLOW count (stage 7 room 6, Mark up): the room's clock stops, nothing dies, the deadline moves out
  const shotUntil = L.PERFECT[7].filter((a) => a.at <= 66.4);
  const w = await L.makeRig({
    n: 7,
    scripts: (k) => (k === 0 ? [...shotUntil,
      { id: 'hide', at: 68.5, kind: 'fn', fn: (r) => r.hide(true) },
      { id: 'show', at: 128.5, kind: 'fn', fn: (r) => r.hide(false) },
      { id: 'markup', at: 130.0, kind: 'markup' }, { id: 'stop2', at: 133.0, kind: 'stop' }, { id: 'paste', at: 138.0, kind: 'paste' }] : null),
  });
  await w.start();
  await w.until(() => w.deaths().length + w.clears().length > 0, 160);
  ok(w.deaths().length === 0 && w.clears().length === 1, 'hidden tab: 60 s hidden in stage 7 room 6 (waiting on the mark-up) freezes the room: no markup-missed, and the stage is cleared afterwards', JSON.stringify(w.deaths()[0] || { clears: w.clears().length }));
  w.destroy();
}

/* ---- 5. the door: only while QA Wrap is not recording ------------------------------------------------------------------ */
{
  for (const [state, how] of [['ready', 'opens at once'], ['stopped', 'is reloaded under the cover, then opens'], ['recording', 'keeps the door shut'], ['asleep', 'keeps the door shut'], [null, 'keeps the door shut']]) {
    const open = how !== 'keeps the door shut';
    const rig = await L.makeRig({ n: 6, qawInit: state });
    await rig.start();
    await rig.run(3);
    const ran = rig.ev('trial:room').length > 0 || rig.ev('trial:tell').length > 0 || rig.fetches.length > 0;
    ok(ran === open, `door: qawState ${state === null ? '(no attribute)' : state} ${how}${open ? '' : ': no room, no tell, no request'}`, `room events ${rig.ev('trial:room').length}`);
    if (state === 'stopped') ok(rig.reloads.length === 1, 'door: a "stopped" page is reloaded once (the bridge then reads ready)', `reloads ${rig.reloads.length}`);
    if (!open) {
      const doors = rig.ev('trial:door');
      ok(doors.length === 0 || doors.every((d) => d.open === false), `door: while closed every trial:door event says open:false (${state})`, JSON.stringify(doors));
      rig.set({ state: 'ready' });
      await rig.run(3);
      ok(rig.ev('trial:room').length > 0, `door: it opens by itself once QA Wrap is awake and not recording (from ${state === null ? 'no attribute' : state})`);
    }
    rig.destroy();
  }
  // door-wait is not counted in any time: the clock of the stage starts at the first room event
  const rig = await L.makeRig({ n: 6, qawInit: 'recording' });
  await rig.start(); await rig.run(30); rig.set({ state: 'ready' }); await rig.run(2);
  const t0 = rig.events.find((e) => e.type === 'trial:room' && e.room === 1);
  ok(!!t0 && t0.rel === 0, 'door: 30 s of waiting before the door opened are not part of the stage clock (room 1 is t = 0)');
  rig.destroy();
}

/* ---- 6. death and restart ---------------------------------------------------------------------------------------------- */
{
  // a death that leaves QA Wrap NOT recording: restart in under a second, twelve times
  const stopEarly = [{ id: 'stop', at: 1.0, kind: 'stop' }];
  const rig = await L.makeRig({ n: 6, scripts: () => stopEarly });
  await rig.start();
  await rig.until(() => rig.deaths().length >= 12, 400);
  const d = rig.deaths();
  ok(d.length >= 12, 'restart: twelve deaths in a row, each restarts by itself (no menu, no press)', `deaths ${d.length}`);
  ok(d.every((x) => x.cause === 'stop-early' && x.room === 1), 'restart: Stop in room 1 is stop-early in room 1 every time (same pattern, same verdict)', JSON.stringify(d[0]));
  const gaps = []; const reloadGaps = [];
  for (const x of d) {
    const deathAt = rig.events.find((e) => e.type === 'trial:death' && e.deaths === x.deaths).t;
    const nextRoom = rig.events.find((e) => e.type === 'trial:room' && e.room === 1 && e.t > deathAt);
    if (nextRoom) gaps.push(nextRoom.t - deathAt);
    const rl = rig.reloads.find((r) => r >= deathAt);
    if (rl !== undefined) reloadGaps.push(rl - deathAt);
  }
  nonEmpty(gaps, 'death-to-running gaps');
  gaps.sort((a, b) => a - b);
  ok(gaps[gaps.length - 1] <= 1000, 'restart: death to the running schedule is at most 1.0 s on every one of the twelve (door open, door-wait excluded)', `max ${gaps[gaps.length - 1]} ms, p50 ${gaps[Math.floor(gaps.length / 2)]} ms`);
  ok(reloadGaps.length >= 11 && Math.max(...reloadGaps) <= 250, 'restart: the page reloads within 250 ms of the death (cover 120 ms, reload at 150 ms)', JSON.stringify(reloadGaps.slice(0, 5)));
  ok(rig.errors.length === 0, 'restart: no error thrown while restarting', rig.errors.join());
  // counter
  const counts = d.map((x) => x.deaths);
  ok(counts.every((c, i) => c === i + 1), 'counter: trial:death carries deaths 1, 2, 3 ... 12', counts.join());
  const shown = rig.page.doc.querySelector('[data-trial-deaths]');
  ok(!!shown, 'counter: [data-trial-deaths] is in the arena');
  ok(rig.view.deaths >= 12, 'counter: view().deaths survives the reloads (stored per stage)', String(rig.view.deaths));
  ok(d[7].rest === true && d.filter((x) => x.rest).length === 1, 'Rest: exactly the 8th death of twelve offers Rest (every 8th)', JSON.stringify(d.map((x) => x.rest)));
  ok(d[9].badge === 'stillhere' && d.filter((x) => x.badge).length === 1, 'badge: the 10th death awards Still here, once', JSON.stringify(d.map((x) => x.badge)));
  ok(JSON.stringify(rig.view.badges || {}).includes('stillhere'), 'badge: Still here is held after the 10th death', JSON.stringify(rig.view.badges));
  const tr = JSON.parse(rig.storage.getItem(L.TRIAL_KEY));
  ok(JSON.stringify(tr.badges || {}).includes('stillhere'), 'badge: Still here is in bughunt.trial.v1', JSON.stringify(tr.badges));
  ok(tr['6'].clears === 0, 'badge: dying is never a clear (clears stays 0)');
  rig.destroy();

  // a death while recording: QA Wrap keeps recording, so the stage waits at the door until the tester presses Stop
  const rec = await L.makeRig({ n: 6, scripts: (k) => (k === 0 ? [{ id: 'buffer', at: 0.5, kind: 'buffer' }] : null) });
  await rec.start();
  await rec.until(() => rec.deaths().length > 0, 30);
  ok(rec.deaths()[0]?.cause === 'buffer-early', 'restart: Save last 2 minutes before the glitch is buffer-early', JSON.stringify(rec.deaths()[0]));
  await rec.run(10);
  ok(rec.sim.state === 'recording' && rec.reloads.length === 0 && rec.ev('trial:room').filter((e) => e.room === 1).length === 1, 'restart: QA Wrap still recording, so the stage does NOT restart by itself and does not reload', `reloads ${rec.reloads.length}, room-1 events ${rec.ev('trial:room').filter((e) => e.room === 1).length}`);
  rec.set({ state: 'stopped' });
  await rec.run(1.5);
  ok(rec.ev('trial:room').filter((e) => e.room === 1).length === 2, 'restart: pressing Stop reloads and attempt 2 starts within 1.5 s (each attempt is its own session)', `room-1 events ${rec.ev('trial:room').filter((e) => e.room === 1).length}`);
  rec.destroy();

  // Rest never blocks: after 8 deaths the 9th attempt has started on its own
  const r8 = await L.makeRig({ n: 6, scripts: () => stopEarly });
  await r8.start(); await r8.until(() => r8.deaths().length >= 8, 200); await r8.run(1.2);
  ok(r8.ev('trial:room').filter((e) => e.room === 1).length >= 9, 'Rest: after the 8th death the next attempt still starts by itself (the cover offers Rest, it never blocks the restart)');
  r8.destroy();
}

/* ---- 7. Calm mode keeps every window identical ------------------------------------------------------------------------- */
{
  for (const n of [6, 7]) {
    const calm = await L.playOnce(n, L.PERFECT[n], { rigOpts: { calm: true } });
    const norm = clean[n].rig;
    const sched = (r) => JSON.stringify([L.fetchTimeline(r, 0).map((f) => [f.path, Math.round(f.sec * 20)]), L.roomTimeline(r, 0).map((x) => [x.room, Math.round(x.sec * 20)]), r.tellsOf(0).map((x) => [x.cls, Math.round(x.rel * 20)])]);
    ok(!calm.death && !!calm.clear, `Calm: stage ${n} clears with the same player`, calm.death ? JSON.stringify(calm.death) : '');
    ok(sched(calm.rig) === sched(norm), `Calm: stage ${n} tells, planted requests and rooms are at the same seconds as in normal mode (same windows, same difficulty)`);
    ok(calm.clear && Math.abs(calm.clear.ms - clean[n].clear.ms) <= 60, `Calm: stage ${n} clear time is the same (${calm.clear && calm.clear.ms} ms vs ${clean[n].clear.ms} ms)`);
    ok(calm.rig.page.doc.querySelector('#trial-arena')?.getAttribute('data-calm') === '1' || calm.rig.page.root.querySelector('[data-calm]')?.getAttribute('data-calm') === '1', `Calm: stage ${n} arena carries data-calm="1" (the style hook for steady tells)`);
  }
  // the edges: the same press is accepted / rejected in both modes
  const probes = [
    ['edge-accepted', L.mut(L.PERFECT[6], 'shot', { at: 17.5, lag: 3.6 }), null],
    ['early', L.mut(L.PERFECT[6], 'shot', { at: 14.0, lag: 1.0 }), 'shot-early'],
    ['missed', L.mut(L.PERFECT[6], 'shot', null), 'shot-missed'],
  ];
  for (const [name, script, cause] of probes) {
    const a = await L.playOnce(6, script); const b = await L.playOnce(6, script, { rigOpts: { calm: true } });
    const va = a.death ? a.death.cause : 'clear'; const vb = b.death ? b.death.cause : 'clear';
    ok(va === vb && va === (cause || 'clear'), `Calm: screenshot window edge "${name}" gives ${cause || 'a clear'} in normal and Calm mode`, `normal ${va}, calm ${vb}`);
  }
}

finish(SUITE, { skipped });
