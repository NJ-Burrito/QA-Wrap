/* T-016..T-019: front-end honesty fixes. node tools/test-ui-honesty.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { filingState } from '../ui/outcome.js';
import { erasedText, erasedSays } from '../core/store-registry.js';
import { describeFootprint } from '../core/sessions.js';

const rd = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const en = JSON.parse(rd('platform/i18n/en.json'));
const ar = JSON.parse(rd('platform/i18n/ar.json'));
let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const tr = (dict) => (k, v = {}) => (dict[k] ?? `MISSING:${k}`).replace(/\{(\w+)\}/g, (_, x) => v[x]);

test('T-016 a failed save keeps the patch and shows the error with retry', () => {
  const js = rd('options/options.js');
  assert.match(js, /else \{[^}]*pending = mergeDeep\(body, pending\);\s*saveFailed\([^;]*res\.error\);/s);
  assert.match(js, /retry\.addEventListener\('click'/);
  // behaviour: replay the commit logic against a rejecting send
  const m = js.match(/const commit = async \(\) => \{[\s\S]*?\n  \};/)[0];
  const ctx = { pending: { a: 1 }, settings: {}, shown: null, adopt: (x) => x, flashSaved() {}, saveFailed: (e) => (ctx.shown = e),
    send: async () => ({ ok: false, error: 'quota exceeded' }),
    mergeDeep: (a, b) => ({ ...a, ...b }) };
  vm.createContext(ctx);
  vm.runInContext(`${m}\ncommit();`, ctx);
  return new Promise((r) => setTimeout(() => { assert.deepEqual({ ...ctx.pending }, { a: 1 }); assert.equal(ctx.shown, 'quota exceeded'); r(); }, 5));
});

for (const [lang, dict] of [['en', en], ['ar', ar]]) {
  test(`T-017/T-054 reset and erase sentences list every place the registry removes (${lang})`, () => {
    for (const mode of ['reset', 'eraseAll']) {
      for (const gone of [false, true]) {
        const text = erasedText(tr(dict), mode, { gone });
        assert.ok(text && !text.includes('MISSING'), `${mode} ${gone}: ${text}`);
        for (const k of erasedSays(mode)) assert.ok(text.includes(dict[`options.reset.erases.${k}`]), `${mode}: ${k}`);
      }
    }
  });
}
test('T-017/T-054 both Reset buttons and Erase read the registry, not a hand list', () => {
  const js = rd('options/options.js');
  assert.equal((js.match(/erasedText\(t, 'reset'\)/g) || []).length, 2);
  assert.match(js, /erasedText\(t, 'eraseAll'\)/);
  assert.match(js, /erasedText\(t, 'eraseAll', \{ gone: true \}\)/);
  assert.ok(!/resetConfirmText|RESET_ERASES/.test(js));
});
test('T-054 the footprint line the options page paints says total, oldest and the 80 percent warning in both languages', () => {
  const js = rd('options/options.js');
  assert.match(js, /describeFootprint\(res\.result, t\)/, 'the page paints the worker answer through describeFootprint');
  const answer = { sessions: 2, mb: 1.5, oldest: Date.UTC(2026, 8, 1), bytes: 1572864, totalBytes: 90 * 1048576, quotaWarn: true };
  for (const dict of [en, ar]) {
    const line = describeFootprint(answer, tr(dict));
    assert.ok(!line.includes('MISSING'), line);
    for (const k of ['options.safe.fp.total', 'options.safe.fp.oldest', 'options.safe.fp.quota']) assert.ok(line.includes(dict[k].split('{')[0].trim() || dict[k].slice(0, 6)), k);
    assert.match(line, /90/); assert.match(line, /2026-09-01/);
  }
});
test('T-017 posted:false never reads as Sent', () => {
  assert.equal(filingState('send', null).state, 'notSent');
  assert.equal(filingState('send', { error: 'x' }).state, 'notSent');
  assert.equal(filingState('send', { results: [{ sent: false }] }).state, 'notSent');
  assert.equal(filingState('send', { results: [{ sent: true }, { sent: false }] }).state, 'partial');
  assert.equal(filingState('send', { results: [{ sent: true }] }).state, 'sent');
  assert.equal(filingState('save', null).state, 'saved');
  assert.match(rd('reporter/reporter.js'), /filingState\(how, res\.result\?\.posted\)/);
});

test('T-018 welcome: no timer closes the tab; live confirmation and a close button', () => {
  const js = rd('welcome/welcome.js');
  assert.ok(!/setTimeout/.test(js.replace(/\/\*[\s\S]*?\*\//g, '')), 'no setTimeout');
  const html = rd('welcome/welcome.html');
  assert.match(html, /id="done"[^>]*aria-live="polite"/);
  assert.match(html, /id="close-tab"/);
  assert.ok(!/closes itself|ستُغلق هذه الصفحة/.test(html));
  assert.ok(html.indexOf('platform/i18n.js') < html.indexOf('<body'), 'lang/dir stamped from the head, before paint');
});

test('T-019 consentedAt change repaints the popup out of the gated state', () => {
  const js = rd('popup/popup.js');
  const fn = js.match(/function onConsentChanged[\s\S]*?\n\}/)[0];
  assert.match(js, /chrome\.storage\.onChanged\.addListener\(onConsentChanged\)/);
  const seen = [];
  const ctx = { paintConsent: (v) => seen.push(v) };
  vm.createContext(ctx);
  vm.runInContext(`${fn}\nonConsentChanged({ consentedAt: { newValue: 1 } }, 'local');onConsentChanged({ consentedAt: { newValue: 1 } }, 'sync');onConsentChanged({ other: {} }, 'local');`, ctx);
  assert.deepEqual(seen, [true]);
});
console.log(`  ${n} passed`);
