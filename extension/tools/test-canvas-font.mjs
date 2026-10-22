/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-024: every glyph the markup and video editors burn into evidence is set in Thmanyah, and the editor waits
 * for the face once before first paint. Node-only: a recording canvas context catches each `ctx.font` the
 * shared drawing engine sets; the real `document.fonts.check` in Chrome is measured by tools/self-a11y.mjs.
 *
 *   node tools/test-canvas-font.mjs
 */
import assert from 'node:assert/strict';
import * as Shapes from '../core/shapes.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log(`  ok  ${name}`); }, (err) => { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); });
}

function recordingCtx() {
  const fonts = [];
  const target = { measureText: (t) => ({ width: String(t).length * 8 }), createLinearGradient: () => ({ addColorStop() {} }) };
  const ctx = new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: (t, k, v) => { if (k === 'font') fonts.push(v); t[k] = v; return true; },
  });
  return { ctx, fonts };
}

console.log('canvas text — Thmanyah first, never a system face');

await test('the typed label, the question mark and the exclamation mark set Thmanyah first', () => {
  for (const s of [
    { tool: 'text', text: 'عنوان الخطأ / Error', colour: '#B5432B', fontSize: 22, x: 10, y: 30, w: 0, h: 0 },
    { tool: 'question', colour: '#B5432B', fontSize: 22, x: 40, y: 40, w: 60, h: 60 },
    { tool: 'exclaim', colour: '#B5432B', fontSize: 22, x: 40, y: 40, w: 60, h: 60 },
    { tool: 'step', n: 1, colour: '#B5432B', fontSize: 22, x: 40, y: 40, w: 0, h: 0 },
  ]) {
    const { ctx, fonts } = recordingCtx();
    Shapes.drawShape(ctx, s, {});
    assert.ok(fonts.length > 0, `${s.tool} set no font at all, so the test saw nothing`);
    for (const f of fonts) assert.match(f, /\d+px "Thmanyah Sans"/, `${s.tool} was drawn in "${f}"`);
  }
});

await test('ensureCanvasFont loads the weights and resolves true once the face checks out', async () => {
  const loaded = [];
  globalThis.document = { fonts: { load: async (spec) => { loaded.push(spec); }, check: (spec) => /Thmanyah Sans/.test(spec) } };
  try {
    assert.equal(await Shapes.ensureCanvasFont(), true);
    assert.ok(loaded.some((s) => s.startsWith('700 ')), 'the bold weight was never requested');
    const before = loaded.length;
    await Shapes.ensureCanvasFont();
    assert.equal(loaded.length, before, 'the face is awaited once per page, not once per call');
  } finally { delete globalThis.document; }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
