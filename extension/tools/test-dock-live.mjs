/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The float's «Dock to the side» button must open the side panel in the browser window beneath, even when that window holds
 * no testable page (a new-tab or about:blank window made the worker resolve "the window under test" to the float itself, and
 * `sidePanel.open()` on a popup window docks nothing). Headed Chromium on the secondary monitor; run by hand.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { recycle } from './lib-trash.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
// A local page, never the internet: a proxied or offline machine cannot reach example.com (ERR_PROXY_CONNECTION_FAILED).
const fixture = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>dock fixture</title><p>plain page</p>'); });
await new Promise((ok) => fixture.listen(0, '127.0.0.1', ok));
for (const scene of ['a normal page', 'only about:blank']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dock-'));
  const ctx = await chromium.launchPersistentContext(dir, launchOptions(EXT));
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
    const id = new URL(sw.url()).host;
    const page = await ctx.newPage();
    if (scene === 'a normal page') await page.goto(`http://127.0.0.1:${fixture.address().port}/`);
    const [pop] = await Promise.all([
      ctx.waitForEvent('page'),
      sw.evaluate((u) => chrome.windows.create({ url: u, type: 'popup', width: 420, height: 700, focused: true }), `chrome-extension://${id}/popup/popup.html?surface=float`),
    ]);
    await pop.waitForLoadState('domcontentloaded');
    await pop.waitForFunction(() => document.body?.dataset.ready === 'true', null, { timeout: 15000 });
    let closed = false;
    pop.on('close', () => { closed = true; });
    await pop.click('#dock');
    for (let i = 0; i < 30 && !closed; i++) await new Promise((r) => setTimeout(r, 100));
    const panels = await sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }).then((c) => c.length));
    const ok = closed && panels > 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${scene}: float closed=${closed}, side panel contexts=${panels}`);
  } finally { await ctx.close(); recycle(dir); }
}
fixture.close();
process.exit(failed ? 1 : 0);
