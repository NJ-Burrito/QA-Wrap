/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-050: the practice page, the first-run pointer, the retention line and the passive rating link.
 * The practice page's 500 is checked by running its service worker against a fake fetch event.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PRODUCT } from '../core/product.js';
import { REGISTRY } from '../core/store-registry.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(EXT, '..');
let failed = 0;
let n = 0;
const test = (name, fn) => { n++; try { fn(); console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const page = read(REPO, 'site', 'try', 'index.html');
const lum = (hex) => {
  const c = hex.slice(1).match(/\w\w/g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('PRODUCT.urls.practice is empty or the homepage + /try, and the site has that page', () => {
  assert.equal(PRODUCT.urls.practice, PRODUCT.urls.homepage ? new URL('try/', PRODUCT.urls.homepage).href : '');
  assert.ok(fs.existsSync(path.join(REPO, 'site', 'try', 'index.html')));
  assert.equal(JSON.parse(read(EXT, 'manifest.json')).homepage_url || '', PRODUCT.urls.homepage);
});
test('the practice page plants a failing save, a console.error and a contrast failure, and no modal', () => {
  assert.ok(/fetch\('save'/.test(page) && /console\.error\(/.test(page));
  assert.ok(!/<dialog|alert\(|confirm\(|role="dialog"/.test(page), 'a modal is planted');
  const fine = page.match(/\.try \.fine \{ color: (#[0-9a-f]{6})/i)[1];
  const bg = page.match(/\.try \{[^}]*background: (#[0-9a-f]{6})/i)[1];
  assert.ok(ratio(fine, bg) < 3, `contrast ${ratio(fine, bg).toFixed(2)}`);
});
test('the practice page worker answers the save POST with a 500 and leaves everything else alone', () => {
  const handlers = {};
  const sandbox = { self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim() {} } }, Response, URL };
  vm.runInNewContext(read(REPO, 'site', 'try', 'sw.js'), sandbox);
  let answered = null;
  handlers.fetch({ request: { method: 'POST', url: 'https://example.test/qa-wrap/try/save' }, respondWith: (r) => { answered = r; } });
  assert.equal(answered.status, 500);
  answered = null;
  handlers.fetch({ request: { method: 'GET', url: 'https://example.test/qa-wrap/try/' }, respondWith: (r) => { answered = r; } });
  assert.equal(answered, null);
});
test('the popup pointer opens the packaged practice page', () => {
  const html = read(EXT, 'popup', 'popup.html');
  const js = read(EXT, 'popup', 'popup.js');
  assert.ok(html.includes('id="pointer-practice"') && html.includes('data-i18n="popup.pointer.try"'));
  assert.ok(read(EXT, 'popup', 'onboard.js').includes("getURL('practice/practice.html')"), 'openPractice does not open the packaged practice page');
  assert.ok(!js.includes('countFilms'));
  for (const lang of ['en', 'ar']) {
    const t = JSON.parse(read(EXT, 'platform', 'i18n', `${lang}.json`));
    for (const k of ['popup.pointer.practiceTail', 'popup.pointer.try']) assert.ok(t[k], `${lang} ${k}`);
    for (const k of ['popup.pointer.films', 'popup.pointer.watch', 'popup.pointer.tools']) assert.equal(t[k], undefined, `${lang} stale ${k}`);
  }
});
test('the welcome page links the practice page, names the 30-day auto-delete; the rating link hides under a policy', () => {
  const html = read(EXT, 'welcome', 'welcome.html');
  const js = read(EXT, 'welcome', 'welcome.js');
  assert.ok(html.includes('id="practice-link"') && html.includes('30 days') && html.includes('30 يومًا'));
  assert.ok(js.includes("getURL('practice/practice.html')") && js.includes('rateUrl()') && js.includes('storage.managed'));
  assert.ok(!/await chrome\.storage\.managed/.test(js), 'the consent button would wait on managed storage');
});
test('Settings About has the rating link, hidden under any managed policy', () => {
  const html = read(EXT, 'options', 'options.html');
  const js = read(EXT, 'options', 'options.js');
  assert.ok(html.includes('id="about-rate"'));
  assert.ok(/about-rate[\s\S]{0,700}storage\.managed[\s\S]{0,300}about-rate-dd/.test(js));
});
test('the rating link is passive: no popup, report, worker or page script reads it', () => {
  const hits = [];
  for (const dir of ['popup', 'report', 'background', 'content', 'sidepanel']) {
    for (const f of fs.readdirSync(path.join(EXT, dir)).filter((x) => x.endsWith('.js'))) if (read(EXT, dir, f).includes('reviewUrl')) hits.push(`${dir}/${f}`);
  }
  assert.deepEqual(hits, []);
});
test('firstReportOpenedAt is written once by the report and registered', () => {
  assert.ok(REGISTRY.some((r) => r.key === 'firstReportOpenedAt'));
  const js = read(EXT, 'report', 'report.js');
  assert.ok(/get\('firstReportOpenedAt'\)[\s\S]{0,200}if \(!r\.firstReportOpenedAt\)/.test(js));
});
test('the listing says the 30-day auto-delete under what it does not do', () => {
  const md = read(EXT, 'store', 'LISTING.md');
  const block = md.slice(md.indexOf('What it does not do'), md.indexOf('Also in the box'));
  assert.ok(/30 days/.test(block));
});

// Next-review T-050: the Rate link stays hidden until the listing is live.
{
  const js = fs.readFileSync(new URL('../welcome/welcome.js', import.meta.url), 'utf8');
  const product = fs.readFileSync(new URL('../core/product.js', import.meta.url), 'utf8');
  assert.match(product, /listed: false/, 'listed flag present and false until the owner flips it');
  // r363: the link now follows the dist (GitHub repo until a store lists it), so it is no longer hidden by `listed`.
  assert.ok(js.includes('rateUrl()') && !js.includes('PRODUCT.listed'));
}
// r7-09-1: a missing reply or { ok: false } is a failure like a throw: the failed notice shows and the button re-enables.
{
  const src = fs.readFileSync(new URL('../welcome/welcome.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '');
  const drive = async (reply, throws) => {
    const els = {};
    const el = (id) => (els[id] ||= { id, hidden: false, disabled: false, handlers: {}, addEventListener(t, f) { this.handlers[t] = f; }, focus() { this.focused = true; } });
    const sandbox = {
      document: { getElementById: el },
      PRODUCT: { urls: {}, listed: true },
      rateUrl: () => 'https://example.test/rate',
      chrome: {
        runtime: { sendMessage: async () => { if (throws) throw new Error('asleep'); return reply; }, getURL: (x) => x },
        storage: { managed: { get: async () => ({}) } },
        tabs: { create() {}, getCurrent: async () => ({}), remove: async () => {} },
      },
    };
    vm.runInNewContext(src, sandbox);
    await els.accept.handlers.click();
    return els;
  };
  for (const [label, reply, throws, ok] of [['ok:true', { ok: true, result: {} }, false, true], ['ok:false', { ok: false, error: 'x' }, false, false], ['no reply', undefined, false, false], ['throws', null, true, false]]) {
    const els = await drive(reply, throws);
    test(`welcome accept (${label}) ${ok ? 'confirms' : 'shows the failed notice and re-enables the button'}`, () => {
      if (ok) { assert.equal(els.done.hidden, false); assert.equal(els.failed.hidden, true); } else {
        assert.equal(els.failed.hidden, false); assert.equal(els.accept.disabled, false); assert.equal(els.done?.hidden ?? true, true);
      }
    });
  }
}
console.log(`\n${n - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
