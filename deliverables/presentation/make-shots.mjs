/* QA Wrap: local-first QA toolkit in the ISTQB shape. */
/**
 * The twelve presentation shots, taken by walking the demo script.
 *
 *   node deliverables/presentation/make-shots.mjs      # run from extension/
 *
 * This is the P2 capture. It is deliberately the SAME walk as
 * `deliverables/presentation/README.md`: every step below is a step of the
 * live demo, in the order Nader performs it, on the permits fixture the films
 * and the suites both use (`tools/film/record/fixture.mjs`). If the demo
 * script and this file ever disagree, the file is wrong, because the file is
 * the thing that was run.
 *
 * Two browsers, on purpose:
 *
 *   1. a persistent context with the extension loaded, at deviceScaleFactor 2,
 *      which is where the product is driven and the raw surfaces are captured
 *      (a 380px popup upscaled onto a 1920px board is a blurred popup);
 *   2. a plain browser at 1920x1080 and scale 1, which composes each raw
 *      capture onto a slide board. Same board grammar as `tools/store-shots.mjs`,
 *      scaled from 1280x800 to 1920x1080.
 *
 * The profile lives outside the repository and is recycled by hand afterwards
 * with safe-delete; other engineers are running headed suites in this tree and
 * a stray `.profile` here is theirs, not mine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchOptions } from '../../extension/tools/lib-launch.mjs';
import { freshWorker, purgeWorkerCache } from '../../extension/tools/lib-fresh.mjs';
import { startFixture, APPLICATION } from '../../extension/tools/film/record/fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..', '..', 'extension');

/* Playwright is installed in `extension/node_modules`, and Node resolves a
   bare specifier from the importing FILE, not the working directory. This
   file lives two directories away from that tree, so it asks for the package
   from where the package is. */
const { chromium } = createRequire(path.join(EXT, 'package.json'))('playwright');
const SHOTS = path.join(HERE, 'shots');
const RAW = path.join(process.env.TEMP || HERE, 'qa-wrap-p2-raw');
const PROFILE = path.join(process.env.TEMP || HERE, 'qa-wrap-p2-profile');

/* The film fixture's own port is 8973 and another engineer is filming on it
   tonight. Anything else, so the two runs cannot collide. */
const PORT = Number(process.env.UQA_P2_PORT || 8991);

/* Set when research/38 records the diagram label fix. Until then the diagram
   slide is named PENDING so nobody puts it on a projector by accident. */
const DIAGRAM_LABELS_FIXED = process.env.UQA_P2_DIAGRAM_FIXED === '1';

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

const url = (p) => pathToFileURL(p).href;
const lockup = url(path.join(EXT, 'brand', 'lockup.svg'));
const fonts = url(path.join(EXT, 'ui', 'fonts.css'));
const tokens = url(path.join(EXT, 'ui', 'identity-tokens.css'));

const walked = [];
const note = (step, sees) => {
  walked.push({ step, sees });
  console.log(`  walked  ${step}\n            audience sees: ${sees}`);
};
const problems = [];
const snag = (step, why) => {
  problems.push({ step, why });
  console.log(`  SNAG    ${step}\n            ${why}`);
};

/* ── the slide board ──────────────────────────────────────────────────────
   1920x1080. A mark, a claim, one line of caption, and the picture. The
   captions are the product's own words, so a slide and the popup under it
   cannot say different things. */
const chrome_ = `border-radius:14px;box-shadow:0 26px 70px rgba(20,35,42,.22), 0 0 0 1px var(--border);overflow:hidden;background:var(--surface)`;
const head = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${fonts}"><link rel="stylesheet" href="${tokens}">`;

/** A wide surface: the claim across the top, the picture filling the rest. */
const boardWide = ({ title, caption, image, width, top }) => `${head}
<style>
  html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:var(--surface-sunken);color:var(--text);font:20px/1.5 var(--font)}
  .top{display:flex;align-items:center;gap:18px;padding:48px 84px 0}
  .top img{height:50px}
  h1{margin:30px 84px 10px;font:800 44px/1.12 var(--display);letter-spacing:-0.5px;max-width:1400px}
  p{margin:0 84px;color:var(--text-muted);max-width:1180px;font-size:22px}
  .stage{position:absolute;left:0;right:0;bottom:0;top:${top || 272}px;display:flex;justify-content:center;align-items:flex-start;overflow:hidden}
  .shot{width:${width}px;${chrome_}}
  .shot img{display:block;width:100%}
</style>
<div class="top"><img src="${lockup}" alt=""></div>
<h1>${title}</h1><p>${caption}</p>
<div class="stage"><div class="shot"><img src="${image}" alt=""></div></div>`;

/**
 * A narrow surface: the words on the left, the panel on the right, at 1:1.
 *
 * The popup is 380 CSS pixels wide and nothing makes it wider. Laid across a
 * 1920 board under a headline it is a stamp in a field, and scaled up to fill
 * the board it is a blurred stamp. Beside the words at its own size it is
 * neither: the capture is taken at scale 2 and drawn at 380, so every label on
 * it is sharper on the projector than it is on the presenter's screen.
 */
const boardSide = ({ title, caption, image, width, height }) => `${head}
<style>
  html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:var(--surface-sunken);color:var(--text);font:20px/1.5 var(--font)}
  .grid{position:absolute;inset:0;display:grid;grid-template-columns:1fr ${Math.round(width * 1.9)}px;align-items:center}
  .words{padding:0 60px 0 96px}
  .words img{height:50px;display:block;margin-bottom:44px}
  h1{margin:0 0 20px;font:800 52px/1.1 var(--display);letter-spacing:-0.6px}
  p{margin:0;color:var(--text-muted);font-size:24px;max-width:640px}
  .stage{display:flex;justify-content:center;align-items:center;height:100%}
  .shot{width:${width}px;height:${height}px;${chrome_}}
  .shot img{display:block;width:100%}
</style>
<div class="grid">
  <div class="words"><img src="${lockup}" alt=""><h1>${title}</h1><p>${caption}</p></div>
  <div class="stage"><div class="shot"><img src="${image}" alt=""></div></div>
</div>`;

/* One slide: which raw capture, what it is called, and how it is laid out. */
const SLIDES = [];
const slide = (raw, name, title, caption, width, top) =>
  SLIDES.push({ raw, name, title, caption, width, top, kind: 'wide' });
const slideSide = (raw, name, title, caption) =>
  SLIDES.push({ raw, name, title, caption, width: POPUP_W, height: POPUP_H, kind: 'side' });

/* The popup is captured tall so a slide can show a whole group of tools and
   not four tiles with the fifth cut in half. */
const POPUP_W = 380;
const POPUP_H = 860;

const fixture = await startFixture({ port: PORT });
console.log(`\npermits fixture on ${fixture.origin}`);

purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, {
  ...launchOptions(EXT),
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
/* A demo that hangs is worse than a demo that fails: on the first walk the
   value palette pegged a renderer and the run sat there for ten minutes with
   nothing to show. Every wait is bounded now, and every stage is bounded on
   top of that, so a stuck step costs one slide and not the run. */
context.setDefaultTimeout(15000);

/** Run one stage of the demo with a wall clock on it. A failure is a snag. */
async function stage(name, ms, fn) {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`no answer in ${ms / 1000}s`)), ms); }),
    ]);
  } catch (err) {
    snag(name, err.message.split('\n')[0]);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Click a page element the way a hand does.
 *
 * Not `page.click()`: the in-page tools mount a highlight layer over whatever
 * is under the pointer, so Playwright's actionability check waits for an
 * element that will never be on top. The pointer goes to the element's own
 * box instead, which is what the picker and the palette are reading anyway.
 */
async function handClick(page, selector) {
  const box = await page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }, selector);
  if (!box) throw new Error(`${selector} is not on the page`);
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
  await page.waitForTimeout(150);
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  return box;
}

const errors = [];
const watch = (target, label) => {
  target.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  target.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`);
  });
};

try {
  const worker = await freshWorker(context);
  watch(worker, 'worker');
  const id = new URL(worker.url()).host;

  const page = await context.newPage();
  watch(page, 'page');
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto(fixture.origin, { waitUntil: 'domcontentloaded' });

  const popup = await context.newPage();
  watch(popup, 'popup');
  /* `?surface=panel` is the docked workbench: the same page, sized to the
     window instead of to Chrome's 348x580 popup box. It is what the demo
     script tells Nader to present from, because the floating popup closes the
     moment he clicks the page, so it is what the slides should show. */
  await popup.goto(`chrome-extension://${id}/popup/popup.html?surface=panel`);
  await popup.setViewportSize({ width: POPUP_W, height: POPUP_H });
  await popup.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 20000 });
  /* The first-run sign that points at the films is real and it is the right
     thing on a fresh machine. It is not what a slide about the product should
     be a picture of. */
  await popup.evaluate(() => {
    try {
      localStorage.setItem('qaw-tutorial-seen', '1');
      localStorage.setItem('qaw-mode', 'simple');
    } catch { /* still applies for this page */ }
  });
  await popup.reload();
  await popup.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 20000 });
  await popup.waitForTimeout(600);
  const surface = await popup.evaluate(() => document.documentElement.dataset.surface);
  if (surface !== 'panel') snag('setup', `the panel did not know it was docked: surface=${surface}`);

  const shoot = async (name, target, opts = {}) => {
    const file = path.join(RAW, `${name}.png`);
    await target.screenshot({ path: file, ...opts });
    return file;
  };

  /* ── 1. asleep, which is the default ──────────────────────────────────── */
  const asleep = await popup.evaluate(() => ({
    awake: document.body.dataset.awake,
    title: document.getElementById('switch-title').textContent.trim(),
    note: document.getElementById('switch-note').textContent.trim(),
    live: [...document.querySelectorAll('[data-action]')].filter((b) => !b.disabled).length,
  }));
  await shoot('01-asleep', popup);
  if (asleep.awake !== 'false' || asleep.live !== 0) {
    snag('1. Asleep', `came up awake=${asleep.awake}, ${asleep.live} tools live`);
  } else {
    note('1. Asleep is the default', `"${asleep.title}: ${asleep.note}", every tool greyed out`);
  }
  slideSide('01-asleep', '01-what-it-is', 'It is asleep until you wake it.',
    'Nothing is watched, hooked or read until you press the switch. No account, no upload, nothing leaves this browser.', 560);

  /* ── 2. wake, and name the test ───────────────────────────────────────── */
  await popup.click('#switch');
  await popup.waitForFunction(() => document.body.dataset.awake === 'true', { timeout: 10000 });
  await popup.fill('#charter', 'Submit a food import permit');
  await popup.waitForTimeout(500);
  const awake = await popup.evaluate(() => ({
    title: document.getElementById('switch-title').textContent.trim(),
    live: [...document.querySelectorAll('[data-action]')].filter((b) => !b.disabled).length,
  }));
  await shoot('02-charter', popup);
  note('2. Wake up, and name the test',
    `the switch flips to "${awake.title}", ${awake.live} tools come alive, the charter reads "Submit a food import permit"`);
  slideSide('02-charter', '02-wake-and-charter', 'Wake it, and name what you are testing.',
    'The charter is the one sentence the whole session is measured against. It goes on the report, the session sheet and the workflow diagram.', 560);

  /* ── 3. start recording ───────────────────────────────────────────────── */
  await popup.click('#start');
  await popup.waitForFunction(() => !document.getElementById('step-live').hidden, { timeout: 10000 });
  note('3. Start recording', 'the panel switches to the live card: a running clock, an event count and a problem count');

  /* ── 4. test the page the way you always do ───────────────────────────── */
  await page.bringToFront();
  await page.fill('#applicant', APPLICATION.applicant);
  await page.fill('#email', APPLICATION.email);
  await page.fill('#quantity', APPLICATION.quantity);
  await page.selectOption('#country', APPLICATION.country);
  await page.waitForTimeout(400);
  note('4. Fill the form', `the permits portal with ${APPLICATION.applicant}'s application typed into it`);

  /* ── 5. mask the real data, before anything is photographed ───────────── */
  await stage('5. Mask the real data', 45000, async () => {
    await popup.bringToFront();
    await popup.locator('[data-action="mask"]').click();
    await popup.waitForTimeout(500);
    const maskArmed = ((await popup.locator('#status').textContent()) || '').trim();
    await page.bringToFront();
    await handClick(page, '#applicant');
    await page.waitForTimeout(600);
    const covered = await page.evaluate(() => document.querySelectorAll('[data-uqa-masked]').length);
    await shoot('06-mask', page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (!covered) throw new Error('clicking the applicant field covered nothing');
    note('5. Mask the real data', `"${maskArmed}", then the applicant's name disappears under a solid block`);
  });
  slide('06-mask', '06-mask-real-data', 'Cover a real name before it is ever recorded.',
    'Click a value and it is covered for the rest of the session: through every navigation, in every screenshot, in the video, and out of the page map.', 1180);

  /* ── 6. submit, and let it fail ───────────────────────────────────────── */
  await page.bringToFront();
  await page.click('#submit');
  await page.waitForTimeout(1600);
  const note500 = await page.locator('#note').textContent();
  note('6. Submit, and let it fail',
    `the portal says "${(note500 || '').trim()}", and the live card's problem count moves`);

  /* ── 7. screenshot with the note attached ─────────────────────────────── */
  await popup.bringToFront();
  await popup.fill('#note-text', 'Submit 500s with no reference number');
  /* The real popup floats over the page, so the visible tab under it is the
     page. Driven here the popup is a tab of its own, and pressing Screenshot
     with it in front photographs the panel instead of the portal, which then
     turns up as the evidence in the report. Put the page back in front first;
     the press still goes to the popup, which is not the tab that is showing. */
  await page.bringToFront();
  await popup.locator('#shot').click();
  await popup.waitForTimeout(2600);
  await popup.bringToFront();
  const live = await popup.evaluate(() => ({
    charter: document.getElementById('live-charter').textContent.trim(),
    time: document.getElementById('live-time').textContent.trim(),
    events: document.getElementById('live-events').textContent.trim(),
    fails: document.getElementById('live-fails').textContent.trim(),
    status: document.getElementById('status').textContent.trim(),
  }));
  await shoot('03-live', popup);
  note('7. Screenshot and note, in one press',
    `"${live.status}"; the card reads ${live.time}, ${live.events} events, ${live.fails} problems`);
  slideSide('03-live', '03-recording-live', 'One window, every tab, no time limit.',
    'Clicks, typing, navigation, network and console in one timeline. Name a bug and photograph it in the same press, and the words go on the picture.', 560);

  /* ── 8. Expert mode: the wall of tools ────────────────────────────────── */
  await popup.click('#mode-expert');
  await popup.waitForTimeout(900);
  /* Land the scroll on a group heading rather than mid-tile: the slide is
     about the shape of the list, and a row cut in half hides the shape.
     Check rather than Capture, because the Record card carries a permanent
     amber note about Chrome's recording permission, and a paragraph of it
     beside three tiles is a slide about that note instead. */
  await popup.evaluate(() => {
    const heads = [...document.querySelectorAll('.activity')];
    (heads[1] || heads[0])?.scrollIntoView({ block: 'start' });
  });
  await popup.waitForTimeout(500);
  const wall = await popup.evaluate(() => ({
    tools: document.querySelectorAll('.tool-row .tool').length,
    groups: [...document.querySelectorAll('.activity')].map((a) => a.textContent.trim().split('\n')[0]),
  }));
  await shoot('04-expert', popup);
  if (wall.tools < 16) snag('8. Expert mode', `only ${wall.tools} tool rows rendered, expected 16`);
  else note('8. Expert mode', `the list grows to all ${wall.tools} tools under ${wall.groups.length} headings`);
  slideSide('04-expert', '04-expert-tools', 'Sixteen tools, grouped the way a tester works.',
    'Simple shows the five a first day needs. Expert shows all sixteen, under Capture, Check, Design and Break.', 560);

  /* ── 9. every tool explains itself ────────────────────────────────────── */
  /* A named tool, not "the third row": the row order changes with the mode and
     the group, and a slide captioned "every tool explains itself" showing
     whichever card happened to be third is a slide that proves nothing. */
  const helpRow = popup.locator('.tool-row', { has: popup.locator('[data-action="harvest"]') });
  await helpRow.locator('.tool-info').click();
  await popup.waitForTimeout(600);
  const helpOpen = await popup.evaluate(() => {
    const row = document.querySelector('.tool-row:has([data-action="harvest"])');
    const help = row?.querySelector('.tool-help');
    if (!help || help.hidden) return 0;
    row.scrollIntoView({ block: 'center' });
    return 1;
  });
  await popup.waitForTimeout(400);
  await shoot('05-help', popup);
  if (!helpOpen) snag('9. A tool explains itself', 'pressing the info mark on Harvest the page opened no panel');
  else note('9. A tool explains itself', 'the plain-words explanation opens under the button it explains, not in a glossary');
  slideSide('05-help', '05-tool-explains-itself', 'Every tool explains itself, in plain words.',
    'What it does and what you get, written for someone who has never used a QA tool. The explanation sits under the button, which is the only place anyone looks.', 560);
  await helpRow.locator('.tool-info').click();
  await popup.waitForTimeout(300);

  /* ── 10. let the machine look: accessibility, then page speed ─────────── */
  for (const action of ['a11y', 'perf']) {
    const label = action === 'a11y' ? 'Check accessibility' : 'Check page speed';
    await stage(`10. ${label}`, 40000, async () => {
      await popup.evaluate(() => (document.getElementById('status').textContent = ''));
      await popup.locator(`[data-action="${action}"]`).click();
      await popup.waitForTimeout(action === 'a11y' ? 3000 : 1600);
      const said = (await popup.locator('#status').textContent())?.trim();
      if (!said) throw new Error('the button said nothing');
      note(`10. ${label}`, `"${said}"`);
    });
  }

  /* ── 11. design the values from what the field declares ───────────────── */
  const gotPalette = await stage('11. Try nasty values', 45000, async () => {
    await page.bringToFront();
    await handClick(page, '#quantity');
    await popup.bringToFront();
    await popup.evaluate(() => (document.getElementById('status').textContent = ''));
    await popup.locator('[data-action="inject"]').click();
    await popup.waitForTimeout(1200);
    const said = ((await popup.locator('#status').textContent()) || '').trim();
    await page.bringToFront();
    await page.waitForTimeout(1200);
    /*
     * What "it opened" can honestly mean from out here.
     *
     * The palette is drawn into `qaw-ui`'s shadow root, and that root is
     * attached `mode: 'closed'` (content/ui-host.js:98). Nothing in the page's
     * main world can reach inside it, so an earlier version of this check
     * looked for `.uqa-inject*` in the document, found nothing three runs
     * running, and reported a working tool as broken. The host element itself
     * IS in the page, so that is what is asked for, together with what the
     * panel said. The picture is the real evidence either way.
     */
    const shown = await page.evaluate(() => !!document.querySelector('qaw-ui'));
    await shoot('07-values', page);
    if (!shown || /pick a field|first/i.test(said)) {
      throw new Error(`no palette on the focused field (panel said: "${said}")`);
    }
    note('11. Try nasty values', `"${said}", and the values for that exact field open on the field itself`);
    await page.keyboard.press('Escape');
    return true;
  });
  if (gotPalette) {
    slide('07-values', '07-design-the-values', 'The edges, without having to think them up.',
      'Very long text, Arabic, a date in the year 1800, an emoji, nothing at all. Built from what the field itself declares.', 1180, 292);
  }

  /* A slide has to exist either way, so the fallback is the same idea taken
     from the popup instead of the page: the partition panel, which reads the
     classes the field declares rather than offering values to type into it. */
  if (!gotPalette) {
    /* The palette left the page mid-something. Reload before anything else is
       asked of it, or every later step inherits the same stuck renderer. */
    await stage('11a. Recover the page', 30000, async () => {
      await page.goto(fixture.origin, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
    });
    await stage('11b. Design the values (partitions)', 45000, async () => {
      await page.bringToFront();
      await handClick(page, '#quantity');
      await popup.bringToFront();
      const row = popup.locator('.tool-row', { has: popup.locator('[data-action="partitions"]') });
      await row.locator('.tool-opts-toggle, .tool-info').first().click().catch(() => {});
      await popup.locator('[data-action="partitions"]').click();
      await popup.waitForTimeout(900);
      await popup.locator('#partitions-read').click();
      await popup.waitForTimeout(1600);
      const classes = await popup.evaluate(() => {
        const out = document.getElementById('partitions-out');
        const text = out?.textContent?.trim() || '';
        /* The panel is the point of the slide, so put it on screen. Without
           this the capture stopped at the panel's heading and the classes it
           is captioned for were below the fold. */
        if (text) out.scrollIntoView({ block: 'center' });
        return text;
      });
      await popup.waitForTimeout(400);
      if (!classes) throw new Error('the panel read no classes off the field');
      await shoot('07-values', popup);
      note('11. Design the values', 'the classes the quantity field declares, with the exact value on each edge');
      slideSide('07-values', '07-design-the-values', 'The edges, without having to think them up.',
        'Equivalence partitions and boundary values, read from what the field itself declares. Nothing is guessed.');
    });
  }

  /* ── 12. harvest the page ─────────────────────────────────────────────── */
  await stage('12. Harvest the page', 40000, async () => {
    await popup.bringToFront();
    await popup.evaluate(() => (document.getElementById('status').textContent = ''));
    await popup.locator('[data-action="harvest"]').click();
    await popup.waitForTimeout(2200);
    const harvested = (await popup.locator('#status').textContent())?.trim();
    if (!harvested) throw new Error('the button said nothing');
    note('12. Harvest the page', `"${harvested}"`);
  });

  /* ── 13. the recording refusal, and the sentence it answers with ──────── */
  await stage('13. The recording refusal', 60000, async () => {
    await page.goto(`${fixture.origin}/?step=2`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await popup.bringToFront();
    await popup.evaluate(() => (document.getElementById('status').textContent = ''));
    await popup.locator('[data-action="record"]').click();
    await popup.waitForTimeout(2500);
    const refusal = (await popup.locator('#status').textContent())?.trim();
    const recording = await popup.evaluate(
      () => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_RECORD_STATE' }, (res) => r(!!res?.result?.recording)))
    );
    if (recording) {
      await popup.locator('[data-action="record"]').click();
      await popup.waitForTimeout(1500);
      note('13. Record the screen', 'recording started and stopped cleanly, so the refusal did not fire on this run');
      return;
    }
    if (/navigat|right-click|Alt\+Shift/i.test(refusal || '')) {
      note('13. The recording refusal', `"${refusal}", which names both recovery routes itself`);
      return;
    }
    throw new Error(`neither recorded nor gave the navigation refusal: "${refusal}"`);
  });

  /* ── 14. stop and review ──────────────────────────────────────────────── */
  await stage('14. Stop and review', 40000, async () => {
    await popup.bringToFront();
    await popup.click('#stop');
    await popup.waitForFunction(() => !document.getElementById('step-done').hidden, { timeout: 15000 });
    const done = await popup.evaluate(() => ({
      summary: document.getElementById('done-summary').textContent.trim(),
      formats: [...document.querySelectorAll('[data-format]')].map((b) => b.textContent.trim()),
    }));
    note('14. Stop and review', `"${done.summary}", with ${done.formats.join(', ')} offered on the spot`);
  });

  const sessionId = await popup.evaluate(
    () => new Promise((r) => chrome.storage.session.get('lastSessionId', (v) => r(v.lastSessionId)))
  );
  if (!sessionId) throw new Error('the session did not close with an id, so nothing downstream can be shot');

  /* ── 15 to 17. the report ─────────────────────────────────────────────── */
  const report = await context.newPage();
  watch(report, 'report');
  await report.setViewportSize({ width: 1240, height: 900 });

  await stage('15. The report opens on Overview', 60000, async () => {
    await report.goto(`chrome-extension://${id}/report/report.html?session=${sessionId}`);
    await report.waitForTimeout(2500);
    const headline = await report.evaluate(() => document.querySelector('h1, .headline')?.textContent?.trim() || '');
    await shoot('08-overview', report);
    note('15. The report opens on Overview', `the headline reads "${headline.slice(0, 90)}"`);
  });
  slide('08-overview', '08-report-overview', 'Press Stop, and the report is already written.',
    'A headline, the cause of each failure, the screenshots, the accessibility and speed findings, and a timeline you can scrub.', 1420, 292);

  await stage('16. What broke', 45000, async () => {
    await report.click('[data-tab="broke"]');
    await report.waitForTimeout(1400);
    const broke = await report.evaluate(() => document.getElementById('count-broke')?.textContent?.trim() || '');
    await shoot('09-broke', report);
    note('16. What broke', `${broke || 'the'} failure card: the click you made, then the request it caused, then the status it answered`);
  });
  slide('09-broke', '09-what-broke', 'Every failure, traced to the click before it.',
    'You clicked Submit application. That posted to /api/applications. That answered 500. The chain is in the report, not a guess a reader has to make.', 1420, 292);

  await stage('17. File it', 45000, async () => {
    await report.click('[data-tab="file"]');
    await report.waitForTimeout(1600);
    const kinds = await report.evaluate(
      () => [...document.querySelectorAll('[data-artefact]')].map((n) => n.textContent.trim()).filter(Boolean)
    );
    await shoot('10-file', report);
    note('17. File it', `the ticket kinds offered from one session: ${kinds.length ? kinds.join(' · ') : 'read off the tab itself'}`);
  });
  slide('10-file', '10-file-it', 'From one session, seven kinds of ticket.',
    'Defect report, test case, story, epic, task, sub-task, plain. Written from the recording, evidence attached, editable before it is sent.', 1420, 292);
  await report.close();

  /* ── 18. settings ─────────────────────────────────────────────────────── */
  const options = await context.newPage();
  watch(options, 'options');
  await options.setViewportSize({ width: 1000, height: 1180 });
  await stage('18. Settings', 60000, async () => {
    await options.goto(`chrome-extension://${id}/options/options.html`);
    await options.waitForTimeout(2200);
    const cards = await options.evaluate(() => [...document.querySelectorAll('.card h2')].map((h) => h.textContent.trim()));
    await shoot('12-settings', options);
    note('18. Settings', `${cards.length} cards: ${cards.join(' · ')}`);
  });
  slide('12-settings', '12-settings', 'Every default is yours to change, and none of them phone home.',
    'Shortcuts, sessions, where files go and what they are called, integrations, and a privacy card that says what is kept and for how long.', 900, 292);
  await options.close();

  /* ── 19. the workflow diagram, taken LAST ─────────────────────────────── */
  const dia = await context.newPage();
  watch(dia, 'diagram');
  await dia.setViewportSize({ width: 1300, height: 900 });
  await stage('19. The workflow diagram', 60000, async () => {
    await dia.goto(`chrome-extension://${id}/diagram/diagram.html?session=${sessionId}`);
    await dia
      .waitForFunction(() => document.querySelectorAll('#sheet [data-node]').length > 0, null, { timeout: 20000 })
      .catch(() => {});
    await dia.waitForTimeout(1500);
    const sheet = await dia.evaluate(() => ({
      nodes: document.querySelectorAll('#sheet [data-node]').length,
      edges: document.querySelectorAll('#sheet [data-edge]').length,
      viewBox: document.querySelector('#sheet svg')?.getAttribute('viewBox') || '',
    }));
    await shoot('11-diagram', dia);
    if (!sheet.nodes) throw new Error('nothing was drawn on the sheet');
    note('19. The workflow diagram', `an A4 landscape sheet (${sheet.viewBox}), ${sheet.nodes} boxes and ${sheet.edges} arrows, the story beside it in Arabic`);
  });
  slide('11-diagram', DIAGRAM_LABELS_FIXED ? '11-workflow-diagram' : '11-workflow-diagram-PENDING',
    'The session, as a workflow anybody can read.',
    'Start, each step, a decision where the application answered, a red box where it failed, the end, with the user story beside it in Arabic. On one A4 page.', 1420, 292);
  await dia.close();

  /* ── 20. back to sleep ────────────────────────────────────────────────── */
  await stage('20. Back to sleep', 30000, async () => {
    await popup.bringToFront();
    await popup.click('#switch');
    await popup.waitForFunction(() => document.body.dataset.awake === 'false', { timeout: 12000 });
    note('20. Back to sleep', 'the switch reads Asleep again and every tool greys out');
  });

  /* ── compose the boards ───────────────────────────────────────────────── */
  console.log('\ncomposing the slides');
  const composer = await chromium.launch({ headless: false });
  try {
    for (const s of SLIDES) {
      const src = path.join(RAW, `${s.raw}.png`);
      if (!fs.existsSync(src)) {
        snag(`slide ${s.name}`, `no raw capture at ${src}`);
        continue;
      }
      const bp = await composer.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const tmp = path.join(SHOTS, '_board.html');
      const draw = s.kind === 'side' ? boardSide : boardWide;
      fs.writeFileSync(tmp, draw({ ...s, image: url(src) }));
      await bp.goto(url(tmp), { waitUntil: 'load' });
      await bp.waitForTimeout(700);
      fs.rmSync(tmp, { force: true });
      const out = path.join(SHOTS, `${s.name}.png`);
      await bp.screenshot({ path: out });
      await bp.close();
      console.log(`  shots/${s.name}.png`);
    }
  } finally {
    await composer.close();
  }

  console.log(`\n${walked.length} steps walked, ${problems.length} snags`);
  if (errors.length) console.log(`\nconsole noise (${errors.length}):\n  ${errors.slice(0, 12).join('\n  ')}`);
  fs.writeFileSync(
    path.join(RAW, 'walk.json'),
    JSON.stringify({ walked, problems, errors }, null, 2)
  );
  console.log(`walk log: ${path.join(RAW, 'walk.json')}`);
} finally {
  await context.close();
  await fixture.close();
}
