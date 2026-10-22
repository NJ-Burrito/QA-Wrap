// Corpus generator for the error/signal fixtures (spec s9). Deterministic: re-running rewrites identical bytes.
// Run from extension/:  node tools/fixtures/signal/build.mjs
// Labels: D = a tester would file it; N = noise, not a defect. Authored from spec s9, recon, pov-tester/pov-triage only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const probe = path.resolve(here, '../../../../work/error-signal/probe');
const T0 = 1790770600000;
const APP = 'https://app.example.test/';
const rd = (f) => JSON.parse(fs.readFileSync(path.join(probe, f), 'utf8'));

const HELD = new Set(['H5', 'H6', 'D3', 'D6', 'D9', 'D11', 'M3', 'M5', 'M7', 'A2', 'A4', 'A7']);

// ---------- synthetic builder ----------
class Fx {
  constructor(id, page = APP, title = 'App') {
    this.id = id; this.page = page; this.title = title; this.events = []; this.actions = []; this.defs = 0;
    this.push({ kind: 'nav', url: page, transition: 'typed' }, 0);
  }
  base(o, t) { return { ...o, ts: T0 + t, frameUrl: this.page, sessionId: 's_fixture', tabId: 1, tabTitle: this.title }; }
  push(o, t, l) { const e = this.base(o, t); if (l) e._l = l; this.events.push(e); return e; }
  click(t, label) {
    this.actions.push({ ts: T0 + t, action: 'click', label });
    this.events.push(this.base({ kind: 'dom', action: 'click', label, tag: 'button', trusted: true }, t));
  }
  net(t, o, l) {
    const status = o.status ?? 200;
    const fail = status >= 400 || status === 0 || o.error ? 1 : 0;
    return this.push({ kind: 'net', via: 'fetch', method: 'GET', ok: status >= 200 && status < 400, durationMs: 40, error: !!o.error, ...o, status, fail }, t, l);
  }
  con(t, level, text, o = {}, l) { return this.push({ kind: 'console', level, text, fail: level === 'error' ? 1 : 0, ...o }, t, l); }
  perr(t, text, o = {}, l) { return this.push({ kind: 'pageerror', text, fail: 1, ...o }, t, l); }
  def(why) { return ['D', why, 'def' + (++this.defs)]; }
  finish() {
    const evs = this.events.map((e, i) => ({ ...e, seq: i + 1 })).sort((a, b) => a.ts - b.ts || a.seq - b.seq);
    const labels = [];
    evs.forEach((e, i) => { // act = tester actions recorded so far in this tab (spec s3)
      if (e.kind !== 'nav') e.act = this.actions.filter((a) => a.ts <= e.ts).length;
      if (e._l) {
        const [label, why, def] = e._l;
        labels.push(def ? { eventIdx: i, label, why, def } : { eventIdx: i, label, why });
        delete e._l;
      }
    });
    evs.forEach((e, i) => { e.seq = i + 1; });
    return { id: this.id, split: HELD.has(this.id) ? 'held' : 'tune', events: evs, actions: this.actions, labels };
  }
}
const abortF = { error: true, status: 0, text: 'signal is aborted without reason', en: 'AbortError', nh: 'abort' };
const failF = { error: true, status: 0, text: 'Failed to fetch', en: 'TypeError' };
const cors = (from, to) => `Access to fetch at '${to}' from origin '${from}' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.`;

const out = [];
const add = (f) => out.push(f.finish());

// ---------- D defects ----------
{ const f = new Fx('D1'); f.net(300, { url: '/api/catalog', status: 200 }); f.click(2000, 'Place order');
  f.net(2100, { method: 'POST', url: '/api/orders', status: 500, responsePreview: '{"error":"internal"}' }, f.def('first-party 500 after a click')); add(f); }
{ const f = new Fx('D2'); f.click(1500, 'Open cart');
  f.perr(1600, "Uncaught TypeError: Cannot read properties of undefined (reading 'id')", { en: 'TypeError', stack: "TypeError: Cannot read properties of undefined (reading 'id')\n    at renderCart (https://app.example.test/assets/app.js:120:15)" }, f.def('uncaught TypeError after a click')); add(f); }
{ const f = new Fx('D3'); f.click(1200, 'Checkout');
  f.con(1300, 'error', 'Error: Checkout failed: invalid cart', { stack: 'Error: Checkout failed: invalid cart\n    at submit (https://app.example.test/assets/app.js:88:11)' }, f.def('console.error(new Error) the app reports itself')); add(f); }
{ const f = new Fx('D4'); f.click(1000, 'Export');
  f.net(31000, { via: 'xhr', url: '/api/export', status: 0, error: true, text: 'timeout', ev: 'timeout', durationMs: 30000 }, f.def('first-party XHR timeout: server never answered')); add(f); }
{ const f = new Fx('D5'); f.click(1800, 'Save profile');
  f.net(1900, { method: 'PUT', url: '/api/profile', status: 401, responsePreview: '{"error":"unauthorized"}' }, f.def('401 on a save the tester just triggered')); add(f); }
{ const f = new Fx('D6'); f.click(1400, 'Preferences');
  f.net(1500, { url: '/api/v2/users/42/preferences', status: 404, responsePreview: '{"error":"route not found"}' }, f.def('404 on an API route')); add(f); }
{ const f = new Fx('D7', 'http://localhost:3000/'); f.click(1000, 'Load data');
  f.net(1100, { url: 'https://api.other.test/v1/items', ...failF }, f.def('fetch rejected by CORS'));
  f.con(1101, 'error', cors('http://localhost:3000', 'https://api.other.test/v1/items'), {}, ['D', 'browser CORS message for the same request', 'def1']); add(f); }
{ const f = new Fx('D8'); f.click(1600, 'Find nearest');
  f.net(1750, { url: 'https://api.geo-provider.test/v1/lookup?q=amman', status: 500, responsePreview: '{"error":"upstream failure"}' }, f.def("third-party JSON 500 that breaks the tester's flow")); add(f); }
{ const f = new Fx('D9'); f.click(900, 'Open dashboard');
  const m = 'Warning: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect.';
  for (let i = 0; i < 5; i++) f.con(1000 + i * 15, 'error', m, {}, i ? ['D', 'same storm row', 'def1'] : f.def('render-loop storm: the same error hundreds of times'));
  f.push({ kind: 'rep', of: 'console', level: 'error', text: m, n: 195, fail: 1 }, 3900, ['D', 'folded remainder of the storm', 'def1']); add(f); }
{ const f = new Fx('D10'); f.net(1500, { url: '/api/session/init', status: 500 }, f.def('500 at t=1.5 s on load, no click involved')); add(f); }
{ const f = new Fx('D11'); f.click(1000, 'Pay');
  f.perr(1200, 'Unhandled rejection: Error: Payment gateway unreachable', { en: 'Error', stack: 'Error: Payment gateway unreachable\n    at pay (https://app.example.test/assets/app.js:301:9)' }, f.def('unhandled non-Abort rejection')); add(f); }
{ const f = new Fx('D12'); f.push({ kind: 'net', via: 'document', method: 'GET', url: APP, status: 503, ok: false, error: false, durationMs: 210, fail: 1, text: 'Service Unavailable' }, 100, f.def('main document answered 503')); add(f); }

// ---------- A adversarial (devil objection 3): each is a real defect a naive noise rule would hide ----------
{ const f = new Fx('A1'); f.click(2000, 'Pay now');
  f.net(2150, { method: 'POST', url: 'https://api.payments-provider.test/v1/charges', status: 403, responsePreview: '{"error":"forbidden"}' }, f.def('payment provider 403 (third party, but the order fails)')); add(f); }
{ const f = new Fx('A2', 'https://www.acme.test/'); f.click(1500, 'My orders');
  f.net(1620, { url: 'https://api.acme-services.test/v1/orders', ...failF }, f.def('own API on a different domain rejected'));
  f.con(1621, 'error', cors('https://www.acme.test', 'https://api.acme-services.test/v1/orders'), {}, ['D', 'CORS console line for the same request', 'def1']); add(f); }
{ const f = new Fx('A3'); f.click(1000, 'Run report');
  f.net(9000, { url: '/api/report', error: true, status: 0, text: 'signal timed out', en: 'TimeoutError', durationMs: 8000 }, f.def('AbortSignal.timeout fired: the server was too slow (TimeoutError)'));
  f.click(10000, 'Refresh');
  f.net(18000, { url: '/api/summary', ...abortF, text: 'The user aborted a request.', durationMs: 8000 }, f.def('hand-rolled app timeout aborted the request'));
  f.con(18001, 'error', 'Request timed out after 8s: /api/summary', {}, ['D', 'the app itself reports the timeout', 'def2']); add(f); }
{ const f = new Fx('A4'); f.net(700, { url: '/locales/ar.json', status: 404 }, f.def('Arabic locale file missing (404 on load)')); add(f); }
{ const f = new Fx('A5'); f.net(800, { url: '/api/me', status: 401 }, ['N', 'anonymous bootstrap 401 before login']);
  f.click(3000, 'Log in'); f.net(3200, { method: 'POST', url: '/api/login', status: 200 }); f.net(3400, { url: '/api/me', status: 200 });
  f.net(40000, { url: '/api/orders', status: 401 }, f.def('second 401 after a valid login: session expired'));
  f.net(40500, { url: '/api/me', status: 401 }, ['D', 'the same expiry seen by the poll', 'def1']); add(f); }
{ const f = new Fx('A6', 'https://www.acme.test/'); f.click(1200, 'Search');
  f.net(1300, { url: 'https://api.acme.test/v1/search?q=a', ...failF }, f.def('CORS block to a sibling domain of the page'));
  f.con(1301, 'error', cors('https://www.acme.test', 'https://api.acme.test/v1/search?q=a'), {}, ['D', 'CORS console line for the same request', 'def1']); add(f); }
{ const f = new Fx('A7'); f.click(1000, 'Sync');
  f.net(1100, { url: '/api/sync', ...failF }, f.def('captive portal / dead VPN: first-party fetches rejected while the page believes it is online'));
  f.net(1200, { url: '/api/notifications', ...failF }, ['D', 'same outage', 'def1']);
  f.con(1300, 'error', 'TypeError: NetworkError when attempting to fetch resource.', {}, ['D', 'app reports the outage', 'def1']); add(f); }

// ---------- H healthy: real captures from work/error-signal/probe ----------
const NOISE_WHY = (e) => {
  const t = e.text || '';
  if (e.kind === 'net' && e.status === 401 && /\/me$/.test(e.url)) return 'anonymous session poll 401';
  if (e.kind === 'net' && e.status === 404) return 'optional resource 404 on load';
  if (e.kind === 'net' && /abort/i.test(t)) return 'self-cancelled request (AbortError)';
  if (e.kind === 'net' && e.via === 'xhr' && e.status === 0) return 'self-cancelled XHR';
  if (e.kind === 'net') return 'third-party consent/ad-bid response, nothing the page depends on';
  if (e.kind === 'pageerror' && /AbortError/.test(t)) return 'unhandled AbortError rejection from a cancelled fetch';
  if (e.kind === 'pageerror' && /ResizeObserver/.test(t)) return 'ResizeObserver browser loop notice';
  if (e.kind === 'pageerror') return 'opaque cross-origin "Script error." from a third-party script';
  if (e.kind === 'console' && /key/.test(t)) return 'React list key dev warning';
  if (e.kind === 'console') return 'deprecation or consent warning, no user-visible fault';
  return 'noise';
};
const isBad = (e) => e.kind === 'pageerror' || (e.kind === 'net' && (e.fail || e.error || e.status >= 400)) || (e.kind === 'console' && (e.level === 'error' || e.level === 'warn'));
// what the new hook would add where the browser names the cause exactly (spec s3)
function enrichHook(e) {
  if (e.kind === 'net' && e.via === 'fetch' && /aborted/.test(e.text || '')) { e.en = 'AbortError'; e.nh = 'abort'; }
  if (e.kind === 'net' && e.via === 'xhr' && e.status === 0 && e.error) { e.ev = 'abort'; e.nh = 'abort'; }
  if (e.kind === 'pageerror' && /AbortError/.test(e.text)) { e.en = 'AbortError'; e.nh = 'abort'; }
  if (e.kind === 'pageerror' && /^Script error\./.test(e.text)) e.nh = 'opaque';
}
const replay = (id, ev, title, enrich) => {
  const events = ev.map((e) => { const c = { ...e }; if (enrich) enrichHook(c); return c; });
  const labels = [];
  events.forEach((e, i) => { if (isBad(e)) labels.push({ eventIdx: i, label: 'N', why: NOISE_WHY(e) }); });
  return { id, split: HELD.has(id) ? 'held' : 'tune', title, events, actions: [], labels };
};
const r1 = rd('results-run1.json'), r2 = rd('results-run2.json'), r3 = rd('results-run3.json');
const noisyEvents = r3[1].events;
out.push(replay('H1', r3[0].events, 'Clean local page (probe /)'));
out.push(replay('H2', noisyEvents, 'Healthy but noisy /noisy: 516 events, no defect in it'));
out.push(replay('H3', r1[2].events, 'BBC news, 10 s dwell'));
out.push(replay('H4', r2[1].events, 'The Guardian, 10 s dwell'));
out.push(replay('H5', r2[3].events, 'AliExpress, 10 s dwell'));
out.push(replay('H6', r2[0].events, 'CNN, 10 s dwell'));

// ---------- M mixed ----------
{ // M1: /noisy (with the new hook facts) + 3 injected defects
  const m = replay('M1', noisyEvents, '/noisy + 3 injected defects', true);
  const last = noisyEvents.at(-1).ts;
  const mk = (o) => ({ sessionId: noisyEvents[0].sessionId, tabId: noisyEvents[0].tabId, tabTitle: 'Healthy but noisy', frameUrl: noisyEvents[0].frameUrl, ...o });
  m.actions.push({ ts: last + 100, action: 'click', label: 'Submit order' });
  const inj = [
    [mk({ kind: 'dom', action: 'click', label: 'Submit order', tag: 'button', trusted: true, ts: last + 100 }), null],
    [mk({ kind: 'net', via: 'fetch', method: 'POST', url: '/api/orders', status: 500, ok: false, error: false, durationMs: 90, fail: 1, ts: last + 200 }), ['D', 'injected: first-party 500 after a click', 'def1']],
    [mk({ kind: 'pageerror', text: "Uncaught TypeError: Cannot read properties of null (reading 'total')", en: 'TypeError', fail: 1, ts: last + 300 }), ['D', 'injected: uncaught TypeError', 'def2']],
    [mk({ kind: 'console', level: 'error', text: 'Error: Order total mismatch', stack: 'Error: Order total mismatch\n    at check (/noisy:40:5)', fail: 1, ts: last + 400 }), ['D', 'injected: console.error(new Error)', 'def3']],
  ];
  for (const [e, l] of inj) { m.events.push(e); if (l) m.labels.push({ eventIdx: m.events.length - 1, label: l[0], why: l[1], def: l[2] }); }
  m.events.forEach((e, i) => { e.seq = i + 1; if (e.kind !== 'nav') e.act = m.actions.filter((a) => a.ts <= e.ts).length; });
  out.push(m);
}
{ const f = new Fx('M2'); f.click(500, 'Open chart');
  f.perr(600, 'ResizeObserver loop completed with undelivered notifications.', { en: 'Error', nh: 'ro' }, ['N', 'browser RO loop notice']);
  f.con(700, 'error', 'Failed to load ResizeObserver polyfill', {}, f.def('real failure whose text merely mentions ResizeObserver')); add(f); }
{ const f = new Fx('M3'); f.click(900, 'Save draft');
  f.net(1000, { url: '/api/save', ...abortF }, ['N', 'genuine self-cancelled request']);
  f.net(1100, { method: 'POST', url: '/api/save', status: 500, responsePreview: '{"error":"Server error: AbortError in upstream worker"}', text: 'Server error: AbortError in upstream worker' }, f.def('500 whose text contains "AbortError"'));
  f.con(1101, 'error', 'Error: Save failed: AbortError in upstream worker', {}, ['D', 'same defect reported by the app', 'def1']); add(f); }
{ const f = new Fx('M4'); f.click(1000, 'Settings'); f.net(1100, { url: '/config.json', status: 404 }, f.def('/config.json 404 after a click: the screen the tester opened lacks its config')); add(f); }
{ const f = new Fx('M5'); f.click(800, 'Start monitor');
  for (let i = 0; i < 5; i++) f.net(1000 + i * 500, { url: '/api/status', status: 500 }, i ? ['D', 'same polled 500', 'def1'] : f.def('polled 500 every 500 ms'));
  f.push({ kind: 'rep', of: 'net', via: 'fetch', method: 'GET', url: '/api/status', status: 500, ok: false, error: false, n: 15, fail: 1 }, 10000, ['D', 'folded remainder of the polled 500 (x15)', 'def1']); add(f); }
{ const f = new Fx('M6', 'https://shop.example.co.uk/'); f.click(1000, 'Buy');
  f.net(1100, { method: 'POST', url: 'https://api.example.co.uk/orders', status: 500 }, f.def('sibling host on the same registrable domain example.co.uk'));
  f.net(300, { url: 'https://ads.tracker-network.co.uk/beacon', status: 500, method: 'POST' }, ['N', 'unrelated *.co.uk tracker beacon on load, no click']); add(f); }
{ const f = new Fx('M7'); f.click(500, 'Place order');
  for (let i = 0; i < 1000; i++) f.net(1000 + 2 * i, { method: 'POST', url: '/api/orders', status: 500 }, i ? ['D', 'repeat of the same 500', 'def1'] : f.def('1000 repeats of D1 within 2 s')); add(f); }

// ---------- write ----------
for (const d of ['tune', 'held']) { fs.rmSync(path.join(here, d), { recursive: true, force: true }); fs.mkdirSync(path.join(here, d), { recursive: true }); }
const manifest = { corpus: 'signal-l1', authored: '2026-09-30', labels: { D: 'a tester would file it', N: 'noise' }, fixtures: [] };
const order = (id) => 'HDMA'.indexOf(id[0]) * 1000 + Number(id.slice(1));
for (const fx of out.sort((a, b) => order(a.id) - order(b.id))) {
  const rel = `${fx.split}/${fx.id}.json`, body = JSON.stringify(fx) + '\n';
  fs.writeFileSync(path.join(here, rel), body);
  const c = (l) => fx.labels.filter((x) => x.label === l).length;
  manifest.fixtures.push({ id: fx.id, split: fx.split, file: rel, sha256: crypto.createHash('sha256').update(body).digest('hex'), events: fx.events.length, labelsD: c('D'), labelsN: c('N'), defects: new Set(fx.labels.filter((x) => x.def).map((x) => x.def)).size });
}
fs.writeFileSync(path.join(here, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log('built', manifest.fixtures.length, 'fixtures');
