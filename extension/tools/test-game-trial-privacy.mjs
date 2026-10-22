/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt hard trials, privacy (DESIGN-bug-hunt-hard.md sections 3.7, 6 and 11; Autopilot & ADHD rule 12 in spirit; lane T3).
 *
 *   node tools/test-game-trial-privacy.mjs        (from extension/, PYTHONUTF8=1)
 *
 * Static: no external URL, no chrome.*, no clipboard read, no cookie / IndexedDB / Cache API, no new confirm( in game/**.
 * Live (headless Chromium, the game's own server, Playwright's mocked clock): the real game/trial.js plays stage 7 to the hand-off,
 * then a junk text, a stale report (another attempt's word) and a valid report with a secret marker in its body are pasted.
 *   - the junk and the stale report are ignored with one plain line, no event, no clear;
 *   - the valid report is accepted; the textarea is emptied; only the heading (<= 60 chars) and the line count are reported;
 *   - the marker in the body appears nowhere: not on screen, not in any storage or cookie write, not in any request;
 *   - the only requests are the planted ones, to the game's own origin, with no body; no clipboard.read, no XHR / beacon / WebSocket / IDB;
 *   - the only key written is bughunt.trial.v1 and it holds neither the heading nor the body.
 * Skips with exit 2 while game/trial.js (T1) has not landed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ok, nonEmpty, proveTeeth, finish } from './lib-assert.mjs';
import * as L from './lib-game-trial.mjs';
import * as B from './lib-game-trial-pw.mjs';

const SUITE = 'test-game-trial-privacy';
L.needTrial(SUITE);

/* ---- static ---------------------------------------------------------------------------------------------------------- */
{
  const files = L.gameSources();
  nonEmpty(files, 'game files');
  const EXTERNAL = /https?:\/\/(?!localhost(?::\d+)?\b|127\.0\.0\.1|www\.w3\.org\/)[^\s"'`)<>]+/g;
  const hits = files.flatMap(([f, s]) => (s.match(EXTERNAL) || []).map((u) => `${f}: ${u}`));
  ok(hits.length === 0, 'no external URL anywhere in game/** (only localhost, 127.0.0.1 and the SVG namespace)', hits.slice(0, 4).join(' | '));
  proveTeeth('the external-URL scan', (t) => (t.match(EXTERNAL) || []), 'fetch("https://example.com/x")');
  const trial = L.trialSources().filter(([f]) => /\.m?js$/.test(f)).map(([f, s]) => [f, L.stripComments(s)]);
  nonEmpty(trial, 'trial code files');
  const chrome = trial.filter(([, s]) => /\bchrome\s*\.\s*(?:runtime|storage|tabs|permissions)|rememberedSites|autoStartSites|autoShotSites|bufferSites/.test(s)).map(([f]) => f);
  ok(chrome.length === 0, 'the trial never touches chrome.* or the extension\'s site lists', chrome.join());
  const clip = trial.filter(([, s]) => /clipboard\s*\.\s*(?:read|readText)\b|execCommand\(\s*['"]paste/.test(s)).map(([f]) => f);
  ok(clip.length === 0, 'the trial never reads the clipboard (paste events only: no permission prompt is possible)', clip.join());
  const side = trial.filter(([, s]) => /document\s*\.\s*cookie|indexedDB|caches\s*\.|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts/.test(s)).map(([f]) => f);
  ok(side.length === 0, 'the trial uses no cookie, IndexedDB, Cache API, XHR, WebSocket or beacon', side.join());
  const conf = trial.filter(([, s]) => /\bconfirm\s*\(/.test(s)).map(([f]) => f);
  ok(conf.length === 0, 'no confirm( in the trial code (the one allowed confirm( is Reset in game.js)', conf.join());
  const all = files.filter(([f]) => /\.m?js$/.test(f)).filter(([f]) => !/^server/.test(f)).map(([f, s]) => [f, L.stripComments(s)]);
  const confs = all.filter(([, s]) => /\bconfirm\s*\(/.test(s)).map(([f]) => f);
  ok(confs.every((f) => f === 'game.js'), 'confirm( appears only in game.js (Reset progress)', confs.join());
  const storeKeys = new Set(trial.flatMap(([, s]) => [...s.matchAll(/(?:localStorage|sessionStorage|storage)\s*\.\s*setItem\(\s*([^),]+)/g)].map((m) => m[1].trim())));
  ok([...storeKeys].every((k) => /KEY|['"`]bughunt\.trial\.v1['"`]|\bkey\b|['"`]bughunt\.trial/.test(k)), 'the trial writes one key, bughunt.trial.v1', [...storeKeys].join());
  // the voice manifest is unchanged: 11 lines, no new audio file for the trials
  const man = JSON.parse(fs.readFileSync(path.join(L.GAME, 'audio', 'narration-manifest.json'), 'utf8'));
  const lines = man.lines || man.items || Object.values(man).find(Array.isArray) || [];
  ok(Array.isArray(lines) ? lines.length === 11 : Object.keys(man).length > 0, 'the narration manifest still has its 11 lines (zero new TTS calls for the trials)', `lines ${Array.isArray(lines) ? lines.length : '?'}`);
  const newAudio = fs.readdirSync(path.join(L.GAME, 'audio')).filter((f) => /trial/i.test(f) && /\.(mp3|ogg|wav|opus)$/i.test(f));
  ok(newAudio.length === 0, 'no new voice or sound FILE for the trials (sounds are synthesised by sfx.js)', newAudio.join());
}

/* ---- live ------------------------------------------------------------------------------------------------------------ */
const SPY = `(() => {
  const S = window.__spy = { storage: [], cookie: [], idb: 0, fetch: [], xhr: [], beacon: [], ws: [], clip: { read: 0, readText: 0, write: [] } };
  const sset = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { S.storage.push(k + '=' + v); return sset.call(this, k, v); };
  const d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (d) Object.defineProperty(document, 'cookie', { get() { return d.get.call(document); }, set(v) { S.cookie.push(String(v)); d.set.call(document, v); }, configurable: true });
  if (window.indexedDB) { const o = IDBFactory.prototype.open; IDBFactory.prototype.open = function (...a) { S.idb++; return o.apply(this, a); }; }
  const f = window.fetch; window.fetch = function (u, i) { S.fetch.push({ url: String(u && u.url || u), method: String((i && i.method) || 'GET'), body: String((i && i.body) || '') }); return f.apply(this, arguments); };
  const xo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { S.xhr.push(String(u)); return xo.apply(this, arguments); };
  if (navigator.sendBeacon) { const b = navigator.sendBeacon; navigator.sendBeacon = function (u, data) { S.beacon.push(String(u)); return b.call(this, u, data); }; }
  const W = window.WebSocket; window.WebSocket = function (u, p) { S.ws.push(String(u)); return new W(u, p); };
  if (navigator.clipboard) { const c = navigator.clipboard; c.read = async () => { S.clip.read++; return []; }; c.readText = async () => { S.clip.readText++; return ''; }; c.writeText = async (t) => { S.clip.write.push(String(t)); }; }
})();`;
const WORD_RE = new RegExp('^(' + L.WORDS.join('|') + ')$');
const written0 = (spy) => spy.storage.filter((x) => !x.startsWith('__')).join(String.fromCharCode(10));
const BODY = 'SECRETBODY-9921';
const HEAD = 'SECRETHEAD-4417';
const NAMES = ['trial:door', 'trial:attune', 'trial:start', 'trial:room', 'trial:tell', 'trial:ok', 'trial:death', 'trial:clear', 'trial:pasted'];
const BOOT = `async () => {
  const m = await import('/trial.js'); const e = await import('/engine.js');
  const create = m.createTrial || (m.default && m.default.createTrial) || m.default;
  const strings = await (await fetch('/strings/en.json')).json();
  const t = (k, v = {}) => String(strings[k] ?? k).replace(/\\{(\\w+)\\}/g, (_m, x) => (v[x] === undefined ? '{' + x + '}' : v[x]));
  const root = document.createElement('div'); root.id = 'trial-test-root'; document.body.appendChild(root);
  const clock = { now: () => performance.now(), setTimeout: (...a) => setTimeout(...a), clearTimeout: (i) => clearTimeout(i), setInterval: (...a) => setInterval(...a), clearInterval: (i) => clearInterval(i), requestAnimationFrame: (f) => requestAnimationFrame(f), cancelAnimationFrame: (i) => cancelAnimationFrame(i) };
  const getState = () => e.readQawState(document); const getCounts = () => e.readQawCounts(document);
  const trial = create({ doc: document, win: window, t, clock, storage: localStorage, root, fetch: (u, i) => fetch(u, i), getState, getCounts, qawState: getState, qawCounts: getCounts });
  window.__trial = trial; window.__events = [];
  for (const type of ${JSON.stringify(NAMES)}) trial.on(type, (p) => window.__events.push({ type, ...(p || {}) }));
  await trial.open(7); trial.begin();
}`;

const g = await B.startGame();
const browser = await B.launch();
try {
  const seed = B.seedFor({ lang: 'en', cleared6: true });
  const P = await B.trialPage(browser, g, { lang: 'en', seed, spy: SPY });
  const { page } = P;
  await page.evaluate(`(${BOOT})()`);
  const script = L.PERFECT[7].filter((a) => a.id !== 'paste');
  const { sec } = await B.drive(page, script, { untilSec: 84.5, stepMs: 50 });
  ok(sec >= 84, 'stage 7 played to the hand-off with the scripted player in mocked time', `${sec} s`);
  const events = () => page.evaluate(() => window.__events);
  ok(!(await events()).some((e) => e.type === 'trial:death'), 'the scripted player reached the hand-off without a death', JSON.stringify((await events()).filter((e) => e.type === 'trial:death')));
  const word = B.orderWord(P.reqs);
  ok(WORD_RE.test(word), `the attempt's planted word was seen in the requests: "${word}"`);
  const ta = await page.evaluate(() => { const e = document.querySelector('#trial-paste'); return e ? { tag: e.tagName, value: e.value } : null; });
  ok(!!ta && ta.tag === 'TEXTAREA', 'the hand-off room has the paste box (#trial-paste, a textarea)', JSON.stringify(ta));

  const paste = (text) => page.evaluate((t) => {
    const el = document.querySelector('#trial-paste'); const dt = new DataTransfer(); dt.setData('text/plain', t); el.focus();
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return el.value;
  }, text);
  const count = async (type) => (await events()).filter((e) => e.type === type).length;

  // junk: ignored (the engine reports ok:false and nothing else happens)
  await paste('hello, this is not a report');
  await page.clock.runFor(300);
  const accepted = async () => (await events()).filter((e) => e.type === 'trial:pasted' && e.ok !== false).length;
  ok((await accepted()) === 0 && (await count('trial:clear')) === 0, 'a junk paste is ignored: no accepted paste, no clear', JSON.stringify((await events()).slice(-2)));
  ok((await page.evaluate(() => document.querySelector('#trial-paste').value)) === '', 'a junk paste leaves the box empty (nothing kept)');
  ok(L.loadStrings('en')['trial.paste.no'] === 'That is not this report.', 'the junk answer is the one plain line "That is not this report." (T2 paints it from trial.paste.no)');

  // a real-looking report of ANOTHER attempt (stale word)
  await paste(L.makeReport({ stale: true, title: 'Checkout failed ' + HEAD }));
  await page.clock.runFor(300);
  ok((await accepted()) === 0 && (await count('trial:clear')) === 0, 'a stale report (another attempt\'s word) is ignored: no pasted event, no clear', JSON.stringify((await events()).slice(-2)));

  // the valid report: heading long, marker deep in the body
  const long = `Checkout failed after Next ${HEAD} ${'x'.repeat(80)}`;
  const valid = ['# ' + long, '', '## Steps to reproduce', `1. Press Pay and wait ${BODY}`, '2. Nothing happens', '', '## Evidence', `- POST /api/orders/${word} 503`, '', '| Problems | 3 |', ''].join('\n');
  const LINES = valid.split(String.fromCharCode(10)).length - 1;
  await paste(valid);
  await page.clock.runFor(500);
  const pasted = (await events()).filter((e) => e.type === 'trial:pasted' && e.ok !== false);
  ok(pasted.length === 1, 'the valid report fires exactly one accepted trial:pasted', JSON.stringify(pasted));
  ok(pasted[0] && typeof pasted[0].heading === 'string' && pasted[0].heading.length <= 60 && pasted[0].heading.length > 0, 'only the heading is reported, at most 60 characters', JSON.stringify(pasted[0] && pasted[0].heading));
  ok(pasted[0] && pasted[0].lines === LINES, `the line count is reported (${LINES} lines)`, JSON.stringify(pasted[0] && pasted[0].lines));
  ok(pasted[0] && !JSON.stringify(pasted[0]).includes(BODY), 'the pasted event carries no body text');
  ok((await count('trial:clear')) === 1, 'the valid paste clears the stage (one trial:clear)');
  ok((await page.evaluate(() => document.querySelector('#trial-paste') ? document.querySelector('#trial-paste').value : '')) === '', 'the textarea is emptied after the paste');

  // nothing leaked
  const html = await page.evaluate(() => document.documentElement.outerHTML + document.body.innerText);
  ok(!html.includes(BODY), 'the marker from the report body is nowhere on the page (not in the DOM, not on screen)');
  const spy = await page.evaluate(() => JSON.parse(JSON.stringify(window.__spy)));
  const blob = JSON.stringify(spy);
  ok(!blob.includes(BODY), 'the body marker is in no storage write, cookie, request or clipboard call');
  ok(!written0(spy).includes(HEAD), 'the heading marker is not stored either (the paste is never kept)');
  const written = spy.storage.filter((s) => !s.startsWith('__'));
  ok(written.length > 0 && written.every((s) => s.startsWith(B.TRIAL_KEY + '=') || s.startsWith('bughunt.trial.cover.v1=')), 'the only keys written during the trial are bughunt.trial.v1 (local) and its restart flag (session)', [...new Set(written.map((s) => s.split('=')[0]))].join());
  ok(spy.cookie.length === 0 && spy.idb === 0 && spy.xhr.length === 0 && spy.beacon.length === 0 && spy.ws.length === 0, 'no cookie, IndexedDB, XHR, beacon or WebSocket', JSON.stringify({ c: spy.cookie.length, idb: spy.idb, xhr: spy.xhr.length, b: spy.beacon.length, ws: spy.ws.length }));
  ok(spy.clip.read === 0 && spy.clip.readText === 0 && spy.clip.write.length === 0, 'the clipboard is never read and never written by the trial', JSON.stringify(spy.clip));
  const PLANTED = /^\/(?:api\/(?:sync|telemetry|checkout|save-profile|menu|orders\/[a-z]+)|favicon\.ico)$/;
  const outside = spy.fetch.filter((f) => { try { const u = new URL(f.url, g.origin); return !(u.origin === g.origin && (PLANTED.test(u.pathname) || /^\/(?:strings\/|audio\/narration-manifest\.json|trial|trials\/|engine\.js)/.test(u.pathname))); } catch { return true; } });
  ok(outside.length === 0, 'every fetch of the trial is a planted route on the game\'s own origin', outside.slice(0, 3).map((f) => f.url).join(' | '));
  ok(spy.fetch.filter((f) => PLANTED.test(new URL(f.url, g.origin).pathname)).every((f) => f.body === ''), 'the planted requests carry no body');
  ok(P.reqs.every((r) => r.url.startsWith(g.origin) || r.url.startsWith('data:') || r.url.startsWith('blob:')), 'every request the page made went to the game\'s own origin', P.reqs.filter((r) => !r.url.startsWith(g.origin)).slice(0, 3).map((r) => r.url).join(' | '));
  const seenByServer = g.requests.map((r) => ({ method: r.method, path: String(r.url || r.path || '').replace(/[?#].*$/, '') })).filter((r) => PLANTED.test(r.path));
  ok(g.requests.filter((r) => PLANTED.test(String(r.url || '').replace(/[?#].*$/, ''))).every((r) => !r.contentLength), 'the server saw every planted request with an empty body (contentLength 0)');
  ok(seenByServer.length >= 5, 'the five planted requests of stage 7 reached the game server (and nothing else of the trial left the page)', seenByServer.map((r) => r.method + ' ' + r.path).join(' | '));
  ok(P.errors.length === 0, 'no page error', P.errors.join(' | '));
  await P.close();
} finally {
  await browser.close().catch(() => {});
  await g.close().catch(() => {});
}
finish(SUITE);
