/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Canary: does a green suite still catch the bug it was written for? (test pipeline lane P6, spec 2.9)
 *
 *   node tools/canary.mjs                   run every seed
 *   node tools/canary.mjs --only D1-idle-files-ticket,R3-altgr   run named seeds
 *   node tools/canary.mjs --stale-only      check every `find` string still occurs exactly once; run no suite
 *   node tools/canary.mjs --list            list the seeds
 *   node tools/canary.mjs --out result.json write { total, killed, survivors[], stale[], controlRed[] } (the run.json `canary` field)
 *   node tools/canary.mjs --source <dir>    the extension tree to copy (default: this one); --keep leaves the copy
 *
 * Each seed in tools/canary-mutations.json flips ONE shipped guard (one literal find-and-replace) in a TEMP COPY of the
 * extension tree - the real tree is never written - and names the suites that must then go red. Steps:
 *   1. copy the tree to a temp directory (node_modules is linked in, not copied; `alsoCopy` repo paths that suites read
 *      through `../` are copied beside it);
 *   2. control: every named suite runs once on the unmutated copy and must be green (a suite that is red or skipped
 *      before the flip proves nothing; that seed is reported CONTROL RED, not killed);
 *   3. per seed: `find` must occur exactly once in `file` (else "canary stale": edit that one JSON line, no --accept-gate
 *      needed), the flip is applied, the named suites run, and each must exit non-zero with 1 (exit 2 = skipped, which
 *      is not red). A seed may carry `failMatch` (a regexp the red output must contain, so an unrelated red cannot count)
 *      and `earlyKill` (stop the suite at the first matching line; used where the second half of a suite would open a
 *      headed browser). The flip is always reverted before the next seed.
 *   4. prints `CANARY k/n killed` and, for every survivor, which suite did not notice and the bug class it missed.
 *
 * Exit: 0 all killed, 1 a survivor, a stale find or a red control, 2 the copy could not be made.
 * LF line endings; Node only; no network; the temp copy goes to the recycle bin with safe-delete.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recycle } from './lib-trash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const SOURCE = path.resolve(arg('--source') || path.join(HERE, '..'));
const MUTATIONS_FILE = path.join(HERE, 'canary-mutations.json');
const SUITE_TIMEOUT_MS = Number(process.env.QAW_CANARY_TIMEOUT_MS) || 180_000;

const spec = JSON.parse(fs.readFileSync(MUTATIONS_FILE, 'utf8'));
let seeds = spec.mutations;
if (!Array.isArray(seeds) || !seeds.length) { console.log('FAIL canary-mutations.json has no mutations'); process.exit(1); }
const only = arg('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
if (only) {
  const missing = only.filter((id) => !seeds.some((m) => m.id === id));
  if (missing.length) { console.log(`FAIL unknown seed id(s): ${missing.join(', ')}`); process.exit(1); }
  seeds = seeds.filter((m) => only.includes(m.id));
}
if (flag('--list')) { for (const m of seeds) console.log(`${m.id}\t${m.file}\t${m.mustFail.join(',')}\t${m.bugClass}`); process.exit(0); }

const count = (text, find) => (find ? text.split(find).length - 1 : 0);

/** Stale check on the source tree itself: every `find` occurs exactly once in its file. Returns the stale messages. */
function staleIn(root) {
  const out = [];
  for (const m of seeds) {
    const file = path.join(root, m.file);
    if (!fs.existsSync(file)) { out.push({ id: m.id, why: `file ${m.file} does not exist` }); continue; }
    const n = count(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), m.find);
    if (n !== 1) out.push({ id: m.id, why: `find string occurs ${n} times in ${m.file} (must be exactly 1)` });
  }
  return out;
}

if (flag('--stale-only')) {
  const stale = staleIn(SOURCE);
  for (const s of stale) console.log(`FAIL canary stale ${s.id}: ${s.why}; edit that one line in tools/canary-mutations.json`);
  console.log(stale.length ? `CANARY stale ${stale.length}/${seeds.length}` : `CANARY ${seeds.length} seeds, every find string occurs exactly once`);
  process.exit(stale.length ? 1 : 0);
}

/* ── 1. the temp copy ─────────────────────────────────────────────────────────────────────────────────────────── */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'test-results', 'coverage']);
const WORK = fs.mkdtempSync(path.join(process.env.QAW_CANARY_DIR || os.tmpdir(), 'qaw-canary-'));
const COPY = path.join(WORK, 'extension');
let linked = false;

function cleanup() {
  if (flag('--keep')) { console.log(`kept: ${WORK}`); return; }
  try { if (linked) fs.rmdirSync(path.join(COPY, 'node_modules')); } catch (e) { console.log(`leftover: junction ${path.join(COPY, 'node_modules')} (${e.message})`); return; }
  if (!recycle(WORK).ok) console.log(`leftover: ${WORK}`);
}
process.on('exit', () => { try { cleanup(); } catch { /* best effort */ } });

try {
  fs.cpSync(SOURCE, COPY, { recursive: true, filter: (src) => !SKIP_DIRS.has(path.basename(src)) });
  for (const rel of spec.alsoCopy || []) {
    const from = path.join(SOURCE, '..', rel);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(WORK, rel), { recursive: true });
  }
  const nm = path.join(SOURCE, 'node_modules');
  if (fs.existsSync(nm)) { fs.symlinkSync(nm, path.join(COPY, 'node_modules'), 'junction'); linked = true; }
} catch (e) {
  console.log(`FAIL could not make the temp copy: ${e.message}`);
  process.exit(2);
}
console.log(`copy: ${COPY}`);

/* ── 2. running a suite ───────────────────────────────────────────────────────────────────────────────────────── */
function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
}

/** Run tools/<suite>.mjs inside the copy. Resolves { code, output, ms, matched, timedOut }. */
function runSuite(suite, { failMatch, earlyKill } = {}) {
  return new Promise((resolve) => {
    const file = path.join(COPY, 'tools', `${suite}.mjs`);
    if (!fs.existsSync(file)) { resolve({ code: 127, output: `no such suite: tools/${suite}.mjs`, ms: 0, matched: false, timedOut: false }); return; }
    const t0 = Date.now();
    const child = spawn(process.execPath, [file], { cwd: COPY, env: { ...process.env, PYTHONUTF8: '1', QAW_CANARY: '1' }, shell: false, windowsHide: true });
    let output = '';
    let matched = false;
    let timedOut = false;
    const re = failMatch ? new RegExp(failMatch) : null;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, SUITE_TIMEOUT_MS);
    const take = (d) => {
      output += d;
      if (re && !matched && re.test(output)) { matched = true; if (earlyKill) killTree(child); }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? 124 : code, output, ms: Date.now() - t0, matched, timedOut }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 126, output: String(e.message), ms: Date.now() - t0, matched, timedOut }); });
  });
}
const tail = (o) => o.trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 220);

/* ── 3. controls, then the seeds ──────────────────────────────────────────────────────────────────────────────── */
const result = { total: seeds.length, killed: 0, survivors: [], stale: [], controlRed: [] };
const stale = staleIn(COPY);
const staleIds = new Set(stale.map((s) => s.id));
for (const s of stale) { console.log(`FAIL canary stale ${s.id}: ${s.why}; edit that one line in tools/canary-mutations.json`); result.stale.push(s.id); }

const controlled = new Map();
for (const m of seeds) {
  if (staleIds.has(m.id) || m.control === false) continue;
  for (const suite of m.mustFail) {
    if (controlled.has(suite)) continue;
    const r = await runSuite(suite);
    controlled.set(suite, r);
    console.log(`control ${suite}: exit ${r.code} in ${(r.ms / 1000).toFixed(1)}s`);
  }
}

for (const m of seeds) {
  if (staleIds.has(m.id)) continue;
  const bad = m.control === false ? [] : m.mustFail.filter((s) => controlled.get(s)?.code !== 0);
  if (bad.length) {
    console.log(`CONTROL RED ${m.id}: ${bad.join(', ')} is not green on the unmutated copy (${bad.map((s) => tail(controlled.get(s).output)).join(' / ')}); the seed proves nothing`);
    result.controlRed.push(m.id);
    continue;
  }
  const file = path.join(COPY, m.file);
  const original = fs.readFileSync(file, 'utf8');
  const crlf = original.includes('\r\n');
  const text = original.replace(/\r\n/g, '\n');
  if (count(text, m.find) !== 1) { console.log(`FAIL canary stale ${m.id}: find string occurs ${count(text, m.find)} times in ${m.file}`); result.stale.push(m.id); continue; }
  const mutated = text.replace(m.find, () => m.replace);
  fs.writeFileSync(file, crlf ? mutated.replace(/\n/g, '\r\n') : mutated);
  let runs;
  try {
    runs = await Promise.all(m.mustFail.map(async (suite) => [suite, await runSuite(suite, { failMatch: m.failMatch, earlyKill: m.earlyKill })]));
  } finally {
    fs.writeFileSync(file, original);
  }
  const alive = runs.filter(([, r]) => !(r.matched && m.earlyKill) && (r.code === 0 || r.code === 2 || r.code === 126 || r.code === 127 || r.timedOut || (m.failMatch && !r.matched)));
  const dead = runs.filter(([s]) => !alive.some(([a]) => a === s));
  for (const [suite, r] of dead) console.log(`  red   ${m.id}: ${suite} (exit ${r.code}, ${(r.ms / 1000).toFixed(1)}s)`);
  if (alive.length) {
    result.survivors.push({ id: m.id, suites: alive.map(([s]) => s), bugClass: m.bugClass });
    for (const [suite, r] of alive) console.log(`SURVIVED ${m.id}: ${suite} ${r.code === 2 ? 'skipped (exit 2)' : r.timedOut ? 'timed out' : r.code >= 126 && r.code <= 127 ? 'could not run' : r.code === 0 ? 'stayed green' : `went red without ${m.failMatch}`} after the flip; missing test for ${m.bugClass} (${tail(r.output)})`);
  } else result.killed++;
}

console.log(`CANARY ${result.killed}/${result.total} killed${result.survivors.length ? `; survivors: ${result.survivors.map((s) => s.id).join(', ')}` : ''}${result.stale.length ? `; stale: ${result.stale.join(', ')}` : ''}${result.controlRed.length ? `; control red: ${result.controlRed.join(', ')}` : ''}`);
const outFile = arg('--out');
if (outFile) fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.killed === result.total ? 0 : 1;
