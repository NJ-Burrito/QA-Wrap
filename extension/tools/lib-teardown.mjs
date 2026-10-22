/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * lib-teardown.mjs — tracked spawn, the run lock and the tree kill (P1, test pipeline 1012, S10 and S11).
 *
 *   spawnTracked(file, args, opts)  argv array, shell:false, pid recorded the moment the child exists, timeout kills that pid's tree only
 *   killTree(pid)                   `taskkill /PID <pid> /T /F` (POSIX: SIGKILL to the pid); never by image name
 *   acquireRunLock(info, opts)      os.tmpdir()/qaw-pipeline.lock created with `wx`; a stale one is taken over out loud; else REFUSED (exit 3)
 *   acquireHeadedLock(info)         os.tmpdir()/qaw-headed.lock, same rules
 *   finalTeardown(...)              ends `leftovers: 0` or names what survived; only recorded pids and this run's marker are touched
 *
 * Nothing in this file selects a process by its name: the pids come from spawn() or from lib-sandbox's marker search
 * (--qaw-run=<id>). A process this run did not start is reported as NOT MINE and left alone.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_OUTPUT = 8 * 1024 * 1024;
export const LOCK_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/** Kill one recorded pid and its descendants. Returns true when the pid is gone afterwards. */
export function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { // POSIX: spawnTracked makes each child a process-group leader, so -pid takes the grandchildren too; a plain pid (not a leader) falls back to itself
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  }
  const until = Date.now() + 2000; // SIGKILL lands asynchronously: give the kernel a moment before judging
  while (isAlive(pid) && !isZombie(pid) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  return !isAlive(pid) || isZombie(pid);
}

/** POSIX: a killed child this process has not reaped yet still answers kill(pid, 0); it is dead for our purposes. */
function isZombie(pid) {
  if (process.platform === 'win32') return false;
  try { return /^State:\s*Z/m.test(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); } catch { return false; }
}

/**
 * Run a child to completion. Resolves { exitCode, output, durationMs, timedOut, pid, startedAt, killed }.
 * opts: cwd, env (the complete env, never merged with ours), timeoutMs, track (an array that receives { pid, id, startedAt }),
 * pidLog (file appended with one JSON line per child), id, transform (output => output, the scrubber), onSpawn(pid).
 */
export function spawnTracked(file, args, opts = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let child;
    try {
      child = spawn(file, args, { cwd: opts.cwd, env: opts.env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ exitCode: 127, output: `spawn error: ${err.message}\n`, durationMs: 0, timedOut: false, pid: null, startedAt, killed: false });
      return;
    }
    const rec = { pid: child.pid, id: opts.id || '', startedAt: new Date(startedAt).toISOString(), file: path.basename(String(file)) };
    if (opts.track) opts.track.push(rec);
    if (opts.pidLog) { try { fs.appendFileSync(opts.pidLog, JSON.stringify(rec) + '\n'); } catch { /* the run dir may be gone */ } }
    if (opts.onSpawn) opts.onSpawn(child.pid);
    let output = '';
    let truncated = false;
    let timedOut = false;
    let killed = false;
    let done = false;
    const add = (d) => { if (output.length < MAX_OUTPUT) output += d; else truncated = true; };
    const timer = opts.timeoutMs > 0 ? setTimeout(() => { timedOut = true; killed = killTree(child.pid); }, opts.timeoutMs) : null;
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    child.on('error', (err) => { output += `spawn error: ${err.message}\n`; });
    const finish = (exitCode) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (truncated) output += '\n[output truncated at 8 MB]\n';
      if (timedOut) output += `\nFAIL ${opts.id || file} timed out after ${Math.round(opts.timeoutMs / 1000)}s (pipeline suite timeout)\n`;
      if (opts.transform) { try { output = opts.transform(output); } catch { /* keep the raw text rather than lose it */ } }
      resolve({ exitCode: timedOut ? 124 : exitCode, output, durationMs: Date.now() - startedAt, timedOut, pid: child.pid, startedAt, killed });
    };
    child.on('close', (code) => finish(code));
    // a killed grandchild can hold the pipes open: give the tree a moment, then stop waiting
    child.on('exit', (code) => setTimeout(() => finish(code), 3000).unref());
  });
}

/* ---- locks ---------------------------------------------------------------------------------------------------- */

export const lockPath = (name = 'qaw-pipeline.lock') => path.join(os.tmpdir(), name);

function readLock(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Create the lock with `wx`. Returns { ok:true, file, takeover?: string, release() } or { ok:false, owner, message }.
 * A lock whose pid is dead (or older than 3 h) is stale: it is taken over and the takeover is returned for the caller to print.
 */
export function acquireLock(info, { name = 'qaw-pipeline.lock', staleAfterMs = LOCK_STALE_AFTER_MS } = {}) {
  const file = lockPath(name);
  const body = JSON.stringify({ pid: process.pid, start: new Date().toISOString(), host: os.hostname(), ...info });
  let takeover = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, body);
      fs.closeSync(fd);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        const cur = readLock(file);
        if (cur && cur.pid === process.pid) { try { fs.unlinkSync(file); } catch { /* gone */ } }
      };
      return { ok: true, file, takeover, release };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const owner = readLock(file);
      const age = (() => { try { return Date.now() - fs.statSync(file).mtimeMs; } catch { return 0; } })();
      const dead = owner ? !isAlive(owner.pid) : age > 10_000; // an unreadable lock younger than 10 s is a writer mid-create
      if (dead || age > staleAfterMs) {
        takeover = `STALE LOCK taken over: ${path.basename(file)} was held by pid ${owner?.pid ?? '?'} (${owner?.tier ?? '?'}, started ${owner?.start ?? '?'}, host ${owner?.host ?? '?'}) and that process is gone`;
        try { fs.unlinkSync(file); } catch { /* raced another taker */ }
        continue;
      }
      return { ok: false, file, owner, message: `REFUSED: ${path.basename(file)} is held by pid ${owner?.pid ?? '?'} (tier ${owner?.tier ?? '?'}, started ${owner?.start ?? '?'}, host ${owner?.host ?? '?'}); one pipeline run at a time` };
    }
  }
  return { ok: false, file, owner: readLock(file), message: `REFUSED: could not take ${path.basename(file)} after 3 tries` };
}
export const acquireRunLock = (info) => acquireLock(info, { name: 'qaw-pipeline.lock' });
export const acquireHeadedLock = (info) => acquireLock(info, { name: 'qaw-headed.lock' });

/* ---- teardown ------------------------------------------------------------------------------------------------- */

/**
 * End of run. tracked: [{pid,id}] recorded by spawnTracked; sandbox: the lib-sandbox module or null.
 * Kills only pids that are still alive from `tracked` and the browsers carrying this run's marker (markerSearch:false skips that query).
 * Returns { killed:[pid], left:[pid], notMine:[string], text } where text is the leftovers.txt body.
 */
export function finalTeardown({ tracked = [], runId, runDir, sandbox = null, markerSearch = true }) {
  const killed = [];
  const left = [];
  const notMine = [];
  for (const t of tracked) {
    if (!isAlive(t.pid)) continue;
    if (killTree(t.pid)) killed.push(t.pid); else left.push(t.pid);
  }
  if (markerSearch && sandbox?.teardownRun) { // one PowerShell process query (about 3 s): skipped when no suite could have launched a browser
    try {
      const r = sandbox.teardownRun({ runId, runDir });
      for (const p of r.killed || []) if (!killed.includes(p)) killed.push(p);
      for (const p of r.left || []) if (!left.includes(p)) left.push(p);
      for (const p of r.notMine || []) notMine.push(String(p));
    } catch (err) { notMine.push(`marker search failed: ${err.message}`); }
  }
  const lines = [];
  lines.push(`leftovers: ${killed.length + left.length}`); // anything found alive at teardown, killed or not
  for (const p of killed) lines.push(`killed at teardown (started by this run): pid ${p}`);
  for (const p of left) lines.push(`STILL RUNNING (started by this run): pid ${p}`);
  for (const n of notMine) lines.push(`NOT MINE, left alone: ${n}`);
  return { killed, left, notMine, text: lines.join('\n') + '\n' };
}
