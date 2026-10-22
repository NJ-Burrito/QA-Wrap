/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Lane AUI (DESIGN-1011): per-site powers and the popup ticks that switch them on.
 *
 *   node tools/test-site-powers.mjs
 *
 * Runs the real classic scripts (options/remembered.js, popup/onboard.js, popup/autopilot-banner.js) inside `vm`, over a
 * very small DOM and chrome.storage fake (the helpers below; test-autopilot-privacy.mjs imports them, and the tests only
 * run when this file is the entry point). Covered:
 *   - AUTO-6: per site four independent switches (wake, autoStartSites, autoShotSites, bufferSites); pressing one removes only
 *     its own key; "Forget all" clears the wake list only; the page-indicator switch (absent = on).
 *   - AUTO-3: the two ticks under the wake tick (hidden until it is on, off by default, one list each, consent text in view,
 *     EN and AR), and P0-2 (an open practice tab is focused, never duplicated).
 *   - the pause / resume / idle banners, and the string fragments the INT lane merges.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = (...p) => fs.readFileSync(path.join(EXT, ...p), 'utf8');
const FRAG = (name) => path.resolve(EXT, 'tools', 'fixtures', 'i18n', name);

/* ── a very small DOM ─────────────────────────────────────────────────────────────────────────── */
export class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.parent = null;
    this.id = '';
    this.className = '';
    this.type = '';
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this._text = '';
    this._l = {};
  }

  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  after(node) { const p = this.parent; node.parent = p; p.children.splice(p.children.indexOf(this) + 1, 0, node); }
  addEventListener(name, fn) { (this._l[name] ||= []).push(fn); }
  /** Dispatches like a user change/click; resolves when every listener has finished. */
  async fire(name) { for (const fn of this._l[name] || []) await fn({ target: this, isTrusted: true }); }
  walk(fn) { for (const c of this.children) { fn(c); c.walk(fn); } }
  querySelectorAll(sel) {
    const out = [];
    const want = sel === 'input' ? (n) => n.tagName === 'INPUT' : (n) => Object.keys(n.dataset).includes('i18n');
    this.walk((n) => { if (want(n)) out.push(n); });
    return out;
  }
}

/** `ids`: static elements, as 'id' or ['id', 'tag']. */
export function makeDocument(ids = []) {
  const body = new El('body');
  const doc = {
    body,
    createElement: (tag) => new El(tag),
    getElementById: (id) => { let hit = null; body.walk((n) => { if (!hit && n.id === id) hit = n; }); return hit; },
  };
  for (const entry of ids) {
    const [id, tag = 'div'] = Array.isArray(entry) ? entry : [entry];
    const e = new El(tag);
    e.id = id;
    body.append(e);
  }
  return doc;
}

/** chrome.storage.local/session in memory. `writes.n` counts set/remove calls (the privacy test wants zero on a fresh profile). */
export function makeStorage() {
  const data = {};
  const listeners = [];
  const writes = { n: 0 };
  const pick = (keys) => {
    if (keys == null) return { ...data };
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    return Object.fromEntries(names.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
  };
  const area = (name) => ({
    get: async (keys) => pick(keys),
    set: async (obj) => {
      writes.n++;
      const changes = {};
      for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: data[k], newValue: v }; data[k] = structuredClone(v); }
      for (const l of listeners) l(changes, name);
    },
    remove: async (keys) => {
      writes.n++;
      const changes = {};
      for (const k of [].concat(keys)) { if (k in data) { changes[k] = { oldValue: data[k] }; delete data[k]; } }
      for (const l of listeners) l(changes, name);
    },
  });
  return { data, writes, local: area('local'), session: area('session'), onChanged: { addListener: (fn) => listeners.push(fn) } };
}

/** Runs a classic script from the extension tree inside a fresh context made from `globals`; returns the context. */
export function runClassic(file, globals) {
  const ctx = vm.createContext(globals);
  vm.runInContext(read(...file.split('/')), ctx, { filename: file });
  return ctx;
}

/** Objects made inside a vm context are another realm's: compare them as plain JSON. */
export const plain = (x) => JSON.parse(JSON.stringify(x));

export const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** t() over a key table, with {param} substitution, falling back to the key (as QAWi18n.t does). */
export const translator = (table) => (k, v = {}) => String(table[k] ?? k).replace(/\{(\w+)\}/g, (_, p) => (p in v ? v[p] : `{${p}}`));

/** The shipped table with this lane's fragment on top (INT merges the fragment into platform/i18n later). */
export const table = (lang) => ({
  ...JSON.parse(read('platform', 'i18n', `${lang}.json`)),
  ...JSON.parse(fs.readFileSync(FRAG(`AUI.${lang}.json`), 'utf8')),
});
export const fragment = (lang) => JSON.parse(fs.readFileSync(FRAG(`AUI.${lang}.json`), 'utf8'));

/* ── the tests ────────────────────────────────────────────────────────────────────────────────── */
async function main() {
  const en = table('en');
  const ar = table('ar');
  let n = 0;
  let failed = 0;
  const test = async (name, fn) => {
    try { await fn(); n++; console.log(`  ok  ${name}`); } catch (e) { n++; failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
  };
  const SHOP = 'https://shop.example.com';

  /* Settings: four independent switches per site */
  const settingsRig = (seed = {}, lang = en) => {
    const st = makeStorage();
    Object.assign(st.data, structuredClone(seed));
    const doc = makeDocument(['remembered-list', 'forget-sites', 'state-remembered', 'dot-remembered', 'auto-indicator']);
    const chrome = { storage: { local: st.local, onChanged: st.onChanged } };
    runClassic('options/remembered.js', { document: doc, chrome, QAWi18n: { t: translator(lang), ready: () => Promise.resolve() } });
    return { st, doc, rows: () => doc.getElementById('remembered-list').children };
  };
  const ALL = { rememberedSites: [`${SHOP}/*`], autoStartSites: [`${SHOP}/*`], autoShotSites: [`${SHOP}/*`], bufferSites: [SHOP] };
  const boxesOf = (row) => row.children[1].children.map((label) => label.children[0]);

  await test('Settings: one row per site with four switches, all on for a fully seeded site', async () => {
    const r = settingsRig(ALL);
    await settle();
    assert.equal(r.rows().length, 1);
    assert.equal(r.rows()[0].children[0].textContent, SHOP);
    const boxes = boxesOf(r.rows()[0]);
    assert.deepEqual(boxes.map((b) => b.dataset.power), ['rememberedSites', 'autoStartSites', 'autoShotSites', 'bufferSites']);
    assert.ok(boxes.every((b) => b.checked && !b.disabled));
    assert.deepEqual(r.rows()[0].children[1].children.map((l) => l.children[1].textContent), ['Wakes up', 'Starts by itself', 'Screenshot on error', '2-minute buffer']);
  });

  for (const key of Object.keys(ALL)) {
    await test(`Settings: pressing the ${key} switch removes only ${key}`, async () => {
      const r = settingsRig(ALL);
      await settle();
      const box = boxesOf(r.rows()[0]).find((b) => b.dataset.power === key);
      box.checked = false;
      await box.fire('change');
      await settle();
      for (const other of Object.keys(ALL)) {
        if (other === key) assert.deepEqual(r.st.data[other], [], `${other} should be emptied`);
        else assert.deepEqual(r.st.data[other], ALL[other], `${other} must be untouched`);
      }
    });
  }

  await test('Settings: a site that only has the buffer on still shows, the other three off and disabled', async () => {
    const r = settingsRig({ bufferSites: ['https://only.example.org'] });
    await settle();
    assert.equal(r.rows().length, 1);
    assert.deepEqual(boxesOf(r.rows()[0]).map((b) => [b.dataset.power, b.checked, b.disabled]),
      [['rememberedSites', false, true], ['autoStartSites', false, true], ['autoShotSites', false, true], ['bufferSites', true, false]]);
  });

  await test('Settings: the list repaints when any of the new keys changes elsewhere', async () => {
    const r = settingsRig({});
    await settle();
    assert.equal(r.rows().length, 0);
    await r.st.local.set({ autoStartSites: [`${SHOP}/*`] });
    await settle();
    assert.equal(r.rows().length, 1);
    await r.st.local.set({ autoShotSites: ['https://b.example.org/*'] });
    await settle();
    assert.equal(r.rows().length, 2);
    await r.st.local.remove(['autoStartSites', 'autoShotSites']);
    await settle();
    assert.equal(r.rows().length, 0);
  });

  await test('Settings: "Forget all" clears the wake list and nothing else', async () => {
    const r = settingsRig(ALL);
    await settle();
    await r.doc.getElementById('forget-sites').fire('click');
    await settle();
    assert.equal('rememberedSites' in r.st.data, false);
    for (const k of ['autoStartSites', 'autoShotSites', 'bufferSites']) assert.deepEqual(r.st.data[k], ALL[k]);
  });

  await test('Settings: the recording dot is on when the key is absent; off writes false; on again removes the key', async () => {
    const r = settingsRig({});
    await settle();
    const box = r.doc.getElementById('auto-indicator');
    assert.equal(box.checked, true);
    box.checked = false;
    await box.fire('change');
    assert.equal(r.st.data.pageIndicator, false);
    box.checked = true;
    await box.fire('change');
    assert.equal('pageIndicator' in r.st.data, false);
    const off = settingsRig({ pageIndicator: false });
    await settle();
    assert.equal(off.doc.getElementById('auto-indicator').checked, false);
  });

  await test('Settings: the switch labels exist in Arabic', async () => {
    const r = settingsRig(ALL, ar);
    await settle();
    assert.deepEqual(r.rows()[0].children[1].children.map((l) => l.children[1].textContent), ['يشتغل تلقائيًا', 'يبدأ تلقائيًا', 'لقطة عند الخطأ', 'آخر دقيقتين']);
  });

  await test('Settings: options.html carries the indicator switch, the list and remembered.js', () => {
    const html = read('options', 'options.html');
    assert.match(html, /id="auto-indicator"/);
    assert.match(html, /id="remembered-list"/);
    assert.match(html, /src="remembered\.js"/);
  });

  /* Popup: two more ticks under the wake tick */
  const popupRig = ({ lang = en, pattern = `${SHOP}/*`, policy = 'ask', seed = {}, found = [] } = {}) => {
    const st = makeStorage();
    Object.assign(st.data, structuredClone(seed));
    const doc = makeDocument([['remember-row', 'label'], ['remember-site', 'input']]);
    const calls = { create: [], update: [], winUpdate: [] };
    const chrome = {
      storage: { local: st.local, session: st.session },
      runtime: { getURL: (p) => `chrome-extension://abc/${p}` },
      tabs: { query: async () => found, update: async (...a) => { calls.update.push(a); }, create: (...a) => { calls.create.push(a); } },
      windows: { update: async (...a) => { calls.winUpdate.push(a); } },
    };
    const globals = {
      document: doc, chrome, $: (id) => doc.getElementById(id), t: translator(lang), say() {},
      siteAccess: { pattern, policy, granted: true }, awake: true, ctx: { windowId: 4 }, resolveCtx: async () => ({ id: 1 }),
      state: {}, send: async () => ({ ok: true }), refresh() {},
    };
    const ctx = runClassic('popup/onboard.js', globals);
    return { st, doc, calls, paint: () => vm.runInContext('paintRemember()', ctx), open: () => vm.runInContext('openPractice()', ctx) };
  };
  const byId = (doc, id) => doc.getElementById(id);
  const i18nNodes = (doc) => { const out = []; doc.getElementById('auto-rows').walk((nd) => { if (nd.dataset.i18n) out.push([nd.dataset.i18n, nd.textContent]); }); return out; };

  await test('Popup: the two ticks are hidden until the wake tick is on, and painting a fresh profile writes nothing', async () => {
    const r = popupRig();
    await r.paint();
    assert.ok(byId(r.doc, 'auto-rows'), 'auto rows built');
    assert.equal(byId(r.doc, 'auto-rows').hidden, true);
    assert.equal(r.st.writes.n, 0);
  });

  await test('Popup: ticking wake shows both ticks, off, each with its consent sentence in view', async () => {
    const r = popupRig();
    await r.paint();
    const wake = byId(r.doc, 'remember-site');
    wake.checked = true;
    await wake.fire('change');
    await settle();
    assert.deepEqual(r.st.data.rememberedSites, [`${SHOP}/*`]);
    assert.equal(byId(r.doc, 'auto-rows').hidden, false);
    assert.equal(byId(r.doc, 'auto-start-site').checked, false);
    assert.equal(byId(r.doc, 'auto-shot-site').checked, false);
    const nodes = i18nNodes(r.doc);
    assert.deepEqual(nodes.map((x) => x[0]), ['popup.auto.startLabel', 'popup.auto.startConsent', 'popup.auto.shotLabel', 'popup.auto.shotConsent']);
    for (const [k, v] of nodes) assert.equal(v, en[k]);
    assert.match(en['popup.auto.startConsent'], /30 minutes/);
    assert.match(en['popup.auto.startConsent'], /this browser/);
    assert.match(en['popup.auto.startConsent'], /Untick/);
    assert.match(en['popup.auto.shotConsent'], /not scanned for secrets/);
  });

  await test('Popup: each tick writes only its own list, separate from Remember', async () => {
    const r = popupRig({ seed: { rememberedSites: [`${SHOP}/*`] } });
    await r.paint();
    const start = byId(r.doc, 'auto-start-site');
    start.checked = true;
    await start.fire('change');
    assert.deepEqual(r.st.data.autoStartSites, [`${SHOP}/*`]);
    assert.equal('autoShotSites' in r.st.data, false);
    assert.deepEqual(r.st.data.rememberedSites, [`${SHOP}/*`]);
    const shot = byId(r.doc, 'auto-shot-site');
    shot.checked = true;
    await shot.fire('change');
    assert.deepEqual(r.st.data.autoShotSites, [`${SHOP}/*`]);
    start.checked = false;
    await start.fire('change');
    assert.deepEqual(r.st.data.autoStartSites, []);
    assert.deepEqual(r.st.data.autoShotSites, [`${SHOP}/*`]);
  });

  await test('Popup: unticking wake switches both powers off for that site only', async () => {
    const other = 'https://other.example.org/*';
    const r = popupRig({ seed: { rememberedSites: [`${SHOP}/*`, other], autoStartSites: [`${SHOP}/*`, other], autoShotSites: [`${SHOP}/*`] } });
    await r.paint();
    assert.equal(byId(r.doc, 'auto-start-site').checked, true);
    const wake = byId(r.doc, 'remember-site');
    wake.checked = false;
    await wake.fire('change');
    await settle();
    assert.deepEqual(r.st.data.rememberedSites, [other]);
    assert.deepEqual(r.st.data.autoStartSites, [other]);
    assert.deepEqual(r.st.data.autoShotSites, []);
    assert.equal(byId(r.doc, 'auto-rows').hidden, true);
  });

  await test('Popup: hidden on the practice page and where the policy says none', async () => {
    for (const o of [{ pattern: 'practice' }, { policy: 'none' }, { pattern: null }]) {
      const r = popupRig({ ...o, seed: { rememberedSites: [`${SHOP}/*`] } });
      await r.paint();
      assert.equal(byId(r.doc, 'remember-row').hidden, true);
      assert.equal(byId(r.doc, 'auto-rows').hidden, true);
    }
  });

  await test('Popup: in Arabic the consent text painted is the Arabic one', async () => {
    const r = popupRig({ lang: ar, seed: { rememberedSites: [`${SHOP}/*`] } });
    await r.paint();
    const nodes = i18nNodes(r.doc);
    assert.equal(nodes.length, 4);
    for (const [k, v] of nodes) assert.equal(v, ar[k]);
  });

  await test('P0-2: an open practice tab is focused, not duplicated', async () => {
    const r = popupRig({ found: [{ id: 9, windowId: 2 }] });
    await r.open();
    assert.equal(r.calls.create.length, 0);
    assert.deepEqual(plain(r.calls.update), [[9, { active: true }]]);
    assert.deepEqual(plain(r.calls.winUpdate), [[2, { focused: true }]]);
  });

  await test('P0-2: with no practice tab open it opens exactly one, in the window under test', async () => {
    const r = popupRig();
    await r.open();
    assert.equal(r.calls.create.length, 1);
    assert.deepEqual(plain(r.calls.create[0]), [{ url: 'chrome-extension://abc/practice/practice.html', windowId: 4 }]);
    assert.equal(r.calls.update.length, 0);
  });

  /* The pause and idle banners (C6) */
  const bannerRig = () => {
    const st = makeStorage();
    const sent = [];
    const chrome = { storage: { session: st.session }, runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true }; } } };
    const ctx = runClassic('popup/autopilot-banner.js', { chrome, Date });
    return { st, sent, banner: (site, session, lang = en) => vm.runInContext('autopilotBanner', ctx)(site, session, translator(lang)) };
  };
  const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

  await test('Banner: nothing for a plain session, a finished one, or no session', () => {
    const b = bannerRig();
    assert.equal(b.banner({ now: NOW }, null), null);
    assert.equal(b.banner({ now: NOW }, { id: 's1' }), null);
    assert.equal(b.banner({ now: NOW }, { id: 's1', endedAt: 5, stopReason: 'user' }), null);
  });

  await test('Banner: a session that started by itself offers the 1-hour pause; pressing it writes the deadline and stops that session', async () => {
    const b = bannerRig();
    const out = b.banner({ now: NOW }, { id: 's1', autoStarted: true });
    assert.equal(out.text, en['popup.auto.running']);
    assert.equal(out.buttonKey, 'popup.auto.pause');
    assert.equal(en[out.buttonKey], 'Pause for 1 hour');
    const before = Date.now();
    await out.action();
    const until = b.st.data.autoPauseUntil;
    assert.ok(until >= before + 3600e3 && until <= Date.now() + 3600e3, 'deadline is one hour out');
    assert.deepEqual(plain(b.sent), [{ type: 'UQA_STOP' }]);
  });

  await test('Banner: while paused it offers Resume, and Resume removes the deadline without stopping anything', async () => {
    const b = bannerRig();
    const out = b.banner({ now: NOW, pauseUntil: NOW + 600e3 }, { id: 's1', autoStarted: true });
    assert.equal(out.buttonKey, 'popup.auto.resume');
    assert.match(out.text, /^Paused\./);
    await b.st.session.set({ autoPauseUntil: NOW + 600e3 });
    await out.action();
    assert.equal('autoPauseUntil' in b.st.data, false);
    assert.equal(b.sent.length, 0);
    assert.equal(b.banner({ now: NOW, pauseUntil: NOW - 1 }, null), null, 'an expired pause shows nothing');
  });

  await test('Banner (D10): the pause is per site: Resume shows only where this site has an auto power ticked', async () => {
    const mk = (pattern, lists) => {
      const st = makeStorage();
      st.local.set(lists);
      st.session.set({ autoPauseUntil: Date.now() + 600e3 });
      const chrome = { storage: { session: st.session, local: st.local }, runtime: { sendMessage: async () => ({ ok: true }) } };
      const ctx = runClassic('popup/autopilot-banner.js', { chrome, Date, siteAccess: { pattern } });
      return async () => {
        const site = await vm.runInContext('autopilotSiteState', ctx)();
        return vm.runInContext('autopilotBanner', ctx)(site, null, translator(en));
      };
    };
    const P = 'https://shop.example.com/*';
    assert.equal((await mk(P, { autoStartSites: [P] })())?.id, 'resume', 'a site with auto-start sees Resume');
    assert.equal((await mk(P, { autoShotSites: [P] })())?.id, 'resume', 'a site with auto-screenshot sees Resume');
    assert.equal(await mk(P, { autoStartSites: ['https://other.example.com/*'] })(), null, 'another site: no Resume');
    assert.equal(await mk(null, { autoStartSites: [P] })(), null, 'a page QA Wrap cannot reach: no Resume');
  });

  await test('Banner: the idle stop is a line with no button, in both languages', () => {
    const b = bannerRig();
    const out = b.banner({ now: NOW }, { id: 's1', autoStarted: true, endedAt: NOW, stopReason: 'idle' });
    assert.deepEqual([out.id, out.buttonKey, out.action], ['idle', null, null]);
    assert.equal(out.text, en['popup.auto.idleStopped']);
    assert.equal(b.banner({ now: NOW }, { endedAt: 1, stopReason: 'idle' }, ar).text, ar['popup.auto.idleStopped']);
  });

  /* The strings */
  await test('Strings: fragments have the same keys and placeholders in both languages, no absolute words, no markup', () => {
    const fe = fragment('en');
    const fa = fragment('ar');
    assert.deepEqual(Object.keys(fe).sort(), Object.keys(fa).sort());
    for (const [k, v] of Object.entries(fe)) {
      if (k === '__override') { assert.deepEqual(Object.keys(v).sort(), Object.keys(fa[k]).sort()); continue; }
      assert.ok(v && fa[k], `${k} has both languages`);
      assert.ok(!/\b(never|nothing|always|no one|nobody)\b/i.test(v), `${k}: absolute word`);
      assert.ok(!/</.test(v) && !/</.test(fa[k]), `${k}: markup in a string that is painted as text`);
      const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(ph(v), ph(fa[k]), `${k}: placeholders differ`);
    }
  });

  console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n} passed`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
