/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Scroll smoothness for a plain HTML file — same method as tools/scroll.mjs,
 * pointed at an artifact page instead of an extension surface.
 *
 *   node page-scroll.mjs <file.html> [...]
 *
 * Measured at 1x and 6x CPU throttle: the artifact is opened on whatever
 * laptop the reader has, and "feels heavy" is a low-end-machine complaint.
 */
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const files = process.argv.slice(2);
if (!files.length) throw new Error('give me at least one html file');

// Serve over http, not file://, so Google Fonts and the CSP behave normally.
const server = http.createServer((q, s) => {
  const name = decodeURIComponent(q.url.slice(1)) || files[0];
  const hit = files.find((f) => path.basename(f) === name) || files[0];
  const body = fs.readFileSync(hit, 'utf8');
  s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  // The publisher wraps the fragment; reproduce that so we measure the real page.
  s.end(/^\s*<!doctype/i.test(body) ? body : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${body}`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

async function measure(page, steps = 40) {
  await page.evaluate(() => {
    window.__frames = []; window.__long = [];
    let last = performance.now();
    const tick = (now) => { window.__frames.push(now - last); last = now; if (window.__recording) requestAnimationFrame(tick); };
    window.__recording = true; requestAnimationFrame(tick);
    try {
      window.__obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(+e.duration.toFixed(1)); });
      window.__obs.observe({ type: 'longtask', buffered: false });
    } catch {}
  });

  await page.mouse.move(640, 450); // hover the card, so hover-only effects count
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, 900);
  await page.waitForTimeout(250);

  const { frames, long } = await page.evaluate(() => {
    window.__recording = false; window.__obs?.disconnect();
    return { frames: window.__frames.slice(2), long: window.__long };
  });
  if (frames.length < 10) throw new Error(`only ${frames.length} frames — the page did not scroll`);

  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.floor(sorted.length * p)] ?? 0;
  return {
    frames: frames.length,
    p50: +pct(0.5).toFixed(1),
    p95: +pct(0.95).toFixed(1),
    worst: +Math.max(...frames).toFixed(1),
    droppedPct: +((frames.filter((f) => f > 32).length / frames.length) * 100).toFixed(1),
    longTasks: long.length,
    longestTask: long.length ? Math.max(...long) : 0,
  };
}

/**
 * Its own profile directory, its own browser handle, and nothing else is ever
 * touched. No process-wide kill, no shared user-data-dir: a benchmark must
 * never close a window it did not open.
 */
const PROFILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.page-scroll-profile');
const context = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
  viewport: { width: 1280, height: 900 },
});
const rows = [];
for (const f of files) {
  for (const rate of [1, 6]) {
    const page = await context.newPage();
    const cdp = await page.context().newCDPSession(page);
    await page.goto(`${origin}/${encodeURIComponent(path.basename(f))}`, { waitUntil: 'load' });
    await page.waitForTimeout(400); // fonts settle
    const h = await page.evaluate(() => document.scrollingElement.scrollHeight);
    if (h < 2000) throw new Error(`${f}: page is only ${h}px tall — nothing to scroll`);
    if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    rows.push({ page: path.basename(f), cpu: `${rate}x`, height: h, ...(await measure(page)) });
    await page.close();
  }
}
await context.close(); // only ours
server.close();

console.table(rows);
for (const r of rows) {
  const verdict = r.p95 <= 20 && r.droppedPct < 5 ? 'smooth' : r.p95 <= 33 ? 'acceptable' : 'HEAVY';
  console.log(`${r.page.padEnd(26)} ${r.cpu.padEnd(4)} p95 ${String(r.p95).padStart(6)}ms  dropped ${String(r.droppedPct).padStart(5)}%  longest task ${String(r.longestTask).padStart(6)}ms  → ${verdict}`);
}
