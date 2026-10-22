/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * UQA selector engine — Playwright-first, uniqueness-verified.
 *
 * Rule from the research: an unverified selector is worse than none. Every
 * candidate below is resolved back against the live DOM and only offered if it
 * matches exactly one element. That verification step is what makes SelectorsHub
 * the category leader, and it is the bar here.
 *
 * Tuned for PrimeFaces 11 (a JSF portal):
 *   - generated ids (j_idt42, form:table:0:btn) are never offered as primary
 *   - Shadow DOM and iframes are traversed
 *   - Arabic text is normalised (tatweel, presentation forms, diacritics) before matching
 */
(() => {
  if (window.UQASelector) return;

  /* ------------------------------------------------------------ text handling */

  const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
  const TATWEEL = /ـ/g;

  function normText(s) {
    if (!s) return '';
    return String(s)
      .normalize('NFKC')
      .replace(TATWEEL, '')
      .replace(ARABIC_DIACRITICS, '')
      .replace(/[آأإٱ]/g, 'ا') // alef variants
      .replace(/ة/g, 'ه') // ta marbuta -> ha
      .replace(/ى/g, 'ي') // alef maksura -> ya
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * T-043: the page's own text, as Playwright compares it: whitespace collapsed, zero-width space dropped (its
   * normalizeWhiteSpace does the same), every other code point kept. normText (folded) is for comparison only.
   * ponytail: visibleText reads at most 5,000 characters; a longer text is over NAME_MAX either way.
   */
  function wireText(s) {
    return s ? String(s).replace(/\u200b/g, '').replace(/\s+/g, ' ').trim() : '';
  }

  /** Longest name or text a locator may quote; a longer one is skipped, never cut (it would no longer match). */
  const NAME_MAX = 120;
  /** Invisible or unrenderable: bidi marks, joiners, isolates, BOM, private use (icon fonts). */
  const INVISIBLE = /[\u200c-\u200f\u202a-\u202e\u2060-\u2069\ufeff\ue000-\uf8ff]/;
  const INVISIBLE_G = new RegExp(INVISIBLE.source, 'g');
  /** Line terminators cannot sit raw inside a quoted string (r3-11-6): they are written as \uXXXX like the invisible code points. */
  const LINE_BREAK_G = /[\n\r\u2028\u2029]/g;
  /** The private-use block is an icon font: Playwright's own generator refuses it, so no locator quotes it. */
  const ICON_FONT = /[\ue000-\uf8ff]/;
  /**
   * A name or text a locator may quote verbatim; says why not through `warn`, a Map of code to the rank of the strategy that
   * had the problem. describe() keeps a code only when the locator it chose is that strategy or a weaker one: a testid
   * locator was not made weaker by a label it never needed to quote (completion review 4).
   */
  function quotable(text, warn, rank) {
    const note = (code) => warn.set(code, Math.min(warn.get(code) ?? rank, rank));
    if (!text) return false;
    if (text.length > NAME_MAX) { note('truncated'); return false; }
    if (ICON_FONT.test(text)) { note('bidi'); return false; }
    if (INVISIBLE.test(text)) note('bidi');
    return true;
  }

  /**
   * textContent, never innerText.
   *
   * innerText forces a synchronous reflow on every read. Scanning a 3,000
   * element page cost ~3,000 forced layouts per describe() — 71ms on a desktop
   * and 1.2 SECONDS on a low-end laptop, on every recorded click. textContent
   * needs no layout; the visibility check that innerText implied is applied
   * explicitly where it actually matters (the text strategy).
   */
  function visibleText(el) {
    if (!el) return '';
    return wireText((el.textContent || '').slice(0, 5000));
  }

  /* ------------------------------------------------------------- id heuristics */

  const GENERATED_ID = [
    /j_idt\d+/i,          // PrimeFaces / JSF
    /:r[0-9a-z]+:/i,      // React 18 useId, bare or inside a library's own id (radix-:r1:, headlessui-menu-button-:r2:)
    /(?:^|[^a-z0-9])_r_[0-9a-z]+_|«r[0-9a-z]+»/i, // React 19 useId (_r_1_ and guillemets)
    /^radix-.*[\d:]/i,
    /^headlessui-.*\d/i,
    /^chakra-.*\d/i,
    /^mat-[a-z-]+-\d+/i, // Angular Material
    /^cdk-[a-z-]+-\d+/i, // Angular CDK
    /^rc[-_].*\d/i,      // rc-select, rc-tabs, rc-tree
    /^react-select-\d/i,
    /^react-aria-?\d/i,
    /^downshift-\d/i,
    /^ember\d+/i,
    /__BVID__\d+/,       // bootstrap-vue
    /^css-[0-9a-z]{5,}$/i, // Emotion
    /^(mui|ant|el)-[0-9a-z]{6,}$/i,
    /[0-9a-f]{8}-[0-9a-f]{4}-/i, // uuid
    /\d{4,}/,             // long digit runs
    /^[0-9a-f]{12,}$/i,
    /:\d+:/,              // JSF nested naming containers with row indices
  ];

  function isStableId(id) {
    if (!id || id.length > 80) return false;
    return !GENERATED_ID.some((re) => re.test(id));
  }

  // r8-05-2: class names a build tool or a CSS-in-JS library makes up. A CSS-module hash is "__" plus a tail with a digit or a capital
  // (Button_root__a1B2c); a plain BEM element (card__title, react-select__control) has neither and stays stable.
  const GENERATED_CLASS = [/__(?=[0-9A-Za-z_-]*[0-9A-Z])[0-9A-Za-z_-]{4,}$/, /^sc-/, /^svelte-/];
  const isStableClass = (c) => isStableId(c) && !GENERATED_CLASS.some((re) => re.test(c));

  /* ----------------------------------------------------------- role + a11y name */

  const IMPLICIT_ROLE = {
    a: (el) => (el.hasAttribute('href') ? 'link' : null),
    area: (el) => (el.hasAttribute('href') ? 'link' : null),
    button: () => 'button',
    datalist: () => 'listbox',
    dialog: () => 'dialog',
    fieldset: () => 'group',
    form: () => 'form',
    h1: () => 'heading', h2: () => 'heading', h3: () => 'heading',
    h4: () => 'heading', h5: () => 'heading', h6: () => 'heading',
    hr: () => 'separator',
    img: (el) => (el.getAttribute('alt') === '' ? 'presentation' : 'img'),
    li: () => 'listitem',
    main: () => 'main',
    nav: () => 'navigation',
    ol: () => 'list',
    optgroup: () => 'group',
    option: () => 'option',
    output: () => 'status',
    progress: () => 'progressbar',
    section: () => 'region',
    select: (el) => (el.multiple || el.size > 1 ? 'listbox' : 'combobox'),
    summary: () => 'button',
    table: () => 'table',
    tbody: () => 'rowgroup',
    td: () => 'cell',
    textarea: () => 'textbox',
    th: () => 'columnheader',
    tr: () => 'row',
    ul: () => 'list',
    header: (el) => (el.closest('article, aside, main, nav, section') ? null : 'banner'),
    footer: (el) => (el.closest('article, aside, main, nav, section') ? null : 'contentinfo'),
    input: (el) => {
      switch ((el.type || 'text').toLowerCase()) {
        case 'button': case 'submit': case 'reset': case 'image': return 'button';
        case 'checkbox': return 'checkbox';
        case 'radio': return 'radio';
        case 'range': return 'slider';
        case 'number': return 'spinbutton';
        case 'search': return el.hasAttribute('list') ? 'combobox' : 'searchbox';
        case 'email': case 'tel': case 'text': case 'url':
          return el.hasAttribute('list') ? 'combobox' : 'textbox';
        case 'hidden': case 'password': case 'file': case 'color':
        case 'date': case 'datetime-local': case 'month': case 'time': case 'week':
          return null; // no mapped ARIA role
        default: return 'textbox';
      }
    },
  };

  function roleOf(el) {
    if (!el || el.nodeType !== 1) return null;
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.trim().split(/\s+/)[0];
    const fn = IMPLICIT_ROLE[el.tagName.toLowerCase()];
    return fn ? fn(el) : null;
  }

  function labelFor(el) {
    const doc = el.ownerDocument;
    if (el.id) {
      // A generated id is fine for *finding* the label, just not for locating.
      const index = labelIndex();
      const l = index
        ? index.get(el.id)
        : (() => {
            try {
              return doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            } catch {
              return null;
            }
          })();
      if (l) return visibleText(l);
    }
    const wrapping = el.closest('label');
    if (wrapping) return visibleText(wrapping);
    // PrimeFaces commonly puts the label in a sibling cell or preceding span.
    const prev = el.previousElementSibling;
    if (prev && /^(label|span)$/i.test(prev.tagName)) return visibleText(prev);
    return '';
  }

  function accessibleName(el) {
    if (!el || el.nodeType !== 1) return '';

    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const parts = labelledby.split(/\s+/)
        .map((id) => el.ownerDocument.getElementById(id))
        .filter(Boolean)
        .map(visibleText);
      if (parts.length) return wireText(parts.join(' '));
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return wireText(ariaLabel);

    const tag = el.tagName.toLowerCase();
    if (tag === 'img') return wireText(el.getAttribute('alt') || '');
    if (tag === 'input') {
      const type = (el.type || '').toLowerCase();
      if (type === 'button' || type === 'submit' || type === 'reset') {
        return wireText(el.value || type);
      }
      const l = labelFor(el);
      if (l) return l;
      return wireText(el.getAttribute('title') || '');
    }
    if (tag === 'select' || tag === 'textarea') {
      const l = labelFor(el);
      if (l) return l;
    }

    const text = visibleText(el);
    if (text) return text;

    const title = wireText(el.getAttribute('title') || '');
    if (title) return title;

    // Last resort, per the HTML-AAM: a placeholder names a control that has no
    // label. A portal login fields are exactly this case — placeholder-only, so
    // without this the timeline would read "Fill textbox" instead of naming it.
    return wireText(el.getAttribute('placeholder') || '');
  }

  /* ------------------------------------------------------------- DOM traversal */

  /**
   * Cache for one describe() pass.
   *
   * resolve() used to re-walk the entire document for every candidate — nine
   * candidates on a page the size of a JSF portal meant nine full sweeps plus
   * an accessible-name computation per element each time. The cache turns that
   * into one sweep, and memoises role and name per element.
   */
  let pass = null;

  function beginPass() {
    pass = { elements: null, role: new WeakMap(), name: new WeakMap(), labels: null };
  }

  /**
   * label[for=…] indexed once per pass.
   *
   * labelFor() ran a document.querySelector per element. Resolving a textbox
   * candidate touches every input on the page, so that was 300 DOM queries for
   * a single describe() on a long form — and it made inputs slower than
   * buttons by an order of magnitude.
   */
  function labelIndex() {
    if (!pass) return null;
    if (!pass.labels) {
      pass.labels = new Map();
      for (const l of document.querySelectorAll('label[for]')) {
        const key = l.getAttribute('for');
        if (key && !pass.labels.has(key)) pass.labels.set(key, l);
      }
    }
    return pass.labels;
  }

  function endPass() {
    pass = null;
  }

  function passElements() {
    if (!pass) return allElements();
    if (!pass.elements) pass.elements = allElements();
    return pass.elements;
  }

  function cachedRole(el) {
    if (!pass) return roleOf(el);
    if (!pass.role.has(el)) pass.role.set(el, roleOf(el));
    return pass.role.get(el);
  }

  function cachedName(el) {
    if (!pass) return accessibleName(el);
    if (!pass.name.has(el)) pass.name.set(el, accessibleName(el));
    return pass.name.get(el);
  }

  /**
   * The elements that could plausibly carry a given role.
   *
   * Computing role + accessible name for every node in the document was the
   * other half of the cost. A CSS prefilter cuts a 3,300-element sweep down to
   * the few dozen that could possibly match, and querySelectorAll is native.
   * Anything not listed falls back to the full set, so correctness never
   * depends on this table being complete.
   */
  const ROLE_SELECTOR = {
    button: 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], input[type="image"], summary',
    link: 'a[href], area[href], [role="link"]',
    textbox: 'input, textarea, [role="textbox"], [contenteditable]',
    searchbox: 'input[type="search"], [role="searchbox"]',
    combobox: 'select, input[list], [role="combobox"]',
    listbox: 'select[multiple], datalist, [role="listbox"]',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
    img: 'img, [role="img"]',
    list: 'ul, ol, [role="list"]',
    listitem: 'li, [role="listitem"]',
    table: 'table, [role="table"]',
    row: 'tr, [role="row"]',
    cell: 'td, [role="cell"]',
    columnheader: 'th, [role="columnheader"]',
    spinbutton: 'input[type="number"], [role="spinbutton"]',
    slider: 'input[type="range"], [role="slider"]',
    dialog: 'dialog, [role="dialog"]',
    navigation: 'nav, [role="navigation"]',
    main: 'main, [role="main"]',
    form: 'form, [role="form"]',
    group: 'fieldset, optgroup, [role="group"]',
    option: 'option, [role="option"]',
    separator: 'hr, [role="separator"]',
    progressbar: 'progress, [role="progressbar"]',
    region: 'section, [role="region"]',
    banner: 'header, [role="banner"]',
    contentinfo: 'footer, [role="contentinfo"]',
    status: 'output, [role="status"]',
    rowgroup: 'tbody, thead, tfoot, [role="rowgroup"]',
    presentation: '[role="presentation"], img[alt=""]',
  };

  /** True when any element in the document hosts an open shadow root (cached for the pass). */
  function hasShadow() {
    if (pass && pass.hasShadow !== undefined) return pass.hasShadow;
    const v = [...document.querySelectorAll('*')].some((el) => el.shadowRoot);
    if (pass) pass.hasShadow = v;
    return v;
  }

  /**
   * D-1010-101: querySelectorAll that also pierces open shadow roots, the way Playwright's css, testid, label and
   * placeholder engines do. Closed roots are out of scope (README). Native when the page has no shadow DOM.
   */
  function qsaDeep(selector) {
    if (!hasShadow()) return [...document.querySelectorAll(selector)];
    const out = [];
    const walk = (root) => {
      out.push(...root.querySelectorAll(selector));
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return out;
  }

  function candidatesForRole(role) {
    const selector = ROLE_SELECTOR[role];
    if (!selector) return passElements();
    try {
      return qsaDeep(selector);
    } catch {
      return passElements();
    }
  }

  /** Every element in the frame, descending into open shadow roots. */
  function allElements(root = document) {
    const out = [];
    const walk = (node) => {
      const els = node.querySelectorAll('*');
      for (const el of els) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return out;
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (!style) return true;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  /**
   * Playwright's getByRole leaves out elements hidden from the accessibility tree (display none, visibility hidden,
   * aria-hidden on the element or an ancestor); test id, label, placeholder and text do not filter at all.
   */
  function hiddenForAria(el) {
    if (el.closest('[aria-hidden="true"]')) return true;
    return typeof el.checkVisibility === 'function' ? !el.checkVisibility({ visibilityProperty: true }) : false;
  }

  /** Playwright's non-exact match: case-insensitive substring of the same wire text. */
  const has = (hay, needle) => hay.toLowerCase().includes(needle.toLowerCase());

  /* -------------------------------------------------------------- verification */

  /**
   * Resolve a candidate back to the elements it matches. This is the whole point
   * of the engine — a candidate that resolves to != 1 element is discarded.
   */
  function resolve(candidate) {
    const els = passElements();
    switch (candidate.strategy) {
      case 'testid':
        // Native attribute selector beats iterating the document.
        return qsaDeep(`[${candidate.attr}]`).filter(
          (el) => el.getAttribute(candidate.attr) === candidate.value
        );

      case 'role': {
        // Prefiltered by tag, so cachedName() runs on a handful of nodes
        // rather than the whole document.
        return candidatesForRole(candidate.role).filter((el) => {
          if (cachedRole(el) !== candidate.role) return false;
          if (candidate.name != null && !(candidate.exact
            ? cachedName(el) === candidate.name
            : cachedName(el).includes(candidate.name))) return false;
          return !hiddenForAria(el);
        });
      }

      case 'label':
        return qsaDeep('input, select, textarea, [contenteditable]').filter(
          (el) =>
            has(labelFor(el), candidate.value) ||
            has(wireText(el.getAttribute('aria-label') || ''), candidate.value)
        );

      case 'placeholder':
        return qsaDeep('[placeholder]').filter(
          (el) => has(wireText(el.getAttribute('placeholder') || ''), candidate.value)
        );

      case 'text': {
        /**
         * Order matters enormously here.
         *
         * This used to call isVisible() — getComputedStyle plus
         * getBoundingClientRect, i.e. a forced layout — on every element in the
         * document before comparing any text. On a 1,800 element page that was
         * the single most expensive thing the engine did.
         *
         * Now: reject on raw length (free), then on normalised text, and only
         * pay for layout on the handful that actually matched.
         */
        const needle = candidate.value;
        const out = [];
        for (const el of els) {
          const raw = el.textContent;
          if (!raw) continue;
          // A container holds all of its descendants' text; the innermost
          // element carrying the string is the one we want, and its own text
          // cannot be wildly longer than the needle.
          if (raw.length < needle.length || raw.length > needle.length * 4) continue;
          if (visibleText(el) !== needle) continue;
          if (Array.from(el.children).some((c) => visibleText(c) === needle)) continue;
          out.push(el); // T-043: no visibility filter, getByText has none
          if (out.length > 1) break; // uniqueness is the only question
        }
        return out;
      }

      case 'css':
        try {
          return qsaDeep(candidate.value);
        } catch {
          return [];
        }

      case 'xpath':
        if (hasShadow()) return []; // D-1010-101: XPath cannot cross a shadow root, so it is never chosen on such a page
        try {
          const it = document.evaluate(candidate.value, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          const out = [];
          for (let i = 0; i < it.snapshotLength; i++) out.push(it.snapshotItem(i));
          return out;
        } catch {
          return [];
        }

      default:
        return [];
    }
  }

  /* ------------------------------------------------------- candidate generation */

  const TESTID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy'];

  function q(s) {
    // Invisible code points are written as \uXXXX so the tester can see them (T-043).
    const esc = (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
    return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(LINE_BREAK_G, esc).replace(INVISIBLE_G, esc)}'`;
  }

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id && isStableId(node.id)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const classes = Array.from(node.classList)
        .filter((c) => isStableClass(c) && !/^(ng|v|is|has)-/.test(c))
        .slice(0, 2);
      if (classes.length) part += classes.map((c) => `.${CSS.escape(c)}`).join('');

      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function xPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.id && isStableId(node.id)) {
        parts.unshift(`//*[@id=${q(node.id)}]`);
        return parts.join('/');
      }
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(`/${node.tagName.toLowerCase()}`);
        break;
      }
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      const idx = sameTag.indexOf(node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}[${idx}]`);
      node = parent;
    }
    return parts[0].startsWith('/') ? parts.join('/') : '//' + parts.join('/');
  }

  /**
   * Distinctive attribute hooks.
   *
   * An inline handler or a data-* attribute is very often the only *authored*
   * thing on an element whose id is generated. PrimeFaces/JSF is the motivating
   * case: an account-type tabs are anonymous divs that differ solely by
   * `onclick="...value:'company'..."`, and without this the engine falls all the
   * way through to a six-level nth-of-type path that dies on the next re-render.
   *
   * We do not try to judge which literal is distinctive — we emit candidates and
   * let the uniqueness check decide, which is what it is for.
   */
  function attributeCandidates(el) {
    const out = [];
    const push = (sel, rank) =>
      out.push({ strategy: 'css', value: sel, rank, expr: `locator(${q(sel)})` });

    const onclick = el.getAttribute('onclick');
    if (onclick && onclick.length <= 400) {
      // key:'value' pairs first — they carry the meaning.
      const pairs = [...onclick.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*'([^']{1,40})'/g)].map(
        (m) => `${m[1]}:'${m[2]}'`
      );
      const literals = [...onclick.matchAll(/'([^']{2,40})'/g)].map((m) => m[1]);
      [...new Set([...pairs, ...literals])].slice(0, 4).forEach((needle, i) => {
        // CSS attribute selectors take a double-quoted string, so a needle
        // containing a double quote cannot be expressed — skip those.
        if (needle.includes('"')) return;
        push(`[onclick*="${needle}"]`, 6.2 + i * 0.01);
      });
    }

    const names = typeof el.getAttributeNames === 'function' ? el.getAttributeNames() : [];
    for (const attr of names) {
      if (!attr.startsWith('data-') || TESTID_ATTRS.includes(attr)) continue;
      const v = el.getAttribute(attr);
      if (!v || v.length > 40 || v.includes('"') || !isStableId(v)) continue;
      push(`[${attr}="${v}"]`, 6.4);
    }

    const name = el.getAttribute('name');
    if (name && isStableId(name) && !name.includes('"')) {
      push(`[name="${name}"]`, 6.5);
    }

    return out;
  }

  /** Elements that carry no user-facing meaning; describing them is noise. */
  const NON_CONTENT = new Set([
    'HTML', 'HEAD', 'META', 'TITLE', 'SCRIPT', 'STYLE', 'LINK', 'BASE', 'NOSCRIPT',
  ]);


  /**
   * Roles whose accessible name comes from whatever text happens to be inside.
   *
   * A `<form>`, a `<section>`, a `<nav>` and friends take their name from
   * descendant content when nothing declares one — so on a page showing a
   * validation banner, the recorder produced
   *
   *     getByRole('form', { name: 'Epic sadface: Username is required' })
   *
   * named after a message that only exists *while the error is on screen*. It
   * therefore cannot match on a clean run, which is precisely when the test
   * would be executed. Found by an independent field test.
   *
   * A declared name — `aria-label`, `aria-labelledby`, `title`, or an
   * associated `<label>` — is stable and stays eligible. Only a *borrowed* one
   * is refused, and the element falls back to a test id or a CSS path, which is
   * what those strategies are for.
   */
  const BORROWS_ITS_NAME = new Set([
    'form', 'section', 'navigation', 'region', 'main', 'complementary',
    'banner', 'contentinfo', 'search', 'group', 'article', 'list', 'generic',
  ]);

  function nameIsBorrowed(el) {
    if (!BORROWS_ITS_NAME.has(roleOf(el))) return false;
    // Declared beats inherited: if somebody named it deliberately, use the name.
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
    if (el.getAttribute('title')) return false;
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
    return true;
  }

  /*
   * r6-11-2b: getByRole(role, { name }) only matches when the role takes its name from content, from a label or from
   * the author. A role=status / alert / log element is named only by aria-label or aria-labelledby, so its text must not
   * be offered as a role name (the generated click or expect timed out on the real page).
   */
  const NAME_FROM_CONTENT = new Set([
    'button', 'link', 'heading', 'cell', 'gridcell', 'columnheader', 'rowheader', 'row', 'option', 'tab', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'checkbox', 'radio', 'switch', 'treeitem', 'tooltip', 'listitem',
    'textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton', 'slider', 'progressbar', 'img', 'figure', 'table', 'dialog', 'alertdialog',
  ]);
  const roleTakesName = (el, role) =>
    NAME_FROM_CONTENT.has(role) || BORROWS_ITS_NAME.has(role) || !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));

  function candidatesFor(el, warn = new Map()) {
    const out = [];
    const role = roleOf(el);
    const name = accessibleName(el);

    for (const attr of TESTID_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) {
        out.push({
          strategy: 'testid', attr, value: v, rank: 0,
          expr:
            attr === 'data-testid'
              ? `getByTestId(${q(v)})`
              : `locator(${q(`[${attr}="${v.replace(/[\\"]/g, '\\$&')}"]`)})`, // r2-05-8: the value is a CSS string, so \ and " are escaped before it is quoted for JavaScript
        });
      }
    }

    if (role && quotable(name, warn, 1) && !nameIsBorrowed(el) && roleTakesName(el, role)) {
      out.push({
        strategy: 'role', role, name, exact: true, rank: 1,
        expr: `getByRole(${q(role)}, { name: ${q(name)}, exact: true })`,
      });
    }

    const label = labelFor(el) || wireText(el.getAttribute('aria-label') || '');
    if (quotable(label, warn, 2) && /^(input|select|textarea)$/i.test(el.tagName)) {
      out.push({ strategy: 'label', value: label, rank: 2, expr: `getByLabel(${q(label)})` });
    }

    const placeholder = wireText(el.getAttribute('placeholder') || '');
    if (quotable(placeholder, warn, 3)) {
      out.push({ strategy: 'placeholder', value: placeholder, rank: 3, expr: `getByPlaceholder(${q(placeholder)})` });
    }

    if (role && !name) {
      out.push({ strategy: 'role', role, name: null, rank: 4, expr: `getByRole(${q(role)})` });
    }

    const text = visibleText(el);
    if (text && text.length <= 60 && quotable(text, warn, 5) && !/^(input|select|textarea)$/i.test(el.tagName)) {
      out.push({ strategy: 'text', value: text, rank: 5, expr: `getByText(${q(text)}, { exact: true })` });
    }

    if (el.id && isStableId(el.id)) {
      const css = `#${CSS.escape(el.id)}`;
      out.push({ strategy: 'css', value: css, rank: 6, expr: `locator(${q(css)})` });
    }

    out.push(...attributeCandidates(el));

    const path = cssPath(el);
    if (path) out.push({ strategy: 'css', value: path, rank: 7, expr: `locator(${q(path)})` });

    const xp = xPath(el);
    if (xp) out.push({ strategy: 'xpath', value: xp, rank: 8, expr: `locator(${q('xpath=' + xp)})` });

    return out.sort((a, b) => a.rank - b.rank);
  }

  /* --------------------------------------------------------------- frame chain */

  /**
   * The selector for one `<iframe>`, read from the document that holds it.
   *
   * Lifted out of framePrefix() because the answer is now wanted in two places
   * and neither should own a second copy of the rule. A frame walking its own
   * ancestry wants it, and so does a *parent* frame answering the service
   * worker on behalf of a child it cannot see across an origin boundary.
   *
   * Name, then a stable id, then src, then position — the order has not
   * changed. What is new is that each of the first three has to resolve to
   * exactly one frame in that document before it is offered. It never used to
   * be checked, which broke the one promise this engine makes: two
   * `<iframe src="/embed">` on a page both answered `iframe[src="/embed"]`, and
   * a frameLocator built from it reached whichever came first — the wrong
   * document, with nothing anywhere to say so. `iframe >> nth=N` is Playwright's
   * own chaining, so the positional answer is still one selector string and the
   * frameLocator around it does not change shape.
   */
  function frameSelector(frameEl) {
    const doc = frameEl.ownerDocument;
    const tag = frameEl.tagName.toLowerCase();
    const one = (sel) => {
      try {
        return doc.querySelectorAll(sel).length === 1 ? sel : null;
      } catch {
        return null;
      }
    };
    const name = frameEl.getAttribute('name');
    const id = frameEl.getAttribute('id');
    const src = frameEl.getAttribute('src');
    const named =
      (name && one(`${tag}[name="${name}"]`)) ||
      (id && isStableId(id) && one(`${tag}#${CSS.escape(id)}`)) ||
      (src && one(`${tag}[src="${src}"]`)) ||
      null;
    if (named) return { selector: named, expr: `frameLocator(${q(named)})`, unique: true };

    const peers = [...doc.querySelectorAll(tag)];
    const at = peers.indexOf(frameEl);
    const positional = peers.length === 1 && at === 0 ? tag : `${tag} >> nth=${Math.max(at, 0)}`;
    return { selector: positional, expr: `frameLocator(${q(positional)})`, unique: at >= 0 };
  }

  /**
   * Playwright needs a frameLocator() chain to reach into iframes. Same-origin
   * ancestors can be walked; a cross-origin boundary throws, and `crossOrigin`
   * says so rather than emitting a locator that will not work.
   *
   * Saying so is no longer the end of it. The picker takes that flag as its cue
   * to ask the service worker, which can see the frame tree that no frame can,
   * and hands the finished chain back to describe() below.
   */
  function framePrefix() {
    const chain = [];
    let win = window;
    let crossOrigin = false;

    while (win !== win.parent) {
      let frameEl = null;
      try {
        frameEl = win.frameElement;
      } catch {
        crossOrigin = true;
        break;
      }
      if (!frameEl) {
        crossOrigin = true;
        break;
      }
      chain.unshift(frameSelector(frameEl).expr);
      win = win.parent;
    }

    return { prefix: chain.length ? chain.join('.') + '.' : '', crossOrigin, depth: chain.length };
  }

  /* ---------------------------------------------------------------- public API */

  /**
   * Best verified locator for an element.
   * Returns { locator, strategy, matches, ambiguous, alternatives, framePrefix, warnings }.
   */
  function describe(el, options = {}) {
    if (!el || el.nodeType !== 1) return null;
    if (NON_CONTENT.has(el.tagName)) return null;

    /*
     * The chain may be handed in, and when it is, it is the truth.
     *
     * A frame behind an origin boundary cannot see its own `frameElement`, so
     * framePrefix() returns nothing there and warns that the chain is
     * incomplete — which was accurate and useless: the locator it produced did
     * not work, and the tester had to guess the missing half. The service
     * worker can see the whole frame tree, so it builds the chain and the
     * picker passes it in here, where the alternatives get it too rather than
     * only the chosen one.
     */
    const frame = options.frame || framePrefix();
    const warnings = [];
    const warn = new Map(); // T-043: codes (bidi, truncated) with the rank they apply from; the report words them
    if (frame.crossOrigin) {
      warnings.push('Element is inside a cross-origin iframe. The frameLocator chain is incomplete.');
    }

    // Inside describeMany() the pass is already open and shared — the whole
    // point of it — so only open (and later close) one if none exists.
    const mine = !pass;
    if (mine) beginPass();
    const results = [];
    const t0 = performance.now();
    const budgetMs = Number(options.budgetMs) > 0 ? Number(options.budgetMs) : 0; // r7-05-3: the capture phase gives up resolving after this long
    try {
      // Candidates are already ranked best-first, so once one resolves uniquely
      // there is nothing better further down the list — stop resolving.
      for (const c of candidatesFor(el, warn)) {
        if (budgetMs && results.length && performance.now() - t0 > budgetMs) break; // best so far; the no-unique warning below says so
        const matched = resolve(c);
        const entry = {
          ...c,
          matches: matched.length,
          hit: matched.length === 1 && matched[0] === el,
          first: matched[0] === el,
        };
        results.push(entry);
        // One verified-unique locator plus a couple of alternatives is all the
        // UI ever shows. Resolving the rest is work nobody reads.
        if (entry.hit && results.length >= 3) break;
      }
    } finally {
      if (mine) endPass();
    }

    const unique = results.filter((r) => r.hit);
    const chosen = unique[0] || results.find((r) => r.first) || results[0] || null;

    if (!chosen) return null;
    if (!unique.length) {
      warnings.push(
        `No candidate resolved to exactly one element; best option matches ${chosen.matches}. Locator will need disambiguation.`
      );
    }

    let expr = chosen.expr;
    // If nothing was unique but our element is the first match, .first() is honest and works.
    if (!chosen.hit && chosen.first && chosen.matches > 1) expr += '.first()';

    const codes = [...warn].filter(([, rank]) => rank <= (chosen.rank ?? 99)).map(([code]) => code);
    return {
      locator: expr,
      playwright: `page.${frame.prefix}${expr}`,
      framePrefix: frame.prefix,
      strategy: chosen.strategy,
      matches: chosen.matches,
      ambiguous: !chosen.hit,
      // T-043: the recorder forwards `warnings` only; the codes ride at its end and core/events.js moves them out.
      warnings: [...warnings, ...codes.map((c) => `code:${c}`)],
      warnCodes: codes,
      alternatives: results
        .filter((r) => r !== chosen)
        .slice(0, 6)
        .map((r) => ({ expr: `page.${frame.prefix}${r.expr}`, strategy: r.strategy, matches: r.matches, unique: r.hit })),
      css: cssPath(el),
      xpath: xPath(el),
      role: roleOf(el),
      name: accessibleName(el).slice(0, NAME_MAX),
      tag: el.tagName.toLowerCase(),
    };
  }

  /**
   * Describe many elements in one pass.
   *
   * The Harvester on a 5,000-node portal spent four seconds and stopped at
   * 140 elements because every describe() swept the document afresh and
   * recomputed every accessible name. One pass shares the sweep, the role
   * and name caches and the label index across all of them. `budgetMs`
   * stops early and says so rather than freezing the page.
   */
  function describeMany(els, { budgetMs = 8000, frame } = {}) {
    const t0 = performance.now();
    const out = [];
    beginPass();
    try {
      for (const el of els) {
        if (performance.now() - t0 > budgetMs) { out.truncated = true; break; }
        let d = null;
        try { d = describe(el, { frame }); } catch { d = null; }
        out.push(d);
      }
    } finally {
      endPass();
    }
    out.ms = Math.round(performance.now() - t0);
    return out;
  }

  window.UQASelector = {
    describe,
    describeMany,
    accessibleName,
    roleOf,
    normText,
    isStableId,
    isStableClass,
    cssPath,
    xPath,
    allElements,
    isVisible,
    framePrefix,
    frameSelector,
  };
})();
