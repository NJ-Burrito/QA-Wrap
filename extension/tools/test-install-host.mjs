/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The updater installer never blocks: install-host.ps1 -Quiet runs under Windows PowerShell 5.1 with stdin closed, finishes in
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
const src = (f) => fs.readFileSync(path.join(EXT, 'updater', f), 'utf8');

await test('no installer prompts; token only from -Token / --token / QAW_GITHUB_TOKEN; -Quiet and --quiet exist', () => {
  assert.ok(!/Read-Host|UserInteractive|Private preview/.test(src('install-host.ps1')));
  assert.ok(!/\bread -r|Private preview/.test(src('install.sh')));
  assert.match(src('install.cmd'), /-Quiet" >nul && exit \/b %RC%/);
  assert.match(src('install-host.ps1'), /QAW_GITHUB_TOKEN/);
  assert.match(src('install.sh'), /QAW_GITHUB_TOKEN[\s\S]*--quiet/);
});

if (process.platform === 'win32') {
  await test('install-host.ps1 -Quiet, stdin closed, PowerShell 5.1: under 10 s, exit 0, four registrations, this folder', () => {
    const tag = `QAWTest${process.pid}`;
    const root = `HKCU:\\Software\\${tag}`;
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-inst-'));
    const t0 = Date.now();
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(EXT, 'updater', 'install-host.ps1'), '-Quiet', '-RegRoot', root, '-DestDir', dest], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, encoding: 'utf8' });
    const ms = Date.now() - t0;
    try {
      assert.equal(r.status, 0, `exit ${r.status} ${r.error || ''} ${r.stderr}`);
      assert.ok(ms < 10000, `${ms} ms`);
      assert.equal((r.stdout || '').trim(), '', 'quiet prints nothing');
      const cfg = JSON.parse(fs.readFileSync(path.join(dest, 'config.json'), 'utf8').replace(/^﻿/, ''));
      assert.equal(path.resolve(cfg.folder).toLowerCase(), path.resolve(EXT).toLowerCase());
      assert.equal(cfg.token, '');
      const q = spawnSync('powershell.exe', ['-NoProfile', '-Command', `foreach($b in 'Google\\Chrome','Microsoft\\Edge','BraveSoftware\\Brave-Browser','Chromium'){ (Get-ItemProperty "${root}\\$b\\NativeMessagingHosts\\com.njburrito.qawrap.updater").'(default)' }`], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
      const paths = q.stdout.trim().split(/\r?\n/);
      assert.equal(paths.length, 4);
      for (const p of paths) assert.equal(p, path.join(dest, 'com.njburrito.qawrap.updater.json'));
      const man = JSON.parse(fs.readFileSync(paths[0], 'utf8'));
      assert.equal(man.path, path.join(dest, 'host.cmd'));
      assert.match(man.allowed_origins[0], /^chrome-extension:\/\/[a-p]{32}\/$/);
    } finally {
      spawnSync('powershell.exe', ['-NoProfile', '-Command', `Remove-Item -Recurse -Force "${root}" -ErrorAction SilentlyContinue`], { stdio: 'ignore' });
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
}
console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n} passed`);
process.exit(failed ? 1 : 0);
