/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt lane B: the feature map (owner amend 2026-10-12: every level teaches one real QA Wrap feature).
 * game/features.json must name each feature exactly as the extension does (EN and AR), use icons that exist, agree with the
 * scoring table and the level modules, and keep each lesson to one short line. Plain node.
 *
 *   node tools/test-game-b-features.mjs        (from extension/, PYTHONUTF8=1)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from './lib-paths.mjs';
import { GAME_DIR, imp, runner } from './lib-game-b.mjs';

const { test, done } = runner('Bug Hunt feature map (lane B)');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));
const F = read(GAME_DIR, 'features.json');
const SC = read(GAME_DIR, 'scoring.json');
const en = read(EXT, 'platform', 'i18n', 'en.json');
const ar = read(EXT, 'platform', 'i18n', 'ar.json');
const locEn = read(EXT, '_locales', 'en', 'messages.json');
const locAr = read(EXT, '_locales', 'ar', 'messages.json');
const iconSrc = fs.readFileSync(path.join(EXT, 'ui', 'icons.js'), 'utf8');
const iconIds = new Set([...iconSrc.matchAll(/"([a-z][a-z0-9-]*)":"</g)].map((m) => m[1]));
const S = await imp('scoring.js');
const mods = {};
for (let k = 1; k <= 5; k++) mods[k] = await imp(`levels/l${k}.js`);

await test('every feature name is the extension\'s own label, EN and AR, read from its source file (not retyped)', () => {
  for (const [id, f] of Object.entries(F.features)) {
    const { file, key } = f.source;
    if (file === 'platform/i18n') { assert.equal(f.en, en[key], `${id} en`); assert.equal(f.ar, ar[key], `${id} ar`); }
    else if (file === '_locales') { assert.equal(f.en, locEn[key].message, `${id} en`); assert.equal(f.ar, locAr[key].message, `${id} ar`); } else assert.fail(`${id}: unknown source ${file}`);
    assert.ok(f.en && f.ar, id);
  }
  assert.equal(F.features.wake.en, 'Test this site');
  assert.equal(F.features.notbug.en, 'Not a bug');
  assert.equal(F.features.stop.en, 'Stop');
  assert.equal(F.features.copy.en, 'Copy report');
  assert.equal(F.features.buffer.en, 'Save last 2 minutes');
  assert.equal(F.features.shortcut.keys, 'Alt+Shift+Q');
  const manifest = read(EXT, 'manifest.json');
  assert.equal(manifest.commands['toggle-recording'].suggested_key.default, 'Alt+Shift+Q', 'the shortcut is the real one');
});

await test('every icon id exists in the extension\'s icon family', () => {
  assert.ok(iconIds.size > 60, `${iconIds.size} icons parsed`);
  for (const [id, f] of Object.entries(F.features)) assert.ok(iconIds.has(f.icon), `${id}: icon ${f.icon}`);
});

await test('five levels, each with a primary feature, valid references, one short lesson in both languages', () => {
  assert.deepEqual(Object.keys(F.levels), ['1', '2', '3', '4', '5']);
  const wanted = { 1: 'wake', 2: 'recorder', 3: 'note', 4: 'shot', 5: 'stop' };
  for (const [k, L] of Object.entries(F.levels)) {
    assert.equal(L.primary, wanted[k], `L${k} primary`);
    for (const id of [L.primary, ...L.with, ...L.extras]) assert.ok(F.features[id], `L${k} references ${id}`);
    for (const id of L.extras) assert.ok(F.chips[id], `L${k}: extra ${id} has chip wording`);
    for (const lang of ['en', 'ar']) {
      const line = L.learn[lang];
      assert.ok(line && line.split(/\s+/).length <= 20, `L${k} ${lang} lesson length`);
      assert.ok(!/[&+]/.test(line) && !/\n/.test(line), `L${k} ${lang}: one plain line`);
    }
  }
  assert.deepEqual(F.levels['2'].with, ['notbug']);
  assert.deepEqual(F.levels['5'].with, ['copy']);
  assert.deepEqual(F.levels['5'].extras, ['buffer']);
  assert.deepEqual(F.levels['1'].extras, ['shortcut']);
});

await test('wording rules: no banned term, no "&" or "+" in a chip, EN and AR both present', () => {
  const banned = /photograph|harvest|crosshair|\barm(ed)?\b|stop & review|picture/i;
  const strings = [];
  for (const f of Object.values(F.features)) strings.push(f.en);
  for (const c of Object.values(F.chips)) { assert.ok(c.en && c.ar); strings.push(c.en, c.ar); assert.ok(!/[&+]/.test(c.en + c.ar)); }
  for (const L of Object.values(F.levels)) strings.push(L.learn.en);
  for (const s of strings) assert.doesNotMatch(s, banned, s);
  for (const c of Object.values(F.chips)) assert.ok(c.en.split(/\s+/).length <= 6);
});

await test('scoring table and feature map agree: every feature and prove tool is a scoring tool; every chip a level offers has a scoring row', () => {
  for (const id of Object.keys(F.features)) assert.ok(SC.tools[id], `scoring tool for feature ${id}`);
  for (const [k, tool] of Object.entries(S.PROVE_TOOL)) { assert.ok(SC.tools[tool], `prove tool ${tool}`); assert.ok(F.features[tool], `prove tool ${tool} is a feature`); assert.equal(F.levels[k].primary === tool || F.levels[k].with.includes(tool) || F.levels[k].extras.includes(tool), true, `L${k} teaches its prove tool`); }
  for (let k = 1; k <= 5; k++) {
    for (const c of mods[k].chips) { assert.ok(S.ruleFor(c.tool, 'chip'), `chip ${c.id} has a rule`); assert.ok(F.levels[k].extras.includes(c.id), `L${k}: chip ${c.id} is listed as an extra`); }
    for (const id of F.levels[k].extras) if (id !== 'stop') assert.ok(mods[k].chips.some((c) => c.id === id), `L${k}: extra ${id} is claimable`);
  }
  assert.deepEqual(mods[2].catchFeature, { tool: 'recorder', kind: 'caught' });
  assert.equal(S.ruleFor('recorder', 'caught').points, 50);
  assert.equal(S.ruleFor('notbug', 'chip').points, 100);
  assert.deepEqual(S.TOOLS, ['page', 'wake', 'shortcut', 'recorder', 'notbug', 'note', 'notetype', 'shot', 'markup', 'stop', 'copy', 'buffer']);
});

await test('deductions stay keyed to the right feature: note, shot, stop, copy and the page decoy; chips can never lose points', () => {
  const wrong = S.RULES.filter((r) => r.outcome === 'wrong').map((r) => `${r.tool}/${r.kind}`).sort();
  assert.deepEqual(wrong, ['copy/no-bug', 'note/duplicate', 'note/early', 'page/decoy', 'shot/early', 'shot/wrong-level', 'stop/early']);
  for (const r of S.RULES.filter((x) => x.kind === 'chip')) assert.ok(r.points >= 0 && r.outcome === 'correct', `${r.tool} chip`);
});

done();
