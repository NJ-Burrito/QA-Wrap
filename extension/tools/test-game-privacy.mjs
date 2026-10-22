/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt privacy (DESIGN-bug-hunt sections 2.6 and 12; Autopilot & ADHD rule 12 in spirit): the finale is paste-only and
 * stores nothing, the game never reads the clipboard, never talks to anyone but its own server, and never touches the
 * extension's storage.
 *
 *   node tools/test-game-privacy.mjs        (from extension/, PYTHONUTF8=1)
 *
 * Headless Chromium against the game's own server on a free loopback port. Spies are installed before any page script on
 * Storage.setItem, document.cookie, indexedDB.open, fetch, XMLHttpRequest, sendBeacon, WebSocket and navigator.clipboard.
 * A real-looking report with a secret marker in its body is pasted; the marker must appear nowhere but the one heading line
 * on screen. (That `rememberedSites` stays empty after a full play with the REAL extension is test-game-live.mjs.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import { GAME, missing, startGame, launch, openGame, reach, STORE_KEY } from './lib-game.mjs';

const need = missing('index.html', 'game.js', 'engine.js', 'server.mjs');
if (need.length) {
  skipNotEnforced({ rule: 'game', what: 'paste-only finale and egress', why: `game/${need.join(', game/')} have not landed` });
  finish('test-game-privacy', { skipped: 1 });
}

/* ---- static: nothing external, nothing from the extension, no clipboard read ------------------------------------------- */
{
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(?:m?js|css|html|json|svg)$/.test(e.name)) files.push(f); } };
  walk(GAME);
  nonEmpty(files, 'game files');
  const EXTERNAL = /https?:\/\/(?!localhost(?::\d+)?\b|127\.0\.0\.1|www\.w3\.org\/)[^\s"'`)<>]+/g;
  const hits = files.flatMap((f) => (fs.readFileSync(f, 'utf8').match(EXTERNAL) || []).map((u) => `${path.relative(GAME, f)}: ${u}`));
  ok(hits.length === 0, 'no external URL anywhere in game/** (only localhost, 127.0.0.1 and the SVG namespace)', hits.slice(0, 4).join(' | '));
  proveTeeth('the external-URL scan', (t) => (t.match(EXTERNAL) || []), 'fetch("https://example.com/x")');
  const code = files.filter((f) => /\.m?js$/.test(f)).map((f) => [path.relative(GAME, f), fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
  const ext = code.filter(([, t]) => /\bchrome\s*\.\s*(?:runtime|storage|tabs|permissions)|rememberedSites|autoStartSites|autoShotSites|bufferSites/.test(t)).map(([f]) => f);
  ok(ext.length === 0, 'the game never touches chrome.* or the extension\'s site lists (rememberedSites, autoStartSites, autoShotSites, bufferSites)', ext.join());
  const reads = code.filter(([, t]) => /clipboard\s*\.\s*read/.test(t)).map(([f]) => f);
  ok(reads.length === 0, 'no clipboard.read / readText anywhere (no permission prompt is ever possible)', reads.join());
  const net = code.filter(([f, t]) => !/^(?:server)/.test(f) && /\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b|\bEventSource\b|importScripts/.test(t)).map(([f]) => f);
  ok(net.length === 0, 'no XMLHttpRequest, WebSocket, sendBeacon or EventSource in the game code', net.join());
  const cookie = code.filter(([, t]) => /document\s*\.\s*cookie|indexedDB|caches\s*\./.test(t)).map(([f]) => f);
  ok(cookie.length === 0, 'no cookie, IndexedDB or Cache API use', cookie.join());
  const keys = new Set(code.flatMap(([, t]) => [...t.matchAll(/(?:localStorage|storage)\s*\.\s*(?:getItem|setItem|removeItem)\(\s*([^),]+)/g)].map((m) => m[1].trim())));
  ok([...keys].every((k) => /STORAGE_KEY|TRIAL_KEY|GAME_KEY|['"`]bughunt\.v1['"`]|\bkey\b/.test(k)), 'the only storage keys are bughunt.v1 and the trials own bughunt.trial.v1 (allow-list: TRIAL_KEY, GAME_KEY in trial.js and trial-ui.js)', [...keys].join());
}

/* ---- the live page ------------------------------------------------------------------------------------------------ */
const SPY = `(() => {
  const S = window.__spy = { storage: [], cookie: [], idb: 0, fetch: [], xhr: [], beacon: [], ws: [], clip: { read: 0, readText: 0, write: [] } };
  const sset = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { S.storage.push(k + '=' + v); return sset.call(this, k, v); };
  const d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (d) Object.defineProperty(document, 'cookie', { get() { return d.get.call(document); }, set(v) { S.cookie.push(String(v)); d.set.call(document, v); }, configurable: true });
  if (window.indexedDB) { const o = IDBFactory.prototype.open; IDBFactory.prototype.open = function (...a) { S.idb++; return o.apply(this, a); }; }
  const f = window.fetch; window.fetch = function (u, i) { S.fetch.push(String(u && u.url || u) + ' ' + String((i && i.body) || '')); return f.apply(this, arguments); };
  const xo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { S.xhr.push(String(u)); return xo.apply(this, arguments); };
  if (navigator.sendBeacon) { const b = navigator.sendBeacon; navigator.sendBeacon = function (u, data) { S.beacon.push(String(u)); return b.call(this, u, data); }; }
  const W = window.WebSocket; window.WebSocket = function (u, p) { S.ws.push(String(u)); return new W(u, p); };
  if (navigator.clipboard) {
    const c = navigator.clipboard;
    c.read = async () => { S.clip.read++; return []; }; c.readText = async () => { S.clip.readText++; return ''; };
    c.writeText = async (t) => { S.clip.write.push(String(t)); };
  }
})();`;
const BODY = 'SECRETBODY-9921';
const HEAD = 'SECRETHEAD-4417';
const REPORT = `# Checkout failed ${HEAD}\n\n## Steps to reproduce\n1. Press Pay and wait ${BODY}\n2. Nothing happens\n\n| Problems | 2 |\n`;
const paste = (page, text) => page.evaluate((t) => {
  const ta = document.getElementById('pasteBox');
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  ta.focus();
  ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return { value: ta.value };
}, text);
const spy = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__spy)));
const counts = (s) => s.idb + s.fetch.length + s.xhr.length + s.beacon.length + s.ws.length + s.cookie.length;

const g = await startGame();
const browser = await launch();
try {
  const o = await openGame(browser, g, { init: SPY });
  const { page } = o;
  /* a scripted play: level 1 for real (Save fires the game's own request), the rest skipped, then the finale */
  await reach(page, 'play', 1);
  await page.click('#save');
  await page.waitForFunction(() => /./.test(document.getElementById('save-state')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
  await reach(page, 'finale');
  await page.waitForTimeout(600);

  const before = await spy(page);
  nonEmpty(before.fetch, 'fetches the spy recorded (the spy works; Save fired the own-server request)');
  ok(before.clip.read === 0 && before.clip.readText === 0, 'the clipboard was never read during a full play to the finale');
  ok(before.fetch.every((f) => /^\/api\/|^https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/|^\/[\w./-]+/.test(f) || f.startsWith(g.origin)), 'every fetch of the play targets the game\'s own server', before.fetch.slice(0, 4).join(' | '));
  ok(before.xhr.length === 0 && before.beacon.length === 0 && before.ws.length === 0 && before.idb === 0 && before.cookie.length === 0, 'no XHR, beacon, WebSocket, IndexedDB or cookie write during the play');

  /* valid report, then junk */
  const r1 = await paste(page, REPORT);
  await page.waitForTimeout(400);
  const after = await spy(page);
  const shown = await page.evaluate(() => ({ body: document.body.innerText, result: document.getElementById('pasteResult').innerText, value: document.getElementById('pasteBox').value }));
  ok(r1.value === '' && shown.value === '', 'after a paste the textarea is emptied at once');
  ok(shown.result.includes(HEAD) && shown.result.length < 400, 'the result shows the first heading line (cut to 60) and the line count only', shown.result.slice(0, 120));
  ok(!shown.body.includes(BODY), 'no later line of the pasted report appears anywhere on the page');
  ok(counts(after) === counts(before), 'the paste made zero requests, beacons, sockets, IndexedDB opens or cookie writes', JSON.stringify({ before: counts(before), after: counts(after) }));
  const writes = after.storage.slice(before.storage.length);
  ok(!writes.some((w) => w.includes(BODY) || w.includes(HEAD) || w.includes('Checkout')), 'no localStorage write contains any part of the pasted text', writes.join(' | ').slice(0, 160));
  ok(!JSON.stringify(after.fetch).includes(BODY) && !JSON.stringify(after.fetch).includes(HEAD), 'no request contains any part of the pasted text');
  ok(after.clip.read === 0 && after.clip.readText === 0, 'pasting never calls clipboard.read / readText');

  await page.click('#btnCopyScore');
  await page.waitForTimeout(300);
  const copied = (await spy(page)).clip.write.join('\n');
  ok(copied.length > 0 && !copied.includes(BODY) && !copied.includes(HEAD) && !/Checkout/.test(copied), '"Copy score" copies the score text only, nothing from the pasted report', copied.slice(0, 100));

  const r2 = await paste(page, 'hello world, not a report');
  await page.waitForTimeout(300);
  const junk = await page.evaluate(() => ({ result: document.getElementById('pasteResult').innerText, value: document.getElementById('pasteBox').value }));
  const afterJunk = await spy(page);
  ok(r2.value === '' && junk.value === '', 'junk is not kept in the textarea either');
  ok(junk.result.trim().length > 0 && !junk.result.includes('hello world'), 'junk gets the one-line "not yet" answer, and its text is not echoed', junk.result.slice(0, 100));
  ok(!afterJunk.storage.some((w) => w.includes('hello world')), 'junk is not stored');

  /* what is stored at the end, and after a reload */
  const stored = await page.evaluate((k) => ({ ls: localStorage.getItem(k), ss: JSON.stringify(sessionStorage), keys: Object.keys(localStorage), cookie: document.cookie }), STORE_KEY);
  ok(stored.keys.length === 1 && stored.keys[0] === STORE_KEY, 'localStorage holds only bughunt.v1', stored.keys.join());
  ok(![BODY, HEAD, 'Checkout', 'hello world'].some((m) => (stored.ls + stored.ss + stored.cookie).includes(m)), 'neither storage nor cookie holds any pasted text');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  ok(!(await page.evaluate(() => document.body.innerText)).includes(HEAD), 'after a reload the pasted heading is gone from the page');

  /* everything the page ever asked for */
  const foreign = o.reqs.filter((r) => !/^(?:data|blob):/.test(r.url) && new URL(r.url).origin !== g.origin);
  ok(foreign.length === 0, `all ${o.reqs.length} requests of the whole run went to the game's own origin`, foreign.slice(0, 3).map((r) => r.url).join(' | '));
  ok(g.requests.length > 0 && g.requests.every((r) => !r.contentLength), `the server saw ${g.requests.length} requests and every body had length 0`, JSON.stringify(g.requests.find((r) => r.contentLength)));
  ok(o.errors.length === 0, 'no page error', o.errors.join(' | '));
  await o.close();

  /* the teeth: a spy that sees a leak goes red */
  proveTeeth('the leak check', (w) => w.filter((x) => x.includes(BODY)), [`bughunt.v1=${BODY}`]);
} catch (err) {
  ok(false, `run aborted: ${err.message}`, String(err.stack).split('\n').slice(1, 3).join(' | '));
} finally {
  await browser.close();
  await g.close();
}
finish('test-game-privacy');
