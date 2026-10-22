#!/usr/bin/env node
/**
 * The voice: render, chain, place.  Builder B, film pipeline.  Revision 3.
 *
 * WHAT REVISION 3 CHANGED, AND WHY
 *
 * Nader heard revision 2's split-and-join read as *"not human, not consistent,
 * a major error"*.  The ruling is **consistency over expression**, and it
 * reverses two things revision 2 did on purpose:
 *
 * 1. **One edge-tts request per LINE, never per phrase.**  Splitting a line at
 *    its full stops and rendering each piece with its own rate and pitch buys
 *    f0 variation, and it buys it by making one sentence out of two or three
 *    separately-voiced fragments.  Measured, that reads as wider.  Heard, it
 *    reads as a different person every few seconds.
 * 2. **One fixed rate and pitch for the whole film.**  `firm` and `warm` are
 *    now delivery notes for the *writer* - they live in the punctuation of the
 *    line, which R3 6 measured as the real delivery notation - and not in the
 *    settings.  Nothing about the voice changes inside a film.
 *
 * And one thing revision 3 adds:
 *
 * 3. **The picture is the clock.**  A line starts at its anchor from the shot
 *    table.  Full stop.  There is no gap solver, no pulling a line early to
 *    close a rest, and no drift: revision 2's stem finished 1.31 s ahead of its
 *    picture because it was pacing to a gap budget instead of to the shots.
 *    A line that will not fit inside its own shot is reported, not squeezed.
 *
 * Word boundaries come from `edge_tts`'s streaming API rather than the CLI,
 * because the CLI merges them into sentence-sized subtitle cues and Builder A
 * needs sub-line times to cut 39 caption cards.  The chain only ever removes
 * silence, never scales speech, so raw word times map onto the chained
 * timeline exactly by aligning speech runs and shifting each run by a
 * constant.
 *
 * Writes:
 *   out/vo/<id>-LL.wav / .chain.wav / .words.json   per line (the cache)
 *   out/<id>-vo.wav        the placed voice stem, mono, film length
 *   out/<id>-vo-raw.wav    the same placement, unchained, for A/B
 *   out/<id>-vo.json       per line, per word and per caption chunk
 *
 * Usage:
 *   node voice.mjs --id qa-wrap
 *   node voice.mjs --id qa-wrap --sweep          # pick the fixed setting
 *   node voice.mjs --id qa-wrap --force
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const VO = path.join(OUT, "vo");
const IR = path.join(OUT, "room-ir.wav");
const SR = 48000;

const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);

// Bump when chainGraph() changes: re-chains from the cached render and makes
// no network request.
const PROVIDER_ARG = (() => {
  const i = process.argv.indexOf("--provider");
  return i >= 0 ? process.argv[i + 1] : "edge";
})();
const CHAIN_MODE = process.argv.includes("--clean") ? "clean" : "full";
const CHAIN_REVISION = CHAIN_MODE === "clean" ? "r3-clean4" : "r3";

/**
 * The draw gate.  edge-tts returns a different performance for the same
 * request: R4 measured two distinct files in eight for "QA Wrap.", and the
 * rising one - the brand name spoken as a question - came back 2 in 8 and
 * shipped.  Drawing once and caching it is drawing a lottery ticket and then
 * framing it.
 */
const GATE = (() => {
  const gemini = PROVIDER_ARG === "gemini";
  return {
    revision: gemini ? "g2-gemini" : "g1",
    // Gemini is more variable than edge-tts, so it needs more tickets.
    draws: gemini ? 5 : 3,
    // The terminal test is the defect gate and does not move for anyone: a
    // statement falls, and +1.0 ST of lift is the question contour that shipped.
    maxTailSt: 1.0,
    // The duration test only ever meant "this is a different performance, not a
    // different take of the same one".  R4 calibrated 5 % on edge-tts; Gemini's
    // own spread across three identical requests was 24 %, so 5 % rejects
    // almost every draw and says nothing.  Shot fit is checked separately and
    // explicitly, which is where duration actually matters.
    maxDurDev: gemini ? 0.15 : 0.05,
  };
})();

/* ---------------------------------------------------------- voice profiles */

/**
 * Per-voice chain tuning (R3 4.7).  Only two numbers move per voice: the
 * de-esser frequency, which must sit on that voice's sibilance peak, and the
 * presence bell.  A de-esser at the male peak does nothing at all to a female
 * voice - R2's 6,800 Hz is more than an octave below where a female /s/ lives.
 */
const PROFILES = {
  "en-US-EmmaMultilingualNeural": {
    deEssHz: 7900, presenceHz: 3900, presenceDb: 9.0, lowBellDb: -4.0,
    note: "sibilance peak 7,880 Hz; 45 % of her energy is under 300 Hz",
  },
  "en-US-AriaNeural": {
    deEssHz: 8600, presenceHz: 4200, presenceDb: 5.0, lowBellDb: -2.5,
    note: "sibilance peak 8,560 Hz; 54 % of her sibilance is in 8-10 kHz",
  },
};
const DEFAULT_PROFILE = {
  deEssHz: 8200, presenceHz: 4200, presenceDb: 6.0, lowBellDb: -2.5,
  note: "unprofiled voice; female-average de-esser placement",
};

/** The presence floor below which the lead is rejected for the fallback. */
const PRESENCE_FLOOR = 4.0;

/* ---------------------------------------------------------------- helpers */

function sh(bin, args, { timeout = 240000, input = null } = {}) {
  const r = spawnSync(bin, args, {
    encoding: "utf8", maxBuffer: 96 << 20, timeout, input,
    stdio: input === null ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
  if (r.error) throw new Error(`${bin} not found: ${r.error.message}`);
  if (r.signal) throw new Error(`${bin} timed out after ${timeout} ms`);
  return r;
}

function dur(file) {
  const r = sh("ffprobe", ["-v", "error", "-show_entries", "format=duration",
    "-of", "csv=p=0", file]);
  const v = parseFloat((r.stdout || "").trim());
  return Number.isFinite(v) ? v : 0;
}

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : true;
};

const fmtRate = (n) => `${n >= 0 ? "+" : ""}${Math.round(n)}%`;
const fmtPitch = (n) => `${n >= 0 ? "+" : ""}${Math.round(n)}Hz`;
const r3 = (n) => Math.round(n * 1000) / 1000;

/* ------------------------------------------------------------------- TTS */

/**
 * One request, one line, audio and word boundaries together.
 *
 * The `edge-tts` CLI merges WordBoundary events into sentence-sized subtitle
 * cues, which is the wrong granularity for 39 caption chunks, so this goes
 * through the streaming API.  It is still one request and still the same
 * endpoint: the only outbound egress in the pipeline, carrying product copy.
 */
const TTS_PY = [
  "import asyncio, json, sys, edge_tts",
  "voice, rate, pitch, mp3, meta = sys.argv[1:6]",
  "text = sys.stdin.read()",
  "async def go():",
  "    c = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch,",
  "                             boundary='WordBoundary')",
  "    words = []",
  "    with open(mp3, 'wb') as f:",
  "        async for ch in c.stream():",
  "            if ch['type'] == 'audio':",
  "                f.write(ch['data'])",
  "            elif ch['type'] == 'WordBoundary':",
  "                words.append({'text': ch['text'],",
  "                              'start': ch['offset'] / 1e7,",
  "                              'end': (ch['offset'] + ch['duration']) / 1e7})",
  "    json.dump(words, open(meta, 'w', encoding='utf-8'))",
  "    print(len(words))",
  "asyncio.run(go())",
].join(NL);

const PROVIDER = (() => {
  const i = process.argv.indexOf("--provider");
  return i >= 0 ? process.argv[i + 1] : "edge";
})();

/**
 * Gemini TTS through OpenRouter's OpenAI-shaped /v1/audio/speech.
 *
 * Two quirks, both from the TTS backend and both load-bearing: `voice` is
 * MANDATORY (omitting it is a schema error, not a default), and `pcm` is the
 * only accepted response_format - so what comes back is raw headerless 24 kHz
 * mono s16le and has to be wrapped before anything downstream can read it.
 *
 * The key is read from ~/.config/qa-wrap/openrouter.env inside this process.
 * It is never an argument, never printed, never written anywhere.
 *
 * There is no word-boundary stream here, so `words` comes back empty and the
 * caption chunks are timed by proportion instead.
 */
const GEMINI_PY = [
  "import json, os, pathlib, struct, sys, urllib.request, urllib.error",
  "voice, out_wav, meta = sys.argv[1:4]",
  "text = sys.stdin.read()",
  "kf = pathlib.Path.home() / '.config' / 'qa-wrap' / 'openrouter.env'",
  "tok = None",
  "for ln in kf.read_text(encoding='utf-8').splitlines():",
  "    if ln.strip().startswith('OPEN_ROUTER_TOKEN'):",
  "        tok = ln.split('=', 1)[1].strip().strip(chr(34)).strip(chr(39))",
  "if not tok: raise SystemExit('no OPEN_ROUTER_TOKEN')",
  "body = json.dumps({'model': 'google/gemini-3.1-flash-tts-preview',",
  "                   'input': text, 'voice': voice,",
  "                   'response_format': 'pcm'}).encode('utf-8')",
  "req = urllib.request.Request('https://openrouter.ai/api/v1/audio/speech',",
  "                             data=body,",
  "                             headers={'Authorization': 'Bearer ' + tok,",
  "                                      'Content-Type': 'application/json'})",
  "try:",
  "    pcm = urllib.request.urlopen(req, timeout=180).read()",
  "except urllib.error.HTTPError as e:",
  "    raise SystemExit('HTTP %d: %s' % (e.code, e.read().decode('utf-8','replace')[:200]))",
  "if len(pcm) < 2000: raise SystemExit('only %d bytes of pcm' % len(pcm))",
  "hdr = (b'RIFF' + struct.pack('<I', 36+len(pcm)) + b'WAVE' + b'fmt ' +",
  "       struct.pack('<IHHIIHH', 16, 1, 1, 24000, 48000, 2, 16) +",
  "       b'data' + struct.pack('<I', len(pcm)))",
  "pathlib.Path(out_wav).write_bytes(hdr + pcm)",
  "json.dump([], open(meta, 'w', encoding='utf-8'))",
  "print(len(pcm))",
].join(NL);

/**
 * Delivery, as natural language at the head of the input.
 *
 * Measured on the longest line (12 words in a 5.25 s shot): "unhurried" read at
 * 0.503 s/word and overran by 0.79 s; "brisk" read at 0.363 and fitted with
 * 0.89 s to spare; no instruction at all read at 0.450 and overran by 0.15.
 * The picture is the clock, so brisk it is - with the warmth kept in the same
 * sentence rather than traded away for the pace.
 */
const GEMINI_DELIVERY =
  "Read this at a brisk natural pace, warm and professional, like a colleague "
  + "explaining something. Do not pause between sentences. Fall at the end: ";

function pause(ms) {
  spawnSync(process.execPath, ["-e", `setTimeout(()=>{}, ${ms})`],
    { timeout: ms + 5000 });
}

function ttsGemini(text, voice, wav, meta, tries = 12) {
  fs.mkdirSync(path.dirname(wav), { recursive: true });
  let last = "";
  let quoted = false;
  // Spread the requests.  Back-to-back calls draw the empty-stream response far
  // more often than spaced ones; the standalone probe, which paused between
  // calls, almost never saw one.
  pause(1200);
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    // Two different failures wear the same 502 "empty audio stream" coat.
    //
    // One is weather: the same request succeeds a minute later.  Retries with a
    // growing back-off are the answer to that one.
    //
    // The other is content, and no number of retries fixes it.  A line that
    // reads as an instruction is swallowed by the model when it follows the
    // delivery instruction: "...Fall at the end: No time limit. It runs until
    // you stop it." returned an empty stream on every one of ~20 attempts,
    // while the same line ALONE rendered first try, and the same line in
    // quotation marks after the same preamble rendered first try.  The quotes
    // mark where the instruction stops and the copy starts; they are not
    // spoken.  So: four attempts in the plain form, then the quoted form.  The
    // copy is not touched - a quotation mark around it is punctuation in the
    // request, not a word in the film.
    if (!quoted && attempt === 5) quoted = true;
    const input = GEMINI_DELIVERY + (quoted ? `"${text}"` : text);
    const r = sh("python", ["-c", GEMINI_PY, voice, wav, meta],
      { timeout: 200000, input });
    if (r.status === 0 && fs.existsSync(wav) && fs.statSync(wav).size >= 4000) {
      return { ok: true, attempts: attempt, quoted };
    }
    last = (r.stderr || r.stdout || "").trim().slice(0, 300);
    fs.rmSync(wav, { force: true });
    // The back-off grows to 20 s and then holds, with one long cooldown at the
    // eighth attempt to ride out a bad minute.  An empty stream is not a
    // generation, so a failed attempt is not billed.
    if (attempt < tries) {
      pause(attempt === 8 ? 60000 : Math.min(20000, 2500 * attempt));
    }
  }
  return { ok: false, err: last };
}

function tts(text, voice, rate, pitch, mp3, meta) {
  fs.mkdirSync(path.dirname(mp3), { recursive: true });
  const r = sh("python", ["-c", TTS_PY, voice, rate, pitch, mp3, meta],
    { timeout: 180000, input: text });
  if (r.status !== 0 || !fs.existsSync(mp3) || fs.statSync(mp3).size < 512) {
    return { ok: false, err: (r.stderr || r.stdout || "").trim().slice(0, 400) };
  }
  return { ok: true };
}

/* ----------------------------------------------------------------- chain */

/**
 * research/32-sound-design.md 4.2 as corrected by 41-voice-and-pitch.md 4.7.
 * Unchanged from revision 2: only the de-esser threshold being a linear
 * amplitude, its frequency being on the female sibilance peak, and its
 * position after the compressors, are what make it work at all.
 *
 * The only time-altering stage is `silenceremove`, which trims the head and
 * collapses internal pauses.  Nothing here scales speech, which is what lets
 * word boundaries map from the raw render onto this one exactly.
 */
function chainGraph(p) {
  return [
    "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono,",
    "silenceremove=start_periods=1:start_silence=0.04:start_threshold=-48dB",
    ":stop_periods=-1:stop_silence=0.10:stop_threshold=-48dB,",
    "highpass=f=90:poles=2,asplit=2[vk][vm];",
    "[vk]bandpass=f=1300:width_type=o:w=2.2,volume=3.0[key];",
    "[vm][key]sidechaingate=threshold=0.020:ratio=2.6:attack=4:release=180",
    ":knee=6:range=0.30[gated];",
    `[gated]equalizer=f=180:width_type=q:w=0.8:g=${p.lowBellDb},`,
    "equalizer=f=380:width_type=q:w=1.1:g=-2.0,",
    "equalizer=f=1050:width_type=q:w=1.0:g=-1.5,",
    `equalizer=f=${p.presenceHz}:width_type=q:w=0.9:g=${p.presenceDb},`,
    "highshelf=f=10500:width_type=q:w=0.7:g=-3,",
    "acompressor=threshold=-20dB:ratio=3.2:attack=8:release=140:knee=6:makeup=3.5,",
    "acompressor=threshold=-11dB:ratio=6:attack=1.5:release=60:knee=3:makeup=1.5,",
    `adynamicequalizer=dfrequency=${p.deEssHz}:dqfactor=1.6`,
    `:tfrequency=${p.deEssHz}:tqfactor=1.6:threshold=0.020:ratio=6`,
    ":attack=2:release=45:mode=cutabove:range=14,",
    "asplit=2[dry][wetin];",
    "[wetin][1:a]afir=dry=0:wet=1:gtype=none,volume=0.30[wet];",
    "[dry][wet]amix=inputs=2:weights='1 0.16':normalize=0,",
    "alimiter=limit=0.85:level=disabled:attack=2:release=50[vout]",
  ].join("");
}

/**
 * The clean chain.  Nothing that can crack.
 *
 * Nader hears cracking in a stem whose every line passed the contour gate, so
 * the fault is not the generator - it is one of the four things the full chain
 * does that a voice does not: a frequency-keyed gate that can chatter, two
 * compressors that can grab, a dynamic EQ that can pump, and a convolution
 * tail that splices onto the next thing.  This removes all four and keeps only
 * what cannot: trim the ends, take off the rumble, take a little of the /s/,
 * and set the level with one static gain.
 *
 * `gainDb` is computed per line from a measurement, so lines still match each
 * other without a compressor doing it dynamically.
 */
function cleanGraph(gainDb) {
  return [
    "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono,",
    // Ends only, and the tail is trimmed by reversing rather than with
    // stop_periods.  A positive stop_periods truncates at the FIRST internal
    // silence - it cut every line to its opening clause - and a negative one
    // is the full chain's internal-collapse behaviour, which is a splice per
    // pause.  Reverse, trim the new head, reverse back: the ends go, the
    // middle is untouched.
    "silenceremove=start_periods=1:start_silence=0.04:start_threshold=-48dB,",
    "areverse,",
    "silenceremove=start_periods=1:start_silence=0.04:start_threshold=-48dB,",
    "areverse,",
    "highpass=f=80:poles=2,",
    // a light de-esser: ratio 2 rather than 6, and the threshold RAISED not
    // lowered.  `adynamicequalizer` triggers above its threshold, so halving
    // it makes the filter work harder - the opposite of light.  0.040 with
    // ratio 2 is about a third of the full chain's action.
    "adynamicequalizer=dfrequency=7900:dqfactor=1.4:tfrequency=7900",
    ":tqfactor=1.4:threshold=0.040:ratio=2:attack=8:release=120",
    ":mode=cutabove:range=8,",
    `volume=${gainDb.toFixed(2)}dB[vout]`,
  ].join("");
}

function peakDbfsOf(file) {
  const r = sh("ffmpeg", ["-hide_banner", "-nostats", "-nostdin", "-i", file,
    "-af", "astats=measure_overall=Peak_level:measure_perchannel=none",
    "-f", "null", "-"]);
  const m = (r.stderr || "").match(/Peak level dB:\s*(-?\d+\.?\d*|-?inf)/);
  return m ? parseFloat(m[1]) : -6;
}

function lineLoudness(file) {
  const r = sh("ffmpeg", ["-hide_banner", "-nostats", "-nostdin", "-i", file,
    "-af", "loudnorm=I=-16:TP=-1:LRA=9:print_format=json", "-f", "null", "-"]);
  const m = (r.stderr || "").match(/\{[\s\S]*\}/);
  return m ? parseFloat(JSON.parse(m[0]).input_i) : -16;
}

function runChain(inWav, outWav, profile, mode = "full") {
  if (mode === "clean") {
    // -18, not -16: the clean chain has no limiter, and at -16 three samples
    // reached 0.0 dBFS.  mix.mjs trims the stem to its own target anyway, so
    // the only thing this number decides is headroom.
    const target = -18.0;
    // A loudness gain with no ceiling clipped 42 samples on the Gemini render:
    // its output is already hot, and the clean chain has no limiter to catch
    // what the gain pushes over.  Cap the gain so the peak cannot pass -1 dBFS.
    // Static arithmetic, not a dynamics processor - nothing here can pump.
    const pk = peakDbfsOf(inWav);
    const headroom = -1.0 - pk;
    const gain = Math.max(-12, Math.min(12, Math.min(target - lineLoudness(inWav), headroom)));
    const r = sh("ffmpeg", ["-y", "-nostdin", "-v", "error", "-i", inWav,
      "-filter_complex", cleanGraph(gain), "-map", "[vout]",
      "-ac", "1", "-ar", String(SR), "-c:a", "pcm_s24le", outWav]);
    if (r.status !== 0) throw new Error(`clean chain failed for ${inWav}${NL}${r.stderr}`);
    return;
  }
  const r = sh("ffmpeg", ["-y", "-nostdin", "-v", "error", "-i", inWav, "-i", IR,
    "-filter_complex", chainGraph(profile), "-map", "[vout]",
    "-ac", "1", "-ar", String(SR), "-c:a", "pcm_s24le", outWav]);
  if (r.status !== 0) throw new Error(`chain failed for ${inWav}${NL}${r.stderr}`);
}

/* -------------------------------------------------- measurement, batched */

function pyBatch(mode, files) {
  if (!files.length) return new Map();
  // One file per process.  The name used to be shared, which was harmless
  // while one film rendered at a time and silently fatal the moment three did:
  // one run's list was overwritten by another's between the write and the read,
  // and measure.py died on a path that had already moved.
  const list = path.join(OUT, `.${mode}-batch.${process.pid}.txt`);
  fs.writeFileSync(list, files.join(NL) + NL);
  const r = sh("python", [path.join(HERE, "measure.py"), `--${mode}-batch`, list],
    { timeout: 900000 });
  fs.rmSync(list, { force: true });
  if (r.status !== 0) throw new Error(`${mode} batch failed: ${r.stderr}`);
  const out = new Map();
  for (const line of (r.stdout || "").split(NL)) {
    const row = line.split(CR).join("");
    const i = row.indexOf(TAB);
    if (i > 0) out.set(row.slice(i + 1), row.slice(0, i));
  }
  return out;
}

const activeDurs = (files) =>
  new Map([...pyBatch("active", files)].map(([k, v]) => [k, parseFloat(v)]));
const speechRuns = (files) =>
  new Map([...pyBatch("runs", files)].map(([k, v]) => [k, JSON.parse(v)]));
const drawShapes = (files) =>
  new Map([...pyBatch("draw", files)].map(([k, v]) => [k, JSON.parse(v)]));

/**
 * Map raw word times onto the chained timeline.
 *
 * `silenceremove` is the only stage that changes time, and it changes it by
 * deleting silence: speech itself is never scaled.  So within one run of
 * speech every word shifts by the same constant, and aligning the runs makes
 * the mapping exact rather than approximate.  If the run counts disagree - a
 * gate opening on a breath, say - fall back to a linear map across the whole
 * line and say so, because a wrong caption time is what this revision exists
 * to fix.
 */
function speechBefore(runs, t) {
  let acc = 0;
  for (const [a, b] of runs) {
    if (t <= a) break;
    acc += Math.min(t, b) - a;
    if (t < b) break;
  }
  return acc;
}

function timeAtSpeech(runs, s) {
  let acc = 0;
  for (const [a, b] of runs) {
    const len = b - a;
    if (acc + len >= s) return a + (s - acc);
    acc += len;
  }
  return runs.length ? runs[runs.length - 1][1] : 0;
}

/**
 * Carry edge-tts's word boundaries from the raw render onto the chained one.
 *
 * `silenceremove` is the only stage that changes time, and it deletes silence
 * without scaling or reordering speech.  So a word keeps its position in the
 * *sequence of speech*, and the honest way to carry it across is the fraction
 * of the line's speech that precedes it.
 *
 * Matching run index to run index was tried first and abandoned: the de-breath
 * gate attenuates rather than mutes and the room tail extends every run, so the
 * chained file segments into fewer runs than the raw and eleven of thirteen
 * lines fell back to a whole-line stretch.  This map needs no agreement about
 * segmentation - only that speech comes in the same order, which it does.
 */
function mapWords(words, rawRuns, chRuns, rawActive, chActive) {
  if (!words.length) return { words: [], method: "none" };
  const rawTotal = rawRuns.reduce((a, [x, y]) => a + (y - x), 0);
  const chTotal = chRuns.reduce((a, [x, y]) => a + (y - x), 0);
  if (!rawRuns.length || !chRuns.length || rawTotal <= 0 || chTotal <= 0) {
    const scale = chActive / Math.max(1e-6, rawActive);
    return {
      method: "linear-fallback",
      words: words.map((w) => ({ text: w.text, start: r3(w.start * scale),
        end: r3(w.end * scale) })),
    };
  }
  const carry = (t) =>
    timeAtSpeech(chRuns, (speechBefore(rawRuns, t) / rawTotal) * chTotal);
  const out = words.map((w) => ({
    text: w.text, start: r3(carry(w.start)), end: r3(carry(w.end)),
  }));
  let prev = 0;
  for (const w of out) {
    w.start = r3(Math.max(prev, Math.min(w.start, chActive)));
    w.end = r3(Math.max(w.start, Math.min(w.end, chActive)));
    prev = w.start;
  }
  return { words: out, method: "speech-proportional" };
}

/* -------------------------------------------------------------- placement */

function place(items, seconds, outWav) {
  const inputs = [];
  items.forEach((it) => inputs.push("-i", it.file));
  const parts = [];
  items.forEach((it, i) => {
    const ms = Math.max(0, Math.round(it.start * 1000));
    parts.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=${SR}` +
      `:channel_layouts=mono,adelay=${ms}:all=1[d${i}]`);
  });
  const labels = items.map((_, i) => `[d${i}]`).join("");
  parts.push(`${labels}amix=inputs=${items.length}:normalize=0` +
    `:dropout_transition=0[sum]`);
  parts.push(`[sum]apad=whole_dur=${seconds.toFixed(3)},asetpts=N/SR/TB[vout]`);
  const r = sh("ffmpeg", ["-y", "-nostdin", "-v", "error", ...inputs,
    "-filter_complex", parts.join(";"), "-map", "[vout]",
    "-t", seconds.toFixed(3),
    "-ac", "1", "-ar", String(SR), "-c:a", "pcm_s24le", outWav],
  { timeout: 600000 });
  if (r.status !== 0) throw new Error(`placement failed${NL}${r.stderr}`);
}

/* ------------------------------------------------------------------ render */

/**
 * Draw a line three times, measure all three, keep the one that is both a
 * statement and the median length.
 *
 * The two rejections are R4 5.1.2's:
 *   - a terminal more than +1.0 ST above the line's own median f0 is the
 *     English yes/no-question contour on a statement - the delivered error;
 *   - a duration more than 5 % off the median of the three is a different
 *     performance, not a different recording of the same one.
 *
 * The verdict and its numbers go into `<line>.gate.json`, and a cached line is
 * only reused when that record still passes the CURRENT thresholds.  Tightening
 * the gate therefore invalidates the cache rather than inheriting an old pass.
 * If all three draws fail, this throws: a build step that silently accepts is
 * the recurring fault of this pipeline.
 */
function renderLine(id, tag, text, voice, rate, pitch, profile, force,
  maxTailSt = GATE.maxTailSt, salt = 0, windowSec = null) {
  const renderKey = createHash("sha1")
    .update([PROVIDER, voice, rate, pitch, text, "WordBoundary",
      PROVIDER === "gemini" ? GEMINI_DELIVERY : "", GATE.revision,
      GATE.draws, maxTailSt, GATE.maxDurDev, salt,
      // The shot window is in the key only because a full set of draws was
      // already paid for with it there. It does not belong: the window decides
      // which draw is KEPT, not what is drawn, so a shot boundary moving should
      // re-judge a cached set rather than re-render it. windowStale below does
      // that job; this line should come out when there is time to spend 65
      // requests re-drawing without it.
      windowSec == null ? "" : windowSec.toFixed(3)].join("|")).digest("hex");
  const chainKey = createHash("sha1")
    .update([renderKey, CHAIN_REVISION, CHAIN_MODE,
      JSON.stringify(profile)].join("|")).digest("hex");
  const base = path.join(VO, `${id}-${tag}`);
  const gateFile = `${base}.gate.json`;
  const raw = `${base}.wav`;
  const chained = `${base}.chain.wav`;
  const meta = `${base}.words.json`;

  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "");
  // A line may demand a harder landing than the film-wide gate: line 8 is a
  // list ending on "and the video." and list intonation lifts on the last item
  // even when the gate's +1.0 ST is satisfied.  The override travels in the
  // cache key, so tightening one line re-draws that line and nothing else.
  const passes = (m) => m && m.tailSt !== null && m.tailSt <= maxTailSt;
  if (!force && fs.existsSync(gateFile) && fs.existsSync(raw)
      && fs.existsSync(chained) && fs.existsSync(meta)) {
    const g = JSON.parse(fs.readFileSync(gateFile, "utf8"));
    // The gate judges the DRAW, not the chain.  A chain change must not send
    // the build back to the network for 39 more lottery tickets - it only
    // needs the kept draw run through the new filters.
    const windowStale = windowSec != null && g.windowSec != null
      && Math.abs(g.windowSec - windowSec) > 0.001;
    if (g.renderKey === renderKey && passes(g.kept) && !windowStale) {
      if (g.chainKey !== chainKey) {
        runChain(raw, chained, profile, CHAIN_MODE);
        g.chainKey = chainKey;
        fs.writeFileSync(gateFile, JSON.stringify(g, null, 2) + NL);
      }
      return { raw, chained, meta, calls: 0, gate: g,
        words: JSON.parse(fs.readFileSync(meta, "utf8")) };
    }
  }

  // --- draw k times -------------------------------------------------------
  // Each draw is kept on disk.  A draw that arrived is a paid, measured
  // artefact, and losing it because a later sibling 502'd made every run start
  // again from zero and pay again.
  const draws = [];
  for (let i = 1; i <= GATE.draws; i += 1) {
    const dRaw = `${base}.d${i}.wav`;
    const dMeta = `${base}.d${i}.words.json`;
    const dCh = `${base}.d${i}.chain.wav`;
    const dKey = `${base}.d${i}.key`;
    if (!force && fs.existsSync(dRaw) && fs.existsSync(dMeta)
        && fs.existsSync(dCh) && read(dKey) === chainKey) {
      draws.push({ i, raw: dRaw, chained: dCh, meta: dMeta });
      continue;
    }
    if (PROVIDER === "gemini") {
      const tmp = `${dRaw}.24k.wav`;
      const g = ttsGemini(text, voice, tmp, dMeta);
      if (!g.ok) throw new Error(`gemini tts failed on ${tag} draw ${i}: ${g.err}`);
      const c = sh("ffmpeg", ["-y", "-nostdin", "-v", "error", "-i", tmp,
        "-ac", "1", "-ar", String(SR), "-c:a", "pcm_s24le", dRaw]);
      if (c.status !== 0) throw new Error(`resample failed: ${c.stderr}`);
      fs.rmSync(tmp, { force: true });
    } else {
      const mp3 = `${dRaw}.mp3`;
      const r = tts(text, voice, rate, pitch, mp3, dMeta);
      if (!r.ok) throw new Error(`edge-tts failed on ${tag} draw ${i}: ${r.err}`);
      const c = sh("ffmpeg", ["-y", "-nostdin", "-v", "error", "-i", mp3,
        "-ac", "1", "-ar", String(SR), "-c:a", "pcm_s24le", dRaw]);
      if (c.status !== 0) throw new Error(`decode failed: ${c.stderr}`);
      fs.rmSync(mp3, { force: true });
    }
    runChain(dRaw, dCh, profile, CHAIN_MODE);
    fs.writeFileSync(dKey, chainKey + NL);
    draws.push({ i, raw: dRaw, chained: dCh, meta: dMeta });
  }

  // --- measure and judge --------------------------------------------------
  const shapes = drawShapes(draws.map((d) => d.chained));
  for (const d of draws) d.m = shapes.get(d.chained) || {};
  // The duration median comes from the draws that pass the CONTOUR test, not
  // from all of them.  A rejected performance must not get to define what a
  // normal length is: on line 6, three of five draws rose, and because they
  // also ran short they pulled the median down far enough that both good
  // draws were then rejected for being too long.  The gate blocked the build
  // on the only two takes it should have kept.
  const spoken = draws.filter((d) => passes(d.m));
  const pool = spoken.length ? spoken : draws;
  const durs = pool.map((d) => d.m.durSec || 0).slice().sort((a, b) => a - b);
  const median = durs[Math.floor(durs.length / 2)];
  for (const d of draws) {
    const dev = median > 0 ? Math.abs((d.m.durSec || 0) - median) / median : 1;
    d.devFromMedian = +dev.toFixed(4);
    d.reasons = [];
    if (!passes(d.m)) {
      d.reasons.push(d.m.tailSt === null || d.m.tailSt === undefined
        ? "no usable pitch frames"
        : `terminal ${(d.m.tailSt ?? 0) >= 0 ? "+" : ""}${(d.m.tailSt ?? 0).toFixed(2)} ` +
          `ST against its own median (limit ${maxTailSt >= 0 ? "+" : ""}` +
          `${maxTailSt.toFixed(1)}) - it does not land`);
    }
    if (dev > GATE.maxDurDev) {
      d.reasons.push(`duration ${(d.m.durSec || 0).toFixed(3)} s is ` +
        `${(dev * 100).toFixed(1)} % off the median ${median.toFixed(3)} s ` +
        `(limit ${(GATE.maxDurDev * 100).toFixed(0)} %)`);
    }
    d.ok = d.reasons.length === 0;
  }
  const survivors = draws.filter((d) => d.ok);
  if (!survivors.length) {
    const why = draws.map((d) => `    draw ${d.i}: ${d.reasons.join("; ")}`)
      .join(NL);
    throw new Error(`draw gate: all ${GATE.draws} draws of line ${tag} failed.` +
      `${NL}${why}${NL}  Text: "${text}"`);
  }
  // Prefer a draw that fits the shot; among those, the longest, because the
  // same words read longer are read less hurriedly.  Fall back to the shortest
  // only when nothing fits - it is the nearest miss and the one worth
  // reporting.
  let kept;
  let keptWhy;
  const fitting = windowSec
    ? survivors.filter((d) => (d.m.durSec || 0) <= windowSec + 0.001) : [];
  if (fitting.length) {
    fitting.sort((a, b) => (b.m.durSec || 0) - (a.m.durSec || 0));
    kept = fitting[0];
    keptWhy = `${fitting.length} of ${survivors.length} surviving draw(s) fit `
      + `the ${windowSec.toFixed(2)} s shot; this is the longest of them, at `
      + `${(kept.m.durSec || 0).toFixed(3)} s`;
  } else if (windowSec) {
    survivors.sort((a, b) => (a.m.durSec || 0) - (b.m.durSec || 0));
    kept = survivors[0];
    keptWhy = `no surviving draw fit the ${windowSec.toFixed(2)} s shot; this `
      + `is the shortest, at ${(kept.m.durSec || 0).toFixed(3)} s`;
  } else {
    survivors.sort((a, b) => a.devFromMedian - b.devFromMedian);
    kept = survivors[0];
    keptWhy = `ranked by distance from the median duration; this one is `
      + `${(kept.devFromMedian * 100).toFixed(1)} % off`;
  }

  fs.copyFileSync(kept.raw, raw);
  fs.copyFileSync(kept.chained, chained);
  fs.copyFileSync(kept.meta, meta);
  const record = {
    renderKey, chainKey, text, windowSec,
    gate: { ...GATE },
    medianDurSec: +median.toFixed(3),
    keptDraw: kept.i,
    keptBecause: keptWhy,
    kept: kept.m,
    draws: draws.map((d) => ({ draw: d.i, ...d.m,
      devFromMedian: d.devFromMedian, accepted: d.ok, rejectedFor: d.reasons })),
  };
  fs.writeFileSync(gateFile, JSON.stringify(record, null, 2) + NL);
  return { raw, chained, meta, calls: GATE.draws, gate: record,
    words: JSON.parse(fs.readFileSync(meta, "utf8")) };
}

/* ------------------------------------------------------------------- sweep */

/**
 * Pick the one fixed setting for the film.
 *
 * Revision 3 wants the slowest delivery that still lets every line finish
 * inside its own shot, so the sweep runs candidates from slow to fast and
 * reports the first that fits, on the lines with the least slack.
 */
function sweep(cues, voice, profile) {
  // Slowest first, and stop at the first that fits: revision 3 wants the
  // unhurried end of the range, and every candidate costs 13 network calls.
  const CANDIDATES = [
    { rate: 0, pitch: -8 }, { rate: 4, pitch: -6 }, { rate: 8, pitch: -4 },
    { rate: 12, pitch: -2 },
  ];
  const lines = cues.voice.lines;
  console.log(`sweep  ${voice}  ${lines.length} lines, slowest first`);
  const results = [];
  for (const c of CANDIDATES) {
    const rate = fmtRate(c.rate);
    const pitch = fmtPitch(c.pitch);
    const files = [];
    const per = [];
    for (const l of lines) {
      const tag = `sw${String(c.rate).replace("-", "m")}-${String(l.n).padStart(2, "0")}`;
      const r = renderLine(cues.id, tag, l.text, voice, rate, pitch, profile, false);
      files.push(r.chained);
      per.push({ l, chained: r.chained });
    }
    const act = activeDurs(files);
    let worst = Infinity;
    let worstLine = null;
    let overs = 0;
    for (const { l, chained } of per) {
      const d = act.get(chained) ?? dur(chained);
      const slack = l.shotOutSec - (l.atSec + d);
      if (slack < worst) { worst = slack; worstLine = l.n; }
      if (slack < 0) overs += 1;
    }
    results.push({ ...c, rate, pitch, worst, worstLine, overs });
    if (overs === 0) {
      console.log(`  ${rate.padStart(4)} / ${pitch.padStart(5)}   tightest line ` +
        `${String(worstLine).padStart(2)}  slack +${worst.toFixed(2)} s   all lines fit`);
      break;
    }
    console.log(`  ${rate.padStart(4)} / ${pitch.padStart(5)}   ` +
      `tightest line ${String(worstLine).padStart(2)}  slack ` +
      `${worst >= 0 ? "+" : ""}${worst.toFixed(2)} s   ` +
      `${overs} line(s) overrun`);
  }
  const fit = results.find((r) => r.overs === 0);
  if (fit) {
    console.log(`  -> slowest setting that fits: ${fit.rate} / ${fit.pitch} ` +
      `(tightest slack ${fit.worst.toFixed(2)} s on line ${fit.worstLine})`);
  } else {
    console.log("  -> nothing fits; the shots are shorter than the copy");
  }
  return fit;
}

/* --------------------------------------------------------------------- main */

function main() {
  const id = arg("id");
  if (!id) {
    console.error("usage: node voice.mjs --id <film-id> [--sweep] [--force]");
    process.exit(2);
  }
  const cuePath = arg("cues") || path.join(HERE, "cues", `${id}.cues.json`);
  const cues = JSON.parse(fs.readFileSync(cuePath, "utf8"));
  const v = cues.voice;
  const force = !!arg("force", false);
  const voice = arg("voice") || (arg("fallback", false) ? v.fallback : v.voice);
  const profile = PROFILES[voice] || DEFAULT_PROFILE;
  const seconds = cues.seconds;

  if (/Andrew|Guy|Roger/i.test(voice)) {
    console.error(`refusing: ${voice} is a male voice (bible 6.6)`);
    process.exit(2);
  }
  if (!fs.existsSync(IR)) {
    console.error(`missing ${IR}. Run: python room.py`);
    process.exit(2);
  }
  fs.mkdirSync(VO, { recursive: true });

  if (arg("sweep", false)) { sweep(cues, voice, profile); return; }

  // ONE setting for the whole film.  firm and warm live in the punctuation of
  // the line, not in the settings (bible 6.6 rev 3).
  const rate = v.rate ?? "+8%";
  const pitch = v.pitch ?? "-4Hz";
  console.log(`voice  ${id}  ${PROVIDER}  ${voice}  ${CHAIN_MODE} chain  ${v.lines.length} lines` +
    `  de-ess ${profile.deEssHz} Hz  presence ${profile.presenceHz} Hz ` +
    `+${profile.presenceDb} dB`);

  let calls = 0;
  const lines = [];
  for (const l of v.lines) {
    const tag = String(l.n).padStart(2, "0");
    // A line whose whole draw set fails is not a bug: it is that wording
    // reliably producing the wrong contour.  Bumping its salt buys a fresh set
    // of tickets without re-drawing anything else; if a second set fails too,
    // the wording is the problem and the report says so.
    const r = renderLine(id, tag, l.text, voice, rate, pitch, profile, force,
      l.maxTailSt ?? GATE.maxTailSt, l.drawSalt ?? 0,
      l.shotOutSec != null ? l.shotOutSec - l.atSec : null);
    calls += r.calls;
    lines.push({ ...l, ...r });
  }

  // ---- measure, then map the word boundaries onto the chained timeline ----
  const chained = lines.map((l) => l.chained);
  const raws = lines.map((l) => l.raw);
  const act = activeDurs([...chained, ...raws]);
  const runs = speechRuns([...chained, ...raws]);
  let inexact = 0;
  for (const l of lines) {
    l.dur = act.get(l.chained) ?? dur(l.chained);
    l.fileDur = dur(l.chained);
    l.rawDur = dur(l.raw);
    if (!l.words.length) {
      // No word-boundary stream on /audio/speech, so words are placed by
      // proportion of the line.  Said plainly in the report rather than
      // dressed up as measurement.
      const ws = l.text.trim().split(/\s+/);
      l.words = ws.map((w, i) => ({ text: w,
        start: (i / ws.length) * l.dur,
        end: ((i + 1) / ws.length) * l.dur }));
      l.proportionalWords = true;
    }
    const m = mapWords(l.words, runs.get(l.raw) || [], runs.get(l.chained) || [],
      act.get(l.raw) ?? l.rawDur, l.dur);
    l.mapped = m.words;
    l.wordMethod = m.method;
    if (m.method === "linear-fallback") inexact += 1;
  }

  // ---- the close: the film is its window, not the card -------------------
  //
  // Ruling of 2026-09-06(b).  The spoken close is drawn against a 4.25 s end
  // card, but the card is not what it has to fit: it has to STOP before the
  // film does, and when the body ahead of it runs long it starts late and the
  // card it actually gets is shorter than 4.25 s.  So among the draws that
  // passed the contour gate, keep the longest that ENDS inside the film, and
  // the shortest if none does.
  //
  // This re-judges the set that is already on disk; it never asks the network
  // for anything.  A paid draw that was rejected for being too long for one
  // start is the right take at another.
  const closeLine = lines[lines.length - 1];
  const isClose = (closeLine.shotOutSec ?? 0) >= seconds - 0.001;
  if (isClose && closeLine.gate && closeLine.gate.draws) {
    const fps0 = cues.fps || 30;
    const toFrame0 = (t) => Math.ceil(t * fps0 - 1e-6) / fps0;
    let prev = 0;
    for (const l of lines.slice(0, -1)) {
      const st = Math.max(l.atSec, prev > 0 ? toFrame0(prev + 0.20) : 0);
      prev = st + l.dur;
    }
    const closeStart = Math.max(closeLine.atSec,
      prev > 0 ? toFrame0(prev + 0.20) : 0);
    const room = seconds - closeStart;
    const base = path.join(VO, `${id}-${String(closeLine.n).padStart(2, "0")}`);
    const ok = closeLine.gate.draws.filter((d) => d.accepted
      && fs.existsSync(`${base}.d${d.draw}.chain.wav`));
    if (ok.length) {
      const dAct = activeDurs(ok.map((d) => `${base}.d${d.draw}.chain.wav`));
      for (const d of ok) {
        d.actDur = dAct.get(`${base}.d${d.draw}.chain.wav`) ?? d.durSec;
      }
      const inside = ok.filter((d) => d.actDur <= room + 0.001)
        .sort((a, b) => b.actDur - a.actDur);
      const pick = inside.length
        ? inside[0]
        : ok.slice().sort((a, b) => a.actDur - b.actDur)[0];
      const why = inside.length
        ? `${inside.length} of ${ok.length} draw(s) end inside the film from `
          + `${closeStart.toFixed(2)}; this is the longest, at `
          + `${pick.actDur.toFixed(3)} s`
        : `no draw ends inside the film from ${closeStart.toFixed(2)} `
          + `(${room.toFixed(2)} s of room); this is the shortest, at `
          + `${pick.actDur.toFixed(3)} s`;
      if (pick.draw !== closeLine.gate.keptDraw) {
        console.log(`  close re-judged: draw ${closeLine.gate.keptDraw} -> `
          + `${pick.draw}. ${why}`);
        fs.copyFileSync(`${base}.d${pick.draw}.wav`, closeLine.raw);
        fs.copyFileSync(`${base}.d${pick.draw}.chain.wav`, closeLine.chained);
        fs.copyFileSync(`${base}.d${pick.draw}.words.json`, closeLine.meta);
        const re = activeDurs([closeLine.chained, closeLine.raw]);
        closeLine.dur = re.get(closeLine.chained) ?? pick.actDur;
        closeLine.fileDur = dur(closeLine.chained);
        closeLine.rawDur = dur(closeLine.raw);
        const ws = closeLine.text.trim().split(/\s+/);
        closeLine.words = ws.map((w, i) => ({ text: w,
          start: (i / ws.length) * closeLine.dur,
          end: ((i + 1) / ws.length) * closeLine.dur }));
        closeLine.mapped = closeLine.words;
        closeLine.gate.keptDraw = pick.draw;
        closeLine.gate.keptBecause = why;
        fs.writeFileSync(path.join(VO,
          `${id}-${String(closeLine.n).padStart(2, "0")}.gate.json`),
        JSON.stringify(closeLine.gate, null, 2) + NL);
      }
    }
  }

  // ---- place: the picture is the clock -----------------------------------
  // Each line starts on its anchor from the shot table.  There is no gap
  // solver and no pulling a line early: revision 2 paced to a gap budget and
  // finished 1.31 s ahead of its picture.
  // The picture is the clock, and a neighbour is part of the clock.  R4 5.1.3
  // found line 13 starting while line 12 was still speaking, with both marked
  // as fitting because each was only ever compared with its own shot.  A line
  // now also has to start clear of the one before it, by NEIGHBOUR_GAP,
  // snapped up to the next frame.
  const NEIGHBOUR_GAP = 0.20;
  // The end card the spoken close is read over, ruling of 2026-09-06.
  const CLOSE_CARD_SEC = 4.25;
  const fps = cues.fps || 30;
  const toFrame = (t) => Math.ceil(t * fps - 1e-6) / fps;
  //
  // THE RULING OF 2026-09-06, AND WHAT IT REPLACED
  //
  // "The picture is the clock for STARTS only: a line may run past its shot
  // into the next as long as it ends at least 0.20 s before the next line
  // starts, and the last body line must end before the close's anchor."
  //
  // So a line crossing a shot boundary is no longer a fault - the feature and
  // tool skeletons are a fixed 2 s grid carrying 8-13 word lines and a line
  // ending inside its own shot was never on the table.  What IS a fault is a
  // line whose length pushes the NEXT line off its anchor, because that start
  // is then no longer on the picture.  Each line is therefore judged against
  // the moment it has to be finished by - 0.20 s before the next line's own
  // anchor, or the end of the film for the last one - and `slackSec` is the
  // margin against THAT, not against the shot.
  //
  // The placement itself still pushes a colliding line: two lines speaking at
  // once is not a deliverable, and a push is the honest record of the fault
  // rather than the fault itself.
  //
  // THE PAUSE BEFORE THE OUTRO (research/63 §3, gated by compose/verify.mjs)
  //
  // The one place the anchor is NOT the clock is the spoken close, and the
  // reason is that the anchor was written against a PLANNED read of 0.33 s a
  // word while the delivered read is 0.28 to 0.35.  When a film comes in fast
  // the body finishes early, the close still waits for its hand-typed anchor,
  // and what is left is the silence Nader filed in research/50: 0.84 s on
  // `record-a-session`, 1.54 s on `the-tools`, against a 0.60 s ceiling.
  //
  // `verify.mjs`'s own note names the fix - "compute the close's startSec from
  // the previous line's MEASURED end plus 0.40 s rather than from a hand-typed
  // anchor" - and says the gate row exists to check that the fix held.  This is
  // that fix, and it is deliberately the smallest version of it:
  //
  //   * it only ever moves the close EARLIER, never later;
  //   * it only fires when the anchor would leave more than the 0.60 s the gate
  //     allows, so a film whose body lands on plan is placed exactly as before;
  //   * it lands the close 0.40 s after the body, so the pull is at most the
  //     overshoot itself, not a free hand with the picture.
  //
  // What it costs: the close can begin up to about a second before the end card
  // cuts in, over the tail of the last body shot.  That is a J-cut into the
  // outro, and it is the trade research/63 §3 already chose.  Nothing here is
  // re-drawn or re-measured; only the placement moves.
  const CLOSE_GAP_MAX = 0.60;
  const CLOSE_LEAD = 0.40;
  const closeIndex = isClose ? lines.length - 1 : -1;
  let prevEnd = 0;
  lines.forEach((l, i) => {
    const floorStart = toFrame(prevEnd + NEIGHBOUR_GAP);
    let start = Math.max(l.atSec, prevEnd > 0 ? floorStart : 0);
    if (i === closeIndex && prevEnd > 0 && start - prevEnd > CLOSE_GAP_MAX) {
      l.pulledForCloseGapSec = r3(start - toFrame(prevEnd + CLOSE_LEAD));
      l.closeGapWas = r3(start - prevEnd);
      start = toFrame(prevEnd + CLOSE_LEAD);
    }
    l.startSec = r3(start);
    l.movedForNeighbour = l.startSec > l.atSec + 1e-6;
    l.endSec = r3(l.startSec + l.dur);
    prevEnd = l.endSec;
    const next = lines[i + 1];
    // The last line's deadline is the end of the film only when the last line
    // IS the spoken close - which is exactly the case where its own shot runs
    // to the end of the film.  A feature film has no close: its end card is
    // picture, and its last body line is due at the close's anchor, the film
    // end less the 4.25 s card, the same moment a tool film's close starts.
    const lastDue = (l.shotOutSec ?? seconds) >= seconds - 0.001
      ? seconds : r3(seconds - CLOSE_CARD_SEC);
    l.dueBySec = r3(next ? next.atSec - NEIGHBOUR_GAP : lastDue);
    l.slackSec = r3(l.dueBySec - l.endSec);
    l.late = l.slackSec < -0.001;
    l.fits = !l.late && !l.movedForNeighbour;
    l.fitsShot = l.endSec <= l.shotOutSec + 0.001;
    l.wordsAbs = l.mapped.map((w) => ({
      text: w.text, start: r3(l.startSec + w.start), end: r3(l.startSec + w.end),
    }));
  });

  const items = lines.map((l) => ({ file: l.chained, start: l.startSec }));
  const stem = path.join(OUT, `${id}-vo.wav`);
  place(items, seconds, stem);
  place(lines.map((l) => ({ file: l.raw, start: l.startSec })), seconds,
    path.join(OUT, `${id}-vo-raw.wav`));

  // ---- caption chunks: a chunk enters on its first word ------------------
  const chunks = [];
  for (const l of lines) {
    const spec = l.chunks;
    if (!spec || !spec.length) continue;
    let wi = 0;
    const starts = [];
    for (const c of spec) {
      const n = c.trim().split(/\s+/).length;
      const w = l.wordsAbs[wi];
      starts.push({ text: c, shot: l.shot, line: l.n,
        inSec: w ? w.start : l.startSec,
        lastWordEnd: l.wordsAbs[Math.min(wi + n - 1, l.wordsAbs.length - 1)]
          ? l.wordsAbs[Math.min(wi + n - 1, l.wordsAbs.length - 1)].end
          : l.endSec });
      wi += n;
    }
    for (let i = 0; i < starts.length; i += 1) {
      const next = starts[i + 1];
      starts[i].outSec = next ? next.inSec : r3(l.endSec);
      chunks.push(starts[i]);
    }
  }
  for (let i = 0; i < chunks.length; i += 1) {
    const next = chunks[i + 1];
    // a chunk leaves when the next chunk starts, across lines too
    if (next && next.inSec > chunks[i].outSec) chunks[i].outSec = next.inSec;
    chunks[i].inSec = r3(chunks[i].inSec);
    chunks[i].outSec = r3(chunks[i].outSec);
  }

  // ---- rests, against the shot table -------------------------------------
  const rests = cues.rests || [];
  const declared = (a, b) => rests.some((r) =>
    a >= r.fromSec - 0.25 && b <= r.toSec + 0.25);
  const gaps = [];
  let cursor = 0;
  for (const l of lines) {
    if (l.startSec - cursor >= 0.4) {
      gaps.push({ fromSec: r3(cursor), toSec: r3(l.startSec),
        durSec: r3(l.startSec - cursor),
        declared: declared(cursor, l.startSec), beforeLine: l.n });
    }
    cursor = Math.max(cursor, l.endSec);
  }
  if (seconds - cursor >= 0.4) {
    gaps.push({ fromSec: r3(cursor), toSec: seconds, durSec: r3(seconds - cursor),
      declared: declared(cursor, seconds), beforeLine: null });
  }

  const speech = lines.reduce((a, l) => a + l.dur, 0);
  const words = v.lines.reduce((a, l) => a + l.text.trim().split(/\s+/).length, 0);
  const report = {
    id, revision: cues.revision ?? 3, voice, fallback: v.fallback,
    rate, pitch, profile, seconds,
    consistency: PROVIDER === "gemini"
      ? "one google/gemini-3.1-flash-tts-preview request per line via "
        + "OpenRouter /v1/audio/speech (response_format pcm, 24 kHz mono "
        + "s16le); one voice and one delivery instruction for the whole film; "
        + "delivery is natural language at the head of the input, not a rate "
        + "or pitch parameter"
      : "one edge-tts request per line; one fixed rate and pitch for the whole "
        + "film; delivery lives in the punctuation, not the settings",
    clock: "each line starts on its shot-table anchor and must end inside its "
      + "own shot",
    lines: lines.map((l) => ({
      n: l.n, shot: l.shot, delivery: l.delivery, text: l.text,
      anchorSec: l.atSec, startSec: l.startSec, endSec: l.endSec,
      durSec: r3(l.dur), rawSec: r3(l.rawDur),
      shotInSec: l.shotInSec, shotOutSec: l.shotOutSec,
      slackSec: l.slackSec, dueBySec: l.dueBySec, lateBySec: l.late ? r3(-l.slackSec) : 0,
      fitsInShot: l.fitsShot,
      clearOfPrevious: !l.movedForNeighbour,
      movedForNeighbourSec: l.movedForNeighbour
        ? r3(l.startSec - l.atSec) : 0,
      ...(l.pulledForCloseGapSec ? {
        pulledForCloseGapSec: l.pulledForCloseGapSec,
        closeGapWouldHaveBeenSec: l.closeGapWas,
        pulledWhy: "research/63 §3: the anchor would have left "
          + `${l.closeGapWas.toFixed(2)} s of silence before the outro, over the `
          + "0.60 s the pause gate allows, so the close is placed 0.40 s after "
          + "the body's measured end instead of on its anchor",
      } : {}),
      gate: l.gate ? {
        keptDraw: l.gate.keptDraw, keptBecause: l.gate.keptBecause,
        kept: l.gate.kept, draws: l.gate.draws,
      } : null,
      wordTimeMethod: l.proportionalWords ? "proportional (no word\n        boundaries on this endpoint)" : l.wordMethod,
      ...(cues.voice.captionMode === "per-line" ? {} : { words: l.wordsAbs }),
      file: path.relative(HERE, l.chained).split("\\").join("/"),
    })),
    ...(cues.voice.captionMode === "per-line"
      ? { captionMode: "per-line",
          captionNote: "one caption per line, in at startSec and out at "
            + "endSec. This endpoint returns no word boundaries and a "
            + "proportional guess is not a timing, so none is offered." }
      : { captionChunks: chunks }),
    spokenSec: r3(speech), spokenPct: r3((speech / seconds) * 100),
    words, wpm: Math.round((words / speech) * 60),
    secPerWord: r3(speech / words),
    lastEndSec: lines[lines.length - 1].endSec,
    gaps, egressCalls: calls,
    stem: path.relative(HERE, stem).split("\\").join("/"),
  };
  fs.writeFileSync(path.join(OUT, `${id}-vo.json`),
    JSON.stringify(report, null, 2) + NL);

  for (const l of lines) {
    const mark = l.late ? "!" : l.movedForNeighbour ? ">" : " ";
    console.log(`${mark} ${String(l.n).padStart(2)} shot ${String(l.shot).padStart(2)} ` +
      `${l.delivery.padEnd(4)} ${l.startSec.toFixed(2)} -> ${l.endSec.toFixed(2)}  ` +
      `due ${l.dueBySec.toFixed(2)}  slack ` +
      `${l.slackSec >= 0 ? "+" : ""}${l.slackSec.toFixed(2)}  ` +
      `${l.fitsShot ? "in shot" : "crosses"}  ` +
      `"${l.text.slice(0, 34)}"`);
  }
  console.log(`  spoken ${report.spokenSec.toFixed(2)} s of ${seconds} ` +
    `(${report.spokenPct.toFixed(1)} %), ${words} words, ${report.wpm} wpm, ` +
    `${report.secPerWord} s/word, ${calls} edge-tts call(s)`);
  console.log(`  ${chunks.length} caption chunks; word times carried by speech proportion` +
    `${inexact ? `, ${inexact} line(s) on the linear fallback` : " on every line"}`);
  for (const g of gaps) {
    console.log(`  rest ${g.fromSec.toFixed(2)} -> ${g.toSec.toFixed(2)} ` +
      `(${g.durSec.toFixed(2)} s) ${g.declared ? "declared" : "UNDECLARED"}`);
  }
  for (const l of lines.filter((x) => x.pulledForCloseGapSec)) {
    console.log(`  close pulled ${l.pulledForCloseGapSec.toFixed(2)} s earlier than its `
      + `${l.atSec.toFixed(2)} anchor, to ${l.startSec.toFixed(2)}: the anchor would `
      + `have left ${l.closeGapWas.toFixed(2)} s of silence before the outro `
      + "(gate: 0.60 s)");
  }
  for (const l of lines.filter((x) => x.movedForNeighbour)) {
    console.log(`  moved: line ${l.n} anchored ${l.atSec.toFixed(3)} starts ${l.startSec.toFixed(3)} - line ${l.n - 1} was still speaking until ${lines[l.n - 2].endSec.toFixed(3)}`);
  }
  const bad = lines.filter((l) => l.late);
  for (const l of bad) {
    const next = lines.find((x) => x.n === l.n + 1);
    console.log(`  PROBLEM: line ${l.n} ends ${l.endSec.toFixed(2)} and is due ` +
      `${l.dueBySec.toFixed(2)} - ${(-l.slackSec).toFixed(2)} s late` +
      (next ? `; line ${next.n} cannot start on its ${next.atSec.toFixed(2)} anchor`
            : "; that is past the end of the film"));
  }
  console.log(`  -> ${stem}`);
  if (bad.length) process.exitCode = 1;
  else if (gaps.some((g) => !g.declared)) process.exitCode = 3;
}

main();
