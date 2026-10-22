/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * OF-11 (r8-05-4): range and colour steps emit replayable spec lines. The colour picker is a native popup that automation
 * cannot drive with trusted input, so the live suite proves the range and this one proves both from recorded step shapes.
 *   node tools/test-of-c-spec.mjs
 */
import assert from 'node:assert/strict';
import { buildPlaywrightSpec } from '../core/artifact.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };
const session = { id: 's_1', name: 'range and colour', startUrl: 'https://app.test/p', startedAt: 1 };
const step = (o) => ({ kind: 'dom', ts: 10, trusted: true, selector: '#x', ...o });

t('a range input step replays by setting the value and firing input and change', () => {
  const spec = buildPlaywrightSpec(session, [step({ action: 'input', control: 'range', tag: 'input', selector: '#vol', value: '7' })]);
  assert.match(spec, /locator\('#vol'\)\.evaluate\(\(el, v\) => \{ el\.value = v; el\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\); el\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\); \}, '7'\);/);
  assert.doesNotMatch(spec, /\.fill\('7'\)/, 'Playwright cannot fill a range');
});

t('a colour step replays the picked colour the same way', () => {
  const spec = buildPlaywrightSpec(session, [step({ action: 'input', control: 'color', tag: 'input', selector: '#tint', value: '#00aa55' })]);
  assert.match(spec, /locator\('#tint'\)\.evaluate\([^\n]*'#00aa55'\);/);
});

t('a colour step without the recorder control (an old session) still replays as text, never as an evaluate', () => {
  const spec = buildPlaywrightSpec(session, [step({ action: 'input', tag: 'input', selector: '#tint', value: '#00aa55' })]);
  assert.match(spec, /fill\('#00aa55'\)/);
});

t('a range or colour step the page performed by its own script is left out (D-1010-47), and the spec says so', () => {
  const spec = buildPlaywrightSpec(session, [
    step({ action: 'input', control: 'range', selector: '#vol', value: '7', trusted: false }),
    step({ action: 'input', control: 'color', selector: '#tint', value: '#00aa55', trusted: false }),
  ]);
  assert.doesNotMatch(spec, /#00aa55|'7'/);
  assert.match(spec, /2 steps the page performed by its own script were left out/);
});

console.log(`\n${passed} passed, 0 failed`);
