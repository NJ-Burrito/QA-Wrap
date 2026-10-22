/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The Harvester: every interactive element on the page, each with a locator
 * the selector engine has verified against the live DOM.
 *
 * The picker gives one locator for one click. This gives all of them at once,
 * with the page's own structure kept — which form a field belongs to, which
 * landmark a button sits in, which control submits which form — so that the
 * page object and the brief built from it read like the page, not like a list.
 *
 * Top frame only. A locator inside an iframe carries a frameLocator prefix
 * already; harvesting every frame separately would produce N maps for one
 * page, and the worker only hears the first frame's answer anyway.
 */
(() => {
  if (window.__UQA_HARVESTER__) return;
  window.__UQA_HARVESTER__ = true;
  if (window.top !== window) return;

  const S = window.UQASelector;

  const SELECTOR = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[role=checkbox]',
    '[role=switch]', '[role=radio]', '[role=combobox]', '[role=textbox]', '[contenteditable=true]',
  ].join(',');

  const BUDGET_MS = 8000;
  const CAP = 600;

  function kindOf(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'a' || role === 'link') return 'link';
    if (tag === 'button' || role === 'button' || ['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
    if (tag === 'select' || role === 'combobox') return 'select';
    if (tag === 'textarea' || role === 'textbox' || el.isContentEditable) return 'textarea';
    if (type === 'checkbox' || role === 'checkbox' || role === 'switch') return 'checkbox';
    if (type === 'radio' || role === 'radio') return 'radio';
    if (tag === 'input') return 'field';
    return 'control';
  }

  function regionOf(el) {
    const host = el.closest('dialog, [role=dialog], nav, header, footer, aside, main, [role=navigation], [role=banner], [role=contentinfo], [role=main]');
    if (!host) return '';
    const role = (host.getAttribute('role') || '').toLowerCase();
    const tag = host.tagName.toLowerCase();
    if (tag === 'dialog' || role === 'dialog') return 'dialog';
    if (tag === 'nav' || role === 'navigation') return 'nav';
    if (tag === 'header' || role === 'banner') return 'header';
    if (tag === 'footer' || role === 'contentinfo') return 'footer';
    if (tag === 'aside') return 'aside';
    return 'main';
  }

  function labelOf(el) {
    try {
      const id = el.getAttribute('id');
      const lab = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label');
      const t = lab ? S.normText(lab.textContent) : '';
      return t || S.normText(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '');
    } catch {
      return '';
    }
  }

  function formName(form, i, submit) {
    const named = S.normText(form.getAttribute('aria-label') || form.getAttribute('name') || form.getAttribute('id') || '');
    if (named) return named;
    const heading = form.querySelector('h1, h2, h3, legend');
    if (heading) return S.normText(heading.textContent).slice(0, 60);
    if (submit?.name) return submit.name;
    return `Form ${i + 1}`;
  }

  function harvest() {
    const t0 = performance.now();
    const all = [...document.querySelectorAll(SELECTOR)].filter((el) => {
      if (el.closest('[data-uqa], .uqa-ui')) return false;
      if (el.disabled) return false;
      // Masked by hand: skipped entirely, not described with its value
      // removed. A locator built from a masked cell still carries the text —
      // `getByRole('cell', { name: 'Layla Haddad' })` is the name, in the page
      // object, in the repo.
      if (window.UQAMask?.isMasked?.(el)) return false;
      try { return S.isVisible(el); } catch { return true; }
    });

    const elements = [];
    const forms = [];
    const formIndex = new Map();
    let truncated = false;

    // Form controls and what is on screen first: if the budget runs out, the
    // part a test writer needs most is the part that was done.
    const rank = (el) => (el.closest('form') ? 0 : 1) + (el.getBoundingClientRect().top < innerHeight ? 0 : 2);
    const ordered = all.slice(0, CAP).map((el, i) => ({ el, i, r: rank(el) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.el);
    if (all.length > CAP) truncated = true;
    const described = S.describeMany(ordered, { budgetMs: BUDGET_MS });
    if (described.truncated) truncated = true;

    for (let k = 0; k < described.length; k++) {
      const el = ordered[k];
      const d = described[k];
      if (!d) continue;

      const form = el.closest('form');
      let formN = null;
      if (form) {
        if (!formIndex.has(form)) { formIndex.set(form, forms.length); forms.push({ n: forms.length, el: form, fields: [], submit: null }); }
        formN = formIndex.get(form);
      }
      const kind = kindOf(el);
      const n = elements.length;
      const entry = {
        n,
        kind,
        tag: d.tag,
        role: d.role || '',
        name: d.name || '',
        label: labelOf(el),
        text: kind === 'link' || kind === 'button' ? S.normText(el.textContent).slice(0, 80) : '',
        type: (el.getAttribute('type') || '').toLowerCase() || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        required: el.required || el.getAttribute('aria-required') === 'true' || undefined,
        href: kind === 'link' ? el.href : undefined,
        playwright: d.playwright,
        strategy: d.strategy,
        unique: !d.ambiguous,
        matches: d.matches,
        css: d.css,
        region: regionOf(el),
        form: formN,
      };
      elements.push(entry);
      if (formN != null) {
        const f = forms[formN];
        if (kind === 'button' && (el.type === 'submit' || (el.tagName === 'BUTTON' && !el.getAttribute('type')))) {
          if (f.submit == null) f.submit = n;
        } else if (kind !== 'button' && kind !== 'link') f.fields.push(n);
      }
    }

    const byKind = {};
    for (const e of elements) byKind[e.kind] = (byKind[e.kind] || 0) + 1;

    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.lang || '',
      dir: document.documentElement.dir || getComputedStyle(document.documentElement).direction || 'ltr',
      at: Date.now(),
      elements,
      forms: forms.map((f, i) => ({ n: f.n, name: formName(f.el, i, f.submit != null ? elements[f.submit] : null), fields: f.fields, submit: f.submit })),
      counts: {
        elements: elements.length,
        unique: elements.filter((e) => e.unique).length,
        ambiguous: elements.filter((e) => !e.unique).length,
        forms: forms.length,
        candidates: all.length,
        byKind,
      },
      truncated,
      ms: Math.round(performance.now() - t0),
    };
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
    if (msg?.type === 'UQA_HARVEST_PAGE') {
      try {
        sendResponse(harvest());
      } catch (err) {
        sendResponse({ error: String(err?.message || err) });
      }
      return true;
    }
    return false;
  });

  window.UQAHarvester = { harvest };
})();
