/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * `tsc --noEmit` over `core/**`, `platform/**` and `background/**`, as a ratchet.
 *
 *   node tools/test-types.mjs
 *
 * research/56 decision 26: the codebase is plain JS with no build step and
 * stays that way, but `checkJs` reads the JSDoc that is already there and
 * catches a class of defect the other suites cannot — a call with the wrong
 * arity, a property that never existed, a `Promise` nobody awaited — without
 * asking anyone to write a line of TypeScript. `tsconfig.json` carries the
 * compiler options and the rationale for each one (`strict: false` to start,
 * `types: ["chrome"]`, ES2022 module settings); this file only runs it and
 * decides pass or fail.
 *
 * ── why a ratchet and not a hard pass/fail ─────────────────────────────────
 *
 * Turning `checkJs` on over an un-annotated codebase produces a wall of
 * pre-existing errors on day one — 206 of them, the first time this ran. Most
 * are not bugs: they are the gap between "nobody wrote a type" and "nobody
 * checked one", and fixing all of them before this could ship at all would
 * have meant never shipping it. So the bar is not zero errors, it is *no new
 * ones*: BASELINE_COUNT only ever moves down, and CLEAN_FILES is the set of
 * files that have been swept and must stay swept. A file added to CLEAN_FILES
 * with even one error left in it defeats the point, so this test also asserts
 * the two numbers are honest against each other on every run.
 *
 * ── two ways this goes red ─────────────────────────────────────────────────
 *
 *   1. **The total climbs past BASELINE_COUNT.** Something new introduced a
 *      type error somewhere in `core/**`, `platform/**` or `background/**`. Read the tsc
 *      output above the summary line, fix the annotation (or the bug, if tsc
 *      found a real one), and the count comes back down on its own.
 *   2. **A file in CLEAN_FILES has an error.** One of the swept files
 *      regressed. Same fix, but this one names the exact file, because a swept
 *      file going red is a smaller, more specific mistake than the total
 *      merely rising.
 *
 * Lowering BASELINE_COUNT and adding to CLEAN_FILES is welcome any time a file
 * gets swept — that is the whole ratchet. Raising BASELINE_COUNT is not: if
 * tsc is right and something is a real bug, fix the bug; if tsc is wrong for
 * plain-JS reasons `strict: false` cannot smooth over, narrow the complaint
 * with a JSDoc `@type` cast at the one line, not by making the ceiling bigger.
 *
 * ── a known source of drift ────────────────────────────────────────────────
 *
 * `core/**`, `platform/**` and `background/**` are edited by more than one person. A file this
 * test does not own (anything outside CLEAN_FILES) can gain or lose errors for
 * reasons that have nothing to do with the change under test — see
 * `ARCHITECTURE.md` for who owns what. That is a real ratchet failure and
 * should still be read as one, not waved off; it just may not be *this*
 * change's doing, the same way `npm test` as a whole can show a transient
 * failure in a file someone else is mid-edit on.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ceilingFromBaseline, failureCount } from './lib-assert.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSC = path.join(root, 'node_modules', 'typescript', 'lib', 'tsc.js');

/**
 * The most errors `npx tsc --noEmit -p tsconfig.json` may report. Only ever
 * lowered — see the header for what raising it would defeat.
 *
 * 206 the day `checkJs` was switched on (research/56 decision 26). Brought
 * down to 199 the same day by adding JSDoc to the eight files named in
 * CLEAN_FILES; one of the eight (`core/jira-auth.js`) keeps one error tsc is
 * right about and JSDoc cannot fix — see the note beside CLEAN_FILES.
 */
// 29 Sept 2026 (devil point 20): tsconfig now also includes report/, options/, popup/ and
// sidepanel/, which were never checked. The count over all seven folders was 734 and became the ceiling;
// 30 Sept 2026: ambient DOM/global declarations in types/ambient.d.ts cut 695 to 192; 9 Oct 2026
// (council-1009 13-5): measured 188 and lowered to it; 10 Oct 2026 (council-1009 r3-13-3): measured 184 and lowered to it; 10 Oct 2026 (council-1010 r5 D-1010-115): measured 165 and lowered to it. 10 Oct 2026 (council-1010 r10 F2): measured 155 (157 at the start, product.js typed) and lowered to it. 10 Oct 2026 (remaining-1010 OF-14): measured 152 and lowered to it. Only ever lowered.
// P6 (12 Oct 2026): the live ceiling is `ceilings.types` in tools/gate-baseline.json, read through ceilingFromBaseline();
// LAST_KNOWN_COUNT below is only the highest value the file may hold. A higher number in the JSON prints GATE LOOSENED
// and is red unless QAW_ACCEPT_GATE names a reason. Lowering: measure, then lower BOTH numbers in the same commit.
const LAST_KNOWN_COUNT = 152;
const BASELINE_COUNT = ceilingFromBaseline('types', LAST_KNOWN_COUNT);

/**
 * Files that must report zero tsc errors, every run.
 *
 * Swept as the first pass of decision 26: each already carried the prose
 * JSDoc this codebase writes by habit, so `@ts-check` plus a handful of
 * `@param`/`@type` annotations was enough to clear every error tsc had for
 * it — no runtime line was touched. `core/jira-auth.js` is deliberately absent:
 * it carries a Node-only `Buffer.from(...)` fallback for the branch where
 * `btoa` is unavailable (a path this file's own module comment explains — it
 * runs both in the browser, where `btoa` exists, and in the Node test
 * harness, where it may not), and typing `Buffer` needs either `@types/node`
 * or an ambient `.d.ts`, both outside the comment-only scope of this pass. Its
 * one error is counted in BASELINE_COUNT and not forgotten, just not swept.
 */
const CLEAN_FILES = [
  'core/filing.js',
  'core/sessions.js',
  'core/chart-model.js',
  'core/correlate.js',
  'core/fine-print.js',
  'core/adf.js',
  'platform/settings.js',
];

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('type-checking core, platform, background, report, options, popup and sidepanel with tsc --noEmit');

let stdout = '';
try {
  // tsc exits 0 with no output when the project is clean. A non-zero exit
  // with errors on stdout is the expected shape of a red run, not a crash of
  // this test, so the exception is swallowed and the text is parsed either way.
  stdout = execFileSync(process.execPath, [TSC, '--noEmit', '-p', path.join(root, 'tsconfig.json')], {
    cwd: root,
    encoding: 'utf8',
  });
} catch (err) {
  stdout = String(err.stdout ?? '');
  if (!stdout && err.stderr) {
    // tsc itself failed to run (a bad tsconfig, a missing dependency) rather
    // than reporting type errors — that is a setup problem this test cannot
    // parse its way past, so it fails loudly with tsc's own message.
    console.log(`  FAIL tsc did not run\n       ${String(err.stderr).trim()}`);
    console.log(`\n${passed} passed, ${failures.length + 1} failed`);
    process.exit(1);
  }
}

const errorLines = stdout.split(/\r?\n/).filter((l) => /error TS\d+:/.test(l));
const count = errorLines.length;

const byFile = new Map();
for (const line of errorLines) {
  const m = /^([^(]+)\(/.exec(line);
  if (!m) continue;
  const file = m[1].trim().replace(/\\/g, '/');
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push(line);
}

test(`no more than ${BASELINE_COUNT} tsc errors across core, platform, background, report, options, popup and sidepanel`, () => {
  if (count > BASELINE_COUNT) {
    const sample = errorLines.slice(0, 20).join('\n       ');
    throw new Error(
      `${count} errors, ceiling is ${BASELINE_COUNT}. First ones:\n       ${sample}` +
      (count > 20 ? `\n       … and ${count - 20} more` : ''),
    );
  }
});

for (const file of CLEAN_FILES) {
  test(`${file} has no tsc errors`, () => {
    const errs = byFile.get(file);
    if (errs?.length) {
      throw new Error(`${errs.length} error(s) in a file CLEAN_FILES says is swept:\n       ${errs.join('\n       ')}`);
    }
  });
}

console.log(`  (${count} tsc errors total, ceiling ${BASELINE_COUNT})`);
if (count < BASELINE_COUNT) console.log(`  RATCHET: ${count} < ${BASELINE_COUNT}; lower ceilings.types in gate-baseline.json and LAST_KNOWN_COUNT to ${count}`);
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length || failureCount()) process.exit(1);
