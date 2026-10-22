/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** The master switch: nothing happens until you wake it, and only in the window you woke (per window, not per extension). */

import { on } from '../core/on.js';
import { siteMatches } from './site-access.js';
import { heavySpecs, HEAVY_IDS, injectHeavy } from './site-access.js';

const KEY = 'armedWindows';

/** Windows whose sleep has started but not finished: asleep to every reader at once, in memory only (a dead worker falls back to storage). */
const goingToSleep = new Set();

/** Sleep has begun here: the window is no longer awake, whatever storage says. */
export function beginSleep(windowId) {
  if (windowId != null) goingToSleep.add(windowId);
}

/** The armed set, cached for the worker's life and invalidated exactly (storage.session.onChanged, arm/disarm writes), never by a timer. `goingToSleep` is consulted after it. */
let cached = null;

/** Counted, so `tools/test-speed.mjs` can measure this rather than assert it. */
const stats = { reads: 0, hits: 0, tabReads: 0, tabHits: 0, mapReads: 0, mapHits: 0 };

/** For the tests, and for anyone measuring. */
export function cacheStats() {
  return { ...stats };
}

function watchStorage() {
  chrome.storage?.session?.onChanged?.addListener?.((changes) => {
    if (KEY in changes) cached = null;
    if (MAP_KEY in changes) dropSessionMap();
  });
}

/** r6-07-6: the window -> session map, read once per worker life; dropped by onChanged and by the worker's own writes. Callers get a copy. */
const MAP_KEY = 'activeSessionsByWindow';
let sessMap = null;
let sessGen = 0;
export function dropSessionMap() { sessMap = null; sessGen++; }
export async function sessionMap() {
  if (sessMap) { stats.mapHits++; return { ...sessMap }; }
  stats.mapReads++;
  const gen = sessGen;
  const { [MAP_KEY]: m } = await chrome.storage.session.get(MAP_KEY);
  const map = m && typeof m === 'object' ? m : {};
  if (gen === sessGen) sessMap = map;
  return { ...map };
}

async function read() {
  if (cached) {
    stats.hits++;
    return cached;
  }
  stats.reads++;
  const got = await chrome.storage.session.get(KEY);
  const list = /** @type {string[]|undefined} */ (got[KEY]);
  cached = new Set(list || []);
  return cached;
}

async function write(set) {
  cached = new Set(set);
  await chrome.storage.session.set({ [KEY]: [...set] });
}

/** Which window a tab is in, remembered (saves a chrome.tabs.get per event). Exact: onAttached, onDetached, onRemoved and onReplaced drop it. No eviction: the worker is torn down after 30 idle seconds. */
const tabWindows = new Map();

function watchTabs() {
  chrome.tabs?.onRemoved?.addListener?.((tabId) => tabWindows.delete(tabId));
  chrome.tabs?.onAttached?.addListener?.((tabId, info) => tabWindows.set(tabId, info.newWindowId));
  chrome.tabs?.onDetached?.addListener?.((tabId) => tabWindows.delete(tabId));
  // A replaced tab is a new id for the same window: forget both.
  chrome.tabs?.onReplaced?.addListener?.((added, removed) => {
    tabWindows.delete(removed);
    tabWindows.delete(added);
  });
}

async function windowOfTab(tabId) {
  if (tabWindows.has(tabId)) {
    stats.tabHits++;
    return tabWindows.get(tabId);
  }
  stats.tabReads++;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return null;
  tabWindows.set(tabId, tab.windowId);
  return tab.windowId;
}

/* ── the MAIN-world hooks, which exist only while somebody is awake ─────── */

/** `content/page-hooks.js` (MAIN world) is registered when the first window wakes and removed when the last sleeps; `persistAcrossSessions: false` because arming is wiped at browser close. Open tabs are injected by hand. */
const HOOKS_ID = 'uqa-page-hooks';

/** The hooks register on exactly the granted origins (`siteMatches()`, `<all_urls>` when everything is granted). */
/** @returns {chrome.scripting.RegisteredContentScript} */
function hooksSpec(matches) {
  return {
    id: HOOKS_ID,
    js: ['content/page-hooks.js'],
    matches: [...matches],
    allFrames: true,
    runAt: /** @type {const} */ ('document_start'),
    world: /** @type {const} */ ('MAIN'),
    matchOriginAsFallback: true, // D-1010-163: srcdoc, blob: and data: frames take their creator's origin
    persistAcrossSessions: false,
  };
}

// The hooks and the heavy page scripts (T-075, `site-access.js`) share one lifetime: awake only.
const registeredIds = async () =>
  ((await chrome.scripting?.getRegisteredContentScripts?.({ ids: [HOOKS_ID, ...HEAVY_IDS] }).catch(() => [])) || []).map((s) => s.id);

/** Put the hooks and heavy scripts into the open tabs of one window; every failure (chrome:// tab, navigated tab) is ordinary. */
async function injectInto(windowId) {
  if (windowId == null || !chrome.scripting?.executeScript) return 0;
  const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
  const done = await Promise.all(
    tabs.map(async (tab) => {
      // A tab on a site nobody granted refuses injection anyway; skipping it
      // here is what keeps the console clean rather than what makes it safe.
      if (tab.id == null || !/^https?:|^file:/.test(tab.url || '')) return 0;
      const hooked = chrome.scripting
        .executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['content/page-hooks.js'],
          world: 'MAIN',
          injectImmediately: true,
        })
        .then(() => 1)
        .catch(() => 0);
      await injectHeavy(tab.id);
      return hooked;
    })
  );
  return done.reduce((a, b) => a + b, 0);
}

/** None › some. Called before the wake is announced, so the push finds a listener. */
async function registerHooks() {
  if (!chrome.scripting?.registerContentScripts) return false;
  const matches = await siteMatches();
  // Nothing granted is not a failure and not a warning: it is a tester who has
  // woken QA Wrap on a page they have not allowed it on yet, and the refusal
  // they need is `NOT_ALLOWED`, said by the tool they press — not a log line.
  if (!matches.length) return false;
  // The granted set can widen while a window is already awake ("All sites",
  // pressed on the second site of the day). Updating is what carries the
  // hooks to the new origins without disturbing the ones already covered.
  /** @type {chrome.scripting.RegisteredContentScript[]} */
  const specs = [hooksSpec(matches), ...heavySpecs(matches)];
  const have = new Set(await registeredIds());
  const old = specs.filter((x) => have.has(x.id));
  if (old.length) await chrome.scripting.updateContentScripts(old).catch(() => {});
  const add = specs.filter((x) => !have.has(x.id));
  if (!add.length) return true;
  try {
    await chrome.scripting.registerContentScripts(add);
    return true;
  } catch (err) {
    // "Duplicate script ID" is another worker lifetime having got there first,
    // which is the state we wanted. Anything else is worth a line in the log
    // and is not worth refusing to wake over: the ISOLATED scripts still work
    // and the tester loses request bodies, not the session.
    if (/duplicate|already/i.test(String(err?.message || err))) return true;
    console.warn('[QA Wrap] the page hooks could not be registered:', err);
    return false;
  }
}

/** Some › none. The last window asleep means nothing of ours is left in a page. */
async function unregisterHooks() {
  if (!chrome.scripting?.unregisterContentScripts) return;
  await chrome.scripting.unregisterContentScripts({ ids: [HOOKS_ID, ...HEAVY_IDS] }).catch(() => {});
}

/** Make the registration agree with the arming on every worker start (a worker can die between arm() and the registration landing). */
export async function syncHooks({ inject = false } = {}) {
  const wins = await armedWindows();
  const awake = wins.length > 0;
  const registered = (await registeredIds()).length > 0;
  // Awake and already registered still goes through `registerHooks()`, because
  // the matches are now a granted set that can have changed since: it updates
  // rather than re-registers in that case. See `hooksSpec`.
  if (awake) {
    await registerHooks();
    // A grant made while awake: the tabs already open have no heavy scripts yet.
    if (inject) for (const w of wins) await injectInto(w);
  } else if (registered) await unregisterHooks();
  return awake;
}

/** Every window the tester has woken this extension in. */
export async function armedWindows() {
  return [...(await read())].filter((id) => !goingToSleep.has(id));
}

export async function isArmedWindow(windowId) {
  if (windowId == null) return false;
  // A window on its way down is asleep to everyone who asks. See
  // `goingToSleep`: this is what stops a mid-teardown answer repainting the
  // switch Awake, and it is the same "no" the capability gate wants, since
  // nothing new should start in a window that is being shut down.
  if (goingToSleep.has(windowId)) return false;
  return (await read()).has(windowId);
}

/** Whether a given tab is covered. Asked on every event, so one storage read and one tab lookup; fails closed (a gone tab or unresolved window is not armed). */
export async function isArmedTab(tabId) {
  if (tabId == null) return false;
  const windowId = await windowOfTab(tabId);
  if (windowId == null) return false;
  return isArmedWindow(windowId);
}

/** Consent notice revision (T-042). A bump blocks new wakes only, never a live window; older accepts count as 1. */
export const CONSENT_REVISION = 1;

export async function consentCurrent() {
  const local = globalThis.chrome?.storage?.local;
  if (!local) return true; // test harness; real Chrome always has it
  const { consentedAt = null, consentRevision = 1 } = await local.get(['consentedAt', 'consentRevision']);
  return !!consentedAt && Number(consentRevision) >= CONSENT_REVISION;
}

/**
 * The one gate before a write. hint: sender, {tabId} or {windowId}; belongs(tabId) is the
 * session's window membership. Throws with `code` and the `reason` ingest() returns.
 * @param {any} hint
 * @param {{ consent?: boolean, belongs?: (tabId: number) => boolean | Promise<boolean> }} [opts]
 */
export async function assertMayRecord(hint, { consent = false, belongs } = {}) {
  const no = (code, reason, m) => { throw Object.assign(new Error(m), { code, reason }); };
  if (consent && !(await consentCurrent())) no('NEEDS_CONSENT', 'needs-consent', 'Accept the QA Wrap notice first (Settings, welcome page).');
  const tabId = hint?.tab?.id ?? hint?.tabId ?? null;
  if (tabId != null) {
    if (!(await isArmedTab(tabId))) no('ASLEEP', 'asleep', ASLEEP);
    if (belongs && !(await belongs(tabId))) no('OTHER_WINDOW', 'other-tab', 'That tab is not in this session.');
  } else if (hint?.windowId != null && !consent && !(await isArmedWindow(hint.windowId))) no('ASLEEP', 'asleep', ASLEEP);
}

/** `inherit`: a size-run window opened from an armed one is not a new wake. */
export async function arm(windowId, { inherit = false } = {}) {
  if (!inherit) await assertMayRecord({ windowId }, { consent: true });
  // Waking cancels a sleep that is still in flight, so a wake that overtakes
  // one is not left invisible behind the marker.
  goingToSleep.delete(windowId);
  const set = await read();
  set.add(windowId);
  await write(set);
  // Registered before this returns, and therefore before the caller announces
  // the wake: `content/bridge.js` answers `UQA_ARMED_CHANGED` by pushing
  // "awake" into the MAIN world, and a push that arrives before the hooks do
  // is a push nothing hears. Existing tabs are injected for the same reason —
  // registration only reaches the next navigation.
  await registerHooks();
  await injectInto(windowId);
  return [...set];
}

export async function disarm(windowId) {
  const set = await read();
  set.delete(windowId);
  await write(set);
  // Storage now says what `beginSleep` has been saying since the press, so the
  // marker has nothing left to cover.
  goingToSleep.delete(windowId);
  // Some › none only. A second armed window still needs the hooks; see the
  // note on HOOKS_ID for why this is a refcount and not a toggle.
  if (!set.size) await unregisterHooks();
  return [...set];
}

/** Stop of a session: sleep the windows followFocus woke for it (and tell their tabs), not the window Start was pressed in. */
export async function releaseJoined(ids = []) {
  for (const w of ids) {
    await disarm(w).catch(() => {});
    for (const t of await chrome.tabs.query({ windowId: w }).catch(() => [])) if (t.id != null) chrome.tabs.sendMessage(t.id, { type: 'UQA_ARMED_CHANGED', armed: false }).catch(() => {});
  }
}

export async function disarmAll() {
  await chrome.storage.session.remove(KEY);
  goingToSleep.clear();
  await unregisterHooks();
  return [];
}

/**
 * A window that closes takes its arming with it.
 *
 * Window ids are reused by Chrome, so a stale entry would silently arm whatever
 * window inherited the number next — which is the opposite of asleep-by-default.
 */
export function watchWindows() {
  // Through `on()`, like every other async listener: a storage read that fails
  // here is a window that stays armed after it closed, and an unwrapped async
  // listener would have reported that only as a red badge on the extension's
  // card with no text behind it.
  on(chrome.windows?.onRemoved, 'windows.onRemoved › forget arming', async (windowId) => {
    goingToSleep.delete(windowId);
    const set = await read();
    if (set.delete(windowId)) await write(set);
    // Closing the last armed window is the same "some › none" as sleeping it.
    // Without this, shutting the window instead of pressing Sleep left the
    // page hooks registered for every page in every other window.
    if (!set.size) await unregisterHooks();
  });

  // The two caches, invalidated by the events that change their answers rather
  // than by a timer. Registered from here because `watchWindows()` is what the
  // worker calls once at the top level, and a listener registered any later
  // would miss a change that happened before it.
  watchStorage();
  watchTabs();

  // Every worker start, not only the first. See syncHooks().
  syncHooks().catch(() => {});
}

/** The refusal a feature gives when it is asked to act on a sleeping window. */
export const ASLEEP =
  'QA Wrap is asleep in this window. Click the icon and press "Wake it up". ' +
  'Nothing is recorded, hooked or read until you do.';

export const asleepError = () => Object.assign(new Error(ASLEEP), { code: 'ASLEEP' });
