/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * f1022: the island's two counters and Record button, and the shared working / success / failure helper (ui/live.js + ui/live.css).
 * Wiring is checked as text; the helper and the real bar are driven in headless Chromium (normal and reduced motion).
 *
 *   node tools/test-f1022.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => { if (ok) passed++; else { failures.push(name); console.log(`  FAIL ${name}\n       ${detail}`); } };

/* ── wiring as text ── */
const bar = read('content/bar.js');
check('island: evidence counter, problems chip shown at zero, Record button', /el\('span', 'uqa-evidence'/.test(bar) && /const on = state\.live;/.test(bar) && /worded\('tool-record'/.test(bar));
check('island: Record sends the side panel\'s own UQA_RECORD_SCREEN', /UQA_RECORD_SCREEN/.test(bar) && /'UQA_RECORD_SCREEN'/.test(read('background/service-worker.js').slice(read('background/service-worker.js').indexOf('const CONTENT_SCRIPT_TYPES'), read('background/service-worker.js').indexOf('async function guardSender'))));
check('island: Shot, Stop and Record run through the live helper', /press\(shot,/.test(bar) && /press\(stop,/.test(bar) && /press\(rec,/.test(bar));
check('bridge carries the evidence number', /evidence: \['shot', 'note', 'record'\]/.test(read('content/bridge.js')));
check('worker injects ui/live.js with the bar and adds ui/live.css to the overlay CSS', /BAR_FILES = \['ui\/icons\.js', 'ui\/tone\.js', 'ui\/live\.js'/.test(read('background/handlers-session.js')) && /'ui\/live\.css'/.test(read('background/handlers-session.js')));
check('side panel: live.css + live.js loaded, tool presses start and end the helper', /ui\/live\.css/.test(read('popup/popup.html')) && /ui\/live\.js/.test(read('popup/popup.html')) && /UQALive\?\.start/.test(read('popup/tool-actions.js')) && /UQALive\?\.end/.test(read('popup/tool-actions.js')));
const en = JSON.parse(read('platform/i18n/en.json'));
const ar = JSON.parse(read('platform/i18n/ar.json'));
const KEYS = ['overlay.bar.f1022LabelRecord', 'overlay.bar.f1022Record', 'overlay.bar.f1022Evidence', 'overlay.bar.f1022Done', 'overlay.bar.f1022Failed'];
check('strings in EN and AR together', KEYS.every((k) => en[k] && ar[k] && en[k] !== ar[k]), KEYS.filter((k) => !en[k] || !ar[k]).join(','));
const css = read('ui/live.css');
check('css: working turn, check draw + pulse, cross shake, reduced-motion switch-off', /live-turn/.test(css) && /live-draw/.test(css) && /live-pulse/.test(css) && /live-shake/.test(css) && /reduce\)[\s\S]*animation: none/.test(css));

/* ── the helper, in a browser ── */
const LIVE = read('ui/live.js');
const browser = await chromium.launch({ headless: true });
try {
  for (const motion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ reducedMotion: motion });
    await page.setContent('<!doctype html><body><button id="b"><span id="h"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 3h18v18H3z"/></svg></span></button></body>');
    await page.addStyleTag({ content: read('ui/live.css') });
    await page.addScriptTag({ content: LIVE });
    const snap = () => page.evaluate(() => {
      const h = document.getElementById('h');
      const g = h.querySelector('.live-glyph');
      return { live: h.hasAttribute('data-live'), state: h.getAttribute('data-live-state'), glyph: g ? g.querySelector('path').getAttribute('d') : null, glyphState: g?.getAttribute('data-live-state') || null,
        iconShown: getComputedStyle(h.querySelector('svg:not(.live-glyph)')).display !== 'none', iconAnim: getComputedStyle(h.querySelector('svg:not(.live-glyph)')).animationName, glyphAnim: g ? getComputedStyle(g).animationName : null, glyphPathAnim: g ? getComputedStyle(g.querySelector('path')).animationName : null };
    });
    await page.evaluate(() => UQALive.start(document.getElementById('h')));
    const w = await snap();
    check(`${motion}: working is [data-live] and moves or, under reduced motion, is a static dots glyph`, w.live && w.state === 'working' && (motion === 'reduce' ? !w.iconShown && w.glyph?.includes('.01') && w.glyphAnim === 'none' : w.iconShown && w.iconAnim === 'live-turn'), JSON.stringify(w));
    await page.evaluate(() => UQALive.end(document.getElementById('h'), true));
    const ok = await snap();
    await page.evaluate(() => UQALive.end(document.getElementById('h'), false));
    const bad = await snap();
    check(`${motion}: success is a check, failure is a cross, different shapes`, ok.glyphState === 'success' && bad.glyphState === 'failure' && ok.glyph && bad.glyph && ok.glyph !== bad.glyph, `${ok.glyph} | ${bad.glyph}`);
    check(`${motion}: ${motion === 'reduce' ? 'no animation on either ending' : 'success draws in and pulses, failure shakes'}`, motion === 'reduce'
      ? ok.glyphAnim === 'none' && ok.glyphPathAnim === 'none' && bad.glyphAnim === 'none'
      : ok.glyphAnim === 'live-pulse' && ok.glyphPathAnim === 'live-draw' && bad.glyphAnim === 'live-shake', JSON.stringify([ok, bad]));
    await page.evaluate(() => UQALive.end(document.getElementById('h')));
    const done = await snap();
    check(`${motion}: stopped puts the icon back, nothing left behind`, !done.live && done.state === null && done.glyph === null && done.iconShown);
    await page.evaluate(() => { UQALive.end(document.getElementById('h'), true); });
    await page.waitForTimeout(1750);
    check(`${motion}: an ending is restored after its hold`, !(await snap()).live && (await snap()).iconShown);
    await page.close();
  }

  /* ── the real island: counters, Record, working -> failure ── */
  const fontsCss = read('ui/fonts.css');
  const faces = [400, 500].map((w) => fontsCss.match(new RegExp(`'Thmanyah Sans';[^}]*?weight: ${w};[^}]*?base64,([^')]+)`))?.[1] || null);
  const OVERLAY_KEYS = /^(overlay\.|popup\.pick\.(head|any|step|element|sensitive)$|popup\.live\.(stop|noLocator|copyAgain)$|options\.sound\.ui\.copy$|options\.actions\.shot\.label$|popup\.note\.add$)/;
  const strings = {};
  for (const k of Object.keys(en)) if (OVERLAY_KEYS.test(k)) strings[k] = en[k];
  const assets = { faces: faces.filter(Boolean), css: `${read('content/overlay.css')}\n${read('ui/live.css')}`, strings, lang: 'en', dir: 'ltr', theme: null };
  const INJECTED = ['ui/icons.js', 'ui/tone.js', 'ui/live.js', 'content/ui-host.js', 'content/bridge.js', 'content/bar.js'].map(read);
  const page = await browser.newPage({ viewport: { width: 1100, height: 600 } });
  await page.addInitScript(({ assets }) => {
    const real = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) { const r = real.call(this, init); window.__root = r; return r; };
    window.__sent = [];
    window.chrome = {
      runtime: {
        id: 'x', lastError: undefined,
        sendMessage: (m, cb) => {
          window.__sent.push(m.type);
          const used = { shot: { count: 2 }, note: { count: 1 }, record: { count: 1 } };
          const r = m?.type === 'UQA_OVERLAY_ASSETS' ? assets : m?.type === 'UQA_ARMED' ? { armed: true } : m?.type === 'UQA_GET_STATE' ? { recording: true, session: { startedAt: Date.now() }, problems: 3, problemsTone: 'error', used } : null;
          if (m?.type === 'UQA_RECORD_SCREEN') setTimeout(() => cb && cb({ ok: false, error: 'refused' }), 900);
          else cb && cb({ ok: true, result: r });
        },
        onMessage: { addListener() {} },
      },
      storage: { sync: { get: (k, cb) => cb({}), set() {} }, local: { get: (k, cb) => cb && cb({}), set() {} }, onChanged: { addListener() {} } },
      i18n: { getUILanguage: () => 'en' },
    };
  }, { assets });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main>page</main></body></html>');
  for (const code of INJECTED) await page.addScriptTag({ content: code }).catch((e) => console.log('       script:', e.message));
  await page.evaluate(() => window.UQABridge.refreshState?.());
  await page.waitForFunction(() => !!window.UQABar && window.UQABar.probe().live && window.__root?.querySelector('.uqa-evidence-n')?.textContent === '4', null, { timeout: 8000 }).catch(() => {});
  const view = await page.evaluate(() => {
    const r = window.__root;
    const shown = (s) => [...r.querySelectorAll(s)].filter((e) => e.getClientRects().length);
    return { evidence: shown('.uqa-evidence-n').map((e) => e.textContent)[0], evidenceName: r.querySelector('.uqa-evidence')?.getAttribute('aria-label'), problems: shown('.uqa-problems-n, .uqa-problems-full').length > 0, recordBtn: shown('.uqa-icon-btn').some((b) => b.getAttribute('aria-label') === 'Record the screen'), probsLive: r.querySelector('.uqa-problems')?.hasAttribute('data-live'), evLive: r.querySelector('.uqa-evidence')?.hasAttribute('data-live') };
  });
  check('island: evidence counter shows shots + recordings + notes (2+1+1) with a name', view.evidence === '4' && /4 pieces of evidence/.test(view.evidenceName || ''), JSON.stringify(view));
  check('island: problems counter is visible and both counters are [data-live]', view.problems && view.probsLive && view.evLive, JSON.stringify(view));
  check('island: the Record button is there', view.recordBtn, JSON.stringify(view));
  await page.evaluate(() => [...window.__root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Record the screen').click());
  await page.waitForTimeout(250);
  const during = await page.evaluate(() => { const b = [...window.__root.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Record the screen'); return { state: b.getAttribute('data-live-state'), live: b.hasAttribute('data-live'), sent: window.__sent.includes('UQA_RECORD_SCREEN') }; });
  check('island: pressing Record sends UQA_RECORD_SCREEN and the icon is working', during.sent && during.state === 'working' && during.live, JSON.stringify(during));
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => { const b = [...window.__root.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Record the screen'); return { state: b.getAttribute('data-live-state'), glyph: b.querySelector('.live-glyph')?.getAttribute('data-live-state') }; });
  check('island: a refused start ends in the failure pattern', after.state === 'failure' && after.glyph === 'failure', JSON.stringify(after));
  await page.close();
} finally {
  await browser.close();
}
console.log(`f1022: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
