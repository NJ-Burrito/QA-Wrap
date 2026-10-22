/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The in-page bar (DESIGN-SPEC §5, UI rework round 2, S8).
 *
 * One slim glass toolbar in the top frame of the page under test: record
 * status with Stop, the pick purpose (keys 1-4), the last locator with "Copy
 * again", and three quick actions. It docks to any edge, collapses to a pill,
 * fades 1.5 s after the pointer leaves it (unless pinned), and moves to the
 * opposite edge when a locked pick would sit under it. It never draws while a
 * video is being filmed (the float carries Stop then).
 *
 * Injected on demand, top frame only, by the worker (`UQA_BAR`), together with
 * `ui/icons.js` — never declared in `SITE_SCRIPTS`, so no frame of a page that
 * is not being recorded or picked in pays for it. It draws into the closed
 * shadow root `content/ui-host.js` owns, so screenshots already hide it.
 */
(() => {
  if (window.UQABar || window.top !== window) return;
  const H = window.UQAUiHost;
  const B = window.UQABridge;
  if (!H) return;

  const PURPOSES = ['any', 'step', 'element', 'sensitive'];
  const PURPOSE_LONG = { any: 'popup.pick.any', step: 'popup.pick.step', element: 'popup.pick.element', sensitive: 'popup.pick.sensitive' };
  const DOCK_KEY = 'qawBarDock';
  const PIN_KEY = 'qawBarPinned';
  /** How long the pointer must be away before the bar fades (Nader, 29 Sept). */
  const FADE_AFTER = 1500;
  const EDGES = ['top', 'bottom', 'left', 'right'];
  const M = 16; // px from the docked edge
  const LADDER = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']; // c6-c8 (T-021): key hints and locator, then purpose and pin, then quick actions, so a 360 px window still fits

  /** English until the tester's strings arrive with the face (`UQA_OVERLAY_ASSETS`). */
  const EN = {
    'overlay.bar.aria': 'QA Wrap controls on this page',
    'overlay.bar.grip': 'Move the bar. Arrow keys dock it to an edge.',
    'overlay.bar.notRecording': 'Not recording',
    'overlay.bar.problems': 'Problems: {n}',
    'overlay.bar.problemsCount': 'one: {n} problem · other: {n} problems',
    'overlay.bar.label.shot': 'Shot',
    'overlay.bar.label.note': 'Note',
    'overlay.bar.label.panel': 'Open panel',
    'overlay.bar.f1022LabelRecord': 'Record',
    'overlay.bar.f1022Record': 'Record the screen',
    'overlay.bar.f1022Evidence': 'one: {n} piece of evidence · other: {n} pieces of evidence',
    'overlay.bar.f1022Done': 'Done',
    'overlay.bar.f1022Failed': 'That did not work',
    'overlay.bar.pressKey': 'Press {n}',
    'overlay.bar.openFloat': 'Open QA Wrap',
    'overlay.bar.collapse': 'Shrink the bar',
    'overlay.bar.expand': 'Show the bar',
    'overlay.bar.pin': 'Keep the bar solid',
    'overlay.bar.pinned': 'Pinned: the bar stays solid. Press again to let it fade.',
    'overlay.purpose.any': 'Any', 'overlay.purpose.step': 'Step',
    'overlay.purpose.element': 'Element', 'overlay.purpose.sensitive': 'Sensitive',
    'overlay.purpose.anyHint': 'Any: a locator and nothing more.',
    'overlay.purpose.stepHint': 'Step: a step of the flow, in order. Shift+click to take several.',
    'overlay.purpose.elementHint': 'Element: something the script must account for. What it looks like now is recorded as the expected outcome.',
    'overlay.purpose.sensitiveHint': 'Sensitive: a value that must never be written down. Its own words are withheld.',
    'overlay.chip.picked': 'Picked: {n}',
    'overlay.chip.hint': 'Enter copies all · Shift+click adds · Ctrl+Shift+click marks something to check · Alt+Shift+click adds and names a credential · Esc cancels',
    'popup.pick.head': 'What the pick is for',
    'popup.pick.any': 'Any locator', 'popup.pick.step': 'Steps of the flow',
    'popup.pick.element': 'Elements to account for', 'popup.pick.sensitive': 'Sensitive values',
    'popup.live.stop': 'Stop',
    'popup.live.noLocator': 'No locator yet',
    'popup.live.copyAgain': 'Copy again',
    'options.sound.ui.copy': 'Copied',
    'options.actions.shot.label': 'Screenshot',
    'popup.note.add': 'Add note',
    'overlay.bar.updated': 'QA Wrap was updated. Reload this tab to keep recording.',
  };
  const raw = (key) => String(H.t ? H.t(key, EN[key]) : EN[key]);
  const t = (key, n) => raw(key).replace('{n}', n);
  /** "3 problems": the popup's CLDR plural forms ("one: … · other: …"), cut down to the one the count needs. */
  function tCount(key, n) {
    const text = raw(key);
    if (!/^(zero|one|two|few|many|other): /.test(text)) return text.replace(/\{n\}/g, n);
    const forms = Object.fromEntries(text.split(' · ').map((p) => [p.slice(0, p.indexOf(':')).trim(), p.slice(p.indexOf(':') + 1).trim()]));
    let lang = 'en';
    try { lang = bar.getRootNode().host?.lang || (getComputedStyle(bar).direction === 'rtl' ? 'ar' : 'en'); } catch { /* English */ }
    let form;
    try { form = new Intl.PluralRules(lang).select(n); } catch { form = 'other'; }
    return (forms[form] ?? forms.other ?? text).replace(/\{n\}/g, n);
  }
  /** "Alt+KeyN" -> "Alt+N", from the tester's own keymap; '' when the action has no key. */
  const keyOf = (action) => {
    const v = window.UQASettings?.keymap?.[action];
    return v ? String(v).replace(/Key([A-Z])$/, '$1').replace(/Digit(\d)$/, '$1') : '';
  };
  const icon = (id) => window.UQAIcon?.(id, { size: 's' }) || '';
  /**
   * The brand mark for the idle pill (DESIGN-SPEC §5.1: "otherwise the mark 20
   * alone"). Inlined rather than fetched: a content script needs no
   * web_accessible_resources entry for markup it draws itself. Geometry from
   * identity/tools/marks.mjs (brand/mark-small.svg, the small-size cut), in
   * the brand's two tones — the stroke colours live in overlay.css
   * (`--uqa-mark-ring`, `--uqa-brand-petra`) so the dark variant follows the theme.
   */
  const MARK = '<svg viewBox="0 0 64 64" width="20" height="20" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(-2 1)"><path class="uqa-mark-ring" d="M45.01 37.98A17 17 0 1 0 34.97 46.26"/><path class="uqa-mark-check" d="M36.36 36.36L43.25 44.84L56.5 19.4"/></g></svg>';
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const grow = (r, px) => ({ left: r.left - px, top: r.top - px, right: r.right + px, bottom: r.bottom + px });
  const meets = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  const inside = (x, y, r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const vertical = (edge) => edge === 'left' || edge === 'right';
  const opposite = (edge) => ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' })[edge];
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    edge: 'bottom', pos: 0.5, collapsed: false, effective: 'bottom',
    live: false, startedAt: 0, video: false, awake: null, problems: 0, evidence: 0, tone: 'warning',
    picking: !!window.UQAPicker?.isActive?.(), used: !!window.UQAPicker?.isActive?.(),
    purpose: window.UQAPicker?.purpose?.() || 'any',
    locator: '', locked: [],
    dragging: false, faded: false, focusInside: false, tipOpen: false, shown: false, pinned: false, fieldYield: false,
  };

  /* ── markup ─────────────────────────────────────────────────────────── */
  const el = (tag, cls, attrs = {}) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const button = (cls, iconId, extra) => {
    const b = el('button', cls, { type: 'button', ...extra });
    b.innerHTML = icon(iconId);
    return b;
  };

  const bar = H.uiLayer('uqa-bar');
  // uiLayer() turns pointer events on inline; the stylesheet owns them here, so the fade can be click-through.
  bar.style.pointerEvents = '';
  bar.setAttribute('role', 'toolbar');
  bar.hidden = true;
  const grip = button('uqa-grip', 'grip');
  const record = el('div', 'uqa-record');
  const dot = el('span', 'uqa-dot', { 'aria-hidden': 'true' });
  const timer = el('span', 'uqa-timer');
  const stop = button('uqa-btn uqa-btn-primary uqa-stop', 'stop');
  const stopLabel = el('span', 'uqa-stop-label');
  stop.append(stopLabel);
  const idle = el('span', 'uqa-idle', { role: 'img' });
  const idleRing = el('span', 'uqa-idle-ring');
  const idleTxt = el('span', 'uqa-idle-txt');
  idle.append(idleRing, idleTxt);
  // T-021 / 1015: the problems chip, a glyph and "3 problems" (the number alone when narrow), absent at zero; pressing it opens the float's problems list.
  const probs = el('button', 'uqa-problems', { type: 'button' });
  probs.hidden = true;
  // f1022: the evidence counter (screenshots + recordings + notes), an icon and a number; the words live in the name and the tooltip.
  const evid = el('span', 'uqa-evidence', { role: 'img', 'data-live': '' });
  probs.setAttribute('data-live', '');
  record.append(dot, timer, probs, evid, stop, idle);
  const group = el('div', 'uqa-purpose', { role: 'radiogroup' });
  const thumb = el('span', 'uqa-purpose-thumb', { 'aria-hidden': 'true' });
  group.append(thumb);
  const segs = PURPOSES.map((p, i) => {
    const s = el('button', 'uqa-seg', { type: 'button', role: 'radio', 'data-purpose': p });
    s.innerHTML = `<span class="uqa-kbd">${i + 1}</span>${icon(`purpose-${p}`)}<span class="uqa-seg-label"></span>`;
    group.append(s);
    return s;
  });
  const locatorBox = el('div', 'uqa-locator');
  const code = el('button', 'uqa-code', { type: 'button' });
  const copy = button('uqa-icon-btn', 'copy');
  locatorBox.append(code, copy);
  const quick = el('div', 'uqa-quick');
  // 1015: a short visible word beside the icon while the bar has room (the c1 step drops it); the name and the key stay in the tooltip.
  const labels = [];
  const worded = (iconId, key) => {
    const b = button('uqa-icon-btn has-label', iconId);
    const word = el('span', 'uqa-lbl', { 'aria-hidden': 'true' });
    b.append(word);
    labels.push([word, key]);
    return b;
  };
  const shot = worded('screenshot', 'overlay.bar.label.shot');
  const note = worded('note', 'overlay.bar.label.note');
  const openFloat = worded('dock', 'overlay.bar.label.panel'); // the side-panel glyph (a window with its panel filled), not the old window-with-a-title-bar
  const rec = worded('tool-record', 'overlay.bar.f1022LabelRecord'); // f1022: the same screen-recording start the side panel uses (UQA_RECORD_SCREEN)
  quick.append(shot, note, rec, openFloat);
  const pin = button('uqa-icon-btn uqa-pin', 'pin', { 'aria-pressed': 'false' });
  const collapse = button('uqa-icon-btn', 'collapse');
  const div = () => el('span', 'uqa-div', { 'aria-hidden': 'true' });
  // 1015: the pick purpose, the locator and their dividers exist only while a pick is on (`.is-picking`).
  const pickOnly = (n) => { n.classList.add('uqa-pickonly'); return n; };
  group.classList.add('uqa-pickonly');
  locatorBox.classList.add('uqa-pickonly');
  bar.append(grip, div(), record, pickOnly(div()), group, pickOnly(div()), locatorBox, div(), quick, div(), pin, collapse);

  const pill = el('button', 'uqa-pill', { type: 'button' });
  pill.hidden = true;
  const pillDot = el('span', 'uqa-dot', { 'aria-hidden': 'true' });
  const pillTimer = el('span', 'uqa-timer');
  const pillExpand = el('span', 'uqa-pill-icon', { 'aria-hidden': 'true' });
  pillExpand.innerHTML = icon('expand');
  const pillMark = el('span', 'uqa-pill-icon uqa-pill-mark', { 'aria-hidden': 'true' });
  pillMark.innerHTML = MARK;
  pill.append(pillDot, pillTimer, pillExpand, pillMark);
  H.uiRoot().appendChild(pill);

  const tip = H.uiLayer('uqa-bar-tip');
  tip.style.pointerEvents = '';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const live = H.uiLayer('uqa-vh');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  H.expose?.();

  /* ── strings ────────────────────────────────────────────────────────── */
  function paintStrings() {
    bar.setAttribute('aria-label', t('overlay.bar.aria'));
    const name = (b, key) => { b.setAttribute('aria-label', t(key)); };
    name(grip, 'overlay.bar.grip');
    stopLabel.textContent = t('popup.live.stop');
    name(stop, 'popup.live.stop');
    idleTxt.textContent = t('overlay.bar.notRecording');
    name(idle, 'overlay.bar.notRecording');
    group.setAttribute('aria-label', t('popup.pick.head'));
    segs.forEach((s) => { s.querySelector('.uqa-seg-label').textContent = t(`overlay.purpose.${s.dataset.purpose}`); });
    name(copy, 'popup.live.copyAgain');
    name(shot, 'options.actions.shot.label');
    name(note, 'popup.note.add');
    name(openFloat, 'overlay.bar.label.panel');
    name(rec, 'overlay.bar.f1022Record');
    paintEvidence();
    labels.forEach(([word, key]) => { word.textContent = t(key); });
    paintProblems(state.problems | 0);
    name(collapse, 'overlay.bar.collapse');
    name(pin, 'overlay.bar.pin');
    name(pill, 'overlay.bar.expand');
    paintLocator();
  }

  /* ── record / timer (from startedAt; no per-second message) ─────────── */
  let tick = 0;
  function timerHtml() {
    const s = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
    const text = `${String(Math.floor(s / 60) % 100).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return [...text].map((c) => (c === ':' ? '<span class="sep">:</span>' : `<span>${c}</span>`)).join('');
  }
  function paintRecord() {
    const on = state.live && state.startedAt > 0;
    dot.hidden = timer.hidden = stop.hidden = !on;
    idle.hidden = on;
    pill.classList.toggle('is-live', on);
    pillExpand.hidden = !on;
    pillMark.hidden = on;
    clearInterval(tick);
    if (on) {
      const paint = () => { timer.innerHTML = pillTimer.innerHTML = timerHtml(); };
      paint();
      tick = setInterval(paint, 1000);
    }
  }

  /* ── the problems chip and its cue (T-021) ──────────────────────────── */
  let saidAt = 0;
  function paintProblems(prev) {
    const n = state.problems | 0;
    const tier = n === 0 ? 'note' : state.tone === 'error' ? 'error' : 'warning'; // f1022: shown at zero too (a quiet "0"), so the counter is always there
    const on = state.live;
    probs.hidden = !on;
    if (!on) return;
    const words = tCount('overlay.bar.problemsCount', n);
    probs.className = `uqa-problems tier-${tier}${n === 0 ? ' is-zero' : ''}`;
    probs.innerHTML = `${window.UQATone?.glyph(tier) || ''}<span class="uqa-problems-n" aria-hidden="true">${n}</span><span class="uqa-problems-full" aria-hidden="true">${esc(words)}</span>`;
    probs.setAttribute('aria-label', words);
    if (tier !== 'error' || n <= prev) return;
    // the first new Error: a pulse, or under reduced motion one frame of outline change, never nothing
    probs.classList.add('is-cue');
    if (reduced()) requestAnimationFrame(() => requestAnimationFrame(() => probs.classList.remove('is-cue')));
    else setTimeout(() => probs.classList.remove('is-cue'), 700);
    if (Date.now() - saidAt > 5000) { saidAt = Date.now(); announce(t('overlay.bar.problems', n)); }
  }

  function paintEvidence() {
    const n = state.evidence | 0;
    evid.hidden = !state.live;
    evid.innerHTML = `${icon('open-report')}<span class="uqa-evidence-n" aria-hidden="true">${n}</span>`;
    evid.setAttribute('aria-label', tCount('overlay.bar.f1022Evidence', n));
  }
  /** f1022: a press that runs something: its icon turns until the worker answers, then a check or a cross (ui/live.js). A cancelled picker is neither. */
  async function press(btn, msg) {
    window.UQALive?.start(btn);
    const res = await B?.send(msg);
    const cancelled = res?.result?.cancelled === true;
    const ok = !!res && res.ok !== false;
    window.UQALive?.end(btn, cancelled ? undefined : ok);
    if (!cancelled) announce(t(ok ? 'overlay.bar.f1022Done' : 'overlay.bar.f1022Failed'));
    setTimeout(() => B?.refreshState?.(), 700); // the counters follow the press at once, not at the next 3 s poll
    return res;
  }

  /* ── 1015: the pick controls show only while a pick is on ──────────── */
  function paintPicking() {
    bar.classList.toggle('is-picking', state.picking);
    paintRoving();
  }

  /* ── the purpose switch ─────────────────────────────────────────────── */
  function paintPurpose() {
    segs.forEach((s) => {
      const on = s.dataset.purpose === state.purpose;
      s.setAttribute('aria-checked', String(on));
      s.tabIndex = -1;
    });
    group.dataset.purpose = state.purpose;
    placeThumb();
  }
  function placeThumb() {
    const seg = segs.find((s) => s.dataset.purpose === state.purpose);
    if (!seg || bar.hidden) return;
    const rtl = getComputedStyle(bar).direction === 'rtl';
    const x = rtl ? -(group.clientWidth - seg.offsetLeft - seg.offsetWidth) : seg.offsetLeft;
    thumb.style.setProperty('--thumb-x', `${x}px`);
    thumb.style.setProperty('--thumb-y', `${seg.offsetTop}px`);
    thumb.style.setProperty('--thumb-w', `${seg.offsetWidth}px`);
    thumb.style.setProperty('--thumb-h', `${seg.offsetHeight}px`);
  }

  /* ── last locator ───────────────────────────────────────────────────── */
  function paintLocator() {
    code.textContent = state.locator || t('popup.live.noLocator');
    code.classList.toggle('is-empty', !state.locator);
    copy.disabled = !state.locator;
  }
  async function copyAgain() {
    if (!state.locator) return;
    let ok = false;
    try { await navigator.clipboard.writeText(state.locator); ok = true; } catch { /* focus elsewhere */ }
    if (!ok && window.UQAPicker?.copy) ok = (await window.UQAPicker.copy(state.locator)) !== 'failed';
    if (!ok) return;
    copy.classList.remove('is-copied');
    void copy.offsetWidth;
    const was = copy.innerHTML;
    copy.innerHTML = window.UQAIcon?.('check', { size: 's' }) || was;
    copy.classList.add('is-copied');
    setTimeout(() => { copy.innerHTML = was; copy.classList.remove('is-copied'); }, 1200);
    announce(t('options.sound.ui.copy'));
  }
  function announce(text) {
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = text; });
  }

  /* ── placement: dock, compaction, yield ─────────────────────────────── */
  const shell = () => (state.collapsed ? pill : bar);
  function target(edge, w, h) {
    const vw = innerWidth;
    const vh = innerHeight;
    if (!vertical(edge)) return { x: clamp(state.pos * vw - w / 2, M, vw - M - w), y: edge === 'bottom' ? vh - M - h : M };
    return { x: edge === 'left' ? M : vw - M - w, y: clamp(state.pos * vh - h / 2, M, vh - M - h) };
  }
  // The static box sits at inset-inline-start:0 (the physical right in RTL); one place subtracts it.
  const place = (n, x, y, extra = '') => `translate(${Math.round(x - n.offsetLeft)}px, ${Math.round(y - n.offsetTop)}px)${extra}`;
  function compact() {
    LADDER.forEach((k) => bar.classList.remove(k));
    if (vertical(state.edge) || bar.hidden) return;
    const cap = Math.min(innerWidth - 32, 1024);
    const natural = () => { bar.style.maxInlineSize = 'none'; const w = bar.offsetWidth; bar.style.maxInlineSize = ''; return w; };
    for (let i = 0; i < LADDER.length && natural() > cap; i++) bar.classList.add(LADDER[i]);
  }
  function home() {
    const n = shell();
    const w = n.offsetWidth;
    const h = n.offsetHeight;
    const at = target(state.edge, w, h);
    const rect = { left: at.x, top: at.y, right: at.x + w, bottom: at.y + h };
    // Yield (§5.4): a locked ring under the bar sends it to the opposite edge until it clears.
    // 1015: so does a text field the tester focused under it, once, and it stays until the tester docks it (no snap-back).
    const covered = state.fieldYield || state.locked.some((r) => meets(grow(r, 8), rect));
    state.effective = covered ? opposite(state.edge) : state.edge;
    return covered ? target(state.effective, w, h) : at;
  }
  function relayout(entrance) {
    const n = shell();
    if (n.hidden) return;
    bar.classList.toggle('is-vertical', vertical(state.edge));
    compact();
    const at = home();
    if (entrance && !reduced()) {
      const off = { bottom: [0, 8], top: [0, -8], left: [-8, 0], right: [8, 0] }[state.effective];
      n.style.transition = 'none';
      n.style.opacity = '0';
      n.style.transform = place(n, at.x + off[0], at.y + off[1]);
      void n.offsetWidth;
      n.style.transition = '';
      n.style.opacity = '';
    }
    n.style.transform = place(n, at.x, at.y);
    placeThumb();
    // A move (yield, dock, resize) can put the bar under a pointer that has not moved, or away from it.
    setTimeout(proximity, 260);
  }
  function dock(edge, pos = state.pos) {
    const flip = vertical(edge) !== vertical(state.edge);
    Object.assign(state, { edge, pos, fieldYield: false }); // the tester placed it: that is the home again
    save();
    if (!flip || reduced()) return relayout();
    // Orientation change (§8 #27): fade out, re-lay out, rise in at the new edge.
    const n = shell();
    n.style.opacity = '0';
    setTimeout(() => { n.style.opacity = ''; relayout(true); }, 150);
  }

  /*
   * Dock memory: {edge, pos, collapsed} in chrome.storage.sync.
   *
   * Not `local`: the worker closes `chrome.storage.local` to content scripts
   * (`setAccessLevel TRUSTED_CONTEXTS`, service-worker.js — the Jira token and
   * the tracker configuration live there), so a read from here throws and the
   * bar would forget its edge on every page. `sync` holds no secret and is
   * where the language choice already lives; a dock follows the tester the
   * same way.
   */
  function save() {
    try { chrome.storage?.sync?.set?.({ [DOCK_KEY]: { edge: state.edge, pos: state.pos, collapsed: state.collapsed } }); } catch { /* fine */ }
  }
  function load() {
    // The pin lives beside the dock in sync; read on its own so a missing key
    // cannot hold the dock back.
    try {
      chrome.storage.sync.get(PIN_KEY, (got) => {
        void chrome.runtime.lastError;
        state.pinned = got?.[PIN_KEY] === true;
        paintPin();
      });
    } catch { /* fine */ }
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DOCK_KEY, (got) => {
          void chrome.runtime.lastError;
          const d = got?.[DOCK_KEY];
          if (d && EDGES.includes(d.edge)) state.edge = d.edge;
          if (d && typeof d.pos === 'number') state.pos = clamp(d.pos, 0, 1);
          if (d && typeof d.collapsed === 'boolean') state.collapsed = d.collapsed;
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  /**
   * 1015: a text field the tester focuses under the bar (Jira's sticky comment box) sends the bar to the opposite
   * edge, once. Caused by the tester's own focus, never by itself; the pick ring's yield is reused (home()).
   * ponytail: a field inside an iframe is the iframe's own focus, not seen here; add a frame-rect check if a tracker needs it.
   */
  const TEXTY = /^(text|search|email|url|tel|password|number)$/i;
  document.addEventListener('focusin', (e) => {
    const f = e.target;
    const field = f?.tagName === 'TEXTAREA' || (f?.tagName === 'INPUT' && TEXTY.test(f.type || 'text')) || f?.isContentEditable === true;
    if (!field || !state.shown || state.dragging || state.fieldYield || state.effective !== state.edge) return;
    const n = shell();
    if (n.hidden || !meets(grow(f.getBoundingClientRect(), 8), n.getBoundingClientRect())) return;
    state.fieldYield = true;
    relayout();
  }, true);

  /* ── show / hide ────────────────────────────────────────────────────── */
  /**
   * Fade `n` to opacity 0 — the transition already declared on `.uqa-bar`/
   * `.uqa-pill` — before setting `hidden`, instead of flipping straight to
   * `display:none` (DESIGN-SPEC rows 24, 29-30: "opacity ...", never instant).
   * ponytail: one plain cross-fade covers both the whole-layer hide and the
   * bar/pill swap; the spec's extra clip-path/scale flourish is cut — add a
   * class alongside `.is-out` in overlay.css if the exact motion is wanted.
   */
  function fadeOut(n, after) {
    if (n.hidden) { after?.(); return; }
    n.classList.add('is-out');
    const done = () => { n.hidden = true; n.classList.remove('is-out'); n.removeEventListener('transitionend', done); after?.(); };
    n.addEventListener('transitionend', done);
    setTimeout(done, 350); // safety net: a transition that never fires must not wedge the shell hidden forever
  }
  /** The reverse of fadeOut: `n` is already hidden; reveal it fading opacity 0 → 1. */
  function fadeIn(n) {
    n.hidden = false;
    n.style.transition = 'none';
    n.classList.add('is-out');
    void n.offsetWidth;
    n.style.transition = '';
    n.classList.remove('is-out');
  }
  function paintShown() {
    const shown = !state.video && state.awake !== false && (state.live || state.picking || state.used);
    const was = state.shown;
    state.shown = shown;
    if (!shown) {
      state.fieldYield = false;
      hideTip();
      if (was) { fadeOut(bar); fadeOut(pill); } else { bar.hidden = true; pill.hidden = true; }
      return;
    }
    if (!was) {
      bar.hidden = state.collapsed;
      pill.hidden = !state.collapsed;
      relayout(true);
      return;
    }
    relayout();
  }
  function setCollapsed(next) {
    if (next === state.collapsed) return;
    hideTip();
    if (!state.shown) { state.collapsed = next; save(); if (!next) grip.focus(); return; }
    const from = next ? bar : pill;
    const to = next ? pill : bar;
    fadeOut(from, () => {
      state.collapsed = next;
      save();
      fadeIn(to);
      relayout();
      if (!next) grip.focus();
    });
  }

  /* ── drag (§5.2) ────────────────────────────────────────────────────── */
  function bindDrag(handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const n = shell();
      const start = n.getBoundingClientRect();
      const dx = e.clientX - start.left;
      const dy = e.clientY - start.top;
      let moved = false;
      try { handle.setPointerCapture(e.pointerId); } catch { /* fine */ }
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        moved = true;
        state.dragging = true;
        n.classList.add('is-dragging');
        setFaded(false);
        n.style.transform = place(n, ev.clientX - dx, ev.clientY - dy);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        n.classList.remove('is-dragging');
        state.dragging = false;
        if (!moved) return;
        handle.dataset.dragged = '1';
        const r = n.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = { top: cy, bottom: innerHeight - cy, left: cx, right: innerWidth - cx };
        const edge = EDGES.reduce((a, b) => (d[b] < d[a] ? b : a));
        dock(edge, clamp(vertical(edge) ? cy / innerHeight : cx / innerWidth, 0, 1));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  /* ── the fade (§5.3, reworked 29 Sept): passive, capture, no polling ──── */
  /*
   * Solid while the pointer is on or near it (24 px), while focus is inside,
   * while a tooltip is open, while it is being dragged, and always while
   * pinned. Once the pointer has been away FADE_AFTER ms it fades to a
   * click-through ghost; the pointer coming near or focus entering brings it
   * back at once. The old rule — fade as the pointer *approaches* — made the
   * bar vanish exactly when the tester reached for it.
   */
  const FAR = { x: -1e4, y: -1e4 };
  let pointer = FAR;
  let awayTimer = 0;
  function setFaded(on) {
    if (state.faded === on) return;
    state.faded = on;
    bar.classList.toggle('is-faded', on);
    pill.classList.toggle('is-faded', on);
  }
  const holdSolid = () => state.pinned || state.focusInside || state.tipOpen || state.dragging;
  function near() {
    const n = shell();
    return !n.hidden && inside(pointer.x, pointer.y, grow(n.getBoundingClientRect(), 24));
  }
  function proximity() {
    if (!state.shown || shell().hidden) return;
    if (holdSolid() || near()) {
      clearTimeout(awayTimer);
      awayTimer = 0;
      setFaded(false);
      return;
    }
    if (state.faded || awayTimer) return;
    awayTimer = setTimeout(() => {
      awayTimer = 0;
      if (state.shown && !holdSolid() && !near()) setFaded(true);
    }, FADE_AFTER);
  }
  addEventListener('pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY }; proximity(); }, { capture: true, passive: true });
  // Out of the page (to the toolbar, the side panel): away, not frozen where it left.
  document.documentElement.addEventListener('mouseleave', () => { pointer = FAR; proximity(); }, { passive: true });
  for (const n of [bar, pill]) {
    n.addEventListener('focusin', () => { state.focusInside = true; setFaded(false); proximity(); });
    n.addEventListener('focusout', (e) => { if (!n.contains(e.relatedTarget)) { state.focusInside = false; proximity(); } });
  }
  function paintPin() {
    pin.setAttribute('aria-pressed', String(state.pinned));
    pin.classList.toggle('is-on', state.pinned);
    proximity();
  }

  /* ── tooltips (400 ms hover, instant on focus) ──────────────────────── */
  let tipTimer = 0;
  function showTip(anchor, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - 8 - w)}px`;
    tip.style.top = `${y}px`;
    state.tipOpen = true;
    requestAnimationFrame(() => tip.classList.add('is-visible'));
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tip.classList.remove('is-visible');
    tip.hidden = true;
    state.tipOpen = false;
    proximity();
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function tipFor(anchor, content) {
    const open = () => showTip(anchor, content());
    anchor.addEventListener('pointerenter', () => { clearTimeout(tipTimer); tipTimer = setTimeout(open, 400); });
    anchor.addEventListener('pointerleave', hideTip);
    anchor.addEventListener('focus', open);
    anchor.addEventListener('blur', hideTip);
  }
  segs.forEach((s, i) => tipFor(s, () => {
    const p = s.dataset.purpose;
    const basket = window.UQAPicker?.basketSize?.() || 0;
    return `<strong>${esc(t(PURPOSE_LONG[p]))}</strong><span>${esc(t(`overlay.purpose.${p}Hint`))}</span>` +
      `<span>${esc(t('overlay.bar.pressKey', i + 1))}</span>` +
      (basket ? `<span>${esc(t('overlay.chip.picked', basket))}</span>` : '') +
      (state.picking ? `<span>${esc(t('overlay.chip.hint'))}</span>` : '');
  }));
  for (const b of [code, copy]) tipFor(b, () => (state.locator ? `<code>${esc(state.locator)}</code>` : esc(t('popup.live.noLocator'))));
  // 1015: the tester's own key for the action rides in the tooltip, where the accessible name does not carry it.
  for (const [b, key, action] of [[shot, 'options.actions.shot.label', 'shot'], [note, 'popup.note.add', 'note'], [openFloat, 'overlay.bar.openFloat'], [collapse, 'overlay.bar.collapse'], [grip, 'overlay.bar.grip', 'bar'], [pill, 'overlay.bar.expand']]) {
    tipFor(b, () => esc(t(key)) + (keyOf(action) ? `<span dir="ltr">${esc(keyOf(action))}</span>` : ''));
  }
  tipFor(evid, () => esc(tCount('overlay.bar.f1022Evidence', state.evidence | 0)));
  tipFor(rec, () => esc(t('overlay.bar.f1022Record')));
  tipFor(probs, () => esc(t('overlay.bar.openFloat')));
  tipFor(pin, () => esc(t(state.pinned ? 'overlay.bar.pinned' : 'overlay.bar.pin')));
  tipFor(idle, () => esc(t('overlay.bar.notRecording')));

  /* ── keyboard: one tab stop, arrows inside (toolbar pattern, §6) ────── */
  const items = () => [...bar.querySelectorAll('button')].filter((b) => b.getClientRects().length && !b.disabled);
  let roving = 0;
  function paintRoving() {
    items().forEach((b, i) => { b.tabIndex = i === roving ? 0 : -1; });
  }
  bar.addEventListener('focusin', (e) => {
    const i = items().indexOf(e.target);
    if (i >= 0) { roving = i; paintRoving(); }
  });
  bar.addEventListener('keydown', (e) => {
    if (e.target === grip && e.key.startsWith('Arrow')) {
      e.preventDefault();
      dock({ ArrowUp: 'top', ArrowDown: 'bottom', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]);
      return;
    }
    const list = items();
    let i = list.indexOf(e.target);
    if (i < 0) return;
    const rtl = getComputedStyle(bar).direction === 'rtl';
    const across = !bar.classList.contains('is-vertical');
    const next = across ? (rtl ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
    const prev = across ? (rtl ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp';
    if (e.key === next) i = (i + 1) % list.length;
    else if (e.key === prev) i = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = list.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    roving = i;
    paintRoving();
    list[i].focus();
  });
  // A key typed on the bar is the bar's, never the page's shortcut (keys 1-4 included).
  bar.addEventListener('keyup', (e) => e.stopPropagation());

  /* ── T-044: the extension was updated under this tab. Nothing that cannot work stays on screen. ── */
  let dying = false;
  function die() {
    if (dying) return;
    dying = true;
    clearInterval(tick);
    state.shown = false;
    H.clearUi(); // the bar, the pill and anything else drawn, so no control is left to press
    const msg = H.uiLayer('uqa-toast uqa-toast-err is-dead');
    msg.setAttribute('aria-hidden', 'true'); // D-1010-111: the persistent live region reads it, not this visual toast
    msg.dir = 'auto';
    msg.textContent = t('overlay.bar.updated');
    H.announce?.(t('overlay.bar.updated'));
  }

  /* ── actions ────────────────────────────────────────────────────────── */
  // The bar plays no sound: ui/sound.js is not injected here (its files are not web-accessible, so a host page cannot see them). Result sounds reach the person through UQA_CUE.
  const act = (b, fn) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(e); });
  act(grip, () => { delete grip.dataset.dragged; });
  act(stop, () => press(stop, { type: 'UQA_STOP', here: true }));
  segs.forEach((s) => act(s, () => {
    state.purpose = s.dataset.purpose;
    paintPurpose();
    B?.send({ type: 'UQA_PICK', purpose: state.purpose });
  }));
  act(code, copyAgain);
  act(copy, copyAgain);
  act(shot, () => press(shot, { type: 'UQA_CAPTURE', text: '' }));
  act(rec, () => press(rec, { type: 'UQA_RECORD_SCREEN' }));
  act(note, () => window.UQAKeymap?.promptNote?.());
  act(openFloat, () => B?.send({ type: 'UQA_OPEN_FLOAT' }));
  act(probs, () => B?.send({ type: 'UQA_OPEN_FLOAT' })); // the float's live view carries the problems list; no deep link exists, the same message as the Panel button
  act(collapse, () => setCollapsed(true));
  act(pin, () => {
    state.pinned = !state.pinned;
    try { chrome.storage?.sync?.set?.({ [PIN_KEY]: state.pinned }); } catch { /* fine */ }
    paintPin();
  });
  act(pill, () => { if (pill.dataset.dragged) { delete pill.dataset.dragged; return; } setCollapsed(false); });
  bindDrag(grip);
  bindDrag(pill);

  addEventListener('resize', () => relayout(), { passive: true });
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => { if (!state.dragging) requestAnimationFrame(() => relayout()); });
    [...bar.children].forEach((k) => ro.observe(k));
  }

  /* ── the public face: the picker and the host talk to the bar here ──── */
  window.UQABar = {
    /** The rect of whatever is drawn (bar or pill), or null: the chip and the toasts avoid it. */
    rect: () => {
      const n = shell();
      if (!state.shown || n.hidden) return null;
      const r = n.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    },
    setPurpose: (p) => { if (PURPOSES.includes(p)) { state.purpose = p; paintPurpose(); } },
    setLocator: (text) => { state.locator = String(text || '').split('\n')[0]; paintLocator(); relayout(); },
    picking: (on) => { state.picking = !!on; if (on) state.used = true; paintPicking(); paintShown(); },
    setLocked: (rects) => { state.locked = rects || []; relayout(); },
    probe: () => ({ shown: state.shown, edge: state.edge, effective: state.effective, collapsed: state.collapsed, live: state.live, faded: state.faded, pinned: state.pinned, picking: state.picking, fieldYield: state.fieldYield }),
    dock: (edge, pos) => dock(edge, pos),
    collapse: (on) => setCollapsed(!!on),
    // T-060: Alt+B lands on the grip, or on the pill when collapsed; false when the bar is not on screen.
    focusBar: () => { const n = shell(); if (!state.shown || n.hidden) return false; (state.collapsed ? pill : grip).focus(); return true; },
  };

  load().then(() => {
    paintStrings();
    paintPurpose();
    paintPicking();
    paintRecord();
    paintEvidence();
    paintPin();
    B?.watch?.((s) => {
      if (s.dead) return die();
      const liveNow = !!s.recording;
      const changed = liveNow !== state.live || s.startedAt !== state.startedAt;
      const prevProblems = state.problems | 0;
      Object.assign(state, { live: liveNow, startedAt: s.startedAt || 0, video: !!s.video, awake: s.awake, problems: s.problems | 0, evidence: s.evidence | 0, tone: s.problemsTone });
      if (changed) paintRecord();
      paintProblems(prevProblems);
      paintEvidence();
      paintShown();
    });
    paintShown();
    paintRoving();
    H.assets?.().then(() => { paintStrings(); relayout(); });
  });
})();
