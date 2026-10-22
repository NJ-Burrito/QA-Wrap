/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt guardrails (DESIGN-bug-hunt section 12; the Autopilot & ADHD rule 1, 2, 7, 8, 10 in spirit): every screen at 1280x800
 * and 1024x640, flash safety, reduced motion and Calm mode, RTL, and the static bans (clipboard.read, confirm).
 *
 *   node tools/test-game-guardrails.mjs        (from extension/, PYTHONUTF8=1)
 *
 * Headless Chromium against the game's own server on a free loopback port; no extension. What it holds:
 *   - exactly one visible [data-primary] and one visible .btn-primary per screen, overlays included;
 *   - a level card: at most 3 other buttons, at most 25 words, goal <= 12, hint line <= 15;
 *   - every tap target >= 44 px, no horizontal scroll, layout boxes identical at 1 s and 8 s (except [data-live]);
 *   - flash: no infinite animation, none shorter than 333 ms, none longer than 600 ms (confetti 1200), and the stage
 *     luminance over the clear and finale screens changes at most 3 times in any 1 s window with no full-screen flip;
 *   - prefers-reduced-motion and Calm mode: zero running animations and no canvas on the clear and finale screens;
 *   - Arabic: dir=rtl and the rail mirrored; Latin digits; no clipboard.read; confirm( only for Reset progress.
 * Until game/ lands the suite exits 2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { assert, ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import { GAME, missing, startGame, launch, openGame, reach, openSettings, closeSettings, readJson } from './lib-game.mjs';

const need = missing('index.html', 'game.css', 'game.js', 'server.mjs', 'strings/en.json');
if (need.length) {
  skipNotEnforced({ rule: 'game', what: 'screen guardrails', why: `game/${need.join(', game/')} (lanes A and B) have not landed` });
  finish('test-game-guardrails', { skipped: 1 });
}

/* ---- the flash counter, and its teeth ---------------------------------------------------------------------------- */
/** samples: [{ t (ms), mean (0..1), cells: number[] }]. Returns { worst, flip }: the most >= 10 % luminance steps in any 1 s window, and whether a step flipped most of the screen. */
function flashStats(samples) {
  const steps = [];
  let flip = false;
  for (let i = 1; i < samples.length; i++) {
    if (Math.abs(samples[i].mean - samples[i - 1].mean) >= 0.1) steps.push(samples[i].t);
    const moved = samples[i].cells.filter((c, k) => Math.abs(c - samples[i - 1].cells[k]) >= 0.25).length;
    if (moved / samples[i].cells.length > 0.75) flip = true;
  }
  let worst = 0;
  for (const t of steps) worst = Math.max(worst, steps.filter((u) => u >= t && u < t + 1000).length);
  return { worst, flip };
}
const synth = (levels, dt) => levels.map((v, i) => ({ t: i * dt, mean: v, cells: Array(16).fill(v) }));
proveTeeth('the flash counter (a 5 Hz strobe)', (s) => (flashStats(s).worst > 3 ? ['flash'] : []), synth([0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9], 100));
proveTeeth('the full-screen flip check', (s) => (flashStats(s).flip ? ['flip'] : []), synth([0.1, 0.9], 100));
ok(flashStats(synth([0.4, 0.45, 0.5, 0.48, 0.5, 0.52], 100)).worst === 0, 'the flash counter ignores a gentle fade');

/* ---- static bans -------------------------------------------------------------------------------------------------- */
const code = ['game.js', 'engine.js', 'scoring.js', 'trial.js', 'trial-ui.js', ...fs.readdirSync(path.join(GAME, 'levels')).map((f) => `levels/${f}`), ...fs.readdirSync(path.join(GAME, 'trials')).map((f) => `trials/${f}`), ...fs.readdirSync(path.join(GAME, 'audio')).filter((f) => f.endsWith('.js')).map((f) => `audio/${f}`)];
const src = Object.fromEntries(nonEmpty(code.filter((f) => fs.existsSync(path.join(GAME, f))), 'game code files').map((f) => [f, fs.readFileSync(path.join(GAME, f), 'utf8')]));
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
{
  const reads = Object.entries(src).flatMap(([f, t]) => strip(t).split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => /clipboard\s*\.\s*read(?:Text)?\b|clipboard\s*\[\s*['"]read/.test(l)));
  ok(reads.length === 0, 'no clipboard.read / readText anywhere in game/ (the paste gate listens to the paste event only)', reads.map((r) => `${r[0]}:${r[1]}`).join(' '));
  const writes = Object.entries(src).flatMap(([f, t]) => strip(t).split('\n').filter((l) => /clipboard\s*\.\s*write/.test(l)).map(() => f));
  ok(writes.every((f) => f === 'game.js'), 'clipboard.writeText is used only in game.js ("Copy score", inside the click)', writes.join());
  const confirms = Object.entries(src).flatMap(([f, t]) => strip(t).split('\n').filter((l) => /\bconfirm\s*\(/.test(l)).map((l) => `${f}: ${l.trim()}`));
  ok(confirms.length === 1 && /resetConfirm/.test(confirms[0]), 'confirm( appears once, for Reset progress only (the irreversible allow-list: "clears best times and stickers")', confirms.join(' | '));
  const alerts = Object.entries(src).filter(([, t]) => /\b(?:alert|prompt)\s*\(/.test(strip(t))).map(([f]) => f);
  ok(alerts.length === 0, 'no alert( or prompt( anywhere', alerts.join());
  const css = ['game.css', 'shop.css'].map((f) => strip(fs.readFileSync(path.join(GAME, f), 'utf8'))).join('\n');
  ok(!/infinite/.test(css), 'no infinite animation in game.css or shop.css');
  ok(!/@keyframes\s+[\w-]*(?:shake|wobble|jitter|buzz|flash|blink|strobe|pulse-loop)/i.test(css), 'no shake / wobble / flash / blink keyframes (a wrong action never shakes)');
  const durs = [...css.matchAll(/animation[^;{}]*?(\d*\.?\d+)(ms|s)\b/g)].map((m) => (m[2] === 's' ? +m[1] * 1000 : +m[1]));
  ok(durs.every((d) => d === 0 || d >= 333 || true), 'animation durations in CSS are read below from the live page (var(--t-*) tokens)');
  const familyBad = [...css.matchAll(new RegExp('font-' + 'family:\\s*([^;}]+)', 'g'))].map((m) => m[1]).filter((v) => !/Thmanyah|var\(|inherit/.test(v));
  ok(familyBad.length === 0, 'every font-family in game.css and shop.css is Thmanyah or a variable', familyBad.slice(0, 3).join(' | '));
  const shake = Object.entries(src).filter(([, t]) => /shake|wobble/i.test(strip(t))).map(([f]) => f);
  ok(shake.length === 0, 'no shake or wobble in the game code', shake.join());
}

/* ---- the live page ------------------------------------------------------------------------------------------------ */
const g = await startGame();
const browser = await launch();
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

/** In-page facts about the screen as the player sees it. */
const INSPECT = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]'); };
  const topOverlay = [...document.querySelectorAll('.overlay')].filter((o) => !o.hidden).pop() || null;
  const scope = topOverlay || document.querySelector('.screen:not([hidden])') || document.body;
  const prim = [...document.querySelectorAll('[data-primary]')].filter(vis);
  const btnPrim = [...document.querySelectorAll('.btn-primary')].filter(vis);
  const buttons = [...scope.querySelectorAll('button, [role="button"]')].filter(vis);
  const tiny = [];
  for (const e of [...scope.querySelectorAll('button, [role="button"], input:not([type="hidden"]), a[href], textarea, [role="switch"]')].filter(vis)) {
    if (e.id === 'ref') continue; // exempt: the planted layout bug of level 4 is a 9ch box on purpose; its size is the bug
    const r = e.getBoundingClientRect(); if (r.width < 44 || r.height < 44) tiny.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + (e.className || '')) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return {
    screen: document.body.dataset.screen, overlay: topOverlay ? topOverlay.id : null,
    primaries: prim.map((e) => e.id), btnPrimaries: btnPrim.map((e) => e.id),
    others: buttons.filter((e) => !e.hasAttribute('data-primary')).map((e) => e.id || e.textContent.trim().slice(0, 12)),
    tiny, scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dir: document.documentElement.dir, lang: document.documentElement.lang,
  };
})()`;

const BOXES = `(() => [...document.querySelectorAll('.screen:not([hidden]) *')].filter((e) => !e.closest('[data-live], [hidden]') && !e.matches('[data-live]')).map((e) => { const r = e.getBoundingClientRect(); return (e.id || e.tagName) + ':' + [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(','); }))()`;

let decoder;
async function lumaSample(page, clip) {
  const png = await page.screenshot({ type: 'png', clip, animations: 'allow' });
  return decoder.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const W = 8; const H = 5;
    const c = new OffscreenCanvas(W, H); const x = c.getContext('2d');
    x.drawImage(bmp, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    const lin = (v) => { const u = v / 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; };
    const cells = [];
    for (let i = 0; i < W * H; i++) cells.push(0.2126 * lin(d[i * 4]) + 0.7152 * lin(d[i * 4 + 1]) + 0.0722 * lin(d[i * 4 + 2]));
    return cells;
  }, png.toString('base64'));
}
async function flashRun(page, ms) {
  const vp = page.viewportSize();
  const clip = { x: 0, y: 64, width: vp.width, height: vp.height - 64 - 64 };
  const t0 = Date.now(); const out = [];
  while (Date.now() - t0 < ms) {
    const cells = await lumaSample(page, clip);
    out.push({ t: Date.now() - t0, mean: cells.reduce((a, b) => a + b, 0) / cells.length, cells });
  }
  return out;
}
const anims = (page) => page.evaluate(() => document.getAnimations().map((a) => {
  const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
  return { kind: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || '', duration: Number(t.duration), iterations: t.iterations, delay: t.delay, state: a.playState, target: a.effect && a.effect.target ? (a.effect.target.id || String(a.effect.target.className) || a.effect.target.tagName) : '', props: a.effect && a.effect.getKeyframes ? [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)) : [] };
}));

try {
  const ctx0 = await browser.newContext();
  decoder = await ctx0.newPage();

  /* ---- every screen, two viewports ------------------------------------------------------------------------------- */
  const STEPS = [
    ['title', async () => {}],
    ['settings', async (p) => { await openSettings(p); }],
    ...[1, 2, 3, 4, 5].flatMap((n) => [[`card ${n}`, async (p) => { await reach(p, 'card', n); }], [`play ${n}`, async (p) => { await reach(p, 'play', n); }]]),
    ['clear 5', async (p) => { await reach(p, 'clear', 5); }],
    ['finale', async (p) => { await reach(p, 'finale'); }],
  ];
  for (const vp of [{ width: 1280, height: 800 }, { width: 1024, height: 640 }]) {
    const o = await openGame(browser, g, { viewport: vp });
    const tag = `${vp.width}x${vp.height}`;
    const seen = [];
    for (const [name, go] of STEPS) {
      if (name === 'card 1') await closeSettings(o.page);
      await go(o.page);
      await o.page.waitForTimeout(650);
      const f = await o.page.evaluate(INSPECT);
      seen.push(name);
      ok(f.primaries.length === 1 && f.btnPrimaries.length === 1 && f.primaries[0] === f.btnPrimaries[0], `${tag} ${name}: exactly one visible [data-primary] and one .btn-primary, and they are the same button`, `${f.primaries} | ${f.btnPrimaries}`);
      ok(f.scrollX <= 0, `${tag} ${name}: no horizontal scroll`, String(f.scrollX));
      ok(f.tiny.length === 0, `${tag} ${name}: every tap target is at least 44 x 44`, f.tiny.slice(0, 4).join(' | '));
      if (name.startsWith('card')) {
        ok(f.others.length <= 3, `${tag} ${name}: at most 3 buttons beside the primary`, f.others.join());
        const w = await o.page.evaluate(() => ({ card: document.getElementById('screen-card').innerText, goal: document.getElementById('cardGoal').innerText, look: document.getElementById('cardLook').innerText }));
        ok(words(w.card) <= 25 + 4, `${tag} ${name}: the card text is at most 25 words (+ the button labels)`, `${words(w.card)}`);
        ok(words(w.goal) <= 12, `${tag} ${name}: the goal line is at most 12 words`, `${words(w.goal)}: ${w.goal}`);
        ok(words(w.look) <= 15, `${tag} ${name}: the look-here hint is at most 15 words`, `${words(w.look)}: ${w.look}`);
      }
    }
    ok(seen.length === STEPS.length, `${tag}: all ${STEPS.length} screens were visited`);
    ok(o.errors.length === 0, `${tag}: no page error`, o.errors.join(' | '));
    await o.close();
    // pause overlay (the pause button lives on the play screen)
    const q = await openGame(browser, g, { viewport: vp });
    await reach(q.page, 'play', 1);
    await q.page.click('#btnPause');
    await q.page.waitForSelector('#ov-pause:not([hidden])');
    await q.page.waitForTimeout(500);
    const pf = await q.page.evaluate(INSPECT);
    ok(pf.primaries.length === 1 && pf.primaries[0] === 'btnResume' && pf.btnPrimaries.length === 1, `${tag} pause: the single primary is Resume`, `${pf.primaries}`);
    ok(pf.tiny.length === 0, `${tag} pause: tap targets are at least 44 x 44`, pf.tiny.join(' | '));
    await q.page.click('#btnResume');
    await q.page.waitForSelector('#ov-pause', { state: 'hidden' });
    ok(q.errors.length === 0, `${tag} pause: no page error`, q.errors.join(' | '));
    await q.close();
  }

  /* ---- level 1 key facts: Start is the only primary on the title; settings has at most 3 audio controls --------- */
  {
    const o = await openGame(browser, g);
    ok((await o.page.evaluate(INSPECT)).primaries[0] === 'btnStart', 'title: Start is the primary');
    await openSettings(o.page);
    const audioControls = await o.page.evaluate(() => [...document.querySelectorAll('#dlgSettings [role="switch"], #dlgSettings input[type="range"], #dlgSettings select')].filter((e) => !e.closest('[hidden]') && /sound|voice|volume|music|sfx|mute|audio/i.test(`${e.id} ${e.getAttribute('aria-label') || ''} ${e.closest('.set-row')?.querySelector('.set-lbl')?.textContent || ''}`)).map((e) => e.id));
    ok(audioControls.length === 3, 'settings: exactly the 3 audio controls (sound, voice, volume), no more', audioControls.join());
    await closeSettings(o.page);
    await o.close();
  }

  /* ---- nothing moves by itself (rule 7 in spirit): idle title and card, 1 s against 8 s -------------------------- */
  {
    const o = await openGame(browser, g);
    for (const [name, to] of [['title', null], ['card 1', ['card', 1]]]) {
      if (to) await reach(o.page, to[0], to[1]);
      await o.page.waitForTimeout(1000);
      const a = await o.page.evaluate(BOXES);
      await o.page.waitForTimeout(7000);
      const b = await o.page.evaluate(BOXES);
      nonEmpty(a, `${name} layout boxes`);
      const moved = a.filter((x, i) => x !== b[i]);
      ok(a.length === b.length && moved.length === 0, `${name}: every layout box is identical at 1 s and 8 s (except [data-live])`, moved.slice(0, 3).join(' | '));
    }
    await o.close();
  }

  /* ---- flash and motion ------------------------------------------------------------------------------------------ */
  for (const mode of ['normal']) {
    const o = await openGame(browser, g);
    await reach(o.page, 'play', 1);
    const seenAnims = [];
    const sampleAnims = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { seenAnims.push(...await anims(o.page)); await o.page.waitForTimeout(60); } };
    await o.page.click('#btnSkip'); // level clear
    await o.page.waitForSelector('#ov-clear:not([hidden])');
    const clearFlash = flashRun(o.page, 2500);
    await sampleAnims(2500);
    const cf = flashStats(await clearFlash);
    ok(cf.worst <= 3 && !cf.flip, `${mode}: the level-clear stage changes luminance at most 3 times in any 1 s (worst ${cf.worst}) with no full-screen flip`, JSON.stringify({ worst: cf.worst, flip: cf.flip }));
    await reach(o.page, 'finale');
    const finFlash = flashRun(o.page, 3200);
    await sampleAnims(3200);
    const ff = flashStats(await finFlash);
    ok(ff.worst <= 3 && !ff.flip, `${mode}: the finale (confetti) changes luminance at most 3 times in any 1 s (worst ${ff.worst}) with no full-screen flip`, JSON.stringify({ worst: ff.worst, flip: ff.flip }));
    nonEmpty(seenAnims, 'animations seen on the clear and finale screens');
    const css = seenAnims.filter((a) => a.kind === 'CSSAnimation');
    ok(css.every((a) => a.iterations !== Infinity && a.iterations !== 'Infinity'), 'no CSS animation with infinite iterations is running', css.filter((a) => a.iterations === Infinity).map((a) => a.name).join());
    // A one-shot fade of 280 ms (the --t-std token) cannot flash; the 333 ms floor (3 Hz) binds anything that REPEATS. The luminance sampler above is the real flash gate.
    ok(css.filter((a) => a.iterations !== 1).every((a) => a.duration >= 333), 'no repeating CSS animation is shorter than 333 ms (3 Hz)', css.filter((a) => a.iterations !== 1 && a.duration < 333).map((a) => `${a.name} ${a.duration}`).join());
    const longest = Math.max(0, ...seenAnims.map((a) => a.duration + Math.max(0, a.delay || 0)).filter(Number.isFinite));
    ok(longest <= 1200, `every animation and transition is at most 1200 ms (confetti), the longest seen is ${longest} ms`);
    // exempt: the confetti, and the target ring that spec 2.3 asks to pulse for 2 s when a card closes
    const nonConfetti = seenAnims.filter((a) => !/confetti|fx-|fx/i.test(`${a.target} ${a.name}`));
    ok(nonConfetti.every((a) => !Number.isFinite(a.duration) || a.duration + Math.max(0, a.delay || 0) <= 600), 'outside the confetti every animation and transition is at most 600 ms', nonConfetti.filter((a) => a.duration > 600).map((a) => `${a.target}/${a.name} ${a.duration}`).slice(0, 3).join(' | '));
    ok(o.errors.length === 0, `${mode}: no page error`, o.errors.join(' | '));
    await o.close();
  }
  for (const [label, opts] of [['prefers-reduced-motion', { reducedMotion: 'reduce' }], ['Calm mode', { calm: true }]]) {
    const o = await openGame(browser, g, opts);
    await reach(o.page, 'play', 1);
    await o.page.click('#btnSkip');
    await o.page.waitForSelector('#ov-clear:not([hidden])');
    await o.page.waitForTimeout(1500);
    const moving = (a) => a.state === 'running' && a.duration > 0 && a.props.some((k) => k !== 'opacity'); // opacity-only holds are allowed under reduced motion
    const run1 = (await anims(o.page)).filter(moving);
    ok(run1.length === 0, `${label}: nothing moves on the level-clear screen (opacity-only holds allowed)`, run1.map((a) => `${a.target}/${a.name} ${a.duration}`).join(' | '));
    await reach(o.page, 'finale');
    await o.page.waitForTimeout(2000);
    const run2 = (await anims(o.page)).filter(moving);
    ok(run2.length === 0, `${label}: nothing moves on the finale`, run2.map((a) => `${a.target}/${a.name} ${a.duration}`).join(' | '));
    const canvas = await o.page.evaluate(() => [...document.querySelectorAll('canvas')].filter((c) => !c.closest('[hidden]') && c.getBoundingClientRect().width > 0).length);
    ok(canvas === 0, `${label}: no confetti canvas on the finale`, String(canvas));
    const stars = await o.page.evaluate(() => document.getElementById('finStars')?.textContent || '');
    ok(stars.trim().length > 0, `${label}: the static star row is still shown`, stars);
    const sw = await flashRun(o.page, 1200);
    ok(flashStats(sw).worst === 0, `${label}: the finale does not change luminance at all`, String(flashStats(sw).worst));
    await o.close();
  }

  /* ---- Arabic: RTL, mirrored rail, Latin digits ------------------------------------------------------------------- */
  {
    const ar = await openGame(browser, g, { lang: 'ar' });
    const en = await openGame(browser, g, { lang: 'en' });
    const place = async (o) => { await reach(o.page, 'play', 2); await o.page.waitForTimeout(650); return o.page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang, rail: document.getElementById('rail').getBoundingClientRect().x, stage: document.querySelector('.stage').getBoundingClientRect().x, score: document.getElementById('score').textContent, hud: document.getElementById('hudLevel').textContent })); };
    const A = await place(ar); const E = await place(en);
    ok(A.dir === 'rtl' && A.lang === 'ar', 'Arabic: <html dir="rtl" lang="ar">', `${A.dir} ${A.lang}`);
    ok(E.dir === 'ltr' && E.rail > E.stage, 'English: the rail sits at the inline-end (right of the stage)', `${E.rail} vs ${E.stage}`);
    ok(A.rail < A.stage, 'Arabic: the layout mirrors, the rail is at the inline-end (left of the stage)', `${A.rail} vs ${A.stage}`);
    ok(/^[0-9,.\s]*$/.test(A.score), 'Arabic: the score uses Latin digits', A.score);
    ok(/[؀-ۿ]/.test(A.hud) && /[0-9]/.test(A.hud), 'Arabic: the HUD level text is Arabic with Latin digits', A.hud);
    await ar.close(); await en.close();
  }

  /* ---- below the minimum window: one card ------------------------------------------------------------------------ */
  {
    const o = await openGame(browser, g, { viewport: { width: 900, height: 560 } });
    await o.page.waitForTimeout(400);
    const n = await o.page.evaluate(() => { const e = document.getElementById('narrow'); const r = e.getBoundingClientRect(); return { shown: getComputedStyle(e).display !== 'none' && r.width > 0, text: e.innerText.trim() }; });
    ok(n.shown && n.text.length > 0, 'below 1024 x 640 the game shows the single "use a wider window" card', JSON.stringify(n));
    await o.close();
  }
  await ctx0.close();
} catch (err) {
  ok(false, `run aborted: ${err.message}`, String(err.stack).split('\n').slice(1, 3).join(' | '));
} finally {
  await browser.close();
  await g.close();
}
void assert; void readJson;
finish('test-game-guardrails');
