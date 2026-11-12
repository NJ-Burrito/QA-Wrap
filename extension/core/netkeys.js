/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Network filter, the part with no data: grouping keys, the never-hidden rule (D2), recovery (D5) and grouping (D6).
 * Decision record: docs/decisions/2026-11-10-network-filter-and-click-labels.md. Pure; no chrome.*.
 *
 * The page hook (content/page-hooks.js) tags what it saw: `fp` (1 first party, 0 not), `ca` (1 = started within 2 s of a
 * trusted action, 2 = within the causal window), `au` (carried an auth header) and `flt` (the noise reason it assigned).
 * Nothing here deletes an event. `neverHidden()` is the hard rule: no tag, preset or rule can hide what it returns true for.
 */

import { guarded } from './events.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idSeg = (s) => /^\d+$/.test(s) || UUID.test(s) || /^[0-9a-f]{8,}$/i.test(s) || (/^[A-Za-z0-9+_=-]{16,}$/.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s));

/** `/api/users/42/orders/7` -> `/api/users/:id/orders/:id` (ids, uuids and long hex/token segments). */
export const pathTemplate = (pathname) => String(pathname || '/').split('/').map((s) => (s && idSeg(s) ? ':id' : s)).join('/');

/** Parsed once per call: { host, origin, path } or null. `base` resolves a page-relative URL. */
export function parts(url, base) {
  try {
    const u = new URL(String(url), base || 'file:///');
    return { host: u.hostname.toLowerCase(), origin: u.origin, path: pathTemplate(u.pathname), pathname: u.pathname };
  } catch {
    return null;
  }
}

export const isNet = (e) => !!e && (e.kind === 'net' || (e.kind === 'rep' && (e.ofKind || 'net') === 'net'));
export const countOf = (e) => (e.kind === 'rep' ? Math.min(Math.max(Math.floor(Number(e.n)) || 1, 1), 1e6) : 1);
const worst = (e) => (e.kind === 'rep' && e.ws ? Number(e.ws) || 0 : Number(e.status) || 0);

const isAbortEv = (e) => e.en === 'AbortError' || e.ev === 'abort';
export const failsNet = (e) => isNet(e) && (e.error === true || e.status >= 400 || e.ev === 'gql' || (e.kind === 'rep' && !(e.status > 0)));
const isOkNet = (e) => e.kind === 'net' && !e.error && e.status >= 200 && e.status < 400 && e.ev !== 'gql';

/**
 * D2, the hard rule. True when this event must stay visible whatever a tag, a preset or a rule says:
 *  - a 5xx, a non-abort transport error or a GraphQL error on a first-party host;
 *  - any status of 400 or more that started within 2 s of a trusted action;
 *  - a failing request that carried the app's auth header.
 */
export const neverHidden = (e) => failsNet(e) && guarded(e);

/** The group key (D6): method + origin + path template + status + GraphQL operation + error name. Bodies never merge. */
export function groupKey(e, withStatus = true) {
  const p = parts(e.url, e.frameUrl) || { origin: '', path: String(e.url || '') };
  const what = e.ev === 'gql' ? `gql:${e.operation || ''}` : e.status > 0 ? String(e.status) : `${e.en || e.ev || 'err'}`;
  return `${String(e.method || 'GET').toUpperCase()}|${p.origin}|${p.path}${withStatus ? `|${what}` : ''}`;
}

/** D5 key: the group key plus the GraphQL operation, so one operation's failure is recovered only by a clean answer of the same operation. */
const recKey = (e) => `${groupKey(e, false)}|${e.operation ? `op:${e.operation}` : ''}`;

const GROUP_WINDOW_MS = 30000;
const RECOVER_WINDOW_MS = 30000;

/**
 * D5: failures followed by a 2xx or 3xx on the same method + origin + path within 30 s are "failed N×, then OK".
 * A 5xx that needed more than 2 retries, or any failure that appeared more than 3 times, stays a problem.
 * @returns {Map<object, {n:number, ok:object}>} failure event -> how it recovered. Nothing is removed from `events`.
 */
export function markRecovered(events) {
  const out = new Map();
  const pend = new Map(); // key -> [{ev, n, ts}]
  const sorted = (events || []).filter((e) => isNet(e)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  for (const e of sorted) {
    const k = recKey(e);
    if (failsNet(e) && !isAbortEv(e)) {
      const list = pend.get(k) || [];
      list.push({ ev: e, n: countOf(e), ts: e.ts || 0 });
      pend.set(k, list);
    } else if (isOkNet(e)) {
      const list = (pend.get(k) || []).filter((x) => (e.ts || 0) - x.ts <= RECOVER_WINDOW_MS);
      pend.delete(k);
      if (!list.length) continue;
      const n = list.reduce((s, x) => s + x.n, 0);
      const has5 = list.some((x) => worst(x.ev) >= 500);
      if (n > 3 || (has5 && n > 2)) continue;
      for (const x of list) out.set(x.ev, { n, ok: e });
    }
  }
  return out;
}

/**
 * D6: net events folded into groups inside a 30 s window, across click epochs. A group keeps its first and last
 * occurrence and its worst status; it is coloured by the worst status, never the majority. Only a group that holds a
 * failure and at least two members is a group; every other event stays a row of its own.
 * @returns {{first:object,last:object,items:object[],n:number,ok:number,failed:number,worst:number,key:string,spanMs:number}[]}
 */
export function groupRows(events) {
  const open = new Map();
  const groups = [];
  for (const e of (events || []).filter(isNet).sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
    const k = groupKey(e, false) + (e.ev === 'gql' ? `|${e.operation || ''}` : '') + (e.status > 0 || e.kind === 'rep' ? '' : `|${e.en || e.ev || 'err'}`);
    let g = open.get(k);
    if (!g || (e.ts || 0) - g.last.ts > GROUP_WINDOW_MS) {
      g = { key: k, first: e, last: e, items: [], n: 0, ok: 0, failed: 0, worst: 0, spanMs: 0 };
      open.set(k, g);
      groups.push(g);
    }
    const n = countOf(e);
    g.items.push(e);
    g.last = e;
    g.n += n;
    if (failsNet(e)) { g.failed += n; g.worst = Math.max(g.worst, worst(e)); } else g.ok += n;
    g.spanMs = (e.ts || 0) - (g.first.ts || 0);
  }
  return groups.filter((g) => g.failed > 0 && g.items.length > 1);
}

/** `12× GET /api/users/:id › 404 · over 3 s` (EN words come from the caller so the AR side stays in i18n). */
export function groupLabel(g, over) {
  const p = parts(g.first.url, g.first.frameUrl);
  const where = p ? p.path : String(g.first.url || '');
  const method = String(g.first.method || 'GET').toUpperCase();
  const mixed = g.ok > 0;
  const what = g.worst > 0 ? String(g.worst) : (g.first.en || g.first.ev || 'err');
  const head = mixed ? `${g.ok} ok, ${g.failed}× ${what}` : `${g.n}× ${method} ${where} › ${what}`;
  return `${mixed ? `${method} ${where} › ` : ''}${head}${g.spanMs >= 1000 ? ` · ${over(Math.round(g.spanMs / 1000))}` : ''}`;
}
