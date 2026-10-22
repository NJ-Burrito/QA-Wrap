/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Writes dist/RELEASE-<version>.json: the record that joins the tree to the zip (T-005).
 *
 *   node tools/release-record.mjs [--no-suites]
 *
 * Commit, SHA-256 of every zip of this version, hashes of the shipped components (axe, the font
 * stylesheet), the build-only devDependencies, Node and Playwright versions, the run-suites tally
 * and the test-independent result. `--no-suites` skips those two runs (null in the record).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIST } from './lib-paths.mjs';
import { sha256 } from './lib-release-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const lastLine = (out, re) => out.split(/\r?\n/).reverse().find((l) => re.test(l)) || null;

export function buildRecord({ ext = EXT, dist = DIST, suites = true } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ext, 'package.json'), 'utf8'));
  const v = manifest.version;
  const zips = fs.readdirSync(dist).filter((n) => n.startsWith(`qa-wrap-${v}`) && n.endsWith('.zip')).sort()
    .map((n) => ({ file: n, bytes: fs.statSync(path.join(dist, n)).size, sha256: sha256(fs.readFileSync(path.join(dist, n))) }));
  const run = (script, ...a) => {
    const r = spawnSync(process.execPath, [path.join(ext, 'tools', script), ...a], { cwd: ext, encoding: 'utf8' });
    return { exit: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  let runSuites = null;
  let independent = null;
  if (suites) {
    const rs = run('run-suites.mjs', '--node-only', '--ci');
    runSuites = { exit: rs.exit, summary: lastLine(rs.out, /^run-suites:/), total: lastLine(rs.out, /^TOTAL:/) };
    const ti = run('test-independent.mjs');
    independent = { exit: ti.exit, last: ti.out.trim().split(/\r?\n/).pop() };
  }
  return {
    version: v,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ext, encoding: 'utf8' }).trim(),
    generatedAt: new Date().toISOString(),
    zips,
    shippedComponents: {
      'vendor/axe.min.js': sha256(fs.readFileSync(path.join(ext, 'vendor', 'axe.min.js'))),
      'ui/fonts.css': sha256(fs.readFileSync(path.join(ext, 'ui', 'fonts.css'))),
    },
    buildOnly: { note: 'devDependencies are build and test tools; none of them ships', devDependencies: pkg.devDependencies },
    node: process.version,
    playwright: JSON.parse(fs.readFileSync(path.join(ext, 'node_modules', 'playwright', 'package.json'), 'utf8')).version,
    runSuites,
    testIndependent: independent,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rec = buildRecord({ suites: !process.argv.includes('--no-suites') });
  const out = path.join(DIST, `RELEASE-${rec.version}.json`);
  fs.writeFileSync(out, JSON.stringify(rec, null, 2) + '\n');
  console.log(`wrote ${out} (${rec.zips.length} zip hash(es), commit ${rec.commit.slice(0, 7)})`);
}
