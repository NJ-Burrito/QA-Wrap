/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt, node-only half of the harness (lane E). No browser: engine.js, scoring.js and the level modules are plain ES
 * modules whose outside world is injected (storage, clock, doc, fetch, signals), so they run here exactly as in the page.
 *
 *   makeEngine({ levels, qaw, counts })  the real createEngine() on a fake clock, an in-memory storage and stub levels,
 *                                        with every emitted event collected in `log` as { type, ...payload }
 *   stubLevels()                         five level stand-ins: the test emits `catch` / `bonus` / `wrong` through the ctx the
 *                                        engine hands to arm(), and flips proveSignal / signalAvailable per level
 *   fakeClock()                          now / setTimeout / setInterval with advance(ms) that fires due timers in order
 *
 * The real level modules (levels/l<n>.js) are tested through their pure detect() in test-game-levels.mjs and through a real
 * DOM in test-game-levels-dom.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXT } from './lib-paths.mjs';

export { EXT };
export const GAME = path.join(EXT, 'game');
export const STORE_KEY = 'bughunt.v1';
export const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));
export const has = (...rel) => rel.every((r) => fs.existsSync(path.join(GAME, r)));
export const imp = (rel) => import(pathToFileURL(path.join(GAME, rel)).href);

/** Every text file under game/ (audio binaries skipped), as [relPath, source]. */
export function gameSources(dir = GAME, base = GAME) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...gameSources(full, base));
    else if (/\.(?:m?js|css|html|json|md|svg)$/.test(e.name)) out.push([path.relative(base, full).replace(/\\/g, '/'), fs.readFileSync(full, 'utf8')]);
  }
  return out;
}

export function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, dump: () => Object.fromEntries(m) };
}

/** A manual clock: timers run only inside advance(). */
export function fakeClock(t0 = 100000) {
  let t = t0; let seq = 0;
  const timers = new Map();
  const add = (fn, ms, every) => { const id = ++seq; timers.set(id, { fn, at: t + Math.max(0, ms), every }); return id; };
  return {
    now: () => t,
    setTimeout: (fn, ms) => add(fn, ms, 0),
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearInterval: (id) => { timers.delete(id); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x];
        if (!next) break;
        const [id, x] = next;
        t = Math.max(t, x.at);
        if (x.every) x.at += x.every; else timers.delete(id);
        x.fn();
      }
      t = end;
    },
    get pending() { return timers.size; },
  };
}

/** Five stand-in levels. `ctxs[n]` is the ctx engine.js passed to arm(); `flags[n]` drives proveSignal / signalAvailable. */
export function stubLevels(real = {}) {
  const ctxs = {}; const flags = {};
  const mods = {};
  for (let n = 1; n <= 5; n++) {
    flags[n] = { prove: false, signal: true };
    // chips and catchFeature are the real levels' (the feature map is data, not behaviour); everything else is a stand-in
    mods[n] = { id: `l${n}`, n, chips: real[n]?.chips || [], catchFeature: real[n]?.catchFeature, mount() {}, arm(ctx) { ctxs[n] = ctx; }, dispose() {}, proveSignal: () => flags[n].prove, signalAvailable: () => flags[n].signal };
  }
  return { mods, ctxs, flags };
}

const fakeRoot = { replaceChildren() {}, append() {}, contains: () => false };

/**
 * The real engine on stand-ins. Returns { engine, log, clk, storage, L, state, counts, at(k, {play}), ev(type) }.
 *   state.v  the qawState the engine reads;  counts.v  { notes, shots } or null
 */
export async function makeEngine({ qaw = 'ready', counts = { notes: 0, shots: 0 }, storageSeed } = {}) {
  const { createEngine } = await imp('engine.js');
  const clk = fakeClock();
  const storage = memStorage();
  if (storageSeed) storage.setItem(STORE_KEY, JSON.stringify(storageSeed));
  const real = {};
  for (let n = 1; n <= 5; n++) { const m = await imp(`levels/l${n}.js`); real[n] = { chips: m.chips || m.default?.chips, catchFeature: m.default?.catchFeature }; }
  const L = stubLevels(real);
  const state = { v: qaw };
  const cnt = { v: counts };
  const log = [];
  const engine = createEngine({
    storage, clock: clk, levels: L.mods, root: fakeRoot, doc: null, win: null,
    qawState: () => state.v, qawCounts: () => cnt.v, fetch: async () => ({ status: 200, ok: true }),
  });
  engine.on('*', (type, payload) => log.push({ type, ...payload }));
  const ev = (type) => log.filter((e) => e.type === type);
  /** Walk to level k: catch and finish the levels before it when `score` is true (so the score is above 0), else skip them. */
  async function at(k, { play = true, score = false } = {}) {
    engine.start();
    for (let j = 1; j < k; j++) {
      if (score && j === 1) { await engine.go(); clk.advance(5000); L.ctxs[1].emit({ type: 'catch' }); L.flags[1].prove = true; clk.advance(500); engine.finish(); } else engine.skip();
      engine.next();
    }
    if (play) await engine.go();
    return engine;
  }
  return { engine, log, clk, storage, L, state, counts: cnt, ev, at };
}

/** The scoring table (RULES etc.) from game/scoring.js. */
export const loadScoring = () => imp('scoring.js');
export const loadLevel = async (n) => { const m = await imp(`levels/l${n}.js`); return m.default && typeof m.default === 'object' ? { ...m.default, ...m } : m; };
