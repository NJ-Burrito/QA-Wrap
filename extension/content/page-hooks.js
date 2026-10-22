/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * MAIN-world page hooks.
 *
 * Runs at document_start in the page's own JS context so it patches fetch, XHR
 * and console *before* application code touches them.
 *
 * Under MV3 this is the only way to see response bodies: declarativeNetRequest
 * is rule-based and cannot read a response, and webRequest blocking is gone.
 *
 * It cannot use chrome.* APIs — it posts to the ISOLATED-world bridge instead.
 */
(() => {
  if (window.__UQA_HOOKED__) return;
  window.__UQA_HOOKED__ = true;

  const MAX_BODY = 2000;
  const BODY_READ_MS = 2000;

  /**
   * Asleep until told otherwise.
   *
   * The wrappers below are installed at document_start, which is the only moment
   * early enough to see a page's first request — but instrumentation that runs
   * before the tester has agreed to anything is exactly what the master switch
   * exists to prevent. So the wrappers go on and do nothing at all until the
   * extension is woken. The cost is one boolean per request.
   */
  let awake = false;

  /*
   * Until the first answer about waking arrives, events are held (bounded), then
   * sent if the answer is "awake" and discarded if not. Nothing leaves the page
   * while asleep — held events are only ever released by a wake-up.
   */
  let undecided = true;
  let held = [];

  /** Nothing is reported while asleep — not even a request that succeeded. */
  function emit(event) {
    if (!awake) {
      if (undecided && held.length < 200) held.push(event);
      return;
    }
    toBridge({ t: 'event', event });
  }

  /**
   * D-1010-78 (r4-02-1): what leaves the page leaves on a MessageChannel port, not as a window message.
   *
   * A page can post any window message it likes, so a window path cannot tell a
   * recorded request from a forged one. This script runs at document_start, before
   * any page script, and hands the bridge one end of a fresh channel; the bridge
   * keeps the first port it is given and acknowledges receipt over it, and only then
   * does anything flow. The page never holds our end of the channel, so it cannot
   * write to it. Until the acknowledgement, messages wait here (bounded); if the
   * bridge never answers, nothing leaves. A late injection into an already loaded
   * page is the residual: a page listener registered first can see the transfer.
   */
  let port = null; // our end of the channel the bridge acknowledged
  let outbox = []; // waiting for that acknowledgement
  let controlHook = null; // set below: handles awake / act / rules from the bridge
  const offered = []; // our ends of channels handed out and not yet acknowledged
  function toBridge(msg) {
    if (port) {
      try { port.postMessage(msg); } catch { /* payload not cloneable — drop it rather than break the page */ }
    } else if (typeof MessageChannel !== 'function') {
      // Only a non-browser harness lacks MessageChannel; the bridge no longer reads this shape, so it is inert in a page.
      try { window.postMessage(msg.t === 'event' ? { source: 'uqa-page', event: msg.event } : { source: 'uqa-rule-fired', ruleId: msg.ruleId }, '*'); } catch { /* ignore */ }
    } else if (outbox.length < 200) outbox.push(msg);
  }
  function offerPort() {
    if (typeof MessageChannel !== 'function' || port) return; // D-1010-89: once paired, a hello is never answered
    try {
      while (offered.length) offered.shift().close(); // one offer outstanding; a newer one replaces it
      const ch = new MessageChannel();
      const mine = ch.port1;
      offered.push(mine);
      mine.onmessage = (e) => {
        // D-1010-89: an ack counts only on the channel currently offered, and never after pairing.
        if (port === mine) { if (e.data && controlHook) controlHook(e.data); return; } // paired: control messages from the bridge
        if (e.data !== 'uqa-ack' || port || offered[0] !== mine) return;
        port = mine;
        offered.length = 0;
        const queued = outbox;
        outbox = [];
        for (const m of queued) toBridge(m);
      };
      window.postMessage({ source: 'uqa-port' }, '*', [ch.port2]);
    } catch { /* the page end could not be handed over — nothing leaves */ }
  }
  offerPort();
  // A bridge that loaded after this script (or after an extension update) asks again.
  window.addEventListener('message', (e) => { if (e.source === window && e.data?.source === 'uqa-hello') offerPort(); });

  function short(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin ? u.pathname + u.search : u.href;
    } catch {
      return String(url);
    }
  }

  /* ------------------------------------------------- failure facts (spec s3/s5) */

  /*
   * Raw facts only. This file holds no rule table and never classifies: `en`
   * (browser-supplied error name), `ev` (XHR event type), `act` (tester-action
   * counter, pushed by the bridge), `nh` (a hint from a browser-supplied name or
   * an exact string) and `rep` rows. core/signal.js re-derives everything at read
   * time and never trusts `nh`. `rep` rows carry the folded count `n` as a delta
   * since the previous flush, plus `storm:true` or `capped:true` for the two
   * synthetic cases.
   */
  const STORE_PER_FP_EPOCH = 5;
  const REP_FLUSH_MS = 1000;
  const STORM_RATE = 20; // per second ...
  const STORM_SECS = 3; // ... for this many consecutive seconds
  const SESSION_FAILURE_ROW_CAP = 300;
  const nativeT = window.setTimeout || globalThis.setTimeout;
  const setT = typeof nativeT === 'function' ? nativeT.bind(window) : () => 0; // a page that mocks timers must not stall the flush

  let act = 0;
  let lastActAt = 0; // cap1022: when the tester last acted, so a 4xx can be tied to a click
  const QUIET_MS = 5000;
  const keys = new Map(); // `${cheapKey}#${act}` -> { stored, pend, sec, cnt, hot, storm, proto }
  let storedTotal = 0;
  let overCap = 0;
  let flushTimer = 0;

  const errName = (x) => (x && typeof x.name === 'string' ? x.name.slice(0, 40) : undefined);

  /**
   * Raw fact `src`: absolute URL (no query, no hash) of the first script frame
   * that is not this extension. Never a classification; core/signal.js decides.
   */
  const bareUrl = (u) => String(u).split(/[?#]/)[0].slice(0, 300);
  function srcOf(stack) {
    for (const m of String(stack || '').matchAll(/((?:https?|file|blob):[^\s()]+?):\d+:\d+/g)) {
      if (!m[1].includes('chrome-extension')) return bareUrl(m[1]);
    }
    return undefined;
  }

  const RO_MESSAGES = [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications.',
  ];

  /** Hint for the worker's cheap tally. Exact names and anchored prefixes only, never a substring. */
  function hintFor(ev, raw) {
    if (ev.en === 'AbortError' || ev.ev === 'abort') return 'abort';
    if (ev.kind === 'pageerror') {
      if (RO_MESSAGES.includes(raw)) return 'ro';
      if (raw && raw.startsWith('Script error.') && !ev.stack) return 'opaque';
    }
    if (ev.kind === 'console' && ev.level === 'error') {
      const t = ev.text || '';
      if (t.startsWith('Warning: ') || t.startsWith('[Vue warn]') || /^NG0\d+/.test(t) ||
          t.startsWith('Download the React DevTools for a better development experience')) return 'dev';
    }
    return undefined;
  }

  const isFailure = (ev) =>
    ev.kind === 'net' ? ev.error === true || ev.status >= 400 || ev.ev === 'gql'
    : ev.kind === 'console' ? ev.level === 'error' || ev.level === 'assert'
    : ev.kind === 'pageerror';

  const squash = (t) => String(t || '').replace(/\d+/g, '#').slice(0, 100);

  function cheapKey(ev) {
    if (ev.kind === 'net') {
      let o = '';
      let p = ev.url;
      try { const u = new URL(ev.url, location.href); o = u.origin; p = u.pathname + u.search; } catch { /* keep as is */ }
      return `net|${ev.method}|${o}|${squash(p)}|${ev.ev === 'gql' ? `gql:${ev.operation || ''}` : ev.status || ev.en || ev.ev || 0}`;
    }
    return `${ev.kind}|${ev.level || ''}|${squash(ev.text)}`;
  }

  function repRow(s, extra) {
    const e = s.proto;
    return {
      kind: 'rep', ofKind: e.kind, method: e.method, url: e.url, status: e.status,
      en: e.en, ev: e.ev, nh: e.nh, operation: e.operation, text: e.text ? String(e.text).slice(0, 200) : undefined,
      act: e.act, ts: Date.now(), ...extra,
    };
  }

  function flushReps() {
    flushTimer = 0;
    for (const s of keys.values()) {
      if (s.pend) { emit(repRow(s, { n: s.pend })); s.pend = 0; }
    }
    if (overCap) { emit({ kind: 'rep', capped: true, n: overCap, act, ts: Date.now() }); overCap = 0; }
  }
  const wantFlush = () => { if (!flushTimer) flushTimer = setT(flushReps, REP_FLUSH_MS); };
  window.addEventListener('pagehide', () => { if (awake) flushReps(); });

  /**
   * r5-05-1: the first MAX_BODY characters of a failing response, read from a clone through its reader.
   * Capped in bytes, bounded by a timer, resolves undefined instead of ever rejecting or hanging.
   */
  function previewOf(res, cap = MAX_BODY) {
    return new Promise((resolve) => {
      let reader;
      let settled = false;
      const done = (text) => {
        if (settled) return;
        settled = true;
        try { reader?.cancel().catch(() => {}); } catch { /* already closed */ }
        resolve(text);
      };
      try {
        reader = res.clone().body.getReader();
        setT(() => done(undefined), BODY_READ_MS);
        const dec = new TextDecoder();
        let text = '';
        let bytes = 0;
        const pump = () => reader.read().then(({ done: end, value }) => {
          if (value) { bytes += value.length; text += dec.decode(value, { stream: true }); }
          if (end || bytes >= cap * 4 || text.length >= cap) done(text.slice(0, cap));
          else pump();
        }, () => done(undefined));
        pump();
      } catch {
        done(undefined); // opaque, bodyless or already consumed
      }
    });
  }

  /**
   * Every natural request/console/uncaught outcome goes through here. Successes
   * pass straight through; a failure is stored in full only the first
   * STORE_PER_FP_EPOCH times per (cheapKey, act); the rest are counted and go out
   * as one `rep` row per second, a storm becomes one row, and the session is capped.
   */
  function report(ev, raw, actAtStart) {
    if (!awake && !undecided) return;
    // r3-05-1: a request belongs to the action that was current when it STARTED, not when its answer came back.
    ev.act = Number.isInteger(actAtStart) ? actAtStart : act;
    if (isFailure(ev) && !ev.overridden && ev.via !== 'api') {
      // cap1022 quiet detection: a logged console.error is not an uncaught error (kept as a warning line), and a 4xx only counts when a tester action caused it; 5xx, transport errors, uncaught errors and GraphQL errors always count.
      if (ev.kind === 'console') ev.level = 'warn';
      else if (ev.kind === 'net' && ev.ev !== 'gql' && ev.status >= 400 && ev.status < 500 && !(act > 0 && Date.now() - lastActAt < QUIET_MS + (ev.durationMs || 0))) return;
    }
    if (!isFailure(ev)) return emit(ev);
    const h = hintFor(ev, raw);
    if (h) ev.nh = h;

    const k = `${cheapKey(ev)}#${ev.act}`;
    let s = keys.get(k);
    if (!s) keys.set(k, (s = { stored: 0, pend: 0, sec: 0, cnt: 0, hot: 0, storm: false, proto: ev }));

    const sec = Math.floor(Date.now() / 1000);
    if (sec !== s.sec) {
      s.hot = s.cnt > STORM_RATE && sec === s.sec + 1 ? s.hot + 1 : 0;
      s.rate = s.cnt; // occurrences in the last full second
      s.sec = sec;
      s.cnt = 0;
    }
    s.cnt++;
    if (!s.storm && s.hot >= STORM_SECS) {
      s.storm = true;
      emit(repRow(s, { n: s.rate, storm: true }));
    }

    if (!s.storm && s.stored < STORE_PER_FP_EPOCH) {
      if (storedTotal < SESSION_FAILURE_ROW_CAP) {
        s.stored++;
        storedTotal++;
        return emit(ev);
      }
      overCap++; // capped: counter only
    } else s.pend++;
    wantFlush();
  }

  /* --------------------------------------------------------- override rules */

  /**
   * Feature 6: request override.
   *
   * MV3's declarativeNetRequest is rule-based and cannot read or replace a
   * response body, and blocking webRequest is gone — so forcing a 500, an empty
   * payload or a slow response has to happen right here, in the page's own
   * fetch/XHR. Rules arrive from the extension a few milliseconds after
   * document_start, so a request fired in the very first tick may slip through;
   * that is inherent, not a bug to chase.
   */
  let rules = [];

  /**
   * r9-02-2 (OF-10): awake, act and rules arrive on the same paired port as the events leave on, so a page cannot forge them.
   * A harness without MessageChannel keeps the old window messages (inert in a real page, which always has the constructor).
   */
  function control(d) {
    if (d.t === 'awake') {
      awake = !!d.awake;
      undecided = false;
      const queued = held;
      held = [];
      if (awake) for (const ev of queued) emit(ev);
      if (!awake) rules = [];
    } else if (d.t === 'act') {
      if (Number.isInteger(d.act) && d.act > act) lastActAt = Date.now();
      act = Number.isInteger(d.act) && d.act >= 0 ? Math.min(d.act, 1e9) : act;
    } else if (d.t === 'rules') rules = Array.isArray(d.rules) ? d.rules : [];
  }
  controlHook = control;
  if (typeof MessageChannel !== 'function') {
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (d?.source === 'uqa-awake') control({ t: 'awake', awake: d.awake });
      else if (d?.source === 'uqa-act') control({ t: 'act', act: d.act });
      else if (d?.source === 'uqa-rules') control({ t: 'rules', rules: d.rules });
    });
  }

  /* ── GraphQL ──────────────────────────────────────────────────────────

     Why GraphQL needs its own matching at all: every operation on a GraphQL
     API is a POST to the *same URL*. A rule that matches on the URL matches
     the whole API, so "make the checkout mutation fail" is not expressible —
     which is precisely the rule anybody actually wants.

     The operation name is in the request body, so the matcher has to read it.  */

  /**
   * What a request body says it is asking for.
   *
   * Handles the three shapes in the wild: a JSON object, a JSON array (batched
   * operations), and the GET form where the query is in the query string.
   * Returns null for anything that is not GraphQL, so the cost on a normal REST
   * request is one `typeof` and a `startsWith`.
   */
  function graphqlInfo(body, url) {
    let doc = null;

    if (typeof body === 'string' && body.trim().startsWith('{')) {
      try {
        doc = JSON.parse(body);
      } catch {
        return null;
      }
    } else if (typeof body === 'string' && body.trim().startsWith('[')) {
      try {
        const batch = JSON.parse(body);
        doc = Array.isArray(batch) ? batch[0] : null;
      } catch {
        return null;
      }
    } else if (!body && url) {
      try {
        const q = new URL(url, location.href).searchParams;
        if (q.get('query')) doc = { query: q.get('query'), operationName: q.get('operationName') };
      } catch {
        return null;
      }
    }

    if (!doc || typeof doc.query !== 'string') return null;

    // `operationName` is optional even when the document names its operation,
    // so fall back to parsing it out — a rule that only worked when the client
    // happened to send the field would be unusable on half the APIs out there.
    const named = doc.operationName ||
      (doc.query.match(/^\s*(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/m) || [])[1] ||
      null;

    const kind = (doc.query.match(/^\s*(query|mutation|subscription)\b/m) || [])[1] || 'query';

    return { operationName: named, operationType: kind, query: doc.query, variables: doc.variables || null };
  }

  /**
   * A GraphQL error response.
   *
   * **HTTP 200 with an `errors` array** — which is the whole point. A client
   * that checks `res.ok` and nothing else sails straight past a GraphQL failure
   * and renders undefined into the page, and that bug is invisible until
   * somebody forces it. Forcing a 500 instead tests a different path and misses
   * it entirely.
   */
  function graphqlErrorBody(rule, info) {
    return JSON.stringify({
      data: rule.nullData === false ? undefined : null,
      errors: [
        {
          message: rule.message || 'Forced by QA Wrap',
          path: rule.path ? String(rule.path).split('.') : undefined,
          extensions: {
            code: rule.code || 'INTERNAL_SERVER_ERROR',
            // The flag that says this failure was forced rather than real. It
            // was `njb` until 5 September 2026; the body is written into the
            // page under test and never read back, so nothing has to accept
            // both names.
            qawrap: true,
            operation: info?.operationName || null,
          },
        },
      ],
    });
  }

  /**
   * Does this rule apply to this request?
   *
   * `context` carries the request body when there is one, so a rule can match
   * on a GraphQL operation or on any substring of what is being sent. Reading
   * the body is not free, so it is passed in by the caller — which already has
   * it — rather than fetched here.
   */
  function ruleHits(r, full, method, context) {
    if (!awake) return false;
    if (!r.enabled) return false;
    if (r.method && r.method !== 'ANY' && r.method !== method) return false;
    if (r.remaining != null && r.remaining <= 0) return false;
    // GraphQL: match the operation, not the URL. Every operation on a GraphQL
    // API posts to the same endpoint, so a URL match is a match on the whole
    // API and cannot express "make the checkout mutation fail".
    if (r.operation) {
      const info = context?.graphql;
      if (!info) return false;
      const wanted = String(r.operation);
      const got = info.operationName || '';
      const nameHit = r.operationIsRegex
        ? (() => {
            try {
              return new RegExp(wanted).test(got);
            } catch {
              return false;
            }
          })()
        : got === wanted;
      if (!nameHit) return false;
      if (r.operationType && r.operationType !== 'any' && info.operationType !== r.operationType) return false;
    }

    // Match on what is being sent, for the APIs that put the interesting part
    // in the payload rather than the path.
    if (r.bodyContains && !String(context?.body || '').includes(r.bodyContains)) return false;

    if (r.isRegex) {
      try {
        return new RegExp(r.pattern).test(full);
      } catch {
        return false;
      }
    }
    return !r.pattern || full.includes(r.pattern);
  }

  /**
   * Every matching rule, not just the first.
   *
   * A single-rule model cannot express "send this header AND make it fail",
   * which is most of what request manipulation is actually used for. So rules
   * compose: the modifiers (redirect, headers, delay) all apply in order, and
   * the first terminal action (fail / status / body) wins and stops the
   * request. Terminal actions do not stack — two of them would just be an
   * argument about which 500 to send.
   */
  function matchRules(url, method, context) {
    const full = String(url);
    const hits = rules.filter((r) => ruleHits(r, full, method, context));
    return {
      all: hits,
      // `mock` and `graphqlError` are terminal too: both replace the response,
      // and a request cannot be answered twice.
      terminal:
        hits.find(
          (r) =>
            r.action === 'fail' ||
            r.action === 'status' ||
            r.action === 'body' ||
            r.action === 'mock' ||
            r.action === 'graphqlError'
        ) || null,
    };
  }

  /** Kept for the single-rule call sites; the composed set is what drives behaviour. */
  function matchRule(url, method, context) {
    const { all, terminal } = matchRules(url, method, context);
    return terminal || all[0] || null;
  }

  /**
   * Rewrite a URL, with $1..$9 from the match pattern when it is a regex.
   * Requestly's redirect rule is the one people miss most: pointing a
   * production bundle at a local build, or an API at a mock host, without
   * touching the app.
   */
  function redirectUrl(rule, full) {
    if (!rule.redirectTo) return full;
    if (rule.isRegex) {
      try {
        return full.replace(new RegExp(rule.pattern), rule.redirectTo);
      } catch {
        return full;
      }
    }
    // A bare host swap is the common case and does not need a regex.
    if (rule.pattern && full.includes(rule.pattern)) return full.replace(rule.pattern, rule.redirectTo);
    return rule.redirectTo;
  }

  /**
   * Header edits, applied to a plain object so both fetch and XHR can use them.
   * `null` as a value removes the header — the way to test what an app does
   * without an Authorization or a CSRF token.
   */
  function editHeaders(base, edits) {
    const out = { ...base };
    for (const [name, value] of Object.entries(edits || {})) {
      const key = Object.keys(out).find((k) => k.toLowerCase() === name.toLowerCase()) || name;
      if (value === null || value === '') delete out[key];
      else out[key] = value;
    }
    return out;
  }

  const headersToObject = (h) => {
    const out = {};
    if (!h) return out;
    if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => (out[k] = v));
    else if (Array.isArray(h)) for (const [k, v] of h) out[k] = v;
    else Object.assign(out, h);
    return out;
  };

  /**
   * Count a firing locally AND tell the extension.
   *
   * The local decrement keeps this page honest between messages; the report to
   * the extension is what makes the budget survive a navigation. Without the
   * second half, a rule set to fire three times fired three times on every page
   * the tester visited.
   */
  function consume(rule) {
    if (rule.remaining != null) rule.remaining -= 1;
    toBridge({ t: 'rule-fired', ruleId: rule.id });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** r3-05-2: how much of a GraphQL answer is scanned for `errors` (a truncated body falls back to a shape test). */
  const GQL_READ = 65536;
  function gqlFacts(text, info) {
    if (!text) return undefined;
    let n = 0;
    let errs;
    try {
      const j = JSON.parse(text);
      for (const d of Array.isArray(j) ? j : [j]) {
        if (Array.isArray(d?.errors) && d.errors.length) { n += d.errors.length; errs = errs || d.errors; }
      }
    } catch {
      if (/"errors"\s*:\s*\[\s*\{/.test(text)) n = 1; // cut off before the end: the shape is enough
    }
    if (!n) return undefined;
    let preview;
    try { preview = JSON.stringify(redact(errs)).slice(0, MAX_BODY); } catch { /* keep none */ }
    // `ev: 'gql'` is the failure marker (an existing structural field): HTTP 200, error:false, the count in `text`.
    return { ev: 'gql', text: `GraphQL: ${n} error${n > 1 ? 's' : ''}`, operation: info.operationName || undefined, responsePreview: preview };
  }

  /* ------------------------------------------------------------------- fetch */

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = async function (...args) {
      const started = performance.now();
      const actAtStart = act;
      const req = args[0];
      const init = args[1] || {};
      let url = typeof req === 'string' ? req : req?.url || String(req);
      const method = (init.method || (typeof req === 'object' && req?.method) || 'GET').toUpperCase();

      // The body is read once, here, and handed to the matcher — a GraphQL
      // rule matches on the operation name, which only exists in the payload.
      // `init.body` is the only safe place to read it: a Request object's body
      // is a stream that can be consumed exactly once, and reading it would
      // send the application's request out empty.
      const rawBody = typeof init.body === 'string' ? init.body : (typeof URLSearchParams === 'function' && init.body instanceof URLSearchParams ? init.body.toString() : null);
      const context = { body: rawBody, graphql: graphqlInfo(rawBody, url) };
      const { all, terminal } = matchRules(url, method, context);
      const rule = terminal || all[0] || null;
      const requested = url;

      if (all.length) {
        all.forEach(consume);

        // Modifiers first, in the order the rules were written.
        let headerEdits = null;
        let totalDelay = 0;
        for (const r of all) {
          if (r.redirectTo) url = redirectUrl(r, url);
          if (r.headers) headerEdits = { ...(headerEdits || {}), ...r.headers };
          if (r.delayMs) totalDelay += r.delayMs;
        }
        if (totalDelay) await sleep(totalDelay);

        if (headerEdits || url !== requested) {
          const isReq = typeof Request === 'function' && req instanceof Request;
          const merged = headerEdits
            ? editHeaders(headersToObject(init.headers || (isReq ? req.headers : null)), headerEdits)
            : init.headers;
          if (isReq) {
            // A Request carries its own method and body. Rebuilding from a bare
            // url + init turned a POST into a bodyless GET, so copy them across
            // (the body is read from a clone, the original stays untouched).
            const bodyless = /^(GET|HEAD)$/i.test(req.method);
            const body = bodyless || init.body !== undefined ? init.body : await req.clone().arrayBuffer();
            args = [new Request(url, {
              method: req.method, mode: req.mode, credentials: req.credentials, cache: req.cache,
              redirect: req.redirect, referrer: req.referrer, integrity: req.integrity, signal: req.signal,
              ...init, headers: merged || req.headers, body,
            })];
          } else {
            args = [url, merged ? { ...init, headers: merged } : init];
          }
        }

        if (url !== requested) {
          emit({
            kind: 'net', via: 'fetch', method, url: short(requested), status: 0, ok: true,
            durationMs: 0, error: false, redirectedTo: short(url), overridden: true,
            ruleLabel: all.find((r) => r.redirectTo)?.label, ts: Date.now(),
          });
        }
      }

      // Captured before the call, because `init` is the only place the outgoing
      // headers and body exist — after `nativeFetch` returns they are gone, and
      // a request tool that cannot say what it sent is half a tool.
      const sent = {
        reqHeaders: safeHeaders(init.headers || (typeof req === 'object' ? req?.headers : null)),
        // Only `init.body`. A `Request` object's body is a stream that can be
        // read exactly once, and reading it here would consume the body the
        // application is about to send — the request would go out empty. So
        // when `fetch(new Request(...))` is used the body is genuinely not
        // available, and the export says so rather than inventing one.
        reqBody: safeBody(init.body),
      };

      if (terminal) {
        const rule = terminal;

        if (rule.action === 'fail') {
          emit({
            kind: 'net', via: 'fetch', method, url: short(url), status: 0, ok: false,
            durationMs: performance.now() - started, error: true,
            text: 'Forced network failure (UQA override)', overridden: true,
            ruleLabel: rule.label, ts: Date.now(),
          });
          throw new TypeError('Failed to fetch');
        }

        /**
         * A canned response, with the shape a real one would have.
         *
         * Separate from `status` because the intent is different: `status` is
         * "break this", `mock` is "answer this without a server", which is what
         * lets a front end be exercised against an endpoint nobody has built.
         */
        if (rule.action === 'mock') {
          const status = rule.status || 200;
          const body = rule.body != null ? String(rule.body) : '{}';
          if (rule.delayMs) await sleep(rule.delayMs);
          emit({
            kind: 'net', via: 'fetch', method, url: short(url), status, ok: status < 400,
            durationMs: performance.now() - started, error: false,
            responsePreview: body.slice(0, MAX_BODY),
            mocked: true, overridden: true, ruleLabel: rule.label, ...sent, ts: Date.now(),
          });
          return new Response(body, {
            status,
            headers: editHeaders(
              { 'content-type': rule.contentType || 'application/json' },
              rule.responseHeaders
            ),
          });
        }

        /**
         * A GraphQL error, which is an HTTP **200**.
         *
         * That is the whole reason this action exists rather than reusing
         * `status`. A GraphQL failure comes back 200 with an `errors` array, so
         * a client that checks `res.ok` and nothing else sails straight past it
         * and renders undefined into the page. Forcing a 500 tests a different
         * code path and misses that bug completely.
         */
        if (rule.action === 'graphqlError') {
          const body = graphqlErrorBody(rule, context.graphql);
          emit({
            kind: 'net', via: 'fetch', method, url: short(url), status: 200, ok: true,
            durationMs: performance.now() - started, error: false,
            responsePreview: body.slice(0, MAX_BODY),
            graphqlError: true, overridden: true, ruleLabel: rule.label,
            operation: context.graphql?.operationName || null,
            ...sent, ts: Date.now(),
          });
          return new Response(body, {
            status: 200,
            headers: editHeaders({ 'content-type': 'application/json' }, rule.responseHeaders),
          });
        }

        if (rule.action === 'status' || rule.action === 'body') {
          const status = rule.status || 500;
          const body = rule.body != null ? rule.body : '';
          emit({
            kind: 'net', via: 'fetch', method, url: short(url), status, ok: status < 400,
            durationMs: performance.now() - started, error: false,
            responsePreview: String(body).slice(0, MAX_BODY),
            overridden: true, ruleLabel: rule.label, ts: Date.now(),
          });
          return new Response(body, {
            status,
            statusText: rule.statusText || '',
            // Response headers the page will see. Overriding CORS or cache
            // headers is half of what a request tool is reached for.
            headers: editHeaders(
              { 'content-type': rule.contentType || 'application/json' },
              rule.responseHeaders
            ),
          });
        }
      }

      return nativeFetch.apply(this, args).then(
        (res) => {
          // r5-05-1: the time is the response's, taken before any body read, and the page gets its
          // response at once; a failing body is read detached, bounded, and reported once after.
          const durationMs = performance.now() - started;
          const ts = Date.now();
          const fire = (responsePreview, gql) => report({
            kind: 'net', via: 'fetch', method, url: short(url),
            status: res.status, ok: res.ok, durationMs,
            error: false, responsePreview, ...sent,
            resHeaders: safeHeaders(res.headers),
            overridden: rule ? true : undefined, ruleLabel: rule?.label,
            ...gql, ts,
          }, undefined, actAtStart);
          if (!res.ok) previewOf(res).then(fire, () => fire());
          else if (awake && !rule && context.graphql && /json|graphql/i.test(res.headers?.get?.('content-type') || '')) {
            // r3-05-2: a GraphQL failure is HTTP 200 with `errors`; read a detached, bounded clone, report once.
            previewOf(res, GQL_READ).then((t) => fire(undefined, gqlFacts(t, context.graphql)), () => fire());
          } else fire();
          return res;
        },
        (err) => {
          report({
            kind: 'net', via: 'fetch', method, url: short(url),
            status: 0, ok: false, durationMs: performance.now() - started,
            error: true, text: String(err?.message || err), en: errName(err), ...sent, ts: Date.now(),
          }, undefined, actAtStart);
          throw err;
        }
      );
    };
  }

  /* ------------------------------------------------------- form submissions */

  /**
   * A <form> submit is a navigation, so the fetch/XHR hooks above never see it: "Break a request" on a Login button
   * that posts a plain form left the real page loading (H1, audit lane G). When the app has not taken the submit over
   * itself (defaultPrevented), a matching rule that fails or answers (status / body / mock / fail) cancels the
   * navigation and writes that answer into the page; a matching delay waits, then submits natively.
   * ponytail: redirect and header rules need the network layer and are not applied to forms; the answer replaces the
   * document in place (the URL stays), where a real 500 would also change the address.
   */
  window.addEventListener('submit', (ev) => {
    const form = /** @type {any} */ (ev.target);
    if (ev.defaultPrevented || !rules.length || form?.tagName !== 'FORM') return;
    // A button's formAction/formMethod answer the DOCUMENT url / "" when the button sets nothing, never the form's: read
    // them only when the attribute is there (K1: real Login click matched /login, not /authenticate, so no rule fired).
    const sub = ev.submitter;
    const has = (n) => sub?.getAttribute?.(n) != null;
    const url = has('formaction') ? sub.formAction : typeof form.action === 'string' && form.action ? form.action : location.href;
    const method = String((has('formmethod') ? sub.formMethod : form.method) || 'get').toUpperCase();
    let body = '';
    try { body = new URLSearchParams(/** @type {any} */ (new FormData(form))).toString(); } catch { /* files or no FormData: match on the URL only */ }
    const { all, terminal } = matchRules(url, method, { body });
    const answers = terminal && terminal.action !== 'graphqlError' ? terminal : null;
    const wait = all.reduce((n, r) => n + (r.delayMs || 0), 0);
    if (!answers && !wait) return;
    ev.preventDefault();
    all.filter((r) => r === answers || r.delayMs).forEach(consume);
    (async () => {
      const started = performance.now();
      if (wait) await sleep(wait);
      if (!answers) return Object.getPrototypeOf(form).submit.call(form);
      const failed = answers.action === 'fail';
      const status = failed ? 0 : answers.status || (answers.action === 'mock' ? 200 : 500);
      const text = failed ? 'This site can’t be reached' : answers.body != null ? String(answers.body) : '';
      emit({
        kind: 'net', via: 'document', method, url: short(url), status, ok: !failed && status < 400,
        durationMs: performance.now() - started, error: failed,
        ...(failed && { text: 'Forced network failure (UQA override)' }),
        responsePreview: text.slice(0, MAX_BODY), overridden: true, ruleLabel: answers.label, ts: Date.now(),
      });
      try {
        const shown = text || (failed ? '' : status >= 400 ? `HTTP ERROR ${status}` : '');
        document.open();
        document.write(`<!doctype html><meta charset="utf-8"><title>${status || 'Error'}</title>${/html/i.test(answers.contentType || '') ? shown : `<pre>${shown.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`}`);
        document.close();
      } catch {
        Object.getPrototypeOf(form).submit.call(form); // the page would not take the answer: let the submit through
      }
    })();
  });

  /* ------------------------------------------------- what a request carried */

  /**
   * Which header and field names never leave the page with a value.
   *
   * A deny-list is the wrong shape for secrets in general — you cannot
   * enumerate every name a team will invent — but here it is the *second* line
   * of defence, not the only one: nothing below records a value it was not
   * asked to, request bodies are truncated, and the whole mechanism is inert
   * until the tester wakes the extension. The list catches the names that
   * actually appear, and the redaction is visible in the output rather than
   * silent, so a tester can see that something was held back.
   */
  /* privacy-names:begin (generated from core/privacy-names.json; do not edit) */
const SECRET_NAMES = new Set(["pass","password","passwd","pwd","passcode","passphrase","secret","token","auth","authorization","bearer","session","sessionid","phpsessid","jsessionid","aspsessionid","cookie","apikey","otp","pin","credit","creditcard","card","cardnumber","cvv","cvc","ssn","iban","jwt","csrf","xsrf","sid","privatekey","accesskey","subscriptionkey","functionskey","secretkey","signingkey","licensekey","dpop","nationalid","كلمةالمرور","رقمسري"]);
const isSecretName = (name) => { const t = String(name).replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z\d\u0600-\u06ff]+/).filter(Boolean); return t.some((w, i) => SECRET_NAMES.has(w) || (i > 0 && SECRET_NAMES.has(t[i - 1] + w))); };
/* privacy-names:end */
  const SECRET = { test: isSecretName };

  const REDACTED = '«redacted»';

  function safeHeaders(headers) {
    const out = {};
    for (const [name, value] of Object.entries(headersToObject(headers) || {})) {
      out[name] = SECRET.test(name) ? REDACTED : String(value).slice(0, 300);
    }
    return out;
  }

  /**
   * A request body, small enough to be evidence and safe enough to hand over.
   *
   * JSON is walked and redacted key by key, because a password inside a JSON
   * object is the common case and a whole-body regex would either miss it or
   * destroy the structure. Anything else is truncated and, if it looks like it
   * carries a secret at all, dropped entirely — a form-encoded body is not
   * worth guessing at.
   */
  function safeBody(body) {
    if (body == null || body === '') return null;
    // D-1010-100: a URLSearchParams is a form body; coerce it so it takes the redacting form branch below.
    if (typeof URLSearchParams === 'function' && body instanceof URLSearchParams) { try { body = body.toString(); } catch { return null; } if (body === '') return null; }
    // D-1010-69 (r4-11-3): a FormData is read entry by entry (`entries()` is synchronous); a Blob or a buffer is not
    // readable synchronously and is usually a file upload, so it is named and never guessed at.
    if (typeof body !== 'string') {
      if (typeof FormData === 'function' && body instanceof FormData) {
        try {
          // Secret names redacted, 50 parts, 2,000 characters a value; a file is its name, type and size and its bytes are never read.
          const parts = [];
          let truncated = false;
          for (const [name, v] of body.entries()) {
            if (parts.length >= 50) { truncated = true; break; }
            const key = String(name).slice(0, 200);
            if (typeof v === 'string') {
              if (v.length > MAX_BODY) truncated = true;
              parts.push({ name: key, value: SECRET.test(name) ? REDACTED : v.slice(0, MAX_BODY) });
            } else parts.push({ name: key, file: { name: String(v?.name ?? ''), type: String(v?.type ?? ''), size: Number(v?.size) || 0 } });
          }
          return truncated ? { kind: 'FormData', parts, truncated } : { kind: 'FormData', parts };
        } catch { /* an unreadable entry list falls through to the note below */ }
      }
      const kind = body?.constructor?.name || 'binary';
      return { kind, note: `${kind} body: not recorded` };
    }

    const text = body.slice(0, MAX_BODY);
    try {
      const parsed = JSON.parse(text);
      return { kind: 'json', text: JSON.stringify(redact(parsed)) };
    } catch {
      /* not JSON */
    }
    if (/^[\w.%+-]+=/.test(text) && text.includes('=')) {
      const params = new URLSearchParams(text);
      const clean = new URLSearchParams();
      for (const [k, v] of params) clean.append(k, SECRET.test(k) ? REDACTED : v);
      return { kind: 'form', text: clean.toString() };
    }
    return { kind: 'text', text: SECRET.test(text) ? REDACTED : text };
  }

  function redact(value, depth = 0) {
    if (value == null || typeof value !== 'object') return value;
    if (depth > 6) return '[truncated]'; // r2-05-7: a deeper subtree is never passed through unscrubbed
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }

  /* --------------------------------------------------------------------- XHR */

  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    const setHeader = XHR.prototype.setRequestHeader;

    // r3-05-5: the headers the page (and any override rule) set, kept for the record; values go through safeHeaders.
    XHR.prototype.setRequestHeader = function (name, value) {
      try {
        const h = (this.__uqaReqH ||= {});
        h[name] = name in h ? `${h[name]}, ${value}` : String(value);
      } catch { /* a frozen instance: the call still goes through */ }
      return setHeader.call(this, name, value);
    };

    XHR.prototype.open = function (method, url, ...rest) {
      const m = String(method || 'GET').toUpperCase();
      let target = String(url);

      // Redirects have to happen here — by send() the connection is already
      // pointed somewhere. Every partial postback on a JSF portal is an XHR, so
      // this is the path that matters most on the portals we test.
      // No body at open() time, so this pass is URL-only. A GraphQL rule
      // cannot match here and is not expected to — send() below matches again
      // with the payload in hand.
      const { all } = matchRules(target, m, null);
      const requested = target;
      for (const r of all) if (r.redirectTo) target = redirectUrl(r, target);

      this.__uqa = { method: m, url: target, requested, redirected: target !== requested };
      // Header edits are queued, not applied: setRequestHeader only works after
      // open() and before send(), and the page sets its own in between.
      this.__uqaHeaders = all.reduce((acc, r) => (r.headers ? { ...acc, ...r.headers } : acc), null);
      return open.call(this, m, target, ...rest);
    };

    XHR.prototype.send = function (...args) {
      const meta = this.__uqa;

      if (this.__uqaHeaders) {
        for (const [name, value] of Object.entries(this.__uqaHeaders)) {
          try {
            // There is no removeRequestHeader; the closest honest thing is to
            // blank it, and the UI says so rather than pretending otherwise.
            this.setRequestHeader(name, value === null ? '' : value);
          } catch {
            /* a forbidden header name — the browser owns those */
          }
        }
      }

      if (meta?.redirected) {
        emit({
          kind: 'net', via: 'xhr', method: meta.method, url: short(meta.requested),
          status: 0, ok: true, durationMs: 0, error: false,
          redirectedTo: short(meta.url), overridden: true, ts: Date.now(),
        });
      }

      // Override path. This is the one that matters on a JSF/PrimeFaces portal:
      // every partial AJAX postback is an XHR, so forcing a 500 here is what
      // exercises the app's server-error dialog.
      // Now the body exists, so GraphQL rules can be matched.
      const xhrBody = typeof args[0] === 'string' ? args[0] : null;
      const xhrContext = { body: xhrBody, graphql: graphqlInfo(xhrBody, meta?.url) };
      const rule = meta ? matchRule(meta.url, meta.method, xhrContext) : null;
      const TERMINAL_XHR = ['status', 'body', 'fail', 'mock', 'graphqlError'];
      if (rule && TERMINAL_XHR.includes(rule.action)) {
        consume(rule);
        const started = performance.now();
        const finish = () => {
          // status/responseText are read-only on the prototype; shadow them on
          // the instance so the page's own handlers read the forced values.
          // A GraphQL error is HTTP 200 with an `errors` array, and a mock
          // defaults to 200 — so neither can share the 500 default that
          // `status` uses. Getting this wrong would mean a "GraphQL error" that
          // a client sees as a transport failure, which is the opposite bug.
          const status =
            rule.action === 'fail' ? 0
            : rule.action === 'graphqlError' ? 200
            : rule.action === 'mock' ? rule.status || 200
            : rule.status || 500;
          const body =
            rule.action === 'fail' ? ''
            : rule.action === 'graphqlError' ? graphqlErrorBody(rule, xhrContext.graphql)
            : rule.body != null ? String(rule.body)
            : rule.action === 'mock' ? '{}' : '';
          try {
            Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(this, 'status', { value: status, configurable: true });
            Object.defineProperty(this, 'statusText', { value: rule.statusText || '', configurable: true });
            Object.defineProperty(this, 'responseText', { value: body, configurable: true });
            Object.defineProperty(this, 'response', { value: body, configurable: true });
            Object.defineProperty(this, 'responseURL', { value: meta.url, configurable: true });
          } catch {
            /* a page that froze XMLHttpRequest.prototype — nothing to do */
          }

          emit({
            kind: 'net', via: 'xhr', method: meta.method, url: short(meta.url),
            status, ok: status >= 200 && status < 400,
            durationMs: performance.now() - started,
            error: rule.action === 'fail',
            responsePreview: body.slice(0, MAX_BODY),
            mocked: rule.action === 'mock' || undefined,
            graphqlError: rule.action === 'graphqlError' || undefined,
            operation: xhrContext.graphql?.operationName || undefined,
            overridden: true, ruleLabel: rule.label, ts: Date.now(),
          });

          this.dispatchEvent(new Event('readystatechange'));
          this.dispatchEvent(new Event(rule.action === 'fail' ? 'error' : 'load'));
          this.dispatchEvent(new Event('loadend'));
        };
        if (rule.delayMs) setTimeout(finish, rule.delayMs);
        else setTimeout(finish, 0);
        return;
      }

      if (meta) {
        meta.started = performance.now();
        const actAtStart = act;
        const reqHeaders = safeHeaders(this.__uqaReqH);
        const reqBody = safeBody(args[0]);
        const done = (error, type) => {
          if (this.__uqa !== meta) return; // r7-05-7: a reused XHR re-opened for send #2; send #1's listeners must not report again
          let responsePreview;
          if (error || this.status >= 400) {
            try {
              if (!this.responseType || this.responseType === 'text') {
                responsePreview = String(this.responseText || '').slice(0, MAX_BODY);
              }
            } catch {
              /* responseText unavailable for this responseType */
            }
          }
          let resHeaders;
          try {
            resHeaders = {};
            for (const line of String(this.getAllResponseHeaders() || '').trim().split(/[\r\n]+/)) {
              const i = line.indexOf(':');
              if (i > 0) resHeaders[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
            }
            resHeaders = safeHeaders(resHeaders);
          } catch { resHeaders = undefined; }
          report({
            kind: 'net', via: 'xhr', method: meta.method, url: short(meta.url),
            status: this.status, ok: this.status >= 200 && this.status < 400,
            durationMs: performance.now() - meta.started,
            error: !!error, ev: type, responsePreview, reqHeaders, reqBody, resHeaders, ts: Date.now(),
          }, undefined, actAtStart);
        };
        this.addEventListener('load', () => done(false));
        this.addEventListener('error', () => done(true, 'error'));
        this.addEventListener('timeout', () => done(true, 'timeout'));
        this.addEventListener('abort', () => done(false, 'abort')); // D-1010-48: a cancel is not a failure
      }

      // A delay rule defers the real send; the timing captured above therefore
      // includes the injected latency, which is the whole point of the rule.
      if (rule?.action === 'delay' && rule.delayMs) {
        consume(rule);
        setTimeout(() => send.apply(this, args), rule.delayMs);
        return undefined;
      }

      return send.apply(this, args);
    };
  }

  /* ----------------------------------------------------------------- console */

  const LEVELS = ['error', 'warn', 'assert'];
  for (const level of LEVELS) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = function (...args) {
      try {
        // console.assert(cond, ...) only fails when cond is falsy.
        if (level === 'assert' && args[0]) return original.apply(this, args);
        const text = args
          .map((a) => {
            if (a instanceof Error) return `${a.name}: ${a.message}`;
            if (typeof a === 'object') {
              try { return JSON.stringify(a).slice(0, 500); } catch { return '[object]'; }
            }
            return String(a);
          })
          .join(' ')
          .slice(0, 1000);
        const stack = args.find((a) => a instanceof Error)?.stack;
        report({
          kind: 'console', level, text, stack: stack ? String(stack).slice(0, 1500) : undefined,
          en: errName(args.find((a) => a instanceof Error)),
          src: level === 'warn' ? undefined : srcOf(stack || new Error().stack), ts: Date.now(),
        });
      } catch {
        /* never let logging break the page */
      }
      return original.apply(this, args);
    };
  }

  /* -------------------------------------------------------- uncaught failures */

  window.addEventListener('error', (e) => {
    report({
      kind: 'pageerror',
      text: `${e.message} (${e.filename}:${e.lineno}:${e.colno})`,
      stack: e.error?.stack ? String(e.error.stack).slice(0, 1500) : undefined,
      en: errName(e.error),
      src: e.filename ? bareUrl(e.filename) : srcOf(e.error?.stack),
      ts: Date.now(),
    }, e.message);
  });

  /* ---------------------------------- subresources, CSP, WebSocket, SSE, beacon */

  /** One failure-only `net` row for a transport the fetch/XHR hooks cannot see. URL and code only, never a payload. */
  function netFail(via, url, ev, text) {
    let thirdParty; // D-1010-102: only a subresource load is tagged; signal.js down-weights it below the app's own 4xx/5xx
    if (via === 'resource') { try { thirdParty = new URL(url, location.href).origin !== location.origin; } catch { /* unparsable: leave untagged */ } }
    report({ kind: 'net', via, method: 'GET', url: short(url), status: 0, ok: false, durationMs: 0, error: true, ev, text, ts: Date.now(), ...(thirdParty === undefined ? {} : { thirdParty }) });
  }

  // r3-05-4: a resource error does not bubble, so only the capture phase on window sees an img/script/css that failed to load.
  const RES_TAGS = /^(IMG|SCRIPT|LINK|SOURCE|VIDEO|AUDIO|IFRAME|EMBED|OBJECT|TRACK)$/;
  window.addEventListener('error', (e) => {
    const t = e.target;
    if (!t || t === window || !RES_TAGS.test(String(t.tagName))) return;
    const u = String(t.currentSrc || t.src || t.href || t.data || '');
    if (u && !/^(data|blob|about):/i.test(u)) netFail('resource', u, 'error', `<${String(t.tagName).toLowerCase()}> failed to load`);
  }, true);

  window.addEventListener('securitypolicyviolation', (e) => {
    report({
      kind: 'console', level: 'error',
      text: `CSP: ${e.violatedDirective} blocked ${bareUrl(e.blockedURI || 'inline')}`.slice(0, 300),
      src: e.sourceFile ? bareUrl(e.sourceFile) : undefined, ts: Date.now(),
    });
  });

  // r3-05-6 / D-1010-49: wrapped by Proxy so statics, prototype and instanceof stay the page's own.
  for (const [name, via] of [['WebSocket', 'ws'], ['EventSource', 'sse']]) {
    const Native = window[name];
    if (typeof Native !== 'function' || typeof Proxy !== 'function') continue;
    try {
      window[name] = new Proxy(Native, {
        construct(target, args, newTarget) {
          const sock = Reflect.construct(target, args, newTarget);
          try {
            let failed = false;
            const fail = (ev, text) => { if (!failed) { failed = true; netFail(via, args[0], ev, text); } };
            sock.addEventListener('error', () => { if (via === 'ws' || sock.readyState === 2) fail('error', `${name} error`); });
            if (via === 'ws') sock.addEventListener('close', (e) => { if (![1000, 1001, 1005].includes(e.code)) fail('close', `${name} closed: ${e.code}`); });
          } catch { /* never let the hook break the page's socket */ }
          return sock;
        },
      });
    } catch { /* a frozen global */ }
  }

  if (typeof navigator === 'object' && typeof navigator.sendBeacon === 'function') {
    const beacon = navigator.sendBeacon;
    try {
      navigator.sendBeacon = function (url) {
        const ok = beacon.apply(this, arguments);
        if (ok === false) netFail('beacon', url, 'error', 'sendBeacon refused');
        return ok;
      };
    } catch { /* read-only navigator */ }
  }

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report({
      kind: 'pageerror',
      text: `Unhandled rejection: ${r instanceof Error ? `${r.name}: ${r.message}` : String(r).slice(0, 300)}`,
      stack: r?.stack ? String(r.stack).slice(0, 1500) : undefined,
      en: errName(r),
      src: srcOf(r?.stack),
      ts: Date.now(),
    });
  });
})();

/*
 * Why this file names itself.
 *
 * Chrome attributes a console message to an extension when the *script name* of
 * the top JS frame at the moment the native console method runs has the
 * chrome-extension scheme. This file wraps `console.warn`/`error` in the MAIN
 * world on every page, so at the instant a site's own deprecation warning
 * reaches the native method, the top frame is ours — and every warning on every
 * site was landing on QA Wrap's card at chrome://extensions, which reads to
 * anyone who opens it as an extension that is broken on every page it touches.
 *
 * V8 takes a `//# sourceURL=` magic comment as the script name in stack traces
 * (`GetScriptNameOrSourceURL`), and Blink's SourceLocation capture reads the
 * same value. A scheme-less name is therefore enough: DevTools still shows the
 * file under a name that says exactly what it is, and Chrome no longer sees an
 * extension URL to blame.
 *
 * The console capture itself is a product feature and stays. What is removed is
 * the false attribution, not the hook.
 */
//# sourceURL=qa-wrap-page-hooks.js
