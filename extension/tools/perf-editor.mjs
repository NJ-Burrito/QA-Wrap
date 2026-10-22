/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Per-pointer-move repaint cost of the markup editor, before and after T-072.
 * A BY-HAND TOOL, not a test: it is not in `npm test`; run it with
 *
 *   npm run perf:editor [-- --size 1600x1200 --moves 200 --out result.json]
 *
 * "Before" is `annotate/annotate.js` at 5f79dd1^, the commit before T-072, put
 * into a scratch copy of the granted extension with `git show` (no checkout,
 * nothing in the working tree changes). "After" is the file as it is now. Each
 * copy is driven in a headless Chromium: a PNG is stored, the editor opens on
 * it, 8 shapes are drawn, then 200 real pointer moves drag a ninth.
 *
 * Per move, in page time (performance.now), for 1 and for 4 pointermoves per
 * animation frame (a 60 Hz and a 240 Hz mouse; the second is what coalescing is
 * for). Frames are driven by the harness: headless Chromium stopped delivering
 * animation frames after a few dozen in every launch variant tried, so
 * requestAnimationFrame is a queue the loop flushes, once per frame. The editor's
 * code runs unchanged; compositing is what is not measured.
 *   handler = the pointermove handler itself (before: it painted; after: it only
 *             schedules)
 *   frame   = the animation-frame work the handler left behind (after: the paint)
 *   flush   = a 1-pixel readback right after, which makes the canvas finish the
 *             drawing it queued (without it the numbers are command recording only)
 *   total   = handler + frame + flush, divided by the moves in the frame
 * Median and p95 ms, plus `window.__uqaPaintCount` ({full, fast}) over each mode
 * for the build that carries the counter.
 *
 * Its own browsers (profile dir tagged s1001b), closed by handle; its scratch
 * copies go to the recycle bin at the end.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { grantedExtension } from './lib-granted.mjs';
import { recycle } from './lib-trash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const BEFORE_REF = '5f79dd1^'; // the commit before T-072 (61fc0fd already carries the fix)
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const [W, H] = arg('size', '1600x1200').split('x').map(Number);
const MOVES = Number(arg('moves', '200'));
const OUT = arg('out', '');
const log = (m) => { if (process.argv.includes('--verbose')) console.error(`[perf-editor] ${m}`); };

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2) };
};

const scratch = [];
function build(label, annotateSource) {
  const dir = grantedExtension({ label });
  scratch.push(dir);
  if (annotateSource) fs.writeFileSync(path.join(dir, 'annotate', 'annotate.js'), annotateSource);
  return dir;
}

async function measure(label, ext) {
  const profile = path.join(os.tmpdir(), `uqa-s1001b-${label}-${Date.now().toString(36)}`);
  scratch.push(profile);
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--no-default-browser-check',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-gpu', '--disable-features=CalculateNativeWinOcclusion'], // lib-launch's three (an idle page must still get frames), and a CPU canvas: the GPU-less readback stalled the renderer
  });
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
    const id = new URL(sw.url()).host;
    const page = ctx.pages()[0] || (await ctx.newPage()); // the one visible tab: a second tab behind it gets no animation frames
    await page.bringToFront(); // headless: there is no window of anyone's to disturb
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${id}/annotate/annotate.html`);
    await page.evaluate(async ({ W, H }) => {
      const { putMedia, putSession } = await import('/core/db.js');
      await putSession({ id: 'perf-editor-session', startedAt: Date.now(), name: 'perf-editor' }); // the worker's orphan sweep deletes media with no live session
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#f4f1ea'); grad.addColorStop(1, '#cfd8e3');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 400; i++) { // a page-like texture, so the bitmap is not a flat fill
        g.fillStyle = `hsl(${(i * 47) % 360} 30% ${40 + (i % 5) * 10}%)`;
        g.fillRect((i * 97) % W, (i * 53) % H, 40 + (i % 90), 6 + (i % 14));
      }
      await putMedia({ id: 'perf-editor', type: 'image/png', blob: await c.convertToBlob({ type: 'image/png' }), label: 'perf', sessionId: 'perf-editor-session', createdAt: Date.now() });
    }, { W, H });
    await page.goto(`chrome-extension://${id}/annotate/annotate.html?id=perf-editor`);
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await page.waitForFunction((w) => document.getElementById('canvas')?.width === w, W, { timeout: 15000 }); // R15: the ready state, not a sleep
    } catch {
      throw new Error(`${label}: the editor never showed the image. status="${await page.locator('#status').textContent().catch(() => '?')}" errors=${errors.join(' | ')}`);
    }

    const box = await page.locator('#canvas').boundingBox();
    const pt = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
    const drag = async (a, b) => {
      await page.mouse.move(...pt(...a)); await page.mouse.down();
      await page.mouse.move(...pt(...b), { steps: 6 }); await page.mouse.up();
    };
    const arm = (spec) => page.evaluate((s) => (s.tool ? document.querySelector(`[data-tool="${s.tool}"]`).click() : armShape(s.shape)), spec);
    log(`${label}: image shown`);
    const eight = [{ tool: 'arrow' }, { tool: 'pen' }, { tool: 'highlight' }, { tool: 'redact' }, { tool: 'blur' }, { shape: 'rect' }, { shape: 'ellipse' }, { shape: 'line' }];
    for (const [i, spec] of eight.entries()) {
      await arm(spec);
      await drag([0.08 + i * 0.1, 0.15 + (i % 3) * 0.2], [0.16 + i * 0.1, 0.3 + (i % 3) * 0.2]);
    }
    const drawn = await page.evaluate(() => shapes.length);
    if (drawn !== 8) throw new Error(`${label}: expected 8 committed shapes, the editor holds ${drawn}`); // R15

    log(`${label}: 8 shapes drawn`);
    await arm({ shape: 'rect' });
    await page.mouse.move(...pt(0.3, 0.6));
    await page.mouse.down(); // a real press: the editor now holds a drawing in progress
    const points = (n) => Array.from({ length: n }, (_, i) => pt(0.3 + 0.4 * ((i + 1) / n), 0.6 + 0.2 * Math.sin(i / 9)));
    const modes = {};
    for (const perFrame of [1, 4]) {
      const counter0 = await page.evaluate(() => (window.__uqaPaintCount ? { ...window.__uqaPaintCount } : null));
      // Frames are driven by the harness, not the compositor: headless Chromium
      // stopped delivering animation frames after a few dozen (measured, five
      // launch variants), so requestAnimationFrame is a queue that this loop
      // flushes once per frame. The editor's own code runs unchanged; what is not
      // measured is compositing. `perFrame` pointermoves land before each frame:
      // 1 is a 60 Hz mouse, 4 a 240 Hz one, which is what coalescing is for.
      const frames = await page.evaluate(({ MOVES, perFrame, pts }) => {
        const canvas = document.getElementById('canvas');
        const gc = canvas.getContext('2d');
        const queue = [];
        const real = window.requestAnimationFrame;
        window.requestAnimationFrame = (cb) => queue.push(cb);
        const out = [];
        try {
          for (let i = 0; i < MOVES; i += perFrame) {
            const k = Math.min(perFrame, MOVES - i);
            let sync = 0;
            for (let j = 0; j < k; j++) {
              const [x, y] = pts[i + j];
              const t0 = performance.now();
              canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }));
              sync += performance.now() - t0;
            }
            const f0 = performance.now();
            for (const cb of queue.splice(0)) cb(f0);
            const frame = performance.now() - f0;
            const g0 = performance.now();
            gc.getImageData(0, 0, 1, 1); // a readback makes the canvas finish the drawing it queued
            out.push({ k, sync: sync / k, frame: frame / k, flush: (performance.now() - g0) / k });
          }
        } finally { window.requestAnimationFrame = real; }
        return out;
      }, { MOVES, perFrame, pts: points(MOVES) });
      const counter1 = await page.evaluate(() => (window.__uqaPaintCount ? { ...window.__uqaPaintCount } : null));
      modes[`${perFrame} per frame`] = {
        frames: frames.length,
        sync: stats(frames.map((f) => f.sync)),
        frame: stats(frames.map((f) => f.frame)),
        flush: stats(frames.map((f) => f.flush)),
        total: stats(frames.map((f) => f.sync + f.frame + f.flush)),
        paintCount: counter1 && counter0 ? { full: counter1.full - counter0.full, fast: counter1.fast - counter0.fast } : 'not in this build',
      };
      log(`${label}: ${perFrame} per frame done`);
    }
    await page.mouse.up();
    if (errors.length) throw new Error(`${label}: page errors: ${errors.join(' | ')}`);
    return { label, image: `${W}x${H}`, shapes: drawn, moves: MOVES, modes };
  } finally {
    await ctx.close();
  }
}

const rows = [];
try {
  const before = execFileSync('git', ['-C', REPO, 'show', `${BEFORE_REF}:extension/annotate/annotate.js`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (/scheduleRender|__uqaPaintCount/.test(before)) throw new Error(`${BEFORE_REF} already carries the T-072 repaint; pick the commit before it`);
  rows.push(await measure('before', build('perf-before', before)));
  rows.push(await measure('after', build('perf-after')));
} finally {
  for (const dir of scratch) { // R12: the recycle bin, never rm -rf
    if (fs.existsSync(dir)) { try { recycle(dir); } catch { /* leave it named below */ } }
  }
}

console.log(`
annotate repaint cost PER POINTER MOVE, ${W}x${H}, 8 committed shapes + 1 preview, ${MOVES} moves per mode (ms; main thread, headless, harness-driven frames)`);
console.table(rows.flatMap((r) => Object.entries(r.modes).map(([mode, m]) => ({
  build: r.label, 'moves/frame': mode.split(' ')[0], frames: m.frames,
  'handler med': m.sync.median, 'frame med': m.frame.median, 'flush med': m.flush.median,
  'total med': m.total.median, 'total p95': m.total.p95,
  paint: typeof m.paintCount === 'string' ? m.paintCount : JSON.stringify(m.paintCount),
}))));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ref: BEFORE_REF, rows }, null, 2));
