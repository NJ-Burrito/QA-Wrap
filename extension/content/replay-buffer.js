/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The 2-minute replay buffer (features-1010, decision 4).
 *
 * Off by default and opt-in per site (`bufferSites`, a list of origins in the extension's local storage; the worker answers `UQA_BUFFER_ON`). When it is on, the page is
 * awake and NO session records here, `content/bridge.js` hands every event the recorder already produces (actions, console,
 * network metadata) to `push()`. They wait in this array, in this page, and nowhere else:
 *
 *   - not on disk: nothing here calls a storage or network API except the one read of the site list;
 *   - not in the worker: a sleeping MV3 worker cannot lose what it never held;
 *   - not forever: anything older than 120 s is dropped on the next push or tick, and the array is bounded in count and size.
 *
 * Masking is applied before an event enters the array, not when it is saved: the recorder has already replaced masked field
 * values, and `scrub()` here removes request and response bodies and headers, masks credential-named query values, and
 * rewrites token-shaped words in console text. The worker runs its own redaction again when the events are saved.
 *
 * «Save last 2 minutes» is two steps from the popup: `UQA_BUFFER_FREEZE` copies what is held (`freeze`), then the ordinary
 * Start runs; when the bridge learns that the session is recording it asks for `handoff()` and sends the frozen events as
 * pre-roll. A normal Start with nothing frozen takes nothing and clears the buffer.
 */
(() => {
  if (window.UQABuffer) return;
  const TOP = window.top === window;
  const WINDOW_MS = 120000;
  const MAX_EVENTS = 1500;
  const MAX_CHARS = 1500000; // about 3 MB of UTF-16, the most this page ever holds for us
  const FREEZE_TTL_MS = 20000;
  const CUT = 500;

  let on = false;
  let ring = [];
  let chars = 0;
  let frozen = null;
  let frozenTimer = 0;
  let tick = 0;
  let pill = null;

  const cut = (s, n = CUT) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
  const SECRET_PARAM = /pass|pwd|secret|token|auth|key|sid|session|otp|pin|jwt|csrf|xsrf|cookie|sig|code|credential|bearer/i;

  /** Token-shaped words out of free text. Over-masking a buffer is cheap; a leaked token is not. */
  function maskText(s) {
    return String(s ?? '')
      .replace(/\beyJ[\w-]{8,}\.[\w-]{4,}\.[\w-]*/g, '[masked]')
      .replace(/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, '$1 [masked]')
      .replace(/\b(pass(?:word|wd)?|pwd|secret|token|api[_-]?key|authorization|auth|sessionid|sid)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi, '$1$2[masked]')
      .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}(?![\w])/g, '[masked]')
      .replace(/\b\d(?:[ -]?\d){12,18}\b/g, '[masked]');
  }

  function maskUrl(u) {
    const s = String(u ?? '');
    const q = s.indexOf('?');
    if (q < 0) return cut(maskText(s), 800);
    const h = s.indexOf('#', q);
    const query = s.slice(q + 1, h < 0 ? undefined : h).split('&').map((p) => {
      const k = p.indexOf('=');
      return k >= 0 && SECRET_PARAM.test(p.slice(0, k)) ? `${p.slice(0, k)}=%5Bmasked%5D` : p;
    }).join('&');
    return cut(maskText(`${s.slice(0, q + 1)}${query}${h < 0 ? '' : s.slice(h)}`), 800);
  }

  /** What may be held, by kind. A copy built from an allow-list for network events; the caller's object is never kept. */
  function scrub(ev) {
    if (ev.kind === 'net') {
      // Metadata only: no bodies, no headers, no response preview, nothing that is not named here.
      const o = { kind: 'net', url: maskUrl(ev.url) };
      for (const k of ['method', 'via']) if (typeof ev[k] === 'string') o[k] = cut(ev[k], 20);
      for (const k of ['status', 'durationMs', 'bytes', 'ts', 'act']) if (Number.isFinite(ev[k])) o[k] = ev[k];
      if (typeof ev.ok === 'boolean') o.ok = ev.ok;
      if (ev.error) o.error = cut(maskText(typeof ev.error === 'string' ? ev.error : 'network error'), 200);
      if (typeof ev.frameUrl === 'string') o.frameUrl = maskUrl(ev.frameUrl);
      return o;
    }
    const o = {};
    for (const [k, v] of Object.entries(ev)) {
      if (v == null || typeof v === 'function') continue;
      if (typeof v === 'string') o[k] = cut(v);
      else if (typeof v === 'number' || typeof v === 'boolean') o[k] = v;
    }
    if (ev.kind === 'console' || ev.kind === 'pageerror') {
      o.text = cut(maskText(ev.text), CUT);
      if (ev.stack) o.stack = cut(maskText(ev.stack), 800);
    } else if (ev.kind === 'dom') {
      // The recorder already replaced masked values with the placeholder at capture; a value is never rebuilt here.
      if (ev.masked === true) o.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
      else for (const k of ['value', 'label', 'text']) if (typeof o[k] === 'string') o[k] = maskText(o[k]);
    }
    if (typeof o.frameUrl === 'string') o.frameUrl = maskUrl(o.frameUrl);
    return o;
  }

  function prune(now = Date.now()) {
    while (ring.length && (ring.length > MAX_EVENTS || chars > MAX_CHARS || now - ring[0].ev.ts > WINDOW_MS)) chars -= ring.shift().n;
  }

  function clear() { ring = []; chars = 0; }

  function paintPill() {
    if (!TOP) return;
    const H = window.UQAUiHost;
    if (!on && pill) { pill.remove(); pill = null; return; }
    if (!on || pill || !H?.uiLayer) return;
    pill = H.uiLayer('uqa-buffer');
    pill.setAttribute('role', 'status');
    pill.textContent = `${H.t ? H.t('buffer.pill', 'QA Wrap is keeping the last 2 minutes in memory') : 'QA Wrap is keeping the last 2 minutes in memory'}`;
  }

  function setOn(next) {
    if (next === on) return;
    on = next;
    if (!on) { clear(); frozen = null; clearInterval(tick); tick = 0; } else if (!tick) tick = setInterval(() => { prune(); }, 15000);
    paintPill();
    if (on) setTimeout(paintPill, 1500); // the overlay host may mount after this script
  }

  /* Content scripts cannot read storage (the worker closes it to them), so the worker answers: is the buffer on for this origin? */
  const ask = () => { try { window.UQABridge?.send({ type: 'UQA_BUFFER_ON' }).then((res) => setOn(res?.ok === true && res.result === true)); } catch { /* an orphaned script */ } };
  setTimeout(ask, 0); // after bridge.js has loaded

  window.UQABuffer = {
    /** The bridge asks before it pushes: awake, buffer on for this site. */
    get on() { return on && window.UQAAwake === true; },
    push(ev) {
      if (!this.on || !ev || typeof ev !== 'object') return;
      const e = scrub(ev);
      if (!Number.isFinite(e.ts)) e.ts = Date.now();
      const n = JSON.stringify(e).length;
      ring.push({ ev: e, n });
      chars += n;
      prune();
    },
    /** What is held, for the test. */
    size: () => ring.length,
    bytes: () => chars,
    /** Copy what is held and keep it for the Start that follows. */
    freeze() {
      prune();
      frozen = ring.map((r) => r.ev);
      clearTimeout(frozenTimer);
      frozenTimer = setTimeout(() => { frozen = null; }, FREEZE_TTL_MS);
      return frozen.length;
    },
    /** A session is recording: give the frozen events away once, and start empty. */
    handoff() {
      const out = frozen || [];
      frozen = null;
      clearTimeout(frozenTimer);
      clear();
      return out;
    },
    clear,
    scrub,
    setOn,
  };

  try {
    chrome.runtime?.onMessage?.addListener((msg, sender, sendResponse) => {
      if (sender?.id !== chrome.runtime.id || sender?.tab) return;
      if (msg?.type === 'UQA_BUFFER_FREEZE' && TOP) { sendResponse({ count: window.UQABuffer.freeze() }); return true; }
      if (msg?.type === 'UQA_BUFFER_REFRESH') ask(); // the site list changed in the popup or in Settings
    });
  } catch { /* an orphaned script */ }
})();
