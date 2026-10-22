/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-060 (WCAG 2.1.1, 2.5.7): the two editors, driven by a real keyboard in a real browser.
 *
 * A clip or an image is stored, the editor opens on it, and with the stage focused Tab-style (focus(), then real key
 * presses) Enter places the current tool, the arrows move it and + / - size it. Nothing here uses the mouse.
 * R15: each run first asserts the stage is ready (the canvas has the media's size) and that a known-true step
 * (Enter on a fresh stage adds exactly one shape) moved the counter before it checks the moves.
 *
 *   node tools/test-editors-keyboard-live.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { grantedExtension } from './lib-granted.mjs';

let passed = 0;
const failures = [];
const ok = (name) => { passed++; console.log(`  ok  ${name}`); };
const bad = (name, e) => { failures.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); };

const ext = grantedExtension({ label: 's1001c-kbd' });
const profile = path.join(os.tmpdir(), `uqa-s1001c-kbd-${Date.now().toString(36)}`);
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu'],
});
try {
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
  const id = new URL(sw.url()).host;
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`chrome-extension://${id}/annotate/annotate.html`);
  await page.evaluate(async () => {
    const { putMedia, putSession } = await import('/core/db.js');
    await putSession({ id: 'kbd-session', startedAt: Date.now(), name: 'kbd' });
    const c = new OffscreenCanvas(800, 500);
    const g = c.getContext('2d'); g.fillStyle = '#dde'; g.fillRect(0, 0, 800, 500);
    await putMedia({ id: 'kbd-img', type: 'image/png', blob: await c.convertToBlob({ type: 'image/png' }), label: 'kbd', sessionId: 'kbd-session', createdAt: Date.now() });
    // A one-second clip, recorded from a canvas, for the video editor.
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360;
    const cx = cv.getContext('2d'); const rec = new MediaRecorder(cv.captureStream(15), { mimeType: 'video/webm' });
    const parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });
    rec.start(); const t0 = performance.now();
    await new Promise((r) => { const tick = () => { cx.fillStyle = `hsl(${(performance.now() - t0) / 5} 60% 50%)`; cx.fillRect(0, 0, 640, 360); if (performance.now() - t0 < 1200) requestAnimationFrame(tick); else r(); }; tick(); });
    rec.stop(); await done;
    await putMedia({ id: 'kbd-clip', type: 'video/webm', blob: new Blob(parts, { type: 'video/webm' }), label: 'kbd', sessionId: 'kbd-session', createdAt: Date.now(), durationMs: 1200 });
  });

  /* ── the markup editor ─────────────────────────────────────────────── */
  try {
    await page.goto(`chrome-extension://${id}/annotate/annotate.html?id=kbd-img`);
    await page.waitForFunction(() => document.getElementById('canvas')?.width === 800, null, { timeout: 15000 });
    await page.evaluate(() => document.getElementById('canvas').focus());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'canvas', 'the stage takes keyboard focus');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => shapes.length), 1, 'Enter places the current tool (known-true step)');
    const before = await page.evaluate(() => ({ ...shapes[0] }));
    assert.deepEqual([before.x, before.y, before.w, before.h], [280, 200, 240, 100]);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('+');
    const after = await page.evaluate(() => ({ ...shapes[0] }));
    assert.equal(after.x + after.w / 2, before.x + before.w / 2 + 1, 'an arrow moved it one pixel');
    assert.equal(after.y + after.h / 2, before.y + before.h / 2 + 10, 'Shift moved it ten');
    assert.ok(Math.abs(after.w - before.w * 1.1) < 0.01, 'plus sized it by a tenth');
    await page.evaluate(() => document.querySelector('[data-tool="step"]').click());
    await page.evaluate(() => document.getElementById('canvas').focus());
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => shapes.length), 2);
    assert.deepEqual(errors, []);
    ok('annotate: Enter places, arrows move, plus sizes, and a step badge is stamped, with the keyboard alone');
  } catch (e) { bad('annotate: keyboard-only placement', e); }

  /* ── the video editor ──────────────────────────────────────────────── */
  try {
    await page.goto(`chrome-extension://${id}/videoedit/videoedit.html?id=kbd-clip`);
    await page.waitForFunction(() => document.getElementById('overlay')?.width === 640 && document.getElementById('overlay')?.height === 360 && !!document.getElementById('scrub'), null, { timeout: 20000 });
    await page.evaluate(() => document.getElementById('overlay').focus());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'overlay');
    const undoOff = () => page.evaluate(() => document.getElementById('undo').disabled);
    const status = () => page.evaluate(() => document.getElementById('status').textContent);
    assert.equal(await undoOff(), true, 'a fresh clip has nothing to undo');
    await page.keyboard.press('Enter');
    assert.equal(await undoOff(), false, 'Enter placed the current tool (known-true step: there is now something to undo)');
    await page.keyboard.press('ArrowLeft');
    assert.match(await status(), /Moved to 223, 144/, 'an arrow moved the placed box one pixel (centred at 224, 144 in a 640 by 360 clip)');
    await page.keyboard.press('+');
    assert.equal(await status(), 'Resized.');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
    assert.equal(await undoOff(), true, 'place, move and size are three undo steps, and undo takes them all back');
    assert.deepEqual(errors, []);
    ok('videoedit: Enter places, arrows move, plus sizes, undo takes it back, with the keyboard alone');
  } catch (e) { bad('videoedit: keyboard-only placement', e); }
} finally {
  await ctx.close().catch(() => {});
  for (const d of [profile]) fs.rmSync(d, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
