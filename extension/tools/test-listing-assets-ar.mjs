/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// T-058: the Arabic listing set. Same five pictures as the English set, same order, same build, boards read right to left,
// the site carries identical copies, and the sources still make the Arabic pass (bar chip and filing dialog in Arabic).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;
const names = ['report-broke', 'popup-recording', 'inpage-bar', 'inpage-palette', 'report-filing'].map((n, i) => `${i + 1}-${n}-${v}.png`);
const ar = path.join(EXT, 'store/shots/ar');
assert.deepEqual(fs.readdirSync(ar).filter((f) => f.endsWith('.png')).sort(), names, 'the Arabic set is not the five shots in order');
const site = path.join(EXT, '..', 'site/assets/shots/ar');
const png = (f) => fs.readFileSync(f);
for (const f of names) {
  const b = png(path.join(ar, f));
  assert.equal(b.readUInt32BE(16) + 'x' + b.readUInt32BE(20), '1280x800', `${f} is not 1280x800`);
  assert.ok(b.equals(png(path.join(site, f))), `site copy of ar/${f} differs`);
  assert.ok(!png(path.join(EXT, 'store/shots', f)).equals(b), `ar/${f} is the English picture`); // the Arabic pass must change the pixels
}
// completion review 11: the Arabic section of the site shows the Arabic pictures, the English section the English ones.
const page = fs.readFileSync(path.join(EXT, '..', 'site/index.html'), 'utf8');
for (const f of names) {
  assert.equal(page.split(`src="assets/shots/ar/${f}"`).length - 1, 1, `site/index.html does not show ar/${f} once`);
  assert.equal(page.split(`src="assets/shots/${f}"`).length - 1, 1, `site/index.html does not show the English ${f} once`);
}
const ui = fs.readFileSync(path.join(EXT, 'tools/ui-shots.mjs'), 'utf8');
const board = fs.readFileSync(path.join(EXT, 'tools/store-shots.mjs'), 'utf8');
assert.ok(/--lang=ar/.test(ui) && /qawLanguage: 'ar'/.test(ui), 'ui-shots lost its Arabic pass');
assert.ok(/inpage-bar: not ready/.test(ui) && /filing: the dialog is not open/.test(ui), 'the Arabic pass no longer asserts the bar and the filing dialog before shooting');
const ba = board.slice(board.indexOf('const BOARDS_AR'), board.indexOf('const board ='));
assert.equal((ba.match(/\.png', '/g) || []).length, 5, 'BOARDS_AR is not five boards');
assert.ok(!/Passed|[A-Za-z]{4,} [a-z]{3,} [a-z]{3,}/.test(ba.replace(/ISTQB|Jira|POST|\/api\/applications/g, '')), 'an Arabic board caption carries an English sentence');
assert.ok(/dir="\$\{AR \? 'rtl'/.test(board), 'Arabic boards are not right to left');
console.log(`test-listing-assets-ar: 5 Arabic pictures carry ${v}, 1280x800, differ from English, site copies match`);
