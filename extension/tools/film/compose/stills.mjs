#!/usr/bin/env node
/**
 * The frames a director looks at, pulled from the delivered file.
 *
 *   node tools/film/compose/proof-frames.mjs --film tool-check-the-links
 *   node tools/film/compose/proof-frames.mjs --film record-a-session --out research/43-frames
 *
 * Two sets, both written as PNGs at the master's own 1920 x 1080:
 *
 *   poster/<id>-f00000.png            frame 0, which is the poster card and is
 *                                     also the thumbnail every listing shows.
 *   transitions/<id>-<n>-<kind>-*.png three frames around every cut: the last
 *                                     frame of the shot before, the midpoint of
 *                                     the transition, and the frame it lands on.
 *
 * Why from the mp4 and not from `work/film/out`: the composed PNGs are the
 * 3840 x 2160 supersample, and what a viewer sees is what came out of x264 at
 * half that. A transition judged on the supersample is a transition judged on a
 * picture nobody is shown.
 *
 * A hard cut has no midpoint. It gets the frame before, the frame it cuts to,
 * and the one after, which is the only honest way to photograph nothing
 * happening between two pictures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, loadFilm } from './frames.mjs';
import { buildTimeline } from './timeline.mjs';
import { run } from './encode.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '../../..');
const REPO = path.resolve(EXT, '..');

/** One frame of `file`, by frame number, at the container's own size. */
function grab(file, n, fps, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  /* `select` on the frame number, not `-ss` on a time: seeking by time lands on
   * the nearest keyframe and then decodes forward, and the frame either side of
   * a cut is exactly where that goes wrong. */
  run('ffmpeg', ['-y', '-v', 'error', '-i', file,
    '-vf', `select='eq(n\\,${n})'`, '-fps_mode', 'passthrough', '-frames:v', '1', out]);
  return fs.existsSync(out);
}

const a = argv();
const id = a.film || a.id || 'qa-wrap';
const outRoot = path.resolve(REPO, a.out || path.join('research', '43-frames'));
const file = path.join(REPO, 'deliverables', 'tutorials', `${id}-en.mp4`);
if (!fs.existsSync(file)) throw new Error(`no film at ${path.relative(REPO, file)}`);

const film = loadFilm(id, { pass: 'h', baseUrl: '' });
const T = buildTimeline({ script: film.script, aspect: '16x9' });
const fps = T.fps;
const written = [];

/* ── the poster frame ───────────────────────────────────────────────────── */
const posterOut = path.join(outRoot, 'poster', `${id}-f00000.png`);
if (grab(file, 0, fps, posterOut)) written.push(posterOut);

/* ── three frames around every cut ──────────────────────────────────────── */
for (let i = 1; i < T.shots.length; i++) {
  const shot = T.shots[i];
  const tr = shot.transition || { kind: 'cut', ms: 0 };
  const at = Math.round(shot.inSec * fps);
  const span = Math.round((tr.ms / 1000) * fps);
  const marks = [
    ['before', at - 1],
    ['mid', tr.ms > 0 ? at + Math.max(1, Math.round(span / 2)) : at],
    ['after', tr.ms > 0 ? at + span : at + 1],
  ];
  const label = tr.kind + (tr.from ? `-${tr.from}` : '');
  for (const [which, n] of marks) {
    if (n < 0 || n >= T.frames) continue;
    const out = path.join(outRoot, 'transitions',
      `${id}-cut${String(shot.n).padStart(2, '0')}-${label}-${which}-f${String(n).padStart(5, '0')}.png`);
    if (grab(file, n, fps, out)) written.push(out);
  }
  console.log(`  cut into shot ${shot.n} at ${shot.inSec.toFixed(3)} s: ${label}`
    + `${tr.ms ? ` over ${tr.ms} ms` : ' on the beat'} — ${tr.why || ''}`);
}

console.log(`\nwrote ${written.length} frame(s) under ${path.relative(REPO, outRoot)}`);
