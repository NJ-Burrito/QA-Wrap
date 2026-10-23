/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The update page (f1023), in real Chromium with a stubbed chrome.* and the native host simulated:
 *   - helper missing -> two choices, no zip download until "Update manually instead" is pressed
 *   - Check again while still missing -> stays, downloads nothing; once the host answers -> the update runs by itself and reloads
 *   - stages move downloading -> checking -> installing -> reloading; a failure shows a calm message, Try again and the backup notice
 *   - release notes are text only (HTML in them stays text, nothing runs), sections render as cards
 *   - Arabic: dir=rtl, Arabic strings; the file chip stays left-to-right
 *   QAW_SHOTS=<dir> also saves viewport screenshots (EN and AR) for a visual check.
 *   node tools/test-update-page.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { parseNotes, detectOS, helperFile } from '../ui/update-lib.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.otf': 'font/otf', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(EXT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(EXT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const SHOTS = process.env.QAW_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let n = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`  ok  ${name}`); } catch (e) { n++; failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const NOTES = '### Added\n\n- A **new** update page\n- <img src=x onerror="window.__pwned=1"> and <script>window.__pwned=1</script> stay text\n\n### Changed\n\n- Calmer wording\n\n### Fixed\n\n- Added: not a heading [link](javascript:alert(1))\n- Fixed: the arrow';
const PENDING = { version: '3.7.0', url: 'https://github.com/NJ-Burrito/QA-Wrap/releases/tag/v3.7.0', zip: 'https://github.com/NJ-Burrito/QA-Wrap/releases/download/v3.7.0/qa-wrap-3.7.0.zip', zipApi: '', sha256: '', notes: NOTES };

const browser = await chromium.launch({ headless: true });
async function open({ lang = 'en', host = 'missing', query = '?update=3.7.0', version = '3.6.9', platform = 'Win32', pending = PENDING, theme = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 }, colorScheme: theme || 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.QAW_DEBUG) { page.on('console', (m) => console.log('       console:', m.text())); page.on('pageerror', (e) => console.log('       pageerror:', e.message)); page.on('requestfailed', (r) => console.log('       reqfail:', r.url())); }
  await page.addInitScript(({ origin, lang, host, version, platform, pending }) => {
    localStorage.setItem('qaw-lang', lang);
    Object.defineProperty(navigator, 'platform', { get: () => platform });
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: platform === 'MacIntel' ? 'macOS' : 'Windows' }) });
    const store = { qawPendingNotes: pending };
    window.__log = { downloads: [], reloads: 0, sent: [], perm: 0 };
    window.__host = host; // 'missing' | 'ok' | 'fail'
    const rt = { id: 'x', lastError: undefined, getManifest: () => ({ version }), getURL: (p) => `${origin}/${p}`, reload: () => { window.__log.reloads++; } };
    rt.sendNativeMessage = (h, m, cb) => {
      window.__log.sent.push(m.op);
      setTimeout(() => { if (window.__host === 'missing') { rt.lastError = { message: 'Specified native messaging host not found.' }; cb(undefined); rt.lastError = undefined; } else cb({ ok: true, ping: true }); }, 20);
    };
    rt.connectNative = () => {
      const ml = [], dl = [];
      const port = { onMessage: { addListener: (f) => ml.push(f) }, onDisconnect: { addListener: (f) => dl.push(f) }, postMessage: (m) => {
        window.__log.sent.push(m.op);
        if (window.__host === 'missing') return;
        const say = (o, ms) => setTimeout(() => ml.forEach((f) => f(o)), ms);
        say({ stage: 'downloading' }, 20); say({ stage: 'checking' }, 140); say({ stage: 'installing' }, 260);
        say(window.__host === 'ok' ? { ok: true, from: '3.6.9', to: '3.7.0' } : { ok: false, error: 'checksum mismatch' }, 380);
      } };
      if (window.__host === 'missing') setTimeout(() => { rt.lastError = { message: 'Specified native messaging host not found.' }; dl.forEach((f) => f()); rt.lastError = undefined; }, 10);
      return port;
    };
    const area = { get: (k, cb) => { const ks = [].concat(k); const r = Object.fromEntries(ks.filter((x) => x in store).map((x) => [x, store[x]])); if (cb) { cb(r); return undefined; } return Promise.resolve(r); }, set: async (o) => Object.assign(store, o), remove: async () => {} };
    window.chrome = { runtime: rt, storage: { local: area, sync: area, session: area, onChanged: { addListener() {} } }, permissions: { request: async () => { window.__log.perm++; return true; }, contains: async () => true }, downloads: { download: async (o) => { window.__log.downloads.push(o.url); } }, i18n: { getUILanguage: () => 'en' } };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__log.copied = t; } } });
  }, { origin, lang, host, version, platform, pending });
  await page.goto(`${origin}/whatsnew/whatsnew.html${query}`);
  return { page, ctx, errors, log: () => page.evaluate(() => window.__log), setHost: (h) => page.evaluate((x) => { window.__host = x; }, h) };
}
const shot = (p, name) => (SHOTS ? p.page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : null); // viewport only, never fullPage

await test('parseNotes: sections in order, prefixes classify, markup dropped', () => {
  const s = parseNotes(NOTES);
  assert.deepEqual(s.map((x) => x.kind), ['added', 'changed', 'fixed']);
  assert.ok(s[0].items[0] === 'A new update page' && s[0].items[1].includes('<') === false);
  assert.deepEqual(s[2].items, ['the arrow']); assert.ok(s[0].items.includes('not a heading link'), 'an Added: prefix moves the line to Added');
  assert.deepEqual(parseNotes('plain line').map((x) => x.kind), ['other']);
  assert.equal(detectOS({ platform: 'MacIntel' }), 'mac');
  assert.equal(helperFile('win').path, 'updater\\install.cmd');
  assert.equal(helperFile('linux').path, 'updater/install.sh');
});

await test('(c) helper missing: two choices, nothing downloads, the file for this OS is named', async () => {
  const p = await open();
  await p.page.waitForSelector('.wn-panel');
  assert.equal(await p.page.locator('.wn-panel h2').innerText(), 'Turn on automatic updates (one time)');
  assert.equal(await p.page.locator('.wn-file code').innerText(), 'updater\\install.cmd');
  assert.equal(await p.page.locator('code.wn-cmd').innerText(), 'updater\\install.cmd -Quiet', 'the exact command is shown');
  assert.equal(await p.page.locator('.btn-primary').count(), 1, 'one primary');
  assert.equal(await p.page.locator('.wn-alt button').innerText(), 'Update manually instead');
  assert.ok((await p.page.locator('.wn-panel p').first().innerText()).split(/\s+/).length <= 25, 'explanation at most 25 words');
  assert.deepEqual((await p.log()).downloads, [], 'no silent zip download');
  await shot(p, 'c-helper-missing-en-win');
  await p.ctx.close();
  const m = await open({ platform: 'MacIntel' });
  await m.page.waitForSelector('.wn-panel');
  assert.equal(await m.page.locator('.wn-file code').innerText(), 'updater/install.sh');
  await m.ctx.close();
});

await test('Copy steps copies the file and the steps; manual is the only path that downloads', async () => {
  const p = await open();
  await p.page.waitForSelector('.wn-panel');
  await p.page.getByRole('button', { name: 'Copy steps' }).click();
  const l1 = await p.log();
  assert.match(l1.copied, /^updater\\install\.cmd\n1\. .*\n2\. Double-click install\.cmd\.\n3\. /);
  assert.deepEqual(l1.downloads, []);
  await p.page.getByRole('button', { name: 'Update manually instead' }).click();
  await p.page.waitForSelector('.wn-steps');
  assert.equal((await p.log()).downloads.length, 1);
  assert.equal(await p.page.locator('.wn-steps li').count(), 3);
  await shot(p, 'c2-manual-en');
  await p.ctx.close();
});

await test('Check again: still missing -> stays and says so; host appears -> the update runs by itself, stages advance, page reloads', async () => {
  const p = await open();
  await p.page.waitForSelector('.wn-panel');
  await p.page.getByRole('button', { name: 'Check again' }).click();
  await p.page.waitForFunction(() => document.querySelector('.wn-note')?.textContent.startsWith('Not found yet'));
  assert.deepEqual((await p.log()).downloads, []);
  await p.setHost('ok');
  await p.page.getByRole('button', { name: 'Check again' }).click();
  await p.page.waitForSelector('.wn-stages');
  await p.page.waitForFunction(() => document.querySelector('[data-stage="checking"]')?.dataset.s === 'active');
  await shot(p, 'a-updating-en');
  await p.page.waitForFunction(() => window.__log.reloads === 1, null, { timeout: 5000 });
  const states = await p.page.locator('.wn-stage').evaluateAll((l) => l.map((e) => e.dataset.s));
  assert.deepEqual(states, ['done', 'done', 'done', 'active']);
  const l = await p.log();
  assert.ok(l.perm >= 2 && l.sent.includes('ping') && l.sent.includes('update'));
  assert.deepEqual(l.downloads, []);
  await p.ctx.close();
});

await test('(d) failure: calm message, Try again, backup notice; Try again runs the update again', async () => {
  const p = await open({ host: 'fail' });
  await p.page.getByRole('button', { name: 'Try again' }).waitFor();
  assert.equal(await p.page.locator('h1').innerText(), 'The update did not finish');
  assert.match(await p.page.locator('.wn-backup').innerText(), /backup/i);
  await shot(p, 'd-failed-en');
  await p.setHost('ok');
  await p.page.getByRole('button', { name: 'Try again' }).click();
  await p.page.waitForFunction(() => window.__log.reloads === 1, null, { timeout: 5000 });
  await p.ctx.close();
});

await test('(b) updated: "You\'re on", notes as cards, HTML in the notes stays text and runs nothing', async () => {
  const p = await open({ query: '', version: '3.7.0' });
  await p.page.waitForSelector('.wn-sec');
  assert.equal(await p.page.locator('h1').innerText(), "You're on QA Wrap 3.7.0");
  assert.deepEqual(await p.page.locator('.wn-sec').evaluateAll((l) => l.map((e) => e.dataset.k)), ['added', 'changed', 'fixed']);
  assert.equal(await p.page.locator('.wn-notes img, .wn-notes script, .wn-notes a').count(), 0);
  assert.match(await p.page.locator('.wn-sec').nth(0).innerText(), /img src=x onerror="window\.__pwned=1"|img src=x onerror=/);
  assert.equal(await p.page.evaluate(() => window.__pwned), undefined);
  assert.equal(await p.page.locator('a.btn-primary').getAttribute('href'), PENDING.url);
  assert.equal(await p.page.locator('.btn-primary').count(), 1);
  await shot(p, 'b-updated-en');
  assert.deepEqual(p.errors, []);
  await p.ctx.close();
});

await test('Arabic: dir=rtl, Arabic strings, file name stays left-to-right; light and dark both render', async () => {
  const p = await open({ lang: 'ar', query: '', version: '3.7.0' });
  await p.page.waitForSelector('.wn-sec');
  assert.equal(await p.page.evaluate(() => document.documentElement.dir), 'rtl');
  assert.match(await p.page.locator('h1').innerText(), /^أنت على QA Wrap 3\.7\.0$/);
  assert.match(await p.page.locator('.wn-sec h2').first().innerText(), /أُضيف/);
  await shot(p, 'b-updated-ar');
  await p.ctx.close();
  const c = await open({ lang: 'ar' });
  await c.page.waitForSelector('.wn-panel');
  assert.equal(await c.page.evaluate(() => document.documentElement.dir), 'rtl');
  assert.equal(await c.page.locator('.wn-file code').evaluate((e) => getComputedStyle(e).direction), 'ltr');
  assert.match(await c.page.locator('.wn-panel h2').innerText(), /فعّل التحديث التلقائي/);
  await shot(c, 'c-helper-missing-ar');
  await c.ctx.close();
  const f = await open({ lang: 'ar', host: 'fail' });
  await f.page.getByRole('button', { name: 'حاول مجددًا' }).waitFor();
  await shot(f, 'd-failed-ar');
  await f.ctx.close();
  const d = await open({ query: '', version: '3.7.0', theme: 'dark' });
  await d.page.waitForSelector('.wn-sec');
  await shot(d, 'b-updated-en-dark');
  await d.ctx.close();
});

await test('no innerHTML / eval anywhere on the page code, and no Cairo', () => {
  for (const f of ['whatsnew/update-view.js', 'whatsnew/whatsnew.js', 'ui/update-lib.js']) {
    const src = fs.readFileSync(path.join(EXT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(src), f);
  }
  assert.ok(!/cairo/i.test(fs.readFileSync(path.join(EXT, 'whatsnew', 'whatsnew.css'), 'utf8')));
});

await browser.close();
server.close();
console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n} passed`);
process.exit(failed ? 1 : 0);
