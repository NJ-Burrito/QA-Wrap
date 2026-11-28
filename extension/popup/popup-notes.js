/* QA Wrap — popup: notes, consent, boot and the pointer card (split from popup.js; classic script, same global scope). */
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
