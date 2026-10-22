/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The tests are tested (test pipeline lane P6, spec 2.9). Node only, no browser.
 *
 *   node tools/test-test-quality.mjs
 *
 * Part 1 proves the strength helpers in lib-assert.mjs bite: nonEmpty refuses an empty list, proveTeeth refuses a guard
 * that accepts a bad input, a ceiling raise prints GATE LOOSENED and is red, a re-baseline flag is refused under npm and
 * without a reason.
 *
 * Part 2 is the light lint of the ban list, on NEW and CHANGED test files only (git status against HEAD), because old
 * suites are labelled, not rewritten:
 *   B3  a hard-coded file list in a repo-wide rule suite (a `const FILES = ['a', 'b', ...]` with no readdir)
 *   B4  a raisable numeric ceiling typed into a test file (BASELINE/CEILING constant set to a number or an object of numbers)
 *   B5  a `--write*` baseline flag reachable from an npm script (package.json)
 *   B6  `exit(0)` straight after a SKIPPED / ENV-BLOCKED line
 * Each rule first runs on a known-bad and a known-good fixture (teeth), then over the real files.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { TRASH } from './lib-trash.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assert, ok, nonEmpty, proveTeeth, finish } from './lib-assert.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const LIB = pathToFileURL(path.join(HERE, 'lib-assert.mjs')).href;

/* ── Part 1: the helpers have teeth ─────────────────────────────────────────────────────────────────────────── */
const node = (code, env = {}) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, ...env } });

{
  // nonEmpty prints a FAIL line for an empty list; that line belongs to the proof, so run it in a child and read the verdict.
  const r = node(`import { nonEmpty, finish } from ${JSON.stringify(LIB)}; try { nonEmpty([], 'x'); } catch {} finish('child');`);
  ok(r.status === 1 && /FAIL/.test(r.stdout), 'nonEmpty([]) is a counted failure (exit 1)', r.stdout);
  const t = node(`import { proveTeeth, finish } from ${JSON.stringify(LIB)}; try { proveTeeth('lax guard', () => [], 'bad'); } catch {} finish('child');`);
  ok(t.status === 1, 'proveTeeth on a guard that accepts a bad input is red', t.stdout);
  const g = node(`import { proveTeeth, finish } from ${JSON.stringify(LIB)}; proveTeeth('strict guard', (x) => (x === 'bad' ? ['problem'] : []), 'bad'); finish('child');`);
  ok(g.status === 0 && /teeth: strict guard/.test(g.stdout), 'proveTeeth on a guard that reports the bad input is green', g.stdout);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-tq-'));
  const file = path.join(dir, 'gate-baseline.json');
  const probe = `import { ceilingFromBaseline, finish } from ${JSON.stringify(LIB)}; const c = ceilingFromBaseline('types', 152, { file: ${JSON.stringify(file)} }); console.log('CEILING=' + c); finish('child');`;
  fs.writeFileSync(file, JSON.stringify({ ceilings: { types: 140 } }));
  const lower = node(probe, { QAW_ACCEPT_GATE: '' });
  ok(lower.status === 0 && /CEILING=140/.test(lower.stdout), 'a lowered ceiling in gate-baseline.json is used', lower.stdout);
  fs.writeFileSync(file, JSON.stringify({ ceilings: { types: 160 } }));
  const raised = node(probe, { QAW_ACCEPT_GATE: '' });
  ok(raised.status === 1 && /GATE LOOSENED/.test(raised.stdout), 'a raised ceiling prints GATE LOOSENED and is red', raised.stdout);
  const accepted = node(probe, { QAW_ACCEPT_GATE: 'owner accepted the new rule set' });
  ok(accepted.status === 0 && /GATE LOOSENED.*accepted/.test(accepted.stdout), 'a raised ceiling with a stated reason is shown and accepted', accepted.stdout);
  fs.writeFileSync(file, JSON.stringify({ ceilings: {} }));
  const missing = node(probe);
  ok(missing.status === 1 && /ceilings\.types/.test(missing.stdout), 'a missing ceiling group is red, never a silent built-in number', missing.stdout);
  const trash = TRASH;
  spawnSync('python', [trash, dir], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
}

{
  const guard = `import { rebaselineGuard } from ${JSON.stringify(LIB)}; rebaselineGuard('--write'); console.log('ALLOWED');`;
  const noReason = node(guard, { QAW_REBASELINE_REASON: '', npm_lifecycle_event: '' });
  ok(noReason.status === 2 && /REFUSED/.test(noReason.stdout), 'a baseline rewrite flag without a reason is refused (exit 2)', noReason.stdout);
  const underNpm = node(guard, { QAW_REBASELINE_REASON: 'because', npm_lifecycle_event: 'test' });
  ok(underNpm.status === 2 && /npm script/.test(underNpm.stdout), 'a baseline rewrite flag under npm run is refused (exit 2)', underNpm.stdout);
  const manual = node(guard, { QAW_REBASELINE_REASON: 'owner re-pinned after review', npm_lifecycle_event: '' });
  ok(manual.status === 0 && /ALLOWED/.test(manual.stdout), 'a manual run with a stated reason is allowed', manual.stdout);
}

/* ── Part 2: the lint ───────────────────────────────────────────────────────────────────────────────────────── */
/** Each rule: (source text, relative file name) -> array of problem strings. */
export const RULES = {
  B3(src) {
    if (/readdirSync|readdir\(|globSync|manifest/i.test(src)) return [];
    const m = /\bconst\s+(?:FILES|SUITES|SCANNED|TARGETS|SCRIPTS)\s*=\s*\[([^\]]*)\]/.exec(src);
    const items = m ? m[1].match(/['"][^'"]+['"]/g) || [] : [];
    return items.length >= 5 ? [`B3 hard-coded list of ${items.length} names for a repo-wide rule; read the directory or the manifest`] : [];
  },
  B4(src) {
    if (/ceilingFromBaseline|gate-baseline/.test(src)) return [];
    const out = [];
    const re = /\bconst\s+([A-Z_]*(?:BASELINE|CEILING)[A-Z_]*)\s*=\s*(\d+|\{[^}]*\d[^}]*\})/g;
    for (const m of src.matchAll(re)) out.push(`B4 raisable ceiling typed in the test file: ${m[1]}; move it to gate-baseline.json`);
    return out;
  },
  B6(src) {
    const lines = src.split('\n');
    const out = [];
    lines.forEach((l, i) => {
      if (!/(SKIPPED|ENV-BLOCKED)/.test(l) || !/console\.log|print/.test(l)) return;
      if (lines.slice(i, i + 3).some((x) => /process\.exit\(0\)/.test(x))) out.push(`B6 line ${i + 1}: exit(0) right after a SKIPPED line; exit 2 (skip protocol)`);
    });
    return out;
  },
};
/** B5 works on package.json scripts, not on a test file. */
export function b5(scripts) {
  return Object.entries(scripts || {}).filter(([, v]) => /--write(?:-baseline)?\b/.test(String(v))).map(([k]) => `B5 npm script "${k}" reaches a --write baseline flag`);
}

const BAD = {
  B3: "const FILES = ['a', 'b', 'c', 'd', 'e', 'f'];\nfor (const f of FILES) check(f);",
  B4: 'const BASELINE_COUNT = 152;',
  B6: "console.log('SKIPPED: no browser');\nprocess.exit(0);",
};
const GOOD = {
  B3: "const FILES = fs.readdirSync(dir);\nconst X = ['a','b','c','d','e','f'];",
  B4: "const BASELINE_COUNT = ceilingFromBaseline('types', 152);",
  B6: "console.log('SKIPPED: no browser');\nprocess.exit(2);",
};
for (const k of Object.keys(RULES)) {
  proveTeeth(`lint ${k}`, (src) => RULES[k](src), BAD[k]);
  ok(RULES[k](GOOD[k]).length === 0, `lint ${k} accepts the known-good fixture`);
}
proveTeeth('lint B5', (s) => b5(s), { 'test:x': 'node tools/test-copy-truth.mjs --write-baseline' });
ok(b5({ test: 'node tools/run-suites.mjs --node-only --ci', 'smoke:boot': 'node tools/test-boot-smoke.mjs' }).length === 0, 'lint B5 accepts scripts without a --write flag');

/** Test files that are new or changed against HEAD. */
function changedTests() {
  let out = '';
  try {
    out = execFileSync('git', ['status', '--porcelain=v1', '-uall', '--', 'tools'], { cwd: EXT, encoding: 'utf8' });
  } catch (e) {
    console.log(`  --  git status unavailable (${String(e.message).split('\n')[0]}); the lint of changed files is skipped here`);
    return null;
  }
  return out.split('\n').map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).filter((f) => /(^|\/)test-[^/]+\.mjs$/.test(f))
    .map((f) => path.basename(f)).filter((f) => f !== 'test-test-quality.mjs' /* its fixtures contain the bad patterns on purpose */ && fs.existsSync(path.join(HERE, f)));
}

const files = changedTests();
if (files) {
  const problems = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8').replace(/\r\n/g, '\n');
    for (const [k, rule] of Object.entries(RULES)) for (const p of rule(src)) problems.push(`${f}: ${p}`);
  }
  for (const p of problems) console.log(`  LINT ${p}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(EXT, 'package.json'), 'utf8'));
  const b5hits = b5(pkg.scripts);
  for (const p of b5hits) console.log(`  LINT package.json: ${p}`);
  ok(problems.length + b5hits.length === 0, `${files.length} new or changed test file(s) and the npm scripts pass the ban-list lint`);
  console.log(`  (linted: ${files.join(', ') || 'none'})`);
} else assert.ok(nonEmpty([RULES], 'lint rules').B3);

finish('test-test-quality');
