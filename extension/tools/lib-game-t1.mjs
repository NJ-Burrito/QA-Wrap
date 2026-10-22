/* QA Wrap - Bug Hunt hard trials, lane T1 test kit (not a suite). Node only.
 *   drive(stage, steps, endMs, opts)  judge-level virtual run: steps = [[tMs, patch]], ticked every 50 ms like the real loop
 *   rig(opts)                         a whole createTrial on a fake clock, fake DOM, fake storages and fake signals
 * patch = { s: state, inc: {sig: n}, set: {sig: n}, click: 'next' | {decoy: name}, paste: text } */
import { imp, fakeClock, fakeDoc, fakeWin, memStorage, FakeEl } from './lib-game-b.mjs';

export const trialMod = await imp('trial.js');
export const t6 = (await imp('trials/t6.js')).default;
export const t7 = (await imp('trials/t7.js')).default;
export const attuneMod = await imp('trials/attune.js');
export const zero = () => ({ notes: 0, shots: 0, shortcut: 0, expected: 0, marks: 0, buffer: 0 });
export const REPORT = (word) => `# Checkout failed after the order\n\n## Steps to reproduce\n1. Place an order\n\n| Problems | 2 |\n\nPOST /api/orders/${word} 503\n`;

/** Judge-level run. Returns { dead, cleared, clearT, events, points }. */
export function drive(stage, steps, endMs, opts = {}) {
  const j = trialMod.createJudge(stage, { validatePaste: (txt) => String(txt).includes(`/api/orders/${opts.word || 'basil'}`) && trialMod.WORDS.length === 12, ...opts });
  const snap = { state: opts.state0 || 'ready', counts: zero() };
  j.start({ state: snap.state, counts: { ...snap.counts } });
  const events = [];
  const queue = [...steps].sort((a, b) => a[0] - b[0]);
  let clearT = null;
  const take = (evs, t) => { for (const e of evs) { events.push({ ...e, at: t }); if (e.type === 'clear') clearT = e.t; } };
  for (let t = 0; t <= endMs && j.status === 'run'; t += 50) {
    while (queue.length && queue[0][0] <= t) {
      const p = queue.shift()[1];
      if (p.s) snap.state = p.s;
      for (const [k, v] of Object.entries(p.inc || {})) snap.counts[k] += v;
      for (const [k, v] of Object.entries(p.set || {})) snap.counts[k] = v;
      if (p.click) take(j.click(t, typeof p.click === 'string' ? { id: p.click } : p.click), t);
      if (p.paste !== undefined) { const r = j.paste(t, p.paste); take(r.events, t); events.push({ type: 'paste-result', ok: r.ok, reason: r.reason, at: t }); }
    }
    if (j.status !== 'run') break;
    take(j.step(t, { state: snap.state, counts: { ...snap.counts } }), t);
  }
  return { dead: j.dead, cleared: j.status === 'clear', clearT, events, points: j.points, status: j.status, judge: j };
}

/** A perfect player at judge level (stage ms). */
export const perfect6 = () => [
  [5000, { s: 'recording', inc: { buffer: 1 } }], [18500, { inc: { shots: 1 } }], [23000, { click: 'next' }], [28000, { inc: { notes: 1 } }],
  [41500, { inc: { expected: 1 } }], [54000, { s: 'stopped' }],
];
export const perfect7 = (word = 'basil') => [
  [3000, { s: 'recording' }], [4500, { inc: { shortcut: 1 } }], [13500, { inc: { expected: 1 } }], [20500, { inc: { expected: 1 } }], [23000, { s: 'stopped' }],
  [34000, { s: 'recording', inc: { buffer: 1 }, set: { notes: 0, shots: 0, marks: 0, shortcut: 0 } }], [50000, { click: 'next' }], [55000, { inc: { notes: 1 } }],
  [68000, { inc: { shots: 1 } }], [73000, { inc: { marks: 1 } }], [76000, { s: 'stopped' }], [90000, { paste: REPORT(word) }],
];

/** The whole trial on a virtual clock. */
export function rig(o = {}) {
  const clock = fakeClock(1000);
  const doc = fakeDoc();
  const win = fakeWin();
  const storage = o.storage || memStorage();
  const session = o.session || memStorage();
  if (!o.noStars) storage.setItem('bughunt.v1', JSON.stringify({ stars: { l1: o.stars || 3, l2: o.stars || 3, l3: o.stars || 3, l4: o.stars || 3, l5: o.stars || 3 } }));
  if (o.attuned !== false && !storage.getItem('bughunt.trial.v1')) {
    const st = { deaths: 0, bestRoom: 0, clears: 0, attuned: true };
    storage.setItem('bughunt.trial.v1', JSON.stringify({ '6': { ...st, clears: o.clears6 || 0 }, '7': { ...st }, badges: {}, score: { '6': 0, '7': 0 }, shortcutOk: o.shortcutOk === undefined ? null : o.shortcutOk }));
  }
  const root = new FakeEl('div', doc);
  const qaw = { state: o.state || 'ready', counts: zero() };
  const fetched = [];
  const reloads = [];
  const log = [];
  const trial = trialMod.createTrial({
    doc, win, clock, storage, session, root, t: (k) => k,
    getState: () => qaw.state, getCounts: () => ({ ...qaw.counts }),
    fetch: (u, f) => { fetched.push([f && f.method, u]); return Promise.resolve({}); },
    reload: () => { reloads.push(clock.now()); },
    stages: o.stages,
  });
  const r = { clock, doc, win, storage, session, root, qaw, fetched, reloads, log, trial, t0: null, dead: null };
  trial.on('*', (type, p) => { log.push({ type, p, at: clock.now() }); if (type === 'trial:start') r.t0 = clock.now(); });
  r.tt = () => trial.view().t;
  r.find = (sel) => root.querySelector(sel);
  r.click = (sel) => { const el = r.find(sel); if (!el) throw new Error(`no ${sel}`); el.fire('click'); };
  r.paste = (text) => { const ta = r.find('#trial-paste'); if (!ta) throw new Error('no paste box'); ta.fire('paste', { clipboardData: { getData: () => text }, preventDefault() {} }); return ta; };
  r.until = (pred, limitMs = 20000) => { for (let i = 0; i < limitMs / 50 && !pred(); i++) clock.advance(50); return pred(); };
  r.status = () => trial.view().status;
  r.types = (type) => log.filter((e) => e.type === type);
  /** open + begin + wait for the run to start (the door opens on its own: the signal is 'ready') */
  r.startRun = async (n) => {
    const res = await trial.open(n);
    if (!res.ok) return res;
    const b = trial.begin();
    if (!b.ok) return b;
    r.until(() => r.status() === 'run', 5000);
    return { ok: r.status() === 'run' };
  };
  /** Play actions [{at, do}] (stage ms) until the status leaves 'run' or limitMs. */
  r.play = (actions, limitMs = 130000) => {
    const todo = actions.map((a) => ({ ...a, done: false }));
    for (let i = 0; i < limitMs / 50 && r.status() === 'run'; i++) {
      clock.advance(50);
      const tt = r.tt();
      for (const a of todo) if (!a.done && tt >= a.at) { a.done = true; a.do(r); }
    }
    return r.status();
  };
  return r;
}

/** Scripted perfect player for the trial-level rig. */
export const act6 = () => [
  { at: 5000, do: (r) => { r.qaw.state = 'recording'; r.qaw.counts.buffer += 1; } },
  { at: 18500, do: (r) => { r.qaw.counts.shots += 1; } },
  { at: 23000, do: (r) => r.click('#next') },
  { at: 28000, do: (r) => { r.qaw.counts.notes += 1; } },
  { at: 41500, do: (r) => { r.qaw.counts.expected += 1; } },
  { at: 54000, do: (r) => { r.qaw.state = 'stopped'; } },
];
export const act7 = (word = 'basil') => [
  { at: 3000, do: (r) => { r.qaw.state = 'recording'; } }, { at: 4500, do: (r) => { r.qaw.counts.shortcut += 1; } },
  { at: 13500, do: (r) => { r.qaw.counts.expected += 1; } }, { at: 20500, do: (r) => { r.qaw.counts.expected += 1; } }, { at: 23000, do: (r) => { r.qaw.state = 'stopped'; } },
  { at: 34000, do: (r) => { r.qaw.state = 'recording'; r.qaw.counts.buffer += 1; Object.assign(r.qaw.counts, { notes: 0, shots: 0, marks: 0, shortcut: 0 }); } },
  { at: 50000, do: (r) => r.click('#next') }, { at: 55000, do: (r) => { r.qaw.counts.notes += 1; } },
  { at: 68000, do: (r) => { r.qaw.counts.shots += 1; } }, { at: 73000, do: (r) => { r.qaw.counts.marks += 1; } }, { at: 76000, do: (r) => { r.qaw.state = 'stopped'; } },
  { at: 90000, do: (r) => r.paste(REPORT(word)) },
];
export { fakeClock, fakeDoc, fakeWin, memStorage, FakeEl };
