// Bug Hunt hard trials, UI layer (lane T2). Spec: work/sdlc/design/DESIGN-bug-hunt-hard.md + APPROVAL-hard.md.
// Loaded lazily by game.js. It owns the entry link, the stage card, the check-your-tools screen, the run strip, the death cover,
// the rest dock, the pause box and the clear dialog. The schedule, the window judge and the arena DOM are lane T1 (/trial.js):
//   createTrial({ doc, win, t, clock, storage, getState, getCounts, root, fetch }) -> { open, attune, begin, leave, pause, resume,
//   pasteText, bindPasteGate, view, on, destroy, fire, allowNoShortcut, restoreRestart, reset, setCalm }; events trial:door|attune|start|room|
//   tell|ok|death|clear|pasted|pause. T1 empties `root` whenever it rebuilds the arena, so the door, the cover and the dock live beside it.
// Nothing here shows a hint, a cause, a skip or a chip. A death is "Again" and a number in neutral ink.
// No network except this origin; no storage except the cover flag (sessionStorage) and a read of the trial key.

const COVER_KEY = 'bughunt.trial.cover';       // this file's early-repaint flag (localised text, theme, direction)
const T1_COVER_KEY = 'bughunt.trial.cover.v1'; // lane T1's restart flag; read only, to know a Begin reload is in flight
const TRIAL_KEY = 'bughunt.trial.v1';
const SVG_NS = 'http://www.w3.org/2000/svg';
const ROOMS = { 6: 5, 7: 7 };
const STAGES = [6, 7];
const LEARNED = { 6: ['buffer', 'shot', 'note', 'notbug', 'stop'], 7: ['shortcut', 'buffer', 'note', 'shot', 'markup', 'notbug', 'stop', 'copy'] };
const BADGES = { 6: ['trial6', 'nodeath6', 'stillhere'], 7: ['trial7', 'sekiro', 'stillhere'] };
const ALL_BADGES = ['trial6', 'trial7', 'nodeath6', 'sekiro', 'stillhere'];
const STEP_ICONS = ['qi-awake', 'qi-timeline', 'qi-key', 'qi-event-request', 'qi-tool-shot', 'qi-stop'];
const COVER_FADE_MS = 120;
const REST_DOCK_MS = 8000;

const num = (n) => Number(n || 0).toLocaleString('en-US');
function fmtTime(ms) { const s = Math.round(Math.max(0, Number(ms) || 0) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

function ensureCss(doc) {
  const href = new URL('./trial.css', import.meta.url).href;
  let link = [...doc.querySelectorAll('link[rel="stylesheet"]')].find((l) => l.href === href);
  if (!link) { link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = href; doc.head.append(link); }
  if (link.sheet) return Promise.resolve();
  return new Promise((res) => { const done = () => res(); link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true }); setTimeout(done, 1500); });
}

export async function mountTrialUI(host) {
  await ensureCss(host.doc || document);
  const doc = host.doc || document;
  const win = host.win || window;
  const t = host.t;
  const $ = (sel, root = doc) => root.querySelector(sel);
  const U = { n: 6, phase: 'closed', trial: null, trialP: null, layer: null, ok: [false, false, false, false, false, false], warn: null, deaths: 0, room: 0, rooms: 5,
    cover: null, coverTimer: 0, dockTimer: 0, stuckTimer: 0, banner: 0, barTimer: 0, paused: false, entries: [], focusBack: null, resumed: false };

  /* ---------- small helpers ---------- */
  function el(tag, attrs, ...kids) {
    const e = doc.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }
  function ico(id, size = 20, cls) {
    const s = doc.createElementNS(SVG_NS, 'svg');
    s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    if (id === 'qi-note' || id === 'qi-timeline') s.setAttribute('class', ((cls || '') + ' mirror').trim());
    const u = doc.createElementNS(SVG_NS, 'use'); u.setAttribute('href', '#' + id); s.append(u);
    return s;
  }
  const setText = (n, v) => { if (n && n.textContent !== v) n.textContent = v; };
  const arrowBtnIco = () => el('span', { class: 'btn-ico', 'aria-hidden': 'true' }, ico('i-arrow', 18));
  const motionOff = () => { try { return !!host.motionOff(); } catch { return false; } };
  const sfx = (id) => { try { host.sfx(id); } catch { /* silent */ } };
  const lang = () => (host.lang ? host.lang() : 'en');
  function readStore() {
    try { const j = JSON.parse(win.localStorage.getItem(TRIAL_KEY) || 'null'); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
  }
  const hasBadge = (b, id) => !!(b && (Array.isArray(b) ? b.includes(id) : b[id]));
  function viewNow() {
    let v = null;
    try { v = U.trial && U.trial.view ? U.trial.view() : null; } catch { v = null; }
    return v && typeof v === 'object' ? v : null;
  }
  function badgesNow() {
    const v = viewNow();
    const st = readStore();
    const set = {};
    for (const src of [st.badges, v && v.badges]) for (const id of ALL_BADGES) if (hasBadge(src, id)) set[id] = true;
    return set;
  }
  function stageData(n) {
    const v = viewNow();
    const st = readStore()[String(n)] || {};
    const live = v && Number(v.n) === n ? v : {};
    return {
      deaths: Number.isFinite(live.deaths) ? live.deaths : (st.deaths || 0),
      bestRoom: Number.isFinite(live.bestRoom) ? live.bestRoom : (st.bestRoom || 0),
      attuned: typeof live.attuned === 'boolean' ? live.attuned : !!st.attuned,
    };
  }
  function unlocked() {
    let s = null;
    try { s = host.snap().stars; } catch { s = null; }
    return !!s && ['l1', 'l2', 'l3', 'l4', 'l5'].every((k) => (s[k] || 0) >= 2);
  }
  const cleared6 = () => !!badgesNow().trial6;
  const roomsOf = (n) => ROOMS[n] || 5;
  function nextStage() { return cleared6() ? 7 : 6; }

  /* ---------- layer DOM (built once, lazily) ---------- */
  function build() {
    if (U.layer) return;
    const card = el('section', { class: 'trial-screen', id: 'trialCard', 'data-trial-screen': 'card', hidden: true });
    const attune = el('section', { class: 'trial-screen', id: 'trialAttune', 'data-trial-screen': 'attune', hidden: true });
    const hud = el('div', { class: 'trial-hud', id: 'trialHud' });
    const pips = el('ol', { class: 'trial-pips', id: 'trialPips' });
    const hostEl = el('div', { class: 'trial-host', id: 'trialHost' });
    const rootEl = el('div', { class: 'trial-root', id: 'trialRoot' });
    const door = el('div', { class: 'trial-door', id: 'trialDoor', hidden: true, 'data-live': '' });
    const coverEl = el('div', { class: 'trial-cover', id: 'trialCover', role: 'status', hidden: true });
    const dock = el('div', { class: 'trial-rest', id: 'trialRest', hidden: true });
    const pauseBtn = el('button', { type: 'button', class: 'icon-btn', id: 'trialPauseBtn' }, ico('i-pause', 22));
    const qaw = el('div', { class: 'qaw-line', id: 'trialQaw', 'data-live': '' },
      el('span', { class: 'qaw-name', id: 'trialQawName' }), el('span', { class: 'qaw-chip', id: 'trialQawChip' }));
    const pasted = el('div', { class: 'micro', id: 'trialPasted', role: 'status', 'aria-live': 'polite', 'data-live': '' });
    const run = el('section', { class: 'trial-screen trial-run', id: 'trialRun', 'data-trial-screen': 'run', hidden: true },
      hud,
      el('div', { class: 'trial-stage' }, el('div', { class: 'tray' }, hostEl)),
      el('div', { class: 'trial-foot' }, pauseBtn, qaw, pasted));
    hostEl.append(rootEl, door, coverEl);
    run.querySelector('.trial-foot').append(dock);
    hud.append(el('span', { class: 'nm', id: 'trialHudName' }), el('span', { class: 'dot', 'aria-hidden': 'true', text: '·' }),
      el('span', { class: 'dt', id: 'trialHudDeaths' }), el('span', { class: 'dot', 'aria-hidden': 'true', text: '·' }), pips);
    const pause = el('div', { class: 'trial-pause', id: 'trialPause', hidden: true },
      el('div', { class: 'box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'trialPauseText' },
        el('p', { id: 'trialPauseText' }),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn btn-lg', id: 'trialResume' }),
          el('button', { type: 'button', class: 'link', id: 'trialLeave' }))));
    const clear = el('div', { class: 'trial-clear', id: 'trialClear', hidden: true },
      el('div', { class: 'tray trial-tray' }, el('div', { class: 'tray-core trial-clear-core', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'trialClearTitle', id: 'trialClearDlg' },
        el('h2', { id: 'trialClearTitle', tabindex: '-1' }),
        el('div', { class: 'trial-facts', id: 'trialClearFacts', 'data-live': '' }),
        el('div', { class: 'trial-slots', id: 'trialClearBadges' }),
        el('p', { class: 'trial-learned', id: 'trialClearLearned' }),
        el('p', { class: 'micro', id: 'trialClearFun' }),
        el('div', { class: 'trial-clear-foot' }, el('button', { type: 'button', class: 'btn btn-lg btn-primary', id: 'trialClearNext', 'data-primary': '' })))));
    const banner = el('div', { class: 'trial-glitch-banner', id: 'trialBanner', hidden: true, role: 'status' });
    const layer = el('div', { class: 'trial', id: 'trial', hidden: true, 'data-phase': 'closed' }, card, attune, run, pause, clear, banner);
    doc.body.append(layer);
    U.layer = layer; U.hostEl = hostEl; U.rootEl = rootEl; U.door = door; U.coverEl = coverEl; U.dock = dock; U.pips = pips; U.banner = banner; U.pasted = pasted;
    doc.addEventListener('keydown', onKey, true); // capture: the game's own bubble-phase keys never see a key while the layer is open
    $('#trialPauseBtn').addEventListener('click', () => doPause());
    $('#trialResume').addEventListener('click', () => doResume());
    $('#trialLeave').addEventListener('click', () => leaveRun());
    $('#trialClearNext').addEventListener('click', onClearNext);
    const refreshQaw = () => renderQaw();
    doc.addEventListener('qaw:state', refreshQaw);
    new win.MutationObserver(refreshQaw).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-qaw-state', 'data-qaw-notes', 'data-qaw-shots'] });
  }

  /* ---------- layer visibility ---------- */
  function setBase(hidden) {
    for (const sel of ['.hud', 'main', '#caption']) { const n = $(sel); if (n) n.hidden = hidden; }
    if (hidden) doc.body.dataset.trial = 'on'; else delete doc.body.dataset.trial;
  }
  function showPhase(phase) {
    build();
    U.phase = phase;
    U.layer.dataset.phase = phase;
    U.layer.hidden = false;
    setBase(true);
    for (const s of U.layer.querySelectorAll('[data-trial-screen]')) s.hidden = s.dataset.trialScreen !== (phase === 'clear' ? 'run' : phase);
    $('#trialClear').hidden = phase !== 'clear';
    if (phase !== 'run' && phase !== 'clear') $('#trialPause').hidden = true;
    render();
  }
  function closeLayer() {
    if (!U.layer) return;
    clearTimeout(U.coverTimer); clearTimeout(U.dockTimer); clearTimeout(U.stuckTimer);
    U.layer.hidden = true; U.phase = 'closed'; U.layer.dataset.phase = 'closed';
    $('#trialPause').hidden = true; $('#trialClear').hidden = true; U.paused = false;
    setBase(false);
    try { win.sessionStorage.removeItem(COVER_KEY); } catch { /* none */ }
    doc.body.removeAttribute('data-trial-cover');
    try { host.exit && host.exit(); } catch { /* none */ }
    refresh();
    const back = U.focusBack && U.focusBack.isConnected ? U.focusBack : U.entries[0] && U.entries[0].btn;
    if (back && !back.closest('[hidden]')) back.focus({ preventScroll: true });
  }

  /* ---------- trial instance (lane T1) ---------- */
  function clock() {
    return { now: () => win.performance.now(), setTimeout: (...a) => win.setTimeout(...a), clearTimeout: (...a) => win.clearTimeout(...a), setInterval: (...a) => win.setInterval(...a), clearInterval: (...a) => win.clearInterval(...a) };
  }
  function ensureTrial() {
    if (U.trialP) return U.trialP;
    U.trialP = (async () => {
      build();
      const m = await import('./trial.js');
      const make = m.createTrial || m.default;
      const tr = await make({ doc, win, t, clock: clock(), storage: win.localStorage, getState: () => host.mod.readQawState(doc), getCounts: () => host.mod.readQawCounts(doc), root: U.rootEl, fetch: win.fetch.bind(win) });
      U.trial = tr;
      const on = (type, fn) => { try { tr.on(type, (p) => { try { fn(p || {}); } catch (err) { console.error('[bughunt] ' + type, err); } }); } catch (err) { console.error('[bughunt] on ' + type, err); } };
      on('trial:door', onDoor); on('trial:attune', onAttune); on('trial:start', onStart); on('trial:room', onRoom); on('trial:tell', onTell);
      on('trial:ok', onOk); on('trial:death', onDeath); on('trial:clear', onClear); on('trial:pasted', onPasted); on('trial:pause', onPause);
      call('setCalm', !!(host.calm && host.calm()));
      return tr;
    })().catch((err) => { console.error('[bughunt] trial', err); U.trialP = null; U.trial = null; return null; });
    return U.trialP;
  }
  const call = (name, ...args) => { try { const f = U.trial && U.trial[name]; return typeof f === 'function' ? f.apply(U.trial, args) : undefined; } catch (err) { console.error('[bughunt] trial.' + name, err); return undefined; } };

  /* ---------- screens ---------- */
  function badgeSlots(host2, ids, have, { names = true } = {}) {
    host2.replaceChildren();
    for (const id of ids) {
      if (have[id]) host2.append(el('span', { class: 'trial-slot', text: t('trial.badge.' + id) }));
      else host2.append(el('span', { class: 'trial-slot', 'data-empty': '1', 'aria-hidden': 'true' }));
    }
    void names;
  }
  function renderCard() {
    const sec = $('#trialCard');
    const n = U.n;
    const d = stageData(n);
    const have = badgesNow();
    sec.replaceChildren();
    const pick = el('div', { class: 'trial-pick', role: 'group', 'aria-label': t('trial.link') });
    for (const s of STAGES) {
      const b = el('button', { type: 'button', 'aria-pressed': String(s === n), text: t('trial.name.' + s), 'data-stage': String(s) });
      if (s === 7 && !cleared6()) b.disabled = true;
      b.addEventListener('click', () => { if (s !== U.n) switchStage(s); });
      pick.append(b);
    }
    const slots = el('div', { class: 'trial-slots' }, el('span', { class: 'lbl', text: t('trial.card.badges') }));
    const slotRow = el('span', { class: 'trial-slots' });
    badgeSlots(slotRow, BADGES[n], have);
    slots.append(slotRow);
    const attuneBtn = el('button', { type: 'button', class: 'btn', id: 'trialAttuneOpen', text: t('trial.attune.open') });
    const later = el('button', { type: 'button', class: 'link', id: 'trialLater', text: t('trial.later') });
    const begin = el('button', { type: 'button', class: 'btn btn-lg btn-primary', id: 'trialBegin', 'data-primary': '' }, el('span', { text: t('trial.begin') }), arrowBtnIco());
    attuneBtn.addEventListener('click', () => { sfx('click'); openAttune(); });
    later.addEventListener('click', () => { sfx('click'); closeLayer(); });
    begin.addEventListener('click', () => { sfx('click'); onBegin(); });
    sec.append(el('div', { class: 'tray trial-tray' }, el('div', { class: 'tray-core trial-core', role: 'group', 'aria-labelledby': 'trialCardTitle' },
      el('div', { class: 'trial-head' }, el('span', { class: 'trial-kicker', text: t('trial.card.kicker', { n }) }), el('span', { class: 'trial-deaths-card', text: t('trial.deaths', { n: num(d.deaths) }) })),
      el('h2', { class: 'trial-title', id: 'trialCardTitle', tabindex: '-1', text: t('trial.name.' + n) }),
      el('ul', { class: 'trial-rules' }, el('li', { text: t('trial.card.rule') }), el('li', { text: t('trial.card.fail') }), el('li', { text: t('trial.card.nohelp') })),
      el('div', { class: 'trial-meta' }, el('span', { text: t('trial.card.best', { n: num(d.bestRoom), m: roomsOf(n) }) }), slots, pick),
      el('div', { class: 'trial-actions' }, attuneBtn, el('span', { class: 'spacer' }), later, begin))));
  }
  function renderAttune() {
    const sec = $('#trialAttune');
    const all = U.ok.every(Boolean);
    const attuned = stageData(U.n).attuned;
    sec.replaceChildren();
    const firstOpen = U.ok.findIndex((x) => !x);
    const steps = el('ul', { class: 'trial-steps', id: 'trialSteps' });
    for (let i = 0; i < 6; i++) {
      const row = el('li', { class: 'trial-step', 'data-step': String(i + 1), 'data-done': U.ok[i] ? '1' : '0', 'data-now': i === firstOpen ? '1' : '0' },
        el('span', { class: 'tick' }, ico('i-check', 16)), ico(STEP_ICONS[i], 22, 'feat'), el('span', { text: t('trial.attune.s' + (i + 1)) }));
      if (i === 1 || i === 3) {
        const kind = i === 1 ? 'glitch' : 'noise';
        const b = el('button', { type: 'button', class: 'btn fire', 'data-fire': kind, text: t('trial.attune.fire.' + kind) });
        b.addEventListener('click', () => { sfx('click'); fire(kind); });
        row.append(b);
      } else row.append(el('span'));
      row.querySelector('.tick').setAttribute('role', 'img');
      if (U.ok[i]) row.querySelector('.tick').setAttribute('aria-label', t('rail.proofDone'));
      steps.append(row);
    }
    const warn = el('div', { class: 'trial-warn', id: 'trialWarn', role: 'status', hidden: !U.warn });
    if (U.warn) {
      warn.append(el('span', { text: t(U.warn === 'autoshot' ? 'trial.attune.autoshot' : 'trial.attune.nokey') }));
      if (U.warn === 'nokey') {
        const allow = el('button', { type: 'button', class: 'btn', id: 'trialAllow', text: t('trial.attune.allow') });
        allow.addEventListener('click', () => { sfx('click'); call('allowNoShortcut'); U.warn = null; renderAttune(); });
        warn.append(allow);
      }
    }
    const back = el('button', { type: 'button', class: 'link', id: 'trialAttuneBack', text: t('trial.attune.back') });
    back.addEventListener('click', () => { sfx('click'); showPhase('card'); focusFirst(); });
    const begin = el('button', { type: 'button', class: 'btn btn-lg btn-primary', id: 'trialAttuneBegin', 'data-primary': '' }, el('span', { text: t('trial.begin') }), arrowBtnIco());
    begin.disabled = !(all || attuned);
    begin.addEventListener('click', () => { sfx('click'); startRun(); });
    sec.append(el('div', { class: 'tray trial-tray' }, el('div', { class: 'tray-core trial-core', role: 'group', 'aria-labelledby': 'trialAttuneTitle' },
      el('div', { class: 'trial-head' }, el('span', { class: 'trial-kicker', text: t('trial.card.kicker', { n: U.n }) }), el('span', { class: 'trial-ready', hidden: !all }, ico('i-check', 18), el('span', { text: t('trial.attune.ready') }))),
      el('h2', { class: 'trial-title', id: 'trialAttuneTitle', tabindex: '-1', text: t('trial.attune.title') }),
      steps, warn,
      el('div', { class: 'trial-actions' }, back, el('span', { class: 'spacer' }), begin))));
  }
  function renderHud() {
    const n = U.n;
    const rooms = U.rooms || roomsOf(n);
    const nm = $('#trialHudName'); const nmT = t('trial.name.' + n); if (nm.textContent !== nmT) nm.textContent = nmT;
    const dt = $('#trialHudDeaths'); const dtT = t('trial.deaths', { n: num(U.deaths) }); if (dt.textContent !== dtT) dt.textContent = dtT;
    // update in place: a room change flips a data-state, it does not rebuild the strip
    if (U.pips.children.length !== rooms) U.pips.replaceChildren(...Array.from({ length: rooms }, () => el('li', { class: 'trial-pip' })));
    Array.from(U.pips.children).forEach((li, i) => {
      const st = i + 1 < U.room ? 'done' : i + 1 === U.room ? 'current' : 'todo';
      if (li.dataset.state !== st) li.dataset.state = st;
      const ti = t('trial.hud.room', { n: i + 1 });
      if (li.title !== ti) li.title = ti;
    });
    U.pips.setAttribute('aria-label', t('trial.hud.rooms') + ' ' + Math.max(U.room, 0) + '/' + rooms);
    $('#trialPauseBtn').setAttribute('aria-label', t('hud.pause'));
    setText($('#trialPauseText'), t('trial.pause.note'));
    setText($('#trialResume'), t('pause.resume'));
    setText($('#trialLeave'), t('trial.leave'));
    renderQaw();
    const door = U.door;
    const doorKey = t('trial.door.closed') + '|' + t('trial.card.rule');
    if (door.dataset.k !== doorKey) { door.dataset.k = doorKey; door.replaceChildren(el('p', { class: 'big', text: t('trial.door.closed') }), el('p', { class: 'micro', text: t('trial.card.rule') })); }
  }
  function renderQaw() {
    if (!U.layer) return;
    const s = doc.documentElement.dataset.qawState || '';
    const known = ['asleep', 'ready', 'recording', 'stopped'].includes(s);
    setText($('#trialQawName'), t('qaw.label'));
    const chip = $('#trialQawChip');
    setText(chip, known ? t('qaw.' + s) : t('qaw.unknown'));
    const ds = known ? s : 'unknown';
    if (chip.dataset.s !== ds) chip.dataset.s = ds;
    const rule = $('#trialCoverRule');
    if (rule && rule.hidden !== (s !== 'recording')) rule.hidden = s !== 'recording';
  }
  function render() {
    if (!U.layer) return;
    if (U.phase === 'card') renderCard();
    else if (U.phase === 'attune') renderAttune();
    if (U.phase === 'run' || U.phase === 'clear') renderHud();
    if (U.phase === 'clear' && U.lastClear) renderClear(U.lastClear);
  }
  function focusFirst() {
    const sel = { card: '#trialBegin', attune: '#trialAttuneBegin', run: '#trialPauseBtn', clear: '#trialClearTitle' }[U.phase];
    const node = sel && $(sel);
    if (node && !node.disabled) node.focus({ preventScroll: true });
    else { const h = $('[data-trial-screen]:not([hidden]) .trial-title'); if (h) h.focus({ preventScroll: true }); }
  }

  /* ---------- flow ---------- */
  async function openCard(n) {
    if (!STAGES.includes(n)) n = nextStage();
    U.n = n; U.rooms = roomsOf(n); U.deaths = stageData(n).deaths; U.room = 0;
    U.focusBack = doc.activeElement;
    try { host.enter && host.enter(); } catch { /* none */ }
    showPhase('card');
    focusFirst();
    sfx('level-start');
    await ensureTrial();
    const r = await call('open', n);
    if (r && r.ok === false) { closeLayer(); return; }
    if (U.phase === 'card') { U.deaths = stageData(n).deaths; render(); }
  }
  async function switchStage(n) {
    U.n = n; U.rooms = roomsOf(n);
    await ensureTrial();
    call('open', n);
    render();
    const b = $('#trialBegin'); if (b) b.focus({ preventScroll: true });
  }
  function onBegin() {
    if (!stageData(U.n).attuned) openAttune(); else startRun();
  }
  async function openAttune() {
    U.ok = [false, false, false, false, false, false]; U.warn = null;
    showPhase('attune');
    focusFirst();
    await ensureTrial();
    call('attune');
    render();
  }
  async function startRun() {
    U.deaths = stageData(U.n).deaths; U.room = 0; U.rooms = roomsOf(U.n);
    hideCover(true);
    showPhase('run');
    U.door.hidden = true;
    await ensureTrial();
    focusFirst();
    call('setCalm', !!(host.calm && host.calm()));
    const r = call('begin');
    if (r && r.ok === false) { if (r.reason === 'attune') openAttune(); else leaveRun(); }
  }
  function leaveRun() {
    call('leave');
    $('#trialPause').hidden = true; U.paused = false;
    hideCover(true);
    showPhase('card'); focusFirst();
    ensureTrial().then(() => { if (U.phase === 'card') render(); });
  }
  function doPause() { if (U.phase !== 'run' || U.paused) return; if (call('pause') === false) return; onPause({ paused: true }); }
  function doResume() { if (!U.paused) return; call('resume'); onPause({ paused: false }); }
  function onClearNext() {
    sfx('click');
    if (U.n === 6) { $('#trialClear').hidden = true; openCard(7); } else closeLayer();
  }

  /* ---------- check-your-tools: the two fire buttons ---------- */
  function fire(kind) {
    const done = call('fire', kind);
    if (done !== true) { try { win.fetch(kind === 'glitch' ? '/api/sync' : '/api/telemetry', { method: 'POST', cache: 'no-store' }).catch(() => {}); } catch { /* none */ } }
    if (kind === 'glitch') {
      const b = U.banner;
      b.textContent = t('trial.shop.offline'); b.hidden = false;
      win.clearTimeout(U.bannerTimer);
      U.bannerTimer = win.setTimeout(() => { b.hidden = true; }, 1500);
    }
  }
  function onAttune(e) {
    const i = Number(e.step) - 1;
    if (e.warn === 'autoshot') U.warn = 'autoshot';
    else if (e.offer === 'nokey') U.warn = 'nokey';
    else if (i >= 0 && i < 6) { U.ok[i] = e.ok !== false; if (e.ok !== false && (i === 3 || i === 2)) U.warn = null; }
    if (U.phase === 'attune') { const had = doc.activeElement && doc.activeElement.dataset ? doc.activeElement.dataset.fire : null; renderAttune(); if (had) { const b = $('[data-fire="' + had + '"]'); if (b) b.focus({ preventScroll: true }); } }
    if (e.ok !== false && i >= 0) sfx('tool-ok');
  }

  /* ---------- run events ---------- */
  function onDoor(e) {
    if (U.phase !== 'run') return;
    U.door.hidden = e.open !== false;
    if (e.open === false) hideCover(false);
    else hideCoverSoon();
  }
  function onStart(e) {
    U.room = 1;
    const v = viewNow();
    if (v && Number.isFinite(v.deaths)) U.deaths = v.deaths;
    if (v && Number.isFinite(v.rooms)) U.rooms = v.rooms;
    if (U.phase === 'card' || U.phase === 'attune') showPhase('run');
    renderHud();
    hideCoverSoon();
    void e;
  }
  function onRoom(e) {
    U.room = Number(e.room) || U.room;
    if (Number.isFinite(e.rooms)) U.rooms = e.rooms;
    renderHud();
    hideCoverSoon();
  }
  function onTell() { sfx('tell-tick'); }
  function onOk() { sfx('tool-ok'); }
  function onPause(e) {
    if (U.phase !== 'run') return;
    U.paused = e.paused !== false;
    $('#trialPause').hidden = !U.paused;
    if (U.paused) $('#trialResume').focus({ preventScroll: true }); else { const b = $('#trialPauseBtn'); if (b) b.focus({ preventScroll: true }); }
  }
  function onPasted(e) {
    const p = U.pasted;
    if (e.ok === false) { p.textContent = t('trial.paste.no'); return; }
    p.textContent = String(e.heading || '').slice(0, 60) + ' · ' + t('finale.lines', { n: num(e.lines) });
  }

  /* ---------- death cover, rest dock ---------- */
  function paintCover(f) {
    const c = U.coverEl;
    clearTimeout(U.coverTimer); clearTimeout(U.stuckTimer);
    const begin = f.kind === 'begin';
    c.replaceChildren(el('p', { class: 'again', text: begin ? t('trial.name.' + f.n) : t('trial.death.again') }), el('p', { class: 'count', text: t('trial.deaths', { n: num(f.deaths) }) }));
    const rooms = roomsOf(f.n);
    const pipRow = el('span', { class: 'trial-pips', 'aria-hidden': 'true' });
    for (let i = 1; i <= rooms; i++) pipRow.append(el('span', { class: 'trial-pip', 'data-state': i < f.room ? 'done' : i === f.room ? 'current' : 'todo' }));
    if (!begin) c.append(el('p', { class: 'best' }, pipRow, el('span', { text: t('trial.card.best', { n: num(Math.max(f.room || 0, f.best || 0)), m: rooms }) })));
    if (f.still) c.append(el('p', { class: 'badge-line' }, ico('i-star', 18), el('span', { text: t('trial.death.badge', { name: t('trial.badge.stillhere') }) })));
    // after a death in a recording session the restart waits for Stop: the rule is repeated here, only while it applies (it is on the card too)
    c.append(el('p', { class: 'micro rule', id: 'trialCoverRule', text: t('trial.card.rule'), hidden: doc.documentElement.dataset.qawState !== 'recording' }));
    c.dataset.out = '0';
    c.hidden = false;
    U.cover = f;
    U.dock.hidden = true;
    doc.body.dataset.trialCoverOff = '1';
    // only a resumed page has a stuck guard (a death waits for Stop on purpose)
    if (f.resumed) U.stuckTimer = win.setTimeout(() => hideCover(false), 6000);
  }
  function hideCoverSoon() {
    if (!U.cover) return;
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => { if (U.cover && U.door.hidden) hideCover(false); }));
  }
  function hideCover(immediate) {
    const c = U.coverEl;
    if (!c || c.hidden) { try { win.sessionStorage.removeItem(COVER_KEY); } catch { /* none */ } doc.body.removeAttribute('data-trial-cover'); return; }
    clearTimeout(U.stuckTimer);
    const f = U.cover;
    U.cover = null;
    try { win.sessionStorage.removeItem(COVER_KEY); } catch { /* none */ }
    doc.body.removeAttribute('data-trial-cover');
    const done = () => { c.hidden = true; c.dataset.out = '0'; };
    if (immediate || motionOff()) done(); else { c.dataset.out = '1'; U.coverTimer = win.setTimeout(done, COVER_FADE_MS); }
    if (f && f.rest && !immediate) showDock();
  }
  function showDock() {
    const d = U.dock;
    clearTimeout(U.dockTimer);
    const btn = el('button', { type: 'button', class: 'btn', id: 'trialRestBtn', text: t('trial.death.restbtn') });
    btn.addEventListener('click', () => { sfx('click'); d.hidden = true; leaveRun(); });
    d.replaceChildren(el('span', { text: t('trial.death.rest') }), btn);
    d.hidden = false;
    U.dockTimer = win.setTimeout(() => { d.hidden = true; }, REST_DOCK_MS);
  }
  function onDeath(e) {
    const deaths = Number.isFinite(e.deaths) ? e.deaths : U.deaths + 1;
    U.deaths = deaths;
    const n = Number(e.n) || U.n;
    const room = Number(e.room) || U.room;
    const st = stageData(n);
    const f = { n, deaths, room, best: Math.max(room, st.bestRoom || 0), rest: !!e.rest, still: e.badge === 'stillhere' };
    U.paused = false; $('#trialPause').hidden = true;
    if (U.phase !== 'run') showPhase('run');
    paintCover(f);
    renderHud();
    sfx('fall');
    try {
      win.sessionStorage.setItem(COVER_KEY, JSON.stringify({ ...f, title: t('trial.death.again'), count: t('trial.deaths', { n: num(deaths) }),
        theme: doc.documentElement.dataset.theme || 'dark', lang: lang(), dir: lang() === 'ar' ? 'rtl' : 'ltr' }));
    } catch { /* the restart still happens, only the early repaint is lost */ }
  }

  /* ---------- clear dialog ---------- */
  function renderClear(e) {
    const n = Number(e.n) || U.n;
    $('#trialClearTitle').textContent = t('trial.clear.' + n);
    const facts = $('#trialClearFacts');
    const parts = [el('b', { text: t('trial.clear.line', { n: num(e.deaths) }) })];
    if (!(host.calm && host.calm())) parts.push(el('span', { text: t('clear.time') + ' ' + fmtTime(e.ms) }));
    parts.push(el('span', { text: t('clear.score') + ' ' + num(e.score) }));
    facts.replaceChildren(...parts);
    const have = {};
    for (const id of ALL_BADGES) if (hasBadge(e.badges, id) || hasBadge(readStore().badges, id)) have[id] = true;
    const row = $('#trialClearBadges');
    row.replaceChildren();
    for (const id of BADGES[n]) if (have[id]) row.append(el('span', { class: 'trial-slot', text: t('trial.badge.' + id) + (id === 'trial7' && e.noShortcut ? ' ' + t('trial.badge.noshortcut') : '') }));
    const names = LEARNED[n].map((k) => { try { const r = host.mod.toolLabel(k, lang()); return r && r.name ? r.name : ''; } catch { return ''; } }).filter(Boolean).join(lang() === 'ar' ? '، ' : ', ');
    $('#trialClearLearned').textContent = t('trial.clear.learned', { tools: names });
    $('#trialClearFun').textContent = t('clear.fun');
    $('#trialClearNext').replaceChildren(el('span', { text: t(n === 6 ? 'trial.next' : 'set.done') }), arrowBtnIco());
  }
  function onClear(e) {
    U.lastClear = e;
    hideCover(true);
    U.phase = 'clear'; U.layer.dataset.phase = 'clear';
    renderClear(e);
    $('#trialClear').hidden = false;
    sfx('trial-clear');
    $('#trialClearTitle').focus({ preventScroll: true });
  }

  /* ---------- keys ---------- */
  function focusables(root) {
    return Array.from(root.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')).filter((n) => !n.disabled && n.offsetParent !== null);
  }
  function onKey(e) {
    if (!U.layer || U.layer.hidden) return;
    e.stopPropagation(); // the game's own keys (M, P, Enter on the title) never reach it from here
    if (e.altKey || e.ctrlKey || e.metaKey) return; // Alt chords belong to QA Wrap
    if (e.key === 'Tab') {
      const scope = !$('#trialClear').hidden ? $('#trialClearDlg') : !$('#trialPause').hidden ? $('#trialPause') : $('[data-trial-screen]:not([hidden])');
      const f = scope ? focusables(scope) : [];
      if (!f.length) return;
      if (e.shiftKey && doc.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && doc.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (U.phase === 'clear') return; // harmless
    if (U.phase === 'run') { if (U.paused) doResume(); else doPause(); return; }
    if (U.phase === 'attune') { showPhase('card'); focusFirst(); return; }
    if (U.phase === 'card') closeLayer();
  }

  /* ---------- entry links on the title and the finale ---------- */
  function ensureEntries() {
    if (U.entries.length) return;
    const spots = [['#screen-title .title-copy', null], ['#screen-finale .result-core', '.actions']];
    for (const [parentSel, afterSel] of spots) {
      const parent = $(parentSel);
      if (!parent) continue;
      const btn = el('button', { type: 'button', class: 'link', 'data-trial-link': '' });
      const badges = el('ul', { class: 'trial-badge-row' });
      const wrap = el('div', { class: 'trial-entry', hidden: true }, btn, badges);
      const anchor = afterSel ? parent.querySelector(afterSel) : null;
      if (anchor) anchor.after(wrap); else parent.append(wrap);
      btn.addEventListener('click', () => { sfx('click'); openCard(nextStage()); });
      U.entries.push({ wrap, btn, badges });
    }
  }
  function refresh() {
    ensureEntries();
    const on = unlocked();
    const have = badgesNow();
    for (const en of U.entries) {
      en.wrap.hidden = !on;
      en.btn.textContent = t('trial.link');
      en.badges.replaceChildren(...ALL_BADGES.filter((id) => have[id]).map((id) => el('li', { class: 'trial-chip' }, ico('i-star', 14), el('span', { text: t('trial.badge.' + id) }))));
    }
    render();
  }
  function reset() {
    try { win.localStorage.removeItem(TRIAL_KEY); } catch { /* none */ }
    try { win.sessionStorage.removeItem(COVER_KEY); } catch { /* none */ }
    try { if (U.trial && U.trial.destroy) U.trial.destroy(); } catch { /* none */ }
    U.trial = null; U.trialP = null;
    if (U.layer) closeLayer(); else refresh();
  }

  /* ---------- resume after a restart (the death reloaded the page) ---------- */
  async function resumeFromCover() {
    let f = null;
    try { f = JSON.parse(win.sessionStorage.getItem(COVER_KEY) || 'null'); } catch { f = null; }
    if (!f) { // a Begin that had to reload first leaves only lane T1's flag
      let g = null;
      try { g = JSON.parse(win.sessionStorage.getItem(T1_COVER_KEY) || 'null'); } catch { g = null; }
      if (g && g.kind === 'begin' && STAGES.includes(Number(g.n))) f = { n: g.n, deaths: g.deaths || 0, room: 0, kind: 'begin' };
    }
    if (!f || !STAGES.includes(Number(f.n))) { try { win.sessionStorage.removeItem(COVER_KEY); } catch { /* none */ } doc.body.removeAttribute('data-trial-cover'); return false; }
    U.n = Number(f.n); U.rooms = roomsOf(U.n); U.deaths = f.deaths || 0; U.room = 0;
    try { host.enter && host.enter(); } catch { /* none */ }
    showPhase('run');
    paintCover({ ...f, resumed: true });
    const tr = await ensureTrial();
    const ok = tr ? await call('restoreRestart') : false;
    if (!ok) { hideCover(true); closeLayer(); return false; }
    call('setCalm', !!(host.calm && host.calm()));
    return true;
  }

  function hashStage() {
    const m = /^#trial([67])$/.exec(win.location.hash || '');
    return m ? Number(m[1]) : 0;
  }

  build();
  ensureEntries();
  refresh();
  const api = { refresh, reset, open: openCard, isOpen: () => U.phase !== 'closed' };
  (async () => {
    if (await resumeFromCover()) return;
    const h = hashStage();
    if (h && unlocked()) openCard(h);
  })();
  return api;
}
