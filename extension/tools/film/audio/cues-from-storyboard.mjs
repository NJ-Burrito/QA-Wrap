#!/usr/bin/env node
/**
 * Round 3: build `cues/<id>.cues.json` from `storyboard/<id>.storyboard.json`.
 *
 * WHY THIS EXISTS
 *
 * `voice.mjs` reads a CUE file, not a storyboard, and every cue file on disk is
 * round 2: `record-a-session.cues.json` is a 20 s film whose round-3 storyboard
 * is 36 s, and its four lines are not the eight that were frozen in
 * `research/65-round3-scripts-2026-09-08.md`. Re-typing 152 lines and 152 pairs
 * of anchors by hand is the way the two files come to disagree; the storyboard
 * already carries every one of them, on `shots[].vo`, so this reads them.
 *
 * THE ONE PIECE OF ARITHMETIC HERE: THE TIMELINE THE READ IS PLACED ON
 *
 * The storyboard on disk is NOT the delivered timeline. `compose/frames.mjs`
 * adds two things to it at load time, and the read has to be placed on the
 * result or every cue in the film is out of sync:
 *
 *   1. **The poster card, +2.000 s in front** (`POSTER_HOLD`), on every lesson
 *      film. The commercial has none - it opens on its own intro.
 *   2. **The end card, +2.000 s at the back** (`END_CARD_GROWTH`), on every
 *      film, so the spoken close has room to land instead of being cut off.
 *
 * So a line's anchor is its storyboard `vo.startSec` plus the poster hold, the
 * last shot is 2.000 s longer than the storyboard says, and the film is
 * `sb.seconds + 4.000` (lesson) or `sb.seconds + 2.000` (commercial). That is
 * exactly the length `frames.mjs:589` refuses to compose without.
 *
 * Everything else in a cue file - the master targets, the bed's five sections,
 * the pad - is the shape every round-2 cue file already carried, generalised to
 * the film's own bar count. The bed section boundaries are a starting point for
 * the mix stage, not a ruling: nothing in the voice stage reads them.
 *
 * Usage:
 *   node cues-from-storyboard.mjs --id cat-break
 *   node cues-from-storyboard.mjs --all
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORYBOARD = path.join(HERE, "..", "storyboard");
const CUES = path.join(HERE, "cues");
const NL = String.fromCharCode(10);

/* Kept in step with compose/frames.mjs by name, not by coincidence. */
const POSTER_HOLD = 2.0;
const END_CARD_GROWTH = 2.0;
const COMMERCIAL = "qa-wrap";

/** The round-3 set, in the order research/65 §1 lists it. */
export const ROUND3 = [
  "cat-capture", "cat-check", "cat-design", "cat-break",
  "record-a-session", "the-tools", "file-it", "save-and-diagram",
  "protect-the-data", "qa-wrap",
];

/* The master targets are the same numbers on every film in the set (bible 8). */
const MASTER = {
  integratedLufs: -14,
  maxShortTermLufs: -9,
  truePeakDbtp: -1,
  truePeakDbtp916: -1.5,
  codec: "aac",
  profile: "aac_low",
  sampleRate: 48000,
  channels: 2,
  bitrate: "320k",
};

const r6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * The five-section bed, generalised from the round-2 cue files.
 *
 * Round 2's films were 10 to 29 bars and every one of them ran
 * preroll(1-2) intro(2-4) drive(4-n-2) lift(n-2-n-1) out(n-1-n+1).
 * The category films are 30 to 88 bars, so the same shape is expressed as
 * proportions of the bar count instead of as literals, with the two-bar head
 * and the two-bar tail held fixed because they carry the poster card and the
 * end card, which do not grow with the film.
 */
function bedFor(bars) {
  const drive = Math.max(5, bars - 2);
  const lift = Math.max(drive + 1, bars - 1);
  return {
    gainDb: -5,
    targetLufs: -26.9,
    sections: [
      { name: "preroll", fromBar: 1, toBar: 2,
        note: "the 2.000 s poster card: the pad and the logo mnemonic only. No kick, no bass, no hats, no plucks; the first hit is on the cut out of the card" },
      { name: "intro", fromBar: 2, toBar: 4, note: "pluck + 8th hats, no low end" },
      { name: "drive", fromBar: 4, toBar: drive, note: "kick + bass + 16th hats" },
      { name: "lift", fromBar: drive, toBar: lift,
        note: "plucks up an octave, FM index down, shimmer in" },
      { name: "out", fromBar: lift, toBar: bars + 1,
        note: "single hit, then ring out under the end card, which now holds the spoken close" },
    ],
    swells: [{ endSec: (drive - 1) * 2, dur: 1, gain: 0.45,
      note: "reverse swell into the lift and the end card" }],
    outPlan: { kickThroughBar: drive, singleHitBar: lift, ringOut: true },
    padGain: 0.126,
    padSections: ["preroll", "intro", "drive", "lift", "out"],
    padNote: "the sustained band-limited chord, voiced two and three octaves above the plucks so it lives in 1-4 kHz - the band a voice rest sounds empty in - without touching the 20-200 Hz anti-engine band.",
  };
}

/**
 * Per-line overrides, kept OUT of the generated file so regenerating a cue
 * sheet cannot silently throw them away.
 *
 * Only two things ever belong here, and both are `voice.mjs`'s own vocabulary:
 *
 *   `drawSalt`   buy a fresh set of k draws for one line, because the first set
 *                all failed the contour gate. It travels in the render cache
 *                key, so it re-draws that line and nothing else.
 *   `maxTailSt`  a HARDER landing than the film-wide +1.0 ST for a line that
 *                lists. It may only ever be tightened here; the gate's own
 *                ceiling is the defect gate and is not a knob.
 *
 * Shape: `{ "<film-id>": { "<line n>": { "drawSalt": 1, "why": "..." } } }`
 */
const OVERRIDES = path.join(CUES, "_overrides.json");
function overridesFor(id) {
  if (!fs.existsSync(OVERRIDES)) return {};
  const all = JSON.parse(fs.readFileSync(OVERRIDES, "utf8"));
  return all[id] || {};
}

export function cuesFromStoryboard(id) {
  const sbPath = path.join(STORYBOARD, `${id}.storyboard.json`);
  const sb = JSON.parse(fs.readFileSync(sbPath, "utf8"));
  if (sb.rev !== "round-3") {
    throw new Error(`${id}: storyboard rev is "${sb.rev}", not "round-3"`);
  }
  const shift = id === COMMERCIAL ? 0 : POSTER_HOLD;
  const seconds = r6(sb.seconds + shift + END_CARD_GROWTH);
  const fps = sb.fps || 30;
  const bpm = sb.bpm || 120;
  const bars = Math.round(seconds / (240 / bpm));
  const lastShot = sb.shots[sb.shots.length - 1].n;

  const over = overridesFor(id);
  const lines = [];
  for (const sh of sb.shots) {
    const vo = sh.vo;
    if (!vo || !vo.line || !String(vo.line).trim()) continue;
    if (vo.startSec == null) {
      throw new Error(`${id}: shot ${sh.n} carries a line with no startSec`);
    }
    /* The end card is the only shot the growth lands on, so it is the only
     * shot whose window is longer here than in the storyboard. */
    const grow = sh.n === lastShot ? END_CARD_GROWTH : 0;
    const o = over[String(lines.length + 1)] || {};
    lines.push({
      n: lines.length + 1,
      text: String(vo.line).trim(),
      atSec: r6(vo.startSec + shift),
      delivery: String(vo.delivery || "bright"),
      shot: sh.n,
      shotInSec: r6(sh.inSec + shift),
      shotOutSec: r6(sh.outSec + shift + grow),
      ...(vo.jCut ? { jCut: true } : {}),
      ...(o.drawSalt != null ? { drawSalt: o.drawSalt } : {}),
      ...(o.maxTailSt != null ? { maxTailSt: o.maxTailSt } : {}),
      ...(o.why ? { why: o.why } : {}),
    });
  }
  if (!lines.length) throw new Error(`${id}: no spoken line in the storyboard`);

  /* THE DECLARED RESTS.
   *
   * A rest is a silence the SHOT TABLE plans, and `voice.mjs` marks every gap
   * of 0.4 s or more that is not declared here as UNDECLARED and exits 3. On
   * these films every such gap is planned: research/65 §2 sizes each shot as
   * `ceil((words × 0.33 + 0.4) / 0.5) × 0.5`, so the 0.4 to 0.9 s after each
   * line is the design, not a hole - and the two long ones, the poster card at
   * the head and the end card's ring-out at the tail, are the two cards.
   *
   * The bounds are the PLAN (0.33 s/word), not a measurement, and they are
   * opened 0.6 s early at the front so a read that runs a little long still
   * falls inside. No measurement is claimed here that was not made: what is
   * being declared is that the shot table intended a rest here, which is
   * exactly the question `voice.mjs` is asking. */
  const REST_MIN = 0.4;
  const rests = [];
  let planned = 0;
  lines.forEach((l, i) => {
    const start = Math.max(l.atSec, planned > 0 ? planned + 0.20 : 0);
    if (start - planned >= REST_MIN) {
      rests.push({
        fromSec: r6(Math.max(0, planned - (i ? 0.6 : 0))),
        toSec: r6(start),
        why: i === 0
          ? `the head of the stem: the ${shift ? "poster card, then the " : ""}logo mnemonic; the first word lands at ${start.toFixed(2)}`
          : `the rest the shot table plans after line ${i} - shot ${lines[i - 1].shot} is ${(lines[i - 1].shotOutSec - lines[i - 1].shotInSec).toFixed(2)} s for a ${lines[i - 1].text.trim().split(/\s+/).length}-word line`,
      });
    }
    planned = start + l.text.trim().split(/\s+/).length * 0.33;
  });
  if (seconds - planned >= REST_MIN) {
    rests.push({ fromSec: r6(Math.max(0, planned - 0.6)), toSec: seconds,
      why: "the tail: the end card's ring-out after the spoken close" });
  }

  return {
    id,
    kind: sb.kind,
    bpm,
    fps,
    bars,
    seconds,
    sampleRate: 48000,
    source: `generated from storyboard/${id}.storyboard.json (rev round-3) by `
      + "cues-from-storyboard.mjs; lines and anchors are the storyboard's own "
      + "shots[].vo, shifted onto the delivered timeline (poster card "
      + `${shift.toFixed(3)} s in front, end card ${END_CARD_GROWTH.toFixed(3)} s at the back)`,
    master: MASTER,
    bed: bedFor(bars),
    voice: {
      voice: "Aoede",
      fallback: "Kore",
      targetLufs: -15,
      lines,
      note: "The commercial's final recipe: one Gemini request per line, one voice and one delivery instruction, the gate selecting by shot fit among contour-passing draws, the clean chain with a +6 dB bell at 3.9 kHz whose gain is inside the voice trim.",
      provider: "gemini",
      model: "google/gemini-3.1-flash-tts-preview via openrouter /v1/audio/speech",
      rate: "+0%",
      pitch: "-8Hz",
      presenceBellDb: 6,
      captionMode: "per-line",
    },
    seed: 20260908,
    rests,
    revision: "round-3 (+2s poster, +2s end card)",
  };
}

function main() {
  const i = process.argv.indexOf("--id");
  const ids = process.argv.includes("--all")
    ? ROUND3
    : (i >= 0 ? [process.argv[i + 1]] : []);
  if (!ids.length) {
    console.error("usage: node cues-from-storyboard.mjs --id <film-id> | --all");
    process.exit(2);
  }
  fs.mkdirSync(CUES, { recursive: true });
  for (const id of ids) {
    const c = cuesFromStoryboard(id);
    fs.writeFileSync(path.join(CUES, `${id}.cues.json`),
      JSON.stringify(c, null, 2) + NL);
    const words = c.voice.lines.reduce(
      (a, l) => a + l.text.trim().split(/\s+/).length, 0);
    console.log(`${id.padEnd(18)} ${String(c.seconds).padStart(6)} s  `
      + `${String(c.bars).padStart(3)} bars  ${String(c.voice.lines.length).padStart(3)} lines  `
      + `${String(words).padStart(4)} words  planned read ${(words * 0.33).toFixed(1)} s`);
  }
}

if (import.meta.url === `file://${process.argv[1].split("\\").join("/")}`
    || process.argv[1].endsWith("cues-from-storyboard.mjs")) main();
