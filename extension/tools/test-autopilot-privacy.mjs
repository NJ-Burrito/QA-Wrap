/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * REQ-AUTO-7 / rule 12: nothing widens capture or egress by default.
 *
 *   node tools/test-autopilot-privacy.mjs
 *
 *   1. A fresh profile has the four site lists (rememberedSites, autoStartSites, autoShotSites, bufferSites) empty, and the
 *      lane-AUI screens (Settings list, popup ticks, banners) paint it without writing anything.
 *   2. Setting any "Autopilot" setting (the page indicator, the pause) leaves the four lists empty.
 *   3. A fake tracker (fetch, XMLHttpRequest, sendBeacon, WebSocket, Image) counts 0 outbound requests while those screens load,
 *      paint and are pressed; the only message sent is the local UQA_STOP of a pause.
 *   4. Source scan: the files of this lane contain no network call, and `confirm(` appears only in the allow-list below.
 *
 * The same scripts as test-site-powers.mjs, run in `vm` over its small DOM and storage fake.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EXT, read, makeDocument, makeStorage, runClassic, settle, translator, table, plain } from './test-site-powers.mjs';

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n++; console.log(`  ok  ${name}`); } catch (e) { n++; failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

const LISTS = ['rememberedSites', 'autoStartSites', 'autoShotSites', 'bufferSites'];
const emptyLists = (data) => LISTS.every((k) => !(k in data) || (Array.isArray(data[k]) && data[k].length === 0));

/** One fresh browser profile: every network door counted. */
function profile() {
  const st = makeStorage();
  const net = { fetch: 0, xhr: 0, beacon: 0, socket: 0, image: 0 };
  const sent = [];
  const doc = makeDocument(['remembered-list', 'forget-sites', 'state-remembered', 'dot-remembered', 'auto-indicator', ['remember-row', 'label'], ['remember-site', 'input']]);
  const t = translator(table('en'));
  const tracker = {
    fetch: () => { net.fetch++; return Promise.reject(new Error('blocked')); },
    XMLHttpRequest: class { constructor() { net.xhr++; } },
    WebSocket: class { constructor() { net.socket++; } },
    Image: class { constructor() { net.image++; } },
    navigator: { sendBeacon: () => { net.beacon++; return false; } },
  };
  const chrome = {
    storage: { local: st.local, session: st.session, onChanged: st.onChanged },
    runtime: { getURL: (p) => `chrome-extension://abc/${p}`, sendMessage: async (m) => { sent.push(m); return { ok: true }; } },
    tabs: { query: async () => [], update: async () => {}, create: () => {} },
    windows: { update: async () => {} },
  };
  const base = { document: doc, chrome, QAWi18n: { t, ready: () => Promise.resolve() }, ...tracker };
  runClassic('options/remembered.js', base);
  const popup = runClassic('popup/onboard.js', {
    ...base, $: (id) => doc.getElementById(id), t, say() {}, siteAccess: { pattern: 'https://shop.example.com/*', policy: 'ask', granted: true },
    awake: true, ctx: { windowId: 1 }, resolveCtx: async () => ({ id: 1 }), state: {}, send: async () => ({ ok: true }), refresh() {},
  });
  const banner = runClassic('popup/autopilot-banner.js', { ...base });
  return { st, net, sent, doc, popup, banner };
}
const total = (net) => Object.values(net).reduce((a, b) => a + b, 0);

await test('a fresh profile: the four lists are empty and the AUI screens paint it without a single write', async () => {
  const p = profile();
  await settle();
  await vm.runInContext('paintRemember()', p.popup);
  assert.ok(emptyLists(p.st.data));
  assert.equal(p.st.writes.n, 0);
  assert.equal(p.doc.getElementById('remembered-list').children.length, 0);
  assert.equal(p.doc.getElementById('auto-rows').hidden, true);
  assert.equal(vm.runInContext('autopilotBanner', p.banner)({ now: Date.now() }, null), null);
});

await test('setting an Autopilot setting leaves the four lists empty (indicator off and on, a pause, a resume)', async () => {
  const p = profile();
  await settle();
  const box = p.doc.getElementById('auto-indicator');
  box.checked = false;
  await box.fire('change');
  assert.equal(p.st.data.pageIndicator, false);
  box.checked = true;
  await box.fire('change');
  const b = vm.runInContext('autopilotBanner', p.banner)({ now: Date.now() }, { id: 's1', autoStarted: true }, translator(table('en')));
  await b.action();
  assert.ok(p.st.data.autoPauseUntil > Date.now());
  const r = vm.runInContext('autopilotBanner', p.banner)({ now: Date.now(), pauseUntil: p.st.data.autoPauseUntil }, null, translator(table('en')));
  await r.action();
  await settle();
  assert.ok(emptyLists(p.st.data), JSON.stringify(plain(p.st.data)));
});

await test('zero outbound requests while the screens load, paint and are pressed; the only message is the local stop of a pause', async () => {
  const p = profile();
  await settle();
  await vm.runInContext('paintRemember()', p.popup);
  const wake = p.doc.getElementById('remember-site');
  wake.checked = true;
  await wake.fire('change');
  for (const id of ['auto-start-site', 'auto-shot-site']) { const tick = p.doc.getElementById(id); tick.checked = true; await tick.fire('change'); }
  await settle();
  for (const li of p.doc.getElementById('remembered-list').children) for (const label of li.children[1].children) { label.children[0].checked = false; await label.children[0].fire('change'); }
  await p.doc.getElementById('forget-sites').fire('click');
  await vm.runInContext('openPractice()', p.popup);
  await (vm.runInContext('autopilotBanner', p.banner)({ now: Date.now() }, { id: 's1', autoStarted: true }, translator(table('en')))).action();
  await settle();
  assert.equal(total(p.net), 0, JSON.stringify(p.net));
  assert.deepEqual(plain(p.sent), [{ type: 'UQA_STOP' }]);
});

/**
 * Rule 12 written exception (Nader, 2026-10-20): the update check, ON by default, switch in Settings (key checkUpdates).
 * Exactly one allowed network call outside the user's press, and the reason: GitHub releases/latest GET, no user data, user-switchable.
 * It lives in core/update-check.js (offscreen door), is pinned by tools/test-update-check.mjs, and appears in no AUI file below.
 */
export const RULE12_EXCEPTIONS = [{ file: 'core/update-check.js', reason: 'Nader 2026-10-22: update check to GitHub Releases, always on; only api.github.com/repos/NJ-Burrito/QA-Wrap; no user data sent' }];

const AUI_FILES = ['popup/onboard.js', 'popup/autopilot-banner.js', 'options/remembered.js'];

await test('source scan: the files of this lane make no network call and name no remote address', () => {
  for (const f of AUI_FILES) {
    const code = read(...f.split('/')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b/.test(code), `${f}: network API`);
    assert.ok(!/https?:\/\/[a-z]/i.test(code), `${f}: a remote address`);
    assert.ok(!/\bimport\s*\(/.test(code), `${f}: dynamic import`);
  }
});

/**
 * The exact browser-dialog calls that may exist (an irreversible delete or erase), as `file :: call`. A new confirm( anywhere,
 * even in a file that already has one, is not on this list; a removed one must come off it. Anything else uses an in-page row.
 *
 * Bug Hunt (extension/game, not shipped, outside this scan): its one confirm( is Reset progress, reason "clears best times and stickers"
 * (irreversible, local only); test-game-guardrails pins that it is the only one.
 */
const CONFIRM_ALLOW = [
  "options/options.js :: confirm(erasedText(t, 'reset'))",
  "options/vault-ui.js :: confirm(t('options.vault.forgetConfirm'))",
  "options/vault-ui.js :: confirm(t('options.vault.removeConfirm'))",
  "popup/popup.js :: confirm(t('popup.reload.confirmRecording'))",
  "report/istqb.js :: confirm(ask)",
  "report/istqb.js :: confirm(t('report.istqb.chatConfirm'))",
  "report/report.js :: confirm(t('report.media.deleteConfirm', { label: iso(item.label) }))",
  "report/report.js :: confirm(t('report.mm.confirm', { where }))",
  "report/report.js :: confirm(t('report.mm.forgetConfirm'))",
  "report/report.js :: confirm(t('report.trackers.confirm', { name: tr.label }))",
  "report/report.js :: window.confirm(t('report.session.deleteConfirm', { name, count: events.length }))",
];
/** Every `confirm(...)` call in code (comments stripped), the whole call to its closing paren. */
function confirmCalls(code) {
  const out = [];
  const re = /(?<![\w$.])(?:window\.)?confirm\(/g;
  for (let m; (m = re.exec(code));) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < code.length; i++) { if (code[i] === '(') depth++; else if (code[i] === ')' && --depth === 0) break; }
    out.push(code.slice(m.index, i + 1).replace(/\s+/g, ' '));
  }
  return out;
}

await test('source scan: every confirm( call in popup/, report/, options/ is on the exact allow-list (by call, not by file)', () => {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(EXT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs|html)$/.test(e.name)) {
        const code = read(...rel.split('/')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        for (const call of confirmCalls(code)) found.push(`${rel} :: ${call}`);
      }
    }
  };
  for (const dir of ['popup', 'report', 'options']) walk(dir);
  assert.deepEqual(found.filter((c) => !CONFIRM_ALLOW.includes(c)), [], 'a confirm( call that is not on the list');
  assert.deepEqual(CONFIRM_ALLOW.filter((c) => !found.includes(c)), [], 'a listed call that no longer exists: take it off the list');
  for (const f of AUI_FILES) assert.ok(!found.some((c) => c.startsWith(`${f} ::`)), `${f} must not use confirm(`);
});

await test('the confirm( scan can fail: a second call in an allowed file, and a call in an AUI file, are both seen', () => {
  const planted = confirmCalls("if (x) confirm(t('a.b')); const ok = window.confirm('x (y)');");
  assert.deepEqual(planted, ["confirm(t('a.b'))", "window.confirm('x (y)')"]);
  assert.ok(!CONFIRM_ALLOW.includes("report/report.js :: confirm(t('a.b'))"));
});

console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n} passed`);
process.exit(failed ? 1 : 0);
