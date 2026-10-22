/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// T-031: the listing images carry the build version, were shot from the current ui/ popup/ content/ report/ replay/ annotate/ (T-058),
// and the site copies are the store images.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sourceHash, SHOT_SURFACES, SHOTS_SOURCE_FILE } from './shots-source.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;
const shots = fs.readdirSync(path.join(EXT, 'store/shots')).filter((f) => f.endsWith('.png'));
const imgs = [...shots.map((f) => `store/shots/${f}`), `store/promo-440x280-${v}.png`, `store/promo-1400x560-${v}.png`];
for (const f of imgs) assert.ok(f.endsWith(`-${v}.png`), `${f} must carry ${v}`);
// T-058: the pictures were shot from the surfaces as they are now (a content hash, not an mtime; covers content/, report/, replay/, annotate/ too).
const shot = JSON.parse(fs.readFileSync(path.join(EXT, SHOTS_SOURCE_FILE), 'utf8'));
assert.equal(shot.version, v, 'shots-source.json is for another version');
assert.equal(shot.sourceHash, sourceHash(EXT), `the listing images are stale: ${SHOT_SURFACES.join('/, ')}/ changed since they were shot (run tools/ui-shots.mjs then tools/store-shots.mjs)`);
const site = path.join(EXT, '..', 'site');
const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
for (const f of shots) {
  assert.ok(html.includes(`assets/shots/${f}`), `site/index.html does not use ${f}`);
  assert.ok(fs.readFileSync(path.join(site, 'assets/shots', f)).equals(fs.readFileSync(path.join(EXT, 'store/shots', f))), `site copy of ${f} differs`);
}
// T-058: the five shots tell the story in this order, the hero is a failure (never "Passed"), the bar shot carries the problems chip.
assert.deepEqual(shots.map((f) => f.replace(`-${v}.png`, '').replace(/^\d-/, '')), ['report-broke', 'popup-recording', 'inpage-bar', 'inpage-palette', 'report-filing'], 'listing shots are not the T-058 five in order');
const alts = [...html.matchAll(/<img src="assets\/shots\/[^"]+"[^>]*alt="([^"]*)"/g)].map((m) => m[1]);
assert.ok(alts.length >= 10, 'site alt texts missing');
assert.ok(!alts.some((a) => /passed/i.test(a.replace(/nothing says Passed/i, ''))), 'a site shot alt claims Passed');
assert.ok(alts.some((a) => /Failed badge/.test(a)) && alts.some((a) => /problems chip reading 4/.test(a)), 'hero/bar alts lost the failure and the chip');
const board = fs.readFileSync(path.join(EXT, 'tools/store-shots.mjs'), 'utf8');
const ui = fs.readFileSync(path.join(EXT, 'tools/ui-shots.mjs'), 'utf8');
assert.ok(!/Passed/.test(board.slice(board.indexOf('const BOARDS'), board.indexOf('const board ='))), 'a board caption says Passed');
assert.ok(/shoot\('inpage-bar'/.test(ui) && /shoot\('report-filing'/.test(ui), 'ui-shots no longer produces the bar and filing sources');
console.log(`test-listing-assets: ${imgs.length} images carry ${v}, were shot from the current surfaces, site copies match`);
