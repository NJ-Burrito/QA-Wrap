/* QA Wrap Bug Hunt - engine (lane B): state machine, scoring, stars, best times, stickers, hint clock, pause, paste gate.
 * Design: work/sdlc/design/DESIGN-bug-hunt.md s1, s2.5, s2.6, s10, s11, s13 + the owner amends of 2026-10-12
 * (quiet multiplier x2..x5, qaw signals, per-tool scoring in scoring.js).
 *
 * No DOM at import time, no randomness, no Date, no network. Everything the outside world provides is injected
 * (storage, clock, doc/win, fetch, t, signals), so the whole machine runs headless in node.
 *
 * Status: title | card | play | clear | finale. Pause is an overlay flag, never a status.
 * Events (engine.on(type, fn); '*' gets (type, payload)):
 *   state {status,n}   level:card {n}   level:play {n}   level:catch {n,score,gained,mult,reason}
 *   level:chain {n,chain,mult,up,reset,quiet}   level:prove {n,kind,tool,points,score}   level:bonus {n,gained,score}
 *   level:hint {n,kind:'ping'|'open',key}   level:nudge {n,key}   level:clear {n,stars,ms,bestMs,newBest,score,levelScore,...}
 *   level:noise {n} (a harmless failure just happened: expected)   level:chip {n,id,tool,points,mult,score} (optional feature chip)
 *   score:tool {tool,kind,outcome,points,delta,mult,reasonKey,quiet,n,score}   finale {...}   finale:pasted {heading,lines,bug}
 *   finale:notyet {}   pause {paused,reason}   prefs {prefs}   progress:reset {}   level:skip {n}
 */
import { NUM, PAR_S, PROVE_TOOL, STICKER_FOR, TOOLS, ruleFor } from './scoring.js';
import FEATURES from './features.json' with { type: 'json' };

export const STATUS = ({ TITLE: 'title', CARD: 'card', PLAY: 'play', CLEAR: 'clear', FINALE: 'finale' });
export const STORAGE_KEY = 'bughunt.v1';
export const LEVELS = 5;

/** Scoreboard label for a tool: the QA Wrap feature's own name and icon (EN or AR); `page` has no feature (use the key score.tool.page). */
export function toolLabel(tool, lang = 'en') {
  const f = FEATURES.features[tool];
  return f ? { tool, icon: f.icon, name: f[lang === 'ar' ? 'ar' : 'en'] } : { tool, icon: null, name: null, key: `score.tool.${tool}` };
}

/** The QA Wrap feature a level teaches, ready for the level card and the clear card (names and icons are the extension's own). */
export function featureFor(k, lang = 'en') {
  const L = FEATURES.levels[String(k)];
  if (!L) return null;
  const L2 = lang === 'ar' ? 'ar' : 'en';
  const one = (id) => ({ id, icon: FEATURES.features[id].icon, name: FEATURES.features[id][L2], keys: FEATURES.features[id].keys || null });
  const primary = one(L.primary);
  const withs = L.with.map(one);
  const extras = L.extras.map((id) => ({ ...one(id), chip: FEATURES.chips[id][L2] }));
  return { n: k, primary, with: withs, extras, names: [primary, ...withs].map((f) => f.name).join(' -> '), learn: L.learn[L2], learnChip: (FEATURES.chips[PROVE_TOOL[k]] || {})[L2] || null };
}
const STICKER_TYPES = (['console', 'failed-request', 'dead-button', 'layout', 'slow-call']);
export const QAW_STATES = (['asleep', 'ready', 'recording', 'stopped']);
const POLL_MS = 500;
const DEFAULT_PREFS = ({ lang: 'en', theme: 'auto', sound: true, voice: true, volume: 60, calm: false });

/* ---------------------------------------------------------------- signals (read-only page attributes set by the extension) */
const asCount = (v) => { if (v === undefined || v === null || v === '') return null; const x = Number(v); return Number.isInteger(x) && x >= 0 ? x : null; };

export function readQawState(doc) {
  const v = doc && doc.documentElement && doc.documentElement.dataset ? doc.documentElement.dataset.qawState : undefined;
  return QAW_STATES.includes(v) ? v : null;
}
/** Count-only signals the extension writes next to qawState (numbers, never content). */
export const COUNT_KEYS = ['notes', 'shots', 'shortcut', 'expected', 'noteTypes', 'marks', 'buffer'];
/** { notes, shots, shortcut, expected, noteTypes, marks, buffer } (each an integer or null) or null when the extension shares none of them. */
export function readQawCounts(doc) {
  const ds = doc && doc.documentElement && doc.documentElement.dataset ? doc.documentElement.dataset : null;
  if (!ds) return null;
  const out = {};
  let any = false;
  for (const k of COUNT_KEYS) { out[k] = asCount(ds[`qaw${k[0].toUpperCase()}${k.slice(1)}`]); if (out[k] !== null) any = true; }
  return any ? out : null;
}
const cnt = (c, k) => (c && Number.isInteger(c[k]) && c[k] >= 0 ? c[k] : null);

/* ---------------------------------------------------------------- the paste gate (finale) */
const ARABIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
/**
 * Pure. Is this text a QA Wrap report? first non-empty line `# <title>`, >= 3 non-empty lines, and a `Steps` line or a `## ` heading
 * (buildMarkdown always writes `## <Steps to reproduce>` in either language; pinned by test-game-levels against the real output).
 * Returns { ok, heading, lines, bug }: heading = the first line cut to 60 chars, lines = line count, bug = the report lists >= 1 problem.
 * The text is not returned and not kept.
 */
export function inspectReport(text) {
  const s = String(text == null ? '' : text).slice(0, 200000).replace(/^﻿/, '');
  const all = s.split(/\r?\n/);
  while (all.length && all[all.length - 1].trim() === '') all.pop();
  const nonEmpty = all.filter((l) => l.trim() !== '');
  const first = nonEmpty[0] || '';
  const ok = /^# \S/.test(first) && nonEmpty.length >= 3 && nonEmpty.some((l) => /^(Steps|## )/.test(l));
  if (!ok) return { ok: false, heading: '', lines: 0, bug: false };
  const max = NUM.PASTE_HEADING_MAX;
  const heading = first.length > max ? `${first.slice(0, max - 1)}…` : first;
  // "no bug in it": the Problems row of the summary table says 0. A report without that row is not judged.
  let bug = true;
  for (const l of nonEmpty) {
    const m = /^\|\s*(Problems|المشكلات)\s*\|\s*([^|]+?)\s*\|/.exec(l);
    if (m) { const v = Number(m[2].replace(/[٠-٩]/g, (c) => ARABIC_DIGITS[c])); if (Number.isFinite(v)) bug = v > 0; break; }
  }
  return { ok: true, heading, lines: all.length, bug };
}

/* ---------------------------------------------------------------- storage */
const freshSave = () => ({
  prefs: { ...DEFAULT_PREFS },
  best: { run: null, l1: null, l2: null, l3: null, l4: null, l5: null },
  stars: { l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 },
  stickers: { console: false, 'failed-request': false, 'dead-button': false, layout: false, 'slow-call': false },
  bonus: { l1: false, l2: false, l3: false, l4: false, l5: false },
});
const isMs = (v) => Number.isFinite(v) && v > 0 && v < 86400000;

function sanitize(raw) {
  const out = freshSave();
  if (!raw || typeof raw !== 'object') return out;
  const p = raw.prefs || {};
  if (p.lang === 'en' || p.lang === 'ar') out.prefs.lang = p.lang;
  if (['auto', 'light', 'dark'].includes(p.theme)) out.prefs.theme = p.theme;
  for (const k of ['sound', 'voice', 'calm']) if (typeof p[k] === 'boolean') out.prefs[k] = p[k];
  if (Number.isFinite(p.volume)) out.prefs.volume = Math.min(100, Math.max(0, Math.round(p.volume)));
  for (const k of Object.keys(out.best)) if (isMs(raw.best && raw.best[k])) out.best[k] = Math.round(raw.best[k]);
  for (const k of Object.keys(out.stars)) { const v = raw.stars && raw.stars[k]; if (Number.isInteger(v) && v >= 0 && v <= 3) out.stars[k] = v; }
  for (const k of Object.keys(out.stickers)) out.stickers[k] = !!(raw.stickers && raw.stickers[k] === true);
  for (const k of Object.keys(out.bonus)) out.bonus[k] = !!(raw.bonus && raw.bonus[k] === true);
  return out;
}

function makeStore(storage) {
  let data = freshSave();
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (raw) data = sanitize(JSON.parse(raw));
  } catch { data = freshSave(); }
  const save = () => { try { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* private mode or full: play on */ } };
  return {
    get data() { return data; },
    save,
    resetProgress() { const prefs = data.prefs; data = freshSave(); data.prefs = prefs; save(); },
  };
}

/* ---------------------------------------------------------------- a timer that stops and resumes with the pause overlay */
class PTimer {
  constructor(clock) { this.clock = clock; this.h = null; this.rem = null; this.t0 = 0; this.fn = null; this.paused = false; }
  start(ms, fn) { this.cancel(); this.fn = fn; this.rem = ms; this.paused = false; this._arm(); }
  _arm() {
    this.t0 = this.clock.now();
    this.h = this.clock.setTimeout(() => { const f = this.fn; this.h = null; this.fn = null; this.rem = null; if (f) f(); }, this.rem);
  }
  pause() {
    if (this.h == null) return;
    this.clock.clearTimeout(this.h); this.h = null;
    this.rem = Math.max(0, this.rem - (this.clock.now() - this.t0));
    this.paused = true;
  }
  resume() { if (this.paused && this.fn) { this.paused = false; this._arm(); } }
  cancel() { if (this.h != null) this.clock.clearTimeout(this.h); this.h = null; this.rem = null; this.fn = null; this.paused = false; }
  get active() { return this.h != null || this.paused; }
}

const newBoard = () => Object.fromEntries(TOOLS.map((t) => [t, { correct: 0, wrong: 0, points: 0 }]));
const boardRows = (b) => TOOLS.map((tool) => ({ tool, ...b[tool] }));
const mulOf = (chain) => (chain >= 2 ? Math.min(NUM.CHAIN_MAX, chain) : 1);

/* ---------------------------------------------------------------- the engine */
export function createEngine(opts = {}) {
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  const win = opts.win || (typeof window !== 'undefined' ? window : null);
  const g = globalThis;
  const clock = opts.clock || {
    now: () => g.performance.now(),
    setTimeout: (f, ms) => g.setTimeout(f, ms), clearTimeout: (h) => g.clearTimeout(h),
    setInterval: (f, ms) => g.setInterval(f, ms), clearInterval: (h) => g.clearInterval(h),
  };
  let storage = opts.storage;
  if (storage === undefined) { try { storage = g.localStorage; } catch { storage = null; } }
  const store = makeStore(storage);
  const t = opts.t || ((k) => k);
  const getState = opts.qawState || (() => readQawState(doc));
  const getCounts = opts.qawCounts || (() => readQawCounts(doc));
  const baseFetch = opts.fetch || (typeof g.fetch === 'function' ? g.fetch.bind(g) : () => Promise.reject(new Error('no fetch')));
  let net = 0;
  const countedFetch = (...a) => { net += 1; return baseFetch(...a); };

  /* ---- events */
  const subs = new Map();
  const on = (type, fn) => { if (!subs.has(type)) subs.set(type, new Set()); subs.get(type).add(fn); return () => subs.get(type).delete(fn); };
  const emit = (type, payload = {}) => {
    for (const fn of [...(subs.get(type) || [])]) fn(payload);
    for (const fn of [...(subs.get('*') || [])]) fn(type, payload);
  };

  /* ---- levels (injected, or imported lazily so the boot of the page stays small) */
  const mods = {};
  if (Array.isArray(opts.levels)) opts.levels.forEach((m, i) => { mods[i + 1] = m; });
  else if (opts.levels) Object.assign(mods, opts.levels);
  let loading = null;
  const preload = () => {
    if (Object.keys(mods).length >= LEVELS) return Promise.resolve();
    if (!loading) {
      loading = Promise.all([1, 2, 3, 4, 5].map((n) => (mods[n] ? null : import(`./levels/l${n}.js`).then((m) => { mods[n] = m; })))).then(() => {});
    }
    return loading;
  };

  /* ---- run state */
  let status = STATUS.TITLE;
  let n = 0;
  let paused = false;
  let pauseReason = null;
  let run = null;       // the current playthrough
  let R = null;         // the current level's record
  let ctx = null;
  const hintTimer = new PTimer(clock);
  const clearTimer = new PTimer(clock);
  let pollH = null;
  let offDoc = null;

  const newRun = () => {
    run = { score: 0, chain: 0, mult: 1, board: newBoard(), levels: {}, results: {}, pasted: false, bugs: 0, bonuses: 0 };
  };
  newRun();
  /** Scoreboard rows with the QA Wrap feature's own name and icon in the player's language (page: no feature, use key). */
  const rowsOf = (b) => boardRows(b).map((r) => { const l = toolLabel(r.tool, store.data.prefs.lang); return { ...r, name: l.name, icon: l.icon, ...(l.key ? { key: l.key } : {}) }; });
  const lvl = (k) => (run.levels[k] || (run.levels[k] = { board: newBoard(), pts: 0 }));

  const setStatus = (s, k) => { status = s; n = k === undefined ? n : k; emit('state', { status, n }); };

  const elapsed = () => {
    if (!R) return 0;
    if (R.frozen != null) return R.frozen;
    const end = R.pauseAt != null ? R.pauseAt : clock.now();
    return Math.max(0, end - R.startAt - R.pausedMs);
  };
  const stopClock = () => { if (R && R.frozen == null) R.frozen = elapsed(); };

  /* ---- multiplier (quiet) */
  function hit(quick) {
    const prev = run.mult;
    if (quick) {
      run.chain += 1; run.mult = mulOf(run.chain);
      emit('level:chain', { n, chain: run.chain, mult: run.mult, up: run.mult > prev, reset: false, quiet: true });
    } else resetChain();
  }
  function resetChain() {
    if (run.chain === 0) return;
    run.chain = 0; run.mult = 1;
    emit('level:chain', { n, chain: 0, mult: 1, up: false, reset: true, quiet: true }); // quiet: no animation, no sound
  }

  const inLevel = () => (status === STATUS.PLAY || status === STATUS.CARD) && n >= 1 && n <= LEVELS; // a finale paste belongs to the run, not to level 5

  /* ---- points. Correct rows are multiplied; wrong rows reset the multiplier and are clamped so the score never goes below 0. */
  function bump(board, tool, correct, delta) {
    const row = board[tool];
    if (correct) row.correct += 1; else row.wrong += 1;
    row.points += delta;
  }
  function award(tool, kind) {
    const rule = ruleFor(tool, kind);
    if (!rule) return null;
    const correct = rule.outcome === 'correct';
    let nominal = rule.points;
    let mult = 1;
    if (correct) { mult = run.mult; nominal = Math.round(rule.points * mult); } else resetChain();
    const delta = (correct ? nominal : Math.max(nominal, -run.score)) || 0; // `|| 0` turns -0 into 0
    run.score += delta;
    bump(run.board, tool, correct, delta);
    if (inLevel()) { const L = lvl(n); bump(L.board, tool, correct, delta); L.pts += delta; }
    const rec = { tool, kind, outcome: rule.outcome, points: rule.points, delta, mult, reasonKey: rule.reasonKey || null, quiet: !correct, n, score: run.score };
    emit('score:tool', rec);
    return rec;
  }
  function addExtra(tool, delta) { // speed bonus: points without a "correct use" count
    run.score += delta; run.board[tool].points += delta;
    if (inLevel()) { const L = lvl(n); L.board[tool].points += delta; L.pts += delta; }
  }
  const wrongOnce = (tool, kind) => {
    if (!R) return;
    const key = `${tool}:${kind}`;
    if (R.wrongSeen.has(key)) return;
    R.wrongSeen.add(key);
    award(tool, kind);
  };

  /* ---- level lifecycle */
  function makeCtx(k, root) {
    return {
      n: k, root, doc, win, t,
      now: () => clock.now(),
      qawState: () => getState(),
      qawCounts: () => getCounts(),
      fetch: countedFetch,
      netCount: () => net,
      setTimeout: (f, ms) => clock.setTimeout(f, ms),
      clearTimeout: (h) => clock.clearTimeout(h),
      MutationObserver: opts.MutationObserver || (win && win.MutationObserver) || undefined,
      emit: (e) => onLevelEvent(k, e),
    };
  }

  function startWatch() {
    stopWatch();
    if (doc && doc.addEventListener) {
      const f = () => watchTick();
      doc.addEventListener('qaw:state', f);
      offDoc = () => doc.removeEventListener('qaw:state', f);
    }
    pollH = clock.setInterval(() => { if (!paused) watchTick(); }, POLL_MS);
  }
  function stopWatch() {
    if (offDoc) { offDoc(); offDoc = null; }
    if (pollH != null) { clock.clearInterval(pollH); pollH = null; }
  }
  function snapshotSignals() {
    const c = getCounts();
    R.lastState = getState();
    R.lastNotes = c ? c.notes : null;
    R.lastShots = c ? c.shots : null;
    R.chipBase = {};
    for (const def of R.mod.chips || []) if (def.signal && cnt(c, def.signal) !== null) R.chipBase[def.id] = cnt(c, def.signal);
  }

  /** Compare the shared signals with the last look; each change is one tool use, classified by where the player is in the level. */
  function watchTick() {
    if (!R || status !== STATUS.PLAY || paused) return;
    const s = getState();
    if (s && s !== R.lastState) {
      const prev = R.lastState;
      R.lastState = s;
      if (s === 'stopped' && prev !== 'stopped') toolUsed('stop', 1);
    }
    const c = getCounts();
    if (c) {
      for (const [tool, key, last] of [['note', 'notes', 'lastNotes'], ['shot', 'shots', 'lastShots']]) {
        const v = c[key];
        if (v === null) continue;
        if (R[last] === null || v < R[last]) { R[last] = v; continue; } // first sight, or a new session: re-base without an event
        if (v > R[last]) { const d = v - R[last]; R[last] = v; toolUsed(tool, d); }
      }
    }
    watchChips(c);
    checkProve();
  }

  function toolUsed(tool, delta) {
    const caught = R.caught;
    if (tool === 'stop') {
      if (!caught) wrongOnce('stop', 'early'); // stopping before the bug was caught
      return;
    }
    if (tool === 'note') {
      const now = clock.now();
      const dup = delta > 1 || (R.noteAt != null && now - R.noteAt <= NUM.DUP_MS);
      R.noteAt = now;
      if (dup) wrongOnce('note', 'duplicate');
      const pend = R.mod && R.mod.pending && R.mod.pending();
      if (!caught && !pend) wrongOnce('note', 'early');
      return;
    }
    if (tool === 'shot') {
      if (n !== 4) wrongOnce('shot', 'wrong-level');
      else if (!caught) wrongOnce('shot', 'early');
    }
  }

  function onLevelEvent(k, e) {
    if (!R || R.n !== k || status !== STATUS.PLAY || !e) return;
    switch (e.type) {
      case 'catch': return doCatch(e);
      case 'bonus': return doBonus();
      case 'noise': emit('level:noise', { n }); return undefined;
      case 'nudge': emit('level:nudge', { n, key: e.key }); startHint(); return undefined;
      case 'wrong': {
        if (e.kind !== 'decoy') return undefined;
        const key = `decoy:${e.id}`;
        if (R.wrongSeen.has(key)) return undefined; // once per element per level
        R.wrongSeen.add(key);
        award('page', 'decoy');
        return undefined;
      }
      default: return undefined;
    }
  }

  const underPar = (ms) => ms < PAR_S[n] * 1000;

  function doCatch(e) {
    if (R.caught) return;
    const ms = elapsed();
    hit(ms <= PAR_S[n] * 1000); // quick catch extends the multiplier; a slow one resets it quietly
    R.caught = true; R.catchMs = ms;
    hintTimer.cancel();
    rebaseChips();
    const rec = award('page', 'catch');
    const cf = R.mod && R.mod.catchFeature; // e.g. level 2: the recorder caught it
    const extra = cf ? award(cf.tool, cf.kind) : null;
    emit('level:catch', { n, score: run.score, gained: rec ? rec.delta : 0, mult: rec ? rec.mult : 1, reason: e.reason || null, feature: cf ? cf.tool : null, featureGained: extra ? extra.delta : 0 });
    checkProve();
  }

  function doBonus() {
    if (R.bonus) return;
    R.bonus = true;
    hit(elapsed() <= PAR_S[n] * 1000);
    const rec = award('page', 'bonus');
    run.bonuses += 1;
    emit('level:bonus', { n, gained: rec ? rec.delta : 0, mult: rec ? rec.mult : 1, score: run.score });
  }

  function checkProve() {
    if (!R || !R.caught || R.proved || status !== STATUS.PLAY || paused) return;
    let ok = false;
    try { ok = !!(R.mod && R.mod.proveSignal && R.mod.proveSignal(ctx)); } catch { ok = false; }
    if (!ok) return;
    const tool = PROVE_TOOL[n];
    const kind = tool === 'wake' ? 'awake' : tool === 'notbug' ? 'chip' : 'after-catch'; // the rule row for this tool's prove step
    doProve(tool, kind);
  }

  function doProve(tool, kind) {
    R.proved = true; stopClock(); R.proveMs = R.frozen;
    const rec = award(tool, kind);
    emit('level:prove', { n, kind, tool, points: rec ? rec.delta : 0, score: run.score });
    clearTimer.start(R.bonus ? NUM.CLEAR_GRACE_MS : NUM.CLEAR_GRACE_BONUS_MS, () => { if (status === STATUS.PLAY) endLevel(false); });
  }

  /** The self-report prove chip: "I pressed Not a bug" (level 2, only after the harmless failure really fired), "I added a note" / "I took a screenshot" when QA Wrap shares no counts. */
  function claimProve(kind) {
    if (status !== STATUS.PLAY || !R || !R.caught || R.proved || paused) return false;
    const auto = !!(R.mod.signalAvailable && R.mod.signalAvailable(ctx)); // the extension shares the count: no self-report
    const chipOk = (n === 2 && kind === 'notbug' && !auto && !(R.mod.chipReady && !R.mod.chipReady()))
      || (n === 3 && kind === 'note' && !(R.mod.signalAvailable && R.mod.signalAvailable(ctx)))
      || (n === 4 && kind === 'shot' && !(R.mod.signalAvailable && R.mod.signalAvailable(ctx)));
    if (!chipOk) return false;
    doProve(PROVE_TOOL[n], 'chip');
    return true;
  }

  /** Optional feature chips (shortcut, note type, mark up, replay buffer): self-reported, once per level, bonus points, never required. */
  function claimChip(id, via = 'self') {
    if (status !== STATUS.PLAY || !R || paused || !R.mod) return false;
    const def = (R.mod.chips || []).find((c) => c.id === id);
    if (!def || R.chipsDone.has(id)) return false;
    if (def.after === 'caught' && !R.caught) return false;
    if (via === 'self' && chipAuto(def)) return false; // QA Wrap shares the count: it is read, not claimed
    R.chipsDone.add(id);
    const rec = award(def.tool || id, 'chip');
    emit('level:chip', { n, id, tool: def.tool || id, points: rec ? rec.delta : 0, mult: rec ? rec.mult : 1, score: run.score, via });
    return true;
  }
  const chipAuto = (def) => !!(def.signal && cnt(getCounts(), def.signal) !== null);
  /** Chips due only after the catch start counting from the catch. */
  function rebaseChips() {
    const c = getCounts();
    for (const def of R.mod.chips || []) if (def.signal && def.after === 'caught' && cnt(c, def.signal) !== null) R.chipBase[def.id] = cnt(c, def.signal);
  }
  /** Feature chips the extension counts for us: a rise since the baseline, once due, claims the chip by itself. */
  function watchChips(c) {
    for (const def of R.mod.chips || []) {
      const v = def.signal ? cnt(c, def.signal) : null;
      if (v === null || R.chipsDone.has(def.id)) continue;
      const base = R.chipBase[def.id];
      const due = def.after !== 'caught' || R.caught;
      if (base === undefined || v < base || !due) { R.chipBase[def.id] = v; continue; }
      if (v > base) { R.chipBase[def.id] = v; claimChip(def.id, 'signal'); }
    }
  }

  function startHint() {
    if (!R || R.pinged || R.caught || status !== STATUS.PLAY) return;
    hintTimer.start(NUM.HINT_IDLE_MS, () => {
      if (!R || R.pinged || R.caught || status !== STATUS.PLAY) return;
      R.pinged = true;
      emit('level:hint', { n, kind: 'ping', key: `hint.${n}` });
    });
    if (paused) hintTimer.pause();
  }

  function leaveLevel() {
    hintTimer.cancel(); clearTimer.cancel(); stopWatch();
    if (R && R.mod) { try { R.mod.dispose(); } catch { /* ignore */ } }
    if (ctx && ctx.root && ctx.root.replaceChildren) ctx.root.replaceChildren();
    ctx = null;
  }

  function endLevel(skipped) {
    if (!R) { R = { n, caught: false, proved: false, bonus: false, mod: null, wrongSeen: new Set(), pausedMs: 0, startAt: clock.now() }; }
    stopClock();
    const k = n;
    let ms = R.proveMs != null ? R.proveMs : (R.frozen != null ? R.frozen : 0);
    leaveLevel();
    const caught = !skipped && R.caught;
    const proved = caught && R.proved;
    if (skipped) { resetChain(); } else if (caught && !R.proved) { /* finished without the prove step: 1 star */ }
    if (caught) {
      const bonusPts = Math.min(NUM.SPEED_MAX, Math.max(0, Math.floor(PAR_S[k] - ms / 1000)));
      if (bonusPts > 0) addExtra('page', bonusPts);
    }
    let stars = 1;
    if (proved) stars = 2;
    if (proved && (underPar(ms) || R.bonus)) stars = 3;
    const d = store.data;
    const key = `l${k}`;
    d.stars[key] = Math.max(d.stars[key], stars);
    let newBest = false;
    if (caught) {
      if (d.best[key] === null || ms < d.best[key]) { d.best[key] = Math.max(1, Math.round(ms)); newBest = true; }
      d.stickers[STICKER_FOR[k]] = true;
      run.bugs += 1;
    }
    if (R.bonus) d.bonus[key] = true;
    store.save();
    const L = lvl(k);
    run.results[k] = { stars, ms, caught, proved, bonus: R.bonus, skipped: !!skipped };
    R = null;
    setStatus(STATUS.CLEAR, k);
    emit('level:clear', {
      n: k, stars, ms, bestMs: d.best[key], newBest, score: run.score, levelScore: L.pts,
      caught, proved, bonus: run.results[k].bonus, skipped: !!skipped, sticker: caught ? STICKER_FOR[k] : null,
      learned: featureFor(k, store.data.prefs.lang), goldSticker: caught && run.results[k].bonus, mult: run.mult, board: rowsOf(L.board), runBoard: rowsOf(run.board),
    });
    return true;
  }

  /* ---- public flow */
  function goCard(k) {
    leaveLevel(); R = null;
    setStatus(STATUS.CARD, k);
    emit('level:card', { n: k });
  }

  function start() {
    if (status !== STATUS.TITLE) return false;
    newRun(); preload().catch(() => {});
    goCard(1);
    return true;
  }

  async function go() {
    if (status !== STATUS.CARD) return false;
    const k = n;
    await preload();
    if (status !== STATUS.CARD || n !== k) return false;
    const mod = mods[k];
    const root = opts.root || (doc && doc.getElementById ? doc.getElementById('app') : null);
    if (!mod || !root) return false;
    if (root.replaceChildren) root.replaceChildren();
    ctx = makeCtx(k, root);
    R = {
      n: k, mod, startAt: clock.now(), pausedMs: 0, pauseAt: null, frozen: null,
      caught: false, catchMs: null, proved: false, proveMs: null, bonus: false, pinged: false, hinted: false,
      wrongSeen: new Set(), chipsDone: new Set(), noteAt: null, lastState: null, lastNotes: null, lastShots: null,
    };
    if (paused) R.pauseAt = clock.now();
    mod.mount(root, ctx);
    mod.arm(ctx);
    snapshotSignals();
    setStatus(STATUS.PLAY, k);
    emit('level:play', { n: k });
    startWatch();
    startHint();
    if (paused) { hintTimer.pause(); stopWatch(); }
    return true;
  }

  function skip() {
    if (status === STATUS.CARD) {
      R = { n, caught: false, proved: false, bonus: false, mod: null, wrongSeen: new Set(), pausedMs: 0, startAt: clock.now() };
    } else if (status !== STATUS.PLAY) return false;
    emit('level:skip', { n });
    return endLevel(true);
  }

  /** Nader, 15 Oct 2026: "Finish level" always advances once the bug is caught; the prove step only earns its own points and the 2nd/3rd star (unmet goals score 0). */
  function finish() {
    if (status !== STATUS.PLAY || !R || !R.caught) return false;
    return endLevel(false);
  }

  function next() {
    if (status !== STATUS.CLEAR) return false;
    if (n < LEVELS) { goCard(n + 1); return true; }
    enterFinale();
    return true;
  }

  function enterFinale() {
    leaveLevel(); R = null;
    const d = store.data;
    let stars = 0; let runMs = 0; let all = true;
    for (let k = 1; k <= LEVELS; k++) {
      const r = run.results[k];
      stars += r ? r.stars : 0;
      if (r && r.caught) runMs += r.ms; else all = false;
    }
    if (all && runMs > 0 && (d.best.run === null || runMs < d.best.run)) { d.best.run = Math.round(runMs); store.save(); }
    setStatus(STATUS.FINALE, LEVELS);
    emit('finale', {
      score: run.score, stars, starsMax: LEVELS * NUM.STARS_PER_LEVEL, bugs: run.bugs, bonuses: run.bonuses,
      runMs: all ? runMs : null, bestRunMs: d.best.run, board: rowsOf(run.board), learned: [1, 2, 3, 4, 5].map((j) => featureFor(j, store.data.prefs.lang)),
    });
  }

  /** Play again: a fresh run from card 1. Best times, stars and stickers stay (Settings > Reset progress clears them). */
  function restart() {
    if (status === STATUS.PLAY || status === STATUS.CARD) leaveLevel();
    R = null; newRun(); paused = false; pauseReason = null;
    goCard(1);
    return true;
  }
  function toTitle() { leaveLevel(); R = null; newRun(); setStatus(STATUS.TITLE, 0); return true; }

  function hint() {
    if (status !== STATUS.PLAY || !R || R.caught || paused) return false;
    R.hinted = true;
    emit('level:hint', { n, kind: 'open', key: `hint.${n}` });
    return true;
  }

  /* ---- pause: stopwatch, hint clock, auto-clear beat and signal polling stop together and resume where they were */
  function pause(reason = 'manual') {
    if (paused) return false;
    paused = true; pauseReason = reason;
    if (R && R.frozen == null && R.pauseAt == null) R.pauseAt = clock.now();
    hintTimer.pause(); clearTimer.pause();
    if (pollH != null) { clock.clearInterval(pollH); pollH = null; }
    emit('pause', { paused: true, reason });
    return true;
  }
  function resume() {
    if (!paused) return false;
    paused = false; pauseReason = null;
    if (R && R.pauseAt != null) { R.pausedMs += clock.now() - R.pauseAt; R.pauseAt = null; }
    hintTimer.resume(); clearTimer.resume();
    if (R && status === STATUS.PLAY && pollH == null) pollH = clock.setInterval(() => { if (!paused) watchTick(); }, POLL_MS);
    emit('pause', { paused: false, reason: null });
    return true;
  }
  const togglePause = () => (paused ? resume() : pause('manual'));
  /** Auto-pause on a hidden tab ONLY. Never on window blur: opening the QA Wrap popup blurs the window. Resuming is the player's press. */
  function bindPage(d = doc) {
    if (!d || !d.addEventListener) return () => {};
    const onVis = () => { if (d.hidden) pause('hidden'); };
    d.addEventListener('visibilitychange', onVis);
    return () => d.removeEventListener('visibilitychange', onVis);
  }

  /* ---- finale: paste only; nothing pasted is kept */
  function pasteText(text) {
    if (status !== STATUS.FINALE) return { ok: false, reason: 'not-finale' };
    const r = inspectReport(text);
    if (!r.ok) { emit('finale:notyet', {}); return { ok: false, reason: 'format' }; }
    if (!run.pasted) {
      run.pasted = true;
      award('copy', r.bug ? 'report' : 'no-bug');
    }
    const out = { ok: true, heading: r.heading, lines: r.lines, bug: r.bug };
    emit('finale:pasted', { heading: r.heading, lines: r.lines, bug: r.bug, score: run.score, board: rowsOf(run.board) });
    return out;
  }
  /** Wires the textarea: ONLY the paste event (no clipboard read API, no permission prompt). The text never enters the page. */
  function bindPasteGate(textarea, onResult) {
    const onPaste = (e) => {
      if (e.preventDefault) e.preventDefault();
      let txt = '';
      try { txt = e.clipboardData ? e.clipboardData.getData('text') : ''; } catch { txt = ''; }
      textarea.value = '';
      const r = pasteText(txt);
      txt = '';
      if (onResult) onResult(r);
    };
    textarea.addEventListener('paste', onPaste);
    return () => textarea.removeEventListener('paste', onPaste);
  }

  /* ---- prefs and progress */
  const getPrefs = () => ({ ...store.data.prefs });
  function setPref(key, value) {
    const p = store.data.prefs;
    let ok = false;
    if (key === 'lang' && (value === 'en' || value === 'ar')) ok = true;
    else if (key === 'theme' && ['auto', 'light', 'dark'].includes(value)) ok = true;
    else if (['sound', 'voice', 'calm'].includes(key) && typeof value === 'boolean') ok = true;
    else if (key === 'volume' && Number.isFinite(value)) { value = Math.min(100, Math.max(0, Math.round(value))); ok = true; }
    if (!ok) return false;
    p[key] = value; store.save();
    emit('prefs', { prefs: getPrefs() });
    return true;
  }
  function resetProgress() { store.resetProgress(); emit('progress:reset', {}); return true; }

  /* ---- read side */
  const scoreboard = (scope = 'run', k) => rowsOf(scope === 'level' ? lvl(k || n).board : run.board);
  /** What the player still has to do to win this level: 'catch' | 'noise' (level 2: the harmless failure) | 'feature' | null. */
  function needsOf() {
    if (!R || status !== STATUS.PLAY || R.proved) return null;
    if (!R.caught) return 'catch';
    if (n === 2 && R.mod && R.mod.chipReady && !R.mod.chipReady()) return 'noise';
    return 'feature';
  }
  function view() {
    const d = store.data;
    return {
      status, n, paused, pauseReason, score: run.score, chain: run.chain, mult: run.mult,
      caught: !!(R && R.caught), proved: !!(R && R.proved), bonusFound: !!(R && R.bonus),
      canFinish: !!(R && R.caught && status === STATUS.PLAY), needs: needsOf(), elapsedMs: Math.round(elapsed()),
      proveTool: PROVE_TOOL[n] || null,
      chipAvailable: !!(R && R.caught && !R.proved && R.mod && !(R.mod.signalAvailable && R.mod.signalAvailable(ctx)) && (n === 2 ? !(R.mod.chipReady && !R.mod.chipReady()) : (n === 3 || n === 4))),
      featureAuto: !!(R && R.mod && R.mod.signalAvailable && R.mod.signalAvailable(ctx)),
      chips: R && R.mod ? (R.mod.chips || []).map((c) => ({ id: c.id, claimed: R.chipsDone.has(c.id), available: !R.chipsDone.has(c.id) && (c.after !== 'caught' || R.caught) && !chipAuto(c), auto: chipAuto(c) })) : [],
      qaw: getState(), best: { ...d.best }, stars: { ...d.stars }, stickers: { ...d.stickers }, bonus: { ...d.bonus },
      results: { ...run.results },
    };
  }

  function destroy() { leaveLevel(); R = null; subs.clear(); }

  return {
    on, preload, start, go, skip, finish, next, restart, toTitle, hint, claimProve, claimChip, featureFor, toolLabel,
    pause, resume, togglePause, bindPage, pasteText, bindPasteGate, getPrefs, setPref, resetProgress,
    scoreboard, view, destroy,
    get status() { return status; }, get n() { return n; }, get score() { return run.score; }, get paused() { return paused; },
  };
}
