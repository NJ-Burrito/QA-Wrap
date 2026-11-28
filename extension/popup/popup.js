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
  const sig = SIG.visibleProblems(FC?.withRecovery?.(events) ?? events, 'all'); // D5: a recovered failure is amber, not a problem, in the rows and the tier
  const level = sgLevel();
  const promo = sgPromoted(sid);
  const rows = level === 'all' ? sig.rows : sig.rows.filter((r) => r.c === 'D' || r.r === 'n-recovered' || promo.has(r.key)) /* D5: amber, visible, not a problem */;
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
