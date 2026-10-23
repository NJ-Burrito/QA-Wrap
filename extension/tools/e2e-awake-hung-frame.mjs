/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * awake-1023, end to end: a page with a frame that never finishes loading (a slow dashboard gadget) must not stop Awake
 * from sticking, and a timed-out press must say one sentence and leave the switch showing the worker's truth.
 *
 *   node tools/e2e-awake-hung-frame.mjs      (headed, Playwright only, builds nothing: needs dist/chrome from the build)
 *
 * Before the fix `arm()` awaited executeScript into every frame; one hung frame held UQA_ARM past the worker's 10 s clock:
 * "QA Wrap is taking longer than usual", the switch back to Asleep, and the next press (now a sleep) said "Asleep".
 */
import http from 'node:http';
import { launchE2E, until } from './lib-e2e.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };

const srv = http.createServer((q, r) => {
  if (q.url.startsWith('/hang')) return; // never answers: the frame never finishes loading
  r.setHeader('content-type', 'text/html');
  r.end('<title>dashboard</title><meta name="application-name" content="JIRA"><h1>Dashboard</h1><iframe src="/hang-a"></iframe><iframe src="/hang-b"></iframe>');
}).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
let h;
try {
  h = await launchE2E({ label: 'awake-hung', ext: process.env.QAW_EXT });
  const page = await h.context.newPage();
  page.goto(url).catch(() => {});
  await page.waitForTimeout(1500);
  const p = await h.context.newPage();
  await p.setViewportSize({ width: 380, height: 700 });
  await p.goto(`chrome-extension://${h.id}/popup/popup.html?surface=panel`);
  await p.waitForFunction(() => document.body.dataset.ready === 'true');
  const sw = () => p.evaluate(() => document.getElementById('switch').getAttribute('aria-checked'));
  const said = () => p.evaluate(() => document.getElementById('status')?.textContent || '');
  const slowText = await p.evaluate(() => QAWi18n.t('popup.refusal.slow'));

  // 1. Awake with a hung frame: answers inside the injection cap, sticks past the worker's 10 s clock, no failure sentence.
  const t0 = Date.now();
  await p.click('#switch');
  check(!!(await until(async () => (await sw()) === 'true' && !(await said()).includes(slowText), 7000, 150)), 'Awake with a hung frame turns on within 7 s');
  // (the switch is painted at once; the 11 s wait below is what proves the worker answered inside its clock)
  console.log(`  ..  answered in ${Date.now() - t0} ms`);
  await p.waitForTimeout(11000);
  check((await sw()) === 'true', 'the switch is still Awake after 11 s');
  check(!(await said()).includes(slowText), 'no "taking longer than usual" line');
  const windows = await p.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'UQA_ARMED' })).ok);
  check(windows === true, 'the worker answers UQA_ARMED');

  // 1b. A cold worker (stopped after idle, woken by the panel's own state read) is slow to read storage.session: Awake must not read as Asleep.
  await h.worker.evaluate(() => {
    const real = chrome.storage.session.get.bind(chrome.storage.session);
    chrome.storage.session.get = async (k) => { if (k === 'armedWindows') await new Promise((r) => setTimeout(r, 900)); return real(k); };
  });
  await h.worker.evaluate(async () => { const { armedWindows } = await chrome.storage.session.get('armedWindows'); await chrome.storage.session.set({ armedWindows: [] }); await chrome.storage.session.set({ armedWindows }); await new Promise((r) => setTimeout(r, 200)); }); // an unchanged write fires no event: empty first, so the worker drops its cache
  const cold = await p.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'UQA_POPUP_STATE' })).result.armed);
  check(cold.armed !== false, 'a slow cold read of the armed set is never answered "asleep"', JSON.stringify(cold));
  await p.evaluate(() => window.refresh()); await p.waitForTimeout(2500);
  check((await sw()) === 'true', 'and the panel still shows Awake after that read');

  // 2. A press whose answer is lost to the clock: the worker did arm, the popup is told "slow" once, and the switch follows the worker.
  await p.click('#switch'); // back to sleep
  await until(async () => (await sw()) === 'false', 5000, 150);
  await p.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg?.type !== 'UQA_ARM' || typeof cb !== 'function') return real(msg, cb);
      return real(msg, () => cb({ ok: false, timedOut: true, code: 'SLOW', error: 'UQA_ARM did not finish within 10s.' }));
    };
  });
  await p.click('#switch');
  check(!!(await until(async () => (await said()) === slowText, 5000, 100)), 'a timed-out press says the one slow sentence', await said());
  check(!!(await until(async () => (await sw()) === 'true', 5000, 150)), 'the switch then shows what the worker did (Awake), not the guess');
  check((await said()) === slowText, 'the sentence is unchanged after the switch repaints', await said());
} catch (e) {
  check(false, 'the test ran to the end', e.message);
} finally {
  await h?.close();
  srv.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
