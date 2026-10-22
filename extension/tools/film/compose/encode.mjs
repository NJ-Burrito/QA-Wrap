/* QA Wrap — film composition. Builder A. Frames to master.
 *
 * Checkpoint 4 -> checkpoint 5. Reads `work/film/out/<name>/f%05d.png` and
 * Builder B's `work/film/audio/out/<id>.master.m4a` when it exists, and writes
 * the mp4. Both roots come from tools/lib-paths.mjs; they used to sit inside
 * the extension folder, where Chrome counted them.
 *
 * Usage
 *   node tools/film/compose/encode.mjs [--id qa-wrap] [--aspect 16x9|1x1|9x16]
 *        [--standin] [--reduced] [--out <path>] [--crf 16]
 *
 * The encode is the bible's §7.3 command, unchanged, with one addition: the
 * frames are a supersample when the composition was captured at dsf 2, so the
 * same `zscale` that does the range and matrix conversion also does the one
 * downscale to the master canvas. One resample, in one filter, at encode.
 *
 * ffmpeg is invoked as an argv array, never as an interpolated shell string:
 * every caption in this pipeline is authored text and some of it will one day
 * contain a quote.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { argv, outName, loadFilm } from './frames.mjs';
import { CANVASES, buildTimeline } from './timeline.mjs';
import { FILM_OUT, FILM_AUDIO_OUT } from '../../lib-paths.mjs';


const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '../../..');
const REPO = path.resolve(EXT, '..');
const FILM = path.join(EXT, 'tools', 'film');
const OUT = FILM_OUT;

export function run(bin, args, { capture = true } = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: capture ? 'pipe' : 'inherit' });
  if (r.error) throw new Error(`${bin} did not run: ${r.error.message}`);
  return r;
}

export function ffprobeJson(file) {
  const r = run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** moov before mdat, i.e. -movflags +faststart actually took. */
export function moovIsFirst(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(Math.min(1 << 20, fs.statSync(file).size));
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const moov = buf.indexOf('moov'), mdat = buf.indexOf('mdat');
  return moov !== -1 && (mdat === -1 || moov < mdat);
}

function pngSize(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(33);
  fs.readSync(fd, b, 0, 33, 0);
  fs.closeSync(fd);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`;
};

/**
 * Re-time the subtitles from the timeline that drew the picture.
 *
 * The words are the storyboard's and stay exactly as written; only the times
 * are rewritten, from the same solved caption cards the composition burned in.
 * Three things had drifted: the two gap-holds, where a card is held until the
 * next one is up so the band never goes bare, and the end-card cue, whose line
 * is set by the card rather than by the band and therefore lands when the
 * tagline lands. A subtitle that names a line the frame is not showing is worse
 * than no subtitle, and bible 8.5 asks for the two to agree.
 */
function retimeSrt(target, script, T, log) {
  const srtPath = target.replace(/-en\.mp4$/, '-en.srt');
  if (!fs.existsSync(srtPath)) return null;
  const NL = String.fromCharCode(10);
  const raw = fs.readFileSync(srtPath, 'utf8').split(String.fromCharCode(13)).join('').trim();
  const blocks = raw.split(NL + NL).map((b) => b.trim()).filter(Boolean);
  /* A verbatim film's subtitles ARE the caption array: same words, same times,
   * one cue per chunk. When the counts disagree the file on disk is the older
   * shape (Builder C's manifest writes one cue per storyboard span), so it is
   * regenerated rather than patched. For a written-card film the words are the
   * storyboard's and only the times are rewritten, so a count mismatch there is
   * a real disagreement and the file is left alone. */
  const verbatim = !!script.verbatim;
  if (blocks.length !== T.cards.length && !verbatim) {
    log(`          srt   left alone: ${blocks.length} cues against ${T.cards.length} caption cards`);
    return null;
  }
  /* A verbatim film's cues are ALWAYS regenerated, not only when the counts
   * disagree. The count matching proves nothing about the words: the 3.1.0
   * commercial shipped 13 cues against 13 cards whose wording had moved on a
   * revision, so the file was "re-timed" and kept four lines the picture no
   * longer said (research/78 §1.2). For a verbatim film the cards are the
   * subtitles, so the cards are what gets written. */
  const regenerate = verbatim || blocks.length !== T.cards.length;
  // The end card's line is carried by the card, so its cue starts when the
  // tagline lands rather than when the shot cuts.
  const endShot = script.shots.find((sh) => sh.endCard);
  let landed = null;
  if (endShot) {
    for (let n = Math.round(endShot.inSec * T.fps); n < T.frames; n++) {
      if ((T.stateAt(n).endCard || {}).tagline >= 0.5) { landed = n / T.fps; break; }
    }
  }
  /* Each cue is timed to the frames the band actually lit that card, not to
   * the solved schedule. The two differ wherever a shot suppresses the band
   * because its own type carries the words, which is how card 16 came to claim
   * 44.167 while the last lit frame was 43.967. */
  const lit = (n, text) => {
    const st = T.stateAt(n);
    const on = (c) => c && c.text === text && c.opacity > 0.01;
    return on(st.caption) || on(st.captionOut);
  };
  let moved = 0;
  const source = regenerate ? T.cards.map(() => '') : blocks;
  const out = source.map((b, i) => {
    const lines = b.split(NL);
    const card = T.cards[i];
    const text = regenerate ? (card.srt || card.text) : lines.slice(2).join(NL);
    const last = i === T.cards.length - 1;
    let from = card.inSec, to = card.outSec;
    /* Verbatim cues are the chunk's own times: they already run from one
     * chunk's first word to the next chunk's, so they never overlap. The
     * lit-frame scan below is for written cards, where the band is suppressed
     * on a shot whose own type carries the words and the schedule and the burn
     * therefore differ. Running it on a cross-fading verbatim band would
     * overlap every cue by the 110 ms the two layers share. */
    if (verbatim) {
      // nothing to do: from and to are already the chunk's
    } else if (last && landed != null) {
      from = landed;
    } else {
      let first = null, final = null;
      const a = Math.max(0, Math.round(card.inSec * T.fps) - 2);
      const b2 = Math.min(T.frames - 1, Math.round(card.outSec * T.fps) + 6);
      for (let n = a; n <= b2; n++) {
        if (!lit(n, card.text)) continue;
        if (first == null) first = n;
        final = n;
      }
      if (first != null) { from = first / T.fps; to = (final + 1) / T.fps; }
    }
    const now = `${stamp(from)} --> ${stamp(to)}`;
    if (regenerate || lines[1] !== now) moved++;
    return `${i + 1}${NL}${now}${NL}${text}`;
  });
  fs.writeFileSync(srtPath, out.join(NL + NL) + NL, 'utf8');
  log(`          srt   ${path.relative(REPO, srtPath)}, ${regenerate ? `regenerated as ${out.length} cues from the read` : `${moved} of ${blocks.length} cues re-timed`} from the timeline`);
  return { path: srtPath, moved, cues: out.length, regenerated: regenerate };
}

/** Where a hosted film and its poster live: a folder a web server can serve. */
const ONLINE = path.join(REPO, 'site', 'tutorials');

/**
 * Is this film hosted rather than packaged?
 *
 * `tutorials/lessons.json` is the answer, because it is the file
 * `release-check.mjs` reads to decide the same question. Falling back to the id
 * keeps a film that is not in the manifest yet out of the package, which is the
 * safe direction: a hosted film that creeps into the zip fails the gate, while
 * a packaged one that goes missing only fails the page.
 */
function hostedFilm(id) {
  try {
    const lessons = JSON.parse(fs.readFileSync(path.join(EXT, 'tutorials', 'lessons.json'), 'utf8'));
    const l = lessons.find((x) => x.id === id);
    if (l) return !!l.online;
  } catch { /* no manifest yet */ }
  return id.startsWith('tool-');
}

export function encode(opts = {}) {
  const {
    id = 'qa-wrap', aspect = '16x9', reduced = false, standin = false,
    crf = 16, fps = 30, out = null, srtOnly = false, remux = false, rev3 = false, log = console.log,
  } = opts;

  const name = outName({ id, aspect, reduced, standin });
  const dir = path.join(OUT, name);
  if (!fs.existsSync(dir)) throw new Error(`no frames at ${path.relative(REPO, dir)}. Run frames.mjs first.`);

  const canvas = CANVASES[aspect];
  const first = path.join(dir, 'f00000.png');
  const src = pngSize(first);
  const supersample = src.w / canvas.w;
  if (![1, 2].includes(supersample) || src.w / canvas.w !== src.h / canvas.h) {
    throw new Error(`frames are ${src.w}x${src.h}, which is not 1x or 2x the ${aspect} canvas ${canvas.w}x${canvas.h}`);
  }

  const audio = path.join(FILM_AUDIO_OUT, `${id}.master.m4a`);
  const hasAudio = fs.existsSync(audio);
  // The picture defines the length. `-t` rather than `-shortest`, so an audio
  // master that is a few samples short cannot cost the film a frame.
  const nFrames = fs.readdirSync(dir).filter((f) => /^f\d{5}\.png$/.test(f)).length;

  /* A stand-in render is not a deliverable and cannot be filed as one. */
  const suffix = [aspect === '16x9' ? null : aspect, reduced ? 'rm' : null].filter(Boolean).join('-');
  const target = out
    ? path.resolve(out)
    : standin
      ? path.join(OUT, `${name}.mp4`)
      : path.join(REPO, 'work', 'film-masters', `${id}-en${suffix ? '-' + suffix : ''}.mp4`);
  if (standin && /film-masters/.test(target)) {
    throw new Error('a stand-in render may not be written into work/film-masters/. Record the real captures first.');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // The one filter chain: downscale the supersample if there is one, then the
  // range and matrix conversion, then 4:2:0. R1 §4.1.
  const vf = [
    supersample === 1
      ? 'zscale=rangein=full:range=limited:matrixin=709:matrix=709'
      : `zscale=w=${canvas.w}:h=${canvas.h}:filter=lanczos:rangein=full:range=limited:matrixin=709:matrix=709`,
    'format=yuv420p',
  ].join(',');

  const args = [
    // Quiet: ffmpeg's live progress is tens of thousands of carriage-returned
    // bytes on a 1440 frame encode, and it buys nothing in a captured pipe.
    '-y', '-nostats', '-loglevel', 'error',
    '-framerate', String(fps), '-i', path.join(dir, 'f%05d.png'),
    ...(hasAudio ? ['-i', audio] : []),
    '-vf', vf,
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0',
    '-crf', String(crf), '-preset', 'slow',
    '-g', String(fps * 2), '-keyint_min', String(fps * 2),
    // x264 writes its own VUI. Without these three the container says bt709 and
    // the bitstream says unknown, which is the defect in all six old masters.
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv:bframes=2:cabac=1',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-r', String(fps),
    '-t', (nFrames / fps).toFixed(6),
    ...(hasAudio ? ['-c:a', 'copy'] : ['-an']),
    '-movflags', '+faststart',
    target,
  ];

  /* --remux swaps the audio and nothing else.
   *
   * A re-master changes the sound, not a single pixel, so re-encoding 1680
   * frames to carry it would be half a minute of work to arrive at the same
   * picture, and a second encode is a second chance to differ. The video
   * bitstream is copied through untouched; the four colour fields are re-stated
   * because a container carries them beside the stream, and the result is
   * verified like any other master. */
  if (remux) {
    if (!fs.existsSync(target)) throw new Error(`no film to re-mux at ${path.relative(REPO, target)}`);
    if (!hasAudio) throw new Error(`no master at ${path.relative(REPO, audio)}`);
    const before = ffprobeJson(target);
    const bv = before.streams.find((x) => x.codec_type === 'video');
    const tmp = `${target}.remux.mp4`;
    const args = [
      '-y', '-nostats', '-loglevel', 'error',
      '-i', target, '-i', audio,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'copy',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart',
      tmp,
    ];
    log(`remux     ${path.relative(REPO, target)}  +  ${path.relative(REPO, audio)}`);
    const r = run('ffmpeg', args);
    if (r.status !== 0) {
      fs.rmSync(tmp, { force: true });
      throw new Error('ffmpeg failed: ' + r.stderr.split(String.fromCharCode(10)).slice(-15).join(' | '));
    }
    fs.renameSync(tmp, target);
    const after = ffprobeJson(target);
    const av = after.streams.find((x) => x.codec_type === 'video');
    const aa = after.streams.find((x) => x.codec_type === 'audio');
    const same = av.nb_frames === bv.nb_frames && av.width === bv.width && av.height === bv.height
      && av.pix_fmt === bv.pix_fmt && av.profile === bv.profile;
    if (!same) throw new Error('the re-mux changed the video stream, which it must not');
    const shippedTo = path.join(EXT, 'tutorials', 'media', path.basename(target));
    fs.mkdirSync(path.dirname(shippedTo), { recursive: true });
    fs.copyFileSync(target, shippedTo);
    log(`          ${(fs.statSync(target).size / 1e6).toFixed(1)} MB, ${av.nb_frames} frames, picture untouched, `
      + `audio ${aa.codec_name} ${aa.channels}ch ${aa.sample_rate} ${Math.round(Number(aa.bit_rate) / 1000)} kbps`);
    log(`          also  ${path.relative(REPO, shippedTo)}`);
    return { target, remuxed: true, frames: Number(av.nb_frames), shipped: shippedTo };
  }

  /* --srt-only re-times the subtitles against the timeline without touching the
   * picture. It exists because the posters are regenerated by Builder C's
   * manifest, which rewrites the .srt from the storyboard spans and so undoes
   * the gap holds; running this after it costs a second instead of an encode. */
  if (srtOnly) {
    if (!fs.existsSync(target)) throw new Error(`no film at ${path.relative(REPO, target)}`);
    const film = loadFilm(id, { pass: 'h', baseUrl: '', standin, rev3 });
    const T = buildTimeline({ script: film.script, aspect, reduced, standin });
    const r = retimeSrt(target, film.script, T, log);
    return { target, srt: r, srtOnly: true };
  }

  log(`encode    ${path.relative(REPO, dir)}  ->  ${path.relative(REPO, target)}`);
  log(`          ${canvas.w}x${canvas.h}, ${fps} fps, crf ${crf}, supersample ${supersample}x, audio ${hasAudio ? path.relative(REPO, audio) : 'NONE (silent)'}`);
  const t0 = Date.now();
  const r = run('ffmpeg', args);
  if (r.status !== 0) throw new Error(`ffmpeg failed:\n${r.stderr.split('\n').slice(-25).join('\n')}`);
  const ms = Date.now() - t0;

  const probe = ffprobeJson(target);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const colour = {
    color_range: v.color_range || 'unknown',
    color_space: v.color_space || 'unknown',
    color_transfer: v.color_transfer || 'unknown',
    color_primaries: v.color_primaries || 'unknown',
  };
  const bad = Object.entries(colour).filter(([, val]) => val === 'unknown').map(([k]) => k);
  if (bad.length) throw new Error(`ffprobe reads ${bad.join(', ')} as unknown. That is the defect this pipeline exists to stop.`);

  const result = {
    target, ms, bytes: fs.statSync(target).size,
    canvas, fps: v.r_frame_rate, pix_fmt: v.pix_fmt, profile: v.profile,
    frames: Number(v.nb_frames || 0), duration: Number(probe.format.duration),
    colour, faststart: moovIsFirst(target),
    audio: a ? { codec: a.codec_name, channels: a.channels, rate: a.sample_rate, bitrate: a.bit_rate } : null,
    silent: !hasAudio, standin,
  };
  /* Two homes, and they are read by two different things.
   *
   * `deliverables/tutorials/` is the presentation kit: the contact sheet, the
   * index page, the SRTs, everything a person is handed. `extension/tutorials/
   * media/` is what the extension packages and what its own films page plays,
   * and `tools/release-check.mjs` (§4c) requires every file there to be named
   * by `tutorials/lessons.json` and every named file to be present. A master
   * that lands in one and not the other either ships stale or fails the gate,
   * which is exactly what happened: the five old films sat in media/ for a day
   * after the new ones were cut. So the encode writes both, from the same
   * bytes, in one step. */
  /* The subtitles, re-timed from the same timeline that drew the frames. */
  if (!standin) {
    try {
      const film = loadFilm(id, { pass: 'h', baseUrl: '', standin, rev3 });
      const T = buildTimeline({ script: film.script, aspect, reduced, standin });
      result.srt = retimeSrt(target, film.script, T, log);
    } catch (e) { log(`          srt   not re-timed: ${String(e.message || e)}`); }
  }

  /* ...and which second home depends on whether the film ships.
   *
   * Sixteen of the twenty-two are hosted rather than packaged: they were
   * twenty-one megabytes of a thirty-three megabyte download, and
   * `release-check.mjs` §4c fails the build if one of them turns up inside
   * `tutorials/media/`. This step used to copy every film there and the sixteen
   * were carried back out by hand afterwards, which is a gate that passes
   * because somebody remembered. The manifest already records which is which,
   * so the copy reads it instead of guessing. */
  if (!standin) {
    const shipped = path.join(ONLINE, path.basename(target));
    fs.mkdirSync(path.dirname(shipped), { recursive: true });
    fs.copyFileSync(target, shipped);
    result.shipped = shipped;
    log(`          also  ${path.relative(REPO, shipped)}`);
  }

  log(`          ${(result.bytes / 1e6).toFixed(1)} MB, ${result.frames} frames, ${result.duration.toFixed(3)} s, `
    + `${result.pix_fmt}/${result.profile}, ${Object.values(colour).join(' ')}, faststart ${result.faststart}, in ${(ms / 1000).toFixed(1)} s`);
  return result;
}

if (path.basename(process.argv[1] || '') === 'encode.mjs') {
  const a = argv();
  try {
    encode({
      id: a.film || a.id || 'qa-wrap', aspect: a.aspect || '16x9',
      reduced: !!a.reduced, standin: !!a.standin, rev3: !!a.rev3,
      crf: a.crf ? Number(a.crf) : 16, out: a.out || null,
      srtOnly: !!a['srt-only'], remux: !!a.remux,
    });
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
