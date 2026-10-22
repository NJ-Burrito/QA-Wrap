/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The float harness — the first suite that drives `?surface=float` on the
 * shipping extension (critic R12: nothing did before this). Ports the layout
 * probe from `work/ui-rework-0927/prototype/_gates/probe.mjs` onto the real
 * popup, through the granted-extension + armed-session rig `i18n-shots.mjs`
 * already uses, plus a keyboard/focus pass (DESIGN-SPEC §6, attack #23) and
 * one real `chrome.windows.create` float to settle critic §3 item 2 [U].
 *
 *   node tools/float-shots.mjs
 *     [--sizes 392x720,560x720,800x720,360x720,360x560]
 *     [--langs en,ar] [--themes light,dark]
 *     [--states consent,asleep,idle,live,review]
 *     [--out <dir>] [--no-real-window]
 *
 * Output: `results.json` (one row per size×theme×lang×state, plus the single
 * real-window check) and one PNG per row, into `work/float-shots/` by default
 * (ignored — see `.gitignore` §0.7). Exit 1 if any row's `faults` is non-empty.
 * Not in `npm test`; S10 wires `npm run float`.
 *
 * ── the [U] this resolves (see S5-detail.md for the grep it rests on) ───────
 *
 * DESIGN-SPEC's `data-state` (`consent`/`asleep`/`idle`/`live`/`review`,
 * `prototype/DESIGN-SPEC.md:58`) does not exist on the real popup yet — that
 * lands in S6/S7. `?surface=float` only stamps `data-surface` (`popup.js:276`);
 * it carries no state. So state here is driven the way a tester actually
 * reaches it, through the same `UQA_*` messages `clickthrough.mjs` and
 * `i18n-shots.mjs` already send, in the one order a real session can be in:
 *
 *   consent   nothing sent yet — `body[data-consented="false"]`
 *   asleep    `seedConsent()` only (the write `UQA_CONSENT_ACCEPT` makes)
 *   idle      + `UQA_ARM` (no window id: the sender's own window, as
 *             `i18n-shots.mjs:219` already relies on)
 *   live      + `UQA_START` (a session running)
 *   review    + `UQA_STOP`
 *
 * A run before S6/S7 land is *expected* to fault: the 392 cap
 * (`popup.css:120-121`), no `#more`, no roving tabindex. Those are recorded
 * as rows with `faults`, not a crash — the plan reads that run as information,
 * not as this stage failing (§4 S5, "Runs").
 *
 * ponytail: one script, one context per language, no per-shot tool calls.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from './lib-granted.mjs';
import { profile, REPO } from './lib-paths.mjs';

// ---- args -------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const csv = (v, fallback) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback);
const sizesArg = (v, fallback) =>
  v ? v.split(',').map((s) => s.trim().split('x').map(Number)) : fallback;

const SIZES = sizesArg(flag('sizes'), [[392, 720], [560, 720], [800, 720], [360, 720], [360, 560]]);
const LANGS = csv(flag('langs'), ['en', 'ar']);
const THEMES = csv(flag('themes'), ['light', 'dark']);
const STATES = new Set(csv(flag('states'), ['consent', 'asleep', 'idle', 'live', 'review']));
const STATE_ORDER = ['consent', 'asleep', 'idle', 'live', 'review']; // a real session only moves forward
// The side panel: the same page at every width Chrome lets the panel take
// (Nader's screenshot, 29 Sept, was ~440). Layout does not change with the
// theme, so panel rows run in the first theme only.
const PANEL_WIDTHS = csv(flag('panel-widths'), ['320', '360', '400', '440', '520']).map(Number);
const PANEL_H = 900;
// The longest refusal the worker sends (background/media.js), put on the
// status line in review, where it once drew over "Session saved.".
const LONG_REFUSAL = 'Chrome drops permission to record a tab as soon as it navigates. Press Alt+Shift+V on the page, or right-click it and choose QA Wrap → Record a video of this tab, and it will record.';
const SKIP_REAL_WINDOW = argv.includes('--no-real-window');
const OUT = path.resolve(flag('out') || path.join(REPO, 'work', 'float-shots'));
fs.mkdirSync(OUT, { recursive: true });

const computeBp = (w) => (w < 440 ? 'narrow' : w < 720 ? 'medium' : 'wide');

// ---- a tab for UQA_ARM/UQA_START to have something to point at ----------
const FIXTURE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title></head><body><h1>Fixture page under test</h1></body></html>';

// ---- the in-page probe, ported from probe.mjs for the real DOM ----------
// (no `#app`: the shipping popup is `body > .topper + …`, not the prototype's shell)
function probeFn() {
  function isVisible(el) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    // A closed <details> keeps a layout box for its content but paints none of it.
    const shut = el.closest('details:not([open])');
    if (shut && !el.closest('summary') && el !== shut) return false;
    return !el.hidden;
  }
  function describe(el) {
    let d = el.tagName.toLowerCase();
    if (el.id) d += '#' + el.id;
    if (typeof el.className === 'string' && el.className.trim()) d += '.' + el.className.trim().split(/\s+/).join('.');
    return d;
  }
  /*
   * `getBoundingClientRect()` reports an element's full box, not the part a
   * scrolling ancestor actually paints — the last row in a short `overflow:
   * auto` list can report a rect reaching past that ancestor's own bottom
   * edge (its remainder is scrolled out, never painted, never pressable)
   * [V, 560×720 idle: `.app-body` bottom 651px, its last row's rect bottom
   * 677px — 26px that is not on screen]. Overlap and viewport checks below
   * need the painted box, or a row like that reads as "overlapping" whatever
   * real, fully on-screen control sits past its scroller's edge — the
   * session strip, in that case — when nothing is actually drawn on top of
   * anything.
   */
  function clippedRect(el, r) {
    let out = r;
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (!/(auto|scroll|hidden|clip)/.test(cs.overflowY) && !/(auto|scroll|hidden|clip)/.test(cs.overflowX)) continue;
      const cr = n.getBoundingClientRect();
      const top = Math.max(out.top, cr.top), left = Math.max(out.left, cr.left);
      const bottom = Math.min(out.bottom, cr.bottom), right = Math.min(out.right, cr.right);
      if (bottom <= top || right <= left) return null;
      out = { top, left, bottom, right, width: right - left, height: bottom - top };
    }
    return out;
  }
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const scroller = document.scrollingElement;
  const hOverflow = Math.max(0, scroller.scrollWidth - vw);

  // The 392 cap (popup.css:120-121): pre-S6/S4 the body never grows past it,
  // however wide the window is asked to be.
  const bodyW = Math.round(document.body.getBoundingClientRect().width);
  const cappedWidth = bodyW < vw - 1 ? bodyW : null;

  const INTERACTIVE =
    'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], ' +
    '[role="menuitemradio"], [role="radio"], [tabindex]:not([tabindex="-1"]), summary';
  const inViewport = [];
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    const cr = clippedRect(el, r);
    if (!cr || !cr.width || !cr.height) continue;
    inViewport.push({ el, r, cr });
  }

  // The full (unclipped) box: a control 2px into its scroller's edge is not
  // a small target, it is a full-size one that is mostly on screen.
  const tinyTargets = [];
  for (const { el, r } of inViewport) {
    const w = Math.round(r.width), h = Math.round(r.height);
    const primary = el.matches('#start,#stop,[data-action="start"],[data-action="stop"],.btn-primary');
    if (w < 24 || h < 24) tinyTargets.push({ tag: describe(el), w, h, primary });
    else if (primary && (w < 44 || h < 44)) tinyTargets.push({ tag: describe(el), w, h, primary });
  }

  // The clipped box: two rows can never really overlap if one of them is
  // mostly scrolled out of its own container, no matter what their full,
  // unclipped rects say.
  const overlaps = [];
  for (let i = 0; i < inViewport.length; i++) {
    for (let j = i + 1; j < inViewport.length; j++) {
      const { el: ea, cr: a } = inViewport[i], { el: eb, cr: b } = inViewport[j];
      if (ea.contains(eb) || eb.contains(ea)) continue;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2) {
        const cx = Math.max(a.left, b.left) + ox / 2, cy = Math.max(a.top, b.top) + oy / 2;
        const hit = document.elementFromPoint(cx, cy);
        const confirmed = !!hit && (ea.contains(hit) || hit.contains(ea) || eb.contains(hit) || hit.contains(eb));
        if (confirmed) overlaps.push({ a: describe(ea), b: describe(eb), px: Math.round(Math.min(ox, oy)) });
      }
    }
  }

  const tinySeen = new Set(); const tinyText = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw || !r.width || !r.height) continue;
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!direct) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 12) {
      const key = Math.round(px) + '|' + el.textContent.trim().slice(0, 30);
      if (!tinySeen.has(key)) { tinySeen.add(key); tinyText.push({ px: Math.round(px * 10) / 10, text: el.textContent.trim().slice(0, 40) }); }
    }
  }

  function checkCovered(sel) {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { covered: null, note: 'zero-size' };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const covered = !hit || !(el.contains(hit) || hit.contains(el));
    return { covered, rect: { w: Math.round(r.width), h: Math.round(r.height) } };
  }
  // Post-S6 the spec's selector is `[data-action="start"/"stop"]`; today it is
  // `#start`/`#stop` — try the spec's shape first so this needs no edit at S6.
  const startCheck = checkCovered('[data-action="start"]') || checkCovered('#start');
  const stopCheck = checkCovered('[data-action="stop"]') || checkCovered('#stop');

  /*
   * Round 3 (Nader, 29 Sept): the side panel is this same page at whatever
   * width Chrome gives it, and four fault classes only showed there.
   *
   * hScroll   — any scroller with sideways room. `overflow-y: auto` computes
   *             `overflow-x` to auto too, so a scroller's horizontal bar is
   *             invisible to `hOverflow`, which only reads the document.
   * breaks    — a word split across two lines (the "Accessibilit / y" case).
   *             Break points are whitespace, hyphen, slash and dashes; code
   *             and inputs are skipped (locators may break anywhere).
   * truncated — a label cut with an ellipsis ("3 of 7 activities covered in t…").
   * leaks     — text past its own box, or a text element past the card
   *             (bordered or filled ancestor) it sits in.
   * textOver  — two different elements' text painted on the same pixels.
   */
  const hScroll = [];
  const breaks = [];
  const truncated = [];
  const leaks = [];
  const textRects = [];
  const SKIP_TEXT = 'code, pre, input, textarea, script, style, svg, [aria-hidden="true"] *';
  const hasCard = (n) => {
    const cs = getComputedStyle(n);
    const bg = cs.backgroundColor;
    return parseFloat(cs.borderTopWidth) > 0 || (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg));
  };
  const scrolls = (cs) => /(auto|scroll|hidden|clip)/.test(cs.overflowX);
  for (const el of document.querySelectorAll('body *')) {
    if (!isVisible(el) || el.closest('[hidden]')) continue;
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      hScroll.push({ tag: describe(el), px: el.scrollWidth - el.clientWidth });
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || cs.clipPath !== 'none') continue;
    const direct = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!direct.length || el.matches(SKIP_TEXT)) continue;
    const label = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) truncated.push({ tag: describe(el), text: label });
    // A card ancestor this element crosses, up to the first scroller.
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const ncs = getComputedStyle(n);
      if (hasCard(n)) {
        const nr = n.getBoundingClientRect();
        const px = Math.max(nr.left - r.left, r.right - nr.right);
        if (px > 1) leaks.push({ tag: describe(el), card: describe(n), px: Math.round(px), text: label });
        break;
      }
      if (scrolls(ncs)) break;
    }
    for (const tn of direct) {
      const txt = tn.textContent;
      const range = document.createRange();
      for (const m of txt.matchAll(/[^\s\-\/–—]+/g)) {
        range.setStart(tn, m.index);
        range.setEnd(tn, m.index + m[0].length);
        const rects = [...range.getClientRects()].filter((q) => q.width > 0.5);
        const tops = new Set(rects.map((q) => Math.round(q.top / 3)));
        if (tops.size > 1) breaks.push({ tag: describe(el), word: m[0] });
        for (const q of rects) {
          if (q.right > r.right + 1.5 || q.left < r.left - 1.5) {
            if (!scrolls(cs)) leaks.push({ tag: describe(el), card: 'its own box', px: Math.round(Math.max(q.right - r.right, r.left - q.left)), text: label });
          }
          const cq = clippedRect(el, q);
          if (cq && cq.width > 0.5 && cq.bottom > 0 && cq.top < vh) textRects.push({ el, q: cq });
        }
      }
    }
  }
  const textOver = [];
  const seenPair = new Set();
  for (let i = 0; i < textRects.length; i++) {
    for (let j = i + 1; j < textRects.length; j++) {
      const A = textRects[i], B = textRects[j];
      if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const ox = Math.min(A.q.right, B.q.right) - Math.max(A.q.left, B.q.left);
      const oy = Math.min(A.q.bottom, B.q.bottom) - Math.max(A.q.top, B.q.top);
      if (ox > 2 && oy > 3) {
        const key = describe(A.el) + '|' + describe(B.el);
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        textOver.push({ a: describe(A.el), b: describe(B.el), text: (A.el.textContent.trim().slice(0, 24) + ' / ' + B.el.textContent.trim().slice(0, 24)) });
      }
    }
  }
  // A control cut at the side by the box that clips it (a favourite icon half
  // off the peek). Cut at the top or bottom is only scrolling, so not counted.
  for (const { el, r, cr } of inViewport) {
    if (r.left < cr.left - 1 || r.right > cr.right + 1) leaks.push({ tag: describe(el), card: 'its clipping box (control cut off)', px: Math.round(Math.max(cr.left - r.left, r.right - cr.right)), text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) });
  }
  const dedupe = (list) => [...new Map(list.map((x) => [JSON.stringify(x), x])).values()];

  return {
    hScroll, breaks: dedupe(breaks), truncated: dedupe(truncated), leaks: dedupe(leaks), textOver,
    viewport: { w: vw, h: vh }, bodyWidth: bodyW, cappedWidth, hOverflow,
    interactiveVisible: inViewport.length, tinyTargets, overlaps, tinyText,
    startCheck, stopCheck,
    dir: document.documentElement.dir, lang: document.documentElement.lang,
    dataSurface: document.documentElement.dataset.surface || null,
    dataState: document.documentElement.dataset.state || null, // [U] until S6/S7 stamp it
  };
}

/**
 * DESIGN-SPEC §6 keyboard/focus, attack #23. Best-effort: the landmarks and
 * `#more` it looks for do not exist before S6, so "not found" is the honest,
 * expected answer there, not a thrown error.
 */
async function keyboardProbe(page) {
  const info = { tabOrder: [], moreFound: false, moreOpensOnEnter: null, moreOpensOnArrowDown: null, escReturnsFocusToMore: null, rovingTabindex: null };
  try {
    await page.evaluate(() => document.activeElement?.blur());
    const describeActive = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const tag = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
        const landmark = el.closest('header, .session, nav.tools, .tools, main.work, .work');
        return { tag, landmark: landmark ? landmark.tagName.toLowerCase() + (landmark.className && typeof landmark.className === 'string' ? '.' + landmark.className.trim().split(/\s+/)[0] : '') : null };
      });
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      info.tabOrder.push(await describeActive());
    }

    const more = await page.$('#more');
    info.moreFound = !!more;
    if (more) {
      await more.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      info.moreOpensOnEnter = await page.evaluate(() => document.getElementById('more')?.getAttribute('aria-expanded') === 'true');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      info.escReturnsFocusToMore = await page.evaluate(() => document.activeElement?.id === 'more');

      await more.focus();
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(100);
      info.moreOpensOnArrowDown = await page.evaluate(() => document.getElementById('more')?.getAttribute('aria-expanded') === 'true');
      await page.keyboard.press('Escape').catch(() => {});
    }

    const rowCount = await page.evaluate(() => document.querySelectorAll('.tool-row[data-tool], [data-tool]').length);
    if (rowCount) {
      const tabStops = await page.evaluate(() => [...document.querySelectorAll('.tool-row[data-tool], [data-tool]')].filter((r) => r.tabIndex === 0).length);
      info.rovingTabindex = tabStops <= 1;
    }
  } catch (e) {
    info.error = String(e?.message || e);
  }
  return info;
}

/**
 * One real `chrome.windows.create` float, to settle critic §3 item 2 [U]:
 * whether the inner box you get is the 560×720 you asked for.
 *
 * Requires the context to have been launched with `viewport: null` — with a
 * fixed context viewport Playwright forces it onto *every* page in that
 * context, including one this script never called `newPage()` for, and the
 * "real" window then reports the context's default size back [V, this run].
 */
async function realFloatCheck(worker, context) {
  const requested = { width: 560, height: 720 };
  try {
    const pagePromise = context.waitForEvent('page', { timeout: 8000 });
    const windowId = await worker.evaluate((req) =>
      chrome.windows
        .create({ url: chrome.runtime.getURL('popup/popup.html?surface=float'), type: 'popup', ...req })
        .then((w) => w.id), requested);
    const floatPage = await pagePromise;
    await floatPage.waitForLoadState('domcontentloaded').catch(() => {});
    await floatPage.waitForTimeout(300);
    const inner = await floatPage.evaluate(() => ({ innerWidth, innerHeight })).catch(() => null);
    const outer = await worker.evaluate((id) => chrome.windows.get(id), windowId).catch(() => null);
    await worker.evaluate((id) => chrome.windows.remove(id).catch(() => {}), windowId).catch(() => {});
    return { ok: !!inner, windowId, requested, inner, outerBounds: outer ? { width: outer.width, height: outer.height, left: outer.left, top: outer.top } : null };
  } catch (e) {
    return { ok: false, requested, error: String(e?.message || e) };
  }
}

function collectFaults(probe) {
  const faults = [];
  if (probe.hOverflow > 0) faults.push(`horizontal overflow ${probe.hOverflow}px`);
  for (const o of probe.overlaps) faults.push(`overlap: ${o.a} × ${o.b} (${o.px}px)`);
  for (const t of probe.tinyTargets) faults.push(`tiny target ${t.tag} ${t.w}x${t.h}${t.primary ? ' (primary action, needs 44)' : ' (needs 24)'}`);
  for (const t of probe.tinyText) faults.push(`text under 12px: ${t.px}px "${t.text}"`);
  if (probe.startCheck?.covered) faults.push('Start is covered by another element');
  if (probe.stopCheck?.covered) faults.push('Stop is covered by another element');
  for (const x of probe.hScroll) faults.push(`horizontal scroll ${x.px}px in ${x.tag}`);
  for (const x of probe.breaks) faults.push(`word broken across lines: "${x.word}" in ${x.tag}`);
  for (const x of probe.truncated) faults.push(`label cut off: "${x.text}" (${x.tag})`);
  for (const x of probe.leaks) faults.push(`leaks ${x.px}px past ${x.card}: "${x.text}" (${x.tag})`);
  for (const x of probe.textOver) faults.push(`text over text: ${x.a} × ${x.b} ("${x.text}")`);
  if (probe.cappedWidth != null) faults.push(`body capped at ${probe.cappedWidth}px inside a ${probe.viewport.w}px window (the 392 cap; S4/S6 remove it)`);
  return faults;
}

// ---- run --------------------------------------------------------------
const results = [];
let realWindow = null;
let anyFault = false;

for (const lang of LANGS) {
  const EXT = grantedExtension({ label: `float-shots-${lang}` });
  const PROFILE = profile(`.float-shots-profile-${lang}` + (process.env.UQA_PROFILE_SUFFIX || ''));
  purgeWorkerCache(PROFILE);
  // `viewport: null` so the one real window below reports its own real size —
  // every page still gets an explicit size from `setViewportSize()` per combo.
  const context = await chromium.launchPersistentContext(PROFILE, { ...launchOptions(EXT), viewport: null });
  await keepOnTop(context); // test window stays above others; released on close

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(FIXTURE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const worker = await freshWorker(context);
    const id = new URL(worker.url()).host;
    await awaitSiteScripts(worker);

    const fixture = await context.newPage();
    await fixture.goto(origin, { waitUntil: 'domcontentloaded' });

    const ctl = await context.newPage();
    await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
    const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
    const tabId = await ctl.evaluate(async (o) => (await chrome.tabs.query({ url: `${o}/*` }))[0]?.id ?? null, origin);

    await ctl.evaluate((l) => { try { localStorage.setItem('qaw-lang', l); } catch { /* no storage */ } }, lang);
    await ctl.evaluate(() => { try { localStorage.setItem('qaw-tutorial-seen', '1'); } catch { /* no storage */ } });
    if (lang !== 'en') await ctl.evaluate((l) => new Promise((r) => chrome.storage.sync.set({ qawLanguage: l }, r)), lang);

    if (!SKIP_REAL_WINDOW && !realWindow) {
      realWindow = await realFloatCheck(worker, context);
      console.log(`real float window: ${JSON.stringify(realWindow)}`);
    }

    for (const state of STATE_ORDER) {
      if (state === 'asleep') await seedConsent(worker);
      if (state === 'idle') {
        const woke = await call({ type: 'UQA_ARM' });
        if (!woke?.ok) throw new Error(`could not wake for state idle: ${JSON.stringify(woke)}`);
      }
      if (state === 'live') {
        await call({
          type: 'UQA_START',
          charter: 'Submit fails with 500',
          tabId,
          startUrl: `${origin}/`,
          env: { viewport: '1280x900 @1x', userAgent: 'Chrome/126', platform: 'Win32', language: lang === 'ar' ? 'ar-JO' : 'en-US' },
        });
      }
      if (state === 'review') await call({ type: 'UQA_STOP' });
      if (!STATES.has(state)) continue;

      for (const theme of THEMES) {
        await ctl.evaluate((t) => { try { localStorage.setItem('qaw-theme', t); } catch { /* no storage */ } }, theme);
        const combos = [
          ...SIZES.map(([w, h]) => ['float', w, h]),
          ...(theme === THEMES[0] ? PANEL_WIDTHS.map((w) => ['panel', w, PANEL_H]) : []),
        ];
        for (const [surface, w, h] of combos) {
          await ctl.setViewportSize({ width: w, height: h });
          await ctl.goto(`chrome-extension://${id}/popup/popup.html?surface=${surface}`);
          // The worker's UQA_SITE_ACCESS round trip alone takes ~411ms here; a fixed
          // 300ms probed before boot finished (S7's CHALLENGE). Wait for the page's
          // own signal first (work/float-shots/float-shots-booted.mjs, the S6 copy).
          await ctl.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 15000 });
          await ctl.waitForTimeout(300);
          if (state === 'review') {
            await ctl.evaluate((text) => { const st = document.getElementById('status'); st.textContent = text; st.className = 'status err'; }, LONG_REFUSAL);
            await ctl.waitForTimeout(100);
          }

          const probe = await ctl.evaluate(probeFn);
          const keyboard = await keyboardProbe(ctl);
          const faults = collectFaults(probe);
          if (faults.length) anyFault = true;

          const name = `${surface}-${w}x${h}-${theme}-${lang}-${state}`;
          await ctl.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});

          results.push({ name, surface, w, h, bp: computeBp(w), theme, lang, state, probe, keyboard, faults });
          console.log(`${faults.length ? 'FAULT' : 'ok   '} ${name}  faults=${faults.length} overflow=${probe.hOverflow} overlap=${probe.overlaps.length} tiny=${probe.tinyTargets.length}`);
        }
      }
    }
  } finally {
    await context.close();
    server.close();
  }
}

fs.writeFileSync(
  path.join(OUT, 'results.json'),
  JSON.stringify({ ranAt: new Date().toISOString(), sizes: SIZES, langs: LANGS, themes: THEMES, states: [...STATES], realWindow, results }, null, 2)
);
console.log(`\n${results.length} combination(s) -> ${OUT}`);
console.log(anyFault ? '\nfault(s) found (see above / results.json)\n' : '\nno fault on any combination\n');

process.exit(anyFault ? 1 : 0);
