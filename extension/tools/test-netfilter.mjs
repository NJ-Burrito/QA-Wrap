/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Network filter (غربلة) and click labels: the unit tests and the bench.
 *   node tools/test-netfilter.mjs
 * Spec: docs/decisions/2026-11-10-network-filter-and-click-labels.md (D1 to D10).
 *
 * D1 (nothing is deleted: shown + hidden = total) and D2 (never hidden) are invariants, so they are tested as properties:
 * thousands of random events under every preset and random rules must keep both, and a forged `flt` tag on a protected
 * failure must change nothing. The page classifier runs on the real content/page-hooks.js in a vm (D8), and the bench
 * times its classification of 10 000 events (budget: 50 ms added main-thread time).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance as perf } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { etld1, prepare, summary, hostSet, addRule, removeRule, rowsHiddenBy, DEFAULT_CONFIG, DEFAULT_DENYLIST, PRESETS, isDenied, filterSentences } from '../core/netfilter.js';
import { neverHidden, markRecovered, groupRows, groupLabel, groupKey, pathTemplate } from '../core/netkeys.js';
import { classify, visibleProblems } from '../core/signal.js';
import { problemCounts } from '../core/finding-count.js';
import { liteProblem, sanitiseEvent } from '../core/events.js';
import { PSL } from '../vendor/psl-data.js';
import { readHookData } from './build-psl.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(EXT, ...p), 'utf8');
const src = read('content', 'page-hooks.js');
const srcLF = src.replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ the page hook in a vm */
function mkEnv({ offset = { ms: 0 }, href = 'https://app.shop.test/' } = {}) {
  const posted = [];
  const handlers = {};
  const win = { addEventListener(type, fn) { (handlers[type] ||= []).push(fn); }, postMessage(m) { posted.push(m); }, setTimeout, console };
  win.window = win;
  win.fetch = (...a) => win.next(...a);
  const FakeDate = function (...a) { return new Date(...a); };
  FakeDate.now = () => Date.now() + offset.ms;
  FakeDate.parse = Date.parse;
  const u = new URL(href);
  const scripts = [];
  const ctx = vm.createContext({
    window: win, console: { ...console }, performance, URL, TextDecoder, Date: FakeDate, Promise, Map, Set, Math, Object, Array, String, Number, Error, TypeError,
    JSON, RegExp, WeakMap, Symbol, location: { href, origin: u.origin, hostname: u.hostname },
    document: { addEventListener() {}, readyState: 'complete', scripts, querySelectorAll: () => [] }, navigator: {}, setTimeout, clearTimeout, FormData, URLSearchParams,
  });
  vm.runInContext(src, ctx);
  const fire = (d) => { for (const h of handlers.message || []) h({ source: win, data: d }); };
  fire({ source: 'uqa-awake', awake: true });
  const ev = (k) => posted.filter((m) => m.event?.kind === k).map((m) => m.event);
  return { win, ctx, fire, ev, posted, handlers, scripts, act: (n) => fire({ source: 'uqa-act', act: n }), all: () => posted.filter((m) => m.event).map((m) => m.event) };
}
const answer = async (env, url, status, init) => {
  env.win.next = () => Promise.resolve(new Response('{}', { status, headers: { 'content-type': 'application/json' } }));
  await env.win.fetch(url, init);
  await wait(30);
};
const reject = async (env, url, err) => {
  env.win.next = () => Promise.reject(err);
  await env.win.fetch(url).catch(() => {});
  await wait(30);
};
const named = (name, msg) => Object.assign(new Error(msg), { name });
const lastNet = (env) => env.ev('net').at(-1);

/* ------------------------------------------------------------------ D3: eTLD+1 and the host set */
await test('D3: etld1 uses the vendored Public Suffix List snapshot, not a hand-kept list', () => {
  const cases = {
    'a.b.shop.co.uk': 'shop.co.uk', 'api.shop.com': 'shop.com', 'x.github.io': 'x.github.io', 'foo.bar.ck': 'foo.bar.ck', 'www.ck': 'www.ck',
    'city.kobe.jp': 'city.kobe.jp', 'app.shop.test': 'shop.test', 'localhost': 'localhost', '127.0.0.1': '127.0.0.1', 'a.s3.amazonaws.com': 'a.s3.amazonaws.com',
    'shop.com.jo': 'shop.com.jo', 'x.shop.com.sa': 'shop.com.sa', 'my.app.vercel.app': 'app.vercel.app', 'www.google-analytics.com': 'google-analytics.com',
    'xn--mgbaakc7dvf.xn--mgberp4a5d4ar': 'xn--mgbaakc7dvf.xn--mgberp4a5d4ar',
  };
  for (const [h, want] of Object.entries(cases)) assert.equal(etld1(h), want, h);
  assert.match(PSL.version, /^20\d\d-/);
  assert.equal(PSL.sha256.length, 64);
});

await test('D3: the page hook carries the same Public Suffix List data, and the same lookup', () => {
  assert.equal(readHookData(), PSL.data, 'run: node tools/build-psl.mjs <public_suffix_list.dat>');
  const a = src.indexOf('let pslTable = null;');
  const b = src.indexOf('const NF_DENY_DEFAULT');
  const sandbox = vm.createContext({ PSL_DATA: PSL.data, Map, Set, String });
  const pageEtld1 = vm.runInContext(`${src.slice(a, b)}; etld1`, sandbox);
  const hosts = ['a.b.shop.co.uk', 'x.github.io', 'foo.bar.ck', 'www.ck', 'city.kobe.jp', 'api.sibling.test', 'cdn.static.test', 'pay.provider.test', 'a.b.c.d.example.org', 'my.app.vercel.app', 'shop.com.jo', 'localhost', '10.0.0.5', 'x.blogspot.com', 'foo.s3.amazonaws.com', 'deep.sub.herokuapp.com'];
  for (const h of hosts) assert.equal(pageEtld1(h), etld1(h), h);
});

await test('D3: the host set holds navigated, framed and script-serving hosts; a denylisted host that served a script is not first party; pinned hosts are', () => {
  const events = [
    { kind: 'nav', url: 'https://app.shop.test/' },
    { kind: 'net', via: 'document', url: 'https://sso.idp.test/frame.html' },
    { kind: 'net', via: 'resource', sc: 1, url: 'https://cdn.static.test/chunk.js', status: 0, error: true },
    { kind: 'net', via: 'resource', sc: 1, url: 'https://www.googletagmanager.com/gtm.js', status: 200 },
    { kind: 'net', via: 'fetch', url: 'https://ads.tracker3p.test/x', status: 500 },
  ];
  const set = hostSet(events, { startUrl: 'https://app.shop.test/' }, ['https://api.sibling.test/']);
  for (const h of ['shop.test', 'idp.test', 'static.test', 'sibling.test']) assert.ok(set.has(h), h);
  assert.ok(!set.has('googletagmanager.com'), 'a tag manager that served a script stays noise');
  assert.ok(!set.has('tracker3p.test'));
  assert.ok(isDenied('www.google-analytics.com') && !isDenied('shop.test'));
});

await test('D4: the telemetry denylist in the page hook and in core/netfilter.js decode to the same names, and are the ones the decision lists', () => {
  const a = srcLF.indexOf('const NF_DENY_DEFAULT = [');
  const page = vm.runInContext(`${srcLF.slice(a, srcLF.indexOf(';', a))}; NF_DENY_DEFAULT`, vm.createContext({}));
  assert.deepEqual([...page].sort(), [...DEFAULT_DENYLIST].sort());
  for (const h of ['google-analytics.com', 'googletagmanager.com', 'hotjar.com', 'sentry.io', 'segment.com', 'datadoghq.com', 'clarity.ms', 'doubleclick.net', 'newrelic.com']) assert.ok(DEFAULT_DENYLIST.includes(h), h);
});

/* ------------------------------------------------------------------ D6, D5: keys, groups, recovery */
const net = (o) => ({ kind: 'net', via: 'fetch', method: 'GET', ts: 1000, status: 200, ok: true, ...o });

await test('D6: ids and uuids are templated; the group key is method + origin + path template + status + operation + error name', () => {
  assert.equal(pathTemplate('/api/users/42/orders/550e8400-e29b-41d4-a716-446655440000'), '/api/users/:id/orders/:id');
  const a = groupKey(net({ url: 'https://x.test/api/users/1', status: 404 }));
  assert.equal(a, groupKey(net({ url: 'https://x.test/api/users/2', status: 404 })));
  assert.notEqual(a, groupKey(net({ url: 'https://x.test/api/users/2', status: 500 })));
  assert.notEqual(a, groupKey(net({ method: 'POST', url: 'https://x.test/api/users/2', status: 404 })));
  assert.notEqual(groupKey(net({ url: '/graphql', ev: 'gql', operation: 'A' })), groupKey(net({ url: '/graphql', ev: 'gql', operation: 'B' })));
  assert.notEqual(groupKey(net({ url: '/x', status: 0, error: true, en: 'TypeError' })), groupKey(net({ url: '/x', status: 0, error: true, en: 'AbortError' })));
});

await test('D6: 12 repeats read "12× GET /api/users/:id › 404 · over 3 s"; a mixed group reads "9 ok, 3× 500" and takes its colour from the worst status', () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(net({ url: `https://x.test/api/users/${i + 10}`, status: 404, ok: false, ts: 1000 + i * 270 }));
  const g = groupRows(rows);
  assert.equal(g.length, 1);
  assert.equal(groupLabel(g[0], (s) => `over ${s} s`), '12× GET /api/users/:id › 404 · over 3 s');
  const mixed = [];
  for (let i = 0; i < 9; i++) mixed.push(net({ url: '/api/q', ts: 1000 + i * 100 }));
  for (let i = 0; i < 3; i++) mixed.push(net({ url: '/api/q', status: 500, ok: false, ts: 2000 + i * 100 }));
  const m = groupRows(mixed)[0];
  assert.equal(m.worst, 500);
  assert.match(groupLabel(m, (s) => `over ${s} s`), /9 ok, 3× 500/);
  assert.equal(groupRows(mixed.slice(0, 9)).length, 0, 'a group with no failure is not collapsed');
  // 30 s window, across click epochs
  const spread = [net({ url: '/a', status: 404, ts: 0, act: 1 }), net({ url: '/a', status: 404, ts: 20000, act: 2 }), net({ url: '/a', status: 404, ts: 60000, act: 3 })];
  assert.equal(groupRows(spread)[0].items.length, 2);
});

await test('D5: a failure followed by 2xx/3xx on the same key within 30 s is recovered; more than 2 retries on a 5xx, or more than 3 failures, stays a problem', () => {
  const f = (ts, status = 503) => net({ url: '/api/flaky', status, ok: false, ts });
  const ok = (ts) => net({ url: '/api/flaky', ts });
  const one = [f(1000), ok(2000)];
  assert.equal(markRecovered(one).size, 1);
  assert.equal(markRecovered([f(1000), f(1500), ok(2000)]).size, 2, 'two failures then OK: two retries is allowed');
  assert.equal(markRecovered([f(1000), f(1500), f(1800), ok(2000)]).size, 0, 'a 5xx that needed more than 2 retries stays red');
  assert.equal(markRecovered([f(1000, 404), f(1100, 404), f(1200, 404), ok(2000)]).size, 3, 'three 404s then OK recovers');
  assert.equal(markRecovered([f(1000, 404), f(1100, 404), f(1200, 404), f(1300, 404), ok(2000)]).size, 0, 'more than 3 stays');
  assert.equal(markRecovered([f(1000), ok(40000)]).size, 0, 'after 30 s it is not a recovery');
  const prep = prepare(one);
  assert.equal(classify(prep[0]).r, 'n-recovered');
  assert.equal(problemCounts(one).groups, 0, 'a recovered failure is not a problem');
  assert.equal(problemCounts([f(1000), f(1100), f(1200), ok(2000)]).groups, 1);
});

/* ------------------------------------------------------------------ D2 and D1 as properties */
await test('D2: what is protected is never hidden, by a tag, a preset, a rule or an ignore list; a forged tag changes nothing', () => {
  const protectedRows = [
    net({ url: 'https://app.shop.test/api/o', status: 500, ok: false, fp: 1, flt: 'telemetry' }),
    net({ url: 'https://app.shop.test/api/o', status: 0, error: true, en: 'TypeError', ok: false, fp: 1, flt: 'adblock' }),
    net({ url: 'https://app.shop.test/graphql', ev: 'gql', operation: 'Pay', fp: 1, flt: 'rule' }),
    net({ url: 'https://elsewhere.test/x.png', status: 404, ok: false, fp: 0, ca: 1, flt: 'junk' }),
    net({ url: 'https://elsewhere.test/api', status: 403, ok: false, fp: 0, au: 1, flt: 'telemetry' }),
  ];
  const cfg = { ...DEFAULT_CONFIG, preset: 'strict', ignoreDomains: ['shop.test', 'elsewhere.test'], ignorePaths: ['/*'], ignoreStatuses: [500, 404, 403, 0], rules: { 'shop.test': [{ kind: 'hide', scope: 'domain', host: 'shop.test' }] } };
  for (const e of protectedRows) {
    assert.ok(neverHidden(e), JSON.stringify(e));
    assert.ok(liteProblem(e), 'a forged flt must not stop the tally counting it');
    assert.notEqual(classify(e).c, 'N', `${e.url} ${e.status} classified as ${classify(e).r}`);
  }
  const prep = prepare(protectedRows, cfg, 'shop.test');
  assert.ok(prep.every((e) => !e.flt), 'prepare strips every reason from a protected row');
  assert.equal(summary(prep).hiddenTotal, 0);
  // an abort is not a transport error (D2 says non-abort) and may be hidden
  assert.ok(!neverHidden(net({ url: '/x', status: 0, error: true, en: 'AbortError', ok: false, fp: 1 })));
});

await test('D1 and D2 hold over 6000 random events under every preset, random rules and random tags', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const hosts = ['app.shop.test', 'cdn.static.test', 'www.google-analytics.com', 'ads.tracker3p.test', 'api.sibling.test'];
  const reasons = [undefined, undefined, 'abort', 'telemetry', 'adblock', 'junk', 'socket', 'redirect', 'rule', 'strict'];
  for (let round = 0; round < 6; round++) {
    const events = [];
    for (let i = 0; i < 1000; i++) {
      const status = pick([200, 200, 204, 301, 304, 400, 401, 403, 404, 500, 502, 0]);
      const e = net({
        url: `https://${pick(hosts)}/p/${pick(['a', 'b', 'c'])}/${Math.floor(rnd() * 5)}`, method: pick(['GET', 'POST']), status, ok: status > 0 && status < 400,
        ts: Math.floor(rnd() * 600000), act: Math.floor(rnd() * 4), flt: pick(reasons), fp: pick([0, 1, undefined]), ca: pick([undefined, 1, 2]), au: pick([undefined, undefined, 1]),
        ...(status === 0 ? { error: true, en: pick(['TypeError', 'AbortError', 'TimeoutError']) } : {}), ...(rnd() < 0.05 ? { ev: 'gql', operation: pick(['A', 'B']) } : {}),
      });
      events.push(rnd() < 0.1 ? { kind: 'rep', ofKind: 'net', method: e.method, url: e.url, status: e.status || undefined, n: 1 + Math.floor(rnd() * 50), flt: e.flt, fp: e.fp, ca: e.ca, au: e.au, ts: e.ts } : e);
    }
    const cfg = { ...DEFAULT_CONFIG, preset: PRESETS[round % 3], ignoreDomains: rnd() < 0.5 ? ['tracker3p.test'] : [], ignoreStatuses: rnd() < 0.5 ? [404, 500] : [], ignorePaths: rnd() < 0.5 ? ['/p/a/*'] : [],
      rules: { 'shop.test': [{ kind: 'hide', scope: 'domain', host: 'api.sibling.test' }, { kind: 'show', scope: 'endpoint', host: 'app.shop.test', method: 'GET', path: '/p/b/:id' }] } };
    const prep = prepare(events, cfg, 'shop.test');
    assert.equal(prep.length, events.length, 'D1: prepare drops nothing');
    for (let i = 0; i < events.length; i++) {
      assert.deepEqual({ ...prep[i], flt: undefined, rcv: undefined }, { ...events[i], flt: undefined, rcv: undefined }, 'prepare changes only the reason');
      if (neverHidden(events[i])) assert.ok(!prep[i].flt, `D2 broken at ${i}: ${JSON.stringify(events[i])} under ${cfg.preset}`);
    }
    const s = summary(prep, { preset: cfg.preset });
    assert.equal(s.shown + s.hiddenTotal, s.total, 'D1: shown + hidden = total');
    assert.equal(Object.values(s.hidden).reduce((a, b) => a + b, 0), s.hiddenTotal);
    const everything = summary(prepare(events, { ...cfg, preset: 'everything' }, 'shop.test'), { preset: 'everything' });
    assert.equal(everything.total, s.total, 'every preset sees the same total');
    assert.equal(everything.hiddenTotal, 0, 'Everything hides nothing');
  }
});

await test('D9: a hide rule defaults to one method + path template, warns past 20 rows, and Undo restores the rows', () => {
  const events = [];
  for (let i = 0; i < 25; i++) events.push(net({ url: `https://app.shop.test/api/x/${i + 100}`, status: 404, ok: false, ts: 1000 + i }));
  const rule = { kind: 'hide', scope: 'endpoint', host: 'app.shop.test', method: 'GET', path: '/api/x/:id' };
  assert.equal(rowsHiddenBy(rule, events), 25);
  let cfg = addRule(DEFAULT_CONFIG, 'shop.test', rule);
  assert.equal(summary(prepare(events, cfg, 'shop.test')).hidden.rule, 25);
  assert.equal(summary(prepare(events, cfg, 'other.test')).hiddenTotal, 0, 'rules are per site');
  cfg = removeRule(cfg, 'shop.test', rule);
  assert.equal(summary(prepare(events, cfg, 'shop.test')).hiddenTotal, 0, 'Undo');
  cfg = addRule(addRule(DEFAULT_CONFIG, 'shop.test', rule), 'shop.test', { ...rule, kind: 'show' });
  assert.equal(summary(prepare(events, cfg, 'shop.test')).hiddenTotal, 0, '"Always show" wins over the hide rule');
});

await test('D1: the wording is always counts: "M real failures, N hidden, K third-party", never "no issues"; the Arabic twin exists', () => {
  const ev = [net({ url: 'https://app.shop.test/a', status: 500, ok: false, fp: 1 }), net({ url: 'https://www.google-analytics.com/c', status: 500, ok: false, fp: 0, flt: 'telemetry' }), net({ url: 'https://other.test/c', status: 404, ok: false, fp: 0 })];
  const prep = prepare(ev);
  const sum = summary(prep);
  const en = filterSentences(sum, visibleProblems(prep), 'en');
  const ar = filterSentences(sum, visibleProblems(prep), 'ar');
  assert.equal(en.counts, '1 real failures, 1 hidden, 1 third-party');
  assert.equal(en.hidden, '1 calls hidden by filter (balanced)');
  assert.match(ar.counts, /^1 إخفاقات حقيقية، 1 مخفية، 1 من أطراف ثالثة$/);
  assert.match(ar.hidden, /بالغربلة \(متوازنة\)/);
  assert.ok(!/no issues|nothing failed|clean/i.test(JSON.stringify([en, ar])));
});

/* ------------------------------------------------------------------ D4: the page classifier (D8) */
await test('D4: aborts are noise; an abort that took over 10 s, or a timeout, stays a failure', async () => {
  const env = mkEnv();
  await reject(env, '/api/a', named('AbortError', 'The user aborted a request.'));
  assert.equal(lastNet(env).flt, 'abort');
  await reject(env, '/api/b', named('TimeoutError', 'signal timed out'));
  assert.equal(env.ev('net').at(-1).flt, undefined);
  const slow = mkEnv();
  slow.win.next = () => new Promise((_, rej) => setTimeout(() => rej(named('AbortError', 'x')), 40));
  slow.ctx.performance = { now: (() => { let t = 0; return () => (t += 12000); })() }; // each now() jumps 12 s
  await slow.win.fetch('/api/slow').catch(() => {});
  await wait(30);
  const row = slow.ev('net').at(-1);
  assert.ok(!(row.durationMs > 10000) || row.flt === undefined, 'a long abort has no noise tag');
});

await test('D4: telemetry, ad-blocked third-party status 0, favicon and .map 404s, third-party font failures and 3xx are noise; first-party status 0 stays real', async () => {
  const env = mkEnv();
  await answer(env, 'https://www.google-analytics.com/collect', 500, { method: 'POST' });
  assert.equal(lastNet(env).flt, 'telemetry');
  await reject(env, 'https://ads.tracker3p.test/adtag.js', new TypeError('Failed to fetch'));
  assert.equal(lastNet(env).flt, 'adblock');
  await reject(env, 'https://app.shop.test/blocked', new TypeError('Failed to fetch'));
  assert.equal(lastNet(env).flt, undefined, 'a first-party host that cannot be reached is a real failure');
  assert.equal(lastNet(env).fp, 1);
  await answer(env, '/favicon.ico', 404);
  assert.equal(lastNet(env).flt, 'junk');
  await answer(env, '/static/app.js.map', 404);
  assert.equal(lastNet(env).flt, 'junk');
  await answer(env, 'https://fonts.cdn3p.test/f.woff2', 404);
  assert.equal(lastNet(env).flt, 'junk');
  env.win.next = () => Promise.resolve({ status: 304, ok: false, headers: { get: () => null }, clone() { throw new Error('no body'); } });
  await env.win.fetch('/api/moved');
  await wait(30);
  assert.equal(lastNet(env).flt, 'redirect');
  await answer(env, '/api/orders', 500);
  assert.equal(lastNet(env).flt, undefined);
});

await test('D2/D3 in the page: a 4xx within 2 s of a tester action is never tagged noise; a host that served a script is first party', async () => {
  const env = mkEnv();
  env.act(1);
  await answer(env, '/favicon.ico', 404);
  assert.equal(lastNet(env).ca, 1);
  assert.equal(lastNet(env).flt, undefined, 'the favicon 404 follows a click within 2 s, so it stays visible');
  const env2 = mkEnv();
  await answer(env2, 'https://pay.provider.test/charge', 402);
  assert.equal(lastNet(env2).fp, 0);
  env2.scripts.push({ src: 'https://pay.provider.test/sdk.js' });
  await wait(300); // the scan is rate limited to 4 a second
  await answer(env2, 'https://pay.provider.test/charge', 402);
  assert.equal(lastNet(env2).fp, 1, 'the payment host served a script');
  await reject(env2, 'https://api.sibling.test/x', new TypeError('Failed to fetch'));
  assert.equal(lastNet(env2).flt, 'adblock');
  env2.fire({ t: 'nf', hosts: ['https://api.sibling.test/'], deny: null });
  env2.handlers.message; // pinned hosts arrive on the control channel
});

await test('D4: a WebSocket close after the socket opened is noise; one that never opened stays a failure', async () => {
  const mk = () => {
    const env = mkEnv();
    return env;
  };
  for (const [opened, want] of [[true, 'socket'], [false, undefined]]) {
    const listeners = {};
    class WS { constructor(url) { this.url = url; this.readyState = 0; } addEventListener(t, fn) { (listeners[t] ||= []).push(fn); } }
    const env = mk();
    // the page hook wraps the WebSocket present when it loads, so load it again with one present
    const posted = [];
    const handlers = {};
    const win = { addEventListener(t, fn) { (handlers[t] ||= []).push(fn); }, postMessage(m) { posted.push(m); }, setTimeout, console, WebSocket: WS };
    win.window = win; win.fetch = () => Promise.resolve(new Response('{}'));
    const ctx = vm.createContext({ window: win, console, performance, URL, TextDecoder, Date, Promise, Map, Set, Math, Object, Array, String, Number, Error, TypeError, JSON, RegExp, WeakMap, Symbol, Proxy, Reflect, location: { href: 'https://app.shop.test/', origin: 'https://app.shop.test', hostname: 'app.shop.test' }, document: { addEventListener() {}, readyState: 'complete', scripts: [], querySelectorAll: () => [] }, navigator: {}, setTimeout, clearTimeout, FormData, URLSearchParams });
    vm.runInContext(src, ctx);
    for (const h of handlers.message || []) h({ source: win, data: { source: 'uqa-awake', awake: true } });
    const sock = new win.WebSocket('wss://app.shop.test/live');
    if (opened) for (const f of listeners.open || []) f({});
    for (const f of listeners.close || []) f({ code: 1006 });
    const rows = posted.filter((m) => m.event?.kind === 'net').map((m) => m.event);
    assert.equal(rows.length, 1, `opened=${opened}`);
    assert.equal(rows[0].flt, want, `opened=${opened}`);
    void sock;
  }
});

await test('D7: 400 distinct noise failures do not starve a 500 at minute 40, and every call is accounted for (stored + counted = issued)', async () => {
  const offset = { ms: 0 };
  const env = mkEnv({ offset });
  const letters = (i) => { let t = ''; do { t = String.fromCharCode(97 + (i % 26)) + t; i = Math.floor(i / 26); } while (i > 0); return t; };
  env.win.next = () => Promise.resolve(new Response('x', { status: 500 }));
  for (let i = 0; i < 400; i++) await env.win.fetch(`https://www.google-analytics.com/g/collect/${letters(i)}`, { method: 'POST' });
  await wait(300); // a request that began within 250 ms before a click is the click's (D2 slack)
  // 300 more real failures of one key, in different click epochs, all inside minute 1
  for (let i = 0; i < 300; i++) { env.act(i + 1); await env.win.fetch('https://app.shop.test/api/busy'); }
  offset.ms = 40 * 60 * 1000;
  await env.win.fetch('https://app.shop.test/api/minute40');
  await wait(1700);
  const rows = env.all();
  const stored = rows.filter((e) => e.kind === 'net');
  const counted = rows.filter((e) => e.kind === 'rep').reduce((n, e) => n + (e.n || 0), 0);
  assert.ok(stored.some((e) => /minute40/.test(e.url) && e.status === 500), 'the 500 at minute 40 is stored in full');
  assert.equal(stored.length + counted, 701, `stored ${stored.length} + counted ${counted} must equal the 701 calls issued`);
  assert.ok(env.ev('rep').every((r) => r.flt === 'telemetry' || r.flt === undefined), 'a counted noise row keeps its reason, so the worker can count it as hidden');
  const hidden = rows.filter((e) => e.flt && (e.kind === 'rep' || e.kind === 'net')).reduce((n, e) => n + (e.kind === 'rep' ? e.n : 1), 0);
  assert.equal(hidden, 400, 'all 400 noise calls are counted as hidden');
  // D7: the last occurrence of a folded fingerprint is kept in full once it goes quiet
  const busy = stored.filter((e) => /\/api\/busy/.test(e.url));
  assert.ok(busy.length >= 2, 'first and last occurrence of a busy fingerprint are stored');
});

await test('D8: the worker only counts: a tagged call is a hidden call in the live tally, never a problem; a forged tag on a protected call is a problem', async () => {
  const { foldFinding, findingTotals, BLANK_FINDINGS } = await import('../core/sessions.js');
  let t = BLANK_FINDINGS;
  const fold = (e) => { t = foldFinding(t, e); };
  fold(net({ url: 'https://www.google-analytics.com/c', status: 500, ok: false, fp: 0, flt: 'telemetry' }));
  fold({ kind: 'rep', ofKind: 'net', url: 'https://www.google-analytics.com/c', status: 500, n: 7, flt: 'telemetry', fp: 0 });
  assert.equal(findingTotals(t).hidden, 8);
  assert.equal(findingTotals(t).problems, 0);
  fold(net({ url: 'https://app.shop.test/api', status: 500, ok: false, fp: 1, flt: 'telemetry' }));
  assert.equal(findingTotals(t).hidden, 8, 'forged: not hidden');
  assert.equal(findingTotals(t).problems, 1);
  assert.ok(!('flt' in sanitiseEvent({ kind: 'dom' })), 'a dom event cannot carry a filter tag');
  assert.equal(sanitiseEvent({ kind: 'net', url: '/x', status: 500, flt: 'junk', fp: 1, ca: 1, au: 1 }).flt, 'junk');
});

/* ------------------------------------------------------------------ bench */
await test('bench (D8): classifying 10 000 requests in the page costs under 50 ms of main-thread time', () => {
  const a = srcLF.indexOf('/*PSL:BEGIN*/');
  const b = srcLF.indexOf('function report(');
  const sandbox = vm.createContext({
    URL, Map, Set, Date, Math, Object, Array, String, Number, RegExp, performance, document: { scripts: [], querySelectorAll: () => [] }, location: { href: 'https://app.shop.test/', hostname: 'app.shop.test' },
    isFailure: (ev) => ev.kind === 'net' && (ev.error === true || ev.status >= 400 || ev.ev === 'gql'), causedByAction: () => false, lastActAt: 0,
  });
  const nfTag = vm.runInContext(`${srcLF.slice(a, b)}; nfTag`, sandbox);
  const urls = ['https://app.shop.test/api/orders', 'https://www.google-analytics.com/collect', 'https://cdn.static.test/a.js', 'https://fonts.cdn3p.test/f.woff2', 'https://api.sibling.test/api/data', '/favicon.ico', 'https://ads.tracker3p.test/x'];
  const statuses = [200, 500, 404, 0, 304, 403];
  const make = () => Array.from({ length: 10000 }, (_, i) => ({ kind: 'net', via: 'fetch', method: 'GET', url: urls[i % urls.length], status: statuses[i % statuses.length], error: statuses[i % statuses.length] === 0, durationMs: 20, ts: Date.now() }));
  nfTag({ kind: 'net', via: 'fetch', method: 'GET', url: '/warm', status: 500, ts: 1 }); // builds the suffix table once, as the first failure on a page does
  const times = [];
  for (let r = 0; r < 5; r++) {
    const evs = make();
    const t0 = perf.now();
    for (const e of evs) nfTag(e);
    times.push(perf.now() - t0);
  }
  times.sort((x, y) => x - y);
  console.log(`       bench: 10 000 events, median ${times[2].toFixed(1)} ms, worst ${times[4].toFixed(1)} ms`);
  assert.ok(times[2] < 50, `median ${times[2].toFixed(1)} ms is over the 50 ms budget`);
});

/* ------------------------------------------------------------------ D10: labels */
const win = {};
win.window = win;
vm.runInContext(read('content', 'selector-engine.js'), vm.createContext({ window: win, document: {}, console, Intl, performance, Map, Set, WeakMap, Array, String, Object, Math, Number, RegExp, Date, JSON }));
const S = win.UQASelector;
const graphemes = (t) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].length;

await test('D10: scrubLabel removes emails, phone numbers, card-like runs, any run of 6+ digits and secret assignments; the Arabic stays intact', () => {
  const cases = [
    ['Delete Anna Smith, anna.smith@example.com', /@/], ['Pay with card 4111 1111 1111 1111', /4111|1111/], ['Call +962 79 123 4567', /962|4567/],
    ['order 123456 shipped', /123456/], ['token=abc123def', /abc123/], ['كلمة المرور: secret99', /secret99/], ['رقم ٠٧٩١٢٣٤٥٦٧', /٠٧٩١٢٣/],
  ];
  for (const [text, bad] of cases) assert.ok(!bad.test(S.scrubLabel(text)), `${text} -> ${S.scrubLabel(text)}`);
  assert.equal(S.scrubLabel('digit 3 of 6'), 'digit 3 of 6');
  assert.equal(S.scrubLabel('‫حفظ‏ الطلب‬'), 'حفظ الطلب', 'bidi controls are stripped, the Arabic is not');
  assert.equal(S.scrubLabel('Save'), 'Save');
});

await test('D10: at most 80 graphemes, cut on a grapheme boundary, so emoji sequences and combining marks stay whole', () => {
  assert.ok(graphemes(S.clipGraphemes('x'.repeat(300))) <= 80);
  const emoji = '👍🏽'.repeat(100);
  const cut = S.clipGraphemes(emoji);
  assert.ok(graphemes(cut) <= 80);
  assert.ok(!/[\ud800-\udbff]$/.test(cut.replace(/…$/, '')), 'no lone surrogate');
  assert.ok(!/\u{1F3FD}$/u.test(cut.replace(/…$/, '').slice(0, 1)), 'the skin tone stays with its base');
  const combining = 'é'.repeat(200);
  assert.equal(graphemes(S.clipGraphemes(combining)), 80);
  assert.equal(S.clipGraphemes('حفظ'), 'حفظ');
});

await test('D10: the privacy rules, the source order, and the unnamed cases (fake DOM)', () => {
  const el = (o) => {
    const attrs = o.attrs || {};
    const e = {
      nodeType: 1, tagName: (o.tag || 'button').toUpperCase(), type: o.type || '', textContent: o.text || '', className: o.cls || '', isContentEditable: !!o.editable, ownerDocument: { getElementById: () => null },
      getAttribute: (n) => (n in attrs ? attrs[n] : null), closest: (sel) => (o.closestSensitive && /password|cc-|one-time-code|contenteditable/.test(sel) ? e : null),
      querySelector: (sel) => (o.child && sel.includes(o.child.sel) ? o.child.el : o.inner && /svg title|data-icon|icon/.test(sel) ? o.inner : null), matches: () => false, previousElementSibling: null,
    };
    return e;
  };
  const L = (o, opts) => S.clickLabel(el(o), opts);
  const save = L({ text: 'Save' });
  assert.ok(save.label === 'Save' && save.role === 'button' && save.unnamed === undefined);
  assert.equal(L({ text: 'Save', attrs: { 'aria-label': 'Save order' } }).label, 'Save order', 'aria-label before visible text');
  assert.equal(L({ attrs: { title: 'Close dialog' } }).label, 'Close dialog', 'title when there is no text');
  assert.equal(L({ tag: 'input', type: 'submit', attrs: {} }).role, 'button');
  assert.equal(L({ text: 'Save' }, { enabled: false }).label, '', 'the switch off: role only');
  assert.equal(L({ text: 'Save' }, { masked: true }).label, '', 'masked: role only');
  assert.equal(L({ text: 'secret', closestSensitive: true }).label, '', 'inside password / cc / one-time-code / contenteditable: role only');
  assert.equal(L({ tag: 'div', text: 'hello', editable: true }).label, '', 'contenteditable');
  assert.equal(L({ tag: 'td', text: 'Maria maria@example.com 0791234567' }).label, '', 'a table cell records the role only');
  assert.equal(L({ tag: 'tr', text: 'Maria' }).label, '');
  assert.equal(L({ tag: 'div', text: 'cell', attrs: { role: 'gridcell' } }).label, '');
  assert.equal(L({ tag: 'textarea', text: 'typed secret text here', attrs: { 'aria-label': 'Comment' } }).label, 'Comment', 'a text field is named by its label, never by its value');
  assert.equal(L({ tag: 'textarea', text: 'typed secret text here' }).label, '', 'no label: not the value');
  assert.equal(L({ text: 'Delete Anna Smith, anna@example.com' }).label, 'Delete Anna Smith, …');
  assert.equal(L({ text: '' }).unnamed, 'none', '"button without a name"');
  assert.equal(L({ text: '', inner: { tagName: 'svg', matches: () => false, getAttribute: () => null, className: 'lucide' } }).unnamed, 'icon', '"icon button"');
  assert.ok(graphemes(L({ text: 'Long label '.repeat(40) }).label) <= 80);
});

/* ------------------------------------------------------------------ wiring */
await test('wiring: the dom event allows role and unnamed, and the click-label switch, the filter store and the page control message exist', () => {
  const dom = sanitiseEvent({ kind: 'dom', action: 'click', label: 'Save', role: 'button', unnamed: 'icon' });
  assert.equal(dom.role, 'button');
  assert.equal(dom.unnamed, 'icon');
  assert.equal(sanitiseEvent({ kind: 'dom', action: 'click', role: 'x y', unnamed: 'evil' }).unnamed, undefined);
  assert.match(read('content', 'recorder.js'), /UQANfLabels/);
  assert.match(read('background', 'handlers-tools.js'), /UQA_NF_CONFIG/);
  assert.match(read('background', 'service-worker.js'), /'UQA_NF_CONFIG'/);
  assert.match(read('content', 'bridge.js'), /t: 'nf'/);
  assert.match(src, /d\.t === 'nf'/);
});

/* ------------------------------------------------------------------ gaps closed in netfilter-2 */
await test('D7: the page hook folds new distinct noise fingerprints past the cap into one counted bucket per host and reason, and never a real row', () => {
  assert.match(src, /firstNoise >= NOISE_FIRST_CAP/);
  assert.match(src, /ovf\|\$\{ev\.flt\}\|\$\{host\}/);
  assert.match(src, /if \(s\.ovf\) \{ s\.pend\+\+;/);
  const at = src.indexOf('firstNoise >= NOISE_FIRST_CAP');
  assert.match(src.slice(at - 60, at), /noise/, 'the bucket is entered only for a row that carries a noise tag');
});
await test('D6: the panel groups on the incremental poll too, and redraws once when a new row folds into an already drawn group', () => {
  const panel = read('devtools', 'panel.js');
  const body = panel.slice(panel.indexOf('function appendNewRows'), panel.indexOf('function renderTimeline'));
  assert.match(body, /groupedRows/);
  assert.match(body, /leadOf/);
  assert.match(read('devtools', 'netfilter-panel.js'), /leadOf/);
});
await test('D5: the popup applies recovery before it counts rows, tiers and the live number', async () => {
  const pop = read('popup', 'popup.js');
  assert.match(pop, /FC\?\.withRecovery\?\.\(events\)/);
  const { withRecovery } = await import('../core/finding-count.js');
  const rec = markRecovered([{ kind: 'net', method: 'GET', url: 'https://a.test/x', status: 503, ts: 1000 }, { kind: 'net', method: 'GET', url: 'https://a.test/x', status: 200, ts: 2000 }]);
  assert.equal(rec.size, 1);
  const shown = withRecovery([{ kind: 'net', method: 'GET', url: 'https://a.test/x', status: 503, ts: 1000 }, { kind: 'net', method: 'GET', url: 'https://a.test/x', status: 200, ts: 2000 }]).map((e) => classify(e).c);
  assert.ok(!shown.includes('D'), 'the recovered 503 is not a problem row');
});
await test('D10: a click on a button without a name is counted with the accessibility findings; the same locator counts once; icon buttons do not count', async () => {
  const S = await import('../core/sessions.js');
  const click = (extra) => ({ kind: 'dom', action: 'click', role: 'button', tag: 'button', unnamed: 'none', ...extra });
  const t = S.countFindings([click({ locator: "getByRole('button')" }), click({ locator: "getByRole('button')" }), click({ locator: '#b2' }), click({ unnamed: 'icon', locator: '#i' }), { kind: 'dom', action: 'click', label: 'Save', role: 'button', locator: '#s' }]);
  assert.equal(t.noName, 2);
  assert.equal(t.a11y, 2);
  assert.equal(t.total, 2);
  assert.equal(S.countFindings([click({ locator: '#b' }), { kind: 'a11y', total: 3 }]).a11y, 4, 'with the scan total');
  const en = JSON.parse(read('platform', 'i18n', 'en.json'));
  const ar = JSON.parse(read('platform', 'i18n', 'ar.json'));
  for (const k of ['report.v.noNameOne', 'report.v.noNameMany']) { assert.ok(en[k], k); assert.match(ar[k], /[\u0600-\u06FF]/, k); }
  assert.match(read('report', 'nf-line.js'), /report\.v\.noNameMany/);
});
await test("D9: an export carries the tester's preset (the caller passes it, the offscreen page cannot read storage) and never writes it into session.json", async () => {
  assert.match(read('background', 'media.js'), /qaw\.netfilter/);
  assert.match(read('background', 'export-build.js'), /enumerable: false/);
  const { buildHar } = await import('../core/exporters.js');
  const session = Object.defineProperty({ startedAt: 0, charter: 'c', startUrl: 'https://shop.test/', id: 's' }, 'netFilter', { value: { preset: 'strict' }, enumerable: false });
  const events = [{ kind: 'net', method: 'GET', url: 'https://shop.test/bg', status: 404, ts: 5, seq: 1 }];
  assert.equal(JSON.parse(buildHar(session, events)).log._qawrap.networkFilter.preset, 'strict');
  assert.ok(!JSON.stringify(session).includes('strict'));
  assert.equal(JSON.parse(buildHar({ startedAt: 0, charter: 'c', startUrl: 'https://shop.test/', id: 's' }, events)).log._qawrap.networkFilter.preset, 'balanced');
});

/* ------------------------------------------------------------------ netfilter-2 review fixes */
await test('D5: a GraphQL failure is recovered only by a clean answer of the SAME operation; another operation, or an answer with errors, does not recover it', () => {
  const gql = (operation, ts, extra = {}) => ({ kind: 'net', method: 'POST', url: 'https://a.test/graphql', status: 200, ok: true, error: false, operation, ts, ...extra });
  const failA = gql('OpA', 1000, { ev: 'gql', text: 'GraphQL: 1 error' });
  const okB = gql('OpB', 2000);
  assert.equal(markRecovered([failA, okB]).size, 0, 'OpB succeeding says nothing about OpA');
  assert.equal(markRecovered([failA, gql('OpA', 2000, { ev: 'gql', text: 'GraphQL: 1 error' })]).size, 0, 'a second answer with errors is not a recovery');
  assert.equal(markRecovered([failA, gql(undefined, 2000)]).size, 0, 'an answer that names no operation does not recover a named one');
  assert.equal(markRecovered([failA, gql('OpA', 2000)]).size, 1, 'the same operation answering clean recovers it');
  assert.match(src, /operation: context\.graphql\?\.operationName/, 'the page hook names the operation on a clean answer');
});
await test('D5: a recovered row is visible amber at the default Problems level in the popup, the panel and the report, and is not counted as a problem', async () => {
  for (const f of [['popup', 'popup.js'], ['report', 'report.js'], ['devtools', 'panel.js']]) assert.match(read(...f), /r\.r === 'n-recovered'/, f.join('/'));
  assert.match(read('report', 'report.js'), /FC\?\.withRecovery\?\.\(events\)/, 'the report rows use the same recovery as the headline');
  const { withRecovery } = await import('../core/finding-count.js');
  const ev = [{ kind: 'net', method: 'GET', url: 'https://a.test/x', status: 503, ok: false, ts: 1000 }, { kind: 'net', method: 'GET', url: 'https://a.test/x', status: 200, ok: true, ts: 2000 }];
  const sig = visibleProblems(withRecovery(ev), 'all');
  assert.ok(sig.rows.some((r) => r.r === 'n-recovered'), 'the amber row is in the rows');
  assert.equal(sig.problems, 0);
});
await test('D10: no name or text based locator for a table cell, a gridcell, a password field or with the labels switch off (real Chromium; skipped without one)', async () => {
  let browser;
  try { const { chromium } = await import('playwright'); browser = await chromium.launch({ headless: true }); } catch (e) { console.log('       SKIPPED: no Chromium'); return; }
  try {
    const page = await browser.newPage();
    await page.setContent('<table><tr><td id="c1">Jane Doe order A12</td></tr></table><div role="gridcell" tabindex="0">Jane Doe VIP</div><label for="pw">Account pin</label><input id="pw" type="password"><button>Save order</button>');
    await page.addScriptTag({ content: read('content', 'selector-engine.js') });
    const r = await page.evaluate(() => {
      const S = window.UQASelector;
      const out = {};
      for (const [k, sel] of [['td', 'td'], ['grid', '[role=gridcell]'], ['pw', '#pw'], ['btn', 'button']]) {
        const el = document.querySelector(sel);
        const restricted = S.labelRestricted(el, { enabled: true, masked: k === 'pw' });
        const d = S.describe(el, { noText: restricted });
        out[k] = { restricted, text: JSON.stringify([d.locator, d.xpath, d.css, d.name, d.alternatives.map((a) => a.expr)]) };
      }
      out.off = { restricted: S.labelRestricted(document.querySelector('button'), { enabled: false }) };
      out.offText = JSON.stringify(S.describe(document.querySelector('button'), { noText: true }).locator);
      return out;
    });
    for (const k of ['td', 'grid', 'pw']) { assert.equal(r[k].restricted, true, k); assert.ok(!/Jane|Doe|VIP|order|pin|Account/i.test(r[k].text), `${k}: ${r[k].text}`); }
    assert.equal(r.btn.restricted, false);
    assert.match(r.btn.text, /Save order/, 'an ordinary button keeps its readable locator');
    assert.equal(r.off.restricted, true, 'the switch off restricts every click');
    assert.ok(!/Save/.test(r.offText), r.offText);
    assert.match(read('content', 'recorder.js'), /labelRestricted\?\.\(el, \{ enabled: labelsOn\(\), masked: isMasked\(el\) \}\)/);
  } finally { await browser.close(); }
});

/* ------------------------------------------------------------------ netfilter-2 review fixes, part 2 */
await test('D10 scrub: a non-ASCII email, and digit groups split by a no-break space or a slash, are removed', () => {
  assert.ok(!/@/.test(S.scrubLabel('Delete josé.müller@exämple.de now')), S.scrubLabel('Delete josé.müller@exämple.de now'));
  assert.ok(!/\d{3}/.test(S.scrubLabel('Call 079\u00a0123\u00a04567')), S.scrubLabel('Call 079\u00a0123\u00a04567'));
  assert.ok(!/4567/.test(S.scrubLabel('Ref 0791/234/4567')), S.scrubLabel('Ref 0791/234/4567'));
  assert.equal(S.scrubLabel('Save 2 of 3'), 'Save 2 of 3');
});
await test('D2: a request that sends credentials is auth-tagged in the page hook, and a failed one is never hidden', () => {
  assert.match(src, /reqCred === true\) ev\.au = 1/);
  assert.match(src, /credentials === 'include'|cred === 'include'/);
  assert.match(src, /withCredentials \? 'include'/);
  assert.equal(neverHidden({ kind: 'net', status: 404, au: 1, ev: undefined }), true);
});
await test('D2/D7: a protected row past the key cap is stored in full, never folded into the anonymous capped count; the HAR lists capped rows so its total equals the summary', async () => {
  assert.match(src, /if \(!noise && ev\.kind === 'net' && protectedFull < PROTECTED_FULL_CAP\) \{ protectedFull\+\+; return emit\(ev\); \}/);
  const { buildHar } = await import('../core/exporters.js');
  const events = [{ kind: 'net', method: 'GET', url: 'https://shop.test/a', status: 500, ts: 5, seq: 1 }, { kind: 'rep', ofKind: 'net', capped: true, n: 7, ts: 6, seq: 2 }, { kind: 'rep', ofKind: 'net', method: 'GET', url: 'https://shop.test/b', status: 500, n: 3, ts: 7, seq: 3 }];
  const har = JSON.parse(buildHar({ startedAt: 0, charter: 'c', startUrl: 'https://shop.test/', id: 's' }, events));
  const total = har.log.entries.reduce((a, e) => a + (e._folded || 1), 0);
  assert.equal(total, summary(prepare(events, undefined, 'shop.test')).total, 'HAR total = summary total');
  assert.equal(total, 11);
});
await test('D9: 3xx is hidden by the preset only; Everything shows it and does not count it as hidden', () => {
  const ev = [{ kind: 'net', method: 'GET', url: 'https://shop.test/r', status: 302, ts: 1 }];
  assert.equal(summary(prepare(ev, { preset: 'balanced' }, 's')).hiddenTotal, 1);
  assert.equal(summary(prepare(ev, { preset: 'everything' }, 's'), { preset: 'everything' }).hiddenTotal, 0);
  assert.match(read('devtools', 'panel.js'), /nfCfg\?\.preset !== 'everything'/);
});
await test('D9: an empty "ignored statuses" field gives no rules (no phantom status 0); the row menu resolves a relative URL against the page', async () => {
  const { parseStatuses } = await import('../core/netfilter.js');
  assert.deepEqual(parseStatuses(''), []);
  assert.deepEqual(parseStatuses(' , '), []);
  assert.deepEqual(parseStatuses('401, 403 0 700 x'), [401, 403, 0]);
  assert.match(read('devtools', 'netfilter-panel.js'), /new URL\(ev\.url, ev\.frameUrl \|\| base/);
});
await test('D10: click labels are off until the bridge has the tester\'s answer, and a change in Settings reaches an open page', () => {
  assert.match(read('content', 'recorder.js'), /window\.UQANfLabels === true/);
  assert.match(read('content', 'bridge.js'), /storage\?\.onChanged\?\.addListener[\s\S]{0,120}qaw\.netfilter[\s\S]{0,40}pushNf\(\)/);
});
await test('the record keeps only known filter tags: a page cannot forge a tag value', () => {
  const e = sanitiseEvent({ kind: 'net', method: 'GET', url: '/a', status: 500, flt: 'evil', fp: 7, ca: 1, au: 'x' });
  assert.equal(e.flt, undefined);
  assert.equal(e.fp, undefined);
  assert.equal(e.ca, 1);
  assert.equal(e.au, undefined);
  assert.equal(sanitiseEvent({ kind: 'net', method: 'GET', url: '/a', status: 404, flt: 'junk', fp: 0, au: 1 }).fp, 0);
  assert.equal(sanitiseEvent({ kind: 'net', method: 'GET', url: '/a', status: 404, flt: 'junk', fp: 0 }).flt, 'junk');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
