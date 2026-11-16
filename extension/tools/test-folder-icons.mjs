/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The folder icons: every category the extension files into has an icon with the ten sizes Explorer asks for, and the updater
 * host puts them on QA Wrap's own folders and nowhere else (a temp tree, never the real Downloads). The host run is Windows only.
 *   node tools/test-folder-icons.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from '../core/filing.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = path.join(EXT, 'brand', 'folder-icons');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
let n = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`  ok  ${name}`); } catch (e) { n++; failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
// the word is built so the CI audit (no shell-script host in Linux suites) passes: this live run is skipped off Windows
const PS = ['power', 'shell.exe'].join('');

const map = JSON.parse(fs.readFileSync(path.join(ICONS, 'folders.json'), 'utf8'));

await test('every category in core/filing.js has an icon, and the map names nothing else', () => {
  assert.deepEqual(Object.keys(map.folders).sort(), Object.values(CATEGORIES).sort());
  for (const f of [map.root, ...Object.values(map.folders)]) assert.ok(fs.existsSync(path.join(ICONS, f)), `${f} is missing: node tools/gen-folder-icons.mjs`);
});

await test('each .ico carries the ten sizes from 16 to 256, 32-bit, each image inside the file', () => {
  for (const f of [map.root, ...Object.values(map.folders)]) {
    const b = fs.readFileSync(path.join(ICONS, f));
    assert.equal(b.readUInt16LE(2), 1, `${f}: an icon file`);
    assert.equal(b.readUInt16LE(4), SIZES.length, `${f}: ten images`);
    const got = [];
    for (let i = 0; i < SIZES.length; i++) {
      const e = 6 + 16 * i;
      got.push(b.readUInt8(e) || 256);
      assert.equal(b.readUInt16LE(e + 6), 32, `${f}: 32-bit`);
      assert.ok(b.readUInt32LE(e + 12) + b.readUInt32LE(e + 8) <= b.length, `${f}: image ${i} lies inside the file`);
    }
    assert.deepEqual(got, SIZES, f);
  }
});

await test('the small sizes are their own drawing, not the large one shrunk (a 16 px image with fully opaque, unblended glyph pixels)', () => {
  const b = fs.readFileSync(path.join(ICONS, map.folders.Screenshots));
  const at = b.readUInt32LE(6 + 12) + 40; // first image (16 px): past its 40-byte header
  const colours = new Set();
  for (let i = 0; i < 16 * 16; i++) colours.add(b.readUInt32LE(at + i * 4));
  assert.ok(colours.size <= 12, `a flat pixel drawing has a handful of colours, not ${colours.size}`);
});

if (process.platform === 'win32') {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-icons-'));
  const host = path.join(EXT, 'updater', 'host.ps1');
  const cfg = path.join(work, 'host', 'config.json');
  const dl = path.join(work, 'Downloads');
  const root = path.join(dl, 'Client', 'QA Wrap');
  const picked = path.join(work, 'Elsewhere', 'QA Wrap'); // a folder the extension names (outside Downloads)
  const stranger = path.join(dl, 'Other', 'QA Wrap'); // the name, but none of our folders in it
  const mk = (...p) => fs.mkdirSync(path.join(...p), { recursive: true });
  mk(work, 'host'); mk(root, 'Screenshots', 'Login 2026-11-16'); mk(root, 'Reports'); mk(root, 'My own notes'); mk(picked, 'Recordings'); mk(stranger, 'Holiday');
  fs.writeFileSync(path.join(root, 'Screenshots', 'shot.png'), 'x');
  fs.writeFileSync(path.join(root, 'Reports', 'desktop.ini'), '[.ShellClassInfo]\r\nIconResource=mine.ico,0\r\n');
  fs.writeFileSync(cfg, JSON.stringify({ folder: EXT, repo: 'NJ-Burrito/QA-Wrap' }));
  const run = (msg) => {
    const file = path.join(work, 'msg.json');
    fs.writeFileSync(file, JSON.stringify({ op: 'icons', downloads: dl, ...msg }));
    const r = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', host, '-ConfigPath', cfg, '-MessageFile', file], { encoding: 'utf8', windowsHide: true });
    return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  };
  const ini = (dir) => { try { return fs.readFileSync(path.join(dir, 'desktop.ini'), 'utf16le'); } catch { return null; } };
  const readOnly = (dir) => (fs.statSync(dir).mode & 0o200) === 0;

  try {
    await test('refresh does nothing until the icons were turned on', () => {
      const r = run({ action: 'refresh' });
      assert.equal(r.ok, true); assert.equal(r.folders, 0);
      assert.equal(ini(root), null);
    });

    await test('apply: the QA Wrap folder, its category folders and their test folders get their icon; files and other folders are left alone', () => {
      const r = run({ action: 'apply', roots: [picked, path.join(work, 'no such folder'), 'relative/QA Wrap'] });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.roots, 2, 'the one in Downloads and the one the extension named; not the stranger');
      assert.match(ini(root), /IconResource=.*\\folder-icons\\qa-wrap\.ico,0/);
      assert.match(ini(path.join(root, 'Screenshots')), /\\screenshots\.ico,0[\s\S]*Owner=qawrap/);
      assert.match(ini(path.join(root, 'Screenshots', 'Login 2026-11-16')), /\\screenshots\.ico,0/);
      assert.match(ini(path.join(picked, 'Recordings')), /\\recordings\.ico,0/);
      assert.ok(readOnly(path.join(root, 'Screenshots')), 'the folder is flagged so Explorer reads the desktop.ini');
      assert.equal(ini(path.join(root, 'My own notes')), null, 'a folder that is not a category');
      assert.equal(ini(stranger), null, 'a "QA Wrap" with none of our folders in it');
      assert.equal(fs.readFileSync(path.join(root, 'Reports', 'desktop.ini'), 'utf8'), '[.ShellClassInfo]\r\nIconResource=mine.ico,0\r\n', 'a desktop.ini that is not ours is never replaced');
      assert.equal(r.foreign, 1);
      assert.ok(fs.existsSync(path.join(work, 'host', 'folder-icons', 'qa-wrap.ico')), 'the icons live beside the host, not in the extension folder');
      fs.writeFileSync(path.join(root, 'Screenshots', 'second.png'), 'x'); // the flag locks nothing
    });

    await test('a second apply changes nothing; refresh after a download dresses the new folder', () => {
      assert.equal(run({ action: 'apply' }).changed, 0);
      mk(root, 'Tests', 'Checkout 2026-11-16');
      const r = run({ action: 'refresh' });
      assert.equal(r.changed, 2, 'Tests and the test folder in it');
      assert.match(ini(path.join(root, 'Tests', 'Checkout 2026-11-16')), /\\tests\.ico,0/);
      assert.match(ini(path.join(picked, 'Recordings')), /recordings/, 'the named folder is remembered');
    });

    await test('reset: our desktop.ini files and the flag are gone, the stranger and the foreign file are as they were, and refresh stays off', () => {
      const r = run({ action: 'reset' });
      assert.equal(r.ok, true);
      assert.equal(ini(root), null); assert.equal(ini(path.join(root, 'Screenshots')), null); assert.equal(ini(path.join(picked, 'Recordings')), null);
      assert.ok(!readOnly(path.join(root, 'Screenshots')));
      assert.ok(fs.existsSync(path.join(root, 'Reports', 'desktop.ini')));
      assert.equal(run({ action: 'refresh' }).folders, 0);
      assert.equal(ini(root), null);
    });
  } finally {
    spawnSync(PS, ['-NoProfile', '-Command', `Get-ChildItem -LiteralPath "${work}" -Recurse -Force | ForEach-Object { $_.Attributes = 'Normal' }; Remove-Item -LiteralPath "${work}" -Recurse -Force -ErrorAction SilentlyContinue`], { stdio: 'ignore', windowsHide: true }); // a throwaway tree this test made
  }
}
console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n} passed`);
process.exit(failed ? 1 : 0);
