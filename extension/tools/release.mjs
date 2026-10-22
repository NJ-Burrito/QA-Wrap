/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * `npm run release [-- --flavour managed]` (T-069).
 *
 * Default: build Chrome and Edge, package, gate, record, boot-smoke (the chain this file replaced in package.json).
 * `--flavour managed`: the same tree built once more without `debugger`, for a named organisation whose policy blocks
 * that permission — never a store listing. It adds a second manifest-check, release-check and boot-smoke pass on
 * dist/chrome-managed, and the record (`release-record.mjs`) then carries the second zip's hash line.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIST } from './lib-paths.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The ordered steps as argv arrays, so a test can read the plan without running it. */
export function plan(flavour) {
  const node = (...a) => ['node', ...a];
  const steps = [
    node('tools/build-browsers.mjs', 'chrome'),
    node('tools/build-browsers.mjs', 'edge'),
    node('tools/package.mjs'),
  ];
  if (flavour === 'managed') steps.push(node('tools/build-browsers.mjs', '--flavour', 'managed'));
  steps.push(node('tools/release-check.mjs'));
  if (flavour === 'managed') steps.push(node('tools/release-check.mjs', '--flavour', 'managed'));
  steps.push(node('tools/release-record.mjs'));
  steps.push(node('tools/test-boot-smoke.mjs', '--ext', path.join(DIST, 'chrome'), '--no-click'));
  if (flavour === 'managed') {
    steps.push(node('tools/manifest-check.mjs', '--ext', path.join(DIST, 'chrome-managed')));
    steps.push(node('tools/test-boot-smoke.mjs', '--ext', path.join(DIST, 'chrome-managed'), '--no-click'));
  }
  return steps;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--flavour');
  const flavour = i >= 0 ? a[i + 1] : null;
  if (flavour && flavour !== 'managed') { console.error(`Unknown flavour "${flavour}". Only: managed`); process.exit(1); }
  for (const [cmd, ...args] of plan(flavour)) {
    console.log(`\n> ${cmd} ${args.join(' ')}`);
    const r = spawnSync(process.execPath, args, { cwd: EXT, stdio: 'inherit' });
    if (r.status !== 0) { console.error(`release stopped: ${args[0]} exited ${r.status}`); process.exit(r.status || 1); }
  }
}
