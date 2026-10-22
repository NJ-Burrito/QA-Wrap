/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt lane B test kit: a fake clock with timers, a tiny fake DOM (just what the level modules touch), a mini runner.
 * Node only. Used by test-game-b-engine.mjs, test-game-b-levels.mjs and test-game-b-server.mjs.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXT } from './lib-paths.mjs';

export const GAME_DIR = path.join(EXT, 'game');
export const imp = (rel) => import(pathToFileURL(path.join(GAME_DIR, rel)).href);

export function runner(title) {
  let passed = 0;
  const failures = [];
  console.log(`\n${title}`);
  return {
    async test(name, fn) {
      try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err && err.message}`); }
    },
    done() {
      console.log(`\n${passed} passed, ${failures.length} failed`);
      if (failures.length) { console.log(`FAILED: ${failures.join(' | ')}`); process.exitCode = 1; }
    },
  };
}

/** Fake clock: now(), timers that fire in order when advance(ms) runs (also timers set by callbacks). */
export function fakeClock(t0 = 1000) {
  let t = t0; let seq = 0;
  const timers = new Map();
  const add = (fn, ms, every) => { const id = ++seq; timers.set(id, { fn, at: t + ms, every, ms }); return id; };
  const clock = {
    now: () => t,
    setTimeout: (fn, ms) => add(fn, ms, false),
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms) => add(fn, ms, true),
    clearInterval: (id) => { timers.delete(id); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next.x.at)) next = { id, x };
        if (!next) break;
        t = next.x.at;
        if (next.x.every) next.x.at += next.x.ms; else timers.delete(next.id);
        next.x.fn();
      }
      t = end;
    },
    pending: () => timers.size,
  };
  return clock;
}

export function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, writes: () => [...m.entries()] };
}

/* ---- a tiny DOM: elements with attributes, children, listeners, closest/contains/querySelector for the selectors the levels use */
class Text { constructor(s) { this.textContent = s; this.parentNode = null; } }
export class FakeEl {
  constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.attrs = {}; this.children = []; this.parentNode = null; this.listeners = {}; this.value = ''; this._text = ''; this.scrollWidth = 0; this.clientWidth = 0; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  append(...kids) { for (const k of kids) { k.parentNode = this; this.children.push(k); } }
  replaceChildren() { this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
  set textContent(v) { this.children = []; this._text = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ||= new Set()).add(fn); }
  removeEventListener(type, fn) { this.listeners[type]?.delete(fn); }
  contains(el) { for (let n = el; n; n = n.parentNode) if (n === this) return true; return false; }
  matches(sel) {
    if (sel[0] === '#') return this.attrs.id === sel.slice(1);
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (m) return m[1] in this.attrs && (m[2] === undefined || this.attrs[m[1]] === m[2]);
    return false;
  }
  closest(sel) { for (let n = this; n && n.matches; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelector(sel) { for (const c of this.children) { if (c.matches && c.matches(sel)) return c; const r = c.querySelector && c.querySelector(sel); if (r) return r; } return null; }
  /** Dispatch a click/other event at this element, bubbling to every ancestor listener. */
  fire(type, extra = {}) {
    const e = { type, target: this, ...extra };
    for (let n = this; n; n = n.parentNode) for (const fn of [...(n.listeners?.[type] || [])]) fn(e);
    return e;
  }
}
export function fakeDoc() {
  const doc = { createElement: (tag) => new FakeEl(tag, doc), createTextNode: (s) => new Text(s), documentElement: { dataset: {} }, listeners: {}, hidden: false };
  doc.addEventListener = (type, fn) => { (doc.listeners[type] ||= new Set()).add(fn); };
  doc.removeEventListener = (type, fn) => { doc.listeners[type]?.delete(fn); };
  doc.dispatch = (type) => { for (const fn of [...(doc.listeners[type] || [])]) fn({ type }); };
  return doc;
}
export function fakeWin() {
  const win = { listeners: {} };
  win.addEventListener = (type, fn) => { (win.listeners[type] ||= new Set()).add(fn); };
  win.removeEventListener = (type, fn) => { win.listeners[type]?.delete(fn); };
  win.dispatch = (type, extra = {}) => { for (const fn of [...(win.listeners[type] || [])]) fn({ type, ...extra }); };
  // Like the real window: an ErrorEvent can be dispatched (no exception is thrown, so no uncaught row on chrome://extensions Errors).
  win.ErrorEvent = class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } };
  win.dispatchEvent = (e) => { win.dispatched = (win.dispatched || 0) + 1; win.dispatch(e.type, e); return true; };
  win.location = { href: 'chrome-extension://x/practice/practice.html' };
  return win;
}
/** Find an element by id anywhere under root. */
export const byId = (root, id) => root.querySelector(`#${id}`);
export const tKey = (k) => k;
