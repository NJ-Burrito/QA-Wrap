/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Paint and raster cost during a scroll.
 *
 *   node tools/paint-cost.mjs <a.html> <b.html>
 *
 * Frame timing is the honest measure of "feels heavy", but it needs a real
 * GPU and a real compositor — headless renders through SwiftShader and reports
 * a flat 16.8ms whatever you throw at it. The work still happens though, so
 * measure the work: sum every Paint, Layerize and RasterTask the tracer emits
 * while the page is scrolled a fixed distance. That number is what a weaker
 * machine has to find time for, and it compares two builds fairly.
 *
 * Its own profile, its own browser handle, closed by name. Nothing else.
 */
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { profile } from './lib-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = profile('.paint-cost-profile');
const files = process.argv.slice(2);
if (!files.length) throw new Error('give me at least one html file');

const server = http.createServer((q, s) => {
  const name = decodeURIComponent(q.url.slice(1));
  const hit = files.find((f) => path.basename(f) === name) || files[0];
  const body = fs.readFileSync(hit, 'utf8');
  s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  s.end(/^\s*<!doctype/i.test(body) ? body
    : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${body}`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const WATCH = ['Paint', 'RasterTask', 'PaintImage', 'Layerize', 'UpdateLayer', 'UpdateLayerTree', 'Layout', 'UpdateLayoutTree', 'CompositeLayers'];

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
  viewport: { width: 1280, height: 900 },
});

const rows = [];
for (const f of files) {
  const page = await context.newPage();
  const cdp = await page.context().newCDPSession(page);
  await page.goto(`${origin}/${encodeURIComponent(path.basename(f))}`, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const height = await page.evaluate(() => document.scrollingElement.scrollHeight);
  if (height < 2000) throw new Error(`${f}: only ${height}px tall — nothing to scroll`);

  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  await cdp.send('Tracing.start', {
    traceConfig: { includedCategories: ['disabled-by-default-devtools.timeline', 'devtools.timeline'] },
    transferMode: 'ReportEvents',
  });

  await page.mouse.move(640, 300);             // hover the card: hover effects count
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);

  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  await done;

  const tally = {};
  for (const e of events) {
    if (e.ph !== 'X' || !WATCH.includes(e.name)) continue;
    tally[e.name] = tally[e.name] || { n: 0, us: 0 };
    tally[e.name].n++;
    tally[e.name].us += e.dur || 0;
  }
  const totalMs = +(Object.values(tally).reduce((a, t) => a + t.us, 0) / 1000).toFixed(1);
  rows.push({
    page: path.basename(f),
    height,
    'paint+raster ms': totalMs,
    paints: tally.Paint?.n ?? 0,
    'paint ms': +((tally.Paint?.us ?? 0) / 1000).toFixed(1),
    rasters: tally.RasterTask?.n ?? 0,
    'raster ms': +((tally.RasterTask?.us ?? 0) / 1000).toFixed(1),
    layouts: tally.Layout?.n ?? 0,
  });
  await page.close();
}

await context.close();   // only ours
server.close();
console.table(rows);
if (rows.length === 2) {
  const [a, b] = rows;
  const d = a['paint+raster ms'] - b['paint+raster ms'];
  const pct = a['paint+raster ms'] ? ((d / a['paint+raster ms']) * 100).toFixed(0) : '0';
  console.log(`\n${b.page} does ${d.toFixed(1)}ms less paint+raster work per scroll than ${a.page} — ${pct}% cheaper.`);
}
