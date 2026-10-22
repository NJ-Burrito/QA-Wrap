/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The end-to-end walk the owner does by hand (sdlc-1014b, 14 Oct 2026), on the BUILT extension, in English and in Arabic.
 *
 *   node tools/test-e2e-practice.mjs [--ext <dir>]        default: dist/chrome (build first: npm run build)
 *
 * It loads dist/chrome UNMODIFIED in a real Chromium (tools/lib-e2e.mjs: no manifest edit, no stubbed chrome, no fixture page for
 * the practice flow), opens the packaged practice page and drives the real popup page with Playwright only (never the OS mouse):
 * Test this site, one press on each practice button, Stop, Copy report. Headed on the secondary monitor; the pipeline runs it
 * headless in `regression` (headlessOk). It asserts what a person sees:
 *
 *   - the idle popup shows no error text and nothing that points at a tooltip;
 *   - an unknown failure says so in one sentence and carries a visible "Copy details" button, no title attribute (rule 10);
 *   - the Asleep card is one line on an allowed site, full on a not-yet-allowed one until the first press, then one line,
 *     and its box does not move by itself afterwards (rule 7);
 *   - the side-panel button opens a panel where the browser has one;
 *   - the done card names the session (never "Untitled session" while a problem exists) and its three durations agree;
 *   - the practice page is the Bug Hunt game (15 Oct 2026): levels 1 to 4 are played by pressing what a player presses, and the four faults
 *     they plant (a failed request behind "Saved", an uncaught coupon error, a Next step button that does nothing, an order number that runs
 *     out of its box) are in the copied report and counted on the done card. The game page carries the real recorder and checks, so this
 *     walks the real code path. (The low-contrast fault of the earlier page is not in the game; practice/faults.html keeps it as a fixture.)
 *   - the scan tool pressed on that page gives a sentence, not Chrome's raw words, and no Open Settings button.
 *
 * Opera GX: when the installed binary is found (QAW_OPERA_PATH, else the default install folder) and the run is headed, dist/operagx is
 * loaded there and the button is checked to be ABSENT (no chrome.sidePanel exists in Opera) and Settings not to offer the panel; otherwise
 * it says "not verified on Opera GX".
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './lib-paths.mjs';
import { launchE2E, audit, until, operaPath, builtExtension } from './lib-e2e.mjs';
import { forceHeadless } from './lib-launch.mjs';
import { reach } from './lib-game.mjs';

const argv = process.argv.slice(2);
const EXTARG = argv.includes('--ext') ? path.resolve(argv[argv.indexOf('--ext') + 1]) : null;

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>E2E page</title><h1>Fixture</h1><button id=b>Go</button>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const UNTITLED = /untitled session|جلسة بلا عنوان/i;
const secs = (s) => { const m = /(\d+):(\d\d)/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const box = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return `${Math.round(r.top)}/${Math.round(r.height)}`; }, sel);

async function scenario({ engine, lang }) {
  const tag = `${engine}/${lang}`;
  const h = await launchE2E({ engine, lang, ext: engine === 'chrome' ? EXTARG : undefined, label: 'e2e-practice' });
  if (!h) { console.log(`  note  not verified on Opera GX (no installed binary found)`); return; }
  try {
    const practice = await h.game();
    const site = await h.page(origin);
    const popupFaults = () => h.faults.filter((f) => !/^practice/.test(f.page));

    // Asleep on a not-yet-allowed site: full card, collapses after the first completed press, then stays put.
    await site.bringToFront().catch(() => {});
    const cold = await h.popup({ surface: 'float' });
    await cold.waitForTimeout(2500);
    const coldIdle = await cold.evaluate(() => ({ status: document.getElementById('status').textContent.trim(), title: document.getElementById('status').getAttribute('title') }));
    check(coldIdle.status === '' && !coldIdle.title, `${tag}: idle popup on a not-allowed site shows no error text`, JSON.stringify(coldIdle));
    const fullH = await cold.evaluate(() => Math.round(document.getElementById('switch-card').getBoundingClientRect().height));
    await cold.click('.brand-name');
    await cold.waitForTimeout(500);
    const smallH = await cold.evaluate(() => Math.round(document.getElementById('switch-card').getBoundingClientRect().height));
    check(smallH < fullH && smallH <= 64, `${tag}: Asleep card collapses to one line after the first press (${fullH}px to ${smallH}px)`);
    const b1 = await box(cold, '#switch-card');
    await cold.waitForTimeout(3000);
    check(b1 === await box(cold, '#switch-card'), `${tag}: the collapsed card does not move by itself`);
    await cold.close();

    // The real session on the practice page (allowed without a grant).
    await practice.bringToFront().catch(() => {});
    const pop = await h.popup({ surface: 'float' });
    await pop.waitForTimeout(2500);
    const idle = await audit(pop);
    const idleStatus = await pop.evaluate(() => ({ status: document.getElementById('status').textContent.trim(), title: document.getElementById('status').getAttribute('title') }));
    check(idleStatus.status === '' && !idleStatus.title && !idle.lines.some((l) => /went wrong|tooltip|حدث خطأ|التلميح/.test(l)), `${tag}: idle popup on the practice page shows no error text`, JSON.stringify([idleStatus, idle.lines]));
    check(idle.rawKeys.length === 0 && idle.badText.length === 0, `${tag}: idle popup has no raw i18n key and no "undefined"/"NaN"`, JSON.stringify([idle.rawKeys, idle.badText]));
    const allowedH = await pop.evaluate(() => Math.round(document.getElementById('switch-card').getBoundingClientRect().height));
    check(allowedH <= 64, `${tag}: Asleep card is one line on an allowed site (${allowedH}px)`);
    check(await pop.evaluate(() => document.getElementById('switch').getAttribute('role') === 'switch' && !document.getElementById('wake-options')), `${tag}: the Asleep card is the one switch, no Options link`);

    // An unknown failure: one sentence, a visible button, no tooltip (rule 10).
    await pop.evaluate(() => sayFailure(new Error('E2E raw detail')));
    const failure = await pop.evaluate(() => { const s = document.getElementById('status'); return { text: s.textContent, title: s.getAttribute('title'), btn: !!s.querySelector('button.status-fix') }; });
    check(!/tooltip|التلميح/.test(failure.text) && !failure.title && failure.btn, `${tag}: an unknown failure has a visible Copy details button and no tooltip`, JSON.stringify(failure));
    await pop.evaluate(() => document.querySelector('#status button.status-fix')?.click());
    check(await until(() => pop.evaluate(() => window.__clip.includes('E2E raw detail')), 3000), `${tag}: Copy details copies the raw message`);
    await pop.reload();
    await pop.waitForFunction(() => document.body.dataset.ready === 'true');
    await pop.evaluate(() => { window.close = () => {}; window.__clip = []; navigator.clipboard.writeText = async (s) => { window.__clip.push(String(s)); }; });

    // The side-panel button.
    const hasApi = await h.worker.evaluate(() => typeof chrome.sidePanel?.open === 'function');
    const dock = await pop.evaluate(() => { const b = document.getElementById('dock'); return !!b && b.getClientRects().length > 0; });
    if (!hasApi) check(!dock, `${tag}: no chrome.sidePanel in this browser, so the button is hidden (not dead)`);
    else {
      check(dock, `${tag}: the side-panel button is shown where chrome.sidePanel exists`);
      if (dock && !forceHeadless()) {
        await pop.click('#dock');
        const opened = await until(() => h.worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }).then((c) => c.length)), 8000);
        check(!!opened, `${tag}: pressing the side-panel button opened a panel`, `contexts=${opened}`);
        const err = await pop.evaluate(() => document.getElementById('status').textContent.trim());
        check(!/went wrong|حدث خطأ/.test(err), `${tag}: no error after the side-panel press`, err);
      }
    }
    if (!hasApi) {
      const opts = await h.popup({ surface: 'popup', width: 900, height: 700, path: 'options/options.html' });
      await opts.waitForTimeout(1500);
      check(await opts.evaluate(() => !document.querySelector('#launchSurface option[value="panel"]')), `${tag}: Settings does not offer the side panel where there is none`);
      await opts.close();
    }
    if (engine === 'opera') { check(popupFaults().length === 0, `${tag}: no page error on the popup pages`, JSON.stringify(popupFaults())); return; }

    // The scan tool on the practice page: Chrome cannot script an extension page, and the sentence says so.
    await pop.click('#start');
    await pop.waitForSelector('#step-live:not([hidden])', { timeout: 20000 });
    await pop.evaluate(() => document.querySelector('[data-action="a11y"]').click());
    const scan = await until(() => pop.evaluate(() => { const s = document.getElementById('status'); return s.textContent.trim() && s.className.includes('err') ? { text: s.textContent, fix: [...s.querySelectorAll('button')].map((b) => b.textContent) } : null; }), 8000);
    check(!!scan && !/Cannot access|Extension manifest/.test(scan.text) && scan.fix.length === 0, `${tag}: the scan on an extension page gives a sentence, not Chrome's words, and no Open Settings button`, JSON.stringify(scan));

    // The practice page is the Bug Hunt game: play levels 1 to 4 (each plants one of the faults the passive checks find) by pressing what a player presses.
    await practice.bringToFront().catch(() => {});
    await reach(practice, 'play', 1);
    await practice.click('#save');                                   // level 1: "Saved" while the request fails
    await practice.waitForFunction(() => document.getElementById('save-state').textContent.length > 0);
    await reach(practice, 'play', 2);
    await practice.fill('#coupon', 'SAVE10');
    await practice.click('#apply');                                  // level 2: an uncaught error
    await reach(practice, 'play', 3);
    // A player reads the level first. Two things in content/checks.js make a dead press invisible if it comes too early: it ignores a press made while
    // three earlier ones are still being watched (inFlight), and it counts any visible change as the page reacting, including the game's own hint ring
    // (about 2 s on #fxLayer) being removed. Wait for both to be over.
    await practice.waitForTimeout(3000);
    await practice.waitForFunction(() => document.getElementById('fxLayer').children.length === 0, null, { timeout: 10000 });
    await practice.click('#next');                                   // level 3: a button that does nothing
    await practice.waitForTimeout(1800);
    await reach(practice, 'play', 4);                                // level 4: the order number runs out of its box
    await practice.waitForTimeout(2500);
    check(await practice.evaluate(() => { const r = document.getElementById('ref'); return r.scrollWidth > r.clientWidth; }), `${tag}: the game's level 4 really overflows (the precondition of fault 4)`);
    const hud = await practice.evaluate(() => document.getElementById('hudLevel').textContent.trim());
    check(hud.length > 0, `${tag}: the practice page is the Bug Hunt game and shows its level`, hud);

    await pop.click('#stop');
    await pop.waitForSelector('#step-done:not([hidden])', { timeout: 20000 });
    await pop.waitForSelector('#copy-report:not([disabled])');
    await pop.waitForTimeout(2000);
    const done = await pop.evaluate(() => ({ summary: document.getElementById('done-summary').textContent, tile: document.getElementById('stat-duration').textContent, problems: Number(document.getElementById('stat-problems').textContent), card: document.getElementById('switch-card').getBoundingClientRect().height }));
    check(done.problems >= 4, `${tag}: the done card counts at least the four planted problems (${done.problems})`);
    check(!UNTITLED.test(done.summary), `${tag}: the done card does not say "Untitled session" with problems found`, done.summary);
    check(secs(done.summary) != null && secs(done.summary) === secs(done.tile), `${tag}: the line and the Duration tile show the same time`, `${done.summary} vs ${done.tile}`);

    await pop.click('#copy-report');
    const report = await until(() => pop.evaluate(() => window.__clip[0] || ''));
    const title = (report || '').split('\n')[0];
    check(/^# /.test(title) && !UNTITLED.test(title), `${tag}: the copied report starts with a real title`, title);
    check(/POST \S*save-profile[^\n]*(500|network error)/.test(report), `${tag}: the report names the failed save request behind "Saved" (level 1)`);
    check(/Uncaught.*Cannot read properties of undefined/.test(report), `${tag}: the report names the uncaught coupon error (level 2)`);
    check(/(Click|نقر|انقر|اضغط)[^\n]*(Next step|الخطوة التالية)/.test(report), `${tag}: the report lists the Next step press in the steps`);
    check(/Click did nothing[^\n]*(Next step|الخطوة التالية)/.test(report), `${tag}: the report names the dead Next step button (level 3)`);
    check(/Text (overflows its box|is cut off)[^\n]*(FE|QAW)-2026/.test(report), `${tag}: the report names the order reference that runs out of its box (level 4)`);
    if (lang === 'en') {
      fs.mkdirSync(path.join(REPO, 'work', 'sdlc', 'pipeline-1014c', 'results'), { recursive: true });
      fs.writeFileSync(path.join(REPO, 'work', 'sdlc', 'pipeline-1014c', 'results', 'e2e-last-report.md'), report || '');
    }
    // The level's layout fault is still on the page, so a second session would find it again (the product is right): reload to the title screen first.
    await practice.reload();
    await practice.waitForSelector('#btnStart', { state: 'visible' });
    // Done with no problems: the clean line, the same time everywhere, a name in the tester's language, and no stale "Session saved." on the next card.
    await pop.click('#new-session');
    await pop.waitForSelector('#step-idle:not([hidden])');
    await pop.waitForTimeout(300);
    check(await pop.evaluate(() => document.getElementById('status').textContent.trim() === ''), `${tag}: "Start another" clears the old "Session saved." line`);
    await pop.click('#start');
    await pop.waitForSelector('#step-live:not([hidden])', { timeout: 20000 });
    await pop.waitForTimeout(1500);
    await pop.click('#stop');
    await pop.waitForSelector('#step-done:not([hidden])', { timeout: 20000 });
    await pop.waitForSelector('#copy-report:not([disabled])');
    await pop.waitForTimeout(2000);
    const clean = await pop.evaluate(() => ({ summary: document.getElementById('done-summary').textContent, tile: document.getElementById('stat-duration').textContent, line: document.getElementById('done-clean').textContent, name: QAWi18n.t('welcome.practice.title'), clean: !document.getElementById('done-clean').hidden }));
    check(clean.clean && secs(clean.summary) === secs(clean.tile) && secs(clean.line) === secs(clean.tile), `${tag}: clean session: the line, the tile and the "no problems" line show one time`, JSON.stringify(clean));
    check(clean.summary.includes(clean.name) && !UNTITLED.test(clean.summary), `${tag}: clean practice session is named "${clean.name}", in the tester's language`, clean.summary);
    check(popupFaults().length === 0, `${tag}: no page error on the popup pages`, JSON.stringify(popupFaults()));
  } finally {
    await h.close();
  }
}

try {
  check(fs.existsSync(path.join(EXTARG || builtExtension('chrome'), 'manifest.json')), `built extension present at ${EXTARG || builtExtension('chrome')}`);
  await scenario({ engine: 'chrome', lang: 'en' });
  await scenario({ engine: 'chrome', lang: 'ar' });
  if (forceHeadless() || !operaPath()) console.log(`  note  not verified on Opera GX (${forceHeadless() ? 'headless run' : 'no installed binary found'})`);
  else await scenario({ engine: 'opera', lang: 'en' });
} catch (err) {
  failures.push('run aborted');
  console.log(`  FAIL  run aborted: ${err.stack || err.message}`);
} finally {
  server.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
