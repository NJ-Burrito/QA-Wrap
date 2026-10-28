/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
const $ = (id) => document.getElementById(id);
const { el } = window.UQADom, TIMING = { reloadAnswerWait: 1500, statusFades: 4000, copiedTick: 1200, mailLinkDelay: 400, tick: 1000, healthSettles: 4000 }; // el: ui/dom.js. TIMING: waits and display times in ms, shared with the sibling scripts

/**
 * The words a tester reads, in the language they chose.
 *
 * `platform/i18n.js` is loaded parser-blocking in the head, so `QAWi18n` is on the
 * window before this file is parsed, and `boot()` awaits its tables before
 * anything paints. `t()` never throws and never returns undefined: a missing key
 * renders as the key itself, which is a bug report anybody can act on and an
 * empty button is not.
 */
const t = (k, v) => QAWi18n.t(k, v);
/** D-219: a page's own text (url, label, typed value) wrapped in a bidi isolate so it keeps its direction inside a sentence. */
const iso = (v) => QAWi18n.iso(v);

let SIG = null;
let FC = null;
let WERR = null;
let sigFailed = false;
const sigReady = Promise.all([
  import('../core/signal.js').then((m) => { SIG = m; }),
  import('../core/finding-count.js').then((m) => { FC = m; }),
]).catch(() => { sigFailed = true; });
// r1-09-1: the worker's English error sentences, mapped to keys on this side so the worker graph stays untouched.
import('../platform/worker-errors.js').then((m) => { WERR = m; }).catch(() => { /* English stays on screen */ });

/* ── the one problem number: core/signal.js visibleProblems (spec §7) ───────
 * The same block is in popup.js, devtools/panel.js and report.js: the number
 * comes from one function, the words from `common.signal.*`.
 */
const sgGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const sgSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* no storage: the choice lasts the page */ } };
// The side panel and popup carry no Problems/Everything switch; the report and DevTools keep theirs (same origin, so this never reads their choice).
const sgLevel = () => 'problems';
const sgPromoted = (sid) => { try { return new Set(JSON.parse(localStorage.getItem(`qaw.sg.promo.${sid}`) || '[]')); } catch { return new Set(); } };
const sgPath = (u) => { try { const p = new URL(u); return p.pathname + p.search; } catch { return String(u || ''); } };
/** The rows the level shows: Problems, or Everything; a promoted note joins Problems. */
function sgView(events, sid) {
  const sig = SIG.visibleProblems(events, 'all');
  const level = sgLevel();
  const promo = sgPromoted(sid);
  const rows = level === 'all' ? sig.rows : sig.rows.filter((r) => r.c === 'D' || promo.has(r.key));
  // The one problem number (core/finding-count.js: distinct failures); what the tools found (a11y, links, layout, fine print) is a Finding, counted apart.
  const num = FC ? FC.problemCounts(events).groups : sig.problems;
  return { sig, num, level, rows, promo, induced: sig.inducedRows };
}
function sgRow(r, v, sid, again) {
  const row = el('div', `sg-row${r.c === 'D' ? ' is-d' : ''}`);
  // T-021: the tier is a glyph shape and a word (ui/tone.js), never the row colour alone.
  if (window.UQATone) { const tier = window.UQATone.tierOf(SIG.REASONS[r.r]?.tier); row.append(window.UQATone.chip(tier, t(`common.signal.tier.${tier}`))); }
  row.append(el('span', 'sg-chip', t(`common.signal.r.${r.r}`)));
  if (r.r === 'd-third') row.append(el('span', 'sg-chip sg-warn', t('common.signal.warning')));
  const msg = el('span', 'sg-msg');
  const b = document.createElement('bdi');
  b.dir = 'auto';
  b.textContent = String(r.kind === 'net' ? `${r.status || ''} ${sgPath(r.url)}`.trim() : r.text || r.url || '').slice(0, 140);
  msg.append(b);
  row.append(msg);
  if (r.n > 1) row.append(el('span', 'sg-n', `x${r.n}`));
  if (r.c !== 'D') {
    if (v.promo.has(r.key)) row.append(el('span', 'sg-chip', t('common.signal.promoted')));
    else {
      const p = el('button', 'sg-btn', t('common.signal.promote'));
      p.type = 'button';
      p.addEventListener('click', () => { const s = sgPromoted(sid); s.add(r.key); sgSet(`qaw.sg.promo.${sid}`, JSON.stringify([...s])); again(); });
      row.append(p);
    }
  }
  return row;
}
/** Counts, coverage line, Induced section. `again` repaints the page. */
function sgBlock(v, sid, again, final = false) {
  const { sig } = v;
  const box = el('div', 'sg');
  if (sig.collapsed) box.append(el('p', 'sg-line', t('common.signal.moreCollapsed', { n: sig.collapsed })));
  if (final && !sig.problems) box.append(el('p', 'sg-line sg-cov', t('common.signal.coverage')));
  if (v.induced.length) {
    const d = el('details', 'sg-induced');
    d.append(el('summary', '', `${t('common.signal.induced')} (${v.induced.length})`));
    for (const r of v.induced) d.append(sgRow(r, v, sid, again));
    box.append(d);
  }
  return box;
}

/**
 * The same lookup, for the tables in this file that keep their English.
 *
 * `TOOLS`, `GROUPS`, `PRESS_SAYS`, `FIXES`, `PRESETS` and a dozen sentences the
 * suites read straight out of this source are declared in English here and
 * translated at render time. The English literal beside the key is the source of
 * record: `core/tool-catalogue.json`, `tools/test-tool-cards.mjs`,
 * `tools/test-context-menus.mjs`, `tools/test-permissions.mjs` and
 * `tools/test-viewport-resize.mjs` all read it out of this file, and a table
 * that has no row in the language table yet must still draw a card rather than
 * a key.
 */
const tf = (key, english, vars) => (QAWi18n.has(key) ? QAWi18n.t(key, vars) : english);

/**
 * Said when the worker answers nothing at all.
 *
 * `optimistic()` keeps its own copy of this sentence rather than calling here:
 * `tools/test-optimistic.mjs` lifts that helper out of this file by source and
 * runs it with no `QAWi18n` at all, so the words have to be inside the slice.
 */
const workerSilent = () =>
  tf('popup.err.workerSilent', 'Background worker is not responding. Reload the extension.');

/**
 * r1-09-1: a worker sentence in the tester's language. Only say() calls it, after the fix chip and the
 * sound were chosen from the original words (the chip table reads the worker's English), and English is
 * left alone. A sentence the table does not know stays as it arrived.
 */
const workerErrorText = (text) => {
  try {
    return (WERR && typeof text === 'string' ? WERR.translateWorkerError(text, t, QAWi18n.lang()) : null) ?? text;
  } catch {
    return text;
  }
};

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      void chrome.runtime.lastError;
      if (res && res.ok === false && REFUSALS[res.code ||= /<all_urls>.*activeTab/.test(res.error || '') ? 'NEEDS_CLICK' : '']) { // ui-1016 L: Chrome's raw screenshot refusal becomes one short line (NEEDS_CLICK)
        res.error = QAWi18n.t(REFUSALS[res.code].key);
        codeByText.set(res.error, res.code);
      }
      resolve(res || { ok: false, error: workerSilent() });
    });
  });
}

/**
 * One place for every user-visible message, so tone stays consistent.
 *
 * A success message clears itself after four seconds, and the clean-up is
 * matched by **identity, not by text**. It used to compare the text — so
 * pressing the same tool twice inside four seconds meant the first press's
 * timer fired, saw its own words on screen, and wiped the *second* press's
 * message. The tool had worked; the popup just went blank, which reads exactly
 * like a button that does nothing.
 */
let saidNo = 0;

let lastTone = '';
/** The words of the last message, for the one caller that has to read them. */
let lastSaid = '';

/**
 * Put the thing being talked about on screen, and ring it.
 *
 * E2: "when a permission is off or a feature is locked, the error message
 * carries a button that takes the user to the problem and highlights the
 * element". This is the second half of that: the button below scrolls the
 * control into view and marks it for a couple of seconds, so "grant it in
 * Settings" stops being a direction and becomes a place.
 *
 * The class is removed by a timer rather than by a transition end, because a
 * popup that is closed and reopened mid-animation would otherwise come back
 * with a control permanently ringed.
 */
function spotlight(target) {
  const node = typeof target === 'string' ? $(target) : target;
  if (!node) return false;
  node.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  node.classList.add('is-spotlit');
  // Cleared by the animation's own end, so the ring moves with the duration
  // token (decision 120); under reduced motion there is no animation to end.
  node.addEventListener('animationend', () => node.classList.remove('is-spotlit'), { once: true });
  if (!node.getAnimations?.().length) node.classList.remove('is-spotlit');
  node.focus?.({ preventScroll: true });
  return true;
}

/**
 * The one action a given refusal has.
 *
 * Derived from the sentence rather than from an error code, for the same
 * reason `REFUSAL` below is: the refusals arrive from the worker, the offscreen
 * document, `chrome.*` and four content scripts, and none of them shares a
 * code. A miss here costs a button that was not offered, which is exactly what
 * the product did before this existed.
 *
 * Order matters: the first match wins, so the specific patterns are first.
 */
/*
 * Each pattern reads both languages, because the sentence it is matching may
 * have come from either. The refusals the worker sends back are English; the
 * ones this popup writes itself are in whatever the tester chose, and a fix
 * button that disappeared the moment somebody switched to Arabic would be the
 * whole point of this table thrown away.
 */
/** Reloading the extension ends a live recording, so ask first (and say so) when one is running. */
async function reloadCarefully() {
  const live = await Promise.race([
    send({ type: 'UQA_RECORD_STATE' }).then((r) => !!(r.ok && r.result?.recording)),
    new Promise((ok) => setTimeout(() => ok(false), TIMING.reloadAnswerWait)),
  ]).catch(() => false);
  if (!(live || state?.recording) || confirm(t('popup.reload.confirmRecording'))) chrome.runtime.reload();
}

const FIXES = [
  {
    re: /asleep|wake it|master switch|متوقف|أيقظ|شغّله/i,
    id: 'wake',
    key: 'popup.fix.wake',
    label: 'Wake it up',
    run: () => {
      spotlight('switch-card');
      $('switch')?.click();
    },
  },
  {
    re: /reload the extension|out of date|debugger permission|أعد تحميل الإضافة/i,
    id: 'reloadExtension',
    key: 'popup.fix.reloadExtension',
    label: 'Reload the extension',
    run: () => reloadCarefully(),
  },
  {
    re: /reload this tab|only attaches when a page loads|أعد تحميل هذا التبويب/i,
    id: 'reloadTab',
    key: 'popup.fix.reloadTab',
    label: 'Reload the tab',
    run: async () => {
      if (ctx.tabId == null) return;
      await chrome.tabs.reload(ctx.tabId);
      say(t('popup.fix.reloadingTab'), 'ok');
    },
  },
  {
    re: /invoked|activeTab|right-click|بالزر الأيمن/i,
    id: 'showRow',
    key: 'popup.fix.showRow',
    label: 'Show me the row',
    run: () => spotlight(document.querySelector('.tool-row[data-tool="record"]')),
  },
  {
    re: /settings|permission|grant|allow (the|access)|denied|not allowed|الإعدادات|إذن|امنح|غير مسموح|رُفض/i,
    id: 'openSettings',
    key: 'popup.fix.openSettings',
    label: 'Open Settings',
    run: () => {
      send({ type: 'UQA_OPEN_OPTIONS' });
      dismiss();
    },
  },
  {
    re: /start a session|no session|press start|ابدأ جلسة|لا توجد جلسة/i,
    id: 'startSession',
    key: 'popup.fix.startSession',
    label: 'Start a session',
    run: () => {
      spotlight('step-idle');
      $('charter')?.focus();
    },
  },
];

/*
 * T-052: refusals as a designed state. The worker sends a code; the sentence is
 * the catalogue's (so it is in the tester's language) and the button is chosen
 * by the code, never by reading the sentence. Rewording or translating the text
 * cannot remove the chip: tools/test-refusals.mjs rewords it and checks.
 * One pattern per row: what happened, why, and the one button that fixes it
 * (chip null: nothing the tester can press, the text names who can).
 */
/*REFUSALS-BEGIN*/
const REFUSALS = {
  ASLEEP: { key: 'popup.refusal.asleep', chip: 'wake' },
  STALE: { key: 'popup.refusal.stale', chip: 'reloadExtension' },
  SLOW: { key: 'popup.refusal.slow', chip: null },
  MEDIA_SLOW: { key: 'popup.refusal.mediaSlow', chip: null }, NO_PICTURE: { key: 'popup.refusal.noPicture', chip: null }, REC_CANCELLED: { key: 'popup.refusal.recCancelled', chip: null }, REC_NOT_STORED: { key: 'popup.refusal.recNotStored', chip: null }, REC_TAB_BUSY: { key: 'popup.refusal.recTabBusy', chip: null },
  TAB_RELOAD: { key: 'popup.refusal.tabReload', chip: 'reloadTab' },
  NEEDS_INVOKE: { key: 'popup.refusal.needsInvoke', chip: 'showRow' }, NEEDS_CLICK: { key: 'popup.refusal.needsClick', chip: null },
  NEEDS_GRANT: { key: 'popup.refusal.needsGrant', chip: 'openSettings' },
  NO_SESSION: { key: 'popup.refusal.noSession', chip: 'startSession' },
  NEEDS_CONSENT: { key: 'popup.refusal.needsConsent', chip: 'openSettings' },
  POLICY_HOSTS: { key: 'common.worker.policy.hosts', chip: null },
  POLICY_SCREENSHOT: { key: 'common.worker.policy.screenshot', chip: null },
  POLICY_BLOCKED: { key: 'popup.refusal.policyBlocked', chip: null },
};
/*REFUSALS-END*/

/** Sentence on screen to the code it came with, so say() finds the chip without parsing words. */
const codeByText = new Map();

/** Code first; the regex table is only for the few refusals that still arrive without a code (chrome.*, content scripts). */
const fixFor = (text) => {
  const row = REFUSALS[codeByText.get(text)];
  if (row) return row.chip ? FIXES.find((f) => f.id === row.chip) : null;
  return FIXES.find((f) => f.re.test(String(text ?? ''))) || null;
};

/** The button currently attached to the status line, so it can be taken away. */
let fixBtn = null;

/**
 * Which refusal cue goes with an error message: the tool worked and declined
 * (asleep, not a normal page, needs a reload) is `status.refused`, anything
 * else is `status.error`. Matched on the words, so tools/test-sound.mjs feeds it
 * the real en.json and ar.json strings; a reworded message fails that test
 * instead of quietly sounding like an alarm.
 */
function refusalSound(text) {
  return /asleep|needs a normal web page|Reload this tab|متوقف|صفحة ويب عادية|أعد تحميل هذا التبويب/i.test(text)
    ? 'status.refused'
    : 'status.error';
}

/** The sound library, typed for the checker; undefined on a page that did not load it. */
const uqaSound = () => /** @type {any} */ (window).UQASound;

/**
 * @param {string} text
 * @param {string} [tone]
 * @param {{ sound?: string, fix?: any, silent?: boolean }} [opts]
 */
/** A caught failure as the keyed sentence plus a visible "Copy details" button that holds the raw message (never a tooltip: rule 10). */
function sayFailure(err) {
  const d = WERR ? WERR.describeError(err, t) : { text: t('common.err.unknown'), title: String(err?.message ?? '') };
  say(d.text, 'err', d.text === t('common.err.unknown') ? { fix: { key: 'common.err.copyDetails', label: 'Copy details', run: () => { navigator.clipboard?.writeText(d.title).then(() => say(t('common.err.detailsCopied'), 'ok'), () => {}); } } } : {});
}

/** @param {string} text @param {string} [tone] @param {{sound?: any, fix?: any, silent?: any, keep?: any}} [opts] */
function say(text, tone = '', { sound, fix, silent, keep } = {}) {
  // `line`, not `el`: every local called `el` in this file shadowed the
  // element helper of the same name for its whole function body, and the first
  // person to build a node inside one of them would have called a paragraph.
  const line = $('status');
  if (!line) return;
  const mine = ++saidNo;
  // The one place that already knows how a tool turned out, so it is the one
  // place the card's health mark reads from.
  lastTone = tone;
  const shown = tone === 'err' ? workerErrorText(text) : text;
  lastSaid = String(shown ?? ''); globalThis.UQAActions?.add(lastSaid, tone); // e1022: the panel's three status lines and count (popup/action-stack.js)
  line.textContent = shown;
  line.removeAttribute('title'); // sayFailure() may put the raw detail here after this call
  line.className = `status ${tone}`;

  /*
   * The way out of the problem, beside the sentence about it.
   *
   * Attached here and nowhere else, so it cannot outlive the message it
   * belongs to: `line.textContent = text` above has already removed the last
   * one, and `fixBtn` is dropped so nothing holds a detached node. A button
   * that survived one message and sat under the next would send the tester to
   * fix something that had already been fixed.
   */
  fixBtn = null;
  const action = tone === 'err' ? fix || (shown === t('common.err.cannotScan') ? null : fixFor(text)) : fix || null; // the cannot-scan sentence is not a permission to grant
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'status-fix';
    btn.textContent = action.key ? tf(action.key, action.label) : action.label;
    btn.addEventListener('click', () => { action.run(); });
    line.append(' ', btn);
    fixBtn = btn;
  }
  // The tone of the message is already decided here, so this is the one place
  // that has to know which sound goes with which outcome. Every message is on
  // screen as well — sound is never the only channel.
  // The tone is already decided here, so this is the one place that has to
  // know which sound goes with which outcome. A refusal is not an error — the
  // tool worked and declined — so it gets its own weight rather than the alarm.
  if (silent) {
    // The caller plays its own cue when the reply arrives (start, stop, capture).
  } else if (sound) {
    // A tool that has its own figure plays it instead of the generic outcome.
    window.UQASound?.play(sound);
  } else if (tone === 'err') {
    window.UQASound?.play(refusalSound(text));
  } else if (tone === 'ok') {
    window.UQASound?.play('status.ok');
  }
  window.UQAVfx?.status(line, tone);
  /*
   * And the message itself arrives rather than simply being different.
   *
   * `#status` is one element rewritten dozens of times a session, so a CSS
   * rule can never replay — the element has been matching since the popup
   * opened. `UQAMotion.notice()` restarts the slide by hand.
   *
   * Only for a message with no tone, and that is not a detail: `pop` and
   * `shake` above are also `animation` on this same element, and two
   * animations on one element is the second one winning. A refusal that
   * slid in gently instead of shaking would be the animation contradicting
   * the sentence.
   */
  if (!tone) window.UQAMotion?.notice(line);
  // A tool's outcome (and a line that carries a button) stays until the next message and is scrolled to, so it is seen where the tester is; other ok lines fade.
  if (line.textContent && (keep || window.toolPressing)) line.scrollIntoView?.({ block: 'nearest' });
  else if (tone === 'ok' && !action) setTimeout(() => { if (saidNo === mine) line.textContent = ''; }, TIMING.statusFades);
}

/*
 * Functions rather than constants, because a constant is evaluated while this
 * file is being parsed and the language table has not been fetched yet. Read at
 * the moment the sentence is said, they are right in both languages and after a
 * switch with no reload.
 */
const needsPage = () => t('popup.err.needsPage');
const needsReload = () => t('popup.err.needsReload');
/**
 * The same sentence the worker refuses with, kept in step by
 * `tools/test-permissions.mjs` rather than by anyone remembering.
 *
 * It has to exist twice: the worker says it to a tool that was pressed on a
 * site nobody allowed, and the popup says it to a Wake that was refused at the
 * bubble. One wording, so a tester who meets it twice meets the same thing.
 */
const NOT_ALLOWED = 'QA Wrap is not allowed on this site yet. Wake up here to allow it.';

/** The same refusal, in the tester's language. The literal above is the record. */
const notAllowed = () => tf('popup.err.notAllowed', NOT_ALLOWED);

let state = { recording: false, session: null, eventCount: 0 };
let settings = null;

/* ------------------------------------------------------------- the context */

/**
 * Docked, floating, or the classic popup?
 *
 * The same page serves as the browser-action popup, as the content of the side
 * panel, and as a small floating window. A popup gets out of the way after
 * handing the tester to the page; a docked panel and a float exist to stay
 * open, so neither ever closes itself.
 *
 * Read here rather than at the bottom of the file: `ctx` below is built from
 * it, and half the popup is built from `ctx`.
 */
const SURFACE = new URLSearchParams(location.search).get('surface') || 'popup';
const IN_PANEL = SURFACE === 'panel';
const IN_FLOAT = SURFACE === 'float';
if (SURFACE !== 'popup') document.documentElement.dataset.surface = SURFACE;

/**
 * One resolved answer to "which window and which tab am I acting on".
 *
 * Every call site used to work this out for itself — `activeTab()` here,
 * nothing at all there, `sender.tab.windowId` in the worker — and the answers
 * disagreed. The float is where that showed: `UQA_ARM` was sent with the
 * *page's* window id while `paintSwitch()` asked `UQA_ARMED` with none at all,
 * so the worker answered about the floating window's own window, found it
 * asleep, and the switch flapped straight back to "Asleep" after every wake.
 *
 * Resolved the way `UQA_POPUP_STATE` resolves it — from the testable tab, so
 * `windowId` is the window under test and never the float's own — once at
 * boot, again whenever the worker says the world moved, and again on each tool
 * press, which is the moment a stale tab id would actually cost something.
 * Nothing derives it a second time; everything reads `ctx`.
 */
const ctx = {
  surface: SURFACE,
  /** The window under test. Named on every message that needs one. */
  windowId: null,
  /** The tab under test. Named on every message that needs one. */
  tabId: null,
  /** This popup's own window — only the side panel, which opens into it, wants this. */
  ownWindowId: null,
  /** The browser window the float sits over — fetched at boot for the same gesture reason as `ownWindowId`. */
  hostWindowId: null,
};

/**
 * `sidePanel.open()` needs a window id and a live user gesture in the same
 * turn, and looking the id up costs an `await` — which spends the gesture. So
 * it is fetched now, when there is no hurry.
 */
chrome.windows?.getCurrent?.().then((w) => { ctx.ownWindowId = w?.id ?? null; }).catch(() => {});
chrome.windows?.getLastFocused?.({ windowTypes: ['normal'] }).then((w) => { ctx.hostWindowId = w?.id ?? null; }, () => {});

// A docked panel and a floating window both exist to stay open; only the
// classic popup gets out of the way.
const dismiss = () => { if (!IN_PANEL && !IN_FLOAT) window.close(); };

/**
 * A paint that cannot take the popup down with it.
 *
 * `paintRecording()`, `paintSwitch()` and `refresh()` are async and are called
 * *unawaited* from the broadcast listener, so anything they threw became an
 * unhandled rejection — which Chrome collects on the extension's card at
 * chrome://extensions, where it reads as a broken extension rather than as one
 * missing element. Three of the four errors on that card were exactly this.
 *
 * Wrapped once at definition rather than guarded at each of the dozen call
 * sites: the call site that would be forgotten is the one that fires.
 */
function safe(fn, name) {
  return async function (...args) {
    try {
      return await fn.apply(this, args);
    } catch (err) {
      console.warn('[QA Wrap] paint failed:', name, err);
      return undefined;
    }
  };
}

/* --------------------------------------------------------- optimistic paints */

/**
 * The class a provisionally-painted thing wears until the worker confirms it.
 *
 * One name, in one place, because the CSS rule for it lives in a file this
 * module does not own — a second spelling here would be a rule that silently
 * matches nothing.
 */
const PENDING = 'is-pending';

/**
 * Paint what the press is about to do, then reconcile with what it did.
 *
 * Every action in this popup used to wait for the service worker before it
 * painted anything: Wake left the switch reading "Asleep" until `UQA_ARM`
 * answered, Start left the idle card up until `UQA_START` returned, a note
 * appeared only once the worker had filed it. On a fast machine that round trip
 * is invisible. On a slow one it is a quarter of a second of a button that
 * looks like it did nothing — and against a service worker Chrome has just
 * killed it is several seconds of exactly that, which is how a tester learns to
 * press twice. Pressing twice is the actual bug: two sessions, two clips, two
 * notes.
 *
 * So the paint happens first and the truth arrives second. The truth always
 * wins — `settle` reconciles the provisional paint with what the worker
 * actually did, and `revert` puts the previous state back and says why. What is
 * never allowed is a third outcome: a control left mid-press with no answer.
 * That is why the timeout reply (`timedOut: true`, from `HANDLER_TIMEOUT_MS` in
 * the worker) is treated as a failure like any other rather than as silence.
 *
 * The contract:
 *
 *   `apply(pending)`   paints the expected state now, synchronously. Anything
 *                      it passes to `pending()` is marked with `.is-pending`
 *                      and **unmarked by this helper** on both exits, so a
 *                      call site cannot forget. It may return an undo
 *                      function, which is the default `revert`.
 *   `dispatch()`       the `send()` call — the second positional argument, the
 *                      "send" slot of the contract. Named `dispatch` here only
 *                      so it does not shadow the module-level `send()` this
 *                      file's every other line means by that word.
 *   `settle(res)`      reconcile the paint with the worker's answer.
 *   `revert(error)`    put the previous state back. Falls back to whatever
 *                      `apply` returned. The error is `say()`n here, once, in
 *                      the tone the rest of the popup already uses for a
 *                      refusal — no call site repeats it.
 *
 * Returns the worker's reply, so a caller that wants more than settle/revert
 * can still have it.
 *
 * @param {Function} apply
 * @param {Function} dispatch
 * @param {{revert?: Function, settle?: Function}} [opts]
 */
async function optimistic(apply, dispatch, { revert, settle } = {}) {
  const marked = [];
  const pending = (node) => {
    if (node && node.classList) {
      node.classList.add(PENDING);
      marked.push(node);
    }
    return node;
  };

  // Painted before anything is awaited, and deliberately not wrapped: if the
  // expected state cannot be drawn there is nothing to reconcile and nothing
  // to send, and a half-painted press is worse than an unpainted one.
  const undo = apply(pending);

  let res;
  try {
    res = await dispatch();
  } catch (err) {
    // `send()` never rejects, but a caller may await something else on the way
    // to it — reading the page's environment before UQA_START, for one.
    res = { ok: false, error: String(err?.message || err) };
  }

  // Cleared before either branch runs, so "pending" cannot outlive the press
  // down any path, including one a future settle throws out of.
  for (const node of marked) node.classList?.remove(PENDING);

  // A timed-out reply already carries `ok: false`; it is named separately
  // because that is the case this helper exists for, and a worker that one day
  // reports a timeout some other way should still revert rather than settle.
  if (!res || res.ok === false || res.timedOut === true) {
    // The English is inline and the table is consulted through `typeof`, because
    // tools/test-optimistic.mjs lifts this helper out of the file by source and
    // runs it in Node, where there is no QAWi18n to call.
    const message =
      (res && res.error) ||
      (typeof QAWi18n !== 'undefined' && QAWi18n.has('popup.err.workerSilent')
        ? QAWi18n.t('popup.err.workerSilent')
        : 'Background worker is not responding. Reload the extension.');
    try {
      if (revert) await revert(message, res);
      else if (typeof undo === 'function') undo();
    } catch (err) {
      console.warn('[QA Wrap] revert failed:', err);
    }
    say(message, 'err');
    return res || { ok: false, error: message };
  }

  try {
    if (settle) await settle(res);
  } catch (err) {
    console.warn('[QA Wrap] settle failed:', err);
  }
  return res;
}

/**
 * The used-mark, moved before the worker has counted it.
 *
 * The count itself is the worker's — `COUNTS_AS` in the service worker logs it,
 * and the next `refresh()` overwrites whatever is here with that. This only
 * covers the gap in between, and hands back the undo for the press that fails.
 */
function bumpUsed(tool, pending) {
  const before = used[tool];
  const now = Date.now();
  used = {
    ...used,
    [tool]: { firstAt: before?.firstAt ?? now, ...before, count: (before?.count ?? 0) + 1, lastAt: now },
  };
  paintUsage();
  pending?.(document.querySelector(`.tool-row[data-tool="${tool}"] .tool-state`));
  return () => {
    const next = { ...used };
    if (before) next[tool] = before;
    else delete next[tool];
    used = next;
    paintUsage();
  };
}

/* -------------------------------------------------------------------- ranges */

const RANGE_SPEC = {
  // No time-box control. Recording runs until the tester stops it — the only
  // limit is the disk, and the disk is reported rather than enforced.
  'break-count': {
    min: 0, max: 25, step: 1,
    fmt: (v) => (v === 0 ? t('popup.range.untilOff') : v === 1 ? t('popup.range.justOnce') : t('popup.range.nextN', { n: v })),
  },
  'break-delay': {
    min: 0, max: 30000, step: 250,
    fmt: (v) => (v >= 1000 ? t('popup.range.seconds', { s: (v / 1000).toFixed(1) }) : t('popup.range.millis', { ms: v })),
  },
};

function wireRange(id) {
  const input = $(id);
  const out = $(`${id}-out`);
  if (!input) return;
  const spec = RANGE_SPEC[id];
  input.min = spec.min;
  input.max = spec.max;
  input.step = spec.step;

  const paint = () => {
    const v = Number(input.value);
    if (out) out.textContent = spec.fmt(v);
    input.setAttribute('aria-valuetext', out ? out.textContent : String(v));
    const pct = ((v - spec.min) / (spec.max - spec.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  };
  input.addEventListener('input', paint);
  input.__paint = paint;
}

function setRange(id, value) {
  const input = $(id);
  if (!input) return;
  input.value = value;
  input.__paint?.();
}

/** Used when the worker cannot be reached, so the UI still renders something sane. */
const FALLBACK_SETTINGS = {
  timeboxMinutes: null, timeboxEnabled: false, expandPercent: 40,
  breakRepeat: 1, breakDelayMs: 5000,
  rtlMirror: true, rtlAccent: false, rtlBidi: false, keymapEnabled: true,
  keymap: { pick: 'Alt+KeyS', inject: 'Alt+KeyE', rtl: 'Alt+KeyD', note: 'Alt+KeyN', shot: 'Alt+KeyC', a11y: 'Alt+KeyA', bar: 'Alt+KeyB' },
};

async function loadSettings() {
  const res = await send({ type: 'UQA_GET_SETTINGS' });
  // Painting defaults beats leaving every slider blank — which is exactly what
  // a blank time-box slider looked like when this call quietly failed.
  settings = res.ok ? res.result : FALLBACK_SETTINGS;
  if (!res.ok) say(res.error || t('popup.err.settings'), 'err');
  paintFromSettings();
}

/**
 * Everything the popup draws from `settings`, in one function.
 *
 * Boot did this in one place and the `UQA_SETTINGS_CHANGED` broadcast did a
 * subset of it in another, so a setting changed in the Settings tab repainted
 * the shortcut chips and nothing else — the capture ticks and the two sliders
 * kept yesterday's values until the popup was closed and opened again.
 *
 * Called on boot, on that broadcast, and after every `renderTools()`, because
 * a re-render stamps brand-new capture ticks that have never been painted.
 */
function paintFromSettings() {
  paintMaskNotice();
  if (settings) {
    window.UQASound?.configure({ on: !!settings.soundEnabled, level: (settings.soundVolume ?? 70) / 100, scope: settings.soundScope });
    window.UQAVfx?.configure({ enabled: settings.vfxEnabled !== false });
    if (!window.__vfxWired) { window.__vfxWired = true; window.UQAVfx?.wire(); }

    paintCaptureTicks();
    setRange('break-count', settings.breakRepeat);
    setRange('break-delay', settings.breakDelayMs);
    // T-068: a tool the organisation took away is shown disabled and says why, not left to fail on click.
    if (settings.policy?.debuggerToolsAllowed === false) for (const b of document.querySelectorAll('.tool-row[data-tool="whitebox"] button')) { b.disabled = true; b.classList.add('is-managed'); b.title = t('options.policy.setByOrg', { key: 'debuggerToolsAllowed' }); }
  }
  // Outside the guard: with no settings the honest chip is a blank one, and
  // applyShortcutChips() already draws that. renderTools() calls this after
  // every render, and a freshly drawn row with no chip on it is the bug this
  // used to be a separate call for.
  applyShortcutChips();
}

/** Which setting each capture tick writes. Read by the delegated listener below. */
// `cap-cursor` added by GROUP G, 7 September 2026 (brief G2). It is the one
// edit Group G made in popup/, together with the chip in popup.html and the
// line in readCaptureOptions() below; see the comment beside the chip for what
// the tick actually does.
const CAPTURE_KEYS = {
  'cap-mic': 'recordMic',
  'cap-tabAudio': 'recordTabAudio',
  'cap-webcam': 'recordWebcam',
  'cap-cursor': 'recordCursor',
};

/**
 * The capture controls that are a choice rather than a tick.
 *
 * Same table shape as CAPTURE_KEYS and read by the same delegated listener, so
 * the next one of these is a line here and a control in popup.html. Kept
 * separate because a `<select>` writes `.value` where a tick writes `.checked`,
 * and one table with a type flag in it would be worse than two tables.
 */
const CAPTURE_CHOICES = {
  'cap-webcam-pos': 'webcamPosition',
};

function paintCaptureTicks() {
  const panel = panelFor('record');
  if (!panel) return;
  for (const [id, key] of Object.entries(CAPTURE_KEYS)) {
    const input = panel.querySelector(`#${id}`);
    if (input) input.checked = !!settings?.[key];
  }
  for (const [id, key] of Object.entries(CAPTURE_CHOICES)) {
    const select = panel.querySelector(`#${id}`);
    if (select && settings?.[key]) select.value = settings[key];
  }
}

/**
 * The scope radios, remembered.
 *
 * They live inside a stamped panel now, so a mode switch throws the chosen
 * scope away with the row. Remembering it here is what the old moved-panel
 * arrangement gave for free, and losing "Window or screen" because someone
 * pressed Expert would be a new bug, not a preserved behaviour.
 */
const scopes = { 'shot-scope': 'visible', 'rec-scope': 'tab' };

/**
 * One delegated `change` listener, for the same reason the click handler is
 * delegated: the controls it serves are created by `renderTools()`, and a
 * listener attached to an element that does not exist yet is attached to
 * nothing at all.
 */
document.addEventListener('change', (event) => {
  const input = event.target;
  if (!input) return;
  if (input.tagName === 'SELECT') {
    const choice = CAPTURE_CHOICES[input.id];
    if (choice) send({ type: 'UQA_SET_SETTINGS', patch: { [choice]: input.value } });
    return;
  }
  if (input.tagName !== 'INPUT') return;
  const key = CAPTURE_KEYS[input.id];
  if (key) send({ type: 'UQA_SET_SETTINGS', patch: { [key]: input.checked } });
  if (input.type === 'radio' && input.name in scopes) scopes[input.name] = input.value;
});

/**
 * Chips show the shortcut that is actually bound, not a hardcoded guess. The
 * user can rebind everything in Settings, and a stale chip is worse than none.
 */
function applyShortcutChips() {
  const pretty = (b) =>
    !b ? null
      : b.split('+')
          .map((p) =>
            p.startsWith('Key') ? p.slice(3)
            : p.startsWith('Digit') ? p.slice(5)
            : p === 'Meta' ? 'Win'
            : p
          )
          .join(' ');

  document.querySelectorAll('[data-action]').forEach((btn) => {
    const kbd = btn.querySelector('kbd:not(.cmd)');
    if (!kbd) return;
    const binding = settings?.keymapEnabled === false ? null : settings?.keymap?.[btn.dataset.action];
    const label = pretty(binding);
    kbd.textContent = label || '';
    kbd.hidden = !label;
  });
}

/**
 * D-218: the browser-wide shortcuts (chrome.commands) beside the buttons they run. Asked of the worker once
 * (UQA_COMMANDS); every repaint reads the saved answer. A command nobody bound shows no chip and no
 * aria-keyshortcuts, so the page never promises a key that does nothing.
 */
const COMMAND_TARGETS = {
  'toggle-recording': '#start',
  'pick-element': '.tool-row[data-tool="pick"] .tool',
  'inject-data': '.tool-row[data-tool="inject"] .tool',
  'record-tab': '.tool-row[data-tool="record"] .tool',
};
let commandShortcuts = null;

function paintCommandChips() {
  if (!commandShortcuts) return;
  for (const [name, selector] of Object.entries(COMMAND_TARGETS)) {
    const shortcut = commandShortcuts.get(name) || '';
    const btn = document.querySelector(selector);
    if (!btn) continue;
    let chip = btn.querySelector('kbd.cmd');
    if (!shortcut) {
      btn.removeAttribute('aria-keyshortcuts');
      if (chip) chip.remove();
      continue;
    }
    btn.setAttribute('aria-keyshortcuts', shortcut);
    if (!chip) {
      chip = document.createElement('kbd');
      chip.className = 'cmd';
      chip.dir = 'ltr';
      const own = btn.querySelector('kbd:not(.cmd)');
      if (own) own.after(chip);
      else btn.append(chip);
    }
    chip.textContent = shortcut;
    chip.hidden = false;
  }
}

async function loadCommandChips() {
  const res = await send({ type: 'UQA_COMMANDS' });
  const list = res?.ok && Array.isArray(res.result) ? res.result : [];
  commandShortcuts = new Map(list.map((c) => [c.name, c.shortcut || '']));
  paintCommandChips();
}

/* -------------------------------------------------------------- the panels */

/**
 * A tool's option panel, found through the row that owns it.
 *
 * The one way to reach a panel. Reading `$('capture-panel')` was how a dozen
 * call sites got a null the moment a render, a mode switch or a surface
 * changed what was on screen — and a null here is a TypeError on the extension
 * card, not a missing tick. `null` when the tool is not on screen is a normal
 * answer: Simple mode draws four rows, so most panels genuinely are not there.
 *
 * The argument is the tool id, the one in `TOOLS[].tool` and on the row's
 * `data-tool` — not the action, which is a different word for four of them.
 */
function panelFor(toolId) {
  return document.querySelector(`.tool-row[data-tool="${toolId}"] .opts-tool`);
}

/**
 * Everything the recording call needs, read once, from the panel that is
 * actually on screen.
 *
 * Four separate `$('cap-mic').checked` reads is four separate TypeErrors
 * waiting for the render that does not draw that row. The panel is the truth
 * while it exists; the settings object — which is what the ticks were painted
 * from in the first place — is the truth when it does not.
 */
function readCaptureOptions() {
  const panel = panelFor('record');
  const tick = (id, key) => {
    const input = panel?.querySelector(`#${id}`);
    return input ? input.checked : !!settings?.[key];
  };
  const choice = (id, key) => {
    const select = panel?.querySelector(`#${id}`);
    return select ? select.value : settings?.[key];
  };
  return {
    mic: tick('cap-mic', 'recordMic'),
    tabAudio: tick('cap-tabAudio', 'recordTabAudio'),
    webcam: tick('cap-webcam', 'recordWebcam'),
    // GROUP G (brief G2). Read like the other three; the worker decides what a
    // screen capture does with it.
    cursor: tick('cap-cursor', 'recordCursor'),
    // The corner is read from the panel for the same reason the ticks are: the
    // tester may have changed it a moment ago, and a change that only reaches
    // the clip after a round trip through storage is a control that does not
    // work on the first press.
    webcamPosition: choice('cap-webcam-pos', 'webcamPosition') || 'bottom-right',
    webcamSize: settings?.webcamSize ?? 22,
  };
}

/* ── the microphone interstitial ──────────────────────────────────────────── */

/**
 * Whether this session has already been told about the microphone.
 *
 * Kept in `chrome.storage.session`, keyed by the session id: it must not
 * survive a browser restart, and it must not leak from one session into the
 * next. A recording started with no session running is its own case and is
 * keyed on `none`, which is cleared with everything else at restart.
 */
const MIC_CONSENT_KEY = 'micConsentShown';

async function micConsentSessionKey() {
  return `${MIC_CONSENT_KEY}:${state?.session?.id || 'none'}`;
}

async function micConsentGiven() {
  try {
    const key = await micConsentSessionKey();
    return !!(await chrome.storage.session.get(key))[key];
  } catch {
    // Storage unavailable is not a reason to skip the line; it is a reason to
    // show it. Failing the other way would silence a consent notice.
    return false;
  }
}

async function rememberMicConsent() {
  try {
    const key = await micConsentSessionKey();
    await chrome.storage.session.set({ [key]: true });
  } catch {
    /* it will be shown again, which is the safe direction */
  }
}

/**
 * Show the line and wait for the answer.
 *
 * Resolves `go`, `mute` or `cancel`. Cancel is what closing the panel or
 * pressing Escape means, and it is not the same as either button: a tester who
 * did not answer has not agreed to anything, and nothing is recorded.
 */
function askMicConsent() {
  const box = document.getElementById('mic-consent');
  if (!box) return Promise.resolve('go');
  box.hidden = false;
  const go = document.getElementById('mic-consent-go');
  const mute = document.getElementById('mic-consent-mute');
  go?.focus();
  return new Promise((resolve) => {
    const done = (answer) => {
      box.hidden = true;
      go?.removeEventListener('click', onGo);
      mute?.removeEventListener('click', onMute);
      document.removeEventListener('keydown', onKey, true);
      resolve(answer);
    };
    const onGo = () => done('go');
    const onMute = () => done('mute');
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // The popup's own Escape handling would close a panel out from under an
      // unanswered question, so this one is taken first and stops there.
      e.stopPropagation();
      e.preventDefault();
      done('cancel');
    };
    go?.addEventListener('click', onGo);
    mute?.addEventListener('click', onMute);
    document.addEventListener('keydown', onKey, true);
  });
}

/**
 * How many documents a scan actually read.
 *
 * ── why this is on every scanner's status line ──────────────────────────
 *
 * Check accessibility, Check the links and Check the fine print used to read
 * the top frame and nothing else, and their results said nothing about it. On a
 * page whose whole content lives in a cross-origin iframe — an artifact view, a
 * payment widget, an embedded portal, a CMS preview — all three handed back a
 * clean bill of health for a document nobody was testing, and there was no way
 * to tell that from the output.
 *
 * They read every frame now. The count is on the line for the other half of the
 * fix: a tester looking at a page they know has an iframe in it, seeing "1
 * frame scanned", has been told something. Silence told them nothing.
 */
function framesRead(result) {
  const n = result?.frameCount ?? result?.frames?.length ?? 1;
  return t(n === 1 ? 'popup.count.frameOne' : 'popup.count.frameMany', { n });
}

/** The chosen scope radio, from the panel if it is drawn and from memory if not. */
/**
 * A count and its noun, agreeing, in whichever language is on.
 *
 * Two keys and a choice between them rather than a plural engine. English needs
 * one and many; Arabic's own dual is out of scope for this round, so the "many"
 * form is written in the «number + singular» shape, which reads correctly from
 * two upwards. Both keys carry `{n}`, so the number sits where the language puts
 * it rather than always in front.
 */
function plural(n, oneKey, manyKey) {
  return t(Number(n) === 1 ? oneKey : manyKey, { n });
}

/** A count stored as CLDR plural forms in one key; `t()` picks the form (platform/i18n.js). */
function pluralCount(key, n) {
  return t(key, { n });
}

function readScope(toolId, name) {
  return panelFor(toolId)?.querySelector(`input[name="${name}"]:checked`)?.value || scopes[name];
}

/* ----------------------------------------------------------------- rendering */

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------- S7: session states */

/**
 * Steps, problems and notes, read the way the report's own Timeline tab does
 * — UQA_GET_TIMELINE, not a new message: S8 owns service-worker.js while this
 * stage runs, so a new handler here would be a CHALLENGE, not a fix.
 */
/**
 * D-1010-141: a finished session's timeline never changes, so it is read once per `id + endedAt` and the
 * promise is kept: five UQA_STATE_CHANGED broadcasts cost one UQA_GET_TIMELINE. A failed read is forgotten
 * so the next paint tries again.
 */
let finishedTimeline = { key: '', promise: null };
function finishedTimelineFor(finished) {
  const key = `${finished.id}:${finished.endedAt ?? ''}`;
  if (finishedTimeline.key === key && finishedTimeline.promise) return finishedTimeline.promise;
  const promise = fetchTimeline(finished.id).then((tl) => {
    if (!tl && finishedTimeline.promise === promise) finishedTimeline = { key: '', promise: null };
    return tl;
  });
  finishedTimeline = { key, promise };
  return promise;
}

async function fetchTimeline(sessionId, extra = {}) {
  if (!sessionId) return null;
  await sigReady;
  const res = await send({ type: 'UQA_GET_TIMELINE', sessionId, ...extra });
  return res.ok ? res.result : null;
}

/**
 * A step's or a problem's text, in report.js's own words (its summarise()) —
 * the same events, so the tester reads the same sentence here and later in
 * the report rather than a second, drifting paraphrase.
 */
function describeEvent(ev) {
  switch (ev.kind) {
    case 'nav': return t('report.ev.opened', { url: iso(ev.url) });
    case 'dom': {
      const what = ev.label || ev.tag || t('report.ev.element');
      if (ev.action === 'click') return t('report.ev.clicked', { what });
      if (ev.action === 'input') return t('report.ev.typed', { value: iso(ev.value ?? ''), what: iso(what) });
      if (ev.action === 'change') return t('report.ev.changed', { what: iso(what), value: iso(ev.value ?? '') });
      if (ev.action === 'submit') return t('report.ev.submitted', { what });
      if (ev.action === 'keydown') return t('report.ev.pressed', { key: ev.key, what });
      return t('report.ev.actionOn', { action: ev.action, what });
    }
    case 'net': return `${ev.method || ''} ${ev.url || ''} › ${ev.error ? t('report.ev.networkError') : ev.status}`.trim();
    case 'console': return `console.${ev.level}: ${ev.text || ''}`;
    case 'pageerror': return ev.text || '';
    case 'note': return ev.text || '';
    default: return ev.text || ev.kind;
  }
}

const isFailEvent = (ev) => !!ev.fail;
/**
 * content/picker.js:933 writes this exact prefix and nothing else does, so it
 * is what tells a tester's own note apart from the picker's "Copy a locator"
 * note — without a new event field S8 would have to add while it owns
 * service-worker.js and content/**.
 */
/**
 * r3-06-1 (D-1010-45): capture losses are shown, not just counted. `captureLost` is events the store refused,
 * `unconfirmed` those whose write timed out. The line is built here (popup.html is not touched) and sits under the meta row.
 */
/*
 * D-1010-111: a live region that is created already holding its text is often skipped by a screen reader. Every region here is in
 * popup.html, empty at load; code only toggles `hidden` and sets text (cleared first, then set in a frame). Unchanged text is not
 * touched, so a two-second poll never re-announces the same sentence.
 */
function liveSet(node, text) {
  if (!node) return;
  const want = text || '';
  if (node.dataset.liveText === want) return;
  node.dataset.liveText = want;
  node.hidden = !want;
  node.textContent = '';
  if (want) requestAnimationFrame(() => { if (node.dataset.liveText === want) node.textContent = want; });
}

function paintLoss(s) {
  const lost = s?.captureLost || 0, unc = s?.unconfirmed || 0;
  liveSet($('live-loss'), !lost && !unc ? '' : t('popup.live.captureLost', { lost, unconfirmed: unc }));
}

/* D-1010-92: a stored mask pattern that does not compile masks every text field (the recorder fails closed); say so. */
function paintMaskNotice() {
  let bad = false;
  const source = settings?.maskExtraPattern;
  if (source) { try { new RegExp(source, 'i'); } catch { bad = true; } }
  liveSet($('mask-broken'), bad ? t('popup.mask.broken') : '');
}

const isPickedNote = (ev) => ev.kind === 'note' && /^Picked (locator|to check)/.test(ev.text || '');
/** The text after the picker's "(strategy, ...): " — the same string it put on
 *  the clipboard (picker.js:920-925). */
const pickedLocatorText = (ev) => (/\):\s*([\s\S]+)$/.exec(ev.text || '') || [, ''])[1];

/*
 * Last locator (DESIGN-SPEC §3.7.3).
 *
 * The same source content/bar.js's setLocator() would use in the page: the
 * picker's own note, not every click the recorder logs — a tester pressed
 * "Copy a locator" for this one on purpose.
 */
let lastLocator = '';
/** Whether the last paint already found a finished, undismissed session — so
 *  the review heading takes focus once per entry, not on every repaint. */
let wasStopped = false;
/** The finished session "New session" put away (r4-09-1). A new session has a new id, so nothing resets it. */
let dismissedSessionId = null; let startInFlight = null; // the Start press still talking to the worker: a Stop pressed meanwhile waits for it, or it reaches a worker with no session yet and is lost
function paintLocatorNow() {
  for (const code of document.querySelectorAll('.ll-code')) {
    code.textContent = lastLocator ? locatorLabel(lastLocator) : t('popup.live.noLocator');
    code.title = lastLocator || '';
    code.classList.toggle('is-empty', !lastLocator);
  }
  for (const btn of document.querySelectorAll('.ll-copy')) btn.hidden = !lastLocator; pickSettled();
}
/**
 * A locator read as a person reads it: what it points at first, the kind of
 * handle after. Pure string work on what the picker already wrote, no new
 * event field. Anything that is not one plain getBy… call (a chain, a css
 * selector) comes back unchanged, so the worst case is today's text. The raw
 * string stays in `title` and is what "Copy again" copies.
 */
function locatorLabel(raw) {
  const str = String(raw || '').trim();
  const m = /^(?:page\.)?getBy(Role|TestId|Label|Placeholder|Text|AltText|Title)\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*(?:,\s*\{([^}]*)\}\s*)?\)$/.exec(str);
  if (!m) return raw;
  const un = (v) => v.replace(/\\(.)/g, '$1');
  const kind = m[1];
  const value = un(m[2] ?? m[3]);
  if (kind === 'Role') {
    const n = /name:\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")/.exec(m[4] || '');
    return n ? `${un(n[1] ?? n[2])} · ${value}` : value;
  }
  const word = { TestId: 'testId', Label: 'label', Placeholder: 'placeholder', Text: 'text', AltText: 'alt', Title: 'title' }[kind];
  return `${value} · ${t(`popup.live.loc.${word}`)}`;
}
async function copyLocatorAgain(btn) {
  if (!lastLocator) return;
  try { await navigator.clipboard.writeText(lastLocator); } catch { /* best-effort, same as picker.js */ }
  say(t('options.sound.ui.copy'), 'ok');
  btn.replaceChildren(icon('check'));
  btn.classList.add('is-done');
  setTimeout(() => { btn.replaceChildren(icon('copy')); btn.classList.remove('is-done'); }, TIMING.copiedTick);
}
$('live-locator-copy')?.addEventListener('click', (e) => copyLocatorAgain(e.currentTarget));

/*
 * The live-session work pane (DESIGN-SPEC §3.6/§4.4).
 *
 * Wide only: popup.css gates the width (@container app width >= 720px) and
 * ".app:has(.tool-row.is-open) .work" already hides the whole pane while a
 * tool's detail is open, which is what "Tool detail replaces Session so far"
 * means. This gates the state (live only) and fills the content.
 */
function timelineRow(ev, startedAt) {
  const row = el('div', isFailEvent(ev) ? 'wl-problem' : '');
  row.append(icon(isFailEvent(ev) ? 'fail' : ev.kind === 'note' ? 'note' : 'steps'));
  row.append(el('span', 'wl-text', describeEvent(ev)));
  if (startedAt) row.append(el('span', 'wl-time', fmtDuration(Math.max(0, ev.ts - startedAt))));
  return row;
}
function fillList(host, rows, emptyKey) {
  if (!host) return;
  host.replaceChildren();
  if (!rows.length) { host.append(el('div', 'wl-empty', t(emptyKey))); return; }
  for (const row of rows) host.append(row);
}
/**
 * The headline number is visibleProblems(events).problems once the timeline has
 * been read; `findingCount` from the worker only fills the first second, so the
 * popup, the badge, the panel and the report cannot disagree for longer than that.
 */
let sgLast = { sid: null, problems: null };
/**
 * State reply to headline. `findingCount` and `failureCount` are the stored-failure tally (36 on /noisy where the
 * badge and the classifier say 2), so they are never the headline while the signal module is loaded. Order: what the
 * timeline gave (visibleProblems + tool findings), then a `problems` field on the state reply (findingTotals().problems)
 * if the worker sends one, then 0; only when core/signal.js could not load, the legacy counts.
 */
function popupProblems(last, sid, reply, sigFailed) {
  if (last.sid === sid && last.problems != null) return last.problems;
  if (reply && reply.problems != null) return reply.problems;
  return sigFailed ? (reply?.findingCount ?? reply?.failureCount ?? 0) : 0;
}
const paintProblemCount = (sid, reply) => popupProblems(sgLast, sid, reply, sigFailed);
/**
 * T-021: the live count carries its tier as a glyph and a word (ui/tone.js), and the first rise of an Error-tier
 * count is said once, politely, at most every 5 s (UX R7). Nothing is said for Warning-tier or unchanged counts.
 */
let toneSeen = 0, toneSaid = 0;
function paintTone(problems, reply) {
  const T = window.UQATone, anchor = $('live-fails-text');
  if (!T || !anchor) return;
  const had = $('live-tone');
  if (!problems) { had?.remove(); toneSeen = 0; return; }
  const tier = reply?.problemsTone === 'error' ? 'error' : 'warning';
  if (!had || !had.classList.contains(`tier-${tier}`)) {
    const chip = T.chip(tier, t(`common.signal.tier.${tier}`));
    chip.id = 'live-tone';
    if (had) had.replaceWith(chip); else anchor.before(chip, ' ');
  }
  if (tier === 'error' && problems > toneSeen && Date.now() - toneSaid > 5000 && $('tone-live')) {
    toneSaid = Date.now();
    $('tone-live').textContent = pluralCount('popup.live.problemsCount', problems);
  }
  toneSeen = problems;
}
let sgTl = { live: null, done: null };
/** Which session the ticker keeps the work pane fresh for; see sessionTicker. */
let workTimeline = { sessionId: null, events: [], maxSeq: 0 };
/** True while the ticker's incremental timeline read is in flight. */
let workReadBusy = false;
const WORK_READ_MS = 10000;

/**
 * Fold an answer into the work pane's cache: an incremental answer appends, a full one replaces.
 *
 * `since` is the seq the request was made from. An incremental answer that was asked for a seq the
 * cache has moved past (a second read landed first) is stale and is dropped (r2-09-1). Events are
 * deduped by seq and kept in (ts, seq) order: a settled input is emitted after later actions but
 * keeps its keystroke time, so a batch can start before the cache's last ts (r2-07-2).
 */
function workEvents(sid, tl, since = null) {
  const cur = workTimeline.sessionId === sid ? workTimeline : null;
  const incremental = !!(cur && tl.incremental);
  if (incremental && since != null && since !== cur.maxSeq) return cur.events;
  const base = incremental ? cur.events : [];
  const prior = incremental ? cur.maxSeq : 0;
  let fresh = tl.events;
  if (fresh.some((e) => e.seq != null && e.seq <= prior)) {
    const have = new Set(base.map((e) => e.seq));
    fresh = fresh.filter((e) => e.seq == null || !have.has(e.seq));
  }
  const seen = new Set();
  fresh = fresh.filter((e) => e.seq == null || (!seen.has(e.seq) && seen.add(e.seq)));
  let events = base.concat(fresh);
  const at = (e) => (Number.isFinite(e.ts) ? e.ts : 0);
  let ordered = true;
  for (let i = Math.max(1, base.length); i < events.length && ordered; i++) {
    if (at(events[i]) < at(events[i - 1])) ordered = false;
  }
  if (!ordered) {
    events = events
      .map((e, i) => [e, i])
      .sort((x, y) => at(x[0]) - at(y[0]) || (x[0].seq || 0) - (y[0].seq || 0) || x[1] - y[1])
      .map((x) => x[0]);
  }
  workTimeline = { sessionId: sid, events, maxSeq: fresh.reduce((m, e) => Math.max(m, e.seq || 0), prior) };
  return events;
}

/**
 * Read the work pane's timeline for `live` and paint it. The first read of a session is whole; after
 * it only what is new since the last seq crosses the channel (07-1: a long session was cloned whole
 * every two seconds), and the counts still come from every event because the cache keeps them.
 * One read in flight: a slow answer must not be overtaken by the next one (r2-09-1). Shared by the
 * ticker and refreshNow (r3-07-2), so a burst of UQA_STATE_CHANGED costs one whole read, not one each.
 */
async function readWorkLive(live) {
  if (!live || workReadBusy) return;
  workReadBusy = true;
  try {
    const since = workTimeline.sessionId === live.id ? workTimeline.maxSeq : 0;
    // r5-07-4: a read the worker never answers must not freeze the pane; a late answer is dropped by the checks below.
    let timer;
    const tl = await Promise.race([
      fetchTimeline(live.id, since ? { sinceSeq: since } : {}),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), WORK_READ_MS); }),
    ]);
    clearTimeout(timer);
    // The session may have stopped, or been replaced, while the read was in flight.
    if (!tl || state.session?.id !== live.id) return;
    // r3-07-3: nothing new since the last seq, so nothing to rebuild or repaint.
    if (tl.incremental && !tl.events?.length) return;
    const events = workEvents(live.id, tl, since);
    const pick = [...events].reverse().find(isPickedNote);
    if (pick) lastLocator = pickedLocatorText(pick);
    paintLocatorNow();
    paintWorkLive(tl.session.startedAt, events);
  } finally {
    workReadBusy = false;
  }
}

function paintWorkLive(startedAt, events, sid = state.session?.id) {
  const pane = $('work-live');
  if (pane) pane.hidden = false;
  const steps = events.filter((e) => !isFailEvent(e) && (e.kind === 'dom' || e.kind === 'nav'));
  let problems = events.filter(isFailEvent);
  let sg = null;
  if (SIG) {
    sg = sgView(events, sid);
    sgLast = { sid, problems: sg.num };
    sgTl.live = () => paintWorkLive(startedAt, events, sid);
    $('live-fails').textContent = sg.num;
    $('live-fails-text').textContent = pluralCount('popup.live.problemsCount', sg.num);
    $('live-fails-text').title = sg.num ? '' : t('common.signal.coverage');
    document.querySelector('#step-live .meta')?.classList.toggle('has-problems', sg.num > 0);
    problems = sg.rows;
  }
  rebuildTechnique(events, sid);
  const notes = events.filter((e) => e.kind === 'note' && !isPickedNote(e) && e.tag !== 'technique');

  if ($('wl-steps-head')) $('wl-steps-head').textContent = `${t('panel.stats.steps')} (${steps.length})`;
  if ($('wl-problems-head')) $('wl-problems-head').textContent = `${t('panel.stats.problems')} (${sg ? sg.num : problems.length})`;
  if ($('wl-notes-head')) $('wl-notes-head').textContent = `${t('panel.timeline.kind.note')} (${notes.length})`;

  fillList($('wl-steps'), steps.slice(-20).reverse().map((e) => timelineRow(e, startedAt)), 'popup.live.stepsEmpty');
  fillList($('wl-problems'), problems.slice(-20).reverse().map((e) => (sg ? sgRow(e, sg, sid, sgTl.live) : timelineRow(e, startedAt))), 'report.broke.emptyTitle');
  fillList($('wl-notes'), notes.slice(-20).reverse().map((e) => timelineRow(e, startedAt)), 'panel.empty.heading');

  const tl = $('wl-timeline');
  if (tl) tl.hidden = steps.length <= 20;
}
$('wl-timeline')?.addEventListener('click', () => $('open-panel')?.click());

/* ── the review pane (DESIGN-SPEC §4.5): #step-done, restyled in place ──── */
function findingRow(ev, startedAt) {
  const row = el('div', 'finding-row');
  row.append(icon('fail'));
  row.append(el('span', 'fr-text', describeEvent(ev)));
  if (startedAt) row.append(el('span', 'fr-time', fmtDuration(Math.max(0, ev.ts - startedAt))));
  return row;
}
function paintReview(finished, events) {
  const steps = events.filter((e) => !isFailEvent(e) && (e.kind === 'dom' || e.kind === 'nav'));
  let problems = events.filter(isFailEvent);
  let sg = null;
  if (SIG) {
    sg = sgView(events, finished.id);
    sgTl.done = () => paintReview(finished, events);
    $('sg-done')?.replaceChildren(sgBlock(sg, finished.id, sgTl.done, true));
    problems = sg.rows;
  }
  const notes = events.filter((e) => e.kind === 'note' && !isPickedNote(e) && e.tag !== 'technique');
  if ($('stat-steps')) $('stat-steps').textContent = String(steps.length);
  if ($('stat-problems')) $('stat-problems').textContent = String(sg ? sg.num : problems.length);
  if ($('stat-notes')) $('stat-notes').textContent = String(notes.length);

  const list = $('findings-list');
  if (list) {
    list.replaceChildren();
    const top3 = problems.slice(0, 3);
    const rowFor = (ev) => (sg ? sgRow(ev, sg, finished.id, sgTl.done) : findingRow(ev, finished.startedAt));
    if (!top3.length) {
      const empty = el('div', 'finding-row is-empty');
      empty.append(icon('pass'), el('span', 'fr-text', t('report.broke.emptyTitle')));
      list.append(empty);
    } else {
      for (const ev of top3) list.append(rowFor(ev));
    }
  }
  const seeAll = $('findings-see-all');
  if (seeAll) {
    seeAll.hidden = problems.length <= 3;
    if (problems.length > 3) seeAll.textContent = t('report.headline.seeAll', { n: problems.length });
  }
  paintDoneCard(finished, events, sg ? sg.num : problems.length);
}
$('findings-see-all')?.addEventListener('click', () => $('view-report')?.click());

/*
 * The header status chip (DESIGN-SPEC §3.2): live only, updated every second
 * from the same clock #live-time already uses. Not a live region — the label
 * is refreshed, not announced, once a second (§3.2: "It is not a live
 * region").
 */
function paintChip(recording, startedAt) {
  const chip = $('status-chip');
  if (!chip) return;
  chip.hidden = !recording;
  if (!recording) return;
  const since = Math.max(0, Math.floor((Date.now() - (startedAt || Date.now())) / 1000));
  const timer = $('chip-timer');
  if (timer) timer.textContent = fmtElapsed(startedAt);
  paintBackTimer(startedAt);
  chip.setAttribute('aria-label', t('popup.record.since', { m: Math.floor(since / 60), s: since % 60 }));
}
/** §3.2: "Click: focuses Stop in the session strip". */
$('status-chip')?.addEventListener('click', () => $('stop')?.focus());

/*
 * Restricted / worker banners (DESIGN-SPEC §4.7): warn colours, never red —
 * nothing has failed, there is simply nothing to test yet or nobody to ask.
 * "restricted" is siteAccess.pattern === null (a page no grant could cover); "worker" is the one send()
 * already reports as popup.err.workerSilent (see workerSilent() above).
 */
let workerDown = false;
/** One renderer for every warning box (P1-8): its text, and its fix as a button. spec = { text, sub?, buttonKey, action } or null. */
function fillBanner(banner, spec) {
  const [line, sub] = [banner.querySelector('.state-banner-line:not(.state-banner-sub)'), banner.querySelector('.state-banner-sub')];
  const btn = banner.querySelector('button');
  line.textContent = spec.text;
  if (sub) sub.textContent = spec.sub || '';
  btn.hidden = !spec.buttonKey;
  btn.textContent = spec.buttonKey ? t(spec.buttonKey) : '';
  btn.onclick = spec.action ? () => spec.action() : null;
}
function paintBanner() {
  const banner = $('state-banner');
  if (!banner) return;
  const kind = workerDown ? 'worker' : !siteAccess.pattern ? 'restricted' : '';
  banner.hidden = !kind;
  if (!kind) return;
  banner.dataset.kind = kind;
  const bicon = $('banner-icon');
  if (bicon) bicon.replaceChildren(icon(kind === 'worker' ? 'warning' : 'restricted'));
  fillBanner(banner, kind === 'worker'
    ? { text: t('popup.err.workerSilent'), buttonKey: 'popup.stale.reload', action: () => reloadCarefully() }
    : { text: t('popup.access.notAPage', { elsewhere: '' }), sub: t('popup.banner.restrictedSub'), buttonKey: 'popup.banner.practice', action: () => openPractice() });
}
/** The autopilot line (popup/autopilot-banner.js, contract C6): paused, running by itself, or stopped after 30 quiet minutes. */
async function paintAutoBanner() {
  const banner = $('auto-banner');
  if (!banner || typeof autopilotBanner !== 'function') return;
  const spec = autopilotBanner(await autopilotSiteState(), state.session || state.lastSession, t);
  banner.hidden = !spec;
  if (spec) fillBanner(banner, { ...spec, action: async () => { await spec.action?.(); refresh(); } });
}
$('disk-stop')?.addEventListener('click', () => $('stop').click());

/**
 * One round trip, not five.
 *
 * This asked the worker for the state, then the layout stress, then the rules,
 * then the recording, then the switch — each awaiting the last. Throttled to a
 * low-end laptop that was most of a 1.4-second popup open against a 900ms
 * budget, and a tool reached for thirty times a day has to feel instant or it
 * stops being reached for.
 *
 * Every part still fails soft on the worker's side, so a missing content script
 * costs a chip rather than the paint.
 */
let earlyState = null;
async function refreshNow() {
  // Taken before the round trip, not after it: see `armedGen`. This snapshot can
  // be answered while a sleep is still half done, and must not repaint the
  // switch if the sleep has landed in the meantime.
  const gen = armedTicket();
  // perf-1010 P3: boot() asked for the state before it had a tab id; take that answer once, so the state read overlaps the first wave and the render.
  const early = earlyState;
  earlyState = null;
  const res = await (early || send({ type: 'UQA_POPUP_STATE', ...(ctx.tabId != null ? { tabId: ctx.tabId } : {}) }));
  if (!res.ok) {
    say(res.error, 'err');
    // Leave the idle card usable rather than showing nothing at all.
    $('step-idle').hidden = false;
    // S7 §4.7: the same "worker is not responding" send() already reports.
    workerDown = res.error === workerSilent();
    paintBanner();
    return;
  }
  workerDown = false;
  paintBanner();
  state = res.result;
  // The worker resolved the window under test on its way to answering this, so
  // take its answer rather than paying for a second round trip to derive the
  // same thing slightly differently.
  if (state.armed?.windowId != null) ctx.windowId = state.armed.windowId;
  // The usage log rides along with the state, so the ticks stay right without a
  // second round trip — including when the tool was used from the right-click
  // menu or a keyboard shortcut, which the popup never sees.
  used = state.used || {};
  paintUsage();

  /*
   * "Recording" means a session row this popup can actually read.
   *
   * Deleting the running session left `activeSessionId` pointing at a row that
   * no longer existed, so the worker answered `recording: true` with
   * `session: null` — and three lines below, `state.session.charter` threw. A
   * TypeError here is not a missing charter: it aborts the rest of the paint,
   * so the record button and the master switch both froze in whatever state
   * they were last drawn in, on the extension's own card. The worker refuses
   * that delete now; this is the half that means a state the popup has never
   * seen before costs it a card rather than the whole paint.
   */
  const recording = !!state.recording && !!state.session;
  // After stop the worker has no *active* session; it hands back the one that
  // just finished so its exports stay reachable.
  const finished = state.lastSession || null;
  const stopped = !recording && !!finished && finished.id !== dismissedSessionId;

  $('step-idle').hidden = recording || stopped;
  $('step-live').hidden = !recording;
  $('step-done').hidden = !stopped;
  paintPrimary();
  paintAutoBanner();
  restoreDraft();

  if (recording) {
    $('live-charter').textContent = state.session.charter;
    $('live-events').textContent = state.eventCount;
    /*
     * Every finding, not only the failing requests.
     *
     * The line says "problems", and it was painting `failureCount` — failing
     * requests, console errors and uncaught exceptions. A run that had found 83
     * accessibility violations, two broken links, four clipped elements and five
     * fine-print gaps and had broken no request read as 0 problems, on the popup
     * and then again on the report (research/58, finding 16). `findingCount` is
     * counted by `countFindings` in core/sessions.js, which is the same function
     * the report headline and the Markdown export use.
     *
     * `failureCount` is the fallback, not a second opinion: it is what an older
     * worker answers while an update is settling.
     */
    const problems = paintProblemCount(state.session.id, state);
    $('live-fails').textContent = problems;
    $('live-events-text').textContent = pluralCount('popup.live.eventsCount', state.eventCount);
    $('live-fails-text').textContent = pluralCount('popup.live.problemsCount', problems);
    paintTone(problems, state);
    document.querySelector('#step-live .meta')
      .classList.toggle('has-problems', problems > 0);
    paintLoss(state);
    sessionTicker.start();
    paintChip(true, state.session.startedAt);
    // S7 §3.6/§4.4: the work pane and the last locator, from the same
    // UQA_GET_TIMELINE the report's Timeline tab reads. sessionTicker
    // (below) re-reads it every two seconds while the session stays live.
    // r3-07-2: the same since/maxSeq path and the same one-read-in-flight guard as the ticker, so
    // only the first read after a session starts is whole.
    readWorkLive(state.session);
  } else {
    sessionTicker.stop();
    paintChip(false);
    $('work-live').hidden = true;
    workTimeline = { sessionId: null, events: [], maxSeq: 0 };
  }

  // A clip can run without a session, so its clock cannot hang off one.
  if (state.capture?.recording) clipTicker.start();
  else clipTicker.stop();

  if (stopped) {
    // r3-09-4: the same mm:ss the live card shows, not a raw count of seconds.
    $('done-summary').textContent = doneLine(finished); if ($('stat-duration')) $('stat-duration').textContent = doneTime(finished); paintDoneName(finished);
    // S7 §4.5: the stat tiles and key findings, from the same UQA_GET_TIMELINE
    // as the live pane — this session is finished, so one read is enough.
    finishedTimelineFor(finished).then((tl) => { if (tl) paintReview(finished, tl.events); });
    // "Entry: focus moves to the heading" — once per entry, not every repaint
    // this branch runs on (every boot and every UQA_STATE_CHANGED broadcast).
    if (!wasStopped) $('review-heading')?.focus();
    wasStopped = true;
  } else {
    wasStopped = false;
  }

  const on = !!state.rtl?.enabled;
  document.querySelector('[data-action="rtl"]')?.setAttribute('aria-pressed', String(on));

  // Painted from what the one message already returned. Each of these still
  // works standalone — they are called on their own after an action — so the
  // argument is an optimisation, never a requirement.
  refreshRuleState(state.rules);
  await paintRecording(state.capture, state.storage);
  paintSwitch(state.armed, gen);
}

// `var`, not `const`: a top-level `function` declaration puts itself on the
// window and the click-through harness drives `window.paintRecording()`
// directly to reach a recording state no script can start. A `const` would be
// a lexical binding the harness cannot see; `var` keeps the property.
var refresh = safe(refreshNow, 'refresh');

/**
 * A repeating paint that is safe to start twice — the property both clocks
 * needed, since `refreshNow()` starts them on every paint. Four functions and
 * two module-level handles said the same three lines.
 */
function makeTicker(fn, ms) {
  let id = null;
  return {
    start() { id ??= setInterval(fn, ms); },
    stop() { clearInterval(id); id = null; },
  };
}

/**
 * The live clock.
 *
 * `sessionTicker` is started from the *session* branch of `refreshNow`, so the
 * recording line's "3m 12s so far" only ever advanced while a QA session
 * happened to be running — a clip started outside one sat frozen at its first
 * reading for the whole recording. The clip is repainted here whatever the
 * session is doing; the session counters below still guard on `state.session`,
 * because those genuinely need one.
 */
let sessionTick = 0;
const sessionTicker = makeTicker(async () => {
  if (!state.session) return;
  // r3-09-5: the session this tick is for. Every await below can outlive it (stop, or a new
  // session), and `state.session` is null between sessions.
  const live = state.session;
  // The clock is local arithmetic — no reason to ask the worker for the time.
  $('live-time').textContent = fmtElapsed(state.session.startedAt); // P0-4: one clock, one rounding
  paintChip(true, state.session.startedAt); // S7 §3.2: the chip's own clock, same arithmetic
  if (++sessionTick % 2) return; // counts every other second is plenty
  const res = await send({ type: 'UQA_GET_STATE' });
  if (state.session?.id !== live.id) return; // r4-09-3: ids, not objects; refresh() replaces the object
  if (res.ok && res.result.recording) {
    const problems = paintProblemCount(live.id, res.result);
    $('live-events').textContent = res.result.eventCount;
    $('live-fails').textContent = problems;
    $('live-events-text').textContent = pluralCount('popup.live.eventsCount', res.result.eventCount);
    $('live-fails-text').textContent = pluralCount('popup.live.problemsCount', problems);
    state.eventCount = res.result.eventCount;
    state.failureCount = res.result.failureCount;
    state.findingCount = res.result.findingCount;
    state.problems = res.result.problems;
    used = res.result.used || used;
    paintUsage();
    paintTone(problems, res.result);
    paintLoss(res.result);
    document.querySelector('#step-live .meta')
      .classList.toggle('has-problems', problems > 0);
  }
  // S7 §3.6/§4.4: the work pane. The first read is whole; after it only what is new since the last
  // seq crosses the channel (07-1: a long session was cloned whole every two seconds), and the
  // counts still come from every event because the cache keeps them.
  // One read in flight: a slow answer must not be overtaken by the next tick's (r2-09-1).
  await readWorkLive(live);
}, TIMING.tick);

// Repainted from what the last paint already learned, never with a fresh round
// trip: this runs every second for the length of the clip, and two messages a
// second to the worker for a clock that is local arithmetic would be the most
// expensive thing the popup does.
const clipTicker = makeTicker(() => {
  if (!lastCapture?.recording) return clipTicker.stop();
  paintRecording(lastCapture, lastRoom);
}, TIMING.tick);

/* ------------------------------------------------------------------- session */

/**
 * The page the tools should act on.
 *
 * Asked of the worker, which skips extension pages — see `UQA_TARGET_TAB`. The
 * direct query is kept as a fallback so a worker that is still waking up costs
 * a slightly worse answer rather than no answer at all.
 */
async function activeTab() {
  const res = await send({ type: 'UQA_TARGET_TAB' });
  if (res.ok && res.result) return res.result;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tab || null;
}

/**
 * Refresh `ctx` from the page under test, and hand back the tab it was read
 * from so the caller does not ask twice.
 *
 * The window is only overwritten when there is one to overwrite it with: a
 * moment where no tab is testable must not blank out the window the tester
 * just woke, or the switch reads "Asleep" because they happened to be looking
 * at the new-tab page.
 */
async function resolveCtx() {
  const tab = await activeTab();
  ctx.tabId = tab?.id ?? null;
  if (tab?.windowId != null) ctx.windowId = tab.windowId;
  return tab;
}

function isTestable(tab) {
  return tab && (!/^(chrome|edge|about|devtools|chrome-extension):/.test(tab.url || '') || isPracticeTab(tab.url));
}

/**
 * Which of the three session cards is showing, remembered so a press that the
 * worker refuses can put the popup back exactly as it found it.
 *
 * The charter goes in the snapshot too: clearing the field is part of the
 * optimistic paint, and a start that fails having also eaten what the tester
 * typed is a worse button than one that merely lagged.
 */
function sessionCards() {
  return {
    idle: $('step-idle').hidden,
    live: $('step-live').hidden,
    done: $('step-done').hidden,
  };
}

function showSessionCards({ idle, live, done }) {
  $('step-idle').hidden = idle;
  $('step-live').hidden = live;
  $('step-done').hidden = done;
  paintPrimary();
}

$('start').addEventListener('click', async () => {
  const oneTap = startOneTap(); // the site is asked for here, synchronously, inside the click
  const charter = $('charter').value.trim() || t('popup.session.untitled');

  const started = await (startInFlight = optimistic(
    (pending) => {
      const cards = sessionCards();
      const typed = $('charter').value;
      // The live card, with the charter the tester just wrote and a clock at
      // zero. Reading a session's own start time back off the worker is the
      // one thing a start cannot do before the worker has answered, and 00:00
      // is not a guess — it is what the clock says at the moment of the press.
      showSessionCards({ idle: true, live: false, done: true });
      $('live-charter').textContent = charter;
      $('live-time').textContent = '00:00';
      $('live-events').textContent = '0';
      $('live-fails').textContent = '0';
      $('live-events-text').textContent = pluralCount('popup.live.eventsCount', 0);
      $('live-fails-text').textContent = pluralCount('popup.live.problemsCount', 0);
      document.querySelector('#step-live .meta')?.classList.remove('has-problems');
      $('charter').value = '';
      pending($('step-live'));
      // The English stays beside the key: tools/test-optimistic.mjs reads this
      // exact sentence out of the source, because a suite waits for it on #status.
      say(tf('popup.session.recording', 'Recording. Use the page as a tester would.'), 'ok', { silent: true });
      return () => {
        showSessionCards(cards);
        $('charter').value = typed;
      };
    },
    async () => {
      // Which page this is testing, asked after the paint rather than before
      // it. `resolveCtx()` is a round trip to the worker, and it used to sit
      // between the click and the first pixel.
      //
      // "This is not a web page" therefore arrives as a refusal like any other,
      // and reverts the card the same way — same sentence, same tone, one
      // fewer wait before the tester sees anything at all.
      const refused = await oneTap; if (refused) return refused; // asked, allowed and woke inside the press (popup/onboard.js)
      const tab = await resolveCtx();
      if (!isTestable(tab)) return { ok: false, error: needsPage() };

      // Reading the page's environment is part of the round trip, not part of
      // the paint: it is a second message to a second process, and the card is
      // already on screen before it is asked.
      let env = null;
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            viewport: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
            dir: document.documentElement.dir || 'ltr',
          }),
        });
        env = result;
      } catch {
        /* environment details are a nicety, not a requirement */
      }

      // The start cue, now: the request is on its way and arming the microphone
      // (which awaits getUserMedia) has not begun. From here until the stop reply
      // a session with the mic on is silent, so no cue lands in the recording.
      uqaSound()?.play('session.start');
      if (readCaptureOptions().mic) uqaSound()?.configure({ suspended: true });
      return send({
        type: 'UQA_START',
        charter,
        tabId: tab.id,
        startUrl: tab.url,
        // Explicitly none: a session runs until the tester stops it.
        timeboxMinutes: null,
        env,
      });
    },
    // No `say()` here: the optimistic paint already said it, in the same words,
    // and repeating it would replay the sound for one press. `refresh()` is the
    // reconciliation — it repaints the card from `UQA_POPUP_STATE` and starts
    // the real clock against the session's real start time.
    { settle: () => refresh() }
  ));
  // A start that failed never armed the microphone: give the popup its sound back.
  if (started?.ok === false) uqaSound()?.configure({ suspended: false });
});

$('charter').addEventListener('keydown', (e) => {
  // An Enter that confirms an IME composition (Arabic, CJK) is not a request to start.
  if (e.key === 'Enter' && !e.isComposing) $('start').click();
});

$('stop').addEventListener('click', async () => {
  const formats = [...document.querySelectorAll('[data-format], #copy-report')]; // the Copy report press waits for the saved session too

  await optimistic(
    (pending) => {
      const cards = sessionCards();
      const summary = $('done-summary').textContent;
      const disabled = formats.map((btn) => btn.disabled);
      // The clock stops with the card it belongs to. Left running it would keep
      // asking the worker for counts on a session that is being closed.
      sessionTicker.stop();
      showSessionCards({ idle: true, live: true, done: false });
      // The exports are the one thing that genuinely cannot be guessed: until
      // the worker has written the session there is no file to make. So the
      // stopped card appears at once and its formats stay disabled until the
      // reply enables them, rather than offering a button that would fail.
      for (const btn of formats) btn.disabled = true;
      $('done-summary').textContent = t('popup.done.saving');
      pending($('step-done'));
      say(''); // the card's own heading says "Session saved."; the status line must not say it a second time
      return () => {
        showSessionCards(cards);
        $('done-summary').textContent = summary;
        formats.forEach((btn, i) => { btn.disabled = disabled[i]; });
        // The card is live again, so its clock has to be too.
        if (!$('step-live').hidden) sessionTicker.start();
      };
    },
    async () => { await startInFlight; return send({ type: 'UQA_STOP' }); },
    {
      settle: async (res) => {
        /*
         * Settled before the exports are offered, not beside them.
         *
         * `refresh()` was called without being awaited, so the buttons lit up
         * while the line above them still read "Saving the session…". On this
         * fixture that is a blink; on a session carrying a long recording it is
         * the last thing on screen before the report, and it reads as a product
         * that has not finished rather than one that has. The fallback line
         * matters for the same reason: whatever `refresh()` finds, the tester
         * is never left looking at a progress message beside a live button.
         */
        await refresh();
        const line = $('done-summary');
        if (line.textContent === t('popup.done.saving')) line.textContent = t('popup.done.savedPick');
        for (const btn of formats) btn.disabled = false;
        // D-235: the worker stopped the session but could not write its last events. Said plainly, in the tester's language.
        const stopped = res?.result ?? res;
        if (stopped?.saved === false && stopped.error) say(stopped.error, 'err', { silent: true });
        // The worker has confirmed the session is saved and the tracks are stopped:
        // the microphone is cold, so the cue may sound (and never before).
        uqaSound()?.configure({ suspended: false });
        uqaSound()?.play('session.stop');
      },
    }
  );
});

/*
 * Reporter mode, opened for somebody else.
 *
 * A tab rather than a panel: the person filling it in is usually not the person
 * who opened the popup, and a surface that vanishes when the popup loses focus
 * is no use to them.
 */
$('open-reporter')?.addEventListener('click', async () => {
  await send({ type: 'UQA_OPEN_REPORTER' });
  dismiss();
});

$('new-session').addEventListener('click', () => {
  dismissedSessionId = state.lastSession?.id ?? null; // r4-09-1: kept outside `state`, which every refresh() replaces; the session stays on disk
  try { if (dismissedSessionId) chrome.storage.session.set({ dismissedSessionId })?.catch?.(() => {}); } catch { /* best effort */ } // r5-09-1: the worker stops returning it, cleared on the next stop
  $('step-done').hidden = true;
  $('step-idle').hidden = false;
  say(''); // the old "Session saved." belongs to the card that just went away
  paintPrimary();
  $('charter').focus();
});

/* -------------------------------------------------------------------- export */

function exportableSession() {
  return state.session || state.lastSession || null;
}

document.querySelectorAll('[data-format]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const target = exportableSession();
    if (!target) return say(t('popup.err.noSessionExport'), 'err');
    // r3-09-3: disabled before the first await, so a second click cannot start a second export; always restored.
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const res = await send({ type: 'UQA_EXPORT', sessionId: target.id, format: btn.dataset.format });
      if (!res.ok) return say(res.error, 'err');

      // An <a download> click in a popup is cancelled the moment the popup closes,
      // which is why exports produced no file at all. Hand it to the download
      // manager instead, and confirm where it actually landed.
      const { filename, content, mime, encoding } = res.result;
      say(t('popup.export.saving'));
      // Into the session's folder in the tree, like everything else — a loose
      // file in Downloads was the one export that did not know where it belonged.
      const { exportPath } = await import('../core/filing.js');
      // The "Save into" folder too, and not only the clock. Without it this
      // surface filed into `Downloads/QA Wrap/` while the report page filed the
      // same session into `Downloads/<the tester's folder>/QA Wrap/` — Nader's
      // "the download is not consistent", from the one place two surfaces
      // disagreed about the same setting.
      const path = exportPath(btn.dataset.format, target, {
        clock: settings?.clock || '24',
        folder: settings?.downloadFolder || '',
      });
      let data = content;
      if (encoding === 'base64') { const { fromBase64 } = await import('../core/xlsx.js'); data = new Blob([fromBase64(content)], { type: mime }); }
      const out = await window.UQADownload.saveFiled(data, path, mime);
      if (!out.ok) return say(t('popup.export.failed', { error: out.error }), 'err');
      if (out.how === 'folder') return say(t('popup.export.savedTo', { path: out.path }), 'ok');
      const where = await window.UQADownload.whereIsIt(out.id);
      say(where ? t('popup.export.savedTo', { path: where }) : t('popup.export.savedDownloads', { file: filename }), 'ok');
    } catch (err) {
      say(t('popup.export.failed', { error: err?.message || String(err) }), 'err');
    } finally {
      btn.disabled = false;
    }
  });
});

/* --------------------------------------------------------------------- tools */

/**
 * E8's reset, and E7's: unmark the picked field and empty the panel.
 *
 * GROUP G, 7 September 2026. This used to send `UQA_PARTITIONS` carrying
 * `CLEAR_FIELD_SELECTOR` — a selector nobody's page could match — because the
 * injector's `UQA_CLEAR_FIELD` listener had no row in the service worker's
 * routing table, and a message with no row is delivered nowhere. The row
 * exists now (`background/dispatch-tables.js`, and the handler beside
 * `UQA_PARTITIONS`), so the reset is the message it always named, and the
 * sentinel is gone from this file and from `content/data-injector.js`.
 */
async function clearPickedField() {
  lastPartitions = null;
  paintPartitions();
  await resolveCtx();
  await send({ type: 'UQA_CLEAR_FIELD', tabId: ctx.tabId });
  say(t('popup.partitions.cleared'), 'ok');
}

/**
 * The reading, drawn into whichever panel is on screen right now.
 *
 * Kept apart from the reading itself because the panel is stamped fresh by
 * every renderTools(): pressing Simple or Expert used to leave the classes on
 * screen only because the old panel was physically carried across the render.
 * Now the last answer is remembered and drawn again, which is the same
 * behaviour without the moving DOM.
 */
let lastPartitions = null;

/*
 * r3-04-1 (D-1010-51): technique coverage. Every partition and boundary row has a stable id; a fill records the applied id as a
 * tag:'technique' note through the ordinary note message (stored, scrubbed and exported like any note), and the first fill for a
 * field also records the designed id list. Ids carry the field's key, so a session-wide count is a plain set count.
 * A row the tool cannot fill (a pattern field's "type your own") is not designed here: it could never be applied.
 */
/*
 * D-1010-94: the key is the field's locator (the selector string), so two unnamed fields never collide; spaces and '#' are
 * encoded because a note lists ids separated by spaces and an id is split from its key at the last '#'. D-1010-93: a valid
 * row that needs the tester's own value is designed too, and counts once a typed value passes the field's pattern.
 */
const techField = () => {
  const f = lastPartitions?.field || {};
  return String(f.selector || f.name || f.id || f.label || f.type || 'field').replace(/\s+/g, '_').replace(/#/g, '%23').slice(0, 160);
};
const designedIds = () => {
  const k = techField();
  return [
    ...(lastPartitions?.partitions || []).map((p) => `${k}#p:${p.id}`),
    ...(lastPartitions?.boundaries || []).flatMap((b) => b.values.map((v) => `${k}#${v.id}`)),
  ];
};
const techDesigned = new Set(); // field keys whose designed list is already in the session
const techDesignedIds = new Set(); // every designed id of every field opened (rebuilt from the notes on open)
const techApplied = new Set();
let techSid = null;
const techNote = (text) => send({ type: 'UQA_NOTE', text, tag: 'technique' }).catch(() => null);
const techKey = (id) => id.slice(0, id.lastIndexOf('#'));

/** D-1010-94: the applied and designed sets are read back from the session's technique notes, so a reopened popup agrees with the export line. */
function rebuildTechnique(events, sid) {
  if (sid !== techSid) { techSid = sid; techDesigned.clear(); techDesignedIds.clear(); techApplied.clear(); }
  for (const e of events || []) {
    if (e.kind !== 'note' || e.tag !== 'technique') continue;
    const m = /^Technique: (applied|designed) (.+)$/.exec(e.text || '');
    if (!m) continue;
    for (const id of m[2].split(' ').filter(Boolean)) {
      techDesignedIds.add(id);
      if (m[1] === 'applied') techApplied.add(id); else techDesigned.add(techKey(id));
    }
  }
  paintCoverage();
}

/**
 * r10-04-5: the designed list is written when the panel is first built for a field, not after the first applied value, so an
 * export of a field that was opened and never used reads "0 of N" instead of saying nothing. Needs a session; a failed note
 * is forgotten so the first applied value still writes it.
 */
async function noteDesignedOnOpen() {
  if (!state.session) return;
  const k = techField();
  const ids = designedIds();
  if (!ids.length || techDesigned.has(k)) return;
  techDesigned.add(k);
  const noted = await techNote(`Technique: designed ${ids.join(' ')}`);
  if (noted?.ok) for (const id of ids) techDesignedIds.add(id);
  else techDesigned.delete(k);
  paintCoverage();
}

/** Does a typed value pass the field's pattern (the whole value, as the browser checks it), or, with none, the telephone shape? */
function ownValuePasses(field, value) {
  const v = String(value ?? '').trim();
  if (!v) return false;
  if (field?.pattern) {
    for (const flags of ['v', 'u', '']) { try { return new RegExp(`^(?:${field.pattern})$`, flags).test(v); } catch { /* try the next flag set */ } }
    return false;
  }
  return field?.type === 'tel' && /^\+?[0-9][0-9 ()-]{5,18}$/.test(v);
}

function paintCoverage() {
  const all = new Set([...techDesignedIds, ...(lastPartitions ? designedIds() : [])]);
  const covered = [...all].filter((id) => techApplied.has(id)).length;
  const fields = new Set([...all].map(techKey)).size;
  const text = all.size ? t('popup.partitions.coverage', { covered, total: all.size, n: fields }) : '';
  liveSet($('tech-cover-live'), text);
  const out = panelFor('blackbox')?.querySelector('#partitions-out');
  if (!out || !lastPartitions) return;
  let chip = out.querySelector('.tech-cover');
  if (!chip) { chip = el('p', 'fine tech-cover'); out.prepend(chip); }
  chip.textContent = text;
}

/**
 * r1-10-1: a black-box row's sentence in the popup's language. The core hands back `{ code, params }`
 * beside its English text; a param may itself be a `{ code, params }`. No code (a label the page wrote,
 * such as an option's own text) or no table entry leaves the English text on screen.
 */
function bbText(ref, fallback) {
  if (!ref || !ref.code) return fallback;
  const params = {};
  for (const [k, v] of Object.entries(ref.params || {})) params[k] = v && typeof v === 'object' && v.code ? bbText(v, '') : v;
  return t(`popup.partitions.bb.${ref.code}`, params);
}

function paintPartitions() {
  const out = panelFor('blackbox')?.querySelector('#partitions-out');
  if (!out) return;
  out.replaceChildren();
  if (!lastPartitions) return;
  const { field, partitions, boundaries } = lastPartitions;
  paintCoverage();

  const head = el('p', 'fine');
  head.textContent =
    t('popup.partitions.fieldHead', {
      field: field.label || field.name || t('popup.partitions.thatField'),
      type: field.type,
    }) +
    [
      t(field.required ? 'popup.partitions.required' : 'popup.partitions.optional'),
      field.maxlength ? t('popup.partitions.maxChars', { n: field.maxlength }) : null,
      field.min != null && field.min !== '' ? t('popup.partitions.min', { v: field.min }) : null,
      field.max != null && field.max !== '' ? t('popup.partitions.max', { v: field.max }) : null,
      field.pattern ? t('popup.partitions.hasPattern') : null,
    ]
      .filter(Boolean)
      .map((item) => t('popup.partitions.item', { item }))
      .join('');
  out.append(head);

  for (const [title, list] of [
    [t('popup.partitions.validHead'), partitions.filter((p) => p.valid)],
    [t('popup.partitions.invalidHead'), partitions.filter((p) => !p.valid)],
  ]) {
    if (!list.length) continue;
    out.append(el('p', 'opts-head', title));
    const group = el('div', 'part-list');
    for (const part of list) {
      const row = el('button', `part ${part.valid ? 'is-valid' : 'is-invalid'}`);
      row.type = 'button';
      const partLabel = bbText(part.i18n?.label, part.label);
      const partWhy = bbText(part.i18n?.why, part.why);
      row.append(el('b', null, partLabel));
      // r1-04-3: a pattern field has no sample the tool can vouch for: say so and let the tester type one.
      row.append(el('code', 'part-sample', part.needsInput ? t('popup.partitions.needsInput') : part.sample === '' ? t('popup.value.empty') : String(part.sample).slice(0, 28)));
      row.append(el('em', null, partWhy));
      if (part.truncated) row.append(el('em', 'part-cut', bbText(part.i18n?.note, part.note)));
      row.title = t('popup.partitions.putTitle');
      // The value goes into the field rather than onto the clipboard: the whole
      // point of standing in the field is not having to leave it.
      row.addEventListener('click', () => (part.needsInput ? ownValueForm(row, part, partLabel, partWhy) : fillField(part.sample, partLabel, `${techField()}#p:${part.id}`)));
      group.append(row);
    }
    out.append(group);
  }

  for (const boundary of boundaries) {
    out.append(el('p', 'opts-head', bbText(boundary.i18n?.boundary, boundary.boundary)));
    const group = el('div', 'part-list');
    for (const value of boundary.values) {
      const row = el('button', `part ${value.valid === false ? 'is-invalid' : value.valid ? 'is-valid' : 'is-unknown'}`);
      row.type = 'button';
      const position = bbText(value.i18n?.position, value.position);
      row.append(el('b', null, position));
      row.append(el('code', 'part-sample', value.value === '' ? t('popup.value.empty') : `${String(value.value).slice(0, 20)}${value.value.length > 20 ? `… (${value.value.length})` : ''}`));
      row.append(el('em', null, bbText(value.i18n?.why, value.why)));
      if (value.truncated) row.append(el('em', 'part-cut', bbText(value.i18n?.note, value.note)));
      row.addEventListener('click', () => fillField(value.value, position, `${techField()}#${value.id}`));
      group.append(row);
    }
    out.append(group);
  }
}

/** D-1010-93: a pattern field's valid row. The tester types a value; it is put into the field and counted only if it passes the pattern. */
function ownValueForm(row, part, label, why) {
  say(why);
  let form = row.nextElementSibling?.classList.contains('part-own') ? row.nextElementSibling : null;
  if (!form) {
    form = el('div', 'part-own');
    const input = el('input');
    // D-1010-139: a password field gets a masked input, and nothing here echoes what is typed (say() names the part, never the value).
    const secret = lastPartitions?.field?.type === 'password';
    input.type = secret ? 'password' : 'text';
    if (secret) input.autocomplete = 'off';
    input.setAttribute('aria-label', t('popup.partitions.ownLabel'));
    const go = el('button', 'btn btn-sm', t('popup.partitions.ownUse'));
    go.type = 'button';
    const submit = () => {
      if (!ownValuePasses(lastPartitions?.field, input.value)) return say(t('popup.partitions.ownNo'), 'err');
      fillField(input.value.trim(), label, `${techField()}#p:${part.id}`);
    };
    go.addEventListener('click', submit);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
    form.append(input, go);
    row.after(form);
  }
  form.querySelector('input')?.focus();
}

async function fillField(value, label, techId) {
  await resolveCtx();
  const res = await send({ type: 'UQA_INJECT_VALUE', value, tabId: ctx.tabId });
  if (!res.ok) return say(res.error, 'err');
  window.UQASound?.play('value.inserted');
  say(t('popup.partitions.put', { label }), 'ok');
  if (techId) {
    const k = techField();
    // The designed list is sent once per field; a failed note (no session) is not an applied row and sends nothing more.
    const first = !techDesigned.has(k);
    if (first) techDesigned.add(k);
    const noted = await techNote(`Technique: applied ${techId}`);
    if (noted?.ok) {
      techApplied.add(techId);
      for (const id of designedIds()) techDesignedIds.add(id);
      if (first) await techNote(`Technique: designed ${designedIds().join(' ')}`);
    } else if (first) techDesigned.delete(k);
    paintCoverage();
  }
}

/* --------------------------------------------- results shown on the card */

/**
 * Open a tool's own panel from code, the way pressing its chevron would.
 *
 * Used by the three tools whose result *is* the panel. Going through
 * `setToolPanel()` rather than setting `hidden` keeps the four things that
 * belong together together: the chevron's `aria-expanded`, the card's open
 * class, the one-at-a-time rule, and E3's scroll into view.
 */
function openToolPanel(toolId) {
  const row = document.querySelector(`.tool-row[data-tool="${toolId}"]`);
  const panel = row?.querySelector('.opts-tool');
  const more = row?.querySelector('.tool-more');
  if (!row || !panel || !more) return null;
  closeToolPanels(panel);
  setToolPanel(row, more, panel, true);
  return panel;
}

/**
 * The last run of the three tools that answer with a list.
 *
 * Kept here rather than in the panel, because the panel is stamped fresh by
 * every render and the answer is not: pressing Simple after a scan used to
 * throw the findings away along with the element that happened to be holding
 * them.
 */
let lastAutofill = null;
let lastA11y = null;
let lastCoverage = null;

/**
 * E9: what the fill actually did, field by field.
 *
 * "It's trash" was fair. The tool filled nine fields, was refused by two and
 * skipped three, and said so in one status line that cleared itself after four
 * seconds: a partial run and a failed run looked identical, and neither told
 * you *which* fields. Three groups, named, and the ones that did not work
 * first, because those are the ones the tester has to do something about.
 */
function paintAutofill(panel) {
  const host = (panel || panelFor('autofill'))?.querySelector('#autofill-out');
  if (!host) return;
  host.replaceChildren();
  if (!lastAutofill) {
    host.append(el('p', 'fine', t('popup.autofill.empty')));
    return;
  }
  const r = lastAutofill;
  // The English stays beside each key: tools/test-tool-cards.mjs reads the
  // first of these three headings out of the source, because it is the one E9
  // added and the one that must not quietly go back to a single mixed list.
  const groups = [
    [tf('popup.autofill.rejected', 'Still rejected by the page'), r.invalid || [], 'is-invalid'],
    [tf('popup.autofill.done', 'Filled'), r.filled || [], 'is-valid'],
    [tf('popup.autofill.skipped', 'Left alone'), r.skipped || [], 'is-plain'],
  ];
  if (!groups.some(([, list]) => list.length)) {
    host.append(el('p', 'fine', t('popup.autofill.noneHere')));
    return;
  }
  for (const [title, list, tone] of groups) {
    if (!list.length) continue;
    host.append(el('p', 'opts-head', t('popup.autofill.groupHead', { title: iso(title), n: list.length })));
    const box = el('div', 'part-list');
    for (const item of list.slice(0, 12)) {
      const row = el('div', `part ${tone}`);
      row.append(el('b', null, item.name || item.label || item.selector || t('popup.autofill.aField')));
      if (item.value != null) row.append(el('code', 'part-sample', String(item.value).slice(0, 28) || t('popup.value.empty')));
      if (item.reason || item.why) row.append(el('em', null, item.reason || item.why));
      box.append(row);
    }
    if (list.length > 12) box.append(el('p', 'fine', t('popup.autofill.more', { n: list.length - 12 })));
    host.append(box);
  }
}

/**
 * E14: the accessibility findings, where the tester is standing.
 *
 * Nader: "it keeps pointing to the timeline for more details". It did: the one
 * line said "5 rules violated, 31 elements. Open the timeline for detail", and
 * the timeline is a different page in a different tab, which is a long way to
 * go to find out which button has no name. Each rule is listed here with its
 * impact and its elements, and each element carries the button that scrolls it
 * into view on the page and rings it, which is the shortest possible distance
 * between a finding and the thing it is about.
 */
function paintA11y(panel) {
  const host = (panel || panelFor('a11y'))?.querySelector('#a11y-out');
  if (!host) return;
  host.replaceChildren();
  if (!lastA11y) {
    host.append(
      el('p', 'fine', t('popup.a11y.empty'))
    );
    return;
  }
  const violations = lastA11y.violations || [];
  if (!violations.length) {
    host.append(el('p', 'fine', t('popup.a11y.noneFound')));
    return;
  }
  for (const v of violations) {
    const rule = el('div', 'a11y-finding');
    // D-200: axe's help text is English only; it stays English and left-to-right inside an Arabic page, with the rule id beside it.
    const head = el('p', 'opts-head');
    const help = el('span', null, v.help || v.id);
    help.lang = 'en';
    help.dir = 'ltr';
    head.append(help);
    if (v.id && v.help) {
      const ruleId = el('code', null, v.id);
      ruleId.dir = 'ltr';
      head.append(' ', ruleId);
    }
    head.append(el('span', 'a11y-impact', t('popup.a11y.impact', {
      impact: v.impact ? QAWi18n.impactWord(v.impact) : t('popup.a11y.unrated'),
      elements: plural(v.count ?? (v.nodes || []).length, 'popup.count.elementOne', 'popup.count.elementMany'),
    })));
    rule.append(head);
    for (const node of (v.nodes || []).slice(0, 5)) {
      const row = el('button', 'part is-invalid');
      row.type = 'button';
      row.append(el('b', null, node.target));
      if (node.summary) row.append(el('em', null, node.summary.split('\n')[0]));
      row.title = t('popup.a11y.showTitle');
      row.append(el('code', 'part-sample', t('popup.a11y.show')));
      row.addEventListener('click', () => showOnPage(node.target));
      rule.append(row);
    }
    host.append(rule);
  }
}

/**
 * Put one element on the page, in front of the tester.
 *
 * The other half of E2 and E14: an error or a finding that names an element
 * and cannot show it to you is a riddle. `UQA_HIGHLIGHT` already existed and
 * was reachable from the report and from nowhere else.
 */
async function showOnPage(selector) {
  await resolveCtx();
  const res = await send({ type: 'UQA_HIGHLIGHT', selector, tabId: ctx.tabId });
  if (!res.ok) return say(res.error, 'err');
  say(t('popup.a11y.ringed', { tag: res.result?.tag || t('popup.a11y.element') }), 'ok');
}

/**
 * E15: whether coverage can run here, said before it is pressed.
 *
 * "Not really working" turned out to be three different refusals wearing the
 * same face: a build without the debugger permission, a page Chrome will not
 * let a debugger attach to (its own pages, the Web Store, a PDF viewer), and a
 * page whose scripts are all somebody else's, where the honest answer is that
 * there was nothing of this page's own to measure. None of them was visible
 * until after a press, and after a press they all looked like a tool that did
 * nothing. The card answers the question in advance and names the reason.
 */
function paintCoverageReadiness(panel) {
  const host = (panel || panelFor('whitebox'))?.querySelector('#whitebox-out');
  if (!host) return;
  host.replaceChildren();
  if (!lastCoverage) {
    host.append(el('p', 'fine', t('popup.coverage.checking')));
    checkCoverageReadiness();
    return;
  }
  const line = el('p', lastCoverage.can ? 'fine' : 'rule-state', lastCoverage.why);
  host.append(line);
}

/**
 * Ask once, remember, and repaint whatever panel is on screen.
 *
 * `asking` rather than a plain re-entry check: `stampPanel()` runs on every
 * render, and pressing Simple then Expert twice inside one round trip would
 * otherwise put four identical questions to a service worker that may be cold.
 */
let askingCoverage = false;
async function checkCoverageReadiness() {
  if (askingCoverage) return undefined;
  askingCoverage = true;
  try {
    return await askCoverageReadiness();
  } finally {
    askingCoverage = false;
  }
}

async function askCoverageReadiness() {
  await resolveCtx();
  const has = await send({ type: 'UQA_COVERAGE_PERMISSION' });
  if (!has.ok || !has.result) {
    lastCoverage = { can: false, why: t('popup.coverage.readyNoPermission') };
    return paintCoverageReadiness();
  }
  const tab = ctx.tabId != null ? await chrome.tabs.get(ctx.tabId).catch(() => null) : null;
  const url = tab?.url || '';
  if (!url || /^(chrome|edge|about|devtools|view-source|chrome-extension):/.test(url)) {
    lastCoverage = {
      can: false,
      // The English stays beside the key: tools/test-tool-cards.mjs reads this
      // sentence for the page-level refusal it must name rather than shrug at.
      why: tf(
        'popup.coverage.readyRestricted',
        'Chrome does not let a debugger attach to its own pages, the Web Store or a PDF viewer. Open the site you are testing in this tab and this card will say so.'
      ),
    };
    return paintCoverageReadiness();
  }
  lastCoverage = { can: true, why: t('popup.coverage.readyYes') };
  return paintCoverageReadiness();
}

/* ---------------------------------------------------------- break-a-request */

const PRESETS = {
  500: { action: 'status', status: 500, body: '{"error":"Forced by QA Wrap"}', label: 'Server error (500)' },
  503: { action: 'status', status: 503, body: '{"error":"Forced by QA Wrap"}', label: 'Service unavailable (503)' },
  403: { action: 'status', status: 403, body: '{"error":"Forced by QA Wrap"}', label: 'Forbidden (403)' },
  404: { action: 'status', status: 404, body: '{"error":"Forced by QA Wrap"}', label: 'Not found (404)' },
  empty: { action: 'status', status: 200, body: '', label: 'Empty response' },
  slow: { action: 'delay', label: 'Slow response' },
  offline: { action: 'fail', label: 'Network failure' },
  // Modifiers: they change the request rather than replacing the response, so
  // the real call still happens and you see what the server actually did.
  redirect: { action: 'redirect', label: 'Redirected' },
  header: { action: 'headers', label: 'Header changed' },
  noauth: { action: 'headers', label: 'Authorization removed' },
};

// Each preset needs a different extra field, and showing all of them at once
// is how a five-control form becomes a nine-control one nobody reads.
const EXTRA_FIELD = {
  slow: 'break-delay-field',
  redirect: 'break-redirect-field',
  header: 'break-header-field',
};

$('break-preset').addEventListener('change', () => {
  const wanted = EXTRA_FIELD[$('break-preset').value];
  for (const id of new Set(Object.values(EXTRA_FIELD))) $(id).hidden = id !== wanted;
});

/**
 * Line art for each tool: the UI round 2 family (ui/icons.js, S2), loaded
 * before this file. Each TOOLS entry names its drawing as `icon`, copied from
 * the tool -> icon map in identity/icons/ui/icons.json, and toolRow() draws
 * `UQAIcons[tool.icon]`. The drawings inherit `currentColor`, so a tool that is
 * used, pressed or asleep draws its glyph in that state's own colour.
 */

/**
 * Every tool, with the sentence that explains it and the place it holds in the
 * test process.
 *
 * The explanation lives next to the thing it explains rather than in a glossary
 * at the bottom, because a glossary is a place people have to decide to visit.
 * Each is written for someone who has never used a QA tool: what it does, and
 * what they will get, in one breath and no jargon.
 *
 * `tool` is the id the session's usage log and the ISTQB model both use, and it
 * is not always the same as `action` — "Break a request" is an action that
 * opens a panel, and a rule armed from that panel is what actually counts as
 * having used it.
 */
const TOOLS = [
  {
    action: 'mask',
    tool: 'mask',
    icon: 'tool-mask',
    label: 'Mask real data',
    pin: true,
    toggle: true,
    one: 'Cover anything on the page so it never reaches a picture, a video or the report.',
    /*
     * E5, the copy audit. The old sentence opened "click anything on the page
     * (a name, a national number, a whole table column)", which reads as
     * fields, and the catalogue label had been "mask the names". It does not
     * mask names; it covers whole elements, whatever they hold, including
     * pictures. Saying so is not a detail: a tester who believes this masks
     * text will point it at a screenshot of a passport and be wrong.
     */
    what: 'Click any element on the page and a solid block covers the whole of it: a cell, a heading, a photograph, a chart, an embedded frame. Point at a table and every cell is covered separately. It stays covered through every navigation, in every screenshot and in the video, and the words underneath never reach the report or the clipboard.',
    why: 'Testing happens on staging systems full of real people. Without this, the first screenshot puts their records into a ticket anyone on the project can open. Click a covered block again to uncover it, or use "Uncover all on this page" on the bar at the top, which leaves the other tabs alone.',
  },
  {
    action: 'pick',
    tool: 'pick',
    icon: 'tool-pick',
    label: 'Copy a locator',
    options: 'pick-panel',
    optionsLabel: 'What the pick is for', optionsShort: 'Purpose',
    one: 'Point at anything and get the one line of code a test needs to find it again.',
    what: 'Click any button, field or link on the page and this copies the one line of code a test needs to find it again. Shift+click several, then press Enter, and all of them are copied at once, one per line.',
    why: 'Writing that line by hand is slow and easy to get wrong. This checks the line really does match one thing, and only one, before handing it over. Anything you have masked is refused: a locator built out of a covered name would put that name in a test file, which outlives the screenshot the mask was protecting.',
  },
  {
    action: 'api',
    tool: 'api',
    icon: 'tool-api',
    label: 'Send a request',
    options: 'api-panel',
    optionsLabel: 'What this is for, with an example', optionsShort: 'Example',
    // E12: "don't understand it, make it better". The card led with "opens a
    // page where you can write an API request by hand", which describes the
    // furniture and not the job. One line about the job now sits on the card,
    // and the panel carries a worked example.
    one: 'Call the site’s own API as the user who is logged in, without copying a token into another app.',
    what: 'Opens a page where you can write an API request by hand and send it from this browser, so the cookies the site has already set go with it. Method, URL, headers, body, environments with {{variables}}, and a short list of commands that run before it is sent. The endpoints this session already watched can be imported and re-sent with one header changed.',
    why: 'Checking an endpoint mid-flow usually means copying a token into a separate app and losing the session. This keeps the session: the request is authenticated the way the page is, the answer is on screen with its status, its time and its headers, and both go into the timeline and the Postman export beside the traffic the application made on its own.',
  },
  {
    action: 'diagram',
    tool: 'diagram',
    icon: 'tool-diagram',
    label: 'Draw the flow',
    one: 'Turn what you just did into a workflow diagram on one page.',
    what: 'Turns what you did so far into a workflow diagram on one A4 page: start, each step, a decision where the application answered, a red box where it failed, the end, with the user story beside it in Arabic.',
    why: 'A picture of the flow is what a product owner asks for and a tester never has time to draw. Every box and arrow can be moved, reworded and recoloured; the legend explains itself.',
  },
  {
    action: 'harvest',
    tool: 'harvest',
    icon: 'tool-harvest',
    label: 'Map the page',
    one: 'Read every control on the page into a page object a test suite can use.',
    what: 'Reads every button, link and field on the page and gives each one a locator that has been checked against the page, then writes a page map, a Playwright page object and a brief an AI can write tests from.',
    why: 'Writing a page object by hand is an afternoon of guessing selectors. This is that afternoon, done: every locator verified, every guess marked. The three files are in the report under Raw export. Anything you have masked is left out of all three.',
  },
  {
    action: 'autofill',
    tool: 'autofill',
    icon: 'tool-autofill',
    label: 'Fill the form',
    options: 'autofill-panel',
    optionsLabel: 'What it fills, and what it could not', optionsShort: 'Result',
    // E9: "design it better, it's trash". The card said what it fills and
    // nothing about what happened, so a run that filled nine fields and was
    // refused by two read exactly like a run that did nothing. The panel now
    // holds the result, field by field, and it is opened by the press.
    one: 'Fill every field at once with a value a tester would have chosen, and name what it could not.',
    what: 'Fills every field on the page with the value a tester would have chosen: a real-shaped phone number, an IBAN that passes its checksum, a date inside the allowed range, an amount between min and max, and in Arabic where the page is Arabic. It does not press submit.',
    why: 'A random word in every box gets a form submitted; a designed value gets it tested. Every field it filled, every field the page rejected and every field it left alone is listed under "Result" on this card, so a partial run is legible instead of looking like a failure.',
  },
  {
    action: 'links',
    tool: 'links',
    icon: 'tool-links',
    label: 'Check the links',
    one: 'Ask every link on the page whether it still answers.',
    what: 'Finds every link on the page and asks each one whether it still answers: broken, redirected, slow, or fine.',
    why: 'Dead links are the bug every visitor finds and no tester logs. Checked from the extension, so links to other sites are tested too, and the result goes into the session.',
  },
  {
    action: 'inject',
    tool: 'inject',
    icon: 'tool-inject',
    label: 'Try nasty values',
    options: 'inject-panel',
    optionsLabel: 'Which field, and how to clear it', optionsShort: 'Field',
    one: 'Point at any field and get the awkward values built for that exact field.',
    // E5: "pick a text box" was wrong the moment the picker learned to see a
    // dropdown, a radio, a tickbox, a slider and a rich-text editor.
    what: 'Press it and click any field: a text box, a dropdown, a radio, a tickbox, a date, a slider or a rich-text editor. The list offered is built for that field: very long text, Arabic, a date in the year 1800, an emoji, a value the dropdown does not offer, nothing at all.',
    why: 'Most bugs live at the edges. This gives you the edges without having to think them up. The field you pick stays picked and outlined until you clear it, so the next value goes where the last one went.',
  },
  {
    action: 'rtl',
    tool: 'rtl',
    icon: 'tool-rtl',
    label: 'Stress the layout',
    one: 'Flip the page right-to-left and lengthen every label, the way a translation would.',
    // E5: this said "about 40% longer" flatly, and 40 is only the default.
    // Settings takes it from 0 to 200, so a tester who had turned it up was
    // reading a number the tool was not using.
    what: 'Flips the whole page right-to-left and makes every label longer, the way a translation would: 40% longer to start with, and whatever Settings says after you change it.',
    why: 'Shows you which boxes will break when the app is translated, before a translator is ever hired. Anything that cuts text off gets outlined. Press it again to put the page back.',
    toggle: true,
  },
  {
    action: 'fineprint',
    tool: 'fineprint',
    icon: 'tool-fineprint',
    label: 'Check the fine print',
    one: 'Check the legal surface of the page: policies, consent, trackers, who is behind it.',
    what: 'Reads the legal surface of the page from what this session already captured: are the privacy, terms, cookie and refund pages there and reachable, was consent asked before anything was stored, does each form ask for consent and only what it needs, who else the page called, and whether there is a real business behind it.',
    why: 'Nine of the nineteen worries on every "will my site get sued" list are properties of the page, and none of them was checked anywhere in this product. Four more are questions no browser can answer, and those are filed as questions rather than ticked. Accessibility is not re-checked here: "Check accessibility" already does it in more depth.',
  },
  {
    action: 'a11y',
    pin: true,
    tool: 'a11y',
    icon: 'tool-a11y',
    label: 'Check accessibility',
    options: 'a11y-panel',
    optionsLabel: 'What the last scan found', optionsShort: 'Findings',
    // E14: "keeps pointing to the timeline for more details". The findings are
    // on this card now, each with a button that puts the element on screen.
    one: 'List what would stop somebody using this page with a screen reader or a keyboard.',
    what: 'Runs the same engine that Chrome DevTools uses, and lists what would stop someone using a screen reader or a keyboard.',
    why: 'Every rule it breaks is listed under "Findings" on this card, with the elements and a button that scrolls each one into view and rings it. The findings also go into the session, so they are in the report next to everything else, and the panel has a full rule list and 12 checks a machine cannot make.',
  },
  {
    action: 'perf',
    pin: true,
    tool: 'perf',
    icon: 'tool-perf',
    label: 'Check page speed',
    one: 'Measure how fast this page really drew and answered, logged in and mid-flow.',
    what: 'Measures how fast this page actually drew and responded, plus every request it made.',
    why: 'This reads the page as it is right now: logged in, mid-flow, on your real network. That is the number Lighthouse cannot give you.',
  },
  {
    action: 'shot',
    pin: true,
    tool: 'shot',
    icon: 'tool-shot',
    label: 'Take a screenshot',
    options: 'shot-panel',
    optionsLabel: 'Screenshot options', optionsShort: 'Format',
    one: 'Take a screenshot and keep it with the session.',
    what: 'Takes a picture of the page and keeps it with the session: either the part on screen, or the whole thing scrolled and stitched into one tall image.',
    why: 'A screenshot is the evidence that survives after the page has changed. The whole-page option is for long forms and reports, where the problem is usually below the fold.',
  },
  {
    action: 'record',
    pin: true,
    tool: 'record',
    icon: 'tool-record',
    label: 'Record the screen',
    id: 'record-tool',
    // The mic / sound / webcam choices live on this row now, behind its own
    // disclosure — they used to sit under the whole tool list, where they read
    // as settings for everything rather than options for this one thing.
    options: 'capture-panel',
    optionsLabel: 'Video options', optionsShort: 'Scope',
    one: 'Film this tab, or the whole screen, into a video kept with the session.',
    what: 'Films this tab into a video that is kept with the session. Open "Video options" on this row first if you want your microphone, the tab’s sound, or your webcam in it.',
    why: 'There is no time limit. It runs until you press stop, or the disk fills. Press it again to stop.',
    toggle: true,
  },
  {
    action: 'partitions',
    tool: 'blackbox',
    icon: 'tool-blackbox',
    label: 'Design the values',
    options: 'partitions-panel',
    optionsLabel: 'Partitions and boundaries', optionsShort: 'Values',
    // E7: the panel hands over a crosshair now instead of telling the tester to
    // have clicked into a field already.
    one: 'Point at a field and get the handful of values worth testing, and why each one.',
    what: 'Press "Pick a field" and click any field on the page. This reads what the field itself declares (its type, its minimum, its maximum, its options, whether it is required) and works out the distinct classes of input it has, plus the exact values on each edge.',
    why: 'Trying forty random values covers less than four chosen ones. This tells you which four, and names each one so you can say what you tested rather than that you "tried some things". It reads dropdowns, radios, tickboxes, sliders, file choosers and rich-text editors as well as text boxes.',
  },
  {
    action: 'coverage',
    tool: 'whitebox',
    icon: 'tool-whitebox',
    label: 'Measure code coverage',
    options: 'whitebox-panel',
    optionsLabel: 'Whether this page can be measured', optionsShort: 'Ready?',
    // E15: "not really working". It works where Chrome lets it and could not
    // say where that was, so a page it cannot measure looked like a broken
    // tool. The card now answers that question before it is pressed.
    one: 'Measure which of this page’s own JavaScript actually ran while you used it.',
    what: 'Measures which of the page’s own JavaScript actually ran while you used it, function by function.',
    why: 'Shows the code your test never reached. It uses Chrome’s debugger, so Chrome puts a bar across the top of the window while it runs. That is expected: it comes off the moment you press stop, and nothing is attached until you press start. "Ready?" on this card says in advance whether this page can be measured, and names the reason when it cannot.',
    toggle: true,
  },
  {
    action: 'viewport',
    tool: 'viewport',
    icon: 'tool-viewport',
    label: 'Check another size',
    options: 'viewport-panel',
    optionsLabel: 'Screen sizes', optionsShort: 'Sizes',
    one: 'Open this same page again in a real window at a phone, tablet or laptop size.',
    what: 'Opens this same page again in a new window at a real phone, tablet or laptop size. The new window carries the session on: it is awake there, and it is masked there if you have masked anything here.',
    why: 'A real window that really reflows, not a zoomed picture of this one. Most layout bugs are found here and need no other browser. What you find in it goes into the report under its own heading, Window sizes, so a phone-sized finding is never filed as though it happened on the desktop.',
  },
  {
    action: 'spec',
    tool: 'spec',
    icon: 'tool-spec',
    label: 'Reverse-engineer the spec',
    options: 'spec-panel',
    optionsLabel: 'Document format', optionsShort: 'Format',
    one: 'Read this page back as a draft specification, in Arabic and English.',
    what: 'Reads this page the way a specification would: every form and what it will accept, every button, where the links go, and the errors it is showing. Writes it up as requirements with acceptance criteria, Arabic and English.',
    why: 'Most software this old has no specification, and writing one from scratch is a fortnight. The page already declares half of it: what is required, what pattern a field takes, what the options are. This reads that back, marks what it had to guess, and leaves you editing a draft instead of starting one.',
  },
  {
    action: 'break-toggle',
    tool: 'break',
    icon: 'tool-break',
    label: 'Break a request',
    one: 'Make the site fail on purpose, then stop it failing without reloading anything.',
    what: 'Makes the site fail on purpose: a 500 error, a dead connection, a slow reply, or a request sent somewhere else entirely.',
    why: 'Lets you see how the app behaves when the server misbehaves, without needing anyone to break the server. Rules stack. "Stop breaking it" takes every rule off at once: the next request goes through normally, nothing reloads, and everything the broken requests already put in the session stays there.',
    expands: true,
  },
];

/** The syllabus model, fetched once at boot. Null until then. */
let model = null;
/** What this browser can actually do. Null until boot has asked. */
let capabilities = null;
/** Which tools this session has used: `{ [tool]: { count, firstAt, lastAt } }`. */
let used = {};
/** The usage log of the session that was last stopped, for the saved screen. */

/**
 * Every icon is the same 20x20 stroked drawing; only the paths differ. A map
 * rather than nine `setAttribute` lines, so the shared look is one thing to
 * change. Attributes, not properties: SVG presentation attributes are.
 */
const ICON_ATTRS = {
  viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor',
  'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [attr, value] of Object.entries(ICON_ATTRS)) svg.setAttribute(attr, value);
  svg.innerHTML = window.UQAIcons?.[name] || '';
  if (window.UQAIconMirror?.includes(name)) svg.classList.add('mirror');
  return svg;
}

/**
 * The tools, laid out as the test process rather than as a list of gadgets.
 *
 * A QA extension is normally a bag of buttons in whatever order they were
 * built, which leaves the tester to hold the process in their head. Grouping
 * them under the ISTQB test activities makes the same buttons answer a question
 * they could not answer before — what have I not done on this run yet — and it
 * costs nothing, because the mapping is real rather than invented.
 *
 * If the model cannot be fetched the tools still render, ungrouped. A missing
 * heading is a worse popup; a missing tool is a broken one.
 */
/**
 * The visible grouping: by what a tester is trying to do, in the order they
 * do it. The ISTQB activity each tool serves still lives in its help panel
 * and still drives the process meter — it is the syllabus name, not the
 * navigation. Grouping the list by syllabus made eleven equal rows under
 * seven headings a first-day tester had to decode before pressing anything.
 */
const GROUPS = [
  { id: 'capture', label: 'Capture', hint: 'Keep the evidence', tools: ['shot', 'record', 'viewport', 'mask'] },
  { id: 'check', label: 'Check', hint: 'Let the machine look', tools: ['a11y', 'perf', 'links', 'whitebox', 'fineprint'] },
  { id: 'design', label: 'Design', hint: 'Values, locators, the page map', tools: ['blackbox', 'inject', 'autofill', 'harvest', 'pick', 'diagram', 'spec', 'api'] },
  { id: 'break', label: 'Break', hint: 'Make it fail on purpose', tools: ['break', 'rtl'] },
];

/**
 * One group's heading, in the tester's language.
 *
 * The English above is the source of record: `core/tool-catalogue.json` copies it
 * for the right-click menu and `tools/test-context-menus.mjs` fails the moment
 * the two disagree, so the literal cannot move into a table.
 */
const groupLabel = (g) => tf(`popup.groups.${g.id}.label`, g.label);
const groupHint = (g) => tf(`popup.groups.${g.id}.hint`, g.hint);

/**
 * One tool's words, in the tester's language.
 *
 * `TOOLS` keeps its English for the same reason `GROUPS` does, and for two more:
 * `tools/test-tool-cards.mjs` measures the one-liner and audits the copy against
 * what the code does, both against the literal. The keys are built from the tool
 * id, which is why every one of them is listed in `popup.dynamic.json`.
 */
function localiseTool(source) {
  const id = source.tool;
  const pick = (field) => (source[field] == null ? source[field] : tf(`tools.${id}.${field}`, source[field]));
  return {
    ...source,
    label: pick('label'),
    one: pick('one'),
    what: pick('what'),
    why: pick('why'),
    optionsLabel: pick('optionsLabel'),
    optionsShort: pick('optionsShort'),
  };
}

/**
 * Favourites: the tools a tester keeps at the top (DESIGN-SPEC §1.7).
 *
 * One mode now, not Simple and Expert: every tool is on the rail, grouped, and
 * the starred ones sit above the groups in the order they were starred. The
 * default set is the five the old Simple mode showed (`pin: true` in TOOLS).
 * Stored per profile in `chrome.storage.sync`, and in `local` when sync is
 * unavailable. Popup-owned on purpose: settings.js is in the worker's boot
 * graph, and this adds nothing to it.
 */
const FAV_KEY = 'qawFavourites';
let favourites = TOOLS.filter((t) => t.pin).map((t) => t.tool);

async function loadFavourites() {
  for (const area of ['sync', 'local']) {
    try {
      const got = await chrome.storage[area].get(FAV_KEY);
      if (Array.isArray(got?.[FAV_KEY])) {
        favourites = got[FAV_KEY].filter((id) => TOOLS.some((t) => t.tool === id));
        return;
      }
    } catch { /* this area is unavailable; try the next */ }
  }
}

async function saveFavourites() {
  for (const area of ['sync', 'local']) {
    try {
      await chrome.storage[area].set({ [FAV_KEY]: favourites });
      return;
    } catch { /* sync refused (quota, policy): keep it on this machine */ }
  }
}

function toggleFavourite(id) {
  const at = favourites.indexOf(id);
  if (at === -1) favourites.push(id);
  else favourites.splice(at, 1);
  saveFavourites();
  const focused = document.activeElement?.closest?.('.tool-row, .fav-item');
  const key = focused?.dataset.tool || focused?.dataset.fav;
  renderTools();
  // The press moved nothing the tester was holding: focus returns to the same
  // star, wherever the row now sits.
  const again = key && document.querySelector(`.tool-row[data-tool="${key}"] .tool-star`);
  if (again) { rove(again.closest('.tool-row').querySelector('.tool')); again.focus(); }
}

/**
 * Paint what has and has not been used, this session.
 *
 * The question this answers is one every tester asks out loud — "did I already
 * check accessibility on this one, or am I thinking of the last run?" — and
 * until now the popup had no opinion, so the honest answer was to run it again.
 */
function paintUsage() {
  for (const row of document.querySelectorAll('.tool-row[data-tool]')) {
    const entry = used[row.dataset.tool];
    const count = entry?.count ?? 0;
    const state = row.querySelector('.tool-state');
    if (!state) continue;

    state.dataset.used = String(count > 0);
    state.textContent = count > 1 ? String(count) : '';
    state.title = count
      ? t(count === 1 ? 'popup.usage.usedOne' : 'popup.usage.usedMany', { n: count })
      : t('popup.usage.unused');
    row.classList.toggle('is-used', count > 0);
  }

  for (const group of document.querySelectorAll('.activity')) {
    const rows = [...group.querySelectorAll('.tool-row[data-tool]')];
    const done = rows.filter((r) => r.classList.contains('is-used')).length;
    group.classList.toggle('is-touched', done > 0);

    const meter = group.querySelector('.activity-meter');
    if (!meter) continue;
    meter.replaceChildren();
    for (let i = 0; i < rows.length; i++) {
      const pip = document.createElement('i');
      pip.className = i < done ? 'on' : '';
      meter.append(pip);
    }
    meter.setAttribute('aria-label', t('popup.usage.meter', { done, total: rows.length }));
  }

  paintTimelineLink();
}

/* ── the ⋯ menu: theme, language, the pages, the reporter ────────────── */

/**
 * Theme and language are choices in the ⋯ menu (research/56, round 2), not
 * buttons that cycle: the radios name all three states at once, so nobody has
 * to press through one they did not want to reach the one they did. The ids the
 * suites drive by survive: `#theme` and `#lang` are the two radio groups.
 */
function paintTheme() {
  const mode = window.UQATheme.read?.() || 'system';
  for (const row of document.querySelectorAll('[data-theme-choice]')) {
    row.setAttribute('aria-checked', String(row.dataset.themeChoice === mode));
  }
}

function paintLang() {
  const choice = QAWi18n.setting?.() || 'auto';
  for (const row of document.querySelectorAll('[data-lang-choice]')) {
    row.setAttribute('aria-checked', String(row.dataset.langChoice === choice));
  }
}

/*
 * A whole-surface change cross-fades through a view transition, and is simply
 * instant where there is none or where reduced motion asks for none (motion
 * catalogue #22). Colour itself never transitions.
 */
function withViewTransition(change) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduced) document.startViewTransition(change);
  else change();
}

const menu = $('more-menu');
const moreBtn = $('more');
const menuRows = () => [...menu.querySelectorAll('.menu-row:not(:disabled)')];

/**
 * Open or close the menu. While it is open, what it covers (the session, the
 * tools, the work pane) is `inert` — not merely covered — and focus stays in
 * the menu; the header and the session strip stay live (Lead rule, 27 Sept).
 * Esc, a choice or the toggle return focus to `#more`; a click outside closes
 * it without moving focus.
 */
function setMenu(open, { focus = 'first', restore = true } = {}) {
  if (!menu || !moreBtn) return;
  const was = !menu.hidden;
  menu.hidden = !open;
  moreBtn.setAttribute('aria-expanded', String(open));
  $('app-body').inert = open;
  if (open) {
    paintTheme();
    paintLang();
    menu.classList.remove('is-entering');
    void menu.offsetWidth;
    menu.classList.add('is-entering');
    const rows = menuRows();
    (focus === 'last' ? rows[rows.length - 1] : rows[0])?.focus();
  } else if (was && restore) {
    moreBtn.focus();
  }
}

moreBtn?.addEventListener('click', () => setMenu(menu.hidden));
moreBtn?.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  setMenu(true, { focus: e.key === 'ArrowUp' ? 'last' : 'first' });
});
menu?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    setMenu(false);
    return;
  }
  const rows = menuRows();
  const at = rows.indexOf(document.activeElement);
  let next = null;
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) next = rows[(at + 1) % rows.length];
  else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) next = rows[(at - 1 + rows.length) % rows.length];
  else if (e.key === 'Home') next = rows[0];
  else if (e.key === 'End') next = rows[rows.length - 1];
  if (!next) return;
  e.preventDefault();
  next.focus();
});
// Light dismiss: a press anywhere else closes it, and focus stays where it went.
document.addEventListener('click', (e) => {
  if (menu.hidden || e.target.closest?.('#more-menu, #more')) return;
  setMenu(false, { restore: false });
});

menu?.addEventListener('click', async (e) => {
  const themeRow = e.target.closest('[data-theme-choice]');
  if (themeRow) {
    withViewTransition(() => {
      window.UQATheme.set?.(themeRow.dataset.themeChoice);
      paintTheme();
    });
    setMenu(false);
    return;
  }
  const langRow = e.target.closest('[data-lang-choice]');
  if (langRow) {
    setMenu(false);
    withViewTransition(() => QAWi18n.setLang(langRow.dataset.langChoice));
    return;
  }
  // Tutorials, Timeline and the reporter each carry their own handler; the
  // menu only gets out of the way first.
  if (e.target.closest('.menu-row')) setMenu(false, { restore: false });
});

/* ── the page's shape: the sheet, the strip, the icons ───────────────── */

// The header's glyphs, and every other static `data-icon`, from the one family.
for (const n of document.querySelectorAll('[data-icon]')) n.insertAdjacentHTML('afterbegin', window.UQAIcon?.(n.dataset.icon) || '');

const app = $('app');

/*
 * Two measured edges, written as custom properties on `.app`: the session
 * card's bottom (where the wide tool detail starts) and the
 * strip's height (where both end, and where the ⋯ menu stops). A
 * ResizeObserver rather than a guess, because the session card changes height
 * with every state and every language.
 */
(() => {
  if (!app || !window.ResizeObserver) return;
  const session = $('session');
  const strip = $('session-strip');
  const head = $('app-head');
  const measure = () => {
    const stripH = strip && strip.offsetParent ? strip.offsetHeight : 0;
    const top = session && session.offsetHeight ? session.offsetTop + session.offsetHeight : head.offsetTop + head.offsetHeight;
    app.style.setProperty('--strip-h', `${stripH}px`);
    app.style.setProperty('--work-top', `${Math.round(top)}px`);
  };
  const ro = new ResizeObserver(measure);
  for (const n of [app, session, strip]) if (n) ro.observe(n);
  measure();
})();

/**
 * The master switch.
 *
 * Everything else in this popup is disabled while it is off, rather than
 * failing when pressed: a control that looks available and then refuses is a
 * worse experience than one that plainly is not available yet. Arming is per
 * browser window, so the note says which — a tester with the app in one window
 * and their email in another has only armed the first.
 */
let awake = false;

/**
 * How many *other* windows were armed the last time the worker said.
 *
 * Remembered because the optimistic paint below has to write the note line
 * before the worker has answered, and "3 other windows too" going briefly blank
 * on the way to being repainted with the same number is a flicker carrying no
 * information at all.
 */
let otherArmedWindows = 0;

/**
 * Which question about the switch is the current one.
 *
 * Answers arrive out of order, and one of them repainted a window that had just
 * been put to sleep. Sleep does real work: `sleepWindow()` stops the clip and
 * the session on the way down, and each of those broadcasts
 * `UQA_STATE_CHANGED` **while the window is still armed**. The popup answers
 * every broadcast with `refresh()`, so a `UQA_POPUP_STATE` snapshot taken
 * mid-sleep — `armed: true`, quite correctly for the moment it was taken — is
 * already in flight when `UQA_DISARM` replies. If it lands last it repaints
 * `data-awake="true"` over a window that is asleep.
 *
 * So each asynchronous read takes a ticket before it asks, and a ticket that is
 * no longer the newest is an answer about a world that has since moved. It is
 * dropped rather than painted. `paintSwitchState` is the only writer of the
 * switch, so it is the only place that needs to know.
 */
let armedGen = 0;
const armedTicket = () => ++armedGen;

/**
 * Minutes, in a unit somebody can picture.
 *
 * The panel read "Room for roughly 41420 minutes of video", which is a number a
 * viewer has to do arithmetic on before it means anything. Same rule and same
 * thresholds as `options/options.js`, and local rather than imported: this is a
 * classic script sharing a global with `ui/*.js`, and the name is unique across
 * every script `popup.html` loads.
 */
function spanOf(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 90) return plural(m, 'popup.count.minuteOne', 'popup.count.minuteMany');
  const hours = m / 60;
  return hours < 48
    ? plural(Math.round(hours), 'popup.count.hourOne', 'popup.count.hourMany')
    : plural(Math.round(hours / 24), 'popup.count.dayOne', 'popup.count.dayMany');
}

/**
 * The switch, painted from a decision rather than from an answer.
 *
 * Split out of `paintSwitchNow()` so a press can draw Awake/Asleep — and enable
 * or disable every control under it — in the same tick as the click, before
 * `UQA_ARM` has been anywhere. Synchronous on purpose: an `await` here, even one
 * that resolves immediately, would put the paint a microtask after the gesture
 * and hand back exactly the lag this exists to remove.
 *
 * `gen` defaults to a ticket taken now, so a caller that already knows the
 * truth — the optimistic paint, the revert, the settle — is always the newest.
 */
function paintSwitchState(isAwake, others = otherArmedWindows, gen = armedTicket()) {
  if (gen !== armedGen) return;
  awake = !!isAwake;
  otherArmedWindows = others;

  $('switch-title').textContent = t(awake ? 'popup.switch.awake' : 'popup.switch.asleep');
  $('switch').setAttribute('aria-checked', String(awake));
  // The press plays the sound of the way it goes: the click sound is read from this attribute, before the handler flips the state.
  $('switch').dataset.sound = awake ? 'switch.sleep' : 'switch.wake';

  gateControls();
  document.body.dataset.awake = String(awake);
  paintPrimary();
}

/**
 * Every control the switch owns, locked or unlocked from the switch's answer.
 *
 * Disabled, not hidden: a tester needs to see what they would get, and the
 * explanations stay readable either way — reading about a tool is exactly what
 * someone does before deciding to wake it.
 *
 * Called from `renderTools()` as well as from the paint, because the tool rows
 * are stamped fresh on every render and a fresh button is an *enabled* button.
 * Switching Simple to Expert while the window was asleep used to hand back
 * nineteen live tools; `tools/clickthrough.mjs` asks the question in both modes
 * now, which is how that was found.
 */
function gateControls() {
  document.querySelectorAll('[data-action], .fav-run, #start, #break-arm, #note-text, #charter, #stop').forEach((control) => {
    // A control this browser cannot run stays disabled whatever the switch
    // says. Waking up does not add an API.
    const tile = control.matches('[data-action], .fav-run'); // 1011 B1: a tool is never disabled for sleeping; pressing it wakes this site, then runs
    if (tile) control.dataset.asleep = String(!awake); control.disabled = (!awake && control.id !== 'start' && !tile) || control.dataset.unavailable === 'true'; // #start asks, wakes and starts in one press
  }); paintStartLabel();
}

/**
 * Where QA Wrap is allowed, as the popup last heard it.
 *
 * Held in a module variable and refreshed by `paintSiteAccess()` because the
 * wake click handler may not await anything before it calls
 * `chrome.permissions.request` — Chrome refuses a request that is not made in
 * a live user gesture, and a single `await` before it spends the gesture. So
 * the answer the press needs has to be already on hand when the press arrives,
 * which means it is read at boot and after every grant rather than inside the
 * handler.
 *
 * `pattern: null` means a page no grant could cover: a `chrome://` tab, the
 * Web Store, the extension's own pages. Nothing is asked for there.
 */
let siteAccess = { pattern: null, granted: false, origins: [], policy: 'ask' };

async function paintSiteAccessNow(known) {
  const res = known ? { ok: true, result: known } : await send({ type: 'UQA_SITE_ACCESS' });
  if (res.ok) siteAccess = { ...siteAccess, ...res.result };
  // S7 §4.7: the same fact, promoted to the banner above the session card.
  paintBanner(); paintRemember(); globalThis.paintBuffer?.();
}

var paintSiteAccess = safe(paintSiteAccessNow, 'paintSiteAccess');

/**
 * Ask for a site, from inside the gesture that asked for it.
 *
 * Returns the promise `chrome.permissions.request` gave back, or `null` when
 * there is nothing to ask for. **Called synchronously by a click handler**:
 * everything else about the press can wait, and this cannot.
 *
 * `hostPermissionsPolicy` decides what one press means. `all` is a team whose
 * administrator would rather one prompt covered every internal application
 * than a tester answered a prompt per host; `none` removes the request, and the
 * card says so rather than showing a button that Chrome would refuse.
 */
function requestSite(wanted = siteAccess.pattern) {
  if (!wanted || siteAccess.policy === 'none') return null;
  const ask = siteAccess.policy === 'all' ? '<all_urls>' : wanted;
  try {
    return chrome.permissions.request({ origins: [ask] });
  } catch {
    return null;
  }
}

/** Tell the worker, so the page in front of the tester gets the scripts now. */
async function siteGranted() {
  await send({ type: 'UQA_SITE_GRANTED', ...(ctx.windowId != null ? { windowId: ctx.windowId } : {}) });
  await paintSiteAccess();
}

async function paintSwitchNow(known, gen = armedTicket()) {
  // Named, always. Asked with no window id at all, the worker answers about
  // whichever window the *sender* is in — which in the floating surface is the
  // float itself, never armed, so every wake was repainted as "Asleep" a beat
  // later. `ctx.windowId` is the window under test in all three surfaces.
  const res = known && known.armed != null // null: ask again
    ? { ok: true, result: known }
    : await send({ type: 'UQA_ARMED', ...(ctx.windowId != null ? { windowId: ctx.windowId } : {}) });
  const on = !!(res.ok && res.result.armed);
  const others = res.ok ? (res.result.windows || []).filter((w) => w !== res.result.windowId).length : 0;
  paintSwitchState(on, others, gen);
}

var paintSwitch = safe(paintSwitchNow, 'paintSwitch');

document.getElementById('switch').addEventListener('click', async () => {
  // Which way the press goes, decided once and read by all three phases, so the
  // paint, the message and the revert cannot disagree about it.
  const wanted = !awake;
  const card = $('switch-card');

  /*
   * The site is asked for here, on the first line of the handler, and nowhere
   * else.
   *
   * `chrome.permissions.request` is refused unless it is called while a user
   * gesture is live, and a gesture is spent by the first `await`. Everything
   * below this line awaits something — the optimistic paint's dispatch, the
   * context resolve, the message to the worker — so the request has to be
   * *issued* before any of it and *waited for* inside the dispatch.
   *
   * Which is why `siteAccess` is read at boot rather than here: the handler
   * cannot afford to ask the worker what to ask Chrome for.
   *
   * QA Wrap's popup is a float window or the side panel, never a browser-action
   * popup (`background/service-worker.js`, `action.onClicked`), so it survives
   * the permission bubble taking focus. A real popup would not, which is the
   * measured reason the microphone and screen grants live in Settings and are
   * written up over the Permissions section of `options/options.html`.
   */
  const asking = wanted && !siteAccess.granted ? requestSite() : null;
  // An administrator's "not this site" is said when the switch is pressed, since the card no longer carries a line about it.
  const blocked = wanted && !siteAccess.granted && !!siteAccess.pattern && siteAccess.policy === 'none';

  await optimistic(
    (pending) => {
      const before = awake;
      const others = otherArmedWindows;
      paintSwitchState(wanted);
      pending(card);
      return () => paintSwitchState(before, others);
    },
    async () => {
      // The answer to the bubble, awaited now that the gesture has done its
      // work. A refusal is a decision, not a fault: nothing is armed, the card
      // reverts, and the sentence names the press that would change it.
      if (blocked) return { ok: false, error: tf('popup.access.adminBlocked', 'An administrator has decided: not this site.') };
      if (asking) {
        const allowed = await asking.catch(() => false);
        if (!allowed) return { ok: false, error: notAllowed() };
        await siteGranted();
      }
      // Named for every surface, not only the float. Arming with the page's
      // window and then asking about the sender's is how the switch could flap:
      // the two messages were about two different windows. One resolved
      // context, one window id, both directions.
      //
      // Resolved *here*, after the paint, and that is the whole point.
      // `resolveCtx()` asks the worker which tab is under test — it is a round
      // trip of its own, and it used to sit between the click and the first
      // pixel. Waking a window against a worker Chrome had just killed left the
      // switch reading "Asleep" for as long as the worker took to start.
      await resolveCtx();
      return send({
        type: wanted ? 'UQA_ARM' : 'UQA_DISARM',
        ...(ctx.windowId != null ? { windowId: ctx.windowId } : {}),
      });
    },
    {
      settle: async (res) => {
        // The worker's own answer, not a second round trip: `UQA_ARM` and
        // `UQA_DISARM` both reply in exactly the shape `paintSwitch()` reads,
        // so the truth lands here even when it disagrees with the guess — a
        // window another surface had already armed, say.
        await paintSwitch(res.result);
        // The access line is repainted with the switch, because a wake is the
        // press that changes it: this is where "will ask to allow this site"
        // becomes "Allowed on this site".
        await paintSiteAccess();
        // Both English sentences stay beside their keys: tools/test-optimistic.mjs
        // reads them here, because a suite waits for them on #status after the
        // settle.
        // r1-09-3: sleep stops and saves a running session or clip (sleepWindow), and the reply names which.
        const slept = res.result?.stopped;
        say(
          awake
            ? tf('popup.switch.saidAwake', 'Awake in this window. Every tab here is covered. Other windows stay asleep.')
            : slept?.session
              ? tf('popup.switch.saidAsleepStopped', 'Back to sleep. The running session was stopped and saved.')
              : slept?.clip
                ? tf('popup.switch.saidAsleepClip', 'Back to sleep. The running recording was stopped and saved.')
                : tf('popup.switch.saidAsleep', 'Back to sleep. Nothing is being watched.'),
          'ok'
        );
        // Sleep is not a flag any more: the worker stops the running clip and
        // the running session on the way down. So the settled state can include
        // a session card that was live a moment ago and is the stopped one now,
        // and only `UQA_POPUP_STATE` knows that.
        refresh();
      },
    }
  ).then((res) => res?.ok === false && paintSwitch()); // show the worker's truth
});

/**
 * The recording button says what it will do, and the line under it says how much
 * room is left. A recording that dies at 100% disk with no warning is the worst
 * possible failure for something you cannot repeat, so the number is on screen
 * before it starts rather than in an error afterwards.
 */
let lastCapture = null;
let lastRoom = null;

async function paintRecordingNow(knownCapture, knownRoom) {
  const btn = document.getElementById('record-tool');
  if (!btn) {
    // No Record row drawn here, but the disk warning still belongs on screen.
    const dw0 = document.getElementById('disk-warn');
    if (dw0) dw0.hidden = !(await send({ type: 'UQA_RECORD_STATE' }).then((r) => r.ok && r.result?.recording && r.result?.diskWarn).catch(() => false));
    return;
  }
  // The row that owns the panel, asked once. In Simple mode the Record row is
  // drawn and so is its panel; in a surface or a mode that does not draw it,
  // `panel` is null and every read below is a no-op instead of a TypeError.
  const panel = panelFor('record');
  const [state, room] = knownCapture
    ? [{ ok: true, result: knownCapture }, { ok: !!knownRoom, result: knownRoom }]
    : await Promise.all([send({ type: 'UQA_RECORD_STATE' }), send({ type: 'UQA_STORAGE' })]);
  const recording = state.ok && state.result?.recording;
  if (recording) uqaSound()?.configure({ suspended: true }); // a popup opened mid-clip stays silent too
  // Remembered so the clip clock can repaint without asking again. See
  // clipTicker.
  lastCapture = state.ok ? state.result : null;
  lastRoom = room.ok ? room.result : null;
  const dw = document.getElementById('disk-warn');
  if (dw) dw.hidden = !(recording && state.result?.diskWarn);
  window.UQAVfx?.state('glow', btn, recording);

  // `.tool-name`, not the first span: the row now starts with the icon, so
  // querySelector('span') overwrote the icon with the label and drew the words
  // twice, one set on top of the other.
  btn.querySelector('.tool-name').textContent = recording
    ? t('popup.record.stop')
    : tf('tools.record.label', 'Record the screen');
  /*
   * Lock the whole panel, not one row of it.
   *
   * This used to lock `#capture-row`, which holds the mic/sound/webcam chips.
   * The scope radios - "This tab" against "Window or screen" - live in the
   * panel ABOVE that row, so the single control that most obviously cannot
   * change mid-clip was the only one left live. Flipping it did nothing to the
   * running recording and silently changed what the next press would do, while
   * the button underneath still read "Stop recording".
   *
   * Scoping to the panel means a control added later is covered by default,
   * which is the failure that happened here: the rule was right and the
   * selector was one element too narrow.
   */
  panel?.querySelectorAll('input').forEach((i) => (i.disabled = !!recording));

  // A device the browser has refused is not a choice, and a tick that cannot
  // do anything is worse than no tick: the clip comes out silent and the
  // recording panel said it would not be. Asked once per paint, and it never
  // fights the recording lock above.
  if (!recording) paintMediaPermissions(panel);
  if (!recording) paintGrantButton();

  /*
   * And show the scope actually being filmed.
   *
   * The offscreen document reports it in `sources`, so a popup reopened during
   * a clip can tell the truth instead of showing whatever the radio was left
   * on. Without this the panel could say "This tab" over a screen recording.
   */
  if (recording) {
    const filming = state.result?.sources?.screen ? 'screen' : 'tab';
    const radio = panel?.querySelector(`input[name="rec-scope"][value="${filming}"]`);
    if (radio) radio.checked = true;
    // Remembered too, so the next render stamps the panel showing the same
    // truth rather than resetting to "This tab" mid-clip.
    scopes['rec-scope'] = filming;
  }
  btn.setAttribute('aria-pressed', String(recording));
  btn.classList.toggle('is-recording', !!recording);

  const line = panel?.querySelector('#record-state');
  if (!line) return;
  const r = room.ok ? room.result : null;
  if (recording) {
    const since = state.result.startedAt ? Math.round((Date.now() - state.result.startedAt) / 1000) : 0;
    line.hidden = false;
    line.textContent = t('popup.record.since', { m: Math.floor(since / 60), s: since % 60 }) +
      (r?.minutesOfVideo != null ? t('popup.record.roomMore', { span: spanOf(r.minutesOfVideo) }) : '');
    line.className = 'fine armed';
  } else if (r?.low) {
    line.hidden = false;
    line.textContent = t('popup.record.lowRoom', { mb: Math.round(r.free / 1024 / 1024) });
    line.className = 'fine err';
  } else if (r?.minutesOfVideo != null) {
    line.hidden = false;
    line.textContent = t('popup.record.room', { span: spanOf(r.minutesOfVideo) });
    line.className = 'fine';
  } else {
    line.hidden = true;
  }
}

// `var`, not `const`: a top-level `function` declaration puts itself on the
// window, and tools/clickthrough.mjs drives `window.paintRecording()` directly
// to reach a mid-recording state no script can start. A `const` would be a
// lexical binding the harness cannot see; `var` keeps the property.
var paintRecording = safe(paintRecordingNow, 'paintRecording');

/**
 * Rules stack, so all of them are listed.
 *
 * The old version armed one rule under a fixed id and showed only the first, so
 * arming a second silently replaced the first and the tester had no way to tell.
 * Each rule now has its own countdown, its own row, and its own remove button —
 * and all of them belong to this session, so starting another clears the lot.
 */
async function refreshRuleStateNow(known) {
  const res = known ? { ok: true, result: known } : await send({ type: 'UQA_GET_RULES' });
  const rules = (res.ok ? res.result : []) || [];
  const live = rules.filter((r) => r.enabled !== false && (r.remaining == null || r.remaining > 0));
  const spent = rules.filter((r) => r.remaining != null && r.remaining <= 0);

  // `stateLine`, not `el`. Named `el` this shadowed the module-level `el()`
  // element helper for the whole function body, so the first person to build a
  // row in here would have called a paragraph.
  const stateLine = $('break-state');
  const host = $('rule-list');
  if (!stateLine || !host) return;

  if (!rules.length) {
    stateLine.textContent = t('popup.break.noRule');
    stateLine.className = 'rule-state';
  } else {
    stateLine.textContent =
      t('popup.break.armedCount', { n: live.length }) +
      (spent.length ? t('popup.break.spentCount', { n: spent.length }) : '') +
      t('popup.break.armedTail');
    stateLine.className = live.length ? 'rule-state armed' : 'rule-state';
  }

  host.replaceChildren();
  for (const r of rules) {
    const row = document.createElement('div');
    row.className = spent.includes(r) ? 'rule-row is-spent' : 'rule-row';

    const text = document.createElement('div');
    const scope = r.pattern ? t('popup.rule.onPattern', { pattern: r.pattern }) : t('popup.rule.everyRequest');
    const extra = r.redirectTo
      ? ` › ${r.redirectTo}`
      : r.headers
        ? ` (${Object.entries(r.headers).map(([k, v]) => (v === null ? t('popup.rule.headerRemoved', { name: k }) : `${k}: ${v}`)).join(', ')})`
        : '';
    const strong = document.createElement('strong');
    strong.textContent = `${r.label}${extra}`;
    const small = document.createElement('em');
    small.textContent = t('popup.rule.line', {
      scope,
      left: r.remaining == null
        ? t('popup.rule.untilOff')
        : r.remaining > 0
          ? t('popup.rule.left', { n: r.remaining })
          : t('popup.rule.spent'),
    });
    text.append(strong, small);

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'rule-drop';
    drop.textContent = '×';
    drop.title = t('popup.rule.remove');
    drop.addEventListener('click', async () => {
      await send({ type: 'UQA_DROP_RULE', id: r.id });
      refreshRuleState();
    });

    row.append(text, drop);
    host.append(row);
  }
}

var refreshRuleState = safe(refreshRuleStateNow, 'refreshRuleState');

$('break-arm').addEventListener('click', async () => {
  const key = $('break-preset').value;
  const preset = PRESETS[key];
  const count = Number($('break-count').value);
  const delayMs = Number($('break-delay').value);

  // The preset's English is the source of record in PRESETS above; the label
  // stored on the rule is the one the tester read when they armed it, so the
  // rule list and the status line agree with the dropdown they pressed.
  const presetLabel = tf(`popup.break.preset${key.charAt(0).toUpperCase()}${key.slice(1)}`, preset.label);
  const rule = {
    label: preset.action === 'delay' ? t('popup.break.slowFor', { label: presetLabel, s: (delayMs / 1000).toFixed(1) }) : presetLabel,
    enabled: true,
    pattern: $('break-pattern').value.trim(),
    method: 'ANY',
    action: preset.action,
    status: preset.status,
    body: preset.body,
    delayMs: preset.action === 'delay' ? delayMs : undefined,
    contentType: 'application/json',
    remaining: count === 0 ? null : count,
  };

  if (key === 'redirect') {
    const to = $('break-redirect').value.trim();
    if (!to) return say(t('popup.break.needDestination'), 'err');
    rule.redirectTo = to;
    rule.label = t('popup.break.redirectedTo', { to });
  }

  if (key === 'header' || key === 'noauth') {
    const name = key === 'noauth' ? 'Authorization' : $('break-header-name').value.trim();
    if (!name) return say(t('popup.break.needHeader'), 'err');
    // An empty value means remove: the point of the preset is to find out what
    // the app does when a header it assumes is present simply is not.
    const value = key === 'noauth' ? null : $('break-header-value').value.trim() || null;
    rule.headers = { [name]: value };
    rule.label = value === null ? t('popup.break.removedHeader', { name }) : t('popup.break.setHeader', { name, value });
  }

  // Added, not set: arming a second rule must not silently drop the first.
  const res = await send({ type: 'UQA_ADD_RULE', rule });
  window.UQASound?.play(res.ok ? 'rule.armed' : 'status.error');
  if (!res.ok) return say(res.error, 'err');
  const live = (res.result || []).filter((r) => r.enabled !== false && (r.remaining == null || r.remaining > 0)).length;
  say(
    t('popup.break.armed', {
      label: rule.label,
      rules: plural(live, 'popup.count.ruleOne', 'popup.count.ruleMany'),
    }),
    'ok'
  );
  refreshRuleState();
});

/*
 * E13: stop the breaking, without reloading and without losing the evidence.
 *
 * Nader asked for "a button that clears the effect without reloading the page
 * and without clearing the data stored from the broken request". Both halves
 * were already true and neither was said, which is the same as neither being
 * true: the button read "Clear all", which in a tool full of sessions and
 * exports sounds like it might clear those too, so the safe move was to reload
 * the page instead and lose the state that had taken ten minutes to reach.
 *
 * Nothing here reloads anything. The rules come off the network layer, so the
 * next request the page makes goes through normally, and every failure the
 * armed rules already produced stays in the session exactly as it was: it is
 * evidence, and it is the reason the rule was armed in the first place.
 */
$('break-clear').addEventListener('click', async () => {
  const before = await send({ type: 'UQA_GET_RULES' });
  const armed = ((before.ok ? before.result : []) || []).length;
  const res = await send({ type: 'UQA_SET_RULES', rules: [] });
  if (!res.ok) return say(res.error, 'err');
  // The English stays beside the key: tools/test-tool-cards.mjs reads this
  // handler for the promise that the evidence is still there, which is E13.
  say(
    armed
      ? tf(
        'popup.break.cleared',
        `${plural(armed, 'popup.count.ruleOne', 'popup.count.ruleMany')} taken off. Evidence stays.`,
        { rules: plural(armed, 'popup.count.ruleOne', 'popup.count.ruleMany') }
      )
      : t('popup.break.clearedNone'),
    'ok'
  );
  refreshRuleState();
});

/* ------------------------------------------------------------ notes + shots */

const TAG_WORD = { bug: 'Bug', issue: 'Issue', question: 'Question', '': 'Note' };

/** The tag as the tester reads it. The English above is the source of record. */
const tagWord = (tag) => tf(`popup.tags.${tag || 'note'}`, TAG_WORD[tag] ?? TAG_WORD['']);

/**
 * The echo: what this session has been told, listed under the note row.
 *
 * Built here rather than in `popup.html` because it is the popup's own memory
 * of the presses it has made, not part of the page's structure — and because a
 * note only ever has one place to go, the row is created the first time one is
 * written and never again.
 *
 * It answers the question the status line cannot. `say()` shows one message and
 * wipes it after four seconds, so a tester who filed three notes in a row had
 * no way to see that all three landed — and no way to see that the third is
 * still in flight. Newest first, because the one worth looking at is the one
 * just written and a 348px popup has no room to scroll for it.
 */
function noteEcho() {
  const live = $('step-live');
  if (!live || SURFACE === 'panel') return null; // e1022: the panel keeps no list; popup/action-stack.js shows the outcome
  let list = live.querySelector('#note-echo');
  if (!list) {
    list = el('ul', 'note-echo');
    list.id = 'note-echo';
    // Polite, not assertive: this is a receipt, and it must not interrupt a
    // screen reader in the middle of the status line saying the same thing.
    list.setAttribute('aria-live', 'polite');
    list.setAttribute('aria-label', t('popup.note.echoAria'));
    live.append(list);
  }
  return list;
}

/** One echoed note, provisional until the worker confirms it. */
function echoNote(tag, text) {
  const list = noteEcho();
  if (!list) return null;
  const row = el('li', 'note-echo-row');
  row.append(el('span', 'note-echo-tag', tagWord(tag)), el('span', 'note-echo-text', text));
  list.prepend(row);
  // Ten is a glance. A hundred is a scroll bar in a popup that has no room for
  // one, and the session sheet is where the full list belongs anyway.
  while (list.children.length > 10) list.lastElementChild.remove();
  return row;
}

async function addNote(tag = '') {
  const text = $('note-text').value.trim();
  if (!text) return say(t('popup.note.typeFirst'), 'err');

  let row = null;
  const sent = await optimistic(
    (pending) => {
      row = pending(echoNote(tag, text));
      $('note-text').value = '';
      say(t('popup.note.recorded', { tag: tagWord(tag) }), 'ok');
      return () => {
        row?.remove();
        // Handed back, not lost. Retyping a sentence because the worker was
        // asleep is the tester paying for our bug.
        $('note-text').value = text;
      };
    },
    () => send({ type: 'UQA_NOTE', text, tag: tag || null }),
    { settle: () => refresh() }
  );
  if (sent?.ok !== false) noteKit?.draft.clear(); // REQ-P1-4: a note that landed is no longer a draft
}

/**
 * The tag is chosen first, then either action carries it: a note, or a
 * screenshot with that note attached. "Take a screenshot AND say it is a bug
 * called X" used to be three presses in two places; it is one row now.
 */
let chosenTag = 'bug';
function paintTags() {
  document.querySelectorAll('[data-tag]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tag === chosenTag)));
}
/**
 * NOTE lane modules (contract C6), ES modules loaded by import() because this is a classic script: the last note type
 * (`noteType`, a preference), Enter saves under it, and an unsent note survives a closed popup (`popupDraft`, masked, session memory).
 */
let noteKit = null;
const noteReady = Promise.all([import('./note-row.js'), import('./draft.js')]).then(async ([row, dr]) => {
  const type = row.createNoteType();
  await type.load();
  chosenTag = type.tag();
  paintTags();
  noteKit = { row, type, draft: dr.createDraft({ area: chrome.storage.session }) };
  row.bindNoteEnter($('note-text'), type, (tag) => addNote(tag));
  return noteKit;
}).catch(() => {
  $('note-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) addNote(chosenTag); });
  return null;
});
document.querySelectorAll('[data-tag]').forEach((b) =>
  b.addEventListener('click', () => {
    chosenTag = b.dataset.tag;
    paintTags();
    noteKit?.type.set(noteKit.row.typeForTag(chosenTag));
    $('note-text').focus();
  })
);
paintTags();
$('note-type')?.addEventListener('click', () => {
  const chips = $('note-chips');
  chips.hidden = !chips.hidden;
  $('note-type').setAttribute('aria-expanded', String(!chips.hidden));
});
$('note-text').addEventListener('input', (e) => noteKit?.draft.save(e.target.value, 'note'));
$('charter').addEventListener('input', (e) => noteKit?.draft.save(e.target.value, 'charter'));
addEventListener('pagehide', () => noteKit?.draft.flush());
/** Once per session id, after the first state read: put back what was typed and not sent. */
let draftFor;
async function restoreDraft() {
  const id = state.session?.id ?? null;
  if (draftFor === id) return;
  draftFor = id;
  const d = await (await noteReady)?.draft.restore(id);
  if (!d) return;
  if (d.note && !$('note-text').value) $('note-text').value = d.note;
  if (d.charter && !$('charter').value) $('charter').value = d.charter;
  say(t('popup.draft.restored'), 'ok', { silent: true });
}

$('note-add').addEventListener('click', () => addNote(chosenTag));

$('shot').addEventListener('click', async () => {
  const text = $('note-text').value.trim();
  let row = null;

  const shotRes = await optimistic(
    (pending) => {
      if (text) row = pending(echoNote(chosenTag, text));
      $('note-text').value = '';
      // `UQA_CAPTURE` is logged as the `shot` tool by the worker, so the card's
      // used-mark moves with the press rather than with the answer.
      const unbump = bumpUsed('shot', pending);
      const camBack = flashCamera(); // a tick on the camera: an empty-note press was a press with no sign of it
      // The second sentence keeps its English beside the key: a suite waits for
      // it on #status after the settle.
      say(
        text
          // The lower-case tag, as the sentence had it before: "added with the
          // bug", not "added with the Bug".
          ? t('popup.note.shotWith', { tag: t(`popup.tags.lower.${chosenTag || 'note'}`) })
          : tf('popup.note.shotAdded', 'Screenshot added to the session.'),
        'ok',
        { silent: true }
      );
      return () => {
        row?.remove();
        $('note-text').value = text;
        unbump(); camBack();
      };
    },
    async () => {
      // The note goes in first, tagged, so it lands in the right section of the
      // sheet; the screenshot follows carrying the same words as its caption.
      if (text) {
        const noted = await send({ type: 'UQA_NOTE', text, tag: chosenTag || null });
        if (!noted.ok) return noted;
      }
      return send({ type: 'UQA_CAPTURE', text });
    },
    {
      settle: () => {
        // The shutter sounds once the screenshot exists, never on a failure
        // (a failure says status.error through optimistic()).
        uqaSound()?.play('capture.shot');
        return refresh();
      },
    }
  );
  if (shotRes?.ok !== false) noteKit?.draft.clear();
});

/* ---------------------------------------------------------- task breakdown */

function breakdownValues() {
  return {
    design: Number($('bd-design').value) || 0,
    bugs: Number($('bd-bugs').value) || 0,
    setup: Number($('bd-setup').value) || 0,
    charter: Number($('bd-charter').value) || 0,
  };
}

function paintBreakdown() {
  const b = breakdownValues();
  const total = b.design + b.bugs + b.setup;
  const stateLine = $('bd-state');
  const ok = total === 100;
  stateLine.textContent = ok ? t('popup.breakdown.ready') : t('popup.breakdown.short', { total });
  stateLine.className = ok ? 'rule-state' : 'rule-state armed';
  $('bd-save').disabled = !ok;
}

['bd-design', 'bd-bugs', 'bd-setup', 'bd-charter'].forEach((id) =>
  $(id).addEventListener('input', paintBreakdown)
);

$('bd-save').addEventListener('click', async () => {
  const target = exportableSession();
  if (!target) return say(t('popup.err.noSessionBreakdown'), 'err');
  const res = await send({
    type: 'UQA_SET_BREAKDOWN',
    sessionId: target.id,
    breakdown: breakdownValues(),
  });
  if (!res.ok) return say(res.error, 'err');
  say(t('popup.breakdown.saved'), 'ok');
  $('breakdown').open = false;
});

/* The surface, `ctx` and `dismiss` are declared at the top of this file, where
   everything built from them can see them. */

$('dock')?.addEventListener('click', (event) => {
  // Synchronous on purpose: `sidePanel.open()` is gated on the click's gesture, which does not survive an `await` and cannot be handed
  // to the worker. So the popup opens the panel itself, and the first `open()` below is called before anything is awaited.
  if (!event.isTrusted || !hasSidePanel()) return; // no side panel, no press (the button is not drawn there: popup/guards.js)
  // The side panel belongs beside the page, not in the float this click is about to replace: `ctx.windowId` is the window under test, but
  // it is the float itself when the browser has no testable page (then the browser window beneath, `ctx.hostWindowId`). Every candidate
  // is tried in turn, because a stale id must cost a retry, not the whole press.
  const beside = [ctx.windowId, ctx.hostWindowId].filter((id) => id != null && id !== ctx.ownWindowId);
  const targets = [...new Set(beside.length ? beside : [ctx.ownWindowId ?? chrome.windows.WINDOW_ID_CURRENT])];
  const attempt = (windowId) => chrome.sidePanel.open({ windowId }).then(() => windowId);
  try {
    targets.slice(1).reduce((p, id) => p.catch(() => attempt(id)), attempt(targets[0]))
      .then(async (windowId) => {
        // The float that asked is the float being replaced: it closes itself rather than trusting the worker's record of which window it is.
        await send({ type: 'UQA_DOCKED', windowId });
        if (IN_FLOAT) window.close();
      })
      .catch(dockFailed);
  } catch (err) {
    dockFailed(err);
  }
});

$('view-report').addEventListener('click', async () => {
  const target = exportableSession();
  if (!target) return say(t('popup.err.noSessionReport'), 'err');
  await send({ type: 'UQA_OPEN_REPORT', sessionId: target.id, format: 'markdown' });
  dismiss();
});

$('open-options').addEventListener('click', () => {
  send({ type: 'UQA_OPEN_OPTIONS' });
  dismiss();
});

/*
 * The route to the one page that can ask for the microphone and the camera.
 *
 * Delegated on the document rather than attached to the element, because the
 * capture panel is stamped fresh into its row by every `renderTools()` — an
 * element wired at boot is replaced by the first render and the link then does
 * nothing. Deliberately NOT a `[data-action]` button: those are all disabled
 * while the window is asleep, and reading how to grant a permission is exactly
 * what somebody does before deciding to wake anything.
 */
document.addEventListener('click', async (event) => {
  if (!event.target.closest?.('#grant-media')) return;
  /*
   * Two destinations, and which one is right depends on the answer Chrome
   * already holds.
   *
   * `prompt` and `unknown` mean nobody has been asked yet, so Settings can ask:
   * it opens at Permissions and walks the three grants in order. `denied` means
   * the tester has already said no, and **Chrome will not let any page ask
   * again** — the only place that answer can be taken back is Chrome's own site
   * settings for this extension. Sending them to Settings in that state is
   * sending them to a button that cannot work.
   */
  const res = await send({ type: 'UQA_MEDIA_PERMISSIONS' });
  const held = res?.ok ? res.result || {} : {};
  const blocked = held.microphone === 'denied' || held.camera === 'denied';
  await send({ type: blocked ? 'UQA_OPEN_SITE_SETTINGS' : 'UQA_OPEN_PERMISSIONS' });
});

/**
 * What the button says, which is not always the same thing.
 *
 * Only this button and its one line of help: the chips beside it are painted by
 * `paintMediaPermissions` and stay its business.
 */
async function paintGrantButton() {
  const button = document.getElementById('grant-media');
  const note = document.getElementById('grant-media-note');
  if (!button) return;
  const res = await send({ type: 'UQA_MEDIA_PERMISSIONS' });
  const held = res?.ok ? res.result || {} : {};
  const blocked = held.microphone === 'denied' || held.camera === 'denied';
  const ready = held.microphone === 'granted' && held.camera === 'granted' && held.desktopCapture;
  button.textContent = t(blocked ? 'popup.grant.blocked' : ready ? 'popup.grant.ready' : 'popup.capture.grant');
  if (!note) return;
  note.textContent = t(blocked ? 'popup.grant.blockedNote' : ready ? 'popup.grant.readyNote' : 'popup.grant.askNote');
}

/**
 * The footer's "Timeline", which used to do nothing you could see.
 *
 * It printed "Press F12, then choose the QA Wrap tab" and stopped. That is a
 * link that answers a question nobody asked: the tester pressed a thing called
 * Timeline because they wanted to see the timeline, and got homework. Nader's
 * words were "what does the Timeline button do? fix it."
 *
 * It opens the timeline. The session's report, on its Timeline tab, in a tab of
 * its own, which is where the timeline actually lives. With no session yet it
 * is disabled and says why, rather than opening an empty page.
 */
$('open-panel').addEventListener('click', async () => {
  const target = exportableSession();
  if (!target) return say(t('popup.err.noSessionTimeline'), 'err');
  await send({ type: 'UQA_OPEN_REPORT', sessionId: target.id, format: 'markdown', tab: 'timeline' });
  dismiss();
});

/**
 * And it says which session it would open.
 *
 * "Timeline" alone is a word, not an offer. With a run in progress the label
 * carries the charter, so the link names the thing it opens; with none it is
 * disabled and the title says what to do first. Painted from `paintUsage()`,
 * which already runs on every state change and on the ticker.
 */
function paintTimelineLink() {
  const btn = $('open-panel');
  if (!btn) return;
  const target = exportableSession();
  const name = (target?.charter || '').trim();
  btn.disabled = !target;
  ($('open-panel-text') || btn).textContent = name ? t('popup.foot.timelineNamed', { name: iso(name) }) : t('popup.foot.timeline');
  btn.title = target
    ? t('popup.foot.timelineOpen', { name: iso(name) || t('popup.foot.thisSession') })
    : t('popup.foot.timelineNone');
}

/**
 * The films, on their own page, from the one place every tester already looks.
 *
 * They used to be a card at the top of Settings, which put them in front of
 * somebody trying to change a slider and nowhere near somebody who wanted to
 * watch one. The footer is where the popup already keeps its way out.
 */
$('open-tutorials')?.addEventListener('click', () => openTutorials());

/**
 * Chrome can keep a previously-registered service worker alive across an
 * extension update, so a freshly-loaded popup ends up talking to yesterday's
 * backend. Everything then fails in confusing ways — blank sliders, no exports,
 * "the message port closed" — with nothing on screen to explain it.
 *
 * Check on every open, and offer the one-click cure.
 */
async function checkWorkerBuild() {
  const expected = chrome.runtime.getManifest().version;
  const res = await send({ type: 'UQA_PING' });
  const running = res?.ok ? res.result?.build : null;
  if (running === expected) return true;

  const bar = document.createElement('div');
  bar.className = 'stale-bar';
  const text = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = t('popup.stale.title');
  text.append(
    strong,
    document.createElement('br'),
    t('popup.stale.body', {
      running: running ? t('popup.stale.build', { build: running }) : t('popup.stale.older'),
      expected,
    })
  );
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = t('popup.stale.reload');
  btn.addEventListener('click', () => reloadCarefully());
  bar.append(text, btn);
  document.body.prepend(bar);
  return false;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  /*
   * This extension's own worker and pages, and nothing else.
   *
   * Nothing is declared externally connectable, so a web page cannot reach this
   * at all and another extension's message would carry that extension's id.
   * `sender.id` is stamped by the browser rather than claimed by the sender,
   * which is what makes it the thing to check; `sender.url` is not, and is
   * never checked here (research/51d §7).
   */
  if (sender?.id !== chrome.runtime.id) return;
  if (msg?.type === 'UQA_SETTINGS_CHANGED') {
    // One handler, one repaint. This used to update `settings` and then repaint
    // the shortcut chips alone, so the capture ticks and the two sliders kept
    // yesterday's values until the popup was reopened.
    settings = msg.settings;
    paintFromSettings();
  }
  if (msg?.type === 'UQA_STATE_CHANGED') {
    // The world moved, so where we are acting may have moved with it.
    resolveCtx().catch(() => { /* the refresh below will say so */ });
    refresh();
  }
  if (msg?.type === 'UQA_RECORDING_CHANGED') paintRecording(); pageToolMessage(msg); // pageToolMessage: UQA_PICKED, UQA_MASK_DONE (popup/tool-actions.js)
  // E16 / research/55, §7. A window-size run opening or closing changes what
  // the session holds, so the usage marks and the process bar move with it.
  if (msg?.type === 'UQA_VIEWPORT_CHANGED') {
    refresh();
    // And the panel itself: a run that resized this window puts a way back on
    // it, and a run that ended takes it off again.
    renderViewports();
  }
  if (msg?.type === 'UQA_RULES_CHANGED') refreshRuleState();
  if (msg?.type === 'UQA_ARMED_CHANGED') paintSwitch();
});

/* ---------------------------------------------------------------------- boot */

/**
 * One explicit entry point. This used to be a bare refresh() call, and a
 * find-and-replace once moved the rest of the start-up into a click handler —
 * so the sliders, the shortcut chips and the stale-worker check never ran at
 * all, and every control in the popup came up blank.
 */
/**
 * Boot, with its phases self-reporting.
 *
 * "The popup takes 1.6 seconds on a slow machine" is not actionable; "the
 * worker round trip is 1.2s of it and our rendering is 90ms" is. The same
 * lesson the layout-stress benchmark taught the hard way — a budget on work you
 * do not control is still worth having, but it has to be labelled as such
 * rather than left looking like a code smell.
 *
 * Four marks, read by tools/perf.mjs and free at runtime.
 */
/**
 * The consent gate, drawn as one attribute on the body.
 *
 * `popup.css` hides the pointer, the switch, the process bar, the mode switch
 * and the whole tool wall while it is `false`, so there is exactly one place
 * that knows what the gate covers and it is the stylesheet rather than a list
 * of elements here that would go stale the next time a card is added.
 */
function paintConsent(consented) {
  document.body.dataset.consented = String(!!consented);
  const card = $('consent-card');
  if (card) card.hidden = !!consented;
  // R05 (decision 113): the tool wall (#body, the .scroll main) stays visible
  // and dimmed behind the gate instead of being display:none — but it must be
  // provably inert, not merely dim, per research/51d §1 (store compliance: a
  // control a reviewer can still tab to or activate is not gated at all).
  // `inert` is the real mechanism: Chrome removes the subtree from the tab
  // order, from hit-testing and from the accessibility tree (it implies
  // aria-hidden). aria-hidden is set explicitly too, for anything that reads
  // the DOM rather than the accessibility tree, and popup.css's
  // pointer-events: none is the CSS-only fallback if `inert` is ever
  // unsupported. A reviewer confirms it by tabbing through the popup while
  // data-consented="false": focus never lands inside #body.
  for (const wall of [$('body'), $('tool-sheet')]) {
    if (!wall) continue;
    wall.inert = !consented;
    if (consented) wall.removeAttribute('aria-hidden');
    else wall.setAttribute('aria-hidden', 'true');
  }
}

/* T-071: in organisation mode the card links the organisation's notice; the first step and the acceptance are the same. */
function paintOrgNotice(url) {
  const link = $('consent-org');
  if (!link || !/^https:/.test(url || '')) return;
  link.href = url;
  link.hidden = false;
  const body = $('consent-card')?.querySelector('[data-i18n="popup.consent.body"]');
  if (body) { body.dataset.i18n = 'popup.consent.orgBody'; body.textContent = t('popup.consent.orgBody'); } // the key moves with it, so a language switch keeps the organisation wording
}

/* T-056: the Trust page, linked from the card in both modes (the organisation's notice, when there is one, comes first). The address is PRODUCT.urls.trust, read here rather than typed. */
function paintTrustLink() {
  const link = $('consent-trust');
  if (!link) return;
  import('../core/product.js').then(({ PRODUCT }) => { if (!PRODUCT.urls.trust) return; link.href = PRODUCT.urls.trust; link.hidden = false; }).catch(() => {}); // empty address: the link stays hidden
}

/*
 * T-063: the footer's "Report a problem by email". The body is the support bundle, the same text
 * Settings previews (core/support-bundle.js); the link only starts the tester's mail program, this page sends nothing.
 * The bundle ends with the handler log, so cutting the tail to fit a mail link drops the oldest-to-newest log first.
 */
const MAIL_MAX = 1800; // ponytail: encoded characters a mail client reliably takes in a mailto; no attachment path
async function paintMailLink() {
  const a = $('report-mail');
  if (!a) return;
  try {
    const [{ buildBundle }, { detect }, { RING_KEY }, { describe }, { DEFAULTS }] = await Promise.all([
      import('../core/support-bundle.js'), import('../core/capabilities.js'), import('../core/on.js'), import('../core/product.js'), import('../platform/settings.js'),
    ]);
    const local = /** @type {any} */ (await chrome.storage.local.get([RING_KEY, 'firstReportOpenedAt', 'bootMs', 'toolUseTicks']));
    const perms = await chrome.permissions.getAll().catch(() => ({ origins: [] }));
    const d = describe(); if (!d.supportEmail) return; // no mailbox in brand.json: the footer row stays hidden
    let body = buildBundle({
      name: d.name, build: `${d.code} (v${d.version})`, version: chrome.runtime.getManifest().version, ua: navigator.userAgent,
      capabilities: detect().caps, originCount: (perms.origins || []).length, settings, defaults: DEFAULTS,
      ring: local[RING_KEY], firstReportOpenedAt: local.firstReportOpenedAt, bootMs: local.bootMs, toolUseTicks: local.toolUseTicks,
    });
    // A cut (or the bundle's own 160-character line cut) can split an emoji; encodeURIComponent throws on a lone surrogate,
    // which used to hide the link for a tester with one in the log (completion review 9).
    const wellFormed = (x) => x.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD'); // glyph-ok: code points tested, never drawn
    body = wellFormed(body);
    while (encodeURIComponent(body).length > MAIL_MAX) body = wellFormed(body.slice(0, Math.floor(body.length * 0.9)));
    a.href = `mailto:${d.supportEmail}?subject=${encodeURIComponent(`${d.name} ${d.version}`)}&body=${encodeURIComponent(body)}`;
    a.hidden = false;
  } catch { /* no link is better than a link that goes nowhere */ }
}

/* T-019: accepting happens on the welcome tab; this popup repaints itself when `consentedAt` lands. */
function onConsentChanged(changes, area) {
  if (area === 'local' && changes?.consentedAt) paintConsent(!!changes.consentedAt.newValue);
}
chrome.storage.onChanged.addListener(onConsentChanged);

document.getElementById('consent-open')?.addEventListener('click', async () => {
  // The notice is a page, not a paragraph in a popup: it is bilingual, it is
  // long enough to need scrolling, and a store reviewer has to be able to reach
  // it from Settings afterwards. Accepting happens there, so the popup does not
  // repaint here — onConsentChanged below repaints it.
  await send({ type: 'UQA_OPEN_WELCOME' });
  say(t('popup.consent.opened'), 'ok');
});

async function boot() {
  /*
   * The language first, before a single word is drawn.
   *
   * `platform/i18n.js` has already stamped `lang` and `dir` on <html> from its
   * synchronous mirror, so the frame is the right way round before first paint.
   * This is the other half: the tables, and `QAWi18n.apply()` filling in every
   * `data-i18n` element in the markup. Everything below draws words, and a popup
   * that renders in English and repaints in Arabic a beat later is the jump this
   * exists to remove.
   */
  await QAWi18n.ready();
  const T = { start: performance.now() };
  earlyState = send({ type: 'UQA_POPUP_STATE' }); // the worker resolves the tab itself, as UQA_TARGET_TAB does
  window.UQASound?.wire(document);
  paintTheme();
  paintLang();
  // "Read the field" lives inside a stamped panel now, so it is wired by
  // stampPanel() at creation rather than once, here, against an element that
  // the next render replaces.
  Object.keys(RANGE_SPEC).forEach(wireRange);
  paintBreakdown();
  // The build check, the settings read and the syllabus model are three
  // independent round-trips to the worker. Waiting for one before starting the
  // next put two extra wake-ups on the critical path, which is felt exactly on
  // the slow machines where the popup already takes longest to appear.
  /**
   * Boot finishes by saying so.
   *
   * Anything measuring "popup open › interactive" needs an edge, and it used to
   * watch a slider's output text — a slider that was later deleted, which left
   * the benchmark waiting thirty seconds for an element that no longer existed
   * and the popup budget unmeasured for two versions.
   *
   * A signal the work itself raises cannot go stale that way: whatever the
   * popup is made of next, boot() still ends here.
   */
  T.chrome = performance.now();
  const [healthy, , gotModel, gotCaps, gotConsent, gotAccess] = await Promise.all([
    checkWorkerBuild(),
    loadSettings(),
    send({ type: 'UQA_ISTQB_MODEL' }),
    send({ type: 'UQA_CAPABILITIES' }),
    // In the same round of round trips as the rest, not after it: the consent
    // gate decides what the popup is allowed to draw, and asking for it in a
    // second wave would paint the whole tool wall and then take it away.
    send({ type: 'UQA_CONSENT' }),
    send({ type: 'UQA_SITE_ACCESS' }),
    // Resolved before anything is rendered: toolRow() names the tab when it
    // asks whether this one can be recorded, and the switch names the window.
    resolveCtx(),
    // The starred tools, so the first render already has them on top.
    loadFavourites(),
  ]);
  if (gotCaps?.ok) capabilities = gotCaps.result;
  // Fails closed: a worker that cannot answer has not told us consent was
  // given, and a product that shows its recorder to somebody who was never
  // shown the notice is the failure this gate exists for.
  paintConsent(!!gotConsent?.ok && !!gotConsent.result.consented);
  paintOrgNotice(gotConsent?.ok ? gotConsent.result.consentUrl : '');
  paintTrustLink();
  setTimeout(paintMailLink, TIMING.mailLinkDelay); // a footer link: its five imports and two reads wait until the first paint is done (completion review 9)
  await paintSiteAccess(gotAccess?.ok ? gotAccess.result : undefined);
  // Drawn after the model arrives, so the tools come up already grouped rather
  // than reflowing into their activities a beat later.
  T.fetched = performance.now();
  if (gotModel?.ok) model = gotModel.result;
  renderTools();
  // The viewport list comes from the worker so the popup and the report cannot
  // disagree about what "Tablet" means.
  send({ type: 'UQA_VIEWPORTS' }).then((r) => r.ok && renderViewports(r.result));
  T.rendered = performance.now();
  await refresh();
  if (!healthy) say(t('popup.err.staleWorker'), 'err');

  T.done = performance.now();
  // Rounded and attached, not logged: a console line is invisible to a harness
  // and noise to a tester.
  window.UQABootTimings = {
    chromeMs: Math.round(T.chrome - T.start),
    fetchMs: Math.round(T.fetched - T.chrome),
    renderMs: Math.round(T.rendered - T.fetched),
    refreshMs: Math.round(T.done - T.rendered),
    totalMs: Math.round(T.done - T.start),
  };
  // T-022: a job that finished while the popup was closed and the sound was off leaves one line here, once.
  try {
    const got = await chrome.storage.session.get('uqa.doneJob');
    if (got['uqa.doneJob']) { say(t('popup.done.finishedAway'), 'ok', { silent: true }); await chrome.storage.session.remove('uqa.doneJob'); }
  } catch { /* no session storage: the badge mark stays until the next run */ }
  document.body.dataset.ready = 'true';
  loadCommandChips().catch(() => {});
}

/**
 * A language change repaints the popup. It never reloads it.
 *
 * `QAWi18n.apply()` refills every `data-i18n` element in the markup; everything
 * below redraws what this file writes by hand. The tool wall is rebuilt from
 * `TOOLS`, which stamps every option panel again, and the four asynchronous
 * paints ask the worker for what they cannot derive. A reload would throw away
 * the charter somebody was halfway through typing, and would take longer.
 *
 * Registered outside `boot()` so it is in place before the first render, and
 * `chrome.storage.onChanged` carries the change here from the other surfaces
 * without a message passing through the worker.
 */
QAWi18n.onChange(() => {
  QAWi18n.apply();
  paintTheme();
  paintLang();
  paintTags();
  paintBreakdown();
  // The two sliders print their own units, and the unit is a word.
  Object.keys(RANGE_SPEC).forEach((id) => $(id)?.__paint?.());
  // Rebuilds every card and stamps every panel, and pulls paintFromSettings(),
  // paintUsage(), renderViewports() and paintPartitions() with it.
  renderTools();
  paintSwitchState(awake);
  paintSiteAccess();
  refresh();
});

boot();

/* ── the one-time pointer to the practice page (T-050) ────────────────── */

/**
 * Shown once, on the first run, and never again once it has been answered.
 *
 * It used to point at 42 MB of English films; the films are hosted now and a
 * first run is better spent on the hosted practice page, which has three faults
 * planted in it and ends at a report that names two of them. The address comes
 * from the manifest's own `homepage_url`, so it moves in one place
 * (`PRODUCT.urls.practice`, core/product.js, is the same string).
 */
/** The films, in their own tab. Still reached from Settings and the tools. */
function openTutorials() {
  chrome.tabs.create({ url: chrome.runtime.getURL('tutorials/tutorials.html') });
}


function renderPointer() {
  const host = document.getElementById('pointer');
  if (!host) return;
  let done = false;
  try { done = localStorage.getItem('qaw-tutorial-seen') === '1'; } catch { /* no storage */ }
  if (done) return;
  // A class, not the `hidden` attribute: `.pointer { display: grid }` beats
  // `[hidden]`, so the attribute silently did nothing in either direction.
  host.classList.add('is-on');
  const put = () => { try { localStorage.setItem('qaw-tutorial-seen', '1'); } catch { /* no storage */ } };
  const go = () => {
    put();
    host.classList.remove('is-on');
    openPractice();
  };
  host.querySelector('#pointer-practice')?.addEventListener('click', go);
}

renderPointer();
