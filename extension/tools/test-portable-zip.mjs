/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-039: the browser zip is written by Node alone. Loads the zipDir block out of
 * build-browsers.mjs (the file runs a build when imported, so the block is cut out
 * by its markers), zips a scratch tree, and reads it back with the repo's reader and,
 * when Python is present, with Python's own CRC-checking zipfile.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readZip, fileEntries } from './lib-zip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, 'build-browsers.mjs'), 'utf8');
const a = src.indexOf('// zipdir:begin');
const b = src.indexOf('// zipdir:end');
assert.ok(a >= 0 && b > a, 'zipdir markers present in build-browsers.mjs');
const mod = `import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';\n${src.slice(a, b)}\nexport { zipDir };`;
const { zipDir } = await import('data:text/javascript;base64,' + Buffer.from(mod).toString('base64'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-zip-'));
const tree = path.join(tmp, 'tree');
const files = {
  'manifest.json': '{"name":"x"}\n',
  'popup/popup.js': 'export const a = 1;\n'.repeat(500),
  'ui/deep/er/file.css': 'a{}',
  'vendor/empty.txt': '',
  'locales/ar/تقرير.json': '{"k":"قيمة"}',
  'bin.dat': Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) & 255)),
};
for (const [rel, body] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
  fs.writeFileSync(path.join(tree, rel), body);
}
fs.mkdirSync(path.join(tree, 'emptydir'));

const out = path.join(tmp, 'a.zip');
zipDir(tree, out);

const names = fileEntries(out);
assert.deepEqual(names, Object.keys(files).sort(), 'every file, forward-slash names, sorted, no folder markers');
const z = readZip(out);
for (const [rel, body] of Object.entries(files)) {
  assert.deepEqual(z.entries.get(rel).data(), Buffer.from(body), `${rel} round-trips`);
}

zipDir(tree, path.join(tmp, 'b.zip'));
assert.deepEqual(fs.readFileSync(out), fs.readFileSync(path.join(tmp, 'b.zip')), 'same tree, same bytes');

const py = spawnSync('python', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(len(z.namelist()))', out], { encoding: 'utf8' });
if (py.status === 0) {
  assert.equal(py.stdout.trim().split(/\r?\n/)[0], 'None', 'python zipfile: every CRC matches');
  assert.equal(py.stdout.trim().split(/\r?\n/)[1], String(names.length), 'python zipfile: same entry count');
} else {
  console.log('  NOT VERIFIED: python zipfile cross-check (python not available)');
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`  ok  portable zip: ${names.length} entries, round-trip, reproducible${py.status === 0 ? ', python CRC check' : ''}`);
