/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * test-pipeline-lock.mjs — the run lock (S10) and the tracked spawn and tree kill (S11) of tools/pipeline.mjs (P1, 1012).
 *   node tools/test-pipeline-lock.mjs   (run from extension/)
 *
 * Two runners: the second exits 3 naming the owner. A stale lock is taken over out loud. A hung suite is killed with its
 * grandchild by recorded pid; a dummy foreign node process this test started survives. No runner source selects a process by name.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recycle } from './lib-trash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const PIPE = path.join(HERE, 'pipeline.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-pl-'));
const ORIG_TEMP = [process.env.TEMP, process.env.TMP, process.env.TMPDIR];
process.env.TEMP = root; // os.tmpdir() follows the environment: the lock file lands in this throwaway folder
process.env.TMP = root;
process.env.TMPDIR = root; // POSIX os.tmpdir() reads TMPDIR, not TEMP
const T = await import(pathToFileURL(path.join(HERE, 'lib-teardown.mjs')).href);

let passed = 0;
let failed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failed++; console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = [];
const foreign = (secs = 120) => { const c = spawn(process.execPath, ['-e', `setTimeout(()=>{}, ${secs * 1000})`], { stdio: 'ignore', windowsHide: true }); started.push(c.pid); return c; };
const waitFor = async (pred, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(100); } return false; };

/* ---------------- lock ---------------- */
await t('lock: created with wx; a second acquire is refused and names pid, tier and start; release lets the next one in', () => {
  const a = T.acquireRunLock({ tier: 'full', runId: 'r1' });
  assert.equal(a.ok, true);
  assert.equal(path.dirname(a.file), root, 'os.tmpdir() / qaw-pipeline.lock');
  assert.equal(path.basename(a.file), 'qaw-pipeline.lock');
  const body = JSON.parse(fs.readFileSync(a.file, 'utf8'));
  assert.deepEqual([body.pid, body.tier, typeof body.start, typeof body.host], [process.pid, 'full', 'string', 'string']);
  const b = T.acquireRunLock({ tier: 'smoke', runId: 'r2' });
  assert.equal(b.ok, false);
  assert.match(b.message, new RegExp(`held by pid ${process.pid} \\(tier full`));
  a.release();
  assert.ok(!fs.existsSync(a.file));
  const c = T.acquireRunLock({ tier: 'smoke', runId: 'r3' });
  assert.equal(c.ok, true);
  c.release();
});
await t('lock: a release by a process that does not own the lock leaves it alone', () => {
  const a = T.acquireRunLock({ tier: 'x' });
  fs.writeFileSync(a.file, JSON.stringify({ pid: 4, start: 'now', tier: 'other', host: 'h' }));
  a.release();
  assert.ok(fs.existsSync(a.file));
  fs.unlinkSync(a.file);
});
await t('lock: a stale lock (its pid is dead) is taken over and the takeover is announced, never silent', async () => {
  const dead = spawnSync(process.execPath, ['-e', '0']);
  assert.equal(T.isAlive(dead.pid ?? 0), false);
  const file = T.lockPath('qaw-pipeline.lock');
  const deadPid = (() => { const c = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }); return Number(c.stdout); })();
  fs.writeFileSync(file, JSON.stringify({ pid: deadPid, start: '2026-10-12T00:00:00Z', tier: 'regression', host: 'old' }));
  const a = T.acquireRunLock({ tier: 'smoke' });
  assert.equal(a.ok, true);
  assert.match(a.takeover, /^STALE LOCK taken over: qaw-pipeline\.lock was held by pid \d+ \(regression, started 2026-10-12T00:00:00Z/);
  a.release();
});
await t('lock: a lock older than the stale age is taken over even when its pid answers', () => {
  const file = T.lockPath('qaw-pipeline.lock');
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, start: 'ancient', tier: 'old', host: 'h' }));
  const old = new Date(Date.now() - 4 * 3600 * 1000);
  fs.utimesSync(file, old, old);
  const a = T.acquireRunLock({ tier: 'smoke' });
  assert.equal(a.ok, true);
  assert.match(a.takeover, /STALE LOCK/);
  a.release();
});
await t('lock: the headed lock is a second file with the same rules', () => {
  const h = T.acquireHeadedLock({ tier: 'e2e' });
  assert.equal(path.basename(h.file), 'qaw-headed.lock');
  assert.equal(T.acquireHeadedLock({ tier: 'e2e' }).ok, false);
  h.release();
});

/* ---------------- two runners ---------------- */
const fx = path.join(root, 'fx', 'extension');
fs.mkdirSync(path.join(fx, 'tools'), { recursive: true });
fs.writeFileSync(path.join(fx, 'package.json'), '{"type":"module"}');
fs.writeFileSync(path.join(fx, 'manifest.json'), '{"version":"1.0.0"}');
fs.writeFileSync(path.join(fx, 'tools', 'test-hold.mjs'), "setTimeout(()=>console.log('  ok  held'),5000);");
fs.writeFileSync(path.join(fx, 'tools', 'test-quick.mjs'), "console.log('  ok  quick');");
fs.writeFileSync(path.join(fx, 'tools', 'test-hang.mjs'), [
  "import { spawn } from 'node:child_process';import fs from 'node:fs';",
  "const g = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 120000)'], { stdio: 'ignore' });",
  "fs.writeFileSync('grandchild.pid', String(g.pid));",
  "setTimeout(()=>{}, 120000);",
].join('\n'));
const man = (rows) => fs.writeFileSync(path.join(fx, 'tools', 'test-manifest.json'), JSON.stringify({ version: 2, features: ['x'], suites: rows.map((r) => ({ path: `tools/${r.id}.mjs`, kind: 'test', lane: 'node', features: ['x'], tags: [], timeout: null, ...r })) }));
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: root, TMP: root, TMPDIR: root, PYTHONUTF8: '1', LOCALAPPDATA: process.env.LOCALAPPDATA };
const pipe = (args) => [PIPE, ...args, '--ext', fx, '--runs-root', path.join(root, 'runs')];

await t('two runners: the second exits 3 and names the owner (pid, tier); the first still finishes green; the lock is gone afterwards', async () => {
  man([{ id: 'test-hold' }, { id: 'test-quick' }]);
  let out1 = '';
  const first = spawn(process.execPath, pipe(['--only', 'test-hold']), { cwd: EXT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  first.stdout.on('data', (d) => { out1 += d; });
  const lockFile = T.lockPath('qaw-pipeline.lock');
  assert.ok(await waitFor(() => fs.existsSync(lockFile)), 'the first runner never took the lock');
  const second = spawnSync(process.execPath, pipe(['--only', 'test-quick']), { cwd: EXT, env, encoding: 'utf8', timeout: 60000 });
  assert.equal(second.status, 3, second.stdout + second.stderr);
  assert.match(second.stdout, new RegExp(`REFUSED: qaw-pipeline\\.lock is held by pid ${first.pid} \\(tier only test-hold`));
  const code = await new Promise((r) => first.on('close', r));
  assert.equal(code, 0, out1);
  assert.ok(!fs.existsSync(lockFile), 'the finished runner released the lock');
  assert.ok(!fs.existsSync(path.join(root, 'runs', 'latest', 'run.json')) || !/test-quick/.test(fs.readFileSync(path.join(root, 'runs', 'latest', 'run.json'), 'utf8')), 'the refused runner ran nothing');
});

/* ---------------- tracked spawn and tree kill ---------------- */
await t('spawnTracked: argv array, no shell, pid recorded at once, output captured, exit code returned', async () => {
  const track = [];
  const pidLog = path.join(root, 'pids.jsonl');
  const r = await T.spawnTracked(process.execPath, ['-e', "console.log('a b'); console.error('err'); process.exit(3)"], { cwd: root, env: { PATH: process.env.PATH }, track, pidLog, id: 'x' });
  assert.equal(r.exitCode, 3);
  assert.match(r.output, /a b/);
  assert.match(r.output, /err/);
  assert.equal(track[0].pid, r.pid);
  assert.equal(JSON.parse(fs.readFileSync(pidLog, 'utf8').trim().split('\n')[0]).pid, r.pid);
  const meta = await T.spawnTracked(process.execPath, ['-e', "console.log(process.argv.length)", '&& echo injected', '|', 'x'], { cwd: root, env: { PATH: process.env.PATH } });
  assert.equal(meta.output.trim(), '4', 'shell metacharacters stay arguments');
});
await t('timeout: the hung suite and its grandchild die by recorded pid; a foreign node and a foreign browser stand-in survive; leftovers: 0', async () => {
  man([{ id: 'test-hang', timeout: 2 }]);
  const other1 = foreign();
  const other2 = foreign();
  const r = spawnSync(process.execPath, pipe(['--only', 'test-hang']), { cwd: EXT, env, encoding: 'utf8', timeout: 90000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /timed out after 2s/);
  const gpid = Number(fs.readFileSync(path.join(fx, 'grandchild.pid'), 'utf8'));
  assert.ok(gpid > 0);
  assert.ok(await waitFor(() => !T.isAlive(gpid), 8000), 'the grandchild survived the timeout');
  assert.ok(T.isAlive(other1.pid) && T.isAlive(other2.pid), 'a process this run did not start was killed');
  const j = JSON.parse(fs.readFileSync(path.join(root, 'runs', 'latest', 'run.json'), 'utf8'));
  assert.equal(j.suites[0].timedOut, true);
  assert.equal(j.leftovers, 0);
  assert.match(fs.readFileSync(path.join(root, 'runs', 'latest', 'leftovers.txt'), 'utf8'), /^leftovers: 0/);
});
await t('finalTeardown: a still-running pid this run recorded is killed by pid and counted; a foreign pid is never touched', async () => {
  const mine = foreign();
  const other = foreign();
  const td = T.finalTeardown({ tracked: [{ pid: mine.pid, id: 'x' }], runId: 'none', runDir: root, sandbox: null });
  assert.deepEqual(td.killed, [mine.pid]);
  assert.match(td.text, /^leftovers: 1/);
  assert.match(td.text, /killed at teardown \(started by this run\)/);
  assert.ok(await waitFor(() => !T.isAlive(mine.pid), 5000));
  assert.ok(T.isAlive(other.pid));
  assert.equal(T.killTree(0), false);
  assert.equal(T.killTree(process.pid), false, 'never its own pid');
});

/* ---------------- no kill by name ---------------- */
await t('source grep: no runner file selects a process by image name or kills with a bare signal call on a name', () => {
  const forbidden = [['taskkill', '/IM'].join(' '), ['Stop-Process', '-Name'].join(' '), ['pk', 'ill'].join(''), ['kill', 'all'].join(''), ['/', 'IM '].join(''), ['Get-Process', ' -Name'].join('')];
  const files = ['pipeline.mjs', 'lib-teardown.mjs', 'lib-sched.mjs', 'lib-preflight.mjs', 'lib-report.mjs', 'lib-router.mjs', 'lib-verdict.mjs'];
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const bad of forbidden) if (src.includes(bad)) hits.push(`${f}: ${bad}`);
    if (/child\.kill\(\s*['"]SIGKILL['"]\s*\)/.test(src)) hits.push(`${f}: child.kill('SIGKILL') orphans Chromium`);
    if (/shell:\s*true/.test(src)) hits.push(`${f}: shell:true`);
  }
  assert.deepEqual(hits, []);
});

for (const pid of started) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
process.env.TEMP = ORIG_TEMP[0]; process.env.TMP = ORIG_TEMP[1]; if (ORIG_TEMP[2] === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = ORIG_TEMP[2];
recycle(root);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
