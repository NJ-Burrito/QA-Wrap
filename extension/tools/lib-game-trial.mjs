/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt hard trials (stages 6 and 7), lane T3 test kit. Node only, no browser. Everything the trial touches is injected
 * (DESIGN-bug-hunt-hard.md section 10 contract), so the real game/trial.js runs here on a virtual clock:
 *
 *   createTrial({ doc, win, t, clock, storage, getState, getCounts, root, fetch })
 *       -> { open(n), attune(), begin(), leave(), pause(), resume(), pasteText(text), bindPasteGate(textarea), view(), on(type, fn), destroy() }
 *   events:  trial:door{n,open} trial:attune{step,ok} trial:start{n,attempt} trial:room{n,room} trial:tell{n,cls}
 *            trial:ok{n,tool,points} trial:death{n,deaths,room,cause,t} trial:clear{n,deaths,ms,score,badges} trial:pasted{heading,lines}
 *
 * What lives here (every assumption about T1 is in THIS file, so one edit fixes a drift):
 *   makeDom()      a small fake DOM (tree, selectors, innerHTML, events that bubble, dataset, classList)
 *   makeRig()      a virtual-time rig: fake clock, in-memory storages, a QA Wrap simulator that moves qawState / qaw* counts with
 *                  a chosen lag, a recording fetch, page reloads (a death calls win.location.reload(); the rig builds a new page)
 *   ORACLE         the timelines of DESIGN sections 5 and 6, in seconds on the stage clock (t0 = the first room-1 event of an attempt)
 *   PERFECT        the scripted skilled player for each stage (ids name the action, so a test can drop or move one)
 *   needTrial()    prints SKIPPED and exits 2 while T1 has not landed (never a green exit 0)
 *
 * Assumptions about T1 that the tests lean on (each is written in the design, none is invented here):
 *   A1 the stage clock starts at the `trial:room {room:1}` event of an attempt (door open + 0.8 s ready beat);
 *   A2 a death waits for QA Wrap to stop recording, then calls win.location.reload(); the new page calls trial.restoreRestart() (T2 does this on load);
 *   A3 the door opens for qawState ready only (a 'stopped' page is reloaded first: begin() reloads under the cover); open(n) is ASYNC and returns { ok, reason };
 *   A4 view().status is one of idle | card | attune | door | run | paused | dead | clear; a locked stage is open() -> { ok:false, reason:'locked' };
 *   A5 planted failures are `fetch(url, { method })` calls on the injected fetch, the path is the last segment(s) of the url;
 *   A6 the persistent state is localStorage-shaped `bughunt.trial.v1` (design 3.7) and the main save is `bughunt.v1`;
 *   A7 the arena has `#next`, `[data-decoy]`, `#trial-paste`, `.trial-tell[data-cls]`, `[data-trial-room]`, `[data-trial-deaths]`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXT } from './lib-paths.mjs';
import { skipNotEnforced, finish } from './lib-assert.mjs';

export { EXT };
export const GAME = path.join(EXT, 'game');
export const TRIAL_KEY = 'bughunt.trial.v1';
export const MAIN_KEY = 'bughunt.v1';
export const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));
export const imp = (rel) => import(pathToFileURL(path.join(GAME, rel)).href);

/** T1's files. */
export const T1_FILES = ['trial.js', 'trials/t6.js', 'trials/t7.js', 'trials/attune.js'];
export const missingT1 = () => T1_FILES.filter((f) => !fs.existsSync(path.join(GAME, f)));
/** Call first in a suite: while T1 has not landed the suite says SKIPPED and exits 2 (the runner reads it; never a green 0). */
export function needTrial(suite, extra = []) {
  const need = [...missingT1(), ...extra.filter((f) => !fs.existsSync(path.join(GAME, f)))];
  if (need.length) {
    skipNotEnforced({ rule: 'game-trial', what: suite, why: `game/${need.join(', game/')} have not landed (T1/T2 build in parallel)` });
    finish(suite, { skipped: 1 });
  }
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Constants of the lag law (design section 2). They are PINNED here; trial.js must export or use the same numbers.         */
export const LAG_SLOW = 3.6;
export const LAG_FAST = 0.5;
export const TOL = 0.1;
export const FRAMES = 0.06; // tolerance for "at this second" on a 50 ms game tick

/** The words of stage 7 (design section 6). index = attempt mod 12. */
export const WORDS = ['almond', 'basil', 'cumin', 'dill', 'fennel', 'garlic', 'mint', 'olive', 'parsley', 'saffron', 'sesame', 'thyme'];

/* ------------------------------------------------------------------------------------------------------------------ */
/* The oracle: sections 5 and 6, seconds on the stage clock                                                              */
export const ORACLE = {
  6: {
    rooms: [0, 13, 22, 40, 52],
    tells: [['line', 3.0], ['underline', 13.0], ['sync', 40.0], ['sync', 42.2], ['bar', 52.0]], ring: 22.0,
    fetches: [['POST', '/api/sync', 503, 4.2], ['POST', '/api/telemetry', 500, 40.8], ['POST', '/api/checkout', 500, 43.0]],
    floor: 52, skilled: [52, 60], subtotal: 1000, bonus: 500, total: 1500,
  },
  7: {
    rooms: [0, 8, 21.9, 32, 49, 63],
    tells: [['sync', 8.0], ['sync', 12.0], ['sync', 14.3], ['sync', 18.8], ['bar', 21.9], ['line', 32.0], ['underline', 63.0]], ring: 49.0,
    fetches: [['POST', '/api/save-profile', 500, 8.8], ['POST', '/api/telemetry', 500, 12.8], ['GET', '/api/menu', 404, 15.1], ['GET', '/favicon.ico', 404, 19.6], ['POST', '/api/orders/', 503, 33.2]],
    floor: 80, skilled: [80, 95], subtotal: 1900, bonus: 1000, total: 2900,
  },
};

/** The windows of the tables: a = earliest accepted observation, b = latest PRESS that is still inside, lag = which signal. */
export const WINDOWS = {
  6: [
    { id: 'buffer', a: 4.2, b: 11.2, fast: true, deadline: 11.7, early: 'buffer-early', missed: 'buffer-missed', room: 1 },
    { id: 'shot', a: 16.0, b: 17.5, fast: false, deadline: 21.2, early: 'shot-early', missed: 'shot-missed', over: 'shot-over', room: 2 },
    { id: 'note', a: 23.0, b: 30.0, fast: false, deadline: 33.7, early: 'note-early', missed: 'note-missed', over: 'note-over', room: 3, afterClick: 7.0 },
    { id: 'notbug', a: 40.95, b: 43.2, fast: true, deadline: 43.35, missed: 'notbug-missed', room: 4, decoy: true },
    { id: 'stop', a: 52.0, b: 61.0, fast: true, deadline: 61.5, early: 'stop-early', missed: 'stop-missed', room: 5 },
  ],
  7: [
    { id: 'start', a: 0.0, b: 7.5, fast: true, deadline: 8.0, missed: 'start-missed', room: 1 },
    { id: 'nb2b', a: 12.95, b: 15.3, fast: true, deadline: 15.45, missed: 'notbug-missed', room: 2, decoy: true },
    { id: 'nb2d', a: 19.75, b: 21.8, fast: true, deadline: 21.9, missed: 'notbug-missed', room: 2, decoy: true },
    { id: 'stop1', a: 21.9, b: 30.0, fast: true, deadline: 30.5, early: 'stop-early', missed: 'stop-missed', room: 3 },
    { id: 'buffer', a: 33.2, b: 40.2, fast: true, deadline: 40.7, early: 'buffer-early', missed: 'buffer-missed', room: 4 },
    { id: 'note', a: 49.0, b: 54.0, fast: false, deadline: 62.7, early: 'note-early', missed: 'note-missed', over: 'note-over', room: 5, afterClick: 5.0 },
    { id: 'shot', a: 66.0, b: 67.5, fast: false, deadline: 71.2, early: 'shot-early', missed: 'shot-missed', over: 'shot-over', room: 6 },
  ],
};

/** Scripted skilled players (seconds on the stage clock). `lag*` come from the rig, so the same script serves every lag. */
export const PERFECT = {
  6: [
    { id: 'buffer', at: 5.5, kind: 'buffer' },
    { id: 'shot', at: 16.3, kind: 'shot' },
    { id: 'click', at: 23.0, kind: 'click', sel: '#next' },
    { id: 'note', at: 24.5, kind: 'note' },
    { id: 'notbug', at: 41.8, kind: 'notbug' },
    { id: 'stop', at: 54.0, kind: 'stop' },
  ],
  7: [
    { id: 'start', at: 1.6, kind: 'shortcut' },
    { id: 'nb2b', at: 13.8, kind: 'notbug' },
    { id: 'nb2d', at: 20.6, kind: 'notbug' },
    { id: 'stop1', at: 23.5, kind: 'stop' },
    { id: 'buffer', at: 34.5, kind: 'buffer' },
    { id: 'click', at: 50.0, kind: 'click', sel: '#next' },
    { id: 'note', at: 51.5, kind: 'note' },
    { id: 'shot', at: 66.4, kind: 'shot' },
    { id: 'markup', at: 76.0, kind: 'markup' },
    { id: 'stop2', at: 79.0, kind: 'stop' },
    { id: 'paste', at: 84.0, kind: 'paste' },
  ],
};
/** Copy a script, replacing (patch object), removing (null) or adding (no matching id) one action. */
export function mut(script, id, patch) {
  const out = script.map((a) => ({ ...a }));
  const i = out.findIndex((a) => a.id === id);
  if (patch === null) { if (i >= 0) out.splice(i, 1); return out; }
  if (i >= 0) out[i] = { ...out[i], ...patch };
  else out.push({ id, ...patch });
  return out;
}

/** A report that passes the paste gate (`# ` first line, >= 3 lines, a `## ` heading) and names the attempt's order path. */
export function makeReport({ word = 'almond', title = 'Checkout failed after Next', stale = false } = {}) {
  return ['# ' + title, '', '## Steps to reproduce', '1. Open the shop', '2. Press Next, nothing happens', '', '## Evidence',
    `- POST /api/orders/${stale ? 'staleword' : word} 503`, '', '| Problems | 3 |', ''].join('\n');
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* A fake clock: timers fire inside advance(), in order                                                                    */
export function fakeClock(t0 = 100000) {
  let t = t0; let seq = 0;
  const timers = new Map();
  const add = (fn, ms, every) => { const id = ++seq; timers.set(id, { fn, at: t + Math.max(0, ms), every }); return id; };
  return {
    now: () => t,
    setTimeout: (fn, ms) => add(fn, ms, 0),
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms)),
    clearInterval: (id) => { timers.delete(id); },
    requestAnimationFrame: (fn) => add(() => fn(t), 16, 0),
    cancelAnimationFrame: (id) => { timers.delete(id); },
    advance(ms) {
      const end = t + ms;
      for (let guard = 0; guard < 2e6; guard++) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x];
        if (!next) break;
        const [id, x] = next;
        t = Math.max(t, x.at);
        if (x.every) x.at += x.every; else timers.delete(id);
        x.fn();
      }
      t = end;
    },
    get pending() { return timers.size; },
  };
}

export function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  const writes = [];
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); writes.push(['set', k, String(v)]); },
    removeItem: (k) => { m.delete(k); writes.push(['remove', k]); },
    clear: () => { m.clear(); writes.push(['clear']); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    dump: () => Object.fromEntries(m),
    writes,
  };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* A small fake DOM                                                                                                       */
class FEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, { bubbles: true, cancelable: true }, init); this.defaultPrevented = false; this.target = null; this.currentTarget = null; this._stop = false; }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; }
}
const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'source']);

function parseSel(sel) {
  return String(sel).split(',').map((s) => s.trim()).filter(Boolean).map((alt) => {
    const parts = [];
    const re = /\s*([>+~]?)\s*((?:[#.]?[\w-]+|\*|\[[^\]]+\])+)/g;
    let m;
    while ((m = re.exec(alt))) {
      const comp = { tag: null, id: null, cls: [], attrs: [], comb: m[1] || ' ' };
      for (const p of m[2].match(/\[[^\]]+\]|[#.]?[\w-]+|\*/g)) {
        if (p[0] === '#') comp.id = p.slice(1);
        else if (p[0] === '.') comp.cls.push(p.slice(1));
        else if (p[0] === '[') {
          const mm = /^\[([\w:-]+)(?:([~^$*|]?=)["']?([^"'\]]*)["']?)?\]$/.exec(p);
          if (mm) comp.attrs.push({ name: mm[1], op: mm[2] || null, val: mm[3] });
        } else if (p !== '*') comp.tag = p.toLowerCase();
      }
      parts.push(comp);
    }
    return parts;
  });
}
function matchComp(el, c) {
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const k of c.cls) if (!el.classList.contains(k)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    const v = el.getAttribute(a.name);
    if (a.op === '=' && v !== a.val) return false;
    if (a.op === '^=' && !v.startsWith(a.val)) return false;
    if (a.op === '$=' && !v.endsWith(a.val)) return false;
    if (a.op === '*=' && !v.includes(a.val)) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.val)) return false;
  }
  return true;
}
function matchChain(el, parts, i) {
  if (!matchComp(el, parts[i])) return false;
  if (i === 0) return true;
  const comb = parts[i].comb;
  if (comb === '>') return el.parentNode && el.parentNode.nodeType === 1 && matchChain(el.parentNode, parts, i - 1);
  for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) if (matchChain(p, parts, i - 1)) return true;
  return false;
}

class FText {
  constructor(text, doc) { this.nodeType = 3; this.data = String(text); this.parentNode = null; this.ownerDocument = doc; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class FElement {
  constructor(tag, doc) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.ownerDocument = doc; this.parentNode = null; this.childNodes = [];
    this._attrs = new Map(); this._ls = new Map(); this.style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' };
    this.value = ''; this.checked = false; this.disabled = false; this._hidden = false;
    const self = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? self._attrs.get('data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())) : undefined),
      set: (_, k, v) => { self._attrs.set('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), String(v)); return true; },
      deleteProperty: (_, k) => { self._attrs.delete('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())); return true; },
      has: (_, k) => self._attrs.has('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())),
      ownKeys: () => [...self._attrs.keys()].filter((k) => k.startsWith('data-')).map((k) => k.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())),
      getOwnPropertyDescriptor: (_, k) => (self._attrs.has('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())) ? { enumerable: true, configurable: true, value: self.dataset[k] } : undefined),
    });
    this.classList = {
      add: (...c) => { const s = new Set(self._cls()); c.forEach((x) => s.add(x)); self._attrs.set('class', [...s].join(' ')); },
      remove: (...c) => { const s = new Set(self._cls()); c.forEach((x) => s.delete(x)); self._attrs.set('class', [...s].join(' ')); },
      toggle: (c, force) => { const has = self._cls().includes(c); const want = force === undefined ? !has : !!force; if (want) self.classList.add(c); else self.classList.remove(c); return want; },
      contains: (c) => self._cls().includes(c),
    };
  }
  _cls() { return (this._attrs.get('class') || '').split(/\s+/).filter(Boolean); }
  get id() { return this._attrs.get('id') || ''; } set id(v) { this._attrs.set('id', String(v)); }
  get className() { return this._attrs.get('class') || ''; } set className(v) { this._attrs.set('class', String(v)); }
  get hidden() { return this._attrs.has('hidden'); } set hidden(v) { if (v) this._attrs.set('hidden', ''); else this._attrs.delete('hidden'); }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; } get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; if (v !== '' && v != null) this.appendChild(new FText(v, this.ownerDocument)); }
  get innerText() { return this.textContent; } set innerText(v) { this.textContent = v; }
  get innerHTML() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.outerHTML)).join(''); }
  set innerHTML(html) {
    this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = [];
    const stack = [this];
    const re = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(String(html)))) {
      const top = stack[stack.length - 1];
      if (m[5] !== undefined) top.appendChild(new FText(m[5], this.ownerDocument));
      else if (m[1]) { if (stack.length > 1) stack.pop(); } else if (m[2]) {
        const el = new FElement(m[2], this.ownerDocument);
        for (const a of m[3].matchAll(/([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) el.setAttribute(a[1], a[2] ? a[2].replace(/^["']|["']$/g, '') : '');
        top.appendChild(el);
        if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(el);
      }
    }
  }
  get outerHTML() {
    const a = [...this._attrs].map(([k, v]) => ` ${k}="${v}"`).join('');
    return VOID.has(this.tagName.toLowerCase()) ? `<${this.tagName.toLowerCase()}${a}>` : `<${this.tagName.toLowerCase()}${a}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }
  setAttribute(k, v) { this._attrs.set(k, String(v)); if (k === 'value') this.value = String(v); }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  hasAttribute(k) { return this._attrs.has(k); }
  removeAttribute(k) { this._attrs.delete(k); }
  toggleAttribute(k, force) { const want = force === undefined ? !this._attrs.has(k) : !!force; if (want) this._attrs.set(k, ''); else this._attrs.delete(k); return want; }
  appendChild(n) { if (typeof n === 'string') n = new FText(n, this.ownerDocument); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns) { ns.forEach((n) => this.appendChild(n)); }
  prepend(...ns) { ns.reverse().forEach((n) => { if (typeof n === 'string') n = new FText(n, this.ownerDocument); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.unshift(n); }); }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); const i = this.childNodes.indexOf(ref); n.parentNode = this; this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; } return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...ns) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; ns.forEach((n) => this.appendChild(n)); }
  replaceWith(n) { const p = this.parentNode; if (p) { p.insertBefore(n, this); p.removeChild(this); } }
  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }
  matches(sel) { return parseSel(sel).some((parts) => matchChain(this, parts, parts.length - 1)); }
  closest(sel) { for (let p = this; p && p.nodeType === 1; p = p.parentNode) if (p.matches(sel)) return p; return null; }
  querySelectorAll(sel) {
    const alts = parseSel(sel); const out = [];
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue; if (alts.some((parts) => matchChain(c, parts, parts.length - 1))) out.push(c); walk(c); } };
    walk(this); return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
  addEventListener(type, fn, opts) { if (!this._ls.has(type)) this._ls.set(type, []); this._ls.get(type).push({ fn, once: !!(opts && opts.once) }); }
  removeEventListener(type, fn) { const l = this._ls.get(type); if (l) this._ls.set(type, l.filter((x) => x.fn !== fn)); }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    for (let n = this; n && !ev._stop; n = n.parentNode || (n.nodeType === 9 ? n.defaultView : null)) {
      ev.currentTarget = n;
      const list = n._ls && n._ls.get(ev.type);
      if (list) for (const x of [...list]) { if (x.once) n.removeEventListener(ev.type, x.fn); x.fn.call(n, ev); if (ev._stop) break; }
      if (ev.bubbles === false && n === this) break;
    }
    return !ev.defaultPrevented;
  }
  click() { if (this.disabled) return; this.dispatchEvent(new FEvent('click', { detail: 1, isTrusted: true })); }
  focus() { this.ownerDocument.activeElement = this; } blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getAnimations() { return []; } animate() { return { cancel() {}, finished: Promise.resolve() }; }
  scrollIntoView() {} setPointerCapture() {} releasePointerCapture() {}
  get offsetWidth() { return 0; } get offsetHeight() { return 0; }
}

/** { doc, win } for one page. `reloads` and `sessionStorage` come from the rig. */
export function makeDom({ lang = 'en', calm = false, clock, localStorage, sessionStorage, onReload } = {}) {
  const doc = { nodeType: 9, hidden: false, visibilityState: 'visible', activeElement: null, _ls: new Map(), parentNode: null };
  const html = new FElement('html', doc); const body = new FElement('body', doc); const head = new FElement('head', doc);
  html.appendChild(head); html.appendChild(body);
  html.setAttribute('lang', lang); html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  if (calm) { html.dataset.calm = '1'; body.dataset.calm = '1'; body.classList.add('calm'); }
  Object.assign(doc, {
    documentElement: html, body, head,
    createElement: (t) => new FElement(t, doc), createElementNS: (_ns, t) => new FElement(t, doc), createTextNode: (s) => new FText(s, doc),
    createDocumentFragment: () => new FElement('fragment', doc),
    getElementById: (id) => html.querySelector('#' + id),
    querySelector: (s) => html.querySelector(s), querySelectorAll: (s) => html.querySelectorAll(s),
    getAnimations: () => [],
    addEventListener: FElement.prototype.addEventListener, removeEventListener: FElement.prototype.removeEventListener,
    dispatchEvent(ev) { if (!ev.target) ev.target = doc; for (let n = doc; n && !ev._stop; n = n === doc ? doc.defaultView : null) { ev.currentTarget = n; const l = n._ls && n._ls.get(ev.type); if (l) for (const x of [...l]) x.fn.call(n, ev); } return !ev.defaultPrevented; },
  });
  const reduce = !!calm;
  const clipboard = { reads: 0, writes: [], read: async () => { clipboard.reads++; return []; }, readText: async () => { clipboard.reads++; return ''; }, writeText: async (s) => { clipboard.writes.push(String(s)); } };
  const win = {
    document: doc, _ls: new Map(), parentNode: null, nodeType: 0,
    addEventListener: FElement.prototype.addEventListener, removeEventListener: FElement.prototype.removeEventListener,
    dispatchEvent(ev) { ev.currentTarget = win; const l = win._ls.get(ev.type); if (l) for (const x of [...l]) x.fn.call(win, ev); return true; },
    location: { href: 'http://localhost:4173/', origin: 'http://localhost:4173', reload: () => onReload && onReload() },
    navigator: { clipboard, language: lang, languages: [lang] },
    localStorage, sessionStorage,
    matchMedia: (q) => ({ matches: reduce && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    getComputedStyle: () => ({ getPropertyValue: () => '', animationName: 'none', transitionDuration: '0s' }),
    Event: FEvent, CustomEvent: FEvent, KeyboardEvent: FEvent, ClipboardEvent: FEvent, MouseEvent: FEvent,
    setTimeout: clock?.setTimeout, clearTimeout: clock?.clearTimeout, setInterval: clock?.setInterval, clearInterval: clock?.clearInterval,
    requestAnimationFrame: clock?.requestAnimationFrame, cancelAnimationFrame: clock?.cancelAnimationFrame,
    performance: { now: () => clock?.now() ?? 0 },
    confirm: () => { win.confirms = (win.confirms || 0) + 1; return true; },
  };
  doc.defaultView = win;
  return { doc, win, clipboard, FEvent };
}

/** Plain text of every node under `el` (a quick way to scan the visible words). */
export const textOf = (el) => (el ? el.textContent : '');

/* ------------------------------------------------------------------------------------------------------------------ */
/* Strings                                                                                                                 */
export function loadStrings(lang = 'en') {
  const f = path.join(GAME, 'strings', `${lang}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
export function makeT(lang = 'en') {
  const s = loadStrings(lang);
  return (key, vars = {}) => String(s[key] ?? `[${key}]`).replace(/\{(\w+)\}/g, (_m, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* The rig                                                                                                                 */
const ROUTE_STATUS = { '/api/sync': 503, '/api/telemetry': 500, '/api/checkout': 500, '/api/save-profile': 500, '/api/menu': 404, '/favicon.ico': 404 };
export const EVENT_TYPES = ['trial:door', 'trial:attune', 'trial:start', 'trial:room', 'trial:tell', 'trial:ok', 'trial:death', 'trial:clear', 'trial:pasted', 'trial:card', 'trial:leave', 'trial:pause', 'trial:reset'];
const lc = (s) => String(s || '').toLowerCase();
/** view().status -> one of locked | card | attune | door | run | death | clear | '' */
export const statusOf = (v) => { const s = lc(v && v.status); if (s.startsWith('dead')) return 'death'; for (const k of ['idle', 'locked', 'card', 'attune', 'door', 'run', 'paused', 'death', 'clear']) if (s.startsWith(k)) return k; return s; };
/** Normalise a tell class to the vocabulary of table 1.1. */
export const clsOf = (c) => { const s = lc(c); for (const k of ['underline', 'line', 'ring', 'sync', 'ping', 'bar']) if (s === k) return k; for (const k of ['underline', 'line', 'ring', 'sync', 'ping', 'bar']) if (s.includes(k)) return k; return s; };

export function trialSeed({ n = 6, attuned = true, deaths = 0, stars = 3, extra = {} } = {}) {
  const stage = (clears) => ({ deaths, bestRoom: 0, clears, attuned, causes: [] });
  return {
    [MAIN_KEY]: JSON.stringify({ prefs: { lang: 'en', theme: 'dark', sound: true, voice: true, volume: 60, calm: false }, best: {}, stars: { l1: stars, l2: stars, l3: stars, l4: stars, l5: stars }, stickers: {}, bonus: {} }),
    [TRIAL_KEY]: JSON.stringify({ 6: stage(n === 7 ? 1 : 0), 7: stage(0), badges: {}, score: {}, shortcutOk: true, ...extra }),
  };
}

/**
 * makeRig({ n, lang, calm, lagFast, lagSlow, seed, qawInit, scripts, autoBegin })
 *   scripts(attempt) -> action[] | null   the player for attempt 0, 1, ... (actions: see perform())
 * The rig builds a page (fake DOM + createTrial), opens the stage, begins it, and runs on a virtual clock.
 */
export async function makeRig(o = {}) {
  const mod = await imp('trial.js');
  const create = mod.createTrial || mod.default?.createTrial || mod.default;
  if (typeof create !== 'function') throw new Error('game/trial.js does not export createTrial (design section 10 contract)');
  const n = o.n || 6;
  const lang = o.lang || 'en';
  const clock = fakeClock();
  const storage = memStorage(o.seed || trialSeed({ n, attuned: o.attuned !== false }));
  const session = memStorage();
  const lagFast = o.lagFast ?? 0.15; const lagSlow = o.lagSlow ?? 1.5;
  const sim = { state: 'qawInit' in o ? o.qawInit : 'ready', ever: false, notes: 0, shots: 0, shortcut: 0, expected: 0, noteTypes: 0, marks: 0, buffer: 0 };
  const rig = { n, lang, clock, storage, session, sim, events: [], fetches: [], reloads: [], pages: [], attempt: -1, t0: null, errors: [], missing: [], inflight: [], done: false, busy: 0, lastOpen: null };
  const ms = (s) => Math.round(s * 1000);
  const rel = () => (rig.t0 === null ? null : (clock.now() - rig.t0) / 1000);
  rig.rel = rel;

  function sync() {
    const p = rig.page; if (!p) return;
    const d = p.doc.documentElement.dataset;
    if (sim.state) d.qawState = sim.state; else delete d.qawState;
    for (const k of ['notes', 'shots', 'shortcut', 'expected', 'noteTypes', 'marks', 'buffer']) d['qaw' + k[0].toUpperCase() + k.slice(1)] = String(sim[k]);
    p.doc.dispatchEvent(new FEvent('qaw:state', { detail: sim.state, bubbles: false }));
  }
  rig.set = (patch) => { Object.assign(sim, patch); if (patch.state === 'recording') sim.ever = true; sync(); };
  const sessionStart = () => { sim.notes = 0; sim.shots = 0; sim.shortcut = 0; sim.noteTypes = 0; sim.marks = 0; rig.set({ state: 'recording' }); };
  const later = (sec, fn) => { const id = clock.setTimeout(fn, ms(sec)); rig.inflight.push(id); return id; };

  const fetchStub = (url, init = {}) => {
    const u = String(url && url.url ? url.url : url);
    const p = u.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
    const status = p.startsWith('/api/orders/') ? 503 : ROUTE_STATUS[p] ?? 200;
    rig.fetches.push({ t: clock.now(), rel: rel(), attempt: rig.attempt, method: String(init.method || 'GET').toUpperCase(), path: p, status });
    return Promise.resolve({ ok: status < 400, status, text: async () => '', json: async () => ({}) });
  };

  function newPage() {
    const old = rig.page;
    if (old) { try { old.trial.destroy?.(); } catch (e) { rig.errors.push('destroy: ' + e.message); } }
    rig.actionTimers?.forEach((id) => clock.clearTimeout(id));
    rig.actionTimers = [];
    const calmSeed = o.calm ? { prefs: { lang, theme: 'dark', sound: true, voice: true, volume: 60, calm: true } } : null;
    if (calmSeed) { const cur = storage.getItem(MAIN_KEY); const j = cur ? JSON.parse(cur) : {}; j.prefs = { ...(j.prefs || {}), calm: true }; storage.setItem(MAIN_KEY, JSON.stringify(j)); storage.writes.length = 0; }
    const dom = makeDom({ lang, calm: !!o.calm, clock, localStorage: storage, sessionStorage: session, onReload: () => { rig.reloads.push(clock.now()); rig.reloadPending = true; clock.setTimeout(reload, ms(o.pageLoad ?? 0)); } });
    const root = dom.doc.createElement('div'); root.id = 'app'; dom.doc.body.appendChild(root);
    const view = () => (rig.page ? rig.page.trial.view() : null);
    const trial = create({
      doc: dom.doc, win: dom.win, t: makeT(lang), clock, storage, session, root, fetch: fetchStub,
      getState: () => sim.state || null,
      getCounts: () => (sim.state ? { notes: sim.notes, shots: sim.shots, shortcut: sim.shortcut, expected: sim.expected, noteTypes: sim.noteTypes, marks: sim.marks, buffer: sim.buffer } : null),
      // the names the existing engine uses, in case T1 reuses them
      qawState: () => sim.state || null,
      qawCounts: () => (sim.state ? { notes: sim.notes, shots: sim.shots, shortcut: sim.shortcut, expected: sim.expected, noteTypes: sim.noteTypes, marks: sim.marks, buffer: sim.buffer } : null),
    });
    rig.page = { ...dom, root, trial, view };
    rig.pages.push(rig.page);
    if (o.calm) trial.setCalm(true);
    for (const type of EVENT_TYPES) trial.on(type, (p = {}) => onEvent(type, p));
    sync();
    return rig.page;
  }

  function onEvent(type, p) {
    const e = { ...p, pt: p.t, pattempt: p.attempt, t: clock.now(), rel: rel(), attempt: rig.attempt, type };
    if (type === 'trial:room' && p.room === 1) {
      rig.attempt += 1; rig.t0 = clock.now(); e.attempt = rig.attempt; e.rel = 0;
      const script = o.scripts ? o.scripts(rig.attempt) : null;
      if (script) for (const a of script) rig.actionTimers.push(clock.setTimeout(() => perform(a), ms(a.at)));
    }
    rig.events.push(e);
    if (type === 'trial:death') rig.lastDeathAt = clock.now();
    if (type === 'trial:clear') rig.done = true;
  }

  function reload() {
    rig.reloadPending = false;
    // a page load: the bridge forgets "ever recorded", and Expected / Buffer start again at 0; the other counts are the last session's
    sim.ever = sim.state === 'recording';
    if (sim.state === 'stopped') sim.state = 'ready';
    sim.expected = 0; sim.buffer = 0;
    const p = newPage();
    rig.busy += 1;
    (async () => {
      // what game.js / trial-ui.js do on a page load: resume from the cover when there is one, else open the stage
      const restored = await p.trial.restoreRestart();
      if (!restored) {
        rig.lastOpen = await p.trial.open(n);
        if (statusOf(p.view()) === 'card') p.trial.begin();
      }
    })().catch((e) => rig.errors.push('reload: ' + e.message)).finally(() => { rig.busy -= 1; });
  }

  function perform(a) {
    const lag = (d) => (a.lag ?? d);
    const fast = lag(lagFast); const slow = lag(lagSlow);
    switch (a.kind) {
      case 'shortcut': later(a.lagState ?? lagFast, sessionStart); later(Math.max((a.lagCount ?? lagSlow), (a.lagState ?? lagFast) + 0.001), () => rig.set({ shortcut: sim.shortcut + 1 })); break;
      case 'popupStart': later(a.lagState ?? lagFast, sessionStart); break;
      case 'buffer': later(a.lagState ?? fast, () => { sessionStart(); rig.set({ buffer: sim.buffer + 1 }); }); break;
      case 'shot': later(slow, () => rig.set({ shots: sim.shots + 1 })); break;
      case 'note': later(slow, () => rig.set({ notes: sim.notes + 1 })); break;
      case 'markup': later(slow, () => rig.set({ marks: sim.marks + 1 })); break;
      case 'notbug': later(a.lag ?? 0.05, () => rig.set({ expected: sim.expected + 1 })); break;
      case 'stop': later(a.lagState ?? fast, () => rig.set({ state: 'stopped' })); break;
      case 'click': { const el = rig.page.doc.querySelector(a.sel); if (!el) rig.missing.push(`${a.sel} @${rel()}`); else el.click(); break; }
      case 'paste': {
        const word = a.word ?? rig.orderWord();
        rig.page.trial.pasteText(a.text ?? makeReport({ word: a.stale ? 'staleword' : word }));
        break;
      }
      case 'pause': rig.page.trial.pause(); break;
      case 'resume': rig.page.trial.resume(); break;
      case 'fn': a.fn(rig); break;
      default: throw new Error('unknown action kind ' + a.kind);
    }
  }
  rig.perform = perform;
  rig.orderWord = () => { const f = [...rig.fetches].reverse().find((x) => x.path.startsWith('/api/orders/')); return f ? f.path.slice('/api/orders/'.length) : WORDS[0]; };

  rig.hide = (hidden) => { const d = rig.page.doc; d.hidden = hidden; d.visibilityState = hidden ? 'hidden' : 'visible'; d.dispatchEvent(new FEvent('visibilitychange', { bubbles: false })); rig.page.win.dispatchEvent(new FEvent(hidden ? 'blur' : 'focus')); };

  const flush = () => new Promise((r) => setImmediate(r));
  rig.flush = flush;
  /** Advance virtual time (50 ms steps); yields to the event loop while a page reload is still starting up. */
  rig.run = async (sec) => { let left = ms(sec); while (left > 0) { const d = Math.min(left, 50); clock.advance(d); left -= d; if (rig.busy) await flush(); } };
  /** Advance in 50 ms steps until pred() or maxSec of virtual time; returns whether pred held. */
  rig.until = async (pred, maxSec = 200, step = 0.05) => { for (let i = 0; i < maxSec / step; i++) { if (pred()) return true; clock.advance(ms(step)); if (rig.busy) await flush(); } return pred(); };
  rig.start = async () => {
    const p = newPage();
    rig.lastOpen = await p.trial.open(n);
    if (o.begin !== false && statusOf(p.view()) === 'card') p.trial.begin();
    return p;
  };
  rig.ev = (type) => rig.events.filter((e) => e.type === type);
  rig.deaths = () => rig.ev('trial:death');
  rig.clears = () => rig.ev('trial:clear');
  rig.attemptEvents = (k, type) => rig.events.filter((e) => e.attempt === k && (!type || e.type === type));
  rig.tellsOf = (k) => rig.attemptEvents(k, 'trial:tell').map((e) => ({ cls: clsOf(e.cls), rel: e.rel }));
  Object.defineProperty(rig, 'view', { get: () => rig.page?.view() });
  rig.destroy = () => { try { rig.page?.trial.destroy?.(); } catch { /* gone */ } };
  return rig;
}

/** fetch calls of attempt k with seconds on the stage clock (needs the attempt's t0, kept from the room-1 event). */
export function fetchTimeline(rig, k = 0) {
  const t0 = rig.events.find((e) => e.type === 'trial:room' && e.room === 1 && e.attempt === k)?.t;
  return rig.fetches.filter((f) => f.attempt === k && t0 !== undefined).map((f) => ({ method: f.method, path: f.path, status: f.status, sec: (f.t - t0) / 1000 }));
}
export function roomTimeline(rig, k = 0) {
  const t0 = rig.events.find((e) => e.type === 'trial:room' && e.room === 1 && e.attempt === k)?.t;
  return rig.events.filter((e) => e.type === 'trial:room' && e.attempt === k).map((e) => ({ room: e.room, sec: (e.t - t0) / 1000 }));
}

/** Run one attempt of stage n with a script until death or clear (or maxSec of stage time). Returns { rig, death, clear }. */
export async function playOnce(n, script, { maxSec = 140, rigOpts = {} } = {}) {
  const rig = await makeRig({ n, ...rigOpts, scripts: (k) => (k === 0 ? script : null) });
  await rig.start();
  await rig.until(() => rig.deaths().length > 0 || rig.clears().length > 0, maxSec + 5);
  return { rig, death: rig.deaths()[0] || null, clear: rig.clears()[0] || null };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Text scans shared by the static suites                                                                                  */
export const FORBIDDEN_TOKENS = /streak|daily|freeze|flame|combo|leaderboard|notification|alarm|Math\.random/i;
/** Words that make a line advice. EN and AR. Applied to in-run strings only (trial.shop.*, trial.deaths, trial.pause.note, trial.paste.*, trial.death.again, trial.door.closed). */
export const HINT_WORDS_EN = /\b(hint|tip|clue|try|should|must|remember|careful|watch out|wait for|press|click|tap|hurry|quick|now|don't|do not|need|needs|skip|voice|listen)\b/i;
export const HINT_WORDS_AR = /تلميح|نصيحة|دليل|جرّ?ب|يجب|تذكّ?ر|انتبه|احذر|اضغط|انقر|الآن|بسرعة|لا تضغط|تحتاج|تخطّ|تخطي|صوت|استمع/;
/** The keys a trial run can paint (chrome of the card, attunement and clear dialog is allowed to explain controls). */
export const inRunKey = (k) => /^trial\.(shop\.|deaths$|pause\.note$|paste\.|death\.again$|door\.closed$|name\.)/.test(k);
export const BANNED_TERMS = /photograph|harvest|\barm(ed)?\b|crosshair|Stop &|Stop \+/i;

/** Every text file under game/ (binaries skipped) as [rel, source]. */
export function gameSources(dir = GAME, base = GAME) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...gameSources(full, base));
    else if (/\.(?:m?js|css|html|json|svg)$/.test(e.name)) out.push([path.relative(base, full).replace(/\\/g, '/'), fs.readFileSync(full, 'utf8')]);
  }
  return out;
}
export const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** The trial's own source files (trial.js, trial-ui.js, trials/*.js, trial.css). */
export const trialSources = () => gameSources().filter(([f]) => /^(trial[\w-]*\.(?:m?js|css)|trials\/.+\.m?js)$/.test(f));

/** Sliding-window rate: the largest number of timestamps (ms) inside any window of `winMs`. */
export function maxRate(stamps, winMs = 1000) {
  const s = [...stamps].sort((a, b) => a - b); let best = 0; let j = 0;
  for (let i = 0; i < s.length; i++) { while (s[i] - s[j] >= winMs) j++; best = Math.max(best, i - j + 1); }
  return best;
}
