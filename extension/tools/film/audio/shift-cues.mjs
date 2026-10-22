#!/usr/bin/env node
/**
 * Move a cue sheet later by a whole number of bars, for the poster card.
 *
 *   node tools/film/audio/shift-cues.mjs --id tool-check-the-links --by 2.0
 *   node tools/film/audio/shift-cues.mjs --all --by 2.0          (the 21 lessons)
 *   node tools/film/audio/shift-cues.mjs --all --by 2.0 --dry
 *
 * ── what this is for ──────────────────────────────────────────────────────
 *
 * The director's ruling of 2026-09-06 puts a poster card in front of every
 * lesson film: the film's title, the tool it is about, and a real frame of that
 * tool. `compose/frames.mjs` moves the PICTURE by shifting the storyboard at
 * load time, exactly as it already does for the commercial's animated intro.
 * The SOUND has to move with it, and the sound is authored in a second file.
 *
 * So this is the other half of that shift, and it is a file rewrite rather than
 * a load-time transform for one reason: `bed.py`, `voice.mjs` and `mix.mjs` all
 * read the cue sheet directly, from three different processes, and a transform
 * that lived in one of them would not be seen by the other two.
 *
 * ── what moves, and what does not ─────────────────────────────────────────
 *
 * Everything absolute moves by `--by`. Two things do not:
 *
 *   the logo mnemonic   stays at 0.000. The commercial's cue sheet already
 *                       records the reason next to its own logo cue: the
 *                       pre-roll bar would otherwise carry no sound at all.
 *                       A poster card in silence reads as the file not having
 *                       started.
 *   the head rest       keeps its `fromSec`, because the head of the stem is
 *                       still the head of the stem. Only its end moves, to the
 *                       new first word.
 *
 * Durations never move: a `dur`, a `ms` or a `dev` is a length, not a moment,
 * and shifting one stretches the film instead of delaying it.
 *
 * ── the bar arithmetic ────────────────────────────────────────────────────
 *
 * At 120 BPM one bar is exactly 2.000 s, which is why the hold is 2.000 s and
 * not 1.8 or 2.5: every cue keeps its beat, `bars` gains a whole number, and
 * `bed.py`'s section map stays on the grid. The new bar is a `preroll` section,
 * which `bed.py` already understands — it carries the pad and nothing else, so
 * the first hit of the film is still the cut out of the poster card.
 *
 * Idempotent by declaration, not by guesswork: a sheet that has been shifted
 * carries `posterHold`, and running this twice on it exits without writing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CUES = path.join(HERE, 'cues');
/** The commercial is not shifted: its frame 0 is already a designed card. */
const COMMERCIAL = 'qa-wrap';
const SEC_PER_BAR = 2.0;

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const r6 = (n) => Math.round(n * 1e6) / 1e6;

/** Absolute instants. A key not on this list is a length and never moves. */
const ABSOLUTE = new Set(['atSec', 'fromSec', 'toSec', 'endSec', 'startSec',
  'shotInSec', 'shotOutSec', 'landLastLineBySec', 'endBySec', 'untilSec']);

function shiftTree(node, by) {
  if (Array.isArray(node)) { node.forEach((n) => shiftTree(n, by)); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'number' && ABSOLUTE.has(k)) node[k] = r6(v + by);
    else shiftTree(v, by);
  }
}

function shift(cues, by) {
  const bars = Math.round(by / SEC_PER_BAR);
  if (Math.abs(bars * SEC_PER_BAR - by) > 1e-9) {
    throw new Error(`--by ${by} is not a whole number of bars at ${SEC_PER_BAR} s a bar; `
      + 'every cue would come off its beat');
  }

  /* The voice: anchors, and the shot window each line is judged against. The
   * window's LENGTH is unchanged, so `voice.mjs` re-places every line from its
   * cache and nothing is drawn again. */
  shiftTree(cues.voice, by);

  /* The SFX, except the mnemonic that opens the film. */
  for (const c of cues.sfx || []) {
    if (c.cue === 'logo' && Math.abs(c.atSec) < 1e-9) {
      c.note = (c.note || '').includes('does NOT shift') ? c.note
        : 'the mnemonic under the poster card; it does NOT shift with everything '
          + 'else, because the pre-roll bar would otherwise carry no sound at all';
      continue;
    }
    c.atSec = r6(c.atSec + by);
  }

  /* Declared rests. The head of the stem stays at the head of the stem. */
  (cues.rests || []).forEach((rest, i) => {
    if (i === 0 && rest.fromSec <= 0) rest.toSec = r6(rest.toSec + by);
    else { rest.fromSec = r6(rest.fromSec + by); rest.toSec = r6(rest.toSec + by); }
  });

  /* The bed. A new pre-roll bar at the front, every section a bar later, and
   * the swells and the out plan with them. */
  const bed = cues.bed || {};
  for (const s of bed.sections || []) { s.fromBar += bars; s.toBar += bars; }
  (bed.sections || []).unshift({
    name: 'preroll',
    fromBar: 1,
    toBar: 1 + bars,
    note: `the ${by.toFixed(3)} s poster card: the pad and the logo mnemonic only. `
      + 'No kick, no bass, no hats, no plucks; the first hit is on the cut out of the card',
  });
  for (const s of bed.swells || []) s.endSec = r6(s.endSec + by);
  if (bed.drop) { bed.drop.fromSec = r6(bed.drop.fromSec + by); bed.drop.toSec = r6(bed.drop.toSec + by); }
  if (bed.outPlan) {
    if (bed.outPlan.kickThroughBar != null) bed.outPlan.kickThroughBar += bars;
    if (bed.outPlan.singleHitBar != null) bed.outPlan.singleHitBar += bars;
  }
  /* The pad runs under the poster card too: it is the one thing that keeps
   * 1-4 kHz from going quiet, which is the hole the pad exists to fill. */
  if (Array.isArray(bed.padSections) && !bed.padSections.includes('preroll')) {
    bed.padSections.unshift('preroll');
  }

  cues.bars += bars;
  cues.seconds = r6(cues.seconds + by);
  cues.posterHold = by;
  cues.revision = `${cues.revision || 3}+poster`;
  return cues;
}

const by = Number(arg('by', SEC_PER_BAR));
const dry = !!arg('dry', false);
const ids = arg('all', false)
  ? fs.readdirSync(CUES).filter((f) => f.endsWith('.cues.json'))
    .map((f) => f.replace('.cues.json', '')).filter((id) => id !== COMMERCIAL).sort()
  : [arg('id')].filter(Boolean);

if (!ids.length) {
  console.error('usage: node shift-cues.mjs --id <film-id> [--by 2.0] [--dry]\n'
    + '       node shift-cues.mjs --all [--by 2.0] [--dry]');
  process.exit(2);
}

let moved = 0;
let already = 0;
for (const id of ids) {
  const file = path.join(CUES, `${id}.cues.json`);
  if (!fs.existsSync(file)) { console.log(`  MISS ${id}: no cue sheet`); continue; }
  const cues = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (cues.posterHold) {
    console.log(`  kept ${id.padEnd(28)} already shifted ${cues.posterHold.toFixed(3)} s`);
    already++;
    continue;
  }
  const was = { bars: cues.bars, seconds: cues.seconds, first: (cues.voice.lines[0] || {}).atSec };
  shift(cues, by);
  if (!dry) fs.writeFileSync(file, `${JSON.stringify(cues, null, 2)}\n`, 'utf8');
  console.log(`  ${dry ? 'dry ' : 'move'} ${id.padEnd(28)} `
    + `${was.bars} -> ${cues.bars} bars, ${was.seconds.toFixed(3)} -> ${cues.seconds.toFixed(3)} s, `
    + `line 1 ${was.first.toFixed(2)} -> ${cues.voice.lines[0].atSec.toFixed(2)} s`);
  moved++;
}
console.log(`\n${moved} sheet(s) ${dry ? 'would move' : 'moved'} +${by.toFixed(3)} s`
  + (already ? `, ${already} already shifted` : ''));
console.log('Now, per film:  cd tools/film/audio && python bed.py --id <id> '
  + '&& node voice.mjs --id <id> && node mix.mjs --id <id>');
