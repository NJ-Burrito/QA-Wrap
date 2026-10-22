/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt teaches QA Wrap (owner amend, Nader 2026-10-12): every level names ONE real QA Wrap feature, can only be won by using
 * that feature, and the clear card and the finale list what was learned, in English and in Arabic.
 *
 *   node tools/test-game-features.mjs        (from extension/, PYTHONUTF8=1)
 *
 * The feature map is lane B's game/features.json (notes-game/B-features.md):
 *   features { id: { icon, source: { file: "platform/i18n" | "_locales", key }, en, ar } }, chips { id: { en, ar } },
 *   levels { "1".."5": { primary, with[], extras[], learn: { en, ar } } }.
 * A feature is REAL when its source key exists in the extension's own string table in both languages and the game shows that
 * very text. Until the map lands the suite exits 2.
 *   - node half: the real engine on stand-in levels refuses to clear a caught level until the feature's own signal arrives;
 *   - page half: a headless game, with the extension's signals simulated through the same data attributes the extension
 *     writes (dataset.qawState / qawNotes / qawShots), plays all five levels for real; each clear card and the finale name the
 *     learned features in the page language.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import { EXT, GAME, has, readJson, makeEngine } from './lib-game-engine.mjs';
import { startGame, launch, openGame, reach } from './lib-game.mjs';

/* ---- the map ------------------------------------------------------------------------------------------------------- */
const mapFile = path.join(GAME, 'features.json');
if (!fs.existsSync(mapFile)) {
  skipNotEnforced({ rule: 'game', what: 'one real QA Wrap feature per level, a clear that needs it, learned features listed', why: 'the feature map (game/features.json, notes-game/B-features.md; lane B) has not landed' });
  finish('test-game-features', { skipped: 1 });
}
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const FEATURES = map.features || {};
const LEVELS = map.levels || {};
const rows = nonEmpty(Object.keys(LEVELS).map(Number).sort(), 'feature map levels').map((n) => ({ n, ...LEVELS[n] }));
const nameOf = (id, lang) => FEATURES[id]?.[lang];
const stem = (t) => String(t || '').split('{')[0].trim(); // "Caught: {what}" is shown as "Caught:" on a card

/* ---- one real feature per level ----------------------------------------------------------------------------------- */
ok(rows.map((r) => r.n).join() === '1,2,3,4,5', 'the map has exactly one row for each of the five levels', rows.map((r) => r.n).join());
ok(rows.every((r) => typeof r.primary === 'string'), 'every level names ONE primary feature');
ok(new Set(rows.map((r) => r.primary)).size === rows.length, 'the five levels teach five different primary features', rows.map((r) => r.primary).join());
const tables = {
  'platform/i18n': { en: readJson(EXT, 'platform', 'i18n', 'en.json'), ar: readJson(EXT, 'platform', 'i18n', 'ar.json') },
  _locales: { en: readJson(EXT, '_locales', 'en', 'messages.json'), ar: readJson(EXT, '_locales', 'ar', 'messages.json') },
};
const catalogue = readJson(EXT, 'core', 'tool-catalogue.json');
const toolIds = new Set(catalogue.tools.map((t) => t.tool));
const valueOf = (file, key, lang) => { const v = tables[file]?.[lang]?.[key]; return typeof v === 'object' && v ? v.message : v; };
/** A feature is real when its source key exists in the extension's own string table (EN and AR) and the game shows that very text. */
function realProblems(id) {
  const f = FEATURES[id];
  if (!f) return [`no feature "${id}" in the map`];
  const bad = [];
  if (!f.source || !tables[f.source.file]) { bad.push(`source file ${f.source?.file} is not platform/i18n or _locales`); return bad; }
  for (const lang of ['en', 'ar']) {
    const v = valueOf(f.source.file, f.source.key, lang);
    if (typeof v !== 'string' || v === '') bad.push(`${f.source.file}:${f.source.key} has no ${lang} text in the extension`);
    else if (v !== f[lang]) bad.push(`${lang} name "${f[lang]}" differs from the extension's own "${v}"`);
  }
  return bad;
}
const everyId = new Set([...Object.keys(FEATURES), ...rows.flatMap((r) => [r.primary, ...(r.with || []), ...(r.extras || [])])]);
for (const id of everyId) {
  const bad = realProblems(id);
  ok(bad.length === 0, `feature "${id}" is a real QA Wrap feature, named exactly as the extension names it (EN and AR)`, bad.join(' | '));
}
for (const r of rows) {
  ok(['wake', 'recorder', 'note', 'shot', 'stop'].includes(r.primary) || realProblems(r.primary).length === 0, `L${r.n} teaches "${r.primary}" (${nameOf(r.primary, 'en')})`);
  if (toolIds.has(r.primary)) ok(true, `L${r.n}: "${r.primary}" is also a tool in core/tool-catalogue.json (${catalogue.tools.find((t) => t.tool === r.primary).label})`);
  ok(typeof r.learn?.en === 'string' && r.learn.en.trim() !== '' && typeof r.learn?.ar === 'string' && /[\u0600-\u06FF]/.test(r.learn.ar), `L${r.n}: the learned sentence exists in English and in Arabic script`, `${r.learn?.en} | ${r.learn?.ar}`);
  ok(String(r.learn?.en || '').trim().split(/\s+/).length <= 25, `L${r.n}: the English learned sentence is at most 25 words`);
  for (const id of [...(r.with || []), ...(r.extras || [])]) ok(id in FEATURES && id !== r.primary, `L${r.n}: "${id}" (with/extras) is a mapped feature other than the primary`);
}
for (const [id, c] of Object.entries(map.chips || {})) {
  ok(id in FEATURES && c.en?.trim() && /[\u0600-\u06FF]/.test(c.ar || ''), `chip "${id}": a mapped feature with EN and Arabic-script text`);
}
proveTeeth('the real-feature check', (id) => realProblems(id), 'teleport');
proveTeeth('the same-name check', (f) => { const keep = FEATURES.wake.en; FEATURES.wake.en = f; const r = realProblems('wake'); FEATURES.wake.en = keep; return r; }, 'Wake it up');

/* ---- the engine refuses a clear without the feature's signal ------------------------------------------------------- */
{
  const SIGNAL = {
    1: (E) => { E.L.flags[1].prove = true; E.clk.advance(600); },
    // level 2: the harmless failure ("Refresh offers") first, then the chip "Not a bug" (id notbug; it was console)
    2: (E) => { E.L.flags[2].signal = false; E.L.ctxs[2].emit({ type: 'noise' }); E.engine.claimProve('notbug'); }, // signal=false: the extension shares no qawExpected, so the self-report chip applies
    3: (E) => { E.L.flags[3].prove = true; E.clk.advance(600); },
    4: (E) => { E.L.flags[4].prove = true; E.clk.advance(600); },
    5: (E) => { E.L.flags[5].prove = true; E.clk.advance(600); },
  };
  for (const r of rows) {
    const E = await makeEngine();
    await E.at(r.n);
    E.clk.advance(5000);
    E.L.ctxs[r.n].emit({ type: 'catch' });
    E.clk.advance(30_000);
    ok(E.ev('level:clear').filter((c) => c.n === r.n).length === 0 && E.engine.status === 'play', `L${r.n}: a caught level does NOT clear by itself without the "${r.primary}" signal (no clear of this level after 30 s)`, `status=${E.engine.status} clears of L${r.n}=${E.ev('level:clear').filter((c) => c.n === r.n).length} (earlier levels were skipped by at())`);
    SIGNAL[r.n](E);
    E.clk.advance(10_000);
    const clear = E.ev('level:clear').filter((c) => c.n === r.n).at(-1);
    ok(!!clear && clear.caught && clear.proved, `L${r.n}: with the "${r.primary}" signal the level clears, caught and proved`, JSON.stringify(clear && { caught: clear.caught, proved: clear.proved }));
    ok(!clear || clear.stars >= 2, `L${r.n}: a clear that used the feature is worth at least 2 stars`, String(clear && clear.stars));
  }
  const E = await makeEngine();
  await E.at(1);
  E.clk.advance(1000);
  ok(E.engine.finish() === false, 'finish before the catch is refused (Skip is the exit)');
  E.clk.advance(1000); E.L.ctxs[1].emit({ type: 'catch' });
  ok(E.engine.finish() === true && E.ev('level:clear').at(-1).proved === false, 'finish after the catch clears the level without the feature (Nader, 15 Oct 2026): unproved, 1 star');
  proveTeeth('the refusal check', (done) => (done === false ? ['refused'] : []), false);
}

/* ---- the page: the learned features on the clear card and the finale ----------------------------------------------- */
const need = ['index.html', 'game.js', 'server.mjs'].filter((f) => !has(f));
if (need.length) {
  skipNotEnforced({ rule: 'game', what: 'learned features on the clear card and finale', why: `game/${need.join(', game/')} have not landed` });
  finish('test-game-features', { skipped: 1 });
}
const g = await startGame();
const browser = await launch();
try {
  for (const lang of ['en', 'ar']) {
    const o = await openGame(browser, g, { lang });
    const { page } = o;
    const signal = (attrs, state) => page.evaluate(([a, s]) => {
      const d = document.documentElement.dataset;
      Object.assign(d, a);
      if (s) d.qawState = s;
      document.dispatchEvent(new CustomEvent('qaw:state', { detail: s || d.qawState }));
    }, [attrs, state]);
    const clearOpen = () => page.waitForSelector('#ov-clear:not([hidden])', { timeout: 14000 });
    await signal({ qawNotes: '0', qawShots: '0' }, 'ready');
    const clearTexts = [];
    const learnedNow = [];
    for (const r of rows) {
      await reach(page, 'play', r.n);
      await signal({}, 'ready');
      if (r.n === 1) await page.click('#save');
      if (r.n === 2) {
        await page.click('#apply');
        await page.click('#refresh'); // the harmless 404: the chip stays disabled until it happened
        const tChip = Date.now();
        const chipOn = await page.waitForSelector('#chipProve:not([disabled])', { state: 'visible', timeout: 10000 }).then(() => true, () => false);
        const lag = Date.now() - tChip;
        ok(chipOn && lag <= 2000, `${lang}: within 2 s of "Refresh offers" the "Not a bug" chip is enabled (took ${chipOn ? lag : '>10000'} ms)`, 'game.js onNoise only shows the note; the proof row is re-rendered by something else, late');
        if (chipOn) await page.click('#chipProve', { timeout: 3000 });
        else { await signal({ qawExpected: '0' }); await page.waitForTimeout(800); await signal({ qawExpected: '1' }); } // the documented signal route (lane D: qawExpected rises after the Refresh)
      }
      if (r.n === 3) { await page.click('#next'); await page.waitForTimeout(1700); await signal({ qawNotes: '1' }); }
      if (r.n === 4) { await page.click('#ref'); await page.waitForTimeout(400); await signal({ qawShots: '1' }); }
      if (r.n === 5) {
        await page.click('#pay');
        await page.waitForFunction(() => /./.test(document.getElementById('btnPrimaryTxt').textContent), null, { timeout: 8000 });
        await page.waitForTimeout(4500);
        await signal({}, 'recording'); await page.waitForTimeout(700); await signal({}, 'stopped');
      }
      await clearOpen();
      const text = await page.evaluate(() => document.getElementById('dlgClear').innerText);
      clearTexts.push(text);
      const label = stem(nameOf(r.primary, lang));
      learnedNow.push(label);
      ok(text.includes(label), `${lang}: the level ${r.n} clear card names the learned feature "${label}"`, text.replace(/\s+/g, ' ').slice(0, 160));
      ok(text.includes(r.learn[lang]), `${lang}: the level ${r.n} clear card carries the "use it at work" sentence`, text.replace(/\s+/g, ' ').slice(0, 160));
      if (r.n < 5) await page.click('#btnNext');
    }
    await page.click('#btnNext');
    await page.waitForSelector('#pasteBox', { state: 'visible', timeout: 8000 });
    await page.waitForTimeout(700);
    const fin = await page.evaluate(() => document.getElementById('screen-finale').innerText);
    const missingLabels = learnedNow.filter((l) => !fin.includes(l));
    ok(missingLabels.length === 0, `${lang}: the finale lists all ${learnedNow.length} learned features`, `missing: ${missingLabels.join(' | ')}`);
    // level 2's planted TypeError is raised as an error event, not thrown: no uncaught page error at all (and no Errors row on chrome://extensions)
    const real = o.errors;
    ok(real.length === 0, `${lang}: no uncaught page error in the full simulated play, level 2 included`, real.join(' | '));
    await o.close();
  }
  /* a skipped level teaches nothing: its feature is not listed as learned */
  const o = await openGame(browser, g, { lang: 'en' });
  for (let k = 1; k <= 5; k++) { await reach(o.page, 'clear', k); if (k < 5) await o.page.click('#btnNext'); }
  const clearText = await o.page.evaluate(() => document.getElementById('dlgClear').innerText);
  ok(!clearText.includes(rows[4].learn.en) || /try|later|not/i.test(clearText), 'a skipped level does not claim its feature as learned', clearText.replace(/\s+/g, ' ').slice(0, 120));
  await o.page.click('#btnNext');
  await o.page.waitForSelector('#pasteBox', { state: 'visible', timeout: 8000 });
  const fin2 = await o.page.evaluate(() => document.getElementById('screen-finale').innerText);
  ok(rows.every((r) => !fin2.includes(r.learn.en)), 'after skipping all five levels the finale lists no learned feature', fin2.replace(/\s+/g, ' ').slice(0, 160));
  await o.close();
} catch (err) {
  ok(false, `run aborted: ${err.message}`, String(err.stack).split('\n').slice(1, 3).join(' | '));
} finally {
  await browser.close();
  await g.close();
}
finish('test-game-features');
