/* QA Wrap — film composition. Builder A. Frame capture.
 *
 * Reads the script (checkpoint 1), the storyboard (checkpoint 2) and Builder
 * C's captures (checkpoint 3a) and writes checkpoint 4:
 * `work/film/out/<name>/f%05d.png` (tools/lib-paths.mjs).
 *
 * Usage
 *   node tools/film/compose/frames.mjs --make-standins
 *   node tools/film/compose/frames.mjs [--id qa-wrap] [--aspect 16x9|1x1|9x16]
 *        [--standin] [--reduced] [--dsf 2] [--workers 4] [--from N] [--to N]
 *        [--only 0,225,1439] [--force]
 *
 * Rules this file enforces rather than assumes:
 *   - a capture is never scaled: the recording's pixel size must equal its
 *     placement rectangle times the composition's deviceScaleFactor, or the
 *     run stops;
 *   - the page requests nothing off its own loopback origin;
 *   - the Thmanyah faces are loaded before frame 0;
 *   - the extension is never loaded into the browser, so a headed suite running
 *     against the product at the same time is untouched.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { FILM_OUT, FILM_AUDIO_OUT, FILM_CAPTURE } from '../../lib-paths.mjs';
import { END_CARD_BRAND } from '../../lib-brand.mjs';

/* The captures and the composed frames are no longer under the extension, so
   the page cannot reach them through the extension's own document root. They
   are served under `/work/`, which `serve()` below resolves against the
   repository root, and `urlToLocal()` maps back the same way. The prefix is a
   URL path and not a file path: the composition is loaded over http for the
   reason on `serve()`, and a `file://` URL here made these strings unusable as
   both. */
const WORK_PREFIX = 'work';

import {
  BIBLE_COMMERCIAL, BIBLE_COMMERCIAL_R3, STANDIN_VO, chunksFromVo, captionsFromLines,
  buildTimeline, scriptFaults, scriptFromStoryboard, transitionFaults,
  RECTS, PAIR_SOURCES, CANVASES, ZONES,
} from './timeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '../../..');            // extension/
const REPO = path.resolve(EXT, '..');                  // repo root
const FILM = path.join(EXT, 'tools', 'film');
const OUT = FILM_OUT;

/* ── argv ───────────────────────────────────────────────────────────────── */

export function argv(list = process.argv.slice(2)) {
  const a = { _: [] };
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t.startsWith('--')) { a._.push(t); continue; }
    /* Both forms: `--key value` and `--key=value`. Only the first was handled,
     * which turned `--shots=2` into a flag named "shots=2" that nothing read,
     * and did the same to `--film=<id>`. A flag that is silently ignored is
     * worse than one that errors, because the run looks like it obeyed. */
    const eq = t.indexOf('=');
    if (eq > 2) { a[t.slice(2, eq)] = t.slice(eq + 1); continue; }
    const k = t.slice(2);
    const next = list[i + 1];
    if (next === undefined || next.startsWith('--')) a[k] = true;
    else { a[k] = next; i++; }
  }
  return a;
}

/* ── checkpoints 1 and 2: script and storyboard ─────────────────────────── */

/** The animated intro's length, and the scenes that replace shots 1 to 3. */
export const INTRO_SEC = 2.0;
/**
 * Empty since 17 September 2026. It used to hold
 * `{ 1: 'qa-desk-fail', 2: 'qa-desk-pass', 3: 'ticket-bounce' }`, which threw
 * away the captures the storyboard declares for shots 1 to 3 and drew stick
 * figures in their place — fifteen seconds, a quarter of the film, with the
 * product not on screen at all. Nader's rule is that the extension is the
 * product and the picture shows what is named, so the captures are used.
 * Shots 1 and 2 are PAIR in rev 5 for the same reason. research/78 §3.
 */
export const SCENES = {};
/** The one film with an intro and drawn scenes. */
export const COMMERCIAL = 'qa-wrap';
/** Every lesson film grows by this, all of it on the end card. */
export const END_CARD_GROWTH = 2.0;
/**
 * The poster card's hold, in front of every lesson film. Director's ruling of
 * 2026-09-06: frame 0 is the thumbnail wherever a film is listed, and a frame
 * of product with no words on it does not say which film it is. So each lesson
 * film opens on a card carrying its title, the tool or feature it is about, and
 * a real frame of that tool taken from this film.
 *
 * 2.000 s is one bar at 120 BPM and sixty frames at 30 fps, which is why the
 * whole film can move by it without a single cue leaving its beat, and it is
 * the same length the commercial's animated intro already holds for.
 *
 * The commercial is not given one: its frame 0 is already a designed card.
 */
export const POSTER_HOLD = 2.0;
/**
 * The poster card, round 3 (research/63 §2).
 *
 * WHAT CHANGED, AND WHY. The card used to be a title column beside an 840 px
 * window: half the frame was type on bare ground, and the thumbnail a viewer
 * picks a film by was mostly words. The director's ruling is that **the poster
 * is a product frame, not a title card** — the frame where the tool's result is
 * visible, full width, with the words on a band across the foot of it.
 *
 * So the geometry is now: the product frame fills the picture area, and a band
 * 28 % of the canvas height carries the title, the category chip and the mark.
 * The band is the film's own ground at 92 %, which is opaque enough to read
 * against a busy capture and transparent enough that the picture continues
 * under it rather than stopping at a hard edge.
 *
 * The window is still a CROP, never a scale: it is the smaller of the capture's
 * own size and the space above the band, so a 1080 x 720 stage sits at its
 * native size with the band over its foot and a 1280 x 720 report is cropped to
 * the canvas width. `assertNativeSizes()` is untouched by this.
 */
const POSTER_BAND = 0.28;
/** Two lines at most, and about thirty characters of Thmanyah Sans Black fit one. */
const POSTER_WINDOW = { maxChars: 30 };

/* ── the chip's words come from the product, at compose time ─────────────── */

/**
 * The one thing a poster must not do is name the tool in a string of its own.
 *
 * 62 §3 measured this: `chip` on 21 storyboards and `group` on 16 are hand
 * copies of popup copy, drawn as pixels, with nothing in the pipeline reading
 * them back against the product — so the day the popup's labels are translated
 * or renamed, twenty-one posters keep saying the old name and nothing fails.
 *
 * The fix is to stop copying. A storyboard names a KEY (`chipKey`, e.g.
 * `popup.groups.capture.label` or `tools.pick.label`) and the card reads its
 * words out of `platform/i18n/en.json` on the frame it draws. A key with no
 * entry is a hard error, not a silent fall-through to the stale literal: a
 * missing key means the product renamed something, and that is exactly the
 * moment a human should look.
 */
const I18N_DIR = path.join(EXT, 'platform', 'i18n');
const i18nCache = new Map();
export function i18n(lang = 'en') {
  if (!i18nCache.has(lang)) {
    const p = path.join(I18N_DIR, `${lang}.json`);
    if (!fs.existsSync(p)) throw new Error(`no interface language file at ${path.relative(REPO, p)}`);
    i18nCache.set(lang, JSON.parse(fs.readFileSync(p, 'utf8')));
  }
  return i18nCache.get(lang);
}
/** Which popup group a tool lives in, from the product's own catalogue. */
const CATALOGUE = path.join(EXT, 'core', 'tool-catalogue.json');
let catalogue = null;
export function toolGroupId(tool) {
  if (!catalogue) {
    catalogue = fs.existsSync(CATALOGUE) ? JSON.parse(fs.readFileSync(CATALOGUE, 'utf8')) : { tools: [] };
  }
  const row = (catalogue.tools || []).find((t) => t.tool === tool);
  return row ? row.group : null;
}
export function liveLabel(key, { lang = 'en', where = 'poster chip' } = {}) {
  if (!key) return null;
  const dict = i18n(lang);
  const v = dict[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`${where}: platform/i18n/${lang}.json has no "${key}". `
      + 'The product renamed or removed it; re-point the storyboard\'s chipKey rather than '
      + 'typing the words into the storyboard.');
  }
  return v;
}

/**
 * Which frame of the film is the product frame.
 *
 * `posterShot` is the round-3 field and wins where it is present: it names the
 * shot whose RESULT is on screen, which is the frame the brief asks a poster to
 * be. `poster` is the pre-round-3 declaration and is still read, so the
 * eleven films that have not been rewritten keep their posters.
 */
export function posterDecl(sb) {
  const want = sb.posterShot || sb.poster;
  if (!want) return null;
  if (typeof want === 'number') return { shot: want, frame: null, pass: null, why: null };
  return { shot: want.shot, frame: want.frame ?? null, pass: want.pass || null, why: want.why || null };
}
/** The close is staged to start this far before the film ends. */
export const CLOSE_ANCHOR = 4.25;

/**
 * Move a whole storyboard later by `dt`, so the animated intro can be pushed in
 * front of it without every time in checkpoint 2 being rewritten by hand.
 *
 * Only absolute instants move. A duration (`ms`, `durSec`, `revealMs`) is a
 * length, not a moment, and shifting one would stretch the film instead of
 * delaying it, so the list of keys is explicit rather than "anything ending in
 * Sec".
 */
const ABSOLUTE = new Set([
  'inSec', 'outSec', 'atSec', 'fromSec', 'toSec', 'exitSec', 'untilSec',
  'startSec', 'endSec', 'anchorSec', 'endBySec', 'shotInSec', 'shotOutSec', 'lastWordEnd',
]);
export function shiftStoryboard(sb, dt, fps) {
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'number' && ABSOLUTE.has(k)) node[k] = Math.round((v + dt) * 1e6) / 1e6;
      else if (typeof v === 'number' && (k === 'inFrame' || k === 'outFrame')) node[k] = v + Math.round(dt * fps);
      else walk(v);
    }
  };
  walk(sb.shots || []);
  walk(sb.captions || []);
  sb.seconds = Math.round((sb.seconds + dt) * 1e6) / 1e6;
  sb.frames = (sb.frames || 0) + Math.round(dt * fps);
  return sb;
}

/**
 * The poster card, built from the storyboard's own `poster` declaration.
 *
 * The storyboard already names the frame that best shows this film — pass, shot
 * and absolute film frame, with a sentence saying why. That declaration used to
 * be read only by `record/manifest.mjs`, which copied the composed frame out as
 * a thumbnail. It is now also what the film opens on, so the picture a tester
 * sees on the card and the picture the film starts with are one frame by
 * construction rather than by coincidence.
 *
 * MUST be called before the storyboard is shifted: `want.frame` is an absolute
 * film frame and the index into the clip is measured from the shot's own
 * in-frame, which the shift moves.
 *
 * The capture is placed at its native size inside a window smaller than itself.
 * A window is a crop; a crop shows recorded pixels one for one. Nothing here is
 * resampled, and `assertNativeSizes()` is untouched.
 */
function posterCard(sb, { pass, clipBase, aspect, mark = false }) {
  const want = posterDecl(sb);
  if (!want) return null;
  const shot = sb.shots.find((x) => x.n === want.shot);
  const spec = shot && shot.capture && shot.capture.passes && shot.capture.passes[want.pass || pass];
  if (!spec) return null;
  const part = spec.parts && spec.parts.length
    ? spec.parts.slice().sort((a, b) => (b.viewport.w * b.viewport.h) - (a.viewport.w * a.viewport.h))[0]
    : spec;
  const clip = part.clip;
  const view = part.viewport;
  if (!clip || !view) return null;
  /* A `posterShot` that names no frame takes the middle of its shot, which is
   * where the result has arrived and the motion has settled. */
  const at = want.frame != null
    ? want.frame
    : (shot.inFrame || 0) + Math.floor((shot.frames || 1) / 2);
  const index = shot.capture.still ? 0 : Math.max(0, at - (shot.inFrame || 0));

  const canvas = CANVASES[aspect];
  const zones = ZONES[aspect] || ZONES['16x9'];

  /* The band, and the picture area above it. */
  const bandH = Math.round(canvas.h * POSTER_BAND);
  const windowH = canvas.h - bandH;

  /* The title. One line where it fits the band's measure, two at most, split at
   * the word boundary nearest the middle. Thmanyah Sans Black at the poster's display
   * size averages a little over half its own size per character. */
  /* A category film's title is the popup group's own heading, so it is READ
   * from the product like the chip is: `titleKey` names it. Everything else
   * uses `en`, which is the film's name and is the page's copy rather than the
   * product's (record/manifest.mjs's own contract note). */
  const title = (sb.titleKey ? liveLabel(sb.titleKey, { where: `${sb.id} poster title` }) : null)
    || sb.en || sb.id;
  let line1 = title;
  let line2 = '';
  if (title.length > POSTER_WINDOW.maxChars) {
    const words = title.split(' ');
    let best = 1;
    let bestCost = Infinity;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ').length;
      const b = words.slice(i).join(' ').length;
      const cost = Math.max(a, b) + Math.abs(a - b) * 0.25;
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    line1 = words.slice(0, best).join(' ');
    line2 = words.slice(best).join(' ');
  }

  /* The product frame: as much of the capture as the picture area holds, at its
   * own native size, centred. Wider than the canvas is cropped about the
   * capture's centre; taller than the picture area is cropped about its middle,
   * which on a 720 px rectangle under a 302 px band means the foot of the
   * capture sits behind the band rather than being thrown away. */
  const box = {
    w: Math.min(view.w, canvas.w),
    h: Math.min(view.h, windowH),
  };
  box.x = Math.round((canvas.w - box.w) / 2);
  box.y = Math.round((windowH - box.h) / 2);

  /* A card carries the mark OR a chip, never both: bible 2.5 rule 1 gives a
   * shot one Petra element and the mark's check stroke is Petra. Round 3 puts
   * the QA Wrap mark on the right of the band of EVERY card, so the chip is the
   * card's Petra element and the mark is drawn in Limestone alone — the ruling
   * is about the accent, not about the drawing.
   *
   * The chip's words are READ from the product (see `liveLabel`), never copied
   * into the storyboard. `chipKey` is the round-3 field; a storyboard that has
   * not been rewritten falls back to its `group` literal and says so, so the
   * drift 62 §3 measured is visible rather than silent. */
  let chip = null;
  let chipFrom = null;
  if (sb.chipKey) {
    chip = liveLabel(sb.chipKey, { where: `${sb.id} poster chip` });
    chipFrom = `platform/i18n/en.json ${sb.chipKey}`;
  } else if (sb.tool) {
    /* A tool film's title IS the tool's name (`label` and `en` are the same
     * string), so the chip carries the GROUP the tool lives in inside the
     * popup, which is the one piece of orientation the title cannot give.
     * Which group is read from `core/tool-catalogue.json` — the machine
     * readable copy of `popup.js` `TOOLS[]`/`GROUPS` that
     * `tools/test-context-menus.mjs` fails the moment the two disagree — and
     * its words from `en.json`, so neither is typed here. */
    const g = toolGroupId(sb.tool);
    if (g) {
      chip = liveLabel(`popup.groups.${g}.label`, { where: `${sb.id} poster chip` });
      chipFrom = `core/tool-catalogue.json + platform/i18n/en.json popup.groups.${g}.label`;
    } else {
      chip = liveLabel(`tools.${sb.tool}.label`, { where: `${sb.id} poster chip` });
      chipFrom = `platform/i18n/en.json tools.${sb.tool}.label`;
    }
  } else {
    chip = sb.group
      || (sb.shots.find((x) => x.chip && x.chip !== (sb.en || '')) || {}).chip
      || (sb.kind === 'feature' ? 'Feature' : null);
    chipFrom = chip ? 'the storyboard (no chipKey: this literal can drift from the product)' : null;
  }
  /* The chip must not repeat the title: on a tool film `label` and `en` are the
   * same string, and on a category film the group's heading is the title, so
   * both would say the word twice. Where they collide the chip is dropped and
   * the card carries the title alone. */
  if (chip && chip.trim().toLowerCase() === title.trim().toLowerCase()) { chip = null; chipFrom = null; }

  return {
    line1,
    line2,
    mark,
    chip,
    chipFrom,
    /* The band, as the composition draws it: full width, at the foot, 28 % of
     * the canvas, on the film's ground at 92 %. */
    band: { x: 0, y: canvas.h - bandH, w: canvas.w, h: bandH, opacity: 0.92 },
    box,
    imgW: view.w,
    imgH: view.h,
    /* Anchored to the capture's own left edge when it is wider than the canvas.
     *
     * A report or a page cropped about its middle loses its left column, and
     * the left column is where a document starts: the first version of this
     * card showed a session report beginning mid-word, "...oke 1", "...ance",
     * "...ons -> 500". Reading order decides the anchor. */
    dx: 0,
    dy: -Math.round((view.h - box.h) / 2),
    src: `${clipBase}${clip}/f${String(index).padStart(5, '0')}.png`,
    from: `${clip}/f${String(index).padStart(5, '0')}.png`,
    why: want.why || null,
  };
}

/**
 * How many frames of each shot's recording actually differ from the one before.
 *
 * This is a fact about the files on disk, and BOTH the render and the check of
 * the render need it: `assignTransitions()` refuses to cut hard into a picture
 * that does not move, and `verify.mjs` fails a shot that does not move as a
 * frozen shot. Measuring it in one place, on the script both tools load, is
 * what stops the two disagreeing — the same discipline 6.13 applied to the
 * caption offset, where the number lived in two files and they drifted.
 *
 * Cheap: sizes first, bytes only when two frames are the same length.
 */
function measureCaptureMotion(script) {
  for (const shot of script.shots) {
    if (!shot.clips || !shot.clips.length) continue;
    let moved = null;
    for (const clip of shot.clips) {
      const dir = urlToLocal(clip);
      if (!fs.existsSync(dir)) continue;
      moved = Math.max(moved == null ? 0 : moved, changedFrames(dir));
    }
    if (moved != null) shot.capturesMoved = moved;
  }
  return script;
}

/** The end card's words. The storyboard's graphics carry the tagline and the
 *  two fine lines; the wordmark and the ask are the card's, not a shot's. */
const END_CARD = {
  wordmark: 'QA Wrap',
  tagline: 'Every failure, traced.',
  ask: 'Free. No account. Nothing leaves your machine.',
  ...END_CARD_BRAND, // url + publisher: brand/brand.json
};

export function loadScript(id) {
  const p = path.join(FILM, 'script', `${id}.script.json`);
  if (fs.existsSync(p)) {
    return { script: JSON.parse(fs.readFileSync(p, 'utf8')), from: path.relative(REPO, p) };
  }
  if (id !== 'qa-wrap') throw new Error(`no script for "${id}" at ${p}, and no built-in fallback`);
  return {
    script: BIBLE_COMMERCIAL,
    from: 'BUILT-IN transcription of bible 3.3 (film/script/qa-wrap.script.json does not exist yet)',
  };
}

/**
 * Checkpoint 2 as delivered: `film/storyboard/<id>.storyboard.json` carries the
 * shot table, the caption spans, every capture's placement per pass and the
 * graphics, and `work/film/capture/<id>/marks.json` carries where a press really
 * happened. When that pair exists it IS the script, and the built-in
 * transcription is not used at all.
 */
/** The read, as `voice.mjs` writes it. The caption chunks come from here. */
export function loadVo(id) {
  const p = path.join(FILM_AUDIO_OUT, `${id}-vo.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

export function loadFilm(id, { pass = 'h', standin = false, aspect = '16x9', baseUrl = '', rev3 = false } = {}) {
  if (standin && rev3) {
    const script = { ...BIBLE_COMMERCIAL_R3 };
    const gen = chunksFromVo(STANDIN_VO, {
      shots: script.shots, fps: script.fps, lastOutSec: script.captionsLastOutSec,
    });
    script.captions = gen.cards;
    return {
      script,
      scriptFrom: 'BUILT-IN transcription of bible 3 rev 3 (no rev 3 storyboard on disk yet)',
      captureFrom: `stand-ins under ${path.relative(REPO, standinRoot(id, aspect))}`,
      storyboard: standinStoryboard(id, aspect, baseUrl, true),
      checks: null,
      notes: [`captions: ${gen.count} chunks generated from the read`, ...gen.faults.map((f) => `caption chunk: ${f}`)],
    };
  }
  const sbPath = path.join(FILM, 'storyboard', `${id}.storyboard.json`);
  if (!standin && fs.existsSync(sbPath)) {
    const sb = JSON.parse(fs.readFileSync(sbPath, 'utf8'));
    if (Array.isArray(sb.shots) && sb.shots.length) {
      /* The animated intro goes in front of the film. If the storyboard has not
       * been re-timed for it yet, everything in it moves later by the intro's
       * length and the intro becomes shot 0. Doing it here rather than by hand
       * in checkpoint 2 means the two cannot disagree about where 5.000 s is. */
      /* Only the commercial has an intro and drawn scenes. Without this gate
       * every 12 s and 16 s tool film also reads as "not yet introduced",
       * gets 2.000 s pushed in front of it and has its shots 1 to 3 replaced
       * by the QA desk. The lesson films open on their own first frame. */
      const isCommercial = id === COMMERCIAL;
      const introduced = !isCommercial || sb.seconds >= 58;
      if (!introduced) shiftStoryboard(sb, INTRO_SEC, sb.fps);
      /* The poster card goes in front of every LESSON film, on the same
       * mechanism and for the same reason: the storyboard on disk is not
       * re-timed by hand, it is shifted here, once, so the storyboard and the
       * composition cannot disagree about where 5.000 s is.
       *
       * Read the poster BEFORE the shift: its declaration names an absolute
       * film frame, and the index into the clip is measured from the shot's own
       * in-frame, which the shift moves. */
      const wantsPoster = !isCommercial && !sb.posterHold;
      const poster = wantsPoster
        ? posterCard(sb, { pass, clipBase: `${baseUrl}/${WORK_PREFIX}/`, aspect })
        : null;
      if (wantsPoster) {
        if (!poster) {
          throw new Error(`${id}: the storyboard declares no usable poster frame, so the film has `
            + 'no opening card. Add a `poster` block naming a pass, a shot and a frame.');
        }
        shiftStoryboard(sb, POSTER_HOLD, sb.fps);
        sb.posterHold = POSTER_HOLD;
      }
      const marksPath = path.join(FILM_CAPTURE, id, 'marks.json');
      const marks = fs.existsSync(marksPath) ? JSON.parse(fs.readFileSync(marksPath, 'utf8')) : null;
      const script = scriptFromStoryboard(sb, {
        pass, marks, endCard: END_CARD,
      /* A storyboard clip path is relative to the film's WORKING tree, which
       * is `work/film/` at the repository root, not `extension/tools/film/`.
       *
       * The captures moved out of the extension with everything else large
       * (`tools/lib-paths.mjs`), and the storyboards kept saying
       * `film/capture/<id>/h/shot-01` because that string is also what the
       * recorder writes and what the manifest reads. Two of the three readers
       * were re-pointed at the work tree; this one still resolved against
       * `extension/tools/`, where nothing has lived since the move, and the
       * render died on "missing f00000.png" for every shot. `serve()` already
       * serves `/work/...` from the repository root, so this only needed the
       * prefix it was already prepared to answer. */
        clipBase: `${baseUrl}/${WORK_PREFIX}/`,
      });
      /* The chip rail's words, read from the product rather than copied into
       * the storyboard (62 §3: `chip` is a hand copy on 21 storyboards, drawn
       * as pixels 3 to 5 times a film, with nothing reading it back — so a
       * renamed tool leaves twenty-one films saying the old name and nothing
       * fails). A shot that names a `chipKey` gets its words from
       * platform/i18n/en.json here, on the same read the poster card uses; a
       * shot that does not keeps its literal, exactly as before. */
      {
        const byN = new Map(sb.shots.map((x) => [x.n, x]));
        for (const sh of script.shots) {
          const src = byN.get(sh.n);
          if (src && src.chipKey) sh.chip = liveLabel(src.chipKey, { where: `${id} shot ${sh.n} chip` });
        }
      }
      if (!introduced) {
        /* The commercial's opening shot, in the slot rev 4 gave the animated
         * intro and for exactly its 2.000 s, so the film is still 58.000 s and
         * still cuts on the beat at 2.000.
         *
         * What changed, on the director's ruling of 2026-09-07: frame 0 used to
         * be BARE BASALT — measured YAVG 43, which is the ground and nothing
         * else — because the mark started drawing at 0.10 s from zero. Frame 0
         * is the first picture of the film everywhere it is listed, and Nader's
         * note was about all of them. So the card around the mark is now whole
         * on frame 0: the product's name, and a real frame of the product
         * working, taken from the film's own declared poster. The mark still
         * draws itself over it on bible 2.4's beats, so the shot moves and rev
         * 4's intro is not lost — it has a card to arrive on. */
        const opening = posterCard(sb, {
          pass, clipBase: `${baseUrl}/${WORK_PREFIX}/`, aspect, mark: true,
        });
        if (!opening) throw new Error(`${id}: no usable poster frame for the opening card`);
        script.seconds = sb.seconds;
        script.shots.unshift({
          n: 0, inSec: 0, outSec: INTRO_SEC, inFrame: 0, frames: Math.round(INTRO_SEC * sb.fps),
          rect: null, place: [], clips: [], chip: null,
          poster: opening,
        });
        (script.notes ||= []).push(`opening card ${INTRO_SEC.toFixed(3)} s from ${opening.from}`
          + ', with the mark drawing itself on it');
      }
      /* The commercial cuts hard. Bible 8.2 measures its transitions and bans a
       * cross-dissolve in it by name, and the ruling that produced the
       * vocabulary was about the twenty-one lesson films. The one thing it
       * cannot keep is the top-to-bottom wipe on its static shots, because that
       * mechanism no longer exists; they take the shape wipe 8.2 already
       * budgets. */
      if (isCommercial) script.hardCuts = true;
      if (poster) {
        script.seconds = sb.seconds;
        script.shots.unshift({
          n: 0, inSec: 0, outSec: POSTER_HOLD, inFrame: 0, frames: Math.round(POSTER_HOLD * sb.fps),
          rect: null, place: [], clips: [], chip: null,
          /* A poster that is still moving is not a poster. The card is whole on
           * frame 0 and holds; `hold` is the storyboard's own word for a
           * picture that is still on purpose, and the frozen-shot check in
           * `verify.mjs` already honours it. */
          hold: true,
          poster,
        });
        (script.notes ||= []).push(`poster card ${POSTER_HOLD.toFixed(3)} s from ${poster.from}`
          + (poster.why ? ` (${poster.why})` : ''));
        /* Where the chip's words came from, in the render record. A poster
         * whose chip is still a storyboard literal says so here, which is the
         * only way the drift 62 §3 measured becomes visible without a person
         * comparing two files by eye. */
        if (poster.chip) (script.notes ||= []).push(`poster chip "${poster.chip}" from ${poster.chipFrom}`);
      }
      measureCaptureMotion(script);
      /* Shots 1 to 3 are authored scenes now, not the fixture page: a QA at
       * work, drawn in the composition's own language. Their captures are no
       * longer read, so the storyboard's clip rows for them are ignored. */
      if (isCommercial) {
        for (const sh of script.shots) {
          if (SCENES[sh.n]) { sh.scene = SCENES[sh.n]; sh.rect = null; sh.place = []; sh.clips = []; }
        }
      }
      /* The 21 lesson films grow by 2.000 s, all of it on the end card, so the
       * close has room to be read rather than cut off. The growth is derived
       * from the VOICE file for the same reason the intro's shift is: the vo
       * and the storyboard are re-timed by different people at different
       * moments, and a length that is decided in one place cannot disagree
       * with itself. A vo that is exactly END_CARD_GROWTH longer than the
       * storyboard means the read has already been remade at the new length.
       * Idempotent: once the storyboard on disk is re-timed the two agree and
       * nothing is added. */
      const vo0 = loadVo(id);
      /* The read has to have been placed at the length the picture now is, or
       * every cue in the film is two seconds from its frame. This used to be a
       * silent 0 and a short film; it is a thrown error, because a film that is
       * quietly two seconds out of sync is exactly the fault nobody spots until
       * it is delivered. */
      if (poster && vo0 && Math.abs((vo0.seconds || 0) - (sb.seconds + END_CARD_GROWTH)) > 1e-6) {
        throw new Error(`${id}: the picture is ${sb.seconds.toFixed(3)} s with the poster card, so the read `
          + `must be ${(sb.seconds + END_CARD_GROWTH).toFixed(3)} s, and ${id}-vo.json is `
          + `${(vo0.seconds || 0).toFixed(3)} s.
  Shift the cues and re-place the read:
`
          + `    node tools/film/audio/shift-cues.mjs --id ${id} --by ${POSTER_HOLD.toFixed(3)}
`
          + `    cd tools/film/audio && python bed.py --id ${id} && node voice.mjs --id ${id} && node mix.mjs --id ${id}`);
      }
      const grow = (vo0 && Math.abs((vo0.seconds || 0) - (sb.seconds + END_CARD_GROWTH)) < 1e-6)
        ? END_CARD_GROWTH : 0;
      if (grow) {
        const end = script.shots[script.shots.length - 1];
        if (!end || !end.endCard) {
          (script.notes ||= []).push(`the read is ${grow.toFixed(3)} s longer than the storyboard but the last shot is not an end card; the film was left at ${script.seconds} s`);
        } else {
          end.outSec += grow;
          end.frames = Math.round((end.outSec - end.inSec) * script.fps);
          script.seconds += grow;
          /* The close anchors at the film's end, not at the cut: the card's
           * ground arrives on the cut and the staged reveals run so the last
           * line settles with CLOSE_TAIL to spare. Written as explicit beats,
           * which is the path the storyboard itself uses when it declares
           * them, so nothing in the timeline had to learn a new rule. */
          const a = script.seconds - CLOSE_ANCHOR;
          const e = typeof end.endCard === 'object' ? { ...end.endCard } : {};
          end.endCard = {
            ...e,
            maskAt: a, ringAt: a, wordmarkAt: a + 0.90, taglineAt: a + 1.50, fineAt: a + 2.60,
          };
          (script.notes ||= []).push(`end card grown ${grow.toFixed(3)} s to ${script.seconds.toFixed(3)} s, close anchored at ${a.toFixed(3)} s`);
        }
      }
      /* Rev 3 and later: the caption chunks are the read, generated from the
       * voice file rather than read out of the storyboard's caption spans. */
      const notes = script.notes || [];
      /* The voice file decides how its own captions are made: a read that
       * declares `captionMode: "per-line"` gets one card per spoken line
       * whatever the storyboard's revision says. The storyboards for the 21
       * lesson films carry no revision at all, and gating on that number
       * alone left them on the old span-derived cards. */
      if (sb.verbatim || (sb.revision || 0) >= 3 || (vo0 && vo0.captionMode === 'per-line')) {
        const vo = vo0;
        if (!vo) {
          notes.push('verbatim captions asked for but no <id>-vo.json on disk: the storyboard spans were used');
        } else {
          /* The offset is decided by the VOICE file, not the storyboard: the two
           * are re-timed by different people at different moments, and the vo
           * arriving already shifted while the storyboard has not is exactly
           * what happened. `captionMode` or a 58 s read means Builder B has
           * already moved the lines and they must not be moved again. */
          const voShifted = vo.captionMode === 'per-line' || (vo.seconds || 0) >= 58;
          const shiftBy = voShifted ? 0 : (introduced ? 0 : INTRO_SEC);
          const gen = captionsFromLines(vo, { fps: script.fps, offsetSec: shiftBy, lastSec: script.seconds });
          script.verbatim = true;
          script.captions = gen.cards;
          notes.push(`captions: ${gen.count} lines from ${id}-vo.json, one card per line`
            + (shiftBy ? `, shifted +${shiftBy.toFixed(3)} s for the intro` : ''));
          for (const f of gen.faults) notes.push(`caption: ${f}`);
          for (const f of gen.faults) notes.push(`caption chunk: ${f}`);
        }
      }
      return {
        script,
        scriptFrom: `${path.relative(REPO, sbPath)} (rev ${sb.revision}, pass ${pass})`,
        captureFrom: marks
          ? `${path.relative(REPO, path.join(FILM_CAPTURE, id))} with marks.json`
          : `${path.relative(REPO, path.join(FILM, 'capture', id))} (no marks.json)`,
        storyboard: { clips: {} },
        checks: sb.checks || null,
        notes,
      };
    }
  }
  const { script, from } = loadScript(id);
  const storyboard = loadStoryboard(id, { standin, aspect, baseUrl });
  return { script, scriptFrom: from, captureFrom: storyboard.from, storyboard, checks: null, notes: [] };
}

/** The older, thinner storyboard shape: a clip table, or PNG runs on disk. */
export function loadStoryboard(id, { standin, aspect, baseUrl }) {
  if (standin) return standinStoryboard(id, aspect, baseUrl, false);
  const p = path.join(FILM, 'storyboard', `${id}.storyboard.json`);
  const capRoot = path.join(FILM, 'capture', id);
  const clips = {};
  let from;
  if (fs.existsSync(p)) {
    const sb = JSON.parse(fs.readFileSync(p, 'utf8'));
    from = path.relative(REPO, p);
    for (const [clip, meta] of Object.entries(sb.clips || {})) {
      clips[clip] = { ...meta, dir: `${baseUrl}/${WORK_PREFIX}/film/capture/${id}/${clip}` };
    }
  }
  if (!Object.keys(clips).length && fs.existsSync(capRoot)) {
    from = path.relative(REPO, capRoot) + ' (counted from disk)';
    for (const shotDir of walkClips(capRoot)) {
      const rel = path.relative(capRoot, shotDir).split(path.sep).join('/');
      clips[rel] = { frames: countPngs(shotDir), dir: `${baseUrl}/${WORK_PREFIX}/film/capture/${id}/${rel}` };
    }
  }
  return { clips, from: from || 'NONE - no storyboard and no captures on disk' };
}

function walkClips(root) {
  const out = [];
  const visit = (d) => {
    const kids = fs.readdirSync(d, { withFileTypes: true });
    if (kids.some((k) => k.isFile() && /^f\d{5}\.png$/.test(k.name))) { out.push(d); return; }
    for (const k of kids) if (k.isDirectory()) visit(path.join(d, k.name));
  };
  visit(root);
  return out;
}
const countPngs = (d) => fs.readdirSync(d).filter((f) => /^f\d{5}\.png$/.test(f)).length;

/* ── stand-in captures ──────────────────────────────────────────────────── */

/* Real product frames from work/standin/frames, cropped (never scaled) to the
 * placement rectangles so the whole film can be composed and looked at before
 * Builder C's recordings exist. They are stand-ins in three visible ways: the
 * output directory carries -standin, the composition draws a slug in the
 * corner, and encode.mjs refuses to write to deliverables/ from them. */
const STANDIN_SRC = path.join(REPO, 'work', 'standin', 'frames'); // scratch: put product frame PNGs here to compose with stand-ins
const STANDIN_SHEET = path.join(REPO, 'work', 'standin', 'sheet.svg');

const STANDIN_PARTS = {
  STAGE: { file: 'vid-comm-s05.png', sx: 0, sy: 0, sw: 880, sh: 628, pad: [255, 255, 255] },
  PANEL: { file: 'vid-comm-s05.png', sx: 886, sy: 62, sw: 364, sh: 612, pad: [247, 245, 241] },
  PANEL_AWAKE: { file: 'vid-comm-s30.png', sx: 886, sy: 62, sw: 364, sh: 612, pad: [247, 245, 241] },
  WALL: { file: 'real-float-392x660.png', sx: 14, sy: 336, sw: 1000, sh: 718, pad: [247, 245, 241] },
  REPORT: { file: 'vid-comm-s30.png', sx: 0, sy: 100, sw: 1280, sh: 528, pad: [255, 255, 255] },
  DIAGRAM: { file: 'vid-comm-s38.png', sx: 0, sy: 0, sw: 1280, sh: 676, pad: [247, 245, 241] },
};

/** clip -> which stand-in part fills it. PAIR clips take an object. */
const STANDIN_CLIPS = {
  'commercial/shot-01': 'STAGE', 'commercial/shot-02': 'STAGE',
  'commercial/shot-03': 'STAGE', 'commercial/shot-04': 'STAGE',
  // Ruling 2: the panel shots are pairs now. The page is present as context at
  // full opacity, because it is the evidence; the panel is the actor.
  'commercial/shot-05': { PANEL: 'PANEL', STAGE: 'STAGE' },
  'commercial/shot-06': { PANEL: 'PANEL_AWAKE', STAGE: 'STAGE' },
  'commercial/shot-07': { PANEL: 'PANEL_AWAKE', STAGE: 'STAGE' },
  'commercial/shot-08': { PANEL: 'PANEL_AWAKE', STAGE: 'STAGE' },
  'commercial/shot-09': { PANEL: 'PANEL_AWAKE', STAGE: 'STAGE' },
  'commercial/shot-10': 'STAGE',
  'commercial/shot-11': { PANEL: 'PANEL_AWAKE', STAGE: 'STAGE' },
  'commercial/shot-12': { PANEL: 'PANEL_AWAKE', STAGE: 'STAGE' },
  'commercial/shot-13': 'REPORT',
  'commercial/shot-14': 'SHEET', 'commercial/shot-15': 'REPORT',
  'commercial/shot-16': 'WALL',
};

/** Rev 3: 13 shots, one clip each, the end card composition only. */
const STANDIN_CLIPS_R3 = {
  'commercial-r3/shot-01': 'STAGE', 'commercial-r3/shot-02': 'STAGE',
  'commercial-r3/shot-03': 'REPORT', 'commercial-r3/shot-04': 'PANEL_AWAKE',
  'commercial-r3/shot-05': { PANEL: 'PANEL_AWAKE', STAGE: 'STAGE' },
  'commercial-r3/shot-06': 'REPORT', 'commercial-r3/shot-07': 'REPORT',
  'commercial-r3/shot-08': 'REPORT',
  'commercial-r3/shot-09': { PANEL: 'PANEL_AWAKE', STAGE: 'STAGE' },
  'commercial-r3/shot-10': 'STAGE', 'commercial-r3/shot-11': 'SHEET',
  'commercial-r3/shot-12': 'WALL',
};

const standinRoot = (id, aspect) => path.join(OUT, '_standin', aspect, id);

function standinStoryboard(id, aspect, baseUrl, rev3 = false) {
  const clips = {};
  for (const clip of Object.keys(rev3 ? STANDIN_CLIPS_R3 : STANDIN_CLIPS)) {
    const vector = (rev3 ? STANDIN_CLIPS_R3 : STANDIN_CLIPS)[clip] === 'SHEET';
    clips[clip] = {
      frames: 1,
      ext: vector ? 'svg' : 'png',
      aspectRatio: vector ? 1123 / 794 : undefined,
      dir: `${baseUrl}/${WORK_PREFIX}/film/out/_standin/${aspect}/${id}/${clip}`,
    };
  }
  return { clips, from: `stand-ins under ${path.relative(REPO, standinRoot(id, aspect))}` };
}

/** Crop `sw x sh` out of a source PNG and centre it in a `w x h` canvas.
 *  Nothing is ever resampled; the remainder is the product's own page ground. */
function cropPad(srcFile, { sx, sy, sw, sh, pad }, w, h) {
  const src = PNG.sync.read(fs.readFileSync(srcFile));
  const dst = new PNG({ width: w, height: h });
  for (let i = 0; i < dst.data.length; i += 4) {
    dst.data[i] = pad[0]; dst.data[i + 1] = pad[1]; dst.data[i + 2] = pad[2]; dst.data[i + 3] = 255;
  }
  const cw = Math.min(sw, w, src.width - sx);
  const ch = Math.min(sh, h, src.height - sy);
  const dx = Math.floor((w - cw) / 2), dy = Math.floor((h - ch) / 2);
  for (let y = 0; y < ch; y++) {
    const s = ((sy + y) * src.width + sx) * 4;
    const d = ((dy + y) * w + dx) * 4;
    src.data.copy(dst.data, d, s, s + cw * 4);
  }
  return PNG.sync.write(dst);
}

export function makeStandins({ id = 'qa-wrap', aspects = ['16x9', '1x1', '9x16'], rev3 = false } = {}) {
  const made = [];
  const table = rev3 ? STANDIN_CLIPS_R3 : STANDIN_CLIPS;
  const from = rev3 ? BIBLE_COMMERCIAL_R3.shots : BIBLE_COMMERCIAL.shots;
  for (const aspect of aspects) {
    const rects = RECTS[aspect];
    const root = standinRoot(id, aspect);
    for (const [clip, part] of Object.entries(table)) {
      const shot = from.find((s) => s.clip === clip);
      const rectName = shot ? shot.rect : null;
      if (!rectName) continue;
      const boxes = rects[rectName];
      const write = (dir, box, key) => {
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, 'f00000.png');
        if (key === 'SHEET') {
          fs.copyFileSync(STANDIN_SHEET, path.join(dir, 'f00000.svg'));
          made.push(path.relative(REPO, path.join(dir, 'f00000.svg')));
          return;
        }
        fs.writeFileSync(target, cropPad(path.join(STANDIN_SRC, STANDIN_PARTS[key].file), STANDIN_PARTS[key], box.w, box.h));
        made.push(`${path.relative(REPO, target)}  ${box.w}x${box.h}`);
      };
      if (rectName === 'SHEET') { write(path.join(root, clip), boxes[0], 'SHEET'); continue; }
      if (rectName === 'PAIR') {
        const parts = PAIR_SOURCES[aspect];
        boxes.forEach((b, i) => write(path.join(root, clip, parts[i]), b, typeof part === 'object' ? part[parts[i]] : part));
        continue;
      }
      write(path.join(root, clip), boxes[0], typeof part === 'object' ? part.STAGE : part);
    }
  }
  return made;
}

/* ── loopback static server ─────────────────────────────────────────────── */

/* Chromium refuses ES-module imports and @font-face over file:// (opaque
 * origin, CORS), and the alternative is --allow-file-access-from-files, which
 * is exactly the kind of flag §7.6 forbids. So the composition is served from
 * 127.0.0.1 on an ephemeral port, out of the extension directory, and every
 * request the page makes is checked against that origin. Nothing leaves the
 * machine and an offline render succeeds. */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
  '.woff2': 'font/woff2', '.json': 'application/json',
};

export function serve(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      // `/work/…` is the frames, captures and audio the film pipeline writes.
      // They used to live inside the extension and be served by the line below
      // like anything else; they were 3 GB of the folder Chrome measures, so
      // they moved to the repository root and this is the second root that
      // reaches them. Still one origin, still nothing off the machine.
      const under = rel.startsWith(`${WORK_PREFIX}/`) ? REPO : root;
      const file = path.resolve(under, rel);
      if (!file.startsWith(path.resolve(under)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('no'); return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ── the render ─────────────────────────────────────────────────────────── */

export function outName({ id, aspect, reduced, standin }) {
  return [id, aspect === '16x9' ? null : aspect, reduced ? 'rm' : null, standin ? 'standin' : null]
    .filter(Boolean).join('-');
}

/** The capture may never be resampled. Checked, per clip, before frame 0. */
function assertNativeSizes({ script, storyboard, aspect, dsf }) {
  const faults = [];
  const rects = RECTS[aspect];
  for (const shot of script.shots) {
    if (!shot.rect) continue;

    /* The delivered storyboard states each capture's placement and clip. Check
     * the recording against exactly that: a capture is never scaled, and this
     * is where that stops being a rule and becomes a build failure. */
    if (shot.place && shot.place.length) {
      shot.place.forEach((box, i) => {
        const dir = urlToLocal(shot.clips[i]);
        const first = path.join(dir, 'f00000.png');
        if (!fs.existsSync(first)) { faults.push(`shot ${shot.n}: missing ${path.relative(REPO, first)}`); return; }
        const { width, height } = readPngSize(first);
        const want = { w: box.w * dsf, h: box.h * dsf };
        if (width !== want.w || height !== want.h) {
          faults.push(`shot ${shot.n} ${shot.rect}${box.role && box.role !== 'single' ? ' ' + box.role : ''}: `
            + `capture is ${width}x${height}, its rectangle at dsf ${dsf} is ${want.w}x${want.h}. `
            + 'Placing it would scale the capture, which is banned (bible 2.2).');
        }
        const have = fs.readdirSync(dir).filter((f) => /^f\d{5}\.png$/.test(f)).length;
        // A still shot is recorded once and held; anything else must have every
        // frame its slot asks for, or the film would freeze without saying so.
        shot.clipFrames = shot.clipFrames == null ? have : Math.min(shot.clipFrames, have);
        /* `capturesMoved` is measured in `loadFilm()` now, so that `verify.mjs`
         * — which never runs this function — builds its script from the same
         * numbers the render did. It used to be measured here and used here to
         * set `reveal: 'wipe'`, which is how the top-to-bottom wipe came to be
         * on every cut in the set. */
        /* Too FEW frames is the fault this guard exists for: the slot would run
         * out of picture and the film would freeze without saying so. Too MANY
         * is a shot the storyboard has trimmed since it was filmed, and the
         * trim takes the head and drops the tail — which is the hold, not the
         * action. `clipFrames` above has already clamped to the shorter of the
         * two, so the render consumes exactly the frames the slot asks for.
         * Reported rather than silent, because dropping recorded frames should
         * never be invisible. research/78 §7. */
        if (shot.frames && have < shot.frames && !(shot.still && have === 1)) {
          faults.push(`shot ${shot.n}: only ${have} frames on disk, the storyboard says ${shot.frames}`
            + (shot.still ? ' (declared still, so 1 or all of them)' : ''));
        } else if (shot.frames && have > shot.frames && !shot.still) {
          console.log(`          trim  shot ${shot.n}: ${have} frames filmed, ${shot.frames} used `
            + `(${((have - shot.frames) / 30).toFixed(2)} s of tail hold dropped)`);
        }
      });
      continue;
    }

    if (shot.rect === 'SHEET') continue;
    const meta = storyboard.clips[shot.clip];
    if (!meta) { faults.push(`shot ${shot.n}: no capture for clip ${shot.clip}`); continue; }
    const boxes = rects[shot.rect];
    const parts = shot.rect === 'PAIR' ? PAIR_SOURCES[aspect] : [null];
    boxes.forEach((box, i) => {
      const dir = meta.local || urlToLocal(meta.dir);
      const file = path.join(dir, parts[i] || '', 'f00000.png');
      if (!fs.existsSync(file)) { faults.push(`shot ${shot.n}: missing ${path.relative(REPO, file)}`); return; }
      const { width, height } = readPngSize(file);
      const want = { w: box.w * dsf, h: box.h * dsf };
      if (width !== want.w || height !== want.h) {
        faults.push(`shot ${shot.n} ${shot.rect}: capture is ${width}x${height}, its rectangle at dsf ${dsf} is ${want.w}x${want.h}. `
          + 'Placing it would scale the capture, which is banned (bible 2.2). Re-record at the rectangle, or render at the matching dsf.');
      }
    });
  }
  return faults;
}

/**
 * The local file behind a served URL.
 *
 * Two roots now, because the working trees left the extension folder: anything
 * under `/work/` is resolved against the repository, everything else against
 * the extension, which is what `serve()` does with the same two prefixes. A
 * URL that is neither is returned unchanged — the caller may already have a
 * path.
 */
function urlToLocal(dirUrl) {
  const raw = String(dirUrl);
  const m = raw.match(/^https?:\/\/127\.0\.0\.1:\d+\/(.*)$/);
  /* Also accept a bare served path. `loadFilm` is called with `baseUrl: ''` by
   * `verify.mjs` and by anything that only wants the script, and the clips are
   * then `/work/film/capture/...` rather than a URL. Returning that unchanged
   * made every capture "not on disk", silently, which is how the motion
   * measurement came back undefined for a whole film. */
  const rel = (m ? m[1] : raw).replace(/^\/+/, '');
  if (m || rel.startsWith(`${WORK_PREFIX}/`)) {
    return rel.startsWith(`${WORK_PREFIX}/`) ? path.join(REPO, rel) : path.join(EXT, rel);
  }
  return dirUrl;
}

function readPngSize(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(33);
  fs.readSync(fd, buf, 0, 33, 0);
  fs.closeSync(fd);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export async function renderFrames(opts) {
  const {
    id = 'qa-wrap', aspect = '16x9', pass = 'h', reduced = false, standin = false, rev3 = false,
    dsf = standin ? 1 : 2, workers = 4, from = 0, to = null, only = null, shots = null, force = false,
    log = console.log,
  } = opts;

  const { server, port } = await serve(EXT);
  const baseUrl = `http://127.0.0.1:${port}`;
  const film = loadFilm(id, { pass, standin, aspect, baseUrl, rev3 });
  const { script, scriptFrom, storyboard } = film;
  const faults = scriptFaults(script);

  const dir = path.join(OUT, outName({ id, aspect, reduced, standin }));
  fs.mkdirSync(dir, { recursive: true });

  const T = buildTimeline({ script, storyboard, aspect, reduced, standin });
  const sizeFaults = assertNativeSizes({ script, storyboard, aspect, dsf });

  log(`film      ${id}  ${aspect}${reduced ? '  reduced-motion' : ''}${standin ? '  STAND-IN' : ''}`);
  log(`script    ${scriptFrom}`);
  log(`captures  ${film.captureFrom}`);
  log(`out       ${path.relative(REPO, dir)}   ${T.frames} frames @ ${T.fps} fps, dsf ${dsf}`);
  for (const n of film.notes || []) log(`note      ${n}`);
  const stillish = script.shots.filter((sh) => sh.rect && sh.capturesMoved != null && sh.capturesMoved < 6);
  if (stillish.length) {
    log(`still     ${stillish.length} shot(s) barely move: `
      + stillish.map((sh) => `${sh.n} (${sh.capturesMoved} changed)`).join(', '));
  }
  log(`transition${script.shots.slice(1).map((sh) => ` ${sh.n}:${sh.transition ? sh.transition.kind + (sh.transition.from ? '/' + sh.transition.from : '') : '?'}`).join('')}`);
  for (const f of transitionFaults(script)) log(`transition FAULT ${f}`);
  for (const p of T.pushes) log(`caption   push: ${p}`);
  if (T.faults.length) log(`caption   ${T.faults.length} reading-time fault(s): ${T.faults.join('; ')}`);
  if (faults.length) log(`script    ${faults.length} structural fault(s):\n  - ${faults.join('\n  - ')}`);
  if (sizeFaults.length) {
    server.close();
    throw new Error(`capture placement would scale a recording:\n  - ${sizeFaults.join('\n  - ')}`);
  }

  const list = shots
    ? framesForShots(T, shots)
    : only
    ? String(only).split(',').map(Number)
    : Array.from({ length: (to == null ? T.frames - 1 : Number(to)) - Number(from) + 1 }, (_, i) => Number(from) + i);
  const todo = force ? list : list.filter((n) => !fs.existsSync(framePath(dir, n)));
  if (shots) log(`shots     ${shots}: frames ${list[0]}..${list[list.length - 1]}, ${list.length} of ${T.frames}; every other frame on disk is kept`);
  log(`todo      ${todo.length} of ${list.length} frames${todo.length < list.length ? ' (resuming)' : ''}`);

  const t0 = Date.now();
  const browser = await chromium.launch({
    headless: true,
    args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text',
      '--no-first-run', '--no-default-browser-check', '--disable-features=Translate,MediaRouter'],
  });

  const offOrigin = [];
  const lanes = Math.max(1, Math.min(Number(workers), 8));
  const chunks = Array.from({ length: lanes }, () => []);
  todo.forEach((n, i) => chunks[i % lanes].push(n));

  let done = 0;
  let probed = false;
  await Promise.all(chunks.map(async (chunk) => {
    if (!chunk.length) return;
    const ctx = await browser.newContext({
      viewport: { width: T.canvas.w, height: T.canvas.h },
      deviceScaleFactor: dsf,
      reducedMotion: reduced ? 'reduce' : 'no-preference',
      colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    page.on('request', (r) => { if (!r.url().startsWith(baseUrl)) offOrigin.push(r.url()); });
    await page.goto(`${baseUrl}/tools/film/compose/composition.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fontsReady === true, null, { timeout: 30_000 });
    await page.evaluate((d) => window.setFilm(d), {
      script, storyboard, aspect, reduced, standin,
    });
    /* The placement probe, run once per lane before any frame is written.
     * It catches the class of fault a stand-in cannot: the file is the right
     * size and the assertion above passes, but the browser lays it out at its
     * intrinsic size and the capture is drawn at 2x and clipped. Cheap, and it
     * is the only check that looks at what was actually drawn. */
    if (!probed) {
      probed = true;
      const probeFrame = firstCaptureFrame(T);
      await page.evaluate((f) => window.renderFrame(f), probeFrame);
      const seen = await page.evaluate(() => window.__probe());
      const bad = seen.filter((c) => Math.abs(c.drawn.w - c.want.w) > 0.5 || Math.abs(c.drawn.h - c.want.h) > 0.5);
      const wrongFile = seen.filter((c) => c.natural && (c.natural.w !== c.want.w * dsf || c.natural.h !== c.want.h * dsf));
      if (bad.length || wrongFile.length) {
        await browser.close(); server.close();
        const say = (c) => `slot ${c.i}: drawn ${c.drawn.w}x${c.drawn.h}, rectangle ${c.want.w}x${c.want.h}, `
          + `file ${c.natural ? `${c.natural.w}x${c.natural.h}` : 'vector'} at dsf ${dsf}  (${c.src})`;
        throw new Error(`placement probe failed at frame ${probeFrame}, the capture would be scaled:` + '\n  - '
          + [...bad, ...wrongFile].map(say).join('\n  - '));
      }
      log(`probe     frame ${probeFrame}: ${seen.length} capture(s) drawn at their rectangle, dsf ${dsf}`);
    }

    for (const n of chunk) {
      await page.evaluate((f) => window.renderFrame(f), n);
      const buf = await page.screenshot({ animations: 'disabled', type: 'png', scale: 'device' });
      fs.writeFileSync(framePath(dir, n), buf);
      if (++done % 60 === 0) log(`          ${done}/${todo.length}  ${((Date.now() - t0) / done).toFixed(0)} ms/frame`);
    }
    await ctx.close();
  }));

  await browser.close();
  server.close();

  if (offOrigin.length) throw new Error(`the composition requested ${offOrigin.length} URL(s) off its own origin: ${[...new Set(offOrigin)].slice(0, 5).join(', ')}`);

  const ms = Date.now() - t0;
  log(`rendered  ${done} frames in ${(ms / 1000).toFixed(1)} s  (${done ? (ms / done).toFixed(0) : 0} ms/frame, ${lanes} lanes)`);
  return { dir, frames: T.frames, rendered: done, ms, timeline: T, scriptFrom, captureFrom: film.captureFrom, checks: film.checks, notes: film.notes, dsf, faults, captionFaults: T.faults, captionPushes: T.pushes };
}

export const framePath = (dir, n) => path.join(dir, `f${String(n).padStart(5, '0')}.png`);

/**
 * How many frames of a capture sequence differ from the one before.
 *
 * The critic's second pass found the reveal firing only where a storyboard set
 * `still: true`, which only the five feature files did, so every commercial and
 * tool shot stayed frozen while claiming `motion: true`. The flag was the wrong
 * input: what matters is whether the pictures differ, and that is measurable
 * here, before a frame is rendered.
 *
 * Sizes first, because a PNG of a different picture is almost always a
 * different length and a stat costs nothing. Only where two consecutive files
 * are the same length are the bytes compared, so a moving clip is never read
 * and a frozen one is read once.
 */
function changedFrames(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^f\d{5}\.png$/.test(f)).sort();
  if (files.length < 2) return 0;
  let changed = 0;
  let prevSize = null, prevBuf = null, prevPath = null;
  for (const f of files) {
    const full = path.join(dir, f);
    const size = fs.statSync(full).size;
    if (prevSize == null) { prevSize = size; prevPath = full; continue; }
    if (size !== prevSize) { changed++; prevSize = size; prevBuf = null; prevPath = full; continue; }
    // Same length: compare the bytes before calling it a duplicate.
    prevBuf = prevBuf || fs.readFileSync(prevPath);
    const buf = fs.readFileSync(full);
    if (!buf.equals(prevBuf)) changed++;
    prevSize = size; prevBuf = buf; prevPath = full;
  }
  return changed;
}

/**
 * Which frames a set of shots owns.
 *
 * A frame's picture is a pure function of its number, so when one capture is
 * re-recorded only that shot's frames can change and every other PNG on disk is
 * still correct. This resolves `--shots=2,5` to the frame numbers to redraw:
 * each shot's own range, plus any frame outside it that shares a caption chunk
 * with the shot's boundary, because a chunk that straddles a cut is drawn from
 * state that spans both sides and is cheaper to redraw than to reason about.
 */
export function framesForShots(T, list) {
  /* Number.isFinite, not Boolean: shot 0 is the intro, and filter(Boolean)
   * silently dropped it, so `--shots=0,1` re-rendered shot 1 alone and the
   * intro kept its stale frames. */
  const want = new Set(String(list).split(',').map((x) => Number(x.trim())).filter(Number.isFinite));
  const fps = T.fps;
  const frames = new Set();
  const bounds = [];
  for (const sh of T.shots) {
    if (!want.has(sh.n)) continue;
    const a = sh.inFrame != null ? sh.inFrame : Math.round(sh.inSec * fps);
    const b = Math.round(sh.outSec * fps) - 1;
    bounds.push([sh.inSec, sh.outSec]);
    for (let n = a; n <= b; n++) frames.add(n);
  }
  for (const c of T.cards) {
    const straddles = bounds.some(([i, o]) => (c.inSec < i && c.outSec > i) || (c.inSec < o && c.outSec > o));
    if (!straddles) continue;
    for (let n = Math.round(c.inSec * fps); n < Math.round(c.outSec * fps); n++) {
      if (n >= 0 && n < T.frames) frames.add(n);
    }
  }
  return [...frames].sort((a, b) => a - b);
}

/** The first frame that actually shows a capture, for the placement probe. */
function firstCaptureFrame(T) {
  for (const shot of T.shots) {
    if (shot.rect) return Math.round(shot.inSec * T.fps) + 1;
  }
  return 0;
}

/* ── cli ────────────────────────────────────────────────────────────────── */

/* The basename, not a suffix. `endsWith('frames.mjs')` is also true of
   `proof-frames.mjs`, `standin-frames.mjs` and anything else that ends in those
   nine characters, so importing this module from such a file silently ran a
   whole render instead of the caller's own main. Measured once, at the cost of
   two minutes and a confusing log. */
if (path.basename(process.argv[1] || '') === 'frames.mjs') {
  const a = argv();
  if (a['make-standins']) {
    const made = makeStandins({ id: a.film || a.id || 'qa-wrap', aspects: a.aspect ? [a.aspect] : ['16x9', '1x1', '9x16'], rev3: !!a.rev3 });
    console.log(`wrote ${made.length} stand-in captures:`);
    for (const m of made) console.log('  ' + m);
  } else {
    renderFrames({
      id: a.film || a.id || 'qa-wrap', aspect: a.aspect || '16x9', pass: a.pass || 'h',
      reduced: !!a.reduced, standin: !!a.standin, rev3: !!a.rev3,
      dsf: a.dsf ? Number(a.dsf) : undefined,
      workers: a.workers ? Number(a.workers) : 4,
      from: a.from ? Number(a.from) : 0, to: a.to ?? null, only: a.only ?? null,
      shots: a.shots ?? null, force: !!(a.force || a.shots),
    }).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
  }
}
