/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * lib-vibium-gate.mjs — an optional second opinion on a suite's verdict: `vibium check` reads the suite's Playwright trace
 * and judges the suite's claim (owner-approved 2026-11-28, for this gate only). Dev tooling: it runs in the pipeline, never in the
 * shipped extension or the helper, which stay free of any model call.
 *
 *   OFF by default. QAW_VIBIUM_GATE=1 turns it on. Claude only: --provider anthropic with a claude-* model (QAW_VIBIUM_MODEL),
 *   other providers' keys and VIBIUM_AI_* are stripped from the child. It needs ANTHROPIC_API_KEY (env or ~/.config/vibium/ai.env);
 *   without one every row is `not-checked`.
 *   A suite that wants checking writes <runDir>/traces/<suite id>.zip (Playwright trace v8) and <suite id>.claim.txt (the outcome it
 *   expects, one sentence). No trace or no claim = not-checked.
 *   PASS should come back `passed`, FAIL should come back `failed`. inconclusive, an error, a timeout, no binary = not-checked.
 *   The result is an extra `vibium` field on the row (and run.vibium in run.json). It never changes a status, never counts as passed,
 *   never enters the verdict or the exit code. A disagreement is a printed line to look at.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const WANT = { PASS: 'passed', FAIL: 'failed' };   // row status -> the status Vibium should give
const TIMEOUT_MS = 240000;

export const gateOn = (env = process.env) => env.QAW_VIBIUM_GATE === '1';
export const modelOf = (env = process.env) => (/^claude/.test(env.QAW_VIBIUM_MODEL || '') ? env.QAW_VIBIUM_MODEL : DEFAULT_MODEL);

/** True when ANTHROPIC_API_KEY is set (env, or ~/.config/vibium/ai.env); the value is never read out. */
export function apiKeyPresent(env = process.env, home = os.homedir()) {
  if (String(env.ANTHROPIC_API_KEY || '').trim()) return true;
  try { return /^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*['"]?\S/m.test(fs.readFileSync(path.join(home, '.config', 'vibium', 'ai.env'), 'utf8')); } catch { return false; }
}

/** argv prefix that runs Vibium without a shell: [node, .../vibium/bin/cli.js]. null when it is not installed. */
export function findCli(env = process.env) {
  if (env.QAW_VIBIUM_CLI) return [env.QAW_VIBIUM_CLI];
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const js = path.join(dir, 'node_modules', 'vibium', 'bin', 'cli.js');   // the npm global layout on Windows (a .cmd shim beside it)
    if (fs.existsSync(js)) return [process.execPath, js];
    if (process.platform !== 'win32' && fs.existsSync(path.join(dir, 'vibium'))) return [path.join(dir, 'vibium')];
  }
  return null;
}

/** The child's environment: Claude's key only; every other provider key and every VIBIUM_AI_* setting is dropped. */
export function childEnv(env = process.env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (k.startsWith('VIBIUM_AI_') || (k.endsWith('_API_KEY') && k !== 'ANTHROPIC_API_KEY')) delete out[k];
  out.PYTHONUTF8 = '1';
  return out;
}

const defaultRunner = (argv, env, timeout) => {
  const r = spawnSync(argv[0], argv.slice(1), { env, encoding: 'utf8', timeout, windowsHide: true });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.code || r.error.message) : '') };
};

/** One row -> { state: agree | disagree | not-checked, reason, status, vibiumStatus?, model }. Never throws. */
export function checkOne({ trace, claim, status, model = DEFAULT_MODEL, cli, runner = defaultRunner, env = process.env }) {
  const out = { state: 'not-checked', reason: '', status, model };
  const want = WANT[status];
  if (!want) out.reason = `status ${status} is not gated`;
  else if (!/^claude/.test(model)) out.reason = 'model is not a Claude model (Claude only)';
  else if (!trace || !fs.existsSync(trace)) out.reason = 'no trace for this suite (traces/<id>.zip)';
  else if (!String(claim || '').trim()) out.reason = 'no claim for this suite (traces/<id>.claim.txt)';
  else if (!apiKeyPresent(env)) out.reason = 'no ANTHROPIC_API_KEY';
  else if (!cli) out.reason = 'vibium is not installed (npm i -g vibium)';
  else {
    const td = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-vibium-'));
    const sess = `qaw-vg-${process.pid}-${path.basename(td).slice(-6)}`;   // its own daemon session, stopped below
    const report = path.join(td, 'verdict.json');   // Vibium refuses an existing report file
    let res = null, code = null, err = '';
    try {
      const r = runner([...cli, '--session', sess, 'check', '-i', trace, '--report', report, '--provider', 'anthropic', '--model', model, '--ai-base-url', '', '--', String(claim).trim().slice(0, 1500)], childEnv(env), TIMEOUT_MS);
      code = r.code; err = r.stderr;
      if (code === 0 && fs.existsSync(report)) res = JSON.parse(fs.readFileSync(report, 'utf8'));
    } catch (e) { err = e.message; }
    try { runner([...cli, '--session', sess, 'daemon', 'stop'], childEnv(env), 30000); } catch { /* best effort */ }
    try { fs.rmSync(td, { recursive: true, force: true }); } catch { /* temp */ }
    if (!res || !['passed', 'failed', 'inconclusive'].includes(res.status)) {
      const last = String(err || '').trim().split(/\r?\n/).pop().slice(0, 160);
      out.reason = `vibium gave no verdict (exit ${code}): ${last || 'no report'}`;
    } else {
      out.vibiumStatus = res.status;
      out.summary = String(res.summary || '').slice(0, 300);
      if (res.status === 'inconclusive') out.reason = `vibium inconclusive${res.reason ? ` (${res.reason})` : ''}`;
      else { out.state = res.status === want ? 'agree' : 'disagree'; out.reason = out.summary || `vibium says ${res.status}`; }
    }
  }
  return out;
}

/** Annotate PASS / FAIL rows of a finished run with `row.vibium`. Returns the run summary, or { enabled: false } when the gate is off. */
export function applyVibiumGate(rows, { runDir, say = () => {}, env = process.env, runner, cli } = {}) {
  if (!gateOn(env)) return { enabled: false };
  const model = modelOf(env);
  const cliArgv = cli === undefined ? findCli(env) : cli;
  const sum = { enabled: true, model, agree: 0, disagree: 0, notChecked: 0 };
  for (const row of rows) {
    if (!WANT[row.status]) continue;
    const trace = path.join(runDir, 'traces', `${row.id}.zip`);
    let claim = '';
    try { claim = fs.readFileSync(path.join(runDir, 'traces', `${row.id}.claim.txt`), 'utf8'); } catch { /* none */ }
    row.vibium = checkOne({ trace, claim, status: row.status, model, cli: cliArgv, runner, env });
    if (row.vibium.state === 'agree') sum.agree++;
    else if (row.vibium.state === 'disagree') { sum.disagree++; say(`VIBIUM REVIEW ${row.id}: ${row.status} but Vibium says ${row.vibium.vibiumStatus}; look at it, the status is unchanged`); }
    else sum.notChecked++;
  }
  return sum;
}
