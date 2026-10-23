/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-048: the films are hosted with the site, never packaged, and the page has a designed empty state
 * for a film that cannot arrive. Fails if a film is put back under extension/tutorials, a lesson stops
 * being hosted, a hosted file goes missing, or the package grows past its ceiling.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shipping, isWorkingNote } from './lib-ship.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(EXT, '..');
let failed = 0;
let n = 0;
const test = (name, fn) => { n++; try { fn(); console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]);

const lessons = JSON.parse(read(path.join(EXT, 'tutorials', 'lessons.json')));
const live = lessons.filter((l) => !l.pending);

test('no film, poster or caption sits under extension/tutorials', () => {
  const media = walk(path.join(EXT, 'tutorials')).filter((f) => /\.(mp4|webm|webp|png|jpe?g|srt)$/i.test(f) || f.startsWith('media/'));
  assert.deepEqual(media, []);
});
test('S-07 (sdlc-1014): no film is hosted or packaged; every lesson is pending and none points at remote media', () => {
  assert.ok(lessons.length >= 20, `only ${lessons.length} lessons listed`);
  for (const l of lessons) {
    assert.equal(l.pending, true, `${l.id} is not pending`);
    assert.ok(!('online' in l), `${l.id} is still marked online`);
  }
  assert.ok(!fs.existsSync(path.join(REPO, 'site', 'tutorials')), 'site/tutorials is back');
});
test('one tracked copy per film: each mp4 name is tracked exactly once in the repo', () => {
  const tracked = execFileSync('git', ['ls-files', '*.mp4'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  const names = tracked.map((f) => path.basename(f));
  assert.equal(new Set(names).size, names.length, `duplicate tracked films: ${names.filter((x, i) => names.indexOf(x) !== i).join(', ')}`);
  assert.ok(tracked.every((f) => f.startsWith('site/tutorials/') || !live.some((l) => path.basename(f) === l.files.en)), 'a lesson film is tracked outside site/tutorials');
});
// sdlc-1014b: 6 MB to 6.25 MB. The package stood only a few hundred bytes under 6 MB at 3.5.1; the dock guard, the done-card title and the error button add 9 KB of shipped code and strings.
// 2026-10-22: 6.7 -> 6.85 MB, merged lanes: object picking + keyframes (~25 KB) and the updater installers + What's new page (~46 KB).
// Nader 2026-10-15: Bug Hunt game ships as the practice page; 6.25 MB to 6.7 MB (measured 6.58 MB: game 560 KB, 15 Ogg Opus voices 224 KB of it).
test('the package stays small: what shipping() copies is under 6.85 MB', () => {
  const size = (p, rel) => (fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).reduce((s, c) => s + size(path.join(p, c), `${rel}/${c}`), 0)
    : (isWorkingNote(rel) ? 0 : fs.statSync(p).size));
  const total = shipping(fs.readdirSync(EXT)).reduce((s, name) => s + size(path.join(EXT, name), name), 0);
  assert.ok(total < 6.85 * 1024 * 1024, `${(total / 1048576).toFixed(2)} MB`);
});
test('the page builds no remote address, and the extension-page CSP allows only own media and images', () => {
  const js = read(path.join(EXT, 'tutorials', 'tutorials.js'));
  assert.ok(!js.includes('PRODUCT.urls'), 'the tutorials page reads a web address again');
  assert.ok(js.includes('const FILM_LIVE = false;') && js.includes("(f) => (FILM_LIVE && f === FILM_FILE ? FILM_URL : '')"), 'hostedUrl is not the gated stub');
  const csp = JSON.parse(read(path.join(EXT, 'manifest.json'))).content_security_policy.extension_pages;
  for (const d of ["img-src 'self' data: blob:", "media-src 'self' blob:", "form-action 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/media\/\$\{/.test(js), 'a packaged media/ path is back');
});
test('opening the page fetches nothing: no poster is set until a card is played', () => {
  const js = read(path.join(EXT, 'tutorials', 'tutorials.js'));
  const card = js.slice(js.indexOf('function cardFor'), js.indexOf('function cardFor') + 1600);
  assert.ok(!/posterUrl\(/.test(card) && !/createElement\('img'\)/.test(card), 'cardFor loads a poster');
  assert.equal((js.match(/posterUrl\(/g) || []).length, 1, 'posterUrl is used once, in the player');
});
test('the empty state exists, is wired to offline and to a failed load, and has en+ar words', () => {
  const html = read(path.join(EXT, 'tutorials', 'tutorials.html'));
  const js = read(path.join(EXT, 'tutorials', 'tutorials.js'));
  assert.ok(html.includes('id="feature-empty"'));
  assert.ok(js.includes('setEmpty(!navigator.onLine)') && js.includes('video.onerror') && js.includes('setEmpty(true)'));
  for (const lang of ['en', 'ar']) {
    const t = JSON.parse(read(path.join(EXT, 'platform', 'i18n', `${lang}.json`)));
    assert.ok(t['tutorials.empty.title'] && t['tutorials.empty.body'], lang);
  }
});
test('the popup no longer points at the films', () => {
  const html = read(path.join(EXT, 'popup', 'popup.html'));
  assert.ok(!html.includes('pointer-films') && html.includes('pointer-practice'));
});
console.log(`\n${n - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
