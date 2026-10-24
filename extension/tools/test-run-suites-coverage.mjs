/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** T-004: run-suites goes red on a tools/test-*.mjs that is in neither the chain nor QUARANTINE.  node tools/test-run-suites-coverage.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const RUNNER = path.resolve('tools/run-suites.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-cov-'));
fs.mkdirSync(path.join(dir, 'tools'));
fs.writeFileSync(path.join(dir, 'tools', 'test-a.mjs'), 'console.log("ok");\n');
const chain = (suites) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: suites.map((s) => `node tools/${s}.mjs`).join(' && ') } }));
const run = (...a) => spawnSync(process.execPath, [RUNNER, '--ext', dir, ...a], { encoding: 'utf8' });

chain(['test-a']);
assert.equal(run('--coverage').status, 0, 'a complete chain passes');
fs.writeFileSync(path.join(dir, 'tools', 'test-x.mjs'), 'console.log("ok");\n');
const bad = run('--coverage');
assert.equal(bad.status, 1, 'an orphan suite file makes the gate red');
assert.match(bad.stderr, /test-x\.mjs is in neither/);
assert.equal(run('--node-only', '--ci').status, 1, 'npm run test:ci is red too');
chain(['test-a', 'test-x']);
assert.equal(run('--coverage').status, 0, 'wiring the orphan clears it');
// Fault 5 (Now-review): a by-hand headed-browser suite is listed, never run, outside --by-hand; the count is asserted.
fs.writeFileSync(path.join(dir, 'tools', 'test-boot-smoke.mjs'), 'console.log("headed");');
const skip = run('--coverage');
assert.equal(skip.status, 0);
assert.match(skip.stdout, /by hand .*test-boot-smoke/, 'a plain run names the by-hand suite and skips it');
assert.doesNotMatch(run('--coverage', '--by-hand').stdout, /by hand \(/, '--by-hand includes it');
// D-1010-114: a suite that imports lib-launch (a visible Chrome) with no byHand or LOCKED entry cannot slip into a plain run.
fs.writeFileSync(path.join(dir, 'tools', 'test-headed-new.mjs'), ["import { launchOptions } from './lib-" + "launch.mjs';", 'console.log(typeof launchOptions);', ''].join('\n'));
chain(['test-a', 'test-x', 'test-headed-new']);
const headedNew = run('--coverage');
assert.equal(headedNew.status, 1, 'an unlisted headed suite makes the gate red: ' + headedNew.stdout + headedNew.stderr);
assert.match(headedNew.stderr, /test-headed-new\.mjs launches a headed Chrome/, 'and names the file');
assert.equal(run('--node-only', '--ci').status, 1, 'npm run test:ci is red too');
// r10-12-2: a raw headless-off launch flag (no lib-launch import) is caught too, and the headed command-line switch with it.
fs.writeFileSync(path.join(dir, 'tools', 'test-headed-new.mjs'), 'launch({ headless: ' + 'false });\n');
const rawHeaded = run('--coverage');
assert.equal(rawHeaded.status, 1, 'a raw headed launch flag with no byHand entry is red: ' + rawHeaded.stdout + rawHeaded.stderr);
assert.match(rawHeaded.stderr, /test-headed-new\.mjs sets headless/, 'and names the file');
fs.writeFileSync(path.join(dir, 'tools', 'test-headed-new.mjs'), "process.argv.includes('--" + "headed');\n");
assert.equal(run('--coverage').status, 1, 'the headed command-line switch is red too');
fs.writeFileSync(path.join(dir, 'tools', 'test-headed-new.mjs'), "import { launchOptions } from './lib-" + "launch.mjs';\nconsole.log(typeof launchOptions);\n");
fs.renameSync(path.join(dir, 'tools', 'test-headed-new.mjs'), path.join(dir, 'tools', 'test-gif.mjs')); // a LOCKED_SUITES name
chain(['test-a', 'test-x', 'test-gif']);
assert.equal(run('--coverage').status, 0, 'a LOCKED suite that imports lib-launch passes');
fs.renameSync(path.join(dir, 'tools', 'test-gif.mjs'), path.join(dir, 'tools', 'test-capture-live.mjs')); // a byHand name
chain(['test-a', 'test-x', 'test-capture-live']);
assert.equal(run('--coverage').status, 0, 'a byHand suite that imports lib-launch passes');
assert.match(run('--coverage').stdout, /by hand .*test-capture-live/, 'a plain run names it and skips it');
assert.doesNotMatch(run('--coverage', '--by-hand').stdout, /by hand \(/, '--by-hand includes it');
fs.rmSync(path.join(dir, 'tools', 'test-capture-live.mjs'));
chain(['test-a', 'test-x']);

// 12-1 (T-031): a listed known-red suite may be red; a second red, a listed suite gone green, or an expired entry is exit 1.
fs.rmSync(path.join(dir, 'tools', 'test-boot-smoke.mjs'));
const KR = 'test-listing-assets';
const writeSuite = (name, code) => fs.writeFileSync(path.join(dir, 'tools', name + '.mjs'), code);
const RED = 'console.log("FAIL boom"); process.exit(1);';
const KR_RED = 'console.log("the listing images are stale: ui/ changed"); process.exit(1);'; // the one failure T-031 names
writeSuite(KR, KR_RED);
chain(['test-a', 'test-x', KR]);
// r10-12-5: the real KNOWN_RED list is empty (T-031 removed); the fixture entry below stands in for it, through the --ext-only test hook.
const T031 = JSON.stringify({ 'test-listing-assets': { id: 'T-031', until: '2026-10-23', match: 'the listing images are stale', reason: 'fixture' } });
const ci = (env = {}, ...a) => spawnSync(process.execPath, [RUNNER, '--ext', dir, '--node-only', '--ci', ...a], { encoding: 'utf8', env: { ...process.env, QAW_KNOWN_RED_FIXTURE: T031, QAW_TODAY: '2026-10-01', ...env } });
assert.ok(!/'test-listing-assets':\s*\{/.test(fs.readFileSync(RUNNER, 'utf8')), 'r10-12-5: no T-031 entry in the real KNOWN_RED');
assert.equal(spawnSync(process.execPath, [RUNNER, '--coverage'], { encoding: 'utf8', env: { ...process.env, QAW_KNOWN_RED_FIXTURE: T031 } }).status, 0, 'the fixture hook is ignored without --ext');
const known = ci();
assert.equal(known.status, 0, 'a known-red suite alone: exit 0 ' + known.stdout + known.stderr);
assert.match(known.stdout, /test-listing-assets \.\.\. KNOWN-RED/, 'its red is still printed');
assert.match(known.stdout, /known red \(red on purpose, until 2026-10-23\): test-listing-assets/, 'and named in the tally');
writeSuite('test-x', RED);
assert.equal(ci().status, 1, 'a second, unlisted red: exit 1');
writeSuite('test-x', 'console.log("ok");');
writeSuite(KR, 'console.log("ok");');
const stale = ci();
assert.equal(stale.status, 1, 'a listed suite that went green: exit 1');
assert.match(stale.stdout, /STALE KNOWN-RED: test-listing-assets/);
writeSuite(KR, KR_RED);
const late = ci({ QAW_TODAY: '2026-11-01' });
assert.equal(late.status, 1, 'an expired known-red entry: exit 1');
assert.match(late.stderr, /known-red entry \(T-031\) expired 2026-10-23/);

// r2-12-1: the known-red entry covers only the failure it names. The same suite red with other text is a plain FAIL.
writeSuite(KR, 'console.log("TypeError: x is not a function"); process.exit(1);');
const other = ci();
assert.equal(other.status, 1, 'a known-red suite failing for a different reason: exit 1');
assert.match(other.stdout, /test-listing-assets \.\.\. FAIL/, 'and it is printed FAIL, not KNOWN-RED');
assert.doesNotMatch(other.stdout, /test-listing-assets \.\.\. KNOWN-RED/);
writeSuite(KR, KR_RED);

// r2-12-2: a hung known-red suite is a FAIL: exit 124 is never excused by the list.
writeSuite(KR, 'console.log("the listing images are stale"); setInterval(() => {}, 1000);');
const hungKr = ci({}, '--suite-timeout', '2');
assert.equal(hungKr.status, 1, 'a hung listed suite: exit 1, ' + hungKr.stdout);
assert.match(hungKr.stdout, /test-listing-assets \.\.\. FAIL \(exit 124/, 'printed FAIL with exit 124 even though its text matches');
assert.doesNotMatch(hungKr.stdout, /test-listing-assets \.\.\. KNOWN-RED/);
writeSuite(KR, KR_RED);

// 12-4: a hung suite is killed and named, inside the timeout plus a margin.
writeSuite('test-hang', 'setInterval(() => {}, 1000);');
chain(['test-a', 'test-x', KR, 'test-hang']);
const t0 = Date.now();
const hung = ci({}, '--suite-timeout', '2');
assert.equal(hung.status, 1, 'a hung suite makes the run red');
assert.ok(Date.now() - t0 < 5000 + 1500, 'and within about 5 s: ' + (Date.now() - t0) + ' ms'); // 1.5 s: process start-up of the runner and the other suites
assert.match(hung.stdout, /test-hang timed out after 2s/, 'the timeout is named');
assert.match(hung.stdout, /test-hang \.\.\. FAIL \(exit 124/);
assert.throws(() => { throw new Error(run('--suite-timeout', '0').stderr); }, /needs seconds/, 'a zero timeout is refused');

// 12-3: --node-only names the browser suites it skips, and does not run them.
writeSuite('test-hang', 'console.log("ok");');
writeSuite('test-browsy', "import { chromium } from 'play" + "wright';\nconsole.log('would launch');\nprocess.exit(1);");
chain(['test-a', 'test-x', KR, 'test-hang', 'test-browsy']);
const nodeOnly = ci();
assert.equal(nodeOnly.status, 0, 'the browser suite was not run (it would exit 1) ' + nodeOnly.stdout);
assert.match(nodeOnly.stdout, /skipped \(--node-only\): 1: test-browsy/, 'the skipped browser suite is named');
assert.doesNotMatch(nodeOnly.stdout, /\] test-browsy \.\.\./);
// r3-12-2: a partial record run without --out is refused before anything runs or is written; with --out it writes only that file.
const partial = run('--node-only');
assert.equal(partial.status, 2, 'a --node-only record without --out is refused: ' + partial.stdout + partial.stderr);
assert.match(partial.stderr, /refusing to write the default baseline/);
assert.equal(run('--only', 'test-a').status, 2, 'so is --only');
const partialOut = path.join(dir, 'partial.json');
assert.equal(run('--only', 'test-a', '--out', partialOut).status, 0, 'with --out it runs');
assert.deepEqual(JSON.parse(fs.readFileSync(partialOut, 'utf8')).suites.map((x) => x.suite), ['test-a'], 'and writes only the file named');
// D-1010-63: the SKIPPED count is printed beside PASS; with --by-hand a skipped toolbar press (test-boot-smoke) is a FAIL.
writeSuite('test-boot-smoke', 'console.log("11 passed, 0 failed, 1 SKIPPED (toolbar press not proven)");');
writeSuite('test-a', 'console.log("3 passed, 2 SKIPPED");');
chain(['test-a', 'test-x', KR, 'test-hang', 'test-browsy', 'test-boot-smoke']);
const skippedPlain = spawnSync(process.execPath, [RUNNER, '--ext', dir, '--only', 'test-a', '--out', path.join(dir, 's1.json')], { encoding: 'utf8' });
assert.match(skippedPlain.stdout, /test-a \.\.\. PASS, 2 SKIPPED/, 'the skip count is shown beside PASS: ' + skippedPlain.stdout);
assert.equal(skippedPlain.status, 0, 'outside the release gate a skip stays green');
const skippedGate = spawnSync(process.execPath, [RUNNER, '--ext', dir, '--by-hand', '--only', 'test-boot-smoke', '--out', path.join(dir, 's2.json')], { encoding: 'utf8' });
assert.match(skippedGate.stdout, /test-boot-smoke \.\.\. FAIL, 1 SKIPPED/, 'the release gate prints FAIL: ' + skippedGate.stdout);
assert.equal(skippedGate.status, 1, 'and exits 1');
// D-1010-166: under --by-hand a byHand QUARANTINE suite that exits non-zero is FAIL (exit 1); a green one exits 0; a plain run never runs it.
writeSuite('test-capture-live', 'console.log("1 failed"); process.exit(1);');
const byHandRed = spawnSync(process.execPath, [RUNNER, '--ext', dir, '--by-hand', '--only', 'test-capture-live', '--out', path.join(dir, 's3.json')], { encoding: 'utf8' });
assert.match(byHandRed.stdout, /test-capture-live \.\.\. FAIL/, 'a red byHand suite prints FAIL under --by-hand: ' + byHandRed.stdout);
assert.equal(byHandRed.status, 1, 'and --by-hand exits 1');
assert.doesNotMatch(byHandRed.stdout, /QUARANTINED/, 'it is not counted as quarantined');
writeSuite('test-capture-live', 'console.log("ok");');
const byHandGreen = spawnSync(process.execPath, [RUNNER, '--ext', dir, '--by-hand', '--only', 'test-capture-live', '--out', path.join(dir, 's4.json')], { encoding: 'utf8' });
assert.match(byHandGreen.stdout, /test-capture-live \.\.\. PASS/, 'a green byHand suite passes: ' + byHandGreen.stdout);
assert.equal(byHandGreen.status, 0, 'and --by-hand exits 0');
// r8-00-1: the real tree passes the coverage gate under --by-hand too (the by-hand perf entry is not a tools/test-*.mjs file).
const realByHand = spawnSync(process.execPath, [RUNNER, '--coverage', '--by-hand'], { encoding: 'utf8' });
assert.equal(realByHand.status, 0, 'the repo passes the coverage gate under --by-hand: ' + realByHand.stderr);
// D-1010-116 (reader half): test-i18n prints "0 key(s) nothing asks for" on a pass; run-suites records the number 0, not "unset".
writeSuite('test-i18n', 'console.log("  ok  i18n"); console.log("0 key(s) nothing asks for");');
chain(['test-a', 'test-x', KR, 'test-hang', 'test-browsy', 'test-boot-smoke', 'test-i18n']);
const deadOut = path.join(dir, 'dead.json');
const dead = spawnSync(process.execPath, [RUNNER, '--ext', dir, '--only', 'test-i18n', '--out', deadOut], { encoding: 'utf8' });
assert.equal(dead.status, 0, 'the zero-dead-keys run is green: ' + dead.stdout + dead.stderr);
assert.strictEqual(JSON.parse(fs.readFileSync(deadOut, 'utf8')).numbers.deadKeys, 0, 'numbers.deadKeys is the number 0');
assert.match(dead.stdout, /dead-keys 0(?!\d)/, 'and the summary prints dead-keys 0, not ?');
// OF-13 (12-6): a LOCKED suite takes its lock and releases it; a stale lock is taken over; a fresh lock held by another run is waited out.
const lockFile = path.join(os.tmpdir(), 'qaw-suite-test-gif.lock');
try { fs.rmSync(lockFile, { force: true }); } catch { /* none */ }
writeSuite('test-gif', 'console.log("  ok  gif");');
chain(['test-a', 'test-x', KR, 'test-hang', 'test-browsy', 'test-boot-smoke', 'test-i18n', 'test-gif']);
const lockRun = spawnSync(process.execPath, [RUNNER, '--ext', dir, '--only', 'test-gif', '--ci'], { encoding: 'utf8' });
assert.equal(lockRun.status, 0, 'a LOCKED suite runs green: ' + lockRun.stdout + lockRun.stderr);
assert.ok(!fs.existsSync(lockFile), 'and releases its lock file');
fs.writeFileSync(lockFile, '1');
const old = new Date(Date.now() - 3600e3 * 6);
fs.utimesSync(lockFile, old, old);
const staleLock = spawnSync(process.execPath, [RUNNER, '--ext', dir, '--only', 'test-gif', '--ci'], { encoding: 'utf8' });
assert.equal(staleLock.status, 0, 'a stale lock is taken over: ' + staleLock.stdout + staleLock.stderr);
assert.ok(!fs.existsSync(lockFile), 'and the taken-over lock is released');
// OF-13 (12-6): --compare against its own baseline is green; a new FAIL line against that baseline is exit 1.
const baseFile = path.join(dir, 'base.json');
const cmpOnly = ['--only', 'test-a,test-x'];
writeSuite('test-x', 'console.log("ok");');
const baseRun = spawnSync(process.execPath, [RUNNER, '--ext', dir, ...cmpOnly, '--out', baseFile], { encoding: 'utf8' });
assert.equal(baseRun.status, 0, 'the baseline run is green: ' + baseRun.stdout + baseRun.stderr);
const same = spawnSync(process.execPath, [RUNNER, '--ext', dir, ...cmpOnly, '--compare', baseFile], { encoding: 'utf8' });
assert.equal(same.status, 0, '--compare against an identical run: exit 0 ' + same.stdout + same.stderr);
assert.match(same.stdout, /run-suites --compare: 0 new FAIL line\(s\)/, 'and prints 0 new FAIL lines');
writeSuite('test-x', 'console.log("FAIL fresh breakage"); process.exit(1);');
const worse = spawnSync(process.execPath, [RUNNER, '--ext', dir, ...cmpOnly, '--compare', baseFile], { encoding: 'utf8' });
assert.equal(worse.status, 1, '--compare with a new FAIL line: exit 1 ' + worse.stdout + worse.stderr);
assert.match(worse.stdout, /run-suites --compare: [1-9]\d* new FAIL line/, 'and counts it');
fs.rmSync(dir, { recursive: true, force: true });
console.log('  ok  run-suites coverage gate, known-red, timeout, node-only skip list, partial-run baseline guard, SKIPPED count, headed-suite rule, dead-keys 0, red byHand suite under --by-hand (70 checks)');
