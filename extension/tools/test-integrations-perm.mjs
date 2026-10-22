/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The Integrations screen when site access is NOT already held (real Chrome, real storage, real worker).
 *
 *   node tools/test-integrations-perm.mjs
 *
 * The shipping manifest holds `<all_urls>`, but a tester can withhold site access in chrome://extensions
 * ("On specific sites"). This suite loads the shipping files with exactly that state: access to the local
 * mock (http://127.0.0.1/*) only, every other origin optional and not granted. That is a real Chrome state,
 * not a fake: `chrome.permissions.contains` answers from Chrome for every origin.
 *
 * The one thing a harness cannot do is answer the browser's own permission bubble. So the page's
 * `chrome.permissions.request` is wrapped to record what is asked (origin pattern, and whether the call came
 * inside a user gesture, which Chrome requires) and to answer "Deny" without drawing the bubble. Denial is
 * an answer Chrome itself gives, so the wrapper is never more permissive than Chrome.
 *
 * Covers TEST-DESIGN.md (work/integrations-1020) T-PERM-01, T-PERM-02, T-TR-PERM-01, T-NET-12, T-CH-NET-01,
 * T-TR-UI-02/03, Mattermost extras, connected / not-set-up states, Forget, Email, AI-writing key storage,
 * and Autopilot rule 1 (at most one primary per screen). Canary values only; nothing leaves the machine.
 * @suite feature=jira-integrations
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { seedConsent } from './lib-granted.mjs';
import { shipping, copyShipping } from './lib-ship.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-integ-perm-'));
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

/* The shipping files; site access withheld except for the loopback mock. */
function withheldExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-perm-ext-'));
  for (const entry of shipping(fs.readdirSync(SRC))) copyShipping(path.join(SRC, entry), path.join(dir, entry));
  const file = path.join(dir, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(file, 'utf8'));
  mf.host_permissions = ['http://127.0.0.1/*'];
  // Not '<all_urls>': an optional '<all_urls>' would be withheld by Chrome. Shipping holds '<all_urls>' as required.
  mf.optional_host_permissions = ['https://*/*', 'http://*/*'];
  fs.writeFileSync(file, JSON.stringify(mf, null, 2));
  return dir;
}

const hits = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    hits.push({ method: req.method, url: req.url, body });
    const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.url.startsWith('/rest/api/2/myself')) return json({ name: 'canary', displayName: 'Canary Jira' });
    if (/\/rest\/api\/2\/(project|field)/.test(req.url)) return json([]);
    if (req.url.startsWith('/api/v4/user')) return json({ id: 7, name: 'Canary GitLab', username: 'canary' });
    if (req.method === 'POST') return res.end('ok');
    return json({});
  });
});
await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${mock.address().port}`;

const EXT = withheldExtension();
purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, {
  ...launchOptions(EXT, { width: 1200, height: 900 }),
  acceptDownloads: true,
});
await keepOnTop(context);
let code = 1;
try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  const has = (o) => worker.evaluate((x) => chrome.permissions.contains({ origins: [x] }), o);
  check(await has('http://127.0.0.1/*'), 'precondition: the mock origin is allowed');
  check(!(await has('https://hooks.slack.com/*')) && !(await has('https://api.github.com/*')), 'precondition: other origins are withheld');

  const ext = await context.newPage();
  const errors = [];
  ext.on('pageerror', (e) => errors.push(String(e)));
  await ext.addInitScript(() => {
    globalThis.__perm = [];
    globalThis.__sent = [];
    const p = globalThis.chrome?.permissions;
    if (!p) return; // about:blank between screens
    globalThis.__realRequest = p.request.bind(p);
    p.request = async (q) => { globalThis.__perm.push({ origins: q?.origins || [], gesture: !!navigator.userActivation?.isActive }); return false; };
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...rest) => { if (m?.type) globalThis.__sent.push(m.type); return send(m, ...rest); };
  });
  const call = (m) => ext.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const reset = () => ext.evaluate(() => { globalThis.__perm.length = 0; globalThis.__sent.length = 0; });
  const perm = () => ext.evaluate(() => globalThis.__perm);
  const sent = () => ext.evaluate(() => globalThis.__sent);
  const settings = async () => (await call({ type: 'UQA_GET_SETTINGS' }))?.result || {};
  // F1: a .btn-primary without data-primary (or the reverse) counts as two, so the pair must agree.
  const primaries = () => ext.evaluate(() => { const v = (s) => [...document.querySelectorAll(`#svc-screen ${s}`)].filter((b) => b.offsetParent); const a = v('.btn-primary'), b = v('[data-primary]'); return a.length === b.length && a.every((x) => b.includes(x)) ? a.length : -1; });
  const primaryAct = () => ext.evaluate(() => [...document.querySelectorAll('#svc-screen .btn-primary')].find((b) => b.offsetParent)?.dataset.act);
  // A wait that says what the screen said when it times out.
  const waitFor = (sel, timeout = 8000) => ext.waitForSelector(sel, { timeout }).catch(async (e) => {
    throw new Error(`${sel} never appeared; error line: ${JSON.stringify(await ext.innerText('#f-err').catch(() => '-'))}; perm ${JSON.stringify(await perm())}; ${e.message.split('\n')[0]}`);
  });
  const gridStatus = (svc) => ext.innerText(`[data-svc="${svc}"] .svc-st`);
  const openSvc = async (svc) => {
    await ext.goto('about:blank'); // a hash-only change does not reload the page
    await ext.goto(`chrome-extension://${id}/options/options.html#sec-integrations`);
    await ext.waitForSelector(`[data-svc="${svc}"]`);
    await ext.click(`[data-svc="${svc}"]`);
    await ext.waitForSelector('#svc-screen #svc-title');
  };

  /* ── grid: nothing set up ─────────────────────────────────────────── */
  await ext.goto(`chrome-extension://${id}/options/options.html#sec-integrations`);
  await ext.waitForSelector('#svc-grid .svc');
  check(/not set up/i.test(await gridStatus('slack')) && /not set up/i.test(await gridStatus('jira')) && /ready/i.test(await gridStatus('email')),
    'grid: Slack and Jira "Not set up", Email "Ready"');

  /* ── chat: withheld origin, Deny ──────────────────────────────────── */
  await openSvc('slack');
  check((await primaries()) === 1, 'Slack form: exactly one primary button');
  await reset();
  await ext.fill('#f-name', 'alerts');
  await ext.fill('#f-url', 'https://hooks.slack.com/services/T000/B000/canaryXYZ');
  await ext.click('.svc-form [type=submit]');
  await ext.waitForFunction(() => document.getElementById('f-err')?.textContent.trim());
  let p = await perm();
  check(p.length === 1 && p[0].origins.join() === 'https://hooks.slack.com/*', 'Slack Save asks Chrome for https://hooks.slack.com/* only', JSON.stringify(p));
  check(p[0]?.gesture === true, 'the request is made inside the press (Chrome refuses it otherwise)');
  check(/hooks\.slack\.com/.test(await ext.innerText('#f-err')), 'Deny: the error line names the host', await ext.innerText('#f-err'));
  check(!(await settings()).webhooks?.length, 'Deny: nothing saved');
  check(!(await sent()).includes('UQA_SET_SETTINGS'), 'Deny: no settings write sent');

  /* ── telegram asks for the bot API ─────────────────────────────────── */
  await openSvc('telegram');
  await reset();
  await ext.fill('#f-name', 'tg');
  await ext.fill('#f-token', '123456:canaryCANARYcanaryCANARY0');
  await ext.fill('#f-chatId', '42');
  await ext.click('.svc-form [type=submit]');
  await ext.waitForFunction(() => document.getElementById('f-err')?.textContent.trim());
  p = await perm();
  check(p.length === 1 && p[0].origins.join() === 'https://api.telegram.org/*', 'Telegram Save asks for https://api.telegram.org/*', JSON.stringify(p));
  check(/api\.telegram\.org/.test(await ext.innerText('#f-err')), 'Telegram Deny: the error names api.telegram.org');

  /* ── chat: allowed origin (the mock), Mattermost with its extras ───── */
  await openSvc('mattermost');
  await reset();
  await ext.fill('#f-name', 'mm');
  await ext.fill('#f-url', `${BASE}/hooks/canary1`);
  await ext.fill('#f-channel', 'qa-town');
  await ext.fill('#f-username', 'qa-bot');
  await ext.click('.svc-form [type=submit]');
  await waitFor('.chan .saved');
  check((await perm()).length === 0, 'allowed origin: Save asks Chrome nothing');
  const mm = ((await settings()).webhooks || []).find((w) => w.provider === 'mattermost');
  check(mm && mm.channel === 'qa-town' && mm.username === 'qa-bot', 'Mattermost: channel and "post as" stored', JSON.stringify(mm));
  check(/connected/i.test(await ext.innerText('#svc-screen .badge')), 'Mattermost screen badge: Connected');
  check((await primaries()) === 1 && (await primaryAct()) === 'test', 'Mattermost connected: Test is the one primary button (rule 1)', String(await primaries()));
  hits.length = 0;
  await ext.click('.chan [data-act=test]');
  await ext.waitForSelector('.chan .tests li', { timeout: 8000 });
  check(hits.some((h) => h.method === 'POST' && h.url === '/hooks/canary1'), 'Mattermost Test posts to the webhook');
  check((await ext.locator('.chan .tests li.ok').count()) === 2, 'Mattermost Test: two ok rows', await ext.innerText('.chan .tests'));
  const mmBody = hits.find((h) => h.url === '/hooks/canary1')?.body || '';
  check(/qa-town/.test(mmBody) && /qa-bot/.test(mmBody), 'Mattermost Test carries channel and username', mmBody.slice(0, 200));

  /* ── a saved destination whose origin is withheld: Test (T-NET-12) ─ */
  const dest = { id: 'w_perm_discord', label: 'disc', provider: 'discord', url: 'https://discord.com/api/webhooks/1/canary', enabled: true, events: { done: true, fail: true, report: true } };
  await call({ type: 'UQA_SET_SETTINGS', patch: { webhooks: [...((await settings()).webhooks || []), dest] } });
  await openSvc('discord');
  await reset();
  hits.length = 0;
  await ext.click('.chan [data-act=test]');
  await ext.waitForSelector('.chan .tests li.warn', { timeout: 8000 });
  p = await perm();
  check(p.length === 1 && p[0].origins.join() === 'https://discord.com/*', 'Test on a withheld destination asks for its origin', JSON.stringify(p));
  check(/discord\.com/.test(await ext.innerText('.chan .tests')), 'Deny on Test: the warning names the host', await ext.innerText('.chan .tests'));
  check(!(await sent()).includes('UQA_NOTIFY_TEST'), 'Deny on Test: no test message sent');
  const direct = await call({ type: 'UQA_NOTIFY_TEST', destination: dest });
  check(direct?.ok === false && /not been allowed to reach discord\.com/.test(direct.error || ''), 'the worker itself refuses a withheld origin with a sentence', JSON.stringify(direct));
  const tg = await call({ type: 'UQA_NOTIFY_TEST', destination: { id: 'w_perm_tg', label: 'tg', provider: 'telegram', url: '', token: '123456:canaryCANARYcanaryCANARY0', chatId: '42', enabled: true } });
  check(tg?.ok === false && /not been allowed to reach api\.telegram\.org/.test(tg.error || ''), 'the worker refuses Telegram when api.telegram.org is withheld', JSON.stringify(tg));

  /* ── tracker: withheld origin (GitHub), validation, Deny ───────────── */
  await openSvc('github');
  check((await primaries()) === 1, 'GitHub form: exactly one primary button');
  await ext.fill('#f-token', 'short');
  await ext.fill('#f-repo', 'owner/name');
  await ext.click('.svc-form [type=submit]');
  check(/8 characters/.test(await ext.innerText('#f-err')), 'GitHub: a short token is refused before any request', await ext.innerText('#f-err'));
  await ext.fill('#f-token', 'ghp_canaryCANARY0123');
  await ext.fill('#f-repo', 'not a repo');
  await ext.click('.svc-form [type=submit]');
  check(/owner\/name/.test(await ext.innerText('#f-err')), 'GitHub: a malformed repo is refused');
  await reset();
  await ext.fill('#f-repo', 'owner/name');
  await ext.click('.svc-form [type=submit]');
  await ext.waitForFunction(() => /allowed/.test(document.getElementById('f-err')?.textContent || ''));
  p = await perm();
  check(p.length === 1 && p[0].origins.join() === 'https://api.github.com/*' && p[0].gesture, 'GitHub Save asks for https://api.github.com/* inside the press', JSON.stringify(p));
  check(!String((await settings()).trackers?.github?.token || ''), 'GitHub Deny: nothing saved');

  /* ── tracker: allowed (GitLab on the mock), Test, Replace keeps the secret, Forget ── */
  await openSvc('gitlab');
  await reset();
  await ext.fill('#f-host', BASE);
  await ext.fill('#f-token', 'glpat-canary0123456');
  await ext.fill('#f-project', '1');
  await ext.click('.svc-form [type=submit]');
  await waitFor('.conn .saved');
  check((await perm()).length === 0, 'GitLab on an allowed host: no permission request');
  check(/••••3456/.test(await ext.innerText('.conn .saved')), 'GitLab connected: "Saved ••••3456"');
  check((await primaries()) === 1 && (await primaryAct()) === 'test', 'GitLab connected: Test is the one primary button (rule 1)', String(await primaries()));
  await ext.click('[data-act=test][data-id=gitlab]');
  await ext.waitForSelector('#test-gitlab .tests li', { timeout: 15000 });
  check(/Canary GitLab/.test(await ext.innerText('#test-gitlab')), 'GitLab Test: "Signed in as Canary GitLab"', await ext.innerText('#test-gitlab'));
  await ext.click('[data-act=replace][data-id=gitlab]');
  await ext.fill('#f-project', '2');
  await ext.click('.svc-form [type=submit]');
  await waitFor('.conn .saved');
  const gl = (await worker.evaluate(() => chrome.storage.local.get(null))) && (await settings()).trackers?.gitlab;
  check(gl?.project === '2' && /3456$/.test(gl?.token || ''), 'Replace with the secret left empty keeps the saved token', JSON.stringify({ project: gl?.project, last4: String(gl?.token || '').slice(-4) }));
  await ext.click('[data-act=forget][data-id=gitlab]');
  await ext.waitForSelector('.svc-form', { timeout: 8000 });
  check(/not set up/i.test(await ext.innerText('#svc-screen .badge')), 'Forget: the screen says Not set up');
  await ext.reload();
  await ext.waitForSelector('#svc-screen #svc-title');
  check(/not set up/i.test(await ext.innerText('#svc-screen .badge')) && !String((await settings()).trackers?.gitlab?.token || ''), 'Forget survives a reload');

  /* ── Jira: Save and allow, Test, withheld host ─────────────────────── */
  await call({ type: 'UQA_SET_SETTINGS', patch: { jira: { baseUrl: BASE, authMode: 'server', token: 'canaryTOKEN0123456789', project: 'QAC' } } });
  await openSvc('jira');
  check(/connected/i.test(await ext.innerText('#svc-screen .badge')), 'Jira seeded: badge Connected');
  check((await primaries()) === 1, 'Jira screen: exactly one primary button');
  await reset();
  await ext.click('[data-act=jira-save]');
  await ext.waitForFunction(() => document.getElementById('jira-state')?.textContent.includes('127.0.0.1'));
  check((await perm()).length === 0, 'Jira Save and allow on an allowed host: no request, state line names the host');
  hits.length = 0;
  await ext.click('[data-act=test][data-id=jira]');
  await ext.waitForSelector('#test-jira .tests li', { timeout: 15000 });
  check(/Canary Jira/.test(await ext.innerText('#test-jira')), 'Jira Test: signed in as the mock account', await ext.innerText('#test-jira'));
  check(hits.some((h) => h.url.startsWith('/rest/api/2/myself')), 'Jira Test asked /myself');

  await call({ type: 'UQA_SET_SETTINGS', patch: { jira: { baseUrl: 'https://jira.withheld.test' } } });
  await openSvc('jira');
  await reset();
  await ext.click('[data-act=test][data-id=jira]');
  await ext.waitForSelector('#test-jira .tests li.warn', { timeout: 8000 });
  p = await perm();
  check(p.length === 1 && p[0].origins.join() === 'https://jira.withheld.test/*' && p[0].gesture, 'Jira Test on a withheld host asks for it inside the press', JSON.stringify(p));
  check(/jira\.withheld\.test/.test(await ext.innerText('#test-jira')) && !(await sent()).includes('UQA_JIRA_TEST'), 'Deny: the warning names the host and no Jira request is sent');
  await reset();
  await ext.click('[data-act=jira-save]');
  await ext.waitForFunction(() => /withheld/.test(document.getElementById('jira-state')?.textContent || ''));
  p = await perm();
  check(p.length === 1 && p[0].origins.join() === 'https://jira.withheld.test/*', 'Jira Save and allow asks for the typed host', JSON.stringify(p));
  check(/jira\.withheld\.test/.test(await ext.innerText('#jira-state')), 'Deny on Save and allow: the state line names the host', await ext.innerText('#jira-state'));
  const jd = await call({ type: 'UQA_JIRA_TEST' });
  check(jd?.ok === false && /not been allowed to reach jira\.withheld\.test/.test(jd.error || ''), 'the worker refuses Jira on a withheld host with a sentence, not a TypeError', JSON.stringify(jd));

  await ext.click('[data-act=forget][data-id=jira]');
  await ext.waitForFunction(() => /not set up/i.test(document.querySelector('#svc-screen .badge')?.textContent || ''), null, { timeout: 8000 });
  const js = (await settings()).jira || {};
  check(!js.baseUrl && !js.token, 'Jira Forget clears the address and token', JSON.stringify({ baseUrl: js.baseUrl, token: !!js.token }));

  /* ── Email: one press, one .eml, nothing stored ─────────────────────── */
  await openSvc('email');
  check((await primaries()) === 1, 'Email screen: exactly one primary button');
  const [dl] = await Promise.all([ext.waitForEvent('download', { timeout: 8000 }), ext.click('[data-act=eml]')]);
  const eml = fs.readFileSync(await dl.path(), 'utf8');
  check(dl.suggestedFilename() === 'QA-Wrap-report.eml' && /^Subject: /m.test(eml) && /X-Unsent: 1/.test(eml), 'Email: "Open in mail app" downloads a .eml draft', dl.suggestedFilename());

  /* ── AI writing: the key stays in storage.local, never in synced settings ── */
  await ext.goto('about:blank');
  await ext.goto(`chrome-extension://${id}/options/options.html#sec-integrations`);
  const ai = await ext.waitForSelector('#ai-key', { state: 'attached', timeout: 8000 }).then(() => true, () => false);
  if (ai) {
    await ext.evaluate(() => { document.getElementById('ai-key').value = 'sk-canaryAIKEY0123456'; document.getElementById('ai-key-save').click(); });
    await ext.waitForFunction(() => /3456/.test(document.getElementById('ai-key-state')?.textContent || ''), null, { timeout: 8000 });
    const sync = await worker.evaluate(() => chrome.storage.sync.get(null));
    const local = await worker.evaluate(() => chrome.storage.local.get(null));
    check(!JSON.stringify(sync).includes('canaryAIKEY') && !JSON.stringify(local).includes('canaryAIKEY'), 'AI writing: the key is sealed (no plaintext in storage.local) and never synced');
    check((await ext.inputValue('#ai-key')) === '', 'AI writing: the key box empties after Save');
  } else check(false, 'AI writing block present on the Integrations tab');

  check(errors.length === 0, 'no page errors on the options page', errors.join(' | '));

  /* ── last, with Chrome's own request: does the press still count as a gesture after the code's awaits? ──
   * Chrome refuses permissions.request outside a user gesture at once ("must be called during a user gesture").
   * If it accepts, it draws its bubble and the promise stays open; the bubble closes with the browser below. */
  await openSvc('discord');
  await ext.evaluate(() => { chrome.permissions.request = globalThis.__realRequest; });
  await ext.click('.chan [data-act=test]');
  await ext.waitForTimeout(2500);
  const real = await ext.innerText('.chan .test-out');
  check(!/not been allowed/.test(real), 'real Chrome: the request after the access check is still inside the press (no instant refusal)', real);
  code = failures.length ? 1 : 0;
  console.log(`\n${passed} passed, ${failures.length} failed`);
} catch (e) {
  console.log('  FAIL  ' + (e.stack || e));
} finally {
  await context.close();
  mock.close();
  for (const d of [PROFILE, EXT]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* left for the OS */ } }
}
process.exit(code);
