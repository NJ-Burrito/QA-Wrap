/* QA Wrap - Bug Hunt LOCAL voice render (owner exception of 2026-10-12: free local TTS, English only, no key, no account).
 *
 * Engine: Kokoro-82M v1.0 (Apache-2.0 weights) through the `kokoro-js` npm package (Apache-2.0, ONNX Runtime in Node).
 * It is a separate tool from tools/voice-render.mjs (the Kore/OpenRouter renderer, untouched). Nothing here calls a network
 * service except the one-time model download from Hugging Face (cached under node_modules); no key is read or written.
 *
 *   node tools/voice-render-local.mjs                      plan only: lists the lines, the settings, what exists
 *   node tools/voice-render-local.mjs --rehearse --only v10 --speed 1 [--out DIR]
 *                                                          one line into a scratch folder, prints seconds + wpm, touches nothing else
 *   node tools/voice-render-local.mjs --go --speed 0.9     voice all 11 lines ONCE into game/audio/en/vNN.wav and update the manifest
 *   node tools/voice-render-local.mjs --go --retune        same, but each line gets its own speed = previous speed x 146 / previous wpm
 *                                                          (from the last run in the log), so every line lands near 146 wpm
 *
 * Rules kept from the Kore tool: each line is voiced once (no best-of-N, no ASR, no judge, no re-voice); an existing take is
 * never overwritten (it is skipped and reported); the stale check (sha1_16 of direction+text) refuses a changed line.
 * One retry only if a run produced no audio at all (empty buffer or a thrown error).
 *
 * Install (not saved to package.json; the game is not in the store zip):  npm install --no-save kokoro-js@1.2.1   (from extension/)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXT = path.resolve(HERE, '..');
export const REPO = path.resolve(EXT, '..');
export const AUDIO = path.join(EXT, 'game', 'audio');
export const MANIFEST = path.join(AUDIO, 'narration-manifest.json');
export const OUT_DIR = path.join(AUDIO, 'en');
export const LOG = path.join(REPO, 'work', 'sdlc', 'build', 'notes-game', 'voice-local-render-log.json');

export const ENGINE = {
  name: 'Kokoro-82M',
  model_id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  package: 'kokoro-js',
  package_version: '1.2.1',
  dtype: 'fp32',
  device: 'cpu',
  voice: 'af_heart',
  licence: 'Apache-2.0 (model weights and kokoro-js); espeak-ng phonemiser via the phonemizer package',
  sample_rate: 24000,
};
export const WPM_BAND = [150, 170];
export const TARGET_WPM = 158;
/** Per-line pace targets (owner amendment 2026-10-12: energetic). Level instructions stay clear (at most 160); praise and finale run faster. */
export const TARGETS = { v01: 158, v02: 155, v03: 155, v04: 155, v05: 155, v06: 155, v07: 168, v08: 168, v09: 168, v10: 155, v11: 168 };
/** TTS input only: exclamation marks lift the delivery. The caption and manifest "text" are never changed. */
export const LIFT = {
  v01: "Welcome! Catch one bug on each page, and you will finish with a real bug report!",
  v02: "Level one! Open QA Wrap and press its main button to wake it. Then press the save button on this page.",
  v03: "Level two! Apply a coupon, and QA Wrap catches what breaks. If another failure is harmless, tell QA Wrap it is not a real bug.",
  v04: "Level three! Press the next button. If nothing happens, type what you saw in the QA Wrap note box, and press Enter.",
  v05: "Level four! Does the order number fit its box? Take a screenshot with QA Wrap, then mark the spot on it.",
  v06: "Level five! Press the pay button. Then stop QA Wrap, copy the report, and paste it here.",
  v07: "Nice catch! That is exactly the kind of bug to note!",
  v08: "Good evidence! Short and clear is all a report needs!",
  v09: "Good rhythm so far! Keep noting what you see, it is the habit that matters!",
  v11: "Well done! Notice the bug, note it, copy the report! That is the whole job, and it works on any site!",
};
export const ttsText = (l) => LIFT[l.id] || l.text;

export const sha1_16 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 16);
export const wordCount = (t) => t.trim().split(/\s+/).filter(Boolean).length;

/** Trim leading/trailing silence (5 ms RMS windows under -46 dBFS), keep a short natural pad, fade the edges, peak-normalise. */
export function shape(samples, sr = 24000, { floor = 0.005, leadMs = 60, tailMs = 140, fadeMs = 8, peak = 0.89 } = {}) {
  const win = Math.max(1, Math.round(sr * 0.005));
  const loud = (i) => { let s = 0; const e = Math.min(samples.length, i + win); for (let k = i; k < e; k++) s += samples[k] * samples[k]; return Math.sqrt(s / (e - i)) > floor; };
  let a = 0; while (a < samples.length && !loud(a)) a += win;
  let b = samples.length; while (b > a && !loud(Math.max(0, b - win))) b -= win;
  if (b <= a) return new Float32Array(0);
  a = Math.max(0, a - Math.round(sr * leadMs / 1000));
  b = Math.min(samples.length, b + Math.round(sr * tailMs / 1000));
  const out = Float32Array.from(samples.subarray(a, b));
  const f = Math.min(Math.round(sr * fadeMs / 1000), out.length >> 1);
  for (let i = 0; i < f; i++) { const g = i / f; out[i] *= g; out[out.length - 1 - i] *= g; }
  let mx = 0; for (const v of out) mx = Math.max(mx, Math.abs(v));
  if (mx > 0) { const k = peak / mx; for (let i = 0; i < out.length; i++) out[i] *= k; }
  return out;
}

/** 24 kHz mono 16-bit PCM WAV. */
export function toWav(samples, sr = 24000) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

async function loadTts(engine) {
  const { KokoroTTS } = await import('kokoro-js');
  return KokoroTTS.from_pretrained(engine.model_id, { dtype: engine.dtype, device: engine.device });
}

/** Voice one line once; one retry only when no audio at all came back. */
async function voiceOnce(tts, line, { voice, speed }) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await tts.generate(ttsText(line), { voice, speed });
      const wav = shape(r.audio, r.sampling_rate || 24000);
      if (wav.length > 2400) return { wav, attempt };
    } catch (e) { if (attempt === 2) throw e; }
  }
  throw new Error(`${line.id}: no audio after the one allowed retry`);
}

function arg(argv, name, dflt) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; }

export async function main(argv = process.argv.slice(2)) {
  const go = argv.includes('--go');
  const rehearse = argv.includes('--rehearse');
  const only = arg(argv, '--only', '');
  const speed = Number(arg(argv, '--speed', '1'));
  const voice = arg(argv, '--voice', ENGINE.voice);
  const calib = Number(arg(argv, '--calib', '1'));
  const retune = argv.includes('--retune');
  const outDir = rehearse ? path.resolve(arg(argv, '--out', path.join(os.tmpdir(), 'bh-voice-local'))) : OUT_DIR;
  const engine = { ...ENGINE, voice };
  const speedOf = {};
  if (retune) {
    const last = (fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')).runs : []).at(-1);
    if (!last) { console.error('REFUSED: --retune needs a previous run in the log'); return 2; }
    for (const r of last.lines) speedOf[r.id] = Math.round(Math.min(1.5, Math.max(0.5, (r.speed || last.speed) * (TARGETS[r.id] || TARGET_WPM) / r.wpm / calib)) * 1000) / 1000;
  }
  const spd = (id) => speedOf[id] ?? speed;
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const lines = m.lines.filter((l) => !only || l.id === only);
  if (!lines.length) { console.error(`no such line: ${only}`); return 2; }
  const stale = lines.filter((l) => l.sha1_16 !== sha1_16(l.direction + l.text));
  if (stale.length) { console.error(`REFUSED: stale line(s) ${stale.map((l) => l.id).join(',')} (sha1_16 differs from direction+text)`); return 2; }
  if (!(speed >= 0.5 && speed <= 1.5)) { console.error('REFUSED: --speed must be 0.5 to 1.5'); return 2; }
  const fileOf = (l) => path.join(outDir, `${l.id}.wav`);
  console.log(`engine ${engine.name} (${engine.package} ${engine.package_version}, ${engine.dtype}), voice ${voice}, speed ${retune ? 'per-line (retuned)' : speed}, mode ${go ? 'GO' : rehearse ? 'REHEARSE' : 'PLAN'}`);
  if (!go && !rehearse) { for (const l of lines) console.log(`${l.id} ${wordCount(l.text)}w ${fs.existsSync(fileOf(l)) ? 'EXISTS (kept)' : 'to voice'}`); return 0; }

  fs.mkdirSync(outDir, { recursive: true });
  const todo = lines.filter((l) => !fs.existsSync(fileOf(l)));
  for (const l of lines) if (!todo.includes(l)) console.log(`${l.id}: take exists, not overwritten`);
  if (!todo.length) return 0;
  const tts = await loadTts(engine);
  const results = [];
  for (const l of todo) {
    const { wav, attempt } = await voiceOnce(tts, l, { voice, speed: spd(l.id) });
    fs.writeFileSync(fileOf(l), toWav(wav));
    const seconds = Math.round((wav.length / 24000) * 100) / 100;
    const words = wordCount(l.text);
    const wpm = Math.round((words / seconds) * 600) / 10;
    results.push({ id: l.id, words, seconds, wpm, speed: spd(l.id), target_wpm: TARGETS[l.id] || TARGET_WPM, tts_text: ttsText(l), attempt });
    console.log(`${l.id}: ${words} words, ${seconds} s, ${wpm} wpm -> ${path.relative(REPO, fileOf(l)).replace(/\\/g, '/')}`);
  }
  if (rehearse) { console.log('REHEARSAL only: manifest and game/ untouched'); return 0; }

  // manifest + log (only on a full or partial --go)
  const stamp = new Date().toISOString();
  for (const r of results) {
    const l = m.lines.find((x) => x.id === r.id);
    Object.assign(l, { file: `audio/en/${r.id}.wav`, seconds: r.seconds, seconds_basis: 'measured from the rendered WAV (silence trimmed, 24 kHz mono 16-bit)', tempo: 1, wpm: r.wpm, tts_text: r.tts_text, engine: `${engine.name} ${engine.voice} speed ${r.speed}`, file_status: 'ok' });
  }
  const done = m.lines.filter((l) => l.file_status === 'ok');
  m.voice = voice;
  m.model = engine.model_id;
  m.engine = { ...engine, speed: retune ? 'per-line' : speed, calib, rendered: stamp, note: 'Bug Hunt owner exception 2026-10-12: free local TTS, no paid service; English only; each line voiced once.' };
  m.pace_wpm = TARGET_WPM;
  m.band = WPM_BAND;
  m.total_seconds = Math.round(done.reduce((s, l) => s + (l.seconds || 0), 0) * 100) / 100;
  delete m.total_seconds_est;
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1) + '\n');
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const prev = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : { runs: [] };
  prev.runs.push({ at: stamp, engine, speed: retune ? 'per-line' : speed, calib, trim: 'floor 0.005 RMS/5 ms, pad 60 ms lead 140 ms tail, 8 ms fades, peak 0.89', lines: results, total_seconds: Math.round(results.reduce((s, r) => s + r.seconds, 0) * 100) / 100 });
  fs.writeFileSync(LOG, JSON.stringify(prev, null, 1) + '\n');
  console.log(`manifest updated, log ${path.relative(REPO, LOG).replace(/\\/g, '/')}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then((c) => process.exit(c), (e) => { console.error(e && e.stack || e); process.exit(1); });
}
