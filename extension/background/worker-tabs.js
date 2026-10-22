/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Talking to tabs, frames and pages: which tab a tool may touch, sending to a tab or a feature script, overlays, and the broadcast to extension pages. Moved out of service-worker.js (OF-18), unchanged. */

import * as sessionState from './session-state.js';
import * as armed from './armed.js';
import { publicSettings, redact as maskSecrets } from '../platform/settings.js';
import { withDeadline as bounded } from '../platform/deadline.js';
import * as site from './site-access.js';
import { isInternalUrl, refreshMenus } from './worker-base.js';

/** Every armed page needs the current rule set; they cannot read storage themselves. */
/**
 * Push one session's live rules into the pages that session covers.
 *
 * Scoped by window since G3. A rule armed in window A must not reach window B:
 * the two windows can be running different sessions against different
 * environments, and "break the next three requests" arriving in the wrong one
 * is the override tool doing the one thing it must never do — changing what an
 * application does in a run nobody armed it for.
 *
 * @param {string|null} sessionId whose rules; null means "none, clear them"
 * @param {number|null} windowId  whose pages; null means every armed window,
 *        which is right when no session is running and the message is "clear"
 */
export async function pushRulesToPages(sessionId, windowId = null) {
  const rules = sessionId
    ? (await sessionState.getRules(sessionId)).filter(sessionState.isLive)
    : [];
  const tabs = await chrome.tabs.query(windowId != null ? { windowId } : {});
  await Promise.all(
    tabs.map(async (t) => {
      if (t.id == null || !(await armed.isArmedTab(t.id))) return null;
      return sendToTab(t.id, { type: 'UQA_RULES', rules });
    })
  );
}

/* ------------------------------------------------------------------ messaging */

/**
 * Reach BOTH audiences.
 *
 * chrome.runtime.sendMessage from a service worker is delivered to extension
 * pages (popup, DevTools panel) only — it never reaches content scripts. Those
 * need chrome.tabs.sendMessage, per tab. Miss the second half and the recorder
 * never learns a session started.
 */
const forTab = (msg) =>
  msg?.type === 'UQA_SETTINGS_CHANGED' && msg.settings ? { ...msg, settings: publicSettings(msg.settings) } : msg;

/** Extension pages get masked secrets ("••••last4"), never the values. */
const forPage = (msg) =>
  msg?.type === 'UQA_SETTINGS_CHANGED' && msg.settings ? { ...msg, settings: maskSecrets(msg.settings) } : msg;

export const isExtensionPage = (sender) =>
  sender?.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));

export async function broadcast(msg) {
  // The right-click menu shows "Start recording" or "Stop recording", so it is
  // part of the state that has to stay in step with every other surface.
  if (msg?.type === 'UQA_STATE_CHANGED') refreshMenus().catch(() => {});
  await bounded(tellPages(forPage(msg)), 'tab').catch(() => {});
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs // own pages in a tab (options, report, popup) heard the masked copy; the public one wiped Jira there (integrations-1020)
        .filter((t) => t.id != null && !String(t.url || t.pendingUrl || '').startsWith(chrome.runtime.getURL('')))
        .map((t) => bounded(chrome.tabs.sendMessage(t.id, forTab(msg)), 'tab').catch(() => {}))
    );
  } catch {
    /* tabs unavailable — fine */
  }
}

/**
 * Say something to the extension's own surfaces — popup, float, side panel,
 * DevTools panel, report, options — and to nothing under test.
 *
 * `chrome.runtime.sendMessage` from a worker never reaches a content script, so
 * this half of `broadcast` was always the pages-only half; naming it lets the
 * callers that must NOT touch the pages under test say so.
 */
export async function tellPages(msg) {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    /* no extension page open — fine */
  }
}

export const TESTABLE = { test: (u) => site.pageLike(u) };

/**
 * The tab a page-scoped tool should act on.
 *
 * "The active tab" is wrong whenever the caller is itself an extension page —
 * the panel opened in its own window, the report page, the options page. Prefer
 * the active tab when it is a real page, and otherwise fall back to the most
 * recently active normal tab, which is the one the tester was last looking at.
 */
export async function testableTabId(sender) {
  // A popup opened as a tab — how anybody debugs it, and how the click-through
  // harness runs it — carries `sender.tab`, and its window is the one the
  // tester is looking at. Ask there first. `currentWindow` from a worker means
  // the last *focused* window, which the moment "Check another size" opens one
  // is the new window: every message without a tabId then landed on a tab
  // nobody had touched ("Pick a field first"), and the popup read that
  // window's switch — asleep — and disabled itself, Stop included.
  const home = sender?.tab?.windowId;
  if (home != null) {
    const usable = (await chrome.tabs.query({ windowId: home }).catch(() => [])).filter(
      (t) => t.id != null && t.url && TESTABLE.test(t.url) && !isInternalUrl(t.url)
    );
    const pick =
      usable.find((t) => t.active) || usable.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
    if (pick) return pick.id;
  }

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url && TESTABLE.test(active.url) && !isInternalUrl(active.url)) return active.id;

  const tabs = await chrome.tabs.query({});
  const candidates = tabs
    .filter((t) => t.id != null && t.url && TESTABLE.test(t.url) && !isInternalUrl(t.url))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return candidates[0]?.id ?? null;
}

/** The page a cookie operation applies to. Cookies are scoped by URL, not by tab. */
export async function tabUrl(tabId) {
  const id = tabId ?? (await testableTabId());
  if (id == null) throw new Error('No tab to work on.');
  const tab = await chrome.tabs.get(id).catch(() => null);
  if (!tab?.url) throw new Error('That tab has no address to scope cookies to.');
  if (isInternalUrl(tab.url) || !/^https?:|^file:/.test(tab.url)) {
    throw new Error('Cookies can only be read on a normal http or https page.');
  }
  return tab.url;
}

/** Take the tool's own overlays out of the frame, run something, put them back. */
/**
 * How many operations are currently hiding the overlay on each tab.
 *
 * A count, not a boolean, because three handlers use this and they can overlap:
 * the screenshot, the full-page capture and the script scan. With a boolean the
 * first one to finish un-hid the overlay while another was still photographing,
 * and the extension's own UI landed in the evidence - the exact thing hiding it
 * was meant to prevent.
 */
const overlayHiders = new Map();

export async function withoutOverlays(tabId, fn) {
  const depth = (overlayHiders.get(tabId) || 0) + 1;
  overlayHiders.set(tabId, depth);
  if (depth === 1) {
    await sendToTab(tabId, { type: 'UQA_UI_HIDE', hidden: true }).catch(() => null);
  }
  try {
    return await fn();
  } finally {
    const left = (overlayHiders.get(tabId) || 1) - 1;
    if (left <= 0) {
      overlayHiders.delete(tabId);
      await sendToTab(tabId, { type: 'UQA_UI_HIDE', hidden: false }).catch(() => null);
    } else {
      overlayHiders.set(tabId, left);
    }
  }
}

/** One page-moving operation per tab at a time. */
const pageBusy = new Map();

export async function exclusiveOnTab(tabId, what, fn) {
  const running = pageBusy.get(tabId);
  if (running) {
    throw new Error(
      `${running} is still running on this tab. Wait for it to finish, then try again: ` +
        'two of these at once would move the page under each other and spoil both.'
    );
  }
  pageBusy.set(tabId, what);
  try {
    return await fn();
  } finally {
    pageBusy.delete(tabId);
  }
}

/**
 * Where a session's masks are kept.
 *
 * `chrome.storage.session` and not `local`: masked values are the most
 * sensitive thing the product ever holds a reference to, and session storage
 * is cleared by the browser when it closes rather than left on disk.
 */
export const maskKey = (sessionId) => `masks:${sessionId}`;

/** What survives the session: a descriptor, never the thing that was covered. */
export function redactedMaskList(entries) {
  return (Array.isArray(entries) ? entries : []).slice(0, 500).map((m) => ({
    page: typeof m?.page === 'string' ? m.page.slice(0, 300) : '',
    tag: typeof m?.tag === 'string' ? m.tag.slice(0, 20) : '',
    at: Number(m?.at) || 0,
  }));
}

/**
 * A message to a tab's content scripts, or to one named frame of it.
 *
 * Without `options` this reaches every frame and the first to answer wins,
 * which is what almost every caller here wants. `{ frameId }` is for the two
 * that must be exact: asking the frame that *holds* an iframe to name it, and
 * putting text on the clipboard from frame 0, which is the only frame of the
 * page the browser's own Permissions-Policy trusts with it.
 */
export async function sendToTab(tabId, msg, options) {
  if (tabId == null) return null;
  msg = forTab(msg);
  try {
    return options
      ? await chrome.tabs.sendMessage(tabId, msg, options)
      : await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // No content script (chrome:// page, PDF viewer, or the tab is still loading).
    return null;
  }
}

/** The frameLocator chain a frame sits behind, built from outside it. */
export async function frameChain(tabId, frameId) {
  if (frameId === 0) return { prefix: '', parts: [], depth: 0, complete: true };
  const all = await chrome.webNavigation?.getAllFrames({ tabId }).catch(() => null);
  if (!all) return { prefix: '', parts: [], depth: 0, complete: false, reason: 'The frame tree could not be read.' };

  const byId = new Map(all.map((f) => [f.frameId, f]));
  // Where each frame sits among its siblings, in the order the browser lists
  // them, so a parent that cannot tell two frames apart by URL can still count.
  const siblings = new Map();
  for (const f of all) {
    if (f.frameId === 0) continue;
    const list = siblings.get(f.parentFrameId) || [];
    list.push(f.frameId);
    siblings.set(f.parentFrameId, list);
  }

  const parts = [];
  let node = byId.get(frameId);
  // A frame tree deeper than this is a page nobody is hand-testing, and the
  // bound is what stops a malformed tree from spinning here for ever.
  for (let step = 0; node && node.frameId !== 0 && step < 16; step++) {
    const parent = byId.get(node.parentFrameId);
    if (!parent) break;
    const answer = await sendToTab(
      tabId,
      {
        type: 'UQA_FRAME_SELECTOR',
        url: node.url,
        index: (siblings.get(parent.frameId) || []).indexOf(node.frameId),
      },
      { frameId: parent.frameId }
    );
    if (!answer?.expr) {
      return { prefix: '', parts: [], depth: 0, complete: false, reason: 'A frame in the chain could not be named.' };
    }
    parts.unshift(answer.expr);
    node = parent;
  }

  if (node?.frameId !== 0) {
    return { prefix: '', parts: [], depth: 0, complete: false, reason: 'The chain does not reach the top frame.' };
  }
  return { prefix: `${parts.join('.')}.`, parts, depth: parts.length, complete: true };
}

/**
 * Every frame of a tab a tool can honestly be pointed at, outermost first. Check accessibility, the links and the fine print
 * once injected into the main frame only and said "clean" about a page that lived in one cross-origin iframe (7 Sept 2026,
 * a site QA pass). `http(s)` frames only; depth is computed here because `getAllFrames` is flat; capped, and
 * the cap is reported next to the count.
 */
export const MAX_SCAN_FRAMES = 20;

export async function testableFrames(tabId) {
  const fallback = [{ frameId: 0, url: '', depth: 0 }];
  const all = await chrome.webNavigation?.getAllFrames({ tabId }).catch(() => null);
  if (!all?.length) return fallback;

  const byId = new Map(all.map((f) => [f.frameId, f]));
  const depthOf = (frame) => {
    let depth = 0;
    let node = frame;
    // The same bound frameChain() uses: a deeper tree is malformed, not deep.
    while (node && node.frameId !== 0 && depth < 16) {
      node = byId.get(node.parentFrameId);
      depth += 1;
    }
    return depth;
  };

  const usable = all
    .filter((f) => /^https?:/i.test(f.url || ''))
    .map((f) => ({ frameId: f.frameId, url: f.url, depth: depthOf(f) }))
    // Outermost first, so a single-frame page and the first entry of a nested
    // one are the same object they always were.
    .sort((a, b) => a.depth - b.depth || a.frameId - b.frameId);

  if (!usable.length) return fallback;
  return usable.slice(0, MAX_SCAN_FRAMES);
}

/* ── content scripts that are not in the manifest ──────────────────────── */

/* Six tools, injected when first used rather than into every page. */
const ON_DEMAND = {
  picker: 'content/picker.js',
  rtl: 'content/rtl-stress.js',
  injector: 'content/data-injector.js',
  harvester: 'content/harvester.js',
  specReader: 'content/spec-reader.js',
  links: 'content/links.js',
  autofill: 'content/autofill.js',
};

/**
 * Put one of them into a tab, in every frame, and answer whether it is there.
 *
 * Failure is normal and not an error: `chrome://` pages, the PDF viewer, the
 * Web Store and a tab that closed mid-flight all refuse injection, and every
 * caller below already handles a tab that does not answer — that is what
 * `sendToTab` returning `null` has always meant.
 */
export async function ensureScript(tabId, feature) {
  const file = ON_DEMAND[feature];
  if (tabId == null || !file) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [file] });
    return true;
  } catch {
    return false;
  }
}

/** `sendToTab`, with the tool it talks to put there first. */
export async function sendToFeature(tabId, feature, msg) {
  if (tabId == null) return null;
  await ensureScript(tabId, feature);
  return sendToTab(tabId, msg);
}

/**
 * Open one of this extension's own pages in a tab.
 *
 * Five handlers did the same three lines. `chrome.runtime.getURL` keeps the extension id out of the caller, and the
 * caller passes a *packed path*, never a `chrome-extension://` URL it built. Returns both tab id and URL (two callers
 * report the URL back). Not for `chrome://` destinations; `UQA_OPEN_SHORTCUTS` says so at its own site.
 *
 * @param {string} path packed path, e.g. `report/report.html?session=abc`
 * @returns {Promise<{ tabId: number|undefined, url: string }>}
 */
export async function openOwnPage(path) {
  const url = chrome.runtime.getURL(path);
  const tab = await chrome.tabs.create({ url });
  return { tabId: tab.id, url };
}
