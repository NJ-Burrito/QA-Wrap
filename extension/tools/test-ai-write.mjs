/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * «AI writes titles and steps» (features-1010, S2, owner decision 5).
 *
 *   node tools/test-ai-write.mjs
 *
 * Real core/ai-write.js, core/ai-brief.js, core/egress.js and report/ai-suggest.js with a stubbed fetch, a fake storage
 * and a small fake DOM. No real key and no network anywhere: the "key" below is a made-up string.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installIdbStub } from './lib-idb-stub.mjs';
import { SESSION, GH, JWT, click, net, logline } from './lib-r-fixture.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r) => fs.readFileSync(path.join(EXT, r), 'utf8');
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

/* ── stubs ─────────────────────────────────────────────────────────────── */
const local = {};
const area = (bag) => ({
  get: async (k) => (k == null ? { ...bag } : Array.isArray(k) ? Object.fromEntries(k.map((x) => [x, bag[x]])) : { [k]: bag[k] }),
  set: async (o) => { Object.assign(bag, o); },
  remove: async (k) => { for (const x of [].concat(k)) delete bag[x]; },
});
const sync = {};
const permCalls = [];
const events = [];
globalThis.chrome = {
  storage: { local: area(local), sync: area(sync), session: area({}), onChanged: { addListener() {} } },
  permissions: { request: (q) => { events.push('permission'); permCalls.push(q); return Promise.resolve(true); } },
};
installIdbStub();
const copied = [];
Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (s) => { copied.push(s); } }, configurable: true });

const KEY = 'test-key-not-real-0001';
let sent = [];
let reply = () => ({ status: 200, json: { content: [{ type: 'text', text: '{"title":"Order fails with a 500","steps":["Open the orders page","Press Submit"]}' }] } });
globalThis.fetch = async (url, init) => {
  events.push('fetch');
  sent.push({ url: String(url), init });
  const r = reply(String(url));
  if (r instanceof Error) throw r;
  return { status: r.status, headers: new Headers(), json: async () => { if (r.bad) throw new Error('bad json'); return r.json; } };
};

const E = await import('../core/egress.js');
E.useLedgerArea(chrome.storage.local);
const W = await import('../core/ai-write.js');
const { buildAiBlock } = await import('../core/ai-brief.js');

const BLOCK_EVENTS = [click(0, 'Submit'), net(300), logline(400)];
const secretBlock = () => `${buildAiBlock(SESSION, BLOCK_EVENTS)}\nextra: Authorization: Bearer ${GH}\npassword=hunter2-secret token=${JWT}`;

console.log('ai-write: off by default, masking, errors, accept/dismiss');

/* ── off by default ────────────────────────────────────────────────────── */
await test('AI writing is off by default and an unreadable stored value is also off', async () => {
  assert.equal((await W.loadConfig(chrome.storage.local)).on, false);
  assert.equal(W.normaliseConfig('yes').on, false);
  assert.equal(W.normaliseConfig({ on: 'true' }).on, false);
  assert.equal(W.DEFAULT_CONFIG.on, false);
});

await test('without a key nothing is sent', async () => {
  sent = [];
  await assert.rejects(() => W.suggest({ provider: 'anthropic', key: '', block: 'x' }), (e) => e.code === 'nokey');
  assert.equal(sent.length, 0);
});

/* ── masking before send ───────────────────────────────────────────────── */
for (const provider of W.PROVIDER_IDS) {
  await test(`${provider}: a planted secret never reaches fetch; the key travels only in a header`, async () => {
    sent = [];
    const text = provider === 'anthropic' ? undefined : { status: 200, json: { choices: [{ message: { content: '{"title":"T","steps":["a"]}' } }] } };
    if (text) reply = () => text;
    const out = await W.suggest({ provider, key: KEY, block: secretBlock() });
    reply = () => ({ status: 200, json: { content: [{ type: 'text', text: '{"title":"Order fails with a 500","steps":["Open the orders page","Press Submit"]}' }] } });
    assert.equal(sent.length, 1, 'one request per call');
    for (const s of [GH, JWT, 'hunter2-secret']) assert.ok(!sent[0].init.body.includes(s), `the body leaked ${s.slice(0, 6)}`);
    assert.ok(!sent[0].init.body.includes(KEY), 'the key is not in the body');
    assert.ok(JSON.stringify(sent[0].init.headers).includes(KEY), 'the key is in a header');
    assert.ok(sent[0].url.startsWith(`https://${W.PROVIDERS[provider].host}/`));
    assert.ok(out.title && out.steps.length);
  });
}

await test('Anthropic request: browser header, no sampling parameter, the default model is a current id', async () => {
  const { init } = W.buildRequest('anthropic', W.PROVIDERS.anthropic.defaultModel, KEY, 'hello');
  assert.equal(init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  const body = JSON.parse(init.body);
  assert.ok(!('temperature' in body) && !('thinking' in body));
  assert.match(body.model, /^claude-(haiku|sonnet|opus)-\d/);
  assert.ok(!/\d{8}$/.test(body.model), 'no dated suffix');
});

await test('the send is written to the egress ledger: kind, host, size, no content', async () => {
  const rows = local[E.LEDGER_KEY] || [];
  const row = rows.filter((r) => r.kind === 'ai-write').pop();
  assert.ok(row, 'no ai-write row');
  assert.ok(row.host && row.bytes > 0 && row.scanned === true);
  assert.ok(!JSON.stringify(rows).includes('Order fails'), 'no content in the ledger');
});

/* ── error mapping ─────────────────────────────────────────────────────── */
await test('errors map to a code: 401 badKey, 429 rate, 402 credit, 404 model, 400 request, 503 server, offline, unreadable', async () => {
  const cases = [[401, 'badKey'], [403, 'badKey'], [429, 'rate'], [402, 'credit'], [404, 'model'], [400, 'request'], [503, 'server']];
  for (const [status, code] of cases) {
    reply = () => ({ status, json: {} });
    await assert.rejects(() => W.suggest({ provider: 'openai', key: KEY, block: 'x' }), (e) => e.code === code, `${status}`);
  }
  reply = () => new TypeError('Failed to fetch');
  await assert.rejects(() => W.suggest({ provider: 'openai', key: KEY, block: 'x' }), (e) => e.code === 'offline');
  reply = () => ({ status: 200, bad: true });
  await assert.rejects(() => W.suggest({ provider: 'openai', key: KEY, block: 'x' }), (e) => e.code === 'unreadable');
  reply = () => ({ status: 200, json: { choices: [{ message: { content: 'sorry, no' } }] } });
  await assert.rejects(() => W.suggest({ provider: 'openai', key: KEY, block: 'x' }), (e) => e.code === 'unreadable');
  reply = () => ({ status: 200, json: { content: [{ type: 'text', text: '```json\n{"title":"T","steps":["a","b"]}\n```' }] } });
  assert.deepEqual(await W.suggest({ provider: 'anthropic', key: KEY, block: 'x' }), { title: 'T', steps: ['a', 'b'] });
});

await test('every error code and every UI string exists in English and Arabic', () => {
  for (const lang of ['en', 'ar']) {
    const m = JSON.parse(read(`platform/i18n/${lang}.json`));
    for (const c of ['nokey', 'badKey', 'rate', 'credit', 'model', 'request', 'server', 'offline', 'unreadable', 'denied']) assert.ok(m[`aiwrite.err.${c}`], `${lang} ${c}`);
    for (const k of ['button', 'preview', 'send', 'suggested', 'accept', 'edit', 'dismiss', 'title', 'on', 'key', 'keySave', 'keyRemove']) assert.ok(m[`aiwrite.${k}`], `${lang} ${k}`);
  }
});

/* ── the report control, in a fake DOM ─────────────────────────────────── */
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this._text = ''; this.hidden = false; this.disabled = false; this.className = ''; this.value = ''; }
  append(...c) { this.children.push(...c); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  focus() {}
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(' '); }
  async click() { if (this.disabled) return; const fs_ = this.listeners.click || []; for (const f of fs_) await f({}); await new Promise((r) => setTimeout(r, 5)); }
  find(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) c.find(pred, out); return out; }
}
globalThis.document = { createElement: (tag) => new Node(tag) };
const el = (tag, cls, text) => { const e = new Node(tag); e.className = cls || ''; if (text != null) e._text = text; return e; };
const tt = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const said = [];
const { suggestControl } = await import('../report/ai-suggest.js');
const mount = async (evs) => { const w = suggestControl({ el, t: tt, say: (m, tone) => said.push([m, tone]), session: SESSION, events: () => evs }); await new Promise((r) => setTimeout(r, 5)); return w; };
const btnOf = (w) => w.children[0].children[0];
const panelOf = (w) => w.children[1];

await test('off: no button is shown and no request or permission prompt happens, even if a key is stored', async () => {
  local.aiWritingKey = KEY;
  sent = []; permCalls.length = 0;
  const w = await mount(BLOCK_EVENTS);
  assert.equal(w.hidden, true);
  assert.equal(sent.length, 0);
  assert.equal(permCalls.length, 0);
});

await test('on: the button shows, a click only previews (rough token count, exact text) and sends nothing', async () => {
  await W.saveConfig(chrome.storage.local, { on: true, provider: 'anthropic', model: '' });
  sent = []; permCalls.length = 0;
  const w = await mount(BLOCK_EVENTS);
  assert.equal(w.hidden, false);
  await btnOf(w).click();
  assert.equal(sent.length, 0, 'nothing is sent by the first click');
  const shown = panelOf(w).textContent;
  assert.match(shown, /aiwrite\.preview/);
  assert.match(shown, /"n":\d+/);
  assert.match(shown, /api\.anthropic\.com/);
});

await test('Send: permission is requested first, in the click, then ONE request; the result is labelled suggested and the raw events are untouched', async () => {
  reply = () => ({ status: 200, json: { content: [{ type: 'text', text: '{"title":"Order fails with a 500","steps":["Open the orders page","Press Submit"]}' }] } });
  const evs = structuredClone(BLOCK_EVENTS);
  const before = JSON.stringify({ evs, SESSION });
  sent = []; permCalls.length = 0; events.length = 0;
  const w = await mount(evs);
  await btnOf(w).click();
  const send = panelOf(w).find((x) => x.tag === 'button' && /aiwrite\.send/.test(x._text))[0];
  await send.click();
  for (let i = 0; i < 300 && !events.includes('fetch'); i++) await new Promise((r) => setTimeout(r, 10)); // the click returns before the sealed key is read and the request goes out; under load that is later
  assert.deepEqual(permCalls, [{ origins: ['https://api.anthropic.com/*'] }]);
  assert.ok(events.indexOf('permission') < events.indexOf('fetch'), 'permission before fetch');
  assert.equal(sent.length, 1);
  const shown = panelOf(w).textContent;
  assert.match(shown, /aiwrite\.suggested/);
  assert.equal(JSON.stringify({ evs, SESSION }), before, 'raw data is unchanged');
});

await test('Dismiss closes the suggestion and changes nothing; Edit then Accept copies the edited wording only', async () => {
  const evs = structuredClone(BLOCK_EVENTS);
  const before = JSON.stringify(evs);
  const w = await mount(evs);
  await btnOf(w).click();
  await panelOf(w).find((x) => x.tag === 'button' && /aiwrite\.send/.test(x._text))[0].click();
  const [title, steps] = panelOf(w).find((x) => x.tag === 'input' || x.tag === 'textarea');
  assert.equal(title.readOnly, true);
  await panelOf(w).find((x) => /aiwrite\.edit/.test(x._text))[0].click();
  assert.equal(title.readOnly, false);
  title.value = 'My own title';
  steps.value = 'one\n\ntwo';
  copied.length = 0;
  await panelOf(w).find((x) => /aiwrite\.accept/.test(x._text))[0].click();
  assert.deepEqual(copied, ['My own title\n\n1. one\n2. two']);
  assert.equal(panelOf(w).hidden, true);
  // dismiss path
  await btnOf(w).click();
  await panelOf(w).find((x) => x.tag === 'button' && /aiwrite\.send/.test(x._text))[0].click();
  copied.length = 0;
  await panelOf(w).find((x) => /aiwrite\.dismiss/.test(x._text))[0].click();
  assert.equal(panelOf(w).hidden, true);
  assert.deepEqual(copied, []);
  assert.equal(JSON.stringify(evs), before, 'raw data is unchanged');
});

await test('a failed request shows a clear error and no suggestion (no silent fallback)', async () => {
  reply = () => ({ status: 401, json: {} });
  const w = await mount(BLOCK_EVENTS);
  await btnOf(w).click();
  await panelOf(w).find((x) => x.tag === 'button' && /aiwrite\.send/.test(x._text))[0].click();
  assert.match(panelOf(w).textContent, /aiwrite\.err\.badKey/);
  assert.ok(!/aiwrite\.suggested/.test(panelOf(w).textContent));
  assert.equal(panelOf(w).attrs.role, 'region');
});

await test('a refused permission sends nothing', async () => {
  const real = chrome.permissions.request;
  chrome.permissions.request = () => Promise.resolve(false);
  sent = [];
  const w = await mount(BLOCK_EVENTS);
  await btnOf(w).click();
  await panelOf(w).find((x) => x.tag === 'button' && /aiwrite\.send/.test(x._text))[0].click();
  chrome.permissions.request = real;
  assert.equal(sent.length, 0);
  assert.match(panelOf(w).textContent, /aiwrite\.err\.denied/);
});

/* ── where the key lives, and the only call site ───────────────────────── */
await test('the key and the choice are local-only stores, registered, never in the synced settings', async () => {
  const { REGISTRY } = await import('../core/store-registry.js');
  const { SYNCED_SETTINGS } = await import('../core/store-registry.js');
  for (const k of ['aiWriting', 'aiWritingKey']) {
    const row = REGISTRY.find((r) => r.id === `local:${k}`);
    assert.ok(row && row.syncs === false, k);
    assert.ok(!SYNCED_SETTINGS.includes(k));
  }
  await W.saveKey(chrome.storage.local, KEY);
  assert.ok(!JSON.stringify(sync).includes(KEY), 'nothing in sync');
  await W.removeKey(chrome.storage.local);
  assert.equal(await W.hasKey(chrome.storage.local), false);
  assert.ok(!W.maskKey(KEY).includes(KEY.slice(0, 10)));
});

await test('the three API hosts are covered by the one <all_urls> host permission (listing them again is a Chrome warning), and no provider host is called from anywhere else', () => {
  const mf = JSON.parse(read('manifest.json'));
  assert.deepEqual(mf.host_permissions, ['<all_urls>']);
  assert.equal(mf.optional_host_permissions, undefined, 'redundant with the required <all_urls>: chrome://extensions shows a warning');
  const hits = [];
  const walk = (d) => { for (const f of fs.readdirSync(path.join(EXT, d), { withFileTypes: true })) {
    const rel = path.posix.join(d, f.name);
    if (f.isDirectory()) { if (!/^(node_modules|vendor|tools|docs|store|_locales)$/.test(f.name)) walk(rel); } else if (/\.(js|mjs)$/.test(f.name) && /api\.(anthropic|openai)\.com|openrouter\.ai/.test(read(rel))) hits.push(rel);
  } };
  walk('.');
  assert.deepEqual(hits.sort(), ['core/ai-write.js']);
  const importers = [];
  for (const d of ['background', 'content', 'offscreen', 'popup', 'sidepanel', 'core', 'platform']) {
    const w2 = (dir) => { for (const f of fs.readdirSync(path.join(EXT, dir), { withFileTypes: true })) { const rel = path.posix.join(dir, f.name); if (f.isDirectory()) w2(rel); else if (/\.m?js$/.test(f.name) && /ai-write\.js/.test(read(rel))) importers.push(rel); } };
    w2(d);
  }
  assert.deepEqual(importers, [], 'no background, popup or content module imports the model caller');
  assert.deepEqual(['report/ai-suggest.js', 'options/ai-writing.js'].filter((f) => /ai-write\.js/.test(read(f))).length, 2);
});

await test('S-09: the key is sealed in the vault on the real storage, and both files name it the same', () => {
  const k = read('platform/ai-key.js');
  assert.match(k, /saveSealed\(AI_KEY_KEY/);
  assert.match(k, /loadSealed\(AI_KEY_KEY/);
  assert.equal(/const AI_KEY_KEY = '([^']+)'/.exec(k)[1], W.AI_KEY_KEY);
  for (const f of ['options/ai-writing.js', 'report/ai-suggest.js']) assert.match(read(f), /platform\/ai-key\.js/, f);
  assert.ok(!/store\(\)\.get\('aiWritingKey'\)|store\.get\(AI_KEY_KEY\)/.test(read('report/ai-suggest.js') + read('options/ai-writing.js')), 'a page reads the key in clear');
});

console.log(`\n${n} passed, 0 failed`);
