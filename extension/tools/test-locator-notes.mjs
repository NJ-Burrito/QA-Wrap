/* QA Wrap — T-043: locator warning codes and the checked-by-engine basis reach the report, in en and ar. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitiseEvent, LOCATOR_WARN_CODES } from '../core/events.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const en = JSON.parse(read('../platform/i18n/en.json'));
const ar = JSON.parse(read('../platform/i18n/ar.json'));
const report = read('../report/report.js');
let n = 0; const ok = (m) => { n++; console.log(`  ok  ${m}`); };

const dom = (extra) => sanitiseEvent({ kind: 'dom', action: 'click', ...extra });
assert.deepEqual(dom({ locatorWarnings: ['Element is inside a cross-origin iframe.', 'code:truncated', 'code:bidi'] }).warnCodes, ['bidi', 'truncated']); ok('engine tokens become warnCodes, in the allow-list order');
assert.deepEqual(dom({ locatorWarnings: ['Element is inside a cross-origin iframe.', 'code:bidi'] }).locatorWarnings, ['Element is inside a cross-origin iframe.']); ok('tokens leave the sentence list');
assert.equal(dom({ warnCodes: ['<img src=x onerror=1>', 'evil', 'bidi'] }).warnCodes.join(), 'bidi'); ok('a page cannot add a code of its own');
assert.equal('warnCodes' in dom({ warnCodes: 'truncated' }), false); ok('a non-array field is not believed');
assert.equal('warnCodes' in dom({ warnCodes: ['evil'] }), false); ok('no known code, no field');
assert.deepEqual(sanitiseEvent({ kind: 'selectorcopy', warnCodes: ['truncated', 'x'] }).warnCodes, ['truncated']); ok('a copied selector carries the same allow-listed codes');
assert.equal('warnCodes' in dom({ locatorWarnings: undefined }), false); ok('an event with no warnings gains none');

for (const code of LOCATOR_WARN_CODES) {
  for (const [lang, t] of [['en', en], ['ar', ar]]) assert.ok(t[`report.timeline.locWarn.${code}`], `${lang} words for ${code}`);
}
ok('every code has an en and an ar sentence');
for (const k of ['report.timeline.locChecked', 'report.timeline.locMatches']) assert.ok(en[k] && ar[k]);
assert.match(en['report.timeline.locChecked'], /^checked: engine/); ok('the basis is worded "checked: engine"');
assert.match(report, /function locatorNotes\(ev\)/); assert.match(report, /locatorNotes\(ev\)\) body\.append/); assert.match(report, /locatorNotes\(\{ warnCodes: ev\.warnCodes \}\)/); ok('the report renders the notes under the timeline locator and on the selector card');
assert.match(report, /locWarn\.\$\{code\}/); assert.ok(LOCATOR_WARN_CODES.every((c) => report.includes(`'${c}'`))); ok('the report words exactly the allow-listed codes');
// completion review 4: the selector card gets codes too. Both producers (picker pick, context-menu copy) forward them, and the ingest keeps them.
const sel = sanitiseEvent({ kind: 'selectorcopy', copied: 'page.getByRole("button")', flavours: [{ name: 'playwright', expr: 'x' }], warnCodes: ['truncated', 'evil'] });
assert.deepEqual(sel.warnCodes, ['truncated']); ok('a selector card event keeps its allow-listed warning codes');
assert.match(read('../content/picker.js'), /warnCodes: desc\.warnCodes/); assert.match(read('../content/picker.js'), /warnCodes: res\.warnCodes/); assert.match(read('../content/ui-host.js'), /warnCodes: desc\.warnCodes/);
ok('the picker and the context-menu path forward warnCodes (source check; the live selector-card run is by hand)');

// r8-05-2: framework-generated ids and classes are never offered as a locator; real stable names are. The engine runs in node:vm (no browser).
{
  const vm = await import('node:vm');
  const sb = { CSS: { escape: (s) => s }, performance: { now: () => 0 }, document: {}, console };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('../content/selector-engine.js'), sb, { filename: 'content/selector-engine.js' });
  const { isStableId, isStableClass } = sb.UQASelector;
  const generatedIds = [
    ':r1:', 'radix-:r1:-trigger', 'radix-:r3a:-content-x', 'radix-12', 'headlessui-menu-button-:r2:', 'headlessui-listbox-option-7',
    'chakra-modal--body-3', 'menu-button-:r0:', 'tabs-:r2:--tab-0', '_r_1_', '_r_2k_', 'field-_r_3_', '«r1»', 'mat-input-0', 'mat-select-value-3', 'mat-mdc-form-field-label-12',
    'cdk-overlay-0', 'cdk-describedby-message-2', 'rc_select_0', 'rc-tabs-0-tab-1', 'react-select-2-input', 'react-aria123-1', 'react-aria-4', 'downshift-0-input', 'ember123', 'ember5',
    'input__BVID__12', '__BVID__7', 'css-1a2b3c', 'j_idt42',
  ];
  for (const id of generatedIds) assert.equal(isStableId(id), false, `${id} is generated and must not anchor a locator`);
  const stableIds = [
    'email', 'login-form', 'search', 'submit-order', 'main-nav', 'radix', 'radix-ui-docs', 'headlessui', 'chakra-ui-docs', 'mat-toolbar', 'cdk-overlay-container', 'rc-select-dropdown',
    'react-select-wrapper', 'react-aria-docs', 'downshift-demo', 'ember-application', 'ember-view', 'checkout_step', 'username', 'card-title', 'sc', 'svelte',
  ];
  for (const id of stableIds) assert.equal(isStableId(id), true, `${id} is a real, stable name`);
  ok(`ids: ${generatedIds.length} generated forms rejected (React 18 and 19, radix, headlessui, chakra, mat, cdk, rc, react-select, react-aria, downshift, ember, bootstrap-vue), ${stableIds.length} stable names kept`);

  const generatedClasses = ['Button_root__a1B2c', 'styles_card__3xKp9', 'Header_nav__Zq8Yw', 'list__item-9fT2k', 'sc-bdfBwQ', 'sc-1x2y3z', 'svelte-1abc2d', 'svelte-xyz', 'css-1a2b3c', 'card___2kG8x'];
  for (const c of generatedClasses) assert.equal(isStableClass(c), false, `${c} is made up by a build tool or CSS-in-JS`);
  const stableClasses = [
    'btn', 'btn-primary', 'card__title', 'card__body', 'card--active', 'react-select__control', 'react-select__control--is-focused', 'react-select__menu-list',
    'mat-form-field', 'mat-select-panel', 'ember-view', 'navbar__item', 'form-control', 'scroll-container', 'scale-up', 'svelte', 'sc',
  ];
  for (const c of stableClasses) assert.equal(isStableClass(c), true, `${c} is a real, stable class`);
  ok(`classes: ${generatedClasses.length} generated forms rejected (CSS-module hashes, styled-components sc-, svelte-), ${stableClasses.length} stable names (BEM, Bootstrap, Material) kept`);
}
console.log(`${n} passed, 0 failed`);
