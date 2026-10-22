/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The page, read as a specification would describe it.
 *
 * The harvester next door reads the page as a *test* would: locators, one row
 * per control, everything a Playwright file needs. This reads the same DOM as a
 * *specification* would: what the page asks the user for, what it will not
 * accept, where it goes, and what it says when it refuses. Two different
 * questions of the same document, and they are worth asking separately —
 * merging them produced a model that was too coarse for a locator and too fine
 * for a requirement.
 *
 * What is read, and why each one earns a requirement:
 *
 *   - **forms and their fields** — a field with `required`, a `pattern`, a
 *     `min`/`max`, a `maxlength` or an `<option>` list is a data rule the page
 *     already declares. Nobody has to guess it and nobody should retype it.
 *   - **buttons and their roles** — submit, reset and the rest are the actions
 *     the page offers, and an action is a functional requirement in the making.
 *   - **links and navigation** — where this page can take a person, which is
 *     the navigation map an SRS needs and the one thing a screenshot cannot say.
 *   - **headings and regions** — the shape of the page, so requirements are
 *     grouped the way the page groups them rather than in DOM order.
 *   - **validation messages already on screen** — an error a page is showing is
 *     observed behaviour, not a guess, and it belongs in "error handling".
 *   - **state: disabled, hidden, aria-invalid, readonly** — a control that is
 *     disabled right now is a precondition somebody has to write down.
 *   - **tables** — a table's headers are its data dictionary.
 *
 * Nothing is invented. Where the DOM is ambiguous the reader says so, and the
 * builder turns each of those into an open question rather than into a
 * confident sentence — the difference between a draft that saves a day and one
 * that costs a week.
 *
 * Injected on demand (`ON_DEMAND.specReader`), never at page load: this walks
 * the whole document, and a walk on every page a tester visits is a cost with
 * no purpose until they press the button.
 */
(() => {
  if (window.__uqaSpecReader) return;
  window.__uqaSpecReader = true;

  const CAP = { fields: 300, buttons: 120, links: 200, headings: 80, tables: 20, messages: 40 };
  const BUDGET_MS = 6000;

  /*
   * T-043 (G05): a masked element's words never reach the model. `text` drops a masked element and, on a container,
   * the masked descendants; `withheld` collects each masking root once, so the SRS can say how many it left out.
   */
  const withheld = new Set();
  const maskRoot = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (n.hasAttribute?.('data-uqa-masked')) return n; return null; };
  const masked = (el) => { const r = el && window.UQAMask?.isMasked?.(el) ? maskRoot(el) : null; if (r) withheld.add(r); return !!r; };
  const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();
  function text(el) {
    if (!el || masked(el)) return '';
    const inner = window.UQAMask && el.querySelectorAll ? el.querySelectorAll('[data-uqa-masked]') : [];
    if (!inner.length) return squash(el.textContent);
    inner.forEach((n) => withheld.add(n));
    const copy = el.cloneNode(true);
    copy.querySelectorAll('[data-uqa-masked]').forEach((n) => n.remove());
    return squash(copy.textContent);
  }
  const attr = (el, name) => el.getAttribute(name) || '';
  const visible = (el) => {
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (!style) return true;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return !(el.offsetWidth === 0 && el.offsetHeight === 0 && !el.getClientRects().length);
  };

  /** The words next to a control, in the order a person would look for them. */
  function labelOf(el) {
    const byId = el.id && el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (byId) return text(byId);
    const wrapping = el.closest('label');
    if (wrapping) return text(wrapping).replace(text(el), '').trim();
    const labelledby = attr(el, 'aria-labelledby')
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id))
      .filter(Boolean)
      .map(text)
      .join(' ')
      .trim();
    if (labelledby) return labelledby;
    return attr(el, 'aria-label') || attr(el, 'placeholder') || attr(el, 'name') || '';
  }

  /** What the page will accept in this field, from what it declares. */
  function rulesOf(el) {
    const rules = {};
    const type = (attr(el, 'type') || el.tagName.toLowerCase()).toLowerCase();
    if (el.required || attr(el, 'aria-required') === 'true') rules.required = true;
    if (attr(el, 'pattern')) rules.pattern = attr(el, 'pattern');
    if (attr(el, 'minlength')) rules.minLength = Number(attr(el, 'minlength'));
    if (attr(el, 'maxlength')) rules.maxLength = Number(attr(el, 'maxlength'));
    if (attr(el, 'min')) rules.min = attr(el, 'min');
    if (attr(el, 'max')) rules.max = attr(el, 'max');
    if (attr(el, 'step')) rules.step = attr(el, 'step');
    if (attr(el, 'autocomplete')) rules.autocomplete = attr(el, 'autocomplete');
    if (type === 'email' || type === 'url' || type === 'tel' || type === 'number' || type === 'date') rules.format = type;
    return rules;
  }

  function fieldOf(el, index) {
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? (attr(el, 'type') || 'text').toLowerCase() : tag;
    const options = tag === 'select'
      ? [...el.options].slice(0, 40).map((o) => ({ value: o.value, label: text(o) })).filter((o) => o.label || o.value)
      : [];
    return {
      n: index,
      tag,
      type,
      name: attr(el, 'name'),
      id: el.id || '',
      label: labelOf(el).slice(0, 120),
      help: (() => {
        const id = attr(el, 'aria-describedby').split(/\s+/)[0];
        return id ? text(el.ownerDocument.getElementById(id)).slice(0, 200) : '';
      })(),
      rules: rulesOf(el),
      options,
      // Whether a box is ticked *right now*.
      //
      // This was missing, and its absence made `core/fine-print.js` say the
      // opposite of the truth. The consent check reads `field.checked` to tell
      // an unticked box (which is what consent looks like) from a pre-ticked
      // one (which is not consent at all under GDPR Article 7). With the field
      // never captured it was always `undefined`, so every pre-ticked consent
      // box on every site was reported as the good case. A check that reports
      // the failure it exists to find as a pass is worse than no check.
      checked: type === 'checkbox' || type === 'radio' ? !!el.checked : undefined,
      value: type === 'password' || masked(el) ? '' : String(el.value ?? '').slice(0, 80),
      state: {
        disabled: !!el.disabled,
        readonly: !!el.readOnly,
        hidden: !visible(el),
        invalid: attr(el, 'aria-invalid') === 'true',
      },
    };
  }

  function formsOf(doc) {
    const forms = [...doc.querySelectorAll('form')];
    // A page whose fields are not in a <form> is normal in a single-page app,
    // so the loose ones are collected as one implicit form rather than lost.
    const loose = [...doc.querySelectorAll('input:not([type=hidden]), select, textarea')]
      .filter((el) => !el.closest('form'));
    /**
     * The sentence beside the submit button, where a form asks without a box.
     *
     * Plenty of forms carry no consent checkbox and a line of small print
     * instead: "by continuing you agree to our privacy policy". That is a
     * different finding from no consent at all, and `core/fine-print.js` has
     * always had a branch for it reading `form.consentText` — which nothing
     * ever produced, so the branch was dead and every such form was reported
     * as having no consent of any kind.
     */
    const consentTextOf = (root) => {
      const submit = root.querySelector('button[type=submit], input[type=submit], button:not([type=button]):not([type=reset])');
      const near = submit?.closest('div, fieldset, section, p') || root;
      return text(near).slice(-400);
    };

    const build = (root, i, implicit) => {
      const fields = [...root.querySelectorAll('input:not([type=hidden]), select, textarea')];
      return {
        n: i,
        consentText: consentTextOf(root),
        name: implicit ? '' : (attr(root, 'name') || attr(root, 'aria-label') || text(root.querySelector('legend, h1, h2, h3')).slice(0, 80)),
        implicit,
        action: implicit ? '' : attr(root, 'action'),
        method: implicit ? '' : (attr(root, 'method') || 'get').toLowerCase(),
        fields: fields.slice(0, CAP.fields).map(fieldOf),
        submits: [...root.querySelectorAll('button, input[type=submit], input[type=button]')]
          .slice(0, 12)
          .map((b) => ({ label: text(b) || attr(b, 'value') || labelOf(b), type: (attr(b, 'type') || 'submit').toLowerCase(), disabled: !!b.disabled })),
      };
    };
    const out = forms.slice(0, 20).map((f, i) => build(f, i, false));
    if (loose.length) {
      out.push({
        n: out.length,
        name: '',
        implicit: true,
        action: '',
        method: '',
        consentText: consentTextOf(doc.body),
        fields: loose.slice(0, CAP.fields).map(fieldOf),
        submits: [...doc.querySelectorAll('button')].filter((b) => !b.closest('form')).slice(0, 12)
          .map((b) => ({ label: text(b), type: (attr(b, 'type') || 'button').toLowerCase(), disabled: !!b.disabled })),
      });
    }
    return out;
  }

  /** An error the page is showing right now: observed, not guessed. */
  function messagesOf(doc) {
    const nodes = [
      ...doc.querySelectorAll('[role=alert], [aria-live=assertive], .error, .invalid-feedback, .field-error, [class*="error"]'),
    ];
    const seen = new Set();
    const out = [];
    for (const el of nodes) {
      const words = text(el).slice(0, 200);
      if (!words || seen.has(words) || !visible(el)) continue;
      seen.add(words);
      out.push({
        text: words,
        role: attr(el, 'role') || (attr(el, 'aria-live') ? `live:${attr(el, 'aria-live')}` : ''),
        near: labelOf(el.closest('label, .field, .form-group') || el).slice(0, 80),
      });
      if (out.length >= CAP.messages) break;
    }
    return out;
  }

  /* ── the hygiene pass ──────────────────────────────────────────────────
   *
   * Everything below answers `research/48-reel-2-brief.md` (twenty craft
   * points) and the front-end-checkable half of `research/53-reel-4-brief.md`
   * (twenty security points). It lives here rather than in `core/fine-print.js`
   * because every one of these questions is a question about *this DOM* —
   * whether the logo is inside an anchor, whether the page scrolls sideways,
   * whether a phone number on screen is reachable as a `tel:` link. The module
   * next door decides what each measurement *means*; this only measures.
   *
   * It is deliberately a *measurement*, not a verdict: no string here says GAP
   * or DECLARED. That split is what let reel 2's brief keep its own promise —
   * that a favicon which 404s is objective and a menu that is "right" is not.
   *
   * The whole pass is capped and cheap. It runs inside the same 6 s budget as
   * the rest of the reader, adds one `getComputedStyle` pass over the
   * overflow survivors only, and touches no network.
   */

  /** The framework's own title, still in the tab. */
  const STARTER_TITLES = /^(react app|create next app|vite \+ react|vite app|next\.?js|document|untitled|home|index|my app|new project|svelte app|nuxt app|astro)$/i;

  /** The template's own words, wherever they are. */
  const PLACEHOLDER_TEXT = /lorem ipsum|your company|company name here|123 main street|1234 street|info@example\.com|hello@example\.com|you@example\.com|example\.com|\bTODO\b|coming soon|placeholder|\[your [a-z ]+\]|اسم الشركة|عنوان الشركة|قريبا/i;

  /**
   * Key shapes that must never be in a page a stranger can fetch.
   *
   * Prefix-anchored on purpose. A bare 32-character hex string is a cache
   * buster far more often than it is a secret, and a check that cries wolf on
   * every build hash gets turned off in a week, which costs more than it saves.
   */
  const SECRET_SHAPES = [
    { id: 'openai', why: 'an OpenAI-style secret key', match: /\bsk-[A-Za-z0-9_-]{20,}/ },
    { id: 'google-api', why: 'a Google API key', match: /\bAIza[0-9A-Za-z_-]{35}/ },
    { id: 'stripe-live', why: 'a live Stripe key', match: /\b[ps]k_live_[0-9A-Za-z]{16,}/ },
    { id: 'aws', why: 'an AWS access key id', match: /\bAKIA[0-9A-Z]{16}\b/ },
    { id: 'github', why: 'a GitHub token', match: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
    { id: 'slack', why: 'a Slack token', match: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
    { id: 'private-key', why: 'a PEM private key', match: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
    { id: 'env-assignment', why: 'an .env-style assignment', match: /\b(?:API_KEY|SECRET_KEY|PRIVATE_KEY|DB_PASSWORD|ACCESS_TOKEN|CLIENT_SECRET)\s*[=:]\s*["']?[A-Za-z0-9_\-./+]{12,}/ },
  ];

  /**
   * A phone number a person would recognise as one, either script.
   *
   * The first version of this matched any run of eight or more digits with
   * separators in it, and on a real news front page it reported three ids and
   * a timestamp as unreachable phone numbers. A check that produces three
   * false findings on the first site it meets is a check a tester turns off.
   *
   * So a bare digit run is no longer enough. It must either carry an
   * international prefix, or sit within a few words of something that says it
   * is a telephone number, in English or in Arabic.
   */
  const PHONE = /(?:\+|00)\d[\d\s().-]{6,}\d|\b0\d[\d\s().-]{6,}\d/g;
  const PHONE_WORD = /(tel|telephone|phone|mobile|call us|fax|whatsapp|هاتف|جوال|محمول|اتصل|فاكس)/i;
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

  /**
   * The digits of a number, with the two ways of writing a country code made
   * one.
   *
   * `+962 6 4602550` and `tel:0096264602550` are the same telephone number,
   * and comparing raw digit runs called them a mismatch and told a ministry
   * its footer link sends visitors somewhere else. `+` and a leading `00` are
   * the same prefix, so both are dropped before the comparison, and a leading
   * national trunk `0` is dropped too where the other side has a country code.
   */
  const digits = (s) => String(s || '').replace(/\D+/g, '');
  const dial = (s) => {
    const raw = String(s || '').trim();
    let d = digits(raw);
    if (/^\+/.test(raw)) return d.replace(/^0+/, '');
    if (d.startsWith('00')) d = d.slice(2);
    return d.replace(/^0+/, '');
  };
  const sameNumber = (a, b) => {
    const x = dial(a);
    const y = dial(b);
    if (!x || !y) return false;
    // One side may carry a country code the other omits, so a suffix match of
    // at least eight digits counts as the same number.
    return x === y || (x.length >= 8 && y.length >= 8 && (x.endsWith(y) || y.endsWith(x)));
  };

  /**
   * H1 and H16: does the document scroll sideways, and what is sticking out.
   *
   * Two passes, the second only over the survivors of the first, which is the
   * shape `content/rtl-stress.js` already proved: measuring every element's
   * computed style is the expensive half, and on a page that does not overflow
   * there is nothing to measure.
   */
  function overflowOf(doc) {
    const root = doc.documentElement;
    const width = root.clientWidth;
    const over = root.scrollWidth > width + 1;
    const offenders = [];
    if (over) {
      for (const el of [...doc.body.querySelectorAll('*')].slice(0, 3000)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= width + 1) continue;
        const style = doc.defaultView?.getComputedStyle(el);
        offenders.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 60),
          right: Math.round(r.right),
          overhang: Math.round(r.right - width),
          clips: style ? style.overflowX === 'hidden' || style.overflowX === 'clip' : false,
        });
        if (offenders.length >= 12) break;
      }
      // The widest overhang first: on a page with forty offenders, one of them
      // is usually the cause and the rest are its children.
      offenders.sort((a, b) => b.overhang - a.overhang);
    }
    return { scrollWidth: root.scrollWidth, clientWidth: width, viewport: doc.defaultView?.innerWidth || width, over, offenders };
  }

  /** H17: is the header logo inside an anchor, and does it point home. */
  function logoOf(doc) {
    const header = doc.querySelector('header, [role=banner], .header, #header') || doc.body;
    // In order of how sure we are that this is the logo, because "the first
    // image in the header" picked out a hero photograph on two of the three
    // real sites this was run against and then reported it as an unlinked
    // logo. A wrong element makes the row worse than absent.
    const node = header.querySelector('[class*="logo" i] img, [class*="logo" i] svg, img[class*="logo" i], svg[class*="logo" i], img[alt*="logo" i], [id*="logo" i] img, [id*="logo" i] svg')
      || header.querySelector('[class*="logo" i], [id*="logo" i]')
      || doc.querySelector('[class*="logo" i] img, img[alt*="logo" i]')
      || header.querySelector('a[href] img, a[href] svg')
      || header.querySelector('img, svg, picture');
    if (!node) return { found: false };
    const anchor = node.closest('a[href]');
    let home = false;
    if (anchor) {
      try {
        const u = new URL(anchor.href, location.href);
        // A locale prefix is still home. `/en-US/`, `/ar/` and `/en/` are how
        // most localised sites spell their front page, and calling those a
        // failure was wrong on two of the three sites this was measured on.
        const rest = u.pathname.replace(/^\/+|\/+$/g, '');
        home = u.host === location.host && (rest === '' || /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(rest));
      } catch { home = false; }
    }
    return {
      found: true,
      inHeader: !!header.contains(node),
      linked: !!anchor,
      href: anchor ? anchor.href : '',
      home,
      // An element that only reacts to a click handler fails twice: here, and
      // in the accessibility audit, which is where the second half belongs.
      clickHandlerOnly: !anchor && !!node.closest('[onclick], [role=button]'),
    };
  }

  /** H18 and H19: a number or an address on screen that nobody can press. */
  function contactsOf(doc, bodyText) {
    const tel = [...doc.querySelectorAll('a[href^="tel:"]')];
    const mail = [...doc.querySelectorAll('a[href^="mailto:"]')];
    const linkedHrefs = tel.map((a) => a.getAttribute('href') || '');
    const linkedMails = new Set(mail.map((a) => (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].toLowerCase()));

    const plainPhones = [...new Set((bodyText.match(PHONE) || []).map((s) => s.trim()))]
      .filter((s) => digits(s).length >= 9 && digits(s).length <= 15)
      .filter((s) => !linkedHrefs.some((href) => sameNumber(s, href)))
      // An international prefix speaks for itself; anything else has to be
      // called a telephone number by the words around it.
      .filter((s) => /^(\+|00)/.test(s) || PHONE_WORD.test(bodyText.slice(Math.max(0, bodyText.indexOf(s) - 40), bodyText.indexOf(s))))
      .slice(0, 8);
    const plainMails = [...new Set((bodyText.match(EMAIL) || []).map((s) => s.toLowerCase()))]
      .filter((s) => !linkedMails.has(s))
      .slice(0, 8);

    // The worse finding of the pair: a link whose address is not the one on
    // screen sends the message somewhere the reader never agreed to.
    const mismatched = [];
    for (const a of [...tel, ...mail]) {
      const shown = text(a);
      const href = a.getAttribute('href') || '';
      if (!shown) continue;
      if (href.toLowerCase().startsWith('mailto:')) {
        const target = href.replace(/^mailto:/i, '').split('?')[0].toLowerCase();
        if (EMAIL.test(shown) && shown.toLowerCase() !== target) mismatched.push({ shown, href, kind: 'email' });
        EMAIL.lastIndex = 0;
      } else if (digits(shown).length >= 8 && !sameNumber(shown, href)) {
        mismatched.push({ shown, href, kind: 'phone' });
      }
      if (mismatched.length >= 6) break;
    }
    return { tel: tel.length, mailto: mail.length, plainPhones, plainMails, mismatched };
  }

  /**
   * H2's cousin, H7: links that never leave the page.
   *
   * A status check never sees these, because they never make a request. This
   * is the specific vibe-coded failure the reel names: a footer of links that
   * go **nowhere**, which is not the same thing as a footer of links that 404.
   */
  function deadLinksOf(doc) {
    const out = [];
    for (const a of [...doc.querySelectorAll('a')].slice(0, 400)) {
      const raw = (a.getAttribute('href') || '').trim();
      const why = raw === '' ? 'no href at all'
        : raw === '#' ? 'href="#", which goes nowhere'
          : /^javascript:\s*(void\s*\(\s*0\s*\)|;)?\s*$/i.test(raw) ? 'a javascript: no-op'
            : '';
      if (!why) continue;
      out.push({
        text: text(a).slice(0, 60),
        href: raw,
        why,
        inFooter: !!a.closest('footer, [role=contentinfo], .footer, #footer'),
        inNav: !!a.closest('nav, [role=navigation]'),
      });
      if (out.length >= 30) break;
    }
    return out;
  }

  /** H9: the year in the footer, against the year it is now. */
  function copyrightOf(bodyText) {
    const m = bodyText.match(/(?:©|\(c\)|copyright|حقوق النشر|جميع الحقوق)\s*([12]\d{3})(?:\s*[–—-]\s*([12]\d{3}))?/i);
    if (!m) return { found: false };
    const last = Number(m[2] || m[1]);
    return { found: true, text: m[0].trim(), start: Number(m[1]), last, now: new Date().getFullYear() };
  }

  /**
   * Reel 4's items 1, 14, 16 and 18, in the half a rendered page can answer.
   *
   * The other half of that list is not shy about being out of reach: a `.git`
   * history, a database rule and a billing cap are not properties of the
   * deployed site at all, and `core/fine-print.js` files them as questions
   * rather than pretending a DOM walk could answer them.
   */
  function securityOf(doc, bodyText) {
    const https = location.protocol === 'https:';
    const source = [
      bodyText.slice(0, 200_000),
      ...[...doc.querySelectorAll('script:not([src])')].slice(0, 40).map((s) => (s.textContent || '').slice(0, 40_000)),
    ].join('\n');
    const secrets = SECRET_SHAPES.filter((s) => s.match.test(source)).map((s) => ({ id: s.id, why: s.why }));

    const insecureForms = [...doc.querySelectorAll('form[action^="http:"]')].slice(0, 8)
      .map((f) => ({ action: f.getAttribute('action'), name: attr(f, 'name') || attr(f, 'aria-label') || '' }));

    // A same-origin POST with no token in the markup is the shape CSRF
    // protection usually takes when it is present. A missing one is not proof
    // of a hole — the framework may send a header instead — so the module next
    // door reports the count and says what it cannot see.
    const posting = [...doc.querySelectorAll('form')].filter((f) => (attr(f, 'method') || 'get').toLowerCase() === 'post');
    const tokened = posting.filter((f) => f.querySelector(
      'input[type=hidden][name*="csrf" i], input[type=hidden][name*="token" i], input[type=hidden][name*="authenticity" i], input[type=hidden][name="_token"]'
    ));

    return {
      https,
      secrets,
      insecureForms,
      postForms: posting.length,
      tokenedForms: tokened.length,
      // A password field on a page the browser did not encrypt is the one
      // item on reel 4's list that a person can see without any tooling.
      passwordOverHttp: !https && !!doc.querySelector('input[type=password]'),
    };
  }

  function hygieneOf(doc) {
    const bodyText = text(doc.body).slice(0, 200_000);
    /**
     * The page's own words, carried back with the measurements.
     *
     * Run against three real sites, the business-details row said "nothing on
     * the page matches address or registration or contact" on all three, and
     * all three were wrong: the details were in the footer. The check was
     * being handed the page title and its headings and nothing else, because
     * that was all that reached it. The same absence made every one of reel
     * 3's policy-text rows read GAP on a privacy notice that plainly says the
     * words.
     *
     * So the text travels with the model. Capped, because this crosses a
     * message boundary and an uncapped document is a payload nobody budgeted
     * for, and the cap is generous enough that a policy page arrives whole.
     */
    const TEXT_CAP = 60_000;
    const icon = doc.querySelector('head link[rel~="icon"], head link[rel="shortcut icon"], head link[rel="apple-touch-icon"]');
    const desc = doc.querySelector('head meta[name="description"], head meta[property="og:description"]');
    const title = (doc.title || '').trim();
    return {
      title,
      titleEmpty: !title,
      titleStarter: STARTER_TITLES.test(title),
      metaDescription: (desc?.getAttribute('content') || '').trim().slice(0, 300),
      favicon: { declared: !!icon, href: icon ? icon.href : '', rel: icon ? attr(icon, 'rel') : '' },
      overflow: overflowOf(doc),
      deadLinks: deadLinksOf(doc),
      logo: logoOf(doc),
      contacts: contactsOf(doc, bodyText),
      copyright: copyrightOf(bodyText),
      placeholders: [...new Set(
        [bodyText, ...[...doc.querySelectorAll('[alt], [title]')].slice(0, 200).map((el) => `${attr(el, 'alt')} ${attr(el, 'title')}`)]
          .flatMap((s) => s.match(new RegExp(PLACEHOLDER_TEXT.source, 'gi')) || [])
          .map((s) => s.trim())
      )].slice(0, 10),
      security: securityOf(doc, bodyText),
      text: bodyText.slice(0, TEXT_CAP),
      textTruncated: bodyText.length > TEXT_CAP,
    };
  }

  function read() {
    const started = Date.now();
    const doc = document;
    const here = new URL(location.href);
    const sameSite = (href) => { try { return new URL(href, here).host === here.host; } catch { return false; } };

    const links = [...doc.querySelectorAll('a[href]')]
      .filter((a) => visible(a) && !masked(a))
      .slice(0, CAP.links)
      .map((a) => ({
        label: text(a).slice(0, 80) || attr(a, 'aria-label').slice(0, 80),
        href: a.href,
        internal: sameSite(a.getAttribute('href')),
        inNav: !!a.closest('nav, [role=navigation]'),
      }))
      .filter((l) => l.label || l.href);

    const model = {
      url: location.href,
      title: (doc.title || '').slice(0, 200),
      lang: doc.documentElement.lang || '',
      dir: doc.documentElement.dir || (getComputedStyle(doc.documentElement).direction || 'ltr'),
      headings: [...doc.querySelectorAll('h1, h2, h3')].filter(visible).slice(0, CAP.headings)
        .map((h) => ({ level: Number(h.tagName[1]), text: text(h).slice(0, 120) })),
      regions: [...doc.querySelectorAll('main, nav, header, footer, aside, [role=main], [role=navigation], [role=banner], [role=contentinfo], [role=search], [role=form]')]
        .slice(0, 20)
        .map((r) => ({ tag: r.tagName.toLowerCase(), role: attr(r, 'role'), label: attr(r, 'aria-label').slice(0, 80) })),
      forms: formsOf(doc),
      buttons: [...doc.querySelectorAll('button, [role=button], input[type=submit], input[type=button]')]
        .filter((b) => visible(b) && !masked(b))
        .slice(0, CAP.buttons)
        .map((b) => ({
          label: (text(b) || attr(b, 'value') || labelOf(b)).slice(0, 80),
          type: (attr(b, 'type') || (b.tagName.toLowerCase() === 'button' ? 'button' : 'submit')).toLowerCase(),
          inForm: !!b.closest('form'),
          disabled: !!b.disabled || attr(b, 'aria-disabled') === 'true',
        }))
        .filter((b) => b.label),
      links,
      messages: messagesOf(doc),
      withheld: 0,
      tables: [...doc.querySelectorAll('table')].filter(visible).slice(0, CAP.tables).map((t) => ({
        caption: text(t.querySelector('caption')).slice(0, 120),
        columns: [...t.querySelectorAll('thead th, tr:first-child th')].slice(0, 20).map((th) => text(th).slice(0, 60)).filter(Boolean),
        rows: t.querySelectorAll('tbody tr').length || Math.max(0, t.rows.length - 1),
      })),
      // Measured, never judged. `core/fine-print.js` turns these into DECLARED,
      // OBSERVED, GAP or MANUAL; nothing here decides anything.
      hygiene: (() => { try { return hygieneOf(doc); } catch (err) { return { error: String(err?.message || err) }; } })(),
      counts: {},
      ms: 0,
    };

    model.counts = {
      forms: model.forms.length,
      fields: model.forms.reduce((n, f) => n + f.fields.length, 0),
      buttons: model.buttons.length,
      links: model.links.length,
      navLinks: model.links.filter((l) => l.inNav).length,
      messages: model.messages.length,
      tables: model.tables.length,
    };
    model.withheld = withheld.size;
    model.ms = Date.now() - started;
    model.truncated = model.ms > BUDGET_MS;
    return model;
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
    if (msg?.type !== 'UQA_READ_SPEC') return false;
    try {
      sendResponse(read());
    } catch (err) {
      sendResponse({ error: String(err?.message || err) });
    }
    return true;
  });
})();
