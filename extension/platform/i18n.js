/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * One language mechanism for every surface a tester reads.
 *
 * Arabic and English are both first-class here, which is a house rule and not a
 * feature: a Jordanian QA team writes its tickets in Arabic and reads its tools
 * in whatever the tool offers. So the tables are a pair, `platform/i18n/en.json` and
 * `platform/i18n/ar.json`, with identical key sets, and `tools/test-i18n.mjs` fails
 * the moment one of them grows a key the other does not have. Half a
 * translation is worse than none: it is an interface that changes language
 * mid-sentence.
 *
 * ## Why this is a classic script and not a module
 *
 * Four of the ten surfaces load their page script as a plain
 * `<script src="…">` at the end of `<body>` — `popup.js`, `report.js`,
 * `panel.js`, `annotate.js` — and two of those start work in a top-level IIFE
 * that runs while the document is still parsing. A module script cannot run
 * before that: modules are deferred by definition, so an `import` would arrive
 * after the first paint had already been drawn in the wrong language. A
 * parser-blocking classic script in `<head>` runs before everything, which is
 * exactly the guarantee `ui/theme.js` needs and gets for the same reason.
 *
 * The file therefore contains no `import` and no `export`, which makes it valid
 * as a classic script AND as a side-effect ES module, so `tools/test-i18n.mjs`
 * can `await import()` it in Node and drive the same code the pages run. The
 * public surface is `globalThis.QAWi18n`, holding `t`, `lang`, `setLang`,
 * `dir`, `ready` and `apply`.
 *
 * ## Why the choice is stored here and not in platform/settings.js
 *
 * The same reason `ui/theme.js` keeps the theme out of it. `chrome.storage` is
 * asynchronous; a page that renders `dir="ltr"` and then flips to `rtl` when
 * the answer arrives is a visible jump on every single load, and in Arabic it
 * is the whole layout jumping, not a colour. So the choice is mirrored into
 * `localStorage` — per-profile, synchronous, read once at boot before the first
 * paint — with `chrome.storage.sync` as the durable copy that follows a tester
 * between machines. `chrome.storage.onChanged` is what carries a change to the
 * other open surfaces, so no message needs to pass through the worker and no
 * page needs reloading.
 *
 * ## Numbers stay Western
 *
 * Counts, durations, sizes and timestamps are printed with Western digits in
 * Arabic as well as in English (٤ is never written for 4). This is deliberate:
 * every number on screen has a twin in an exported report, a Jira ticket, a
 * Markdown table or a Playwright locator, and those are ASCII. A tester who
 * reads "٤ عناصر" on the popup and searches an exported report for "4" has to
 * know both forms to find their own evidence. One numeral system, the one the
 * artefacts use.
 */
(() => {
  if (globalThis.QAWi18n) return;

  /** The languages that exist. `auto` is a choice, not a language. */
  const LANGS = ['en', 'ar'];
  const CHOICES = ['auto', 'en', 'ar'];

  /** Read before first paint, so nothing renders in the wrong direction. */
  const MIRROR_KEY = 'qaw-lang';
  /** The durable copy, so the choice follows the tester to another machine. */
  const STORE_KEY = 'qawLanguage';

  const RTL = new Set(['ar']);

  /* ─────────────────────────────────────────────────────── the current choice */

  function readMirror() {
    try {
      const stored = localStorage.getItem(MIRROR_KEY);
      return CHOICES.includes(stored) ? stored : 'auto';
    } catch {
      // A profile with site data blocked throws on access. `auto` is the right
      // answer there and needs no storage at all.
      return 'auto';
    }
  }

  function writeMirror(next) {
    try {
      localStorage.setItem(MIRROR_KEY, next);
    } catch {
      /* nothing to remember it with — it still applies for this page */
    }
  }

  /**
   * What the browser is set to, when the choice is `auto`.
   *
   * `chrome.i18n.getUILanguage()` and not `navigator.language`: the first is
   * the browser's own interface language, which is what somebody means by "the
   * language my browser is in". The second follows the page's accept-language
   * list and is routinely `en-US` on an Arabic machine.
   */
  function uiLanguage() {
    try {
      return String(chrome?.i18n?.getUILanguage?.() || navigator?.language || 'en');
    } catch {
      return 'en';
    }
  }

  const resolve = (pick) => (pick === 'en' || pick === 'ar' ? pick : (uiLanguage().toLowerCase().startsWith('ar') ? 'ar' : 'en'));

  let choice = readMirror();
  let active = resolve(choice);

  /* ────────────────────────────────────────────────────────────── the tables */

  /** Loaded tables by language code. English is always loaded, as the fallback. */
  const tables = Object.create(null);
  /** In-flight fetches, so eight callers of ready() cost one request. */
  const loading = Object.create(null);

  function url(code) {
    try {
      return chrome.runtime.getURL(`platform/i18n/${code}.json`);
    } catch {
      return `../platform/i18n/${code}.json`;
    }
  }

  async function fetchTable(code) {
    if (tables[code]) return tables[code];
    if (!loading[code]) {
      loading[code] = fetch(url(code))
        .then((res) => res.json())
        .then((json) => {
          tables[code] = json;
          return json;
        })
        .catch(() => {
          // A missing table must not take the page down with it. English keys
          // read as their own key, which is ugly and obvious, which is right:
          // a silent blank interface hides the fault.
          tables[code] = tables[code] || {};
          return tables[code];
        });
    }
    return loading[code];
  }

  /**
   * Hand a table in directly, for the tests and for anything with no `fetch`.
   *
   * The pages never call this; `tools/test-i18n.mjs` does, so the behaviour of
   * `t()` is tested against the real tables without a browser.
   */
  function load(code, json) {
    tables[code] = json;
    return json;
  }

  /**
   * Resolves when the durable choice has been reconciled and both tables are in.
   *
   * The reconciliation is awaited FIRST, and that ordering is the whole point.
   * `chrome.storage.sync` is where the choice a tester made on their other
   * machine lives, and it arrives a few milliseconds after the page has already
   * read the local mirror. A `ready()` that resolved before it landed would
   * hand the page the old language, let it paint every dynamic string, and only
   * then swap the table underneath it: the static text would flip and the tool
   * cards would not, which is the half-translated interface this whole file
   * exists to prevent.
   */
  async function ready() {
    await settled;
    await fetchTable('en');
    if (active !== 'en') await fetchTable(active);
    apply();
    return active;
  }

  /* ───────────────────────────────────────────────────────────── translation */

  const VAR = /\{(\w+)\}/g;

  /**
   * A value written as CLDR plural forms, `"one: {n} event · other: {n} events"`, is cut down to
   * the one form the count needs, so a language with six categories is not squeezed into a
   * One/Many pair. The count is `n`, or the first numeric variable. Any other value is untouched.
   */
  const FORMS = /^(zero|one|two|few|many|other): /;
  function plural(text, vars) {
    if (!FORMS.test(text)) return text;
    const n = Number(vars.count ?? vars.n ?? Object.values(vars).find((v) => Number.isFinite(Number(v)))) || 0;
    const forms = Object.fromEntries(text.split(' · ').map((p) => [p.slice(0, p.indexOf(':')).trim(), p.slice(p.indexOf(':') + 1).trim()]));
    return forms[new Intl.PluralRules(active).select(n)] ?? forms.other ?? text;
  }

  /**
   * The words for a key, with `{placeholders}` filled in.
   *
   * A missing key falls back to English and then to the key itself. It never
   * throws and never returns undefined: a label reading `popup.tools.mask.what`
   * is a bug report anybody can act on, and an empty button is not.
   */
  function t(key, vars) {
    const table = tables[active] || null;
    const en = tables.en || null;
    let text = table && key in table ? table[key] : null;
    if (text == null && en && key in en) text = en[key];
    if (text == null) text = key;
    if (!vars) return text;
    text = plural(String(text), vars);
    return String(text).replace(VAR, (whole, name) => (name in vars ? String(vars[name]) : whole));
  }

  /** Does this key exist at all, in either table. For the odd conditional label. */
  const has = (key) => Boolean((tables[active] && key in tables[active]) || (tables.en && key in tables.en));

  /**
   * axe's four impact bands as words the reader has (r9-10-1). The English id stays in the `sev-` class that
   * selects the colour; only the word drawn in the pill goes through here. Unknown input comes back as it came.
   */
  function impactWord(name) {
    switch (name) {
      case 'critical': return t('report.a11y.impactCritical');
      case 'serious': return t('report.a11y.impactSerious');
      case 'moderate': return t('report.a11y.impactModerate');
      case 'minor': return t('report.a11y.impactMinor');
      default: return String(name ?? '');
    }
  }

  /**
   * A page's own text (a title, a host, a selector, a query) wrapped in U+2068..U+2069, a first-strong bidi
   * isolate, so it keeps its own direction inside a sentence of the other one (D-219). Empty stays empty.
   */
  function iso(value) {
    const s = String(value ?? '');
    return s ? `⁨${s}⁩` : '';
  }

  const lang = () => active;
  /** The locale tag for numbers and dates: Latin digits in both languages (r2-10-4), the one tag every surface shares. */
  const numTag = () => (active === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB');
  const setting = () => choice;
  const dir = (code = active) => (RTL.has(code) ? 'rtl' : 'ltr');

  /* ──────────────────────────────────────────────────────── stamping the page */

  /**
   * `lang` and `dir` on the root element, before anything paints.
   *
   * `dir` on the document is what makes the browser mirror the whole layout,
   * which is why every stylesheet in this product is written with logical
   * properties (`margin-inline`, `inset-inline`, `text-align: start`) rather
   * than per-direction rules: one set of CSS, correct in both directions.
   */
  function stamp() {
    const root = globalThis.document?.documentElement;
    if (!root) return;
    root.lang = active;
    root.dir = dir();
    root.dataset.lang = active;
  }

  /* ────────────────────────────────────────────────── static text in the HTML */

  /**
   * Fill in every element the HTML marked with a key.
   *
   *   data-i18n              → textContent
   *   data-i18n-title        → title
   *   data-i18n-aria         → aria-label
   *   data-i18n-placeholder  → placeholder
   *
   * `textContent` and not `innerHTML`, everywhere and without exception: these
   * tables are the one place in the product where a translator's file becomes
   * an interface, and a table that can carry markup is a table that can carry
   * a script. A sentence that needs a bold run or a button in the middle of it
   * is split into its own spans in the HTML, each with its own key.
   */
  function apply(root) {
    const scope = root || globalThis.document;
    if (!scope || !scope.querySelectorAll) return;
    for (const el of scope.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of scope.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    for (const el of scope.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    for (const el of scope.querySelectorAll('[data-i18n-placeholder]')) el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  }

  /* ───────────────────────────────────────────────────────────── the switch */

  const listeners = new Set();
  /** Called after the new table is in and the static text is filled in again. */
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function announce() {
    for (const fn of listeners) {
      try {
        fn(active);
      } catch {
        /* one surface's re-render must not stop the next one's */
      }
    }
  }

  /**
   * Change language without reloading anything.
   *
   * The mirror is written first so a page opened a millisecond later is already
   * right; the durable copy follows, and `chrome.storage.onChanged` carries the
   * change to every other open surface, which re-renders through the same path
   * this one takes. Nothing here reloads a page: a settings page that reloads
   * loses the field somebody was typing in.
   */
  async function setLang(pick) {
    const next = CHOICES.includes(pick) ? pick : 'auto';
    choice = next;
    writeMirror(next);
    active = resolve(next);
    stamp();
    try {
      chrome?.storage?.sync?.set?.({ [STORE_KEY]: next });
    } catch {
      /* no sync area — the mirror is still authoritative for this machine */
    }
    await ready();
    announce();
    return active;
  }

  /** Another surface, or another machine, changed it. */
  function adopt(next) {
    const pick = CHOICES.includes(next) ? next : 'auto';
    if (pick === choice) return;
    choice = pick;
    writeMirror(pick);
    const was = active;
    active = resolve(pick);
    stamp();
    if (was === active) {
      announce();
      return;
    }
    ready().then(announce);
  }

  /* ────────────────────────────────────────────────────────────────── wiring */

  stamp();

  /**
   * The one-shot reconciliation `ready()` waits for.
   *
   * It resolves either way: a profile with no sync area, an enterprise policy
   * that disabled it, or a plain Node process running the tests all take the
   * catch branch, and the local mirror stands. What must not happen is a
   * promise that never settles, because every page's boot awaits this one.
   */
  const settled = new Promise((done) => {
    try {
      if (!chrome?.storage?.sync?.get) { done(); return; }
      // The durable copy wins over the mirror on the first load after the
      // tester set the language on another machine.
      chrome.storage.sync.get(STORE_KEY, (got) => {
        void chrome.runtime?.lastError;
        // Narrowed to a string before it is used, not because the value can
        // realistically be anything else, but because chrome.storage answers
        // `any` and the type gate reads this file.
        const stored = String(got?.[STORE_KEY] ?? "");
        if (CHOICES.includes(stored) && stored !== choice) {
          choice = stored;
          writeMirror(stored);
          active = resolve(stored);
          stamp();
        }
        done();
      });
    } catch {
      done();
    }
  });

  try {
    chrome?.storage?.onChanged?.addListener?.((changes, area) => {
      if (area !== 'sync' || !changes[STORE_KEY]) return;
      adopt(changes[STORE_KEY].newValue);
    });
  } catch {
    /* not an extension page, or storage is unavailable — the mirror stands */
  }

  globalThis.QAWi18n = { t, has, impactWord, iso, lang, numTag, setting, setLang, dir, ready, apply, onChange, load, resolve, LANGS, CHOICES };
})();
