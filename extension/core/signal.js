/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Which recorded events are problems? One pure, read-time answer.
 *
 * Nothing here is stored on an event. `classify(event)` is recomputed on every
 * read from raw facts, so a page cannot forge a class, a rule fix repairs every
 * old session, and headline, badge and list cannot diverge (they all come from
 * `visibleProblems()`). No clock, no I/O, no time constant: the fold epoch is
 * `act`, the recorder's counter of tester actions.
 *
 * The structural guard: an `n-*` (hidden Note) reason never applies to an event
 * with HTTP status >= 400 or to a rejected network request that is not an abort.
 * Nothing unrecognised is ever a Note. `nh` and `sg` are never read.
 */
import { isFailure, liteFp, dupeKey, liteProblem } from './events.js';

export const RULESET = 2;

/** code -> class (D defect, N note, X induced, I info), display tier, severe. */
export const REASONS = {
  'x-override': { c: 'X', tier: 'Induced' },
  'x-manual-api': { c: 'X', tier: 'Induced' },
  'n-abort': { c: 'N', tier: 'Note' },
  'n-resizeobserver': { c: 'N', tier: 'Note' },
  'n-opaque': { c: 'N', tier: 'Note' },
  'n-devwarn': { c: 'N', tier: 'Note' },
  'd-doc': { c: 'D', tier: 'Error', severe: true },
  'd-third': { c: 'D', tier: 'Warning' },
  'd-timeout': { c: 'D', tier: 'Error', severe: true },
  'd-5xx': { c: 'D', tier: 'Error', severe: true },
  'd-netfail': { c: 'D', tier: 'Error', severe: true },
  'd-4xx': { c: 'D', tier: 'Error' },
  'd-pageerror': { c: 'D', tier: 'Error', severe: true },
  'd-console': { c: 'D', tier: 'Error' },
  'd-storm': { c: 'D', tier: 'Error', severe: true },
  'i-other': { c: 'I', tier: 'Info' },
};

/* ── registrable domain ──────────────────────────────────────────────────── */

// ponytail: ~50 two-label public suffixes, not the full PSL; add a suffix when a real host is misjudged.
const SUFFIX2 = new Set(('co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk net.uk sch.uk com.jo org.jo net.jo gov.jo edu.jo ' +
  'co.jp ne.jp or.jp ac.jp go.jp com.au net.au org.au edu.au gov.au co.nz org.nz com.sa org.sa gov.sa edu.sa ' +
  'com.eg com.tr com.br com.mx com.ar com.cn com.hk com.sg com.my co.in net.in org.in co.za co.kr com.tw ' +
  'com.ua com.pk com.bd com.ng co.ke com.qa com.kw com.bh com.om com.lb co.ae').split(' '));

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function clean(host) {
  let h = String(host || '').toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') < 0 ? undefined : h.indexOf(']'));
  if (h.split(':').length === 2) h = h.split(':')[0];
  return h;
}

function isPrivateHost(h) {
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.includes(':')) return true; // IPv6 literals: treated as local
  if (!IPV4.test(h)) return false;
  const [a, b] = h.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export function registrableDomain(host) {
  const h = clean(host);
  if (!h || IPV4.test(h) || h === 'localhost' || h.includes(':')) return h;
  const l = h.split('.').filter(Boolean);
  if (l.length <= 2) return l.join('.');
  return SUFFIX2.has(l.slice(-2).join('.')) ? l.slice(-3).join('.') : l.slice(-2).join('.');
}

/* ── raw facts ───────────────────────────────────────────────────────────── */

const RO_TEXTS = ['ResizeObserver loop limit exceeded', 'ResizeObserver loop completed with undelivered notifications.'];
const ABORT_TEXTS = ['signal is aborted without reason', 'The user aborted a request.', 'The operation was aborted.', 'This operation was aborted'];
const TIMEOUT_TEXTS = ['timeout', 'signal timed out'];
const DEV_PREFIX = ['Warning: ', '[Vue warn]', 'Download the React DevTools for a better development experience'];

// a rep row stands for the failing event it folded; the hook does not repeat the flags, so restore them.
function unwrap(ev) {
  if (ev.kind !== 'rep') return ev;
  const k = ev.ofKind || 'net';
  const o = { ...ev, kind: k };
  if (k === 'net' && !(ev.status > 0)) o.error = true;
  if (k === 'console') o.level = 'error';
  return o;
}
const failing = (o) => isFailure(o);
const bareText = (t) => String(t || '').replace(/ \((?:https?|file):[^)]*\)$/, '');
const count = (ev) => (ev.kind === 'rep' ? Math.min(Math.max(Math.floor(Number(ev.n)) || 1, 1), 1e6) : 1);

function isTimeout(o) {
  if (o.ev === 'timeout' || o.en === 'TimeoutError') return true;
  return o.en === undefined && o.ev === undefined && o.kind === 'net' && o.error === true && TIMEOUT_TEXTS.includes(o.text);
}
function isAbort(o) {
  if (isTimeout(o)) return false;
  if (o.en === 'AbortError' || o.ev === 'abort') return true;
  if (o.en !== undefined || o.ev !== undefined) return false;
  // old sessions carry only text: exact strings, anchored prefix, never a substring
  if (o.kind === 'net') return o.error === true && ABORT_TEXTS.includes(o.text);
  return /^Unhandled rejection: AbortError\b/.test(o.text || '');
}
const isRO = (o) => o.kind === 'pageerror' && RO_TEXTS.includes(bareText(o.text));
// anchored: `Script error.` alone or followed by the hook's ` (url:l:c)` / ` (:0:0)` location suffix
const isOpaque = (o) => o.kind === 'pageerror' && /^Script error\.(?: \(.*\))?$/.test(o.text || '') && !o.stack;
const isDev = (o) => o.kind === 'console' && (o.level === 'error' || o.level === 'assert') &&
  (DEV_PREFIX.some((p) => (o.text || '').startsWith(p)) || /^NG0\d+/.test(o.text || ''));

/** What the hook's `nh` hint must equal. T-HINT compares against this; `nh` itself is never read. */
export function deriveHint(ev) {
  const o = unwrap(ev);
  if (o.en === 'AbortError' || o.ev === 'abort') return 'abort';
  if (isRO(o)) return 'ro';
  if (isOpaque(o)) return 'opaque';
  if (isDev(o)) return 'dev';
  return undefined;
}

const urlOf = (o) => { try { return o.url ? new URL(o.url, o.frameUrl || 'http://page/') : null; } catch { return null; } };
const pageHostOf = (o, ctx) => { if (ctx && ctx.pageHost) return ctx.pageHost; try { return new URL(o.frameUrl).host; } catch { return ''; } };
const FRAME = /(https?:\/\/[^\s)]+?)(?::\d+){1,2}(?=\)|\s|$)/;
const topFrame = (o) => { const m = FRAME.exec(o.stack || ''); return m ? m[1] : ''; };

function eventHost(o) {
  if (o.kind === 'net') { const u = urlOf(o); return u ? u.host : ''; }
  // `src` = the hook's top-frame script url (L4); older captures only have the stack. A forged src can only
  // turn an Error into an amber Warning, never hide it.
  const f = (typeof o.src === 'string' && o.src) || topFrame(o);
  try { return f ? new URL(f).host : ''; } catch { return ''; }
}
function isThirdParty(o, ctx) {
  const h = clean(eventHost(o));
  const p = clean(pageHostOf(o, ctx));
  if (!h || !p || isPrivateHost(h)) return false;
  return registrableDomain(h) !== registrableDomain(p);
}

/* ── classify ────────────────────────────────────────────────────────────── */

/**
 * @param {object} ev  a stored event (any session age)
 * @param {{pageHost?:string}} [ctx]
 * @param {{off?:Set<string>}} [opts]  `off` disables reason codes (ablation gate only)
 * @returns {{c:'D'|'N'|'X'|'I', r:string}}
 */
export function classify(ev, ctx, opts) {
  const off = opts && opts.off;
  const on = (r) => !(off && off.has(r));
  const ret = (r) => ({ c: REASONS[r].c, r });
  ev = ev || {};
  const o = unwrap(ev);
  if (o.kind === 'net' && o.overridden === true && on('x-override')) return ret('x-override');
  if (o.kind === 'net' && o.via === 'api' && on('x-manual-api')) return ret('x-manual-api');
  if (ev.capped || !failing(o)) return ret('i-other');
  const rejected = o.kind === 'net' && o.error === true && !(o.status >= 400);
  const abort = isAbort(o);
  // structural guard: no Note on HTTP >= 400 or a rejected request that is not an abort
  const noteOK = !(o.status >= 400) && !(rejected && !abort);
  if (noteOK) {
    if (abort && on('n-abort')) return ret('n-abort');
    if (isRO(o) && on('n-resizeobserver')) return ret('n-resizeobserver');
    if (isOpaque(o) && on('n-opaque')) return ret('n-opaque');
    if (isDev(o) && on('n-devwarn')) return ret('n-devwarn');
  }
  const d = (r) => (ev.storm ? ret('d-storm') : ret(r));
  if (o.kind === 'net' && o.via === 'document' && o.status >= 400) return d('d-doc');
  // D-1010-102: a resource load from another origin (ad blocker, a tracker that is down) is a Warning, never the app's first failure.
  if (isThirdParty(o, ctx) || (o.kind === 'net' && o.via === 'resource' && o.thirdParty === true)) return d('d-third');
  if (isTimeout(o)) return d('d-timeout');
  if (o.kind === 'net') {
    if (o.status >= 500) return d('d-5xx');
    if (rejected) return d('d-netfail');
    return d('d-4xx');
  }
  if (o.kind === 'pageerror') return d('d-pageerror');
  return d('d-console');
}

/* ── fingerprint ─────────────────────────────────────────────────────────── */

const UUID_SRC = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = new RegExp('\\b' + UUID_SRC + '\\b', 'gi');
const HEX = /\b[0-9a-f]{8,}\b/gi;

export function normalise(text) {
  return String(text || '')
    .replace(/(["'`])[^"'`]{41,}?\1/g, '"..."')
    .replace(UUID, '<h>').replace(HEX, '<h>').replace(/\d+/g, '#')
    .toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
}

const UUID_FULL = new RegExp('^' + UUID_SRC + '$', 'i');
const idSeg = (s) => /^\d+$/.test(s) || UUID_FULL.test(s) || /^[0-9a-f]{8,}$/i.test(s) ||
  (/^[A-Za-z0-9+_=-]{16,}$/.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s));

export function pathTemplate(u) {
  const p = u.pathname.split('/').map((s) => (s && idSeg(s) ? ':id' : s)).join('/');
  const keys = [...new Set([...u.searchParams.keys()].map((k) => k.replace(/\d+/g, '#')))].sort();
  return p + (keys.length ? '?' + keys.join('&') : '');
}

const statusOrName = (o) => (o.ev === 'gql' ? `gql:${o.operation || ''}` : o.status > 0 ? String(o.status) : o.en || o.ev || 'err');
const actOf = (ev) => (Number.isInteger(ev.act) && ev.act >= 0 ? ev.act : 0);

export function fingerprint(ev) {
  const o = unwrap(ev || {});
  if (o.kind === 'net') {
    const u = urlOf(o);
    return ['net', String(o.method || 'GET').toUpperCase(), u ? registrableDomain(u.host) : '', u ? pathTemplate(u) : String(o.url || ''), statusOrName(o)].join('|');
  }
  const base = topFrame(o).split('?')[0].split('/').pop();
  return [o.kind, o.level || '', normalise(o.text), base].join('|');
}

/** Fold scope: fingerprint plus the tester-action epoch. */
export const foldKey = (ev) => fingerprint(ev) + '|' + actOf(ev);

/**
 * The worker's badge tally is the one lite implementation: `liteFp` / `liteProblem`
 * live in events.js (already in the worker graph) and are re-exported here under
 * the names L3/L5 and the tests use. The badge counts distinct `dupeKey`s, the key core/finding-count.js groups by.
 */
export { liteFp as liteKey } from './events.js';
export function liteCount(events) {
  const s = new Set();
  for (const e of events) if (e && liteProblem(e)) s.add(dupeKey(e));
  return s.size;
}

/* ── tally, visibleProblems ──────────────────────────────────────────────── */

const RANK = { D: 3, X: 2, N: 1 };

/** Incremental accumulator. Any order or chunking of the same events gives the same result (T-TALLY). */
export function newTally(ctx) {
  const rows = new Map();
  const t = { requests: 0, failures: 0, collapsed: 0 };
  // ponytail: a row mixing classes keeps the most visible one (D > X > N); occurrences are not split per class.
  return {
    add(ev) {
      if (!ev) return;
      const o = unwrap(ev);
      const n = count(ev);
      if (o.kind === 'net') t.requests += n;
      if (failing(o)) t.failures += n;
      if (ev.capped) t.collapsed += n;
      const { c, r } = classify(ev, ctx);
      if (c === 'I') return;
      const key = foldKey(ev);
      const ts = Number(ev.ts) || 0;
      const row = rows.get(key);
      if (!row) { rows.set(key, { key, fp: fingerprint(ev), c, r, n, first: ts, last: ts, act: actOf(ev), url: o.url, status: o.status, text: o.text, kind: o.kind }); return; }
      row.n += n; row.first = Math.min(row.first, ts); row.last = Math.max(row.last, ts);
      if (RANK[c] > RANK[row.c] || (c === row.c && r < row.r)) { row.c = c; row.r = r; }
    },
    result(level = 'problems') {
      const byTime = (a, b) => a.first - b.first || (a.key < b.key ? -1 : 1);
      const all = [...rows.values()].sort(byTime);
      const dRows = all.filter((x) => x.c === 'D');
      const nRows = all.filter((x) => x.c === 'N');
      const hiding = {};
      for (const x of nRows) hiding[x.r] = (hiding[x.r] || 0) + x.n;
      for (const k of Object.keys(hiding).sort()) { const v = hiding[k]; delete hiding[k]; hiding[k] = v; } // stable key order
      const tier = (x) => REASONS[x.r].tier;
      const xRows = all.filter((x) => x.c === 'X');
      return {
        ruleset: RULESET, level,
        problems: dRows.length,
        errors: dRows.filter((x) => tier(x) === 'Error').length,
        warnings: dRows.filter((x) => tier(x) === 'Warning').length,
        severe: dRows.filter((x) => REASONS[x.r].severe).length,
        notes: nRows.reduce((s, x) => s + x.n, 0),
        hiding,
        induced: xRows.length,
        inducedRows: xRows,
        requests: t.requests,
        failures: t.failures, // legacy isFailure total per occurrence: the "Everything" number
        collapsed: t.collapsed,
        rows: level === 'all' ? [...dRows, ...nRows].sort(byTime) : dRows,
      };
    },
  };
}

/** The one seam every surface calls. `input` is an events array or `{events}`; level is 'problems' | 'all'. */
export function visibleProblems(input, level = 'problems', ctx) {
  const t = newTally(ctx);
  for (const e of Array.isArray(input) ? input : (input && input.events) || []) t.add(e);
  return t.result(level);
}
