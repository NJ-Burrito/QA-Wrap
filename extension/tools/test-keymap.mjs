/* T-014: a refused note keeps the composer and the typed text; no success flash. node tools/test-keymap.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../content/keymap.js', import.meta.url), 'utf8');

function run(reply) {
  const flashes = [];
  let removed = false;
  const els = [];
  const mk = (tag) => {
    const el = { tag, value: '', children: [], listeners: {}, focused: 0, isConnected: true,
      append(...c) { this.children.push(...c); }, remove() { removed = true; this.isConnected = false; },
      addEventListener(n, f) { this.listeners[n] = f; }, focus() { this.focused++; },
      querySelector() { return input; }, className: '', type: '', placeholder: '', textContent: '' };
    els.push(el); return el;
  };
  let input;
  const box = mk('box');
  const document = { createElement: (t) => { const e = mk(t); if (t === 'input') input = e; return e; }, addEventListener() {} };
  const window = { UQAUiHost: { uiLayer: () => box, flash: (m, k) => flashes.push([m, k || 'ok']), t: undefined },
    UQABridge: { send: async () => reply } };
  window.window = window;
  vm.runInNewContext(src, { window, document });
  window.UQAKeymap.promptNote();
  input.value = 'my precious words';
  return { input, flashes, isRemoved: () => removed, enter: async () => { input.listeners.keydown({ key: 'Enter', stopPropagation() {} }); await new Promise((r) => setTimeout(r, 5)); } };
}

const refused = run({ ok: false, error: 'Start a session before adding notes.' });
await refused.enter();
assert.equal(refused.isRemoved(), false, 'composer must survive a refusal');
assert.equal(refused.input.value, 'my precious words', 'typed text must survive');
assert.ok(refused.flashes.every(([, k]) => k === 'err'), 'no success flash on refusal');
assert.match(refused.flashes[0][0], /Start a session before adding notes/);

const silent = run(null);
await silent.enter();
assert.equal(silent.isRemoved(), false);
assert.equal(silent.flashes[0][1], 'err');

const ok = run({ ok: true, result: { stored: true } });
await ok.enter();
assert.equal(ok.isRemoved(), true);
assert.equal(ok.flashes[0][1], 'ok');

// D-1010-90: only a trusted key event runs a shortcut, and inject calls the injector directly (no page-visible event).
{
  let keydown;
  const calls = [];
  const document = { createElement() { return {}; }, addEventListener: (n, f) => { if (n === 'keydown') keydown = f; } };
  const window = { UQASettings: { keymap: { inject: 'Alt+KeyI', bar: 'Alt+KeyB' } }, UQAAwake: true,
    UQAInjector: { triggerFromKeymap: () => calls.push('inject') }, UQABar: { focusBar: () => calls.push('bar') },
    dispatchEvent: () => calls.push('page-event') };
  window.window = window;
  vm.runInNewContext(src, { window, document, CustomEvent: class {} });
  const ev = (isTrusted, code) => ({ isTrusted, altKey: true, code, target: { tagName: 'DIV' }, preventDefault() {}, stopPropagation() {} });
  keydown(ev(false, 'KeyI'));
  keydown(ev(false, 'KeyB'));
  assert.deepEqual(calls, [], 'an untrusted keydown sends and runs nothing');
  keydown(ev(true, 'KeyI'));
  keydown(ev(true, 'KeyB'));
  assert.deepEqual(calls, ['inject', 'bar'], 'a trusted keydown runs the action, inject without a page event');
}
console.log('keymap: untrusted keydown ignored');

// T-015: the toolbar-command handler catches and says it loudly
const sw = fs.readFileSync(new URL('../background/service-worker.js', import.meta.url), 'utf8');
const i = sw.indexOf("on(chrome.commands?.onCommand");
const body = sw.slice(i, sw.indexOf('\n});\n', i));
assert.match(body, /try \{\n  if \(command === 'toggle-recording'\)/);
assert.match(body, /catch \(err\) \{\n    await sayLoudly\(tabId,/);
// Now-review fault 8: run the real handler with a throwing implementation per command; each must reach sayLoudly with the reason.
{
  const handlerSrc = `${body.slice(body.indexOf('async (command, tab)'))}\n}`;
  for (const command of ['toggle-recording', 'pick-element', 'toggle-rtl', 'inject-data']) {
    const said = [];
    const boom = async () => { throw new Error(`boom ${command}`); };
    const make = new Function('env', `const { TESTABLE, isInternalUrl, testableTabId, noteInvoked, armed, sayLoudly, activeSessionId, stopSession, startSession, handlers, chrome, recordingState, tw, refusalText, commandLabel } = env; return (${handlerSrc});`);
    const handler = make({
      TESTABLE: /^https?:/, isInternalUrl: () => false, testableTabId: async () => 7, noteInvoked: async () => {}, armed: { isArmedTab: async () => true, ASLEEP: 'asleep' },
      sayLoudly: async (id, text) => { said.push([id, text]); }, activeSessionId: async () => (command === 'toggle-recording' ? 's1' : null),
      tw: async (_k, en) => en, commandLabel: async (c) => c, refusalText: async (e) => String(e?.message || e), stopSession: boom, startSession: boom, recordingState: async () => ({ recording: false }),
      handlers: { UQA_PICK: boom, UQA_TOGGLE_RTL: boom, UQA_INJECT: boom }, chrome: { tabs: { query: async () => [{ id: 7, url: 'https://a.test/' }] } },
    });
    await handler(command, { id: 7, url: 'https://a.test/' });
    assert.equal(said.length, 1, `${command}: a throwing handler produced one visible message`);
    assert.match(said[0][1], new RegExp(`${command} failed\. boom ${command}`), `${command}: the message names the command and the reason`);
  }
}
// T-015: the failure line is a catalogue pair (en + ar), and the handler asks for that key
{
  const cat = (l) => JSON.parse(fs.readFileSync(new URL(`../platform/i18n/${l}.json`, import.meta.url), 'utf8'));
  for (const l of ['en', 'ar']) {
    const v = cat(l)['common.worker.toast.commandFailed'];
    assert.ok(v && v.includes('{command}') && v.includes('{message}'), `${l}: commandFailed exists with both placeholders`);
  }
  assert.match(body, /tw\('common\.worker\.toast\.commandFailed'/);
}
console.log('  ok  test-keymap (T-014, T-015)');
