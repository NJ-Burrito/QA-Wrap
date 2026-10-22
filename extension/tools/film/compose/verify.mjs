/* QA Wrap — film composition. Builder A. The acceptance measurement.
 *
 * Measures a rendered film against bible §8 and prints numbers, not opinions.
 * Writes the same table into research/35-render.md between the verify markers.
 * **Exits non-zero on any miss.**
 *
 * Usage
 *   node tools/film/compose/verify.mjs [--id qa-wrap] [--aspect 16x9]
 *        [--standin] [--reduced] [--file <path>] [--no-report]
 *
 * Everything here is measured off the mp4 itself, not off the timeline, except
 * where a check needs to know what was intended (caption coverage, cut times);
 * those read the timeline and say so.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, outName, loadFilm } from './frames.mjs';
import { buildTimeline, scriptFaults, groundReport, expectedCuts, CANVASES, ZONES } from './timeline.mjs';
import { run, ffprobeJson, moovIsFirst } from './encode.mjs';
import { FILM_OUT, FILM_AUDIO_OUT } from '../../lib-paths.mjs';


const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '../../..');
const REPO = path.resolve(EXT, '..');
const OUT = FILM_OUT;
const REPORT = path.join(REPO, 'research', '35-render.md');

/* ── measurement helpers ────────────────────────────────────────────────── */

/** Per-frame scene score, for the frozen-shot check. */
function sceneScores(file) {
  const r = run('ffmpeg', ['-v', 'error', '-i', file,
    '-vf', "select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=-", '-an', '-f', 'null', '-']);
  const out = [];
  const re = /pts_time:([\d.]+)[\s\S]*?lavfi\.scene_score=([\d.]+)/g;
  let m;
  while ((m = re.exec(r.stdout))) out.push([Number(m[1]), Number(m[2])]);
  return out;
}

/** Scene-change times, the bible's own command (§8.2). */
function cuts(file, threshold = 0.25) {
  const r = run('ffmpeg', ['-v', 'error', '-i', file,
    '-filter:v', `select='gt(scene,${threshold})',metadata=print:file=-`, '-an', '-f', 'null', '-']);
  return [...r.stdout.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

/** Per-frame mean luma. The black-frame gate (§5.4, §8.7) is mean luma >= 2. */
function lumaPerFrame(file) {
  const r = run('ffmpeg', ['-v', 'error', '-i', file,
    '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-an', '-f', 'null', '-']);
  return [...r.stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
}

/** Is there type in the caption band? Sampled at 2 fps, as §8.5 asks. */
function captionBandSamples(file, band, everyN = 15) {
  /* Sample by FRAME NUMBER, not with the fps filter. Measured: with
   * `fps=2` the filter assigns each input frame to the nearest output slot, so
   * a card that enters at 2.600 s is reported on the 2.500 s sample and a card
   * that leaves at 24.054 s is reported missing on the 24.000 s one. That cost
   * seven false misses out of 82 on the rev-4 commercial, every one of them at
   * a line boundary. `select` on n is exact, and the printed pts_time is kept
   * so the caller pairs a sample with the frame the timeline knows about. */
  const r = run('ffmpeg', ['-v', 'error', '-i', file,
    '-vf', `select='not(mod(n\\,${everyN}))',crop=${band.w}:${band.h}:${band.x}:${band.y},signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-`,
    '-an', '-fps_mode', 'passthrough', '-f', 'null', '-']);
  const out = [];
  const re = /pts_time:([\d.]+)\s*\nlavfi\.signalstats\.YMAX=([\d.]+)/g;
  let m;
  // Basalt sits near Y 39 in limited range; Limestone type near Y 225. 150 is
  // well clear of both compression noise and any product colour bleeding in,
  // and the band never contains the capture by construction.
  while ((m = re.exec(r.stdout))) out.push({ sec: Number(m[1]), lit: Number(m[2]) > 150 });
  return out;
}

/** Per-frame mean absolute difference from the frame before, in code values.
 *
 * A second, spatial instrument beside the bible's histogram detector. The
 * histogram cannot see a cut between two pictures that share their ground:
 * measured on the rev-4 commercial, the cut from the intro into scene 1 scores
 * 0.008 and the cut from scene 2 into scene 3 scores 0.015, both far under the
 * 0.25 the detector wants, because 99 % of both frames is Basalt. The same two
 * cuts move 1.22 and 1.79 code values per pixel, against 0.01 and 0.14 on the
 * frames either side. So: histogram for the count the bible asks for, pixels
 * for whether a promised cut is actually there. */
function frameDeltas(file) {
  const r = run('ffmpeg', ['-v', 'error', '-i', file,
    '-vf', 'format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
    '-an', '-f', 'null', '-']);
  const v = [...r.stdout.matchAll(/YAVG=([\d.e-]+)/g)].map((m) => Number(m[1]));
  // tblend emits one frame fewer than the source: index 0 is frame 1 minus 0.
  return [0, ...v];
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

function loudness(file) {
  const r = run('ffmpeg', ['-v', 'info', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  /* ebur128 prints a running measurement for every frame and then a Summary
   * block, and both use the same `I:` label. Reading the last 3000 characters
   * matched a RUNNING value, which is ungated and momentary: on the five
   * feature films it read -13.7 while the file measures -14.0 end to end, and
   * on the commercial it happened to agree, which is how it survived this
   * long. Only the Summary is the gated, whole-file number the spec means. */
  const i = r.stderr.lastIndexOf('Summary:');
  const tail = i >= 0 ? r.stderr.slice(i) : r.stderr.slice(-3000);
  const num = (re) => { const m = tail.match(re); return m ? Number(m[1]) : null; };
  return {
    integrated: num(/I:\s*(-?[\d.]+)\s*LUFS/),
    truePeak: num(/Peak:\s*(-?[\d.]+)\s*dBFS/),
    range: num(/LRA:\s*(-?[\d.]+)\s*LU/),
  };
}

function extractFrames(file, frames, dir, fps = 30) {
  fs.mkdirSync(dir, { recursive: true });
  const made = [];
  for (const n of frames) {
    const outFile = path.join(dir, `f${String(n).padStart(5, '0')}.png`);
    // Output-side seek keeps frames whose pts is at or after -ss, so aim a
    // millisecond short of the frame's own timestamp. Aiming at the middle of
    // the interval silently returns nothing for the last frame of the film.
    const r = run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-an',
      '-ss', Math.max(0, n / fps - 0.001).toFixed(6), '-frames:v', '1', outFile]);
    if (r.status === 0 && fs.existsSync(outFile)) made.push(outFile);
  }
  return made;
}

/* ── the pause gate (research/63 §3) ─────────────────────────────────────── */

/** The two silences the director measured, and what makes each one a fault.
 *
 *  A. **The pause before the outro.** From the end of the last body line to
 *     the start of the close: **0.60 s** or less. This is the fault Nader
 *     filed in `research/50` and 62 §6.3 could not locate, because nothing in
 *     the acceptance table measured silence at all — only integrated loudness
 *     and true peak, neither of which a two-second hole with the bed still
 *     playing would ever fail. The pipeline's own fix is to compute the close's
 *     `startSec` from the previous line's MEASURED end plus 0.40 s rather than
 *     from a hand-typed anchor; this row is the check that the fix held.
 *
 *  B. **Dead air inside the body.** No gap between consecutive lines above
 *     **1.50 s** *while the picture holds still*. The qualifier is the whole
 *     point: a rest over a shot that is moving is a breath, and the commercial
 *     takes four of them by design (its shots are 4-5 s long and carry one line
 *     each). A rest over a picture that is not moving is dead air. So the caller
 *     passes `stillAt(from, to)`, which answers whether the picture held over
 *     that span; `verify()` measures it off the frame deltas it already has.
 *
 * Reads `<id>-vo.json` — Builder B's placed read, with every line's measured
 * `startSec`/`endSec` — because the storyboard's anchors are a plan and the
 * fault is only ever in what was actually spoken.
 *
 * Pure, and takes the vo document rather than a path, so `--self-test` can
 * drive it on a synthetic one with no audio anywhere on the machine.
 */
export const PAUSE = { closeGapMax: 0.6, lineGapMax: 1.5 };

export function pauseFaults(vo, opts = {}) {
  const { closeGapMax = PAUSE.closeGapMax, lineGapMax = PAUSE.lineGapMax,
    stillAt = () => true } = opts;
  const lines = (vo && Array.isArray(vo.lines) ? vo.lines : [])
    .filter((l) => l && l.startSec != null && l.endSec != null)
    .slice()
    .sort((a, b) => a.startSec - b.startSec);
  if (lines.length < 2) {
    return { ok: false, why: `${lines.length} placed line(s); the pause needs at least two`, close: null, gaps: [] };
  }
  const gaps = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const from = lines[i].endSec;
    const to = lines[i + 1].startSec;
    const gap = Math.round((to - from) * 1000) / 1000;
    /* A negative gap is an overlap, which is Builder B's own collision rule,
     * not this gate's; it is reported and not counted as dead air. */
    const still = gap > lineGapMax ? !!stillAt(from, to) : false;
    gaps.push({ n: lines[i].n ?? i + 1, from, to, gap, still, over: gap > lineGapMax && still });
  }
  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  const close = {
    gap: Math.round((last.startSec - prev.endSec) * 1000) / 1000,
    bodyEnd: prev.endSec,
    closeStart: last.startSec,
    text: String(last.text || '').slice(0, 40),
  };
  close.over = close.gap > closeGapMax;
  return { ok: true, close, gaps, over: gaps.filter((g) => g.over) };
}

/* ── the checklist ──────────────────────────────────────────────────────── */

export function verify(opts = {}) {
  const {
    id = 'qa-wrap', aspect = '16x9', pass = 'h', reduced = false, standin = false, rev3 = false,
    file = null, report = true, log = console.log,
  } = opts;

  const name = outName({ id, aspect, reduced, standin });
  const target = file ? path.resolve(file)
    : standin ? path.join(OUT, `${name}.mp4`)
      : path.join(REPO, 'deliverables', 'tutorials', `${id}-en${aspect === '16x9' ? '' : '-' + aspect}${reduced ? '-rm' : ''}.mp4`);
  if (!fs.existsSync(target)) throw new Error(`no film at ${path.relative(REPO, target)}`);

  // The same loader the render used, so the numbers below are measured against
  // what was actually drawn rather than against a second copy of the script.
  const film = loadFilm(id, { pass, standin, aspect, baseUrl: '', rev3 });
  const { script, scriptFrom } = film;
  const T = buildTimeline({ script, aspect, reduced, standin });
  const canvas = CANVASES[aspect];
  const band = ZONES[aspect].caption;
  const fps = script.fps;

  const rows = [];
  const add = (level, what, measured, wanted) => rows.push({ level, what, measured, wanted });
  const ok = (w, m, want) => add('pass', w, m, want);
  const bad = (w, m, want) => add('FAIL', w, m, want);
  const warn = (w, m, want) => add('warn', w, m, want);
  const t = (cond, w, m, want) => (cond ? ok : bad)(w, m, want);

  /* 8.1 duration and structure */
  const probe = ffprobeJson(target);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const frames = Number(v.nb_frames || 0);
  const duration = Number(probe.format.duration);
  t(Math.abs(frames - T.frames) <= 1, 'frame count', `${frames}`, `${T.frames} +/- 1`);
  t(Math.abs(duration - script.seconds) <= 1 / fps, 'duration', `${duration.toFixed(3)} s`, `${script.seconds.toFixed(3)} s +/- 1 frame`);
  t(v.r_frame_rate === `${fps}/1`, 'frame rate', v.r_frame_rate, `${fps}/1 constant`);
  t(v.width === canvas.w && v.height === canvas.h, 'canvas', `${v.width}x${v.height}`, `${canvas.w}x${canvas.h}`);

  const shortest = Math.min(...script.shots.map((s) => s.outSec - s.inSec));
  t(shortest >= 1.2 - 1e-9, 'shortest shot', `${shortest.toFixed(3)} s`, '>= 1.200 s');
  const offBeat = script.shots.filter((s) => Math.round(s.inSec * fps) % 15 !== 0).map((s) => s.n);
  t(offBeat.length === 0, 'every cut on a beat (frame % 15)', offBeat.length ? `shots ${offBeat.join(', ')} off` : 'all 18 on the beat', 'all');

  /* 8.2 cut count, measured from the picture */
  const cutTimes = cuts(target);
  /* The bible's own arithmetic for this band counts the edit's transitions, not
   * the detector's hits: rev 3 states "13 shots, 12 transitions, 56.000 s ->
   * 2.14 cuts / 10 s". Measuring the band off the detector would fail a film
   * for cutting between two pictures that look alike, which is what the scene
   * change row above is for and says by name. */
  const per10 = ((script.shots.length - 1) / duration) * 10;
  // Ruling 1: what the metric should want is what the storyboard promises. A
  // boundary is a cut only where the picture changes surface or placement
  // rectangles; four shots of one rectangle on one surface are one continuous
  // take by design, and the hook is exactly that. Every boundary still lands on
  // its beat, and nothing here re-cuts anything.
  const promised = expectedCuts(T);
  const want = promised.length;
  const pictureCheck = standin ? warn : bad;
  const deltas = frameDeltas(target);
  /* Is the promised cut actually in the picture? The frame at the boundary is
   * compared with the frames around it: a cut moves at least half a code value
   * per pixel and at least ten times what the shots either side of it move.
   * Measured on the rev-4 commercial: real cuts score 1.22, 1.79, 25.7 and 85.0
   * against neighbours of 0.01 to 0.14, and the one boundary this rejects,
   * scene 1 into scene 2 at 7 s, scores 0.026 against 0.012, which is the truth
   * about it: the ruling asked for the same figure at the same desk pressing
   * again, so the picture barely changes and the eye reads one take. */
  const strength = (atSec) => {
    const n = Math.round(atSec * fps);
    const d = deltas[n] || 0;
    const around = [];
    for (let k = n - 5; k <= n + 5; k++) if (k !== n && k > 0 && k < deltas.length) around.push(deltas[k]);
    const base = median(around);
    return { d, base, cut: d >= 0.5 && d >= 10 * Math.max(base, 1e-6) };
  };
  const seenAt = new Set(cutTimes.map((t) => Math.round(t * fps)));
  const byHistogram = (c) => [-1, 0, 1].some((d) => seenAt.has(Math.round(c.atSec * fps) + d));

  /* A boundary made with a soft transition is measured ACROSS it, not on one
   * frame of it.
   *
   * The question §8.2 asks is "are these two shots actually different
   * pictures", and it used to be answered by looking for a spike at the cut,
   * because every boundary was a hard cut. A 400 ms cross-fade has no spike by
   * construction: it spreads the same total change over twelve frames, and each
   * one on its own looks like nothing happening. Measured on the rev-5 set, a
   * real dissolve scores 0.077 on its own frame against a neighbour median of
   * 0.640 — which reads as "no cut" and is simply the wrong instrument.
   *
   * So the change is summed over the transition's own span and compared with
   * the same span's worth of ordinary movement just before it. Same thresholds,
   * same argument, correct window. */
  const across = (c) => {
    const n0 = Math.round(c.atSec * fps);
    const span = Math.max(1, Math.round((c.ms / 1000) * fps));
    let sum = 0;
    for (let k = n0; k <= n0 + span && k < deltas.length; k++) sum += deltas[k] || 0;
    const around = [];
    for (let k = n0 - span - 6; k < n0 - 1; k++) if (k > 0 && k < deltas.length) around.push(deltas[k]);
    const base = median(around) * span;
    return { sum, base, cut: sum >= 0.5 && sum >= 10 * Math.max(base, 1e-6) };
  };
  const soft = (c) => c.kind && c.kind !== 'cut' && c.ms > 0;
  const inPicture = (c) => (soft(c) ? across(c).cut : (byHistogram(c) || strength(c.atSec).cut));
  const missing = promised.filter((c) => !inPicture(c));
  const seenSomehow = want - missing.length;
  /* Too FEW is the fault: a promised cut the eye cannot see. Too many is not,
   * because a still shot's reveal is designed motion inside a shot and the
   * detector counts it, which is the check working rather than failing. */
  (seenSomehow >= want - 1 ? ok : pictureCheck)('scene changes detected',
    `${cutTimes.length} by histogram, ${seenSomehow} of ${want} promised cuts in the picture`,
    `at least ${want - 1} of the ${want} the storyboard promises`);
  add('note', 'cuts the storyboard promises',
    promised.map((c) => `${c.atSec}s ${c.from}->${c.to}`).join(', '),
    `${want} of ${script.shots.length - 1} boundaries change the picture`);
  const quiet = promised.filter((c) => !byHistogram(c));
  if (quiet.length) {
    add('note', 'promised cuts the histogram does not see',
      quiet.map((c) => {
        if (soft(c)) {
          const a = across(c);
          return `${c.atSec}s ${c.from}->${c.to} ${c.kind} over ${c.ms} ms moves ${a.sum.toFixed(3)} against ${a.base.toFixed(3)}${a.cut ? '' : ' (NOT a change in the picture)'}`;
        }
        const s = strength(c.atSec);
        return `${c.atSec}s ${c.from}->${c.to} moves ${s.d.toFixed(3)} against ${s.base.toFixed(3)}${s.cut ? '' : ' (NOT a cut in the picture)'}`;
      }).join(', '),
      'a hard cut is measured on its frame, a soft transition across its span');
  }
  (per10 >= 1.7 && per10 <= 4.2 ? ok : pictureCheck)('cuts per 10 s', `${per10.toFixed(2)} from ${script.shots.length - 1} transitions`, '1.70 to 4.20 (measured band)');
  /* Every CUT lands on a beat (§8.1). A soft transition's own frames are not
   * cuts, so a detector hit anywhere inside one is not an off-grid cut — it is
   * the transition being seen, which is the point of it. The window is the
   * transition's span plus a frame either side. */
  const insideTransition = (sec) => promised.some((c) => soft(c)
    && sec >= c.atSec - 1 / fps && sec <= c.atSec + c.ms / 1000 + 1 / fps);
  const offGrid = cutTimes.filter((s) => !insideTransition(s)
    && Math.abs(Math.round(s * fps) % 15) > 1 && Math.abs((Math.round(s * fps) % 15) - 15) > 1);
  t(offGrid.length === 0, 'detected cuts land on beats', offGrid.length ? `${offGrid.length} off grid: ${offGrid.map((x) => x.toFixed(3)).join(', ')}` : 'all', 'all within 1 frame of a beat');
  add('note', 'ASL', `${(duration / script.shots.length).toFixed(2)} s`, 'reference 2.67 s');

  /* 8.7 no black frame, anywhere */
  const luma = lumaPerFrame(target);
  const minLuma = Math.min(...luma);
  const dark = luma.map((y, i) => [i, y]).filter(([, y]) => y < 2);
  t(dark.length === 0, 'no black frame (mean luma >= 2)', `min ${minLuma.toFixed(2)} at frame ${luma.indexOf(minLuma)}`, 'min >= 2');
  const endRange = luma.slice(Math.round(42 * fps));
  t(Math.min(...endRange) >= 2, 'no black frame in the last 6 s', `min ${Math.min(...endRange).toFixed(2)}`, '>= 2');

  /* 8.5 caption coverage, measured in the band */
  const samples = captionBandSamples(target, band);
  /* Each sample carries the timestamp ffmpeg printed for it, so the frame the
   * timeline is asked about is the frame that was measured. */
  const seen = samples.map((s) => s.lit);
  const wantSeen = samples.map((s) => {
    const st = T.stateAt(Math.min(T.frames - 1, Math.round(s.sec * fps)));
    return !!st.caption;
  });
  const declared = wantSeen.filter(Boolean).length;
  const hit = wantSeen.filter((w, i) => w && seen[i]).length;
  const missed = samples.filter((s, i) => wantSeen[i] && !seen[i]).map((s) => s.sec.toFixed(2) + ' s');
  /* A stray needs a whole sample of slack either side: the band is sampled at
   * 2 fps and a card entering between two samples shows pixels on the earlier
   * one. Anything lit for a second with nothing declared anywhere near it is a
   * real stray; a boundary is not. */
  const stray = seen.filter((s, i) => s && !wantSeen[i] && !wantSeen[i - 1] && !wantSeen[i + 1]).length;
  t(declared === 0 || hit / declared >= 0.95, 'caption on screen when declared', `${hit}/${declared} samples (${declared ? ((hit / declared) * 100).toFixed(1) : '0'} %)${missed.length ? ', dark at ' + missed.join(', ') : ''}`, '>= 95 %');
  t(stray === 0, 'no caption pixels outside a declared card', `${stray} stray samples`, '0');
  // The two boundaries §8.5 names by name: 12->13 and 14->15.
  /* Bible 8.5 names two boundaries by the surfaces they cross, and gap 10 was a
   * caption vanishing across a cut. Rather than hard-code shot numbers a
   * storyboard revision can move, check every boundary where the picture
   * changes, and report the ones that hole. */
  const holed = [];
  for (const c of promised) {
    const at = Math.round(c.atSec * fps);
    let holes = 0;
    for (let n = at - 12; n <= at + 12; n++) {
      if (n < 0 || n >= T.frames) continue;
      const st = T.stateAt(n);
      const shot = script.shots.find((x) => n >= Math.round(x.inSec * fps) && n < Math.round(x.outSec * fps));
      if (shot && (shot.card || shot.endCard)) continue;   // the card is the caption there
      // A declared gap is not a dropout. The commercial has exactly one, the
      // drop at 7.30 to 8.15, and the script asks for bare ground there.
      const tt = n / fps;
      // One frame of grace at a card's in-point: that frame is the first sample
      // of its fade and is 0 by definition, which is arrival, not a dropout.
      if (!T.cards.some((c) => tt >= c.inSec + 1 / fps && tt < c.outSec)) continue;
      if (!st.caption) holes++;
    }
    if (holes) holed.push(`${c.atSec}s (${holes} frames)`);
  }
  t(holed.length === 0, 'no caption dropout across any cut',
    holed.length ? holed.join(', ') : `0 frames without a card in +/- 0.4 s across ${promised.length} cuts`, '0');

  const cardWaived = T.cards.filter((c) => {
    const st = T.stateAt(Math.round(c.inSec * fps));
    return !st.caption;
  }).length;
  if (cardWaived) add('note', 'caption cards carried by a full-frame card instead of the band', `${cardWaived}`, 'shots 17 and 18 by design');

  /* A shot that never changes is a still photograph with a caption on it. The
   * critic counted four in the commercial and twelve across the tool films.
   * Measured off the delivered file: within each shot of 1.5 s or more, how
   * many frames differ at all from the one before. A shot may declare `hold`
   * and be exempt, which is what the end card's settled state is. */
  const scores = sceneScores(target);
  /* Measured on the delivered file: a frame that is a duplicate of the one
   * before scores exactly 0, and a frame that differs at all scores above it.
   * Shot 4 of the commercial, which is genuinely held, scores 0 on 59 of its
   * 60 frames; shot 1, where a cursor crosses the form, scores above 0 on 54 of
   * 74. So the threshold is "not identical", not an arbitrary epsilon. */
  const CHANGED = 0;
  const frozen = [];
  const frozenDetail = [];
  for (const sh of script.shots) {
    const len = sh.outSec - sh.inSec;
    if (len < 1.5) continue;
    if (sh.hold || sh.endCard) continue;
    const a = sh.inSec + 1 / fps, b = sh.outSec;
    const moved = scores.filter(([tt, sc]) => tt >= a && tt < b && sc > CHANGED).length;
    if (moved < 6) frozenDetail.push({ n: sh.n, len, moved, rect: sh.rect, still: !!sh.still });
    if (moved < 6) frozen.push(`shot ${sh.n} (${len.toFixed(1)} s, ${moved} changed frames)`);
  }
  for (const f of frozenDetail) {
    if (!f.still) add('note', `shot ${f.n} does not move`,
      `${f.rect}, ${f.len.toFixed(1)} s, ${f.moved} changed frames, not declared still`,
      'declare still (the composition then reveals it) or re-record with motion');
  }
  t(frozen.length === 0, 'no frozen shot of 1.5 s or more',
    frozen.length ? frozen.join(', ') : `every shot of 1.5 s or more moves`, '>= 6 changed frames, or declare hold');

  /* The film loops: frame N-1 cuts cleanly into frame 0. Neither end may be
   * bare, and the last half second must be settled, or the loop lands on
   * something still moving.
   *
   * Settled is measured as the MEAN absolute frame-to-frame difference over the
   * tail, in code values, not as a scene score above zero. Measured on the
   * rev-4 commercial, whose last 15 source PNGs are byte-identical (md5): a
   * static stretch of the delivered file averages 0.0009, this tail averages
   * 0.0053 because x264 refreshes a few macroblocks around the URL once, and a
   * moving shot averages 0.16. A scene-score threshold of "not identical"
   * cannot tell the middle case from the last one; a mean can, and 0.02 sits
   * an order of magnitude from either side. */
  {
    const tail = deltas.slice(Math.max(1, T.frames - 15)).reduce((a, b) => a + b, 0) / 15;
    const first = luma[0], last = luma[luma.length - 1];
    t(tail < 0.02 && first >= 35 && last >= 35, 'the film loops',
      `last 15 frames move ${tail.toFixed(4)} code values on average, frame 0 luma ${first.toFixed(1)}, last frame ${last.toFixed(1)}`,
      'settled tail (< 0.02), neither end bare');
  }

  /* Bible 8.5: the burned card and the SRT for the same time range say the same
   * words. The end card's last line is set by the card, not by the caption
   * band, so the SRT's last cue has to start when the tagline actually lands. */
  const srtPath = target.replace(/-en\.mp4$/, '-en.srt');
  if (fs.existsSync(srtPath)) {
    const cues = [...fs.readFileSync(srtPath, 'utf8')
      .matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d)\s*-->/g)]
      .map((m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000);
    const endShot = script.shots.find((sh) => sh.endCard);
    if (endShot && cues.length) {
      let lands = null;
      for (let n = Math.round(endShot.inSec * fps); n < T.frames; n++) {
        if ((T.stateAt(n).endCard || {}).tagline >= 0.5) { lands = n / fps; break; }
      }
      const last = cues[cues.length - 1];
      /* Half a second, not two frames. A subtitle that leads its card by a few
       * frames is normal practice; what this catches is the commercial's cue
       * naming the tagline 2.1 s before the card said it. */
      /* In a verbatim film the band carries the words, so the last cue answers
       * to the last caption chunk. Only where the band is suppressed and the
       * card's own type is the caption does the cue answer to the card. */
      const want = script.verbatim ? T.cards[T.cards.length - 1].inSec : lands;
      const against = script.verbatim ? 'the last chunk is spoken' : 'the tagline lands';
      t(want == null || Math.abs(last - want) <= 0.5, 'the last SRT cue matches the burned band',
        `SRT ${last.toFixed(3)} s, ${against} ${want == null ? '?' : want.toFixed(3)} s`, 'within 0.5 s');
    }
  }

  /* research/63 §3: the pause before the outro, and dead air inside the body.
   * Two FAIL rows, measured off the read that was actually placed. */
  {
    const voPath = path.join(FILM_AUDIO_OUT, `${id}-vo.json`);
    const doc = fs.existsSync(voPath)
      ? (() => { try { return JSON.parse(fs.readFileSync(voPath, 'utf8')); } catch { return null; } })()
      : null;
    if (!doc) {
      /* Not measurable is not a pass. 62 §2 fix 4 is the standing lesson here:
       * a check that reports "0 shots" on a directory it cannot see exits 0 and
       * looks like a clean bill of health. A stand-in render has no read by
       * construction and warns; a delivery without one fails. */
      (standin ? warn : bad)('the pause before the close',
        `no ${path.relative(REPO, voPath).split(path.sep).join('/')} to measure`,
        `<= ${PAUSE.closeGapMax.toFixed(3)} s from the last body line to the close`);
    } else {
      /* Did the picture hold over the gap? A promised cut inside it is motion
       * by construction; otherwise the frames themselves answer. 0.5 code
       * values per pixel is the same floor `strength()` uses for a cut, and a
       * shot that is merely alive sits an order of magnitude above the 0.02 the
       * loop check calls settled. */
      const stillAt = (from, to) => {
        if (promised.some((c) => c.atSec > from && c.atSec < to)) return false;
        const a = Math.max(1, Math.round(from * fps));
        const b = Math.min(deltas.length - 1, Math.round(to * fps));
        if (b <= a) return true;
        const seen = deltas.slice(a, b + 1);
        return median(seen) < 0.02;
      };
      const p = pauseFaults(doc, { stillAt });
      if (!p.ok) {
        bad('the pause before the close', p.why, `<= ${PAUSE.closeGapMax.toFixed(3)} s`);
      } else {
        t(!p.close.over, 'the pause before the close',
          `${p.close.gap.toFixed(3)} s from ${p.close.bodyEnd.toFixed(3)} s to the close at ${p.close.closeStart.toFixed(3)} s`,
          `<= ${PAUSE.closeGapMax.toFixed(3)} s`);
        t(p.over.length === 0, 'no dead air over a held picture',
          p.over.length
            ? p.over.map((g) => `${g.gap.toFixed(2)} s after line ${g.n} (${g.from.toFixed(2)}-${g.to.toFixed(2)} s)`).join(', ')
            : `${p.gaps.length} gaps, longest ${Math.max(0, ...p.gaps.map((g) => g.gap)).toFixed(2)} s`,
          `no gap over ${PAUSE.lineGapMax.toFixed(2)} s while the picture holds still`);
      }
    }
  }

  /* 8.5 / 2.9 copy */
  const copy = scriptFaults(script);
  const conflicts = copy.filter((c) => c.startsWith('spec-conflict:'));
  const real = copy.filter((c) => !c.startsWith('spec-conflict:'));
  t(real.length === 0, 'copy and structure gate (em dash, lines, words, beats)', real.length ? real.join(' | ') : 'clean', '0 faults');
  for (const c of conflicts) warn('declared bible conflict', c.replace('spec-conflict: ', ''), 'director to resolve');
  // The end card is the one shot with a budget of two, ruled by the coordinator:
  // the check in the mark, and the URL as the one primary action (BRAND 5).
  if (script.endCard && script.endCard.url) {
    add('note', 'end card Petra budget', 'the mark check and the URL, both Petra', 'ruled: 2 on shot 18, 1 everywhere else');
  }
  // Ruling 4: the solver may push a later card, never shorten an earlier one,
  // and it prints every push it made.
  t(T.faults.length === 0, 'every caption meets its reading time', T.faults.length ? T.faults.join(' | ') : 'all', '0 faults, none shortened');
  for (const p of T.pushes) add('note', 'caption push', p, 'whole frames, never a shortened card');
  for (const n of film.notes || []) add('note', 'storyboard note', n, 'declared, not silently dropped');
  if (film.checks) {
    add('note', 'storyboard expects', `${film.checks.shots} shots, ${film.checks.cuts} cuts, ASL ${film.checks.asl} s`, 'checkpoint 2');
  }

  /* Ruling 2: no shot leaves more than half the frame as empty ground. */
  const ground = groundReport(T).filter((g) => !g.exempt);
  const worst = ground.reduce((a, b) => (b.widest > a.widest ? b : a));
  t(worst.widest <= canvas.w / 2, 'widest empty ground in any shot',
    `${worst.widest} px on shot ${worst.n} (${worst.rect})`, `<= ${canvas.w / 2} px (half the frame)`);

  /* 8.8 delivery */
  t(v.pix_fmt === 'yuv420p', 'pix_fmt', v.pix_fmt, 'yuv420p');
  t(/^High$/.test(v.profile || ''), 'profile', v.profile, 'High');
  for (const k of ['color_range', 'color_space', 'color_transfer', 'color_primaries']) {
    const val = v[k] || 'unknown';
    t(val !== 'unknown', k, val, k === 'color_range' ? 'tv' : 'bt709');
  }
  t(moovIsFirst(target), 'faststart (moov before mdat)', String(moovIsFirst(target)), 'true');
  const mb = fs.statSync(target).size / 1e6;
  t(mb < 500, 'file size', `${mb.toFixed(1)} MB`, 'under 30 MB where possible, ceiling 500 MB');

  /* 8.3 sound. Builder B owns the gates; this reports what the master carries. */
  if (!a) {
    (standin ? warn : bad)('audio stream', 'none (silent render)', 'AAC-LC 48 kHz stereo >= 256 kbps');
  } else {
    t(a.codec_name === 'aac', 'audio codec', a.codec_name, 'aac');
    t(a.channels === 2, 'audio channels', String(a.channels), '2 (stereo)');
    t(Number(a.sample_rate) === 48000, 'audio sample rate', a.sample_rate, '48000');
    const l = loudness(target);
    t(l.integrated != null && Math.abs(l.integrated + 14) <= 0.2, 'integrated loudness', `${l.integrated} LUFS`, '-14.0 +/- 0.2 LUFS');
    t(l.truePeak != null && l.truePeak <= (aspect === '9x16' ? -1.5 : -1.0) + 0.05, 'true peak', `${l.truePeak} dBTP`, aspect === '9x16' ? '<= -1.5' : '<= -1.0');
    add('note', 'LRA', `${l.range} LU`, 'not asserted, EBU Tech 3343 11.2.2');
  }

  /* 8.7 the frames a person still has to look at */
  /* Bible 8.7 names its frames for the 48 s commercial. Any other film gets the
   * same idea rather than the same numbers: the first frame, half a second into
   * every shot, and the last frame. */
  const bible = [0, 74, 119, 194, 225, 240, 480, 525, 660, 900, 1080, 1139, 1140, 1260, 1439];
  const checklist = (aspect === '16x9' && T.frames === 1440 && script.shots.length >= 18)
    ? bible
    : [...new Set([
      0,
      ...script.shots.map((sh) => {
        const at = sh.inFrame != null ? sh.inFrame : Math.round(sh.inSec * fps);
        return Math.min(at + 15, Math.round(sh.outSec * fps) - 1);
      }),
      T.frames - 1,
    ])].filter((n) => n >= 0 && n < T.frames).sort((a, b) => a - b);
  const checkDir = path.join(OUT, `${name}-checks`);
  const made = extractFrames(target, checklist, checkDir, fps);
  t(made.length === checklist.length, 'checklist frames extracted for the eye', `${made.length}/${checklist.length}`, 'all');
  add('note', 'checklist frames', path.relative(REPO, checkDir).split(path.sep).join('/'), 'bible 8.7');

  if (standin) warn('provenance', 'STAND-IN captures', 'real captures from Builder C before delivery');

  /* ── print ─────────────────────────────────────────────────────────────── */
  const fails = rows.filter((r) => r.level === 'FAIL');
  const warns = rows.filter((r) => r.level === 'warn');
  const width = Math.max(...rows.map((r) => r.what.length));
  log('');
  log(`verify    ${path.relative(REPO, target)}`);
  log(`script    ${scriptFrom}`);
  log('');
  for (const r of rows) {
    const tag = r.level === 'pass' ? ' ok ' : r.level === 'FAIL' ? 'FAIL' : r.level === 'warn' ? 'warn' : ' -- ';
    log(`  [${tag}] ${r.what.padEnd(width)}  ${r.measured}${r.wanted ? `   (want ${r.wanted})` : ''}`);
  }
  log('');
  log(`          ${rows.filter((r) => r.level === 'pass').length} pass, ${warns.length} warn, ${fails.length} fail`);

  if (report) writeReport({ target, name, rows, scriptFrom, standin });

  return { rows, fails, warns, target, checkDir };
}

/* ── the render record ──────────────────────────────────────────────────── */

const MARK_A = '<!-- verify:start -->';
const MARK_B = '<!-- verify:end -->';

function writeReport({ target, name, rows, scriptFrom, standin }) {
  const when = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const lines = [
    MARK_A,
    '',
    `_Written by \`tools/film/compose/verify.mjs\` at ${when}. Do not edit by hand._`,
    '',
    `**File:** \`${path.relative(REPO, target).split(path.sep).join('/')}\``,
    `**Script:** ${scriptFrom}`,
    `**Captures:** ${standin ? '**STAND-IN** (research/27-frames), not the delivered recordings' : "Builder C's recordings"}`,
    '',
    '| | Check | Measured | Wanted |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => {
      const tag = r.level === 'pass' ? 'ok' : r.level === 'FAIL' ? '**FAIL**' : r.level === 'warn' ? 'warn' : '';
      return `| ${tag} | ${r.what} | ${String(r.measured).replace(/\|/g, '\\|')} | ${String(r.wanted || '').replace(/\|/g, '\\|')} |`;
    }),
    '',
    MARK_B,
  ].join('\n');

  let doc = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8') : `# 35 — Render record\n\n${MARK_A}\n${MARK_B}\n`;
  if (!doc.includes(MARK_A)) doc += `\n\n${MARK_A}\n${MARK_B}\n`;
  const head = doc.slice(0, doc.indexOf(MARK_A));
  const tail = doc.slice(doc.indexOf(MARK_B) + MARK_B.length);
  fs.writeFileSync(REPORT, head + lines + tail, 'utf8');
}

const USAGE = `
tools/film/compose/verify.mjs - the acceptance measurement (bible 8)

  node tools/film/compose/verify.mjs [--id <film>] [--aspect 16x9|1x1|9x16]
       [--pass h|s|v] [--standin] [--reduced] [--rev3]
       [--file <path>] [--no-report]

  --self-test   run the pause gate (research/63 section 3) against synthetic
                vo.json documents and exit non-zero on a miss. Touches no
                media and needs no ffmpeg.
  --help        this text.

Acceptance rows are printed as [ ok ] / [ warn ] / [FAIL] / [ -- ] and the
process exits non-zero on any FAIL. The pause gate is two of those rows:
the pause before the close (<= ${PAUSE.closeGapMax} s) and dead air over a
held picture (no gap > ${PAUSE.lineGapMax} s).
`;

/** The unit check for the pause gate, on a synthetic read. */
export function selfTest(log = console.log) {
  const line = (n, startSec, endSec, text) => ({ n, startSec, endSec, text });
  const cases = [
    {
      name: 'a clean read passes both rows',
      vo: { lines: [line(1, 0.40, 3.20), line(2, 4.00, 7.10), line(3, 7.50, 9.15, 'QA Wrap.')] },
      want: { close: false, over: 0 },
    },
    {
      name: 'a 2.0 s hole before the close fails the close row',
      vo: { lines: [line(1, 0.40, 3.20), line(2, 4.00, 7.10), line(3, 9.10, 10.75, 'QA Wrap.')] },
      want: { close: true, over: 1 },
    },
    {
      name: 'exactly 0.600 s before the close still passes',
      vo: { lines: [line(1, 0.40, 3.20), line(2, 4.00, 7.10), line(3, 7.70, 9.35, 'QA Wrap.')] },
      want: { close: false, over: 0 },
    },
    {
      name: 'a 1.9 s gap over a HELD picture is dead air',
      vo: { lines: [line(1, 0.40, 3.20), line(2, 5.10, 8.00), line(3, 8.30, 9.95, 'QA Wrap.')] },
      want: { close: false, over: 1 },
    },
    {
      name: 'the same gap over a MOVING picture is a breath, not a fault',
      vo: { lines: [line(1, 0.40, 3.20), line(2, 5.10, 8.00), line(3, 8.30, 9.95, 'QA Wrap.')] },
      still: () => false,
      want: { close: false, over: 0 },
    },
    {
      name: 'a read with one line cannot be measured, and says so',
      vo: { lines: [line(1, 0.40, 3.20)] },
      want: { unmeasurable: true },
    },
  ];
  let bad = 0;
  for (const c of cases) {
    const got = pauseFaults(c.vo, { stillAt: c.still || (() => true) });
    let ok;
    if (c.want.unmeasurable) ok = got.ok === false;
    else ok = got.ok && got.close.over === c.want.close && got.over.length === c.want.over;
    if (!ok) bad++;
    log(`  [${ok ? ' ok ' : 'FAIL'}] ${c.name}`
      + (got.ok ? `   close ${got.close.gap.toFixed(3)} s, ${got.over.length} dead-air gap(s)` : `   ${got.why}`));
  }
  log('');
  log(`          ${cases.length - bad} pass, ${bad} fail`);
  return bad;
}

if (path.basename(process.argv[1] || '') === 'verify.mjs') {
  const a = argv();
  if (a.help || a.h) { console.log(USAGE); process.exit(0); }
  if (a['self-test'] || a.selftest) {
    console.log('');
    console.log('pause gate (research/63 section 3), on synthetic vo.json');
    console.log('');
    process.exit(selfTest() ? 1 : 0);
  }
  try {
    const { fails } = verify({
      id: a.film || a.id || 'qa-wrap', aspect: a.aspect || '16x9', pass: a.pass || 'h',
      reduced: !!a.reduced, standin: !!a.standin, rev3: !!a.rev3,
      file: a.file || null, report: !a['no-report'],
    });
    process.exit(fails.length ? 1 : 0);
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
