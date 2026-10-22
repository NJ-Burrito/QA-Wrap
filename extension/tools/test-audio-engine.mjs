/* QA Wrap - Bug Hunt lane C: SFX engine, bus, voice playback and captions, against a fake AudioContext (node, no browser).
 *   node tools/test-audio-engine.mjs      (from extension/)
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createAudio, DUCK_LEVEL } from '../game/audio/bus.js';
import { createSfx, cueInfo, CUE_IDS, MAX_CUE_S } from '../game/audio/sfx.js';
import { createVoice, createClock, GAP_MS } from '../game/audio/voice.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.resolve(here, '..', 'game', 'audio');
const manifest = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, 'narration-manifest.json'), 'utf8'));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

/* ---- fakes ---- */
function param(v = 0) {
  return { value: v, ramps: [], cancelScheduledValues() {}, setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime(x, t) { this.ramps.push([x, t]); this.last = x; }, exponentialRampToValueAtTime(x, t) { this.ramps.push([x, t]); } };
}
let ctxCount = 0;
let lastCtx = null;
class FakeNode { connect() { return this; } }
class FakeCtx {
  constructor() { ctxCount++; lastCtx = this; this.currentTime = 1; this.state = 'suspended'; this.sampleRate = 8000; this.destination = new FakeNode(); this.sources = []; this.gains = []; this.suspends = 0; this.resumes = 0; }
  createGain() { const g = new FakeNode(); g.gain = param(1); this.gains.push(g); return g; }
  createDynamicsCompressor() { const c = new FakeNode(); c.threshold = param(); c.ratio = param(); return c; }
  createOscillator() { const o = new FakeNode(); o.frequency = param(); o.start = () => this.sources.push(o); o.stop = () => {}; return o; }
  createBiquadFilter() { const f = new FakeNode(); f.frequency = param(); f.Q = param(); return f; }
  createBuffer(c, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { const s = new FakeNode(); s.start = () => { s.started = true; this.sources.push(s); }; s.stop = () => { s.stopped = true; }; return s; }
  async decodeAudioData(ab) { return { duration: 5, bytes: ab.byteLength }; }
  async suspend() { this.state = 'suspended'; this.suspends++; }
  async resume() { this.state = 'running'; this.resumes++; }
}
function timers() {
  let t = 0; let id = 0; const q = new Map();
  return {
    setTimeout: (fn, ms) => { const i = ++id; q.set(i, { fn, at: t + ms }); return i; },
    clearTimeout: (i) => q.delete(i),
    now: () => t,
    async advance(ms) { const end = t + ms; for (;;) { const next = [...q.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (!next || next[1].at > end) break; t = next[1].at; q.delete(next[0]); next[1].fn(); await Promise.resolve(); await Promise.resolve(); } t = end; await Promise.resolve(); await Promise.resolve(); },
  };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); };
const okManifest = ({ ar = false } = {}) => { const m = JSON.parse(JSON.stringify(manifest)); m.lines.forEach((l) => { l.file_status = 'ok'; l.seconds = 5; if (ar) { l.file_status_ar = 'ok'; l.seconds_ar = 4; } else { l.file_status_ar = 'pending'; } }); return m; };
function fetchFor(missing = []) {
  const calls = [];
  const f = async (url) => { calls.push(url); if (missing.some((m) => url.includes(m))) return { ok: false, status: 404 }; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) }; };
  f.calls = calls;
  return f;
}
function rig({ m = okManifest(), missing = [], lang = 'en' } = {}) {
  ctxCount = 0;
  const audio = createAudio({ AudioContext: FakeCtx });
  const sfx = createSfx(audio);
  const tm = timers();
  const fetch = fetchFor(missing);
  const voice = createVoice(audio, { manifest: m, fetch, clockEnv: tm, lang });
  const caps = [];
  voice.onCaption((c) => caps.push(c));
  return { audio, sfx, voice, tm, fetch, caps };
}

/* ---- 1. nothing before the first press ---- */
{
  const { audio, sfx, voice, caps } = rig();
  await voice.load();
  eq(ctxCount, 0, 'no AudioContext before a press');
  eq(sfx.play('catch'), false, 'SFX silent before the first press');
  eq(audio.isAudible(), false, 'not audible before unlock');
  eq([audio.getState().sound, audio.getState().voice, audio.getState().muted], [true, true, false], 'sound and voice are ON by default for a fresh player (only the context waits for a press)');
  const r = voice.play('v01');
  await flush();
  eq(r.seconds, 5, 'voice.play still returns a length');
  eq(caps.length, 1, 'caption shows even before the first press');
  eq(caps[0].silent, true, 'caption marked silent');
  eq(ctxCount, 0, 'still no context after voice.play');
  audio.unlock();
  eq(ctxCount, 1, 'context created by the press');
  audio.unlock();
  eq(ctxCount, 1, 'unlock is idempotent');
  eq(lastCtx.resumes >= 1, true, 'context resumed in the press');
  eq(audio.isAudible(), true, 'on by default, unlocks on first gesture: audible right after the first press with no toggle');
}

/* ---- 2. the cue set ---- */
{
  const CUES_17 = ['click', 'note-save', 'catch', 'combo-up', 'bonus-found', 'star', 'level-clear', 'hint-boop', 'not-yet', 'level-start', 'whoosh', 'fanfare', 'tool-ok', 'deduct', 'tell-tick', 'fall', 'trial-clear'];
  eq([...CUE_IDS].sort().join(), [...CUES_17].sort().join(), '17 cues, named: spec 11 + combo-up + tool-ok + deduct + the hard trials tell-tick, fall, trial-clear');
  for (const id of CUES_17) ok(CUE_IDS.includes(id), `cue ${id}`);
  for (const id of CUE_IDS) {
    const i = cueInfo(id, { step: 3 });
    ok(i.length <= MAX_CUE_S, `${id} is ${i.length.toFixed(2)} s (<= 1.6)`);
    ok(i.maxRepeatHz <= 3, `${id} repeats a pitch at ${i.maxRepeatHz.toFixed(1)} Hz (<= 3)`);
    ok(i.peakDb <= -10, `${id} peak ${i.peakDb} dBFS`);
  }
  eq(Math.round(cueInfo('fanfare').length * 100) / 100, 1.6, 'fanfare is the longest at 1.6 s');
  ok(cueInfo('deduct').peakDb <= -22 && cueInfo('deduct').length <= 0.15, 'deduct is short and quiet');
  ok(cueInfo('deduct').maxRepeatHz === 0 && cueInfo('deduct').nodes === 1, 'deduct is one tone, no repeat, no buzz');
  ok(cueInfo('tool-ok').peakDb >= cueInfo('deduct').peakDb + 6, 'tool-ok is clearly brighter than deduct');
  const { sfx, audio } = rig();
  audio.unlock();
  for (const id of CUE_IDS) ok(sfx.play(id, { step: 3 }) === true, `${id} plays after unlock`);
  eq(sfx.play('nope'), false, 'unknown cue is silent');
  const freqs = (id, opts) => { const x = rig(); x.audio.unlock(); x.sfx.play(id, opts); return x; };
  // combo-up: one semitone per step, capped at +7; bonus-found: a fourth above catch
  const f0 = (id, opts) => { const x = freqs(id, opts); return x.audio.context.sources.map((s) => s.frequency && s.frequency.value).filter(Boolean); };
  const base = f0('catch')[0];
  ok(Math.abs(f0('combo-up', { step: 1 })[0] / base - 2 ** (1 / 12)) < 1e-3, 'combo-up step 1 = +1 semitone');
  ok(Math.abs(f0('combo-up', { step: 99 })[0] / base - 2 ** (7 / 12)) < 1e-3, 'combo-up capped at +7');
  ok(Math.abs(f0('bonus-found')[0] / base - 2 ** (5 / 12)) < 1e-3, 'bonus-found = a fourth above catch');
}

/* ---- 3. mute, volume, voice toggle, M key ---- */
{
  const { audio, sfx } = rig();
  audio.unlock();
  eq(audio.getState().masterTarget, 0.6, 'default volume 0.6');
  audio.setMuted(true);
  eq([audio.getState().masterTarget, audio.masterGain.gain.last], [0, 0], 'mute = master gain 0');
  eq(sfx.play('click'), false, 'muted = no cue');
  audio.setMuted(false); audio.setVolume(0.25);
  eq(audio.masterGain.gain.last, 0.25, 'volume sets master');
  audio.setVolume(5);
  eq(audio.getState().volume, 1, 'volume clamps');
  eq([audio.getState().sound, audio.getState().voice], [true, true], 'sound and voice are separate flags');
  audio.setVoice(false);
  eq([audio.getState().sound, audio.getState().voice], [true, false], 'voice off keeps sound');
  const heard = []; audio.onChange((s) => heard.push(s.muted));
  const handlers = {}; const doc = { activeElement: null, hidden: false, addEventListener: (t, f) => { handlers[t] = f; }, removeEventListener: (t) => { delete handlers[t]; } };
  const unbind = audio.bindKeys(doc);
  const key = (o) => handlers.keydown({ key: 'm', code: 'KeyM', target: { tagName: 'DIV' }, ...o });
  key({}); eq(audio.getState().muted, true, 'M mutes');
  key({}); eq(audio.getState().muted, false, 'M unmutes');
  key({ ctrlKey: true }); key({ altKey: true }); key({ target: { tagName: 'TEXTAREA' } }); key({ repeat: true });
  eq(audio.getState().muted, false, 'M ignored with Ctrl/Alt, in a text field, or when repeating');
  eq(heard, [true, false], 'onChange reports each mute edit');
  unbind(); eq(handlers.keydown, undefined, 'unbind removes the listener');
  // armUnlock: first press creates the context
  const x = rig(); const h2 = {}; const d2 = { addEventListener: (t, f) => { h2[t] = f; }, removeEventListener: (t) => { delete h2[t]; } };
  x.audio.armUnlock(d2); eq(ctxCount, 0, 'armed, not created'); h2.pointerdown(); eq(ctxCount, 1, 'first pointerdown creates it'); eq(h2.keydown, undefined, 'one-shot');
  // blur does not pause; a hidden tab does
  const y = rig(); y.audio.unlock(); const h3 = {}; const d3 = { hidden: false, addEventListener: (t, f) => { h3[t] = f; }, removeEventListener() {} };
  y.audio.bindLifecycle(d3); eq(Object.keys(h3), ['visibilitychange'], 'only visibilitychange is listened to (never blur)');
  h3.visibilitychange(); eq(y.audio.getState().held, false, 'visible tab does not suspend');
  d3.hidden = true; h3.visibilitychange(); eq(y.audio.getState().held, true, 'hidden tab suspends'); eq(lastCtx.suspends, 1, 'context suspended');
  y.audio.resume(); eq(y.audio.getState().held, false, 'resume');
}

/* ---- 4. voice follows the UI language (Arabic file; no English voice under the Arabic UI), captions follow it too, ducking, caption-only fallbacks ---- */
{
  const { audio, voice, fetch, caps } = rig({ lang: 'ar', m: okManifest({ ar: true }) });
  await voice.load();
  audio.unlock();
  eq(voice.getLang(), 'ar', 'caption language = UI language');
  eq(voice.captionFor('v04', 'en'), manifest.lines[3].text, 'EN caption is the spoken text verbatim');
  eq(voice.captionFor('v04', 'ar'), manifest.lines[3].caption_ar, 'AR caption from the manifest');
  const r = voice.play('v02');
  await flush();
  eq(r, { seconds: 4 }, 'play returns the Arabic clip length');
  ok(fetch.calls.includes('/' + manifest.lines[1].file_ar) && !fetch.calls.some((u) => u.includes('/audio/en/')), 'Arabic UI: the Arabic file plays, never the English one');
  eq(caps.at(-1).text, manifest.lines[1].caption_ar, 'caption in Arabic');
  eq([caps.at(-1).lang, caps.at(-1).dir, caps.at(-1).silent], ['ar', 'rtl', false], 'rtl caption, voiced');
  eq(voice.status().playing, 'v02', 'playing');
  ok(audio.getState().sfxTarget < 0.4 && audio.getState().sfxTarget === DUCK_LEVEL, 'SFX bus ducked to 35 % while the voice flag is set');
  ok(audio.getState().voiceActive === true, 'voice flag set');
  voice.setLang('en');
  eq(caps.at(-1).text, manifest.lines[1].text, 'switching language re-captions the line in English');
  // line ends: ducking released, 500 ms gap scheduled
  const src = audio.context.sources.find((s) => s.started);
  src.onended();
  eq([audio.getState().voiceActive, audio.getState().sfxTarget], [false, 1], 'ducking released after the line');
}

/* ---- 4b. the Arabic voice: Arabic UI plays audio/ar, English UI plays audio/en, a missing Arabic file is caption-only (no English voice under the Arabic UI) ---- */
{
  const arm = okManifest({ ar: true });
  const a = rig({ m: arm, lang: 'ar' }); await a.voice.load(); a.audio.unlock();
  eq(a.voice.voiceFor('v02'), 'ar', 'Arabic UI: the Arabic file is the one chosen');
  const r = a.voice.play('v02'); await flush();
  eq(r, { seconds: 4 }, 'play returns the Arabic clip length');
  ok(a.fetch.calls.includes('/' + arm.lines[1].file_ar) && a.fetch.calls.every((u) => !u.includes('/audio/en/')), 'only /audio/ar/v02.wav was requested');
  eq([a.voice.status().playing, a.caps.at(-1).text], ['v02', arm.lines[1].caption_ar], 'Arabic voice with the Arabic caption');
  eq(a.caps.at(-1).ms, Math.max(1500, 4000 + 600), 'caption length follows the Arabic clip');

  const e = rig({ m: arm, lang: 'en' }); await e.voice.load(); e.audio.unlock();
  eq(e.voice.voiceFor('v02'), 'en', 'English UI: the English file');
  e.voice.play('v02'); await flush();
  ok(e.fetch.calls.includes('/' + arm.lines[1].file) && e.fetch.calls.every((u) => !u.includes('/audio/ar/')), 'English UI never touches /audio/ar/');

  // switching the UI language switches the file for the next line
  const sw = rig({ m: arm, lang: 'en' }); await sw.voice.load(); sw.audio.unlock();
  sw.voice.setLang('ar'); sw.voice.play('v03'); await flush();
  ok(sw.fetch.calls.includes('/' + arm.lines[2].file_ar), 'after setLang(ar) the next line is the Arabic file');

  // the Arabic file is missing on the server (404): caption-only, no English voice, caption still Arabic
  const miss = rig({ m: arm, lang: 'ar', missing: ['/audio/ar/v02'] }); await miss.voice.load(); miss.audio.unlock();
  miss.voice.play('v02'); await flush();
  ok(miss.fetch.calls.includes('/' + arm.lines[1].file_ar) && !miss.fetch.calls.some((u) => u.includes('/audio/en/')), 'Arabic 404: no English file requested');
  eq([miss.caps.at(-1).text, miss.voice.voiceFor('v02')], [arm.lines[1].caption_ar, null], 'Arabic caption shows, no voice file chosen (no English voice)');

  // the manifest marks the Arabic file missing: no Arabic request and no English one
  const pm = okManifest({ ar: true }); pm.lines[3].file_status_ar = 'missing';
  const p = rig({ m: pm, lang: 'ar' }); await p.voice.load(); p.audio.unlock();
  p.voice.play('v04'); await flush();
  ok(p.fetch.calls.every((u) => !u.includes('/audio/ar/v04') && !u.includes('/audio/en/v04')), 'file_status_ar missing: no file requested');
  eq(p.voice.hasFile('v04'), false, 'no voice file under the Arabic UI (caption-only)');

  // neither language has a file: caption-only
  const none = okManifest({ ar: true }); none.lines[4].file_status_ar = 'missing'; none.lines[4].file_status = 'missing';
  const nn = rig({ m: none, lang: 'ar' }); await nn.voice.load(); nn.audio.unlock();
  const rn = nn.voice.play('v05'); await flush();
  eq([rn.missing, nn.caps.at(-1).silent, nn.voice.hasFile('v05'), nn.voice.voiceFor('v05')], [true, true, false, null], 'no file in either language: caption-only');

  // the shipped manifest names both folders, one file per language per line
  ok(manifest.lines.every((l) => l.file === `audio/en/${l.id}.ogg` && l.file_ar === `audio/ar/${l.id}.ogg`), 'shipped manifest: audio/en and audio/ar OGG paths on every line');
}

/* ---- 5. caption-only fallbacks ---- */
{
  // file_status pending (not yet rendered): caption only, no fetch, play reports missing
  const { audio, voice, fetch, caps } = rig({ m: (() => { const m = JSON.parse(JSON.stringify(manifest)); m.lines.forEach((l) => { l.file_status = 'pending'; }); return m; })() });
  await voice.load(); audio.unlock();
  const r = voice.play('v03'); await flush();
  eq([r.missing, r.seconds > 0], [true, true], 'pending file = missing, with a length');
  eq(fetch.calls.filter((u) => /.(?:opus|wav)$/.test(u)).length, 0, 'no request for an unrendered file (no console noise)');
  eq([caps.at(-1).silent, caps.at(-1).missing], [true, true], 'caption-only');
  // status ok but the file is gone (404): the caption stays, the game goes on
  const b = rig({ missing: ['v05'] }); await b.voice.load(); b.audio.unlock();
  b.voice.play('v05'); await flush();
  eq(b.caps.at(-1).id, 'v05', 'caption shown');
  eq(b.voice.status().playing, null, 'nothing playing');
  eq(b.voice.play('v05').missing, true, 'known-missing after the failed fetch');
  // muted: caption yes, sound no
  const c = rig(); await c.voice.load(); c.audio.unlock(); c.audio.setMuted(true);
  c.voice.play('v06'); await flush();
  eq([c.caps.at(-1).id, c.caps.at(-1).silent, c.voice.status().playing], ['v06', true, null], 'muted: caption only');
  // voice off keeps SFX and captions
  const d = rig(); await d.voice.load(); d.audio.unlock(); d.audio.setVoice(false);
  d.voice.play('v06'); await flush();
  eq([d.caps.at(-1).silent, d.voice.status().playing, d.sfx.play('click')], [true, null, true], 'voice off: caption and SFX stay');
  // after the ffmpeg fallback the manifest points at a .wav: voice.js follows `file`
  const wm = okManifest(); wm.lines[1].file = 'audio/en/v02.wav';
  const w = rig({ m: wm }); await w.voice.load(); w.audio.unlock();
  w.voice.play('v02'); await flush();
  ok(w.fetch.calls.includes('/audio/en/v02.wav') && w.voice.status().playing === 'v02', 'voice.js plays the WAV the manifest names');
  // unknown id
  eq(d.voice.play('v99'), { missing: true, seconds: 0 }, 'unknown id');
}

/* ---- 6. one at a time, 500 ms gap, fanfare tail, pause ---- */
{
  const { audio, sfx, voice, tm, caps } = rig();
  await voice.load(); audio.unlock();
  voice.play('v01'); await flush();
  const first = audio.context.sources.find((s) => s.started);
  voice.play('v02'); await flush();
  ok(first.stopped === true, 'a new line cuts the old one');
  eq(voice.status().playing, 'v02', 'one line at a time');
  // natural end then a request inside the gap waits
  const cur = audio.context.sources.filter((s) => s.started).at(-1); cur.onended();
  voice.play('v07'); await flush();
  eq(voice.status().caption, 'v02', 'v07 waits out the silence gap');
  await tm.advance(GAP_MS + 10); await flush();
  eq(voice.status().caption, 'v07', 'v07 starts after the gap');
  // fanfare then v11: v11 begins only after the fanfare tail
  voice.stop(); await tm.advance(2000);
  sfx.play('fanfare');
  voice.play('v11'); await flush();
  ok(voice.status().caption !== 'v11', 'v11 does not start during the fanfare');
  audio.context.currentTime += 1.7; // the context clock passes the fanfare tail
  await tm.advance(2000); await flush();
  eq(voice.status().caption === 'v11' || caps.at(-1)?.id === 'v11', true, 'v11 starts after the fanfare tail');
  // pause: caption clock freezes with the audio and continues exactly
  voice.stop(); caps.length = 0;
  voice.play('v10'); await flush();
  const total = caps[0].ms;
  await tm.advance(total - 500);
  audio.suspend();
  await tm.advance(60000);
  ok(caps.at(-1) !== null, 'caption still up while paused');
  audio.resume();
  await tm.advance(499); ok(caps.at(-1) !== null, 'still up 1 ms before the end');
  await tm.advance(2); eq(caps.at(-1), null, 'caption cleared exactly when the remaining time is over');
  ok(total >= 1500, 'caption lasts at least 1.5 s');
}

/* ---- 7. clock ---- */
{
  const tm = timers(); const c = createClock(tm); const hits = [];
  c.after(100, () => hits.push('a')); c.pause(); await tm.advance(1000); eq(hits, [], 'paused clock does not fire'); c.resume(); await tm.advance(100); eq(hits, ['a'], 'fires after resume');
}

/* ---- 8. source rules for game/** audio files ---- */
{
  for (const f of ['bus.js', 'sfx.js', 'voice.js', 'narration-manifest.json']) {
    const s = fs.readFileSync(path.join(AUDIO_DIR, f), 'utf8');
    ok(!/Math\.random|streak|daily|freeze|flame|leaderboard|notification|alarm/.test(s), `${f}: no forbidden token`);
    ok(!/asr|openrouter/i.test(s), `${f}: no asr/openrouter string`);
    ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|sendBeacon|XMLHttpRequest|WebSocket/.test(s), `${f}: no storage or egress API`);
    ok(!/https?:\/\//.test(s), `${f}: no external URL`);
    ok(!/Cairo|font-family/i.test(s), `${f}: no font reference`);
  }
}

console.log(`audio engine tests: ${n} assertions passed`);
