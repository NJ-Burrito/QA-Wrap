/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * ui-1019 (b): Start is the consent, and capture follows the tab the tester is on.
 *
 *   node tools/test-focus-follow-live.mjs
 *
 * One session, started in window A. A second window B is then focused by the tester (split screen = two windows):
 *   - B joins the one session and wakes by itself (no Wake press, no per-site allow); its events land in the same timeline
 *   - while A is focused again, B's page records nothing, and A's records
 *   - before Start nothing is recorded anywhere
 * The browser here holds <all_urls> from install (manifest host_permissions), so no site grant is made by the harness:
 * the extension under test is the SHIPPED manifest, not a granted copy. Loopback only; a temp profile.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { TRASH } from './lib-trash.mjs';
import { poll } from './lib-worker-live.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};
const recycle = (p) => { if (p && fs.existsSync(p)) try { execFileSync('python', [TRASH, p], { stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } }); } catch { /* temp cleaner */ } };

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ext = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-focus-live-'));
let ctx = null;
let browserPid = null;
const watchdog = setTimeout(() => {
  if (browserPid) spawnSync('taskkill', ['/PID', String(browserPid), '/T', '/F']);
  console.log('WATCHDOG: focus-follow exceeded 150 s; killed the browser this run started');
  process.exit(9);
}, 150000);
watchdog.unref();

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"boom"}'); return; }
  const label = req.url.replace(/\W/g, '') || 'home';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>${label}</title><h1>${label}</h1><script>fetch('/api/${label}').catch(()=>{});</script>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

try {
  console.log('focus follow (live): shipped manifest, no site grant, one session across two windows');
  ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--no-default-browser-check'],
  });
  const cdp = await ctx.browser().newBrowserCDPSession();
  try { browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find((p) => p.type === 'browser')?.id ?? null; } catch { /* watchdog has no pid */ }

  const worker = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ consentedAt: Date.now(), consentVersion: chrome.runtime.getManifest().version }));
  const perms = await worker.evaluate(() => chrome.permissions.getAll());
  check(perms.origins.includes('<all_urls>'), 'the shipped manifest holds <all_urls> from install (no per-site allow)', JSON.stringify(perms.origins));

  // ui-1019 item 2: the Jira helper is registered by the worker with no Allow press, for *.atlassian.net and then for the saved address.
  const jiraScripts = () => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts({ ids: ['qaw-jira', 'qaw-jira-main'] })).map((s) => [s.id, s.matches.join(' ')]));
  const reg = (await poll(async () => { const r = await jiraScripts(); return r.length === 2 ? r : null; }, 10000, 250)).value;
  check(!!reg && reg.every(([, m]) => m === 'http://*/* https://*/*'), 'the Jira helper is registered on every http(s) page at install, no press (it detects Jira in the page)', JSON.stringify(reg));
  await worker.evaluate(() => chrome.storage.local.set({ qawJira: { host: 'jira.corp.example' } }));
  const reg2 = await jiraScripts();
  check(reg2.length === 2 && reg2.every(([, m]) => m === 'http://*/* https://*/*'), 'a saved Jira address leaves the registration as it is (already every http(s) page)', JSON.stringify(reg2));
  await worker.evaluate(() => chrome.storage.local.remove('qawJira'));

  const pageA = await ctx.newPage();
  await pageA.goto(`${origin}/a-before`, { waitUntil: 'domcontentloaded' });
  const ctl = await ctx.newPage();
  await ctl.goto(`chrome-extension://${id}/welcome/welcome.html`);
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, (resp) => r(resp ?? { lastError: chrome.runtime.lastError?.message || null }))), m);
  const tabA = await ctl.evaluate(async (o) => { const [t] = await chrome.tabs.query({ url: `${o}/*` }); return { id: t.id, windowId: t.windowId }; }, origin);

  check((await call({ type: 'UQA_ARM', windowId: tabA.windowId }))?.ok === true, 'window A is woken');
  const start = await call({ type: 'UQA_START', charter: 'Focus follow (live)', tabId: tabA.id, startUrl: `${origin}/a-before` });
  check(start?.ok === true, 'a session starts in window A', JSON.stringify(start).slice(0, 160));
  const sessionId = start?.result?.id;
  const urls = async () => ((await call({ type: 'UQA_GET_TIMELINE', sessionId }))?.result?.events || []).map((e) => e.url || '').filter(Boolean);
  const has = async (needle) => (await urls()).some((u) => u.includes(needle));

  await pageA.bringToFront(); // the harness's control page is a tab of the same window: the tester is on A
  await new Promise((r) => setTimeout(r, 800));
  await pageA.goto(`${origin}/a-one`, { waitUntil: 'domcontentloaded' });
  check(!!(await poll(async () => ((await has('/api/aone')) ? true : null), 12000, 250)).value, 'window A records while it is focused');

  // The tester moves to a new window B (split screen): nothing is pressed.
  const B = await worker.evaluate(async (u) => { const w = await chrome.windows.create({ url: u, focused: true, type: 'normal' }); return { windowId: w.id, tabId: w.tabs[0].id }; }, `${origin}/b-one`);
  const joined = (await poll(async () => { const s = (await call({ type: 'UQA_GET_STATE', tabId: B.tabId }))?.result; return (s?.session?.windowIds || []).includes(B.windowId) ? s : null; }, 12000, 250)).value;
  check(!!joined, 'window B joined the one session on focus', JSON.stringify(joined && { id: joined.session?.id, windowIds: joined.session?.windowIds }));
  check(joined?.session?.id === sessionId, 'it is the same session, one timeline');
  const awake = await worker.evaluate(async (w) => (await chrome.storage.session.get('armedWindows')).armedWindows?.includes(w), B.windowId);
  check(awake === true, 'window B woke by itself (Start was the consent)');

  const pageB = ctx.pages().find((p) => p.url().startsWith(`${origin}/b-one`));
  await pageB.goto(`${origin}/b-two`, { waitUntil: 'domcontentloaded' });
  check(!!(await poll(async () => ((await has('/api/btwo')) ? true : null), 12000, 250)).value, 'window B records while it is focused (same timeline)');

  // Headless Chrome cannot hand focus back to an old window (windows.update({focused}) is a no-op there), so the tester moves
  // on to a third window C instead: B is then a window they are NOT on, and C carries the session.
  const C = await worker.evaluate(async (u) => { const w = await chrome.windows.create({ url: u, focused: true, type: 'normal' }); return { windowId: w.id, tabId: w.tabs[0].id }; }, `${origin}/c-one`);
  check(!!(await poll(async () => (((await call({ type: 'UQA_GET_STATE', tabId: C.tabId }))?.result?.session?.windowIds || []).includes(C.windowId) ? true : null), 12000, 250)).value, 'window C joined the one session on focus');
  await pageB.goto(`${origin}/b-three`, { waitUntil: 'domcontentloaded' });
  const pageC = ctx.pages().find((p) => p.url().startsWith(`${origin}/c-one`));
  await pageC.goto(`${origin}/c-two`, { waitUntil: 'domcontentloaded' });
  check(!!(await poll(async () => ((await has('/api/ctwo')) ? true : null), 12000, 250)).value, 'window C records while it is focused');
  check(!(await has('/api/bthree')), 'window B records nothing while the tester is on C');

  // Inside the focused window: a tab opened in the background records nothing until the tester switches to it.
  const D = await worker.evaluate(async ([w, u]) => (await chrome.tabs.create({ windowId: w, url: u, active: false })).id, [C.windowId, `${origin}/d-bg`]);
  await new Promise((r) => setTimeout(r, 1500));
  check(!(await has('/api/dbg')), 'a background tab in the focused window records nothing');
  await worker.evaluate((t) => chrome.tabs.update(t, { active: true }), D);
  await new Promise((r) => setTimeout(r, 800));
  const pageD = ctx.pages().find((p) => p.url().startsWith(`${origin}/d-bg`));
  await pageD.goto(`${origin}/d-fg`, { waitUntil: 'domcontentloaded' });
  check(!!(await poll(async () => ((await has('/api/dfg')) ? true : null), 12000, 250)).value, 'the same tab records once the tester switches to it');

  // Stop releases every window followFocus woke (B, C); the window Start was pressed in (A) keeps the tester's own switch.
  const stopped = await call({ type: 'UQA_STOP' });
  check(stopped?.ok === true, 'Stop ends the session', JSON.stringify(stopped).slice(0, 160));
  const stillAwake = await worker.evaluate(async () => (await chrome.storage.session.get('armedWindows')).armedWindows || []);
  check(!stillAwake.includes(B.windowId) && !stillAwake.includes(C.windowId), 'after Stop no joined window (B, C) is left awake', JSON.stringify(stillAwake));
  check(stillAwake.includes(tabA.windowId), 'the window Start was pressed in stays as the tester left it');
} catch (err) {
  failures.push(`aborted: ${String(err.message || err).split('\n')[0]}`);
  console.log(`  FAIL  aborted: ${String(err.stack || err).split('\n').slice(0, 4).join(' | ')}`);
} finally {
  if (ctx) await ctx.close().catch(() => {});
  server.close();
  clearTimeout(watchdog);
  recycle(tmp);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
