/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Screenshots the extension's own surfaces, light and dark, for UI review.
 *
 *   node tools/ui-shots.mjs [outDir]
 *   node tools/ui-shots.mjs --lang=ar [outDir]   # T-058: the same session read in Arabic (default out: <UI_SHOTS>/ar-store)
 *
 * Seeds a realistic session first, because an empty panel tells you nothing
 * about whether the layout works.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { profile, UI_SHOTS } from './lib-paths.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from './lib-granted.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const ARGS = process.argv.slice(2);
const AR = ARGS.includes('--lang=ar'); // T-058: the Arabic pass, own folder and own profile so the English set is never mixed in
const OUT = path.resolve(ARGS.find((a) => !a.startsWith('--')) || (AR ? path.join(UI_SHOTS, 'ar-store') : UI_SHOTS));
const PROFILE = profile(process.env.UQA_TAG ? `.ui-shots-${process.env.UQA_TAG}-${AR ? 'ar-' : ''}profile` : AR ? '.ui-shots-ar-profile' : '.ui-shots-profile');
// The session the tester wrote, in the language they read it in. The fixture page stays English: it is the site under test.
const CHARTER = AR ? 'إرسال الطلب يعيد الخطأ 500' : 'Application submit returns 500';
const N_CAPTURE = AR ? 'حالة الخطأ بعد الإرسال' : 'Error state after submit';
const N_BUG = AR ? 'الإرسال يعيد 500 عند انتهاء صلاحية المستند.' : 'Submit 500s on an expired document.';
const N_ISSUE = AR ? 'احتجت حسابا تجريبيا جديدا للوصول إلى هنا.' : 'Needed a fresh test account to get here.';

fs.mkdirSync(OUT, { recursive: true });

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title></head>
<body><h1>Application form</h1>
<label for="applicant">Applicant name</label><input id="applicant" type="text" maxlength="40"/>
<label for="pw">Password</label><input id="pw" type="password"/>
<button id="submit" type="button">Submit application</button><div id="r"></div>
<script>document.getElementById('submit').onclick=async()=>{
  const res=await fetch('/api/applications',{method:'POST',body:'{}'});
  if(!res.ok)console.error('Submit failed: '+res.status);
  document.getElementById('r').textContent='status '+res.status;};</script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"NullPointerException at ApplicationService.submit"}');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// Chrome will happily run a cached worker from a previous build against the
// current manifest, so a handler added since simply is not there.
purgeWorkerCache(PROFILE);

// The shipping package with the site grant a tester's Allow press gives; a fresh profile has none, and with none the session never starts.
const context = await chromium.launchPersistentContext(PROFILE, launchOptions(grantedExtension({ label: 'ui-shots' })));
await keepOnTop(context); // test window stays above others; released on close

try {
  const worker = await freshWorker(context);
  await awaitSiteScripts(worker);
  const id = new URL(worker.url()).host;
  await seedConsent(worker); // the notice gates the popup; a store shot shows the tools

  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });

  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);

  const dirOf = AR ? 'rtl' : 'ltr';
  /** R15: a shot of the wrong language is a silent failure, so each Arabic surface asserts it booted RTL first. */
  const expectDir = async (pg, label) => {
    await pg.waitForFunction((d) => document.documentElement.dir === d, dirOf, { timeout: 8000 }).catch(() => {});
    const got = await pg.evaluate(() => document.documentElement.dir);
    if (got !== dirOf) throw new Error(`${label}: dir is "${got}", expected "${dirOf}"`);
  };

  const tabId = await ctl.evaluate(
    async (o) => (await chrome.tabs.query({ url: `${o}/*` }))[0]?.id ?? null,
    origin
  );

  // The extension is asleep on a fresh profile, by design.
  const woke = await call({ type: 'UQA_ARM' });
  if (!woke?.ok) throw new Error(`could not wake the extension: ${JSON.stringify(woke)}`);
  await page.waitForTimeout(400);

  // Seed a session with something worth looking at.
  const started = await call({
    type: 'UQA_START',
    charter: CHARTER,
    tabId,
    startUrl: `${origin}/`,
    timeboxMinutes: 30,
    env: { viewport: '1280×900 @1x', userAgent: 'Chrome/126', platform: 'Win32', language: 'ar-JO' },
  });
  if (!started?.ok) throw new Error(`could not start the session: ${JSON.stringify(started)}`); // R15: a report with no session is not a shot
  await page.waitForTimeout(400);
  await page.bringToFront();
  await page.fill('#applicant', 'ACME Demo');
  await page.fill('#pw', 'hunter2');
  await page.click('#submit');
  await page.waitForTimeout(1200);
  await call({ type: 'UQA_CAPTURE', text: N_CAPTURE });
  await call({ type: 'UQA_NOTE', text: N_BUG, tag: 'bug' });
  await call({ type: 'UQA_NOTE', text: N_ISSUE, tag: 'issue' });
  await call({ type: 'UQA_SCAN_A11Y', tabId });
  await call({ type: 'UQA_SCAN_PERF', tabId });

  if (AR) {
    // Chosen the way a tester chooses it: the durable copy for the other surfaces and the bar, the mirror for the first paint.
    await ctl.evaluate(() => new Promise((r) => {
      try { localStorage.setItem('qaw-lang', 'ar'); } catch { /* no storage */ }
      chrome.storage.sync.set({ qawLanguage: 'ar' }, r);
    }));
  }
  const shots = [];
  async function shoot(name, target, opts = {}) {
    const file = path.join(OUT, `${name}.png`);
    await target.screenshot({ path: file, ...opts });
    shots.push(name);
    console.log(`  ${name}.png`);
  }

  for (const theme of ['light', 'dark']) {
    await ctl.emulateMedia({ colorScheme: theme });

    // Popup, recording.
    await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
    await ctl.setViewportSize({ width: 380, height: 620 });
    // The first-run pointer to the tutorials is real, but a store screenshot
    // should show the product working, not the sign that points at the films.
    await ctl.evaluate(() => { try { localStorage.setItem('qaw-tutorial-seen', '1'); } catch { /* no storage */ } });
    await ctl.reload();
    await ctl.waitForTimeout(700);
    await expectDir(ctl, 'popup');
    await shoot(`popup-recording-${theme}`, ctl);

    // Scrolled to the bottom: the topper must still be there. That is the whole
    // point of the split, and a screenshot is the only way to see it held.
    await ctl.evaluate(() => document.getElementById('body').scrollTo(0, 9999));
    await ctl.waitForTimeout(250);
    await shoot(`popup-scrolled-${theme}`, ctl);
    await ctl.evaluate(() => document.getElementById('body').scrollTo(0, 0));

    // (The per-tool help shot is gone: the tools now live in a collapsed sheet.)

    // Popup, stopped (export visible).
    await call({ type: 'UQA_STOP' });
    await ctl.reload();
    await ctl.waitForTimeout(700);
    await shoot(`popup-stopped-${theme}`, ctl);

    // Settings page.
    const optsPage = await context.newPage();
    await optsPage.emulateMedia({ colorScheme: theme });
    await optsPage.setViewportSize({ width: 900, height: 1000 });
    await optsPage.goto(`chrome-extension://${id}/options/options.html`);
    await optsPage.waitForTimeout(900);
    await shoot(`options-${theme}`, optsPage, { fullPage: true });
    await optsPage.close();

    // Report viewer.
    const rep = await context.newPage();
    await rep.emulateMedia({ colorScheme: theme });
    await rep.setViewportSize({ width: 1100, height: 900 });
    await rep.goto(`chrome-extension://${id}/report/report.html`);
    await rep.waitForTimeout(1200);
    await expectDir(rep, 'report');
    await shoot(`report-${theme}`, rep);

    // Each tab is a different answer to a different question, so each one is
    // worth its own picture — a review that only ever sees Overview would not
    // notice the failure cards regressing.
    // R15: the failure tab is the hero and enables only once the session has loaded; a shot taken before that has no failure in it.
    await rep.waitForSelector('[data-tab="broke"]:not([disabled])', { timeout: 15000 });
    for (const tab of ['broke', 'timeline', 'media', 'quality', 'file', 'raw']) {
      if (!(await rep.locator(`[data-tab="${tab}"]`).first().isVisible())) continue; // a tab that is hidden for this session is not a shot
      await rep.click(`[data-tab="${tab}"]`);
      await rep.waitForTimeout(500);
      await shoot(`report-${tab}-${theme}`, rep, { fullPage: true });
    }
    await rep.close();

    // The workflow diagram, drawn from the same session.
    //
    // It is the only surface that produces something meant to leave the
    // browser as a document — A4, printed, pasted into a test plan — so it is
    // reviewed like every other page rather than trusted because the suite
    // says the boxes exist.
    const sid = await ctl.evaluate(
      () => new Promise((r) => chrome.storage.session.get('lastSessionId', (v) => r(v.lastSessionId)))
    );
    if (sid) {
      const dia = await context.newPage();
      await dia.emulateMedia({ colorScheme: theme });
      await dia.setViewportSize({ width: 1400, height: 900 });
      await dia.goto(`chrome-extension://${id}/diagram/diagram.html?session=${sid}`);
      await dia.waitForFunction(() => document.querySelectorAll('#sheet [data-node]').length > 0, null, { timeout: 12000 })
        .catch(() => {});
      await dia.waitForTimeout(700);
      await shoot(`diagram-${theme}`, dia);
      await dia.close();
    } else {
      console.log('  (no session — diagram skipped)');
    }

    // Panel.
    const panel = await context.newPage();
    await panel.emulateMedia({ colorScheme: theme });
    await panel.setViewportSize({ width: 1180, height: 820 });
    await panel.goto(`chrome-extension://${id}/devtools/panel.html`);
    await panel.waitForTimeout(1200);
    await shoot(`panel-${theme}`, panel);
    await panel.close();

    if (theme === 'light') {
      // The dark pass needs a session with the SAME content, not just a session.
      // Restarting an empty one made every dark screenshot show empty states,
      // which is exactly the theme nobody could then review.
      await call({
        type: 'UQA_START',
        charter: CHARTER,
        tabId,
        startUrl: `${origin}/`,
        timeboxMinutes: 30,
      });
      await page.bringToFront();
      await page.fill('#applicant', 'ACME Demo');
      await page.fill('#pw', 'hunter2');
      await page.click('#submit');
      await page.waitForTimeout(1200);
      await call({ type: 'UQA_CAPTURE', text: N_CAPTURE });
      await call({ type: 'UQA_NOTE', text: N_BUG, tag: 'bug' });
      await call({ type: 'UQA_NOTE', text: N_ISSUE, tag: 'issue' });
      await call({ type: 'UQA_SCAN_A11Y', tabId });
      await call({ type: 'UQA_SCAN_PERF', tabId });
      await ctl.waitForTimeout(300);
    }
  }

  // In-page surfaces. T-058: a live session with a real failure, so the bar carries its problems chip.
  await call({ type: 'UQA_START', charter: CHARTER, tabId, startUrl: `${origin}/`, timeboxMinutes: 30 });
  await page.bringToFront();
  await page.fill('#applicant', 'ACME Demo');
  await page.click('#submit');
  await page.waitForTimeout(1200);
  await call({ type: 'UQA_INJECT' });
  await page.waitForTimeout(1800);
  await page.click('#submit');
  await page.waitForTimeout(2200);
  await page.setViewportSize({ width: 1280, height: 560 }); // the bar rides the bottom edge: a short window puts it beside the form, inside the board
  await page.waitForTimeout(1500);
  await page.mouse.move(240, 522); // the bar rests faint until the pointer is on it
  await page.waitForTimeout(900);
  // The fills above left the value palette's "Esc cancels" hint over the form; it is not what this shot is about, and its text is English on the Arabic pass.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  // R15: the bar is drawn in a closed root, so ask it. It must exist, face the language's direction, and the pointer must have woken it.
  const probe = await ctl.evaluate((t) => new Promise((r) => chrome.tabs.sendMessage(t, { type: 'UQA_UI_HIDE', hidden: false, measure: true }, (res) => { void chrome.runtime.lastError; r(res || null); })), tabId);
  if (!(probe?.bar?.width > 0) || probe.dir !== dirOf) throw new Error(`inpage-bar: not ready (${JSON.stringify({ bar: probe?.bar, dir: probe?.dir })})`);
  await shoot('inpage-bar', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(600);
  await page.click('#applicant');
  await page.waitForTimeout(700);
  await shoot('inpage-palette', page);

  // T-058: the filing dialog, with a tracker set up. Access to the host is the browser's own prompt, so the
  // page reports it granted; the shot shows the dialog the tester sees after pressing Allow.
  await call({ type: 'UQA_STOP' });
  await call({ type: 'UQA_SET_SETTINGS', patch: { jira: { baseUrl: 'https://acme.atlassian.net', token: 'x', project: 'APP', email: 'qa@acme.example' } } });
  const fil = await context.newPage();
  await fil.emulateMedia({ colorScheme: 'light' });
  await fil.setViewportSize({ width: 1100, height: 900 });
  await fil.addInitScript(() => { try { chrome.permissions.contains = async () => true; } catch { /* kept */ } });
  await fil.goto(`chrome-extension://${id}/report/report.html`);
  await fil.waitForTimeout(1200);
  await fil.click('#btn-file');
  await fil.click('[data-file="jira"]');
  await fil.waitForTimeout(1500);
  await expectDir(fil, 'filing');
  if (!(await fil.locator('#dlg-file[open]').count())) throw new Error('filing: the dialog is not open');
  await shoot('report-filing', fil);
  await fil.close();

  console.log(`\n${shots.length} screenshots in ${OUT}`);
} finally {
  await context.close();
  server.close();
}
