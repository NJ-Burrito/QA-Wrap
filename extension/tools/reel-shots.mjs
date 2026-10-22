/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Captures for the pick-purpose reel: the real product, dark, at 2x.
 *
 *   node tools/reel-shots.mjs <outDir> [picks|commercial|tools]
 *
 * One walk through a sign-in fixture with the picker: a glow per purpose, a
 * Shift basket, three filed picks, then the report's Selectors tab and the
 * locator sheet exactly as the Raw tab builds it. Nothing is asserted; these
 * are pictures for a person, and the harness is `tools/i18n-shots.mjs`'s.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from './lib-granted.mjs';
import { profile } from './lib-paths.mjs';

const OUT = path.resolve(process.argv[2] || 'reel-shots');
const WALK = process.argv[3] || 'picks';
fs.mkdirSync(OUT, { recursive: true });
const EXT = grantedExtension({ label: 'reel-shots' });
// UQA_PROFILE_SUFFIX lets two runs share a machine: one Chromium profile cannot be opened twice.
const PROFILE = profile('.reel-shots-profile' + (process.env.UQA_PROFILE_SUFFIX || ''));

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Northwind: sign in</title>
<style>
  body{margin:0;background:#0f1216;color:#e8eaed;font:16px/1.4 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
  main{width:400px;padding:36px;background:#181c22;border:1px solid #2a2f37;border-radius:16px}
  h1{margin:0 0 6px;font-size:28px} p{margin:0 0 24px;color:#9aa3ad}
  label{display:block;margin:16px 0 6px;font-size:14px;color:#c3c9d0}
  input{width:100%;box-sizing:border-box;padding:13px 14px;border-radius:10px;border:1px solid #343a43;background:#0f1216;color:#e8eaed;font-size:16px}
  button{margin-top:26px;width:100%;padding:14px;border:0;border-radius:10px;background:#3b82f6;color:#fff;font-size:16px;font-weight:600}
  #secret{margin-top:22px;padding:12px 14px;border-radius:10px;background:#0f1216;border:1px dashed #343a43;font-family:ui-monospace,monospace;font-size:14px}
</style></head>
<body><main>
<h1 id="welcome">Welcome back</h1><p>Sign in to your Northwind account.</p>
<p id="owner" style="margin:-12px 0 8px;color:#e8eaed">Account holder: <b id="holder">Layla Haddad</b></p>
<label for="email">Email</label><input id="email" type="email" placeholder="you@northwind.test"/>
<label for="password">Password</label><input id="password" type="password"/>
<button id="signin" type="button">Sign in</button>
<div id="secret" aria-label="Recovery code">Recovery code: 4417-2290-ALFA</div>
<p id="result" role="status" style="margin:16px 0 0;color:#ff6b6b;font-weight:600;min-height:22px"></p>
<p style="margin:10px 0 0;font-size:13px"><a href="/help/reset" style="color:#7fb0ff">Forgot your password?</a> <img src="/logo.png" width="1" height="1"></p>
<script>document.getElementById("signin").onclick=async()=>{const r=await fetch("/api/login",{method:"POST",body:"{}"});document.getElementById("result").textContent=r.ok?"":"Something went wrong ("+r.status+"). Try again.";};</script>
</main></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
  if (req.url !== '/') { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, {
  ...launchOptions(EXT, { width: 600, height: 860 }),
  colorScheme: 'dark',
  deviceScaleFactor: 2,
});
await keepOnTop(context); // test window stays above others; released on close
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot', name);
};

try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  await awaitSiteScripts(worker);

  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
  await ctl.evaluate(() => { try { localStorage.setItem('qaw-tutorial-seen', '1'); } catch { /* no storage */ } });
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const tabId = await ctl.evaluate(async (o) => (await chrome.tabs.query({ url: `${o}/*` }))[0]?.id ?? null, origin);

  const popup = async (name, before) => {
    await ctl.setViewportSize({ width: 380, height: 640 });
    await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
    await ctl.waitForTimeout(900);
    if (before) await before();
    await shot(ctl, name);
  };
  if (WALK === 'commercial') await popup('c01-popup-asleep');

  const woke = await call({ type: 'UQA_ARM' });
  if (!woke?.ok) throw new Error(`could not wake the extension: ${JSON.stringify(woke)}`);
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const CHARTER = WALK === 'commercial' ? 'Sign-in fails after submit' : 'Sign in, picked for automation';
  if (WALK === 'commercial') await popup('c02-popup-named', () => ctl.fill('#charter', CHARTER).catch(() => {}));
  await call({
    type: 'UQA_START', charter: CHARTER, tabId, startUrl: `${origin}/`,
    env: { viewport: '600×860 @2x', userAgent: 'Chrome', platform: 'Win32', language: 'en' },
  });
  await page.waitForTimeout(400);

  if (WALK === 'picks') {
  /* the popup, open on a running session */
  await ctl.setViewportSize({ width: 380, height: 640 });
  await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
  await ctl.waitForTimeout(900);
  await shot(ctl, '01-popup');

  /* one glow per purpose, the bar lit to match */
  await page.bringToFront();
  const hover = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    await page.mouse.move(b.x + b.width / 2 - 8, b.y + b.height / 2, { steps: 6 });
    await page.waitForTimeout(450);
  };
  const looks = [['any', '#email'], ['step', '#signin'], ['element', '#welcome'], ['sensitive', '#secret']];
  for (const [purpose, sel] of looks) {
    await call({ type: 'UQA_PICK', tabId, purpose });
    await page.waitForTimeout(350);
    await hover(sel);
    await shot(page, `02-glow-${purpose}`);
  }

  /* Shift takes several; Enter copies them and files them */
  await call({ type: 'UQA_PICK', tabId, purpose: 'step' });
  await page.keyboard.down('Shift');
  let n = 0;
  for (const sel of ['#email', '#password', '#signin']) {
    await hover(sel);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(350);
    await shot(page, `03-basket-${++n}`);
  }
  await page.keyboard.up('Shift');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);

  /* one plain click each: copies one and stops */
  for (const [purpose, sel] of [['element', '#welcome'], ['sensitive', '#secret']]) {
    await call({ type: 'UQA_PICK', tabId, purpose });
    await page.waitForTimeout(350);
    await hover(sel);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(900);
    await shot(page, `04-after-${purpose}`);
  }

  await call({ type: 'UQA_STOP' });
  await page.waitForTimeout(1200);

  /* the report: Selectors tab, then the locator sheet as Raw builds it */
  const rep = await context.newPage();
  await rep.setViewportSize({ width: 600, height: 1000 });
  await rep.goto(`chrome-extension://${id}/report/report.html`);
  await rep.waitForTimeout(1800);
  await rep.click('[data-tab="selectors"]');
  await rep.waitForTimeout(800);
  await shot(rep, '05-selectors');
  await rep.screenshot({ path: path.join(OUT, '05-selectors-full.png'), fullPage: true });
  const sens = rep.locator('.selcopy-card').filter({ hasText: /sensitive/i }).first();
  if (await sens.count()) { await sens.scrollIntoViewIfNeeded(); await sens.screenshot({ path: path.join(OUT, '06-sensitive-card.png') }); console.log('shot 06-sensitive-card'); }

  await rep.click('[data-tab="raw"]');
  await rep.selectOption('#format', 'locator-sheet');
  await rep.waitForTimeout(1500);
  const sheet = await rep.evaluate(() => document.getElementById('content')?.innerText || '');
  fs.writeFileSync(path.join(OUT, '07-locators.md'), sheet, 'utf8');
  await shot(rep, '07-locator-sheet');
  console.log(`sheet ${sheet.length} chars`);
  }

  if (WALK === 'tools') {
    /* All nineteen tools live in Expert. The popup scrolls inside #body, so for ONE
       picture of the whole wall the clip is lifted and the page is shot full length;
       the stepped shots beside it are the popup exactly as it draws. */
    await popup('t00', async () => { await ctl.getByText('Expert', { exact: true }).first().click().catch(() => {}); await ctl.waitForTimeout(600); });
    for (const [k, y] of [[1, 420], [2, 840], [3, 1260], [4, 1680], [5, 2100], [6, 99999]]) {
      await ctl.evaluate((top) => document.getElementById('body')?.scrollTo(0, top), y);
      await ctl.waitForTimeout(300);
      await shot(ctl, `t0${k}`);
    }
    await ctl.addStyleTag({ content: 'html,body{height:auto!important;max-height:none!important;overflow:visible!important}#body{overflow:visible!important;max-height:none!important;height:auto!important;flex:none!important}' });
    await ctl.waitForTimeout(400);
    await ctl.screenshot({ path: path.join(OUT, 't-wall-full.png'), fullPage: true });
    console.log('shot t-wall-full');
    await call({ type: 'UQA_STOP' });
  }

  if (WALK === 'commercial') {
    const hover = async (sel) => {
      const b = await page.locator(sel).boundingBox();
      await page.mouse.move(b.x + b.width / 2 - 8, b.y + b.height / 2, { steps: 6 });
      await page.waitForTimeout(450);
    };
    const press = async () => { await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(700); };
    await popup('c03-popup-live');

    /* the whole tool wall in one picture: the popup drawn tall enough not to scroll */
    await ctl.setViewportSize({ width: 380, height: 3200 });
    await ctl.waitForTimeout(600);
    await shot(ctl, 'c04-popup-tools-tall');

    /* a working sign-in, recorded */
    await page.bringToFront();
    await page.fill('#email', 'layla@northwind.test');
    await page.fill('#password', 'correct-horse');
    await page.click('#signin');
    await page.waitForTimeout(800);
    await shot(page, 'c05-page-works');

    /* Break a request: the real tool, one rule, and the same press now fails */
    const rule = await call({ type: 'UQA_ADD_RULE', tabId, rule: { label: 'Sign-in answers 500', enabled: true, pattern: '/api/login', action: 'status', status: 500, remaining: 3 } });
    console.log('rule', JSON.stringify(rule).slice(0, 120));
    await page.waitForTimeout(500);
    await page.click('#signin');
    await page.waitForTimeout(1200);
    await shot(page, 'c06-page-broken');
    await call({ type: 'UQA_CAPTURE', text: 'Sign-in shows an error after submit' });
    await call({ type: 'UQA_NOTE', text: 'Sign-in answers 500 and the page only says "try again".', tag: 'bug' });

    /* the three checks the narration names */
    for (const type of ['UQA_SCAN_A11Y', 'UQA_SCAN_PERF', 'UQA_CHECK_LINKS']) {
      const r = await call({ type, tabId });
      console.log(type, JSON.stringify(r ?? null).slice(0, 100));
    }

    /* Mask real data: click the name, a block covers it */
    await call({ type: 'UQA_MASK_PICK', tabId });
    await page.waitForTimeout(400);
    await hover('#holder');
    await shot(page, 'c07-mask-aim');
    await press();
    await page.keyboard.press('Escape');
    await page.mouse.move(40, 40);
    await page.waitForTimeout(500);
    await shot(page, 'c08-masked');

    /* Copy a locator: the glow, then one click */
    await call({ type: 'UQA_PICK', tabId, purpose: 'step' });
    await page.waitForTimeout(350);
    await hover('#signin');
    await shot(page, 'c09-locator-glow');
    await press();
    await shot(page, 'c10-locator-copied');

    await call({ type: 'UQA_STOP' });
    await page.waitForTimeout(1500);

    const rep = await context.newPage();
    await rep.setViewportSize({ width: 640, height: 1000 });
    await rep.goto(`chrome-extension://${id}/report/report.html`);
    await rep.waitForTimeout(2000);
    await shot(rep, 'c11-report-overview');
    for (const tab of ['broke', 'timeline', 'quality', 'file']) {
      await rep.click(`[data-tab="${tab}"]`).catch(() => {});
      await rep.waitForTimeout(900);
      await shot(rep, `c12-report-${tab}`);
    }
    await rep.click('[data-tab="raw"]');
    await rep.selectOption('#format', 'agent');
    await rep.waitForTimeout(1500);
    await shot(rep, 'c13-agent-brief');
  }
} finally {
  await context.close();
  server.close();
}
