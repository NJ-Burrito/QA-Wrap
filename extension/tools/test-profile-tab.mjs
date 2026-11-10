/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The Profile tab in Settings and the profile chip in the top bar.   node tools/test-profile-tab.mjs
 *
 *   A. the markup and the words (no browser): Profile is its own tab and card, the name fields and the picture and Verify file
 *      moved there, the Sessions card no longer holds them, the chip and the Profile strings exist in English and Arabic, and
 *      the chip's stylesheet is logical-property and reduced-motion safe.
 *   B. ENTRY_SMOKE (headless Chromium, profile path tagged qaw-1110): the extension is loaded and the real pages are opened.
 *      Settings: #sec-profile opens the Profile tab, typing the names saves them (and the older single name beside them), an
 *      older single name is migrated into the field for its script. Top bar (popup and report): the name for the interface
 *      language, the other one when only one is set, an initials avatar with no picture, the picture when there is one, the
 *      quiet "Set up profile" chip with no profile; hover and keyboard focus open the card, Escape closes it, Edit profile opens
 *      the Profile tab; the chip sits at the inline-end in LTR and RTL; reduced motion switches the transition off.
 *      R15: every probe waits for `data-profile-ready` before it looks, and asserts a known-true sample first.
 *      With QAW_PROFILE_SHOTS=<dir> the top bar is saved as PNG in English and Arabic, with and without a picture.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recycle } from './lib-trash.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');
const EN = JSON.parse(read('platform/i18n/en.json'));
const AR = JSON.parse(read('platform/i18n/ar.json'));
let passed = 0;
const check = (cond, name, detail = '') => { assert.ok(cond, `${name}${detail ? ` (${detail})` : ''}`); passed++; };

/* ── A. markup and words ── */
const html = read('options/options.html');
const card = (id) => html.slice(html.indexOf(`<section class="card" id="${id}"`), html.indexOf('</section>', html.indexOf(`<section class="card" id="${id}"`)));
const profileCard = card('sec-profile');
const sessionsCard = card('sec-sessions');
check(/<a href="#sec-profile" id="tab-profile" data-rail="profile" role="tab"/.test(html), 'Profile has its own tab in the rail');
check(/data-i18n="options\.rail\.profile"/.test(html) && EN['options.rail.profile'] === 'Profile' && AR['options.rail.profile'] === 'الملف الشخصي', 'the tab is named Profile / الملف الشخصي');
check(/profile: \['sec-profile'\]/.test(read('options/options.js')), 'the tab owns the Profile card');
for (const id of ['profile-picture-pick', 'profile-picture-file', 'profileNameEn', 'profileNameAr', 'verify-pick', 'verify-result']) {
  check(profileCard.includes(`id="${id}"`), `the Profile card holds #${id}`);
  check(!sessionsCard.includes(`id="${id}"`), `the Sessions card no longer holds #${id}`);
}
check(!html.includes('id="testerName"'), 'the old single name field is gone from Settings (it lives on as the fallback)');
check(/id="profileNameAr"[^>]*dir="rtl"/.test(profileCard) && /id="profileNameEn"[^>]*dir="ltr"/.test(profileCard), 'each name field has its own direction');
const KEYS = ['profile.chipSetup', 'profile.chipLabel', 'profile.edit', 'profile.nameEn', 'profile.nameAr', 'profile.namesNote', 'options.profile.title'];
for (const k of KEYS) check(EN[k] && AR[k], `${k} exists in English and Arabic`);
check(AR['profile.chipSetup'] === 'أنشئ ملفك' && AR['profile.edit'] === 'تعديل الملف' && EN['profile.chipSetup'] === 'Set up profile' && EN['profile.edit'] === 'Edit profile', 'the chip words are the ones asked for');
check(!/[ً-ٟ]/.test(KEYS.map((k) => AR[k]).join('')), 'no visible tashkeel in the new Arabic strings');
const css = read('ui/profile-chip.css');
check(!/(?:^|[;{\s])(?:left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/m.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'the chip stylesheet uses logical properties only');
check(/prefers-reduced-motion: reduce\)[\s\S]*transition: none/.test(css), 'reduced motion switches the card transition off');
for (const f of ['popup/popup.html', 'report/report.html']) {
  const src = read(f);
  check(src.includes('data-profile-chip') && src.includes('../ui/profile-chip.js') && src.includes('../ui/profile-chip.css'), `${f} reserves the chip slot and loads it`);
}
check(!/fetch\(|XMLHttpRequest|https?:\/\//.test(read('ui/profile-chip.js').replace(/\/\*[\s\S]*?\*\//g, '')), 'the chip makes no network call');
console.log('test-profile-tab A (markup and words): ok');

/* ── B. the real pages ── */
if (process.env.QAW_NO_BROWSER === '1') { console.log('test-profile-tab B: skipped by QAW_NO_BROWSER=1'); console.log(`${passed} passed, 0 failed`); process.exit(0); }
const { chromium } = await import('playwright');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-1110-profile-tab-')); // the session tag is in the path so `relay.py sweep` can attribute it
const SHOTS = process.env.QAW_PROFILE_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let ctx;
const errors = [];
try {
  ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check'],
  });
  let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith('chrome-extension://'), timeout: 20000 });
  const id = new URL(sw.url()).host;
  const url = (p) => `chrome-extension://${id}/${p}`;
  const watch = (page) => { page.on('pageerror', (e) => errors.push(String(e))); return page; };

  const opts = watch(await ctx.newPage());
  let host = opts; // the extension page that carries messages to the worker
  const set = (patch) => host.evaluate((p) => chrome.runtime.sendMessage({ type: 'UQA_SET_SETTINGS', patch: p }), patch);
  const get = () => host.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS' })).result);

  /** Poll a node-side condition (the page's own waitForFunction does not await a promise). */
  const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`timed out waiting for ${fn}`); };

  /* a small real picture, made in the page so the data URL is a true PNG */
  await opts.goto(url('options/options.html'));
  const PIC = await opts.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#e0742c'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#12304a'; g.beginPath(); g.arc(64, 52, 26, 0, 7); g.fill(); g.fillRect(24, 88, 80, 40); return c.toDataURL('image/png'); });
  check(PIC.startsWith('data:image/png;base64,') && PIC.length < 60000, 'a fixture picture within the profile limit');

  /* B1. Settings: the Profile tab */
  await opts.goto(url('options/options.html#sec-profile'));
  await opts.waitForSelector('#sec-profile:not([hidden])', { timeout: 15000 });
  await opts.waitForSelector('body[data-options-ready="1"]', { timeout: 15000 });
  check(await opts.locator('#tab-profile').getAttribute('aria-selected') === 'true', 'the address #sec-profile selects the Profile tab');
  check(await opts.locator('#sec-sessions').isHidden(), 'and the Sessions card is not the one showing');
  check((await opts.locator('#tab-profile').innerText()).trim() === 'Profile', 'the tab says Profile');
  await opts.fill('#profileNameEn', '  Layla Haddad ');
  await opts.fill('#profileNameAr', 'ليلى حداد');
  await opts.locator('#profileNameAr').blur();
  await until(async () => (await get()).profileNameAr === 'ليلى حداد');
  let s = await get();
  check(s.profileNameEn === 'Layla Haddad' && s.profileNameAr === 'ليلى حداد', 'both names are saved, trimmed', JSON.stringify([s.profileNameEn, s.profileNameAr]));
  check(s.testerName === 'Layla Haddad', 'the single fallback name follows the English name');
  await opts.fill('#profileNameEn', '');
  await opts.locator('#profileNameEn').blur();
  await until(async () => (await get()).testerName === 'ليلى حداد');
  check(true, 'with only an Arabic name, the fallback is that name');

  /* B2. migration: an older profile with one name, typed in Arabic and then in English */
  await set({ testerName: 'ليلى حداد', profileNameEn: '', profileNameAr: '' });
  await opts.reload();
  await opts.waitForSelector('body[data-options-ready="1"]', { timeout: 15000 });
  await opts.waitForFunction(() => document.getElementById('profileNameAr').value !== '', null, { timeout: 8000 });
  check(await opts.inputValue('#profileNameAr') === 'ليلى حداد' && await opts.inputValue('#profileNameEn') === '', 'an older Arabic name shows in the Arabic field');
  await set({ testerName: 'Layla Haddad', profileNameEn: '', profileNameAr: '' });
  await opts.reload();
  await opts.waitForFunction(() => document.getElementById('profileNameEn').value !== '', null, { timeout: 8000 });
  check(await opts.inputValue('#profileNameEn') === 'Layla Haddad' && await opts.inputValue('#profileNameAr') === '', 'an older Latin name shows in the English field');

  /* B3. the top bar, in the float (420 wide) and the toolbar popup (348 wide) */
  const pop = watch(await ctx.newPage());
  await pop.setViewportSize({ width: 420, height: 640 });
  const open = async (page, file, lang) => {
    await page.goto(url(file));
    await page.evaluate((l) => QAWi18n.setLang(l), lang);
    await page.waitForFunction((l) => document.documentElement.lang === l && document.querySelector('[data-profile-chip]')?.dataset.profileReady === '1', lang, { timeout: 15000 });
  };
  const chipText = (page) => page.locator('[data-profile-chip] .pchip-name').first().innerText();
  const box = (page, sel) => page.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }, sel);

  /* no profile at all: the quiet chip */
  await set({ testerName: '', profileNameEn: '', profileNameAr: '', profilePicture: '' });
  await open(pop, 'popup/popup.html?surface=float', 'en');
  check(await pop.locator('.pchip-empty').count() === 1 && (await chipText(pop)) === 'Set up profile', 'no profile: a "Set up profile" chip');
  check(await pop.locator('.pchip-wrap').count() === 0, 'and no hover card for nothing');
  if (SHOTS) await pop.locator('#app-head').screenshot({ path: path.join(SHOTS, 'popup-en-empty.png') });
  await pop.evaluate(() => QAWi18n.setLang('ar'));
  await pop.waitForFunction(() => document.querySelector('.pchip-name')?.textContent === 'أنشئ ملفك', null, { timeout: 8000 });
  check(true, 'in Arabic the chip says «أنشئ ملفك»');
  if (SHOTS) await pop.locator('#app-head').screenshot({ path: path.join(SHOTS, 'popup-ar-empty.png') });

  /* both names, no picture: initials avatar, the name for the language */
  await set({ testerName: 'Layla Haddad', profileNameEn: 'Layla Haddad', profileNameAr: 'ليلى حداد', profilePicture: '' });
  await pop.waitForFunction(() => document.querySelector('.pchip-wrap'), null, { timeout: 8000 }); // repainted by the settings broadcast
  await pop.evaluate(() => QAWi18n.setLang('en'));
  await pop.waitForFunction(() => document.querySelector('.pchip-name')?.textContent === 'Layla Haddad', null, { timeout: 8000 });
  check((await chipText(pop)) === 'Layla Haddad', 'English UI shows the English name');
  check(await pop.locator('.pchip[data-state="initials"] .pchip-av').innerText() === 'LH', 'no picture: an initials avatar');
  if (SHOTS) await pop.locator('#app-head').screenshot({ path: path.join(SHOTS, 'popup-en-initials.png') });
  await pop.evaluate(() => QAWi18n.setLang('ar'));
  await pop.waitForFunction(() => document.querySelector('.pchip-name')?.textContent === 'ليلى حداد', null, { timeout: 8000 });
  check((await chipText(pop)) === 'ليلى حداد', 'Arabic UI shows the Arabic name');
  check(await pop.locator('.pchip-av').innerText() === 'لح', 'Arabic initials');
  if (SHOTS) await pop.locator('#app-head').screenshot({ path: path.join(SHOTS, 'popup-ar-initials.png') });

  /* only one name set: it is shown in both languages */
  await set({ testerName: 'Layla Haddad', profileNameEn: 'Layla Haddad', profileNameAr: '', profilePicture: '' });
  await pop.waitForFunction(() => document.querySelector('.pchip-name')?.textContent === 'Layla Haddad', null, { timeout: 8000 });
  check((await chipText(pop)) === 'Layla Haddad' && pop.url().includes('popup'), 'Arabic UI, only an English name set: that name is shown');
  await set({ testerName: 'ليلى حداد', profileNameEn: '', profileNameAr: 'ليلى حداد' });
  await pop.evaluate(() => QAWi18n.setLang('en'));
  await pop.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('.pchip-name')?.textContent === 'ليلى حداد', null, { timeout: 8000 });
  check(true, 'English UI, only an Arabic name set: that name is shown');
  /* the older single name alone (never migrated in storage) still shows */
  await set({ testerName: 'Omar Saleh', profileNameEn: '', profileNameAr: '' });
  await pop.waitForFunction(() => document.querySelector('.pchip-name')?.textContent === 'Omar Saleh', null, { timeout: 8000 });
  check(true, 'the older single name alone is migrated on read and shown');

  /* with a picture */
  await set({ testerName: 'Layla Haddad', profileNameEn: 'Layla Haddad', profileNameAr: 'ليلى حداد', profilePicture: PIC });
  await pop.evaluate(() => QAWi18n.setLang('en'));
  await pop.waitForFunction(() => document.querySelector('.pchip[data-state="picture"] img')?.complete, null, { timeout: 8000 });
  check(await pop.locator('.pchip .pchip-av img').evaluate((i) => i.naturalWidth) > 0, 'with a picture: the picture is drawn beside the name');
  check(await pop.locator('.pchip .pchip-av img').getAttribute('src') === PIC, 'and it is the local data URL, nothing remote');
  if (SHOTS) await pop.locator('#app-head').screenshot({ path: path.join(SHOTS, 'popup-en-picture.png') });
  await pop.evaluate(() => QAWi18n.setLang('ar'));
  await pop.waitForFunction(() => document.documentElement.dir === 'rtl' && document.querySelector('.pchip-name')?.textContent === 'ليلى حداد', null, { timeout: 8000 });
  if (SHOTS) await pop.locator('#app-head').screenshot({ path: path.join(SHOTS, 'popup-ar-picture.png') });
  await pop.evaluate(() => QAWi18n.setLang('en'));
  await pop.waitForFunction(() => document.documentElement.dir === 'ltr' && document.querySelector('.pchip-name')?.textContent === 'Layla Haddad', null, { timeout: 8000 });

  /* hover card */
  const wrapOpen = () => pop.locator('.pchip-wrap').evaluate((w) => w.classList.contains('is-open'));
  const cardOpacity = () => pop.locator('.pcard').evaluate((c) => Number(getComputedStyle(c).opacity));
  check(!(await wrapOpen()) && (await cardOpacity()) === 0, 'at rest the card is closed and invisible');
  await pop.mouse.move(5, 300);
  await pop.hover('.pchip');
  await pop.waitForFunction(() => Number(getComputedStyle(document.querySelector('.pcard')).opacity) > 0.99, null, { timeout: 4000 });
  check(await wrapOpen(), 'hover opens the card');
  const cardRows = await pop.locator('.pcard-names span').allInnerTexts();
  check(cardRows.join('|') === 'Layla Haddad|ليلى حداد', 'the card shows the name in both languages, the interface language first', cardRows.join('|'));
  check(await pop.locator('.pcard-av img').evaluate((i) => i.naturalWidth > 0 && i.getBoundingClientRect().width >= 56), 'and the larger picture');
  check((await pop.locator('.pcard-edit').innerText()) === 'Edit profile', 'and an Edit profile action');
  const cb = await box(pop, '.pcard');
  check(cb.l >= 0 && cb.r <= 420, 'the card stays inside the window', JSON.stringify(cb));
  if (SHOTS) await pop.screenshot({ path: path.join(SHOTS, 'popup-en-hovercard.png'), clip: { x: 0, y: 0, width: 420, height: 300 } });
  await pop.mouse.move(5, 500);
  await pop.waitForFunction(() => !document.querySelector('.pchip-wrap').classList.contains('is-open'), null, { timeout: 4000 });
  check(true, 'moving away closes it');

  /** Focus the chip as a keyboard user would and wait until the card has opened; a page that is not in front gets no focus events, so bring it forward and try again. */
  const focusChip = async () => {
    for (let i = 0; i < 4; i++) {
      await pop.bringToFront();
      await pop.evaluate(() => { document.activeElement?.blur?.(); document.querySelector('.pchip').focus(); });
      if (await pop.waitForFunction(() => document.querySelector('.pchip-wrap')?.classList.contains('is-open'), null, { timeout: 1500 }).then(() => true, () => false)) return;
    }
    throw new Error('the chip never took keyboard focus');
  };

  /* keyboard: focus opens the same card, Escape closes it, Tab reaches Edit profile */
  await focusChip();
  check(true, 'keyboard focus on the chip opens the card');
  check(await pop.locator('.pchip').getAttribute('aria-expanded') === 'true', 'and says so (aria-expanded)');
  await pop.keyboard.press('Tab');
  check(await pop.evaluate(() => document.activeElement?.classList.contains('pcard-edit')), 'Tab moves into the card, onto Edit profile, which stays open');
  check(await wrapOpen(), 'the card stays open while focus is inside it');
  await pop.keyboard.press('Escape');
  check(!(await wrapOpen()) && await pop.evaluate(() => document.activeElement?.classList.contains('pchip')), 'Escape closes the card and returns to the chip');

  /* Edit profile opens the Profile tab: an open Settings tab is pointed at it */
  const before = ctx.pages().length;
  await opts.bringToFront();
  await opts.goto(url('options/options.html#sec-appearance'));
  await opts.waitForSelector('#sec-appearance:not([hidden])');
  await opts.waitForSelector('body[data-options-ready="1"]', { timeout: 15000 });
  await focusChip();
  await pop.keyboard.press('Tab');
  await pop.keyboard.press('Enter');
  await opts.waitForFunction(() => location.hash === '#sec-profile' && !document.getElementById('sec-profile').hidden, null, { timeout: 8000 }).catch(async (e) => {
    throw new Error(`${e.message} :: opts=${opts.url()} focus=${await pop.evaluate(() => document.activeElement?.className)} open=${await pop.evaluate(() => document.querySelector('.pchip-wrap')?.className)} pages=${ctx.pages().map((p) => p.url()).join(' ')}`);
  });
  check(ctx.pages().length === before, 'Edit profile reuses the open Settings tab and shows the Profile tab');
  /* and with no Settings tab open, a new one opens there */
  host = pop;
  await opts.close();
  const newPage = ctx.waitForEvent('page', { timeout: 8000 });
  await focusChip();
  await pop.keyboard.press('Tab');
  await pop.keyboard.press('Enter');
  const created = await newPage;
  await created.waitForURL(/options\/options\.html#sec-profile/, { timeout: 8000 });
  check(true, 'with no Settings tab open, Edit profile opens one at the Profile tab');
  await created.close();

  /* inline-end placement, LTR and RTL */
  for (const [lang, dir] of [['en', 'ltr'], ['ar', 'rtl']]) {
    await pop.evaluate((l) => QAWi18n.setLang(l), lang);
    await pop.waitForFunction((d) => document.documentElement.dir === d, dir, { timeout: 8000 });
    const head = await box(pop, '#app-head');
    const chip = await box(pop, '.pchip-slot');
    const atEnd = dir === 'ltr' ? head.r - chip.r : chip.l - head.l;
    const gapToStart = dir === 'ltr' ? chip.l - head.l : head.r - chip.r;
    check(await pop.locator('.pchip .pchip-name').isVisible(), `${lang}: the 420 px float shows the name beside the picture`);
    check(chip.l >= head.l - 0.5 && chip.r <= head.r + 0.5, `${lang}: the chip does not overflow the bar`);
    check(atEnd >= 0 && atEnd <= 24 && gapToStart > 150, `${lang}: the chip sits at the inline-end of the top bar`, JSON.stringify({ head, chip }));
    await pop.hover('.pchip');
    await pop.waitForFunction(() => Number(getComputedStyle(document.querySelector('.pcard')).opacity) > 0.99, null, { timeout: 4000 });
    const c = await box(pop, '.pcard');
    check(c.l >= 0 && c.r <= 420, `${lang}: the card stays inside the window`, JSON.stringify(c));
    check(dir === 'ltr' ? Math.abs(c.r - chip.r) <= 2 : Math.abs(c.l - chip.l) <= 2, `${lang}: the card is anchored to the chip's inline-end edge`);
    if (SHOTS) await pop.screenshot({ path: path.join(SHOTS, `popup-${lang}-hovercard.png`), clip: { x: 0, y: 0, width: 420, height: 300 } });
    await pop.mouse.move(5, 500);
    await pop.waitForFunction(() => !document.querySelector('.pchip-wrap').classList.contains('is-open'), null, { timeout: 4000 });
  }

  /* the toolbar popup is 348 wide: the picture stays, the name text goes, nothing overflows */
  await open(pop, 'popup/popup.html', 'en');
  const narrowHead = await box(pop, '#app-head'); const narrowChip = await box(pop, '.pchip-slot');
  check(await pop.locator('.pchip .pchip-name').isHidden() && narrowChip.r <= narrowHead.r && narrowChip.l > narrowHead.l + 150, 'the 348 px popup shows the picture only, inside the bar', JSON.stringify({ narrowHead, narrowChip }));
  check((await pop.locator('.pchip').getAttribute('aria-label')).includes('Layla Haddad'), 'and the name is still in the button label');
  await open(pop, 'popup/popup.html?surface=float', 'en');

  /* reduced motion: the card appears without a transition or a move */
  await pop.emulateMedia({ reducedMotion: 'reduce' });
  const rm = await pop.locator('.pcard').evaluate((c) => { const cs = getComputedStyle(c); return { dur: cs.transitionDuration, tf: cs.transform }; });
  check(rm.dur.split(',').every((d) => parseFloat(d) <= 0.001) && rm.tf === 'none', 'reduced motion: no transition and no transform on the card', JSON.stringify(rm));
  await pop.emulateMedia({ reducedMotion: 'no-preference' });
  const mo = await pop.locator('.pcard').evaluate((c) => getComputedStyle(c).transitionDuration);
  check(/0\.1[28]s/.test(mo), 'otherwise the card eases in and out (120 to 180 ms)', mo);

  /* the fonts are the product's (Thmanyah through the shared token) */
  const font = await pop.locator('.pchip-name').evaluate((e) => getComputedStyle(e).fontFamily);
  check(!/cairo/i.test(font), 'the chip font is the product font, never Cairo', font);

  /* B4. the report's top bar */
  const rep = watch(await ctx.newPage());
  await rep.setViewportSize({ width: 1100, height: 700 });
  await set({ testerName: 'Layla Haddad', profileNameEn: 'Layla Haddad', profileNameAr: 'ليلى حداد', profilePicture: PIC });
  await open(rep, 'report/report.html', 'en');
  check((await chipText(rep)) === 'Layla Haddad' && await rep.locator('.app-bar .pchip-slot .pchip[data-state="picture"]').count() === 1, 'the report top bar shows the picture and the English name');
  const rh = await box(rep, '.app-bar'); const rc = await box(rep, '.app-bar .pchip-slot');
  check(rh.r - rc.r <= 40 && rc.l > rh.l + 300, 'English: the chip is at the inline-end of the report bar', JSON.stringify({ rh, rc }));
  if (SHOTS) await rep.locator('.app-bar').screenshot({ path: path.join(SHOTS, 'report-en-picture.png') });
  await rep.evaluate(() => QAWi18n.setLang('ar'));
  await rep.waitForFunction(() => document.documentElement.dir === 'rtl' && document.querySelector('.pchip-name')?.textContent === 'ليلى حداد', null, { timeout: 8000 });
  const rh2 = await box(rep, '.app-bar'); const rc2 = await box(rep, '.app-bar .pchip-slot');
  check(rc2.l - rh2.l <= 40 && rh2.r > rc2.r + 300, 'Arabic: the chip is at the inline-end (left) of the report bar', JSON.stringify({ rh2, rc2 }));
  if (SHOTS) await rep.locator('.app-bar').screenshot({ path: path.join(SHOTS, 'report-ar-picture.png') });
  await set({ profilePicture: '' });
  await rep.waitForFunction(() => document.querySelector('.pchip[data-state="initials"]'), null, { timeout: 8000 });
  if (SHOTS) await rep.locator('.app-bar').screenshot({ path: path.join(SHOTS, 'report-ar-initials.png') });
  await rep.evaluate(() => QAWi18n.setLang('en'));
  await rep.waitForFunction(() => document.documentElement.dir === 'ltr' && document.querySelector('.pchip-name')?.textContent === 'Layla Haddad', null, { timeout: 8000 });
  if (SHOTS) await rep.locator('.app-bar').screenshot({ path: path.join(SHOTS, 'report-en-initials.png') });

  check(errors.length === 0, 'no page error on any surface', errors.join(' | '));
  await set({ testerName: '', profileNameEn: '', profileNameAr: '', profilePicture: '' });
  console.log('test-profile-tab B (entry smoke, headless Chromium, tag qaw-1110): ok');
} finally {
  await ctx?.close().catch(() => {});
  recycle(profileDir);
}
console.log(`${passed} passed, 0 failed`);
