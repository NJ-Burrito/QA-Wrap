/* ENTRY_SMOKE: load the unpacked extension in headless Chromium (tag qaw-1109), open tutorials.html in English and in
 * Arabic UI, assert (1) nothing hosted is requested before a press, (2) a press opens the right file for the language.
 *   cd extension && node ../work/sdlc/build-tut/entry-smoke.mjs */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(path.resolve('node_modules/'));
const { chromium } = require('playwright');
const EXT = path.resolve('.');
const lessons = JSON.parse(fs.readFileSync(path.join(EXT, 'tutorials', 'lessons.json'), 'utf8')).filter((l) => !l.pending);
const BASE = 'https://nj-burrito.github.io/QA-Wrap/media/';
const profile = fs.mkdtempSync(path.join('O:/Temp', 'qaw-1109-smoke-'));
let fail = 0;
const check = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fail++; };

const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new', '--window-position=-1900,20'],
});
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(sw.url()).host;
  const hosted = [];
  await ctx.route('https://nj-burrito.github.io/**', (r) => { hosted.push(r.request().url()); r.abort(); });

  for (const lang of ['en', 'ar']) {
    hosted.length = 0;
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/tutorials/tutorials.html`);
    await page.evaluate((l) => localStorage.setItem('qaw-lang', l), lang);
    await page.reload();
    await page.waitForSelector('.card:not(.is-pending)', { timeout: 15000 }); // R15: the ready state, not the first paint
    const cards = await page.locator('.card').count();
    check(cards === lessons.length, `${lang}: ${cards} cards drawn, ${lessons.length} lessons live`);
    check(await page.evaluate(() => document.documentElement.lang) === lang, `${lang}: the page is in ${lang}`);
    check(hosted.length === 0, `${lang}: nothing hosted requested before a press (${hosted.length})`);
    for (let i = 0; i < lessons.length; i++) {
      const want = BASE + (lessons[i].files[lang] || lessons[i].files.en);
      const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }), page.locator('.card').nth(i).click()]);
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      await popup.close().catch(() => {});
      check(hosted.includes(want), `${lang}: card ${lessons[i].id} opens ${want.replace(BASE, '')}`);
      if (lessons[i].posters) {
        const p = await page.locator('.card').nth(i).getAttribute('data-poster');
        check(p === lessons[i].posters[lang], `${lang}: card ${lessons[i].id} names poster ${p}`);
      }
    }
    await page.close();
  }
} finally {
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log(fail ? `\nENTRY_SMOKE FAILED (${fail})` : '\nENTRY_SMOKE passed');
process.exit(fail ? 1 : 0);
