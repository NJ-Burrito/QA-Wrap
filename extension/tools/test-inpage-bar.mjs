/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The in-page layer (UI rework round 2, S8; DESIGN-SPEC §5): the bar, the pick
 * rings and the name chip, the private face, and what keeps them out of the
 * evidence. Node only, no browser: the behaviour a browser has to show is
 * measured once by tools/inpage-shots.mjs; this pins the contracts the code
 * has to keep between those runs.
 *
 *   node tools/test-inpage-bar.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift } from './lib-lift.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');
const BAR = read('content/bar.js');
const PICKER = read('content/picker.js');
const HOST = read('content/ui-host.js');
const BRIDGE = read('content/bridge.js');
const CSS = read('content/overlay.css');
const WORKER = workerSrc();
const SITE = read('background/site-access.js');
const MANIFEST = JSON.parse(read('manifest.json'));
const EN = JSON.parse(read('platform/i18n/en.json'));
const AR = JSON.parse(read('platform/i18n/ar.json'));

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('the in-page layer — bar, rings, chip, face, capture');

test('the bar is a toolbar named from overlay.bar.aria, and its controls are named from the tables', () => {
  assert.match(BAR, /bar\.setAttribute\('role', 'toolbar'\)/);
  assert.match(BAR, /bar\.setAttribute\('aria-label', t\('overlay\.bar\.aria'\)\)/);
  for (const key of ['overlay.bar.grip', 'popup.live.stop', 'overlay.bar.notRecording', 'popup.pick.head',
    'popup.live.copyAgain', 'options.actions.shot.label', 'popup.note.add', 'overlay.bar.openFloat',
    'overlay.bar.collapse', 'overlay.bar.expand']) {
    assert.ok(BAR.includes(`'${key}'`), `${key} names nothing on the bar`);
  }
});

test('every overlay.* key in the tables is used by a content script', () => {
  const content = fs.readdirSync(path.join(EXT, 'content')).filter((f) => f.endsWith('.js')).map((f) => read(`content/${f}`)).join('\n');
  const unused = Object.keys(EN).filter((k) => k.startsWith('overlay.') && !content.includes(`'${k}'`));
  assert.deepEqual(unused, [], `overlay keys nothing in content/ asks for: ${unused.join(', ')}`);
});

test("every string the bar carries is in the worker's subset, in both languages, and its English fallback is the table's", () => {
  const src = WORKER.match(/const OVERLAY_KEYS = (\/.+\/);/);
  assert.ok(src, 'the worker has no OVERLAY_KEYS subset');
  const subset = new Function(`return ${src[1]};`)();
  const fallbacks = [...BAR.slice(BAR.indexOf('const EN = {'), BAR.indexOf('};', BAR.indexOf('const EN = {'))).matchAll(/'([a-z]+\.[A-Za-z.]+)': '((?:\\'|[^'])*)'/g)];
  assert.ok(fallbacks.length >= 25, `only ${fallbacks.length} fallbacks found in bar.js`);
  for (const [, key, text] of fallbacks) {
    assert.ok(subset.test(key), `${key} is not in the worker's OVERLAY_KEYS, so the page never gets it translated`);
    assert.ok(EN[key] != null && AR[key] != null, `${key} is missing from a table`);
    assert.equal(text.replace(/\\'/g, "'"), EN[key], `${key}: the bar's English fallback drifted from en.json`);
  }
});

test('the purpose switch is one radiogroup of four, keyed 1-4, and the old strip is gone', () => {
  assert.match(BAR, /el\('div', 'uqa-purpose', \{ role: 'radiogroup' \}\)/);
  assert.match(BAR, /const PURPOSES = \['any', 'step', 'element', 'sensitive'\];/);
  assert.match(BAR, /role: 'radio'/);
  assert.match(BAR, /<span class="uqa-kbd">\$\{i \+ 1\}<\/span>/);
  assert.match(PICKER, /n >= 1 && n <= PURPOSES\.length/, 'the keys 1-4 no longer switch purpose while picking');
  for (const dir of ['content', 'ui']) {
    for (const f of fs.readdirSync(path.join(EXT, dir)).filter((n) => /\.(js|css)$/.test(n))) {
      assert.ok(!read(`${dir}/${f}`).includes('uqa-pick-modes'), `${dir}/${f} still names the retired purpose strip`);
    }
  }
});

test('the dock is stored as {edge, pos, collapsed} and read back defensively', () => {
  assert.match(BAR, /const DOCK_KEY = 'qawBarDock';/);
  assert.match(BAR, /\{ \[DOCK_KEY\]: \{ edge: state\.edge, pos: state\.pos, collapsed: state\.collapsed \} \}/);
  assert.match(BAR, /EDGES\.includes\(d\.edge\)/, 'a stored edge is trusted without a check');
  assert.match(BAR, /clamp\(d\.pos, 0, 1\)/, 'a stored position is trusted without a clamp');
  assert.match(BAR, /edge: 'bottom', pos: 0\.5, collapsed: false/, 'the default is not bottom, centred, open');
});

test('no content script reads chrome.storage.local, which the worker closes to them', () => {
  // service-worker.js sets local to TRUSTED_CONTEXTS (the Jira token lives
  // there): a read from a page throws, and the first inpage-shots run caught
  // the bar forgetting its edge on every page because of exactly that.
  assert.match(WORKER, /chrome\.storage\.local\s*\.setAccessLevel\?\.\(\{ accessLevel: 'TRUSTED_CONTEXTS' \}\)/);
  for (const f of fs.readdirSync(path.join(EXT, 'content')).filter((n) => n.endsWith('.js'))) {
    const code = read(`content/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /storage\??\.local/, `content/${f} reads chrome.storage.local`);
  }
  assert.match(BAR, /chrome\.storage\.sync\.get\(DOCK_KEY/, 'the dock is not read from sync');
  assert.match(WORKER, /broadcast\(\{ type: 'UQA_THEME', theme: c\.qawTheme\.newValue \}\)/, 'a theme change never reaches the page');
  assert.match(HOST, /msg\?\.type === 'UQA_THEME'/, 'the host ignores a theme change');
});

test('nothing is drawn while a video is filmed; screenshots hide the same host', () => {
  assert.match(BAR, /const shown = !state\.video && /, 'the bar shows over a recording');
  assert.match(HOST, /host\.style\.display = filming \? 'none' : ''/, 'the host is not taken down while filming');
  assert.match(HOST, /host\.style\.display = msg\.hidden \|\| filming \? 'none' : ''/, 'a screenshot un-hides the host mid-clip');
  assert.match(BRIDGE, /msg\?\.type === 'UQA_RECORDING_CHANGED'\) publish\(\{ video: !!msg\.recording \}\)/);
  assert.match(WORKER, /const video = msg\?\.video \? !!\(await recordingState\(\)/, 'a page opened mid-clip cannot learn it');
  assert.match(BAR, /H\.uiLayer\('uqa-bar'\)/, 'the bar is drawn outside the host screenshots hide');
});

test('the ring box is two crisp rings over the element: no fill, no tint, no glow, never a target', () => {
  const ring = CSS.match(/\.uqa-ring \{([^}]*)\}/);
  assert.ok(ring, 'no .uqa-ring rule');
  assert.match(ring[1], /background:\s*none/);
  assert.match(ring[1], /pointer-events:\s*none/);
  assert.doesNotMatch(CSS, /color-mix\([^;]*--p\b/, 'the element is tinted in the purpose colour');
  assert.match(PICKER, /n\.style\.pointerEvents = 'none';/, 'a ring layer keeps the inline pointer-events uiLayer() gives it');
});

/* ── the chip never covers the element (DESIGN-SPEC §5.5) ─────────────── */
function chipPlacer({ vw = 1280, vh = 800, bar = null, rtl = false } = {}) {
  const build = new Function('env', `
    const innerWidth = env.vw, innerHeight = env.vh;
    const window = { top: null, UQABar: { rect: () => env.bar } };
    window.top = window;
    const getComputedStyle = () => ({ direction: env.rtl ? 'rtl' : 'ltr' });
    const grow = (r, px) => ({ left: r.left - px, top: r.top - px, right: r.right + px, bottom: r.bottom + px });
    const meets = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    ${lift(PICKER, 'placeChip')}
    return placeChip;`);
  const placeChip = build({ vw, vh, bar, rtl });
  return (r, locked = false, w = 180, h = 28) => {
    const label = { offsetWidth: w, offsetHeight: h, style: { setProperty() {}, transform: '' } };
    placeChip(label, { ...r, right: r.left + r.width, bottom: r.top + r.height }, locked);
    const [x, y] = label.style.transform.match(/-?[\d.]+(?=px)/g).map(Number);
    return { left: x, top: y, right: x + w, bottom: y + h };
  };
}
const meets = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
const grow = (r, px) => ({ left: r.left - px, top: r.top - px, right: r.left + r.width + px, bottom: r.top + r.height + px });

test('the chip takes the first of the six places, in order: above-start, below-start, above-end, below-end, end, start', () => {
  const place = chipPlacer();
  const mid = { left: 500, top: 300, width: 200, height: 40 };
  assert.deepEqual(place(mid), { left: 496, top: 262, right: 676, bottom: 290 }, '1: above, at the inline start');
  const top = { left: 500, top: 10, width: 200, height: 40 };
  assert.equal(place(top).top, 10 + 40 + 4 + 6, '2: below, when there is no room above');
  const right = { left: 1180, top: 300, width: 90, height: 40 };
  assert.equal(place(right).right, 1180 + 90 + 4, '3: above, at the inline end, when the start would leave the viewport');
  const tall = { left: 200, top: 4, width: 400, height: 790 };
  assert.equal(place(tall).left, 200 + 400 + 4 + 6, '5: beside, at the inline end, when above and below are both off screen');
  const rtl = chipPlacer({ rtl: true });
  assert.equal(rtl(mid).right, 704, 'in Arabic the inline start is the right edge');
});

test('the chip never meets the ring box + 4px, stays on screen, and avoids the bar', () => {
  const bar = { left: 300, top: 736, right: 980, bottom: 784, width: 680, height: 48 };
  const place = chipPlacer({ bar });
  for (let top = 0; top < 780; top += 37) {
    for (let left = 0; left < 1270; left += 113) {
      for (const locked of [false, true]) {
        const el = { left, top, width: 120, height: 36 };
        const c = place(el, locked);
        assert.ok(!meets(c, grow(el, (locked ? 8 : 4) + 4)), `the chip covers the element at ${left},${top}`);
        assert.ok(c.left >= 0 && c.top >= 0 && c.right <= 1280 && c.bottom <= 800, `the chip leaves the viewport at ${left},${top}`);
        assert.ok(!meets(c, bar), `the chip sits on the bar at ${left},${top}`);
      }
    }
  }
});

test('bar.js and ui/icons.js are injected into the top frame only, and never declared', () => {
  assert.match(WORKER, /const BAR_FILES = \['ui\/icons\.js', 'ui\/tone\.js', 'ui\/live\.js', 'content\/bar\.js'\];/);
  assert.match(WORKER, /executeScript\(\{ target: \{ tabId, frameIds: \[0\] \}, files: BAR_FILES \}\)/);
  const declared = [SITE, JSON.stringify(MANIFEST.content_scripts || [])].join('\n');
  for (const f of ['content/bar.js', 'ui/icons.js']) {
    assert.ok(!declared.includes(f), `${f} is declared for every frame of every page`);
  }
  assert.match(BAR, /if \(window\.UQABar \|\| window\.top !== window\) return;/, 'the bar would draw in a sub-frame');
  assert.match(BRIDGE, /if \(barAsked \|\| window\.top !== window \|\| window\.UQABar\) return;/);
});

test('the face reaches the page as bytes under a private name, never as a file or an @font-face', () => {
  assert.match(HOST, /const FAMILY = 'QAW Thmanyah Sans';/);
  assert.match(HOST, /new FontFace\(FAMILY, Uint8Array\.from\(atob\(b64\)/);
  assert.match(HOST, /document\.fonts\.add\(face\)/);
  assert.match(CSS, /"QAW Thmanyah Sans", system-ui/);
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /@font-face|@import|url\(/, 'overlay.css is web-accessible to every page; no face or file may be named in it');
  assert.match(WORKER, /own\('ui\/fonts\.css'\)/, 'the worker no longer reads the face at call time');
  const war = JSON.stringify(MANIFEST.web_accessible_resources || []);
  assert.ok(!/fonts/.test(war), 'a font became web-accessible');
});

test('the face and the strings are asked for once per frame, and only by a frame that draws', () => {
  assert.match(HOST, /function overlayAssets\(\) \{\n    if \(assets\) return assets;/);
  assert.match(HOST, /uiRoot\(\)\.appendChild\(layer\);\n    overlayAssets\(\);/, 'the first layer drawn does not ask');
  const calls = HOST.match(/overlayAssets\(\)/g) || [];
  // declaration, uiLayer, and loadCss (the stylesheet now arrives in the same reply)
  assert.equal(calls.length, 3, 'something other than drawing a layer or the stylesheet asks for the face');
});

test('1015: the pick controls are drawn only while picking, and the picker still owns keys 1-4', () => {
  assert.match(CSS, /\.uqa-bar:not\(\.is-picking\) \.uqa-pickonly \{ display: none; \}/, 'the pick-only parts are always drawn');
  assert.match(BAR, /bar\.classList\.toggle\('is-picking', state\.picking\)/);
  assert.match(BAR, /picking: \(on\) => \{ state\.picking = !!on; if \(on\) state\.used = true; paintPicking\(\);/, 'the bar is not told when a pick starts and ends');
  assert.match(PICKER, /n >= 1 && n <= PURPOSES\.length/, 'keys 1-4 stopped working while picking');
});

test("1015: the bar steps off a focused text field once, through the same yield, and the tester's dock resets it", () => {
  assert.match(BAR, /const covered = state\.fieldYield \|\| state\.locked\.some/);
  assert.match(BAR, /document\.addEventListener\('focusin'/);
  assert.match(BAR, /Object\.assign\(state, \{ edge, pos, fieldYield: false \}\)/);
});

test('1015: words on the quick buttons drop at c1, the chip is a button reading "n problems", both in the two tables', () => {
  assert.match(CSS, /\.uqa-bar\.c1 \.uqa-lbl/);
  assert.match(BAR, /el\('button', 'uqa-problems'/);
  assert.match(BAR, /act\(probs, \(\) => B\?\.send\(\{ type: 'UQA_OPEN_FLOAT' \}\)\)/);
  for (const k of ['overlay.bar.label.shot', 'overlay.bar.label.note', 'overlay.bar.label.panel', 'overlay.bar.problemsCount']) assert.ok(EN[k] && AR[k], `${k} is missing from a table`);
  assert.equal(EN['overlay.bar.problemsCount'], EN['popup.live.problemsCount'], "the bar's English count drifted from the popup's");
  assert.equal(AR['overlay.bar.problemsCount'], AR['popup.live.problemsCount'], "the bar's Arabic count drifted from the popup's");
});

test('1015: Enter in the bar note box saves a Bug (rule 3); Shift+Enter saves a plain note', () => {
  assert.match(read('content/keymap.js'), /send\(e\.shiftKey \? '' : 'bug'/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
