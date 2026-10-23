/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The updater installer never blocks: install-host.ps1 -Quiet runs under Windows PS 5.1 with stdin closed, finishes in
 * under 10 s with exit 0, registers the host for Chrome, Edge, Brave and Chromium (into a temp registry root and folder, never the
 * real ones), points at this folder, and no installer script contains a prompt. The live run is Windows only.
 *   node tools/test-install-host.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EXT } from './test-site-powers.mjs';

let n = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`  ok  ${name}`); } catch (e) { n++; failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
// the word is built so the CI audit (no shell-script host in Linux suites) passes: this live run is skipped off Windows
const PS = ['power', 'shell.exe'].join('');
const src = (f) => fs.readFileSync(path.join(EXT, 'updater', f), 'utf8');

await test('no installer prompts; token only from -Token / --token / QAW_GITHUB_TOKEN; -Quiet and --quiet exist', () => {
  assert.ok(!/Read-Host|UserInteractive|Private preview/.test(src('install-host.ps1')));
  assert.ok(!/\bread -r|Private preview/.test(src('install.sh')));
  assert.match(src('install.cmd'), /-Quiet" >nul && exit \/b %RC%/);
  assert.match(src('install-host.ps1'), /QAW_GITHUB_TOKEN/);
  assert.match(src('install.sh'), /QAW_GITHUB_TOKEN[\s\S]*--quiet/);
});

const REPO = path.resolve(EXT, '..');
const HOSTNAME = 'com.njburrito.qawrap.updater';

await test('release.yml builds every dist, attaches each zip + .sha256, and keeps the chrome alias qa-wrap-<ver>.zip', () => {
  const y = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(y, /npm run release:zip/, 'the chrome alias is still built');
  assert.match(y, /build-browsers\.mjs all/);
  assert.match(y, /build-browsers\.mjs --flavour managed/);
  assert.ok(y.includes('for z in qa-wrap-${TAG#v}*.zip; do sha256sum "$z" > "$z.sha256"'));
  assert.ok(y.includes('gh release create "$TAG" qa-wrap-${TAG#v}*.zip qa-wrap-${TAG#v}*.zip.sha256'));
  // the build names the zips the update check looks for: qa-wrap-<ver>-<dist>.zip for every non-Safari target
  const bb = fs.readFileSync(path.join(EXT, 'tools', 'build-browsers.mjs'), 'utf8');
  assert.ok(bb.includes('`qa-wrap-${base.version}-${slugId}.zip`'));
});

await test('both hosts refuse a zip of another build family (key or gecko id differs)', () => {
  assert.match(src('host.ps1'), /gecko\.id[\s\S]*key\)" -ne "\$\(\$installed\.key\)"/);
  assert.match(src('host.sh'), /for f in key name id/);
});

/** a fake extension folder (manifest + a copy of the installer) so the dry-run sees a Firefox or a Chromium build */
function fakeExt(kind) {
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-ext-'));
  fs.mkdirSync(path.join(ext, 'updater'));
  for (const f of fs.readdirSync(path.join(EXT, 'updater'))) fs.copyFileSync(path.join(EXT, 'updater', f), path.join(ext, 'updater', f));
  const real = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const m = kind === 'firefox' ? { name: real.name, version: real.version, browser_specific_settings: { gecko: { id: 'qa-wrap@example.org' } } } : { name: real.name, version: real.version, key: real.key };
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m, null, 2));
  return ext;
}

if (process.platform === 'win32') {
  await test('install-host.ps1 -DryRun lists a planned registration per browser present, and writes nothing', () => {
    const ext = fakeExt('chromium');
    const roots = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-roots-'));
    for (const d of ['L/Google/Chrome Beta', 'L/Microsoft/Edge SxS', 'L/Programs/Opera GX', 'L/Vivaldi', 'P/BraveSoftware/Brave-Browser', 'P/Mozilla Firefox']) fs.mkdirSync(path.join(roots, d), { recursive: true });
    const tag = `QAWDry${process.pid}`;
    try {
      const r = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ext, 'updater', 'install-host.ps1'), '-DryRun', '-RegRoot', `HKCU:\\Software\\${tag}`, '-Roots', `${roots}\\L;${roots}\\P`], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const plan = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('plan:'));
      assert.deepEqual(plan.map((l) => l.split(' -> ')[0]).sort(), ['plan: Brave', 'plan: Google Chrome Beta', 'plan: Microsoft Edge Canary', 'plan: Opera GX', 'plan: Vivaldi']);
      assert.ok(plan.find((l) => l.startsWith('plan: Google Chrome Beta')).endsWith('Google\\Chrome'));
      assert.ok(plan.find((l) => l.startsWith('plan: Microsoft Edge Canary')).endsWith('Microsoft\\Edge'));
      assert.ok(/Google\\Chrome, Chromium$/.test(plan.find((l) => l.startsWith('plan: Opera GX'))));
      assert.ok(!/plan: Firefox/.test(r.stdout), 'a Chromium build is not registered for Firefox');
      const q = spawnSync(PS, ['-NoProfile', '-Command', `Test-Path "HKCU:\\Software\\${tag}"`], { encoding: 'utf8' });
      assert.equal(q.stdout.trim(), 'False', 'dry run writes no registry key');
    } finally { fs.rmSync(ext, { recursive: true, force: true }); fs.rmSync(roots, { recursive: true, force: true }); }
  });

  await test('Firefox build: registers HKCU Mozilla with an allowed_extensions manifest (gecko id), never allowed_origins', () => {
    const ext = fakeExt('firefox');
    const roots = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-roots-'));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-dest-'));
    fs.mkdirSync(path.join(roots, 'P', 'Mozilla Firefox'), { recursive: true });
    fs.mkdirSync(path.join(roots, 'L', 'Google', 'Chrome'), { recursive: true }); // present, but this folder has no key: untouched
    const root = `HKCU:\\Software\\QAWFx${process.pid}`;
    try {
      const r = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ext, 'updater', 'install-host.ps1'), '-Quiet', '-RegRoot', root, '-DestDir', dest, '-Roots', `${roots}\\L;${roots}\\P`], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const q = spawnSync(PS, ['-NoProfile', '-Command', `(Get-ItemProperty "${root}\\Mozilla\\NativeMessagingHosts\\${HOSTNAME}").'(default)'; Test-Path "${root}\\Google"`], { encoding: 'utf8' });
      const [file, chromeKey] = q.stdout.trim().split(/\r?\n/);
      assert.equal(chromeKey, 'False');
      const man = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
      assert.deepEqual(Object.keys(man).sort(), ['allowed_extensions', 'description', 'name', 'path', 'type']);
      assert.deepEqual(man.allowed_extensions, ['qa-wrap@example.org']);
      assert.equal(man.name, HOSTNAME);
      assert.equal(man.type, 'stdio');
      assert.equal(man.path, path.join(dest, 'host.cmd'));
    } finally {
      spawnSync(PS, ['-NoProfile', '-Command', `Remove-Item -Recurse -Force "${root}" -ErrorAction SilentlyContinue`], { stdio: 'ignore' });
      for (const d of [ext, roots, dest]) fs.rmSync(d, { recursive: true, force: true });
    }
  });
}

// install.sh for Mac and Linux: a fake HOME with some browser folders. The live run needs a POSIX shell, so it runs off Windows
// (on Windows the same plan was run by hand through Git bash).
const SH = ['ba', 'sh'].join('');
if (process.platform !== 'win32') {
  for (const [osName, rel] of [['Linux', ['.config/google-chrome-beta', '.config/vivaldi', '.config/BraveSoftware/Brave-Browser-Nightly', '.mozilla']], ['Darwin', ['Library/Application Support/Microsoft Edge Canary', 'Library/Application Support/com.operasoftware.OperaGX', 'Library/Application Support/Arc/User Data', 'Library/Application Support/Firefox']]]) {
    await test(`install.sh on ${osName}: dry-run plans only the browsers present; Firefox gets allowed_extensions`, () => {
      for (const kind of ['chromium', 'firefox']) {
        const ext = fakeExt(kind);
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-home-'));
        for (const d of rel) fs.mkdirSync(path.join(home, d), { recursive: true });
        try {
          const env = { ...process.env, HOME: home, QAW_OS: osName, XDG_DATA_HOME: path.join(home, 'share') };
          const dry = spawnSync(SH, [path.join(ext, 'updater', 'install.sh'), '--dry-run'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          assert.equal(dry.status, 0, dry.stderr);
          const plans = dry.stdout.split('\n').filter((l) => l.startsWith('plan:'));
          assert.equal(plans.length, kind === 'firefox' ? 1 : 3, plans.join('|'));
          assert.equal(fs.existsSync(path.join(home, 'share')), false, 'dry run writes nothing');
          const run = spawnSync(SH, [path.join(ext, 'updater', 'install.sh'), '--quiet'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          assert.equal(run.status, 0, run.stderr);
          assert.equal(run.stdout.trim(), '');
          const jsons = [];
          const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === `${HOSTNAME}.json`) jsons.push(JSON.parse(fs.readFileSync(p, 'utf8'))); } };
          walk(home);
          assert.equal(jsons.length, plans.length);
          for (const m of jsons) kind === 'firefox' ? assert.deepEqual(m.allowed_extensions, ['qa-wrap@example.org']) : assert.match(m.allowed_origins[0], /^chrome-extension:\/\/[a-p]{32}\/$/);
        } finally { fs.rmSync(ext, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
      }
    });
  }
}

if (process.platform === 'win32') {
  await test('install-host.ps1 -Quiet, stdin closed, PS 5.1: under 10 s, exit 0, four registrations, this folder', () => {
    const tag = `QAWTest${process.pid}`;
    const root = `HKCU:\\Software\\${tag}`;
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-inst-'));
    const roots = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-roots-'));
    for (const d of ['Google/Chrome', 'Microsoft/Edge', 'BraveSoftware/Brave-Browser', 'Chromium']) fs.mkdirSync(path.join(roots, d), { recursive: true });
    const t0 = Date.now();
    const r = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(EXT, 'updater', 'install-host.ps1'), '-Quiet', '-RegRoot', root, '-DestDir', dest, '-Roots', roots], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, encoding: 'utf8' });
    const ms = Date.now() - t0;
    try {
      assert.equal(r.status, 0, `exit ${r.status} ${r.error || ''} ${r.stderr}`);
      assert.ok(ms < 10000, `${ms} ms`);
      assert.equal((r.stdout || '').trim(), '', 'quiet prints nothing');
      const cfg = JSON.parse(fs.readFileSync(path.join(dest, 'config.json'), 'utf8').replace(/^﻿/, ''));
      assert.equal(path.resolve(cfg.folder).toLowerCase(), path.resolve(EXT).toLowerCase());
      assert.equal(cfg.token, '');
      const q = spawnSync(PS, ['-NoProfile', '-Command', `foreach($b in 'Google\\Chrome','Microsoft\\Edge','BraveSoftware\\Brave-Browser','Chromium'){ (Get-ItemProperty "${root}\\$b\\NativeMessagingHosts\\com.njburrito.qawrap.updater").'(default)' }`], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
      const paths = q.stdout.trim().split(/\r?\n/);
      assert.equal(paths.length, 4);
      for (const p of paths) assert.equal(p, path.join(dest, 'com.njburrito.qawrap.updater.json'));
      const man = JSON.parse(fs.readFileSync(paths[0], 'utf8'));
      assert.equal(man.path, path.join(dest, 'host.cmd'));
      assert.match(man.allowed_origins[0], /^chrome-extension:\/\/[a-p]{32}\/$/);
    } finally {
      spawnSync(PS, ['-NoProfile', '-Command', `Remove-Item -Recurse -Force "${root}" -ErrorAction SilentlyContinue`], { stdio: 'ignore' });
      fs.rmSync(dest, { recursive: true, force: true });
      fs.rmSync(roots, { recursive: true, force: true });
    }
  });
}
console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n} passed`);
process.exit(failed ? 1 : 0);
