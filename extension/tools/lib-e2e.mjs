/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The real-extension harness (sdlc-1014b): the one base that UI rule tests run on.
 *
 * Why it exists: the popup suites ran on a fixture page, a manifest edited to hold the site grant, a stubbed `chrome`, or a
 * static read of popup.html. Each of those is a good unit test and none of them is the product, which is how 3.5.1 shipped a
 * dead side-panel button on Opera GX, an error on the idle card and "Untitled session" on the done card with every suite green.
 * This loads the BUILT folder (dist/<browser>) unmodified in a real, headed browser and hands back the real popup pages.
 *
 *   const h = await launchE2E({ engine: 'chrome' | 'opera', lang: 'en' | 'ar', ext })
 *   h.practice()           the packaged practice page in a tab
 *   h.popup({ surface })   the real popup page (surface 'float' is what a toolbar press opens) at a given size
 *   h.worker, h.id, h.context, h.faults   (every page error and console.error seen, with the page it came from)
 *   h.close()              closes the browser, trashes the profile
 *
 * Headed on the SECONDARY monitor (lib-launch / lib-test-window), Playwright only (never the OS mouse), one browser,
 * closed by close(). `engine: 'opera'` needs the installed Opera GX (QAW_OPERA_PATH, else %LOCALAPPDATA%\Programs\Opera GX);
 * h.available is false and launchE2E returns null when it is not there, so a caller says "not verified on Opera GX".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { DIST } from './lib-paths.mjs';
import { launchOptions } from './lib-launch.mjs';
import { recycle } from './lib-trash.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { seedConsent } from './lib-granted.mjs';

export const operaPath = () => {
  const p = process.env.QAW_OPERA_PATH || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Opera GX', 'opera.exe');
  return fs.existsSync(p) ? p : null;
};
export const builtExtension = (engine = 'chrome') => path.join(DIST, engine === 'opera' ? 'operagx' : 'chrome');
export const trash = (p) => ({ status: recycle(p).ok ? 0 : 1 });
export const until = async (fn, ms = 12000, step = 200) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, step)); } };

/** @param {{ engine?: 'chrome'|'opera', lang?: 'en'|'ar', ext?: string, consent?: boolean, label?: string }} [o] */
export async function launchE2E({ engine = 'chrome', lang = 'en', ext, consent = true, label = 'e2e' } = {}) {
  const exe = engine === 'opera' ? operaPath() : null;
  if (engine === 'opera' && !exe) return null;
  const EXT = ext || builtExtension(engine);
  if (!fs.existsSync(path.join(EXT, 'manifest.json'))) throw new Error(`no built extension at ${EXT}: run npm run build:all first`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `uqa-${label}-`));
  purgeWorkerCache(profile);
  const lo = launchOptions(EXT, { width: 1100, height: 800, headed: true });
  const opts = exe
    ? { ...lo, channel: undefined, executablePath: exe, viewport: null, args: [...lo.args, '--enable-unsafe-extension-debugging'] }
    : lo;
  const context = await chromium.launchPersistentContext(profile, opts);
  const topmost = await keepOnTop(context);
  const faults = [];
  const watch = (page, name) => {
    page.on('pageerror', (e) => faults.push({ page: name, kind: 'pageerror', text: e.message }));
    page.on('console', (m) => { if (m.type() === 'error') faults.push({ page: name, kind: 'console.error', text: m.text() }); });
    return page;
  };
  let worker;
  if (exe) worker = await until(() => context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')), 20000, 250);
  else worker = await freshWorker(context);
  if (!worker) throw new Error('the extension service worker never started');
  const id = new URL(worker.url()).host;
  if (consent) await seedConsent(worker);
  if (lang !== 'en') await worker.evaluate((l) => chrome.storage.sync.set({ qawLanguage: l }), lang);
  const pages = [];

  const h = {
    engine, lang, id, context, worker, faults, ext: EXT,
    /** The packaged practice page since 15 Oct 2026: the Bug Hunt game (practice/practice.html). */
    async game() {
      const p = watch(await context.newPage(), 'practice-game');
      await p.goto(`chrome-extension://${id}/practice/practice.html`);
      await p.waitForSelector('#btnStart', { state: 'visible' });
      pages.push(p);
      return p;
    },
    /** The four-fault fixture (practice/faults.html: the practice page before the game). Tests that need a page with known problems and no levels to play use it. */
    async practice() {
      const p = watch(await context.newPage(), 'practice');
      await p.goto(`chrome-extension://${id}/practice/faults.html`);
      await p.waitForSelector('#p-save');
      pages.push(p);
      return p;
    },
    /** @param {{ surface?: 'float'|'popup', width?: number, height?: number, path?: string }} [o] */
    async popup({ surface = 'float', width = 348, height = 600, path: pth = 'popup/popup.html' } = {}) {
      const p = watch(await context.newPage(), `${pth}${surface === 'float' ? '?surface=float' : ''}`);
      await p.setViewportSize({ width, height });
      const q = surface === 'float' ? '?surface=float' : '';
      await p.goto(`chrome-extension://${id}/${pth}${q}`);
      if (lang !== 'en') await p.evaluate((l) => localStorage.setItem('qaw-lang', l), lang).then(() => p.reload());
      if (pth.startsWith('popup/')) await p.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
      await p.evaluate(() => { window.close = () => {}; window.__clip = []; try { navigator.clipboard.writeText = async (s) => { window.__clip.push(String(s)); }; } catch { /* no clipboard */ } });
      pages.push(p);
      return p;
    },
    async page(url) { const p = watch(await context.newPage(), url); await p.goto(url); pages.push(p); return p; },
    async close() {
      await topmost?.release?.().catch(() => {});
      await context.close().catch(() => {});
      trash(profile);
    },
  };
  return h;
}

/**
 * A generic read of what a person would see on a page: raw i18n keys, "undefined"/"NaN"/"[object" text, elements that run out
 * of their own box, visible buttons with no name, and every visible status/alert line. Pure DOM, no assumption about the page.
 */
export const audit = (page) => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden],[inert],template'); };
  const out = { rawKeys: [], badText: [], overflow: [], unnamed: [], lines: [], title: document.title };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (!t || !n.parentElement || !vis(n.parentElement) || /^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)) continue;
    if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(t) && !/\.(com|org|net|io|js|css|html|json|md)$/.test(t)) out.rawKeys.push(t);
    if (/\bundefined\b|\bNaN\b|\[object /.test(t)) out.badText.push(t.slice(0, 120));
  }
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.overflowX === 'visible' && el.children.length === 0 && el.textContent.trim()) out.overflow.push(`${el.tagName.toLowerCase()}#${el.id}.${String(el.className).slice(0, 30)}: ${el.scrollWidth}>${el.clientWidth}`);
    if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && !(el.textContent.trim() || el.getAttribute('aria-label') || el.getAttribute('title'))) out.unnamed.push(`${el.tagName}#${el.id}`);
  }
  for (const el of document.querySelectorAll('[role=status],[role=alert],.status,.state-banner,.loss-line')) if (vis(el) && el.textContent.trim()) out.lines.push(`${el.id || el.className}: ${el.textContent.trim().slice(0, 140)}${el.title ? ` [title: ${el.title.slice(0, 80)}]` : ''}`);
  return out;
});
