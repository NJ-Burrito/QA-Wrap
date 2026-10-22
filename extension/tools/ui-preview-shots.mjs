/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The gate for a UI-rework preview (work/ui-rework/themes/<slug>/index.html).
 *
 *   node tools/ui-preview-shots.mjs <slug>
 *
 * Opens the preview from file:// in four states (light/dark x en/ar), shoots each
 * into the theme's own `shots/` folder, and checks what a script can check: no
 * network request, no console error, the popup is a 380 x 600 box that does not
 * scroll sideways, Arabic really is rtl, Simple shows 5-7 tools and Expert 19.
 * Exit 1 on any failure, one line per fault. Pictures are for the builder's own
 * eyes; taste is not checked here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { REPO, fileUrl } from './lib-paths.mjs';

const slug = process.argv[2];
if (!slug) { console.error('usage: node tools/ui-preview-shots.mjs <slug>'); process.exit(2); }
const dir = path.join(REPO, 'work', 'ui-rework', 'themes', slug);
const page0 = path.join(dir, 'index.html');
if (!fs.existsSync(page0)) { console.error(`no ${page0}`); process.exit(2); }
fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });

const faults = [];
const browser = await chromium.launch();
try {
  for (const theme of ['light', 'dark']) {
    for (const lang of ['en', 'ar']) {
      const tag = `${theme}-${lang}`;
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('request', (r) => { if (!/^(file|data|blob|about):/.test(r.url())) faults.push(`${tag}: network request ${r.url()}`); });
      page.on('console', (m) => { if (m.type() === 'error') faults.push(`${tag}: console error ${m.text().slice(0, 140)}`); });
      page.on('pageerror', (e) => faults.push(`${tag}: page error ${String(e).slice(0, 140)}`));
      await page.goto(`${fileUrl(page0)}?theme=${theme}&lang=${lang}`);
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => {
        const root = document.documentElement;
        const pop = document.querySelector('#stage-popup .popup');
        const r = pop?.getBoundingClientRect();
        const shown = () => [...document.querySelectorAll('#stage-popup [data-tool]')].filter((e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden').length;
        const out = { dir: root.dir || getComputedStyle(root).direction, theme: root.dataset.theme, w: r?.width, h: r?.height, sideways: pop ? pop.scrollWidth - pop.clientWidth : null, stages: ['#stage-popup', '#stage-report', '#stage-picker'].filter((s) => !document.querySelector(s)) };
        out.shown = shown();
        return out;
      });
      if (m.stages.length) faults.push(`${tag}: missing ${m.stages.join(', ')}`);
      if (m.theme !== theme) faults.push(`${tag}: data-theme is "${m.theme}"`);
      if ((lang === 'ar') !== (m.dir === 'rtl')) faults.push(`${tag}: dir is "${m.dir}"`);
      if (Math.round(m.w) !== 380 || Math.round(m.h) !== 600) faults.push(`${tag}: popup is ${Math.round(m.w)} x ${Math.round(m.h)}, not 380 x 600`);
      if (m.sideways > 1) faults.push(`${tag}: popup scrolls sideways by ${m.sideways}px`);
      if (m.shown !== 19) faults.push(`${tag}: the mock shows ${m.shown} tools, want 19`);
      await page.screenshot({ path: path.join(dir, 'shots', `${tag}.png`), fullPage: true });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
for (const f of faults) console.log('FAIL ', f);
console.log(faults.length ? `${faults.length} fault(s) in ${slug}` : `ok  ${slug}: 4 states shot, no network, no console error, popup 380 x 600, rtl mirrors, Simple/Expert counts right`);
process.exit(faults.length ? 1 : 0);
