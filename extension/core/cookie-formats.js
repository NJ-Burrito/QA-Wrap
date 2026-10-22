/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Cookies, in every shape anybody actually has them in.
 *
 * A tester who needs to move a session between environments has the cookies in
 * whatever the last tool gave them: a JSON blob from an editor extension, a
 * `cookies.txt` from curl or yt-dlp, a `Cookie:` header pasted out of DevTools,
 * or the `Set-Cookie` lines from a server log. Supporting one of those and
 * calling it "import" means the other three become a manual retyping job, and
 * retyped cookies are wrong in ways that cost an afternoon — a missing
 * `HttpOnly`, a domain with the leading dot dropped, an expiry in the wrong
 * unit.
 *
 * So: four formats in, four formats out, and the round trip is asserted.
 *
 * ── the three details that are always got wrong ───────────────────────────
 *
 * **`expirationDate` is seconds, not milliseconds.** Chrome's cookies API takes
 * a UNIX timestamp in *seconds*. Passing `Date.now()` produces a cookie that
 * expires in the year 56,000 — which sounds harmless and means a session cookie
 * silently became permanent.
 *
 * **A session cookie has no expiry at all**, and that is different from one
 * with an expiry in the past. Writing `expirationDate: 0` deletes it.
 *
 * **The leading dot is host-only, inverted.** Netscape files write `.example.com`
 * for "and all subdomains"; Chrome expresses the same thing as `domain:
 * ".example.com"` *or* as `hostOnly: false`, and gets it wrong if you set both.
 */

/** A count and its noun, agreeing. Local: see `background/service-worker.js`. */
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

/* ── shared shape ──────────────────────────────────────────────────────── */

/**
 * The neutral cookie this module reads into and writes out of.
 *
 * Deliberately Chrome's own field names, so nothing has to be translated on the
 * way to `chrome.cookies.set` — a translation layer is one more place for
 * `sameSite` to become `samesite` and be silently dropped.
 */
const FIELDS = ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'expirationDate', 'hostOnly', 'session'];

const SAME_SITE = { no_restriction: 'no_restriction', lax: 'lax', strict: 'strict', unspecified: 'unspecified' };

/** Normalise whatever came in into the shape everything else here expects. */
function normalise(raw = {}) {
  const out = {};
  out.name = String(raw.name ?? raw.Name ?? '').trim();
  out.value = String(raw.value ?? raw.Value ?? '');
  out.domain = String(raw.domain ?? raw.Domain ?? raw.host ?? '').trim();
  out.path = String(raw.path ?? raw.Path ?? '/') || '/';
  out.secure = Boolean(raw.secure ?? raw.Secure ?? false);
  out.httpOnly = Boolean(raw.httpOnly ?? raw.httponly ?? raw.HttpOnly ?? false);

  const same = String(raw.sameSite ?? raw.samesite ?? raw.SameSite ?? '').toLowerCase().replace(/[\s-]/g, '_');
  out.sameSite = SAME_SITE[same] || (same === 'none' ? 'no_restriction' : 'unspecified');

  // Seconds. Anything above the year 3000 was almost certainly milliseconds,
  // and silently accepting it makes a session cookie permanent.
  let exp = raw.expirationDate ?? raw.expires ?? raw.expiry ?? raw.Expires ?? null;
  if (typeof exp === 'string' && exp) {
    const asDate = Date.parse(exp);
    exp = Number.isNaN(asDate) ? Number(exp) : asDate / 1000;
  }
  if (typeof exp === 'number' && Number.isFinite(exp) && exp > 0) {
    out.expirationDate = exp > 32_503_680_000 ? Math.round(exp / 1000) : Math.round(exp);
  } else {
    out.expirationDate = null;
  }

  out.session = out.expirationDate == null;
  // hostOnly and the leading dot say the same thing. Trust the dot when it is
  // there, because it is the one that survives every format.
  out.hostOnly = raw.hostOnly ?? !out.domain.startsWith('.');
  return out;
}

const clean = (c) => Object.fromEntries(FIELDS.map((f) => [f, c[f]]).filter(([, v]) => v !== undefined));

/* ── JSON ──────────────────────────────────────────────────────────────── */

/**
 * The shape Cookie-Editor, EditThisCookie and most extensions export.
 *
 * An array of objects with Chrome's field names. Also accepts a single object
 * and a `{ cookies: [...] }` wrapper, because both appear in the wild and
 * refusing them teaches nobody anything.
 */
export function parseJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`That is not valid JSON: ${err.message}`);
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.cookies) ? data.cookies : [data];
  // Cookie-shaped objects are kept even when the name is empty, and the caller
  // reports them as refused. Filtering here would be a silent drop, and an
  // input that vanishes without a word is the one failure this project treats
  // as worse than an error — the tester sees "12 imported" out of thirteen and
  // has no way to find the thirteenth.
  return list.filter((c) => c && typeof c === 'object').map(normalise).map(clean);
}

export function toJson(cookies) {
  return JSON.stringify(cookies.map(normalise).map(clean), null, 2);
}

/* ── Netscape cookies.txt ──────────────────────────────────────────────── */

/**
 * The `cookies.txt` format curl, wget and yt-dlp read and write.
 *
 * Seven tab-separated fields, and the two that catch people out are the third
 * (`includeSubdomains`, which is the *inverse* of `hostOnly`) and the fifth
 * (expiry in seconds, `0` meaning a session cookie).
 *
 * `#HttpOnly_` prefixing the domain is a curl extension rather than part of the
 * original format, and it is the only way the flag survives a round trip — so
 * it is both read and written.
 */
export function parseNetscape(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // A comment, unless it is curl's HttpOnly marker, which is a comment that
    // carries data.
    const httpOnly = trimmed.startsWith('#HttpOnly_');
    if (trimmed.startsWith('#') && !httpOnly) continue;

    const parts = (httpOnly ? trimmed.slice('#HttpOnly_'.length) : trimmed).split('\t');
    if (parts.length < 7) continue;

    const [domain, includeSub, path, secure, expiry, name, ...rest] = parts;
    const seconds = Number(expiry);
    out.push(
      clean(
        normalise({
          name,
          // The value may itself contain tabs in a malformed file; keeping the
          // rest joined loses less than dropping the cookie.
          value: rest.join('\t'),
          domain: includeSub.toUpperCase() === 'TRUE' && !domain.startsWith('.') ? `.${domain}` : domain,
          path,
          secure: secure.toUpperCase() === 'TRUE',
          httpOnly,
          expirationDate: seconds > 0 ? seconds : null,
        })
      )
    );
  }
  return out;
}

export function toNetscape(cookies) {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# Written by QA Wrap. This file may be read by curl, wget and yt-dlp.',
    '# Lines beginning #HttpOnly_ carry the HttpOnly flag, which the original format has no room for.',
    '',
  ];
  for (const raw of cookies) {
    const c = normalise(raw);
    const includeSub = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const row = [
      c.domain,
      includeSub,
      c.path,
      c.secure ? 'TRUE' : 'FALSE',
      c.expirationDate == null ? '0' : String(Math.round(c.expirationDate)),
      c.name,
      c.value,
    ].join('\t');
    lines.push(c.httpOnly ? `#HttpOnly_${row}` : row);
  }
  return `${lines.join('\n')}\n`;
}

/* ── a request Cookie: header ──────────────────────────────────────────── */

/**
 * `a=1; b=2` — what DevTools shows and what people paste most often.
 *
 * It carries names and values and **nothing else**, so everything imported this
 * way is a session cookie on the current host. That loss is inherent to the
 * format; the honest thing is to apply the current URL's domain rather than
 * invent one, which is why `defaults` is a parameter and not a guess.
 */
export function parseHeader(text, defaults = {}) {
  const body = String(text).replace(/^\s*cookie\s*:\s*/i, '');
  return body
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      const name = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? '' : pair.slice(eq + 1);
      return clean(normalise({ name: name.trim(), value, ...defaults }));
    });
}

export function toHeader(cookies) {
  return cookies
    .map((c) => normalise(c))
    .filter((c) => c.name)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/* ── Set-Cookie response lines ─────────────────────────────────────────── */

/**
 * The `Set-Cookie` lines out of a server log or a proxy.
 *
 * The richest of the text formats — it carries every attribute — and the one
 * whose expiry is a date string rather than a number, which is why `normalise`
 * accepts both.
 */
export function parseSetCookie(text, defaults = {}) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const body = line.trim().replace(/^set-cookie\s*:\s*/i, '');
    if (!body) continue;

    const [pair, ...attrs] = body.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;

    const cookie = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), ...defaults };
    for (const attr of attrs) {
      const [rawKey, ...rest] = attr.split('=');
      const key = rawKey.trim().toLowerCase();
      const value = rest.join('=').trim();
      if (key === 'domain') cookie.domain = value;
      else if (key === 'path') cookie.path = value;
      else if (key === 'expires') cookie.expirationDate = value;
      else if (key === 'max-age') cookie.expirationDate = Math.floor(Date.now() / 1000) + Number(value);
      else if (key === 'secure') cookie.secure = true;
      else if (key === 'httponly') cookie.httpOnly = true;
      else if (key === 'samesite') cookie.sameSite = value;
    }
    out.push(clean(normalise(cookie)));
  }
  return out;
}

export function toSetCookie(cookies) {
  return cookies
    .map((raw) => {
      const c = normalise(raw);
      const parts = [`${c.name}=${c.value}`];
      if (c.domain) parts.push(`Domain=${c.domain}`);
      parts.push(`Path=${c.path}`);
      if (c.expirationDate != null) parts.push(`Expires=${new Date(c.expirationDate * 1000).toUTCString()}`);
      if (c.secure) parts.push('Secure');
      if (c.httpOnly) parts.push('HttpOnly');
      if (c.sameSite && c.sameSite !== 'unspecified') {
        parts.push(`SameSite=${{ no_restriction: 'None', lax: 'Lax', strict: 'Strict' }[c.sameSite]}`);
      }
      return `Set-Cookie: ${parts.join('; ')}`;
    })
    .join('\n');
}

/* ── choosing a format ─────────────────────────────────────────────────── */

export const FORMATS = [
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json',
    hint: 'What Cookie-Editor and EditThisCookie export. Carries every attribute.' },
  { id: 'netscape', label: 'Netscape cookies.txt', ext: 'txt', mime: 'text/plain',
    hint: 'What curl, wget and yt-dlp read. Carries everything except SameSite.' },
  { id: 'header', label: 'Cookie: header', ext: 'txt', mime: 'text/plain',
    hint: 'What DevTools shows. Names and values only. Everything else is lost.' },
  { id: 'setcookie', label: 'Set-Cookie lines', ext: 'txt', mime: 'text/plain',
    hint: 'What a server log or a proxy gives you. Carries every attribute.' },
];

/**
 * Work out what somebody pasted.
 *
 * Ordered most-specific first. Guessing wrong is cheap here — the UI shows what
 * was detected and lets it be overridden — and guessing at all saves the tester
 * from a dropdown they would have to think about every time.
 */
export function detectFormat(text) {
  const body = String(text || '').trim();
  if (!body) return null;
  if (/^[[{]/.test(body)) return 'json';
  if (/^#\s*Netscape HTTP Cookie File/i.test(body) || /^#HttpOnly_/m.test(body)) return 'netscape';
  if (/^set-cookie\s*:/im.test(body)) return 'setcookie';
  // A tab-separated line with seven fields is Netscape even with no header.
  if (body.split(/\r?\n/).some((l) => !l.startsWith('#') && l.split('\t').length >= 7)) return 'netscape';
  if (/;\s*(expires|path|domain|secure|httponly|max-age)=?/i.test(body)) return 'setcookie';
  if (/=/.test(body)) return 'header';
  return null;
}

export function parse(text, format, defaults = {}) {
  const chosen = format || detectFormat(text);
  switch (chosen) {
    case 'json': return parseJson(text);
    case 'netscape': return parseNetscape(text);
    case 'header': return parseHeader(text, defaults);
    case 'setcookie': return parseSetCookie(text, defaults);
    default:
      throw new Error(
        'Could not tell what format that is. Paste JSON, a cookies.txt, a Cookie: header, or Set-Cookie lines.'
      );
  }
}

/**
 * Split what parsed into what can be written and what cannot, with reasons.
 *
 * A cookie needs a name. Everything else can be defaulted, guessed or left to
 * the browser, but a nameless cookie cannot be set and cannot be found again —
 * so it is separated here rather than dropped, and the caller reports it.
 */
export function usable(cookies) {
  const ok = [];
  const refused = [];
  for (const c of cookies) {
    if (!c.name) refused.push({ ...c, reason: 'A cookie with no name cannot be set.' });
    else ok.push(c);
  }
  return { ok, refused };
}

export function serialise(cookies, format) {
  switch (format) {
    case 'json': return toJson(cookies);
    case 'netscape': return toNetscape(cookies);
    case 'header': return toHeader(cookies);
    case 'setcookie': return toSetCookie(cookies);
    default: throw new Error(`Unknown cookie format: ${format}`);
  }
}

/**
 * What a format will lose, said before it is used.
 *
 * Exporting to a `Cookie:` header and discovering afterwards that every flag is
 * gone is a bad afternoon. The UI shows this next to the choice.
 */
export function whatIsLost(format, cookies = []) {
  if (format === 'header') {
    // SameSite counts too. It was left out of this count at first, so a set of
    // cookies whose only extra attribute was SameSite reported "nothing will be
    // lost" and then lost it.
    const flags = cookies.filter(
      (c) => c.httpOnly || c.secure || c.expirationDate != null || (c.sameSite && c.sameSite !== 'unspecified')
    ).length;
    return flags
      ? `Names and values only. ${flags} of ${plural(cookies.length, 'cookie')} have flags or an expiry that this format cannot carry.`
      : 'Names and values only.';
  }
  if (format === 'netscape') {
    const same = cookies.filter((c) => c.sameSite && c.sameSite !== 'unspecified').length;
    return same
      ? `SameSite is not part of this format; ${plural(same, 'cookie')} will lose it. HttpOnly survives as a #HttpOnly_ prefix.`
      : 'HttpOnly survives as a #HttpOnly_ prefix. SameSite is not part of this format.';
  }
  return null;
}
