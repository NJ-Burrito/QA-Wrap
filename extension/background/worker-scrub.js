/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Event masking: the privacy scrub applied to every event and replay chunk before it is stored. Moved out of service-worker.js (OF-18), unchanged. */

import { getSettings } from '../platform/settings.js';
import { redact, isSecretHeader } from '../core/privacy.js';

/**
 * The fields an event carries that can hold what a person typed or a server
 * said. Everything else is structure — a tag name, a status code, a duration —
 * and running a regex over those only costs time and risks eating a number the
 * tester is testing.
 */
const TEXT_FIELDS = ['value', 'text', 'label', 'title', 'message', 'note', 'body', 'reason', 'detail'];

/** 03-1: network, stack and locator fields a server, a URL or a page can put a secret in (r2-03-4: locators are shape-scanned, plain CSS survives). */
const SCRUB_EXTRA_TEXT = ['url', 'redirectedTo', 'responsePreview', 'stack', 'error', 'graphqlError', 'frameUrl', 'tabTitle', 'locator', 'selector', 'xpath', 'markdown', 'forKey'];

/** Header maps (or [{name,value}] lists): values scanned, names not. */
const SCRUB_MAPS = ['reqHeaders', 'resHeaders'];

/** Bodies: a string, or {kind, text}. */
const SCRUB_BODIES = ['reqBody', 'resBody'];

/** r3-03-3: page text one level down: an object, or an array of objects, whose listed string leaves are scanned. */
const SCRUB_NESTED = { expected: ['text'], overflow: ['text'] };

/** r4-03-2: worker-written nested a11y, perf and fine-print leaves: every string leaf scanned (depth <= 4, 2000 nodes), these keys left as structure. */
const SCRUB_DEEP = ['violations', 'frames', 'resources', 'checks', 'manual'];

const DEEP_SKIP = new Set(['id', 'impact', 'rule', 'count', 'bytes', 'ms']);

/** Every other field is structure and is left alone on purpose. */
const SCRUB_STRUCTURAL = ['via', 'method', 'status', 'ok', 'durationMs', 'overridden', 'ruleLabel', 'mocked', 'operation', 'en', 'ev', 'act', 'nh', 'n', 'level', 'src', 'ofKind', 'storm', 'capped', 'action', 'button', 'mods', 'trusted', 'key', 'masked', 'control', 'tag', 'framePrefix', 'strategy', 'locatorMatches', 'locatorAmbiguous', 'locatorWarnings', 'warnCodes', 'copied', 'flavours', 'matches', 'ambiguous', 'maskedSource', 'category', 'elementId', 'classes', 'role', 'width', 'height', 'previewNote', 'preview', 'previewW', 'previewH', 'credRef', 'intent', 'expected', 'purpose', 'enabled', 'expandPercent', 'options', 'overflowCount', 'cappedNodes', 'timings', 'overflow', 'group', 'fieldKind', 'fieldLabel', 'valueLength', 'truncated', 'actualLength', 'thirdParty', 'auto'];

/** The redaction settings, cached: one read when cold, dropped by storage.onChanged (r2-01-1). */
let scrubCfg = null;

let scrubLoad = null;

let scrubGen = 0;

export const dropScrubCfg = () => { scrubGen++; scrubCfg = scrubLoad = null; };

export const loadScrubCfg = () => {
  if (scrubLoad) return scrubLoad;
  const gen = scrubGen; // taken before the read: a drop that lands mid-read must leave the cache cold (r3-03-2)
  const load = (scrubLoad = getSettings().then((s) => {
  const cfg = { on: s?.redact !== false, extra: Array.isArray(s?.redactExtra) ? s.redactExtra : [] };
  // A fallback read (vault locked) is used once and not kept; a change mid-read leaves the cache cold (r4-01-2: the promise too).
  if (!s?.vaultLocked && gen === scrubGen) scrubCfg = cfg;
  else if (scrubLoad === load) scrubLoad = null;
  return cfg;
  }));
  return load;
};

/** Pure and synchronous: scrub one event with an already-read configuration. */
function scrubWith(event, cfg) {
  if (!cfg.on) return event;
  const out = { ...event };
  const families = new Set();
  const clean = (v) => {
    if (typeof v !== 'string' || !v) return v;
    const { text, found } = redact(v, { extra: cfg.extra });
    for (const f of found) families.add(f.label);
    return found.length ? text : v;
  };
  const header = (name, v) => {
    if (typeof v !== 'string' || !v) return v;
    if (!isSecretHeader(name)) return clean(v); // a credential header is masked whole (D-1010-173)
    families.add('Secret header');
    return '••••••••';
  };
  for (const field of [...TEXT_FIELDS, ...SCRUB_EXTRA_TEXT]) if (typeof out[field] === 'string') out[field] = clean(out[field]);
  for (const field of SCRUB_MAPS) {
    const map = out[field];
    if (Array.isArray(map)) out[field] = map.map((h) => (h && typeof h === 'object' && typeof h.value === 'string' ? { ...h, value: header(h.name, h.value) } : h));
    else if (map && typeof map === 'object') out[field] = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, header(k, v)]));
  }
  for (const field of SCRUB_BODIES) {
    const body = out[field];
    if (typeof body === 'string') out[field] = clean(body);
    else if (body && typeof body === 'object' && typeof body.text === 'string') out[field] = { ...body, text: clean(body.text) };
    else if (Array.isArray(body?.parts)) out[field] = { ...body, parts: body.parts.map((p) => (p?.value ? { ...p, value: clean(p.value) } : p)) };
  }
  for (const [field, keys] of Object.entries(SCRUB_NESTED)) {
    const fix = (o) => (o && typeof o === 'object' ? { ...o, ...Object.fromEntries(keys.filter((k) => typeof o[k] === 'string').map((k) => [k, clean(o[k])])) } : o);
    if (Array.isArray(out[field])) out[field] = out[field].map(fix);
    else if (out[field]) out[field] = fix(out[field]);
  }
  let nodes = 2000;
  const deep = (v, d) => (typeof v === 'string' ? clean(v)
    : d > 4 || !v || typeof v !== 'object' || nodes-- < 1 ? v
    : Array.isArray(v) ? v.map((x) => deep(x, d + 1))
    : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, DEEP_SKIP.has(k) ? x : deep(x, d + 1)])));
  for (const field of SCRUB_DEEP) if (out[field] && typeof out[field] === 'object') out[field] = deep(out[field], 0);
  if (families.size) out.redacted = [...families];
  return out;
}

/** r3-03-1: a replay entry's string leaves go through the same redact() before the log is stored (names and the DOM tags stay). */
const REPLAY_KEEP = new Set(['k', 'n', 'name']);

export async function scrubReplay(entries) {
  const cfg = scrubCfg || (await loadScrubCfg());
  if (!cfg.on) return entries;
  for (const stack = [entries]; stack.length;) {
    const o = stack.pop();
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') { if (v.length > 8 && !REPLAY_KEEP.has(k)) o[k] = redact(v, { extra: cfg.extra }).text; }
      else if (v && typeof v === 'object') stack.push(v);
    }
  }
  return entries;
}

/**
 * Take card, IBAN, token and key shapes out of an event before it is stored (national numbers and
 * emails only when the tester asked). Only what was removed is counted onto the event, never the value.
 * Every event written by the worker passes here through appendEvent (r2-13-1); ingest, which queues
 * its own writes, calls it directly.
 */
export const scrub = (event) => (scrubCfg ? scrubWith(event, scrubCfg) : loadScrubCfg().then((cfg) => scrubWith(event, cfg)));
