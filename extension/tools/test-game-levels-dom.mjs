/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt levels on a real DOM (DESIGN-bug-hunt sections 2.3 and 11): the parts of the detectors that need a browser. The
 * pure detect() verdicts are test-game-levels.mjs; this mounts the REAL level modules (levels/l1..l5.js) from the game's own
 * server into a bare page, clicks the real buttons, and reads the events each level hands to its ctx.
 *
 *   node tools/test-game-levels-dom.mjs        (from extension/, PYTHONUTF8=1)
 *
 * What only a DOM can say: the planted bug of each level fires through the real markup and the real request; a mutation
 * outside #app (QA Wrap's overlay) does not count as the page reacting; a decoration-only attribute change does not either;
 * the layout overflow is read at click time; a fast Pay is not the slow-call bug. QA Wrap's state is the page variable
 * window.__qaw, standing in for dataset.qawState. Until game/levels lands: exit 2.
 */
import { ok, skipNotEnforced, finish } from './lib-assert.mjs';
import { missing, startGame, launch } from './lib-game.mjs';

const need = missing('levels/l1.js', 'levels/l5.js', 'server.mjs', 'game.css', 'shop.css');
if (need.length) {
  skipNotEnforced({ rule: 'game', what: 'level detectors on a real DOM', why: `game/${need.join(', game/')} have not landed` });
  finish('test-game-levels-dom', { skipped: 1 });
}

const HARNESS = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui/fonts.css"><link rel="stylesheet" href="/shop.css"></head>
<body><div id="app" style="width:760px"></div><script type="module">
window.__net = 0; window.__qaw = 'ready'; window.__events = [];
window.__run = async (n) => {
  const m = await import('/levels/l' + n + '.js');
  const root = document.getElementById('app');
  const ctx = { n, root, doc: document, win: window, t: (k) => k, now: () => performance.now(), qawState: () => window.__qaw, qawCounts: () => window.__counts || null,
    fetch: (...a) => { window.__net++; return fetch(...a); }, netCount: () => window.__net, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h),
    MutationObserver, emit: (e) => window.__events.push(e) };
  m.mount(root, ctx); m.arm(ctx); window.__mod = m; window.__ctx = ctx;
};
window.__ready = true;
</script></body></html>`;

const g = await startGame();
const fast = await startGame({ payDelayMs: 150 });
const browser = await launch();
try {
  async function open(game, n, qaw = 'ready') {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const errors = [];
    await context.route('**/__levels', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: HARNESS }));
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${game.origin}/__levels`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true);
    await page.evaluate((q) => { window.__qaw = q; }, qaw);
    await page.evaluate((k) => window.__run(k), n);
    const events = () => page.evaluate(() => window.__events.map((e) => e.type + (e.key ? ':' + e.key : '') + (e.kind ? ':' + e.kind : '')));
    return { page, context, errors, events, close: () => context.close() };
  }
  const has = (list, t) => list.some((x) => x === t || x.startsWith(`${t}:`));

  /* ---- L1 ---------------------------------------------------------------------------------------------------------- */
  {
    const L = await open(g, 1, 'asleep');
    await L.page.click('#save');
    await L.page.waitForFunction(() => /./.test(document.getElementById('save-state').textContent), null, { timeout: 5000 });
    ok(await L.page.evaluate(() => document.getElementById('save-state').textContent) === 'shop.l1.saved', 'L1: the page says Saved although the request failed (the planted lie)');
    let ev = await L.events();
    ok(!has(ev, 'catch') && has(ev, 'nudge:rail.nudgeAsleep'), 'L1: asleep -> a nudge and no catch', ev.join());
    await L.page.evaluate(() => { window.__qaw = 'ready'; });
    await L.page.click('#save');
    await L.page.waitForFunction(() => window.__events.some((e) => e.type === 'catch'), null, { timeout: 5000 });
    ev = await L.events();
    ok(has(ev, 'catch'), 'L1: the bug stays armed and is caught on the next Save once QA Wrap is ready');
    ok(await L.page.evaluate(() => window.__mod.proveSignal(window.__ctx)) === true, 'L1: prove = QA Wrap has left asleep');
    await L.page.click('#cancel');
    await L.page.click('label[data-bonus="l1"]');
    ev = await L.events();
    ok(has(ev, 'wrong:decoy') && has(ev, 'bonus'), 'L1: the Cancel decoy is a "wrong", the typo label is the hidden bonus', ev.join());
    await L.close();
    const L2 = await open(g, 1, 'ready');
    ok(await L2.page.evaluate(() => window.__mod.proveSignal(window.__ctx)) === false, 'L1: not proved before the catch');
    await L2.close();
  }
  /* ---- L2 ---------------------------------------------------------------------------------------------------------- */
  {
    const L = await open(g, 2, 'asleep');
    await L.page.click('#apply');
    await L.page.waitForTimeout(300);
    let ev = await L.events();
    ok(L.errors.length === 0, 'L2: Apply raises its TypeError as an error event, never uncaught (an uncaught error would add a row to chrome://extensions Errors)', L.errors.join(' | '));
    ok(await L.page.evaluate(() => window.__events.some((e) => e.type === 'nudge')), 'L2: the event reached the level (asleep nudge)');
    ok(!has(ev, 'catch') && has(ev, 'nudge'), 'L2: asleep -> a nudge, no catch', ev.join());
    await L.page.evaluate(() => { window.__qaw = 'recording'; });
    await L.page.click('#apply');
    await L.page.waitForFunction(() => window.__events.some((e) => e.type === 'catch'), null, { timeout: 3000 });
    ok(true, 'L2: the marked error is caught while recording');
    await L.close();
    const F = await open(g, 2, 'ready');
    await F.page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { error: new Error('foreign') })));
    await F.page.waitForTimeout(200);
    ok(!has(await F.events(), 'catch'), 'L2: a foreign error (no marker) is not the bug');
    await F.close();
  }
  /* ---- L3 ---------------------------------------------------------------------------------------------------------- */
  {
    const run = async (label, act, want) => {
      const L = await open(g, 3);
      await L.page.click('#next');
      await L.page.evaluate(act);
      await L.page.waitForTimeout(1700);
      const ev = await L.events();
      ok(has(ev, 'catch') === want, `L3: ${label}`, ev.join());
      await L.close();
    };
    await run('nothing happens after the click -> caught', () => {}, true);
    await run('a mutation OUTSIDE #app (QA Wrap overlay, the hint ping) -> still caught', () => setTimeout(() => document.body.append(Object.assign(document.createElement('div'), { id: 'qaw-overlay', textContent: 'QA Wrap' })), 200), true);
    await run('a class or style change inside #app (decoration only) -> still caught', () => setTimeout(() => { document.getElementById('next').className += ' hot'; document.getElementById('next').style.outline = '2px solid gold'; }, 200), true);
    await run('a mutation INSIDE #app -> not caught (the page reacted)', () => setTimeout(() => document.getElementById('app').append(document.createElement('p')), 200), false);
    await run('a fetch after the click -> not caught', () => setTimeout(() => { window.__ctx.fetch('/api/coupons'); }, 200), false);
    const L = await open(g, 3);
    await L.page.click('#back');
    await L.page.waitForTimeout(1500);
    let ev = await L.events();
    ok(has(ev, 'wrong:decoy') && !has(ev, 'catch'), 'L3: the Back decoy is a "wrong", never a catch', ev.join());
    await L.page.click('.shop-footer[data-bonus="l3"]');
    ev = await L.events();
    ok(has(ev, 'bonus'), 'L3: the stray "undefined" footer is the hidden bonus');
    ok(await L.page.evaluate(() => window.__mod.proveSignal(window.__ctx)) === false, 'L3: not proved before the catch');
    await L.close();
    const P = await open(g, 3);
    await P.page.evaluate(() => { window.__counts = { notes: 0, shots: 0 }; });
    await P.page.click('#next');
    await P.page.waitForFunction(() => window.__events.some((e) => e.type === 'catch'), null, { timeout: 4000 });
    ok(await P.page.evaluate(() => window.__mod.proveSignal(window.__ctx)) === false, 'L3: prove stays false until the note count goes up');
    await P.page.evaluate(() => { window.__counts = { notes: 1, shots: 0 }; });
    ok(await P.page.evaluate(() => window.__mod.proveSignal(window.__ctx)) === true, 'L3: a note added after the catch (qawNotes 0 -> 1) proves the step');
    await P.close();
  }
  /* ---- L4 ---------------------------------------------------------------------------------------------------------- */
  {
    const L = await open(g, 4);
    ok(await L.page.evaluate(() => { const r = document.getElementById('ref'); return r.scrollWidth > r.clientWidth; }), 'L4: the order number really overflows its box in the real layout');
    await L.page.click('#thanks');
    await L.page.evaluate(() => { document.getElementById('ref').style.width = '40ch'; });
    await L.page.click('#ref');
    let ev = await L.events();
    ok(!has(ev, 'catch') && has(ev, 'wrong:decoy'), 'L4: widened box -> clicking #ref is not a catch; the heading is a decoy', ev.join());
    await L.page.evaluate(() => { document.getElementById('ref').style.width = '9ch'; });
    await L.page.click('#ref');
    ev = await L.events();
    ok(has(ev, 'catch'), 'L4: clicking #ref while it still overflows catches');
    await L.page.click('.shop-fine[data-bonus="l4"]');
    ok(has(await L.events(), 'bonus'), 'L4: the 9 px fine print is the hidden bonus');
    const fs = await L.page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.shop-fine')).fontSize));
    ok(fs === 9, 'L4: the fine print really is 9 px', String(fs));
    await L.close();
  }
  /* ---- L5 ---------------------------------------------------------------------------------------------------------- */
  {
    const L = await open(g, 5);
    const t0 = Date.now();
    await L.page.click('#pay');
    await L.page.waitForFunction(() => window.__events.some((e) => e.type === 'catch'), null, { timeout: 9000 });
    ok(Date.now() - t0 >= 3900, 'L5: the planted route takes about 4 s and the slow call is caught', `${Date.now() - t0} ms`);
    await L.close();
    const Q = await open(fast, 5);
    await Q.page.click('#pay');
    await Q.page.waitForTimeout(1200);
    ok(!has(await Q.events(), 'catch'), 'L5: a fast Pay (150 ms) is not the slow-call bug');
    await Q.page.click('#cancel');
    ok(has(await Q.events(), 'wrong:decoy'), 'L5: Cancel is a decoy');
    await Q.close();
    const S = await open(g, 5);
    await S.page.click('#pay');
    await S.page.waitForFunction(() => window.__events.some((e) => e.type === 'catch'), null, { timeout: 9000 });
    await S.page.evaluate(() => { window.__qaw = 'recording'; });
    ok(await S.page.evaluate(() => window.__mod.proveSignal(window.__ctx)) === false, 'L5: prove is false while recording');
    await S.page.evaluate(() => { window.__qaw = 'stopped'; });
    ok(await S.page.evaluate(() => window.__mod.proveSignal(window.__ctx)) === true, 'L5: prove is true once QA Wrap went recording -> stopped');
    await S.close();
  }
} catch (err) {
  ok(false, `run aborted: ${err.message}`, String(err.stack).split('\n').slice(1, 3).join(' | '));
} finally {
  await browser.close();
  await g.close();
  await fast.close();
}
finish('test-game-levels-dom');
