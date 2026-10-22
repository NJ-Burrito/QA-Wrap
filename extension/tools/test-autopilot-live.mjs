/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * AUTO-1 / AUTO-2, end to end (review D6): the real service worker, the real navigation listener and the real content
 * script, in one headed browser on the secondary monitor.
 *
 *   node tools/test-autopilot-live.mjs
 *
 * What the stub tests (test-autostart, test-autoshot, test-page-indicator) cannot say, this does:
 *   - with the dot switched off in Settings (the `pageIndicator` key) a ticked, awake site starts NO session;
 *   - with the dot on, the first navigation starts a session by itself, the record says `autoStarted`, and the on-page
 *     dot of that very tab is connected (asked of the content script's own world through the extension), so
 *     "the dot is shown in every auto-started session" holds on the real wiring, not a fake chrome;
 *   - the charter is host + date, never the page title.
 * One browser, Playwright only (no OS mouse), closed on exit; the profile goes to the recycle bin.
 */
import { launchPopupHarness } from './test-next-primary.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };
const until = async (fn, ms = 12000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 250)); } };

let h;
let code = 1;
try {
  h = await launchPopupHarness({ label: 'auto-live' });
  const { popup, target, origin } = h;
  const pattern = `${origin}/*`;
  const here = await popup.evaluate(async (u) => { const [t] = await chrome.tabs.query({ url: u }); return { tabId: t.id, windowId: t.windowId }; }, pattern);
  const send = (msg) => popup.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const state = async () => (await send({ type: 'UQA_GET_STATE', windowId: here.windowId })).result;
  const dot = () => popup.evaluate(async (tabId) => {
    const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => (window.UQAAutopilot ? window.UQAAutopilot.probe() : null) });
    return r[0]?.result ?? null;
  }, here.tabId);

  // An awake window with the site ticked for auto-start, and nothing recording.
  await send({ type: 'UQA_ARM', windowId: here.windowId });
  await popup.evaluate(async (p) => { await chrome.storage.local.set({ autoStartSites: [p], pageIndicator: false }); }, pattern);
  check((await state()).session == null, 'no session before the test');

  await target.goto(`${origin}/?off`, { waitUntil: 'domcontentloaded' });
  await target.waitForTimeout(3500);
  const off = await state();
  check(off.session == null, 'dot switched off: the ticked, awake site started no session', JSON.stringify(off.session));

  await popup.evaluate(async () => { await chrome.storage.local.remove('pageIndicator'); });
  await target.goto(`${origin}/?on`, { waitUntil: 'domcontentloaded' });
  const started = await until(async () => { const s = await state(); return s.session?.autoStarted ? s : null; });
  check(!!started, 'dot on: the first navigation started a session by itself (record says autoStarted)');
  if (started) {
    check(/^127\.0\.0\.1:\d+ /.test(started.session.charter || '') && !/POP fixture/.test(started.session.charter || ''), 'the charter is host + date, not the page title', started.session.charter);
    const shown = await until(async () => { const p = await dot(); return p && p.dot === 1 ? p : null; });
    check(!!shown, 'the on-page dot of that tab is connected in the real content script', JSON.stringify(await dot()));
  }
  check(h.errors.length === 0, 'no page error in the popup', h.errors.join(' | '));
  await send({ type: 'UQA_STOP' }).catch(() => {});
  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  run aborted: ${err.stack || err.message}`);
} finally {
  await h?.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
