/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The tutorials manifest, checked against the storyboards it came from.
 *
 *   node tools/test-tutorials.mjs
 *
 * `tutorials/lessons.json` is the whole index of the films page: a lesson that
 * is not in it cannot be reached by any route, and a number in it that is
 * wrong is a number printed under a card. It is written from the storyboards
 * by the film pipeline, so every claim it makes is checkable against the
 * storyboard that produced it, and this file checks the ones that go stale
 * silently.
 *
 * The one that matters most is the chapter clock. A chapter is a seek point:
 * `{ t, titleKey }`, where `t` is a second in the DELIVERED film. The
 * storyboard's own clock does not include the 2 s poster card the film opens
 * on or the 2 s the end card grows by (`compose/frames.mjs` POSTER_HOLD and
 * END_CARD_GROWTH), so a chapter time copied straight off the shot table lands
 * two seconds early on every chapter of every film — a fault nothing else
 * would notice, because a video seeks happily to the wrong second. Here, a
 * chapter that falls outside its film's own storyboard length plus those four
 * seconds fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOARDS = path.join(EXT, 'tools', 'film', 'storyboard');
/* The films are hosted, never packaged (T-048): the one tracked copy is in the site folder. */
const MEDIA = path.join(EXT, '..', 'site', 'tutorials');

/** The poster card the film opens on, plus the end card's growth. */
const DELIVERY_GROWTH = 4;

let fail = 0;
let checks = 0;
const bad = (where, why) => { fail++; console.log(`  FAIL  ${where}\n          ${why}`); };
const ok = () => { checks++; };

const lessons = JSON.parse(fs.readFileSync(path.join(EXT, 'tutorials', 'lessons.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', 'en.json'), 'utf8'));
const ar = JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', 'ar.json'), 'utf8'));

/* ── 1. the round-3 set is all there, in the order the page reads ───────── */

/**
 * Decision 88: ten round-3 films — the commercial, five walkthroughs, and four
 * category films, one per popup group. The sixteen round-2 tool films stay in
 * the manifest behind them, so the count is not asserted; the ten ids are.
 */
const ROUND3 = [
  'qa-wrap',
  'record-a-session', 'the-tools', 'file-it', 'save-and-diagram', 'protect-the-data',
  'cat-capture', 'cat-check', 'cat-design', 'cat-break',
];
const ids = lessons.map((l) => l.id);
const missing = ROUND3.filter((id) => !ids.includes(id));
if (missing.length) bad('tutorials/lessons.json', `round-3 film(s) not in the manifest: ${missing.join(', ')}`);
else ok();

const at = (id) => ids.indexOf(id);
if (at('qa-wrap') !== 0) bad('tutorials/lessons.json', 'the trailer is not first; the page gives the first card the full width');
else ok();
const orderIsRight = ROUND3.every((id, i) => i === 0 || at(id) > at(ROUND3[i - 1]));
if (!orderIsRight) bad('tutorials/lessons.json', `the round-3 films are out of order; they read ${ROUND3.join(', ')}`);
else ok();
const lastRound3 = Math.max(...ROUND3.map(at));
const firstTool = lessons.findIndex((l) => l.kind === 'tool');
if (firstTool !== -1 && firstTool < lastRound3) bad('tutorials/lessons.json', 'a round-2 tool film is filed before a round-3 film');
else ok();

/* ── 2. the chapter clock, against the storyboard ───────────────────────── */

const CATEGORY = ['cat-capture', 'cat-check', 'cat-design', 'cat-break'];
for (const lesson of lessons) {
  const board = path.join(BOARDS, `${lesson.id}.storyboard.json`);
  const wantsChapters = CATEGORY.includes(lesson.id);
  if (wantsChapters && !lesson.chapters?.length) {
    bad(`tutorials/lessons.json:${lesson.id}`, 'a category film with no chapters; the page draws its rail from them');
    continue;
  }
  if (!lesson.chapters?.length) continue;
  if (!fs.existsSync(board)) { bad(`tutorials/lessons.json:${lesson.id}`, `chapters, but no storyboard at ${path.relative(EXT, board)}`); continue; }
  const seconds = JSON.parse(fs.readFileSync(board, 'utf8')).seconds;
  const limit = seconds + DELIVERY_GROWTH;

  let last = -1;
  for (const [i, ch] of lesson.chapters.entries()) {
    const where = `tutorials/lessons.json:${lesson.id} chapter ${i + 1}`;
    if (typeof ch.t !== 'number' || !Number.isFinite(ch.t) || ch.t < 0) {
      bad(where, `t is ${JSON.stringify(ch.t)}; a chapter is a second in the delivered film`);
      continue;
    }
    if (ch.t > limit) {
      bad(where, `starts at ${ch.t}s, past the ${limit}s the film runs `
        + `(storyboard ${seconds}s plus the ${DELIVERY_GROWTH}s of poster card and end card)`);
    }
    if (ch.t <= last) bad(where, `starts at ${ch.t}s, at or before the chapter in front of it (${last}s)`);
    last = ch.t;
    if (!ch.titleKey) { bad(where, 'no titleKey; a chapter title is never hand-typed English'); continue; }
    if (!en[ch.titleKey]) bad(where, `titleKey "${ch.titleKey}" has no English`);
    if (!ar[ch.titleKey]) bad(where, `titleKey "${ch.titleKey}" has no Arabic`);
  }
  ok();
}

/* ── 3. a film is playable, or it says it is not ────────────────────────── */

/**
 * `pending` is the page's whole answer to a film that has not been encoded
 * yet: the lesson is not drawn at all, so the browser is never pointed at a
 * file that is not there. A lesson whose flag disagrees with the folder is
 * either a broken card or a card hidden for nothing.
 */
for (const lesson of lessons) {
  if (lesson.pending) continue;
  // 3.6.8: the one film hosted with the website (site/media), opened in a new tab; its banner is packaged beside the page.
  if (lesson.files?.en === 'qa-wrap-commercial-40s.mp4') {
    if (!fs.existsSync(path.join(EXT, '..', 'site', 'media', lesson.files.en))) bad(`tutorials/lessons.json:${lesson.id}`, 'the hosted film is not in site/media');
    if (!lesson.thumb || !fs.existsSync(path.join(EXT, 'tutorials', lesson.thumb))) bad(`tutorials/lessons.json:${lesson.id}`, 'the hosted film has no packaged thumbnail');
    continue;
  }
  if (!lesson.online) { bad(`tutorials/lessons.json:${lesson.id}`, 'a recorded film that is not marked online: it would have to be packaged'); continue; }
  const here = [lesson.files?.en, lesson.poster].filter(Boolean);
  const absent = here.filter((f) => !fs.existsSync(path.join(MEDIA, f)));
  if (absent.length && !lesson.pending) {
    bad(`tutorials/lessons.json:${lesson.id}`, `not in site/tutorials and not marked pending: ${absent.join(', ')}`);
  } else if (!absent.length && lesson.pending) {
    bad(`tutorials/lessons.json:${lesson.id}`, 'marked pending, but the film and its poster are both on disk; the card would refuse to play a film that is there');
  }
}
ok();

/* ── 3b. a pending film is off the page, not advertised on it ──────────── */

/**
 * A "coming soon" chip is a promise with a date attached, and the four
 * category films are not coming this week. So the shipped page draws nothing
 * for a pending lesson: `render()` builds every list — the opening run, the
 * per-group film, the chapter rail, the leftovers, and each section's tally —
 * from one filtered list, and this asserts that line is still there. It is a
 * source check because the alternative is booting a browser for one boolean;
 * the line is short, named, and commented in `tutorials.js` for exactly this.
 */
const page = fs.readFileSync(path.join(EXT, 'tutorials', 'tutorials.js'), 'utf8');
const FILTER = 'const shown = lessons.filter((l) => !l.pending);';
if (!page.includes(FILTER)) {
  bad('tutorials/tutorials.js', `render() no longer starts from \`${FILTER}\`; a film that has not been recorded would be drawn on the shipped page`);
} else ok();
for (const [name, list] of [['byId', 'shown.map'], ['start', 'shown.filter'], ['rest', 'shown.filter']]) {
  if (!page.includes(list)) bad('tutorials/tutorials.js', `render() builds ${name} from something other than \`shown\``);
}
ok();

/* ── 4. every lesson carries what the page reads ────────────────────────── */

for (const lesson of lessons) {
  for (const key of ['id', 'kind', 'ar', 'en', 'blurb', 'files', 'poster', 'secs']) {
    if (lesson[key] === undefined || lesson[key] === '') bad(`tutorials/lessons.json:${lesson.id}`, `${key} is missing`);
  }
  if (!Number.isInteger(lesson.secs) || lesson.secs <= 0) bad(`tutorials/lessons.json:${lesson.id}`, `secs is ${lesson.secs}; two files do Math.floor(s / 60) on it`);
  if (!['trailer', 'feature', 'category', 'tool'].includes(lesson.kind)) {
    bad(`tutorials/lessons.json:${lesson.id}`, `kind "${lesson.kind}" is not one the films page knows`);
  }
  const blurb = `tutorials.lesson.${lesson.id}.blurb`;
  if (!en[blurb]) bad(`platform/i18n/en.json`, `${blurb} is missing; the card would print the key`);
  if (!ar[blurb]) bad(`platform/i18n/ar.json`, `${blurb} is missing; the card would print the key`);
}
ok();

/* ── 5. the number under the card is the film's own length ──────────────── */

/**
 * `secs` is printed under every card and beside the player, and it is written
 * from the storyboard as easily as from the file. Round 3 wrote the planned
 * lengths (40, 42, 36, 34, 34) over five cards whose media were still the
 * round-2 masters at 20 s each, so every one of them promised twice the film
 * it played. Read the length back out of the file instead.
 *
 * Read from the `mvhd` atom rather than by shelling out to ffprobe: the film
 * pipeline may assume ffmpeg on the PATH, but `npm test` runs where a QA
 * engineer sits, and a unit gate that skips itself when a binary is absent is
 * a gate that has never once failed.
 */
function mp4Seconds(file) {
  const buf = fs.readFileSync(file);
  const at = buf.indexOf('mvhd', 0, 'latin1');
  if (at < 0) return null;
  const version = buf.readUInt8(at + 4);
  // version, 3 flag bytes, then the two dates: 4 bytes each at v0, 8 at v1.
  const head = at + 8 + (version === 1 ? 16 : 8);
  const timescale = buf.readUInt32BE(head);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(head + 4)) : buf.readUInt32BE(head + 4);
  return timescale ? duration / timescale : null;
}

for (const lesson of lessons) {
  if (lesson.pending) continue;
  const file = path.join(MEDIA, lesson.files?.en || '');
  if (!lesson.files?.en || !fs.existsSync(file)) continue; // §3 already failed it
  const real = mp4Seconds(file);
  if (real == null) { bad(`site/tutorials/${lesson.files.en}`, 'no mvhd atom; this is not an mp4 the page can time'); continue; }
  if (Math.round(real) !== lesson.secs) {
    bad(`tutorials/lessons.json:${lesson.id}`, `secs is ${lesson.secs}, but ${lesson.files.en} runs ${real.toFixed(1)}s; `
      + 'the card would print a length the film does not have');
  }
}
ok();

const chaptered = lessons.filter((l) => l.chapters?.length);
console.log(`\n${lessons.length} lessons, ${chaptered.length} with chapters `
  + `(${chaptered.map((l) => `${l.id} ${l.chapters.length}`).join(', ')}), `
  + `${lessons.filter((l) => l.pending).length} pending`);
console.log(fail ? `${fail} problem(s), ${checks} check(s) passed` : `all ${checks} check(s) passed`);
process.exit(fail ? 1 : 0);
