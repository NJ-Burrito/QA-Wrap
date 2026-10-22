/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @suite lane=node feature=game reason=drives game/trial.js through a dynamic import inside lib-game-trial.mjs, so it is a node suite and not a pure gate
/**
 * Bug Hunt hard trials, attunement (DESIGN-bug-hunt-hard.md section 4; lane T3). Node only, virtual clock.
 *
 *   node tools/test-game-trial-attune.mjs        (from extension/, PYTHONUTF8=1)
 *
 * The card's "bonfire": six ticks that light from REAL signals (qawState, qawBuffer, qawShortcut, qawExpected, qawShots, qawNotes),
 * each naming the exact QA Wrap control. This suite plays the signals the extension would write and checks that
 *   - a tick lights from its signal and from nothing else (a plain start is not "Save last 2 minutes", a note alone is not a shot);
 *   - there are no timers and no deaths on the attunement screen, however long it stays open;
 *   - an auto-screenshot that rises on its own is reported, not ticked;
 *   - the sixth tick stores `attuned`, and the attunement can be run again;
 *   - the strings name the controls (EN and AR, verbatim from features.json) and carry no timing advice.
 * Skips with exit 2 while game/trial.js has not landed.
 */
import { ok, nonEmpty, proveTeeth, finish } from './lib-assert.mjs';
import * as L from './lib-game-trial.mjs';

const SUITE = 'test-game-trial-attune';
L.needTrial(SUITE);

const feat = L.readJson(L.GAME, 'features.json').features;
const ticksOf = (rig) => new Set(rig.ev('trial:attune').filter((e) => e.ok === true || e.ok === undefined && !e.warn).map((e) => e.step));
const seen = (rig) => JSON.stringify(rig.events.filter((e) => e.type === 'trial:attune')) + JSON.stringify(rig.view || {});

async function fresh(extra = {}) {
  const rig = await L.makeRig({ n: 6, attuned: false, begin: false, qawInit: 'asleep', ...extra });
  const p = await rig.start();
  p.trial.attune();
  await rig.run(0.2);
  return rig;
}

/* ---- the six ticks, each from its own signal --------------------------------------------------------------------------- */
{
  const rig = await fresh();
  const t = () => ticksOf(rig);
  ok(L.statusOf(rig.view) === 'attune', 'attune(): the status is the attunement', L.statusOf(rig.view));

  await rig.run(600);
  ok(t().size === 0 && rig.deaths().length === 0 && rig.ev('trial:room').length === 0 && rig.fetches.length === 0, 'no timers, no deaths: 10 minutes asleep on the attunement lights nothing, kills nothing, plants nothing', `ticks ${[...t()]}`);

  // 1. awake and not recording
  rig.set({ state: 'recording' }); await rig.run(1);
  ok(!t().has(1), '1: a recording window is not "awake and idle": no tick', [...t()].join());
  rig.set({ state: 'ready' }); await rig.run(0.3);
  ok(t().has(1), '1: qawState ready lights tick 1', [...t()].join());

  // 2. Save last 2 minutes: qawBuffer rises and the state becomes recording. A plain start is not enough.
  rig.set({ state: 'recording' }); await rig.run(1);
  ok(!t().has(2), '2: a plain Start (state recording, qawBuffer unchanged) does NOT light tick 2', [...t()].join());
  rig.set({ state: 'ready' }); await rig.run(0.2);
  rig.set({ buffer: rig.sim.buffer + 1, state: 'recording' }); await rig.run(0.3);
  ok(t().has(2), '2: qawBuffer rising with the session recording lights tick 2', [...t()].join());

  // 3. Stop, then the shortcut: stopped alone is not the shortcut
  rig.set({ state: 'stopped' }); await rig.run(1);
  ok(!t().has(3), '3: Stop alone (no qawShortcut rise) does NOT light tick 3', [...t()].join());
  rig.set({ state: 'recording', shortcut: 0, notes: 0, shots: 0 }); rig.set({ shortcut: 1 }); await rig.run(0.3);
  ok(t().has(3), '3: qawShortcut rising lights tick 3', [...t()].join());

  // 4. Not a bug on the toast: qawExpected rises; shots may not rise on their own meanwhile
  await rig.run(1);
  ok(!t().has(4), '4: nothing pressed, no tick 4', [...t()].join());
  rig.set({ expected: rig.sim.expected + 1 }); await rig.run(0.3);
  ok(t().has(4), '4: qawExpected rising lights tick 4', [...t()].join());

  // 5. screenshot and note both reach the page
  rig.set({ notes: rig.sim.notes + 1 }); await rig.run(1);
  ok(!t().has(5), '5: a note alone does NOT light tick 5 (the screenshot count must rise too)', [...t()].join());
  rig.set({ shots: rig.sim.shots + 1 }); await rig.run(0.3);
  ok(t().has(5), '5: qawShots and qawNotes both risen lights tick 5', [...t()].join());

  // 6. Stop
  ok(!t().has(6), '6: still recording, no tick 6', [...t()].join());
  rig.set({ state: 'stopped' }); await rig.run(0.5);
  ok(t().has(6), '6: the state becoming stopped lights tick 6', [...t()].join());
  ok(rig.view.attuned === true, 'view().attuned is true after the sixth tick', JSON.stringify(rig.view.attuned));
  const stored = JSON.parse(rig.storage.getItem(L.TRIAL_KEY) || '{}');
  ok(stored[6] && stored[6].attuned === true, 'bughunt.trial.v1 holds attuned: true for stage 6', JSON.stringify(stored[6]));
  ok(rig.deaths().length === 0, 'no death at any point of the attunement', JSON.stringify(rig.deaths()));
  ok(rig.fetches.length === 0, 'the attunement plants no failing request of its own (the page\'s own "Fire" buttons are T2\'s)', JSON.stringify(rig.fetches));

  // once, re-runnable
  const before = rig.ev('trial:attune').length;
  rig.page.trial.attune();
  rig.set({ state: 'ready' }); await rig.run(0.5);
  ok(rig.ev('trial:attune').length > before && L.statusOf(rig.view) === 'attune', 're-run: the attunement can be opened again from the card and ticks again', `events ${before} -> ${rig.ev('trial:attune').length}`);
  rig.destroy();
}

/* ---- the attunement gates the first attempt ----------------------------------------------------------------------------- */
{
  const rig = await L.makeRig({ n: 6, attuned: false, begin: false });
  const p = await rig.start();
  p.trial.begin();
  await rig.run(60);
  ok(L.statusOf(p.view()) === 'attune' && rig.ev('trial:room').length === 0, 'first attempt: Begin before attuning goes to the attunement (stored attuned false), never to a timed room', L.statusOf(p.view()));
  rig.destroy();
  const done = await L.makeRig({ n: 6, attuned: true, begin: false });
  const q = await done.start();
  q.trial.begin(); await done.run(2);
  ok(L.statusOf(q.view()) === 'run' && done.ev('trial:room').length >= 1, 'first attempt: with attuned true Begin goes straight to room 1', L.statusOf(q.view()));
  done.destroy();
}

/* ---- the auto-screenshot trap -------------------------------------------------------------------------------------------- */
{
  const rig = await fresh({ qawInit: 'ready' });
  rig.set({ buffer: rig.sim.buffer + 1, state: 'recording' }); await rig.run(0.2);
  rig.set({ state: 'stopped' }); await rig.run(0.2);
  rig.set({ state: 'recording', shortcut: 0, notes: 0, shots: 0 }); rig.set({ shortcut: 1 }); await rig.run(0.2);
  // step 4 is on screen; a screenshot rises on its own (auto-screenshot is on for this site)
  rig.set({ shots: rig.sim.shots + 1 }); await rig.run(0.5);
  const warned = /autoshot|auto-shot|autoShot|auto_screenshot|auto-screenshot/i.test(seen(rig)) || rig.ev('trial:attune').some((e) => e.step === 4 && e.ok === false);
  ok(warned, 'auto-screenshot: a screenshot that rises while only step 4 is under way is reported (event ok:false for step 4, or an autoshot marker), because it would cause false deaths', seen(rig).slice(0, 300));
  rig.destroy();
}

/* ---- strings: the exact control, never the timing ------------------------------------------------------------------------ */
{
  const S = { en: L.loadStrings('en'), ar: L.loadStrings('ar') };
  if (!S.en['trial.attune.s1']) {
    console.log('SKIPPED: NOT IMPLEMENTED rule game-trial (SKIPPED-NOT-ENFORCED) - attunement strings (trial.attune.* are T2\'s and have not landed)');
    finish(SUITE, { skipped: 1 });
  }
  const need = { 2: ['buffer'], 3: ['stop'], 4: ['notbug'], 5: ['shot', 'note'], 6: ['stop'] };
  for (const lang of ['en', 'ar']) {
    for (const [step, keys] of Object.entries(need)) {
      const str = S[lang][`trial.attune.s${step}`] || '';
      for (const k of keys) ok(str.includes(feat[k][lang]), `${lang.toUpperCase()}: step ${step} names "${feat[k][lang]}" exactly as QA Wrap does (features.json)`, str);
    }
    const advice = Object.keys(S[lang]).filter((k) => /^trial\.attune\.(s\d|fire\.|title|open)/.test(k)).filter((k) => /\b\d+\s?(s|sec|seconds?)\b|\b(quick|quickly|fast|hurry|within|before it|too late|in time)\b|ثانية|ثوان|بسرعة|قبل أن|خلال/i.test(S[lang][k]));
    ok(advice.length === 0, `${lang.toUpperCase()}: the attunement strings say which control, never when or how fast (no seconds, no "quickly")`, advice.map((k) => `${k}="${S[lang][k]}"`).join(' | '));
  }
  nonEmpty(Object.keys(S.en).filter((k) => /^trial\.attune\./.test(k)), 'trial.attune.* strings');
  ok(['autoshot', 'nokey'].every((k) => S.en[`trial.attune.${k}`] && S.ar[`trial.attune.${k}`]), 'the auto-screenshot warning and the "start without the shortcut" offer exist in EN and AR');
  proveTeeth('the timing-advice scan', (s) => (/\b(quickly|within|\d+\s?s)\b/.test(s) ? ['advice'] : []), 'Press Stop within 3 s');
}

finish(SUITE);
