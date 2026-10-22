/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Sending one request the tester wrote, from the API page.
 *
 * ── why from the extension, not from the page under test ─────────────────
 *
 * The point of an API client inside a QA extension is that it can hit an
 * endpoint **mid-flow**: logged in, on staging, with whatever the session has
 * already put in the cookie jar, without exporting a token into a separate app.
 * `credentials: 'include'` from the extension (the API page, api/api.js) sends the profile's cookies for that
 * host, which is the same jar the tab under test is using, so a call made here
 * is authenticated exactly as the page's own calls are.
 *
 * Said precisely, because the difference matters to whoever debugs this: it is
 * the **profile's cookie jar**, not the page's JavaScript context. A token the
 * app keeps in `localStorage` or in a closure is not here, and has to be pasted
 * into an environment variable. Cookies, and only cookies, come for free.
 *
 * ── egress ────────────────────────────────────────────────────────────────
 *
 * Unchanged, and worth restating rather than assuming: this sends to exactly
 * the host the tester typed into the URL box, after `{{variable}}` substitution
 * they can see resolved, having been shown the final request before pressing
 * Send. Nothing is retried against another host, nothing is logged anywhere but
 * the local session, and there is no default endpoint of any kind. The caller's
 * `gate(url)` (api/api.js asks the managed policy, platform/policy.js) is asked
 * first and a hit refuses before anything is sent (r4-02-2).
 */

import { credentialed } from './egress.js';

/** Anything larger is summarised rather than carried into a session event. */
const MAX_BODY_IN_EVENT = 64 * 1024;

/** A request that never answers must not hold the panel for ever. */
const TIMEOUT_MS = 60_000;

/**
 * Headers a browser refuses to let a caller set.
 *
 * `fetch` drops these silently — the request goes out with the browser's own
 * value and nothing says the tester's was ignored, which reads as the server
 * misbehaving. They are refused here instead, by name, before anything is sent.
 */
const FORBIDDEN = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers',
  'access-control-request-method', 'connection', 'content-length', 'cookie2',
  'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'via',
]);

/** Bodyless by definition: a body on either is dropped by fetch anyway. */
const NO_BODY = new Set(['GET', 'HEAD']);

/**
 * The words for `key` in the page's language when the page has a translator (api.html loads
 * platform/i18n.js), else the English below, so the node tests and any non-page caller still read
 * a full sentence. `{name}` placeholders are filled either way. (r2-10-2)
 */
function t(key, vars, english) {
  const live = globalThis.QAWi18n;
  const said = live && typeof live.t === 'function' ? live.t(key, vars) : key;
  if (said && said !== key) return said;
  return String(english).replace(/\{(\w+)\}/g, (whole, name) => (vars && name in vars ? String(vars[name]) : whole));
}

function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(t('api.err.badUrl', { url: raw }, '"{url}" is not a URL. It needs a scheme, like https://.'));
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(t('api.err.scheme', { protocol: url.protocol }, 'QA Wrap only sends http and https requests. "{protocol}" is not one.'));
  }
  if (/\{\{|\}\}/.test(raw)) {
    throw new Error(t('api.err.unresolved', null, 'That URL still has an unresolved {{variable}} in it. Set it in the environment first.'));
  }
  return url;
}

/** The managed policy's refusal, in the page's language, naming the key that said no. */
function refuseByPolicy(hit) {
  throw Object.assign(new Error(t('api.err.policy', { key: hit.key }, 'Turned off by your organisation ({key}). Ask your IT administrator.')), { code: 'POLICY_BLOCKED', key: hit.key });
}

/**
 * Send it, and answer with everything a tester needs to judge the result.
 *
 * The timing is measured around the whole exchange including reading the body,
 * because "the request took 40ms and then streamed for nine seconds" is a
 * performance answer, and the number people quote is the one they waited.
 */
export async function sendApiRequest({ method = 'GET', url, headers = [], body = '', gate = null, guardRedirects = true } = {}) {
  const target = checkUrl(url);
  const hit = gate && (await gate(target.href));
  if (hit) refuseByPolicy(hit);
  // r5-03-1: a redirect is a second destination the tester never typed. While a restricting policy is set the
  // sender does not follow one (an `opaqueredirect` is refused); with no policy it follows, as it always has.
  const refused = [];
  const head = new Headers();
  for (const { name, value } of headers) {
    const key = String(name || '').trim();
    if (!key) continue;
    if (FORBIDDEN.has(key.toLowerCase())) {
      refused.push(key);
      continue;
    }
    try {
      head.append(key, String(value ?? ''));
    } catch {
      refused.push(key);
    }
  }

  // r4-02-3 (D-1010-72): a request that carries a credential header never follows a redirect either, policy or not.
  const guarded = (Boolean(gate) && guardRedirects !== false) || credentialed(head);
  const verb = String(method || 'GET').toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  const t0 = performance.now();

  let res;
  try {
    res = await fetch(target.href, {
      method: verb,
      headers: head,
      body: NO_BODY.has(verb) || !body ? undefined : body,
      // The whole reason this lives in the worker. See the note at the top.
      credentials: 'include',
      redirect: guarded ? 'manual' : 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const ms = Math.round(performance.now() - t0);
    if (err.name === 'AbortError') {
      throw Object.assign(new Error(t('api.err.timeout', { s: Math.round(TIMEOUT_MS / 1000) }, 'No answer after {s}s. The request was given up on.')), { ms });
    }
    // A failed fetch says "Failed to fetch" and nothing else, which is true of
    // a DNS failure, a refused connection, a bad certificate and CORS alike.
    // Naming the host at least tells the tester where to start.
    throw Object.assign(
      new Error(t('api.err.noAnswer', { host: target.host, error: err.message }, '{host} did not answer: {error}. Check the host, the scheme, and whether it needs a VPN.')),
      { ms }
    );
  }
  clearTimeout(timer);

  if (guarded && res.type === 'opaqueredirect') {
    throw Object.assign(new Error(t('api.err.redirect', null, 'The server answered with a redirect, which is not followed while your organisation\'s policy is set.')), { code: 'POLICY_BLOCKED', key: 'redirect', ms: Math.round(performance.now() - t0) });
  }
  if (gate && res.redirected) {
    // Belt and braces for a runtime that followed anyway: the final host is asked too, and a hit discards everything.
    const landed = await gate(res.url);
    if (landed) {
      try { await res.body?.cancel(); } catch { /* nothing to cancel */ }
      refuseByPolicy(landed);
    }
  }

  const text = await res.text().catch(() => '');
  const ms = Math.round(performance.now() - t0);

  return {
    startedAt,
    ms,
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    redirected: res.redirected,
    finalUrl: res.url,
    headers: [...res.headers].map(([name, value]) => ({ name, value })),
    bytes: new TextEncoder().encode(text).length,
    body: text.length > MAX_BODY_IN_EVENT ? text.slice(0, MAX_BODY_IN_EVENT) : text,
    truncated: text.length > MAX_BODY_IN_EVENT,
    refusedHeaders: refused,
    request: { method: verb, url: target.href, headers: [...head].map(([name, value]) => ({ name, value })), body: NO_BODY.has(verb) ? '' : body },
  };
}
