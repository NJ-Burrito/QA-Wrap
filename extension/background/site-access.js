/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Which sites this extension has been let into, and what it puts in them.
 * `<all_urls>` is a required host permission (ui-1019: Start is the consent). The page scripts are registered here, not in the
 * manifest; one function, `syncSiteScripts()`, recomputes the registration from `permissions.getAll()` at every worker start and on
 * `permissions.onAdded` / `onRemoved`.
 */

import { on } from '../core/on.js';

/** What every tool says when asked to work where it was never let in: one fact and the press that fixes it, in plain words (no "host permission"). */
export const NOT_ALLOWED = 'QA Wrap is not allowed on this site yet. Wake up here to allow it.';
/** The refusal as an error with a code, so the worker can say it in the tester's language (D-1010-172). */
export const notAllowedError = () => Object.assign(new Error(NOT_ALLOWED), { code: 'NOT_ALLOWED' });

/** The pattern for one page's origin: scheme and host, never the path. `null` for pages that cannot carry a content script (chrome://, about:, data:). */
export function originPattern(url) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === 'file:') return 'file:///*';
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return `${parsed.protocol}//${parsed.host}/*`;
}

/** The packaged practice page (extension/practice/): a page QA Wrap may test without any site grant. */
export const isPracticeUrl = (u) => typeof u === 'string' && u.startsWith(chrome.runtime?.getURL?.('practice/') || '\0');
/** A page a session can run on: a web page, a file, or the practice page (which carries its own copy of the recorder; Chrome refuses executeScript on extension pages). */
export const pageLike = (u) => /^https?:|^file:/.test(u || '') || isPracticeUrl(u);

/** Every origin the tester has let this extension into. */
export async function grantedOrigins() {
  const all = await chrome.permissions?.getAll?.().catch(() => null);
  return all?.origins || [];
}

/** May we work on this page? True for this extension's own pages (never told to press Wake); fails closed elsewhere, an unparseable URL is a no. */
export async function hasSiteAccess(url) {
  if (!url) return false;
  if (url.startsWith(chrome.runtime?.getURL?.('') || 'chrome-extension://')) return true;
  const pattern = originPattern(url);
  if (!pattern) return false;
  return (await chrome.permissions?.contains?.({ origins: [pattern] }).catch(() => false)) || false;
}

/** The two script sets that used to be manifest content_scripts (tools/test-permissions.mjs pins the list). */
/** @type {readonly chrome.scripting.RegisteredContentScript[]} */
export const SITE_SCRIPTS = Object.freeze(/** @type {chrome.scripting.RegisteredContentScript[]} */ ([
  {
    id: 'uqa-site-start',
    js: ['content/selector-engine.js', 'content/replay-buffer.js', 'content/bridge.js', 'content/recorder.js', 'content/ui-host.js'],
    css: ['content/overlay.css'],
    allFrames: true,
    runAt: 'document_start',
    world: 'ISOLATED',
  },
  {
    id: 'uqa-site-idle',
    js: ['content/mask.js', 'content/replay-recorder.js', 'content/vitals.js', 'content/checks.js', 'content/keymap.js', 'content/autopilot.js'],
    allFrames: true,
    runAt: 'document_idle',
    world: 'ISOLATED',
  },
]));

/** T-075: only the cheap half (`bridge.js`) stays registered while asleep; the full set is `heavySpecs()`, registered by `armed.js` on none > some. */
const CHEAP = { 'uqa-site-start': ['content/bridge.js'] };
const SITE_IDS = Object.keys(CHEAP);
export const HEAVY_IDS = SITE_SCRIPTS.map((s) => `${s.id}-heavy`);

/** The full former set under the heavy ids. Not persisted: arming is not (see `armed.js`). */
/** @returns {chrome.scripting.RegisteredContentScript[]} */
export const heavySpecs = (matches) =>
  SITE_SCRIPTS.map((s) => ({ ...s, id: `${s.id}-heavy`, matches: [...matches], matchOriginAsFallback: true, persistAcrossSessions: false }));

const cheapSpecs = (matches) =>
  SITE_SCRIPTS.filter((s) => CHEAP[s.id]).map((s) => ({
    id: s.id, js: CHEAP[s.id], allFrames: s.allFrames, runAt: s.runAt, world: s.world, matches: [...matches], matchOriginAsFallback: true,
  }));

/** The matches a registration gets: the granted list, collapsed if it is everything. */
export async function siteMatches() {
  const origins = await grantedOrigins();
  return origins.includes('<all_urls>') ? ['<all_urls>'] : origins;
}

/**
 * Make the registration equal the grant, every time. `persistAcrossSessions` stays true on purpose: a permission outlives the
 * browser, and re-registering at launch would leave the first restored tab without a recorder; this reconcile removes an origin
 * revoked while the browser was shut.
 */
export async function syncSiteScripts() {
  if (!chrome.scripting?.registerContentScripts) return { matches: [], changed: false };
  const matches = await siteMatches();

  const existing = await chrome.scripting
    .getRegisteredContentScripts({ ids: [...SITE_IDS, 'uqa-site-idle', ...HEAVY_IDS] })
    .catch(() => []);
  const have = new Map((existing || []).map((s) => [s.id, s]));

  if (!matches.length) {
    if (have.size) await chrome.scripting.unregisterContentScripts({ ids: [...have.keys()] }).catch(() => {});
    return { matches: [], changed: have.size > 0 };
  }

  const wanted = cheapSpecs(matches);
  if (have.has('uqa-site-idle')) await chrome.scripting.unregisterContentScripts({ ids: ['uqa-site-idle'] }).catch(() => {});
  const key = (a) => [[...(a.matches || [])].sort(), a.js, a.css || [], [String(!!a.matchOriginAsFallback)]].map((x) => x.join('|')).join('#');
  const same = (a, b) => !!a && key(a) === key(b);

  const add = wanted.filter((spec) => !have.has(spec.id));
  const update = wanted.filter((spec) => have.has(spec.id) && !same(have.get(spec.id), spec));

  try {
    if (add.length) await chrome.scripting.registerContentScripts(add);
    if (update.length) await chrome.scripting.updateContentScripts(update);
  } catch (err) {
    // A duplicate id is another worker lifetime having won the race: the state we wanted.
    if (!/duplicate|already/i.test(String(err?.message || err))) {
      console.warn('[QA Wrap] the page scripts could not be registered:', err);
    }
  }
  return { matches, changed: add.length > 0 || update.length > 0 };
}

/** Registration only reaches the next navigation, so put the cheap half into the tabs already open in a window. Every failure is ordinary. */
export async function injectSiteScripts(windowId) {
  if (!chrome.scripting?.executeScript) return 0;
  const tabs = await chrome.tabs.query(windowId == null ? {} : { windowId }).catch(() => []);
  const done = await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null || !(await hasSiteAccess(tab.url || ''))) return 0;
      if (!/^https?:|^file:/.test(tab.url || '')) return 0;
      // Cheap half only (T-075): the rest goes in at wake, `injectHeavy`.
      return chrome.scripting
        .executeScript({ target: { tabId: tab.id, allFrames: true }, files: CHEAP['uqa-site-start'], world: 'ISOLATED' })
        .then(() => 1)
        .catch(() => 0);
    })
  );
  return done.reduce((a, b) => a + b, 0);
}

/** The heavy half into one open tab, at wake. Every script is a guarded IIFE, so repeating is free. */
export async function injectHeavy(tabId) {
  for (const spec of SITE_SCRIPTS) {
    await chrome.scripting
      .executeScript({ target: { tabId, allFrames: true }, files: spec.js, world: 'ISOLATED' })
      .catch(() => {});
    if (spec.css) await chrome.scripting.insertCSS?.({ target: { tabId, allFrames: true }, files: spec.css })?.catch(() => {});
  }
}

/**
 * ui-1020: the Jira helper on every http(s) page, no press (host access is granted at install). The scripts decide: helper.js and
 * scrollfix.js do nothing unless the page is Jira (*.atlassian.net, application-name JIRA / body#jira on Server and Data Center,
 * or the address typed in Settings, which helper.js compares itself). So registration no longer depends on the typed address.
 */
export async function syncJiraScripts() {
  if (!chrome.scripting?.registerContentScripts) return;
  const matches = ['https://*/*', 'http://*/*'];
  const specs = /** @type {any[]} */ ([
    { id: 'qaw-jira', matches, js: ['jira/helper.js'], css: ['jira/helper.css'], runAt: 'document_start' },
    { id: 'qaw-jira-main', matches, js: ['jira/scrollfix.js'], runAt: 'document_start', world: 'MAIN' },
  ]);
  const have = await chrome.scripting.getRegisteredContentScripts({ ids: specs.map((x) => x.id) }).catch(() => []);
  const key = (m) => [...(m || [])].sort().join('|');
  const stale = specs.filter((x) => have.some((h) => h.id === x.id && key(h.matches) !== key(x.matches)));
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale.map((x) => x.id) }).catch(() => {});
  const add = specs.filter((x) => stale.includes(x) || !have.some((h) => h.id === x.id));
  if (add.length) await chrome.scripting.registerContentScripts(add).catch((err) => { if (!/duplicate|already/i.test(String(err?.message || err))) console.warn('[QA Wrap] the Jira helper could not be registered:', err); });
}

/** jira/helper.js storage (local is closed to content scripts), for the asking page's own host only; never the typed address. @param {any} m @param {any} sender */
export async function jiraPage({ dir, pos, api }, sender, st = chrome.storage.local) {
  let h = ''; try { h = new URL(sender.url).host; } catch { /* no page */ }
  if (!h) return null;
  const { qawJira: c = {}, qawJiraDir: d = {}, qawJiraPos: p = {}, qawJiraSeen: s } = /** @type {any} */ (await st.get(['qawJira', 'qawJiraDir', 'qawJiraPos', 'qawJiraSeen']));
  const [[e, v] = []] = Object.entries(pos || {});
  if (dir === 'rtl' || dir === 'ltr') await st.set({ qawJiraDir: { ...d, [h]: dir } });
  if ((e === 'l' || e === 'r') && Number.isFinite(v)) await st.set({ qawJiraPos: { ...p, [h]: { [e]: v } } });
  if ((api === 2 || api === 3) && (s?.last !== h || s.hosts?.[h] !== api)) await st.set({ qawJiraSeen: { last: h, hosts: { ...s?.hosts, [h]: api } } });
  return { rtl: c.rtl !== false, dropdown: c.dropdown !== false, typed: c.host === h, dir: d[h], pos: p[h] };
}

/** One listener pair at the top level of the worker; `onChange` is told after each sync. @param {() => void} [onChange] */
export function watchSiteAccess(onChange) {
  const react = async () => {
    const { changed } = await syncSiteScripts();
    // Only when the registration actually moved: it reaches the next navigation only, so open tabs are out of step.
    if (changed) await injectSiteScripts().catch(() => {});
    await onChange?.();
  };
    syncJiraScripts().catch(() => {});
  on(chrome.permissions?.onAdded, 'permissions.onAdded › register page scripts', react);
  on(chrome.permissions?.onRemoved, 'permissions.onRemoved › drop page scripts', react);
  react().catch(() => {}); // one sync per worker start
}
