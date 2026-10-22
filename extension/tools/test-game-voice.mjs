/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt voice (DESIGN-bug-hunt sections 5, 6; owner decision 2026-10-12: Kore in English AND Arabic): the narration
 * manifests against the style registry, and the one-render tool with a MOCKED fetch. No network, no key, no model call:
 * renderAll() is handed a fake fetchImpl, a fake key, a stub gate and (for the file step) the real node WAV encoder, and
 * globalThis.fetch is replaced as well so an unmocked call is an error. The renderer's real paths (ledger, log, raw takes,
 * game dir) are redirected into a throw-away folder, so no ledger row is written to the repo.
 *
 *   node tools/test-game-voice.mjs        (from extension/, PYTHONUTF8=1)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import { EXT, GAME, has, gameSources, readJson } from './lib-game-engine.mjs';
import { recycle } from './lib-trash.mjs';
import { NJ_WRITER_DIR } from './lib-paths.mjs';

const DESIGN = path.join(EXT, 'tools', 'fixtures', 'bug-hunt-narration-manifest.json');
const RUNTIME = path.join(GAME, 'audio', 'narration-manifest.json');
const RENDER = path.join(EXT, 'tools', 'voice-render.mjs');
const REGISTRY = path.join(NJ_WRITER_DIR, 'voice-styles.json');
const GATE = path.join(NJ_WRITER_DIR, 'scripts', 'voice_style_gate.py');

/* ---- the design manifest: always checkable (the frozen design copy, English style "manual") --------------------------- */
const sha16 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 16);
function manifestProblems(m, registry) {
  const bad = [];
  const manual = registry?.styles?.find((s) => s.id === 'manual');
  if (!manual) bad.push('registry has no style "manual"');
  if (m.lines?.length !== 11) bad.push(`lines: ${m.lines?.length}, want 11`);
  const ids = (m.lines || []).map((l) => l.id).join(',');
  if (ids !== Array.from({ length: 11 }, (_, i) => `v${String(i + 1).padStart(2, '0')}`).join(',')) bad.push(`ids ${ids}`);
  let total = 0;
  for (const l of m.lines || []) {
    if (l.style !== 'manual') bad.push(`${l.id}: style ${l.style}`);
    if (l.lang !== 'en') bad.push(`${l.id}: lang ${l.lang}`);
    if (manual && l.direction !== manual.direction) bad.push(`${l.id}: direction is not byte-equal to the registry`);
    if (l.sha1_16 !== sha16(l.direction + l.text)) bad.push(`${l.id}: sha1_16 does not match direction+text`);
    if (!l.caption_ar || !/[\u0600-\u06FF]/.test(l.caption_ar)) bad.push(`${l.id}: caption_ar missing or not Arabic`);
    const wpm = (l.text.trim().split(/\s+/).length / l.seconds) * 60;
    if (wpm < 145 || wpm > 155) bad.push(`${l.id}: ${wpm.toFixed(1)} wpm outside 145-155`);
    if ((l.tempo ?? 1) > 1.7) bad.push(`${l.id}: tempo ${l.tempo} above 1.7`);
    if (/\d|[&+=#@*]/.test(l.text)) bad.push(`${l.id}: digit or symbol in the spoken text`);
    for (const s of l.text.split(/(?<=[.!?])\s+/)) if (s.trim().split(/\s+/).length > 16) bad.push(`${l.id}: a sentence over 16 words`);
    total += l.seconds;
  }
  if (total > 90) bad.push(`total ${total.toFixed(1)} s over 90`);
  return bad;
}
const registry = readJson(REGISTRY);
const design = readJson(DESIGN);
{
  const bad = manifestProblems(design, registry);
  ok(bad.length === 0, 'design manifest: 11 lines, one style "manual", lang en, direction byte-equal, sha1_16, 145-155 wpm, <= 90 s, caption_ar for all', bad.slice(0, 4).join(' | '));
  const broken = structuredClone(design);
  broken.lines[3].direction += ' ';
  proveTeeth('the manifest check', (m) => manifestProblems(m, registry), broken);
}
{
  const r = spawnSync('python', [GATE, DESIGN, '--text-only'], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' }, timeout: 60000 });
  ok(r.status === 0 && /PASS/.test(r.stdout || ''), 'voice_style_gate.py --text-only passes on the design manifest (offline, no model call)', `${r.status} ${(r.stdout || r.stderr || '').trim().split('\n').pop()}`);
}

/* ---- lane C files ------------------------------------------------------------------------------------------------- */
if (!has('audio/narration-manifest.json', 'audio/voice.js') || !fs.existsSync(RENDER)) {
  skipNotEnforced({ rule: 'game', what: 'runtime manifest copy, renderer with mocked fetch, no-ASR scan, captionFor', why: 'extension/game/audio/ or tools/voice-render.mjs (lane C) has not landed' });
  finish('test-game-voice', { skipped: 1 });
}
const { renderAll, MAX_CALLS, MODEL, TTS_URL, RATE_WAIT_MS, laneOf, gateManifestOf, checkManifest } = await import(pathToFileURL(RENDER).href);
const rt = readJson(RUNTIME);
const ARABIC = /[\u0621-\u064A]/; // letters only (the Arabic comma U+060C is not a word)
const MARKS = /[\u064B-\u0652\u0670]/;
{
  // the runtime copy keeps every design line (id, spoken text, Arabic caption, when it plays); only the voicing fields moved on
  const core = (m) => m.lines.map(({ id, text, caption_ar, plays_when, words }) => ({ id, text, caption_ar, plays_when, words }));
  ok(JSON.stringify(core(rt)) === JSON.stringify(core(design)), 'the runtime manifest keeps the design lines (id, text, caption_ar, plays_when, words); only the voicing fields differ');
  ok(rt.voice === 'Kore' && rt.model === MODEL, 'runtime manifest: voice Kore, the one TTS model gemini-3.1-flash-tts-preview', `${rt.voice} ${rt.model}`);
  const styleIds = new Set(registry.styles.map((s) => s.id));
  const regDir = (id) => registry.styles.find((s) => s.id === id)?.direction;
  ok(rt.lines.every((l) => styleIds.has(l.style) && l.direction === regDir(l.style) && styleIds.has(l.style_ar) && l.direction_ar === regDir(l.style_ar)), 'every line (English and Arabic) names a registered style with the byte-equal registry direction');
  ok(rt.lines.every((l) => l.sha1_16 === sha16(l.direction + l.text) && l.sha1_16_ar === sha16(l.direction_ar + l.tts_text_ar)), 'sha1_16 and sha1_16_ar reproduce (direction + text, direction_ar + tts_text_ar)');
  ok(rt.lines.every((l) => ARABIC.test(l.tts_text_ar) && !MARKS.test(l.caption_ar.replace(/[\u0651\u064B\u064C\u064D]/g, ''))), 'tts_text_ar is Arabic; the visible caption_ar stays unvowelled (only its own shadda/tanwin)');
  ok(rt.lines.every((l) => l.tts_text_ar.split(/\s+/).filter((w) => ARABIC.test(w)).every((w) => MARKS.test(w))), 'every Arabic word of tts_text_ar carries tashkeel');
  ok(rt.lines.every((l) => /\bQA Wrap\b/.test(l.caption_ar) === /\bQA Wrap\b/.test(l.tts_text_ar) && /\bEnter\b/.test(l.caption_ar) === /\bEnter\b/.test(l.tts_text_ar)), '"QA Wrap" and "Enter" stay Latin in the Arabic TTS text exactly where the caption has them');
  ok(checkManifest(rt).length === 0, 'the renderer accepts the runtime manifest', checkManifest(rt).slice(0, 2).join(' | '));
  ok(rt.lines.every((l) => /^(?:pending|ok|missing)$/.test(l.file_status || 'pending') && /^(?:pending|ok|missing)$/.test(l.file_status_ar || 'pending')), 'file_status and file_status_ar are "pending", "ok" or "missing" on every line');
  ok(rt.lines.every((l) => l.file === `audio/en/${l.id}.ogg` && l.file_ar === `audio/ar/${l.id}.ogg`), 'every file path is audio/en/<id>.ogg or audio/ar/<id>.ogg (one folder per language; re-encoded from the renderer WAV for the package)');
  ok(rt.lines.every((l) => (l.file_status !== 'ok' || fs.existsSync(path.join(GAME, l.file))) && (l.file_status_ar !== 'ok' || fs.existsSync(path.join(GAME, l.file_ar)))), 'a line marked ok has its file on disk, in both languages');
  const tmpG = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-gate-'));
  const gm = path.join(tmpG, 'gate.json');
  fs.writeFileSync(gm, JSON.stringify(gateManifestOf(rt)));
  const r = spawnSync('python', [GATE, gm, '--text-only'], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' }, timeout: 60000 });
  ok(r.status === 0 && /PASS/.test(r.stdout || ''), 'voice_style_gate.py --text-only passes on all 22 lines (11 English, 11 Arabic with full tashkeel)', `${r.status} ${(r.stdout || r.stderr || '').trim().split('\n').pop()}`);
  const bad = structuredClone(rt);
  bad.lines[4].tts_text_ar = bad.lines[4].tts_text_ar.replace('الرَّابِعُ', 'الرابع');
  fs.writeFileSync(gm, JSON.stringify(gateManifestOf(bad)));
  const r2 = spawnSync('python', [GATE, gm, '--text-only'], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' }, timeout: 60000 });
  ok(r2.status !== 0, 'teeth: the gate fails when one Arabic word loses its tashkeel');
  recycle(tmpG);
}
{
  const code = gameSources().filter(([f]) => /\.(?:m?js|html|css)$/.test(f));
  const hits = nonEmpty(code, 'game/ code files').flatMap(([f, t]) => t.split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => /\basr\b|openrouter|speech-to-text|transcri/i.test(l)).map(([f2, i, l]) => `${f2}:${i} ${l.trim().slice(0, 70)}`));
  ok(hits.length === 0, 'no asr / openrouter / transcribe string in extension/game/** code (the game never calls a model)', hits.slice(0, 3).join(' | '));
  const rend = fs.readFileSync(RENDER, 'utf8');
  ok(!/reference\/arabic-tashkeel|evidence\/h\.py|\basr\s*\(/.test(rend), 'the renderer never imports or runs asr() from the tashkeel evidence folder');
  ok(!/openrouter/i.test(rend) && !/\bsk-or-|AQ\.[A-Za-z0-9_-]{20}/.test(rend), 'the renderer names no other service and holds no key literal');
  const urls = [...new Set(rend.match(/https?:\/\/[^\s'"`)]+/g))].filter((u) => !/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models$/.test(u));
  ok(urls.length === 0, 'the only URL in the renderer is the Gemini TTS endpoint', urls.join(' '));
}

/* ---- renderer with a mocked fetch --------------------------------------------------------------------------------- */
ok(typeof renderAll === 'function' && MAX_CALLS === 26 && MODEL === 'gemini-3.1-flash-tts-preview' && RATE_WAIT_MS >= 60000, 'tools/voice-render.mjs: renderAll(), MAX_CALLS 26 (22 lines + 4 retries), the one TTS model, a 429 waits out the minute');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-voice-'));
  const realFetch = globalThis.fetch;
  const KEY = 'test-key-not-real';
  const inputs = new Map();
  for (const l of rt.lines) for (const lang of ['en', 'ar']) { const ln = laneOf(l, lang); inputs.set(ln.direction + ln.spoken, `${l.id}:${lang}`); }
  const keyOf = (init) => inputs.get(JSON.parse(init.body).contents[0].parts[0].text);
  const pcmBody = () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.alloc(48000, 7).toString('base64') } }] } }] });
  /** plan['v03:ar'] = outcomes consumed one per call: 'ok' | 'throw' | 'http500' | 'http429' | 'empty' (default 'ok'); `all` overrides every call. */
  async function scenario(name, plan = {}, { all, go = true, mutate, gate = () => ({ status: 0, output: '' }), keyInfo = { key: KEY, source: 'test' }, pre, sleeps } = {}) {
    const seen = [];
    const fetchImpl = async (url, init = {}) => {
      const id = keyOf(init);
      const used = seen.filter((x) => x.id === id).length;
      seen.push({ id, url: String(url), body: String(init.body), headers: init.headers });
      const out = all ?? (plan[id] || [])[used] ?? 'ok';
      if (out === 'throw') throw new TypeError('network down');
      if (out === 'http500') return new Response('upstream error', { status: 500 });
      if (out === 'http429') return new Response('quota', { status: 429 });
      if (out === 'empty') return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no audio' }] } }] }), { status: 200 });
      return new Response(pcmBody(), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    globalThis.fetch = async (u) => { throw new Error(`unmocked network call to ${u}`); };
    const dir = fs.mkdtempSync(path.join(tmp, `${name}-`));
    const m = structuredClone(rt);
    m.lines.forEach((l) => { l.file_status = 'pending'; l.file_status_ar = 'pending'; delete l.seconds; delete l.seconds_ar; });
    if (mutate) mutate(m);
    const paths = { extDir: dir, gameDir: path.join(dir, 'game'), manifest: path.join(dir, 'game', 'audio', 'narration-manifest.json'), ledger: path.join(dir, 'ledger.json'), log: path.join(dir, 'log.json'), raw: path.join(dir, 'raw') };
    fs.mkdirSync(path.dirname(paths.manifest), { recursive: true });
    fs.writeFileSync(paths.manifest, JSON.stringify(m));
    if (pre) pre(paths);
    let report;
    try { report = await renderAll({ go, paths, fetchImpl, keyInfo, gate, sleep: async (ms) => { if (sleeps) sleeps.push(ms); }, now: () => 'T' }); } finally { globalThis.fetch = realFetch; }
    const ledger = fs.existsSync(paths.ledger) ? JSON.parse(fs.readFileSync(paths.ledger, 'utf8')) : [];
    return { report, seen, ledger, paths };
  }
  const per = (seen, id) => seen.filter((x) => x.id === id);
  const missingIds = (r) => r.lines.filter((l) => ['missing', 'budget', 'rate-limited'].includes(l.outcome)).map((l) => `${l.id}:${l.lang}`);
  const allKeys = rt.lines.flatMap((l) => [`${l.id}:en`, `${l.id}:ar`]);

  let gateSeen = null;
  const a = await scenario('all-ok', {}, { gate: (file, o) => { if (o.textOnly) gateSeen = JSON.parse(fs.readFileSync(file, 'utf8')); return { status: 0, output: '' }; } });
  ok(a.seen.length === 22 && a.report.callsThisRun === 22, 'all lines succeed: exactly 22 calls (one take per line per language)', `${a.seen.length}/${a.report.callsThisRun}`);
  ok(allKeys.every((k) => per(a.seen, k).length === 1), 'a 200 with audio is never retried, never re-voiced');
  ok(a.report.exit === 0 && missingIds(a.report).length === 0, 'all lines succeed: exit 0, nothing missing');
  ok(a.ledger.length === 22 && a.ledger.every((r) => r.id && r.lang && r.attempt === 1 && r.outcome === 'ok'), 'the ledger has one row per call: id, lang, attempt, outcome', JSON.stringify(a.ledger[0]));
  ok(a.seen.every((x) => x.url === TTS_URL && /^https:\/\/generativelanguage\.googleapis\.com\//.test(x.url)), 'every mocked request goes to the one Gemini TTS endpoint');
  ok(a.seen.every((x) => x.headers['x-goog-api-key'] === KEY && !x.url.includes(KEY) && !x.body.includes(KEY) && !JSON.stringify(x.headers).includes('Bearer')), 'the key travels only in the x-goog-api-key header (not in the URL or the body)');
  ok(a.seen.every((x) => { const b = JSON.parse(x.body); return Object.keys(b).sort().join() === 'contents,generationConfig' && b.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === 'Kore' && b.generationConfig.responseModalities.join() === 'AUDIO'; }), 'every request is one Gemini TTS call: audio modality, voice Kore, nothing else (no ASR, no judge)');
  ok(a.seen.filter((x) => x.id.endsWith(':ar')).every((x) => { const l = rt.lines.find((y) => y.id === x.id.slice(0, 3)); return JSON.parse(x.body).contents[0].parts[0].text === l.direction_ar + l.tts_text_ar; }), 'Arabic input = direction_ar + the fully vowelled tts_text_ar, byte-exact');
  ok(a.seen.filter((x) => x.id.endsWith(':en')).every((x) => { const l = rt.lines.find((y) => y.id === x.id.slice(0, 3)); return JSON.parse(x.body).contents[0].parts[0].text === l.direction + (l.tts_text || l.text); }), 'English input = direction + tts_text, byte-exact');
  const m1 = JSON.parse(fs.readFileSync(a.paths.manifest, 'utf8'));
  ok(m1.lines.every((l) => l.file_status === 'ok' && l.file_status_ar === 'ok' && l.seconds > 0 && l.seconds_ar > 0), 'the manifest marks every voiced line ok in both languages with measured seconds');
  ok(m1.lines.every((l) => fs.existsSync(path.join(a.paths.gameDir, l.file)) && fs.existsSync(path.join(a.paths.gameDir, l.file_ar))), 'audio/en and audio/ar WAV files were written');
  const wav = fs.readFileSync(path.join(a.paths.gameDir, 'audio/ar/v01.wav'));
  ok(wav.toString('ascii', 0, 4) === 'RIFF' && wav.readUInt32LE(24) === 24000 && wav.readUInt16LE(22) === 1 && wav.readUInt16LE(34) === 16, 'the Arabic take is a 24 kHz mono 16-bit WAV');
  ok(gateSeen && gateSeen.lines.length === 22 && gateSeen.lines.filter((l) => l.lang === 'ar').length === 11 && gateSeen.lines.filter((l) => l.lang === 'ar').every((l) => !/[A-Za-z]/.test(l.text)), 'the text-only gate is run over all 22 lines before any call (Latin tokens left out of the visible text it aligns)');
  ok(!fs.readFileSync(a.paths.log, 'utf8').includes(KEY) && !fs.readFileSync(a.paths.ledger, 'utf8').includes(KEY) && !fs.readFileSync(a.paths.manifest, 'utf8').includes(KEY), 'the key is in no output file');

  const sl = [];
  const b = await scenario('one-retry', { 'v03:ar': ['throw'] }, { sleeps: sl });
  ok(b.seen.length === 23 && per(b.seen, 'v03:ar').length === 2, 'a transport failure repeats the line exactly once', String(b.seen.length));
  ok(per(b.seen, 'v03:ar')[0].body === per(b.seen, 'v03:ar')[1].body, 'the retry is byte-identical (same input, never a "better" take)');
  ok(missingIds(b.report).length === 0 && b.report.exit === 0, 'the retry gave audio: nothing is missing');
  ok(b.ledger.filter((r) => r.id === 'v03' && r.lang === 'ar').map((r) => r.attempt).join() === '1,2', 'the ledger shows attempts 1 and 2 for the retried line');
  ok(!sl.includes(RATE_WAIT_MS), 'a non-429 failure does not wait out the quota minute');

  const c = await scenario('twice', { 'v05:en': ['http500', 'throw'] });
  ok(per(c.seen, 'v05:en').length === 2, 'a line that fails twice is called exactly twice, never a third time');
  ok(JSON.stringify(missingIds(c.report)) === '["v05:en"]' && c.report.exit === 1, 'a line with no audio after its retry is reported missing (the game plays it caption-only)', JSON.stringify(missingIds(c.report)));
  ok(JSON.parse(fs.readFileSync(c.paths.manifest, 'utf8')).lines.find((l) => l.id === 'v05').file_status === 'missing', 'its manifest row says file_status "missing"');

  const d = await scenario('empty', { 'v02:en': ['empty'], 'v04:ar': ['http500'] });
  ok(per(d.seen, 'v02:en').length === 2 && per(d.seen, 'v04:ar').length === 2, 'a 200 without audio and a non-200 both count as "no audio came back" (one retry each)');

  const sl2 = [];
  const q = await scenario('quota-retry', { 'v06:en': ['http429', 'ok'] }, { sleeps: sl2 });
  ok(per(q.seen, 'v06:en').length === 2 && sl2.includes(RATE_WAIT_MS) && missingIds(q.report).length === 0, 'a 429 waits out the minute, then the one retry gets the take');
  const sl3 = [];
  const q2 = await scenario('quota-stop', { 'v07:en': ['http429', 'http429'] }, { sleeps: sl3 });
  ok(q2.report.rateLimited === true && q2.report.exit === 1 && q2.seen.length === 6 + 2, 'a 429 that survives the minute stops the run: no further call is spent', `${q2.seen.length}`);
  ok(q2.report.lines.find((l) => l.id === 'v07' && l.lang === 'en').outcome === 'rate-limited', 'the stopped line says rate-limited');

  const e = await scenario('ceiling', {}, { all: 'throw' });
  ok(e.seen.length <= 26 && e.report.callsTotal <= 26, 'every call fails: the run stops at the 26-call ceiling', String(e.seen.length));
  ok(e.seen.length === 26 && missingIds(e.report).length === 22, 'every call fails: 26 calls are spent, all 22 lines are listed as missing', `${e.seen.length}/${missingIds(e.report).length}`);
  proveTeeth('the call ceiling', (n) => (n > 26 ? ['over'] : []), 27);

  const f = await scenario('prior-ledger', {}, { pre: (p) => fs.writeFileSync(p.ledger, JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ id: 'v01', attempt: 1, outcome: 'ok', i })))) });
  ok(f.seen.length <= 1, 'the ceiling counts calls across runs (25 on the ledger: at most 1 more)', String(f.seen.length));

  const g = await scenario('plan-only', {}, { go: false });
  ok(g.seen.length === 0 && g.report.mode === 'plan' && g.report.lines.length === 22, 'the plan run (no --go) makes zero calls and lists 22 lines');
  const h = await scenario('stale', {}, { mutate: (m) => { m.lines[2].text += ' extra'; } });
  ok(h.seen.length === 0 && h.report.exit === 2 && /stale/.test(h.report.refused || ''), 'a stale English line (sha1 differs) stops the run with zero calls', String(h.report.refused).slice(0, 80));
  const h2 = await scenario('stale-ar', {}, { mutate: (m) => { m.lines[2].tts_text_ar += ' '; } });
  ok(h2.seen.length === 0 && h2.report.exit === 2 && /Arabic stale/.test(h2.report.refused || ''), 'a changed Arabic TTS text (sha1_16_ar differs) stops the run with zero calls');
  const i = await scenario('gate-red', {}, { gate: () => ({ status: 1, output: 'FAIL' }) });
  ok(i.seen.length === 0 && i.report.exit === 2, 'a failing voice_style_gate.py stops the run with zero calls');
  const j = await scenario('no-key', {}, { keyInfo: null });
  ok(j.seen.length === 0 && j.report.exit === 2, 'no key: the run is refused, zero calls');
  const k = await scenario('exists', {}, { pre: (p) => { for (const lang of ['en', 'ar']) { fs.mkdirSync(path.join(p.gameDir, 'audio', lang), { recursive: true }); fs.writeFileSync(path.join(p.gameDir, 'audio', lang, 'v01.wav'), 'x'); } } });
  ok(per(k.seen, 'v01:en').length === 0 && per(k.seen, 'v01:ar').length === 0 && k.seen.length === 20, 'an existing take is never overwritten and never re-voiced (either language)', String(k.seen.length));
  const l2 = await scenario('resume', {}, { pre: (p) => { fs.mkdirSync(p.raw, { recursive: true }); fs.writeFileSync(path.join(p.raw, 'ar-v02.pcm'), Buffer.alloc(48000, 7)); } });
  ok(per(l2.seen, 'v02:ar').length === 0 && l2.seen.length === 21 && l2.report.lines.find((x) => x.id === 'v02' && x.lang === 'ar').outcome === 'encoded-from-raw', 'a raw take on disk is encoded again without a call');
  recycle(tmp);
}

/* ---- captions come from the manifest, per language; the voice file follows the UI language --------------------------- */
{
  const { createVoice } = await import(pathToFileURL(path.join(GAME, 'audio', 'voice.js')).href);
  const stub = { addHooks() {}, isAudible: () => false, getState: () => ({ voice: true }), setVoiceActive() {}, sfxTailRemainingMs: () => 0, context: null };
  const withOk = structuredClone(rt);
  withOk.lines.forEach((l) => { l.file_status = 'ok'; l.file_status_ar = 'ok'; l.seconds = l.seconds || 5; l.seconds_ar = l.seconds_ar || 5; });
  const mk = (manifest, urls) => createVoice(stub, { manifest, fetch: async (u) => { urls.push(String(u)); return { ok: false }; } });
  const urls = [];
  const v = mk(withOk, urls);
  await v.load();
  ok(v.ids().length === 11, 'voice.js loads all 11 lines from the manifest');
  for (const l of design.lines) {
    ok(v.captionFor(l.id, 'en') === l.text, `captionFor(${l.id}, en) is the spoken text verbatim`);
    ok(v.captionFor(l.id, 'ar') === l.caption_ar, `captionFor(${l.id}, ar) is the Arabic caption`);
  }
  v.setLang('ar');
  ok(rt.lines.every((l) => v.voiceFor(l.id) === 'ar'), 'with the Arabic UI every line chooses the Arabic voice file');
  v.setLang('en');
  ok(rt.lines.every((l) => v.voiceFor(l.id) === 'en'), 'with the English UI every line chooses the English voice file');
  // preload only requests files when the audio context could decode them; with a context-less stub the choice is what counts.
  const arOnlyMissing = structuredClone(withOk);
  arOnlyMissing.lines[1].file_status_ar = 'missing';
  const v2 = mk(arOnlyMissing, []);
  await v2.load(); v2.setLang('ar');
  ok(v2.voiceFor('v02') === null && v2.voiceFor('v03') === 'ar', 'a missing Arabic file is caption-only under the Arabic UI (no English voice) for that line only');
  const miss = createVoice(stub, { manifest: design, fetch: async () => ({ ok: false }) });
  await miss.load();
  const mc = [];
  miss.onCaption((p) => mc.push(p));
  miss.setLang('ar');
  const r = miss.play('v02');
  ok(r.missing === true, 'a line whose file is not rendered answers { missing: true } (caption-only, no error)');
  ok(mc.length === 1 && mc[0].text === design.lines[1].caption_ar && mc[0].dir === 'rtl' && mc[0].silent === true, 'caption-only: the Arabic caption still shows, right-to-left, silent', JSON.stringify(mc[0]));
  miss.stop();
}
finish('test-game-voice');
