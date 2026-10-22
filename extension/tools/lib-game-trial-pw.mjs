/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt hard trials, browser half of the T3 kit (headless Chromium, Playwright's own mock clock, no OS mouse).
 * Kept apart from lib-game-trial.mjs so the node-only suites never import playwright.
 *
 *   trialPage(browser, g, opts)   a page on the game with seeded storage and a mocked clock; the QA Wrap signals are written by the
 *                                 test (qaw) and survive a reload the way the extension's bridge would (stopped reads as ready,
 *                                 Expected and Buffer start again at 0)
 *   qaw(page, patch)              write dataset.qawState / qaw* counts and fire `qaw:state`
 *   drive(page, script, opts)     the scripted player of lib-game-trial.mjs against the REAL page, in mocked time
 *   roomOf(page), nowOf(page)     the room number from [data-trial-room]; the mocked performance.now()
 */
import { startGame, launch, STORE_KEY } from './lib-game.mjs';
import { TRIAL_KEY } from './lib-game-trial.mjs';

export { startGame, launch, STORE_KEY, TRIAL_KEY };

const INIT = (seed) => `(() => { try {
  const seed = ${JSON.stringify(seed)};
  if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); }
  const raw = sessionStorage.getItem('__qaw');
  if (raw) {
    const q = JSON.parse(raw);
    if (q.state === 'stopped') q.state = 'ready';
    q.expected = 0; q.buffer = 0;
    sessionStorage.setItem('__qaw', JSON.stringify(q));
    const apply = () => { const d = document.documentElement.dataset; for (const [k, v] of Object.entries(q)) { if (v === null) continue; d['qaw' + k[0].toUpperCase() + k.slice(1)] = String(v); } };
    if (document.documentElement) apply(); else document.addEventListener('DOMContentLoaded', apply);
  }
} catch (e) { /* storage blocked */ } })();`;

export function seedFor({ lang = 'en', calm = false, stars = 3, attuned = true, deaths = 0, cleared6 = false, badges = {} } = {}) {
  const main = { prefs: { lang, theme: 'dark', sound: true, voice: true, volume: 60, calm }, best: { run: 123456, l1: 40000, l2: 40000, l3: 40000, l4: 40000, l5: 40000 }, stars: { l1: stars, l2: stars, l3: stars, l4: stars, l5: stars }, stickers: {}, bonus: {} };
  const stage = (clears, d) => ({ deaths: d, bestRoom: 0, clears, attuned, causes: [] });
  return { [STORE_KEY]: JSON.stringify(main), [TRIAL_KEY]: JSON.stringify({ 6: stage(cleared6 ? 1 : 0, deaths), 7: stage(0, 0), badges, score: {}, shortcutOk: true }) };
}

/** A page on the game, clock mocked, storage seeded once per tab, QA Wrap signals under the test's control. */
export async function trialPage(browser, g, { lang = 'en', calm = false, reducedMotion = 'no-preference', viewport = { width: 1280, height: 800 }, seed, qawInit = { state: 'ready', notes: 0, shots: 0, shortcut: 0, expected: 0, noteTypes: 0, marks: 0, buffer: 0 }, spy = '' } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion, colorScheme: 'dark', locale: lang === 'ar' ? 'ar' : 'en-US' });
  const errors = []; const reqs = [];
  await context.addInitScript(INIT(seed || seedFor({ lang, calm })));
  if (spy) await context.addInitScript(spy);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => reqs.push({ url: r.url(), method: r.method() }));
  await page.clock.install({ time: new Date('2026-10-12T10:00:00Z') });
  await page.goto(g.origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btnStart', { state: 'attached', timeout: 15000 });
  await page.clock.runFor(400);
  if (qawInit) await qaw(page, qawInit);
  return { page, context, errors, reqs, close: () => context.close() };
}

/** Write the signals the extension's bridge writes (state and counts), and fire qaw:state. */
export async function qaw(page, patch) {
  await safe(page, (p) => {
    const cur = JSON.parse(sessionStorage.getItem('__qaw') || '{}');
    const q = { ...cur, ...p };
    sessionStorage.setItem('__qaw', JSON.stringify(q));
    const d = document.documentElement.dataset;
    for (const [k, v] of Object.entries(q)) { if (v === null || v === undefined) continue; d['qaw' + k[0].toUpperCase() + k.slice(1)] = String(v); }
    document.dispatchEvent(new CustomEvent('qaw:state', { detail: q.state }));
  }, patch);
}
/** page.evaluate that survives a reload in the middle (a death reloads the page): waits for the new document and tries again. */
export async function safe(page, fn, arg, fallback = null) {
  for (let i = 0; i < 40; i++) {
    try { return await page.evaluate(fn, arg); } catch (e) {
      if (!/context was destroyed|navigation|Target closed|detached/i.test(String(e.message))) throw e;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.clock.runFor(10).catch(() => {});
    }
  }
  return fallback;
}
export const readQaw = (page) => safe(page, () => JSON.parse(sessionStorage.getItem('__qaw') || '{}'), undefined, {});
export const nowOf = (page) => safe(page, () => performance.now(), undefined, 0);
export const roomOf = (page) => safe(page, () => {
  const e = document.querySelector('[data-trial-room]'); if (!e) return 0;
  const v = (e.getAttribute('data-trial-room') || e.textContent || '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660));
  const m = v.match(/\d+/); return m ? Number(m[0]) : 0;
}, undefined, 0);

/**
 * Play a lib-game-trial.mjs script against the page, in mocked time. Effects arrive after their lag, like the extension's.
 *   opts.untilSec   stop after this many stage seconds     opts.stepMs   clock step (default 50)
 *   opts.lagFast / lagSlow   seconds     opts.onStep(sec)   called after every step with the stage seconds
 *   opts.clickSel   map of action id -> selector override
 * Returns { t0, sec } (t0 = mocked now when room 1 began).
 */
export async function drive(page, script, { untilSec = 120, stepMs = 50, lagFast = 0.15, lagSlow = 1.5, onStep, report } = {}) {
  let waited = 0;
  while ((await roomOf(page)) < 1) { await page.clock.runFor(stepMs); waited += stepMs; if (waited > 20000) throw new Error('room 1 never began (door closed or the stage did not start)'); }
  const t0 = await nowOf(page);
  const pending = []; const todo = [...script].sort((a, b) => a.at - b.at);
  const later = (sec, fn) => pending.push({ due: sec, fn });
  const inc = async (k) => { const q = await readQaw(page); await qaw(page, { [k]: Number(q[k] || 0) + 1 }); };
  const startSession = async () => { await qaw(page, { notes: 0, shots: 0, shortcut: 0, noteTypes: 0, marks: 0, state: 'recording' }); };
  let sec = 0;
  while (sec < untilSec) {
    await page.clock.runFor(stepMs);
    sec = ((await nowOf(page)) - t0) / 1000;
    while (todo.length && todo[0].at <= sec + 1e-6) {
      const a = todo.shift();
      const slow = a.lag ?? lagSlow; const fast = a.lagState ?? a.lag ?? lagFast;
      switch (a.kind) {
        case 'shortcut': later(sec + (a.lagState ?? lagFast), startSession); later(sec + Math.max(a.lagCount ?? lagSlow, (a.lagState ?? lagFast) + 0.001), () => inc('shortcut')); break;
        case 'popupStart': later(sec + (a.lagState ?? lagFast), startSession); break;
        case 'buffer': later(sec + fast, async () => { await startSession(); await inc('buffer'); }); break;
        case 'shot': later(sec + slow, () => inc('shots')); break;
        case 'note': later(sec + slow, () => inc('notes')); break;
        case 'markup': later(sec + slow, () => inc('marks')); break;
        case 'notbug': later(sec + (a.lag ?? 0.05), () => inc('expected')); break;
        case 'stop': later(sec + fast, () => qaw(page, { state: 'stopped' })); break;
        case 'click': await page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); }, a.sel); break;
        case 'paste': await page.evaluate((text) => {
          const ta = document.querySelector('#trial-paste'); const dt = new DataTransfer(); dt.setData('text/plain', text); ta.focus();
          ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }, a.text ?? report ?? ''); break;
        default: throw new Error('unknown action ' + a.kind);
      }
    }
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].due <= sec + 1e-6) { const [p] = pending.splice(i, 1); await p.fn(); }
    if (onStep && (await onStep(sec)) === 'stop') break;
  }
  return { t0, sec };
}

/** The planted word of this attempt, from the requests the page made. */
export const orderWord = (reqs) => { const r = [...reqs].reverse().find((x) => /\/api\/orders\/[a-z]+/.test(x.url)); return r ? /\/api\/orders\/([a-z]+)/.exec(r.url)[1] : 'almond'; };

/** Step the mocked clock until pred() is true (pred runs in node and may be async); false after maxMs. */
export async function stepUntil(page, pred, maxMs = 5000, stepMs = 50) {
  for (let t = 0; t <= maxMs; t += stepMs) { if (await pred()) return true; await page.clock.runFor(stepMs); }
  return pred();
}
