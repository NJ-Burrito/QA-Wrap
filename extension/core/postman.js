/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Postman.
 *
 * A QA session already contains the thing people open Postman to build by hand:
 * the exact requests an application made, in order, with the responses it got.
 * Retyping those into a collection is an afternoon, and the retyped version is
 * subtly wrong within a week.
 *
 * Two artefacts come out of here, and they are deliberately separate — which is
 * the whole point of the format:
 *
 *   **The collection** holds the requests, with every host and every changing
 *   value replaced by a `{{variable}}`.
 *   **The environment** holds what those variables were, for this run.
 *
 * That split is what makes a collection worth exporting at all. A collection
 * with `https://staging-es.example.gov/api/x` baked into forty requests tests
 * staging and nothing else; the same collection with `{{baseUrl}}` tests
 * whichever environment you point it at. It also means the collection is safe
 * to commit and the environment is not, which is a distinction teams get wrong
 * constantly and a file format can enforce.
 *
 * On secrets: the recorder redacts by header and field name before anything
 * reaches storage (see `content/page-hooks.js`), so a redacted value arrives
 * here already redacted. This file does not un-redact and does not guess — an
 * `Authorization` header exports as a `{{token}}` variable with an empty value
 * and a note, because a collection that ships someone's bearer token is a
 * security incident with a filename.
 */

import { MAKER, stamp, provenance } from './provenance.js';
import { isSecretParam, isSecretHeader, REDACTION, maskBodyKeys } from './secret-scan-text.js';


/** A count and its noun, agreeing. Local: see `background/service-worker.js`. */
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

/* D-1010-134: one variable per credential source. A source keeps its name; a different source asking for a taken name gets name_2, name_3. */
const claimed = new WeakMap();
function declare(variables, base, source) {
  let m = claimed.get(variables);
  if (!m) claimed.set(variables, (m = new Map()));
  if (m.has(source)) return m.get(source);
  let name = base;
  for (let n = 2; variables.has(name); n++) name = base + '_' + n;
  m.set(source, name);
  variables.set(name, '');
  return name;
}
const paramVar = (variables, key) => declare(variables, key.replace(/[^\p{L}\p{N}_.-]+/gu, '_') || 'param', 'p:' + key);

/** Every collection variable except the origin comes from a held-back header, so all of them are secrets. */
const isSecretVar = (key) => key !== 'baseUrl';

/** Headers the browser sets and Postman will set for itself. Noise in a collection. */
const BROWSER_HEADER =
  /^(host|connection|content-length|origin|referer|user-agent|sec-|accept-encoding|upgrade-insecure)/i;

/* ── grouping ──────────────────────────────────────────────────────────── */

/**
 * Absolute URL for a recorded request.
 *
 * The recorder shortens same-origin URLs to a path, because a report full of
 * repeated origins is unreadable. Postman needs the whole thing back, and the
 * session start URL is the origin it was shortened against.
 */
export function absolute(url, base) {
  try {
    return new URL(url, base || undefined).href;
  } catch {
    return String(url || '');
  }
}

/**
 * Requests that differ only by an id are one request.
 *
 * `/orders/8813`, `/orders/8814` and `/orders/9001` are one endpoint recorded
 * three times, and a collection with three near-identical entries is the reason
 * exported collections get deleted. Numeric and uuid-shaped segments become
 * `:id`, which is Postman's own path-variable syntax, so the collection arrives
 * with the variable already declared.
 */
export function templatePath(pathname) {
  return pathname
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^\d+$/.test(seg)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':uuid';
      if (/^[0-9a-f]{24,}$/i.test(seg)) return ':id';
      return seg;
    })
    .join('/');
}

/**
 * `/orders/:id/items/:id` would declare one `id` twice and give both slots the same value; the second
 * and later repeats become `:id2`, `:id3`. Only the URL block does this, so the endpoint key stays stable (11-7).
 */
function numberRepeats(path) {
  const seen = new Map();
  return path
    .split('/')
    .map((seg) => {
      if (!seg.startsWith(':')) return seg;
      const n = (seen.get(seg) || 0) + 1;
      seen.set(seg, n);
      return n === 1 ? seg : `${seg}${n}`;
    })
    .join('/');
}

/** The key two recordings of the same endpoint share. */
export function endpointKey(event, base) {
  const url = new URL(absolute(event.url, base));
  return `${event.method || 'GET'} ${url.origin}${templatePath(url.pathname)}`;
}

/**
 * r2-11-2: the operation one POST to a shared endpoint carries (GraphQL operationName, else the first named operation or
 * field in the query; JSON-RPC method), or ''. Postman groups and names by it so two operations are two items.
 */
export function operationOf(event) {
  let b;
  try { b = event.reqBody?.kind === 'json' ? JSON.parse(event.reqBody.text) : null; } catch { return ''; }
  if (Array.isArray(b)) b = b[0];
  if (!b || typeof b !== 'object') return '';
  const q = typeof b.query === 'string' ? b.query : '';
  const op = typeof b.operationName === 'string' && b.operationName ? b.operationName
    : (q && (/\b(?:query|mutation|subscription)\s+(\w+)/.exec(q) || /^\s*(?:query|mutation|subscription)?\s*\{\s*(\w+)/.exec(q))?.[1])
    || (typeof b.method === 'string' && (b.jsonrpc || 'id' in b) ? b.method : '');
  return String(op || '').slice(0, 80);
}

/* ── one shape for every net event ─────────────────────────────────────── */

/** A header value from a map whose keys may be in any case. */
function headerValue(headers, wanted) {
  const w = wanted.toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) if (k.toLowerCase() === w) return String(v);
  return '';
}

/**
 * [{name,value}] → { name: value }. A map passes through; a repeated name is joined with ", "
 * (the way HTTP folds it), so nothing is dropped and no array-index key ('0', '1') reaches a file.
 */
function headerMap(headers) {
  if (!Array.isArray(headers)) return headers && typeof headers === 'object' ? headers : {};
  const out = {};
  const seen = new Map();
  for (const h of headers) {
    if (!h || h.name == null) continue;
    const low = String(h.name).toLowerCase();
    const key = seen.get(low) ?? String(h.name);
    seen.set(low, key);
    out[key] = key in out ? `${out[key]}, ${h.value}` : String(h.value ?? '');
  }
  return out;
}

/** A body held as a bare string (a hand-sent request) → { kind, text }, the kind from its content-type. */
function bodyShape(body, contentType) {
  if (body == null || body === '') return null;
  if (typeof body !== 'string') return body;
  let kind = 'text';
  if (/json/i.test(contentType)) kind = 'json';
  else if (/x-www-form-urlencoded/i.test(contentType)) kind = 'form';
  else if (!contentType && /^\s*[[{]/.test(body)) {
    try { JSON.parse(body); kind = 'json'; } catch { /* stays text */ }
  }
  return { kind, text: body };
}

/**
 * The one place a net event is made uniform. The recorder stores headers as a map, a request body as
 * { kind, text } and a failure body as `responsePreview`; a hand-sent API call (`via:'api'`) stores
 * headers as [{name,value}] and bodies as plain strings. Postman and HAR both read through this, so the
 * two shapes export alike. An event that is already in the recorder's shape is returned as it is.
 */
export function normaliseNetEvent(e) {
  if (!e) return e;
  const odd = Array.isArray(e.reqHeaders) || Array.isArray(e.resHeaders) || typeof e.reqBody === 'string' ||
    e.resBody != null;
  if (!odd) return e;
  const reqHeaders = headerMap(e.reqHeaders);
  const resHeaders = headerMap(e.resHeaders);
  const out = { ...e, reqHeaders, resHeaders, reqBody: bodyShape(e.reqBody, headerValue(reqHeaders, 'content-type')) };
  if (!out.responsePreview && e.resBody != null) {
    out.responsePreview = typeof e.resBody === 'string' ? e.resBody : String(e.resBody.text ?? '');
  }
  delete out.resBody;
  return out;
}

/* ── the pieces of a Postman request ───────────────────────────────────── */

/** r5-11-3: the recorded Authorization scheme word (never the credential); Bearer when it is absent or not a known scheme. */
const authScheme = (value) => /^(Bearer|Basic|Digest|Token|Negotiate|NTLM|Hawk|OAuth|ApiKey)\s/i.exec(String(value ?? ''))?.[1] || 'Bearer';

/** r7-11-2: Postman expands a literal `{{x}}` in any request text, so page-derived text never carries one ({{$guid}} would run). Only the generated variables may. */
const neutral = (v) => String(v).replace(/\{\{/g, '{ {');

function headerList(headers, { variables }) {
  return Object.entries(headerMap(headers))
    .filter(([name]) => !BROWSER_HEADER.test(name))
    .map(([name, value]) => {
      if (isSecretHeader(name)) {
        // Declared, so the request works the moment a value is supplied, and
        // empty, so nothing secret is in the file.
        const key = declare(variables, name.toLowerCase() === 'authorization' ? 'token' : name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), 'h:' + name.toLowerCase());
        return {
          key: name,
          value: name.toLowerCase() === 'authorization' ? `${authScheme(value)} {{token}}` : `{{${key}}}`,
          description: 'Held back on purpose. Fill this in from your own credentials.',
        };
      }
      return { key: neutral(name), value: neutral(value) };
    });
}

/** r4-11-3 (D-1010-69): the parts of a recorded FormData body ({ name, value } or { name, file: { name, type, size } }), or null. */
export function formParts(reqBody) {
  return reqBody?.kind === 'FormData' && Array.isArray(reqBody.parts) ? reqBody.parts.filter((p) => p && typeof p.name === 'string') : null;
}

function bodyBlock(reqBody00, variables = new Map()) {
  if (!reqBody00) return undefined;
  /* r7-11-2: the page's own `{{` is broken before maskBodyKeys inserts the generated variables. */
  const reqBody0 = { ...reqBody00 };
  if (typeof reqBody0.text === 'string') {
    reqBody0.text = neutral(reqBody0.text);
    // A form body is percent-encoded, so `%7B%7B` decodes to `{{` below: re-encode the decoded pairs after breaking them.
    if (reqBody0.kind === 'form') reqBody0.text = new URLSearchParams([...new URLSearchParams(reqBody0.text)].map(([k, v]) => [neutral(k), neutral(v)])).toString();
  }
  if (Array.isArray(reqBody0.parts)) reqBody0.parts = reqBody0.parts.map((p) => (p && typeof p.value === 'string' ? { ...p, value: neutral(p.value) } : p));
  /* D-1010-133: a credential-named body key becomes {{name}}, declared empty. */
  const reqBody = maskBodyKeys(reqBody0, (k) => `{{${paramVar(variables, k)}}}`);
  const parts = formParts(reqBody);
  if (parts) {
    // Text parts carry their value; a file part is named and left empty, because the bytes were never read.
    return {
      mode: 'formdata',
      formdata: parts.map((p) => (p.file
        ? { key: p.name, type: 'file', src: '', description: [p.file.name, p.file.type, p.file.size != null ? `${p.file.size} bytes` : ''].filter(Boolean).join(', ') }
        : { key: p.name, type: 'text', value: String(p.value ?? '') })),
      ...(parts.some((p) => p.file) ? { description: 'Attach the file parts yourself before running this.' } : {}),
    };
  }
  if (reqBody.kind === 'json') {
    return { mode: 'raw', raw: pretty(reqBody.text), options: { raw: { language: 'json' } } };
  }
  if (reqBody.kind === 'form') {
    return {
      mode: 'urlencoded',
      urlencoded: [...new URLSearchParams(reqBody.text)].map(([key, value]) => ({ key, value })), // r7-11-2: the pairs were broken before the generated {{x}} values went in
    };
  }
  if (reqBody.kind === 'text') return { mode: 'raw', raw: reqBody.text };
  // A file upload. Postman can express it, but not the bytes — and inventing a
  // path to a file on this machine would produce a collection that fails for
  // everyone including its author.
  return {
    mode: 'formdata',
    formdata: [],
    description: `${reqBody.note || reqBody.kind}. Attach the file yourself before running this.`,
  };
}

function pretty(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * The URL, with the origin lifted into `{{baseUrl}}`.
 *
 * Postman wants the URL both as a string and split into parts; giving it only
 * the string works but leaves the query editor empty, which is where anyone
 * actually edits a request.
 */
function urlBlock(href, baseOrigin, variables = new Map()) {
  const u = new URL(href);
  const templated = numberRepeats(templatePath(u.pathname));
  const sameOrigin = u.origin === baseOrigin;
  /* r2-11-1: a query value whose name says credential becomes {{name}}, declared empty, so neither url.raw nor url.query carries it. */
  let hidden = false;
  const pairs = [...u.searchParams].map(([key, value]) => {
    if (!isSecretParam(key)) return { key: neutral(key), value: neutral(value), plain: true };
    const v = paramVar(variables, key);
    hidden = true;
    return { key, value: `{{${v}}}` };
  });
  const search = hidden ? '?' + pairs.map((p) => encodeURIComponent(p.key) + '=' + (p.plain ? encodeURIComponent(p.value) : p.value)).join('&') : neutral(u.search);
  const raw = `${sameOrigin ? '{{baseUrl}}' : u.origin}${templated}${search}`;

  return {
    raw,
    host: [sameOrigin ? '{{baseUrl}}' : u.origin],
    path: templated.split('/').filter(Boolean),
    query: pairs.map(({ key, value }) => ({ key, value })),
    // The value is the first recorded segment, so the request runs as it was recorded (templated and pathname split alike).
    variable: templated
      .split('/')
      .map((s, i) => [s, u.pathname.split('/')[i] ?? ''])
      .filter(([s]) => s.startsWith(':'))
      .map(([s, seg]) => ({ key: s.slice(1), value: seg, description: 'Taken from the recording; change it per run.' })),
  };
}

/**
 * A saved response.
 *
 * The recorder keeps a body preview for failures only, so a 200 exports with
 * its status and headers and an empty body rather than a fabricated one. That
 * asymmetry is deliberate — recording every successful payload would be a
 * privacy problem and a storage one — and the description says so, because an
 * empty example that does not explain itself reads as a broken export.
 */
function exampleResponse(event) {
  return {
    name: `${event.status || 0}${event.error ? ', network error' : ''}`,
    status: event.error ? 'Error' : '',
    code: event.error ? 0 : event.status || 0,
    header: Object.entries(headerMap(event.resHeaders)).map(([key, value]) => ({ key, value: isSecretHeader(key) ? REDACTION : value })),
    body: event.responsePreview || '',
    _postman_previewlanguage: /json/i.test(headerValue(headerMap(event.resHeaders), 'content-type')) ? 'json' : 'text',
  };
}

/* ── the collection ────────────────────────────────────────────────────── */

/**
 * Build a Postman Collection v2.1 from a session.
 *
 * Grouped by host, then by endpoint. One item per endpoint, with each recorded
 * response attached as an example — so a tester opening the collection sees
 * "this returned 200 four times and 500 once" rather than five identical rows.
 */
/**
 * A version-4-shaped UUID derived from a string, so a re-export of the same session keeps its id (T-067).
 * Not a security hash: four FNV-1a passes, enough that two sessions never share one.
 */
export function uuidFrom(text) {
  const h = [0x811c9dc5, 0x01000193, 0x9e3779b1, 0x85ebca6b].map((seed) => {
    let x = seed >>> 0;
    for (const ch of String(text)) { x ^= ch.codePointAt(0); x = Math.imul(x, 0x01000193) >>> 0; }
    return x.toString(16).padStart(8, '0');
  }).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) & 3]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The origin behind {{baseUrl}}: the start URL's when it is http(s), else the first http(s) request's, also when no start URL was declared (never "null"). */
function baseOf(session, events) {
  const http = (u) => { try { const o = new URL(u); return /^https?:$/.test(o.protocol) ? o : null; } catch { return null; } };
  const start = session.startUrl ? http(session.startUrl) : null;
  if (start) return { base: session.startUrl, origin: start.origin };
  for (const e of events) {
    const u = e.kind === 'net' && e.url ? http(e.url) : null;
    if (u) return { base: null, origin: u.origin };
  }
  return { base: null, origin: null };
}

export function buildPostmanCollection(session, events, { name } = /** @type {{ name?: string }} */ ({})) {
  const { base, origin: baseOrigin } = baseOf(session, events);
  const net = events.filter((e) => e.kind === 'net' && e.url && !e.redirectedTo).map(normaliseNetEvent);

  const variables = new Map();
  if (baseOrigin) variables.set('baseUrl', baseOrigin);

  /** endpointKey → item */
  const byEndpoint = new Map();

  for (const event of net) {
    const href = absolute(event.url, base);
    let key;
    const op = operationOf(event);
    try {
      key = endpointKey(event, base) + (op ? ` #${op}` : '');
    } catch {
      continue; // not a URL we can group; skipped rather than exported broken
    }

    if (!byEndpoint.has(key)) {
      const u = new URL(href);
      byEndpoint.set(key, {
        origin: u.origin,
        item: {
          name: `${event.method || 'GET'} ${templatePath(u.pathname)}${op ? ` (${op})` : ''}`,
          request: {
            method: event.method || 'GET',
            header: headerList(event.reqHeaders, { variables }),
            url: urlBlock(href, baseOrigin, variables),
            body: bodyBlock(event.reqBody, variables),
            description:
              `Recorded by ${MAKER.product} from a real session. The origin is {{baseUrl}} so this ` +
              'collection can be pointed at any environment.' +
              (/\{\{/.test(JSON.stringify([event.reqHeaders, href, event.reqBody])) ? ' A literal {{ in the recorded request was written as { { so Postman does not expand it.' : ''),
          },
          response: [],
        },
      });
    }

    const entry = byEndpoint.get(key);
    // At most three examples: one success, one failure, one more. Beyond that
    // they stop being examples and start being a log.
    if (entry.item.response.length < 3) {
      const kinds = new Set(entry.item.response.map((r) => (r.code >= 400 || r.code === 0 ? 'bad' : 'good')));
      const kind = event.error || event.status >= 400 ? 'bad' : 'good';
      if (!kinds.has(kind) || entry.item.response.length < 2) {
        entry.item.response.push(exampleResponse(event));
      }
    }
  }

  // Folders by host. One host is the usual case, and a single folder wrapping
  // everything is a click for nothing — so it is only created when there are
  // genuinely several.
  const origins = [...new Set([...byEndpoint.values()].map((e) => e.origin))];
  const items =
    origins.length > 1
      ? origins.map((origin) => ({
          name: new URL(origin).host,
          item: [...byEndpoint.values()].filter((e) => e.origin === origin).map((e) => e.item),
        }))
      : [...byEndpoint.values()].map((e) => e.item);

  return {
    /*
     * `version` is a named argument of `provenance()`, not a field it reads off
     * the session — so omitting it stamped `"version": null` into every Postman
     * file this product has ever written. `background/export-build.js` passes
     * the build on the session object like every other exporter; this is the
     * line that hands it on. (research/54-real-session-review.md, finding 10.)
     */
    _provenance: provenance({ session, version: session?.version, kind: 'postman-collection' }),
    info: {
      _postman_id: uuidFrom(`qaw-${session.id}`),
      name: name || session.charter || 'QA Wrap session',
      description:
        `${stamp({ session })}\n\n` +
        `Captured from a QA session on ${new Date(session.startedAt).toISOString()}.\n\n` +
        `${plural(net.length, 'request')} recorded, ${plural(byEndpoint.size, 'distinct endpoint')}.\n\n` +
        'Origins are {{baseUrl}} and ids in paths are :variables, so this runs against any ' +
        'environment. Credentials were never recorded: the Authorization header is declared ' +
        'as {{token}} with no value.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
    // T-067: the collection schema allows string, boolean, any, number; `secret` exists only in an environment.
    variable: [...variables].map(([key, value]) => ({ key, value, type: 'string' })),
  };
}

/**
 * The environment file that goes with it.
 *
 * Separate on purpose: this is the half that holds real values, so it is the
 * half that does not get committed. The header says so, since a warning in the
 * file is the only one that travels with it.
 */
export function buildPostmanEnvironment(session, events, { name } = /** @type {{ name?: string }} */ ({})) {
  const collection = buildPostmanCollection(session, events);
  const baseOrigin = collection.variable.find((v) => v.key === 'baseUrl')?.value || '';

  return {
    id: `qaw-env-${session.id}`,
    name: `${name || session.charter || 'QA Wrap'}: recorded environment`,
    values: collection.variable.map((v) => ({
      key: v.key,
      value: v.key === 'baseUrl' ? baseOrigin : v.value,
      type: isSecretVar(v.key) ? 'secret' : 'default',
      enabled: true,
    })),
    _postman_variable_scope: 'environment',
    // The collection beside this file already carried its origin. A pair
    // where only one half is marked is exactly the pair that gets split up.
    //
    // These two were `_njb_provenance` and `_njb_note` until 5 September 2026.
    // Nothing reads a Postman environment back in — the product writes them and
    // Postman imports them — so there is no old key to keep reading, and an
    // environment saved before today keeps whatever it was written with.
    _qawrap_provenance: provenance({ session, version: session?.version, kind: 'postman-environment' }),
    _qawrap_note:
      'Holds the values, not the requests. Keep this file out of version control: ' +
      'anything you paste into a secret variable belongs here and nowhere else.',
  };
}

/** How many requests a collection would actually contain, for telling the user first. */
export function summarisePostman(session, events) {
  const collection = buildPostmanCollection(session, events);
  const count = (items) =>
    items.reduce((n, i) => n + (i.item ? count(i.item) : 1), 0);
  return {
    endpoints: count(collection.item),
    requests: events.filter((e) => e.kind === 'net' && e.url && !e.redirectedTo).length,
    variables: collection.variable.map((v) => v.key),
    secrets: collection.variable.filter((v) => isSecretVar(v.key)).map((v) => v.key),
  };
}
