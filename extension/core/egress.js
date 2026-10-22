/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-070: the egress ledger, observe-only, and the one fetch every filing request goes through
 * (it lives here so the worker boot graph keeps its module count; core/http.js re-exports it).
 *
 * `egressLedger` keeps the last 200 sends `{ts, kind, host, bytes, findingsCount, scanned}`, never content.
 * Every call has a timeout; a 429 on a GET/HEAD waits out `Retry-After` once; nothing else is re-sent (a repeated
 * create is a duplicate defect).
 */
import { isSecretHeader } from './privacy.js';
export const LEDGER_KEY = 'egressLedger';
export const LEDGER_MAX = 200;

/** Findings from the scan that just ran for a kind, taken by the next send of that kind. */
const scans = {};
export const noteScan = (kind, n) => { scans[kind] = n; };

const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };
const sizeOf = (b) =>
  b == null ? 0
    : typeof b === 'string' ? new TextEncoder().encode(b).length
      : b instanceof FormData ? [...b.values()].reduce((n, v) => n + sizeOf(v), 0)
        : b.size ?? b.byteLength ?? 0;

/** @param {string} kind @param {string} url @param {any} body @param {{findingsCount?: number, scanned?: boolean, count?: number}} [o] */
export function ledgerRow(kind, url, body, o = {}) {
  const { findingsCount, scanned, count } = o;
  const had = kind in scans;
  const row = { ts: Date.now(), kind, host: hostOf(url), bytes: sizeOf(body), findingsCount: findingsCount ?? scans[kind] ?? 0, scanned: scanned ?? had };
  if (count != null) row.count = count;
  delete scans[kind];
  return row;
}

export const pushRow = (rows, row) => [...(Array.isArray(rows) ? rows : []), row].slice(-LEDGER_MAX);

let chain = Promise.resolve();
let area = null; // storage.local, handed in by platform/settings.js (core/ never touches chrome.*)
let deadline = 3000;
let dropped = 0; // rows lost to a stalled or failed area; the next row that lands carries the count
export const useLedgerArea = (a, ms = 3000) => { area = a; deadline = ms; };
const within = (p) => new Promise((ok, no) => { const id = setTimeout(() => no(new Error('ledger deadline')), deadline); Promise.resolve(p).then(ok, no).finally(() => clearTimeout(id)); });
/** Serialised, so two sends in one tick keep both rows; a storage failure or stall never fails (or holds) the send. */
export function recordEgress(row) {
  chain = chain.then(async () => {
    if (!area) return;
    try {
      const { [LEDGER_KEY]: rows } = await within(area.get(LEDGER_KEY));
      await within(area.set({ [LEDGER_KEY]: pushRow(rows, dropped ? { ...row, dropped } : row) }));
      dropped = 0;
    } catch { dropped++; }
  });
  return chain;
}

/** The reference verdict, used by tests: production sends call the same detection (`scanText`) through `scanOutbound` (chat, exports, .eml) and `scanFields` (Jira, trackers), which `tools/test-egress.mjs` pins to it. `scan` = scanOutbound, passed in to stay out of the worker graph. Observe never blocks; enforce blocks on confirmed-tier findings. */
/** @param {string} kind @param {any} payload @param {{scan?: Function, enforce?: boolean, url?: string}} [o] */
export function prepare(kind, payload, o = {}) {
  const { scan, enforce = false, url = '' } = o;
  const fields = typeof payload === 'string' ? { content: payload } : { ...payload };
  const { findings = [], redacted = fields } = scan ? scan(fields, { mode: enforce ? 'enforce' : 'observe' }) : {};
  const out = typeof payload === 'string' ? redacted.content : redacted;
  const bytes = sizeOf(JSON.stringify(out));
  return {
    payload: out,
    findings,
    blocked: enforce && findings.some((f) => f.redacted),
    ledgerRow: { ts: Date.now(), kind, host: hostOf(url), bytes, findingsCount: findings.length, scanned: !!scan },
  };
}

/** Copy to the clipboard and record that it happened: count and size, never the text. */
export async function copyRecorded(text) {
  await navigator.clipboard.writeText(text);
  await recordEgress(ledgerRow('clipboard', '', text, { findingsCount: 0, scanned: false }));
}

export const TIMEOUT_MS = 20000;
const MAX_WAIT_MS = 10000;

export class HttpTimeout extends Error {
  constructor(ms) { super(`no answer after ${Math.round(ms / 1000)} s`); this.name = 'HttpTimeout'; this.timeout = true; }
}

/** Retry-After as milliseconds (seconds or an HTTP date); null when absent or unusable. */
export function retryAfterMs(res) {
  const v = res?.headers?.get?.('retry-after');
  if (v == null || v === '') return null;
  const n = Number(v);
  const ms = Number.isFinite(n) ? n * 1000 : Date.parse(v) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : null;
}

// D-1010-54: a request that carries a credential, or runs under a host-restricting policy, does not follow a
// redirect: the next hop is a second destination nobody typed or allow-listed. Same rule as core/api-send.js.
let restricted = async () => false; // handed in by platform/settings.js: is an integration-host allow-list set?
export const useRedirectGuard = (fn) => { restricted = typeof fn === 'function' ? fn : async () => false; };
export const credentialed = (h) => {
  const names = h instanceof Headers ? [...h.keys()] : Array.isArray(h) ? h.map((p) => p?.[0]) : h && typeof h === 'object' ? Object.keys(h) : [];
  return names.some(isSecretHeader);
};
const URL_CRED = /[?&](?:key|token|api_?key|access_token|secret|sig)=|\/(?:services\/T|webhooks?\/|hooks\/)|webhook\.office\.com/i; // D-1010-184: a credential in the path or query
async function guarded(url, init, force) {
  if (force || credentialed(init.headers) || URL_CRED.test(String(url))) return true;
  try { return Boolean(await restricted()); } catch { return false; }
}

async function once(url, init, ms, force) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const manual = await guarded(url, init, force);
    const res = await fetch(url, { ...init, ...(manual ? { redirect: 'manual' } : {}), signal: ctl.signal });
    if (manual && (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400 && res.headers?.get?.('location')))) { // Chrome gives an opaqueredirect, Node hands back the 3xx itself
      throw Object.assign(new Error('The server answered with a redirect, which is not followed for a request that carries a credential or runs under your organisation policy.'), { code: 'POLICY_BLOCKED', key: 'redirect' });
    }
    return res;
  } catch (err) {
    if (ctl.signal.aborted) throw new HttpTimeout(ms);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} url @param {any} [init] @param {{timeoutMs?: number, kind?: string, noRedirect?: boolean}} [o] */
export async function fetchT(url, init = {}, o = {}) {
  const { timeoutMs = TIMEOUT_MS, kind, noRedirect } = o;
  if (kind) recordEgress(ledgerRow(kind, url, init.body)); // observe-only: the row is written, nothing is held back
  const res = await once(url, init, timeoutMs, noRedirect);
  const method = String(init.method || 'GET').toUpperCase();
  if (res.status === 429 && (method === 'GET' || method === 'HEAD')) {
    const wait = retryAfterMs(res);
    if (wait != null && wait <= MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, wait));
      return once(url, init, timeoutMs, noRedirect);
    }
  }
  return res;
}
