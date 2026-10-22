#!/usr/bin/env node
/* Bug Hunt voice renderer: Kore on Gemini TTS, English AND Arabic (owner decision, Nader 2026-10-12). Dev-only, never packaged,
 * never part of any test run against the network.
 *
 *   node tools/voice-render.mjs            -> plan only: validates, runs the gate, lists what would be voiced, 0 calls
 *   node tools/voice-render.mjs --go       -> the ONE render (voices 11 English + 11 Arabic lines, one call each)
 *   options: --manifest <path>  --out-root <extension dir>
 *
 * Rules (NARRATION.md section 11 HARD RULE):
 *   - ONE model: gemini-3.1-flash-tts-preview, voice Kore, called directly on the Gemini API (generateContent, response
 *     modality AUDIO, raw 24 kHz mono 16-bit PCM). The key travels only in the x-goog-api-key header. Nothing else is
 *     called: no transcriber, no judge, no tashkeel checker, no second TTS. No verify, no re-voice, no best-of-N: the owner listens.
 *   - Each line is voiced ONCE per language. The only repeat is ONE identical retry when NO audio came back (a thrown network
 *     error, a non-200 answer, or fewer than MIN_PCM_BYTES of audio). A clip that sounds wrong is never retried.
 *   - At most MAX_CALLS = 26 calls in total (22 lines + 4 retries), counted across runs in the ledger.
 *   - voice_style_gate.py --text-only runs FIRST over the English lines and the Arabic lines (Arabic: full tashkeel in
 *     tts_text_ar); a failing gate or a stale line (sha1_16 differs) stops the run with zero calls.
 *   - An existing take is never overwritten (the line is skipped, no call). A raw take already on disk is re-encoded without a call.
 *   - The key comes from the environment or ~/.config/qa-wrap/gemini.env. It is never written to the repo, a log, a ledger or
 *     stdout. The log records the source (variable or file name) only; error bodies are never recorded.
 * Output: audio/en/vNN.wav and audio/ar/vNN.wav (silence trimmed in node, no ffmpeg), the manifest updated with measured
 * seconds, work/sdlc/build/voice-kore-ledger.json (one row per call: id, lang, attempt, outcome) and voice-kore-log.json.
 * Raw PCM takes are kept in work/sdlc/build/voice-raw/.
 *
 * Manifest line (runtime): id, lang 'en', style, direction, text, tts_text (English TTS input, optional), sha1_16 =
 * sha1(direction + text); caption_ar (Arabic caption, unvowelled), style_ar, direction_ar, tts_text_ar (fully vowelled),
 * sha1_16_ar = sha1(direction_ar + tts_text_ar); render fields file, file_ar, seconds, seconds_ar, wpm, wpm_ar,
 * file_status, file_status_ar, engine, engine_ar.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NJ_WRITER_DIR } from './lib-paths.mjs';
export const MODEL = 'gemini-3.1-flash-tts-preview';
export const VOICE = 'Kore';
export const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const TTS_URL = `${API_BASE}/${MODEL}:generateContent`;
export const MAX_CALLS = 26;
export const RATE_WAIT_MS = 65000;
export const PACE_MS = 22000; // between lines: the preview model answered 429 after four quick calls in the 2026-10-12 run
export const MIN_PCM_BYTES = 2000; // 24 kHz mono s16le: below ~40 ms there is no speech, so it counts as "no audio came back"
export const PCM_BYTES_PER_S = 48000;
export const LANGS = ['en', 'ar'];
export const KEY_VARS = ['GEMINI_API_KEY'];
const ID_RE = /^v\d{2}$/;
const DEFAULT_GATE = path.join(NJ_WRITER_DIR, 'scripts', 'voice_style_gate.py');

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(here, '..');

export const sha1_16 = (direction, text) => crypto.createHash('sha1').update(direction + text, 'utf8').digest('hex').slice(0, 16);

export function defaultPaths(extDir = EXT_DIR) {
  const repo = path.resolve(extDir, '..');
  return {
    extDir,
    gameDir: path.join(extDir, 'game'),
    manifest: path.join(extDir, 'game', 'audio', 'narration-manifest.json'),
    ledger: path.join(repo, 'work', 'sdlc', 'build', 'voice-kore-ledger.json'),
    log: path.join(repo, 'work', 'sdlc', 'build', 'voice-kore-log.json'),
    raw: path.join(repo, 'work', 'sdlc', 'build', 'voice-raw'),
  };
}

/** The per-language view of a manifest line: what is spoken, how it is directed, where the file goes. */
export function laneOf(line, lang) {
  if (lang === 'ar') {
    return { lang, id: line.id, direction: line.direction_ar, spoken: line.tts_text_ar, words: String(line.caption_ar || '').trim().split(/\s+/).length, fileKey: 'file_ar', rel: `audio/ar/${line.id}.wav`, sha: line.sha1_16_ar, shaOf: sha1_16(line.direction_ar || '', line.tts_text_ar || '') };
  }
  return { lang, id: line.id, direction: line.direction, spoken: line.tts_text || line.text, words: String(line.text || '').trim().split(/\s+/).length, fileKey: 'file', rel: `audio/en/${line.id}.wav`, sha: line.sha1_16, shaOf: sha1_16(line.direction || '', line.text || '') };
}

/* ---------------------------------------------------------------- key ---- */

/** Find the Gemini key. Returns { key, source } (source is a variable or file NAME, never the value) or null. */
export function readKey({ env = process.env, home = os.homedir(), fsImpl = fs } = {}) {
  for (const v of KEY_VARS) if (env[v] && String(env[v]).trim()) return { key: String(env[v]).trim(), source: `env:${v}` };
  const dir = path.join(home, '.config', 'qa-wrap');
  let names = [];
  try { names = fsImpl.readdirSync(dir).filter((n) => n.endsWith('.env')); } catch { return null; }
  names.sort((a, b) => (a === 'gemini.env' ? -1 : b === 'gemini.env' ? 1 : a.localeCompare(b)));
  for (const name of names) {
    let text = '';
    try { text = fsImpl.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
    for (const ln of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(ln);
      if (m && KEY_VARS.includes(m[1])) {
        const val = m[2].trim().replace(/^["']|["']$/g, '');
        if (val) return { key: val, source: `file:${name}` };
      }
    }
  }
  return null;
}

/* ---------------------------------------------------------------- the one call ---- */

/** One TTS request. Never throws; never returns an error body. outcome: ok | network-error | http-<status> | empty. */
export async function callTts({ fetchImpl, key, input }) {
  let res;
  try {
    res = await fetchImpl(TTS_URL, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: input }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
      }),
    });
  } catch { return { ok: false, outcome: 'network-error' }; }
  if (!res || res.status !== 200) return { ok: false, outcome: `http-${res ? res.status : 0}` };
  let buf = Buffer.alloc(0);
  try {
    const j = JSON.parse(await res.text());
    const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const part = parts.find((p) => p && p.inlineData && p.inlineData.data);
    if (part) buf = Buffer.from(part.inlineData.data, 'base64');
  } catch { return { ok: false, outcome: 'network-error' }; }
  if (buf.length < MIN_PCM_BYTES) return { ok: false, outcome: 'empty', bytes: buf.length };
  return { ok: true, outcome: 'ok', pcm: buf, bytes: buf.length };
}

/* ---------------------------------------------------------------- gate (no model) ---- */

/** voice_style_gate.py, offline. Refuses (status 2) when the script is missing: the gate is never skipped. */
export function runGateDefault(manifestPath, { textOnly = true, env = process.env } = {}) {
  const dir = env.NJ_WRITER_DIR ? path.join(env.NJ_WRITER_DIR, 'scripts', 'voice_style_gate.py') : DEFAULT_GATE;
  if (!fs.existsSync(dir)) return { status: 2, output: `voice_style_gate.py not found at ${dir}` };
  const args = [dir, manifestPath, ...(textOnly ? ['--text-only'] : [])];
  const r = spawnSync(env.VOICE_RENDER_PYTHON || 'python', args, { encoding: 'utf8', env: { ...env, PYTHONUTF8: '1' } });
  return { status: r.status === null ? 2 : r.status, output: `${r.stdout || ''}${r.stderr || ''}`.trim().slice(-600) };
}

/**
 * The manifest the gate reads: every English line, then every Arabic line (id "vNN-ar"). The gate wants each visible Latin
 * token spelled out in Arabic in tts_text; the owner keeps "QA Wrap" and "Enter" Latin, so the Latin tokens are left out of the
 * visible text handed to the gate (every Arabic word, every mark and the 1:1 alignment are still checked).
 */
export function gateManifestOf(m) {
  const lines = [];
  for (const l of m.lines) lines.push({ id: l.id, lang: 'en', style: l.style, direction: l.direction, text: l.text, tts_text: l.tts_text });
  for (const l of m.lines) {
    const visible = String(l.caption_ar || '').split(/\s+/).filter((w) => w && !/[A-Za-z0-9]/.test(w)).join(' ');
    lines.push({ id: `${l.id}-ar`, lang: 'ar', style: l.style_ar, direction: l.direction_ar, text: visible, tts_text: l.tts_text_ar });
  }
  return { lines };
}

function gateWithTemp(gate, manifest, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-gate-'));
  const file = path.join(dir, 'gate-manifest.json');
  try {
    fs.writeFileSync(file, JSON.stringify(gateManifestOf(manifest)));
    return gate(file, opts);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/* ---------------------------------------------------------------- WAV (node only, no ffmpeg) ---- */

/** WAV file (RIFF, 16-bit mono PCM) around raw 24 kHz s16le samples. */
export function wavFromPcm(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
/** Duration in seconds read from a WAV header (node only, no ffprobe). */
export function wavSeconds(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  const rate = buf.readUInt32LE(24);
  const dataLen = buf.readUInt32LE(40);
  return dataLen / (rate * 2);
}
/** Cut leading and trailing silence (below ~-50 dBFS) with 80 ms of padding, in node. A fully silent take is kept whole. */
export function trimPcm(pcm, rate = 24000, threshold = 100, padMs = 80) {
  const n = Math.floor(pcm.length / 2);
  let a = 0; let b = n - 1;
  while (a < n && Math.abs(pcm.readInt16LE(a * 2)) < threshold) a++;
  while (b > a && Math.abs(pcm.readInt16LE(b * 2)) < threshold) b--;
  if (a >= n) return pcm;
  const pad = Math.round(rate * padMs / 1000);
  return pcm.subarray(Math.max(0, a - pad) * 2, (Math.min(n - 1, b + pad) + 1) * 2);
}

/** The raw take (silence trimmed in node) becomes a WAV with a correct header. No tempo change, no loudness pass, no model call. */
export function encodeWav({ rawPath, outPath, words }) {
  const wav = wavFromPcm(trimPcm(fs.readFileSync(rawPath)));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const part = `${outPath}.part`;
  fs.writeFileSync(part, wav);
  fs.renameSync(part, outPath);
  const seconds = Math.round(wavSeconds(wav) * 100) / 100;
  return { seconds, wpm: Math.round(words / seconds * 6000) / 100 };
}

/* ---------------------------------------------------------------- manifest checks ---- */

/** Problems that stop the run before any call. [] when the manifest is sound. */
export function checkManifest(m) {
  const bad = [];
  if (!m || !Array.isArray(m.lines) || m.lines.length === 0) return ['manifest has no lines'];
  if (m.model && m.model !== MODEL) bad.push(`manifest model is ${m.model}, only ${MODEL} is allowed`);
  if (m.voice && m.voice !== VOICE) bad.push(`manifest voice is ${m.voice}, only ${VOICE} is allowed`);
  const seen = new Set();
  for (const l of m.lines) {
    const id = l && l.id;
    if (!ID_RE.test(String(id))) { bad.push(`bad line id ${JSON.stringify(id)}`); continue; }
    if (seen.has(id)) bad.push(`${id}: duplicate id`);
    seen.add(id);
    if (l.lang !== 'en') bad.push(`${id}: lang must be en (the Arabic voice is the *_ar fields)`);
    if (typeof l.direction !== 'string' || typeof l.text !== 'string' || !l.direction || !l.text) bad.push(`${id}: direction and text are required`);
    else if (sha1_16(l.direction, l.text) !== l.sha1_16) bad.push(`${id}: stale (sha1_16 does not match direction+text); the tool never regenerates by itself`);
    if (typeof l.direction_ar !== 'string' || typeof l.tts_text_ar !== 'string' || !l.direction_ar || !l.tts_text_ar || !l.caption_ar) bad.push(`${id}: caption_ar, direction_ar and tts_text_ar are required`);
    else if (sha1_16(l.direction_ar, l.tts_text_ar) !== l.sha1_16_ar) bad.push(`${id}: Arabic stale (sha1_16_ar does not match direction_ar+tts_text_ar)`);
    if (!new RegExp(`^audio/en/${id}\.(?:wav|ogg)$`).test(l.file)) bad.push(`${id}: file must be audio/en/${id}.wav (or .ogg once re-encoded for the package)`);
    if (!new RegExp(`^audio/ar/${id}\.(?:wav|ogg)$`).test(l.file_ar)) bad.push(`${id}: file_ar must be audio/ar/${id}.wav (or .ogg once re-encoded for the package)`);
  }
  return bad;
}

/* ---------------------------------------------------------------- the render ---- */

const readJson = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `${JSON.stringify(v, null, 1)}\n`); };
const statusKey = (lang) => (lang === 'ar' ? 'file_status_ar' : 'file_status');
const secondsKey = (lang) => (lang === 'ar' ? 'seconds_ar' : 'seconds');
const wpmKey = (lang) => (lang === 'ar' ? 'wpm_ar' : 'wpm');
const engineKey = (lang) => (lang === 'ar' ? 'engine_ar' : 'engine');

/**
 * renderAll({ go, paths, fetchImpl, keyInfo, gate, encode, sleep, now }) -> report. Never throws for expected failures.
 * go=false is the plan: manifest + gate only, no key read, no call.
 * report.exit: 0 all lines have a take, 1 some line is missing, 2 refused before any call.
 */
export async function renderAll(o = {}) {
  const paths = o.paths || defaultPaths();
  const gate = o.gate || runGateDefault;
  const encode = o.encode || encodeWav;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now || (() => new Date().toISOString());
  const fetchImpl = o.fetchImpl || ((...a) => globalThis.fetch(...a));
  const maxCalls = Math.min(MAX_CALLS, o.maxCalls || MAX_CALLS);
  const langs = (o.langs || LANGS).filter((x) => LANGS.includes(x));
  const report = { started: now(), finished: null, mode: o.go ? 'render' : 'plan', model: MODEL, voice: VOICE, exit: 0, refused: null, gate: null, keySource: null, callsThisRun: 0, callsTotal: 0, maxCalls, lines: [] };
  const refuse = (why) => { report.exit = 2; report.refused = why; report.finished = now(); if (o.go) writeJson(paths.log, report); return report; };

  const manifest = readJson(paths.manifest, null);
  const bad = checkManifest(manifest);
  if (bad.length) return refuse(bad.join('; '));

  const g = gateWithTemp(gate, manifest, { textOnly: true });
  report.gate = { textOnly: true, status: g.status };
  if (g.status !== 0) return refuse(`voice_style_gate.py --text-only failed (exit ${g.status}): ${g.output || ''}`.trim());

  const ledger = readJson(paths.ledger, []);
  report.callsTotal = Array.isArray(ledger) ? ledger.length : 0;
  let keyInfo = null;

  for (const lang of langs) {
    if (report.rateLimited) break;
    for (const line of manifest.lines) {
      const ln = laneOf(line, lang);
      const row = { id: line.id, lang, outcome: null, attempts: [], seconds: null };
      report.lines.push(row);
      const outPath = path.join(paths.gameDir, ln.rel);
      const rawPath = path.join(paths.raw, `${lang}-${line.id}.pcm`);
      if (fs.existsSync(outPath)) { row.outcome = 'exists'; continue; } // never overwrite a take
      const haveRaw = fs.existsSync(rawPath);
      if (!o.go) { row.outcome = haveRaw ? 'plan-encode-raw' : 'plan-voice'; continue; }

      if (!haveRaw) {
        if (!keyInfo) {
          keyInfo = o.keyInfo !== undefined ? o.keyInfo : readKey();
          if (!keyInfo) { row.outcome = 'no-key'; return refuse('no Gemini key: set GEMINI_API_KEY or put it in ~/.config/qa-wrap/gemini.env'); }
          report.keySource = keyInfo.source;
        }
        const input = ln.direction + ln.spoken;
        let pcm = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          if (report.callsTotal >= maxCalls) { row.outcome = 'budget'; break; }
          // a 429 is a per-minute quota: the one retry waits out the minute (65 s); other failures wait 2 s
          if (attempt === 2) await sleep(o.retryDelayMs ?? (row.attempts[0] === 'http-429' ? RATE_WAIT_MS : 2000));
          report.callsTotal++; report.callsThisRun++;
          const r = await callTts({ fetchImpl, key: keyInfo.key, input });
          row.attempts.push(r.outcome);
          ledger.push({ id: line.id, lang, attempt, outcome: r.outcome, at: now() });
          writeJson(paths.ledger, ledger); // after every call, so a crash never hides spend
          if (r.ok) { pcm = r.pcm; break; }
          // no audio came back: exactly one identical retry; a returned clip is never retried
        }
        if (!pcm) {
          if (!row.outcome) row.outcome = 'missing';
          if (row.outcome !== 'budget') line[statusKey(lang)] = 'missing';
          if (row.attempts.length === 2 && row.attempts[1] === 'http-429') { row.outcome = 'rate-limited'; report.rateLimited = true; break; } // quota still closed after a full minute: stop, spend nothing more
          if (o.pauseMs) await sleep(o.pauseMs);
          continue;
        }
        fs.mkdirSync(paths.raw, { recursive: true });
        fs.writeFileSync(rawPath, pcm);
      }
      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const e = encode({ rawPath, outPath, line, lang, words: ln.words });
        line[ln.fileKey] = ln.rel;
        line[secondsKey(lang)] = e.seconds;
        line[wpmKey(lang)] = e.wpm;
        line[engineKey(lang)] = `${MODEL} ${VOICE}`;
        line[statusKey(lang)] = 'ok';
        row.outcome = haveRaw ? 'encoded-from-raw' : 'voiced'; row.seconds = e.seconds; row.wpm = e.wpm;
      } catch (err) {
        row.outcome = 'encode-failed'; row.error = String(err.message).slice(0, 200); line[statusKey(lang)] = 'missing'; // raw take is kept; no new call needed
      }
      writeJson(paths.manifest, manifest); // after every line, so a crash never loses a measured take
      if (o.pauseMs) await sleep(o.pauseMs);
    }
  }

  if (o.go) {
    const total = (key, sk) => manifest.lines.reduce((s, l) => s + (l[sk] === 'ok' ? Number(l[key === 'en' ? 'seconds' : 'seconds_ar']) || 0 : 0), 0);
    manifest.total_seconds = Math.round(total('en', 'file_status') * 100) / 100;
    manifest.total_seconds_ar = Math.round(total('ar', 'file_status_ar') * 100) / 100;
    manifest.model = MODEL;
    manifest.voice = VOICE;
    manifest.engine = { name: 'Gemini TTS', model_id: MODEL, voice: VOICE, endpoint: 'generativelanguage.googleapis.com generateContent', sample_rate: 24000, rendered: now(), note: 'Bug Hunt owner decision 2026-10-12: Kore in English and Arabic; each line voiced once per language; Arabic TTS text fully vowelled.' };
    writeJson(paths.manifest, manifest);
    const pg = gateWithTemp(gate, manifest, { textOnly: false });
    report.postGate = { textOnly: false, status: pg.status, output: pg.status === 0 ? '' : pg.output }; // informational: the owner listens
  }
  report.exit = report.lines.some((l) => ['missing', 'budget', 'encode-failed', 'no-key', 'rate-limited'].includes(l.outcome)) ? 1 : 0;
  report.finished = now();
  if (o.go) writeJson(paths.log, report);
  return report;
}

/* ---------------------------------------------------------------- CLI ---- */

function parseArgs(argv) {
  const a = { go: false, manifest: null, outRoot: null, maxCalls: 0, bad: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--go') a.go = true;
    else if (t === '--plan') a.go = false;
    else if (t === '--manifest') a.manifest = argv[++i];
    else if (t === '--out-root') a.outRoot = argv[++i];
    else if (t === '--max-calls') a.maxCalls = Number(argv[++i]) || 0; // a lower cap for this run (the ledger still counts earlier runs)
    else a.bad.push(t);
  }
  return a;
}

export async function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  if (a.bad.length) { console.error(`voice-render: unknown argument ${a.bad[0]} (use --go, --plan, --manifest, --out-root, --max-calls)`); return 64; }
  const paths = defaultPaths(a.outRoot ? path.resolve(a.outRoot) : EXT_DIR);
  if (a.manifest) paths.manifest = path.resolve(a.manifest);
  const r = await renderAll({ go: a.go, paths, pauseMs: PACE_MS, maxCalls: a.maxCalls || undefined });
  console.log(`voice-render ${r.mode}: model ${r.model}, voice ${r.voice}, gate ${r.gate ? r.gate.status : 'not run'}, calls this run ${r.callsThisRun}, total ${r.callsTotal}/${r.maxCalls}`);
  for (const l of r.lines) console.log(`  ${l.id} ${l.lang}: ${l.outcome}${l.seconds ? ` (${l.seconds}s)` : ''}${l.attempts.length ? ` [${l.attempts.join(', ')}]` : ''}`);
  if (r.refused) console.error(`REFUSED: ${r.refused}`);
  if (!a.go) console.log('Plan only. Nothing was voiced. Run with --go for the one render.');
  return r.exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((c) => { process.exitCode = c; });
}
