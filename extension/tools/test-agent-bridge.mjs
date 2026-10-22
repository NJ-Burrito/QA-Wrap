/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The agent bridge, extension side (features-1010, decision 6).   node tools/test-agent-bridge.mjs
 *
 *   - the answers (`offscreen/agent-bridge.js`) are read only, masked, and fit the browser's 1 MiB message limit;
 *   - the native port (`bridgeSync` in `background/draft-door.js`) exists only while the switch is on AND `nativeMessaging` is
 *     granted, forwards only the four tools, and never writes;
 *   - `nativeMessaging` is optional only, asked for in the click that turns the bridge on;
 *   - the helper package's own test (host against a fake native port, MCP end to end, installer) is run from here.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { answer, BRIDGE_TOOLS, MAX_ANSWER_CHARS } from '../offscreen/agent-bridge.js';
import { buildSessionJson } from '../core/ai-brief.js';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

const T0 = 1_800_000_000_000;
const sessions = [
  { id: 's_old', seq: 1, charter: 'older', startedAt: T0, endedAt: T0 + 5000, startUrl: 'https://app.test/', env: {}, status: 'stopped' },
  { id: 's_new', seq: 2, charter: 'Checkout with Bearer abcdefghijklmnopqrstuvwxyz1234', startedAt: T0 + 100_000, endedAt: T0 + 120_000, startUrl: 'https://app.test/cart?token=SUPERSECRETTOKEN99', env: { viewport: '1280x800' }, status: 'stopped' },
];
const eventsOf = {
  s_new: [
    { kind: 'nav', ts: T0 + 100_100, url: 'https://app.test/cart' },
    { kind: 'dom', ts: T0 + 101_000, action: 'click', label: 'Pay', locator: "getByRole('button', { name: 'Pay' })", frameUrl: 'https://app.test/cart' },
    { kind: 'net', ts: T0 + 101_200, method: 'POST', url: 'https://app.test/api/pay?api_key=KEYKEYKEYKEY1234', status: 500, durationMs: 80, reqBody: { kind: 'text', text: '{"password":"hunter2hunter2"}' }, responsePreview: 'boom' },
    { kind: 'console', ts: T0 + 101_300, level: 'error', text: 'Payment failed' },
  ],
  s_old: [],
};
const writes = [];
const fakeDb = {
  listSessions: async () => sessions,
  getSession: async (id) => sessions.find((s) => s.id === id) || null,
  getEvents: async (id) => eventsOf[id] || [],
  countEvents: async (id) => (eventsOf[id] || []).length,
  countFailures: async (id) => (eventsOf[id] || []).filter((e) => e.kind === 'console' || (e.kind === 'net' && e.status >= 400)).length,
  // Every write the module could reach: a call is a failure.
  putSession: async () => writes.push('putSession'), appendEvent: async () => writes.push('appendEvent'), deleteSession: async () => writes.push('deleteSession'), eraseEverything: async () => writes.push('eraseEverything'),
};

await test('list_sessions: newest first, titles masked, counts included', async () => {
  const r = await answer({ fn: 'list_sessions', args: {} }, { db: fakeDb });
  assert.equal(r.ok, true);
  const o = JSON.parse(r.result);
  assert.deepEqual(o.sessions.map((s) => s.id), ['s_new', 's_old']);
  assert.equal(o.sessions[0].failures, 2);
  assert.ok(!r.result.includes('abcdefghijklmnopqrstuvwxyz1234'), 'a token in a title is masked');
});

await test('get_session is the documented session.json (qawrap.session/1), masked; the default is the newest session', async () => {
  const r = await answer({ fn: 'get_session', args: {} }, { db: fakeDb });
  const o = JSON.parse(r.result);
  assert.equal(o.schema, 'qawrap.session/1');
  assert.equal(o.session.id, 's_new');
  assert.equal(r.result, buildSessionJson(sessions[1], eventsOf.s_new, { generatedAt: Date.parse(o.generatedAt) }), 'byte for byte what the Copy for AI export writes');
  for (const leak of ['SUPERSECRETTOKEN99', 'KEYKEYKEYKEY1234', 'hunter2', 'abcdefghijklmnopqrstuvwxyz1234']) assert.ok(!r.result.includes(leak), `leaked ${leak}`);
});

await test('get_failures is only the failures; get_ai_brief is the compact text block', async () => {
  const f = JSON.parse((await answer({ fn: 'get_failures', args: { session_id: 's_new' } }, { db: fakeDb })).result);
  assert.deepEqual(Object.keys(f).sort(), ['failures', 'schema', 'session', 'totals']);
  assert.equal(f.failures.length, 2);
  const b = await answer({ fn: 'get_ai_brief', args: { session_id: 's_new' } }, { db: fakeDb });
  assert.match(b.result, /^# Bug report for an AI assistant/);
  assert.ok(!b.result.includes('KEYKEYKEYKEY1234'));
});

await test('refusals: unknown tool, bad id, unknown session, nothing recorded yet; no write is ever called', async () => {
  assert.equal((await answer({ fn: 'start_session', args: {} }, { db: fakeDb })).ok, false);
  assert.equal((await answer({ fn: 'delete_session', args: { session_id: 's_new' } }, { db: fakeDb })).ok, false);
  assert.equal((await answer({ fn: 'get_session', args: { session_id: '../etc/passwd' } }, { db: fakeDb })).ok, false);
  assert.match((await answer({ fn: 'get_session', args: { session_id: 's_nope' } }, { db: fakeDb })).error, /No session/);
  assert.match((await answer({ fn: 'get_session', args: {} }, { db: { ...fakeDb, listSessions: async () => [] } })).error, /no sessions yet/);
  assert.deepEqual(writes, []);
  assert.deepEqual([...BRIDGE_TOOLS], ['list_sessions', 'get_session', 'get_failures', 'get_ai_brief']);
  const src = read('offscreen/agent-bridge.js').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const w of ['putSession', 'appendEvent', 'deleteSession', 'eraseEverything', 'fetch(', 'XMLHttpRequest', 'chrome.', 'sendMessage']) assert.ok(!src.includes(w), `agent-bridge.js must not contain ${w}`);
});

await test('a huge session is slimmed to fit the browser\'s 1 MiB limit and says what was left out', async () => {
  const many = Array.from({ length: 6000 }, (_, i) => ({ kind: 'net', ts: T0 + 101_000 + i, method: 'GET', url: `https://app.test/api/item/${i}?cache=${'x'.repeat(40)}`, status: 500, durationMs: 5 }));
  const db = { ...fakeDb, getEvents: async () => [...eventsOf.s_new, ...many] };
  const r = await answer({ fn: 'get_session', args: { session_id: 's_new' } }, { db });
  assert.equal(r.ok, true);
  assert.ok(r.result.length <= MAX_ANSWER_CHARS, `${r.result.length} chars`);
  assert.ok(Buffer.byteLength(r.result) < 1024 * 1024);
});

// ---- the worker side: a fake chrome, the real draft-door.js
const calls = { connect: 0, disconnect: 0, posted: [], offscreen: [] };
let flag = false;
let granted = false;
let port;
const makePort = () => {
  const p = { onMessage: { fns: [], addListener(f) { this.fns.push(f); } }, onDisconnect: { fns: [], addListener(f) { this.fns.push(f); } }, postMessage: (m) => calls.posted.push(m), disconnect: () => { calls.disconnect++; } };
  return (port = p);
};
globalThis.chrome = {
  storage: { local: { get: async () => ({ agentBridge: flag }) } },
  permissions: { contains: async ({ permissions }) => granted && permissions[0] === 'nativeMessaging' },
  runtime: { lastError: null, getManifest: () => ({ version: '0.0.0' }), connectNative: (name) => { calls.connect++; calls.name = name; return makePort(); } },
};
const door = await import('../background/draft-door.js').catch((e) => ({ error: e }));
await test('worker port: not made while the switch is off or the permission is missing', async () => {
  assert.ok(!door.error, door.error && door.error.message);
  assert.deepEqual(await door.bridgeSync(), { on: false, connected: false, error: '' });
  flag = true;
  assert.equal((await door.bridgeSync()).connected, false, 'switch on, permission missing');
  flag = false; granted = true;
  assert.equal((await door.bridgeSync()).connected, false, 'permission held, switch off');
  assert.equal(calls.connect, 0);
});

await test('worker port: made once when both are true, to the one host name; dropped when either goes', async () => {
  flag = true; granted = true;
  assert.equal((await door.bridgeSync()).connected, true);
  assert.equal((await door.bridgeSync()).connected, true);
  assert.equal(calls.connect, 1);
  assert.equal(calls.name, 'com.qawrap.bridge');
  flag = false;
  assert.equal((await door.bridgeSync()).connected, false);
  assert.equal(calls.disconnect, 1);
});

await test('worker port: an unknown tool is refused without reaching the offscreen page; a missing host is reported', async () => {
  flag = true; granted = true;
  await door.bridgeSync();
  await port.onMessage.fns[0]({ id: 7, tool: 'start_session', args: {} });
  assert.deepEqual(calls.posted.at(-1), { id: 7, ok: false, error: 'unknown tool' });
  chrome.runtime.lastError = { message: 'Specified native messaging host not found.' };
  port.onDisconnect.fns[0]();
  chrome.runtime.lastError = null;
  assert.equal((await door.bridgeSync(0)).connected, true, 'a fresh port is made after a disconnect');
});

await test('permission: nativeMessaging is optional only, and the Settings click asks before any await', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.ok(m.optional_permissions.includes('nativeMessaging'));
  assert.ok(!m.permissions.includes('nativeMessaging'), 'not held at install');
  assert.ok(!(m.host_permissions || []).some((h) => h !== '<all_urls>')); // ui-1019: only the all-sites line
  const js = read('options/buffer-bridge.js');
  const handler = js.slice(js.indexOf("addEventListener('change'"));
  assert.ok(handler.indexOf('chrome.permissions.request') < handler.indexOf('await '), 'the request is made before any await in the click');
  assert.match(js, /chrome\.permissions\.remove\(\{ permissions: \['nativeMessaging'\] \}\)/, 'turning it off hands the permission back');
});

await test('wiring: worker handler and boot call exist; the offscreen page serves the op; no import() in the worker', () => {
  const sw = workerSrc();
  assert.match(sw, /UQA_BRIDGE_SYNC: \(msg\) => draftDoor\.bridgeSync\(msg\.wait\)/);
  assert.match(sw, /\); draftDoor\.bridgeSync\(\); \/\/ the agent bridge port/);
  assert.ok(!/UQA_BRIDGE_SYNC/.test(sw.slice(sw.indexOf('const CONTENT_SCRIPT_TYPES'), sw.indexOf('async function guardSender'))), 'a web page cannot send it');
  assert.match(read('offscreen/offscreen.js'), /op === 'bridge'\) return \(await import\('\.\/agent-bridge\.js'\)\)\.answer\(request\)/);
  assert.ok(!/\bimport\(/.test(read('background/draft-door.js').replace(/\/\*[\s\S]*?\*\//g, '')));
});

await test('the helper package: host against a fake native port, MCP end to end, installer on three OSes', () => {
  const helper = path.resolve(EXT, '..', 'helper');
  assert.ok(fs.existsSync(path.join(helper, 'package.json')), 'helper/ exists');
  const r = spawnSync(process.execPath, [path.join(helper, 'test', 'helper.test.mjs')], { encoding: 'utf8', timeout: 90_000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /\d+ passed, 0 failed/);
  assert.ok(fs.existsSync(path.join(helper, 'README.md')), 'the helper has a README');
});

console.log(`\n${n} passed, 0 failed`);
process.exit(0);
