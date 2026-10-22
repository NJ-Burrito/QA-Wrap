/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * ui-1016 lane H2: the real popup answers every press, and the float opens at its own size.
 *
 *   node tools/test-popup-outcomes.mjs
 *
 *   1. The camera in the note row, pressed with an EMPTY note, takes a screenshot (one more event) and ticks at once.
 *   2. Map the page and Reverse-engineer the spec leave a one-line outcome with an Open button that does not fade.
 *   3. Copy a locator: the "Starting..." line is replaced the moment the picker is on, and again when a locator arrives.
 *   4. The float window opens at 560x720 even when Chrome is run with --window-size (the harness is, at 1100x800).
 *   5. (lane K2) A tool outcome stays put and is scrolled into view when the side panel is scrolled down to the tools.
 *   6. (lane K2) "Session saved." is on the done card once; the break strings are one short line, EN and AR.
 *   7. (lane K2) No horizontal scrollbar: a wide problem row wraps instead of widening the side panel.
 *   8. (lane K2) A pending Allow from a popup the permission bubble closed is picked up and re-checked on the next open.
 */
import { launchPopupHarness } from './test-next-primary.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

let h;
let code = 1;
try {
  h = await launchPopupHarness({ label: 'pop-h2' });
  const { popup } = h;
  await h.to('recording');
  const status = () => popup.evaluate(() => {
    const st = document.getElementById('status');
    return { text: st.textContent.trim(), open: st.querySelector('.status-fix')?.textContent.trim() || null };
  });
  const events = () => popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'UQA_GET_STATE' }))?.result?.eventCount ?? -1);

  /* 1 */
  const before = await events();
  await popup.fill('#note-text', '');
  await popup.click('#shot');
  check(await popup.evaluate(() => document.getElementById('shot').classList.contains('is-done')), 'camera, empty note: it ticks at once');
  for (let i = 0; i < 30 && (await events()) <= before; i++) await popup.waitForTimeout(500);
  check((await events()) > before, 'camera, empty note: a screenshot event is saved', `${before} -> ${await events()}`);
  await popup.waitForFunction(() => !document.getElementById('shot').classList.contains('is-done'), null, { timeout: 5000 });
  check(true, 'camera: the tick goes back to the camera');

  /* 2 */
  for (const action of ['spec', 'harvest']) {
    await popup.evaluate((a) => document.querySelector(`[data-action="${a}"]`).click(), action);
    await popup.waitForFunction(() => document.getElementById('status').querySelector('.status-fix'), null, { timeout: 15000 }).catch(() => {});
    const first = await status();
    check(first.open === 'Open', `${action}: the outcome carries an Open button`, JSON.stringify(first));
    check(words(first.text.replace(/Open$/, '')) <= 8, `${action}: the outcome is one line of 8 words or fewer`, first.text);
    await popup.waitForTimeout(5200); // statusFades is 4 s
    const later = await status();
    check(later.open === 'Open' && later.text.length > 0, `${action}: the outcome is still there after 5 s`, JSON.stringify(later));
  }

  /* 3 */
  await popup.evaluate(() => document.querySelector('[data-action="pick"]').click());
  await popup.waitForFunction(() => !/^Starting/.test(document.getElementById('status').textContent), null, { timeout: 15000 }).catch(() => {});
  const picking = await status();
  check(picking.text && !/^Starting/.test(picking.text), 'pick: the "Starting..." line is replaced once the picker is on', picking.text);
  check(words(picking.text) <= 8, 'pick: said in 8 words or fewer', picking.text);
  await popup.evaluate(() => { lastLocator = "page.getByLabel('Password')"; paintLocatorNow(); });
  const done = await status();
  check(/^Locator copied: /.test(done.text), 'pick: a locator arriving says so', done.text);
  await popup.evaluate(() => { paintLocatorNow(); });
  check((await status()).text === done.text, 'pick: the line settles once (no second message)');
  await popup.waitForTimeout(4600);
  check((await status()).text === done.text, 'pick: the outcome stays until the next action (no 4 s fade)');

  /* 4 */
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'UQA_OPEN_FLOAT' }));
  await popup.waitForTimeout(2500);
  const float = await h.context.serviceWorkers().find((w) => w.url().includes(h.id)).evaluate(async () => {
    const wins = await chrome.windows.getAll({ populate: true });
    const w = wins.find((x) => x.type === 'popup' && (x.tabs || []).some((t) => /surface=float/.test(t.url || t.pendingUrl || '')));
    return w ? { w: w.width, h: w.height } : null;
  });
  check(!!float, 'float: a float window exists');
  check(float && Math.abs(float.w - 560) <= 16 && Math.abs(float.h - 720) <= 16, 'float: opens at 560x720, not at the browser\'s own size', JSON.stringify(float));

  /* 5, 6, 7: the real side panel shell at 381 wide, the finished-session card */
  await h.popup.goto(`chrome-extension://${h.id}/sidepanel/sidepanel.html`);
  await h.popup.setViewportSize({ width: 381, height: 720 });
  await h.popup.waitForTimeout(2500);
  const f = h.popup.frames().find((x) => x.url().includes('popup.html'));
  await f.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
  await f.evaluate(() => { window.close = () => {}; });
  await f.evaluate(() => document.getElementById('start').click());
  await f.waitForSelector('#step-live:not([hidden])', { timeout: 20000 });
  await f.waitForTimeout(1000);
  await f.evaluate(() => document.getElementById('stop').click());
  await f.waitForSelector('#step-done:not([hidden])', { timeout: 20000 });
  await f.waitForTimeout(1500);
  const saved = await f.evaluate(() => [...document.querySelectorAll('#step-done *, #status')].filter((e) => e.children.length === 0 && e.getClientRects().length && e.textContent.trim() === 'Session saved.').length);
  check(saved === 1, '"Session saved." is shown once on the done card', String(saved));
  const wide = await f.evaluate(() => {
    const host = document.querySelector('.key-findings') || document.getElementById('step-done');
    const row = document.createElement('div');
    row.className = 'sg-row';
    row.innerHTML = '<span class="sg-chip">Warning</span><span class="sg-chip">Third-party failure</span><span class="sg-chip sg-warn">Warning: third party</span><span class="sg-msg"><bdi>/event?a=298279967&amp;b=2</bdi></span><span class="sg-n">x2</span><button class="sg-btn">Promote</button>';
    host.append(row);
    const body = document.getElementById('app-body');
    return { sw: body.scrollWidth, cw: body.clientWidth, doc: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth };
  });
  check(wide.sw <= wide.cw + 1 && wide.doc <= wide.vw + 1, 'no horizontal overflow with a three-chip problem row at 381', JSON.stringify(wide));
  await f.evaluate(() => { const b = document.getElementById('app-body'); b.scrollTop = b.scrollHeight; });
  await f.evaluate(() => document.querySelector('[data-action="harvest"]').click());
  await f.waitForFunction(() => /\S/.test(document.getElementById('status').textContent) && !/^(Reading|Mapping|Starting)/.test(document.getElementById('status').textContent.trim()), null, { timeout: 20000 }).catch(() => {});
  await f.waitForTimeout(5200);
  const seen = await f.evaluate(() => { const st = document.getElementById('status'); const r = st.getBoundingClientRect(); return { text: st.textContent.trim(), top: r.top, bottom: r.bottom, vh: innerHeight }; });
  check(seen.text.length > 0, 'the tool outcome is still there after 5 s, scrolled down', JSON.stringify(seen));
  check(seen.bottom > 0 && seen.top < seen.vh, 'the tool outcome is in view where the panel was scrolled', JSON.stringify(seen));

  const fs = await import('node:fs');
  const cat = (l) => JSON.parse(fs.readFileSync(new URL(`../platform/i18n/${l}.json`, import.meta.url), 'utf8'));
  for (const l of ['en', 'ar']) {
    const c = cat(l);
    for (const k of ['popup.break.cleared', 'popup.break.armed', 'popup.break.needHeader', 'popup.break.needDestination']) {
      const n = words(c[k].replace(/\{\w+\}/g, 'x'));
      check(n <= (k === 'popup.break.armed' ? 8 : 6), `${l} ${k}: short (${n} words)`, c[k]);
    }
  }

  /* 8: a pending Allow left by a popup the permission bubble closed */
  const link = `${h.origin}/*`;
  await f.evaluate((l) => chrome.storage.session.set({ 'qaw.linksPending': { need: [l], rows: [], at: Date.now() } }), link);
  await h.popup.goto(`chrome-extension://${h.id}/sidepanel/sidepanel.html`);
  await h.popup.waitForTimeout(2500);
  const g = h.popup.frames().find((x) => x.url().includes('popup.html'));
  await g.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
  const left = await g.evaluate(async () => { await new Promise((r) => setTimeout(r, 1500)); return (await chrome.storage.session.get('qaw.linksPending'))['qaw.linksPending'] ?? null; });
  check(left === null, 'the pending Allow is picked up (and cleared) on the next open', JSON.stringify(left));
  const shown = await g.evaluate(() => document.getElementById('status').textContent.trim());
  console.log(`  note  re-check line after the resume: ${JSON.stringify(shown)}`);
  check(/link|Asking/i.test(shown) || /asleep|permission|access/i.test(shown), 'the resume shows a links line (result or its reason)', shown);

  check(h.errors.length === 0, 'no page error in the popup', h.errors.join(' | '));
  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  run aborted: ${err.stack || err.message}`);
} finally {
  await h?.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
