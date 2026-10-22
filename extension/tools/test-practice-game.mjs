/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The practice page is the Bug Hunt game (Nader, 15 Oct 2026), packaged inside the extension. Plain node, no browser, no network.
 *
 *   node tools/test-practice-game.mjs
 *
 * What it holds: practice/practice.html is what tools/build-practice.mjs writes from game/index.html; it is an MV3 page (no inline script, no
 * handler attribute, no eval, no remote address); every address it and the game's modules use resolves to a file that ships; the voices are
 * real Ogg files named by the manifest and no WAV ships; the in-extension stand-in for the game server answers every planted route the way the
 * server does; the dev-only files stay out of the package.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { shipping, isWorkingNote } from './lib-ship.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(EXT, ...p), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (f) => path.relative(EXT, f).replace(/\\/g, '/');
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`  ok  ${name}`); };

const html = read('practice', 'practice.html');
const gameJs = walk(path.join(EXT, 'game')).filter((f) => /\.m?js$/.test(f) && !/server\.mjs$/.test(f));

await test('practice.html is what build-practice.mjs writes from game/index.html', () => {
  const r = spawnSync(process.execPath, [path.join(EXT, 'tools', 'build-practice.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

await test('it is an MV3 page: no inline script, no handler attribute, no eval, no remote address, no root-absolute address', () => {
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html), 'an inline <script>');
  assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'an inline handler attribute');
  assert.ok(!/https?:\/\//.test(html.replace(/https?:\/\/www\.w3\.org\/\d+\/svg/g, '')), 'a remote address');
  assert.ok(!/(?:href|src)="\/[^/]/.test(html), 'a root-absolute address would resolve to the extension root, not to game/');
  for (const f of [...gameJs, path.join(EXT, 'practice', 'mock-server.js')]) {
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(fs.readFileSync(f, 'utf8')), `${rel(f)} uses eval or new Function`);
  }
});

await test('the recorder comes after the mock server is installed and before nothing else needs it: mock-server, overlay.css, page-hooks, then the isolated-world files', () => {
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(order[0], 'mock-server.js');
  assert.equal(order[1], '../content/page-hooks.js');
  assert.ok(order.indexOf('../game/game.js') > order.indexOf('../content/page-hooks.js') || html.includes('type="module" src="../game/game.js"'));
  assert.ok(html.includes('<meta id="qawRun" name="qaw-run" content="' + '0'.repeat(32) + '">'));
});

await test('every address the page and the game modules use points at a file that ships', () => {
  const ships = (f) => !isWorkingNote(rel(f));
  const missing = [];
  const check = (from, ref) => {
    if (/^(?:data:|#|https?:)/.test(ref) || ref.includes('${')) return;
    const target = path.resolve(path.dirname(from), ref.split(/[?#]/)[0]);
    if (!fs.existsSync(target) || !ships(target)) missing.push(`${rel(from)} -> ${ref}`);
  };
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) check(path.join(EXT, 'practice', 'practice.html'), m[1]);
  for (const f of gameJs) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) check(f, m[1]);
    for (const m of src.matchAll(/new URL\(\s*['"](\.{1,2}\/[^'"]+)['"],\s*import\.meta\.url/g)) check(f, m[1]);
  }
  assert.deepEqual(missing, []);
  const ship = shipping(fs.readdirSync(EXT));
  assert.ok(ship.includes('game') && ship.includes('practice'));
  assert.ok(isWorkingNote('game/server.mjs') && isWorkingNote('game/index.html'), 'the dev server and the source page ship');
  assert.ok(!isWorkingNote('game/engine.js') && !isWorkingNote('practice/practice.html'));
});

await test('the voices are Ogg files named by the manifest; no WAV ships under game/', () => {
  const man = JSON.parse(read('game', 'audio', 'narration-manifest.json'));
  assert.ok(man.lines.length >= 11);
  let ogg = 0;
  for (const l of man.lines) {
    for (const [file, status] of [[l.file, l.file_status], [l.file_ar, l.file_status_ar]]) {
      assert.match(file, /^audio\/(?:en|ar)\/v\d\d\.ogg$/);
      if (status !== 'ok') continue;
      const buf = fs.readFileSync(path.join(EXT, 'game', file));
      assert.equal(buf.toString('ascii', 0, 4), 'OggS', `${file} is not Ogg`);
      assert.ok(buf.length > 2000 && buf.length < 60000, `${file} is ${buf.length} bytes`);
      ogg++;
    }
  }
  assert.ok(ogg >= 15, `only ${ogg} voice files`);
  assert.deepEqual(walk(path.join(EXT, 'game')).filter((f) => /\.(?:wav|opus|mp3)$/.test(f)).map(rel), []);
});

await test('mock-server.js answers every planted route with the status, the body and the method rule game/server.mjs gives', async () => {
  const { createGameServer } = await import(pathToFileURL(path.join(EXT, 'game', 'server.mjs')).href);
  const server = createGameServer({ port: 0, payDelayMs: 0 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const viaServer = async (method, p) => { const r = await fetch(base + p, { method }); return [r.status, await r.text()]; };
  const mock = (fetchImpl) => {
    const ctx = { Response, URL, Request, DOMException, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout, location: { href: 'chrome-extension://x/practice/practice.html', origin: 'chrome-extension://x' }, fetch: fetchImpl };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(read('practice', 'mock-server.js'), ctx);
    return ctx;
  };
  const ctx = mock(async () => { throw new Error('the mock must not pass a planted route through'); });
  const viaMock = async (method, p) => { const r = await ctx.window.fetch(p, { method }); return [r.status, await r.text()]; };
  const cases = [['POST', '/api/save-profile'], ['POST', '/api/pay'], ['GET', '/api/coupons'], ['POST', '/api/sync'], ['POST', '/api/telemetry'], ['POST', '/api/checkout'],
    ['GET', '/api/menu'], ['POST', '/api/orders/apple'], ['GET', '/api/save-profile'], ['POST', '/api/coupons'], ['GET', '/favicon.ico']];
  try {
    for (const [m, p] of cases) {
      const [ss, sb] = await viaServer(m, p);
      const [ms, mb] = await viaMock(m, p);
      assert.equal(ms, ss, `${m} ${p}: status`);
      if (ss !== 405 && !p.endsWith('.ico')) assert.equal(mb, sb, `${m} ${p}: body`);
    }
  } finally { server.close(); }
  // everything else goes through to the real fetch (the strings, the voices, the modules, any other origin)
  const seen = [];
  const other = mock(async (u) => { seen.push(String(u)); return new Response('x'); });
  await other.window.fetch('chrome-extension://x/game/strings/en.json');
  await other.window.fetch('https://example.com/api/pay', { method: 'POST' });
  assert.deepEqual(seen, ['chrome-extension://x/game/strings/en.json', 'https://example.com/api/pay']);
});

await test('the old four-fault page stays as a test fixture, and both pages count as the practice page', () => {
  assert.ok(fs.existsSync(path.join(EXT, 'practice', 'faults.html')));
  assert.ok(!/faults\.html/.test(read('popup', 'onboard.js')) && !/faults\.html/.test(read('welcome', 'welcome.js')), 'no user-facing link opens the fixture');
});

http.globalAgent.destroy();
console.log(`\ntest-practice-game: ${passed} passed`);
