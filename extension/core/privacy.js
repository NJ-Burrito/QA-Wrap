/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Redaction by the shape of a value, not its field name: cards (Luhn), IBANs (mod-97), credentials, and off by default bare digits and emails. Digits are folded (Arabic-Indic, Persian, fullwidth); published Stripe test cards stay visible. GDPR Art. 5(1)(c), 25. */

/** What a redacted value reads as. Fixed width: a mask that leaks length is not a mask. */
export const REDACTED = '••••••••';

/** Luhn: without it every long order number looks like a card. */
export function luhnValid(digits) {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** IBAN: country, two check digits, then the account — validated by mod-97. */
export function ibanValid(raw) {
  const s = String(raw).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  const expanded = [...moved].map((c) => (/[A-Z]/.test(c) ? c.charCodeAt(0) - 55 : c)).join('');
  // 97 is larger than any chunk, so the running remainder stays inside Number.
  let rem = 0;
  for (const ch of expanded) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

/** Shapes shared with core/secret-scan-text.js: { kind, re, group }. */
export const SHAPES = [
  { kind: 'vendor-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ATATT3[A-Za-z0-9_=-]{20,}|key-[0-9a-f]{32}|sl\.[A-Za-z0-9_-]{40,}|[MNO][A-Za-z\d_-]{23,25}\.[\w-]{6}\.[\w-]{27,}|AAAA[\w-]{7}:APA91b[\w-]{100,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{30,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|ya29\.[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{30,}|dop_v1_[a-f0-9]{40,}|AccountKey=[A-Za-z0-9+/]{40,}={0,2}|hooks\.slack\.com\/services\/T[A-Z0-9]{8,12}\/B[A-Z0-9]{8,12}\/[A-Za-z0-9]{24}|discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{60,80}|\d{8,10}:AA[\w-]{33}\b|xapp-\d-[A-Z0-9]{9,12}-\d{10,14}-[a-f0-9]{32,64}|shp(?:at|ca|pa|ss)_[a-f0-9]{32}|pypi-[\w-]{50,200}|dckr_pat_[\w-]{20,40}|lin_api_[A-Za-z0-9]{40}|glsa_[A-Za-z0-9]{32}_[a-f0-9]{8}|whsec_[A-Za-z0-9]{24,64}|SK[a-f0-9]{32}\b|sntrys_[\w+/=]{40,400}|sbp_[a-f0-9]{40})/g, group: 0 },
  { kind: 'basic-auth', re: /\bBasic\s+([A-Za-z0-9+/]{12,}={0,2})/g, group: 1 },
  { kind: 'url-param', re: /[?&#;](?:access_token|refresh_token|id_token|auth_token|(?:api|access)[_-]?key|apikey|subscription[_-]?key|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|code(?==[^&#;\s"'<>]{16}))=([^&#;\s"'<>]{4,})/gi, group: 1 },
  // Same kind as the text scanner's own name=value rule, so a password in a URL is one finding whichever rule sees it first.
  { kind: 'url-credentials', re: /:\/\/[^\s/:@"']*:([^\s/@"']{3,})@/g, group: 1 },
  { kind: 'password', re: /[?&#;](?:token|password|passwd|pwd|secret|client_secret)=([^&#;\s"'<>]{4,})/gi, group: 1 },
];

/** Published test card numbers (Stripe docs): not secrets, and masking them hides what a payment test did. */
const TEST_PANS = new Set('4242424242424242 4000056655665556 5555555555554444 2223003122003222 5200828282828210 5105105105105100 378282246310005 371449635398431 6011111111111117 6011000990139424 3056930009020004 36227206271667 3566002020360505 6200000000000005'.split(' '));

/** Arabic-Indic, Persian and fullwidth digits to ASCII, same length, so offsets hold. */
export const fold = (s) => String(s).replace(/[٠-٩۰-۹０-９]/g, (c) => String.fromCharCode(48 + (c.charCodeAt(0) & 15))); // glyph-ok

/** Placeholder-looking values are not secrets: null, true, template markers, an existing mask. */
const NOT_SECRET = /^(?:null|true|false|undefined|none|string|number|required|empty|[•*x#._\s-]+|\{\{.*|\$\{.*|[<\[«].*)$/i; // glyph-ok
const keepSecret = (v) => v.length >= 4 && !NOT_SECRET.test(v) && !v.startsWith('qaw1:'); // qaw1: is QA Wrap's own public provenance stamp

/* r3-03-2: the recorder's secret field names (one list, generated from core/privacy-names.json; test-privacy-contract checks for drift),
   plus the names that sign a URL. core/secret-scan-text.js re-exports isSecretParam: capture and export judge one name list. */
/* privacy-names:begin (generated from core/privacy-names.json; do not edit) */
const SECRET_NAMES = new Set(["pass","password","passwd","pwd","passcode","passphrase","secret","token","auth","authorization","bearer","session","sessionid","phpsessid","jsessionid","aspsessionid","cookie","apikey","otp","pin","credit","creditcard","card","cardnumber","cvv","cvc","ssn","iban","jwt","csrf","xsrf","sid","privatekey","accesskey","subscriptionkey","functionskey","secretkey","signingkey","licensekey","dpop","nationalid","كلمةالمرور","رقمسري"]);
const isSecretName = (name) => { const t = String(name).replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z\d\u0600-\u06ff]+/).filter(Boolean); return t.some((w, i) => SECRET_NAMES.has(w) || (i > 0 && SECRET_NAMES.has(t[i - 1] + w))); };
/* privacy-names:end */
const SIGNS = /(?:^|[^a-z\d])(?:sig|signature|sas|hmac)(?:[^a-z\d]|$)/i;
export const isSecretParam = (name) => isSecretName(name) || SIGNS.test(String(name));
/** D-1010-173: the one header rule (the 11 legacy names plus custom credential headers). */
export const isSecretHeader = (name) => isSecretParam(String(name).trim());

/** name=value / "name":"value" where the NAME says credential (query strings, form bodies, JSON pairs). Value: 6+ characters, no whitespace, not a placeholder.
 *  A JSON pair skips the bare words `pass` and `session`: they are test-result and state fields ("pass": "failed", "session": "recording"), never a credential; `=` pairs keep them. */
const NAMEPAIR = /(?<![\w-])["']?([\w.-]{2,40})\\?["']?\s*([:=])(?!\/\/)\s*\\?["']?([^\s"'\\&#;,}\]]{6,})/gd;
export function namedSpans(t) {
  const out = [];
  for (const m of t.matchAll(NAMEPAIR)) {
    const [, key, sep, val] = m;
    // session_state / session_storage / session_count are state, not a credential; session_id and a bare `session=` stay names.
    if (!isSecretParam(/^session$/i.test(key) ? key : key.replace(/session(?![_-]?id)/gi, 'x')) || NOT_SECRET.test(val) || val.startsWith('qaw1:') || val.includes(REDACTED)) continue;
    if (sep === ':' && /^(?:pass|session)$/i.test(key)) continue;
    out.push(m.indices[3]);
  }
  return out;
}
/** Key names whose value is a credential, in JSON or form text (works on truncated JSON: no parse). `pin`/`otp`/`cvv` match whole keys only. */
const KEYVALUE = /(?<![\w-])(?:[\w-]{0,40}(?:password|passwd|pwd|secret|token|api[_-]?key|session[_-]?id|authorization|credential|cookie|passphrase|private[_-]?key|bearer)[\w-]{0,40}|otp|pin|cvv)\\?["']?\s*[:=]\s*(?:\\?["']((?:[^"'\\\r\n]|\\.)*)|([^\s,&;}"'\]\\]{4,}))/gi;

const hasDigits = /[٠-٩۰-۹０-９]/; // glyph-ok
const withIdx = new Map();

/** [start, end) of each match (or of its capture group, the first of `group` that matched), measured on `text`. */
function spansOf(text, re, group = 0, keep) {
  let d = withIdx.get(re);
  if (!d) withIdx.set(re, (d = new RegExp(re.source, re.flags.replace('d', '') + 'd')));
  const out = [];
  for (const m of text.matchAll(d)) {
    const g = [].concat(group).find((i) => m.indices[i]);
    const sp = g !== undefined && m.indices[g];
    if (sp && sp[1] > sp[0] && !m[g].includes(REDACTED) && (!keep || keep(m[g]))) out.push(sp);
  }
  return out;
}

export const FAMILIES = [
  {
    id: 'key',
    label: 'Private keys and certificates',
    always: true,
    spans: (t) => spansOf(t, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g),
  },
  {
    id: 'jwt',
    label: 'JSON web tokens',
    always: true,
    spans: (t) => spansOf(t, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g),
  },
  {
    id: 'bearer',
    label: 'Bearer tokens and API keys',
    always: true,
    spans: (t) => spansOf(t, /\b(?:bearer\s+|api[_-]?key\s*[:=]\s*|token\s*[:=]\s*)([A-Za-z0-9_\-.]{16,})/gi, 1),
  },
  {
    id: 'token',
    label: 'Vendor tokens, Basic auth and URL-query tokens',
    always: true,
    spans: (t) => SHAPES.flatMap((x) => spansOf(t, x.re, x.group)),
  },
  {
    id: 'secretkey',
    label: 'Values of password, token and key fields',
    always: true,
    spans: (t) => spansOf(t, KEYVALUE, [1, 2], keepSecret),
  },
  {
    id: 'secretname',
    label: 'Values of secret-named query, form and JSON fields',
    always: true,
    spans: namedSpans,
  },
  {
    id: 'card',
    label: 'Payment card numbers',
    always: true,
    // 13 digits not starting 4 is no brand. Dots and slashes only in fixed groups, one repeated: decimals are not cards.
    spans: (t) => spansOf(t, /(?<![\d.,/])(?:\d{4}([./])\d{4}\1\d{4}\1\d{1,7}|\d{4}([./])\d{6}\2\d{5})(?![.,/]?\d)|(?<!\d\.)\b(?:\d[ \-\xa0\u202f\u2009\u200b\u200f]?){13,19}\b/g, 0, (hit) => { // glyph-ok
      const d = hit.replace(/\D/g, '');
      return luhnValid(d) && !TEST_PANS.has(d) && (d.length !== 13 || d[0] === '4');
    }),
  },
  {
    id: 'iban',
    label: 'Bank account numbers (IBAN)',
    always: true,
    spans: (t) => spansOf(t, /\b[A-Z]{2}\d{2}[A-Z0-9 \-\xa0\u202f\u2009\u200b\u200f./]{10,38}\b/g, 0, ibanValid), // glyph-ok
  },
  {
    id: 'nationalId',
    label: 'National and record numbers',
    // Off unless asked for: a 10-digit run is a national number or an order reference.
    always: false,
    spans: (t) => spansOf(t, /\b\d{9,14}\b/g),
  },
  {
    id: 'phone',
    label: 'Phone numbers',
    // Needs a plus, a bracket or a separator: a bare digit run is the nationalId family's, and an order number is not a phone.
    always: false,
    spans: (t) => spansOf(t, /(?<![\w.])(?:\+\d[\d ().-]{6,18}\d|\(?\d{2,4}\)?(?:[ .-]\d{2,4}){2,4})(?![\w])/g, 0, (hit) => { const n = hit.replace(/\D/g, '').length; return n >= 8 && n <= 15 && !/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{1,3}(?:\.\d{1,3}){3})$/.test(hit); }), // R-02: not a date, not an IPv4 address
  },
  {
    id: 'email',
    label: 'Email addresses',
    always: false,
    spans: (t) => spansOf(t, /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g),
  },
];
// The matched strings, for callers that only need to know what a family sees.
for (const f of FAMILIES) f.find = (t) => f.spans(t).map(([a, b]) => t.slice(a, b));

/**
 * Redact one string; returns the text and what was removed (never the values).
 * `extra` switches on more family ids; `redactBareDigits` is the nationalId family.
 *
 * One pass: every family reads the same (digit-folded) copy and reports spans, a span that sits on
 * an earlier family's span is not counted again, the union is cut out of the original with one join.
 * Folding keeps lengths, so spans measured on the folded copy hold on the original.
 */
export function redact(text, { extra = [], redactBareDigits = false } = {}) {
  const raw = String(text ?? '');
  if (!raw) return { text: raw, found: [] };
  if (redactBareDigits) extra = [...extra, 'nationalId'];

  const seen = hasDigits.test(raw) ? fold(raw) : raw;
  const covered = new Uint8Array(raw.length);
  const all = [];
  const found = [];
  for (const family of FAMILIES) {
    if (!family.always && !extra.includes(family.id)) continue;
    let spans = [];
    try {
      spans = family.spans(seen);
    } catch {
      spans = []; // a redactor must never throw: failing open would store the value
    }
    const fresh = spans.filter(([a, b]) => !covered.subarray(a, b).includes(1));
    for (const sp of spans) { covered.fill(1, sp[0], sp[1]); all.push(sp); }
    if (fresh.length) found.push({ id: family.id, label: family.label, count: fresh.length });
  }
  if (!all.length) return { text: raw, found };
  all.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const out = [];
  let at = 0;
  let [from, to] = all[0];
  const flush = () => { out.push(raw.slice(at, from), REDACTED); at = to; };
  for (const [a, b] of all) {
    if (a < to) { if (b > to) to = b; } else { flush(); from = a; to = b; }
  }
  flush();
  out.push(raw.slice(at));
  return { text: out.join(''), found };
}

/**
 * Outbound-only fallback (S-03): a long run of base64url-looking characters with high Shannon entropy is a key, whatever its
 * vendor. Hex and UUID-shaped keys have too small an alphabet to separate from hashes by entropy and are not caught here.
 * A URL host or path segment and QA Wrap's own qaw1: token are skipped.
 */
export function redactEntropy(text) {
  const raw = String(text ?? '');
  let count = 0;
  // R-01: a URL's host and path are evidence, not a secret; only its query and fragment are judged.
  const urls = [];
  for (const m of raw.matchAll(/(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>`]*/gi)) urls.push([m.index, m.index + m[0].length]);
  const out = raw.replace(/[A-Za-z0-9+/_-]{32,}/g, (run, at) => {
    if (raw[at - 1] === '/' || run[0] === '/' || raw.slice(at - 5, at) === 'qaw1:' || raw.slice(at - 7, at) === 'base64,') return run; // a URL host or path segment, QA Wrap's own provenance token, and a data: URL payload (the report's embedded fonts)
    if (urls.some(([a, b]) => at >= a && at < b)) return run;
    // An identifier, a slug or joined UUIDs are words and hex, not a key: a key has digits mixed through it.
    if ((run.match(/\d/g) || []).length < 2 || /^[0-9a-f-]+$/i.test(run)) return run;
    if (run.split(/[_/-]/).reduce((n, w) => n + (/^[A-Za-z]{3,}$/.test(w) ? w.length : 0), 0) >= run.length * 0.5) return run; // SNAKE_CASE_CONSTANTS and word slugs
    const freq = new Map();
    for (const ch of run) freq.set(ch, (freq.get(ch) || 0) + 1);
    let h = 0;
    for (const n of freq.values()) { const p = n / run.length; h -= p * Math.log2(p); }
    if (h <= 4.0 || /^[0-9a-f]+$/i.test(run)) return run;
    count++;
    return REDACTED;
  });
  return { text: out, count };
}

/** True if anything in this string would be redacted. Cheap pre-check for a caller that only needs yes/no. */
export function hasSensitive(text, opts) {
  return redact(text, opts).found.length > 0;
}
