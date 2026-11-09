/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R4 KPI aggregation (core/kpi.js) on a fixture.   node tools/test-kpi.mjs
 *
 * R15: the counter is proven first on one known-true sample (one filed bug is counted as one) before any "not counted" claim is
 * believed; a probe that counts nothing would pass every negative below.
 */
import assert from 'node:assert/strict';
import { buildKpi, dayKey, weekKey, sessionMs, siteOf, pageKey, SEVERITIES } from '../core/kpi.js';

const MIN = 6e4;
const T = (iso) => Date.parse(iso);
const note = (ts, tag, text, extra = {}) => ({ kind: 'note', ts, tag, text, ...extra });

/* ── 1. the known-true positive: the counter sees a bug the user filed ─────────────────────── */
{
  const s = { id: 'k', startedAt: T('2026-11-02T10:00:00Z'), endedAt: T('2026-11-02T10:10:00Z'), startUrl: 'https://a.test/' };
  const r = buildKpi([s], { k: [note(T('2026-11-02T10:05:00Z'), 'bug', 'broken', { frameUrl: 'https://a.test/' })] });
  assert.equal(r.all.bugs, 1, 'one filed bug is one bug (the counter looked)');
  assert.equal(r.all.days.find((d) => d.key === '2026-11-02').bugs, 1);
  assert.equal(buildKpi([s], { k: [] }).all.bugs, 0, 'and none filed is none');
}

/* ── 2. the fixture ─────────────────────────────────────────────────────────────────────────── */
const sessions = [
  { id: 's1', startedAt: T('2026-11-02T10:00:00Z'), endedAt: T('2026-11-02T10:30:00Z'), startUrl: 'https://shop.example.com/', status: 'stopped' },
  { id: 's2', startedAt: T('2026-11-04T09:00:00Z'), endedAt: T('2026-11-04T10:00:00Z'), startUrl: 'https://www.shop.example.com/about', status: 'stopped' },
  { id: 's3', startedAt: T('2026-11-04T15:00:00Z'), endedAt: T('2026-11-04T15:15:00Z'), startUrl: 'https://blog.example.org/', status: 'stopped' },
  { id: 's4', startedAt: T('2026-11-09T09:00:00Z'), endedAt: null, startUrl: 'https://shop.example.com/', status: 'recording' },
];
const SHOP = 'https://shop.example.com';
const events = {
  s1: [
    { kind: 'nav', ts: T('2026-11-02T10:00:01Z'), url: `${SHOP}/`, frameUrl: `${SHOP}/` },
    { kind: 'dom', ts: T('2026-11-02T10:01:00Z'), action: 'click', frameUrl: `${SHOP}/` },
    { kind: 'nav', ts: T('2026-11-02T10:02:00Z'), url: `${SHOP}/cart?x=1#top`, frameUrl: `${SHOP}/cart?x=1#top` },
    { kind: 'dom', ts: T('2026-11-02T10:03:00Z'), action: 'click', frameUrl: `${SHOP}/cart` },
    { kind: 'links', ts: T('2026-11-02T10:04:00Z'), frameUrl: `${SHOP}/`, rows: [
      { href: '/cart', internal: true }, { href: `${SHOP}/about/`, internal: true }, { href: '/login' },
      { href: 'https://other.test/x', internal: false }, { href: 'https://other.test/y' }, { href: 'mailto:a@b.test' },
    ] },
    note(T('2026-11-02T10:05:00Z'), 'bug', 'cart total wrong', { frameUrl: `${SHOP}/cart` }),
    /* none of these may count as a bug */
    note(T('2026-11-02T10:06:00Z'), 'issue', 'looks off'),
    note(T('2026-11-02T10:07:00Z'), 'question', 'is this meant?'),
    note(T('2026-11-02T10:08:00Z'), null, 'plain note'),
    note(T('2026-11-02T10:09:00Z'), 'technique', 'generated'),
    { kind: 'console', ts: T('2026-11-02T10:10:00Z'), level: 'error', text: 'boom', fail: 1 },
    { kind: 'net', ts: T('2026-11-02T10:11:00Z'), status: 500, url: `${SHOP}/api`, fail: 1 },
    { kind: 'pageerror', ts: T('2026-11-02T10:12:00Z'), text: 'TypeError', fail: 1 },
    { kind: 'dom', ts: T('2026-11-02T10:13:00Z'), action: 'click', frameUrl: 'https://ads.third.test/frame' }, // a third-party frame is not a page of this session
  ],
  s2: [
    { kind: 'nav', ts: T('2026-11-04T09:00:01Z'), url: `${SHOP}/about`, frameUrl: `${SHOP}/about` },
    note(T('2026-11-04T09:20:00Z'), 'bug', 'typo', { frameUrl: `${SHOP}/about`, severity: 'major' }),
    note(T('2026-11-04T09:21:00Z'), 'bug', 'odd', { frameUrl: `${SHOP}/about`, severity: 'bogus' }),
  ],
  s3: [
    { kind: 'nav', ts: T('2026-11-04T15:00:01Z'), url: 'https://blog.example.org/', frameUrl: 'https://blog.example.org/' },
    { kind: 'nav', ts: T('2026-11-04T15:05:00Z'), url: 'https://blog.example.org/post/1', frameUrl: 'https://blog.example.org/post/1' },
    { kind: 'dom', ts: T('2026-11-04T15:06:00Z'), action: 'input', frameUrl: 'https://blog.example.org/post/1' },
  ],
  s4: [
    { kind: 'nav', ts: T('2026-11-09T09:00:01Z'), url: `${SHOP}/`, frameUrl: `${SHOP}/` },
    { kind: 'dom', ts: T('2026-11-09T09:10:00Z'), action: 'click', frameUrl: `${SHOP}/` },
  ],
};
const r = buildKpi(sessions, events, { tzOffsetMin: 0, weekStartsOn: 1 });

/* totals */
assert.equal(r.empty, false);
assert.equal(r.all.sessions, 4);
assert.equal(r.all.testingMs, (30 + 60 + 15 + 10) * MIN, 'a recording session ends at its last event, not at now');
assert.equal(r.all.avgSessionMs, Math.round((115 * MIN) / 4));

/* bugs: only the notes filed as bugs, on the day they were filed */
assert.equal(r.all.bugs, 3, 'issue, question, plain, technique notes and console / net / pageerror events are not bugs');
assert.equal(r.all.days.find((d) => d.key === '2026-11-02').bugs, 1);
assert.equal(r.all.days.find((d) => d.key === '2026-11-04').bugs, 2);
assert.equal(r.all.days.find((d) => d.key === '2026-11-03').bugs, 0, 'a day with no session is drawn as zero');
assert.deepEqual(r.all.severity, { critical: 0, major: 1, moderate: 0, minor: 0, unrated: 2 });
assert.deepEqual(Object.keys(r.all.severity), SEVERITIES);
assert.equal(r.all.severity.critical + r.all.severity.major + r.all.severity.moderate + r.all.severity.minor + r.all.severity.unrated, r.all.bugs);

/* days and weeks: sessions per day, time per day */
const d = (k) => r.all.days.find((x) => x.key === k);
assert.equal(d('2026-11-02').ms, 30 * MIN);
assert.equal(d('2026-11-04').sessions, 2);
assert.equal(d('2026-11-04').ms, 75 * MIN);
assert.equal(r.all.days[0].key, '2026-11-02');
assert.equal(r.all.days.at(-1).key, '2026-11-09');
assert.equal(r.all.days.length, 8);
assert.deepEqual(r.all.weeks.map((w) => [w.key, w.ms / MIN, w.sessions, w.bugs]), [['2026-11-02', 105, 3, 3], ['2026-11-09', 10, 1, 0]]);

/* per site */
const site = (n) => r.sites.find((s) => s.site === n);
assert.deepEqual(r.sites.map((s) => s.site), ['shop.example.com', 'blog.example.org'], 'sites are ordered by time, www. folds into the bare host');
assert.equal(site('shop.example.com').testingMs, 100 * MIN);
assert.equal(site('blog.example.org').testingMs, 15 * MIN);
assert.equal(site('shop.example.com').sessions, 3);
assert.equal(site('shop.example.com').bugs, 3);
assert.equal(site('blog.example.org').bugs, 0);
assert.equal(r.sites.reduce((n, s) => n + s.testingMs, 0), r.all.testingMs, 'per-site time adds up to the total');

/* coverage (D5): discovered = visited + same-site linked; tested = at least one recorded action */
assert.deepEqual(site('shop.example.com').coverage, { discovered: 4, tested: 2, notTested: 2, pct: 50, basis: 'links' }, 'external links, mailto and a third-party frame are not pages of the shop');
assert.deepEqual(site('blog.example.org').coverage, { discovered: 2, tested: 1, notTested: 1, pct: 50, basis: 'visited' }, 'no link check: the fallback basis is named');
assert.equal(r.all.coverage.discovered, 6);
assert.equal(r.all.coverage.tested, 3);

/* a split of one session across two sites keeps its total */
{
  const s = { id: 'm', startedAt: T('2026-11-03T08:00:00Z'), endedAt: T('2026-11-03T08:40:00Z'), startUrl: 'https://a.test/' };
  const ev = { m: [
    { kind: 'nav', ts: s.startedAt + 1, url: 'https://a.test/', frameUrl: 'https://a.test/' },
    { kind: 'nav', ts: s.startedAt + 2, url: 'https://b.test/', frameUrl: 'https://b.test/' },
    { kind: 'nav', ts: s.startedAt + 3, url: 'https://b.test/x', frameUrl: 'https://b.test/x' },
    { kind: 'nav', ts: s.startedAt + 4, url: 'https://b.test/y', frameUrl: 'https://b.test/y' },
  ] };
  const m = buildKpi([s], ev);
  assert.equal(m.all.sessions, 1);
  assert.equal(m.sites.find((x) => x.site === 'a.test').testingMs, 10 * MIN);
  assert.equal(m.sites.find((x) => x.site === 'b.test').testingMs, 30 * MIN);
  assert.equal(m.sites.find((x) => x.site === 'b.test').sessions, 1);
}

/* filters, time zone, week start, empty */
assert.equal(buildKpi(sessions, events, { since: T('2026-11-04T00:00:00Z') }).all.sessions, 3, 'since drops older sessions');
assert.equal(buildKpi([], {}).empty, true);
assert.deepEqual(buildKpi([], {}).all.days, []);
assert.equal(buildKpi([{ id: 'x', startedAt: T('2026-11-02T10:00:00Z') }], {}).all.testingMs, 0, 'a session with no end and no events has no time');
assert.equal(dayKey(T('2026-11-02T23:30:00Z'), 180), '2026-11-03', 'local day, UTC+3');
assert.equal(dayKey(T('2026-11-02T23:30:00Z'), -300), '2026-11-02');
assert.equal(weekKey('2026-11-04', 1), '2026-11-02');
assert.equal(weekKey('2026-11-04', 0), '2026-11-01');
assert.equal(weekKey('2026-11-07', 6), '2026-11-07');
assert.equal(sessionMs({ startedAt: 100, endedAt: 50 }), 0, 'never negative');
assert.equal(siteOf('chrome-extension://abc/x.html'), '');
assert.equal(pageKey('/a/b/?q=1#h', 'https://WWW.X.test/z'), 'x.test/a/b');
assert.equal(pageKey('https://x.test'), 'x.test/');

/* the input is not mutated */
assert.equal(sessions[3].endedAt, null);
console.log('test-kpi: ok');
