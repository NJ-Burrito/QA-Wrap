/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The token vault in real Chrome (entry smoke for platform/vault.js).
 *
 *   node tools/test-vault-live.mjs
 *
 * The extension is loaded unpacked; a canary Jira token is typed into the real options page;
 * a filing request goes to a local mock Jira server, which must see the DECRYPTED token in
 * its Authorization header; the passphrase lock is driven through its own UI (set, lock,
 * filing while locked, wrong passphrase, right passphrase, file again). Then the browser is
 * closed and every file in the profile directory is scanned for the canary as plaintext,
 * base64, hex and URL-encoded, in UTF-8 and UTF-16. A control canary written to
 * storage.local in plaintext must be FOUND, or the scan proves nothing.
 * Canary strings only: no real credential is used or written anywhere.
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
import { recycle } from './lib-trash.mjs';

const ORIGIN = 'https://vault.test';
const TOKEN = 'CANARY/jira+TOKEN=7f3a91xq';
const CONTROL = 'CONTROL-PLAINTEXT-CANARY-51be77c0';
const PASS = 'correct horse battery';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), `uqa-vault-${process.env.UQA_TAG || 'x'}-profile-`)); // always fresh: a vault left locked by a run must not leak into the next
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

/** Every form a scanner could match, as raw bytes in UTF-8 and UTF-16LE. */
function needles(c) {
  const forms = new Set([c, encodeURIComponent(c), Buffer.from(c).toString('hex')]);
  for (let pad = 0; pad < 3; pad++) forms.add(Buffer.from('x'.repeat(pad) + c).toString('base64').slice(4, -4));
  return [...forms].flatMap((f) => [Buffer.from(f, 'utf8'), Buffer.from(f, 'utf16le')]);
}
function scan(dir, list) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && !/^(lockfile|SingletonLock)$/.test(e.name)) {
        let buf;
        try { buf = fs.readFileSync(p); } catch { continue; } // a file the browser keeps locked
        for (const n of list) if (buf.includes(n)) { hits.push(path.relative(dir, p)); break; }
      }
    }
  };
  walk(dir);
  return hits;
}

/* a Jira that records what it is sent */
const seen = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && /\/issue$/.test(req.url)) return res.end(JSON.stringify({ id: '10001', key: 'QA-1', self: 'x' }));
    res.end(JSON.stringify({ accountId: 'a', displayName: 'Mock', values: [], issues: [] }));
  });
});
await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
const JIRA_URL = `http://127.0.0.1:${mock.address().port}`;
const authCarriesToken = (a) => {
  const raw = a.replace(/^(Basic|Bearer)\s+/i, '');
  return a.includes(TOKEN) || Buffer.from(raw, 'base64').toString().includes(TOKEN);
};

const EXT = grantedExtension({ label: 'vault' });
purgeWorkerCache(PROFILE);
let context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT, { width: 1000, height: 800 }));
await keepOnTop(context); // test window stays above others; released on close
await context.route(`${ORIGIN}/**`, (r) =>
  r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>t</title><p>plain page</p>' }));

let code = 1;
try {
  let worker = await freshWorker(context);
  const id = new URL(worker.url()).host;
  await seedConsent(worker);
  await awaitSiteScripts(worker);
  await worker.evaluate((c) => chrome.storage.local.set({ control: c }), CONTROL);

  const ext = await context.newPage();
  // Round 3: connections live on the Integrations tab; Jira is one service screen in its grid.
  const openJira = async () => {
    await ext.goto(`chrome-extension://${id}/options/options.html#sec-integrations`);
    // After a reload the page keeps #sec-integrations/jira in the URL and lands on the Jira screen, where the grid is hidden.
    await ext.waitForSelector('#svc-grid .svc, #jira-token', { state: 'visible' });
    if (!(await ext.locator('#jira-token').isVisible())) await ext.click('[data-svc="jira"]');
    await ext.waitForSelector('#jira-token', { state: 'visible' });
  };
  await openJira();
  const call = (m) => ext.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const stores = () => worker.evaluate(async () => JSON.stringify({ local: await chrome.storage.local.get(null), sync: await chrome.storage.sync.get(null) }));

  // -- connect through the real options page --
  // one field at a time, past the page's 250 ms save debounce, the way a person types
  const type = async (id, v) => {
    await ext.fill(`#${id}`, v);
    await ext.waitForTimeout(450);
  };
  await type('jira-baseUrl', JIRA_URL); await type('jira-email', 'qa@example.test'); await type('jira-project', 'QA'); await type('jira-issueType', 'Bug');
  await type('jira-token', TOKEN);
  await ext.waitForTimeout(1200);
  let dump = await stores();
  check(/"qw0":\{/.test(dump), 'the connection was saved, as a vault record', dump.slice(0, 300));
  check(!needles(TOKEN).some((n) => dump.includes(n.toString('utf8'))), 'the token is in no form in storage.local or storage.sync');
  check(!('secrets' in JSON.parse(dump).local), 'no plaintext "secrets" record exists');
  const got = await call({ type: 'UQA_GET_SETTINGS' });
  check(got?.result?.jira?.token === '••••' + TOKEN.slice(-4) && !JSON.stringify(got).includes(TOKEN), 'the options page is told only ••••last4', JSON.stringify(got?.result?.jira));
  console.log('  jira as the page sees it:', JSON.stringify(got?.result?.jira));
  await ext.reload();
  await openJira();
  const inputState = await ext.evaluate(() => { const i = document.getElementById('jira-token'); return { value: i.value, saved: i.dataset.saved, ph: i.placeholder }; });
  check(inputState.value === '' && inputState.saved === '1', 'after a reload the token box is empty and says saved', JSON.stringify(inputState));

  // -- a real filing request, unlocked --
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  const tabId = await worker.evaluate(async (o) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(o))?.id, ORIGIN);
  const winId = await worker.evaluate((tid) => chrome.tabs.get(tid).then((t) => t.windowId), tabId);
  await call({ type: 'UQA_ARM', windowId: winId });
  const started = await call({ type: 'UQA_START', charter: 'vault live', tabId, startUrl: `${ORIGIN}/` });
  check(started?.ok, 'a session started for the filing test', JSON.stringify(started));
  const sessionId = started?.result?.id || started?.result?.sessionId || started?.result?.session?.id;
  await call({ type: 'UQA_STOP' });
  const file = () => call({ type: 'UQA_JIRA_FILE', sessionId, kind: 'defect', projectKey: 'QA', issueTypeName: 'Bug' });
  const before = seen.length;
  const filed = await file();
  check(filed?.ok === true, 'filing against the mock Jira succeeds', JSON.stringify(filed)?.slice(0, 300));
  const post = seen.slice(before).find((r) => r.method === 'POST' && /\/issue$/.test(r.url));
  check(!!post && authCarriesToken(post.auth), 'the mock Jira saw the decrypted token in Authorization', post ? post.auth.slice(0, 16) + '...' : 'no POST /issue');

  // -- T-011: the profile loses its device key; an unrelated save must not touch the vault --
  // The key is parked in a page that never navigates (a CryptoKey survives structured clone), the IndexedDB
  // record is deleted, and the extension is reloaded so the worker's in-memory key is gone as well.
  const blobOf = () => worker.evaluate(async () => JSON.stringify((await chrome.storage.local.get('qw0')).qw0));
  const blob0 = await blobOf();
  // the key is parked in a second IndexedDB database of the extension's origin
  const idb = (op) => ext.evaluate((o) => new Promise((ok, no) => {
    const open = (name) => new Promise((res, rej) => {
      const r = indexedDB.open(name);
      r.onupgradeneeded = () => r.result.createObjectStore('k');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const run = (db, mode, f) => new Promise((res, rej) => { const q = f(db.transaction('k', mode).objectStore('k')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    (async () => {
      const qw = await open('qw'); const park = await open('qw-park');
      let out;
      if (o === 'park') { const k = await run(qw, 'readonly', (s) => s.get(0)); if (k) await run(park, 'readwrite', (s) => s.put(k, 0)); out = !!k; }
      else if (o === 'drop') out = await run(qw, 'readwrite', (s) => s.clear());
      else if (o === 'count') out = await run(qw, 'readonly', (s) => s.count());
      else { const k = await run(park, 'readonly', (s) => s.get(0)); await run(qw, 'readwrite', (s) => s.put(k, 0)); out = !!k; }
      qw.close(); park.close(); ok(out);
    })().catch(no);
  }), op);
  check(await idb('park') === true, 'the device key was found in IndexedDB and parked');
  await idb('drop');
  check(await idb('count') === 0, 'the device key is deleted from IndexedDB');
  // stop the worker (CDP), so its in-memory key is gone; the next message wakes a new one
  const gone = worker;
  await gone.evaluate(() => { globalThis.__t11 = 1; });
  const closed = new Promise((ok) => gone.once('close', ok));
  const cdp = await context.newCDPSession(ext);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await Promise.race([closed, new Promise((ok) => setTimeout(ok, 8000))]);
  await ext.reload(); // opening a page wakes a new worker
  await ext.waitForSelector('#vault-mode', { state: 'attached' });
  worker = await freshWorker(context);
  check(await worker.evaluate(() => globalThis.__t11) === undefined, 'a new service worker is running (its in-memory key cache is empty)');
  await ext.evaluate(() => { const r = document.getElementById('retentionDays'); r.value = '14'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await ext.waitForFunction(async () => (await new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_GET_SETTINGS' }, r)))?.result?.retentionDays === 14, null, { timeout: 10000 });
  check(true, 'the unrelated setting (retention 14 days) saved');
  check((await blobOf()) === blob0, 'the vault blob is byte-identical after the unrelated save');
  check(await idb('count') === 0, 'no device key was minted silently');
  const en = JSON.parse(fs.readFileSync(path.join(EXT, 'platform/i18n/en.json'), 'utf8'));
  await ext.reload();
  await ext.waitForFunction((m) => document.getElementById('vault-mode').textContent === m, en['options.vault.unreadable'], { timeout: 10000 })
    .then(() => check(true, 'options shows options.vault.unreadable'), (e) => check(false, 'options shows options.vault.unreadable', e.message.split('\n')[0]));
  const refusedSave = await call({ type: 'UQA_SET_SETTINGS', patch: { jira: { token: 'NEW-CANARY-1' } } });
  check(refusedSave?.ok === false && refusedSave.code === 'VAULT_UNREADABLE' && (await blobOf()) === blob0, 'a credential save is refused by name and the blob is still untouched', JSON.stringify(refusedSave)?.slice(0, 160));
  // the profile gets its key back: the untouched blob opens again and filing works
  await idb('put');
  const back = await call({ type: 'UQA_GET_SETTINGS' });
  check(back?.result?.jira?.token === '••••' + TOKEN.slice(-4) && !back.result.vaultUnreadable, 'with the key back the original vault reads again', JSON.stringify(back?.result?.jira));
  const n2 = seen.length;
  const afterKey = await file();
  const post3 = seen.slice(n2).find((r) => r.method === 'POST' && /\/issue$/.test(r.url));
  check(afterKey?.ok === true && !!post3 && authCarriesToken(post3.auth), 'filing works again with the original token (nothing was overwritten)', JSON.stringify(afterKey)?.slice(0, 160));

  // -- the passphrase lock, through its own UI --
  await ext.evaluate(() => document.getElementById('vault-box').scrollIntoView());
  await ext.evaluate((p) => {
    const set = (id, v) => { document.getElementById(id).value = v; };
    set('vault-pass', p); set('vault-pass2', p); set('vault-idle', '30');
    document.getElementById('vault-set-btn').click();
  }, PASS);
  await ext.waitForFunction(() => /Passphrase set/.test(document.getElementById('vault-state').textContent), null, { timeout: 30000 });
  dump = await stores();
  check(/"m":"p"/.test(dump) && !needles(TOKEN).some((n) => dump.includes(n.toString('utf8'))), 'passphrase set: record is in passphrase mode, still no token in storage');
  await ext.evaluate(() => document.getElementById('vault-lock').click());
  await ext.waitForFunction(() => /Locked/.test(document.getElementById('vault-mode').textContent), null, { timeout: 10000 });
  const lockedGet = await call({ type: 'UQA_GET_SETTINGS' });
  check(lockedGet?.result?.vaultLocked === true && !lockedGet.result.jira?.token, 'locked: settings carry no secrets and say vaultLocked');
  const n0 = seen.length;
  const refused = await file();
  check(refused?.ok === false && /Unlock QA Wrap to file/.test(refused.error), 'filing while locked returns "Unlock QA Wrap to file"', JSON.stringify(refused)?.slice(0, 200));
  check(seen.length === n0, 'nothing was sent to Jira while locked');
  await ext.evaluate(() => { document.getElementById('vault-unlock-pass').value = 'wrong horse battery'; document.getElementById('vault-unlock-btn').click(); });
  await ext.waitForFunction(() => /Wrong passphrase/.test(document.getElementById('vault-state').textContent), null, { timeout: 30000 });
  check(true, 'a wrong passphrase is refused with a message');
  check((await call({ type: 'UQA_GET_SETTINGS' }))?.result?.vaultLocked === true, 'still locked after the wrong passphrase');
  await ext.evaluate((p) => { document.getElementById('vault-unlock-pass').value = p; document.getElementById('vault-unlock-btn').click(); }, PASS);
  await ext.waitForFunction(() => /Unlocked/.test(document.getElementById('vault-state').textContent), null, { timeout: 30000 });
  const n1 = seen.length;
  const again = await file();
  const post2 = seen.slice(n1).find((r) => r.method === 'POST' && /\/issue$/.test(r.url));
  check(again?.ok === true && !!post2 && authCarriesToken(post2.auth), 'after the right passphrase, filing succeeds with the decrypted token', JSON.stringify(again)?.slice(0, 200));

  // -- exports --
  const ws = await call({ type: 'UQA_WORKSPACE_EXPORT', name: 'team' });
  check(ws?.ok === false && !JSON.stringify(ws).includes(TOKEN), 'a workspace export is switched off and carries no canary', JSON.stringify(ws)?.slice(0, 120));
  const ex = await call({ type: 'UQA_EXPORT', sessionId, format: 'json' });
  check(!JSON.stringify(ex).includes(TOKEN), 'a session export carries no canary');

  // -- close, then the disk --
  await ext.evaluate(() => document.getElementById('vault-lock').click());
  await context.close();
  context = null;
  // The pipeline sandbox forces its own profile folder (QAW_LAST_PROFILE), so scan the one the browser really wrote to.
  const DISK = process.env.QAW_LAST_PROFILE || PROFILE;
  const hitsToken = scan(DISK, needles(TOKEN));
  const hitsControl = scan(DISK, needles(CONTROL));
  check(hitsControl.length > 0, 'CONTROL: the disk scan does find a plaintext canary (so an empty result means something)', 'scan is blind');
  check(hitsToken.length === 0, 'the profile directory holds the token in no form (plaintext, base64, hex, URL-encoded; UTF-8 and UTF-16)', hitsToken.join(', '));
  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  harness: ${err.stack || err}`);
} finally {
  await context?.close().catch(() => {});
  mock.close();
  recycle(EXT, 'vault-live extension copy');
  recycle(PROFILE, 'vault-live scratch profile');
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
