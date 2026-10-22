#!/usr/bin/env node
/**
 * The mix and the master.  Builder B, film pipeline.
 *
 * Voice, ducked bed, SFX on the 120 BPM grid, to the bible's single target:
 *
 *   -14.0 LUFS integrated - max short-term <= -9.0 LUFS - -1.0 dBTP
 *   (-1.5 dBTP on the 9:16 cuts) - LRA not specified.
 *   AAC-LC, 48 kHz, stereo, 320 kbps, MP4, moov atom first.
 *
 * Two-pass `loudnorm` with `linear=true`, always.  One pass is a dynamic
 * normaliser working blind and will not hit the target; that is why the old
 * master reads -15.2 against a -14 spec.
 *
 * Bed level and duck depth are independent controls: `sidechaincompress` gain
 * reduction depends only on the key level, so the director can ask for more
 * music without anyone re-tuning the duck.  The bed and the voice are also
 * EQ'd as a pair - a permanent 4 dB hole at 3.8 kHz, exactly where the voice's
 * +3.5 dB presence bell sits - which is why the duck can be gentle.
 *
 * Writes:
 *   out/<id>-sfx.wav        the SFX bus, placed on the grid
 *   out/<id>.premaster.wav  voice + ducked bed + ducked SFX
 *   out/<id>.master.wav     after two-pass loudnorm
 *   out/<id>.master.m4a     AAC-LC 48 kHz stereo 320 kbps, faststart
 *   out/<id>.audio.json     the measured numbers
 *
 * Usage:
 *   node mix.mjs --id qa-wrap
 *   node mix.mjs --id record-a-session --aspect 9:16
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * Where the working tree lives: `work/film/audio/out` at the repository root,
 * NOT `out/` beside this file.
 *
 * `tools/lib-paths.mjs` moved every large regenerable tree out of the extension
 * folder because Chrome measures that folder and reported it at about 7,000 MB.
 * The picture stage and the manifest were pointed at the new roots; the three
 * audio tools were not, and they kept writing beside themselves. Nothing
 * noticed for a while, because the READERS had already been moved and simply
 * found the older files that had been carried across by hand. The first thing
 * to write here after the move re-created the folder inside the extension.
 */
const OUT = path.join(HERE, "..", "..", "..", "..",
  "work", "film", "audio", "out");
const SFXDIR = path.join(OUT, "sfx");
const SR = 48000;

const DEFAULT_SFX_BUS_PEAK_DBFS = -8.0;

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
};

function sh(bin, args, timeout = 300000) {
  const r = spawnSync(bin, args, {
    encoding: "utf8", maxBuffer: 128 << 20, timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) throw new Error(`${bin}: ${r.error.message}`);
  if (r.signal) throw new Error(`${bin} timed out after ${timeout} ms`);
  return r;
}

/** Duration in seconds, from the container. */
function dur(file) {
  const r = sh("ffprobe", ["-v", "error", "-show_entries", "format=duration",
    "-of", "csv=p=0", file]);
  const v = parseFloat((r.stdout || "").trim());
  return Number.isFinite(v) ? v : 0;
}

function ff(args, what) {
  const r = sh("ffmpeg", ["-y", "-hide_banner", "-v", "error", ...args]);
  if (r.status !== 0) throw new Error(`${what} failed:\n${r.stderr}`);
  return r;
}

/** Integrated loudness and true peak of `file` after `pre` (a filter string). */
function analyse(file, pre = "") {
  const af = `${pre ? `${pre},` : ""}loudnorm=I=-14:TP=-1:LRA=9:print_format=json`;
  const r = sh("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", af,
    "-f", "null", "-"]);
  const m = r.stderr.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`loudnorm analysis failed for ${file}:\n${r.stderr}`);
  const j = JSON.parse(m[0]);
  return {
    i: parseFloat(j.input_i), tp: parseFloat(j.input_tp),
    lra: parseFloat(j.input_lra), thresh: parseFloat(j.input_thresh),
    offset: parseFloat(j.target_offset),
  };
}

function peakDbfs(file) {
  const r = sh("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af",
    "astats=measure_overall=Peak_level:measure_perchannel=none",
    "-f", "null", "-"]);
  const m = r.stderr.match(/Peak level dB:\s*(-?\d+\.?\d*|-?inf)/);
  return m ? parseFloat(m[1]) : -120;
}

/* ------------------------------------------------------------- the SFX bus */

function buildSfxBus(cues, out) {
  const cuesList = cues.sfx || [];
  if (cuesList.length === 0) {
    /* No SFX cues at all (the commercial uses a different device, research/62
       §2 note 87). `amix` rejects `inputs=0` outright, so a silent bus of the
       film's own length is written directly instead of going through it. */
    ff(["-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=${SR}`,
      "-t", cues.seconds.toFixed(3), "-ac", "2", "-ar", String(SR),
      "-c:a", "pcm_s24le", out], "sfx bus (silent, no cues)");
    return;
  }
  const inputs = [];
  const parts = [];
  cuesList.forEach((c, i) => {
    const f = path.join(SFXDIR, `${c.cue}.wav`);
    if (!fs.existsSync(f)) throw new Error(`missing ${f}. Run: python sfx.py`);
    inputs.push("-i", f);
    const ms = Math.max(0, Math.round(c.atSec * 1000));
    const g = c.gainDb != null ? `,volume=${c.gainDb}dB` : "";
    parts.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=${SR}` +
      `:channel_layouts=stereo${g},adelay=${ms}|${ms}[s${i}]`);
  });
  const labels = cuesList.map((_, i) => `[s${i}]`).join("");
  parts.push(`${labels}amix=inputs=${cuesList.length}:normalize=0` +
    `:dropout_transition=0[sum]`);
  parts.push(`[sum]apad=whole_dur=${cues.seconds.toFixed(3)},asetpts=N/SR/TB[out]`);
  ff([...inputs, "-filter_complex", parts.join(";"), "-map", "[out]",
    "-t", cues.seconds.toFixed(3),
    "-ac", "2", "-ar", String(SR), "-c:a", "pcm_s24le", out], "sfx bus");
}

/* ------------------------------------------------------------ the premaster */

function premaster(bed, vo, sfx, trims, out, seconds, duckRelease = 280,
  presenceDb = 0) {
  const g = [
    // The voice: mono, centred, correlation +1.  Never widen a voice-over.
    // The presence bell lives HERE, on the voice path in the mix, not in the
    // chain.  Put it in the chain and every line is re-chained, which re-runs
    // the audible-end measurement and moves the layout by a few milliseconds;
    // put it here and qa-wrap-vo.json is not regenerated at all, so Builder A
    // re-muxes by stream copy against timings that are byte-identical.
    // Before the loudness trim, so the trim still lands the stem on target.
    `[1:a]aformat=sample_fmts=fltp:sample_rates=${SR}:channel_layouts=mono,` +
    `equalizer=f=3900:width_type=q:w=1.0:g=${presenceDb},` +
    `volume=${trims.vo.toFixed(2)}dB,asplit=3[vom][k1m][k2m]`,
    `[vom]pan=stereo|c0=c0|c1=c0[vo]`,
    // The duck key is the voice at 2.2x - the level that gives 9 dB of
    // reduction at threshold 0.045.
    `[k1m]volume=2.2,pan=stereo|c0=c0|c1=c0[k1]`,
    `[k2m]pan=stereo|c0=c0|c1=c0[k2]`,
    // The bed: 55 Hz highpass (below the A1 bass root nothing is heard and a
    // phone cannot reproduce it), a permanent 4 dB hole at 3.8 kHz where the
    // voice's presence bell sits, then the -5 dB bed gain.
    `[0:a]highpass=f=55:poles=2,equalizer=f=3800:width_type=q:w=1.0:g=-4,` +
    `volume=${trims.bed.toFixed(2)}dB,volume=-5dB[b]`,
    // Release is a cue-file number now.  R2 measured 280 ms as "short enough
    // that the bed is back at full level inside a one-beat gap", which was
    // right for a read with 0.33 s gaps.  Rev 3 rests for 1.0-2.1 s, and 280 ms
    // of recovery at the front of a two-second hole is audible as the bed
    // swelling back up rather than simply being there.
    `[b][k1]sidechaincompress=threshold=0.045:ratio=4:attack=25` +
    `:release=${duckRelease}:level_sc=1:makeup=1:mix=1[bd]`,
    // The SFX get their own, gentler duck: they are meant to be heard, but
    // not on top of a word.
    `[2:a]volume=${trims.sfx.toFixed(2)}dB[s]`,
    `[s][k2]sidechaincompress=threshold=0.10:ratio=2.5:attack=20:release=220` +
    `:level_sc=1:makeup=1:mix=1[sd]`,
    `[vo][bd][sd]amix=inputs=3:normalize=0:dropout_transition=0[m]`,
    // A safety catch only.  The master's true peak is set by loudnorm.
    `[m]alimiter=limit=0.944:level=disabled:attack=2:release=50,` +
    `atrim=0:${seconds.toFixed(3)},asetpts=N/SR/TB[out]`,
  ].join(";");
  ff(["-i", bed, "-i", vo, "-i", sfx, "-filter_complex", g, "-map", "[out]",
    "-ac", "2", "-ar", String(SR), "-c:a", "pcm_s24le", out], "premaster");
}

/* ---------------------------------------------------------------- mastering */

function meter(file) {
  const r = sh("ffmpeg", ["-hide_banner", "-nostats", "-nostdin", "-i", file,
    "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const log = r.stderr || "";
  const tail = log.slice(log.lastIndexOf("Summary:"));
  const i = tail.match(/I:\s*(-?\d+\.\d+)\s*LUFS/);
  const p = tail.match(/Peak:\s*(-?\d+\.\d+)\s*dBFS/);
  return { i: i ? parseFloat(i[1]) : null, tp: p ? parseFloat(p[1]) : null };
}

function master(pre, out, targetI, targetTp) {
  // Pass 1: measure.  Pass 2: apply, with linear=true so a single static gain
  // is used - which is what a master wants.
  //
  // Then verify against `ebur128`, because that is the meter the acceptance
  // test runs and it does not always agree with `loudnorm`'s own pass-1
  // figures to the last tenth.  Both axes get corrected: the loudness request
  // moves by the error, and the true-peak request tightens until the ceiling
  // holds.  (Tech 3343 11.2.3 puts a 4x oversampling meter's under-read at
  // about 0.5 dB, so this is expected, not a bug.)
  const a = analyse(pre);
  let reqI = targetI;
  let reqTp = targetTp;
  let m = { i: null, tp: null };
  let corrections = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const af = `loudnorm=I=${reqI.toFixed(2)}:TP=${reqTp.toFixed(2)}:LRA=9` +
      `:measured_I=${a.i}:measured_TP=${a.tp}:measured_LRA=${a.lra}` +
      `:measured_thresh=${a.thresh}:offset=${a.offset}:linear=true` +
      `:print_format=summary`;
    ff(["-i", pre, "-af", af, "-ar", String(SR), "-ac", "2",
      "-c:a", "pcm_s24le", out], "loudnorm pass 2");
    m = meter(out);
    /* Aim 0.1 dB under the ceiling, not at it.
     *
     * There are two true-peak meters in this pipeline and they do not agree to
     * the last tenth: `ebur128` here, and `measure.py` at the end, which is the
     * one the acceptance gate reads. Landing exactly on -1.0 by the first meter
     * therefore lands at -0.9 by the second, and the film fails its own gate
     * after passing its own correction loop — which is the worst possible
     * shape for a check, because the run says both things.
     *
     * EBU Tech 3343 11.2.3 puts a 4x-oversampling meter's under-read at about
     * 0.5 dB, so 0.1 is well inside the disagreement the standard expects. The
     * ceiling is a maximum: a master 0.1 dB below it is not a worse master. */
    const HEADROOM = 0.1;
    const overTp = m.tp !== null && m.tp > targetTp - HEADROOM;
    const offI = m.i !== null && Math.abs(m.i - targetI) > 0.05;
    if (!overTp && !offI) break;
    if (overTp) reqTp -= (m.tp - (targetTp - HEADROOM)) + 0.05;
    if (offI) reqI += targetI - m.i;
    corrections += 1;
  }
  if (m.tp !== null && m.tp > targetTp + 0.001) {
    throw new Error(`could not reach ${targetTp} dBTP (stuck at ${m.tp})`);
  }
  if (corrections) {
    console.log(`  loudnorm verified against ebur128: request I=${reqI.toFixed(2)} ` +
      `TP=${reqTp.toFixed(2)} lands I=${m.i} TP=${m.tp} ` +
      `(${corrections} correction${corrections === 1 ? "" : "s"})`);
  }
  return a;
}

/**
 * AAC-LC at a real 320 kbps.
 *
 * ffmpeg's native `aac` encoder silently caps at about 111 kbps per channel -
 * it accepts `-b:a 320k` and writes 222 kbps, below the bible's 256 kbps
 * floor, with no warning.  `aac_mf` (MediaFoundation, Windows) honours the
 * rate exactly and was measured to move integrated loudness, max short-term
 * and true peak by 0.00 dB.  The native encoder stays as the fallback.
 */
function encode(wav, m4a, bitrate) {
  const encoders = sh("ffmpeg", ["-hide_banner", "-encoders"]).stdout || "";
  const tries = [];
  if (encoders.includes("aac_mf")) tries.push("aac_mf");
  tries.push("aac");
  let used = null;
  let last = "";
  for (const enc of tries) {
    const args = ["-i", wav, "-c:a", enc];
    if (enc === "aac") args.push("-profile:a", "aac_low");
    args.push("-b:a", bitrate, "-ar", String(SR), "-ac", "2",
      "-movflags", "+faststart", m4a);
    const r = sh("ffmpeg", ["-y", "-hide_banner", "-v", "error", ...args]);
    if (r.status === 0 && fs.existsSync(m4a)) { used = enc; break; }
    last = r.stderr || "";
  }
  if (!used) throw new Error(`no working AAC encoder
${last}`);
  const probe = sh("ffprobe", ["-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=codec_name,profile,bit_rate", "-of", "csv=p=0", m4a]);
  const [codec, profile, rate] = (probe.stdout || "").trim().split(",");
  const kbps = Math.round(parseInt(rate, 10) / 1000);
  console.log(`  encode  ${used}  ${codec} ${profile}  ${kbps} kbps`);
  if (!/LC/i.test(profile || "")) throw new Error(`not AAC-LC: ${profile}`);
  if (kbps < 256) {
    console.warn(`  WARNING: ${kbps} kbps is below the 256 kbps floor ` +
      `(bible 8.3). The native ffmpeg aac encoder caps at ~111 kbps/channel.`);
  }
  return { encoder: used, codec, profile, kbps };
}

/* --------------------------------------------------------------------- main */

function main() {
  const id = arg("id");
  if (!id) {
    console.error("usage: node mix.mjs --id <film-id> [--aspect 16:9|1:1|9:16]");
    process.exit(2);
  }
  const aspect = arg("aspect", "16:9");
  const cuePath = arg("cues") || path.join(HERE, "cues", `${id}.cues.json`);
  const cues = JSON.parse(fs.readFileSync(cuePath, "utf8"));
  const t = cues.master;
  const suffix = aspect === "9:16" ? "-916" : "";
  const targetTp = aspect === "9:16" ? t.truePeakDbtp916 : t.truePeakDbtp;

  const bed = path.join(OUT, `bed-${id}.wav`);
  const vo = path.join(OUT, `${id}-vo.wav`);
  for (const [f, how] of [[bed, `python bed.py --id ${id}`],
    [vo, `node voice.mjs --id ${id}`]]) {
    if (!fs.existsSync(f)) {
      console.error(`missing ${f}\n  run: ${how}`);
      process.exit(2);
    }
  }

  const sfxBus = path.join(OUT, `${id}-sfx.wav`);
  buildSfxBus(cues, sfxBus);

  // --- levels ------------------------------------------------------------
  // The bed is trimmed by measurement, not by faith, so the synthesis' own
  // absolute level never matters and a re-rendered bed lands in the same place.
  const bedPre = "highpass=f=55:poles=2,equalizer=f=3800:width_type=q:w=1.0:g=-4";
  const bedNow = analyse(bed, bedPre).i;
  // The presence bell is applied BEFORE the trim in the graph, so the trim has
  // to be measured through it.  Measuring the bare stem and then adding +6 dB
  // at 3.9 kHz downstream leaves the voice hot by the loudness the bell adds,
  // and - worse - puts its sibilant peaks 6 dB higher into the premaster
  // limiter, which then works on every /s/.  That is audible as harshness and
  // it is the one thing that changed between the accepted master and this one.
  const presenceDbEarly = cues.voice.presenceBellDb ?? 0;
  const voPre = presenceDbEarly
    ? `equalizer=f=3900:width_type=q:w=1.0:g=${presenceDbEarly}` : "";
  const voNow = analyse(vo, voPre).i;
  const voTarget = cues.voice.targetLufs ?? -15.0;
  const bedTarget = cues.bed.targetLufs ?? voTarget - 12.0;   // 12 LU below
  const trims = {
    // targetLufs is the level after the -5 dB bed gain, so add it back here.
    bed: bedTarget + 5.0 - bedNow,
    vo: voTarget - voNow,
    // A silent bus (no sfx cues at all) has no measurable peak; 0 dB trim
    // leaves it exactly what it is, silence, so nothing downstream sees NaN.
    sfx: (cues.sfx || []).length === 0
      ? 0
      : (cues.bed.sfxBusPeakDbfs ?? DEFAULT_SFX_BUS_PEAK_DBFS) - peakDbfs(sfxBus),
  };

  console.log(`mix  ${id}  ${aspect}  ${cues.seconds.toFixed(3)} s`);
  console.log(`  bed   ${bedNow.toFixed(2)} LUFS -> ${bedTarget.toFixed(1)} ` +
    `after the -5 dB gain   (trim ${trims.bed >= 0 ? "+" : ""}${trims.bed.toFixed(2)} dB)`);
  console.log(`  voice ${voNow.toFixed(2)} LUFS -> ${voTarget.toFixed(1)}` +
    `                     (trim ${trims.vo >= 0 ? "+" : ""}${trims.vo.toFixed(2)} dB)`);
  console.log(`  sfx bus peak -> ${(cues.bed.sfxBusPeakDbfs ?? DEFAULT_SFX_BUS_PEAK_DBFS)
    .toFixed(1)} dBFS               (trim ${trims.sfx >= 0 ? "+" : ""}${trims.sfx.toFixed(2)} dB)` +
    `   ${(cues.sfx || []).length} cues`);

  const pre = path.join(OUT, `${id}${suffix}.premaster.wav`);
  const duckRelease = cues.bed.duckReleaseMs ?? 280;
  console.log(`  duck release ${duckRelease} ms`);
  const presenceDb = cues.voice.presenceBellDb ?? 0;
  if (presenceDb) {
    console.log(`  presence bell +${presenceDb} dB at 3900 Hz on the voice`);
  }
  premaster(bed, vo, sfxBus, trims, pre, cues.seconds, duckRelease, presenceDb);
  const preA = analyse(pre);
  console.log(`  premaster  ${preA.i.toFixed(2)} LUFS  TP ${preA.tp.toFixed(2)} dBTP`);

  const wav = path.join(OUT, `${id}${suffix}.master.wav`);
  master(pre, wav, t.integratedLufs, targetTp);
  const m4a = path.join(OUT, `${id}${suffix}.master.m4a`);
  const enc = encode(wav, m4a, t.bitrate || "320k");

  // The whole film, or the number is not the film's.
  //
  // Builder A read these five feature masters 0.3 LU hot on 2026-09-06.  The
  // files were not hot: measured end to end they are -14.0, and the mix
  // already meters the ENCODED m4a rather than the wav, so the encode is
  // inside the measurement.  What raises the number is measuring less than the
  // whole film - these films gained 2.000 s of end card and the features carry
  // 5.4 s of bed-only ring-out after the last word, so a window that stops
  // early drops the quietest part and reads hot.  Truncated at 16 s they read
  // -13.5 to -13.7; at 18 s, -14.0.
  //
  // Loudness is defined over a stated duration, so the duration is now part of
  // the master line and a short file is a failure rather than a footnote.
  const m4aDur = dur(m4a);
  if (m4aDur + 0.05 < cues.seconds) {
    throw new Error(`master is ${m4aDur.toFixed(3)} s but the film is `
      + `${cues.seconds.toFixed(3)} s: a loudness measured over less than the `
      + "whole film is not this film's loudness");
  }
  console.log(`  master runs ${m4aDur.toFixed(3)} s of ${cues.seconds.toFixed(3)} s`);

  // --- measure and gate --------------------------------------------------
  const jsonPath = path.join(OUT, `${id}${suffix}.audio.json`);
  const m = sh("python", [path.join(HERE, "measure.py"), m4a, "--as", "master",
    "--cues", cuePath, "--aspect", aspect, "--json", jsonPath,
    "--spectrogram", path.join(OUT, `${id}${suffix}.master.png`)]);
  process.stdout.write(m.stdout);
  if (fs.existsSync(jsonPath)) {
    const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    Object.assign(j, { aspect, encoder: enc, premasterLufs: +preA.i.toFixed(2),
      trimsDb: { bed: +trims.bed.toFixed(2), voice: +trims.vo.toFixed(2),
        sfx: +trims.sfx.toFixed(2) },
      bedGainDb: -5, duckDepthDb: 9, sfxCues: (cues.sfx || []).length });
    fs.writeFileSync(jsonPath, `${JSON.stringify(j, null, 2)}
`);
  }
  if (m.stderr) process.stderr.write(m.stderr);
  console.log(`  -> ${m4a}`);
  process.exitCode = m.status === 0 ? 0 : 1;
}

main();
