/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The fine print: the legal and privacy surface of the page under test.
 *
 * `research/46-reel-brief.md` read a list of nineteen worries off a reel about
 * vibe-coded sites getting sued. Five of them are accessibility and this
 * product already ships all five in more depth than the list asks for. Nine are
 * legal and privacy properties of the page, and it covered none of them. Five
 * are not properties of a document at all.
 *
 * That split is the whole design of this module, and it is the part worth
 * arguing for:
 *
 *   - **What the page declares** is checked and reported as DECLARED: a policy
 *     page that exists and answers, a consent control on a form, a business
 *     address block.
 *   - **What the session saw** is reported as OBSERVED: a tracker called, a
 *     cookie written, and *when* it was written relative to the consent banner.
 *     Only an extension recording from `document_start` can answer that
 *     ordering, which is why it is here and not in a crawler.
 *   - **What the markup is ambiguous about** is a GAP, and says what a person
 *     must decide.
 *   - **What no browser can decide** — a fake review, an unsupported claim,
 *     image copyright, which law applies — is MANUAL: a question with a method,
 *     filed as a note, never a tick. Exactly the shape of the twelve guided
 *     accessibility checks, and for exactly the same reason: a tool that stays
 *     silent on the undecidable half leaves testers believing a clean scan
 *     means a compliant page.
 *
 * Nothing here decides whether a site is lawful. It says what is present, what
 * was called, and in what order. The judgement is a person's, and the document
 * says so in as many words.
 */

const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

/* ── the policy pages, in both languages ───────────────────────────────── */

/**
 * What counts as a policy page.
 *
 * Matched on the URL path *and* on the link's own words, in English and in
 * Arabic, because a Jordanian ministry site links "سياسة الخصوصية" to
 * `/Ar/Pages/Privacy.aspx` and an English-only matcher finds neither half. The
 * words are matched without diacritics or the definite article, so "سياسة
 * الخصوصية" and "سياسه خصوصيه" both land.
 */
export const POLICIES = [
  {
    id: 'privacy',
    label: 'Privacy policy',
    ar: 'سياسة الخصوصية',
    required: true,
    path: /privacy|datenschutz|confidentialite|khsosiya|khusus/i,
    words: /privacy|data protection|خصوصي|حماية البيانات|البيانات الشخصية/i,
  },
  {
    id: 'terms',
    label: 'Terms and conditions',
    ar: 'الشروط والأحكام',
    required: true,
    path: /terms|tos\b|conditions|legal|eula/i,
    words: /terms|conditions of use|user agreement|الشروط|الأحكام|اتفاقية/i,
  },
  {
    id: 'cookies',
    label: 'Cookie policy',
    ar: 'سياسة ملفات الارتباط',
    required: false,
    path: /cookie/i,
    words: /cookie|ملفات الارتباط|الكوكيز|تعريف الارتباط/i,
  },
  {
    id: 'refund',
    label: 'Refund or returns policy',
    ar: 'سياسة الاسترجاع',
    required: false,
    commerceOnly: true,
    path: /refund|returns?|cancellation|exchange/i,
    words: /refund|returns|money back|الاسترجاع|الاسترداد|الإرجاع|الإلغاء/i,
  },
];

/**
 * The template's own words, left in.
 *
 * A placeholder is worse than an absence: "123 Main Street" reads as a real
 * address to a visitor and to a presence check that only counts matches. Every
 * string here ships inside a popular template, and finding one is a GAP whatever
 * else the page says.
 */
const PLACEHOLDERS = /your company|company name here|123 main street|1234 street|info@example\.com|hello@example\.com|email@example\.com|you@example\.com|lorem ipsum|\+1 234 567|555-?0100|اسم الشركة|عنوان الشركة/i;

/** Words that mean "who we are and how to reach us", either language. */
const BUSINESS = {
  address: /\b(address|registered office|headquarters|p\.?o\.? box)\b|العنوان|المقر|ص\.?ب/i,
  registration: /\b(company (number|registration)|registration (no|number)|vat|crn|tax id)\b|السجل التجاري|الرقم الضريبي|رقم التسجيل/i,
  // Widened after three real sites. "Contact the BBC" and "Contact Mozilla"
  // are contact routes and the old matcher, anchored on "contact us", found
  // neither, so a national broadcaster was reported as offering no way to
  // reach it.
  contact: /\bcontact (us|the|our|a |form)|\b(email us|telephone|phone number|whatsapp|get in touch)\b|اتصل بنا|تواصل معنا|البريد الإلكتروني|هاتف|للتواصل/i,
};

/** Fields that ask for more than a contact form's purpose implies. */
const SENSITIVE_FIELDS = [
  { id: 'national-id', why: 'a national identity number', match: /national ?id|nid\b|id ?number|رقم وطني|الرقم الوطني|هوية/i },
  { id: 'passport', why: 'a passport number', match: /passport|جواز/i },
  { id: 'birthdate', why: 'a date of birth', match: /birth ?date|date ?of ?birth|dob\b|تاريخ الميلاد|الميلاد/i },
  { id: 'gender', why: 'gender', match: /\bgender\b|\bsex\b|الجنس|النوع الاجتماعي/i },
  { id: 'card', why: 'payment card details', match: /card ?number|cvv|cvc|expiry|بطاقة|رقم البطاقة/i },
  { id: 'health', why: 'health information', match: /health|medical|diagnos|blood|صحة|طبي|تشخيص/i },
  { id: 'religion', why: 'religion', match: /religion|الديانة|الدين/i },
  { id: 'salary', why: 'income', match: /salary|income|wage|الراتب|الدخل/i },
];

/**
 * Reel 2's placeholder list, widened to the whole page.
 *
 * `PLACEHOLDERS` above is the same match scoped to the business-details block,
 * where a leftover "123 Main Street" is a legal exposure. This one is the
 * hygiene surface's version of the question, and the difference in what it
 * *means* is the reason there are two: a `Lorem ipsum` in a hero section is a
 * site that is not finished, not a site that is breaking a law, and the report
 * must not let the two sound alike.
 */
const PAGE_PLACEHOLDERS = /lorem ipsum|your company|company name here|123 main street|1234 street|info@example\.com|hello@example\.com|you@example\.com|\bexample\.com\b|\bTODO\b|coming soon|placeholder|\[your [a-z ]+\]|اسم الشركة|عنوان الشركة/i;

/** The framework's own title, still in the tab. */
const STARTER_TITLES = /^(react app|create next app|vite \+ react|vite app|next\.?js|document|untitled|my app|new project|svelte app|nuxt app|astro)$/i;

/**
 * What a privacy policy has to actually say, on top of existing.
 *
 * `research/52-reel-3-brief.md` sharpened reel 1's single "is there a policy"
 * into three questions about the policy's *text*: does it admit collecting
 * data, does it mention AI, does it name the third parties it shares with.
 * Each of these is a keyword pass and each is honest only as far as a keyword
 * pass goes — a policy that says the words is DECLARED, never "adequate". The
 * brief is explicit that whether the disclosure is *sufficient* is a legal
 * reading no crawl can make, and every row below says so in its own words.
 */
export const POLICY_DISCLOSURES = [
  {
    id: 'collection',
    label: 'Says it collects personal data',
    ar: 'يذكر جمع البيانات الشخصية',
    match: /\b(we|the (site|company|service))\s+(collect|gather|process|store|obtain)|personal (data|information)\s+(we|is|are)\s+(collect|gather|process)|information we collect|data we collect|نجمع|جمع البيانات|البيانات التي نجمعها/i,
    why: 'A policy that never says what it collects tells the reader nothing they could act on.',
  },
  {
    id: 'ai',
    label: 'Mentions automated or AI processing',
    ar: 'يذكر المعالجة الآلية أو الذكاء الاصطناعي',
    // Deliberately no vendor names. Naming model providers in a matcher would
    // put their hostnames in the package, and `tools/test-independent.mjs`
    // holds this product to calling no external model service at runtime; a
    // string in a regex is indistinguishable from a call to a scanner reading
    // the shipped files, and the invariant is worth more than the extra hit.
    // A policy that names a provider and never says "AI" is rare enough to
    // live in the row's own wording instead.
    match: /\bA\.?I\.?\b|artificial intelligence|machine learning|large language model|\bLLM\b|generative|chatbot|automated decision|automated processing|model provider|الذكاء الاصطناعي|المعالجة الآلية|التعلم الآلي|روبوت محادثة/i,
    why: 'Where a site sends what a visitor typed to a model, the policy is the only place the visitor could learn it. This matches the language rather than any provider\'s name, so a policy that names a vendor and never uses the words needs a person\'s read. AI-disclosure duties are still moving and differ by jurisdiction, which is why this is a presence check and not a verdict.',
  },
  {
    id: 'third-parties',
    label: 'Names who it shares data with',
    ar: 'يسمّي الجهات التي تشارك معها البيانات',
    match: /third[- ]part(y|ies)|sub-?processor|service provider|we share|shared with|disclose (it |your data |information )?to|أطراف ثالثة|طرف ثالث|مزودي الخدمة|نشارك/i,
    why: 'Reel 1 asked who the page calls; this asks whether the policy admits to any of them. The two together are the only pair that produces a real GAP.',
  },
];

/** Words on or beside a control that make it a consent control. */
const CONSENT_WORDS = /consent|i agree|agree to|accept the|privacy|terms|opt.?in|subscribe|marketing|أوافق|الموافقة|الشروط|الخصوصية/i;

/* ── helpers ───────────────────────────────────────────────────────────── */

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
const pathOf = (url) => { try { return new URL(url).pathname; } catch { return String(url || ''); } };

/** Arabic without its diacritics, so one spelling matches its variants. */
export const flatten = (text) => String(text ?? '')
  .replace(/[ً-ْٰ]/g, '')
  .replace(/[آأإ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ')
  .trim();

const same = (a, b) => {
  const x = hostOf(a);
  const y = hostOf(b);
  if (!x || !y) return false;
  const root = (h) => h.split('.').slice(-2).join('.');
  return x === y || root(x) === root(y);
};

/** Is this host on the list, by suffix? */
export function classifyHost(host, catalogue) {
  const h = String(host || '').toLowerCase();
  if (!h) return null;
  for (const [id, group] of Object.entries(catalogue?.categories || {})) {
    if (group.hosts.some((known) => h === known || h.endsWith(`.${known}`))) {
      return { category: id, label: group.label, why: group.why };
    }
  }
  return null;
}

/**
 * Where something was found, when it was not the top document.
 *
 * ── why every row needs this ─────────────────────────────────────────────
 *
 * These checks used to be asked of one document, and on 7 September 2026 that
 * document was four words of chrome around a cross-origin iframe. The tool
 * reported no privacy policy, no terms, no cookie policy and no business
 * details for a page whose footer carried all four, and nothing in its output
 * said which document it had read.
 *
 * The input now carries links, forms and text from every frame, each stamped
 * with the document it came from. A row that finds a policy in an embedded
 * document has answered the question a visitor actually has — can I reach this
 * from here — and it says where, because "there is a privacy policy" and
 * "there is a privacy policy inside the payment widget" are different facts and
 * a reader is owed the second one.
 *
 * Empty string when it was the top document, so a single-frame page reads
 * exactly as it always did.
 */
export function inFrame(item) {
  const url = item && typeof item === 'object' ? item.frameUrl : null;
  return url ? ` Found in the embedded document ${url}.` : '';
}

/** "3 frames", or "1 frame". The same words the popup and the report use. */
export function describeScannedFrames(frames) {
  const n = Array.isArray(frames) ? frames.length : Number(frames) || 1;
  return n === 1 ? '1 frame' : `${n} frames`;
}

/* ── the checks ────────────────────────────────────────────────────────── */

/** 1, 2, 3, 5: is each policy page linked, and did it answer? */
export function policyChecks({ links = [], commerce = false } = {}) {
  return POLICIES.filter((p) => !p.commerceOnly || commerce).map((policy) => {
    const hit = links.find((l) => policy.path.test(pathOf(l.href || '')) || policy.words.test(flatten(l.text || '')));
    if (!hit) {
      return {
        id: `policy-${policy.id}`,
        title: `${policy.label} · ${policy.ar}`,
        status: policy.required ? 'GAP' : 'GAP',
        detail: `No link in any frame of this page matches a ${policy.label.toLowerCase()}, in English or Arabic. ${policy.required ? 'Most jurisdictions require one to be reachable from every page.' : 'Expected on a site that takes payment.'}`,
      };
    }
    // The link check already fetched it, so whether it answers is known.
    // A link that 404s is a GAP, not an observation: the page declares a policy
    // and the site does not have one, which is the disagreement GAP names.
    const broken = hit.status && hit.status >= 400;
    return {
      id: `policy-${policy.id}`,
      title: `${policy.label} · ${policy.ar}`,
      status: broken ? 'GAP' : 'DECLARED',
      detail: broken
        ? `"${hit.text || hit.href}" is linked but answered ${hit.status}. A policy nobody can open is not a policy.${inFrame(hit)}`
        : `Linked as "${hit.text || hit.href}"${hit.status ? ` and answered ${hit.status}` : ''}.${inFrame(hit)}`,
      href: hit.href,
      frameUrl: hit.frameUrl || null,
    };
  });
}

/**
 * 4: was consent asked for before anything non-essential was written?
 *
 * The ordering is the finding, and it is the one thing only this extension can
 * see: the recorder is at `document_start`, so the first cookie and the first
 * storage write are both timed against the moment a consent banner appeared.
 * A banner that appears *after* the third-party cookie is set is the single
 * most common failure on this list, and it is invisible to a crawler.
 */
export function consentChecks({ events = [], consentSeenAt = null, firstPartyHost = '' } = {}) {
  const writes = events
    .filter((e) => e.kind === 'cookie' || e.kind === 'storage')
    .filter((e) => !e.essential)
    .sort((a, b) => a.ts - b.ts);
  const nonEssential = writes.filter((e) => e.thirdParty || !same(e.url || e.host || '', firstPartyHost) || e.category === 'analytics');

  if (!consentSeenAt) {
    return [{
      id: 'consent-banner',
      title: 'Cookie consent before any non-essential cookie',
      status: nonEssential.length ? 'OBSERVED' : 'GAP',
      detail: nonEssential.length
        ? `${plural(nonEssential.length, 'non-essential write')} were recorded and no consent banner was seen in this session. The first was ${nonEssential[0].name || nonEssential[0].key || 'a cookie'} at +${Math.round((nonEssential[0].ts - (events[0]?.ts ?? nonEssential[0].ts)) / 1000)}s.`
        : 'No consent banner was seen, and nothing non-essential was written either. Walk the page again with cookies cleared to be sure.',
    }];
  }

  const early = nonEssential.filter((e) => e.ts < consentSeenAt);
  return [{
    id: 'consent-banner',
    title: 'Cookie consent before any non-essential cookie',
    status: early.length ? 'OBSERVED' : 'DECLARED',
    detail: early.length
      ? `${plural(early.length, 'non-essential write')} happened before the consent banner appeared: ${early.slice(0, 4).map((e) => e.name || e.key || e.host || 'unnamed').join(', ')}. Consent asked after the fact is not consent.`
      : 'The consent banner appeared before anything non-essential was written.',
  }];
}

/** 6 and 7: consent on the form, and whether it asks for more than it needs. */
export function formChecks({ forms = [] } = {}) {
  const out = [];
  forms.forEach((form, i) => {
    const name = form.name || `form ${i + 1}`;
    const personal = form.fields.filter((f) => /email|phone|tel|name|address|mobile|بريد|هاتف|اسم|عنوان/i.test(`${f.label} ${f.name} ${f.type}`));
    if (!personal.length) return;

    const consent = form.fields.find((f) => f.type === 'checkbox' && CONSENT_WORDS.test(flatten(`${f.label} ${f.name}`)));
    const statement = CONSENT_WORDS.test(flatten(form.consentText || ''));
    out.push({
      id: `form-consent-${i + 1}`,
      title: `Consent on "${name}"`,
      status: consent ? (consent.checked ? 'OBSERVED' : 'DECLARED') : statement ? 'DECLARED' : 'GAP',
      detail: consent
        ? consent.checked
          ? `"${consent.label || consent.name}" is a consent box and it is ticked by default. Pre-ticked consent is not consent under GDPR Article 7.`
          : `"${consent.label || consent.name}" is an unticked consent box beside ${plural(personal.length, 'personal field')}.`
        : statement
          ? `No checkbox, but the form carries a consent statement near its submit.`
          : `${plural(personal.length, 'personal field')} are collected and no consent control or statement was found on the form.`,
    });

    const asking = form.fields
      .map((f) => ({ field: f, hit: SENSITIVE_FIELDS.find((s) => s.match.test(flatten(`${f.label} ${f.name} ${f.id}`))) }))
      .filter((x) => x.hit);
    if (asking.length) {
      out.push({
        id: `form-minimisation-${i + 1}`,
        title: `Only what "${name}" needs`,
        status: 'GAP',
        detail: `This form asks for ${asking.map((x) => x.hit.why).join(', ')}. Whether each is necessary for what the form is for is a decision, not a measurement: GDPR Article 5(1)(c) asks for the minimum, and only the owner knows the purpose. Flagged, not judged.`,
      });
    }
  });
  return out;
}

/** 8 and 9: who else the page called, and who it embedded. */
export function trackingChecks({ requests = [], frames = [], firstPartyHost = '', catalogue = {} } = {}) {
  const seen = new Map();
  for (const req of requests) {
    const host = hostOf(req.url);
    if (!host || same(req.url, firstPartyHost)) continue;
    const known = classifyHost(host, catalogue);
    const row = seen.get(host) || { host, count: 0, ...(known || { category: 'other', label: 'Another company', why: 'A request to a host that is not this site.' }) };
    row.count += 1;
    seen.set(host, row);
  }
  const third = [...seen.values()].sort((a, b) => b.count - a.count);
  const tracking = third.filter((t) => t.category === 'analytics' || t.category === 'advertising');
  const out = [];

  out.push({
    id: 'tracking',
    title: 'Tracking and analytics',
    status: tracking.length ? 'OBSERVED' : 'DECLARED',
    detail: tracking.length
      ? `${plural(tracking.length, 'tracking host')} ${tracking.length === 1 ? 'was' : 'were'} called: ${tracking.map((t) => `${t.host} (${t.label.toLowerCase()})`).join(', ')}. Each one needs consent before it runs and a line in the privacy policy.`
      : 'No known analytics or advertising host was called in this session.',
  });

  const embeds = frames.filter((f) => f.url && !same(f.url, firstPartyHost));
  out.push({
    id: 'third-party',
    title: 'Third-party embeds and requests',
    status: third.length || embeds.length ? 'OBSERVED' : 'DECLARED',
    detail: third.length || embeds.length
      ? `This page loads from ${plural(third.length, 'other host')}${embeds.length ? ` and embeds ${plural(embeds.length, 'frame')} from elsewhere` : ''}: ${third.slice(0, 8).map((t) => t.host).join(', ')}${third.length > 8 ? ', and others' : ''}.`
      : 'Everything this page loaded came from its own site.',
  });
  return out;
}

/** 17: is there a real business behind the site, as far as the page says? */
export function businessChecks({ text = '' } = {}) {
  const flat = flatten(text);
  const found = Object.entries(BUSINESS).filter(([, re]) => re.test(flat)).map(([k]) => k);
  const missing = Object.keys(BUSINESS).filter((k) => !found.includes(k));
  const placeholder = flat.match(PLACEHOLDERS);
  return [{
    id: 'business-details',
    title: 'Real business details · بيانات الجهة',
    status: placeholder || missing.length ? 'GAP' : 'DECLARED',
    detail: placeholder
      ? `The template's own words are still on the page: "${placeholder[0]}". A placeholder reads as a real detail to a visitor, which makes it worse than an absence.`
      : missing.length
        ? `Found ${found.length ? found.join(' and ') : 'none of the three'}; nothing on the page matches ${missing.join(' or ')}. Whether the details are *true* is not something a page can be asked.`
        : 'An address, a registration number and a contact route are all present on the page.',
  }];
}

/* ── reel 3: what the policy actually says ─────────────────────────────── */

/**
 * Reel 3's items 2, 3 and 4: the policy exists, but does it say the things.
 *
 * Read only when the page in front of the tester *is* a policy page, and the
 * check says so plainly when it is not. That restraint is the whole design:
 * this extension reads the page a person walked to, not a crawl of the site,
 * so a keyword pass over the home page's text would answer a question nobody
 * asked and answer it wrong. A tester who wants these three rows opens the
 * privacy policy and presses the button again, which is one instruction and
 * costs a scan nothing.
 *
 * The third row is the only one that can produce a real GAP rather than a
 * presence check, and it is the one worth having: the session already knows
 * which other companies the site called, so "the policy names nobody and the
 * page called nine hosts" is a subtraction rather than a reading exercise.
 */
export function policyContentChecks({ text = '', url = '', title = '', requests = [], firstPartyHost = '', catalogue = {} } = {}) {
  const onPolicy = POLICIES.some((p) => p.path.test(pathOf(url)) || p.words.test(flatten(`${title} ${String(text).slice(0, 400)}`)));
  if (!onPolicy) {
    return [{
      id: 'policy-text',
      title: 'What the privacy policy says · ماذا تقول سياسة الخصوصية',
      status: 'MANUAL',
      pending: true,
      detail: 'Not read: this page is not a policy page. Open the privacy policy and press the button again, and the three disclosure rows are answered from its own words rather than guessed from somewhere else.',
    }];
  }

  const flat = flatten(text);
  const out = POLICY_DISCLOSURES.map((d) => ({
    id: `policy-text-${d.id}`,
    title: `${d.label} · ${d.ar}`,
    status: d.match.test(flat) ? 'DECLARED' : 'GAP',
    detail: d.match.test(flat)
      ? `The policy text says so. Whether what it says is accurate and sufficient for what this site actually does is a legal reading, and a keyword pass is not one. ${d.why}`
      : `Nothing in this policy's text matches ${d.label.toLowerCase()}, in English or Arabic. ${d.why}`,
  }));

  // The one subtraction on this list. Reel 1 asked who the page called; this
  // asks whether the policy admits to any of them, and the disagreement is the
  // finding rather than either half alone.
  const hosts = [...new Set(requests.map((r) => hostOf(r.url)).filter((h) => h && !same(`https://${h}`, firstPartyHost)))];
  const named = hosts.filter((h) => {
    const known = classifyHost(h, catalogue);
    const root = h.split('.').slice(-2)[0];
    return flat.includes(h) || (root && root.length > 3 && flat.toLowerCase().includes(root.toLowerCase()))
      || (known && flat.toLowerCase().includes(known.label.toLowerCase()));
  });
  const unnamed = hosts.filter((h) => !named.includes(h));
  if (hosts.length) {
    out.push({
      id: 'policy-text-coverage',
      title: 'The policy against who the page called · مطابقة السياسة بما استُدعي فعلا',
      status: unnamed.length ? 'GAP' : 'DECLARED',
      detail: unnamed.length
        ? `This session saw ${plural(hosts.length, 'other host')} contacted and the policy names ${named.length}. Unnamed: ${unnamed.slice(0, 6).join(', ')}${unnamed.length > 6 ? ', and others' : ''}. A processor a policy does not name is one a visitor could not have agreed to.`
        : `Every one of the ${plural(hosts.length, 'other host')} this session saw is named somewhere in the policy text.`,
    });
  }
  return out;
}

/* ── reel 2: is the thing finished ─────────────────────────────────────── */

/**
 * Group D of the skill: site hygiene, and none of it a legal matter.
 *
 * `research/48-reel-2-brief.md` counted fourteen of its twenty items as
 * machine-checkable and named three that this codebase already measures and
 * never reports: broken links (`content/links.js`), image weight
 * (`content/vitals.js`) and viewport overflow (`content/rtl-stress.js`, wired
 * only to the RTL stress mode). Those three keep their existing homes and are
 * cited here rather than measured a second time — the same rule that keeps
 * accessibility delegated, for the same reason: two checkers of one property
 * eventually disagree, and then the report is an argument.
 *
 * The rest are answered from `page.hygiene`, which `content/spec-reader.js`
 * measures, plus the link set and the page text this module already receives.
 * Where the DOM pass has not run, a row says so instead of guessing, because
 * "not measured" and "measured and clean" are different answers and a tester
 * who cannot tell them apart is worse off than one with no row at all.
 *
 * **The vocabulary shifts by one degree here and the skill says why.** On the
 * legal surface DECLARED comes from the page: a policy claims something. A
 * favicon promises nothing, so on this surface DECLARED is the convention and
 * a GAP is what was observed measured against it. Where the expectation is not
 * objective, the item is MANUAL and carries no tick.
 */
export function hygieneChecks({ page = null, links = [], text = '', url = '' } = {}) {
  const h = page?.hygiene && !page.hygiene.error ? page.hygiene : null;
  const out = [];
  const flat = flatten(text);

  /* H7: links that never leave the page. A status check never sees these,
   * because they never make a request. Computable from the link set alone, so
   * it answers whether or not the DOM pass ran. */
  const dead = h?.deadLinks?.length
    ? h.deadLinks
    : links
      .map((l) => {
        const raw = String(l.href || '').trim();
        const here = String(url || '').split('#')[0];
        const why = !raw ? 'no href at all'
          : /^javascript:\s*(void\s*\(\s*0\s*\)|;)?\s*$/i.test(raw) ? 'a javascript: no-op'
            : raw === '#' || (here && raw === `${here}#`) ? 'href="#", which goes nowhere' : '';
        return why ? { text: l.text || '', href: raw, why, frameUrl: l.frameUrl || null, inFooter: false, inNav: false } : null;
      })
      .filter(Boolean);
  out.push({
    id: 'dead-links',
    title: 'Links that go nowhere · روابط لا تؤدي إلى شيء',
    surface: 'hygiene',
    status: dead.length ? 'GAP' : 'DECLARED',
    detail: dead.length
      ? `${plural(dead.length, 'link')} on this page never leave it: ${dead.slice(0, 5).map((d) => `"${d.text || d.href || 'unnamed'}" (${d.why})${d.frameUrl ? ` in ${d.frameUrl}` : ''}`).join('; ')}. A status check finds none of these, because they never make a request. Broken links that do answer are counted by "Check the links".`
      : 'Every link on this page has a destination. Whether each one answers is "Check the links", which is not repeated here.',
  });

  /* H14 and H9: the template's own words, and the year in the footer. Both
   * readable from the page text, which this module already receives. */
  const placeholders = h?.placeholders?.length ? h.placeholders : (flat.match(new RegExp(PAGE_PLACEHOLDERS.source, 'gi')) || []);
  out.push({
    id: 'placeholder-text',
    title: 'Placeholder text · نصوص نائبة',
    surface: 'hygiene',
    status: placeholders.length ? 'GAP' : 'DECLARED',
    detail: placeholders.length
      ? `The template's own words are still on the page: ${[...new Set(placeholders)].slice(0, 5).map((p) => `"${String(p).trim()}"`).join(', ')}. This is a site that is not finished, not a site that is breaking a law, and the difference matters when this report is read by someone who is not a lawyer.`
      : 'No lorem ipsum, no "Your Company", no example.com address in the page text.',
  });

  const cr = h?.copyright?.found ? h.copyright : (() => {
    const m = flat.match(/(?:©|\(c\)|copyright|جميع الحقوق)\s*([12]\d{3})(?:\s*[–—-]\s*([12]\d{3}))?/i);
    return m ? { found: true, text: m[0].trim(), start: Number(m[1]), last: Number(m[2] || m[1]), now: new Date().getFullYear() } : { found: false };
  })();
  out.push({
    id: 'copyright-year',
    title: 'Copyright year · سنة حقوق النشر',
    surface: 'hygiene',
    status: !cr.found ? 'MANUAL' : cr.last < cr.now ? 'GAP' : 'DECLARED',
    detail: !cr.found
      ? 'No copyright notice was found in this page\'s text. Copyright subsists without a notice under the Berne Convention, so an absent one breaks no rule. It is a credibility signal and nothing more.'
      : cr.last < cr.now
        ? `The notice reads "${cr.text}" and the year is ${cr.now}. Stale, and objectively so. Whether the start year of a range is right is a fact about the business, not about the page.`
        : `"${cr.text}" is current.`,
  });

  if (!h) {
    // Everything below needs the DOM pass, and saying that once is better than
    // nine rows that each pretend the answer is "clean".
    out.push({
      id: 'hygiene-page-pass',
      title: 'Favicon, title, overflow, logo and contacts · فحص الصفحة',
      surface: 'hygiene',
      status: 'MANUAL',
      pending: true,
      detail: page?.hygiene?.error
        ? `The page pass failed on this document: ${page.hygiene.error}. The rows it feeds are not shown rather than shown empty.`
        : 'Not measured on this session: the page reader did not run, so the favicon, the page title, sideways scroll, the clickable logo and the phone and email rows have no measurement behind them. They are left out rather than shown clean.',
    });
    return out;
  }

  /* H4, H5, H6: page identity. */
  out.push({
    id: 'favicon',
    title: 'Favicon · أيقونة الموقع',
    surface: 'hygiene',
    status: h.favicon.declared ? 'DECLARED' : 'GAP',
    detail: h.favicon.declared
      ? `Declared as ${h.favicon.rel || 'icon'}: ${h.favicon.href}. Whether it answers 200 is for "Check the links", which fetches it with everything else.`
      : 'No icon link in the head. Browsers will try /favicon.ico and show a blank page tile if that fails too. A convention, not a standard.',
  });
  out.push({
    id: 'page-title',
    title: 'Page title · عنوان الصفحة',
    surface: 'hygiene',
    status: h.titleEmpty || h.titleStarter ? 'GAP' : 'DECLARED',
    detail: h.titleEmpty
      ? 'This page has no title. It is the tab label, the bookmark name and the first line of every search result.'
      : h.titleStarter
        ? `The title is still the framework's: "${h.title}". Whether it is unique across the site needs the link set and is not answered from one page.`
        : `"${h.title}". Uniqueness across pages is a crawl question and is not answered here.`,
  });
  out.push({
    id: 'meta-description',
    title: 'Meta description · وصف الصفحة',
    surface: 'hygiene',
    status: h.metaDescription ? 'DECLARED' : 'GAP',
    detail: h.metaDescription
      ? `Present, ${h.metaDescription.length} characters. Whether it is byte-identical to every other page is a crawl question.`
      : 'No meta description. This is a search-engine convention and no standard requires it, which is why it is reported here and not among the legal rows.',
  });

  /* H1 and H16: sideways scroll. */
  const o = h.overflow;
  out.push({
    id: 'horizontal-scroll',
    title: 'Sideways scroll · التمرير الأفقي',
    surface: 'hygiene',
    status: o.over ? 'GAP' : 'DECLARED',
    detail: o.over
      ? `The document is ${o.scrollWidth}px wide inside a ${o.clientWidth}px viewport. Widest offender: ${o.offenders.slice(0, 3).map((f) => `<${f.tag}${f.id ? `#${f.id}` : ''}> overhanging ${f.overhang}px${f.clips ? ', clipped rather than scrollable' : ''}`).join('; ') || 'not resolved to an element'}. This also touches WCAG 1.4.10 Reflow, which the accessibility engine does not test. Measured at this window only; "Check another size" sweeps the phone widths.`
      : `Nothing overhangs at ${o.clientWidth}px. Narrower viewports are "Check another size", not this row.`,
  });

  /* H17, H18, H19. */
  const lg = h.logo;
  out.push({
    id: 'clickable-logo',
    title: 'The logo goes home · الشعار يعود للرئيسية',
    surface: 'hygiene',
    status: !lg.found ? 'MANUAL' : lg.home ? 'DECLARED' : 'GAP',
    detail: !lg.found
      ? 'No header logo was found to test. Which mark is the logo is a judgement, so an absent one is a question rather than a failure.'
      : lg.home
        ? 'The header logo is inside a link to the site root, which is where every visitor expects it to go.'
        : lg.linked
          ? `The header logo links to ${lg.href}, not the site root. A convention rather than a standard, but the check is exact.`
          : `The header logo is not inside a link${lg.clickHandlerOnly ? ' and reacts to a click handler instead, which fails here and again in the accessibility audit' : ''}.`,
  });
  const c = h.contacts;
  out.push({
    id: 'clickable-contacts',
    title: 'Phone and email are pressable · الهاتف والبريد قابلان للنقر',
    surface: 'hygiene',
    status: c.mismatched.length ? 'GAP' : (c.plainPhones.length || c.plainMails.length) ? 'GAP' : 'DECLARED',
    detail: c.mismatched.length
      ? `${plural(c.mismatched.length, 'link')} ${c.mismatched.length === 1 ? 'shows' : 'show'} one address and ${c.mismatched.length === 1 ? 'sends' : 'send'} to another: ${c.mismatched.slice(0, 3).map((m) => `"${m.shown}" goes to ${m.href}`).join('; ')}. This is worse than plain text, because it sends the message somewhere the reader never agreed to.`
      : (c.plainPhones.length || c.plainMails.length)
        ? `On screen but not pressable: ${[...c.plainPhones.slice(0, 3), ...c.plainMails.slice(0, 3)].join(', ')}. On a phone, a number that is not a tel: link is a number nobody rings.`
        : `${plural(c.tel, 'tel: link')} and ${plural(c.mailto, 'mailto: link')}, and nothing on screen that should be one and is not.`,
  });
  return out;
}

/* ── reel 4: the security surface a page can answer for itself ─────────── */

/**
 * `research/53-reel-4-brief.md`, in the nine of twenty that a rendered page can
 * answer without probing anybody's server.
 *
 * The brief's real contribution is a third category this module had not needed
 * before. Beyond "machine-checkable" and "delegate", three of its twenty items
 * — keys in git history, database access rules, a cloud billing cap — are not
 * properties of the deployed site at all. No cleverness in a browser reaches
 * them, and the fix is different in kind from MANUAL: MANUAL means a person
 * reads what was already fetched; this means the right thing was never
 * fetched. They are filed as questions with a named tool, below.
 *
 * Four more (6 to 9: permissions, input sanitising, XSS, SQL injection) need
 * payloads sent at somebody's live site. This product does not do that and
 * this round did not decide to start. Sending adversarial traffic at a third
 * party is a different kind of act from reading what it already serves, and it
 * belongs behind an explicit opt-in scoped to sites the tester owns, on a
 * dedicated scanner, not on a hand-rolled payload list bolted to a QA popup.
 */
/**
 * The six response headers the session now captures, folded per document.
 *
 * `responses` is what `background/security-headers.js` saw: one entry per
 * response that carried at least one of the six, each with the request type the
 * browser gave it. The document's own response is the one every row below is
 * about, so it is found by URL first and by `main_frame` second, and a row that
 * cannot find it says "not measured" rather than "absent". Those are different
 * answers and this module's whole discipline is not to confuse them.
 */
function headersOf(responses, url) {
  const list = Array.isArray(responses) ? responses : [];
  const bare = String(url || '').split('#')[0];
  const origin = (u) => { try { return new URL(u).origin; } catch { return ''; } };
  // r4-01-1: only this URL's own response, or the latest main_frame of this origin. Anything else (a CORS fetch, another site's frame) is "not measured", never a gap.
  const latest = (rows) => rows.reduce((a, r) => (!a || (r.ts ?? 0) >= (a.ts ?? 0) ? r : a), null);
  const doc = latest(list.filter((r) => String(r.url || '').split('#')[0] === bare))
    || (origin(bare) && latest(list.filter((r) => r.type === 'main_frame' && origin(r.url) === origin(bare))));
  return doc ? { headers: doc.headers || {} } : null;
}

export function securityChecks({ page = null, url = '', requests = [], events = [], responses = [] } = {}) {
  const seen = headersOf(responses, url);
  const h = page?.hygiene?.security && !page.hygiene.error ? page.hygiene.security : null;
  const out = [];
  const https = url ? /^https:/i.test(url) : h?.https ?? null;

  /* 16: HTTPS, and the subresources that undo it. */
  const mixed = https ? [...new Set(requests.map((r) => String(r.url || '')).filter((u) => /^http:\/\//i.test(u)))] : [];
  out.push({
    id: 'https',
    title: 'HTTPS, all the way down · التشفير',
    surface: 'security',
    status: https === null ? 'MANUAL' : !https ? 'GAP' : mixed.length ? 'GAP' : 'DECLARED',
    detail: https === null
      ? 'No URL was recorded for this session, so the scheme could not be read.'
      : !https
        ? `This page was served over plain http.${h?.passwordOverHttp ? ' It also carries a password field, which is the one item on this list a person can see without any tooling.' : ''} Everything typed into it crosses the network in the clear.`
        : mixed.length
          ? `Served over https, and ${plural(mixed.length, 'subresource')} were fetched over plain http: ${mixed.slice(0, 4).map(hostOf).join(', ')}. A padlock over mixed content is a padlock that is not doing anything.`
          : 'Served over https, and every request this session recorded used it too. Whether that is enforced for the next visit is the HSTS row below.',
  });

  /* 1: keys that should never have reached a browser. */
  const urlSecrets = [...new Set(requests
    .map((r) => String(r.url || ''))
    .filter((u) => /[?&](api_?key|access_?token|auth|secret|password|signature)=[^&]{12,}/i.test(u))
    .map(hostOf)
    .filter(Boolean))];
  const inPage = h?.secrets || [];
  out.push({
    id: 'exposed-secrets',
    title: 'Keys that reached the browser · مفاتيح مكشوفة',
    surface: 'security',
    status: inPage.length || urlSecrets.length ? 'OBSERVED' : h ? 'DECLARED' : 'MANUAL',
    detail: inPage.length || urlSecrets.length
      ? `${[inPage.length ? `The page source carries ${inPage.map((s) => s.why).join(', ')}` : '', urlSecrets.length ? `${plural(urlSecrets.length, 'host')} were called with a key or token in the query string: ${urlSecrets.slice(0, 4).join(', ')}` : ''].filter(Boolean).join('. ')}. Anything a browser can read, a visitor can read. Treat every one of these as already leaked and rotate it. Whether the same keys are in the repository's history is a different tool's question, below.`
      : h
        ? 'No key-shaped string in the page source, and no token in a request query string. The match is prefix-anchored on purpose: a bare hex string is a cache buster far more often than a secret, and a check that cries wolf gets turned off.'
        : 'Not measured: the page reader did not run, so only the request stream was searched and the page source was not.',
  });

  /* 18, in the half a session sees. */
  const cookies = events.filter((e) => e.kind === 'cookie');
  // Only the unambiguous fault triggers this row.
  //
  // The first version flagged any cookie missing any one of Secure, HttpOnly
  // and SameSite, and on a real news front page it reported 33 of 33, which is
  // a row nobody reads twice. HttpOnly is wrong for a cookie the page's own
  // scripts must read, and `SameSite=None` with `Secure` is a legitimate
  // cross-site cookie rather than a fault. What is never defensible is a
  // cookie without `Secure` on a page served over https, and a cookie with no
  // SameSite attribute at all. The rest is counted and mentioned, not accused.
  const noSecure = cookies.filter((e) => e.secure === false && https !== false);
  const noSameSite = cookies.filter((e) => e.sameSite === '' || e.sameSite === null || e.sameSite === undefined);
  const noHttpOnly = cookies.filter((e) => e.httpOnly === false);
  const insecure = [...new Set([...noSecure, ...noSameSite])];
  out.push({
    id: 'cookie-flags',
    title: 'Cookie flags · خصائص الكوكيز',
    surface: 'security',
    status: !cookies.length ? 'MANUAL' : insecure.length ? 'OBSERVED' : 'DECLARED',
    detail: !cookies.length
      ? 'No cookie was recorded in this session, so there were no flags to read. Walk the page again with cookies cleared before concluding anything from that.'
      : insecure.length
        ? `${plural(insecure.length, 'cookie')} of ${cookies.length} ${insecure.length === 1 ? 'was' : 'were'} written ${noSecure.length ? `without Secure over https (${noSecure.slice(0, 3).map((e) => e.name || e.key || 'unnamed').join(', ')})` : ''}${noSecure.length && noSameSite.length ? ', and ' : ''}${noSameSite.length ? `with no SameSite attribute (${noSameSite.slice(0, 3).map((e) => e.name || e.key || 'unnamed').join(', ')})` : ''}. ${noHttpOnly.length} of them ${noHttpOnly.length === 1 ? 'is' : 'are'} readable by the page's own scripts, which is a fault only where the script has no business reading them.`
        : `All ${plural(cookies.length, 'cookie')} recorded in this session carry Secure and a SameSite value. Whether each also needs HttpOnly depends on whether the page's own scripts read it, and ${noHttpOnly.length} of them ${noHttpOnly.length === 1 ? 'is' : 'are'} readable.`,
  });

  /* 14, in the half that is visible in markup. */
  if (h) {
    out.push({
      id: 'csrf-token',
      title: 'Anti-forgery tokens on forms · حماية من تزوير الطلبات',
      surface: 'security',
      status: !h.postForms ? 'DECLARED' : h.tokenedForms >= h.postForms ? 'DECLARED' : 'MANUAL',
      detail: !h.postForms
        ? 'No form on this page posts, so there is nothing here to forge.'
        : h.tokenedForms >= h.postForms
          ? `Every one of the ${plural(h.postForms, 'posting form')} carries a hidden token field.`
          : `${h.postForms - h.tokenedForms} of ${plural(h.postForms, 'posting form')} ${h.postForms - h.tokenedForms === 1 ? 'carries' : 'carry'} no hidden token field. This is not proof of a hole: a framework may send the token as a header instead, which a DOM walk cannot see. It is a question for whoever wrote the form, not a finding.`,
    });
    if (h.insecureForms.length) {
      out.push({
        id: 'form-over-http',
        title: 'A form that posts over plain http · نموذج غير مشفّر',
        surface: 'security',
        status: 'OBSERVED',
        detail: `${plural(h.insecureForms.length, 'form')} post to an http: address: ${h.insecureForms.slice(0, 3).map((f) => f.action).join(', ')}. The page being https does not help; the submission is the part that travels.`,
      });
    }
  }

  /*
   * ── the six response headers, measured ─────────────────────────────────
   *
   * Until 8 September 2026 these were one MANUAL entry reading "read them with
   * curl -I". They are the rows a reviewer asks for first and the only ones on
   * this list a browser could always have answered; nothing was capturing a
   * response header, so nothing could. Decision 33 fixed the capture; these
   * rows are what it was for.
   *
   * Every one of them distinguishes three states, and the distinction is the
   * point: **not measured** (no session, or the response was not seen),
   * **absent** (the response was read and the header was not in it), and
   * **present**, with what it says. A scanner that reports "absent" when it
   * means "I did not look" is worse than one that says nothing.
   */
  const H = seen?.headers || null;
  const has = (name) => (H && H[name] ? H[name] : null);
  const unseen = 'Not measured: no response for this document was captured in this session. Start a session before loading the page, and the headers it came back with are read as it loads.';

  out.push({
    id: 'header-csp',
    title: 'Content-Security-Policy · سياسة أمان المحتوى',
    surface: 'security',
    status: !seen ? 'MANUAL' : has('content-security-policy') ? 'DECLARED' : 'GAP',
    detail: !seen
      ? unseen
      : has('content-security-policy')
        ? `Sent: \`${has('content-security-policy')}\`.${/unsafe-inline|unsafe-eval/i.test(has('content-security-policy')) ? ' It allows unsafe-inline or unsafe-eval, which is most of what a policy exists to stop; whether that is a compromise somebody chose is a question for whoever wrote it.' : ''}`
        : 'No Content-Security-Policy on this document. Nothing constrains where a script may be loaded from, which is the control that turns an injected string into a failed request instead of a running script.',
  });

  out.push({
    id: 'header-hsts',
    title: 'Strict-Transport-Security · إلزام التشفير',
    surface: 'security',
    status: !seen ? 'MANUAL' : !https ? 'GAP' : has('strict-transport-security') ? 'DECLARED' : 'GAP',
    detail: !seen
      ? unseen
      : !https
        ? 'Served over plain http, so there is nothing for HSTS to enforce. The scheme is the finding, not the header.'
        : has('strict-transport-security')
          ? `Sent: \`${has('strict-transport-security')}\`. The next visit goes to https before a request leaves the browser.`
          : 'No Strict-Transport-Security. The first visit of every day can still be made over http and downgraded before the redirect happens.',
  });

  out.push({
    id: 'header-cors',
    title: 'Access-Control-Allow-Origin · مشاركة الموارد',
    surface: 'security',
    status: !seen ? 'MANUAL' : has('access-control-allow-origin') === '*' ? 'OBSERVED' : 'DECLARED',
    detail: !seen
      ? unseen
      : has('access-control-allow-origin') === '*'
        ? 'This document answers `Access-Control-Allow-Origin: *`, so any site may read it from a visitor\'s browser. On a public page that is a decision; on anything behind a login it is a hole, and which of the two this is depends on what the response contains.'
        : has('access-control-allow-origin')
          ? `Answers \`Access-Control-Allow-Origin: ${has('access-control-allow-origin')}\`, which names an origin rather than opening it to everybody.`
          : 'No Access-Control-Allow-Origin on this document, so the browser\'s default applies and another site cannot read it. That is the safe answer, not a missing one.',
  });

  out.push({
    id: 'header-frame-options',
    title: 'Clickjacking: X-Frame-Options and frame-ancestors · الحماية من التأطير',
    surface: 'security',
    status: !seen
      ? 'MANUAL'
      : has('x-frame-options') || /frame-ancestors/i.test(has('content-security-policy') || '')
        ? 'DECLARED'
        : 'GAP',
    detail: !seen
      ? unseen
      : has('x-frame-options') || /frame-ancestors/i.test(has('content-security-policy') || '')
        ? `Framing is constrained${has('x-frame-options') ? ` by \`X-Frame-Options: ${has('x-frame-options')}\`` : ' by the policy\'s frame-ancestors directive'}.`
        : 'Neither X-Frame-Options nor a frame-ancestors directive. Any site may load this page in an invisible frame over its own buttons, which is what a clickjack is.',
  });

  out.push({
    id: 'header-referrer-policy',
    title: 'Referrer-Policy · سياسة المُحيل',
    surface: 'security',
    status: !seen ? 'MANUAL' : has('referrer-policy') ? 'DECLARED' : 'GAP',
    detail: !seen
      ? unseen
      : has('referrer-policy')
        ? `Sent: \`${has('referrer-policy')}\`.`
        : 'No Referrer-Policy. The browser default no longer leaks a full path across origins, so this is a hardening step rather than a leak; it matters where a URL itself carries an identifier.',
  });

  out.push({
    id: 'header-permissions-policy',
    title: 'Permissions-Policy · سياسة الأذونات',
    surface: 'security',
    status: !seen ? 'MANUAL' : has('permissions-policy') ? 'DECLARED' : 'MANUAL',
    detail: !seen
      ? unseen
      : has('permissions-policy')
        ? `Sent: \`${has('permissions-policy')}\`. Camera, microphone, geolocation and the rest are constrained for this document and everything it embeds.`
        : 'No Permissions-Policy. Not a fault on its own: it matters on a page that embeds third-party frames, because without it an embedded document inherits whatever the top one may do.',
  });

  return out;
}

/**
 * 15, 16, 18, 19: the ones no browser can decide.
 *
 * Same shape as the twelve guided accessibility checks: a question, a method,
 * and an answer a person gives, filed as a tagged note. Never a tick, because a
 * tick here would be a lie about what was checked.
 */
export const MANUAL_CHECKS = [
  {
    id: 'fake-reviews',
    title: 'No invented reviews or testimonials',
    law: 'Consumer protection; EU Directive 2005/29/EC on unfair commercial practices',
    how: 'Read every testimonial on the site. For each one, ask who said it and whether you could show that they exist. A tool cannot know a quotation was invented.',
  },
  {
    id: 'unsupported-claims',
    title: 'Every claim can be supported',
    law: 'Advertising standards; consumer protection',
    how: 'List the superlatives: "fastest", "the leading", "number one", "certified". For each, find the evidence you would show a regulator. Remove the ones with none.',
  },
  {
    id: 'image-rights',
    title: 'Every image is licensed for this use',
    law: 'Copyright',
    how: 'For each photograph, illustration and icon, name where it came from and what the licence permits. Stock, commissioned, or your own. A page cannot say who owns its pictures.',
  },
  {
    id: 'business-truth',
    title: 'The business details are true and current',
    law: 'E-Commerce Directive 2000/31/EC Art. 5',
    how: 'A page can be asked whether an address is present. It cannot be asked whether the company still trades from it, whether the registration number is live, or whether anyone reads that inbox. Confirm each against the register and a sent message.',
  },
  {
    id: 'local-law',
    title: 'The law where your visitors are',
    law: 'Jurisdiction',
    how: 'Name the places your visitors are in and check what each requires: GDPR in the EU, PDPL in Jordan and Saudi Arabia, CCPA in California. Which law applies is a question about the world, not about the page.',
  },

  /* ── reel 3: claims about time and about behaviour ───────────────────── */

  {
    id: 'deletion-honoured',
    group: 'legal',
    title: 'Deleted really means deleted',
    law: 'GDPR Art. 17, right to erasure',
    how: 'Upload a file to an account you control, ask for it to be deleted, wait, then try the asset URL again and ask the operator to show it gone from the store and from backups. No single page load can prove a deletion request was honoured, and no crawl can either.',
  },
  {
    id: 'storage-exposure',
    group: 'legal',
    title: 'The asset store is not readable by strangers',
    law: 'Data protection; contract with the storage provider',
    how: 'Take an asset URL from the page. If it names a bucket host directly rather than a CDN, request the bucket root unauthenticated and see whether it lists. Where assets come through a CDN or a signed URL the question moves to the provider console, where a page cannot follow.',
  },
  {
    id: 'cancellation-friction',
    group: 'legal',
    title: 'Leaving is no harder than joining',
    law: 'Consumer protection; EU Directive 2005/29/EC; FTC negative-option rules',
    how: 'Count the steps and the clicks to subscribe, then the steps and the clicks to cancel, both from a real account. A machine can count; whether the difference is a dark pattern rather than an awkward flow is a reading of intent, and that is the half that decides.',
  },
  {
    id: 'renewal-reminder',
    group: 'legal',
    title: 'A renewal is announced before it is charged',
    law: 'Consumer protection; auto-renewal statutes',
    how: 'Start a trial, then wait out a billing cycle and check what arrived before the charge did. This is a claim about a month, not about a page, and nothing observed in one session can settle it.',
  },
  {
    id: 'ai-safety-response',
    group: 'legal',
    title: 'The site\'s own AI answers a person in crisis safely',
    law: 'Product safety; duty of care',
    how: 'Where the site has an assistant, this needs a designed probe and a reading of the answer against a safety standard. Both belong with people who do that work, and this product does not improvise either. Delegate it the way accessibility is delegated: run it elsewhere, cite the result, re-implement nothing.',
  },

  /* ── reel 4: not the crawler's object at all ─────────────────────────── */

  {
    id: 'secrets-in-history',
    group: 'security',
    title: 'No key is in the repository or its history',
    law: 'Not a law. Provider terms, and the cost of a rotated key',
    how: 'Run a secret scanner over the repository and every commit reachable from it: gitleaks or trufflehog. A key deleted in the latest commit is still in the history, and the deployed site never shows either way. This is not a browser\'s question and no cleverness in one reaches it.',
  },
  {
    id: 'database-rules',
    group: 'security',
    title: 'The database refuses what the app forgets to',
    law: 'Not a law. Provider configuration',
    how: 'Read the access rules in the provider console (Firestore rules, Supabase row-level security, an IAM policy) and test them with a client that is not your app. No page a browser renders shows them either way.',
  },
  {
    id: 'spend-cap',
    group: 'security',
    title: 'A runaway bill has a ceiling',
    law: 'Not a law. Your own invoice',
    how: 'Set a budget and an alert in the cloud and model-provider consoles. A billing cap is not a property of the deployed site, and the first sign that it is missing is usually the invoice.',
  },
  {
    id: 'active-security-testing',
    group: 'security',
    title: 'Inputs, permissions, XSS and injection, tested with payloads',
    law: 'Not a law. OWASP ASVS, and whatever your customer signed',
    how: 'These four need traffic sent at a running system: injecting payloads into every input, and reaching for one account\'s data from another. Use a scanner built for it, with written permission, against a system you control. This product reads what a site already serves and does not send adversarial traffic at anybody, which is a decision rather than an omission.',
  },
  {
    id: 'response-headers',
    group: 'security',
    title: 'X-Content-Type-Options, and the headers no browser can judge for you',
    law: 'Not a law. OWASP Secure Headers',
    how: 'Six of these are measured now and appear as rows above: Content-Security-Policy, Strict-Transport-Security, Access-Control-Allow-Origin, X-Frame-Options, Referrer-Policy and Permissions-Policy (decision 33, 8 September 2026). What is left is a person\'s question rather than a scan\'s: whether the policy that is present is the right one for this application, whether `Access-Control-Allow-Origin` naming another origin should be naming it, and whether X-Content-Type-Options and the cache headers match how the responses are actually served. Read the measured rows first; this is what they cannot decide.',
  },
  {
    id: 'production-settings',
    group: 'security',
    title: 'This deployment is actually configured as production',
    law: 'Not a law',
    how: 'Not a discrete check. It is the four rows above plus debug mode, source maps and exposed config paths, asked once about the whole stack. Whatever is left after that subtraction is a person\'s read of a deployment, and it does not get a tick.',

  },

  /* ── reel 2: the judgement tails of a checkable list ─────────────────── */

  {
    id: 'unused-navigation',
    group: 'hygiene',
    title: 'Every route in the navigation earns its place',
    law: 'Not a law. Nothing on the hygiene surface is',
    how: 'The mechanical half is checkable: a nav link that 404s, resolves to a hash, or duplicates another entry. This is the other half. A page that answers perfectly well and that nothing links to may still be dead weight, and that is a decision about the business rather than a property of the markup.',
  },
  {
    id: 'mobile-feel',
    group: 'hygiene',
    title: 'It works on a phone',
    law: 'Not a law, though WCAG 1.4.4, 1.4.10 and 2.5.8 sit underneath it',
    how: 'After sideways scroll, the mobile menu, the viewport sweep and the WCAG rows above are clean: hold a phone and use it. Whatever is left after that subtraction is taste, and taste does not get a tick.',
  },
];

/* ── the whole check ───────────────────────────────────────────────────── */

/**
 * Everything the machine can say, plus the questions it cannot answer.
 *
 * `manual` is returned alongside rather than mixed in, so no surface can render
 * a question as a result by accident.
 */
/**
 * Accessibility is answered elsewhere, and this says where.
 *
 * Five of the nineteen points are accessibility, and this product already ships
 * all five in more depth than the list asks for: axe-core with 105 rules plus
 * twelve guided checks. Re-implementing one rule here would produce a second
 * contrast checker that disagrees with the first, which is an argument rather
 * than a fix. So the block carries a pointer and no verdict of its own.
 */
export function accessibilityPointer({ a11y = null } = {}) {
  return {
    id: 'accessibility',
    title: 'Accessibility · إمكانية الوصول',
    status: 'DECLARED',
    delegated: true,
    detail: a11y
      ? `Delegated to "Check accessibility": ${plural(a11y.total ?? 0, 'violation')} across ${plural(a11y.violations?.length ?? 0, 'rule')} by axe-core, plus the guided checks. No rule is re-checked here.`
      : 'Delegated to "Check accessibility", which has not been run on this session yet. Alt text, contrast, keyboard operation and button labels are all answered there, and none of them is re-checked here.',
  };
}

export function finePrint(input = {}) {
  // The page's own words, where the page reader captured them.
  //
  // Every text-based row here reads `input.text`, and every caller was
  // building it from the title and the headings alone. Measured against three
  // real sites, that made the business-details row wrong on all three and made
  // reel 3's policy-text rows read GAP on a privacy notice that plainly says
  // the words: the details and the disclosures live in the body, and the body
  // was never handed over. The caller's own `text` stays first so nothing it
  // deliberately supplied is lost.
  const pageText = input.page?.hygiene?.text || '';
  const scoped = pageText ? { ...input, text: [input.text, pageText].filter(Boolean).join(' ') } : input;
  input = scoped;
  // Three surfaces, kept apart in the output as well as in the code, because
  // they fail differently and reading them as one list is what makes a report
  // sound like a compliance certificate. Legal exposure, whether the thing is
  // finished, and what a page can say about its own security are three
  // different conversations with three different people.
  const legal = [
    ...policyChecks(input),
    ...policyContentChecks(input),
    ...consentChecks(input),
    ...formChecks(input),
    ...trackingChecks(input),
    ...businessChecks(input),
    accessibilityPointer(input),
  ].map((c) => ({ surface: 'legal', ...c }));
  const hygiene = hygieneChecks(input).map((c) => ({ surface: 'hygiene', ...c }));
  const security = securityChecks(input).map((c) => ({ surface: 'security', ...c }));
  const checks = [...legal, ...hygiene, ...security];

  const counts = checks.reduce((m, c) => ({ ...m, [c.status]: (m[c.status] || 0) + 1 }), {});
  const manual = MANUAL_CHECKS.map((m) => ({ group: 'legal', ...m }));
  return {
    url: input.url || '',
    host: hostOf(input.url || ''),
    /*
     * Which documents this answer covers.
     *
     * On the record, in the result, and printed in the first line of the
     * document. The reason is finding 14 of research/58: three tools handed
     * back a clean bill of health for a page nobody had tested, and the one
     * thing that would have given it away is not on any of them — how many
     * documents were actually read.
     */
    frames: input.scannedFrames || (input.url ? [{ url: input.url, depth: 0 }] : []),
    frameCount: input.frameCount || (input.scannedFrames?.length ?? 1),
    checks,
    manual,
    counts: {
      declared: counts.DECLARED || 0,
      observed: counts.OBSERVED || 0,
      gaps: counts.GAP || 0,
      // A row that could not be measured is not a pass and not a failure. It
      // was counted as neither until this round, which meant a page the reader
      // never ran on produced the same headline as a clean one.
      unmeasured: counts.MANUAL || 0,
      manual: manual.length,
      total: checks.length,
      legal: legal.length,
      hygiene: hygiene.length,
      security: security.length,
    },
  };
}

/** The block the report and the exported documents both render. */
const SURFACES = [
  ['legal', 'Legal and privacy · القانوني والخصوصية', 'What the site promises, what it does with a visitor\'s data, and who else it invites onto the page.'],
  ['hygiene', 'Site hygiene · الأساسيات التقنية', '**None of this is a legal matter.** It is whether the thing is finished: sideways scroll, links that go nowhere, leftover template words, a stale year.'],
  ['security', 'Security, as far as a page can say · الأمان بقدر ما تُظهره الصفحة', 'The part of a security review a rendered page can answer for itself. It is not a security review, and the questions it cannot reach are listed below by name.'],
];

const MANUAL_GROUPS = [
  ['legal', 'Legal and behavioural · قانونية وسلوكية'],
  ['hygiene', 'Site hygiene · الأساسيات التقنية'],
  ['security', 'Security, and what is not on the page at all · الأمان وما هو خارج الصفحة'],
];

export function finePrintMarkdown(result) {
  const c = result.counts;
  const L = ['## The fine print · التدقيق القانوني والفني', ''];
  L.push(`${plural(c.total, 'machine check')} on ${result.host || 'this page'}: ${c.declared} declared, ${c.observed} observed, ${c.gaps} to decide${c.unmeasured ? `, ${c.unmeasured} not measured in this session` : ''}. ${plural(c.manual, 'question')} below need a person.`);
  L.push('');
  // Which documents were read. Named before any finding, because a finding
  // about the wrong document is worse than no finding at all.
  const frames = result.frames || [];
  L.push(`Read in ${describeScannedFrames(result.frameCount || frames.length || 1)}: ${frames.length ? frames.map((f) => f.url).join(', ') : result.url || 'this page'}.`);
  L.push('');

  for (const [id, heading, blurb] of SURFACES) {
    const rows = result.checks.filter((x) => (x.surface || 'legal') === id);
    if (!rows.length) continue;
    L.push(`### ${heading}`);
    L.push('');
    L.push(blurb);
    L.push('');
    L.push('| Check | Status | What was found |');
    L.push('|---|---|---|');
    for (const row of rows) L.push(`| ${row.title} | ${row.status} | ${row.detail} |`);
    L.push('');
  }

  L.push('> **The limit of this block.** It records what the site *declares* and what the browser *observed*, and the gap between them. It is not a legal opinion, not a security review and not a certificate of compliance: whether a gap is unlawful is a question for counsel in a named jurisdiction, and whether a system is secure is a question for people who send it traffic on purpose. A row marked MANUAL was measured by nobody. Every question below was checked by nobody and is waiting on a person.');
  L.push('');
  L.push('### Questions no scan can answer · ما لا يستطيع الفحص الآلي الإجابة عنه');
  L.push('');
  for (const [id, heading] of MANUAL_GROUPS) {
    const rows = result.manual.filter((m) => (m.group || 'legal') === id);
    if (!rows.length) continue;
    L.push(`**${heading}**`);
    L.push('');
    for (const m of rows) L.push(`- **${m.title}** (${m.law}). ${m.how}`);
    L.push('');
  }
  L.push('_Nothing here decides whether a site is lawful, finished or secure. It says what is present, what was called, and in what order. The judgement is yours._');
  L.push('');
  return L.join('\n');
}
