/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The Arabic pass: every surface, in Arabic, measured rather than admired.
 *
 *   node tools/i18n-shots.mjs [outDir]
 *
 * A key table that is complete and an interface that works in Arabic are two
 * different claims. `tools/test-i18n.mjs` proves the first from the files;
 * only a browser can prove the second, because what breaks a right-to-left
 * layout is a `margin-left` somewhere in 2,000 lines of CSS and a sentence that
 * is 30% longer than the one the column was measured for.
 *
 * So this opens the popup, Settings, the consent notice and the report with the
 * language set to Arabic, and asserts three things per surface:
 *
 *   1. `dir="rtl"` is actually on the root. If the stamp did not happen, every
 *      other measurement below is measuring an LTR page with Arabic words in it,
 *      which passes and means nothing.
 *   2. the document does not scroll sideways. A page whose content is wider
 *      than its own viewport is the single most common RTL failure and the one
 *      a person notices first.
 *   3. no element LOSES content. That is the product's own test, lifted from
 *      `content/rtl-stress.js`: an element that overflows AND clips (hidden or
 *      ellipsis) AND is not scrollable has text in it that nobody can read.
 *      An element that overflows into a scroller is a scroller doing its job,
 *      and flagging it would make this suite noise.
 *
 * The widths are the real ones: 380 for the popup, which is drawn at 348 with
 * the float capped at 392, and 390 for the report, which is the iPhone 14
 * width the viewport tool and `tools/test-report.mjs` already measure against.
 *
 * Screenshots land in `work/ui-shots/ar/`, outside the extension folder, so
 * nothing here can reach a package: `work/` is at the repository root and is
 * git-ignored. They are evidence for a person, not an assertion.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from './lib-granted.mjs';
import { profile, UI_SHOTS } from './lib-paths.mjs';

/*
 * A copy of the extension with the site permission already granted, and the
 * consent already recorded, exactly as `tools/clickthrough.mjs` runs.
 *
 * Without both, this measured the wrong product. The popup's consent gate hides
 * the switch and all nineteen tools behind one card, and the report with no
 * session shows nine empty tabs: a suite that screenshotted those would report
 * "no Arabic layout problem" about a page with almost no Arabic on it. The tool
 * wall is where the long sentences are and therefore where a right-to-left
 * layout actually breaks.
 */
const EXT = grantedExtension({ label: 'i18n-shots' });

const OUT = path.resolve(process.argv[2] || path.join(UI_SHOTS, 'ar'));
// UQA_PROFILE_SUFFIX lets two runs share a machine: one Chromium profile cannot be opened twice.
const PROFILE = profile('.i18n-shots-profile' + (process.env.UQA_PROFILE_SUFFIX || ''));

fs.mkdirSync(OUT, { recursive: true });

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

/**
 * The clip test, as `content/rtl-stress.js` runs it on a page under test.
 *
 * Two passes on purpose, and the reason is in that file: `getComputedStyle` on
 * every node is the expensive half, so measure first and resolve style only for
 * the handful that actually overflowed.
 */
const CLIPPED = () => {
  const overflowing = [];
  for (const el of document.querySelectorAll('*')) {
    const cw = el.clientWidth;
    if (!cw && !el.clientHeight) continue;
    if (el.scrollWidth > cw + 1 || el.scrollHeight > el.clientHeight + 1) overflowing.push(el);
  }
  /*
   * How much vertical overflow is a word nobody can read.
   *
   * A font's glyph box is taller than its line box: a tall Arabic face at 15px once reported a
   * 25px scroll height inside a 23px line, in English and in Arabic alike, and
   * nothing is hidden by it because no glyph reaches that far. Measured on the
   * popup's brand name and the report's subtitle, identical in both languages.
   * What IS hidden is a whole line, so the threshold is half of one: less than
   * that is the font, more than that is a sentence.
   */
  const linesLost = (el, style) => {
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 16;
    return el.scrollHeight - el.clientHeight > line / 2;
  };
  const hits = [];
  for (const el of overflowing) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    // A screen-reader-only element IS a 1px box that clips, on purpose. Its
    // content is not lost; it is offered to a screen reader and taken off the
    // screen. Flagging it would report the accessibility feature as the fault.
    if (el.closest('.visually-hidden, .sr-only')) continue;
    const clips = style.overflow === 'hidden' || style.overflowX === 'hidden' || style.textOverflow === 'ellipsis';
    const scrollable = /(auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY);
    if (!clips || scrollable) continue;
    if (el.scrollWidth <= el.clientWidth + 1 && !linesLost(el, style)) continue;
    hits.push({
      tag: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''),
      overflowX: el.scrollWidth - el.clientWidth,
      overflowY: el.scrollHeight - el.clientHeight,
      text: (el.textContent || '').trim().slice(0, 60),
    });
  }
  return hits;
};

const SIDEWAYS = () => {
  const root = document.documentElement;
  /*
   * Which element is actually sticking out.
   *
   * A page that scrolls sideways always reports it on `body`, which is the
   * symptom and never the cause. The cause is one element whose box crosses
   * the viewport edge, so it is named here: the widest offender, its box, and
   * enough of its text to recognise it on screen.
   */
  const wide = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const over = Math.max(0, Math.round(r.right - root.clientWidth), Math.round(-r.left));
    if (over > 1) wide.push({ over, tag: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : ''), text: (el.textContent || '').trim().slice(0, 50) });
  }
  wide.sort((a, b) => b.over - a.over);
  return {
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    dir: root.dir,
    lang: root.lang,
    offenders: wide.slice(0, 4),
  };
};

let failed = 0;
const shots = [];

async function audit(name, page) {
  const box = await page.evaluate(SIDEWAYS);
  const hits = await page.evaluate(CLIPPED);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(name);

  const problems = [];
  if (box.dir !== 'rtl') problems.push(`dir is "${box.dir}", not "rtl" — nothing below this line was measured in Arabic`);
  if (box.lang !== 'ar') problems.push(`lang is "${box.lang}", not "ar"`);
  if (box.scrollWidth > box.clientWidth + 1) {
    problems.push(`scrolls sideways: ${box.scrollWidth}px of content in a ${box.clientWidth}px viewport`);
    for (const o of box.offenders) problems.push(`  sticking out by ${o.over}px: ${o.tag}  "${o.text}"`);
  }
  for (const h of hits) {
    problems.push(`clips: ${h.tag} loses ${h.overflowX}x${h.overflowY}px  "${h.text.replace(/s+/g, ' ')}"`);
    // A clip on body or html is the symptom; the cause is one element sticking
    // out past the viewport, so name it rather than sending anybody to <body>.
    if (/^(body|html)/.test(h.tag)) for (const o of box.offenders) problems.push(`  sticking out by ${o.over}px: ${o.tag}  "${o.text}"`);
  }

  if (problems.length) {
    failed += problems.length;
    console.log(`  FAIL  ${name}`);
    for (const p of problems) console.log(`          ${p}`);
  } else {
    console.log(`  ok    ${name}  (${box.clientWidth}px, rtl)`);
  }
}

purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT));
await keepOnTop(context); // test window stays above others; released on close

try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  // A registration reaches the NEXT navigation and no other, so the fixture
  // must not open in the same tick as the worker's first breath.
  await awaitSiteScripts(worker);

  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });

  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);

  const tabId = await ctl.evaluate(
    async (o) => (await chrome.tabs.query({ url: `${o}/*` }))[0]?.id ?? null,
    origin,
  );

  const woke = await call({ type: 'UQA_ARM' });
  if (!woke?.ok) throw new Error(`could not wake the extension: ${JSON.stringify(woke)}`);
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'domcontentloaded' });

  // A surface with nothing in it hides every layout fault it has, so the
  // session is seeded before a single measurement is taken.
  await call({
    type: 'UQA_START',
    charter: 'إرسال الطلب يعيد الخطأ 500',
    tabId,
    startUrl: `${origin}/`,
    env: { viewport: '1280×900 @1x', userAgent: 'Chrome/126', platform: 'Win32', language: 'ar-JO' },
  });
  await page.waitForTimeout(400);
  await page.bringToFront();
  await page.fill('#applicant', 'نادر');
  await page.fill('#pw', 'hunter2');
  await page.click('#submit');
  await page.waitForTimeout(1200);
  await call({ type: 'UQA_CAPTURE', text: 'حالة الخطأ بعد الإرسال' });
  await call({ type: 'UQA_NOTE', text: 'الإرسال يعيد 500 عند انتهاء صلاحية المستند.', tag: 'bug' });
  await call({ type: 'UQA_SCAN_A11Y', tabId });
  await call({ type: 'UQA_SCAN_PERF', tabId });

  // Arabic, chosen the way a tester chooses it. The durable copy is what the
  // other surfaces read on load, and the mirror is what the next page paints
  // from before it has asked anything.
  await ctl.evaluate(
    () => new Promise((r) => {
      try { localStorage.setItem('qaw-lang', 'ar'); } catch { /* no storage */ }
      chrome.storage.sync.set({ qawLanguage: 'ar' }, r);
    }),
  );
  // And nothing on any of these pages should still be pointing at the films.
  await ctl.evaluate(() => { try { localStorage.setItem('qaw-tutorial-seen', '1'); } catch { /* no storage */ } });

  /* ── the popup, at the float's three widths ──────────────────────────────
   * v2 (critic R11): a bare `popup.html` is the fixed 348×580 box — widening
   * the viewport around it tested nothing. `?surface=float` is what actually
   * reflows at 392/560/800 (`popup.css:102-121`), so that is what this shoots.
   */
  for (const w of [392, 560, 800]) {
    await ctl.setViewportSize({ width: w, height: 720 });
    await ctl.goto(`chrome-extension://${id}/popup/popup.html?surface=float`);
    await ctl.waitForTimeout(900);
    await audit(`popup-${w}`, ctl);
  }

  // Scrolled to the bottom, at the narrow width: the tool wall is where the
  // long Arabic sentences are, and the topper has to survive them.
  await ctl.setViewportSize({ width: 392, height: 720 });
  await ctl.goto(`chrome-extension://${id}/popup/popup.html?surface=float`);
  await ctl.waitForTimeout(900);
  await ctl.evaluate(() => document.getElementById('body')?.scrollTo(0, 9999));
  await ctl.waitForTimeout(300);
  await audit('popup-392-scrolled', ctl);

  /* ── Settings ──────────────────────────────────────────────────────────── */
  const opts = await context.newPage();
  await opts.setViewportSize({ width: 900, height: 1000 });
  await opts.goto(`chrome-extension://${id}/options/options.html`);
  await opts.waitForTimeout(1200);
  await audit('options', opts);
  await opts.close();

  /* ── the consent notice ────────────────────────────────────────────────── */
  const wel = await context.newPage();
  await wel.setViewportSize({ width: 1000, height: 900 });
  await wel.goto(`chrome-extension://${id}/welcome/welcome.html`);
  await wel.waitForTimeout(700);
  await audit('welcome', wel);
  await wel.close();

  /* ── the report, wide and then at 390 ──────────────────────────────────── */
  const rep = await context.newPage();
  await rep.setViewportSize({ width: 1100, height: 900 });
  await rep.goto(`chrome-extension://${id}/report/report.html`);
  await rep.waitForTimeout(1600);
  await audit('report', rep);

  for (const tab of ['broke', 'timeline', 'quality']) {
    await rep.click(`#sec-${tab === 'quality' ? 'quality' : 'findings'}`).catch(() => {});
    await rep.click(`[data-tab="${tab}"]`).catch(() => {});
    await rep.waitForTimeout(500);
    await audit(`report-${tab}`, rep);
  }

  // 390px is the width the product's own viewport tool calls iPhone 14, and the
  // one a report gets opened at when somebody reads it on a phone.
  await rep.setViewportSize({ width: 390, height: 844 });
  await rep.waitForTimeout(600);
  await audit('report-390', rep);
  await rep.close();

  console.log(`\n${shots.length} surface(s) shot into ${OUT}`);
  console.log(
    failed
      ? `\n${failed} Arabic layout problem(s). Fix the CSS with logical properties, not with a [dir="rtl"] rule.\n`
      : '\nno Arabic layout problem on any surface\n',
  );
} finally {
  await context.close();
  server.close();
}

process.exit(failed ? 1 : 0);
