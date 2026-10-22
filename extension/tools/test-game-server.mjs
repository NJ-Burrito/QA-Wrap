/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt server (DESIGN-bug-hunt section 8): allow-list only, three planted routes, bodies never read, loopback only,
 * the CSP header, no CORS, and no port fallback.
 *
 *   node tools/test-game-server.mjs        (from extension/, PYTHONUTF8=1)
 *
 * Plain node: the server module is started on a free port with createGameServer({ port: 0 }) and probed with raw http
 * requests (fetch would normalise the `..` paths the probes need). The CLI cases bind 4173 themselves; when 4173 is not
 * free (the owner is playing) they are skipped and the suite exits 2.
 */
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import { has, imp, GAME } from './lib-game-engine.mjs';

if (!has('server.mjs')) {
  skipNotEnforced({ rule: 'game', what: 'server allow-list, planted routes, CSP, no port fallback', why: 'extension/game/server.mjs (lane B) has not landed' });
  finish('test-game-server', { skipped: 1 });
}

const mod = await imp('server.mjs');
const seen = [];
const server = mod.createGameServer({ port: 0, onRequest: (r) => seen.push(r) });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { address, port } = server.address();
ok(address === '127.0.0.1', 'the server binds 127.0.0.1 only', address);

/** One raw request: path sent exactly as given. */
const hit = (method, p, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'), ms: Date.now() - t0 }));
  });
  req.on('error', reject);
  req.end(body);
});

/* ---- allow-list ---------------------------------------------------------------------------------------------------- */
const LISTED = ['/', '/index.html', '/game.css', '/shop.css', '/game.js', '/engine.js', '/levels/l1.js', '/levels/l5.js', '/trial.js', '/trial-ui.js', '/trial.css', '/trials/t6.js', '/trials/t7.js', '/trials/attune.js', '/strings/en.json', '/strings/ar.json', '/ui/fonts.css', '/brand/mark.svg'];
const present = nonEmpty(LISTED.filter((p) => { const rel = p === '/' ? 'index.html' : p.replace(/^\//, ''); return p.startsWith('/ui/') || p.startsWith('/brand/') || has(rel); }), 'listed paths whose files exist');
for (const p of present) { const r = await hit('GET', p); ok(r.status === 200 && r.text.length > 0, `GET ${p} serves 200 with a body`, String(r.status)); }
const PROBES = ['/../server.mjs', '/server.mjs', '/package.json', '/levels/../server.mjs', '/levels/../x', '/%2e%2e/server.mjs', '/..%2fserver.mjs', '/audio/../server.mjs', '/ui/../package.json', '/brand/../manifest.json', '/node_modules/playwright/package.json', '/levels/l6.js', '/strings/fr.json', '/tools/lib-game.mjs', '/.git/config', '//server.mjs', '/index.html/../server.mjs'];
for (const p of PROBES) {
  const r = await hit('GET', p);
  // '//server.mjs' parses as a protocol-relative URL whose path is '/': the game page, never the file. Every other probe is a plain 404.
  const harmless = p === '//server.mjs' && r.status === 200 && !/createGameServer|node:http/.test(r.text);
  ok(r.status === 404 || harmless, `GET ${p} is 404 (or the game page), never the file`, `${r.status} ${r.text.slice(0, 40)}`);
}
proveTeeth('the allow-list probe', (s) => (s === 404 ? [] : ['served']), 200);

/* ---- planted routes ------------------------------------------------------------------------------------------------ */
{
  const save = await hit('POST', '/api/save-profile', { body: '{"name":"Layla"}', headers: { 'content-type': 'application/json' } });
  ok(save.status === 500 && /json/.test(save.headers['content-type'] || ''), 'POST /api/save-profile answers 500 JSON', `${save.status} ${save.headers['content-type']}`);
  ok(save.ms < 1500, 'the save answer does not wait for the request body (body never read)', `${save.ms} ms`);
  const coupon = await hit('GET', '/api/coupons');
  ok(coupon.status === 404, 'GET /api/coupons answers 404', String(coupon.status));
  for (const [m, p] of [['GET', '/api/save-profile'], ['GET', '/api/pay'], ['POST', '/api/coupons']]) {
    const r = await hit(m, p);
    ok(r.status === 404 || r.status === 405, `${m} ${p}: the method is fixed (a wrong method is not served)`, String(r.status));
  }
  for (const [m, p, st] of [['POST', '/api/sync', 503], ['POST', '/api/telemetry', 500], ['POST', '/api/checkout', 500], ['GET', '/api/menu', 404]]) {
    const r = await hit(m, p, { body: m === 'POST' ? 'x'.repeat(2048) : undefined });
    ok(r.status === st && r.ms < 1500, `${m} ${p} (hard-trial planted route) answers ${st} at once, body never read`, `${r.status} ${r.ms} ms`);
    const w = await hit(m === 'POST' ? 'GET' : 'POST', p);
    ok(w.status === 405 || w.status === 404, `${p}: the method is fixed`, String(w.status));
  }
  const pay = await hit('POST', '/api/pay');
  ok(pay.status === 200, 'POST /api/pay answers 200', String(pay.status));
  ok(pay.ms >= 3950 && pay.ms < 6000, 'POST /api/pay takes about 4 s', `${pay.ms} ms`);
}

/* ---- headers and recorded requests -------------------------------------------------------------------------------- */
{
  const r = await hit('GET', '/');
  const csp = String(r.headers['content-security-policy'] || '');
  ok(csp.length > 0, 'the page carries a Content-Security-Policy header');
  for (const d of ["default-src 'self'", "connect-src 'self'", "img-src 'self' data:", "font-src data:", "media-src 'self' blob:", "frame-ancestors 'none'"]) ok(csp.includes(d), `CSP has ${d}`, csp);
  ok(!/script-src[^;]*unsafe/.test(csp) && !/unsafe-eval/.test(csp), 'CSP never allows unsafe script');
  ok(!Object.keys(r.headers).some((k) => /^access-control-/i.test(k)), 'no CORS headers');
  proveTeeth('the CSP directive check', (c) => (c.includes("connect-src 'self'") ? [] : ['no connect-src']), "default-src 'self'");
  const bodiless = seen.filter((x) => x.method === 'GET');
  nonEmpty(bodiless, 'recorded GET requests');
  ok(bodiless.every((x) => !x.contentLength), 'every recorded GET has contentLength 0', JSON.stringify(bodiless.find((x) => x.contentLength)));
  const big = await hit('POST', '/api/save-profile', { body: 'x'.repeat(2048) });
  ok(big.status === 500 && big.ms < 1500, 'a POST with a body is still answered at once (never read, never stored)');
}

await new Promise((r) => server.close(r));
ok(true, 'the test server closed');

/* ---- CLI: exact line, and no port fallback -------------------------------------------------------------------------- */
const canBind = (p) => new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(null)); s.listen(p, '127.0.0.1', () => resolve(s)); });
const run = (ms) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(GAME, 'server.mjs')], { cwd: path.join(GAME, '..'), env: { ...process.env, PYTHONUTF8: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { child.kill(); resolve({ code: 'running', out }); }, ms);
  child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
});
let skipped = 0;
const holder = await canBind(4173);
if (!holder) {
  console.log('SKIPPED: port 4173 is in use on this machine (the game may be running); the CLI cases were not run');
  skipped = 1;
} else {
  const busy = await run(6000);
  ok(busy.code !== 0 && busy.code !== 'running', 'port 4173 busy: the CLI exits non-zero (no port fallback)', `${busy.code} ${busy.out.trim()}`);
  ok(busy.out.trim().split(/\r?\n/).filter(Boolean).length === 1, 'port 4173 busy: one line of explanation', busy.out.trim());
  ok(!/Bug Hunt: http/.test(busy.out), 'port 4173 busy: it never prints the start line');
  await new Promise((r) => holder.close(r));
  await new Promise((r) => setTimeout(r, 300));
  const up = await run(2500);
  ok(up.code === 'running', 'port 4173 free: the CLI keeps running', `${up.code} ${up.out}`);
  ok(up.out.trim() === 'Bug Hunt: http://localhost:4173/', 'the CLI prints exactly "Bug Hunt: http://localhost:4173/" (no time promise)', JSON.stringify(up.out));
}
finish('test-game-server', { skipped });
