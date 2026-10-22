/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Right-click menu.
 *
 * The design rule here is that the menu must match the thing under the cursor.
 * A flat list of every tool on every context is the usual mistake: it makes the
 * menu long, makes the useful entry hard to find, and offers actions that
 * cannot apply — "insert an edge-case value" on a paragraph, "break this
 * request" on plain text.
 *
 * So each entry declares the context it belongs to, and Chrome shows only what
 * fits:
 *
 *   right-click a form field  → insert an edge-case value
 *   right-click a link        → break, redirect or slow that exact URL
 *   right-click selected text → file it as a note on the session
 *   right-click an image      → copy its locator
 *   right-click anything      → copy the locator for what you clicked
 *   right-click the page      → record, measure, scan, stress, report
 *
 * ── and then every tool, grouped ─────────────────────────────
 *
 * Those entries are the ones better from a right-click than from the popup,
 * because they act on the thing under the cursor. They are not the whole
 * product. So under the same parent, below them, sit four submenus — Capture,
 * Check, Design, Break — holding all sixteen tools in the popup's grouping and
 * order, each routed at the same `UQA_*` handler the popup's card sends.
 *
 * Three decisions, not accidents:
 *
 *   Record re-invokes: `qaw-tool-record` runs the `qaw-clip` body, because a
 *   right-click IS the gesture Chrome issues `activeTab` for, and this is the
 *   only route that receives that grant and spends it in the same tick.
 *
 *   A tool needing a running session stays visible and says so in its title.
 *   Hidden, a tester cannot tell this menu from a broken one.
 *
 *   The tool list is `core/tool-catalogue.json`, FETCHED here rather than
 *   imported. This file is in the service worker's static boot graph, which MV3
 *   re-parses on every cold start and which `tools/test-worker-imports.mjs`
 *   holds to a hard byte ceiling; a file read at menu-build time is not in that
 *   graph at all, because menus are built on install and on startup, not at
 *   import. It is still a copy of the popup's `TOOLS[]`, and
 *   `tools/test-context-menus.mjs` fails the moment the two stop matching on
 *   ids, labels, groups or order.
 *
 * "What you clicked" is not something Chrome hands us — `onClicked` carries the
 * page, the link and the selection, but never the element. The content script
 * keeps the last `contextmenu` target for exactly this, which is also why these
 * entries do nothing on a tab that has no content script (a `chrome://` page,
 * the Web Store); those are filtered out by `documentUrlPatterns`.
 */

import { on } from '../core/on.js';

const PARENT = 'njb';
/**
 * T-053: every sentence the menu and its toasts say goes through the worker's
 * catalogue lookup (`tr`, set by installContextMenus; the English literal beside
 * each call is the fallback and the source of record). Values that are code or
 * URLs are isolated left-to-right so Arabic punctuation cannot flip them.
 */
/** @type {(key: string, en: string) => Promise<string>} */
let tr = async (_key, en) => en;
const LRI = '\u2066';
const PDI = '\u2069';
/** @param {string} key @param {string} en @param {Record<string, any>} [vars] */
const T = async (key, en, vars = {}) =>
  (await tr(key, en)).replace(/\{(\w+)\}/g, (m, k) =>
    k in vars ? (/^(locator|path|list|label)$/.test(k) ? `${LRI}${vars[k]}${PDI}` : String(vars[k])) : m);
/** Menu titles, resolved once per build so titleFor stays synchronous. */
/** @type {Record<string, string>} */
let S = {};


/** Only where a content script can actually run. */
const REAL_PAGES = ['http://*/*', 'https://*/*', 'file://*/*'];

const ITEMS = [
  // ── whatever is under the cursor ──────────────────────────────────────
  {
    id: 'qaw-locator',
    title: 'Copy Playwright locator',
    contexts: ['page', 'link', 'image', 'editable', 'selection', 'video', 'audio'],
  },

  // ── a form field ──────────────────────────────────────────────────────
  { id: 'qaw-inject', title: 'Insert an edge-case value…', contexts: ['editable'] },
  // Gap G5, stage 1 only: a placeholder NAME for this field's credential,
  // never a value — see research/120 §6. No vault, nothing stored.
  { id: 'qaw-cred', title: 'Mark credential name…', contexts: ['editable'] },

  // ── a link ────────────────────────────────────────────────────────────
  { id: 'qaw-link-sep', type: 'separator', contexts: ['link'] },
  { id: 'qaw-link-fail', title: 'Make this URL fail', contexts: ['link'] },
  { id: 'qaw-link-500', title: 'Make this URL return 500', contexts: ['link'] },
  { id: 'qaw-link-slow', title: 'Make this URL slow (3s)', contexts: ['link'] },

  // ── selected text ─────────────────────────────────────────────────────
  { id: 'qaw-note-selection', title: 'Add selection as a note', contexts: ['selection'] },
  { id: 'qaw-note-bug', title: 'Add selection as a bug', contexts: ['selection'] },

  // ── the page ──────────────────────────────────────────────────────────
  { id: 'qaw-page-sep', type: 'separator', contexts: ['page'] },
  // Two different things used to share the words "start recording": this one
  // begins a QA session, and the Record tool in the popup captures video. They
  // are three inches apart in the same product and were named identically.
  { id: 'qaw-record', title: 'Start a QA session', contexts: ['page'] },
  // The only route that both grants Chrome's activeTab permission and then
  // uses it. The popup's Record button cannot: by the time it is pressed the
  // tab has usually navigated and the grant is gone.
  { id: 'qaw-clip', title: 'Record a video of this tab', contexts: ['page'] },
  { id: 'qaw-speed', title: 'Check page speed', contexts: ['page'] },
  { id: 'qaw-a11y', title: 'Check accessibility', contexts: ['page'] },
  { id: 'qaw-rtl', title: 'Toggle layout stress', contexts: ['page'] },
  { id: 'qaw-api', title: 'Send a request', contexts: ['page'] },
  { id: 'qaw-report-sep', type: 'separator', contexts: ['page'] },
  { id: 'qaw-report', title: 'Open the last report', contexts: ['page'] },
  // ── for somebody who is not testing ───────────────────────────────────
  // No session needed and none started: the point of this entry is that the
  // person using it has not started anything and should not have to.
  { id: 'qaw-reporter-sep', type: 'separator', contexts: ['page'] },
  { id: 'qaw-reporter', title: 'Report a problem', contexts: ['page', 'selection', 'image'] },
];

const MENU_KEYS = {
  'qaw-locator': 'common.worker.menu.locator',
  'qaw-inject': 'common.worker.menu.inject',
  'qaw-cred': 'common.worker.menu.cred',
  'qaw-link-fail': 'common.worker.menu.linkFail',
  'qaw-link-500': 'common.worker.menu.link500',
  'qaw-link-slow': 'common.worker.menu.linkSlow',
  'qaw-note-selection': 'common.worker.menu.noteSelection',
  'qaw-note-bug': 'common.worker.menu.noteBug',
  'qaw-record': 'common.worker.menu.record',
  'qaw-clip': 'common.worker.menu.clip',
  'qaw-speed': 'common.worker.menu.speed',
  'qaw-a11y': 'common.worker.menu.a11y',
  'qaw-rtl': 'common.worker.menu.rtl',
  'qaw-api': 'common.worker.menu.api',
  'qaw-report': 'common.worker.menu.report',
  'qaw-reporter': 'common.worker.menu.reporter',
  stop: 'common.worker.menu.recordStop',
  needSession: 'common.worker.menu.needSession',
};

async function loadStrings(list = {}) {
  S = {};
  for (const i of ITEMS) if (MENU_KEYS[i.id]) S[i.id] = await tr(MENU_KEYS[i.id], i.title);
  S.stop = await tr(MENU_KEYS.stop, 'Stop the QA session');
  S.needSession = await tr(MENU_KEYS.needSession, '{label} (start a session first)');
  for (const t of list.tools || []) S[toolId(t.tool)] = await tr(`tools.${t.tool}.label`, t.label);
  for (const g of list.groups || []) S[`qaw-group-${g.id}`] = await tr(`popup.groups.${g.id}.label`, g.label);
}

/**
 * The tool list, read once per worker life.
 *
 * `chrome.runtime.getURL` + `fetch` on a packaged file is synchronous-ish in
 * practice (it never leaves the machine) and, unlike an import, costs the cold
 * start nothing: nothing here runs until a menu is built.
 *
 * A failure returns empty rather than throwing. The thirteen context-specific
 * entries above are the older, more valuable half of this menu, and they must
 * still be built if this file is ever missing from a package.
 */
let catalogue = null;
async function tools() {
  if (catalogue) return catalogue;
  try {
    const res = await fetch(chrome.runtime.getURL('core/tool-catalogue.json'));
    const json = await res.json();
    catalogue = { groups: json.groups || [], tools: json.tools || [] };
  } catch {
    catalogue = { groups: [], tools: [] };
  }
  return catalogue;
}

/** The menu id for one tool. Derived, never written twice. */
const toolId = (tool) => `qaw-tool-${tool}`;

/**
 * How many items this extension may put in one menu. Chrome documents a limit
 * only for the action context (`ACTION_MENU_TOP_LEVEL_LIMIT`, six) and drops
 * nothing here, but a right-click menu that fills the screen is its own
 * failure. Asserted by tools/test-context-menus.mjs and tools/diagnose.mjs.
 */
const MAX_ITEMS = 60;

/**
 * The title as the tester reads it. One place, so `buildContextMenus` and
 * `contextMenuState` cannot answer differently — the only reason the state
 * function is trustworthy for a menu Chrome will not let anyone read back.
 */
function titleFor(item, { recording, list = [] }) {
  if (item.id === 'qaw-record') return recording ? S.stop || 'Stop the QA session' : S[item.id] || 'Start a QA session';
  const tool = list.find((t) => toolId(t.tool) === item.id);
  const own = S[item.id] || item.title;
  if (tool?.session && !recording) return (S.needSession || '{label} (start a session first)').replace('{label}', own);
  return own;
}

/** The four group parents and their sixteen children, in the popup's order. */
function toolItems({ groups, tools: list }) {
  const out = [];
  for (const group of groups) {
    out.push({ id: `qaw-group-${group.id}`, title: S[`qaw-group-${group.id}`] || group.label, contexts: ['page'], group: true });
    for (const tool of list.filter((t) => t.group === group.id)) {
      out.push({
        id: toolId(tool.tool),
        title: S[toolId(tool.tool)] || tool.label,
        contexts: ['page'],
        parent: `qaw-group-${group.id}`,
        tool: tool.tool,
      });
    }
  }
  return out;
}

/**
 * What the menu currently is.
 *
 * chrome.contextMenus has no read API — you can create and remove, never list —
 * so a test could otherwise only assert that create() was called, which says
 * nothing about whether "insert a value" really is confined to form fields.
 * This reports the same shape the build uses.
 */
export async function contextMenuState({ recording }) {
  const cat = await tools();
  await loadStrings(cat);
  const all = [...ITEMS, ...toolItems(cat)].filter((i) => i.type !== 'separator');
  return {
    recordLabel: recording ? 'Stop recording' : 'Start recording',
    items: all.map((i) => ({
      id: i.id,
      title: titleFor(i, { recording, list: cat.tools }),
      contexts: i.contexts,
      ...(i.group ? { group: true } : {}),
      ...(i.parent ? { parent: i.parent } : {}),
      ...(i.tool ? { tool: i.tool } : {}),
    })),
    groups: cat.groups.map((g) => ({
      id: `qaw-group-${g.id}`,
      label: g.label,
      tools: cat.tools.filter((t) => t.group === g.id).map((t) => t.tool),
    })),
    total: all.length + ITEMS.filter((i) => i.type === 'separator').length + 1,
    max: MAX_ITEMS,
  };
}

/**
 * Rebuilt from scratch each time rather than patched. `removeAll` then `create`
 * is cheap, and it makes the menu a pure function of the current state — the
 * alternative is an update path that drifts out of step with the popup after
 * the first bug.
 */
async function rebuildOnce({ recording }) {
  if (!chrome.contextMenus) return;
  await new Promise((done) => chrome.contextMenus.removeAll(() => { void chrome.runtime.lastError; done(); }));

  create({
    id: PARENT,
    // The product, not the product line. This is the most public string the
    // extension owns — it is in the right-click menu of every page a tester
    // visits — and it was still the old name.
    title: 'QA Wrap',
    contexts: ['page', 'link', 'image', 'editable', 'selection', 'video', 'audio'],
    documentUrlPatterns: REAL_PAGES,
  });

  const cat = await tools();
  await loadStrings(cat);

  for (const item of ITEMS) {
    create({
      ...item,
      title: titleFor(item, { recording, list: cat.tools }),
      parentId: PARENT,
      documentUrlPatterns: REAL_PAGES,
    });
  }

  // The four groups and their sixteen tools, after a rule.
  create({
    id: 'qaw-tools-sep',
    type: 'separator',
    contexts: ['page'],
    parentId: PARENT,
    documentUrlPatterns: REAL_PAGES,
  });
  for (const item of toolItems(cat)) {
    const { group, parent, tool, ...rest } = item;
    create({
      ...rest,
      title: titleFor(item, { recording, list: cat.tools }),
      parentId: parent || PARENT,
      documentUrlPatterns: REAL_PAGES,
    });
  }
}

/**
 * `create` with its callback, so a failure is read (`runtime.lastError`) and
 * logged instead of landing on the Errors page as "Unchecked runtime.lastError".
 */
function create(props) {
  chrome.contextMenus.create(props, () => {
    const err = chrome.runtime.lastError;
    if (err) console.warn('[QA Wrap] contextMenus.create', props.id, err.message);
  });
}

/**
 * One rebuild at a time. There are five callers (install, startup, state
 * change, language change, boot) and `rebuildOnce` awaits between `removeAll`
 * and the last `create` — so two overlapping rebuilds each created the same
 * ids and Chrome answered "Cannot create item with duplicate id" for every one
 * (44 on the Errors page). A request during a rebuild does not start another:
 * it is remembered, and exactly one trailing rebuild with the newest arguments
 * runs after the current one. Every caller's promise settles when the rebuild
 * that covers its request has finished.
 */
let running = null;
let pending = null;
export function buildContextMenus(args) {
  if (!running) {
    running = rebuildOnce(args).finally(() => { running = null; });
    return running;
  }
  if (!pending) {
    pending = { args, promise: null };
    pending.promise = running.catch(() => {}).then(() => {
      const next = pending.args;
      pending = null;
      return buildContextMenus(next);
    });
  } else {
    pending.args = args;
  }
  return pending.promise;
}

/**
 * Wires the menu to the same handlers the popup uses.
 *
 * Everything is routed through `handlers` — the object the worker already
 * dispatches messages against — so a menu entry and its popup button cannot
 * drift apart. A second implementation of "start recording" is how the two end
 * up doing different things.
 */
/**
 * @param {object} deps
 * @param {object} deps.handlers   the worker's own message handlers
 * @param {Function} deps.notify   show a toast in the page
 * @param {Function} deps.refreshMenus
 * @param {Function} deps.isArmed  `(tabId) => Promise<boolean>` — the master switch
 * @param {string} deps.asleep     what to say when it is off (English fallback)
 * @param {(key: string, en: string) => Promise<string>} deps.tr  the, the worker's catalogue lookup
 * @param {(windowId: number) => Promise<string|null>} deps.windowSession  the session recording in exactly that window
 * @param {(id: string) => Promise<unknown>} deps.stopSession  ends that session
 */
export function installContextMenus({ handlers, notify, refreshMenus, isArmed, asleep, tr: translate, windowSession, stopSession }) {
  if (translate) tr = translate;
  if (!chrome.contextMenus) return;

  // Through `on()`, like every other async listener. The `try` below only
  // covers the switch: the arming check and the refusal toast that precede it
  // are awaits of their own, and a throw in either became an unhandled
  // rejection on the extension's card rather than a line in the log.
  on(chrome.contextMenus?.onClicked, 'contextMenus.onClicked', async (info, tab) => {
    const tabId = tab?.id;
    if (tabId == null) return;

    // The master switch, checked once at the seam.
    //
    // Every entry below reaches a capability — injecting values into a form,
    // arming a rule that breaks requests, reading the page, flipping its
    // layout. Those go through `guard()` when they arrive as messages, but the
    // menu called the handlers directly and skipped it entirely, so the whole
    // toolbox stayed live in a window the tester had explicitly put to sleep.
    // Refusing out loud rather than silently: a menu entry that does nothing
    // and says nothing reads as a broken extension.
    if (isArmed && !(await isArmed(tabId))) {
      return notify(tabId, await T('popup.refusal.asleep', asleep || 'QA Wrap is asleep in this window.'), 'err');
    }

    try {
      switch (info.menuItemId) {
        case 'qaw-locator': {
          // Answered by `content/ui-host.js`, which the manifest declares and
          // which was watching when the right-click happened. Nothing is
          // injected to ask: the right-click is over by now, so a script put in
          // at this point could only ever report a memory it was not there to
          // take. See the note above `describeContextTarget` in that file.
          const res = await chrome.tabs
            .sendMessage(tabId, { type: 'UQA_DESCRIBE_CONTEXT_TARGET' })
            .catch(() => null);
          if (!res?.locator) {
            return notify(tabId, await T('common.worker.toast.nothingToCopy', 'Nothing to copy. Right-click directly on the element.'), 'err');
          }
          // The clipboard is not reachable from a service worker, so the copy
          // happens in the page, which is also where the tester can see it land.
          // `picker.js` owns that, and it is injected on demand, so it goes in
          // here — after there is something worth copying.
          await chrome.scripting
            .executeScript({ target: { tabId, allFrames: true }, files: ['content/picker.js'] })
            .catch(() => null);
          const copied = await chrome.tabs
            .sendMessage(tabId, { type: 'UQA_COPY', text: res.locator, file: res })
            .catch(() => null);
          return notify(
            tabId,
            copied?.ok
              ? await T(res.unique ? 'common.worker.toast.copied' : 'common.worker.toast.copiedMany', res.unique ? 'Copied: {locator}' : 'Copied: {locator}. Matches more than one element', { locator: res.locator })
              : await T('common.worker.toast.noClipboard', 'Could not reach the clipboard. The locator is: {locator}', { locator: res.locator }),
            copied?.ok && res.unique ? 'ok' : 'err'
          );
        }

        case 'qaw-inject':
          await handlers.UQA_INJECT({ tabId });
          return;

        case 'qaw-cred': {
          // Same route as `qaw-locator`: describe what was right-clicked,
          // inject the picker so it can draw the composer, then hand it the
          // description to name — never a value, and nothing sent back here.
          const res = await chrome.tabs
            .sendMessage(tabId, { type: 'UQA_DESCRIBE_CONTEXT_TARGET' })
            .catch(() => null);
          if (!res?.locator) {
            return notify(tabId, await T('common.worker.toast.nothingToMark', 'Nothing to mark. Right-click directly on the field.'), 'err');
          }
          await chrome.scripting
            .executeScript({ target: { tabId, allFrames: true }, files: ['content/picker.js'] })
            .catch(() => null);
          await chrome.tabs.sendMessage(tabId, { type: 'UQA_MARK_CRED', file: res }).catch(() => null);
          return;
        }

        // The one entry that needs nothing to be running first.
        case 'qaw-reporter':
          await handlers.UQA_OPEN_REPORTER({});
          return;

        case 'qaw-link-fail':
        case 'qaw-link-500':
        case 'qaw-link-slow': {
          const url = info.linkUrl || '';
          if (!url) return notify(tabId, await T('common.worker.toast.noLink', 'No link URL to work with.'), 'err');
          const spec = {
            'qaw-link-fail': { action: 'fail', label: 'Network failure' },
            'qaw-link-500': { action: 'status', status: 500, body: '{"error":"forced"}', label: 'Server error 500' },
            'qaw-link-slow': { action: 'delay', delayMs: 3000, label: 'Slow response (3.0s)' },
          }[info.menuItemId];
          // Added, not set: a rule armed from the menu joins the ones already
          // armed for this session rather than quietly replacing them.
          await handlers.UQA_ADD_RULE({
            rule: {
              enabled: true,
                // The path, not the whole URL: the same endpoint is reached
                // through different origins often enough that matching the full
                // string quietly arms a rule that never fires.
              pattern: pathOf(url),
              method: 'ANY',
              contentType: 'application/json',
              remaining: 1,
              ...spec,
            },
          });
          return notify(tabId, await T('common.worker.toast.armedOnce', 'Armed once on "{path}": {label}. Trigger it now.', { path: pathOf(url), label: spec.label }), 'ok');
        }

        case 'qaw-note-selection':
        case 'qaw-note-bug': {
          const text = (info.selectionText || '').trim();
          if (!text) return notify(tabId, await T('common.worker.toast.selectFirst', 'Select some text first.'), 'err');
          const tag = info.menuItemId === 'qaw-note-bug' ? 'bug' : null;
          await handlers.UQA_NOTE({ text, tag });
          return notify(tabId, tag ? await T('common.worker.toast.filedBug', 'Filed as a bug on this session.') : await T('common.worker.toast.addedNote', 'Added to the session notes.'), 'ok');
        }

        // Both the page entry and the Capture group's Record tool: one body,
        // two ids. A second copy is how the two disagree about what stop means.
        case 'qaw-clip':
        case 'qaw-tool-record': {
          // Captured here, in the click handler, while the grant Chrome just
          // issued is still live.
          const state = await handlers.UQA_RECORD_STATE({});
          if (state?.recording) {
            const meta = await handlers.UQA_RECORD_STOP({});
            notify(tabId, await T('common.worker.toast.videoSaved', 'Video saved: {s}s.', { s: Math.round((meta.durationMs || 0) / 1000) }), 'ok');
          } else {
            await handlers.UQA_RECORD_START({ tabId });
            notify(tabId, await T('common.worker.toast.recordingTab', 'Recording this tab. Right-click again to stop.'), 'ok');
          }
          return refreshMenus();
        }

        case 'qaw-record': {
          // The window clicked in (r3-09-1): another window's session is not this one's to stop.
          const here = await windowSession(tab.windowId);
          if (here) {
            await stopSession(here);
            notify(tabId, await T('common.worker.toast.recStopped', 'Recording stopped. The report is ready in the popup.'), 'ok');
          } else {
            await handlers.UQA_START({ tabId, startUrl: info.pageUrl, charter: await T('common.worker.toast.charter', 'Started from the right-click menu') });
            notify(tabId, await T('common.worker.toast.recStarted', 'Recording. Everything you do here is on the clock.'), 'ok');
          }
          return refreshMenus();
        }

        case 'qaw-api':
          // Opened, never sent: the panel shows the request before anything
          // leaves the browser, and a menu entry that fired one off would be
          // the opposite of that promise.
          await handlers.UQA_OPEN_API({});
          return;

        case 'qaw-speed': {
          const r = await handlers.UQA_SCAN_PERF({ tabId });
          const poor = Object.entries(r.ratings || {})
            .filter(([, v]) => v === 'poor')
            .map(([k]) => k.toUpperCase());
          return notify(
            tabId,
            (await T('common.worker.toast.speed', 'LCP {lcp}ms · CLS {cls} · Requests: {n}', { lcp: r.metrics.lcp ?? '—', cls: r.metrics.cls, n: r.resources.count })) +
              (poor.length ? ` · ${await T('common.worker.toast.speedPoor', 'Rated poor: {list}', { list: poor.join(', ') })}` : ''),
            poor.length ? 'err' : 'ok'
          );
        }

        case 'qaw-a11y': {
          const r = await handlers.UQA_SCAN_A11Y({ tabId });
          return notify(
            tabId,
            r.total
              ? await T('common.worker.toast.a11yFound', 'Accessibility issues: {n}, rules broken: {rules}. Detail in the panel.', { n: r.total, rules: r.violations.length })
              : await T('common.worker.toast.a11yNone', 'No accessibility violations found by axe on this page.'),
            r.total ? 'err' : 'ok'
          );
        }

        case 'qaw-rtl':
          // Through the handler, not straight at the tab: the handler is what
          // remembers that stress is on, and that memory is what puts the page
          // back when the session stops.
          await handlers.UQA_TOGGLE_RTL({ tabId });
          return;

        case 'qaw-report':
          return handlers.UQA_OPEN_REPORT({ format: 'markdown' });

        default:
          // Everything in the four groups. The switch above keeps the entries
          // that need more than a handler call; this is the rest.
          return runTool(info.menuItemId, { tabId, info, handlers, notify, refreshMenus });
      }
    } catch (err) {
      const rk = err?.code ? `popup.refusal.${String(err.code).toLowerCase().replace(/_(.)/g, (_m, c) => c.toUpperCase())}` : null;
      notify(tabId, rk ? await tr(rk, err.message) : err.message, 'err');
    }
  });
}

/**
 * One tool from the grouped half of the menu.
 *
 * Every branch ends in a sentence in the page: a right-click that appears to do
 * nothing is indistinguishable from a broken extension. `send` is either a
 * `UQA_*` message, called with `{ tabId }` as the popup's card sends it, or one
 * of four words for the tools whose card is not one message.
 */
async function runTool(menuItemId, { tabId, info, handlers, notify, refreshMenus }) {
  const tool = (await tools()).tools.find((t) => toolId(t.tool) === menuItemId);
  if (!tool) return;

  // The title already says so; this is pressing it anyway.
  if (tool.session && !(await handlers.UQA_GET_STATE({}))?.recording) {
    return notify(tabId, await T('common.worker.toast.needSessionTool', '{label} needs a running session. Start one from this menu first.', { label: S[toolId(tool.tool)] || tool.label }), 'err');
  }

  switch (tool.send) {
    case 'clip':
      return; // handled by the qaw-clip case, which owns the grant

    case 'coverage': {
      // A toggle over the popup's own two messages. There is no COVERAGE_STATE
      // message; the worker's record of a live attach is `coverageTab` in
      // session storage, written by UQA_COVERAGE_START. The popup reads its
      // button's aria-pressed, which a menu does not have.
      const { coverageTab } = await chrome.storage.session.get('coverageTab');
      if (coverageTab != null) {
        const r = await handlers.UQA_COVERAGE_STOP({ tabId });
        const own = r?.own || {};
        return notify(
          tabId,
          own.statementCoverage == null
            ? await T('common.worker.toast.covNone', 'No scripts of this page’s own were measured.')
            : await T('common.worker.toast.covDone', '{pct}% of this page’s own JavaScript ran. Coverage says a line ran, not that it is right.', { pct: own.statementCoverage }),
          'ok'
        );
      }
      if (!(await handlers.UQA_COVERAGE_PERMISSION({}))) {
        return notify(tabId, await T('common.worker.toast.covNoPerm', 'Coverage needs Chrome’s debugger permission, which this build does not hold.'), 'err');
      }
      await handlers.UQA_COVERAGE_START({ tabId });
      return notify(tabId, await T('common.worker.toast.covStart', 'Measuring. Chrome’s "is debugging" bar is expected. Press this again to stop.'), 'ok');
    }

    case 'diagram': {
      // The popup opens the sheet in a tab; so does this.
      const state = await handlers.UQA_GET_STATE({});
      const id = state?.session?.id || state?.sessionId;
      if (!id) return notify(tabId, await T('common.worker.toast.diagramNone', 'Nothing to draw yet. The diagram is drawn from what you do.'), 'err');
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`diagram/diagram.html?session=${encodeURIComponent(id)}`),
      });
      return notify(tabId, await T('common.worker.toast.diagramOpen', 'Opening the diagram…'), 'ok');
    }

    case 'popup':
      // A card that is a panel. Naming it rather than opening nothing: the
      // panel is a surface with its own inputs, which a context menu is not.
      return notify(tabId, await T('common.worker.toast.panel', '{label} opens a panel. It is in the QA Wrap popup, under {group}.', { label: S[toolId(tool.tool)] || tool.label, group: S[`qaw-group-${tool.group}`] || tool.group }), 'ok');

    case 'break':
      // The card opens a panel, which a context menu cannot be. The three link
      // entries above ARE this tool, phrased for the thing under the cursor.
      return notify(
        tabId,
        await T('common.worker.toast.breakHint', 'Right-click a link to break, delay or fail that request. The full rule panel is in the popup.'),
        'ok'
      );

    default: {
      const handler = Object.hasOwn(handlers, tool.send) ? handlers[tool.send] : undefined; // D-1010-181
      if (typeof handler !== 'function') {
        return notify(tabId, await T('common.worker.toast.notAvailable', '{label} is not available in this build.', { label: S[toolId(tool.tool)] || tool.label }), 'err');
      }
      await handler({ tabId, url: info?.pageUrl });
      if (tool.tool === 'record' || tool.tool === 'rtl' || tool.tool === 'mask') refreshMenus();
      return notify(tabId, await T('common.worker.toast.toolDone', '{label}: done. The result is in the popup and the report.', { label: S[toolId(tool.tool)] || tool.label }), 'ok');
    }
  }
}

/** "https://host/a/b?c=1" → "/a/b" — the part a rule should match on. */
function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
