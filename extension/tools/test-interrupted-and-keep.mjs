/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * DESIGN-1011 rule 5 (R5, REQ-P2-1..3): interrupted work is shown, not hidden, and a session can be kept.
 *
 *   node tools/test-interrupted-and-keep.mjs
 *
 * Plain Node, no browser. Real code under test (nothing is a stub that passes silently):
 *   - core/sessions.js purgePlan: the 30-day cleanup skips a kept session, and takes a session only after a notice at least
 *     7 days older (a daily sweep over 45 days proves the lead time);
 *   - background/remember.js keepSession / noteInterrupted / warnPurge / rollPart with fake storage;
 *   - popup/interrupted.js: after a crash the first popup open shows ONE card with the saved event count, three plain buttons;
 *   - the wiring in the worker, the page and the registry (source checks).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, finish } from './lib-assert.mjs';
import { purgePlan, NOTICE_MS } from '../core/sessions.js';
import { keepSession, noteInterrupted, warnPurge, rollPart } from '../background/remember.js';
import { workerSrc } from './lib-worker-src.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');
const DAY = 864e5;
const T0 = Date.UTC(2026, 9, 1);

// 1. kept sessions are never purged and never warned about, whatever their age or notice
{
  const old = { id: 'k', endedAt: T0 - 90 * DAY, status: 'stopped', keep: true, purgeNotice: T0 - 40 * DAY };
  const plain = { id: 'p', endedAt: T0 - 90 * DAY, status: 'stopped', purgeNotice: T0 - 40 * DAY };
  const plan = purgePlan([old, plain], { days: 30, now: T0 });
  assert.deepEqual(plan.purge.map((s) => s.id), ['p'], 'the cleanup takes the unkept session and skips the kept one');
  assert.deepEqual(plan.warn, [], 'a kept session is not warned about');
  assert.deepEqual(purgePlan([old], { days: 30, now: T0 }), { purge: [], warn: [] });
  assert.deepEqual(purgePlan([plain], { days: 0, now: T0 }), { purge: [], warn: [] }, 'retention off: nothing is touched');
  assert.deepEqual(purgePlan([{ ...plain, id: 'r', status: 'recording', endedAt: null }, { ...plain, id: 'run' }], { days: 30, now: T0, running: 'run' }).purge, [], 'a running or unfinished session is never purged');
}

// 2. the notice leads the deletion by at least 7 days: simulate one sweep a day for 45 days
{
  const s = { id: 's', endedAt: T0, status: 'stopped' };
  let noticeDay = null;
  let deleteDay = null;
  for (let d = 0; d <= 45 && deleteDay == null; d++) {
    const now = T0 + d * DAY + 3600e3;
    const plan = purgePlan([s], { days: 30, now });
    if (plan.warn.length) { s.purgeNotice = now; noticeDay = d; }
    if (plan.purge.length) deleteDay = d;
  }
  assert.ok(noticeDay != null && deleteDay != null, 'a notice is queued and the session is later purged');
  assert.ok(deleteDay >= 30, 'never before the 30-day window (' + deleteDay + ')');
  assert.ok(deleteDay - noticeDay >= 7, `the notice leads the purge by at least 7 days (notice day ${noticeDay}, purge day ${deleteDay})`);
  assert.ok(noticeDay <= 23, 'the notice is queued by day 23, a week before day 30');
  assert.equal(NOTICE_MS, 7 * DAY);
  // a profile that was off for months: never purged on the first sweep, the notice comes first
  const stale = { id: 'z', endedAt: T0 - 200 * DAY, status: 'stopped' };
  const first = purgePlan([stale], { days: 30, now: T0 });
  assert.deepEqual([first.purge.length, first.warn.length], [0, 1], 'a long-overdue session is warned first, not purged');
  stale.purgeNotice = T0 - 6 * DAY;
  assert.equal(purgePlan([stale], { days: 30, now: T0 }).purge.length, 0, 'six days after the notice: still kept');
  stale.purgeNotice = T0 - 7 * DAY;
  assert.equal(purgePlan([stale], { days: 30, now: T0 }).purge.length, 1, 'seven days after the notice: taken');
}

// 3. the keep writer
{
  const rows = { a: { id: 'a', charter: 'A', purgeNotice: 5 } };
  const deps = { getSession: async (id) => rows[id] || null, putSession: async (s) => { rows[s.id] = s; }, rememberSession: () => {} };
  assert.equal(await keepSession({ sessionId: 'a', keep: true }, deps), true);
  assert.equal(rows.a.keep, true, 'keep is written on the session row');
  assert.equal(rows.a.purgeNotice, undefined, 'turning Keep on or off forgets an old purge notice');
  assert.equal(purgePlan([{ ...rows.a, endedAt: T0 - 400 * DAY, status: 'stopped' }], { days: 30, now: T0 }).purge.length, 0, 'the cleanup skips it');
  await keepSession({ sessionId: 'a', keep: false }, deps);
  assert.equal(rows.a.keep, false);
  assert.equal(await keepSession({ sessionId: 'nope', keep: true }, deps), false);
  assert.equal(await keepSession({ sessionId: 'a', keep: 'yes' }, deps), true);
  assert.equal(rows.a.keep, false, 'only a literal true keeps');
}

// 4. the purge notice: a count, no content
{
  const said = [];
  const rows = [{ id: 'x', charter: 'Secret charter' }, { id: 'y', charter: 'Other' }];
  await warnPurge(rows, { putSession: async () => {}, rememberSession: () => {}, say: async (n) => said.push(n) });
  assert.deepEqual(said, [2], 'one notice with the count only');
  assert.ok(rows.every((r) => r.purgeNotice > 0), 'each session is marked with the notice time');
  await warnPurge([], { putSession: async () => {}, rememberSession: () => {}, say: async (n) => said.push(n) });
  assert.equal(said.length, 1, 'nothing due: no notice');
}

// 5. a crash leaves one record per closed session: id, saved event count, time; never content
const store = {};
globalThis.chrome = { storage: { local: { get: async (k) => (typeof k === 'string' ? (k in store ? { [k]: store[k] } : {}) : {}), set: async (o) => Object.assign(store, structuredClone(o)), remove: async (k) => { delete store[k]; } } } };
{
  await noteInterrupted([{ id: 's1', endedAt: 1700, charter: 'Checkout flow' }, { id: 's2', endedAt: 1800 }], async (id) => (id === 's1' ? 3421 : (() => { throw new Error('db'); })()));
  assert.deepEqual(store.interrupted, [{ id: 's1', n: 3421, at: 1700 }, { id: 's2', n: 0, at: 1800 }]);
  assert.ok(!JSON.stringify(store.interrupted).includes('Checkout'), 'no charter or event text in the stored record');
  for (let i = 0; i < 8; i++) await noteInterrupted([{ id: `n${i}`, endedAt: i }], async () => i);
  assert.equal(store.interrupted.length, 5, 'at most the last five are kept');
  delete store.interrupted;
}

// 6. rolling to part 2 (the cap): same charter, parent link, no click; refused when not live
{
  const rows = { a: { id: 'a', charter: 'Checkout', status: 'recording', tabId: 7, env: 'qa', startUrl: 'https://x.test/' } };
  const started = [];
  const deps = {
    getSession: async (id) => rows[id] || null,
    putSession: async (s) => { rows[s.id] = s; },
    rememberSession: () => {},
    live: async () => ['a'],
    startSession: async (o) => { started.push(o); const s = { id: `p${started.length + 1}`, charter: o.charter, status: 'recording', tabId: o.tabId }; rows[s.id] = s; return s; },
  };
  const next = await rollPart('a', deps);
  assert.equal(started[0].charter, 'Checkout (part 2)');
  assert.deepEqual([started[0].tabId, started[0].env, started[0].startUrl], [7, 'qa', 'https://x.test/'], 'same tab, environment and start page');
  assert.deepEqual([next.part, next.partOf, next.previous], [2, 'a', 'a'], 'the new part links back');
  rows.p2.status = 'recording';
  deps.live = async () => ['p2'];
  const third = await rollPart('p2', deps);
  assert.equal(third.charter, 'Checkout (part 3)', 'the suffix is replaced, not stacked');
  assert.equal(third.partOf, 'a', 'every part points at the first');
  assert.equal(await rollPart('a', { ...deps, live: async () => [] }), null, 'a session that is not live is not rolled');
  rows.a.status = 'stopped';
  assert.equal(await rollPart('a', deps), null, 'a stopped session is not rolled');
}

// 7. the first popup open after a crash shows ONE card with the saved event count (popup/interrupted.js, real file, fake page)
{
  const els = {};
  const el = (id) => (els[id] ??= { id, hidden: true, textContent: '', disabled: false, checked: false, onclick: null, addEventListener() {} });
  const calls = [];
  const sessions = [{ id: 's1', charter: 'Checkout flow', keep: false }, { id: 's2', charter: 'Login', keep: false }];
  const send = async (m) => { calls.push(m); return m.type === 'UQA_LIST_SESSIONS' ? { ok: true, result: sessions } : { ok: true }; };
  const src = read('popup/interrupted.js');
  const run = (stored) => {
    for (const k of Object.keys(store)) delete store[k];
    Object.assign(store, stored);
    for (const k of Object.keys(els)) delete els[k];
    for (const id of ['interrupted-card', 'interrupted-line', 'interrupted-open', 'interrupted-keep', 'interrupted-dismiss']) el(id);
    calls.length = 0;
    // eslint-disable-next-line no-new-func
    return new Function('document', 'chrome', 'send', 't', 'exportableSession', `${src}\nreturn { interruptedModel, paintInterruptedCard };`)(
      { getElementById: (id) => (id in els ? els[id] : null) }, globalThis.chrome, send, (k, v) => `${k}:${JSON.stringify(v || {})}`, () => null);
  };

  let page = run({});
  assert.equal(await page.paintInterruptedCard(), null);
  assert.equal(els['interrupted-card'].hidden, true, 'no crash: no card');

  page = run({ interrupted: [{ id: 's1', n: 3421, at: 1 }] });
  const model = await page.paintInterruptedCard();
  assert.equal(els['interrupted-card'].hidden, false, 'after a crash the card is visible on the first open');
  assert.ok(els['interrupted-line'].textContent.includes('3421') && els['interrupted-line'].textContent.includes('Checkout flow'), 'it shows the saved event count and the charter: ' + els['interrupted-line'].textContent);
  assert.equal(model.id, 's1');
  await els['interrupted-keep'].onclick();
  assert.deepEqual(calls.filter((c) => c.type === 'UQA_KEEP'), [{ type: 'UQA_KEEP', sessionId: 's1', keep: true }], 'Keep writes session.keep through the worker');
  assert.equal(els['interrupted-keep'].disabled, true);
  await els['interrupted-open'].onclick();
  assert.ok(calls.some((c) => c.type === 'UQA_OPEN_REPORT' && c.sessionId === 's1'), 'Open report opens that session');
  assert.equal(store.interrupted, undefined, 'the record is removed once acted on');
  assert.equal(els['interrupted-card'].hidden, true);

  page = run({ interrupted: [{ id: 's1', n: 10, at: 1 }, { id: 's2', n: 5, at: 2 }, { id: 'gone', n: 99, at: 3 }] });
  await page.paintInterruptedCard();
  assert.equal(els['interrupted-card'].hidden, false);
  assert.ok(els['interrupted-line'].textContent.startsWith('popup.interrupted.many') && els['interrupted-line'].textContent.includes('"n":15') && els['interrupted-line'].textContent.includes('"count":2'), 'several crashes are still one card, with the summed count of sessions that still exist');
  await els['interrupted-dismiss'].onclick();
  assert.equal(store.interrupted, undefined, 'Dismiss removes the record');

  page = run({ interrupted: [{ id: 'gone', n: 4, at: 1 }] });
  assert.equal(await page.paintInterruptedCard(), null);
  assert.equal(els['interrupted-card'].hidden, true, 'a deleted session shows no card');
  assert.equal(store.interrupted, undefined, 'and the stale record is dropped');
}

// 8. the page and the wiring
{
  const html = read('popup/popup.html');
  const card = html.slice(html.indexOf('id="interrupted-card"'), html.indexOf('id="disk-warn"'));
  assert.equal((html.match(/id="interrupted-card"/g) || []).length, 1, 'one card');
  assert.equal((card.match(/<button/g) || []).length, 3, 'three buttons: Open report, Keep, Dismiss');
  assert.ok(!/data-primary|btn-primary/.test(card), 'none of them is the primary (rule 1)');
  assert.ok(/<script defer src="interrupted\.js"><\/script>/.test(html), 'the card script is loaded');
  assert.ok(/id="keep-session"/.test(html), 'a Keep switch under More on the finished-session card');
  const sw = workerSrc();
  assert.ok(/UQA_KEEP: \(msg\) => remember\.keepSession\(/.test(sw), 'UQA_KEEP is a worker handler');
  assert.ok(/remember\.noteInterrupted\(closed, countEvents\)/.test(sw), 'reconcileInterrupted records what it closed');
  assert.ok(/purgePlan\(sessions,/.test(sw) && /for \(const session of plan\.purge\)/.test(sw), 'the cleanup deletes only what purgePlan returns');
  assert.ok(!/session\.keep\) continue/.test(sw) || /purgePlan/.test(sw));
  assert.ok(/remember\.warnPurge\(plan\.warn/.test(sw), 'the notice is queued by the same sweep');
  const reg = read('core/store-registry.js');
  assert.ok(/loc\('interrupted'/.test(reg), 'the interrupted key is a registry row');
  assert.ok(/`interrupted`|interrupted/.test(read('PRIVACY.md')) && /Keep\*\*/.test(read('PRIVACY.md')), 'PRIVACY.md says it');
  for (const lang of ['en', 'ar']) {
    const cat = JSON.parse(read(`platform/i18n/${lang}.json`));
    for (const k of ['popup.interrupted.line', 'popup.interrupted.many', 'popup.interrupted.open', 'popup.interrupted.dismiss', 'popup.keep.on', 'popup.keep.kept', 'popup.keep.label', 'common.worker.note.purgeSoon']) assert.ok(cat[k], `${lang} has ${k}`);
  }
}

finish('test-interrupted-and-keep');
