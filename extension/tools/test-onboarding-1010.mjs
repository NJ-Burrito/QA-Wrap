/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * features-1010 lane O: one-press "Test this site", "Remember this site", the shorter welcome, the packaged practice page.
 *
 *   node tools/test-onboarding-1010.mjs
 *
 * The shortcut case is the regression this file exists for: Alt+Shift+Q on a window that was never woken used to throw
 * `asleepError` out of startSession (service-worker.js, "Recording is a capability like any other"). The command handler is
 * lifted out of the real worker and run against stubs, so what is tested is the shipped code, not a copy.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { endOfBlock } from './lib-lift.mjs';
import * as remember from '../background/remember.js';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(EXT, ...p), 'utf8');
const en = JSON.parse(read('platform', 'i18n', 'en.json'));
const ar = JSON.parse(read('platform', 'i18n', 'ar.json'));
const sw = workerSrc();

let n = 0;
let failed = 0;
let chain = Promise.resolve(); // one at a time: the rigs below replace globalThis.chrome
const pending = [];
const test = (name, fn) => {
  chain = chain.then(fn).then(
    () => { n++; console.log(`  ok  ${name}`); },
    (e) => { n++; failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
  );
  pending.push(chain);
};

/** The body of a listener registered as `on(<target>, '<label>', async (...) => { ... })`, rebuilt as a function. */
function lift(label, params, names) {
  const at = sw.indexOf(`'${label}', async (${params}) => {`);
  assert.ok(at > 0, `${label} listener not found in the worker`);
  const open = sw.indexOf('{', sw.indexOf('=>', at));
  const close = endOfBlock(sw, open);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  return new AsyncFunction(...params.split(',').map((s) => s.trim()), ...names, sw.slice(open + 1, close));
}

/* ── the shortcut: Alt+Shift+Q on a sleeping window ─────────────────────────────────────────────── */
const SHORTCUT_NAMES = ['TESTABLE', 'isInternalUrl', 'testableTabId', 'noteInvoked', 'armed', 'sayLoudly', 'tw', 'sessionsByWindow', 'sessionIn', 'activeSessionId', 'stopSession', 'startSession', 'handlers', 'site', 'remember', 'notify', 'refusalText', 'commandLabel', 'chrome', 'isInternalUrl'];
function shortcutRig({ armedNow, allowed }) {
  const calls = { arm: [], start: [], said: [] };
  const tab = { id: 7, windowId: 3, url: 'https://shop.example.com/cart' };
  const env = {
    TESTABLE: /^https?:/,
    isInternalUrl: () => false,
    testableTabId: async () => tab.id,
    noteInvoked: async () => {},
    armed: { isArmedTab: async () => armedNow, isArmedWindow: async () => armedNow, ASLEEP: 'asleep' },
    sayLoudly: async (_t, text) => { calls.said.push(text); },
    tw: async (_k, fallback) => fallback,
    sessionsByWindow: async () => ({}),
    sessionIn: () => null,
    activeSessionId: async () => null,
    stopSession: async () => {},
    startSession: async (a) => { if (!armedNow && !calls.arm.length) throw Object.assign(new Error('asleep'), { code: 'ASLEEP' }); calls.start.push(a); },
    handlers: { UQA_ARM: async (m) => { calls.arm.push(m.windowId); } },
    site: { hasSiteAccess: async () => allowed },
    remember,
    notify: async () => {},
    refusalText: async (e) => e.message,
    commandLabel: async (c) => c,
    chrome: { tabs: { query: async () => [tab] } },
  };
  const fn = lift('commands.onCommand', 'command, tab', SHORTCUT_NAMES.filter((v, i, a) => a.indexOf(v) === i));
  const run = () => fn('toggle-recording', tab, ...SHORTCUT_NAMES.filter((v, i, a) => a.indexOf(v) === i).map((k) => env[k]));
  return { run, calls };
}
test('shortcut on a sleeping window with the site allowed wakes it, then starts (no asleepError)', async () => {
  const { run, calls } = shortcutRig({ armedNow: false, allowed: true });
  await run();
  assert.deepEqual(calls.arm, [3]);
  assert.equal(calls.start.length, 1);
  assert.deepEqual(calls.said.filter((s) => /asleep|failed/i.test(s)), []);
});
test('shortcut on a sleeping window with no site grant starts nothing and says the one next step', async () => {
  const { run, calls } = shortcutRig({ armedNow: false, allowed: false });
  await run();
  assert.equal(calls.start.length, 0);
  assert.equal(calls.arm.length, 0);
  assert.ok(calls.said.some((s) => /Test this site/.test(s)), `message was: ${calls.said.join(' | ')}`);
});
test('shortcut on an awake window just starts (no second wake)', async () => {
  const { run, calls } = shortcutRig({ armedNow: true, allowed: true });
  await run();
  assert.equal(calls.arm.length, 0);
  assert.equal(calls.start.length, 1);
});
test('the shortcut message exists in both languages and names the button', () => {
  assert.match(en["common.worker.shortcutNeedsSite"], /Test this site/);
  assert.match(ar["common.worker.shortcutNeedsSite"], /اختبر هذا الموقع/);
});

/* ── Remember this site: the worker side ────────────────────────────────────────────────────────── */
function wakeRig({ remembered, allowed = true, consent = true, woke = [], armedNow = false }) {
  const calls = { arm: [], setSession: [] };
  globalThis.chrome = {
    storage: {
      local: { get: async () => ({ rememberedSites: remembered }) },
      session: { get: async () => ({ rememberWoke: woke }), set: async (v) => { calls.setSession.push(v); } },
    },
    tabs: { get: async () => ({ windowId: 5 }) },
  };
  const deps = {
    site: { originPattern: (u) => `${new URL(u).protocol}//${new URL(u).host}/*`, hasSiteAccess: async () => allowed },
    armed: { consentCurrent: async () => consent, isArmedWindow: async () => armedNow },
    arm: async (m) => { calls.arm.push(m.windowId); },
  };
  return { run: (d) => remember.autoWake(d, deps), calls };
}
const nav = { frameId: 0, tabId: 1, url: 'https://shop.example.com/cart' };
test('a remembered, allowed site wakes its window once', async () => {
  const { run, calls } = wakeRig({ remembered: ['https://shop.example.com/*'] });
  await run(nav);
  assert.deepEqual(calls.arm, [5]);
  assert.deepEqual(calls.setSession, [{ rememberWoke: [5] }]);
});
test('off by default: a site that was not remembered never wakes', async () => {
  for (const remembered of [undefined, [], ['https://other.example.com/*']]) {
    const { run, calls } = wakeRig({ remembered });
    await run(nav);
    assert.equal(calls.arm.length, 0);
  }
});
test('remembering does not bypass the grant or the consent', async () => {
  for (const o of [{ allowed: false }, { consent: false }]) {
    const { run, calls } = wakeRig({ remembered: ['https://shop.example.com/*'], ...o });
    await run(nav);
    assert.equal(calls.arm.length, 0);
  }
});
test('a window woken once stays asleep after a deliberate sleep; sub-frames never wake', async () => {
  const again = wakeRig({ remembered: ['https://shop.example.com/*'], woke: [5] });
  await again.run(nav);
  assert.equal(again.calls.arm.length, 0);
  const sub = wakeRig({ remembered: ['https://shop.example.com/*'] });
  await sub.run({ ...nav, frameId: 2 });
  assert.equal(sub.calls.arm.length, 0);
});

/* ── the popup: one press, inside the gesture ───────────────────────────────────────────────────── */
const popupJs = read('popup', 'popup.js');
const onboardJs = read('popup', 'onboard.js');
test('Test this site asks Chrome for the site before the first await, in the click handler and in startOneTap', () => {
  const at = popupJs.indexOf("$('start').addEventListener('click', async () => {");
  assert.ok(at > 0);
  const body = popupJs.slice(at, popupJs.indexOf('\n});', at));
  assert.ok(body.indexOf('startOneTap()') > 0 && body.indexOf('startOneTap()') < body.indexOf('await '), 'startOneTap() must run before the first await of the click');
  const one = onboardJs.slice(onboardJs.indexOf('function startOneTap()'), onboardJs.indexOf('/** Asleep the button'));
  assert.ok(one.indexOf('requestSite()') > 0 && one.indexOf('requestSite()') < one.indexOf('await '), 'permissions.request would run after an await and be refused');
  assert.ok(one.indexOf('siteGranted()') < one.indexOf("type: 'UQA_ARM'"), 'wake follows the grant');
  assert.ok(body.indexOf('await oneTap') < body.indexOf("type: 'UQA_START'"), 'start follows the wake');
});
test('Start stays enabled while asleep, the name is asked at stop, the remember box is off by default', () => {
  assert.match(popupJs, /control\.id !== 'start'/);
  const html = read('popup', 'popup.html');
  assert.match(html, /id="done-name-row"[^>]*hidden/);
  assert.match(html, /<input type="checkbox" id="remember-site" \/>/, 'the box carries no checked attribute');
  assert.match(html, /id="start-label" data-i18n="popup.onboard.testSite"/);
  assert.match(sw, /UQA_RENAME: \(msg\) => remember\.renameSession/);
  assert.match(read('popup', 'popup.html'), /<script defer src="onboard\.js"><\/script>/);
  assert.ok(!/qa-wrap\/try|\}\/try/.test(popupJs + onboardJs), 'the popup still opens the hosted practice page');
});
test('the practice link opens the packaged page, not a website', () => {
  assert.match(onboardJs, /chrome\.runtime\.getURL\('practice\/practice\.html'\)/);
  assert.match(read('welcome', 'welcome.js'), /getURL\('practice\/practice\.html'\)/);
});

/* ── Options: manageable and removable ──────────────────────────────────────────────────────────── */
test('Settings lists remembered sites, removes one, and forgets all', () => {
  const html = read('options', 'options.html');
  const js = read('options', 'remembered.js');
  assert.ok(html.includes('id="remembered-list"') && html.includes('id="forget-sites"') && html.includes('src="remembered.js"'));
  assert.ok(/rememberedSites: list\.filter/.test(js) && /remove\('rememberedSites'\)/.test(js));
});
test('privacy: PRIVACY.md and the welcome page (both languages) say what is kept, and the registry knows the keys', () => {
  assert.match(read('PRIVACY.md'), /Wake up on this site by itself next time\* is off until you tick it/);
  const w = read('welcome', 'welcome.html');
  assert.match(w, /is off until you tick it: it keeps that site&rsquo;s address on this machine only/);
  assert.match(w, /مغلق حتى تفعّله: يحفظ عنوان الموقع على هذا الجهاز فقط/);
  const reg = read('core', 'store-registry.js');
  assert.ok(reg.includes("loc('rememberedSites'") && reg.includes("'rememberWoke'"));
});

/* ── the welcome page ───────────────────────────────────────────────────────────────────────────── */
const welcome = read('welcome', 'welcome.html');
test('welcome: three facts visible, the full eight inside one disclosure, in both languages', () => {
  const keyFacts = welcome.slice(welcome.indexOf('id="key-facts"'), welcome.indexOf('</ul>', welcome.indexOf('id="key-facts"')));
  assert.equal((keyFacts.match(/<li class="key">/g) || []).length, 3);
  const details = welcome.slice(welcome.indexOf('<details class="all-facts"'), welcome.indexOf('</details>'));
  assert.equal((details.match(/<li class="point">/g) || []).length, 8, 'all eight facts are in the DOM under the disclosure');
  assert.equal((details.match(/<div class="side" dir="rtl" lang="ar"/g) || []).length, 8);
  assert.equal((details.match(/<div class="side" dir="ltr" lang="en"/g) || []).length, 8);
  assert.ok(!/<details[^>]*\sopen/.test(welcome), 'the disclosure starts closed');
  assert.ok(welcome.indexOf('id="accept"') < welcome.indexOf('<details class="all-facts"'), 'the accept button is above the disclosure');
  assert.ok(/id="accept"/.test(welcome) && /accept\?\.focus\(\)/.test(read('welcome', 'welcome.js')), 'accept is focused on load');
});
test('welcome: the done state says pin the icon and click it, with a picture, in both languages', () => {
  const done = welcome.slice(welcome.indexOf('id="done"'), welcome.indexOf('id="failed"'));
  assert.match(done, /pin QA Wrap, then click its icon/);
  assert.match(done, /ثبّت QA Wrap ثم اضغط أيقونته/);
  assert.match(done, /<svg[^>]*viewBox/);
  assert.match(done, /id="done-practice"/);
});

/* ── the practice page ──────────────────────────────────────────────────────────────────────────── */
test('faults fixture (practice/faults.html, the page before the Bug Hunt game): packaged, four planted faults, no network address, Thmanyah only, RTL-safe', () => {
  const html = read('practice', 'faults.html');
  const css = read('practice', 'faults.css');
  const js = read('practice', 'faults.js');
  assert.ok(!/https?:\/\//.test(html + css + js.replace(/https?:\/\/www\.w3\.org/g, '')), 'a network address is in the practice page');
  assert.ok(!/font-family/.test(css), 'the practice page names a typeface of its own; it must inherit Thmanyah from ui/fonts.css');
  assert.ok(html.includes('../ui/fonts.css'));
  assert.ok(!/\b(margin|padding|border)-(left|right)\b|\b(left|right)\s*:/.test(css), 'physical left/right breaks RTL');
  assert.ok(/fetch\('api\/save-profile'/.test(js) && /console\.error\(/.test(js), 'failing request and console error');
  assert.ok(/globalThis\.__coupons/.test(js) && /Fault 3/.test(js), 'throwing button and dead button');
  assert.ok(/\.order-ref \{ white-space: nowrap/.test(css) && /9ch/.test(css), 'layout overflow');
  assert.ok(!/<dialog|alert\(|confirm\(/.test(html + js), 'a modal is planted');
  assert.ok(!/id="p-next"[^>]*onclick/.test(html) && !/p-next/.test(js), 'the Next button has no handler');
});
test('faults fixture: every welcome.practice key used exists in EN and AR, and Arabic is not the English copied across', () => {
  const html = read('practice', 'faults.html');
  const keys = [...new Set([...html.matchAll(/data-i18n="(welcome\.practice\.\w+)"/g)].map((m) => m[1]).concat(['welcome.practice.saved']))];
  assert.ok(keys.length >= 15);
  for (const k of keys) {
    assert.ok(en[k] && ar[k], `${k} missing`);
    assert.notEqual(en[k], ar[k], `${k} is not translated`);
    assert.ok(/[؀-ۿ]/.test(ar[k]), `${k} has no Arabic`);
  }
  for (const k of Object.keys(en).filter((x) => /^(onb|practice)./.test(x))) assert.ok(ar[k], `${k} missing in ar`);
});
test('practice page is recognised by the worker as testable, and is the only extension page that is', async () => {
  globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://abc/${p}` } };
  const { isPracticeUrl, pageLike } = await import('../background/site-access.js');
  assert.ok(isPracticeUrl('chrome-extension://abc/practice/practice.html'));
  assert.ok(pageLike('chrome-extension://abc/practice/practice.html') && pageLike('https://a.example/') && pageLike('file:///x.html'));
  assert.ok(!pageLike('chrome-extension://abc/report/report.html') && !pageLike('chrome://extensions') && !pageLike(''));
  assert.ok(!isPracticeUrl('chrome-extension://other/practice/practice.html'));
});

test('practice page carries the recorder itself: the same files in the same order as site-access SITE_SCRIPTS, page-hooks first', async () => {
  // Chrome refuses scripting.executeScript on an extension page, so the registered content scripts can never reach it.
  const { SITE_SCRIPTS } = await import('../background/site-access.js');
  const html = read('practice', 'practice.html');
  const loaded = [...html.matchAll(/<script src="\.\.\/content\/([\w-]+\.js)"/g)].map((m) => `content/${m[1]}`);
  // data-injector.js (Nasty values) is an on-demand tool; executeScript cannot reach this page, so the page carries it too, after the recorder (it needs UQABridge and UQAUiHost).
  const wanted = ['content/page-hooks.js', ...SITE_SCRIPTS.flatMap((s) => s.js), 'content/data-injector.js'];
  assert.deepEqual(loaded, wanted);
  assert.ok(html.includes('../content/overlay.css'));
});

await Promise.all(pending);
console.log(`\n${n - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
