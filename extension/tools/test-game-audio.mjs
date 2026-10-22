/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt audio and captions (DESIGN-bug-hunt sections 4, 5; owner changes of 2026-10-12): the real bus.js, sfx.js and voice.js
 * on a recording fake AudioContext, then the real page in headless Chromium.
 *
 *   node tools/test-game-audio.mjs        (from extension/, PYTHONUTF8=1)
 *
 * Part 1 (fake AudioContext): no context before a press; mute is master gain 0; the SFX bus ducks under 0.4 while a voice line
 * plays; every cue is <= 1.6 s, rises or stays flat (no descending buzz), never loops and never repeats a pitch faster than
 * 3 Hz; the fourteen cues exist (the eleven of the design, combo-up, tool-ok, deduct); v11 never starts during the fanfare;
 * one line at a time with 400-600 ms of silence; a hidden tab suspends and blur does not; M toggles sound outside text fields.
 * Part 2 (the page): no AudioContext before Start; blur does not pause, a hidden tab does; captions follow the UI language
 * while the voice file asked for is always English; a missing voice file leaves the caption and the game working.
 * No model, no network, no key. Until game/ lands the page part exits 2.
 */
import path from 'node:path';
import { assert, ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import { GAME, has, readJson, imp } from './lib-game-engine.mjs';
import { startGame, launch, openGame, reach } from './lib-game.mjs';

if (!has('audio/bus.js', 'audio/sfx.js', 'audio/voice.js', 'audio/narration-manifest.json')) {
  skipNotEnforced({ rule: 'game', what: 'audio engine and captions', why: 'extension/game/audio (lane C) has not landed' });
  finish('test-game-audio', { skipped: 1 });
}

/* ---- a recording fake AudioContext --------------------------------------------------------------------------------- */
class Param {
  constructor(v = 1) { this.value = v; this.target = v; this.events = []; }
  cancelScheduledValues() { return this; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.last = { v, t }; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['lin', v, t]); this.target = v; this.ramp = { to: v, secs: t - (this.last ? this.last.t : t), at: t }; return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); return this; }
}
function makeFake() {
  const log = { ctxs: [], nodes: [], edges: [] };
  class Node {
    constructor(kind, ctx) { this.kind = kind; this.ctx = ctx; log.nodes.push(this); }
    connect(to) { log.edges.push([this, to]); return to; }
  }
  class Ctx {
    constructor() { log.ctxs.push(this); this.currentTime = 0; this.sampleRate = 48000; this.state = 'suspended'; this.destination = new Node('destination', this); this.suspends = 0; this.resumes = 0; }
    resume() { this.state = 'running'; this.resumes++; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; this.suspends++; return Promise.resolve(); }
    createGain() { const n = new Node('gain', this); n.gain = new Param(1); return n; }
    createDynamicsCompressor() { const n = new Node('comp', this); n.threshold = new Param(-24); n.ratio = new Param(12); return n; }
    createOscillator() { const n = new Node('osc', this); n.frequency = new Param(440); n.start = (t) => { n.startAt = t; }; n.stop = (t) => { n.stopAt = t; }; return n; }
    createBufferSource() { const n = new Node('buf', this); n.start = (t) => { n.startAt = t ?? this.currentTime; n.started = true; }; n.stop = (t) => { n.stopAt = t; }; return n; }
    createBiquadFilter() { const n = new Node('biquad', this); n.frequency = new Param(350); n.Q = new Param(1); return n; }
    createBuffer(ch, len) { return { length: len, getChannelData: () => new Float32Array(len) }; }
    decodeAudioData() { return Promise.resolve({ duration: 2 }); }
  }
  return { Ctx, log };
}
const kindsOf = (log, k) => log.nodes.filter((n) => n.kind === k);

const bus = await imp('audio/bus.js');
const sfxMod = await imp('audio/sfx.js');
const voiceMod = await imp('audio/voice.js');
const rt = readJson(GAME, 'audio', 'narration-manifest.json');

/* ---- no context before a press; graph; mute; volume; ducking -------------------------------------------------------- */
{
  const { Ctx, log } = makeFake();
  const audio = bus.createAudio({ AudioContext: Ctx });
  const sfx = sfxMod.createSfx(audio);
  ok(log.ctxs.length === 0, 'no AudioContext exists before the first press');
  ok(sfx.play('click') === false && log.ctxs.length === 0, 'a cue asked for before the first press is silent and creates no context');
  ok(audio.isAudible() === false, 'nothing is audible before a press');
  ok(audio.getState().sound === true && audio.getState().voice === true, 'on by default: sound and voice are enabled before the first press (only the context waits for it)');
  ok(audio.unlock() === true && audio.isAudible() === true, 'unlocks on the first gesture: audible with no extra toggle');
  ok(audio.unlock() === true && log.ctxs.length === 1, 'unlock() (inside the Start press) creates exactly one context');
  audio.unlock();
  ok(log.ctxs.length === 1, 'a second unlock reuses the context');
  const master = audio.masterGain; const sfxBus = audio.sfxBus; const voiceBus = audio.voiceBus;
  const edge = (a, b) => log.edges.some(([x, y]) => x === a && y === b);
  const comp = kindsOf(log, 'comp')[0];
  ok(edge(sfxBus, master) && edge(voiceBus, master) && edge(master, comp) && edge(comp, log.ctxs[0].destination), 'graph: sfxBus and voiceBus -> master -> compressor -> destination');
  ok(comp.threshold.value === -12 && comp.ratio.value === 4, 'the master compressor is -12 dB at 4:1');
  ok(master.gain.value === 0.6, 'master gain defaults to 0.6');
  audio.setMuted(true);
  ok(master.gain.target === 0 && master.gain.ramp.secs <= 0.05, 'mute: master gain goes to 0 (within 50 ms)', JSON.stringify(master.gain.ramp));
  ok(audio.isAudible() === false && sfx.play('catch') === false, 'muted: no cue plays');
  audio.setMuted(false);
  ok(master.gain.target === 0.6, 'unmute: master gain returns to the volume');
  audio.setVolume(0.3);
  ok(master.gain.target === 0.3, 'volume 0.3 sets the master gain');
  audio.setVolume(0.6);
  audio.setSound(false);
  ok(master.gain.target === 0, 'sound off is master gain 0');
  audio.setSound(true);
  audio.setVoiceActive(true);
  ok(sfxBus.gain.target < 0.4 && sfxBus.gain.target > 0 && sfxBus.gain.ramp.secs <= 0.1, 'while a voice line plays the SFX bus ducks under 0.4 within 100 ms', JSON.stringify(sfxBus.gain.ramp));
  audio.setVoiceActive(false);
  ok(sfxBus.gain.target === 1 && sfxBus.gain.ramp.secs >= 0.25 && sfxBus.gain.ramp.secs <= 0.35, 'when the line ends the SFX bus returns to 1 over about 300 ms', JSON.stringify(sfxBus.gain.ramp));
  audio.setVoice(false);
  ok(audio.getState().voice === false && master.gain.target === 0.6, 'voice off keeps the master gain (SFX and captions stay)');
  proveTeeth('the duck check', (v) => (v < 0.4 ? [] : ['not ducked']), 1);
}

/* ---- the cues ------------------------------------------------------------------------------------------------------ */
{
  const REQUIRED = ['click', 'note-save', 'catch', 'bonus-found', 'star', 'level-clear', 'hint-boop', 'not-yet', 'level-start', 'whoosh', 'fanfare', 'combo-up', 'tool-ok', 'deduct'];
  nonEmpty(sfxMod.CUE_IDS, 'sfx cue ids');
  ok(REQUIRED.every((id) => sfxMod.CUE_IDS.includes(id)), 'all 14 cues exist: the 11 of the design, combo-up (restored), tool-ok and deduct (tool scoring)', REQUIRED.filter((id) => !sfxMod.CUE_IDS.includes(id)).join());
  for (const id of sfxMod.CUE_IDS) {
    const { Ctx, log } = makeFake();
    const audio = bus.createAudio({ AudioContext: Ctx }); audio.unlock();
    const sfx = sfxMod.createSfx(audio);
    log.ctxs[0].currentTime = 10;
    const before = log.nodes.length;
    ok(sfx.play(id, { step: 3 }) === true, `${id}: plays after a press`);
    const mine = log.nodes.slice(before);
    const srcs = mine.filter((n) => n.kind === 'osc' || n.kind === 'buf');
    ok(srcs.length > 0 && srcs.every((n) => Number.isFinite(n.startAt) && Number.isFinite(n.stopAt)), `${id}: every source has a start and a stop (nothing loops)`);
    ok(srcs.every((n) => n.loop !== true), `${id}: no source loops`);
    const len = Math.max(...srcs.map((n) => n.stopAt)) - Math.min(...srcs.map((n) => n.startAt));
    ok(len <= 1.7, `${id}: the cue lasts ${len.toFixed(2)} s (<= 1.6 s plus the stop guard)`);
    const info = sfxMod.cueInfo(id, { step: 3 });
    ok(info.length <= 1.6, `${id}: planned length ${info.length.toFixed(2)} s <= 1.6`);
    ok(info.maxRepeatHz <= 3, `${id}: no pitch repeats faster than 3 Hz (${info.maxRepeatHz.toFixed(1)})`);
    ok(info.peakDb <= -12, `${id}: peak ${info.peakDb} dB leaves headroom`);
    const plan = sfxMod.cuePlan(id, { step: 3 });
    ok(plan.every((n) => !(n.f1 && n.f0 && n.f1 < n.f0)), `${id}: no falling glide (no descending buzz)`);
  }
  const deduct = sfxMod.cuePlan('deduct');
  ok(deduct.length === 1 && deduct[0].type === 'sine' && !deduct[0].f1 && deduct[0].peakDb <= -20 && deduct[0].t0 + deduct[0].dur <= 0.2, 'deduct: one short, quiet, flat sine tone (never a buzzer, no fall)', JSON.stringify(deduct));
  const toolOk = sfxMod.cuePlan('tool-ok');
  ok(toolOk.length >= 2 && toolOk[1].f0 > toolOk[0].f0 && toolOk[0].dur + toolOk[0].t0 <= 0.3, 'tool-ok: a short rising pair');
  const dedAndNotYet = ['deduct', 'not-yet'].map((i) => sfxMod.cueInfo(i));
  ok(dedAndNotYet.every((c) => c.length <= 0.2 && c.peakDb <= -20), 'the two quiet cues are <= 0.2 s and <= -20 dB');
  const up = [1, 3, 7].map((s) => sfxMod.cuePlan('combo-up', { step: s })[0].f0);
  ok(up[0] < up[1] && up[1] < up[2], 'combo-up rises with the step');
  ok(sfxMod.cuePlan('combo-up', { step: 40 })[0].f0 <= sfxMod.cuePlan('combo-up', { step: 7 })[0].f0 + 1, 'combo-up is capped at +7 semitones');
  const bf = sfxMod.cuePlan('bonus-found')[0].f0; const ct = sfxMod.cuePlan('catch')[0].f0;
  ok(Math.abs(bf / ct - 2 ** (5 / 12)) < 0.01, 'bonus-found is the catch pitched up a fourth');
  proveTeeth('the cue-length check', (len) => (len > 1.6 ? ['too long'] : []), 2.4);
}

/* ---- voice: one line at a time, silence, the fanfare, the flags ------------------------------------------------------ */
{
  const okAll = structuredClone(rt);
  okAll.lines.forEach((l) => { l.file_status = 'ok'; l.seconds = l.seconds || 5; });
  const build = (manifest = okAll) => {
    const { Ctx, log } = makeFake();
    const audio = bus.createAudio({ AudioContext: Ctx });
    const timers = []; let now = 0;
    const clock = voiceMod.createClock({ setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {}, now: () => now });
    const urls = [];
    const voice = voiceMod.createVoice(audio, { manifest, clock, fetch: async (u) => { urls.push(String(u)); return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) }; } });
    return { Ctx, log, audio, voice, timers, urls, tick: (ms) => { now += ms; }, sfx: sfxMod.createSfx(audio) };
  };
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

  // v11 never starts during the fanfare
  {
    const B = build(); await B.voice.load(); B.audio.unlock();
    B.log.ctxs[0].currentTime = 0;
    ok(B.sfx.play('fanfare') === true, 'fanfare plays');
    const tailMs = B.audio.sfxTailRemainingMs();
    ok(tailMs > 1400 && tailMs <= 1700, `the fanfare tail is reserved (${Math.round(tailMs)} ms)`);
    const r = B.voice.play('v11');
    ok(r.seconds > 0 && !r.missing, 'v11 is playable');
    const t = B.timers.at(-1);
    ok(t && t.ms >= tailMs + 100, 'v11 is scheduled after the fanfare tail plus a pad, not on top of it', `${t && t.ms} vs ${tailMs}`);
    B.log.ctxs[0].currentTime = 2; B.tick(t.ms); t.fn(); await settle();
    const started = kindsOf(B.log, 'buf').filter((n) => n.started && n.buffer && n.buffer.duration === 2); // the voice source; the fanfare's noise tail has its own buffer
    ok(started.length === 1 && started[0].startAt >= 1.6, 'v11 starts only once the fanfare has ended', JSON.stringify(started.map((n) => n.startAt)));
    ok(B.audio.getState().voiceActive === true && B.audio.sfxBus.gain.target <= 0.35, 'while v11 plays the SFX bus is ducked');
  }
  // one line at a time, 120 ms cut, 400-600 ms of silence
  {
    const B = build(); await B.voice.load(); B.audio.unlock();
    B.voice.play('v02'); await settle();
    const first = kindsOf(B.log, 'buf').find((n) => n.started);
    ok(!!first, 'a line starts as soon as nothing else plays');
    B.voice.play('v03'); await settle();
    const second = kindsOf(B.log, 'buf').filter((n) => n.started);
    ok(second.length === 2 && Number.isFinite(first.stopAt), 'a new line cuts the old one (the old source is stopped)');
    ok(first.stopAt - B.log.ctxs[0].currentTime >= 0.1 && first.stopAt - B.log.ctxs[0].currentTime <= 0.2, `the cut is a 120 ms fade (stop at +${(first.stopAt - B.log.ctxs[0].currentTime).toFixed(2)} s)`);
    ok(voiceMod.GAP_MS >= 400 && voiceMod.GAP_MS <= 600, `the silence after a line is ${voiceMod.GAP_MS} ms (400-600)`);
    // let line 3 end, then ask for line 4 at once: it waits for the silence
    const cur = second[1]; B.tick(50); cur.onended && cur.onended();
    B.timers.length = 0;
    B.voice.play('v04');
    ok(B.timers.length > 0 && B.timers.at(-1).ms >= 400 && B.timers.at(-1).ms <= 600, 'the next line waits out the 400-600 ms of silence', String(B.timers.at(-1) && B.timers.at(-1).ms));
  }
  // voice off: caption yes, sound no
  {
    const B = build(); await B.voice.load(); B.audio.unlock(); B.audio.setVoice(false);
    const caps = []; B.voice.onCaption((p) => caps.push(p));
    B.voice.play('v02'); await settle();
    ok(kindsOf(B.log, 'buf').filter((n) => n.started && n.buffer && n.buffer.duration === 2).length === 0 && caps.length === 1 && caps[0].silent === true, 'voice off: no sound, the caption still shows');
  }
  // muted: caption yes
  {
    const B = build(); await B.voice.load(); B.audio.unlock(); B.audio.setMuted(true);
    const caps = []; B.voice.onCaption((p) => caps.push(p));
    B.voice.play('v02'); await settle();
    ok(caps.length === 1 && caps[0].text === okAll.lines[1].text, 'muted: the caption shows the spoken text');
  }
  // voice follows the UI language: Arabic file first, English when the Arabic file is missing, caption-only when neither exists
  {
    const arAll = structuredClone(okAll);
    arAll.lines.forEach((l) => { l.file_status_ar = 'ok'; l.seconds_ar = 3; });
    const B = build(arAll); await B.voice.load(); B.audio.unlock(); B.voice.setLang('ar');
    const r = B.voice.play('v02'); await settle();
    ok(r.seconds === 3 && B.urls.length === 1 && B.urls[0] === '/' + arAll.lines[1].file_ar, 'Arabic UI: the Arabic file (audio/ar/) is requested and its length returned', B.urls.join(','));
    B.voice.setLang('en');
    B.voice.play('v03'); await settle();
    ok(B.urls.at(-1) === '/' + arAll.lines[2].file && /^\/audio\/en\//.test(B.urls.at(-1)), 'English UI: the English file (audio/en/)', B.urls.at(-1));
    const noAr = structuredClone(arAll); noAr.lines[3].file_status_ar = 'missing';
    const C = build(noAr); await C.voice.load(); C.audio.unlock(); C.voice.setLang('ar');
    C.voice.play('v04'); await settle();
    ok(C.urls.length === 0, 'Arabic UI with the Arabic file missing: caption-only, no Arabic and no English request', C.urls.join(','));
    const none = structuredClone(noAr); none.lines[3].file_status = 'missing';
    const D = build(none); await D.voice.load(); D.audio.unlock(); D.voice.setLang('ar');
    const caps = []; D.voice.onCaption((p) => caps.push(p));
    const rd = D.voice.play('v04'); await settle();
    ok(rd.missing === true && D.urls.length === 0 && caps[0].silent === true && caps[0].text === none.lines[3].caption_ar, 'no file in either language: caption-only, no request, Arabic caption');
  }
  // pending files: the page makes no audio request at all
  {
    const B = build(rt); await B.voice.load(); B.audio.unlock();
    for (const l of rt.lines) B.voice.play(l.id);
    await settle();
    ok(B.urls.length === 0 || rt.lines.some((l) => l.file_status === 'ok'), 'while every line is "pending" no voice file is requested');
  }
  // pause: suspend stops the caption clock too
  {
    const B = build(); await B.voice.load(); B.audio.unlock();
    B.voice.play('v02');
    B.audio.suspend();
    ok(B.log.ctxs[0].suspends === 1 && B.audio.getState().held === true, 'suspend() suspends the context');
    B.audio.resume();
    ok(B.log.ctxs[0].resumes >= 1 && B.audio.getState().held === false, 'resume() resumes it');
  }
  // hidden tab suspends, blur does not; M toggles
  {
    const { Ctx, log } = makeFake();
    const audio = bus.createAudio({ AudioContext: Ctx }); audio.unlock();
    const handlers = {};
    const doc = { hidden: false, activeElement: null, addEventListener: (t, f) => { (handlers[t] ||= []).push(f); }, removeEventListener: (t, f) => { handlers[t] = (handlers[t] || []).filter((x) => x !== f); } };
    audio.bindLifecycle(doc); audio.bindKeys(doc);
    ok(Object.keys(handlers).sort().join() === 'keydown,visibilitychange', 'the audio bus listens to visibilitychange and keydown only (never blur)', Object.keys(handlers).join());
    doc.hidden = true; handlers.visibilitychange.forEach((f) => f());
    ok(log.ctxs[0].suspends === 1, 'a hidden tab suspends the audio');
    audio.resume();
    const key = (o) => handlers.keydown.forEach((f) => f({ code: 'KeyM', key: 'm', target: { tagName: 'DIV' }, ...o }));
    key({}); ok(audio.getState().muted === true, 'M mutes');
    key({}); ok(audio.getState().muted === false, 'M unmutes');
    key({ target: { tagName: 'INPUT' } }); key({ target: { tagName: 'TEXTAREA' } }); key({ ctrlKey: true }); key({ altKey: true }); key({ metaKey: true });
    ok(audio.getState().muted === false, 'M is ignored in text fields and with Ctrl, Alt or Meta');
  }
}

/* ---- the page ------------------------------------------------------------------------------------------------------- */
const need = ['index.html', 'game.js', 'server.mjs'].filter((f) => !has(f));
if (need.length) {
  skipNotEnforced({ rule: 'game', what: 'audio and captions in the page', why: `game/${need.join(', game/')} have not landed` });
  finish('test-game-audio', { skipped: 1 });
}
const COUNT_AC = `window.__ac = []; for (const k of ['AudioContext', 'webkitAudioContext']) { const C = window[k]; if (!C) continue; window[k] = function (...a) { const c = new C(...a); window.__ac.push(performance.now()); return c; }; window[k].prototype = C.prototype; }`;
{
  const gameJs = (await import('node:fs')).default.readFileSync(path.join(GAME, 'game.js'), 'utf8');
  ok(/voice\.load\s*\(|load\s*\(\s*\)/.test(gameJs.replace(/\/\*[\s\S]*?\*\//g, '')), 'game.js calls voice.load() (without it voice.js has no lines and never requests a voice file)', 'lane A: await voice.load() once at boot, then voice.onCaption / voice.setLang');
  const code = gameJs.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/sound:\s*true,\s*screen/.test(code), 'game.js: a fresh player starts with sound ON (S.sound defaults true)');
  ok(/S\.sound\s*=\s*fromEngine\.sound\s*!==\s*false/.test(code), 'game.js: the stored sound choice is applied at boot, default ON');
  ok(/savePrefs\(\{\s*sound:\s*on\s*\}\)/.test(code), 'game.js: the player own mute is remembered');
  ok(!/setSound\(true\)/.test(code), 'game.js: Start no longer forces sound on (a stored mute stays muted)');
  ok(/pointerdown', once, true\)/.test(code) && /say\('v01'\)/.test(code), 'game.js: the first press of anything unlocks audio, and Start plays v01 with no toggle');
}
const g = await startGame();
const browser = await launch();
try {
  const o = await openGame(browser, g, { init: COUNT_AC });
  await o.page.waitForTimeout(1200);
  ok((await o.page.evaluate(() => window.__ac.length)) === 0, 'the page creates no AudioContext before the first press (1.2 s after load)');
  await o.page.click('#btnStart');
  await o.page.waitForTimeout(600);
  ok((await o.page.evaluate(() => window.__ac.length)) >= 1, 'Start (a user press) creates the AudioContext');
  const cap = async () => o.page.evaluate(() => ({ text: document.getElementById('captionText').textContent, region: document.getElementById('caption').getAttribute('role') }));
  const c1 = await cap();
  ok(c1.text === rt.lines[0].text, 'English UI: Start shows the v01 caption verbatim', c1.text);
  ok(c1.region === 'status', 'the caption strip is role=status');
  await reach(o.page, 'card', 1);
  // v02 follows v01 (queued behind it, game.js say({follow:true})): wait out v01's length
  await o.page.waitForFunction((t) => document.getElementById('captionText').textContent === t, rt.lines[1].text, { timeout: 12000 }).catch(() => {});
  ok((await cap()).text === rt.lines[1].text, 'English UI: the level 1 card shows the v02 caption (the spoken words)', (await cap()).text);
  await reach(o.page, 'play', 1);

  // blur does not pause, a hidden tab does
  await o.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await o.page.waitForTimeout(300);
  ok(await o.page.evaluate(() => document.getElementById('ov-pause').hidden), 'a window blur does not pause (opening the QA Wrap popup blurs the window)');
  await o.page.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await o.page.waitForTimeout(300);
  ok(await o.page.evaluate(() => !document.getElementById('ov-pause').hidden), 'a hidden tab pauses and shows the Pause overlay');
  await o.page.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); });
  await o.page.click('#btnResume');
  await o.page.waitForSelector('#ov-pause', { state: 'hidden' });
  await o.page.keyboard.press('Escape');
  await o.page.waitForTimeout(250);
  ok(await o.page.evaluate(() => !document.getElementById('ov-pause').hidden), 'Esc pauses');
  await o.page.click('#btnResume');
  // M toggles sound (outside a text field)
  const pressed = () => o.page.evaluate(() => document.getElementById('btnSound').getAttribute('aria-pressed'));
  const p0 = await pressed();
  await o.page.keyboard.press('m');
  const p1 = await pressed();
  ok(p0 !== p1, 'M toggles the sound button', `${p0} -> ${p1}`);
  await o.page.keyboard.press('m');
  ok(errorsClean(o), 'no page error in the audio walk', o.errors.join(' | '));
  await o.close();

  /* Arabic: captions Arabic, the voice file is the Arabic one (here both files 404: the Arabic UI never asks for the English voice, it stays caption-only) */
  const reqs = [];
  const okManifest = structuredClone(rt); okManifest.lines.forEach((l) => { l.file_status = 'ok'; l.file_status_ar = 'ok'; l.seconds = l.seconds || 5; l.seconds_ar = l.seconds_ar || 5; });
  const ar = await openGame(browser, g, {
    lang: 'ar', init: COUNT_AC,
    before: async (ctx) => {
      await ctx.route('**/audio/narration-manifest.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(okManifest) }));
      await ctx.route('**/audio/en/*.{opus,ogg,wav}', (r) => { reqs.push(r.request().url()); r.fulfill({ status: 404, body: 'missing' }); });
      await ctx.route('**/audio/ar/*.{ogg,wav}', (r) => { reqs.push(r.request().url()); r.fulfill({ status: 404, body: 'no' }); });
    },
  });
  await ar.page.click('#btnStart');
  await ar.page.waitForTimeout(700);
  const a1 = await ar.page.evaluate(() => document.getElementById('captionText').textContent);
  ok(a1 === rt.lines[0].caption_ar, 'Arabic UI: Start shows the Arabic v01 caption', a1);
  await reach(ar.page, 'card', 1);
  await ar.page.waitForFunction((t) => document.getElementById('captionText').textContent === t, rt.lines[1].caption_ar, { timeout: 12000 }).catch(() => {});
  const a2 = await ar.page.evaluate(() => ({ t: document.getElementById('captionText').textContent, dir: getComputedStyle(document.getElementById('caption')).direction }));
  ok(a2.t === rt.lines[1].caption_ar && a2.dir === 'rtl', 'Arabic UI: the level 1 card shows the Arabic v02 caption, right to left', JSON.stringify(a2));
  ok(reqs.some((u) => /\/audio\/ar\/v0[12]\.ogg/.test(u)), 'with the Arabic UI the Arabic voice file (/audio/ar/) is requested first', reqs.slice(0, 3).join(' | '));
  ok(!reqs.some((u) => /\/audio\/en\//.test(u)), 'with the Arabic file missing (404) the Arabic UI requests no English voice file (caption-only)', reqs.slice(0, 4).join(' | '));
  /* a missing voice file: caption-only, the game keeps working */
  await reach(ar.page, 'play', 1);
  const a3 = await ar.page.evaluate(() => document.getElementById('captionText').textContent);
  ok(a3.length > 0, 'a voice file that 404s leaves the caption on screen (caption-only)', a3);
  await reach(ar.page, 'finale');
  await ar.page.waitForFunction((t) => document.getElementById('captionText').textContent === t, rt.lines[10].caption_ar, { timeout: 6000 }).catch(() => {});
  const a4 = await ar.page.evaluate(() => document.getElementById('captionText').textContent);
  ok(a4 === rt.lines[10].caption_ar, 'the finale shows the Arabic v11 caption although its file is missing', a4);
  ok(ar.errors.length === 0, 'a missing voice file raises no page error', ar.errors.join(' | '));
  await ar.close();

  /* English with a missing voice file: same */
  const en = await openGame(browser, g, {
    before: async (ctx) => {
      await ctx.route('**/audio/narration-manifest.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(okManifest) }));
      await ctx.route('**/audio/en/*.{opus,ogg,wav}', (r) => r.fulfill({ status: 404, body: 'missing' }));
    },
  });
  await en.page.click('#btnStart');
  await en.page.waitForFunction((t) => document.getElementById('captionText').textContent === t, rt.lines[1].text, { timeout: 12000 }).catch(() => {});
  ok((await en.page.evaluate(() => document.getElementById('captionText').textContent)) === rt.lines[1].text, 'English UI with a missing voice file: the caption is the spoken text');
  await reach(en.page, 'play', 1);
  ok((await en.page.evaluate(() => document.body.dataset.screen)) === 'play', 'English UI with a missing voice file: Go still opens the level');
  ok(en.errors.length === 0, 'no page error with a missing voice file', en.errors.join(' | '));
  await en.close();
} catch (err) {
  ok(false, `run aborted: ${err.message}`, String(err.stack).split('\n').slice(1, 3).join(' | '));
} finally {
  await browser.close();
  await g.close();
}
function errorsClean(o) { return o.errors.length === 0; }
void assert;
finish('test-game-audio');
