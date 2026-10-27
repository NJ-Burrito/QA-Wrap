/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-052: a refusal is a code with a localised sentence and one fix button.
 * The mutation test rewords the English (and swaps in the Arabic) and the chip must stay.
 *
 *   node tools/test-refusals.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const cat = (l) => JSON.parse(read(`platform/i18n/${l}.json`));
const en = cat('en');
const ar = cat('ar');
const popup = read('popup/popup.js');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

// The real FIXES, REFUSALS, codeByText and fixFor, run with every DOM helper stubbed (run() is never called here).
const fixesSrc = popup.slice(popup.indexOf('const FIXES = ['), popup.indexOf('/** The button currently attached'));
const ctx = vm.createContext({ $: () => null, spotlight() {}, chrome: {}, ctx: {}, say() {}, t: (k) => k, send() {}, dismiss() {} });
vm.runInContext(`${fixesSrc}\nthis.REFUSALS = REFUSALS; this.codeByText = codeByText; this.fixFor = fixFor; this.FIXES = FIXES;`, ctx);
const { REFUSALS, codeByText, fixFor, FIXES } = ctx;
const CODES = ['ASLEEP', 'STALE', 'SLOW', 'MEDIA_SLOW', 'TAB_RELOAD', 'NEEDS_INVOKE', 'NEEDS_CLICK', 'NEEDS_GRANT', 'NO_SESSION', 'NEEDS_CONSENT', 'POLICY_HOSTS', 'POLICY_SCREENSHOT', 'POLICY_BLOCKED', 'NO_PICTURE'];

console.log('refusals (code, English, Arabic, chip)');

test('every refusal code is in the table with an English and an Arabic sentence', () => {
  assert.deepEqual(Object.keys(REFUSALS).sort(), [...CODES].sort());
  for (const [code, row] of Object.entries(REFUSALS)) {
    assert.ok(en[row.key] && ar[row.key], `${code}: ${row.key} missing in a language`);
    assert.notEqual(en[row.key], ar[row.key], `${code}: Arabic is the English copied`);
    assert.match(ar[row.key], /[؀-ۿ]{3}/);
    console.log(`      ${code.padEnd(18)} | ${en[row.key].slice(0, 48)}... | ${ar[row.key].slice(0, 24)}... | ${row.chip ?? '(none: names the administrator)'}`);
  }
});

test('every chip names a real fix button; policy refusals offer none', () => {
  const ids = FIXES.map((f) => f.id);
  for (const [code, row] of Object.entries(REFUSALS)) {
    if (row.chip) assert.ok(ids.includes(row.chip), `${code} -> ${row.chip}`);
    else assert.match(code, /^(POLICY_|SLOW|MEDIA_SLOW|NEEDS_CLICK|NO_PICTURE)/);
  }
});

test('MUTATION: reword the English or show the Arabic and the chip is unchanged', () => {
  for (const [code, row] of Object.entries(REFUSALS)) {
    for (const text of [en[row.key], ar[row.key], 'Something entirely different was said here', 'asleep wake it master switch settings permission']) {
      codeByText.clear();
      codeByText.set(text, code);
      assert.equal(fixFor(text)?.id ?? null, row.chip, `${code} with "${text.slice(0, 30)}"`);
    }
  }
});

test('the worker sends the code, with the seven refusals each raised somewhere', () => {
  const src = workerSrc() + read('background/armed.js') + read('background/media.js');
  for (const c of ['ASLEEP', 'STALE', 'SLOW', 'MEDIA_SLOW', 'TAB_RELOAD', 'NEEDS_INVOKE', 'NEEDS_GRANT', 'NO_SESSION', 'NEEDS_CONSENT']) {
    assert.ok(src.includes(`'${c}'`), `${c} is raised nowhere`);
  }
  assert.ok(/codeByText\.set\(res\.error, res\.code\)/.test(popup), 'popup send() maps the code');
  // ui-1016 L: Chrome's raw screenshot refusal (no activeTab, no <all_urls>) is one short line with no chip, never "Show me the row"
  assert.ok(/<all_urls>\.\*activeTab\/\.test\(res\.error[^;]*'NEEDS_CLICK'/.test(popup), 'send() maps the raw screenshot refusal to NEEDS_CLICK');
  assert.ok(en['popup.refusal.needsClick'].split(' ').length <= 25, 'one short line');
});


test('SLOW and MEDIA_SLOW are calm: no reload advice, no chip, STALE keeps its own', () => {
  for (const code of ['SLOW', 'MEDIA_SLOW']) {
    assert.equal(REFUSALS[code].chip, null);
    assert.doesNotMatch(en[REFUSALS[code].key], /reload the extension|after an update/i);
    assert.equal(fixFor(en[REFUSALS[code].key]), null, `${code}: the sentence must not match a regex chip`);
  }
  assert.equal(REFUSALS.STALE.chip, 'reloadExtension');
});

test('no UQA_ message name reaches a user-facing string', () => {
  for (const [l, cat_] of [['en', en], ['ar', ar]]) {
    const bad = Object.entries(cat_).filter(([, v]) => /UQA_[A-Z]/.test(v)).map(([k]) => k);
    assert.deepEqual(bad, [], `${l}.json strings name a message type`);
  }
  const opts = read('options/options.js');
  assert.match(opts, /options\.msg\.slow/, 'options send() must scrub a raw UQA_ error');
  assert.match(opts, /\bUQA_\[A-Z_\]\+/, 'options send() must test for a UQA_ name');
  for (const k of ['options.msg.slow']) assert.ok(en[k] && ar[k] && en[k] !== ar[k]);
});

test('Reload the extension asks first while a recording runs (en + ar)', () => {
  assert.ok(en['popup.reload.confirmRecording'] && ar['popup.reload.confirmRecording']);
  assert.match(en['popup.reload.confirmRecording'], /stop/i);
  assert.equal((popup.match(/chrome\.runtime\.reload\(\)/g) || []).length, 1, 'only reloadCarefully() may call reload');
  assert.match(popup, /confirm\(t\('popup\.reload\.confirmRecording'\)\)/);
});
console.log(`\n${passed}/${passed} refusals tests passed`);
