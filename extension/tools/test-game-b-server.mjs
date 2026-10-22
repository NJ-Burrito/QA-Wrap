/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt lane B: game/server.mjs. Static allow-list only, loopback only, three planted routes, no request body read,
 * CSP on every response, exact origin with no port fallback. Real sockets on 127.0.0.1; nothing leaves the machine.
 *
 *   node tools/test-game-b-server.mjs        (from extension/, PYTHONUTF8=1)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { GAME_DIR, imp, runner } from './lib-game-b.mjs';

const { test, done } = runner('Bug Hunt server (lane B)');
const srv = await imp('server.mjs');

/** A raw request so the path reaches the server exactly as written (fetch would normalise `..`). */
function raw(port, method, rawPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = http.request({ host: '127.0.0.1', port, method, path: rawPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), ms: Date.now() - t0 }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const listen = (server) => new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
const close = (server) => new Promise((res) => { server.close(() => res()); server.closeAllConnections?.(); });

const seen = [];
const server = srv.createGameServer({ onRequest: (r) => seen.push(r), payDelayMs: 150 });
const port = await listen(server);

await test('binds the loopback address only', () => {
  const a = server.address();
  assert.equal(a.address, '127.0.0.1'); assert.equal(a.family, 'IPv4');
});

await test('serves the files lane B owns with the right type, and the shared fonts / mark from their existing folders', async () => {
  const want = { '/engine.js': 'text/javascript', '/scoring.js': 'text/javascript', '/scoring.json': 'application/json', '/features.json': 'application/json', '/levels/l1.js': 'text/javascript', '/levels/l5.js': 'text/javascript', '/ui/fonts.css': 'text/css', '/brand/mark.svg': 'image/svg+xml' };
  for (const [p, type] of Object.entries(want)) {
    const r = await raw(port, 'GET', p);
    assert.equal(r.status, 200, p); assert.ok(r.headers['content-type'].startsWith(type), `${p}: ${r.headers['content-type']}`);
    assert.ok(r.body.length > 50, p);
  }
  const head = await raw(port, 'HEAD', '/engine.js');
  assert.equal(head.status, 200); assert.equal(head.body, '');
  // files written by the other lanes: served when they exist on disk, 404 until then
  for (const p of ['/', '/index.html', '/game.css', '/shop.css', '/game.js', '/strings/en.json', '/strings/ar.json']) {
    const r = await raw(port, 'GET', p);
    const exists = fs.existsSync(path.join(GAME_DIR, p === '/' ? 'index.html' : p.slice(1)));
    assert.equal(r.status, exists ? 200 : 404, `${p} -> ${r.status}`);
  }
});

await test('everything outside the allow-list is 404: source, package.json, traversal in every spelling, other levels and languages', async () => {
  const bad = ['/server.mjs', '/package.json', '/levels/../server.mjs', '/levels/l6.js', '/levels/l0.js', '/levels/l1.js.map', '/levels/', '/levels/l1.js/x', '/strings/fr.json', '/strings/../server.mjs',
    '/../package.json', '/%2e%2e/package.json', '/%2e%2e%2fpackage.json', '/audio/../server.mjs', '/audio/%2e%2e/server.mjs', '/audio/..%2fserver.mjs', '/audio/%5c..%5cserver.mjs', '/audio/C:/Windows/win.ini',
    '/audio/', '/audio', '/ui/', '/ui/theme.js', '/ui/../manifest.json', '/brand/lockup.svg', '/manifest.json', '/background/service-worker.js', '/tools/pipeline.mjs', '/game/server.mjs', '//server.mjs', '/api', '/api/other', '/.git/config', '/node_modules/x', '/index.html/', '/scoring.json.bak'];
  for (const p of bad) {
    const r = await raw(port, 'GET', p);
    assert.equal(r.status, 404, `${p} -> ${r.status}`);
    assert.ok(!/import |export |createGameServer|"name"/.test(r.body), `${p} leaked content`);
  }
  assert.equal((await raw(port, 'GET', '/engine.js?x=1')).status, 200, 'a query string does not change the file');
});

await test('only GET/HEAD on files (405 otherwise); planted routes have a fixed method', async () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await raw(port, m, '/engine.js')).status, 405, m);
  assert.equal((await raw(port, 'GET', '/api/save-profile')).status, 405);
  assert.equal((await raw(port, 'GET', '/api/pay')).status, 405);
  assert.equal((await raw(port, 'POST', '/api/coupons')).status, 405);
});

await test('planted routes: save-profile -> 500 JSON, coupons -> 404 JSON, pay -> 200 only after the delay (4000 ms by default)', async () => {
  const s = await raw(port, 'POST', '/api/save-profile');
  assert.equal(s.status, 500); assert.ok(s.headers['content-type'].startsWith('application/json')); assert.equal(JSON.parse(s.body).ok, false);
  const c = await raw(port, 'GET', '/api/coupons');
  assert.equal(c.status, 404); assert.ok(c.headers['content-type'].startsWith('application/json'));
  const p = await raw(port, 'POST', '/api/pay');
  assert.equal(p.status, 200); assert.ok(p.ms >= 140, `answered after ${p.ms} ms`); assert.equal(JSON.parse(p.body).ok, true);
  assert.equal(srv.PAY_DELAY_MS, 4000, 'the product delay is 4 s (the test server used 150 ms)');
});

await test('request bodies are never read or kept: a POST with a body still gets the planted answer, and the hook reports the declared length', async () => {
  seen.length = 0;
  const r = await raw(port, 'POST', '/api/save-profile', { headers: { 'content-type': 'application/json', 'content-length': 22 }, body: '{"name":"secret-name"}' });
  assert.equal(r.status, 500); assert.ok(!r.body.includes('secret-name'));
  const empty = await raw(port, 'POST', '/api/save-profile', { headers: { 'content-length': 0 } });
  assert.equal(empty.status, 500);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].contentLength, 22, 'the hook reports what the client declared');
  assert.equal(seen[1].contentLength, 0);
  assert.deepEqual(Object.keys(seen[0]).sort(), ['contentLength', 'method', 'url']);
  seen.length = 0;
  await raw(port, 'GET', '/engine.js'); await raw(port, 'POST', '/api/save-profile');
  assert.ok(seen.length === 2 && seen.every((x) => x.contentLength === 0), 'the game itself sends empty bodies only');
  const src = fs.readFileSync(path.join(GAME_DIR, 'server.mjs'), 'utf8');
  assert.doesNotMatch(src, /req\.on\(\s*['"]data|req\.read\(|for await \(const \w+ of req\)|JSON\.parse\(body/, 'the request body is never consumed');
  assert.match(src, /req\.resume\(\)/);
});

await test('every response carries the CSP, nosniff and no-store; there is no CORS header anywhere', async () => {
  for (const [m, p] of [['GET', '/engine.js'], ['GET', '/nope'], ['POST', '/api/save-profile'], ['GET', '/api/coupons'], ['PUT', '/engine.js']]) {
    const r = await raw(port, m, p, { headers: { origin: 'http://evil.example' } });
    assert.equal(r.headers['content-security-policy'], srv.CSP, `${m} ${p}`);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.ok(!Object.keys(r.headers).some((k) => k.startsWith('access-control-')), 'no CORS');
  }
  assert.match(srv.CSP, /default-src 'self'/); assert.match(srv.CSP, /connect-src 'self'/); assert.match(srv.CSP, /frame-ancestors 'none'/);
  assert.match(srv.CSP, /font-src data:/); assert.match(srv.CSP, /media-src 'self' blob:/); assert.match(srv.CSP, /style-src 'self' 'unsafe-inline'/);
});

await test('Host check (DNS rebinding): localhost and 127.0.0.1 are served, any other name is 403', async () => {
  for (const h of ['localhost:4173', '127.0.0.1:4173', `127.0.0.1:${port}`, 'LOCALHOST', '[::1]:4173']) assert.equal((await raw(port, 'GET', '/engine.js', { headers: { host: h } })).status, 200, h);
  for (const h of ['evil.example', 'evil.example:4173', 'localhost.evil.example', '127.0.0.1.evil.example:80', '10.0.0.5:4173']) assert.equal((await raw(port, 'GET', '/engine.js', { headers: { host: h } })).status, 403, h);
});

await test('/audio/**: files that exist are served (WAV as audio/wav, Opus as audio/ogg); missing, dotfiles and traversal are 404', async () => {
  assert.equal(srv.MIME['.wav'], 'audio/wav');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt-audio-'));
  const outside = `${dir}-outside.txt`;
  fs.mkdirSync(path.join(dir, 'en'));
  fs.writeFileSync(path.join(dir, 'en', 'v01.wav'), Buffer.from('RIFF....WAVEfmt '));
  fs.writeFileSync(path.join(dir, 'en', 'v02.opus'), Buffer.from('OggS'));
  fs.writeFileSync(path.join(dir, 'narration-manifest.json'), '{"lines":[]}');
  fs.writeFileSync(path.join(dir, '.secret'), 'x');
  fs.writeFileSync(outside, 'outside');
  const s = srv.createGameServer({ audioRoot: dir });
  const p = await listen(s);
  const base = path.basename(dir);
  try {
    const wav = await raw(p, 'GET', '/audio/en/v01.wav');
    assert.equal(wav.status, 200); assert.equal(wav.headers['content-type'], 'audio/wav'); assert.equal(Number(wav.headers['content-length']), 16);
    assert.equal((await raw(p, 'HEAD', '/audio/en/v01.wav')).headers['content-type'], 'audio/wav');
    const opus = await raw(p, 'GET', '/audio/en/v02.opus');
    assert.equal(opus.status, 200); assert.equal(opus.headers['content-type'], 'audio/ogg');
    assert.equal((await raw(p, 'GET', '/audio/narration-manifest.json')).status, 200);
    for (const bad of ['/audio/en/v99.wav', '/audio/.secret', '/audio/en/', '/audio/en', `/audio/../${base}-outside.txt`, `/audio/%2e%2e/${base}-outside.txt`, `/audio/en/..%2f..%2f${base}-outside.txt`, '/audio/en/%00', '/audio//en/v01.wav']) {
      assert.equal((await raw(p, 'GET', bad)).status, 404, bad);
    }
  } finally {
    await close(s);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

await test('closing the server cancels a pending pay answer (no timer left behind)', async () => {
  const s = srv.createGameServer({ payDelayMs: 60000 });
  const p = await listen(s);
  const pending = raw(p, 'POST', '/api/pay').catch(() => 'closed');
  await new Promise((r) => setTimeout(r, 100));
  await close(s);
  assert.equal(await pending, 'closed');
});

await test('CLI: prints exactly one line "Bug Hunt: http://localhost:<port>/"; a busy port exits non-zero with one line and NO fallback port', async () => {
  const blocker = net.createServer(); await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const busy = blocker.address().port;
  const run = (envPort) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(GAME_DIR, 'server.mjs')], { env: { ...process.env, BUG_HUNT_PORT: String(envPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; if (/\n$/.test(out)) child.kill(); });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => resolve({ code, out, err }));
    setTimeout(() => child.kill(), 8000);
  });
  try {
    const bad = await run(busy);
    assert.notEqual(bad.code, 0); assert.equal(bad.out, '');
    assert.equal(bad.err.trim().split('\n').length, 1); assert.match(bad.err, /port \d+ is busy/);
    const probe = net.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r));
    const free = probe.address().port; await new Promise((r) => probe.close(r));
    const ok = await run(free);
    assert.equal(ok.out, `Bug Hunt: http://localhost:${free}/\n`);
  } finally { await new Promise((r) => blocker.close(r)); }
  const src = fs.readFileSync(path.join(GAME_DIR, 'server.mjs'), 'utf8');
  assert.match(src, /server\.listen\(port, '127\.0\.0\.1'/);
  assert.equal(srv.GAME_PORT, 4173); assert.equal(srv.GAME_URL, 'http://localhost:4173/');
});

await close(server);
done();
