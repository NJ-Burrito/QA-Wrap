/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Code coverage: the arithmetic, against a hand-countable fixture.
 *
 *   node tools/test-coverage.mjs
 *
 * ── why a fixture and not a browser ───────────────────────────────────────
 *
 * "Code coverage is not really working" (brief item E15) is the hardest kind
 * of bug report to act on, because a coverage percentage is plausible whatever
 * it is. Nobody looking at "7%" can tell whether the page really is 7% covered,
 * whether the measurement started too late, or whether the sums are wrong. All
 * three were true, and only the third can be settled by looking at it.
 *
 * So the sums are settled here, on a script small enough to count by hand:
 *
 *   offset  0…199   the script's own top-level body, count 1   (ran)
 *   offset 20…79    function `used`,                  count 3   (ran)
 *   offset 40…59      an `if` block inside `used`,    count 0   (never ran)
 *   offset 90…159   function `unused`,                count 0   (never ran)
 *
 * By hand: 200 bytes in the script. 20 of them are the block inside `used`
 * that never ran, and 70 are `unused`. So 90 bytes never ran and 110 did:
 * **55%**. Two named functions, one of them entered: **50% function coverage**.
 *
 * The code this replaces summed every function's outermost range as the
 * script's size — 200 + 60 + 70 = 330 for a 200-byte file — and then subtracted
 * nested zero-count ranges from a total that had already counted them. There
 * is no reading of the result that means anything.
 *
 * ── what else is here ─────────────────────────────────────────────────────
 *
 * The classification (`isOwnScript`), because a bundle on `static.app.example`
 * was being called third party and excluded from the totals on a page made of
 * nothing else; and the refusals, because a tool that answers with a blank is
 * the thing the tester called "not working" in the first place.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summariseCoverage, scriptBytes, isOwnScript } from '../background/whitebox.js';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

/* ── the fixture ───────────────────────────────────────────────────────── */

/** One 200-byte script, exactly as `Profiler.takePreciseCoverage` reports it. */
const SCRIPT = {
  scriptId: '7',
  url: 'https://app.example/app.js',
  functions: [
    // The module body. V8 always reports it, and its name is empty.
    { functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 200, count: 1 }] },
    {
      functionName: 'used',
      isBlockCoverage: true,
      ranges: [
        { startOffset: 20, endOffset: 80, count: 3 },
        { startOffset: 40, endOffset: 60, count: 0 },
      ],
    },
    {
      functionName: 'unused',
      isBlockCoverage: true,
      ranges: [{ startOffset: 90, endOffset: 160, count: 0 }],
    },
  ],
};

const THIRD_PARTY = {
  scriptId: '9',
  url: 'https://analytics.somebodyelse.example/tag.js',
  functions: [
    { functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 1000, count: 1 }] },
  ],
};

const raw = { result: [SCRIPT, THIRD_PARTY] };

/* ── the sums ──────────────────────────────────────────────────────────── */

console.log('coverage — the bytes, counted the way V8 means them');

test('a script is measured at its own length, not the sum of its functions', () => {
  // 200, not 200 + 60 + 70. This one assertion is the whole defect.
  assert.equal(scriptBytes(SCRIPT).total, 200);
});

test('the bytes that never ran are the ones that never ran', () => {
  // 20 inside `used` plus 70 for `unused`, so 110 of 200 covered.
  assert.equal(scriptBytes(SCRIPT).covered, 110);
});

test('a fully covered script is 100%, not more', () => {
  const all = { url: 'https://app.example/a.js', functions: [
    { functionName: '', ranges: [{ startOffset: 0, endOffset: 50, count: 1 }] },
    { functionName: 'f', ranges: [{ startOffset: 10, endOffset: 40, count: 9 }] },
  ] };
  assert.deepEqual(scriptBytes(all), { total: 50, covered: 50 });
});

test('a script that never ran at all is 0%, not negative', () => {
  const none = { url: 'https://app.example/b.js', functions: [
    { functionName: '', ranges: [{ startOffset: 0, endOffset: 50, count: 0 }] },
    { functionName: 'f', ranges: [{ startOffset: 10, endOffset: 40, count: 0 }] },
  ] };
  assert.deepEqual(scriptBytes(none), { total: 50, covered: 0 });
});

test('a script with no ranges reports nothing rather than dividing by zero', () => {
  assert.deepEqual(scriptBytes({ url: 'x', functions: [] }), { total: 0, covered: 0 });
});

console.log('\ncoverage — the report');

test('statement coverage is the hand-counted 55%', () => {
  const out = summariseCoverage(raw, { origin: 'https://app.example' });
  assert.equal(out.own.statementCoverage, 55);
});

test('the module body is not counted as a function anybody wrote', () => {
  // Two named functions, one entered. Counting V8's anonymous top-level entry
  // would make it two of three and flatter every file by the same amount.
  const out = summariseCoverage(raw, { origin: 'https://app.example' });
  assert.deepEqual(out.own.functions, { total: 2, covered: 1 });
  assert.equal(out.own.functionCoverage, 50);
});

test('the functions nobody entered are named', () => {
  const out = summariseCoverage(raw, { origin: 'https://app.example' });
  const app = out.scripts.find((s) => s.url.endsWith('/app.js'));
  assert.deepEqual(app.untouched, ['unused']);
});

test("somebody else's script is listed and kept out of the totals", () => {
  const out = summariseCoverage(raw, { origin: 'https://app.example' });
  assert.equal(out.thirdParty, 1);
  assert.equal(out.own.scripts, 1);
  assert.equal(out.own.bytes.total, 200, "the analytics tag's 1000 bytes are not in the total");
});

test('the extension’s own scripts are never in the report', () => {
  const out = summariseCoverage(
    { result: [SCRIPT, { url: 'chrome-extension://abc/content/mask.js', functions: [] }] },
    { origin: 'https://app.example' }
  );
  assert.deepEqual(out.scripts.map((s) => s.url), ['https://app.example/app.js']);
});

test('worst first, so the list opens on what is worth reading', () => {
  const out = summariseCoverage(raw, { origin: 'https://app.example' });
  assert.deepEqual(out.scripts.map((s) => s.percent), [55, 100]);
});

/* ── the classification ────────────────────────────────────────────────── */

console.log('\ncoverage — whose script is it');

test('the page’s own origin is its own', () => {
  assert.equal(isOwnScript('https://app.example/main.js', 'https://app.example'), true);
});

test('the application’s own CDN subdomain is its own', () => {
  // The defect behind "all scripts third-party": `url.startsWith(origin)` puts
  // every bundle served from static.* or cdn.* into somebody else's column, and
  // on a page made of nothing else the headline becomes "0 of your scripts".
  assert.equal(isOwnScript('https://static.app.example/bundle.js', 'https://app.example'), true);
  assert.equal(isOwnScript('https://cdn.app.example/x.js', 'https://www.app.example'), true);
});

test('a different site is not', () => {
  assert.equal(isOwnScript('https://analytics.other.example/t.js', 'https://app.example'), false);
});

test('with no origin to compare against, everything counts', () => {
  assert.equal(isOwnScript('https://anything.example/x.js', null), true);
});

/* ── the refusals, said where the tester is standing ───────────────────── */

console.log('\ncoverage — when there is no number, it says why');

test('a page that ran no measurable script says so', () => {
  const out = summariseCoverage({ result: [] }, { origin: 'https://app.example' });
  assert.match(out.nothingToReport, /ran no JavaScript/);
  assert.equal(out.own.statementCoverage, null);
});

test('a page made only of other people’s scripts says so, and counts them', () => {
  const out = summariseCoverage({ result: [THIRD_PARTY] }, { origin: 'https://app.example' });
  assert.match(out.nothingToReport, /came from somewhere else \(1 of them/);
});

test('a page with something to report says nothing of the kind', () => {
  assert.equal(summariseCoverage(raw, { origin: 'https://app.example' }).nothingToReport, null);
});

test('the caveat says which question was answered', () => {
  const reloaded = summariseCoverage(raw, { origin: 'https://app.example', mode: 'from-reload' });
  const asWas = summariseCoverage(raw, { origin: 'https://app.example', mode: 'from-now' });
  assert.match(reloaded.caveats[0], /page was reloaded/);
  assert.match(asWas.caveats[0], /nothing that ran before you pressed Measure is counted/);
  assert.equal(reloaded.mode, 'from-reload');
});

/* ── the attach path ───────────────────────────────────────────────────── */

console.log('\ncoverage — attaching to an ordinary page');

const src = fs.readFileSync(path.join(EXT, 'background', 'whitebox.js'), 'utf8');

test('measuring reloads the page under instrumentation, as DevTools does', () => {
  // Without this, V8 counts from the moment the profiler is switched on and
  // every module body, framework boot and router setup reads as untouched —
  // which is the number that made this feature look broken.
  assert.match(src, /Profiler\.startPreciseCoverage[\s\S]{0,400}Page\.reload/);
  assert.match(src, /export async function startCoverage\(tabId, \{ reload = true \} = \{\}\)/);
});

test('the reload is waited for, with a deadline', () => {
  assert.match(src, /Page\.loadEventFired/);
  assert.match(src, /function afterLoad\(tabId, ms = 15_000\)/);
  assert.match(src, /removeListener\(listener\)/, 'the load listener must always come off');
});

test('a page Chrome will not attach to is refused by name, before attaching', () => {
  assert.match(src, /if \(!\/\^https\?:\|\^file:\/\.test\(tab\.url \|\| ''\)\)/);
  assert.match(src, /cannot attach\|not allowed\|restricted/);
});

test('the debugger always comes off, including when the run throws', () => {
  assert.match(src, /\} finally \{\s*\n\s*await detach\(target\);/);
  assert.match(src, /await detach\(target\);\s*\n\s*throw err;/);
});

/* ── council-1010 round 4: r4-01-1 (D-1010-70) the debugger taken away mid-measurement ── */
async function atest(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL  ${name}\n        ${err.message}`); }
}
const DETACHED = 'Coverage stopped because the debugger was detached. Start it again to measure.';

await atest('r4-01-1: stopCoverage on a detached debugger throws exactly the mapped sentence, and still detaches', async () => {
  const { stopCoverage } = await import('../background/whitebox.js');
  const calls = [];
  globalThis.chrome = {
    runtime: { lastError: undefined },
    debugger: {
      sendCommand(target, method, params, cb) {
        calls.push(method);
        chrome.runtime.lastError = { message: `Debugger is not attached to the tab with id: ${target.tabId}.` };
        cb(); chrome.runtime.lastError = undefined;
      },
      detach(target, cb) { calls.push('detach'); cb(); },
    },
  };
  await assert.rejects(() => stopCoverage(7, {}), (e) => e.message === DETACHED);
  assert.ok(calls.includes('detach'), 'detach must still run');
  chrome.debugger.sendCommand = (t, m, p, cb) => { chrome.runtime.lastError = { message: 'Some other failure' }; cb(); chrome.runtime.lastError = undefined; };
  await assert.rejects(() => stopCoverage(7, {}), (e) => e.message === 'Some other failure');
  delete globalThis.chrome;
});

await atest('r4-01-1: the worker registers onDetach at top level; a detach of the coverage tab clears the state and leaves one gap note, any other tab does nothing', async () => {
  const worker = workerSrc();
  const start = worker.indexOf('const coverageStopping = new Set();');
  const dStart = worker.indexOf('async function onDebuggerDetach');
  const dEnd = worker.indexOf('\n', worker.indexOf('const watchDebuggerDetach = ', dStart));
  assert.ok(start > 0 && dStart > 0 && dEnd > dStart, 'the detach handler moved');
  const detailCode = `${worker.slice(start, worker.indexOf('\n', start))}\n${worker.slice(dStart, dEnd)}`; // the set, then the handler and its registrar
  assert.ok(/^watchDebuggerDetach\(\);$/m.test(worker), 'the listener is not registered at top level');
  const store = { coverageTab: 7, coverageMode: 'from-reload' };
  const notes = [];
  const added = [];
  const kit = new Function('chrome', 'activeSessionId', 'appendEvent', `${detailCode}\nreturn { onDebuggerDetach, watchDebuggerDetach, coverageStopping };`)(
    {
      storage: { session: { get: async (k) => Object.fromEntries([].concat(k).map((x) => [x, store[x]])), remove: async (ks) => { for (const k of ks) delete store[k]; } } },
      debugger: { onDetach: { addListener: (fn) => added.push(fn) } },
    },
    async () => 'S-1',
    async (e) => { notes.push(e); },
  );
  kit.watchDebuggerDetach();
  assert.equal(added.length, 1);
  await kit.onDebuggerDetach({ tabId: 99 });
  assert.deepEqual(store, { coverageTab: 7, coverageMode: 'from-reload' }, 'another tab must not clear it');
  kit.coverageStopping.add(7);
  await kit.onDebuggerDetach({ tabId: 7 });
  assert.equal(store.coverageTab, 7, 'a stop Wrap performs itself is not a loss');
  kit.coverageStopping.delete(7);
  await kit.onDebuggerDetach({ tabId: 7 });
  assert.deepEqual(store, {}, 'coverageTab and coverageMode are cleared');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].tag, 'capture-gap');
  assert.ok(!/\d/.test(notes[0].text), 'a digit in the note would be counted as lost events');
  const bare = new Function('chrome', 'activeSessionId', 'appendEvent', `${detailCode}\nreturn watchDebuggerDetach;`)({}, async () => null, async () => {});
  assert.doesNotThrow(() => bare(), 'without the debugger permission there is no chrome.debugger');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
