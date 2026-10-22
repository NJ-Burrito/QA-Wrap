/* QA Wrap - Bug Hunt: the voice render tool (Kore on Gemini TTS, English and Arabic), with a MOCKED fetch (no network, no key, no model call).
 *   node tools/test-voice-render.mjs      (from extension/, PYTHONUTF8=1)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NJ_WRITER_DIR } from './lib-paths.mjs';
import { encodeWav, trimPcm, wavFromPcm, wavSeconds, renderAll, readKey, callTts, checkManifest, gateManifestOf, laneOf, sha1_16, defaultPaths, MAX_CALLS, MODEL, VOICE, TTS_URL, KEY_VARS } from './voice-render.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '..');
const SRC_MANIFEST = path.join(EXT, 'game', 'audio', 'narration-manifest.json');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-'));
let case_ = 0;
const man = JSON.parse(fs.readFileSync(SRC_MANIFEST, 'utf8'));
function sandbox() {
  const root = path.join(tmp, `c${++case_}`);
  const p = defaultPaths(path.join(root, 'extension'));
  fs.mkdirSync(path.dirname(p.manifest), { recursive: true });
  const m = structuredClone(man);
  m.lines.forEach((l) => { l.file_status = 'pending'; l.file_status_ar = 'pending'; delete l.seconds; delete l.seconds_ar; });
  fs.writeFileSync(p.manifest, JSON.stringify(m));
  return p;
}
const PCM = Buffer.alloc(48000 * 2); // 2 s of silence is "audio" for the tool
const TONE = Buffer.alloc(24000 * 2 * 2); // 0.5 s silence + 1 s tone + 0.5 s silence at 24 kHz s16le
for (let i = 0; i < 24000; i++) TONE.writeInt16LE(Math.round(8000 * Math.sin(i / 10)), (12000 + i) * 2);
const audioJson = (pcm) => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] });
const response = (status, pcm) => new Response(status === 200 ? audioJson(pcm) : 'err', { status });
const gateOk = () => ({ status: 0, output: 'RESULT: PASS (0 fail)' });
const base = (p, extra) => ({ go: true, paths: p, gate: gateOk, keyInfo: { key: 'TEST-KEY-NOT-REAL', source: 'env:TEST' }, sleep: async () => {}, now: () => '2026-10-12T00:00:00Z', ...extra });
const inputOf = (init) => JSON.parse(init.body).contents[0].parts[0].text;

// ---- the manifest in the repo is sound
eq(checkManifest(man), [], 'runtime manifest is sound');
eq(man.lines.length, 11, '11 lines');
ok(man.model === MODEL && man.voice === VOICE && MODEL === 'gemini-3.1-flash-tts-preview' && VOICE === 'Kore', 'the one model and the one voice');
ok(man.lines.every((l) => l.lang === 'en' && l.caption_ar && l.style && l.style_ar), 'English line, Arabic caption, a style for each language');
ok(!/asr|openrouter/i.test(fs.readFileSync(SRC_MANIFEST, 'utf8')), 'no asr/openrouter word in the runtime manifest');
ok(JSON.stringify({ ...man, lines: man.lines.map(({ engine, ...l }) => l) }).search(/kokoro/i) < 0, 'Kokoro is named only in a line "engine" field (the English fallback while a Kore take is not rendered)');
eq(MAX_CALLS, 26, 'the call ceiling is 26 (22 lines + 4 retries)');
eq(KEY_VARS, ['GEMINI_API_KEY'], 'the key variable');

// ---- laneOf: one view per language
{
  const l = man.lines[0];
  const en = laneOf(l, 'en'); const ar = laneOf(l, 'ar');
  eq([en.rel, ar.rel], ['audio/en/v01.wav', 'audio/ar/v01.wav'], 'one folder per language');
  eq([en.spoken, ar.spoken], [l.tts_text || l.text, l.tts_text_ar], 'English speaks tts_text, Arabic speaks tts_text_ar');
  eq([en.direction, ar.direction], [l.direction, l.direction_ar], 'each language has its own direction');
}

// ---- the gate manifest: 22 lines, Latin tokens only in tts_text
{
  const g = gateManifestOf(man);
  eq([g.lines.length, g.lines.filter((l) => l.lang === 'ar').length], [22, 11], '22 gate lines, 11 Arabic');
  ok(g.lines.filter((l) => l.lang === 'ar').every((l) => !/[A-Za-z]/.test(l.text)), 'no Latin token in the visible text the gate aligns');
  ok(g.lines.filter((l) => l.lang === 'ar').every((l) => l.tts_text && l.id.endsWith('-ar')), 'Arabic gate lines carry tts_text and an -ar id');
}

// ---- stale line: zero calls
{
  const p = sandbox();
  const m = JSON.parse(fs.readFileSync(p.manifest, 'utf8'));
  m.lines[2].text += ' extra';
  fs.writeFileSync(p.manifest, JSON.stringify(m));
  let calls = 0;
  const r = await renderAll(base(p, { fetchImpl: async () => { calls++; return response(200, PCM); } }));
  eq([r.exit, calls], [2, 0], 'stale line refuses with zero calls');
  ok(/stale/.test(r.refused), 'says stale');
}

// ---- gate failure: zero calls
{
  const p = sandbox();
  let calls = 0;
  const r = await renderAll(base(p, { gate: () => ({ status: 1, output: 'FAIL' }), fetchImpl: async () => { calls++; return response(200, PCM); } }));
  eq([r.exit, calls], [2, 0], 'gate failure refuses with zero calls');
}

// ---- plan mode: no key read, no call, no files
{
  const p = sandbox();
  let calls = 0;
  const r = await renderAll({ go: false, paths: p, gate: gateOk, keyInfo: undefined, fetchImpl: async () => { calls++; return response(200, PCM); } });
  eq([r.exit, calls, r.lines.length], [0, 0, 22], 'plan makes no call');
  ok(r.lines.every((l) => l.outcome === 'plan-voice'), 'plan lists every line');
  ok(!fs.existsSync(p.ledger), 'plan writes no ledger');
}

// ---- success: 22 calls, request shape, ledger, manifest updated, WAV files, key never written
{
  const p = sandbox();
  const seen = [];
  const f = async (url, init) => { seen.push({ url, init }); return response(200, TONE); };
  const r = await renderAll(base(p, { fetchImpl: f }));
  eq([r.exit, seen.length], [0, 22], 'one call per line per language');
  ok(seen.every((s) => s.url === TTS_URL), 'only the TTS endpoint');
  ok(seen.every((s) => s.init.headers['x-goog-api-key'] === 'TEST-KEY-NOT-REAL' && !String(s.url).includes('TEST-KEY') && !s.init.body.includes('TEST-KEY')), 'key only in the x-goog-api-key header');
  const bodies = seen.map((s) => JSON.parse(s.init.body));
  ok(bodies.every((b) => b.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === 'Kore' && b.generationConfig.responseModalities[0] === 'AUDIO'), 'Kore, audio modality');
  eq(seen.map((s) => inputOf(s.init)), [...man.lines.map((l) => laneOf(l, 'en')), ...man.lines.map((l) => laneOf(l, 'ar'))].map((x) => x.direction + x.spoken), 'inputs = direction + spoken text, English first then Arabic, byte-exact');
  const ledger = JSON.parse(fs.readFileSync(p.ledger, 'utf8'));
  eq(ledger.length, 22, 'ledger has one row per call');
  ok(ledger.every((x) => x.attempt === 1 && x.outcome === 'ok' && (x.lang === 'en' || x.lang === 'ar')), 'all first attempts ok');
  const m2 = JSON.parse(fs.readFileSync(p.manifest, 'utf8'));
  ok(m2.lines.every((l) => l.file_status === 'ok' && l.file_status_ar === 'ok' && l.file === `audio/en/${l.id}.wav` && l.file_ar === `audio/ar/${l.id}.wav`), 'manifest points at the WAV files in both folders');
  const wav = fs.readFileSync(path.join(p.gameDir, 'audio/ar/v01.wav'));
  eq([wav.toString('ascii', 0, 4), wav.toString('ascii', 8, 12), wav.readUInt32LE(24), wav.readUInt16LE(22), wav.readUInt16LE(34)], ['RIFF', 'WAVE', 24000, 1, 16], 'correct WAV header');
  eq([wav.readUInt32LE(4), wav.readUInt32LE(40)], [wav.length - 8, wav.length - 44], 'RIFF and data sizes');
  ok(Math.abs(wavSeconds(wav) - 1.16) < 0.03, `duration from the header (${wavSeconds(wav)} s, silence trimmed)`);
  eq([m2.lines[0].seconds, m2.lines[0].seconds_ar], [Math.round(wavSeconds(wav) * 100) / 100, Math.round(wavSeconds(wav) * 100) / 100], 'manifest seconds = header duration, both languages');
  ok(m2.total_seconds > 0 && m2.total_seconds_ar > 0 && m2.model === MODEL && m2.voice === VOICE, 'totals and the model/voice pin are written');
  ok(!fs.readFileSync(p.log, 'utf8').includes('TEST-KEY-NOT-REAL') && !fs.readFileSync(p.ledger, 'utf8').includes('TEST-KEY-NOT-REAL') && !fs.readFileSync(p.manifest, 'utf8').includes('TEST-KEY-NOT-REAL'), 'key is in no output file');
  let again = 0;
  const r2 = await renderAll(base(p, { fetchImpl: async () => { again++; return response(200, PCM); } }));
  eq([again, r2.exit], [0, 0], 'existing takes are never overwritten, no call');
  ok(r2.lines.every((l) => l.outcome === 'exists'), 'all reported as exists');
}

// ---- transport failure: exactly one identical retry, then missing; a 200 with audio is never retried; a 429 waits the minute
{
  const p = sandbox();
  const inputs = [];
  const sleeps = [];
  const E = (id) => laneOf(man.lines.find((x) => x.id === id), 'en');
  const f = async (url, init) => {
    const input = inputOf(init); inputs.push(input);
    if (input === E('v01').direction + E('v01').spoken) return response(500, PCM); // v01: server error both times
    if (input === E('v02').direction + E('v02').spoken && inputs.filter((x) => x === input).length === 1) throw new Error('socket hang up'); // v02: first fails, retry works
    if (input === E('v03').direction + E('v03').spoken) return response(200, Buffer.alloc(10)); // v03: zero-ish audio twice
    if (input === E('v04').direction + E('v04').spoken && inputs.filter((x) => x === input).length === 1) return response(429, PCM); // v04: quota, then audio
    return response(200, PCM);
  };
  const r = await renderAll(base(p, { fetchImpl: f, sleep: async (ms) => { sleeps.push(ms); } }));
  const by = Object.fromEntries(r.lines.filter((l) => l.lang === 'en').map((l) => [l.id, l]));
  eq(by.v01.attempts, ['http-500', 'http-500'], 'v01: one retry then stop');
  eq(by.v01.outcome, 'missing', 'v01 missing');
  eq(by.v02.attempts, ['network-error', 'ok'], 'v02: retry succeeded');
  eq(by.v03.attempts, ['empty', 'empty'], 'v03: a body without audio counts as no audio');
  eq(by.v04.attempts, ['http-429', 'ok'], 'v04: 429 then audio');
  ok(sleeps.includes(65000), 'the retry after a 429 waited 65 s');
  eq(by.v05.attempts, ['ok'], 'a 200 with audio is never retried');
  eq(r.callsTotal, 22 + 4, 'four retries on top of 22 lines = the 26 ceiling');
  const m2 = JSON.parse(fs.readFileSync(p.manifest, 'utf8'));
  eq(m2.lines.find((l) => l.id === 'v01').file_status, 'missing', 'v01 English ships as missing (caption-only or the other language)');
  eq(r.exit, 1, 'exit 1 when a line is missing');
}

// ---- a 429 that survives the minute stops the run; the ceiling counts earlier runs
{
  const p = sandbox();
  let calls = 0;
  const r = await renderAll(base(p, { fetchImpl: async () => { calls++; return response(429, PCM); } }));
  eq([calls, r.rateLimited, r.exit], [2, true, 1], 'two 429s in a row stop the run after two calls');
  eq(r.lines[0].outcome, 'rate-limited', 'the first line says rate-limited');
  const p2 = sandbox();
  fs.mkdirSync(path.dirname(p2.ledger), { recursive: true });
  fs.writeFileSync(p2.ledger, JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ id: 'v0' + (i % 9 + 1), lang: 'en', attempt: 1, outcome: 'ok' }))));
  let c2 = 0;
  const r2 = await renderAll(base(p2, { fetchImpl: async () => { c2++; return response(200, PCM); } }));
  eq(c2, 1, 'only one call left in the budget');
  eq(r2.lines.filter((l) => l.outcome === 'budget').length, 21, 'the rest are not voiced');
}

// ---- encoder failure after audio came back: no second call, raw take kept, rerun encodes from raw
{
  const p = sandbox();
  let calls = 0;
  const f = async () => { calls++; return response(200, PCM); };
  const r = await renderAll(base(p, { fetchImpl: f, encode: () => { throw new Error('disk full'); } }));
  eq(calls, 22, 'one call per line even though encoding failed');
  ok(r.lines.every((l) => l.outcome === 'encode-failed'), 'encode failure reported');
  ok(fs.existsSync(path.join(p.raw, 'en-v01.pcm')) && fs.existsSync(path.join(p.raw, 'ar-v01.pcm')), 'raw takes kept, per language');
  let again = 0;
  const r2 = await renderAll(base(p, { fetchImpl: async () => { again++; return response(200, PCM); } }));
  eq(again, 0, 'rerun re-encodes the raw takes without a call');
  ok(r2.lines.every((l) => l.outcome === 'encoded-from-raw') && r2.exit === 0, 're-encoded from raw');
}

// ---- refuses when there is no key (no call)
{
  const p = sandbox();
  let calls = 0;
  const r = await renderAll({ ...base(p, { fetchImpl: async () => { calls++; return response(200, PCM); } }), keyInfo: null });
  eq([r.exit, calls], [2, 0], 'no key: refused with zero calls');
}

// ---- key lookup: environment first, then ~/.config/qa-wrap/*.env; the value is never in the source label
{
  const files = { 'a.env': 'FOO=1\n', 'gemini.env': 'GEMINI_API_KEY="test-123"\n', 'z.env': 'GEMINI_API_KEY=other\n' };
  const fsFake = { readdirSync: () => Object.keys(files), readFileSync: (f) => files[path.basename(f)] };
  eq(readKey({ env: { GEMINI_API_KEY: 'envkey' }, home: '/h', fsImpl: fsFake }), { key: 'envkey', source: 'env:GEMINI_API_KEY' }, 'environment wins');
  const k = readKey({ env: {}, home: '/h', fsImpl: fsFake });
  eq([k.key, k.source], ['test-123', 'file:gemini.env'], 'gemini.env is read first, quotes stripped');
  eq(readKey({ env: {}, home: '/h', fsImpl: { readdirSync: () => { throw new Error('nope'); } } }), null, 'no folder = no key');
}

// ---- callTts never throws, never returns an error body, and classifies outcomes
{
  eq((await callTts({ fetchImpl: async () => { throw new Error('x'); }, key: 'k', input: 'i' })).outcome, 'network-error', 'throw');
  const r429 = await callTts({ fetchImpl: async () => response(429, PCM), key: 'k', input: 'i' });
  eq([r429.outcome, Object.keys(r429).includes('body')], ['http-429', false], 'non-200 answers carry only the status');
  eq((await callTts({ fetchImpl: async () => response(200, Buffer.alloc(0)), key: 'k', input: 'i' })).outcome, 'empty', 'zero bytes');
  eq((await callTts({ fetchImpl: async () => new Response('not json', { status: 200 }), key: 'k', input: 'i' })).outcome, 'network-error', 'unparseable answer');
  eq((await callTts({ fetchImpl: async () => response(200, PCM), key: 'k', input: 'i' })).outcome, 'ok', 'audio');
}

// ---- manifest guards: ids cannot leave the audio folder, model and voice are pinned, both folders are pinned
{
  const m = JSON.parse(JSON.stringify(man));
  m.lines[0].id = '../x'; m.model = 'other/model';
  const bad = checkManifest(m).join('|');
  ok(/bad line id/.test(bad) && /only gemini-3\.1-flash-tts-preview/.test(bad), 'path-like id and another model are refused');
  m.lines[0].id = 'v01'; m.model = MODEL; m.lines[0].file = '../../x.wav';
  ok(/file must be/.test(checkManifest(m).join('|')), 'English file path pinned');
  m.lines[0].file = 'audio/en/v01.wav'; m.lines[0].file_ar = 'audio/en/v01.wav';
  ok(/file_ar must be/.test(checkManifest(m).join('|')), 'Arabic file path pinned to audio/ar/');
  m.lines[0].file_ar = 'audio/ar/v01.wav'; m.lines[0].tts_text_ar += 'x';
  ok(/Arabic stale/.test(checkManifest(m).join('|')), 'a changed Arabic TTS text is stale');
  eq(sha1_16(man.lines[0].direction, man.lines[0].text), man.lines[0].sha1_16, 'sha1_16 reproduces');
  eq(sha1_16(man.lines[0].direction_ar, man.lines[0].tts_text_ar), man.lines[0].sha1_16_ar, 'sha1_16_ar reproduces');
}

// ---- the WAV helpers
{
  const trimmed = trimPcm(TONE);
  ok(trimmed.length < TONE.length && Math.abs(trimmed.length / 48000 - 1.16) < 0.03, 'silence trimmed to the tone plus 80 ms either side');
  const wav = wavFromPcm(trimmed);
  eq([wav.readUInt32LE(4), wav.readUInt32LE(40)], [wav.length - 8, wav.length - 44], 'header sizes');
  const raw = path.join(tmp, 'x.pcm'); fs.writeFileSync(raw, TONE);
  const e = encodeWav({ rawPath: raw, outPath: path.join(tmp, 'out', 'x.wav'), words: 2 });
  ok(Math.abs(e.seconds - 1.16) < 0.03 && e.wpm > 90 && fs.existsSync(path.join(tmp, 'out', 'x.wav')) && !fs.existsSync(path.join(tmp, 'out', 'x.wav.part')), 'encodeWav writes the file and reports seconds and wpm');
}

// ---- source scan: one endpoint, one model, nothing else, no key literal
{
  const src = fs.readFileSync(path.join(here, 'voice-render.mjs'), 'utf8');
  eq([...new Set(src.match(/https?:\/\/[^\s'"`)]+/g))].filter((u) => !/^https?:\/\/(generativelanguage\.googleapis\.com\/v1beta\/models)$/.test(u)), [], 'the only URL in the tool is the Gemini TTS endpoint');
  eq([...new Set(src.match(/gemini-[a-z0-9.\-]+tts[a-z0-9.\-]*/g))], ['gemini-3.1-flash-tts-preview'], 'the only model string');
  ok(!/AQ\.[A-Za-z0-9_-]{10}|sk-or-[A-Za-z0-9]/.test(src), 'no key literal');
  ok(!/ffmpeg|ffprobe|Authorization|Bearer/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no ffmpeg dependency and no bearer header in the code');
}

// ---- the real offline gate (voice_style_gate.py --text-only) passes on the shipped manifest, English and Arabic
{
  const gate = path.join(NJ_WRITER_DIR, 'scripts', 'voice_style_gate.py');
  if (fs.existsSync(gate)) {
    const gm = path.join(tmp, 'gate-manifest.json');
    fs.writeFileSync(gm, JSON.stringify(gateManifestOf(man)));
    const r = spawnSync(process.env.VOICE_RENDER_PYTHON || 'python', [gate, gm, '--text-only'], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
    eq(r.status, 0, 'gate exit 0: ' + String(r.stdout).split('\n').filter((x) => /RESULT/.test(x)).join(''));
  } else console.log('note: voice_style_gate.py not on this machine, real-gate check skipped');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`voice-render tests: ${n} assertions passed`);
