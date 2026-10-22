/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * lib-preflight.mjs — what must be true before a suite is started (P1, test pipeline 1012, spec 2.3 item 1, 2.5, 2.8).
 *
 * Only the probes the selection needs run: node and PYTHONUTF8 always; the Playwright build when a browser suite is selected;
 * the python probe when a hard-python suite is selected; monitors and the locked-session check when a headed suite is selected.
 * Every probe is one bounded call. A failing probe is data (env.json), and the verdict decision is `decide()`:
 *   refuse    -> exit 3 (locked session, single monitor without --allow-primary)
 *   fail      -> exit 1 (node too old, Chromium below minimum_chrome_version)
 *   envBlocked-> suites marked ENV-BLOCKED with the printed reason (python hard)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const run = (file, args, timeout = 20000) => {
  try { return spawnSync(file, args, { encoding: 'utf8', timeout, shell: false, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } }); } catch (err) { return { status: -1, stdout: '', stderr: String(err.message) }; }
};

export function nodeProbe() {
  const major = Number(process.versions.node.split('.')[0]);
  return { ok: major >= 20, version: process.version };
}

/** Playwright's bundled Chromium: build and whether the binary exists. Never launches it. */
export function playwrightProbe(extDir) {
  try {
    const req = createRequire(path.join(extDir, 'package.json'));
    const pw = req('playwright');
    const exe = pw.chromium.executablePath();
    let browserVersion = null;
    try {
      let dir = path.dirname(req.resolve('playwright-core'));
      for (let i = 0; i < 6 && !fs.existsSync(path.join(dir, 'browsers.json')); i++) dir = path.dirname(dir);
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'browsers.json'), 'utf8'));
      browserVersion = (j.browsers || []).find((b) => b.name === 'chromium')?.browserVersion || null;
    } catch { /* version stays null */ }
    return { ok: fs.existsSync(exe), exe, browserVersion, milestone: browserVersion ? Number(browserVersion.split('.')[0]) : null };
  } catch (err) { return { ok: false, error: String(err.message).slice(0, 160), browserVersion: null, milestone: null }; }
}

/** `uv run python -c print(1)` then `python --version`; the printed reason is what the summary shows. */
export function pythonProbe() {
  const uv = run('uv', ['run', '--no-project', 'python', '-c', 'print(1)'], 25000);
  if (uv.status === 0 && /1/.test(uv.stdout || '')) return { ok: true, via: 'uv' };
  const py = run('python', ['--version'], 10000);
  const reason = String(uv.stderr || uv.stdout || uv.error?.message || 'uv failed').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (py.status === 0 && /os error 4551/i.test(reason)) return { ok: false, via: 'python-only', reason: `Windows Application Control blocks uv python (${reason})`, pythonVersion: String(py.stdout || py.stderr).trim() };
  return { ok: false, via: py.status === 0 ? 'python-only' : 'none', reason, pythonVersion: py.status === 0 ? String(py.stdout || py.stderr).trim() : null };
}

export function diskProbe(dir) {
  try {
    const s = fs.statfsSync(dir);
    const freeMB = Math.floor((s.bavail * s.bsize) / 1048576);
    return { ok: freeMB > 1024, freeMB };
  } catch { return { ok: true, freeMB: null, note: 'statfs unavailable' }; }
}

export async function monitorProbe(extDir) {
  try {
    const mod = await import(pathToFileURL(path.join(extDir, 'tools', 'lib-test-window.mjs')).href);
    const mons = mod.monitors();
    return { ok: true, count: mons.length, secondary: mons.some((m) => !m.primary) };
  } catch (err) { return { ok: false, count: null, secondary: false, error: String(err.message).slice(0, 120) }; }
}

/** A locked Windows session shows LogonUI.exe. Returns null when it cannot tell. */
export function lockedSessionProbe() {
  if (process.platform !== 'win32') return { locked: false };
  const r = run('tasklist', ['/FI', 'IMAGENAME eq LogonUI.exe', '/NH'], 10000);
  if (r.status !== 0) return { locked: null };
  return { locked: /LogonUI\.exe/i.test(r.stdout || '') };
}

/** The newest shipped-source mtime vs the packaged zip (informational: test-boot-zip builds a fresh zip into the run dir). */
export function zipFreshness(repoRoot) {
  try {
    const dist = path.join(repoRoot, 'dist');
    const zips = fs.readdirSync(dist).filter((f) => /\.zip$/.test(f)).map((f) => ({ f, m: fs.statSync(path.join(dist, f)).mtimeMs }));
    if (!zips.length) return { zip: null };
    const newest = zips.sort((a, b) => b.m - a.m)[0];
    return { zip: newest.f, builtAt: new Date(newest.m).toISOString() };
  } catch { return { zip: null }; }
}

/**
 * needs: { browser, headed, pythonHard, cft }. opts: { allowPrimary, extDir, repoRoot, minChrome, engineLabelOnly }
 * Returns the env.json body (no secrets, env var NAMES only).
 */
export async function preflight(needs, opts) {
  const env = { when: new Date().toISOString(), platform: `${process.platform} ${os.release()}`, node: nodeProbe(), pythonutf8: process.env.PYTHONUTF8 === '1', cpus: os.cpus().length, notes: [] };
  env.disk = diskProbe(opts.repoRoot);
  env.envNames = Object.keys(process.env).sort();
  env.playwright = playwrightProbe(opts.extDir);
  if (needs.pythonHard) env.python = pythonProbe();
  if (needs.headed) {
    env.monitors = await monitorProbe(opts.extDir);
    env.session = lockedSessionProbe();
  }
  env.zip = zipFreshness(opts.repoRoot);
  return env;
}

/** Decide from the env body. Returns { refuse:string, fail:string, pythonBlocked:string, engine:string, milestone }. */
export function decide(env, needs, opts = {}) {
  const out = { refuse: '', fail: '', pythonBlocked: '', cftMissing: '', engine: 'none', milestone: null, warnings: [] };
  if (!env.node.ok) out.fail = `node ${env.node.version} is older than 20`;
  if (env.pythonutf8 !== true) out.warnings.push('PYTHONUTF8 was not 1 in the runner; children are forced to 1');
  if (env.disk && env.disk.ok === false) out.warnings.push(`low disk: ${env.disk.freeMB} MB free`);
  if (!env.playwright?.ok && needs.browser) out.fail = out.fail || `Playwright Chromium is not installed (${env.playwright?.error || 'binary missing'})`;
  if (needs.browser || env.playwright?.ok) {
    if (env.playwright?.ok) {
      out.milestone = env.playwright.milestone;
      const label = env.playwright.browserVersion || 'unknown-build';
      out.engine = `${opts.engine === 'cft' ? 'cft' : 'chromium'}-${opts.engine === 'cft' ? env.playwright.milestone : label}`;
      if (opts.minChrome && env.playwright.milestone && env.playwright.milestone < opts.minChrome) out.fail = out.fail || `Chromium ${env.playwright.milestone} is below minimum_chrome_version ${opts.minChrome}`;
    }
  }
  if (opts.engine === 'cft' && opts.cftPath && !fs.existsSync(opts.cftPath)) out.cftMissing = `QAW_CFT_PATH does not exist: ${opts.cftPath}`;
  if (needs.pythonHard && env.python && !env.python.ok) out.pythonBlocked = env.python.reason || 'python probe failed';
  if (needs.headed) {
    if (env.session?.locked === true) out.refuse = 'the Windows session is locked (a headed suite cannot see a screen)';
    else if (env.monitors && env.monitors.count != null && !env.monitors.secondary && !opts.allowPrimary) out.refuse = 'NOT RUN: single monitor (headed suites open on the secondary monitor; add --allow-primary to use the main one)';
  }
  return out;
}
