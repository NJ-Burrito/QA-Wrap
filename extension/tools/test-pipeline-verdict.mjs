/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * test-pipeline-verdict.mjs — result states, tier verdict, summary, budgets and the run files of tools/pipeline.mjs (P1, 1012).
 *   node tools/test-pipeline-verdict.mjs   (run from extension/)
 *
 * Unit part: lib-verdict (classify, tierVerdict, compareGate, ledgerSummary, budgetCheck) and lib-report (screen, summary.txt, RESULT, junit).
 * Fixture part: the real pipeline.mjs on a throwaway extension folder (--ext), TEMP redirected, no repo file touched.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recycle } from './lib-trash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const PIPE = path.join(HERE, 'pipeline.mjs');
const V = await import(pathToFileURL(path.join(HERE, 'lib-verdict.mjs')).href);
const R = await import(pathToFileURL(path.join(HERE, 'lib-report.mjs')).href);

let passed = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failed++; console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
};

/* ---------------- unit: assertion counting (R8) and the skip line ---------------- */
t('assertions: ok lines first, else the "N passed" summary, else null', () => {
  assert.deepEqual(V.countAssertions('  ok  a\n  ok  b\n3 passed'), { n: 2, source: 'ok-lines' });
  assert.deepEqual(V.countAssertions('page indicator: 58 passed, 0 failed'), { n: 58, source: 'summary' });
  assert.deepEqual(V.countAssertions('all fine'), { n: null, source: null });
});
t('skip regex: anchored; a skipped word inside an ok line is not a skip (R8: 0 false hits)', () => {
  assert.ok(V.SKIP_LINE.test('  SKIPPED: toolbar press'));
  assert.ok(V.SKIP_LINE.test('not run: no chromium'));
  assert.ok(V.SKIP_LINE.test('Deferred to the release run'));
  assert.ok(!V.SKIP_LINE.test('  ok  a route nav ... is skipped on purpose'));
});

/* ---------------- unit: classify ---------------- */
const row = (o = {}) => ({ id: 'x', deps: { python: 'none' }, assertMode: 'exitcode', ...o });
const cl = (exitCode, output, o = {}) => V.classify({ row: row(o.row), result: { exitCode, output, timedOut: o.timedOut, timeoutS: 5 }, quarantine: o.quarantine, knownRed: o.knownRed, today: '2026-10-12' });
t('exit 0 plain = PASS; exit 1 = FAIL with the first failing line', () => {
  assert.equal(cl(0, '  ok  a').status, 'PASS');
  const f = cl(1, 'noise\nFAIL idle shows 2 .btn-primary\nmore');
  assert.equal(f.status, 'FAIL');
  assert.match(f.reason, /idle shows 2/);
});
t('exit 0 plus a SKIPPED line is SKIPPED, never PASS; NOT IMPLEMENTED is SKIPPED-NOT-ENFORCED with its rule', () => {
  assert.equal(cl(0, '  ok  a\nSKIPPED: toolbar press not proven').status, 'SKIPPED');
  const n = cl(2, 'SKIPPED: NOT IMPLEMENTED rule 4 (cap half)\n');
  assert.equal(n.status, 'SKIPPED-NOT-ENFORCED');
  assert.equal(n.rule, 4);
  assert.equal(cl(0, 'SKIPPED: NOT IMPLEMENTED rule 5').status, 'SKIPPED-NOT-ENFORCED');
});
t('exit 2 protocol: ENV-BLOCKED line, SKIPPED line, and a bare exit 2 is a FAIL naming the protocol', () => {
  assert.equal(cl(2, 'ENV-BLOCKED: python (os error 4551)').status, 'ENV-BLOCKED');
  assert.equal(cl(2, 'SKIPPED: no chromium').status, 'SKIPPED');
  const bare = cl(2, 'something odd');
  assert.equal(bare.status, 'FAIL');
  assert.match(bare.reason, /exit protocol/);
});
t('soft python skip is degraded (still PASS, flagged); a timeout is FAIL whatever the exit code says', () => {
  const d = cl(0, '  ok  a\nSKIPPED: python missing, 2 checks not run', { row: { deps: { python: 'soft' } } });
  assert.equal(d.status, 'PASS');
  assert.equal(d.degraded, true);
  const to = cl(0, 'ok', { timedOut: true });
  assert.equal(to.status, 'FAIL');
  assert.match(to.reason, /timed out/);
});
t('non-vacuity: assertMode counted with 0 assertions is FAIL; exitcode mode needs none', () => {
  const v = cl(0, 'all fine', { row: { assertMode: 'counted' } });
  assert.equal(v.status, 'FAIL');
  assert.match(v.reason, /vacuous/);
  assert.equal(cl(0, 'all fine', { row: { assertMode: 'exitcode' } }).status, 'PASS');
  assert.equal(cl(0, '0 passed, 0 failed', { row: { assertMode: 'counted' } }).status, 'FAIL');
});
t('quarantine excuses a red until its date, never a byHand entry (D-1010-166), never a timeout', () => {
  assert.equal(cl(1, 'FAIL x', { quarantine: { until: '2026-12-31', reason: 'r' } }).status, 'QUARANTINED');
  assert.equal(cl(1, 'FAIL x', { quarantine: { until: '2026-12-31', byHand: true, reason: 'r' } }).status, 'FAIL');
  assert.equal(cl(1, 'FAIL x', { quarantine: { until: '2026-01-01', reason: 'r' } }).status, 'FAIL');
  assert.equal(cl(1, 'FAIL x', { quarantine: { until: '2026-12-31', reason: 'r' }, timedOut: true }).status, 'FAIL');
});

/* ---------------- unit: tier verdict ---------------- */
const rows = (...st) => st.map((s, i) => ({ id: `s${i}`, status: s, smoke: false, reason: s }));
const led = { missing: false, open: 0, notCovered: 0 };
t('verdict: all PASS = PASS exit 0; FAIL beats INCOMPLETE; FLAKY is red; NOT-RUN is INCOMPLETE', () => {
  assert.deepEqual([V.tierVerdict({ rows: rows('PASS', 'PASS'), tier: 'x' }).verdict, V.tierVerdict({ rows: rows('PASS', 'PASS'), tier: 'x' }).exit], ['PASS', 0]);
  const a = V.tierVerdict({ rows: rows('PASS', 'FAIL', 'ENV-BLOCKED'), tier: 'x' });
  assert.deepEqual([a.verdict, a.exit], ['FAIL', 1]);
  assert.equal(V.tierVerdict({ rows: rows('PASS', 'FLAKY'), tier: 'x' }).exit, 1);
  const b = V.tierVerdict({ rows: rows('PASS', 'NOT-RUN'), tier: 'x' });
  assert.deepEqual([b.verdict, b.exit], ['INCOMPLETE', 2]);
  assert.equal(V.tierVerdict({ rows: rows('PASS', 'SKIPPED'), tier: 'x' }).exit, 2);
});
t('verdict: a SKIPPED smoke member is a FAIL; --accept-env python turns a python ENV-BLOCKED into an accepted condition', () => {
  const sk = [{ id: 'm', status: 'SKIPPED', smoke: true, reason: 'x' }];
  assert.equal(V.tierVerdict({ rows: sk, tier: 'smoke' }).verdict, 'FAIL');
  const env = [{ id: 'g', status: 'ENV-BLOCKED', envKind: 'python', reason: 'uv blocked (os error 4551)' }];
  assert.equal(V.tierVerdict({ rows: env, tier: 'full' }).verdict, 'INCOMPLETE');
  assert.equal(V.tierVerdict({ rows: env, tier: 'full', acceptEnv: ['python'] }).verdict, 'PASS');
});
t('verdict: delivery tier without a ledger FAILs, with an open item is INCOMPLETE, with none open PASSes; other tiers ignore the ledger', () => {
  assert.equal(V.tierVerdict({ rows: rows('PASS'), tier: 'full', delivery: true, ledger: null }).verdict, 'FAIL');
  assert.equal(V.tierVerdict({ rows: rows('PASS'), tier: 'full', delivery: true, ledger: { ...led, open: 3 } }).verdict, 'INCOMPLETE');
  assert.equal(V.tierVerdict({ rows: rows('PASS'), tier: 'full', delivery: true, ledger: led }).verdict, 'PASS');
  assert.equal(V.tierVerdict({ rows: rows('PASS'), tier: 'changed', delivery: false, ledger: { ...led, open: 9 } }).verdict, 'PASS');
});
t('verdict: GATE LOOSENED is INCOMPLETE until accepted with a reason; guard problems, leaks and budget breaches FAIL', () => {
  assert.equal(V.tierVerdict({ rows: rows('PASS'), tier: 'x', gateLoosened: ['ceiling types raised'] }).verdict, 'INCOMPLETE');
  assert.equal(V.tierVerdict({ rows: rows('PASS'), tier: 'x', gateLoosened: ['ceiling types raised'], gateAccepted: 'reviewed' }).verdict, 'PASS');
  assert.equal(V.tierVerdict({ rows: rows('PASS'), tier: 'x', guardProblems: ['unexpected write: M x'] }).verdict, 'FAIL');
  assert.equal(V.tierVerdict({ rows: rows('PASS'), tier: 'x', leaks: ['a.log: sk-key x1'] }).verdict, 'FAIL');
  assert.equal(V.tierVerdict({ rows: rows('PASS'), tier: 'x', budget: { status: 'fail', message: 'slow' } }).verdict, 'FAIL');
  assert.equal(V.tierVerdict({ rows: rows('PASS'), tier: 'x', budget: { status: 'warn', message: 'slow' } }).verdict, 'PASS');
});
t('gate compare: ceiling raised vs HEAD, hash changed, assertions lost are each named', () => {
  const base = { ceilings: { types: 152, typesWide: 10 }, hashes: { quarantine: 'aaaa1111' }, assertions: { 'test-a': 10 } };
  const none = V.compareGate({ baseline: base, committed: base, current: { hashes: { quarantine: 'aaaa1111' }, assertions: { 'test-a': 10 } } });
  assert.deepEqual(none, []);
  const out = V.compareGate({ baseline: { ...base, ceilings: { types: 160, typesWide: 10 } }, committed: base, current: { hashes: { quarantine: 'bbbb2222' }, assertions: { 'test-a': 9 } } });
  assert.equal(out.length, 3);
  assert.deepEqual(V.compareGate({ baseline: null }), ['gate-baseline.json is missing']);
});
t('ledger: open counts items below the manifest version; gesture items are NOT COVERED; a missing ledger is flagged', () => {
  const l = V.ledgerSummary({ items: [{ id: 'a', gesture: true, lastTickedVersion: '3.4.0' }, { id: 'b', gesture: false, lastTickedVersion: '3.4.1' }, { id: 'c', gesture: true }] }, '3.4.1');
  assert.deepEqual([l.open, l.notCovered, l.missing], [2, 2, false]);
  assert.equal(V.ledgerSummary(null, '1.0.0').missing, true);
  assert.equal(V.versionLess('3.4.9', '3.10.0'), true);
});
t('budget: provisional breach warns naming the slowest 5; enforced (or 3 recorded runs) fails; under budget is ok', () => {
  const rs = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, durationMs: (i + 1) * 1000 }));
  const budgets = { provisionalRuns: 3, tiers: { smoke: { budgetSec: 2 } } };
  const w = V.budgetCheck({ budgets, tier: 'smoke', elapsedMs: 5000, rows: rs, history: [] });
  assert.equal(w.status, 'warn');
  assert.equal(w.slowest.length, 5);
  assert.match(w.message, /t6 7\.0s/);
  assert.equal(V.budgetCheck({ budgets, tier: 'smoke', elapsedMs: 5000, rows: rs, history: [1, 2, 3] }).status, 'fail');
  assert.equal(V.budgetCheck({ budgets: { tiers: { smoke: { budgetSec: 2, enforce: true } } }, tier: 'smoke', elapsedMs: 5000, rows: rs }).status, 'fail');
  assert.equal(V.budgetCheck({ budgets, tier: 'smoke', elapsedMs: 1500, rows: rs }).status, 'ok');
  assert.equal(V.p95([1, 2, 3, 4, 100]), 100);
});

/* ---------------- unit: report ---------------- */
const mkRun = (overrides = {}) => {
  const rs = [
    { id: 'test-a', lane: 'node', status: 'FAIL', reason: 'idle shows 2 .btn-primary', durationMs: 3200, features: ['popup'], tail: ['FAIL x'] },
    { id: 'test-b', lane: 'headed', status: 'FLAKY', reason: 'passed on probe', durationMs: 5000, features: ['popup'] },
    { id: 'test-c', lane: 'node', status: 'ENV-BLOCKED', envKind: 'python', reason: 'python: uv blocked', durationMs: 0, features: ['i18n-copy'] },
    { id: 'test-d', lane: 'node', status: 'PASS', durationMs: 1000, features: ['report'] },
    { id: 'test-e', lane: 'node', status: 'NOT-RUN', reason: 'gate red', features: [] },
  ];
  return { runId: '20261012-1402', label: 'changed', mode: 'run', rows: rs, suites: rs, counts: V.counts(rs), verdict: 'FAIL', exit: 1, reasons: ['FAIL test-a'], engine: 'chromium-151.0.7922.34', deliveryGate: false, elapsedMs: 124000, budget: { budgetMs: 70000, status: 'fail' }, ledger: { open: 4, notCovered: 7 }, gate: { loosened: [] }, autopilot: { enforced: 10, notEnforced: ['rule 4', 'rule 5'] }, leftovers: 0, picked: 'changed (no word given)', reportRel: 'work/test-runs/20261012-1402', logRel: 'work/test-runs/20261012-1402/logs', latestRel: 'work/test-runs/latest/', ...overrides };
};
t('screen: at most 20 lines, engine and counts on the header, a copy-paste rerun per failure, REPORT then NEXT last', () => {
  const lines = R.renderScreen(mkRun());
  assert.ok(lines.length <= 20, `${lines.length} lines`);
  assert.match(lines[0], /^RESULT: FAIL +\(exit 1\) +tier=changed +engine=chromium-151\.0\.7922\.34/);
  assert.match(lines[1], /1 run|4 run/);
  assert.match(lines[1], /NOT RUN 1/);
  assert.ok(lines.some((l) => /NOT COVERED ON BRANDED CHROME: 7 +HUMAN CHECKS OPEN: 4 +leftovers: 0 +GATE LOOSENED: none/.test(l)));
  assert.ok(lines.some((l) => /AUTOPILOT RULES: 10 enforced, 2 NOT ENFORCED \(rule 4, rule 5\)/.test(l)));
  assert.ok(lines.some((l) => l.trim() === 'npm run t test-a' || /^ +npm run t test-a /.test(l)));
  assert.match(lines.at(-2), /^REPORT: work\/test-runs\/20261012-1402$/);
  assert.match(lines.at(-1), /^NEXT: npm run t last/);
});
t('screen: 40 failures still fit in 20 lines and say how many more there are', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `test-f${i}`, lane: 'node', status: 'FAIL', reason: 'boom', durationMs: 10, features: [] }));
  const lines = R.renderScreen(mkRun({ rows: many, suites: many, counts: V.counts(many) }));
  assert.ok(lines.length <= 20, `${lines.length} lines`);
  assert.ok(lines.some((l) => /\+36 more FAILED/.test(l)));
  assert.match(lines.at(-1), /^NEXT:/);
});
t('screen: a green non-delivery run ends with NEXT: npm run t full and says it is not the delivery gate', () => {
  const ok = [{ id: 'test-d', lane: 'node', status: 'PASS', durationMs: 1000, features: [] }];
  const lines = R.renderScreen(mkRun({ rows: ok, suites: ok, counts: V.counts(ok), verdict: 'PASS', exit: 0, budget: null }));
  assert.equal(lines.at(-1), 'NEXT: npm run t full');
  assert.ok(lines.some((l) => /DELIVERY GATE: no \(changed never satisfies it\)/.test(l)));
});
t('summary.txt: six headings in order, 10 lines at most; RESULT line carries the verdict word and the counts', () => {
  const s = R.renderSummaryTxt(mkRun());
  assert.ok(s.length <= 10);
  const heads = s.map((l) => l.split(':')[0]).filter((h) => ['STATUS', 'FINDING', 'EVIDENCE', 'FILES', 'RISK', 'NEXT'].includes(h));
  assert.deepEqual(heads, ['STATUS', 'FINDING', 'EVIDENCE', 'FILES', 'RISK', 'NEXT']);
  assert.equal(R.resultLine(mkRun()), 'FAIL 1 tier=changed fail=1 flaky=1 blocked=1');
});
t('junit: one testsuite per lane, failures for FAIL and FLAKY, skipped for NOT-RUN, XML-escaped', () => {
  const x = R.renderJunit(mkRun({ rows: [{ id: 'a<b', lane: 'node', status: 'FAIL', reason: 'x & "y"', durationMs: 5, features: [], tail: ['<oops>'] }, { id: 'n', lane: 'node', status: 'NOT-RUN', reason: 'gate', features: [] }] }));
  assert.match(x, /<failure type="FAIL" message="x &amp; &quot;y&quot;">&lt;oops&gt;<\/failure>/);
  assert.match(x, /<skipped message="NOT-RUN: gate"\/>/);
  assert.match(x, /name="a&lt;b"/);
});

/* ---------------- fixture: the real pipeline.mjs ---------------- */
const roots = [];
function fixture(suites, { ledger, budgets, extraManifest = {}, version = '1.0.0' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-pv-'));
  roots.push(root);
  const ext = path.join(root, 'extension');
  const tools = path.join(ext, 'tools');
  fs.mkdirSync(tools, { recursive: true });
  fs.writeFileSync(path.join(ext, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node tools/test-ok.mjs' } }));
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({ version, minimum_chrome_version: '116' }));
  // a stand-in for playwright so the engine label resolves without a browser
  const pw = path.join(ext, 'node_modules', 'playwright');
  const core = path.join(ext, 'node_modules', 'playwright-core');
  fs.mkdirSync(pw, { recursive: true });
  fs.mkdirSync(core, { recursive: true });
  fs.writeFileSync(path.join(pw, 'package.json'), JSON.stringify({ name: 'playwright', main: 'index.js' }));
  fs.writeFileSync(path.join(pw, 'index.js'), `exports.chromium = { executablePath: () => ${JSON.stringify(process.execPath)} };\n`);
  fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ name: 'playwright-core', main: 'index.js' }));
  fs.writeFileSync(path.join(core, 'index.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(core, 'browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium', browserVersion: '151.0.1.1' }] }));
  const man = [];
  for (const s of suites) {
    fs.writeFileSync(path.join(tools, `${s.id}.mjs`), s.code);
    man.push({ id: s.id, path: `tools/${s.id}.mjs`, kind: 'test', lane: s.lane || 'node', features: s.features || ['mix'], tags: s.tags || [], headed: false, timeout: s.timeout ?? null, assertMode: s.assertMode || 'exitcode', python: 'none', ...(s.row || {}) });
  }
  fs.writeFileSync(path.join(tools, 'test-manifest.json'), JSON.stringify({ version: 2, features: ['mix'], suites: man, ...extraManifest }));
  if (ledger) fs.writeFileSync(path.join(tools, 'human-checks.json'), JSON.stringify(ledger));
  if (budgets) fs.writeFileSync(path.join(tools, 'pipeline-budgets.json'), JSON.stringify(budgets));
  return { root, ext, runs: path.join(root, 'runs'), tmp: root };
}
function run(fx, args, o = {}) {
  const r = spawnSync(process.execPath, [PIPE, ...args, '--ext', fx.ext, '--runs-root', fx.runs], { cwd: EXT, encoding: 'utf8', timeout: o.timeout || 180000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: fx.tmp, TMP: fx.tmp, PYTHONUTF8: '1', LOCALAPPDATA: process.env.LOCALAPPDATA, APPDATA: process.env.APPDATA, ...(o.env || {}) } });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
const latest = (fx, f) => fs.readFileSync(path.join(fx.runs, 'latest', f), 'utf8');
const ok3 = (n) => `console.log('  ok  one');console.log('  ok  two');console.log('  ok  three');`;

const mix = fixture([
  { id: 'test-ok', code: ok3(), assertMode: 'counted' },
  { id: 'test-red', code: "console.log('FAIL idle shows 2 .btn-primary');process.exit(1);" },
  { id: 'test-skip0', code: "console.log('  ok  a');console.log('SKIPPED: toolbar press not proven');" },
  { id: 'test-notimpl', code: "console.log('SKIPPED: NOT IMPLEMENTED rule 4 (cap half)');process.exit(2);" },
  { id: 'test-env', code: "console.log('ENV-BLOCKED: python (os error 4551)');process.exit(2);" },
  { id: 'test-vacuous', code: "console.log('all fine');", assertMode: 'counted' },
]);
const r1 = run(mix, ['mix']);
t('fixture run: mixed states give exit 1, a RESULT word and per-suite statuses in run.json', () => {
  assert.equal(r1.status, 1, r1.out);
  assert.match(r1.out, /^PICKED feature mix/m);
  assert.match(latest(mix, 'RESULT'), /^FAIL 1 tier=mix fail=2 /);
  const j = JSON.parse(latest(mix, 'run.json'));
  const st = Object.fromEntries(j.suites.map((s) => [s.id, s.status]));
  assert.deepEqual(st, { 'test-ok': 'PASS', 'test-red': 'FAIL', 'test-skip0': 'SKIPPED', 'test-notimpl': 'SKIPPED-NOT-ENFORCED', 'test-env': 'ENV-BLOCKED', 'test-vacuous': 'FAIL' });
  assert.equal(j.deliveryGate, false);
  assert.match(j.engine, /^chromium-151\.0\.1\.1$/);
});
t('fixture run: the screen has engine, all counts, a rerun command for each failure, and exits with NEXT last', () => {
  const screen = latest(mix, 'screen.txt').trim().split('\n');
  assert.ok(screen.length <= 20);
  assert.match(screen[0], /^RESULT: FAIL +\(exit 1\) +tier=mix +engine=chromium-151\.0\.1\.1/);
  assert.match(screen[1], /6 run +1 pass +2 FAIL +0 FLAKY +1 ENV-BLOCKED +2 skipped +0 quarantined +NOT RUN 0/);
  assert.ok(screen.some((l) => /npm run t test-red/.test(l)) && screen.some((l) => /npm run t test-vacuous/.test(l)));
  assert.match(screen.at(-1), /^NEXT: npm run t last/);
  assert.equal(r1.stdout.trim().split('\n').at(-1), screen.at(-1));
});
t('fixture run: summary.txt, junit.xml, index.html, env.json (names only), leftovers.txt and the run folder logs all exist', () => {
  const dir = path.join(mix.runs, fs.readFileSync(path.join(mix.runs, 'latest', 'RUN'), 'utf8').trim());
  for (const f of ['run.json', 'junit.xml', 'summary.txt', 'index.html', 'RESULT', 'env.json', 'leftovers.txt', 'logs/test-red.log']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.match(latest(mix, 'junit.xml'), /<testsuite name="node" tests="6"/);
  const env = JSON.parse(latest(mix, 'env.json'));
  assert.ok(Array.isArray(env.envNames) && !('env' in env), 'env.json carries names, not values');
  assert.match(latest(mix, 'leftovers.txt'), /^leftovers: 0/);
  assert.match(latest(mix, 'index.html'), /Failures/);
  assert.equal(latest(mix, 'summary.txt').trim().split('\n').length <= 10, true);
});
const r2 = run(mix, ['last']);
t('t last: reruns only the red ones and prints "fixed n / still red n" first; the result never claims the original tier', () => {
  assert.equal(r2.status, 1, r2.out);
  assert.match(r2.out, /^fixed 0 \/ still red 3/m);
  const j = JSON.parse(latest(mix, 'run.json'));
  assert.deepEqual(j.suites.map((s) => s.id).sort(), ['test-env', 'test-red', 'test-vacuous']);
  assert.ok(!j.suites.some((s) => s.id === 'test-ok'));
  assert.equal(j.label, 'last');
  assert.equal(j.deliveryGate, false);
});

const gated = fixture([
  { id: 'test-gate-red', lane: 'gate', code: "console.log('FAIL structure');process.exit(1);" },
  { id: 'test-n1', code: ok3() },
  { id: 'test-n2', code: ok3() },
]);
const r3 = run(gated, ['regression']);
t('fail-fast: a red gate stops the later lanes, prints NOT RUN n, exit 1', () => {
  assert.equal(r3.status, 1, r3.out);
  const j = JSON.parse(latest(gated, 'run.json'));
  assert.deepEqual(Object.fromEntries(j.suites.map((s) => [s.id, s.status])), { 'test-gate-red': 'FAIL', 'test-n1': 'NOT-RUN', 'test-n2': 'NOT-RUN' });
  assert.match(latest(gated, 'screen.txt'), /NOT RUN 2/);
  assert.match(j.reasons.join('\n'), /gate red: later suites NOT RUN/);
});

const flaky = fixture([{ id: 'test-flaky', code: "import fs from 'node:fs';const f='flaky.count';const n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0;fs.writeFileSync(f,String(n+1));if(n===0){console.log('FAIL first time');process.exit(1);}console.log('  ok  second time');" }]);
const r4 = run(flaky, ['mix', '--flake-probe']);
t('flake probe: a suite that fails once and passes on the one probe is FLAKY (red, exit 1) with a quarantine proposal', () => {
  assert.equal(r4.status, 1, r4.out);
  const j = JSON.parse(latest(flaky, 'run.json'));
  assert.equal(j.suites[0].status, 'FLAKY');
  assert.equal(j.suites[0].quarantineProposal.suite, 'test-flaky');
  assert.match(latest(flaky, 'RESULT'), /flaky=1/);
});
const noProbe = fixture([{ id: 'test-flaky', code: "console.log('FAIL always');process.exit(1);" }]);
t('no flag, no retry: the same red suite is a plain FAIL and ran once', () => {
  const r = run(noProbe, ['mix']);
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(latest(noProbe, 'run.json')).suites[0].status, 'FAIL');
  assert.ok(!JSON.parse(latest(noProbe, 'run.json')).suites[0].flake);
});

const slow = fixture([{ id: 'test-sleeper', code: "setTimeout(()=>{console.log('  ok  slept');},3000);", tags: ['smoke'] }], { budgets: { provisionalRuns: 3, tiers: { smoke: { budgetSec: 1, enforce: true } } } });
const r5 = run(slow, ['smoke']);
t('budget: a smoke run over an enforced budget is a FAIL that names the slowest suites', () => {
  assert.equal(r5.status, 1, r5.out);
  assert.match(JSON.parse(latest(slow, 'run.json')).reasons.join('\n'), /over budget: .*slowest 5: test-sleeper/);
  assert.match(latest(slow, 'screen.txt'), /budget!/);
});

const del = (ledger, extra = {}) => fixture([{ id: 'test-ok', code: ok3(), assertMode: 'counted' }], { ledger, ...extra });
const noLedger = del(undefined);
const openLedger = del({ items: [{ id: 'toolbar', title: 't', gesture: true, engine: 'chrome' }] });
const closedLedger = del({ items: [{ id: 'toolbar', title: 't', gesture: true, engine: 'chrome', lastTickedVersion: '1.0.0', by: 'nj', date: '2026-10-12' }] });
const d1 = run(noLedger, ['full']);
const d2 = run(openLedger, ['full']);
const d3 = run(closedLedger, ['full']);
t('delivery tier: no ledger = FAIL (exit 1); an open human check = INCOMPLETE (exit 2) with the count; all ticked = PASS and deliveryGate:true', () => {
  assert.equal(d1.status, 1, d1.out);
  assert.match(latest(noLedger, 'run.json'), /human-checks ledger missing/);
  assert.equal(d2.status, 2, d2.out);
  assert.match(latest(openLedger, 'screen.txt'), /HUMAN CHECKS OPEN: 1/);
  assert.match(latest(openLedger, 'screen.txt'), /NOT COVERED ON BRANDED CHROME: 1/);
  assert.equal(d3.status, 0, d3.out);
  const j = JSON.parse(latest(closedLedger, 'run.json'));
  assert.equal(j.deliveryGate, true);
  assert.equal(j.verdict, 'PASS');
});
t('a changed or filtered run never writes deliveryGate:true even when green', () => {
  const r = run(closedLedger, ['test-ok']);
  assert.equal(r.status, 0, r.out);
  assert.equal(JSON.parse(latest(closedLedger, 'run.json')).deliveryGate, false);
  assert.equal(r.stdout.trim().split('\n').at(-1), 'NEXT: npm run t full');
});

for (const fx of roots) recycle(fx.root);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
