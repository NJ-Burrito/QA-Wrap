/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Secrets never reach a page or a content script (research-integrations F1, F1b, F2).
 *
 *   node tools/test-secrets-page.mjs
 *
 * Real Chrome, the extension loaded unpacked, canary secrets in storage.
 *   F1b  a listener in the PAGE's own world for `uqa:settings` records what it
 *        can read of `detail`, and whether `window.UQASettings` shows there.
 *   F1   from the content script's own isolated world (CDP execution context),
 *        UQA_GET_SETTINGS answers with none of jira/slack/trackers/webhooks and
 *        no canary anywhere in the JSON.
 *   F2   from that same context, UQA_SET_SETTINGS is refused and nothing changes.
 * The extension page gets only masked secrets (••••last4): the vault opens in the worker alone.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { profile } from './lib-paths.mjs';
import { grantedExtension, awaitSiteScripts, seedConsent } from './lib-granted.mjs';

const ORIGIN = 'https://sec.test';
const CANARY = 'CANARY-TOKEN-7f3a91';
const HOOK = 'https://hooks.slack.com/services/T0/B0/CANARY-HOOK-7f3a91';
const PROFILE = profile('.secrets-page-profile');
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

const EXT = grantedExtension({ label: 'secrets' });
purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT, { width: 900, height: 700 }));
await keepOnTop(context); // test window stays above others; released on close
await context.route(`${ORIGIN}/**`, (r) =>
  r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>t</title><p>plain page</p>' }));
await context.addInitScript(() => {
  window.__seen = [];
  window.addEventListener('uqa:settings', (e) =>
    window.__seen.push({ type: typeof e.detail, json: (() => { try { return JSON.stringify(e.detail); } catch { return 'unreadable'; } })() }));
});

let code = 1;
try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  await awaitSiteScripts(worker);
  await worker.evaluate(([c, h]) => chrome.storage.local.set({
    secrets: {
      jira: { baseUrl: 'https://real.atlassian.net', email: 'a@b.c', token: c },
      slack: { webhookUrl: h },
      trackers: { github: { token: c } },
      webhooks: [{ id: 'teams', url: h }],
    },
  }), [CANARY, HOOK]);

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const isolated = [];
  cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
    if (c.auxData?.type === 'isolated' && c.origin.startsWith(`chrome-extension://${id}`)) isolated.push(c.id);
  });
  await cdp.send('Runtime.enable');
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const seen = await page.evaluate(() => ({ seen: window.__seen, win: typeof window.UQASettings }));
  console.log(`  F1b RESULT: page listener fired ${seen.seen.length}x; detail types=${JSON.stringify(seen.seen.map((s) => s.type))}; ` +
    `canary readable=${JSON.stringify(seen.seen).includes('CANARY')}; window.UQASettings in page world=${seen.win}`);
  check(!JSON.stringify(seen).includes('CANARY'), 'F1b: the page cannot read any secret from uqa:settings');
  check(seen.seen.length === 0 && seen.win === 'undefined', 'F1b: nothing settings-shaped is on the page at all', JSON.stringify(seen));

  check(isolated.length > 0, 'a content-script (isolated) context exists on the page');
  const fromCs = async (msg) => {
    const out = await cdp.send('Runtime.evaluate', {
      contextId: isolated[isolated.length - 1], awaitPromise: true, returnByValue: true,
      expression: `new Promise((r) => chrome.runtime.sendMessage(${JSON.stringify(msg)}, r))`,
    });
    return out.result?.value;
  };
  const got = await fromCs({ type: 'UQA_GET_SETTINGS' });
  check(got?.ok === true, 'content script can still read its public settings', JSON.stringify(got)?.slice(0, 200));
  check(!JSON.stringify(got).includes('CANARY'), 'F1: content-script settings hold no canary');
  for (const k of ['jira', 'slack', 'trackers', 'webhooks']) check(!(k in (got?.result || {})), `F1: content-script settings have no "${k}"`);

  const evil = await fromCs({ type: 'UQA_SET_SETTINGS', patch: { jira: { baseUrl: 'https://evil.example' } } });
  check(evil?.ok === false, 'F2: a content-script UQA_SET_SETTINGS is refused', JSON.stringify(evil));
  for (const t of ['UQA_RESET_SETTINGS', 'UQA_WORKSPACE_LEAVE']) {
    const r = await fromCs({ type: t });
    check(r?.ok === false, `F2: a content-script ${t} is refused`, JSON.stringify(r));
  }

  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${id}/options/options.html`);
  const call = (m) => ext.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const full = await call({ type: 'UQA_GET_SETTINGS' });
  check(full?.result?.jira?.token === '••••' + CANARY.slice(-4) && !JSON.stringify(full).includes('CANARY-TOKEN') && !JSON.stringify(full).includes('CANARY-HOOK'), 'the options page gets masked secrets (••••last4), never the value');
  check(full?.result?.jira?.baseUrl === 'https://real.atlassian.net', 'F2: jira.baseUrl untouched after the spoofed write');
  const ok = await call({ type: 'UQA_SET_SETTINGS', patch: { jira: { project: 'QA' } } });
  check(ok?.ok === true, 'an extension page can still write settings', JSON.stringify(ok));
  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  harness: ${err.stack || err}`);
} finally {
  await context.close().catch(() => {});
  fs.rmSync(EXT, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
