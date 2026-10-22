/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * One perf run for the service worker boot policy (T-034).
 *
 *   node tools/perf-worker.mjs [--n 10] [--json <file>]
 *
 * Prints one table of medians:
 *   1. worker cold start: a fresh browser launch per sample on a warm profile; the worker's own clock
 *      (performance.now() at the last module of its static graph, i.e. since the worker thread began:
 *      fetch + parse + evaluate of the whole graph) for a stub worker, the real worker, and a copy padded
 *      with 70 KB of comments, reported as a ratio to the stub measured in the same run;
 *   2. popup first contentful paint with and without the 218 KB of display faces in ui/fonts.css;
 *   3. the cost of UQA_OVERLAY_ASSETS: first call (parses fonts.css) and a warm call.
 * Headless, an isolated temp profile per variant (tag s1001), closed before it returns.
 *
 * D-1010-195, by hand and report-only: `node tools/perf-worker.mjs --soak [--events 200000]` seeds one stopped session with that many
 * events straight into IndexedDB, then times the UQA_GET_TIMELINE read and the HTML export, and samples the browser's peak working set (a service worker has no performance.memory).
 * It gates nothing and writes no baseline: it is the falsifier for "large sessions need paged reads" (r9-07-2, r9-06-3).
 *
 * 6x CPU: Chromium offers no CPU throttle for an extension service worker (Emulation applies to pages;
 * an attached debugger also keeps the worker alive, so it cannot be stopped and restarted in place).
 * The 6x column is therefore PROJECTED as 6 x the 1x delta and labelled so: module work is CPU-bound.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { shipping, copyShipping } from './lib-ship.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : dflt; };
const N = Number(arg('--n', 10));
const JSON_OUT = arg('--json', null);
const SOAK = process.argv.includes('--soak');
const SOAK_N = Number(arg('--events', 200000));
const RECORD_SOAK = process.argv.includes('--record-soak');
const KB = 1024;
process.env.UQA_HEADLESS = '1';

export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** r8-07-3: how far the samples spread, as a percentage of their median ((max - min) / median). A noisy run shows as noisy. */
export const spreadPct = (xs) => { if (!xs.length) return 0; const m = median(xs); return m ? ((Math.max(...xs) - Math.min(...xs)) / m) * 100 : 0; };
export const SPREAD_LIMIT_PCT = 25;
/** r8-07-3: the machine's CPU busy percentage over `ms`, from the OS tick counters, so a run on a loaded box says so. */
export async function cpuLoadPct(ms = 1000) {
  const snap = () => os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); return [a[0] + t, a[1] + c.times.idle]; }, [0, 0]);
  const [t0, i0] = snap();
  await new Promise((r) => setTimeout(r, ms));
  const [t1, i1] = snap();
  return t1 > t0 ? (1 - (i1 - i0) / (t1 - t0)) * 100 : 0;
}

/** Bytes of the service worker's static import graph (the number test-worker-imports gates). */
export function bootGraphBytes(extDir) {
  const seen = new Set();
  const re = /^\s*(?:import\s+[\s\S]*?\s+from\s+|import\s+|export\s+[\s\S]*?\s+from\s+)'([^']+)';/gm;
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) if (m[1].startsWith('.')) walk(path.resolve(path.dirname(file), m[1]));
  };
  walk(path.join(extDir, 'background', 'service-worker.js'));
  return [...seen].reduce((n, f) => n + fs.statSync(f).size, 0);
}

const MAIN = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const tmpRoot = MAIN ? fs.mkdtempSync(path.join(os.tmpdir(), 's1001-perf-')) : '';
function copyExt(name, mutate) {
  const dst = path.join(tmpRoot, name);
  fs.mkdirSync(dst, { recursive: true });
  for (const n of shipping(fs.readdirSync(EXT))) {
    const from = path.join(EXT, n);
    if (fs.statSync(from).isDirectory()) copyShipping(from, path.join(dst, n)); else fs.copyFileSync(from, path.join(dst, n));
  }
  mutate?.(dst);
  return dst;
}

const T1 = 'globalThis.__UQA_T1 = performance.now();\n';
const STUB = T1 + "chrome.runtime.onMessage.addListener((m, s, r) => { if (m && m.type === 'UQA_POPUP_STATE') { r({ ok: true, result: {} }); return true; } });\n";
function markEnd(extDir) {
  fs.writeFileSync(path.join(extDir, 'background', 't1.js'), T1);
  fs.appendFileSync(path.join(extDir, 'background', 'service-worker.js'), "\nimport './t1.js';\n");
}
function padTo(extDir, targetBytes) {
  const need = targetBytes - bootGraphBytes(extDir);
  if (need <= 0) return;
  const line = '// ' + 'padding '.repeat(12) + '\n';
  fs.appendFileSync(path.join(extDir, 'background', 'service-worker.js'), line.repeat(Math.ceil(need / line.length)));
}

async function launch(extDir, label) {
  const profileDir = path.join(tmpRoot, `profile-${label}`);
  const opts = launchOptions(extDir, { height: 700 });
  const context = await chromium.launchPersistentContext(profileDir, opts);
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(sw.url()).host;
  return { context, id };
}

const log = (...a) => { if (process.env.PERF_DEBUG) console.error('[perf]', ...a); };
async function coldStarts(extDir, label) {
  const xs = [];
  for (let i = 0; i < N + 1; i++) {
    const { context } = await launch(extDir, label); // same profile each time: only the first run is discarded
    try {
      const sw = context.serviceWorkers()[0];
      let t1 = null;
      for (let w = 0; w < 100 && t1 == null; w++) { t1 = await sw.evaluate(() => globalThis.__UQA_T1 ?? null).catch(() => null); if (t1 == null) await new Promise((r) => setTimeout(r, 50)); }
      log(label, i, t1);
      if (i > 0 && t1 != null) xs.push(t1);
    } finally { await context.close(); }
  }
  return { median: median(xs), samples: xs.length, spreadPct: spreadPct(xs) };
}

async function popupPaint(extDir, label) {
  const { context, id } = await launch(extDir, label);
  const xs = [];
  try {
    for (let i = 0; i < N + 1; i++) {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/popup/popup.html`, { waitUntil: 'load' });
      const fcp = await page.evaluate(() => new Promise((res) => {
        const get = () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
        const t = setInterval(() => { const v = get(); if (v != null) { clearInterval(t); res(v); } }, 5);
        setTimeout(() => { clearInterval(t); res(null); }, 5000);
      }));
      if (i > 0 && fcp != null) xs.push(fcp);
      await page.close();
    }
  } finally { await context.close(); }
  return median(xs);
}

async function overlayCost(extDir, label) {
  const { context, id } = await launch(extDir, label);
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/popup/popup.html`);
    const t = await page.evaluate(async () => {
      const call = async () => { const t0 = performance.now(); await chrome.runtime.sendMessage({ type: 'UQA_OVERLAY_ASSETS' }); return performance.now() - t0; };
      const first = await call();
      const warm = [];
      for (let i = 0; i < 10; i++) warm.push(await call());
      warm.sort((a, b) => a - b);
      return { first, warm: warm[5] };
    });
    return t;
  } finally { await context.close(); }
}

/** D-1010-195: one report line for the soak probe. Every field may be null (a step that failed says so instead of a number). */
export function soakLine(r) {
  const ms = (x) => (x == null ? 'n/a' : `${x.toFixed(0)} ms`);
  const mb = (x) => (x == null ? 'n/a' : `${(x / 1048576).toFixed(0)} MB`);
  return `${r.events} events: seed ${ms(r.seedMs)}; UQA_GET_TIMELINE ${r.timeline?.ok === false ? `FAILED (${r.timeline.error})` : ms(r.timeline?.ms)}` +
    `${r.timeline?.rows != null ? ` (${r.timeline.rows} rows)` : ''}; HTML export ${r.html?.ok === false ? `FAILED (${r.html.error})` : ms(r.html?.ms)}` +
    `${r.html?.bytes != null ? ` (${mb(r.html.bytes)})` : ''}; peak memory ${mb(r.peakHeap)} (browser working set, OS-sampled)`;
}

/** r10-07-2 (D-230): the soak line as a stored baseline carries it: 1.5x the measured peak, timeline read and HTML export. Null when a step failed (a failed run is never stored). */
export const SOAK_FACTOR = 1.5;
export function soakCeilings(r) {
  if (!r || r.timeline?.ok !== true || r.html?.ok !== true || r.peakHeap == null) return null;
  return { peakBytes: Math.ceil(r.peakHeap * SOAK_FACTOR), timelineMs: Math.ceil(r.timeline.ms * SOAK_FACTOR), htmlMs: Math.ceil(r.html.ms * SOAK_FACTOR) };
}
/** The problems of one soak run against a stored `soak` section ({ events, ceilings }); an empty list means within every ceiling. */
export function soakOver(r, soak) {
  const c = soak?.ceilings;
  if (!c) return ['the baseline has no soak ceilings: record them once with --soak --record-soak --json <file>'];
  const out = [];
  if (r.events !== soak.events) out.push(`this run seeded ${r.events} events but the baseline was recorded at ${soak.events}`);
  if (r.timeline?.ok !== true) out.push(`UQA_GET_TIMELINE FAILED (${r.timeline?.error || 'no reply'})`);
  else if (r.timeline.ms > c.timelineMs) out.push(`UQA_GET_TIMELINE ${r.timeline.ms.toFixed(0)} ms is over the ${c.timelineMs} ms ceiling`);
  if (r.html?.ok !== true) out.push(`HTML export FAILED (${r.html?.error || 'no reply'})`);
  else if (r.html.ms > c.htmlMs) out.push(`HTML export ${r.html.ms.toFixed(0)} ms is over the ${c.htmlMs} ms ceiling`);
  if (r.peakHeap == null) out.push('peak memory could not be sampled (Windows only)');
  else if (r.peakHeap > c.peakBytes) out.push(`peak memory ${(r.peakHeap / 1048576).toFixed(0)} MB is over the ${(c.peakBytes / 1048576).toFixed(0)} MB ceiling`);
  return out;
}

/** Total working set in bytes of every chrome.exe whose command line holds `tag` (Windows only; null elsewhere or on a failed query). */
function workingSet(tag) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const ps = `(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).WorkingSet64 } | Measure-Object -Sum).Sum`;
  return new Promise((res) => execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 8000 }, (err, out) => res(err ? null : Number(String(out).trim()) || null)));
}

async function soakProbe(extDir, events) {
  const { context, id } = await launch(extDir, 'soak');
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/popup/popup.html`);
    page.on('console', (m) => { if (m.text().startsWith('soak-seed')) console.error(m.text()); });
    const seeded = await page.evaluate(async (n) => {
      const db = await import('../core/db.js');
      const sid = 's_soak_' + Date.now().toString(36);
      const t0 = Date.now() - n * 5;
      const t = performance.now();
      await db.putSession({ id: sid, seq: 1, charter: 'Soak', startedAt: t0, endedAt: Date.now(), tabId: null, windowId: null, startUrl: 'http://127.0.0.1/', env: null, timeboxMinutes: null, expiresAt: null, breakdown: null, status: 'stopped' });
      for (let i = 0; i < n; i += 5000) {
        const batch = [];
        for (let j = i; j < Math.min(n, i + 5000); j++) {
          batch.push({ sessionId: sid, kind: j % 5 === 0 ? 'net' : 'dom', ts: t0 + j * 5, frameUrl: 'http://127.0.0.1/', action: 'click', label: 'Row ' + j, locator: "getByRole('button', { name: 'Row " + j + "' })", method: 'GET', url: '/api/' + j, status: j % 25 === 0 ? 500 : 200, durationMs: 12 });
        }
        await db.appendEvents(batch);
        if (i % 25000 === 0) console.log('soak-seed ' + (i + 5000) + ' rows at ' + Math.round(performance.now() - t) + ' ms');
      }
      return { sid, seedMs: performance.now() - t };
    }, events);
    let peakHeap = null;
    let sampling = true;
    const sampler = (async () => { while (sampling) { const v = await workingSet('profile-soak'); if (v != null && v > (peakHeap || 0)) peakHeap = v; await new Promise((r) => setTimeout(r, 500)); } })();
    const timed = (msg) => page.evaluate(async (m) => {
      const t = performance.now();
      try {
        // A reply that never comes (a message over the runtime's size limit) is a FAILED step after 120 s, not a hang.
        const r = await Promise.race([chrome.runtime.sendMessage(m), new Promise((res) => setTimeout(() => res({ ok: false, error: 'no reply in 120 s' }), 120000))]);
        const ms = performance.now() - t;
        if (!r || r.ok === false) return { ok: false, ms, error: String(r?.error || 'no reply').slice(0, 120) };
        return { ok: true, ms, rows: r.result?.events?.length ?? null, bytes: typeof r.result?.content === 'string' ? r.result.content.length : (r.result?.size ?? null) };
      } catch (err) { return { ok: false, ms: performance.now() - t, error: String(err?.message || err).slice(0, 120) }; }
    }, msg);
    const timeline = await timed({ type: 'UQA_GET_TIMELINE', sessionId: seeded.sid });
    const html = await timed({ type: 'UQA_EXPORT', sessionId: seeded.sid, format: 'html' });
    sampling = false;
    await sampler;
    return { events, seedMs: seeded.seedMs, timeline, html, peakHeap };
  } finally { await context.close(); }
}

const fmt = (x) => (x == null ? 'n/a' : x.toFixed(1));
if (MAIN && SOAK) {
  let code = 0;
  try {
    console.log('soak probe (by hand; a gate only with --json <baseline>): seeding ' + SOAK_N + ' events…');
    const r = await soakProbe(copyExt('soak'), SOAK_N);
    console.log(soakLine(r));
    if (JSON_OUT) { // r10-07-2: with a baseline file the soak is compared to its stored 1.5x ceilings; --record-soak writes them (only the `soak` key).
      if (!fs.existsSync(JSON_OUT)) { fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true }); fs.writeFileSync(JSON_OUT, '{}\n'); console.log(`perf-worker: no baseline at ${JSON_OUT}; created an empty one (record ceilings with --record-soak)`); }
      const base = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'));
      if (RECORD_SOAK) {
        const ceilings = soakCeilings(r);
        if (!ceilings) { console.error('perf-worker: refusing to record a soak line with a failed step or no memory sample'); code = 1; }
        else {
          base.soak = { events: r.events, factor: SOAK_FACTOR, measuredOn: `${new Date().toISOString().slice(0, 10)}, ${os.platform()} ${os.release()}, headless Chromium`, measured: { seedMs: Math.round(r.seedMs), timelineMs: Math.round(r.timeline.ms), htmlMs: Math.round(r.html.ms), peakBytes: r.peakHeap, timelineRows: r.timeline.rows ?? null, htmlBytes: r.html.bytes ?? null }, ceilings };
          fs.writeFileSync(JSON_OUT, JSON.stringify(base, null, 2) + '\n');
          console.log(`soak baseline recorded in ${JSON_OUT}: ceilings peak ${(ceilings.peakBytes / 1048576).toFixed(0)} MB, timeline ${ceilings.timelineMs} ms, export ${ceilings.htmlMs} ms`);
        }
      } else {
        const problems = soakOver(r, base.soak);
        for (const pr of problems) console.error('perf-worker soak: ' + pr);
        console.log(problems.length ? `soak: ${problems.length} over the stored ceiling(s)` : 'soak: within every stored ceiling');
        if (problems.length) code = 1;
      }
    }
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
  process.exit(code);
}
const result = {};
if (MAIN) try {
  const real = copyExt('real', markEnd);
  const realKB = bootGraphBytes(real) / KB;
  const v760 = real; // the tree as it is; its measured size labels the row
  const v830 = copyExt('v830', (d) => { markEnd(d); padTo(d, bootGraphBytes(real) + 70 * KB); });
  const loadBefore = await cpuLoadPct(1000);
  const stub = copyExt('stub', (d) => fs.writeFileSync(path.join(d, 'background', 'service-worker.js'), STUB));
  console.log(`real boot graph ${realKB.toFixed(1)} KB; variants ${(bootGraphBytes(v760) / KB).toFixed(1)} KB and ${(bootGraphBytes(v830) / KB).toFixed(1)} KB (the gate's own walker reads about 11 KB less) (N=${N}, headless, temp profiles)`);

  result.cold = {};
  for (const [name, dir] of [['stub', stub], [`${Math.round(realKB)} KB`, v760], ['real +70 KB', v830]]) result.cold[name] = await coldStarts(dir, name.replace(/\W/g, ''));

  const withDisplay = copyExt('fonts-with');
  const without = copyExt('fonts-without', (d) => {
    const f = path.join(d, 'ui', 'fonts.css');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/@font-face\s*\{[^}]*Serif Display[^}]*\}/g, ''));
  });
  result.paint = { with: await popupPaint(withDisplay, 'pw'), without: await popupPaint(without, 'po') };
  result.overlay = await overlayCost(real, 'overlay');
  const real1 = `${Math.round(realKB)} KB`;
  const stubMs = result.cold.stub.median;
  console.log('\nworker cold start, median ms from worker thread start to the end of its module graph');
  console.log('variant      | 1x ms | ratio to stub | 6x ms (projected) | samples');
  for (const [name, r] of Object.entries(result.cold)) {
    const six = name === 'stub' ? r.median * 6 : r.median * 6;
    console.log(`${name.padEnd(12)} | ${fmt(r.median).padStart(5)} | ${(r.median / stubMs).toFixed(2).padStart(13)} | ${fmt(six).padStart(17)} | ${r.samples}`);
  }
  const d1 = result.cold['real +70 KB'].median - result.cold[real1].median;
  const d6 = d1 * 6;
  console.log(`real +70 KB minus ${real1}: ${d1.toFixed(1)} ms at 1x, ${d6.toFixed(1)} ms at 6x (projected)`);
  console.log(`\npopup first contentful paint: ${fmt(result.paint.with)} ms with the display faces, ${fmt(result.paint.without)} ms without (diff ${fmt(result.paint.with - result.paint.without)} ms)`);
  console.log(`UQA_OVERLAY_ASSETS: first call ${fmt(result.overlay.first)} ms (parses ui/fonts.css), warm median ${fmt(result.overlay.warm)} ms`);
  result.deltaMs = { x1: d1, x6: d6 };
  const worstSpread = Math.max(...Object.values(result.cold).map((r) => r.spreadPct || 0));
  result.load = { cpuBusyPctBefore: Number(loadBefore.toFixed(1)), worstSpreadPct: Number(worstSpread.toFixed(1)) };
  console.log('\n' + 'sample spread: ' + Object.entries(result.cold).map(([k, r]) => k + ' ' + (r.spreadPct || 0).toFixed(0) + '%').join(', ') + '; CPU busy before the run: ' + loadBefore.toFixed(0) + '%');
  if (JSON_OUT) {
    if (worstSpread > SPREAD_LIMIT_PCT) { console.error(`perf-worker: refusing to write ${JSON_OUT}: the worst sample spread is ${worstSpread.toFixed(0)}% (limit ${SPREAD_LIMIT_PCT}%) at ${loadBefore.toFixed(0)}% CPU busy. Rerun on a quiet machine.`); process.exitCode = 1; } else {
    // The decision and its reasoning belong to the person, not the run: carry them over from the file being replaced.
    let kept = {};
    try { const old = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8')); kept = { decision: old.decision, why: old.why }; } catch { /* first run */ }
    fs.writeFileSync(JSON_OUT, JSON.stringify({ n: N, realKB, ...result, measuredOn: `${new Date().toISOString().slice(0, 10)}, ${os.platform()} ${os.release()}, headless Chromium, ${N} cold starts per variant, temp profiles`, ...kept }, null, 2) + '\n');
    }
  }
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
