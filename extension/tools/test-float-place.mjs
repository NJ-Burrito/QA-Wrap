/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * `placeFloat()` (`background/float-place.js`), table-driven.
 *
 *   node tools/test-float-place.mjs
 *
 * Pure arithmetic, no `chrome.*`, so every case in S4's table
 * (`work/ui-rework-0927/IMPLEMENTATION-PLAN.md`) is one row here rather than
 * one manual click in a real browser window.
 */
import assert from 'node:assert/strict';
import { placeFloat } from '../background/float-place.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const SIZE = { w: 560, h: 720 };
const SCREEN = { left: 0, top: 0, width: 1920, height: 1040 };

console.log('float placement — table');

test('a maximised browser opens over the page', () => {
  const anchor = { left: 0, top: 0, width: 1920, height: 1040 };
  const r = placeFloat({ stored: null, anchor, workAreas: [SCREEN], size: SIZE });
  // Over the page, top-right of the anchor: left of the anchor's right edge, at the top.
  assert.ok(r.left < anchor.left + anchor.width && r.left > anchor.width / 2, `left ${r.left} is not top-right`);
  assert.equal(r.width, 560);
  assert.equal(r.height, 720);
  assert.equal(r.migrate, false);
});

test('a 1280-wide browser on a 1920 screen opens on the right', () => {
  const anchor = { left: 0, top: 0, width: 1280, height: 800 };
  const r = placeFloat({ stored: null, anchor, workAreas: [SCREEN], size: SIZE });
  assert.ok(r.left >= anchor.left + anchor.width, `left ${r.left} is not beside the right edge`);
  assert.equal(r.width, 560);
  assert.equal(r.height, 720);
});

test('room on the left only opens on the left', () => {
  const anchor = { left: 1360, top: 50, width: 560, height: 800 };
  const r = placeFloat({ stored: null, anchor, workAreas: [SCREEN], size: SIZE });
  assert.ok(r.left + r.width <= anchor.left, `right edge ${r.left + r.width} does not clear the anchor's left side`);
  assert.equal(r.width, 560);
});

test('room on neither side opens over the page', () => {
  const anchor = { left: 100, top: 50, width: 1720, height: 800 };
  const r = placeFloat({ stored: null, anchor, workAreas: [SCREEN], size: SIZE });
  assert.ok(r.left + r.width <= anchor.left + anchor.width, 'not clamped inside the anchor on the right');
  assert.ok(r.left >= anchor.left, 'not over the page at all');
});

test('a stored spot on a monitor that is gone falls back to the anchor', () => {
  const anchor = { left: 0, top: 0, width: 1280, height: 800 };
  const stored = { left: 5000, top: 100, width: 560, height: 720, floatBoundsV: 2 };
  const r = placeFloat({ stored, anchor, workAreas: [SCREEN], size: SIZE });
  assert.ok(r.left >= anchor.left + anchor.width, 'did not fall back to beside the anchor');
  assert.equal(r.migrate, false);
});

test('a stored 392px-wide float migrates once, to 560x720', () => {
  const anchor = { left: 0, top: 0, width: 1280, height: 800 };
  const stored = { left: 200, top: 150, width: 392, height: 660 };
  const r = placeFloat({ stored, anchor, workAreas: [SCREEN], size: SIZE });
  assert.equal(r.width, 560);
  assert.equal(r.height, 720);
  assert.equal(r.left, 200, 'left/top are kept across the migration');
  assert.equal(r.top, 150);
  assert.equal(r.migrate, true);

  // Second open, storage now carries the marker: same size, no re-migration.
  const already = placeFloat({
    stored: { left: 200, top: 150, width: 560, height: 720, floatBoundsV: 2 },
    anchor,
    workAreas: [SCREEN],
    size: SIZE,
  });
  assert.equal(already.migrate, false);
});

test('after the migration, a user who resizes to 380 keeps 380', () => {
  const anchor = { left: 0, top: 0, width: 1280, height: 800 };
  const stored = { left: 200, top: 150, width: 380, height: 600, floatBoundsV: 2 };
  const r = placeFloat({ stored, anchor, workAreas: [SCREEN], size: SIZE });
  assert.equal(r.width, 380);
  assert.equal(r.height, 600);
  assert.equal(r.migrate, false);
});

test('a 500x600 browser clamps the float to fit inside it', () => {
  const anchor = { left: 0, top: 0, width: 500, height: 600 };
  // No system.display permission: workAreas is [], same as route (b).
  const r = placeFloat({ stored: null, anchor, workAreas: [], size: SIZE });
  assert.equal(r.width, 500);
  assert.equal(r.height, 600);
  assert.ok(r.left >= 0 && r.left + r.width <= 500, `left ${r.left} width ${r.width} overflow the anchor`);
  assert.ok(r.top >= 0 && r.top + r.height <= 600, `top ${r.top} height ${r.height} overflow the anchor`);
});

test('called the way the worker calls it (no size) every bound is a whole pixel', () => {
  // The worker once passed `{ width, height }`; `size.w` was undefined and every
  // windows.create failed with "Invalid type: expected integer, found number".
  const anchor = { left: 60, top: 60, width: 1280, height: 900 };
  const r = placeFloat({ stored: null, anchor, workAreas: [{ left: 0, top: 0, width: 1536, height: 912 }] });
  for (const k of ['left', 'top', 'width', 'height']) assert.ok(Number.isInteger(r[k]), `${k} is ${r[k]}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
