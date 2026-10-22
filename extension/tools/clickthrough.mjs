/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Press every button, the way a person does.
 *
 * The gap this closes, in one sentence: **diagnose.mjs asserts that the message
 * handlers work and ui-shots.mjs asserts that the surfaces look right, and
 * neither of them clicks anything.** A control wired to a handler that no
 * longer exists, a listener attached to an element that is created later, a
 * `disabled` that never lifts — all of those pass both suites and fail the
 * moment a person opens the popup.
 *
 * So this one is deliberately dumb: open the real surfaces, click the real
 * controls in the order a tester would, and fail on any error from any context.
 * It does not know what the buttons are supposed to do. It only knows that
 * pressing them must not throw, must not be impossible, and must not leave the
 * page silent.
 *
 *   node tools/clickthrough.mjs
 */
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from './lib-granted.mjs';
import { profile } from './lib-paths.mjs';
import { sweepGuard } from './lib-sweep.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Simple and Expert are the same product, so the suite is run twice.
 *
 * The popup shows five tiles in Simple and nineteen in Expert, and the mode is
 * a `localStorage` key, not a build — so the honest question is not "does the
 * Expert popup work" but "does every feature work in the mode the tester is
 * actually in, and is the one it hides still one press away". The suite is not
 * duplicated: it takes `--mode=`, and with no argument it runs itself once per
 * mode in its own browser, so neither run inherits the other's state.
 */
/** One mode since UI round 2 (S6): every tool is on the rail, favourites on top. */
const TILES_IN_MODE = 19;
/*
 * The extension under test is the shipping one with the site permission
 * already granted: `<all_urls>` is optional now, and the bubble that grants it
 * is drawn by the browser with nothing for a harness to click. See
 * `tools/lib-granted.mjs` for what that copy does and does not prove.
 */
const EXT = grantedExtension({ label: 'clickthrough' });
const PROFILE = profile('.clickthrough-profile');

let pass = 0;
let fail = 0;
const problems = [];

function check(name, fn) {
  try {
    const detail = fn();
    pass++;
    console.log(`  ok    ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ''}`);
  } catch (err) {
    fail++;
    problems.push(`${name}: ${err.message}`);
    console.log(`  FAIL  ${name}\n          ${err.message}`);
  }
}

const openPages = new Set();

/** Round 3: a report tab lives inside one of four sections; open the section, then the tab. */
const SEC_OF = { broke: 'findings', timeline: 'findings', selectors: 'findings', overview: 'findings', media: 'evidence', sizes: 'evidence', diagram: 'evidence', quality: 'quality', file: 'share', raw: 'share' };
async function openTab(page, name) {
  await page.locator(`#sec-${SEC_OF[name]}`).click();
  await page.locator(`[data-tab="${name}"]`).click();
}

/*
 * P4 (spec S4/S5): every step announces itself as `::step N name` before it runs, so a browser that dies mid-walk is reported
 * as `FAIL browser died at step N: name` instead of a pile of "target closed" errors. This walk is a script in which every
 * click is named, so it stays live by default (a dry-run of it would mean nothing); `--live-sweep` is accepted and ignored.
 */
let closing = false;
let stepNo = 0;
let lastStep = '(before the first step)';
let diedAt = null;
async function step(name, fn) {
  stepNo++; lastStep = `${stepNo} ${name}`;
  console.log(`::step ${stepNo} ${name}`);
  try {
    const detail = await fn();
    pass++;
    console.log(`  ok    ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ''}`);
    return detail;
  } catch (err) {
    fail++;
    problems.push(`${name}: ${err.message}`);
    console.log(`  FAIL  ${name}\n          ${err.message}`);
    // Leave the surfaces clickable. A step that threw with a dialog open used
    // to fail the next two steps on an intercepted click, which reads as three
    // broken features when only one is.
    for (const page of openPages) {
      await page.evaluate(() => {
        for (const d of document.querySelectorAll('dialog[open]')) d.close();
      }).catch(() => {});
    }
    return null;
  }
}

/* A page with something to click, record and break. */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title></head>
<body><h1>Application form</h1>
<label for="applicant">Applicant name</label>
<input id="applicant" type="text" maxlength="40" required />
<label for="amount">Amount</label>
<input id="amount" type="number" min="1" max="500" step="1" />
<label for="pw">Password</label><input id="pw" type="password" />
<button id="submit" type="button">Submit application</button><div id="r"></div>
<script>document.getElementById('submit').onclick=async()=>{
  const res=await fetch('/api/applications',{method:'POST',headers:{'content-type':'application/json'},body:'{"a":1}'});
  document.getElementById('r').textContent='status '+res.status;};</script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"boom"}');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT));
await keepOnTop(context); // test window stays above others; released on close
// S4: window.close, tabs.remove, windows.remove are recorded and never forwarded; opens and downloads only to loopback / extension / blob / data
await context.addInitScript(sweepGuard);
context.on('close', () => { if (!closing) diedAt = lastStep; });

/**
 * Everything anybody logged, from every context.
 *
 * Collected globally rather than per-page, because the failure this suite is
 * for usually happens in one context and is reported in another — a popup
 * button whose handler throws in the service worker prints nothing in the
 * popup.
 */
const errors = [];
const watch = (target, label) => {
  if (typeof target.evaluate === 'function' && typeof target.close === 'function') openPages.add(target);
  target.on('close', () => openPages.delete(target));
  target.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  target.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`);
  });
};

const since = () => errors.length;
const newErrors = (mark) => errors.slice(mark);

try {
  const worker = await freshWorker(context);
  watch(worker, 'worker');
  const id = new URL(worker.url()).host;
  // The first-run notice gates the whole popup, so it is answered before the
  // popup is opened rather than clicked through in every suite.
  await seedConsent(worker);
  // And the page scripts in place before anything navigates. See lib-granted.mjs.
  await awaitSiteScripts(worker);

  const page = await context.newPage();
  watch(page, 'page');
  await page.goto(origin, { waitUntil: 'domcontentloaded' });

  const popup = await context.newPage();
  watch(popup, 'popup');

  console.log('\n— the popup opens and finishes booting —');

  await step('the popup boots and says so', async () => {
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    await popup.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 15000 });
    return popup.evaluate(() => window.UQABootTimings);
  });

  check('nothing threw while booting', () => {
    if (errors.length) throw new Error(errors.join(' | '));
  });

  await step('every tool row rendered, with a name and a help panel', async () => {
    const shape = await popup.evaluate(() => ({
      tools: document.querySelectorAll('.tool-row .tool').length,
      named: [...document.querySelectorAll('.tool-name')].filter((n) => n.textContent.trim()).length,
      helps: document.querySelectorAll('.tool-help').length,
      groups: document.querySelectorAll('.activity').length,
    }));
    if (shape.tools !== TILES_IN_MODE) {
      throw new Error(`the popup drew ${shape.tools} tools, not ${TILES_IN_MODE}`);
    }
    if (shape.named !== shape.tools) throw new Error(`${shape.tools - shape.named} tool(s) have no label`);
    if (shape.helps !== shape.tools) throw new Error('a tool has no explanation');
    return shape;
  });

  await step('every tool is on the rail, and none is filed nowhere', async () => {
    const mark = since();
    const inventory = await popup.evaluate(() => ({
      tools: [...document.querySelectorAll('.tool-row[data-tool]')].map((r) => r.dataset.tool),
      favourites: [...document.querySelectorAll('.fav-item[data-fav]')].map((r) => r.dataset.fav),
    }));
    if (inventory.tools.length !== TILES_IN_MODE) throw new Error(`the rail shows ${inventory.tools.length} tools, not ${TILES_IN_MODE}`);
    const stray = inventory.favourites.filter((t) => !inventory.tools.includes(t));
    if (stray.length) throw new Error(`favourites name tools the rail does not have: ${stray.join(', ')}`);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return inventory;
  });

  const openSummary = async (id) => {
    if (await popup.evaluate((i) => { const d = document.getElementById(i); return !!d && !d.open; }, id)) await popup.click(`#${id} > summary`);
  };
  /** The tool rows sit inside <details id="tools-fold"> (1011 P1-7): press its summary before a row is pressed. */
  const showTools = async () => { await openSummary('tools-fold'); };
  const ensureTool = async (action) => {
    if (!(await popup.locator(`[data-action="${action}"]`).count())) {
      throw new Error(`"${action}" is not in the popup at all`);
    }
    await showTools();
    return false;
  };

  /**
   * Press the Wake/Sleep button the way a tester does. The Awake/Asleep card folds
   * to a header pill 5 s after the state is set (82f1af6, b2b0350), and a folded
   * card hides #switch; the pill is the way back to it. So: open the card if it is
   * folded, then press the switch.
   */
  const pressSwitch = async () => {
    await popup.click('#switch');
  };

  console.log('\n— asleep, which is the default —');

  await step('every tool says it is asleep, and none is disabled in silence (1011 B1: a press wakes it)', async () => {
    const state = await popup.evaluate(() => ({
      awake: document.body.dataset.awake,
      silent: [...document.querySelectorAll('[data-action]')].filter((b) => b.disabled && b.dataset.unavailable !== 'true').length,
      unmarked: [...document.querySelectorAll('[data-action]')].filter((b) => !b.disabled && b.dataset.asleep !== 'true').length,
      total: document.querySelectorAll('[data-action]').length,
    }));
    if (state.awake !== 'false') throw new Error('it came up awake — asleep is the default');
    if (state.silent) throw new Error(`${state.silent} tool(s) are disabled with no way to wake them`);
    if (state.unmarked) throw new Error(`${state.unmarked} tool(s) are not marked asleep`);
    return state;
  });

  await step('the wake button is not itself disabled', async () => {
    const usable = await popup.evaluate(() => {
      const b = document.getElementById('switch');
      return !!b && !b.disabled && b.textContent.trim();
    });
    if (!usable) throw new Error('the one control that must work while asleep is disabled');
    return { label: usable };
  });

  console.log('\n— waking it up —');

  await step('pressing "Wake up" wakes it, and enables the tools', async () => {
    const mark = since();
    await pressSwitch();
    await popup.waitForFunction(() => document.body.dataset.awake === 'true', { timeout: 8000 });
    const after = await popup.evaluate(() => ({
      title: document.getElementById('switch-title').textContent,
      button: document.getElementById('switch').textContent,
      enabled: [...document.querySelectorAll('[data-action]')].filter((b) => !b.disabled && b.dataset.asleep === 'false').length,
      status: document.getElementById('status').textContent,
    }));
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    if (!after.enabled) throw new Error('woke up, but every tool is still disabled');
    return after;
  });

  console.log('\n— starting a session —');

  await step('typing a charter and pressing Start begins recording', async () => {
    const mark = since();
    await popup.fill('#charter', 'Clickthrough');
    await popup.click('#start');
    await popup.waitForFunction(() => !document.getElementById('step-live').hidden, { timeout: 8000 });
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return popup.evaluate(() => document.getElementById('live-charter').textContent);
  });

  /* ── the tools, one at a time ─────────────────────────────────────────── */

  console.log('\n— pressing each tool —');

  /**
   * Press one tool and report what came back.
   *
   * A tool "worked" if it did not throw anywhere and the popup said something.
   * Silence is the specific failure this catches: a button whose listener was
   * never attached is indistinguishable from a working one until you notice
   * that nothing at all happened.
   */
  const pressTool = async (action, { expectSays = true, settle = 900, keepOpen = false, escape = false } = {}) => {
    const mark = since();
    const hidden = await ensureTool(action);
    await popup.evaluate(() => (document.getElementById('status').textContent = ''));
    const button = popup.locator(`[data-action="${action}"]`);
    if (!(await button.count())) throw new Error('no button with that action exists');
    if (await button.isDisabled()) throw new Error('the button is disabled');
    /*
     * A tool that hands its work to the page closes the panel behind it, which
     * is right in a real popup and fatal here, where the popup is a tab: the
     * rest of the suite would have nothing left to press. The close is stubbed
     * for that one press, and only that one.
     */
    if (keepOpen) await popup.evaluate(() => { window.close = () => {}; });
    await button.click();
    await popup.waitForTimeout(settle);
    // Whatever the tool drew into the page, put away before the next step.
    if (escape) { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(200); }

    const said = await popup.evaluate(() => ({
      status: document.getElementById('status').textContent,
      tone: document.getElementById('status').className,
    }));
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    if (expectSays && !said.status) throw new Error('the button did nothing and said nothing');
    return { ...said, ...(hidden ? { reachedVia: 'the tool sheet' } : {}) };
  };

  for (const [action, options] of [
    ['perf', {}],
    ['a11y', { settle: 2500 }],
    ['rtl', { settle: 1500 }],
    ['shot', { settle: 1500 }],
    ['harvest', { settle: 1500 }],
    ['autofill', { settle: 1200 }],
    ['links', { settle: 2500 }],
    /*
     * `inject` is asserted on the panel, never on the page.
     *
     * What it opens lives in a shadow root attached `mode: 'closed'`
     * (`content/ui-host.js:98`), so `page.querySelector('.uqa-palette')`
     * answers null with the palette plainly on screen — the same trap the
     * comment above this block warns about for the picker, and the reason a
     * finding was nearly written up against a tool that was working. The
     * honest question from a page context is `qaw-ui`; the honest question
     * from here is what the panel said it did.
     */
    ['inject', { settle: 1200, keepOpen: true, escape: true }],
  ]) {
    await step(`"${action}" does something and reports it`, () => pressTool(action, options));
  }

  await step('masking covers a value, survives a reload, and keeps it out of the page map', async () => {
    const mark = since();
    await popup.locator('[data-action="mask"]').click();
    await popup.waitForTimeout(400);
    const armed = await popup.locator('#status').textContent();

    // Click a field the way a tester would, with the mouse, not by selector:
    // the picker reads what is under the pointer.
    const box = await page.locator('#applicant').boundingBox();
    await page.bringToFront();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');

    const covered = await page.evaluate(() => document.querySelectorAll('[data-uqa-masked]').length);
    if (!covered) throw new Error('nothing was masked');

    // The point of the feature: it lasts for the session, not for the page.
    await page.reload();
    await page.waitForTimeout(1200);
    const afterReload = await page.evaluate(() => document.querySelectorAll('[data-uqa-masked]').length);
    if (!afterReload) throw new Error('the mask did not survive a reload');

    // And the harvest must not carry the text that was masked.
    await page.evaluate(() => { document.querySelector('#applicant').value = 'Layla Haddad'; });
    const harvest = await popup.evaluate(
      () => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_HARVEST' }, r))
    );
    const blob = JSON.stringify(harvest?.result || {});
    if (blob.includes('Layla Haddad')) throw new Error('the page map still carries the masked value');

    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { armed: /Click anything/.test(armed), covered, afterReload, inHarvest: false };
  });

  /**
   * The replay, end to end, with the masking claim checked where it matters.
   *
   * The step above proves a masked value stays out of the page map. This one
   * proves it stays out of the replay, which is the harder promise: the replay
   * records the DOM itself, so if masking were applied at playback rather than
   * at record time the real text would be sitting in IndexedDB and this would
   * still look right on screen.
   *
   * So it is asserted twice, and the first assertion is the one that counts:
   * the stored log, straight out of the worker, must not contain the string;
   * and then the rebuilt replay DOM must not either.
   */
  await step('the replay records the session, opens, and never carries the masked value', async () => {
    const mark = since();
    const SECRET = 'Layla Haddad';

    // The mask from the step above is still on `#applicant` for this session.
    await page.bringToFront();
    await page.evaluate((v) => {
      const el = document.querySelector('#applicant');
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      // Something ordinary as well, so an empty log cannot pass this step.
      const p = document.createElement('p');
      p.id = 'replay-probe';
      p.textContent = 'the replay saw this';
      document.body.appendChild(p);
    }, SECRET);
    await page.waitForTimeout(1600); // past the recorder's flush interval

    const info = await popup.evaluate(
      () => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_REPLAY_INFO' }, r))
    );
    if (!info?.ok || !info.result?.entries) throw new Error('nothing was recorded into the replay store');

    const log = await popup.evaluate(
      () => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_REPLAY_GET' }, r))
    );
    if (!log?.ok) throw new Error(log?.error || 'the replay could not be read back');
    const stored = JSON.stringify(log.result.entries);
    if (stored.includes(SECRET)) throw new Error('the masked value is in the stored replay log');
    if (!stored.includes('the replay saw this')) throw new Error('the replay recorded nothing from the page');

    // And the page a tester actually opens.
    const opened = await popup.evaluate(
      () => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_OPEN_REPLAY' }, r))
    );
    if (!opened?.ok) throw new Error(opened?.error || 'the replay page would not open');
    const replay = await context.waitForEvent('page', { timeout: 8000 });
    openPages.add(replay);
    await replay.waitForLoadState('load');
    await replay.waitForTimeout(1200);

    const size = await replay.locator('#size').textContent();
    const scrubMax = await replay.locator('#scrub').getAttribute('max');
    // The frame is sandboxed with nothing granted, so it is reachable only as a
    // frame, never as a same-origin document - which is the point of it.
    const frame = replay.frames().find((f) => f !== replay.mainFrame());
    const html = frame ? await frame.content() : '';
    if (!html) throw new Error('the replay stage never rendered');
    if (html.includes(SECRET)) throw new Error('the masked value is in the rebuilt replay DOM');
    if (/<script/i.test(html)) throw new Error('a script reached the replay document');

    await replay.close();
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return {
      entries: info.result.entries,
      storedBytes: info.result.stored,
      maskedTextInLog: false,
      maskedTextInReplayDom: false,
      size: (size || '').trim(),
      scrubMs: Number(scrubMax) || 0,
    };
  });

  await step('the picker collects several elements with Shift+click and copies them all on Enter', async () => {
    const mark = since();
    // Back on the fixture: earlier steps may have left the page elsewhere.
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    const res = await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_PICK' }, r)));
    if (!res?.ok) throw new Error(`could not start the picker: ${res?.error}`);
    await page.bringToFront();
    await page.waitForTimeout(400);
    // Hover then Shift+click two controls; the basket chip must count them.
    for (const sel of ['#applicant', '#submit']) {
      // The picker's highlight layer sits over the element, so Playwright's
      // actionability checks would wait forever: move the pointer to the
      // element's own box and click there, the way a hand would.
      const box = await page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, sel);
      if (!box) throw new Error(`${sel} not on the page (${page.url()})`);
      await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
      await page.waitForTimeout(150);
      await page.keyboard.down('Shift');
      await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(250);
    }
    const chip = await page.evaluate(() => `${document.documentElement.dataset.uqaBasket || 0} picked`);
    if (!/2 picked/.test(chip)) throw new Error(`basket chip: "${chip}"`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    const afterEnter = await page.evaluate(() => ({
      basket: document.documentElement.dataset.uqaBasket ?? null,
      picking: document.documentElement.classList.contains('uqa-picking'),
      focused: document.activeElement?.tagName,
    }));
    // The note went to the session that is recording now — not the last one
    // that stopped, which is what lastSessionId names.
    const sessionId = await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_GET_STATE' }, (st) =>
      r(st?.result?.session?.id || st?.result?.lastSession?.id || null))));
    if (!sessionId) throw new Error('no session to look in');
    const tl = await popup.evaluate((id) => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_GET_TIMELINE', sessionId: id }, r)), sessionId);
    const note = (tl?.result?.events || []).filter((e) => e.kind === 'note').map((e) => e.text).find((t) => /^Picked 2 locators:/.test(t));
    if (!note) {
      const recent = (tl?.result?.events || []).filter((e) => e.kind === 'note').slice(-3).map((e) => e.text.slice(0, 60));
      throw new Error(`no "Picked 2 locators" note — after Enter: ${JSON.stringify(afterEnter)}; last notes: ${JSON.stringify(recent)}`);
    }
    const lines = note.split('\n').slice(1);
    if (lines.length !== 2 || !lines.every((l) => /^page\./.test(l))) throw new Error(`locator lines: ${JSON.stringify(lines)}`);
    const stillPicking = await page.evaluate(() => document.documentElement.classList.contains('uqa-picking'));
    if (stillPicking) throw new Error('the picker did not stop after Enter');
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { chip: chip.slice(0, 20), lines };
  });

  await step('the effects library runs on transforms only, cleans up, and costs nothing measurable', async () => {
    const mark = since();
    const out = await popup.evaluate(async () => {
      const V = window.UQAVfx;
      if (!V) return { missing: true };
      const el = document.getElementById('status');
      const cat = V.catalogue();
      const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

      /*
       * A budget in milliseconds is a budget in "how busy is this machine".
       * This assertion measured 58.8 ms against a fixed 40 and failed three
       * times in one day on a laptop that had had browsers open all night,
       * while the same build passed on the next run. A gate that goes red for
       * being run at a bad moment teaches people to re-run until green, which
       * is how a real regression walks through.
       *
       * So the cost is measured against a baseline taken in the same page, in
       * the same round: thirty plain elements created, measured and removed.
       * Real DOM and style work, no animation. Load moves both numbers, so the
       * comparison holds on a fast machine and a hammered one alike. Five
       * rounds and the median of each, because a single round's ratio swings
       * between 2.6x and 6.8x on an idle machine and means nothing.
       */
      const baseline = () => {
        const t0 = performance.now();
        for (let i = 0; i < 30; i++) {
          const n = document.createElement('span');
          n.className = 'vfx-cost-probe';
          n.textContent = 'x';
          el.append(n);
          void n.offsetWidth; // forces layout, the way an effect's first frame does
          n.remove();
        }
        return performance.now() - t0;
      };
      const burst = () => {
        const t0 = performance.now();
        for (let i = 0; i < 10; i++) { V.play('sparks', el); V.play('pop', el); V.play('shake', el); }
        return performance.now() - t0;
      };

      const bases = [];
      const costs = [];
      let during = 0;
      for (let round = 0; round < 5; round++) {
        bases.push(baseline());
        costs.push(burst());
        if (!round) during = document.getAnimations().length;
        await new Promise((r) => setTimeout(r, 900));
      }

      const leaked = document.querySelectorAll('.vfx-spark, .vfx-ring, .vfx-flash-layer, .vfx-cost-probe').length;
      const classes = [...el.classList].filter((c) => c.startsWith('vfx-')).length;
      const props = new Set();
      for (const sheet of document.styleSheets) {
        let rules = [];
        try { rules = [...sheet.cssRules]; } catch { continue; }
        for (const r of rules) if (r.type === CSSRule.KEYFRAMES_RULE && r.name.startsWith('vfx-')) for (const k of r.cssRules) for (const p of k.style) props.add(p);
      }
      const round1 = (n) => Math.round(n * 10) / 10;
      return {
        effects: cat.length,
        cost: round1(median(costs)),
        base: round1(median(bases)),
        costs: costs.map(round1),
        bases: bases.map(round1),
        during,
        leaked,
        classes,
        props: [...props],
      };
    });
    if (out.missing) throw new Error('UQAVfx is not loaded in the popup');
    // Eight times the same-run baseline plus 10 ms. Measured on this machine:
    // baseline 8.5 ms, effects 31.8 ms, a ratio of 3.7. The ceiling is the
    // shape of the cost, not the speed of the laptop.
    const allowed = Math.round((out.base * 8 + 10) * 10) / 10;
    if (out.cost > allowed) {
      throw new Error(
        `30 effects took ${out.cost} ms against ${allowed} ms allowed `
        + `(baseline ${out.base} ms in the same run; effects ${out.costs.join('/')}, baselines ${out.bases.join('/')})`
      );
    }
    if (out.leaked || out.classes) throw new Error(`left behind: ${out.leaked} nodes, ${out.classes} classes`);
    const bad = out.props.filter((p) => !['transform', 'opacity'].includes(p));
    if (bad.length) throw new Error(`keyframes animate ${bad.join(', ')} — transform and opacity only`);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return out;
  });

  await step('"rtl" toggles, and reports the state it actually left the page in', async () => {
    const first = await pressTool('rtl', { settle: 1800 });
    const second = await pressTool('rtl', { settle: 1800 });
    // The pair must disagree. Which way round they fall depends on what the
    // previous presses left behind, and asserting a fixed order there is how a
    // test starts depending on the order of the suite above it.
    // Read from the DOM, not from window.UQARtl: the content scripts live in
    // the ISOLATED world and page.evaluate() runs in MAIN, so asking for
    // UQARtl always answers "not here" and says nothing about the page. `dir`
    // and the phase marker are on the document itself, which both worlds see.
    const inPage = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      marker: document.documentElement.dataset.uqaStress ?? null,
    }));
    const on = /stressed/i.test(first.status) !== /stressed/i.test(second.status);
    if (!on) {
      throw new Error(
        `both presses reported the same thing: "${first.status}" then "${second.status}" — page says ${JSON.stringify(inPage)}`
      );
    }
    return { first: first.status, second: second.status, inPage };
  });

  /**
   * One press, one action.
   *
   * Worth its own check because the fix for the dead buttons was to move from a
   * listener per button to one delegated listener, and the classic way that
   * goes wrong is both being attached at once — every tool then runs twice, two
   * screenshots land per press, and nothing looks broken until someone counts.
   */
  await step('one press captures exactly one screenshot', async () => {
    const sessionId = await popup.evaluate(
      () => new Promise((r) => chrome.storage.session.get('activeSessionId', (v) => r(v.activeSessionId)))
    );
    const count = () =>
      popup.evaluate(
        (id) => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_MEDIA_LIST', sessionId: id }, (res) => r(res?.result?.length ?? 0))),
        sessionId
      );
    const before = await count();
    await pressTool('shot', { settle: 1800 });

    // Wait for the count to move, rather than for a number of milliseconds.
    //
    // A fixed 1800ms failed this step about once in two runs: the press is
    // answered by the popup long before the offscreen document has re-encoded
    // the PNG and written it to IndexedDB, and on a loaded machine that write
    // lands after the timer. The failure then read "one press produced 0
    // screenshots" — a doubled-listener regression, which is the one thing this
    // step exists to catch — for a capture that was perfectly fine.
    //
    // Polling until it changes is deterministic in both directions: a slow
    // machine waits longer, and a genuine double-fire still shows up as 2,
    // because the assertion below is on the settled count and not on the first
    // change seen. The extra second past the first change is what makes the
    // second half true.
    const deadline = Date.now() + 6000;
    let after = before;
    while (after === before && Date.now() < deadline) {
      await popup.waitForTimeout(200);
      after = await count();
    }
    await popup.waitForTimeout(1000);
    after = await count();

    if (after - before !== 1) throw new Error(`one press produced ${after - before} screenshot(s)`);
    return { before, after };
  });

  console.log('\n— the panels that open instead of acting —');

  for (const [action, panel] of [
    ['break-toggle', 'break-panel'],
    ['partitions', 'partitions-panel'],
    ['viewport', 'viewport-panel'],
  ]) {
    await step(`"${action}" opens its panel`, async () => {
      const mark = since();
      await ensureTool(action);
      // The break panel is a pane of its own (40vh) above the tool list in the 348x580 popup, and
      // the step before this one leaves it open: the tools then sit under the Stop strip and cannot
      // be pressed (82f1af6 / 8a3767f layout). A tester closes it first, so this does too.
      if (action !== 'break-toggle' && (await popup.evaluate(() => !document.getElementById('break-panel')?.hidden))) {
        // A DOM click, not a pointer press: with the panel open the row's own toggle sits under the
        // Stop strip in this popup size (reported, not hidden: see work/clickthrough-1006/10-build.md).
        await popup.evaluate(() => document.querySelector('[data-action="break-toggle"]').click());
        await popup.waitForFunction(() => !!document.getElementById('break-panel')?.hidden, null, { timeout: 4000 });
      }
      const button = popup.locator(`[data-action="${action}"]`);
      if (!(await button.count())) throw new Error('no button with that action exists');
      if (await button.isDisabled()) throw new Error('the button is disabled');

      // A tool whose panel is a disclosure on the row opens from that control,
      // not from the tool itself — the tool would start doing its job.
      // Ask the row, not the button's siblings: the two secondary controls
      // now share a bar of their own, so `[data-action] ~ .tool-more` matches
      // nothing. The row is the stable thing to ask.
      //
      // Bare `.tool-more` existence is not enough: every row has one (it also
      // opens the explanation drawer), so this used to read `true` for
      // break-toggle too and clicked its chevron — which controls nothing of
      // break's (it has no `tool.options`, so `stampPanel` never wired one in;
      // its panel opens from the row's own button via the dispatcher instead).
      // `aria-controls` is what `.tool-more` actually drives, so ask that.
      const viaMore = await popup.evaluate(
        ([a, p]) => !!document.querySelector(`.tool-row[data-tool]:has([data-action="${a}"]) .tool-more[aria-controls="${p}"]`),
        [action, panel]
      );
      // What the popup saw of the press, for the failure message below: the
      // panel's state going in (a disclosure pressed while already open closes),
      // and every click that reached the document in the capture phase.
      const before = await popup.evaluate((p) => {
        window.__ctClicks = [];
        window.__ctListen ??= document.addEventListener('click', (e) => window.__ctClicks?.push(
          `${e.target.tagName}.${String(e.target.className).slice(0, 30)}→${e.target.closest?.('[data-action]')?.dataset.action || '-'}`), true) || 1;
        return { wasOpen: !document.getElementById(p)?.hidden };
      }, panel);
      // Already open (left so by an earlier step): the press would close it, so
      // start from closed — the step is about opening, not toggling.
      if (before.wasOpen && !viaMore) {
        await button.click();
        await popup.waitForFunction((p) => !!document.getElementById(p)?.hidden, panel, { timeout: 4000 }).catch(() => {});
      }
      if (viaMore) await popup.click(`.tool-row:has([data-action="${action}"]) .tool-more`);
      else await button.click();

      // Polled, not a fixed 400 ms: a press that goes through the popup's
      // dispatcher (no `.tool-more`, e.g. break-toggle) opens its panel only
      // after `resolveCtx()` has asked the worker for the tab, and a cold
      // worker can take longer than any fixed wait.
      const open = await popup
        .waitForFunction((p) => !document.getElementById(p)?.hidden, panel, { timeout: 4000 })
        .then(() => true, () => false);
      const errs = newErrors(mark);
      if (errs.length) throw new Error(errs.join(' | '));
      if (!open) {
        const why = await popup.evaluate((a) => {
          const b = document.querySelector(`[data-action="${a}"]`);
          return { matches: document.querySelectorAll(`[data-action="${a}"]`).length, expanded: b?.getAttribute('aria-expanded'), busy: b?.dataset.busy ?? null, disabled: b?.disabled, clicks: window.__ctClicks, status: document.getElementById('status')?.textContent?.trim().slice(0, 120) };
        }, action);
        throw new Error(`the panel stayed closed ${JSON.stringify({ ...before, ...why })}`);
      }
      return { panel, open };
    });
  }

  await step('the viewport panel lists real sizes, and one opens a window', async () => {
    const mark = since();
    const rows = await popup.locator('#viewport-list .part').count();
    if (!rows) throw new Error('the viewport list is empty — the worker never answered');
    const before = context.pages().length;
    await popup.locator('#viewport-list .part').first().click();
    await popup.waitForTimeout(1800);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { rows, pagesBefore: before, pagesAfter: context.pages().length };
  });

  await step('reading a field produces named partitions and boundaries', async () => {
    const mark = since();
    // The panel this step reads is opened here rather than inherited from the
    // step before it: a tool panel now closes when the tester presses anywhere
    // outside it, so a panel left open two steps ago is no longer a given. The
    // rule is the product's; the step is what had to become self-contained.
    if (await popup.evaluate(() => !!document.getElementById('partitions-panel')?.hidden)) {
      await popup.click('[data-action="partitions"]');
      await popup.waitForTimeout(400);
    }
    await page.bringToFront().catch(() => {});
    await page.focus('#amount');
    await popup.bringToFront().catch(() => {});
    await popup.click('#partitions-read');
    await popup.waitForFunction(() => document.querySelectorAll('#partitions-out .part').length > 0, {
      timeout: 8000,
    });
    const shape = await popup.evaluate(() => ({
      total: document.querySelectorAll('#partitions-out .part').length,
      valid: document.querySelectorAll('#partitions-out .part.is-valid').length,
      invalid: document.querySelectorAll('#partitions-out .part.is-invalid').length,
    }));
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    if (!shape.valid || !shape.invalid) throw new Error('valid and invalid classes must both be shown');
    return shape;
  });

  // r10-04-5: a field opened and never used must show "0 of N" in the export, not no line at all
  await step('a field opened with nothing applied exports a technique line that reads 0 of N', async () => {
    const mark = since();
    const sid = await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_GET_STATE' }, (st) =>
      r(st?.result?.session?.id || st?.result?.lastSession?.id || null))));
    if (!sid) throw new Error('no session to export');
    // the previous step opened #amount and read its partitions; nothing was applied. Export the issue Markdown as it stands.
    const exp = await popup.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_EXPORT', sessionId: x, format: 'github' }, r)), sid);
    const text = exp?.result?.content || '';
    const line = (text.match(/Technique coverage: .*$/m) || [])[0] || '';
    if (!/Technique coverage: 0 of [1-9]\d* values/.test(line)) throw new Error(`the technique line reads ${JSON.stringify(line)} (expected "0 of N"; popup.js writes the designed note when the partitions panel is first built)`);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return line;
  });

  await step('the palette draws inside the tool, not inside the page', async () => {
    const mark = since();
    await page.bringToFront().catch(() => {});
    await page.focus('#applicant');
    await popup.bringToFront().catch(() => {});
    const tabId = await popup.evaluate(
      (u) => chrome.tabs.query({}).then((ts) => ts.find((t) => t.url?.startsWith(u))?.id),
      origin
    );
    // Straight to the page, not through the tool row: pressing "Design the
    // values" hands the picker to the page and closes the popup — right for a
    // popup, fatal for a popup opened as a tab, which is what this suite is.
    // Through the worker, not tab-to-tab: the page's listener refuses any sender that is a tab
    // (6d17180, "sender.tab is refused"), and this popup is a tab. The worker's UQA_INJECT is the
    // same hand-over the tool row makes, minus the popup closing.
    const injected = await popup.evaluate(
      (id) => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_INJECT', tabId: id }, (res) => r(res ?? { noReply: chrome.runtime.lastError?.message || true }))),
      tabId
    );
    const injectedReply = injected?.result ?? injected;
    if (injectedReply?.noReply || !injectedReply) throw new Error(`the page never answered UQA_INJECT: ${JSON.stringify(injected)}`);
    await page.waitForTimeout(700);
    // The number the field test measured — 52 — read from the page's own
    // world, which is exactly what an axe scan, a screenshot and the picker
    // see. On paper it was already zero: the palette was built inside the
    // shadow root and then appended to the document, which moves it straight
    // back out. Nothing measured it, so nothing noticed.
    const inPage = await page.evaluate(
      () => document.querySelectorAll('[class*="uqa-"]:not(html):not(body)').length
    );
    // The tool's layers live in a closed shadow root, and the page's listener for UQA_UI_HIDE refuses a
    // tab sender, so the layer list is read the way DevTools reads it: the DOM domain, piercing shadow roots.
    const cdp = await context.newCDPSession(page);
    const probe = { layers: [] };
    try {
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const walk = (n) => {
        const a = n.attributes || [];
        for (let i = 0; i < a.length; i += 2) if (a[i] === 'class') for (const c of a[i + 1].split(/\s+/)) if (/^uqa-/.test(c)) probe.layers.push(c);
        for (const k of [...(n.children || []), ...(n.shadowRoots || []), ...(n.contentDocument ? [n.contentDocument] : [])]) walk(k);
      };
      walk(root);
    } finally {
      await cdp.detach().catch(() => {});
    }
    await page.keyboard.press('Escape');
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    if (!probe?.layers?.includes('uqa-palette')) throw new Error(`the palette never opened: ${JSON.stringify(probe)}`);
    if (inPage) throw new Error(`${inPage} of the tool's own nodes are inside the page`);
    return { inPage, layers: probe.layers };
  });

  await step('reporter mode files a report with everything attached for the person', async () => {
    const mark = since();
    const reporter = await context.newPage();
    watch(reporter, 'reporter');
    openPages.add(reporter);
    await reporter.goto(`chrome-extension://${id}/reporter/reporter.html`);
    /*
     * A reporter nobody has used before.
     *
     * The page remembers the language the last person chose, which is right for
     * a person and wrong for a suite that asserts English copy: the second run
     * in the same profile opened in Arabic and failed. Cleared here so the step
     * tests the first-open state, which is the state it is about.
     */
    await reporter.evaluate(() => { try { localStorage.removeItem('qaw-reporter-lang'); } catch { /* private window */ } });
    await reporter.reload();
    /*
     * Waited on, not slept at.
     *
     * `reporter.js` is a module script, so it runs after the document parses
     * and then gathers the technical details asynchronously. A fixed pause
     * before pressing the language button is a race with both: on a loaded
     * machine the press landed before the listener existed, the page stayed in
     * English, and the Arabic assertion failed on two runs out of three. The
     * ready state is a rendered fact, so it is the thing to wait for.
     */
    await reporter.waitForFunction(
      () => !/Preparing|يجري تجهيز/.test(document.getElementById('attached').textContent),
      null,
      { timeout: 10000 },
    );

    // Three things on screen, and the technical half already gathered.
    const shape = await reporter.evaluate(() => ({
      controls: document.querySelectorAll('button, textarea').length,
      attached: document.getElementById('attached').textContent,
      words: [...document.querySelectorAll('h1, .label, .fine, button')].map((n) => n.textContent).join(' '),
    }));
    if (shape.controls > 4) throw new Error(`${shape.controls} controls on a three-thing page`);
    if (/session|charter|artefact|defect/i.test(shape.words)) throw new Error(`test vocabulary on the reporter page: ${shape.words.slice(0, 80)}`);
    if (!/Attached for you/.test(shape.attached)) throw new Error(`it says "${shape.attached}"`);

    // Arabic is one press away, and it turns the page rather than pouring
    // Arabic into a left-to-right shape.
    await reporter.click('#lang');
    // The rendered text, not a timeout: the click repaints synchronously, but
    // only once its listener is attached, and that is what the wait above buys.
    await reporter.waitForFunction(
      () => document.documentElement.dir === 'rtl' && /ما الذي حدث/.test(document.getElementById('title').textContent),
      null,
      { timeout: 8000 },
    );
    const arabic = await reporter.evaluate(() => ({ dir: document.documentElement.dir, title: document.getElementById('title').textContent }));
    await reporter.click('#lang');
    await reporter.waitForFunction(
      () => document.documentElement.dir === 'ltr' && /What went wrong/.test(document.getElementById('title').textContent),
      null,
      { timeout: 8000 },
    );

    await reporter.fill('#what', 'I pressed Submit and the page went blank.');
    await reporter.click('#save');
    await reporter.waitForFunction(() => /Saved|Sent/.test(document.getElementById('status').textContent), null, { timeout: 12000 });

    // What was filed: the words, and everything the person did not have to give.
    const filed = await popup.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'UQA_LIST_SESSIONS' }, (list) => {
        const newest = (list?.result || [])[0];
        if (!newest) return resolve(null);
        chrome.runtime.sendMessage({ type: 'UQA_GET_TIMELINE', sessionId: newest.id }, (t) => {
          const note = [...(t?.result?.events || [])].reverse().find((e) => e.kind === 'note' && e.reporter);
          resolve(note ? {
            text: note.text,
            tag: note.tag,
            url: note.reporter.url,
            details: note.reporter.details,
            hasEnv: !!note.reporter.env?.userAgent,
            screenshot: note.reporter.screenshot,
          } : null);
        });
      });
    }));
    if (!filed) throw new Error('the report was not filed anywhere');
    if (!/page went blank/.test(filed.text)) throw new Error(`the words were lost: "${filed.text}"`);
    if (filed.tag !== 'bug') throw new Error(`filed as "${filed.tag}"`);
    if (!filed.hasEnv) throw new Error('the environment was not attached');
    if (!filed.details) throw new Error('nothing technical was attached');

    await reporter.close();
    openPages.delete(reporter);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { controls: shape.controls, details: filed.details, screenshot: filed.screenshot };
  });

  await step('the eighteenth tool reads the fine print, and never ticks what it cannot know', async () => {
    const mark = since();
    await popup.evaluate(() => (document.getElementById('status').textContent = ''));
    await popup.locator('[data-action="fineprint"]').dispatchEvent('click');
    let said = '';
    for (let i = 0; i < 60 && !/checks?:/.test(said); i++) {
      said = await popup.evaluate(() => document.getElementById('status').textContent);
      if (!/checks?:/.test(said)) await popup.waitForTimeout(150);
    }
    if (!/checks?:/.test(said)) throw new Error(`it said "${said}"`);

    const filed = await popup.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'UQA_GET_STATE' }, (st) => {
        const id = st?.result?.session?.id;
        if (!id) return resolve(null);
        chrome.runtime.sendMessage({ type: 'UQA_GET_TIMELINE', sessionId: id }, (t) => {
          const fine = [...(t?.result?.events || [])].reverse().find((e) => e.kind === 'fineprint');
          resolve(fine ? {
            counts: fine.counts,
            statuses: [...new Set((fine.checks || []).map((c) => c.status))],
            manual: (fine.manual || []).length,
            manualHasStatus: (fine.manual || []).some((m) => 'status' in m),
            hasMarkdown: !!fine.markdown,
          } : null);
        });
      });
    }));
    if (!filed) throw new Error('the check was not filed with the session');
    if (!filed.counts.total) throw new Error('no machine check ran');
    if (!filed.manual || filed.manual < 4) throw new Error(`${filed.manual} manual questions, expected the five`);
    // The whole point of the split: a question a browser cannot answer must
    // never arrive carrying something a surface could render as a result.
    if (filed.manualHasStatus) throw new Error('a manual question carries a status');
    for (const status of filed.statuses) {
      // MANUAL is the fourth word, not a typo: a machine check whose answer the
      // browser could not reach (no cookies to read, no HTTPS to look at) is
      // filed as measured-by-nobody rather than quietly counted as a pass.
      if (!['DECLARED', 'OBSERVED', 'GAP', 'MANUAL'].includes(status)) throw new Error(`unknown status "${status}"`);
    }
    if (!filed.hasMarkdown) throw new Error('the block was not written up');

    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { said: said.slice(0, 52), ...filed.counts, manual: filed.manual };
  });

  await step('the seventeenth tool reads the page back as a specification', async () => {
    const mark = since();
    await popup.evaluate(() => (document.getElementById('status').textContent = ''));
    /*
     * Polled, not slept at.
     *
     * The status line clears itself four seconds after a success, and reading
     * it once at a fixed delay is a race with both ends: too early and the
     * worker has not answered, too late and the line has already tidied itself
     * away. The first non-empty value is the one the tester saw.
     */
    /*
     * Dispatched, not pressed.
     *
     * A real pointer sequence on this row loses its `click` in this suite: the
     * tool list repaints on the session ticker, and a repaint between
     * `pointerdown` and `mouseup` replaces the button the press started on, so
     * the browser fires nothing. Every other press in this file is on a row
     * that does not repaint. What is under test here is the popup's click
     * dispatch and the document it produces, not Chrome's pointer handling, so
     * the event is dispatched on the button the tester would hit.
     */
    await popup.locator('[data-action="spec"]').dispatchEvent('click');
    // The first line is the optimistic one ("Reading the page…"); the one under
    // test is what the worker's answer replaces it with.
    let said = '';
    for (let i = 0; i < 60 && !/Read \d+ form/.test(said); i++) {
      said = await popup.evaluate(() => document.getElementById('status').textContent);
      if (!/Read \d+ form/.test(said)) await popup.waitForTimeout(150);
    }
    if (!said) {
      const why = await popup.evaluate(() => {
        const b = document.querySelector('[data-action="spec"]');
        return {
          there: !!b,
          disabled: b ? b.disabled : null,
          busy: b?.dataset.busy || null,
          mode: document.body.dataset.mode,
          awake: document.body.dataset.awake,
          rows: document.querySelectorAll('.tool-row').length,
          // Is it the popup's dispatch or the worker's answer?
          direct: null,
        };
      });
      why.direct = await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_READ_SPEC' }, (res) => r(res?.ok ? `ok ${res.result?.chars}` : `refused: ${res?.error}`))));
      throw new Error(`the button did nothing and said nothing: ${JSON.stringify(why)} | errors: ${JSON.stringify(newErrors(mark))}`);
    }
    if (!/Read \d+ form/.test(said)) throw new Error(`it said "${said}"`);

    // The document itself, filed on the session, not just a status line.
    const doc = await popup.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'UQA_GET_STATE' }, (st) => {
        const id = st?.result?.session?.id;
        if (!id) return resolve(null);
        chrome.runtime.sendMessage({ type: 'UQA_GET_TIMELINE', sessionId: id }, (t) => {
          const spec = [...(t?.result?.events || [])].reverse().find((e) => e.kind === 'spec');
          resolve(spec ? { chars: (spec.markdown || '').length, counts: spec.counts || {}, head: (spec.markdown || '').slice(0, 60) } : null);
        });
      });
    }));
    if (!doc) throw new Error('the specification was not filed with the session');
    if (!doc.chars || doc.chars < 400) throw new Error(`the document is ${doc.chars} characters`);
    if (!/Specification read back from/.test(doc.head)) throw new Error(`it starts "${doc.head}"`);
    if (!doc.counts.fields) throw new Error('the fixture form was not read');

    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { said: said.slice(0, 48), chars: doc.chars, fields: doc.counts.fields };
  });

  console.log('\n— arming a rule from the popup —');

  await step('the break panel arms a rule', async () => {
    const mark = since();
    // Opened three steps ago, then closed behind it: break-panel and a row's
    // own options panel are one-at-a-time now (product fix, FIX-R1 — they
    // share `.work`'s screen space in the narrow surface), so `partitions`
    // and `viewport` opening theirs since has closed this one. Reopen it the
    // way a tester actually would here: press the tool again first.
    if (await popup.locator('#break-panel').isHidden()) {
      await popup.locator('[data-action="break-toggle"]').click();
      await popup.waitForFunction(() => !document.getElementById('break-panel')?.hidden, { timeout: 4000 });
    }
    await popup.selectOption('#break-preset', '500');
    await popup.fill('#break-pattern', '/api/');
    await popup.click('#break-arm');
    await popup.waitForTimeout(700);
    const rules = await popup.locator('#rule-list .rule-row').count();
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    if (!rules) throw new Error('nothing was listed after arming');
    // Leave the break pane shut for the steps that follow: open, it takes 40vh above the tool list
    // and squeezes the list to ~12px in the 348x580 popup, so no later tool row can be pressed.
    // Its own toggle is under the Stop strip then, hence the DOM click (as in the partitions step).
    await popup.evaluate(() => document.querySelector('[data-action="break-toggle"]').click());
    await popup.waitForFunction(() => !!document.getElementById('break-panel')?.hidden, null, { timeout: 4000 });
    return { rules };
  });

  console.log('\n— notes and tags —');

  await step('a note with a tag is filed', async () => {
    const mark = since();
    await popup.fill('#note-text', 'Clickthrough note');
    if ((await popup.getAttribute('#note-type', 'aria-expanded')) !== 'true') await popup.click('#note-type'); // 1011 R3: the type chips sit behind the chevron
    await popup.click('[data-tag="bug"]');
    await popup.click('#note-add');
    await popup.waitForTimeout(600);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return popup.evaluate(() => document.getElementById('status').textContent);
  });

  await step('the camera button captures into the session', async () => {
    const mark = since();
    await popup.click('#shot');
    await popup.waitForTimeout(1500);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return popup.evaluate(() => document.getElementById('status').textContent);
  });

  await step('an open options panel closes on an outside press, and on Escape', async () => {
    const mark = since();
    await showTools();
    const open = async (action) => {
      await popup.click(`.tool-row:has([data-action="${action}"]) .tool-more`);
      await popup.waitForTimeout(300);
      return popup.evaluate(() => [...document.querySelectorAll('.opts-tool')].filter((p) => !p.hidden).length);
    };

    const first = await open('shot');
    if (first !== 1) throw new Error(`opening one panel left ${first} open`);

    // A second disclosure closes the first: one at a time.
    const second = await open('viewport');
    if (second !== 1) throw new Error(`two panels are open at once (${second})`);

    // A press on the wall itself, not on any panel or disclosure.
    // The group heading: inside the wall, outside every panel and disclosure.
    await popup.locator('.activity-head').first().click();
    await popup.waitForTimeout(300);
    const afterOutside = await popup.evaluate(() => [...document.querySelectorAll('.opts-tool')].filter((p) => !p.hidden).length);
    if (afterOutside) throw new Error(`${afterOutside} panel(s) survived an outside press`);

    await open('shot');
    await popup.keyboard.press('Escape');
    await popup.waitForTimeout(300);
    const afterEscape = await popup.evaluate(() => ({
      open: [...document.querySelectorAll('.opts-tool')].filter((p) => !p.hidden).length,
      expanded: [...document.querySelectorAll('.tool-more[aria-expanded="true"]')].length,
      focused: document.activeElement?.className || '',
    }));
    if (afterEscape.open || afterEscape.expanded) throw new Error(`Escape left ${afterEscape.open} open, ${afterEscape.expanded} expanded`);
    if (!/tool-more/.test(afterEscape.focused)) throw new Error(`Escape dropped the focus to "${afterEscape.focused}"`);

    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { afterOutside, ...afterEscape };
  });

  await step('a request sent by hand from the API panel lands in the timeline', async () => {
    /*
     * The whole point of the panel, asserted end to end: a request written by
     * a person, sent from the extension against the live profile, recorded
     * into the running session as evidence.
     *
     * Driven through the page rather than through the worker, because what is
     * being tested is the seam: the panel composes and substitutes, sends,
     * then asks the worker to record. A test that called the worker directly
     * would pass with the panel entirely broken.
     */
    const api = await context.newPage();
    openPages.add(api);
    await api.goto(`chrome-extension://${id}/api/api.html`);
    await api.waitForTimeout(600);

    // An environment variable, so substitution is exercised and not bypassed.
    const [varName, varValue] = await api.locator('#vars .row input').all();
    await varName.fill('host');
    await varValue.fill(new URL(origin).host);
    await varValue.dispatchEvent('change');

    await api.locator('#method').selectOption('POST');
    await api.locator('#url').fill('http://{{host}}/api/applications');
    await api.locator('#body').fill('{"from":"the api panel"}');
    await api.locator('#prescript').fill('uuid ref\nheader X-Request-Id: {{ref}}');

    await api.locator('#send').click();
    await api.waitForSelector('#preview-card:not([hidden])', { timeout: 8000 });
    const preview = await api.locator('#preview').textContent();
    // Shown before it is sent, with the variable resolved and the script run.
    if (!preview.includes(`POST http://${new URL(origin).host}/api/applications`)) {
      throw new Error(`the preview did not resolve the URL: ${preview.slice(0, 120)}`);
    }
    if (!/X-Request-Id: [0-9a-f-]{36}/.test(preview)) throw new Error('the pre-request script did not add its header');

    await api.locator('#confirm').click();
    await api.waitForSelector('#response-card:not([hidden])', { timeout: 15000 });
    const status = (await api.locator('#res-status').textContent()).trim();
    const recorded = (await api.locator('#res-recorded').textContent()).trim();

    const sessionId = await popup.evaluate(
      () => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_GET_STATE' }, (st) => r(st?.result?.session?.id || null)))
    );
    if (!sessionId) throw new Error('no running session to record into');
    const tl = await popup.evaluate(
      (sid) => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_GET_TIMELINE', sessionId: sid }, r)),
      sessionId
    );
    const sent = (tl?.result?.events || []).filter((e) => e.kind === 'net' && e.via === 'api');
    if (!sent.length) {
      const kinds = [...new Set((tl?.result?.events || []).map((e) => e.kind))];
      throw new Error(`no api event in the timeline; kinds present: ${JSON.stringify(kinds)}`);
    }
    const last = sent.at(-1);
    if (last.method !== 'POST') throw new Error(`recorded method was ${last.method}`);
    if (!String(last.url).includes('/api/applications')) throw new Error(`recorded url was ${last.url}`);
    // The fixture answers 500 on that endpoint, which is the interesting case:
    // a failure sent by hand has to be in the evidence like any other.
    if (last.status !== 500) throw new Error(`recorded status was ${last.status}`);

    await api.close();
    openPages.delete(api);
    return { status, recorded: /Recorded in the running session/.test(recorded), method: last.method, recordedStatus: last.status };
  });


  console.log('\n— the help panels —');

  await step('every chevron opens the explanation of its own tool, one at a time', async () => {
    const mark = since();
    await showTools();
    const count = await popup.locator('.tool-info').count();
    let opened = 0;
    for (let i = 0; i < count; i++) {
      await popup.locator('.tool-info').nth(i).click();
      await popup.waitForTimeout(150);
      const mine = await popup.evaluate((n) => {
        const row = document.querySelectorAll('.tool-row')[n];
        const open = [...document.querySelectorAll('.tool-help')].filter((h) => !h.hidden);
        return open.length === 1 && row?.contains(open[0]);
      }, i);
      if (mine) opened++;
    }
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    if (opened !== count) throw new Error(`${count} pressed, ${opened} opened their own detail alone`);
    // And closed again, or the popup is a wall of text on the next open.
    await popup.keyboard.press('Escape');
    return { count };
  });

  console.log('\n— stopping, and what is offered afterwards —');

  await step('Stop ends the session and offers the exports', async () => {
    const mark = since();
    await popup.click('#stop');
    await popup.waitForFunction(() => !document.getElementById('step-done').hidden, { timeout: 8000 });
    const shape = await popup.evaluate(() => ({
      summary: document.getElementById('done-summary').textContent,
      formats: document.querySelectorAll('[data-format]').length,
    }));
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    if (!shape.formats) throw new Error('no export buttons were offered');
    return shape;
  });

  await step('the theme is chosen in the ⋯ menu without throwing', async () => {
    const mark = since();
    const seen = [];
    for (const choice of ['dark', 'light', 'system']) {
      await popup.click('#more');
      await popup.click(`#theme [data-theme-choice="${choice}"]`);
      await popup.waitForTimeout(200);
      seen.push(await popup.evaluate(() => document.documentElement.dataset.theme || 'system'));
    }
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    if (new Set(seen).size < 2) throw new Error(`the theme did not change: ${seen.join(' → ')}`);
    return seen;
  });

  console.log('\n— the report, opened the way the popup opens it —');

  const report = await context.newPage();
  watch(report, 'report');

  await step('every report tab renders without throwing', async () => {
    const mark = since();
    const sessionId = await popup.evaluate(
      () => new Promise((r) => chrome.storage.session.get('lastSessionId', (v) => r(v.lastSessionId)))
    );
    await report.goto(`chrome-extension://${id}/report/report.html?session=${sessionId}`);
    await report.waitForTimeout(1200);

    let tabs = 0;
    for (let s = 0; s < (await report.locator('.sec-btn').count()); s++) {
      await report.locator('.sec-btn').nth(s).click();
      await report.waitForTimeout(300);
      const n = await report.locator('.tab:visible').count();
      for (let i = 0; i < n; i++) {
        await report.locator('.tab:visible').nth(i).click();
        await report.waitForTimeout(700);
        tabs++;
      }
    }
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { tabs, session: sessionId };
  });

  // r5-08-1 (D-1010-110): the section bar is a roving tablist; the arrow keys walk it and focus never falls to body.
  await step('the report section bar: arrow keys walk the sections in English and Arabic, focus never lands on body', async () => {
    const mark = since();
    const sessionId = await popup.evaluate(
      () => new Promise((r) => chrome.storage.session.get('lastSessionId', (v) => r(v.lastSessionId)))
    );
    const walked = {};
    for (const lang of ['en', 'ar']) {
      await report.goto(`chrome-extension://${id}/report/report.html?session=${sessionId}`);
      await report.evaluate((l) => globalThis.QAWi18n?.setLang?.(l), lang);
      await report.waitForTimeout(1200);
      const order = await report.evaluate(() => [...document.querySelectorAll('#secbar [data-sec]')].filter((b) => !b.disabled && !b.hidden && !b.hasAttribute('data-off')).map((b) => b.id));
      if (order.length < 2) throw new Error(`${lang}: fewer than two enabled sections to walk: ${JSON.stringify(order)}`);
      await report.locator(`#${order[0]}`).focus();
      const key = lang === 'ar' ? 'ArrowLeft' : 'ArrowRight'; // the next section is to the left in RTL
      const seen = [order[0]];
      for (let i = 1; i < Math.min(4, order.length); i++) {
        await report.keyboard.press(key);
        await report.waitForTimeout(250);
        const at = await report.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
        seen.push(at);
        if (at !== order[i]) throw new Error(`${lang}: after ${i} ${key} focus is on ${at}, expected ${order[i]} (walk ${JSON.stringify(seen)})`);
      }
      walked[lang] = seen;
    }
    await report.evaluate(() => globalThis.QAWi18n?.setLang?.('en')); // the language is stored per extension origin: later steps assert English copy
    await report.waitForTimeout(300);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return walked;
  });

  // r5-09-2 (D-1010-111): the popup's loss line is a live region that exists, empty and hidden, before the loss.
  await step('the popup carries a persistent #live-loss status region before any loss', async () => {
    const mark = since();
    const region = await popup.evaluate(() => {
      const el = document.getElementById('live-loss');
      return el ? { role: el.getAttribute('role'), hidden: el.hidden, text: el.textContent.trim() } : null;
    });
    if (!region) throw new Error('no #live-loss element in popup.html: a region created with its text already set is skipped by screen readers');
    if (region.role !== 'status') throw new Error(`#live-loss role is ${region.role}, expected status`);
    if (!region.hidden || region.text) throw new Error(`#live-loss must start hidden and empty: ${JSON.stringify(region)}`);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return region;
  });

  // r5-09-1: a coverage-detached capture gap carries no digit, and the report banner must still say so (EN and AR).
  await step('the report shows the capture-gap banner for a coverage-detached note with no digits', async () => {
    const mark = since();
    const keepId = await popup.evaluate(
      () => new Promise((r) => chrome.storage.session.get('lastSessionId', (v) => r(v.lastSessionId)))
    );
    await report.goto(`chrome-extension://${id}/report/report.html?session=${keepId}`);
    await report.waitForTimeout(800);
    const gapId = await report.evaluate(async () => {
      const db = await import('../core/db.js');
      const now = Date.now();
      const sid = 'council1010-gap-' + now;
      await db.putSession({ id: sid, seq: 9001, charter: 'council-1010 capture gap fixture', startedAt: now - 60000, endedAt: now, tabId: null, windowId: null,
        startUrl: 'http://127.0.0.1/', env: null, timeboxMinutes: null, expiresAt: null, breakdown: null, status: 'stopped' });
      await db.appendEvents([
        { sessionId: sid, kind: 'nav', url: 'http://127.0.0.1/', ts: now - 55000 },
        { sessionId: sid, kind: 'note', tag: 'capture-gap', gap: 'coverage-detached', text: 'Capture gap: coverage stopped when the debugger was detached.', ts: now - 30000 },
      ]);
      return sid;
    });
    const read = {};
    try {
      for (const lang of ['en', 'ar']) {
        await report.goto(`chrome-extension://${id}/report/report.html?session=${gapId}`);
        await report.evaluate((l) => globalThis.QAWi18n?.setLang?.(l), lang);
        await report.waitForTimeout(1500);
        read[lang] = await report.evaluate(() => { const b = document.getElementById('gap-banner'); return b ? { hidden: b.hidden, text: b.textContent.trim() } : null; });
        if (!read[lang] || read[lang].hidden || !read[lang].text) throw new Error(`${lang}: the gap banner is not shown for a coverage-detached note: ${JSON.stringify(read[lang])}`);
      }
      if (!/coverage/i.test(read.en.text)) throw new Error(`en: the banner does not name the coverage gap: ${read.en.text}`);
      if (!/[؀-ۿ]/.test(read.ar.text)) throw new Error(`ar: the banner is not Arabic: ${read.ar.text}`);
    } finally {
      // back on the walk's own session and in English, then the fixture goes: the report must not be open on a session while it is deleted
      await report.goto(`chrome-extension://${id}/report/report.html?session=${keepId}`).catch(() => {});
      await report.evaluate(() => globalThis.QAWi18n?.setLang?.('en')).catch(() => {});
      await report.waitForTimeout(800);
      await report.evaluate(async (sid) => { const db = await import('../core/db.js'); await db.deleteSession(sid); }, gapId).catch(() => {});
    }
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return read;
  });

  console.log('\n— the side panel: the workbench that stays open —');

  await step('the save dialog lists the shelves, saves what is ticked, and keeps the history', async () => {
    const mark = since();
    await report.locator('#save-all').click();
    await report.waitForTimeout(600);
    const shape = await report.evaluate(() => ({
      open: document.getElementById('save-dialog').open,
      groups: [...document.querySelectorAll('#save-parts fieldset legend')].map((l) => l.textContent),
      parts: document.querySelectorAll('#save-parts input').length,
      where: document.getElementById('save-where').textContent,
    }));
    if (!shape.open) throw new Error('dialog did not open');
    if (!shape.groups.includes('For a person to read') || !shape.groups.includes('For a machine or an AI')) throw new Error(`shelves: ${shape.groups.join(', ')}`);
    if (shape.parts < 20) throw new Error(`only ${shape.parts} parts offered`);
    if (!/QA Wrap\//.test(shape.where)) throw new Error(`destination: ${shape.where}`);

    // Only two parts: a Markdown document and a workbook, so both paths run.
    await report.locator('#save-none').click();
    await report.locator('#save-parts input[value="srs"]').check();
    await report.locator('#save-parts input[value="timeline-xlsx"]').check();
    await report.locator('#save-go').click();
    await report.waitForFunction(() => /Saved|failed/.test(document.getElementById('save-status').textContent), null, { timeout: 20000 });
    const status = await report.locator('#save-status').textContent();
    if (!/^Saved 2 files/.test(status)) throw new Error(status);
    await report.locator('#save-close').click();

    await openTab(report, 'raw');
    await report.waitForTimeout(500);
    const history = await report.evaluate(() => ({
      shown: !document.getElementById('saved-block').hidden,
      rows: document.querySelectorAll('#saved tr').length - 1,
      paths: [...document.querySelectorAll('#saved .mono')].map((n) => n.textContent),
    }));
    if (!history.shown || history.rows < 2) throw new Error(`history rows: ${history.rows}`);
    if (!history.paths.some((p) => /QA Wrap[\\/]Documents[\\/]/.test(p) && /\.md$/.test(p))) throw new Error(`srs path: ${history.paths.join(' | ')}`);
    if (!history.paths.some((p) => /QA Wrap[\\/]Session sheets[\\/]/.test(p))) throw new Error(`sheet path: ${history.paths.join(' | ')}`);
    if (!history.paths.some((p) => /\.xlsx$/.test(p))) throw new Error(`xlsx path: ${history.paths.join(' | ')}`);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { parts: shape.parts, saved: history.rows, sample: history.paths[0] };
  });

  // r10-10-5: in Arabic the saved-exports table shows no English format label (core/filing.js FORMATS holds the English fallbacks)
  await step('the Arabic saved-exports table shows no English FORMATS label', async () => {
    const mark = since();
    const sessionId = await popup.evaluate(() => new Promise((r) => chrome.storage.session.get('lastSessionId', (v) => r(v.lastSessionId))));
    try {
      await report.goto(`chrome-extension://${id}/report/report.html?session=${sessionId}`);
      await report.evaluate((l) => globalThis.QAWi18n?.setLang?.(l), 'ar');
      await report.waitForTimeout(1200);
      await openTab(report, 'raw');
      await report.waitForTimeout(600);
      const seen = await report.evaluate(async () => {
        const { FORMATS } = await import('../core/filing.js');
        const english = new Set(Object.values(FORMATS).map((f) => String(f.label || '').trim()).filter(Boolean).concat(['Session card']));
        const cells = [...document.querySelectorAll('#saved tr')].flatMap((tr) => [...tr.children].filter((c) => !c.querySelector('.mono') && !c.classList.contains('mono')).map((c) => c.textContent.trim()));
        return { rows: document.querySelectorAll('#saved tr').length - 1, hits: cells.filter((c) => english.has(c)), cells: cells.slice(0, 8) };
      });
      if (seen.rows < 1) throw new Error(`no saved-export rows to look at: ${JSON.stringify(seen)}`);
      if (seen.hits.length) throw new Error(`English format label(s) in the Arabic table: ${seen.hits.join(' | ')}`);
      const errs = newErrors(mark);
      if (errs.length) throw new Error(errs.join(' | '));
      return { rows: seen.rows, sample: seen.cells.slice(0, 3) };
    } finally {
      await report.evaluate((l) => globalThis.QAWi18n?.setLang?.(l), 'en').catch(() => {});
    }
  });

  await step('the diagram page draws the session on an A4 sheet, edits, and keeps the edit', async () => {
    const mark = since();
    const sessionId = await popup.evaluate(
      () => new Promise((r) => chrome.storage.session.get('lastSessionId', (v) => r(v.lastSessionId)))
    );
    const dia = await context.newPage();
    watch(dia, 'diagram');
    await dia.goto(`chrome-extension://${id}/diagram/diagram.html?session=${sessionId}`);
    await dia.waitForFunction(() => document.querySelectorAll('#sheet [data-node]').length > 0, null, { timeout: 8000 });
    const shape = await dia.evaluate(() => {
      const svg = document.querySelector('#sheet svg');
      return {
        viewBox: svg.getAttribute('viewBox'),
        nodes: document.querySelectorAll('#sheet [data-node]').length,
        edges: document.querySelectorAll('#sheet [data-edge]').length,
        rtl: document.querySelectorAll('#sheet [data-node] text[direction="rtl"]').length,
        legend: document.querySelectorAll('#sheet [data-region="legend"] text').length,
        story: !!document.querySelector('#sheet [data-region="story"]'),
        arabicTitle: /[\u0600-\u06FF]/.test(document.querySelector('#sheet [data-region="title"]')?.textContent || ''),
        firstX: Number(document.querySelector('#sheet [data-node] rect, #sheet [data-node] path')?.getAttribute('x') || 0),
      };
    });
    if (shape.viewBox !== '0 0 1123 794') throw new Error(`not A4 landscape: ${shape.viewBox}`);
    if (shape.nodes < 3 || shape.edges < 2) throw new Error(`too little drawn: ${shape.nodes} nodes, ${shape.edges} edges`);
    if (!shape.rtl || !shape.arabicTitle) throw new Error('labels are not Arabic RTL');
    if (shape.legend < 4 || !shape.story) throw new Error('legend or story missing');

    // Add a box, then keep the diagram with the session; the timeline must say so.
    await dia.locator('#add-kinds .kind-btn').nth(3).click();
    await dia.waitForTimeout(300);
    const after = await dia.evaluate(() => document.querySelectorAll('#sheet [data-node]').length);
    if (after !== shape.nodes + 1) throw new Error(`add did not add: ${shape.nodes} → ${after}`);
    await dia.locator('#save-session').click();
    await dia.waitForFunction(() => /Kept with the session/.test(document.getElementById('status').textContent), null, { timeout: 5000 });
    const svgOut = await popup.evaluate((sid) => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_EXPORT', sessionId: sid, format: 'flow-svg' }, r)), sessionId);
    if (!svgOut?.ok || !/<svg[^>]*viewBox="0 0 1123 794"/.test(svgOut.result.content)) throw new Error('flow-svg export is not the A4 sheet');
    if ((svgOut.result.content.match(/data-node=/g) || []).length !== after) throw new Error('the export did not carry the edit');
    await dia.close();
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { ...shape, after };
  });

  await step('the tool outputs export: page object, page map, brief and link check', async () => {
    const mark = since();
    await openTab(report, 'raw');
    await report.waitForTimeout(500);
    const out = {};
    for (const [format, needle] of [
      ['harvest-pom', /export class \w+Page \{/],
      // The page map used to be recognised by its $schema URL. That host does not
      // exist, so the field was removed; `generator` is what names the tool now.
      ['harvest-map', /"generator": "QA Wrap/],
      ['harvest-brief', /# Page brief for a test writer/],
      ['links', /# Link check/],
    ]) {
      await report.selectOption('#format', format);
      await report.waitForTimeout(700);
      const text = await report.locator('#content').textContent();
      if (!needle.test(text)) {
        // The pane alone cannot say whether the export failed or had simply not
        // arrived yet, and an empty pane read as "wrong content" sent the last
        // reader hunting through the wrong half of the product.
        const said = await report.locator('#status').textContent().catch(() => '');
        throw new Error(`${format}: pane ${JSON.stringify(text.slice(0, 80))}, status ${JSON.stringify((said || '').slice(0, 120))}`);
      }
      out[format] = text.length;
    }
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return out;
  });

  await step('the File tab offers seven kinds, drafts each one, and lists the evidence', async () => {
    const mark = since();
    // By its data attribute, not by its words: the tab was renamed "File it" to
    // "Jira" while this batch was in flight and the harness went red on a label
    // change that broke nothing. What the step is about is the panel behind it.
    await openTab(report, 'file');
    await report.waitForTimeout(600);

    const kinds = await report.locator('[data-artefact]').count();
    if (kinds !== 7) throw new Error(`expected 7 kinds, found ${kinds}`);

    // No credentials in this profile: the line says where they go, and the
    // one-press button stays hidden.
    const who = await report.locator('#jira-who').textContent();
    if (!/Settings|Connect/.test(who)) throw new Error(`jira-who: ${who}`); // r10: the line now says "Press Connect" (L4 copy); either way it points at the place credentials go
    if (await report.locator('#jira-quick').isVisible()) throw new Error('quick-file button shown without credentials');

    // A story: the ISTQB block folds away, the draft is a story, the evidence
    // set is the story's.
    await report.locator('[data-artefact="story"]').click();
    await report.waitForTimeout(900);
    const story = await report.evaluate(() => ({
      istqbHidden: document.getElementById('istqb-block').hidden,
      body: document.getElementById('jira-body').value,
      summary: document.getElementById('jira-summary').value,
      boxes: document.querySelectorAll('#jira-attach-list input').length,
      ticked: [...document.querySelectorAll('#jira-attach-list input:checked')].map((i) => i.value),
    }));
    if (!story.istqbHidden) throw new Error('ISTQB block still shown for a story');
    if (!/\*\*As a\*\*/.test(story.body)) throw new Error('story draft lacks "As a"');
    if (!/## Evidence/.test(story.body)) throw new Error('draft body lacks the evidence block');
    if (!story.summary) throw new Error('summary empty');
    if (story.boxes !== 10) throw new Error(`expected 10 attachment kinds, found ${story.boxes}`);
    if (story.ticked.join() !== 'screens,markdown,sbtm') throw new Error(`story defaults: ${story.ticked.join()}`);

    // Editing sticks; a rebuild no longer overwrites it, and reset brings the
    // recording's text back.
    await report.locator('#jira-body').fill('my words');
    await report.locator('[data-artefact="task"]').click();
    await report.waitForTimeout(900);
    const afterKind = await report.locator('#jira-body').inputValue();
    if (afterKind === 'my words') throw new Error('a new kind should start a new draft');
    await report.locator('#jira-body').fill('my words again');
    await report.evaluate(() => window.UQAIstqb.rebuild());
    await report.waitForTimeout(700);
    const kept = await report.locator('#jira-body').inputValue();
    if (kept !== 'my words again') throw new Error(`rebuild overwrote an edited draft: ${kept.slice(0, 40)}`);
    await report.locator('#jira-body-reset').click();
    const reset = await report.locator('#jira-body').inputValue();
    if (!/## Steps/.test(reset)) throw new Error('reset did not restore the task draft');

    // Back to the defect report: the ISTQB block returns with the judgement.
    await report.locator('[data-artefact="defect"]').click();
    await report.waitForTimeout(900);
    const defect = await report.evaluate(() => ({
      istqbHidden: document.getElementById('istqb-block').hidden,
      judgement: !document.getElementById('judgement').hidden,
      ticked: [...document.querySelectorAll('#jira-attach-list input:checked')].map((i) => i.value),
    }));
    if (defect.istqbHidden || !defect.judgement) throw new Error('defect report lost its ISTQB block');
    if (defect.ticked.join() !== 'screens,markdown,sbtm,har') throw new Error(`defect defaults: ${defect.ticked.join()}`);

    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { kinds, story: story.summary.slice(0, 40), evidence: defect.ticked.length };
  });

  // r10-04-1 (D-238): the build and the reproducibility land in the body that is filed (no credentials here: the filing message is caught before it leaves the page)
  await step('a defect filed with a build and a reproducibility carries both in the Jira body', async () => {
    const mark = since();
    await openTab(report, 'file');
    await report.locator('[data-artefact="defect"]').click();
    await report.waitForTimeout(900);
    if (!(await report.locator('#defect-build').count()) || !(await report.locator('#defect-repro').count())) throw new Error('#defect-build / #defect-repro are not on the page (L4 lands them)');
    await report.locator('#defect-build').fill('Build 4.5.6-rc2');
    await report.locator('#defect-repro').selectOption('sometimes');
    if (!(await report.locator('#jira-summary').inputValue())) await report.locator('#jira-summary').fill('Clickthrough defect');
    await report.evaluate(() => {
      window.__filed = [];
      for (const [id, v] of [['jira-project', 'QAW'], ['jira-type', 'Bug']]) {
        const el = document.getElementById(id);
        if (el && !el.value) { const o = document.createElement('option'); o.value = v; o.textContent = v; el.append(o); el.value = v; }
      }
      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (m, cb) => {
        if (m && m.type === 'UQA_JIRA_FILE') { window.__filed.push(m); const res = { ok: false, error: 'caught by the clickthrough' }; if (typeof cb === 'function') { cb(res); return undefined; } return Promise.resolve(res); }
        return orig(m, cb);
      };
    });
    report.once('dialog', (d) => d.accept().catch(() => {}));
    await report.evaluate(() => document.getElementById('jira-file').click()); // hidden without credentials: a DOM click reaches file() all the same
    await report.waitForFunction(() => window.__filed.length > 0, null, { timeout: 8000 }).catch(() => {});
    const filed = await report.evaluate(() => window.__filed.map((m) => ({ type: m.type, body: String(m.body || '') })));
    if (!filed.length) throw new Error('no UQA_JIRA_FILE message was sent (the filing form blocked it before the body was built)');
    const body = filed[0].body;
    if (!/Build 4\.5\.6-rc2/.test(body)) throw new Error(`the filed body lacks the build: ${body.slice(-200)}`);
    if (!/Sometimes/.test(body)) throw new Error(`the filed body lacks the reproducibility: ${body.slice(-200)}`);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { tail: body.slice(-90) };
  });

  await step('the side panel boots the same page in docked mode, and a tool press does not close it', async () => {
    const mark = since();
    const panel = await context.newPage();
    watch(panel, 'sidepanel');
    await panel.goto(`chrome-extension://${id}/sidepanel/sidepanel.html`);
    const frame = panel.frames().find((f) => f.url().includes('popup/popup.html'))
      || (await panel.waitForEvent('frameattached', { timeout: 5000 }).catch(() => null));
    if (!frame) throw new Error('the panel did not load the popup page');
    await frame.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 15000 });
    const shape = await frame.evaluate(() => ({
      surface: document.documentElement.dataset.surface,
      width: document.body.getBoundingClientRect().width,
      awake: document.body.dataset.awake,
    }));
    if (shape.surface !== 'panel') throw new Error(`the page did not know it was docked: ${JSON.stringify(shape)}`);
    // Pressing a tool that hands off to the page must leave the panel open.
    await page.bringToFront().catch(() => {});
    await page.focus('#applicant');
    await panel.bringToFront().catch(() => {});
    await frame.click('[data-action="inject"]');
    await frame.waitForTimeout(600);
    const stillOpen = !panel.isClosed() && (await frame.evaluate(() => !!document.body));
    await page.keyboard.press('Escape');
    await panel.close();
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    if (!stillOpen) throw new Error('the panel closed itself after a tool press');
    return { ...shape, stillOpen };
  });

  await step('the Save sheet picks by section, and counts what is ticked', async () => {
    const mark = since();
    await report.click('#save-all');
    await report.waitForTimeout(600);
    const shape = await report.evaluate(() => ({
      sections: document.querySelectorAll('#save-parts fieldset.attach').length,
      alls: document.querySelectorAll('#save-parts [data-section-all]').length,
      nones: document.querySelectorAll('#save-parts [data-section-none]').length,
      boxes: document.querySelectorAll('#save-parts input[type="checkbox"]').length,
      count: document.getElementById('save-count')?.textContent || '',
      where: document.getElementById('save-where')?.textContent || '',
    }));
    if (!shape.sections) throw new Error('the sheet has no sections');
    if (shape.alls !== shape.sections || shape.nones !== shape.sections) {
      throw new Error(`${shape.sections} sections, ${shape.alls} All and ${shape.nones} None`);
    }
    if (!/selected of/.test(shape.count)) throw new Error(`the count line reads "${shape.count}"`);

    // None on the first section clears that section and nothing else: every other box keeps the state
    // the sheet opened with (the "more" shelf opens unticked, so "all ticked" is not the baseline).
    const after = await report.evaluate(() => {
      const fs = document.querySelector('#save-parts fieldset.attach');
      const own = [...fs.querySelectorAll('input[type="checkbox"]')];
      const others = [...document.querySelectorAll('#save-parts input[type="checkbox"]')].filter((b) => !own.includes(b));
      const was = others.map((b) => b.checked);
      fs.querySelector('[data-section-none]').click();
      return {
        cleared: own.every((b) => !b.checked),
        othersKept: others.every((b, i) => b.checked === was[i]),
        count: document.getElementById('save-count').textContent,
        pressed: fs.querySelector('[data-section-none]').getAttribute('aria-pressed'),
      };
    });
    if (!after.cleared) throw new Error('None left boxes ticked in its own section');
    if (!after.othersKept) throw new Error('None cleared a section it does not own');
    if (after.pressed !== 'true') throw new Error(`the None button says aria-pressed="${after.pressed}"`);

    // Every button is reachable by keyboard.
    const reachable = await report.evaluate(() =>
      [...document.querySelectorAll('#save-parts button')].every((b) => b.tabIndex >= 0 && !b.disabled));
    if (!reachable) throw new Error('a section button cannot be reached from the keyboard');

    await report.evaluate(() => document.querySelector('#save-parts [data-section-all]').click());
    await report.click('#save-close');
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { sections: shape.sections, boxes: shape.boxes, count: after.count };
  });

  console.log('\n— the settings page —');

  const options = await context.newPage();
  watch(options, 'options');

  await step('settings renders every control and takes a change', async () => {
    const mark = since();
    // Settings is a tab set (decision 114): a control on a tab that is not
    // the default is hidden until its tab opens. The hash names the control,
    // and options.js opens the tab that owns it — the same deep link a support
    // note or the popup would use.
    await options.goto(`chrome-extension://${id}/options/options.html#soundEnabled`);
    await options.waitForTimeout(1200);
    const shape = await options.evaluate(() => ({
      ranges: document.querySelectorAll('input[type="range"]').length,
      checks: document.querySelectorAll('input[type="checkbox"]').length,
      selects: document.querySelectorAll('select').length,
    }));
    await options.click('#soundEnabled');
    await options.waitForTimeout(400);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    if (!shape.ranges || !shape.checks) throw new Error('the settings page came up empty');
    return shape;
  });

  await step('the tracker forms are drawn, take a token, and reach the report', async () => {
    const mark = since();
    // One form per adapter, drawn from what each declares it needs. They were
    // reachable by message only for two versions; this is the step that would
    // have said so. The count comes from the specs the settings page itself
    // reads, so adding an adapter does not mean editing a number here: it is
    // seven today, github gitlab azure linear trello clickup asana.
    const { TRACKER_SPECS } = await import('../core/tracker-specs.js');
    // The forms live on the Integrations tab, one screen per service (round 3): the grid has a card for each.
    await options.evaluate(() => { location.hash = 'sec-integrations'; });
    await options.waitForSelector('#svc-grid .svc', { timeout: 8000 }).catch((e) => { throw new Error(`${e.message.split(String.fromCharCode(10))[0]} :: ${newErrors(mark).join(' | ')}`); });
    const forms = await options.evaluate((ids) => ids.filter((i) => document.querySelector(`#svc-grid [data-svc="${i}"]`)).length, TRACKER_SPECS.map((x) => x.id));
    if (forms !== TRACKER_SPECS.length) {
      throw new Error(`${forms} tracker cards, expected ${TRACKER_SPECS.length}`);
    }
    await options.click('#svc-grid [data-svc="github"]');
    await options.fill('#f-token', 'ghp_clickthrough_not_a_real_token');
    await options.fill('#f-repo', 'example/repo');
    await options.click('.svc-form [type=submit]');
    await options.waitForSelector('.conn .saved');
    await options.reload();
    // the address still names the service (#sec-integrations/github), so the reload lands on its screen
    await options.waitForSelector('.conn .saved');
    await options.click('[data-act=back]');
    await options.waitForSelector('#svc-grid .svc');
    const kept = await options.evaluate(() => ({
      state: document.querySelector('#svc-grid [data-svc="github"] .svc-st')?.textContent,
    }));
    if (!/Connected/.test(kept.state || '')) throw new Error(`the token did not survive a reload: ${JSON.stringify(kept)}`);
    // And the report page now offers it — without sending anything.
    const report = await context.newPage();
    watch(report, 'report');
    await report.goto(`chrome-extension://${id}/report/report.html`);
    await report.waitForTimeout(1500);
    const offered = await report.evaluate(() => ({
      blockHidden: document.getElementById('trackers-block')?.hidden,
      rows: document.querySelectorAll('#trackers .tracker-row').length,
    }));
    await report.close();
    // Leave the settings as they were found.
    await options.click('#svc-grid [data-svc="github"]');
    await options.click('[data-act=forget]');
    await options.waitForTimeout(600);
    const errs = newErrors(mark).filter((e) => !/api\.github\.com|Could not reach GitHub|refused this/.test(e));
    if (errs.length) throw new Error(errs.join(' | '));
    if (offered.blockHidden || offered.rows !== 1) throw new Error(`report did not offer the tracker: ${JSON.stringify(offered)}`);
    return { forms, ...kept, ...offered };
  });

  await step('resetting the settings keeps every session', async () => {
    const mark = since();
    const count = () => popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_LIST_SESSIONS' }, (res) => r(res?.result?.length ?? -1))));
    const before = await count();

    // A setting changed away from its default, so the reset has something to
    // put back that is visible in the reply rather than inferred.
    await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_SET_SETTINGS', patch: { videoFps: 29, downloadFolder: 'Somewhere' } }, r)));
    const changed = await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS' }, (res) => r(res?.result))));
    if (changed?.videoFps !== 29) throw new Error('the setting under test would not change');

    const reset = await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_RESET_SETTINGS' }, r)));
    if (!reset?.ok) throw new Error(`the reset was refused: ${reset?.error}`);
    if (reset.result.videoFps === 29) throw new Error('the setting survived the reset');
    if (reset.result.downloadFolder !== '') throw new Error(`downloadFolder came back as "${reset.result.downloadFolder}"`);

    const after = await count();
    if (after !== before) throw new Error(`the reset changed the session count: ${before} → ${after}`);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { sessions: after, videoFps: reset.result.videoFps };
  });

  await step('deleting a session takes it, and its report moves on', async () => {
    const mark = since();
    const list = () => popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_LIST_SESSIONS' }, (res) => r(res?.result || []))));
    const before = await list();
    if (!before.length) throw new Error('nothing has been recorded to delete');

    // Something to delete that is not the session the rest of the suite reads.
    const made = await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_START', charter: 'A session recorded to be deleted' }, r)));
    if (!made?.ok) throw new Error(`could not record one to delete: ${made?.error}`);
    await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_STOP' }, r)));
    await popup.waitForTimeout(500);
    const withExtra = await list();
    if (withExtra.length !== before.length + 1) throw new Error(`the extra session was not recorded (${before.length} → ${withExtra.length})`);

    const doomed = made.result.id;
    const gone = await popup.evaluate((id) => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_DELETE_SESSION', sessionId: id }, r)), doomed);
    if (!gone?.ok) throw new Error(`the delete was refused: ${gone?.error}`);

    const after = await list();
    if (after.length !== withExtra.length - 1) throw new Error(`the count did not go down (${withExtra.length} → ${after.length})`);
    if (after.some((x) => x.id === doomed)) throw new Error('the deleted session is still listed');

    // Its timeline is gone with it, not orphaned.
    const timeline = await popup.evaluate((id) => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_GET_TIMELINE', sessionId: id }, (res) => r(res?.result))), doomed);
    if (timeline?.session) throw new Error('the deleted session still has a row');

    // And the report offers the action on the session it is showing.
    const action = await report.evaluate(() => {
      const btn = document.getElementById('session-delete');
      return { there: !!btn, label: btn?.textContent?.trim(), reachable: btn ? btn.tabIndex >= 0 && !btn.disabled : false };
    });
    if (!action.there || !action.reachable) throw new Error(`the report's delete action is ${JSON.stringify(action)}`);

    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    return { before: withExtra.length, after: after.length, action: action.label };
  });

  console.log('\n— the sound library, actually running —');

  await step('every sound in the palette plays without throwing', async () => {
    const mark = since();
    /*
     * The design of the palette is unit-tested; whether it makes a noise is not
     * testable without a real AudioContext, which is why this is here.
     *
     * A click first: a context created outside a user gesture starts suspended
     * and stays silent for ever, with nothing logged anywhere to explain it.
     * That silent failure is what this step exists to catch.
     */
    await popup.click('#more');
    await popup.keyboard.press('Escape');
    const out = await popup.evaluate(async () => {
      const S = window.UQASound;
      if (!S) return { error: 'the library is not on the page' };
      S.configure({ on: true, level: 0.001, scope: 'all' }); // audible to the engine, not to a person
      const ready = await S.ready(); // fetched and decoded once from ui/sfx
      // The three-voice cap lets a core sound take a touch sound's voice, so a touch sound that comes
      // after the long core files is refused by the rules, not by a broken file. Touch first, then core.
      const names = Object.keys(S.SOUNDS).sort((a, b) => (S.SOUNDS[a].scope === 'touch' ? 0 : 1) - (S.SOUNDS[b].scope === 'touch' ? 0 : 1));
      const played = [];
      for (const event of names) {
        // Each sound is given room: the rules of play drop a touch sound that follows
        // another within 120 ms, and this would be measuring the rules, not the files.
        await new Promise((r) => setTimeout(r, 200));
        played.push({ event, ok: S.play(event) });
      }
      return { events: names.length, ready, files: S.FILES.length, played };
    });

    if (out.error) throw new Error(out.error);
    const silent = out.played.filter((p) => !p.ok).map((p) => p.event);
    const errs = newErrors(mark);
    if (errs.length) throw new Error(errs.join(' | '));
    if (out.ready !== out.files) throw new Error(`only ${out.ready} of ${out.files} sound files were fetched and decoded`);
    if (silent.length) throw new Error(`${silent.length} sound(s) did not play: ${silent.slice(0, 5).join(', ')}`);
    return { sounds: out.events, files: out.ready };
  });

  await step('sound stays silent until it is switched on', async () => {
    const out = await popup.evaluate(() => {
      window.UQASound.configure({ on: false });
      const refused = window.UQASound.play('switch.wake');
      window.UQASound.configure({ on: true, level: 0.001 });
      return { refusedWhileOff: refused === false };
    });
    if (!out.refusedWhileOff) throw new Error('a sound played while sound was switched off');
    return out;
  });

  await step('each kind of control gets its own sound, not one generic tap', async () => {
    const heard = await popup.evaluate(() => {
      const S = window.UQASound;
      const seen = {};
      for (const el of document.querySelectorAll('button, a[href], select, summary, .tool, .tab, .sec-btn')) {
        const name = S.soundFor(el);
        if (name) seen[name] = (seen[name] || 0) + 1;
      }
      return seen;
    });
    const distinct = Object.keys(heard).length;
    if (distinct < 4) {
      throw new Error(`only ${distinct} distinct sound(s) across every control: ${JSON.stringify(heard)}`);
    }
    return { distinct, sounds: Object.keys(heard) };
  });


  console.log('\n— a running operation locks the choices that made it —');

  await step('every recording choice is locked while a clip runs, the scope included', async () => {
    /*
     * The reported bug, asserted directly.
     *
     * paintRecording() locked "#capture-row" - the mic/sound/webcam chips - and
     * the scope radios live in the panel ABOVE that row. So the one control
     * that most obviously cannot change mid-clip was the only one left live:
     * flipping "This tab" to "Window or screen" during a recording did nothing
     * to the running clip and silently changed what the next press would do.
     *
     * Driven through paintRecording's known-state argument because neither
     * tabCapture nor the desktop picker can be started from a script - which is
     * exactly why this went unnoticed. A state that cannot be reached in a test
     * is a state that ships untested unless it is injected.
     */
    const out = await popup.evaluate(async () => {
      await window.paintRecording(
        { recording: true, startedAt: Date.now(), sources: { screen: true } },
        { minutesOfVideo: 30 }
      );
      const inputs = [...document.querySelectorAll('#capture-panel input')];
      const live = inputs.filter((i) => !i.disabled).map((i) => i.id || i.name + '=' + i.value);
      const checked = document.querySelector('input[name="rec-scope"]:checked')?.value;
      const label = document.querySelector('#record-tool .tool-name')?.textContent;

      await window.paintRecording({ recording: false }, { minutesOfVideo: 30 });
      const afterLive = [...document.querySelectorAll('#capture-panel input')]
        .filter((i) => !i.disabled).length;

      return { total: inputs.length, live, checked, label, afterLive };
    });

    if (!out.total) throw new Error('the capture panel has no inputs — the selector is wrong');
    if (out.live.length) {
      throw new Error(`${out.live.length} control(s) still live mid-recording: ${out.live.join(', ')}`);
    }
    // And it must show the scope actually being filmed, not whatever the radio
    // was last left on - a popup reopened during a screen clip used to claim
    // it was recording the tab.
    if (out.checked !== 'screen') {
      throw new Error(`filming the screen but the panel says "${out.checked}"`);
    }
    if (!out.afterLive) throw new Error('the controls never came back after the clip ended');
    return { locked: out.total, scopeShown: out.checked, button: out.label, freedAfter: out.afterLive };
  });

  await step('a second full-page capture is refused rather than spoiling both', async () => {
    /*
     * Same shape, different feature. capturePageTiles scrolls the page to
     * photograph it; two at once interleave their scrolls and both stitched
     * images come out torn, with nothing in either file to say so. Every tool
     * button stays live for the several seconds a long page takes, so pressing
     * twice is not an unusual thing to do.
     */
    const out = await popup.evaluate(async (fixture) => {
      const call = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));

      // This runs after the session was stopped and with the report and
      // settings pages open, so neither the front tab nor the armed state can
      // be assumed - both are established here.
      const tabs = await new Promise((r) => chrome.tabs.query({}, r));
      const target = tabs.find((t) => t.url && t.url.startsWith(fixture));
      if (!target) return { error: 'the fixture tab is gone' };
      await call({ type: 'UQA_ARM', windowId: target.windowId });

      const [first, second] = await Promise.all([
        call({ type: 'UQA_CAPTURE_FULL', tabId: target.id, text: 'lock test A' }),
        call({ type: 'UQA_CAPTURE_FULL', tabId: target.id, text: 'lock test B' }),
      ]);
      return { first, second };
    }, origin);

    if (out.error) throw new Error(out.error);
    const { first, second } = out;

    const ok = [first, second].filter((r) => r?.ok).length;
    const refused = [first, second].find((r) => r && !r.ok)?.error || '';

    if (ok === 2) throw new Error('both ran at once — the tab lock is not holding');
    if (ok === 0) throw new Error(`neither ran: ${first?.error} | ${second?.error}`);
    if (!/still running/i.test(refused)) {
      throw new Error(`refused, but not by the lock: ${refused}`);
    }
    return { ran: ok, refusedWith: refused.slice(0, 68) };
  });

  console.log('\n— the master switch is a master switch —');

  await step('sleep stops, saves and resets everything; waking starts clean', async () => {
    /*
     * The invariant the store listing promises, asserted end to end.
     *
     * "Asleep" used to mean only that new work was refused. A clip carried on
     * filming a window the extension said was asleep; the session it belonged
     * to was stopped but the recording was not; the activeTab grants survived;
     * and the offscreen document — a hidden page holding a camera and a
     * microphone — outlived the switch entirely. Each of those is a capability
     * running after consent was withdrawn, which is the one thing this switch
     * exists to make impossible.
     *
     * The clip half is conditional on purpose. A harness cannot invoke the
     * extension the way Chrome requires before it will grant `activeTab`, so
     * `UQA_RECORD_START` may legitimately refuse here — in which case the
     * refusal itself is what is asserted, and the session half of the rule is
     * still checked in full. What is never skipped: after Sleep,
     * `UQA_RECORD_STATE` must say nothing is recording, and `UQA_CAN_RECORD`
     * must say the grant is gone.
     */
    const before = await popup.evaluate(async (fixture) => {
      const call = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));
      const tabs = await new Promise((r) => chrome.tabs.query({}, r));
      const target = tabs.find((t) => t.url && t.url.startsWith(fixture));
      if (!target) return { error: 'the fixture tab is gone' };

      await call({ type: 'UQA_ARM', windowId: target.windowId });
      const session = await call({ type: 'UQA_START', charter: 'Sleep stops everything', tabId: target.id });
      const clip = await call({ type: 'UQA_RECORD_START', tabId: target.id });
      const recording = await call({ type: 'UQA_RECORD_STATE' });

      // Repaint from the worker so the switch reflects the arming just made,
      // rather than whatever the last render left on screen.
      await window.paintSwitch();
      return {
        windowId: target.windowId,
        tabId: target.id,
        sessionId: session.result?.id || null,
        sessionOk: !!session.ok,
        clipOk: !!clip.ok,
        clipError: clip.ok ? '' : String(clip.error || ''),
        recording: !!recording.result?.recording,
        switchTitle: document.getElementById('switch-title')?.textContent,
      };
    }, origin);

    if (before.error) throw new Error(before.error);
    if (!before.sessionOk || !before.sessionId) throw new Error('the session would not start, so there is nothing to put to sleep');
    if (before.switchTitle !== 'Awake') throw new Error(`armed, but the switch reads "${before.switchTitle}"`);
    if (before.clipOk && !before.recording) throw new Error('the clip reported a start and nothing is recording');
    if (!before.clipOk && !/activeTab|has not been invoked|Chrome drops permission|Record a video of this tab/i.test(before.clipError)) {
      throw new Error(`the clip was refused, but not by the activeTab grant: ${before.clipError}`);
    }

    // Sleep is a full stop (6 Oct 2026): a mask on the page when Sleep is pressed
    // must be gone after it, and a late apply must paint nothing.
    const maskEntry = { id: 'sleepstop', path: '#applicant', index: 0, name: 'Applicant name', tag: 'input' };
    await popup.evaluate(
      ({ tabId, entry }) => new Promise((r) => chrome.tabs.sendMessage(tabId, { type: 'UQA_MASK_APPLY', masks: [entry] }, r)),
      { tabId: before.tabId, entry: maskEntry }
    );
    const maskedBeforeSleep = await page.evaluate(() => document.querySelectorAll('[data-uqa-masked]').length);
    if (!maskedBeforeSleep) throw new Error('the mask to put to sleep was never painted, so the sleep check proves nothing');

    // Press the switch itself, not the message behind it: the button is what a
    // tester touches, and a handler that works through a control nobody can
    // reach is not a working feature.
    await pressSwitch();
    /*
     * Wait for the press to be *answered*, not for it to be painted.
     *
     * "Asleep" appears in the same tick as the click: the popup paints every
     * press optimistically, before the message has been anywhere. Sleep is the
     * message, not the paint — the clip is stopped and saved, the session is
     * stopped and written to IndexedDB, the grants are dropped — and the reply
     * to `UQA_DISARM` is what says all of that is done. Gating on the title
     * alone read the session row while it was still running, and the step
     * failed with "sleep did not end the session" whenever the teardown took
     * longer than the popup took to repaint. Measured over thirty presses, the
     * read landed ahead of the reply 27 times and cleared the write by as
     * little as 1 ms.
     *
     * `.is-pending` is the class `optimistic()` puts on the card for exactly
     * this interval, and it is dropped the moment the worker answers. It is
     * also what the tester sees, so this waits for the same thing they do.
     */
    const settled = (title) =>
      popup.waitForFunction(
        (want) =>
          document.getElementById('switch-title')?.textContent === want &&
          !document.getElementById('switch-card')?.classList.contains('is-pending'),
        title,
        { timeout: 8000 }
      );
    await settled('Asleep');

    const asleep = await popup.evaluate(async (sessionId) => {
      const call = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));
      const timeline = await call({ type: 'UQA_GET_TIMELINE', sessionId });
      const recording = await call({ type: 'UQA_RECORD_STATE' });
      const state = await call({ type: 'UQA_GET_STATE' });
      const can = await call({ type: 'UQA_CAN_RECORD' });
      const actions = [...document.querySelectorAll('[data-action]')];
      return {
        endedAt: timeline.result?.session?.endedAt ?? null,
        status: timeline.result?.session?.status ?? null,
        recording: !!recording.result?.recording,
        sessionRunning: !!state.result?.recording,
        can: can.result || null,
        title: document.getElementById('switch-title')?.textContent,
        awake: document.body.dataset.awake,
        tools: actions.length,
        live: actions.filter((b) => !b.disabled && b.dataset.asleep !== 'true').map((b) => b.dataset.action),
      };
    }, before.sessionId);

    const maskedAfterSleep = await page.evaluate(() => document.querySelectorAll('[data-uqa-masked]').length);
    if (maskedAfterSleep) throw new Error(`${maskedAfterSleep} masked element(s) survived Sleep`);
    await popup.evaluate(
      ({ tabId, entry }) => new Promise((r) => chrome.tabs.sendMessage(tabId, { type: 'UQA_MASK_APPLY', masks: [entry] }, r)),
      { tabId: before.tabId, entry: maskEntry }
    );
    const maskedLate = await page.evaluate(() => document.querySelectorAll('[data-uqa-masked]').length);
    if (maskedLate) throw new Error('a mask was painted while the window was asleep');

    if (!asleep.endedAt) throw new Error('sleep did not end the session — it has no endedAt');
    if (asleep.status !== 'stopped') throw new Error(`the session was left as "${asleep.status}", not stopped`);
    if (asleep.recording) throw new Error('a clip is still recording in a window that is asleep');
    if (asleep.sessionRunning) throw new Error('the worker still reports a running session');
    if (asleep.can?.can !== false || asleep.can?.why !== 'not-invoked') {
      throw new Error(`the recording grant survived sleep: ${JSON.stringify(asleep.can)}`);
    }
    if (asleep.awake !== 'false') throw new Error(`the body still says data-awake="${asleep.awake}"`);
    if (!asleep.tools) throw new Error('no tools are drawn, so "all asleep" proves nothing');
    if (asleep.live.length) throw new Error(`${asleep.live.length} tool(s) still live while asleep: ${asleep.live.join(', ')}`);

    // And waking is a clean slate: nothing resumes. Answered, not painted, for
    // the same reason: the three questions below are put to the worker.
    await pressSwitch();
    await settled('Awake');

    const awake = await popup.evaluate(async () => {
      const call = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));
      const state = await call({ type: 'UQA_GET_STATE' });
      const recording = await call({ type: 'UQA_RECORD_STATE' });
      const can = await call({ type: 'UQA_CAN_RECORD' });
      const actions = [...document.querySelectorAll('[data-action]')];
      return {
        sessionRunning: !!state.result?.recording,
        recording: !!recording.result?.recording,
        can: can.result || null,
        awake: document.body.dataset.awake,
        disabled: actions.filter((b) => b.disabled && b.dataset.unavailable !== 'true').map((b) => b.dataset.action),
      };
    });

    if (awake.sessionRunning) throw new Error('waking resumed a session that had been stopped');
    if (awake.recording) throw new Error('waking resumed a clip');
    if (awake.can?.can !== false) throw new Error('waking handed back a recording grant nobody invoked');
    if (awake.awake !== 'true') throw new Error('the body did not come back awake');
    if (awake.disabled.length) throw new Error(`still disabled after waking: ${awake.disabled.join(', ')}`);

    return {
      clip: before.clipOk ? 'started and stopped by sleep' : 'refused without a grant, as expected',
      endedAt: !!asleep.endedAt,
      toolsLockedAsleep: asleep.tools,
    };
  });

  console.log('\n— Mattermost with a closed vault (r3-09-2, D-1010-46) —');

  // A fake Mattermost on this machine. It answers every route, so a request that left the page would be seen and counted.
  const mmSeen = [];
  const mmServer = http.createServer((req, res) => {
    mmSeen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(req.url.includes('/users/me') ? '{"id":"u1","username":"qa","first_name":"QA","last_name":""}' : req.url.includes('/teams') ? '[{"id":"t1","name":"team"}]' : '[]');
  });
  await new Promise((r) => mmServer.listen(0, '127.0.0.1', r));
  const mmUrl = `http://127.0.0.1:${mmServer.address().port}`;
  try {
    await step('the Mattermost panel with the vault closed shows the locked sentence and its link, Post here cannot be reached, no confirm opens', async () => {
      const b64 = (u8) => Buffer.from(u8).toString('base64');
      const call = (m) => popup.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
      const key = b64(crypto.getRandomValues(new Uint8Array(32)));
      let unlocked = false;
      try {
        // a saved server and its token (the token goes into the vault), then a passphrase, then the lock
        await popup.evaluate((u) => chrome.storage.local.set({ mattermost: { url: u, teamId: 't1', channelId: 'c1' } }), mmUrl);
        const saved = await call({ type: 'UQA_SET_SETTINGS', patch: { trackers: { mattermost: { token: 'CANARY-mm-token-1010' } } } });
        if (!saved?.ok) throw new Error(`the token was not saved into the vault: ${JSON.stringify(saved)?.slice(0, 160)}`);
        const pass = await call({ type: 'UQA_VAULT_PASS', key, salt: b64(crypto.getRandomValues(new Uint8Array(16))), iters: 600000, idle: 30 });
        if (!pass?.ok) throw new Error(`a passphrase could not be set: ${JSON.stringify(pass)?.slice(0, 160)}`);
        const locked = await call({ type: 'UQA_VAULT_LOCK' });
        if (locked?.result?.locked !== true) throw new Error(`the vault did not lock: ${JSON.stringify(locked)?.slice(0, 160)}`);

        const sessionId = await popup.evaluate(() => new Promise((r) => chrome.storage.session.get('lastSessionId', (v) => r(v.lastSessionId))));
        let dialogs = 0;
        const onDialog = (d) => { dialogs++; d.dismiss().catch(() => {}); };
        report.on('dialog', onDialog);
        try {
          await report.goto(`chrome-extension://${id}/report/report.html?session=${sessionId}`);
          await report.waitForSelector('#mm-status', { state: 'attached', timeout: 15000 });
          await report.locator('#sec-share').click();
          await report.locator('#mattermost-panel > summary').click();
          await report.waitForFunction(() => /./.test(document.getElementById('mm-status')?.textContent || ''), null, { timeout: 8000 });
          const view = await report.evaluate(() => {
            const vis = (e) => !!e && !e.hidden && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
            const link = document.querySelector('#mm-status a');
            return {
              text: document.getElementById('mm-status').textContent,
              href: link?.getAttribute('href') || '',
              linkVisible: vis(link),
              postVisible: vis(document.getElementById('mm-post')),
              postDisabled: !!document.getElementById('mm-post')?.disabled,
              pickersHidden: !!document.getElementById('mm-pickers')?.hidden,
              forgetShown: vis(document.getElementById('mm-forget')),
            };
          });
          if (!/locked vault/i.test(view.text)) throw new Error(`the locked sentence is missing: ${JSON.stringify(view.text)}`);
          if (!/options\.html#sec-integrations$/.test(view.href) || !view.linkVisible) throw new Error(`the unlock link is missing or hidden: ${JSON.stringify(view)}`);
          if (view.postVisible || !view.postDisabled || !view.pickersHidden) throw new Error(`Post here is reachable: ${JSON.stringify(view)}`);
          // force the press anyway: a disabled control must still open nothing and send nothing
          await report.evaluate(() => document.getElementById('mm-post').click());
          await report.waitForTimeout(500);
          if (dialogs !== 0) throw new Error(`${dialogs} confirm dialog(s) opened`);
          if (mmSeen.length !== 0) throw new Error(`the fake server saw requests: ${mmSeen.join(' | ')}`);
          return { locked: true, link: view.href, forgetShown: view.forgetShown, dialogs, serverRequests: mmSeen.length };
        } finally {
          report.off('dialog', onDialog);
        }
      } finally {
        // leave the profile as it was found: unlock, remove the passphrase, forget the server and the canary token
        await call({ type: 'UQA_VAULT_UNLOCK', key }).then(() => { unlocked = true; }).catch(() => {});
        await call({ type: 'UQA_VAULT_PASS', key: null }).catch(() => {});
        await call({ type: 'UQA_SET_SETTINGS', patch: { trackers: { mattermost: { token: '' } } } }).catch(() => {});
        await popup.evaluate(() => chrome.storage.local.remove('mattermost')).catch(() => {});
        if (!unlocked) console.log('          NOTE: the vault could not be unlocked again; later steps may see a closed vault');
      }
    });
  } finally {
    await new Promise((r) => mmServer.close(r));
  }

  console.log('\n— nothing logged an error anywhere —');

  check('no context reported an error during the whole walk', () => {
    // Page-side 500s are the fixture doing its job, not a fault.
    const real = errors.filter((e) => !/500 \(Internal Server Error\)|status 500|Failed to load resource/i.test(e));
    if (real.length) throw new Error(real.join('\n          '));
  });
} finally {
  closing = true;
  await context.close();
  server.close();
}

if (diedAt) { fail++; problems.push(`FAIL browser died at step ${diedAt}`); console.log(`  FAIL  browser died at step ${diedAt}`); }

console.log(`\n${pass} passed, ${fail} failed\n`);
if (problems.length) {
  console.log('what to fix:');
  problems.forEach((p) => console.log(`  · ${p}`));
  console.log('');
}
process.exit(fail ? 1 : 0);
