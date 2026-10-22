/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Layout gates for the report page (round 3), in real Chrome with the built extension.
 *
 *   PYTHONUTF8=1 node tools/report-gates.mjs [outDir]
 *
 * A session with a 500 after Submit is recorded, then the report is measured at 1100x900 and
 * 1440x900 in English and Arabic, light and dark: every one of the ten panels, the File menu, the
 * Jira dialog, and the "no integration" state. Per state: horizontal overflow, overlapping
 * interactive rectangles, text under 12 px, contrast of every text pair (4.5:1, 3:1 large), a
 * non-Thmanyah face, tracking on Arabic or monospace text. Fold facts (verdict, steps, File bottom
 * edge under the viewport) are read at both widths. Screens go to outDir.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { grantedExtension, awaitSiteScripts, seedConsent } from './lib-granted.mjs';

const OUT = path.resolve(process.argv[2] || 'shots-report-impl');
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'https://apply-live.test';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-gates-'));
const TAB_SEC = { broke: 'findings', timeline: 'findings', selectors: 'findings', overview: 'findings', media: 'evidence', sizes: 'evidence', diagram: 'evidence', quality: 'quality', file: 'share', raw: 'share' };

/* runs in the page */
function measure() {
  const P2 = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden') return false; if (e.tagName === 'DIALOG' && !e.open) return false; } return true; };
  const dlg = document.querySelector('dialog[open]') || document.querySelector('.menu:not([hidden])');
  const root = dlg || document.body;
  // The ground is a gradient on the root in light themes; its plain colour is --surface-sunken.
  const probe = document.createElement('i'); probe.style.background = 'var(--surface-sunken)'; document.body.append(probe);
  const base = P2(getComputedStyle(probe).backgroundColor); probe.remove();
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = P2(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let b = base; for (let i = layers.length - 1; i >= 0; i--) b = over(layers[i], b); return b; };
  const out = { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [], overlap: [], contrast: [], nonFont: [], spacing: [] };
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n; const seen = new Set();
  while ((n = w.nextNode())) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (!t) continue;
    const p = n.parentElement; if (!p || ['SCRIPT', 'STYLE', 'OPTION', 'NOSCRIPT'].includes(p.tagName) || !vis(p)) continue;
    if (p.closest('svg text, .lightbox[hidden], #report-mark')) { /* chart labels are measured too, mark is decoration */ if (p.closest('#report-mark')) continue; }
    const cs = getComputedStyle(p), wt = parseInt(cs.fontWeight);
    // Text in an SVG is measured as drawn: its font size times the viewBox scale.
    const st = p.closest('text'); const size = parseFloat(cs.fontSize) * (st && st.getScreenCTM ? Math.abs(st.getScreenCTM().a) : 1);
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (!/^Thmanyah/.test(fam)) out.nonFont.push(fam + ': ' + t.slice(0, 30));
    if (size < 12) out.small.push(size + 'px: ' + t.slice(0, 40));
    if (cs.letterSpacing !== 'normal' && parseFloat(cs.letterSpacing) !== 0 && (/[؀-ۿ]/.test(t) || /mono|monospace/i.test(cs.fontFamily) || p.closest('pre,code,.mono,.code,.scope,input[type=password]'))) out.spacing.push(cs.letterSpacing + ' ' + p.className + ' ' + t.slice(0, 30));
    if (p.closest('[disabled],[aria-disabled="true"]')) continue;
    if (seen.has(p)) continue; seen.add(p);
    const fg0 = P2(cs.color), bg = bgOf(p); if (!fg0) continue; const fg = over(fg0, bg);
    const large = size >= 24 || (size >= 18.66 && wt >= 700), need = large ? 3 : 4.5, r = ratio(fg, bg);
    if (r < need) out.contrast.push(r.toFixed(2) + '<' + need + ' ' + p.tagName.toLowerCase() + '.' + (p.className || '') + ' "' + t.slice(0, 30) + '"');
  }
  const its = [...root.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])')].filter((e) => { const r = e.getBoundingClientRect(); return r.width >= 4 && r.height >= 4 && vis(e); });
  const R = its.map((e) => e.getBoundingClientRect());
  for (let i = 0; i < its.length; i++) for (let j = i + 1; j < its.length; j++) {
    if (its[i].contains(its[j]) || its[j].contains(its[i])) continue;
    const a = R[i], b = R[j], ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 3 && iy > 3) out.overlap.push((its[i].id || its[i].className || its[i].tagName) + ' x ' + (its[j].id || its[j].className || its[j].tagName));
  }
  for (const k of ['small', 'contrast', 'overlap', 'nonFont', 'spacing']) out[k] = [...new Set(out[k])].slice(0, 6);
  return out;
}

const EXT = grantedExtension({ label: 'report-gates' });
purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT, { width: 1440, height: 900 }));
await keepOnTop(context); // test window stays above others; released on close
const PAGE = `<!doctype html><meta charset="utf-8"><title>Apply</title><h1>Apply</h1><label>Applicant name <input id="n" value="Sara"></label>
<button id="submit" onclick="fetch('${ORIGIN}/api/applications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Sara'})}).then(r=>{if(!r.ok)console.error('Submit failed '+r.status)})">Submit application</button>`;
await context.route(`${ORIGIN}/**`, (r) => (/\/api\//.test(r.request().url())
  ? r.fulfill({ status: 500, headers: { 'content-type': 'application/json' }, body: '{"error":"internal","trace":"NullReference at Apply.Submit"}' })
  : r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: PAGE })));

const results = [];
const fails = [];
let shots = 0;
let code = 1;
try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  await awaitSiteScripts(worker);
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${id}/options/options.html`);
  await ext.waitForTimeout(600);
  const call = (m) => ext.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  await call({ type: 'UQA_SET_SETTINGS', patch: { jira: { baseUrl: 'http://127.0.0.1:9', authMode: 'cloud', email: 'qa@example.test', token: 'CANARY/gates+TOKEN=1', project: 'QA', issueType: 'Bug' } } });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/apply`, { waitUntil: 'load' });
  const tabId = await worker.evaluate(async (o) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(o))?.id, ORIGIN);
  const winId = await worker.evaluate((tid) => chrome.tabs.get(tid).then((t) => t.windowId), tabId);
  await call({ type: 'UQA_ARM', windowId: winId });
  const started = await call({ type: 'UQA_START', charter: 'Licence renewal: Submit returns 500', tabId, startUrl: `${ORIGIN}/apply` });
  const sessionId = started?.result?.id || started?.result?.sessionId || started?.result?.session?.id;
  await page.fill('#n', 'Sara Haddad');
  await page.click('#submit');
  await page.waitForTimeout(1200);
  await call({ type: 'UQA_SCREENSHOT' }).catch(() => {});
  await page.waitForTimeout(500);
  await call({ type: 'UQA_STOP' });

  const report = await context.newPage();
  // A static gate: no entrance animation may be caught half-way through its colour.
  await report.emulateMedia({ reducedMotion: 'reduce' });
  const url = `chrome-extension://${id}/report/report.html?session=${sessionId}`;
  const note = (label, o) => {
    results.push({ label, ...o });
    if (o.overflow > 0 || o.small.length || o.overlap.length || o.contrast.length || o.nonFont.length || o.spacing.length) fails.push(label + ' ' + JSON.stringify({ overflow: o.overflow, small: o.small, overlap: o.overlap, contrast: o.contrast, nonFont: o.nonFont, spacing: o.spacing }));
  };
  const shot = async (label) => { await report.screenshot({ path: path.join(OUT, `${label}.png`) }); shots++; };

  for (const w of [1100, 1440]) for (const lang of ['en', 'ar']) for (const theme of ['light', 'dark']) {
    const tag = `${w}-${lang}-${theme}`;
    await report.setViewportSize({ width: w, height: 900 });
    await report.goto(url);
    await report.waitForSelector('#verdict:not([hidden]) #btn-file', { timeout: 20000 });
    await report.evaluate(async ([l, th]) => { await QAWi18n.setLang(l); UQATheme.set(th); }, [lang, theme]);
    await report.waitForTimeout(900);
    // fold facts
    const fold = await report.evaluate(() => { const r = (s) => document.querySelector(s)?.getBoundingClientRect().bottom; return { h1: r('#v-h'), steps: r('#verdict .steps'), file: r('#btn-file'), stepN: document.querySelectorAll('#verdict .steps li').length }; });
    if (!(fold.h1 < 900 && fold.steps < 900 && fold.file < 900 && fold.stepN > 0)) fails.push(`fold ${tag} ${JSON.stringify(fold)}`);
    results.push({ label: `fold ${tag}`, fold });
    // every panel
    for (const tab of Object.keys(TAB_SEC)) {
      await report.click(`#sec-${TAB_SEC[tab]}`);
      const vis = await report.locator(`[data-tab="${tab}"]`).isVisible();
      if (vis) await report.click(`[data-tab="${tab}"]`);
      else if (tab !== 'selectors' && !(tab === 'quality')) fails.push(`tab ${tab} not reachable ${tag}`);
      await report.waitForTimeout(tab === 'diagram' || tab === 'raw' ? 2200 : 700);
      const shown = await report.evaluate((t) => !document.getElementById(`panel-${t}`).hidden, tab);
      if (!shown && tab !== 'selectors') { fails.push(`panel ${tab} not shown ${tag}`); continue; }
      if (!shown) continue;
      note(`${tag} ${tab}`, await report.evaluate(measure));
      if (tab === 'broke' || tab === 'quality') await shot(`${tag}-${tab}`);
    }
    await report.click('#sec-findings');
    await report.click('[data-tab="broke"]');
    await report.evaluate(() => scrollTo(0, 0));
    await shot(`${tag}-top`);
    // File menu + Jira dialog
    await report.click('#btn-file');
    await report.waitForTimeout(250);
    note(`${tag} file-menu`, await report.evaluate(measure));
    await report.click('[data-file="jira"]');
    await report.waitForSelector('#dlg-file[open] [data-d=create]', { timeout: 15000 }).catch(() => {});
    await report.waitForTimeout(1500);
    note(`${tag} jira-dialog`, await report.evaluate(measure));
    await shot(`${tag}-dialog`);
    await report.keyboard.press('Escape');
  }

  // no integration: File becomes Set up filing, auto-submit is hidden
  await call({ type: 'UQA_SET_SETTINGS', patch: { jira: { baseUrl: '', email: '', token: '', project: '' } } });
  await report.setViewportSize({ width: 1100, height: 900 });
  await report.goto(url);
  await report.waitForSelector('#verdict:not([hidden]) #btn-file', { timeout: 20000 });
  const none = await report.evaluate(() => ({ tag: document.getElementById('btn-file').tagName, href: document.getElementById('btn-file').getAttribute('href'), row: getComputedStyle(document.getElementById('auto-submit-row')).display }));
  results.push({ label: 'no-integration', none });
  if (none.tag !== 'A' || !/integrations/.test(none.href) || none.row !== 'none') fails.push('no-integration ' + JSON.stringify(none));
  note('no-integration', await report.evaluate(measure));
  await shot('no-integration');

  const total = (k) => results.reduce((s, r) => s + (Array.isArray(r[k]) ? r[k].length : (r[k] > 0 ? 1 : 0)), 0);
  const line = { states: results.length, overflow: total('overflow'), overlap: total('overlap'), small: total('small'), contrast: total('contrast'), nonFont: total('nonFont'), spacing: total('spacing'), fold: results.filter((r) => r.fold).length, fails: fails.length, shots };
  fs.writeFileSync(path.join(OUT, 'gates.json'), JSON.stringify({ line, fails, results }, null, 1));
  console.log(JSON.stringify(line));
  for (const f of fails.slice(0, 40)) console.log('FAIL ' + f.slice(0, 500));
  code = fails.length ? 1 : 0;
} catch (err) {
  console.log('harness: ' + (err.stack || err));
} finally {
  await context?.close().catch(() => {});
  fs.rmSync(EXT, { recursive: true, force: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(code);
