/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Firefox for Android has no `windows` API (BROWSERS-GUIDE F1, rule B15): the float opens as a tab.
 *
 *   node tools/test-no-windows.mjs
 *
 * `tabWindows` (background/worker-lifecycle.js) is lifted and run against a fake `chrome.tabs`; the guard that installs it
 * is asserted on the source, so a browser that HAS `windows` keeps the old path untouched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift } from './lib-lift.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(EXT, 'background/worker-lifecycle.js'), 'utf8');
const tabWindows = new Function(`${lift(src, 'tabWindows')}; return tabWindows;`)();

const fakeTabs = () => {
  const tabs = new Map(); let next = 7; const log = [];
  return {
    log, tabs,
    create: async (o) => { const t = { id: next++, windowId: 1, active: !!o.active, url: o.url }; tabs.set(t.id, t); log.push(['create', o]); return t; },
    get: async (id) => { if (!tabs.has(id)) throw new Error('No tab'); return tabs.get(id); },
    update: async (id, o) => { log.push(['update', id, o]); return Object.assign(tabs.get(id), o); },
    remove: async (id) => { log.push(['remove', id]); tabs.delete(id); },
    query: async () => [{ id: 1, windowId: 1, active: true }],
  };
};
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };
const url = 'chrome-extension://x/popup/popup.html?surface=float';

await t('without windows: opening the float creates a tab, same URL', async () => {
  const T = fakeTabs(); const W = tabWindows(T);
  const win = await W.create({ url, type: 'popup', width: 560, height: 720, left: 1, top: 2, focused: true });
  assert.deepEqual(T.log[0], ['create', { url, active: true }]);
  assert.ok(win.id >= 1e9 && win.id !== 1, 'the float id cannot collide with a real window id');
});

await t('without windows: get, focus and close address the tab; a closed tab reads as null after .catch', async () => {
  const T = fakeTabs(); const W = tabWindows(T);
  const { id } = await W.create({ url, type: 'popup' });
  assert.equal((await W.get(id)).id, id);
  await W.update(id, { focused: true, drawAttention: true });
  assert.deepEqual(T.log.at(-1), ['update', id - 1e9, { active: true }]);
  await W.update(id, { width: 560, height: 720 }); // bounds: nothing to do on a tab
  await W.remove(id);
  assert.equal(await W.get(id).catch(() => null), null);
});

await t('without windows: other ids are the one browser window; nothing throws', async () => {
  const T = fakeTabs(); const W = tabWindows(T);
  assert.equal((await W.get(1)).focused, true);
  assert.equal((await W.getCurrent()).id, 1);
  assert.equal((await W.getLastFocused({ windowTypes: ['normal'] })).id, 1);
  assert.equal((await W.create({ url, type: 'normal' })).id, 1);
  await W.update(1, { state: 'normal', width: 400 }); await W.remove(1);
  assert.equal(T.log.filter(([k]) => k === 'remove' || k === 'update').length, 0, 'a real window id never touches a tab');
});

await t('with windows: the shim is not installed and the float still goes through chrome.windows.create as a popup', () => {
  assert.match(src, /if \(!chrome\.windows\) chrome\.windows = tabWindows\(chrome\.tabs\);/);
  assert.match(src, /chrome\.windows\.create\(\{[^}]*type: 'popup'/s);
});

console.log(`\n${n} passed, 0 failed`);
