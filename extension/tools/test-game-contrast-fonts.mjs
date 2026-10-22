/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt contrast and fonts (DESIGN-bug-hunt sections 3, 12): WCAG contrast of every token pair and of the text actually
 * drawn on every screen, in both themes and both languages, and Thmanyah-only type (Cairo banned, no fallback family).
 *
 *   node tools/test-game-contrast-fonts.mjs        (from extension/, PYTHONUTF8=1)
 *
 * Headless Chromium against the game's own server on a free loopback port. Text needs >= 4.5:1 (>= 3:1 for large text:
 * 24 px, or 18.66 px bold); the token pairs below are all text pairs, so they need 4.5. Until game/ lands: exit 2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import { GAME, missing, startGame, launch, openGame, reach, openSettings, closeSettings } from './lib-game.mjs';

const need = missing('index.html', 'game.css', 'game.js', 'server.mjs', 'strings/en.json');
if (need.length) {
  skipNotEnforced({ rule: 'game', what: 'contrast and fonts', why: `game/${need.join(', game/')} (lanes A and B) have not landed` });
  finish('test-game-contrast-fonts', { skipped: 1 });
}

/* ---- the maths, and its teeth ------------------------------------------------------------------------------------- */
const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
ok(Math.abs(ratio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) - 21) < 0.01, 'the ratio maths gives 21:1 for black on white');
proveTeeth('the contrast check', ([a, b]) => (ratio(a, b) >= 4.5 ? [] : ['low']), [{ r: 119, g: 119, b: 119 }, { r: 130, g: 130, b: 130 }]);

const PAIRS = [['ink', 'bg'], ['ink', 'bg-raise'], ['ink-2', 'bg'], ['ink-2', 'bg-raise'], ['accent', 'bg'], ['accent', 'bg-raise'], ['accent-ink', 'accent'], ['bug', 'bg'], ['bug', 'bg-raise'], ['bug-ink', 'bug'], ['ok', 'bg'], ['ok', 'bg-raise']];

/** In-page: the contrast failures and the font families of every visible text node on the current screen. */
const SCAN = `(() => {
  const toRGBA = (c) => {
    let m = c.match(/^rgba?\\(([^)]+)\\)/);
    if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    m = c.match(/^color\\(srgb ([^)]+)\\)/);
    if (m) { const p = m[1].split(/[ \\/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }; }
    return null;
  };
  const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a); return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; };
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const path = (el) => { const out = []; for (let e = el; e && e !== document.body && out.length < 3; e = e.parentElement) out.push(e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : '')); return out.join('<'); };
  const fails = []; const fonts = []; let checked = 0; let skipped = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest('script,style,svg,[hidden],[inert]')) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity); if (op < 0.99) { skipped++; continue; }
    fonts.push({ where: path(el), family: cs.fontFamily, text: n.nodeValue.trim().slice(0, 24) });
    const fg = toRGBA(cs.color);
    const layers = []; let opaque = false; let unknown = false;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== 'none') { unknown = true; break; }
      const b = toRGBA(s.backgroundColor);
      if (b && b.a > 0) { layers.push(b); if (b.a >= 0.99) { opaque = true; break; } }
    }
    if (unknown || !fg) { skipped++; continue; }
    let bg = opaque ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 };
    while (layers.length) bg = over(layers.pop(), bg);
    const eff = fg.a < 1 ? over(fg, bg) : fg;
    const hi = Math.max(lum(eff), lum(bg)); const lo = Math.min(lum(eff), lum(bg));
    const ratio = (hi + 0.05) / (lo + 0.05);
    const px = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
    checked++;
    if (ratio < need) fails.push({ where: path(el), ratio: Math.round(ratio * 100) / 100, need, text: n.nodeValue.trim().slice(0, 30), fg: cs.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')' });
  }
  return { fails, fonts, checked, skipped };
})()`;

const g = await startGame();
const browser = await launch();
let code = 0;
try {
  /* ---- token pairs, both themes -------------------------------------------------------------------------------------- */
  const css = fs.readFileSync(path.join(GAME, 'game.css'), 'utf8');
  ok(!/cairo/i.test(css) && !/cairo/i.test(fs.readFileSync(path.join(GAME, 'shop.css'), 'utf8')) && !/cairo/i.test(fs.readFileSync(path.join(GAME, 'index.html'), 'utf8')), 'Cairo appears nowhere in game.css, shop.css or index.html');
  for (const theme of ['dark', 'light']) {
    const o = await openGame(browser, g, { theme });
    const got = await o.page.evaluate((names) => {
      const probe = document.createElement('span');
      document.body.append(probe);
      const out = {};
      for (const n of names) {
        probe.style.color = ''; probe.style.color = `var(--${n})`;
        const c = getComputedStyle(probe).color;
        const m = c.match(/^rgba?\(([^)]+)\)/) || c.match(/^color\(srgb ([^)]+)\)/);
        const p = m ? m[1].split(/[ ,/]+/).filter(Boolean).map(Number) : null;
        out[n] = p ? (c.startsWith('color(') ? { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255 } : { r: p[0], g: p[1], b: p[2] }) : null;
      }
      probe.remove();
      return { out, theme: document.documentElement.dataset.theme };
    }, [...new Set(PAIRS.flat())]);
    const absent = Object.entries(got.out).filter(([, v]) => !v).map(([k]) => `--${k}`);
    ok(absent.length === 0, `${theme}: every colour token exists (${[...new Set(PAIRS.flat())].length} custom properties)`, absent.join(', '));
    for (const [fg, bg] of PAIRS) {
      if (!got.out[fg] || !got.out[bg]) continue;
      const r = ratio(got.out[fg], got.out[bg]);
      ok(r >= 4.5, `${theme}: --${fg} on --${bg} is ${r.toFixed(2)}:1 (>= 4.5)`);
    }
    const bgA = got.out.bg;
    ok(!bgA || (theme === 'dark' ? lum(bgA) < 0.1 : lum(bgA) > 0.5), `${theme}: the page really uses the ${theme} palette`, JSON.stringify(bgA));
    await o.close();
  }

  /* ---- drawn text, every screen, both themes and languages ---------------------------------------------------------- */
  const allFonts = [];
  for (const lang of ['en', 'ar']) {
    for (const theme of ['dark', 'light']) {
      const o = await openGame(browser, g, { lang, theme });
      const tag = `${lang}/${theme}`;
      const scan = async (name) => {
        await o.page.waitForTimeout(750); // the scene fade-in finishes (<= 460 ms)
        const r = await o.page.evaluate(SCAN);
        ok(r.checked > 3, `${tag} ${name}: ${r.checked} text runs measured (${r.skipped} skipped)`);
        ok(r.fails.length === 0, `${tag} ${name}: every text run meets WCAG (${r.fails.length} below)`, r.fails.slice(0, 4).map((f) => `${f.where} "${f.text}" ${f.ratio}<${f.need} ${f.fg} on ${f.bg}`).join(' | '));
        allFonts.push(...r.fonts.map((f) => ({ ...f, tag, name })));
      };
      await scan('title');
      await openSettings(o.page); await scan('settings'); await closeSettings(o.page);
      await reach(o.page, 'card', 1); await scan('card');
      await reach(o.page, 'play', 1); await scan('play');
      await reach(o.page, 'clear', 1); await scan('clear');
      await reach(o.page, 'finale'); await scan('finale');
      ok(o.errors.length === 0, `${tag}: no page error while walking the screens`, o.errors.join(' | '));
      await o.close();
    }
  }

  /* ---- fonts: Thmanyah only ------------------------------------------------------------------------------------------ */
  nonEmpty(allFonts, 'text runs with a font-family');
  const GENERIC = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'inherit']);
  const families = (f) => f.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const bad = allFonts.filter((f) => { const fam = families(f.family); return !/^Thmanyah/.test(fam[0]) || fam.some((x) => !/^Thmanyah/.test(x) && !GENERIC.has(x.toLowerCase())); });
  ok(bad.length === 0, `every text run's font-family starts with Thmanyah and names no other typeface (${allFonts.length} runs, 4 language/theme combinations)`, [...new Set(bad.map((f) => f.family))].slice(0, 3).join(' | '));
  const used = new Set(allFonts.flatMap((f) => families(f.family)).filter((x) => /^Thmanyah/.test(x)));
  console.log(`  --  Thmanyah families in use: ${[...used].join(', ')}`);
  proveTeeth('the font-family check', (f) => (/^Thmanyah/.test(families(f)[0]) && !families(f).some((x) => /cairo/i.test(x)) ? [] : ['not Thmanyah']), 'Cairo, sans-serif');

  /* the Arabic heading really renders in the embedded face (fonts.css subsets: glyph coverage was [U] in the design) */
  const o = await openGame(browser, g, { lang: 'ar' });
  const fontsReport = await o.page.evaluate(async () => {
    const head = document.getElementById('titleName');
    const text = head ? head.textContent : 'صيد الأخطاء';
    const out = {};
    for (const face of ['Thmanyah Serif Display', 'Thmanyah Sans']) {
      for (const w of [400, 700]) {
        try { await document.fonts.load(`${w} 40px "${face}"`, text); } catch { /* reported below */ }
        out[`${face} ${w}`] = document.fonts.check(`${w} 40px "${face}"`, text);
      }
    }
    const c = document.createElement('canvas').getContext('2d');
    const width = (f) => { c.font = f; return c.measureText(text).width; };
    const fam = getComputedStyle(head || document.body).fontFamily;
    out.differsFromFallback = Math.abs(width(`700 40px ${fam}`) - width('700 40px monospace')) > 1;
    out.text = text;
    return out;
  });
  ok(/[؀-ۿ]/.test(fontsReport.text), 'the title heading in Arabic is Arabic script', fontsReport.text);
  ok(fontsReport['Thmanyah Serif Display 700'] === true && fontsReport['Thmanyah Serif Display 400'] === true, 'document.fonts.check: Thmanyah Serif Display (400, 700) covers the Arabic heading', JSON.stringify(fontsReport));
  ok(fontsReport['Thmanyah Sans 400'] === true && fontsReport['Thmanyah Sans 700'] === true, 'document.fonts.check: Thmanyah Sans (400, 700) covers the Arabic heading');
  ok(fontsReport.differsFromFallback, 'the Arabic heading is measurably set in Thmanyah, not in a fallback face');
  await o.close();
  const bundled = ['Thmanyah Sans', 'Thmanyah Serif Display'];
  const fontsCss = fs.readFileSync(path.join(GAME, '..', 'ui', 'fonts.css'), 'utf8');
  ok(bundled.every((f) => fontsCss.includes(f)), 'ui/fonts.css (served at /ui/fonts.css) carries Thmanyah Sans and Thmanyah Serif Display');
} catch (err) {
  ok(false, `run aborted: ${err.message}`, String(err.stack).split('\n').slice(1, 3).join(' | '));
  code = 1;
} finally {
  await browser.close();
  await g.close();
}
void code;
finish('test-game-contrast-fonts');
