/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** T-069: the managed flavour is the source tree minus `debugger`, from one flag, with its own gate pass.  node tools/test-managed-flavour.mjs */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DIST } from './lib-paths.mjs';
import { readZip, fileEntries } from './lib-zip.mjs';
import { plan } from './release.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const src = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const run = (script, ...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });

t('the store manifest still requires debugger (DEC-06)', () => assert.ok(src.permissions.includes('debugger')));

t('the default plan has no flavour step; the managed plan doubles the gates', () => {
  const flat = (f) => plan(f).map((s) => s.join(' '));
  assert.ok(!flat(null).some((s) => /managed/.test(s)));
  const m = flat('managed');
  for (const gate of ['release-check.mjs --flavour managed', 'manifest-check.mjs', 'test-boot-smoke.mjs']) {
    assert.ok(m.filter((s) => s.includes(gate)).length >= (gate.startsWith('test-boot') ? 2 : 1), gate);
  }
  assert.ok(m.findIndex((s) => /build-browsers.mjs --flavour managed/.test(s)) < m.findIndex((s) => /release-check.mjs --flavour/.test(s)));
  assert.ok(m.findIndex((s) => /release-record/.test(s)) > m.findIndex((s) => /release-check.mjs --flavour/.test(s)), 'the record hashes the managed zip too');
});

t('an unknown flavour is refused', () => {
  assert.equal(run('tools/build-browsers.mjs', '--flavour', 'bogus').status, 1);
  assert.equal(run('tools/release.mjs', '--flavour', 'bogus').status, 1);
});

t('the managed build drops debugger and only debugger', () => {
  const r = run('tools/build-browsers.mjs', '--flavour', 'managed');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const zip = path.join(DIST, `qa-wrap-${src.version}-chrome-managed.zip`);
  const m = JSON.parse(readZip(zip).entries.get('manifest.json').data().toString('utf8'));
  assert.ok(!m.permissions.includes('debugger') && !(m.optional_permissions || []).includes('debugger'));
  assert.deepEqual(m.permissions, src.permissions.filter((p) => p !== 'debugger'));
  assert.equal(m.key, src.key, 'same extension id as the store build');
  const files = fileEntries(zip);
  assert.ok(files.includes('BROWSER.md') && files.includes('background/service-worker.js'));
  assert.match(readZip(zip).entries.get('BROWSER.md').data().toString('utf8'), /`debugger`/);
});

t('release-check and the record know the flavour', () => {
  const rc = fs.readFileSync('tools/release-check.mjs', 'utf8');
  assert.match(rc, /managed flavour: no debugger permission/);
  const mc = fs.readFileSync('tools/manifest-check.mjs', 'utf8');
  assert.match(mc, /--ext/);
});

console.log(`\n${n} passed, 0 failed`);
