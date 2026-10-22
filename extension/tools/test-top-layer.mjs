/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-037 / T-041: the bar must stay reachable above the browser's top layer. Four cases in headless Chromium, each
 * with the real bar drawn: a modal dialog, a modal under a transformed ancestor, a [popover], and fullscreen. In every
 * one `elementFromPoint` at the Stop button must answer the QA Wrap host, and a real click on it must reach the
 * worker. (Scenario of the truth harness, T-038, when that lands; standalone until then.)
 *
 *   node tools/test-top-layer.mjs
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
// TOP_LAYER_HOST=<file>: run the same cases against another ui-host.js (the red run on the pre-fix tree).
const SCRIPTS = ['ui/icons.js', 'ui/tone.js', 'content/ui-host.js', 'content/bar.js'].map((f) => (f === 'content/ui-host.js' && process.env.TOP_LAYER_HOST ? fs.readFileSync(process.env.TOP_LAYER_HOST, 'utf8') : read(f)));
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
const FIXTURE = pathToFileURL(path.join(EXT, 'tools/fixtures/top-layer.html')).href;

const browser = await chromium.launch({ headless: true });
try {
  for (const kind of ['modal', 'modal-transform', 'popover', 'fullscreen']) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    page.on('pageerror', (e) => console.log('       page error:', e.message));
    await page.addInitScript(({ assets }) => {
      const real = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (init) { const r = real.call(this, init); window.__root = r; return r; };
      let onMsg = null;
      window.__sent = [];
      window.chrome = {
        runtime: {
          id: 'x', lastError: undefined,
          sendMessage: (m, cb) => { window.__sent.push(m?.type); cb && cb(m?.type === 'UQA_OVERLAY_ASSETS' ? { ok: true, result: assets } : { ok: true, result: null }); },
          onMessage: { addListener: (fn) => { onMsg = fn; } },
        },
        storage: { sync: { get: (k, cb) => cb({}), set() {} }, local: { get: (k, cb) => cb && cb({}), set() {} }, onChanged: { addListener() {} } },
        i18n: { getUILanguage: () => 'en' },
      };
      window.__ask = () => new Promise((r) => onMsg?.({ type: 'UQA_UI_HIDE', hidden: false, measure: true }, { id: 'x' }, r));
      let push = null;
      window.UQABridge = { send(m) { window.__sent.push(m?.type); }, watch: (fn) => { push = fn; } };
      window.__push = (s) => push && push(s);
    }, { assets: assetsFor('en') });
    await page.goto(`${FIXTURE}?case=${kind}`);
    for (const code of SCRIPTS) await page.addScriptTag({ content: code });
    await page.waitForFunction(() => !!window.UQABar && typeof window.__push === 'function', null, { timeout: 8000 });
    await page.evaluate(() => window.__push({ recording: true, startedAt: Date.now(), problems: 0 }));
    await page.waitForTimeout(900);
    if (kind === 'fullscreen') await page.click('#open-fs'); // a real click is the user gesture fullscreen needs
    else await page.evaluate(() => window.__open());
    await page.waitForTimeout(700);
    const stop = async () => {
      const m = await page.evaluate(() => window.__ask());
      const c = (m.controls || []).find((b) => /Stop/.test(b.label || ''));
      return c ? { x: c.left + c.width / 2, y: c.top + c.height / 2 } : null;
    };
    const at = await stop();
    check(`${kind}: the Stop button is drawn`, !!at, 'no Stop control in the measured bar');
    if (at) {
      await page.mouse.move(at.x, at.y); // a bar the pointer is away from fades and goes click-through, which elementFromPoint skips
      await page.waitForTimeout(150);
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.localName, at);
      check(`${kind}: elementFromPoint at Stop answers the QA Wrap host`, hit === 'qaw-ui', `hit <${hit}>`);
      await page.mouse.click(at.x, at.y);
      const sent = await page.evaluate(() => window.__sent);
      check(`${kind}: a real click on Stop reaches the worker`, sent.includes('UQA_STOP'), JSON.stringify(sent));
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`top layer: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
