/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * What the extension costs the page under test (T-075).
 *
 *   node tools/perf-page.mjs [--n 3] [--json tools/perf-page-baseline.json]
 *
 * Three pages (light, frame-heavy with 12 cross-origin frames, busy with a mutating DOM and a fetch loop)
 * x four states (none: no extension; installed: shipping package, no site granted; asleep: granted, not woken;
 * awake: granted, woken, a session recording with replay) x 1x and 6x CPU (CDP Emulation, applied to the page).
 * Per load: LCP, TBT (long tasks over 50 ms, summed over the excess), fetch latency p50/p95 over 60 calls,
 * JS heap, and for "awake" the replay bytes stored per minute. Headless, a temp profile per state (tag s1001b),
 * closed before it returns. "asleep" is the copy from tools/lib-granted.mjs: only its manifest line differs.
 * The split of `uqa-site-start` was decided from asleep-minus-installed on the frame-heavy page at 6x: more than 20 ms.
 * It shipped (T-075): asleep registers only bridge.js, wake registers the rest; `splitStartScript` is now the rule's verdict
 * on what is still shipped, so false means the 20 ms rule holds, and `beforeSplitMs` keeps the delta that justified it.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { cpuLoadPct, spreadPct, SPREAD_LIMIT_PCT } from './perf-worker.mjs';
import { grantedExtension, awaitSiteScripts, seedConsent } from './lib-granted.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const N = Number(arg('--n', 3));
const JSON_OUT = arg('--json', null);
process.env.UQA_HEADLESS = '1';

export const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const FRAME_PORTS = [];
const PAGES = {
  light: () => `<!doctype html><title>light</title><h1>Light</h1>${'<p>Plain article text for a quiet page.</p>'.repeat(40)}`,
  frames: () => `<!doctype html><title>frames</title><h1>Frames</h1>${FRAME_PORTS.map((p) => `<iframe src="http://127.0.0.1:${p}/ad" width="300" height="120"></iframe>`).join('')}`,
  busy: () => `<!doctype html><title>busy</title><h1>Busy</h1><ul id="l"></ul><script>
    const l = document.getElementById('l'); let n = 0;
    setInterval(() => { for (let i = 0; i < 20; i++) { const li = document.createElement('li'); li.textContent = 'row ' + (n++); l.appendChild(li); } while (l.children.length > 300) l.firstChild.remove(); }, 40);
  </script>`,
};
const handler = (req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ping') { res.setHeader('content-type', 'application/json'); return res.end('{"ok":1}'); }
  if (u === '/ad') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><p>ad</p><script>setInterval(()=>{document.title=Date.now()},500)</script>'); }
  const page = PAGES[u.slice(1)];
  if (!page) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', 'text/html');
  res.end(page());
};
const listen = () => new Promise((r) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });

const COLLECT = () => {
  window.__m = { lcp: 0, tbt: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.tbt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
};

async function measure(context, origin, name, rate) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await cdp.send('Performance.enable');
  await page.addInitScript(COLLECT);
  await page.goto(`${origin}/${name}`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const m = await page.evaluate(async () => {
    const xs = [];
    for (let i = 0; i < 60; i++) { const t = performance.now(); await fetch('/ping').then((r) => r.text()); xs.push(performance.now() - t); }
    return { lcp: window.__m.lcp, tbt: window.__m.tbt, fetch: xs };
  });
  const heap = (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? null;
  const out = { lcp: m.lcp, tbt: m.tbt, p50: pct(m.fetch, 0.5), p95: pct(m.fetch, 0.95), heapMB: heap == null ? null : heap / 1048576 };
  await page.close();
  return out;
}

async function runState(label, extDir, origin, pagesToRun) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `s1001b-pagecost-${label}-`));
  const opts = extDir ? launchOptions(extDir, { height: 700 }) : { headless: true, channel: 'chromium', viewport: { width: 1280, height: 700 } };
  const context = await chromium.launchPersistentContext(profile, opts);
  const res = {};
  try {
    let call = null; let sessionId = null; let worker = null;
    if (extDir) {
      worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20000 });
      if (label !== 'installed') { await seedConsent(worker); await awaitSiteScripts(worker); }
    }
    if (label === 'awake') {
      const under = await context.newPage();
      await under.goto(`${origin}/light`, { waitUntil: 'load' });
      const ctl = await context.newPage();
      await ctl.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
      await ctl.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 20000 });
      call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
      await call({ type: 'UQA_ARM' });
      const tabId = await worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url.startsWith(u))?.id, origin);
      const started = await call({ type: 'UQA_START', charter: 'page cost', tabId });
      sessionId = started?.result?.id || started?.result?.session?.id || null;
    }
    for (const rate of [1, 6]) for (const name of pagesToRun) {
      const runs = [];
      for (let i = 0; i < N; i++) runs.push(await measure(context, origin, name, rate));
      (res.spreads ||= {})[`${name}@${rate}x`] = Number(spreadPct(runs.map((r) => r.lcp).filter((x) => x != null)).toFixed(1)); // r8-07-3
      res[`${name}@${rate}x`] = Object.fromEntries(['lcp', 'tbt', 'p50', 'p95', 'heapMB'].map((k) => [k, median(runs.map((r) => r[k]))]));
    }
    if (label === 'awake') {
      // replay growth: the busy page for 10 s at 1x, bytes stored by then, scaled to a minute
      const page = await context.newPage();
      await page.goto(`${origin}/busy`, { waitUntil: 'load' });
      await page.waitForTimeout(10_000);
      const got = sessionId ? await call({ type: 'UQA_REPLAY_GET', sessionId }) : null;
      res.replayBytesPerMin = got?.ok ? Math.round(JSON.stringify(got.result).length * 6) : null;
      res.replaySampleBytes = got?.ok ? JSON.stringify(got.result).length : null; // r8-07-5
      res.replayCappedAt8MB = res.replaySampleBytes != null ? res.replaySampleBytes >= 8 * 1024 * 1024 : null;
      await page.close();
    }
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  return res;
}

const servers = [await listen(), ...(await Promise.all(Array.from({ length: 12 }, listen)))];
for (const s of servers.slice(1)) FRAME_PORTS.push(s.address().port);
const origin = `http://127.0.0.1:${servers[0].address().port}`;
const granted = grantedExtension({ label: 'pagecost' });
const loadBefore = await cpuLoadPct(1000); // r8-07-3: the machine's CPU busy percentage before the first cell
const result = { n: N, measuredOn: `${new Date().toISOString().slice(0, 10)}, ${os.platform()} ${os.release()}, headless Chromium, ${N} loads per cell (median), temp profiles`, states: {} };
try {
  for (const [label, dir] of [['none', null], ['installed', EXT], ['asleep', granted], ['awake', granted]]) {
    console.log(`state ${label} ...`);
    result.states[label] = await runState(label, dir, origin, Object.keys(PAGES));
  }
} finally {
  for (const s of servers) s.close();
  fs.rmSync(granted, { recursive: true, force: true });
}
const f = (v, d = 0) => (v == null ? 'n/a' : v.toFixed(d));
console.log('\nstate     | page@rate    | LCP ms | TBT ms | fetch p50 | p95 | heap MB');
for (const [label, cells] of Object.entries(result.states)) for (const [k, c] of Object.entries(cells)) {
  if (k === 'replayBytesPerMin') continue;
  console.log(`${label.padEnd(9)} | ${k.padEnd(12)} | ${f(c.lcp).padStart(6)} | ${f(c.tbt).padStart(6)} | ${f(c.p50, 1).padStart(9)} | ${f(c.p95, 1).padStart(3)} | ${f(c.heapMB, 1)}`);
}
const a = result.states.asleep['frames@6x'];
const i = result.states.installed['frames@6x'];
result.asleepDeltaMs = { lcp: a.lcp - i.lcp, tbt: a.tbt - i.tbt };
result.splitStartScript = Math.max(result.asleepDeltaMs.lcp, result.asleepDeltaMs.tbt) > 20;
// T-075: the split shipped. Keep the pre-split delta that justified it (carried from the file being replaced).
let prior = {};
try { prior = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8')); } catch { /* first run */ }
result.startScriptSplitShipped = true;
result.beforeSplitMs = prior.beforeSplitMs ?? (prior.splitStartScript ? prior.asleepDeltaMs : null);
console.log(`granted-and-asleep minus installed, frame-heavy page at 6x: LCP ${f(result.asleepDeltaMs.lcp, 1)} ms, TBT ${f(result.asleepDeltaMs.tbt, 1)} ms -> split uqa-site-start: ${result.splitStartScript}`);
console.log(`replay growth on the busy page: ${result.states.awake.replayBytesPerMin ?? 'NOT_MEASURED'} bytes per minute`);
// r8-07-3 and r8-07-5: the spread, the load and the replay sample, printed and stored; --json refuses a noisy run.
const spreads = Object.values(result.states).flatMap((st) => Object.values(st.spreads || {}));
const worstSpread = spreads.length ? Math.max(...spreads) : 0;
result.load = { cpuBusyPctBefore: Number(loadBefore.toFixed(1)), worstLcpSpreadPct: Number(worstSpread.toFixed(1)) };
console.log(`sample spread (LCP, worst cell): ${worstSpread.toFixed(0)}%; CPU busy before the run: ${loadBefore.toFixed(0)}%`);
const awake = result.states.awake || {};
console.log(`replay sample: ${awake.replaySampleBytes ?? 'NOT_MEASURED'} bytes in 10 s; capped at 8 MB: ${awake.replayCappedAt8MB == null ? 'n/a' : awake.replayCappedAt8MB ? 'yes' : 'no'}`);
if (JSON_OUT && worstSpread > SPREAD_LIMIT_PCT) { console.error(`perf-page: refusing to write ${JSON_OUT}: the worst LCP spread is ${worstSpread.toFixed(0)}% (limit ${SPREAD_LIMIT_PCT}%) at ${loadBefore.toFixed(0)}% CPU busy. Rerun on a quiet machine.`); process.exitCode = 1; }
else if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(result, null, 2) + '\n');
