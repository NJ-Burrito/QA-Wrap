/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-038: one real Chromium, headless, on the ZIP CONTENTS (not the working tree).
 *
 *   node tools/package.mjs && node tools/test-truth.mjs [--zip ../dist/qa-wrap-<ver>.zip] [--headed]
 *
 * One launch, many scenarios, no retry. Nightly and per release candidate, never per push (it is a
 * by-hand suite in run-suites.mjs). It holds the nine original scenarios plus the seven the first lane
 * never wrote, each of which asserts its ready state before it may pass (R15):
 *   fresh unzip + extension ID, T-019 consent repaint, T-014 keymap keeps text, T-037 top layer (4 cases),
 *   T-042 two-window ingest, T-010 sleeping-tab replay chunk, T-042 consent revision, the 6,000 px
 *   full-page capture, the browser killed mid-clip and restarted (UQA_RECORD_RESCUE, recoverPendingClips;
 * the one scenario that starts a second browser, on the same profile, and the last).
 * The one difference between the unpacked folder and the zip is the manifest's host permission, moved
 * from optional to required (what a tester's browser holds one press after "Allow"; lib-granted.mjs does
 * the same). Chrome draws that permission bubble itself, so no harness can answer it. A scenario asserts
 * that this is the only difference. Not covered here (Node tests on the working tree): the locator count
 * on an Arabic page with a live hidden duplicate beyond the four fixture pages.
 *
 * SESSION_TAG=<tag> puts the tag in the profile path so `relay.py sweep` can attribute the browser.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';
import { readZip } from './lib-zip.mjs';
import { seedV4, V4_EVENTS } from './lib-db-fixture.mjs';
import { truthAll, namedChecks } from './lib-truth.mjs';
import { recycle } from './lib-trash.mjs';
import { ON_FAILED, RING_KEY } from '../core/on.js';

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const DIST = path.resolve('..', 'dist');
// tools/package.mjs writes qa-wrap-<ver>.zip, build-browsers.mjs writes qa-wrap-<ver>-chrome.zip: newest version wins, then newest file.
const verKey = (f) => f.match(/^qa-wrap-(\d+)\.(\d+)\.(\d+)(?:-chrome)?\.zip$/)?.slice(1).map(Number).reduce((a, n) => a * 1000 + n, 0) ?? -1;
const ZIP = arg('--zip')
  ? path.resolve(arg('--zip'))
  : path.join(DIST, fs.readdirSync(DIST).filter((f) => verKey(f) >= 0)
    .sort((a, b) => verKey(b) - verKey(a) || fs.statSync(path.join(DIST, b)).mtimeMs - fs.statSync(path.join(DIST, a)).mtimeMs)[0] || 'none.zip');
const TAG = process.env.SESSION_TAG || 'truth';

const results = [];
const scenario = async (name, fn) => {
  try { await fn(); results.push([true, name]); console.log(`  ok  ${name}`); }
  catch (e) { results.push([false, name]); console.log(`  FAIL  ${name}\n        ${String(e.message).split('\n')[0]}`); }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

// Unpack the zip to a scratch folder: the thing a tester installs, not the tree.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `qaw-truth-${TAG}-`));
const extDir = path.join(tmp, 'ext');
const { entries } = readZip(ZIP);
for (const [name, e] of entries) {
  if (name.endsWith('/')) continue;
  const dest = path.join(extDir, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, e.data());
}
const zipManifest = JSON.parse(entries.get('manifest.json').data().toString('utf8'));
// The one line that differs from the zip: the site permission a tester grants, held from the start (see the header).
{
  const mf = JSON.parse(JSON.stringify(zipManifest));
  mf.host_permissions = ['<all_urls>'];
  delete mf.optional_host_permissions;
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(mf, null, 2));
}
console.log(`truth harness — ${ZIP} (${entries.size} entries)`);

// A page that answers every request with `real`, and records what it received.
let lastReq = null;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><title>truth</title><h1>x</h1>'); }
    // Two windows' pages, each with one button of its own; and a 6,000 px page of incompressible noise (the worst case for the stitch message).
    const win = req.url.match(/^\/w\/([ab])$/);
    if (win) { res.setHeader('content-type', 'text/html'); return res.end(`<!doctype html><title>window ${win[1]}</title><button id="b-${win[1]}">go ${win[1]}</button>`); }
    if (req.url === '/tall') {
      res.setHeader('content-type', 'text/html');
      return res.end(`<!doctype html><title>tall</title><style>html,body{margin:0}canvas{display:block}</style><canvas id="c"></canvas><script>
        const c = document.getElementById('c'); c.width = innerWidth; c.height = 6000;
        const x = c.getContext('2d'); const img = x.createImageData(c.width, c.height); const d = img.data;
        for (let o = 0; o < d.length; o += 65536) crypto.getRandomValues(new Uint8Array(d.buffer, o, Math.min(65536, d.length - o)));
        for (let i = 3; i < d.length; i += 4) d[i] = 255;
        x.putImageData(img, 0, 0); window.__ready = document.documentElement.scrollHeight;</script>`);
    }
    lastReq = { method: req.method, url: req.url, body, headers: req.headers };
    res.setHeader('content-type', 'application/json'); res.end('{"real":true}');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const launch = () => chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  channel: 'chromium', headless: !argv.includes('--headed'),
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-first-run'],
});
let ctx;
try {
  ctx = await launch();
  const onFailed = []; // T-055: core/on.js warned = a handler threw
  ctx.on('console', (m) => { if (ON_FAILED.test(m.text())) onFailed.push(m.text()); });
  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  const id = new URL(sw.url()).host;
  const zipVersion = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8')).version;

  await scenario('the worker from the zip boots and reports the zip version', async () => {
    const v = await sw.evaluate(() => chrome.runtime.getManifest().version);
    ok(v === zipVersion, `worker ${v} vs zip ${zipVersion}`);
  });

  const ext = await ctx.newPage();
  await ext.goto(`chrome-extension://${id}/welcome/welcome.html`);
  const stores = ['sessions', 'events', 'captures', 'media', 'mediaParts', 'mediaPending', 'replay'];
  const counts = () => ext.evaluate(async (s) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('uqa'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const out = {};
    for (const n of s) out[n] = db.objectStoreNames.contains(n) ? await new Promise((res) => { const c = db.transaction(n).objectStore(n).count(); c.onsuccess = () => res(c.result); }) : -1;
    db.close();
    return out;
  }, stores);

  const call = (m) => ext.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(250); } };

  await scenario('the zip loads unpacked from a fresh unzip and the ID reads the one the checklist names', async () => {
    // A folder made only from the zip's entries, in this run, and the ID Chrome derived from the manifest key.
    const files = fs.readdirSync(extDir, { recursive: true }).filter((f) => fs.statSync(path.join(extDir, f)).isFile());
    const want = [...entries.keys()].filter((n) => !n.endsWith('/'));
    ok(files.length === want.length, `unpacked ${files.length} files from ${want.length} zip entries`);
    const keyId = [...crypto.createHash('sha256').update(Buffer.from(zipManifest.key, 'base64')).digest('hex').slice(0, 32)]
      .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    const listed = fs.readFileSync(path.resolve('store', 'CHECKLIST.md'), 'utf8').match(/ID reads `([a-p]{32})`/)?.[1];
    ok(listed, 'store/CHECKLIST.md names no extension ID');
    ok(id === keyId && id === listed, `loaded ID ${id}, from the key ${keyId}, checklist ${listed}`);
    // The only difference between the unpacked manifest and the zip's is the granted host permission.
    const onDisk = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
    const keys = new Set([...Object.keys(onDisk), ...Object.keys(zipManifest)]);
    const differ = [...keys].filter((k) => JSON.stringify(onDisk[k]) !== JSON.stringify(zipManifest[k])).sort();
    ok(differ.join() === '', // ui-1019: the shipped manifest already holds <all_urls> `manifest differs from the zip in: ${differ.join()}`);
    // Settings, About reads the same ID from the running extension.
    const opt = await ctx.newPage();
    await opt.goto(`chrome-extension://${id}/options/options.html`);
    await opt.waitForFunction(() => document.getElementById('about-id')?.textContent, null, { timeout: 15000 });
    const shown = await opt.evaluate(() => document.getElementById('about-id').textContent);
    await opt.close();
    ok(shown === listed, `About shows ${shown}`);
  });

  await scenario('T-019 accepting the notice on another tab repaints an open popup out of the gated state', async () => {
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${id}/popup/popup.html`);
    await pop.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
    // Ready state first: a fresh profile is gated, the wall is inert, the card is showing.
    const gated = await pop.evaluate(() => ({ c: document.body.dataset.consented, inert: document.getElementById('body').inert, card: !document.getElementById('consent-card').hidden }));
    ok(gated.c === 'false' && gated.inert && gated.card, `popup was not gated at the start: ${JSON.stringify(gated)}`);
    const accepted = await call({ type: 'UQA_CONSENT_ACCEPT' }); // what the welcome page's button sends
    ok(accepted?.ok, `accept failed: ${JSON.stringify(accepted)}`);
    await pop.waitForFunction(() => document.body.dataset.consented === 'true', null, { timeout: 5000 }).catch(() => {});
    const after = await pop.evaluate(() => ({ c: document.body.dataset.consented, inert: document.getElementById('body').inert, card: !document.getElementById('consent-card').hidden }));
    await pop.close();
    ok(after.c === 'true' && !after.inert && !after.card, `popup still gated after the accept, no reload: ${JSON.stringify(after)}`);
  });

  await scenario('a v4 profile with history upgrades to v5 in real IndexedDB', async () => {
    const out = await ext.evaluate(async ([seedSrc, n]) => {
      const seed = new Function(`return (${seedSrc})`)();
      await seed(indexedDB, 'uqa', n);
      const db = await import('/core/db.js');
      const events = (await db.getEvents('s-v4')).length;
      const clips = (await db.listMedia('s-v4')).length;
      await db.putReplayChunk({ sessionId: 's-v4', seq: 0, entries: [{ t: 1 }] });
      return { events, clips, replay: (await db.getReplay('s-v4')).entries.length };
    }, [seedV4.toString(), V4_EVENTS]);
    ok(out.events === V4_EVENTS, `events ${out.events}`);
    ok(out.clips === 1, `clip rows ${out.clips}`);
    ok(out.replay === 1, `replay rows ${out.replay}`);
  });

  await scenario('erase-all empties every store of a real IndexedDB', async () => {
    const before = await counts();
    ok(before.sessions > 0 && before.events > 0 && before.replay > 0, `seed missing: ${JSON.stringify(before)}`);
    const res = await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'UQA_ERASE_ALL' }));
    const after = await counts();
    const left = Object.entries(after).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`);
    ok(!left.length, `left after erase: ${left.join(' ')} (reply ${JSON.stringify(res)?.slice(0, 120)})`);
  });

  // Page hooks from the zip, run in the MAIN world of a real page, switched on and given rules.
  const hooks = fs.readFileSync(path.join(extDir, 'content', 'page-hooks.js'), 'utf8');
  const page = await ctx.newPage();
  // OF-10: awake and rules reach the hooks only over the paired port, so this page plays the bridge's end of it.
  await page.addInitScript(`(() => {
    window.addEventListener('message', (e) => {
      if (e.source !== window || e.data?.source !== 'uqa-port' || window.__UQA_TEST_PORT__) return;
      e.stopImmediatePropagation();
      window.__UQA_TEST_PORT__ = e.ports[0];
      e.ports[0].postMessage('uqa-ack');
    }, true);
  })();`);
  await page.addInitScript(hooks);
  await page.goto(`${ORIGIN}/`);
  const arm = (rules) => page.evaluate((r) => {
    const rs = r.map((x) => ({ enabled: true, ...x }));
    window.__UQA_TEST_PORT__.postMessage({ t: 'awake', awake: true });
    window.__UQA_TEST_PORT__.postMessage({ t: 'rules', rules: rs });
    // A zip built before OF-10 still listens for the window shape; hooks that have the port ignore these two.
    window.postMessage({ source: 'uqa-awake', awake: true }, '*');
    window.postMessage({ source: 'uqa-rules', rules: rs }, '*');
    return new Promise((res) => setTimeout(res, 50));
  }, rules);
  const run = (fn) => page.evaluate(`(${fn})()`);

  await scenario('T-040 a fetch `mock` rule answers instead of throwing', async () => {
    await arm([{ id: 'm', action: 'mock', pattern: '/api/m', status: 201, body: '{"mocked":1}', label: 'm' }]);
    const r = await run(async () => { try { const x = await fetch('/api/m'); return { s: x.status, b: await x.text() }; } catch (e) { return { threw: String(e) }; } });
    ok(!r.threw, `fetch threw: ${r.threw}`);
    ok(r.s === 201 && r.b === '{"mocked":1}', `got ${JSON.stringify(r)}`);
  });

  await scenario('T-040 a fetch `graphqlError` rule answers 200 with errors', async () => {
    await arm([{ id: 'g', action: 'graphqlError', operation: 'Checkout', pattern: '/graphql', label: 'g' }]);
    const r = await run(async () => { try { const x = await fetch('/graphql', { method: 'POST', body: JSON.stringify({ operationName: 'Checkout', query: 'mutation Checkout{x}' }) }); return { s: x.status, b: await x.json() }; } catch (e) { return { threw: String(e) }; } });
    ok(!r.threw, `fetch threw: ${r.threw}`);
    ok(r.s === 200 && Array.isArray(r.b?.errors), `got ${JSON.stringify(r)}`);
  });

  await scenario('T-040 an XHR `mock` rule answers without throwing', async () => {
    await arm([{ id: 'x', action: 'mock', pattern: '/api/x', status: 202, body: '{"x":1}', label: 'x' }]);
    const r = await run(() => new Promise((res) => {
      try { const x = new XMLHttpRequest(); x.open('GET', '/api/x'); x.onloadend = () => res({ s: x.status, b: x.responseText }); x.send(); } catch (e) { res({ threw: String(e) }); }
    }));
    ok(!r.threw, `xhr threw: ${r.threw}`);
    ok(r.s === 202, `got ${JSON.stringify(r)}`);
  });

  await scenario('T-040 a header rule keeps a POST Request a POST with its body', async () => {
    await arm([{ id: 'h', action: 'header', pattern: '/api/h', headers: { 'x-qa': '1' }, label: 'h' }]);
    lastReq = null;
    await run(async () => { try { await fetch(new Request('/api/h', { method: 'POST', body: 'payload' })); } catch {} });
    ok(lastReq, 'the server saw no request');
    ok(lastReq.method === 'POST' && lastReq.body === 'payload', `server saw ${lastReq.method} body=${JSON.stringify(lastReq.body)}`);
  });

  await scenario('T-043 the zip\'s selector engine agrees with Playwright on the locator truth set', async () => {
    const tp = await ctx.newPage();
    const res = await truthAll(tp, path.join(extDir, 'content', 'selector-engine.js'));
    await tp.close();
    const bad = res.filter((r) => !r.ok);
    ok(!bad.length && !namedChecks(res).length, `agreement ${res.length - bad.length}/${res.length}: ${bad[0]?.id} ${bad[0]?.why || ''} ${namedChecks(res)[0] || ''}`);
  });
  /* ── the scenarios the first lane never wrote ───────────────────────────────────────────────────── */
  const zread = (f) => fs.readFileSync(path.join(extDir, f), 'utf8');

  await scenario('T-014 a refused note keeps the composer and the typed words (zip keymap.js, real DOM, real worker reply)', async () => {
    const kp = await ctx.newPage();
    let real = true;
    await kp.exposeFunction('__send', (m) => (real ? call(m) : { ok: true, result: { stored: true } }));
    await kp.goto(`${ORIGIN}/`);
    // The page-side host is a plain div (the product's is a closed shadow root no selector can reach); the worker's answer is the real one.
    await kp.evaluate(() => {
      window.__flashes = [];
      window.UQAUiHost = { uiLayer: () => { const d = document.createElement('div'); d.id = 'uqa-box'; document.body.append(d); return d; }, flash: (m, k) => window.__flashes.push([m, k || 'ok']) };
      window.UQABridge = { send: (m) => window.__send(m) };
    });
    await kp.addScriptTag({ content: zread('content/keymap.js') });
    ok(await kp.evaluate(() => typeof window.UQAKeymap?.promptNote === 'function'), 'keymap.js from the zip did not load');
    await kp.evaluate(() => window.UQAKeymap.promptNote());
    const input = kp.locator('#uqa-box input');
    await input.waitFor({ timeout: 3000 });
    ok(await input.evaluate((el) => document.activeElement === el), 'the composer input was not focused (ready state)');
    await input.fill('my precious words');
    await input.press('Enter');
    await kp.waitForFunction(() => window.__flashes.length > 0, null, { timeout: 5000 });
    const refused = await kp.evaluate(() => ({ flashes: window.__flashes, boxes: document.querySelectorAll('#uqa-box').length, value: document.querySelector('#uqa-box input')?.value }));
    ok(refused.boxes === 1 && refused.value === 'my precious words', `after a refusal: ${JSON.stringify(refused)}`);
    ok(refused.flashes.every(([, k]) => k === 'err') && /Start a session before adding notes/.test(refused.flashes[0][0]), `refusal flash: ${JSON.stringify(refused.flashes)}`);
    // Known-true positive sample: an acknowledged write does close the composer and says so.
    real = false;
    await input.press('Enter');
    await kp.waitForFunction(() => window.__flashes.length > 1, null, { timeout: 5000 });
    const accepted = await kp.evaluate(() => ({ last: window.__flashes.at(-1), boxes: document.querySelectorAll('#uqa-box').length }));
    await kp.close();
    ok(accepted.boxes === 0 && accepted.last[1] === 'ok', `after an acknowledged write: ${JSON.stringify(accepted)}`);
  });

  // T-037: the bar's real scripts from the zip, a modal dialog / transformed modal / popover / fullscreen, a real click on Stop.
  const OVERLAY_KEYS = /^(overlay\.|popup\.pick\.(head|any|step|element|sensitive)$|popup\.live\.(stop|noLocator|copyAgain)$|options\.sound\.ui\.copy$|options\.actions\.shot\.label$|popup\.note\.add$)/;
  const fontsCss = zread('ui/fonts.css');
  const faces = [400, 500].map((w) => fontsCss.match(new RegExp(`'Thmanyah Sans';[^}]*?weight: ${w};[^}]*?base64,([^')]+)`))?.[1]).filter(Boolean);
  const enStrings = JSON.parse(zread('platform/i18n/en.json'));
  const strings = Object.fromEntries(Object.keys(enStrings).filter((k) => OVERLAY_KEYS.test(k)).map((k) => [k, enStrings[k]]));
  const assets = { faces, css: zread('content/overlay.css'), strings, lang: 'en', dir: 'ltr', theme: null };
  const barScripts = ['ui/icons.js', 'ui/tone.js', 'content/ui-host.js', 'content/bar.js'].map(zread);
  const TOP_FIXTURE = pathToFileURL(path.resolve('tools', 'fixtures', 'top-layer.html')).href;
  for (const kind of ['modal', 'modal-transform', 'popover', 'fullscreen']) {
    await scenario(`T-037 top layer (${kind}): the bar's Stop stays reachable and a real click reaches the worker`, async () => {
      const tl = await ctx.newPage();
      await tl.setViewportSize({ width: 900, height: 700 });
      await tl.addInitScript(({ assets: a }) => {
        let onMsg = null;
        window.__sent = [];
        window.chrome = {
          runtime: {
            id: 'x', lastError: undefined,
            sendMessage: (m, cb) => { window.__sent.push(m?.type); cb && cb(m?.type === 'UQA_OVERLAY_ASSETS' ? { ok: true, result: a } : { ok: true, result: null }); },
            onMessage: { addListener: (fn) => { onMsg = fn; } },
          },
          storage: { sync: { get: (k, cb) => cb({}), set() {} }, local: { get: (k, cb) => cb && cb({}), set() {} }, onChanged: { addListener() {} } },
          i18n: { getUILanguage: () => 'en' },
        };
        window.__ask = () => new Promise((r) => onMsg?.({ type: 'UQA_UI_HIDE', hidden: false, measure: true }, { id: 'x' }, r));
        let push = null;
        window.UQABridge = { send(m) { window.__sent.push(m?.type); }, watch: (fn) => { push = fn; } };
        window.__push = (st) => push && push(st);
      }, { assets });
      await tl.goto(`${TOP_FIXTURE}?case=${kind}`);
      for (const code of barScripts) await tl.addScriptTag({ content: code });
      await tl.waitForFunction(() => !!window.UQABar && typeof window.__push === 'function', null, { timeout: 8000 });
      await tl.evaluate(() => window.__push({ recording: true, startedAt: Date.now(), problems: 0 }));
      await tl.waitForTimeout(900);
      if (kind === 'fullscreen') await tl.click('#open-fs'); else await tl.evaluate(() => window.__open());
      await tl.waitForTimeout(700);
      const m = await tl.evaluate(() => window.__ask());
      const c = (m.controls || []).find((b) => /Stop/.test(b.label || ''));
      ok(c, 'no Stop control in the measured bar (ready state)');
      const at = { x: c.left + c.width / 2, y: c.top + c.height / 2 };
      await tl.mouse.move(at.x, at.y); // a bar the pointer is away from fades and goes click-through
      await tl.waitForTimeout(150);
      const hit = await tl.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.localName, at);
      await tl.mouse.click(at.x, at.y);
      const sent = await tl.evaluate(() => window.__sent);
      await tl.close();
      ok(hit === 'qaw-ui', `elementFromPoint at Stop hit <${hit}>`);
      ok(sent.includes('UQA_STOP'), `a real click on Stop sent ${JSON.stringify(sent)}`);
    });
  }

  // Windows, sessions and the extension's own pages from here on.
  const newWindow = async (url) => {
    const [pg] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 15000 }),
      ext.evaluate((u) => chrome.windows.create({ url: u, focused: false, width: 1100, height: 800 }).then((w) => w.id), url),
    ]);
    await pg.waitForLoadState('load');
    return pg;
  };
  const tabOf = (url) => ext.evaluate(async (u) => { const t = (await chrome.tabs.query({})).find((x) => x.url === u); return t && { tabId: t.id, windowId: t.windowId }; }, url);
  const eventsOf = (sid) => ext.evaluate(async (s) => (await (await import('/core/db.js')).getEvents(s)).map((e) => ({ kind: e.kind, action: e.action, frameUrl: e.frameUrl, tabId: e.tabId })), sid);
  const sessionOf = (sid) => ext.evaluate(async (s) => (await import('/core/db.js')).getSession(s), sid);
  // A message a content script would send, from inside the page's tab (the isolated world: the sender is that tab).
  const fromTab = (tabId, msg) => sw.evaluate(async ([t, m]) => (await chrome.scripting.executeScript({ target: { tabId: t }, world: 'ISOLATED', func: (x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), args: [m] }))[0].result, [tabId, msg]);
  const startIn = async (w, label) => {
    const armedRes = await call({ type: 'UQA_ARM', windowId: w.windowId });
    ok(armedRes?.ok, `window ${w.windowId} would not wake: ${JSON.stringify(armedRes)}`);
    const started = await call({ type: 'UQA_START', charter: label, tabId: w.tabId });
    const sid = started?.result?.id || started?.result?.session?.id;
    ok(sid, `no session in window ${w.windowId}: ${JSON.stringify(started)}`);
    return sid;
  };
  const W = {}; // shared by the next scenarios

  await scenario('T-042 two windows record at once, and each click lands in its own window\'s session', async () => {
    ok((await call({ type: 'UQA_CONSENT_ACCEPT' }))?.ok, 'could not record the consent'); // erase-all may have cleared it
    W.pageA = await ctx.newPage();
    await W.pageA.goto(`${ORIGIN}/w/a`);
    W.pageB = await newWindow(`${ORIGIN}/w/b`);
    W.a = await tabOf(`${ORIGIN}/w/a`);
    W.b = await tabOf(`${ORIGIN}/w/b`);
    ok(W.a && W.b && W.a.windowId !== W.b.windowId, `not two windows: ${JSON.stringify([W.a, W.b])}`);
    W.sidA = await startIn(W.a, 'truth A');
    W.sidB = await startIn(W.b, 'truth B');
    ok(W.sidA !== W.sidB, 'both windows got the same session');
    const a = await sessionOf(W.sidA);
    ok(a && a.status === 'recording' && !a.endedAt, `starting window B ended window A's run: ${JSON.stringify(a && { status: a.status, endedAt: a.endedAt })}`);
    const clickUntil = async (pg, sel, sid, tail) => until(async () => {
      await pg.bringToFront();
      await pg.click(sel);
      await sleep(400);
      return (await eventsOf(sid)).some((e) => e.action === 'click' && e.frameUrl?.endsWith(tail));
    }, 10000);
    ok(await clickUntil(W.pageA, '#b-a', W.sidA, '/w/a'), 'window A\'s click never reached session A (ready state)');
    ok(await clickUntil(W.pageB, '#b-b', W.sidB, '/w/b'), 'window B\'s click never reached session B (ready state)');
    const [ea, eb] = [await eventsOf(W.sidA), await eventsOf(W.sidB)];
    ok(!ea.some((e) => e.frameUrl?.endsWith('/w/b')), 'window B\'s events were filed under session A');
    ok(!eb.some((e) => e.frameUrl?.endsWith('/w/a')), 'window A\'s events were filed under session B');
    ok(ea.filter((e) => e.action === 'click').every((e) => e.tabId === W.a.tabId), 'session A holds a click from another tab');
  });

  await scenario('T-010 a sleeping tab\'s replay chunk is refused; the armed tab\'s is stored', async () => {
    ok(W.sidA && W.b, 'the two-window scenario did not leave its windows');
    const slept = await call({ type: 'UQA_DISARM', windowId: W.b.windowId });
    ok(slept?.ok && slept.result.armed === false, `window B did not sleep: ${JSON.stringify(slept)}`);
    const live = await fromTab(W.a.tabId, { type: 'UQA_REPLAY_CHUNK', entries: [{ t: 1, truth: 'from-armed-tab' }] });
    ok(live?.ok && live.result?.sessionId === W.sidA, `the armed tab's chunk was not accepted (ready state): ${JSON.stringify(live)}`);
    const refused = await fromTab(W.b.tabId, { type: 'UQA_REPLAY_CHUNK', entries: [{ t: 2, truth: 'from-sleeping-tab' }] });
    ok(refused && refused.ok === false && refused.code === 'ASLEEP', `the sleeping tab's chunk answered ${JSON.stringify(refused)}`);
    const replay = await ext.evaluate(async (s) => (await (await import('/core/db.js')).getReplay(s)).entries.map((e) => e.truth).filter(Boolean), W.sidA);
    ok(replay.includes('from-armed-tab') && !replay.includes('from-sleeping-tab'), `replay holds ${JSON.stringify(replay)}`);
  });

  await scenario('T-042 a consent revision bump refuses a new wake with a coded error and never sleeps a live window', async () => {
    ok(W.sidA && W.b, 'the two-window scenario did not leave its windows');
    await sw.evaluate(() => chrome.storage.local.set({ consentRevision: 0 }));
    const wake = await call({ type: 'UQA_ARM', windowId: W.b.windowId });
    const stillLive = await fromTab(W.a.tabId, { type: 'UQA_REPLAY_CHUNK', entries: [{ t: 3, truth: 'after-bump' }] });
    await call({ type: 'UQA_CONSENT_ACCEPT' }); // the welcome page, accepted again
    const again = await call({ type: 'UQA_ARM', windowId: W.b.windowId });
    ok(wake?.ok === false && wake.code === 'NEEDS_CONSENT', `the wake after a bump answered ${JSON.stringify(wake)}`);
    ok(stillLive?.ok && stillLive.result?.sessionId === W.sidA, `the live window was cut off by the bump: ${JSON.stringify(stillLive)}`);
    ok(again?.ok, `the wake after accepting again answered ${JSON.stringify(again)}`);
  });

  await scenario('T-038 a 6,000 px page of noise stitches into one 6,000 px image under the message limit', async () => {
    const pg = await newWindow(`${ORIGIN}/tall`);
    await pg.waitForFunction(() => window.__ready, null, { timeout: 15000 });
    ok((await pg.evaluate(() => window.__ready)) === 6000, 'the fixture page is not 6,000 px tall (ready state)');
    const w = await tabOf(`${ORIGIN}/tall`);
    W.sidTall = await startIn(w, 'truth tall');
    const shot = await call({ type: 'UQA_CAPTURE_FULL', tabId: w.tabId });
    ok(shot?.ok, `the full-page capture answered ${JSON.stringify(shot)?.slice(0, 300)}`);
    const dim = await ext.evaluate(async (id) => {
      const m = await (await import('/core/db.js')).getMedia(id);
      const b = await createImageBitmap(m.blob);
      return { w: b.width, h: b.height, type: m.type, bytes: m.blob.size };
    }, shot.result.id);
    await pg.close();
    console.log(`        6,000 px capture: ${shot.result.tiles} tiles, ${dim.w}x${dim.h}, ${(dim.bytes / 1048576).toFixed(1)} MB`);
    ok(dim.type === 'image/png' && dim.h === 6000, `stored image is ${dim.type} ${dim.w}x${dim.h}, not 6,000 px tall`);
    ok(shot.result.tiles >= 6 && dim.bytes > 5_000_000, `${shot.result.tiles} tiles, ${dim.bytes} bytes: the noise did not make the message large`);
  });

  await scenario('T-055 no handler failed during the run and the ring is empty', async () => {
    const ring = await sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k] || [], RING_KEY);
    ok(!onFailed.length && !ring.length, `on.js warned ${onFailed.length}x (${onFailed[0] || ''}), ring ${JSON.stringify(ring).slice(0, 160)}`);
  });

  // Last, because it ends the browser. Chrome re-runs onStartup only on a new browser start; measured: chrome.runtime.reload()
  // some seconds after launch leaves a flag-loaded extension disabled with no worker, so the kill is a real restart on the same profile.
  await scenario('T-038 the browser killed mid-clip: on the next start the half-written clip is recovered, stranded sessions close, rescue refuses honestly', async () => {
    // What a document that died mid-recording leaves: a pending marker and the parts written so far.
    await ext.evaluate(async () => {
      const db = await import('/core/db.js');
      await db.putSession({ id: 's-kill', seq: 99, charter: 'killed mid-clip', startedAt: Date.now() - 60000, endedAt: null, status: 'recording', windowId: null });
      await db.putMediaPending({ id: 'clip-kill', sessionId: 's-kill', startedAt: Date.now() - 5000, label: 'Screen recording', type: 'video/webm', ext: 'webm', sources: { tab: true } });
      await db.putMediaPart('clip-kill', 0, new Blob(['part-zero-'], { type: 'video/webm' }));
      await db.putMediaPart('clip-kill', 1, new Blob(['part-one'], { type: 'video/webm' }));
    });
    const before = await ext.evaluate(async () => { const db = await import('/core/db.js'); return { pending: (await db.listMediaPending()).map((r) => r.id), clip: !!(await db.getMedia('clip-kill')) }; });
    ok(before.pending.includes('clip-kill') && !before.clip, `seed (ready state): ${JSON.stringify(before)}`);
    const live = await sessionOf(W.sidA);
    ok(live?.status === 'recording', `session A was not recording when the browser died (ready state): ${live?.status}`);
    await ctx.close();
    ctx = await launch();
    sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
    ok(new URL(sw.url()).host === id, 'the restarted worker is another extension');
    const rp = await ctx.newPage();
    await rp.goto(`chrome-extension://${id}/welcome/welcome.html`);
    const probe = () => rp.evaluate(async () => {
      const db = await import('/core/db.js');
      const clip = await db.getMedia('clip-kill');
      return { clip: clip && { incomplete: clip.incomplete, label: clip.label, bytes: clip.blob.size }, pending: (await db.listMediaPending()).map((r) => r.id), parts: (await db.mediaParts('clip-kill')).length, killSession: (await db.getSession('s-kill'))?.status ?? null }; // killSession: null with the rest gone = the whole seed was lost (nothing flushed), not a clear aimed at the clip
    });
    const got = await until(async () => { const r = await probe(); return r.clip ? r : null; }, 15000);
    ok(got, `the clip was not recovered after the restart: ${JSON.stringify(await probe())}`);
    ok(/recovered/.test(got.clip.label) && got.clip.incomplete && got.clip.bytes === 'part-zero-part-one'.length, `recovered clip: ${JSON.stringify(got.clip)}`);
    ok(!got.pending.includes('clip-kill') && got.parts === 0, `the marker or the parts were left behind: ${JSON.stringify(got)}`);
    const stranded = await rp.evaluate(async (ids) => { const db = await import('/core/db.js'); return Promise.all(ids.map(async (i) => { const x = await db.getSession(i); return [i, x?.status, !!x?.endedAt]; })); }, ['s-kill', W.sidA, W.sidTall].filter(Boolean));
    ok(stranded.every(([, st, ended]) => st !== 'recording' && ended), `sessions left recording after the restart: ${JSON.stringify(stranded)}`);
    // UQA_RECORD_RESCUE is for a clip the database refused; with none in memory it says so and writes nothing.
    const rescue = await rp.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'UQA_RECORD_RESCUE' }, r)));
    await rp.close();
    ok(rescue?.ok === false && /no unsaved clip/i.test(rescue.error || ''), `UQA_RECORD_RESCUE answered ${JSON.stringify(rescue)}`);
  });
} catch (err) {
  results.push([false, 'harness ran to the end']);
  console.log(`  FAIL  harness ran to the end\n        ${err.message}`);
} finally {
  await ctx?.close().catch(() => {});
  server.close();
  recycle(tmp, 'truth scratch');
}

const failed = results.filter(([k]) => !k).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
