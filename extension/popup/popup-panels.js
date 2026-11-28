/* QA Wrap — popup: tab context, session cards, technique and coverage panels (split from popup.js; classic script, same global scope). */
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
