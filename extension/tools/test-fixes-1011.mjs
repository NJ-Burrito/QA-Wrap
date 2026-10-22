/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The final 1011 fix pass, the parts a node run can prove (the headed halves are test-tile-wake-live, test-sound-volume-live
 * and `test-buttons-all --only diagram,replay`).
 *
 *   B2  diagram arrows get a wide invisible hit stroke that sits in the arrow's own group, is not drawn into the export,
 *       and does not fatten when the arrow is selected or focused.
 *   B3  a replay never carries a script, a handler, a javascript: URL or a srcdoc, in any case or namespace.
 *   B5  every export prints the one problem number (problemCounts().groups): text, HTML, YAML and the docs manifest.
 *   B7  the line ratchets equal the files, so nothing is left to grow into.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toHtml, toDocument } from '../core/replay.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const lines = (p) => read(p).split(String.fromCharCode(10)).length; // test-layers.mjs' own unit

const js = read('diagram/diagram.js');
const css = read('diagram/diagram.css');
test('B2: arrows get an invisible 18 px stroke on the same path, inside the arrow group', () => {
  assert.match(js, /s\.type === 'edge' && !g\.querySelector\('\.edge-hit'\)/);
  assert.match(js, /setAttribute\('stroke', 'transparent'\)/);
  assert.match(js, /setAttribute\('stroke-width', '18'\)/);
  assert.match(js, /setAttribute\('pointer-events', 'stroke'\)/);
  assert.match(js, /g\.append\(hit\)/);
});
test('B2: the hit stroke is added to the live sheet only; the saved file is a fresh flowToSvg without it', () => {
  assert.ok(!read('core/flow.js').includes('edge-hit'), 'core/flow.js (the export) must not carry the hit stroke');
  assert.match(js, /const svg = flowToSvg\(flow, \{ lockup \}\)/);
});
test('B2: selecting or focusing an arrow thickens the drawn line, never the hit stroke', () => {
  assert.match(css, /\[data-edge\]\.selected path:not\(\.edge-hit\)/);
  assert.match(css, /\[data-edge\]:focus-visible path:not\(\.edge-hit\)/);
});

const el = (n, a = {}, c = []) => ({ t: 1, n, a, c });
const txt = (v) => ({ t: 3, v });
test('B3: scripts in any case, an SVG script, handlers, javascript: URLs, xlink:href and srcdoc never reach the replay', () => {
  const doc = {
    t: 1, n: 'HTML', c: [el('BODY', {}, [
      el('script', {}, [txt('alert(1)')]),
      el('SCRIPT', { src: 'x.js' }),
      el('svg', {}, [el('script', {}, [txt('alert(2)')]), el('a', { 'xlink:href': 'javascript:alert(3)' }, [txt('l')])]),
      el('a', { href: 'javascript:alert(4)', onclick: 'alert(5)', OnMouseOver: 'alert(6)' }, [txt('go')]),
      el('div', { srcdoc: '<script>alert(7)</script>', title: 'kept' }, [txt('kept')]),
      el('form', { action: 'javascript:alert(8)' }, []),
    ])],
  };
  const out = toDocument({ doc, title: 'x' });
  assert.ok(!/<script/i.test(out), out);
  assert.ok(!/javascript:/i.test(out), out);
  assert.ok(!/\bon[a-z]+=/i.test(out), out);
  assert.ok(!/alert\(/.test(out), out);
  assert.ok(!/srcdoc=/i.test(out), out);
  assert.ok(out.includes('title="kept"') && out.includes('>kept<'), 'ordinary content survives');
  assert.equal(toHtml(el('noscript', {}, [txt('x')])), '');
});

const sig = read('tools/test-signal-surfaces.mjs');
test('B5: the text, HTML, YAML and docs-manifest pins are on problemCounts().groups', () => {
  for (const what of ['docs manifest number', 'text export number', 'html export number', 'yaml export number']) {
    const row = sig.split('\n').find((l) => l.includes(what));
    assert.ok(row && row.includes('problemCounts(ev).groups'), `${what}: ${row}`);
  }
  for (const f of ['core/exporters.js', 'core/docs.js']) assert.ok(!/headline\(/.test(read(f)), `${f} still prints headline().total`);
});

test('B7: line-ratchet.json equals the line counts of service-worker.js and popup.js', () => {
  const r = JSON.parse(read('tools/line-ratchet.json'));
  const find = (k) => r.lines[k];
  for (const f of ['background/service-worker.js', 'popup/popup.js']) assert.equal(find(f), lines(f), `${f}: ratchet ${find(f)} vs ${lines(f)} lines`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
