/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt hard trials, the screens (DESIGN-bug-hunt-hard.md sections 3.3, 3.5, 3.9, 7, 9 and 11; Autopilot & ADHD rules 1, 7, 11;
 * lane T3). Headless Chromium on the game's own server (loopback port), Playwright's mocked clock, so a 55 s stage takes seconds.
 *
 *   node tools/test-game-trial-ui.mjs        (from extension/, PYTHONUTF8=1)
 *
 * English, Arabic (RTL) and Calm + reduced motion, stage 6 end to end with the scripted player:
 *   - the entry link on the title is quiet (never [data-primary]); the card, attunement and clear dialog each carry exactly one primary;
 *     a timed room carries none (the allow-listed reason: no control may invite a click inside a timed window);
 *   - NO hint, voice, skip, chip, caption or needs node in a run, and no hint wording in the run's text;
 *   - both top corners (300 x 96) hold nothing during a run, LTR and RTL; every control is >= 44 px;
 *   - flash: no element changes more than 3 times in any second; Calm and reduced motion run zero animations and show the same tells
 *     at the same seconds;
 *   - the death cover paints within 150 ms, Deaths N counts up in neutral words, Rest appears on the 8th death and never blocks the
 *     restart, Still here appears on the 10th; Reset clears bughunt.trial.v1; Thmanyah only.
 * Skips with exit 2 while game/trial.js (T1) or game/trial-ui.js (T2) has not landed.
 */
import { ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import * as L from './lib-game-trial.mjs';
import * as B from './lib-game-trial-pw.mjs';

const SUITE = 'test-game-trial-ui';
L.needTrial(SUITE, ['trial-ui.js', 'trial.css']);

const STR = { en: L.loadStrings('en'), ar: L.loadStrings('ar') };
const tr = (lang, key, vars = {}) => String(STR[lang][key] ?? `[${key}]`).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? `{${k}}`));
const seenAt = {};

/* in-page probes (strings, run inside the page) */
const MUT = `(() => { if (window.__mutOn) return; window.__mutOn = true; const ids = new WeakMap(); let n = 0; window.__mut = [];
  const id = (x) => { if (!ids.has(x)) ids.set(x, ++n); return ids.get(x); };
  new MutationObserver((list) => { const t = performance.now(); for (const m of list) { const el = m.target.nodeType === 1 ? m.target : m.target.parentNode; if (el && el.nodeType === 1) window.__mut.push({ k: id(el) + ':' + (m.attributeName || m.type), t }); } })
    .observe(document.documentElement, { attributes: true, characterData: true, childList: true, subtree: true });
})();`;
const VISIBLE = `const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };`;
const probe = {
  primaries: (page) => page.evaluate(`(() => { ${VISIBLE} return { data: [...document.querySelectorAll('[data-primary]')].filter(vis).length, btn: [...document.querySelectorAll('.btn-primary')].filter(vis).length }; })()`),
  corners: (page) => page.evaluate(`(() => { ${VISIBLE} const W = innerWidth; const zones = [[0, 0, 300, 96], [W - 300, 0, W, 96]]; const hits = [];
    for (const el of document.querySelectorAll('body *')) { if (!vis(el)) continue; const r = el.getBoundingClientRect();
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim()); const ctl = /^(BUTTON|A|INPUT|TEXTAREA|SELECT|IMG|SVG|CANVAS)$/i.test(el.tagName) || el.getAttribute('role') === 'button';
      if (!own && !ctl) continue;
      for (const [l, t, rr, b] of zones) if (r.left < rr && r.right > l && r.top < b && r.bottom > t) hits.push(el.tagName + (el.id ? '#' + el.id : '') + ' "' + (el.textContent || '').trim().slice(0, 24) + '"'); }
    return hits; })()`),
  small: (page) => page.evaluate(`(() => { ${VISIBLE} return [...document.querySelectorAll('button, [role=button], a[href], input, textarea, select')].filter(vis).map((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), label: (el.textContent || el.id || el.tagName).trim().slice(0, 24) }; }).filter((x) => x.w < 44 || x.h < 44); })()`),
  helpers: (page) => page.evaluate(`(() => { ${VISIBLE} const sel = '[data-hint], .hint, #caption, [data-caption], [data-chip], .chip, [data-skip], [data-needs], .needs, audio, video, [data-voice]';
    const found = [...document.querySelectorAll(sel)].filter((el) => vis(el) || el.tagName === 'AUDIO' || el.tagName === 'VIDEO').map((el) => el.tagName + (el.id ? '#' + el.id : '') + '.' + el.className);
    const root = document.querySelector('[data-trial-run]') || document.querySelector('#trial-arena') || document.body;
    return { found, text: root.innerText || '', buttons: [...root.querySelectorAll('button, [role=button], a')].filter(vis).map((b) => (b.textContent || '').trim()) }; })()`),
  fonts: (page) => page.evaluate(`(() => { ${VISIBLE} const out = new Set(); for (const el of document.querySelectorAll('body *')) { if (!vis(el)) continue; if (![...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) continue; out.add(getComputedStyle(el).fontFamily); } return [...out]; })()`),
  anims: (page) => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length),
  tells: (page) => page.evaluate(() => [...document.querySelectorAll('.trial-tell[data-cls]')].map((e) => e.getAttribute('data-cls').toLowerCase()).concat(document.querySelector('#next[data-ring="1"]') ? ['ring'] : [])),
  cover: (page) => page.evaluate(`(() => { ${VISIBLE} const el = [...document.querySelectorAll('#trialCover, .trial-cover')].find(vis); if (!el) return null;
    const restBtn = [...document.querySelectorAll('#trialRestBtn')].find(vis);
    const cs = getComputedStyle(el); const m = /rgba?\\((\\d+), (\\d+), (\\d+)/.exec(cs.color) || []; const kids = [...el.querySelectorAll('*')].map((k) => getComputedStyle(k).color);
    return { text: el.innerText, buttons: [...el.querySelectorAll('button, [role=button]')].map((b) => (b.textContent || '').trim()).concat(restBtn ? [(restBtn.textContent || '').trim()] : []), colors: [cs.color, ...kids] }; })()`),
  dialog: (page) => page.evaluate(`(() => { ${VISIBLE} const d = [...document.querySelectorAll('#trialClearDlg')].find(vis); if (!d) return null;
    return { text: d.innerText, role: d.getAttribute('role') || d.tagName, focusIn: d.contains(document.activeElement), canvas: d.querySelectorAll('canvas, .confetti').length }; })()`),
};
const isRed = (css) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css); return !!m && +m[1] > 170 && +m[2] < 90 && +m[3] < 90; };
const linkOf = (page) => page.locator('[data-trial-link]:visible').first();

const g = await B.startGame();
const browser = await B.launch();
let skipped = 0;
try {
  for (const [lang, calm, motion] of [['en', false, 'no-preference'], ['ar', false, 'no-preference'], ['en', true, 'reduce']]) {
    const tag = `${lang.toUpperCase()}${calm ? ' Calm + reduced motion' : ''}`;
    const P = await B.trialPage(browser, g, { lang, calm, reducedMotion: motion, seed: B.seedFor({ lang, calm }) });
    const { page } = P;
    await page.evaluate(MUT);

    /* -- title: the entry is quiet ------------------------------------------------------------------------------------- */
    const link = linkOf(page);
    ok(await link.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false), `${tag}: the title shows the entry "${tr(lang, 'trial.link')}" for a profile that cleared levels 1-5`);
    const quiet = await link.evaluate((el) => !el.closest('[data-primary]') && !el.hasAttribute('data-primary') && !el.classList.contains('btn-primary'));
    ok(quiet, `${tag}: the entry link is never [data-primary] and never .btn-primary`);
    const titleCorners = await probe.corners(page);
    ok(titleCorners.length > 0, `${tag}: teeth: the corner probe finds the game's own title controls in the corners (so an empty result in a run means something)`, 'the title has nothing in its corners: the probe may be blind');
    const tp = await probe.primaries(page);
    ok(tp.data === 1 && tp.btn === 1, `${tag}: the title still has exactly one primary`, JSON.stringify(tp));
    ok(await page.evaluate(() => document.documentElement.dir === 'rtl' || document.documentElement.getAttribute('dir') === 'rtl' || document.body.dir === 'rtl') === (lang === 'ar'), `${tag}: the page direction is ${lang === 'ar' ? 'rtl' : 'ltr'}`);

    /* -- the card -------------------------------------------------------------------------------------------------------- */
    await link.click();
    await page.clock.runFor(300);
    const body = await page.evaluate(() => document.querySelector('#trialCard').textContent);
    for (const k of ['trial.card.rule', 'trial.card.fail', 'trial.card.nohelp']) ok(body.includes(tr(lang, k)), `${tag}: the card says "${tr(lang, k)}"`);
    ok(body.includes(tr(lang, 'trial.card.kicker', { n: 6 })) && body.includes(tr(lang, 'trial.name.6')), `${tag}: the card is hard trial 6, ${tr(lang, 'trial.name.6')}`);
    const cp = await probe.primaries(page);
    ok(cp.data === 1 && cp.btn === 1, `${tag}: the card has exactly one visible [data-primary] and one .btn-primary (Begin)`, JSON.stringify(cp));
    const cardSmall = await probe.small(page);
    ok(cardSmall.length === 0, `${tag}: every card control is at least 44 px`, JSON.stringify(cardSmall.slice(0, 3)));
    ok(await page.evaluate(() => /Deaths\s*0|مرات السقوط\s*0/.test(document.body.innerText)), `${tag}: the card shows the death counter "${tr(lang, 'trial.deaths', { n: 0 })}"`);

    /* -- begin, run, clear ------------------------------------------------------------------------------------------------ */
    await page.click('#trialBegin');
    const checks = { run: false, anim: [] };
    let lastCls = '';
    const { sec } = await B.drive(page, L.PERFECT[6], {
      untilSec: 56, stepMs: 50,
      onStep: async (s) => {
        const cls = (await probe.tells(page)).join(',');
        if (cls !== lastCls) { for (const c of cls.split(',').filter(Boolean)) if (!(`${tag}|${c}|${Math.floor(s / 10)}` in seenAt)) seenAt[`${tag}|${c}|${Math.floor(s / 10)}`] = s; lastCls = cls; }
        if (!checks.run && s >= 10) {
          checks.run = true;
          const pr = await probe.primaries(page);
          ok(pr.data === 0 && pr.btn === 0, `${tag}: a timed room carries no [data-primary] and no .btn-primary (allow-listed: no control may invite a click inside a timed window)`, JSON.stringify(pr));
          const cor = await probe.corners(page);
          ok(cor.length === 0, `${tag}: both top corners (300 x 96) are empty during a run`, cor.slice(0, 4).join(' | '));
          const sm = await probe.small(page);
          ok(sm.length === 0, `${tag}: every control in a run is at least 44 x 44 px`, JSON.stringify(sm.slice(0, 3)));
          const h = await probe.helpers(page);
          ok(h.found.length === 0, `${tag}: no hint, caption, chip, skip, needs, voice, audio or video node in a run`, h.found.join(' | '));
          ok(!h.buttons.some((b) => /skip|finish|hint|تخطّ|تخطي|تلميح|إنهاء/i.test(b)), `${tag}: no Skip / Finish / Hint button in a run`, h.buttons.join(' | '));
          const tx = h.text;
          ok(!L.HINT_WORDS_EN.test(tx), `${tag}: the run's visible words carry no hint wording (EN list)`, tx.slice(0, 160));
          ok(!L.HINT_WORDS_AR.test(tx), `${tag}: the run's visible words carry no hint wording (AR list)`, tx.slice(0, 160));
          const fam = await probe.fonts(page);
          ok(nonEmpty(fam, 'font families in the run') && fam.every((f) => /^"?Thmanyah/.test(f) && !/cairo/i.test(f)), `${tag}: Thmanyah only in a run`, fam.join(' | '));
          const ext = await page.evaluate(() => [...document.querySelectorAll('[href],[src]')].map((e) => e.getAttribute('href') || e.getAttribute('src')).filter((u) => /^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(u || '')));
          ok(ext.length === 0, `${tag}: no external link or source in the page`, ext.join(' | '));
        }
        if (calm && (s >= 3.5 && s < 3.6 || s >= 14 && s < 14.1 || s >= 23 && s < 23.1 || s >= 41 && s < 41.1)) checks.anim.push(await probe.anims(page));
      },
    });
    ok(checks.run, `${tag}: the run reached 10 s of stage time with the scripted player`, `${sec} s`);
    if (calm) ok(checks.anim.length >= 4 && checks.anim.every((n) => n === 0), `${tag}: zero running animations during the run (tells are steady states)`, JSON.stringify(checks.anim));
    await page.clock.runFor(1500);
    const dlg = await probe.dialog(page);
    ok(!!dlg, `${tag}: the clear dialog is open after the Stop is seen`);
    if (dlg) {
      ok(dlg.text.includes(tr(lang, 'trial.clear.6')), `${tag}: it says "${tr(lang, 'trial.clear.6')}"`, dlg.text.slice(0, 100));
      ok(/1[,.،٬]?500|١[,.،٬]?٥٠٠/.test(dlg.text), `${tag}: it shows the score 1,500`, dlg.text.slice(0, 120));
      ok(dlg.text.includes(tr(lang, 'clear.fun')), `${tag}: it says "${tr(lang, 'clear.fun')}"`, dlg.text.slice(0, 160));
      ok(dlg.text.includes(tr(lang, 'trial.clear.line', { n: 0 })), `${tag}: it shows ${tr(lang, 'trial.clear.line', { n: 0 })}`, dlg.text.slice(0, 120));
      ok(dlg.canvas === 0, `${tag}: no confetti on a clear (static badge)`);
      ok(dlg.focusIn, `${tag}: focus is inside the clear dialog (focus-trapped)`);
      const dp = await probe.primaries(page);
      ok(dp.data === 1 && dp.btn === 1, `${tag}: the clear dialog has exactly one primary (Next trial)`, JSON.stringify(dp));
      await page.keyboard.press('Escape');
      await page.clock.runFor(200);
      ok(!!(await probe.dialog(page)), `${tag}: Esc is harmless on the clear dialog`);
    }
    /* flash: no element changes more than 3 times in any second */
    const muts = await page.evaluate(() => window.__mut);
    const byKey = new Map();
    // one state change = every record an element got at the same instant (replaceChildren + append is one repaint, not two)
    for (const m of muts) { const el = m.k.split(':')[0]; if (!byKey.has(el)) byKey.set(el, new Set()); byKey.get(el).add(m.t); }
    for (const [k, v] of byKey) byKey.set(k, [...v]);
    let worst = 0; let worstKey = '';
    for (const [k, ts] of byKey) { const r = L.maxRate(ts, 1000); if (r > worst) { worst = r; worstKey = k; } }
    nonEmpty([...byKey.keys()], 'observed mutations');
    ok(worst <= 3, `${tag}: no element changes state more than 3 times in any second over a full stage (worst ${worst} on ${worstKey})`);
    ok(P.errors.length === 0, `${tag}: no page error`, P.errors.join(' | '));
    ok(!P.reqs.some((r) => /\/audio\//.test(r.url) && /trial/i.test(r.url)), `${tag}: no new audio file is requested by a trial run`);
    await P.close();
  }
  proveTeeth('the flash rate counter', (ts) => (L.maxRate(ts, 1000) <= 3 ? [] : ['over']), [0, 100, 200, 300, 400]);
  proveTeeth('the red check', (c) => (isRed(c) ? ['red'] : []), 'rgb(220, 30, 30)');

  /* Calm: the same tells at the same seconds (rounded to the tenth of the first tell of each class) */
  for (const cls of ['line', 'underline', 'ring']) {
    const a = Object.entries(seenAt).filter(([k]) => k.startsWith('EN|') && k.split('|')[1] === cls).map(([, v]) => v).sort((x, y) => x - y)[0];
    const b = Object.entries(seenAt).filter(([k]) => k.startsWith('EN Calm') && k.split('|')[1] === cls).map(([, v]) => v).sort((x, y) => x - y)[0];
    ok(a !== undefined && b !== undefined && Math.abs(a - b) <= 0.15, `Calm: the ${cls} tell appears at the same second as in normal mode (${a} s vs ${b} s)`);
  }

  /* -- deaths: the cover, the counter, Rest, Still here --------------------------------------------------------------------- */
  for (const lang of ['en', 'ar']) {
    const tag = lang.toUpperCase();
    const P = await B.trialPage(browser, g, { lang, seed: B.seedFor({ lang, deaths: 6 }) });
    const { page } = P;
    await linkOf(page).click(); await page.clock.runFor(300);
    await page.click('#trialBegin');
    for (const k of [7, 8, 9, 10]) {
      let snap = null; let firstSeen = null;
      await B.drive(page, [{ id: 'stop', at: 1.0, kind: 'stop' }], {
        untilSec: 3, stepMs: 25,
        onStep: async (s) => { if (s > 1.1 && !snap) { const c = await probe.cover(page).catch(() => null); if (c) { snap = c; firstSeen = s; return 'stop'; } } return null; },
      });
      ok(!!snap, `${tag}: death ${k}: the cover paints`);
      if (snap) {
        ok(firstSeen <= 1.45, `${tag}: death ${k}: the cover is up within 150 ms of the death (first seen ${firstSeen} s, death at about 1.15 s)`);
        ok(snap.text.includes(tr(lang, 'trial.death.again')), `${tag}: death ${k}: it says "${tr(lang, 'trial.death.again')}"`, snap.text);
        ok(snap.text.includes(String(k)) && /Deaths|مرات السقوط/.test(snap.text), `${tag}: death ${k}: it shows "${tr(lang, 'trial.deaths', { n: k })}"`, snap.text.replace(/\s+/g, ' '));
        ok(!snap.colors.some(isRed) && !/\b(died|failed|game over)\b/i.test(snap.text), `${tag}: death ${k}: neutral words and neutral ink (no red, no "you died")`, snap.colors.join(' | '));
        const still = snap.text.includes(tr(lang, 'trial.badge.stillhere'));
        ok(still === (k === 10), `${tag}: death ${k}: "${tr(lang, 'trial.badge.stillhere')}" is ${k === 10 ? 'shown (10th death)' : 'not shown'}`, snap.text.replace(/\s+/g, ' '));
      }
      let restSeen = !!snap && snap.buttons.some((b) => b.includes(tr(lang, 'trial.death.restbtn')));
      const restNow = () => page.evaluate(() => { const b = document.querySelector('#trialRestBtn'); if (!b) return false; const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !b.closest('[hidden]'); }).catch(() => false);
      const gone = await B.stepUntil(page, async () => { restSeen = restSeen || await restNow(); return !(await probe.cover(page).catch(() => 1)); }, 4000, 50);
      ok(gone, `${tag}: death ${k}: the cover lifts by itself and the stage runs again (Rest never blocks the restart)`);
      await B.stepUntil(page, async () => { restSeen = restSeen || await restNow(); return false; }, 1200, 50);
      ok(restSeen === (k === 8), `${tag}: death ${k}: Rest is ${k === 8 ? 'offered (every 8th death)' : 'not offered'}`);
    }
    ok(P.errors.length === 0, `${tag}: no page error across the deaths`, P.errors.join(' | '));
    await P.close();
  }

  /* -- Reset progress clears the trial storage as well ------------------------------------------------------------------------ */
  {
    const P = await B.trialPage(browser, g, { lang: 'en', seed: B.seedFor({ lang: 'en', deaths: 3, badges: { stillhere: true } }) });
    const { page } = P;
    ok(await page.evaluate((k) => localStorage.getItem(k) !== null, B.TRIAL_KEY), 'Reset: bughunt.trial.v1 exists before');
    page.on('dialog', (d) => d.accept());
    await page.click('#btnSettings'); await page.clock.runFor(300);
    await page.click('#btnReset'); await page.clock.runFor(300);
    ok(await page.evaluate((k) => { const v = localStorage.getItem(k); return v === null || !/"deaths":[1-9]|stillhere/.test(v); }, B.TRIAL_KEY), 'Reset progress also clears bughunt.trial.v1 (deaths, badges, clears)');
    await P.close();
  }
} finally {
  await browser.close().catch(() => {});
  await g.close().catch(() => {});
}
finish(SUITE, { skipped });
void skipNotEnforced;
