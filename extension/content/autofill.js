/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Form autofill with designed values.
 *
 * Fake Filler puts random words in every box. That gets a form submitted; it
 * does not get it *tested*, because a random string in the IBAN field tests
 * the validator, not the flow. This reads each field the way the data
 * injector does — type, label in Arabic or English, min, max, pattern — and
 * writes the one value a tester would have chosen: a real-shaped Jordanian
 * mobile, an IBAN that passes the checksum, a date inside the allowed range,
 * an amount between min and max. Every field's validity is read back after
 * the write and anything the browser still rejects is reported, field by
 * field, instead of discovered at submit.
 *
 * Skipped on purpose: hidden, disabled and read-only fields, file inputs,
 * anything that smells like a CAPTCHA. Passwords are filled — with a value
 * that satisfies the usual policy — because a sign-up form that cannot be
 * filled is not a form that can be tested.
 */
(() => {
  if (window.__UQA_AUTOFILL__) return;
  window.__UQA_AUTOFILL__ = true;

  const arabic = () => /^ar\b/i.test(document.documentElement.lang || '') || document.documentElement.dir === 'rtl';
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  const clampDate = (value, min, max) => (min && value < min ? min : max && value > max ? max : value);

  /** The one value a tester would choose for this field. */
  function designed(f, el) {
    const type = f.type;
    if (type === 'password') return 'Qa!Pass2026';
    if (type === 'url') return 'https://example.com/';
    if (type === 'color') return '#b5432b';
    if (type === 'time') return '10:30';
    if (type === 'month') return today().slice(0, 7);
    if (type === 'week') return `${new Date().getFullYear()}-W12`;
    if (type === 'range' || type === 'number') {
      const min = f.min != null && f.min !== '' ? Number(f.min) : null;
      const max = f.max != null && f.max !== '' ? Number(f.max) : null;
      const step = Number(el.getAttribute('step')) || (f.kind === 'amount' ? 0.5 : 1);
      let v = min != null && max != null ? min + Math.floor((max - min) / 2 / step) * step : f.kind === 'quantity' ? 3 : 150;
      if (min != null) v = Math.max(v, min);
      if (max != null) v = Math.min(v, max);
      return String(Number.isInteger(step) ? Math.round(v) : v);
    }
    if (type === 'date') return clampDate(today(), f.min, f.max);
    if (type === 'datetime-local') return clampDate(`${today()}T10:30`, f.min, f.max);
    switch (f.kind) {
      case 'email': return 'qa.tester@example.com';
      case 'phone': return '0791234567';
      case 'nationalId': return '2000123456';
      case 'establishment': return '100234567';
      case 'iban': return 'JO94CBJO0010000000000131000302';
      case 'amount': return '150.00';
      case 'quantity': return '3';
      case 'date': return today();
      case 'name': return arabic() ? 'ليلى حداد' : 'Layla Haddad';
      case 'address': return arabic() ? 'عمّان، العبدلي، بناية 12' : 'Amman, Abdali, Building 12';
      case 'licence': return 'LIC-2026-0142';
      case 'notes': return arabic() ? 'تمت التعبئة بواسطة QA Wrap لجولة اختبار.' : 'Filled by QA Wrap for a test run.';
      default: return arabic() ? 'قيمة اختبار' : 'Test value';
    }
  }

  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const looksLikeCaptcha = (el) => /captcha|recaptcha|hcaptcha|turnstile/i.test(`${el.name || ''} ${el.id || ''} ${el.className || ''}`);

  function visible(el) {
    try { return window.UQASelector ? window.UQASelector.isVisible(el) : !!(el.offsetWidth || el.offsetHeight); } catch { return true; }
  }

  function fill({ scope } = {}) {
    const I = window.UQAInjector;
    const root = scope ? document.querySelector(scope) || document : document;
    const filled = [];
    const skipped = [];
    const invalid = [];
    const radios = new Set();

    for (const el of root.querySelectorAll('input, textarea, select')) {
      if (el.closest('[data-uqa], .uqa-ui')) continue;
      const type = (el.type || 'text').toLowerCase();
      const name = (I ? I.inspect(el).label : '') || el.name || el.id || type;
      if (type === 'hidden' || el.disabled || el.readOnly) { if (type !== 'hidden') skipped.push({ name, why: el.disabled ? 'disabled' : 'read-only' }); continue; }
      if (!visible(el)) { skipped.push({ name, why: 'not visible' }); continue; }
      if (type === 'file') { skipped.push({ name, why: 'file input: pick a file by hand' }); continue; }
      if (['submit', 'button', 'reset', 'image'].includes(type)) continue;
      if (looksLikeCaptcha(el)) { skipped.push({ name, why: 'looks like a CAPTCHA' }); continue; }

      let value;
      if (el.tagName === 'SELECT') {
        const opt = [...el.options].find((o, i) => !o.disabled && o.value !== '' && (i > 0 || el.options.length === 1)) || [...el.options].find((o) => !o.disabled);
        if (!opt) { skipped.push({ name, why: 'no options' }); continue; }
        el.value = opt.value;
        fire(el);
        value = opt.textContent.trim();
      } else if (type === 'checkbox') {
        if (!el.checked && (el.required || /agree|accept|terms|consent|أوافق|الشروط/i.test(name))) { el.checked = true; fire(el); value = 'checked'; }
        else continue;
      } else if (type === 'radio') {
        const key = `${el.form?.id || ''}::${el.name}`;
        if (radios.has(key)) continue;
        radios.add(key);
        const group = [...root.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
        if (group.some((r) => r.checked)) continue;
        el.checked = true;
        fire(el);
        value = el.value || 'first option';
      } else {
        const f = I ? I.inspect(el) : { type, kind: 'text', maxlength: Number(el.getAttribute('maxlength')) || null, min: el.getAttribute('min'), max: el.getAttribute('max') };
        value = designed(f, el);
        if (f.maxlength && value.length > f.maxlength) value = value.slice(0, f.maxlength);
        if (I) I.setValue(el, value);
        else { el.value = value; fire(el); }
      }

      const bad = typeof el.checkValidity === 'function' && !el.checkValidity();
      const preview = String(value).length > 40 ? `${String(value).slice(0, 37)}…` : String(value);
      filled.push({ name, kind: el.tagName === 'SELECT' ? 'select' : type, value: preview, form: el.form?.id || el.form?.name || undefined });
      if (bad) invalid.push({ name, why: el.validationMessage || 'the browser still rejects it', value: preview });
    }

    return { url: location.href, filled, skipped, invalid, forms: new Set(filled.map((f) => f.form).filter(Boolean)).size };
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
    if (msg?.type === 'UQA_AUTOFILL_PAGE') {
      try { sendResponse(fill(msg)); } catch (err) { sendResponse({ error: String(err?.message || err) }); }
      return true;
    }
    return false;
  });

  window.UQAAutofill = { fill, designed };
})();
