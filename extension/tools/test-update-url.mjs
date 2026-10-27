/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Updater hardening (security audit 2026-10-27): the download address is compared as a whole, a checksum is mandatory,
 * the host never replaces itself from the zip, and config.env is never sourced.
 * The `../` bypass of the old prefix test must fail in the JS check and in host.sh (bash). host.ps1 gets the same cases in
 * tools/check-updater-host.mjs (by hand, Windows only: CI runs the bash host only).
 *   node tools/test-update-url.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EXT } from './test-site-powers.mjs';
import { isReleaseZipUrl, pickRelease } from '../core/update-check.js';

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n++; console.log(`  ok  ${name}`); } catch (e) { n++; failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};
const REPO = 'NJ-Burrito/QA-Wrap';
const GOOD = `https://github.com/${REPO}/releases/download/v3.8.2/qa-wrap-3.8.2-chrome.zip`;
const BAD = {
  'dot-dot bypass (the audit case)': `https://github.com/${REPO}/releases/download/../../../../evil/repo/releases/download/v9.9.9/x.zip`,
  'dot-dot right after download': `https://github.com/${REPO}/releases/download/../x.zip`,
  'encoded dots': `https://github.com/${REPO}/releases/download/%2e%2e/%2e%2e/evil/repo/releases/download/v9/x.zip`,
  'encoded slash': `https://github.com/${REPO}/releases/download/v1%2f..%2fx/x.zip`,
  'other repo': 'https://github.com/evil/repo/releases/download/v9.9.9/x.zip',
  'repo prefix only (QA-Wrap-evil)': 'https://github.com/NJ-Burrito/QA-Wrap-evil/releases/download/v9/x.zip',
  'http': GOOD.replace('https', 'http'),
  'userinfo host trick': `https://github.com@evil.example/${REPO}/releases/download/v9/x.zip`,
  'port': GOOD.replace('github.com', 'github.com:444'),
  'query string': `${GOOD}?x=1`,
  'fragment': `${GOOD}#x`,
  'backslash': GOOD.replace('/v3.8.2/', '/v3.8.2\\..\\'),
  'not a zip': GOOD.replace('.zip', '.exe'),
  'other host': GOOD.replace('github.com', 'githubusercontent.com'),
  'lookalike case': GOOD.replace('NJ-Burrito', 'nj-burrito'),
  'newline smuggle': `${GOOD}\nhttps://evil.example/x.zip`,
};

await test('JS: the release URL check accepts the repo\'s own zip and refuses every bypass', () => {
  assert.equal(isReleaseZipUrl(GOOD, REPO), true);
  for (const [why, u] of Object.entries(BAD)) assert.equal(isReleaseZipUrl(u, REPO), false, why);
  assert.equal(isReleaseZipUrl(GOOD, 'OWNER/REPO'), false);
});

await test('JS: pickRelease drops a zip asset whose URL escapes the repository', () => {
  const rel = (u) => pickRelease({ tag_name: 'v3.8.2', assets: [{ name: 'qa-wrap-3.8.2-chrome.zip', browser_download_url: u }] }, REPO, 'chrome');
  assert.equal(rel(GOOD).zip, GOOD);
  assert.equal(rel(BAD['dot-dot bypass (the audit case)']).zip, '');
});

// ---- the real hosts, through their real entry (a message file) ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-url-'));
const fwd = (p) => p.replaceAll('\\', '/');
const mkext = (dir, version) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'QA Wrap', key: 'KEY1', version })); fs.writeFileSync(path.join(dir, 'code.js'), `v${version}`); };
const setup = (name) => {
  const base = path.join(tmp, name);
  const ext = path.join(base, 'QA Wrap');
  mkext(ext, '1.0.0');
  fs.writeFileSync(path.join(base, 'config.json'), JSON.stringify({ folder: ext, repo: REPO }));
  fs.writeFileSync(path.join(base, 'config.env'), `FOLDER="${fwd(ext)}"\nREPO="${REPO}"\n`);
  return { base, ext };
};
const hasBash = (() => { try { execFileSync('bash', ['-c', 'command -v unzip && command -v curl'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const runSh = (base, msg, extraEnv = {}) => {
  fs.writeFileSync(path.join(base, 'msg.json'), JSON.stringify({ op: 'update', version: '1.1.0', ...msg }));
  const out = execFileSync('bash', [fwd(path.join(EXT, 'updater', 'host.sh'))], { encoding: 'utf8', env: { ...process.env, QAW_CONFIG: fwd(path.join(base, 'config.env')), QAW_MESSAGE_FILE: fwd(path.join(base, 'msg.json')), ...extraEnv } });
  return JSON.parse(out.trim().split('\n').pop());
};
await test('host.sh: every bad download address is refused before any request, and the folder is untouched', () => {
  if (!hasBash) return console.log('       (skipped: no bash/unzip/curl)');
  const { base, ext } = setup('sh-url');
  for (const [why, u] of Object.entries(BAD)) {
    if (u.includes('\n')) continue; // a newline cannot ride the sed-parsed JSON field; the check is covered in JS
    const r = runSh(base, { zip: u });
    assert.equal(r.ok, false, why);
    assert.match(r.error, /not this repository/, why);
  }
  assert.equal(fs.readFileSync(path.join(ext, 'code.js'), 'utf8'), 'v1.0.0');
});

const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** A stored (uncompressed) zip with the given entries, written in Node so the suite needs no zip tool. */
const writeZip = (file, entries) => {
  const parts = []; const central = []; let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const nm = Buffer.from(name); const d = Buffer.from(data); const crc = crc32(d);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc, 14); head.writeUInt32LE(d.length, 18); head.writeUInt32LE(d.length, 22); head.writeUInt16LE(nm.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(d.length, 20); cen.writeUInt32LE(d.length, 24); cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(head, nm, d); central.push(cen, nm); offset += 30 + nm.length + d.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, end]));
};
const zipDir = (base, extra = {}) => {
  const z = path.join(base, 'rel.zip');
  writeZip(z, { 'manifest.json': JSON.stringify({ name: 'QA Wrap', key: 'KEY1', version: '1.1.0' }), 'code.js': 'v1.1.0', ...extra });
  return z;
};
const sum = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

await test('host.sh: a download with no checksum, or the wrong one, is refused; the right one installs', () => {
  if (!hasBash) return console.log('       (skipped: no bash/unzip/curl)');
  const { base, ext } = setup('sh-sum');
  const z = zipDir(base);
  const env = { QAW_LOCAL_ZIP: fwd(z) };
  const a = runSh(base, {}, env);
  assert.equal(a.ok, false); assert.match(a.error, /no checksum/);
  const b = runSh(base, { sha256: '0'.repeat(64) }, env);
  assert.equal(b.ok, false); assert.match(b.error, /checksum mismatch/);
  assert.equal(fs.readFileSync(path.join(ext, 'code.js'), 'utf8'), 'v1.0.0');
  const c = runSh(base, { sha256: sum(z) }, env);
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(fs.readFileSync(path.join(ext, 'code.js'), 'utf8'), 'v1.1.0');
});

await test('host.sh: a zip entry that climbs out of the folder is refused before anything is extracted', () => {
  if (!hasBash) return console.log('       (skipped: no bash/unzip/curl)');
  const { base, ext } = setup('sh-slip');
  const z = zipDir(base, { '../evil.txt': 'x' });
  const r = runSh(base, { sha256: sum(z) }, { QAW_LOCAL_ZIP: fwd(z) });
  assert.equal(r.ok, false); assert.match(r.error, /unsafe path/);
  assert.ok(!fs.existsSync(path.join(base, 'evil.txt')) && !fs.existsSync(path.join(path.dirname(base), 'evil.txt')));
  assert.equal(fs.readFileSync(path.join(ext, 'code.js'), 'utf8'), 'v1.0.0');
});

await test('host.sh: config.env is data, not code (a command substitution in a value does not run)', () => {
  if (!hasBash) return console.log('       (skipped: no bash/unzip/curl)');
  const { base } = setup('sh-cfg');
  const mark = path.join(base, 'PWNED');
  fs.appendFileSync(path.join(base, 'config.env'), `TOKEN="$(touch ${fwd(mark)})"\n`);
  runSh(base, { zip: BAD['other repo'] });
  assert.ok(!fs.existsSync(mark), 'config.env must never be sourced');
});

await test('the hosts never overwrite their own scripts from the zip, and both demand a checksum', () => {
  const ps = fs.readFileSync(path.join(EXT, 'updater', 'host.ps1'), 'utf8');
  const sh = fs.readFileSync(path.join(EXT, 'updater', 'host.sh'), 'utf8');
  assert.ok(!/Copy-Item[^\n]*\$PSScriptRoot/.test(ps), 'host.ps1 must not copy scripts over itself');
  assert.ok(!/^\s*\.\s+"\$CONFIG"/m.test(sh), 'host.sh must not source its config');
  for (const src of [ps, sh]) assert.match(src, /no checksum for this download/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n} passed`);
process.exit(failed ? 1 : 0);
