/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-021 Accept, measured: the real bar (content/bar.js + ui-host.js + overlay.css, the real strings and the
 * Thmanyah face the worker would send) in headless Chromium, with the problems chip on, at 360, 440 and 560 px,
 * in English and Arabic, with 1, 12 and 99 problems. The chip must be drawn inside the bar, print the number it was
 * given, and nothing may run past the bar or the viewport. No extension, no desktop window: a stubbed `chrome`.
 *
 *   node tools/test-bar-geometry.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const OVERLAY_KEYS = /^(overlay\.|popup\.pick\.(head|any|step|element|sensitive)$|popup\.live\.(stop|noLocator|copyAgain)$|options\.sound\.ui\.copy$|options\.actions\.shot\.label$|popup\.note\.add$)/;
const fontsCss = read('ui/fonts.css');
const faces = [400, 500].map((w) => fontsCss.match(new RegExp(`'Thmanyah Sans';[^}]*?weight: ${w};[^}]*?base64,([^')]+)`))?.[1] || null);
const css = read('content/overlay.css');
const SCRIPTS = ['ui/icons.js', 'ui/tone.js', 'content/ui-host.js', 'content/bar.js'].map(read);
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
const check = (name, ok, detail = '') => { if (ok) { passed++; } else { failures.push(`${name} ${detail}`); console.log(`  FAIL ${name}\n       ${detail}`); } };

// R15: the Thmanyah face has to be in the page, or the widths below are system-font widths and prove nothing.
check('sample: both Thmanyah Sans faces were found in ui/fonts.css', faces.every(Boolean), JSON.stringify(faces.map((f) => !!f)));

const browser = await chromium.launch({ headless: true });
try {
  for (const lang of ['en', 'ar']) {
    for (const width of [360, 440, 560]) {
      for (const n of [1, 12, 99]) {
        const tag = `${lang} ${width}px, ${n} problems`;
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        page.on('pageerror', (e) => console.log('       page error:', e.message));
        await page.addInitScript(({ assets, dir }) => {
          const real = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function (init) { const r = real.call(this, init); window.__root = r; return r; };
          let onMsg = null;
          window.chrome = {
            runtime: {
              id: 'x', lastError: undefined,
              sendMessage: (m, cb) => cb && cb(m?.type === 'UQA_OVERLAY_ASSETS' ? { ok: true, result: assets } : { ok: true, result: null }),
              onMessage: { addListener: (fn) => { onMsg = fn; } },
            },
            storage: { sync: { get: (k, cb) => cb({}), set() {} }, local: { get: (k, cb) => cb && cb({}), set() {} }, onChanged: { addListener() {} } },
            i18n: { getUILanguage: () => 'en' },
          };
          window.__ask = () => new Promise((r) => onMsg?.({ type: 'UQA_UI_HIDE', hidden: false, measure: true }, { id: 'x' }, r));
          let push = null;
          window.UQABridge = { send() {}, watch: (fn) => { push = fn; } };
          window.__push = (s) => push && push(s);
        }, { assets: assetsFor(lang), dir: lang === 'ar' ? 'rtl' : 'ltr' });
        await page.goto('about:blank');
        await page.setContent('<!doctype html><html dir="' + (lang === 'ar' ? 'rtl' : 'ltr') + '"><head><meta charset="utf-8"></head><body style="margin:0"><main>page</main></body></html>');
        for (const code of SCRIPTS) await page.addScriptTag({ content: code });
        await page.waitForFunction(() => !!window.UQABar && typeof window.__push === 'function', null, { timeout: 8000 });
        await page.evaluate((count) => window.__push({ recording: true, startedAt: Date.now(), problems: count, problemsTone: 'error' }), n);
        await page.waitForFunction(() => document.fonts.check('13px "Thmanyah Sans"') || true);
        await page.waitForTimeout(1200); // the 5 s idle fade is far off; the entrance and compaction settle in well under this
        const m = await page.evaluate(() => {
          const root = window.__root;
          const chip = root?.querySelector('.uqa-problems');
          const bar = root?.querySelector('.uqa-bar');
          const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
          const kids = bar ? [...bar.querySelectorAll('*')].filter((e) => e.getClientRects().length && !e.closest('[hidden]')).map((e) => ({ ...box(e), cls: String(e.className?.baseVal ?? e.className).slice(0, 30), tag: e.tagName })) : [];
          const bb = bar ? box(bar) : null;
          const over = bb ? kids.filter((k) => k.right > bb.right + 0.5 || k.left < bb.left - 0.5).map((k) => `${k.tag}.${k.cls}`) : [];
          return {
            sawRoot: !!root, top: bar ? [...bar.children].filter((e) => e.getClientRects().length).map((e) => `${e.className}:${Math.round(e.getBoundingClientRect().width)}`).join(' ') : '', over, ov: bar ? getComputedStyle(bar).overflow + ' ' + bar.className : '', bar: bar && !bar.hidden ? box(bar) : null, chip: chip && !chip.hidden ? { ...box(chip), text: chip.textContent.trim(), label: chip.getAttribute('aria-label'), glyph: !!chip.querySelector('svg') } : null,
            vw: innerWidth, fontOk: document.fonts.check('13px "Thmanyah Sans"'), farthest: kids.reduce((a, k) => Math.max(a, k.right), 0), nearest: kids.reduce((a, k) => Math.min(a, k.left), 1e9),
          };
        });
        check(`${tag}: the bar was drawn (ready state seen)`, !!m.bar && m.sawRoot, JSON.stringify(m));
        if (m.bar) {
          check(`${tag}: the Thmanyah face was in the page`, m.fontOk);
          check(`${tag}: the chip is drawn with a glyph, the number and its word`, !!m.chip && m.chip.glyph && m.chip.text.includes(String(n)) && new RegExp(lang === 'ar' && n === 1 ? 'واحدة' : String(n)).test(m.chip.label || ''), JSON.stringify(m.chip));
          check(`${tag}: the bar fits the viewport`, m.bar.left >= -0.5 && m.bar.right <= m.vw + 0.5, JSON.stringify(m.bar));
          if (m.chip) check(`${tag}: the chip is inside the bar`, m.chip.left >= m.bar.left - 0.5 && m.chip.right <= m.bar.right + 0.5, `${JSON.stringify(m.chip)} in ${JSON.stringify(m.bar)}`);
          check(`${tag}: nothing in the bar runs past it`, m.farthest <= m.bar.right + 0.5 && m.nearest >= m.bar.left - 0.5, `kids ${m.nearest}..${m.farthest} in ${m.bar.left}..${m.bar.right}; ${m.ov}; top: ${m.top}`);
        }
        await page.close();
      }
    }
  }

  // 1015 (lane E): pick controls only while picking, words on the quick buttons, "3 problems" as a button, the bar steps
  // off a focused text field once, and Enter in the bar's note box saves a Bug. Same real scripts, one page per case.
  const KEYMAP = read('content/keymap.js');
  const open1015 = async (lang, width) => {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.on('pageerror', (e) => console.log('       page error:', e.message));
    await page.addInitScript(({ assets }) => {
      const real = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (init) { const r = real.call(this, init); window.__root = r; return r; };
      window.chrome = {
        runtime: { id: 'x', lastError: undefined, sendMessage: (m, cb) => cb && cb({ ok: true, result: m?.type === 'UQA_OVERLAY_ASSETS' ? assets : null }), onMessage: { addListener() {} } },
        storage: { sync: { get: (k, cb) => cb({}), set() {} }, local: { get: (k, cb) => cb && cb({}), set() {} }, onChanged: { addListener() {} } },
        i18n: { getUILanguage: () => 'en' },
      };
      window.__sent = [];
      let push = null;
      window.UQASettings = { keymapEnabled: true, keymap: { shot: 'Alt+KeyS', note: 'Alt+KeyN' } };
      window.UQABridge = { send: (m) => { window.__sent.push(m); return Promise.resolve({ ok: true }); }, watch: (fn) => { push = fn; } };
      window.__push = (st) => push && push(st);
    }, { assets: assetsFor(lang) });
    await page.goto('about:blank');
    await page.setContent('<!doctype html><html dir="' + (lang === 'ar' ? 'rtl' : 'ltr') + '"><head><meta charset="utf-8"></head><body style="margin:0"><main>page</main>'
      + '<textarea id="low" style="position:fixed;left:150px;bottom:16px;width:' + Math.max(200, width - 300) + 'px;height:48px"></textarea>'
      + '<textarea id="mid" style="position:fixed;left:150px;top:300px;width:300px;height:40px"></textarea></body></html>');
    for (const code of [...SCRIPTS, KEYMAP]) await page.addScriptTag({ content: code });
    await page.waitForFunction(() => !!window.UQABar && typeof window.__push === 'function', null, { timeout: 8000 });
    return page;
  };
  const view = (page) => page.evaluate(() => {
    const root = window.__root;
    const shown = (sel) => [...root.querySelectorAll(sel)].filter((e) => e.getClientRects().length);
    return {
      purpose: shown('.uqa-purpose').length, segs: shown('.uqa-seg').length, locator: shown('.uqa-locator').length,
      words: shown('.uqa-lbl').map((e) => e.textContent.trim()), chip: shown('.uqa-problems-full').map((e) => e.textContent.trim())[0] || null,
      chipTag: root.querySelector('.uqa-problems')?.tagName, probe: window.UQABar.probe(), bar: root.querySelector('.uqa-bar')?.className,
    };
  });
  const live = (page, n) => page.evaluate((c) => window.__push({ recording: true, startedAt: Date.now(), problems: c, problemsTone: 'warning' }), n);

  {
    const page = await open1015('en', 1280);
    await live(page, 3);
    await page.waitForTimeout(500);
    const v = await view(page);
    check('1015 en 1280: not picking, the purpose group and the locator are not drawn', v.purpose === 0 && v.segs === 0 && v.locator === 0, JSON.stringify(v));
    check('1015 en 1280: Shot, Note and Open panel are written beside the icons', v.words.join('|') === 'Shot|Note|Open panel', JSON.stringify(v.words));
    check('1015 en 1280: the chip reads "3 problems" and is a button', v.chip === '3 problems' && v.chipTag === 'BUTTON', JSON.stringify([v.chip, v.chipTag]));
    await page.evaluate(() => window.__root.querySelector('.uqa-problems').click());
    check('1015: pressing the chip sends the same message as the Panel button', (await page.evaluate(() => window.__sent.map((m) => m.type))).includes('UQA_OPEN_FLOAT'));
    await page.evaluate(() => window.__root.querySelector('.uqa-quick .uqa-icon-btn').focus());
    const tip = await page.evaluate(() => window.__root.querySelector('.uqa-bar-tip')?.textContent || '');
    check("1015: the tooltip carries the tester's key (Alt+S for the screenshot)", /Alt\+S/.test(tip) && /Screenshot/.test(tip), tip);
    await page.evaluate(() => window.UQABar.picking(true));
    await page.waitForTimeout(400);
    const p = await view(page);
    check('1015: while picking the four purposes and the locator are drawn', p.segs === 4 && p.locator === 1 && p.probe.picking, JSON.stringify(p));
    await page.evaluate(() => window.UQABar.picking(false));
    await page.waitForTimeout(400);
    const q = await view(page);
    check('1015: when the pick ends they go away again', q.segs === 0 && q.locator === 0, JSON.stringify(q));
    // text field: focusing one the bar covers moves the bar once; one it does not cover moves nothing
    await page.focus('#mid');
    check('1015: a focused field the bar does not cover moves nothing', (await view(page)).probe.effective === 'bottom');
    await page.focus('#low');
    await page.waitForTimeout(400);
    const f = (await view(page)).probe;
    check('1015: a focused field under the bar sends it to the opposite edge, once', f.effective === 'top' && f.fieldYield === true, JSON.stringify(f));
    await page.focus('#mid');
    await page.focus('#low');
    await page.waitForTimeout(300);
    check('1015: it stays there (no snap back, no bounce)', (await view(page)).probe.effective === 'top');
    await page.evaluate(() => window.UQABar.dock('bottom'));
    await page.waitForTimeout(300);
    check('1015: docking it by hand makes that edge home again', (await view(page)).probe.effective === 'bottom');
    // Enter / Shift+Enter in the bar's note box
    for (const [shift, want] of [[false, 'bug'], [true, null]]) {
      await page.evaluate(() => { window.__sent.length = 0; window.UQAKeymap.promptNote(); });
      await page.evaluate((sh) => {
        const input = window.__root.querySelector('.uqa-quicknote input');
        input.value = 'Save stays disabled';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: sh, bubbles: true }));
      }, shift);
      await page.waitForTimeout(150);
      const note = await page.evaluate(() => window.__sent.find((m) => m.type === 'UQA_NOTE'));
      check(`1015: ${shift ? 'Shift+Enter' : 'Enter'} in the bar's note box saves ${want ? 'a Bug' : 'a plain note'}`, !!note && note.tag === want, JSON.stringify(note));
    }
    await page.close();
  }
  // K1 (lane V saw only "Stop" worded and a chip of "2" in a real browser): the words are dropped only by width. The real bar with the
  // Thmanyah face is 716 px wide, so the ladder leaves it whole at 1280 and 1920 and at the 760 px a docked-DevTools window gives.
  for (const width of [1280, 1920, 760]) {
    const page = await open1015('en', width);
    await live(page, 2);
    await page.waitForTimeout(600);
    const v = await view(page);
    const fontOk = await page.evaluate(() => document.fonts.check('14px "QAW Thmanyah Sans"') || document.fonts.check('14px "Thmanyah Sans"'));
    check(`K1 en ${width}: real face loaded, the ladder is untouched, three words and "2 problems" are drawn`,
      fontOk && !/(^|\s)c\d/.test(v.bar) && v.words.join('|') === 'Shot|Note|Open panel' && v.chip === '2 problems', JSON.stringify([fontOk, v.bar, v.words, v.chip]));
    await page.close();
  }
  {
    const page = await open1015('en', 360);
    await live(page, 3);
    await page.waitForTimeout(500);
    const v = await view(page);
    check('1015 en 360: the words drop first (the ladder), the icons stay', v.words.length === 0 && /\bc1\b/.test(v.bar), JSON.stringify([v.words, v.bar]));
    await page.close();
  }
  {
    const page = await open1015('ar', 1280);
    await live(page, 3);
    await page.waitForTimeout(500);
    const v = await view(page);
    check('1015 ar 1280: the words and the chip are Arabic, from the same plural key as the popup', v.words.join('|') === 'لقطة|ملاحظة|افتح اللوحة' && v.chip === '3 مشكلات', JSON.stringify([v.words, v.chip]));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`bar geometry: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
