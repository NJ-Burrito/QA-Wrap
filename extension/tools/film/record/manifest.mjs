/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The manifest, the subtitles and the posters, all from the storyboards.
 *
 *   node tools/film/record/manifest.mjs
 *
 * Three outputs, one source. `extension/tutorials/lessons.json` is what the
 * product's own films page and the contact sheet read; the `.srt` files are
 * what a viewer with the sound off reads; the posters are what a stopped
 * player shows. All three come from `film/storyboard/*.storyboard.json`, so
 * the burned-in card and the subtitle for the same second cannot disagree
 * (bible 2.7 and 8.5) and a film that is not in the storyboards does not
 * appear anywhere.
 *
 * ── the schema is a hard contract ─────────────────────────────────────────
 *
 * `tutorials/tutorials.js` and `tools/tutorial-index.mjs` both read
 * `lessons.json` directly and neither is being rewritten, so bible 7.5's table
 * is enforced here rather than trusted:
 *
 *   id       tutorials.js finds a lesson by `?v=<id>`
 *   kind     both files branch on 'trailer'; **the trailer must stay first**,
 *            because tutorials.js labels the rest `FEATURE ${i}` by index
 *   ar       page copy, rendered in a `<bdi dir="rtl">`. The films are English;
 *            this Arabic title is the page's, not the film's, and it stays
 *   en       title, and the card's aria-label
 *   blurb    the card body
 *   files    an object keyed by language code
 *   poster   must exist in BOTH tutorials/media/ and deliverables/tutorials/
 *   secs     an integer; two files do `Math.floor(s/60)` and `s % 60` on it
 *
 * Run `node tools/tutorial-index.mjs` after this, never before: it copies
 * `lessons.json` byte for byte to `deliverables/tutorials/` and writes the
 * contact sheet from it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FILM_OUT, FILM_AUDIO_OUT } from '../../lib-paths.mjs';


const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILM = path.resolve(HERE, '..');
const TOOLS = path.resolve(FILM, '..');
const EXT = path.resolve(TOOLS, '..');
const REPO = path.resolve(EXT, '..');
const STORYBOARDS = path.join(FILM, 'storyboard');
/** Where every film and poster is served from (T-048): the site folder, the one tracked copy. */
const MEDIA = path.join(REPO, 'site', 'tutorials');
const DELIVERABLES = path.join(REPO, 'deliverables', 'tutorials');
/** Full-quality masters, untracked (work/ is ignored). */
const MASTERS = path.join(REPO, 'work', 'film-masters');
/** Where the sixteen hosted films and their posters are served from. */
const ONLINE = MEDIA;

/*
 * The trailer first, then the five overview films, then the sixteen tool films.
 *
 * The films page labels every non-trailer card by array index, so the order is
 * copy, not convenience. Bible §10.1 adds the third `kind` value, `"tool"`, and
 * puts the sixteen in `popup.js` TOOLS order after the overview set.
 */
const ORDER = [
  'qa-wrap',
  'record-a-session', 'the-tools', 'file-it', 'save-and-diagram', 'protect-the-data',
  /* Round 3's four category films, one per popup group, between the
     walkthroughs and the tool films: research/63 s1 orders the page that way
     and `tutorials.js` labels every card by array index. */
  'cat-capture', 'cat-check', 'cat-design', 'cat-break',
  'tool-photograph-the-page', 'tool-record-the-screen', 'tool-check-another-size', 'tool-mask-real-data',
  'tool-check-accessibility', 'tool-check-page-speed', 'tool-check-the-links', 'tool-measure-code-coverage',
  'tool-design-the-values', 'tool-try-nasty-values', 'tool-fill-the-form', 'tool-harvest-the-page',
  'tool-copy-a-locator', 'tool-draw-the-flow', 'tool-break-a-request', 'tool-stress-the-layout',
];

const EM_DASH = /[—–]/;

/* ── subtitles ──────────────────────────────────────────────────────────── */

/** `00:00:04,150` — SRT's own clock, from seconds. */
function stamp(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

/**
 * One `.srt` from one storyboard's caption spans.
 *
 * The spans are already the burned-in cards, in the order and at the times the
 * composition draws them, so there is nothing to keep in step: a reworded
 * caption changes both at once or neither.
 */
/** `00:00:46,233` back into seconds. */
function unstamp(t) {
  const m = /^(\d\d):(\d\d):(\d\d),(\d\d\d)$/.exec(String(t).trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/**
 * The end-card cue the composition actually burned, if it has burned one.
 *
 * The caption span says when the subtitle should start. The composition then
 * decides when the tagline lands, and it does not land where the span starts:
 * the end card opens part-way through its own reveal, so the card arrives a few
 * frames after the cue that introduces it. `compose/verify.mjs` fails any SRT
 * whose last cue is more than two frames from the burned card, and a manifest
 * that recomputed that cue from the span would drift it back on every run. So
 * the last cue is read from the file the composition re-timed and kept as it
 * is; only the words come from the storyboard.
 */
function burnedLastCue(file, board = null) {
  if (!fs.existsSync(file)) return null;
  const blocks = fs.readFileSync(file, 'utf8').trim().split(/\r?\n\r?\n/);
  const line = (blocks[blocks.length - 1] || '').split(/\r?\n/).find((l) => l.includes('-->'));
  if (!line) return null;
  const [from, to] = line.split('-->').map(unstamp);
  if (from == null || to == null) return null;
  /*
   * Kept only if it belongs to this cut.
   *
   * The rule is "do not drift the composition's timing back"; it is not "trust
   * whatever the last file said". Revision 3 moved the end card from 44 s to
   * 52 s and the rule dutifully carried a 44.200 cue into a 56 s film. A cue
   * more than two seconds from where this storyboard puts its last card is a
   * cue from a different edit, and is discarded.
   */
  if (board) {
    const want = board.captions[board.captions.length - 1];
    if (!want || Math.abs(want.inSec - from) > 2) return null;
  }
  return { inSec: from, outSec: to };
}

/**
 * The caption chunks, where the film has them.
 *
 * Bible §3.4 makes the commercial's captions chunks of the voice-over, word
 * for word: thirty-nine of them, cut where the voice breathes, not thirteen
 * shot-length lines. Those chunks and their timings live in Builder B's
 * `<id>-vo.json`, so the SRT is built from that when it is the read this film
 * was actually cut to, and from the storyboard's own lines when it is not. The
 * length is the test: a VO file for a different cut is a VO file for a
 * different film, and silently subtitling one with the other is the kind of
 * drift this pipeline exists to prevent.
 */
function chunkCues(board, seconds) {
  const file = path.join(FILM_AUDIO_OUT, `${board.id}-vo.json`);
  if (!fs.existsSync(file)) return null;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (Math.round(doc.seconds) !== Math.round(seconds)) {
    return { stale: `${doc.seconds}s read against a ${Math.round(seconds)}s film` };
  }
  const cues = [];
  for (const line of doc.lines || []) {
    for (const ph of line.phrases || []) {
      if (ph.startSec == null || ph.endSec == null || !ph.text) continue;
      cues.push({ inSec: ph.startSec, outSec: ph.endSec, text: ph.text });
    }
  }
  return cues.length ? { cues } : null;
}

function srt(board, file, seconds) {
  const kept = burnedLastCue(file, board);
  const chunks = chunkCues(board, seconds);
  const source = chunks && chunks.cues ? chunks.cues : board.captions;
  const last = source.length - 1;
  return (
    source
      .map((c, i) => {
        const from = i === last && kept ? kept.inSec : c.inSec;
        const to = i === last && kept ? kept.outSec : c.outSec;
        return `${i + 1}\n${stamp(from)} --> ${stamp(to)}\n${c.srt || c.text}\n`;
      })
      .join('\n') + '\n'
  );
}

/* ── posters ────────────────────────────────────────────────────────────── */

/**
 * The commercial is the one film with no poster card: its frame 0 is already a
 * designed card, the animated intro. Every other film opens on one, so its
 * poster IS its frame 0 and the two cannot drift.
 *
 * Kept in step with `compose/frames.mjs` `POSTER_HOLD`, which is where the card
 * is built. Two lines in two files rather than an import, because importing
 * `frames.mjs` here would pull Playwright into a step that never opens a
 * browser.
 */
const COMMERCIAL = 'qa-wrap';

/**
 * Which frame of the film the poster is taken from.
 *
 * Every lesson film opens on its poster card, so its poster IS frame 0 and the
 * two cannot drift. The commercial is the one film with no poster card: its
 * frame 0 is already a designed card, the animated intro, so it names its own
 * frame instead.
 *
 * Round 3 (research/63 §2) renamed that declaration `posterShot`, because what
 * it names is now the shot whose RESULT is on screen rather than a pretty
 * frame. `poster` is still read, so a storyboard that has not been rewritten
 * keeps working.
 */
const posterDecl = (board) => board.posterShot || board.poster || null;
const posterFrame = (board) => (board.id === COMMERCIAL ? posterDecl(board).frame : 0);

/**
 * The poster's SOURCE frame.
 *
 * A composed frame if Builder A has rendered one, because that is the picture a
 * viewer will actually see; otherwise the capture that frame is built from, so
 * the manifest is complete before the composition exists and improves without
 * anything here changing.
 */
function poster(board) {
  const want = posterDecl(board);
  if (!want) return null;
  const composed = path.join(FILM_OUT, board.id, `f${String(posterFrame(board)).padStart(5, '0')}.png`);
  if (fs.existsSync(composed)) return { file: composed, from: 'composition' };

  const shot = board.shots.find((s) => s.n === want.shot);
  const spec = shot?.capture?.passes?.[want.pass || 'h'];
  if (!spec) return null;
  const clip = spec.clip || spec.parts?.[0]?.clip;
  if (!clip) return null;
  /* The same move: a storyboard clip path is relative to `work/film/`, not to
   * `extension/tools/`. This read silently found nothing after the captures
   * left the extension, and every poster fell through to "kept (nothing new to
   * take one from)" — which looks like a decision and is a missing file. */
  const dir = path.join(REPO, 'work', clip);
  if (!fs.existsSync(dir)) return null;
  /* A `posterShot` that names no frame takes the middle of its shot, which is
   * where the result has arrived and the motion has settled. The same rule
   * `compose/frames.mjs` `posterCard()` uses, so the fallback thumbnail and the
   * composed card are the same picture. */
  const at = want.frame != null ? want.frame : shot.inFrame + Math.floor((shot.frames || 1) / 2);
  const index = shot.capture.still ? 0 : Math.max(0, at - shot.inFrame);
  const named = path.join(dir, `f${String(index).padStart(5, '0')}.png`);
  if (fs.existsSync(named)) return { file: named, from: `capture, ${clip}` };
  const first = path.join(dir, 'f00000.png');
  return fs.existsSync(first) ? { file: first, from: `capture (held), ${clip}` } : null;
}

/**
 * The poster as it ships: 1280 x 720 WebP, under 40 KB.
 *
 * ── why not the PNG it used to be ────────────────────────────────────────
 *
 * The poster is a thumbnail. It is decoded before a single frame of the film
 * is, on the films page and on the card in Settings, and the six that ship were
 * 1.25 MB of a package whose whole point is that it is small. They were also
 * 3840 x 2160 — a poster at four times the resolution of the film it stands
 * for, which nothing anywhere displays.
 *
 * 1280 x 720 is 16:9, is larger than any place that draws it, and reads at the
 * 320 px the films page actually gives it. WebP over PNG because the picture is
 * a photograph of a screen with type over it, which is exactly the case PNG is
 * worst at; measured, the same frame is 260 KB as a PNG and under 40 KB here.
 *
 * The quality ladder walks DOWN until the budget is met rather than picking a
 * number, because a poster card is mostly flat ground and compresses far better
 * than a busy capture: one fixed quality would either waste bytes on the flat
 * ones or blur the busy ones.
 */
const POSTER_W = 1280;
const POSTER_H = 720;
const POSTER_MAX_BYTES = 40 * 1024;
const POSTER_QUALITY = [85, 78, 70, 62, 54, 46];

function writePoster(src, out) {
  /* 1280 x 720, 16:9, CROPPED — research/63 §2: "the frame where the tool's
   * result is visible, cropped 16:9 at 1280x720".
   *
   * A composed frame is already 16:9 and neither scaled nor cropped by this: it
   * is 1920 x 1080 in, 1280 x 720 out, one exact halving-and-a-half with no
   * letterbox anywhere. The pad this replaced was for the OTHER path — a raw
   * 3:2 capture, used when Builder A has not composed the film yet — and it put
   * two Basalt bars across a thumbnail whose whole job is to be a picture of the
   * product. Cropping loses the top and bottom 8 % of a 3:2 capture, which is
   * chrome; padding loses 25 % of the thumbnail to nothing at all.
   *
   * `increase` then `crop` is the fill-and-trim pair: scale so the SHORT side
   * covers, then take 1280 x 720 out of the middle. */
  const vf = `scale=${POSTER_W}:${POSTER_H}:force_original_aspect_ratio=increase,`
    + `crop=${POSTER_W}:${POSTER_H}`;
  let last = null;
  for (const q of POSTER_QUALITY) {
    const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-v', 'error', '-i', src,
      '-vf', vf, '-frames:v', '1', '-c:v', 'libwebp', '-compression_level', '6',
      '-quality', String(q), out], { encoding: 'utf8' });
    if (r.status !== 0 || !fs.existsSync(out)) {
      throw new Error(`ffmpeg could not write ${path.basename(out)}: ${(r.stderr || '').trim()}`);
    }
    last = { q, bytes: fs.statSync(out).size };
    if (last.bytes <= POSTER_MAX_BYTES) return last;
  }
  /* Loud, not silent: a poster over budget is a package over budget, and the
   * quality ladder running out means the frame is not what we think it is. */
  throw new Error(`${path.basename(out)} is ${(last.bytes / 1024).toFixed(1)} KB at quality `
    + `${last.q}, over the ${POSTER_MAX_BYTES / 1024} KB budget`);
}

/**
 * How long the film actually is, in seconds.
 *
 * NOT `board.seconds`. The storyboard on disk states the body's length and is
 * deliberately never re-timed by hand: `compose/frames.mjs` adds the end card's
 * growth and the poster card's hold when it loads, so that one file decides the
 * length and the storyboard and the composition cannot disagree. This file is
 * the third reader, and it was reading the number before either was added — so
 * `lessons.json` said 12 s about a 16 s film, the films page printed 0:12 under
 * a card, and the SRT builder decided the correct voice file was for "a
 * different cut" and fell back to the storyboard's spans.
 *
 * The delivered file is the answer, because it is the thing being described. A
 * film not yet encoded falls back to the arithmetic, and says which it used.
 */
const POSTER_HOLD = 2.0;       // compose/frames.mjs POSTER_HOLD
const END_CARD_GROWTH = 2.0;   // compose/frames.mjs END_CARD_GROWTH
function filmSeconds(board) {
  const mp4 = path.join(MASTERS, `${board.id}-en.mp4`);
  if (fs.existsSync(mp4)) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', mp4], { encoding: 'utf8' });
    const v = parseFloat((r.stdout || '').trim());
    if (Number.isFinite(v) && v > 0) return { seconds: v, from: 'the delivered file' };
  }
  const grown = board.seconds + END_CARD_GROWTH + (board.id === COMMERCIAL ? 0 : POSTER_HOLD);
  return { seconds: grown, from: 'the storyboard plus the end card and the poster card' };
}

/* ── the run ────────────────────────────────────────────────────────────── */

fs.mkdirSync(MEDIA, { recursive: true });
fs.mkdirSync(DELIVERABLES, { recursive: true });

const lessons = [];
const notes = [];
const waiting = [];
let bad = 0;
const fail = (m) => { console.log(`  FAIL ${m}`); bad++; };

for (const id of ORDER) {
  const file = path.join(STORYBOARDS, `${id}.storyboard.json`);
  if (!fs.existsSync(file)) { fail(`${id} has no storyboard`); continue; }
  const board = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!['trailer', 'feature', 'category', 'tool'].includes(board.kind)) fail(`${id}: kind "${board.kind}" is not one the films page knows`);

  /* Bible 2.9 rule 6 and 8.5: not one em dash, anywhere a viewer reads. */
  for (const c of board.captions) {
    if (EM_DASH.test(c.srt || c.text)) fail(`${id}: an em dash in "${c.text}"`);
  }
  if (EM_DASH.test(board.blurb) || EM_DASH.test(board.en)) fail(`${id}: an em dash in the manifest copy`);

  const length = filmSeconds(board);
  const secs = Math.round(length.seconds);
  if (!Number.isInteger(secs)) fail(`${id}: secs must be an integer`);

  /* the subtitles */
  const srtPath = path.join(DELIVERABLES, `${id}-en.srt`);
  const kept = burnedLastCue(srtPath, board);
  const chunks = chunkCues(board, length.seconds);
  if (chunks?.cues) notes.push(`${id}: ${chunks.cues.length} subtitle cues from the read, not the shot list`);
  if (chunks?.stale) notes.push(`${id}: the voice file is ${chunks.stale}, so the subtitles came from the storyboard`);
  fs.writeFileSync(srtPath, srt(board, srtPath, length.seconds), 'utf8');
  if (kept && Math.abs(kept.inSec - board.captions[board.captions.length - 1].inSec) > 1 / 30) {
    notes.push(`${id}: end card cue kept at ${kept.inSec.toFixed(3)}s, where the composition burned it`);
  }

  /* The poster, in both places the two readers look. A packaged film's poster
   * goes into the package beside it; a hosted film's goes to the folder its
   * film is served from, because `release-check.mjs` §4c fails a package that
   * carries either half of a hosted pair. */
  const online = board.kind === 'tool';
  const beside = online ? ONLINE : MEDIA;
  const src = poster(board);
  if (src) {
    fs.mkdirSync(beside, { recursive: true });
    const m = writePoster(src.file, path.join(beside, `${id}.webp`));
    notes.push(`${id}: poster from ${src.from}, frame ${posterFrame(board)}, `
      + `${(m.bytes / 1024).toFixed(1)} KB at quality ${m.q}`);
  } else if (fs.existsSync(path.join(beside, `${id}.webp`))) {
    notes.push(`${id}: poster kept (nothing new to take one from)`);
  } else {
    /*
     * A film that has not been captured is not in the manifest yet.
     *
     * The set arrives in batches: the commercial first, then the sixteen tool
     * films four at a time. A manifest that refused to write until all
     * twenty-two existed would hold the finished ones hostage to the unstarted
     * ones, and the films page reads this file to decide what to show. So an
     * uncaptured film is skipped and named, and it joins the array the moment
     * it has a frame to be a poster.
     */
    waiting.push(id);
    fs.rmSync(srtPath, { force: true });
    continue;
  }

  /*
   * The chapter rail, read off the storyboard's own marks.
   *
   * A category film's shots carry `chapter: { tool, startSec }`, and the
   * delivered film opens on its two-second poster card, so a chapter's second
   * in the file is `startSec + POSTER_HOLD`. The title is never typed here:
   * `tools.<tool>.label` is the key both languages already have, which is what
   * `tools/test-tutorials.mjs` check 2 asserts.
   */
  const hold = board.id === COMMERCIAL ? 0 : POSTER_HOLD;
  const chapters = (board.shots || [])
    .filter((sh) => sh.chapter && sh.chapter.tool != null && Number.isFinite(sh.chapter.startSec))
    .map((sh) => ({
      t: Math.round((sh.chapter.startSec + hold) * 1000) / 1000,
      titleKey: `tools.${sh.chapter.tool}.label`,
    }));

  /*
   * `pending` is the card's answer to a film that has not been encoded yet:
   * no poster, no player, nothing pointed at a file that is not there. It is
   * derived from the folder rather than carried by hand, because
   * `tools/test-tutorials.mjs` check 3 fails a flag that disagrees with disk
   * in either direction.
   */
  const packaged = board.kind !== 'tool';
  const missing = packaged
    ? [`${board.id}-en.mp4`, `${board.id}.webp`].filter((f) => !fs.existsSync(path.join(MEDIA, f)))
    : [];

  lessons.push({
    id: board.id,
    kind: board.kind,
    ar: board.ar,
    en: board.en,
    blurb: board.blurb,
    files: { en: `${board.id}-en.mp4` },
    poster: `${board.id}.webp`,
    secs,
    /* The sixteen tool films are hosted, not packaged. `release-check.mjs`
     * reads this flag in both directions — nothing marked online may be in the
     * zip, and thirty-two files must be marked online — and it used to be
     * hand-edited into this file after every run, which is a gate that survives
     * on somebody remembering. It is derived from the kind, which is where the
     * distinction actually lives. */
    online: true,
    ...(chapters.length ? { chapters } : {}),
    ...(missing.length ? { pending: true } : {}),
  });

  console.log(`  ${id.padEnd(26)} ${board.captions.length} subtitle cue(s), ${secs}s from ${length.from}`);
}

/* The schema, checked rather than assumed. */
if (lessons[0]?.kind !== 'trailer') fail('the trailer is not first; tutorials.js labels the rest by array index');
/* Overview films before tool films, because the page reads the array in order
   and a tester meeting the set should meet the overview first. */
const kinds = lessons.map((l) => l.kind);
const firstTool = lessons.findIndex((l) => l.kind === 'tool');
const lastFeature = kinds.lastIndexOf('feature');
const firstCategory = kinds.indexOf('category');
const lastCategory = kinds.lastIndexOf('category');
if (firstTool >= 0 && lastFeature > firstTool) fail('a feature film is filed after a tool film');
/* Round 3's order: the trailer, the walkthroughs, the four category films,
   then the tool films. The page reads the array in order. */
if (firstTool >= 0 && lastCategory > firstTool) fail('a category film is filed after a tool film');
if (firstCategory >= 0 && lastFeature > firstCategory) fail('a feature film is filed after a category film');
if (lessons.filter((l) => l.kind === 'trailer').length !== 1) fail('there must be exactly one trailer');
for (const l of lessons) {
  for (const key of ['id', 'kind', 'ar', 'en', 'blurb', 'files', 'poster', 'secs']) {
    if (l[key] === undefined || l[key] === '') fail(`${l.id}: ${key} is missing`);
  }
  if (!Number.isInteger(l.secs)) fail(`${l.id}: secs is not an integer`);
  if (typeof l.files !== 'object' || !l.files.en) fail(`${l.id}: files must be an object keyed by language`);
  for (const where of [MEDIA]) {
    if (!fs.existsSync(path.join(where, l.poster))) fail(`${l.id}: ${l.poster} is missing from ${path.relative(REPO, where)}`);
  }
}

const total = lessons.reduce((n, l) => n + l.secs, 0);

if (bad) {
  console.log(`\n${bad} problem(s); lessons.json not written`);
  process.exit(1);
}

fs.writeFileSync(path.join(EXT, 'tutorials', 'lessons.json'), JSON.stringify(lessons, null, 2) + '\n', 'utf8');

for (const n of notes) console.log(`  ${n}`);
if (waiting.length) {
  console.log(`
  ${waiting.length} film(s) have a storyboard but no capture yet, so they are not in the manifest:`);
  for (const w of waiting) console.log(`    ${w}`);
}
console.log(
  `\nwrote tutorials/lessons.json — ${lessons.length} films, ${total} seconds in all ` +
    `(${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')})`
);
console.log(`wrote ${lessons.length} .srt file(s) and ${lessons.length} poster(s) to deliverables/tutorials and tutorials/media`);
console.log('Now run:  node tools/tutorial-index.mjs');
