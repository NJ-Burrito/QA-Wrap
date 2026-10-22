/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The recorder: the real extension, driven through a storyboard.
 *
 *   node tools/film/record/driver.mjs                    every film, every pass
 *   node tools/film/record/driver.mjs qa-wrap            one film
 *   node tools/film/record/driver.mjs qa-wrap --pass=h   one film, 16:9 only
 *
 * ── what this is, and what it deliberately is not ─────────────────────────
 *
 * It records **the product and nothing else**. No caption, chip, ring or
 * counter is injected into a filmed page: those are drawn by the composition
 * (bible 5.1 rule 6), which is the structural fix for the old commercial's
 * 0.9 s caption dropout, and it is also why a reworded caption costs no
 * recording at all. There is no cursor in a frame either, for the same reason:
 * the graphic layer's click ring is where a press is shown, and `marks.json`
 * tells the composition the frame each press really happened on.
 *
 * ── how a frame is made, and why not with a screencast ───────────────────
 *
 * Every frame is a `page.screenshot({ animations: 'disabled', scale: 'device' })`
 * at the CSS viewport the bible's placement table gives that surface, at
 * `deviceScaleFactor: 2`. A 1080x720 recording therefore arrives as exactly
 * 2160x1440 real pixels and lands in the 1920x1080 master at 1080x720 with no
 * resample anywhere in the chain (bible 2.2).
 *
 * CDP's `Page.startScreencast` was tried first and rejected on a measurement:
 * it hands back frames at the browser widget's own surface size, **1350x900 on
 * this machine whatever `maxWidth` and `maxHeight` are set to**, and the only
 * road from there to 2160x1440 is an upscale. Bible 2.9 rule 1 bans that
 * outright and 6.5 measured softness at as little as 1.0875x, so the faster
 * road is the wrong one. Bible 5.1 rule 5 in fact names `screenshot()` with
 * `animations: 'disabled'` directly; this is that, taken literally.
 *
 * ── the virtual clock ─────────────────────────────────────────────────────
 *
 * A screenshot costs far more than a thirtieth of a second, so a shot is not
 * filmed in real time: it is filmed on a **virtual clock that advances exactly
 * one frame per screenshot**. `t.at()` is film time, `t.until(sec)` captures
 * frames until film time reaches `sec`, and a shot always ends with exactly
 * `outFrame - inFrame + 1` frames. Three things follow, all of them good:
 *
 *   * the take is frame-exact, and identical on a fast machine and a slow one;
 *   * the product always gets **more** real time than film time to answer a
 *     click, so a 500 has landed by the frame the shot wanted it on;
 *   * with animations disabled, no CSS transition is ever caught mid-flight,
 *     so none of them can play at the wrong speed.
 *
 * A held shot takes one screenshot and says so: `still` in `shot.json` means
 * that one PNG stands for every frame, and the composition repeats it.
 *
 * ── the three passes ──────────────────────────────────────────────────────
 *
 * `h` is the 16:9 master, `s` the 1:1 cut, `v` the 9:16 cut. Each is its own
 * browser run, because a tighter frame is re-recorded rather than cropped or
 * zoomed (bible 5.3). Where a pass names the same viewport as another, the
 * storyboard says `reusesPass` and the frames are copied instead of shot
 * again: the tall panel needs no square pass, so we do not shoot one.
 *
 * ── the grant, and why the tool row is pressed rather than the toolbar ────
 *
 * Chrome only lets an extension capture a tab the user has just invoked it on,
 * and a harness cannot click a toolbar icon. `tools/recording.mjs` found the
 * way through: a keyboard command bound in the manifest is also an invocation,
 * and `Input.dispatchKeyEvent` on a tab's own CDP session reaches Chrome's
 * accelerator handling rather than only the renderer. `pressRecordShortcut()`
 * below is that trick, unchanged, so the commercial's Record beat is filmed
 * with a genuine `activeTab` grant and nothing is stubbed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from '../../lib-launch.mjs';
import { freshWorker, purgeWorkerCache } from '../../lib-fresh.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from '../../lib-granted.mjs';
import { REPO, FILM_CAPTURE } from '../../lib-paths.mjs';
import { startFixture } from './fixture.mjs';
import { assertShot, READ_STATE, READ_DURING, checkDuring, denyList } from './safety.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/*
 * A storyboard's `clip` is relative to the film's working tree, `work/film/`
 * at the repository root (`tools/lib-paths.mjs`), not to `extension/tools/`.
 * This recorder was writing captures to `extension/tools/<clip>` — i.e.
 * `extension/tools/film/capture/...` — which is exactly the folder the move
 * documented in `lib-paths.mjs` (6 September 2026) was written to empty, and
 * which `compose/frames.mjs` no longer reads: it resolves the same `clip`
 * string against `work/`, over loopback, and fails "missing f00000.png" for
 * a capture written here instead. `record/manifest.mjs` already reads `clip`
 * the correct way (`path.join(REPO, 'work', clip)`); this is that fix applied
 * where the files are actually written.
 */
const clipDir = (clip) => path.join(REPO, 'work', clip);
/*
 * The shipping package with the site permission already granted.
 *
 * Since decision 8 of `research/56-decisions-2026-09-07.md`, `<all_urls>` is an
 * optional host permission and the popup's own Wake button asks for it; no
 * element exists for a harness to click that bubble. `tools/lib-granted.mjs`
 * is the standing fix — a copy of the shipping package with the permission
 * moved into the required list, which three other headed suites already use
 * (`tools/clickthrough.mjs`, `tools/diagnose.mjs`, `tools/recording.mjs`).
 * This recorder predates decision 8 and was never updated to use it: every
 * shot opened on a popup with no site access, which the storyboards' own
 * assertions (`inView` on a tool row that a no-access popup never draws) catch
 * as a missing control rather than as the real cause.
 */
const EXT = grantedExtension({ label: 'film' });
const STORYBOARDS = path.resolve(HERE, '..', 'storyboard');
/* Was `path.resolve(HERE, '..', 'capture')` — the same stale extension-local
   path as `clipDir()` above, for the same `marks.json` reader in
   `compose/frames.mjs` (`path.join(FILM_CAPTURE, id, 'marks.json')`). */
const CAPTURE = FILM_CAPTURE;
const FPS = 30;

const OVERVIEW = ['qa-wrap', 'record-a-session', 'the-tools', 'file-it', 'save-and-diagram', 'protect-the-data'];

/** The sixteen tool films of bible §10, in `popup.js` TOOLS order. */
const TOOL_FILMS = [
  'tool-photograph-the-page', 'tool-record-the-screen', 'tool-check-another-size', 'tool-mask-real-data',
  'tool-check-accessibility', 'tool-check-page-speed', 'tool-check-the-links', 'tool-measure-code-coverage',
  'tool-design-the-values', 'tool-try-nasty-values', 'tool-fill-the-form', 'tool-harvest-the-page',
  'tool-copy-a-locator', 'tool-draw-the-flow', 'tool-break-a-request', 'tool-stress-the-layout',
];

/**
 * The four category films of round 3, one per popup group.
 *
 * The ids are the live `GROUPS` in `popup/popup.js` — Capture, Check, Design
 * and Break — not the brief's Design/Execute/Analyse/Protect, which name
 * nothing in the product (research/65 §6 item 1, the director's ruling). They
 * are also the deep-link targets the Tutorials page uses, so they are ids
 * before they are file names and a rename is not free.
 */
const CATEGORY_FILMS = ['cat-capture', 'cat-check', 'cat-design', 'cat-break'];

const FILMS = [...OVERVIEW, ...CATEGORY_FILMS, ...TOOL_FILMS];

/*
 * Where each film's step file lives.
 *
 * Bible 7.5 names the commercial's step file `commercial.mjs` while the
 * manifest, and therefore the storyboard, calls the film `qa-wrap`; §10.4 puts
 * the tool films in their own directory. One map, stated once, rather than
 * renames that would put this file out of step with the bible.
 */
const stepFile = (id) => (id === 'qa-wrap' ? 'commercial' : id.startsWith('tool-') ? `tools/${id}` : id);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A ceiling on anything that can block for ever.
 *
 * `page.evaluate` has no timeout of its own: a renderer that stops answering
 * stops the whole run with no error, no frame and no clue, which is what
 * happened twice while this file was being written. Every await that talks to
 * a page goes through here, so a wedged page becomes a message naming the shot
 * and the phase.
 */
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not answer in ${ms} ms`)), ms); }),
  ]);
}

/* ── the throwaway profile ──────────────────────────────────────────────── */

/**
 * A profile per run, recycled afterwards.
 *
 * Never reused. The old pipeline filmed the wrong popup mode for a whole
 * release because the profile remembered `qaw-mode` from the previous run, and
 * a film that is wrong in a way nobody can see from the file name is the
 * expensive kind of wrong.
 */
const PROFILE_ROOT = process.env.UQA_FILM_PROFILES || path.join(os.tmpdir(), 'qa-wrap-film-profiles');

/* The colour scheme every surface is captured in. See `launch()`. */
const SCHEME = process.env.UQA_FILM_SCHEME === 'light' ? 'light' : 'dark';

function newProfile(tag) {
  fs.mkdirSync(PROFILE_ROOT, { recursive: true });
  const dir = path.join(PROFILE_ROOT, `${tag}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Deletions go to the recycle bin, never to nowhere. */
function recycle(dir) {
  if (!fs.existsSync(dir)) return 'gone already';
  const script = process.env.QAW_TRASH || '';
  if (fs.existsSync(script)) {
    try {
      execFileSync('python', [script, dir], { stdio: 'pipe', env: { ...process.env, PYTHONUTF8: '1' } });
      return 'recycled';
    } catch (err) {
      console.log(`      could not recycle ${dir}: ${String(err.message).split('\n')[0]}`);
    }
  }
  return 'left on disk';
}

/* ── frame plumbing ─────────────────────────────────────────────────────── */

/** The PNG's own dimensions, straight out of the IHDR chunk. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function expectSize(buf, viewport, dsf, where) {
  const got = pngSize(buf);
  const want = { w: viewport.w * dsf, h: viewport.h * dsf };
  if (!got) throw new Error(`${where}: that is not a PNG`);
  if (got.w !== want.w || got.h !== want.h) {
    throw new Error(`${where}: frame is ${got.w}x${got.h}, the placement needs ${want.w}x${want.h}. Nothing is ever scaled, so this stops here.`);
  }
  return got;
}

/**
 * Write one frame, sharing the bytes when the picture has not changed.
 *
 * Every frame index gets a real `f%05d.png`, so the sequence globs and reads
 * exactly as bible 7.1 describes it and Builder A never has to consult a map.
 * A frame identical to the one before it is hard-linked rather than copied,
 * which is invisible to every reader and is the difference between a gigabyte
 * and three across the set.
 */
function writeFrame(dir, index, buf, previous) {
  const name = `f${String(index).padStart(5, '0')}.png`;
  const full = path.join(dir, name);
  if (previous && previous.buf.equals(buf)) {
    try {
      fs.linkSync(previous.full, full);
      return { name, full: previous.full, buf, shared: true };
    } catch {
      /* A filesystem without hard links: copy, and lose only disk. */
    }
  }
  fs.writeFileSync(full, buf);
  return { name, full, buf, shared: false };
}

/* ── the browser ────────────────────────────────────────────────────────── */

async function launch(profile) {
  const opts = launchOptions(EXT, { width: 1500, height: 1000, headed: true });
  return chromium.launchPersistentContext(profile, {
    ...opts,
    deviceScaleFactor: 2,
    /* The product's own surfaces follow `prefers-color-scheme` (popup.css 29,
     * report.css 68, identity-tokens.css 98). The film's ground is Basalt, so
     * a light-theme capture is a white rectangle floating on near-black — the
     * exact "pasted screenshot" look the rejected cut had. `UQA_FILM_SCHEME`
     * (default `dark`) puts the extension in the theme the film is set in.
     * The fixture site has no dark stylesheet and stays light, which is true
     * to life: a dark tool over an ordinary page. */
    colorScheme: SCHEME,
    viewport: { width: 1080, height: 720 },
    args: [
      ...opts.args,
      /* Bible 5.1 rule 5. A scrollbar in shot is a failed frame, and a colour
         profile that is not sRGB makes the ground a different grey than the
         composition's. */
      '--hide-scrollbars',
      '--force-color-profile=srgb',
    ],
  });
}

/**
 * The manifest's own shortcut, pressed the way Chrome counts as an invocation.
 *
 * Lifted from `tools/recording.mjs`, where it is the difference between a real
 * clip and a refusal. `bringToFront` is a tab activation inside our own window,
 * not an OS focus change.
 */
async function pressRecordShortcut(ctx, target) {
  const cdp = await ctx.newCDPSession(target);
  await target.bringToFront();
  for (const type of ['rawKeyDown', 'keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type, key: 'V', code: 'KeyV',
      windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86,
      modifiers: 1 + 8,
    });
  }
  await cdp.detach().catch(() => {});
}

/* ── the filmstrip: the virtual clock, made of screenshots ──────────────── */

function filmstrip(targets, totalFrames, guard = null, dry = false) {
  const strips = targets.map(() => []);
  const complaints = [];
  let firstReceiptFully = -1;
  let n = 0;
  const shoot = async () => {
    /*
     * A dry strip advances the clock and takes no pictures.
     *
     * Used by `--only`, where the earlier shots are run for the product state
     * they leave behind and not for their frames, which are already on disk and
     * already accepted. It keeps a take's own timing intact, because a take is
     * written against `t.until()` and `t.frame()` and not against wall time.
     */
    if (!dry) {
      for (let i = 0; i < targets.length; i++) {
        strips[i].push(await targets[i].page.screenshot({ animations: 'disabled', scale: 'device', caret: 'hide' }));
      }
    }
    if (guard) {
      const reading = await guard.page.evaluate(READ_DURING).catch(() => null);
      if (reading) {
        /* Kept so a report can name the frame something first became true,
           rather than only the frames where something was wrong. */
        if (reading.receiptFully && firstReceiptFully < 0) firstReceiptFully = n;
        const bad = checkDuring(guard.rules, reading, n);
        if (bad) complaints.push(bad);
      }
    }
    n++;
  };
  return {
    strips,
    complaints,
    get firstReceiptFully() { return firstReceiptFully; },
    get frames() { return n; },
    at: () => n / FPS,
    /** One more frame, unless the shot is already as long as it was written. */
    async frame() {
      if (n >= totalFrames) return false;
      await shoot();
      return true;
    },
    /** Film time runs on to `sec`, or to the end of the shot. */
    async until(sec) {
      while (n / FPS < sec) if (!(await this.frame())) return;
    },
    /** Whatever is left of the shot, held on what is on screen now. */
    async fill() {
      while (await this.frame());
    },
  };
}

/* ── the harness handed to a step file ──────────────────────────────────── */

function makeHarness(ctx, pages, fixture, extensionId, marks, clock, ensure) {
  const t = {
    ctx,
    fixture,
    origin: fixture.origin,
    extensionId,
    panel: pages.panel,
    stage: pages.stage,
    /* Getters, not a snapshot: these three pages do not exist until a shot
       asks for one, and a step file reads `t.report` straight after the
       `openReport()` that made it. */
    get report() { return pages.report; },
    get diagram() { return pages.diagram; },
    get sheet() { return pages.sheet; },
    /* `api/api.html`, the REQUEST rect. Research/65 §6 item 6 called this a
       phase-2 blocker: the rect was declared and nothing here could open the
       surface it names. `openRequest()` below is that step. */
    get request() { return pages.request; },

    /** Seconds into the take that is filming now. Zero outside a take. */
    at: () => (clock.strip ? clock.strip.at() : 0),
    /** Film time runs on to `sec`. Outside a take, real time does instead. */
    until: (sec) => (clock.strip ? clock.strip.until(sec) : wait(sec * 1000)),
    /** Hold what is on screen for `sec` more of film. */
    hold: (sec) => (clock.strip ? clock.strip.until(clock.strip.at() + sec) : wait(sec * 1000)),
    /**
     * One frame, now.
     *
     * A step file uses this when it is driving the picture itself, a few
     * pixels or one control at a time: scroll a little, take a frame, scroll a
     * little. Answers false once the shot is as long as it was written, so a
     * loop stops instead of overrunning. Outside a take it is a no-op.
     */
    frame: () => (clock.strip ? clock.strip.frame() : Promise.resolve(false)),
    /**
     * Real time, which a take does not spend.
     *
     * Used where the product needs a moment and the film does not: a settle
     * after a reload, the two seconds an accessibility scan takes. Inside a
     * take it costs no frames, so a shot never loses its length to a wait.
     */
    wait,

    /**
     * A press, recorded.
     *
     * The pointer travels first, over a few frames, so the row it is over has
     * its hover state in the picture before the press lands. There is no
     * cursor in the frame; the ring is the composition's job, which is why the
     * real time and place go into `marks.json`.
     */
    async click(page, sel, { failure = false, approachFrames = 3 } = {}) {
      const box = await page.evaluate(async (q) => {
        const el = document.querySelector(q);
        if (!el) return null;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, sel);
      if (!box) throw new Error(`the film wanted ${sel}; the product has no such control`);
      await page.mouse.move(box.x, box.y, { steps: 8 });
      if (clock.strip) for (let i = 0; i < approachFrames; i++) await clock.strip.frame();
      const at = t.at();
      await page.mouse.click(box.x, box.y);
      marks.clicks.push({
        atSec: Math.round(at * 1000) / 1000,
        frame: Math.round(at * FPS),
        x: Math.round(box.x), y: Math.round(box.y),
        target: sel, failure,
      });
      await wait(120);
    },

    async type(page, sel, text, delay = 25) {
      await t.click(page, sel);
      /* Typed a few characters at a time with a frame between, so the film
         sees the field fill rather than jump from empty to full. */
      const chunk = Math.max(1, Math.ceil(text.length / 12));
      for (let i = 0; i < text.length; i += chunk) {
        await page.keyboard.type(text.slice(i, i + chunk), { delay });
        if (clock.strip) await clock.strip.frame();
      }
    },

    async fillForm(page) {
      const a = fixture.application;
      await page.fill('#applicant', a.applicant);
      await page.fill('#email', a.email);
      await page.fill('#quantity', a.quantity);
      await page.selectOption('#country', a.country).catch(() => {});
      await wait(150);
    },

    /** Everything through the popup, the way the popup does it. */
    send: (msg) => pages.panel.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), msg),

    sessionId: async () =>
      (await pages.panel.evaluate(() => new Promise((r) => chrome.storage.session.get(['activeSessionId', 'lastSessionId'], (v) => r(v.activeSessionId || v.lastSessionId || null))))) || null,

    async panelReady() {
      await pages.panel.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 25000 });
    },

    /**
     * A no-op since UI round 2 (S6): Simple/Expert is gone and every tool is on
     * the rail, so the 17 shot scripts that still call `t.setMode('expert')`
     * need no edit. The group headings they open on are kept.
     */
    async setMode() {},

    async openReport(tab) {
      await ensure('report');
      let sid = await t.sessionId();
      if (!sid) throw new Error('there is no session to report on');
      const load = async (id) => {
        await pages.report.goto(`chrome-extension://${extensionId}/report/report.html?session=${id}`);
        return pages.report
          .waitForFunction(() => {
            const h = document.getElementById('hero-title')?.textContent?.trim();
            return !!h && h !== 'Loading…';
          }, undefined, { timeout: 12000 })
          .then(() => true)
          .catch(() => false);
      };
      if (!(await load(sid))) {
        /* A session that is still running does not always have enough written
           to render. Stopping it is what a tester does before reading the
           report anyway, so the fallback is the real path, not a trick. */
        await t.send({ type: 'UQA_STOP' }).catch(() => {});
        await wait(1500);
        sid = (await t.sessionId()) || sid;
        if (!(await load(sid))) throw new Error('the report would not render for this session');
      }
      if (tab) {
        await pages.report.locator(`.tab[data-tab="${tab}"]`).click();
        await wait(900);
      }
      await wait(400);
    },

    /**
     * The report with no session behind it.
     *
     * Bible rev 3 shot 3: the empty state, which is the only picture in the
     * product that honestly says there is no evidence yet. It is reachable
     * only by opening the report without a session id, and only truthful
     * before anything has started one.
     */
    async openReportEmpty() {
      await ensure('report');
      await pages.report.goto(`chrome-extension://${extensionId}/report/report.html`);
      await pages.report.waitForFunction(
        () => /no sessions recorded yet/i.test(document.body.innerText || ''), undefined,
        { timeout: 15000 }
      );
      await wait(500);
    },

    async openDiagram() {
      await ensure('diagram');
      const sid = await t.sessionId();
      await pages.diagram.goto(`chrome-extension://${extensionId}/diagram/diagram.html?session=${sid}`);
      await pages.diagram.waitForFunction(() => document.querySelectorAll('#sheet [data-node]').length > 0, undefined, { timeout: 25000 });
      await wait(700);
    },

    /**
     * `api/api.html`, opened the way the popup's own Send a request opens it,
     * with the panel's worked example already written into the boxes.
     *
     * The REQUEST rect was declared in the round-3 storyboards and nothing
     * could reach it (research/65 §6 item 6). Two things are needed for the
     * frame to be honest rather than empty: the session id, so "Import from
     * the session" has the traffic this run actually watched to offer, and the
     * request itself filled in — the primer's own example, `POST
     * /api/applications` against the fixture, which is the endpoint the
     * session really called and really got a 500 from. The primer card is
     * dismissed with the product's own "Got it" so the shot frames the method,
     * the URL, the headers, the body and the environment list rather than an
     * introduction to them.
     */
    async openRequest({ fill = true, hidePrimer = true } = {}) {
      await ensure('request');
      const sid = await t.sessionId();
      await pages.request.goto(
        `chrome-extension://${extensionId}/api/api.html${sid ? `?session=${encodeURIComponent(sid)}` : ''}`
      );
      await pages.request.waitForSelector('#compose', { timeout: 20000 });
      if (hidePrimer) {
        await pages.request.locator('#primer-hide').click().catch(() => {});
        await wait(300);
      }
      if (fill) {
        await pages.request.selectOption('#method', 'POST').catch(() => {});
        await pages.request.fill('#url', `${fixture.origin}/api/applications`).catch(() => {});
        /* One header, written into the row the product makes for it. The rows
           are built in script (`api/api.js` `headerRow()`), so the film presses
           "Add a header" rather than inventing markup. */
        await pages.request.locator('#add-header').click().catch(() => {});
        const row = pages.request.locator('#headers .row').last();
        await row.locator('input').nth(0).fill('Content-Type').catch(() => {});
        await row.locator('input').nth(1).fill('application/json').catch(() => {});
        await pages.request
          .fill('#body', `{
  "applicant": "${fixture.application.applicant}",
  "quantity": ${fixture.application.quantity}
}`)
          .catch(() => {});
      }
      await wait(500);
    },

    /**
     * The A4 workflow, exported and served back from the fixture.
     *
     * Rendering the product's own vector at frame size is not scaling a
     * capture (bible 2.2, the permitted exception). It is served over loopback
     * rather than from a `data:` URL so the origin assertion still means
     * something on that shot.
     */
    async renderSheet() {
      await ensure('sheet');
      const sid = await t.sessionId();
      const out = await t.send({ type: 'UQA_EXPORT', sessionId: sid, format: 'flow-svg' });
      if (!out?.ok) throw new Error(`the flow could not be exported: ${out?.error}`);
      const svg = String(out.result.content);
      /*
       * The label fault, refused at the source.
       *
       * `core/flow.js` used to name a container by concatenating everything
       * inside it, which put "PermitsportalHelpStatusDownloads" on the sheet.
       * That is fixed, and this is the assertion that keeps it fixed: the
       * export is checked before it is ever served, so a stale or regressed
       * sheet stops the run instead of reaching a frame.
       */
      const run = /[A-Za-z]{25,}/.exec(svg.replace(/<[^>]*>/g, ' '));
      if (run) throw new Error(`the exported sheet carries a concatenated label: "${run[0].slice(0, 40)}"`);
      fixture.setSheet(svg);
      /* A fresh URL every time, so nothing between here and the frame can
         serve the previous export. */
      await pages.sheet.goto(`${fixture.origin}/sheet?v=${Date.now()}`);
      await pages.sheet.waitForSelector('svg', { timeout: 10000 });
      await wait(500);
    },

    pressRecordShortcut: (page) => pressRecordShortcut(ctx, page),

    /**
     * Put a named control where the frame can see it.
     *
     * Scrolling by a pixel count lands wherever the page happens to be long
     * that day, and a shot that missed by a hundred pixels costs a whole take.
     * Asking for the element by name makes the frame the same every run.
     */
    async reveal(page, sel, block = 'center') {
      await page.evaluate(({ q, b }) => document.querySelector(q)?.scrollIntoView({ block: b, behavior: 'instant' }), { q: sel, b: block });
      await wait(400);
    },

    /**
     * Clear a toast left over from the step before.
     *
     * Bible 5.4: a product toast from a previous step must not be in shot. The
     * popup writes its own status line and nothing dismisses it on a timer, so
     * the harness empties the node between shots. `tools/clickthrough.mjs`
     * does the same before each tool press, and it touches only the element
     * whose whole job is to be transient.
     */
    async clearStatus() {
      await pages.panel.evaluate(() => {
        const s = document.getElementById('status');
        if (s) s.textContent = '';
      }).catch(() => {});
      await wait(150);
    },

    /** Arm the masking picker from the panel, the way a tester does. */
    async armMask() {
      /* The panel has to be the front page for the press to land: after a size
         run (cat-capture shot 14) the stage was brought forward, and the press
         on a background page set no status at all. */
      await pages.panel.bringToFront();
      /*
       * Pressed with the mouse, at the row's own box, and not through
       * `locator.click()`: off camera this is the same press `protect-the-data`
       * makes on camera, and the locator form set no status at all once the
       * tool wall had been re-drawn by a size run. No mark is recorded — this
       * is setup, and a ring here would be drawn on a frame nobody pressed.
       */
      /*
       * An open tool panel eats the first press.
       *
       * `setToolPanel()` closes an open panel "on an outside press", and a
       * press on another tool row is an outside press: the click closes the
       * panel and never reaches the row, which is why the mask row answered
       * with no status at all after the size run left the Window sizes panel
       * open (cat-capture shot 15).
       */
      if (await pages.panel.$('[aria-expanded="true"]')) {
        await pages.panel.keyboard.press('Escape');
        await wait(200);
        if (await pages.panel.$('[aria-expanded="true"]')) {
          await pages.panel.mouse.click(4, 4);
          await wait(250);
        }
      }
      const box = await pages.panel.evaluate(() => {
        const el = document.querySelector('[data-action="mask"]');
        if (!el) return null;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (!box) throw new Error('the film wanted the mask row; the popup has no such control');
      await pages.panel.mouse.move(box.x, box.y, { steps: 6 });
      await pages.panel.mouse.click(box.x, box.y);
      /*
       * The press is not the arming.
       *
       * `ACTIONS.mask` in `popup/popup.js` writes "Starting the masking
       * crosshair…" optimistically and only sets `aria-pressed` when the
       * worker's answer lands; the content script raises `uqa-masking` on the
       * page at the same moment. A fixed 500 ms was long enough on a quiet
       * machine and not on a busy one, and the shot that clicked the page
       * next then covered nothing at all — the fault that stopped
       * `protect-the-data` shot 3 and `cat-capture` shot 19. Wait for the two
       * states the product actually reaches.
       */
      await pages.panel.waitForSelector('[data-action="mask"][aria-pressed="true"]', { timeout: 15000 }).catch(async (err) => {
        const seen = await pages.panel.evaluate(() => {
          const row = document.querySelector('[data-action="mask"]');
          return {
            status: document.getElementById('status')?.textContent || '',
            pressed: row?.getAttribute('aria-pressed'),
            disabled: row?.disabled ?? null,
            awake: document.body.dataset.awake,
            ready: document.body.dataset.ready,
            url: location.href,
          };
        }).catch(() => null);
        throw new Error(`${err.message} — panel ${JSON.stringify(seen)}`);
      });
      await pages.stage
        .waitForFunction(() => document.documentElement.classList.contains('uqa-masking'), undefined, { timeout: 10000 })
        .catch(() => {});
      await wait(300);
    },

    /**
     * Click a value on the page with the mouse, not by selector.
     *
     * The picker reads what is under the pointer, and its own highlight layer
     * sits over the element, so Playwright's actionability checks would wait
     * for ever. Move to the element's own box and click there, the way a hand
     * would; then Escape, which is what stops the picker.
     */
    async pickOnPage(page, sel) {
      const box = await page.evaluate((q) => {
        const el = document.querySelector(q);
        if (!el) return null;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, sel);
      if (!box) throw new Error(`the film wanted ${sel}; the page has no such element`);
      if (process.env.FILM_TRACE) {
        const before = await page.evaluate(() => ({
          masking: document.documentElement.classList.contains('uqa-masking'),
          masked: document.querySelectorAll('[data-uqa-masked]').length,
        }));
        const say = await pages.panel.evaluate(() => ({
          status: document.getElementById('status')?.textContent || '',
          pressed: document.querySelector('[data-action="mask"]')?.getAttribute('aria-pressed'),
        })).catch(() => null);
        process.stdout.write(`
        [pick] ${sel} before ${JSON.stringify(before)} panel ${JSON.stringify(say)}
`);
      }
      await page.bringToFront();
      await page.mouse.move(box.x, box.y, { steps: 8 });
      if (clock.strip) await clock.strip.frame();
      const at = t.at();
      await page.mouse.click(box.x, box.y);
      marks.clicks.push({
        atSec: Math.round(at * 1000) / 1000, frame: Math.round(at * FPS),
        x: Math.round(box.x), y: Math.round(box.y), target: sel, failure: false, picker: true,
      });
      await wait(450);
      if (process.env.FILM_TRACE) {
        const after = await page.evaluate(() => ({
          masking: document.documentElement.classList.contains('uqa-masking'),
          masked: document.querySelectorAll('[data-uqa-masked]').length,
        }));
        process.stdout.write(`
        [pick] ${sel} after ${JSON.stringify(after)}
`);
      }
      await page.keyboard.press('Escape');
      await wait(250);
    },

    /** A short session driven off camera, for the films that open on a report. */
    async recordShortSession() {
      /* Temporary tracing (FILM_TRACE): this prelude is unbounded, so when a
         wait inside it never settles the run looks like a hang with no line. */
      const tr = (m) => { if (process.env.FILM_TRACE) process.stdout.write(`
        [prelude] ${m}
`); };
      tr('start');
      fixture.fail();
      tr('stage goto');
      await pages.stage.goto(fixture.origin, { waitUntil: 'domcontentloaded' });
      tr('panel ready');
      await t.panelReady();
      if ((await pages.panel.evaluate(() => document.body.dataset.awake)) !== 'true') {
        await pages.panel.click('#switch');
        await pages.panel.waitForFunction(() => document.body.dataset.awake === 'true', undefined, { timeout: 10000 });
      }
      tr('charter fill');
      await pages.panel.fill('#charter', 'Food import permit, submit path');
      tr('start click');
      await pages.panel.click('#start');
      await pages.panel.waitForFunction(() => !document.getElementById('step-live').hidden, undefined, { timeout: 12000 });
      tr('fill form');
      await t.fillForm(pages.stage);
      tr('submit');
      await pages.stage.click('#submit');
      tr('note wait');
      await pages.stage.waitForFunction(() => /went wrong/.test(document.getElementById('note').textContent), undefined, { timeout: 6000 }).catch(() => {});
      tr('a11y');
      await pages.panel.locator('[data-action="a11y"]').click().catch(() => {});
      await wait(3000);
      tr('clear status');
      await t.clearStatus();
    },
  };
  return t;
}

/* ── one film, one pass ─────────────────────────────────────────────────── */

async function capturePass(board, script, pass, report, only = null) {
  const id = board.id;
  const todo = board.shots.filter((s) => s.capture && s.capture.passes[pass] && !s.capture.reusesPass?.[pass]);
  if (!todo.length) return;

  const profile = newProfile(`${id}-${pass}`);
  const fixture = await startFixture();
  purgeWorkerCache(profile);
  const ctx = await launch(profile);
  /* Pin the theme, do not merely ask for it.
   *
   * `colorScheme` on the context only decides what `prefers-color-scheme`
   * answers, and `ui/theme.js` consults that ONLY when `localStorage`
   * `qaw-theme` is unset. A run that ends up with an explicit 'light' in the
   * profile therefore films a light surface inside a dark-scheme context, and
   * it did: the 17 September v5 pass came back with a dark popup and a light
   * report in the same film. Writing the key before any page script runs
   * removes the race and the ambiguity together. */
  await ctx.addInitScript((mode) => {
    try { localStorage.setItem('qaw-theme', mode); } catch { /* opaque origin */ }
  }, SCHEME);

  const errors = [];
  const watch = (target, label) => {
    target.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
    target.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  };

  /*
   * A ceiling on every wait.
   *
   * Without it a suspended MV3 service worker can leave an `evaluate` pending
   * for ever and the run simply stops, with no error and no frame: that is
   * exactly what happened once here, and ten minutes of a blocked process
   * looks identical to ten minutes of slow work. A timeout turns it into a
   * message.
   */
  ctx.setDefaultTimeout(45000);
  const step = (m) => process.stdout.write(`      ${m}
`);

  try {
    step('waiting for the extension service worker');
    const worker = await freshWorker(ctx);
    const extensionId = new URL(worker.url()).host;
    step(`extension ${extensionId}`);

    /*
     * The first-run notice, answered the way "I understand" answers it, and
     * the page scripts awaited before anything navigates.
     *
     * Both are the granted copy's other half (`tools/lib-granted.mjs`): the
     * manifest line alone gets `chrome.permissions.getAll()` to answer
     * `['<all_urls>']`, but `background/site-access.js` still registers the
     * content scripts from that asynchronously, and the popup's own consent
     * gate (`popup.css` `body[data-consented='false']`) hides the wake switch,
     * the mode switch and the whole tool wall until `UQA_CONSENT_ACCEPT` has
     * run. Skipping either turns every shot into "the film wanted
     * `.tool-row[data-tool="..."]`; the product has no such control" — a
     * missing-selector error that is actually a missing grant.
     */
    await seedConsent(worker);
    await awaitSiteScripts(worker);
    step('consent seeded, site scripts registered');

    const panel = ctx.pages()[0] || (await ctx.newPage());
    watch(panel, 'panel');
    /* The theme, stamped before the first paint the camera sees.
     *
     * This line used to read `'light'`, for bible 2.1: a night capture on a
     * Basalt ground has no edge. It is also the real reason the report came
     * out light through three passes of the 17 September rebuild while the
     * context asked for dark — it is written after `addInitScript` and wins.
     * Nader's ruling that the product is filmed in its dark theme outranks
     * 2.1, and the surfaces carry their own border against the ground, so it
     * now follows `UQA_FILM_SCHEME` instead of deciding on its own.
     * research/78 §8. */
    await panel.goto(`chrome-extension://${extensionId}/popup/popup.html?surface=panel`);
    await panel.evaluate((scheme) => {
      try {
        localStorage.setItem('qaw-theme', scheme);
        /*
         * The first-run card, dismissed the way a tester dismisses it.
         *
         * A throwaway profile is always a first run, so the popup opens with
         * "First time here? 6 short films..." across the top third of the
         * frame. Filming that would put an advert for these films inside these
         * films, and it pushes the switch and the charter down out of the
         * panel. `qaw-tutorial-seen` is exactly what the card's own "Not now"
         * button writes (popup.js `put()`), so this is the product's own state,
         * set before the first paint rather than clicked after it.
         */
        localStorage.setItem('qaw-tutorial-seen', '1');
      } catch { /* no storage */ }
    }, SCHEME);
    await panel.reload();
    await panel.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 25000 });
    step(`panel booted, ${SCHEME} theme, first-run card dismissed`);

    const stage = await ctx.newPage();
    watch(stage, 'stage');
    await stage.goto(fixture.origin, { waitUntil: 'domcontentloaded' });

    /*
     * The report, the diagram and the sheet are opened when a shot needs them.
     *
     * They used to be opened at boot, which meant a session started on camera
     * was recording five tabs instead of two. The extension's whole job is to
     * watch every tab in the window, so three idle tabs are not free: the Start
     * beat slowed to a crawl and once took the browser down with it. Opening
     * them late costs a second in the setup of the shots that use them, which
     * is off camera, and takes the recorded surface back down to the two tabs
     * the film is actually about.
     */
    const pages = { panel, stage, report: null, diagram: null, sheet: null, request: null };
    const ensure = async (key) => {
      if (!pages[key] || pages[key].isClosed()) {
        pages[key] = await ctx.newPage();
        watch(pages[key], key);
      }
      return pages[key];
    };
    step('pages open');
    const marks = { clicks: [] };
    const clock = { strip: null };
    const t = makeHarness(ctx, pages, fixture, extensionId, marks, clock, ensure);
    const deny = denyList();

    if (script.prelude) {
      process.stdout.write('      prelude, off camera... ');
      await script.prelude(t);
      console.log('done');
    }

    const filmMarks = {};

    for (const shot of board.shots) {
      const spec = shot.capture;
      if (!spec) continue;
      const passSpec = spec.passes[pass];
      if (!passSpec || spec.reusesPass?.[pass]) continue;

      const step = script.shots[shot.n];
      if (!step) throw new Error(`${id} shot ${shot.n} has a capture but no step`);
      /* `--only`: earlier shots still run, for the state they leave behind. */
      const filming = !only || only.includes(shot.n);

      /* Which page or pages this shot is looking at, and at what size. */
      const targets = [];
      if (passSpec.parts) {
        for (const part of passSpec.parts) {
          targets.push({ page: part.role === 'panel' ? panel : stage, viewport: part.viewport, clip: part.clip, role: part.role, place: part.place });
        }
      } else if (passSpec.pairImpossible) {
        targets.push({ page: spec.member === 'PANEL' ? panel : stage, viewport: passSpec.viewport, clip: passSpec.clip, role: spec.member.toLowerCase(), place: null });
      } else {
        const key = { PANEL: 'panel', WALL: 'panel', STAGE: 'stage', REPORT: 'report', DIAGRAM: 'diagram', SHEET: 'sheet', REQUEST: 'request' }[spec.rect];
        const page = await ensure(key);
        targets.push({ page, viewport: passSpec.viewport, clip: passSpec.clip, role: null, place: passSpec.place });
      }
      for (const target of targets) await target.page.setViewportSize({ width: target.viewport.w, height: target.viewport.h });

      /*
       * Which half of a pair the shot is about.
       *
       * A pair films two pages; only one of them is the subject. Shot 11 of
       * the commercial is about a mask on the permits page, and asserting it
       * against the panel found nothing masked and stopped a good take. The
       * storyboard names the member, so the assertions follow it.
       */
      const subject =
        targets.find((x) => x.role === String(spec.member || '').toLowerCase()) || targets[0];

      /* Off camera: everything that gets the product into the state this shot
         opens on. Bible 5.2 calls this the order of operations. None of it is
         in the film, which is why a report beat costs no seconds. */
      marks.clicks = [];
      clock.strip = null;
      const phase = (m) => process.stdout.write(`        shot ${String(shot.n).padStart(2)} ${m}\n`);
      if (step.setup) await withTimeout(step.setup(t), 180000, `${id} shot ${shot.n} setup`);
      await wait(250);
      for (const target of targets) {
        await withTimeout(
          target.page.evaluate(() => document.fonts.ready.then(() => true)),
          20000, `${id} shot ${shot.n} fonts on the ${target.role || spec.rect} page`
        ).catch(() => {});
      }
      phase('ready');

      /* The leftover check of bible 5.4, before a single frame is written. */
      const states = [];
      for (const target of targets) {
        const state = await withTimeout(target.page.evaluate(READ_STATE), 30000, `${id} shot ${shot.n} state read`);
        states.push(state);
        await assertShot({
          page: target.page,
          shot: { film: id, n: shot.n, assert: target === subject ? spec.assertBefore || [] : [] },
          state, port: fixture.port, extensionId, deny,
        });
      }
      phase('opening state clean');

      /* The take. */
      const total = shot.frames;
      let strip = null;
      if (spec.still) {
        if (step.take) await withTimeout(step.take(t), 120000, `${id} shot ${shot.n} take`);
        await wait(250);
      } else {
        strip = filmstrip(
          targets, total,
          filming && (spec.assertDuring || []).length ? { page: subject.page, rules: spec.assertDuring } : null,
          !filming
        );
        clock.strip = strip;
        /*
         * The ceiling scales with the shot.
         *
         * A flat three minutes was written when a shot was sixty frames.
         * Revision 3 holds nothing under four seconds and its longest take is
         * a hundred and fifty frames, each one a screenshot, so a good take
         * was being cut off for taking the time it honestly needs. Three
         * seconds a frame is far more than any frame has ever cost and still
         * catches a wedge.
         */
        if (step.take) await withTimeout(step.take(t), Math.max(180000, total * 3000), `${id} shot ${shot.n} take`);
        phase(`take done at frame ${strip.frames} of ${total}`);
        await withTimeout(strip.fill(), Math.max(180000, total * 3000), `${id} shot ${shot.n} hold to ${total} frames`);
        clock.strip = null;
      }
      phase('filmed');

      /*
       * Anything the take carried that the shot forbids.
       *
       * The during-rules were checked frame by frame while the take ran; this
       * is where their verdict lands, before the frames are written, so a shot
       * that scrolled a health note through the middle of itself fails instead
       * of passing on a clean closing state.
       */
      if (strip?.complaints?.length) {
        throw new Error(
          `${id} shot ${shot.n}: ${strip.complaints.length} frame(s) carried something the shot forbids. ` +
            strip.complaints.slice(0, 3).join('; ')
        );
      }

      /*
       * A moment for the product to settle before it is judged.
       *
       * Several surfaces rebuild a block after the change that caused it: tick
       * an evidence box and the list is re-rendered a beat later, at a new
       * position. Reading the closing state on the same tick as the last press
       * therefore judged a page that was still moving, and cost two whole
       * passes. Real time, so it costs the film nothing.
       */
      await wait(700);

      /* And again after the take: the state a frame was written in is the one
         that must be clean, and this is where the shot's own assertions run,
         because every one of them describes what the shot ends up showing. */
      for (const target of filming ? targets : []) {
        const state = await withTimeout(target.page.evaluate(READ_STATE), 30000, `${id} shot ${shot.n} closing state read`);
        states.push(state);
        await assertShot({
          page: target.page,
          shot: { film: id, n: shot.n, assert: target === subject ? spec.assert || [] : [] },
          state, port: fixture.port, extensionId, deny,
          /* The opening reading of the same page, so a scroll assertion has
             something to measure the movement against. */
          opening: states[targets.indexOf(target)],
        });
      }
      phase('closing state clean');

      if (!filming) {
        console.log(`      shot ${String(shot.n).padStart(2)}  ${String(spec.rect).padEnd(7)} run for state only, frames left as they are`);
        continue;
      }

      /* Write. */
      const written = [];
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const dir = clipDir(target.clip);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });

        const buffers = spec.still
          ? [await withTimeout(target.page.screenshot({ animations: 'disabled', scale: 'device', caret: 'hide' }), 60000, `${id} shot ${shot.n} held frame`)]
          : strip.strips[i];
        expectSize(buffers[0], target.viewport, 2, `${id} shot ${shot.n} pass ${pass}`);

        const files = [];
        let previous = null;
        let shared = 0;
        buffers.forEach((buf, k) => {
          previous = writeFrame(dir, k, buf, previous);
          if (previous.shared) shared++;
          files.push(path.posix.join(target.clip, previous.name));
        });

        fs.writeFileSync(
          path.join(dir, 'shot.json'),
          JSON.stringify({
            _readme:
              'One shot of one pass. `still` means f00000.png stands for every one of `frames` frames; otherwise there is one PNG per frame, f00000.png upward, already on the film 30 fps grid. A frame identical to the one before it is a hard link, so every index still has a real file. `states` are the page readings safety.mjs scanned before and after the take.',
            film: id, n: shot.n, pass, role: target.role, rect: spec.rect,
            still: !!spec.still, frames: total, files: files.length, sharedFrames: shared,
            inFrame: shot.inFrame, outFrame: shot.outFrame,
            viewport: target.viewport, dsf: 2, pixels: { w: target.viewport.w * 2, h: target.viewport.h * 2 },
            place: target.place || null,
            port: fixture.port, extensionId,
            clicks: marks.clicks,
            firstReceiptFullyAtFrame: strip?.firstReceiptFully ?? null,
            fileList: files, states,
          }, null, 2) + '\n',
          'utf8'
        );
        written.push(`${files.length} png${shared ? ` (${shared} shared)` : ''}`);
        report.pngs += files.length;
        report.frames += total;
      }

      filmMarks[shot.n] = { clicks: marks.clicks, inFrame: shot.inFrame, seconds: shot.outSec - shot.inSec };
      report.shots++;
      console.log(
        `      shot ${String(shot.n).padStart(2)}  ${String(spec.rect).padEnd(7)} ` +
          `${spec.still ? 'held  ' : 'moving'} ${total} fr  ${written.join(' + ')}`
      );
    }

    /* The click times, for the composition's rings. */
    const marksPath = path.join(CAPTURE, id, 'marks.json');
    fs.mkdirSync(path.dirname(marksPath), { recursive: true });
    const existing = fs.existsSync(marksPath) ? JSON.parse(fs.readFileSync(marksPath, 'utf8')) : { id, byPass: {} };
    existing._readme =
      'Where a press really happened, so the composition can put its ring on the frame it happened on rather than on the frame it was written for. `frame` is relative to the shot; add the shot inFrame for the film own numbering.';
    existing.byPass[pass] = filmMarks;
    if (pass === 'h') existing.shots = filmMarks;
    fs.writeFileSync(marksPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');

    if (errors.length) {
      const unique = [...new Set(errors)];
      console.log(`      ${errors.length} console error(s) reported, ${unique.length} distinct:`);
      for (const e of unique.slice(0, 8)) console.log(`        ${e.slice(0, 150)}`);
      report.consoleErrors.push(...unique);
    }
  } finally {
    /*
     * Teardown gets a ceiling too.
     *
     * `context.close()` on a browser that has half died never returns, and a
     * run that has already written all of its frames then sits there looking
     * like work. The frames are on disk by this point, so the worst a timeout
     * costs is an orphaned browser, which the next run does not care about.
     */
    await withTimeout(ctx.close(), 30000, 'closing the browser').catch(() => {});
    await withTimeout(fixture.close(), 5000, 'closing the fixture').catch(() => {});
    console.log(`      profile ${recycle(profile)}`);
  }
}

/** Passes that only borrow another pass's frames: copied, never re-shot. */
function copyReused(board, pass, report) {
  for (const shot of board.shots) {
    const spec = shot.capture;
    const from = spec?.reusesPass?.[pass];
    if (!from) continue;
    const src = clipDir(spec.passes[from].clip);
    const dst = clipDir(spec.passes[pass].clip);
    if (!fs.existsSync(src)) throw new Error(`${board.id} shot ${shot.n}: pass ${pass} borrows pass ${from}, which has not been recorded`);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
    const metaPath = path.join(dst, 'shot.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.pass = pass;
    meta.copiedFrom = from;
    meta.fileList = meta.fileList.map((f) => f.replace(spec.passes[from].clip, spec.passes[pass].clip));
    meta.place = spec.passes[pass].place || null;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    report.copied++;
    report.pngs += meta.files;
    report.frames += meta.frames;
    console.log(`      shot ${String(shot.n).padStart(2)}  ${String(spec.rect).padEnd(7)} copied from pass ${from}, same viewport, so no second take`);
  }
}

/* ── the run ────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const passArg = args.find((a) => a.startsWith('--pass'));
const batchArg = args.find((a) => a.startsWith('--batch'));
const onlyArg = args.find((a) => a.startsWith('--only'));
/*
 * `--only=18` re-records one shot without discarding the rest.
 *
 * Every earlier shot still runs, because a shot opens on the state the ones
 * before it left; they simply take no pictures, and their frames stay on disk
 * exactly as they were accepted.
 */
const only = onlyArg ? onlyArg.split('=')[1].split(',').map(Number) : null;
const wanted = args.filter((a) => !a.startsWith('--'));
const passes = passArg ? passArg.split('=')[1].split(',') : null;

/*
 * A batch is a named run order, not a different kind of run.
 *
 * Bible §10.4 groups the sixteen tool films by `popup.js` group so each batch
 * shares one fixture and one recorded session, and names the order inside it
 * (draw-the-flow last in Design, because the diagram wants the richest session
 * behind it). The order is the whole content of a batch file, so this reads it
 * rather than repeating it.
 */
let ids = wanted.length ? wanted : FILMS;
if (batchArg) {
  const name = batchArg.split('=')[1];
  const file = { b1: 'b1-capture', b2: 'b2-check', b3: 'b3-design', b4: 'b4-break' }[name];
  if (!file) throw new Error(`no batch called "${name}". One of: b1, b2, b3, b4`);
  const batch = (await import(`./batches/${file}.mjs`)).default;
  ids = batch.films;
  console.log(`batch ${batch.id} — ${batch.label}: ${ids.length} films, in order`);
}

for (const id of ids) {
  if (!FILMS.includes(id)) throw new Error(`no film called "${id}". One of: ${FILMS.join(', ')}`);
}

const report = { shots: 0, frames: 0, pngs: 0, copied: 0, consoleErrors: [], failures: [] };
const started = Date.now();

for (const id of ids) {
  const board = JSON.parse(fs.readFileSync(path.join(STORYBOARDS, `${id}.storyboard.json`), 'utf8'));
  const script = (await import(`./shots/${stepFile(id)}.mjs`)).default;
  const filmPasses = (passes || board.aspects).filter((p) => board.aspects.includes(p));

  console.log(`\n${id} — ${board.seconds}s, ${board.shots.length} shots, passes ${filmPasses.join(' ')}`);
  for (const pass of filmPasses) {
    console.log(`  pass ${pass} — ${board.canvas[pass].label}`);
    /*
     * One pass that fails does not take the other seventeen with it.
     *
     * A full set is six films and up to three passes each, and it runs for
     * hours. Stopping the lot because one shot's selector moved would mean
     * finding the next fault tomorrow instead of in the same run, so a failure
     * is recorded against its pass and the run carries on. Nothing is silently
     * accepted: every failure is listed again at the end and the process exits
     * non-zero.
     */
    /*
     * One retry, because a browser that dies is not a broken film.
     *
     * A headed Chrome with an extension loaded occasionally takes the whole
     * context down mid-take ("Target page, context or browser has been
     * closed"). That is a flake, not a fault in the shot, and the difference
     * between the two is whether it happens twice. A second attempt costs
     * fifteen minutes; discovering at the end that one pass of six is missing
     * costs the evening. Three attempts, not two, because on a machine already
     * carrying seventy-odd Chrome processes the browser has died twice in a
     * row, and a run that has to be started again by hand is the same cost as
     * one that never ran.
     */
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        if (attempt > 1) console.log('      the browser went away; one more attempt');
        await capturePass(board, script, pass, report, only);
        copyReused(board, pass, report);
        done = true;
      } catch (err) {
        const flake = /Target page, context or browser has been closed|browser has been closed|Target closed/i.test(err.message);
        if (flake && attempt < 3) continue;
        console.log(`      STOPPED — ${err.message}`);
        if (process.env.FILM_TRACE) console.log(err.stack);
        report.failures.push(`${id} pass ${pass}: ${err.message}`);
        break;
      }
    }
  }
}

const mins = ((Date.now() - started) / 60000).toFixed(1);
console.log(`\n${report.shots} shot(s) recorded, ${report.copied} copied, ${report.pngs} PNG(s) for ${report.frames} frame(s), in ${mins} min`);
if (report.consoleErrors.length) {
  console.log(`${report.consoleErrors.length} distinct console error(s) were reported above. They are reported, never counted as a result.`);
}
if (report.failures.length) {
  console.log(`
${report.failures.length} pass(es) did not finish:`);
  for (const f of report.failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log('Now run:  node tools/film/record/safety.mjs');
