/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Devil points 3, 4, 7, 8, 14 (integrations and filing), 29 Sept 2026.
 *
 *   node tools/test-devil-b.mjs
 *
 * Mock servers only: `fetch` is replaced, nothing reaches a network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const realFetch = globalThis.fetch;
let calls = [];
let handler = async () => ({ status: 200, body: {} });
const abortable = (init, p) => new Promise((resolve, reject) => {
  init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  p.then(resolve, reject);
});
globalThis.fetch = (url, init = {}) => {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const rec = { url: String(url), method: (init.method || 'GET').toUpperCase(), headers: init.headers || {}, raw: isForm ? '' : String(init.body ?? ''), isForm, files: isForm ? [...init.body.entries()].map(([k, v]) => v?.name) : [] };
  calls.push(rec);
  return abortable(init, Promise.resolve(handler(rec)).then((r) => ({
    ok: r.status < 400, status: r.status,
    headers: { get: (k) => (r.headers || {})[k.toLowerCase()] ?? null },
    text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})),
  })));
};
const reset = (h) => { calls = []; handler = h || (async () => ({ status: 200, body: {} })); };
const never = () => new Promise(() => {});

const { fetchT, HttpTimeout } = await import('../core/http.js');
const trackers = await import('../background/trackers.js');
const jira = await import('../background/jira.js');
const notify = await import('../background/notify.js');
const { unscannedNames } = await import('../core/secret-scan.js');

const CANARY = 'Bearer canaryTOKEN0123456789abcdefXYZ';
const canaryBody = `Steps.\nauthorization: ${CANARY}\nand in prose ${CANARY} again`;

console.log('\n7 - one fetch: timeout, 429 on reads only');

await test('a hung server times out instead of holding the dialog', async () => {
  reset(never);
  const t0 = Date.now();
  await assert.rejects(fetchT('https://x.test/a', {}, { timeoutMs: 60 }), (e) => e instanceof HttpTimeout && e.timeout);
  assert.ok(Date.now() - t0 < 1500);
});
await test('429 + Retry-After on a GET is honoured once; on a POST it is never re-sent', async () => {
  let n = 0;
  reset(async () => (++n === 1 ? { status: 429, headers: { 'retry-after': '0' } } : { status: 200, body: {} }));
  assert.equal((await fetchT('https://x.test/g')).status, 200);
  assert.equal(calls.length, 2);
  reset(async () => ({ status: 429, headers: { 'retry-after': '0' } }));
  assert.equal((await fetchT('https://x.test/p', { method: 'POST', body: '{}' })).status, 429);
  assert.equal(calls.length, 1, 'a create is never repeated by the helper');
});
await test('a tracker create that hangs or is rate-limited is sent once, with a message that says so', async () => {
  reset(async () => ({ status: 429, headers: { 'retry-after': '7' }, body: { message: 'slow down' } }));
  await assert.rejects(trackers.fileIssue('github', { token: 'ghp_x', repo: 'a/b' }, { title: 't', body: 'b' }), /429[\s\S]*try again in 7 s[\s\S]*nothing was created twice/);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  // YouTrack's Type retry must not fire on a 429 or a network failure.
  reset(async (r) => (r.url.includes('/admin/projects') ? { status: 200, body: [{ id: '0-1', shortName: 'QA' }] } : { status: 429 }));
  await assert.rejects(trackers.fileIssue('youtrack', { token: 't', host: 'https://yt.test', shortName: 'QA' }, { title: 't', body: 'b' }), /429/);
  assert.equal(calls.filter((c) => c.url.endsWith('/api/issues?fields=id,idReadable')).length, 1, 'no second create');
});
await test('a chat broadcast runs the destinations together and keeps their order', async () => {
  reset(async () => { await new Promise((r) => setTimeout(r, 250)); return { status: 200, body: 'ok' }; });
  const d = (n) => ({ label: n, provider: 'slack', url: `https://hooks.slack.com/services/T/B/${n}${n}${n}${n}${n}${n}` });
  const t0 = Date.now();
  const out = await notify.broadcast([d('a'), d('b'), d('c')], { severity: 'major', title: 't', on: null });
  assert.deepEqual(out.map((o) => o.label), ['a', 'b', 'c']);
  assert.ok(Date.now() - t0 < 600, `took ${Date.now() - t0} ms: sequential`);
});

console.log('\n3 - every tracker filing passes the secret gate');

await test('a canary Bearer string never reaches a GitHub body; the count is reported', async () => {
  reset(async () => ({ status: 201, body: { number: 5, html_url: 'https://github.com/a/b/issues/5' } }));
  const r = await trackers.fileIssue('github', { token: 'ghp_' + 'a'.repeat(36), repo: 'a/b' }, { title: `Login ${CANARY}`, body: canaryBody });
  const sentText = calls.map((c) => c.raw).join('\n');
  assert.ok(!sentText.includes('canaryTOKEN0123456789'), 'the canary reached the wire');
  assert.match(sentText, /\[REDACTED\]/);
  assert.ok(r.redacted >= 2);
});
await test('all nine trackers: neither the canary nor the tracker\'s own token is ever sent', async () => {
  for (const t of trackers.TRACKERS) {
    const cfg = Object.fromEntries(t.needs.map((n) => [n.key, n.secret ? 'OWNSECRET-' + t.id + '-0123456789' : 'x1']));
    reset(async () => ({ status: 201, body: { id: '1', number: 1, iid: 1, data: { gid: '1' }, idReadable: 'A-1', issueCreate: { issue: { identifier: 'A-1', url: 'u' } } } }));
    await trackers.fileIssue(t.id, cfg, { title: 'x', body: `${canaryBody}\nkey OWNSECRET-${t.id}-0123456789`, target: '1' }).catch(() => {});
    // The body of every create/update call; auth lives in headers, which are the tracker's own business.
    const bodies = calls.filter((c) => c.method !== 'GET').map((c) => c.raw).join('\n');
    assert.ok(!bodies.includes('canaryTOKEN'), `${t.id}: canary sent`);
    assert.ok(!bodies.includes('OWNSECRET-'), `${t.id}: its own token sent in the body`);
  }
});
await test('a text attachment is redacted, media is named unscanned and left alone', async () => {
  const files = [
    { filename: 'net.har', blob: new Blob([`x ${CANARY}`], { type: 'application/json' }) },
    { filename: 's.png', blob: new Blob([new Uint8Array([1, 2])], { type: 'image/png' }) },
  ];
  assert.deepEqual(await unscannedNames(files), ['s.png']);
  const up = [];
  reset(async (r) => { if (r.isForm) up.push(r); return { status: 200, body: r.method === 'POST' && !r.isForm ? { id: 'c1', url: 'u', shortUrl: 'u', idShort: 3 } : {} }; });
  const r = await trackers.fileIssue('trello', { key: 'k', token: 'TRELLOTOKEN0123456789', list: 'L' }, { title: 't', body: 'b', attachments: files });
  assert.deepEqual(r.unscanned, ['s.png']);
  assert.equal(up.length, 2);
  assert.ok(r.redacted >= 1, 'redaction inside the file is counted');
});

console.log('\n8 - attachments, or an honest "not attached"');

await test('trello, clickup and asana upload every file once; only github says it cannot (gitlab, azure and linear have their own tests in test-devil-r2-i1)', async () => {
  const cat = Object.fromEntries(trackers.trackerCatalogue().map((t) => [t.id, t.attach]));
  assert.deepEqual(Object.keys(cat).filter((k) => cat[k]).sort(), ['asana', 'azure', 'clickup', 'gitlab', 'linear', 'shortcut', 'trello', 'youtrack']);
  const files = [1, 2].map((i) => ({ filename: `s${i}.png`, blob: new Blob([new Uint8Array([i])], { type: 'image/png' }) }));
  const plan = { trello: { key: 'k', token: 'tok', list: 'L' }, clickup: { token: 'tok', list: 'L' }, asana: { token: 'tok', project: 'P' } };
  for (const [id, cfg] of Object.entries(plan)) {
    reset(async (r) => ({ status: 200, body: r.isForm ? {} : { id: 'i1', gid: 'i1', idShort: 1, url: 'u', shortUrl: 'u', data: { gid: 'i1' } } }));
    const r = await trackers.fileIssue(id, cfg, { title: 't', body: 'b', attachments: files });
    assert.equal(calls.filter((c) => c.isForm).length, 2, id);
    assert.equal(r.attachSupported, true);
    assert.deepEqual(r.attached.map((a) => a.ok), [true, true], id);
  }
  reset(async () => ({ status: 201, body: { number: 1, html_url: 'u' } }));
  const g = await trackers.fileIssue('github', { token: 'ghp_x', repo: 'a/b' }, { title: 't', body: 'b', attachments: files });
  assert.equal(g.attachSupported, false);
  assert.equal(calls.filter((c) => c.isForm).length, 0);
});
await test('the dialog states it before Create and the result reads D.done.attached', async () => {
  const src = readFileSync(join(here, '..', 'report/filing.js'), 'utf8');
  assert.match(src, /D\.tr\.attach \? 'report\.f\.trSent' : 'report\.f\.trSentText'/);
  assert.match(src, /report\.f\.noAttach', \{ name: D\.tr\.label/);
  assert.match(src, /r\.attached \|\| \[\]/);
  assert.match(src, /report\.f\.mediaUnscanned/);
  const loc = JSON.parse(readFileSync(join(here, 'fixtures', 'locale-B.json'), 'utf8'));
  for (const k of Object.keys(loc.en)) assert.ok(loc.ar[k], `ar is missing ${k}`);
  for (const k of ['report.f.mediaUnscanned', 'report.f.noAttach', 'report.f.noAttachDone', 'report.f.trSentText']) assert.ok(loc.en[k], k);
});

console.log('\n4 - Jira attachments: limit, retry, once per suite');

const cloud = { baseUrl: 'https://mock.atlassian.net', email: 'qa@example.test', token: 'fixture-token', project: 'QAW' };
const big = () => ({ filename: 'video.webm', blob: new Blob([new Uint8Array(12 * 1048576)], { type: 'video/webm' }) });
const small = (n = 's.png') => ({ filename: n, blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) });

await test('a 12 MB video over the site limit is not uploaded, and says why', async () => {
  reset(async (r) => (r.url.endsWith('/attachment/meta') ? { status: 200, body: { enabled: true, uploadLimit: 10485760 } } : { status: 200, body: [{}] }));
  const out = await jira.attachFiles(cloud, 'QAW-1', [big(), small()]);
  assert.equal(out[0].ok, false);
  assert.match(out[0].error, /12\.0 MB.*10\.0 MB/);
  assert.equal(out[1].ok, true);
  assert.equal(calls.filter((c) => c.isForm).length, 1, 'only the small file went out');
});
await test('one retry after a dropped connection, none after an HTTP refusal', async () => {
  let n = 0;
  reset(async (r) => { if (r.url.endsWith('/attachment/meta')) return { status: 404 }; if (++n === 1) throw new Error('socket hang up'); return { status: 200, body: [{}] }; });
  const out = await jira.attachFiles(cloud, 'QAW-1', [small()]);
  assert.equal(out[0].ok, true);
  assert.equal(calls.filter((c) => c.isForm).length, 2);
  reset(async (r) => (r.url.endsWith('/attachment/meta') ? { status: 404 } : { status: 413, body: { errorMessages: ['too large'] } }));
  const bad = await jira.attachFiles(cloud, 'QAW-1', [small()]);
  assert.equal(bad[0].ok, false);
  assert.equal(calls.filter((c) => c.isForm).length, 1, 'a refusal is not retried');
});
await test('a suite uploads its evidence once, however many steps ask for it', async () => {
  let n = 0;
  reset(async (r) => {
    if (r.url.endsWith('/issue') && r.method === 'POST') return { status: 201, body: { key: `QAW-${++n}`, id: String(n) } };
    if (r.url.includes('/issuelinktype')) return { status: 200, body: { issueLinkTypes: [{ name: 'Relates' }] } };
    return { status: 200, body: {} };
  });
  const doc = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }] };
  const steps = ['A', 'B', 'C'].map((ref) => ({ ref, kind: 'defect', summary: ref, typeName: 'Bug', labels: [], adf: doc, evidence: true }));
  const r = await jira.fileSuite(cloud, { project: 'QAW', steps, sessionId: 's', attach: { screenshots: true }, known: [] }, { buildFiles: async () => ({ files: [small('a.png'), small('b.png')], failed: [] }) });
  assert.equal(calls.filter((c) => c.isForm).length, 2, 'two files, uploaded once');
  assert.deepEqual(r.created.map((c) => c.attachments.length), [2, 2, 2]);
  assert.equal(r.created[1].attachments[0].sameAs, 'QAW-1');
  assert.deepEqual(r.unscanned, ['a.png', 'b.png']);
});

console.log('\n14 - dedupe that reads Arabic');

await test('an Arabic summary yields terms; spelling variants share a label', () => {
  const a = jira.fingerprint({ url: 'https://app.test/pay', summary: 'زر الدفع لا يعمل عند إرسال الطلب' });
  assert.ok(a.terms.length >= 3, JSON.stringify(a.terms));
  assert.ok(a.terms.every((w) => /\p{L}/u.test(w)));
  const v1 = jira.fingerprint({ url: 'https://app.test/pay', summary: 'إرسال الفاتورة يفشل في الصفحة الرئيسية' });
  const v2 = jira.fingerprint({ url: 'https://app.test/pay', summary: 'ارسال الفاتورة يفشل في الصفحه الرئيسيه' });
  assert.equal(v1.label, v2.label, 'alef and taa-marbuta variants must not split a duplicate');
});
await test('English behaviour is unchanged: 4+ letters, stop words out, mixed script kept', () => {
  const f = jira.fingerprint({ url: 'https://a.test/x/123', summary: 'The Pay button does nothing on checkout 2FA' });
  assert.deepEqual(f.terms, ['button', 'nothing', 'checkout']);
  assert.equal(f.path, '/x/:id');
  assert.ok(jira.fingerprint({ summary: 'زر checkout الدفع' }).terms.includes('checkout'));
});

globalThis.fetch = realFetch;
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
