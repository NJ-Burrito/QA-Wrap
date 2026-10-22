/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The Settings + Integrations redesign in real Chrome (entry smoke).
 *
 *   node tools/test-integrations-live.mjs
 *
 * Seven tabs and search; the service grid; Slack, Teams and Mattermost connected through the real
 * screens to a local mock webhook (the harness extension already holds host access, so the
 * chrome.permissions.request on Save resolves without a prompt); Test connection posts to the mock;
 * a finished session posts only to channels subscribed to that event. Canary strings only.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { grantedExtension, awaitSiteScripts, seedConsent } from './lib-granted.mjs';

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-integ-profile-'));
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

const posts = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => { posts.push({ url: req.url, body }); res.end('ok'); });
});
await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${mock.address().port}`;

const EXT = grantedExtension({ label: 'integ' });
purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT, { width: 1200, height: 900 }));
await keepOnTop(context); // test window stays above others; released on close
let code = 1;
try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  await awaitSiteScripts(worker);
  const ext = await context.newPage();
  const errors = [];
  await ext.addInitScript(() => addEventListener('unhandledrejection', (e) => console.error('UNH ' + (e.reason && e.reason.stack))));
  ext.on('pageerror', (e) => errors.push(String(e)));
  ext.on('console', (m) => (m.type() === 'error' ? errors.push(m.text()) : console.log('PAGE', m.text())));
  await ext.goto(`chrome-extension://${id}/options/options.html#sec-integrations`);
  await ext.waitForSelector('#svc-grid .svc');
  const call = (m) => ext.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);

  check((await ext.locator('#rail [role=tab]').count()) === 7, 'seven tabs');
  check((await ext.locator('#tab-appearance').innerText()).length > 0 && (await ext.locator('#rail [role=tab]').first().getAttribute('data-rail')) === 'appearance', 'Language sits first, on its own tab');
  check((await ext.locator('#svc-grid .svc').count()) === 18, 'service grid keeps every earlier service (Jira, 9 trackers, 7 chat targets, Email)');
  check(await ext.locator('#filing-row').isHidden(), 'auto-submit hidden until an integration is set up');

  // search
  await ext.fill('#q', 'sound');
  check((await ext.locator('#rail [role=tab]:not([hidden])').count()) === 1 && (await ext.locator('#tab-appearance').isVisible()), 'search "sound" leaves the Appearance tab only');
  await ext.fill('#q', '');
  await ext.goto(`chrome-extension://${id}/options/options.html#sec-integrations`);
  await ext.waitForSelector('#svc-grid .svc');

  const connect = async (svc, name, path, events, { already = false, raceTo = '' } = {}) => {
    if (!already) await ext.click(`[data-svc="${svc}"]`);
    await ext.fill('#f-name', name);
    await ext.fill('#f-url', `${BASE}${path}`);
    for (const e of ['done', 'fail', 'report']) {
      const on = (await ext.getAttribute(`.svc-form [data-ev="${e}"]`, 'aria-pressed')) === 'true';
      if (on !== events.includes(e)) await ext.click(`.svc-form [data-ev="${e}"]`);
    }
    // T-074 flake: an unrelated setting written from the worker repaints the page while this form is open (focus is on a chip, not an input).
    // The half-filled form must survive it, or Save answers "Give the channel a name first".
    const before = await ext.evaluate(() => [...document.querySelectorAll('.svc-form [data-ev]')].map((b) => b.getAttribute('aria-pressed')).join());
    await call({ type: 'UQA_SET_SETTINGS', patch: { testerName: `repaint-${svc}` } });
    await ext.waitForFunction((n) => document.getElementById('testerName')?.value === n, `repaint-${svc}`); // paintAll() ran: it writes this field, then repaints the integrations
    const after = await ext.evaluate(() => ({ name: document.querySelector('#f-name')?.value, url: document.querySelector('#f-url')?.value, ev: [...document.querySelectorAll('.svc-form [data-ev]')].map((b) => b.getAttribute('aria-pressed')).join() }));
    check(after.name === name && after.url === `${BASE}${path}` && after.ev === before, `${svc}: an unrelated setting saved from the worker leaves the open form as filled`, JSON.stringify({ before, after }));
    await ext.click('.svc-form [type=submit]');
    if (raceTo) {
      // completion review 2: Save repaints 350 ms later from the masked copy. Go Back and fill the next service inside that window:
      // the late render() used to rebuild the new form empty. dt < 340 is the R15 proof that the window was open when we moved on.
      return ext.evaluate(async ({ next, nm }) => {
        const t0 = performance.now();
        while (document.querySelector('.svc-form')) await new Promise((r) => setTimeout(r, 5));
        const dt = performance.now() - t0;
        document.querySelector('[data-act=back]')?.click(); document.querySelector(`[data-svc="${next}"]`)?.click();
        const f = document.getElementById('f-name'); if (f) f.value = nm;
        await new Promise((r) => setTimeout(r, 700));
        return { dt, name: document.getElementById('f-name')?.value };
      }, { next: raceTo, nm: 'mm' });
    }
    await ext.waitForSelector('.chan .saved', { timeout: 8000 }).catch(async (e) => { console.log('SCREEN ERR:', await ext.innerText('#f-err').catch(() => '-'), errors.join('|')); throw e; });
  };
  // a bad shape is refused with a message
  await ext.click('[data-svc="slack"]');
  await ext.fill('#f-name', 'x');
  await ext.fill('#f-url', 'https://example.com/nope');
  await ext.click('.svc-form [type=submit]');
  check(/valid address/.test(await ext.innerText('#f-err')), 'a wrong-shape Slack address is refused');
  await ext.click('[data-act=back]');

  await connect('slack', 'alerts', '/slack', ['fail']);
  check(/••••/.test(await ext.innerText('.chan .saved')), 'Slack connected: "Saved ••••last4"');
  await ext.click('[data-act=test]');
  await ext.waitForSelector('.tests li.ok');
  check(posts.some((p) => p.url === '/slack'), 'Test connection posted to the mock Slack webhook');
  await ext.click('[data-act=back]');
  const race = await connect('teams', 'team', '/teams', ['done'], { raceTo: 'mattermost' });
  check(race.dt < 340 && race.name === 'mm', 'a form opened and filled inside the 350 ms after a save keeps its fields (no late render)', JSON.stringify(race));
  await connect('mattermost', 'mm', '/hooks/abc123', ['done', 'fail'], { already: true });
  await ext.click('[data-act=back]');
  check(await ext.locator('#filing-row').isVisible(), 'auto-submit appears once an integration is set up');
  const st = await call({ type: 'UQA_GET_SETTINGS' });
  check((st.result.webhooks || []).length === 3 && st.result.webhooks.every((w) => w.events && !w.url.includes(BASE + '/slack/x')), 'three channels stored with their events; page sees masked addresses', JSON.stringify(st.result.webhooks));

  // a finished session
  const ORIGIN = 'https://integ.test';
  await context.route(`${ORIGIN}/**`, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>t</title><p>plain page</p>' }));
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  const tabId = await worker.evaluate(async (o) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(o))?.id, ORIGIN);
  const winId = await worker.evaluate((tid) => chrome.tabs.get(tid).then((t) => t.windowId), tabId);
  await call({ type: 'UQA_ARM', windowId: winId });
  const started = await call({ type: 'UQA_START', charter: 'integ live', tabId, startUrl: `${ORIGIN}/` });
  const sessionId = started?.result?.id || started?.result?.sessionId || started?.result?.session?.id;
  await call({ type: 'UQA_STOP' });
  posts.length = 0;
  const sent = await call({ type: 'UQA_NOTIFY', sessionId, defectOptions: null });
  check(sent?.ok === true, 'UQA_NOTIFY answered', JSON.stringify(sent)?.slice(0, 300));
  const paths = posts.map((p) => p.url).sort();
  check(paths.join() === ['/hooks/abc123', '/teams'].sort().join(), 'a finished session (no failure) posts only to channels subscribed to "done"', paths.join());
  check(errors.length === 0, 'no page errors on the options page', errors.join(' | '));
  code = failures.length ? 1 : 0;
  console.log(`\n${passed} passed, ${failures.length} failed`);
} catch (e) {
  console.log('  FAIL  ' + (e.stack || e));
} finally {
  await context.close();
  mock.close();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* left for the OS */ }
}
process.exit(code);
