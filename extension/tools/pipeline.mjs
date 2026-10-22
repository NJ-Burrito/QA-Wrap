#!/usr/bin/env node
/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * pipeline.mjs — the coded test pipeline (lane P1, council-1012). No agent runs tests; this does.
 *
 *   npm run t                 what changed (nothing changed = smoke). First line `PICKED changed`, last line `NEXT: ...`
 *   npm run t <word>          tier | feature | lane | tag | suite id (unique prefix ok); unknown or ambiguous = exit 64, nothing runs
 *   npm run t last            rerun only what was red in the previous run, prints `fixed n / still red n`
 *   npm run t list            every word with its count            npm run t -- --list   the selection of a command
 *   npm run t -- --flag ...   expert flags (--help): flags only after `--` (R7)
 *
 * Exit: 0 PASS, 1 FAIL or FLAKY, 2 INCOMPLETE (blocked, skipped, not run, gate loosened, human checks open), 3 refused (lock, locked
 * session, single monitor), 64 usage. work/test-runs/latest/RESULT carries the same word on one line.
 *
 * Modules: lib-router (words), lib-sched (plan, pools, rows), lib-verdict (states), lib-preflight, lib-teardown (spawnTracked, lock),
 * lib-report (summary, junit, html). From P2: test-manifest.json, lib-select.mjs. From P3: lib-sandbox.mjs, lib-scrub.mjs.
 * Hooks for the pipeline's own tests: --ext <dir>, --manifest <file>, --runs-root <dir>, --changed-files a,b.
 * Run from extension/ (`node tools/pipeline.mjs`).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { route, excludedReason, TIERS, selectTier as builtinTier } from './lib-router.mjs';
import { loadManifest, buildPlan, runPlan, flakeProbe, execRow, loadHelpers, readHistory, readJson, gitChangedFiles, selectChangedRows, nodePool } from './lib-sched.mjs';
import { tierVerdict, counts, ledgerSummary, compareGate, budgetCheck, p95, EXIT } from './lib-verdict.mjs';
import { preflight, decide } from './lib-preflight.mjs';
import { acquireRunLock, acquireHeadedLock, finalTeardown, spawnTracked } from './lib-teardown.mjs';
import { writeRun, publishLatest, pruneRuns, renderScreen, fmtDur } from './lib-report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const say = (s = '') => console.log(s);

const USAGE = `usage: npm run t [word] [-- flags]
  word: smoke | regression | e2e | full | release | <feature> | <lane> | <tag> | <suite id> | changed | last | list | coverage | cft
  no word = changed (nothing changed = smoke). Flags go after "--":
  --jobs N  --shuffle SEED  --flake-probe [N]  --accept-env python  --accept-gate "reason"  --allow-primary  --engine chromium|cft
  --only a,b  --feature f  --tag t  --lane l  --stage s  --changed [base]  --list  --dry-run  --out DIR  --live-sweep  --allow-live
  --write-baseline (with --accept-gate "reason")  --freeze-budgets  --open  --help
exit: 0 PASS, 1 FAIL/FLAKY, 2 INCOMPLETE, 3 refused (lock, locked session, single monitor), 64 usage`;

async function importOptional(file) {
  try { return await import(pathToFileURL(path.join(HERE, file)).href); } catch { return null; }
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const flush = () => new Promise((r) => process.stdout.write('', r));
async function finish(code) { await flush(); process.exit(code); }

function listWords(rows, tierApi, m) {
  const by = (fn) => { const c = new Map(); for (const r of rows) for (const k of fn(r)) c.set(k, (c.get(k) || 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
  const reach = rows.filter((r) => !excludedReason(r));
  say('tiers     ' + tierApi.names.map((t) => `${t} ${tierApi.select(t).length}`).join('   '));
  say('lanes     ' + by((r) => (excludedReason(r) ? [] : [r.lane])).map(([k, n]) => `${k} ${n}`).join('   '));
  say('features  ' + by((r) => (excludedReason(r) ? [] : r.features)).map(([k, n]) => `${k} ${n}`).join('   '));
  say('tags      ' + by((r) => (excludedReason(r) ? [] : r.tags.filter((t) => !t.startsWith('stage:') && !t.startsWith('assertMode:') && !t.startsWith('net:')))).slice(0, 24).map(([k, n]) => `${k} ${n}`).join('   '));
  say('modes     changed (default)   last   list   coverage   cft (smoke on the CfT engine)');
  const ex = rows.filter((r) => excludedReason(r));
  say(`excluded by construction (S6): ${ex.length} of ${rows.length} rows are never selected (kind:tool, liveCredentials, liveNetwork, optIn); ${reach.length} are reachable`);
  say('suite ids: any exact id, or a unique prefix ("npm run t next-primary")');
}

function readJsonSafe(f) { return readJson(f); }

function gitShowJson(repoRoot, rel) {
  try { return JSON.parse(execFileSync('git', ['show', `HEAD:${rel.replace(/\\/g, '/')}`], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 })); } catch { return null; }
}

/** GATE LOOSENED: P2's gateState/compareGateState against the working baseline and against HEAD, plus assertions lost in this run. */
function gateCheck({ sel, extDir, repoRoot, rows, flags }) {
  const file = path.join(extDir, 'tools', 'gate-baseline.json');
  const baseline = readJsonSafe(file);
  const out = { missing: !baseline, loosened: [], tightened: [], accepted: typeof flags.acceptGate === 'string' ? flags.acceptGate : '' };
  if (!baseline) return out;
  const push = (diffs, prefix = '') => { for (const d of diffs) (d.kind === 'tightened' ? out.tightened : out.loosened).push(`${prefix}${d.key}: ${d.what}`); };
  try { if (sel?.gateState && sel?.compareGateState) push(sel.compareGateState(sel.gateState(extDir), baseline)); } catch (err) { out.loosened.push(`gate state unreadable: ${String(err.message).slice(0, 80)}`); }
  try {
    const committed = gitShowJson(repoRoot, path.relative(repoRoot, file));
    if (committed && sel?.compareGateState) push(sel.compareGateState(baseline, committed).filter((d) => d.kind !== 'tightened'), 'baseline file vs HEAD: ');
  } catch { /* no history for the file yet */ }
  const assertions = {};
  for (const r of rows) if (Number.isFinite(r.assertions) && r.status === 'PASS') assertions[r.id] = r.assertions;
  out.loosened.push(...compareGate({ baseline, current: { assertions } }));
  return out;
}

function autopilotFrom(extDir, rows) {
  const j = readJsonSafe(path.join(extDir, 'tools', 'autopilot-rules.json'));
  const fromRows = [...new Set(rows.filter((r) => r.notEnforced && r.rule).map((r) => r.rule))];
  if (!j) return fromRows.length ? { enforced: '?', notEnforced: fromRows.map((n) => `rule ${n}`) } : null;
  const list = Array.isArray(j) ? j : j.rules || [];
  const ne = list.filter((r) => r.status !== 'enforced').map((r) => `rule ${r.rule}`);
  for (const n of fromRows) if (!ne.includes(`rule ${n}`)) ne.push(`rule ${n}`);
  return { enforced: list.length - list.filter((r) => r.status !== 'enforced').length, notEnforced: ne };
}

function historyDurations(runsRoot, label) {
  const out = [];
  try {
    for (const n of fs.readdirSync(runsRoot).filter((x) => /^\d{8}-\d{6}/.test(x)).sort().slice(-30)) {
      const j = readJsonSafe(path.join(runsRoot, n, 'run.json'));
      if (j && j.label === label && j.selection === 'tier' && j.verdict === 'PASS' && Number.isFinite(j.elapsedMs)) out.push(j.elapsedMs);
    }
  } catch { /* no runs yet */ }
  return out;
}

async function runExtras({ extras, ctx, rowsById, runDir, tracked, pidLog, sb, hooks }) {
  const out = [];
  let canary = null;
  if (extras.includes('canary') && fs.existsSync(path.join(ctx.extDir, 'tools', 'canary.mjs'))) {
    const outFile = path.join(runDir, 'canary.json');
    const built = sb ? sb.buildChildEnv({ runDir, suite: 'canary', runId: ctx.runId, engine: ctx.engineName }) : { env: { PATH: process.env.PATH, PYTHONUTF8: '1' } };
    const r = await spawnTracked(process.execPath, ['tools/canary.mjs', '--out', outFile], { cwd: ctx.extDir, env: built.env, timeoutMs: 600_000, track: tracked, pidLog, id: 'canary', transform: ctx.helpers.scrub?.scrub });
    fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'logs', 'canary.log'), r.output);
    const j = readJsonSafe(outFile);
    if (j) canary = { k: j.killed ?? 0, n: j.total ?? 0, survivors: j.survivors || [], stale: j.stale || [], controlRed: j.controlRed || [] };
    const bad = r.exitCode !== 0 || (canary && (canary.survivors.length || canary.stale.length || canary.controlRed.length));
    const rec = { id: 'canary', lane: 'node', features: [], tags: ['extra'], status: bad ? 'FAIL' : 'PASS', reason: bad ? (canary ? `survivors ${canary.survivors.length}, stale ${canary.stale.length}, control red ${canary.controlRed.length}` : `exit ${r.exitCode}`) : '', exitCode: r.exitCode, durationMs: r.durationMs, engine: ctx.engineLabel, tail: bad ? r.output.split(/\r?\n/).slice(-30) : undefined };
    hooks.onResult(rec);
    out.push(rec);
  }
  if (extras.includes('cft-leg')) {
    for (const id of ['test-boot-zip', 'test-worker-restart-live']) {
      const row = rowsById.get(id);
      if (!row) continue;
      const cctx = { ...ctx, engineName: 'cft', engineLabel: ctx.cftLabel || 'cft-?' };
      const leg = { ...row, id: `${id}@cft` };
      const rec = await execRow(leg, { ...cctx, eff: new Map([[leg.id, { lane: row.lane === 'headed' && row.headlessOk ? 'headless' : row.lane, forceHeadless: Boolean(row.headlessOk && row.lane === 'headed') }]]) });
      rec.tags = [...(rec.tags || []), 'extra', 'cft-leg'];
      hooks.onResult(rec);
      out.push(rec);
    }
  }
  return { rows: out, canary };
}

async function main() {
  process.env.PYTHONUTF8 = '1';
  const argv = process.argv.slice(2);
  // a first, cheap parse for the hooks that locate the manifest
  const pre = (await import('./lib-router.mjs')).parseArgv(argv, process.env);
  if (pre.errors.length) { console.error(pre.errors.join('; ')); say(USAGE); return finish(EXIT.USAGE); }
  const f0 = pre.flags;
  const extDir = f0.ext ? path.resolve(process.cwd(), f0.ext) : path.resolve(HERE, '..');
  const repoRoot = path.resolve(extDir, '..');
  if (f0.help) { say(USAGE); return finish(0); }
  const sel = await importOptional('lib-select.mjs');
  let mf;
  try { mf = loadManifest(extDir, f0.manifest); } catch (err) { console.error(`cannot read the manifest: ${err.message}`); return finish(EXIT.USAGE); }
  const m = { ...mf.data, rows: mf.data.suites || [], byId: new Map((mf.data.suites || []).map((r) => [r.id, r])) };
  const rows = mf.rows;
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const hasTiers = mf.data.tiers && sel?.selectTier;
  const tierApi = hasTiers
    ? { names: [...new Set([...Object.keys(mf.data.tiers), ...TIERS.filter((t) => mf.data.tiers[t])])], select: (t) => sel.selectTier(m, t).ids }
    : { names: TIERS, select: (t) => builtinTier(t, rows).map((r) => r.id) };
  const r = route({ argv, env: process.env, rows, features: mf.features, isTTY: Boolean(process.stdin.isTTY), tierApi });
  if (!r.ok) {
    console.error(r.message);
    if (r.candidates?.length) console.error(`  ${r.candidates.join('\n  ')}`);
    return finish(r.exit || EXIT.USAGE);
  }
  const flags = r.flags || f0;
  if (r.mode === 'help') { say(USAGE); return finish(0); }
  if (r.mode === 'list') { listWords(rows, tierApi, m); return finish(0); }
  const runsRoot = flags.runsRoot ? path.resolve(flags.runsRoot) : flags.out ? path.dirname(path.resolve(flags.out)) : path.join(repoRoot, 'work', 'test-runs');
  if (flags.writeBaseline) {
    if (!sel?.writeGateBaseline) { console.error('lib-select.mjs has no writeGateBaseline'); return finish(EXIT.USAGE); }
    try { sel.writeGateBaseline(extDir, typeof flags.acceptGate === 'string' ? flags.acceptGate : ''); say('gate-baseline.json rewritten from the tree'); return finish(0); } catch (err) { console.error(String(err.message)); say('  usage: npm run t -- --write-baseline --accept-gate "reason of at least 8 characters"'); return finish(EXIT.USAGE); }
  }
  if (flags.freezeBudgets) {
    const bf = path.join(extDir, 'tools', 'pipeline-budgets.json');
    const b = readJsonSafe(bf) || { version: 1, provisionalRuns: 3, tiers: {} };
    for (const t of Object.keys(b.tiers || {})) { const h = historyDurations(runsRoot, t); if (h.length >= (b.provisionalRuns ?? 3)) { b.tiers[t].frozenSec = Math.ceil((p95(h) * 1.25) / 1000); b.tiers[t].enforce = true; say(`${t}: frozen at ${b.tiers[t].frozenSec}s (p95 x 1.25 of ${h.length} runs)`); } else say(`${t}: ${h.length} recorded run(s), needs ${b.provisionalRuns ?? 3}`); }
    fs.writeFileSync(bf, JSON.stringify(b, null, 2) + '\n');
    return finish(0);
  }
  if (r.mode === 'coverage') {
    if (sel?.coverageCheck) {
      const res = sel.coverageCheck(extDir, undefined);
      for (const p of res.problems) say(`COVERAGE FAIL [${p.check}] ${p.msg}`);
      for (const w of res.warnings || []) say(`warning: ${typeof w === 'string' ? w : w.msg}`);
      say(res.problems.length ? `coverage: ${res.problems.length} problem(s)` : 'coverage ok');
      return finish(res.problems.length ? 1 : 0);
    }
    const { suitesToRun } = await import('./lib-suites.mjs');
    suitesToRun(extDir, true);
    say('coverage ok');
    return finish(0);
  }

  /* ---- selection ---- */
  let selRows = r.rows || [];
  let label = r.label;
  let picked = r.picked;
  let tier = r.tier;
  let selection = r.tier ? 'tier' : r.kind;
  let engine = r.engine || flags.engine || null;
  let mode = r.mode;
  let lastInfo = null;
  let changedInfo = null;
  const history = readHistory(runsRoot);
  if (mode === 'last') {
    const prev = readJsonSafe(path.join(runsRoot, 'latest', 'run.json'));
    if (!prev) { console.error(`no previous run in ${path.join(runsRoot, 'latest')}; try: npm run t smoke`); return finish(EXIT.USAGE); }
    const redIds = (prev.suites || []).filter((s) => ['FAIL', 'FLAKY', 'ENV-BLOCKED', 'NOT-RUN'].includes(s.status)).map((s) => s.id).filter((id) => rowsById.has(id) && !id.includes('@'));
    if (!redIds.length) { say(`nothing was red in the last run (${prev.runId}, ${prev.verdict}); nothing to rerun`); return finish(0); }
    selRows = redIds.map((id) => rowsById.get(id));
    label = 'last'; picked = `last (${redIds.length} from ${prev.runId})`; selection = 'last'; tier = null; engine = engine || prev.engineName || null;
    lastInfo = { prev, redIds, of: prev.of || prev.label };
  } else if (mode === 'changed') {
    const files = flags.changedFiles ? String(flags.changedFiles).split(',').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean) : gitChangedFiles(repoRoot, typeof flags.changed === 'string' ? flags.changed : undefined).files;
    const ch = await selectChangedRows({ sel, m, files, rows, extDir, regressionIds: tierApi.select('regression'), smokeIds: tierApi.select('smoke') });
    selRows = ch.ids.map((id) => rowsById.get(id)).filter((x) => x && !excludedReason(x));
    label = 'changed'; selection = 'changed'; tier = null;
    changedInfo = ch;
    picked = `${picked}`;
  }
  say(`PICKED ${picked}`);
  if (changedInfo) {
    say(`${changedInfo.files.length} changed file(s) -> ${selRows.length} suite(s)${changedInfo.escalated ? `; hub file ${changedInfo.escalated}: whole regression tier` : ''}${changedInfo.unmapped.length ? `; unmapped ${changedInfo.unmapped.length}: smoke added` : ''}${changedInfo.files.length === 0 ? '; nothing changed: smoke' : ''}  [${changedInfo.via}]`);
  }
  if (!selRows.length) { console.error('nothing matches: no suite selected, nothing ran'); return finish(EXIT.USAGE); }
  if (flags.list) {
    for (const x of selRows) say(`${x.id.padEnd(36)} ${x.lane.padEnd(9)} ${String(x.timeout ?? '-').padEnd(5)} ${x.headed ? 'headed' : '      '} ${x.features.join(',')}${changedInfo?.reasons?.[x.id] ? `   <- ${changedInfo.reasons[x.id][0]}` : ''}`);
    say(`${selRows.length} suite(s)`);
    return finish(0);
  }

  /* ---- plan, preflight ---- */
  const jobs = flags.jobs ? Number(flags.jobs) : null;
  const shuffle = flags.shuffle !== undefined ? flags.shuffle : null;
  if (shuffle !== null) say(`shuffle seed: ${shuffle}`);
  const changedSet = new Set(changedInfo?.ids || []);
  const smokeOrder = mf.data.smokeOrder || [];
  const plan = buildPlan(selRows, { jobs, history, changed: changedSet, shuffleSeed: shuffle, smokeOrder });
  const needs = {
    browser: selRows.some((x) => x.deps.browser),
    headed: selRows.some((x) => plan.eff.get(x.id).lane === 'headed'),
    pythonHard: selRows.some((x) => x.deps.python === 'hard'),
  };
  const cftPath = flags.engine === 'cft' || engine === 'cft' ? (process.env.QAW_CFT_PATH || undefined) : undefined;
  const lock = flags.dryRun ? { ok: true, release() {} } : acquireRunLock({ tier: label, runId: '' });
  if (!lock.ok) { say(lock.message); return finish(EXIT.REFUSED); }
  if (lock.takeover) say(lock.takeover);
  let headedLock = null;
  const releaseAll = () => { try { headedLock?.release(); } catch { /* gone */ } try { lock.release(); } catch { /* gone */ } };
  process.on('exit', releaseAll);
  const tracked = [];
  const helpers = await loadHelpers(HERE);
  let runId = stamp();
  let runDir = flags.out ? path.resolve(flags.out) : path.join(runsRoot, runId);
  if (!flags.out) for (let i = 2; fs.existsSync(runDir); i++) { runDir = path.join(runsRoot, `${runId}-${i}`); }
  runId = path.basename(runDir);
  const onSignal = async () => {
    say('\ninterrupted: tearing down what this run started');
    finalTeardown({ tracked, runId, runDir, sandbox: helpers.sandbox });
    releaseAll();
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const manifestJson = readJsonSafe(path.join(extDir, 'manifest.json'));
  const pf = await preflight(needs, { extDir, repoRoot });
  const dec = decide(pf, needs, { engine, allowPrimary: Boolean(flags.allowPrimary), minChrome: Number(manifestJson?.minimum_chrome_version) || 0, cftPath });
  for (const w of dec.warnings) say(`warning: ${w}`);
  if (dec.refuse) { say(dec.refuse); releaseAll(); return finish(EXIT.REFUSED); }
  if (flags.dryRun) {
    say(`dry run: engine=${dec.engine}; python ${needs.pythonHard ? (dec.pythonBlocked ? 'BLOCKED' : 'ok') : 'not needed'}; headed ${needs.headed}; browser ${needs.browser}`);
    for (const ph of plan.phases) say(`  ${ph.name === 'smoke' ? `smoke(${ph.lane})` : ph.name}: ${ph.rows.length + ph.alone.length} suite(s), pool ${ph.pool}${ph.failFast ? ', fail-fast' : ''}`);
    releaseAll();
    return finish(0);
  }
  if (needs.headed) {
    headedLock = acquireHeadedLock({ tier: label, runId });
    if (!headedLock.ok) { say(headedLock.message); releaseAll(); return finish(EXIT.REFUSED); }
    if (headedLock.takeover) say(headedLock.takeover);
  }
  fs.mkdirSync(runDir, { recursive: true });
  const pidLog = path.join(runDir, 'pids.jsonl');
  if (typeof flags.acceptGate === 'string') process.env.QAW_ACCEPT_GATE = flags.acceptGate; // the baseline suites read it (P6)
  // expert flags travel to the suites as QAW_* (the sandbox env lets QAW_* through): P4 reads RESUME, P5 reads ZIP / SOURCE
  if (flags.resume !== undefined) process.env.QAW_RESUME = String(flags.resume);
  if (flags.zip !== undefined) process.env.QAW_ZIP = String(flags.zip);
  if (flags.source) process.env.QAW_SOURCE = '1';
  if (flags.allowPrimary) process.env.QAW_ALLOW_PRIMARY = '1';
  const acceptEnv = flags.acceptEnv ? String(flags.acceptEnv).split(',').map((s) => s.trim()) : [];
  const engineName = engine === 'cft' ? 'cft' : 'chromium';
  const ctx = {
    extDir, repoRoot, runDir, runId, helpers, flags, tracked, pidLog, today: process.env.QAW_TODAY || new Date().toISOString().slice(0, 10), engineName, engineLabel: dec.engine,
    cftLabel: pf.playwright?.milestone ? `cft-${pf.playwright.milestone}` : 'cft-?', cftPath, cftBlocked: dec.cftMissing, acceptEnv, pythonBlocked: dec.pythonBlocked, eff: plan.eff,
    suiteTimeoutS: flags.suiteTimeout ? Number(flags.suiteTimeout) : null, laneTimeouts: Object.fromEntries(Object.entries(mf.data.lanes || {}).map(([k, v]) => [k, v.defaultTimeout])),
  };
  if (dec.fail) say(`PREFLIGHT FAIL: ${dec.fail}`);

  /* ---- run ---- */
  const sb = helpers.sandbox;
  const before = sb?.guardSnapshot ? sb.guardSnapshot({ repoRoot }) : null;
  const t0 = Date.now();
  say(`run ${runId}: ${selRows.length} suite(s), engine=${dec.engine}, pools node ${nodePool(jobs)} / headless ${plan.pools.headless} / headed 1${acceptEnv.length ? `, accepted env: ${acceptEnv.join(',')}` : ''}`);
  const line = (rec) => say(`${rec.status === 'PASS' ? 'PASS ' : rec.status.padEnd(5)} ${rec.id}  ${rec.durationMs ? fmtDur(rec.durationMs) : ''}${rec.reason && rec.status !== 'PASS' ? `  ${rec.reason.slice(0, 100)}` : ''}${rec.degraded ? '  [degraded]' : ''}`);
  let result = { rows: [], stoppedBy: '' };
  if (!dec.fail) {
    result = await runPlan(plan, ctx, { onResult: (rec, n, total) => { say(`[${n}/${total}] `.padEnd(9) + `${rec.status === 'PASS' ? 'PASS ' : rec.status}  ${rec.id}  ${rec.durationMs ? fmtDur(rec.durationMs) : ''}${rec.reason && rec.status !== 'PASS' ? `  ${rec.reason.slice(0, 100)}` : ''}${rec.degraded ? '  [degraded]' : ''}`); }, onPhase: (name, ph) => say(`-- ${name}: ${ph.rows.length + ph.alone.length} suite(s), pool ${ph.pool}${ph.failFast ? ', fail-fast' : ''}`) });
    if (flags.flakeProbe !== undefined) {
      const n = Math.min(3, Math.max(1, Number(flags.flakeProbe) || 1));
      const probed = await flakeProbe(result.rows, rowsById, n, ctx, { onProbe: (id, i, tot) => say(`flake probe ${id} ${i}/${tot}`) });
      if (probed.length) say(`flake probe ran on ${probed.length} red suite(s): ${result.rows.filter((x) => x.status === 'FLAKY').map((x) => x.id).join(', ') || 'none passed on probe'}`);
    }
  }
  /* ---- extras of the delivery tiers (canary, CfT leg) ---- */
  let canary = null;
  const tierDef = mf.data.tiers?.[tier] || null;
  const extras = tierDef?.extras || (tier === 'full' ? ['canary', 'cft-leg'] : tier === 'release' ? ['cft-leg'] : []);
  if (!dec.fail && !result.stoppedBy && extras.length) {
    const ex = await runExtras({ extras, ctx, rowsById, runDir, tracked, pidLog, sb, hooks: { onResult: line } });
    result.rows.push(...ex.rows);
    canary = ex.canary;
  }
  const elapsedMs = Date.now() - t0;

  /* ---- guards, teardown, leak scan ---- */
  const guardProblems = [];
  if (before && sb?.guardDiff) {
    const after = sb.guardSnapshot({ repoRoot });
    const rel = path.relative(repoRoot, runsRoot).replace(/\\/g, '/');
    guardProblems.push(...sb.guardDiff({ git: before.git, downloads: { count: 0, newest: 0 } }, { git: after.git, downloads: { count: 0, newest: 0 } }, { ignore: [`${rel}/`, 'work/test-runs/'] }));
  }
  for (const rec of result.rows) if (rec.guard) guardProblems.push(rec.guard);
  const td = finalTeardown({ tracked, runId, runDir, sandbox: helpers.sandbox, markerSearch: selRows.some((x) => x.deps.browser) || fs.existsSync(path.join(runDir, 'profiles')) && fs.readdirSync(path.join(runDir, 'profiles')).some((d) => fs.readdirSync(path.join(runDir, 'profiles', d)).length) });
  const leaks = [];
  if (sb?.leakScanDir) { try { for (const hit of sb.leakScanDir(runDir)) leaks.push(`${path.relative(runDir, hit.file)}: ${hit.kind} x${hit.count}`); } catch { /* unreadable sink */ } }

  /* ---- verdict ---- */
  const allRows = result.rows;
  const c = counts(allRows);
  const ledgerJson = readJsonSafe(path.join(extDir, 'tools', 'human-checks.json'));
  const ledger = ledgerSummary(ledgerJson, manifestJson?.version);
  const delivery = Boolean(r.delivery);
  const gate = gateCheck({ sel, extDir, repoRoot, rows: allRows, flags });
  const budgets = readJsonSafe(path.join(extDir, 'tools', 'pipeline-budgets.json')) || { provisionalRuns: 3, tiers: Object.fromEntries(Object.entries(mf.data.tiers || {}).filter(([, v]) => v.budgetSeconds).map(([k, v]) => [k, { budgetSec: v.budgetSeconds }])) };
  const hist = tier && selection === 'tier' ? historyDurations(runsRoot, label) : [];
  const budget = tier && selection === 'tier' && !flags.suiteTimeout ? budgetCheck({ budgets, tier: label, elapsedMs, rows: allRows, history: hist }) : { status: 'none' };
  if (budget.status === 'warn') say(`WARN over provisional budget: ${budget.message}`);
  const verdict = tierVerdict({ rows: allRows, tier: label, acceptEnv, gateLoosened: gate.loosened, gateAccepted: gate.accepted, ledger, delivery, guardProblems, leaks, preflightFail: dec.fail, budget, subset: mode === 'last' });
  const reasons = verdict.reasons;
  if (result.stoppedBy) reasons.unshift(`${result.stoppedBy} red: later suites NOT RUN`);
  let lastLine = '';
  if (lastInfo) {
    const nowById = new Map(allRows.map((x) => [x.id, x]));
    const fixed = lastInfo.redIds.filter((id) => nowById.get(id)?.status === 'PASS').length;
    lastLine = `fixed ${fixed} / still red ${lastInfo.redIds.length - fixed}`;
    say(lastLine);
  }
  const reportRel = path.relative(repoRoot, runDir).replace(/\\/g, '/');
  const run = {
    runId, startedAt: new Date(t0).toISOString(), label, tier: tier || null, mode, selection, picked, of: lastInfo?.of || undefined, lastLine: lastLine || undefined,
    verdict: verdict.verdict, exit: verdict.exit, reasons, deliveryGate: delivery, engine: dec.engine, engineName, engineBuild: pf.playwright?.browserVersion || null,
    counts: c, elapsedMs, budget: budget.status === 'none' ? null : { status: budget.status, budgetMs: budget.budgetMs, message: budget.message },
    ledger: ledger.missing ? { missing: true, open: null, notCovered: null } : { open: ledger.open, notCovered: ledger.notCovered, items: ledger.items },
    gate: { missing: gate.missing, loosened: gate.loosened, tightened: gate.tightened, accepted: gate.accepted }, autopilot: autopilotFrom(extDir, allRows), canary,
    leftovers: td.killed.length + td.left.length, guardProblems, leaks, acceptEnv, changed: changedInfo ? { files: changedInfo.files.length, escalated: changedInfo.escalated, unmapped: changedInfo.unmapped, via: changedInfo.via } : undefined,
    flags: Object.fromEntries(Object.entries(flags).filter(([k]) => !['ext', 'manifest', 'runsRoot', 'changedFiles'].includes(k))),
    reportRel, logRel: `${reportRel}/logs`, latestRel: `${path.relative(repoRoot, path.join(runsRoot, 'latest')).replace(/\\/g, '/')}/`,
    suites: allRows.map((x) => ({ ...x })),
  };
  run.rows = run.suites;
  const jsonRun = { ...run }; delete jsonRun.rows;
  writeRun(runDir, { ...run, suites: run.suites }, { env: pf, leftoversText: td.text });
  // run.json carries `suites` (the spec's name for the per-suite rows); lib-report renders from `rows`
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(jsonRun, null, 2) + '\n');
  if (!flags.noLatest) publishLatest(runsRoot, runDir, run);
  if (!flags.out) await pruneRuns(runsRoot, HERE);
  say('');
  for (const l of renderScreen(run)) say(l);
  releaseAll();
  if (flags.open && process.platform === 'win32') { try { execFileSync('cmd', ['/c', 'start', '', path.join(runDir, 'index.html')], { stdio: 'ignore' }); } catch { /* opening is a convenience */ } }
  return finish(verdict.exit);
}

main().catch((err) => { console.error(`pipeline: ${err.stack || err.message}`); process.exit(1); });
