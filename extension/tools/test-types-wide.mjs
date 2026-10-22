/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Per-directory type ratchet over the code tsconfig.json does not cover (T-065).
 *
 *   node tools/test-types-wide.mjs
 *
 * `tsconfig.wide.json` (non-strict, checkJs) adds content/, offscreen/, ui/,
 * devtools/, annotate/, videoedit/, replay/ and diagram/. Each directory has its
 * own ceiling below; a count above its ceiling is red, so deleting a JSDoc type
 * in content/ cannot hide behind a drop somewhere else. Ceilings only go down.
 * Errors that tsc reports in files outside these directories (core/, platform/)
 * belong to tools/test-types.mjs and are not counted here.
 *
 * Every run first proves the gate: it feeds a fake tsc report one error over a
 * ceiling and expects a failure.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ceilingFromBaseline, failureCount } from './lib-assert.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSC = path.join(root, 'node_modules', 'typescript', 'lib', 'tsc.js');

// 1 Oct 2026: first measurement. Lower only.
// P6 (12 Oct 2026): the live per-directory ceilings are `ceilings.typesWide` (an object keyed by directory) in
// tools/gate-baseline.json; LAST_KNOWN is the most each directory may hold there. A raise prints GATE LOOSENED and is red
// unless QAW_ACCEPT_GATE names a reason.
const LAST_KNOWN = { content: 47, offscreen: 17, ui: 10, devtools: 11, annotate: 4, videoedit: 1, replay: 0, diagram: 0 };
export const CEILINGS = ceilingFromBaseline('typesWide', LAST_KNOWN);

/** Error counts per ceiling directory, from tsc's text output. */
export function countByDir(stdout) {
  const counts = Object.fromEntries(Object.keys(CEILINGS).map((d) => [d, 0]));
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^([^(\s][^(]*)\(\d+,\d+\): error TS\d+:/.exec(line);
    if (!m) continue;
    const dir = m[1].trim().replaceAll(String.fromCharCode(92), '/').split('/')[0];
    if (dir in counts) counts[dir]++;
  }
  return counts;
}

/** Directories whose count is above their ceiling. */
export function overCeiling(counts) {
  return Object.keys(CEILINGS).filter((d) => counts[d] > CEILINGS[d]).map((d) => `${d}: ${counts[d]} errors, ceiling is ${CEILINGS[d]}`);
}

function runTsc() {
  try {
    return execFileSync(process.execPath, [TSC, '--noEmit', '-p', path.join(root, 'tsconfig.wide.json')], { cwd: root, encoding: 'utf8' });
  } catch (err) {
    const out = String(err.stdout ?? '');
    if (!out) { console.log(`  FAIL tsc did not run\n       ${String(err.stderr).trim()}`); process.exit(1); }
    return out;
  }
}

{
  const fake = `content/x.js(1,1): error TS2322: x\n`.repeat(CEILINGS.content + 1);
  const bad = overCeiling(countByDir(fake));
  if (bad.length !== 1 || !bad[0].startsWith('content:')) { console.log('  FAIL self-test: one error over the content ceiling was not caught'); process.exit(1); }
  console.log('  ok  gate catches one error over a ceiling');
}

console.log('type-checking content, offscreen, ui, devtools, annotate, videoedit, replay and diagram with tsc --noEmit');
const counts = countByDir(runTsc());
const bad = overCeiling(counts);
for (const d of Object.keys(CEILINGS)) console.log(`  ${bad.some((b) => b.startsWith(d + ':')) ? 'FAIL' : 'ok  '} ${d}: ${counts[d]} (ceiling ${CEILINGS[d]})`);
console.log(`  (wide tsc errors by directory: ${Object.keys(CEILINGS).map((d) => `${d}=${counts[d]}`).join(' ')})`);
console.log(`\n${Object.keys(CEILINGS).length - bad.length} passed, ${bad.length} failed`);
if (bad.length) process.exit(1);
