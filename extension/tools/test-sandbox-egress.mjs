/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Lane P3 (1012): each sandbox guard proven once, by a probe suite that runs under the real preload.
 *
 *   node tools/test-sandbox-egress.mjs            (from extension/)
 *
 * Probe = tools/lib-sandbox-probe.mjs, started with the env from buildChildEnv(): NODE_OPTIONS=--import=<preload>, allow-listed
 * env, redirected home. Network: 127.0.0.1, plus two fetches (https://example.com, http://10.255.255.1) that the dead-port proxy
 * must stop. The only custom scheme exercised is qaw-egress-test:, never mailto: or tel:. Temp dirs go to the recycle bin.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { TRASH } from './lib-trash.mjs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { buildChildEnv, egressReport, readObserver, findRunProcesses, teardownRun, guardSnapshot, guardDiff, refusedLiveScript, findRawLaunches, preloadUrl, classifyUrl, isEgressError } from './lib-sandbox.mjs';
import { scrub, scrubTransform, leakScan, leakScanDir } from './lib-scrub.mjs';
import { engineOptions } from './lib-launch.mjs';
import { secondaryMonitor } from './lib-test-window.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const PROBE = path.join(HERE, 'lib-sandbox-probe.mjs');
let n = 0, skipped = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };
const skip = (name, why) => { skipped++; console.log(`  NOT RUN  ${name}: ${why}`); };

const RUN = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-sandbox-test-'));
const trash = (p) => { try { execFileSync('python', [TRASH, p], { stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } }); } catch { /* best effort */ } };
process.on('exit', () => trash(RUN)); // also after a red assertion
const spawned = []; // pids this test started (kept for the leftovers line; nothing is killed from this list after the fact: pids get reused)

/** Run the probe as a sandboxed suite. Resolves { code, stdout, stderr, probe, entries, env, dirs }. */
function runProbe(suite, mode, { base = process.env, opts = {}, entry = PROBE, timeout = 150000, extraEnv = {} } = {}) {
  const { env, dirs } = buildChildEnv({ runDir: RUN, suite, runId: path.basename(RUN), base, ...opts });
  Object.assign(env, { QAW_PROBE: mode, ...extraEnv });
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [entry], { env, cwd: EXT, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    spawned.push(c.pid);
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); }, timeout);
    c.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout.split('\n').find((l) => l.startsWith('PROBE '));
      resolve({ code, stdout, stderr, probe: line ? JSON.parse(line.slice(6)) : null, entries: readObserver(RUN, suite), env, dirs, pid: c.pid });
    });
  });
}

// ---- pure pieces first (no browser) ------------------------------------------------------------------------------
await t('classifyUrl and isEgressError', () => {
  assert.equal(classifyUrl('http://127.0.0.1:80/x'), 'loopback');
  assert.equal(classifyUrl('http://localhost:3000/'), 'loopback');
  assert.equal(classifyUrl('https://example.com/'), 'external');
  assert.equal(classifyUrl('chrome-extension://abc/popup.html'), 'inert');
  assert.equal(classifyUrl('qaw-egress-test:probe'), 'handoff');
  assert.equal(classifyUrl('mailto:a@b.c'), 'handoff'); // classified only; this suite never navigates to it
  assert.ok(isEgressError('net::ERR_PROXY_CONNECTION_FAILED'));
  assert.ok(!isEgressError('net::ERR_FAILED') && !isEgressError('net::ERR_ABORTED'));
});

await t('S7 buildChildEnv: allow-list, TEMP in the run dir, redirected home, only the preload in NODE_OPTIONS', async () => {
  const base = { ...process.env, OPENROUTER_API_KEY: 'x', HTTPS_PROXY: 'http://evil', QAW_JIRA_ENV: 'C:/creds', QAW_OK: '1', NODE_OPTIONS: '--max-old-space-size=1' };
  const { env, dirs } = buildChildEnv({ runDir: RUN, suite: 'unit', base, imports: ['file:///counter.mjs'] });
  assert.equal(env.OPENROUTER_API_KEY, undefined); assert.equal(env.HTTPS_PROXY, undefined); assert.equal(env.QAW_JIRA_ENV, undefined);
  assert.equal(env.QAW_OK, '1');
  assert.ok(env.TEMP.startsWith(RUN) && env.TMP.startsWith(RUN) && env.USERPROFILE.startsWith(RUN) && env.HOME.startsWith(RUN));
  assert.equal(env.NODE_OPTIONS, `--import=file:///counter.mjs --import=${preloadUrl}`);
  assert.ok(env.QAW_TRASH.endsWith('trash.py') && !env.QAW_TRASH.startsWith(RUN));
  for (const d of ['tmp', 'profiles', 'downloads', 'home', 'observer']) assert.ok(fs.existsSync(dirs[d]), d);
  assert.ok(env.PATH || env.Path, 'PATH kept');
});

await t('S9 two shards get distinct profile, download and tmp dirs', () => {
  const a = buildChildEnv({ runDir: RUN, suite: 'shard-a' }).dirs, b = buildChildEnv({ runDir: RUN, suite: 'shard-b' }).dirs;
  for (const k of ['tmp', 'profiles', 'downloads', 'home']) assert.notEqual(a[k], b[k]);
});

await t('S2 egressReport: stubbed is logged STUBBED, failed with a proxy error is FAIL EGRESS, own route.abort is neither', () => {
  const e = (kind, id, url, extra = {}) => ({ kind, id, cls: 'external', url, ...extra });
  const r = egressReport([
    { kind: 'preload' },
    e('request', 1, 'https://app.test/'), e('finished', 1, 'https://app.test/'),
    e('request', 2, 'https://example.com/'), e('failed', 2, 'https://example.com/', { err: 'net::ERR_PROXY_CONNECTION_FAILED' }),
    e('request', 3, 'https://aborted.test/'), e('failed', 3, 'https://aborted.test/', { err: 'net::ERR_FAILED' }),
    e('request', 4, 'https://pending.test/'),
  ], 'unit');
  assert.equal(r.verdict, 'FAIL');
  assert.deepEqual(r.stubbed, ['https://app.test/']);
  assert.equal(r.failures.length, 1);
  assert.ok(r.lines.includes('FAIL EGRESS unit https://example.com/ (net::ERR_PROXY_CONNECTION_FAILED)'));
  assert.equal(r.warnings.length, 1);
  assert.equal(egressReport([e('request', 1, 'https://a.test/'), e('finished', 1, 'https://a.test/')]).verdict, 'PASS');
});

await t('S12 scrub: token shapes and Authorization values gone, plain text untouched; stream scrub; dir leak scan', async () => {
  const dirty = 'a sk-TESTTOKEN0123456789abcdefABCDEF b Authorization: Bearer abcdefghijklmnop0123456789 c';
  assert.ok(leakScan(dirty).length >= 2);
  const clean = scrub(dirty);
  assert.ok(!/sk-TEST|abcdefghijklmnop/.test(clean) && clean.includes('[REDACTED]'), clean);
  assert.equal(scrub('nothing secret here, 12345'), 'nothing secret here, 12345');
  let acc = '';
  const tr = scrubTransform(); const sink = new Writable({ write(c, _e, cb) { acc += c; cb(); } });
  tr.pipe(sink); tr.write('line one sk-TESTTOKEN0123456789abcdefABCDEF\nsecond half Bearer abcdefghijkl'); tr.write('mnopqrstuvwxyz0123\n'); tr.end();
  await new Promise((r) => sink.on('finish', r));
  assert.ok(!/sk-TEST|abcdefghijkl/.test(acc), acc);
  const d = path.join(RUN, 'leakdir'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'a.log'), dirty); fs.writeFileSync(path.join(d, 'b.log'), clean);
  const found = leakScanDir(d);
  assert.ok(found.length >= 1 && found.every((f) => f.file.endsWith('a.log')), JSON.stringify(found));
});

await t('S12 probe prints a fake token: raw child output is detected, the scrubbed sink is clean', async () => {
  const r = await runProbe('secret', 'secret');
  assert.equal(r.code, 0);
  assert.ok(/sk-TESTTOKEN/.test(r.stdout), 'raw output carries the token (the probe prints it)');
  const f = path.join(RUN, 'secret.out'); fs.writeFileSync(f, scrub(r.stdout));
  assert.deepEqual(leakScanDir(RUN).filter((x) => x.file === f), []);
  assert.ok(fs.readFileSync(f, 'utf8').includes('[REDACTED]'));
});

await t('S7 probe: home and temp inside the run dir, credential vars absent, credential read refused (EACCES, not ENOENT)', async () => {
  const base = { ...process.env, OPENROUTER_API_KEY: 'fake', HTTPS_PROXY: 'http://evil.invalid', JIRA_TOKEN: 'fake', GITHUB_TOKEN: 'fake' };
  const r = await runProbe('env', 'env', { base, extraEnv: { QAW_PROBE_REAL_HOME: os.homedir() } });
  assert.equal(r.code, 0, r.stderr);
  const p = r.probe;
  assert.ok(path.resolve(p.homedir).startsWith(path.resolve(RUN)), `homedir ${p.homedir}`);
  assert.ok(path.resolve(p.tmpdir).startsWith(path.resolve(RUN)), `tmpdir ${p.tmpdir}`);
  assert.deepEqual(p.secretVars, []);
  assert.equal(p.credRead, 'EACCES'); assert.equal(p.realCredRead, 'EACCES');
  assert.ok(p.nodeOptions.includes('lib-sandbox-preload.mjs'));
});

await t('S6 live-credential scripts are refused (exit 64), unless --allow-live; a clean script runs', async () => {
  const dir = fs.mkdtempSync(path.join(RUN, 'live-'));
  const live = path.join(dir, 'jira-live.mjs'), ok = path.join(dir, 'harmless.mjs');
  fs.writeFileSync(live, "console.log('PROBE {\"ran\":true}');\n"); fs.writeFileSync(ok, "console.log('PROBE {\"ran\":true}');\n");
  const r = await runProbe('live', 'hello', { entry: live });
  assert.equal(r.code, 64, r.stderr); assert.match(r.stderr, /REFUSED jira-live\.mjs/); assert.equal(r.probe, null);
  const allowed = await runProbe('live2', 'hello', { entry: live, opts: { allowLive: true } });
  assert.equal(allowed.code, 0); assert.deepEqual(allowed.probe, { ran: true });
  const fine = await runProbe('live3', 'hello', { entry: ok });
  assert.equal(fine.code, 0);
  const reads = path.join(dir, 'reader.mjs'); fs.writeFileSync(reads, "import fs from 'node:fs';\nfs.readFileSync('C:/Users/x/.config/qa-wrap/jira.env');\n");
  assert.match(refusedLiveScript(reads) || '', /credential file/);
  assert.equal(refusedLiveScript(path.join(HERE, 'test-vendor-risk.mjs')), null, 'a test that only mentions the path is not refused');
});

// ---- the browser probes --------------------------------------------------------------------------------------------
const mainBefore = guardSnapshot({ repoRoot: RUN }); // only the Downloads half is used on the shared tree
const main = await runProbe('main', 'main', { opts: { forceHeadless: true } });
const pr = main.probe;
const mainEgress = egressReport(main.entries, 'main');

await t('S1 the preload ran in the suite, forced a unique profile under the run dir, and left the requested dir unused', () => {
  assert.equal(main.code, 0, main.stderr.slice(0, 400));
  assert.ok(pr, 'probe answered');
  assert.ok(mainEgress.preloaded, 'observer has the preload marker');
  const launches = main.entries.filter((e) => e.kind === 'launch'), profiles = main.entries.filter((e) => e.kind === 'profile');
  assert.equal(launches.length, 2); assert.equal(profiles.length, 2);
  assert.notEqual(profiles[0].forced, profiles[1].forced);
  assert.ok(profiles.every((p) => p.forced.startsWith('profiles')), JSON.stringify(profiles));
  assert.equal(pr.requestedUsed, false); assert.equal(pr.requested2Used, false);
});

await t('S2 dead-port proxy: page and extension worker cannot reach example.com or 10.255.255.1 (< 5 s), loopback works', () => {
  for (const u of ['https://example.com/', 'http://10.255.255.1/']) for (const where of ['page', 'worker']) {
    const x = pr.res[`${where} ${u}`];
    assert.equal(x.ok, false, `${where} ${u} reached the network`); assert.ok(x.ms < 5000, `${where} ${u} took ${x.ms} ms`);
  }
  assert.equal(pr.res.pageLoop.ok, true); assert.equal(pr.res.workerLoop.ok, true);
});

await t('S2 observer names the attempts: FAIL EGRESS for example.com and 10.255.255.1 (page and worker), STUBBED for the route.fulfill host', () => {
  assert.equal(mainEgress.verdict, 'FAIL');
  const urls = mainEgress.failures.map((f) => f.url);
  assert.ok(urls.includes('https://example.com/'), JSON.stringify(mainEgress.lines));
  assert.ok(urls.includes('http://10.255.255.1/'), JSON.stringify(mainEgress.lines));
  assert.ok(mainEgress.failures.some((f) => /extension worker/.test(f.why)), 'the worker attempt is attributed to the worker');
  assert.ok(mainEgress.stubbed.includes('https://stub.test/a'), JSON.stringify(mainEgress.stubbed));
  assert.ok(!mainEgress.failures.some((f) => /stub\.test/.test(f.url)), 'a stub is not egress');
  assert.ok(!JSON.stringify(main.entries).includes('SECRETVALUE1'), 'query strings never reach the log');
});

await t('S3 custom scheme qaw-egress-test: no new page, no dialog, URL unchanged, no new child process of ours, handoff logged', () => {
  assert.deepEqual(pr.res.click, { urlSame: true, pagesOpened: 0, dialogs: 0, newChildProcs: [] }, JSON.stringify(pr.res.click));
  assert.ok(mainEgress.handoffs.some((h) => h.scheme === 'qaw-egress-test:'), `handoff observed: ${JSON.stringify(main.entries.filter((e) => e.kind === 'handoff'))} ${JSON.stringify(main.entries.filter((e) => e.kind === 'failed' && /qaw/.test(e.url || '')))}`);
  assert.ok(!JSON.stringify(main.entries).includes('mailto'), 'mailto never reached');
});

await t('R4 QAW_FORCE_HEADLESS converts a headed:true caller to headless (user agent)', () => assert.equal(pr.headlessUA, true));

await t('S8 downloads land under the run dir; the real Downloads folder and the repo tree are unchanged', () => {
  assert.ok(pr.res.download.path, 'a download happened');
  assert.ok(path.resolve(pr.res.download.path).startsWith(path.resolve(RUN)), pr.res.download.path);
  // The real repo is being edited by other lanes while this runs, so the porcelain half is proven on a throwaway repo.
  const after = guardSnapshot({ repoRoot: RUN });
  assert.deepEqual(guardDiff({ git: '', downloads: mainBefore.downloads }, { git: '', downloads: after.downloads }), [], 'real Downloads unchanged by the headless suite');;
  const repo = fs.mkdtempSync(path.join(RUN, 'repo-'));
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q'); fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
  const s0 = guardSnapshot({ repoRoot: repo, home: repo }); fs.writeFileSync(path.join(repo, 'stray.txt'), 'written by a suite');
  const s1 = guardSnapshot({ repoRoot: repo, home: repo });
  assert.deepEqual(guardDiff(s0, s1), ['unexpected write: ?? stray.txt']);
  assert.deepEqual(guardDiff(s0, s1, { ignore: ['stray'] }), []);
  fs.mkdirSync(path.join(repo, 'Downloads')); fs.writeFileSync(path.join(repo, 'Downloads', 'f.bin'), 'x');
  assert.match(guardDiff(s1, guardSnapshot({ repoRoot: repo, home: repo })).join(), /real Downloads changed/);
  assert.ok(guardDiff({ git: '', downloads: { count: 1, newest: 5 } }, { git: ' M extension/popup/x.js' + String.fromCharCode(10), downloads: { count: 2, newest: 9 } }).length === 2, 'the diff flags a repo write and a new real download');
});

await t('S4 sweep mode: window.close, tabs.remove, a tabs.create to a real host and window.open are recorded and not forwarded; the browser survives', async () => {
  const s = await runProbe('sweep', 'sweep', { opts: { forceHeadless: true, sweep: true } });
  assert.equal(s.code, 0, s.stderr.slice(0, 300));
  const p = s.probe;
  assert.ok(p.browserAlive, 'browser alive and serving loopback');
  assert.equal(p.pagesAfter, p.pagesBefore, `page count ${p.pagesBefore} -> ${p.pagesAfter}`);
  assert.ok(p.urls.every((u) => !/sweep-target\.invalid/.test(u)), JSON.stringify(p.urls));
  for (const api of ['window.close', 'tabs.create', 'tabs.remove', 'window.open']) assert.ok(p.r.log.includes(api), `${api} recorded in page log: ${JSON.stringify(p.r.log)}`);
  const logged = s.entries.filter((e) => e.kind === 'sweep').map((e) => e.api);
  for (const api of ['window.close', 'tabs.create', 'tabs.remove', 'window.open']) assert.ok(logged.includes(api), `${api} in observer log: ${JSON.stringify(logged)}`);
  assert.equal(p.r.open, 'null');
  assert.ok(!egressReport(s.entries, 'sweep').failures.some((f) => /sweep-target/.test(f.url)), 'the blocked target never even reached the proxy');
});

await t('S11 teardown by pid: the marked browser of a hung suite is found and its tree killed by pid; a foreign node survives', async () => {
  const foreign = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', shell: false, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  spawned.push(foreign.pid);
  const runId = `orphan-${process.pid}`;
  const { env } = buildChildEnv({ runDir: RUN, suite: 'orphan', runId, forceHeadless: true });
  Object.assign(env, { QAW_PROBE: 'orphan' });
  const c = spawn(process.execPath, [PROBE], { env, cwd: EXT, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  spawned.push(c.pid);
  await new Promise((res, rej) => { let b = ''; const to = setTimeout(() => rej(new Error('orphan probe did not launch: ' + b)), 60000); c.stdout.on('data', (d) => { b += d; if (b.includes('PROBE')) { clearTimeout(to); res(); } }); });
  // A hung suite: node is alive, the browser it launched is marked. (Hard-killing node alone makes Playwright's pipe close and the
  // browser exit by itself on this machine - measured - so the case that needs the marker is the one where node is still up.)
  const orphans = findRunProcesses(runId);
  assert.ok(orphans.some((p) => p.root), `the marked browser root is found: ${JSON.stringify(orphans)}`);
  const res = teardownRun({ runId, runDir: RUN });
  assert.ok(res.killed.length >= 1, JSON.stringify(res)); assert.deepEqual(res.left, []);
  assert.equal(findRunProcesses(runId).length, 0);
  spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); // the probe's own node, by recorded pid
  try { assert.doesNotThrow(() => process.kill(foreign.pid, 0), 'the unrelated node process is still alive (NOT MINE, left alone)'); }
  finally { spawnSync('taskkill', ['/PID', String(foreign.pid), '/T', '/F'], { stdio: 'ignore' }); } // our own dummy
});

await t('S11 no kill by image name in the sandbox sources', () => {
  for (const f of ['lib-sandbox.mjs', 'lib-sandbox-preload.mjs', 'lib-sandbox-probe.mjs', 'lib-scrub.mjs', 'lib-launch.mjs', 'lib-test-window.mjs']) {
    const code = fs.readFileSync(path.join(HERE, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/taskkill[^\n]*\/IM|Stop-Process\s+-Name|\bpkill\b|\bkillall\b/i.test(code), f);
  }
});

await t('S1 coverage: no browser start route in tools/*.mjs that bypasses the preload', () => {
  const found = findRawLaunches(HERE);
  assert.deepEqual(found, [], JSON.stringify(found));
});

await t('engine: bundled Chrome for Testing build id printed; cft without a binary is ENV-BLOCKED, never a silent fallback', () => {
  const e = engineOptions({});
  assert.match(e.label, /^chromium-\d+\.\d+\.\d+\.\d+$/); console.log(`      engine=${e.label}`);
  assert.throws(() => engineOptions({ QAW_ENGINE: 'cft-155' }), /ENV-BLOCKED/);
  assert.throws(() => engineOptions({ QAW_ENGINE: 'cft-155', QAW_CFT_PATH: 'C:/nope/chrome.exe' }), /ENV-BLOCKED/);
  assert.equal(engineOptions({ QAW_ENGINE: 'cft-155', QAW_CFT_PATH: process.execPath }).executablePath, process.execPath);
});

// ---- headed placement (secondary monitor) -------------------------------------------------------------------------------
if (!secondaryMonitor()) skip('secondary-monitor placement (Browser.getWindowForTarget)', 'single monitor');
else await t('S9 headed window really opens inside the secondary monitor (Browser.getWindowForTarget)', async () => {
  const h = await runProbe('headed', 'headed', { opts: { forceHeadless: false } });
  assert.equal(h.code, 0, h.stderr.slice(0, 300));
  assert.equal(h.probe.placement.status, 'OK', JSON.stringify(h.probe.placement));
});

console.log(`\nsandbox egress: ${n} passed, 0 failed${skipped ? `, ${skipped} not run` : ''}`);
