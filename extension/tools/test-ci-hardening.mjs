/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-039: the CI workflow stays hardened. Fails when an action goes back to a
 * movable tag, the token loses its read-only scope, install runs package
 * scripts, concurrency is dropped, or dependabot comes back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');
let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

/** Every `uses:` line that is not a local path, as [line, ref]. */
export function unpinned(yml) {
  return yml.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^-?\s*uses:/.test(l) && !/uses:\s*\.\//.test(l))
    .filter((l) => !/@[0-9a-f]{40}(\s|$)/.test(l));
}

const ci = read('.github/workflows/ci.yml');
test('the pin check catches a tag-pinned action', () => {
  must(unpinned('      - uses: actions/checkout@v4').length === 1, 'a tag pin was not flagged');
  must(unpinned('      - uses: actions/checkout@' + 'a'.repeat(40) + ' # v4').length === 0, 'a SHA pin was flagged');
});
test('every action is pinned by a 40-character commit SHA', () => { const u = unpinned(ci); must(!u.length, `movable refs: ${u.join(' | ')}`); });
test('permissions are read-only at the top level', () => must(/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(ci), 'no top-level `permissions: contents: read`'));
test('npm ci runs with --ignore-scripts', () => must(/npm ci --ignore-scripts/.test(ci) && !/npm ci\s*$/m.test(ci), 'npm ci may run install scripts'));
test('test-glyphs has its uv on ubuntu-latest (completion review 8)', () => must(/pipx install uv|astral-sh\/setup-uv/.test(ci), 'ci.yml installs no uv, and tools/test-glyphs.mjs spawns it'));
test('package.json says which Node the portable zip needs (zlib.crc32, 22.2+)', () => must(JSON.parse(read('extension/package.json')).engines?.node === '>=22.2', 'no engines.node >=22.2'));
test('a newer push cancels the older run', () => must(/concurrency:[\s\S]*cancel-in-progress:\s*true/.test(ci), 'no concurrency cancel'));
test('boot smoke stays out of CI (branded Chrome, CDP)', () => must(!/smoke:boot|test-boot-smoke|test:truth/.test(ci.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')), 'a browser suite is in CI'));
// Nader turned the dependabot bot off (2026-10-22): the file must stay absent so it cannot open PRs again.
test('dependabot is off: no .github/dependabot.yml', () => must(!fs.existsSync(path.join(repo, '.github', 'dependabot.yml')), 'dependabot.yml is back'));

/* T-039: the build path has no PowerShell, and the Node suites CI runs carry no Windows-only literal. */
const EXT = path.join(repo, 'extension');
test('the build path (build-browsers.mjs, ci.yml, build and test:ci scripts) names no PowerShell or Compress-Archive', () => {
  const pkg = JSON.parse(read('extension/package.json'));
  const hay = { 'build-browsers.mjs': read('extension/tools/build-browsers.mjs'), 'ci.yml': ci,
    'scripts.build': pkg.scripts.build, 'scripts.build:all': pkg.scripts['build:all'], 'scripts.test:ci': pkg.scripts['test:ci'] };
  for (const [k, v] of Object.entries(hay)) must(!/powershell|pwsh|Compress-Archive/i.test(v), `${k} names PowerShell`);
  must(!/child_process|execFileSync/.test(hay['build-browsers.mjs']), 'build-browsers.mjs shells out again');
});
test('the Node suites test:ci runs carry no PowerShell call and no drive-letter path', () => {
  const pkg = JSON.parse(read('extension/package.json'));
  const run = read('extension/tools/run-suites.mjs') + read('extension/tools/lib-suites.mjs');
  const byHand = new Set([...run.matchAll(/'(test-[\w-]+)':\s*\{\s*byHand:\s*true/g)].map((m) => m[1]));
  const chain = [...pkg.scripts['test:chain'].matchAll(/node tools\/([\w.-]+)\.mjs/g)].map((m) => m[1]);
  const suites = chain.filter((c) => !byHand.has(c) && fs.existsSync(path.join(EXT, 'tools', c + '.mjs')));
  must(suites.length > 100, `only ${suites.length} suites found: the audit would prove nothing`);
  const drive = new RegExp('[\'"`][A-Za-z]:' + String.fromCharCode(92, 92));
  const bad = [];
  for (const c of suites) {
    const src = fs.readFileSync(path.join(EXT, 'tools', c + '.mjs'), 'utf8');
    if (/from ['"](?:@playwright\/test|playwright)['"]/.test(src)) continue;
    if (c !== 'test-ci-hardening' && /powershell|pwsh/i.test(src)) bad.push(c + ': powershell'); // this file names the word it forbids
    if (c !== 'test-support-bundle' && drive.test(src)) bad.push(c + ': drive-letter path'); // that one feeds a hostile Windows path as data
  }
  must(!bad.length, bad.join(' | '));
});

test('no js, mjs, css, html, json, md, svg or txt file under extension/ carries a CR byte (council-1010 D-148): a CRLF working copy breaks the suites that read their own text', () => {
  const exts = new Set(['.js', '.mjs', '.css', '.html', '.json', '.md', '.svg', '.txt']);
  const skip = new Set(['node_modules', 'vendor', 'dist']);
  const bad = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(full); continue; }
      if (exts.has(path.extname(e.name).toLowerCase()) && fs.readFileSync(full).includes(0x0d)) bad.push(path.relative(EXT, full).split(path.sep).join('/'));
    }
  };
  walk(EXT);
  must(!bad.length, `CR bytes in ${bad.length} file(s): ${bad.slice(0, 12).join(', ')}. Convert them to LF (strip every carriage return)`);
});

// r8-12-5: the suites that own a browser profile or a scratch copy send it to the recycle bin through tools/lib-trash.mjs,
// so none of them calls fs.rmSync itself; the helper falls back to rmSync only when trash.py is absent and says which path ran.
test('the profile-owning suites delete through lib-trash, not fs.rmSync', () => {
  const helper = read('extension/tools/lib-trash.mjs');
  must(/fs\.rmSync\(/.test(helper) && /trash\.py is absent/.test(helper), 'lib-trash.mjs lost its rmSync fallback or its message');
  const bad = [];
  for (const f of ['test-capture-live', 'test-vault-live', 'test-truth']) {
    const src = read(`extension/tools/${f}.mjs`);
    if (/\b(?:fs\.)?(?:rmSync|rmdirSync)\(|fs\.rm\(|fs\.promises\.rm\(/.test(src)) bad.push(`${f}.mjs calls rmSync`);
    if (f !== 'test-capture-live' && !/from '\.\/lib-trash\.mjs'/.test(src)) bad.push(`${f}.mjs does not import lib-trash`);
  }
  must(!bad.length, bad.join('; '));
});

console.log(`\n${failed ? 'FAILED' : 'passed'}: ${failed} failed`);
if (failed) process.exit(1);
