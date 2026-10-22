/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * ann1022: marks are objects you can pick, move and erase, and in the video editor
 * they carry keyframes. `core/objects.js` is pure, so this runs without a browser.
 *
 *   node tools/test-objects-1022.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as O from '../core/objects.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* hit-test: the topmost object under the point wins; thin lines need a near click */
const list = [
  { tool: 'rect', x: 10, y: 10, w: 100, h: 60, width: 4 },
  { tool: 'line', x: 0, y: 200, w: 100, h: 0, width: 4 },
  { tool: 'text', x: 50, y: 30, text: 'Hi', fontSize: 20 },
  { tool: 'tick', x: 300, y: 300, fontSize: 22, width: 4 },
  { tool: 'pen', points: [{ x: 400, y: 400 }, { x: 450, y: 450 }], width: 4 },
];
assert.equal(O.hitTest(list, { x: 55, y: 35 }), 2, 'text sits above the rect it overlaps');
assert.equal(O.hitTest(list, { x: 20, y: 60 }), 0);
assert.equal(O.hitTest(list, { x: 50, y: 203 }), 1, 'a click near a line hits it');
assert.equal(O.hitTest(list, { x: 50, y: 230 }), -1, 'a click far from a line does not');
assert.equal(O.hitTest(list, { x: 305, y: 295 }), 3, 'a stamped mark is hit around its press');
assert.equal(O.hitTest(list, { x: 425, y: 425 }), 4, 'a pen stroke is hit along its path');
assert.equal(O.hitTest(list, { x: 425, y: 400 }), -1, 'not in the stroke bounding box corner');
assert.equal(O.hitTest(list, { x: 55, y: 35 }, (_o, i) => i !== 2), 0, 'a hidden object is skipped');

/* move: shape and pen stroke keep their form */
const rect = { ...list[0] };
O.moveBy(rect, 15, -5);
assert.deepEqual([rect.x, rect.y, rect.w, rect.h], [25, 5, 100, 60]);
const pen = JSON.parse(JSON.stringify(list[4]));
O.moveBy(pen, 10, 10);
assert.deepEqual(pen.points[1], { x: 460, y: 460 });

/* erase is a splice of exactly the picked object, and undo puts it back in place */
const objs = list.slice();
const i = O.hitTest(objs, { x: 20, y: 60 });
const [gone] = objs.splice(i, 1);
assert.equal(objs.length, 4);
objs.splice(i, 0, gone);
assert.equal(objs[0], gone);

/* keyframes: linear glide, hold at both ends, text steps at its key */
const box = { tool: 'rect', x: 0, y: 0, w: 10, h: 10, from: 1000, to: 9000 };
assert.equal(O.resolveAt(box, 5000), box, 'no keys: the object itself');
O.setKey(box, 3000, { x: 0, y: 0 });
O.setKey(box, 7000, { x: 100, y: 40 });
assert.deepEqual(box.keys.map((k) => k.t), [1000, 3000, 7000], 'the first key also pins the original spot at the start');
const mid = O.resolveAt(box, 5000);
assert.deepEqual([mid.x, mid.y], [50, 20], 'halfway in time is halfway in space');
assert.deepEqual([O.resolveAt(box, 2000).x, O.resolveAt(box, 8500).x], [0, 100], 'held before the first and after the last key');
assert.equal(box.x, 0, 'resolving never edits the stored object');
O.setKey(box, 7000, { x: 80, y: 40 });
assert.equal(box.keys.length, 3, 'a key at the same time is replaced');

const label = { tool: 'text', x: 5, y: 5, text: 'Loading', fontSize: 20, from: 0, to: 10000 };
O.setKey(label, 4000, { x: 5, y: 5, text: 'Loading' });
O.setKey(label, 6000, { x: 105, y: 5, text: 'Done' });
assert.equal(O.resolveAt(label, 5999).text, 'Loading');
assert.equal(O.resolveAt(label, 6000).text, 'Done', 'the text switches at its key');
assert.equal(O.resolveAt(label, 9000).text, 'Done');
assert.equal(Math.round(O.resolveAt(label, 5000).x), 55, 'and the text glides while it waits');

const stroke = { tool: 'pen', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], from: 0, to: 100 };
O.setKey(stroke, 50, { x: 20, y: 0 });
O.setKey(stroke, 100 - 1, { x: 40, y: 0 });
const s2 = O.resolveAt(stroke, 99);
assert.deepEqual(s2.points[1], { x: 50, y: 10 }, 'a pen stroke keeps its shape while it travels');

/* dragging at a time: unkeyed objects move, keyed ones get a key there */
const plain = { tool: 'rect', x: 0, y: 0, w: 5, h: 5, from: 0, to: 100 };
O.dragAt(plain, 50, 7, 3);
assert.deepEqual([plain.x, plain.y, plain.keys], [7, 3, undefined]);
const keyed = { tool: 'rect', x: 0, y: 0, w: 5, h: 5, from: 0, to: 100 };
O.setKey(keyed, 0, { x: 0, y: 0 });
O.dragAt(keyed, 60, 30, 0);
assert.deepEqual(keyed.keys.map((k) => [k.t, k.x]), [[0, 0], [60, 30]]);
assert.equal(O.resolveAt(keyed, 30).x, 15);

/* the pages wire it, and every string is in both languages */
const en = JSON.parse(fs.readFileSync(path.join(root, 'platform/i18n/en.json'), 'utf8'));
const ar = JSON.parse(fs.readFileSync(path.join(root, 'platform/i18n/ar.json'), 'utf8'));
const keys = Object.keys(en).filter((k) => /^(annotate|videoedit)\.obj\./.test(k));
assert.ok(keys.length >= 10);
for (const k of keys) assert.ok(ar[k], `${k} is missing in Arabic`);
for (const k of Object.keys(ar).filter((k) => /^(annotate|videoedit)\.obj\./.test(k))) assert.ok(en[k], `${k} is missing in English`);
const hint = en['videoedit.obj.hint'].split(/\s+/).length;
assert.ok(hint <= 25, `hint is ${hint} words`);
for (const page of ['annotate/annotate', 'videoedit/videoedit']) {
  const html = fs.readFileSync(path.join(root, `${page}.html`), 'utf8');
  assert.match(html, /data-tool="select"/, `${page}: Move tool`);
  assert.match(html, /data-tool="erase"/, `${page}: Erase tool`);
}
const ve = fs.readFileSync(path.join(root, 'videoedit/videoedit.js'), 'utf8');
assert.match(ve, /Obj\.resolveAt\(o, ms\)/, 'the export burns the animated position, not the stored one');
for (const id of ['obj-start', 'obj-end', 'obj-key', 'obj-remove', 'obj-text', 'obj-track']) {
  assert.ok(fs.readFileSync(path.join(root, 'videoedit/videoedit.html'), 'utf8').includes(`id="${id}"`), id);
}
console.log('test-objects-1022: ok');
