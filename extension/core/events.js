/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The one definition of "this event is a problem".
 *
 * It lives on its own because three places need it and they must never drift:
 * the store (which indexes it), the artefact builder (which reports it), and the
 * panel (which colours it).
 */

import { hostOf } from './origins.js';

export function isFailure(ev) {
  if (!ev) return false;
  // a GraphQL 200 with `errors` is ev:'gql'; an XHR abort is error:false and never counts
  if (ev.kind === 'net') return ev.error === true || (ev.status >= 400 && ev.status < 600) || ev.ev === 'gql';
  if (ev.kind === 'console') return ev.level === 'error' || ev.level === 'assert';
  if (ev.kind === 'pageerror') return true;
  return false;
}

/** D-1010-80: a note the tester wrote, i.e. not one of the tagged notes the extension writes itself. */
const MACHINE_NOTE_TAGS = ['technique', 'capture-gap', 'split', 'dropped'];
export const isTesterNote = (e) => !!e && e.kind === 'note' && !MACHINE_NOTE_TAGS.includes(e.tag);

/** D-1010-84: decision-table outcomes arrive as an object keyed by rule number (a function cannot cross a message); other shapes are ignored. */
export function ruleOutcomes(conditions, outcomes) {
  if (!outcomes || typeof outcomes !== 'object' || Array.isArray(outcomes) || !Array.isArray(conditions)) return undefined;
  return (a) => outcomes[1 + conditions.reduce((n, c) => n * 2 + (a[c.id] ? 1 : 0), 0)] ?? null;
}

/**
 * IndexedDB cannot index a predicate, so the answer is written onto the record
 * as 1/0 at insert time and indexed. Counting failures then costs a key range
 * count instead of reading and filtering every event in the session.
 */
export function failFlag(ev) {
  return isFailure(ev) ? 1 : 0;
}

/** The folding key of one failure: kind, message or status, and place. No action epoch; the badge tally and core/dupes.js both count distinct ones. */
const ID = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8,}|(?=.*\d)[\w-]{16,})$/i;

/** Where a request goes, with ids and the query values folded away: /api/orders/42?x=1 and /api/orders/77?x=2 are one place. */
function urlPattern(url, frameUrl) {
  try {
    const base = (() => { try { return new URL(String(frameUrl)).href; } catch { return undefined; } })();
    const u = new URL(String(url), base);
    const q = [...new Set(u.searchParams.keys())].sort().join('&');
    return `${u.host}${u.pathname.split('/').map((x) => (ID.test(x) ? ':id' : x)).join('/')}${q ? `?${q}` : ''}`;
  } catch {
    return String(url || '').split(/[?#]/)[0];
  }
}

/** A message with the parts that change between two occurrences folded away (counts, ids, hashes, long quoted strings). */
const messageShape = (text) => String(text || '').toLowerCase()
  .replace(/[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{8,}/g, '<h>').replace(/\d+/g, '#')
  .replace(/"[^"]{41,}"/g, '"..."').replace(/\s+/g, ' ').trim().slice(0, 200);

/** The file and line a console error or an exception came from, without the column: the first stack frame, else `src`. */
function whereFrom(ev) {
  const m = /(?:\(|\bat\s+|@)\s*((?:https?|chrome-extension|file):[^\s)]+?):(\d+)(?::\d+)?\)?/.exec(String(ev.stack || ''));
  if (m) return `${urlPattern(m[1])}:${m[2]}`;
  return ev.src ? String(ev.src).replace(/:\d+$/, '') : '';
}

export function dupeKey(ev) {
  const kind = ev.kind === 'rep' ? ev.ofKind : ev.kind;
  if (kind === 'net') {
    const what = ev.status >= 400 ? ev.status : ev.ev === 'gql' ? `gql:${ev.operation || ''}` : ev.en || ev.ev || 'err';
    return `net|${String(ev.method || 'GET').toUpperCase()}|${urlPattern(ev.url, ev.frameUrl)}|${what}`;
  }
  return `${kind}|${messageShape(ev.text)}|${whereFrom(ev)}`;
}

/** The cheap fingerprint for folding repeats (correlate.js): dupeKey with the action epoch, and no place for a console row (a `rep` row carries none). */
export function liteFp(ev) {
  const kind = ev.kind === 'rep' ? ev.ofKind : ev.kind;
  return `${kind === 'net' ? dupeKey(ev) : `${kind}|${messageShape(ev.text)}`}|${ev.act | 0}`;
}

/** A failure the live tally may count: not induced by the tester, not a hook-hinted Note (a hint never hides an HTTP error). */
export const liteProblem = (ev) =>
  isFailure(ev) && !ev.overridden && ev.via !== 'api' && !(ev.nh && !(ev.status >= 400));

/** The events a report or ticket shows: failures that are problems, one per fingerprint (first occurrence), everything else as is. */
export function problemEvents(events) {
  const seen = new Set();
  return events.filter((e) => {
    if (!isFailure(e)) return true;
    if (!liteProblem(e)) return false;
    const fp = liteFp(e);
    return seen.has(fp) ? false : (seen.add(fp), true);
  });
}

/* ── what a page is allowed to put in the record ─────────────────────────── */

/**
 * Every event kind a page may report, and every field it may carry. A page under test can send any message the
 * content script can, so the record is an allow-list of kinds AND fields: anything not named is dropped silently
 * (an invented kind, a forged sessionId or failed flag, a claimed frameUrl, megabytes of padding).
 */
export const EVENT_FIELDS = Object.freeze({
  /* The network hooks in content/page-hooks.js. */
  net: [
    'via', 'method', 'url', 'status', 'ok', 'durationMs', 'error', 'text',
    'responsePreview', 'redirectedTo', 'overridden', 'ruleLabel', 'mocked',
    'graphqlError', 'operation', 'reqHeaders', 'reqBody', 'resHeaders',
    'en', 'ev', 'act', 'nh', 'n', 'thirdParty',
  ],
  /* The console wrapper. */
  console: ['level', 'text', 'stack', 'en', 'ev', 'act', 'nh', 'n', 'src'],
  /* window.onerror and unhandledrejection. */
  pageerror: ['text', 'stack', 'en', 'ev', 'act', 'nh', 'n', 'src'],
  /* The hook's folded repeats: a count for a failure already stored, never a new one. */
  rep: [
    'ofKind', 'method', 'url', 'status', 'en', 'ev', 'nh', 'text', 'act', 'n', 'storm', 'capped', 'operation',
  ],
  /* content/recorder.js — one action the tester took, with its locator. */
  dom: [
    'action', 'button', 'mods', 'trusted', 'key', 'value', 'masked', 'control', 'tag', 'label',
    'locator', 'framePrefix', 'selector', 'xpath', 'strategy',
    'locatorMatches', 'locatorAmbiguous', 'locatorWarnings', 'warnCodes',
  ],
  /* content/picker.js files what was picked as a note. */
  note: ['text', 'tag'],
  /* C1: the tester's "Not a bug" press, and the extra fields an auto screenshot carries; forKey = dupeKey(), max 200. */
  expected: ['forKey'],
  screenshot: ['auto', 'forKey'],
  /* content/picker.js files every selector it put on the clipboard. */
  selectorcopy: [
    'copied', 'flavours', 'strategy', 'matches', 'ambiguous', 'maskedSource', 'category',
    'tag', 'elementId', 'classes', 'role', 'text', 'width', 'height', 'previewNote',
    'preview', 'previewW', 'previewH', 'credRef', 'intent', 'expected', 'purpose', 'label', 'warnCodes',
  ],
  /* content/rtl-stress.js reports what the expansion broke. */
  rtl: [
    'enabled', 'expandPercent', 'options', 'overflowCount', 'cappedNodes',
    'timings', 'overflow',
  ],
  /* content/data-injector.js reports what it put in a field. */
  inject: [
    'label', 'group', 'fieldKind', 'fieldLabel', 'note', 'valueLength',
    'value', 'truncated', 'actualLength',
  ],
});

/**
 * How far a page's own clock may be from ours before we stop believing it. Not zero: the page stamps the moment a thing
 * happened and we stamp the arrival, and that gap is the click-to-request ordering. Not unbounded: a page can claim any number.
 */
export const TS_SKEW_MS = 5000;

/*
 * T-043: why a locator is weaker than it looks. The engine names the reason by code; the report words it in
 * en and ar. Only these two codes are believed: the page sends the field, so any other value is dropped.
 * The recorder forwards the engine's `warnings` list, so the engine ends it with `code:<name>` tokens and
 * `sanitiseEvent` moves them to `warnCodes`.
 */
export const LOCATOR_WARN_CODES = Object.freeze(['bidi', 'truncated']);

/* r2-02-1: a locator is source code: a chain of getBy*, locator, filter, nth, first, last, frameLocator calls with literal arguments, nothing else. */
const V = String.raw`(?:'(?:[^'\\\n\r\u2028\u2029]|\\.)*'|"(?:[^"\\\n\r\u2028\u2029]|\\.)*"|-?\d+(?:\.\d+)?|true|false)`; // glyph-ok
const A = `(?:${V}|\\{ *(?:\\w+ *: *${V}(?: *, *\\w+ *: *${V})*)? *\\})`;
const C = `(?:getBy(?:Role|Text|Label|Placeholder|AltText|Title|TestId)|locator|filter|nth|first|last|frameLocator)\\( *(?:${A}(?: *, *${A})*)? *\\)`;
const LOC = new RegExp(`^${C}(?:\\.${C})*$`);
export const safeLocator = (s) => typeof s === 'string' && LOC.test(s) && !/[\n\r\u2028\u2029`]|\$\{/.test(s); // glyph-ok
export const safePrefix = (s) => !s || (typeof s === 'string' && s.endsWith('.') && safeLocator(s.slice(0, -1)));
/* r2-03-2: the link rule (http, https, mailto, tel; ( ) and space encoded) and Mattermost page text (as mdEsc, plus @all/@channel/@here broken). */
export const safeHref = (u) => { try { const p = new URL(String(u ?? '').trim()); return /^(https?|mailto|tel):$/.test(p.protocol) ? p.href.replace(/[() ]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()) : ''; } catch { return ''; } };
export const mmText = (t) => String(t ?? '').replace(/\s+/g, (m) => (/[\r\n\u2028\u2029]/.test(m) ? ' ' : m)).replace(/@(all|channel|here)\b/gi, '@\u200b$1').replace(/[\\`*_[\]()!<>|~@]/g, '\\$&').replace(/\b(https?|ftp):\/\//gi, '$1:\\/\\/').replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}\\.`); // glyph-ok

const MAX_FIELD_CHARS = 32768; // T-075: no page string field is longer
const MAX_HEADERS = 100; // r3-07-1: nested input is bounded too, or one event can cost the scrubber seconds
const MAX_HEADER_CHARS = 8192;

const clip = (v, n) => (typeof v === 'string' && v.length > n ? v.slice(0, n) : v);
/* r4-02-1: nested page values are bounded: depth 4, 50 keys or items (100 for headers and bodies), 96000 chars per event. */
const MAX_NEST_CHARS = 96000;
let nestLeft = 0;
function cap(v, d = 0, n = 50, sm = MAX_FIELD_CHARS) {
  if (typeof v === 'string') { v = clip(v, sm); nestLeft -= v.length + 4; return nestLeft < 0 ? null : v; }
  if (!v || typeof v !== 'object') return v;
  nestLeft -= 8;
  if (d > 3 || nestLeft < 0) return null;
  return Array.isArray(v) ? v.slice(0, n).map((x) => cap(x, d + 1, n, sm))
    : Object.fromEntries(Object.entries(v).slice(0, n).map(([k, x]) => [clip(k, 256), cap(x, d + 1, n, sm)]));
}
/** A header map or list: at most MAX_HEADERS entries, each value at most MAX_HEADER_CHARS. */
function capHeaders(h) {
  if (Array.isArray(h)) {
    return h.slice(0, MAX_HEADERS).map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? { ...x, value: clip(x.value, MAX_HEADER_CHARS) } : Array.isArray(x) ? x.map((y) => clip(y, MAX_HEADER_CHARS)) : clip(x, MAX_HEADER_CHARS)));
  }
  if (h && typeof h === 'object') return Object.fromEntries(Object.entries(h).slice(0, MAX_HEADERS).map(([k, v]) => [k, clip(v, MAX_HEADER_CHARS)]));
  return h;
}

/**
 * Strip a page-supplied event down to what it is allowed to say.
 *
 * Returns `null` for a kind nobody renders — the caller stores nothing rather
 * than storing an event no reader understands.
 *
 * @param {object} raw            what the page sent
 * @param {object} opts
 * @param {string|null} [opts.frameUrl]  `sender.url` — the frame the message
 *   really came from, which is the browser's word and not the page's
 * @param {number} [opts.frameId]  `sender.frameId`
 * @param {number} [opts.now]     receipt time; the default is the honest one
 * @param {number} [opts.skewMs]  how much clock difference to tolerate
 */
export function sanitiseEvent(raw, { frameUrl = null, frameId, now = Date.now(), skewMs = TS_SKEW_MS } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  // `hasOwnProperty`: `EVENT_FIELDS['__proto__']` is truthy and crashed the ingest path; the list answers for its own keys only.
  const allowed = Object.prototype.hasOwnProperty.call(EVENT_FIELDS, raw.kind)
    ? EVENT_FIELDS[raw.kind]
    : null;
  if (!allowed) return null;

  const out = { kind: raw.kind };
  nestLeft = MAX_NEST_CHARS;
  for (const field of allowed) {
    if (raw[field] === undefined) continue;
    const v = raw[field];
    if (typeof v === 'string') { out[field] = clip(v, MAX_FIELD_CHARS); continue; }
    // Header maps are capped by capHeaders (100 x 8 KB, r3-07-1): they get their own, larger, budget.
    const hdr = /^(req|res)Headers$/.test(field);
    const keep = nestLeft;
    if (hdr) nestLeft = 1e6;
    out[field] = cap(v, 0, hdr || field === 'reqBody' ? MAX_HEADERS : 50, hdr ? MAX_HEADER_CHARS : MAX_FIELD_CHARS);
    if (hdr) nestLeft = keep;
  }
  for (const f of ['reqHeaders', 'resHeaders']) if (out[f] !== undefined) out[f] = capHeaders(out[f]);
  if (typeof out.forKey === 'string') out.forKey = out.forKey.slice(0, 200); else delete out.forKey; // C1
  if (out.auto !== true) delete out.auto;
  if (out.mods !== undefined) out.mods = Array.isArray(out.mods) ? ['Control', 'Shift', 'Alt', 'Meta'].filter((m) => out.mods.includes(m)) : [];
  if (out.mods && !out.mods.length) delete out.mods; // OF-1

  if (out.warnCodes !== undefined || Array.isArray(out.locatorWarnings)) {
    const sent = [].concat(Array.isArray(out.warnCodes) ? out.warnCodes : [], Array.isArray(out.locatorWarnings) ? out.locatorWarnings.map((w) => (typeof w === 'string' && w.startsWith('code:') ? w.slice(5) : '')) : []);
    const codes = LOCATOR_WARN_CODES.filter((c) => sent.includes(c));
    if (codes.length) out.warnCodes = codes; else delete out.warnCodes;
    if (Array.isArray(out.locatorWarnings)) out.locatorWarnings = out.locatorWarnings.filter((w) => typeof w === 'string' && !w.startsWith('code:'));
  }

  /* r2-02-1: an unsafe locator, framePrefix or copied is dropped; the CSS selector stays. */
  const okLoc = { locator: safeLocator, framePrefix: safePrefix, copied: (c) => !c.startsWith('page.') || safeLocator(c.slice(5)) };
  for (const f in okLoc) if (out[f] && !(typeof out[f] === 'string' && okLoc[f](out[f]))) delete out[f];

  // The page's timestamp is a hint, not a fact. Believed only while it agrees
  // with the clock that received it.
  const claimed = Number(raw.ts);
  out.ts = Number.isFinite(claimed) && Math.abs(claimed - now) <= skewMs ? claimed : now;

  // Never the page's own `frameUrl`. The browser tells us where a message came
  // from, and a page that could name its own origin could file its errors
  // against somebody else's.
  out.frameUrl = frameUrl ?? null;
  if (Number.isInteger(frameId)) out.frameId = frameId; // D-1010-98

  return out;
}
