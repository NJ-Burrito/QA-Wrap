/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Scroll smoothness benchmark.
 *
 *   node tools/scroll.mjs
 *
 * "Feels heavy" is a frame-rate complaint, so measure frames. This drives a
 * real scroll through the panel and the report page and records every frame
 * interval; what matters is not the average but the **long frames** — a single
 * 120ms hitch is felt, an average of 16.8ms is not.
 *
 * Budget: at 60Hz a frame is 16.7ms. Anything over 32ms has dropped at least
 * one frame. More than a few percent of those and scrolling feels heavy.
 */
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { profile } from './lib-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const PROFILE = profile('.scroll-profile');

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>seed</title></head>
<body><h1>Seed</h1><input id="a"><button id="go">Go</button></body></html>`;

const server = http.createServer((q, s) => {
  s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  s.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

/**
 * Scroll in realistic steps and record frame intervals from inside the page.
 * Playwright's mouse.wheel drives the compositor the way a real wheel does.
 */
async function measureScroll(page, label, steps = 40) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__long = [];
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__recording) requestAnimationFrame(tick);
    };
    window.__recording = true;
    requestAnimationFrame(tick);

    // Frame intervals alone hide the problem: the compositor can keep
    // scrolling at 60fps while the main thread is blocked and content pops in
    // late. Long tasks are what a person actually feels.
    try {
      window.__obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__long.push(+e.duration.toFixed(1));
      });
      window.__obs.observe({ type: 'longtask', buffered: false });
    } catch {
      /* not supported — the frame numbers still stand */
    }
  });

  // Fast and continuous, the way a person flicks a wheel. The old version
  // paused 40ms between steps, which gave the browser all the time in the
  // world and measured nothing.
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 900);
  }
  await page.waitForTimeout(250); // let late work land inside the window

  const { frames, long, blankAfterJump } = await page.evaluate(async () => {
    window.__recording = false;
    window.__obs?.disconnect();

    // A jump to the far end is the worst case for content-visibility: every
    // row entering the viewport has to be laid out at once.
    const scroller = document.scrollingElement;
    const t0 = performance.now();
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const blankAfterJump = +(performance.now() - t0).toFixed(1);

    return { frames: window.__frames.slice(2), long: window.__long, blankAfterJump };
  });

  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.floor(sorted.length * p)] ?? 0;
  const dropped = frames.filter((f) => f > 32).length;
  const bad = frames.filter((f) => f > 50).length;

  return {
    label,
    frames: frames.length,
    p50: +pct(0.5).toFixed(1),
    p95: +pct(0.95).toFixed(1),
    worst: +Math.max(...frames).toFixed(1),
    droppedPct: +((dropped / frames.length) * 100).toFixed(1),
    badFrames: bad,
    longTasks: long.length,
    longestTask: long.length ? Math.max(...long) : 0,
    jumpMs: blankAfterJump,
  };
}

const results = [];

purgeWorkerCache(PROFILE);

const context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT));
await keepOnTop(context); // test window stays above others; released on close
try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;

  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'load' });

  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const tabId = await ctl.evaluate(
    async (o) => (await chrome.tabs.query({ url: `${o}/*` }))[0]?.id ?? null,
    origin
  );

  console.log('seeding 1,500 events…');
  // Asleep by default, so nothing is recorded until the window is armed — this
  // suite was running a cached pre-switch worker and never found out.
  const windowId = await ctl.evaluate(
    (id) => new Promise((r) => chrome.tabs.get(id, (t) => r(t?.windowId ?? null))),
    tabId
  );
  await call({ type: 'UQA_ARM', windowId });

  const run = await call({ type: 'UQA_START', charter: 'Scroll bench', tabId, startUrl: `${origin}/` });
  if (!run?.ok) throw new Error(`the session did not start: ${run?.error}`);
  await ctl.evaluate(
    async (t) =>
      chrome.scripting.executeScript({
        target: { tabId: t },
        world: 'ISOLATED',
        func: async () => {
          const t0 = Date.now();
          for (let i = 0; i < 1500; i++) {
            await window.UQABridge.send({
              type: 'UQA_EVENT',
              event: {
                kind: i % 6 === 0 ? 'net' : 'dom',
                ts: t0 + i * 10,
                frameUrl: location.href,
                action: 'click',
                label: 'A reasonably long element label, number ' + i,
                locator:
                  "getByRole('button', { name: 'A reasonably long element label, number " + i + "' })",
                method: 'GET',
                url: '/api/some/longer/path/segment/' + i,
                status: i % 20 === 0 ? 500 : 200,
                durationMs: 12,
              },
            });
          }
          return true;
        },
      }),
    tabId
  );
  const sessionId = (await call({ type: 'UQA_GET_STATE' })).result.session.id;
  await call({ type: 'UQA_STOP' });
  const count = (await call({ type: 'UQA_GET_TIMELINE', sessionId })).result.events.length;
  console.log(`seeded ${count} events\n`);
  if (count < 500) throw new Error('seeding failed');

  /* ---- the panel ---- */
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/devtools/panel.html`);
  await panel.waitForFunction(() => document.querySelectorAll('#timeline .ev').length > 100, {
    timeout: 60000,
  });
  await panel.waitForTimeout(600);
  results.push(await measureScroll(panel, 'DevTools panel, 1500 events'));

  /* ---- the report page ---- */
  const report = await context.newPage();
  await report.goto(`chrome-extension://${id}/report/report.html?session=${sessionId}&format=markdown`);
  await report.waitForFunction(() => document.getElementById('content')?.textContent?.length > 500, {
    timeout: 30000,
  });
  await report.waitForTimeout(400);
  results.push(await measureScroll(report, 'report page'));

  /* ---- the settings page ---- */
  const opts = await context.newPage();
  await opts.goto(`chrome-extension://${id}/options/options.html`);
  await opts.waitForTimeout(700);
  results.push(await measureScroll(opts, 'settings page', 20));
} finally {
  await context.close();
  server.close();
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log('┌─ scroll ───────────────────────────────────────────────────────────────┐');
console.log(
  `  ${pad('surface', 28)}${num('p95', 7)}${num('worst', 8)}${num('long', 6)}${num('longest', 9)}${num('jump', 7)}  verdict`
);
console.log('  ' + '─'.repeat(74));

let bad = 0;
for (const r of results) {
  // Any long task over 50ms is felt as a stutter; a slow jump is felt as blank.
  const ok = r.p95 <= 32 && r.longestTask <= 50 && r.jumpMs <= 150;
  if (!ok) bad++;
  console.log(
    `  ${pad(r.label, 28)}${num(r.p95, 7)}${num(r.worst, 8)}${num(r.longTasks, 6)}${num(r.longestTask, 9)}${num(r.jumpMs, 7)}  ${ok ? 'smooth' : 'HEAVY'}`
  );
}
console.log('└──────────────────────────────────────────────────────────────────────────┘');
console.log(
  '\n  p95/worst: frame intervals (ms). 16.7 = 60fps, >32 = a dropped frame.\n' +
    '  long/longest: main-thread tasks over 50ms during the scroll — what is felt.\n' +
    '  jump: ms to paint after jumping to the far end of the list.'
);
console.log(`\n${bad ? bad + ' surface(s) scroll heavily' : 'every surface scrolls smoothly'}`);
process.exitCode = bad ? 1 : 0;
