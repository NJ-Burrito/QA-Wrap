/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * DOM action recorder.
 *
 * Captures the interaction stream that becomes both the repro steps and the
 * generated Playwright spec. Every captured action carries a *verified* locator,
 * so the exported spec is runnable rather than aspirational.
 */
(() => {
  if (window.__UQA_RECORDER__) return;
  window.__UQA_RECORDER__ = true;

  const B = window.UQABridge;
  const S = window.UQASelector;

  /**
   * The frameLocator chain this frame sits behind, when it cannot see it.
   *
   * ── the fault this closes ───────────────────────────────────────────────
   *
   * A recorded click carried `desc.framePrefix`, which is whatever the selector
   * engine could work out from inside this document. Across an origin boundary
   * that is nothing: `window.frameElement` throws there, so the engine returns
   * an empty prefix and a warning that the chain is incomplete. Every click a
   * tester made inside a claude.ai artifact, a payment widget, an embedded
   * ministry portal or a CMS preview was therefore filed with a locator that
   * addresses the top document and cannot find the element it names. The
   * generated Playwright spec does not run; the repro step points at the wrong
   * page; nothing in the report says so.
   *
   * The picker had already solved it (`content/picker.js:41-66`): the service
   * worker can read the frame tree that no frame can see, and answers
   * `UQA_FRAME_CHAIN` with the whole walk from here to frame 0.
   *
   * ── once per frame, at arm time ─────────────────────────────────────────
   *
   * Not per click: a round trip to a worker that may be asleep, in the capture
   * phase of a click, is a freeze the tester feels, and it is the exact cost
   * the locator work was moved off the click to avoid. Not at document_start
   * either: there is nothing to record before recording starts, and a frame's
   * place in the tree does not change while a document lives in it. So it is
   * resolved the moment recording turns on, and cached.
   */
  let chain = null;

  const DESCRIBE_BUDGET_MS = 40; // r7-05-3
  /** What describe() should be told about this frame's ancestry, if anything. */
  const describeOpts = (timed) => (chain || timed ? { ...(chain ? { frame: chain } : null), ...(timed ? { budgetMs: DESCRIBE_BUDGET_MS } : null) } : undefined);

  async function resolveChain() {
    if (chain || window.top === window) return;
    // Same-origin ancestors are walkable from here and always were. Only the
    // frame that cannot see its own boundary needs the worker.
    if (!S?.framePrefix || !S.framePrefix().crossOrigin) return;
    const res = await B?.send({ type: 'UQA_FRAME_CHAIN' });
    const built = res?.ok ? res.result : null;
    // Whole or not at all. Half a chain is a locator that looks right and opens
    // the wrong document, and the engine's own "the chain is incomplete"
    // warning is more use to a tester than that.
    if (built?.complete && built.prefix) {
      chain = { prefix: built.prefix, crossOrigin: false, depth: built.depth };
    }
  }

  // Armed, not polled: the bridge fires this when the worker tells it that a
  // session has started, which is the same delivery Start already awaits.
  window.addEventListener('uqa:recording', (e) => {
    if (e.detail) resolveChain();
  });
  if (B?.isRecording()) resolveChain();

  /** Values that must never reach a bug report. */
  const SECRET_TYPES = new Set(['password']);
  /* privacy-names:begin (generated from core/privacy-names.json; do not edit) */
const SECRET_NAMES = new Set(["pass","password","passwd","pwd","passcode","passphrase","secret","token","auth","authorization","bearer","session","sessionid","phpsessid","jsessionid","aspsessionid","cookie","apikey","otp","pin","credit","creditcard","card","cardnumber","cvv","cvc","ssn","iban","jwt","csrf","xsrf","sid","privatekey","accesskey","subscriptionkey","functionskey","secretkey","signingkey","licensekey","dpop","nationalid","كلمةالمرور","رقمسري"]);
const isSecretName = (name) => { const t = String(name).replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z\d\u0600-\u06ff]+/).filter(Boolean); return t.some((w, i) => SECRET_NAMES.has(w) || (i > 0 && SECRET_NAMES.has(t[i - 1] + w))); };
/* privacy-names:end */

  /**
   * The tester's own extra pattern, compiled once and re-compiled only when the
   * setting changes. A broken pattern must never throw here: failing open would
   * mean capturing a value the tester asked us to mask.
   */
  let extraSource = null;
  let extraRe = null;
  // D-1010-83 (r4-03-3): a pattern that does not compile fails CLOSED: every text input is masked until the setting changes.
  let extraBroken = false;

  function extraPattern() {
    const source = window.UQASettings?.maskExtraPattern || '';
    if (source === extraSource) return extraRe;
    extraSource = source;
    extraBroken = false;
    try {
      extraRe = source ? new RegExp(source, 'i') : null;
    } catch {
      extraRe = null;
      extraBroken = true;
      console.warn('QA Wrap: the extra mask pattern does not compile; every text input is masked.');
    }
    return extraRe;
  }

  // D-197: per-phase user-timing marks (selector, sanitise, privacy, send) for the perf row. Off unless a harness sets window.__qawRecMarks, so a long session keeps no entries.
  const now = () => (window.__qawRecMarks ? performance.now() : -1);
  const mark = (phase, t0) => { if (t0 >= 0) { try { performance.measure(`qaw:rec:${phase}`, { start: t0, end: performance.now() }); } catch { /* no timeline */ } } };

  function isSecret(el) {
    if (!el) return false;
    // What the tester masked by hand outranks every heuristic below. They
    // looked at the screen and said "not this", which is better evidence than
    // any pattern match on a field name.
    if (window.UQAMask?.isMasked?.(el)) return true;
    if (SECRET_TYPES.has((el.type || '').toLowerCase())) return true;
    if (el.autocomplete && /password|cc-|one-time/.test(el.autocomplete)) return true;

    let label = '';
    try {
      label = window.UQASelector?.accessibleName(el) || '';
    } catch {
      /* the selector engine must never break masking */
    }
    const haystack = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${label}`;

    if (isSecretName(haystack)) return true;
    const extra = extraPattern();
    if (extraBroken && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && /^(|text|search|tel|url|email|number|date|datetime-local|month|time|week)$/.test((el.type || '').toLowerCase())))) return true;
    return extra ? extra.test(haystack) : false;
  }

  // D-1010-87: a field that took a paste holds text nobody typed, so every later value of it is masked too.
  const pasted = new WeakSet();
  const isMasked = (el) => { const t0 = now(); const r = isSecret(el) || pasted.has(el); mark('privacy', t0); return r; };

  function maskValue(el, raw) {
    if (isMasked(el)) return '••••••••';
    const v = String(raw ?? '');
    return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  }

  function label(el, desc) {
    return desc?.name || desc?.role || el.tagName.toLowerCase();
  }

  /**
   * Recording must never sit between the click and the app's response.
   *
   * This listens in the CAPTURE phase, so anything it does synchronously runs
   * *before* the page's own handler. Computing a verified locator costs ~18ms
   * on a desktop and ~180ms on a low-end laptop. It used to be computed after
   * the page had its turn, which lost the locator of any control that removed
   * or renamed itself in its own handler (council-1009 r3-05-2), so the locator
   * is now snapshotted here and only the emit to the worker is deferred.
   */
  /**
   * The element the user really acted on. A document-level listener sees an
   * open shadow root's host as `e.target` (event retargeting); `composedPath()[0]`
   * is the node inside. Falls back to `e.target` when the path is missing.
   */
  function originOf(e) {
    let first = null;
    try {
      first = e.composedPath?.()[0] || null;
    } catch {
      /* a hostile page can break composedPath; the target is still right */
    }
    return first && first.nodeType === 1 ? first : e.target;
  }

  function record(el, payload, sync = false, bumped = false, gate = null) {
    // The master switch, checked at the one place every recorded action passes
    // through. A recorder that keeps recording while the extension is supposed
    // to be asleep is the failure that switch exists to prevent.
    if (window.UQAAwake === false) return;
    if (!(B?.isRecording() || B?.buffering?.()) || !el || el.nodeType !== 1) return; // buffering: the 2-minute buffer wants the same actions

    // Cheap, synchronous, and enough to be useful on its own.
    const base = {
      kind: 'dom',
      ...payload,
      tag: el.tagName.toLowerCase(),
      // A settled input keeps the time of its last keystroke: the request it
      // caused fired then, not when the debounce ran out.
      ts: Number.isFinite(payload.ts) ? payload.ts : Date.now(),
    };

    // Advance the act epoch NOW, in the capture phase, before the page's own
    // handler runs: an error thrown synchronously by that handler belongs to
    // this action, not to the previous one.
    // r3-05-1: a typing burst already began its act at the first keystroke (`bumped`).
    if (!bumped) B.beginAct?.();

    // Snapshot the locator NOW, in the capture phase, before the page's own
    // handler can remove the element or change its text (council-1009 r3-05-2):
    // a Close/Delete button that removes itself, or one that flips from "Add" to
    // "Remove", must be recorded as the control the tester actually pressed.
    // Only the emit is deferred, so the page still gets its turn before the
    // message goes to the worker.
    let desc = null;
    const tSel = now();
    try {
      desc = S.describe(el, describeOpts(true)); // r7-05-3: the capture phase has a time budget
    } catch {
      /* the selector engine must never break the page under test */
    }
    mark('selector', tSel);
    const finish = () => { if (gate && !gate()) return; emitRecord(el, base, desc); }; // r7-05-4: gate runs after the page had its turn

    // `sync` is for a page that is going away (pagehide) or a recording that is
    // being switched off: a timer would never run, or run after the flag flipped.
    if (sync) {
      finish();
      return;
    }
    // A macrotask, not a microtask: microtasks still run before the browser
    // hands the event to the page's listeners.
    setTimeout(finish, 0);
  }

  function emitRecord(el, base, desc) {
    const tSan = now();
    const ev = {
      ...base,
      preBumped: true, // r4-05-2: beginAct already advanced the epoch for this one
      label: label(el, desc),
      locator: desc?.locator || null,
      framePrefix: desc?.framePrefix || '',
      selector: desc?.css || null,
      xpath: desc?.xpath || null,
      strategy: desc?.strategy || null,
      locatorMatches: desc?.matches ?? null,
      locatorAmbiguous: desc?.ambiguous ?? null,
      locatorWarnings: desc?.warnings?.length ? desc.warnings : undefined,
    };
    mark('sanitise', tSan);
    const tSend = now();
    B.emit(ev);
    mark('send', tSend);
  }

  /* ------------------------------------------------------------------ listeners */

  // r8-05-3: a role counts only when a person operates it. A dialog, a list or a toolbar is a container: a click on a div inside one is the div's step, not the dialog's.
  const OPERABLE = /^(button|link|menuitem|menuitemcheckbox|menuitemradio|tab|option|checkbox|radio|switch|combobox|textbox|treeitem|slider|spinbutton)$/;
  const CLICKABLE = 'a, button, [role], input, select, textarea, label, [onclick], summary';
  const NATIVE = 'a, button, input, select, textarea, label, [onclick], summary';
  function clickable(t) {
    for (let c = t?.closest?.(CLICKABLE); c; c = c.parentElement?.closest?.(CLICKABLE)) {
      const role = String(c.getAttribute?.('role') || '').trim().toLowerCase().split(/\s+/)[0];
      if (!role || OPERABLE.test(role) || c.matches?.(NATIVE) || c === t) return c;
    }
    return t;
  }

  // r10-05-1: held modifiers in a fixed order, Playwright's names; [] when none.
  const modsOf = (e) => [e.ctrlKey && 'Control', e.shiftKey && 'Shift', e.altKey && 'Alt', e.metaKey && 'Meta'].filter(Boolean);

  // Capture phase, so a page that calls stopPropagation() cannot hide the action.
  document.addEventListener(
    'click',
    (e) => {
      if (window.UQAPicker?.isActive?.()) return;       // r6-11-2a: a pick (assert, basket, mask) is the picker's business, not a step
      record(clickable(originOf(e)), { action: 'click', button: e.button, mods: modsOf(e), trusted: e.isTrusted });
    },
    true
  );

  // D-1010-50: a double-click, a right-click and a middle-click are steps too (drag-and-drop stays a documented non-goal).
  // A contextmenu or auxclick is recorded as a click with its button; the two clicks before a dblclick are folded at read time.
  const clickTarget = (e) => clickable(originOf(e));
  document.addEventListener('dblclick', (e) => record(clickTarget(e), { action: 'dblclick', button: e.button, mods: modsOf(e), trusted: e.isTrusted }), true);
  document.addEventListener('contextmenu', (e) => record(clickTarget(e), { action: 'click', button: 2, trusted: e.isTrusted }, false, false, () => e.defaultPrevented), true); // r7-05-4 (D-1010-154): only the page's own menu is a step
  document.addEventListener('auxclick', (e) => { if (e.button === 1) record(clickTarget(e), { action: 'click', button: 1, trusted: e.isTrusted }); }, true);

  // Debounced per-field: record the settled value, not every keystroke.
  // Each pending entry remembers the time of the last keystroke (`ts`).
  const pendingInput = new WeakMap();
  // The same entries, enumerable: a WeakMap cannot be walked, and pagehide or
  // recording-off must flush every field that is still debouncing (r2-05-3).
  const pendingEls = new Set();
  const isFileField = (el) => !!el && /^input$/i.test(el.tagName) && String(el.type).toLowerCase() === 'file';
  /** The chosen file names only: `value` is a fake C: path with the name last; the page never had that path (council-1009 r3-05-4). */
  function fileNames(el) {
    const named = el.files && el.files.length ? Array.from(el.files, (f) => f?.name) : [String(el.value || '').split(/[\\/]/).pop()];
    return named.filter(Boolean).join(', ').slice(0, 200);
  }
  // r4-05-1: the last value recorded per field, so the `change` that follows a settled input adds nothing.
  const lastRecorded = new WeakMap();
  const isTextField = (el) => !!el && /^(input|textarea)$/i.test(el.tagName);
  // D-1010-174: Playwright refuses fill() on a range or a color input, so those steps say what they are and the spec sets the value instead.
  const typed = (el) => (/^(range|color)$/i.test(el.type) ? { control: String(el.type).toLowerCase() } : {});
  const isEditable = (el) => !!el && !isTextField(el) && el.isContentEditable === true;
  const readValue = (el) => (isTextField(el) ? el.value : el.textContent);

  /** Record the settled value of a field that has a pending debounce; false if none. */
  function flushInput(el, sync = false) {
    const pending = pendingInput.get(el);
    if (!pending) return false;
    clearTimeout(pending.timer);
    pendingInput.delete(el);
    pendingEls.delete(el);
    const raw = readValue(el);
    lastRecorded.set(el, raw);
    record(el, { action: 'input', value: maskValue(el, raw), masked: isMasked(el), ...typed(el), ts: pending.ts, trusted: pending.trusted }, sync, pending.bumped);
    return true;
  }

  /** Flush every debouncing field now, synchronously, in the order they were typed. */
  function flushAllInputs() {
    for (const el of [...pendingEls]) flushInput(el, true);
  }

  // A page that unloads takes its timers with it. Capture phase on window.
  window.addEventListener('pagehide', flushAllInputs, true);
  // The bridge calls this just BEFORE it flips the recording flag off: record()
  // drops everything once recording is off, so the flush has to come first.
  if (B) B.beforeRecordingOff = flushAllInputs;

  document.addEventListener(
    'input',
    (e) => {
      const el = originOf(e);
      if (isFileField(el)) return; // a file is recorded once, on change, by name
      if (!isTextField(el) && !isEditable(el)) return;
      // D-1010-87: a paste is one masked input step. The clipboard is never read, so what was pasted (it may be a credential) is not recorded.
      if (/^insertFromPaste/.test(e.inputType || '')) {
        const typing = pendingInput.get(el); // its value already holds the pasted text, so it is dropped, not flushed
        if (typing) { clearTimeout(typing.timer); pendingInput.delete(el); pendingEls.delete(el); }
        pasted.add(el);
        record(el, { action: 'input', value: '••••••••', masked: true, control: 'paste', trusted: e.isTrusted }, false, !!typing?.bumped);
        lastRecorded.set(el, readValue(el));
        return;
      }
      const prior = pendingInput.get(el);
      if (prior) clearTimeout(prior.timer);
      // r3-05-1: the first keystroke of a burst starts the tester's action (a request fired 100 ms later is caused by it).
      const bumped = prior ? prior.bumped : window.UQAAwake !== false && !!B?.isRecording() && !!B.beginAct?.();
      pendingEls.add(el);
      pendingInput.set(el, {
        ts: Date.now(),
        bumped,
        trusted: e.isTrusted && prior?.trusted !== false,
        timer: setTimeout(() => flushInput(el), Number(window.UQASettings?.inputDebounceMs ?? 400)),
      });
    },
    true
  );

  // D-1010-87: files dropped on the page become one upload step by file name. A file input that receives the drop records its own change.
  document.addEventListener(
    'drop',
    (e) => {
      const el = originOf(e);
      const names = Array.from(e.dataTransfer?.files || [], (f) => f?.name).filter(Boolean);
      if (!el || !names.length || isFileField(el)) return;
      record(el, { action: 'upload', value: names.join(', ').slice(0, 200), control: 'drop', trusted: e.isTrusted });
    },
    true
  );

  // A rich-text editor fires no `change`; leaving it is the only settle signal
  // besides the debounce, so flush it then.
  document.addEventListener(
    'blur',
    (e) => {
      const el = originOf(e);
      if (isEditable(el)) flushInput(el);
    },
    true
  );

  document.addEventListener(
    'change',
    (e) => {
      const el = originOf(e);
      if (!el) return;
      if (isFileField(el)) {
        record(el, { action: 'upload', value: fileNames(el), control: 'file', trusted: e.isTrusted });
        return;
      }
      if (isTextField(el)) {
        const pending = pendingInput.get(el);
        if (pending) {
          clearTimeout(pending.timer);
          pendingInput.delete(el);
          pendingEls.delete(el);
        }
        if (/^(checkbox|radio)$/i.test(el.type)) {
          record(el, { action: 'change', value: el.checked ? 'checked' : 'unchecked', control: String(el.type).toLowerCase(), trusted: e.isTrusted }, false, !!pending?.bumped);
        } else if (lastRecorded.get(el) !== el.value) {
          lastRecorded.set(el, el.value);
          record(el, { action: 'input', value: maskValue(el, el.value), masked: isMasked(el), ...typed(el), ts: pending?.ts, trusted: e.isTrusted && pending?.trusted !== false }, false, !!pending?.bumped);
        }
        return;
      }
      if (/^select$/i.test(el.tagName)) {
        if (el.multiple) {
          // r3-05-7: every selected option, in document order, 20 at most (one per line: an option's text has no newline).
          const picked = Array.from(el.selectedOptions || [], (o) => String(o.text || o.value).replace(/\s+/g, ' ').trim().slice(0, 80)).slice(0, 20);
          record(el, { action: 'change', value: picked.join('\n'), control: 'select-multiple', trusted: e.isTrusted });
        } else record(el, { action: 'change', value: el.options?.[el.selectedIndex]?.text || el.value, control: 'select', trusted: e.isTrusted });
      }
    },
    true
  );

  document.addEventListener(
    'submit',
    (e) => record(originOf(e), { action: 'submit', trusted: e.isTrusted }),
    true
  );

  /* ------------------------------------------------------------ the pointer */

  /**
   * Where the mouse is, for a recording that has been asked to show it.
   *
   * ── why this exists at all ────────────────────────────────────────────────
   *
   * `chrome.tabCapture` does not contain the cursor. It cannot: Chrome
   * composites the pointer at the window level, above everything a tab capture
   * can see, so a walkthrough recorded from a tab shows fields filling
   * themselves and menus opening with nothing on screen to say who is doing it.
   * That is most of what makes a tab recording useless as a demonstration, and
   * "record the whole screen instead" is not an answer when the whole screen is
   * the tester's actual desktop.
   *
   * The only place the position exists is the page, so the page reports it and
   * the offscreen document draws it into the frame it is already compositing.
   *
   * ── the three things that keep this cheap ─────────────────────────────────
   *
   * **It is off unless asked.** `UQASettings.recordCursor` is a tick beside Mic
   * and Webcam, off by default. Nothing below runs otherwise, so an ordinary
   * page pays one property read per pointer move at most.
   *
   * **It is throttled to the frame rate, not the pointer's.** A mouse reports
   * at 120 Hz or better on modern hardware; a recording is 15 fps. 40 ms is
   * comfortably finer than a frame and is a twentieth of the messages.
   *
   * **It carries the viewport with it.** The receiving end has a video of some
   * size and a page of another, and the scale between them changes when the
   * window is resized mid-clip. Sending the page's own dimensions with each
   * position means the mapping is always right and nothing has to be asked.
   *
   * Passive and in the capture phase: this must never sit between a pointer
   * move and the page's own handler, and a page that calls `stopPropagation`
   * must not be able to hide the pointer.
   */
  const CURSOR_MS = 40;
  let cursorAt = 0;
  let cursorDown = false;

  function reportCursor(e) {
    // The master switch first, then the tick, then the clock. Cheapest first.
    if (window.UQAAwake === false) return;
    if (!window.UQASettings?.recordCursor) return;
    const now = Date.now();
    if (now - cursorAt < CURSOR_MS) return;
    cursorAt = now;
    // Straight to the extension, not through `emit`: this is not an event in
    // the session's timeline and must never be stored. It is a position, used
    // for the length of one video frame and then forgotten.
    B?.send({
      type: 'UQA_CURSOR',
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      w: window.innerWidth,
      h: window.innerHeight,
      down: cursorDown,
    });
  }

  document.addEventListener('pointermove', reportCursor, { capture: true, passive: true });
  document.addEventListener(
    'pointerdown',
    (e) => {
      cursorDown = true;
      cursorAt = 0; // a press is worth a frame of its own, whatever the clock says
      reportCursor(e);
    },
    { capture: true, passive: true }
  );
  document.addEventListener(
    'pointerup',
    (e) => {
      cursorDown = false;
      cursorAt = 0;
      reportCursor(e);
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.isComposing || e.keyCode === 229) return;   // r10-05-1: the Enter that commits an IME composition is not a step
      // Only keys that carry intent — plain typing is already covered by 'input'. Tab is noisy and never worth replaying.
      const space = e.key === ' ';
      if (!space && !['Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) return;
      const el = originOf(e);
      // r9-05-3: Space is a step only on a target that has no click of its own (a div role=button); a text field, select or native control already records its own.
      if (space && (!el || isTextField(el) || isEditable(el) || el.closest?.(NATIVE))) return;
      // The typed value must reach the log before the key that follows it: an
      // Enter or an ArrowDown recorded first replays against an empty field.
      if (el) flushInput(el);
      record(el, { action: 'keydown', key: [...modsOf(e), space ? 'Space' : e.key].join('+'), trusted: e.isTrusted }); // r10-05-1: 'Shift+Enter' travels in the key name
    },
    true
  );
})();
