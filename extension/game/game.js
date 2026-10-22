// Bug Hunt shell (lane A): screens, router, HUD, settings, pause, captions, theme, language, VFX.
// Spec: work/sdlc/design/DESIGN-bug-hunt.md. Logic lives in engine.js (lane B), sound in audio/* (lane C).
// Everything here is coded against the contracts in section 13 of the spec; the exact calls are listed in
// work/sdlc/build/notes-game/A.md. No network except this origin, no storage except through the engine.

const LEVELS = {
  1: { type: 'failed-request', target: '#save', voice: 'v02', chip: null },
  2: { type: 'console', target: '#apply', voice: 'v03', chip: 'notbug' },
  3: { type: 'dead-button', target: '#next', voice: 'v04', chip: 'note' },
  4: { type: 'layout', target: '#ref', voice: 'v05', chip: 'shot' },
  5: { type: 'slow-call', target: '#pay', voice: 'v06', chip: null },
};
const SVG_NS = 'http://www.w3.org/2000/svg';
const CONFETTI_COLORS = ['#F1BE5C', '#F1EFE9', '#7ED08A'];

// Hard trials (lane T2, trial-ui.js, loaded lazily): a death reloads the page, so the neutral cover is repainted before anything else loads.
try {
  const raw = sessionStorage.getItem('bughunt.trial.cover');
  if (raw) {
    const f = JSON.parse(raw);
    const root = document.documentElement;
    if (f.theme) root.dataset.theme = f.theme;
    if (f.lang) { root.lang = f.lang; root.dir = f.dir || 'ltr'; }
    document.body.dataset.trialCover = '1';
    document.body.dataset.trialCoverTitle = f.title || '';
    document.body.dataset.trialCoverCount = f.count || '';
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./trial.css', import.meta.url).href; document.head.append(link);
  }
} catch { /* no early cover */ }

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const S = {
  lang: 'en', dict: {}, dictEn: {}, eng: null, manifest: new Map(),
  audio: { unlock: null, setMuted: null, setVolume: null, setVoice: null, suspend: null, resume: null, sfxPlay: null, voicePlay: null, voiceStop: null, captionFor: null },
  unlocked: false, sound: true, screen: 'title', overlay: null, level: 0, caught: false, proved: false, hiddenFound: false,
  paused: false, chipsDone: new Set(), mod: null, caption: null, capTimer: null, voiceEnd: 0, pt: null, snap: null, lastClear: null, lastFinale: null,
  firstCatch: false, firstProve: false, chipsDone: new Set(), mod: null, l3Voiced: false, hintVoiced: new Set(), pausedAnims: [], returnFocus: null,
  prefs: { lang: 'en', theme: 'auto', voice: true, volume: 60, calm: false }, copiedTimer: null, sayTimer: null,
};

/* ---------- small helpers ---------- */
function t(key, params) {
  let s = S.dict[key] ?? S.dictEn[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
  return s;
}
const num = (n) => Number(n || 0).toLocaleString('en-US');
function fmtTime(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '-';
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
function ico(id, size = 20) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
  if (id === 'qi-note' || id === 'qi-timeline') s.setAttribute('class', 'mirror');
  const u = document.createElementNS(SVG_NS, 'use'); u.setAttribute('href', '#' + id); s.append(u);
  return s;
}
function E(name, ...args) {
  try { const f = S.eng && S.eng[name]; return typeof f === 'function' ? f.apply(S.eng, args) : undefined; }
  catch (err) { console.error('[bughunt] engine.' + name, err); return undefined; }
}
const P = () => ({ ...S.prefs, ...(E('getPrefs') || {}), sound: S.sound });
const motionOff = () => P().calm === true || matchMedia('(prefers-reduced-motion: reduce)').matches;
// The extension's own feature names; "{what}" (the recorder's caught-item slot) shows the level's bug name.
const fix = (s) => String(s == null ? '' : s).replace('{what}', t('bug.console.name'));
function fixFeature(f) { return f ? { ...f, names: fix(f.names), primary: { ...f.primary, name: fix(f.primary.name) } } : f; }
function feat(n) { try { return fixFeature((S.mod && S.mod.featureFor && S.mod.featureFor(n, S.lang)) || null); } catch { return null; } }
function toolInfo(row) {
  if (row && row.name) return { icon: 'qi-' + (row.icon || 'tag-bug'), name: fix(row.name) };
  const id = row && (row.tool || row);
  let r = null;
  try { r = S.mod && S.mod.toolLabel ? S.mod.toolLabel(id, S.lang) : null; } catch { r = null; }
  if (r && r.name) return { icon: 'qi-' + r.icon, name: fix(r.name) };
  return { icon: 'qi-tag-bug', name: t((row && row.key) || ('score.tool.' + id)) };
}
function snap() { const v = E('view'); if (v && typeof v === 'object') S.snap = v; return S.snap || {}; }
function savePrefs(patch) { Object.assign(S.prefs, patch); for (const [k, v] of Object.entries(patch)) E('setPref', k, v); }
// A small seeded generator: nothing here depends on a system random source (spec section 10).
function lcg(seed) { let x = seed >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); }

/* ---------- pausable timers ---------- */
const timers = new Set();
function after(ms, fn) {
  const tm = { fn, left: ms, at: performance.now(), id: 0 };
  tm.id = setTimeout(() => { timers.delete(tm); fn(); }, ms);
  timers.add(tm);
  return tm;
}
function cancel(tm) { if (!tm) return; clearTimeout(tm.id); timers.delete(tm); }
function pauseTimers() { const now = performance.now(); for (const tm of timers) { clearTimeout(tm.id); tm.left = Math.max(0, tm.left - (now - tm.at)); } }
function resumeTimers() { const now = performance.now(); for (const tm of timers) { tm.at = now; tm.id = setTimeout(() => { timers.delete(tm); tm.fn(); }, tm.left); } }

/* ---------- i18n ---------- */
async function loadDict(lang) {
  const r = await fetch(new URL('./strings/' + lang + '.json', import.meta.url));
  if (!r.ok) throw new Error('strings ' + lang + ' ' + r.status);
  return r.json();
}
function applyStatic() {
  for (const n of $$('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of $$('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
  document.title = t('app.titleTag');
  for (const b of $$('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang));
}
async function setLang(lang, { persist = true } = {}) {
  if (lang !== 'en' && lang !== 'ar') lang = 'en';
  S.dict = lang === 'en' ? S.dictEn : await loadDict(lang);
  S.lang = lang;
  const root = document.documentElement;
  root.lang = lang; root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  if (persist) savePrefs({ lang });
  try { S.audio.voiceSetLang && S.audio.voiceSetLang(lang); } catch { /* silent */ }
  applyStatic();
  renderAll();
  renderCaption();
}

/* ---------- theme / calm ---------- */
function applyTheme() {
  const pref = P().theme || 'auto';
  const dark = pref === 'dark' || (pref === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  for (const b of $$('[data-theme-set]')) b.setAttribute('aria-pressed', String(b.dataset.themeSet === pref));
}
function applyCalm() {
  const calm = P().calm === true;
  if (calm) document.documentElement.dataset.calm = '1'; else delete document.documentElement.dataset.calm;
  if (calm) for (const a of document.getAnimations()) a.finish();
}
function setPrefs(patch) { savePrefs(patch); snap(); }

/* ---------- audio adapter (lane C API; every call is optional) ---------- */
function pick(mod, name) {
  if (!mod) return null;
  for (const holder of [mod, mod.default, mod.audio, mod.bus]) if (holder && typeof holder[name] === 'function') return holder[name].bind(holder);
  return null;
}
async function loadAudio() {
  const [busRes, sfxRes, voiceRes] = await Promise.allSettled([import('./audio/bus.js'), import('./audio/sfx.js'), import('./audio/voice.js')]);
  const m = (r) => (r.status === 'fulfilled' ? r.value : null);
  const mods = [m(busRes), m(sfxRes), m(voiceRes)];
  const find = (name) => { for (const mod of mods) { const f = pick(mod, name); if (f) return f; } return null; };
  const a = S.audio;
  a.unlock = find('unlock'); a.setMuted = find('setMuted'); a.setVolume = find('setVolume'); a.setVoice = find('setVoice');
  a.suspend = find('suspend'); a.resume = find('resume');
  const sm = m(sfxRes);
  a.sfxPlay = pick(sm, 'play') || (sm && sm.sfx && pick({ x: sm.sfx }, 'play')) || (sm && sm.sfx && typeof sm.sfx.play === 'function' ? sm.sfx.play.bind(sm.sfx) : null);
  const vm = m(voiceRes);
  a.voicePlay = pick(vm, 'play') || (vm && vm.voice && typeof vm.voice.play === 'function' ? vm.voice.play.bind(vm.voice) : null);
  a.voiceStop = pick(vm, 'stop') || (vm && vm.voice && typeof vm.voice.stop === 'function' ? vm.voice.stop.bind(vm.voice) : null);
  const voice = vm && (vm.voice || vm.default || null);
  a.voiceSetLang = voice && typeof voice.setLang === 'function' ? voice.setLang.bind(voice) : null;
  // The voice module reads the manifest and decides which lines have a file; without load() the game stays caption-only.
  try { if (voice && typeof voice.load === 'function') await voice.load(); } catch { /* caption-only */ }
  try { if (a.voiceSetLang) a.voiceSetLang(S.lang); } catch { /* silent */ }
  a.captionFor = pick(vm, 'captionFor') || (vm && vm.voice && typeof vm.voice.captionFor === 'function' ? vm.voice.captionFor.bind(vm.voice) : null);
}
async function loadManifest() {
  try {
    const r = await fetch(new URL('./audio/narration-manifest.json', import.meta.url));
    if (!r.ok) return;
    const j = await r.json();
    for (const l of j.lines || []) S.manifest.set(l.id, { en: l.text, ar: l.caption_ar, seconds: l.seconds });
  } catch { /* captions fall back to captionFor */ }
}
const soundOn = () => S.sound === true;
function sfx(id) {
  if (!S.unlocked || !soundOn() || S.paused) return;
  try { const r = S.audio.sfxPlay && S.audio.sfxPlay(id); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* silent */ }
}
function setSound(on) {
  S.sound = on;
  savePrefs({ sound: on }); // a player's own mute is remembered; a fresh player starts with sound on
  try { S.audio.setMuted && S.audio.setMuted(!on); } catch { /* silent */ }
  if (!on) stopVoice();
  renderSound(); renderSettings();
}
function setVoiceOn(on) {
  savePrefs({ voice: on });
  try { S.audio.setVoice && S.audio.setVoice(on); } catch { /* silent */ }
  if (!on) { try { S.audio.voiceStop && S.audio.voiceStop(); } catch { /* silent */ } }
  renderSettings();
}

/* ---------- captions + voice ---------- */
function captionText(id) {
  const m = S.manifest.get(id);
  if (m) return S.lang === 'ar' ? m.ar : m.en;
  try { return (S.audio.captionFor && S.audio.captionFor(id, S.lang)) || ''; } catch { return ''; }
}
function renderCaption() {
  const c = $('#captionText');
  const txt = S.caption ? captionText(S.caption.id) : '';
  c.textContent = txt;
  c.dataset.on = txt ? '1' : '0';
}
function showCaption(id, seconds) {
  S.caption = { id };
  renderCaption();
  cancel(S.capTimer);
  S.capTimer = after(Math.max(2, seconds + 1.2) * 1000, () => { S.caption = null; renderCaption(); });
}
// Voice lines are English; the caption follows the chosen language. A new line cuts the old one, except that a line
// asked to follow queues behind the one still speaking (v01 then v02 on the first Start).
function say(id, { follow = false } = {}) {
  const m = S.manifest.get(id);
  const est = (m && m.seconds) || 4;
  const run = () => {
    let secs = est;
    showCaption(id, secs);
    S.voiceEnd = performance.now() + est * 1000;
    if (S.unlocked && soundOn() && P().voice !== false && S.audio.voicePlay) {
      try {
        Promise.resolve(S.audio.voicePlay(id)).then((r) => {
          if (r && typeof r.seconds === 'number' && !r.missing) {
            secs = r.seconds;
            S.voiceEnd = performance.now() + secs * 1000;
            if (S.caption && S.caption.id === id) showCaption(id, secs);
          }
        }).catch(() => {});
      } catch { /* caption only */ }
    }
  };
  cancel(S.sayTimer);
  const wait = follow ? Math.max(0, S.voiceEnd - performance.now()) + 500 : 0;
  if (wait > 0) S.sayTimer = after(wait, run); else run();
}
function stopVoice() { cancel(S.sayTimer); try { S.audio.voiceStop && S.audio.voiceStop(); } catch { /* silent */ } S.voiceEnd = 0; }

/* ---------- primary button owner (one data-primary and one .btn-primary per screen) ---------- */
function claimPrimary(owner) {
  for (const b of $$('[data-prim-cand]')) {
    const on = b === owner;
    b.classList.toggle('btn-primary', on);
    if (on) b.setAttribute('data-primary', ''); else b.removeAttribute('data-primary');
  }
}
function currentPrimary() {
  if (S.paused) return $('#btnResume');
  if (S.overlay === 'settings') return $('#btnSetDone');
  if (S.overlay === 'clear') return $('#btnNext');
  return { title: $('#btnStart'), card: $('#btnGo'), play: $('#btnPrimary'), finale: $('#btnCopyScore') }[S.screen] || null;
}
const refreshPrimary = () => claimPrimary(currentPrimary());

/* ---------- screens ---------- */
function showScreen(name, { focus = true } = {}) {
  S.screen = name;
  document.body.dataset.screen = name;
  for (const s of $$('.screen')) s.hidden = s.dataset.screenName !== name;
  refreshPrimary();
  renderHud();
  if (!focus) return;
  const target = { title: '#btnStart', card: '#btnGo', play: '#app', finale: '#finaleTitle' }[name];
  const node = target && $(target);
  if (node) { if (name === 'play') node.tabIndex = -1; node.focus({ preventScroll: true }); }
}

function renderAll() {
  renderHud(); renderSound(); renderTitle(); renderQaw(); renderSettings();
  if (S.screen === 'card') renderCard(S.level);
  if (S.screen === 'play') renderRail();
  if (S.overlay === 'clear' && S.lastClear) renderClear(S.lastClear, { replay: false });
  if (S.screen === 'finale' && S.lastFinale) renderFinale(S.lastFinale);
  if (S.trials) S.trials.refresh();
  const fatal = $('#fatalTxt'); if (fatal && !$('#fatal').hidden) fatal.textContent = t(fatal.dataset.key || 'err.engine');
}

/* ---------- HUD ---------- */
let scoreShown = 0, scoreRaf = 0;
function setScore(target, animate = true) {
  cancelAnimationFrame(scoreRaf);
  const out = $('#score');
  const from = scoreShown;
  scoreShown = target;
  if (!animate || motionOff() || from === target) { out.textContent = num(target); return; }
  const t0 = performance.now(), dur = 400;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    out.textContent = num(Math.round(from + (target - from) * e));
    if (k < 1) scoreRaf = requestAnimationFrame(step); else out.textContent = num(target);
  };
  scoreRaf = requestAnimationFrame(step);
}
function renderHud() {
  const n = S.level;
  const done = snap().stars || {};
  $$('.pip').forEach((p, i) => {
    const lv = i + 1;
    p.dataset.state = (S.screen === 'finale' || (done['l' + lv] > 0 && lv !== n) || lv < n) ? 'done' : (lv === n && S.screen !== 'title' ? 'current' : 'todo');
  });
  $('#hudLevel').textContent = n >= 1 && S.screen !== 'title' && S.screen !== 'finale' ? t('hud.level', { n }) : '';
  const total = (snap().score ?? scoreShown);
  if (total !== scoreShown) setScore(total, false);
  else $('#score').textContent = num(scoreShown);
}
function renderSound() {
  const on = soundOn();
  $('#soundUse').setAttribute('href', on ? '#i-speaker' : '#i-speaker-off');
  const b = $('#btnSound');
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', t(on ? 'hud.soundOn' : 'hud.soundOff'));
}
function setChain(x, { up = false } = {}) {
  const c = $('#chainPill');
  const on = x >= 2;
  c.dataset.on = on ? '1' : '0';
  if (on) {
    $('#chainTxt').textContent = t('hud.chain', { x });
    const g = $('.chain-glow', c);
    if (up && !motionOff()) g.animate([{ opacity: 0 }, { opacity: Math.min(0.5, 0.2 + 0.1 * x) }, { opacity: 0 }], { duration: 600, easing: 'cubic-bezier(.32,.72,0,1)' });
  }
  // A reset is quiet by design: the pill fades through its CSS transition; no sound, no motion.
}

/* ---------- QA Wrap state line (read-only signal from the extension) ---------- */
function readQaw() {
  const d = document.documentElement.dataset;
  return { state: d.qawState || '', notes: d.qawNotes, shots: d.qawShots };
}
function renderQaw() {
  const q = readQaw();
  const chip = $('#qawChip');
  const known = ['asleep', 'ready', 'recording', 'stopped'].includes(q.state);
  chip.textContent = known ? t('qaw.' + q.state) : t('qaw.unknown');
  chip.dataset.s = known ? q.state : 'unknown';
  $('#qawNotes').textContent = q.notes != null && q.notes !== '' ? t('qaw.notes', { n: num(q.notes) }) : '';
  $('#qawShots').textContent = q.shots != null && q.shots !== '' ? t('qaw.shots', { n: num(q.shots) }) : '';
}

/* ---------- title ---------- */
function stickerNode(i, snapNow) {
  const lv = i + 1, type = LEVELS[lv].type;
  const have = !!(snapNow.stickers && snapNow.stickers[type]);
  const gold = have && !!(snapNow.bonus && snapNow.bonus['l' + lv]);
  const s = el('li', { class: 'sticker', 'data-have': have ? '1' : '0', 'data-empty': have ? '0' : '1', 'data-gold': gold ? '1' : '0', title: t('bug.' + type + '.name'), role: 'img', 'aria-label': t('bug.' + type + '.name') + (have ? '' : '') });
  if (have) s.append(ico('i-bug', 22));
  return s;
}
function renderTitle() {
  const s = snap();
  const row = $('#stickerRow'); row.replaceChildren(...[0, 1, 2, 3, 4].map((i) => stickerNode(i, s)));
  const best = s.best && s.best.run;
  $('#bestLine').textContent = best ? t('title.best', { time: fmtTime(best) }) + ' (' + t('title.bestReset') + ')' : t('title.bestNone');
  const art = $('#titleArt');
  art.replaceChildren(
    el('div', { class: 'preview-window' },
      el('div', { class: 'shop-window' },
        el('div', { class: 'shop-chrome', text: t('shop.l1.title') }),
        el('div', { class: 'shop-row' }, el('span', { class: 'shop-label', text: t('shop.l1.nameTypo') }), el('div', { class: 'shop-field', text: t('shop.l1.nameValue') })),
        el('div', { class: 'shop-row' }, el('span', { class: 'shop-label', text: t('shop.l1.phone') }), el('div', { class: 'shop-field', text: t('shop.l1.phoneValue') })),
        el('div', { class: 'shop-row' }, el('span', { class: 'shop-btn', text: t('shop.l1.save') }), el('span', { class: 'shop-btn is-quiet', text: t('shop.l1.cancel') }), el('span', { class: 'shop-state', text: t('shop.l1.saved') }))),
      el('span', { class: 'preview-bug' }, ico('i-bug', 22))));
  const img = $('#titleMark');
  if (motionOff()) img.setAttribute('src', new URL('../brand/mark.svg', import.meta.url).href); else if (!img.getAttribute('src').includes('motion')) img.setAttribute('src', new URL('../brand/mark-motion.svg', import.meta.url).href);
}

/* ---------- card ---------- */
function renderCard(n) {
  if (!LEVELS[n]) return;
  $('#cardLevel').textContent = t('card.level', { n });
  const f = feat(n);
  const pill = $('#cardFeature');
  pill.replaceChildren();
  if (f) {
    pill.append(ico('qi-' + f.primary.icon, 24));
    for (const w of f.with) pill.append(ico('qi-' + w.icon, 24));
    pill.append(el('span', { text: f.names }));
  }
  pill.hidden = !f;
  $('#cardGoal').textContent = t('card.' + n + '.goal');
  $('#cardLook').textContent = t('card.' + n + '.look');
}

/* ---------- play rail ---------- */
function renderRail() {
  const n = S.level, L = LEVELS[n];
  if (!L) return;
  $('#railGoal').textContent = t('rail.goal.' + n);
  const bugUse = $('#flagBug use');
  bugUse.setAttribute('href', S.caught ? '#i-check' : '#i-bug');
  $('#flagBug').dataset.done = S.caught ? '1' : '0';
  $('#flagBugTxt').textContent = t(S.caught ? 'rail.bugCaught' : 'rail.bug');
  $('#flagHidden').dataset.done = S.hiddenFound ? '1' : '0';
  $('#flagHiddenTxt').textContent = t(S.hiddenFound ? 'rail.hiddenFound' : 'rail.hidden');
  const proof = $('#railProof');
  const f = (S.learned && S.learned.n === n ? S.learned : null) || feat(n);
  const sv = snap();
  const tick = () => el('span', { class: 'tick' }, ico('i-check', 16));
  const status = () => el('div', { class: 'proof-row', 'data-done': S.proved ? '1' : '0', 'data-off': S.caught ? '0' : '1' }, tick(), el('span', { text: t('rail.proof.' + n) }));
  let row;
  // A self-report chip only while the engine says it can be claimed (it is hidden when the extension shares the count itself).
  if (L.chip && sv.chipAvailable === true && !S.proved) {
    row = el('button', { type: 'button', class: 'proof-row', id: 'chipProve', 'data-kind': L.chip, 'data-off': '0', 'data-done': '0' }, tick(), el('span', { text: (f && f.learnChip) || t('rail.proof.' + n) }));
  } else row = status();
  const kids = [row];
  const chips = Array.isArray(sv.chips) ? sv.chips : [];
  for (const x of (f ? f.extras : [])) {
    const st = chips.find((c) => c.id === x.id);
    const done = S.chipsDone.has(x.id) || !!(st && st.claimed);
    if (!done && !(st && st.available && !st.auto)) continue;
    const b = el('button', { type: 'button', class: 'proof-row extra', 'data-chip': x.id, 'data-done': done ? '1' : '0', 'data-off': '0' }, tick(), ico('qi-' + x.icon, 18), el('span', { text: x.chip }));
    if (done) b.disabled = true;
    kids.push(b);
  }
  proof.replaceChildren(...kids);
  const needs = sv.needs;
  $('#railNeeds').textContent = needs && !S.proved ? t('needs.' + needs) : ''; // one short line of what still earns points; it never blocks Finish
  const prim = $('#btnPrimary');
  $('#btnPrimaryTxt').textContent = t(S.caught ? 'rail.finish' : 'rail.hint');
  prim.disabled = false; // Finish level always advances once the bug is caught (Nader, 15 Oct 2026)
}
function setNote(node) { $('#slotNote').replaceChildren(...(node ? [node] : [])); }
function showHint(n, key) { setNote(el('span', { class: 'hint-line', text: t(key || 'hint.' + n) })); }
function showNudge(key) { if (key === 'rail.nudgeAsleep' && readQaw().state === 'stopped') key = 'rail.stoppedNote'; setNote(el('span', { class: 'nudge-line', text: t(S.dict[key] != null || S.dictEn[key] != null ? key : 'nudge.generic') })); }
function quietNode(points, reasonKey) {
  const key = (S.dict[reasonKey] != null || S.dictEn[reasonKey] != null) ? reasonKey : 'score.wrong.generic';
  return el('span', { class: 'quiet' }, el('b', { dir: 'ltr', text: '−' + num(Math.abs(points)) }), ' · ' + t(key));
}
function showQuiet(points, reasonKey) {
  const node = quietNode(points, reasonKey);
  if (S.screen === 'finale') { $('#pasteResult').append(node); return; }
  setNote(node);
}
function showBugCard({ type, gold }) {
  const card = el('div', { class: 'bugcard', 'data-gold': gold ? '1' : '0' },
    el('span', { class: 'bug-ico' }, ico(gold ? 'i-star' : 'i-bug', 22)),
    el('div', {}, el('div', { class: 'bug-name' }, el('span', { class: 'bug-tag', text: gold ? t('toast.bonus') : t('toast.caught') }), ' · ' + t('bug.' + type + '.name')),
      el('div', { class: 'bug-text', text: t('bug.' + type + '.text') })));
  $('#slotBug').replaceChildren(card);
  if (!motionOff()) card.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.32,.72,0,1)' });
}

/* ---------- VFX ---------- */
function layer() { return $('#fxLayer'); }
function anchor() {
  if (S.pt) return S.pt;
  const r = $('#app').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function ghost(text, pt) {
  const g = el('div', { class: 'fx-ghost', dir: 'ltr', text });
  g.style.left = Math.round(pt.x - 24) + 'px'; g.style.top = Math.round(pt.y - 40) + 'px';
  layer().append(g);
  const keys = motionOff() ? [{ opacity: 1 }, { opacity: 1 }, { opacity: 0 }] : [{ opacity: 0, transform: 'translateY(0)' }, { opacity: 1, transform: 'translateY(-10px)', offset: .25 }, { opacity: 0, transform: 'translateY(-24px)' }];
  g.animate(keys, { duration: 900, easing: 'cubic-bezier(.32,.72,0,1)' }).onfinish = () => g.remove();
}
function vfxCatch(pt, { gold = false } = {}) {
  if (motionOff()) {
    const b = el('div', { class: 'fx-badge', text: t(gold ? 'toast.bonus' : 'toast.caught') });
    b.style.left = Math.round(pt.x - 40) + 'px'; b.style.top = Math.round(pt.y - 56) + 'px';
    layer().append(b);
    b.animate([{ opacity: 1 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { duration: 1600 }).onfinish = () => b.remove();
    return;
  }
  const ring = el('div', { class: 'fx-ring' });
  const r0 = 28;
  Object.assign(ring.style, { left: Math.round(pt.x - r0) + 'px', top: Math.round(pt.y - r0) + 'px', width: r0 * 2 + 'px', height: r0 * 2 + 'px' });
  layer().append(ring);
  ring.animate([{ opacity: .9, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.7)' }], { duration: 360, easing: 'cubic-bezier(.32,.72,0,1)' }).onfinish = () => ring.remove();
  const rnd = lcg(Math.round(pt.x * 31 + pt.y * 17));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rnd() * 0.4, d = 44 + rnd() * 16;
    const sp = el('div', { class: 'fx-spark' });
    sp.style.left = Math.round(pt.x - 3) + 'px'; sp.style.top = Math.round(pt.y - 3) + 'px';
    layer().append(sp);
    sp.animate([{ opacity: 1, transform: 'translate(0,0) scale(1)' }, { opacity: 0, transform: 'translate(' + Math.round(Math.cos(a) * d) + 'px,' + Math.round(Math.sin(a) * d) + 'px) scale(.4)' }], { duration: 420, easing: 'cubic-bezier(.32,.72,0,1)' }).onfinish = () => sp.remove();
  }
}
function ringTarget(sel) {
  const node = sel && $(sel, $('#app'));
  if (!node) return;
  const r = node.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return;
  const ring = el('div', { class: 'fx-ring cue' });
  Object.assign(ring.style, { left: Math.round(r.left - 6) + 'px', top: Math.round(r.top - 6) + 'px', width: Math.round(r.width + 12) + 'px', height: Math.round(r.height + 12) + 'px' });
  layer().append(ring);
  const done = () => ring.remove();
  if (motionOff()) { ring.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 2000 }).onfinish = done; return; }
  ring.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'scale(1)', offset: .5 }, { opacity: 0, transform: 'scale(1.05)' }], { duration: 1000, iterations: 2, easing: 'cubic-bezier(.32,.72,0,1)' }).onfinish = done;
}
function pulseHintButton() {
  if (motionOff()) return;
  $('#btnPrimary').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: .5 }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(.32,.72,0,1)' });
}
function starsPop(count) {
  const stars = $$('#clearStars .star');
  stars.forEach((s, i) => {
    const on = i < count;
    s.dataset.on = on ? '1' : '0';
    if (!on) return;
    if (motionOff()) { s.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'backwards' }); return; }
    s.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.18)', opacity: 1, offset: .65 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420, delay: i * 120, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'backwards' });
    after(i * 120, () => sfx('star'));
  });
}
let confettiRaf = 0;
function confetti() {
  if (motionOff()) return;
  $('.fx-confetti')?.remove();
  const cv = el('canvas', { class: 'fx-confetti', 'aria-hidden': 'true' });
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  document.body.append(cv);
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const rnd = lcg(20261012);
  const ps = Array.from({ length: 80 }, (_, i) => ({ x: W / 2 + (rnd() - .5) * W * .5, y: H * .35, vx: (rnd() - .5) * 9, vy: -rnd() * 9 - 2, w: 5 + rnd() * 5, h: 4 + rnd() * 5, r: rnd() * 6, vr: (rnd() - .5) * .4, c: CONFETTI_COLORS[i % 3] }));
  const t0 = performance.now(), dur = 1200;
  cancelAnimationFrame(confettiRaf);
  const frame = (now) => {
    const k = (now - t0) / dur;
    ctx.clearRect(0, 0, W, H);
    if (k >= 1) { cv.remove(); return; }
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.r += p.vr;
      ctx.save(); ctx.globalAlpha = 1 - k * k; ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    confettiRaf = requestAnimationFrame(frame);
  };
  confettiRaf = requestAnimationFrame(frame);
}

/* ---------- tool board (rows from the engine: { tool, correct, wrong, points }) ---------- */
function buildBoard(host, rows, { all }) {
  const shown = (rows || []).filter((r) => all || ((r.correct || 0) + (r.wrong || 0)) > 0);
  host.replaceChildren();
  if (!shown.length) { host.append(el('p', { class: 'board-empty', text: t('board.empty') })); return; }
  host.append(el('div', { class: 'board-row board-head' }, el('span'), el('span', { text: t('board.tool') }), el('span', { text: t('board.right') }), el('span', { text: t('board.wrong') }), el('span', { text: t('board.points') })));
  for (const r of shown) {
    const info = toolInfo(r);
    const pts = r.points || 0;
    host.append(el('div', { class: 'board-row' }, ico(info.icon, 20), el('span', { text: info.name }), el('span', { text: num(r.correct) }), el('span', { text: num(r.wrong) }),
      el('span', { class: pts < 0 ? 'neg' : 'pos', dir: 'ltr', text: (pts < 0 ? '−' : '+') + num(Math.abs(pts)) })));
  }
}

/* ---------- clear dialog ---------- */
function renderClear(p, { replay = true } = {}) {
  const n = p.n ?? S.level;
  const s = snap();
  const stars = p.stars ?? 0;
  const skipped = p.skipped ?? (p.caught === false);
  const caught = p.caught ?? !skipped;
  const proved = p.proved ?? stars >= 2;
  const hidden = p.bonus ?? !!(s.bonus && s.bonus['l' + n]);
  $('#clearTitle').textContent = t('clear.title', { n });
  const row = $('#clearStars');
  row.setAttribute('aria-label', t('clear.stars', { n: stars }));
  row.replaceChildren(...[0, 1, 2].map((i) => el('span', { class: 'star', 'data-on': i < stars ? '1' : '0' }, ico('i-star', 40))));
  $('#clCaught').textContent = t(caught ? 'clear.yes' : 'clear.no');
  $('#clProved').textContent = t(proved ? 'clear.yes' : 'clear.no');
  $('#clHidden').textContent = t(hidden ? 'clear.yes' : 'clear.no');
  $('#clTime').textContent = fmtTime(p.ms);
  $('#clBest').textContent = fmtTime(p.bestMs);
  $('#clScore').textContent = num(p.score ?? s.score);
  const calm = P().calm === true;
  $('#clTime').parentElement.hidden = calm; $('#clBest').parentElement.hidden = calm;
  const sticker = $('#clSticker');
  sticker.replaceChildren();
  if (skipped) sticker.append(el('span', { text: t('clear.tryLater') }));
  else {
    const type = p.sticker || LEVELS[n]?.type;
    if (type) sticker.append(el('span', { class: 'sticker', 'data-have': '1', 'data-gold': hidden ? '1' : '0' }, ico('i-bug', 22)), el('span', { text: t('clear.sticker') + ': ' + t('bug.' + type + '.name') }));
  }
  const learned = $('#clLearned');
  const lf = p.learned ? fixFeature(p.learned) : feat(n);
  if (skipped || !lf) learned.textContent = '';
  else if (proved) learned.textContent = t('clear.learned', { feature: lf.names, learn: lf.learn });
  else learned.textContent = t('clear.tryTool', { feature: lf.names });
  buildBoard($('#clBoard'), p.board || E('scoreboard', 'level', n) || [], { all: false });
  $('#clNote').textContent = t('clear.fun');
  $('#btnNextTxt').textContent = t(n >= 5 ? 'clear.toReport' : 'clear.next');
  if (replay) starsPop(stars);
}

/* ---------- finale ---------- */
function renderFinale(p) {
  const s = snap();
  const stars = p.stars ?? Object.values(s.stars || {}).reduce((a, b) => a + (b || 0), 0);
  $('#finScore').textContent = num(p.score ?? s.score);
  $('#finStars').textContent = t('finale.stars', { n: stars });
  const bugs = p.bugs ?? Object.values(s.results || {}).filter((r) => r.caught).length;
  $('#finFound').textContent = bugs === 0 ? t('finale.found0') : bugs === 1 ? t('finale.foundOne') : bugs === 2 ? t('finale.foundTwo') : t('finale.found', { n: bugs });
  buildBoard($('#finBoard'), p.board || E('scoreboard', 'run') || [], { all: false });
  renderChecklist();
  S.finaleStars = stars;
}
// Which QA Wrap features this run proved: the level's result when it was played this run, else nothing (not learned).
function renderChecklist() {
  const res = (snap().results) || {};
  const rows = [1, 2, 3, 4, 5].map((n) => {
    const done = !!(res[n] && res[n].proved);
    const f = (S.lastFinale && S.lastFinale.learned && fixFeature(S.lastFinale.learned[n - 1])) || feat(n);
    return el('li', { class: 'check-row', 'data-done': done ? '1' : '0' },
      el('span', { class: 'tick' }, ico('i-check', 16)),
      f ? ico('qi-' + f.primary.icon, 20) : el('span'),
      el('span', { class: 'check-name', text: f ? f.names : '' }),
      el('span', { class: 'check-state', text: t(done ? 'finale.learned' : 'finale.notLearned') }));
  });
  $('#finChecklist').replaceChildren(...rows);
}
function showPasteResult(res) {
  const host = $('#pasteResult');
  host.replaceChildren();
  if (res && res.ok) {
    if (res.bug !== false) host.append(el('span', { class: 'ok-line' }, ico('i-check', 18), el('span', { text: t('finale.ok') })));
    host.append(el('span', { class: 'micro first', text: t('finale.firstLine') + ': ' + String(res.heading || '').slice(0, 60) }),
      el('span', { class: 'micro', text: t('finale.lines', { n: num(res.lines) }) }));
  } else {
    host.append(el('span', { class: 'nope', text: t('finale.notYet') }));
    sfx('not-yet');
  }
}
// Paste only: the text is read inside this handler, judged by the engine, then dropped. The box stays empty.
function onPaste(e) {
  e.preventDefault();
  let text = '';
  try { text = (e.clipboardData && e.clipboardData.getData('text')) || ''; } catch { text = ''; }
  $('#pasteBox').value = '';
  if (!text.trim()) return;
  const res = E('pasteText', text);
  text = '';
  showPasteResult(res && res.ok ? { ok: true, heading: res.heading, lines: res.lines, bug: res.bug } : { ok: false });
}

/* ---------- settings ---------- */
function renderSettings() {
  const p = P();
  const setSw = (id, on) => { const b = $(id); b.setAttribute('aria-checked', String(!!on)); $('.switch-txt', b).textContent = t(on ? 'set.on' : 'set.off'); };
  setSw('#swSound', soundOn()); setSw('#swVoice', p.voice !== false); setSw('#swCalm', p.calm === true);
  const vol = Number.isFinite(p.volume) ? p.volume : 60;
  $('#rngVolume').value = String(vol); $('#volOut').textContent = String(vol);
  for (const b of $$('[data-theme-set]')) b.setAttribute('aria-pressed', String(b.dataset.themeSet === (p.theme || 'auto')));
  const best = snap().best || {};
  const items = [];
  for (let i = 1; i <= 5; i++) items.push(el('span', { text: i + ' ' + fmtTime(best['l' + i]) }));
  items.push(el('span', { text: t('set.run') + ' ' + fmtTime(best.run) }));
  $('#bestList').replaceChildren(...items);
}
function trapTab(e, root) {
  if (e.key !== 'Tab') return;
  const f = $$('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])', root).filter((n) => !n.disabled && n.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
function openOverlay(name) {
  S.returnFocus = document.activeElement;
  S.overlay = name;
  $('#ov-' + name).hidden = false;
  refreshPrimary();
  const focusSel = { settings: '#setTitle', clear: '#clearTitle' }[name];
  const node = focusSel && $(focusSel); if (node) node.focus({ preventScroll: true });
}
function closeOverlay(name) {
  $('#ov-' + name).hidden = true;
  if (S.overlay === name) S.overlay = null;
  refreshPrimary();
  const back = S.returnFocus;
  if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
}

/* ---------- pause ---------- */
function setPaused(on) {
  if (on === S.paused) return;
  if (on && !(S.screen === 'card' || S.screen === 'play')) return;
  S.paused = on;
  if (on) {
    S.pausedAnims = document.getAnimations().filter((a) => a.playState === 'running');
    S.pausedAnims.forEach((a) => a.pause());
    pauseTimers();
    E('pause');
    try { S.audio.suspend && S.audio.suspend(); } catch { /* silent */ }
    $('#ov-pause').hidden = false;
    refreshPrimary();
    $('#btnResume').focus({ preventScroll: true });
  } else {
    $('#ov-pause').hidden = true;
    S.pausedAnims.forEach((a) => { try { a.play(); } catch { /* finished */ } });
    S.pausedAnims = [];
    resumeTimers();
    try { S.audio.resume && S.audio.resume(); } catch { /* silent */ }
    E('resume');
    refreshPrimary();
    const f = S.screen === 'play' ? $('#app') : $('#btnGo');
    f && f.focus({ preventScroll: true });
  }
}

/* ---------- engine events (payloads as emitted by engine.js) ---------- */
function onCard(e) {
  const n = e.n;
  S.level = n; S.caught = false; S.proved = false; S.hiddenFound = false;
  closeOverlayIfOpen('clear');
  $('#slotNote').replaceChildren(); $('#slotBug').replaceChildren();
  renderCard(n);
  showScreen('card');
  sfx('level-start');
  say(LEVELS[n].voice, { follow: n === 1 });
}
function onPlay(e) {
  S.learned = null;
  const n = e.n ?? S.level;
  S.level = n; S.caught = false; S.proved = false; S.hiddenFound = false; S.pt = null; S.chipsDone.clear();
  $('#app').dataset.level = String(n);
  renderRail();
  showScreen('play');
  sfx('whoosh');
  requestAnimationFrame(() => requestAnimationFrame(() => ringTarget(LEVELS[n]?.target)));
  if (readQaw().state === 'stopped') setNote(el('span', { class: 'nudge-line', text: t('rail.stoppedNote') })); // Stop in QA Wrap never ends the game; a new recording is what the next level needs
}
function onCatch(e) {
  const n = e.n ?? S.level;
  S.caught = true;
  if (typeof e.score === 'number') setScore(e.score);
  vfxCatch(anchor());
  showBugCard({ type: LEVELS[n].type, gold: false });
  renderRail();
  sfx('catch');
  if (!S.firstCatch) { S.firstCatch = true; after(300, () => say('v07')); }
}
function onBonus(e) {
  const n = e.n ?? S.level;
  S.hiddenFound = true;
  if (typeof e.score === 'number') setScore(e.score);
  vfxCatch(anchor(), { gold: true });
  showBugCard({ type: LEVELS[n].type, gold: true });
  renderRail();
  sfx('bonus-found');
}
function onChain(e) {
  setChain(e.mult ?? 1, { up: !!e.up });
  if (e.up) after(160, () => sfx('combo-up'));
}
function onProve(e) {
  S.proved = true;
  if (typeof e.score === 'number') setScore(e.score);
  renderRail();
  sfx(e.tool === 'note' ? 'note-save' : 'click');
  if (!S.firstProve) { S.firstProve = true; after(300, () => say('v08')); }
}
function onHint(e) {
  const n = e.n ?? S.level;
  showHint(n, e.key);
  if (e.kind === 'ping') {
    pulseHintButton(); sfx('hint-boop');
    if (!S.hintVoiced.has(n)) { S.hintVoiced.add(n); say('v10'); }
  }
}
function onNudge(e) { showNudge(e.key); }
function onNoise() { setNote(el('span', { class: 'nudge-line', text: t('noise.expected') })); renderRail(); setTimeout(renderRail, 0); }
function onChip(e) {
  S.chipsDone.add(e.id);
  if (typeof e.score === 'number') setScore(e.score);
  renderRail();
  setTimeout(renderRail, 0);
  if (e.points > 0) {
    const r = $('#railProof').getBoundingClientRect();
    ghost('+' + num(e.points), { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
  sfx('tool-ok');
}
// One tool was used. Right use: a +N ghost (at the click for the page, at the proof row for QA Wrap tools).
// Wrong use: a quiet "minus N, reason" line. No shake, no red, no buzzer.
function onToolScore(e) {
  if (typeof e.score === 'number') setScore(e.score);
  if (e.outcome === 'correct') {
    if (e.delta > 0) {
      let pt = anchor();
      if (e.tool !== 'page') { const r = ($('#railProof') || $('#rail')).getBoundingClientRect(); pt = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      ghost('+' + num(e.delta), pt);
    }
    if (e.tool !== 'page') sfx('tool-ok');
  } else {
    showQuiet(e.delta !== 0 ? e.delta : e.points, e.reasonKey);
    sfx('deduct');
  }
}
function onClear(e) {
  S.lastClear = e;
  if (e.learned) S.learned = { ...fixFeature(e.learned), n: e.n };
  if (typeof e.score === 'number') setScore(e.score);
  renderClear(e);
  openOverlay('clear');
  renderHud();
  if (S.trials) S.trials.refresh();
  sfx('level-clear');
  if (e.n === 3 && !S.l3Voiced && !e.skipped) { S.l3Voiced = true; after(900, () => say('v09')); }
}
function onFinale(e) {
  S.lastFinale = e || {};
  closeOverlayIfOpen('clear');
  if (e && typeof e.score === 'number') setScore(e.score, false);
  S.level = 5;
  renderFinale(S.lastFinale);
  $('#pasteResult').replaceChildren(); $('#pasteBox').value = '';
  showScreen('finale');
  if (S.trials) S.trials.refresh();
  confetti();
  sfx('fanfare');
  after(1800, () => say('v11'));
}
function onPasted(e) {
  if (typeof e.score === 'number') { setScore(e.score, false); $('#finScore').textContent = num(e.score); }
  if (e.board) buildBoard($('#finBoard'), e.board, { all: false });
}
function closeOverlayIfOpen(name) { if (S.overlay === name) closeOverlay(name); }

function subscribe(name, fn) {
  S.eng.on(name, (p) => { try { fn(p || {}); } catch (err) { console.error('[bughunt] ' + name, err); } });
}

/* ---------- user actions ---------- */
function gestureUnlock() {
  S.unlocked = true;
  try { S.audio.unlock && S.audio.unlock(); } catch { /* silent */ }
  try { S.audio.setVolume && S.audio.setVolume((P().volume ?? 60) / 100); S.audio.setVoice && S.audio.setVoice(P().voice !== false); } catch { /* silent */ }
}
function onStart(skipIntro) {
  gestureUnlock(); // sound and voice are on by default; a stored mute stays muted
  sfx('click');
  if (!skipIntro) say('v01'); // before start(): the first card's line queues behind it
  E('start');
}
function onGo() { stopVoice(); sfx('click'); E('go'); }
function onPrimary() {
  sfx('click');
  if (S.caught) { E('finish'); return; }
  E('hint'); // the engine answers with level:hint, which shows the line
}
function onNext() { sfx('click'); E('next'); }
function onAgain() {
  sfx('click');
  S.firstCatch = false; S.firstProve = false; S.l3Voiced = false; S.hintVoiced.clear();
  setScore(0, false); setChain(0);
  E('restart');
}
async function onCopyScore() {
  const s = snap();
  const text = t('finale.shareText', { stars: S.finaleStars ?? 0, score: num(S.lastFinale?.score ?? s.score), time: fmtTime(S.lastFinale?.bestRunMs ?? s.best?.run) });
  try { await navigator.clipboard.writeText(text); } catch { return; }
  sfx('click');
  const txt = $('#btnCopyScoreTxt');
  txt.textContent = t('finale.copied');
  cancel(S.copiedTimer);
  S.copiedTimer = after(1600, () => { txt.textContent = t('finale.copyScore'); });
}
function openSettings() { if (S.overlay) return; openOverlay('settings'); sfx('click'); }
function closeSettings() { closeOverlay('settings'); }

function typing(e) {
  const n = e.target;
  return n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
}
function onKey(e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return; // Alt chords belong to QA Wrap.
  if (S.overlay === 'settings') { if (e.key === 'Escape') { e.preventDefault(); closeSettings(); return; } trapTab(e, $('#dlgSettings')); return; }
  if (S.overlay === 'clear') { if (e.key === 'Escape') { e.preventDefault(); return; } trapTab(e, $('#dlgClear')); return; }
  if (S.paused) { if (e.key === 'Escape' || e.key.toLowerCase() === 'p') { e.preventDefault(); setPaused(false); } return; }
  if (e.key === 'Escape') {
    if (S.screen === 'finale') { e.preventDefault(); onAgain(); return; }
    if (S.screen === 'card' || S.screen === 'play') { e.preventDefault(); setPaused(true); }
    return;
  }
  if (typing(e)) return;
  const k = e.key.toLowerCase();
  if (k === 'm') { setSound(!soundOn()); return; }
  if (k === 'p') { setPaused(true); return; }
  if (k === 'h' && S.screen === 'play') { onPrimaryHint(); return; }
  if (e.key === 'Enter' && S.screen === 'title' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); $('#btnStart').click(); }
}
function onPrimaryHint() { if (!S.caught) $('#btnPrimary').click(); }

function wire() {
  $('#btnStart').addEventListener('click', () => onStart(false));
  $('#btnSkipIntro').addEventListener('click', () => onStart(true));
  $('#btnGo').addEventListener('click', onGo);
  $('#btnCardSkip').addEventListener('click', () => { stopVoice(); E('skip'); });
  $('#btnSkip').addEventListener('click', () => E('skip'));
  $('#btnPrimary').addEventListener('click', onPrimary);
  $('#railProof').addEventListener('click', (e) => { const b = e.target.closest('#chipProve'); if (b && !b.disabled) { E('claimProve', b.dataset.kind); return; }
    const x = e.target.closest('[data-chip]'); if (x && !x.disabled) E('claimChip', x.dataset.chip); });
  $('#btnNext').addEventListener('click', onNext);
  $('#btnCopyScore').addEventListener('click', onCopyScore);
  $('#btnAgain').addEventListener('click', onAgain);
  $('#btnPause').addEventListener('click', () => setPaused(true));
  $('#ov-pause').addEventListener('click', () => setPaused(false));
  $('#btnSound').addEventListener('click', () => { if (!S.unlocked) gestureUnlock(); setSound(!soundOn()); });
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnSetClose').addEventListener('click', closeSettings);
  $('#btnSetDone').addEventListener('click', closeSettings);
  $('#ov-settings').addEventListener('click', (e) => { if (e.target.id === 'ov-settings') closeSettings(); });
  for (const b of $$('[data-lang]')) b.addEventListener('click', () => { setLang(b.dataset.lang); });
  $('#btnTheme').addEventListener('click', () => { const order = ['auto', 'light', 'dark']; const cur = P().theme || 'auto'; setPrefs({ theme: order[(order.indexOf(cur) + 1) % 3] }); applyTheme(); renderSettings(); });
  for (const b of $$('[data-theme-set]')) b.addEventListener('click', () => { setPrefs({ theme: b.dataset.themeSet }); applyTheme(); renderSettings(); });
  $('#swSound').addEventListener('click', () => { if (!S.unlocked) gestureUnlock(); setSound(!soundOn()); });
  $('#swVoice').addEventListener('click', () => setVoiceOn(P().voice === false));
  $('#swCalm').addEventListener('click', () => { setPrefs({ calm: !(P().calm === true) }); applyCalm(); renderSettings(); });
  $('#rngVolume').addEventListener('input', (e) => { const v = Number(e.target.value); $('#volOut').textContent = String(v); try { S.audio.setVolume && S.audio.setVolume(v / 100); } catch { /* silent */ } });
  $('#rngVolume').addEventListener('change', (e) => savePrefs({ volume: Number(e.target.value) }));
  $('#btnReset').addEventListener('click', () => {
    if (confirm(t('set.resetConfirm'))) { E('resetProgress'); if (S.trials) S.trials.reset(); snap(); setScore(0, false); renderTitle(); renderSettings(); renderHud(); }
  });
  const box = $('#pasteBox');
  box.addEventListener('paste', onPaste);
  box.addEventListener('beforeinput', (e) => e.preventDefault()); // paste-only: typed or dropped text never lands in the box
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => { if (document.hidden && !S.overlay) setPaused(true); }); // never on blur (spec section 1)
  $('#app').addEventListener('pointerdown', (e) => { S.pt = { x: e.clientX, y: e.clientY }; }, true);
  document.addEventListener('qaw:state', renderQaw);
  new MutationObserver(renderQaw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-qaw-state', 'data-qaw-notes', 'data-qaw-shots'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
}

/* ---------- boot ---------- */
function fatal(key) {
  const f = $('#fatal'); $('#fatalTxt').dataset.key = key; $('#fatalTxt').textContent = t(key); f.hidden = false;
  document.body.dataset.ready = '1';
}
// Hard trials: optional and lazy. The entry link shows only after levels 1-5 are each at 2 stars or more.
async function initTrials() {
  try {
    const m = await import('./trial-ui.js');
    S.trials = await m.mountTrialUI({
      t, lang: () => S.lang, snap, motionOff, calm: () => P().calm === true, sfx, mod: S.mod, doc: document, win: window,
      enter: () => { stopVoice(); }, exit: () => {},
    });
  } catch (err) { console.error('[bughunt] trials', err); document.body.removeAttribute('data-trial-cover'); }
}
async function boot() {
  const enP = loadDict('en');
  const audioP = loadAudio().catch(() => {});
  const manP = loadManifest();
  S.dictEn = await enP; S.dict = S.dictEn;
  let ready = false;
  try {
    const mod = await import('./engine.js');
    const make = mod.createEngine || (mod.default && mod.default.createEngine) || mod.default;
    S.mod = mod;
    S.eng = typeof make === 'function' ? make({ root: $('#app'), t, doc: document, win: window }) : (mod.engine || mod.default);
    ready = !!S.eng;
  } catch (err) { console.error('[bughunt] engine', err); }
  await Promise.all([audioP, manP]);
  const fromEngine = ready ? (E('getPrefs') || {}) : {};
  Object.assign(S.prefs, fromEngine);
  S.sound = fromEngine.sound !== false; // default ON; the context itself still waits for the first press
  try { S.audio.setMuted && S.audio.setMuted(!S.sound); } catch { /* silent */ }
  const lang = fromEngine.lang || ((navigator.language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en');
  S.lang = 'en';
  wire();
  { const once = () => { document.removeEventListener('pointerdown', once, true); document.removeEventListener('keydown', once, true); if (!S.unlocked) gestureUnlock(); };
    document.addEventListener('pointerdown', once, true); document.addEventListener('keydown', once, true); } // first press of anything unlocks audio
  applyTheme(); applyCalm();
  await setLang(lang === 'ar' ? 'ar' : 'en', { persist: false });
  setScore(snap().score || 0, false);
  showScreen('title', { focus: false });
  if (!ready) { fatal('err.engine'); return; }
  const map = { 'level:card': onCard, 'level:play': onPlay, 'level:catch': onCatch, 'level:bonus': onBonus, 'level:prove': onProve, 'level:hint': onHint, 'level:nudge': onNudge, 'level:noise': onNoise, 'level:chip': onChip, 'score:tool': onToolScore, 'level:chain': onChain, 'level:clear': onClear, finale: onFinale, 'finale:pasted': onPasted };
  for (const [name, fn] of Object.entries(map)) subscribe(name, fn);
  document.body.dataset.ready = '1';
  $('#btnStart').focus({ preventScroll: true });
  initTrials();
}
boot().catch((err) => { console.error('[bughunt] boot', err); try { fatal('err.engine'); } catch { document.body.dataset.ready = '1'; } });
