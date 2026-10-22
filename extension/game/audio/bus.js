/* Bug Hunt audio bus (lane C). Design: work/sdlc/design/DESIGN-bug-hunt.md section 4 and 13.
 *
 * One AudioContext per page, created ONLY inside a user press (unlock). Until then nothing sounds and no
 * context object exists. Graph:
 *   sfxBus --\
 *             +--> master (mute / volume) --> compressor (-12 dB, 4:1) --> destination
 *   voiceBus -/
 * While a voice line plays the SFX bus ducks to 35 % over 80 ms and returns over 300 ms.
 * Mute is the master gain at 0 (30 ms ramp). Sound = master; Voice = separate toggle; Volume 0..1 (default 0.6).
 * Preferences are NOT stored here: game.js owns storage and calls configure(); onChange() reports edits.
 * No timers, no network, no storage, no layout. All timing uses AudioContext.currentTime.
 */

export const DEFAULT_VOLUME = 0.6;
export const DUCK_LEVEL = 0.35;
export const DUCK_IN_S = 0.08;
export const DUCK_OUT_S = 0.3;
export const MUTE_RAMP_S = 0.03;

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME);

function ramp(ctx, param, target, secs) {
  if (!param) return;
  try {
    const t = ctx.currentTime;
    if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(t);
    if (typeof param.setValueAtTime === 'function') param.setValueAtTime(param.value, t);
    if (typeof param.linearRampToValueAtTime === 'function') param.linearRampToValueAtTime(target, t + secs);
    else param.value = target;
  } catch { param.value = target; }
}

const typing = (el) => !!el && (/^(input|textarea|select)$/i.test(el.tagName || '') || el.isContentEditable === true);

/** Factory so tests can inject a fake AudioContext constructor. The default instance is `audio` below. */
export function createAudio(opts = {}) {
  let ctx = null;
  let master = null;
  let comp = null;
  let sfxBus = null;
  let voiceBus = null;
  let sfxTailEnd = 0; // AudioContext time when the last fanfare has finished
  const st = {
    unlocked: false,
    muted: false,
    voice: true,
    volume: DEFAULT_VOLUME,
    voiceActive: false,
    held: false, // suspended by Pause or a hidden tab
    masterTarget: DEFAULT_VOLUME,
    sfxTarget: 1,
  };
  const listeners = new Set();
  const hooks = new Set();

  const masterGoal = () => (st.muted ? 0 : st.volume);
  const getState = () => ({
    unlocked: st.unlocked,
    muted: st.muted,
    sound: !st.muted,
    voice: st.voice,
    volume: st.volume,
    voiceActive: st.voiceActive,
    held: st.held,
    ctxState: ctx ? ctx.state : 'none',
    masterTarget: st.masterTarget,
    sfxTarget: st.sfxTarget,
  });
  const emit = () => { const s = getState(); for (const fn of [...listeners]) { try { fn(s); } catch { /* a listener never breaks audio */ } } };
  const callHooks = (name, ...a) => { for (const h of [...hooks]) { try { h[name] && h[name](...a); } catch { /* ignore */ } } };

  function build() {
    const C = opts.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!C) return false;
    ctx = new C();
    master = ctx.createGain();
    comp = ctx.createDynamicsCompressor();
    sfxBus = ctx.createGain();
    voiceBus = ctx.createGain();
    if (comp.threshold) comp.threshold.value = -12;
    if (comp.ratio) comp.ratio.value = 4;
    master.gain.value = masterGoal();
    sfxBus.gain.value = st.sfxTarget;
    voiceBus.gain.value = 1;
    sfxBus.connect(master);
    voiceBus.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);
    return true;
  }

  const api = {
    /** Call inside a press handler (Start, or the first pointerdown/keydown). Idempotent; re-resumes a suspended context. */
    unlock() {
      if (!ctx && !build()) return false;
      st.unlocked = true;
      if (!st.held && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
      }
      emit();
      return true;
    },
    /** First press of anything unlocks audio once (so a context never exists before a press). Returns disarm(). */
    armUnlock(doc = globalThis.document) {
      if (!doc || !doc.addEventListener) return () => {};
      const go = () => { disarm(); api.unlock(); };
      const disarm = () => { doc.removeEventListener('pointerdown', go, true); doc.removeEventListener('keydown', go, true); };
      doc.addEventListener('pointerdown', go, true);
      doc.addEventListener('keydown', go, true);
      return disarm;
    },
    /** M mutes / unmutes (never inside a text field, never with Ctrl/Alt/Meta). Returns unbind(). */
    bindKeys(doc = globalThis.document) {
      if (!doc || !doc.addEventListener) return () => {};
      const onKey = (e) => {
        if (e.defaultPrevented || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        if (!(e.code === 'KeyM' || e.key === 'm' || e.key === 'M')) return;
        if (typing(e.target) || typing(doc.activeElement)) return;
        if (!st.unlocked) api.unlock();
        api.setMuted(!st.muted);
      };
      doc.addEventListener('keydown', onKey);
      return () => doc.removeEventListener('keydown', onKey);
    },
    /** A hidden tab suspends audio (NOT window blur). Resuming is the Pause overlay's job (a press). Returns unbind(). */
    bindLifecycle(doc = globalThis.document) {
      if (!doc || !doc.addEventListener) return () => {};
      const onVis = () => { if (doc.hidden) api.suspend(); };
      doc.addEventListener('visibilitychange', onVis);
      return () => doc.removeEventListener('visibilitychange', onVis);
    },
    /** Apply stored preferences in one step (any subset): { muted | sound, voice, volume }. */
    configure(p = {}) {
      if (typeof p.muted === 'boolean') st.muted = p.muted;
      if (typeof p.sound === 'boolean') st.muted = !p.sound;
      if (typeof p.voice === 'boolean') st.voice = p.voice;
      if (p.volume !== undefined) st.volume = clamp01(p.volume);
      st.masterTarget = masterGoal();
      if (ctx) ramp(ctx, master.gain, st.masterTarget, MUTE_RAMP_S);
      emit();
    },
    setMuted(b) {
      st.muted = !!b;
      st.masterTarget = masterGoal();
      if (ctx) ramp(ctx, master.gain, st.masterTarget, MUTE_RAMP_S);
      callHooks('mute', st.muted);
      emit();
    },
    toggleMuted() { api.setMuted(!st.muted); return st.muted; },
    setSound(on) { api.setMuted(!on); },
    setVolume(v) {
      st.volume = clamp01(v);
      st.masterTarget = masterGoal();
      if (ctx) ramp(ctx, master.gain, st.masterTarget, MUTE_RAMP_S);
      emit();
    },
    setVoice(b) { st.voice = !!b; callHooks('voice', st.voice); emit(); },
    /** Called by voice.js while a line plays: SFX bus to 35 % over 80 ms, back over 300 ms. */
    setVoiceActive(b) {
      st.voiceActive = !!b;
      st.sfxTarget = b ? DUCK_LEVEL : 1;
      if (ctx) ramp(ctx, sfxBus.gain, st.sfxTarget, b ? DUCK_IN_S : DUCK_OUT_S);
    },
    /** Pause / hidden tab. The context stops its clock, so a voice line resumes exactly where it stopped. */
    suspend() {
      st.held = true;
      if (ctx && typeof ctx.suspend === 'function') { try { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
      callHooks('suspend');
      emit();
    },
    resume() {
      st.held = false;
      if (ctx && st.unlocked && typeof ctx.resume === 'function') { try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
      callHooks('resume');
      emit();
    },
    /** Something audible may play: a press has happened and sound is not muted. */
    isAudible() { return st.unlocked && !st.muted && !!ctx; },
    /** The fanfare reserves the mix until its tail ends; voice.js waits for it (v11 never overlaps it). */
    noteSfxTail(untilCtxTime) { sfxTailEnd = Math.max(sfxTailEnd, untilCtxTime); },
    sfxTailRemainingMs() { return ctx ? Math.max(0, (sfxTailEnd - ctx.currentTime) * 1000) : 0; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** voice.js registers { suspend, resume, mute, voice } callbacks here. */
    addHooks(h) { hooks.add(h); return () => hooks.delete(h); },
    getState,
    get context() { return ctx; },
    get sfxBus() { return sfxBus; },
    get voiceBus() { return voiceBus; },
    get masterGain() { return master; },
  };
  return api;
}

export const audio = createAudio();
