/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// r363: the note-box overflow slider (thumb maths, LTR and RTL, hidden without overflow) and the per-dist rating link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { thumbModel, scrollForFraction } from '../popup/note-slider.js';
import { rateUrl, RATE_TARGETS, GITHUB_REPO } from '../core/rate-links.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(EXT, ...p), 'utf8');

test('slider is hidden when the text fits', () => {
  assert.equal(thumbModel(0, 200, 200).visible, false);
  assert.equal(thumbModel(0, 200, 150).visible, false);
  assert.equal(thumbModel(0, 0, 0).visible, false);
});
test('thumb size = visible / total, position follows scrollLeft', () => {
  const a = thumbModel(0, 100, 400);
  assert.equal(a.visible, true); assert.equal(a.size, 0.25); assert.equal(a.pos, 0);
  const mid = thumbModel(150, 100, 400); // max scroll 300
  assert.ok(Math.abs(mid.pos - 0.375) < 1e-9);
  const end = thumbModel(300, 100, 400);
  assert.ok(Math.abs(end.pos - 0.75) < 1e-9 && Math.abs(end.pos + end.size - 1) < 1e-9);
});
test('RTL: negative scrollLeft gives the same thumb, measured from the start side', () => {
  assert.deepEqual(thumbModel(-150, 100, 400), thumbModel(150, 100, 400));
  assert.equal(thumbModel(0, 100, 400).pos, 0);
});
test('a tiny visible part keeps a grabbable thumb', () => {
  assert.equal(thumbModel(0, 10, 10000).size, 0.08);
});
test('dragging: pointer fraction maps back to scrollLeft, signed for RTL, clamped', () => {
  assert.equal(scrollForFraction(0, 100, 400, false), 0);
  assert.equal(scrollForFraction(1, 100, 400, false), 300);
  assert.equal(scrollForFraction(1, 100, 400, true), -300);
  assert.ok(Math.abs(scrollForFraction(0.5, 100, 400, false) - 150) < 1e-9);
  // round trip: the thumb for that scroll sits centred on the pointer
  const s = scrollForFraction(0.6, 100, 400, true);
  const m = thumbModel(s, 100, 400);
  assert.ok(Math.abs(m.pos + m.size / 2 - 0.6) < 1e-9);
});
test('slider is a data-live scrollbar indicator bound to the note box, not a control', () => {
  const js = read('popup', 'note-slider.js');
  assert.match(js, /role', 'scrollbar'/); assert.match(js, /aria-controls', 'note-text'/); assert.match(js, /aria-valuenow/); assert.match(js, /dataset\.live/);
  assert.doesNotMatch(js, /createElement\('(button|input)'\)/);
  assert.match(read('popup', 'popup.html'), /src="note-slider\.js"/);
});
test('rating link: one map per dist, empty placeholder falls back to GitHub', () => {
  assert.equal(GITHUB_REPO, 'https://github.com/NJ-Burrito/QA-Wrap');
  for (const d of ['chrome', 'edge', 'firefox', 'opera', 'operagx', 'brave', 'duckduckgo', 'safari', 'nope']) assert.equal(rateUrl(d), GITHUB_REPO, d);
  assert.equal(rateUrl('edge', { ...RATE_TARGETS, edge: 'https://microsoftedge.microsoft.com/addons/detail/x' }), 'https://microsoftedge.microsoft.com/addons/detail/x');
  assert.equal(rateUrl('firefox', { ...RATE_TARGETS, firefox: 'https://addons.mozilla.org/x' }), 'https://addons.mozilla.org/x');
  assert.equal(rateUrl('opera', { ...RATE_TARGETS, opera: 'https://addons.opera.com/x' }), 'https://addons.opera.com/x');
  assert.deepEqual(Object.keys(RATE_TARGETS).sort(), ['chrome', 'edge', 'firefox', 'opera', 'operagx']);
});
test('the build stamps BUILD_DIST per dist and the links read rateUrl()', () => {
  assert.match(read('tools', 'build-browsers.mjs'), /BUILD_DIST = '\$\{id\}'/);
  assert.match(read('core', 'rate-links.js'), /^export const BUILD_DIST = 'chrome';/m);
  assert.match(read('options', 'options.js'), /rateUrl\(\)/);
  assert.match(read('welcome', 'welcome.js'), /rateUrl\(\)/);
});
