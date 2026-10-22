/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * test-pipeline-sweep.mjs — the safety rules of the button sweeps (P4, spec S3/S4/S5), without a browser.
 *   node tools/test-pipeline-sweep.mjs   (run from extension/)
 *
 * Proves: the classifier puts a control in its class before it is pressed (href scheme, handler names, the old hand list now
 * derived, unclassified is refused, the allow-list never holds an outward key); the sweep guard records and does not forward
 * window.close / tabs.remove / non-loopback opens; chunks never exceed 60; the sweep is a dry-run unless told otherwise.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recycle } from './lib-trash.mjs';
import { BASE_PER_CHUNK, CHUNK_MAX, classify, classifyHref, clampChunk, loadSafe, normKey, planSlices, settle, sweepGuard, writeRunResult } from './lib-sweep.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failed++; console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 3).join('\n       ')}`); }
};
const ctl = (o) => ({ key: `${o.tag || 'button'}${o.id ? '#' + o.id : ''}[${o.label || 'x'}]`, tag: 'button', role: '', type: 'button', id: '', label: 'x', href: null, tokens: [], ...o });

await t('hrefs: mailto, tel, sms, custom and OS schemes are outward; loopback, extension, blob, data, fragment are local; other hosts are judged by href only', () => {
  for (const h of ['mailto:a@b.test', 'tel:+1', 'sms:1', 'qaw-egress-test:x', 'ms-settings:privacy', 'skype:x', 'javascript:alert(1)']) assert.equal(classifyHref(h).cls, 'outward', h);
  for (const h of ['http://127.0.0.1:9/x', 'http://localhost/x', 'chrome-extension://abc/a.html', 'blob:x', 'data:text/plain,1', '#top', 'report.html?x=1', 'javascript:void(0)']) assert.equal(classifyHref(h).cls, 'local', h);
  for (const h of ['https://example.com/', 'http://10.0.0.1/', 'chrome://extensions', 'about:blank']) assert.equal(classifyHref(h).cls, 'href-only', h);
});

await t('classify: an outward link or form action is outward before any handler is read, with or without a handler of its own', () => {
  assert.deepEqual([classify(ctl({ tag: 'a', id: 'report-mail', href: 'mailto:x@y.test' }), 'popup-awake').cls, classify(ctl({ tag: 'a', id: 'report-mail', href: 'mailto:x@y.test' }), 'popup-awake').rule], ['outward', 'href']);
  assert.equal(classify(ctl({ id: 'go', formaction: 'tel:+1' }), 'options').cls, 'outward');
  assert.equal(classify(ctl({ tag: 'a', href: 'https://example.com/' }), 'options').cls, 'href-only');
});

await t('classify: the nine ids the old hand list named are outward by derivation (handler names and labels), not by a list', () => {
  const cases = [['eml-btn', 'report'], ['jira-quick', 'report'], ['auto-submit', 'report'], ['jira-file', 'report'], ['jira-connect', 'report'], ['chat-post', 'report'], ['mm-post', 'report']];
  for (const [id, surface] of cases) assert.equal(classify(ctl({ id }), surface).cls, 'outward', `${id} on ${surface}`);
  assert.equal(classify(ctl({ id: 'send', label: 'Send it' }), 'reporter').cls, 'outward');
  assert.equal(classify(ctl({ label: 'Send a request', type: 'submit' }), 'popup-awake').cls, 'outward');
  assert.ok(!/OUTWARD_IDS/.test(fs.readFileSync(path.join(HERE, 'test-buttons-all.mjs'), 'utf8')), 'the hand list is gone');
});

await t('classify: a button nobody can classify is UNCLASSIFIED (FAIL classify me, not pressed); a native control or a label wrapper is local', () => {
  const r = classify(ctl({ id: 'zz-brand-new-button-nobody-wired', label: 'Do the thing', tokens: ['zz-brand-new-token'] }), 'popup-awake');
  assert.equal(r.cls, 'unclassified');
  assert.equal(classify(ctl({ tag: 'select', type: 'select-one' }), 'options').cls, 'local');
  assert.equal(classify(ctl({ tag: 'input', type: 'checkbox' }), 'options').cls, 'local');
  assert.equal(classify(ctl({ tag: 'span', inLabel: true }), 'popup-awake').cls, 'local');
});

await t('sweep-safe.json: every listed key resolves to listed, none looks outward, and the reason is stated', () => {
  const safe = JSON.parse(fs.readFileSync(path.join(HERE, 'sweep-safe.json'), 'utf8'));
  assert.ok(String(safe.why).length > 60, 'a root reason');
  assert.ok(Array.isArray(safe.patterns) && safe.patterns.every((p) => p.re && String(p.why).length > 20), 'each pattern carries a reason');
  let n = 0;
  for (const [group, list] of Object.entries(safe.keys)) {
    for (const k of list) {
      n++;
      assert.ok(!/^(send|file|post)\b|\bmail\b|\.eml|e-?mail (this|the|report|me)/i.test(k.replace(/^[^\[]*\[/, '')), `outward-looking key listed: ${k}`);
      assert.ok(!/mailto|tel:/i.test(k), k);
    }
  }
  assert.ok(n > 5, 'the list has the entries the dry-run needed');
  assert.ok(Object.keys(loadSafe().keys).length >= 1);
  assert.equal(normKey('button[Step 12 of 40]'), 'button[Step # of #]');
});

await t('guard: window.close, tabs.remove, windows.remove are recorded and never forwarded; non-loopback opens are swallowed; loopback ones go through', async () => {
  const calls = [];
  const rec = (n) => (...a) => { calls.push(n + ':' + JSON.stringify(a[0] && a[0].url !== undefined ? a[0].url : a[0])); return Promise.resolve({ id: 1 }); };
  const sb = { setTimeout, URL, console };
  sb.window = sb; sb.globalThis = sb;
  sb.location = { href: 'chrome-extension://abc/popup/popup.html' };
  sb.navigator = { sendBeacon: rec('beacon') };
  sb.close = () => { calls.push('window.close'); };
  sb.open = rec('open');
  sb.chrome = { tabs: { create: rec('tabs.create'), update: rec('tabs.update'), remove: rec('tabs.remove') }, windows: { create: rec('windows.create'), update: rec('windows.update'), remove: rec('windows.remove') }, downloads: { download: rec('download') } };
  vm.createContext(sb);
  vm.runInContext(`(${sweepGuard.toString()})()`, sb);
  sb.window.close();
  await sb.chrome.tabs.remove(3);
  await sb.chrome.windows.remove(4);
  assert.equal(sb.window.open('mailto:a@b.test'), null);
  await sb.chrome.tabs.create({ url: 'https://example.com/x' });
  await sb.chrome.tabs.update(1, { url: 'https://example.com/y' });
  await sb.chrome.windows.create({ url: 'qaw-egress-test:go' });
  await sb.chrome.downloads.download({ url: 'https://example.com/f.zip' });
  assert.equal(sb.navigator.sendBeacon('https://example.com/b', 'x'), true);
  assert.deepEqual(calls, [], `forwarded: ${calls.join(', ')}`);
  await sb.chrome.tabs.create({ url: 'http://127.0.0.1:8080/ok' });
  await sb.chrome.tabs.create({ url: 'chrome-extension://abc/report/report.html' });
  await sb.chrome.downloads.download({ url: 'blob:abc' });
  assert.equal(calls.length, 3, calls.join(', '));
});

await t('chunks: never more than 60 controls a chunk; slices cover every control once; a size above 60 is clamped', () => {
  assert.equal(CHUNK_MAX, 60);
  assert.ok(BASE_PER_CHUNK <= CHUNK_MAX);
  assert.deepEqual(planSlices(0), [[0, 0]]);
  for (const n of [1, 44, 45, 46, 100, 249]) {
    const sl = planSlices(n);
    assert.equal(sl.length, Math.ceil(n / BASE_PER_CHUNK), String(n));
    assert.ok(sl.every(([a, b]) => b - a <= CHUNK_MAX));
    assert.equal(sl.reduce((s, [a, b]) => s + (b - a), 0), n);
  }
  assert.equal(clampChunk(999), 60);
  assert.equal(clampChunk('x'), 60);
  assert.equal(clampChunk(10), 10);
});

await t('settle: fixed mode waits the flat time, quiet mode asks the page; a dead page does not throw', async () => {
  const waited = [];
  await settle({ waitForTimeout: (ms) => { waited.push(ms); return Promise.resolve(); } }, null, 'fixed', 650);
  assert.deepEqual(waited, [650]);
  const r = await settle({}, { evaluate: () => Promise.reject(new Error('gone')) }, 'quiet', 650);
  assert.equal(r.gone, true);
});

await t('run.json input: with QAW_RUNDIR set the sweep result lands in <run>/sweeps/, without it nothing is written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-sweepres-'));
  const before = process.env.QAW_RUNDIR;
  try {
    delete process.env.QAW_RUNDIR; delete process.env.QAW_RUN_DIR;
    assert.equal(writeRunResult('buttons-all-t', { a: 1 }), null);
    process.env.QAW_RUNDIR = dir;
    const f = writeRunResult('buttons-all-t', { a: 1 });
    assert.equal(f, path.join(dir, 'sweeps', 'buttons-all-t.json'));
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { a: 1 });
  } finally { if (before === undefined) delete process.env.QAW_RUNDIR; else process.env.QAW_RUNDIR = before; recycle(dir, 'sweep result dir'); }
});

await t('test-buttons-all: dry-run unless --live-sweep (source), unknown surface is a usage error (exit 64), the fixed per-press wait is gone', () => {
  const src = fs.readFileSync(path.join(HERE, 'test-buttons-all.mjs'), 'utf8');
  assert.ok(/const LIVE = flag\('live-sweep'\)/.test(src), 'LIVE comes from --live-sweep only (or the pipeline\'s sandboxed flag)');
  assert.ok(/SKIPPED: dry-run/.test(src) && /process\.exit\(bad\.length \? 1 : 2\)/.test(src), 'a dry-run says SKIPPED and exits 2');
  assert.ok(!/SETTLE_MS/.test(src), 'no fixed settle constant');
  assert.ok(/chunk process ended/.test(src) && /taskkill/.test(src), 'a chunk that dies is a failure, a hung chunk is killed by its own pid');
  const r = spawnSync(process.execPath, [path.join(HERE, 'test-buttons-all.mjs'), '--only', 'zz-no-such-surface'], { encoding: 'utf8', cwd: path.dirname(HERE), timeout: 60000 });
  assert.equal(r.status, 64, r.stdout + r.stderr);
});

await t('clickthrough: carries the sweep guard and step markers, and stays live by default', () => {
  const src = fs.readFileSync(path.join(HERE, 'clickthrough.mjs'), 'utf8');
  assert.ok(/addInitScript\(sweepGuard\)/.test(src) && /::step \$\{stepNo\}/.test(src) && /browser died at step/.test(src));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
