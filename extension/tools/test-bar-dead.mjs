/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-044 Accept, measured: the real bridge, ui-host and bar in headless Chromium with a recording bar on screen; then
 * the extension context is severed the way an update severs it (`chrome.runtime.id` gone, `sendMessage` throwing).
 * Within the bridge's 3 s state poll the bar must say "QA Wrap was updated. Reload this tab to keep recording." and
 * no button may be left drawn: no state in which a control is on screen and dead.
 *
 *   node tools/test-bar-dead.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const OVERLAY_KEYS = /^(overlay\.|popup\.pick\.(head|any|step|element|sensitive)$|popup\.live\.(stop|noLocator|copyAgain)$|options\.sound\.ui\.copy$|options\.actions\.shot\.label$|popup\.note\.add$)/;
const fontsCss = read('ui/fonts.css');
const faces = [400, 500].map((w) => fontsCss.match(new RegExp(`'Thmanyah Sans';[^}]*?weight: ${w};[^}]*?base64,([^')]+)`))?.[1] || null);
const css = read('content/overlay.css');
const SCRIPTS = ['ui/icons.js', 'ui/tone.js', 'content/ui-host.js', 'content/bridge.js', 'content/bar.js'].map(read);
const en = JSON.parse(read('platform/i18n/en.json'));
const ar = JSON.parse(read('platform/i18n/ar.json'));
const assetsFor = (lang) => {
  const mine = lang === 'ar' ? ar : en;
  const strings = {};
  for (const k of Object.keys(en)) if (OVERLAY_KEYS.test(k)) strings[k] = mine[k] || en[k];
  return { faces: faces.filter(Boolean), css, strings, lang, dir: lang === 'ar' ? 'rtl' : 'ltr', theme: null };
};

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => { if (ok) { passed++; } else { failures.push(name); console.log(`  FAIL ${name}
       ${detail}`); } };
const SENTENCE = 'QA Wrap was updated. Reload this tab to keep recording.';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => console.log('       page error:', e.message));
  page.on('console', (m) => console.log('       console:', m.text()));
  await page.addInitScript(({ assets }) => {
    const real = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) { const r = real.call(this, init); window.__root = r; return r; };
    window.chrome = {
      runtime: {
        id: 'x', lastError: undefined,
        sendMessage: (m, cb) => {
          if (window.__severed) throw new Error('Extension context invalidated.');
          const r = m?.type === 'UQA_OVERLAY_ASSETS' ? assets : m?.type === 'UQA_ARMED' ? { armed: true } : m?.type === 'UQA_GET_STATE' ? { recording: true, session: { startedAt: Date.now() }, problems: 0 } : null;
          cb && cb({ ok: true, result: r });
        },
        onMessage: { addListener() {} },
      },
      storage: { sync: { get: (k, cb) => cb({}), set() {} }, local: { get: (k, cb) => cb && cb({}), set() {} }, onChanged: { addListener() {} } },
      i18n: { getUILanguage: () => 'en' },
    };
    window.__sever = () => { window.__severed = true; chrome.runtime.id = undefined; };
    window.__buttons = () => [...(window.__root?.querySelectorAll('button') || [])].filter((b) => b.getClientRects().length).length;
    window.__text = () => (window.__root?.textContent || '');
  }, { assets: assetsFor('en') });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main>page</main></body></html>');
  for (const code of SCRIPTS) await page.addScriptTag({ content: code }).catch((e) => console.log('       script:', e.message));
  await page.evaluate(() => window.UQABridge.refreshState?.());
  await page.waitForFunction(() => !!window.UQABar && window.UQABar.probe().live, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  check('before the update: a live bar with buttons is drawn', (await page.evaluate(() => window.__buttons())) > 0, await page.evaluate(() => JSON.stringify(window.UQABar?.probe?.())));
  await page.evaluate(() => window.__sever());
  await page.waitForFunction((s) => window.__text().includes(s) || false, SENTENCE, { timeout: 6000 }).catch(() => {});
  check('after the update: the bar says it was updated and to reload', (await page.evaluate(() => window.__text())).includes(SENTENCE), await page.evaluate(() => window.__text().slice(-200)));
  check('after the update: no button is left on screen', (await page.evaluate(() => window.__buttons())) === 0, String(await page.evaluate(() => window.__buttons())));
} finally {
  await browser.close();
}
console.log(`bar dead: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
