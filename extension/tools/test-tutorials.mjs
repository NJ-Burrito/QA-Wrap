/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The tutorials manifest and the page that reads it (run qaw-1109, R2 / D1 / D2).
 *
 *   node tools/test-tutorials.mjs
 *
 * `tutorials/lessons.json` is the whole index of the films page: the commercial, then six illustrated
 * tutorials, each an English and an Arabic film hosted on the site. It is written by
 * `videos-tut/gen-lessons.mjs` from the film scripts (`videos-tut/src/*.json`), so this checks the
 * manifest against those scripts, the hosted files against the manifest, and the page against both:
 *
 *   - the set is the commercial plus the six D1 topics, in order;
 *   - every lesson names an English and an Arabic file, a poster, a length of 40 to 60 s (the commercial: 40),
 *     and a blurb in both languages with no visible tashkeel;
 *   - a lesson is `pending` exactly while one of its two films is missing; a drawn lesson has both files;
 *   - the manifest's titles, blurbs and lengths are the scripts' (nothing hand-edited in one place only);
 *   - the page picks the file by the interface language, opens it in a new tab on a press, and loads nothing before one.
 *
 * The page's behaviour in a real browser (the right URL in English and in Arabic) is `tools/e2e` territory:
 * the entry smoke of the run opens tutorials.html with the extension loaded in both languages.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(EXT, '..');
const MEDIA = path.join(REPO, 'site', 'media');
const SRC = path.join(REPO, 'videos-tut', 'src');

let fail = 0;
let checks = 0;
const bad = (where, why) => { fail++; console.log(`  FAIL  ${where}\n          ${why}`); };
const ok = () => { checks++; };
const check = (cond, where, why) => (cond ? ok() : bad(where, why));
const read = (p) => fs.readFileSync(p, 'utf8');
const TASHKEEL = /[ً-ْٰـ]/;

const lessons = JSON.parse(read(path.join(EXT, 'tutorials', 'lessons.json')));
const scripts = Object.fromEntries(fs.readdirSync(SRC).filter((f) => f.endsWith('.json')).map((f) => {
  const j = JSON.parse(read(path.join(SRC, f)));
  return [j.id, j];
}));

/* ── 1. the set and its order ──────────────────────────────────────────── */
const SET = ['qa-wrap', 'record-a-session', 'trace-a-failure', 'notes-and-bugs', 'export-and-seal', 'profile-and-fine-print', 'kpi-dashboard'];
check(JSON.stringify(lessons.map((l) => l.id)) === JSON.stringify(SET), 'tutorials/lessons.json', `the set reads ${lessons.map((l) => l.id).join(', ')}, not ${SET.join(', ')}`);
check(lessons[0]?.kind === 'trailer' && lessons.slice(1).every((l) => l.kind === 'feature'), 'tutorials/lessons.json', 'the commercial is not the one trailer, first');
check(lessons.length - 1 <= 6, 'tutorials/lessons.json', 'more than six tutorials');

/* ── 2. every lesson carries what the page reads ───────────────────────── */
for (const l of lessons) {
  const w = `tutorials/lessons.json:${l.id}`;
  check(l.en && l.ar && l.blurb?.en && l.blurb?.ar, w, 'a title or blurb is missing in a language');
  check(!TASHKEEL.test(`${l.ar} ${l.blurb?.ar}`), w, 'visible Arabic carries tashkeel');
  check(l.files?.en && l.files?.ar && l.files.en !== l.files.ar, w, 'English and Arabic must be two different files');
  check(l.poster, w, 'no poster');
  const lo = l.kind === 'trailer' ? 40 : 40; const hi = l.kind === 'trailer' ? 40 : 60;
  check(Number.isFinite(l.secs) && l.secs >= lo && l.secs <= hi, w, `${l.secs} s is outside ${lo}-${hi}`);
  check(!('online' in l), w, 'the S-07 `online` flag is back');
  const exists = (f) => fs.existsSync(path.join(MEDIA, f));
  const both = exists(l.files.en) && exists(l.files.ar);
  if (l.pending) check(true, w, '');
  else check(both, w, `drawn on the page but a film is missing: ${[l.files.en, l.files.ar].filter((f) => !exists(f)).join(', ')}`);
  if (l.pending) check(!both, w, 'both films exist but the lesson is still pending (run videos-tut/gen-lessons.mjs)');
  if (!l.pending) check(exists(l.poster), w, `poster ${l.poster} is not in site/media`);
  if (l.posters) {
    check(l.posters.en && l.posters.ar && l.posters.en !== l.posters.ar, w, 'English and Arabic posters must be two different files');
    check(/-ar\./.test(l.posters.ar) && /-en\./.test(l.posters.en), w, 'a poster is named for the wrong language');
    if (!l.pending) for (const p of [l.posters.en, l.posters.ar]) check(exists(p), w, `poster ${p} is not in site/media`);
  } else check(l.kind === 'trailer', w, 'a tutorial has no per-language posters');
  if (!l.pending) {
    for (const f of [l.files.en, l.files.ar]) check(fs.statSync(path.join(MEDIA, f)).size < 50 * 1024 * 1024, w, `${f} is 50 MB or more`);
  }
}

/* ── 3. the manifest is the scripts' ───────────────────────────────────── */
for (const l of lessons.slice(1)) {
  const s = scripts[l.id];
  if (!s) { bad(`tutorials/lessons.json:${l.id}`, 'no script in videos-tut/src'); continue; }
  check(l.en === s.title.en && l.ar === s.title.ar, l.id, 'title differs from the script');
  check(l.blurb.en === s.blurb.en && l.blurb.ar === s.blurb.ar, l.id, 'blurb differs from the script');
  check(l.secs === s.dur, l.id, `secs ${l.secs} is not the script's ${s.dur}`);
  check(l.files.en === `tutorials/${l.id}-en.mp4` && l.files.ar === `tutorials/${l.id}-ar.mp4`, l.id, 'file names are not tutorials/<id>-<lang>.mp4');
}
check(Object.keys(scripts).length === 6, 'videos-tut/src', `${Object.keys(scripts).length} scripts, expected 6`);

/* ── 4. the commercial has its Arabic cut named too ────────────────────── */
check(lessons[0].files.en === 'qa-wrap-commercial-40s.mp4' && lessons[0].files.ar === 'qa-wrap-commercial-40s-ar.mp4', 'qa-wrap', 'the commercial does not name both language files');

/* ── 5. the page ───────────────────────────────────────────────────────── */
const js = read(path.join(EXT, 'tutorials', 'tutorials.js'));
check(js.includes('QAWi18n.lang()') && js.includes('const fileOf = (lesson) => lesson.files[lang] || lesson.files.en;'), 'tutorials.js', 'the film is not chosen by the interface language');
check(/window\.open\(u, '_blank', 'noopener'\)/.test(js), 'tutorials.js', 'a press does not open the film in a new tab');
check(!/localStorage\.getItem\('qaw-tutorial-lang'\)/.test(js), 'tutorials.js', 'a stored language overrides the interface language');
const card = js.slice(js.indexOf('function cardFor'), js.indexOf('function chapterList'));
check(!/createElement\('img'\)/.test(card) && (card.match(/\.src = [^;]+;/g) || []).join() === '.src = lesson.thumb;', 'tutorials.js', 'the card loads something other than its packaged thumbnail before a press');
const play = js.slice(js.indexOf('function play('), js.indexOf("$('feature-close')"));
check(!/\.src\s*=|\.poster\s*=|\.play\(\)/.test(play), 'tutorials.js', 'the details panel loads or plays media');
check(js.includes("MEDIA_URL = 'https://nj-burrito.github.io/QA-Wrap/media/'"), 'tutorials.js', 'the hosted base address is not the site media folder');

console.log(`\n${checks} check(s)${fail ? `, ${fail} FAILED` : ' passed'}`);
process.exit(fail ? 1 : 0);
