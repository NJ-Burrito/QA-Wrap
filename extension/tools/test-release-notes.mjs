/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** tools/release-notes.mjs cuts one version's section out of CHANGELOG.md.  node tools/test-release-notes.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractNotes } from './release-notes.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const LOG = ['# Changelog', '', '## 3.6.0, 2026-11-01', '', '### Added', '', '- New thing', '', '## 3.5.10, 2026-10-30', '', 'Ten.', '', '## 3.5.1, 2026-10-01', '', 'One.', '', '## 3.5.0', 'Zero.', ''].join('\n');

test('a section runs from its heading to the next ## heading, heading line dropped', () => {
  assert.equal(extractNotes(LOG, '3.6.0'), '### Added\n\n- New thing');
  assert.equal(extractNotes(LOG, 'v3.6.0'), '### Added\n\n- New thing', 'a leading v is accepted');
});
test('3.5.1 does not match 3.5.10, and a heading with no date works', () => {
  assert.equal(extractNotes(LOG, '3.5.1'), 'One.');
  assert.equal(extractNotes(LOG, '3.5.10'), 'Ten.');
  assert.equal(extractNotes(LOG, '3.5.0'), 'Zero.');
});
test('an Unreleased section is never a version: it cannot be picked, and it ends the section above it', () => {
  const log = '# Changelog\n\n## Unreleased\n\n- Pending\n\n## 3.5.0\nZero.\n';
  assert.equal(extractNotes(log, '3.5.0'), 'Zero.');
  assert.equal(extractNotes(log, 'Unreleased'), null);
  assert.equal(extractNotes(log, '3.6.0'), null);
  assert.match(fs.readFileSync(path.join(EXT, 'CHANGELOG.md'), 'utf8'), /^## Unreleased$/m);
});
test('a missing, empty or malformed version gives null; CRLF input works', () => {
  assert.equal(extractNotes(LOG, '9.9.9'), null);
  assert.equal(extractNotes('## 1.0.0\n\n## 0.9.0\nx', '1.0.0'), null);
  assert.equal(extractNotes(LOG, '3.5'), null);
  assert.equal(extractNotes(LOG, '3.5.x'), null);
  assert.equal(extractNotes(LOG.replace(/\n/g, '\r\n'), '3.5.1'), 'One.');
});
test('the CLI prints the real CHANGELOG section and exits 1 for an unknown version', () => {
  const ok = spawnSync(process.execPath, ['tools/release-notes.mjs', 'v3.5.3'], { cwd: EXT, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Bug Hunt/);
  assert.ok(!ok.stdout.startsWith('## '), 'no heading line');
  const bad = spawnSync(process.execPath, ['tools/release-notes.mjs', 'v99.0.0'], { cwd: EXT, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /no CHANGELOG section for v99\.0\.0/);
});
test('the release workflow uses the extractor and attaches the zips (static check)', () => {
  const y = fs.readFileSync(path.join(EXT, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(y, /tags:\s*\n\s*- 'v\*'/);
  assert.match(y, /release-notes\.mjs/);
  assert.match(y, /gh release create/);
  assert.ok(!/git push/.test(y));
});
console.log(`\n${n} passed`);
