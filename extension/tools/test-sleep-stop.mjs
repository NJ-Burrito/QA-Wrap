/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Sleep is a full stop (6 Oct 2026, Nader: "when I Sleep it still masks").
 *
 * The real mask.js, replay-recorder.js and vitals.js run in headless Chromium against a stubbed worker. Each page
 * script must stop by itself when it hears `UQA_ARMED_CHANGED false`, when `window.UQAAwake` is false, or when a
 * page restored from the back/forward cache asks the worker and is told "asleep"; no `data-uqa-masked` may remain,
 * paint is refused while asleep, and Wake brings the scripts back with an empty list. Plus source pins for the
 * worker side (`sleepWindow` broadcasts armed:false and ends a Measure) and the pickers.
 *
 *   node tools/test-sleep-stop.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); }
};

// Source pins: the cheapest checkpoint.
const sw = workerSrc();
const sleepFn = sw.slice(sw.indexOf('async function sleepWindow('), sw.indexOf('function announceArmed('));
check('sleepWindow broadcasts armed:false to the window', /tellWindow\(windowId, \{ type: 'UQA_ARMED_CHANGED', armed: false \}\)/.test(sleepFn));
check('sleepWindow ends a running Measure (detaches the debugger)', /stopMeasureIn\(windowId\)/.test(sleepFn) && /whitebox\.ensureDetached\(id\)/.test(sw));
check('the armed:false broadcast is sent before the mask clear', sleepFn.indexOf('armed: false }') < sleepFn.indexOf("{ type: 'UQA_MASK_CLEAR' }"));
for (const f of ['content/mask.js', 'content/replay-recorder.js', 'content/vitals.js', 'content/picker.js', 'content/rtl-stress.js']) {
  check(`${f} listens for UQA_ARMED_CHANGED`, /UQA_ARMED_CHANGED/.test(read(f)));
}
const maskSrc = read('content/mask.js');
check('mask.js re-checks on pageshow and visibilitychange', /addEventListener\('pageshow', recheckSleep\)/.test(maskSrc) && /visibilitychange/.test(maskSrc));

// Behaviour in a real DOM.
const HTML = '<!doctype html><body><p id="p">Secret name</p><p id="q">Other</p><input id="i" value="x"></body>';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  await page.setContent(HTML);
  await page.evaluate(() => {
    window.__listeners = [];
    window.__armed = true; // what the stub worker answers to UQA_ARMED
    window.chrome = {
      runtime: {
        id: 'ext',
        lastError: null,
        onMessage: { addListener: (fn) => window.__listeners.push(fn) },
        sendMessage: (m, cb) => cb && cb({ result: { recording: false } }),
      },
    };
    window.UQABridge = {
      send: async (m) => (m.type === 'UQA_ARMED' ? { result: { armed: window.__armed } } : { result: { masks: [] } }),
    };
    window.__msg = (m) => new Promise((resolve) => {
      for (const fn of window.__listeners) {
        const r = fn(m, { id: 'ext' }, (res) => resolve(res));
        if (r === true) return;
      }
      resolve(undefined);
    });
  });
  for (const f of ['content/selector-engine.js', 'content/mask.js', 'content/replay-recorder.js', 'content/vitals.js']) {
    await page.addScriptTag({ content: read(f) });
  }
  const masked = () => page.evaluate(() => document.querySelectorAll('[data-uqa-masked]').length);
  const entry = { id: 'm1', path: '#p', index: 0, name: 'Secret name', tag: 'p' };
  const apply = () => page.evaluate((e) => window.__msg({ type: 'UQA_MASK_APPLY', masks: [e] }), entry);

  await page.evaluate(() => { window.UQAAwake = true; });
  await apply();
  check('awake: a mask is painted', (await masked()) === 1);

  // 1 - the broadcast
  await page.evaluate(() => window.__msg({ type: 'UQA_ARMED_CHANGED', armed: false }));
  check('Sleep broadcast: every mask comes off', (await masked()) === 0);
  check('Sleep broadcast: the list is emptied', (await page.evaluate(() => window.UQAMask.count())) === 0);

  // 2 - a stale apply after Sleep is refused
  const res = await apply();
  check('asleep: a late UQA_MASK_APPLY paints nothing', (await masked()) === 0 && res?.count === 0, JSON.stringify(res));
  await page.evaluate(() => { window.UQAMask.apply(); });
  check('asleep: apply() paints nothing', (await masked()) === 0);
  const pick = await page.evaluate(() => window.__msg({ type: 'UQA_MASK_PICK' }));
  const crosshair = await page.evaluate(() => document.documentElement.classList.contains('uqa-masking'));
  check('asleep: the pick mode will not start', pick?.picking === false && !crosshair, JSON.stringify(pick));

  // 3 - Wake: starts clean, scripts work again
  await page.evaluate(() => { window.UQAAwake = true; });
  check('wake: the list is empty, not restored', (await page.evaluate(() => window.UQAMask.count())) === 0);
  await apply();
  check('wake: masking works again', (await masked()) === 1);

  // 4 - a page that missed the message (bfcache): pageshow asks the worker
  await page.evaluate(() => { window.__armed = false; window.dispatchEvent(new Event('pageshow')); });
  await page.waitForTimeout(200);
  check('missed message: pageshow clears the masks by itself', (await masked()) === 0);
  await page.evaluate(() => { window.__armed = true; window.UQAAwake = true; });
  await apply();
  await page.evaluate(() => {
    window.__armed = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  check('missed message: visibilitychange clears the masks by itself', (await masked()) === 0);

  // 5 - the observer must not repaint after Sleep
  await page.evaluate(() => { window.__armed = true; window.UQAAwake = true; });
  await apply();
  await page.evaluate(() => {
    window.UQAAwake = false;
    document.body.append(Object.assign(document.createElement('p'), { textContent: 'later' }));
  });
  await page.waitForTimeout(200);
  check('asleep: the mutation observer clears and does not repaint', (await masked()) === 0);

  // 6 - replay recorder and vitals
  const rec = await page.evaluate(async () => {
    const R = window.UQAReplayRecorder;
    window.UQAAwake = false; R._start('s1');
    const asleepStart = R.isRecording();
    window.UQAAwake = true; R._start('s1');
    const awakeStart = R.isRecording();
    await window.__msg({ type: 'UQA_ARMED_CHANGED', armed: false });
    return { asleepStart, awakeStart, after: R.isRecording(), following: R.isFollowing() };
  });
  check('replay recorder: refuses to start while asleep', rec.asleepStart === false);
  check('replay recorder: starts when awake', rec.awakeStart === true);
  check('replay recorder: Sleep stops it and drops the observer', rec.after === false && rec.following === false, JSON.stringify(rec));
  const vit = await page.evaluate(() => { window.UQAAwake = false; return window.__msg({ type: 'UQA_COLLECT_VITALS' }); });
  check('vitals: refuses to report while asleep', vit?.error === 'asleep', JSON.stringify(vit));
  const vitAwake = await page.evaluate(async () => {
    await window.__msg({ type: 'UQA_ARMED_CHANGED', armed: true });
    window.UQAAwake = true;
    return window.__msg({ type: 'UQA_COLLECT_VITALS' });
  });
  check('vitals: reports again after Wake', !!vitAwake?.url && !vitAwake.error, JSON.stringify(vitAwake)?.slice(0, 120));
} finally {
  await browser.close();
}
console.log(`sleep full stop: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
