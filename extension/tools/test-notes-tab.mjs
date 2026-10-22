/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * ui-1020: the Notes tab under Evidence on the report page.   node tools/test-notes-tab.mjs [--shots]
 * Real Chromium, the source extension, a fixture session holding notes of several types. The tab exists under Evidence, the
 * counts per type are right, the filter works, rows are capped at 7 behind "Show all", copy gives the masked text, save equals
 * the timeline's Export notes for the same notes (and for a filtered set), the empty state is short, Arabic is RTL.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from './lib-paths.mjs';
import { launchE2E } from './lib-e2e.mjs';
import { buildNotesExport } from '../report/notes-build.js';

let passed = 0;
const check = (ok, name, detail = '') => { assert.ok(ok, `${name} ${detail}`); passed++; console.log(`  ok  ${name}`); };
const SHOTS = process.argv.includes('--shots') ? path.resolve(EXT, '..', 'work', 'ui-1020', 'shots') : null;
const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

const T0 = Date.now() - 600000;
const note = (i, tag, text, url = 'https://shop.example.com/checkout') => ({ sessionId: 's-notes', kind: 'note', ts: T0 + i * 7000, tag, text, frameUrl: url, fail: 0 });
const EVENTS = [
  note(1, 'bug', 'Submit stays disabled after a valid card'),
  note(2, 'question', 'Should the coupon apply before tax?', 'https://shop.example.com/cart'),
  note(3, 'note', `Token seen in the URL ${jwt}`),
  note(4, 'bug', 'Total shows NaN with an empty cart', 'https://shop.example.com/cart'),
  note(5, 'issue', 'Spinner never stops on slow network'),
  note(6, 'question', 'Is the postcode field meant to be optional?'),
  note(7, 'note', 'Login redirect lands on the home page'),
  note(8, 'bug', 'Back button loses the typed address'),
  note(9, 'note', 'Footer links open in the same tab'),
  note(10, 'technique', 'generated technique prompt'),
  note(11, 'bug', '   '),
  { sessionId: 's-notes', kind: 'net', ts: T0 + 12000, url: 'https://shop.example.com/api', fail: 0 },
];
const SESSION = { id: 's-notes', seq: 1, charter: 'Checkout and login', startedAt: T0, endedAt: T0 + 120000, status: 'stopped', startUrl: 'https://shop.example.com/checkout', title: 'Checkout and login' };

const h = await launchE2E({ ext: EXT, label: 'notes-tab' });
try {
  const page = await h.page(`chrome-extension://${h.id}/report/report.html`);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_LIST_SESSIONS' }, r))); // makes the worker create the database
  await page.evaluate(async ([s, evs]) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('uqa'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => { const tx = db.transaction(['sessions', 'events'], 'readwrite'); tx.objectStore('sessions').put(s); for (const e of evs) tx.objectStore('events').add(e); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  }, [SESSION, EVENTS]);
  await page.reload();
  await page.waitForFunction(() => window.UQAReport?.mail && !document.getElementById('sec-evidence').disabled, null, { timeout: 20000 });
  await page.evaluate(() => { window.__clip = []; navigator.clipboard.writeText = async (s) => { window.__clip.push(String(s)); }; window.__saved = []; window.UQADownload.downloadText = async (c, f, m) => { window.__saved.push({ c, f, m }); return { ok: true }; }; });

  // 1. the tab sits under Evidence
  await page.click('#sec-evidence');
  const tab = page.locator('#tab-notes');
  check(await tab.isVisible() && await tab.evaluate((b) => !b.hasAttribute('data-off') && !b.disabled), 'the Notes tab is on the Evidence row');
  check(await page.locator('#tab-sizes').isVisible(), 'beside the existing evidence tabs');
  check(!await page.locator('#tab-broke').isVisible(), 'and not on the Findings row');
  await tab.click();
  check(await page.locator('#panel-notes').isVisible(), 'pressing it opens the Notes panel');

  // 2. counts per type
  await page.waitForSelector('#notes-filters .filter');
  const chips = await page.$$eval('#notes-filters .filter', (bs) => bs.map((b) => [b.dataset.type, b.querySelector('.filter-n').textContent]));
  assert.deepEqual(Object.fromEntries(chips), { all: '9', bug: '3', question: '2', note: '3', issue: '1' });
  check(true, 'chips: All 9, Bug 3, Question 2, Note 3, Issue 1 (technique and blank notes are not listed)');
  check(await page.locator('#notes-filters .filter[data-type=all]').getAttribute('aria-pressed') === 'true', 'All is the default');

  // 3. row cap
  check(await page.locator('.nt-row').count() === 7 && await page.locator('#notes-more').isVisible(), 'at most 7 rows open, the rest behind Show all');
  check((await page.locator('#notes-more').textContent()).includes('9'), 'Show all names the total');
  await page.click('#notes-more');
  check(await page.locator('.nt-row').count() === 9 && !await page.locator('#notes-more').isVisible(), 'Show all opens every note');
  const first = await page.locator('.nt-row').first().innerText();
  check(/Bug/.test(first) && /Submit stays disabled/.test(first) && /shop\.example\.com/.test(first) && /\d\d:\d\d:\d\d/.test(first), 'a row shows type, text, time and page', first);

  // 4. filter
  await page.click('#notes-filters [data-type=question]');
  const qs = await page.$$eval('.nt-row', (r) => r.map((x) => x.dataset.type));
  check(qs.length === 2 && qs.every((x) => x === 'question'), 'the Question chip lists only questions');
  check(await page.locator('#notes-more').isHidden(), 'no Show all for a short list');

  // 5. copy
  await page.click('#notes-filters [data-type=all]');
  await page.click('#notes-more');
  await page.locator('.nt-row[data-type=note]').first().locator('button').click();
  const clip = await page.evaluate(() => window.__clip);
  check(clip.length === 1 && clip[0].startsWith('Token seen in the URL') && !clip[0].includes(jwt), 'one press copies the note text, masked', JSON.stringify(clip));
  check(!(await page.locator('#panel-notes').innerText()).includes(jwt), 'the secret is not on the page either');

  // 6. save equals the timeline's export
  const ctx = await page.evaluate(() => ({ session: window.UQAReport.mail.session, events: window.UQAReport.mail.events }));
  for (const [format, id, tid] of [['markdown', 'notes-save', 'export-notes'], ['csv', 'notes-save-csv', 'export-notes-csv']]) {
    await page.evaluate(() => { window.__saved = []; });
    await page.click('#notes-filters [data-type=all]');
    await page.click(`#${id}`);
    await page.waitForFunction(() => window.__saved.length === 1);
    const mine = (await page.evaluate(() => window.__saved))[0];
    await page.click('#sec-findings'); await page.click('#tab-timeline'); // the timeline's own button lives on its panel
    await page.evaluate(() => { window.__saved = []; });
    await page.click(`#${tid}`);
    await page.waitForFunction(() => window.__saved.length === 1);
    const theirs = (await page.evaluate(() => window.__saved))[0];
    check(mine.c === theirs.c && mine.f === theirs.f && mine.m === theirs.m, `Save ${format} equals the timeline export`);
    check(mine.c === buildNotesExport(ctx.session, ctx.events, format).content && !mine.c.includes(jwt), `${format} is the shared builder's output, masked`);
    await page.click('#sec-evidence'); await page.click('#tab-notes');
  }
  await page.click('#notes-filters [data-type=bug]');
  await page.evaluate(() => { window.__saved = []; });
  await page.click('#notes-save');
  await page.waitForFunction(() => window.__saved.length === 1);
  const bugs = (await page.evaluate(() => window.__saved))[0];
  check(bugs.c === buildNotesExport(ctx.session, ctx.events.filter((e) => e.tag === 'bug'), 'markdown').content && bugs.c.split('\n').filter((l) => l.startsWith('- ')).length === 3, 'a filtered save holds just that type');

  // 7. empty state
  await page.evaluate(() => { window.UQAReport.mail = { ...window.UQAReport.mail, events: [] }; });
  await page.click('#tab-sizes'); await page.click('#tab-notes');
  await page.waitForFunction(() => document.getElementById('notes-empty').textContent);
  const empty = (await page.locator('#notes-empty').innerText()).trim();
  check(empty.length > 0 && empty.split(/\s+/).length <= 25 && /Alt\+N/.test(empty) && await page.locator('#notes-save').isHidden() && await page.locator('.nt-row').count() === 0, `empty state is one short line (${empty.split(/\s+/).length} words)`);
  await page.evaluate((evs) => { window.UQAReport.mail = { ...window.UQAReport.mail, events: evs }; }, ctx.events);
  await page.click('#tab-sizes'); await page.click('#tab-notes');

  // 8. EN shot, then Arabic RTL
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, 'notes-tab-en.png') }); }
  await page.evaluate(() => window.QAWi18n.setLang('ar'));
  await page.waitForFunction(() => document.documentElement.dir === 'rtl' && document.querySelector('#notes-filters .filter')?.textContent.includes('الكل'), null, { timeout: 8000 });
  const ar = await page.evaluate(() => {
    const row = document.querySelector('.nt-row'); const tag = row.querySelector('.nt-tag').getBoundingClientRect(); const txt = row.querySelector('.nt-text').getBoundingClientRect(); const btn = row.querySelector('button').getBoundingClientRect();
    return { dir: getComputedStyle(row).direction, tagRight: tag.left > txt.left, btnLeft: btn.left < txt.left, tab: document.getElementById('tab-notes').textContent, label: row.querySelector('.nt-tag').textContent };
  });
  check(ar.dir === 'rtl' && ar.tagRight && ar.btnLeft, 'Arabic: rows are RTL (type at the start on the right, copy at the end on the left)', JSON.stringify(ar));
  check(ar.tab === 'الملاحظات' && ar.label === 'خلل', 'Arabic: the tab and the type use the existing Arabic words');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'notes-tab-ar.png') });
  const faults = h.faults.filter((f) => !/favicon|ERR_FILE_NOT_FOUND/.test(f.text));
  check(faults.length === 0, 'no page error', JSON.stringify(faults).slice(0, 300));
} finally {
  await h.close();
}
console.log(`test-notes-tab: ${passed} passed`);
