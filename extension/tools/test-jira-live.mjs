/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The one Jira filing path in real Chrome (entry smoke for background/jira.js + the worker).
 *
 *   node tools/test-jira-live.mjs
 *
 * The extension is loaded unpacked, a canary token goes into the vault through the worker, a
 * session is recorded, and the REPORT PAGE's "Create Jira issue" button is pressed against a local
 * mock Jira: the issue must be created with its attachments, the label fingerprint, and the
 * decrypted canary in Authorization only. Then the codes: SECRET_FOUND (canary typed into the body
 * -> nothing created), redact, JIRA_FIELD_DROPPED, scan, duplicates, comment on an existing issue,
 * status sync (second call cached), and a locked vault (VAULT_LOCKED). Canary strings only.
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

const ORIGIN = 'https://jira-live.test';
const TOKEN = 'CANARY/jira+TOKEN=51d0aa7e';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-jira-live-'));
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

const EXT = grantedExtension({ label: 'jira-live' });
purgeWorkerCache(PROFILE);
let context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT, { width: 1100, height: 800 }));
await keepOnTop(context); // test window stays above others; released on close
await context.route(`${ORIGIN}/**`, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>t</title><p>plain page</p>' }));

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
  check(saved?.ok === true, 'the connection was saved into the vault', JSON.stringify(saved)?.slice(0, 200));
  const got = await call({ type: 'UQA_GET_SETTINGS' });
  check(got?.result?.jira?.token?.startsWith('••••') && !JSON.stringify(got).includes(TOKEN), 'pages see only the masked token');

  // a recorded session
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  const tabId = await worker.evaluate(async (o) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(o))?.id, ORIGIN);
  const winId = await worker.evaluate((tid) => chrome.tabs.get(tid).then((t) => t.windowId), tabId);
  await call({ type: 'UQA_ARM', windowId: winId });
  const started = await call({ type: 'UQA_START', charter: 'jira live', tabId, startUrl: `${ORIGIN}/pay/123` });
  const sessionId = started?.result?.id || started?.result?.sessionId || started?.result?.session?.id;
  check(!!sessionId, 'a session started', JSON.stringify(started)?.slice(0, 200));
  await page.evaluate(() => document.body.click());
  await call({ type: 'UQA_STOP' });

  // ---- the report page's own button ----
  const report = await context.newPage();
  await report.goto(`chrome-extension://${id}/report/report.html?session=${sessionId}`);
  await report.waitForSelector('#verdict:not([hidden]) #btn-file', { timeout: 15000 }).catch(() => {});
  const visible = await report.evaluate(() => document.getElementById('btn-file')?.tagName === 'BUTTON');
  check(visible, 'the report page shows File (a menu) for the saved connection');
  const n0 = seen.length;
  await report.click('#btn-file');
  await report.click('[data-file="jira"]');
  await report.waitForSelector('#dlg-file [data-d=create]:not([disabled])', { timeout: 20000 });
  await report.click('#dlg-file [data-d=create]');
  await report.waitForSelector('#dlg-file .note.ok a', { timeout: 30000 }).catch(() => {});
  const created = posts(/\/rest\/api\/3\/issue$/, n0);
  check(created.length === 1, 'the report button created exactly one issue', `posts: ${created.length}`);
  check(created[0] && basicCarries(created[0].auth), 'the mock saw the decrypted canary in Authorization');
  check(created[0] && !created[0].raw.includes(TOKEN), 'the canary is not in the create body');
  const create = created[0] ? JSON.parse(created[0].raw).fields : {};
  check((create.labels || []).some((l) => /^qaw-fp-[0-9a-f]{8}$/.test(l)) && create.labels?.includes('qa-wrap'), 'labels carry qa-wrap and the fingerprint', JSON.stringify(create.labels));
  check(create.priority && typeof create.priority.name === 'string', 'priority mapped from severity', JSON.stringify(create.priority));
  const att = posts(/\/QA-\d+\/attachments$/, n0);
  check(att.length >= 2, 'evidence files were uploaded through the same path', `attachments: ${att.length}`);
  const names = att.map((r) => /filename="([^"]+)"/.exec(r.raw)?.[1]);
  console.log('  attached:', names.join(', '));
  check(seen.slice(n0).some((r) => r.method === 'PUT' && /qaw-provenance/.test(r.url)), 'the provenance property was set');
  check(posts(/createmeta/, n0).length === 0 && !seen.slice(n0).some((r) => /createmeta\?projectKeys/.test(r.url)), 'the removed createmeta call was never used');
  const filed = await call({ type: 'UQA_FILED', sessionId });
  check(filed?.result?.filed?.some((f) => f.key === 'QA-1' && /\/browse\/QA-1$/.test(f.url)), 'the session stored the key and url', JSON.stringify(filed?.result?.filed));

  // ---- codes ----
  const file = (extra) => call({ type: 'UQA_JIRA_FILE', sessionId, kind: 'defect', projectKey: 'QA', issueTypeName: 'Bug', ...extra });
  let n = seen.length;
  const leak = await file({ body: `steps\nmy token is ${TOKEN} sorry\n` });
  check(leak?.ok === false && leak.code === 'SECRET_FOUND', 'SECRET_FOUND when the vault token is typed into the body', JSON.stringify(leak)?.slice(0, 200));
  check(leak?.data?.findings?.some((f) => f.field === 'description' && f.kind === 'saved-token') && !JSON.stringify(leak).includes(TOKEN), 'findings name the field and never carry the value');
  check(posts(/\/issue$|\/attachments$|\/comment$/, n).length === 0, 'nothing was created or uploaded');
  n = seen.length;
  const red = await file({ body: `steps\nmy token is ${TOKEN} sorry\n`, redact: true });
  check(red?.ok === true && red.result.redacted >= 1, 'redact:true files it', JSON.stringify(red)?.slice(0, 200));
  check(!seen.slice(n).some((r) => r.raw.includes(TOKEN)), 'the canary reached Jira in no body, comment or attachment');
  n = seen.length;
  const drop = await file({ fields: { customfield_99999: 'x' } });
  check(drop?.ok === false && drop.code === 'JIRA_FIELD_DROPPED' && drop.data.fields[0].key === 'customfield_99999', 'JIRA_FIELD_DROPPED with the field names', JSON.stringify(drop)?.slice(0, 200));
  check(posts(/\/issue$/, n).length === 0, 'nothing was created');
  const scan = await call({ type: 'UQA_JIRA_SCAN', sessionId, kind: 'defect', projectKey: 'QA', issueTypeName: 'Bug', body: `x ${TOKEN}` });
  check(scan?.ok && scan.result.clean === false && scan.result.findings.length >= 1, 'UQA_JIRA_SCAN reports without sending', JSON.stringify(scan)?.slice(0, 200));
  const dupes = await call({ type: 'UQA_JIRA_DUPES', sessionId, summary: 'Payment button does nothing' });
  check(dupes?.ok && dupes.result.candidates[0]?.key === 'QA-77' && /^qaw-fp-/.test(dupes.result.fingerprint), 'UQA_JIRA_DUPES returns candidates', JSON.stringify(dupes)?.slice(0, 200));
  n = seen.length;
  const onto = await file({ existingKey: 'QA-77', attach: { formats: ['markdown', 'sbtm'] } });
  check(onto?.ok && onto.result.mode === 'commented' && posts(/QA-77\/comment$/, n).length === 1 && posts(/\/issue$/, n).length === 0, 'existingKey: comment on the issue, no new issue', JSON.stringify(onto)?.slice(0, 200));
  check(posts(/QA-77\/attachments$/, n).length >= 2, 'the evidence went to the existing issue');
  n = seen.length;
  const s1 = await call({ type: 'UQA_JIRA_SYNC', sessionId });
  const s2 = await call({ type: 'UQA_JIRA_SYNC', sessionId });
  // The report page asks once on its own when it draws the filed chips, so both calls here are served from the session.
  check(s1?.ok && s1.result.cached === true && s2?.ok && s2.result.cached === true, 'status sync: the report already asked once; later calls are cached', JSON.stringify([s1?.result?.cached, s2?.result?.cached]));
  check(posts(/\/search\/jql$/, n).length === 0, 'no further search reached Jira');
  const fresh = await call({ type: 'UQA_JIRA_SYNC', sessionId, force: true });
  check(fresh?.result?.cached === true, 'force is still rate limited to one ask per 10 s');

  // ---- locked vault ----
  await ext.goto(`chrome-extension://${id}/options/options.html`);
  await ext.waitForTimeout(500);
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  const key = b64(crypto.getRandomValues(new Uint8Array(32)));
  const pass = await call({ type: 'UQA_VAULT_PASS', key, salt: b64(crypto.getRandomValues(new Uint8Array(16))), iters: 600000, idle: 30 });
  check(pass?.ok === true, 'a passphrase (random test key) was set', JSON.stringify(pass)?.slice(0, 160));
  await call({ type: 'UQA_VAULT_LOCK' });
  n = seen.length;
  const locked = await file({});
  check(locked?.ok === false && locked.code === 'VAULT_LOCKED' && /Unlock QA Wrap to file/.test(locked.error), 'locked vault: the existing locked error, now with VAULT_LOCKED', JSON.stringify(locked)?.slice(0, 200));
  check(seen.length === n, 'nothing reached Jira while locked');
  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  harness: ${err.stack || err}`);
} finally {
  await context?.close().catch(() => {});
  mock.close();
  fs.rmSync(EXT, { recursive: true, force: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
