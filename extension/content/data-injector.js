/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Context-aware edge-case data injector — feature 5.
 *
 * BugMagnet throws the same generic list at every field. This reads the field
 * first — type, maxlength, pattern, min/max, inputmode, and the *label* in both
 * Arabic and English — infers what the field actually holds, and offers boundary
 * values for THAT field.
 *
 * Two details that make it work where a naive filler fails:
 *
 *  1. PrimeFaces/JSF listens on `change` and `blur`, not on a programmatic value
 *     assignment. Setting `.value` directly bypasses React/Vue setters too. So we
 *     write through the native setter and fire input → change → blur.
 *  2. maxlength silently truncates, which looks like the app rejected the value.
 *     We detect the truncation and say so, instead of leaving a false negative.
 */
(() => {
  // The overlay catalogue subset the worker sends (UQA_OVERLAY_ASSETS); the English literal is the fallback.
  const t = (key, fallback) => window.UQAUiHost?.t?.(key, fallback) ?? fallback;
  if (window.__UQA_INJECTOR__) return;
  window.__UQA_INJECTOR__ = true;

  const B = window.UQABridge;

  /* -------------------------------------------------------- field inference */

  /** Arabic and English cues, checked against label + name + id + placeholder. */
  const SEMANTICS = [
    { kind: 'nationalId', re: /national.?id|رقم.?وطني|الرقم.?الوطني|هوية|nationalNumber/i },
    { kind: 'establishment', re: /establish|منشأة|المنشأة|رقم.?المنشأة/i },
    { kind: 'phone', re: /phone|mobile|tel|هاتف|جوال|خلوي|موبايل/i },
    { kind: 'email', re: /e-?mail|بريد|ايميل|البريد.?الإلكتروني/i },
    { kind: 'iban', re: /iban|bank|حساب.?بنكي|ايبان|رقم.?الحساب/i },
    { kind: 'amount', re: /amount|price|salary|fee|total|مبلغ|سعر|قيمة|رسوم|راتب|إجمالي/i },
    { kind: 'quantity', re: /quantity|count|qty|عدد|كمية|الكمية/i },
    { kind: 'date', re: /date|birth|expiry|تاريخ|الميلاد|انتهاء|إصدار/i },
    { kind: 'name', re: /name|first|last|full|اسم|الاسم|صاحب/i },
    { kind: 'address', re: /address|street|city|عنوان|شارع|مدينة|محافظة|لواء/i },
    { kind: 'licence', re: /licen[cs]e|permit|رخصة|ترخيص|تصريح/i },
    { kind: 'notes', re: /note|comment|description|remark|ملاحظ|وصف|تفاصيل|بيان/i },
  ];

  function labelText(el) {
    const S = window.UQASelector;
    try {
      return S ? S.normText(S.accessibleName(el)) : '';
    } catch {
      return '';
    }
  }

  /**
   * Everything a tester can stand in, not only the two the first version knew.
   *
   * Nader's E7: "support every input type (text, number, date, select, radio,
   * checkbox, file, range, textarea, contenteditable)". The old picker matched
   * `input, textarea` and nothing else, so a select, a radio group, a range and
   * every rich-text editor on earth were invisible to both this tool and the
   * partition designer that reads through it. `[contenteditable]` is matched by
   * both spellings because `contenteditable=""` and `contenteditable="true"`
   * are the same thing to the browser and different things to a selector.
   */
  const PICKABLE =
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]),' +
    'textarea, select, [contenteditable=""], [contenteditable="true"]';

  /** The types whose value is a choice rather than something typed. */
  const CHOICE = new Set(['select-one', 'select-multiple', 'radio', 'checkbox']);

  /**
   * What a field declares about itself.
   *
   * `tag`, `options`, `checked`, `accept`, `step` and `contentEditable` are the
   * additions. They are the difference between "this is a text box with no
   * maxlength" and "this is a select with four options, and the interesting
   * test is a fifth value that is not one of them" — which is the whole
   * question equivalence partitioning is asked to answer.
   */
  function inspect(el) {
    const tag = el.tagName.toLowerCase();
    const editable = tag !== 'input' && tag !== 'textarea' && tag !== 'select' && el.isContentEditable;
    const type = editable ? 'contenteditable' : (el.type || (tag === 'textarea' ? 'textarea' : 'text')).toLowerCase();
    const maxlength = Number(el.getAttribute('maxlength')) || null;
    const minlength = Number(el.getAttribute('minlength')) || null;
    const pattern = el.getAttribute('pattern');
    const min = el.getAttribute('min');
    const max = el.getAttribute('max');
    const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
    const label = labelText(el);
    const haystack = `${label} ${el.name || ''} ${el.id || ''} ${el.getAttribute('placeholder') || ''}`;

    let kind = null;
    if (type === 'email') kind = 'email';
    else if (type === 'tel') kind = 'phone';
    else if (type === 'number' || type === 'range') kind = 'amount';
    else if (type === 'date' || type === 'datetime-local' || type === 'month' || type === 'week') kind = 'date';
    else if (CHOICE.has(type)) kind = 'choice';
    else if (type === 'file') kind = 'file';
    if (!kind) kind = SEMANTICS.find((s) => s.re.test(haystack))?.kind || null;
    if (!kind) kind = tag === 'textarea' || editable ? 'notes' : 'text';

    /*
     * A radio is never one control.
     *
     * The tester points at one button and means the group, so the group is
     * what is read: its options are the partitions, and "none of them" is the
     * boundary that finds the missing `required` every time.
     */
    const group =
      type === 'radio' && el.name
        ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)]
        : null;

    const options =
      tag === 'select'
        ? [...el.options].map((o) => ({ value: o.value, label: (o.textContent || '').trim(), selected: o.selected }))
        : group
          ? group.map((r) => ({ value: r.value, label: labelText(r) || r.value, selected: r.checked }))
          : null;

    return {
      tag,
      type,
      maxlength,
      minlength,
      pattern,
      min,
      max,
      required,
      label,
      kind,
      options,
      multiple: el.multiple === true,
      checked: type === 'checkbox' || type === 'radio' ? !!el.checked : null,
      accept: type === 'file' ? el.getAttribute('accept') : null,
      step: el.getAttribute('step'),
      contentEditable: !!editable,
    };
  }

  /* ------------------------------------------------------ value construction */

  const AR_NAME = 'محمد عبد الرحمن الزغلول';
  const AR_LONG = 'أ'.repeat(300);
  const TATWEEL = 'محـــمـــد';           // tatweel — must normalise to محمد
  const BIDI_MIX = 'محمد Smith 123';       // mixed-direction, the classic RTL trap
  const ZALGO = 'اَ' + 'َّ'.repeat(20);

  function boundaryValues(f) {
    const out = [];
    const add = (group, label, value, note) => out.push({ group, label, value, note });

    /*
     * A field whose value is a choice, a file or a slider gets its own list.
     *
     * The universal list below is a text list: "5000 chars", "leading spaces",
     * "single space". Offered for a `<select>` it is noise, and offering noise
     * is how a tester learns to stop opening the palette. Each of these returns
     * early with the values that are actually on the edge of *that* control.
     */
    if (f.type === 'checkbox') {
      add('Choice', 'Ticked', 'true', f.required ? 'a required checkbox must refuse to submit unticked' : undefined);
      add('Choice', 'Unticked', '', 'the state most forms forget to validate');
      return out;
    }

    if (f.type === 'radio' || f.type === 'select-one' || f.type === 'select-multiple') {
      const options = f.options || [];
      if (options.length) {
        add('Choice', `First: ${options[0].label || options[0].value}`, options[0].value);
        if (options.length > 2) {
          const mid = options[Math.floor(options.length / 2)];
          add('Choice', `Middle: ${mid.label || mid.value}`, mid.value);
        }
        const last = options[options.length - 1];
        if (options.length > 1) add('Choice', `Last: ${last.label || last.value}`, last.value);
      }
      add('Choice', 'Nothing chosen', '', f.required ? 'required: this must be refused' : 'the state a fresh form starts in');
      add(
        'Choice',
        'A value that is not on the list',
        '__qa_wrap_not_an_option__',
        'the server has to reject it: the browser will not stop a scripted post'
      );
      add('Choice', 'The first option, chosen twice', options[0]?.value ?? '', 'idempotence: re-choosing must not toggle');
      return out;
    }

    if (f.type === 'file') {
      add('File', 'Nothing attached', '', f.required ? 'required: submitting empty must be refused' : undefined);
      add(
        'File',
        'What this field says it takes',
        f.accept || 'anything',
        'a browser cannot be scripted into attaching a file: choose one by hand and check the rejection wording'
      );
      return out;
    }

    if (f.type === 'range') {
      const lo = Number(f.min ?? 0);
      const hi = Number(f.max ?? 100);
      const step = Number(f.step ?? 1) || 1;
      add('Slider', `Minimum (${lo})`, String(lo));
      add('Slider', `Maximum (${hi})`, String(hi));
      add('Slider', 'Below the minimum', String(lo - step), 'the browser clamps it: check what the server stores');
      add('Slider', 'Above the maximum', String(hi + step), 'clamped in the same way, and just as untested');
      if (step !== 1) add('Slider', 'Off the step grid', String(lo + step / 2), `step is ${step}`);
      return out;
    }

    /* --- universal boundaries --- */
    add('Boundary', 'Empty', '', f.required ? 'required field: should be rejected' : undefined);
    add('Boundary', 'Single space', ' ', 'often passes a naive "not empty" check');
    add('Boundary', 'Leading/trailing spaces', '  value  ', 'should be trimmed');

    if (f.maxlength) {
      add('Boundary', `Exactly max (${f.maxlength})`, 'a'.repeat(f.maxlength));
      add('Boundary', `Max + 1 (${f.maxlength + 1})`, 'a'.repeat(f.maxlength + 1), 'browser will truncate: check the server too');
    } else {
      add('Boundary', '256 chars', 'a'.repeat(256));
      add('Boundary', '5000 chars', 'a'.repeat(5000), 'column overflow / 500 hunting');
    }
    if (f.minlength) add('Boundary', `Min - 1 (${f.minlength - 1})`, 'a'.repeat(Math.max(0, f.minlength - 1)));

    /* --- numeric --- */
    if (f.kind === 'amount' || f.kind === 'quantity' || f.type === 'number') {
      add('Numeric', 'Zero', '0');
      add('Numeric', 'Negative', '-1', 'should be rejected for amounts and counts');
      add('Numeric', 'Decimal', '1.5', f.kind === 'quantity' ? 'a count should reject this' : undefined);
      add('Numeric', 'Very large', '999999999999');
      add('Numeric', 'Scientific notation', '1e10');
      add('Numeric', 'Arabic-Indic digits', '١٢٣٤٥', 'must be accepted or clearly rejected');
      add('Numeric', 'Thousands separator', '1,000');
      if (f.min != null) add('Numeric', `Below min (${f.min})`, String(Number(f.min) - 1));
      if (f.max != null) add('Numeric', `Above max (${f.max})`, String(Number(f.max) + 1));
    }

    /* --- locale / RTL: the part nothing else offers --- */
    add('Arabic & RTL', 'Arabic name', AR_NAME);
    add('Arabic & RTL', 'Tatweel', TATWEEL, 'should normalise to محمد when searched');
    add('Arabic & RTL', 'Mixed LTR/RTL', BIDI_MIX, 'watch the cursor and the rendered order');
    add('Arabic & RTL', 'Arabic diacritics', ZALGO, 'stacking marks: check row height');
    add('Arabic & RTL', 'Long Arabic (300)', AR_LONG, 'text expansion in an RTL column');
    add('Arabic & RTL', 'RTL override char', '‮txet desrever', 'BiDi override: must be neutralised on display');
    add('Arabic & RTL', 'Emoji', '🌾🐄✅', '4-byte UTF-8: a latin1 column will 500'); // glyph-ok: test payload typed into the page under test

    /* --- kind-specific --- */
    switch (f.kind) {
      case 'nationalId':
        add('Jordan', 'Valid national ID', '9881234567');
        add('Jordan', 'Too short (9)', '988123456');
        add('Jordan', 'Too long (11)', '98812345678');
        add('Jordan', 'Letters', '98812ABCDE');
        add('Jordan', 'All zeros', '0000000000');
        break;
      case 'establishment':
        add('Jordan', 'Valid establishment no.', '200012345');
        add('Jordan', 'Nonexistent', '999999999', 'should say not found, not 500');
        break;
      case 'phone':
        add('Jordan', 'Valid mobile', '0791234567');
        add('Jordan', 'With country code', '+962791234567');
        add('Jordan', 'Landline', '065123456');
        add('Jordan', 'Wrong prefix', '0591234567');
        add('Jordan', 'Letters', '07912345AB');
        break;
      case 'email':
        add('Email', 'Valid', 'qa.tester@example.com');
        add('Email', 'No @', 'not-an-email');
        add('Email', 'Double @', 'a@@b.com');
        add('Email', 'Unicode local part', 'محمد@example.com');
        add('Email', 'Very long local part', `${'a'.repeat(70)}@example.com`);
        add('Email', 'Trailing dot', 'a@example.com.');
        break;
      case 'iban':
        add('Bank', 'Valid JO IBAN', 'JO94CBJO0010000000000131000302');
        add('Bank', 'Bad checksum', 'JO00CBJO0010000000000131000302');
        add('Bank', 'Spaced', 'JO94 CBJO 0010 0000 0000 0131 0003 02');
        break;
      case 'date':
        add('Date', 'Today', new Date().toISOString().slice(0, 10));
        add('Date', 'Far future', '2999-12-31');
        add('Date', 'Far past', '1900-01-01');
        add('Date', 'Leap day', '2024-02-29');
        add('Date', 'Invalid leap day', '2023-02-29');
        add('Date', 'Impossible', '2024-13-45');
        break;
      case 'name':
        add('Names', 'Apostrophe', "O'Brien", "quoting bug and naive SQL both show here");
        add('Names', 'Hyphenated', 'Al-Example');
        add('Names', 'Single char', 'م');
        add('Names', 'Numbers in name', 'محمد 123');
        break;
    }

    /* --- injection-shaped strings (detection, not exploitation) --- */
    add('Injection-shaped', 'SQL quote', "' OR '1'='1", 'a correct app just stores or rejects this');
    add('Injection-shaped', 'Script tag', '<script>alert(1)</script>', 'must render escaped, never execute');
    add('Injection-shaped', 'HTML entity', '&lt;b&gt;bold&lt;/b&gt;', 'double-encoding check');
    add('Injection-shaped', 'Template literal', '${7*7}', 'renders as 49 if interpolated');
    add('Injection-shaped', 'Null byte', 'abc\0def');
    add('Injection-shaped', 'Path traversal', '../../etc/passwd');

    if (f.pattern) {
      add('Pattern', `Violates pattern`, '!!!invalid!!!', `field declares pattern="${f.pattern}"`);
    }

    return out;
  }

  /* ------------------------------------------------------------- value setting */

  /**
   * Write through the native setter so framework-managed inputs (React, Vue) see
   * the change, then fire the events PrimeFaces/JSF actually listens to.
   */
  /** input, change, blur: the three a framework may be listening for. */
  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  const landedResult = (landed, value) => ({
    landed,
    truncated: landed !== value,
    expectedLength: String(value ?? '').length,
    actualLength: String(landed ?? '').length,
  });

  function setValue(el, value) {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    /*
     * A tick is not a string.
     *
     * `el.value = 'true'` on a checkbox sets the *submitted* value and leaves
     * the box exactly as unticked as it was, so every checkbox test the palette
     * offered was a no-op that reported success. `click()` rather than
     * `.checked = …` because a framework listening for the click is the common
     * case and a silent `.checked` write is invisible to it.
     */
    if (type === 'checkbox' || type === 'radio') {
      const wanted = value !== '' && value !== false && value !== 'false';
      if (el.checked !== wanted) el.click();
      else fire(el);
      return landedResult(el.checked ? 'true' : '', wanted ? 'true' : '');
    }

    if (tag === 'select') {
      el.focus();
      const match =
        [...el.options].find((o) => o.value === value) ||
        [...el.options].find((o) => (o.textContent || '').trim() === value);
      if (!match) {
        // Chosen deliberately: a value the list does not offer is one of the
        // partitions, and the honest report is that the control refused it.
        fire(el);
        return { landed: el.value, truncated: true, expectedLength: String(value).length, actualLength: String(el.value).length, rejected: true };
      }
      el.value = match.value;
      fire(el);
      return landedResult(el.value, match.value);
    }

    if (type === 'file') {
      // A page cannot be scripted into attaching a file, and pretending
      // otherwise would be the same false negative the truncation check exists
      // to prevent.
      return { landed: '', truncated: false, expectedLength: 0, actualLength: 0, rejected: true, reason: 'A file has to be chosen by hand: the browser does not let any script attach one.' };
    }

    if (el.isContentEditable && tag !== 'input' && tag !== 'textarea') {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value) }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return landedResult(el.textContent, value);
    }

    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;

    fire(el);

    // maxlength truncates silently; report it rather than leave a false negative.
    return landedResult(el.value, value);
  }

  /* ----------------------------------------------------------------- palette */

  let palette = null;
  let target = null;

  function close() {
    const back = palette ? target : null;
    if (palette) clearSelection(); // K1: the yellow ring is only for the pick-to-palette moment; applied, Esc or a click away ends it
    palette?.remove();
    palette = null;
    target = null;
    // r6-08-2: the focus goes back to the field the palette was opened for (a click outside moves it on afterwards).
    try { if (back?.isConnected) back.focus({ preventScroll: true }); } catch { /* the field may have gone */ }
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onOutside, true);
  }

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const onOutside = (e) => {
    // Seen from the document, a click inside a closed shadow root is
    // retargeted to the host — so `palette.contains(e.target)` says "outside"
    // for the palette's own search box and closes it under the tester's
    // cursor. The composed path does NOT help: the root is closed, so from a
    // document listener the path stops at the host and never names the palette
    // (that closed the palette on mousedown, before the click on a value
    // landed: "Try nasty values does nothing"). The host itself is the test.
    if (palette && !window.UQAUiHost?.isOurs?.(e.target) && !(e.composedPath?.() || [e.target]).includes(palette)) close();
  };

  /**
   * Spaces are the whole point of several of these values, and a raw preview
   * renders "  value  " identically to "value". Show them.
   */
  function previewOf(value) {
    if (value === '') return '(empty)';
    const visible = value
      .replace(/^\s+/, (m) => '·'.repeat(m.length))
      .replace(/\s+$/, (m) => '·'.repeat(m.length))
      .replace(/ /g, '·');
    if (/^·+$/.test(visible)) return `${visible} (${value.length} space${value.length === 1 ? '' : 's'})`;
    return visible.length > 32 ? `${visible.slice(0, 32)}… (${value.length})` : visible;
  }

  function open(el) {
    close();
    window.UQAUiHost?.clearToasts();
    target = el;
    const f = inspect(el);
    const values = boundaryValues(f);

    // Into the shadow root, not the page. This palette was 52 nodes inside the
    // document under test — audited by axe scans, photographed by screenshots,
    // and offerable by the tool's own locator picker. See content/ui-host.js.
    palette = window.UQAUiHost.uiLayer('uqa-palette');
    // r6-08-2: a dialog with a name, so a screen reader announces what opened.
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-label', t('overlay.field.dialog', 'Test values for {label}').replace('{label}', f.label || el.name || el.tagName.toLowerCase()));

    const head = document.createElement('div');
    head.className = 'uqa-palette-head';
    const title = document.createElement('strong');
    title.textContent = f.label || el.name || el.tagName.toLowerCase();
    const meta = document.createElement('span');
    meta.textContent = [
      f.kind,
      f.type,
      f.maxlength ? t('overlay.field.max', 'max {n}').replace('{n}', f.maxlength) : null,
      f.required ? t('overlay.field.required', 'required') : null,
    ].filter(Boolean).join(' · ');
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = t('overlay.field.filter', 'Filter values…');
    search.className = 'uqa-palette-search';
    search.setAttribute('aria-label', search.placeholder);
    head.append(title, meta, search);
    palette.append(head);

    // A polite count, so a screen reader hears what the filter left (read-only text, never a control).
    const count = document.createElement('div');
    count.setAttribute('role', 'status');
    count.setAttribute('aria-live', 'polite');
    count.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;';
    palette.append(count);

    const list = document.createElement('div');
    list.className = 'uqa-palette-list';
    palette.append(list);

    const render = (filter = '') => {
      list.innerHTML = '';
      const q = filter.trim().toLowerCase();
      let group = null;
      values
        .filter((v) => !q || v.label.toLowerCase().includes(q) || v.group.toLowerCase().includes(q))
        .forEach((v) => {
          if (v.group !== group) {
            group = v.group;
            const h = document.createElement('div');
            h.className = 'uqa-palette-group';
            h.textContent = group;
            list.append(h);
          }
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'uqa-palette-item';
          const name = document.createElement('span');
          name.className = 'uqa-palette-name';
          name.textContent = v.label;
          const preview = document.createElement('code');
          preview.textContent = previewOf(v.value);
          row.append(name, preview);
          if (v.note) {
            const note = document.createElement('em');
            note.textContent = v.note;
            row.append(note);
          }
          row.addEventListener('click', () => apply(v, f));
          list.append(row);
        });
      if (!list.children.length) {
        const none = document.createElement('div');
        none.className = 'uqa-palette-group';
        none.textContent = t('overlay.field.none', 'No values match.');
        list.append(none);
      }
      count.textContent = list.querySelector('.uqa-palette-item')
        ? t('overlay.field.count', 'Values shown: {n}').replace('{n}', list.querySelectorAll('.uqa-palette-item').length)
        : t('overlay.field.none', 'No values match.');
    };

    search.addEventListener('input', () => render(search.value));
    render();

    position(el);
    search.focus();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onOutside, true);
  }

  function position(el) {
    const r = el.getBoundingClientRect();
    const w = palette.offsetWidth || 380;
    const h = palette.offsetHeight || 420;
    const top = r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    const left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    palette.style.top = `${top}px`;
    palette.style.left = `${left}px`;
  }

  function apply(v, f) {
    if (!target) return;
    const result = setValue(target, v.value);
    close();

    const detail = result.truncated
      ? t('overlay.field.truncated', 'truncated to {a} of {b} chars').replace('{a}', result.actualLength).replace('{b}', result.expectedLength)
      : t('overlay.field.accepted', 'accepted by the field');
    window.UQAUiHost?.flash(t('overlay.field.injected', 'Injected "{label}": {detail}').replace('{label}', v.label).replace('{detail}', detail));

    B?.emit({
      kind: 'inject',
      label: v.label,
      group: v.group,
      fieldKind: f.kind,
      fieldLabel: f.label,
      note: v.note,
      valueLength: v.value.length,
      // The value itself is only recorded when it is short and not a secret.
      value: v.value.length <= 120 ? v.value : `${v.value.slice(0, 40)}… (${v.value.length} chars)`,
      truncated: result.truncated,
      actualLength: result.actualLength,
    });
  }

  /* ------------------------------------------------------------------- entry */

  function editableUnderCursor() {
    const active = document.activeElement;
    if (!active || active === document.body) return null;
    return active.matches?.(PICKABLE) ? active : null;
  }

  /* --------------------------------------------------------- the field picker */

  /**
   * The field the tester pointed at, and the ring that says so.
   *
   * Nader's E7 and E8, in one mechanism: "like the mask or the locator picker,
   * pressing it gives a cursor to pick a field, instead of pre-clicking one",
   * and "a reset button that unmarks the selection".
   *
   * Before this, both tools read `document.activeElement` and nothing else, so
   * the sequence was: click into a field, open the popup (which takes the focus
   * with it on some surfaces), press the tool, hope. When it came back empty
   * the message was "Pick a field first", which is advice, not a control.
   *
   * A picked field is remembered here and marked with a ring drawn in the
   * shadow root, so the tester can see which field the next value will land in
   * from across the page. The ring follows scroll and resize, because a mark
   * that drifts off its field is worse than no mark.
   */
  let selected = null;
  let ring = null;

  /**
   * The sentinel selector that used to live here is gone.
   *
   * GROUP G, 7 September 2026. `UQA_CLEAR_FIELD` now has a row in
   * `background/dispatch-tables.js` and a handler that routes it here through
   * `sendToFeature`, so the reset is a message rather than a fake field id
   * riding on `UQA_DESCRIBE_FIELD`. The listener that answers it was already
   * written below and is unchanged.
   */

  function placeRing() {
    if (!ring) return;
    // K1: the page re-rendered or moved on (a game level, an SPA route): the field is gone, so is its mark, never a ring left over text.
    if (!selected?.isConnected) { clearSelection(); return; }
    const r = selected.getBoundingClientRect();
    Object.assign(ring.style, {
      left: `${r.left - 3}px`,
      top: `${r.top - 3}px`,
      width: `${r.width + 6}px`,
      height: `${r.height + 6}px`,
    });
  }

  function markSelected(el) {
    selected = el;
    if (!ring) ring = window.UQAUiHost?.uiLayer('uqa-field-ring') || null;
    if (ring) ring.style.pointerEvents = 'none';
    placeRing();
    addEventListener('scroll', placeRing, true);
    addEventListener('resize', placeRing, true);
    for (const ev of ['pagehide', 'popstate', 'hashchange']) addEventListener(ev, clearSelection);
  }

  /** The reset. Unmarks the selection and takes the ring down. */
  function clearSelection() {
    const had = !!selected;
    selected = null;
    ring?.remove();
    ring = null;
    removeEventListener('scroll', placeRing, true);
    removeEventListener('resize', placeRing, true);
    for (const ev of ['pagehide', 'popstate', 'hashchange']) removeEventListener(ev, clearSelection);
    return had;
  }

  /**
   * The field a request from the worker means.
   *
   * While the palette is open, `document.activeElement` is our own host — the
   * page cannot see into a closed shadow root, so focus inside it reports the
   * `qaw-ui` element. That is not a field, and it used to be worse: with the
   * palette in the light DOM, "the focused field" was the palette's own search
   * box. The field the palette was opened for is the one the tester is
   * standing in, so it comes next; a focused page field beats both.
   */
  /**
   * The field a request from the worker means.
   *
   * While the palette is open, `document.activeElement` is our own host — the
   * page cannot see into a closed shadow root, so focus inside it reports the
   * `qaw-ui` element. That is not a field, and it used to be worse: with the
   * palette in the light DOM, "the focused field" was the palette's own search
   * box.
   *
   * The order is: a field named outright, then the one the tester picked with
   * the crosshair, then the one they are standing in, then the one the palette
   * was opened for. The picked field comes **before** the focused one on
   * purpose: picking is a deliberate act and focus is an accident of where the
   * last click landed, so when the two disagree the deliberate one wins.
   */
  function fieldFor(selector) {
    if (selector) return document.querySelector(selector);
    if (selected?.isConnected) return selected;
    const active = document.activeElement;
    if (active && active !== document.body && active.tagName.toLowerCase() !== 'qaw-ui' && 'value' in active) {
      return active;
    }
    if (target?.isConnected) return target;
    return editableUnderCursor();
  }

  let armed = false;
  let armBar = null;

  /**
   * The crosshair, for both tools.
   *
   * `purpose` decides only what happens after the click: "nasty" opens the
   * palette on the field, "values" marks it and hands the tester back to the
   * popup, where "Read the field" now has something to read. Everything else —
   * the cursor, the bar, the reset, Escape — is the same, because to the tester
   * it is the same gesture.
   */
  function armPick(purpose = 'nasty') {
    if (armed) return;
    // One crosshair at a time. See claimPointer() in content/ui-host.js.
    window.UQAUiHost?.claimPointer?.('field', () => disarm());
    armed = true;
    document.documentElement.classList.add('uqa-injecting');

    armBar = window.UQAUiHost?.uiLayer('uqa-field-bar') || null;
    if (armBar) {
      const line = document.createElement('span');
      line.textContent =
        purpose === 'values'
          ? t('overlay.field.values', 'Click the field you want the classes for. Esc cancels.')
          : t('overlay.field.any', 'Click a field for awkward values. Esc cancels.');
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'uqa-field-reset';
      reset.textContent = t('overlay.field.clear', 'Clear the selection');
      reset.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.UQAUiHost?.flash(clearSelection() ? 'Selection cleared.' : 'Nothing was selected.');
        },
        true
      );
      armBar.append(line, reset);
    }

    const pick = (e) => {
      if (window.UQAUiHost?.isOurs?.(e.target)) return;
      const el = e.target?.closest?.(PICKABLE);
      if (!el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      disarm();
      markSelected(el);
      if (purpose === 'values') {
        const f = inspect(el);
        window.UQAUiHost?.flash(
          t('overlay.field.picked', 'Picked: {what}. Open QA Wrap and press "Read the field".').replace('{what}', f.label || el.name || f.tag)
        );
      } else {
        open(el);
      }
    };
    const cancel = (e) => {
      if (e.key === 'Escape') disarm();
    };
    function disarm() {
      if (!armed) return;
      window.UQAUiHost?.releasePointer?.('field');
      armed = false;
      document.documentElement.classList.remove('uqa-injecting');
      armBar?.remove();
      armBar = null;
      document.removeEventListener('click', pick, true);
      document.removeEventListener('keydown', cancel, true);
    }
    document.addEventListener('click', pick, true);
    document.addEventListener('keydown', cancel, true);
  }

  // D-1010-90: the keymap calls this directly inside the isolated world; no page-visible event can trigger it.
  function triggerFromKeymap() {
    const focused = editableUnderCursor();
    if (focused) open(focused);
    else armPick('nasty');
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    /*
     * This extension's own worker, and nothing else.
     *
     * `sender.id` is stamped by the browser and cannot be forged: a message from
     * another extension carries that extension's id, and one from a web page
     * carries no id at all. `sender.tab` is refused as well, because every
     * message this listener is meant to hear comes from the service worker,
     * which is not a tab; anything arriving with a tab on it came from somewhere
     * that has no business driving a tool inside the page under test.
     *
     * The model is `content/bridge.js`, and the rule is research/51d §7:
     * authorise on `sender.id`, never on `sender.url`.
     */
    if (sender?.id !== chrome.runtime.id || sender?.tab) return false;
    if (msg?.type === 'UQA_INJECT') {
      /*
       * The crosshair first, the focused field second.
       *
       * It used to be the other way round, and "the focused field" on a page
       * the tester has just clicked around is almost never the field they
       * meant. A deliberate pick beats an accidental focus, which is why a
       * remembered selection is honoured before anything is guessed.
       */
      if (selected?.isConnected) {
        open(selected);
        sendResponse({ opened: true, armed: false, picked: true });
        return true;
      }
      const focused = editableUnderCursor();
      if (focused) open(focused);
      else armPick('nasty');
      sendResponse({ opened: !!focused, armed: !focused });
      return true;
    }

    /** The reset for both tools: unmark the picked field, keep everything else. */
    if (msg?.type === 'UQA_CLEAR_FIELD') {
      close();
      sendResponse({ cleared: clearSelection() });
      return true;
    }

    /**
     * What a field declares about itself.
     *
     * This is the input to equivalence partitioning: the constraints the field
     * carries — `type`, `min`, `max`, `maxlength`, `required`, `pattern`, `step`
     * — are the specification the browser was handed, and partitions derived
     * from anything else are guesses. Read from the page, never asked for.
     */
    /**
     * Set a value the way the application will notice.
     *
     * `setValue` is the injector's own setter, which fires the input and change
     * events a framework listens for. Assigning `el.value` directly leaves
     * React and every JSF postback believing the field is still empty, which
     * makes a designed value look like it was rejected when it was never seen.
     */
    if (msg?.type === 'UQA_SET_FIELD_VALUE') {
      const el = fieldFor(msg.selector);
      if (!el) {
        armPick('values');
        sendResponse({ set: false, reason: 'Pick the field first: the crosshair is on the page.' });
        return true;
      }
      const result = setValue(el, msg.value);
      clearSelection(); // K1: the value is in, the mark has done its job
      el.focus?.();
      sendResponse({
        set: !result.rejected,
        rejected: !!result.rejected,
        reason: result.reason || null,
        length: String(msg.value ?? '').length,
      });
      return true;
    }

    if (msg?.type === 'UQA_DESCRIBE_FIELD') {
      const el = fieldFor(msg.selector);
      /*
       * Nothing to read is a cursor, not a scolding.
       *
       * This answered `null`, the worker turned that into "Pick a field first.
       * There is nothing to derive partitions from", and the tester was left
       * holding a sentence instead of a tool. The mask and the locator both
       * answer the same situation by handing over a crosshair, and this is the
       * same situation: the tester has said what they want and has not yet said
       * where. So the crosshair goes up as this answers, and the popup's own
       * copy says where to look. `null` is still the answer, because the
       * partitions genuinely cannot be derived yet.
       */
      if (!el) {
        armPick('values');
        sendResponse(null);
        return true;
      }
      sendResponse({
        ...inspect(el),
        name: el.name || null,
        selector: window.UQASelector?.describe?.(el)?.locator || null,
      });
      return true;
    }
    return false;
  });

  window.UQAInjector = {
    open,
    close,
    inspect,
    boundaryValues,
    setValue,
    armPick,
    clearSelection,
    selected: () => selected,
    triggerFromKeymap,
  };
})();
