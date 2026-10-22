/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The UI round 2 icon family (DESIGN-SPEC §10, IMPLEMENTATION-PLAN.md S2).
 *
 *   node tools/test-icons.mjs
 *
 * Reads only identity/icons/ui/* (the tracked manifest and the drawings,
 * copied once from the prototype, already green there) and ui/icons.js (what
 * tools/build-ui-icons.mjs generated from them). No browser, no work/ read
 * (D2): the rules are ported from prototype/icons/_check.py, not re-derived.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const SRC = path.resolve(EXT, '..', 'identity', 'icons', 'ui');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const meta = JSON.parse(fs.readFileSync(path.join(SRC, 'icons.json'), 'utf8'));
const ICONS = meta.icons;
const TOOLS = meta.tools;

const DRAW_TAGS = 'path|circle|rect|line|polyline|polygon|ellipse';
const drawEls = (svg) => [...svg.matchAll(new RegExp(`<(${DRAW_TAGS})\\b([^>]*)\\/>`, 'g'))];
const rootTag = (svg) => svg.match(/^<svg\b([^>]*)>/);
const attr = (tagAttrs, name) => {
  const m = tagAttrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};

console.log('the icon family — drawings, mirror set, tool map');

test('every id in icons.json has a drawing on the 24 grid', () => {
  for (const icon of ICONS) {
    const file = path.join(SRC, `${icon.id}.svg`);
    assert.ok(fs.existsSync(file), `identity/icons/ui/${icon.id}.svg is missing`);
    const svg = fs.readFileSync(file, 'utf8');
    const root = rootTag(svg);
    assert.ok(root, `${icon.id}.svg: no <svg> root`);
    assert.equal(attr(root[1], 'viewBox'), '0 0 24 24', `${icon.id}.svg: wrong viewBox`);
  }
});

test('currentColor only: no hex, no rgb()/hsl(), no other colour', () => {
  for (const icon of ICONS) {
    const svg = fs.readFileSync(path.join(SRC, `${icon.id}.svg`), 'utf8');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(svg), `${icon.id}.svg: colour literal`);
    for (const m of svg.matchAll(/\b(fill|stroke|color|stop-color)="([^"]*)"/g)) {
      assert.ok(['currentColor', 'none'].includes(m[2]), `${icon.id}.svg: ${m[1]}="${m[2]}"`);
    }
  }
});

test('at most 5 drawing elements, round caps and joins on the root', () => {
  for (const icon of ICONS) {
    const svg = fs.readFileSync(path.join(SRC, `${icon.id}.svg`), 'utf8');
    const n = drawEls(svg).length;
    assert.ok(n >= 1 && n <= 5, `${icon.id}.svg: ${n} drawing elements (1-5 allowed)`);
    const root = rootTag(svg)[1];
    assert.equal(attr(root, 'stroke-linecap'), 'round', `${icon.id}.svg: root stroke-linecap`);
    assert.equal(attr(root, 'stroke-linejoin'), 'round', `${icon.id}.svg: root stroke-linejoin`);
  }
});

test('the root carries stroke-width="2"; only a filled nuqta element may override it', () => {
  for (const icon of ICONS) {
    const svg = fs.readFileSync(path.join(SRC, `${icon.id}.svg`), 'utf8');
    const root = rootTag(svg)[1];
    assert.equal(attr(root, 'stroke-width'), '2', `${icon.id}.svg: root stroke-width`);
    for (const [tag, attrs] of drawEls(svg)) {
      const sw = attr(attrs, 'stroke-width');
      if (sw != null) {
        assert.equal(attr(attrs, 'fill'), 'currentColor', `${icon.id}.svg: ${tag} overrides stroke-width without fill="currentColor"`);
      }
    }
  }
});

const JS = fs.readFileSync(path.join(EXT, 'ui', 'icons.js'), 'utf8');
const win = {};
let loadError = null;
try { new Function('window', JS)(win); } catch (err) { loadError = err; }

test('ui/icons.js loads in a bare window and publishes the contract', () => {
  assert.equal(loadError, null, `ui/icons.js threw at load: ${loadError && loadError.message}`);
  assert.ok(win.UQAIcons && typeof win.UQAIcons === 'object', 'window.UQAIcons is missing');
  assert.ok(Array.isArray(win.UQAIconMirror), 'window.UQAIconMirror is missing');
  assert.equal(typeof win.UQAIcon, 'function', 'window.UQAIcon is missing');
});

test('every id in icons.json is present in ui/icons.js, and only those ids', () => {
  assert.deepEqual(Object.keys(win.UQAIcons).sort(), ICONS.map((i) => i.id).sort());
});

/* DESIGN-SPEC §10's 12, plus S11a's event-nav (the mirror image of back). */
const MIRROR = ['tool-inject', 'tool-autofill', 'tool-harvest', 'tool-diagram', 'note', 'back', 'chevron-end',
  'external', 'timeline', 'steps', 'purpose-step', 'open-report', 'event-nav'];

test('the mirror set is exactly the 12 of DESIGN-SPEC §10 plus event-nav (S11a)', () => {
  const fromMeta = ICONS.filter((i) => i.mirror_rtl).map((i) => i.id).sort();
  assert.deepEqual(fromMeta, [...MIRROR].sort(), 'icons.json mirror_rtl set');
  assert.deepEqual([...win.UQAIconMirror].sort(), fromMeta);
});

test('an alias is byte-for-byte the drawing it names', () => {
  for (const icon of ICONS.filter((i) => i.alias_of)) {
    const read = (id) => fs.readFileSync(path.join(SRC, `${id}.svg`), 'utf8');
    assert.equal(read(icon.id), read(icon.alias_of), `${icon.id}.svg differs from ${icon.alias_of}.svg`);
  }
});

test('S11a: every Stage-2 glyph (14 annotate shapes, report sprite, replay, DevTools) maps to a drawn id', () => {
  const map = meta.stage2_map;
  assert.ok(map, 'icons.json: stage2_map is missing');
  assert.deepEqual(Object.keys(map.annotate).sort(), ['circle', 'cross', 'diamond', 'dot', 'double-arrow', 'ellipse',
    'exclaim', 'line', 'question', 'rect', 'rounded', 'star', 'tick', 'triangle'], 'the 14 annotate SHAPES ids');
  assert.equal(Object.keys(map.report).length, 20, 'the 20 symbols of the report.html sprite');
  for (const [surface, glyphs] of Object.entries(map)) {
    for (const [glyph, id] of Object.entries(glyphs)) {
      assert.ok(win.UQAIcons[id] != null, `${surface} ${glyph}: "${id}" has no drawing`);
    }
  }
});

test('S11a: the drawn ids keep the family rules (no pane, no opacity, nuqta 1-wide stroke)', () => {
  for (const icon of ICONS.filter((i) => ['shape', 'event'].includes(i.kind) || ['key', 'dot', 'play'].includes(i.id))) {
    const svg = fs.readFileSync(path.join(SRC, `${icon.id}.svg`), 'utf8');
    assert.ok(!/opacity|<use\b|<g\b/.test(svg), `${icon.id}.svg: opacity, <use> or <g> (the glass pane is retired)`);
    for (const [, attrs] of drawEls(svg)) {
      const sw = attr(attrs, 'stroke-width');
      assert.ok(sw == null || sw === '1', `${icon.id}.svg: stroke-width="${sw}"`);
    }
  }
});

test('every tool-icon entry (19 tools) resolves to a drawn id', () => {
  assert.equal(TOOLS.length, 19, `icons.json: ${TOOLS.length} tool entries, expected 19`);
  for (const t of TOOLS) {
    assert.ok(win.UQAIcons[t.icon] != null, `tool ${t.id}: icon "${t.icon}" has no drawing`);
  }
});

test('UQAIcon(id, {size, label}) matches the qawIcon contract (DESIGN-SPEC §0.2)', () => {
  assert.equal(win.UQAIcon('nothing-by-this-name'), '');
  const def = win.UQAIcon('star');
  assert.match(def, /^<svg class="icon" viewBox="0 0 24 24" width="20" height="20" /);
  assert.match(def, /aria-hidden="true"/);
  const small = win.UQAIcon('star', { size: 16 });
  assert.match(small, /class="icon is-s"/);
  const large = win.UQAIcon('star', { size: 24 });
  assert.match(large, /class="icon is-l"/);
  const mirrored = win.UQAIcon('back');
  assert.match(mirrored, /class="icon mirror"/);
  const labelled = win.UQAIcon('star', { label: 'Favourite' });
  assert.match(labelled, /role="img" aria-label="Favourite"/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
