/* T-044 G4 (Q-12): an icon click with the float open brings it forward and never closes it. node tools/test-float-front.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { workerSrc } from './lib-worker-src.mjs';

const sw = workerSrc();
const i = sw.indexOf("on(chrome.action?.onClicked, 'action.onClicked'");
assert.ok(i > 0, 'action.onClicked handler found');
const body = sw.slice(i, sw.indexOf('\n});\n', i));
const handlerSrc = body.slice(body.indexOf('async (tab)'));
// The real floatWindow() runs against a mock chrome.windows (T-044 accept: focused, unfocused, missing).
const fw = sw.slice(sw.indexOf('async function floatWindow()'), sw.indexOf('async function openFloat'));
const make = new Function('env', `const { noteInvoked, getSettings, openFloat, chrome } = env; ${fw}\nreturn (${handlerSrc}\n});`);

async function click(win) { // win: {focused,state} | 'missing' (stale id, windows.get rejects) | null (no id stored)
  const calls = [];
  const chrome = { windows: { get: async (id) => { if (win === 'missing') throw new Error('No window with id'); return { id, ...win }; },
      update: async (id, o) => { calls.push(['update', id, o]); }, remove: async (id) => { calls.push(['remove', id]); } },
    storage: { session: { get: async () => (win ? { floatWindowId: 9 } : {}), remove: async () => calls.push(['forget']) } }, sidePanel: { open: async () => calls.push(['panel']) } };
  const handler = make({ noteInvoked: async () => {}, getSettings: async () => ({ launchSurface: 'float' }), openFloat: async (w) => { calls.push(['open', w]); }, chrome });
  await handler({ id: 1, windowId: 4 });
  return calls;
}

for (const [name, win] of [['unfocused', { focused: false, state: 'normal' }], ['focused', { focused: true, state: 'normal' }]]) {
  const calls = await click(win);
  assert.deepEqual(calls.map((c) => c[0]), ['update'], `${name} float: one update, never a remove`);
  assert.deepEqual(calls[0][2], { focused: true, drawAttention: true }, `${name} float: brought forward with drawAttention`);
}
let calls = await click({ focused: false, state: 'minimized' });
assert.equal(calls[0][2].state, 'normal', 'a minimised float is restored');
calls = await click('missing');
assert.deepEqual(calls, [['open', 4]], 'stale float id: open a new one, no update on a dead window');
calls = await click(null);
assert.deepEqual(calls, [['open', 4]], 'no float: open one');
console.log('test-float-front ok');
