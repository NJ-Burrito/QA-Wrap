/* QA Wrap — film composition. Builder A. Deterministic timeline.
 *
 * Spec: research/33-film-bible.md. Motion constants: research/31-video-craft.md
 * §2.1 (easings), §2.2 (Carbon duration ladder), §2.3 (stagger), §3.1 (type).
 *
 * The one rule this file exists to enforce: **every visual state is a pure
 * function of an integer frame number.** No wall clock, no CSS animation, no
 * WAAPI playback. `stateAt(n)` for the same n gives the same object forever, on
 * any machine, in any order, which is what makes the render resumable and
 * parallel by frame range.
 *
 * This module is imported by BOTH node (frames/encode/verify) and the browser
 * (composition.html), so it touches no `fs` and no `document`.
 */

/* ── easing ─────────────────────────────────────────────────────────────── */

/** Newton + bisection solver for a CSS cubic-bezier. Deterministic. */
export function bezier(x1, y1, x2, y2) {
  const A = (a, b) => 1 - 3 * b + 3 * a;
  const B = (a, b) => 3 * b - 6 * a;
  const C = (a) => 3 * a;
  const calc = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(t, x1, x2);
      if (d === 0) break;
      const e = calc(t, x1, x2) - x;
      if (Math.abs(e) < 1e-7) return calc(t, y1, y2);
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const e = calc(t, x1, x2) - x;
      if (Math.abs(e) < 1e-7) break;
      if (e > 0) hi = t; else lo = t;
      t = (lo + hi) / 2;
    }
    return calc(t, y1, y2);
  };
}

export const EASE = {
  linear: (t) => t,
  /** Carbon productive — overlays that annotate live UI (R1 §2.1). */
  productive: bezier(0.2, 0, 0.38, 0.9),
  /** Carbon expressive — title and end cards. */
  expressive: bezier(0.4, 0.14, 0.3, 1),
  /** Shape wipe / move within frame (Material standard). */
  wipe: bezier(0.4, 0, 0.2, 1),
  /** BRAND §4 — the mark's own wake, and the click ring. */
  mark: bezier(0.2, 0.8, 0.2, 1),
};

/** Carbon ladder, ms. Nothing in this film uses a duration off this list. */
export const DUR = { f1: 70, f2: 110, mod1: 150, mod2: 240, slow1: 400, slow2: 700 };

/** Progress through a segment [start, start+dur) in seconds, eased. */
function seg(t, start, durMs, ease = EASE.linear) {
  const d = durMs / 1000;
  if (d <= 0) return t >= start ? 1 : 0;
  return ease(Math.max(0, Math.min(1, (t - start) / d)));
}

/* ── canvases, zones, placement rectangles (bible §2.3, §2.6, §5.3) ─────── */

export const CANVASES = {
  '16x9': { w: 1920, h: 1080 },
  '1x1': { w: 1080, h: 1080 },
  '9x16': { w: 1080, h: 1920 },
};

/**
 * Zones per aspect, in canvas CSS pixels. 16:9 numbers are the bible's, quoted.
 * 1:1 keeps the same vertical bands (H is 1080 in both) and insets x to the
 * square's title-safe box. 9:16 hangs the bands off the capture, whose centre
 * sits at y 834 per §2.6.
 */
export const ZONES = {
  '16x9': {
    safeX: 96, safeY: 54,
    chipRail: { x: 96, y: 56, w: 1728, h: 54 },
    stage: { x: 96, y: 140, w: 1728, h: 720 },
    // Ruling 6: nothing text-bearing outside the safe box. The bible's own
    // 900..1044 band is 18 px past the 1026 title-safe bottom once a caption
    // runs to two lines, so the band is bottom-aligned to title safe instead.
    caption: { x: 96, y: 896, w: 1728, h: 130 },
  },
  '1x1': {
    safeX: 54, safeY: 54,
    chipRail: { x: 54, y: 56, w: 972, h: 54 },
    stage: { x: 54, y: 140, w: 972, h: 720 },
    caption: { x: 54, y: 896, w: 972, h: 130 },
  },
  '9x16': {
    // The universal safe box is 875 x 828 at (65, 420), i.e. y 420..1248.
    // Both text zones sit inside it, at the bottom, and the capture takes the
    // whole frame above them. That moves the capture's centre off the bible's
    // y 834; the alternative was text outside the box, which ruling 6 forbids.
    safeX: 65, safeY: 420,
    chipRail: { x: 65, y: 1030, w: 875, h: 54 },
    stage: { x: 65, y: 96, w: 940, h: 904 },
    caption: { x: 65, y: 1104, w: 875, h: 144 },
  },
};

/**
 * Placement rectangles. `w`/`h` are CSS pixels in the composition and are
 * therefore also the CSS viewport the surface must be recorded at (§2.2: the
 * capture is recorded at the exact pixel size it will occupy; it is never
 * scaled). `PAIR` is two placements. `SHEET` is a vector fitted to a box.
 */
export const RECTS = {
  '16x9': {
    // Ruling 2: a single PANEL at x 192 left 1308 px of empty ground. A panel
    // shot with no page state centres instead; a panel shot with one is a PAIR.
    PANEL: [{ x: 750, y: 140, w: 420, h: 720 }],
    WALL: [{ x: 600, y: 140, w: 720, h: 720 }],
    STAGE: [{ x: 420, y: 140, w: 1080, h: 720 }],
    REPORT: [{ x: 320, y: 140, w: 1280, h: 720 }],
    DIAGRAM: [{ x: 320, y: 140, w: 1280, h: 720 }],
    PAIR: [{ x: 96, y: 140, w: 420, h: 720 }, { x: 660, y: 140, w: 1080, h: 720 }],
    SHEET: [{ x: 96, y: 140, w: 1728, h: 720, fit: 'height' }],
  },
  '1x1': {
    PANEL: [{ x: 330, y: 140, w: 420, h: 720 }],
    WALL: [{ x: 180, y: 140, w: 720, h: 720 }],
    STAGE: [{ x: 100, y: 190, w: 880, h: 620 }],
    REPORT: [{ x: 100, y: 190, w: 880, h: 620 }],
    DIAGRAM: [{ x: 100, y: 190, w: 880, h: 620 }],
    // Ruling 2: stacked, so nothing falls back to the STAGE half. The panel
    // leads because it is the actor; the page carries the evidence under it.
    PAIR: [{ x: 330, y: 140, w: 420, h: 300 }, { x: 100, y: 460, w: 880, h: 400 }],
    SHEET: [{ x: 54, y: 190, w: 972, h: 620, fit: 'width' }],
  },
  '9x16': {
    PANEL: [{ x: 330, y: 118, w: 420, h: 860 }],
    WALL: [{ x: 310, y: 118, w: 460, h: 860 }],
    STAGE: [{ x: 130, y: 268, w: 820, h: 560 }],
    REPORT: [{ x: 130, y: 268, w: 820, h: 560 }],
    DIAGRAM: [{ x: 130, y: 268, w: 820, h: 560 }],
    PAIR: [{ x: 330, y: 96, w: 420, h: 390 }, { x: 130, y: 510, w: 820, h: 490 }],
    SHEET: [{ x: 65, y: 96, w: 940, h: 904, fit: 'width' }],
  },
};

/** Which placement of a PAIR each single-rect clip fills. */
export const PAIR_SOURCES = { '16x9': ['PANEL', 'STAGE'], '1x1': ['PANEL', 'STAGE'], '9x16': ['PANEL', 'STAGE'] };

/* ── the transition vocabulary (director's ruling, 2026-09-06) ───────────── */

/**
 * Four transitions, and every cut chooses its own from what the cut shows.
 *
 * ── why this exists ───────────────────────────────────────────────────────
 *
 * Until this ruling every shot change in the twenty-one lesson films was the
 * same top-to-bottom wipe: §6.10's `reveal: 'wipe'`, fired wherever a capture
 * did not move enough to look alive. It was the right fix for a frozen shot and
 * the wrong one for a film, because a mannerism repeated on every cut stops
 * being motion and becomes a tic. Nader watched the set and said so.
 *
 * So the wipe is gone — `clipBottom` no longer exists in the state object, and
 * `transitionFaults()` fails any film that tries to bring it back — and each
 * cut now carries its own transition as DATA on the shot it opens, chosen from
 * what that cut actually shows:
 *
 *   cut       a hard cut on the beat, nothing moves. For a cause and its
 *             effect: a press in one shot and its result in the next are one
 *             event, and anything between them narrates a gap that is not
 *             there. Also the only transition into a card, whose own staged
 *             reveal is the bridge (bible 2.8, and the rev-4 ruling that a
 *             card dissolving to bare ground first spends a beat on nothing).
 *   dissolve  400 ms cross-fade, linear. For a change of PLACE: a different
 *             surface, or the same surface at a different placement rectangle.
 *             Permitted by 35-render 6.12, which made it the default reveal and
 *             overrode bible 2.9 rule 13.
 *   push      240 ms, cubic-bezier(.4,0,.2,1). The incoming capture enters from
 *             the edge its own rectangle sits against and lands exactly on its
 *             placement. For the same place carrying on: a panel opening pushes
 *             from the panel's edge. The capture is NEVER resampled and the
 *             offset is exactly zero on every frame after the transition; what
 *             moves is the picture arriving, not a camera. Bible 2.9 rule 1's
 *             "no push" governs a camera move over a held shot — it sits inside
 *             "No scaling of the capture" — and the director's ruling of
 *             2026-09-06 permits a transition push between two shots the same
 *             way 6.12 permitted the dissolve.
 *   reveal    240 ms clip-path inset() from the right, no feather. This is the
 *             commercial's own render-time reveal, bible 2.8's shape wipe, used
 *             at its shot 16 and nowhere else. Here it carries the static
 *             captures: a shot recorded once and held has no motion of its own
 *             and the reveal supplies it, which is what the frozen-shot check
 *             in `verify.mjs` is measuring.
 *
 * ── the two rules the chooser enforces ────────────────────────────────────
 *
 * 1. No two consecutive cuts take the same transition, unless both are `cut`
 *    (a chain of cause and effect is one idea, and breaking it up is worse).
 * 2. Nothing anywhere is a top-to-bottom wipe.
 *
 * The chooser is deterministic and reads only the script, never a measurement:
 * `frames.mjs` knows how many frames of a capture changed and `verify.mjs` does
 * not, so a chooser that read that number would assign different transitions in
 * the render and in the check of the render. That is the same class of fault as
 * the caption offset in 6.13, and it is avoided the same way — one input, and
 * the storyboard is it.
 */
/**
 * The four, and how long each takes.
 *
 * `reveal` is bible 2.8's shape wipe, which the commercial runs at 240 ms as
 * punctuation ON a moving shot. Here it is the ONLY motion a held picture has,
 * and 240 ms is 7 frames — one frame clear of the frozen-shot gate's six, which
 * is not a margin, it is a coincidence. So it is drawn at the next step up the
 * Carbon ladder: 400 ms, 12 frames, unmistakably alive.
 */
export const TRANSITION_MS = { cut: 0, dissolve: DUR.slow1, push: DUR.mod2, reveal: DUR.slow1 };
export const TRANSITION_KINDS = Object.keys(TRANSITION_MS);
/** When a cut's first choice collides with the cut before it, in order. */
const ALTERNATIVES = {
  dissolve: ['push', 'reveal'],
  push: ['dissolve', 'reveal'],
  reveal: ['dissolve', 'push'],
};

/**
 * Does this shot's picture move on its own?
 *
 * Two answers, and the measured one wins. `still: true` is the storyboard
 * saying a shot was recorded once and held. `capturesMoved` is how many frames
 * of the recording actually differ from the one before, counted off disk by
 * `loadFilm()` — because a storyboard that says `still: false` and `motion:
 * true` about a recording in which nothing happens is describing an intention,
 * and the frozen-shot check measures the film.
 *
 * Six is `verify.mjs`'s own threshold, quoted rather than re-chosen.
 */
const isStatic = (s) => !!s.still || (s.capturesMoved != null && s.capturesMoved < 6);

/** The identity of what a shot frames: surface plus placement, as §8.2 asks. */
function placeKey(shot, rects) {
  if (shot.intro) return 'intro';
  if (shot.poster) return 'poster';
  if (shot.scene) return `scene:${shot.scene}`;
  if (!shot.rect) return 'card';
  const boxes = (shot.place && shot.place.length) ? shot.place : ((rects && rects[shot.rect]) || []);
  return `${shot.rect}|${boxes.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join(';')}`;
}

/**
 * Which edge a push comes from: the one the SURFACE opens from, not the one its
 * rectangle happens to be placed against.
 *
 * The product's own panel opens from the right of a browser window, and that is
 * true whether the composition centres its 420 px rectangle or hangs it off the
 * frame edge. Placement is a composition decision; direction is a fact about
 * the thing being filmed, and the director's ruling says the push goes in the
 * direction of the action. A document (a report, a diagram, an exported sheet)
 * is not opened from a side; it arrives, and a thing arriving comes up from the
 * bottom.
 *
 * A rectangle nothing here knows falls back to where it sits in the frame.
 */
const PUSH_EDGE = {
  PANEL: 'right', WALL: 'right', PAIR: 'right',
  STAGE: 'bottom', REPORT: 'bottom', DIAGRAM: 'bottom', SHEET: 'bottom',
};
/**
 * How far a push travels, in canvas pixels at a 1080 px short edge.
 *
 * 64 is the capture card's own shadow blur (bible 2.2: `0 24px 64px`), so the
 * picture arrives out of the distance its shadow already describes. It is a
 * house number rather than a taste, and it scales with the frame like every
 * other length here. A translate this size fades in over the same 240 ms, which
 * is bible 2.4's enter motion for every other element in the film: translate
 * plus opacity, never translate alone, so the card is never seen part-empty.
 */
export const PUSH_PX = 64;
/** The two transitions that need the outgoing picture underneath them. */
const CROSSFADED = new Set(['dissolve', 'push']);
export function pushEdge(shot, rects, canvas) {
  if (PUSH_EDGE[shot.rect]) return PUSH_EDGE[shot.rect];
  const boxes = (shot.place && shot.place.length) ? shot.place : ((rects && rects[shot.rect]) || []);
  if (!boxes.length) return 'bottom';
  const x0 = Math.min(...boxes.map((b) => b.x));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const centre = (x0 + x1) / 2;
  const slack = canvas.w * 0.05;
  if (centre < canvas.w / 2 - slack) return 'left';
  if (centre > canvas.w / 2 + slack) return 'right';
  return 'bottom';
}

/**
 * Put a transition on every shot, in place. Idempotent, and a transition the
 * storyboard declared itself is never overwritten.
 */
/**
 * @param {object} script
 * @param {object} o
 * @param {boolean} o.hardCuts  the commercial's policy: every cut is hard
 *   except where the picture does not move, and there it is the shape wipe.
 *
 *   Bible 8.2 gates the commercial and only the commercial on its transitions:
 *   "Zero cross-dissolves. One fade up. One mask reveal, on the end card only."
 *   Its cut count is also an acceptance number rather than a taste, and a
 *   dissolve is invisible to the scene detector when the two shots share their
 *   ground. Measured: given the full vocabulary the commercial's detected cuts
 *   fell from 10 of 10 to 7 of 10 and `verify.mjs` failed it.
 *
 *   So the commercial keeps its hard cuts. What it cannot keep is the
 *   top-to-bottom wipe its four measured-static shots were taking, because that
 *   mechanism is gone; they take the shape wipe instead, which is the same
 *   240 ms clip-path 8.2 already budgets and is what those shots should have
 *   had. Nothing else about the edit moves.
 */
export function assignTransitions(script, { rects = null, canvas = null, hardCuts = false } = {}) {
  const shots = script.shots || [];
  const frame = canvas || CANVASES['16x9'];
  let previous = null;
  shots.forEach((s, i) => {
    if (i === 0) { s.transition = { kind: 'cut', ms: 0, why: 'frame 0 is an opening, not a cut' }; return; }
    if (s.transition && s.transition.authored) { previous = s.transition; return; }
    const p = shots[i - 1];
    const samePlace = placeKey(p, rects) === placeKey(s, rects);
    let kind;
    let why;
    if (!s.rect) { kind = 'cut'; why = 'into a card, whose own staged reveal is the bridge'; }
    /* A static capture takes precedence over every other reason, including the
     * two that would cut hard, because a hard cut to a picture that does not
     * move is a photograph with a caption on it — which is exactly what
     * `verify.mjs` fails as a frozen shot. The reveal is then the shot's only
     * motion, and it has to be there before anything else is decided. */
    else if (isStatic(s)) { kind = 'reveal'; why = 'a static capture, so the reveal is its motion'; }
    else if (hardCuts) { kind = 'cut'; why = 'this film cuts hard (bible 8.2)'; }
    /* A card's exit is a hard cut (bible 2.4), and that includes the poster
     * card and the animated intro: a title that dissolves into the film spends
     * a beat on neither, which is the rev-4 ruling on the intro restated. */
    else if (p.poster || p.intro) { kind = 'cut'; why = 'out of a card, which exits on a hard cut'; }
    /* Cause and effect outranks a change of place: a press and its result are
     * one event however far the picture travels between them, and a move put
     * between the two halves narrates a gap that is not there. The signal is
     * the film's own sound (a shot that opens on its `success` cue IS the
     * result of the shot before it) or a press drawn in the shot before. */
    else if (s.isResult || p.hasRing) { kind = 'cut'; why = 'cause and effect: the press is in the shot before'; }
    else if (!samePlace) { kind = 'dissolve'; why = 'a change of place'; }
    else { kind = 'push'; why = 'the same place carrying on'; }
    /* Rule 1. A cut-on-beat pair may repeat; nothing else may. */
    if (kind !== 'cut' && previous && previous.kind === kind) {
      /* A film that cuts hard has no cross-dissolve available to break a run
       * of reveals: bible 8.2 bans one in the commercial by name. It breaks the
       * run with a push instead, which is a translate and an opacity, not a
       * dissolve. */
      const alts = hardCuts
        ? (ALTERNATIVES[kind] || []).filter((k) => k !== 'dissolve')
        : (ALTERNATIVES[kind] || []);
      const alt = alts.find((k) => k !== previous.kind);
      if (alt) { why = `${why}; ${kind} again would repeat the cut before it`; kind = alt; }
    }
    s.transition = {
      kind, ms: TRANSITION_MS[kind], why,
      ...(kind === 'push' ? { from: pushEdge(s, rects, frame) } : {}),
    };
    previous = s.transition;
  });
  return script;
}

/**
 * The gate. Returns a list of sentences; an empty list is a pass.
 *
 * Two failures, both of them the thing Nader actually saw: the same move three
 * times running, and the wipe itself.
 */
export function transitionFaults(script) {
  const out = [];
  const shots = script.shots || [];
  let run = 0;
  let runKind = null;
  shots.forEach((s, i) => {
    if (s.reveal === 'wipe') out.push(`shot ${s.n}: reveal "wipe" is the top-to-bottom wipe and is banned`);
    if (i === 0) return;
    const k = s.transition ? s.transition.kind : null;
    if (!k) { out.push(`shot ${s.n}: the cut into it carries no transition`); return; }
    if (TRANSITION_MS[k] === undefined) out.push(`shot ${s.n}: "${k}" is not one of ${TRANSITION_KINDS.join(', ')}`);
    if (k === 'cut') { run = 0; runKind = null; return; }
    run = k === runKind ? run + 1 : 1;
    runKind = k;
    if (run >= 3) out.push(`shot ${s.n}: "${k}" three cuts in a row`);
  });
  return out;
}


/* ── type scale (bible §2.3, generalised to the short edge) ─────────────── */

export const TYPE = {
  display: { frac: 0.089, weight: 900, track: -0.02 },
  caption: { frac: 0.054, weight: 800, track: -0.005 },
  chip: { frac: 0.031, weight: 600, track: 0.01 },
  fine: { frac: 0.022, weight: 400, track: 0.02 },
};

export const COLOR = {
  basalt: '#1D2024',
  limestone: '#F1EFE9',
  petraOnDark: '#FF8A6E',   // Petra as ink or hairline ON basalt
  petraGround: '#B5432B',   // Petra as a filled ground carrying limestone type
};

/* ── reading time (bible §2.3) ──────────────────────────────────────────── */

/** dwell_ms = anim_ms + clamp(max(chars/13*1000, words*300), 1200, 7000) */
export function dwellMs(text, animMs = DUR.mod1) {
  const s = String(text).replace(/\n/g, ' ').trim();
  const chars = s.length;
  const words = s.split(/\s+/).filter(Boolean).length;
  return animMs + Math.min(7000, Math.max(1200, Math.max((chars / 13) * 1000, words * 300)));
}

/* ── copy gate (bible §2.9 rule 6) ──────────────────────────────────────── */

export function copyFaults(script) {
  const bad = [];
  const check = (where, text) => {
    if (text == null) return;
    const s = String(text);
    if (/[—–]/.test(s)) bad.push(`${where}: em or en dash in ${JSON.stringify(s)}`);
    if (/[!]/.test(s)) bad.push(`${where}: exclamation mark in ${JSON.stringify(s)}`);
    if (/[؀-ۿ]/.test(s)) bad.push(`${where}: Arabic in the graphic layer, ${JSON.stringify(s)}`);
  };
  for (const c of script.captions || []) check(`caption @${c.inSec}`, c.text);
  for (const s of script.shots || []) {
    check(`shot ${s.n} chip`, s.chip);
    for (const l of s.card || []) check(`shot ${s.n} card`, l);
  }
  for (const l of script.endCard ? Object.values(script.endCard) : []) check('end card', l);
  return bad;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The commercial, derived line by line from bible §3.3.
 *
 * CHECKPOINT NOTE. Checkpoint 1 of §7.1 is `film/script/<id>.script.json`,
 * written by the director. It does not exist yet. This constant is Builder A's
 * transcription of §3.3 so the composition can be built and looked at now; the
 * loader below prefers the director's file the moment it lands, and every
 * consumer prints which of the two it used.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const BIBLE_COMMERCIAL = {
  id: 'qa-wrap',
  kind: 'trailer',
  source: 'builder-a-transcription-of-bible-3.3',
  bpm: 120, fps: 30, bars: 24, seconds: 48.0,

  /* Shots. `clip` names the capture sequence Builder C writes to
   * work/film/capture/<id>/<clip>/f%05d.png. `rect` is the placement. */
  shots: [
    { n: 1, inSec: 0.0, outSec: 2.5, rect: 'STAGE', clip: 'commercial/shot-01' },
    { n: 2, inSec: 2.5, outSec: 4.0, rect: 'STAGE', clip: 'commercial/shot-02' },
    { n: 3, inSec: 4.0, outSec: 6.5, rect: 'STAGE', clip: 'commercial/shot-03' },
    { n: 4, inSec: 6.5, outSec: 8.0, rect: 'STAGE', clip: 'commercial/shot-04' },
    { n: 5, inSec: 8.0, outSec: 10.0, rect: 'PAIR', clip: 'commercial/shot-05' },
    { n: 6, inSec: 10.0, outSec: 12.0, rect: 'PAIR', clip: 'commercial/shot-06' },
    { n: 7, inSec: 12.0, outSec: 13.5, rect: 'PAIR', clip: 'commercial/shot-07', chip: 'Record the screen' },
    { n: 8, inSec: 13.5, outSec: 16.0, rect: 'PAIR', clip: 'commercial/shot-08', chip: 'Record the screen' },
    { n: 9, inSec: 16.0, outSec: 17.5, rect: 'PAIR', clip: 'commercial/shot-09', chip: 'Break a request' },
    { n: 10, inSec: 17.5, outSec: 20.0, rect: 'STAGE', clip: 'commercial/shot-10', chip: 'Break a request' },
    { n: 11, inSec: 20.0, outSec: 24.0, rect: 'PAIR', clip: 'commercial/shot-11', chip: 'Mask real data' },
    { n: 12, inSec: 24.0, outSec: 25.5, rect: 'PAIR', clip: 'commercial/shot-12', chip: 'Check accessibility' },
    { n: 13, inSec: 25.5, outSec: 28.0, rect: 'REPORT', clip: 'commercial/shot-13', chip: 'Check accessibility' },
    { n: 14, inSec: 28.0, outSec: 32.0, rect: 'SHEET', clip: 'commercial/shot-14', chip: 'Draw the flow' },
    { n: 15, inSec: 32.0, outSec: 36.0, rect: 'REPORT', clip: 'commercial/shot-15', chip: 'File it' },
    // wipeIn is off. Bible 2.8 puts a 240 ms shape wipe on this shot, and 8.6
    // requires frame 1080 to show all sixteen tiles countably. A wipe that
    // starts at the cut leaves frame 1080 empty, so the acceptance number wins
    // and the wall arrives on a hard cut, like the other seventeen. Set
    // wipeIn: true to put the wipe back; the mechanism is still here.
    { n: 16, inSec: 36.0, outSec: 38.0, rect: 'WALL', clip: 'commercial/shot-16', wipeIn: false },
    {
      n: 17, inSec: 38.0, outSec: 42.0, rect: null,
      card: ['Eight browsers.', 'No account. No upload.', 'Nothing leaves this machine.'],
    },
    { n: 18, inSec: 42.0, outSec: 48.0, rect: null, endCard: true },
  ],

  /* Captions live on the film, not on a shot: a caption drawn in the
   * composition cannot be torn down by anything the product does (§2.7), and
   * §8.5 requires no dropout across a cut. `inSec` is a wish; the dwell solver
   * below may push it later so every card meets §2.3's reading time. */
  captions: [
    { inSec: 0.30, text: 'It failed.' },
    { inSec: 4.15, text: 'Cannot reproduce.', outSec: 7.40 },   // out on the drop
    { inSec: 8.15, text: 'Record the whole session.' },
    { inSec: 12.15, text: 'Screen recording. No time limit.' },
    { inSec: 16.15, text: 'Make it fail on purpose.' },
    { inSec: 17.65, text: 'The click that caused it.' },
    { inSec: 20.15, text: 'Real names, covered for good.' },
    { inSec: 24.15, text: 'Let the machine look.' },
    { inSec: 28.15, text: 'The flow, on one page.' },
    { inSec: 32.15, text: 'Seven kinds of ticket.' },
    { inSec: 36.15, text: 'Sixteen tools.' },
    { inSec: 38.15, text: 'No account. No upload.', outSec: 42.0 },
    // Shot 18's caption, "Every failure, traced.", is set by the end card
    // itself. Two copies of one line in one frame is not a caption, it is a
    // duplicate.
  ],

  graphics: [
    // Ruling 1: one Petra element per shot, and the chip wins where a shot has
    // one, because the chip carries the <feature> tag. So shot 10 loses its
    // Petra ring and shot 13 loses its Petra rule. Shot 1 keeps its ring: it
    // has no chip, and it is the film's failure.
    { kind: 'ring', atSec: 1.10, accent: 'petra', shot: 1, at: [953, 765] },
    // Limestone at 40 %, not Petra: these clicks cover a value, they do not
    // cause a failure (bible 2.5 rule 3). Positions are stand-in placements
    // read off the stand-in frames; marks.json replaces them.
    { kind: 'ring', atSec: 20.66, accent: 'quiet', shot: 11, at: [1200, 428] },
    { kind: 'ring', atSec: 22.20, accent: 'quiet', shot: 11, at: [1200, 517] },
    // Shot 5 has no chip, so it may carry the one Petra rule. It sits under the
    // panel, which is now the left half of a PAIR at x 96.
    { kind: 'rule', shot: 5, inSec: 8.30, outSec: 10.0, x: 96, y: 884, w: 420 },
  ],

  endCard: {
    wordmark: 'QA Wrap',
    tagline: 'Every failure, traced.',
    // The bible gives shot 18 no ask line: 2.9 rule 10 bans a spoken call to
    // action and says "the ask is the end card", then lists only the tagline,
    // the URL and the publisher. The card therefore has to carry the ask as
    // type, set apart from the by-line, with the URL as the action under it.
    ask: 'Free. No account. Nothing leaves your machine.',
    url: '', publisher: '', // the owner's site and "Made by" line come from brand/brand.json through frames.mjs (this module also runs in the browser)
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Checkpoint 2, read as delivered.
 *
 * `film/storyboard/<id>.storyboard.json` is the contract. It carries the shot
 * table, the caption spans, the placement of every capture per pass, and the
 * graphics; `work/film/capture/<id>/marks.json` carries where a press really
 * happened. Everything below reads those two and produces the script shape the
 * timeline already understands, so nothing in the renderer had to learn a new
 * vocabulary and the built-in transcription stops being used the moment a real
 * storyboard exists.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The end card's beats, in absolute seconds, as its own shot declares them. */
function endCardTimes(graphics) {
  const at = (kind, i = 0) => {
    const list = graphics.filter((g) => g.kind === kind);
    return list[i] ? (list[i].atSec ?? list[i].fromSec) : null;
  };
  const mask = graphics.find((g) => g.kind === 'maskReveal') || {};
  const wake = graphics.find((g) => g.kind === 'markWake') || {};
  const fine = at('fine');
  const tag = at('tagline');
  /* Pre-roll. The mask reveal and the mark's wake used to start ON the cut, so
   * frame 1320 carried no pixel above luma 30: the film cut to nothing for
   * sixteen frames. They now start before the cut, so the first visible frame
   * of the end card already carries the mark and the wordmark well above half.
   * Nothing is seen before the cut; the shot simply opens part-way through its
   * own reveal, which is what a cut into a moving card should look like. */
  const cut = graphics.__inSec != null ? graphics.__inSec : (mask.atSec ?? 0);
  const PRE_MASK = 0.40, PRE_WORD = 0.25;

  /* The card's tagline IS the close's caption: the band is empty here by
   * design, because the type on the card carries the words. So the tagline has
   * to be on screen when the voice says it, not two seconds after. It is
   * anchored to the shot's own spoken line and the rest of the stagger travels
   * with it, which is why the wordmark pre-rolls past the cut: it has already
   * arrived by the time the tagline lands. */
  const LAND = 0.168;   // a 400 ms expressive reveal reaches half at 0.168 s
  /* The anchor has to be inside the shot it anchors to.
   *
   * `__voSec` is an ABSOLUTE second carried on the storyboard shot, so any
   * retime of the film leaves it pointing at a moment that no longer exists.
   * On 17 September the commercial was shortened by 6 s and shot 13's anchor
   * stayed at 51.75 in a 50 s storyboard: `anchored` landed past the end of
   * the film and the tagline, the ask, the URL and the publisher line were
   * simply never drawn — the card came out as a mark and a wordmark on bare
   * ground, and nothing said so. An anchor outside its own shot is now
   * refused, and the card falls back to the storyboard's own tagline beat,
   * which a retime does move. research/78 §8. */
  const raw = graphics.__voSec;
  const from = graphics.__inSec, to = graphics.__outSec;
  const usable = raw != null && (from == null || raw >= from - 1.0) && (to == null || raw <= to);
  if (raw != null && !usable) {
    console.log(`          card  vo anchor ${raw} s is outside shot ${from}-${to} s, `
      + 'using the storyboard tagline beat instead');
  }
  const spoken = usable ? raw : null;
  const anchored = spoken != null ? spoken - LAND : null;
  return {
    maskAt: (mask.atSec ?? cut) - PRE_MASK, maskMs: mask.ms ?? 520,
    ringAt: (wake.atSec ?? mask.atSec ?? cut) - PRE_MASK - 0.52, ringMs: wake.ringMs ?? 520,
    checkMs: wake.checkMs ?? 260, overshoot: wake.overshoot ?? 0.04,
    wordmarkAt: anchored != null
      ? Math.min(anchored - 0.45, cut - PRE_WORD)
      : (at('wordmark') != null ? Math.min(at('wordmark'), cut - PRE_WORD) : cut - PRE_WORD),
    taglineAt: anchored != null ? anchored : tag,
    // The ask is not in the storyboard's graphics: bible 2.9 rule 10 bans a
    // spoken call to action and leaves the card to carry it, and the
    // coordinator ruled the line in. It takes the 240 ms slot between the
    // tagline and the fine block so that nothing moves twice at once and the
    // card still settles on the storyboard's own `hold`.
    askAt: anchored != null ? anchored + 0.45 : (tag != null ? tag + 0.4 : null), askMs: DUR.mod2,
    fineAt: anchored != null ? anchored + 0.70 : fine,
    holdAt: at('hold'),
  };
}

/**
 * @param {object} sb        the storyboard JSON
 * @param {object} o
 * @param {string} o.pass    'h' | 's' | 'v'
 * @param {object} o.marks   marks.json, or null
 * @param {string} o.clipBase prefix to turn a storyboard clip path into a URL
 * @param {object} o.endCard copy for the end card, which the storyboard's
 *                           graphics carry only partly
 */
export function scriptFromStoryboard(sb, { pass = 'h', marks = null, clipBase = '', endCard = {} } = {}) {
  const notes = [];
  const spans = sb.captions || [];
  const push = (m) => { if (m) notes.push(m); };

  /* A span whose out point is the next span's in point cross-fades into it, so
   * it must NOT get an explicit outSec: an explicit one means "gone by then"
   * and fades before the change, which is the dropout gap 10 measured. */
  /* A span whose out point is the next span's in point cross-fades into it, so
   * it must NOT get an explicit outSec: an explicit one means "gone by then"
   * and fades before the change, which is the dropout gap 10 measured.
   *
   * A short GAP between two spans is closed the same way: the card holds until
   * the next one is up. The commercial's reveal line had a 0.80 s hole at
   * 7.348 because the bible fades the hook's card out for the drop and the next
   * card does not arrive until 8.15. The silence at the drop is a sound
   * decision; the caption band going bare is not, and a viewer reads it as the
   * film losing its place. Anything longer than GAP_HOLD is a deliberate rest
   * and is left alone. */
  const GAP_HOLD = 2.0;
  const captions = spans.map((c, i) => {
    const next = spans[i + 1];
    const gap = next ? next.inSec - c.outSec : Infinity;
    const bridge = next && gap >= -1e-6 && gap <= GAP_HOLD;
    if (bridge) push(gap > 1e-6
      ? `caption ${JSON.stringify(c.text)} holds ${gap.toFixed(2)} s longer, to ${next.inSec} s, so the band never goes bare`
      : null);
    const base = { inSec: c.inSec, text: c.text, srt: c.srt || c.text };
    return bridge ? base : { ...base, outSec: c.outSec };
  });

  const shots = sb.shots.map((s) => {
    const cap = s.capture;
    const p = cap && cap.passes ? cap.passes[pass] : null;
    const place = [];
    const clips = [];
    if (p && p.parts) {
      for (const part of p.parts) {
        place.push({ x: part.place.x, y: part.place.y, w: part.viewport.w, h: part.viewport.h, role: part.role });
        clips.push(clipBase + part.clip);
      }
    } else if (p) {
      place.push({ x: p.place.x, y: p.place.y, w: p.viewport.w, h: p.viewport.h, role: 'single' });
      clips.push(clipBase + p.clip);
    }
    const g = s.graphics || [];
    return {
      n: s.n, inSec: s.inSec, outSec: s.outSec, inFrame: s.inFrame, frames: s.frames,
      // A still shot is recorded once and held for its whole duration, so its
      // clip is one file rather than `frames` of them.
      still: !!(cap && cap.still),
      // A shot that declares it holds on purpose is exempt from the frozen
      // check: the commercial's drop is a held picture under a silence, and
      // that is the point of it, not a fault.
      hold: !!s.hold,
      /* A held still is a frozen shot, and the critic counted four in the
       * commercial and twelve in the tool films. Where the product's own output
       * is static, the motion belongs to the graphic layer: the capture is
       * revealed top to bottom over about a second on its first frames. The
       * capture is never scaled and never moved; only the mask that shows it
       * travels. `reveal: "wipe"` is the storyboard's flag and it is the
       * default for any `still: true` shot. `revealHold` stops the wipe at a
       * declared height and finishes it later, which is how a shot takes the
       * eye to one region of its own picture last. */
      /* A storyboard may still say `reveal`, and it is carried through, but it
       * no longer DEFAULTS to anything: a held still says `still: true` and
       * `assignTransitions()` decides what the cut into it looks like. The old
       * default here — `still` means `reveal: 'wipe'` — is how the
       * top-to-bottom wipe came to be on every cut in the set, and
       * `transitionFaults()` now fails the word itself. */
      reveal: cap && cap.reveal !== undefined ? cap.reveal : null,
      voStartSec: s.vo && s.vo.startSec != null ? s.vo.startSec : null,
      revealMs: Math.min(1500, Math.max(800, (cap && cap.revealMs) || 1000)),
      revealHold: (cap && cap.revealHold) || null,
      rect: cap ? cap.rect : null,
      member: cap ? cap.member : null,
      place, clips,
      chip: s.chip || null,
      /* Does a press happen in this shot? The cut OUT of it is then a cause and
       * its effect, and the transition chooser cuts hard on the beat rather
       * than putting a move between two halves of one event. */
      hasRing: g.some((x) => x.kind === 'clickRing'),
      /* Does this shot OPEN on its result? The `success` cue is placed where
       * the product finishes, and a shot carrying it in its first half second
       * is the answer to the press in the shot before. */
      isResult: (s.sfx || []).some((c) => c.cue === 'success' && c.atSec - s.inSec <= 0.5),
      /* A transition the storyboard declares itself is never overwritten. */
      transition: s.transition ? { ...s.transition, authored: true } : null,
      wipeIn: g.some((x) => x.kind === 'shapeWipe'),
      endCard: g.some((x) => x.kind === 'markWake')
        ? endCardTimes(Object.assign(g.slice(),
            { __inSec: s.inSec, __outSec: s.outSec, __voSec: s.vo && s.vo.startSec }))
        : null,
    };
  });

  /* Graphics, with every coordinate resolved against the placement the
   * storyboard gave the shot. Nothing here guesses a position. */
  const graphics = [];
  for (const s of sb.shots) {
    const shot = shots.find((x) => x.n === s.n);
    const boxes = shot.place;
    const pick = () => {
      if (boxes.length < 2) return boxes[0];
      const want = (s.capture && s.capture.member) || 'STAGE';
      const i = (s.capture.passes[pass].parts || []).findIndex((x) => x.rect === want);
      return boxes[i < 0 ? boxes.length - 1 : i];
    };
    for (const g of s.graphics || []) {
      if (g.kind === 'clickRing') {
        const box = pick();
        const rec = marks && marks.byPass && marks.byPass[pass] ? marks.byPass[pass][String(s.n)] : null;
        const clicks = (rec && rec.clicks) || [];
        const hit = clicks.find((c) => c.target === g.target) || clicks[0] || null;
        // fromMark means the ring lands on the frame the press really happened
        // on, not on the frame it was written for.
        const atSec = (g.fromMark && hit) ? (s.inFrame + hit.frame) / sb.fps : g.atSec;
        if (!box) { notes.push(`shot ${s.n}: clickRing with no capture placement, skipped`); continue; }
        if (!hit) notes.push(`shot ${s.n}: clickRing has no mark for ${g.target}, using the storyboard's own time and the box centre`);
        graphics.push({
          kind: 'ring', shot: s.n, atSec, ms: g.ms || 620,
          accent: g.accent === 'petra' ? 'petra' : 'quiet',
          at: hit ? [box.x + hit.x, box.y + hit.y] : [box.x + box.w / 2, box.y + box.h / 2],
        });
      } else if (g.kind === 'accentRule') {
        const box = pick();
        if (!box) { notes.push(`shot ${s.n}: accentRule with no capture placement, skipped`); continue; }
        graphics.push({
          kind: 'rule', shot: s.n,
          inSec: g.atSec, outSec: g.exitSec ?? s.outSec,
          x: box.x, y: box.y + box.h + 24, w: Math.min(box.w, 420),
        });
      } else if (g.kind === 'counter') {
        // Ruled out of the graphic layer: the live row inside the capture
        // already shows the events climbing, and a second count on the ground
        // would either duplicate it or invent a number.
      }
    }
  }

  return {
    id: sb.id, kind: sb.kind, source: `storyboard rev ${sb.revision}, pass ${pass}`,
    /* A storyboard that names a `captionSource` is a verbatim film: its cards
     * are chunks of the read, so its subtitles are that same list and must be
     * regenerated when the count on disk disagrees. Without this the encoder
     * takes the "count mismatch means a real disagreement" branch and leaves
     * the older one-cue-per-span file alone — which is how the shipped 3.1.0
     * commercial came to carry a sidecar whose words are not the words in the
     * picture (research/78 §1.2). */
    verbatim: !!sb.captionSource,
    bpm: sb.bpm, fps: sb.fps, bars: sb.bars, seconds: sb.seconds,
    shots, captions, graphics, endCard, notes, checks: sb.checks || null,
  };
}


/* ═══════════════════════════════════════════════════════════════════════════
 * The commercial, rev 3 (bible §3, 56.000 s, 28 bars, 13 shots).
 *
 * Builder A's transcription, used only until Builder C's rev 3 storyboard
 * lands. The captions are NOT written here: they are generated from the read.
 * `STANDIN_VO` below is a voice file in the shape `voice.mjs` writes, built
 * from the bible's own §3.4 target times, so the chunk generator is exercised
 * end to end rather than fed a hand-made list.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const STANDIN_VO = {
  id: 'qa-wrap', seconds: 56,
  lines: [
    { n: 1, shot: 1, phrases: [
        { text: "It failed once.", startSec: 0.600, endSec: 1.750 },
        { text: "Nobody saw it", startSec: 1.750, endSec: 2.900 },
        { text: "but her.", startSec: 2.900, endSec: 4.380 },
    ] },
    { n: 2, shot: 2, phrases: [
        { text: "She tries again.", startSec: 4.750, endSec: 5.900 },
        { text: "It works,", startSec: 5.900, endSec: 6.720 },
        { text: "every time after that.", startSec: 6.720, endSec: 8.200 },
    ] },
    { n: 3, shot: 3, phrases: [
        { text: "Nothing to file.", startSec: 9.750, endSec: 10.900 },
        { text: "Her word", startSec: 10.900, endSec: 11.720 },
        { text: "against the developer's.", startSec: 11.720, endSec: 12.870 },
        { text: "The release waits.", startSec: 12.870, endSec: 14.350 },
    ] },
    { n: 4, shot: 4, phrases: [
        { text: "QA Wrap records", startSec: 14.750, endSec: 15.900 },
        { text: "the whole session,", startSec: 15.900, endSec: 17.050 },
        { text: "in the browser", startSec: 17.050, endSec: 18.200 },
        { text: "she already tests in.", startSec: 18.200, endSec: 19.680 },
    ] },
    { n: 5, shot: 5, phrases: [
        { text: "Break a request", startSec: 19.750, endSec: 20.900 },
        { text: "on purpose.", startSec: 20.900, endSec: 21.720 },
        { text: "Keep working.", startSec: 21.720, endSec: 23.200 },
    ] },
    { n: 6, shot: 6, phrases: [
        { text: "The report names", startSec: 23.750, endSec: 24.900 },
        { text: "the click", startSec: 24.900, endSec: 25.720 },
        { text: "that caused it.", startSec: 25.720, endSec: 27.200 },
    ] },
    { n: 7, shot: 7, phrases: [
        { text: "Seven kinds of ticket,", startSec: 27.750, endSec: 29.230 },
        { text: "written from the recording.", startSec: 29.230, endSec: 30.710 },
    ] },
    { n: 8, shot: 8, phrases: [
        { text: "One press files it,", startSec: 31.750, endSec: 33.230 },
        { text: "with the screenshots", startSec: 33.230, endSec: 34.380 },
        { text: "and the video.", startSec: 34.380, endSec: 35.750 },
    ] },
    { n: 9, shot: 9, phrases: [
        { text: "Click a real name.", startSec: 35.750, endSec: 37.230 },
        { text: "It is covered", startSec: 37.230, endSec: 38.380 },
        { text: "for the whole session.", startSec: 38.380, endSec: 39.750 },
    ] },
    { n: 10, shot: 10, phrases: [
        { text: "It survives the reload.", startSec: 39.750, endSec: 41.230 },
        { text: "The words underneath", startSec: 41.230, endSec: 42.380 },
        { text: "never reach the report.", startSec: 42.380, endSec: 43.750 },
    ] },
    { n: 11, shot: 11, phrases: [
        { text: "The session,", startSec: 43.750, endSec: 44.570 },
        { text: "drawn as a flow,", startSec: 44.570, endSec: 46.050 },
        { text: "on one page.", startSec: 46.050, endSec: 47.530 },
    ] },
    { n: 12, shot: 12, phrases: [
        { text: "Sixteen tools.", startSec: 47.750, endSec: 48.570 },
        { text: "No account, no upload,", startSec: 48.570, endSec: 50.050 },
        { text: "nothing leaves this machine.", startSec: 50.050, endSec: 51.530 },
    ] },
    { n: 13, shot: 13, phrases: [
        { text: "QA Wrap.", startSec: 51.750, endSec: 52.570 },
        { text: "Every failure, traced.", startSec: 52.570, endSec: 54.000 },
    ] },
  ],
};

export const BIBLE_COMMERCIAL_R3 = {
  id: 'qa-wrap', kind: 'trailer', source: 'builder-a transcription of bible 3 rev 3',
  bpm: 120, fps: 30, bars: 28, seconds: 56.0, verbatim: true,
  captionsLastOutSec: 54.0,
  shots: [
    { n: 1, inSec: 0.0, outSec: 5.0, inFrame: 0, frames: 150, rect: 'STAGE', clip: 'commercial-r3/shot-01' },
    { n: 2, inSec: 5.0, outSec: 10.0, inFrame: 150, frames: 150, rect: 'STAGE', clip: 'commercial-r3/shot-02' },
    { n: 3, inSec: 10.0, outSec: 15.0, inFrame: 300, frames: 150, rect: 'REPORT', clip: 'commercial-r3/shot-03' },
    { n: 4, inSec: 15.0, outSec: 20.0, inFrame: 450, frames: 150, rect: 'PANEL', clip: 'commercial-r3/shot-04' },
    { n: 5, inSec: 20.0, outSec: 24.0, inFrame: 600, frames: 120, rect: 'PAIR', clip: 'commercial-r3/shot-05' },
    { n: 6, inSec: 24.0, outSec: 28.0, inFrame: 720, frames: 120, rect: 'REPORT', clip: 'commercial-r3/shot-06' },
    { n: 7, inSec: 28.0, outSec: 32.0, inFrame: 840, frames: 120, rect: 'REPORT', clip: 'commercial-r3/shot-07' },
    { n: 8, inSec: 32.0, outSec: 36.0, inFrame: 960, frames: 120, rect: 'REPORT', clip: 'commercial-r3/shot-08' },
    { n: 9, inSec: 36.0, outSec: 40.0, inFrame: 1080, frames: 120, rect: 'PAIR', clip: 'commercial-r3/shot-09' },
    { n: 10, inSec: 40.0, outSec: 44.0, inFrame: 1200, frames: 120, rect: 'STAGE', clip: 'commercial-r3/shot-10' },
    { n: 11, inSec: 44.0, outSec: 48.0, inFrame: 1320, frames: 120, rect: 'SHEET', clip: 'commercial-r3/shot-11' },
    { n: 12, inSec: 48.0, outSec: 52.0, inFrame: 1440, frames: 120, rect: 'WALL', clip: 'commercial-r3/shot-12' },
    { n: 13, inSec: 52.0, outSec: 56.0, inFrame: 1560, frames: 120, rect: null, endCard: {
      maskAt: 51.6, maskMs: 520, ringAt: 51.08, ringMs: 520, checkMs: 260, overshoot: 0.04,
      wordmarkAt: 51.30, taglineAt: 51.582, askAt: 52.032, fineAt: 52.282, holdAt: 54.5 } },
  ],
  captions: [],
  graphics: [],
  endCard: {
    wordmark: 'QA Wrap',
    tagline: 'Every failure, traced.',
    ask: 'Free. No account. Nothing leaves your machine.',
    url: '', publisher: '', // the owner's site and "Made by" line come from brand/brand.json through frames.mjs (this module also runs in the browser)
  },
};

/* ── captions from the voice (bible §3.4) ───────────────────────────────── */
/**
 * One caption per LINE, at the times the read actually has.
 *
 * Rev 3 split the read into 39 chunks so no card outlived its words. It also
 * meant the band changed every 1.4 s, and a chunk could still straddle a cut.
 * The simpler rule is the one the voice already answers: a line enters when it
 * starts and leaves when it ends. Nothing is inferred, nothing is proportional,
 * and the band is empty between lines, which is what a pause looks like.
 *
 * A line over six words is set two lines deep at 48/800 rather than crushed
 * onto one; the band was built for two lines and this is what they are for.
 */
/** How close to the last frame a card may leave before it is held to it. */
const TAIL_HOLD = 0.5;

export function captionsFromLines(vo, { fps = 30, offsetSec = 0, maxWords = 6, lastSec = null } = {}) {
  const q = (t) => Math.round((t + offsetSec) * fps) / fps;
  const faults = [];
  const cards = (vo.lines || []).map((l) => {
    const text = String(l.text).trim();
    const words = text.split(/\s+/).filter(Boolean);
    /* A caption cannot outlive the film. When the read runs past the last
     * frame the card is clamped to it and the overrun is reported, because a
     * cue that ends after the picture does is a subtitle nobody can see and a
     * player is free to do anything with it. */
    let outSec = q(l.endSec);
    if (lastSec != null && outSec > lastSec) {
      faults.push(`line ${l.n} is read to ${outSec.toFixed(3)} s, past the film's ${lastSec.toFixed(3)} s; the card is clamped`);
      outSec = lastSec;
    }
    return {
      inSec: q(l.startSec), outSec, text, srt: text,
      shot: l.shot, hardOut: true, two: words.length > maxWords,
    };
  });
  for (let i = 1; i < cards.length; i++) {
    if (cards[i].inSec < cards[i - 1].outSec - 1e-9) {
      faults.push(`line ${i + 1} starts ${cards[i].inSec.toFixed(3)} s, before line ${i} ends ${cards[i - 1].outSec.toFixed(3)} s`);
    }
  }
  /* The last card holds to the last frame when it would otherwise leave inside
   * the final half second. These films loop, and a band that empties two tenths
   * before the loop point reads as a flicker at the join, not as a close.
   * Measured on tool-try-nasty-values: the read ends 13.847 against a 14.000 s
   * film and one frame moved 1.48 code values where every other tail frame
   * moved 0.00001. It is the same rule as the gap hold, applied to the seam. */
  const last = cards[cards.length - 1];
  if (last && lastSec != null && last.outSec < lastSec && lastSec - last.outSec <= TAIL_HOLD) {
    faults.push(`the last card leaves ${(lastSec - last.outSec).toFixed(3)} s before the film ends; it is held to ${lastSec.toFixed(3)} s so the loop does not flicker`);
    last.outSec = lastSec;
  }
  return { cards, faults, count: cards.length };
}



/**
 * The caption chunks and the voice-over phrases are the same list.
 *
 * Rev 2 wrote the cards separately from the read, "the claim in fewer words",
 * and the two drifted until the band was talking about something the voice was
 * not saying. Rev 3 deletes the second copy: a card is a chunk of the read,
 * verbatim. It enters when its first word is spoken and leaves when the next
 * chunk starts. Generated from `work/film/audio/out/<id>-vo.json`, never by hand, so
 * there is nothing left to drift.
 *
 * The file carries per-phrase times at minimum. Where a phrase also carries
 * per-word times they are used to split it; where it does not, a phrase that is
 * too long is split proportionally by word count, which is the best a
 * phrase-timed file supports and is stated rather than hidden.
 */
export function chunksFromVo(vo, { shots = [], fps = 30, lastOutSec = null, maxWords = 6, maxSec = 1.5 } = {}) {
  const faults = [];
  const raw = [];

  /* If the voice file already carries the chunk list, that is the list. Builder
   * B solves it against the real word times when the read is rendered, so
   * re-deriving it here would be a second opinion about the same file, and a
   * second opinion is exactly the drift rev 3 exists to delete. */
  if (Array.isArray(vo.captionChunks) && vo.captionChunks.length) {
    for (const c of vo.captionChunks) {
      raw.push({ text: String(c.text).trim(), startSec: c.inSec, endSec: c.lastWordEnd != null ? c.lastWordEnd : c.outSec, shot: c.shot, given: c.outSec });
    }
  } else for (const line of vo.lines || []) {
    const phrases = line.phrases && line.phrases.length
      ? line.phrases
      : [{ text: line.text, startSec: line.startSec, endSec: line.endSec }];
    for (const ph of phrases) {
      const words = String(ph.text).trim().split(/\s+/).filter(Boolean);
      const span = ph.endSec - ph.startSec;
      if (words.length <= maxWords && span <= maxSec + 1e-6) {
        raw.push({ text: ph.text.trim(), startSec: ph.startSec, endSec: ph.endSec, shot: line.shot });
        continue;
      }
      // Too long: split it. Word times if the file has them, proportional if not.
      const parts = Math.ceil(Math.max(words.length / maxWords, span / maxSec));
      const per = Math.ceil(words.length / parts);
      let at = 0;
      for (let i = 0; i < parts && at < words.length; i++) {
        const slice = words.slice(at, at + per);
        const w0 = ph.words && ph.words[at];
        const w1 = ph.words && ph.words[Math.min(at + slice.length, words.length) - 1];
        const from = w0 ? w0.startSec : ph.startSec + span * (at / words.length);
        const to = w1 ? w1.endSec : ph.startSec + span * ((at + slice.length) / words.length);
        raw.push({ text: slice.join(' '), startSec: from, endSec: to, shot: line.shot, split: !ph.words });
        at += slice.length;
      }
    }
  }
  raw.sort((a, b) => a.startSec - b.startSec);

  const q = (t) => Math.round(t * fps) / fps;
  const cuts = shots.map((sh) => sh.inSec).filter((t) => t > 0);
  const cards = raw.map((c, i) => {
    const next = raw[i + 1];
    // It leaves when the next chunk starts; the last one leaves where the file
    // says, or where the script says the band stops.
    const out = next ? next.startSec
      : (c.given != null ? c.given : (lastOutSec != null ? lastOutSec : c.endSec));
    /* Contiguous chunks cross-fade into each other, exactly as cards do: a
     * hard out would blink the band off for the 110 ms of its exit while the
     * next chunk is still ramping in, and at 39 chunks that is most of the
     * film. Only a chunk with a real gap after it, and the last one, fades. */
    const gap = next ? next.startSec - out : Infinity;
    return {
      inSec: q(c.startSec), outSec: q(out), text: c.text, srt: c.text, shot: c.shot,
      hardOut: !next || gap > 1e-6,
    };
  });

  for (const c of cards) {
    const words = c.text.split(/\s+/).filter(Boolean).length;
    if (words > maxWords) faults.push(`chunk ${JSON.stringify(c.text)} is ${words} words, over ${maxWords}`);
  }
  for (const c of raw) {
    const span = c.endSec - c.startSec;
    if (span > maxSec + 1e-6) faults.push(`chunk ${JSON.stringify(c.text)} is spoken over ${span.toFixed(2)} s, over ${maxSec}`);
  }
  // A chunk that spans a cut by more than the J-cut allowance is a fault: the
  // bible's own table lets a line start up to 400 ms before its picture.
  const JCUT = 0.4;
  for (const c of cards) {
    for (const t of cuts) {
      if (c.inSec < t - JCUT && c.outSec > t + 1e-6) {
        faults.push(`chunk ${JSON.stringify(c.text)} spans the cut at ${t} s`);
        break;
      }
    }
  }
  return { cards, faults, count: cards.length };
}

/* ── the dwell solver ───────────────────────────────────────────────────── */

/**
 * Give every caption at least its §2.3 reading time by pushing the NEXT card's
 * in-point later, never by shortening a card and never by rewriting copy.
 * Copy is the director's; timing is the composition's. Anything that still
 * cannot be satisfied is returned as a fault for the render report.
 */
export function solveCaptions(script) {
  const fps = script.fps;
  /* Verbatim captions are the read. The 1.2 s minimum dwell is suspended for
   * them (bible 3.4): a word must not leave the screen while it is still being
   * said, and the read decides when that is. */
  if (script.verbatim) {
    return { cards: script.captions.map((c) => ({ ...c, hardOut: c.hardOut !== false })), faults: [], pushes: [] };
  }
  const q = (s) => Math.round(s * fps) / fps;
  const cards = script.captions.map((c) => ({ ...c, inSec: q(c.inSec) }));
  const faults = [];
  const pushes = [];
  const end = script.seconds;

  for (let i = 0; i < cards.length; i++) {
    const need = dwellMs(cards[i].text) / 1000;
    // An explicit outSec means "gone by then" (the drop, a cut to a type card),
    // so that card fades out BEFORE its out point. Anything else is a card
    // change, and a card change cross-fades: the outgoing card fades away over
    // the incoming card's first 110 ms, so the band is never empty. That empty
    // band is exactly the dropout gap 10 measured in the old commercial.
    cards[i].hardOut = cards[i].outSec != null;
    const hardOut = cards[i].outSec != null ? q(cards[i].outSec) : (i + 1 < cards.length ? cards[i + 1].inSec : end);
    const have = hardOut - cards[i].inSec;
    if (have + 1e-9 >= need) { cards[i].outSec = hardOut; continue; }
    if (cards[i].outSec != null || i + 1 >= cards.length) {
      // Ruling 4: refuse, never shorten. This becomes a non-zero exit.
      faults.push(`caption ${JSON.stringify(cards[i].text)} holds ${have.toFixed(2)} s and needs ${need.toFixed(2)} s, and its out point is fixed, so it cannot be given the time`);
      cards[i].outSec = hardOut;
      continue;
    }
    // Push the next card later, in whole frames, and record the push.
    const pushedTo = q(cards[i].inSec + need);
    pushes.push(`${JSON.stringify(cards[i].text)} needed ${need.toFixed(2)} s and had ${have.toFixed(2)} s: `
      + `the next card moves from ${cards[i + 1].inSec.toFixed(3)} s to ${pushedTo.toFixed(3)} s`);
    cards[i + 1].inSec = pushedTo;
    cards[i].outSec = pushedTo;
  }
  for (const c of cards) { if (c.outSec == null) { c.outSec = end; c.hardOut = true; } }
  return { cards, faults, pushes };
}

/* ── the timeline ───────────────────────────────────────────────────────── */

/**
 * @param {object} o
 * @param {object} o.script     the script JSON (director's, or BIBLE_COMMERCIAL)
 * @param {object} o.storyboard optional: { clips: { '<clip>': {frames, dir, dsf, w, h} } }
 * @param {string} o.aspect     '16x9' | '1x1' | '9x16'
 * @param {boolean} o.reduced   the reduced-motion cut (§5.3, R1 rule 42)
 * @param {boolean} o.standin   stand-in captures: draws the slug, never delivers
 */
export function buildTimeline({ script, storyboard = null, aspect = '16x9', reduced = false, standin = false }) {
  const fps = script.fps;
  const canvas = CANVASES[aspect];
  const zones = ZONES[aspect];
  const rects = RECTS[aspect];
  const frames = Math.round(script.seconds * fps);
  /* Every cut carries its own transition, chosen here so that the render and
   * the check of the render cannot disagree about what a cut looks like.
   *
   * All twenty-two films, the commercial included. The ruling was about the
   * twenty-one lesson films, but the wipe it removed lived in this renderer and
   * not in any one film: the commercial's own still-ish shots were taking it
   * too, by measurement rather than by declaration (35-render 6.10). A film
   * cannot keep a mechanism that no longer exists, so the choice was between
   * giving the commercial the vocabulary and giving it nothing, and nothing
   * means its held shots go back to being photographs. */
  assignTransitions(script, { rects, canvas, hardCuts: !!script.hardCuts });
  const { cards, faults, pushes } = solveCaptions(script);
  const S = Math.min(canvas.w, canvas.h);

  const shotAt = (t) => {
    for (const s of script.shots) if (t >= s.inSec && t < s.outSec) return s;
    return script.shots[script.shots.length - 1];
  };

  /* Chip runs: consecutive shots sharing a chip value are ONE run, so the chip
   * holds across the cut instead of re-entering (§2.4 rule 2). */
  const chipRuns = [];
  for (const s of script.shots) {
    const v = s.chip || null;
    const last = chipRuns[chipRuns.length - 1];
    if (last && last.text === v) last.outSec = s.outSec;
    else chipRuns.push({ text: v, inSec: s.inSec, outSec: s.outSec });
  }

  /** Which clip frame a film frame shows. A capture never scales and never
   *  loops backwards; if the clip is shorter than the shot it holds its last
   *  frame, which is what a `hold` step means (§5.2). */
  function clipFrame(clip, tInShot) {
    const meta = storyboard && storyboard.clips ? storyboard.clips[clip] : null;
    const n = meta ? meta.frames : 1;
    return Math.min(n - 1, Math.max(0, Math.round(tInShot * fps)));
  }

  /* A vector artefact the product exports (the A4 workflow sheet, the marks) is
   * rendered at frame size from the SVG, which is not scaling a capture
   * (bible 2.2, permitted exception). It is fitted to its box and centred. */
  function fitBox(b, meta) {
    if (!b.fit) return { ...b };
    const ar = (meta && meta.aspectRatio) || 1123 / 794;   // A4 landscape
    if (b.fit === 'height') {
      const w = Math.round(b.h * ar);
      return { ...b, w, x: b.x + Math.round((b.w - w) / 2) };
    }
    const h = Math.round(b.w / ar);
    return { ...b, h, y: b.y + Math.round((b.h - h) / 2) };
  }

  function placements(shot, t) {
    if (!shot.rect) return [];
    const boxes = rects[shot.rect];
    /* The delivered storyboard places every capture itself, per pass, and names
     * the clip directory. When it has, that is the placement: the renderer does
     * not second-guess the file the recording was made against. */
    if (shot.place && shot.place.length) {
      const total = shot.clipFrames != null ? shot.clipFrames : (shot.frames || 1);
      const base = shot.inFrame != null ? shot.inFrame : Math.round(shot.inSec * fps);
      const k = Math.min(total - 1, Math.max(0, Math.round(t * fps) - base));
      const name = `f${String(k).padStart(5, '0')}.png`;
      return shot.place.map((b, i) => ({
        x: b.x, y: b.y, w: b.w, h: b.h, fit: null,
        src: shot.clips && shot.clips[i] ? `${shot.clips[i]}/${name}` : null,
      }));
    }

    const meta = storyboard && storyboard.clips ? storyboard.clips[shot.clip] : null;
    const dir = meta ? meta.dir : null;
    const ext = (meta && meta.ext) || 'png';
    const f = clipFrame(shot.clip, t - shot.inSec);
    const name = `f${String(f).padStart(5, '0')}.${ext}`;
    if (shot.rect === 'PAIR') {
      const parts = PAIR_SOURCES[aspect];
      return boxes.map((b, i) => ({ ...b, src: dir ? `${dir}/${parts[i]}/${name}` : null }));
    }
    return boxes.map((b) => ({ ...fitBox(b, meta), src: dir ? `${dir}/${name}` : null }));
  }

  function stateAt(frame) {
    const t = frame / fps;
    const shot = shotAt(t);
    const st = {
      frame, t, shot: shot.n, aspect, canvas, zones, standin, reduced,
      opacity: 1, captures: [], chip: null, chipOut: null, caption: null, captionOut: null,
      rule: null, rings: [], card: null, endCard: null, intro: null, scene: null,
      poster: null,
    };

    /* Fade up from Basalt, pre-rolled: frame 0 already carries the picture at
     * 50 % and it reaches 100 % by frame 6. Bible 2.8 budgets a 400 ms fade
     * from zero, which leaves frame 0 as bare ground, and frame 0 is the
     * thumbnail on every platform. Ruled: the film opens on the failure.
     *
     * A film that opens on a poster card does not fade up at all. The fade
     * exists so the film does not begin on a hard cut out of nothing; a card
     * designed to be the opening has nothing to arrive from. And the cost is
     * paid where it hurts most: frame 0 IS the poster image beside the film in
     * every listing, and half a frame of opacity is a grey thumbnail. Same
     * reasoning as the rev-4 ruling that the intro does not fade OUT. */
    st.opacity = script.shots[0] && script.shots[0].poster
      ? 1
      : 0.5 + 0.5 * seg(t, 0, 200, EASE.linear);

    /* The poster card. Frame 0 of every lesson film, and therefore the poster
     * image beside it on the tutorials page: the film's title, the tool or
     * feature it is about, and a real frame of that tool taken from this film.
     *
     * It is a held card by declaration (`hold: true`), and that is the point of
     * it — a poster that is still moving is not a poster. The title's mask-wipe
     * is pre-rolled to whole so frame 0 carries the finished card, the same
     * reasoning that pre-rolls the opening fade in 35-render 6.7 ruling 2.
     *
     * The capture goes through the ordinary capture layer, at its native size,
     * inside a smaller window that crops it. A crop shows recorded pixels at
     * 1:1; nothing here is scaled (bible 2.2). */
    if (shot.poster) {
      const P = shot.poster;
      if (P.src) {
        st.captures.push({
          x: P.box.x, y: P.box.y, bw: P.box.w, bh: P.box.h,
          w: P.imgW, h: P.imgH, dx: P.dx, dy: P.dy,
          fit: P.fit || null, src: P.src, clipRight: 0, opacity: 1,
        });
      }
      st.poster = {
        line1: P.line1, line2: P.line2 || '', chip: P.chip || '',
        /* The band across the foot of the card (research/63 §2), from the same
         * builder that placed the picture, so the two cannot disagree about
         * where the picture ends and the words begin. */
        band: P.band || null,
        reveal: 1, opacity: 1,
        /* The commercial's card carries the mark drawing itself where the other
         * films carry a chip. Rev 4 put an animated intro in front of that film
         * and it is kept: the beats are bible 2.4's wake, unchanged, and they
         * are the shot's motion. What changed is that the card around them is
         * whole on frame 0 instead of the mark arriving on bare ground. */
        mark: P.mark ? {
          ring: seg(t, shot.inSec + 0.10, 620, EASE.mark),
          check: seg(t, shot.inSec + 0.72, 300, EASE.mark),
        } : null,
      };
    }

    /* The animated intro: the mark draws itself on the ground, then the
     * wordmark rises. No capture, no caption, 2.000 s, and the film's own
     * language before a single pixel of product. */
    if (shot.intro) {
      const b = shot.inSec;
      st.intro = {
        ring: seg(t, b + 0.10, 620, EASE.mark),
        check: seg(t, b + 0.72, 300, EASE.mark),
        wordmark: seg(t, b + 1.10, DUR.slow1, EASE.expressive),
        /* No fade out. The intro held its own picture to the last frame and
         * the film cuts from it, because the rev-4 ruling keeps cuts between
         * shots hard and a title that dissolves to bare ground first spends a
         * beat on nothing. Measured: with the fade, the boundary at 2.000 s
         * moved 1.22 code values against neighbours of 0.30 and read as a
         * dissolve through empty Basalt; without it the mark and the wordmark
         * are whole on frame 59 and gone on frame 60. */
        out: 1,
      };
    }

    /* An authored scene: line art drawn in the composition, not a capture.
     * `p` is the shot's own progress and every part of the scene is a pure
     * function of it, exactly as a capture frame number is. */
    if (shot.scene) {
      st.scene = { id: shot.scene, p: Math.max(0, Math.min(1, (t - shot.inSec) / (shot.outSec - shot.inSec))) };
    }

    /* The outgoing shot, still there, at full strength, underneath.
     *
     * A cross-fade needs TWO pictures. Without this the incoming shot simply
     * faded up from Basalt and the frame dipped through the ground at the
     * midpoint — measured on `record-a-session` cut 3, where both the popup
     * leaving and the portal arriving read at half over a dark ground, which
     * is a dip and not a dissolve. The director saw it and called it.
     *
     * So the shot that is leaving is drawn first, holding its own last frame,
     * at opacity 1, and the shot that is arriving is drawn over it. At any
     * instant the frame is `B*t + A*(1-t)` with no ground between them: a true
     * cross-fade, and for a push, a picture sliding over another picture rather
     * than over a hole.
     *
     * Only `dissolve` and `push` take an underlay. A hard cut has nothing to
     * blend, and `reveal` is a clip-path on one picture by design — bible 2.8's
     * shape wipe reveals the ground, which is what a shape wipe is. */
    const arriving = shot.transition || { kind: 'cut', ms: 0 };
    if (CROSSFADED.has(arriving.kind) && arriving.ms > 0 && t < shot.inSec + arriving.ms / 1000) {
      const i = script.shots.indexOf(shot);
      const leaving = i > 0 ? script.shots[i - 1] : null;
      if (leaving && leaving.rect) {
        /* Its last frame, held. The shot is over; what is on screen is the
         * picture it ended on, not a picture it never reached. */
        const last = Math.max(leaving.inSec, leaving.outSec - 1 / fps);
        /* Full strength for the first 60 % of the transition, then out over the
         * remaining 40 %.
         *
         * Holding it at 1 to the last frame and then dropping it is a SECOND
         * cut, and the detector saw it: fifteen films reported a scene change
         * at 4.400 s, which is 4.000 plus a 400 ms dissolve, off the beat grid
         * and failing §8.2. It is only visible where the arriving picture does
         * not cover the leaving one — a 420 px panel arriving over a 1080 px
         * page leaves the page showing either side — and there it snapped from
         * full to nothing in one frame.
         *
         * The 60 % hold is what keeps the cross-fade honest: at the midpoint,
         * where the eye judges a dissolve, the leaving picture is still at 1
         * and there is no ground between the two. */
        const outAlpha = 1 - seg(t, shot.inSec + (arriving.ms * 0.6) / 1000,
          arriving.ms * 0.4, EASE.linear);
        for (const b of placements(leaving, last)) {
          st.captures.push({
            x: b.x, y: b.y, w: b.w, h: b.h, fit: b.fit || null, src: b.src,
            clipRight: 0, dx: 0, dy: 0, opacity: outAlpha,
          });
        }
      }
    }

    /* The capture object. It arrives on its cut; it is never resampled, and it
     * sits on exactly its placement rectangle on every frame the transition is
     * not running.
     *
     * `clipBottom` used to live here and carried the top-to-bottom wipe. It is
     * gone on the director's ruling of 2026-09-06, and `transitionFaults()`
     * fails any film that puts it back. */
    if (shot.rect) {
      const wipe = shot.wipeIn ? seg(t, shot.inSec, DUR.mod2, EASE.wipe) : 1;
      /* The reduced-motion cut: every translate becomes an opacity and every
       * wipe becomes a dissolve (bible 5.3, R1 rule 42). A hard cut stays a
       * hard cut, because it never moved anything to begin with. */
      const tr = shot.transition || { kind: 'cut', ms: 0 };
      const kind = reduced && tr.kind !== 'cut' ? 'dissolve' : tr.kind;
      const ms = kind === 'cut' ? 0 : (tr.ms || TRANSITION_MS[kind] || 0);
      const ease = kind === 'dissolve' ? EASE.linear : EASE.wipe;
      /* The shot that opens the film cannot open closed: frame 0 is the
       * thumbnail on every platform (35-render 6.7 ruling 2, 6.10). Its
       * transition is pre-rolled by half its length so the picture is already
       * past halfway on frame 0. */
      const opens = (shot.inFrame != null ? shot.inFrame : Math.round(shot.inSec * fps)) === 0;
      const from = opens ? shot.inSec - 0.5 * (ms / 1000) : shot.inSec;
      const p = ms > 0 ? seg(t, from, ms, ease) : 1;
      const dissolve = kind === 'dissolve' ? p : 1;
      const revealed = kind === 'reveal' ? p : 1;
      const pushing = kind === 'push';
      const slide = pushing ? (1 - p) * Math.round(S * PUSH_PX / 1080) : 0;
      const edge = tr.from || 'bottom';
      /* A push is a translate AND an opacity, which is bible 2.4's enter motion
       * for everything else in the film. The opacity is SHORTER than the
       * travel — 110 ms of the 240 — so what the eye reads is the picture
       * moving, not the picture dimming: an opacity ramp as long as the travel
       * puts the whole shot at half strength exactly when it is halfway across,
       * which is the same dip a fade-up-from-nothing gives. The picture that is
       * leaving holds underneath for the whole 240 ms, so nothing is ever seen
       * through to the ground. */
      const arrive = pushing ? seg(t, from, Math.min(ms, DUR.f2), EASE.linear) : 1;
      for (const b of placements(shot, t)) {
        st.captures.push({
          x: b.x, y: b.y, w: b.w, h: b.h, fit: b.fit || null, src: b.src,
          /* Shape wipe: clip-path inset from the right, no feather. The
           * storyboard's own `shapeWipe` graphic and the `reveal` transition
           * are the same mechanism and take the tighter of the two. */
          clipRight: reduced ? 0 : Math.max((1 - wipe) * 100, (1 - revealed) * 100),
          /* The push, in canvas pixels, applied to the picture INSIDE the card,
           * which clips it. Exactly 0 once the transition has run, so the
           * capture sits on its placement rectangle for every other frame. */
          dx: Math.round(slide * (edge === 'left' ? -1 : edge === 'right' ? 1 : 0)),
          dy: Math.round(slide * (edge === 'top' ? -1 : edge === 'bottom' ? 1 : 0)),
          opacity: reduced ? Math.min(wipe, dissolve, arrive) : dissolve * arrive,
        });
      }
    }

    /* <feature> chip. Enters translate-x -26 + opacity 240 ms productive;
     * changes value by cross-fade; leaves on opacity 150 ms linear. */
    const liveChips = [];
    chipRuns.forEach((run, i) => {
      if (!run.text) return;
      const prev = chipRuns[i - 1];
      const next = chipRuns[i + 1];
      const isChange = !!(prev && prev.text);   // chip -> chip is a cross-fade
      const handsOver = !!(next && next.text);  // ... and so is chip -> next chip
      // A cross-fade needs the two to overlap. Fading out before the new one
      // fades in leaves the rail empty for a frame at every feature beat, which
      // is a flicker on the one object that is meant to be constant.
      const tail = handsOver ? DUR.mod1 / 1000 : 0;
      if (t < run.inSec || t >= run.outSec + tail) return;
      const a = seg(t, run.inSec, isChange ? DUR.mod1 : DUR.mod2, EASE.linear);
      const out = handsOver
        ? 1 - seg(t, run.outSec, DUR.mod1, EASE.linear)
        : 1 - seg(t, run.outSec - DUR.mod1 / 1000, DUR.mod1, EASE.linear);
      const op = a * out;
      if (op <= 0.001) return;
      liveChips.push({
        text: run.text, opacity: op,
        tx: (isChange || reduced) ? 0 : (1 - seg(t, run.inSec, DUR.mod2, EASE.productive)) * -26,
      });
    });
    st.chip = liveChips[liveChips.length - 1] || null;
    st.chipOut = liveChips.length > 1 ? liveChips[0] : null;

    /* Caption. translate-y +9 + opacity 150 ms in, opacity 110 ms out. */
    // A shot whose own type fills the frame does not also run a caption band:
    // the card is the caption. Saying the same words twice in one frame in two
    // sizes is not emphasis (bible 2.9 rule 9 in spirit; 3.3 shots 17 and 18).
    const fadeOut = (c) => (c.hardOut
      ? 1 - seg(t, c.outSec - DUR.f2 / 1000, DUR.f2, EASE.linear)   // gone by outSec
      : 1 - seg(t, c.outSec, DUR.f2, EASE.linear));                 // crosses the change
    const live = [];
    /* Verbatim captions are the exception the bible names (3.4): the band IS
     * the read, and the last chunk deliberately shares its moment with the end
     * card's own display line, "the one place a caption and a display card may
     * both be up". So a verbatim film keeps its band everywhere; a film with
     * written cards still suppresses it where its own type fills the frame. */
    if (script.verbatim || !(shot.card || shot.endCard)) {
      for (const c of cards) {
        const tail = (script.verbatim || c.hardOut) ? 0 : DUR.f2 / 1000;
        if (t < c.inSec || t >= c.outSec + tail) continue;
        /* Verbatim chunks CUT, they do not dissolve. Subtitles change on a
         * frame; a 110 ms cross-fade between two lines of spoken words draws
         * both on the same centre line at half opacity and the result is
         * unreadable. Written cards keep the cross-fade, which is what stops
         * the band going bare between them. */
        const op = script.verbatim
          ? ((t >= c.inSec && t < c.outSec) ? 1 : 0)
          : seg(t, c.inSec, DUR.mod1, EASE.linear) * fadeOut(c);
        if (op <= 0.001) continue;
        const layer = {
          text: c.text, opacity: op,
          ty: (reduced || script.verbatim) ? 0 : (1 - seg(t, c.inSec, DUR.mod1, EASE.productive)) * 9,
        };
        live.push(layer);
      }
      // Cards are in time order, so a pair is [outgoing, incoming]. They overlap
      // for 110 ms at a change and never otherwise.
      st.caption = live[live.length - 1] || null;
      st.captionOut = live.length > 1 ? live[0] : null;
    }

    /* Accent rule: scale-x 0 -> 1 from the left, 240 ms; out 200 ms. */
    for (const g of script.graphics || []) {
      if (g.kind !== 'rule' || t < g.inSec || t >= g.outSec) continue;
      const grow = seg(t, g.inSec, DUR.mod2, EASE.wipe);
      const shrink = 1 - seg(t, g.outSec - 0.2, 200, EASE.wipe);
      st.rule = reduced
        ? { x: g.x, y: g.y, w: g.w, scaleX: 1, opacity: Math.min(grow, shrink) }
        : { x: g.x, y: g.y, w: g.w, scaleX: Math.min(grow, shrink), opacity: 1 };
    }

    /* Click ring: 56 px, 3 px stroke, blur 0, scale .35 -> 2.6 + fade, 620 ms. */
    for (const g of script.graphics || []) {
      if (g.kind !== 'ring') continue;
      const p = seg(t, g.atSec, 620, EASE.mark);
      if (p <= 0 || p >= 1) continue;
      const [x, y] = g.at;
      st.rings.push({
        x, y, accent: g.accent,
        scale: reduced ? 1.4 : 0.35 + p * (2.6 - 0.35),
        opacity: reduced ? Math.sin(p * Math.PI) : 1 - p,
      });
    }

    /* Full-frame type card: three display lines, 400 ms apart, mask-wipe up on
     * each line's own baseline, expressive. Hard cut out. */
    if (shot.card) {
      st.card = shot.card.map((text, i) => {
        const at = shot.inSec + 0.10 + i * 0.40;
        const p = seg(t, at, DUR.slow1, EASE.expressive);
        return { text, reveal: reduced ? 1 : p, opacity: reduced ? p : (p > 0 ? 1 : 0) };
      });
      // One Petra hairline under the third line.
      const at = shot.inSec + 0.10 + 2 * 0.40 + 0.24;
      const p = seg(t, at, DUR.mod2, EASE.wipe);
      st.cardRule = reduced ? { scaleX: 1, opacity: p } : { scaleX: p, opacity: 1 };
    }

    /* End card. Mask reveal on the ring, then the wake, then three staged
     * reveals, one moving at a time; held so it loops into frame 0. */
    if (shot.endCard) {
      // Beats come from the shot itself when the storyboard declares them, and
      // fall back to offsets from the cut when it does not.
      const b = shot.inSec;
      const e = typeof shot.endCard === 'object' ? shot.endCard : {};
      const maskAt = e.maskAt != null ? e.maskAt : b;
      const ringAt = e.ringAt != null ? e.ringAt : b;
      const ringMs = e.ringMs != null ? e.ringMs : 520;
      const wordAt = e.wordmarkAt != null ? e.wordmarkAt : b + 0.90;
      const tagAt = e.taglineAt != null ? e.taglineAt : b + 1.50;
      const askAt = e.askAt != null ? e.askAt : tagAt + 0.40;
      const fineAt = e.fineAt != null ? e.fineAt : b + 2.60;
      const over = e.overshoot != null ? e.overshoot : 0.04;
      const mask = seg(t, maskAt, e.maskMs != null ? e.maskMs : 520, EASE.mark);
      const ring = seg(t, ringAt, ringMs, EASE.mark);
      const check = seg(t, ringAt + ringMs / 1000, e.checkMs != null ? e.checkMs : 260, EASE.mark);
      st.endCard = {
        maskR: reduced ? 1 : mask,
        ringDraw: reduced ? 1 : ring,
        checkDraw: reduced ? 1 : check,
        // BRAND 4: the verdict overshoots as it lands and settles back.
        checkScale: reduced ? 1 : (check < 0.7 ? 1 + (check / 0.7) * over : 1 + (1 - (check - 0.7) / 0.3) * over),
        markOpacity: reduced ? seg(t, ringAt, ringMs, EASE.linear) : 1,
        // Reduced motion is off, not slower (BRAND 4, R1 rule 42): the mask
        // wipe becomes a fade and the durations do not change.
        wordmark: reduced ? 1 : seg(t, wordAt, DUR.slow1, EASE.expressive),
        wordmarkOpacity: reduced ? seg(t, wordAt, DUR.slow1, EASE.linear) : 1,
        tagline: reduced ? 1 : seg(t, tagAt, DUR.slow1, EASE.expressive),
        taglineOpacity: reduced ? seg(t, tagAt, DUR.slow1, EASE.linear) : 1,
        ask: seg(t, askAt, e.askMs != null ? e.askMs : DUR.mod2, EASE.expressive),
        fine: seg(t, fineAt, DUR.slow1, EASE.expressive),
      };
    }

    return st;
  }

  return {
    id: script.id, fps, frames, seconds: script.seconds, aspect, canvas, zones, S,
    reduced, standin, script, storyboard, cards, faults, pushes, chipRuns, rects,
    shots: script.shots, stateAt,
    poster: (script.shots.find((sh) => sh.poster) || {}).poster || null,
  };
}

/**
 * Ruling 2, made checkable: no shot may leave more than half the frame as empty
 * ground. Measured the way the coordinator measured it, as the widest run of
 * frame width with no capture on it. A single PANEL at x 192 scores 1308 px on
 * a 1920 px frame; a PAIR scores 180.
 */
export function groundReport(T) {
  const W = T.canvas.w;
  return T.shots.map((shot) => {
    if (!shot.rect) return { n: shot.n, rect: 'card', widest: 0, coveredPct: 0, exempt: true };
    const run = (list) => {
      const spans = list.map((b) => [b.x, b.x + b.w]).sort((a, c) => a[0] - c[0]);
      let widest = spans[0][0], cursor = spans[0][1];
      for (const [x0, x1] of spans.slice(1)) { widest = Math.max(widest, x0 - cursor); cursor = Math.max(cursor, x1); }
      return Math.max(widest, W - cursor);
    };
    if (shot.place && shot.place.length) {
      const covered = shot.place.reduce((a, b) => a + b.w * b.h, 0) / (T.canvas.w * T.canvas.h);
      return { n: shot.n, rect: shot.rect, widest: run(shot.place), coveredPct: covered * 100, exempt: false };
    }
    const meta = T.storyboard && T.storyboard.clips ? T.storyboard.clips[shot.clip] : null;
    const boxes = T.rects[shot.rect].map((b) => {
      // A fitted vector occupies less than its box; measure what is drawn.
      if (b.fit !== 'height') return b;
      const w = Math.round(b.h * ((meta && meta.aspectRatio) || 1123 / 794));
      return { ...b, w, x: b.x + Math.round((b.w - w) / 2) };
    });
    const spans = boxes.map((b) => [b.x, b.x + b.w]).sort((a, c) => a[0] - c[0]);
    let widest = spans[0][0], cursor = spans[0][1];
    for (const [x0, x1] of spans.slice(1)) {
      widest = Math.max(widest, x0 - cursor);
      cursor = Math.max(cursor, x1);
    }
    widest = Math.max(widest, W - cursor);
    const covered = boxes.reduce((a, b) => a + b.w * b.h, 0) / (T.canvas.w * T.canvas.h);
    return { n: shot.n, rect: shot.rect, widest, coveredPct: covered * 100, exempt: false };
  });
}

/**
 * Ruling 1: the expected cut count comes from what the storyboard promises, not
 * from the number of shots. A boundary counts as a cut only where the picture
 * changes: a different surface, or a different set of placement rectangles.
 * Four shots of the same rectangle on the same surface are one continuous take
 * by design, which is what the commercial's hook is: submit, fail, refill,
 * works. Every boundary still lands on its beat; nothing here re-cuts anything.
 */
export function expectedCuts(T) {
  const key = (s) => placeKey(s, T.rects);
  const out = [];
  for (let i = 1; i < T.shots.length; i++) {
    const a = T.shots[i - 1], b = T.shots[i];
    if (key(a) !== key(b)) {
      /* The transition comes with the boundary, because how a boundary is made
       * decides how it can be measured. A hard cut moves the picture in one
       * frame and is found by looking at that frame. A 400 ms cross-fade never
       * moves a single frame by much and is found by looking across the whole
       * transition — `verify.mjs` branches on this rather than judging every
       * boundary as though it were a cut. */
      const tr = b.transition || { kind: 'cut', ms: 0 };
      out.push({ n: b.n, atSec: b.inSec, from: key(a), to: key(b), kind: tr.kind, ms: tr.ms || 0 });
    }
  }
  return out;
}

/* ── structural checks the bible asks for by number (§7.2, §8.1) ────────── */

export function scriptFaults(script) {
  const out = [...copyFaults(script)];
  const fps = script.fps;
  let sum = 0;
  for (const s of script.shots) {
    const inF = Math.round(s.inSec * fps), outF = Math.round(s.outSec * fps);
    if (inF % 15 !== 0) out.push(`shot ${s.n}: in frame ${inF} is not on a beat (not divisible by 15)`);
    if (outF % 15 !== 0) out.push(`shot ${s.n}: out frame ${outF} is not on a beat`);
    if (s.outSec - s.inSec < 1.2 - 1e-9) out.push(`shot ${s.n}: ${(s.outSec - s.inSec).toFixed(2)} s is under the 1.2 s floor`);
    sum += s.outSec - s.inSec;
  }
  if (Math.abs(sum - script.seconds) > 1e-6) out.push(`shots sum to ${sum} s, not ${script.seconds} s`);
  /* The 8-word and 42-character limits are rules for WRITTEN cards, where the
   * writer chooses the words and the band is one line of 56/800. A verbatim
   * film does not write its captions: it shows the spoken line, and the rev-4
   * ruling sets a line of more than six words two lines deep at 48/800. So the
   * length limits do not apply to one; what still holds is that no card may run
   * past two lines, and the em-dash rule in copyFaults(). */
  for (const c of script.captions) {
    const lines = String(c.text).split('\n');
    if (lines.length > 2) out.push(`caption ${JSON.stringify(c.text)} is ${lines.length} lines`);
    if (script.verbatim) continue;
    for (const l of lines) if (l.length > 42) out.push(`caption line over 42 chars: ${JSON.stringify(l)}`);
    if (String(c.text).split(/\s+/).length > 8) out.push(`caption over 8 words: ${JSON.stringify(c.text)}`);
  }
  // One Petra element per shot (§2.5 rule 1). The chip counts as Petra.
  const petraPerShot = {};
  for (const s of script.shots) petraPerShot[s.n] = s.chip ? ['chip'] : [];
  for (const g of script.graphics || []) {
    const isPetra = (g.kind === 'ring' && g.accent === 'petra') || g.kind === 'rule';
    if (isPetra && g.shot != null) (petraPerShot[g.shot] ||= []).push(g.kind);
  }
  for (const [n, list] of Object.entries(petraPerShot)) {
    if (list.length > 1) {
      // The bible contradicts itself here: 2.4 rule 4 and 2.5 rule 1 say one
      // Petra element per shot, and the 3.3 shot table gives shots 10 and 13 a
      // held chip AND their own Petra graphic. Builder A renders the table and
      // declares the conflict; resolving it is the director's call, not a
      // silent edit to the picture.
      out.push(`spec-conflict: shot ${n} carries ${list.length} Petra elements (${list.join(' + ')}); bible 2.5 rule 1 budgets 1, bible 3.3 asks for both`);
    }
  }
  return out;
}
