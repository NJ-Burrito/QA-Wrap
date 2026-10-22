/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The transition vocabulary, checked on every storyboard on disk.
 *
 * Nader watched the twenty-one lesson films and said two things about them:
 * they are all the same, and the thing they are all the same at is a wipe that
 * travels from the top of the frame to the bottom. Both of those are now
 * failures rather than opinions, and this is where they fail.
 *
 * Three questions, each one a thing that goes wrong quietly:
 *
 *   1. **Is the wipe back?** It arrived the first time as a sensible local fix
 *      — a shot whose capture does not move gets a travelling mask so it is not
 *      a photograph — and it became a mannerism because nothing counted how
 *      often it fired. `clipBottom` is gone from the state object entirely, so
 *      the check is against the SOURCE as well as the data: a state key that
 *      does not exist cannot be set by accident, and a check that reads only
 *      the data would pass a renderer that had quietly grown the key back.
 *   2. **Is one move doing all the work?** The chooser refuses to repeat the
 *      previous cut's transition at all; the gate here is looser on purpose, at
 *      three in a row, so that a future authored `transition` in a storyboard
 *      can break the chooser's rule for a reason without breaking the build.
 *      A film with only one distinct move in it is the fault by another name,
 *      so that is checked too.
 *   3. **Does the render agree with the check of the render?** The chooser DOES
 *      read a measurement — how many frames of each recording differ from the
 *      one before — because a hard cut into a picture that does not move is a
 *      photograph, and no storyboard knows which recordings turned out static.
 *      The danger is therefore that `frames.mjs` and `verify.mjs` measure it
 *      differently, or that one of them does not measure it at all: that fails
 *      silently, and in the flattering direction. So the measurement lives in
 *      `loadFilm()`, which both of them call, and what is checked here is that
 *      the chooser is a pure function of the script and that a shot which does
 *      not move is never cut to.
 *
 * The commercial is judged by a different rule and gets its own block at the
 * end. Bible §8.2 measures its transitions and bans a cross-dissolve in it by
 * name, so it cuts hard everywhere except where its picture does not move —
 * and there it takes the shape wipe §8.2 already budgets, rather than the
 * top-to-bottom wipe that no longer exists. Measured on the delivered file:
 * given the full vocabulary its detected cuts fell from 10 of 10 to 7 of 10,
 * because a dissolve between two shots that share their ground is invisible to
 * a scene detector. That is why the policy exists and why it is tested.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scriptFromStoryboard, assignTransitions, transitionFaults,
  TRANSITION_MS, TRANSITION_KINDS, RECTS, CANVASES,
} from './film/compose/timeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORYBOARDS = path.join(HERE, 'film', 'storyboard');
const TIMELINE = path.join(HERE, 'film', 'compose', 'timeline.mjs');
const COMPOSITION = path.join(HERE, 'film', 'compose', 'composition.html');
const COMMERCIAL = 'qa-wrap';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const boards = fs.readdirSync(STORYBOARDS)
  .filter((f) => f.endsWith('.storyboard.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(STORYBOARDS, f), 'utf8')))
  .sort((a, b) => a.id.localeCompare(b.id));

const opts = { rects: RECTS['16x9'], canvas: CANVASES['16x9'] };
const scriptFor = (sb) => assignTransitions(
  scriptFromStoryboard(JSON.parse(JSON.stringify(sb)), { pass: 'h' }), opts,
);

/* Counted from the folder, not typed: round 3 added four category storyboards
   to the twenty-two of round 2, and a hand-written number turns every future
   film into a failing test that says nothing about the film. What is worth
   asserting is that every storyboard on disk was read and parsed. */
const STORYBOARD_FILES = fs.readdirSync(STORYBOARDS).filter((f) => f.endsWith('.storyboard.json'));
test('every storyboard on disk is read', () => {
  assert.equal(boards.length, STORYBOARD_FILES.length, `found ${boards.length} of ${STORYBOARD_FILES.length}`);
  assert.ok(boards.length >= 25, `only ${boards.length} storyboards; round 3 ships 25 without the commercial (rebuilt 18 Sept)`);
});

test('the vocabulary is exactly four, and none of them is a wipe', () => {
  assert.deepEqual(TRANSITION_KINDS, ['cut', 'dissolve', 'push', 'reveal']);
  assert.equal(TRANSITION_MS.cut, 0, 'a hard cut takes no time');
  for (const k of TRANSITION_KINDS) {
    assert.ok(!/wipe/i.test(k), `"${k}" is a wipe by name`);
  }
});

/* The top-to-bottom wipe was `clipBottom` on a capture. It is not enough for no
 * shot to ask for one: the mechanism itself is gone, and this is what says so.
 * A grep is the right instrument here precisely because the alternative — check
 * the rendered state — passes on a renderer that still knows how. */
test('the top-to-bottom wipe is gone from the composition, not merely unused', () => {
  const timeline = fs.readFileSync(TIMELINE, 'utf8');
  const composition = fs.readFileSync(COMPOSITION, 'utf8');
  const live = (src) => src.split('\n')
    .filter((l) => l.includes('clipBottom'))
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l.trim()));
  assert.deepEqual(live(timeline), [], 'timeline.mjs still sets clipBottom');
  assert.deepEqual(live(composition), [], 'composition.html still reads clipBottom');
});

for (const sb of boards) {
  const lesson = sb.id !== COMMERCIAL;
  const script = scriptFor(sb);
  const kinds = script.shots.slice(1).map((s) => s.transition.kind);

  test(`${sb.id}: no shot asks for the top-to-bottom wipe`, () => {
    const asked = script.shots.filter((s) => s.reveal === 'wipe').map((s) => s.n);
    assert.deepEqual(asked, [], `shots ${asked.join(', ')} declare reveal "wipe"`);
  });

  if (!lesson) continue;

  test(`${sb.id}: every cut carries a transition from the vocabulary`, () => {
    assert.equal(kinds.length, script.shots.length - 1);
    for (const k of kinds) assert.ok(TRANSITION_MS[k] !== undefined, `"${k}" is not in the vocabulary`);
  });

  /* The gate the ruling asks for, stated as the ruling states it. */
  test(`${sb.id}: no non-cut transition three times in a row`, () => {
    assert.deepEqual(transitionFaults(script), []);
  });

  /* And the stricter rule the chooser itself follows, so a regression in the
   * chooser is caught here rather than two cuts later. */
  test(`${sb.id}: no two consecutive cuts share a non-cut transition`, () => {
    for (let i = 1; i < kinds.length; i++) {
      if (kinds[i] === 'cut') continue;
      assert.notEqual(kinds[i], kinds[i - 1],
        `shots ${script.shots[i].n} and ${script.shots[i + 1].n} both "${kinds[i]}"`);
    }
  });

  test(`${sb.id}: the film uses more than one move`, () => {
    const distinct = new Set(kinds);
    assert.ok(distinct.size >= 2, `only ${[...distinct].join(', ')}`);
  });

  test(`${sb.id}: a push names the edge it comes from`, () => {
    for (const s of script.shots.slice(1)) {
      if (s.transition.kind !== 'push') continue;
      assert.ok(['left', 'right', 'top', 'bottom'].includes(s.transition.from),
        `shot ${s.n} pushes from "${s.transition.from}"`);
    }
  });

  test(`${sb.id}: the cut into a card is hard`, () => {
    for (const s of script.shots.slice(1)) {
      if (s.rect) continue;
      assert.equal(s.transition.kind, 'cut', `shot ${s.n} is a card and does not cut`);
    }
  });

  /* A shot with no motion of its own and a hard cut into it is a photograph,
   * which is what `verify.mjs` fails as a frozen shot. The chooser must never
   * produce that pair. */
  test(`${sb.id}: a declared still is never cut to`, () => {
    for (const s of script.shots.slice(1)) {
      if (!s.still) continue;
      assert.notEqual(s.transition.kind, 'cut', `shot ${s.n} is a held still and is cut to`);
    }
  });

  /* A reveal is the only motion a held picture has, so it has to outlast the
   * frozen-shot gate: six changed frames at 30 fps is 0.200 s. */
  test(`${sb.id}: a static shot's reveal outlasts the frozen-shot gate`, () => {
    const fps = sb.fps || 30;
    for (const s of script.shots.slice(1)) {
      if (s.transition.kind === 'cut') continue;
      assert.ok(s.transition.ms / 1000 * fps > 6,
        `shot ${s.n}: ${s.transition.kind} runs ${s.transition.ms} ms, under seven frames`);
    }
  });

  test(`${sb.id}: the choice is a pure function of the script`, () => {
    const again = scriptFor(sb).shots.slice(1).map((s) => s.transition.kind);
    assert.deepEqual(again, kinds, 'two runs of the chooser disagree');
  });

  /* The measurement the chooser depends on, exercised against the two states it
   * can be in. A recording that does not move must never be cut to, and a
   * chooser that ignored `capturesMoved` would pass every other check here. */
  test(`${sb.id}: a recording that does not move is never cut to`, () => {
    const measured = scriptFromStoryboard(JSON.parse(JSON.stringify(sb)), { pass: 'h' });
    for (const s of measured.shots) if (s.rect) s.capturesMoved = 0;
    const out = assignTransitions(measured, opts).shots.slice(1);
    for (const s of out) {
      if (!s.rect) continue;
      assert.notEqual(s.transition.kind, 'cut', `shot ${s.n} is static and is cut to`);
    }
    assert.deepEqual(transitionFaults(measured), []);
  });
}

/* ── the commercial's own policy ──────────────────────────────────────────── */

const commercial = boards.find((b) => b.id === COMMERCIAL);
/* The commercial was rebuilt from scratch (18 Sept) and has no storyboard until it is recorded again;
 * its block runs when the storyboard comes back, and the rest of the suite runs meanwhile. */
const hardCutScript = commercial && assignTransitions(
  scriptFromStoryboard(JSON.parse(JSON.stringify(commercial)), { pass: 'h' }),
  { ...opts, hardCuts: true },
);
/* Its four measured-static shots are not in the storyboard as stills, so the
 * measurement has to be supplied here the way `loadFilm()` supplies it. */
const hardCutMeasured = commercial && (() => {
  const sc = scriptFromStoryboard(JSON.parse(JSON.stringify(commercial)), { pass: 'h' });
  for (const sh of sc.shots) if (sh.rect) sh.capturesMoved = sh.n % 3 === 0 ? 0 : 40;
  return assignTransitions(sc, { ...opts, hardCuts: true });
})();

if (commercial) test(`${COMMERCIAL}: cuts hard, and never cross-dissolves (bible 8.2)`, () => {
  for (const sc of [hardCutScript, hardCutMeasured]) {
    const kinds = sc.shots.slice(1).map((x) => x.transition.kind);
    assert.ok(!kinds.includes('dissolve'), `dissolve in ${kinds.join(' ')}`);
    assert.ok(kinds.filter((k) => k === 'cut').length >= kinds.length / 2,
      `only ${kinds.filter((k) => k === 'cut').length} of ${kinds.length} cuts are hard`);
    assert.deepEqual(transitionFaults(sc), []);
  }
});

if (commercial) test(`${COMMERCIAL}: a static shot still gets its motion under the hard-cut policy`, () => {
  for (const sh of hardCutMeasured.shots.slice(1)) {
    if (!sh.rect || sh.capturesMoved >= 6) continue;
    assert.notEqual(sh.transition.kind, 'cut', `shot ${sh.n} is static and is cut to`);
  }
});

/* A storyboard may state a transition itself, and when it does nothing
 * overrules it. That is the escape hatch for a cut the chooser reads wrong, and
 * an escape hatch nobody tests is an escape hatch that has rusted shut. */
test('an authored transition survives the chooser', () => {
  const sb = JSON.parse(JSON.stringify(boards.find((b) => b.id !== COMMERCIAL)));
  sb.shots[1].transition = { kind: 'reveal', ms: 240, why: 'the director asked' };
  const script = assignTransitions(scriptFromStoryboard(sb, { pass: 'h' }), opts);
  assert.equal(script.shots[1].transition.kind, 'reveal');
  assert.equal(script.shots[1].transition.why, 'the director asked');
});

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
