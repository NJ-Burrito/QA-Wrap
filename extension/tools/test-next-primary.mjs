/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R1 (autopilot-1011, REQ-P1-1): one filled primary per screen, and its label is what next(state) says.
 *
 *   node tools/test-next-primary.mjs
 *
 * Part 1 evaluates popup/next.js in Node. Part 2 drives the real popup (348x600) through the five screens: asleep, recording,
 * done with no problems, idle, done with problems. On each screen exactly one visible [data-primary] and exactly one visible
 * .btn-primary exist, they are the same element, and its data-primary value (the label key) equals next(state).key.
 *
 * This file also exports `launchPopupHarness()`, the one headed browser the other POP rule tests (R2, R7, R8, R10) reuse; it
 * runs its checks only when it is the entry point. Headed on the secondary monitor, Playwright clicks only, one browser,
 * closed on exit, the profile goes to the recycle bin.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { TRASH } from './lib-trash.mjs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { EXT, REPO } from './lib-paths.mjs';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from './lib-granted.mjs';

export const STATES = ['asleep', 'recording', 'done-clean', 'idle', 'recording-2', 'done-problems'];

const PAGE = `<!doctype html><meta charset="utf-8"><title>POP fixture</title><body><h1>Fixture</h1>
<button id="boom" onclick="fetch('/api/boom').then(r=>{document.getElementById('r').textContent='status '+r.status})">Break it</button><p id="r"></p></body>`;

/** Evaluate a classic popup script in a bare sandbox and hand back the pure functions it defines. */
export function loadClassic(file) {
  const sandbox = { console, Date, Math, Number, String, Object, Array };
  vm.createContext(sandbox);
  const probe = '\n;this.__exports = { next: typeof next === "function" ? next : null, fmtElapsed: typeof fmtElapsed === "function" ? fmtElapsed : null, doneModel: typeof doneModel === "function" ? doneModel : null };';
  vm.runInContext(fs.readFileSync(path.join(EXT, 'popup', file), 'utf8') + probe, sandbox);
  return sandbox.__exports;
}

/**
 * Until lane INT merges work/sdlc/build/i18n/*.json into platform/i18n/*.json, the copy under test gets the same merge, so the
 * popup shows its real words rather than raw keys. A key already in the dictionary is never replaced, except by `__override`.
 */
function mergeFragments(extDir) {
  const dir = path.join(REPO, 'work', 'sdlc', 'build', 'i18n');
  if (!fs.existsSync(dir)) return;
  for (const lang of ['en', 'ar']) {
    const file = path.join(extDir, 'platform', 'i18n', `${lang}.json`);
    const dict = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(`.${lang}.json`))) {
      const { __override = {}, ...add } = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      for (const [k, v] of Object.entries(add)) if (!(k in dict)) dict[k] = v;
      Object.assign(dict, __override);
    }
    fs.writeFileSync(file, JSON.stringify(dict));
  }
}

/**
 * One headed browser with the popup at 348x600 and a fixture page to test. `to(name)` walks the popup through STATES in order.
 * @param {{ label?: string, width?: number, height?: number }} [o]
 */
export async function launchPopupHarness({ label = 'pop1011', width = 348, height = 600 } = {}) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"boom"}'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `uqa-${label}-`));
  purgeWorkerCache(profile);
  const ext = grantedExtension({ label });
  mergeFragments(ext);
  const context = await chromium.launchPersistentContext(profile, launchOptions(ext, { width: 1100, height: 800, headed: true }));
  const topmost = await keepOnTop(context);
  const errors = [];
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  await awaitSiteScripts(worker);
  const target = await context.newPage();
  await target.goto(origin, { waitUntil: 'domcontentloaded' });
  const popup = await context.newPage();
  popup.on('pageerror', (e) => errors.push(`popup: ${e.message}`));
  await popup.setViewportSize({ width, height });
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
  await popup.evaluate(() => { window.close = () => {}; });
  // Everything the popup writes to the clipboard or opens is logged here.
  await popup.evaluate(() => {
    window.__log = { clip: [], tabs: [] };
    navigator.clipboard.writeText = async (s) => { window.__log.clip.push(String(s)); };
    const create = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = (...a) => { window.__log.tabs.push(JSON.stringify(a[0] || {})); return create(...a); };
  });
  let at = 0;
  const steps = {
    async recording() { await popup.click('#start'); await popup.waitForSelector('#step-live:not([hidden])', { timeout: 20000 }); await popup.waitForTimeout(1200); },
    async 'done-clean'() {
      await popup.click('#stop');
      await popup.waitForSelector('#step-done:not([hidden])', { timeout: 20000 });
      await popup.waitForSelector('#copy-report:not([disabled])');
      await popup.waitForFunction(() => !document.getElementById('done-clean').hidden, null, { timeout: 15000 });
    },
    async idle() { await popup.click('#new-session'); await popup.waitForSelector('#step-idle:not([hidden])'); },
    async 'recording-2'() {
      await steps.recording();
      await target.bringToFront().catch(() => {});
      await target.click('#boom');
      await target.waitForFunction(() => document.getElementById('r').textContent.startsWith('status'));
      await popup.waitForTimeout(2500);
    },
    async 'done-problems'() {
      await popup.click('#stop');
      await popup.waitForSelector('#step-done:not([hidden])', { timeout: 20000 });
      await popup.waitForSelector('#copy-report:not([disabled])');
      await popup.waitForFunction(() => Number(document.getElementById('stat-problems').textContent) > 0, null, { timeout: 15000 });
    },
  };
  return {
    popup, target, context, errors, origin, id,
    async to(name) {
      const want = STATES.indexOf(name);
      if (want < 0) throw new Error(`unknown state ${name}`);
      while (at < want) { at++; await steps[STATES[at]](); }
      await popup.waitForTimeout(300);
    },
    async close() {
      await topmost.release?.().catch(() => {});
      await context.close().catch(() => {});
      server.close();
      spawnSync('python', [TRASH, profile], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let passed = 0;
  const failures = [];
  const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };

  /* Part 1: the pure function. */
  const { next } = loadClassic('next.js');
  const labels = { asleep: 'popup.onboard.testSite', idle: 'popup.session.start', recording: 'popup.live.stop', done: 'popup.done.copyReport' };
  for (const [state, key] of Object.entries(labels)) check(next(state).key === key, `next('${state}') says ${key}`);
  check(new Set(Object.keys(labels).map((s) => next(s).key)).size === 4, 'four screens, four different labels');
  check(next({ recording: true }).id === 'stop' && next({ done: true }).id === 'copy-report' && next({ awake: true }).key === labels.idle && next({}).key === labels.asleep, 'next() reads a state object too');

  /* Part 2: the real popup. */
  let h;
  let code = 1;
  try {
    h = await launchPopupHarness({ label: 'pop-r1' });
    const screen = { asleep: 'asleep', recording: 'recording', 'done-clean': 'done', idle: 'idle', 'done-problems': 'done' };
    for (const name of ['asleep', 'recording', 'done-clean', 'idle', 'done-problems']) {
      await h.to(name === 'done-problems' ? 'recording-2' : name);
      if (name === 'done-problems') await h.to('done-problems');
      const seen = await h.popup.evaluate(() => {
        const shown = (e) => !!e.offsetParent && e.checkVisibility({ visibilityProperty: true }); // a closed <details> hides by content-visibility, which offsetParent does not see
        const prim = [...document.querySelectorAll('[data-primary]')].filter(shown);
        const fill = [...document.querySelectorAll('.btn-primary')].filter(shown);
        return { prim: prim.length, fill: fill.length, same: prim.length === 1 && fill.length === 1 && prim[0] === fill[0], key: prim[0]?.dataset.primary, id: prim[0]?.id, text: prim[0]?.textContent.trim() };
      });
      const want = next(screen[name]);
      check(seen.prim === 1 && seen.fill === 1 && seen.same, `${name}: one visible [data-primary], one visible .btn-primary, the same element`, JSON.stringify(seen));
      check(seen.key === want.key && seen.id === want.id, `${name}: the label key is next('${screen[name]}')`, JSON.stringify(seen));
    }
    check(await h.popup.evaluate(() => !document.getElementById('awake-pill')), 'the Awake pill (shrink timer) is gone');
    check(h.errors.length === 0, 'no page error in the popup', h.errors.join(' | '));
    code = failures.length ? 1 : 0;
  } catch (err) {
    console.log(`  FAIL  run aborted: ${err.stack || err.message}`);
  } finally {
    await h?.close();
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(code);
}
