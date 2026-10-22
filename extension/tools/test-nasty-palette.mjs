/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * "Try nasty values" did nothing (15 Oct 2026, lane C).
 *
 * The palette opened, then closed under the tester's pointer before the click on a
 * value landed. `onOutside` (a document-level mousedown) asked
 * `e.composedPath().includes(palette)`, but the palette lives in the closed shadow
 * root of `<qaw-ui>` (content/ui-host.js): from a document listener the path of a
 * closed root stops at the host and never names the palette. So every press on a row
 * read as "outside", close() ran on mousedown, and the click had nothing to hit.
 *
 * Lifted by name from the real file (lib-lift.mjs); the event is shaped the way a
 * closed root really reports it: target retargeted to the host, path = [host, ...page].
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { endOfBlock } from './lib-lift.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(EXT, 'content', 'data-injector.js'), 'utf8');

const at = SRC.indexOf('const onOutside = (e) => {');
assert.ok(at > -1, 'data-injector.js no longer declares onOutside: this test is out of date, not wrong');
const end = endOfBlock(SRC, SRC.indexOf('{', at));
const body = SRC.slice(at, end + 1);

/** Build onOutside with a palette, a host, and the shipped isOurs rule (host, or anything in our root). */
function rig() {
  const host = { name: 'qaw-ui' };
  const inner = { name: 'palette-row' };
  const palette = { name: 'palette' };
  const state = { closed: 0, palette };
  const window = {
    UQAUiHost: { isOurs: (n) => n === host || n === inner || n === palette },
  };
  const make = new Function('window', 'palette', 'close', `${body}; return onOutside;`);
  return { host, state, onOutside: (pal) => make(window, pal, () => { state.closed++; }) };
}

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

test('a press on a palette row (closed root: target is the host, path stops there) keeps it open', () => {
  const r = rig();
  r.onOutside(r.state.palette)({ target: r.host, composedPath: () => [r.host, { name: 'body' }, { name: 'html' }] });
  assert.equal(r.state.closed, 0, 'the palette closed on its own mousedown');
});

test('a press on the page still closes it', () => {
  const r = rig();
  const page = { name: 'page-input' };
  r.onOutside(r.state.palette)({ target: page, composedPath: () => [page, { name: 'body' }] });
  assert.equal(r.state.closed, 1);
});

test('no palette open: nothing to close', () => {
  const r = rig();
  r.onOutside(null)({ target: { name: 'x' }, composedPath: () => [] });
  assert.equal(r.state.closed, 0);
});

// picker.js had the same idiom for its basket chip (also a layer of the closed root).
const PICKER = fs.readFileSync(path.join(EXT, 'content', 'picker.js'), 'utf8');
const pAt = PICKER.indexOf('const onChip = (e) => {');
assert.ok(pAt > -1, 'picker.js no longer declares onChip');
const chipBody = PICKER.slice(pAt, endOfBlock(PICKER, PICKER.indexOf('{', pAt)) + 1);
assert.doesNotMatch(PICKER, /composedPath\?\.\(\) \|\| \[\]\)\.includes\(chip\)/, 'picker.js still asks composedPath().includes(chip)');

test('picker: a press on the chip (target = host, pointer inside its box) is the chip itself', () => {
  const host = { name: 'qaw-ui' };
  const chip = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 50, bottom: 20 }) };
  const onChip = new Function('window', 'chip', `${chipBody}; return onChip;`)({ UQAUiHost: { isOurs: (n) => n === host } }, chip);
  assert.equal(onChip({ target: host, clientX: 5, clientY: 5, composedPath: () => [host] }), true);
  assert.equal(onChip({ target: host, clientX: 90, clientY: 90, composedPath: () => [host] }), false);
  assert.equal(onChip({ target: { name: 'page' }, clientX: 5, clientY: 5, composedPath: () => [] }), false);
});

// K1 (lane V, real OS): after a value went into the field, the tool's yellow ring stayed on the page through game levels 1-4 and
// covered text. The real data-injector.js in a real page, a trusted click to pick, a trusted click on a value, then the other exits.
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
try {
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
    page.on('pageerror', (e) => console.log('       page error:', e.message));
    await page.addInitScript(() => {
      window.chrome = { runtime: { id: 'x', onMessage: { addListener: (fn) => { window.__msg = fn; } } } };
      window.UQABridge = { emit() {} };
      window.UQAUiHost = {
        uiLayer: (cls) => { const d = document.createElement('div'); d.className = cls; document.body.append(d); return d; },
        clearToasts() {}, flash() {}, isOurs: (n) => !!n?.closest?.('.uqa-palette,.uqa-field-bar'), claimPointer() {}, releasePointer() {},
      };
    });
    await page.goto('about:blank');
    await page.setContent('<!doctype html><style>.uqa-palette,.uqa-field-ring{position:fixed}.uqa-palette{width:380px;height:300px;overflow:auto}</style><body style="margin:0"><input id="u" name="username" style="position:absolute;left:40px;top:60px"><p id="t">text</p></body>');
    await page.addScriptTag({ content: SRC });
    return page;
  };
  const ringCount = (page) => page.evaluate(() => document.querySelectorAll('.uqa-field-ring').length);
  const pickToPalette = async (page) => {
    await page.evaluate(() => window.UQAInjector.armPick('nasty'));
    await page.click('#u');
    assert.equal(await ringCount(page), 1, 'the ring marks the picked field while the palette is open');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.uqa-palette').length), 1, 'the palette opened');
  };
  {
    const page = await open();
    await pickToPalette(page);
    await page.click('.uqa-palette-item');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.uqa-palette').length), 0, 'the palette closed on apply');
    assert.equal(await ringCount(page), 0, 'a value was applied: the ring is gone');
    await page.close();
    passed++; console.log('  ok  K1: applying a value takes the yellow ring down');
  }
  {
    const page = await open();
    await pickToPalette(page);
    await page.keyboard.press('Escape');
    assert.equal(await ringCount(page), 0, 'Esc: the ring is gone');
    await page.close();
    passed++; console.log('  ok  K1: Esc takes the yellow ring down');
  }
  {
    const page = await open();
    await pickToPalette(page);
    await page.mouse.click(700, 450); // a press on the page, away from the palette
    assert.equal(await ringCount(page), 0, 'a click away: the ring is gone');
    await page.close();
    passed++; console.log('  ok  K1: a click away takes the yellow ring down');
  }
  {
    // the "values" pick keeps its mark until used; the page replacing the field (a game level) or navigating ends it
    const page = await open();
    await page.evaluate(() => window.UQAInjector.armPick('values'));
    await page.click('#u');
    assert.equal(await ringCount(page), 1, 'a values pick keeps its mark');
    await page.evaluate(() => document.getElementById('u').remove());
    await page.evaluate(() => dispatchEvent(new Event('resize')));
    assert.equal(await ringCount(page), 0, 'the field left the page: no ring left over the text');
    await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<input id="v">'); window.UQAInjector.armPick('values'); });
    await page.click('#v');
    assert.equal(await ringCount(page), 1);
    await page.evaluate(() => dispatchEvent(new HashChangeEvent('hashchange')));
    assert.equal(await ringCount(page), 0, 'a route change ends it');
    await page.close();
    passed++; console.log('  ok  K1: a field that left the page, or a route change, takes the ring down');
  }
  {
    const page = await open();
    await page.evaluate(() => window.UQAInjector.armPick('values'));
    await page.click('#u');
    const r = await page.evaluate(() => new Promise((res) => window.__msg({ type: 'UQA_SET_FIELD_VALUE', value: 'x' }, { id: 'x' }, res)));
    assert.equal(r.set, true);
    assert.equal(await ringCount(page), 0, 'a value set from the popup: the ring is gone');
    await page.close();
    passed++; console.log('  ok  K1: a value set from the popup takes the ring down');
  }
} finally {
  await browser.close();
}

console.log(`test-nasty-palette: ${passed} passed`);
