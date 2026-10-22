/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * D-1010-86 (r4-01-2): the in-page UI restores itself 30 s after the last hide.
 *
 * content/ui-host.js is run in a vm against a small DOM stub and fake timers. If the worker dies
 * between `UQA_UI_HIDE hidden:true` and `hidden:false` (a full-page capture, a scan), nothing would
 * un-hide the recording bar until a reload. The watchdog is armed by each hide, re-armed by the next
 * one, and cleared by the un-hide; background/fullpage.js re-sends the hide for every tile.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(EXT, 'content', 'ui-host.js'), 'utf8');
const FULLPAGE = fs.readFileSync(path.join(EXT, 'background', 'fullpage.js'), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

function boot() {
  // fake timers: nothing runs until tick() says time passed
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const fakeSetTimeout = (fn, ms = 0) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; };
  const fakeClearTimeout = (id) => { timers.delete(id); };
  const tick = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    now = end;
  };
  const el = () => ({
    style: { cssText: '', display: '' }, children: [], isConnected: true, parentNode: null,
    attrs: {}, textContent: '', className: '',
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute() {}, getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    remove() { const i = this.parentNode?.children.indexOf(this) ?? -1; if (i >= 0) this.parentNode.children.splice(i, 1); this.isConnected = false; },
    attachShadow() { return { children: [], appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, querySelector() { return null; }, querySelectorAll() { return []; } }; },
    querySelector() { return null; },
  });
  const body = el();
  const listeners = [];
  const win = {
    chrome: {
      runtime: {
        id: 'ext',
        lastError: null,
        onMessage: { addListener(fn) { listeners.push(fn); } },
        sendMessage(_m, cb) { cb?.(null); },
      },
    },
    document: {
      body, documentElement: body, hidden: false, fullscreenElement: null,
      createElement: el, querySelectorAll: () => [], addEventListener() {},
    },
    MutationObserver: class { observe() {} },
    requestAnimationFrame: (fn) => fakeSetTimeout(fn, 16),
    getComputedStyle: () => ({}), addEventListener() {}, removeEventListener() {},
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    console, Promise, Set, Map, Object, Array, String, Number, JSON, Math, Date, Error, RegExp,
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: 'content/ui-host.js' });
  const hide = (hidden) => { let reply; listeners[0]({ type: 'UQA_UI_HIDE', hidden }, { id: 'ext' }, (r) => { reply = r; }); tick(200); return reply; };
  const host = () => body.children.find((c) => c.style.cssText.includes('position:fixed'));
  return { hide, tick, host, win };
}

console.log('ui-host — the restore watchdog');

test('a hide that is never undone restores the UI after 30 s', () => {
  const e = boot();
  e.hide(true);
  assert.equal(e.host().style.display, 'none');
  e.tick(29000);
  assert.equal(e.host().style.display, 'none', 'restored too early');
  e.tick(1500);
  assert.equal(e.host().style.display, '', 'the UI never came back');
});

test('each hide re-arms the timer: a capture that keeps hiding is not cut short', () => {
  const e = boot();
  e.hide(true);
  e.tick(25000);
  e.hide(true); // the next tile
  e.tick(25000);
  assert.equal(e.host().style.display, 'none', 'the second hide did not re-arm the 30 s');
  e.tick(6000);
  assert.equal(e.host().style.display, '');
});

test('an un-hide clears the timer, and a later hide arms a fresh one', () => {
  const e = boot();
  e.hide(true);
  e.hide(false);
  assert.equal(e.host().style.display, '');
  e.tick(60000);
  assert.equal(e.host().style.display, '');
  e.hide(true);
  e.tick(31000);
  assert.equal(e.host().style.display, '');
});

test('D-1010-111: the live region exists, empty, before flash(); the toast is aria-hidden; the text arrives a frame later and survives clearUi', () => {
  const e = boot();
  const H = e.win.UQAUiHost;
  const root = H.uiRoot();
  const region = root.children.find((c) => c.attrs['aria-live'] === 'polite');
  assert.ok(region, 'no polite live region was created with the root');
  assert.equal(region.attrs.role, 'status');
  assert.equal(region.textContent, '', 'the region must be empty at load');
  H.flash('Saved');
  assert.equal(region.textContent, '', 'the text is set in the next frame, not in the same tick');
  const toast = root.children.find((c) => c !== region && /uqa-toast/.test(c.className));
  assert.ok(toast, 'the visual toast was not drawn');
  assert.equal(toast.attrs['aria-hidden'], 'true');
  assert.equal(toast.attrs.role, undefined, 'the toast must not carry a live role of its own');
  e.tick(20);
  assert.equal(region.textContent, 'Saved');
  H.clearUi();
  assert.ok(root.children.includes(region), 'clearUi must leave the live region in place');
  H.announce('Updated');
  e.tick(20);
  assert.equal(region.textContent, 'Updated');
});

test('fullpage.js re-sends the hide for each tile, before it scrolls', () => {
  const at = FULLPAGE.indexOf("type: 'UQA_UI_HIDE', hidden: true");
  const scroll = FULLPAGE.indexOf('const y = await inPage(tabId, SCROLL_TO');
  assert.ok(at > -1 && scroll > at, 'the tile loop does not re-send UQA_UI_HIDE before SCROLL_TO');
  assert.ok(FULLPAGE.indexOf('for (let i = 0; i < tileCount; i++) {') < at, 'the hide is outside the per-tile loop');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
