// node test/helper.test.mjs: the native host against a fake browser port, the MCP server end to end, the installer on three OSes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encode, decoder } from '../lib/framing.mjs';
import { cleanArgs } from '../lib/host.mjs';
import { ask } from '../lib/client.mjs';
import { install, uninstall, hostManifest, mcpSnippets, manifestDirs, REG_KEYS } from '../lib/install.mjs';
import { TOOLS, EXTENSION_ID, HOST_NAME } from '../lib/paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };
const PKG_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qawb-'));
const token = crypto.randomBytes(8).toString('hex');
const sock = process.platform === 'win32' ? `\\\\.\\pipe\\qa-wrap-bridge-test-${process.pid}` : path.join(tmp, 'b.sock');
const env = { ...process.env, QA_WRAP_BRIDGE_HOME: path.join(tmp, 'home'), QA_WRAP_BRIDGE_SOCKET: sock };
fs.mkdirSync(env.QA_WRAP_BRIDGE_HOME, { recursive: true });
fs.writeFileSync(path.join(env.QA_WRAP_BRIDGE_HOME, 'token'), token);

/** The browser's side of the native port: the real host runs as a child process; this answers its questions. */
function fakeBrowser() {
  const seen = [];
  const child = spawn(process.execPath, [path.join(root, 'bin', 'host-main.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', decoder((m) => {
    seen.push(m);
    const reply = m.tool === 'get_failures' ? { id: m.id, ok: false, error: 'No session s_x.' }
      : m.tool === 'get_ai_brief' ? null // never answers: the host's timeout is tested elsewhere
        : { id: m.id, ok: true, result: JSON.stringify({ schema: 'qawrap.session/1', tool: m.tool, args: m.args }) };
    if (reply) child.stdin.write(encode(reply));
  }));
  const ready = new Promise((res, rej) => {
    const t = setInterval(async () => { try { await ask('list_sessions', {}, { socket: sock, token, timeoutMs: 1500 }); clearInterval(t); res(); } catch (e) { if (!/not connected/i.test(e.message)) { clearInterval(t); res(); } } }, 100);
    child.once('exit', (c) => rej(new Error(`host exited early: ${c}`)));
    setTimeout(() => rej(new Error('host did not come up')), 8000);
  });
  return { child, seen, ready };
}

await test('framing: length-prefixed JSON round-trips across split chunks; the 1 MiB browser limit is enforced', () => {
  const got = [];
  const d = decoder((m) => got.push(m));
  const a = Buffer.concat([encode({ a: 1 }), encode({ b: 'سلام' })]);
  d(a.subarray(0, 3)); d(a.subarray(3, 9)); d(a.subarray(9));
  assert.deepEqual(got, [{ a: 1 }, { b: 'سلام' }]);
  assert.throws(() => encode({ x: 'y'.repeat(1024 * 1024) }), /1 MiB/);
});

await test('arguments: only session_id and limit, only valid values', () => {
  assert.deepEqual(cleanArgs({ session_id: 's_abc-1', limit: 5 }), { session_id: 's_abc-1', limit: 5 });
  assert.deepEqual(cleanArgs(undefined), {});
  for (const bad of [{ session_id: '../x' }, { session_id: 'a b' }, { limit: 0 }, { limit: 500 }, { limit: 1.5 }, { path: '/etc/passwd' }, { session_id: 5 }, [], 'x']) assert.throws(() => cleanArgs(bad), undefined, JSON.stringify(bad));
});

const fb = fakeBrowser();
try {
  await fb.ready;

  await test('host: forwards the four read-only tools to the browser and returns the answers', async () => {
    for (const tool of ['list_sessions', 'get_session']) {
      const r = JSON.parse(await ask(tool, { session_id: 's_1' }, { socket: sock, token }).catch(async () => ask(tool, {}, { socket: sock, token })));
      assert.equal(r.tool, tool);
    }
    const e = await ask('get_failures', {}, { socket: sock, token }).then(() => null, (x) => x);
    assert.match(e.message, /No session/);
    assert.deepEqual([...new Set(fb.seen.map((m) => m.tool))].filter((t) => !TOOLS.includes(t)), []);
  });

  await test('host: refuses a bad token, an unknown tool and bad arguments before anything reaches the browser', async () => {
    const before = fb.seen.length;
    await assert.rejects(ask('list_sessions', {}, { socket: sock, token: 'wrong' }), /bad token/);
    await assert.rejects(ask('start_session', {}, { socket: sock, token }), /unknown tool/);
    await assert.rejects(ask('delete_session', { session_id: 's_1' }, { socket: sock, token }), /unknown tool/);
    await assert.rejects(ask('get_session', { session_id: '../../x' }, { socket: sock, token }), /session_id/);
    assert.equal(fb.seen.length, before, 'the browser saw none of them');
  });

  await test('host: the token never crosses the socket; a squatter on the name gets a nonce and nothing else, and the old plain-token request is refused', async () => {
    const net = await import('node:net');
    // 1. The real host, spoken to by hand: the old shape (token in the request) and a request after a wrong proof both get "bad token".
    const talk = (lines) => new Promise((res) => {
      const got = []; const c = net.connect(sock); c.setEncoding('utf8'); let b = '';
      c.on('data', (d) => { b += d; for (let i = b.indexOf('\n'); i >= 0; i = b.indexOf('\n')) { got.push(JSON.parse(b.slice(0, i))); b = b.slice(i + 1); } });
      c.once('connect', () => { for (const l of lines) c.write(`${JSON.stringify(l)}\n`); setTimeout(() => { c.destroy(); res(got); }, 300); });
    });
    const before = fb.seen.length;
    const old = await talk([{ id: 'x', token, tool: 'list_sessions', args: {} }]);
    assert.equal(old[0].error, 'bad token', 'a request that carries the token instead of a proof is refused');
    const noProof = await talk([{ hello: 'a'.repeat(32) }, { id: 'y', auth: 'f'.repeat(64), tool: 'list_sessions', args: {} }]);
    assert.equal(noProof[0].hello, true);
    assert.ok(!JSON.stringify(noProof).includes(token), 'the host never says the token');
    assert.equal(noProof[1].error, 'bad token', 'a wrong proof is refused');
    assert.equal(fb.seen.length, before, 'the browser saw none of it');
    // 2. A squatter that holds the name but not the key: the client sends one nonce, then refuses, and the token and the question never leave.
    const squatName = process.platform === 'win32' ? `\\\\.\\pipe\\qa-wrap-squat-${process.pid}` : path.join(tmp, 'squat.sock');
    const heard = [];
    const server = net.createServer((c) => { c.setEncoding('utf8'); c.on('data', (d) => { heard.push(d); c.write(`${JSON.stringify({ hello: true, nonce: 'ab'.repeat(8), proof: '0'.repeat(64) })}\n`); }); c.on('error', () => {}); });
    await new Promise((r) => server.listen(squatName, r));
    await assert.rejects(ask('list_sessions', {}, { socket: squatName, token, timeoutMs: 2000 }), /bad token/);
    server.close();
    const wire = heard.join('');
    assert.ok(wire.includes('"hello"') && !wire.includes(token) && !wire.includes('list_sessions') && !wire.includes('"auth"'), 'only a nonce reached the squatter');
  });

  await test('host: the socket is local only (a pipe or unix socket), never a TCP port', () => {
    const hostSrc = fs.readFileSync(path.join(root, 'lib', 'host.mjs'), 'utf8') + fs.readFileSync(path.join(root, 'lib', 'client.mjs'), 'utf8') + fs.readFileSync(path.join(root, 'bin', 'host-main.mjs'), 'utf8');
    for (const w of ['http', 'https', 'dgram', 'fetch(', 'tls', '.listen(0', 'WebSocket', '0.0.0.0', 'localhost', '127.0.0.1']) assert.ok(!hostSrc.includes(w), `helper must not contain ${w}`);
    assert.ok(/listen\(socketPath/.test(hostSrc));
  });

  await test('MCP server end to end: four tools, all read-only, answers come through the fake browser port', async () => {
    const sdk = await import('@modelcontextprotocol/sdk/client/index.js').catch(() => null);
    if (!sdk) { console.log('        (skipped: run npm ci in helper/ to install the MCP SDK)'); return; }
    const { Client } = sdk;
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin', 'cli.mjs'), 'mcp'], env: Object.fromEntries(Object.entries(env).filter(([, v]) => v != null)) });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
      for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, `${t.name} is read only`);
      const r = await client.callTool({ name: 'get_session', arguments: { session_id: 's_42' } });
      assert.equal(JSON.parse(r.content[0].text).args.session_id, 's_42');
      const bad = await client.callTool({ name: 'get_failures', arguments: {} });
      assert.equal(bad.isError, true);
      assert.match(bad.content[0].text, /No session/);
      const refused = await client.callTool({ name: 'get_session', arguments: { session_id: '../x' } }).catch((e) => ({ isError: true, content: [{ text: e.message }] }));
      assert.equal(refused.isError, true, 'a path-like id never reaches the host');
    } finally { await client.close(); }
  });
} finally {
  fb.child.stdin.end();
  await new Promise((r) => { fb.child.once('exit', r); setTimeout(r, 2000); });
  fb.child.kill();
}

await test('without a browser: the MCP error says what to do', async () => {
  await assert.rejects(ask('list_sessions', {}, { socket: path.join(tmp, 'none.sock'), token }), /turn on "Agent bridge"/);
});

await test('install: Windows writes the registry for Chrome and Edge; macOS and Linux write both browsers\' manifest folders', () => {
  const run = (platform) => {
    const home = fs.mkdtempSync(path.join(tmp, platform));
    const reg = [];
    const r = install({ platform, home, env: {}, nodePath: '/usr/bin/node', regAdd: (k, v) => reg.push([k, v]) });
    return { home, reg, r };
  };
  const w = run('win32');
  assert.deepEqual(w.reg.map(([k]) => k).sort(), Object.values(REG_KEYS).sort());
  assert.ok(w.reg.every(([, v]) => fs.existsSync(v) && JSON.parse(fs.readFileSync(v, 'utf8')).name === HOST_NAME));
  assert.match(fs.readFileSync(w.r.launcher, 'utf8'), /^@echo off\r\n"\/usr\/bin\/node" ".*host-main\.mjs" %\*/);
  for (const platform of ['darwin', 'linux']) {
    const { home, r } = run(platform);
    const dirs = manifestDirs(platform, home);
    assert.equal(dirs.length, 2);
    for (const [, dir] of dirs) {
      const m = JSON.parse(fs.readFileSync(path.join(dir, `${HOST_NAME}.json`), 'utf8'));
      assert.equal(m.type, 'stdio');
      assert.deepEqual(m.allowed_origins, [`chrome-extension://${EXTENSION_ID}/`]);
      assert.equal(m.path, r.launcher);
    }
    assert.match(fs.readFileSync(r.launcher, 'utf8'), /^#!\/bin\/sh\nexec "\/usr\/bin\/node"/);
    if (process.platform !== 'win32') assert.ok(fs.statSync(r.launcher).mode & 0o100, 'the launcher is executable');
  }
  assert.ok(manifestDirs('darwin', '/h')[0][1].includes('Application Support') && manifestDirs('linux', '/h')[1][1].includes('microsoft-edge'));
});

await test('install: the host copy needs no node_modules, a token is created once, extra ids are added, uninstall removes everything', () => {
  const home = fs.mkdtempSync(path.join(tmp, 'again'));
  const a = install({ platform: 'linux', home, env: {}, extraIds: ['a'.repeat(32)] });
  const tok = fs.readFileSync(path.join(a.root, 'token'), 'utf8');
  const b = install({ platform: 'linux', home, env: {} });
  assert.equal(fs.readFileSync(path.join(b.root, 'token'), 'utf8'), tok, 'the key is kept across re-installs');
  assert.deepEqual(a.manifest.allowed_origins, [`chrome-extension://${EXTENSION_ID}/`, `chrome-extension://${'a'.repeat(32)}/`]);
  assert.ok(!fs.existsSync(path.join(a.root, 'host', 'node_modules')));
  for (const f of fs.readdirSync(path.join(a.root, 'host', 'lib'))) assert.ok(!/from '[^.]/.test(fs.readFileSync(path.join(a.root, 'host', 'lib', f), 'utf8').replace(/from 'node:[^']+'/g, '')), `${f} imports only node built-ins`);
  const u = uninstall({ platform: 'linux', home, env: {} });
  assert.ok(u.removed.length >= 3 && !fs.existsSync(a.root));
  for (const [, dir] of manifestDirs('linux', home)) assert.ok(!fs.existsSync(path.join(dir, `${HOST_NAME}.json`)));
});

await test('snippets: Claude Code and JSON for Cursor, with cmd /c on Windows', () => {
  assert.equal(mcpSnippets('linux').claudeCode, `claude mcp add qa-wrap -- npx -y qa-wrap-bridge@${JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version} mcp`);
  assert.deepEqual(JSON.parse(mcpSnippets('darwin').json).mcpServers['qa-wrap'], { command: 'npx', args: ['-y', `qa-wrap-bridge@${PKG_VERSION}`, 'mcp'] });
  assert.deepEqual(JSON.parse(mcpSnippets('win32').json).mcpServers['qa-wrap'], { command: 'cmd', args: ['/c', 'npx', '-y', `qa-wrap-bridge@${PKG_VERSION}`, 'mcp'] });
  assert.equal(hostManifest('/x', ['b', 'b']).allowed_origins.length, 1);
});

await test('the id in the helper is the id of the extension manifest key', () => {
  const mf = path.resolve(root, '..', 'extension', 'manifest.json');
  if (!fs.existsSync(mf)) return;
  const der = Buffer.from(JSON.parse(fs.readFileSync(mf, 'utf8')).key, 'base64');
  const h = crypto.createHash('sha256').update(der).digest().subarray(0, 16);
  assert.equal([...h].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join(''), EXTENSION_ID);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} passed, 0 failed`);
process.exit(0);
