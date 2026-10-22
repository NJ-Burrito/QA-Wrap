/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R3 (keymap half), REQ-P1-9, lane PAGE of DESIGN-1011: Alt chords work inside text fields, guarded.
 *
 * The real content/keymap.js + content/ui-host.js in headless Chromium on a fixture page, with real (trusted) key
 * presses, so `isTrusted`, `e.code` and `e.altKey` are the browser's own. It does NOT test `chrome.commands` (the
 * toolbar shortcuts Chrome owns): those cannot be pressed from a page, and nothing here claims they work.
 * Cases outside what a real keyboard can send (IME composition, a Mac Option press, AltGraph) run against the same
 * file in a vm sandbox with hand-made events.   node tools/test-keymap-1011.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const KEYMAP = read('content/keymap.js');
const UIHOST = read('content/ui-host.js');
const FIXTURE_HTML = read('tools/fixtures/autopilot/keymap.html');

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => { if (ok) passed++; else { failures.push(name); console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); } };

const KEYMAP_SETTINGS = { keymapEnabled: true, keymap: { note: 'Alt+KeyN', shot: 'Ctrl+Alt+KeyS', pick: 'KeyP' } };

/* ── real browser, real keys ─────────────────────────────────────────────────────────────────────────────────── */
const browser = await chromium.launch({ headless: true });
async function open() {
  const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
  page.on('pageerror', (e) => console.log('       page error:', e.message));
  await page.addInitScript((settings) => {
    const real = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) { const r = real.call(this, init); window.__root = r; return r; };
    window.__sent = [];
    window.__picks = 0;
    window.chrome = {
      runtime: { id: 'x', lastError: undefined, sendMessage: (m, cb) => { cb && setTimeout(() => cb({ ok: true, result: null }), 0); }, onMessage: { addListener() {} } },
      storage: { sync: { get: (k, cb) => cb && cb({}), set() {} }, local: { get: (k, cb) => cb && cb({}), set() {} }, onChanged: { addListener() {} } },
    };
    window.UQASettings = settings;
    window.UQAAwake = true;
    window.UQABridge = { send: (m) => { window.__sent.push(m.type); return Promise.resolve({ ok: true }); } };
    window.UQAPicker = { start: () => { window.__picks++; } };
  }, KEYMAP_SETTINGS);
  await page.route('https://app.test/**', (r) => r.fulfill({ contentType: 'text/html', body: FIXTURE_HTML }));
  await page.goto('https://app.test/keymap');
  await page.addScriptTag({ content: UIHOST });
  await page.addScriptTag({ content: KEYMAP });
  await page.waitForFunction(() => !!window.UQAKeymap);
  return page;
}
const composer = (page) => page.evaluate(() => !!window.__root?.querySelector('.uqa-quicknote'));
const settle = (page) => page.waitForTimeout(150);
const arabicN = async (page, modifiers) => { // the N key on an Arabic layout: key is «ن», the physical code is still KeyN
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, key: 'ن', code: 'KeyN', windowsVirtualKeyCode: 78 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key: 'ن', code: 'KeyN', windowsVirtualKeyCode: 78 });
};

try {
  for (const [id, label] of [['text', 'a text input'], ['area', 'a textarea'], ['edit', 'a contenteditable']]) {
    const page = await open();
    await page.focus(`#${id}`);
    await page.keyboard.press('Alt+KeyN');
    await settle(page);
    check(`Alt+N inside ${label} opens the note box`, await composer(page));
    const typed = await page.evaluate((i) => { const el = document.getElementById(i); return el.value ?? el.textContent; }, id);
    check(`Alt+N inside ${label} types nothing into it`, typed === '', JSON.stringify(typed));
    await page.close();
  }
  {
    const page = await open();
    await page.focus('#pass');
    await page.keyboard.press('Alt+KeyN');
    await settle(page);
    check('Alt+N inside a password field does nothing', !(await composer(page)));
    await page.close();
  }
  {
    const page = await open();
    await page.focus('#text');
    await page.keyboard.press('Control+Alt+KeyS'); // AltGr on Windows: types a character on several layouts
    await settle(page);
    check('Ctrl+Alt+S (AltGr) inside a text field is left to the page: nothing sent', !(await page.evaluate(() => window.__sent.includes('UQA_CAPTURE'))));
    await page.focus('#plain');
    await page.keyboard.press('Control+Alt+KeyS');
    await settle(page);
    check('the same chord outside a text field still runs (behaviour kept)', await page.evaluate(() => window.__sent.includes('UQA_CAPTURE')));
    await page.close();
  }
  {
    const page = await open();
    await page.focus('#text');
    await page.keyboard.press('KeyP');
    await settle(page);
    check('a plain letter bound without Alt is typed into the field, not stolen', (await page.evaluate(() => document.getElementById('text').value)) === 'p' && (await page.evaluate(() => window.__picks)) === 0);
    await page.focus('#plain');
    await page.keyboard.press('KeyP');
    await settle(page);
    check('the same plain-letter binding still runs outside a field (behaviour kept)', (await page.evaluate(() => window.__picks)) === 1);
    await page.close();
  }
  {
    const page = await open();
    await page.focus('#text');
    await arabicN(page, 1);
    await settle(page);
    check('Arabic layout (key «ن», code KeyN) inside a text field: matched on e.code, the note box opens', await composer(page));
    await page.close();
  }
  {
    const page = await open();
    await page.focus('#text');
    await page.evaluate(() => document.getElementById('text').dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'KeyN', key: 'n', bubbles: true, cancelable: true })));
    await settle(page);
    check('a page script dispatching Alt+N (untrusted) does nothing', !(await composer(page)));
    await page.focus('#plain');
    await page.keyboard.press('Alt+KeyN');
    await settle(page);
    check('Alt+N outside any field still opens the note box (behaviour kept)', await composer(page));
    await page.close();
  }

  /* ── hand-made events: what a real keyboard cannot be made to send here ─────────────────────────────────────── */
  const sandbox = ({ platform, settings = KEYMAP_SETTINGS } = {}) => {
    let keydown;
    const calls = [];
    const document = { createElement: () => ({}), addEventListener: (n, f) => { if (n === 'keydown') keydown = f; } };
    const window = { UQASettings: settings, UQAAwake: true, UQABridge: { send: (m) => calls.push(m.type) }, UQAUiHost: { t: undefined } };
    window.window = window;
    const navigator = platform === undefined ? undefined : { platform };
    vm.runInNewContext(KEYMAP, { window, document, navigator, CustomEvent: class {} });
    const press = (over, target = { tagName: 'INPUT', type: 'text' }) => keydown({ isTrusted: true, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: 'KeyS', target, preventDefault() {}, stopPropagation() {}, ...over });
    return { calls, press };
  };
  const SHOT = { keymapEnabled: true, keymap: { shot: 'Alt+KeyS', shotShift: 'Alt+Shift+KeyS' } };
  {
    const s = sandbox({ settings: SHOT });
    s.press({});
    check('unit: a trusted Alt+S in a text input runs the shortcut', s.calls.join() === 'UQA_CAPTURE', s.calls.join());
  }
  {
    const s = sandbox({ settings: SHOT });
    s.press({ isComposing: true });
    s.press({ isComposing: true }, { tagName: 'DIV' });
    check('unit: never during IME composition (in or out of a field)', s.calls.length === 0, s.calls.join());
  }
  {
    const s = sandbox({ settings: SHOT });
    s.press({ getModifierState: (k) => k === 'AltGraph' });
    s.press({ metaKey: true });
    s.press({}, { tagName: 'INPUT', type: 'PASSWORD' });
    check('unit: AltGraph, Meta and a password field (any case) are refused in a field', s.calls.length === 0, s.calls.join());
  }
  {
    const s = sandbox({ settings: SHOT, platform: 'MacIntel' });
    s.press({});
    check('unit: on a Mac an Option press (it types characters) does not run in a field', s.calls.length === 0, s.calls.join());
    s.press({}, { tagName: 'DIV' });
    check('unit: on a Mac the same press outside a field runs (behaviour kept)', s.calls.join() === 'UQA_CAPTURE', s.calls.join());
  }
  {
    const s = sandbox({ settings: { keymapEnabled: true, keymap: { shot: 'Alt+Shift+KeyS' } }, platform: 'MacIntel' });
    s.press({ shiftKey: true });
    check('unit: on a Mac Option+Shift chords still run in a field', s.calls.join() === 'UQA_CAPTURE', s.calls.join());
  }
  {
    const s = sandbox({ settings: SHOT });
    s.press({ isTrusted: false });
    check('unit: an untrusted key event runs nothing', s.calls.length === 0);
  }
} finally {
  await browser.close();
}
console.log(`keymap 1011: ${passed} passed, ${failures.length} failed`);
assert.equal(failures.length, 0, failures.join('; '));
