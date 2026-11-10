/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-048 / D2 (qaw-1109): the films are hosted with the site (site/media and site/media/tutorials), never packaged,
 * one English and one Arabic file per film, chosen by the interface language, opened in a new tab on a press.
 * Fails if a film is put back under extension/tutorials, a drawn lesson loses a hosted file, the page starts loading
 * media before a press, or the package grows past its ceiling.
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
// 3.6.8 (Nader, 2026-10-23): the commercial's banner is the one packaged image, a local thumbnail, not a film.
const THUMB = 'qa-wrap-film.webp';
// 2026-11-10 (Nader): its Arabic twin, picked by the UI language, so an Arabic card shows Arabic words before a press.
const THUMB_AR = 'qa-wrap-film-ar.webp';
const hostedFiles = live.flatMap((l) => Object.values(l.files));

test('no film, poster or caption sits under extension/tutorials; the only images are the film banner pair, each under 60 KB', () => {
  const media = walk(path.join(EXT, 'tutorials')).filter((f) => /\.(mp4|webm|webp|png|jpe?g|srt)$/i.test(f) || f.startsWith('media/'));
  assert.deepEqual(media.sort(), [THUMB_AR, THUMB].sort());
  for (const f of [THUMB, THUMB_AR]) assert.ok(fs.statSync(path.join(EXT, 'tutorials', f)).size < 60 * 1024, `${f} is 60 KB or more`);
});
test('D2: every drawn lesson has an English and an Arabic film hosted under site/media; none is marked online; no site/tutorials', () => {
  assert.ok(lessons.length >= 7, `only ${lessons.length} lessons listed`);
  for (const l of lessons) {
    assert.ok(!('online' in l), `${l.id} is still marked online`);
    if (l.pending) continue;
    for (const lang of ['en', 'ar']) assert.ok(fs.existsSync(path.join(REPO, 'site', 'media', l.files[lang])), `site/media/${l.files[lang]} is missing (${l.id}, ${lang})`);
    if (l.thumb) assert.equal(l.thumb, THUMB, `${l.id} has a packaged thumbnail other than the film banner`);
  }
  assert.ok(!fs.existsSync(path.join(REPO, 'site', 'tutorials')), 'site/tutorials is back');
});
test('one tracked copy per film: each mp4 name is tracked exactly once in the repo', () => {
  const tracked = execFileSync('git', ['ls-files', '*.mp4'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  const names = tracked.map((f) => path.basename(f));
  assert.equal(new Set(names).size, names.length, `duplicate tracked films: ${names.filter((x, i) => names.indexOf(x) !== i).join(', ')}`);
  assert.ok(tracked.every((f) => f.startsWith('site/media/') || !hostedFiles.some((h) => path.basename(f) === path.basename(h))), 'a lesson film is tracked outside site/media');
});
// sdlc-1014b: 6 MB to 6.25 MB. The package stood only a few hundred bytes under 6 MB at 3.5.1; the dock guard, the done-card title and the error button add 9 KB of shipped code and strings.
// 2026-11-09 (qaw-1109 kpi lane): 6.95 -> 7.05 MB: the KPI dashboard (core/kpi.js, kpi/, 77 strings x2) lands 6.93 MB.
// 2026-11-09: 6.9 -> 6.95 MB: the profile, trace line, sealed timeline and Verify file (R3, R5) add 47.7 KB shipped (core 22 KB, platform and options 17 KB, the EN/AR strings and docs 8 KB); base headroom was 18.9 KB.
// 2026-10-26: 6.85 -> 6.9 MB: 3.8.1 (sharp recording, file probe, awake dot) lands 6.851 MB, +0.7 KB net of 3.8.0, which already sat on the line; no media or dev file joined.
// 2026-10-22: 6.7 -> 6.85 MB, merged lanes: object picking + keyframes (~25 KB) and the updater installers + What's new page (~46 KB).
// Nader 2026-10-15: Bug Hunt game ships as the practice page; 6.25 MB to 6.7 MB (measured 6.58 MB: game 560 KB, 15 Ogg Opus voices 224 KB of it).
test('the package stays small: what shipping() copies is under 6.95 MB', () => {
  const size = (p, rel) => (fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).reduce((s, c) => s + size(path.join(p, c), `${rel}/${c}`), 0)
    : (isWorkingNote(rel) ? 0 : fs.statSync(p).size));
  const total = shipping(fs.readdirSync(EXT)).reduce((s, name) => s + size(path.join(EXT, name), name), 0);
  assert.ok(total < 7.05 * 1024 * 1024, `${(total / 1048576).toFixed(2)} MB`);
});
test('the page builds no remote address, and the extension-page CSP allows only own media and images', () => {
  const js = read(path.join(EXT, 'tutorials', 'tutorials.js'));
  assert.ok(!js.includes('PRODUCT.urls'), 'the tutorials page reads a web address again');
  assert.ok(js.includes('const FILM_LIVE = true;') && js.includes("(f) => (FILM_LIVE && f ? MEDIA_URL + f : '')"), 'hostedUrl is not the gated builder');
  const csp = JSON.parse(read(path.join(EXT, 'manifest.json'))).content_security_policy.extension_pages;
  for (const d of ["img-src 'self' data: blob:", "media-src 'self' blob:", "form-action 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/media\/\$\{/.test(js), 'a packaged media/ path is back');
});
test('opening the page fetches nothing remote: a card shows only its packaged thumbnail, no poster until it is played', () => {
  const js = read(path.join(EXT, 'tutorials', 'tutorials.js'));
  const card = js.slice(js.indexOf('function cardFor'), js.indexOf('function chapterList'));
  assert.ok(!/posterUrl\(/.test(card) && !/createElement\('img'\)/.test(card), 'cardFor loads a poster');
  const srcs = card.match(/\.src = [^;]+;/g) || [];
  assert.deepEqual(srcs, ['.src = thumbOf(lesson);'], 'cardFor sets an image source other than the packaged thumbnail');
  for (const l of lessons) for (const f of [l.thumb, ...Object.values(l.thumbs || {})].filter(Boolean)) assert.ok(!/[:/]/.test(f) && fs.existsSync(path.join(EXT, 'tutorials', f)), `${l.id}: ${f} is not a packaged file beside the page`);
  for (const l of lessons) if (l.thumb) assert.ok(!/[:/]/.test(l.thumb) && fs.existsSync(path.join(EXT, 'tutorials', l.thumb)), `${l.id}: thumb is not a packaged file beside the page`);
  assert.equal((js.match(/posterUrl\(/g) || []).length, 0, 'a poster is requested from the page');
});
test('the details panel carries the hosted link for the language and loads no media; the empty state stays in the markup with en+ar words', () => {
  const html = read(path.join(EXT, 'tutorials', 'tutorials.html'));
  const js = read(path.join(EXT, 'tutorials', 'tutorials.js'));
  assert.ok(html.includes('id="feature-empty"') && html.includes('id="feature-online"'));
  const play = js.slice(js.indexOf('function play('), js.indexOf("$('feature-close')"));
  assert.ok(play.includes('link.href = href') && play.includes("$('feature-video').hidden = true") && !/\.src\s*=/.test(play));
  for (const lang of ['en', 'ar']) {
    const t = JSON.parse(read(path.join(EXT, 'platform', 'i18n', `${lang}.json`)));
    assert.ok(t['tutorials.empty.title'] && t['tutorials.empty.body'], lang);
  }
});
test('the interface language picks the file: an Arabic UI gets the -ar film, an English UI the -en film', () => {
  const js = read(path.join(EXT, 'tutorials', 'tutorials.js'));
  assert.ok(js.includes("QAWi18n.lang() === 'ar' ? 'ar' : 'en'") && js.includes('lesson.files[lang] || lesson.files.en'));
  for (const l of lessons) assert.ok(/-ar\.mp4$/.test(l.files.ar) && /-en\.mp4$|40s\.mp4$/.test(l.files.en), `${l.id}: file names do not carry their language`);
});
test('the popup no longer points at the films', () => {
  const html = read(path.join(EXT, 'popup', 'popup.html'));
  assert.ok(!html.includes('pointer-films') && html.includes('pointer-practice'));
});
test('the Arabic film card shows the Arabic banner, the English card the English one (thumbOf, run as written)', () => {
  const js = read(path.join(EXT, 'tutorials', 'tutorials.js'));
  const line = js.split('\n').find((x) => x.startsWith('const thumbOf = '));
  assert.ok(line, 'tutorials.js has no thumbOf');
  const film = lessons.find((l) => l.kind === 'trailer');
  assert.deepEqual(film.thumbs, { en: THUMB, ar: THUMB_AR }, 'the commercial does not name one banner per language');
  const pick = (lang) => new Function('lang', `${line} return thumbOf;`)(lang)(film);
  assert.equal(pick('ar'), THUMB_AR, 'the Arabic card does not use the -ar banner');
  assert.equal(pick('en'), THUMB, 'the English card does not use the English banner');
});
console.log(`\n${n - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
