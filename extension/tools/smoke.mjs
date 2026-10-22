/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * End-to-end smoke test: loads the unpacked extension into a real Chromium,
 * records a session against a local page, and asserts the exported artefact.
 *
 *   node tools/smoke.mjs
 *
 * Requires the repo's Playwright install. MV3 service workers need a real
 * browser context, so this runs headed by default; set UQA_HEADLESS=1 to use
 * Chromium's new headless mode (Chrome 126+ supports extensions there).
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { profile } from './lib-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const USER_DIR = profile('.smoke-profile');

/* ------------------------------------------------------------- test fixture */

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>UQA fixture</title></head>
<body>
  <h1>Application form</h1>
  <label for="applicant">Applicant name</label>
  <input id="applicant" name="applicant" type="text" />
  <label for="secret">Password</label>
  <input id="secret" name="secret" type="password" />
  <button id="submit" type="button">Submit application</button>
  <div id="result"></div>
  <script>
    document.getElementById('submit').addEventListener('click', async () => {
      try {
        const res = await fetch('/api/applications', { method: 'POST', body: '{}' });
        if (!res.ok) console.error('Submit failed: ' + res.status);
        document.getElementById('result').textContent = 'status ' + res.status;
      } catch (e) { console.error('Submit threw', e); }
    });
  </script>
</body></html>`;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/api/applications')) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"NullPointerException at ApplicationService.submit"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* --------------------------------------------------------------------- main */

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

const { server, port } = await startServer();
const origin = `http://127.0.0.1:${port}`;
console.log(`fixture server on ${origin}`);

// Chrome keeps a compiled copy of the service worker in the profile and will
// happily run yesterday's build against today's manifest — the version stamp
// matches, so nothing looks wrong, and a handler added since simply "does not
// exist". That cost an hour here; purging is one line.
purgeWorkerCache(USER_DIR);

const context = await chromium.launchPersistentContext(USER_DIR, launchOptions(EXT));
await keepOnTop(context); // test window stays above others; released on close

try {
  // The service worker is the extension's heartbeat — wait for it to boot.
  const worker = await freshWorker(context);
  const extensionId = new URL(worker.url()).host;
  console.log(`extension id ${extensionId}\n`);

  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });

  // Drive the extension from its own popup page, which has full chrome.* access.
  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  // The popup asks the worker whether this window is awake as it boots. Calling
  // in before that settles races the worker's own start-up and comes back
  // undefined, which reads as "the handler is missing" rather than "too early".
  await ctl.waitForTimeout(500);

  // A silent `undefined` is the least useful failure this harness can produce —
  // it looks identical whether the handler is missing, the worker is asleep, or
  // the message was never delivered. Surface which.
  const call = (msg) =>
    ctl.evaluate(
      (m) =>
        new Promise((resolve) =>
          chrome.runtime.sendMessage(m, (r) =>
            resolve(r === undefined ? { ok: false, error: chrome.runtime.lastError?.message || 'no response' } : r)
          )
        ),
      msg
    );

  const tabId = await ctl.evaluate(async (o) => {
    const tabs = await chrome.tabs.query({ url: `${o}/*` });
    return tabs[0]?.id ?? null;
  }, origin);
  assert.ok(tabId != null, 'fixture tab not found');

  // The extension is asleep on a fresh profile, by design, so the suite has to
  // wake it exactly as a tester would before anything else can work.
  const armed = await call({ type: 'UQA_ARM' });
  assert.ok(
    armed?.ok && armed.result.armed,
    `could not wake the extension: ${JSON.stringify(armed)}`
  );
  await page.waitForTimeout(400); // let the pages hear about it

  const started = await call({
    type: 'UQA_START',
    charter: 'Smoke: submit fails with 500',
    tabId,
    startUrl: `${origin}/`,
    timeboxMinutes: 30,
    env: { viewport: '1280×720 @1x', userAgent: 'smoke', platform: 'test', language: 'en' },
  });
  assert.ok(started?.ok, `session did not start: ${started?.error}`);

  // Give the broadcast time to reach the content-script bridge.
  await page.waitForTimeout(400);
  await page.fill('#applicant', 'Layla');
  await page.fill('#secret', 'hunter2');
  await page.click('#submit');
  await page.waitForFunction(() => document.getElementById('result').textContent.includes('500'));
  await page.waitForTimeout(800); // let the debounced input + console error land

  // Tagged notes and a self-reported breakdown — the SBTM half.
  await call({ type: 'UQA_NOTE', text: 'Submit 500s on an expired document.', tag: 'bug' });
  await call({ type: 'UQA_NOTE', text: 'Needed a fresh account to get this far.', tag: 'issue' });
  await call({ type: 'UQA_NOTE', text: 'Plain observation with no tag.' });

  const stopped = await call({ type: 'UQA_STOP' });
  assert.ok(stopped?.ok, 'session did not stop');
  const sessionId = stopped.result.id;

  await call({
    type: 'UQA_SET_BREAKDOWN',
    sessionId,
    breakdown: { design: 70, bugs: 20, setup: 10, charter: 90 },
  });

  const md = (await call({ type: 'UQA_EXPORT', sessionId, format: 'markdown' })).result.content;
  const spec = (await call({ type: 'UQA_EXPORT', sessionId, format: 'playwright' })).result.content;
  const json = JSON.parse((await call({ type: 'UQA_EXPORT', sessionId, format: 'json' })).result.content);
  const sheet = (await call({ type: 'UQA_EXPORT', sessionId, format: 'sbtm' })).result.content;

  console.log('assertions');

  check('the extension loads and its service worker boots', () => {
    assert.match(worker.url(), /service-worker\.js$/);
  });

  check('DOM actions were recorded', () => {
    const dom = json.events.filter((e) => e.kind === 'dom');
    assert.ok(dom.length >= 2, `expected >=2 DOM events, got ${dom.length}`);
    assert.ok(dom.some((e) => e.action === 'click'), 'no click recorded');
    assert.ok(dom.some((e) => e.action === 'input'), 'no input recorded');
  });

  check('the password value was masked, never captured', () => {
    assert.ok(!md.includes('hunter2'), 'password leaked into the Markdown export');
    assert.ok(!JSON.stringify(json).includes('hunter2'), 'password leaked into the JSON export');
    assert.ok(md.includes('••••••••') || JSON.stringify(json).includes('••••••••'), 'no mask marker found');
  });

  check('the applicant value WAS captured (only secrets are masked)', () => {
    assert.ok(JSON.stringify(json).includes('Layla'), 'non-secret input was not recorded');
  });

  check('the failing request was captured from the MAIN-world fetch hook', () => {
    const net = json.events.filter((e) => e.kind === 'net');
    const fail = net.find((e) => e.status === 500);
    assert.ok(fail, `no 500 captured; saw ${net.map((n) => n.status).join(',')}`);
    assert.equal(fail.method, 'POST');
    assert.match(fail.responsePreview || '', /NullPointerException/);
  });

  check('the console.error was captured', () => {
    const errs = json.events.filter((e) => e.kind === 'console' && e.level === 'error');
    assert.ok(errs.length >= 1, 'no console error captured');
    assert.match(errs[0].text, /Submit failed: 500/);
  });

  check('the 500 was correlated back to the button click', () => {
    assert.equal(json.correlatedFailures.length >= 1, true, 'no correlation produced');
    const chain = json.correlatedFailures[0];
    assert.equal(chain.trigger?.action, 'click', 'trigger was not the click');
    assert.match(chain.trigger.label, /Submit application/);
    assert.equal(chain.confidence, 'high');
  });

  check('a verified locator was attached to the click', () => {
    const click = json.events.find((e) => e.kind === 'dom' && e.action === 'click');
    assert.ok(click.locator, 'click carried no locator');
    assert.equal(click.locatorAmbiguous, false, `locator was ambiguous (${click.locatorMatches} matches)`);
    assert.match(click.locator, /getByRole\('button'/);
  });

  check('the exported Playwright spec is runnable and complete', () => {
    assert.match(spec, /import \{ test, expect \} from '@playwright\/test';/);
    assert.match(spec, /await page\.goto\(/);
    assert.match(spec, /\.click\(\);/);
    assert.match(spec, /\.fill\(/);
    assert.ok(!spec.includes('hunter2'), 'password leaked into the generated spec');
  });

  check('the Markdown artefact contains the correlated-failure section', () => {
    assert.match(md, /## Correlated failures/);
    assert.match(md, /Triggered by/);
    assert.match(md, /NullPointerException/);
    assert.match(md, /## Steps to reproduce/);
  });

  check('the session sheet records the time-box and the tagged notes', () => {
    assert.match(sheet, /## CHARTER/);
    assert.match(sheet, /30 min time-box/);
    assert.match(sheet, /expired document/);         // the bug
    assert.match(sheet, /fresh account/);            // the issue
    assert.match(sheet, /Plain observation/);        // the untagged note
    assert.ok(!sheet.includes('undefined'), 'the sheet contains "undefined"');
  });

  check('the session sheet keeps bugs, issues and notes in their own sections', () => {
    const bugsAt = sheet.indexOf('## BUGS');
    const issuesAt = sheet.indexOf('## ISSUES');
    const notesAt = sheet.indexOf('## TEST NOTES');
    assert.ok(bugsAt < issuesAt && issuesAt < notesAt, 'sections are out of order');
    assert.ok(sheet.slice(bugsAt, issuesAt).includes('expired document'), 'bug filed under the wrong section');
    assert.ok(sheet.slice(issuesAt, notesAt).includes('fresh account'), 'issue filed under the wrong section');
  });

  check('the session sheet reports the breakdown the tester supplied', () => {
    assert.ok(sheet.includes('| Test design and execution | 70 |'), 'breakdown table missing');
    assert.ok(sheet.includes('Charter / opportunity: **90 / 10**'), 'charter split missing');
  });

  check('the session sheet derives areas covered from real navigation', () => {
    assert.match(sheet, /## AREAS COVERED/);
    assert.ok(sheet.includes(origin), 'the fixture origin is not listed as an area covered');
  });

  check('the session sheet never leaks the password', () => {
    assert.ok(!sheet.includes('hunter2'), 'password leaked into the session sheet');
  });


  /* ------------------------------------------------- settings + shortcuts -- */

  console.log('\n— settings —');

  const defaults = (await call({ type: 'UQA_GET_SETTINGS' })).result;

  check('settings come back with defaults filled in', () => {
    // Recording has no limit, so the default is explicitly nothing.
    assert.equal(defaults.timeboxMinutes, null, 'a default time-box would be a limit nobody asked for');
    assert.ok(defaults.keymap?.pick, 'no default binding for the picker');
  });

  const patched = (await call({
    type: 'UQA_SET_SETTINGS',
    patch: { expandPercent: 120, keymap: { pick: 'Ctrl+Shift+KeyP' } },
  })).result;

  check('a patch merges instead of replacing the whole object', () => {
    assert.equal(patched.expandPercent, 120);
    assert.equal(patched.keymap.pick, 'Ctrl+Shift+KeyP');
    assert.equal(patched.keymap.rtl, defaults.keymap.rtl, 'another binding was lost');
    assert.equal(patched.maxTimelineRows, defaults.maxTimelineRows, 'an untouched value was lost');
  });

  const clamped = (await call({ type: 'UQA_SET_SETTINGS', patch: { expandPercent: 9999 } })).result;
  check('an out-of-range value is clamped, never stored raw', () => {
    assert.equal(clamped.expandPercent, 200);
  });

  await call({ type: 'UQA_SET_SETTINGS', patch: { expandPercent: 120 } });
  await page.waitForTimeout(500); // let the change reach the content script

  const [{ result: seen }] = await ctl.evaluate(
    async (id) =>
      chrome.scripting.executeScript({
        target: { tabId: id },
        world: 'ISOLATED', // where the content scripts — and UQASettings — live
        func: () => window.UQASettings?.expandPercent,
      }),
    tabId
  );
  check('the content script receives settings changes without a reload', () => {
    assert.equal(seen, 120, `content world saw ${seen}`);
  });

  /* ---- the custom binding actually fires in the page ---- */

  await call({ type: 'UQA_SET_SETTINGS', patch: { keymap: { rtl: 'Alt+Shift+KeyG' }, keymapEnabled: true } });
  await page.waitForTimeout(400);
  await page.locator('h1').click();          // move focus off any field
  await page.keyboard.press('Alt+Shift+G');
  await page.waitForTimeout(900);

  const afterCustomKey = await page.evaluate(() => ({
    dir: document.documentElement.getAttribute('dir'),
    expanded: document.querySelector('h1').textContent,
  }));

  check('a re-bound shortcut fires the action it was bound to', () => {
    assert.equal(afterCustomKey.dir, 'rtl', 'Alt+Shift+G did not trigger layout stress');
  });

  check('the expansion percentage from settings is the one applied', () => {
    // 'Application form' is 16 chars; at 120% growth the padding is far longer
    // than it would be at the 40% default.
    const grown = afterCustomKey.expanded.length;
    assert.ok(grown > 16 + 16, `text grew to only ${grown} characters`);
  });

  await page.keyboard.press('Alt+Shift+G'); // toggle back off
  await page.waitForTimeout(600);

  const afterToggleOff = await page.evaluate(() => document.documentElement.getAttribute('dir'));
  check('the page is restored by pressing the shortcut again', () => {
    assert.equal(afterToggleOff, null, 'dir was left on the document');
  });

  /* ---- a binding must not fire while the tester is typing ---- */

  await call({ type: 'UQA_SET_SETTINGS', patch: { keymap: { rtl: 'Alt+Shift+KeyG' } } });
  await page.fill('#applicant', '');
  await page.click('#applicant');
  await page.keyboard.press('Alt+Shift+G');
  await page.waitForTimeout(500);
  const whileTyping = await page.evaluate(() => document.documentElement.getAttribute('dir'));
  check('shortcuts stay out of the way while a field has focus', () => {
    assert.equal(whileTyping, null, 'the shortcut fired while typing in a field');
  });

  /* ---- the user's own mask pattern must actually mask ---- */

  await call({ type: 'UQA_SET_SETTINGS', patch: { maskExtraPattern: 'applicant' } });
  await page.waitForTimeout(400);

  await call({
    type: 'UQA_START',
    charter: 'Mask pattern check',
    tabId,
    startUrl: `${origin}/`,
    timeboxMinutes: null,
  });
  await page.waitForTimeout(400);
  await page.fill('#applicant', 'SHOULD-BE-MASKED');
  await page.waitForTimeout(900);
  const maskRun = await call({ type: 'UQA_STOP' });
  const maskJson = JSON.parse(
    (await call({ type: 'UQA_EXPORT', sessionId: maskRun.result.id, format: 'json' })).result.content
  );

  check('a field matching the user mask pattern is never captured', () => {
    const raw = JSON.stringify(maskJson);
    assert.ok(!raw.includes('SHOULD-BE-MASKED'), 'the value the tester asked us to mask was recorded');
    assert.ok(raw.includes('••••••••'), 'no mask marker was written');
  });

  await call({ type: 'UQA_SET_SETTINGS', patch: { maskExtraPattern: '([unclosed' } });
  await page.waitForTimeout(400);
  await call({ type: 'UQA_START', charter: 'Broken pattern check', tabId, startUrl: `${origin}/`, timeboxMinutes: null });
  await page.waitForTimeout(400);
  await page.fill('#applicant', 'STILL-RECORDED');
  await page.waitForTimeout(900);
  const brokenRun = await call({ type: 'UQA_STOP' });
  const brokenJson = JSON.parse(
    (await call({ type: 'UQA_EXPORT', sessionId: brokenRun.result.id, format: 'json' })).result.content
  );

  check('an invalid mask pattern does not crash the recorder', () => {
    assert.ok(
      brokenJson.events.some((e) => e.kind === 'dom'),
      'recording stopped working after an invalid pattern was saved'
    );
  });

  await call({ type: 'UQA_RESET_SETTINGS' });

  /* ---- the options page renders ---- */

  const opts = await context.newPage();
  await opts.goto(`chrome-extension://${extensionId}/options/options.html`);
  await opts.waitForTimeout(900);

  const optionsShape = await opts.evaluate(() => ({
    ranges: document.querySelectorAll('input[type=range]').length,
    keyRows: document.querySelectorAll('.key-row').length,
    firstBinding: document.querySelector('.key-btn')?.textContent?.trim(),
    filled: getComputedStyle(document.querySelector('input[type=range]')).getPropertyValue('--fill').trim(),
  }));

  check('the settings page renders a slider for every range', () => {
    assert.ok(optionsShape.ranges >= 8, `only ${optionsShape.ranges} sliders rendered`);
  });

  check('the settings page lists every re-bindable action', () => {
    assert.ok(optionsShape.keyRows >= 6, `only ${optionsShape.keyRows} shortcut rows`);
    assert.match(optionsShape.firstBinding || '', /\w/, 'the first shortcut shows no binding');
  });

  check('sliders paint their filled track', () => {
    assert.match(optionsShape.filled, /%$/, `--fill was "${optionsShape.filled}"`);
  });

  await opts.close();
  await page.waitForTimeout(300);

  // ---- RTL stress mode ----
  const rtl = await call({ type: 'UQA_TOGGLE_RTL', tabId, options: { rtl: true, expand: true, accent: false, bidi: false } });

  check('RTL stress mode engages on the page', () => {
    assert.ok(rtl?.ok, `toggle failed: ${rtl?.error}`);
    assert.equal(rtl.result?.enabled, true);
  });

  await page.waitForTimeout(500);

  const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
  check('document direction flipped to rtl', () => assert.equal(dir, 'rtl'));

  const expanded = await page.evaluate(() => document.querySelector('h1').textContent);
  check('strings were expanded with visible pseudo-locale markers', () => {
    assert.match(expanded, /⟦/, 'no pseudo-locale bracket found');
    assert.ok(expanded.length > 'Application form'.length, 'string was not expanded');
  });

  await call({ type: 'UQA_TOGGLE_RTL', tabId });
  await page.waitForTimeout(400);
  const reverted = await page.evaluate(() => ({
    dir: document.documentElement.getAttribute('dir'),
    h1: document.querySelector('h1').textContent,
  }));

  check('RTL stress mode reverts the page cleanly', () => {
    assert.equal(reverted.dir, null, 'dir attribute was not restored');
    assert.equal(reverted.h1, 'Application form', 'text was not restored');
  });
} finally {
  await context.close();
  server.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
