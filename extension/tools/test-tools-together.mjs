/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The five tools on one page at once.
 *
 * E11: "features must not collide with or deny each other (mask + record +
 * values + nasty + locator on one page); add a test that runs them together."
 *
 * Most of them do not collide and must not be made to: a mask is *data*, a
 * recording is a stream, layout stress is a stylesheet. All three can be true
 * at the same time and a tester filming a masked page is the normal case, not
 * an edge one.
 *
 * The collision is between the four tools that take the **pointer**. Masking,
 * the locator picker and the field picker each add a capture-phase `click`
 * listener that calls `preventDefault()` and `stopImmediatePropagation()`, and
 * each puts its own cursor on `<html>`. Two of them armed at once is a page
 * where one tool eats the other's click, and which one wins depends on the
 * order two buttons happened to be pressed in. `claimPointer()` in
 * `content/ui-host.js` is the rule; this is the test that the three scripts
 * actually obey it, run together, in one document, through their real message
 * listeners.
 *
 * The four content scripts are executed here for real rather than lifted
 * function by function, because what is being tested is what happens *between*
 * them. The DOM below is a stub with only the calls these four make; anything
 * missing throws rather than answering undefined, so a stub that has drifted
 * away from the code fails loudly instead of quietly passing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const read = (file) => fs.readFileSync(path.join(EXT, 'content', file), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/* ── the page ───────────────────────────────────────────────────────────── */

class Node_ {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentElement = null;
    this.attrs = new Map();
    this.style = new Proxy({ cssText: '' }, { set: (t, k, v) => { t[k] = v; return true; } });
    this.dataset = {};
    this.classes = new Set();
    this.listeners = new Map();
    this.own = '';
    this.shadow = null;
    this.isConnected = true;
  }

  get classList() {
    const set = this.classes;
    return {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
      toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
    };
  }

  get className() { return [...this.classes].join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get id() { return this.attrs.get('id') || ''; }
  get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.own = String(v); this.children = []; }
  set innerHTML(v) { this.own = String(v); this.children = []; }

  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  getBoundingClientRect() { return { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 }; }
  focus() {}
  append(...kids) { for (const k of kids) { k.parentElement = this; this.children.push(k); } }
  appendChild(k) { this.append(k); return k; }
  remove() {
    const p = this.parentElement;
    if (p) p.children = p.children.filter((c) => c !== this);
    this.parentElement = null;
    this.isConnected = false;
  }
  contains(other) { for (let n = other; n; n = n.parentElement) if (n === this) return true; return false; }
  getRootNode() { return document; }
  attachShadow() { this.shadow = new Node_('#shadow'); this.shadow.host = this; return this.shadow; }
  addEventListener(type, fn) { (this.listeners.get(type) || this.listeners.set(type, []).get(type)).push(fn); }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((f) => f !== fn));
  }

  matches(selector) { return selectorMatches(selector, this); }
  closest(selector) { for (let n = this; n; n = n.parentElement) if (selectorMatches(selector, n)) return n; return null; }
  querySelectorAll(selector) {
    const out = [];
    const walk = (n) => { for (const k of n.children) { if (selectorMatches(selector, k)) out.push(k); walk(k); } };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

/** Tag names, `[attr]`, `[attr="v"]`, `.class`, and comma lists of those. */
function selectorMatches(selector, el) {
  return String(selector).split(',').map((s) => s.trim()).filter(Boolean).some((part) => {
    if (part === '*') return true;
    const attr = part.match(/^\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]$/);
    if (attr) return attr[2] === undefined ? el.hasAttribute(attr[1]) : el.getAttribute(attr[1]) === attr[2];
    if (part.startsWith('.')) return el.classes.has(part.slice(1));
    if (part.startsWith('input')) return el.tagName === 'INPUT';
    return el.tagName === part.toUpperCase();
  });
}

const html = new Node_('html');
const body = new Node_('body');
html.append(body);

const docListeners = new Map();
const document = {
  documentElement: html,
  body,
  activeElement: body,
  createElement: (tag) => new Node_(tag),
  createElementNS: (_ns, tag) => new Node_(tag),
  querySelectorAll: (s) => html.querySelectorAll(s),
  querySelector: (s) => html.querySelector(s),
  elementFromPoint: () => null,
  elementsFromPoint: () => [],
  addEventListener: (t, fn) => { if (!docListeners.has(t)) docListeners.set(t, []); docListeners.get(t).push(fn); },
  removeEventListener: (t, fn) => docListeners.set(t, (docListeners.get(t) || []).filter((f) => f !== fn)),
  execCommand: () => true,
};

/* ── the extension's own world ──────────────────────────────────────────── */

/** Every listener the four scripts register, in the order they registered. */
const messageListeners = [];
const chrome = {
  runtime: {
    // The four scripts now check `sender.id` against this before they act on
    // anything, so the stub has to have one. See `deliver()` below.
    id: 'uqa-test-extension-id',
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    getURL: (p) => `chrome-extension://test/${p}`,
  },
};

/**
 * Deliver one message the way Chrome does: to every listener, in order.
 *
 * The count of listeners that answered is the assertion that matters. Two
 * scripts answering the same message is a collision of a quieter kind than two
 * crosshairs, and a harder one to find by hand.
 */
function deliver(msg, sender = { id: chrome.runtime.id }) {
  const answers = [];
  for (const fn of messageListeners) {
    let replied = null;
    const took = fn(msg, sender, (res) => { replied = res ?? true; });
    if (took === true) answers.push(replied);
  }
  return answers;
}

const win = {
  addEventListener: () => {},
  removeEventListener: () => {},
  UQABridge: { send: async () => ({ ok: true, result: { masks: [] } }), emit: () => {} },
  UQASelector: {
    cssPath: (el) => el.tagName.toLowerCase(),
    describe: () => ({ playwright: "page.getByRole('button')", locator: "getByRole('button')", strategy: 'role', matches: 1, ambiguous: false, alternatives: [] }),
    accessibleName: () => '',
    framePrefix: () => ({ prefix: '', crossOrigin: false, depth: 0 }),
  },
  UQASound: { play: () => {} },
};

/*
 * This page is the top frame, and says so.
 *
 * `picker.js` asks the worker to build its frameLocator chain, and routes its
 * copies through the worker, only when it is *not* the top frame. Leaving
 * `window.top` undefined made the stub a frame inside something that does not
 * exist here, so both of those fired against a chrome stub that knows nothing
 * about them. The five tools this file is about all run in the top frame; the
 * frame case has a suite of its own in `test-frames.mjs`.
 */
win.top = win;

const globals = {
  window: win,
  document,
  chrome,
  location: { href: 'https://app.test/apply' },
  navigator: { clipboard: { writeText: async () => {} } },
  CSS: { escape: (s) => s },
  MutationObserver: class { observe() {} disconnect() {} },
  getComputedStyle: () => ({ display: 'block' }),
  addEventListener: (t, fn) => document.addEventListener(t, fn),
  removeEventListener: (t, fn) => document.removeEventListener(t, fn),
  innerWidth: 1280,
  innerHeight: 800,
  fetch: async () => ({ text: async () => '' }),
  HTMLInputElement: function () {},
  HTMLTextAreaElement: function () {},
  Event: class { constructor(type) { this.type = type; } },
  InputEvent: class { constructor(type) { this.type = type; } },
  setTimeout: (fn) => { void fn; return 0; },
  console,
};

function run(file) {
  const src = read(file);
  const names = Object.keys(globals);
  new Function(...names, src)(...names.map((n) => globals[n]));
}

// The order the manifest declares them in. `ui-host.js` first, because the
// other three ask it for a layer the moment they start.
run('ui-host.js');
run('mask.js');
run('picker.js');
run('data-injector.js');

const host = () => win.UQAUiHost.pointerHolder();

/* ── the tests ──────────────────────────────────────────────────────────── */

console.log('five tools on one page');

test('all four scripts loaded into the same page without treading on each other', () => {
  assert.ok(win.UQAUiHost, 'ui-host did not publish itself');
  assert.ok(win.UQAMask, 'mask.js did not publish itself');
  assert.ok(win.UQAPicker, 'picker.js did not publish itself');
  assert.ok(win.UQAInjector, 'data-injector.js did not publish itself');
  assert.equal(messageListeners.length, 4, `expected four message listeners, got ${messageListeners.length}`);
});

test('exactly one script answers each message', () => {
  // A script that answers a message it does not own is a race: Chrome takes
  // the first reply, and which one that is depends on injection order.
  /*
   * The sender the stub passes is the one these scripts really hear: this
   * extension's own service worker, which has an `id` and is not a tab. Until
   * 8 September 2026 they acted on any message at all, including one from
   * another extension installed beside QA Wrap, which is what
   * `tools/test-sender-checks.mjs` now refuses across the whole tree. Here the
   * two rejected senders are exercised through the real listeners, because a
   * guard that is present and wrong looks exactly like a guard that works.
   */
  for (const type of ['UQA_MASK_PICK', 'UQA_ACTIVATE_PICKER', 'UQA_INJECT', 'UQA_FLASH']) {
    const answers = deliver({ type });
    assert.equal(answers.length, 1, `${type} was answered by ${answers.length} scripts`);
  }
  // And the crosshairs those presses left armed are put away again.
  deliver({ type: 'UQA_MASK_PICK', off: true });
  deliver({ type: 'UQA_ACTIVATE_PICKER', off: true });
});

test('nothing answers a message no tool owns', () => {
  assert.deepEqual(deliver({ type: 'UQA_SOMETHING_ELSE' }), []);
});

test('another extension is answered by nobody', () => {
  for (const type of ['UQA_MASK_PICK', 'UQA_ACTIVATE_PICKER', 'UQA_INJECT', 'UQA_FLASH']) {
    const answers = deliver({ type }, { id: 'some-other-extension' });
    assert.equal(answers.length, 0, `${type} was answered to a message from another extension`);
  }
});

test('a message that arrives with a tab on it is refused', () => {
  for (const type of ['UQA_MASK_PICK', 'UQA_ACTIVATE_PICKER', 'UQA_INJECT', 'UQA_FLASH']) {
    const answers = deliver({ type }, { id: chrome.runtime.id, tab: { id: 1 } });
    assert.equal(answers.length, 0,
      `${type} was answered to a message that did not come from the service worker`);
  }
});

console.log('\nthe pointer, which only one tool may hold');

test('masking takes the pointer', () => {
  deliver({ type: 'UQA_MASK_PICK' });
  assert.equal(host(), 'mask');
  assert.equal(html.classes.has('uqa-masking'), true);
});

test('the locator picker takes it off masking, and masking stands down cleanly', () => {
  deliver({ type: 'UQA_ACTIVATE_PICKER' });
  assert.equal(host(), 'locator', 'two crosshairs are armed at once');
  assert.equal(html.classes.has('uqa-masking'), false, 'the masking cursor is still on the page');
  assert.equal(html.classes.has('uqa-picking'), true);
});

test('the field picker takes it off the locator', () => {
  deliver({ type: 'UQA_INJECT' });
  assert.equal(host(), 'field');
  assert.equal(html.classes.has('uqa-picking'), false, 'the locator cursor is still on the page');
  assert.equal(html.classes.has('uqa-injecting'), true);
});

test('masking takes it back, and the field cursor goes', () => {
  deliver({ type: 'UQA_MASK_PICK' });
  assert.equal(host(), 'mask');
  assert.equal(html.classes.has('uqa-injecting'), false);
});

test('a mask that has already been made is data, not a mode, and survives all of it', () => {
  const cell = new Node_('td');
  cell.own = 'Ahmad Al Zaghloul';
  body.append(cell);
  deliver({ type: 'UQA_MASK_APPLY', masks: [{ id: 'm1', path: 'td', index: 0, name: 'Ahmad Al Zaghloul', tag: 'td' }] });
  assert.equal(cell.hasAttribute('data-uqa-masked'), true);

  // Every other pointer tool, in turn. None of them may uncover anything.
  deliver({ type: 'UQA_ACTIVATE_PICKER' });
  deliver({ type: 'UQA_INJECT' });
  deliver({ type: 'UQA_MASK_PICK' });
  assert.equal(
    cell.hasAttribute('data-uqa-masked'),
    true,
    'arming another tool uncovered a masked value, which is the one thing masking promises will not happen'
  );
  assert.equal(win.UQAMask.count(), 1, 'the session lost the mask when another tool was armed');
});

test('the locator picker refuses a masked element even while masking is not the armed tool', () => {
  // The two features are live at the same time on purpose: a tester masks a
  // column and then collects locators for the buttons beside it.
  const cell = document.querySelector('td');
  assert.equal(win.UQAMask.isMasked(cell), true);
  assert.equal(win.UQAMask.leaks("getByText('Ahmad Al Zaghloul')"), true);
});

console.log('\nsleep, which has to end all of it at once');

test('the sleep sweep puts every crosshair away, whichever one was armed', () => {
  // background/service-worker.js sends these three on sleep. `off` is a stop
  // and never a toggle, precisely so a sweep cannot start what it meant to end.
  deliver({ type: 'UQA_MASK_PICK', off: true });
  deliver({ type: 'UQA_ACTIVATE_PICKER', off: true });
  assert.equal(host(), null, `${host()} still holds the pointer after the sleep sweep`);
  assert.equal(html.classes.has('uqa-masking'), false);
  assert.equal(html.classes.has('uqa-picking'), false);
});

test('sending the sweep twice is still a stop, not a start', () => {
  deliver({ type: 'UQA_MASK_PICK', off: true });
  deliver({ type: 'UQA_ACTIVATE_PICKER', off: true });
  assert.equal(host(), null, 'a second sweep armed a crosshair in a window that was going to sleep');
});

test('clearing the masks clears the paint as well as the list', () => {
  const cell = document.querySelector('td');
  deliver({ type: 'UQA_MASK_CLEAR' });
  assert.equal(cell.hasAttribute('data-uqa-masked'), false);
  assert.equal(win.UQAMask.count(), 0);
});

console.log('\nthe tools that share the page without sharing the pointer');

test('recording and layout stress are not pointer tools and are never stood down', () => {
  // Stated as a rule rather than trusted: if a future edit routes the recorder
  // or the RTL toggle through claimPointer(), pressing the locator picker would
  // silently stop a recording, which is the worst possible collision.
  const uiHost = read('ui-host.js');
  const claims = [...read('mask.js').matchAll(/claimPointer\?\.\('(\w+)'/g)]
    .concat([...read('picker.js').matchAll(/claimPointer\?\.\('(\w+)'/g)])
    .concat([...read('data-injector.js').matchAll(/claimPointer\?\.\('(\w+)'/g)])
    .map((m) => m[1]);
  assert.deepEqual(claims.sort(), ['field', 'locator', 'mask']);
  assert.match(uiHost, /function claimPointer\(/, 'the rule has no home');
  for (const file of ['recorder.js', 'rtl-stress.js']) {
    assert.ok(
      !read(file).includes('claimPointer'),
      `${file} claims the pointer: pressing a picker would stop it`
    );
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
