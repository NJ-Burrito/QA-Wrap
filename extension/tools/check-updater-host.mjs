/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The automatic update (1022): the native host swaps the folder in place and rolls back on failure, the profile is untouched,
 * the extension ID is pinned by the manifest key, the only request of a fresh profile is the one release check, and the What's new hook.
 *   node tools/test-update-1022.mjs
 */
/**
 * By hand, Windows only (the host is PowerShell, so this is not a CI suite):  npm run test:updater-host
 * The native host swaps the folder in place, rolls back, refuses foreign zips and addresses, and never touches the profile.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { EXT } from './test-site-powers.mjs';

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n++; console.log(`  ok  ${name}`); } catch (e) { n++; failed++; console.log(`  FAIL ${name}
       ${e.message}`); }
};
// ---- the host itself, on Windows (it is a PowerShell script) ----
const win = process.platform === 'win32';
const ps = (file, args) => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], { encoding: 'utf8' }).trim());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-host-'));
const mkext = (dir, version, key = 'KEY1') => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'QA Wrap', key, version })); fs.writeFileSync(path.join(dir, 'code.js'), `v${version}`); };
const zipOf = (dir, out) => execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${dir}\\*' -DestinationPath '${out}' -Force`]);
const run = (name, version, zip, key) => {
  const base = path.join(tmp, name);
  const ext = path.join(base, 'QA Wrap');
  mkext(ext, '1.0.0');
  fs.mkdirSync(path.join(base, 'Profile'));
  fs.writeFileSync(path.join(base, 'Profile', 'Local Storage.db'), 'tester data');
  const src = path.join(base, 'src');
  mkext(src, version, key);
  zipOf(src, zip(base));
  fs.writeFileSync(path.join(base, 'config.json'), JSON.stringify({ folder: ext, repo: 'NJ-Burrito/QA-Wrap' }));
  fs.writeFileSync(path.join(base, 'msg.json'), JSON.stringify({ op: 'update', version: '1.1.0', localZip: zip(base) }));
  const r = ps(path.join(EXT, 'updater', 'host.ps1'), ['-ConfigPath', path.join(base, 'config.json'), '-MessageFile', path.join(base, 'msg.json')]);
  return { r, ext, base };
};

await test('host: a good zip swaps the folder in place at the same path, keeps one backup, leaves the profile alone', async () => {
  if (!win) return;
  const { r, ext, base } = run('good', '1.1.0', (b) => path.join(b, 'rel.zip'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')).version, '1.1.0');
  assert.equal(fs.readFileSync(path.join(ext, 'code.js'), 'utf8'), 'v1.1.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(`${ext}.backup-1.0.0`, 'manifest.json'), 'utf8')).version, '1.0.0');
  assert.equal(fs.readFileSync(path.join(base, 'Profile', 'Local Storage.db'), 'utf8'), 'tester data');
});

await test('host: a zip for another extension (different key) or the wrong version changes nothing', async () => {
  if (!win) return;
  const a = run('otherkey', '1.1.0', (b) => path.join(b, 'rel.zip'), 'OTHER');
  assert.equal(a.r.ok, false);
  assert.match(a.r.error, /not the same extension/);
  assert.equal(fs.readFileSync(path.join(a.ext, 'code.js'), 'utf8'), 'v1.0.0');
  const b = run('wrongver', '1.2.0', (x) => path.join(x, 'rel.zip'));
  assert.equal(b.r.ok, false);
  assert.match(b.r.error, /expected 1\.1\.0/);
  assert.equal(fs.readFileSync(path.join(b.ext, 'code.js'), 'utf8'), 'v1.0.0');
});

await test('host: it refuses a download address outside the repository', async () => {
  if (!win) return;
  const base = path.join(tmp, 'addr');
  const ext = path.join(base, 'QA Wrap');
  mkext(ext, '1.0.0');
  fs.writeFileSync(path.join(base, 'config.json'), JSON.stringify({ folder: ext }));
  fs.writeFileSync(path.join(base, 'msg.json'), JSON.stringify({ op: 'update', version: '1.1.0', zip: 'https://evil.example/qa-wrap-1.1.0.zip' }));
  const r = ps(path.join(EXT, 'updater', 'host.ps1'), ['-ConfigPath', path.join(base, 'config.json'), '-MessageFile', path.join(base, 'msg.json')]);
  assert.equal(r.ok, false);
  assert.match(r.error, /not this repository/);
  const c = run('sum', '1.1.0', (b) => path.join(b, 'rel.zip'));
  assert.equal(c.r.ok, true); // control: a well-formed local zip passes
});


await test('host (powershell.exe 5.1): token goes to the first hop only; the 302 target is fetched without it', async () => {
  if (!win) return;
  const http = await import('node:http');
  const base = path.join(tmp, 'redir');
  const ext = path.join(base, 'QA Wrap');
  mkext(ext, '1.0.0');
  const src = path.join(base, 'src');
  mkext(src, '1.1.0');
  zipOf(src, path.join(base, 'rel.zip'));
  const seen = [];
  const srv = http.createServer((q, s) => {
    seen.push([q.url, q.headers.authorization || '', q.headers.accept || '']);
    if (q.url === '/asset') { s.writeHead(302, { Location: '/signed' }); return s.end(); }
    s.writeHead(200); s.end(fs.readFileSync(path.join(base, 'rel.zip')));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  fs.writeFileSync(path.join(base, 'config.json'), JSON.stringify({ folder: ext }));
  fs.writeFileSync(path.join(base, 'msg.json'), JSON.stringify({ op: 'update', version: '1.1.0', zipApi: `http://127.0.0.1:${srv.address().port}/asset`, token: 'SECRET-TOKEN' }));
  const out = await new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(EXT, 'updater', 'host.ps1'), '-ConfigPath', path.join(base, 'config.json'), '-MessageFile', path.join(base, 'msg.json')], { encoding: 'utf8' }, (e, o) => (e ? rej(e) : res(o))));
  srv.close();
  const r = JSON.parse(out.trim());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fs.readFileSync(path.join(ext, 'code.js'), 'utf8'), 'v1.1.0');
  assert.deepEqual(seen.map((x) => x[0]), ['/asset', '/signed']);
  assert.equal(seen[0][1], 'Bearer SECRET-TOKEN');
  assert.equal(seen[0][2], 'application/octet-stream');
  assert.equal(seen[1][1], '', 'the redirect target never sees the token');
});

// ---- the macOS/Linux host (bash), when bash, unzip and curl exist ----
const hasBash = (() => { try { execFileSync('bash', ['-c', 'command -v unzip && command -v curl'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const fwd = (p) => p.replaceAll('\\', '/');
const sh = (base, version, zipName) => {
  const ext = path.join(base, 'QA Wrap');
  mkext(ext, '1.0.0');
  fs.mkdirSync(path.join(base, 'Profile'), { recursive: true });
  fs.writeFileSync(path.join(base, 'Profile', 'data.db'), 'tester data');
  const src = path.join(base, 'src');
  mkext(src, version);
  zipOf(src, path.join(base, zipName));
  fs.writeFileSync(path.join(base, 'config.env'), `FOLDER="${fwd(ext)}"\nREPO="NJ-Burrito/QA-Wrap"\n`);
  fs.writeFileSync(path.join(base, 'msg.json'), JSON.stringify({ op: 'update', version: '1.1.0' }));
  const out = execFileSync('bash', [fwd(path.join(EXT, 'updater', 'host.sh'))], { encoding: 'utf8', env: { ...process.env, QAW_CONFIG: fwd(path.join(base, 'config.env')), QAW_MESSAGE_FILE: fwd(path.join(base, 'msg.json')), QAW_LOCAL_ZIP: fwd(path.join(base, zipName)) } });
  return { r: JSON.parse(out.trim().split('\n').pop()), ext, base };
};
await test('host.sh: swap in place, backup kept, profile untouched; a wrong version changes nothing', async () => {
  if (!hasBash) return console.log('       (skipped: no bash/unzip/curl)');
  const a = sh(path.join(tmp, 'sh-good'), '1.1.0', 'rel.zip');
  assert.equal(a.r.ok, true, JSON.stringify(a.r));
  assert.equal(fs.readFileSync(path.join(a.ext, 'code.js'), 'utf8'), 'v1.1.0');
  assert.ok(fs.existsSync(`${a.ext}.backup-1.0.0`));
  assert.equal(fs.readFileSync(path.join(a.base, 'Profile', 'data.db'), 'utf8'), 'tester data');
  const b = sh(path.join(tmp, 'sh-bad'), '1.2.0', 'rel.zip');
  assert.equal(b.r.ok, false);
  assert.equal(fs.readFileSync(path.join(b.ext, 'code.js'), 'utf8'), 'v1.0.0');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `
${failed} of ${n} FAILED` : `
${n} passed`);
process.exit(failed ? 1 : 0);
