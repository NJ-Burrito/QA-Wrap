/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** T-005: every release refusal fires on its scratch mutation, and the record's zip hash is the file's.  node tools/test-release-guard.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as g from './lib-release-guard.mjs';
import { buildRecord } from './release-record.mjs';
import { shipping, isStrayTopLevel } from './lib-ship.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-rel-'));
const git = (...a) => execFileSync('git', a, { cwd: tmp, encoding: 'utf8' });

// a scratch repo with extension/ and site/
fs.mkdirSync(path.join(tmp, 'extension'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'site'));
fs.writeFileSync(path.join(tmp, 'extension', 'a.js'), '1');
fs.writeFileSync(path.join(tmp, 'site', 'i.html'), 'x');
git('init', '-q');
git('add', '-A');
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'c');

t('a clean tree passes, a dirty tree is refused', () => {
  assert.equal(g.dirtyTree(tmp), null);
  fs.writeFileSync(path.join(tmp, 'extension', 'a.js'), '2');
  assert.match(g.dirtyTree(tmp), /uncommitted/);
});

t('a NEW untracked source file is refused too (it would ship in a zip no commit contains)', () => {
  fs.writeFileSync(path.join(tmp, 'extension', 'a.js'), '1');
  assert.equal(g.dirtyTree(tmp), null, 'R15: the tree is clean again first');
  fs.writeFileSync(path.join(tmp, 'extension', 'new.js'), 'x');
  assert.match(g.dirtyTree(tmp), /new\.js/);
  fs.rmSync(path.join(tmp, 'extension', 'new.js'));
});

t('a zip older than the newest shipped file is refused', () => {
  const newest = g.newestSource(path.join(tmp, 'extension'));
  assert.match(g.staleZip(newest.t - 1000, newest, tmp), /rebuild/);
  assert.equal(g.staleZip(newest.t + 1000, newest, tmp), null);
});

t('a reused or lower version is refused; no tag means fine; v-prefix and numeric order', () => {
  assert.equal(g.versionNotNew('3.2.0', null), null);
  assert.match(g.versionNotNew('3.2.0', 'v3.2.0'), /not greater/);
  assert.match(g.versionNotNew('3.1.9', '3.2.0'), /not greater/);
  assert.equal(g.versionNotNew('3.10.0', 'v3.9.0'), null);
  git('tag', 'v3.2.0');
  git('tag', 'v3.10.0');
  git('tag', 'v3.9.0');
  assert.equal(g.lastTag(tmp), 'v3.10.0');
});

t('a changelog without a dated section is refused', () => {
  assert.match(g.changelogUndated('## Unreleased\n', '3.3.0'), /no dated section/);
  assert.match(g.changelogUndated('## 3.3.0\n', '3.3.0'), /no dated section/);
  assert.equal(g.changelogUndated('## 3.3.0, 2026-10-01\n', '3.3.0'), null);
});

t('a flipped byte in axe.min.js is refused', () => {
  const bytes = Buffer.from('axe-bytes');
  const readme = `- SHA-256: ${g.sha256(bytes)}\n`;
  assert.equal(g.axeMismatch(readme, bytes), null);
  const flipped = Buffer.from(bytes);
  flipped[0] ^= 1;
  assert.match(g.axeMismatch(readme, flipped), /hashes to/);
  assert.match(g.axeMismatch('no hash', bytes), /names no SHA-256/);
});

t('a returned retired sentence is found, case-blind; the real vendor hash holds', () => {
  const list = JSON.parse(fs.readFileSync(new URL('./retired-sentences.json', import.meta.url), 'utf8')).sentences;
  assert.ok(list.length >= 5 && list.every((s) => s.text && s.why));
  assert.equal(g.retiredHits([{ name: 'P.md', text: 'ok' }], list).length, 0);
  assert.equal(g.retiredHits([{ name: 'P.md', text: 'We are TAMPER-PROOF.' }], list).length, 1);
  assert.equal(g.axeMismatch(fs.readFileSync('vendor/README.md', 'utf8'), fs.readFileSync('vendor/axe.min.js')), null);
});

t('the record carries the zip hash of the file on disk', () => {
  const dist = path.join(tmp, 'dist');
  fs.mkdirSync(dist);
  const v = JSON.parse(fs.readFileSync('manifest.json', 'utf8')).version;
  fs.writeFileSync(path.join(dist, `qa-wrap-${v}.zip`), crypto.randomBytes(64));
  const rec = buildRecord({ ext: path.resolve('.'), dist, suites: false });
  assert.equal(rec.zips.length, 1);
  assert.equal(rec.zips[0].sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(dist, `qa-wrap-${v}.zip`))).digest('hex'));
  assert.ok(rec.shippedComponents['vendor/axe.min.js'] && rec.node && rec.playwright && rec.buildOnly.devDependencies);
});

t('a planted _x.mjs and a planted x.mjs are refused by shipping(); _locales and a normal file pass (r10-00-1)', () => {
  const names = ['manifest.json', '_locales', '_x.mjs', 'x.mjs', 'popup', 'background.js'];
  const kept = shipping(names);
  assert.ok(!kept.includes('_x.mjs'), '_x.mjs must not ship');
  assert.ok(!kept.includes('x.mjs'), 'x.mjs must not ship');
  assert.deepEqual(kept, ['_locales', 'background.js', 'manifest.json', 'popup']);
  assert.ok(isStrayTopLevel('_ed9.mjs') && isStrayTopLevel('_scratch') && !isStrayTopLevel('_locales') && !isStrayTopLevel('popup/x.mjs'));
  assert.ok(/isStrayTopLevel\(/.test(fs.readFileSync('tools/release-check.mjs', 'utf8')), 'release-check repeats the rule');
});

t('release-check calls every guard and npm run release writes the record', () => {
  const rc = fs.readFileSync('tools/release-check.mjs', 'utf8');
  for (const f of ['dirtyTree', 'staleZip', 'versionNotNew', 'changelogUndated', 'axeMismatch', 'retiredHits']) assert.ok(rc.includes(`guard.${f}(`), f);
  assert.match(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts.release, /release\.mjs/);
  assert.match(fs.readFileSync('tools/release.mjs', 'utf8'), /release-record\.mjs/);
  assert.ok(!/sync-vendor/.test(fs.readFileSync('vendor/README.md', 'utf8')), 'no dangling sync-vendor reference');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} passed, 0 failed`);
