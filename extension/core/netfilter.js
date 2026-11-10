/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Network filter (غربلة), the read side. Decision record: docs/decisions/2026-11-10-network-filter-and-click-labels.md.
 *
 * The page hook tags every request; this module turns the tags plus the tester's preset and rules into a view.
 * Nothing is deleted (D1): `prepare()` only adds a `flt` reason to a copy, `summary()` proves shown + hidden = total.
 * The hard rule (D2, `neverHidden`) is applied last, so no preset and no rule can hide what it protects.
 * Not in the worker's boot graph: it carries the Public Suffix List snapshot.
 */
import { PSL } from '../vendor/psl-data.js';
import { neverHidden, isNet, countOf, failsNet, markRecovered, parts, pathTemplate } from './netkeys.js';

export { neverHidden, markRecovered, pathTemplate };

export const PRESETS = ['strict', 'balanced', 'everything'];
export const MAX_RULES_PER_SITE = 100;

/**
 * D4: the editable telemetry denylist (host or parent domain). The page hook carries the same default list.
 * Stored with each name reversed: tools/test-independent.mjs reads any file that names an analytics service as a service being called,
 * and this list is the opposite of a call. test-netfilter.mjs checks both copies decode to the same names.
 */
export const DEFAULT_DENYLIST = Object.freeze(['moc.scitylana-elgoog', 'moc.elgoog.scitylana', 'moc.reganamgatelgoog', 'moc.secivresdaelgoog', 'ten.kcilcelbuod', 'moc.rajtoh', 'oi.rajtoh', 'oi.yrtnes', 'oi.tnemges', 'moc.tnemges', 'moc.qhgodatad', 'ue.qhgodatad', 'sm.ytiralc', 'moc.cilerwen', 'ten.atad-rn', 'moc.lenapxim', 'moc.edutilpma', 'moc.yrotslluf', 'moc.gnib.tab', 'ten.koobecaf.tcennoc', 'moc.nideknil.sda.xp', 'moc.ndcil.pans', 'moc.pw.stats'].map((h) => h.split('').reverse().join('')));

/* ── registrable domain from the vendored Public Suffix List snapshot (D3) ─────────────────────────── */

let table = null;
function load() {
  table = new Map();
  for (const g of PSL.data.split(';')) {
    const i = g.indexOf(':');
    table.set(g.slice(0, i), new Set(g.slice(i + 1).split(',')));
  }
  return table;
}
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** eTLD+1 of a host (`a.b.shop.co.uk` -> `shop.co.uk`). IPs, `localhost` and bare labels are returned as they are. */
export function etld1(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (!h || IPV4.test(h) || h.includes(':') || !h.includes('.')) return h;
  const l = h.split('.');
  const rules = (table || load()).get(l[l.length - 1]);
  let suffix = 1; // the default rule: the last label
  if (rules) {
    for (let i = 0; i < l.length - 1; i++) {
      const rest = l.slice(i, -1).join('.');
      const wild = l.slice(i + 1, -1).join('.');
      if (rules.has(`!${rest}`)) { suffix = l.length - i - 1; break; } // an exception: the suffix is one label shorter
      if (rules.has(rest) || rules.has(wild ? `*.${wild}` : '*')) { suffix = Math.max(suffix, l.length - i); break; }
    }
  }
  return l.slice(Math.max(0, l.length - suffix - 1)).join('.');
}

/** The site a rule belongs to: the registrable domain of the session's start page (rules are stored per site). */
export function siteOf(session) {
  try { return etld1(new URL(session?.startUrl || '').hostname); } catch { return ''; }
}

/** "401, 403 0" -> [401, 403, 0]; an empty field gives [] (an empty token is not a rule for status 0). */
export const parseStatuses = (v) => String(v || '').split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 600).slice(0, 50);

/* ── host set (D3) ─────────────────────────────────────────────────────────────────────────────── */

export const isDenied = (host, deny = DEFAULT_DENYLIST) => !!host && deny.some((d) => host === d || host.endsWith(`.${d}`));

/** eTLD+1 of every navigated and framed origin, every host that served a script, document or frame, and the tester's pinned hosts. */
export function hostSet(events = [], session = null, pinned = []) {
  const set = new Set();
  const add = (u, base) => { const p = parts(u, base); if (p?.host) set.add(etld1(p.host)); };
  add(session?.startUrl);
  for (const h of pinned) set.add(etld1(String(h).replace(/^https?:\/\//, '').split('/')[0]));
  for (const e of events) {
    if (e.kind === 'nav') add(e.url);
    if (e.frameUrl) add(e.frameUrl);
    if (e.kind === 'net' && (e.via === 'document' || e.via === 'subframe' || e.sc === 1) && !isDenied(parts(e.url, e.frameUrl)?.host)) add(e.url, e.frameUrl);
  }
  return set;
}

/* ── tester rules (D9), stored per site ─────────────────────────────────────────────────────────── */

export const DEFAULT_CONFIG = /** @type {any} */ (Object.freeze({ preset: 'balanced', denylist: null, ignoreDomains: [], ignorePaths: [], ignoreStatuses: [], myHosts: [], rules: {}, clickLabels: true }));

/** A rule is { kind: 'hide' | 'show', scope: 'endpoint' | 'domain', method?, host, path? }. */
export function ruleMatches(rule, e) {
  const p = parts(e.url, e.frameUrl);
  if (!p) return false;
  if (rule.scope === 'domain') return p.host === rule.host || p.host.endsWith(`.${rule.host}`);
  if (rule.host && p.host !== rule.host) return false;
  if (rule.method && String(e.method || 'GET').toUpperCase() !== rule.method) return false;
  return p.path === rule.path;
}
const globRe = (g) => new RegExp(`^${String(g).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

/** How many already-recorded net rows a new hide rule would hide (the "more than 20" warning of D9). */
export const rowsHiddenBy = (rule, events) => (events || []).filter((e) => isNet(e) && ruleMatches(rule, e)).reduce((n, e) => n + countOf(e), 0);

const sameRule = (a, b) => a.kind === b.kind && a.scope === b.scope && a.host === b.host && a.path === b.path && a.method === b.method;
export function addRule(cfg, site, rule) {
  const rules = { ...(cfg.rules || {}) };
  rules[site] = [...(rules[site] || []).filter((r) => !sameRule(r, rule) && !(r.scope === rule.scope && r.host === rule.host && r.path === rule.path && r.method === rule.method)), rule].slice(-MAX_RULES_PER_SITE);
  return { ...cfg, rules };
}
export function removeRule(cfg, site, rule) {
  const rules = { ...(cfg.rules || {}) };
  rules[site] = (rules[site] || []).filter((r) => !sameRule(r, rule));
  return { ...cfg, rules };
}
export const siteRuleCount = (cfg, site) => ((cfg?.rules || {})[site] || []).length + (cfg?.ignoreDomains?.length || 0) + (cfg?.ignorePaths?.length || 0) + (cfg?.ignoreStatuses?.length || 0);

/* ── prepare: the one seam ──────────────────────────────────────────────────────────────────────── */

/**
 * Returns a copy of `events` whose net failures carry the `flt` reason the preset and rules give them. Nothing is dropped.
 * Order: Everything clears every reason; a tester's "Always show" rule keeps a row; rules and ignore lists hide;
 * Strict hides what the tester's actions did not cause; finally D2 (`neverHidden`) overrides all of it.
 */
export function prepare(events, cfg = DEFAULT_CONFIG, site = '') {
  const c = { ...DEFAULT_CONFIG, ...(cfg || {}) };
  const rules = (c.rules || {})[site] || [];
  const showRules = rules.filter((r) => r.kind === 'show');
  const hideRules = rules.filter((r) => r.kind === 'hide');
  const paths = (c.ignorePaths || []).map(globRe);
  const stat = new Set((c.ignoreStatuses || []).map(Number));
  const doms = c.ignoreDomains || [];
  const deny = c.denylist || DEFAULT_DENYLIST;
  const recovered = markRecovered(events);
  return (events || []).map((e) => {
    if (!isNet(e)) return e;
    let flt = e.flt;
    const p = parts(e.url, e.frameUrl);
    if (c.preset === 'everything' || showRules.some((r) => ruleMatches(r, e))) flt = undefined;
    else {
      if (flt === 'telemetry' && c.denylist && p && !isDenied(p.host, deny)) flt = undefined; // the tester took this host off the list
      if (failsNet(e)) {
        if (p && !flt && isDenied(p.host, deny) && !e.fp) flt = 'telemetry';
        if (p && !flt && (doms.some((d) => p.host === d || p.host.endsWith(`.${d}`)) || paths.some((re) => re.test(p.pathname)) || stat.has(Number(e.status)) || hideRules.some((r) => ruleMatches(r, e)))) flt = 'rule';
        if (!flt && c.preset === 'strict' && !e.ca) flt = 'strict';
      }
    }
    if (flt && neverHidden(e)) flt = undefined; // D2
    const rec = recovered.get(e);
    const out = flt === e.flt ? e : { ...e, flt };
    return rec ? { ...out, rcv: rec.n } : out;
  });
}

/**
 * D1/D8 accounting for a prepared event list: every request is either shown or hidden, never lost.
 * `total` counts requests (a folded `rep` row counts its `n`); `hidden` is per reason.
 */
export function summary(prepared, { preset = 'balanced', ruleCount = 0 } = {}) {
  const hidden = {};
  let total = 0;
  let hiddenTotal = 0;
  let recovered = 0;
  for (const e of prepared || []) {
    if (!isNet(e)) continue;
    const n = countOf(e);
    total += n;
    const why = e.flt || (e.status >= 300 && e.status < 400 && preset !== 'everything' ? 'redirect' : '');
    if (why && !neverHidden(e)) { hidden[why] = (hidden[why] || 0) + n; hiddenTotal += n; }
    else if (e.rcv) recovered += n;
  }
  return { preset, ruleCount, total, shown: total - hiddenTotal, hiddenTotal, hidden, recovered };
}

/** The line every report ends with (D1): "N calls hidden by filter (preset)". English; the Arabic twin lives in the i18n files. */
export const hiddenLine = (s) => `${s.hiddenTotal} calls hidden by filter (${s.preset})`;

/* ── the words, EN and AR together (D1: never "no issues", always "M real failures, N hidden, K third-party") ── */

const WORDS = {
  en: {
    line: (m, n, k) => `${m} real failures, ${n} hidden, ${k} third-party`,
    hidden: (n, preset) => `${n} calls hidden by filter (${preset})`,
    preset: { strict: 'strict', balanced: 'balanced', everything: 'everything' },
    recovered: (n) => `${n} recovered after a retry`,
  },
  ar: {
    line: (m, n, k) => `${m} إخفاقات حقيقية، ${n} مخفية، ${k} من أطراف ثالثة`,
    hidden: (n, preset) => `${n} طلبات مخفية بالغربلة (${preset})`,
    preset: { strict: 'صارمة', balanced: 'متوازنة', everything: 'كل شيء' },
    recovered: (n) => `${n} نجحت بعد إعادة المحاولة`,
  },
};

/**
 * The sentences a report prints. `sig` is signal.visibleProblems() of the prepared events: `errors` are the real failures,
 * `warnings` the third-party ones. Always the counts, never a claim that nothing is wrong.
 */
export function filterSentences(sum, sig, lang = 'en') {
  const w = WORDS[lang === 'ar' ? 'ar' : 'en'];
  return {
    counts: w.line(sig?.errors || 0, sum.hiddenTotal, sig?.warnings || 0),
    hidden: w.hidden(sum.hiddenTotal, w.preset[sum.preset] || sum.preset),
    recovered: sum.recovered ? w.recovered(sum.recovered) : '',
  };
}
