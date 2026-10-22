/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/** T-061 T-056: ADMIN.md documents exactly the keys managed-schema.json defines; the Trust page is bound to real tests. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r) => fs.readFileSync(path.join(EXT, r), 'utf8');
let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FAIL', name, '-', e.message); process.exitCode = 1; } };

const schema = JSON.parse(read('managed-schema.json'));
const admin = read('ADMIN.md');
const keys = Object.keys(schema.properties);

t('ADMIN.md has a table row for every managed-schema key and no other key', () => {
  const rows = [...admin.matchAll(/^\| `([A-Za-z]+)` \| (?:boolean|string|integer|array)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(rows, [...keys].sort());
});
t('ADMIN.md lists every enum value of an enumerated key', () => {
  for (const [k, def] of Object.entries(schema.properties)) {
    for (const v of def.enum || []) assert.ok(admin.includes(`\`${v}\``), `${k}=${v}`);
  }
});
t('ADMIN.md covers the recipes and the honest limits', () => {
  for (const s of ['installation_mode', 'runtime_allowed_hosts', 'runtime_blocked_hosts', 'toolbar_pin', 'blocked_permissions',
    'desktopCapture', 'permanent grant', 'Mirror and pin', 'single sign-on', 'central audit log', 'data residency']) assert.ok(admin.includes(s), s);
  assert.match(admin, /unconfirmed/i, 'untested recipes are marked');
  assert.match(admin, /Do \*\*not\*\* put `debugger` in `blocked_permissions`/);
});
t('the worked JSON example parses and uses only schema keys', () => {
  const ex = [...admin.matchAll(/```json\n(\{ "microphoneAllowed"[^`]*)```/g)][0];
  assert.ok(ex, 'managed-storage example');
  for (const k of Object.keys(JSON.parse(ex[1]))) assert.ok(keys.includes(k), k);
});
t('every json block in ADMIN.md is valid JSON', () => {
  for (const m of admin.matchAll(/```json\n([\s\S]*?)```/g)) JSON.parse(m[1]);
});

// --- T-056: the Trust page ---
const trust = fs.readFileSync(path.join(EXT, '..', 'site', 'trust.html'), 'utf8');
const pkg = JSON.parse(read('package.json')).scripts['test:chain'];
t('trust page names only tests that exist and are in the chain', () => {
  const names = new Set([...trust.matchAll(/tools\/(test-[\w-]+\.mjs)/g)].map((m) => m[1]));
  assert.ok(names.has('test-independent.mjs') && names.has('test-permissions.mjs'));
  for (const n of names) {
    assert.ok(fs.existsSync(path.join(EXT, 'tools', n)), `${n} exists`);
    assert.ok(pkg.includes(`tools/${n}`), `${n} is in scripts.test`);
  }
});
t('trust page never says "verified" and keeps the exception wording, 30 days, debugger', () => {
  assert.doesNotMatch(trust, /\bverified\b/i);
  assert.match(trust, /except where you configure\s+Jira, a tracker or a webhook/);
  assert.match(trust, /30 days/);
  assert.match(trust, /<code>debugger<\/code>/);
  assert.doesNotMatch(trust, /tamper-proof|evidence you can sign/i);
});
t('trust page has an English and an Arabic block with the same section count', () => {
  const en = trust.split('data-lang-block="ar" lang="ar" dir="rtl">\n\n    <section class="hero">')[0];
  const ar = trust.split('data-lang-block="ar" lang="ar" dir="rtl">\n\n    <section class="hero">')[1];
  assert.ok(ar, 'arabic block');
  const h2 = (s) => (s.match(/<h2>/g) || []).length;
  assert.equal(h2(en.slice(en.indexOf('<main'))), h2(ar.slice(0, ar.indexOf('</main>'))));
});
t('trust page quotes the axe hash that vendor/README.md records, and the file matches', () => {
  const rec = read('vendor/README.md').match(/SHA-256: ([0-9a-f]{64})/)[1];
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(EXT, 'vendor', 'axe.min.js'))).digest('hex'), rec);
  assert.match(trust, /vendor\/README\.md/);
});
t('every site page links to the trust page', () => {
  for (const p of ['index', 'privacy', 'support', 'terms', 'trust']) {
    assert.match(fs.readFileSync(path.join(EXT, '..', 'site', `${p}.html`), 'utf8'), /href="trust\.html"/, p);
  }
});

console.log(`${passed} passed${process.exitCode ? ', FAILURES above' : ''}`);
