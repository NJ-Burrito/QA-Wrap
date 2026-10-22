/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R11, naming half (REQ-P1-10, council-1011 seat 5): one name per thing, in both languages.
 *
 *   node tools/test-ui-names.mjs
 *
 * In `popup.*`, `welcome.*` and `tools.*.label`:
 *   - the retired words (photograph, picture, harvest, arm/armed, crosshair, "Stop & review") have 0 hits in EN,
 *     and the retired Arabic labels have 0 hits in AR;
 *   - a short label that starts with "Stop" is exactly "Stop" (AR: exactly "أوقف"), so one verb means one act;
 *   - no button label carries "&" or "+" (EN), and no Arabic button carries "+", "&" or "›";
 *   - the pinned strings (G4) are still there, character for character;
 *   - the practice and welcome pages hold no retired wording of their own in the HTML.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(EXT, ...p), 'utf8');
const en = JSON.parse(read('platform', 'i18n', 'en.json'));
const ar = JSON.parse(read('platform', 'i18n', 'ar.json'));

console.log('  note: tables read as shipped');

let n = 0;
let failed = 0;
const test = (name, fn) => {
  n++;
  try { fn(); console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

const inScope = (k) => /^(popup\.|welcome\.)/.test(k) || /^tools\..*\.label$/.test(k);
const scoped = (table) => Object.keys(table).filter(inScope);
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

/** Keys of the elements drawn as buttons in the two pages a first-time tester meets. */
function buttonKeys(file) {
  const html = read(...file);
  const keys = new Set();
  for (const m of html.matchAll(/<(button|a)\b[^>]*>/g)) {
    if (m[1] === 'a' && !/class="[^"]*\bbtn\b/.test(m[0])) continue;
    const k = m[0].match(/data-i18n="([^"]+)"/);
    if (k) keys.add(k[1]);
  }
  return [...keys];
}
const BUTTONS = [...new Set([...buttonKeys(['popup', 'popup.html']), ...buttonKeys(['practice', 'practice.html'])])];

/* The retired words. Allowed nowhere in these scopes; the reason a key may be exempt must be written next to it. */
const RETIRED_EN = /photograph|picture|harvest|\barm(?:ed)?\b|crosshair|stop & review/i;
const RETIRED_AR = /أوقِف وراجِع|أوقف وراجع|صوّر الصفحة|(?<![؀-ۿ])فعّلها|التقاط الصورة/;
const EXEMPT = {}; // key -> reason

test('retired words have 0 hits in EN (popup.*, welcome.*, tools.*.label)', () => {
  const hits = scoped(en).filter((k) => !EXEMPT[k] && RETIRED_EN.test(en[k])).map((k) => `${k}: ${en[k].slice(0, 60)}`);
  assert.deepEqual(hits, []);
});

test('retired Arabic labels have 0 hits in AR', () => {
  const hits = scoped(ar).filter((k) => !EXEMPT[k] && RETIRED_AR.test(ar[k])).map((k) => `${k}: ${ar[k].slice(0, 60)}`);
  assert.deepEqual(hits, []);
});

test('a short label starting "Stop" is exactly "Stop" (EN) and "أوقف" (AR)', () => {
  const badEn = scoped(en).filter((k) => /^Stop\b/i.test(en[k]) && words(en[k]) <= 5 && en[k] !== 'Stop');
  const badAr = scoped(ar).filter((k) => /^أوق[ِّ]?ف/.test(ar[k]) && words(ar[k]) <= 5 && ar[k] !== 'أوقف');
  assert.deepEqual([...badEn.map((k) => `${k}: ${en[k]}`), ...badAr.map((k) => `${k}: ${ar[k]}`)], []);
  for (const k of ['popup.live.stop', 'popup.record.stop']) {
    assert.equal(en[k], 'Stop', k);
    assert.equal(ar[k], 'أوقف', k);
  }
});

test('the switch says Awake / Asleep in both languages and has no Sleep / Wake up verb button', () => {
  for (const k of ['popup.switch.awake', 'popup.switch.asleep']) assert.ok(en[k] && ar[k], k);
  for (const k of ['popup.switch.sleep', 'popup.switch.wake', 'popup.switch.allSites', 'popup.wake.options']) assert.ok(!(k in en) && !(k in ar), k);
});

test('no button label carries "&" or "+" (EN); no Arabic button carries "+", "&" or "›"', () => {
  assert.ok(BUTTONS.length > 20, `button scan found only ${BUTTONS.length} keys`);
  const badEn = BUTTONS.filter((k) => k in en && /[&+]/.test(en[k]));
  const badAr = BUTTONS.filter((k) => k in ar && /[&+›]/.test(ar[k]));
  assert.deepEqual([...badEn.map((k) => `${k}: ${en[k]}`), ...badAr.map((k) => `${k}: ${ar[k]}`)], []);
  for (const k of ['popup.note.shot', 'tools.harvest.label', 'tools.shot.label']) {
    assert.ok(!/[&+›]/.test(en[k] + ar[k]), k);
  }
});

test('P1-10 renames are in place, as a pair', () => {
  const want = {
    'welcome.practice.step3': ['Press Stop. Copy the report.', 'اضغط «أوقف». انسخ التقرير.'],
    'popup.pointer.try': ['Open practice', 'افتح التجربة'],
    'popup.note.shot': ['Screenshot, note', 'لقطة مع ملاحظة'],
    'tools.harvest.label': ['Map the page', null],
    'tools.shot.label': ['Take a screenshot', null],
    'popup.stale.title': ['QA Wrap needs a reload', null],
  };
  for (const [k, [e, a]] of Object.entries(want)) {
    assert.equal(en[k], e, `${k} EN`);
    if (a) assert.equal(ar[k], a, `${k} AR`);
    assert.ok(ar[k] && ar[k] !== en[k], `${k} AR must be Arabic, not the English copied across`);
  }
  assert.match(en['popup.foot.timelineNone'], /Press Test this site/);
  assert.match(ar['popup.foot.timelineNone'], /اختبر هذا الموقع/);
  assert.match(en['popup.note.recorded'], /^\{tag\} saved\.?$/);
  assert.deepEqual([en['popup.break.arm'], en['popup.break.clear']], ['Start', 'Stop']);
  assert.match(en['popup.break.armed'], /^On: \{label\}/);
});

test('pinned strings stay (G4)', () => {
  assert.equal(en['popup.onboard.testSite'], 'Test this site');
  assert.equal(en['popup.session.start'], 'Start recording');
  assert.equal(en['popup.onboard.rememberLabel'], 'Wake up on this site by itself next time');
  assert.match(en['welcome.practice.step1'], /Test this site/);
});

test('the long popup strings are short enough to read at a glance (P1-11)', () => {
  const long = ['popup.capture.grantNote', 'popup.capture.cursorNote', 'popup.autofill.hint', 'popup.inject.hint', 'popup.coverage.noneOwn', 'popup.pick.hint', 'popup.tools.invokeShortcut', 'popup.refusal.needsInvoke', 'popup.partitions.bb.why.inverted'];
  for (const k of long) {
    assert.ok(words(en[k]) <= 25, `${k} is ${words(en[k])} EN words`);
    assert.ok(ar[k] && ar[k] !== en[k], `${k} AR`);
    assert.ok(!/[›&+]/.test(ar[k]), `${k} AR symbol`);
  }
  assert.match(en['popup.tools.invokeShortcut'], /\{shortcut\}/);
  assert.match(ar['popup.tools.invokeShortcut'], /\{shortcut\}/);
});

test('the practice and welcome pages hold no retired wording in their own HTML', () => {
  for (const f of [['practice', 'practice.html'], ['welcome', 'welcome.html']]) {
    const html = read(...f).replace(/<!--[\s\S]*?-->/g, '');
    const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
    assert.ok(!RETIRED_EN.test(text), `${f[1]}: ${(text.match(RETIRED_EN) || [])[0]}`);
  }
  assert.match(read('welcome', 'welcome.html'), /press Stop and copy the report/);
  assert.match(read('welcome', 'welcome.html'), /اضغط «أوقف» وانسخ التقرير/);
});

console.log(`\n${n - failed}/${n} passed`);
if (failed) process.exit(1);
