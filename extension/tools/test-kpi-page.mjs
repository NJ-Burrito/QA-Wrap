/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R4 dashboard, through its real entry point.   node tools/test-kpi-page.mjs
 *
 *   A. the markup (kpi/view.js) in English and Arabic: every chart is there, RTL mirrors, every kpi.* string exists in both tables.
 *   B. ENTRY_SMOKE: the extension is loaded in a headless Chromium (profile tagged qaw-1109), the dashboard is opened by its URL
 *      as Settings links it, a fixture is written into the extension's own IndexedDB, and the charts are asserted to be drawn
 *      from that data (R15: the ready flag `data-kpi-ready` and a known count are asserted before anything is called clean).
 *      With QAW_KPI_SHOTS=<dir> it saves the English and the Arabic render as PNG and a PDF of the print layout.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildKpi } from '../core/kpi.js';
import { render } from '../kpi/view.js';
import { recycle } from './lib-trash.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');
const TABLES = { en: JSON.parse(read('platform/i18n/en.json')), ar: JSON.parse(read('platform/i18n/ar.json')) };
const makeT = (lang) => (k, v) => String(TABLES[lang][k] ?? k).replace(/\{(\w+)\}/g, (w, n) => (v && n in v ? String(v[n]) : w));

/* ── the fixture: 12 days of sessions on two sites, a link check on one ── */
const MIN = 6e4;
const DAY = 864e5;
const NOW = Date.parse('2026-11-09T12:00:00Z');
function fixture() {
  const sessions = [];
  const events = {};
  for (let i = 0; i < 12; i++) {
    const startedAt = NOW - (11 - i) * DAY - 2 * 36e5;
    const shop = i % 3 !== 2;
    const base = shop ? 'https://shop.example.com' : 'https://blog.example.org';
    const id = `fx${i}`;
    sessions.push({ id, startedAt, endedAt: startedAt + (20 + i * 4) * MIN, startUrl: `${base}/`, status: 'stopped' });
    const ev = [
      { kind: 'nav', ts: startedAt + 1000, url: `${base}/`, frameUrl: `${base}/` },
      { kind: 'dom', ts: startedAt + 2 * MIN, action: 'click', frameUrl: `${base}/` },
      { kind: 'nav', ts: startedAt + 3 * MIN, url: `${base}/p${i % 4}`, frameUrl: `${base}/p${i % 4}` },
    ];
    if (shop) ev.push({ kind: 'links', ts: startedAt + 4 * MIN, frameUrl: `${base}/`, rows: ['/a', '/b', '/c', '/d', '/e'].map((href) => ({ href, internal: true })) });
    if (i % 2 === 0) ev.push({ kind: 'note', ts: startedAt + 5 * MIN, tag: 'bug', text: `bug ${i}`, frameUrl: `${base}/`, ...(i % 4 === 0 ? { severity: 'major' } : {}) });
    ev.push({ kind: 'note', ts: startedAt + 6 * MIN, tag: 'issue', text: 'not a bug' });
    events[id] = ev;
  }
  return { sessions, events };
}
const fx = fixture();
const EXPECT_BUGS = 6; // i = 0, 2, 4, 6, 8, 10
const data = buildKpi(fx.sessions, fx.events, { tzOffsetMin: 0 });
assert.equal(data.all.bugs, EXPECT_BUGS, 'the fixture holds six filed bugs and six non-bug notes');
assert.equal(data.all.sessions, 12);

/* ── A. the markup ── */
const needles = ['<svg class="viz"', 'role="img"', '<title', '<desc'];
for (const lang of ['en', 'ar']) {
  for (const view of ['day', 'week']) {
    const out = render(data, { t: makeT(lang), lang, numTag: lang === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB', view, site: '' });
    const html = out.tiles + out.charts + out.notes;
    assert.equal((out.charts.match(/<svg class="viz"/g) || []).length, 6, `${lang}/${view}: six charts`);
    for (const n of needles) assert.ok(html.includes(n), `${lang}/${view}: ${n}`);
    assert.doesNotMatch(html, /undefined|NaN|\[object|\bkpi\.[a-z]+\.[a-z]/, `${lang}/${view}: no hole, no raw key`);
    assert.equal((out.charts.match(/<table class="data"/g) || []).length, 6, `${lang}/${view}: every chart has its table`);
    assert.match(out.charts, lang === 'ar' ? /الأخطاء حسب الخطورة/ : /Bugs by severity/);
    assert.match(out.charts, lang === 'ar' ? /غير مصنّفة/ : /Not rated/, 'the unrated severity row is stated, not invented');
    assert.match(out.charts, /shop\.example\.com/);
  }
}
{
  /* RTL mirrors: the value axis sits on the right and the newest point is leftmost */
  const axisX = (svg) => Number(/<text class="axis" x="([\d.]+)"/.exec(svg)[1]);
  const mk = (lang) => render(data, { t: makeT(lang), lang, numTag: 'en-GB', view: 'day', site: '' }).charts.split('<svg class="viz"')[1];
  assert.ok(axisX(mk('en')) < 100, 'LTR: the value axis is on the left');
  assert.ok(axisX(mk('ar')) > 500, 'RTL: the value axis is on the right');
  const polyX = (svg) => /polyline class="line c1-line" points="([\d.]+),/.exec(svg)?.[1];
  assert.ok(Number(polyX(mk('en'))) < 300 && Number(polyX(mk('ar'))) > 300, 'time starts at the left in LTR and at the right in RTL');
}
{
  /* the site filter narrows tiles and trends; the per-site charts keep every site */
  const out = render(data, { t: makeT('en'), lang: 'en', numTag: 'en-GB', view: 'day', site: 'blog.example.org' });
  const blog = data.sites.find((s) => s.site === 'blog.example.org');
  assert.ok(out.tiles.includes(`>${blog.sessions}<`), 'tiles follow the chosen site');
  assert.match(out.charts, /shop\.example\.com/);
}
{
  /* empty data still renders without a hole (the page hides it behind the empty card) */
  const none = render(buildKpi([], {}), { t: makeT('en'), lang: 'en', numTag: 'en-GB', view: 'day', site: '' });
  assert.doesNotMatch(none.charts + none.tiles, /NaN|undefined/);
}

/* every kpi.* key the sources use exists in both tables with the same placeholders */
const used = new Set();
for (const f of ['kpi/kpi.html', 'kpi/kpi.js', 'kpi/view.js', 'kpi/pdf.js', 'options/options.html']) {
  for (const m of read(f).matchAll(/['"`](kpi\.[a-zA-Z0-9.]+)['"`]/g)) used.add(m[1]);
}
for (const k of ['kpi.range.7', 'kpi.range.30', 'kpi.range.90', 'kpi.range.all', 'kpi.sev.critical', 'kpi.sev.major', 'kpi.sev.moderate', 'kpi.sev.minor', 'kpi.sev.unrated']) used.add(k);
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const k of used) {
  if (k.endsWith('.') || /\.(css|js|html)$/.test(k)) continue;
  assert.ok(k in TABLES.en && k in TABLES.ar, `${k} exists in en and ar`);
  assert.equal(holes(TABLES.en[k]), holes(TABLES.ar[k]), `${k}: the same placeholders in both languages`);
}
for (const k of Object.keys(TABLES.en)) if (k.startsWith('kpi.')) assert.ok(used.has(k) || /^kpi\.(chart|tile|col|basis|unit|desc|sev|view|range)\./.test(k), `${k} is used`);
assert.ok(!/cairo/i.test(read('kpi/kpi.css')), 'Cairo is banned');
assert.ok(/var\(--font\)/.test(read('kpi/kpi.css')), 'the page type is Thmanyah through the shared token');
assert.ok(!/(<script(?![^>]*src)[^>]*>)|\son[a-z]+=/.test(read('kpi/kpi.html')), 'no inline script or handler (extension CSP)');
console.log('test-kpi-page A (markup): ok');

/* ── B. the real entry point ── */
if (process.env.QAW_NO_BROWSER === '1') { console.log('test-kpi-page B: skipped by QAW_NO_BROWSER=1'); process.exit(0); }
const { chromium } = await import('playwright');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-1109-kpi-')); // the session tag is in the profile path so `relay.py sweep` can attribute it
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1200, height: 1000 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check'],
  });
  let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith('chrome-extension://'), timeout: 20000 });
  const id = new URL(sw.url()).host;
  const url = `chrome-extension://${id}/kpi/kpi.html`;
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  /* first open: an empty store must show the empty card, not a broken page */
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.kpiReady === '1', null, { timeout: 15000 });
  assert.equal(await page.locator('#empty').isVisible(), true, 'no sessions: the empty card shows');
  assert.equal(await page.locator('svg.viz').count(), 0, 'and no chart is drawn from nothing');

  /* write the fixture into the extension's own store, then open the dashboard again */
  await page.evaluate(async ({ sessions, events }) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('uqa'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => {
      const tx = db.transaction(['sessions', 'events'], 'readwrite');
      for (const s of sessions) { tx.objectStore('sessions').put(s); for (const e of events[s.id]) tx.objectStore('events').add({ ...e, sessionId: s.id, fail: 0 }); }
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, fx);
  await page.evaluate((now) => { Date.now = () => now; }, NOW); // the period filter reads the clock; pin it to the fixture
  await page.goto(url);
  await page.evaluate((now) => { Date.now = () => now; }, NOW);
  await page.waitForFunction(() => document.body.dataset.kpiReady === '1', null, { timeout: 15000 });
  await page.selectOption('#f-range', '0');
  await page.waitForSelector('svg.viz', { timeout: 10000 });

  assert.equal(await page.locator('svg.viz').count(), 6, 'six charts drawn from the stored sessions');
  const tile = (n) => page.locator('.tile').nth(n).locator('.big').innerText();
  assert.equal(await tile(1), '12', 'the sessions tile counts the 12 stored sessions');
  assert.equal(await tile(3), String(EXPECT_BUGS), 'the bugs tile counts only notes filed as bugs');
  assert.ok((await page.locator('#h-severity').innerText()).length > 0);
  assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');

  /* the same page in Arabic: RTL, Arabic words, same data */
  await page.evaluate(() => QAWi18n.setLang('ar'));
  await page.waitForFunction(() => document.documentElement.dir === 'rtl' && document.querySelector('#h-severity')?.textContent.includes('الخطورة'), null, { timeout: 10000 });
  assert.equal(await tile(3), String(EXPECT_BUGS), 'Arabic shows the same count, in Latin digits');
  assert.equal(await page.locator('svg.viz').count(), 6);

  /* the fine print is filled for the print and cleared after it (pdf.js, one call site for the profile lane) */
  const trace = await page.evaluate(async () => {
    const { exportPdf } = await import('./pdf.js');
    let seen = '';
    await exportPdf({ lang: 'ar', date: '2026-11-09', version: '0.0.0', fallback: 'FALLBACK LINE', heading: 'h', scope: 'SCOPE LINE' }, { print: () => { seen = document.getElementById('print-trace').textContent + '|' + document.getElementById('print-scope').textContent; } });
    window.dispatchEvent(new Event('afterprint'));
    return { seen, after: document.getElementById('print-trace').textContent };
  });
  assert.match(trace.seen, /\|SCOPE LINE$/);
  assert.ok(trace.seen.split('|')[0].length > 0, 'a trace line is printed (the profile line, or the plain tool line while no profile exists)');
  assert.equal(trace.after, '', 'and cleared again');

  if (process.env.QAW_KPI_SHOTS) {
    const dir = process.env.QAW_KPI_SHOTS;
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'kpi-ar.png'), fullPage: true });
    await page.evaluate(() => QAWi18n.setLang('en'));
    await page.waitForFunction(() => document.documentElement.dir === 'ltr' && document.querySelector('#h-severity')?.textContent.includes('severity'));
    await page.screenshot({ path: path.join(dir, 'kpi-en.png'), fullPage: true });
    for (const lang of ['en', 'ar']) {
      await page.evaluate((l) => QAWi18n.setLang(l), lang);
      await page.waitForFunction((l) => document.documentElement.lang === l, lang);
      await page.evaluate(() => { document.getElementById('print-trace').textContent = 'Nader · 2026-11-09 · QA Wrap'; document.getElementById('print-scope').textContent = 'scope'; });
      await page.emulateMedia({ media: 'print' });
      const pdf = path.join(dir, `kpi-${lang}.pdf`);
      await page.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
      await page.emulateMedia({ media: 'screen' });
      const head = fs.readFileSync(pdf).subarray(0, 5).toString();
      assert.equal(head, '%PDF-', `${lang}: a PDF was written`);
      const txt = spawnSync('pdftotext', ['-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8' });
      if (!txt.error && txt.status === 0) {
        assert.match(txt.stdout, lang === 'ar' ? /مؤشرات الأداء/ : /Performance indicators/, `${lang}: the PDF text is real, extractable text`);
        assert.match(txt.stdout, /Nader/, `${lang}: the trace line is in the PDF`);
      } else console.log(`test-kpi-page: pdftotext not available, PDF text not extracted (${lang})`);
    }
  }
  assert.deepEqual(errors, [], 'no page error');
  console.log('test-kpi-page B (entry smoke, headless Chromium, tag qaw-1109): ok');
} finally {
  await ctx?.close().catch(() => {});
  recycle(profile);
}
