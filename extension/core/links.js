/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Link checking: the request shape and the roll-up, pure so they can be tested against a stub `fetch`. A HEAD first, a GET
 * when the server refuses HEAD or the network fails; every request has a deadline. Broken is a status of 400 or more, or no
 * answer; a redirect is reported separately.
 */

import { isSecretParam } from './privacy.js';

export const SLOW_MS = 3000;
export const TIMEOUT_MS = 6000;

/** Only http(s) links can be checked; everything else is listed as skipped. */
export function checkable(href) {
  return /^https?:\/\//i.test(String(href || ''));
}

const MAX_HOPS = 5;

/**
 * One method, redirects walked by hand (r10-03-1): every hop is checked against hostClass before it is
 * requested, so a public link cannot send the tester's machine to its own network. Chrome hides the target of a
 * manual redirect (`opaqueredirect`); that link is reported as redirected and not followed.
 */
async function request(url, method, timeoutMs, fetchImpl) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  const own = hostClass(url);
  let cur = url;
  try {
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(cur, { method, redirect: 'manual', signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
      const out = (extra) => ({ status: res.status, finalUrl: cur, ms: Date.now() - t0, method, ...extra });
      const moved = res.status >= 300 && res.status < 400;
      const loc = moved ? res.headers?.get?.('location') : null;
      if (res.type === 'opaqueredirect') return out({ moved: true });
      if (!moved) return out();
      let next = '';
      try { next = new URL(loc, cur).href; } catch { /* no usable Location */ }
      if (!next || !checkable(next) || (hostClass(next) && hostClass(next) !== own)) return out({ moved: true });
      if (hop >= MAX_HOPS) return out({ error: 'too many redirects', ok: false });
      cur = next;
    }
  } finally {
    clearTimeout(timer);
  }
}

/** True when the query carries a secret-named parameter: such a link may be one-time or a logout, so it is never requested (r10-03-2). */
const secretQuery = (u) => {
  try { for (const k of new URL(u).searchParams.keys()) if (isSecretParam(k)) return true; } catch { /* not a URL */ }
  return false;
};

/** canRead(url) false: no host permission, so a fetch failure is CORS, not a dead link; skipped, never broken (H1). */
export async function checkUrl(url, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, canRead = async (_u) => true } = {}) {
  if (secretQuery(url)) return { url, status: 0, ok: false, ms: 0, skipped: true, reason: 'secret-query' };
  const t0 = Date.now();
  let out;
  try {
    out = await request(url, 'HEAD', timeoutMs, fetchImpl);
    if (out.status === 405 || out.status === 501 || out.status === 403) out = await request(url, 'GET', timeoutMs, fetchImpl);
  } catch (err) {
    try {
      out = await request(url, 'GET', timeoutMs, fetchImpl);
    } catch (err2) {
      const timedOut = err2?.name === 'AbortError';
      if (!timedOut && !(await canRead(url))) return { url, status: 0, ok: false, ms: Date.now() - t0, skipped: true, reason: 'unreadable' };
      return { url, status: 0, ok: false, ms: Date.now() - t0, error: timedOut ? `no answer in ${timeoutMs / 1000}s` : 'network error', method: 'GET' };
    }
  }
  const moved = out.finalUrl.replace(/\/$/, '') !== url.replace(/\/$/, '');
  const redirected = moved || out.moved === true;
  return {
    url,
    status: out.status,
    ok: out.ok ?? (out.moved === true || (out.status > 0 && out.status < 400)),
    ms: out.ms,
    method: out.method,
    ...(out.error ? { error: out.error } : {}),
    finalUrl: moved ? out.finalUrl : undefined,
    redirected,
  };
}

/** The kind of own-machine or own-network host (loopback, 0.0.0.0, RFC1918, CGNAT, fc00::/7, link-local, .local/.internal/.lan), else ''. */
const hostClass = (u) => {
  let h = '';
  try { h = new URL(u).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return ''; }
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h); // ::ffff:127.0.0.1 is printed ::ffff:7f00:1 and is the IPv4 host
  if (m) { const n = (parseInt(m[1], 16) << 16) | parseInt(m[2], 16); h = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
  return /^(localhost|127\.|0\.0\.0\.0$|::1?$)|\.localhost$/.test(h) ? 'lo' : /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|f[cd][0-9a-f]{2}:)/.test(h) || /\.(internal|lan|home\.arpa)$/.test(h) ? 'lan' : /^(169\.254\.|fe80:)/.test(h) ? 'll' : /\.local$/.test(h) ? 'mdns' : '';
};

/**
 * `checkUrl` over a list, a few at a time. Refused under a policy that turns integrations off; an own-machine or own-network link is left unchecked (a hole in the result) unless the tab is in the same class.
 * @param {string[]} urls
 * @param {{concurrency?: number, policy?: any, tabUrl?: string, fetchImpl?: any, timeoutMs?: number, canRead?: (u: string) => Promise<boolean>}} [o]
 */
export async function checkAll(urls, { concurrency = 10, policy, tabUrl, ...opts } = {}) {
  if (policy?.integrationsAllowed === false) throw Object.assign(new Error('Turned off by your organisation (integrationsAllowed). Ask your IT administrator.'), { code: 'POLICY_BLOCKED', key: 'integrationsAllowed' });
  const results = new Array(urls.length);
  const own = hostClass(tabUrl);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const c = hostClass(urls[i]);
      if (!c || c === own) results[i] = await checkUrl(urls[i], opts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}

export function classify(r) {
  if (!r || r.skipped) return 'skipped';
  if (!r.ok) return 'broken';
  if (r.redirected) return 'redirect';
  if (r.ms >= SLOW_MS) return 'slow';
  return 'ok';
}

/** The roll-up the popup says and the report draws. `links` carry {href, text, internal}; `results` align by index. */
export function summariseLinks(links, results) {
  const rows = links.map((l, i) => ({ ...l, ...(results[i] || {}), state: classify(results[i]) }));
  const pick = (state) => rows.filter((r) => r.state === state);
  return {
    total: rows.length,
    checked: rows.filter((r) => r.state !== 'skipped').length,
    ok: pick('ok').length,
    broken: pick('broken'),
    redirected: pick('redirect'),
    slow: pick('slow'),
    skipped: pick('skipped'),
    rows,
  };
}
