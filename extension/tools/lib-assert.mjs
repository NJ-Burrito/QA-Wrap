/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * A tiny assertion counter every suite can share (test pipeline lane P6, spec 2.9).
 *
 *   import { assert, ok, nonEmpty, proveTeeth, skipNotEnforced, ceilingFromBaseline, finish } from './lib-assert.mjs';
 *
 * Why it exists: six of seventeen sampled suites print no `ok` line and no `N passed` summary, so the runner cannot tell
 * "ran 400 assertions" from "ran none". This file gives a suite three cheap things and nothing else:
 *
 *   1. `assert` is `node:assert/strict` with every call counted. A suite swaps its import line and keeps its body.
 *   2. `ok(cond, label)` prints one `  ok  label` line (the shape the runner counts) or `  FAIL  label`, and counts.
 *   3. `finish(name)` prints `<name>: N passed, M failed` (the summary shape the runner reads) and sets the exit code.
 *
 * The other helpers close holes the strength audit found (work/council-1012/seat-6-strength.md):
 *   - `nonEmpty(list, what)`      a discovery loop over an empty list asserts nothing and passes; this fails it.
 *   - `proveTeeth(what, check, bad)`  a guard suite feeds its own check a known-bad input and expects red.
 *   - `skipNotEnforced(...)`     a suite that does not check a rule says so with exit 2, never a green exit 0.
 *   - `ceilingFromBaseline(...)` a numeric ceiling lives in `gate-baseline.json`, not in the test file.
 *
 * Exit protocol (design 2.7): 0 pass, 1 fail, 2 skipped or not enforced (first line `SKIPPED:` or `ENV-BLOCKED:`).
 */
import nodeAssert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let counted = 0;
let failed = 0;
const failures = [];

/** Every function property of node's strict assert, wrapped so a call that returns (did not throw) is one counted pass. */
function countedAssert() {
  const wrap = (fn) => (...args) => { const r = fn(...args); counted++; return r; };
  const out = wrap(nodeAssert);
  for (const key of Object.keys(nodeAssert)) {
    const v = nodeAssert[key];
    out[key] = typeof v === 'function' && key !== 'AssertionError' ? wrap(v.bind(nodeAssert)) : v;
  }
  // `rejects` returns a promise; count it when it settles.
  out.rejects = async (...args) => { const r = await nodeAssert.rejects(...args); counted++; return r; };
  out.doesNotReject = async (...args) => { const r = await nodeAssert.doesNotReject(...args); counted++; return r; };
  return out;
}

/** `node:assert/strict`, each passing call counted. A failing call throws exactly as before. */
export const assert = countedAssert();

/** One non-throwing check: prints `  ok  label` or `  FAIL  label` and counts it. Returns the boolean. */
export function ok(cond, label, detail = '') {
  if (cond) {
    counted++;
    console.log(`  ok  ${label}`);
    return true;
  }
  failed++;
  failures.push(label);
  console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  return false;
}

/** How many assertions passed so far in this process (assert calls plus `ok` calls). */
export const assertionCount = () => counted;
/** How many `ok(false, ...)` checks failed so far (a suite with its own counters adds this to its exit decision). */
export const failureCount = () => failed;

/**
 * A discovered list (files from readdir, controls from a page, keys from a table) must not be empty: a loop over nothing
 * is a green suite that checked nothing. Returns the list so it can be used inline.
 */
export function nonEmpty(list, what) {
  const n = list?.length ?? list?.size ?? 0;
  ok(n > 0, `${what}: ${n} found (a discovery loop over an empty list proves nothing)`);
  if (n === 0) throw new Error(`${what}: the list is empty, so every check over it would pass without checking anything`);
  return list;
}

/**
 * The guard has teeth: `check(bad)` must report a problem. `check` returns an array of problems (non-empty = red) or
 * throws; a check that returns nothing, an empty array or `true` on the known-bad input is a guard that cannot fail.
 */
export function proveTeeth(what, check, bad) {
  let red = false;
  try {
    const r = check(bad);
    red = Array.isArray(r) ? r.length > 0 : r === false;
  } catch { red = true; }
  ok(red, `teeth: ${what} goes red on a known-bad input`);
  if (!red) throw new Error(`${what}: the guard accepted a known-bad input, so it cannot fail`);
}

/**
 * Rules and halves that are not checked yet. Prints the line the runner greps (`SKIPPED:` first). Call it BEFORE the
 * implemented half runs, then end the suite with `finish(name, { skipped: 1 })`: a red half exits 1, a green one exits 2.
 *
 *   skipNotEnforced({ rule: 5, what: 'interrupted-recording keep and notice', why: 'P2-2, P2-3 deferred' });
 */
export function skipNotEnforced({ rule, what, why }) {
  console.log(`SKIPPED: NOT IMPLEMENTED rule ${rule} (SKIPPED-NOT-ENFORCED) - ${what}${why ? ` (${why})` : ''}`);
}

/** Print the summary line and exit: 1 when anything failed, else 2 when something was skipped, else 0. */
export function finish(suite, { skipped = 0 } = {}) {
  console.log(`${suite}: ${counted} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
  process.exit(failed ? 1 : skipped ? 2 : 0);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GATE_BASELINE = path.join(HERE, 'gate-baseline.json');

/**
 * A ceiling that lives in `gate-baseline.json` (`{ ceilings: { <group>: <number | object> } }`), with the last known
 * value kept here only as the floor it may not exceed. Rules:
 *   - file absent: the built-in `known` value is used and a warning line is printed (the file arrives with the integrator);
 *   - file present but the group is missing: red, never a silent fall back;
 *   - value above `known` (a raise): prints `GATE LOOSENED` and is red unless QAW_ACCEPT_GATE names a reason;
 *   - value below `known`: used as the new ceiling (the ratchet only ever tightens).
 * `known` is the number (or per-directory object) the suite last shipped with.
 */
export function ceilingFromBaseline(group, known, { file = GATE_BASELINE, env = process.env } = {}) {
  let from = null;
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    from = data?.ceilings?.[group];
    if (from === undefined) {
      ok(false, `gate-baseline.json has ceilings.${group}`, 'add the group to extension/tools/gate-baseline.json; a missing group is never replaced by a built-in number');
      return known;
    }
  } else console.log(`  --  gate-baseline.json absent: built-in ${group} ceiling in use (the integrator adds the file)`);
  if (from === null) return known;
  const raised = typeof known === 'number'
    ? from > known ? [`${group}: ${from} > ${known}`] : []
    : Object.keys(known).filter((k) => !(k in from) || from[k] > known[k]).map((k) => `${group}.${k}: ${from[k]} > ${known[k]}`);
  if (raised.length) {
    const reason = (env.QAW_ACCEPT_GATE || '').trim();
    console.log(`GATE LOOSENED: ${raised.join('; ')}${reason ? ` (accepted: ${reason})` : ''}`);
    ok(Boolean(reason), `gate-baseline.json does not raise a ceiling above the last known value (${group})`, 'raise only with QAW_ACCEPT_GATE=<reason words>, and say why in the commit');
  }
  return from;
}

/**
 * A baseline rewrite flag (`--write-baseline`, `--write`) is a manual owner act: refused under `npm run`, refused without
 * QAW_REBASELINE_REASON, and the caller prints a diff before it writes. Returns the reason string when allowed.
 */
export function rebaselineGuard(flag, env = process.env) {
  const reason = (env.QAW_REBASELINE_REASON || '').trim();
  if (env.npm_lifecycle_event) {
    console.log(`REFUSED: ${flag} is a manual owner command, not an npm script (npm_lifecycle_event=${env.npm_lifecycle_event})`);
    process.exit(2);
  }
  if (!reason) {
    console.log(`REFUSED: ${flag} re-pins a baseline. Set QAW_REBASELINE_REASON="<why, in words>" and read the diff it prints first.`);
    process.exit(2);
  }
  return reason;
}
