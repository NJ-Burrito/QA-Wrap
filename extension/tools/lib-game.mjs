/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt test harness (lane E, work/sdlc/design/DESIGN-bug-hunt.md section 12). One place for what the headless game
 * suites share, so the DOM hooks they assume are written down once:
 *
 *   body         [data-screen] title | card | play | finale; the level-clear dialog is #ov-clear over play; level = #hudLevel
 *   buttons      #btnStart #btnGo #btnCardSkip #btnSkip #btnPrimary #btnNext #btnSettings #btnSetDone #btnPause #btnResume
 *                #btnCopyScore #btnAgain;  primary = the single [data-primary].btn-primary (game.js claims it among [data-prim-cand])
 *   overlays     #ov-clear #ov-settings #ov-pause;  captions #caption[role=status] > #captionText;  finale #pasteBox #pasteResult
 *   storage       localStorage "bughunt.v1" { prefs: { lang, theme, sound, voice, volume, calm }, ... }   (section 10)
 *
 * The page is served by the game's own server (`createGameServer({ port })`, section 8) on a free loopback port, so a test
 * never touches 4173. Chromium is headless here; the one headed suite is test-game-live.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { EXT } from './lib-paths.mjs';

export { EXT };
export const GAME = path.join(EXT, 'game');
export const STORE_KEY = 'bughunt.v1';
export const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));

/** Files that must exist before a suite can say anything; returns the missing ones. */
export const missing = (...rel) => rel.filter((r) => !fs.existsSync(path.join(GAME, r)));

/** The game server on a free loopback port. `requests` is every request the server's onRequest hook saw. */
export async function startGame(options = {}) {
  const mod = await import(pathToFileURL(path.join(GAME, 'server.mjs')).href);
  const requests = [];
  const server = mod.createGameServer({ port: 0, onRequest: (r) => requests.push(r), ...options });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  return { server, port, requests, origin: `http://localhost:${port}`, close: () => new Promise((ok) => server.close(ok)) };
}

export const launch = () => chromium.launch({ headless: true });

/**
 * A page on the game with preferences seeded before any script runs.
 *   lang 'en'|'ar'   theme 'dark'|'light'|'auto'   calm   reducedMotion   viewport   init: extra init-script source
 *   before(context): runs before the page opens (context.route(...) goes here)
 *   audio: 'real' (default) | 'blocked' (every /audio/** is a 404, i.e. no voice file rendered yet)
 */
export async function openGame(browser, g, { lang = 'en', theme = 'dark', calm = false, reducedMotion = 'no-preference', viewport = { width: 1280, height: 800 }, colorScheme, init = '', audio = 'real', path: urlPath = '/', before } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion, colorScheme: colorScheme || (theme === 'light' ? 'light' : 'dark'), locale: lang === 'ar' ? 'ar' : 'en-US' });
  const errors = [];
  const reqs = [];
  const prefs = JSON.stringify({ prefs: { lang, theme, sound: true, voice: true, volume: 0.6, calm } });
  await context.addInitScript(`try { if (!localStorage.getItem(${JSON.stringify(STORE_KEY)})) localStorage.setItem(${JSON.stringify(STORE_KEY)}, ${JSON.stringify(prefs)}); } catch {}\n${init}`);
  if (audio === 'blocked') await context.route('**/audio/**', (r) => r.fulfill({ status: 404, body: 'no' }));
  if (before) await before(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => reqs.push({ url: r.url(), method: r.method() }));
  await page.goto(g.origin + urlPath, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btnStart', { state: 'visible', timeout: 15000 });
  return { page, context, errors, reqs, close: () => context.close() };
}

/** The screen the player sees: title | card | play | clear (the dialog over play) | finale; and the level 1..5 (0 on title and finale). */
export const screenOf = (page) => page.evaluate(() => {
  const clear = document.getElementById('ov-clear');
  const raw = (document.getElementById('hudLevel')?.textContent || '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660));
  const level = Number((raw.match(/\d/) || [0])[0]);
  const screen = clear && !clear.hidden ? 'clear' : document.body.dataset.screen || '';
  return { screen, level: screen === 'title' || screen === 'finale' ? 0 : level };
});

/** Press through the game until the screen (and level) match. Uses only the buttons a player has; never a test hook. */
export async function reach(page, screen, level = 0) {
  for (let i = 0; i < 40; i++) {
    const s = await screenOf(page);
    if (s.screen === screen && (!level || s.level === level)) return s;
    if (s.screen === 'finale') throw new Error(`finale reached while looking for ${screen}:${level}`);
    const goOn = s.screen === 'card' && screen === 'play' && (!level || s.level === level);
    const sel = { title: '#btnStart', clear: '#btnNext', card: goOn ? '#btnGo' : '#btnCardSkip', play: '#btnSkip' }[s.screen];
    if (!sel) throw new Error(`unknown screen "${s.screen}" while looking for ${screen}:${level}`);
    await page.click(sel);
    await page.waitForTimeout(220);
  }
  throw new Error(`could not reach ${screen}:${level}`);
}

/** Open and close the Settings sheet and the Pause overlay (buttons only). */
export const openSettings = async (page) => { await page.click('#btnSettings'); await page.waitForSelector('#ov-settings:not([hidden])'); };
export const closeSettings = async (page) => { await page.click('#btnSetDone'); await page.waitForSelector('#ov-settings', { state: 'hidden' }); };
