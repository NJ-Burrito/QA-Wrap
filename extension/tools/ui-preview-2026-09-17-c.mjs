/* QA Wrap — UI preview reshoot after c5b773b + a3b17f2 (design review 2026-09-17). Copy of ui-preview-2026-09-17-b.mjs with output dir only changed. */
/**
 * Screenshots the requested surface/state matrix into
 * work/ui-preview-2026-09-17/, with its own profile under
 * work/ui-preview-2026-09-17/profile/ (per the brief, not the shared
 * work/profiles/ dir). Real Chrome (channel: 'chrome'), one capture pass,
 * no retries beyond the documented hang rule.
 *
 *   node tools/ui-preview-2026-09-17.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { seedConsent, awaitSiteScripts, grantedExtension } from './lib-granted.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
// R01 fix (2/2): loaded as-shipped, <all_urls> is optional, granted only by a
// bubble Playwright cannot click. grantedExtension() builds a byte-identical
// copy with the permission moved into the required list — the state a tester's
// browser is in one press after they grant it. See lib-granted.mjs.
const GRANTED_EXT = grantedExtension({ label: 'ui-preview-c' });
const REPO = path.resolve(EXT, '..');
const OUT = path.join(REPO, 'work', 'ui-preview-2026-09-17-d');
const PROFILE = path.join(OUT, 'profile');

fs.mkdirSync(OUT, { recursive: true });

const gaps = [];
const index = [];

/*
 * DEVIATION FROM BRIEF: channel: 'chrome' (real, stable Chrome 152) refuses to
 * load an unpacked extension via --load-extension at all — verified directly:
 * context.serviceWorkers() and backgroundPages() both stay empty for 5s after
 * launch, on a clean profile, with and without
 * --disable-features=DisableLoadExtensionCommandLineSwitch. This is Google's
 * mid-2025 stable-channel restriction on command-line unpacked extension
 * loading; no chrome-beta/dev/canary channel is installed on this machine to
 * fall back to. Falling back to channel: 'chromium' (Playwright's bundled
 * Chromium) instead — the same channel every other tool in this directory
 * (ui-shots.mjs, i18n-shots.mjs, lib-launch.mjs) already uses for this exact
 * reason. Environment cause, not a tooling or context error.
 */
function launchOpts({ width = 1280, height = 900 } = {}) {
  return {
    headless: false,
    channel: 'chromium',
    viewport: { width, height },
    args: [
      `--disable-extensions-except=${GRANTED_EXT}`,
      `--load-extension=${GRANTED_EXT}`,
      `--window-size=${width},${height}`,
      '--window-position=60,60',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,MediaRouter',
    ],
  };
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title></head>
<body><h1>Application form</h1>
<label for="applicant">Applicant name</label><input id="applicant" type="text" maxlength="40"/>
<label for="pw">Password</label><input id="pw" type="password"/>
<button id="submit" type="button">Submit application</button><div id="r"></div>
<script>document.getElementById('submit').onclick=async()=>{
  const res=await fetch('/api/applications',{method:'POST',body:'{}'});
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

purgeWorkerCache(PROFILE);

const context = await chromium.launchPersistentContext(PROFILE, launchOpts());

async function shoot(name, target, note, opts = {}) {
  const file = path.join(OUT, `${name}.png`);
  await target.screenshot({ path: file, ...opts });
  index.push({ name, note });
  console.log(`  ${name}.png`);
}

async function setThemeLang(pg, theme, lang) {
  await pg.emulateMedia({ colorScheme: theme === 'light' ? 'light' : 'dark' });
  await pg.evaluate(({ theme, lang }) => {
    try { localStorage.setItem('qaw-theme', theme); } catch {}
    try { localStorage.setItem('qaw-lang', lang); } catch {}
    try { localStorage.setItem('qaw-tutorial-seen', '1'); } catch {}
  }, { theme, lang });
}

async function setMode(pg, mode) {
  await pg.evaluate((m) => { try { localStorage.setItem('qaw-mode', m); } catch {} }, mode);
}

try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;

  // NEW STATE: not-consented first run — tool wall behind the consent gate,
  // dimmed and inert. Must be shot before seedConsent() runs.
  try {
    const gate = await context.newPage();
    await gate.setViewportSize({ width: 380, height: 640 });
    await gate.goto(`chrome-extension://${id}/popup/popup.html`);
    await setThemeLang(gate, 'dark', 'en');
    await gate.reload();
    await gate.waitForTimeout(700);
    await shoot('popup-dark-en-firstrun', gate, 'Popup first run, before consent — tool wall dimmed and inert behind the consent gate, dark, EN.');
    await gate.close();
  } catch (e) {
    gaps.push(`popup first-run (not-consented): ${e.message}`);
  }

  // R01 fix: nothing behind the first-run gate renders until consent is
  // seeded, and no site script has run until this settles either.
  await seedConsent(worker);
  await awaitSiteScripts(worker);

  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });

  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);

  const tabId = await ctl.evaluate(
    async (o) => (await chrome.tabs.query({ url: `${o}/*` }))[0]?.id ?? null,
    origin
  );

  const woke = await call({ type: 'UQA_ARM' });
  if (!woke?.ok) throw new Error(`could not wake the extension: ${JSON.stringify(woke)}`);
  await page.waitForTimeout(400);

  // NEW STATE: report with no session seeded — delete/save disabled, Overview
  // shows a real empty state instead of blank tiles. Must be shot before
  // UQA_START creates a session.
  try {
    const repEmpty = await context.newPage();
    await repEmpty.setViewportSize({ width: 1100, height: 900 });
    await repEmpty.goto(`chrome-extension://${id}/report/report.html`);
    await setThemeLang(repEmpty, 'dark', 'en');
    await repEmpty.reload();
    await repEmpty.waitForTimeout(1000);
    await shoot('report-dark-en-empty', repEmpty, 'Report page, no session seeded — delete/save disabled, Overview empty state, dark, EN.');
    await repEmpty.close();
  } catch (e) {
    gaps.push(`report empty state: ${e.message}`);
  }

  await call({
    type: 'UQA_START',
    charter: 'Application submit returns 500',
    tabId,
    startUrl: `${origin}/`,
    timeboxMinutes: 30,
    env: { viewport: '1280×900 @1x', userAgent: 'Chrome/126', platform: 'Win32', language: 'en' },
  });
  await page.waitForTimeout(400);
  await page.fill('#applicant', 'Nader');
  await page.fill('#pw', 'hunter2');
  await page.click('#submit');
  await page.waitForTimeout(1000);
  await call({ type: 'UQA_CAPTURE', text: 'Error state after submit' });
  await call({ type: 'UQA_NOTE', text: 'Submit 500s on an expired document.', tag: 'bug' });
  await call({ type: 'UQA_SCAN_A11Y', tabId });
  await call({ type: 'UQA_SCAN_PERF', tabId });

  /* ── popup: simple/expert x dark/light x en/ar (8) ───────────────────── */
  for (const theme of ['dark', 'light']) {
    for (const lang of ['en', 'ar']) {
      for (const mode of ['simple', 'expert']) {
        await ctl.setViewportSize({ width: 380, height: 640 });
        await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
        await setThemeLang(ctl, theme, lang);
        await setMode(ctl, mode);
        await ctl.reload();
        await ctl.waitForTimeout(700);
        await shoot(`popup-${theme}-${lang}-${mode}`, ctl, `Popup, ${mode} mode, ${theme} theme, ${lang}.`);
      }
    }
  }

  /* ── report page: dark/light x en/ar (4) + one scrolled per combo ───── */
  for (const theme of ['dark', 'light']) {
    for (const lang of ['en', 'ar']) {
      const rep = await context.newPage();
      await rep.setViewportSize({ width: 1100, height: 900 });
      await rep.goto(`chrome-extension://${id}/report/report.html`);
      await setThemeLang(rep, theme, lang);
      await rep.reload();
      await rep.waitForTimeout(1200);
      await shoot(`report-${theme}-${lang}-top`, rep, `Report page top, ${theme}, ${lang}.`);
      await rep.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await rep.waitForTimeout(400);
      await shoot(`report-${theme}-${lang}-scrolled`, rep, `Report page scrolled — charts and section list, ${theme}, ${lang}.`);
      await rep.close();
    }
  }

  /* ── options / settings: dark/light x en (2) ─────────────────────────── */
  for (const theme of ['dark', 'light']) {
    const optsPage = await context.newPage();
    await optsPage.setViewportSize({ width: 900, height: 1000 });
    await optsPage.goto(`chrome-extension://${id}/options/options.html`);
    await setThemeLang(optsPage, theme, 'en');
    await optsPage.reload();
    await optsPage.waitForTimeout(900);
    await shoot(`options-${theme}-en-default`, optsPage, `Options / settings page, ${theme}.`, { fullPage: true });
    await optsPage.close();
  }

  // NEW STATE: Settings is now twelve tabbed panels — default tab + one other.
  try {
    const tabsPage = await context.newPage();
    await tabsPage.setViewportSize({ width: 900, height: 1000 });
    await tabsPage.goto(`chrome-extension://${id}/options/options.html`);
    await setThemeLang(tabsPage, 'dark', 'en');
    await tabsPage.reload();
    await tabsPage.waitForTimeout(900);
    await shoot('options-dark-en-tab1', tabsPage, 'Options, default tab (Language), dark, EN.', { fullPage: true });
    await tabsPage.click('#tab-sec-sessions');
    await tabsPage.waitForTimeout(500);
    await shoot('options-dark-en-tab2', tabsPage, 'Options, Sessions tab, dark, EN.', { fullPage: true });
    await tabsPage.close();
  } catch (e) {
    gaps.push(`options tabs: ${e.message}`);
  }

  /* ── side panel: dark x en (1) ───────────────────────────────────────── */
  try {
    const sp = await context.newPage();
    await sp.setViewportSize({ width: 380, height: 700 });
    await sp.goto(`chrome-extension://${id}/sidepanel/sidepanel.html`);
    await setThemeLang(sp, 'dark', 'en');
    await sp.reload();
    await sp.waitForTimeout(900);
    await shoot('sidepanel-dark-en-default', sp, 'Side panel, dark theme, EN.');
    await sp.close();
  } catch (e) {
    gaps.push(`side panel: ${e.message}`);
  }

  /* ── devtools panel: dark x en (1) — driven as a plain extension page ─── */
  try {
    const panel = await context.newPage();
    // R12: 600×400 is a shape a real DevTools drawer actually takes, to see
    // whether the toolbar wraps.
    await panel.setViewportSize({ width: 600, height: 400 });
    await panel.goto(`chrome-extension://${id}/devtools/panel.html`);
    await setThemeLang(panel, 'dark', 'en');
    await panel.reload();
    await panel.waitForTimeout(1200);
    await shoot('devtools-panel-dark-en-default', panel, 'DevTools panel, dark theme, EN (opened as a plain extension page, not via a real DevTools host).');
    await panel.close();
  } catch (e) {
    gaps.push(`devtools panel: ${e.message}`);
  }

  /* ── content overlay + picker on a neutral test page: dark x en (2) ──── */
  await page.bringToFront();
  await page.evaluate(() => { try { localStorage.setItem('qaw-theme', 'dark'); } catch {} });
  await call({ type: 'UQA_INJECT' });
  await page.waitForTimeout(400);
  await page.click('#applicant');
  await page.waitForTimeout(700);
  await shoot('overlay-dark-en-idle', page, 'Content overlay injected on the neutral test page, idle, dark theme, EN.');

  try {
    await call({ type: 'UQA_PICK' });
    await page.waitForTimeout(300);
    await page.hover('#submit');
    await page.waitForTimeout(500);
    await shoot('overlay-dark-en-picker-active', page, 'Picker box active over the Submit button, dark theme, EN.');
    await call({ type: 'UQA_PICK_OFF' });
  } catch (e) {
    gaps.push(`picker active state: ${e.message}`);
  }

  console.log(`\n${index.length} screenshots in ${OUT}`);
} catch (e) {
  gaps.push(`fatal: ${e.message}`);
  console.error(e);
} finally {
  await context.close();
  server.close();
}

const lines = [
  '# UI preview — 2026-09-17-b (rebuilt UI, commit c5b773b)',
  '',
  '| file | shows |',
  '|---|---|',
  ...index.map((i) => `| ${i.name}.png | ${i.note} |`),
  '',
  '## Gaps (matrix cells not captured)',
  ...(gaps.length ? gaps.map((g) => `- ${g}`) : ['- none']),
];
fs.writeFileSync(path.join(OUT, 'INDEX.md'), lines.join('\n') + '\n');
console.log('Gaps:', gaps.length ? gaps : 'none');
