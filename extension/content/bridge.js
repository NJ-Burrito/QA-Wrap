/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * ISOLATED-world bridge.
 *
 * The MAIN-world hooks cannot touch chrome.*; they postMessage instead. This
 * relays those messages to the service worker, and gives the other content
 * scripts a single send() that survives a terminated worker.
 */
(() => {
  if (window.UQABridge) return;

  let recording = false;

  /** Fire-and-forget send. The worker may be asleep; chrome wakes it for us. */
  function send(msg) {
    return new Promise((resolve) => {
      // T-044: after an update the old script outlives its extension; `runtime.id` goes away first.
      if (!chrome.runtime?.id) { resolve(null); return markDead(); }
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          // Reading lastError suppresses the "unchecked runtime.lastError" noise
          // that appears whenever the page outlives the extension context.
          void chrome.runtime.lastError;
          resolve(res || null);
        });
      } catch (e) {
        if (/context invalidated/i.test(String(e?.message))) markDead();
        resolve(null);
      }
    });
  }

  let dead = false;
  /** Once, and said to every watcher, so the bar can take its controls down instead of leaving dead ones. */
  function markDead() {
    if (dead) return;
    dead = true;
    publish({ dead: true });
  }

  /*
   * Events that fire before the first answer about recording (the worker round
   * trip) are held, not dropped: a page's boot-tick fetches and hydration errors
   * all happen in that window. Bounded, and thrown away the moment the answer is
   * "not recording" — a page that is not being tested keeps nothing.
   */
  const PENDING_MAX = 200;
  let resolved = false;
  let pending = [];

  const taps = new Set();

  function stamp(event) {
    return { ...event, ts: event.ts || Date.now(), frameUrl: location.href };
  }

  /*
   * Opt-in pre-roll (devil point 16). Off unless the tester switched it on in
   * Settings. Memory only, in this page: a ring bounded by time and count, fed
   * only while the window is awake and no session records here. Nothing leaves
   * the page until a session starts, when the ring is sent flagged `preRoll`.
   * The worker runs the same sanitise and redact path on it as on live events.
   */
  const PREROLL_MS = 60000;
  const PREROLL_MAX = 300;
  let ring = [];

  function preRollOn() {
    return window.UQASettings?.preRollBuffer === true && window.UQAAwake === true;
  }

  function trimRing(now = Date.now()) {
    while (ring.length && (ring.length > PREROLL_MAX || now - ring[0].ts > PREROLL_MS)) ring.shift();
  }

  function clearRing() {
    ring = [];
  }

  /*
   * r9-02-2 (OF-10): awake / act / rules go to the MAIN world on the paired port, never as window messages a page could forge.
   * Until the page end acknowledges, the latest of each kind is kept and replayed in order on pairing. Without MessageChannel
   * (a non-browser harness) the old window message is used.
   */
  const latest = {};
  let pagePort = null;
  function toPage(msg) {
    latest[msg.t] = msg;
    if (pagePort) {
      try { pagePort.postMessage(msg); } catch { /* the page end is gone */ }
    } else if (typeof MessageChannel !== 'function') {
      try { window.postMessage({ source: 'uqa-' + msg.t, ...msg }, '*'); } catch { /* the page replaced postMessage */ }
    }
  }

  /* Recorded tester actions in this tab: the epoch the MAIN-world hook stamps on failures as `act`. */
  let act = 0;
  // Actions whose epoch the recorder already advanced in the capture phase
  // (`beginAct`); their later `emit` must not advance it a second time.
  let preBumped = 0;
  function beginAct() {
    if (!recording) return false;
    pushAct(++act);
    preBumped++;
    return true;
  }
  function pushAct(n) {
    toPage({ t: 'act', act: n });
  }

  function emit(event) {
    // r4-05-2: only an emit the recorder marked consumes a pre-bump; a foreign dom emit bumps for itself.
    if (GAME && event?.kind === 'expected') { qc.Expected++; writeQaw(); } // the in-page Not a bug press (autopilot.js, trusted click only)
    const pre = event?.preBumped === true;
    if (pre) delete event.preBumped;
    if (!recording) {
      if (!resolved && pending.length < PENDING_MAX) pending.push(stamp(event));
      else if (resolved && window.UQABuffer?.on) window.UQABuffer.push(stamp(event)); // decision 4: the 2-minute buffer, this page only
      else if (resolved && preRollOn()) {
        ring.push(stamp(event));
        trimRing();
      }
      return Promise.resolve(null);
    }
    if (event?.kind === 'dom') {
      if (pre && preBumped > 0) preBumped--;
      else pushAct(++act);
    }
    const out = stamp(event);
    for (const fn of taps) { try { fn(out); } catch { /* one tap must not stop the rest */ } } // C3: this isolated world only
    return send({ type: 'UQA_EVENT', event: out });
  }

  async function refreshSettings() {
    const res = await send({ type: 'UQA_GET_SETTINGS' });
    // No page event: a CustomEvent on the page's window is readable by the page itself.
    if (res?.ok) {
      window.UQASettings = res.result;
    }
    return window.UQASettings;
  }

  /**
   * Announce a change, so a script that has work to do at arm time can do it.
   *
   * `content/recorder.js` needs one round trip to the worker the moment it
   * starts recording inside a cross-origin frame, and it must not make that
   * trip on every click. Polling `isRecording()` would be the other way to
   * learn this and it would be a timer running on every page in the browser.
   */
  function announceRecording(next) {
    // Going recording -> off: let the recorder emit its pending debounced input
    // first, while the flag is still true (council-1009 r3-05-1).
    if (!next && recording) window.UQABridge?.beforeRecordingOff?.();
    const was = recording;
    recording = !!next;
    if (recording !== was) preBumped = 0;
    resolved = true;
    const held = pending;
    pending = [];
    if (recording) {
      trimRing();
      const old = ring;
      ring = [];
      for (const event of old) send({ type: 'UQA_EVENT', event, preRoll: true });
      const frozen = window.UQABuffer?.handoff?.() ?? [];
      if (GAME && frozen.length) qc.Buffer++; // a «Save last 2 minutes» start; published with the state change that follows
      for (const event of frozen) send({ type: 'UQA_EVENT', event, preRoll: true }); // only what «Save last 2 minutes» froze
      for (const event of held) send({ type: 'UQA_EVENT', event });
    } else if (window.UQABuffer?.on) for (const event of held) window.UQABuffer.push(event);
    else if (preRollOn()) {
      ring.push(...held);
      trimRing();
    } else clearRing();
    if (recording !== was) {
      try {
        window.dispatchEvent(new CustomEvent('uqa:recording', { detail: recording }));
      } catch {
        /* a page that has broken CustomEvent must not break recording */
      }
    }
    return recording;
  }

  /**
   * What the in-page bar and the host need to know, in one place (S8).
   *
   * `UQA_GET_STATE` sent from here names no window, so the worker answers for
   * the sender's own window (`hintFor` → `sender.tab.windowId`): with two
   * windows recording, each page sees its own session and its own `startedAt`.
   * `video` is any clip running anywhere (tab or screen), from
   * `UQA_RECORDING_CHANGED`, which the worker broadcasts to every tab on start
   * and stop; the top frame also asks for it once on load, so a page opened
   * mid-clip knows too. Watchers live in this isolated world only, so the page
   * under test hears none of it.
   */
  const state = { recording: false, startedAt: 0, autoStarted: false, video: false, awake: null, dead: false };
  const watchers = new Set();
  let barAsked = false;

  function publish(patch) {
    Object.assign(state, patch);
    for (const fn of watchers) {
      try { fn({ ...state }); } catch { /* one watcher must not silence the rest */ }
    }
    wantBar();
    if (GAME) writeQaw();
  }

  // Bug Hunt signal (DESIGN-bug-hunt section 9): the practice game on its own server, top frame only, may read the state and these
  // counts (numbers, never content) as page data. Everywhere else none of this runs and no attribute is ever created. Read-only.
  const GAME_ORIGIN = 'http://localhost:4173';
  // The same game is also the packaged practice page (practice/practice.html), whose origin is the extension's own.
  const GAME = (location.origin === GAME_ORIGIN || location.href.startsWith(chrome.runtime?.getURL?.('practice/') || '\0')) && window.top === window;
  let qawKey = '', qawEver = false;
  // Notes, Shots, Shortcut, NoteTypes, Marks come from the worker's `used` in UQA_GET_STATE; Expected and Buffer are counted here.
  const qc = { Notes: 0, Shots: 0, Shortcut: 0, Expected: 0, NoteTypes: 0, Marks: 0, Buffer: 0 };
  const QC_USED = { Notes: 'note', Shots: 'shot', Shortcut: 'shortcut', NoteTypes: 'notetype', Marks: 'markup' };
  function writeQaw() {
    if (!document.getElementById('qawLine') || !/^[0-9a-f]{32}$/.test(document.getElementById('qawRun')?.content || '')) return; // S-13: only a page the game server stamped with this run's nonce, and with the game's own status line, gets the signal
    const rec = state.recording && state.awake !== false;
    qawEver ||= rec;
    const v = rec ? 'recording' : qawEver ? 'stopped' : state.awake === false ? 'asleep' : state.awake ? 'ready' : '';
    const key = `${v}/${Object.values(qc)}`;
    if (!v || key === qawKey) return;
    qawKey = key;
    const d = document.documentElement.dataset;
    d.qawState = v;
    for (const k in qc) d['qaw' + k] = String(qc[k]);
    // A string detail: an object made in this isolated world reads as null in the page. The page reads the dataset.
    document.dispatchEvent(new CustomEvent('qaw:state', { detail: v }));
  }

  function watch(fn) {
    watchers.add(fn);
    try { fn({ ...state }); } catch { /* same */ }
    return () => watchers.delete(fn);
  }

  /**
   * The bar is injected on demand, top frame only, the first time a session
   * in this window is recording while this tab is in front. A background tab
   * waits until it is shown, so a window with forty tabs does not load forty
   * bars (and forty copies of the face) for one tester.
   */
  function wantBar() {
    if (barAsked || window.top !== window || window.UQABar) return;
    if (dead || !state.recording || state.video || state.awake === false) return;
    if (document.visibilityState === 'hidden') {
      document.addEventListener('visibilitychange', wantBar, { once: true });
      return;
    }
    barAsked = true;
    send({ type: 'UQA_BAR' });
  }

  async function refreshState() {
    const top = window.top === window;
    const res = await send({ type: 'UQA_GET_STATE', ...(top ? { video: true } : {}) });
    const r = res?.result;
    const recording = announceRecording(!!r?.recording);
    if (GAME && r?.recording) for (const k in QC_USED) qc[k] = Math.max(0, r.used?.[QC_USED[k]]?.count | 0); // kept after Stop
    // T-021: the bar's problems chip reads the same number as the badge and popup (UQA_GET_STATE carries it, COV-2).
    publish({ recording, startedAt: r?.session?.startedAt || 0, autoStarted: r?.session?.autoStarted === true, problems: Number(r?.problems) || 0, problemsTone: r?.problemsTone === 'error' ? 'error' : 'warning', evidence: ['shot', 'note', 'record'].reduce((n, k) => n + (Number(r?.used?.[k]?.count) || 0), 0), ...(top ? { video: !!r?.video } : {}) });
    return recording;
  }
  // ponytail: a 3 s poll in the top frame while recording and visible; a worker push on change replaces it if the cost shows.
  if (window.top === window) setInterval(() => { if (recording && document.visibilityState === 'visible') refreshState(); }, 3000);

  // Relay what the MAIN world observes: only the top-level kinds content/page-hooks.js posts (r2-05-1, D-1010-20).
  // D-1010-78 (r4-02-1): they arrive on a MessageChannel port that page-hooks.js hands over once at document_start, never as
  // window messages. A page can post any window message it likes, well-formed or not, but it cannot reach the far end of a
  // port it was never given: the first port wins, receipt is acknowledged over the port, and anything else is dropped.
  // Residual, by design: a page that injects its own listener before this one in an already loaded page (late injection by
  // the wake) can see the transfer; see work/council-1010/r4/L2-detail.md.
  const PAGE_KINDS = ['net', 'console', 'pageerror', 'rep'];
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'uqa-port') return;
    e.stopImmediatePropagation(); // D-1010-89: every uqa-port message, including later ones, stays out of the page's listeners
    if (pagePort || e.ports?.length !== 1) return;
    pagePort = e.ports[0];
    pagePort.onmessage = (m) => {
      const d = m.data;
      if (!d) return;
      if (d.t === 'event' && d.event && PAGE_KINDS.includes(d.event.kind)) emit(d.event);
      else if (d.t === 'rule-fired') send({ type: 'UQA_RULE_FIRED', ruleId: d.ruleId }).catch(() => {});
    };
    try { pagePort.postMessage('uqa-ack'); } catch { /* the page end is gone */ }
    for (const k of ['awake', 'act', 'rules']) if (latest[k]) toPage(latest[k]);
  });
  // If page-hooks.js ran first its offer may predate this listener; ask once more, but only if no offer has arrived by then
  // (D-1010-89: a hello that crossed an offer already on its way would replace the channel this side has just acknowledged).
  (typeof setTimeout === 'function' ? setTimeout : (fn) => fn())(() => {
    if (pagePort) return;
    try { window.postMessage({ source: 'uqa-hello' }, '*'); } catch { /* the page replaced postMessage */ }
  }, 100);

  /* --------------------------------------------------- override rule delivery */

  /**
   * Push the override rules down into the MAIN world, where the fetch/XHR patch
   * lives. Storage is async, so a request fired in the page's very first tick
   * can outrun the rules — inherent to MV3, and documented rather than hidden.
   */
  /**
   * Tell the MAIN world whether it may work.
   *
   * The hooks in page-hooks.js are installed at document_start but inert; this
   * is the message that switches them on, and switching them off again is what
   * makes "put it back to sleep" take effect immediately rather than at the next
   * page load.
   */
  function pushAwake(awake) {
    toPage({ t: 'awake', awake: !!awake });
  }

  async function refreshArmed() {
    try {
      const res = await send({ type: 'UQA_ARMED' });
      const awake = !!res?.result?.armed;
      pushAwake(awake);
      window.UQAAwake = awake;
      publish({ awake });
      if (!awake) pushRules([]);
      return awake;
    } catch {
      // Fail closed: unreachable worker means asleep, never "assume awake".
      pushAwake(false);
      window.UQAAwake = false;
      publish({ awake: false });
      return false;
    }
  }

  function pushRules(rules) {
    toPage({ t: 'rules', rules: rules || [] });
  }

  async function refreshRules() {
    try {
      const res = await send({ type: 'UQA_GET_RULES' });
      // Only live rules reach the page. A spent one stays in the list so the
      // tester can see that it fired, but the page must not act on it.
      pushRules((res?.result || []).filter((r) => r.enabled !== false && !(r.remaining != null && r.remaining <= 0)));
    } catch {
      pushRules([]);
    }
  }

  /*
   * The page tells the worker each time a rule fires, and the worker owns the
   * countdown (the page is destroyed on every navigation, so its own count
   * resets). That notice arrives on the same port as the events above.
   */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    /*
     * Only our own worker may move this page's switches.
     *
     * Everything below flips recording on, pushes override rules into the MAIN
     * world, or tells the page it is awake — which is to say, everything below
     * is a capability. `sender.id` is stamped by the browser and cannot be
     * spoofed by the sender; another extension's message carries that
     * extension's id, and a page has none at all. Without this, any extension
     * installed alongside QA Wrap could arm the fetch/XHR patch on every page
     * in a window the tester had put to sleep.
     *
     * `sender.tab` is refused too: every message here comes from the service
     * worker, which is not a tab. See `research/51d-legal-privacy-licensing.md`
     * §7 — authorise on `sender.id`, never on `sender.url`.
     */
    if (sender?.id !== chrome.runtime.id || sender?.tab) return;
    if (msg?.type === 'UQA_STATE_CHANGED') {
      // Take the flag from the message, now, before anything else runs: the
      // worker awaits this delivery, so by the time Start returns to whoever
      // pressed it the page is already recording. The refresh still follows
      // for everything else the state carries.
      if ('recording' in msg) announceRecording(msg.recording);
      refreshState();
    }
    if (msg?.type === 'UQA_FRAME_SELECTOR') {
      /*
       * Asked of the frame that *holds* an iframe, on behalf of the frame
       * inside it, which cannot see the element that holds it.
       *
       * Matched on the resolved URL rather than on the `src` attribute: a
       * relative src, a redirect and a client-side navigation all leave the
       * attribute saying something other than where the frame actually is. When
       * that is ambiguous — two frames on the same URL, or a frame that has
       * navigated away from its src — the worker's index among the siblings it
       * can see in the frame tree is the fallback.
       */
      const frames = [...document.querySelectorAll('iframe, frame')];
      const resolved = (f) => {
        const src = f.getAttribute('src');
        if (!src) return '';
        try {
          return new URL(src, document.baseURI).href;
        } catch {
          return '';
        }
      };
      const hits = msg.url ? frames.filter((f) => resolved(f) === msg.url) : [];
      const el = hits.length === 1 ? hits[0] : frames[msg.index] || hits[0] || null;
      const S = window.UQASelector;
      sendResponse(el && S ? S.frameSelector(el) : { selector: null, expr: null });
      return true;
    }

    if (msg?.type === 'UQA_RECORDING_CHANGED') publish({ video: !!msg.recording });

    if (msg?.type === 'UQA_RULES_CHANGED') refreshRules();
    // Pushed straight from the worker, so a fresh page gets its rules without
    // waiting for a round trip it has to start itself.
    if (msg?.type === 'UQA_RULES') pushRules(msg.rules || []);
    if (msg?.type === 'UQA_ARMED_CHANGED') {
      window.UQAAwake = !!msg.armed;
      if (!msg.armed) clearRing();
      publish({ awake: !!msg.armed });
      pushAwake(msg.armed);
      if (msg.armed) refreshRules();
      else pushRules([]);
    }
    if (msg?.type === 'UQA_SESSION_RESET') {
      pushRules([]);
      act = 0;
      preBumped = 0;
      pushAct(0);
    }
    if (msg?.type === 'UQA_SETTINGS_CHANGED') {
      window.UQASettings = msg.settings;
      if (msg.settings?.preRollBuffer !== true) clearRing();
    }
  });

  window.UQABridge = {
    send,
    emit,
    beginAct,
    refreshState,
    refreshRules,
    refreshSettings,
    isRecording: () => recording,
    buffering: () => !!window.UQABuffer?.on,
    preRollSize: () => ring.length,
    setRecording: (v) => announceRecording(v),
    watch,
    state: () => ({ ...state }),
    tap: (fn) => (taps.add(fn), () => taps.delete(fn)),
    sessionInfo: () => ({ recording: state.recording, startedAt: state.startedAt, autoStarted: state.autoStarted }),
  };

  // Arming first, and awaited: the MAIN world must be told it is asleep before
  // anything else has a chance to act. Rules are only fetched once it is awake.
  refreshArmed().then((awake) => {
    if (awake) refreshRules();
  });
  refreshState();
  refreshSettings();
})();
