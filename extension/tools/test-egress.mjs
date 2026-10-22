/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-070: the egress ledger, observe-only.
 *
 *   node tools/test-egress.mjs
 *
 * Real core/egress.js, real core/secret-scan-text.js and the real options panel, with a fake fetch and a fake
 * storage.local. The three worker call sites (jira, trackers, notify) are asserted against the source.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { installIdbStub } from './lib-idb-stub.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r) => fs.readFileSync(path.join(EXT, r), 'utf8');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

const local = {};
const copied = [];
const sync = {};
const session = {};
const localFail = { on: null }; // a key whose write throws, to stand in for a vault that cannot be written
const area = (bag, guard) => ({
  get: async (k) => (k == null ? { ...bag } : Array.isArray(k) ? Object.fromEntries(k.map((x) => [x, bag[x]])) : { [k]: bag[k] }),
  set: async (o) => { if (guard && localFail.on && localFail.on in o) throw new Error('disk full'); Object.assign(bag, o); },
  remove: async (k) => { for (const x of [].concat(k)) delete bag[x]; },
});
globalThis.chrome = { storage: { local: area(local, true), sync: area(sync), session: area(session), managed: { get: async () => ({}) } } };
installIdbStub(); // the vault keeps its device key in IndexedDB
Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (s) => { copied.push(s); } }, configurable: true });
const realFetch = globalThis.fetch;
const sent = [];
globalThis.fetch = async (url, init) => { sent.push({ url, init }); return { status: 200, headers: new Headers() }; };

const E = await import('../core/egress.js');
await import('../platform/settings.js'); // wires the ledger to storage.local, as every real context does
const { scanOutbound, scanFields } = await import('../core/secret-scan-text.js');
const { ledgerLines } = await import('../options/egress-panel.js');
const settle = () => new Promise((r) => setTimeout(r, 20)); // the row is written beside the send, not before it returns
const reset = () => { delete local.egressLedger; sent.length = 0; copied.length = 0; };

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const CORPUS = {
  confirmed: `token ${SECRET} and Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456`,
  loose: 'password=hunter2hunter2 and a card 4111 1111 1111 1111',
  clean: 'The login button is misaligned on a 320px screen.',
};

console.log('egress ledger (T-070)');

await t('a send through the one fetch writes one row: kind, host, bytes, no content', async () => {
  reset();
  const body = JSON.stringify({ text: `secret ${SECRET}` });
  await E.fetchT('https://acme.atlassian.net/rest/api/3/issue', { method: 'POST', body }, { kind: 'jira' });
  assert.equal(sent.length, 1);
  const [row] = local.egressLedger;
  assert.equal(row.kind, 'jira');
  assert.equal(row.host, 'acme.atlassian.net');
  assert.equal(row.bytes, new TextEncoder().encode(body).length);
  assert.deepEqual(Object.keys(row).sort(), ['bytes', 'findingsCount', 'host', 'kind', 'scanned', 'ts']);
  assert.ok(!JSON.stringify(local.egressLedger).includes(SECRET), 'the ledger never holds content');
});

await t('a fetch with no kind is not an egress row; a send that then fails still leaves its row', async () => {
  reset();
  await E.fetchT('https://example.com/');
  await settle();
  assert.equal(local.egressLedger, undefined, 'no kind, no row');
  const down = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(() => E.fetchT('https://hooks.slack.com/x', { method: 'POST', body: 'a' }, { kind: 'webhook' }), /offline/);
  globalThis.fetch = down;
  await settle();
  assert.deepEqual(local.egressLedger.map((r) => r.kind), ['webhook']);
});

await t('the scan that ran just before a send is carried into its row, once', async () => {
  reset();
  E.noteScan('tracker', 3);
  await E.fetchT('https://api.github.com/repos/o/r/issues', { method: 'POST', body: 'x' }, { kind: 'tracker' });
  await E.fetchT('https://api.github.com/repos/o/r/issues', { method: 'POST', body: 'x' }, { kind: 'tracker' });
  await settle();
  assert.deepEqual(local.egressLedger.map((r) => [r.findingsCount, r.scanned]), [[3, true], [0, false]]);
});

await t('the ledger keeps 200 rows, newest last, and concurrent sends keep every row', async () => {
  reset();
  await Promise.all(Array.from({ length: 205 }, (_, i) => E.fetchT(`https://h${i}.example.com/`, { method: 'POST', body: 'b' }, { kind: 'webhook' })));
  await settle();
  assert.equal(local.egressLedger.length, 200);
  assert.equal(E.pushRow(Array(200).fill({}), { host: 'new' }).at(-1).host, 'new');
  assert.equal(new Set(local.egressLedger.map((r) => r.host)).size, 200);
});

await t('clipboard copy is recorded with a count and a size, never the text', async () => {
  reset();
  await E.copyRecorded(`copy me ${SECRET}`);
  assert.equal(copied.length, 1);
  const [row] = local.egressLedger;
  assert.equal(row.kind, 'clipboard');
  assert.equal(row.bytes, new TextEncoder().encode(copied[0]).length);
  assert.ok(!JSON.stringify(row).includes('copy me'));
});

await t('production scanners agree: Jira/tracker scanFields detects exactly what scanOutbound detects (T-070 fault 2)', () => {
  for (const [name, text] of Object.entries(CORPUS)) {
    const detect = scanFields({ text }).findings.map((f) => f.kind).sort();
    const out = scanOutbound({ text }, { mode: 'enforce' }).findings.filter((f) => f.count === undefined).map((f) => f.kind).sort();
    assert.deepEqual(detect, out, `scanFields and scanOutbound disagree on ${name}`);
  }
  assert.ok(Object.values(CORPUS).some((text) => scanFields({ text }).findings.length > 0), 'the corpus is not vacuous');
});

await t('a Jira/tracker send is ledgered only after every refusal, with no invented scan result (T-070 fault 3)', () => {
  const w = workerSrc();
  assert.ok(w.indexOf("'NEEDS_GRANT'") < w.indexOf('ledgerSend(msg.type'), 'the ledger row must come after the NEEDS_GRANT refusal');
  assert.match(read('background/notify.js'), /findingsCount: null, scanned: null/);
  assert.match(ledgerLines([{ ts: 0, kind: 'jira', host: 'a', bytes: 1, findingsCount: null, scanned: null }], (k) => k)[0], /rowNoScan/);
});

await t('the corpus verdict is identical through every kind; observe never blocks, enforce blocks confirmed tier only', () => {
  const kinds = ['jira', 'tracker', 'webhook', 'clipboard', 'eml'];
  for (const [name, text] of Object.entries(CORPUS)) {
    const base = E.prepare('jira', { text }, { scan: scanOutbound });
    for (const k of kinds) {
      const r = E.prepare(k, { text }, { scan: scanOutbound });
      assert.deepEqual(r.findings, base.findings, `${name}/${k}`);
      assert.deepEqual(r.payload, base.payload, `${name}/${k}`);
      assert.equal(r.ledgerRow.findingsCount, base.findings.length);
      assert.equal(r.blocked, false, `observe mode never blocks (${name}/${k})`);
    }
  }
  assert.ok(E.prepare('jira', { text: CORPUS.confirmed }, { scan: scanOutbound }).findings.length > 0, 'the corpus is not vacuous');
  assert.equal(E.prepare('jira', { text: CORPUS.confirmed }, { scan: scanOutbound, enforce: true }).blocked, true);
  assert.equal(E.prepare('jira', { text: CORPUS.clean }, { scan: scanOutbound, enforce: true }).blocked, false);
  assert.ok(!E.prepare('jira', CORPUS.confirmed, { scan: scanOutbound }).payload.includes(SECRET), 'a confirmed secret is redacted even when observing');
  assert.equal(E.prepare('jira', 'plain', {}).ledgerRow.scanned, false);
});

await t('Settings shows the ledger as plain lines with no content, and the copy button is wired', async () => {
  const lines = ledgerLines([{ ts: 0, kind: 'jira', host: 'a.example.com', bytes: 12, findingsCount: 1, scanned: true }, { ts: 1000, kind: 'clipboard', host: '', bytes: 5, findingsCount: 0, scanned: false }], (k, v) => `${k} ${JSON.stringify(v || {})}`);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('1970-01-01 00:00:01'), 'newest first');
  const html = read('options/options.html');
  for (const id of ['egress-list', 'egress-copy', 'egress-empty']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(read('options/options.js'), /wireEgress\(document, t\)/);
});

await t('every send path is ledgered (webhook in the fetch, jira and tracker at the seam, clipboard in the copy handler), the registry knows the key, the file stays small', () => {
  const w = workerSrc();
  assert.match(w, /ledgerRow\(type\.startsWith\('UQA_J'\) \? 'jira' : 'tracker', service, JSON\.stringify\(msg\)\)/, 'jira and tracker sends are ledgered at the seam: the offscreen document has no storage');
  assert.match(w, /LEDGERED = \/\^UQA_\(JIRA_\(FILE\|QUICK\|SYNC\|DUPES\)\|TRACKER_FILE\)\$\//, 'QUICK_PLAN sends nothing and is not ledgered');
  assert.match(read('background/notify.js'), /rawFetch\(u, i, \{ \.\.\.o, kind: 'webhook' \}\)/);
  assert.match(workerSrc(), /chat\.recordCopy\(text\)/);
  assert.match(workerSrc(), /chat\.noteScan\('webhook'/);
  assert.match(read('core/store-registry.js'), /loc\('egressLedger'/);
  assert.match(read('platform/settings.js'), /useLedgerArea\(chrome\.storage\?\.local\)/);
  assert.match(read('core/http.js'), /from '\.\/egress\.js'/, 'the old import path still works');
  assert.ok(read('core/egress.js').split('\n').length <= 250, 'egress.js is over 250 lines');
});


/* ── r1-03-1 / r1-03-3 (council-1010): the Mattermost account post and the API tool obey the same gates ───── */

const MM = await import('../platform/chat-mattermost.js');
const { getSettings } = await import('../platform/settings.js');
const MM_ACCOUNT = { url: 'https://mm.example.test', token: 'mmpat-CANARY-7f3a91xq-token' };
const MM_SUMMARY = { title: 'Submit fails', where: 'https://app.test/apply', severity: 'critical', priority: 'highest', counts: { failures: 2, events: 40, steps: 12 }, expected: 'Saved', actual: 'A 500 page' };
const mmResponder = (log) => async (url, init) => {
  log.push({ url, init });
  return { ok: true, status: 201, headers: new Headers(), text: async () => JSON.stringify({ id: 'post1' }) };
};
const dumpStorage = () => JSON.stringify({ local, sync });

await t('Mattermost: a managed policy that switches integrations off refuses before any fetch, and so does a host list that omits the server', async () => {
  reset();
  const calls = [];
  globalThis.fetch = mmResponder(calls);
  for (const policyNow of [{ integrationsAllowed: false }, { integrationHosts: ['jira.example.test'] }]) {
    session.managedPolicy = policyNow;
    for (const run of [
      () => MM.postSummary(MM_ACCOUNT, 'chan1', MM_SUMMARY),
      () => MM.post(MM_ACCOUNT, 'chan1', 'hello'),
      () => MM.whoAmI(MM_ACCOUNT),
      () => MM.teams(MM_ACCOUNT),
      () => MM.channels(MM_ACCOUNT, 'u1', 't1'),
    ]) {
      await assert.rejects(run, (e) => e.code === 'POLICY_BLOCKED' && /Turned off by your organisation/.test(e.message));
    }
  }
  delete session.managedPolicy;
  await settle();
  assert.equal(calls.length, 0, 'no request left the page');
  assert.equal(local.egressLedger, undefined, 'a refused post writes no ledger row');
});

await t('Mattermost: a seeded secret in the posted summary blocks the send (nothing fetched, no row), the account token too', async () => {
  reset();
  const calls = [];
  globalThis.fetch = mmResponder(calls);
  await assert.rejects(
    () => MM.postSummary(MM_ACCOUNT, 'chan1', { ...MM_SUMMARY, actual: `token ${SECRET} leaked` }),
    (e) => e.code === 'SECRET_FOUND' && /Secret scan: 1 secret-shaped value found/.test(e.message) && !e.message.includes(SECRET)
  );
  await assert.rejects(
    () => MM.postSummary(MM_ACCOUNT, 'chan1', { ...MM_SUMMARY, expected: `Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456` }),
    (e) => e.code === 'SECRET_FOUND'
  );
  await assert.rejects(
    () => MM.postSummary(MM_ACCOUNT, 'chan1', { ...MM_SUMMARY, where: `https://app.test/?x=${MM_ACCOUNT.token}` }),
    (e) => e.code === 'SECRET_FOUND', 'the saved token is matched exactly'
  );
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(local.egressLedger, undefined);
});

await t('Mattermost: a clean post leaves exactly one ledger row (host and bytes, no body, no token) and the bearer header only on the wire', async () => {
  reset();
  const calls = [];
  globalThis.fetch = mmResponder(calls);
  const made = await MM.postSummary(MM_ACCOUNT, 'chan1', MM_SUMMARY, { 'Open the report': 'chrome-extension://x/report.html' });
  assert.equal(made.id, 'post1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://mm.example.test/api/v4/posts');
  await settle();
  assert.equal(local.egressLedger.length, 1, 'one send, one row');
  const [row] = local.egressLedger;
  assert.equal(row.kind, 'mattermost');
  assert.equal(row.host, 'mm.example.test');
  assert.equal(row.bytes, new TextEncoder().encode(calls[0].init.body).length);
  assert.equal(row.scanned, true);
  assert.deepEqual(Object.keys(row).sort(), ['bytes', 'findingsCount', 'host', 'kind', 'scanned', 'ts']);
  const dump = JSON.stringify(local.egressLedger);
  assert.ok(!dump.includes('Submit fails') && !dump.includes(MM_ACCOUNT.token), 'the ledger holds neither the text nor the token');
  assert.match(calls[0].init.headers.authorization, /^Bearer /);
});

await t('Mattermost: reads (who am I, teams, channels) are not sends and write no row; a failed post still leaves its row', async () => {
  reset();
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify([]) }; };
  await MM.teams(MM_ACCOUNT);
  await settle();
  assert.equal(local.egressLedger, undefined);
  globalThis.fetch = async () => { throw new Error('network down'); };
  await assert.rejects(() => MM.post(MM_ACCOUNT, 'chan1', 'hello'), /Could not reach/);
  await settle();
  assert.equal(local.egressLedger.length, 1);
  assert.equal(local.egressLedger[0].kind, 'mattermost');
});

await t('Mattermost: the token is saved in the vault, never as plaintext in storage.local or sync, and forget removes it', async () => {
  for (const k of Object.keys(local)) delete local[k];
  const saved = await MM.save({ url: MM_ACCOUNT.url, token: MM_ACCOUNT.token });
  assert.equal(saved.token, MM_ACCOUNT.token);
  assert.ok(!('token' in (local.mattermost || {})), 'no plaintext token key');
  assert.ok(!dumpStorage().includes(MM_ACCOUNT.token), 'the token is in no plain dump of local or sync');
  assert.ok(!dumpStorage().includes(Buffer.from(MM_ACCOUNT.token).toString('base64').slice(4, -4)), 'nor in base64');
  assert.ok(local.qw0?.ct, 'the vault record exists');
  const back = await MM.load();
  assert.equal(back.token, MM_ACCOUNT.token);
  assert.equal(back.url, MM_ACCOUNT.url);
  assert.equal((await getSettings()).trackers.mattermost.token, MM_ACCOUNT.token, 'it lives beside the other tracker tokens');
  await MM.save({ teamId: 't1', channelId: 'c1' });
  assert.equal((await MM.load()).token, MM_ACCOUNT.token, 'saving the channel keeps the token');
  assert.ok(!('token' in local.mattermost));
  await MM.forget();
  assert.equal(local.mattermost, undefined);
  assert.equal((await MM.load()).token, '');
});

await t('Mattermost: a plaintext token from an older build moves into the vault once, and is deleted only after it reads back', async () => {
  for (const k of Object.keys(local)) delete local[k];
  local.mattermost = { url: MM_ACCOUNT.url, token: MM_ACCOUNT.token, teamId: 't9', channelId: 'c9' };
  const first = await MM.load();
  assert.equal(first.token, MM_ACCOUNT.token);
  assert.deepEqual(local.mattermost, { url: MM_ACCOUNT.url, teamId: 't9', channelId: 'c9' }, 'the plaintext copy is gone, the rest stays');
  assert.ok(!dumpStorage().includes(MM_ACCOUNT.token));
  assert.equal((await getSettings()).trackers.mattermost.token, MM_ACCOUNT.token);
  assert.equal((await MM.load()).token, MM_ACCOUNT.token, 'a second load is idempotent');

  // the vault cannot be written: the plaintext must stay where it was, and the token still works meanwhile
  for (const k of Object.keys(local)) delete local[k];
  local.mattermost = { url: MM_ACCOUNT.url, token: MM_ACCOUNT.token };
  localFail.on = 'qw0';
  const kept = await MM.load();
  localFail.on = null;
  assert.equal(kept.token, MM_ACCOUNT.token);
  assert.equal(local.mattermost.token, MM_ACCOUNT.token, 'no read-back, no deletion');
});

await t('API tool: every send writes a ledger row (kind api, host, bytes, no body), success or failure; a refusal before the fetch writes none', async () => {
  const src = read('api/api.js');
  assert.match(src, /import \{ recordEgress, ledgerRow \} from '\.\.\/core\/egress\.js'/);
  assert.match(src, /recordEgress\(ledgerRow\('api', request\.url,/);
  const gate = src.slice(src.indexOf('let passed = false'), src.indexOf('const card = $('));
  assert.ok(gate.indexOf('passed = !allows(org') < gate.indexOf('recordEgress('), 'the row follows the policy check');
  assert.ok(gate.includes("if (passed && (!failure || failure.ms !== undefined || failure.code === 'POLICY_BLOCKED')) {"), 'a refused request (bad URL, policy) sent nothing, so it has no row');
  assert.match(src, /result\?\.redirected && result\.finalUrl\) recordEgress\(ledgerRow\('api', result\.finalUrl,/, 'D-1010-59: a followed redirect writes a second row for the landing host');
  reset();
  const body = JSON.stringify({ password: 'hunter2hunter2' });
  await E.recordEgress(E.ledgerRow('api', 'https://api.example.test/v1/things?x=1', body, { findingsCount: 0, scanned: false }));
  const [row] = local.egressLedger;
  assert.deepEqual({ kind: row.kind, host: row.host, bytes: row.bytes }, { kind: 'api', host: 'api.example.test', bytes: new TextEncoder().encode(body).length });
  assert.ok(!JSON.stringify(row).includes('hunter2'));
});

console.log('redirects (D-1010-54, r3-02-1)');

await t('a credentialed send does not follow a redirect to another port; a plain send still does; a policy allow-list also stops it', async () => {
  const http = await import('node:http');
  let hits = 0;
  const b = http.createServer((q, r) => { hits++; r.end('landed'); });
  await new Promise((r) => b.listen(0, '127.0.0.1', r));
  const a = http.createServer((q, r) => { r.writeHead(302, { location: `http://127.0.0.1:${b.address().port}/x` }); r.end(); });
  await new Promise((r) => a.listen(0, '127.0.0.1', r));
  const from = `http://127.0.0.1:${a.address().port}/start`;
  const saved = globalThis.fetch;
  globalThis.fetch = realFetch;
  try {
    await assert.rejects(() => E.fetchT(from, { headers: { Authorization: 'Bearer abcdefghijklmnop' } }), (e) => e.code === 'POLICY_BLOCKED' && e.key === 'redirect');
    await assert.rejects(() => E.fetchT(from, { headers: new Headers({ 'X-Api-Key': 'abcdefghijklmnop' }) }), (e) => e.code === 'POLICY_BLOCKED');
    assert.equal(hits, 0, 'the second port was never contacted');
    const plain = await E.fetchT(from, { headers: { Accept: 'text/plain' } });
    assert.equal(await plain.text(), 'landed', 'no credential and no policy: followed as before');
    assert.equal(hits, 1);
    E.useRedirectGuard(async () => true);
    await assert.rejects(() => E.fetchT(from, { headers: { Accept: 'text/plain' } }), (e) => e.code === 'POLICY_BLOCKED');
    assert.equal(hits, 1, 'a host allow-list stops the follow too');
  } finally {
    E.useRedirectGuard(null);
    globalThis.fetch = saved;
    a.close(); b.close();
  }
});

console.log('redirect guard for a credential in the URL (D-1010-184)');

await t('a 307 from a header-less webhook URL, a ?token= URL and a forced noRedirect is not followed; a plain URL still is', async () => {
  const http = await import('node:http');
  let hits = 0;
  const b = http.createServer((q, r) => { hits++; r.end('landed'); });
  await new Promise((r) => b.listen(0, '127.0.0.1', r));
  const a = http.createServer((q, r) => { r.writeHead(307, { location: `http://127.0.0.1:${b.address().port}/x` }); r.end(); });
  await new Promise((r) => a.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${a.address().port}`;
  const saved = globalThis.fetch;
  globalThis.fetch = realFetch;
  const blocked = (e) => e.code === 'POLICY_BLOCKED' && e.key === 'redirect';
  try {
    const body = JSON.stringify({ text: 'x' });
    await assert.rejects(() => E.fetchT(`${base}/services/T12345678/B12345678/abcdefghijklmnopqrstuvwx`, { method: 'POST', body }), blocked);
    await assert.rejects(() => E.fetchT(`${base}/hooks/abcdefghijklmnopqrstuvwxyz`, { method: 'POST', body }), blocked);
    await assert.rejects(() => E.fetchT(`${base}/1/cards?key=abc&token=def`, { method: 'POST', body }), blocked);
    await assert.rejects(() => E.fetchT(`${base}/hook?api_key=abcdef`, { method: 'POST', body }), blocked);
    await assert.rejects(() => E.fetchT(`${base}/plain`, { method: 'POST', body }, { noRedirect: true }), blocked);
    assert.equal(hits, 0, 'the second port was never contacted');
    const plain = await E.fetchT(`${base}/plain`, { method: 'GET' });
    assert.equal(await plain.text(), 'landed', 'no credential in the URL and no force: followed as before');
    assert.equal(hits, 1);
    const src = read('background/notify.js') + read('background/trackers.js');
    assert.match(read('background/notify.js'), /\}, \{ noRedirect: true \}\);/, 'notify forces noRedirect on a webhook post');
    assert.match(src, /noRedirect: label === 'Trello'/, 'the Trello path forces noRedirect');
  } finally {
    globalThis.fetch = saved;
    a.close(); b.close();
  }
});

console.log('mattermost markdown egress (r2-03-2, r2-11-5)');

/** Shared by the egress and notify checks: what a Mattermost post may and may not contain after page text went through it. */
const ZW = String.fromCharCode(0x200b);
const mmBad = (md) => {
  assert.ok(!/@(all|channel|here)/i.test(md), 'a live mention reached the post: ' + md);
  assert.ok(md.includes('@' + ZW) || md.includes('@' + ZW), 'the mention was not broken by a zero-width space');
  assert.ok(!/(^|[^\\])!\[/.test(md), 'an image reached the post: ' + md);
  assert.ok(!/\]\(javascript:/i.test(md), 'a javascript: link reached the post: ' + md);
};

await t('summaryMarkdown: @channel, an image, a javascript: link and a url with ) and a space are neutralised', async () => {
  const md = MM.summaryMarkdown(
    { title: '@channel ![](http://x) look', where: 'ping @all and @here', severity: 'high', priority: 'p1', counts: { failures: 1, events: 2, steps: 3 }, expected: '[a](javascript:alert(1))', actual: 'plain' },
    { Report: 'http://x.test/a)b c', Bad: 'javascript:alert(1)', Ok: 'https://ok.test/r' },
  );
  mmBad(md);
  assert.ok(md.includes('[Report](http://x.test/a%29b%20c)'), md);
  assert.ok(md.includes('[Ok](https://ok.test/r)'));
  assert.ok(!md.includes('](javascript') && md.includes('Bad'), 'an unsafe link falls back to the plain label');
});

await t('r3-14-4: the link target is percent-encoded for ( ) [ ] < > quotes, backtick and whitespace', async () => {
  const md = MM.summaryMarkdown({ title: 't', counts: {} }, { Odd: "http://x.test/a(b)c[d]e<f>g'h`i" + '"k l' });
  const at = md.indexOf('[Odd](');
  assert.ok(at >= 0, md);
  const target = md.slice(at + 6, md.indexOf(')', at + 6));
  for (const c of ['(', '[', ']', '<', '>', '"', "'", '`', ' ']) assert.ok(!target.includes(c), `a raw ${c} survived in the target: ${target}`);
  for (const code of ['%28', '%29', '%5B', '%5D']) assert.ok(md.includes(code), `${code} missing: ${md}`);
});

await t('the one rule is shared: mmText agrees with docshell mdEsc, docshell re-exports safeHref, and report/filing.js keeps an identical copy', async () => {
  const { mmText, safeHref } = await import('../core/events.js');
  const DS = await import('../core/docshell.js');
  for (const s of ['plain', 'a_b *c* [d](e)', 'see http://x.test and www.y.test\nnext line', '<b>x</b> | y ~z~']) assert.equal(mmText(s), DS.mdEsc(s), s);
  assert.equal(DS.safeHref, safeHref, 'docshell.js re-exports the events.js rule');
  const src = read('report/filing.js').match(/function safeHref\(u\) \{[\s\S]*?\n {2}\}/)[0];
  const copy = vm.runInNewContext(`(${src})`, { URL });
  for (const u of ['http://x/a)b c', 'javascript:alert(1)', 'mailto:a@b.c', 'tel:+1 2', '  https://ok.test/p?q=(1) ', 'data:text/html,x', 'not a url', 'HTTP://X.TEST/', null]) assert.equal(copy(u), safeHref(u), String(u));
});

console.log('r6-03-1: where the Jira and tracker sends are ledgered');

/** The two files that run only in the offscreen document (offscreen.js imports them), which has no chrome.storage: a ledger row written there is dropped. Their rows are written at the seam. */
const SEAM_LEDGERED = { 'background/jira.js': 'UQA_JIRA_*', 'background/trackers.js': 'UQA_TRACKER_FILE' };

await t('r6-03-1: every fetchT under background/ and platform/ passes a kind, or is on the named allow-list', () => {
  const unnamed = [];
  const seen = [];
  for (const dir of ['background', 'platform']) {
    for (const f of fs.readdirSync(path.join(EXT, dir)).filter((x) => x.endsWith('.js'))) {
      const rel = `${dir}/${f}`;
      const src = read(rel);
      const wrapper = /const fetchT = \(u, i, o\) => rawFetch\(u, i, \{ \.\.\.o, kind: '[a-z]+' \}\)/.test(src);
      for (const m of src.matchAll(/(?<![\w.])fetchT\(/g)) {
        const lineStart = src.lastIndexOf('\n', m.index) + 1;
        if (/^\s*(\*|\/\/|import|export)/.test(src.slice(lineStart, m.index + 8))) continue;
        let depth = 0, end = m.index + m[0].length - 1;
        for (; end < src.length; end++) { if (src[end] === '(') depth++; else if (src[end] === ')' && --depth === 0) break; }
        seen.push(rel);
        if (wrapper || /kind:\s*'/.test(src.slice(m.index, end)) || rel in SEAM_LEDGERED) continue;
        unnamed.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(unnamed, [], `fetchT with no kind and not allow-listed: ${unnamed.join(', ')}`);
  assert.ok(seen.includes('background/notify.js') && seen.includes('platform/chat-mattermost.js'), 'the scan found the kinded callers, so it is not vacuous');
  assert.ok(seen.includes('background/jira.js') && seen.includes('background/trackers.js'), 'and the allow-listed ones');
  for (const rel of Object.keys(SEAM_LEDGERED)) assert.ok(!/recordEgress|ledgerRow/.test(read(rel)), `${rel} is allow-listed because it writes no ledger row itself`);
  const off = read('offscreen/offscreen.js');
  assert.match(off, /import\('\.\.\/background\/jira\.js'\)/, 'the allow-list reason is true: jira.js loads only in the offscreen document');
  assert.match(off, /import\('\.\.\/background\/trackers\.js'\)/);
  assert.ok(!/^import .*'\.\/(jira|trackers)\.js'/m.test(workerSrc()), 'the worker never imports them, so a worker-side ledger write could not see these fetches');
});

await t('r6-03-1: a mocked Jira create ledgers exactly one row (host and bytes only) at the seam; in the offscreen document the fetch itself writes none', async () => {
  const { createIssue } = await import('../background/jira.js');
  const { recordSend } = await import('../background/notify.js');
  const cfg = { baseUrl: 'https://acme.atlassian.net', email: 'qa@example.test', token: 'tok_not_a_real_one', authMode: 'cloud' };
  const secretTitle = 'Checkout fails for jane@example.test';
  reset();
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response(JSON.stringify({ id: '10001', key: 'QA-1' }), { status: 201, headers: { 'content-type': 'application/json' } }); };
  E.useLedgerArea(undefined); // the offscreen document: chrome.storage does not exist there
  try {
    const made = await createIssue(cfg, { projectKey: 'QA', issueTypeName: 'Bug', summary: secretTitle, description: { type: 'doc', version: 1, content: [] } });
    assert.equal(made.key, 'QA-1');
  } finally { E.useLedgerArea(chrome.storage.local); }
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(new URL(sent[0].url).host, 'acme.atlassian.net');
  assert.equal(local.egressLedger, undefined, 'the offscreen fetch cannot write a row; that is why the seam does');
  await recordSend('jira', 'https://acme.atlassian.net', { summary: secretTitle, token: cfg.token });
  await settle();
  assert.equal(local.egressLedger.length, 1, 'one send, one row');
  const [row] = local.egressLedger;
  assert.equal(row.kind, 'jira');
  assert.equal(row.host, 'acme.atlassian.net');
  assert.ok(row.bytes > 0);
  assert.deepEqual(Object.keys(row).sort(), ['bytes', 'findingsCount', 'host', 'kind', 'scanned', 'ts']);
  const dump = JSON.stringify(local.egressLedger);
  assert.ok(!dump.includes('jane@example.test') && !dump.includes(cfg.token), 'host and bytes only: no title, no token');
  globalThis.fetch = realFetch;
});

await t('r7-02-1: a filing whose result says attachedBytes 3e6 writes one row of at least 3e6 bytes and no content', async () => {
  const { lift } = await import('./lib-lift.mjs');
  const send = new Function('ledgerRow', 'recordEgress', `${lift(workerSrc(), 'ledgerSend')}; return ledgerSend;`)(E.ledgerRow, E.recordEgress);
  reset();
  const msg = { type: 'UQA_JIRA_FILE', summary: 'Checkout fails for jane@example.test' };
  await send('UQA_JIRA_FILE', 'https://acme.atlassian.net', msg, { key: 'QA-9', attachedBytes: 3e6 });
  await settle();
  assert.equal(local.egressLedger.length, 1, 'one filing, one row');
  const [row] = local.egressLedger;
  assert.ok(row.bytes >= 3e6, `bytes ${row.bytes}`);
  assert.equal(row.kind, 'jira');
  assert.deepEqual(Object.keys(row).sort(), ['bytes', 'findingsCount', 'host', 'kind', 'scanned', 'ts']);
  assert.ok(!JSON.stringify(local.egressLedger).includes('jane@example.test'), 'no content');
  reset();
  await send('UQA_TRACKER_FILE', 'https://x.example', msg, {});
  await settle();
  assert.equal(local.egressLedger[0].bytes, new TextEncoder().encode(JSON.stringify(msg)).length, 'no attachments: the message size');
});

await t('r9-02-3 (D-209): the link checker refuses under an integrations-off policy, skips own-network hosts unless the tab is one, and the run writes one count row', async () => {
  const L = await import('../core/links.js');
  assert.equal(L.LIMIT, undefined, 'D-212: the dead LIMIT export is gone');
  const seen = [];
  const fetchImpl = async (u) => { seen.push(u); return { status: 200, url: u }; };
  await assert.rejects(() => L.checkAll(['https://a.test/'], { fetchImpl, policy: { integrationsAllowed: false } }), (e) => e.code === 'POLICY_BLOCKED');
  assert.equal(seen.length, 0, 'refused before anything is sent');
  const urls = ['https://a.test/', 'http://localhost:3000/', 'http://127.0.0.1/', 'http://[::1]/', 'http://10.1.2.3/', 'http://172.20.0.1/', 'http://172.32.0.1/', 'http://192.168.1.1/', 'http://169.254.1.1/', 'http://printer.local/'];
  const r = await L.checkAll(urls, { fetchImpl, policy: {}, tabUrl: 'https://a.test/page' });
  assert.deepEqual(seen.sort(), ['http://172.32.0.1/', 'https://a.test/'], 'only public hosts (172.32 is outside RFC1918) are asked');
  assert.ok(r[1] === undefined && r[9] === undefined && r[0].ok, 'skipped links are holes, which summariseLinks calls skipped');
  assert.equal(L.summariseLinks(urls.map((href) => ({ href })), r).skipped.length, 8);
  seen.length = 0;
  const same = await L.checkAll(['http://localhost:3000/a', 'http://192.168.1.1/'], { fetchImpl, tabUrl: 'http://localhost:3000/' });
  assert.deepEqual(seen, ['http://localhost:3000/a'], 'a localhost tab checks localhost, not the LAN');
  assert.ok(same[0].ok && same[1] === undefined);
  reset();
  await E.recordEgress(E.ledgerRow('link-check', 'https://a.test/page', '', { findingsCount: 0, scanned: false, count: 12 }));
  assert.deepEqual(local.egressLedger.map((x) => [x.kind, x.host, x.count, x.bytes]), [['link-check', 'a.test', 12, 0]]);
  const sw = workerSrc();
  assert.match(sw, /checkLinksAll\([^\n]*policy: await policy\(\), tabUrl: page\.url/);
  assert.match(sw, /ledgerRow\('link-check', page\.url, ''/);
});

await t('H1: a cross-origin link whose answer cannot be read is left unchecked, not reported broken; a readable one that fails still is', async () => {
  const L = await import('../core/links.js');
  const cors = async () => { throw new TypeError('Failed to fetch'); }; // what a CORS-blocked 200 looks like to fetch
  const blind = await L.checkUrl('https://live.test/', { fetchImpl: cors, canRead: async () => false });
  assert.deepEqual([blind.skipped, blind.reason, blind.ok, L.classify(blind)], [true, 'unreadable', false, 'skipped']);
  const dead = await L.checkUrl('https://dead.test/', { fetchImpl: cors, canRead: async () => true });
  assert.deepEqual([dead.skipped, dead.error, L.classify(dead)], [undefined, 'network error', 'broken'], 'with permission a network failure is real');
  const abort = async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); };
  const slow = await L.checkUrl('https://slow.test/', { fetchImpl: abort, canRead: async () => false });
  assert.equal(L.classify(slow), 'broken', 'no answer in time is still a failure');
  const nf = await L.checkUrl('https://cors.test/', { fetchImpl: async (u) => ({ status: 404, url: u, headers: new Headers() }), canRead: async () => false });
  assert.equal(L.classify(nf), 'broken', 'a readable 404 is broken');
  assert.match(workerSrc(), /checkLinksAll\([^\n]*canRead:/, 'the worker passes the permission check');
});

await t('J: unreadable links ask permission per site, inside the Allow press, for exactly those origins; refusing keeps them unchecked', async () => {
  const src = read('popup/tool-actions.js');
  const body = src.slice(src.indexOf('async function showLinks('), src.indexOf('/**\n * The tools whose used-mark is moved'));
  const rows = [
    { href: 'https://a.test/x', url: 'https://a.test/x', state: 'skipped', skipped: true, reason: 'unreadable' },
    { href: 'https://a.test/y', url: 'https://a.test/y', state: 'skipped', skipped: true, reason: 'unreadable' },
    { href: 'https://b.test:8443/z', url: 'https://b.test:8443/z', state: 'skipped', skipped: true, reason: 'unreadable' },
    { href: 'https://c.test/', url: 'https://c.test/', state: 'skipped', skipped: true, reason: 'secret-query' },
    { href: 'https://d.test/', url: 'https://d.test/', state: 'ok', ok: true },
  ];
  const result = { total: 5, checked: 1, checkable: 5, limited: false, broken: [], redirected: [], slow: [], rows };
  const make = ({ grant, policy = 'ask' }) => {
    const log = { said: [], asked: [], sent: [], stored: [], removed: [] };
    const env = {
      say: (text, tone, o = {}) => { log.said.push({ text, fix: o.fix }); },
      t: (k, v = {}) => `${k}${v.n ?? ''}`, plural: (n) => `${n} links`, framesRead: () => '1 frame', refresh: () => {},
      toolResult: async (res) => res.ok, siteAccess: { policy },
      send: async (m) => { log.sent.push(m); return { ok: true, result: { ...result, rows: rows.map((r) => ({ ...r, ...(m.only ? { skipped: undefined, reason: undefined, state: 'ok', ok: true } : {}) })) } }; },
      chrome: { permissions: { request: (o) => { log.asked.push(o); return Promise.resolve(grant); } }, storage: { session: { set: (o) => { log.stored.push(o); return Promise.resolve(); }, remove: (k) => { log.removed.push(k); return Promise.resolve(); } } } },
      ctx: { tabId: 7 },
    };
    const fns = new Function(...Object.keys(env), `${body}; return { showLinks, allowLinks };`)(...Object.values(env));
    return { ...fns, log };
  };
  // no press yet: a one-line prompt with an Allow button, and nothing asked
  let m = make({ grant: true });
  await m.showLinks({ ok: true, result });
  assert.equal(m.log.asked.length, 0, 'nothing is requested before the press');
  const fix = m.log.said[0].fix;
  assert.equal(fix.key, 'popup.links.allow');
  assert.match(m.log.said[0].text, /popup\.links\.need2$/, 'two sites, counted once each; the secret-query link is not asked for');
  // the press: the request is the first thing it does (synchronous), for exactly the origins, no <all_urls>
  const pending = fix.run();
  assert.deepEqual(m.log.asked, [{ origins: ['https://a.test/*', 'https://b.test:8443/*'] }], 'asked synchronously, exactly those origins');
  await pending;
  assert.deepEqual([m.log.stored.length, m.log.stored[0]['qaw.linksPending'].need.length, m.log.stored[0]['qaw.linksPending'].tabId, m.log.removed], [1, 2, 7, ['qaw.linksPending']], 'the pending Allow is kept for a popup the bubble closes, and dropped once answered');
  assert.equal(m.log.sent.length, 1);
  assert.deepEqual([m.log.sent[0].type, m.log.sent[0].only], ['UQA_CHECK_LINKS', ['https://a.test/*', 'https://b.test:8443/*']], 'only those links are checked again');
  assert.equal(m.log.sent[0].prev, rows, 'the earlier rows travel with it, so nothing else is re-checked');
  assert.equal(m.log.said.at(-1).fix, undefined, 'granted and re-checked: no prompt left');
  // refused: kept as not checked, said once, no second check, no button
  m = make({ grant: false });
  await m.showLinks({ ok: true, result });
  await m.log.said[0].fix.run();
  assert.equal(m.log.sent.length, 0, 'a refusal checks nothing');
  assert.match(m.log.said.at(-1).text, /popup\.links\.refused2$/);
  assert.equal(m.log.said.at(-1).fix, undefined);
  // an administrator's "not this site" removes the prompt
  m = make({ grant: true, policy: 'none' });
  await m.showLinks({ ok: true, result });
  assert.equal(m.log.said[0].fix, undefined);
  // the worker: only the named origins, merged over the earlier rows; it never requests, only a press can
  const sw = workerSrc();
  assert.match(sw, /msg\.only \? todo\.filter\(\(\[l\]\) => msg\.only\.includes\(org\(l\.href\)\)\) : todo/);
  assert.match(sw, /results\[i\] = prev\.get\(l\.href\)/);
  assert.ok(!/permissions\.request/.test(sw), 'the worker never requests');
  assert.ok(!src.includes("origins: ['<all_urls>']"), 'no <all_urls> request');
  // the strings exist as a pair
  const en = JSON.parse(read('platform/i18n/en.json')); const ar = JSON.parse(read('platform/i18n/ar.json'));
  for (const k of ['allow', 'need', 'refused']) assert.ok(en[`popup.links.${k}`] && ar[`popup.links.${k}`], k);
  assert.ok(en['popup.links.need'].trim().split(/\s+/).length <= 8);
});

await t('r10-03-1 (D-237): the link checker walks redirects by hand, re-checks every hop, and covers the wider own-network list', async () => {
  const L = await import('../core/links.js');
  const hop = (map, seen = []) => async (u, init) => {
    seen.push([u, init.redirect]);
    const to = map[u];
    return to ? { status: 302, url: u, headers: new Headers({ location: to }) } : { status: 200, url: u, headers: new Headers() };
  };
  // a public link that redirects into the tester's own network: the second hop is never requested
  for (const bad of ['http://192.168.1.1/admin', 'http://127.0.0.1:8080/', 'http://[::ffff:127.0.0.1]/', 'http://0.0.0.0/', 'http://100.64.0.1/', 'http://[fd12:3456::1]/', 'http://wiki.internal/', 'http://nas.lan/']) {
    const seen = [];
    const r = await L.checkUrl('https://pub.test/go', { fetchImpl: hop({ 'https://pub.test/go': bad }, seen) });
    assert.deepEqual(seen.map((s) => s[0]), ['https://pub.test/go'], `${bad} is not requested`);
    assert.ok(seen.every((s) => s[1] === 'manual'), 'redirect is manual');
    assert.equal(r.redirected, true);
    assert.equal(r.finalUrl, undefined, `${bad} does not land in the row`);
    assert.equal(r.ok, true);
  }
  // public hops are followed, at most five
  const seen = [];
  const chain = {}; for (let i = 0; i < 8; i++) chain[`https://p.test/${i}`] = `https://p.test/${i + 1}`;
  const long = await L.checkUrl('https://p.test/0', { fetchImpl: hop(chain, seen) });
  assert.equal(seen.length, 6, 'the first request plus five hops');
  assert.equal(long.ok, false);
  assert.match(long.error, /too many redirects/);
  const two = await L.checkUrl('https://p.test/a', { fetchImpl: hop({ 'https://p.test/a': 'https://q.test/b' }) });
  assert.deepEqual([two.ok, two.redirected, two.finalUrl], [true, true, 'https://q.test/b']);
  // Chrome hides the target of a manual redirect: reported as redirected, nothing else is requested
  const chrome = [];
  const opaque = await L.checkUrl('https://p.test/x', { fetchImpl: async (u) => { chrome.push(u); return { type: 'opaqueredirect', status: 0, url: '' }; } });
  assert.deepEqual([chrome.length, opaque.ok, opaque.redirected], [1, true, true]);
  // a link already in the own network may redirect inside it, not out of its class
  const lan = []; await L.checkUrl('http://192.168.1.2/a', { fetchImpl: hop({ 'http://192.168.1.2/a': 'http://192.168.1.3/b', 'http://192.168.1.3/b': 'http://127.0.0.1/' }, lan) });
  assert.deepEqual(lan.map((s) => s[0]), ['http://192.168.1.2/a', 'http://192.168.1.3/b']);
  // checkAll leaves the wider own-network hosts unrequested
  const asked = [];
  const wide = ['http://0.0.0.0/', 'http://[::ffff:127.0.0.1]/', 'http://100.64.0.1/', 'http://100.127.255.1/', 'http://[fc00::1]/', 'http://[fdab::1]/', 'http://x.internal/', 'http://x.lan/', 'http://100.128.0.1/', 'http://100.63.0.1/'];
  const out = await L.checkAll(wide, { fetchImpl: async (u) => { asked.push(u); return { status: 200, url: u }; }, tabUrl: 'https://a.test/' });
  assert.deepEqual(asked.sort(), ['http://100.128.0.1/', 'http://100.63.0.1/'], '100.64.0.0/10 ends at 100.127');
  assert.equal(out.filter(Boolean).length, 2);
});

await t('r10-03-2 (D-236): a link with a secret-named query parameter is returned as skipped and never requested', async () => {
  const L = await import('../core/links.js');
  const asked = [];
  const fetchImpl = async (u) => { asked.push(u); return { status: 200, url: u }; };
  const urls = ['https://a.test/reset?token=abc123', 'https://a.test/x?utm=1&api_key=k', 'https://a.test/logout?sig=zz', 'https://a.test/page?id=7'];
  const r = await L.checkAll(urls, { fetchImpl, tabUrl: 'https://a.test/' });
  assert.deepEqual(asked, ['https://a.test/page?id=7']);
  for (const i of [0, 1, 2]) assert.deepEqual([r[i].skipped, r[i].reason, r[i].ok], [true, 'secret-query', false]);
  const s = L.summariseLinks(urls.map((href) => ({ href })), r);
  assert.equal(s.skipped.length, 3, 'summariseLinks lists them as skipped, not broken');
  assert.equal(s.broken.length, 0);
  assert.equal(s.checked, 1);
  assert.equal(s.skipped[0].reason, 'secret-query', 'the reason reaches the row L4 renders');
});

await t('r9-06-4: a stalled ledger area is dropped after the deadline, counted, and the next row lands carrying the count', async () => {
  reset();
  const real = chrome.storage.local;
  let calls = 0;
  const flaky = { get: (k) => (++calls === 1 ? new Promise(() => {}) : real.get(k)), set: (o) => real.set(o) };
  E.useLedgerArea(flaky, 40);
  try {
    const t0 = Date.now();
    await E.recordEgress(E.ledgerRow('jira', 'https://a.test', 'x'));
    await E.recordEgress(E.ledgerRow('jira', 'https://b.test', 'x'));
    assert.ok(Date.now() - t0 < 1500, 'the chain is not held by the stalled get');
  } finally { E.useLedgerArea(real); }
  assert.deepEqual(local.egressLedger.map((x) => [x.host, x.dropped]), [['b.test', 1]], 'the first row was dropped and counted, the second carries it');
  reset();
  await E.recordEgress(E.ledgerRow('jira', 'https://c.test', 'x'));
  assert.equal(local.egressLedger[0].dropped, undefined, 'the count is cleared once reported');
});

await t('S2: the AI-writing send is a ledgered, opt-in egress (kind ai-write): only from core/ai-write.js, masked first, scanned flag set', async () => {
  const src = read('core/ai-write.js');
  assert.match(src, /fetchT\(url, init, \{ kind: EGRESS_KIND/);
  assert.match(src, /EGRESS_KIND = 'ai-write'/);
  assert.match(src, /const text = outboundText\(block\)/, 'the text is masked inside the sender, not only by the caller');
  assert.match(src, /noteScan\(EGRESS_KIND, 0\)/);
  assert.match(read('report/ai-suggest.js'), /suggest\(\{ provider: cfg\.provider/);
  assert.match(read('core/store-registry.js'), /loc\('aiWritingKey'/);
  local.egressLedger = [];
  globalThis.fetch = async () => ({ status: 200, headers: new Headers(), json: async () => ({ content: [{ type: 'text', text: '{"title":"T","steps":["a"]}' }] }) });
  const W = await import('../core/ai-write.js');
  await W.suggest({ provider: 'anthropic', key: 'made-up-key-0000', block: 'Steps: open the page' });
  const row = local.egressLedger.at(-1);
  assert.equal(row.kind, 'ai-write');
  assert.equal(row.host, 'api.anthropic.com');
  assert.equal(row.scanned, true);
  assert.ok(!JSON.stringify(row).includes('open the page'), 'no content in the ledger');
});

console.log(`\n${n} passed, 0 failed`);
