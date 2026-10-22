/* QA Wrap Bug Hunt - hard trials engine (lane T1): stages 6 "Narrow Window" and 7 "Release Night".
 * Design: work/sdlc/design/DESIGN-bug-hunt-hard.md (+ APPROVAL-hard.md: no hint of any kind, so no cause is stored or shown).
 *
 * No randomness, no wall clock, no model call, no network except the injected `fetch` to the planted routes of game/server.mjs.
 * Everything from outside is injected (clock, storage, session, doc/win, signals, fetch, reload), so the run is testable on a virtual clock.
 *
 * Layers:  makeObserver  count/state changes -> rises and transitions (baselines that drop with a new session)
 *          createJudge   pure rules (trials/t6.js, t7.js): the lag law, early/missed/over, forbid, click, paste -> events (no DOM, no clock)
 *          createScene   the arena DOM: tells, glitches, planted failures, ping mark, decoys, paste box
 *          createTrial   door, run loop, death/restart (reload under cover), pause, storage, unlock, badges, events
 *
 * The lag law (design s2): a rise of a SLOW count seen at t_obs came from a press p with t_obs - LAG_SLOW <= p <= t_obs, so a window [a, b]
 * accepts an observation up to b + GRACE. No truly in-window press is ever rejected; the only unfairness favours the player. */
import { readQawState, readQawCounts, inspectReport } from './engine.js';
import { TRIAL, trialPoints } from './scoring.js';
import t6 from './trials/t6.js';
import t7 from './trials/t7.js';
import { createAttune } from './trials/attune.js';

export const LAG_SLOW = 3600;
export const LAG_FAST = 500;
export const TOL = 100;
/** Extra time after a window's end in which an observation still counts, by signal class. */
export const GRACE = ({ slow: LAG_SLOW + TOL, fast: LAG_FAST, exact: 0 });
export const TICK_MS = 50;
export const READY_BEAT_MS = 800;
export const RESTART_BEAT_MS = 250;
export const RELOAD_MS = 150;
export const PING_MS = 2200;
export const STORAGE_KEY = 'bughunt.trial.v1';
export const COVER_KEY = 'bughunt.trial.cover.v1';
export const GAME_KEY = 'bughunt.v1';
export const WORDS = (['almond', 'basil', 'cumin', 'dill', 'fennel', 'garlic', 'mint', 'olive', 'parsley', 'saffron', 'sesame', 'thyme']);
export const SIGS = (['notes', 'shots', 'shortcut', 'expected', 'marks', 'buffer']);
const SLOW_SIGS = new Set(['notes', 'shots', 'shortcut', 'marks']);

/* ---------------------------------------------------------------- observer */
/** Turns successive snapshots { state, counts } into transitions and rises. A count that drops is a new session (counts replaced):
 *  it is read as that many rises since 0. The first value of a signal only sets its baseline. */
export function makeObserver() {
  const last = {};
  let state = null;
  const val = (c, s) => (c && Number.isInteger(c[s]) && c[s] >= 0 ? c[s] : null);
  const prime = (snap) => {
    state = snap && snap.state ? snap.state : null;
    for (const s of SIGS) last[s] = val(snap && snap.counts, s);
  };
  const read = (snap) => {
    const rises = [];
    const changes = [];
    for (const s of SIGS) {
      const v = val(snap.counts, s);
      if (v === null) continue;
      const l = last[s];
      last[s] = v;
      if (l === null || l === undefined) continue;
      if (v > l) rises.push({ sig: s, delta: v - l });
      else if (v < l && v > 0) rises.push({ sig: s, delta: v });
    }
    if (snap.state && snap.state !== state) { changes.push({ from: state, to: snap.state }); state = snap.state; }
    return { rises, changes };
  };
  return { prime, read };
}

/* ---------------------------------------------------------------- the judge */
/** Pure rule engine for one attempt. stage = a trials/t*.js module. opts: { noShortcut, validatePaste(text) -> bool }.
 *  Methods return arrays of events: ok{id,action,points,t}, resolved{id,t}, room{room}, death{cause,room,t,rule}, clear{t}. */
export function createJudge(stage, opts = {}) {
  const rules = stage.rules.filter((r) => !(opts.noShortcut && r.skipNoShortcut)).map((r) => ({ ...r }));
  rules.sort((x, y) => (x.type === 'forbid' ? 1 : 0) - (y.type === 'forbid' ? 1 : 0)); // accept windows are tried before forbid windows (ambiguous overlaps pass)
  const S = new Map(rules.map((r) => [r.id, { acc: null, fin: false, extra: 0 }]));
  const obs = makeObserver();
  let status = 'run';
  let dead = null;
  let points = 0;
  let room = 1;
  let muteUntil = -1;
  let out = [];

  const resolved = (id) => (S.has(id) ? S.get(id).acc : null);
  const roomStart = (rm) => (rm.start !== undefined ? rm.start : (resolved(rm.from) === null ? null : resolved(rm.from) + (rm.off || 0)));
  const roomAt = (t) => { let cur = 1; for (const rm of stage.rooms) { const s = roomStart(rm); if (s !== null && s <= t) cur = rm.room; } return cur; };
  const syncRoom = (t) => { const r = roomAt(t); if (r !== room) { room = r; out.push({ type: 'room', room }); } };
  const flush = () => { const o = out; out = []; return o; };
  const win = (r) => {
    const base = r.from ? resolved(r.from) : 0;
    if (base === null) return { lo: r.a === -Infinity ? -Infinity : null, hi: null };
    return { lo: base + r.a, hi: base + r.b + (GRACE[r.cls] || 0) + S.get(r.id).extra };
  };
  const die = (cause, r, t, byRule) => {
    if (status !== 'run') return;
    status = 'dead';
    dead = { cause, rule: r ? r.id : null, room: byRule && r ? r.room : roomAt(t), t };
    out.push({ type: 'death', ...dead });
  };
  const accept = (r, t) => {
    const s = S.get(r.id);
    s.acc = t;
    out.push({ type: 'resolved', id: r.id, t });
    if (r.award) { const p = trialPoints(r.award); points += p; out.push({ type: 'ok', id: r.id, action: r.award, points: p, t }); }
    if (r.final) { status = 'clear'; out.push({ type: 'clear', t }); }
  };
  /** One rise or transition against one rule. Returns true when the rule consumed the event. */
  const handle = (r, t, delta) => {
    const s = S.get(r.id);
    if (r.armAfter) { const a0 = resolved(r.armAfter); if (a0 === null || t <= a0) return false; }
    const { lo, hi } = win(r);
    if (s.acc !== null) {
      if (r.over && r.type === 'rise' && (r.overScope !== 'window' || (lo !== null && hi !== null && t >= lo && t <= hi))) { die(r.over, r, t); return true; }
      return false;
    }
    if (lo === null || t < lo) { if (r.early) { die(r.early, r, t); return true; } return false; }
    if (hi !== null && t > hi) { if (r.missed) { die(r.missed, r, t, true); return true; } return false; }
    if (delta > 1 && r.over && r.type === 'rise') { die(r.over, r, t); return true; }
    accept(r, t);
    return true;
  };
  const deadlines = (t) => {
    for (const r of rules) {
      if (r.type === 'forbid') {
        const s = S.get(r.id);
        if (r.award && !s.fin && t >= r.awardAt) { s.fin = true; const p = trialPoints(r.award); points += p; out.push({ type: 'ok', id: r.id, action: r.award, points: p, t }); }
        continue;
      }
      const s = S.get(r.id);
      if (s.acc !== null || !r.missed) continue;
      if (r.armAfter && resolved(r.armAfter) === null) continue;
      const { hi } = win(r);
      if (hi !== null && t > hi) { die(r.missed, r, t, true); if (status !== 'run') return; }
    }
  };
  const start = (snap) => { obs.prime(snap); };
  const step = (t, snap) => {
    if (status !== 'run') return flush();
    const d = obs.read(snap);
    // rises first, then transitions: when a mark-up and a Stop land in the same tick, the mark-up (which opens the Stop window) is read first
    for (const ri of d.rises) {
      if (status !== 'run') break;
      if (SLOW_SIGS.has(ri.sig) && t < muteUntil) continue;
      let used = false;
      for (const r of rules) if (r.type === 'rise' && r.sig === ri.sig && handle(r, t, ri.delta)) { used = true; break; }
      if (!used) for (const r of rules) if (r.type === 'forbid' && r.sig === ri.sig && t >= r.a && t < r.b) { die(r.cause, r, t); break; }
    }
    for (const ch of d.changes) {
      if (status !== 'run') break;
      for (const r of rules) if (r.type === 'state' && r.want === ch.to && handle(r, t, 1)) break;
    }
    if (status === 'run') deadlines(t);
    if (status === 'run' || status === 'clear') syncRoom(t);
    return flush();
  };
  /** A page click: id 'next' (the planted dead button) or decoy: name of a [data-decoy] button. */
  const click = (t, c) => {
    if (status !== 'run') return flush();
    if (c.decoy) { if ((stage.decoyRooms || []).includes(roomAt(t))) die('decoy-click', null, t); return flush(); }
    for (const r of rules) {
      if (r.type !== 'click' || r.target !== c.id) continue;
      if (S.get(r.id).acc !== null) continue;
      const { lo, hi } = win(r);
      if (lo === null || t < lo) continue;
      if (hi !== null && t > hi) { die(r.missed, r, t, true); break; }
      accept(r, t);
      break;
    }
    if (status === 'run') syncRoom(t);
    return flush();
  };
  /** A paste event. Returns { ok, events }; a junk paste is simply ignored (ok false, no death). */
  const paste = (t, text) => {
    if (status !== 'run') return { ok: false, reason: 'not-run', events: flush() };
    const r = rules.find((x) => x.type === 'paste' && S.get(x.id).acc === null);
    if (!r) return { ok: false, reason: 'none', events: flush() };
    const { lo, hi } = win(r);
    if (lo === null || t < lo) return { ok: false, reason: 'early', events: flush() };
    if (hi !== null && t > hi) { die(r.missed, r, t, true); return { ok: false, reason: 'late', events: flush() }; }
    if (!(opts.validatePaste ? opts.validatePaste(text) : true)) return { ok: false, reason: 'format', events: flush() };
    accept(r, t);
    return { ok: true, events: flush() };
  };
  /** Pause rule: restart room `rm` from its tell. Rules of that room forget their progress, baselines are re-taken,
   *  slow rises seen before `mute` (a press made just before the pause, still in flight) count for nothing. */
  const restartRoom = (rm, snap, mute) => {
    for (const r of rules) if (r.room === rm) S.set(r.id, { acc: null, fin: false, extra: 0 });
    obs.prime(snap);
    muteUntil = mute;
    room = rm;
    out = [];
  };
  /** Hidden tab in a slow-wait room: its pending deadlines move out by `ms`. */
  const extend = (rm, ms) => { for (const r of rules) if (r.room === rm) S.get(r.id).extra += ms; };
  return {
    start, step, click, paste, restartRoom, extend, resolved, roomStart, roomAt,
    get room() { return room; }, get status() { return status; }, get dead() { return dead; }, get points() { return points; },
  };
}

/* ---------------------------------------------------------------- the arena (DOM) */
function createScene({ doc, root, t, fetch, getWord, getCalm }) {
  const h = (tag, attrs = {}, ...kids) => {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
    for (const kid of kids) el.append(typeof kid === 'string' ? doc.createTextNode(kid) : kid);
    return el;
  };
  let els = null;
  let ends = [];
  let tells = [];
  let stageRef = null;
  const post = (f) => {
    if (!f) return;
    const url = String(f.url).replace('{word}', getWord());
    try { const p = fetch(url, { method: f.method, cache: 'no-store' }); if (p && p.catch) p.catch(() => {}); } catch { /* the planted route is best effort */ }
  };
  const showTells = () => { els.tells.replaceChildren(); for (const x of tells) els.tells.append(x.el); };
  const build = (stage, deaths) => {
    stageRef = stage;
    ends = []; tells = [];
    root.replaceChildren();
    els = {};
    els.tells = h('div', { class: 'trial-tells' });
    els.ping = h('div', { class: 'trial-ping', 'data-on': '0', 'aria-hidden': 'true' }, '!');
    els.banner = h('div', { class: 'shop-banner', 'data-on': '0', role: 'status' }, '');
    els.sign = h('span', { class: 'shop-sign', 'data-on': '0' }, t('trial.shop.open'));
    els.saved = h('span', { class: 'shop-saved', 'data-on': '0' }, t('trial.shop.saved'));
    els.price = h('span', { class: 'shop-price', 'data-underline': '0' }, t('trial.shop.price'));
    els.total = h('div', { class: 'shop-row shop-total', 'data-overlap': '0' }, h('span', { class: 'shop-label' }, t('trial.shop.total')), h('span', { class: 'shop-price' }, t('trial.shop.price')));
    els.menu = h('div', { class: 'shop-menu', 'data-menu': 'ok' }, '');
    els.state = h('div', { class: 'shop-state', 'data-on': '0', 'aria-live': 'polite' }, '');
    els.spin = h('span', { class: 'shop-spin', 'data-on': '0' }, t('trial.shop.loading'));
    els.next = h('button', { class: 'shop-btn', id: 'next', type: 'button', 'data-ring': '0' }, t('trial.shop.next'));
    els.decoys = h('span', { class: 'trial-decoys' });
    els.paste = h('div', { class: 'trial-pastebox' });
    els.item = h('div', { class: 'shop-row' }, h('span', { class: 'shop-label' }, t('trial.shop.item')), els.price);
    els.win = h('div', { class: 'shop-window', 'data-level': 'trial', 'data-glitch': '' },
      h('div', { class: 'shop-chrome' }, t('trial.shop.title'), els.sign), els.banner, els.item, els.total, els.menu, els.state, els.spin,
      h('div', { class: 'shop-row' }, els.next, els.decoys, els.saved), els.paste);
    els.arena = h('div', { id: 'trial-arena', 'data-trial-run': String(stage.n), 'data-trial-room': '1', 'data-trial-deaths': String(deaths), 'data-calm': getCalm() ? '1' : '0' }, els.tells, els.ping, els.win);
    root.append(els.arena);
    setRoom(1);
  };
  function setRoom(room) {
    els.arena.setAttribute('data-trial-room', String(room));
    tells = tells.filter((x) => x.cls !== 'bar'); showTells();
    els.next.setAttribute('data-ring', '0');
    els.decoys.replaceChildren();
    if ((stageRef.decoyRooms || []).includes(room)) {
      for (const name of stageRef.decoys) els.decoys.append(h('button', { class: 'shop-btn', type: 'button', 'data-decoy': name }, t(`trial.shop.${name}`)));
    }
    els.paste.replaceChildren();
    if (stageRef.pasteRoom === room) {
      els.paste.append(h('textarea', { id: 'trial-paste', rows: '3', 'aria-label': t('trial.paste.label'), placeholder: t('trial.paste.label') }));
    }
  }
  const setDeaths = (d) => { if (els) els.arena.setAttribute('data-trial-deaths', String(d)); };
  const later = (at, fn) => { ends.push({ at, fn }); };
  const addTell = (cls, et, dur) => {
    const el = h('div', { class: 'trial-tell', 'data-cls': cls, 'data-on': '1' });
    const x = { cls, el, t0: et, dur: dur || 0 };
    if (cls === 'bar') { el.setAttribute('data-steps', '4'); el.setAttribute('data-step', '1'); }
    tells.push(x); showTells();
    if (dur && cls !== 'bar') later(et + dur, () => dropTell(cls));
  };
  const dropTell = (cls) => { tells = tells.filter((x) => x.cls !== cls); showTells(); };
  const pingOn = (et) => { els.ping.setAttribute('data-on', '1'); later(et + PING_MS, () => els.ping.setAttribute('data-on', '0')); };
  const effect = (name) => {
    if (name === 'saved') els.saved.setAttribute('data-on', '1');
    else if (name === 'payfail') { els.state.setAttribute('data-on', '1'); els.state.textContent = t('trial.shop.payfail'); els.spin.setAttribute('data-on', '1'); }
    else if (name === 'menu') { els.menu.setAttribute('data-menu', 'empty'); els.menu.textContent = t('trial.shop.empty'); els.spin.setAttribute('data-on', '1'); }
  };
  /** Apply one scene entry at effective time et. silent = replay of a persistent effect (no request, no ping, no tell). */
  const apply = (ev, et, silent) => {
    if (silent) { if (ev.op === 'fire') effect(ev.effect); else if (ev.op === 'sign') els.sign.setAttribute('data-on', ev.on ? '1' : '0'); return null; }
    if (ev.op === 'tell') { addTell(ev.cls, et, ev.dur); return { tell: ev.cls }; }
    if (ev.op === 'untell') { dropTell(ev.cls); return null; }
    if (ev.op === 'ring') { els.next.setAttribute('data-ring', ev.on ? '1' : '0'); return null; }
    if (ev.op === 'sign') { els.sign.setAttribute('data-on', ev.on ? '1' : '0'); return { sign: !!ev.on }; }
    if (ev.op === 'glitch') {
      post(ev.fetch);
      if (ev.kind === 'banner') { els.banner.setAttribute('data-on', '1'); els.banner.textContent = t(`trial.shop.${ev.text}`); later(et + ev.dur, () => { els.banner.setAttribute('data-on', '0'); els.banner.textContent = ''; }); }
      else { els.win.setAttribute('data-glitch', ev.kind); els.total.setAttribute('data-overlap', '1'); later(et + ev.dur, () => { els.win.setAttribute('data-glitch', ''); els.total.setAttribute('data-overlap', '0'); }); }
      return null;
    }
    if (ev.op === 'fire') { post(ev.fetch); effect(ev.effect); if (ev.ping) pingOn(et); return { fire: ev.fetch.url }; }
    return null;
  };
  const tick = (tt) => {
    const due = ends.filter((x) => x.at <= tt);
    if (due.length) { ends = ends.filter((x) => x.at > tt); for (const x of due) x.fn(); }
    for (const x of tells) {
      if (x.cls !== 'bar' || !x.dur) continue;
      const step = Math.min(4, Math.floor(((tt - x.t0) / x.dur) * 4) + 1);
      if (el_step(x.el) !== step) x.el.setAttribute('data-step', String(step));
    }
  };
  const el_step = (el) => Number(el.getAttribute('data-step'));
  const clear = () => { ends = []; tells = []; if (root) root.replaceChildren(); els = null; };
  const stopTimers = () => { ends = []; };
  return {
    build, setRoom, setDeaths, apply, tick, clear, stopTimers,
    get arena() { return els ? els.arena : null; }, get next() { return els ? els.next : null; },
    get pasteBox() { return els && els.paste.children[0] ? els.paste.children[0] : null; },
  };
}

/* ---------------------------------------------------------------- storage */
const freshStage = () => ({ deaths: 0, bestRoom: 0, clears: 0, attuned: false });
const freshData = () => ({ '6': freshStage(), '7': freshStage(), badges: {}, score: { '6': 0, '7': 0 }, shortcutOk: null });
const int = (v, max = 1e9) => (Number.isInteger(v) && v >= 0 && v <= max ? v : 0);
function sanitize(raw) {
  const out = freshData();
  if (!raw || typeof raw !== 'object') return out;
  for (const k of ['6', '7']) {
    const s = raw[k];
    if (!s || typeof s !== 'object') continue;
    out[k] = { deaths: int(s.deaths), bestRoom: int(s.bestRoom, 7), clears: int(s.clears), attuned: s.attuned === true };
    out.score[k] = int(raw.score && raw.score[k]);
  }
  for (const b of TRIAL.badges) if (raw.badges && raw.badges[b] === true) out.badges[b] = true;
  if (raw.shortcutOk === true || raw.shortcutOk === false) out.shortcutOk = raw.shortcutOk;
  return out;
}
/** Read-only look at the main game's stars (bughunt.v1). The trial never writes that key. */
export function readStars(storage) {
  try {
    const raw = storage && storage.getItem(GAME_KEY);
    const s = raw ? JSON.parse(raw).stars : null;
    return [1, 2, 3, 4, 5].map((k) => (s && Number.isInteger(s[`l${k}`]) ? s[`l${k}`] : 0));
  } catch { return [0, 0, 0, 0, 0]; }
}
/** Stage 6 opens when every level has >= 2 stars (a skip gives 1); stage 7 opens after stage 6 is cleared. */
export function unlockedStages(stars, data) {
  const open6 = stars.length === 5 && stars.every((s) => s >= TRIAL.unlockStars);
  return { 6: open6, 7: open6 && data['6'].clears > 0 };
}

/* ---------------------------------------------------------------- the trial */
export function createTrial(opts = {}) {
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  const win = opts.win || (typeof window !== 'undefined' ? window : null);
  const g = globalThis;
  const clock = opts.clock || { now: () => g.performance.now(), setInterval: (f, ms) => g.setInterval(f, ms), clearInterval: (x) => g.clearInterval(x) };
  let storage = opts.storage;
  if (storage === undefined) { try { storage = (win && win.localStorage) || g.localStorage || null; } catch { storage = null; } }
  let session = opts.session;
  if (session === undefined) { try { session = (win && win.sessionStorage) || g.sessionStorage || null; } catch { session = null; } }
  const t = opts.t || ((k) => k);
  const getState = opts.getState || (() => readQawState(doc));
  const getCounts = opts.getCounts || (() => readQawCounts(doc));
  const doFetch = opts.fetch || (typeof g.fetch === 'function' ? g.fetch.bind(g) : () => Promise.reject(new Error('no fetch')));
  const reloadPage = opts.reload || (() => { win.location.reload(); });
  const stages = opts.stages || { 6: t6, 7: t7 };
  const makeAttune = opts.createAttune || createAttune;
  const root = opts.root || (doc && doc.body) || null;
  const snap = () => ({ state: getState(), counts: getCounts() });

  const subs = new Map();
  const on = (type, fn) => { if (!subs.has(type)) subs.set(type, new Set()); subs.get(type).add(fn); return () => subs.get(type).delete(fn); };
  const emit = (type, payload = {}) => {
    for (const fn of [...(subs.get(type) || [])]) fn(payload);
    for (const fn of [...(subs.get('*') || [])]) fn(type, payload);
  };

  let data = freshData();
  try { const raw = storage && storage.getItem(STORAGE_KEY); if (raw) data = sanitize(JSON.parse(raw)); } catch { data = freshData(); }
  const save = () => { try { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* private mode or full: play on */ } };
  const readCover = () => { try { const r = session && session.getItem(COVER_KEY); const c = r ? JSON.parse(r) : null; return c && (c.n === 6 || c.n === 7) ? c : null; } catch { return null; } };
  const setCover = (c) => { try { if (session) session.setItem(COVER_KEY, JSON.stringify(c)); } catch { /* ignore */ } };
  const clearCover = () => { try { if (session) session.removeItem(COVER_KEY); } catch { /* ignore */ } };

  let phase = 'idle';       // idle | locked | card | attune | door | run | paused | death | clear
  let n = 0;
  let stage = null;
  let judge = null;
  let word = WORDS[0];
  let attempt = 1;
  let anchor = 0;
  let loop = null;
  let beatAt = null;
  let quickBeat = false;
  let doorOpen = false;
  let pausedAt = 0;
  let frozen = null;
  let deadAt = 0;
  let reloaded = false;
  let calm = false;
  let fired = new Set();
  let lastClear = null;
  let attune = null;
  let attuneState = null;
  let offQaw = null;
  let offVis = null;
  let unbindPaste = null;

  const scene = createScene({ doc, root, t, fetch: (u, o) => doFetch(u, o), getWord: () => word, getCalm: () => calm });
  const stars = () => readStars(storage);
  const unlocked = () => unlockedStages(stars(), data);
  const effTime = (ev) => (ev.from ? (judge.resolved(ev.from) === null ? Infinity : judge.resolved(ev.from) + ev.t) : ev.t);

  function stopLoop() {
    if (loop !== null) { clock.clearInterval(loop); loop = null; }
    if (offQaw) { offQaw(); offQaw = null; }
    if (offVis) { offVis(); offVis = null; }
  }
  function ensureLoop() {
    if (loop === null) loop = clock.setInterval(tick, TICK_MS);
    if (!offQaw && doc && doc.addEventListener) { const f = () => { if (phase === 'run') observeRun(clock.now()); }; doc.addEventListener('qaw:state', f); offQaw = () => doc.removeEventListener('qaw:state', f); }
    if (!offVis && doc && doc.addEventListener) { const f = () => onVisibility(); doc.addEventListener('visibilitychange', f); offVis = () => doc.removeEventListener('visibilitychange', f); }
  }

  /* ---- opening, unlocking */
  function open(num) {
    if (num !== 6 && num !== 7) return { ok: false, reason: 'stage' };
    stopLoop(); scene.clear();
    if (!unlocked()[num]) { n = num; stage = null; judge = null; phase = 'locked'; return { ok: false, reason: 'locked' }; }
    stage = stages[num];
    n = num; judge = null; phase = 'card';
    emit('trial:card', { n });
    // a page that was reloaded by a death or by "begin" restarts by itself: the cover flag names the stage (design s3.3)
    const c = readCover();
    if (c && c.n === num && data[String(num)].attuned) enterDoor(true);
    return { ok: true, restarting: phase === 'door' };
  }
  function leave() {
    stopLoop(); scene.clear(); clearCover();
    phase = 'idle'; stage = null; judge = null; n = 0; attune = null; fired = new Set();
    emit('trial:leave', {});
    return true;
  }

  /* ---- door */
  function begin() {
    if (!stage || !['card', 'clear', 'door'].includes(phase)) return { ok: false, reason: 'state' };
    if (!data[String(n)].attuned) { const r = startAttune(); return { ...r, attune: true }; } // the first attempt goes through "Check your tools"
    if (getState() === 'stopped') { setCover({ n, deaths: data[String(n)].deaths, room: 0, rest: false, still: false, kind: 'begin' }); reloadPage(); return { ok: true, reload: true }; }
    enterDoor(false);
    return { ok: true };
  }
  function enterDoor(quick) {
    phase = 'door'; quickBeat = quick; beatAt = null; doorOpen = false;
    ensureLoop();
    emit('trial:door', { n, open: false });
  }
  function doorTick(now) {
    const open = getState() === 'ready';
    if (open !== doorOpen) { doorOpen = open; emit('trial:door', { n, open }); }
    if (!open) { beatAt = null; return; }
    if (beatAt === null) beatAt = now;
    if (now - beatAt >= (quickBeat ? RESTART_BEAT_MS : READY_BEAT_MS)) startRun(now);
  }

  /* ---- run */
  function validatePaste(text) {
    const r = inspectReport(text);
    if (!r.ok) return false;
    const s = String(text);
    if (s.includes(`/api/orders/${word}`)) return true;
    return opts.pasteProof === 'status' ? (s.includes('503') && s.includes('POST')) : false;
  }
  function startRun(now) {
    attempt = data[String(n)].deaths + 1;
    word = WORDS[attempt % WORDS.length];
    judge = createJudge(stage, { noShortcut: data.shortcutOk === false, validatePaste });
    judge.start(snap());
    scene.build(stage, data[String(n)].deaths);
    fired = new Set();
    anchor = now; frozen = null; reloaded = false;
    phase = 'run';
    clearCover();
    emit('trial:start', { n, attempt });
    emit('trial:room', { n, room: 1 });
    wireArena(); wirePaste();
    runScene(0);
  }
  /* the planted dead button has no handler on purpose; every click is judged here */
  function wireArena() { const a = scene.arena; if (a) a.addEventListener('click', onArenaClick); }
  function wirePaste() { const box = scene.pasteBox; if (box) bindPasteGate(box); }
  function onArenaClick(e) {
    if (phase !== 'run') return;
    const el = e.target && e.target.closest ? e.target : null;
    if (!el) return;
    const tt = clock.now() - anchor;
    const dec = el.closest('[data-decoy]');
    if (dec) { handle(judge.click(tt, { decoy: dec.getAttribute('data-decoy') }), tt); return; }
    if (el.closest('#next')) handle(judge.click(tt, { id: 'next' }), tt);
  }
  function runScene(tt) {
    for (let i = 0; i < stage.scene.length; i++) {
      if (fired.has(i)) continue;
      const ev = stage.scene[i];
      const et = effTime(ev);
      if (et > tt) continue;
      fired.add(i);
      const r = scene.apply(ev, et, false);
      if (r && r.tell) emit('trial:tell', { n, cls: r.tell });
    }
    scene.tick(tt);
  }
  function observeRun(now) {
    if (phase !== 'run' || frozen !== null) return;
    const tt = now - anchor;
    handle(judge.step(tt, snap()), tt);
    if (phase === 'run') runScene(tt);
  }
  function handle(events, tt) {
    for (const ev of events) {
      if (ev.type === 'ok') emit('trial:ok', { n, tool: ev.action, points: ev.points, id: ev.id });
      else if (ev.type === 'room') {
        scene.setRoom(ev.room); wirePaste();
        const s = data[String(n)];
        if (ev.room > s.bestRoom) { s.bestRoom = ev.room; save(); }
        emit('trial:room', { n, room: ev.room });
      } else if (ev.type === 'death') { onDeath(ev); return; }
      else if (ev.type === 'clear') { onClear(ev, tt); return; }
    }
  }
  function onDeath(ev) {
    phase = 'death';
    scene.stopTimers();
    const s = data[String(n)];
    s.deaths += 1;
    if (ev.room > s.bestRoom) s.bestRoom = ev.room;
    const rest = s.deaths % TRIAL.restEvery === 0;
    const still = s.deaths >= TRIAL.stillHereAt && !data.badges.stillhere;
    if (still) data.badges.stillhere = true;
    save();
    scene.setDeaths(s.deaths);
    setCover({ n, deaths: s.deaths, room: ev.room, rest, still, kind: 'death' });
    deadAt = clock.now(); reloaded = false;
    // `cause` is for tests and scoring only: nothing in the arena or cover may show it (owner: no hints of any kind)
    emit('trial:death', { n, deaths: s.deaths, room: ev.room, cause: ev.cause, t: ev.t, rest, badge: still ? 'stillhere' : null });
  }
  function onClear(ev, tt) {
    phase = 'clear';
    stopLoop();
    const key = String(n);
    const s = data[key];
    s.clears += 1;
    const total = judge.points + TRIAL.clearBonus[key];
    if (total > data.score[key]) data.score[key] = total;
    const id = n === 6 ? 'trial6' : 'trial7';
    const badges = [id];
    data.badges[id] = true;
    if (s.deaths === 0) { const b = n === 6 ? 'nodeath6' : 'sekiro'; badges.push(b); data.badges[b] = true; }
    save();
    lastClear = { n, deaths: s.deaths, ms: ev.t, score: total, badges, noShortcut: data.shortcutOk === false };
    emit('trial:clear', lastClear);
  }

  /* ---- the loop */
  function tick() {
    const now = clock.now();
    if (phase === 'door') doorTick(now);
    else if (phase === 'run') observeRun(now);
    else if (phase === 'death') {
      if (!reloaded && now - deadAt >= RELOAD_MS && getState() !== 'recording') { reloaded = true; reloadPage(); }
    } else if (phase === 'attune') attuneTick(now);
  }

  /* ---- pause and hidden tab (design s3.4) */
  function pause(reason = 'manual') {
    if (phase !== 'run') return false;
    phase = 'paused'; pausedAt = clock.now();
    emit('trial:pause', { n, paused: true, reason });
    return true;
  }
  function resume() {
    if (phase !== 'paused') return false;
    const now = clock.now();
    const rm = judge.room;
    const def = stage.rooms.find((x) => x.room === rm);
    const rs = judge.roomStart(def);
    const start = rs === null ? 0 : rs;
    anchor = now - start;
    const mute = start + Math.max(0, pausedAt + LAG_SLOW + TOL - now);
    judge.restartRoom(rm, snap(), mute);
    scene.build(stage, data[String(n)].deaths);
    wireArena();
    scene.setRoom(rm); wirePaste();
    fired = new Set();
    stage.scene.forEach((ev, i) => { const et = effTime(ev); if (et < start) { fired.add(i); scene.apply(ev, et, true); } });
    phase = 'run';
    emit('trial:pause', { n, paused: false, reason: 'resume' });
    emit('trial:room', { n, room: rm });
    runScene(start);
    return true;
  }
  function onVisibility() {
    if (phase !== 'run') return;
    const now = clock.now();
    if (doc.hidden) {
      if ((stage.hiddenSafeRooms || []).includes(judge.room)) frozen = now;
      else pause('hidden');
    } else if (frozen !== null) {
      anchor += now - frozen;
      frozen = null;
      judge.extend(judge.room, LAG_SLOW);
    }
  }

  /* ---- paste (stage 7): the paste event only, never a clipboard read; the text is not kept */
  function pasteText(text) {
    if (phase !== 'run') return { ok: false, reason: 'not-run' };
    const tt = clock.now() - anchor;
    const r = judge.paste(tt, text);
    let heading = '';
    let lines = 0;
    if (r.ok) { const i = inspectReport(text); heading = i.heading; lines = i.lines; }
    handle(r.events, tt);
    // only a valid report is announced (heading and line count, never the text); a junk or stale paste is just ignored
    if (r.ok) emit('trial:pasted', { heading, lines });
    else emit('trial:notyet', { reason: r.reason || 'format' });
    return { ok: r.ok, reason: r.reason || null, heading, lines };
  }
  function bindPasteGate(textarea, onResult) {
    if (unbindPaste) unbindPaste();
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
    unbindPaste = () => { textarea.removeEventListener('paste', onPaste); unbindPaste = null; };
    return unbindPaste;
  }

  /* ---- attunement (the bonfire; design s4) */
  function startAttune() {
    if (!stage || !['card', 'attune'].includes(phase)) return { ok: false, reason: 'state' };
    attune = makeAttune({});
    attune.start(snap());
    attuneState = attune.view();
    phase = 'attune'; anchor = clock.now();
    ensureLoop();
    emit('trial:attune', { step: 1, ok: false });
    return { ok: true };
  }
  function attuneTick(now) {
    const evs = attune.step(now - anchor, snap());
    for (const ev of evs) {
      if (ev.type === 'step') {
        if (ev.step === 3 && ev.ok && data.shortcutOk !== false) { data.shortcutOk = true; save(); }
        emit('trial:attune', { step: ev.step, ok: ev.ok });
      } else if (ev.type === 'warn') emit('trial:attune', { step: ev.step, ok: false, warn: ev.key });
      else if (ev.type === 'offer') emit('trial:attune', { step: 3, ok: false, offer: ev.key });
      else if (ev.type === 'done') {
        data['6'].attuned = true; data['7'].attuned = true; save();
        stopLoop(); phase = 'card';
        emit('trial:attune', { step: 6, ok: true, done: true });
      }
    }
    attuneState = attune.view();
  }
  /** The game's own buttons on the attunement screen: "Fire a glitch" (POST /api/sync 503) and "Fire noise" (POST /api/telemetry 500). */
  function fire(kind) {
    const url = kind === 'glitch' ? '/api/sync' : kind === 'noise' ? '/api/telemetry' : null;
    if (!url) return false;
    try { const p = doFetch(url, { method: 'POST', cache: 'no-store' }); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    return true;
  }
  /** Step 3 failed twice: the player may allow starting stage 7 without the shortcut (the badge then says so). */
  function allowNoShortcut() {
    data.shortcutOk = false; save();
    if (attune) attune.allowNoShortcut();
    return true;
  }

  /* ---- restart (reload under the cover) */
  function restoreRestart() {
    const c = readCover();
    if (!c) return false;
    const r = open(c.n);
    if (!r.ok) { clearCover(); return false; }
    if (phase !== 'door') { clearCover(); return false; }
    return true;
  }

  function reset() {
    try { if (storage) storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    data = freshData(); clearCover();
    stopLoop(); scene.clear(); phase = 'idle'; stage = null; judge = null; n = 0;
    emit('trial:reset', {});
    return true;
  }
  function setCalm(v) { calm = !!v; const a = scene.arena; if (a) a.setAttribute('data-calm', calm ? '1' : '0'); }

  function view() {
    const key = String(n);
    const s = n ? data[key] : freshStage();
    const u = unlocked();
    return {
      status: phase, n, room: judge ? judge.room : 0, rooms: stage ? stage.rooms.length : 0, deaths: s.deaths, bestRoom: s.bestRoom,
      attuned: s.attuned, badges: { ...data.badges }, score: { ...data.score }, qaw: getState(),
      unlocked: { ...u }, door: doorOpen, attempt, shortcutOk: data.shortcutOk, attune: attuneState,
      cover: readCover(), last: lastClear, t: phase === 'run' ? (frozen !== null ? frozen : clock.now()) - anchor : 0,
    };
  }
  function destroy() { stopLoop(); if (unbindPaste) unbindPaste(); scene.clear(); subs.clear(); phase = 'idle'; }

  return { open, attune: startAttune, begin, leave, pause, resume, pasteText, bindPasteGate, view, on, destroy, fire, allowNoShortcut, restoreRestart, reset, setCalm };
}

export default { createTrial, createJudge, makeObserver, readStars, unlockedStages };
