/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/**
 * ui-1019 Jira helper.
 *   1. the pure part: settings, the JQL a poll sends, which results become notifications, and that a repeat is not announced twice
 *   2. the poll end to end against a fake Jira (cookies on, one host, off until enabled)
 *   3. the real content scripts in a real page: a long list scrolls itself and not the page; the RTL || LTR button flips and remembers
 *   4. wiring: the worker holds only the small hook and the notifier is loaded behind the offscreen door
 *   node tools/test-jira-helper.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQueries, normalise, pickNotes, cleanHost, searchPath, withSeen, DEFAULTS } from '../core/jira-helper-core.js';
import { poll, check } from '../core/jira-notifier.js';
import { jiraPage } from '../background/site-access.js';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
console.log('jira helper');

await test('notifications are off by default and the other two helpers are on', () => {
  const s = normalise(undefined);
  assert.equal(s.notify, false);
  assert.equal(s.dropdown, true);
  assert.equal(s.rtl, true);
  assert.equal(DEFAULTS.notify, false);
  assert.deepEqual(Object.values(s.on), [false, false, false, false, false]);
});

await test('settings text is cleaned: host, project keys, labels', () => {
  assert.equal(cleanHost(' HTTPS://Acme.Atlassian.NET/jira/x '), 'acme.atlassian.net');
  assert.equal(cleanHost('not a host'), '');
  assert.equal(cleanHost('x"; drop'), '');
  const s = normalise({ host: 'jira.corp.example:8443', projects: 'abc, x-y ; QA_1', labels: 'ui, "bad", ok' });
  assert.equal(s.host, 'jira.corp.example:8443');
  assert.deepEqual(s.projects, ['ABC', 'QA_1']);
  assert.deepEqual(s.labels, ['ui', 'ok']);
});

await test('JQL: projects, assigned, watched and labels OR together inside the project filter', () => {
  const [q] = buildQueries({ projects: 'ABC,XYZ', on: { assigned: true, watched: true, labels: true }, labels: 'ui,perf' });
  assert.equal(q.mentions, false);
  assert.equal(q.jql, 'updated >= -2m AND project in ("ABC", "XYZ") AND (assignee = currentUser() OR watcher = currentUser() OR labels in ("ui", "perf")) ORDER BY updated DESC');
});

await test('JQL: related issues become linkedIssues clauses, mentions get a second unfiltered query, nothing ticked means all changes', () => {
  const qs = buildQueries({ on: { related: true, mentions: true } }, { relatedKeys: ['AB-1', 'AB-2'] });
  assert.equal(qs.length, 2);
  assert.match(qs[0].jql, /\(issue in linkedIssues\("AB-1"\) OR issue in linkedIssues\("AB-2"\)\)/);
  assert.equal(qs[1].mentions, true);
  assert.equal(qs[1].jql, 'updated >= -2m ORDER BY updated DESC');
  assert.equal(buildQueries({}).length, 1);
  assert.equal(buildQueries({}) [0].jql, 'updated >= -2m ORDER BY updated DESC');
  assert.equal(buildQueries({ on: { labels: true } }).length, 0, 'labels ticked with no labels typed: nothing to ask');
});

await test('JQL cannot be broken out of by a quote in a label', () => {
  const s = normalise({ labels: 'a"b', on: { labels: true } });
  assert.deepEqual(s.labels, []);
});

const NOW = Date.parse('2026-10-19T10:00:00Z');
const iso = (secAgo) => new Date(NOW - secAgo * 1000).toISOString();
const issue = (key, f) => ({ key, fields: { summary: `s ${key}`, updated: iso(10), created: iso(99999), comment: { comments: [] }, ...f } });

await test('kinds: new issue, comment from someone else, mention, plain update', () => {
  const issues = [
    issue('A-1', { created: iso(20) }),
    issue('A-2', { comment: { comments: [{ created: iso(30), author: { accountId: 'other' }, body: 'hi' }] } }),
    issue('A-3', { comment: { comments: [{ created: iso(30), author: { accountId: 'other' }, body: { content: [{ type: 'mention', attrs: { id: 'me-1' } }] } }] } }),
    issue('A-4', {}),
  ];
  const { notes } = pickNotes(issues, { me: 'me-1', now: NOW, host: 'acme.atlassian.net' });
  assert.deepEqual(notes.map((n) => [n.key, n.kind]), [['A-1', 'new'], ['A-2', 'comment'], ['A-3', 'mention'], ['A-4', 'update']]);
  assert.equal(notes[0].url, 'https://acme.atlassian.net/browse/A-1');
});

await test('the mentions query keeps only comments that mention the user', () => {
  const issues = [issue('B-1', {}), issue('B-2', { comment: { comments: [{ created: iso(5), author: { accountId: 'o' }, body: 'cc me-1' }] } })];
  const { notes } = pickNotes(issues, { me: 'me-1', mentions: true, now: NOW, host: 'h.atlassian.net' });
  assert.deepEqual(notes.map((n) => n.key), ['B-2']);
});

await test('dedupe: the same issue at the same update is announced once, a newer update again', () => {
  const a = pickNotes([issue('C-1', {})], { now: NOW, host: 'h.atlassian.net' });
  assert.equal(a.notes.length, 1);
  const b = pickNotes([issue('C-1', {})], { now: NOW + 60000, seen: a.seen, host: 'h.atlassian.net' });
  assert.equal(b.notes.length, 0);
  const c = pickNotes([issue('C-1', { updated: iso(-30) })], { now: NOW + 60000, seen: b.seen, host: 'h.atlassian.net' });
  assert.equal(c.notes.length, 1);
});

/** A fake Jira: records every request, answers myself and search. */
function fakeJira(issues) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const u = new URL(url);
    const body = u.pathname.endsWith('/myself') ? { accountId: 'me-1' } : { issues };
    return { ok: true, status: 200, json: async () => body };
  };
  return { calls, fetchImpl };
}
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

await test('poll: nothing is sent while notifications are off', async () => {
  const j = fakeJira([]);
  assert.deepEqual(await poll({ notify: false, host: 'a.atlassian.net' }, { fetchImpl: j.fetchImpl, store: memStore() }), []);
  assert.deepEqual(await poll({ notify: true, host: '' }, { fetchImpl: j.fetchImpl, store: memStore() }), []);
  assert.equal(j.calls.length, 0);
});

await test('poll: uses the signed-in session of one host only, sends the JQL, and does not repeat itself', async () => {
  const j = fakeJira([issue('D-1', {})]);
  const store = memStore();
  const cfg = { notify: true, host: 'acme.atlassian.net', projects: 'D', on: { assigned: true } };
  const first = await poll(cfg, { fetchImpl: j.fetchImpl, store, now: NOW });
  assert.equal(first.length, 1);
  assert.ok(j.calls.every((c) => c.init.credentials === 'include'), 'cookies ride along');
  assert.ok(j.calls.every((c) => new URL(c.url).host === 'acme.atlassian.net'), 'only the typed host');
  assert.ok(j.calls.every((c) => !/authorization/i.test(JSON.stringify(c.init.headers || {}))), 'no stored password');
  const search = j.calls.find((c) => c.url.includes('/search/jql'));
  assert.ok(search.url.includes(encodeURIComponent('project in ("D")')));
  assert.ok(search.url.includes(encodeURIComponent('assignee = currentUser()')));
  const second = await poll(cfg, { fetchImpl: j.fetchImpl, store, now: NOW + 60000 });
  assert.equal(second.length, 0, 'seen events are not announced again');
});

await test('poll: a server host uses /rest/api/2/search', () => {
  assert.match(searchPath('jira.corp.example', 'x'), /^\/rest\/api\/2\/search\?/);
  assert.match(searchPath('a.atlassian.net', 'x'), /^\/rest\/api\/3\/search\/jql\?/);
});

await test('poll: a refusal throws (the worker swallows it) rather than inventing news', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(poll({ notify: true, host: 'a.atlassian.net' }, { fetchImpl, store: memStore() }), /401/);
});

await test('wiring: worker hook is tiny, the notifier is not in the boot graph, offscreen loads it on demand, click opens the issue', () => {
  const sw = read('background/service-worker.js');
  assert.match(sw, /alarm\.name === 'qaw-jira'/);
  assert.match(sw, /jiraOp\('poll'/);
  assert.match(sw, /notifications\?\.onClicked/);
  assert.ok(!/from '[^']*jira-(helper-core|notifier)/.test(sw), 'no static import of the Jira poll');
  assert.match(read('offscreen/offscreen.js'), /import\('\.\.\/core\/jira-notifier\.js'\)/);
  const mf = JSON.parse(read('manifest.json'));
  assert.equal(mf.content_scripts, undefined, 'nothing declared in the manifest (tools/test-permissions.mjs): the worker registers the scripts');
  const sa = read('background/site-access.js');
  assert.match(sa, /export async function syncJiraScripts/);
  assert.match(sa, /'https:\/\/\*\/\*', 'http:\/\/\*\/\*'/, 'every web page, the scripts decide whether it is Jira');
  assert.ok(!/taq\u006eeen/i.test(sa + read('jira/helper.js') + read('jira/scrollfix.js') + read('core/jira-helper-core.js') + read('options/jira-helper.js')), 'no company hardcoded');
  assert.match(sa, /jira\/helper\.js/);
  assert.match(sa, /jira\/scrollfix\.js[^}]*world: 'MAIN'/);
  assert.doesNotMatch(read('options/jira-helper.js'), /registerContentScripts/, 'Settings no longer registers: nothing to press');
  for (const p of ['notifications', 'alarms', 'storage']) assert.ok(mf.permissions.includes(p));
});

await test('options: the Jira section has the three switches, project filter and every notify-on toggle', () => {
  const frag = read('options/jira-helper.html-fragment');
  for (const id of ['jh-dropdown', 'jh-rtl', 'jh-notify', 'jh-projects', 'jh-on-assigned', 'jh-on-watched', 'jh-on-mentions', 'jh-on-labels', 'jh-labels', 'jh-on-related', 'jh-host']) {
    assert.ok(frag.includes(`id="${id}"`), id);
  }
  assert.match(read('options/options.html'), /jira-helper\.js/);
});

await test('API pick: detected generation wins, last-opened Jira is the default host, a 404 tries the other API', async () => {
  assert.match(searchPath('jira.corp.example', 'x', undefined, undefined, 3), /^\/rest\/api\/3\/search\/jql/);
  assert.match(searchPath('shop.example.org', 'x', undefined, undefined, 2), /^\/rest\/api\/2\/search\?/);
  const w = withSeen({ notify: true, host: '' }, { last: 'jira.acme-bank.test', hosts: { 'jira.acme-bank.test': 2, 'x.example.com': 3 } });
  assert.deepEqual([w.host, w.api], ['jira.acme-bank.test', 2]);
  assert.equal(withSeen({ host: 'x.example.com' }, { last: 'jira.acme-bank.test', hosts: { 'x.example.com': 3 } }).api, 3, 'a picked host beats the last opened one');
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url).pathname);
    if (/api\/3/.test(url)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => (url.includes('myself') ? { name: 'me' } : { issues: [issue('E-1', {})] }) };
  };
  const notes = await poll({ notify: true, host: '', seen: { last: 'jira.acme-bank.test', hosts: { 'jira.acme-bank.test': 3 } } }, { fetchImpl, store: memStore(), now: NOW });
  assert.equal(notes.length, 1);
  assert.ok(urls.includes('/rest/api/2/search') && urls.includes('/rest/api/2/myself'), 'fell back to v2');
  const j = fakeJira([]);
  await poll({ notify: true, host: '', seen: { last: 'jira.acme-bank.test', hosts: { 'jira.acme-bank.test': 2 } } }, { fetchImpl: j.fetchImpl, store: memStore() });
  assert.ok(j.calls.length && j.calls.every((c) => new URL(c.url).host === 'jira.acme-bank.test' && !c.url.includes('/api/3/')), 'server API on the last-opened host');
  assert.equal(await check('jira.acme-bank.test', async (u) => ({ status: /api\/3/.test(u) ? 404 : 200 }), 3), 200, 'Check connection falls back to /api/2/myself');
});

/* ── 3. the real content scripts in a real page ── */
const SCROLLFIX = read('jira/scrollfix.js');
const HELPER = read('jira/helper.js');
const CSS = read('jira/helper.css');
const HOST = 'https://acme.atlassian.net/';
const PAGE = `<!doctype html><body style="margin:0"><div style="height:1500px">top</div>
<div id="pop" role="dialog" style="height:300px"><ul id="list" role="listbox" style="margin:0;padding:0;list-style:none">${Array.from({ length: 80 }, (_, i) => `<li role="option" id="o${i}" tabindex="-1" style="height:30px">option ${i}</li>`).join('')}</ul></div>
<div style="height:1500px">bottom</div><p id="mixed">مرحبا Hello</p></body>`;

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
try {
  const SERVER = () => `<!doctype html><html><head><meta name="application-name" content="JIRA" data-name="jira" data-version="9.4.5"></head><body id="jira" class="aui-layout" style="margin:0"><div style="height:1500px">top</div>
<div class="ajs-layer active" style="height:300px"><div class="aui-list-scroll"><ul class="aui-list" id="list">${Array.from({ length: 80 }, (_, i) => `<li class="aui-list-item"><a class="aui-list-item-link" id="o${i}" href="#" style="display:block;height:30px">status ${i}</a></li>`).join('')}</ul></div></div>
<div style="height:1500px">bottom</div><p id="mixed">مرحبا Hello</p></body></html>`;
  // What Chrome really gives this content script: the worker closes storage.local to content scripts (setAccessLevel
  // TRUSTED_CONTEXTS, service-worker.js), so local get/set reject (jira-switch-5); storage.sync stays open. The worker's answer to
  // UQA_GET_SETTINGS {jira} is the REAL relay (jiraPage from background/site-access.js) run over window.__store as storage.local.
  const RELAY = jiraPage.toString();
  const open = async (store = {}, { host = HOST, html = PAGE, sync = {} } = {}) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    page.errors = [];
    page.on('pageerror', (e) => { page.errors.push(e.message); console.log('       page error:', e.message); });
    await page.route(`${host}**`, (r) => r.fulfill({ contentType: 'text/html', body: html }));
    await page.addInitScript(([initial, synced, relay]) => {
      window.__store = initial; window.__sync = synced;
      const area = (o) => ({ get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in o).map((x) => [x, o[x]])), set: async (v) => { Object.assign(o, JSON.parse(JSON.stringify(v))); }, remove: async (k) => { for (const x of [].concat(k)) delete o[x]; } });
      const closed = { get: async () => { throw new Error('Access to storage is not allowed from this context.'); }, set: async () => { throw new Error('Access to storage is not allowed from this context.'); } };
      const jiraPage = (0, eval)(`(${relay})`);
      const worker = async (m) => (m?.type === 'UQA_GET_SETTINGS' && m.jira ? { ok: true, result: await jiraPage(m.jira, { url: location.href }, area(window.__store)) } : { ok: false });
      window.chrome = { storage: { local: closed, sync: area(window.__sync), onChanged: { addListener() {} } }, runtime: { lastError: undefined, sendMessage: (m, cb) => { worker(m).then((r) => setTimeout(() => cb?.(r), 0)); } } };
    }, [store, sync, RELAY]);
    await page.goto(host);
    await page.addStyleTag({ content: CSS });
    await page.addScriptTag({ content: SCROLLFIX });
    await page.addScriptTag({ content: HELPER });
    if (host !== 'https://plain.example.net/') await page.waitForFunction(() => document.documentElement.dataset.qawJiraFix === '1' || !!document.getElementById('qaw-jira-dir') || window.__store.qawJira?.dropdown === false);
    else await page.waitForTimeout(300);
    return page;
  };

  await test('long list: opening it and moving to a far option scrolls the list, not the page', async () => {
    const page = await open({});
    await page.evaluate(() => { window.scrollTo(0, 1400); });
    const y0 = await page.evaluate(() => window.scrollY);
    const r = await page.evaluate(() => {
      const li = document.getElementById('o70');
      li.focus();
      li.scrollIntoView({ block: 'center' });
      const list = document.getElementById('list');
      return { y: window.scrollY, listTop: list.scrollTop, h: list.getBoundingClientRect().height, ovs: getComputedStyle(list).overscrollBehaviorY };
    });
    assert.equal(r.y, y0, 'the page did not move');
    assert.ok(r.listTop > 0, 'the list moved itself');
    assert.ok(r.h <= 600 * 0.6 + 1, 'the list is capped at 60% of the viewport');
    assert.equal(r.ovs, 'contain');
    await page.close();
  });

  await test('control: with the fix switched off the same call does move the page', async () => {
    const page = await open({ qawJira: { dropdown: false } });
    await page.evaluate(() => { window.scrollTo(0, 1400); });
    const y0 = await page.evaluate(() => window.scrollY);
    const y1 = await page.evaluate(() => { document.getElementById('o70').scrollIntoView({ block: 'center' }); return window.scrollY; });
    assert.notEqual(y1, y0, 'untouched page behaviour returns when the switch is off');
    await page.close();
  });

  const TEXTPAGE = (html) => html.replace('<p id="mixed">', '<h1 id="summary-val">ملخص summary</h1><div id="description-val" class="user-content-block">وصف</div><div class="activity-comment"><div class="action-body" id="c1">تعليق</div></div><p id="mixed">');

  await test('RTL || LTR switch: sets dir only on the text blocks, never on html/body; slides; remembered per host', async () => {
    const page = await open({}, { host: 'https://jira.acme-bank.test/', html: TEXTPAGE(SERVER()) });
    const btn = page.locator('#qaw-jira-dir');
    assert.equal(await btn.getAttribute('role'), 'switch');
    assert.equal(await btn.getAttribute('aria-pressed'), 'false');
    assert.equal(await btn.locator('.qaw-lbl').allInnerTexts().then((a) => a.join(',')), '← RTL,LTR →');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[dir]').length), 0, 'nothing touched before the first press');
    const tilt0 = await page.evaluate(() => getComputedStyle(document.querySelector('.qaw-beam')).rotate);
    await btn.click();
    const r = await page.evaluate(() => ({
      html: document.documentElement.dir, body: document.body.dir, sum: document.getElementById('summary-val').dir, desc: document.getElementById('description-val').dir,
      com: document.getElementById('c1').dir, other: document.getElementById('mixed').hasAttribute('dir'), bidi: getComputedStyle(document.getElementById('summary-val')).unicodeBidi,
      side: document.getElementById('qaw-jira-dir').dataset.side,
    }));
    assert.deepEqual([r.html, r.body, r.other], ['', '', false], 'page layout is not flipped');
    assert.deepEqual([r.sum, r.desc, r.com, r.bidi, r.side], ['rtl', 'rtl', 'rtl', 'plaintext', 'rtl']);
    await page.waitForTimeout(1900);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.qaw-beam')).rotate), tilt0, 'the beam tipped to the other side');
    // content Jira loads later gets the direction too
    await page.evaluate(() => { const d = document.createElement('div'); d.className = 'user-content-block'; d.id = 'late'; document.body.append(d); });
    await page.waitForFunction(() => document.getElementById('late').dir === 'rtl');
    const saved = await page.evaluate(() => window.__store.qawJiraDir);
    assert.deepEqual(saved, { 'jira.acme-bank.test': 'rtl' });
    await page.close();
    const again = await open({ qawJiraDir: saved }, { host: 'https://jira.acme-bank.test/', html: TEXTPAGE(SERVER()) });
    assert.equal(await again.evaluate(() => document.getElementById('summary-val').dir), 'rtl', 'a fresh page opens in the remembered direction');
    await again.click('#qaw-jira-dir');
    assert.equal(await again.evaluate(() => [document.getElementById('summary-val').dir, document.documentElement.dir].join()), 'ltr,');
    await again.close();
  });

  await test('reduced motion: no transition, flow or tilt animation; the state changes instantly', async () => {
    const page = await open({});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const q = () => page.evaluate(() => { const b = document.getElementById('qaw-jira-dir'); const bm = b.querySelector('.qaw-beam'); return [getComputedStyle(b).transitionDuration, getComputedStyle(bm).transitionDuration, getComputedStyle(b.querySelector('.qaw-w')).transitionDuration, getComputedStyle(b.querySelector('.qaw-flow')).animationName, getComputedStyle(bm).rotate]; });
    const [d1, d2, d3, an, r0] = await q();
    assert.deepEqual([d1, d2, d3, an], ['0s', '0s', '0s', 'none']);
    await page.click('#qaw-jira-dir');
    const [, , , an2, r1] = await q(); // read straight after the press: already final
    assert.equal(an2, 'none');
    assert.ok(Math.abs(parseFloat(r0) + parseFloat(r1)) < 0.01 && parseFloat(r1) < -6, `final tilt at once (${r0} -> ${r1})`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.qaw-r .qaw-w')).translate), '0px', 'RTL container full at once');
    assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.querySelector('.qaw-str')).transitionDuration, Math.round(document.querySelector('.qaw-str-r').getBoundingClientRect().height), document.getAnimations().length]), ['0s', 17, 0], 'strings swap at once, nothing animates');
    await page.hover('#qaw-jira-dir');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('qaw-jira-dir')).opacity), '1', 'hover is instant and opaque');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('qaw-jira-dir')).transform.startsWith('matrix(1, 0, 0, 1')), true, 'no scale under reduced motion');
    await page.close();
  });

  await test('look: tucked and translucent idle, opaque and bigger on hover/focus, water colour per side, never an infinite animation', async () => {
    const page = await open({}, { host: 'https://jira.acme-bank.test/', html: SERVER() });
    const st = () => page.evaluate(() => { const b = document.getElementById('qaw-jira-dir'); const c = getComputedStyle(b); const r = b.getBoundingClientRect();
      return { op: +c.opacity, w: r.width, top: r.top, z: +c.zIndex, fam: c.fontFamily, rg: getComputedStyle(b.querySelector('.qaw-r')).getPropertyValue('--qaw-water').trim(), lg: getComputedStyle(b.querySelector('.qaw-l')).getPropertyValue('--qaw-water').trim() }; });
    const idle = await st();
    assert.ok(idle.op < 1 && idle.top < 0, `idle is translucent and tucked up (${idle.op}, ${idle.top})`);
    assert.match(idle.fam, /Thmanyah/);
    assert.notEqual(idle.rg, idle.lg, 'amber water RTL, green water LTR');
    await page.hover('#qaw-jira-dir');
    await page.waitForTimeout(350);
    const hov = await st();
    assert.equal(hov.op, 1); assert.ok(hov.w > idle.w && hov.top >= 0, `hover is opaque, bigger and dropped in (${hov.w} > ${idle.w}, ${hov.top})`);
    await page.mouse.move(600, 400); await page.waitForTimeout(350);
    await page.keyboard.press('Tab'); await page.focus('#qaw-jira-dir'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    await page.waitForTimeout(350);
    if (await page.evaluate(() => document.activeElement?.id === 'qaw-jira-dir')) assert.equal((await st()).op, 1, 'keyboard focus is opaque');
    await page.click('#qaw-jira-dir');
    await page.waitForTimeout(1900);
    const z = (await st()).z;
    assert.ok(z < 2147483000 && z >= 1000);
    const infinite = await page.evaluate(() => [...document.getElementById('qaw-jira-dir').querySelectorAll('*'), document.getElementById('qaw-jira-dir')].some((e) => getComputedStyle(e).animationIterationCount.includes('infinite')));
    assert.ok(!infinite);
    const css = read('jira/helper.css');
    assert.ok(!/infinite/.test(css) && !/cairo/i.test(css), 'no loop in the sheet, no Cairo');
    await page.close();
  });

  await test('Jira Server: opening a dropdown (focus + scrollIntoView + container scrollTop jump) leaves page and container scroll where they were', async () => {
    const html = SERVER().replace('<body id="jira" class="aui-layout" style="margin:0">', '<body id="jira" class="aui-layout" style="margin:0"><div id="pg" style="position:fixed;top:0;left:0;width:300px;height:200px;overflow:auto"><div style="height:2000px">page container</div></div><button id="trig" class="aui-dropdown2-trigger" style="position:fixed;top:300px;left:400px">Status</button>');
    const page = await open({}, { host: 'https://jira.acme-bank.test/', html });
    await page.evaluate(() => { window.scrollTo(0, 1400); document.getElementById('pg').scrollTop = 500; });
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => [window.scrollY, document.getElementById('pg').scrollTop]);
    await page.click('#trig', { force: true });
    await page.evaluate(() => {
      const li = document.getElementById('o70');
      li.focus(); li.scrollIntoView({ block: 'center' });
      document.getElementById('pg').scrollTop = 0; window.scrollTo(0, 0); // AUI layer / container jump
      document.getElementById('trig').focus();
      document.getElementById('trig').scrollIntoView();
    });
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => [window.scrollY, document.getElementById('pg').scrollTop]), before, 'page and container did not move');
    // a real wheel still scrolls the page
    await page.mouse.move(600, 550);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(250);
    const y2 = await page.evaluate(() => window.scrollY); assert.ok(y2 !== before[0], 'normal user scrolling still works ' + y2 + ' ' + before[0]);
    await page.close();
  });

  for (const host of ['https://jira.acme-bank.test/', 'https://tracker.other-co.example/']) {
    await test(`Jira Server (${host}) with no setup: AUI list scrolls itself, button flips direction, host and API are remembered`, async () => {
      const page = await open({}, { host, html: SERVER() });
      await page.evaluate(() => { window.scrollTo(0, 1400); });
      const y0 = await page.evaluate(() => window.scrollY);
      const r = await page.evaluate(() => {
        const a = document.getElementById('o70');
        a.focus();
        a.scrollIntoView({ block: 'center' });
        const box = document.querySelector('.aui-list-scroll');
        return { y: window.scrollY, top: box.scrollTop, h: box.getBoundingClientRect().height };
      });
      assert.equal(r.y, y0, 'the page did not move');
      assert.ok(r.top > 0, 'the AUI list moved itself');
      assert.ok(r.h <= 600 * 0.6 + 1);
      await page.click('#qaw-jira-dir');
      assert.equal(await page.evaluate(() => document.documentElement.dir), '');
      assert.deepEqual(await page.evaluate(() => window.__store.qawJiraSeen), { last: new URL(host).host, hosts: { [new URL(host).host]: 2 } });
      await page.close();
    });
  }

  await test('Jira Cloud on a custom domain (build number >= 1000) is recorded as API 3', async () => {
    const page = await open({}, { host: 'https://issues.cloudco.example/', html: SERVER().replace('9.4.5', '1001.0.0-SNAPSHOT') });
    assert.equal((await page.evaluate(() => window.__store.qawJiraSeen)).hosts['issues.cloudco.example'], 3);
    await page.close();
  });

  await test('a page that is not Jira: nothing injected, nothing stored, scrollIntoView untouched', async () => {
    const plain = '<!doctype html><html><head><title>shop</title></head><body><ul role="listbox"><li role="option" id="o1">a</li></ul></body></html>';
    const page = await open({}, { host: 'https://plain.example.net/', html: plain });
    const r = await page.evaluate(() => ({
      btn: !!document.getElementById('qaw-jira-dir'), fix: document.documentElement.dataset.qawJiraFix, dir: document.documentElement.dir,
      store: JSON.stringify(window.__store), native: Element.prototype.scrollIntoView.toString().includes('native code'),
    }));
    assert.deepEqual([r.btn, r.fix, r.dir, r.store, r.native], [false, undefined, '', '{}', true]);
    await page.close();
  });

  await test('hangers: two strings from the top edge, no centre pivot; the full side hangs on the longer string and the bar tips to it, mirrored; a switch is one small bounce within 700 ms, the water stays level, the tab box never moves, nothing idles', async () => {
    const page = await open({}, { host: 'https://jira.acme-bank.test/', html: SERVER() });
    assert.ok(!/qaw-swing|data-swing|\.qaw-pill|class="qaw-pill|qaw-wt|qaw-hub/.test(CSS + HELPER), 'no swing, pill, weight or centre hub left in the sheet or the script');
    await page.hover('#qaw-jira-dir'); await page.waitForTimeout(400);
    const info = () => page.evaluate(() => {
      const b = document.getElementById('qaw-jira-dir'); const B = b.getBoundingClientRect(); const cs = (s) => getComputedStyle(b.querySelector(s));
      const f = (s) => { const t = cs(s + ' .qaw-w').translate; return t === 'none' ? 0 : parseFloat(t.split(' ')[1] ?? 0); };
      const str = [...b.querySelectorAll('.qaw-str')].map((e) => { const r = e.getBoundingClientRect(); return { x: (r.left - B.left) / B.width, top: r.top - B.top, h: r.height, bottom: r.bottom }; });
      const bar = b.querySelector('.qaw-bar').getBoundingClientRect();
      return { side: b.dataset.side, tilt: parseFloat(cs('.qaw-beam').rotate), water: parseFloat(cs('.qaw-l .qaw-w').rotate), r: f('.qaw-r'), l: f('.qaw-l'), str, bar: { top: bar.top, bottom: bar.bottom }, hubs: b.querySelectorAll('.qaw-hub').length, anims: document.getAnimations().length };
    });
    const i = await info(); // LTR picked (the default): the right cup is full, its (right) string is the long one, the bar tips clockwise
    assert.equal(i.side, 'ltr');
    assert.ok(i.r > 10 && i.l === 0, 'LTR full, RTL empty ' + JSON.stringify(i));
    assert.equal(i.hubs, 0, 'no centre pivot');
    assert.equal(i.str.length, 2, 'two strings');
    assert.ok(i.str[0].x < 0.1 && i.str[1].x > 0.9 && i.str.every((s) => Math.abs(s.top) < 0.5), 'one at each end, both from the top edge ' + JSON.stringify(i.str));
    assert.ok(i.str[1].h - i.str[0].h > 10, `the full side's string is longer (${i.str[0].h} < ${i.str[1].h})`);
    assert.ok(Math.abs(i.str[0].bottom - i.bar.top) < 2 && Math.abs(i.str[1].bottom - (i.bar.bottom - 2)) < 2.5, 'the strings reach the ends of the bar ' + JSON.stringify([i.str, i.bar]));
    assert.ok(i.tilt > 6 && i.tilt < 8, 'tilt toward the full (right) side ' + i.tilt);
    assert.ok(Math.abs(i.tilt + i.water) < 0.01, 'the water surface stays level (turned back by the tilt)');
    assert.equal(i.anims, 0, 'nothing moves while idle');
    const run = await page.evaluate(() => new Promise((done) => { // LTR -> RTL, sampled every frame in the page
      const b = document.getElementById('qaw-jira-dir'); const box = () => { const r = b.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => +v.toFixed(2)).join(); };
      const box0 = box(); const t0 = performance.now(); b.click();
      const ends = document.getAnimations().map((a) => { const t = a.effect.getComputedTiming(); return t.delay + t.activeDuration; });
      const inf = document.getAnimations().filter((a) => a.effect.getComputedTiming().iterations === Infinity).length;
      const seen = []; const boxes = new Set();
      const tick = () => { const t = performance.now() - t0; seen.push([t, parseFloat(getComputedStyle(b.querySelector('.qaw-beam')).rotate)]); boxes.add(box()); if (t < 900) requestAnimationFrame(tick); else done({ box0, boxes: [...boxes], ends, inf, seen }); };
      requestAnimationFrame(tick);
    }));
    const rtl = await info();
    const tilts = run.seen.map(([, v]) => v);
    assert.ok(rtl.side === 'rtl' && rtl.r === 0 && rtl.l > 10, 'RTL full, LTR empty');
    assert.ok(Math.abs(rtl.tilt + i.tilt) < 0.01 && Math.abs(rtl.str[0].h - i.str[1].h) < 0.01 && Math.abs(rtl.str[1].h - i.str[0].h) < 0.01, `RTL is the exact mirror: tilt ${rtl.tilt} vs ${i.tilt}, strings swap`);
    assert.ok(Math.abs(rtl.tilt + rtl.water) < 0.01, 'level water on the RTL side too');
    assert.ok(Math.max(...run.ends) <= 700, 'the whole switch is within 700 ms: ' + Math.max(...run.ends));
    assert.equal(run.inf, 0, 'nothing animates forever');
    assert.ok(tilts.some((v) => v > -5 && v < 5), 'passes through intermediate values');
    assert.ok(tilts.some((v) => v < rtl.tilt - 0.3) && Math.min(...tilts) > rtl.tilt - 2, 'one small bounce past the end, under 2 degrees: ' + Math.min(...tilts).toFixed(2));
    assert.ok(run.seen.filter(([t]) => t > 700).every(([, v]) => Math.abs(v - rtl.tilt) < 0.01), 'settled by 700 ms');
    assert.deepEqual(run.boxes, [run.box0], 'the tab box never moves or resizes during the tilt and the bounce');
    assert.equal(rtl.anims, 0, 'idle again: nothing animates');
    if (process.env.QAW_SHOTS) { // hovered, viewport only, for the visual check (work/ui-1020/shots/hang-*.png)
      const dir = process.env.QAW_SHOTS;
      await page.screenshot({ path: `${dir}/hang-rtl-full.png` });
      await page.click('#qaw-jira-dir'); await page.waitForTimeout(250); await page.screenshot({ path: `${dir}/hang-mid-switch.png` });
      await page.waitForTimeout(750); await page.screenshot({ path: `${dir}/hang-ltr-full.png` });
    } else { await page.click('#qaw-jira-dir'); await page.waitForTimeout(800); }
    const back = await info();
    assert.ok(back.side === 'ltr' && Math.abs(back.tilt - i.tilt) < 0.01 && Math.abs(back.str[1].h - i.str[1].h) < 0.01, 'mirrored back ' + JSON.stringify(back));
    await page.close();
  });

  await test('position (repro jira-switch-5): with storage.local closed to content scripts as in Chrome, a reload puts the tab exactly where it was dropped (same width, after fonts and 1 s), a resize keeps the edge distance; a swallowed pointerup still saves; nothing logged', async () => {
    const H = 'jira.acme-bank.test';
    const left = (p) => p.evaluate(() => document.getElementById('qaw-jira-dir').getBoundingClientRect().left);
    for (const [x, swallow] of [[150, false], [700, false], [260, true]]) { // left half, right half, and a page that eats pointerup (only lostpointercapture reaches the tab)
      const a = await open({}, { host: `https://${H}/`, html: SERVER() });
      if (swallow) await a.evaluate(() => addEventListener('pointerup', (e) => e.stopImmediatePropagation(), true));
      await a.waitForTimeout(1100);
      const box = await a.locator('#qaw-jira-dir').boundingBox(); const cy = box.y + 8; const cx = box.x + box.width / 2;
      await a.mouse.move(cx, cy); await a.mouse.down(); await a.mouse.move(x, cy, { steps: 6 }); await a.mouse.up();
      await a.mouse.move(400, 400); await a.waitForTimeout(400);
      const dropped = await left(a); const store = await a.evaluate(() => window.__store.qawJiraPos);
      assert.ok(store?.[H], `the drop is saved (${swallow ? 'pointerup swallowed' : 'pointerup'}): ${JSON.stringify(store)}`);
      assert.deepEqual(a.errors, [], 'nothing logged to the page');
      await a.close();
      const b = await open({ qawJiraPos: store }, { host: `https://${H}/`, html: SERVER() });
      if (swallow) { assert.ok(Math.abs(await left(b) - dropped) <= 0.5, 'swallowed pointerup: reload keeps it'); await b.close(); continue; }
      assert.ok(Math.abs(await b.evaluate(() => parseFloat(document.getElementById('qaw-jira-dir').style.left)) - 60 - dropped) <= 0.5, 'reload immediately (style.left)');
      await b.evaluate(() => document.fonts.ready); await b.waitForTimeout(1100);
      assert.ok(Math.abs(await left(b) - dropped) <= 0.5, 'after fonts and 1 s');
      await b.evaluate(() => { document.body.style.height = '5000px'; document.documentElement.style.overflowY = 'scroll'; }); // a scrollbar appears late
      await b.waitForTimeout(100);
      const cw = await b.evaluate(() => document.documentElement.clientWidth);
      const dist = (l) => Math.min(l + 60, cw - l - 60);
      assert.ok(Math.abs(dist(await left(b)) - Math.min(dropped + 60, 900 - dropped - 60)) <= 0.5 || x > 450, 'left-half distance kept with a late scrollbar');
      await b.setViewportSize({ width: 600, height: 600 }); await b.waitForTimeout(100);
      const w2 = await b.evaluate(() => document.documentElement.clientWidth);
      const l2 = await left(b);
      const centre = x < 450 ? dropped + 60 : w2 - (900 - dropped - 60);
      assert.ok(Math.abs(l2 + 60 - Math.max(60, Math.min(centre, w2 - 60))) <= 0.5, `resize keeps the nearest-edge distance (${l2}, w ${w2})`);
      await b.close();
    }
  });

  await test('direction lasts until Chrome closes: same session keeps it, an absent value (restart) resets to LTR; the worker clears it on startup', async () => {
    const H = 'jira.acme-bank.test';
    const a = await open({}, { host: `https://${H}/`, html: SERVER() });
    await a.click('#qaw-jira-dir');
    const saved = await a.evaluate(() => window.__store.qawJiraDir);
    assert.deepEqual(saved, { [H]: 'rtl' });
    await a.close();
    const b = await open({ qawJiraDir: saved }, { host: `https://${H}/`, html: SERVER() }); // a reload, a new tab, the next day: Chrome still open
    assert.equal(await b.evaluate(() => [document.documentElement.dataset.qawJiraDir, document.getElementById('qaw-jira-dir').dataset.side].join()), 'rtl,rtl');
    await b.close();
    const c = await open({}, { host: `https://${H}/`, html: SERVER() }); // after a restart the worker removed the key
    assert.equal(await c.evaluate(() => [document.documentElement.dataset.qawJiraDir ?? 'none', document.getElementById('qaw-jira-dir').dataset.side].join()), 'none,ltr', 'reset: the page text is left alone');
    await c.close();
    assert.match(read('background/service-worker.js'), /onStartup, 'runtime\.onStartup',[\s\S]{0,400}storage\.local\.remove\('qawJiraDir'\)/);
  });

  await test('drag: X only, clamped, remembered as an edge distance, never toggles; a click toggles; Alt+Arrow nudges; resize re-clamps; position survives a restart', async () => {
    const H = 'jira.acme-bank.test';
    const page = await open({}, { host: `https://${H}/`, html: SERVER() });
    const geo = () => page.evaluate(() => { const b = document.getElementById('qaw-jira-dir'); const r = b.getBoundingClientRect(); return { left: parseFloat(b.style.left), top: r.top, side: b.dataset.side, cur: getComputedStyle(b).cursor, drag: b.hasAttribute('data-drag'), pos: window.__store.qawJiraPos?.[location.host] }; });
    await page.waitForTimeout(1000); // let the first settle end
    const box = await page.locator('#qaw-jira-dir').boundingBox();
    const cx = box.x + box.width / 2; const cy = box.y + 8;
    const g0 = await geo();
    assert.equal(g0.left, 450); assert.equal(g0.cur, 'grab');
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 100, cy + 40, { steps: 5 });
    const mid = await geo();
    assert.ok(Math.abs(mid.left - 550) < 2 && Math.abs(mid.top) < 1 && mid.drag && mid.cur === 'grabbing', `moves along X only, no vertical move ${JSON.stringify(mid)}`);
    if (process.env.QAW_SHOT_DRAG) await page.screenshot({ path: process.env.QAW_SHOT_DRAG, clip: { x: 300, y: 0, width: 500, height: 100 } });
    await page.mouse.up();
    let g = await geo();
    assert.equal(g.side, 'ltr', 'a drag never toggles');
    assert.ok(g.pos.l !== undefined && Math.abs(g.pos.l - 550) < 2 || Math.abs(g.pos.r - 350) < 2, 'saved as distance from the nearest edge ' + JSON.stringify(g.pos));
    await page.mouse.move(550, cy); await page.mouse.down(); await page.mouse.move(-500, cy, { steps: 4 }); await page.mouse.up();
    g = await geo();
    assert.equal(g.left, 60, 'clamped at the left edge (half the tab)');
    await page.mouse.move(60, cy); await page.mouse.down(); await page.mouse.move(63, cy, { steps: 1 }); await page.mouse.up();
    assert.equal((await geo()).side, 'rtl', 'under 5 px is a click: toggles');
    await page.focus('#qaw-jira-dir');
    await page.keyboard.press('Alt+ArrowRight');
    g = await geo();
    assert.deepEqual([g.left, g.side], [92, 'rtl'], 'Alt+ArrowRight nudges right, no toggle');
    await page.keyboard.press('Alt+ArrowLeft'); await page.keyboard.press('Alt+ArrowLeft'); await page.keyboard.press('Alt+ArrowLeft');
    assert.equal((await geo()).left, 60, 'nudge is clamped too');
    await page.waitForTimeout(500);
    assert.deepEqual((await geo()).pos, { l: 60 }, 'Alt+Arrow saves too');
    await page.keyboard.press('Enter');
    assert.equal((await geo()).side, 'ltr', 'Enter still toggles');
    await page.evaluate(() => { document.getElementById('qaw-jira-dir').style.left = '0px'; });
    await page.setViewportSize({ width: 300, height: 600 });
    await page.waitForTimeout(50);
    assert.equal((await geo()).left, 60, 're-clamped on resize');
    await page.close();
    const p2 = await open({ qawJiraPos: { [H]: { l: 225 } } }, { host: `https://${H}/`, html: SERVER() }); // direction gone, position kept
    assert.deepEqual(await p2.evaluate(() => [parseFloat(document.getElementById('qaw-jira-dir').style.left), document.getElementById('qaw-jira-dir').dataset.side]), [225, 'ltr']);
    await p2.close();
    // jira-switch-5 left the position in storage.sync (raw host in the Google account): it comes home to local and leaves sync
    const p3 = await open({}, { host: `https://${H}/`, html: SERVER(), sync: { qawJiraPos: { [H]: { l: 300 } } } });
    await p3.waitForTimeout(200);
    assert.deepEqual(await p3.evaluate(() => [parseFloat(document.getElementById('qaw-jira-dir').style.left), window.__store.qawJiraPos, window.__sync]), [300, { [H]: { l: 300 } }, {}], 'the synced position moves to local, sync is emptied');
    await p3.close();
  });

  await test('RTL setting off: no button, the page keeps its own direction', async () => {
    const page = await open({ qawJira: { rtl: false }, qawJiraDir: { 'acme.atlassian.net': 'rtl' } });
    assert.equal(await page.locator('#qaw-jira-dir').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.dir), '');
    await page.close();
  });

  // jira-edit-rtl (a Jira Server issue view): the inline editor of a field, modelled on Jira Server's: clicking #description-val
  // opens form#description-form inside it, either the wiki textarea (Text) or a TinyMCE-like same-origin iframe (Visual, body#tinymce).
  // Like Jira's default blur trigger it saves and closes when focus leaves the form or on a mousedown outside it (jQuery on document).
  const AR = 'وصف Arabic and English نص';
  const EDITPAGE = (rich) => SERVER().replace('<p id="mixed">', `<div id="description-val" class="field-ignore-highlight editable-field inactive" title="Click to edit"><div class="user-content-block"><p>${AR}</p></div></div><script>
window.__saved = []; let ed = null;
const field = document.getElementById('description-val'); const VIEW = field.innerHTML;
const close = (how) => { if (!ed) return; window.__saved.push({ how, v: ed.value() }); field.classList.replace('active', 'inactive'); field.innerHTML = VIEW; ed = null; };
const outside = (el) => !ed || !ed.form.contains(el);
document.addEventListener('mousedown', (e) => { if (ed && outside(e.target)) close('outside mousedown'); });
field.addEventListener('click', () => {
  if (ed) return;
  field.classList.replace('inactive', 'active');
  field.innerHTML = '<form id="description-form" class="aui"><div class="inline-edit-fields"><div class="field-group">' + (${rich} ? '<div class="rte-container"><div class="mce-tinymce"><iframe id="mce_0_ifr" style="width:500px;height:120px"></iframe></div></div><textarea id="description" class="wiki-textfield" style="display:none"></textarea>' : '<textarea id="description" class="textarea long-field wiki-textfield" style="width:500px;height:60px"></textarea>') + '</div></div><div class="save-options"><button class="aui-button submit" id="save">Save</button></div></form>';
  const form = field.querySelector('form');
  form.addEventListener('submit', (e) => { e.preventDefault(); close('save'); });
  form.addEventListener('focusout', () => setTimeout(() => { if (outside(document.activeElement)) close('blur'); }, 0));
  if (${rich}) {
    const f = document.getElementById('mce_0_ifr'); const d = f.contentDocument;
    d.open(); d.write('<!doctype html><html><head></head><body id="tinymce" class="mce-content-body" contenteditable="true"><p>${AR}</p></body></html>'); d.close();
    f.contentWindow.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== f && outside(document.activeElement)) close('blur'); }, 0));
    ed = { form, value: () => d.body.innerHTML }; f.contentWindow.focus(); d.body.focus();
  } else {
    const ta = document.getElementById('description'); ta.value = '${AR}\\n' + 'line\\n'.repeat(40);
    ed = { form, value: () => ta.value }; ta.focus(); ta.setSelectionRange(0, 0);
  }
});
</script><p id="mixed">`);
  const editHost = { host: 'https://jira.acme-bank.test/' };

  await test('editor, Text (repro jira-edit-rtl): RTL chosen first opens the textarea RTL; pressing the switch while editing keeps edit mode, focus, caret and text, flips in place; the saved value is untouched', async () => {
    const page = await open({}, { ...editHost, html: EDITPAGE(false) });
    await page.click('#qaw-jira-dir'); // RTL before editing
    await page.click('#description-val p');
    await page.waitForTimeout(400); // one rescan
    const ta = page.locator('#description');
    assert.deepEqual(await ta.evaluate((t) => [t.dir, getComputedStyle(t).unicodeBidi, document.activeElement === t]), ['rtl', 'plaintext', true], 'the editor opens RTL and focused');
    await page.keyboard.type('X ');
    await ta.evaluate((t) => t.setSelectionRange(2, 6));
    const v0 = await ta.inputValue();
    await page.click('#qaw-jira-dir'); // LTR while editing
    const r = await page.evaluate(() => { const t = document.getElementById('description'); return { open: !!t, saved: window.__saved.length, focus: document.activeElement === t, sel: t && [t.selectionStart, t.selectionEnd], dir: t?.dir }; });
    assert.deepEqual(r, { open: true, saved: 0, focus: true, sel: [2, 6], dir: 'ltr' }, 'still editing, focus, caret and selection kept, flipped in place: ' + JSON.stringify(r));
    await page.click('#qaw-jira-dir'); // RTL again
    assert.equal(await ta.evaluate((t) => t.dir), 'rtl');
    await page.keyboard.type('Y');
    await page.click('#save');
    const saved = await page.evaluate(() => window.__saved);
    assert.deepEqual(saved, [{ how: 'save', v: v0.slice(0, 2) + 'Y' + v0.slice(6) }], 'saved once by Save, with exactly what was typed');
    await page.close();
  });

  await test('editor, Visual (repro jira-edit-rtl): RTL chosen first opens the same-origin iframe editor RTL; pressing the switch keeps edit mode, focus and selection, flips in place; no dir or mark in the saved HTML', async () => {
    const page = await open({}, { ...editHost, html: EDITPAGE(true) });
    await page.click('#qaw-jira-dir');
    await page.click('#description-val p');
    await page.waitForTimeout(400);
    const body = () => page.evaluate(() => { const f = document.getElementById('mce_0_ifr'); const d = f?.contentDocument; return d && { dir: d.body.dir, bidi: getComputedStyle(d.body).unicodeBidi, align: getComputedStyle(d.body).textAlign, focus: document.activeElement === f && d.hasFocus(), sel: d.getSelection().anchorOffset, saved: window.__saved.length }; });
    const b0 = await body();
    assert.deepEqual([b0?.dir, b0?.bidi, b0?.focus], ['rtl', 'plaintext', true], 'the iframe editor opens RTL and focused: ' + JSON.stringify(b0));
    await page.keyboard.type('Z');
    const sel = (await body()).sel;
    await page.click('#qaw-jira-dir');
    const b1 = await body();
    assert.deepEqual(b1 && [b1.dir, b1.focus, b1.sel, b1.saved], ['ltr', true, sel, 0], 'still editing, focus and caret kept, flipped in place: ' + JSON.stringify(b1));
    await page.click('#qaw-jira-dir');
    assert.equal((await body()).dir, 'rtl');
    await page.click('#save');
    const saved = await page.evaluate(() => window.__saved);
    assert.equal(saved.length, 1); assert.equal(saved[0].how, 'save');
    assert.ok(saved[0].v.includes('Z') && !/dir=|qaw/i.test(saved[0].v), 'the saved HTML carries no direction mark: ' + saved[0].v);
    await page.close();
  });

  // jira-edit-rtl-2 (Nader's recording 14:21, Jira Server inline edit of the description): the editor keeps #description-val (the
  // editable-field wrapper) and puts form > .jira-wikifield > .wiki-edit inside it: a flex toolbar (.wiki-edit-toolbar.aui-toolbar2,
  // groups of .aui-buttons), then the Text textarea or the Visual iframe (created late, recreated on every Visual/Text switch), then
  // the Visual | Text tabs and Save. The page sheet sets the textarea's text-align with an id selector ([A]: in the recording the
  // Arabic lines stay left-aligned in both states while the toolbar flips).
  const EDIT2 = (mode) => SERVER().replace('<p id="mixed">', `<style>
.aui-toolbar2-inner{display:flex;gap:6px}.aui-buttons{display:flex;gap:2px}.aui-buttons button{width:40px;height:24px}
#description-form textarea.wiki-textfield{text-align:left}.aui-nav{display:flex;gap:8px;list-style:none;margin:0;padding:0}
</style><div id="description-val" class="field-ignore-highlight editable-field inactive"><div class="user-content-block"><p>${AR}</p></div></div><script>
window.__saved = []; let ed = null; let mode = '${mode}';
const field = document.getElementById('description-val'); const VIEW = field.innerHTML;
const close = (how) => { if (!ed) return; window.__saved.push({ how, v: ed.value() }); field.classList.replace('active', 'inactive'); field.innerHTML = VIEW; ed = null; };
document.addEventListener('mousedown', (e) => { if (ed && !ed.form.contains(e.target)) close('outside mousedown'); });
const B = (t) => '<button type="button" class="aui-button" data-op="' + t + '">' + t + '</button>';
const draw = () => {
  const box = document.getElementById('description-wiki-edit'); const v = ed.value();
  box.querySelector('.rte-container')?.remove(); const ta = document.getElementById('description');
  if (mode === 'source') { ta.style.display = ''; ta.value = v; ed.value = () => ta.value; ta.focus(); return; }
  ta.style.display = 'none'; ta.value = v;
  const c = document.createElement('div'); c.className = 'rte-container'; c.innerHTML = '<div class="mce-tinymce mce-container"><div class="mce-edit-area"></div></div>'; box.append(c);
  setTimeout(() => { // TinyMCE adds its iframe and writes the document later
    const f = document.createElement('iframe'); f.id = 'mce_' + Date.now() + '_ifr'; f.style.cssText = 'width:500px;height:100px'; c.querySelector('.mce-edit-area').append(f);
    const d = f.contentDocument; d.open(); d.write('<!doctype html><html><head></head><body id="tinymce" class="mce-content-body" contenteditable="true"><p>' + v + '</p></body></html>'); d.close();
    ed.value = () => d.body.innerText.trim(); f.contentWindow.focus(); d.body.focus();
  }, 120);
};
field.addEventListener('click', (e) => {
  if (ed) return;
  field.classList.replace('inactive', 'active');
  field.innerHTML = '<form id="description-form" class="aui"><div class="inline-edit-fields"><div class="field-group"><div class="jira-wikifield"><div class="wiki-edit"><div id="description-wiki-edit" class="wiki-edit-content">'
    + '<div class="wiki-edit-toolbar aui-toolbar2" role="toolbar"><div class="aui-toolbar2-inner"><div class="aui-buttons">' + B('Style') + '</div><div class="aui-buttons">' + B('B') + B('I') + B('U') + '</div><div class="aui-buttons">' + B('Link') + B('List') + '</div></div></div>'
    + '<textarea id="description" class="textarea long-field wiki-textfield" style="width:500px;height:80px"></textarea></div></div>'
    + '<ul class="aui-nav"><li><a href="#" data-mode="wysiwyg">Visual</a></li><li><a href="#" data-mode="source">Text</a></li></ul></div></div></div>'
    + '<div class="save-options"><button class="aui-button submit" id="save">Save</button></div></form>';
  const form = field.querySelector('form');
  form.addEventListener('submit', (ev) => { ev.preventDefault(); close('save'); });
  for (const a of form.querySelectorAll('[data-mode]')) a.addEventListener('click', (ev) => { ev.preventDefault(); mode = a.dataset.mode; draw(); });
  ed = { form, value: () => '${AR}' }; draw();
});
</script><p id="mixed">`);
  // what must stay exactly as Jira draws it: computed direction and box of the toolbar, each tool, the tabs and Save
  const chrome = (page) => page.evaluate(() => [...document.querySelectorAll('#description-form [role=toolbar], #description-form button, #description-form .aui-nav a')].map((e) => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 6), getComputedStyle(e).direction, Math.round(r.left), Math.round(r.top)]; }));
  const textArea = (page) => page.evaluate(() => { const t = document.getElementById('description'); const s = getComputedStyle(t); return { dir: s.direction, bidi: s.unicodeBidi, align: s.textAlign, focus: document.activeElement === t, wrapper: document.getElementById('description-val').getAttribute('dir') }; });
  const frameBody = (page) => page.evaluate(() => { const f = document.querySelector('.rte-container iframe'); const d = f?.contentDocument; if (!d?.body) return null; const s = d.defaultView.getComputedStyle(d.body); return { id: f.id, dir: s.direction, bidi: s.unicodeBidi, align: s.textAlign }; });

  await test('editor chrome (repro jira-edit-rtl-2): RTL while editing flips the text area, never the toolbar, tabs or Save (Text, then Visual, then Text)', async () => {
    const page = await open({}, { ...editHost, html: EDIT2('source') });
    await page.click('#description-val p');
    await page.click('[data-mode="wysiwyg"]'); await page.waitForTimeout(600);
    const beforeV = await chrome(page); // the Visual editor is taller than the textarea: its own baseline
    await page.click('[data-mode="source"]'); await page.waitForTimeout(150);
    const before = await chrome(page);
    assert.ok(before.length >= 9 && before.every(([, d]) => d === 'ltr'), 'baseline: the page draws its chrome LTR ' + JSON.stringify(before));
    await page.click('#qaw-jira-dir'); // RTL while editing
    const atOnce = await page.evaluate(() => document.getElementById('description-val').getAttribute('dir'));
    await page.waitForTimeout(400);
    assert.deepEqual(await chrome(page), before, 'toolbar, tools, tabs and Save keep their direction and boxes');
    assert.equal(atOnce, null, 'the wrapper holding the toolbar is never marked, not even for a frame');
    assert.deepEqual(await textArea(page), { dir: 'rtl', bidi: 'plaintext', align: 'right', focus: true, wrapper: null }, 'the textarea reads RTL, over the page sheet');
    await page.click('[data-mode="wysiwyg"]'); await page.waitForTimeout(600); // Visual: the iframe arrives late
    assert.deepEqual((await frameBody(page)) && { ...(await frameBody(page)), id: 0 }, { id: 0, dir: 'rtl', bidi: 'plaintext', align: 'right' }, 'the late Visual iframe body reads RTL');
    assert.deepEqual(await chrome(page), beforeV, 'Visual: the chrome is still as Jira draws it');
    const id1 = (await frameBody(page)).id;
    await page.click('[data-mode="source"]'); await page.waitForTimeout(150); await page.click('[data-mode="wysiwyg"]'); await page.waitForTimeout(600);
    const again = await frameBody(page);
    assert.ok(again && again.id !== id1 && again.dir === 'rtl', 'a recreated Visual iframe is RTL too ' + JSON.stringify(again));
    await page.click('[data-mode="source"]'); await page.waitForTimeout(400);
    assert.deepEqual(await textArea(page), { dir: 'rtl', bidi: 'plaintext', align: 'right', focus: true, wrapper: null }, 'back to Text: still RTL');
    assert.equal(await page.evaluate(() => window.__saved.length), 0, 'still editing');
    await page.close();
  });

  await test('editor chrome (repro jira-edit-rtl-2): RTL chosen first, the editor opens with RTL text and the toolbar exactly as LTR draws it; the view text is still RTL', async () => {
    const page = await open({}, { ...editHost, html: EDIT2('source') });
    await page.click('#description-val p');
    const ltr = await chrome(page);
    await page.click('#save');
    await page.click('#qaw-jira-dir'); await page.waitForTimeout(400); // RTL, editor closed
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#description-val p')).direction), 'rtl', 'view mode: the rendered text is RTL');
    await page.click('#description-val p');
    assert.equal(await page.evaluate(() => document.getElementById('description-val').getAttribute('dir')), null, 'opening the editor unmarks the wrapper at once');
    await page.waitForTimeout(400);
    assert.deepEqual(await chrome(page), ltr, 'toolbar, tabs and Save as LTR draws them');
    assert.deepEqual(await textArea(page), { dir: 'rtl', bidi: 'plaintext', align: 'right', focus: true, wrapper: null });
    await page.click('#save'); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#description-val p')).direction), 'rtl', 'closed again: the rendered text is RTL again');
    await page.close();
  });

  // jira-switch-5 / jira-storage-1020: the stubbed tests above once passed while Chrome refused every storage.local call from this
  // content script. These load the real extension (real registration, real storage access levels, the real worker) on a Jira Server page.
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-jira-real-'));
  const EXT = fileURLToPath(root).replace(/[\\/]$/, '');
  const ctx = await chromium.launchPersistentContext(prof, { channel: 'chromium', headless: true, viewport: { width: 1200, height: 700 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    const H = 'https://jira.acme-bank.test/'; const HOSTNAME = 'jira.acme-bank.test';
    let page; let sw; const errors = [];
    const tab = () => page.evaluate(() => { const b = document.getElementById('qaw-jira-dir'); return b && { left: b.getBoundingClientRect().left, side: b.dataset.side }; });
    const reload = async () => { await page.reload(); await page.waitForTimeout(1200); };
    const local = (k) => sw.evaluate((key) => chrome.storage.local.get(key), k);
    await test('real extension (repro jira-switch-5): the dropped position survives a reload; kept in local, nothing in sync; nothing logged to the page', async () => {
      await ctx.route(`${H}**`, (r) => r.fulfill({ contentType: 'text/html', body: SERVER() }));
      sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
      page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
      await page.waitForTimeout(1500); // the worker registers the page scripts
      await page.goto(H); await page.waitForSelector('#qaw-jira-dir', { timeout: 8000 }); await page.waitForTimeout(600);
      const b = await page.locator('#qaw-jira-dir').boundingBox(); const cy = b.y + 8;
      await page.mouse.move(b.x + b.width / 2, cy); await page.mouse.down(); await page.mouse.move(250, cy, { steps: 8 }); await page.mouse.up(); await page.mouse.move(600, 500); await page.waitForTimeout(500);
      const dropped = (await tab()).left;
      assert.ok(Math.abs(dropped - 190) <= 1, 'dropped where the mouse let go ' + dropped);
      await reload();
      assert.ok(Math.abs((await tab()).left - dropped) <= 0.5, `after a reload it is where it was dropped (${(await tab()).left} vs ${dropped})`);
      assert.deepEqual((await local('qawJiraPos')).qawJiraPos, { [HOSTNAME]: { l: 250 } }, 'kept in storage.local, per host');
      assert.ok(!('qawJiraPos' in (await sw.evaluate(() => chrome.storage.sync.get(null)))), 'no Jira host in storage.sync');
      assert.deepEqual(errors, [], 'nothing logged to the page');
    });
    await test('real extension (repro jira-storage-1020): the direction survives a reload (Chrome still open)', async () => {
      await page.click('#qaw-jira-dir'); await page.waitForTimeout(300);
      assert.equal((await tab()).side, 'rtl');
      await reload();
      assert.equal((await tab()).side, 'rtl', 'still RTL after the reload');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.qawJiraDir), 'rtl');
      assert.deepEqual((await local('qawJiraDir')).qawJiraDir, { [HOSTNAME]: 'rtl' });
    });
    await test('real extension (repro jira-storage-1020): the host and its API generation are recorded for the notifier and the Settings list', async () => {
      assert.deepEqual((await local('qawJiraSeen')).qawJiraSeen, { last: HOSTNAME, hosts: { [HOSTNAME]: 2 } });
    });
    await test('real extension (repro jira-edit-rtl): from the isolated world the Visual editor iframe opens RTL and a press while editing keeps it open and focused', async () => {
      const E = 'https://jira-edit.acme-bank.test/';
      await ctx.route(`${E}**`, (r) => r.fulfill({ contentType: 'text/html', body: EDITPAGE(true) }));
      const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(E); await p.waitForSelector('#qaw-jira-dir', { timeout: 8000 });
      await p.click('#qaw-jira-dir'); await p.click('#description-val p'); await p.waitForTimeout(500);
      const st = () => p.evaluate(() => { const f = document.getElementById('mce_0_ifr'); const d = f?.contentDocument; return d && [d.body.dir, getComputedStyle(d.body).unicodeBidi, document.activeElement === f, window.__saved.length]; });
      assert.deepEqual(await st(), ['rtl', 'plaintext', true, 0]);
      await p.click('#qaw-jira-dir');
      assert.deepEqual(await st(), ['ltr', 'plaintext', true, 0], 'flipped in place, still editing');
      await p.close();
      assert.deepEqual(errors, [], 'nothing logged to the page');
    });
    await test('real extension (repro jira-storage-1020): the Settings switches reach the page: RTL off removes the tab, list fix off removes the fix', async () => {
      assert.equal(await page.evaluate(() => document.documentElement.dataset.qawJiraFix), '1', 'on by default');
      await sw.evaluate(() => chrome.storage.local.set({ qawJira: { rtl: false, dropdown: false } }));
      await reload();
      assert.deepEqual(await page.evaluate(() => [!!document.getElementById('qaw-jira-dir'), document.documentElement.dataset.qawJiraFix ?? 'none', document.documentElement.dataset.qawJiraDir ?? 'none']), [false, 'none', 'none']);
      assert.deepEqual(errors, [], 'nothing logged to the page');
    });
  } finally { await ctx.close(); fs.rmSync(prof, { recursive: true, force: true }); }
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
