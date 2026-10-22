/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R6 (page half) + AUTO-1 / AUTO-4 trigger / AUTO-5 receipt, lane PAGE of DESIGN-1011.
 *
 * The real content/bridge.js + content/ui-host.js + content/autopilot.js (and the real overlay.css) in headless
 * Chromium on a fixture page, with a stubbed `chrome.runtime`: no extension, no desktop window. What it proves:
 *   - the dot exists only while a session records, says the minutes, and the Settings switch (pageIndicator) removes it;
 *   - it lives in the closed shadow root: a page querySelector, innerHTML and elementsFromPoint find nothing, it has
 *     pointer-events none, no animation and no sound, and a click on its host does nothing;
 *   - a first failure of each kind: one "Caught: METHOD /path STATUS" toast (no query), one UQA_SHOT_AUTO ask (only when
 *     visible and focused); a second of the same kind: neither; "Not a bug" sends `expected` + forKey only when trusted;
 *   - kindKey in the content script equals dupeKey in core/dupes.js on the same events (the parity guard);
 *   - the EN and AR string fragments carry the same keys and placeholders.
 * It does NOT test the worker (auto-start, the capture itself): that is lane WRK.   node tools/test-page-indicator.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { dupeKey } from '../core/dupes.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(EXT, '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const SCRIPTS = ['content/bridge.js', 'content/ui-host.js', 'content/autopilot.js'].map(read);
const css = read('content/overlay.css');
const FRAG = path.join(ROOT, 'work', 'sdlc', 'build', 'i18n');
const en = JSON.parse(fs.readFileSync(path.join(FRAG, 'PAGE.en.json'), 'utf8'));
const ar = JSON.parse(fs.readFileSync(path.join(FRAG, 'PAGE.ar.json'), 'utf8'));
const FIXTURE_HTML = fs.readFileSync(path.join(EXT, 'tools', 'fixtures', 'autopilot', 'page.html'), 'utf8');
const FIXTURE = 'https://app.test/shop/cart'; // served from the fixture file, so URLs resolve like a real site's

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => { if (ok) passed++; else { failures.push(name); console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); } };

// Strings: same keys, same placeholders, in both languages.
check('fragments: EN and AR carry the same keys', JSON.stringify(Object.keys(en).sort()) === JSON.stringify(Object.keys(ar).sort()));
for (const k of Object.keys(en)) {
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
  check(`fragments: ${k} has the same placeholders in AR`, ph(en[k]) === ph(ar[k]), `${en[k]} | ${ar[k]}`);
  check(`fragments: ${k} is an overlay key (the worker only sends overlay.* to a page)`, /^overlay\./.test(k));
}

const browser = await chromium.launch({ headless: true });

/** One page with the real scripts. `state` is what UQA_GET_STATE answers; `settings` what UQA_GET_SETTINGS answers. */
async function open({ state, settings = {}, strings = en }) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => console.log('       page error:', e.message));
  await page.addInitScript(({ assets, state, settings }) => {
    const real = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) { const r = real.call(this, init); window.__root = r; return r; };
    const sent = (window.__sent = []);
    const listeners = [];
    window.__state = state;
    window.__settings = settings;
    const answer = (m) => {
      switch (m?.type) {
        case 'UQA_OVERLAY_ASSETS': return { ok: true, result: assets };
        case 'UQA_ARMED': return { ok: true, result: { armed: true } };
        case 'UQA_GET_STATE': return { ok: true, result: window.__state };
        case 'UQA_GET_SETTINGS': return { ok: true, result: window.__settings };
        case 'UQA_GET_RULES': return { ok: true, result: [] };
        default: return { ok: true, result: null };
      }
    };
    window.chrome = {
      runtime: {
        id: 'x', lastError: undefined,
        sendMessage: (m, cb) => { sent.push(JSON.parse(JSON.stringify(m))); const r = answer(m); if (cb) setTimeout(() => cb(r), 0); },
        onMessage: { addListener: (f) => listeners.push(f) },
      },
      storage: { sync: { get: (k, cb) => cb && cb({}), set() {} }, local: { get: (k, cb) => cb && cb({}), set() {} }, onChanged: { addListener() {} } },
      i18n: { getUILanguage: () => 'en' },
    };
    window.__deliver = (msg) => listeners.forEach((f) => f(msg, { id: 'x' }, () => {}));
  }, { assets: { faces: [], css, strings, lang: 'en', dir: 'ltr', theme: null }, state, settings });
  await page.route('https://app.test/**', (r) => r.fulfill({ contentType: 'text/html', body: FIXTURE_HTML }));
  await page.goto(FIXTURE);
  for (const code of SCRIPTS) await page.addScriptTag({ content: code });
  await page.waitForFunction(() => !!window.UQAAutopilot && !!window.UQABridge, null, { timeout: 8000 });
  return page;
}

const layers = (page) => page.evaluate(() => (window.__root ? [...window.__root.children].filter((n) => n.tagName !== 'STYLE').map((n) => String(n.className)) : []));
const dotText = (page) => page.evaluate(() => window.__root?.querySelector('.uqa-ap-dot')?.textContent?.trim() ?? null);
const sentOf = (page, type) => page.evaluate((t) => window.__sent.filter((m) => m.type === t), type);
const recordingState = (extra = {}) => ({ recording: true, session: { startedAt: Date.now() - 3 * 60000 - 5000, ...extra }, problems: 0 });
const settle = (page) => page.waitForTimeout(350);
const fail500 = (page, url = '/api/orders/42?token=abc123', status = 500) =>
  page.evaluate(({ url, status }) => window.UQABridge.emit({ kind: 'net', method: 'post', url, status, frameUrl: location.href }), { url, status });

try {
  /* ── 1. the dot ─────────────────────────────────────────────────────────────────────────────────────────────── */
  {
    const page = await open({ state: { recording: false, session: null, problems: 0 } });
    await settle(page);
    check('asleep/idle: nothing is drawn before a session records (lazy)', !(await layers(page)).some((c) => /uqa-ap-/.test(c)), (await layers(page)).join());
    check('asleep/idle: the probe reads dot 0', (await page.evaluate(() => window.UQAAutopilot.probe().dot)) === 0);
    await page.close();
  }
  for (const auto of [false, true]) {
    const page = await open({ state: recordingState(auto ? { autoStarted: true } : {}) });
    await settle(page);
    const tag = auto ? 'auto-started session' : 'manual session';
    check(`${tag}: the dot is drawn (100 % of sessions)`, (await layers(page)).some((c) => /uqa-ap-dot/.test(c)), (await layers(page)).join());
    const text = await dotText(page);
    check(`${tag}: it says ${auto ? 'Auto-recording' : 'Recording'} and 3 min`, new RegExp(`^${auto ? 'Auto-recording' : 'Recording'} · 3 min$`).test(text || ''), String(text));
    const m = await page.evaluate(() => {
      const el = window.__root.querySelector('.uqa-ap-dot');
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const all = [el, ...el.querySelectorAll('*')];
      const hit = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const host = window.__root.host;
      return {
        pe: cs.pointerEvents, role: el.getAttribute('role'), ariaHidden: el.getAttribute('aria-hidden'), live: el.getAttribute('aria-live'),
        anim: all.map((n) => getComputedStyle(n).animationName).filter((a) => a !== 'none'),
        trans: all.map((n) => getComputedStyle(n).transitionDuration).filter((a) => a !== '0s'),
        media: document.querySelectorAll('audio,video').length,
        inPageSel: document.querySelector('[class*="uqa-ap"]') ? 1 : 0,
        inHtml: (() => { const c = document.documentElement.cloneNode(true); c.querySelectorAll('script').forEach((n) => n.remove()); return /uqa-ap|Recording ·/.test(c.outerHTML) ? 1 : 0; })(), // the harness's own <script> tags are not the page
        hitHost: hit.includes(host) ? 1 : 0,
        shadowVisible: host.shadowRoot === null ? 0 : 1,
        size: [Math.round(r.width), Math.round(r.height)], inView: r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      };
    });
    check(`${tag}: pointer-events none`, m.pe === 'none', m.pe);
    check(`${tag}: a status line a screen reader can find, not announced every minute`, m.role === 'status' && m.ariaHidden === null && m.live === 'off', JSON.stringify(m));
    check(`${tag}: no animation, no transition, no sound`, m.anim.length === 0 && m.trans.length === 0 && m.media === 0, JSON.stringify(m));
    check(`${tag}: a page querySelector, outerHTML and elementsFromPoint find nothing; the root is closed`, m.inPageSel === 0 && m.inHtml === 0 && m.hitHost === 0 && m.shadowVisible === 0, JSON.stringify(m));
    check(`${tag}: small and inside the viewport`, m.inView && m.size[0] < 200 && m.size[1] < 40, JSON.stringify(m.size));
    // A page script clicking the host does nothing: no message, no event, the dot stays.
    const before = (await page.evaluate(() => window.__sent.length));
    await page.evaluate(() => { const h = window.__root.host; h.click(); h.dispatchEvent(new MouseEvent('click', { bubbles: true })); h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
    await settle(page);
    check(`${tag}: a page script clicking the host does nothing`, (await page.evaluate(() => window.__sent.length)) === before && (await layers(page)).some((c) => /uqa-ap-dot/.test(c)));
    check(`${tag}: the probe reads dot 1`, (await page.evaluate(() => window.UQAAutopilot.probe().dot)) === 1);
    // Stopping the session takes it down.
    await page.evaluate(() => { window.__state = { recording: false, session: null, problems: 0 }; window.__deliver({ type: 'UQA_STATE_CHANGED', recording: false }); });
    await settle(page);
    check(`${tag}: it goes when the session stops`, !(await layers(page)).some((c) => /uqa-ap-/.test(c)), (await layers(page)).join());
    await page.close();
  }

  /* ── 2. the Settings switch ─────────────────────────────────────────────────────────────────────────────────── */
  {
    const page = await open({ state: recordingState(), settings: { pageIndicator: false } });
    await settle(page);
    check('pageIndicator false: no dot, and no flash of one while the setting loaded', !(await layers(page)).some((c) => /uqa-ap-/.test(c)), (await layers(page)).join());
    await fail500(page);
    await settle(page);
    check('pageIndicator false: no toast either', !(await layers(page)).some((c) => /uqa-ap-/.test(c)));
    await page.evaluate(() => { window.__settings = { pageIndicator: true }; window.__deliver({ type: 'UQA_SETTINGS_CHANGED', settings: window.__settings }); });
    await settle(page);
    check('switched back on in Settings: the dot appears on the next message, no reload', (await layers(page)).some((c) => /uqa-ap-dot/.test(c)));
    await page.evaluate(() => { window.__settings = { pageIndicator: false }; window.__deliver({ type: 'UQA_SETTINGS_CHANGED', settings: window.__settings }); });
    await settle(page);
    check('switched off again: it goes', !(await layers(page)).some((c) => /uqa-ap-dot/.test(c)));
    await page.close();
  }
  {
    const page = await open({ state: recordingState(), settings: {} });
    await settle(page);
    check('a settings object without the field leaves the dot on (on by default)', (await layers(page)).some((c) => /uqa-ap-dot/.test(c)));
    await page.close();
  }

  /* ── 3. the receipt, the auto-screenshot ask, "Not a bug" ───────────────────────────────────────────────────── */
  {
    const page = await open({ state: recordingState() });
    await settle(page);
    await fail500(page);
    await settle(page);
    const t1 = await page.evaluate(() => window.__root.querySelector('.uqa-ap-toast')?.textContent ?? null);
    check('first failure: a toast "Caught: POST /api/orders/42 500", query stripped', /^Caught: POST \/api\/orders\/42 500\s*Not a bug$/.test((t1 || '').trim()) && !/\?|abc123/.test(t1 || ''), String(t1));
    const asks = await sentOf(page, 'UQA_SHOT_AUTO');
    check('first failure: exactly one UQA_SHOT_AUTO, carrying the dupes key and the what', asks.length === 1 && asks[0].key.startsWith('net|POST|') && asks[0].what === 'POST /api/orders/42 500', JSON.stringify(asks));
    check('first failure: the key carries no query value', asks.length === 1 && !/abc123/.test(asks[0].key), JSON.stringify(asks));
    await fail500(page, '/api/orders/77?token=zzz9');
    await settle(page);
    check('second failure of the same kind: no new ask', (await sentOf(page, 'UQA_SHOT_AUTO')).length === 1);
    await fail500(page, '/api/other', 404);
    await settle(page);
    check('a failure of another kind: a second ask and the toast now names it', (await sentOf(page, 'UQA_SHOT_AUTO')).length === 2 && /POST \/api\/other 404/.test(await page.evaluate(() => window.__root.querySelector('.uqa-ap-toast')?.textContent ?? '')));
    check('the toast and the dot do not move layout (fixed, outside the page flow)', await page.evaluate(() => {
      const el = window.__root.querySelector('.uqa-ap-toast');
      return getComputedStyle(el).position === 'fixed' && getComputedStyle(el).pointerEvents === 'none' && document.documentElement.scrollHeight <= innerHeight;
    }));
    // An untrusted click on the button does nothing; a real one sends `expected` with the key.
    const keyAsk = (await sentOf(page, 'UQA_SHOT_AUTO'))[1].key;
    await page.evaluate(() => window.__root.querySelector('.uqa-ap-toast button').click());
    await settle(page);
    check('"Not a bug": a page-script click (untrusted) sends nothing', (await sentOf(page, 'UQA_EVENT')).filter((m) => m.event?.kind === 'expected').length === 0);
    const box = await page.evaluate(() => { const r = window.__root.querySelector('.uqa-ap-toast button').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.click(box.x, box.y);
    await settle(page);
    const exp = (await sentOf(page, 'UQA_EVENT')).filter((m) => m.event?.kind === 'expected');
    check('"Not a bug": a real click sends one expected event with the forKey of that failure', exp.length === 1 && exp[0].event.forKey === keyAsk, JSON.stringify(exp));
    check('"Not a bug": the toast goes and is replaced by a one-line confirmation', !(await layers(page)).some((c) => /uqa-ap-toast/.test(c)));
    await page.close();
  }
  {
    // Visible and focused only: a hidden or unfocused top frame still shows the toast but asks for nothing.
    const page = await open({ state: recordingState() });
    await settle(page);
    await page.evaluate(() => { document.hasFocus = () => false; });
    await fail500(page);
    await settle(page);
    check('page without focus: the toast shows, no UQA_SHOT_AUTO is asked', (await sentOf(page, 'UQA_SHOT_AUTO')).length === 0 && (await layers(page)).some((c) => /uqa-ap-toast/.test(c)));
    await page.close();
  }
  {
    // Failures only, console and page errors included; a 200 and a note are not failures.
    const page = await open({ state: recordingState() });
    await settle(page);
    await page.evaluate(() => {
      window.UQABridge.emit({ kind: 'net', method: 'GET', url: '/ok', status: 200 });
      window.UQABridge.emit({ kind: 'note', text: 'hello' });
      window.UQABridge.emit({ kind: 'console', level: 'log', text: 'fine' });
    });
    await settle(page);
    check('a 200, a note and a log line ask for nothing and show nothing', (await sentOf(page, 'UQA_SHOT_AUTO')).length === 0 && !(await layers(page)).some((c) => /uqa-ap-toast/.test(c)));
    await page.evaluate(() => window.UQABridge.emit({ kind: 'console', level: 'error', text: 'Boom at https://x.test/a?token=sekret', frameUrl: location.href }));
    await settle(page);
    const t = await page.evaluate(() => window.__root.querySelector('.uqa-ap-toast')?.textContent ?? '');
    check('a console error: a toast with the text cut short and any query stripped', /Caught: Boom at https:\/\/x\.test\/a/.test(t) && !/sekret/.test(t), t);
    await page.close();
  }

  /* ── 4. key parity with core/dupes.js ───────────────────────────────────────────────────────────────────────── */
  {
    const page = await open({ state: { recording: false, session: null, problems: 0 } });
    const f = 'https://app.test/shop/cart';
    const events = [
      { kind: 'net', method: 'post', url: '/api/orders/42?x=1&a=2', status: 500, frameUrl: f },
      { kind: 'net', method: 'GET', url: 'https://app.test/api/items/3f2b8c1e-aaaa-bbbb-cccc-1234567890ab', status: 404, frameUrl: f },
      { kind: 'net', method: 'GET', url: '/gql', ev: 'gql', operation: 'Cart', frameUrl: f },
      { kind: 'net', method: 'GET', url: '/slow', error: true, en: 'timeout', frameUrl: f },
      { kind: 'net', url: 'not a url', status: 502 },
      { kind: 'console', level: 'error', text: 'Failed 123 items: "an extremely long quoted string that goes on and on for far more than forty chars"', stack: 'Error: x\n    at foo (https://app.test/static/app.js:10:5)' },
      { kind: 'pageerror', text: 'TypeError: a is undefined deadbeefdeadbeef', src: 'https://app.test/main.js:77:3' },
      { kind: 'rep', ofKind: 'console', text: 'Failed 9 items', src: 'https://app.test/a.js:1' },
    ];
    const keys = await page.evaluate((evs) => evs.map((e) => window.UQAAutopilot.kindKey(e)), events);
    events.forEach((e, i) => check(`key parity ${i + 1} (${e.kind}): content kindKey equals core dupeKey`, keys[i] === dupeKey(e), `${keys[i]} vs ${dupeKey(e)}`));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`page indicator: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
