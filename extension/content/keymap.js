/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Customisable in-page shortcuts.
 *
 * Chrome's own command shortcuts (chrome://extensions/shortcuts) are global but
 * an extension may not set them programmatically — only the user can, in that
 * page. So UQA carries a second, fully user-editable keymap that it handles
 * itself while a page has focus. The options page edits it; this listens.
 *
 * Bindings are physical key CODES (`Alt+KeyS`), not `key` values: on an Arabic
 * layout `key` is a different character and every shortcut would silently die.
 */
(() => {
  if (window.__UQA_KEYMAP__) return;
  window.__UQA_KEYMAP__ = true;

  const B = window.UQABridge;
  const t = (key, fallback) => window.UQAUiHost?.t?.(key, fallback) ?? fallback;


  function bindingFromEvent(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    const code = e.code;
    if (!code || /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code)) return null;
    parts.push(code);
    return parts.join('+');
  }

  /** Never steal a keystroke the tester is aiming at the page's own UI. */
  function inTextEntry(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return target.isContentEditable === true;
  }

  /*
   * P1-9: in a text field only an Alt chord may run, and only one that cannot be typed text. Matched on `e.code`, as
   * ever. Ctrl+Alt is AltGr on Windows (types @, €, ł), so it and Meta are out; Option on a Mac types characters, so
   * there a chord needs Shift as well; never in a password field.
   */
  const MAC = typeof navigator === 'object' && /Mac|iPhone|iPad/.test(navigator.platform || '');
  function altChordOk(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.getModifierState?.('AltGraph')) return false;
    if (MAC && !e.shiftKey) return false;
    const target = e.target;
    return !(target?.tagName === 'INPUT' && String(target.type).toLowerCase() === 'password');
  }

  /*
   * Three of these tools are no longer in every page.
   *
   * `picker.js`, `data-injector.js` and `rtl-stress.js` are injected by the
   * worker when they are first used, so a shortcut pressed before that has
   * nothing on the page to call. Asking the worker is the same route the
   * toolbar and the right-click menu take, and it ends in the same place with
   * the script put there first; calling the global when it is already loaded
   * keeps the keystroke instant in the common case.
   */
  const ACTIONS = {
    pick: () => (window.UQAPicker ? window.UQAPicker.start() : B?.send({ type: 'UQA_PICK' })),
    inject: () =>
      window.UQAInjector
        ? window.UQAInjector.triggerFromKeymap()
        : B?.send({ type: 'UQA_INJECT' }),
    rtl: () => (window.UQARtl ? window.UQARtl.toggle() : B?.send({ type: 'UQA_TOGGLE_RTL' })),
    note: () => promptNote(),
    shot: () => B?.send({ type: 'UQA_CAPTURE', text: '' }),
    a11y: () => B?.send({ type: 'UQA_SCAN_A11Y' }),
    // T-060: the bar has no other way in from the keyboard; the bar owns what "focus it" means.
    bar: () => window.UQABar?.focusBar?.(),
  };

  let noteBox = null;

  /** r6-08-3: a name for the box, and the page's focus back where it was when the box goes. */
  function asDialog(box, label, describedBy) {
    if (typeof box?.setAttribute !== 'function') return; // a bare stub in a unit test has no DOM node to name
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', label);
    if (describedBy) box.setAttribute('aria-describedby', describedBy);
    const was = document.activeElement;
    const remove = box.remove.bind(box);
    box.remove = () => {
      remove();
      try { if (was?.isConnected && was !== document.body) was.focus({ preventScroll: true }); } catch { /* the page may have moved on */ }
    };
  }

  function promptNote() {
    // A tiny inline composer beats window.prompt, which blocks the page and is
    // suppressed outright in some embedding contexts.
    //
    // Held by reference: the composer lives in the tool's closed shadow root,
    // where no document selector can find it — and where nothing on the page
    // can read what is being typed into it either.
    if (noteBox?.isConnected) return noteBox.querySelector('input')?.focus();

    const box = window.UQAUiHost.uiLayer('uqa-quicknote');
    noteBox = box;
    asDialog(box, t('overlay.note.dialog', 'Add a note to the session'));
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('overlay.note.placeholder', 'Note to the session… (Enter to save, Esc to cancel)');
    input.setAttribute?.('aria-label', input.placeholder);
    const tags = document.createElement('div');
    tags.className = 'uqa-quicknote-tags';

    let sending = false;
    const send = async (tag, label) => {
      const text = input.value.trim();
      if (!text) return box.remove();
      if (sending) return;
      sending = true;
      const res = await B?.send({ type: 'UQA_NOTE', text, tag: tag || null });
      sending = false;
      // T-014: success only on an acknowledged write. A refusal keeps the box and the words.
      if (!res || res.ok !== true) {
        const why = res?.error || t('overlay.note.noReply', 'the extension did not answer');
        window.UQAUiHost?.flash(t('overlay.note.refused', 'Note not saved: {reason}').replace('{reason}', why), 'err');
        input.focus();
        return;
      }
      window.UQAUiHost?.flash(tag ? t('overlay.note.recordedTag', '{tag} recorded').replace('{tag}', label) : t('overlay.note.recorded', 'Note recorded'));
      box.remove();
    };

    [
      ['bug', t('overlay.note.tag.bug', 'Bug')],
      ['issue', t('overlay.note.tag.issue', 'Issue')],
      ['question', t('overlay.note.tag.question', 'Question')],
      ['', t('overlay.note.tag.note', 'Note')],
    ].forEach(([tag, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => send(tag, label));
      tags.append(b);
    });

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      // Rule 3 (capture before classify): Enter saves a Bug, as in the popup. Shift+Enter saves a plain, untagged Note (the box is one line, so it has no newline to give).
      if (e.key === 'Enter' && !e.isComposing) send(e.shiftKey ? '' : 'bug', e.shiftKey ? t('overlay.note.tag.note', 'Note') : t('overlay.note.tag.bug', 'Bug'));
      if (e.key === 'Escape') box.remove();
    });

    box.append(input, tags);
    input.focus();
  }

  /** Shortcuts do nothing while the extension is asleep. */
  const asleep = () => window.UQAAwake === false;

  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.isTrusted) return; // D-1010-90: a page script can dispatch key events; only the tester's keys count
      if (asleep()) return;
      const settings = window.UQASettings;
      if (!settings || settings.keymapEnabled === false) return;
      if (e.isComposing) return; // P1-9: never mid-IME
      if (inTextEntry(e.target) && !altChordOk(e)) return;

      const binding = bindingFromEvent(e);
      if (!binding) return;

      const entry = Object.entries(settings.keymap || {}).find(([, value]) => value === binding);
      if (!entry) return;

      const run = ACTIONS[entry[0]];
      if (!run) return;

      e.preventDefault();
      e.stopPropagation();
      run();
    },
    true
  );

  window.UQAKeymap = { bindingFromEvent, promptNote };
})();
