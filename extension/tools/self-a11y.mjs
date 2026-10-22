/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-035: one axe run against the extension's own pages. A MEASUREMENT, not a harness.
 *
 *   UQA_HEADLESS=1 node tools/self-a11y.mjs [--forced-colors-shot <png>]
 *
 * Loads the granted copy of the extension (consent seeded) in an isolated fresh profile (tag council-1010, recycled on exit),
 * seeds one short recorded session, then for popup, options, report, panel, welcome, annotate,
 * videoedit, diagram, replay, reporter, api and tutorials in light and dark and English and Arabic injects the vendored
 * axe 4.13.0 (WCAG 2.2 A/AA) and records the rule ids. Then: an overflow walk at 360/440/560 px in both
 * languages and one keyboard-only Tab walk per main page.
 *
 * Output: tools/a11y-baseline.json ({ page: [ruleIds] }), a detail file under work/delivery/, and a printed
 * critical + serious count per page. Per DEC-04 nobody claims "accessible" until every count is zero.
 *
 * Named `self-a11y.mjs`, not `test-*.mjs`: it launches a browser and measures; it is not a pass/fail gate,
 * so it stays out of scripts.test (T-060 folds it into the chain later).
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { recycle } from './lib-trash.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker } from './lib-fresh.mjs';
import { grantedExtension, seedConsent, awaitSiteScripts } from './lib-granted.mjs';
import { FOCUS_PROBE, ringVisible } from './lib-focus-ring.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const REPO = path.resolve(EXT, '..');
const argv = process.argv.slice(2);
const checkMode = argv.includes('--check');
const shotAt = argv.includes('--forced-colors-shot') ? path.resolve(argv[argv.indexOf('--forced-colors-shot') + 1]) : null;
// r1-08-1: the popup only shows its tools after the notice is accepted and a recording needs a granted site, so the
// scan loads the granted copy (the one manifest line a tester's grant changes) with consent seeded, in a fresh profile
// tagged council-1010 that is moved to the recycle bin on exit.
const LOADED = grantedExtension({ label: 'a11y' });
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-council-1010-a11y-'));
const EXPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-council-1010-exports-')); // D-1010-217: rendered exports, recycled on exit
const AXE = fs.readFileSync(path.join(EXT, 'vendor', 'axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const fixture = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title></head><body><h1>Fixture</h1><label>Name <input id="f" type="text"></label><button type="button">Press</button></body></html>');
});
await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
const FIXTURE = `http://127.0.0.1:${fixture.address().port}/`;
const context = await chromium.launchPersistentContext(PROFILE, launchOptions(LOADED, { width: 1100, height: 900 }));
await keepOnTop(context); // test window stays above others; released on close
const detail = {};
const baseline = {};
const walks = {};
const skipped = {};
const exportScans = { rendered: 0, scans: 0, violations: [], missing: [] }; // D-1010-217
try {
  const worker = await freshWorker(context);
  await seedConsent(worker);
  await awaitSiteScripts(worker);
  const id = new URL(worker.url()).host;
  const base = `chrome-extension://${id}`;

  const ctl = await context.newPage();
  await ctl.goto(`${base}/popup/popup.html`);
  // Starting a session through the worker needs a host-permission grant that a headless browser cannot
  // click, so the session is written straight into the extension's own store: one stopped session with
  // a few events, the same rows the worker would have written.
  const seeded = await ctl.evaluate(async () => {
    const db = await import('../core/db.js');
    const now = Date.now();
    const id = 'selfa11y-' + now;
    await db.putSession({ id, seq: 1, charter: 'Self a11y fixture', startedAt: now - 120000, endedAt: now, tabId: null, windowId: null,
      startUrl: 'http://127.0.0.1/', env: null, timeboxMinutes: null, expiresAt: null, breakdown: null, status: 'stopped' });
    await db.appendEvents([
      { sessionId: id, kind: 'nav', url: 'http://127.0.0.1/', ts: now - 110000 },
      { sessionId: id, kind: 'note', tag: 'bug', text: 'Submit returns 500 on an expired document.', ts: now - 60000 },
      { sessionId: id, kind: 'note', tag: 'issue', text: 'Needed a fresh account to get here.', ts: now - 30000 },
    ]);
    // r2-08-4: one screenshot and one webm clip, so annotate, videoedit, the report's lightbox and its evidence openers have something to open.
    const shot = await new Promise((res) => { const c = document.createElement('canvas'); c.width = 320; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#ddd'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#333'; g.fillRect(40, 60, 240, 40); c.toBlob(res, 'image/png'); });
    const clip = await new Promise((res, rej) => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 100; const g = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
      const parts = [];
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = () => res(new Blob(parts, { type: 'video/webm' }));
      rec.onerror = () => rej(new Error('MediaRecorder failed'));
      rec.start();
      let n = 0;
      const tick = () => { g.fillStyle = n % 2 ? '#246' : '#642'; g.fillRect(0, 0, 160, 100); if (++n < 20) setTimeout(tick, 60); else rec.stop(); };
      tick();
    });
    const shotId = id + '-shot';
    const clipId = id + '-clip';
    await db.putMedia({ id: shotId, sessionId: id, kind: 'screenshot', type: 'image/png', blob: shot, bytes: shot.size, label: 'Seeded screenshot', ts: now - 50000 });
    await db.putMedia({ id: clipId, sessionId: id, kind: 'recording', type: 'video/webm', blob: clip, bytes: clip.size, label: 'Seeded clip', ts: now - 45000, durationMs: 1200 });
    await db.appendEvents([
      { sessionId: id, kind: 'screenshot', ts: now - 50000, captureId: shotId, mediaId: shotId, imageType: 'image/png', bytes: shot.size, text: 'Seeded screenshot' },
      { sessionId: id, kind: 'selectorcopy', ts: now - 40000, category: 'button', tabTitle: 'Fixture', frameUrl: 'http://127.0.0.1/', warnCodes: [], flavours: [{ name: 'Playwright', expr: "getByRole('button', { name: 'Submit' })", copied: true, unique: true, matches: 1 }] },
      { sessionId: id, kind: 'recording', ts: now - 45000, mediaId: clipId, type: 'video/webm', bytes: clip.size, text: 'Seeded clip' },
    ]);
    return { id, shotId, clipId };
  });
  const sid = seeded?.id;
  if (!sid) throw new Error('no seeded session id: report, diagram and replay would be measured empty');

  // annotate and videoedit open on a stored media id; with none they show their empty state, which is
  // what a first-time visitor sees, and is recorded as such.
  const PAGES = {
    popup: 'popup/popup.html',
    options: 'options/options.html',
    report: `report/report.html?session=${sid}`,
    panel: 'devtools/panel.html',
    welcome: 'welcome/welcome.html',
    annotate: 'annotate/annotate.html',
    videoedit: 'videoedit/videoedit.html',
    diagram: `diagram/diagram.html?session=${sid}`,
    replay: `replay/replay.html?session=${sid}`,
    reporter: 'reporter/reporter.html',
    sidepanel: 'sidepanel/sidepanel.html', // D-1010-159: the overflow and forced-colors walks cover it
    api: 'api/api.html', // D-1010-124: both pages are opened from the product (service-worker.js, popup.js)
    tutorials: 'tutorials/tutorials.html',
    annotateImage: `annotate/annotate.html?id=${seeded.shotId}`,
    videoeditClip: `videoedit/videoedit.html?id=${seeded.clipId}`,
  };

  const target = await context.newPage(); // a recording needs an ordinary page to watch
  await target.goto(FIXTURE);
  const page = await context.newPage();

  /** One page, or one state of it, in light and dark and English and Arabic: axe on the exact DOM a person sees. */
  async function scanState(name, rel, setup) {
    baseline[name] = new Set();
    detail[name] = {};
    for (const scheme of ['light', 'dark']) {
      for (const lang of ['en', 'ar']) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width: 1100, height: 900 });
        await page.goto(`${base}/${rel}`);
        await page.evaluate((l) => globalThis.QAWi18n?.setLang?.(l), lang);
        await page.waitForTimeout(900);
        const ready = await page.evaluate(() => document.body && document.body.children.length > 0);
        if (!ready) throw new Error(`${name} did not render`); // a probe that ran before boot proves nothing
        if (setup) {
          const why = await setup(page, lang);
          if (why) { skipped[name] = why; delete baseline[name]; delete detail[name]; return; }
          await page.waitForTimeout(400);
        }
        await page.evaluate(AXE);
        const res = await page.evaluate((tags) => axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS);
        const key = `${scheme}/${lang}`;
        // A clean result only counts if axe looked at something: passes and element counts are the positive sample.
        const elements = await page.evaluate(() => document.querySelectorAll('*').length);
        if (res.passes.length < 5) throw new Error(`${name} ${scheme}/${lang}: axe passed only ${res.passes.length} rules, it did not look`);
        detail[name][key] = { passes: res.passes.length, elements, violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 4).map((n) => { const d = n.any?.[0]?.data; return n.target.join(' ') + (d?.contrastRatio ? ` [${d.contrastRatio} ${d.fgColor} on ${d.bgColor}, need ${d.expectedContrastRatio}]` : ''); }) })) };
        for (const v of res.violations) baseline[name].add(v.id);
      }
    }
  }

  const STATE_PAGES = new Set(['annotateImage', 'videoeditClip']); // scanned below as annotate:with-image and videoedit:with-clip
  for (const [name, rel] of Object.entries(PAGES)) if (!STATE_PAGES.has(name)) await scanState(name, rel, null); // popup here is consented, asleep, idle

  // Wake the popup the way a tester does: open the folded card if needed, press the switch.
  const wake = async (p) => {
    if ((await p.evaluate(() => document.body.dataset.awake)) === 'true') return;
    await p.click('#switch');
    await p.waitForFunction(() => document.body.dataset.awake === 'true', null, { timeout: 8000 });
  };
  /** Click something that must be there for the state to exist; absence is reported as the reason the state was not scanned. */
  const press = async (p, sel, ready) => {
    // Wait for it: a panel or a tab switch paints a frame after the press that revealed it.
    if (!(await p.locator(sel).first().waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false))) return `${sel} is not visible`;
    await p.locator(sel).first().click({ timeout: 5000 });
    if (ready) await p.waitForSelector(ready, { timeout: 5000 });
    return null;
  };

  await scanState('popup:more-menu', PAGES.popup, (p) => press(p, '#more', '#more-menu:not([hidden])'));
  await scanState('popup:awake', PAGES.popup, async (p) => { await wake(p); });
  await scanState('popup:tool-open', PAGES.popup, async (p) => { await wake(p); await p.evaluate(() => { const f = document.getElementById('tools-fold'); if (f) f.open = true; }); /* the rows sit in the closed fold since 1014 B1 */ return press(p, '[data-action="break-toggle"]', '#break-panel:not([hidden])'); });

  // Report: every section tab the seeded session enables, then the save dialog.
  await page.goto(`${base}/${PAGES.report}`);
  await page.waitForTimeout(1500);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.tab[data-tab]')].map((b) => ({ tab: b.dataset.tab, off: b.disabled || b.hidden })));
  const SEC_OF = { broke: 'findings', timeline: 'findings', selectors: 'findings', overview: 'findings', media: 'evidence', sizes: 'evidence', diagram: 'evidence', quality: 'quality', file: 'share', raw: 'share' };
  const openTab = async (p, tab) => {
    const sec = p.locator(`#sec-${SEC_OF[tab]}`);
    if (await sec.isEnabled().catch(() => false)) await sec.click();
    const btn = p.locator(`[data-tab="${tab}"]`);
    if (!(await btn.isEnabled().catch(() => false))) return `tab ${tab} is disabled for the seeded session`;
    if (await btn.isVisible()) await btn.click(); // a section with a single tab shows no tab button: the section press selects it
    return null;
  };
  for (const { tab, off } of tabs) {
    if (tab === 'overview') continue; // the default state, scanned above as `report`
    if (off) { skipped[`report:tab-${tab}`] = `tab ${tab} is disabled or hidden for the seeded session`; continue; }
    await scanState(`report:tab-${tab}`, PAGES.report, (p) => openTab(p, tab));
  }
  await scanState('report:save-dialog', PAGES.report, (p) => press(p, '#save-all', '#save-dialog[open]'));

  // r2-08-4: states that need stored media (annotate and videoedit on a real file, the report's lightbox) and a drawn diagram.
  await scanState('annotate:with-image', PAGES.annotateImage, async (p) => (await p.waitForFunction(() => document.getElementById('canvas')?.width > 0, null, { timeout: 8000 }).then(() => null, () => 'annotate drew no canvas for the seeded image')));
  await scanState('videoedit:with-clip', PAGES.videoeditClip, async (p) => (await p.waitForFunction(() => { const v = document.getElementById('video'); return !!v && v.readyState >= 1; }, null, { timeout: 8000 }).then(() => null, () => 'videoedit did not load the seeded clip')));
  await scanState('report:lightbox', PAGES.report, async (p) => {
    const why = await openTab(p, 'media');
    if (why) return why;
    return press(p, '.shot-stage', '#lightbox[open]');
  });
  await scanState('diagram:loaded', PAGES.diagram, async (p) => (await p.waitForFunction(() => !document.body.classList.contains('is-empty') && document.querySelector('#sheet-wrap svg, #sheet-wrap .node, svg g') !== null, null, { timeout: 8000 }).then(() => null, () => 'the diagram stayed empty for the seeded session')));

  // r2-08-4 / D-1010-22: every evidence opener is a button in the tab order, and Enter opens #lightbox.
  walks.openers = {};
  for (const [label, tab] of [['media', 'media'], ['broke', 'broke']]) {
    await page.goto(`${base}/${PAGES.report}`);
    await page.waitForTimeout(1500);
    const why = await openTab(page, tab);
    if (why) { walks.openers[label] = { why }; continue; }
    await page.waitForTimeout(600);
    const sel = '.ev-open, .shot-stage, .chain-shot button';
    const info = await page.evaluate((q) => [...document.querySelectorAll(q)].map((b) => ({ tag: b.tagName, tab: b.tabIndex, label: b.getAttribute('aria-label') || '' })), sel);
    const row = { count: info.length, notButtons: info.filter((i) => i.tag !== 'BUTTON').length, notTabbable: info.filter((i) => i.tab < 0).length, unlabelled: info.filter((i) => !i.label).length, enterOpens: null };
    row.visible = await page.locator(sel).locator('visible=true').count();
    if (row.visible) {
      await page.locator(sel).locator('visible=true').first().focus(); // the first opener on screen, not one in a hidden tab
      await page.keyboard.press('Enter');
      row.enterOpens = await page.waitForSelector('#lightbox[open]', { timeout: 5000 }).then(() => true, () => false);
    }
    walks.openers[label] = row;
  }

  // Options: the two dialogs.
  await scanState('options:bundle-dialog', PAGES.options, async (p) => (await press(p, '#tab-about')) || press(p, '#bundle-open', '#bundle-dialog[open]'));
  await scanState('options:confirm-dialog', PAGES.options, async (p) => (await press(p, '#tab-privacy')) || press(p, '#erase-all', '#confirm-dialog[open]'));

  // The popup while recording (last: the worker keeps the session for every later load).
  await scanState('popup:recording', PAGES.popup, async (p) => {
    await wake(p);
    if (await p.locator('#step-live').isHidden()) {
      await p.fill('#charter', 'Self a11y recording');
      await p.click('#start');
    }
    await p.waitForFunction(() => !document.getElementById('step-live').hidden, null, { timeout: 8000 });
    return null;
  });

  // r6-08-4 / D-1010-137: the tool's own furniture on a web page (bar, palette, quick note) lives in a CLOSED shadow root, so axe is injected into
  // the content-script world through CDP and run over an open clone of that root (a closed root answers nothing to any scanner, in either world).
  const tabId = await worker.evaluate(async (o) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(o))?.id, FIXTURE);
  const cdp = await context.newCDPSession(target);
  const worlds = [];
  cdp.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
  cdp.on('Runtime.executionContextDestroyed', (e) => { const i = worlds.findIndex((w) => w.id === e.executionContextId); if (i >= 0) worlds.splice(i, 1); });
  await cdp.send('Runtime.enable');
  const inWorld = async (expression) => {
    const w = worlds.filter((x) => x.auxData?.type === 'isolated' && x.origin === base).pop();
    if (!w) throw new Error('no content-script world of the extension on the fixture page');
    const r = await cdp.send('Runtime.evaluate', { contextId: w.id, expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`content world: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`.slice(0, 300));
    return r.result.value;
  };
  const CLONE_AXE = `(async () => {
    const root = window.UQAUiHost.uiRoot(); const orig = root.host;
    const layer = __LAYER__; if (!root.querySelector(layer)) return { missing: layer };
    const tmp = document.createElement('div');
    for (const a of orig.attributes) if (a.name !== 'id') tmp.setAttribute(a.name, a.value);
    const sr = tmp.attachShadow({ mode: 'open' });
    for (const n of root.childNodes) sr.appendChild(n.cloneNode(true));
    try { sr.adoptedStyleSheets = root.adoptedStyleSheets; } catch {}
    const keep = orig.style.display; orig.style.display = 'none';
    document.documentElement.appendChild(tmp);
    try {
      const res = await axe.run({ include: [tmp] }, { runOnly: { type: 'tag', values: __TAGS__ } });
      return { lang: orig.lang, dir: orig.dir, passes: res.passes.length, nodes: sr.querySelectorAll('*').length,
        violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 4).map((n) => n.target.flat(3).join(' ').slice(0, 140)) })) };
    } finally { tmp.remove(); orig.style.display = keep; }
  })()`;
  async function scanContent(name, layer, open) {
    baseline[name] = new Set();
    detail[name] = {};
    for (const scheme of ['light', 'dark']) {
      for (const lang of ['en', 'ar']) {
        await ctl.evaluate((l) => globalThis.QAWi18n?.setLang?.(l), lang);
        await target.emulateMedia({ colorScheme: scheme });
        await target.goto(FIXTURE);
        await target.waitForTimeout(1200);
        await target.bringToFront();
        await inWorld(AXE); // defines axe in the content world; harmless when repeated
        const why = await open(target, lang);
        if (why) { skipped[name] = why; delete baseline[name]; delete detail[name]; return; }
        await target.waitForTimeout(700);
        const r = await inWorld(CLONE_AXE.replace('__LAYER__', JSON.stringify(`.${layer}`)).replace('__TAGS__', JSON.stringify(TAGS)));
        if (r.missing) { skipped[name] = `${r.missing} was not on screen (${scheme}/${lang})`; delete baseline[name]; delete detail[name]; return; }
        if (r.passes < 3 || r.nodes < 3) throw new Error(`${name} ${scheme}/${lang}: axe passed ${r.passes} rules over ${r.nodes} nodes, it did not look`);
        if (r.lang !== lang) { skipped[name] = `the overlay did not follow the language (${r.lang} for ${lang})`; delete baseline[name]; delete detail[name]; return; }
        detail[name][`${scheme}/${lang}`] = { passes: r.passes, elements: r.nodes, violations: r.violations };
        for (const v of r.violations) baseline[name].add(v.id);
        await target.keyboard.press('Escape').catch(() => {});
      }
    }
  }
  await scanContent('overlay:bar', 'uqa-bar', async () => ((await inWorld('!!window.UQABar')) ? null : 'the bar script is not on the page'));
  await scanContent('overlay:palette', 'uqa-palette', async (p) => {
    await p.focus('#f');
    await ctl.evaluate((id) => new Promise((res) => chrome.runtime.sendMessage({ type: 'UQA_INJECT', tabId: id }, res)), tabId);
    return null;
  });
  await scanContent('overlay:quick-note', 'uqa-quicknote', async (p) => { await p.evaluate(() => document.activeElement?.blur?.()); await p.keyboard.press('Alt+KeyN'); return null; });

  // r1-08-3: a Tab-reachable chart bar, good and bad, shows a ring in both themes and languages.
  walks.chartRing = {};
  for (const scheme of ['light', 'dark']) {
    for (const lang of ['en', 'ar']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${base}/${PAGES.report}`);
      await page.evaluate((l) => globalThis.QAWi18n?.setLang?.(l), lang);
      await page.waitForTimeout(1200);
      await openTab(page, 'overview'); // the charts live on the overview, which is not the tab a session with a failure opens on
      await page.waitForTimeout(500);
      const bars = { good: null, bad: null, count: await page.locator('.chart-bar').count() };
      // One Tab puts the page in keyboard modality (so :focus-visible matches); then each bar is focused in turn.
      await page.keyboard.press('Tab');
      bars.tabbable = await page.evaluate(() => [...document.querySelectorAll('.chart-bar')].every((b) => b.tabIndex === 0));
      for (let i = 0; i < bars.count; i++) {
        await page.evaluate((n) => document.querySelectorAll('.chart-bar')[n].focus(), i);
        // r7 F1 carry: a bar grows in with scaleY (qaw-bar-grow), so a probe taken at once reads a zero-height bar. Judge the ring once the draw is done.
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
        const d = await page.evaluate(FOCUS_PROBE);
        if (d.none || !/chart-bar/.test(d.cls)) (bars.misses ||= []).push({ none: d.none, cls: d.cls, on: d.on, why: await page.evaluate((n) => { const b = document.querySelectorAll('.chart-bar')[n]; const r = b.getBoundingClientRect(); return { tag: b.tagName, hiddenUp: !!b.closest('[hidden]'), vis: getComputedStyle(b).visibility, w: r.width, h: r.height, active: document.activeElement?.tagName, tab: b.getAttribute('tabindex') }; }, i) });
        if (!d.none && /chart-bar/.test(d.cls)) {
          const kind = /is-bad/.test(d.cls) ? 'bad' : 'good';
          (bars.rows ||= []).push({ kind, fv: d.focusVisible, on: d.on, outline: `${d.outlineStyle} ${d.outlineWidth} ${d.outlineColor}` });
          bars[kind] = (bars[kind] ?? true) && ringVisible(d);
        }
      }
      walks.chartRing[`${scheme}/${lang}`] = bars;
    }
  }

  // Heuristic walk: does anything force a horizontal scrollbar at phone-ish widths, in both languages.
  for (const name of ['popup', 'options', 'report', 'welcome', 'panel', 'sidepanel']) {
    walks[name] = { overflow: {}, overflowOffenders: {} };
    for (const w of [320, 360, 440, 560]) {
      for (const lang of ['en', 'ar']) {
        await page.setViewportSize({ width: w, height: 800 });
        await page.goto(`${base}/${PAGES[name]}`);
        await page.evaluate((l) => globalThis.QAWi18n?.setLang?.(l), lang);
        await page.waitForTimeout(700);
        // D-1010-159: more than 1 px of horizontal scroll fails, unless every element that sticks out sits in #diagram-frame or a <pre>.
        const o = await page.evaluate(() => {
          const se = document.scrollingElement;
          const over = se.scrollWidth - se.clientWidth;
          if (over <= 1) return { over, offenders: [] };
          const offenders = [...document.body.querySelectorAll('*')]
            .filter((el) => !el.closest('pre, #diagram-frame') && el.getBoundingClientRect().right > se.clientWidth + 1 && getComputedStyle(el).display !== 'none')
            .slice(0, 5).map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''));
          return { over: offenders.length ? over : 0, offenders };
        });
        walks[name].overflow[`${w}/${lang}`] = o.over;
        if (o.offenders.length) walks[name].overflowOffenders[`${w}/${lang}`] = o.offenders;
      }
    }
    // Keyboard-only: Tab through up to 80 stops; count the distinct ones and those that show no focus indicator.
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${base}/${PAGES[name]}`);
    await page.waitForTimeout(700);
    const seen = new Set();
    let noRing = 0;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
        return { key: el.tagName + '#' + (el.id || el.getAttribute('data-tab') || el.className || el.textContent?.slice(0, 20)), ring: Boolean(ring) };
      });
      if (!info) continue;
      if (!seen.has(info.key)) { seen.add(info.key); if (!info.ring) noRing++; }
    }
    walks[name].keyboard = { stops: seen.size, stopsWithoutRing: noRing };
  }

  // r8-08-4 (WCAG 1.4.12 text spacing): the four overrides from the success criterion are injected, and every control that clips its own
  // text (overflow hidden or clip, content larger than the box) is counted. Printed for popup, options and report in en and ar; not a gate yet.
  const SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';
  let spacingClipped = 0;
  const spacingDetail = {};
  await page.setViewportSize({ width: 1100, height: 900 });
  for (const name of ['popup', 'options', 'report']) {
    for (const lang of ['en', 'ar']) {
      await page.goto(`${base}/${PAGES[name]}`);
      await page.evaluate((l) => globalThis.QAWi18n?.setLang?.(l), lang);
      await page.addStyleTag({ content: SPACING });
      await page.waitForTimeout(500);
      const clipped = await page.evaluate(() => [...document.querySelectorAll('button, a.btn, [role="button"], [role="tab"], input, select, summary')]
        .filter((el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); return cs.overflow !== 'visible' && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && cs.textOverflow !== 'ellipsis'; })
        .slice(0, 6).map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')));
      spacingDetail[`${name}/${lang}`] = clipped;
      spacingClipped += clipped.length;
    }
  }
  console.log(`text-spacing clipped controls: ${spacingClipped} ${spacingClipped ? JSON.stringify(spacingDetail) : ''}`);
  walks.textSpacing = { clipped: spacingClipped, detail: spacingDetail };
  // D-1010-217 (r9-08-1): the exports a person opens outside the product. Two seeded sessions (English and Arabic: the export follows the
  // session's own language), each rendered as the session HTML, the defect report (markdown through the shared shell) and the test suite
  // (same), written to temp files and axe-scanned from file:// in light and dark. Serious or critical fails the run (check block below).
  await page.goto(`${base}/popup/popup.html`);
  const rendered = await page.evaluate(async () => {
    const db = await import('../core/db.js');
    const { mdToHtml } = await import('../core/mdhtml.js');
    const { shell, loadDocFonts } = await import('../core/docshell.js');
    await loadDocFonts(); // shell() refuses to build before the fonts are loaded
    const out = {};
    const seeds = {
      en: { charter: 'Checkout defect', note: 'The pay button does nothing after the card is entered', label: 'Pay now', env: { language: 'en' } },
      ar: { charter: 'عيب في صفحة الدفع', note: 'زر الدفع لا يستجيب بعد إدخال بيانات البطاقة', label: 'ادفع الآن', env: { language: 'ar' } },
    };
    for (const [lang, sd] of Object.entries(seeds)) {
      const sid = `s_a11y_export_${lang}_${Date.now().toString(36)}`;
      const t0 = Date.now() - 120000;
      await db.putSession({ id: sid, seq: 1, charter: sd.charter, startedAt: t0, endedAt: Date.now() - 1000, tabId: null, windowId: null, startUrl: 'http://127.0.0.1/checkout', env: sd.env, timeboxMinutes: null, expiresAt: null, breakdown: null, status: 'stopped' });
      await db.appendEvents([
        { sessionId: sid, kind: 'dom', ts: t0 + 1000, frameUrl: 'http://127.0.0.1/checkout', action: 'click', label: sd.label, locator: "getByRole('button', { name: 'Pay now' })" },
        { sessionId: sid, kind: 'net', ts: t0 + 1300, frameUrl: 'http://127.0.0.1/checkout', method: 'POST', url: 'http://127.0.0.1/api/pay', status: 500, durationMs: 180 },
        { sessionId: sid, kind: 'note', ts: t0 + 2000, text: sd.note },
      ]);
      const ask = (format) => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_EXPORT', sessionId: sid, format }, r));
      const wrap = (md, kind) => { const { html, headings } = mdToHtml(md, lang); return shell({ title: `${kind}: ${sd.charter}`, kind, subtitle: sd.charter, verdict: { tone: 'bad', text: kind }, body: html, headings, lang, dir: lang === 'ar' ? 'rtl' : 'ltr', version: '0' }); };
      const html = await ask('html');
      const md = await ask('markdown');
      const suite = await ask('suite');
      out[`session/${lang}`] = html?.ok ? html.result.content : null;
      out[`defect/${lang}`] = md?.ok ? wrap(md.result.content, 'Defect report') : null;
      out[`suite/${lang}`] = suite?.ok ? wrap(suite.result.content, 'Test suite') : null;
    }
    return out;
  });
  exportScans.rendered = Object.keys(rendered).length;
  for (const [name, content] of Object.entries(rendered)) {
    if (typeof content !== 'string' || content.length < 500) { exportScans.missing.push(name); continue; }
    const file = path.join(EXPORT_DIR, name.replace('/', '-') + '.html');
    fs.writeFileSync(file, content);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(pathToFileURL(file).href);
      await page.waitForTimeout(500);
      await page.evaluate(AXE);
      const res = await page.evaluate((tags) => axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS);
      if (res.passes.length < 5) { exportScans.missing.push(`${name} ${scheme}: axe passed only ${res.passes.length} rules`); continue; }
      exportScans.scans += 1;
      for (const v of res.violations) exportScans.violations.push({ key: `${name} ${scheme}`, id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) });
    }
  }
  walks.exportScans = exportScans;
  console.log(`self-a11y exports: ${exportScans.scans} scans (${Object.keys(rendered).join(', ')} x light, dark), ${exportScans.violations.length} violation(s), ${exportScans.missing.length} not scanned`);
  await page.emulateMedia({ colorScheme: 'light' });

  // D-1010-159: a forced-colors Tab walk. The browser drops box-shadow there, so a stop shows a ring only through a real
  // outline; and a selected tab must differ from an unselected one by something other than a colour the palette painted.
  let fcNoRing = 0;
  let fcTabsAlike = 0;
  const fcDetail = {};
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
  for (const name of ['popup', 'options', 'report', 'welcome', 'panel', 'sidepanel']) {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${base}/${PAGES[name]}`);
    await page.waitForTimeout(700);
    const seen = new Set();
    const bare = [];
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const d = await page.evaluate(FOCUS_PROBE);
      if (!d || d.none || !d.on) continue;
      if (d.tag === 'iframe') continue; // focus moves into the frame; its own page is walked on its own
      const key = d.tag + '#' + (d.id || d.cls || d.name);
      if (seen.has(key)) continue;
      seen.add(key);
      const outline = !/^(none|hidden)$/.test(d.outlineStyle) && parseFloat(d.outlineWidth) > 0;
      if (!outline) bare.push(key);
    }
    const tabs = await page.evaluate(() => {
      const sig = (el) => { const c = getComputedStyle(el); return [c.outlineStyle, c.outlineWidth, c.borderBottomStyle, c.borderBottomWidth, c.borderTopWidth, c.backgroundColor, c.color, c.textDecorationLine, c.fontWeight].join('|'); };
      const sel = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].filter((e) => e.getClientRects().length);
      const uns = [...document.querySelectorAll('[role="tab"][aria-selected="false"]')].filter((e) => e.getClientRects().length);
      return { sel: sel.length, uns: uns.length, alike: sel.length && uns.length ? sig(sel[0]) === sig(uns[0]) : false };
    });
    if (tabs.alike) fcTabsAlike++;
    fcNoRing += bare.length;
    fcDetail[name] = { stops: seen.size, withoutRing: bare, tabs };
  }
  await page.emulateMedia({ forcedColors: 'none' });
  walks.forcedColors = fcDetail;
  console.log(`forced-colors stops without ring: ${fcNoRing}`);
  console.log(`forced-colors selected tabs indistinguishable: ${fcTabsAlike}`);

  if (shotAt) {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
    await page.setViewportSize({ width: 440, height: 760 });
    await page.goto(`${base}/popup/popup.html`);
    await page.waitForTimeout(900);
    fs.mkdirSync(path.dirname(shotAt), { recursive: true });
    await page.screenshot({ path: shotAt });
    console.log(`forced-colors screenshot: ${shotAt}`);
  }

  // Real-Chrome proof for T-024: the face the canvas will use is actually loaded and checks out.
  await page.emulateMedia({ forcedColors: 'none' });
  await page.goto(`${base}/annotate/annotate.html`);
  await page.waitForTimeout(900);
  const fontCheck = await page.evaluate(async () => {
    const S = await import('../core/shapes.js');
    const ok = await S.ensureCanvasFont();
    return { ensure: ok, check: document.fonts.check('700 16px "Thmanyah Sans"') };
  });
  console.log(`canvas font in Chrome: ${JSON.stringify(fontCheck)}`);
  walks.canvasFont = fontCheck;
} finally {
  await context.close();
  fixture.close();
  for (const dir of [PROFILE, LOADED, EXPORT_DIR]) {
    if (fs.existsSync(dir)) { try { recycle(dir); } catch { console.log(`note: could not recycle ${dir}`); } }
  }
}

const out = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, [...v].sort()]));
try { out['text-spacing'] = JSON.parse(fs.readFileSync(path.join(EXT, 'tools', 'a11y-baseline.json'), 'utf8'))['text-spacing'] || []; } catch { out['text-spacing'] = []; } // D-1010-216: kept across a rewrite
if (checkMode) {
  // T-060 ratchet (npm run test:a11y): nothing is written. A rule id the committed baseline does not list, or any
  // critical or serious node on any page in any theme and language, fails the run. The baseline only ever shrinks.
  const committed = JSON.parse(fs.readFileSync(path.join(EXT, 'tools', 'a11y-baseline.json'), 'utf8'));
  const bad = [];
  for (const [name, runs] of Object.entries(detail)) {
    for (const [key, r] of Object.entries(runs)) {
      for (const v of r.violations) {
        const worst = v.impact === 'critical' || v.impact === 'serious';
        if (worst || !(committed[name] || []).includes(v.id)) bad.push(`${name} ${key}: ${v.id} (${v.impact}, ${v.nodes} nodes) ${v.targets.join(' | ')}`);
      }
    }
  }
  // D-1010-216 (r9-08-4): a text-spacing clip fails unless listed as "page/lang:element" under the baseline key 'text-spacing' (empty).
  const allowedClips = committed['text-spacing'] || [];
  for (const [k, els] of Object.entries(walks.textSpacing?.detail || {})) for (const el of els) if (!allowedClips.includes(`${k}:${el}`)) bad.push(`text-spacing ${k}: ${el} clips its own text under the WCAG 1.4.12 overrides`);
  // D-1010-217 (r9-08-1): the rendered exports. Serious or critical fails; fewer scans than rendered files x 2 schemes also fails.
  const ex = walks.exportScans || { rendered: 0, scans: 0, violations: [], missing: [] };
  for (const v of ex.violations) if (v.impact === 'critical' || v.impact === 'serious') bad.push(`export ${v.key}: ${v.id} (${v.impact}, ${v.nodes} nodes) ${v.targets.join(' | ')}`);
  for (const m of ex.missing) bad.push(`export not scanned: ${m}`);
  if (ex.scans < 12) bad.push(`exports: ${ex.scans} scans ran, 12 expected (defect, suite, session x en, ar x light, dark)`);
  // r2-08-4: nothing may be left unscanned, and the evidence openers are real buttons that Enter presses.
  for (const [k, why] of Object.entries(skipped)) bad.push(`not scanned: ${k} (${why})`);
  const openerRows = Object.entries(walks.openers || {});
  if (!openerRows.some(([, r]) => r.visible > 0 && r.enterOpens === true)) bad.push('evidence openers: no visible opener opened #lightbox on Enter ' + JSON.stringify(walks.openers));
  for (const [k, r] of openerRows) {
    if (r.why) bad.push(`evidence openers ${k}: ${r.why}`);
    else if (r.count && (r.visible && r.enterOpens !== true || r.notButtons || r.notTabbable || r.unlabelled)) bad.push(`evidence openers ${k}: ${JSON.stringify(r)}`);
  }
  for (const [key, b] of Object.entries(walks.chartRing || {})) {
    if (!b.count || (b.good === null && b.bad === null)) bad.push(`chart bars ${key}: none focusable (${b.count} drawn) ${JSON.stringify(b)}`);
    if (b.tabbable === false) bad.push(`chart bars ${key}: a bar is not in the tab order`);
    for (const kind of ['good', 'bad']) if (b[kind] === false) bad.push(`chart bars ${key}: a ${kind} bar has no visible focus ring ${JSON.stringify(b.rows)}`);
  }
  for (const [k, d] of Object.entries(walks.forcedColors || {})) {
    if (d.withoutRing.length) bad.push(`forced-colors ${k}: ${d.withoutRing.length} stop(s) without a ring: ${d.withoutRing.slice(0, 6).join(', ')}`);
    if (d.tabs.alike) bad.push(`forced-colors ${k}: a selected tab looks the same as an unselected one`);
  }
  for (const [k, w] of Object.entries(walks)) {
    for (const [vw, px] of Object.entries(w.overflow || {})) if (px > 1) bad.push(`overflow ${k} at ${vw}: ${px} px past the viewport (${(w.overflowOffenders?.[vw] || []).join(', ')})`);
  }
  if (!Object.keys(walks.forcedColors || {}).length) bad.push('forced-colors walk did not run');
  if (bad.length) { console.error('a11y ratchet FAILED:\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log(`a11y ratchet ok: ${Object.keys(detail).length} pages and states x light/dark x en/ar, zero critical and serious, nothing new; chart bar rings ${JSON.stringify(walks.chartRing)}; not scanned: ${JSON.stringify(skipped)}`);
  process.exit(0);
}
fs.writeFileSync(path.join(EXT, 'tools', 'a11y-baseline.json'), JSON.stringify(out, null, 2) + '\n');
fs.mkdirSync(path.join(REPO, 'work', 'delivery'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'work', 'delivery', 'T-035-axe-detail.json'), JSON.stringify({ detail, walks, skipped }, null, 2) + '\n');

console.log('\npage        critical  serious  passes  elements  (worst violations over theme x language)');
for (const [name, runs] of Object.entries(detail)) {
  let crit = 0, ser = 0;
  for (const { violations: list } of Object.values(runs)) {
    crit = Math.max(crit, list.filter((v) => v.impact === 'critical').reduce((n, v) => n + v.nodes, 0));
    ser = Math.max(ser, list.filter((v) => v.impact === 'serious').reduce((n, v) => n + v.nodes, 0));
  }
  const first = Object.values(runs)[0];
  console.log(`${name.padEnd(11)} ${String(crit).padStart(8)} ${String(ser).padStart(8)} ${String(first.passes).padStart(7)} ${String(first.elements).padStart(9)}   rules: ${out[name].join(', ') || 'none'}`);
}
console.log('\nwalks:', JSON.stringify(walks));
