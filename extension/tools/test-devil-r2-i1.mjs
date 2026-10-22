/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Round 2, lane I1: secret scan inside zips (4), attachments for GitLab, Azure
 * DevOps and Linear (8), tracker duplicate search by fingerprint label (14).
 * A stub fetch records every call; nothing touches the network.
 */
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.stack}`); }
}

let calls = [];
let handler = async () => ({ status: 200, body: {} });
globalThis.fetch = async (url, init = {}) => {
  const isForm = init.body instanceof FormData;
  const isBlob = init.body instanceof Blob;
  const rec = {
    url: String(url), method: init.method || 'GET', headers: init.headers || {}, isForm, isBlob,
    body: isForm || isBlob ? null : (init.body ? JSON.parse(init.body) : null),
    blob: isBlob ? init.body : isForm ? [...init.body.entries()][0]?.[1] : null,
  };
  calls.push(rec);
  const r = await handler(rec);
  return { ok: r.status < 400, status: r.status, headers: new Headers(), text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
};
const reset = (h) => { calls = []; handler = h || (async () => ({ status: 200, body: {} })); };

const { fileIssue } = await import('../background/trackers.js');
const { readZip } = await import('../core/zip-read.js');
const { zipStored, crc32 } = await import('../core/xlsx.js');
const { redactFile, unscannedNames, fileTexts } = await import('../core/secret-scan.js');
const { scanFiles } = await import('../background/jira.js');
const { fingerprint } = await import('../core/fingerprint.js');

const CANARY = 'Bearer canaryTOKEN0123456789abcdefXYZ';
const har = JSON.stringify({ log: { entries: [{ request: { headers: [{ name: 'x', value: CANARY }] } }] } });
const shot = (n) => ({ filename: `s${n}.png`, blob: new Blob([new Uint8Array([n, 2, 3])], { type: 'image/png' }) });
const zipFile = (entries, name = 'evidence.zip') => ({ filename: name, blob: new Blob([zipStored(entries)], { type: 'application/zip' }) });
const blobText = async (b) => new TextDecoder().decode(new Uint8Array(await b.arrayBuffer()));

/** A one-entry zip whose entry is deflated, hand-built (the reader must inflate it). */
function deflateZip(name, text) {
  const raw = Buffer.from(text);
  const comp = zlib.deflateRawSync(raw);
  const nm = Buffer.from(name);
  const h = (fields) => Buffer.concat(fields.map(([v, n]) => { const b = Buffer.alloc(n); n === 4 ? b.writeUInt32LE(v) : b.writeUInt16LE(v); return b; }));
  const local = Buffer.concat([h([[0x04034b50, 4], [20, 2], [0, 2], [8, 2], [0, 2], [0, 2], [crc32(raw), 4], [comp.length, 4], [raw.length, 4], [nm.length, 2], [0, 2]]), nm, comp]);
  const central = Buffer.concat([h([[0x02014b50, 4], [20, 2], [20, 2], [0, 2], [8, 2], [0, 2], [0, 2], [crc32(raw), 4], [comp.length, 4], [raw.length, 4], [nm.length, 2], [0, 2], [0, 2], [0, 2], [0, 2], [0, 4], [0, 4]]), nm]);
  const end = h([[0x06054b50, 4], [0, 2], [0, 2], [1, 2], [1, 2], [central.length, 4], [local.length, 4], [0, 2]]);
  return new Uint8Array(Buffer.concat([local, central, end]));
}

console.log('point 4 - secrets inside zips');

await test('the reader inflates a deflate entry and reads a stored one', async () => {
  const d = await readZip(deflateZip('a.har', har));
  assert.equal(d[0].name, 'a.har');
  assert.equal(new TextDecoder().decode(d[0].data), har);
  const s = await readZip(zipStored([{ name: 'n.txt', data: 'hello' }]));
  assert.equal(new TextDecoder().decode(s[0].data), 'hello');
});

await test('a zip holding a HAR with a Bearer token is redacted, the rest of the zip is intact', async () => {
  const f = zipFile([{ name: 'net.har', data: har }, { name: 'log.txt', data: 'clean line' }, { name: 'shot.png', data: new Uint8Array([9, 9]) }]);
  const out = await redactFile(f, []);
  assert.ok(out.redacted >= 1);
  const entries = await readZip(new Uint8Array(await out.blob.arrayBuffer()));
  const by = Object.fromEntries(entries.map((e) => [e.name, e.data]));
  const har2 = new TextDecoder().decode(by['net.har']);
  assert.ok(!har2.includes('canaryTOKEN'), 'canary gone');
  assert.ok(har2.includes('[REDACTED]'));
  assert.equal(new TextDecoder().decode(by['log.txt']), 'clean line');
  assert.deepEqual([...by['shot.png']], [9, 9]);
});

await test('a zip is named unscanned only when it holds media or cannot be read', async () => {
  assert.deepEqual(await unscannedNames([zipFile([{ name: 'a.txt', data: 'x' }])]), []);
  assert.deepEqual(await unscannedNames([zipFile([{ name: 'a.txt', data: 'x' }, { name: 'i.png', data: new Uint8Array([1]) }])]), ['evidence.zip']);
  assert.deepEqual(await unscannedNames([{ filename: 'bad.zip', blob: new Blob([new Uint8Array([1, 2, 3])]) }, shot(1)]), ['bad.zip', 's1.png']);
});

await test('Jira scanFiles sees the canary inside a zip', async () => {
  const found = await scanFiles([zipFile([{ name: 'net.har', data: har }])]);
  assert.ok(found.length && found[0].field === 'attachment:evidence.zip!net.har', JSON.stringify(found));
  assert.equal((await fileTexts(shot(1))).length, 0);
});

await test('a tracker upload of that zip carries the redacted archive and reports the count', async () => {
  reset(async (r) => (r.url.endsWith('/uploads') ? { status: 201, body: { markdown: '![z](/u/z)' } } : { status: 201, body: { id: 5, iid: 3, web_url: 'u' } }));
  const out = await fileIssue('gitlab', { host: 'https://g.example', token: 'glpat-x', project: '1' }, { dedupe: false, title: 'T', body: 'B', attachments: [zipFile([{ name: 'net.har', data: har }])] });
  const up = calls.find((c) => c.url.endsWith('/uploads'));
  const inner = await readZip(new Uint8Array(await up.blob.arrayBuffer()));
  assert.ok(!new TextDecoder().decode(inner[0].data).includes('canaryTOKEN'));
  assert.ok(out.redacted >= 1);
  assert.deepEqual(out.unscanned, []);
});

console.log('point 8 - attach for GitLab, Azure DevOps, Linear');

await test('GitLab: one upload per file, then one description edit carrying both snippets', async () => {
  reset(async (r) => {
    if (r.url.endsWith('/uploads')) return { status: 201, body: { markdown: `![f](/uploads/${calls.length}/f.png)` } };
    return { status: 201, body: { id: 900, iid: 12, web_url: 'https://g.example/p/-/issues/12' } };
  });
  const out = await fileIssue('gitlab', { host: 'https://g.example', token: 'glpat-x', project: '42' }, { dedupe: false, title: 'T', body: 'Body', attachments: [shot(1), shot(2)] });
  assert.equal(calls.filter((c) => c.url.endsWith('/projects/42/uploads')).length, 2);
  assert.equal(calls.find((c) => c.url.endsWith('/uploads')).headers['private-token'], 'glpat-x');
  const put = calls.filter((c) => c.method === 'PUT');
  assert.equal(put.length, 1);
  assert.ok(put[0].url.endsWith('/projects/42/issues/12'));
  assert.ok(put[0].body.description.startsWith('Body\n\n') && put[0].body.description.split('![f]').length === 3);
  assert.equal(out.attachSupported, true);
  assert.deepEqual(out.attached.map((a) => a.ok), [true, true]);
});

await test('Azure DevOps: one octet-stream upload per file, one patch adding two AttachedFile relations', async () => {
  reset(async (r) => {
    if (r.url.includes('/_apis/wit/attachments')) return { status: 201, body: { id: 'a', url: `https://dev.azure.com/o/_apis/wit/attachments/${calls.length}` } };
    if (r.method === 'PATCH') return { status: 200, body: { id: 77 } };
    return { status: 200, body: { id: 77, _links: { html: { href: 'https://dev.azure.com/o/p/_workitems/edit/77' } } } };
  });
  const out = await fileIssue('azure', { org: 'o', project: 'p', token: 't' }, { dedupe: false, title: 'T', body: 'B', attachments: [shot(1), shot(2)] });
  const ups = calls.filter((c) => c.url.includes('/_apis/wit/attachments'));
  assert.equal(ups.length, 2);
  assert.match(ups[0].url, /fileName=s1\.png&api-version=7\.0/);
  assert.equal(ups[0].headers['content-type'], 'application/octet-stream');
  assert.ok(ups[0].isBlob);
  const patch = calls.filter((c) => c.method === 'PATCH');
  assert.equal(patch.length, 1);
  assert.ok(patch[0].url.includes('/workitems/77?'));
  assert.equal(patch[0].headers['content-type'], 'application/json-patch+json');
  assert.deepEqual(patch[0].body.map((o) => [o.op, o.path, o.value.rel]), [['add', '/relations/-', 'AttachedFile'], ['add', '/relations/-', 'AttachedFile']]);
  assert.deepEqual(out.attached.map((a) => a.ok), [true, true]);
});

const linearReply = (extra = {}) => async (r) => {
  const q = r.body?.query || '';
  if (r.method === 'PUT') return { status: 200, body: {} };
  if (q.includes('teams(')) return { status: 200, body: { data: { teams: { nodes: [{ id: 'T1', key: 'ENG', name: 'Eng' }] } } } };
  if (q.includes('fileUpload')) return { status: 200, body: { data: { fileUpload: { success: true, uploadFile: { uploadUrl: 'https://storage.example/put?sig=1', assetUrl: 'https://uploads.linear.app/x', headers: [{ key: 'x-goog-meta', value: 'm' }] } } } } };
  if (q.includes('attachmentCreate')) return { status: 200, body: { data: { attachmentCreate: { success: true } } } };
  if (q.includes('issueCreate')) return { status: 200, body: { data: { issueCreate: { success: true, issue: { id: 'iss1', identifier: 'ENG-7', url: 'https://linear.app/x/ENG-7' } } } } };
  if (extra[q.split(/[ (]/)[1]]) return extra[q.split(/[ (]/)[1]](r);
  if (q.includes('issueLabels')) return { status: 200, body: { data: { issueLabels: { nodes: [] } } } };
  if (q.includes('issueLabelCreate')) return { status: 200, body: { data: { issueLabelCreate: { success: true, issueLabel: { id: 'L1' } } } } };
  if (q.includes('issues(')) return { status: 200, body: { data: { issues: { nodes: [] } } } };
  return { status: 200, body: { data: {} } };
};

await test('Linear: signed URL per file, PUT with the returned headers, attachmentCreate per file', async () => {
  reset(linearReply());
  const out = await fileIssue('linear', { token: 'lin_x', team: 'ENG' }, { dedupe: false, title: 'T', body: 'B', attachments: [shot(1), shot(2)] });
  assert.equal(calls.filter((c) => (c.body?.query || '').includes('fileUpload')).length, 2);
  const puts = calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(puts[0].headers['x-goog-meta'], 'm');
  assert.equal(puts[0].headers['content-type'], 'image/png');
  assert.ok(puts[0].isBlob);
  const links = calls.filter((c) => (c.body?.query || '').includes('attachmentCreate'));
  assert.equal(links.length, 2);
  assert.equal(links[0].body.variables.input.issueId, 'iss1');
  assert.deepEqual(out.attached.map((a) => a.ok), [true, true]);
});

await test('a refused upload is reported for that file and the issue still stands', async () => {
  reset(async (r) => (r.url.includes('/_apis/wit/attachments') ? { status: 413, body: { message: 'too large' } } : { status: 200, body: { id: 5 } }));
  const out = await fileIssue('azure', { org: 'o', project: 'p', token: 't' }, { dedupe: false, title: 'T', body: 'B', attachments: [shot(1)] });
  assert.equal(out.key, '#5');
  assert.equal(out.attached[0].ok, false);
  assert.match(out.attached[0].error, /too large/);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
});

console.log('point 14 - duplicate search by fingerprint label');

const FP = fingerprint({ url: 'https://s.example/login', summary: 'Login button does nothing' }).label;
const args = { title: 'Login button does nothing', body: 'B', url: 'https://s.example/login' };

await test('GitHub: a search hit returns the existing issue and creates nothing; a miss labels the new one', async () => {
  reset(async (r) => (r.url.includes('/search/issues') ? { status: 200, body: { items: [{ number: 9, html_url: 'https://github.com/a/b/issues/9' }] } } : { status: 201, body: { number: 10, html_url: 'h' } }));
  const out = await fileIssue('github', { token: 't', repo: 'a/b' }, args);
  assert.equal(out.duplicate, true);
  assert.equal(out.key, '#9');
  assert.ok(decodeURIComponent(calls[0].url).includes(`label:"${FP}"`));
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  reset(async (r) => (r.url.includes('/search/issues') ? { status: 200, body: { items: [] } } : { status: 201, body: { number: 10, html_url: 'h' } }));
  const out2 = await fileIssue('github', { token: 't', repo: 'a/b' }, { ...args, labels: ['qa-wrap'] });
  assert.ok(!out2.duplicate);
  assert.deepEqual(calls.find((c) => c.method === 'POST').body.labels, ['qa-wrap', FP]);
});

await test('GitLab: labels= search for opened issues; the create carries the label', async () => {
  reset(async (r) => (r.method === 'GET' ? { status: 200, body: [{ iid: 4, id: 40, web_url: 'https://g.example/-/issues/4' }] } : { status: 201, body: { iid: 5, id: 50, web_url: 'w' } }));
  const cfg = { host: 'https://g.example', token: 't', project: '1' };
  const out = await fileIssue('gitlab', cfg, args);
  assert.equal(out.duplicate, true);
  assert.equal(out.key, '#4');
  assert.match(calls[0].url, new RegExp(`labels=${FP}&state=opened`));
  assert.equal(calls.length, 1);
  reset(async (r) => (r.method === 'GET' ? { status: 200, body: [] } : { status: 201, body: { iid: 5, id: 50, web_url: 'w' } }));
  await fileIssue('gitlab', cfg, { ...args, labels: ['qa-wrap'] });
  assert.equal(calls.find((c) => c.method === 'POST').body.labels, `qa-wrap,${FP}`);
});

await test('Azure DevOps: WIQL on the tag; the create carries the tag', async () => {
  reset(async (r) => (r.url.includes('/wiql') ? { status: 200, body: { workItems: [{ id: 31 }] } } : { status: 200, body: { id: 32 } }));
  const cfg = { org: 'o', project: 'p', token: 't' };
  const out = await fileIssue('azure', cfg, args);
  assert.equal(out.duplicate, true);
  assert.equal(out.key, '#31');
  assert.ok(calls[0].body.query.includes(`[System.Tags] CONTAINS '${FP}'`));
  assert.equal(calls.length, 1);
  reset(async (r) => (r.url.includes('/wiql') ? { status: 200, body: { workItems: [] } } : { status: 200, body: { id: 32 } }));
  await fileIssue('azure', cfg, args);
  const create = calls.find((c) => c.url.includes('/workitems/$'));
  assert.equal(create.body.find((o) => o.path === '/fields/System.Tags').value, FP);
});

await test('Linear: an issues filter on the label; a miss creates the label and files with its id', async () => {
  reset(linearReply({ D: async () => ({ status: 200, body: { data: { issues: { nodes: [{ id: 'i9', identifier: 'ENG-3', url: 'https://linear.app/x/ENG-3' }] } } } }) }));
  const out = await fileIssue('linear', { token: 't', team: 'ENG' }, args);
  assert.equal(out.duplicate, true);
  assert.equal(out.key, 'ENG-3');
  assert.equal(calls.filter((c) => (c.body?.query || '').includes('issueCreate')).length, 0);
  reset(linearReply());
  const out2 = await fileIssue('linear', { token: 't', team: 'ENG' }, args);
  assert.ok(!out2.duplicate);
  const create = calls.find((c) => (c.body?.query || '').includes('mutation Create'));
  assert.deepEqual(create.body.variables.input.labelIds, ['L1']);
  assert.equal(calls.find((c) => (c.body?.query || '').includes('issueLabelCreate')).body.variables.input.name, FP);
});

await test('a search that fails never blocks filing; the create is sent exactly once', async () => {
  reset(async (r) => (r.url.includes('/search/issues') ? { status: 500, body: { message: 'down' } } : { status: 201, body: { number: 1, html_url: 'h' } }));
  const out = await fileIssue('github', { token: 't', repo: 'a/b' }, args);
  assert.equal(out.key, '#1');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
});

await test('trackers without a label search are not searched, and get no fingerprint label', async () => {
  reset(async () => ({ status: 200, body: { id: 'c1', idShort: 1, shortUrl: 'u' } }));
  await fileIssue('trello', { key: 'k', token: 't', list: 'L' }, args);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
