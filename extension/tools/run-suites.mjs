#!/usr/bin/env node
/**
 * run-suites.mjs — per-suite baseline recorder and comparator (S0, plan §1.2).
 *
 * `npm run test:chain` chains all suites with `&&` and stops at the first red, so it
 * cannot tell a stage which suites are already red on `main` and which one
 * it just broke. This runs each suite in `package.json` `scripts["test:chain"]` on
 * its own, records the FAIL detail (not just the title) and three numbers
 * (boot-graph KB, tsc errors, dead-key count), and can diff a later run
 * against that record.
 *
 * Baseline (record) mode — the default:
 *   node tools/run-suites.mjs [--ext <dir>] [--only a,b,c] [--out <file>] [--node-only] [--suite-timeout <s, default 300>]
 *   Runs every suite, writes work/ui-rework-0927/baseline/main-<sha>.json
 *   plus main-<sha>.logs/<suite>.log (full stdout+stderr, ignored by git).
 *
 * Named entry points (package.json): `npm run test:ci` = --node-only --ci; `npm run test:full` = --by-hand --suite-timeout 240
 * (the whole chain, headed suites and the by-hand suites included); `npm run test:headed` = --by-hand. THE DELIVERY GATE is
 * `npm run test:release-gate` (= test:full && test:a11y && `npm run clickthrough`, D-1010-67, D-1010-167): it prints "PASS, N SKIPPED" per suite, fails a
 * SKIPPED toolbar press from test-boot-smoke (D-1010-63), and exits 1 on any red that is not quarantined or known red in every
 * record mode. D-1010-166: under --by-hand a byHand QUARANTINE suite that exits non-zero is a FAIL (quarantine excuses a red only
 * outside --by-hand, and a byHand suite is not run there at all). A run without --by-hand prints the by-hand suites it did not run.
 * Headed members of the chain (a lib-launch import, a visible Chrome; a playwright import keeps them out of test:ci): test-first-run-live and
 * test-worker-restart (council-1010 r2-01-2: stops every service worker over CDP, then checks capture, badge, armed window and headers).
 * r10-12-4: test-editors-keyboard-live is NOT headed (chromium, headless: true); only its playwright import keeps it out of test:ci.
 * r10-12-2: a non-byHand, non-LOCKED tools/test*.mjs may not carry a headless-off or headed launch flag (coverageProblems).
 *
 * Compare mode:
 *   node tools/run-suites.mjs --compare <baseline.json> [--ext <dir>] [--only a,b,c]
 *        [--allow <allowed-dead.json>] [--boot-allow <bytes>] [--node-only] [--out <file>]
 *   Prints only NEW FAIL-detail lines and number regressions, exits 1 if any.
 *   Writes nothing unless --out is given.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, DEFAULT_EXT, DEFAULT_SUITE_TIMEOUT_S, QUARANTINE, KNOWN_RED, suitesToRun, runAll, nodeOnlyFilter, printTally, staleKnownRed,
  normalize, normalizeBlock,
} from './lib-suites.mjs';

// The per-suite machinery (QUARANTINE, KNOWN_RED, LOCKED_SUITES, runSuite, coverageProblems, normalize, ...) lives in lib-suites.mjs since the
// test-pipeline build (P1, 2026-10-12); this file keeps the baseline recorder, the comparator and the command line.

function parseArgs(argv) {
  const args = { compare: null, ext: DEFAULT_EXT, only: null, allow: null, bootAllow: 0, suiteTimeoutS: DEFAULT_SUITE_TIMEOUT_S, nodeOnly: false, ci: false, byHand: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compare') args.compare = argv[++i];
    else if (a === '--ext') args.ext = path.resolve(process.cwd(), argv[++i]);
    else if (a === '--only') args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--allow') args.allow = argv[++i];
    else if (a === '--boot-allow') args.bootAllow = Number(argv[++i]) || 0;
    else if (a === '--suite-timeout') { args.suiteTimeoutS = Number(argv[++i]); if (!(args.suiteTimeoutS > 0)) throw new Error('--suite-timeout needs seconds > 0'); }
    else if (a === '--node-only') args.nodeOnly = true;
    else if (a === '--ci') args.ci = true;
    else if (a === '--by-hand') args.byHand = true;
    else if (a === '--coverage') args.coverage = true;
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function record(args) {
  const extDir = args.ext;
  // r3-12-2: a partial run (--only / --node-only) must never overwrite the default full baseline for this commit.
  if (!args.ci && !args.out && (args.only || args.nodeOnly)) {
    console.error('run-suites: refusing to write the default baseline from a partial run (--only / --node-only). Pass --out <file>, or use --ci to write nothing.');
    return 2;
  }
  let suites = suitesToRun(extDir, args.byHand);
  let skippedNodeOnly = [];
  if (args.nodeOnly) ({ kept: suites, skipped: skippedNodeOnly } = nodeOnlyFilter(suites, extDir, args));
  if (args.only) suites = suites.filter((s) => args.only.includes(s));

  const sha = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim();
  const outPath = args.out
    ? path.resolve(process.cwd(), args.out)
    : path.join(REPO_ROOT, 'work', 'ui-rework-0927', 'baseline', `main-${sha}.json`);
  const logDir = outPath.replace(/\.json$/, '.logs');
  if (!args.ci) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
  }

  const { results, numbers } = await runAll(suites, extDir, { logDir: args.ci ? null : logDir, timeoutS: args.suiteTimeoutS, byHand: args.byHand });
  // T-034: the last `node tools/perf-worker.mjs --json tools/perf-worker-baseline.json` run rides along in the record.
  try { numbers.perfWorker = JSON.parse(fs.readFileSync(path.join(extDir, 'tools', 'perf-worker-baseline.json'), 'utf8')); } catch { /* none recorded yet */ }
  const redSet = results.filter((r) => !r.pass).map((r) => r.suite);

  const record = {
    sha,
    generatedAt: new Date().toISOString(),
    ext: extDir,
    suites: results,
    numbers,
    redSet,
    skippedNodeOnly,
  };
  if (!args.ci) fs.writeFileSync(outPath, JSON.stringify(record, null, 2));

  console.log(`run-suites: ${results.length} suites, ${redSet.length} red, ${results.filter((r) => r.knownRed).length} known red, ${results.filter((r) => r.exitCode === 0).length} green` +
    ` — boot ${numbers.bootGraphKB ?? '?'} KB, tsc ${numbers.tscErrors ?? '?'} errors, dead-keys ${numbers.deadKeys ?? '?'}`);
  console.log(`red: ${redSet.join(', ') || '(none)'}`);
  printTally(results);
  const stale = staleKnownRed(results);
  if (!args.ci) console.log(`baseline written: ${outPath}`);
  return redSet.length || stale ? 1 : 0; // D-1010-67: every record mode exits 1 on a red that is not quarantined or known red (--compare keeps its own rule)
}

async function compare(args) {
  const extDir = args.ext;
  const baseline = JSON.parse(fs.readFileSync(args.compare, 'utf8'));
  const baseBySuite = new Map(baseline.suites.map((s) => [s.suite, s]));

  let suites = suitesToRun(extDir, args.byHand);
  if (args.nodeOnly) suites = nodeOnlyFilter(suites, extDir, args).kept;
  if (args.only) suites = suites.filter((s) => args.only.includes(s));

  const allowedDeadCount = args.allow
    ? (() => { const a = JSON.parse(fs.readFileSync(args.allow, 'utf8')); return Array.isArray(a) ? a.length : Object.keys(a).length; })()
    : 0;
  const bootAllowKB = args.bootAllow / 1024;

  const { results, numbers } = await runAll(suites, extDir, { timeoutS: args.suiteTimeoutS, byHand: args.byHand });

  let newFailLines = 0;
  const newLinesOut = [];
  for (const r of results) {
    const base = baseBySuite.get(r.suite);
    // Re-normalize: the baseline's text was normalized when recorded, with
    // whatever normalize() was current then. Applying today's normalize()
    // again (idempotent on what it already touched) means a normalize fix
    // covers every existing baseline too, not just baselines recorded after it.
    const baseLines = new Set(base ? base.failDetail.map((b) => normalizeBlock(b.split('\n').map(normalize).join('\n'))) : []);
    for (const line of r.failDetail) {
      if (!baseLines.has(line)) {
        newFailLines++;
        newLinesOut.push(`[${r.suite}] ${line}`);
      }
    }
  }

  let numberRegressions = 0;
  const regressionsOut = [];
  if (numbers.bootGraphKB != null && baseline.numbers?.bootGraphKB != null) {
    const ceiling = baseline.numbers.bootGraphKB + bootAllowKB;
    if (numbers.bootGraphKB > ceiling) {
      numberRegressions++;
      regressionsOut.push(`boot graph ${numbers.bootGraphKB} KB > ceiling ${ceiling} KB (baseline ${baseline.numbers.bootGraphKB} + allow ${bootAllowKB})`);
    }
  }
  if (numbers.tscErrors != null && baseline.numbers?.tscErrors != null && numbers.tscErrors > baseline.numbers.tscErrors) {
    numberRegressions++;
    regressionsOut.push(`tsc errors ${numbers.tscErrors} > baseline ${baseline.numbers.tscErrors}`);
  }
  // T-065: per-directory ratchet over the code tsconfig.wide.json covers; any directory going up is a regression.
  for (const [dir, n] of Object.entries(numbers.tscWide || {})) {
    const was = baseline.numbers?.tscWide?.[dir];
    if (was != null && n > was) {
      numberRegressions++;
      regressionsOut.push(`wide tsc errors in ${dir}/ ${n} > baseline ${was}`);
    }
  }
  if (numbers.deadKeys != null && baseline.numbers?.deadKeys != null) {
    const ceiling = baseline.numbers.deadKeys + allowedDeadCount;
    if (numbers.deadKeys > ceiling) {
      numberRegressions++;
      regressionsOut.push(`dead keys ${numbers.deadKeys} > ceiling ${ceiling} (baseline ${baseline.numbers.deadKeys} + allow ${allowedDeadCount})`);
    }
  }

  for (const line of newLinesOut) console.log(line);
  for (const line of regressionsOut) console.log(line);

  if (args.out) {
    const outPath = path.resolve(process.cwd(), args.out);
    fs.writeFileSync(outPath, JSON.stringify({ against: args.compare, suites: results, numbers, newFailLines, regressions: regressionsOut }, null, 2));
  }

  printTally(results);
  const totalFail = results.filter((r) => !r.pass).length + staleKnownRed(results);
  console.log(`run-suites --compare: ${newFailLines} new FAIL line(s), ${numberRegressions} number regression(s), ${totalFail} FAIL in total`);
  return (newFailLines > 0 || numberRegressions > 0 || (args.ci && totalFail > 0)) ? 1 : 0;
}

const args = parseArgs(process.argv.slice(2));
if (args.coverage) { suitesToRun(args.ext, args.byHand); console.log('coverage ok'); process.exit(0); }
const exitCode = args.compare ? await compare(args) : await record(args);
process.exit(exitCode);
