/* QA Wrap — popup: capture options, timeline, work-live and banners, the refresh loop (split from popup.js; a classic script loaded right after it, same global scope). */
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
