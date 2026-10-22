/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Walk every popup state in the built extension and write what a person would see (sdlc-1014b sweep).
 *   node tools/sweep-e2e.mjs [--engine chrome|opera] [--lang en|ar]     writes work/sdlc/pipeline-1014b/results/sweep-<engine>-<lang>.json
 * A tool for finding faults; the assertions live in test-e2e-practice.mjs.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { REPO } from './lib-paths.mjs';
import { launchE2E, audit } from './lib-e2e.mjs';
import { seedConsent } from './lib-granted.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const engine = arg('engine', 'chrome'), lang = arg('lang', 'en');
const out = { engine, lang, states: {} };
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Sweep page</title><h1>Fixture</h1><button id=b>Go</button>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let h;
const snap = async (name, page, extra = {}) => {
  const a = await audit(page);
  const shot = await page.evaluate(() => ({
    primary: [...document.querySelectorAll('.btn-primary')].filter((b) => b.getClientRects().length).map((b) => `${b.id}:${b.textContent.trim().slice(0, 30)}`),
    buttons: [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length && !b.closest('[hidden]')).map((b) => (b.id || b.dataset.format || b.textContent.trim().slice(0, 20)) + (b.disabled ? '(disabled)' : '')),
    card: (() => { const c = document.getElementById('switch-card'); if (!c) return null; const r = c.getBoundingClientRect(); return { h: Math.round(r.height), compact: c.classList.contains('is-compact'), text: c.innerText.replace(/\s+/g, ' ').slice(0, 160) }; })(),
  })).catch(() => ({}));
  out.states[name] = { ...a, ...shot, ...extra };
  console.log(`  ${name}: lines=${JSON.stringify(a.lines)} raw=${a.rawKeys.length} bad=${a.badText.length} overflow=${a.overflow.length}`);
};
const doneInfo = (p) => p.evaluate(() => ({ summary: document.getElementById('done-summary')?.textContent, dur: document.getElementById('stat-duration')?.textContent, problems: document.getElementById('stat-problems')?.textContent, clean: document.getElementById('done-clean')?.textContent }));
try {
  h = await launchE2E({ engine, lang, consent: false, label: 'sweep' });
  if (!h) { console.log('engine not available'); process.exit(0); }
  const first = await h.popup({ surface: 'float' });
  await first.waitForTimeout(1500);
  await snap('first-run', first);
  await first.close();
  await seedConsent(h.worker);
  const practice = await h.practice();
  const page = await h.page(origin);
  await practice.bringToFront().catch(() => {});
  const pop = await h.popup({ surface: 'float' });
  await pop.waitForTimeout(2500);
  await snap('asleep-on-practice', pop);
  await page.bringToFront().catch(() => {});
  const pop2 = await h.popup({ surface: 'float' });
  await pop2.waitForTimeout(2500);
  await snap('asleep-on-not-allowed-site', pop2);
  await pop2.close();
  await practice.bringToFront().catch(() => {});
  await pop.reload(); await pop.waitForFunction(() => document.body.dataset.ready === 'true'); await pop.waitForTimeout(1500);
  await pop.click('#start'); await pop.waitForSelector('#step-live:not([hidden])', { timeout: 20000 }); await pop.waitForTimeout(1500);
  await snap('recording', pop);
  await practice.bringToFront().catch(() => {});
  await practice.fill('#p-name', 'A'); await practice.click('#p-save'); await practice.fill('#p-coupon', 'X'); await practice.click('#p-apply'); await practice.click('#p-next');
  await pop.waitForTimeout(2500);
  await snap('recording-with-problems', pop);
  await pop.click('#stop'); await pop.waitForSelector('#step-done:not([hidden])', { timeout: 20000 }); await pop.waitForTimeout(2000);
  await snap('done-with-problems', pop, { done: await doneInfo(pop) });
  const [rep] = await Promise.all([h.context.waitForEvent('page'), pop.click('#view-report')]);
  rep.on('pageerror', (e) => h.faults.push({ page: 'report', kind: 'pageerror', text: e.message }));
  rep.on('console', (m) => { if (m.type() === 'error') h.faults.push({ page: 'report', kind: 'console.error', text: m.text() }); });
  await rep.waitForLoadState('domcontentloaded'); await rep.waitForTimeout(3500);
  await snap('report', rep, { reportTitle: await rep.evaluate(() => document.title), hero: await rep.evaluate(() => document.querySelector('h1, .hero-title')?.textContent?.slice(0, 120) || null) });
  await rep.close(); await pop.bringToFront().catch(() => {});
  await pop.click('#new-session'); await pop.waitForSelector('#step-idle:not([hidden])'); await pop.waitForTimeout(800);
  await snap('idle-after-session', pop);
  await pop.click('#start'); await pop.waitForSelector('#step-live:not([hidden])', { timeout: 20000 }); await pop.waitForTimeout(1500);
  await pop.click('#stop'); await pop.waitForSelector('#step-done:not([hidden])', { timeout: 20000 }); await pop.waitForTimeout(2000);
  await snap('done-clean', pop, { done: await doneInfo(pop) });
  for (const [name, p, w] of [['settings', 'options/options.html', 1000], ['side-panel', 'sidepanel/sidepanel.html', 400], ['welcome', 'welcome/welcome.html', 900]]) {
    const x = await h.popup({ surface: 'popup', width: w, height: 700, path: p }).catch(() => null);
    if (!x) { out.states[name] = { error: 'page did not load' }; continue; }
    await x.waitForTimeout(2000);
    await snap(name, x);
  }
  const fl = await h.popup({ surface: 'float' });
  out.dockShown = await fl.evaluate(() => { const b = document.getElementById('dock'); return !!b && b.getClientRects().length > 0; });
  if (out.dockShown) { await fl.click('#dock'); await fl.waitForTimeout(2000); out.afterDock = await fl.evaluate(() => ({ status: document.getElementById('status')?.textContent, title: document.getElementById('status')?.title })); }
  out.faults = h.faults;
} catch (e) { out.aborted = String(e.stack || e); console.log('ABORTED', e.stack || e); }
finally {
  await h?.close();
  server.close();
  const dir = path.join(REPO, 'work', 'sdlc', 'pipeline-1014b', 'results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `sweep-${engine}-${lang}.json`), JSON.stringify(out, null, 1));
}
