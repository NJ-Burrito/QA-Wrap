/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * Personal KPIs, computed only from this user's own stored sessions (R4, run qaw-1109).
 *
 * Pure: sessions and their events in, numbers out. No DOM, no chrome, no clock unless `now` is passed.
 *
 * Where the numbers come from (store: core/db.js `sessions` and `events`; shapes: background/worker-session.js:300-314, core/events.js:103-128):
 *   - time tested      session.endedAt - session.startedAt; a session with no endedAt (still recording, or a crash before
 *                      reconcile) ends at its last event, never at "now", so an open tab cannot invent hours.
 *   - per site         the session's time is split by that site's share of the session's own navigations and recorded actions
 *                      (kind 'nav' and kind 'dom' with an `action`); a session with neither belongs to its start site.
 *   - bugs             ONLY notes the user filed with tag 'bug' (isTesterNote). A console error, a failed request, a page error,
 *                      an unfiled finding, a note tagged issue / question / note never counts. Counted on the note's own day.
 *   - severity         notes carry no severity today. A bug note counts under its own `severity` field when it holds one of the
 *                      five known ids, else under `unrated`, and the dashboard says so instead of guessing.
 *   - coverage (D5)    discovered = pages the user's sessions saw (navigations, actions) plus same-site pages found by a link
 *                      check (`links` events); tested = a page with at least one recorded action. With no link check on a site
 *                      the basis is `visited` (visited vs discovered URLs), and the result says which basis it used.
 * A day belongs to the local calendar (tzOffsetMin), a session to the day it started. A week starts on `weekStartsOn` (1 = Monday).
 */

import { isTesterNote } from './events.js';

export const SEVERITIES = ['critical', 'major', 'moderate', 'minor', 'unrated'];
const KNOWN_SEVERITY = new Set(['critical', 'major', 'moderate', 'minor']);
const DAY_MS = 864e5;
/** The most recent days and weeks drawn; older history still counts in the totals. */
export const MAX_DAYS = 120;
export const MAX_WEEKS = 26;

/** `shop.example.com` for any http(s) URL, `www.` dropped; '' for anything else. */
export function siteOf(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** One page: host + path, no query or hash, no trailing slash except the root. */
export function pageKey(url, base) {
  try {
    const u = new URL(String(url), base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '/';
    return `${host}${path}`;
  } catch {
    return '';
  }
}

const pad = (n) => String(n).padStart(2, '0');
const dayUtc = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const keyOfUtc = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

/** The local calendar day of a timestamp, as YYYY-MM-DD. */
export const dayKey = (ts, tzOffsetMin = 0) => keyOfUtc(ts + tzOffsetMin * 6e4);

/** The first day of the week holding `day`; weekStartsOn 0 = Sunday ... 6 = Saturday. */
export function weekKey(day, weekStartsOn = 1) {
  const ms = dayUtc(day);
  const dow = new Date(ms).getUTCDay();
  return keyOfUtc(ms - ((dow - weekStartsOn + 7) % 7) * DAY_MS);
}

/** Every day key from `from` to `to`, inclusive. */
function daysBetween(from, to) {
  const out = [];
  for (let ms = dayUtc(from); ms <= dayUtc(to); ms += DAY_MS) out.push(keyOfUtc(ms));
  return out;
}

/** How long a session ran, in ms. Its end, else its last event, else nothing; never negative, never "until now". */
export function sessionMs(session, events = []) {
  const start = Number(session?.startedAt);
  if (!Number.isFinite(start)) return 0;
  let end = Number(session?.endedAt);
  if (!Number.isFinite(end) || end <= 0) {
    end = 0;
    for (const e of events) if (Number.isFinite(e?.ts) && e.ts > end) end = e.ts;
  }
  return Math.max(0, end - start);
}

const eventsOf = (src, id) => (src instanceof Map ? src.get(id) : src?.[id]) || [];

/**
 * The raw measurements of one session: time per site, the bug notes, the pages seen, linked and acted on.
 * @returns {{ms:number, share:Map<string,number>, bugs:{ts:number, site:string, severity:string}[], visited:Set<string>, linked:Set<string>, tested:Set<string>}}
 */
function measure(session, events) {
  const startSite = siteOf(session.startUrl);
  const hosts = new Set(startSite ? [startSite] : []);
  for (const e of events) if (e?.kind === 'nav') { const h = siteOf(e.url); if (h) hosts.add(h); }

  const weight = new Map();
  const visited = new Set();
  const linked = new Set();
  const tested = new Set();
  const bump = (h) => weight.set(h, (weight.get(h) || 0) + 1);

  if (startSite) visited.add(pageKey(session.startUrl));
  for (const e of events) {
    if (!e) continue;
    if (e.kind === 'nav') {
      const h = siteOf(e.url);
      if (h) { bump(h); visited.add(pageKey(e.url)); }
    } else if (e.kind === 'dom' && e.action) {
      const h = siteOf(e.frameUrl);
      if (h && hosts.has(h)) { bump(h); visited.add(pageKey(e.frameUrl)); tested.add(pageKey(e.frameUrl)); }
    } else if (e.kind === 'links' && Array.isArray(e.rows)) {
      const h = siteOf(e.frameUrl);
      if (!h || !hosts.has(h)) continue;
      visited.add(pageKey(e.frameUrl));
      for (const r of e.rows) {
        if (!r || r.internal === false) continue;
        const k = pageKey(r.href, e.frameUrl);
        if (k && k.startsWith(`${h}/`)) linked.add(k); // same site only: a link to elsewhere is not a page of this site
      }
    }
  }
  visited.delete('');

  const ms = sessionMs(session, events);
  const share = new Map();
  const total = [...weight.values()].reduce((a, b) => a + b, 0);
  if (total > 0) for (const [h, w] of weight) share.set(h, (ms * w) / total);
  else share.set(startSite, ms);

  const bugs = [];
  for (const e of events) {
    if (!isTesterNote(e) || e.tag !== 'bug' || !Number.isFinite(e.ts)) continue;
    const sev = String(e.severity || '').toLowerCase();
    bugs.push({ ts: e.ts, site: siteOf(e.frameUrl) || startSite, severity: KNOWN_SEVERITY.has(sev) ? sev : 'unrated' });
  }
  return { ms, share, bugs, visited, linked, tested };
}

/** @param {Map<string,{ms:number,sessions:number,bugs:number}>} map */
function fillSeries(map, keys) {
  return keys.map((k) => ({ key: k, ms: Math.round(map.get(k)?.ms || 0), sessions: map.get(k)?.sessions || 0, bugs: map.get(k)?.bugs || 0 }));
}

/**
 * @param {object[]} sessions          every stored session (core/db.js listSessions)
 * @param {Map<string,object[]>|Record<string,object[]>} eventsBySession   each session's events (core/db.js getEvents)
 * @param {{ since?: number, tzOffsetMin?: number, weekStartsOn?: number }} [options]
 */
export function buildKpi(sessions, eventsBySession, options = {}) {
  const tz = options.tzOffsetMin ?? 0;
  const wso = options.weekStartsOn ?? 1;
  const since = Number.isFinite(options.since) ? options.since : -Infinity;

  /** per (site | '*') accumulators */
  const acc = new Map();
  const slot = (site) => {
    if (!acc.has(site)) acc.set(site, { days: new Map(), sessions: 0, ms: 0, bugs: 0, severity: Object.fromEntries(SEVERITIES.map((s) => [s, 0])), visited: new Set(), linked: new Set(), tested: new Set(), sessionIds: new Set() });
    return acc.get(site);
  };
  const dayCell = (a, d) => { if (!a.days.has(d)) a.days.set(d, { ms: 0, sessions: 0, bugs: 0 }); return a.days.get(d); };

  for (const s of sessions || []) {
    if (!s || !Number.isFinite(s.startedAt) || s.startedAt < since) continue;
    const m = measure(s, eventsOf(eventsBySession, s.id));
    const d = dayKey(s.startedAt, tz);
    const all = slot('*');
    all.sessions += 1; all.ms += m.ms; all.sessionIds.add(s.id);
    dayCell(all, d).ms += m.ms; dayCell(all, d).sessions += 1;
    for (const [site, ms] of m.share) {
      const a = slot(site);
      if (!a.sessionIds.has(s.id)) { a.sessionIds.add(s.id); a.sessions += 1; dayCell(a, d).sessions += 1; }
      a.ms += ms; dayCell(a, d).ms += ms;
    }
    for (const b of m.bugs) {
      const bd = dayKey(b.ts, tz);
      for (const a of [all, slot(b.site)]) { a.bugs += 1; a.severity[b.severity] += 1; dayCell(a, bd).bugs += 1; }
    }
    for (const k of m.visited) { slot(k.slice(0, k.indexOf('/'))).visited.add(k); slot('*').visited.add(k); } // a page belongs to the site in its own key
    for (const k of m.linked) { slot(k.slice(0, k.indexOf('/'))).linked.add(k); slot('*').linked.add(k); }
    for (const k of m.tested) { slot(k.slice(0, k.indexOf('/'))).tested.add(k); slot('*').tested.add(k); }
  }

  const summary = (a) => {
    const keys = [...a.days.keys()].sort();
    const today = keys.length ? keys[keys.length - 1] : null;
    const dayList = today ? daysBetween(keys[0], today).slice(-MAX_DAYS) : [];
    const weekMap = new Map();
    for (const [d, c] of a.days) {
      const w = weekKey(d, wso);
      const cur = weekMap.get(w) || { ms: 0, sessions: 0, bugs: 0 };
      cur.ms += c.ms; cur.sessions += c.sessions; cur.bugs += c.bugs; weekMap.set(w, cur);
    }
    const wk = [...weekMap.keys()].sort();
    const weekList = wk.length ? [...new Set(daysBetween(wk[0], wk[wk.length - 1]).filter((d) => weekKey(d, wso) === d))].slice(-MAX_WEEKS) : [];
    const discovered = new Set([...a.visited, ...a.linked]);
    const testedIn = [...a.tested].filter((k) => discovered.has(k)).length;
    return {
      sessions: a.sessions,
      testingMs: Math.round(a.ms),
      avgSessionMs: a.sessions ? Math.round(a.ms / a.sessions) : 0,
      bugs: a.bugs,
      severity: a.severity,
      days: fillSeries(a.days, dayList),
      weeks: fillSeries(weekMap, weekList),
      coverage: {
        discovered: discovered.size,
        tested: testedIn,
        notTested: discovered.size - testedIn,
        pct: discovered.size ? Math.round((testedIn / discovered.size) * 100) : null,
        basis: a.linked.size > 0 ? 'links' : 'visited',
      },
    };
  };

  const sites = [...acc.keys()].filter((k) => k !== '*').sort((x, y) => acc.get(y).ms - acc.get(x).ms || x.localeCompare(y));
  const all = summary(slot('*'));
  return {
    all,
    sites: sites.map((site) => ({ site, ...summary(acc.get(site)) })),
    empty: all.sessions === 0,
  };
}
