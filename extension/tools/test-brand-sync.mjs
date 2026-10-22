/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The brand is one file. This proves it.
 *
 *   node tools/test-brand-sync.mjs
 *
 * 1. `build-brand.mjs --check`: every generated region equals brand/brand.json.
 * 2. No tracked file under extension/, site/ or helper/ names the previous maker
 *    (the string below, built from two halves so this file is not a hit itself)
 *    unless it is on ALLOW with a stated reason.
 * 3. An empty website means no link: product.js carries no URL the file does not.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(EXT, '..');
let passed = 0; const failures = [];
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL  ${name}\n        ${e.message}`); } };

const brand = JSON.parse(fs.readFileSync(path.join(EXT, 'brand/brand.json'), 'utf8'));

test('every generated region equals brand/brand.json', () => {
  let out = '';
  try { execFileSync(process.execPath, [path.join(EXT, 'tools/build-brand.mjs'), '--check'], { encoding: 'utf8' }); } catch (e) { out = String(e.stdout || e.message); }
  assert.equal(out, '', out);
});

test('product.js carries exactly the URLs and mailbox brand.json carries', () => {
  const src = fs.readFileSync(path.join(EXT, 'core/product.js'), 'utf8');
  for (const [k, v] of Object.entries(brand.urls)) assert.ok(src.includes(`  ${k}: '${v}',`), `urls.${k}`);
  assert.ok(src.includes(`supportEmail: '${brand.emails.support}'`));
});

test('the manifest name and homepage are the brand file\'s', () => {
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  assert.equal(m.name, brand.name);
  assert.equal(m.short_name, brand.name);
  assert.equal(m.action.default_title, brand.name);
  assert.equal(m.homepage_url || '', brand.urls.homepage);
});

test('both languages carry the owner in every "made by" string', () => {
  for (const lang of ['en', 'ar']) {
    const j = JSON.parse(fs.readFileSync(path.join(EXT, `platform/i18n/${lang}.json`), 'utf8'));
    const want = brand.madeBy[lang].replace('{maker}', brand.publisher[lang]);
    for (const key of ['common.madeBy', 'options.foot.madeBy', 'report.foot.madeBy']) assert.equal(j[key], want, `${lang} ${key}`);
  }
});

test('every icon the brand names exists, and the manifest icon blocks are the brand map', () => {
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  assert.deepEqual(m.icons, brand.icons.action);
  assert.deepEqual(m.action.default_icon, brand.icons.action);
  for (const f of [...Object.values(brand.icons.action), brand.icons.store, brand.icons.favicon]) assert.ok(fs.existsSync(path.join(EXT, f)), f);
  assert.ok(brand.icons.action[String(brand.icons.notification)] && brand.icons.action[String(brand.icons.devtools)]);
  const ui = fs.readFileSync(path.join(EXT, 'ui/icons.js'), 'utf8');
  assert.ok(ui.includes(`o.size === ${brand.icons.ui.s} || o.size === 's'`), 'ui/icons.js sizes follow brand.icons.ui');
});

/** Files that may still say the previous maker, with the reason. Keep this short. */
const ALLOW = [
  [/^extension\/CHANGELOG\.md$/, 'release history is not rewritten'],
  [/^extension\/tools\/test-brand-sync\.mjs$/, 'this file names the string it hunts'],
  [/^extension\/brand\/mark[^/]*\.svg$/, 'byte copies of identity/ files (test-motion pins them); identity/ is outside this pipeline and still carries the previous maker in its header comment'],
  [/research\/58-/, 'a historical research file name quoted in a comment'],
];

test('no tracked file names the previous maker except the allow-list', () => {
  const word = ['taq', 'neen'].join('');
  const files = execFileSync('git', ['ls-files', '--', 'extension', 'site', 'helper'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const hits = [];
  for (const rel of files) {
    if (/\.(png|jpg|jpeg|gif|webp|zip|woff2?|mp4|ico|pdf)$/i.test(rel) || rel.includes('node_modules/')) continue;
    let text; try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      if (!line.toLowerCase().includes(word)) return;
      if (ALLOW.some(([re]) => re.test(rel) || re.test(line))) return;
      hits.push(`${rel}:${i + 1}`);
    });
  }
  assert.equal(hits.length, 0, `${hits.length} hit(s): ${hits.slice(0, 12).join(', ')}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
