/* Bug Hunt voice playback with captions (lane C). Design: DESIGN-bug-hunt.md sections 4, 5 and 6.
 *
 * - The voice follows the UI language (owner decision, Nader 2026-10-12: Kore in English and in Arabic). Arabic UI plays
 *   `file_ar` (audio/ar/) when the manifest marks it ok; if that file is missing or fails to load the line is caption-only
 *   (never an English voice under an Arabic UI; owner, 2026-10-12). English UI plays `file`. Captions follow the same language: EN caption = the spoken text,
 *   AR caption = `caption_ar`, both read from audio/narration-manifest.json so voice and caption cannot drift.
 * - Captions show whenever a line is requested, also when sound is muted, voice is off, the page is not yet unlocked,
 *   or no voice file exists (caption-only). A missing file is a normal state, never an error.
 * - One line at a time. A new line cuts the old one over 120 ms. 500 ms of silence follows every line (scheduled here).
 *   A line never starts while the fanfare tail still plays (v11 starts after the fanfare).
 * - While a line plays the SFX bus is ducked (audio.setVoiceActive). Pause / hidden tab suspend the context and the
 *   caption clock together and resume exactly where they stopped.
 * - Files are local only (same origin). Nothing is stored, nothing leaves the page.
 *
 * Usage (game.js): await voice.load(); voice.onCaption(cb); voice.setLang('ar'); const r = voice.play('v02');
 *   r = { seconds } | { missing:true, seconds }. cb(null) clears the caption.
 */
import { audio as defaultAudio } from './bus.js';

export const FADE_MS = 120;
export const GAP_MS = 500; // inside the 400-600 ms the design asks for
export const CAPTION_PAD_MS = 600;
export const CAPTION_MIN_MS = 1500;
export const FANFARE_PAD_MS = 150;

/** Timers that can be paused and resumed (Pause overlay). Timer functions are injectable for tests. */
export function createClock(env = {}) {
  const st = env.setTimeout || globalThis.setTimeout.bind(globalThis);
  const ct = env.clearTimeout || globalThis.clearTimeout.bind(globalThis);
  const now = env.now || (() => (globalThis.performance ? globalThis.performance.now() : Date.now()));
  let seq = 0;
  let paused = false;
  const tasks = new Map();
  function arm(id, task) {
    task.started = now();
    task.handle = st(() => { tasks.delete(id); task.fn(); }, task.remaining);
  }
  return {
    now,
    after(ms, fn) {
      const id = ++seq;
      const task = { fn, remaining: Math.max(0, ms), started: 0, handle: null };
      tasks.set(id, task);
      if (!paused) arm(id, task);
      return id;
    },
    cancel(id) { const t = tasks.get(id); if (t) { if (t.handle !== null) ct(t.handle); tasks.delete(id); } },
    pause() {
      if (paused) return;
      paused = true;
      for (const t of tasks.values()) {
        if (t.handle !== null) { ct(t.handle); t.handle = null; t.remaining = Math.max(0, t.remaining - (now() - t.started)); }
      }
    },
    resume() {
      if (!paused) return;
      paused = false;
      for (const [id, t] of tasks) arm(id, t);
    },
    get paused() { return paused; },
    get pending() { return tasks.size; },
  };
}

export function createVoice(audio = defaultAudio, opts = {}) {
  const fetchImpl = opts.fetch || ((...a) => globalThis.fetch(...a));
  const clock = opts.clock || createClock(opts.clockEnv);
  const lines = new Map();
  const bytes = new Map(); // 'id:lang' -> Promise<ArrayBuffer|null>
  const decoded = new Map(); // 'id:lang' -> Promise<AudioBuffer|null>
  const failed = new Set(); // 'id:lang' whose file could not be fetched or decoded
  const captionSubs = new Set();
  let lang = opts.lang === 'ar' ? 'ar' : 'en';
  let loaded = false;
  let loadPromise = null;
  let seq = 0; // newest play() wins
  let current = null; // { src, gain, id }
  let captionNow = null; // { id, line }
  let captionTimer = 0;
  let startTimer = 0;
  let gapUntil = 0;

  const urlOf = (file) => (/^file:/.test(import.meta.url) ? '/' : new URL('../', import.meta.url).href) + String(file || '').replace(/^\/+/, ''); // game root: from this file (extension page or game server); node tests (file:) keep '/'
  /** Playable voice files for a line: the UI language only (ar UI never falls back to the English voice). [] = caption-only. */
  function variants(line) {
    const out = [];
    if (lang === 'ar') { if (line.file_ar && line.file_status_ar === 'ok' && !failed.has(`${line.id}:ar`)) out.push('ar'); }
    else if (line.file && line.file_status === 'ok' && !failed.has(`${line.id}:en`)) out.push('en');
    return out;
  }
  const fileOf = (line, v) => (v === 'ar' ? line.file_ar : line.file);
  const secondsOf = (line, v) => Number(v === 'ar' ? line.seconds_ar : line.seconds) || Number(line.seconds) || 0;
  const lineSeconds = (line) => { const v = variants(line)[0]; return v ? secondsOf(line, v) : (Number(line.seconds) || 0); };
  const captionMs = (line) => Math.max(CAPTION_MIN_MS, Math.round(lineSeconds(line) * 1000) + CAPTION_PAD_MS);

  function captionFor(id, l = lang) {
    const line = lines.get(id);
    if (!line) return '';
    if (l === 'ar') return line.caption_ar || line.text || '';
    return line.text || '';
  }
  function payload(line, extra = {}) {
    return { id: line.id, lang, dir: lang === 'ar' ? 'rtl' : 'ltr', text: captionFor(line.id, lang), ms: captionMs(line), ...extra };
  }
  function emit(p) { for (const fn of [...captionSubs]) { try { fn(p); } catch { /* a subscriber never breaks playback */ } } }

  function applyManifest(m) {
    lines.clear();
    for (const l of (m && Array.isArray(m.lines)) ? m.lines : []) if (l && typeof l.id === 'string') lines.set(l.id, l);
    loaded = true;
    return lines.size > 0;
  }
  function load() {
    if (loadPromise) return loadPromise;
    if (opts.manifest) { loadPromise = Promise.resolve(applyManifest(opts.manifest)); return loadPromise; }
    loadPromise = (async () => {
      try {
        const res = await fetchImpl(opts.manifestUrl || urlOf('audio/narration-manifest.json'));
        if (!res || !res.ok) return applyManifest(null);
        return applyManifest(await res.json());
      } catch { return applyManifest(null); }
    })();
    return loadPromise;
  }

  function getBytes(line, v) {
    const k = `${line.id}:${v}`;
    if (!bytes.has(k)) {
      bytes.set(k, (async () => {
        try {
          const res = await fetchImpl(urlOf(fileOf(line, v)));
          if (!res || !res.ok) { failed.add(k); return null; }
          return await res.arrayBuffer();
        } catch { failed.add(k); return null; }
      })());
    }
    return bytes.get(k);
  }
  function getBuffer(line, v) {
    const k = `${line.id}:${v}`;
    if (!decoded.has(k)) {
      decoded.set(k, (async () => {
        const ab = await getBytes(line, v);
        const ctx = audio.context;
        if (!ab || !ctx) return null;
        try { return await ctx.decodeAudioData(ab.slice(0)); } catch { failed.add(k); return null; }
      })());
    }
    return decoded.get(k);
  }
  /** The first usable decoded buffer for the line in the current language order (the UI language only). */
  async function bestBuffer(line) {
    for (const v of variants(line)) {
      const buf = await getBuffer(line, v);
      if (buf) return { buf, v };
    }
    return null;
  }
  /** Fetch the files early (optional; call after unlock, e.g. when a level card opens). Resolves to the count ready. */
  async function preload(ids = [...lines.keys()]) {
    let n = 0;
    for (const id of ids) {
      const line = lines.get(id);
      if (line && variants(line).length && (await bestBuffer(line))) n++;
    }
    return n;
  }

  function fadeOut(cur, ms) {
    const ctx = audio.context;
    try {
      const t = ctx.currentTime;
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
      cur.gain.gain.linearRampToValueAtTime(0, t + ms / 1000);
      cur.src.stop(t + ms / 1000 + 0.02);
    } catch { try { cur.src.stop(); } catch { /* already stopped */ } }
  }
  function cutCurrent(ms = FADE_MS) {
    if (!current) return;
    const cur = current;
    current = null;
    fadeOut(cur, ms);
  }

  async function startAudio(line, token) {
    const best = await bestBuffer(line);
    if (token !== seq || !best) return;
    const buf = best.buf;
    if (!audio.isAudible() || !audio.getState().voice) return;
    const ctx = audio.context;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.value = 1;
    src.connect(gain);
    gain.connect(audio.voiceBus);
    const cur = { src, gain, id: line.id };
    src.onended = () => {
      if (current === cur) { current = null; audio.setVoiceActive(false); gapUntil = clock.now() + GAP_MS; }
    };
    cutCurrent();
    current = cur;
    audio.setVoiceActive(true);
    src.start();
  }

  function begin(line, token) {
    if (token !== seq) return;
    startTimer = 0;
    const canSound = variants(line).length > 0 && audio.isAudible() && audio.getState().voice;
    captionNow = { id: line.id, line };
    emit(payload(line, { silent: !canSound, missing: variants(line).length === 0 }));
    if (captionTimer) clock.cancel(captionTimer);
    captionTimer = clock.after(captionMs(line), () => { captionTimer = 0; captionNow = null; emit(null); });
    if (canSound) startAudio(line, token);
  }

  function play(id) {
    const line = lines.get(id);
    if (!line) return { missing: true, seconds: 0 };
    const token = ++seq;
    if (startTimer) { clock.cancel(startTimer); startTimer = 0; }
    const audible = audio.isAudible() && audio.getState().voice && variants(line).length > 0;
    let delay = 0;
    if (audible) {
      delay = Math.max(0, gapUntil - clock.now());
      delay = Math.max(delay, audio.sfxTailRemainingMs() > 0 ? audio.sfxTailRemainingMs() + FANFARE_PAD_MS : 0);
    }
    // a new line cuts the old one over 120 ms (the old caption is replaced when the new one shows)
    if (current && audible) cutCurrent();
    else if (current) { cutCurrent(); audio.setVoiceActive(false); }
    if (delay > 0) startTimer = clock.after(delay, () => begin(line, token));
    else begin(line, token);
    const seconds = lineSeconds(line);
    return variants(line).length > 0 ? { seconds } : { missing: true, seconds };
  }

  function stop() {
    seq++;
    if (startTimer) { clock.cancel(startTimer); startTimer = 0; }
    if (captionTimer) { clock.cancel(captionTimer); captionTimer = 0; }
    if (current) { cutCurrent(); audio.setVoiceActive(false); }
    if (captionNow) { captionNow = null; emit(null); }
  }

  function setLang(l) {
    const next = l === 'ar' ? 'ar' : 'en';
    if (next === lang) return;
    lang = next;
    if (captionNow) emit(payload(captionNow.line, { silent: !current, missing: variants(captionNow.line).length === 0 }));
  }

  // Pause / hidden tab: the caption clock stops with the audio context. Voice toggled off: the audio stops, the caption stays.
  audio.addHooks({
    suspend() { clock.pause(); },
    resume() { clock.resume(); },
    mute() { /* the master gain is 0; the caption continues */ },
    voice(on) { if (!on && current) { cutCurrent(); audio.setVoiceActive(false); } },
  });

  return {
    load,
    preload,
    play,
    stop,
    setLang,
    getLang: () => lang,
    captionFor,
    onCaption(fn) { captionSubs.add(fn); return () => captionSubs.delete(fn); },
    ids: () => [...lines.keys()],
    secondsFor: (id) => (lines.has(id) ? lineSeconds(lines.get(id)) : 0),
    hasFile: (id) => !!lines.get(id) && variants(lines.get(id)).length > 0,
    /** Which voice file would play now: 'ar', 'en' or null (caption-only). */
    voiceFor: (id) => (lines.has(id) ? variants(lines.get(id))[0] || null : null),
    get loaded() { return loaded; },
    /** For tests and the guardrails: what is playing and what the caption shows. */
    status: () => ({ playing: current ? current.id : null, caption: captionNow ? captionNow.id : null, seq }),
  };
}

export const voice = createVoice(defaultAudio);
