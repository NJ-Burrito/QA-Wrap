/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Six response headers, kept per request, so tool 18 can measure instead of ask.
 *
 * ── the rows this exists for ──────────────────────────────────────────────
 *
 * `core/fine-print.js` has three security rows it could not answer and said so
 * in its own words: "Whether HSTS is set is a response header, which this
 * session does not capture", and a whole MANUAL entry reading "Read them with
 * curl -I, or from the Network panel, until the session captures them". Those
 * are the rows a reviewer most often wants and the only ones on the list that a
 * browser could have answered all along. Decision 33, taken round 2.
 *
 * ── why webRequest ───────────────────────────────────────────────────────
 *
 * The page's fetch/XHR patch sees only CORS-safelisted headers and never the document's own
 * response. `chrome.debugger` shows Chrome's debugging bar on the page under test; a second
 * `fetch` from the worker reads a different response than the one rendered; `<meta http-equiv>`
 * cannot express HSTS, X-Frame-Options, CORS or Permissions-Policy. `webRequest` in observation
 * mode reads what the browser received, sends nothing, and adds no install warning beyond the
 * host permissions already required.
 *
 * ── armed while recording, and not otherwise ─────────────────────────────
 *
 * One non-blocking listener, gated per response by the set of armed windows (kept in
 * storage.session with the bounded seen map). It exists only while a window is armed
 * and a host origin is held (restore, arm, permissions.onAdded), and goes when either
 * ends: an idle browser never wakes the worker, a fresh install shows no Chrome error.
 *
 * ── an allow-list, truncated, and nothing else ───────────────────────────
 *
 * Six names, lower-cased, values cut at 512 characters. Not a deny-list: a
 * deny-list would have to enumerate every header a team can invent, and the one
 * it missed would be the `set-cookie` or the `authorization` echo that ends up
 * in an exported document. `tools/test-security-headers.mjs` asserts both the
 * allow-list and the size, because a per-request record that grows without
 * bound is a session that fills a disk.
 */

import { redact } from '../core/privacy.js';

/** The six, and only the six. Lower-case, because header names are not case sensitive. */
export const SECURITY_HEADERS = Object.freeze([
  'content-security-policy',
  'strict-transport-security',
  'access-control-allow-origin',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
]);

/** How much of a value is kept: the front of a long policy answers "is there one, does it allow 'unsafe-inline'". */
export const VALUE_MAX = 512;

/** Marks a value that was cut, so nobody reads a truncated policy as a whole one. */
export const TRUNCATED = '…';

/** How many bytes one request's headers may cost, all six together; the trim takes from the longest value (the CSP) first. */
export const RECORD_MAX = 1024;

const bytesOf = (value) => new TextEncoder().encode(value).length;

/**
 * Reduce a raw `responseHeaders` array to the allow-list.
 *
 * Pure, so `tools/test-security-headers.mjs` can hold it to the allow-list and
 * the size budget without a browser. Returns `null` when the response carried
 * none of them, so a request record gains no key at all rather than an empty
 * object on every image.
 *
 * @param {{name: string, value?: string}[]} headers  what webRequest handed over
 * @returns {Record<string, string>|null}
 */
export function pickSecurityHeaders(headers) {
  if (!Array.isArray(headers)) return null;
  const out = {};
  for (const h of headers) {
    const name = String(h?.name || '').toLowerCase();
    if (!SECURITY_HEADERS.includes(name)) continue;
    // A repeated header is kept once. Two Content-Security-Policy headers is a
    // real configuration and the browser intersects them; the record says what
    // it saw first and does not pretend to do the intersection.
    if (out[name] !== undefined) continue;
    const value = String(h?.value ?? '');
    out[name] = value.length > VALUE_MAX ? value.slice(0, VALUE_MAX) + TRUNCATED : value;
  }
  if (!Object.keys(out).length) return null;

  // The whole-record budget: each pass cuts a quarter off the longest value, bounded; the ellipsis stays.
  for (let guard = 0; guard < 40 && bytesOf(JSON.stringify(out)) > RECORD_MAX; guard++) {
    let longest = null;
    for (const [name, value] of Object.entries(out)) {
      if (!longest || value.length > out[longest].length) longest = name;
    }
    if (!longest) break;
    const stripped = out[longest].endsWith(TRUNCATED) ? out[longest].slice(0, -TRUNCATED.length) : out[longest];
    const next = stripped.slice(0, Math.max(16, Math.floor(stripped.length * 0.75)));
    if (next.length >= stripped.length) break;
    out[longest] = next + TRUNCATED;
  }
  return out;
}

/** How many responses are remembered at once; the oldest go first, and losing one costs a row its headers, never a session its events. */
const REMEMBER = 400;

/** The window id standing for "any window" (a session that did not name one). */
const ANY = -1;
const WINDOWS_KEY = 'uqa.secHeaders.windows';
const SEEN_KEY = 'uqa.secHeaders.seen';
const SAVE_MS = 750;
/** r3-07-5: only documents are persisted (the rows read nothing else), the newest few; a busy page no longer rewrites the whole map. */
const DOC = /^(main|sub)_frame$/;
const SAVE_MAX = 50;

/** requestId -> the allow-listed headers of that response (and the window it belongs to). */
const seen = new Map();
/** The windows being watched. Persisted in storage.session so a worker that went to sleep still knows. */
const windows = new Set();
/** tabId -> windowId, so a busy page does not cost a tabs.get per response. Bounded. */
const tabWindow = new Map();
let listener = null;
let isReady = false;
let saveTimer = null;
/** r4-06-4: bumped by every disarm, so a restore that resolves late cannot bring back what was disarmed before it. */
let generation = 0;
/** Windows disarmed one by one during the restore read. */
const goneDuringRestore = new Set();

const chromeApi = () => globalThis.chrome;

/** The seen map, after a pause. All a response needs: the window set did not change (r2-07-1). */
function scheduleSeen() {
  if (!chromeApi()?.storage?.session || saveTimer != null) return;
  const t = /** @type {any} */ (setTimeout(() => { saveTimer = null; saveSeen(); }, SAVE_MS));
  t.unref?.(); // node (the tests) only; a worker timer is a number
  saveTimer = t;
}

/** The window set now (arm, disarm, restore, flushPersist only), the (larger) seen map after a pause. */
function persist() {
  const c = chromeApi();
  if (!c?.storage?.session) return Promise.resolve();
  const p = c.storage.session.set({ [WINDOWS_KEY]: [...windows] }).catch(() => {});
  scheduleSeen();
  return p;
}
const saveSeen = () => chromeApi()?.storage?.session?.set({ [SEEN_KEY]: [...seen].filter(([, v]) => DOC.test(v.type)).slice(-SAVE_MAX) }).catch(() => {}) ?? Promise.resolve();

/** Write everything now (the tests). */
export async function flushPersist() {
  if (saveTimer != null) { clearTimeout(saveTimer); saveTimer = null; }
  await Promise.all([persist(), saveSeen()]);
}

async function windowOf(details) {
  if (!(details.tabId >= 0)) return null;
  if (tabWindow.has(details.tabId)) return tabWindow.get(details.tabId);
  let w = null;
  try { w = (await chromeApi().tabs.get(details.tabId))?.windowId ?? null; } catch { /* the tab is gone */ }
  if (tabWindow.size >= 200) tabWindow.delete(tabWindow.keys().next().value);
  tabWindow.set(details.tabId, w);
  return w;
}

// r4-02-4: a tab that moved window or went away must not keep answering with the old window.
const dropTab = (tabId) => { tabWindow.delete(tabId); };
for (const ev of ['onAttached', 'onDetached', 'onRemoved']) chromeApi()?.tabs?.[ev]?.addListener(dropTab);

/** The one listener: non-blocking, gated per call by the window set. */
async function onHeaders(details) {
  if (!isReady) await restored;
  if (!windows.size) return;
  const headers = pickSecurityHeaders(details.responseHeaders);
  if (!headers) return;
  const w = await windowOf(details);
  if (!windows.has(ANY) && (w == null || !windows.has(w))) return;
  if (seen.size >= REMEMBER) seen.delete(seen.keys().next().value);
  seen.set(details.requestId, { url: redact(details.url).text, headers, ts: Date.now(), type: details.type, w });
  if (DOC.test(details.type)) scheduleSeen();
}

/** Listener iff armed AND any host origin held (getAll, not contains(<all_urls>): a per-site grant counts). No getAll, or a getAll that rejects: fails closed, no listener (r2-12-5, D-1010-34, D-1010-135). */
async function syncOnce() {
  const c = chromeApi();
  let held = false;
  if (windows.size && c?.permissions?.getAll) held = await c.permissions.getAll().then((g) => !!g?.origins?.length, () => false);
  if (windows.size && held) ensureListener(); else dropListener();
}

// D-1010-135: one sync in flight; a call during it only marks it dirty, so the last state always wins.
let syncing = null;
let syncDirty = false;
function syncListener() {
  if (syncing) { syncDirty = true; return syncing; }
  syncing = (async () => {
    try {
      do { syncDirty = false; try { await syncOnce(); } catch { dropListener(); } } while (syncDirty);
    } finally { syncing = null; }
  })();
  return syncing;
}

/** Register the listener once; the window set does the gating. */
function ensureListener() {
  const c = chromeApi();
  if (listener || !c?.webRequest?.onHeadersReceived) return false;
  listener = onHeaders;
  c.webRequest.onHeadersReceived.addListener(/** @type {any} */ (listener), { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame'] }, ['responseHeaders']);
  return true;
}

function dropListener() {
  if (listener && chromeApi()?.webRequest?.onHeadersReceived) {
    try { chromeApi().webRequest.onHeadersReceived.removeListener(listener); } catch { /* already gone */ }
  }
  listener = null;
}

/** Read back the last worker lifetime (merging, so an early arm() survives); idle after the read drops the listener. */
export const restored = (async () => {
  const gen = generation;
  try {
    const got = (await chromeApi()?.storage?.session?.get([WINDOWS_KEY, SEEN_KEY])) || {};
    if (gen !== generation) throw new Error('disarmed while restoring');
    for (const w of Array.isArray(got[WINDOWS_KEY]) ? got[WINDOWS_KEY] : []) if (Number.isInteger(w) && !goneDuringRestore.has(w)) windows.add(w);
    if (windows.size) {
      for (const [id, v] of Array.isArray(got[SEEN_KEY]) ? got[SEEN_KEY] : []) {
        if (!seen.has(id) && v && typeof v === 'object' && !goneDuringRestore.has(Number.isInteger(v.w) ? v.w : ANY)) seen.set(id, v);
      }
      while (seen.size > REMEMBER) seen.delete(seen.keys().next().value);
    }
  } catch { /* storage.session unavailable: start empty */ }
  if (goneDuringRestore.size && windows.size) persist();
  goneDuringRestore.clear();
  isReady = true;
  await syncListener();
})();

// D-1010-01: no listener at load (Chrome flags one without a host origin); it follows the grants.
chromeApi()?.permissions?.onAdded?.addListener(() => { if (windows.size) syncListener(); });
chromeApi()?.permissions?.onRemoved?.addListener(() => { syncListener(); });

/** Start watching a window (null: any). Additive: a second window keeps the first one's entries; one listener only. */
export function arm(windowId) {
  if (!chromeApi()?.webRequest?.onHeadersReceived) return false;
  const key = Number.isInteger(windowId) ? windowId : ANY;
  // A new session in a window starts its record afresh.
  if (windows.has(key)) for (const [id, v] of seen) if (key === ANY || v.w === key) seen.delete(id);
  windows.add(key);
  syncListener();
  persist();
  return true;
}

/** Stop watching: one window (forgetting only its entries), or with no argument everything. */
export function disarm(windowId) {
  if (windowId === undefined) {
    generation++;
    windows.clear();
    seen.clear();
    tabWindow.clear();
    dropListener();
  } else {
    if (!isReady) goneDuringRestore.add(Number.isInteger(windowId) ? windowId : ANY);
    windows.delete(Number.isInteger(windowId) ? windowId : ANY);
    for (const [id, v] of seen) if (v.w === windowId) seen.delete(id);
    if (!windows.size) { seen.clear(); dropListener(); }
  }
  persist();
}

/** Whether anything is being watched right now. For the tests and for Settings. */
export const isArmed = () => windows.size > 0;

/**
 * Everything remembered, oldest first, for the fine-print check to read.
 *
 * The check wants one question answered per host: what did this site send back.
 * So the fold is per URL rather than per request, and the document's own
 * response is the one that matters most, which is why `main_frame` and
 * `sub_frame` are marked.
 */
export function snapshot() {
  return [...seen.values()].map(({ url, headers, type }) => ({ url, headers, type }));
}
