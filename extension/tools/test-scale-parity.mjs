/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Size tokens change no pixel (sdlc-1014 B2 steps 4-5).
 *
 *   node tools/test-scale-parity.mjs            compare with tools/fixtures/scale-parity-popup.json
 *   node tools/test-scale-parity.mjs --record   rewrite the fixture from the current CSS (only when a size change is decided)
 *
 * Drives the real popup at 348x600 in three states (asleep, idle awake, recording) and records, for every visible
 * element, its box and the computed spacing, size and radius properties. A literal swapped for a `var(--sz-*)` must give
 * an identical record. Needs headed Chrome (the same harness as test-next-primary), so it runs by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from './lib-paths.mjs';
import { launchPopupHarness } from './test-next-primary.mjs';

const FIXTURE = path.join(EXT, 'tools', 'fixtures', 'scale-parity-popup.json');
const RECORD = process.argv.includes('--record');
const PROPS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'rowGap', 'columnGap', 'width', 'height', 'minWidth', 'minHeight', 'fontSize', 'lineHeight', 'borderRadius', 'borderTopWidth'];

const snapshot = (popup) => popup.evaluate((props) => {
  const out = {};
  const keyOf = (e) => {
    const parts = [];
    for (let n = e; n && n !== document.body; n = n.parentElement) {
      const i = n.parentElement ? [...n.parentElement.children].indexOf(n) : 0;
      parts.unshift(`${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}[${i}]`);
    }
    return parts.join('>');
  };
  for (const e of document.body.querySelectorAll('*')) {
    if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') continue;
    if (e.closest('[data-live]')) continue;
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const cs = getComputedStyle(e);
    out[keyOf(e)] = [[r.left, r.top, r.width, r.height].map((v) => Math.round(v * 2) / 2).join(','), ...props.map((p) => cs[p])].join('|');
  }
  return out;
}, PROPS);

/** Equal, or equal to within a pixel on every number: text and fonts rasterise a fraction of a pixel differently on another machine (header 58.5 vs 58.4), a swapped size token moves a whole one. */
const same = (a, b) => a === b || (typeof a === 'string' && typeof b === 'string' && a.split(/[|,]/).length === b.split(/[|,]/).length
  && a.split(/[|,]/).every((x, i) => { const y = b.split(/[|,]/)[i]; return x === y || (!Number.isNaN(parseFloat(x)) && !Number.isNaN(parseFloat(y)) && Math.abs(parseFloat(x) - parseFloat(y)) < 1); }));

let h;
let code = 1;
try {
  h = await launchPopupHarness({ label: 'pop-scale' });
  const { popup } = h;
  // Boxes, not motion: an entrance animation caught mid-flight (a held frame in a window that is behind another) put the idle card 6 px low on one run in two.
  await popup.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  const got = {};
  for (const state of ['asleep', 'idle', 'recording']) {
    await h.to(state);
    await popup.waitForFunction(() => !document.getElementById('status').textContent, null, { timeout: 15000 });
    await popup.waitForTimeout(800);
    got[state] = await snapshot(popup);
  }
  const count = Object.values(got).reduce((n, s) => n + Object.keys(s).length, 0);
  if (RECORD) {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, `${JSON.stringify(got, null, 1)}\n`);
    console.log(`  recorded ${count} element records -> ${path.relative(EXT, FIXTURE)}`);
    code = 0;
  } else {
    const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const diffs = [];
    for (const state of Object.keys(want)) {
      for (const k of new Set([...Object.keys(want[state]), ...Object.keys(got[state] || {})])) {
        if (!same(want[state][k], got[state]?.[k])) diffs.push(`${state} ${k}\n          was ${want[state][k]}\n          now ${got[state]?.[k]}`);
      }
    }
    const seen = count > 100; // R15: the run proves it measured the ready popup before it can pass
    console.log(`  ${seen ? 'ok  ' : 'FAIL'} ${count} element records measured (3 states)`);
    console.log(`  ${diffs.length === 0 ? 'ok  ' : 'FAIL'} every box, spacing, size and radius equals the recorded popup${diffs.length ? `\n        ${diffs.slice(0, 6).join('\n        ')}` : ''}`);
    console.log(`\n${(seen ? 1 : 0) + (diffs.length === 0 ? 1 : 0)} passed, ${(seen ? 0 : 1) + (diffs.length === 0 ? 0 : 1)} failed`);
    code = seen && diffs.length === 0 ? 0 : 1;
  }
} catch (e) {
  console.log(`  FAIL harness: ${e.message}`);
} finally {
  await h?.close?.();
}
process.exit(code);
