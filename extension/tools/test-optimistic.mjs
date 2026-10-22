/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The optimistic paint, tested where it can be tested honestly.
 *
 * Every action in the popup used to wait for the service worker before it drew
 * anything, and on a slow machine — or against a worker Chrome has just killed
 * — that reads as a button that does nothing. `optimistic()` inverts it: paint
 * the expected state now, reconcile with the truth when it arrives.
 *
 * That trade only pays if the reconciliation is airtight, and the failures it
 * can have are all silent ones. A `settle` that does not overwrite the guess
 * leaves the popup confidently wrong. A `revert` that does not fire leaves a
 * session card over a session that was never started. A `.is-pending` mark left
 * behind leaves a control dimmed forever, with nothing on screen to say why.
 * None of those throw; you find them by using the extension, weeks later.
 *
 * So the helper is exercised as a pure function, with no browser at all. It is
 * lifted out of `popup/popup.js` by source — the same trick `test-sound.mjs`
 * uses on `ui/sound.js` — because the popup is a classic script that cannot be
 * imported, and a copy of the helper kept here to test would be a copy that
 * drifts from the one that ships.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { surfaceSource } from './lib-src.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const js = surfaceSource('popup/popup.js');

/* ── lifting the helper out of the popup ───────────────────────────────── */

/**
 * The helper's source, from the one constant it starts at to the next function
 * after it.
 *
 * Both edges are asserted rather than assumed: a rename that quietly widened
 * this slice would test something other than the shipped helper, which is the
 * one way a test like this can pass while meaning nothing.
 */
const FROM = "const PENDING = 'is-pending';";
const TO = 'function bumpUsed(';
const from = js.indexOf(FROM);
const to = js.indexOf(TO);
assert.ok(from !== -1, `popup.js no longer declares ${FROM} — the helper has moved or been renamed`);
assert.ok(to > from, 'popup.js no longer defines bumpUsed() after optimistic() — the slice below would be wrong');
const source = js.slice(from, to);
assert.match(source, /async function optimistic\(apply, dispatch, \{ revert, settle \} = \{\}\)/,
  'optimistic() no longer has the contract this file tests');

/**
 * `say()` is the popup's one user-visible voice, and the helper is the one
 * place a failed press is reported. Injected as a parameter so the assertions
 * below can read what a tester would have been told.
 */
let said = [];
const { optimistic, PENDING } = new Function(
  'say',
  `${source}\nreturn { optimistic, PENDING };`
)((text, tone) => { said.push({ text, tone }); });

/** A node with only the part of the DOM the helper touches. */
function node() {
  const classes = new Set();
  return {
    classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
    },
  };
}

/** A promise somebody else decides the fate of. */
function deferred() {
  let settle;
  const promise = new Promise((r) => { settle = r; });
  return { promise, settle };
}

const beforeEach = () => { said = []; };

/**
 * Two tests below deliberately make a callback throw, and the helper is
 * supposed to log it. Swallowing that log keeps the run readable — a stack
 * trace in a passing suite is how a real one stops being noticed.
 */
async function quiet(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try { await fn(); } finally { console.warn = warn; }
}

console.log('optimistic() — the paint goes first and the truth still wins');

/* ── 1. the whole point: paint before the round trip ───────────────────── */

await test('apply runs before the message is answered', async () => {
  beforeEach();
  const order = [];
  const reply = deferred();

  const running = optimistic(
    () => { order.push('apply'); },
    () => { order.push('dispatch'); return reply.promise; },
    { settle: () => { order.push('settle'); } }
  );

  // One turn of the microtask queue is enough for anything synchronous in the
  // helper to have happened. The reply has deliberately not arrived.
  await Promise.resolve();
  assert.deepEqual(order, ['apply', 'dispatch'], 'the paint waited for the worker, which is the bug this replaces');

  reply.settle({ ok: true, result: {} });
  await running;
  assert.deepEqual(order, ['apply', 'dispatch', 'settle']);
});

await test('the press is painted synchronously, not a microtask later', async () => {
  beforeEach();
  let painted = false;
  // Not awaited: this is the call as a click handler makes it, and by the time
  // the call returns the screen must already be right.
  const running = optimistic(() => { painted = true; }, () => Promise.resolve({ ok: true }), {});
  assert.equal(painted, true, 'apply() ran in a later turn — the click and the paint are in different frames');
  await running;
});

/* ── 2. the truth wins ─────────────────────────────────────────────────── */

await test('settle overwrites what apply guessed', async () => {
  beforeEach();
  const screen = { title: 'Asleep' };
  const res = await optimistic(
    () => { screen.title = 'Awake'; },
    () => Promise.resolve({ ok: true, result: { armed: false, windows: [] } }),
    // The worker disagreed with the guess — another surface had already put
    // this window to sleep — and the worker is right.
    { settle: (r) => { screen.title = r.result.armed ? 'Awake' : 'Asleep'; } }
  );
  assert.equal(screen.title, 'Asleep', 'the optimistic guess survived a reply that contradicted it');
  assert.deepEqual(res, { ok: true, result: { armed: false, windows: [] } }, 'the reply is handed back to the caller');
});

await test('a success says nothing extra — the paint already spoke', async () => {
  beforeEach();
  await optimistic(() => {}, () => Promise.resolve({ ok: true }), { settle: () => {} });
  assert.deepEqual(said, [], 'the helper spoke over a message the optimistic paint had already put on screen');
});

/* ── 3. a refusal puts it back, and says why ───────────────────────────── */

await test('revert restores the previous state and reports the error', async () => {
  beforeEach();
  const screen = { title: 'Asleep' };
  await optimistic(
    () => { screen.title = 'Awake'; },
    () => Promise.resolve({ ok: false, error: 'No window to wake up.' }),
    { revert: () => { screen.title = 'Asleep'; } }
  );
  assert.equal(screen.title, 'Asleep');
  assert.deepEqual(said, [{ text: 'No window to wake up.', tone: 'err' }],
    'the refusal was not reported, or not in the tone the rest of the popup uses');
});

await test('the undo apply returns is the default revert', async () => {
  beforeEach();
  const screen = { title: 'Asleep' };
  await optimistic(
    () => { screen.title = 'Awake'; return () => { screen.title = 'Asleep'; }; },
    () => Promise.resolve({ ok: false, error: 'Nope.' }),
    {}
  );
  assert.equal(screen.title, 'Asleep', 'a call site with no explicit revert was left showing the guess');
});

await test('an explicit revert wins over the undo apply returned', async () => {
  beforeEach();
  const order = [];
  await optimistic(
    () => { order.push('apply'); return () => order.push('undo'); },
    () => Promise.resolve({ ok: false, error: 'Nope.' }),
    { revert: () => order.push('revert') }
  );
  assert.deepEqual(order, ['apply', 'revert'], 'both undos ran, so the state was restored twice');
});

await test('settle does not run on a refusal', async () => {
  beforeEach();
  let settled = false;
  await optimistic(() => {}, () => Promise.resolve({ ok: false, error: 'Nope.' }), {
    settle: () => { settled = true; },
    revert: () => {},
  });
  assert.equal(settled, false);
});

/* ── 4. the case the helper exists for: a worker that never answers ────── */

await test('a timed-out reply reverts', async () => {
  beforeEach();
  const screen = { card: 'live' };
  // Exactly what HANDLER_TIMEOUT_MS produces in background/service-worker.js.
  const timeout = {
    ok: false,
    error: 'UQA_START did not finish within 10s. Reload the extension at chrome://extensions and try again.',
    timedOut: true,
  };
  await optimistic(
    () => { screen.card = 'live'; return () => { screen.card = 'idle'; }; },
    () => Promise.resolve(timeout),
    {}
  );
  assert.equal(screen.card, 'idle', 'a worker that timed out left the popup showing a session that was never started');
  assert.equal(said[0]?.tone, 'err');
  assert.match(said[0]?.text, /did not finish within 10s/, 'the tester was not told what the worker did');
});

await test('a reply that claims ok while reporting a timeout still reverts', async () => {
  beforeEach();
  let reverted = false;
  await optimistic(() => {}, () => Promise.resolve({ ok: true, timedOut: true }), {
    settle: () => {},
    revert: () => { reverted = true; },
  });
  assert.equal(reverted, true, 'timedOut was read from ok alone, so a worker that reports it differently would settle a lie');
});

await test('no reply at all is a refusal, in words a tester can act on', async () => {
  beforeEach();
  await optimistic(() => {}, () => Promise.resolve(undefined), { settle: () => {} });
  assert.equal(said[0]?.tone, 'err');
  assert.match(said[0]?.text, /worker is not responding/i);
});

await test('a dispatch that throws reverts rather than escaping', async () => {
  beforeEach();
  let reverted = false;
  const res = await optimistic(
    () => {},
    () => Promise.reject(new Error('the message port closed')),
    { revert: () => { reverted = true; } }
  );
  assert.equal(reverted, true);
  assert.equal(res.ok, false);
  assert.match(said[0]?.text, /message port closed/);
});

/* ── 5. nothing is ever left pending ───────────────────────────────────── */

await test('.is-pending is added while the press is in flight', async () => {
  beforeEach();
  const row = node();
  const reply = deferred();
  const running = optimistic((pending) => { pending(row); }, () => reply.promise, { settle: () => {} });
  await Promise.resolve();
  assert.equal(row.classes.has('is-pending'), true, 'nothing marked the provisional paint as provisional');
  reply.settle({ ok: true });
  await running;
});

await test('.is-pending is cleared on a settle', async () => {
  beforeEach();
  const row = node();
  await optimistic((pending) => { pending(row); }, () => Promise.resolve({ ok: true }), { settle: () => {} });
  assert.equal(row.classes.has('is-pending'), false, 'a confirmed thing is still dimmed');
});

await test('.is-pending is cleared on a revert', async () => {
  beforeEach();
  const row = node();
  await optimistic((pending) => { pending(row); }, () => Promise.resolve({ ok: false, error: 'Nope.' }), {
    revert: () => {},
  });
  assert.equal(row.classes.has('is-pending'), false, 'a refused press left the control dimmed for ever');
});

await test('.is-pending is cleared even when settle throws', async () => {
  beforeEach();
  const row = node();
  await quiet(() =>
    optimistic((pending) => { pending(row); }, () => Promise.resolve({ ok: true }), {
      settle: () => { throw new Error('a paint blew up'); },
    })
  );
  assert.equal(row.classes.has('is-pending'), false, 'a throw in settle stranded the pending mark');
});

await test('pending() hands the node back, and shrugs at a missing one', async () => {
  beforeEach();
  const row = node();
  let handed;
  let missing = 'unset';
  await optimistic(
    (pending) => { handed = pending(row); missing = pending(null); },
    () => Promise.resolve({ ok: true }),
    { settle: () => {} }
  );
  assert.equal(handed, row, 'pending() must return its argument, so a call site can mark and keep in one line');
  assert.equal(missing, null, 'a tool row that is not drawn threw instead of being ignored');
});

await test('a revert that throws does not swallow the message to the tester', async () => {
  beforeEach();
  const row = node();
  await quiet(() =>
    optimistic((pending) => { pending(row); }, () => Promise.resolve({ ok: false, error: 'Nope.' }), {
      revert: () => { throw new Error('the undo blew up'); },
    })
  );
  assert.equal(row.classes.has('is-pending'), false);
  assert.deepEqual(said, [{ text: 'Nope.', tone: 'err' }]);
});

/* ── 6. the contract with the popup and with the stylesheet ────────────── */

console.log('\npopup.js — the helper is used the way it is meant to be');

/** The code without its prose, so a paragraph quoting a rule cannot trip it. */
const code = js
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

await test('the pending class is spelled once, in the constant the CSS is written against', () => {
  assert.equal(PENDING, 'is-pending', 'the class name the design engineer was given has changed');
  const literals = [...code.matchAll(/'is-pending'/g)];
  assert.equal(literals.length, 1,
    `"is-pending" is written ${literals.length} times in popup.js — it must only be the PENDING constant`);
});

await test('every optimistic() press reconciles with the worker', () => {
  // A call with neither a settle nor a revert is the shape that leaves the
  // popup showing a guess for ever, so it is the one shape banned outright.
  // `await optimistic(` is every call site and never the definition itself.
  const calls = [...code.matchAll(/await optimistic\(/g)];
  assert.ok(calls.length >= 8, `only ${calls.length} optimistic() call sites — actions have gone back to round-tripping`);
  for (const call of calls) {
    const tail = code.slice(call.index, call.index + 3000);
    assert.ok(/settle:|revert:/.test(tail),
      'an optimistic() call site names neither settle nor revert, so its paint is never reconciled');
  }
});

await test('the actions Nader named all paint before they send', () => {
  // Each of these used to wait for the worker. Named individually because
  // "there are eight call sites" would still pass with the wrong eight.
  for (const [what, marker] of [
    ['the wake/sleep switch', /wanted \? 'UQA_ARM' : 'UQA_DISARM'/],
    ['Start', /type: 'UQA_START'/],
    ['Stop', /send\(\{ type: 'UQA_STOP' \}\)/],
    ['Add note', /send\(\{ type: 'UQA_NOTE', text, tag: tag \|\| null \}\)/],
    ['Screenshot, note', /return send\(\{ type: 'UQA_CAPTURE', text \}\)/],
    ['the screenshot tool', /type: full \? 'UQA_CAPTURE_FULL' : 'UQA_CAPTURE', text/],
    ['the accessibility scan', /send\(\{ type: 'UQA_SCAN_A11Y' \}\)/],
    ['the performance scan', /send\(\{ type: 'UQA_SCAN_PERF' \}\)/],
  ]) {
    assert.match(code, marker, `${what} is no longer wired through optimistic()`);
  }
});

await test('the used-mark moves before the tool press resolves its context', () => {
  // `resolveCtx()` is itself a round trip. A tick bumped inside a branch waits
  // for it, so against a worker Chrome has just killed the card would say the
  // tool had not been used for as long as the worker took to start — which is
  // the exact complaint, one level down.
  assert.match(code, /const OPTIMISTIC_COUNT = \{ shot: 'shot', a11y: 'a11y', perf: 'perf' \}/,
    'the three optimistically-counted tools are no longer named in one place');
  // Scoped to the delegated tool listener: `const tab = await resolveCtx()`
  // also appears in the Start handler above, which is a different press.
  const listener = code.slice(code.indexOf("const btn = event.target.closest?.('[data-action]')"));
  const bump = listener.indexOf('bumpUsed(counts)');
  const resolve = listener.indexOf('const tab = await resolveCtx()');
  assert.ok(bump !== -1, 'the tool listener no longer moves the used-mark at all');
  assert.ok(resolve !== -1, 'the tool listener no longer resolves its context');
  assert.ok(bump < resolve, 'the used-mark waits for resolveCtx(), which is a round trip of its own');
});

await test('every optimistically-counted handler settles its tick', () => {
  // The tick is put back by the listener`s finally unless the handler says the
  // worker counted it. The sixteen branches are a lookup now, so the handlers
  // no longer share the listener's scope: they clear `undoUse` through the
  // `counted()` they are handed. Three handlers guess, so three must call it —
  // a fourth guess added without one would silently lose its tick on success.
  const cleared = [...code.matchAll(/counted\(\);/g)].length;
  assert.equal(cleared, Object.keys({ shot: 1, a11y: 1, perf: 1 }).length,
    `${cleared} handlers call counted(), expected one per optimistically-counted tool`);
  assert.match(code, /counted: \(\) => \{ undoUse = null; \}/,
    'the listener no longer hands its handlers a way to settle the tick');
  assert.match(code, /undoUse\?\.\(\);/, 'nothing puts the tick back when the press does not land');
});

await test('the used-mark is settled on the reply, never on the tone', () => {
  // A performance scan that finds a poor rating says so in the `err` tone, and
  // the tool still ran. Reverting the tick on tone would take the tick away
  // from every scan that found something — the scans that matter most.
  assert.doesNotMatch(code, /lastTone[^\n]*bumpUsed/, 'the used-mark is being reverted from the status tone');
  assert.doesNotMatch(code, /bumpUsed[^\n]*lastTone/, 'the used-mark is being reverted from the status tone');
});

await test('the final messages the suites read are unchanged', () => {
  for (const line of [
    'Recording. Use the page as a tester would.',
    'Session saved.',
    'Awake in this window. Every tab here is covered. Other windows stay asleep.',
    'Back to sleep. Nothing is being watched.',
    'Screenshot added to the session.',
    'Saved into the session.',
  ]) {
    assert.ok(js.includes(line), `"${line}" is gone — a suite reads #status for it after the settle`);
  }
});

await test('sleep keeps its plain sentence and gains the stopped-and-saved ones (r1-09-3)', () => {
  for (const line of [
    'Back to sleep. Nothing is being watched.',
    'Back to sleep. The running session was stopped and saved.',
    'Back to sleep. The running recording was stopped and saved.',
  ]) assert.ok(js.includes(line), `"${line}" is gone from the sleep settle path`);
  const at = js.indexOf('const slept = res.result?.stopped');
  assert.ok(at > 0, 'the sleep settle no longer reads what the worker stopped');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
