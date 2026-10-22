/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @suite lane=node feature=game reason=drives game/trial.js through a dynamic import inside lib-game-trial.mjs, so it is a node suite and not a pure gate
/**
 * Bug Hunt hard trials, unlock and storage (DESIGN-bug-hunt-hard.md sections 3.1, 3.7, 4 and 11; lane T3). Node only.
 *
 *   node tools/test-game-trial-unlock.mjs        (from extension/, PYTHONUTF8=1)
 *
 *   - locked until all five levels have stars >= 2 (a skipped level has 1); stage 7 opens only after stage 6 is cleared;
 *   - opt-in: nothing runs until Begin; a tester who has not attuned lands on the attunement, not on a timed room;
 *   - the stars, score and best times of levels 1-5 are untouched: bughunt.v1 is never written, byte-identical after a full trial;
 *     the trial writes only bughunt.trial.v1;
 *   - bad storage (corrupt JSON, hostile values, a throwing setItem) never breaks a run; destroy() leaves no timer behind.
 * Skips with exit 2 while game/trial.js has not landed.
 */
import { ok, finish } from './lib-assert.mjs';
import * as L from './lib-game-trial.mjs';

const SUITE = 'test-game-trial-unlock';
L.needTrial(SUITE);

const main = (stars, extra = {}) => JSON.stringify({ prefs: { lang: 'en', theme: 'dark', sound: true, voice: true, volume: 60, calm: false }, best: { run: 123456, l1: 40000, l2: null, l3: null, l4: null, l5: null }, stars: Object.fromEntries(stars.map((s, i) => [`l${i + 1}`, s])), stickers: {}, bonus: {}, ...extra });
const trialKey = (o = {}) => JSON.stringify({ 6: { deaths: 0, bestRoom: 0, clears: 0, attuned: true, causes: [] }, 7: { deaths: 0, bestRoom: 0, clears: 0, attuned: true, causes: [] }, badges: {}, score: {}, shortcutOk: true, ...o });
const statusFor = async (n, seed) => { const rig = await L.makeRig({ n, seed, begin: false }); const p = await rig.start(); const s = L.statusOf(p.view()); const events = rig.events.length; rig.destroy(); return { s, events }; };

/* ---- the unlock matrix ------------------------------------------------------------------------------------------------- */
for (const [name, stars, open] of [
  ['all five levels at 3 stars', [3, 3, 3, 3, 3], true],
  ['all five levels at 2 stars (the minimum)', [2, 2, 2, 2, 2], true],
  ['level 5 skipped (1 star)', [3, 3, 3, 3, 1], false],
  ['level 1 skipped (1 star)', [1, 3, 3, 3, 3], false],
  ['level 3 never played (0 stars)', [3, 3, 0, 3, 3], false],
  ['nothing played', [0, 0, 0, 0, 0], false],
]) {
  const { s } = await statusFor(6, { [L.MAIN_KEY]: main(stars), [L.TRIAL_KEY]: trialKey() });
  ok(open ? s === 'card' : s === 'locked', `unlock: stage 6 with ${name} is ${open ? 'open (the card)' : 'locked'}`, `status "${s}"`);
}
{
  const { s } = await statusFor(6, { [L.TRIAL_KEY]: trialKey() });
  ok(s === 'locked', 'unlock: a profile with no save at all is locked', s);
  const t = await statusFor(6, { [L.MAIN_KEY]: main([3, 3, 3, 3, 3]) });
  ok(t.s === 'card' || t.s === 'attune', 'unlock: a first-time profile (no trial storage yet) with the five levels cleared reaches the card or the attunement', t.s);
}
{
  const s7a = await statusFor(7, { [L.MAIN_KEY]: main([3, 3, 3, 3, 3]), [L.TRIAL_KEY]: trialKey() });
  ok(s7a.s === 'locked', 'unlock: stage 7 is locked until stage 6 is cleared', s7a.s);
  const s7b = await statusFor(7, { [L.MAIN_KEY]: main([3, 3, 3, 3, 3]), [L.TRIAL_KEY]: trialKey({ 6: { deaths: 3, bestRoom: 5, clears: 1, attuned: true, causes: [] } }) });
  ok(s7b.s === 'card', 'unlock: stage 7 opens after stage 6 is cleared', s7b.s);
  const s7c = await statusFor(7, { [L.MAIN_KEY]: main([3, 3, 3, 3, 1]), [L.TRIAL_KEY]: trialKey({ 6: { deaths: 0, bestRoom: 5, clears: 1, attuned: true, causes: [] } }) });
  ok(s7c.s === 'locked', 'unlock: stage 7 stays locked while a level 1-5 is skipped, even with stage 6 cleared', s7c.s);
}

/* ---- opt-in and attunement-first --------------------------------------------------------------------------------------- */
{
  const rig = await L.makeRig({ n: 6, seed: { [L.MAIN_KEY]: main([3, 3, 3, 3, 3]), [L.TRIAL_KEY]: trialKey() }, begin: false });
  const p = await rig.start();
  await rig.run(30);
  const runish = rig.events.filter((e) => /^trial:(room|tell|start|door|death|ok|clear)$/.test(e.type));
  ok(L.statusOf(p.view()) === 'card' && runish.length === 0 && rig.fetches.length === 0, 'opt-in: 30 s on the card start nothing (no room, no tell, no planted request) until Begin', `run events ${runish.length}, requests ${rig.fetches.length}`);
  ok(rig.storage.writes.length === 0, 'opt-in: merely opening the card writes nothing to storage', JSON.stringify(rig.storage.writes));
  p.trial.begin();
  await rig.run(2);
  ok(L.statusOf(p.view()) === 'run' && rig.ev('trial:room').length >= 1, 'opt-in: Begin starts the stage (door open, room 1)', L.statusOf(p.view()));
  p.trial.leave();
  const after = rig.events.length; const reqs = rig.fetches.length;
  await rig.run(60);
  ok(rig.events.length === after && rig.fetches.length === reqs, 'leave: after Leave nothing more runs (no room, tell or request for 60 s)', `${rig.events.length - after} new events`);
  ok(['card', 'locked', 'title', 'idle', ''].includes(L.statusOf(p.view())), 'leave: the status is back on the card', L.statusOf(p.view()));
  rig.destroy();
  await rig.run(100);
  ok(rig.clock.pending === 0, 'destroy: no timer, interval or frame is left behind', `${rig.clock.pending} pending`);
}
{
  const rig = await L.makeRig({ n: 6, seed: { [L.MAIN_KEY]: main([3, 3, 3, 3, 3]), [L.TRIAL_KEY]: trialKey({ 6: { deaths: 0, bestRoom: 0, clears: 0, attuned: false, causes: [] } }) }, begin: false });
  const p = await rig.start();
  p.trial.begin();
  await rig.run(120);
  ok(L.statusOf(p.view()) === 'attune', 'attunement first: Begin on an un-attuned stage 6 shows the attunement, not a timed room', L.statusOf(p.view()));
  ok(rig.ev('trial:room').length === 0 && rig.ev('trial:tell').length === 0 && rig.fetches.length === 0, 'attunement first: 120 s on the attunement run no room, no tell, no planted request', `${rig.events.length} events`);
  ok(rig.deaths().length === 0, 'attunement first: no timers, no deaths on the attunement screen', JSON.stringify(rig.deaths()));
  rig.destroy();
}

/* ---- the stars, score and best times of 1-5 are untouched ---------------------------------------------------------------- */
{
  const seedMain = main([3, 2, 3, 2, 3]);
  const seed = { [L.MAIN_KEY]: seedMain, [L.TRIAL_KEY]: trialKey() };
  const stopEarly = [{ id: 'stop', at: 1.0, kind: 'stop' }];
  const r6 = await L.makeRig({ n: 6, seed, scripts: (k) => (k < 2 ? stopEarly : L.PERFECT[6]) });
  await r6.start(); await r6.until(() => r6.clears().length > 0, 400);
  ok(r6.clears().length === 1 && r6.deaths().length === 2, 'stars: stage 6 played with two deaths and a clear', `clears ${r6.clears().length}, deaths ${r6.deaths().length}`);
  const dump6 = r6.storage.dump();
  const r7 = await L.makeRig({ n: 7, seed: dump6, scripts: (k) => (k < 1 ? [{ id: 'start', at: 1.6, kind: 'popupStart' }, { id: 'stopAfter', at: 8.0, kind: 'stop' }] : L.PERFECT[7]) });
  await r7.start(); await r7.until(() => r7.clears().length > 0, 500);
  await r7.run(1.5);
  ok(r7.clears().length === 1 && r7.deaths().length >= 1, 'stars: stage 7 played with a death and a clear', `clears ${r7.clears().length}, deaths ${r7.deaths().length}`);
  for (const [name, r] of [['6', r6], ['7', r7]]) {
    const keys = [...new Set(r.storage.writes.map((w) => w[1]))];
    ok(keys.every((k) => k === L.TRIAL_KEY), `stars: stage ${name} writes only bughunt.trial.v1`, keys.join());
    ok(r.storage.getItem(L.MAIN_KEY) === seedMain, `stars: after stage ${name} bughunt.v1 is byte-identical (stars, best times, score, stickers, prefs)`);
    ok(!r.storage.writes.some((w) => w[1] === L.MAIN_KEY), `stars: stage ${name} never touched bughunt.v1 (no set, no remove)`);
    ok(!r.storage.writes.some((w) => w[0] === 'clear'), `stars: stage ${name} never clears the whole storage`);
  }
  const final = JSON.parse(r7.storage.getItem(L.TRIAL_KEY));
  ok(final[6]?.clears >= 1 && final[7]?.clears >= 1, 'storage: both clears are kept in bughunt.trial.v1', JSON.stringify(final).slice(0, 200));
  ok(!/\b(date|day|days|streak|last)\b/i.test(JSON.stringify(Object.keys(final)) + JSON.stringify(Object.keys(final[6] || {}))), 'storage: no date, day counter or streak field (design 3.7)', JSON.stringify(Object.keys(final[6] || {})));
  r6.destroy(); r7.destroy();
}

/* ---- bad storage never breaks a run -------------------------------------------------------------------------------------- */
{
  for (const [name, raw] of [
    ['corrupt JSON', '{not json'],
    ['a number', '42'],
    ['hostile values', JSON.stringify({ 6: { deaths: 'many', bestRoom: -3, clears: 'x', attuned: 'yes', causes: 7 }, badges: [1, 2], score: 'high' })],
  ]) {
    const rig = await L.makeRig({ n: 6, seed: { [L.MAIN_KEY]: main([3, 3, 3, 3, 3]), [L.TRIAL_KEY]: raw }, begin: false });
    let threw = '';
    try { const p = await rig.start(); p.trial.begin(); await rig.run(1); } catch (e) { threw = e.message; }
    ok(!threw, `bad storage (${name}): opening the stage does not throw`, threw);
    const v = rig.view;
    ok(v && Number.isFinite(v.deaths) && v.deaths >= 0, `bad storage (${name}): the death counter is a clean number`, JSON.stringify(v && v.deaths));
    rig.destroy();
  }
  const rig = await L.makeRig({ n: 6, scripts: (k) => (k === 0 ? L.PERFECT[6] : null) });
  rig.storage.setItem = () => { throw new Error('QuotaExceededError'); };
  let threw = '';
  try { await rig.start(); await rig.until(() => rig.clears().length + rig.deaths().length > 0, 100); } catch (e) { threw = e.message; }
  ok(!threw && rig.clears().length === 1, 'bad storage: a storage that throws on every write (private mode, quota) still lets the stage be played and cleared', threw);
  rig.destroy();
}

finish(SUITE);
