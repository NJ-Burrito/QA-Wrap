/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * lib-sched.mjs — manifest rows, the plan (lanes in order, fail-fast) and the pools (P1, test pipeline 1012, spec 2.1, 2.8).
 *
 * Order: gate (fail-fast), smoke members (fail-fast, per lane), node (pool), headless (pool 2), headed (serial), measure (serial,
 * report-only), extra. Inside a lane: last-red first, then the changed closure, then longest first by the last recorded duration,
 * then manifest order (`--shuffle <seed>` replaces all of it and prints the seed). One fresh child per suite; the headed lane is
 * strictly one at a time; a headlessOk suite listed headed runs in the headless pool with the force-headless switch (M16).
 *
 * Inputs from other lanes, read through their documented interface and tolerated when absent (notes-1012/P1.md):
 *   test-manifest.json   P2   { features?, suites:[row] }   (derived from package.json + QUARANTINE when the file is not there yet)
 *   lib-select.mjs       P2   selectChanged({ files, rows, manifest, extDir, repoRoot }) -> { ids, escalated, unmapped }
 *   lib-sandbox.mjs      P3   buildChildEnv / readObserver / egressReport / guardSnapshot / guardDiff / teardownRun
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCKED_SUITES, QUARANTINE, KNOWN_RED, acquireLock, releaseLock, loadSuiteList, extractFailDetail, extractNumbers } from './lib-suites.mjs';
import { spawnTracked } from './lib-teardown.mjs';
import { classify, countAssertions } from './lib-verdict.mjs';

export const DEFAULT_TIMEOUT_S = 300;
export const PHASE_ORDER = ['gate', 'smoke', 'node', 'headless', 'headed', 'measure', 'extra'];

/* ---- manifest ------------------------------------------------------------------------------------------------- */

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

export function normalizeRow(raw) {
  const tags = [...asList(raw.tags)];
  if (raw.smoke === true && !tags.includes('smoke') && !tags.includes('canary')) tags.push('canary');
  const q = QUARANTINE[raw.id];
  const byHand = raw.byHand === true || tags.includes('byHand') || Boolean(q?.byHand);
  if (byHand && !tags.includes('byHand')) tags.push('byHand');
  const headed = raw.headed === true;
  let lane = raw.lane;
  if (!LANES_SET.has(lane)) {
    if (headed) lane = 'headed';
    else if (raw.deps?.browser) lane = 'headless';
    else if (raw.stage === 'static' || tags.includes('gate')) lane = 'gate';
    else if (raw.stage === 'perf' || tags.includes('measure')) lane = 'measure';
    else lane = 'node';
  }
  return {
    id: raw.id,
    path: raw.path || `tools/${raw.id}.mjs`,
    args: asList(raw.args),
    lane,
    features: asList(raw.features),
    tags,
    timeout: Number.isFinite(raw.timeout) && raw.timeout > 0 ? raw.timeout : null,
    headed: headed || lane === 'headed',
    headlessOk: raw.headlessOk === true || tags.includes('headlessOk'),
    assertMode: raw.assertMode === 'counted' || tags.includes('assertMode:counted') ? 'counted' : 'exitcode',
    kind: raw.kind === 'tool' || tags.includes('kind:tool') ? 'tool' : 'suite',
    optIn: raw.optIn === true,
    timeoutSource: raw.timeoutSource || null,
    liveCredentials: raw.liveCredentials === true || tags.includes('liveCredentials'),
    liveNetwork: raw.liveNetwork === true || tags.includes('liveNetwork'),
    byHand,
    serial: tags.includes('serial'),
    exclusive: tags.includes('exclusive'),
    deps: { python: raw.python && raw.python !== 'none' ? raw.python : raw.deps?.python && raw.deps.python !== 'none' ? raw.deps.python : tags.includes('needs-python:hard') ? 'hard' : tags.includes('needs-python:soft') ? 'soft' : 'none', lockedProfile: raw.deps?.lockedProfile === true || LOCKED_SUITES.has(raw.id), browser: raw.deps?.browser === true || lane === 'headless' || lane === 'headed' },
    shard: Number.isFinite(raw.shard) ? raw.shard : null,
    feature: asList(raw.features)[0] || '',
  };
}
const LANES_SET = new Set(['gate', 'node', 'headless', 'headed', 'measure']);

/** No test-manifest.json yet: the chain plus QUARANTINE, lane from the source (playwright import, lib-launch import, headless:false). */
export function deriveManifest(extDir) {
  const chain = loadSuiteList(extDir);
  const ids = [...new Set([...chain, ...Object.keys(QUARANTINE)])].filter((id) => fs.existsSync(path.join(extDir, 'tools', `${id}.mjs`)));
  const suites = ids.map((id) => {
    let src = '';
    try { src = fs.readFileSync(path.join(extDir, 'tools', `${id}.mjs`), 'utf8'); } catch { /* unreadable: node lane */ }
    const pw = /from\s+['"](?:@playwright\/test|playwright)['"]/.test(src);
    const headed = /from\s+['"]\.\/(?:lib-launch|lib-test-window)\.mjs['"]/.test(src) || /headless:\s*false|--headed\b/.test(src) || Boolean(QUARANTINE[id]?.byHand);
    return { id, headed, deps: { browser: pw || headed } };
  });
  return { version: 0, derived: true, features: [], suites };
}

export function loadManifest(extDir, file) {
  const p = file ? path.resolve(file) : path.join(extDir, 'tools', 'test-manifest.json');
  let data;
  let source;
  if (fs.existsSync(p)) { data = JSON.parse(fs.readFileSync(p, 'utf8')); source = path.basename(p); } else { data = deriveManifest(extDir); source = 'derived from package.json + QUARANTINE (tools/test-manifest.json not present)'; }
  const list = Array.isArray(data.suites) ? data.suites : Object.values(data.suites || {});
  return { data, source, rows: list.map(normalizeRow), features: data.features || [] };
}

/* ---- history and ordering ------------------------------------------------------------------------------------- */

export function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

/** id -> { status, durationMs } from the newest run (work/test-runs/latest/run.json). */
export function readHistory(runsRoot) {
  const j = readJson(path.join(runsRoot, 'latest', 'run.json'));
  const map = new Map();
  for (const s of j?.suites || []) map.set(s.id, { status: s.status, durationMs: s.durationMs });
  return map;
}

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function orderRows(rows, { history = new Map(), changed = new Set(), shuffleSeed = null, longest = true } = {}) {
  const base = rows.map((r, i) => ({ r, i }));
  if (shuffleSeed !== null && shuffleSeed !== undefined) {
    const rnd = mulberry32(Number(shuffleSeed) || [...String(shuffleSeed)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    return base.map((x) => ({ ...x, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.r);
  }
  const red = (id) => { const h = history.get(id); return h && (h.status === 'FAIL' || h.status === 'FLAKY') ? 1 : 0; };
  return base.sort((a, b) =>
    red(b.r.id) - red(a.r.id)
    || (changed.has(b.r.id) ? 1 : 0) - (changed.has(a.r.id) ? 1 : 0)
    || (longest ? (history.get(b.r.id)?.durationMs || 0) - (history.get(a.r.id)?.durationMs || 0) : 0)
    || a.i - b.i).map((x) => x.r);
}

/* ---- plan ----------------------------------------------------------------------------------------------------- */

export const nodePool = (jobs) => (Number.isInteger(jobs) && jobs > 0 ? jobs : Math.min(4, Math.max(2, Math.floor(os.cpus().length / 2))));

/** Effective lane of a row: a headlessOk suite listed headed runs headless (forceHeadless). */
export function effectiveLane(row, { noConvert = false } = {}) {
  if (row.lane === 'headed' && row.headlessOk && !noConvert) return { lane: 'headless', forceHeadless: true };
  return { lane: row.lane, forceHeadless: false };
}

/**
 * phases: [{ name, lane, rows, pool, failFast, report }] in run order. Smoke members (tag smoke or canary) form their own
 * fail-fast phases per lane, ahead of the plain lanes; a row is in exactly one phase.
 */
export function buildPlan(rows, { jobs = null, history, changed, shuffleSeed = null, noConvert = false, smokeOrder = [] } = {}) {
  const phases = [];
  const pools = { gate: nodePool(jobs), node: nodePool(jobs), headless: jobs ? Math.min(2, jobs) : 2, headed: 1, measure: 1 };
  const bucket = (name, lane, failFast, report, list) => {
    if (!list.length) return;
    const hint = (r) => { const i = smokeOrder.indexOf(r.id); return i < 0 ? 1e6 : i; };
    const ordered = name === 'smoke' ? [...list].sort((a, b) => hint(a) - hint(b)) : list;
    phases.push({ name, lane, failFast, report, pool: name === 'smoke' || name === 'extra' ? pools[lane] ?? 1 : pools[name] ?? 1, rows: orderRows(ordered, { history, changed, shuffleSeed, longest: name !== 'smoke' }) });
  };
  const eff = new Map(rows.map((r) => [r.id, effectiveLane(r, { noConvert })]));
  const isSmoke = (r) => r.tags.includes('smoke');
  const isExtra = (r) => r.tags.includes('extra');
  const main = rows.filter((r) => !isExtra(r));
  bucket('gate', 'gate', true, false, main.filter((r) => r.lane === 'gate'));
  for (const lane of ['node', 'headless', 'headed', 'measure']) bucket('smoke', lane, true, false, main.filter((r) => r.lane !== 'gate' && isSmoke(r) && eff.get(r.id).lane === lane));
  const rest = main.filter((r) => r.lane !== 'gate' && !isSmoke(r));
  for (const lane of ['node', 'headless', 'headed', 'measure']) bucket(lane, lane, false, lane === 'measure', rest.filter((r) => eff.get(r.id).lane === lane));
  const lanesOfExtra = rows.filter(isExtra);
  bucket('extra', 'node', false, false, lanesOfExtra);
  for (const ph of phases) {
    // exclusive and serial rows run alone, after the pool of their phase has drained
    ph.alone = ph.rows.filter((r) => r.exclusive || r.serial);
    ph.rows = ph.rows.filter((r) => !ph.alone.includes(r));
  }
  return { phases, eff, pools };
}

/* ---- changed files and selection ------------------------------------------------------------------------------ */

const git = (cwd, args) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000, windowsHide: true }); } catch { return null; } };

/** Files changed against `base` (default origin/main, else HEAD~1), plus unstaged, staged and untracked; repo-relative with forward slashes. */
export function gitChangedFiles(repoRoot, base) {
  const names = new Set();
  const add = (out) => { for (const l of (out || '').split(/\r?\n/)) if (l.trim()) names.add(l.trim().replace(/\\/g, '/')); };
  let b = base;
  if (!b || b === true) b = git(repoRoot, ['rev-parse', '--verify', '--quiet', 'origin/main']) !== null ? 'origin/main' : 'HEAD~1';
  add(git(repoRoot, ['diff', '--name-only', `${b}...HEAD`]) ?? git(repoRoot, ['diff', '--name-only', b, 'HEAD']));
  add(git(repoRoot, ['diff', '--name-only', 'HEAD']));
  add(git(repoRoot, ['ls-files', '--others', '--exclude-standard']));
  return { files: [...names].filter((f) => !/^work\/test-runs\//.test(f)).sort(), base: b };
}

const HUBS = [/^extension\/(manifest\.json|package\.json)$/, /^extension\/background\/(service-worker|worker-[a-z]+|handlers-[a-z]+)\.js$/, /^extension\/popup\/popup\.js$/, /^extension\/report\/report\.js$/, /^extension\/_locales\/(en|ar)\//, /^extension\/tools\/(lib-[\w-]+|run-suites|pipeline)\.mjs$/];

/**
 * Rows for the "changed" word. P2's lib-select does the real work (reverse import graph, string paths, hubs, i18n parity, unmapped = smoke,
 * nothing changed = smoke). Without it a changed suite selects itself, a hub selects the regression tier, any other extension path is unmapped.
 * `sel` is the lib-select module or null; `m` the manifest object with rows and byId.
 */
export async function selectChangedRows({ sel, m, files, rows, extDir, regressionIds, smokeIds }) {
  let failed = '';
  if (sel?.selectChanged && sel?.buildGraph && m) {
    try {
      const graph = sel.buildGraph(extDir, m);
      const r = sel.selectChanged(m, graph, files);
      return { ids: r.ids.length ? r.ids : smokeIds, escalated: r.escalated ? (r.hubHits || [])[0] || 'hub' : '', unmapped: r.unmapped || [], warnings: r.warnings || [], picked: r.picked, via: 'lib-select.selectChanged', files, reasons: r.reasons || {} };
    } catch (err) { failed = String(err.message).slice(0, 80); }
  }
  const ids = [];
  let escalated = '';
  const unmapped = [];
  for (const f of files) {
    const mm = f.match(/^extension\/tools\/([\w.-]+)\.mjs$/);
    const hit = mm && rows.find((x) => x.id === mm[1]);
    if (hit) ids.push(hit.id);
    if (HUBS.some((h) => h.test(f))) escalated = escalated || f;
    else if (/^extension\//.test(f) && !hit && !/\/(README|CHANGELOG)[^/]*$/i.test(f)) unmapped.push(f);
  }
  const set = new Set(ids);
  if (escalated) for (const id of regressionIds) set.add(id);
  if (unmapped.length || !files.length || !set.size) for (const id of smokeIds) set.add(id);
  return { ids: [...set], escalated, unmapped, warnings: [], picked: 'changed', via: failed ? `builtin (lib-select failed: ${failed})` : 'builtin (lib-select.mjs not present)', files, reasons: {} };
}

/* ---- running one row ------------------------------------------------------------------------------------------ */

async function loadSandbox(toolsDir) {
  try { const m = await import(pathToFileURL(path.join(toolsDir, 'lib-sandbox.mjs')).href); return typeof m.buildChildEnv === 'function' ? m : null; } catch { return null; }
}
async function loadScrub(toolsDir) {
  try { const m = await import(pathToFileURL(path.join(toolsDir, 'lib-scrub.mjs')).href); return typeof m.scrub === 'function' ? m : null; } catch { return null; }
}
/** The sandbox and scrub modules sit beside the pipeline (toolsDir), not in the extension folder under test. */
export const loadHelpers = async (toolsDir) => ({ sandbox: await loadSandbox(toolsDir), scrub: await loadScrub(toolsDir) });

/** The environment a child gets when lib-sandbox.mjs is not present: the R10 allow-list, TEMP and the home inside the run dir. */
export function fallbackEnv({ runDir, suite, runId, base = process.env, forceHeadless, engine, cftPath }) {
  const safe = suite.replace(/[^A-Za-z0-9._-]/g, '_');
  const tmp = path.join(runDir, 'tmp', safe);
  const home = path.join(runDir, 'home', safe);
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const env = {};
  for (const k of ['PATH', 'Path', 'SystemRoot', 'windir', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'SystemDrive', 'USERNAME', 'UQA_WINDOW']) if (base[k] !== undefined) env[k] = base[k];
  Object.assign(env, { PYTHONUTF8: '1', TEMP: tmp, TMP: tmp, USERPROFILE: home, HOME: home, QAW_RUNID: runId, QAW_RUNDIR: runDir, QAW_SUITE: suite });
  if (forceHeadless) env.QAW_FORCE_HEADLESS = '1';
  if (engine) env.QAW_ENGINE = engine;
  if (cftPath) env.QAW_CFT_PATH = cftPath;
  return { env, dirs: { tmp, home } };
}

/**
 * Run one row to a finished record. ctx: { extDir, runDir, runId, helpers, flags, tracked, pidLog, today, engine, cftPath, acceptEnv,
 * pythonBlocked (reason or ''), eff (Map), log(line) }.
 */
export async function execRow(row, ctx) {
  const t0 = Date.now();
  const { lane, forceHeadless } = ctx.eff.get(row.id) || { lane: row.lane, forceHeadless: false };
  const rec = { id: row.id, lane: row.lane, effectiveLane: lane, features: row.features, tags: row.tags, engine: ctx.engineLabel, smoke: row.tags.includes('smoke'), headlessConverted: forceHeadless || undefined };
  if (row.deps.python === 'hard' && ctx.pythonBlocked && !ctx.acceptEnv.includes('python')) {
    return { ...rec, status: 'ENV-BLOCKED', envKind: 'python', reason: ctx.pythonBlocked, durationMs: 0, exitCode: null, assertions: null };
  }
  if (row.deps.browser && ctx.cftBlocked) return { ...rec, status: 'ENV-BLOCKED', envKind: 'cft', reason: ctx.cftBlocked, durationMs: 0, exitCode: null, assertions: null };
  const file = path.resolve(ctx.extDir, row.path);
  if (!fs.existsSync(file)) return { ...rec, status: 'FAIL', reason: `suite file not found: ${row.path}`, durationMs: 0, exitCode: null, assertions: null };
  const lockPath = row.deps.lockedProfile ? await acquireLock(row.id) : null;
  let dlBefore = null;
  const sb = ctx.helpers.sandbox;
  try {
    if (lane === 'headed' && sb?.guardSnapshot) { try { dlBefore = sb.guardSnapshot({ repoRoot: ctx.repoRoot }).downloads; } catch { /* listing only */ } }
    const built = sb
      ? sb.buildChildEnv({ runDir: ctx.runDir, suite: row.id, runId: ctx.runId, forceHeadless, engine: ctx.engineName, cftPath: ctx.cftPath, allowLive: Boolean(ctx.flags.allowLive), sweep: Boolean(ctx.flags.liveSweep) })
      : fallbackEnv({ runDir: ctx.runDir, suite: row.id, runId: ctx.runId, forceHeadless, engine: ctx.engineName, cftPath: ctx.cftPath });
    const env = built.env;
    if (forceHeadless) env.UQA_HEADLESS = '1';
    const laneT = ctx.laneTimeouts?.[row.lane];
    const timeoutS = ctx.suiteTimeoutS || row.timeout || (laneT ? (row.timeoutSource === 'measured' ? laneT : Math.max(laneT, 120)) : DEFAULT_TIMEOUT_S);
    const result = await spawnTracked(process.execPath, [row.path, ...row.args], { cwd: ctx.extDir, env, timeoutMs: timeoutS * 1000, track: ctx.tracked, pidLog: ctx.pidLog, id: row.id, transform: ctx.helpers.scrub ? ctx.helpers.scrub.scrub : undefined });
    result.timeoutS = timeoutS;
    const q = QUARANTINE[row.id];
    const verdict = classify({ row, result, quarantine: q, knownRed: KNOWN_RED[row.id], today: ctx.today, softPythonOk: false });
    let status = verdict.status;
    let reason = verdict.reason;
    let egress = null;
    if (sb?.readObserver && sb?.egressReport) {
      try {
        egress = sb.egressReport(sb.readObserver(ctx.runDir, row.id), row.id);
        if (egress.verdict === 'FAIL' && status !== 'QUARANTINED') { status = 'FAIL'; reason = egress.lines.find((l) => /^FAIL EGRESS/.test(l)) || 'FAIL EGRESS'; }
      } catch { /* no observer file: the suite never launched a browser */ }
    }
    let guard = null;
    if (dlBefore && sb?.guardSnapshot) {
      const after = sb.guardSnapshot({ repoRoot: ctx.repoRoot }).downloads;
      if (after.count !== dlBefore.count || after.newest !== dlBefore.newest) { guard = `real Downloads changed during ${row.id}: count ${dlBefore.count}->${after.count}`; if (status === 'PASS') { status = 'FAIL'; reason = guard; } }
    }
    fs.mkdirSync(path.join(ctx.runDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(ctx.runDir, 'logs', `${row.id}.log`), result.output);
    const numbers = extractNumbers(row.id, result.output);
    return {
      ...rec, status, reason, exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut || undefined,
      assertions: verdict.assertions, assertionSource: verdict.assertionSource, skips: verdict.skips, degraded: verdict.degraded || undefined,
      notEnforced: verdict.notEnforced || undefined, rule: verdict.rule || undefined, knownRed: verdict.knownRed || undefined,
      failDetail: status === 'FAIL' ? extractFailDetail(result.output).slice(0, 6) : undefined, tail: status === 'FAIL' ? result.output.split(/\r?\n/).slice(-30) : undefined,
      numbers: Object.keys(numbers).length ? numbers : undefined, pid: result.pid, egress: egress ? { stubbed: egress.stubbed, failures: egress.failures, handoffs: egress.handoffs, warnings: egress.warnings } : undefined, guard: guard || undefined,
      wallMs: Date.now() - t0,
    };
  } finally {
    if (lockPath) releaseLock(lockPath);
  }
}

/* ---- pools ---------------------------------------------------------------------------------------------------- */

/** Run `items` with at most `n` in flight, in the given order. `stop()` true = start nothing new. Returns when all started work ended. */
export async function pool(items, n, worker, stop = () => false) {
  const started = new Set();
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(n, items.length || 1)) }, async () => {
    for (;;) {
      if (stop()) return;
      const i = next++;
      if (i >= items.length) return;
      started.add(i);
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
  return items.filter((_, i) => !started.has(i));
}

/**
 * Execute the plan. Returns { rows (every row of the plan, in finish order then NOT-RUN), stoppedBy }.
 * A red (FAIL) or a skipped smoke member in a failFast phase stops that phase from starting more and marks every later phase NOT-RUN.
 */
export async function runPlan(plan, ctx, hooks = {}) {
  const done = [];
  let stoppedBy = '';
  const total = plan.phases.reduce((a, p) => a + p.rows.length + p.alone.length, 0);
  let n = 0;
  const finish = (rec) => { done.push(rec); n++; hooks.onResult?.(rec, n, total); return rec; };
  const notRun = (row, why) => finish({ id: row.id, lane: row.lane, features: row.features, tags: row.tags, status: 'NOT-RUN', reason: why, smoke: row.tags.includes('smoke'), engine: ctx.engineLabel });
  for (const ph of plan.phases) {
    const label = ph.name === 'smoke' ? `smoke(${ph.lane})` : ph.name;
    if (stoppedBy) { for (const r of [...ph.rows, ...ph.alone]) notRun(r, `${stoppedBy} red`); continue; }
    hooks.onPhase?.(label, ph);
    const tripped = () => ph.failFast && done.some((d) => d.phase === label && (d.status === 'FAIL' || (d.smoke && (d.status === 'SKIPPED' || d.status === 'SKIPPED-NOT-ENFORCED'))));
    const work = async (row) => { const rec = await execRow(row, ctx); rec.phase = label; finish(rec); };
    const left = await pool(ph.rows, ph.pool, work, tripped);
    const leftAlone = [];
    for (const row of ph.alone) { if (tripped()) { leftAlone.push(row); continue; } await work(row); }
    for (const r of [...left, ...leftAlone]) notRun(r, `${label} red, fail-fast`);
    if (tripped()) stoppedBy = label;
  }
  return { rows: done, stoppedBy };
}

/** One probe: rerun each red row up to `n` times, serially. A pass anywhere marks it FLAKY (red), never PASS. */
export async function flakeProbe(rows, rowsById, n, ctx, hooks = {}) {
  const out = [];
  for (const rec of rows.filter((r) => r.status === 'FAIL' && !r.timedOut)) {
    const row = rowsById.get(rec.id);
    if (!row) continue;
    const probes = [];
    for (let i = 0; i < n; i++) {
      hooks.onProbe?.(rec.id, i + 1, n);
      const p = await execRow(row, ctx);
      probes.push({ status: p.status, exitCode: p.exitCode, durationMs: p.durationMs });
      if (p.status === 'PASS') break;
    }
    rec.flake = { probes, passedOnProbe: probes.some((p) => p.status === 'PASS') };
    if (rec.flake.passedOnProbe) {
      rec.status = 'FLAKY';
      rec.reason = `passed on probe after failing once (${probes.length} probe run${probes.length > 1 ? 's' : ''}): red for delivery`;
      const until = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      rec.quarantineProposal = { suite: rec.id, until, reason: 'flaky on probe; fix or renew' };
    }
    out.push(rec.id);
  }
  return out;
}

export { countAssertions };
