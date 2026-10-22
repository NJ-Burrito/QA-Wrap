/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * ENTRY SMOKE for the report page's filing (round 3), in real Chrome with the built extension.
 *
 *   node tools/test-report-filing-live.mjs
 *
 * A short session is recorded on a local page whose Submit answers 500. The report is opened and the
 * layout facts checked (verdict, steps and File above the fold). File > Jira runs against a local
 * mock Jira with a vault canary token: duplicates are shown, the issue is created with attachments.
 * A planted secret in the summary raises the warning, nothing is created, "Hide it" redacts and the
 * canary never reaches the mock. The status chips ask the sync message. File > Email downloads a
 * .eml that Python's email package parses. Canary strings only.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { grantedExtension, awaitSiteScripts, seedConsent } from './lib-granted.mjs';

const ORIGIN = 'https://apply-live.test';
const TOKEN = 'CANARY/report+TOKEN=7c3e19aa';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-report-filing-'));
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-report-eml-'));
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

/* a Jira that records what it is sent */
const seen = [];
let issueN = 0;
const json = (res, code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = req.url;
    seen.push({ method: req.method, url, auth: req.headers.authorization || '', raw });
    if (req.method === 'POST' && /\/issue$/.test(url)) return json(res, 201, { id: String(++issueN), key: `QA-${issueN}` });
    if (req.method === 'POST' && /\/attachments$/.test(url)) return json(res, 200, [{ id: '1' }]);
    if (req.method === 'POST' && /\/comment$/.test(url)) return json(res, 201, { id: '5' });
    if (req.method === 'PUT') return json(res, 204 === 0 ? 204 : 200, {});
    if (/createmeta\/QA\/issuetypes\/10/.test(url)) return json(res, 200, { fields: [{ fieldId: 'priority', name: 'Priority', schema: { type: 'priority' }, allowedValues: [{ id: '1', name: 'Highest' }, { id: '2', name: 'High' }, { id: '3', name: 'Medium' }, { id: '4', name: 'Low' }] }] });
    if (/createmeta\/QA\/issuetypes/.test(url)) return json(res, 200, { issueTypes: [{ id: '10', name: 'Bug' }] });
    if (/\/search\/jql/.test(url)) {
      const jql = JSON.parse(raw).jql;
      if (/key in/.test(jql)) return json(res, 200, { issues: [{ key: 'QA-1', fields: { summary: 'S', status: { name: 'Done', statusCategory: { key: 'done', name: 'Done' } } } }] });
      return json(res, 200, { issues: [{ key: 'QA-77', fields: { summary: 'Same thing', status: { name: 'Open', statusCategory: { key: 'new' } }, labels: [] } }] });
    }
    if (/issuelinktype/.test(url)) return json(res, 200, { issueLinkTypes: [{ name: 'Relates' }] });
    return json(res, 200, { accountId: 'a', displayName: 'Mock', values: [], issues: [] });
  });
});
await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
const JIRA_URL = `http://127.0.0.1:${mock.address().port}`;
const basicCarries = (a) => Buffer.from(a.replace(/^Basic\s+/i, ''), 'base64').toString().includes(TOKEN);
const posts = (re, from = 0) => seen.slice(from).filter((r) => r.method === 'POST' && re.test(r.url));

const EXT = grantedExtension({ label: 'report-filing' });
purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT, { width: 1100, height: 900 }));
await keepOnTop(context); // test window stays above others; released on close
const PAGE = `<!doctype html><meta charset="utf-8"><title>Apply</title><h1>Apply</h1><label>Applicant name <input id="n" value="Sara"></label>
<button id="submit" onclick="fetch('${ORIGIN}/api/applications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Sara'})}).then(r=>{if(!r.ok)console.error('Submit failed '+r.status)})">Submit application</button>`;
await context.route(`${ORIGIN}/**`, (r) => (/\/api\//.test(r.request().url())
  ? r.fulfill({ status: 500, headers: { 'content-type': 'application/json' }, body: '{"error":"internal","trace":"NullReference at Apply.Submit"}' })
  : r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: PAGE })));

let code = 1;
try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  await awaitSiteScripts(worker);
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${id}/options/options.html`);
  await ext.waitForTimeout(600);
  const call = (m) => ext.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const saved = await call({ type: 'UQA_SET_SETTINGS', patch: { jira: { baseUrl: JIRA_URL, authMode: 'cloud', email: 'qa@example.test', token: TOKEN, project: 'QA', issueType: 'Bug' } } });
  check(saved?.ok === true, 'the connection was saved into the vault');

  // record: open, type, press Submit (500)
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/apply`, { waitUntil: 'load' });
  const tabId = await worker.evaluate(async (o) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(o))?.id, ORIGIN);
  const winId = await worker.evaluate((tid) => chrome.tabs.get(tid).then((t) => t.windowId), tabId);
  await call({ type: 'UQA_ARM', windowId: winId });
  const started = await call({ type: 'UQA_START', charter: 'Licence renewal: Submit returns 500', tabId, startUrl: `${ORIGIN}/apply` });
  const sessionId = started?.result?.id || started?.result?.sessionId || started?.result?.session?.id;
  check(!!sessionId, 'a session started', JSON.stringify(started)?.slice(0, 160));
  await page.fill('#n', 'Sara Haddad');
  await page.click('#submit');
  await page.waitForTimeout(1500);
  await call({ type: 'UQA_STOP' });

  // the report
  const report = await context.newPage();
  await report.setViewportSize({ width: 1100, height: 900 });
  await report.goto(`chrome-extension://${id}/report/report.html?session=${sessionId}`);
  await report.waitForSelector('#verdict:not([hidden]) #btn-file', { timeout: 20000 });
  const fold = await report.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    return { h1: r('#v-h'), steps: r('#verdict .steps'), file: r('#btn-file'), text: document.getElementById('v-h')?.textContent, n: document.querySelectorAll('#verdict .steps li').length, secTabs: document.querySelectorAll('#secbar .tab').length, panels: document.querySelectorAll('[role=tabpanel]').length };
  });
  check(/500/.test(fold.text || ''), 'the verdict line names the 500', fold.text);
  check(fold.n >= 1 && fold.steps.bottom < 900 && fold.file.bottom < 900 && fold.h1.bottom < 900, 'verdict, steps and File are above the fold at 1100x900', JSON.stringify([fold.h1?.bottom, fold.steps?.bottom, fold.file?.bottom]));
  check(fold.secTabs === 0 && fold.panels === 10, 'section buttons do not use .tab; all ten panels exist');
  // keyboard: one tab stop per row, End moves to the last section
  const stops = await report.evaluate(() => [...document.querySelectorAll('#secbar [role=tab]')].filter((b) => b.tabIndex === 0).length);
  await report.focus('#sec-findings');
  await report.keyboard.press('End');
  const endSel = await report.evaluate(() => document.getElementById('sec-share').getAttribute('aria-selected'));
  check(stops === 1 && endSel === 'true', 'one tab stop in the sections row; End moves to the last section', JSON.stringify({ stops, endSel }));
  await report.click('#sec-findings');

  // File > Jira
  const n0 = seen.length;
  await report.click('#btn-file');
  await report.click('[data-file="jira"]');
  await report.waitForSelector('#dlg-file[open] .badge-warn', { timeout: 20000 }).catch(() => {});
  const dlgText = await report.innerText('#dlg-file');
  check(/QA-77/.test(dlgText), 'the duplicate check lists the possible ticket and does not block', dlgText.slice(0, 200));
  check(await report.locator('#dlg-file [data-d=create]').isEnabled(), 'Create ticket stays available beside duplicates');
  check(/Highest|High|Medium|Low/.test(await report.locator('#j-pr').innerText()), 'severity to priority is shown');
  check(/What will be sent/i.test(dlgText), '"What will be sent" is listed');
  // The HAR carries QA Wrap's own qaw1: provenance stamp; it must not raise a secret warning.
  check((await report.locator('#dlg-file [data-d=redact]').count()) === 0, 'no false secret warning on a clean session');
  await report.click('#dlg-file [data-d=create]');
  await report.waitForSelector('#dlg-file .note.ok a', { timeout: 30000 }).catch(() => {});
  const created = posts(/\/rest\/api\/3\/issue$/, n0);
  check(created.length === 1, 'one issue was created', `${created.length} ${(await report.innerText('#dlg-file')).replace(/\s+/g, ' ').slice(0, 700)}`);
  check(created[0] && basicCarries(created[0].auth), 'the mock saw the decrypted canary token in Authorization');
  check(posts(/\/QA-\d+\/attachments$/, n0).length >= 2, 'attachments were uploaded', seen.slice(n0).map((r) => `${r.method} ${r.url}`).join(' | ').slice(0, 600));
  await report.click('#dlg-file [data-d=close]');
  await report.waitForSelector('#verdict .v-sync .chip', { timeout: 10000 });
  await report.click('#verdict [data-sync]');
  await report.waitForSelector('#verdict .v-sync .st', { timeout: 10000 }).catch(() => {});
  check((await report.locator('#verdict .v-sync .st').count()) >= 1, 'status chips show the synced status');

  // planted secret -> warning -> Hide it
  await report.click('#btn-file');
  await report.click('[data-file="jira"]');
  await report.waitForSelector('#dlg-file #j-s', { timeout: 20000 });
  await report.waitForFunction(() => !document.querySelector('#dlg-file .pulse'), null, { timeout: 20000 }).catch(() => {});
  await report.fill('#j-s', `Submit 500 with token ${TOKEN}`);
  const n1 = seen.length;
  await report.click('#dlg-file [data-d=create]');
  await report.waitForSelector('#dlg-file [data-d=redact]', { timeout: 20000 });
  check(posts(/\/issue$|\/attachments$|\/comment$/, n1).length === 0, 'SECRET_FOUND: nothing was created or uploaded');
  check(/Hide it/.test(await report.innerText('#dlg-file [data-d=redact]')), 'the warning offers "Hide it" in the page (no confirm dialog)');
  await report.click('#dlg-file [data-d=redact]');
  await report.click('#dlg-file [data-d=create]');
  await report.waitForSelector('#dlg-file .note.ok a', { timeout: 30000 }).catch(() => {});
  check(posts(/\/rest\/api\/3\/issue$/, n1).length === 1, 'after Hide it the issue is created');
  check(!seen.slice(n1).some((r) => r.raw.includes(TOKEN)), 'the canary reached Jira in no body, comment or attachment');
  await report.click('#dlg-file [data-d=close]');

  // File > Email
  await report.click('#btn-file');
  const [dl] = await Promise.all([report.waitForEvent('download', { timeout: 30000 }), report.click('[data-file="eml"]')]);
  const emlPath = path.join(OUT, 'report.eml');
  await dl.saveAs(emlPath);
  const py = spawnSync('python', ['-c', [
    'import sys, email, email.policy',
    "m = email.message_from_bytes(open(sys.argv[1],'rb').read(), policy=email.policy.default)",
    'parts = list(m.iter_parts())',
    "print(m['Subject']); print(len(parts)); print(parts[0].get_content()[:400]); print([p.get_filename() for p in parts[1:]])",
  ].join('\n'), emlPath], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  check(py.status === 0 && /Steps to reproduce/.test(py.stdout) && /QA-Wrap-report\.md/.test(py.stdout), '.eml downloads and Python parses it: steps in the body, the report attached', (py.stderr || py.stdout).slice(0, 300));

  // report/istqb.js one-press path: "File as Bug now" with a planted secret in the draft.
  await report.click('#sec-share');
  await report.click('#tab-file');
  await report.waitForSelector('#jira-quick:not([hidden])', { timeout: 20000 });
  await report.evaluate(() => {
    window.__sent = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (...a) => { if (a[0]?.type === 'UQA_JIRA_QUICK') window.__sent.push(JSON.parse(JSON.stringify(a[0]))); return orig(...a); };
  });
  await report.fill('#defect-expected', `Saved, and no token ${TOKEN} shown`);
  const n2 = seen.length;
  await report.click('#jira-quick');
  await report.click('#dlg-file [data-a=yes]');
  await report.waitForSelector('#secret-note [data-h]', { timeout: 20000 });
  check(posts(/\/issue$|\/attachments$|\/comment$/, n2).length === 0, 'quick path: SECRET_FOUND, nothing was created or uploaded');
  check(/Hide it/.test(await report.innerText('#secret-note [data-h]')), 'quick path: the secret warning offers "Hide it"');
  await report.click('#secret-note [data-h]');
  await report.waitForFunction(() => window.__sent.length >= 2, null, { timeout: 20000 });
  const sent = await report.evaluate(() => window.__sent.map((m) => !!m.redact));
  check(sent[0] === false && sent[1] === true, 'quick path: "Hide it" resends UQA_JIRA_QUICK with redact:true', JSON.stringify(sent));
  await report.waitForFunction(() => /QA-\d+/.test(document.getElementById('file-status')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  check(posts(/\/rest\/api\/3\/issue$/, n2).length === 1, 'quick path: after Hide it the issue is created');
  check(!seen.slice(n2).some((r) => r.raw.includes(TOKEN)), 'quick path: the canary reached Jira in no body, comment or attachment');

  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  harness: ${err.stack || err}`);
} finally {
  await context?.close().catch(() => {});
  mock.close();
  fs.rmSync(EXT, { recursive: true, force: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.rmSync(OUT, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
