/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-053: Arabic at the seams. The core UI was always in both languages; the edges
 * (right-click menu, command toasts, desktop notifications, manifest text, exported
 * documents, locator text) were English. This fails when one of them goes back.
 *
 *   node tools/test-arabic-edges.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDocFonts, shell, docDirection } from '../core/docshell.js';
import { buildHtml, buildHar } from '../core/exporters.js';
import { toJira } from '../core/formats.js';
import { toMarkdownIssue } from '../core/formats-export.js';
import { buildMarkdown } from '../core/artifact-docs.js';
import { DOC_LABELS, docLabels } from '../core/doc-labels.js';
import { buildXlsx } from '../core/xlsx.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const en = json('platform/i18n/en.json');
const ar = json('platform/i18n/ar.json');
let passed = 0;
const test = (name, fn) => Promise.resolve(fn()).then(() => { passed++; console.log(`  ok  ${name}`); });

console.log('Arabic at the seams');

await test('manifest text comes from _locales, default_locale en, both languages complete', () => {
  const m = json('manifest.json');
  assert.equal(m.default_locale, 'en');
  const L = { en: json('_locales/en/messages.json'), ar: json('_locales/ar/messages.json') };
  assert.deepEqual(Object.keys(L.en).sort(), Object.keys(L.ar).sort());
  const used = [...read('manifest.json').matchAll(/__MSG_(\w+)__/g)].map((x) => x[1]);
  assert.ok(used.length >= 7, 'description and every command description');
  for (const k of used) {
    assert.ok(L.en[k]?.message && L.ar[k]?.message, `${k} missing in a language`);
    assert.notEqual(L.en[k].message, L.ar[k].message, `${k}: Arabic is the English copied`);
  }
  assert.deepEqual([...new Set(used)].sort(), Object.keys(L.en).sort(), 'no unused or missing message');
  assert.ok(L.en.extDescription.message.length <= 132 && L.ar.extDescription.message.length <= 132, 'store description limit');
  for (const [name, d] of Object.entries(m.commands)) assert.match(d.description, /^__MSG_\w+__$/, `command ${name}`);
});

await test('the worker catalogue keys the menu, toasts and notifications ask for exist in both languages', () => {
  for (const f of ['background/context-menus.js', 'background/notify.js', 'background/service-worker.js']) {
    const src = read(f);
    for (const [, k] of src.matchAll(/'((?:common\.worker\.(?:menu|toast|note)|popup\.refusal)\.[a-zA-Z0-9]+)'/g)) {
      assert.ok(en[k] && ar[k], `${f}: ${k}`);
    }
  }
  // note keys are built from short names in notify.js; check them against the catalogue by prefix
  for (const [, k] of read('background/notify.js').matchAll(/\bf\(\s*(?:a\.scope[^,]*,|'([a-zA-Z]+)')/g)) if (k) assert.ok(en[`common.worker.note.${k}`] && ar[`common.worker.note.${k}`], `note ${k}`);
  for (const k of ['recScreen', 'recTab', 'without', 'pressAgain', 'saved', 'where', 'session', 'sessionWord', 'slept', 'sleptClip', 'sleptSession', 'sleptNothing', 'titleSession', 'titleRecording', 'titleSaved', 'titleAsleep']) {
    assert.ok(en[`common.worker.note.${k}`] && ar[`common.worker.note.${k}`] && en[`common.worker.note.${k}`] !== ar[`common.worker.note.${k}`], k);
  }
});

await test('no hard-coded English literal reaches a toast, a menu title or a notification (listed files)', () => {
  const cm = read('background/context-menus.js');
  // Every notify() in the menu code gets its text from T()/tr()/S, never a literal.
  for (const m of cm.matchAll(/notify\(\s*tabId,\s*([^\n]{0,40})/g)) {
    assert.ok(!/^['"`]/.test(m[1].trim()), `literal toast: ${m[0]}`);
  }
  // Every titled item has a catalogue key.
  const keys = new Set([...cm.matchAll(/'(qaw-[a-z0-9-]+)': 'common\.worker\.menu\./g)].map((x) => x[1]));
  for (const [, id] of cm.matchAll(/\{ id: '(qaw-[a-z0-9-]+)', title:/g)) assert.ok(keys.has(id), `menu item ${id} has no key`);
  const sw = read('background/service-worker.js');
  assert.ok(!/sayLoudly\(\s*[^,\n]+,\s*['"`]/.test(sw), 'sayLoudly with a literal');
  assert.ok(!/chat\.announce\(\s*'[a-z-]+',\s*'/.test(sw), 'announce with a literal title');
  // Allow-list (with reasons): rule labels such as "Network failure" are stored with the rule and shown by the popup's own rules list.
});

await test('an Arabic document shell is dir=rtl lang=ar, English stays ltr', async () => {
  assert.deepEqual(docDirection('ar-JO'), { lang: 'ar', dir: 'rtl' });
  assert.deepEqual(docDirection('en-US'), { lang: 'en', dir: 'ltr' });
  assert.deepEqual(docDirection(undefined), { lang: 'en', dir: 'ltr' });
  await loadDocFonts();
  const html = shell({ title: 'T', kind: 'k', body: '<p>x</p>', language: 'ar' });
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(shell({ title: 'T', kind: 'k', body: '<p>x</p>' }), /<html lang="en" dir="ltr">/);
  // The real callers pass no language: an export whose content is Arabic is rtl, an English one with a style block is not.
  assert.match(shell({ title: 'تقرير', kind: 'k', body: '<p>هذا اختبار للتصدير بالعربية</p><style>.a{color:red}</style>' }), /<html lang="ar" dir="rtl">/);
  assert.match(shell({ title: 'Report', kind: 'k', body: '<p>Mostly English with one كلمة</p>' }), /<html lang="en" dir="ltr">/);
});

await test('xlsx sheets are right-to-left on request only', () => {
  const has = (bytes, s) => Buffer.from(bytes).includes(s);
  assert.ok(has(buildXlsx([{ name: 'a', rows: [['h'], ['x']] }], { rtl: true }), 'rightToLeft="1"'));
  assert.ok(!has(buildXlsx([{ name: 'a', rows: [['h'], ['x']] }]), 'rightToLeft'));
  assert.ok(has(buildXlsx([{ name: 'a', rows: [['عنوان'], ['قيمة']] }]), 'rightToLeft="1"'), 'an Arabic sheet is rtl with no option passed');
});

await test('locator and code text keep their own direction inside Arabic', () => {
  const css = read('popup/popup.css');
  const block = css.slice(css.indexOf('.ll-code {'), css.indexOf('}', css.indexOf('.ll-code {')));
  assert.match(block, /direction:\s*ltr/);
  assert.match(block, /unicode-bidi:\s*isolate/);
  // toast values that are code or URLs are isolated at run time
  assert.ok(/LRI/.test(read('background/context-menus.js')));
});

await test('doc-labels: both languages have the same keys and the same {holes}, and the Arabic is not the English copied (T-053)', () => {
  const { en: E, ar: A } = DOC_LABELS;
  assert.deepEqual(Object.keys(E).sort(), Object.keys(A).sort());
  const holes = (t) => (t.match(/\{\w+\}/g) || []).sort().join();
  for (const k of Object.keys(E)) {
    assert.equal(holes(E[k]), holes(A[k]), `${k}: placeholders differ`);
    assert.ok(/[\u0600-\u06FF]/.test(A[k]), `${k}: the Arabic has no Arabic letters`);
    assert.ok(!/[\u0600-\u06FF]/.test(E[k]), `${k}: the English has Arabic letters`);
  }
  assert.equal(docLabels('ar-JO'), A);
  assert.equal(docLabels('en-US'), E);
  assert.equal(docLabels(undefined), E);
});

const T0 = 1_700_000_000_000;
const HEX = 'ab'.repeat(32);
const arSession = { id: 's_ar', charter: 'اختبار تسجيل الدخول إلى البوابة', startedAt: T0, endedAt: T0 + 9000, startUrl: 'https://example.gov/login', env: { viewport: '1280×720', userAgent: 'Chrome/126', platform: 'Win32', language: 'ar-JO' } };
const arEvents = [
  { kind: 'dom', ts: T0 + 1000, action: 'click', label: 'دخول', locator: "getByRole('button', { name: 'دخول' })", tag: 'button' },
  { kind: 'net', ts: T0 + 1200, method: 'POST', url: 'https://example.gov/api/login?x=1&y=2', status: 500, durationMs: 120 },
  { kind: 'note', ts: T0 + 2000, tag: 'bug', text: 'الزر لا يستجيب بعد الضغط' },
  { kind: 'screenshot', ts: T0 + 3000, captureId: 'c_1', text: 'الشاشة' },
];
const captures = { c_1: { dataUrl: 'data:image/png;base64,AAAA', sha256: HEX } };

await test('an exported Arabic HTML report is dir=rtl lang=ar with Arabic labels, isolated Latin, and the full checksum (T-053, T-066)', () => {
  const html = buildHtml(arSession, arEvents, captures, {});
  assert.match(html, /<html lang="ar" dir="rtl">/);
  for (const w of ['ما الذي تعطّل', 'خطوات إعادة الإنتاج', 'ملاحظات المختبِر', 'البيئة', 'لقطات الشاشة', 'تقرير جلسة اختبار', 'كيف تقرأ هذا المستند']) assert.ok(html.includes(w), `missing ${w}`);
  for (const w of ['What broke', 'Steps to reproduce', 'Environment', 'Test session report', 'How to read this', 'Made by']) assert.ok(!html.includes(w), `English label left: ${w}`);
  assert.match(html, /<bdi>https:\/\/example\.gov\/login<\/bdi>/, 'the page address is isolated');
  assert.match(html, /<bdi>POST( [^<]*)?<\/bdi>/, 'a Latin verb inside an Arabic sentence is isolated (D-1010-176: with its path, in one phrase)');
  assert.match(html, /\[dir=rtl\] code,\[dir=rtl\] pre\{direction:ltr/, 'code keeps its direction');
  assert.ok(html.includes(`<bdi>${HEX}</bdi>`), 'the checksum is printed in full, not cut to 16');
  assert.ok(!html.includes('SHA-256 checksums:'), 'the footer label is Arabic in an Arabic document');
});

await test('completion review 5: an Arabic-language tester on an English page gets an rtl Arabic document (T-053 step 3, env.language)', () => {
  const evs = arEvents.filter((e) => e.kind !== 'note').map((e) => (e.kind === 'dom' ? { ...e, label: 'Sign in' } : e.kind === 'screenshot' ? { ...e, text: 'Shot' } : e));
  const html = buildHtml({ ...arSession, charter: 'Login check' }, evs, captures, {});
  assert.match(html, /<html lang="ar" dir="rtl">/);
});

await test('an English session still exports ltr English, with the checksum in full', () => {
  const evs = arEvents.filter((e) => e.kind !== 'note').map((e) => (e.kind === 'dom' ? { ...e, label: 'Sign in' } : e.kind === 'screenshot' ? { ...e, text: 'Shot' } : e));
  const html = buildHtml({ ...arSession, charter: 'Login check', env: { ...arSession.env, language: 'en-US' } }, evs, captures, {});
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.ok(html.includes('What broke') && html.includes('Test session report'));
  assert.ok(html.includes(`SHA-256 checksums: c_1 ${HEX}`));
  assert.ok(!html.includes('<bdi>'), 'no isolation markup in an English document');
});

await test('the Jira text follows the tester language, the English one is unchanged', () => {
  const ar = toJira(arSession, arEvents);
  assert.ok(ar.includes('h2. ما الذي حدث') && ar.includes('h2. البيئة') && ar.includes('||الحقل||القيمة||'));
  assert.ok(!ar.includes('h2. What happened'));
  const en = toJira({ ...arSession, charter: 'Login check', env: { ...arSession.env, language: 'en-US' } }, [{ kind: 'net', ts: T0 + 1200, method: 'POST', url: 'https://x.test/a', status: 500, durationMs: 9 }]);
  assert.ok(en.includes('h2. What happened') && en.includes('h2. Environment') && en.includes('||Field||Value||'));
});

await test('the Markdown report and the Markdown issue follow the tester language, English unchanged (T-053)', () => {
  const enS = { ...arSession, charter: 'Login check', env: { ...arSession.env, language: 'en-US' } };
  const enEv = arEvents.filter((e) => e.kind !== 'note').map((e) => (e.kind === 'dom' ? { ...e, label: 'Sign in' } : e.kind === 'screenshot' ? { ...e, text: 'Shot' } : e));
  const en = buildMarkdown(enS, enEv, {}), enIssue = toMarkdownIssue(enS, enEv);
  assert.ok(en.includes('## Steps to reproduce') && en.includes('| Session |') && en.includes('## Full timeline'));
  assert.ok(enIssue.includes('## What happened') && enIssue.includes('| Field | Value |'));
  const ar = buildMarkdown(arSession, arEvents, {}), arIssue = toMarkdownIssue(arSession, arEvents);
  assert.ok(ar.includes('## خطوات إعادة الإنتاج') && ar.includes('## الجدول الزمني الكامل') && ar.includes('| الجلسة |'));
  assert.ok(!/## (Steps to reproduce|Full timeline)/.test(ar), 'English heading left in an Arabic Markdown report');
  assert.ok(arIssue.includes('## ما الذي حدث') && arIssue.includes('| الحقل | القيمة |') && !arIssue.includes('## What happened'));
});

await test('10-2 the .txt export follows the tester language (Arabic words, no English labels)', async () => {
  const { buildText } = await import('../core/exporters.js');
  const T0 = 1_700_000_000_000;
  const s = { id: 's_txt', startedAt: T0, endedAt: T0 + 9000, startUrl: 'https://example.gov/apply', status: 'stopped',
    charter: 'اختبار تقديم الطلب بوثيقة منتهية الصلاحية في بوابة الخدمات الحكومية', env: { viewport: '1280x800', userAgent: 'Chrome/126', platform: 'Win32', language: 'ar-JO' } };
  const evs = [
    { kind: 'dom', ts: T0 + 1000, action: 'click', label: 'إرسال الطلب', tag: 'button' },
    { kind: 'net', ts: T0 + 1300, method: 'POST', url: '/api/x', status: 500, durationMs: 40, error: false, responsePreview: 'x' },
  ];
  const out = buildText(s, evs);
  for (const en of ['Where:', 'problems', 'problem ', 'WHAT BROKE', 'Steps', 'Caused by', 'Nothing failed']) assert.ok(!out.includes(en), `Arabic .txt still carries "${en}"`);
  assert.ok(out.includes(docLabels('ar').hBroke) && out.includes(docLabels('ar').hEnv), 'Arabic headings missing');
  assert.ok(buildText({ ...s, charter: 'Submit an application', env: { ...s.env, language: 'en-US' } }, [{ kind: 'dom', ts: T0 + 1000, action: 'click', label: 'Go', tag: 'button' }]).includes('Where:'), 'the English .txt changed');
});

await test('the HAR comment says what is true now: masked as captured, scanned again at export (T-008)', () => {
  const c = JSON.parse(buildHar(arSession, arEvents)).log.comment;
  assert.ok(!/capture time|already redacted|arrive here/.test(c), 'the retired sentence is back');
  assert.match(c, /scanned again when it is written/);
  assert.match(c, /URL query is kept as the page sent it/);
});

await test('r8-10-1 / D-1010-176: one isolate per Latin phrase, guillemets and Arabic stay outside', async () => {
  const { isolateLatin, buildText } = await import('../core/exporters.js');
  assert.equal(isolateLatin('الاسم «QA Wrap» ليس'), 'الاسم «<bdi>QA Wrap</bdi>» ليس');
  assert.equal(isolateLatin('Save as draft'), '<bdi>Save as draft</bdi>');
  assert.equal(isolateLatin('اضغط Save as draft ثم Cancel'), 'اضغط <bdi>Save as draft</bdi> ثم <bdi>Cancel</bdi>');
  assert.equal(isolateLatin('افتح (https://a.test/x?y=1) الآن'), 'افتح <bdi>(https://a.test/x?y=1)</bdi> الآن');
  assert.equal(isolateLatin('نص عربي فقط'), 'نص عربي فقط', 'no Latin, no isolate');
  assert.equal(isolateLatin('<b>A B</b>'), '<bdi>&lt;b&gt;A B&lt;/b&gt;</bdi>', 'escaped inside the isolate');
  const FSI = String.fromCharCode(0x2068), PDI = String.fromCharCode(0x2069);
  const T0 = 1_700_000_000_000;
  const s = { id: 's_iso', startedAt: T0, endedAt: T0 + 9000, startUrl: 'https://example.gov/apply', status: 'stopped',
    charter: 'الاسم «QA Wrap» ليس Save as draft', env: { viewport: '1280x800', userAgent: 'Chrome/126', platform: 'Win32', language: 'ar-JO' } };
  const first = buildText(s, [{ kind: 'dom', ts: T0 + 1000, action: 'click', label: 'إرسال', tag: 'button' }]).split('\n')[0];
  assert.equal(first, `الاسم «${FSI}QA Wrap${PDI}» ليس ${FSI}Save as draft${PDI}`, 'one FSI pair per phrase');
});

await test('r8-08-2 / D-1010-179: every exported table sits in a focusable, labelled region and every th has a scope', async () => {
  const { buildHtml } = await import('../core/exporters.js');
  const { mdToHtml } = await import('../core/mdhtml.js');
  const T0 = 1_700_000_000_000;
  const s = { id: 's_tbl', startedAt: T0, endedAt: T0 + 9000, startUrl: 'https://example.gov/apply', status: 'stopped', charter: 'Check tables',
    env: { viewport: '1280x800', userAgent: 'Chrome/126', platform: 'Win32', language: 'en-US' } };
  const evs = [
    { kind: 'dom', ts: T0 + 1000, action: 'click', label: 'Go', tag: 'button' },
    { kind: 'dom', ts: T0 + 1500, action: 'copy', copied: 'getByRole(\'button\')', label: 'Go', tag: 'button' },
    { kind: 'a11y', ts: T0 + 2000, violations: [{ id: 'label', impact: 'serious', help: 'Form elements must have labels', nodes: [{}] }] },
  ];
  const md = '| Name | Value |\n|---|---|\n| a | b |\n';
  for (const [lang, html, label] of [
    ['en', buildHtml(s, evs, {}, {}), docLabels('en').tableScroll],
    ['ar', buildHtml({ ...s, charter: 'فحص الجداول', env: { ...s.env, language: 'ar-JO' } }, evs, {}, {}), docLabels('ar').tableScroll],
    ['md-en', mdToHtml(md).html, docLabels('en').tableScroll],
    ['md-ar', mdToHtml('| الاسم | القيمة |\n|---|---|\n| أ | ب |\n').html, docLabels('ar').tableScroll],
  ]) {
    const tables = html.match(/<table/g) || [];
    assert.ok(tables.length >= 1, `${lang}: no table rendered`);
    const wrapped = html.match(new RegExp(`<div class="table-wrap" tabindex="0" role="region" aria-label="${label}"><table`, 'g')) || [];
    assert.equal(wrapped.length, tables.length, `${lang}: ${tables.length} tables, ${wrapped.length} in a focusable region`);
    for (const th of html.match(/<th\b[^>]*>/g) || []) assert.match(th, /scope="(col|row)"/, `${lang}: ${th}`);
  }
  assert.equal(docLabels('en').tableScroll, 'Scrollable table'); assert.equal(docLabels('ar').tableScroll, 'جدول قابل للتمرير');
  const src = read('core/exporters.js') + read('core/mdhtml.js');
  for (const m of src.matchAll(/<table/g)) assert.match(src.slice(Math.max(0, m.index - 140), m.index), /\$\{WRAP\}$|role="region"[^>]*>$/, 'a <table> in the source is outside the focusable region');
  assert.ok(!/<th>/.test(src), 'a bare <th> is left in the exporters');
});

console.log(`\n${passed}/${passed} Arabic-edge tests passed`);
