/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Session replay, the recording half: the DOM as it was, and every change to it.
 *
 * ── why this is not a screen recording ─────────────────────────────────────
 *
 * A tab capture is pixels, and pixels need `tabCapture`, which Firefox does not
 * implement and which Chrome only grants on a toolbar click. A replay built
 * from the DOM needs neither: it is text, it is a tenth of the size, its words
 * can be searched, and it works in every browser this extension ships to. Where
 * a video shows you that a field went red, a replay lets you read what was in
 * it.
 *
 * What is recorded:
 *
 *   snapshot   the whole document once, at the moment the session starts
 *   mutations  added and removed nodes, attribute changes, text changes
 *   input      what was typed, as it was typed
 *   scroll     where the page was, and how big the window was
 *
 * Every entry carries `t`, milliseconds since the session's own clock started,
 * so the replay scrubs against the same timeline the report draws.
 *
 * ── masking happens HERE, not at playback ──────────────────────────────────
 *
 * This is the rule the whole feature rests on. A masked value must never be
 * written down, not in the store, not in a chunk in flight, not in memory for
 * longer than it takes to decide it is masked. Masking at playback would mean
 * the real text was on disk the whole time and the promise made to the tester
 * — "this never leaves your machine" — would be a promise about the viewer
 * rather than about the data.
 *
 * So: any element carrying `data-uqa-masked` (painted by `content/mask.js`) is
 * serialised as the opaque block and its subtree is not walked. A masked field
 * records `UQAMask.placeholder()` instead of its value, at a fixed length,
 * because a mask that leaks the length is not a mask. Text mutations inside a
 * masked subtree are dropped entirely rather than emitted with substituted
 * text, since even the shape of the change is information.
 *
 * `tools/test-replay.mjs` runs this file in a Node sandbox against a fake DOM
 * and asserts the masked string is absent from the serialised log — not that
 * the code looks right, that the bytes do not contain it.
 *
 * ── how it knows a session is running ──────────────────────────────────────
 *
 * It asks, and nothing else in the worker had to change to let it. Every few
 * seconds while idle it sends an empty `UQA_REPLAY_CHUNK`; the worker answers
 * whether a session is running and which one. When the answer turns true it
 * takes the snapshot and starts observing; when it turns false it stops and
 * forgets. One message type, no new broadcast, no edit to anybody's
 * `startSession`.
 */
(() => {
  if (window.UQAReplayRecorder) return;

  /* Only the top document. A replay stitched from a page and its frames needs
     coordinates this phase does not record; an iframe's own content is left as
     an empty box rather than shown wrong. */
  const TOP = window.top === window;

  const MASK_ATTR = 'data-uqa-masked';
  const FIELD_ATTR = 'data-uqa-masked-field';

  /** Never serialised: they would run, or fetch, inside the replay. */
  const SKIP_TAGS = new Set(['SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'OBJECT', 'EMBED', 'APPLET']);

  /**
   * Our own overlay, which is not part of the page under test.
   *
   * `content/ui-host.js` mounts a `<qaw-ui>` with a closed shadow root, and the
   * crosshair, the toasts and the mask blocks live inside it. Recording it would
   * put QA Wrap's own interface into the replay of the tester's page, and — the
   * reason this was found — the harvester repaints it hundreds of times in a
   * second, which turned one tool press into a mutation flood.
   */
  const OURS = 'QAW-UI';

  /**
   * Ceilings, and each one is a crash that happened.
   *
   * A single `add` entry can carry a whole subtree, and a page that rewrites a
   * large container gives you one of those per rewrite. With only an entry count
   * to stop it, a flush grew to tens of megabytes and `sendMessage` had to
   * structured-clone all of it: the renderer crashed mid-harvest, which read as
   * four broken tools in the clickthrough. So the log is bounded three ways —
   * how deep one subtree is walked, how many entries a chunk holds, and how many
   * bytes. A replay that is missing the far end of a 5,000-node table is worth
   * having; one that crashes the page it is recording is not.
   */
  const MAX_NODES_PER_TREE = 1500;
  const MAX_CHUNK_BYTES = 256 * 1024;
  /** At most this many MutationObserver records are read in one callback. */
  const MAX_RECORDS_PER_BATCH = 300;
  /**
   * And a ceiling on the whole session, after which the recorder stops.
   *
   * A replay is evidence, not a backup: eight megabytes of DOM is far more than
   * anyone watches, and an hour of a page that repaints on a timer would
   * otherwise grow without limit inside the tab under test. When the budget is
   * spent the recorder writes one `truncated` entry and switches itself off, so
   * the replay page can say where it stops instead of pretending that is where
   * the session ended.
   */
  const MAX_SESSION_ENTRIES = 20000;
  const MAX_SESSION_BYTES = 8 * 1024 * 1024;

  /**
   * The attributes worth following.
   *
   * Not all of them. A page under test rewrites `data-*` bookkeeping, ids and
   * framework attributes continuously, and following every one of those turned
   * a single tool press into a mutation flood large enough to take the tab down
   * with it. These are the ones that change what a replay LOOKS like.
   */
  const WATCH_ATTRS = [
    'class', 'style', 'hidden', 'disabled', 'checked', 'selected', 'open',
    'value', 'placeholder', 'title', 'alt', 'colspan', 'rowspan',
    'aria-hidden', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-invalid',
    'aria-label', 'data-uqa-masked', 'data-uqa-masked-field',
  ];

  /** Flush when either is reached, so a busy page does not buffer for ever. */
  const FLUSH_MS = 1000;
  const FLUSH_ENTRIES = 200;
  /** A page can mutate faster than anyone can watch. Above this the log is thinned. */
  const MAX_ENTRIES_PER_FLUSH = 2000;
  /**
   * T-075: heavy-page guard. More mutation records than this in two seconds running (or ten times this in
   * one) and the page is too busy to follow; one big render, as a single-page app makes on a normal page,
   * is not: the observer is dropped, the first snapshot and what was logged so far stay, and one `heavy`
   * entry says where it stopped (the viewer prints it). Measured on tools/perf-page.mjs's busy page.
   */
  const HEAVY_RECORDS_PER_SEC = 2000;
  let winAt = 0;
  let winCount = 0;
  let strikes = 0; // consecutive over-limit seconds
  let heavy = false;

  let on = false;
  let sessionId = null;
  let t0 = 0;
  let seq = 0;
  let buffer = [];
  let observer = null;
  let flushTimer = null;
  let nextId = 1;
  let spentEntries = 0;
  let spentBytes = 0;

  /** Our own id for a node, so a mutation can name a node the snapshot already sent. */
  const ids = new WeakMap();
  const idOf = (node) => {
    let id = ids.get(node);
    if (!id) ids.set(node, (id = nextId++));
    return id;
  };

  const now = () => Math.max(0, Math.round(performance.now() - t0));

  /* ── masking ────────────────────────────────────────────────────────────
   *
   * `content/mask.js` owns the decision and publishes it as `window.UQAMask`.
   * This file asks rather than re-implements: two answers to "is this masked"
   * is one answer that will eventually disagree with the other, and the one
   * that disagrees quietly is this one, in a file nobody opens.
   *
   * The fallbacks exist because a content script cannot assume the load order
   * of its siblings. Without `UQAMask` the attribute alone is still the truth
   * on the page, so it is read directly; without a placeholder there is a
   * literal, at the same fixed length.
   */
  const masked = (node) => {
    if (!node || node.nodeType !== 1) return false;
    if (window.UQAMask?.isMasked) return window.UQAMask.isMasked(node);
    for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hasAttribute?.(MASK_ATTR)) return true;
    }
    return false;
  };
  const placeholder = () => window.UQAMask?.placeholder?.() || '••••••';

  /*
   * r3-03-1: a field recorder.js would mask is a placeholder here too, by the same rule: type, autocomplete,
   * name / id / aria-label / accessible name against the secret-name words, then the tester's own pattern.
   * The word list is generated from core/privacy-names.json by tools/gen-privacy-names.mjs; tools/test-replay.mjs and test-privacy-contract fail on drift.
   */
  /* privacy-names:begin (generated from core/privacy-names.json; do not edit) */
const SECRET_NAMES = new Set(["pass","password","passwd","pwd","passcode","passphrase","secret","token","auth","authorization","bearer","session","sessionid","phpsessid","jsessionid","aspsessionid","cookie","apikey","otp","pin","credit","creditcard","card","cardnumber","cvv","cvc","ssn","iban","jwt","csrf","xsrf","sid","privatekey","accesskey","subscriptionkey","functionskey","secretkey","signingkey","licensekey","dpop","nationalid","كلمةالمرور","رقمسري"]);
const isSecretName = (name) => { const t = String(name).replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z\d\u0600-\u06ff]+/).filter(Boolean); return t.some((w, i) => SECRET_NAMES.has(w) || (i > 0 && SECRET_NAMES.has(t[i - 1] + w))); };
/* privacy-names:end */
  const secretField = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute?.(FIELD_ATTR) || String(el.type || '').toLowerCase() === 'password') return true;
    if (/password|cc-|one-time/.test(el.autocomplete || el.getAttribute?.('autocomplete') || '')) return true;
    let label = '';
    try { label = window.UQASelector?.accessibleName?.(el) || ''; } catch { /* the selector engine must never break masking */ }
    if (isSecretName(`${el.name || ''} ${el.id || ''} ${el.getAttribute?.('aria-label') || ''} ${label}`)) return true;
    const own = window.UQASettings?.maskExtraPattern || '';
    if (own !== extraSrc) { // D-1010-91 (r5-03-1): compiled once per value; a pattern that does not compile fails CLOSED, as recorder.js does (D-83)
      extraSrc = own; extraRe = null; extraBad = false;
      try { extraRe = own ? new RegExp(own, 'i') : null; } catch { extraBad = true; console.warn('QA Wrap: the extra mask pattern does not compile; every text input is masked.'); }
    }
    if (extraBad && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && /^(|text|search|tel|url|email|number|date|datetime-local|month|time|week)$/.test(String(el.type || '').toLowerCase())))) return true;
    return !!extraRe && extraRe.test(`${el.name || ''} ${el.id || ''} ${label}`);
  };
  let extraSrc = null; let extraRe = null; let extraBad = false;

  /** True when this node is inside QA Wrap's own overlay rather than the page. */
  const isOurs = (node) => {
    for (let n = node?.nodeType === 1 ? node : node?.parentElement; n; n = n.parentElement) {
      if (n.tagName === OURS) return true;
    }
    return false;
  };

  /** True when this node, or anything above it, is masked. */
  const inMasked = (node) => {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    return !!el && masked(el);
  };

  /* ── serialising ────────────────────────────────────────────────────────*/

  /**
   * One attribute, as it will be replayed.
   *
   * Anything that would make the replay reach the network is blanked here
   * rather than in the player, so the log itself is inert: a stored `src` is a
   * URL somebody could later fetch by accident. `style` survives because it is
   * what makes the replay look like the page.
   */
  const URL_ATTRS = new Set(['src', 'srcset', 'href', 'action', 'formaction', 'data', 'poster', 'ping', 'background']);
  const attrValue = (name, value) => {
    if (name.startsWith('on')) return null;             // no handlers in a replay
    if (URL_ATTRS.has(name)) return '';                 // present, inert
    return value;
  };

  /**
   * A node, as a plain object.
   *
   * A masked element stops the walk: its children are never visited, so no text
   * under it can reach the log by any route. What is recorded in its place is
   * the same opaque block `content/mask.js` paints on the page, which is what
   * the tester saw and therefore what the replay should show.
   */
  function serialize(node, budget = { left: MAX_NODES_PER_TREE }) {
    if (!node) return null;
    if (budget.left <= 0) return null;

    if (node.nodeType === 3) {
      if (inMasked(node)) return null;
      const text = node.nodeValue || '';
      return text.trim() === '' && text.length > 200 ? null : { t: 3, v: text };
    }
    if (node.nodeType === 8) return null;               // comments carry nothing to see
    if (node.nodeType !== 1) return null;

    const tag = node.tagName;
    if (SKIP_TAGS.has(tag) || tag === OURS) return null;
    budget.left--;

    const id = idOf(node);
    const attrs = {};
    const secretEl = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && secretField(node);
    const secretMeta = tag === 'META' && isSecretName(node.getAttribute?.('name') || node.getAttribute?.('http-equiv') || '');
    for (const a of node.attributes || []) {
      if (secretEl && a.name === 'value') continue;      // r7-05-1: a secret field's value attribute never reaches the log
      if (secretMeta && a.name === 'content') continue;  // csrf-token and similar
      const v = attrValue(a.name, a.value);
      if (v !== null) attrs[a.name] = v;
    }

    if (masked(node)) {
      // The block, and nothing under it. `data-uqa-masked` travels with it so
      // the player paints the same cover the page did.
      return { t: 1, id, n: tag, a: attrs, masked: true, c: [] };
    }

    const out = { t: 1, id, n: tag, a: attrs, c: [] };

    // A field's value is not an attribute once a person has typed in it.
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      out.value = secretField(node) ? placeholder() : String(node.value ?? '');
      if (node.checked !== undefined) out.checked = !!node.checked;
    }

    for (const child of node.childNodes || []) {
      if (budget.left <= 0) break;
      if (secretEl && tag === 'TEXTAREA') break;         // a secret textarea's text is its value
      const s = serialize(child, budget);
      if (s) out.c.push(s);
    }
    return out;
  }

  /* ── the log ────────────────────────────────────────────────────────────*/

  function push(entry) {
    if (!on) return;
    if (buffer.length >= MAX_ENTRIES_PER_FLUSH) return;   // a runaway page is thinned, not followed
    const stamped = { ...entry, t: now() };
    spentEntries++;
    spentBytes += JSON.stringify(stamped).length;
    buffer.push(stamped);
    if (spentEntries > MAX_SESSION_ENTRIES || spentBytes > MAX_SESSION_BYTES) {
      buffer.push({ k: 'truncated', t: now(), entries: spentEntries, bytes: spentBytes });
      flush();
      stop();
      return;
    }
    if (buffer.length >= FLUSH_ENTRIES) flush();
  }

  function snapshot() {
    nextId = 1;
    push({
      k: 'snapshot',
      url: location.href,
      title: document.title,
      w: window.innerWidth,
      h: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
      doc: serialize(document.documentElement),
    });
  }

  function onMutations(records) {
    if (heavy) return;
    const t = performance.now();
    if (t - winAt >= 1000) { strikes = winCount > HEAVY_RECORDS_PER_SEC && t - winAt < 2000 ? strikes + 1 : 0; winAt = t; winCount = 0; }
    winCount += records?.length || 0;
    if (winCount > HEAVY_RECORDS_PER_SEC * (strikes ? 1 : 10)) {
      heavy = true;
      observer?.disconnect();
      observer = null;
      push({ k: 'heavy', rate: winCount, limit: HEAVY_RECORDS_PER_SEC });
      flush();
      return;
    }
    for (const m of (records || []).slice(0, MAX_RECORDS_PER_BATCH)) {
      if (inMasked(m.target)) continue;                  // nothing under a mask is logged
      if (isOurs(m.target)) continue;                    // and neither is our own overlay

      if (m.type === 'attributes') {
        if (m.attributeName === 'value' && secretField(m.target)) continue;
        if (m.attributeName === 'content' && m.target.tagName === 'META' && isSecretName(m.target.getAttribute('name') || m.target.getAttribute('http-equiv') || '')) continue;
        const v = attrValue(m.attributeName, m.target.getAttribute(m.attributeName));
        if (v === null) continue;
        push({ k: 'attr', id: idOf(m.target), name: m.attributeName, v });
        continue;
      }
      if (m.type === 'characterData') {
        const par = m.target.parentElement;
        if (par && par.tagName === 'TEXTAREA' && secretField(par)) continue;
        push({ k: 'text', id: idOf(m.target.parentElement || m.target), v: m.target.nodeValue || '' });
        continue;
      }
      // childList
      if (m.target?.tagName === 'TEXTAREA' && secretField(m.target)) continue;
      for (const node of m.removedNodes || []) {
        const id = ids.get(node);
        if (id) push({ k: 'remove', id });
      }
      const added = [];
      for (const node of m.addedNodes || []) {
        const s = serialize(node);
        if (s) added.push(s);
      }
      if (added.length) {
        push({
          k: 'add',
          parent: idOf(m.target),
          before: m.nextSibling ? ids.get(m.nextSibling) || null : null,
          nodes: added,
        });
      }
    }
  }

  const onInput = (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (inMasked(el)) return;
    const value = secretField(el) ? placeholder() : String(el.value ?? '');
    push({ k: 'input', id: idOf(el), v: value, checked: el.checked === undefined ? undefined : !!el.checked });
  };

  let scrollPending = false;
  const onScroll = () => {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
      scrollPending = false;
      push({ k: 'scroll', x: Math.round(window.scrollX), y: Math.round(window.scrollY) });
    });
  };
  const onResize = () => push({ k: 'viewport', w: window.innerWidth, h: window.innerHeight });

  /* ── talking to the worker ──────────────────────────────────────────────*/

  function send(entries) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'UQA_REPLAY_CHUNK', sessionId, seq: entries.length ? seq++ : -1, entries, url: location.href },
          (res) => {
            void chrome.runtime.lastError;                // a torn-down worker is not an error here
            resolve(res || null);
          }
        );
      } catch {
        resolve(null);                                    // extension reloaded under us
      }
    });
  }

  /**
   * Send what is buffered, in pieces small enough to survive the trip.
   *
   * `sendMessage` structured-clones its argument, and a clone of tens of
   * megabytes is what crashed the renderer. The buffer is cut at
   * MAX_CHUNK_BYTES, measured rather than guessed, and each piece goes as its
   * own chunk with its own sequence number — which is exactly what the store is
   * keyed for.
   */
  async function flush() {
    if (asleep()) { stop(); return; }
    if (!buffer.length) return;
    const entries = buffer;
    buffer = [];

    let piece = [];
    let bytes = 0;
    for (const entry of entries) {
      const size = JSON.stringify(entry).length;
      if (piece.length && bytes + size > MAX_CHUNK_BYTES) {
        const res = await send(piece);
        if (res && res.ok === false) return stop();
        piece = [];
        bytes = 0;
      }
      piece.push(entry);
      bytes += size;
    }
    if (piece.length) {
      const res = await send(piece);
      if (res && res.ok === false) stop();                // the session ended while we were writing
    }
  }

  async function probe() {
    if (asleep()) { stop(); return; }
    const res = await send([]);
    const recording = !!(res?.result?.recording ?? res?.recording);
    const id = res?.result?.sessionId ?? res?.sessionId ?? null;
    if (recording && !on) start(id);
    else if (!recording && on) stop();
  }

  // Asleep records nothing (6 Oct 2026, Sleep is a full stop). `false` is the
  // bridge's decision; `undefined` is "not asked yet".
  const asleep = () => window.UQAAwake === false;

  function start(id) {
    if (on || asleep()) return;
    on = true;
    sessionId = id;
    seq = 0;
    buffer = [];
    spentEntries = 0;
    spentBytes = 0;
    winAt = 0;
    winCount = 0;
    strikes = 0;
    heavy = false;
    t0 = performance.now();
    snapshot();
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: WATCH_ATTRS,
    });
    addEventListener('input', onInput, true);
    addEventListener('change', onInput, true);
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    addEventListener('resize', onResize, { passive: true });
    flushTimer = setInterval(flush, FLUSH_MS);
  }

  function stop() {
    if (!on) return;
    on = false;
    observer?.disconnect();
    observer = null;
    removeEventListener('input', onInput, true);
    removeEventListener('change', onInput, true);
    removeEventListener('scroll', onScroll, true);
    removeEventListener('resize', onResize);
    clearInterval(flushTimer);
    flushTimer = null;
    buffer = [];
    sessionId = null;
  }

  // Anything still buffered when the page goes is worth one last attempt.
  addEventListener('pagehide', () => { if (on) flush(); });

  window.UQAReplayRecorder = {
    /* Exported for `tools/test-replay.mjs`, which runs this file against a fake
       DOM. Testing the shipped code rather than a copy of it is the only way
       the masking claim means anything. */
    serialize,
    masked,
    placeholder,
    secretField,
    onInput,
    onMutations,
    snapshot,
    isRecording: () => on,
    asleep,
    isFollowing: () => !!observer,
    _buffer: () => buffer,
    _start: start,
    _stop: stop,
  };

  if (TOP && typeof chrome !== 'undefined' && chrome.runtime?.id) {
    probe();
    // Pushed, not polled: the worker broadcasts UQA_STATE_CHANGED on every start and
    // stop, so an idle granted tab runs no timer and never wakes the worker.
    chrome.runtime.onMessage.addListener((msg, sender) => {
      if (sender?.id !== chrome.runtime.id || sender?.tab) return;
      if (msg?.type === 'UQA_STATE_CHANGED') probe();
      if (msg?.type === 'UQA_ARMED_CHANGED' && msg.armed === false) { window.UQAAwake = false; stop(); }
    });
    // A page restored from the back/forward cache missed every message.
    addEventListener('pageshow', () => { if (on) probe(); });
  }
})();
