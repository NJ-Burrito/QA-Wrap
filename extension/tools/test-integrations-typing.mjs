/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Typing into the Jira fields keeps what was typed (real Chrome, real chrome.storage, real broadcast).
 *
 *   node tools/test-integrations-typing.mjs
 *
 * Reported 2026-10-20: one letter into a Jira field and the field empties, the letter is saved, and
 * Test / Save & allow / filing stop working. Diagnosis: work/integrations-1020/DIAGNOSIS.md.
 *
 * Each keystroke is followed by a pause longer than the 250 ms save debounce, so every letter makes a
 * real UQA_SET_SETTINGS and the worker's UQA_SETTINGS_CHANGED broadcast lands between letters, exactly
 * as it does for a person typing at normal speed. No fixture fakes storage or messaging: the page runs
 * in the real extension, so a broadcast the browser delivers is a broadcast this test sees.
 * Canary values only; nothing leaves the machine (the Jira host is never contacted).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { grantedExtension, seedConsent } from './lib-granted.mjs';

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-integ-typing-'));
const PAUSE = 400; // > TIMING.saveDebounce (250 ms) in options/options.js
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

// Order matters: an atlassian.net address first, so the email field is shown (Cloud) when it is reached.
const FIELDS = [
  ['jira-baseUrl', 'https://canary.atlassian.net', (s) => s.jira?.baseUrl],
  ['jira-email', 'qa@canary.test', (s) => s.jira?.email],
  ['jira-token', 'canaryTOKEN0123456789', (s) => s.jira?.token], // stored masked: '••••' + last 4
  ['jira-project', 'QAC', (s) => s.jira?.project],
];

const EXT = grantedExtension({ label: 'integ-typing' });
purgeWorkerCache(PROFILE);
// Headless chromium (real extension, real storage, real messaging), as test-editors-keyboard-live: no window to take.
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium', headless: true, viewport: { width: 1200, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu'],
});
let code = 1;
try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  const ext = await context.newPage();
  const errors = [];
  ext.on('pageerror', (e) => errors.push(String(e)));
  // What the page is told: every UQA_SETTINGS_CHANGED and whether it still carries `jira`.
  await ext.addInitScript(() => {
    globalThis.__seen = [];
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === 'UQA_SETTINGS_CHANGED') globalThis.__seen.push(m.settings && 'jira' in m.settings ? 'with-jira' : 'NO-jira');
    });
  });
  await ext.goto(`chrome-extension://${id}/options/options.html#sec-integrations/jira`);
  await ext.waitForSelector('#svc-screen #jira-baseUrl', { state: 'visible' });
  const call = (m) => ext.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);

  for (const [fid, text, stored] of FIELDS) {
    await ext.click(`#${fid}`);
    const tag = await ext.evaluate((f) => { const e = document.getElementById(f); e.__probe = f; return f; }, fid);
    await ext.locator(`#${fid}`).pressSequentially(text, { delay: PAUSE });
    await ext.waitForTimeout(PAUSE * 2);
    const now = await ext.evaluate((f) => {
      const a = document.activeElement;
      const e = document.getElementById(f);
      return { focus: a?.id || a?.tagName, same: a === e && e.__probe === f, value: e?.value, visible: !!(e && e.offsetParent) };
    }, tag);
    check(now.same, `${fid}: the element typed into keeps focus`, `focus is on ${now.focus}`);
    check(now.visible, `${fid}: the field stays on screen`);
    check(now.value === text, `${fid}: the field holds everything typed`, `value ${JSON.stringify(now.value)}, typed ${JSON.stringify(text)}`);
    const res = await call({ type: 'UQA_GET_SETTINGS' });
    const got = stored(res?.result || {});
    const want = fid === 'jira-token' ? `••••${text.slice(-4)}` : text;
    check(got === want, `${fid}: the stored value is the full string`, `stored ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  // The page must still believe Jira is set up, or Test and filing read an empty config.
  const seen = await ext.evaluate(() => globalThis.__seen);
  console.log(`  info  broadcasts seen by the page: ${seen.length} (${[...new Set(seen)].join(', ')})`);
  check(!seen.includes('NO-jira'), 'the options page is never handed a settings copy without its Jira block', `${seen.filter((s) => s === 'NO-jira').length} of ${seen.length} broadcasts had no jira`);
  // The popup (and report) opened as a tab are extension pages too: they must get the masked copy, not the public one.
  const pop = await context.newPage();
  await pop.addInitScript(() => {
    globalThis.__seen = [];
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === 'UQA_SETTINGS_CHANGED') globalThis.__seen.push(m.settings && 'jira' in m.settings ? 'with-jira' : 'NO-jira');
    });
  });
  await pop.goto(`chrome-extension://${id}/popup/popup.html`);
  await call({ type: 'UQA_SET_SETTINGS', patch: { testerName: 'Canary' } });
  await pop.waitForTimeout(PAUSE * 2);
  const popSeen = await pop.evaluate(() => globalThis.__seen);
  check(popSeen.length > 0 && !popSeen.includes('NO-jira'), 'the popup opened as a tab gets the masked copy only', `seen ${JSON.stringify(popSeen)}`);
  await pop.close();
  check(errors.length === 0, 'no page errors on the options page', errors.join(' | '));
  code = failures.length ? 1 : 0;
  console.log(`\n${passed} passed, ${failures.length} failed`);
} catch (e) {
  console.log('  FAIL  ' + (e.stack || e));
} finally {
  await context.close();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* left for the OS */ }
}
process.exit(code);
