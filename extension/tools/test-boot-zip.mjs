/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Boot the package a tester would install, not the folder a developer loads (test pipeline P5, 12 Oct 2026).
 *
 *   node tools/test-boot-zip.mjs [--zip <file>]
 *
 * The suites all load `extension/` unpacked. The store zip is a different artefact: `lib-ship.mjs` decides what goes
 * in it, and a file that is only missing from the zip (a renamed module, a new folder nobody put on the list) is
 * invisible to every unpacked test and fatal to a tester. This suite closes that gap in about 25 seconds:
 *
 *   1. packages with the real `tools/package.mjs` into a TEMP folder (`QAW_DIST`, lib-paths.mjs), so the delivered
 *      `<repo>/dist/` is never written - proven by comparing a fingerprint of it before and after;
 *   2. reads the zip back: manifest at the root, safe entry names, the same version as the source, and every
 *      file the browser loads at start (the import closure of lib-worker-live.mjs) present in it;
 *   3. unpacks it with node (no Expand-Archive), loads the unpacked zip in headless-new Chromium (the bundled Chrome
 *      for Testing), and asserts: the worker starts and reports the packaged version, the popup reaches
 *      `body[data-ready=true]` at 348x600, and no console error, uncaught exception or failed request on the way.
 *
 * `--zip <file>` boots a zip somebody already built, and fails when any shipped source file is newer than the zip
 * (a stale zip is the delivery mistake this exists to catch). The default run builds its own, so it is fresh.
 *
 * Network: none. The only page is the extension's own. The engine build id is on every row.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { EXT, REPO } from './lib-paths.mjs';
import { shipping, isWorkingNote } from './lib-ship.mjs';
import { buildPackage, extractZip, folderFingerprint, rawNames, readZip, sha256File } from './lib-zip.mjs';
import { deriveClosure, engineId, entriesFromManifest, plannedEngine } from './lib-worker-live.mjs';

import { TRASH } from './lib-trash.mjs';
const BUDGET_MS = 120000;
const argv = process.argv.slice(2);
const GIVEN_ZIP = argv.includes('--zip') ? path.resolve(argv[argv.indexOf('--zip') + 1]) : null;

const PLANNED = plannedEngine();
let ENGINE = `engine=${PLANNED.tag}`;
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  [${ENGINE}] ${name}`); }
  else { failures.push(name); console.log(`  FAIL  [${ENGINE}] ${name}${detail ? `\n        ${detail}` : ''}`); }
};
const recycle = (p) => {
  if (!p || !fs.existsSync(p)) return;
  try { execFileSync('python', [TRASH, p], { stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } }); } catch { console.log(`note: could not recycle ${p}`); }
};

const t0 = Date.now();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-boot-zip-'));
const tmpDist = path.join(tmp, 'dist');
const unpacked = path.join(tmp, 'unpacked');
const profileDir = path.join(tmp, 'profile');
const repoDist = path.join(REPO, 'dist');
const distBefore = folderFingerprint(repoDist);
let ctx = null;
let browserPid = null;
const watchdog = setTimeout(() => {
  if (browserPid) spawnSync('taskkill', ['/PID', String(browserPid), '/T', '/F']);
  console.log('WATCHDOG: boot-zip exceeded 170 s; killed the browser this run started');
  process.exit(9);
}, 170000);
watchdog.unref();

try {
  console.log('boot-zip: package into a temp dir, read the zip back, boot the unpacked zip headless');

  /* ── 1. the override, and the guard against writing the delivered dist/ ── */
  const probe = (env) => spawnSync(process.execPath, ['--input-type=module', '-e', "import('./tools/lib-paths.mjs').then((m) => console.log(m.DIST))"],
    { cwd: EXT, encoding: 'utf8', env: { ...process.env, ...env } }).stdout.trim();
  check(path.resolve(probe({ QAW_DIST: tmpDist })) === path.resolve(tmpDist), 'lib-paths: QAW_DIST moves DIST to the temp folder');
  check(path.resolve(probe({ QAW_DIST: '' })) === path.resolve(repoDist), 'lib-paths: with QAW_DIST unset, DIST is still the repo dist/');
  let refused = false;
  try { buildPackage({ ext: EXT, dist: repoDist }); } catch { refused = true; }
  check(refused, 'buildPackage refuses to write the delivered repo dist/');

  /* ── 2. the zip ── */
  const source = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  let zip = GIVEN_ZIP;
  if (!zip) {
    const built = buildPackage({ ext: EXT, dist: tmpDist });
    check(built.ok, `package.mjs exits 0 and writes exactly one zip (${built.ms} ms)`, built.log.trim().split(/\r?\n/).slice(-6).join('\n        '));
    if (!built.ok) throw new Error('no zip to boot');
    zip = built.zip;
    console.log(`  zip: ${path.basename(zip)} ${built.bytes} bytes sha256=${built.sha}`);
  } else {
    console.log(`  zip: ${zip} (given) sha256=${sha256File(zip)}`);
  }
  check(path.basename(zip).includes(source.version), `the zip name carries the source version ${source.version}`, path.basename(zip));

  // Stale-zip check: nothing shipped may be newer than the zip.
  const newest = (() => {
    let best = { t: 0, f: '' };
    const walk = (d, relDir) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const rel = relDir ? `${relDir}/${e.name}` : e.name;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p, rel); continue; }
        if (isWorkingNote(rel)) continue;
        const t = fs.statSync(p).mtimeMs;
        if (t > best.t) best = { t, f: rel };
      }
    };
    for (const n of shipping(fs.readdirSync(EXT))) {
      const p = path.join(EXT, n);
      if (fs.statSync(p).isDirectory()) walk(p, n);
      else { const t = fs.statSync(p).mtimeMs; if (t > best.t) best = { t, f: n }; }
    }
    return best;
  })();
  const zipTime = fs.statSync(zip).mtimeMs;
  check(newest.t <= zipTime, `the zip is not older than any shipped source file (newest: ${newest.f} ${new Date(newest.t).toISOString()}, zip ${new Date(zipTime).toISOString()})`);

  const names = rawNames(zip);
  const files = names.filter((n) => !n.endsWith('/'));
  // Compress-Archive on Windows writes backslash separators; Chrome and the store read them as folders (lib-zip.mjs).
  // What must hold is that folding them cannot collide, escape the root or hide a duplicate.
  const folded = names.map((n) => n.split('\\').join('/'));
  const unsafe = folded.filter((n) => n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.split('/').includes('..'));
  check(unsafe.length === 0 && new Set(folded).size === folded.length,
    `entry names are safe once separators are folded (${names.filter((n) => n.includes('\\')).length} of ${names.length} use backslashes; no absolute, '..' or duplicate names)`, unsafe.slice(0, 3).join(', '));
  check(files.includes('manifest.json'), 'manifest.json is at the zip root');
  const inZip = JSON.parse(readZip(zip).entries.get('manifest.json')?.data().toString('utf8') || '{}');
  check(inZip.version === source.version && inZip.name === source.name, `the packaged manifest is the source manifest (${inZip.name} ${inZip.version})`);
  check(!files.some((n) => /^(tools|node_modules|dist)\//.test(n)), 'no tools/, node_modules/ or dist/ entry in the zip');

  /* ── 3. unpack with node, closure complete ── */
  const ex = extractZip(zip, unpacked);
  check(ex.files === files.length, `unpacked ${ex.files} files = ${files.length} entries`);
  const { entries, worker } = entriesFromManifest(unpacked);
  const closure = deriveClosure(unpacked, entries);
  check(closure.files.length >= 40 && closure.missing.length === 0,
    `every file the browser loads at start is in the zip (${closure.files.length} files in the closure, ${closure.missing.length} missing)`,
    closure.missing.slice(0, 5).map((m) => `${m.from} -> ${m.spec}`).join('; '));

  /* ── 4. boot it ── */
  const errors = [];
  const bootAt = Date.now();
  const exe = chromium.executablePath();
  ctx = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    channel: 'chromium',
    viewport: { width: 348, height: 600 },
    args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`, '--no-first-run', '--no-default-browser-check'],
  });
  try {
    const cdp = await ctx.browser().newBrowserCDPSession();
    const info = await cdp.send('SystemInfo.getProcessInfo');
    browserPid = info.processInfo.find((p) => p.type === 'browser')?.id ?? null;
    await cdp.detach().catch(() => {});
  } catch { /* the watchdog then has no pid; the context close below still runs */ }
  const eng = await engineId(ctx, { headless: 'new', exe });
  console.log(`  engine: ${eng.label}`);
  check(eng.tag === PLANNED.tag, `the running build is the one Playwright's browsers.json pins (${eng.tag})`, `planned ${PLANNED.tag}`);
  ENGINE = `engine=${eng.tag}`;

  ctx.on('weberror', (e) => errors.push(`weberror: ${e.error().message}`));
  let w = ctx.serviceWorkers().find((x) => x.url().startsWith('chrome-extension://'));
  if (!w) w = await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
  check(!!w && w.url().endsWith(`/${worker}`), `the service worker started from the unpacked zip (${w ? new URL(w.url()).pathname : 'none'} after ${Date.now() - bootAt} ms)`);
  if (!w) throw new Error('worker did not start');
  w.on?.('console', (m) => { if (m.type() === 'error') errors.push(`worker console: ${m.text()}`); });
  const extId = new URL(w.url()).host;
  const ver = await w.evaluate(() => chrome.runtime.getManifest().version);
  check(ver === source.version, `the worker reports the packaged version (${ver})`);

  const page = await ctx.newPage();
  await page.setViewportSize({ width: 348, height: 600 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(`chrome-extension://${extId}/popup/popup.html`);
  const ready = await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 }).then(() => true, () => false);
  check(ready, `the popup is ready at 348x600 (body[data-ready=true] after ${Date.now() - bootAt} ms from launch)`);
  await page.waitForTimeout(1500);
  check(errors.length === 0, `0 errors while booting (console, uncaught, failed request, worker console): ${errors.length}`, errors.slice(0, 5).join('\n        '));

  const wall = Date.now() - t0;
  check(wall < BUDGET_MS, `wall time ${(wall / 1000).toFixed(1)} s is inside the ${BUDGET_MS / 1000} s smoke budget`);
} catch (err) {
  failures.push(`aborted: ${String(err.message || err).split('\n')[0]}`);
  console.log(`  FAIL  [${ENGINE}] aborted: ${String(err.stack || err).split('\n').slice(0, 4).join(' | ')}`);
} finally {
  if (ctx) await ctx.close().catch(() => {});
  clearTimeout(watchdog);
  const after = folderFingerprint(repoDist);
  check(after === distBefore, 'the delivered repo dist/ is byte-for-byte untouched by this run');
  recycle(tmp);
}

console.log(`\n${passed} passed, ${failures.length} failed  [${ENGINE}]`);
process.exit(failures.length ? 1 : 0);
