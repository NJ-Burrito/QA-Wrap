/* Bug Hunt SFX engine (lane C): every cue is synthesised with WebAudio at play time. Zero asset bytes, no files, no network.
 * Design: DESIGN-bug-hunt.md section 4 (table from work/council-game/seat-3-audio.md section 4) plus the owner changes of
 * 2026-10-12: combo-up is back (catch pitched up one semitone per step, capped at +7), and two cues for tool use:
 * `tool-ok` (bright, a correct tool use) and `deduct` (soft and low, a deduction; never a buzzer).
 * Rules kept: no cue longer than 1.6 s; nothing loops; no tick or countdown; no descending buzz; no same-pitch repeat
 * faster than 3 Hz; reward or neutral tones only. The player's mute, volume and the voice ducking all apply because the
 * cues go through audio.sfxBus -> master -> compressor (bus.js).
 */
import { audio as defaultAudio } from './bus.js';

export const MAX_CUE_S = 1.6;
const db = (x) => 10 ** (x / 20);
const semi = (n) => 2 ** (n / 12);
const FLOOR = 0.0001;

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;

/* A cue is a plan: an array of nodes. t0 and dur are seconds from the start of the cue; peakDb is the node's own peak (dBFS).
 *   osc  : { kind:'osc', type, f0, f1?, t0, dur, attack, peakDb, lp? }       (f1 = exponential glide target)
 *   noise: { kind:'noise', t0, dur, attack, peakDb, bp?:{f0,f1,q}, lp? }
 */
const osc = (type, f0, t0, dur, peakDb, extra = {}) => ({ kind: 'osc', type, f0, t0, dur, attack: 0.005, peakDb, ...extra });

function catchPlan(shift = 0, peakDb = -12) {
  const k = semi(shift);
  return [
    osc('sine', C5 * k, 0, 0.22, peakDb - 3),
    osc('sine', 783.99 * k, 0, 0.22, peakDb - 3),
  ];
}

const PLANS = {
  click: () => [osc('triangle', 1200, 0, 0.045, -18)],
  'note-save': () => [osc('sine', 660, 0, 0.12, -16, { f1: 880, attack: 0.01 })],
  catch: () => catchPlan(0),
  'combo-up': (o = {}) => catchPlan(Math.min(7, Math.max(1, Math.round(Number(o.step) || 1)))),
  'bonus-found': () => catchPlan(5), // a catch pitched up a fourth
  star: () => [
    osc('sine', 880, 0, 0.28, -17, { attack: 0.004 }),
    osc('sine', 1175, 0.06, 0.28, -17, { attack: 0.004 }),
    osc('sine', 1568, 0.12, 0.28, -17, { attack: 0.004 }),
  ],
  'level-clear': () => [
    osc('sine', C5, 0, 0.2, -15),
    osc('sine', E5, 0.09, 0.2, -15),
    osc('sine', G5, 0.18, 0.47, -15, { attack: 0.01 }), // last note held to 650 ms
  ],
  'hint-boop': () => [
    // two soft pulses 120 ms apart, the second a little higher so it is a rising pair, never a same-tone repeat (3 Hz rule)
    osc('sine', 440, 0, 0.14, -20, { attack: 0.02 }),
    osc('sine', 523.25, 0.12, 0.18, -20, { attack: 0.02 }),
  ],
  'not-yet': () => [osc('sine', 300, 0, 0.06, -22, { attack: 0.008 })],
  'level-start': () => [osc('sine', 440, 0, 0.13, -16), osc('sine', 587.33, 0.12, 0.13, -16)],
  whoosh: () => [{ kind: 'noise', t0: 0, dur: 0.18, attack: 0.04, peakDb: -20, bp: { f0: 400, f1: 2400, q: 1.2 } }],
  fanfare: () => {
    const n = [];
    [C5, E5, G5, 1046.5].forEach((f, i) => n.push(osc('triangle', f, i * 0.12, 0.34, -14, { lp: 3000 })));
    // held chord, saw / square blend through a 3 kHz lowpass; starts 0.6 s in so no pitch repeats faster than 3 Hz
    [C5, E5, G5].forEach((f) => {
      n.push(osc('sawtooth', f, 0.6, 0.95, -22, { lp: 3000, attack: 0.03 }));
      n.push(osc('square', f, 0.6, 0.95, -26, { lp: 3000, attack: 0.03 }));
    });
    // short generated-noise reverb tail
    n.push({ kind: 'noise', t0: 0.45, dur: 1.15, attack: 0.05, peakDb: -34, lp: 3000 });
    return n;
  },
  // Owner amendment 2026-10-12 (points for tools): bright for a correct tool use, soft and low for a deduction.
  'tool-ok': () => [osc('sine', 1046.5, 0, 0.14, -15, { attack: 0.004 }), osc('sine', 1568, 0.07, 0.17, -15, { attack: 0.004 })],
  deduct: () => [osc('sine', 196, 0, 0.12, -25, { attack: 0.02 })], // one quiet low tone, flat pitch, no buzz, no fall
  // Hard trials (DESIGN-bug-hunt-hard section 9): a tell is a soft single tone, a fall is one flat 0.3 s tone, the clear is a held rising chord.
  'tell-tick': () => [osc('sine', 880, 0, 0.09, -26, { attack: 0.012 })],
  fall: () => [osc('sine', 220, 0, 0.3, -22, { attack: 0.03 })],
  'trial-clear': () => [
    osc('sine', C5, 0, 0.3, -16, { attack: 0.01 }),
    osc('sine', E5, 0.18, 0.3, -16, { attack: 0.01 }),
    osc('sine', G5, 0.36, 0.3, -16, { attack: 0.01 }),
    osc('sine', 1046.5, 0.54, 0.7, -15, { attack: 0.02 }), // held to 1.24 s
  ],
};

export const CUE_IDS = Object.keys(PLANS);

export function cuePlan(id, opts) {
  const f = PLANS[id];
  return f ? f(opts) : null;
}

/** Static facts about a cue, used by tests and by the guardrails: length, onsets, the fastest same-pitch repeat. */
export function cueInfo(id, opts) {
  const plan = cuePlan(id, opts);
  if (!plan) return null;
  const length = Math.max(...plan.map((n) => n.t0 + n.dur));
  const byPitch = new Map();
  for (const n of plan) {
    if (n.kind !== 'osc') continue;
    const key = Math.round(n.f0);
    if (!byPitch.has(key)) byPitch.set(key, new Set());
    byPitch.get(key).add(Math.round(n.t0 * 1000) / 1000);
  }
  let minGap = Infinity;
  for (const set of byPitch.values()) {
    const t = [...set].sort((a, b) => a - b);
    for (let i = 1; i < t.length; i++) minGap = Math.min(minGap, t[i] - t[i - 1]);
  }
  return {
    id,
    length,
    nodes: plan.length,
    peakDb: Math.max(...plan.map((n) => n.peakDb)),
    maxRepeatHz: Number.isFinite(minGap) ? 1 / minGap : 0,
  };
}

/* Deterministic noise (seeded generator: the same cue always sounds the same). */
function makeNoise(ctx) {
  const len = Math.ceil(ctx.sampleRate * (MAX_CUE_S + 0.2));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 22695477;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return buf;
}

function envelope(g, t, n) {
  const peak = db(n.peakDb);
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.min(n.attack, n.dur * 0.5));
  g.gain.exponentialRampToValueAtTime(FLOOR, t + n.dur);
}

/** Schedule a plan on `ctx` into `dest`, starting at `t0`. Exported so a fake context can exercise it. */
export function schedule(ctx, dest, plan, t0, noiseBuf) {
  for (const n of plan) {
    const t = t0 + n.t0;
    const g = ctx.createGain();
    envelope(g, t, n);
    let tail = g;
    let src;
    if (n.kind === 'osc') {
      src = ctx.createOscillator();
      src.type = n.type;
      src.frequency.setValueAtTime(n.f0, t);
      if (n.f1) src.frequency.exponentialRampToValueAtTime(n.f1, t + n.dur);
      let head = src;
      if (n.lp) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = n.lp;
        head.connect(f);
        head = f;
      }
      head.connect(g);
    } else {
      src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      let head = src;
      if (n.bp) {
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = n.bp.q;
        f.frequency.setValueAtTime(n.bp.f0, t);
        f.frequency.exponentialRampToValueAtTime(n.bp.f1, t + n.dur);
        head.connect(f);
        head = f;
      }
      if (n.lp) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = n.lp;
        head.connect(f);
        head = f;
      }
      head.connect(g);
    }
    tail.connect(dest);
    src.start(t);
    src.stop(t + n.dur + 0.03);
  }
}

export function createSfx(audio = defaultAudio) {
  let noise = null;
  let noiseCtx = null;
  return {
    ids: CUE_IDS,
    info: cueInfo,
    /** Play a cue. Silent (returns false) before the first press, while muted, or for an unknown id. */
    play(id, opts) {
      const plan = cuePlan(id, opts);
      if (!plan || !audio.isAudible()) return false;
      const ctx = audio.context;
      const dest = audio.sfxBus;
      if (!ctx || !dest) return false;
      if (plan.some((n) => n.kind === 'noise') && (!noise || noiseCtx !== ctx)) { noise = makeNoise(ctx); noiseCtx = ctx; }
      const t0 = ctx.currentTime + 0.005;
      schedule(ctx, dest, plan, t0, noise);
      if (id === 'fanfare') audio.noteSfxTail(t0 + cueInfo(id).length);
      return true;
    },
  };
}

export const sfx = createSfx(defaultAudio);
