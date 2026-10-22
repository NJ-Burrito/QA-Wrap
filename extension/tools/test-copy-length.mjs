/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R10 (autopilot-1011, REQ-P1-8 warning half and REQ-P1-11 length half): rendered words, not key length.
 *
 *   node tools/test-copy-length.mjs
 *
 * On the real popup (348x600):
 *   - warning half: every warning box (.state-banner, .stale-bar) contains its fix as a button and is at most 15 EN words
 *     including the button: the restricted-page banner, the worker-silent banner, the disk warning, the stale-extension bar and
 *     the autopilot line when it has a button. The stale bar's Reload keeps a confirm only while recording.
 *   - length half: in each popup state (asleep, recording, done, idle) every visible hint (<p> and .fine, outside the tool list)
 *     is at most 25 words; the idle popup shows at most 60 words above the primary button, tool list excluded.
 */
import { launchPopupHarness } from './test-next-primary.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };

const WORDS = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
/** Hints that are allowed to be longer, each with the reason (REQ-P1-11: consent and the welcome key facts are exempt). */
const ALLOW = [{ sel: '#consent-card', why: 'the consent notice is the store-required disclosure' }];

let h;
let code = 1;
try {
  h = await launchPopupHarness({ label: 'pop-r10' });
  const { popup } = h;

  /* Warning half. Each box is drawn by the popup's own code, then measured. */
  await popup.evaluate(() => { document.getElementById('status').textContent = ''; });
  const boxes = await popup.evaluate(async () => {
    const out = [];
    const shown = (e) => !!e.offsetParent && e.checkVisibility({ visibilityProperty: true });
    const read = (name, e) => {
      const buttons = [...e.querySelectorAll('button')].filter(shown);
      out.push({ name, buttons: buttons.length, words: e.innerText.trim().split(/\s+/).filter(Boolean).length, text: e.innerText.replace(/\s+/g, ' ').trim() });
    };
    // restricted page: no web page under test
    siteAccess.pattern = null; workerDown = false; paintBanner(); read('restricted page', document.getElementById('state-banner'));
    // worker silent
    workerDown = true; paintBanner(); read('worker silent', document.getElementById('state-banner'));
    workerDown = false; siteAccess.pattern = 'https://example.test/*'; paintBanner();
    // disk warning
    document.getElementById('disk-warn').hidden = false; read('disk warning', document.getElementById('disk-warn')); document.getElementById('disk-warn').hidden = true;
    // stale extension
    const real = chrome.runtime.getManifest;
    chrome.runtime.getManifest = () => ({ ...real.call(chrome.runtime), version: '0.0.1' });
    await checkWorkerBuild();
    chrome.runtime.getManifest = real;
    read('stale extension', document.querySelector('.stale-bar'));
    document.querySelector('.stale-bar')?.remove();
    // autopilot: running by itself (pause) and paused (resume); the idle line has no button by design
    state = { ...state, session: { id: 'x', autoStarted: true, startedAt: Date.now() } };
    await paintAutoBanner(); read('autopilot running', document.getElementById('auto-banner'));
    await chrome.storage.session.set({ autoPauseUntil: Date.now() + 3600000 });
    await paintAutoBanner(); read('autopilot paused', document.getElementById('auto-banner'));
    await chrome.storage.session.remove('autoPauseUntil');
    document.getElementById('auto-banner').hidden = true;
    return out;
  });
  for (const b of boxes) {
    check(b.buttons >= 1, `${b.name}: contains its fix as a button`, b.text);
    check(b.words <= 15, `${b.name}: ${b.words} words (max 15)`, b.text);
  }
  const confirms = await popup.evaluate(() => {
    const src = reloadCarefully.toString();
    return { guarded: /state\?\.recording/.test(src) && /confirm\(/.test(src), bareBannerConfirm: /confirm\(/.test(paintBanner.toString()) };
  });
  check(confirms.guarded && !confirms.bareBannerConfirm, 'Reload asks for confirmation only while recording (reloadCarefully), the banner itself never does');

  /* Length half, state by state. */
  const measure = () => popup.evaluate((allow) => {
    const shown = (e) => !!e.offsetParent && e.checkVisibility({ visibilityProperty: true });
    const hints = [...document.querySelectorAll('p, .fine')]
      .filter((e) => shown(e) && !e.closest('#tool-sheet, #tools, #more-menu, template') && !allow.some((a) => e.closest(a.sel)))
      .map((e) => ({ id: e.id || e.className, words: e.innerText.trim().split(/\s+/).filter(Boolean).length, text: e.innerText.replace(/\s+/g, ' ').trim().slice(0, 90) }))
      .filter((x) => x.words > 25);
    const primary = document.querySelector('[data-primary]');
    const top = primary ? primary.getBoundingClientRect().top : Infinity;
    let above = 0;
    const walker = document.createTreeWalker(document.querySelector('.app'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const e = n.parentElement;
      if (!e || !shown(e) || e.closest('#tool-sheet, #tools, #more-menu, .app-head, script, style, template')) continue;
      const words = n.textContent.trim().split(/\s+/).filter(Boolean).length;
      if (words && e.getBoundingClientRect().bottom <= top + 1) above += words;
    }
    return { hints, above };
  }, ALLOW);
  const states = { asleep: 'asleep', recording: 'recording', 'done-clean': 'done', idle: 'idle' };
  for (const name of ['asleep', 'recording', 'done-clean', 'idle']) {
    await h.to(name);
    await popup.waitForFunction(() => !document.getElementById('status').textContent, null, { timeout: 15000 });
    const m = await measure();
    check(m.hints.length === 0, `${states[name]}: every visible hint is at most 25 words`, m.hints.map((x) => `${x.id} (${x.words}): ${x.text}`).join('\n        '));
    if (name === 'idle') check(m.above <= 60, `idle: ${m.above} words above the primary button (max 60)`);
  }
  /* 15 Oct 2026 (Nader): no paragraphs on the popup or the side panel. A visible hint in the session area is one short line (at most 8 words);
     each tool's panel shows the same, with what-it-does and why behind the "About this tool" disclosure. */
  const short = await popup.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const shown = (e) => !!e.offsetParent && e.checkVisibility({ visibilityProperty: true });
    const words = (e) => e.innerText.trim().split(/\s+/).filter(Boolean).length;
    const bad = [];
    const scan = (where, root) => {
      for (const e of root.querySelectorAll('.fine, .opts-head, .tool-help p, .rule-state')) {
        if (shown(e) && !e.closest('.tool-about, #consent-card, [data-allow-long]') && words(e) > 8) bad.push(`${where} ${e.id || e.className} (${words(e)}): ${e.innerText.replace(/\s+/g, ' ').trim().slice(0, 70)}`);
      }
    };
    scan('session', document.getElementById('session'));
    for (const row of document.querySelectorAll('.tool-row')) {
      const more = row.querySelector('.tool-more');
      if (!more) continue;
      more.click();
      await wait(60);
      scan(row.dataset.tool, row);
      more.click();
      await wait(30);
    }
    document.querySelector('[data-action="break-toggle"]').click();
    await wait(80);
    scan('break', document.getElementById('break-panel'));
    document.getElementById('break-back').click();
    return bad;
  });
  check(short.length === 0, 'every visible hint in the session area and on a tool panel is at most 8 words', short.join('\n        '));
  check(h.errors.length === 0, 'no page error in the popup', h.errors.join(' | '));
  code =failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  run aborted: ${err.stack || err.message}`);
} finally {
  await h?.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
