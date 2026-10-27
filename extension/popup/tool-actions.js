/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/* The tool presses (toolResult, ACTIONS, REFUSAL, PRESS_SAYS, the delegated click router, readPartitions): a sibling of popup.js on the same global scope, used at event time only. */
async function toolResult(res, okMessage) {
  if (!res.ok) return say(res.error, 'err');
  if (res.result === null) return say(needsReload(), 'err');
  if (okMessage) say(okMessage, 'ok');
  return true;
}

/** The note row's camera answers where the finger is: a tick for a moment, with or without a note. Returns the undo. */
function flashCamera() {
  const cam = $('shot');
  const back = () => { cam.replaceChildren(icon('screenshot')); cam.classList.remove('is-done'); };
  cam.replaceChildren(icon('check'));
  cam.classList.add('is-done');
  setTimeout(back, TIMING.copiedTick);
  return back;
}

/** A picker is on: the locator it started from. The next different locator that reaches the popup finishes the press. */
let pickFrom = null;
function pickSettled() {
  if (pickFrom === null || !lastLocator || lastLocator === pickFrom) return;
  pickFrom = null;
  say(t('popup.pick.done', { locator: locatorLabel(lastLocator) }), 'ok', { keep: true });
}
/**
 * What a page tool tells the open panel when no session is there to carry it (ui-1016 lane L). Both messages come from
 * content scripts through runtime.sendMessage; the worker ignores them, so only the panel, float or popup that is open hears.
 *  - UQA_PICKED: a locator was copied; with no session the note is stored nowhere, so this is the only way the line learns it.
 *  - UQA_MASK_DONE: Esc ended the masking crosshair; the panel says how many things are covered on that page.
 */
function pageToolMessage(msg) {
  if (msg?.type === 'UQA_PICKED' && typeof msg.text === 'string') {
    lastLocator = pickedLocatorText(msg);
    if (pickFrom !== null) pickFrom = ''; // any copy settles the press, even of the element the last one pointed at
    paintLocatorNow();
  } else if (msg?.type === 'UQA_MASK_DONE') {
    document.querySelector('[data-action="mask"]')?.setAttribute('aria-pressed', 'false');
    const n = Number(msg.n) || 0;
    say(n ? t(n === 1 ? 'popup.mask.maskedOne' : 'popup.mask.maskedMany', { n }) : t('popup.mask.none'), 'ok', { keep: true });
  }
}
/** The one-line outcome of a tool that writes a document: an Open button to the report's Save tab, where the file is. */
const openResult = () => ({ key: 'popup.tool.open', label: 'Open', run: async () => {
  const target = exportableSession();
  if (target) { await send({ type: 'UQA_OPEN_REPORT', sessionId: target.id, format: 'markdown', tab: 'file' }); dismiss(); }
} });

/**
 * One delegated listener, not one listener per button.
 *
 * (the rest of this note is archived in popup/REFACTOR.md)
 */
/** The links outcome. Sites the worker could not read (no host permission) get one line and an Allow button: the press asks Chrome for exactly those origins, then only those links are checked again. */
async function showLinks(res, refused) {
  if (!(await toolResult(res))) return;
  const r = res.result;
  const need = siteAccess.policy === 'none' ? [] : [...new Set(r.rows.filter((x) => x.reason === 'unreadable').map((x) => new URL(x.url).origin + '/' + '*'))]; // split: a slash-star inside one string reads as a comment to tools/test-i18n.mjs
  const broken = r.broken.length;
  say(
    r.total
      ? plural(r.total, 'popup.count.linkOne', 'popup.count.linkMany') +
        (r.limited ? t('popup.links.limited', { checked: r.checked, checkable: r.checkable }) : '') +
        t('popup.links.broken', { n: broken }) +
        (broken ? t('popup.links.examples', { list: r.broken.slice(0, 2).map((b) => b.text || b.href).join(', ') }) : '') +
        t('popup.links.rest', { redirected: r.redirected.length, slow: r.slow.length, frames: framesRead(r) }) +
        (need.length ? t(refused ? 'popup.links.refused' : 'popup.links.need', { n: need.length }) : '')
      : t('popup.links.none', { frames: framesRead(r) }),
    broken ? 'err' : 'ok',
    { sound: broken ? 'links.broken' : 'links.clean', keep: true, ...(need.length && !refused ? { fix: { key: 'popup.links.allow', label: 'Allow', run: () => allowLinks(need, r) } } : {}) }
  );
  return refresh();
}

/** The Allow press. The request is the first statement (still inside the click); a refusal leaves the rows as "couldn't check". Chrome's permission bubble closes the toolbar popup, so the pending origins and rows are kept in session storage and the next open re-checks (resumeLinks); a surviving panel re-checks at once. */
const LINKS_PENDING = 'qaw.linksPending';
function allowLinks(need, r) {
  let asking;
  try { asking = chrome.permissions.request({ origins: need }); } catch { asking = false; }
  try { chrome.storage.session.set({ [LINKS_PENDING]: { need, rows: r.rows, tabId: ctx?.tabId, at: Date.now() } })?.catch?.(() => {}); } catch { /* no session storage: only a surviving panel re-checks */ }
  return Promise.resolve(asking).catch(() => false).then(async (granted) => {
    try { chrome.storage.session.remove(LINKS_PENDING)?.catch?.(() => {}); } catch { /* best effort */ }
    return granted ? recheckLinks(need, r.rows, ctx?.tabId) : showLinks({ ok: true, result: r }, true);
  });
}
/** Only the origins just granted are checked again; the other rows are carried over. */
async function recheckLinks(need, rows, tabId) {
  say(t('popup.links.asking'));
  return showLinks(await send({ type: 'UQA_CHECK_LINKS', only: need, prev: rows, tabId }));
}
/** A popup closed by the permission bubble: the next open finds the pending Allow and, if Chrome granted it, shows the re-check. */
async function resumeLinks() {
  /** @type {any} */ let p;
  try { p = (await chrome.storage.session.get(LINKS_PENDING))[LINKS_PENDING]; if (!p) return; await chrome.storage.session.remove(LINKS_PENDING); } catch { return; }
  if (!p.need?.length || Date.now() - p.at > 10 * 60_000 || !(await chrome.permissions.contains({ origins: p.need }))) return;
  return recheckLinks(p.need, p.rows, p.tabId);
}

/**
 * The tools whose used-mark is moved before the worker has counted it.
 *
 * (the rest of this note is archived in popup/REFACTOR.md)
 */
const OPTIMISTIC_COUNT = { shot: 'shot', a11y: 'a11y', perf: 'perf' };

/**
 * Two tools open a panel instead of doing something, and the panel is the
 * tool. Both are in `ANY_PAGE` below, because reading the panel is useful even
 * where the tool cannot run.
 *
 * (the rest of this note is archived in popup/REFACTOR.md)
 */
const openPanel = ({ btn }) => {
  const action = btn.dataset.action;
  const tool = TOOLS.find((t) => t.action === action);
  // Through the row, never by global id: the panel is stamped into the row
  // by renderTools(), so the row is the only thing that knows where it is.
  const panel = tool ? panelFor(tool.tool) : null;
  if (!panel) return;
  const row = panel.closest('.tool-row');
  const more = row?.querySelector('.tool-more');
  // Through the one toggle, so the panel that opens is also the panel that
  // scrolls itself into view (E3) and closes on an outside press.
  if (row && more) setToolPanel(row, more, panel, true);
  else panel.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  // Focus goes in, so the row is usable from the keyboard too.
  panel.querySelector('button, input, select, [tabindex]')?.focus();
  // The partitions panel needs a field, and it now has a crosshair for
  // choosing one rather than an instruction to have chosen one already.
  if (action === 'partitions') {
    say(t('popup.partitions.pressPick'));
  }
};

/**
 * What a tool press does, looked up by name — the shape
 * `background/service-worker.js` already uses for its messages. This was
 * sixteen `if (action === '…')` branches, each ending in a `return` whose only
 * job was to stop the next fifteen string comparisons.
 *
 * Each is handed the button pressed, the tab under test, and `counted()` —
 * which the three optimistic tools call once the worker confirms the used-mark,
 * so the listener's `finally` leaves the tick where it is.
 */
const ACTIONS = {
  partitions: openPanel,
  viewport: openPanel,
  mask: async ({ btn }) => {
    const res = await send({ type: 'UQA_MASK_PICK', tabId: ctx.tabId });
    if (!res.ok) return say(res.error, 'err');
    const { picking, count } = res.result || {};
    btn.setAttribute('aria-pressed', String(!!picking));
    // While picking, the page's own bar says what to do (overlay.mask.tip); the panel stays quiet.
    // ui-1016 L: the panel says what to do while the crosshair is on (the page's own bar is absent with no session); the page reports the count on Esc (UQA_MASK_DONE).
    return say(
      picking
        ? t('popup.mask.picking')
        : count
          ? t(count === 1 ? 'popup.mask.maskedOne' : 'popup.mask.maskedMany', { n: count })
          : t('popup.mask.none'),
      'ok',
      { keep: true }
    );
  },
  'break-toggle': ({ btn, tab }) => {
    const panel = $('break-panel');
    const opening = panel.hidden;
    // break-panel lives in `.work`, not in a stamped row, so it never went
    // through `setToolPanel`'s one-at-a-time rule: a row left open from
    // `.tool-more` (partitions, viewport, …) stayed open underneath it — the
    // still-expanded sheet then intercepted clicks meant for it (narrow), and
    // `.app:has(.tool-row.is-open) .work { visibility: hidden }` could hide it
    // outright (wide) [V, clickthrough: "#break-arm" intercepted by
    // "#partitions-read" from the still-open sheet]. Opening it closes those
    // the same way opening any of them closes the others.
    if (opening) closeToolPanels();
    setBreakPanel(opening, opening);
    if (!panel.hidden && tab?.url) {
      try {
        $('break-pattern').placeholder = t('popup.break.patternExample', { path: new URL(tab.url).pathname });
      } catch { /* opaque url */ }
    }
  },
  coverage: async ({ btn }) => {
    const running = btn.getAttribute('aria-pressed') === 'true';
    if (running) {
      say(t('popup.coverage.working'));
      const res = await send({ type: 'UQA_COVERAGE_STOP' });
      btn.setAttribute('aria-pressed', 'false');
      if (!res.ok) return say(res.error, 'err');
      const own = res.result.own;
      /*
       * E15. "Not really working" was, on the pages it was tried on, this
       * branch: a measurement of nothing, reported as a success with a blank
       * number. It happens for a real reason and the reason is knowable, so it
       * is stated instead of shrugged at.
       */
      if (own.statementCoverage == null) {
        lastCoverage = {
          can: false,
          // The English stays beside the key because tools/test-tool-cards.mjs
          // reads this sentence out of the source: it is the one that proves a
          // measurement of nothing is explained rather than reported blank.
          why: tf(
            'popup.coverage.noneOwn',
            'Nothing of this page\u2019s own was measured. Every script that ran came from another origin: a CDN, an analytics tag, a framework bundle served from somewhere else. Coverage only counts scripts served by the site under test, because those are the only ones the team can act on.'
          ),
        };
        paintCoverageReadiness();
        openToolPanel('whitebox');
        say(t('popup.coverage.noneOwnSaid'), 'err');
        return refresh();
      }
      say(
        t('popup.coverage.result', {
          pct: own.statementCoverage,
          covered: own.functions.covered,
          total: own.functions.total,
        }),
        'ok'
      );
      return refresh();
    }

    // The permission is declared up front because Chrome refuses to make
    // `debugger` optional — see background/whitebox.js. Still checked rather
    // than assumed: a manifest can change, and a feature that fails with a
    // stack trace instead of a sentence is a feature nobody reports.
    const has = await send({ type: 'UQA_COVERAGE_PERMISSION' });
    if (!has.result) {
      return say(t('popup.coverage.noPermission'), 'err');
    }
    const res = await send({ type: 'UQA_COVERAGE_START' });
    if (!res.ok) return say(res.error, 'err');
    btn.setAttribute('aria-pressed', 'true');
    return say(t('popup.coverage.measuring'), 'ok');
  },
  shot: async ({ counted }) => {
    const full = readScope('shot', 'shot-scope') === 'full';
    const text = $('note-text')?.value.trim() || '';
    await optimistic(
      () => {
        say(t(full ? 'popup.shot.scrolling' : 'popup.shot.taking'));
      },
      () => send({ type: full ? 'UQA_CAPTURE_FULL' : 'UQA_CAPTURE', text }),
      {
        settle: (res) => {
          // The guess became the truth: the worker has logged the shot, so
          // there is nothing for the `finally` above to put back.
          counted();
          const r = res.result;
          window.UQAVfx?.play('flash');
          uqaSound()?.play(full ? 'capture.full' : 'capture.shot');
          const screens = plural(r.tiles, 'popup.count.screenOne', 'popup.count.screenMany');
          say(
            full
              ? r.hiddenStuck
                ? t(r.hiddenStuck === 1 ? 'popup.shot.fullStuckOne' : 'popup.shot.fullStuckMany', {
                  screens,
                  n: r.hiddenStuck,
                })
                : t('popup.shot.fullDone', { screens })
              // The English stays beside the key: a suite waits for this exact
              // sentence on #status after the settle.
              : tf('popup.shot.saved', 'Saved into the session.'),
            'ok',
            { silent: true }
          );
          refresh();
        },
      }
    );
  },
  pick: async () => {
    const ok = await toolResult(await send({ type: 'UQA_PICK', tabId: ctx.tabId }), t('popup.pick.on')); // the press line ("Starting…") is replaced the moment the picker is on; it fades, so a cancel leaves nothing stale
    if (ok) { pickFrom = lastLocator || ''; dismiss(); } // get out of the way so the tester can hover
  },
  fineprint: async () => {
    await optimistic(
      () => { say(t('popup.fineprint.reading')); },
      () => send({ type: 'UQA_FINE_PRINT', tabId: ctx.tabId }),
      {
        settle: (res) => {
          const c = res.result?.counts || {};
          say(
            // The unmeasured rows are said out loud. A check the browser could
            // not reach was counted as neither a pass nor a gap and named
            // nowhere, so a page it could answer almost nothing about produced
            // the same headline as a clean one.
            t('popup.fineprint.counts', {
              checks: plural(c.total ?? 0, 'popup.count.checkOne', 'popup.count.checkMany'),
              gaps: plural(c.gaps ?? 0, 'popup.count.gapOne', 'popup.count.gapMany'),
            })
            + (res.result?.stored ? t('popup.fineprint.stored') : t('popup.fineprint.notStored')),
            (c.gaps ?? 0) ? 'err' : 'ok',
          );
          refresh();
        },
      },
    );
  },
  spec: async () => {
    const format = readScope('spec', 'spec-format') || 'markdown';
    await optimistic(
      () => { say(t('popup.spec.reading')); },
      () => send({ type: 'UQA_READ_SPEC', tabId: ctx.tabId, format }),
      {
        settle: (res) => {
          const r = res.result || {};
          const c = r.counts || {};
          say(
            t('popup.spec.read', {
              forms: plural(c.forms ?? 0, 'popup.count.formOne', 'popup.count.formMany'),
              fields: plural(c.fields ?? 0, 'popup.count.fieldOne', 'popup.count.fieldMany'),
              links: plural(c.links ?? 0, 'popup.count.linkOne', 'popup.count.linkMany'),
            }) + (r.stored ? '' : t('popup.spec.notStored')),
            'ok',
            r.stored ? { fix: openResult() } : {},
          );
          refresh();
        },
      },
    );
  },
  inject: async () => {
    const ok = await toolResult(await send({ type: 'UQA_INJECT', tabId: ctx.tabId }));
    if (ok) {
      /*
       * The only tool that acted without saying so.
       *
       * What it opens is drawn into the *page*, and the panel closes on its way
       * out, so a tester watching the panel saw a button that did nothing. Every
       * other tool writes its line here; this one now does too, and it says
       * where to look — which is the useful half, because the palette waits for
       * a field to be picked before it shows anything.
       */
      say(t('popup.inject.pick'), 'ok');
      dismiss();
    }
  },
  rtl: async () => {
    // Options live in Settings only — one source of truth, and one fewer
    // panel of duplicated checkboxes in a 348px popup.
    const res = await send({
      type: 'UQA_TOGGLE_RTL',
      options: {
        rtl: settings?.rtlMirror ?? true,
        expand: settings?.expandPercent !== 0,
        accent: settings?.rtlAccent ?? false,
        bidi: settings?.rtlBidi ?? false,
      },
    });
    if (await toolResult(res)) {
      const on = res.result?.enabled;
      say(t(on ? 'popup.rtl.on' : 'popup.rtl.off'), 'ok');
      refresh();
    }
  },
  record: async () => {
    const state = await send({ type: 'UQA_RECORD_STATE' });
    if (state.ok && state.result?.recording) {
      // A clip that is still opening its streams cannot be stopped yet, and
      // the button should say so rather than send a message the worker will
      // refuse in different words.
      if (state.result.finishing) {
        say(t('popup.record.finishing'));
        return paintRecording();
      }
      say(t('popup.record.stopping'));
      const out = await send({ type: 'UQA_RECORD_STOP' });
      if (out.ok) uqaSound()?.configure({ suspended: false });
      /*
       * Repaint on failure, not only on success.
       *
       * A bare `return say(error)` left the button reading "Stop recording"
       * over a clip that had in fact ended — or reading "Record" over one
       * that had not — because the only thing that reconciles the label with
       * the worker is this call. The success path had it and the failure path
       * did not, which is the wrong way round: a failure is exactly when the
       * label is most likely to be wrong.
       */
      if (!out.ok) {
        say(out.error, 'err');
        return paintRecording();
      }
      say(t(out.result.webcamCode === 'WEBCAM_NOT_SAVED' ? 'popup.record.savedCamLost' : out.result.webcamProblem ? 'popup.record.savedCamShort' : 'popup.record.saved', { mb: Math.round(out.result.bytes / 1024 / 1024 * 10) / 10 }), 'ok');
      return paintRecording();
    }
    // Filming the screen means Chrome shows its own picker, so the popup
    // will close underneath it — said out loud, because a popup that vanishes
    // reads as a crash.
    const screen = readScope('record', 'rec-scope') === 'screen';
    if (screen) say(t('popup.record.picker'));

    // One read of the panel, not four separate `$('cap-*')` reads that each
    // threw the moment a render did not draw that row. `systemAudio` and
    // `tabAudio` are the same tick under two names, because they are the same
    // choice on two different capture paths.
    const opts = readCaptureOptions();

    /*
     * The microphone is a different kind of capture, and it is said once.
     *
     * (the rest of this note is archived in popup/REFACTOR.md)
     */
    if (opts.mic && !(await micConsentGiven())) {
      const answer = await askMicConsent();
      if (answer === 'cancel') return say('');  // nothing was recorded, so nothing is said
      if (answer === 'mute') {
        opts.mic = false;
        const tick = panelFor('record')?.querySelector('#cap-mic');
        if (tick) tick.checked = false;
      }
      await rememberMicConsent();
    }

    // No popup tap or shutter may land in a clip: silent from here until it stops or fails to start.
    uqaSound()?.configure({ suspended: true });
    const out = await send({
      type: screen ? 'UQA_RECORD_SCREEN' : 'UQA_RECORD_START',
      // Named, not left to the worker to guess. A screen recording takes no
      // tab on purpose - see startScreenRecording - but a tab recording
      // started from the float must film the page's tab, not the float's.
      ...(screen || ctx.tabId == null ? {} : { tabId: ctx.tabId }),
      mic: opts.mic,
      tabAudio: opts.tabAudio,
      systemAudio: opts.tabAudio,
      webcam: opts.webcam,
      // GROUP G (brief G2). Sent on both paths; the worker ignores it for a
      // screen capture, which already has the real pointer in it.
      cursor: opts.cursor,
      webcamPosition: opts.webcamPosition,
      webcamSize: opts.webcamSize,
    });
    if (!out.ok || out.result?.cancelled) uqaSound()?.configure({ suspended: false });
    if (!out.ok) return say(out.error, 'err');
    // Cancelling the picker is a decision, not a failure.
    if (out.result?.cancelled) return say('');
    // A source the browser refused must be said out loud. Silently recording
    // without the microphone someone ticked is how a narrated walkthrough
    // turns out to be silent, discovered only on playback.
    const refused = out.result?.refused || [];
    say(
      refused.length
        ? t('popup.record.without', { list: refused.map((r) => (r === 'webcam-not-saved' ? t('popup.record.camNotSaved') : r)).join(', ') })
        : t('popup.record.started'),
      refused.length ? 'err' : 'ok'
    );
    return paintRecording();
  },
  api: async () => {
    // Opened on the running session when there is one, so "Import from the
    // session" has something to import the moment the page is up.
    const out = await send({ type: 'UQA_OPEN_API' });
    if (!out?.ok) return say(out?.error || t('popup.api.notOpened'), 'err');
    return say(t(out.result?.sessionId ? 'popup.api.openingOn' : 'popup.api.opening'), 'ok');
  },
  diagram: async () => {
    const state = await send({ type: 'UQA_GET_STATE' });
    const id = state.ok ? state.result?.session?.id || state.result?.sessionId : null;
    const last = id || (await new Promise((r) => chrome.storage.session.get('lastSessionId', (v) => r(v.lastSessionId))));
    if (!last) return say(t('popup.diagram.noSession'), 'err');
    chrome.tabs.create({ url: chrome.runtime.getURL(`diagram/diagram.html?session=${encodeURIComponent(last)}`) });
    return say(t('popup.diagram.opening'), 'ok');
  },
  harvest: async () => {
    say(t('popup.harvest.reading'));
    const res = await send({ type: 'UQA_HARVEST' });
    if (!(await toolResult(res))) return;
    const r = res.result;
    const c = r.counts;
    say(
      t(r.truncated ? 'popup.harvest.countsCapped' : 'popup.harvest.counts', {
        elements: plural(c.elements, 'popup.count.elementOne', 'popup.count.elementMany'),
        unique: c.unique,
        forms: plural(r.forms, 'popup.count.formOne', 'popup.count.formMany'),
      }) + (r.stored ? '' : t('popup.harvest.notStored')),
      'ok',
      { sound: 'harvest.done', ...(r.stored ? { fix: openResult() } : {}) }
    );
    return refresh();
  },
  autofill: async () => {
    say(t('popup.autofill.filling'));
    const res = await send({ type: 'UQA_AUTOFILL' });
    if (!(await toolResult(res))) return;
    const r = res.result;
    const bad = r.invalid.length;
    /*
     * E9. The result is kept and drawn on the card, and the card opens itself.
     *
     * The status line clears after four seconds by design, which is right for
     * "saved into the session" and wrong for a list of the five fields the
     * page refused. Those are the tester's next five minutes of work, so they
     * go somewhere that stays.
     */
    lastAutofill = r;
    paintAutofill();
    openToolPanel('autofill');
    say(
      r.filled.length
        ? t('popup.autofill.filled', {
          filled: plural(r.filled.length, 'popup.count.fieldOne', 'popup.count.fieldMany'),
        }) +
          (bad ? t('popup.autofill.rejectedCount', { n: bad }) : '') +
          (r.skipped.length ? t('popup.autofill.skippedCount', { n: r.skipped.length }) : '') +
          t('popup.autofill.tail')
        : t('popup.autofill.none'),
      bad ? 'err' : 'ok',
      { sound: bad ? 'status.warn' : r.filled.length ? 'autofill.done' : 'status.ok' }
    );
    return refresh();
  },
  links: async () => {
    say(t('popup.links.asking'));
    return showLinks(await send({ type: 'UQA_CHECK_LINKS' }));
  },
  perf: async ({ counted }) => {
    await optimistic(
      () => {
        say(t('popup.perf.measuring'));
      },
      () => send({ type: 'UQA_SCAN_PERF' }),
      {
        settle: (res) => {
          counted();
          const m = res.result.metrics;
          const r = res.result.ratings;
          const poor = Object.entries(r).filter(([, v]) => v === 'poor').map(([k]) => k.toUpperCase());
          // A poor rating is a finding, not a failure — the tool ran, so the
          // tick stays even though the tone is `err`. This is exactly why the
          // used-mark is settled on the reply and never on `lastTone`.
          // A metric that was not measured says so. "LCP —ms" is a sentence
          // with a hole in it; on a projector the dash reads as a broken tool.
          const ms = (v) => (v == null ? t('popup.perf.notMeasured') : t('popup.perf.ms', { v }));
          say(
            poor.length
              ? t('popup.perf.poor', { lcp: ms(m.lcp), cls: m.cls, list: poor.join(', ') })
              : t('popup.perf.clean', { lcp: ms(m.lcp), cls: m.cls, ttfb: ms(m.ttfb) }),
            poor.length ? 'err' : 'ok'
          );
        },
      }
    );
  },
  a11y: async ({ counted }) => {
    await optimistic(
      () => {
        say(t('popup.a11y.scanning'));
      },
      () => send({ type: 'UQA_SCAN_A11Y' }),
      {
        settle: (res) => {
          counted();
          // Read, not recomputed. The worker counts it once; a second count
          // here is a second thing to drift.
          const rules = res.result.rules ?? res.result.violations.length;
          const total = res.result.violations.reduce((n, v) => n + v.count, 0);
          // Two different findings, so two different sounds. "Found
          // something" and "found nothing" being the same noise is how an
          // audio channel stops carrying any information at all.
          window.UQASound?.play(rules ? 'scan.found' : 'scan.clean');
          /*
           * E14. The findings, on the card, instead of a signpost to another
           * page. "Open the timeline for detail" was the whole answer, and the
           * timeline is a different tab: five rules and thirty-one elements
           * were a number and a journey.
           */
          lastA11y = res.result;
          paintA11y();
          if (rules) openToolPanel('a11y');
          // A violation found is the tool working, so the tick stays and only
          // the tone changes.
          say(
            rules
              ? t('popup.a11y.found', {
                rules: plural(rules, 'popup.count.ruleOne', 'popup.count.ruleMany'),
                elements: plural(total, 'popup.count.elementOne', 'popup.count.elementMany'),
              })
              : t('popup.a11y.clean', { frames: framesRead(res.result) }),
            rules ? 'err' : 'ok'
          );
        },
      }
    );
  },
};

/**
 * The presses that do not need a real web page under them: two open a panel,
 * which is worth reading even on a `chrome://` tab where the tool could never
 * run, and two act on the extension rather than on the page.
 */
const ANY_PAGE = new Set(['partitions', 'viewport', 'mask', 'break-toggle']);

/**
 * A refusal the browser made, in the words the worker sends back.
 *
 * Matched on the message rather than on an error code because the refusals
 * arrive from four places (the worker, the offscreen document, `chrome.*` and
 * the content script) and none of them shares a code. A miss here costs a red
 * dot where an amber one belonged, which is the safe direction to be wrong in.
 */
const REFUSAL = /permission|grant|activeTab|invoked|refus|denied|not allowed|allow (the|access)|blocked by|إذن|امنح|غير مسموح|رُفض|محظور/i;

/**
 * What the press says before the worker has been asked anything.
 *
 * (the rest of this note is archived in popup/REFACTOR.md)
 */
const PRESS_SAYS = {
  shot: () => tf('popup.press.shot', 'Taking a screenshot…'),
  record: () => tf('popup.press.record', 'Working on the recording…'),
  viewport: () => tf('popup.press.viewport', 'Opening the sizes…'),
  mask: () => tf('popup.press.mask', 'Starting the masking crosshair…'),
  a11y: () => tf('popup.press.a11y', 'Scanning for accessibility problems…'),
  perf: () => tf('popup.press.perf', 'Measuring the page…'),
  links: () => tf('popup.press.links', 'Asking every link…'),
  coverage: () => tf('popup.press.coverage', 'Talking to the debugger…'),
  fineprint: () => tf('popup.press.fineprint', 'Reading the fine print…'),
  partitions: () => tf('popup.press.partitions', 'Reading the field…'),
  inject: () => tf('popup.press.inject', 'Getting the awkward values ready…'),
  autofill: () => tf('popup.press.autofill', 'Filling the form…'),
  harvest: () => tf('popup.press.harvest', 'Reading the page…'),
  pick: () => tf('popup.press.pick', 'Starting the locator crosshair…'),
  diagram: () => tf('popup.press.diagram', 'Opening the diagram…'),
  spec: () => tf('popup.press.spec', 'Reading the page as a specification…'),
  api: () => tf('popup.press.api', 'Opening the request panel…'),
  'break-toggle': () => tf('popup.press.breakToggle', 'Opening the rules…'),
  rtl: () => tf('popup.press.rtl', 'Flipping the layout…'),
};

document.addEventListener('click', async (event) => {
  const btn = event.target.closest?.('[data-action]');
  if (!btn || btn.disabled) return;
  if (!awake) return wakeOnPress(btn); // 1011 B1: a tool pressed asleep wakes this site in this gesture, then runs (popup/onboard.js)
  // The card's health mark, driven around whatever the handler does. Wrapping
  // here rather than in each handler is deliberate: there are sixteen of them,
  // and the one that would be forgotten is the one being complained about.
  const health = btn.closest('.tool-row')?.querySelector('.tool-health');
  const restingHealth = health?.dataset.health;
  if (health && restingHealth !== 'blocked') health.dataset.health = 'running';

  /*
   * The card's used-mark, moved here for the same reason and one step earlier.
   *
   * (the rest of this note is archived in popup/REFACTOR.md)
   */
  const counts = OPTIMISTIC_COUNT[btn.dataset.action] || null;
  const usedMark = counts
    ? document.querySelector(`.tool-row[data-tool="${counts}"] .tool-state`)
    : null;
  let undoUse = counts ? bumpUsed(counts) : null;
  usedMark?.classList.add(PENDING);

  /*
   * One press at a time, per button.
   *
   * (the rest of this note is archived in popup/REFACTOR.md)
   */
  if (btn.dataset.busy === 'true') return;
  btn.dataset.busy = 'true';
  lastTone = '';
  lastSaid = '';

  /*
   * The first thing the tester sees, and it happens in this turn.
   *
   * Before `resolveCtx()`, before any handler, before anything that can yield.
   * A press with no visible answer is the one failure mode a tester cannot
   * tell apart from a broken tool, and it is what a cold service worker used
   * to produce for a second and a half.
   */
  const pressWord = PRESS_SAYS[btn.dataset.action]?.();
  if (pressWord) say(pressWord);

  const liveHolders = [btn.querySelector('.tool-icon'), document.querySelector(`.fav-item[data-fav="${btn.closest('.tool-row')?.dataset.tool}"] .fav-run`)]; // f1022: the icon turns while the tool runs (ui/live.js)
  liveHolders.forEach((h) => window.UQALive?.start(h));
  try {
    // The one place a tool press learns where it is acting. Everything below
    // reads `ctx`, so a branch added later cannot quietly derive it again and
    // disagree.
    const tab = await resolveCtx();
    const action = btn.dataset.action;

    const run = ACTIONS[action];
    if (!run) return;
    // The one check the lookup cannot express: most tools need a real web page
    // under them, and the four in `ANY_PAGE` do not.
    if (!ANY_PAGE.has(action) && !isTestable(tab)) return say(needsPage(), 'err');
    window.toolPressing = (window.toolPressing || 0) + 1; // say() keeps and scrolls to the outcome of a tool press
    try { await run({ btn, tab, counted: () => { undoUse = null; } }); } finally { window.toolPressing--; }
  } finally {
    delete btn.dataset.busy;
    liveHolders.forEach((h) => window.UQALive?.end(h, lastTone === 'ok' ? true : lastTone === 'err' ? false : undefined)); // f1022: check on success, cross on failure or refusal, put back when it only opened something
    // The used-mark settles here, not on the tone: a performance scan that
    // finds a poor rating speaks in the `err` tone and the tool still ran, so
    // the tick has to survive it. Only a branch that heard the worker count it
    // calls `counted()`.
    usedMark?.classList.remove(PENDING);
    undoUse?.();
    // Whatever the handler did — acted, refused, or opened a panel — the mark
    // settles on what actually happened, then fades back to resting so the
    // card does not carry a stale verdict into the next press.
    if (health && restingHealth !== 'blocked') {
      /*
       * A refusal and a failure are different things, and only one of them is
       * the product's fault.
       *
       * "Chrome only lets an extension record a tab it was just invoked on" is
       * the browser holding its ground: the tester can fix it in one keystroke,
       * and nothing is broken. That earns amber, once, after a press — which is
       * the only moment anybody learns it. A tool that genuinely threw still
       * goes red.
       */
      const refused = lastTone === 'err' && REFUSAL.test(lastSaid);
      const settled = refused ? 'warned' : lastTone === 'err' ? 'failed' : lastTone === 'ok' ? 'ok' : restingHealth;
      health.dataset.health = settled;
      if (settled !== restingHealth) {
        setTimeout(() => { if (health.dataset.health === settled) health.dataset.health = restingHealth; }, TIMING.healthSettles);
      }
    }
  }
});

/* ------------------------------------------------- black-box design panel */

/**
 * Show a field's partitions and boundaries.
 *
 * The layout is the argument: valid classes and invalid classes are separated,
 * because the technique treats them differently — several valid partitions may
 * be covered by one test, while invalid ones must each be tested alone or the
 * first rejection masks the rest. A single mixed list loses that entirely.
 */
async function readPartitions() {
  say(t('popup.press.partitions'));
  // Named, like every other page-scoped tool. Left to guess, the worker takes
  // the last focused window — wrong the moment "Check another size" has
  // opened one, and "Pick a field first" was the answer that came back.
  await resolveCtx();
  const res = await send({ type: 'UQA_PARTITIONS', tabId: ctx.tabId });
  if (!res.ok) {
    /*
     * E7. "Pick a field first" used to be the end of the conversation.
     *
     * The content script now puts a crosshair on the page in the same breath
     * as it answers that it has nothing to read, exactly as the mask and the
     * locator do, so what is left for the popup is to say where to look and
     * get out of the way. The worker's sentence is matched rather than
     * replaced wholesale, because every other failure it can return still has
     * to arrive in its own words.
     */
    if (/pick a field/i.test(res.error || '')) {
      say(t('popup.partitions.clickField'), 'ok');
      return dismiss();
    }
    return say(res.error, 'err');
  }

  lastPartitions = res.result;
  paintPartitions();
  void noteDesignedOnOpen();
  const f = res.result?.field || {};
  say(
    t('popup.partitions.read', {
      field: f.label || f.name || t('popup.partitions.theField'),
      classes: plural(res.result.partitions.length, 'popup.count.classOne', 'popup.count.classMany'),
      boundaries: plural(res.result.boundaries.length, 'popup.count.boundaryOne', 'popup.count.boundaryMany'),
    }),
    'ok',
  );
}

/* A popup the permission bubble closed finds its pending Allow once it is ready (resumeLinks above). */
{
  const go = () => resumeLinks().catch(() => {});
  if (document.body.dataset.ready === 'true') go();
  else new MutationObserver((_, o) => { if (document.body.dataset.ready === 'true') { o.disconnect(); go(); } }).observe(document.body, { attributes: true, attributeFilter: ['data-ready'] });
}
