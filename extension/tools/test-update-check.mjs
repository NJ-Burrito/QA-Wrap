/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Update notification, end to end on a local mock of GitHub's releases/latest.  node tools/test-update-check.mjs
 *   core/update-check.js (the request and its answers), ui/update-card.js (the card), and the wiring (worker, switch, source scans).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { badgeFor } from '../background/action-icon.js';
import { parseVersion, isNewer, checkLatest, pickRelease, validRepo } from '../core/update-check.js';
import { EXT, El, read, makeDocument, makeStorage, runClassic, settle, translator } from './test-site-powers.mjs';

// the shared fake DOM lacks three things the card uses
El.prototype.prepend ||= function prepend(node) { node.parent = this; this.children.unshift(node); };
El.prototype.remove ||= function remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); };
El.prototype.setAttribute ||= function setAttribute() {};

const table = (lang) => JSON.parse(read('platform', 'i18n', `${lang}.json`));

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n++; console.log(`  ok  ${name}`); } catch (e) { n++; failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

/** A mock of releases/latest: records every request; `reply` decides the answer. */
function mock(reply) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const r = await reply(url, init, calls.length);
    const headers = new Map(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null }, json: async () => r.body };
  };
  return { fetch, calls };
}
const release = (over = {}) => ({ tag_name: 'v3.6.0', html_url: 'https://github.com/o/r/releases/tag/v3.6.0', body: '## Added\n- A thing', prerelease: false, draft: false, assets: [{ browser_download_url: 'https://github.com/o/r/releases/download/v3.6.0/qa-wrap-chrome.zip' }], ...over });
const ask = (m, extra = {}) => checkLatest({ repo: 'o/r', current: '3.5.3', fetch: m.fetch, now: 1000, ...extra });

await test('semver: 3.5.10 > 3.5.9, equal and older are not newer, pre-releases and junk are ignored', () => {
  assert.ok(isNewer('3.5.10', '3.5.9'));
  assert.ok(isNewer('v4.0.0', '3.99.99'));
  assert.ok(!isNewer('3.5.3', '3.5.3'));
  assert.ok(!isNewer('3.5.2', '3.5.3'));
  assert.ok(!isNewer('3.6.0-beta.1', '3.5.3'));
  assert.ok(!isNewer('latest', '3.5.3'));
  assert.equal(parseVersion('3.6.0-rc1'), null);
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
});

await test('the request is one unauthenticated GET of releases/latest, nothing else', async () => {
  const m = mock(() => ({ status: 200, body: release(), headers: { etag: 'W/"a"' } }));
  const s = await ask(m);
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].url, 'https://api.github.com/repos/o/r/releases/latest');
  const i = m.calls[0].init;
  assert.equal(i.method, 'GET');
  assert.equal(i.credentials, 'omit');
  assert.equal(i.body, undefined);
  assert.deepEqual(Object.keys(i.headers), ['Accept']);
  assert.equal(s.latest.version, '3.6.0');
  assert.equal(s.latest.zip, 'https://github.com/o/r/releases/download/v3.6.0/qa-wrap-chrome.zip');
  assert.equal(s.etag, 'W/"a"');
});

await test('newer -> offered; same or older -> nothing; pre-release and draft -> nothing', async () => {
  assert.ok((await ask(mock(() => ({ status: 200, body: release() })))).latest);
  assert.equal((await ask(mock(() => ({ status: 200, body: release({ tag_name: 'v3.5.3' }) })))).latest, null);
  assert.equal((await ask(mock(() => ({ status: 200, body: release({ tag_name: 'v3.5.2' }) })))).latest, null);
  assert.equal((await ask(mock(() => ({ status: 200, body: release({ prerelease: true }) })))).latest, null);
  assert.equal((await ask(mock(() => ({ status: 200, body: release({ draft: true }) })))).latest, null);
  assert.equal((await ask(mock(() => ({ status: 200, body: release({ tag_name: 'v3.6.0-beta.1' }) })))).latest, null);
});

await test('304 keeps the state and sends If-None-Match', async () => {
  const state = { etag: 'W/"a"', latest: { version: '3.6.0' }, checkedAt: 1 };
  const m = mock(() => ({ status: 304 }));
  const s = await ask(m, { state });
  assert.equal(m.calls[0].init.headers['If-None-Match'], 'W/"a"');
  assert.deepEqual({ ...s, checkedAt: 0 }, { ...state, checkedAt: 0 });
});

await test('403 / 429 rate limit, 500 and a network error are silent; a rate limit backs off, with no request while it lasts', async () => {
  const limited = mock(() => ({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(1 + 7200) } }));
  const s = await ask(limited, { state: { latest: { version: '3.6.0' } } });
  assert.ok(s.backoffUntil > 1000 + 3600 * 1000 - 1);
  assert.equal(s.latest.version, '3.6.0', 'the old answer stays');
  const blocked = mock(() => ({ status: 200, body: release() }));
  assert.equal(await ask(blocked, { state: s }), null);
  assert.equal(blocked.calls.length, 0, 'zero requests while backing off');
  assert.ok((await ask(mock(() => ({ status: 429, headers: { 'retry-after': '10' } })))).backoffUntil >= 1000 + 3600 * 1000);
  assert.equal(await ask(mock(() => ({ status: 500 }))), null);
  assert.equal(await ask({ fetch: async () => { throw new Error('offline'); } }), null);
  assert.equal(await checkLatest({ repo: 'o/r', current: '3.5.3', fetch: async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => { throw new Error('bad json'); } }) }), null);
});

await test('the placeholder repo and a malformed one make no request at all', async () => {
  const m = mock(() => ({ status: 200, body: release() }));
  for (const repo of ['OWNER/REPO', '', 'a b/c', '../x', 'one']) assert.equal(await checkLatest({ repo, current: '3.5.3', fetch: m.fetch }), null, repo);
  assert.equal(m.calls.length, 0);
  assert.ok(!validRepo('OWNER/REPO') && validRepo('nader/qa-wrap'));
  assert.equal(JSON.parse(read('core', 'update-source.json')).repo, 'NJ-Burrito/QA-Wrap', 'the one place the repo is named');
});

await test('private repo: no token -> no Authorization and a 404 stays silent; a token rides as Bearer and never enters the state; a wrong token is silent', async () => {
  const m = mock(() => ({ status: 404, body: {} }));
  assert.equal(await ask(m), null);
  assert.equal(m.calls[0].init.headers.Authorization, undefined);
  const t = mock(() => ({ status: 200, body: release() }));
  const s = await ask(t, { token: 'ghp_secret' });
  assert.equal(t.calls[0].init.headers.Authorization, 'Bearer ghp_secret');
  assert.ok(!JSON.stringify(s).includes('ghp_secret'));
  assert.equal(await ask(mock(() => ({ status: 401, body: {} })), { token: 'bad' }), null);
});

await test('version compare drives the offer: 3.5.4 > 3.5.3, 3.5.3 and 3.4.9 are not offered', async () => {
  for (const [tag, want] of [['v3.5.4', true], ['v3.5.3', false], ['v3.4.9', false]]) assert.equal(!!(await ask(mock(() => ({ status: 200, body: release({ tag_name: tag }) })))).latest, want, tag);
});

await test('the release zip qa-wrap-<version>.zip is chosen over per-browser zips, with its API URL for a private repo', () => {
  const a = (name, u) => ({ name, browser_download_url: `https://github.com/o/r/releases/download/v3.6.0/${name}`, url: u });
  const r = pickRelease(release({ assets: [a('qa-wrap-3.6.0-firefox.zip', ''), a('qa-wrap-3.6.0.zip', 'https://api.github.com/repos/o/r/releases/assets/7')] }), 'o/r');
  assert.ok(r.zip.endsWith('/qa-wrap-3.6.0.zip'));
  assert.equal(r.zipApi, 'https://api.github.com/repos/o/r/releases/assets/7');
  assert.equal(pickRelease(release({ assets: [a('qa-wrap-3.6.0.zip', 'https://evil.example/x')] }), 'o/r').zipApi, '');
});

await test('a release page or zip that is not on github.com is never trusted', () => {
  const r = pickRelease(release({ html_url: 'https://evil.example/x', assets: [{ browser_download_url: 'https://evil.example/a.zip' }] }), 'o/r');
  assert.equal(r.url, 'https://github.com/o/r/releases/latest');
  assert.equal(r.zip, '');
});

/* ---------- the card ---------- */

function page(extraIds = []) {
  const doc = makeDocument(['app-body', ...extraIds]);
  const st = makeStorage();
  const badge = { text: '' };
  const opened = [];
  const reloads = [];
  const downloads = [];
  const grant = { v: false };
  const chrome = {
    permissions: { request: async () => grant.v },
    downloads: { download: async (o) => { downloads.push(o); } },
    storage: { local: st.local, session: st.session, onChanged: st.onChanged },
    runtime: { getURL: (x) => `chrome-extension://abc/${x}`, getManifest: () => ({ version: '3.5.3' }), reload: () => { reloads.push(1); }, requestUpdateCheck: async () => ({ status: 'no_update' }) },
    action: { getBadgeText: async () => badge.text, setBadgeText: async ({ text }) => { badge.text = text; } },
    tabs: { create: (o) => opened.push(o.url) },
  };
  const t = translator(table('en'));
  const ctx = runClassic('ui/update-card.js', { document: doc, chrome, QAWi18n: { t, ready: () => Promise.resolve() }, __QAW_NO_MOUNT: true });
  return { doc, st, badge, opened, reloads, downloads, grant, chrome, ctx };
}
const STATE = { latest: { version: '3.6.0', url: 'https://github.com/o/r/releases/tag/v3.6.0', zip: 'https://github.com/o/r/releases/download/v3.6.0/q.zip', notes: '## Added\n- one\n- two\nplain' } };
const texts = (e, out = []) => { if (e.textContent) out.push(e.textContent); for (const c of e.children || []) texts(c, out); return out; };
const find = (e, pred, out = []) => { if (pred(e)) out.push(e); for (const c of e.children || []) find(c, pred, out); return out; };
const byText = (p, s) => find(p.doc.body, (e) => e.textContent === s)[0];
const cards = (p) => find(p.doc.body, (e) => e.id === 'update-card');
const shown = async (p, state) => { if (state) await p.st.local.set({ qawUpdate: state }); await p.ctx.QAWUpdateCard.mount(); await settle(); };

await test('the strings exist in the shipped tables, EN and AR', () => {
  const keys = fs.readFileSync(path.join(EXT, 'ui', 'update-card.js'), 'utf8').match(/'update\.\w+'/g).map((k) => k.slice(1, -1));
  keys.push('update.setting', 'update.settingHint');
  for (const lang of ['en', 'ar']) { const tb = table(lang); for (const k of new Set(keys)) assert.ok(tb[k], `${lang}: ${k}`); }
});

await test('card: newer shows "Version X is available", What\'s new, Update and Not now; nothing else', async () => {
  const p = page();
  await shown(p, STATE);
  const [c] = cards(p);
  assert.ok(c, 'a card is on the page');
  const all = texts(c).join('|');
  assert.match(all, /Version 3\.6\.0 is available/);
  assert.match(all, /What's new/);
  assert.match(all, /Added/);
  const buttons = find(c, (e) => e.tagName === 'BUTTON');
  assert.deepEqual(buttons.map((b) => b.textContent), ['Update', 'Not now']);
  assert.ok(!buttons.some((b) => /btn-primary/.test(b.className)), 'never a second primary (Autopilot rule 1)');
});

await test('card: same or older version, or no state -> no card', async () => {
  for (const state of [undefined, { latest: { version: '3.5.3', notes: '' } }, { latest: { version: '3.5.2', notes: '' } }, { latest: null }]) {
    const p = page();
    await shown(p, state);
    assert.equal(cards(p).length, 0);
  }
});

await test('"Not now" hides that version only: the next version shows again', async () => {
  const U = page().ctx.QAWUpdateCard;
  assert.equal(U.pending(STATE, '3.6.0', '3.5.3'), null);
  assert.equal(U.pending({ latest: { version: '3.6.1' } }, '3.6.0', '3.5.3').version, '3.6.1');
  const p = page();
  await shown(p, STATE);
  await byText(p, 'Not now').fire('click');
  await settle();
  assert.equal(p.st.data.qawUpdateDismissed, '3.6.0');
  assert.equal(p.st.data.qawUpdate.latest.version, '3.6.0', 'the check result is kept');
  assert.equal(cards(p).length, 0, 'the card is gone');
  await p.st.local.set({ qawUpdate: { latest: { ...STATE.latest, version: '3.6.1' } } });
  await settle();
  assert.equal(cards(p).length, 1, 'the next version shows');
});

await test('"Not now" clears the badge dot; a stale dot for an already-installed version is cleared too', async () => {
  const p = page();
  p.badge.text = 'NEW';
  await shown(p, STATE);
  await byText(p, 'Not now').fire('click');
  await settle();
  assert.equal(p.badge.text, '');
  const q = page();
  q.badge.text = 'NEW';
  await shown(q, { latest: { version: '3.5.3' } });
  assert.equal(q.badge.text, '');
});

await test('Update: unpacked opens the zip and shows 3 steps; store asks the browser, then "Restart to update" reloads only on press', async () => {
  const p = page();
  await shown(p, STATE);
  await byText(p, 'Update').fire('click');
  await settle();
  assert.deepEqual(p.opened, []);
  assert.equal(JSON.stringify(p.downloads.map((d) => [d.url, d.filename, d.headers])), JSON.stringify([[STATE.latest.zip, 'qa-wrap-3.6.0.zip', null]]));
  assert.equal(p.st.data.qawPendingNotes.version, '3.6.0', 'the whats-new page finds the notes');
  const g = page(); // permission granted: the automatic path opens the update page, no download
  g.grant.v = true;
  await shown(g, STATE);
  await byText(g, 'Update').fire('click');
  await settle();
  assert.deepEqual(g.opened, ['chrome-extension://abc/whatsnew/whatsnew.html?update=3.6.0']);
  assert.deepEqual(g.downloads, []);
  const q = page(); // private repo + saved token: the API asset URL with the Bearer header
  await q.st.local.set({ qawUpdateToken: 'ghp_x' });
  await shown(q, { latest: { ...STATE.latest, zipApi: 'https://api.github.com/repos/o/r/releases/assets/7' } });
  await byText(q, 'Update').fire('click');
  await settle();
  assert.equal(q.downloads[0].url, 'https://api.github.com/repos/o/r/releases/assets/7');
  assert.equal(q.downloads[0].headers.map((h) => h.value).join('|'), 'application/octet-stream|Bearer ghp_x');
  const steps = find(p.doc.body, (e) => e.className === 'update-steps')[0];
  assert.equal(steps.hidden, false);
  assert.equal(steps.children.length, 3);

  const s = page();
  s.chrome.runtime.getManifest = () => ({ version: '3.5.3', update_url: 'https://clients2.google.com/service/update2/crx' });
  s.chrome.runtime.requestUpdateCheck = async () => ({ status: 'update_available' });
  await shown(s, STATE);
  const go = byText(s, 'Update');
  await go.fire('click');
  await settle();
  assert.equal(go.textContent, 'Restart to update');
  assert.deepEqual(s.reloads, [], 'no reload yet');
  assert.deepEqual(s.opened, []);
  await go.fire('click');
  assert.deepEqual(s.reloads, [1]);
});

await test("What's new is text: markup in the notes stays text and never reaches innerHTML", async () => {
  const evil = '<img src=x onerror="globalThis.__pwned=1"> <script>globalThis.__pwned=1</script>\n- [click](javascript:alert(1)) **bold**';
  const U = page().ctx.QAWUpdateCard;
  const blocks = U.notesBlocks(evil);
  assert.ok(blocks.some((b) => b.text.includes('<img src=x onerror=')), 'kept as characters');
  assert.equal(blocks.map((b) => b.tag).join(), 'p,li');
  assert.equal(blocks[1].text, 'click bold', 'link target dropped, marks dropped');
  const p = page();
  await shown(p, { latest: { ...STATE.latest, notes: evil } });
  assert.equal(cards(p).length, 1);
  assert.equal(find(p.doc.body, (e) => /^(IMG|SCRIPT)$/.test(e.tagName)).length, 0, 'no element was made from the notes');
  assert.equal(p.ctx.__pwned, undefined);
  const src = read('ui', 'update-card.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\b|new Function/.test(src), 'update-card.js never builds HTML');
  assert.equal(U.notesBlocks('').length, 0);
  assert.ok(U.notesBlocks('x\n'.repeat(500)).length <= 60);
});

await test('the Settings switch: on by default, off writes checkUpdates:false, on again removes the key', async () => {
  const p = page(['check-updates']);
  const box = p.doc.getElementById('check-updates');
  box.checked = false;
  await shown(p);
  assert.equal(box.checked, true);
  box.checked = false;
  await box.fire('change');
  assert.equal(p.st.data.checkUpdates, false);
  box.checked = true;
  await box.fire('change');
  assert.ok(!('checkUpdates' in p.st.data));
});

/* ---------- the wiring ---------- */

await test('worker: switch off -> zero requests and no write; on -> one door call, result stored, badge dot only if undismissed', async () => {
  const src = read('background', 'worker-lifecycle.js');
  const body = /export async function checkUpdates\(\) \{[\s\S]*?\r?\n\}\r?\n/.exec(src)[0];
  const run = async (stored, reply) => {
    const st = makeStorage();
    await st.local.set(stored);
    st.writes.n = 0;
    const doors = [];
    const badge = { text: '' };
    const ctx = vm.createContext({
      chrome: { storage: { local: st.local, session: st.session } },
      paintBadge: async () => { badge.text = badgeFor({ update: !!(await st.session.get('uqa.updateNew'))['uqa.updateNew'] }).text; },
      exportOp: async (op, req) => { doors.push([op, req]); return reply; },
    });
    vm.runInContext(body.replace('export async function', 'globalThis.f = async function'), ctx);
    await ctx.f();
    return { st, doors, badge };
  };
  const off = await run({ checkUpdates: false }, STATE);
  assert.equal(off.doors.length, 0);
  assert.equal(off.st.writes.n, 0);
  const on = await run({}, STATE);
  assert.equal(on.doors.length, 1);
  assert.equal(on.doors[0][0], 'update');
  assert.equal(on.st.data.qawUpdate.latest.version, '3.6.0');
  assert.equal(on.badge.text, 'NEW');
  assert.equal((await run({ qawUpdateDismissed: '3.6.0' }, STATE)).badge.text, '');
  assert.equal((await run({}, STATE)).st.data['uqa.updateNew'] ?? (await (await run({}, STATE)).st.session.get('uqa.updateNew'))['uqa.updateNew'], true);
  assert.equal((await run({}, null)).st.writes.n, 0, 'a silent failure writes nothing');
  assert.ok(src.includes("chrome.alarms?.create?.('qaw-update'"));
  assert.match(read('background', 'service-worker.js'), /alarm\.name === 'qaw-update'.*checkUpdates\(\)/);
  assert.match(read('offscreen', 'offscreen.js'), /op === 'update'\) return \(await import\('\.\.\/core\/update-check\.js'\)\)\.run\(request\)/);
});

await test('badge: NEW only when idle - the recording dot, count, low disk and the done mark outrank it, and it returns when they clear', () => {
  assert.equal(badgeFor({ update: true }).text, 'NEW');
  assert.equal(badgeFor({ update: true, live: true }).text, '●');
  assert.equal(badgeFor({ update: true, live: true, problems: 2, errors: 1 }).text, '2');
  assert.equal(badgeFor({ update: true, disk: true }).text, '!');
  assert.equal(badgeFor({ update: true, mark: '✓' }).text, '✓');
  assert.deepEqual(badgeFor({}), { text: '', color: null });
  assert.match(read('background', 'worker-session.js'), /update: !!got\['uqa\.updateNew'\]/, 'paintBadge passes the flag');
  assert.match(read('ui', 'update-card.js'), /flag\(false\)/, 'a dismissed update drops the flag');
});

await test('store: onUpdateAvailable records the version; the card then offers Restart and reloads only on the press', async () => {
  assert.match(read('background', 'service-worker.js'), /runtime\?\.onUpdateAvailable.*qawUpdateReady: d\.version/);
  const p = page();
  await p.st.local.set({ qawUpdateReady: '3.6.0' });
  await shown(p, STATE);
  const go = find(cards(p)[0], (e) => e.tagName === 'BUTTON')[0];
  assert.equal(go.textContent, 'Restart to update');
  assert.equal(p.reloads.length, 0, 'never automatic');
  await go.fire('click');
  assert.equal(p.reloads.length, 1);
  const q = page(); // staged version only, no check state: still offered
  await q.st.local.set({ qawUpdateReady: '3.6.0' });
  await shown(q);
  assert.equal(cards(q).length, 1);
  const r = page(); // already running that version: nothing
  await r.st.local.set({ qawUpdateReady: '3.5.3' });
  await shown(r);
  assert.equal(cards(r).length, 0);
});

await test('lazy: nothing in the worker boot graph imports the update code', () => {
  for (const f of ['background/service-worker.js', 'background/worker-lifecycle.js']) assert.ok(!/update-check/.test(read(...f.split('/'))), f);
  assert.ok(fs.existsSync(path.join(EXT, 'core', 'update-check.js')));
});

await test('Autopilot rule 12 exception is recorded, and the only network call is the releases/latest GET in core/update-check.js', () => {
  assert.match(read('tools', 'test-autopilot-privacy.mjs'), /Nader 2026-10-22: update check to GitHub Releases, always on; only api\.github\.com\/repos\/NJ-Burrito\/QA-Wrap; no user data sent/);
  const code = (f) => read(...f.split('/')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/\bfetch\b/.test(code('core/update-check.js')));
  for (const f of ['ui/update-card.js', 'background/worker-lifecycle.js']) assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/.test(code(f)), `${f}: no network API of its own`);
  assert.ok((code('core/update-check.js').match(/https?:\/\/[a-z.]+/gi) || []).every((u) => /github\.com$/.test(u)));
  assert.match(read('options', 'options.html'), /id="check-updates"/);
  assert.match(read('popup', 'popup.html'), /update-card\.js/);
});

console.log(failed ? `\n${failed} of ${n} FAILED` : `\n${n} passed`);
process.exit(failed ? 1 : 0);
