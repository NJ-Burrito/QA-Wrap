/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Shared leaf helpers of the service worker: the console tag, string helpers, the handler registry, the active-session lookup, i18n and menu refresh. Moved out of service-worker.js (OF-18), unchanged. */

import { MARK_URL } from './signature.js';
import * as armed from './armed.js';
import * as chat from './notify.js';
import { buildContextMenus } from './context-menus.js';

/** The message table. Filled by `service-worker.js` (`Object.assign`), read by the handlers and by `stopSession`. */
export const handlers = {};

// The Evidence Tag: compact twin of platform/console-brand.js (boot graph at its ceiling). The one banner is signConsole().
export const QAConsole = (() => {
  const c = (b, f) => `background:${MARK_URL} no-repeat 4px 50%/11px,${b};color:${f};font-weight:700;border-radius:3px;padding-left:16px`;
  const say = (l, ...a) => { try { console[l]('%c QA Wrap %c', c(l === 'info' ? '#1D2024' : '#B5432B', l === 'info' ? '#C9CDD2' : '#F1EFE9'), '', ...a); } catch {} };
  return { info: (...a) => say('info', ...a), warn: (...a) => say('warn', ...a) };
})();

/** A count and its noun, agreeing. */
export const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

export const ACTIVE = 'activeSessionId';

export const LAST = 'lastSessionId';

export const DISMISSED = 'dismissedSessionId';

// r6-07-6: cached in armed.js (dropped by storage.session.onChanged and by the two writers below).
export async function sessionsByWindow() { return armed.sessionMap(); }

/**
 * One hint, built the same way at every call site.
 */
export function hintFor(msg, sender) {
  if (msg?.windowId != null) return msg.windowId;
  if (msg?.tabId != null) return { tabId: msg.tabId };
  return sender;
}

/** The window a hint is about: a number, a `{windowId}`, a `{tabId}`, or a sender. */
export async function windowOf(hint) {
  if (hint == null) return null;
  if (typeof hint === 'number') return hint;
  if (hint.windowId != null) return hint.windowId;
  const tabId = hint.tabId ?? hint.tab?.id ?? null;
  if (tabId == null) return null;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return tab?.windowId ?? null;
}

export async function activeSessionId(hint) {
  const map = await sessionsByWindow();
  const ids = Object.values(map).filter(Boolean);
  if (!ids.length) return null;
  // One session is one answer, whoever is asking. This is the path every
  // existing caller takes and it costs one storage read, as it always did.
  if (ids.length === 1) return ids[0];

  const windowId = await windowOf(hint);
  if (windowId != null && map[windowId]) return map[windowId];

  const { [ACTIVE]: last } = await chrome.storage.session.get(ACTIVE);
  return last && ids.includes(last) ? last : ids[ids.length - 1];
}

/** The session of exactly this window, or null: what a toggle acts on (r3-09-1). */
export const sessionIn = (map, windowId) => (windowId == null ? null : map[windowId] || null);

/** Every session recording right now, oldest window first. */
export async function liveSessionIds() {
  return Object.values(await sessionsByWindow()).filter(Boolean);
}

/** Extension pages and browser-internal pages are never part of the tested app. */
export function isInternalUrl(url) {
  // chrome-extension pages are internal, except this extension's packaged practice page (testable).
  return !url || /^(chrome|chrome-error|chrome-extension(?!:[/][/][a-p]{32}[/]practice[/])|edge|about|devtools|moz-extension):/.test(url);
}

export const own = (path) => fetch(chrome.runtime.getURL(path));

/** Worker-side catalog lookup in the tester's language; the English literal is the fallback. */
export const DISK_WARN = 'uqa.diskWarn';

let twCat = null;
export const dropCat = () => { twCat = null; };

export async function tw(key, fallback) {
  try {
    const { qawLanguage: pick } = await chrome.storage.sync.get('qawLanguage');
    const lang = pick === 'en' || pick === 'ar' ? pick : /^ar/i.test(chrome.i18n.getUILanguage()) ? 'ar' : 'en';
    // Memoised per language: the menu asks for forty strings in one build.
    if (twCat?.lang !== lang) twCat = { lang, cat: await own(`platform/i18n/${lang}.json`).then((r) => r.json()) };
    return twCat.cat[key] || fallback;
  } catch { return fallback; }
}

/** A desktop notification in the tester's language (T-053). */
export const announceL = async (subject, titleKey, title, note, args) =>
  chat.announce(subject, await tw(`common.worker.note.${titleKey}`, title), await chat.noteL(tw, note, args));

/** A refusal's sentence in the tester's language, by its code; otherwise the message as thrown. */
export const refusalText = (err) => tw(`popup.refusal.${String(err?.code || '').toLowerCase().replace(/_(.)/g, (_m, c) => c.toUpperCase())}`, String(err?.message || err));

/* ------------------------------------------------------------ right-click */

/** Which window a message came from. */
function withDeadline(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function currentWindowId(sender) {
  if (sender?.tab?.windowId != null) return sender.tab.windowId;

  const focused = await withDeadline(chrome.windows.getCurrent(), 500, null);
  if (focused?.id != null) return focused.id;

  // Last resort: whichever normal tab is active. This is the path a popup takes
  // when the window manager will not say which window has focus.
  const [tab] = await withDeadline(chrome.tabs.query({ active: true, lastFocusedWindow: true }), 500, []);
  return tab?.windowId ?? null;
}

/** An Error the page can branch on: `code` and `data` travel with `error`. */
export function coded(message, code, data) {
  return Object.assign(new Error(message), { code, data });
}

/** The menu's "Start recording" has to say "Stop" once it is running. */
export async function refreshMenus() {
  await buildContextMenus({ recording: !!(await activeSessionId()) });
}
