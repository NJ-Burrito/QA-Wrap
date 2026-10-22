/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The locator picker, inside an iframe it is not allowed to look out of.
 *
 * Reported from the field: on `https://claude.ai/code/artifact/…` the page
 * under test lives in a cross-origin iframe, and the picker was unusable there
 * in three separate ways at once.
 *
 *   1. **Two crosshairs, two tooltips.** The script is injected with
 *      `allFrames: true`, so the top frame's picker was running as well, and
 *      its idea of "the element under the pointer" was the `<iframe>` itself.
 *      It offered `page.locator('#frame-content')` — the box, not the button
 *      inside it — and the tooltip stayed on screen, because a frame that has
 *      the pointer sends its parent no further mousemove to correct it.
 *   2. **A locator that does not run.** `window.frameElement` throws across an
 *      origin boundary, so the inner frame could only offer the element's own
 *      selector with "the frameLocator chain is incomplete" beside it.
 *   3. **Nothing on the clipboard.** The default Permissions-Policy is
 *      `clipboard-write=self`, so `navigator.clipboard.writeText` in the frame
 *      was refused outright, and the execCommand fallback in a frame with no
 *      gesture of its own is refused about as often as it is allowed. In the
 *      tester's words: "it couldn't copy any selector".
 *
 * None of the three can be shown against a stub. The origin boundary *is* the
 * bug, so this suite is a real browser with the real extension loaded, one
 * static server answering on two origins — `http://127.0.0.1:PORT` and
 * `http://localhost:PORT`, which the browser treats as different origins for
 * every purpose that matters here — and the mouse moved to real coordinates.
 * It is the same shape as `tools/test-exporters.mjs` and `tools/test-gif.mjs`,
 * which are also in `npm test` and also need a browser to be honest.
 *
 *   node tools/test-frames.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { TRASH } from './lib-trash.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker } from './lib-fresh.mjs';
import { seedConsent, grantedExtension } from './lib-granted.mjs';

// D-1010-02: the product's site gate stays as it is, so the suite loads the granted copy (the one manifest line a
// tester's grant changes) in a fresh per-run profile, tagged council-1010 and moved to the recycle bin on exit.
const EXT = grantedExtension({ label: 'frames' });
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-council-1010-frames-'));
const scratch = () => {
  for (const dir of [PROFILE, EXT]) {
    if (!fs.existsSync(dir)) continue;
    try { execFileSync('python', [TRASH, dir], { stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } }); }
    catch { failures.push(`recycle ${dir}`); console.log(`  FAIL  could not recycle ${dir} (D-1010-118: a leftover profile is a suite failure)`); }
  }
};

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    const detail = await fn();
    passed++;
    console.log(`  ok  ${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail).slice(0, 160)}`}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

/* ── the pages ───────────────────────────────────────────────────────────
   One server, reached under two names. `127.0.0.1` and `localhost` resolve to
   the same socket and are different origins to the browser, which is the whole
   fixture: no second port, no certificate, no host file. */

/*
 * The page under test, and it is deliberately imperfect.
 *
 * Three findings, one for each scanner that used to read the wrong document:
 * an image with no alt text (axe: `image-alt`, critical), a link that goes
 * nowhere (the link check, and the fine print's dead-links row), and a footer
 * carrying a privacy policy link (the fine print's policy row, which reported
 * "no link on this page matches a privacy policy" for a page that had one).
 *
 * `<html>` keeps its `lang` so the fixture fails on the things it is about and
 * not on everything at once.
 */
const INNER = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>inner</title>
<style>body{margin:0;padding:40px;font:16px -apple-system,"Segoe UI",Tahoma,Arial,sans-serif}button{padding:12px 20px}</style></head>
<body><main><h1>Artifact</h1><button data-dc-tpl="420" type="button">Publish</button>
<img id="no-alt" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="20" height="20">
<a id="dead" href="#">All case studies</a>
<footer><a id="policy" href="/privacy-policy">Privacy policy</a></footer></main></body></html>`;

const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>outer</title>
<style>body{margin:0;padding:20px;font:16px -apple-system,"Segoe UI",Tahoma,Arial,sans-serif}iframe{width:600px;height:300px;border:1px solid #ccc}
button{padding:12px 20px}</style></head><body>${body}</body></html>`;

let LOCAL = '';
const ROUTES = () => ({
  // The top frame, with the application on the other origin inside it. The id
  // is the one from the report, so the expected locator below reads as the
  // tester's screen did.
  '/outer': page(`<button id="top-button" type="button">Top frame button</button>
    <iframe id="frame-content" src="${LOCAL}/inner"></iframe>`),
  '/inner': INNER,
  // The same document served on its own, so the "one frame reads exactly as it
  // always did" guard compares like with like.
  '/alone': INNER,
  // A real destination for the footer link, so the policy row can be DECLARED
  // rather than "linked but answered 404", which is a different finding.
  '/privacy-policy': page('<h1>Privacy policy</h1><p>What we collect.</p>'),
  // Two same-origin frames, one inside the other, to hold the case that always
  // worked to the same standard: it still has to produce the whole chain from
  // the frame's own walk, without asking the worker anything.
  // D-1010-163: the frame is made by a script and carries its document inline (about:srcdoc), so no URL ever matches it:
  // only matchOriginAsFallback lets the registered page scripts run there.
  '/srcdoc': page(`<button id="top-button" type="button">Top frame button</button>
    <script src="/made.js"></script>`),
  // A file, not an inline script: the fixture's policy is default-src 'self'.
  '/made.js': `const f = document.createElement('iframe'); f.id = 'made'; f.srcdoc = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>made</title></head><body style="margin:0;padding:30px"><button id="inside" type="button">Inside made frame</button></body></html>'; document.body.append(f);`,
  '/nested': page('<iframe id="shell" src="/nested-mid"></iframe>'),
  '/nested-mid': page('<iframe name="deep" src="/inner"></iframe>'),
});

const server = http.createServer((req, res) => {
  const at = new URL(req.url, 'http://x').pathname;
  // Answered rather than 404'd: this suite fails on any console error from any
  // context, and a missing favicon is one.
  if (at === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  const body = ROUTES()[at];
  if (body === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('no');
    return;
  }
  /*
   * The six headers decision 33 captures, on every page this server serves.
   *
   * Without them the fine print's header rows would answer "not measured",
   * which is the correct answer to an absent response and tells us nothing
   * about whether the capture works. Frame-ancestors is deliberately left out
   * of the policy so one row is a GAP and the difference between "absent" and
   * "not measured" is exercised as well.
   */
  res.writeHead(200, {
    'content-type': at.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
    // `frame-src *` because the fixture's whole point is a frame on another
    // origin, and `default-src 'self'` would have the policy block the very
    // thing under test.
    'content-security-policy': "default-src 'self' data:; frame-src *; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
    'strict-transport-security': 'max-age=31536000',
    'referrer-policy': 'strict-origin-when-cross-origin',
  });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;
LOCAL = `http://localhost:${PORT}`;

const context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT));
await keepOnTop(context); // test window stays above others; released on close
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });

const errors = [];
const watch = (target, label) => {
  target.on?.('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  target.on?.('console', (m) => {
    if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`);
  });
};

try {
  const worker = await freshWorker(context);
  watch(worker, 'worker');
  await seedConsent(worker); // T-042: a wake needs the accepted notice
  const id = new URL(worker.url()).host;

  const under = await context.newPage();
  watch(under, 'page');
  // On a real page before anything else is asked: a session starts against the
  // testable tab of the window, and a window whose only tab is `about:blank`
  // has none.
  await under.goto(`${ORIGIN}/outer`, { waitUntil: 'load' });

  const ctl = await context.newPage();
  watch(ctl, 'popup');
  await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
  await ctl.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 20000 });

  /** A message to the worker, from an extension page, the way every surface does it. */
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);

  const armed = await call({ type: 'UQA_ARM' });
  if (!armed?.ok) throw new Error(`the window would not wake: ${JSON.stringify(armed)}`);
  // A session, so the picker's own `UQA_EVENT` note is stored and can be read
  // back. The note has to carry the same finished locator the clipboard got —
  // it is what the report, the ticket and the spec are built from, and a note
  // that says something shorter than what was copied is the same bug filed
  // one surface along.
  const tabIdOf = async (url) =>
    ctl.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);

  const started = await call({
    type: 'UQA_START',
    charter: 'frame chain',
    tabId: await tabIdOf(`${ORIGIN}/outer`),
  });
  const sessionId = started?.result?.id || started?.result?.session?.id;
  if (!sessionId) throw new Error(`no session to record into: ${JSON.stringify(started)}`);

  /** Every note this session has stored, oldest first. */
  const notes = async () => {
    const res = await call({ type: 'UQA_GET_TIMELINE', sessionId });
    return (res?.result?.events || []).filter((e) => e.kind === 'note').map((e) => e.text);
  };

  /**
   * Point at something and click it, with the picker armed, and answer with
   * everything the click left behind.
   *
   * The mouse is moved to the element's real viewport coordinates rather than
   * dispatched at it, because the routing of a pointer across an iframe
   * boundary is exactly what is under test and a synthetic event would route
   * itself wherever the test told it to.
   */
  const NOTHING_YET = 'nothing has been copied yet';

  async function pick(url, target) {
    await under.goto(url, { waitUntil: 'load' });
    await under.waitForTimeout(400);
    // Real coordinates, taken from the element itself. `boundingBox()` answers
    // in the top frame's own space however deep the element is, which is
    // exactly the translation the picker has to get right too.
    const box = await target(under).boundingBox();
    if (!box) throw new Error('the element to point at is not on screen');
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await under.evaluate((t) => navigator.clipboard.writeText(t), NOTHING_YET).catch(() => {});
    const tabId = await tabIdOf(url);
    await call({ type: 'UQA_PICK', tabId });
    await under.waitForTimeout(400);

    const before = (await notes()).length;
    await under.mouse.move(at.x, at.y);
    await under.waitForTimeout(500);
    const tips = await tipState();
    await under.mouse.click(at.x, at.y);
    await under.waitForTimeout(900);

    return { tips, note: (await notes()).slice(before)[0] || '', clipboard: await clipboard() };
  }

  /** Which frames are showing a tooltip, mirrored into the light DOM by picker.js. */
  const tipState = () =>
    Promise.all(
      under.frames().map(async (f) => ({
        url: f.url(),
        tip: await f.evaluate(() => document.documentElement.dataset.uqaPickTip || 'none').catch(() => 'gone'),
      }))
    );

  /**
   * The clipboard, if this harness can read it.
   *
   * `navigator.clipboard.readText()` wants a focused document and the suite
   * deliberately never brings its window to the front (see lib-launch.mjs), so
   * on some machines this answers nothing at all. That is a fact about the
   * harness and not about the product, so it is reported rather than failed,
   * and the note assertion beside it is the one that must always hold.
   */
  const clipboard = async () => {
    try {
      return await under.evaluate(() => navigator.clipboard.readText());
    } catch {
      return null;
    }
  };

  const locatorIn = (note) => (note.match(/: (page\..*)$/s) || [])[1] || '';

  /**
   * What was copied, as best this machine can be asked.
   *
   * The clipboard is the reading that matters, because the clipboard is what
   * the report was about. `navigator.clipboard.readText()` wants a focused
   * document and this suite deliberately never brings its window to the front
   * (see lib-launch.mjs), so on some machines it answers nothing at all — a
   * fact about the harness, not about the product. The picker writes the same
   * finished locator into the session note, so that stands in when it does.
   * A clipboard that still holds the sentinel is not standing in for anything:
   * that is the copy having failed, and it fails the suite.
   */
  const copied = (r) => (r.clipboard === null ? locatorIn(r.note) : r.clipboard);

  /* ── the cross-origin frame ──────────────────────────────────────────── */

  console.log('\nthe element inside a cross-origin iframe');

  const inner = await pick(`${ORIGIN}/outer`, (p) =>
    p.frameLocator('#frame-content').locator('[data-dc-tpl="420"]'));
  const innerLocator = copied(inner);

  await test('the locator carries the whole frameLocator chain', () => {
    if (!innerLocator.startsWith("page.frameLocator('iframe#frame-content').")) {
      throw new Error(`no chain: ${innerLocator || '(nothing was picked)'}`);
    }
    return innerLocator;
  });

  await test('and Playwright itself resolves it, to the one element that was clicked', async () => {
    // The strongest reading available: the copied string is handed to
    // Playwright's own API and asked what it matches. A chain that is merely
    // well-formed passes the test above and fails this one.
    const built = new Function('page', `return ${innerLocator}`)(under);
    const count = await built.count();
    if (count !== 1) throw new Error(`the copied locator matches ${count} elements`);
    const text = await built.innerText();
    if (text.trim() !== 'Publish') throw new Error(`it matched "${text}", not the button that was clicked`);
    return { count, text: text.trim() };
  });

  await test('the clipboard really was written, and the warning is gone', () => {
    if (inner.clipboard === NOTHING_YET) throw new Error('nothing reached the clipboard');
    if (/incomplete/i.test(inner.note)) throw new Error(inner.note);
    return inner.clipboard === null ? 'not readable here; read from the note instead' : 'written';
  });

  await test('exactly one frame is showing a tooltip, and it is not the top one', () => {
    const showing = inner.tips.filter((t) => t.tip === 'on');
    if (showing.length !== 1) {
      throw new Error(`${showing.length} tooltips: ${JSON.stringify(inner.tips)}`);
    }
    if (!showing[0].url.includes('/inner')) {
      throw new Error(`the tooltip is in ${showing[0].url}, not in the frame under the pointer`);
    }
    const top = inner.tips.find((t) => t.url.endsWith('/outer'));
    if (top?.tip !== 'off') throw new Error(`the top frame is at "${top?.tip}", not stood down`);
    return inner.tips;
  });

  await test('the note in the timeline carries the same finished locator', () => {
    if (!inner.note) throw new Error('the pick left no note in the session');
    if (locatorIn(inner.note) !== innerLocator) {
      throw new Error(
        `note:      ${JSON.stringify(locatorIn(inner.note))}\n       clipboard: ${JSON.stringify(innerLocator)}`
      );
    }
    return inner.note;
  });

  /* ── same-origin frames, which always worked ─────────────────────────── */

  console.log('\nsame-origin frames, which the frame can still walk on its own');

  const nested = await pick(`${ORIGIN}/nested`, (p) =>
    p.frameLocator('#shell').frameLocator('iframe[name="deep"]').locator('button'));
  const nestedLocator = copied(nested);

  await test('two frames deep, the chain is both of them, in order', () => {
    const want = "page.frameLocator('iframe#shell').frameLocator('iframe[name=\"deep\"]').";
    if (!nestedLocator.startsWith(want)) {
      throw new Error(`expected the chain to start ${want}\n       got ${nestedLocator || '(nothing was picked)'}`);
    }
    return nestedLocator;
  });

  await test('and Playwright resolves that one too', async () => {
    const built = new Function('page', `return ${nestedLocator}`)(under);
    const count = await built.count();
    if (count !== 1) throw new Error(`the copied locator matches ${count} elements`);
    return { count };
  });

  /* ── the top frame, which must be exactly as it was ──────────────────── */

  console.log('\nthe top frame, unchanged');

  const top = await pick(`${ORIGIN}/outer`, (p) => p.locator('#top-button'));
  const topLocator = copied(top);

  await test('an element in the top frame gets no frameLocator at all', () => {
    if (!topLocator) throw new Error('nothing was picked');
    if (topLocator.includes('frameLocator')) throw new Error(topLocator);
    return topLocator;
  });

  await test('and it still resolves to the element that was clicked', async () => {
    const built = new Function('page', `return ${topLocator}`)(under);
    const count = await built.count();
    if (count !== 1) throw new Error(`matches ${count}`);
    const text = await built.innerText();
    if (text.trim() !== 'Top frame button') throw new Error(`it matched "${text}"`);
    return { count };
  });

  /* ── a frame made by a script, with its document inline (D-1010-163) ─── */

  console.log('\nthe element inside a script-created srcdoc iframe');

  const made = await pick(`${ORIGIN}/srcdoc`, (p) => p.frameLocator('#made').locator('#inside'));

  await test('the page scripts run in the srcdoc frame: its tooltip is showing', () => {
    const showing = made.tips.filter((t) => t.tip === 'on');
    if (showing.length !== 1 || !showing[0].url.startsWith('about:srcdoc')) {
      throw new Error(`no tooltip in the srcdoc frame: ${JSON.stringify(made.tips)}`);
    }
    return made.tips;
  });

  await test('and the pick through it carries the frameLocator chain', () => {
    const loc = copied(made);
    if (!loc.startsWith("page.frameLocator('iframe#made').")) throw new Error(`no chain: ${loc || '(nothing was picked)'}`);
    return loc;
  });

  /* ── Escape, from the frame that is not the top one ──────────────────── */

  console.log('\nEscape, pressed inside the frame');

  await test('it ends the crosshair in every frame, not only its own', async () => {
    await under.goto(`${ORIGIN}/outer`, { waitUntil: 'load' });
    await under.waitForTimeout(400);
    await call({ type: 'UQA_PICK', tabId: await tabIdOf(`${ORIGIN}/outer`) });
    await under.waitForTimeout(400);
    await under.mouse.move(200, 200);
    await under.waitForTimeout(300);
    await under.keyboard.press('Escape');
    await under.waitForTimeout(600);
    const left = (await tipState()).filter((t) => t.tip === 'on' || t.tip === 'off');
    if (left.length) throw new Error(`still picking in ${left.length} frame(s): ${JSON.stringify(left)}`);
    return 'every frame stood down';
  });

  /* ── the three scanners, and the document they read ──────────────────── */

  /*
   * a site QA pass, findings 14 and 16, in a fixture.
   *
   * On 7 September 2026 Check accessibility, Check the links and Check the fine
   * print were run against a page whose entire content lived in a cross-origin
   * iframe. They reported no violations, one link and no privacy policy — every
   * one of those a true statement about the wrapper and a false one about the
   * page under test, with nothing in the output to say which document had been
   * read.
   *
   * `/outer` is that shape exactly: a top document with one button in it, and a
   * cross-origin frame holding the page anybody would call the page. The
   * assertions below are the ones that would have caught it.
   */

  console.log('\nthe three scanners, pointed at a page inside a cross-origin frame');

  const scan = async (url, type, extra = {}) => {
    await under.goto(url, { waitUntil: 'load' });
    await under.waitForTimeout(500);
    const res = await call({ type, tabId: await tabIdOf(url), ...extra });
    if (!res?.ok) throw new Error(`${type} failed: ${JSON.stringify(res)}`);
    return res.result;
  };

  const a11yNested = await scan(`${ORIGIN}/outer`, 'UQA_SCAN_A11Y');

  await test('accessibility reads every frame, and says how many', () => {
    if (a11yNested.frameCount !== 2) {
      throw new Error(`${a11yNested.frameCount} frame(s) scanned, expected 2: ${JSON.stringify(a11yNested.frames)}`);
    }
    return { frames: a11yNested.frameCount, total: a11yNested.total, rules: a11yNested.rules };
  });

  await test('it finds the violation that is inside the frame', () => {
    const hit = (a11yNested.violations || []).find((v) => v.id === 'image-alt');
    if (!hit) {
      throw new Error(`image-alt not found; rules seen: ${(a11yNested.violations || []).map((v) => v.id).join(', ') || 'none'}`);
    }
    if (!String(hit.frameUrl || '').includes('/inner')) {
      throw new Error(`the finding is filed against ${hit.frameUrl}, not the frame it is in`);
    }
    if (hit.frameDepth !== 1) throw new Error(`frameDepth ${hit.frameDepth}, expected 1`);
    return { id: hit.id, frameUrl: hit.frameUrl, depth: hit.frameDepth };
  });

  const linksNested = await scan(`${ORIGIN}/outer`, 'UQA_CHECK_LINKS');

  await test('the link check reads every frame, and finds the frame\'s links', () => {
    if (linksNested.frameCount !== 2) {
      throw new Error(`${linksNested.frameCount} frame(s), expected 2: ${JSON.stringify(linksNested.frames)}`);
    }
    const hrefs = (linksNested.rows || []).map((r) => r.href);
    if (!hrefs.some((h) => h.includes('/privacy-policy'))) {
      throw new Error(`the frame's privacy link was not collected; saw: ${hrefs.join(', ') || 'nothing'}`);
    }
    return { frames: linksNested.frameCount, total: linksNested.total, hrefs };
  });

  const fineNested = await scan(`${ORIGIN}/outer`, 'UQA_FINE_PRINT');

  await test('the fine print reads every frame, and finds the policy in the one that has it', () => {
    if (fineNested.frameCount !== 2) {
      throw new Error(`${fineNested.frameCount} frame(s), expected 2: ${JSON.stringify(fineNested.frames)}`);
    }
    const policy = (fineNested.checks || []).find((c) => c.id === 'policy-privacy');
    if (!policy) throw new Error('the privacy policy row is missing entirely');
    if (policy.status === 'GAP') {
      throw new Error(`it still reports no privacy policy for a page that has one: ${policy.detail}`);
    }
    if (!/embedded document/.test(policy.detail)) {
      throw new Error(`the row does not say which document it found it in: ${policy.detail}`);
    }
    return { status: policy.status, detail: policy.detail.slice(0, 120) };
  });

  await test('the security headers this session captured are measured, not asked about', () => {
    const row = (id) => (fineNested.checks || []).find((c) => c.id === id);
    const csp = row('header-csp');
    const hsts = row('header-hsts');
    const referrer = row('header-referrer-policy');
    const framing = row('header-frame-options');
    if (!csp || !hsts || !referrer || !framing) throw new Error('the header rows are missing');
    if (csp.status !== 'DECLARED') throw new Error(`CSP: ${csp.status} - ${csp.detail}`);
    if (!/frame-src/.test(csp.detail)) throw new Error(`the CSP row does not quote what was sent: ${csp.detail}`);
    if (referrer.status !== 'DECLARED') throw new Error(`Referrer-Policy: ${referrer.status} - ${referrer.detail}`);
    // Deliberately absent from the fixture's policy, so this is the row that
    // proves "absent" and "not measured" are still different answers.
    if (framing.status !== 'GAP') throw new Error(`X-Frame-Options: ${framing.status} - ${framing.detail}`);
    if (/Not measured/.test(framing.detail)) throw new Error('absent and not-measured have been confused');
    // The fixture serves plain http, so HSTS is the scheme finding rather than
    // a missing header, and the row has to say which of the two it is.
    if (hsts.status !== 'GAP' || !/nothing for HSTS to enforce/.test(hsts.detail)) {
      throw new Error(`HSTS: ${hsts.status} - ${hsts.detail}`);
    }
    return { csp: csp.status, hsts: hsts.status, referrer: referrer.status, framing: framing.status };
  });

  /* ── the guard: one frame must read exactly as it always did ─────────── */

  console.log('\na page with one frame, which must be unchanged');

  const a11yAlone = await scan(`${ORIGIN}/alone`, 'UQA_SCAN_A11Y');
  const linksAlone = await scan(`${ORIGIN}/alone`, 'UQA_CHECK_LINKS');
  const fineAlone = await scan(`${ORIGIN}/alone`, 'UQA_FINE_PRINT');

  await test('one frame is reported as one frame, and every count keeps its meaning', () => {
    for (const [name, r] of [['a11y', a11yAlone], ['links', linksAlone], ['fine print', fineAlone]]) {
      if (r.frameCount !== 1) throw new Error(`${name} says ${r.frameCount} frames on a page with one`);
    }
    // The same document, scanned alone and scanned inside a wrapper, must find
    // the same things in it. The wrapper adds its own; it does not change these.
    const aloneIds = (a11yAlone.violations || []).map((v) => v.id).sort();
    if (!aloneIds.includes('image-alt')) throw new Error(`scanned alone, image-alt is missing: ${aloneIds.join(', ')}`);
    for (const v of a11yAlone.violations || []) {
      if (v.frameDepth !== 0) throw new Error(`a top-frame finding has depth ${v.frameDepth}`);
    }
    if (a11yAlone.rules !== new Set(aloneIds).size) throw new Error('rules is no longer a count of distinct rules');
    return {
      a11y: { frames: a11yAlone.frameCount, rules: a11yAlone.rules, total: a11yAlone.total },
      links: { frames: linksAlone.frameCount, total: linksAlone.total },
      fine: { frames: fineAlone.frameCount, total: fineAlone.counts.total },
    };
  });

  await test('the top-frame findings say nothing about an embedded document', () => {
    const policy = (fineAlone.checks || []).find((c) => c.id === 'policy-privacy');
    if (/embedded document/.test(policy?.detail || '')) {
      throw new Error(`a single-frame page must read as it always did: ${policy.detail}`);
    }
    return policy.status;
  });

  /* ── the recorder, inside the frame ──────────────────────────────────── */

  console.log('\na click recorded inside the cross-origin frame');

  await test('the recorded step carries the whole frameLocator chain', async () => {
    await under.goto(`${ORIGIN}/outer`, { waitUntil: 'load' });
    await under.waitForTimeout(700);
    const before = (await call({ type: 'UQA_GET_TIMELINE', sessionId })).result.events.length;
    await under.frameLocator('#frame-content').locator('[data-dc-tpl="420"]').click();
    await under.waitForTimeout(900);
    const events = (await call({ type: 'UQA_GET_TIMELINE', sessionId })).result.events
      .slice(before)
      .filter((e) => e.kind === 'dom' && e.action === 'click');
    if (!events.length) throw new Error('the click was not recorded at all');
    const step = events[events.length - 1];
    if (!String(step.framePrefix || '').startsWith("frameLocator('iframe#frame-content')")) {
      throw new Error(
        `the recorded step carries framePrefix ${JSON.stringify(step.framePrefix)}, ` +
        'which does not reach the document the click was in. A generated spec built from ' +
        'this step addresses the top document and finds nothing.'
      );
    }
    return { framePrefix: step.framePrefix, locator: step.locator };
  });

  await test('nothing threw in any context while all of that happened', () => {
    if (errors.length) throw new Error(errors.join(' | '));
  });
} finally {
  await context.close().catch(() => {});
  server.close();
  scratch();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
