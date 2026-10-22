/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-050 and T-060, through the real caller: the first run on the practice page, in a real
 * headed Chromium (secondary monitor, pinned topmost) with the granted extension, twice. Once with the mouse (Wake, Start, click
 * Save, Stop, Open full report: the headline names the click and the 500) and once with the
 * keyboard alone (Tab, Enter, Space, Alt+KeyB, Escape: a visible focus ring at every stop, and no
 * trap). The practice page is served from site/try on 127.0.0.1, a secure origin, so its service
 * worker (the one that answers the save with a 500) registers.
 *
 *   node tools/test-first-run-live.mjs
 *
 * Every read waits for the element that exists only after boot (R15): body[data-ready], the live
 * step, `#verdict:not([hidden]) #btn-file` on the report. Headed (D-1010-117: the D-66 defect was a throttled-window
 * first frame, which only a visible window proves), one browser at a time, closed on exit. Profiles carry the tag
 * council-1010 and are sent to the recycle bin (trash.py); a profile that cannot be recycled turns the suite red (D-1010-118).
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { TRASH } from './lib-trash.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { grantedExtension, awaitSiteScripts, seedConsent } from './lib-granted.mjs';
import { FOCUS_PROBE, ringVisible, outlineOpaque, describeFocus } from './lib-focus-ring.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.otf': 'font/otf', '.png': 'image/png' };
let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const file = path.join(SITE, u);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const PRACTICE = `${ORIGIN}/try/`;

const EXT = grantedExtension({ label: 'council-1010-firstrun' });
const profiles = [];
let context;
let top;
const errors = [];
const trash = (d) => {
  if (!d || !fs.existsSync(d)) return;
  const r = spawnSync('python', [TRASH, d], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  if (r.status !== 0) check(false, `recycle ${path.basename(d)}`, `could not send ${d} to the recycle bin: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`);
};
/** One fresh browser per run: a first run has no session behind it, so the second run gets its own profile. */
async function boot() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uqa-council-1010-firstrun-'));
  profiles.push(profile);
  purgeWorkerCache(profile);
  context = await chromium.launchPersistentContext(profile, launchOptions(EXT, { width: 1100, height: 900, headed: true }));
  top = await keepOnTop(context);
  const worker = await freshWorker(context);
  await seedConsent(worker);
  await awaitSiteScripts(worker);
  return { worker, id: new URL(worker.url()).host };
}

const openPractice = async () => {
  const page = await context.newPage();
  await page.goto(PRACTICE, { waitUntil: 'load' });
  // the practice page's own worker answers the save: wait until it controls the page
  const controlled = () => page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
  await controlled().catch(async () => { await page.reload({ waitUntil: 'load' }); await controlled(); });
  return page;
};
const openPopup = async (id) => {
  const popup = await context.newPage();
  popup.on('pageerror', (e) => errors.push(`popup: ${e.message}`));
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
  await popup.evaluate(() => { window.close = () => {}; });
  return popup;
};
const reportOf = async (via) => {
  await via();
  // not just "the next page": a fresh install also opens its welcome tab, at a time of its own choosing
  let report;
  for (let i = 0; i < 150 && !report; i++) {
    report = context.pages().find((p) => p.url().includes('/report/report.html'));
    if (!report) await new Promise((r) => setTimeout(r, 100));
  }
  if (!report) throw new Error(`no report page opened; pages: ${context.pages().map((p) => p.url()).join(' ')}`);
  await report.waitForSelector('#verdict:not([hidden]) #btn-file', { timeout: 25000 }).catch(async (e) => {
    const body = await report.evaluate(() => `${document.body.innerText.slice(0, 200)} | verdict hidden=${document.getElementById('verdict')?.hidden}`).catch((x) => String(x));
    throw new Error(`${e.message.split(String.fromCharCode(10))[0]} at ${report.url()}: ${body.split(String.fromCharCode(10)).join(' ')}`);
  });
  return report;
};

/**
 * The popup repaints "Awake" at once and the worker registers the page scripts a moment later, so
 * the proof that the page is awake is the page's own flag and its recorder (R15), not the popup.
 */
const pageAwake = (worker, recording = false) => worker.evaluate(async ([o, rec]) => {
  const until = Date.now() + 10000;
  for (;;) {
    const t = (await chrome.tabs.query({})).find((x) => x.url.startsWith(o));
    const r = t && await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'ISOLATED', func: (needRec) => window.UQAAwake === true && !!window.__UQA_RECORDER__ && (!needRec || window.UQABridge?.isRecording?.() === true), args: [rec] }).catch(() => null);
    if (r?.[0]?.result) return true;
    if (Date.now() > until) return false;
    await new Promise((q) => setTimeout(q, 100));
  }
}, [ORIGIN, recording]);

/** The same probe, run where the content script lives, so it can see inside the bar's closed shadow root. */
let W;
const isoProbe = () => W.evaluate(`(async () => {
  const t = (await chrome.tabs.query({})).find((x) => x.url.startsWith(${JSON.stringify(ORIGIN)}));
  const r = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'ISOLATED', func: ${FOCUS_PROBE.toString()} });
  return r[0].result;
})()`);
const probe = async (pg, inPage) => { const d = await pg.evaluate(FOCUS_PROBE); return inPage && d.tag === 'qaw-ui' ? isoProbe() : d; };

/** Press Tab until `until` holds on the focused element. Every stop must show a ring; none may repeat. */
const stops = [];
let wraps = 0;
async function tabTo(pg, label, until, max = 60, inPage = false) {
  const here = [];
  const reset = () => pg.evaluate(() => { window.__uqaFocusSeen = new WeakSet(); });
  await reset();
  for (let i = 0; i < max; i++) {
    await pg.keyboard.press('Tab');
    let firstAgain = null;
    if (i === 0) { // D-1010-66: the very first look, before any animation can advance, must already show a painted outline
      const first = await probe(pg, inPage);
      firstAgain = first.again; // the immediate look marks the element seen; the visit check below must not count it
      if (!first.none) check(outlineOpaque(first), `${label}: the ring is painted at the first frame after Tab`, describeFocus(first));
    }
    await pg.waitForTimeout(250); // a ring that fades in is a ring: let any outline transition finish
    let d = await probe(pg, inPage);
    const again = firstAgain ?? d.again; // only the first look at an element can say it was visited before
    for (let k = 1; k <= 6 && !d.none && !ringVisible(d); k++) { await pg.waitForTimeout(300); d = await probe(pg, inPage); d.lateMs = k * 300; }
    d.again = again;
    if (d.lateMs) console.log(`     ring on ${d.tag}#${d.id || d.cls} visible after ${d.lateMs} ms more: ${ringVisible(d)} (${d.outlineColor})`);
    here.push(d);
    if (d.none) { wraps++; await reset(); continue; } // focus left the document (the browser's own controls): that is the way out, not a trap
    const tag = `${label} stop ${i + 1} (${d.tag || 'none'}#${d.id || d.cls || d.name})`;
    stops.push({ tag, ok: ringVisible(d), d });
    if (d.again) { check(false, `${label}: no keyboard trap before the target`, `${tag} was reached twice; path: ${here.map((x) => `${x.tag}#${x.id || x.cls}`).join(' > ')}`); return null; }
    if (until(d)) return d;
  }
  check(false, `${label}: the target was reached by Tab within ${max} stops`, here.map((d) => `${d.tag}#${d.id}`).join(' '));
  return null;
}
const press = async (pg, key) => { await pg.keyboard.press(key); await pg.waitForTimeout(150); };

let code = 1;
try {
  let { worker, id } = await boot();

  /* ── T-050: the mouse run ──────────────────────────────────────────────── */
  console.log('first run, mouse: Wake, Start, click Save, Stop, Open full report');
  const page = await openPractice();
  const popup = await openPopup(id);
  await popup.click('#switch');
  await popup.waitForFunction(() => document.body.dataset.awake === 'true', null, { timeout: 10000 });
  check(await pageAwake(worker), 'Wake: the page itself is awake and its recorder is in');
  await popup.fill('#charter', 'Practice page: Save changes fails');
  await popup.click('#start');
  await popup.waitForFunction(() => !document.getElementById('step-live').hidden, null, { timeout: 10000 });
  check(await pageAwake(worker, true), 'Start: the live step is showing and the page is recording');
  await page.bringToFront();
  await page.click('#save');
  await page.waitForFunction(() => /Could not save/.test(document.getElementById('status').textContent), null, { timeout: 10000 });
  check(true, 'the page answered the click with its planted failure');
  await page.waitForTimeout(800);
  // completion review 3 (T-066): a stored screenshot, so the report has a real Origin button to click.
  const shot = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'UQA_CAPTURE', text: 'origin check' }));
  check(shot?.ok === true, 'a screenshot is stored for the Origin check', JSON.stringify(shot)?.slice(0, 200));
  await popup.click('#stop');
  await popup.waitForFunction(() => !document.getElementById('step-done').hidden, null, { timeout: 15000 });
  const report = await reportOf(() => popup.click('#view-report'));
  const headline = await report.textContent('#v-h');
  const steps = await report.$$eval('#verdict .steps li', (n) => n.map((x) => x.textContent));
  console.log(`     headline: ${headline}`);
  check(/500/.test(headline || ''), 'the headline names the 500', headline);
  const did = await report.locator('#verdict .v-row', { hasText: 'You did' }).first().textContent().catch(() => '');
  check(/Save changes/i.test(`${headline} ${await report.textContent('#verdict')}`) && /Save changes/i.test(did || ''), 'the card names the click (Save changes) under You did, the headline stays one short sentence', `${headline} | ${did}`);
  check(steps.some((s) => /Save changes/i.test(s)), 'the steps list the click', JSON.stringify(steps));
  // T-066, through the real button (R14, R15): intact first (the known-true sample), then one byte flipped in the stored PNG.
  // The Media tab sits behind the verdict view's "more" list; its own click handler opens it, then the real button's handler runs.
  await report.evaluate(() => document.getElementById('tab-media').click());
  const origin = report.locator('.shot-actions button', { hasText: /^Origin$/ }).first();
  await origin.waitFor({ state: 'attached', timeout: 15000 });
  await origin.evaluate((b) => b.click());
  await report.waitForFunction(() => /Origin check: intact/.test(document.getElementById('status').textContent), null, { timeout: 8000 })
    .catch(async () => check(false, 'the Origin button says "intact" on the stored screenshot', await report.textContent('#status')));
  check(/Origin check: intact/.test(await report.textContent('#status')), 'the Origin button says "intact" on the stored screenshot');
  const flipped = await report.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('uqa'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rec = await new Promise((res) => { const q = db.transaction('media').objectStore('media').getAll(); q.onsuccess = () => res(q.result.find((m) => (m.type || m.blob?.type || '').includes('png'))); });
    if (!rec) return false;
    const bytes = new Uint8Array(await rec.blob.arrayBuffer());
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    await new Promise((res, rej) => { const tx = db.transaction('media', 'readwrite'); tx.objectStore('media').put({ ...rec, blob: new Blob([bytes], { type: rec.blob.type }) }); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    return true;
  });
  check(flipped, 'one byte of the stored screenshot was flipped');
  await origin.evaluate((b) => b.click());
  await report.waitForFunction(() => /Origin check: content changed/.test(document.getElementById('status').textContent), null, { timeout: 8000 })
    .catch(async () => check(false, 'the Origin button says "content changed" after one flipped byte', await report.textContent('#status')));
  check(/Origin check: content changed/.test(await report.textContent('#status')), 'the Origin button says "content changed" after one flipped byte');
  await report.close();
  await popup.close();
  await top?.release?.().catch(() => {});
  await context.close();

  /* ── T-060: the keyboard-only run ──────────────────────────────────────── */
  console.log('first run, keyboard only: Tab, Enter, Space, Alt+KeyB, Escape');
  ({ worker, id } = await boot());
  W = worker;
  const kpage = await openPractice();
  const kpop = await openPopup(id);
  await kpop.bringToFront();
  let w = await tabTo(kpop, 'popup', (d) => d.tag === 'summary' || d.id === 'switch' || d.id === 'charter');
  if (w && w.tag === 'summary') { await press(kpop, 'Enter'); w = await tabTo(kpop, 'popup', (d) => d.id === 'switch' || d.id === 'charter'); } // open the fold from the keyboard, then on to the wake button
  if (w && w.id === 'switch') {
    await press(kpop, 'Enter');
    await kpop.waitForFunction(() => document.body.dataset.awake === 'true', null, { timeout: 10000 });
    check(await pageAwake(worker), 'Enter on "Wake up" wakes it: the page is awake and its recorder is in');
  }
  const c = await tabTo(kpop, 'popup', (d) => d.id === 'charter');
  if (c) {
    await kpop.keyboard.type('Keyboard only: Save changes fails');
    const s = await tabTo(kpop, 'popup', (d) => d.id === 'start');
    if (s) {
      await press(kpop, 'Space');
      await kpop.waitForFunction(() => !document.getElementById('step-live').hidden, null, { timeout: 10000 });
      check(await pageAwake(worker, true), 'Space on "Start recording" starts it: the page is recording');
    }
  }
  await kpage.bringToFront();
  const n = await tabTo(kpage, 'page', (d) => d.id === 'n', 60, true);
  const sv = n && await tabTo(kpage, 'page', (d) => d.id === 'save', 60, true);
  if (sv) {
    await press(kpage, 'Space');
    await kpage.waitForFunction(() => /Could not save/.test(document.getElementById('status').textContent), null, { timeout: 10000 });
    check(true, 'Space on "Save changes" sends the form');
  }
  await kpage.waitForTimeout(800);
  const barUp = await worker.evaluate(async (o) => {
    const until = Date.now() + 10000;
    for (;;) {
      const t = (await chrome.tabs.query({})).find((x) => x.url.startsWith(o));
      const r = t && await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'ISOLATED', func: () => window.UQABar?.probe?.().shown === true }).catch(() => null);
      if (r?.[0]?.result) return true;
      if (Date.now() > until) return false;
      await new Promise((q) => setTimeout(q, 100));
    }
  }, ORIGIN);
  check(barUp, 'the in-page bar is on screen (its own probe says shown)');
  // the bar: Alt+KeyB lands on it, the arrows rove, Escape and Tab never hold focus
  await press(kpage, 'Alt+KeyB');
  const onBar = await probe(kpage, true);
  stops.push({ tag: `bar Alt+KeyB (${onBar.tag}.${onBar.cls})`, ok: ringVisible(onBar), d: onBar });
  check(!onBar.none && /grip|pill/.test(onBar.cls), 'Alt+KeyB puts focus on the in-page bar', JSON.stringify(onBar));
  // The grip's arrow keys dock the bar (its accessible name says so), so the rest of the toolbar is
  // reached the toolbar way: End, then Left until the focused button is "Stop".
  const toStop = async () => {
    await press(kpage, 'End');
    for (let i = 0; i < 20; i++) {
      const d = await probe(kpage, true);
      stops.push({ tag: `bar key ${i + 1} (${d.tag}.${d.cls})`, ok: ringVisible(d), d });
      if (/uqa-stop/.test(d.cls)) return d;
      await press(kpage, 'ArrowLeft');
    }
    return null;
  };
  const reached = await toStop();
  check(!!reached, 'End and Left reach "Stop" on the bar, a ring at each key', stops.filter((x) => x.tag.startsWith('bar key')).map((x) => x.d.cls || x.d.name).join(' > '));
  await press(kpage, 'Escape');
  const afterEsc = await probe(kpage, true);
  check(true, `Escape on the bar leaves the page standing (focus: ${afterEsc.none ? 'body' : `${afterEsc.tag}#${afterEsc.id || afterEsc.cls}`})`);
  // Alt+KeyB is not taken while a text field has focus (typing is the page's), so the way out ends on a button
  const out = await tabTo(kpage, 'bar exit', (d) => d.id === 'save', 24, true);
  check(!!out, 'Tab leaves the bar: no trap');
  if (reached) {
    await press(kpage, 'Alt+KeyB');
    await toStop();
    await press(kpage, 'Enter');
  } else {
    await kpop.bringToFront();
    const st = await tabTo(kpop, 'popup', (d) => d.id === 'stop');
    if (st) await press(kpop, 'Enter');
  }
  await kpop.bringToFront();
  await kpop.waitForFunction(() => !document.getElementById('step-done').hidden, null, { timeout: 20000 }).catch(async (e) => {
    const st = await worker.evaluate(() => chrome.storage.session.get(null)).catch(() => null);
    const ui = await kpop.evaluate(() => ({ live: !document.getElementById('step-live').hidden, idle: !document.getElementById('step-idle').hidden, status: document.getElementById('status').textContent }));
    const focus = await probe(kpage, true);
    throw new Error(`Enter on Stop did not end the session: ${JSON.stringify({ active: st?.activeSessionId, ui, focus: `${focus.tag}.${focus.cls}` })}`);
  });
  check(true, 'Enter on "Stop" ends the session and the popup shows the review');
  await kpop.bringToFront();
  const v = await tabTo(kpop, 'popup', (d) => d.id === 'view-report');
  if (v) {
    const krep = await reportOf(() => press(kpop, 'Enter'));
    const kh = `${await krep.textContent('#v-h')} ${await krep.textContent('#verdict')}`;
    console.log(`     headline: ${kh}`);
    check(/500/.test(kh || '') && /Save changes/i.test(kh || ''), 'the keyboard-only session reads the same: the click and the 500', kh);
    await krep.close();
  }

  const bad = stops.filter((x) => !x.ok);
  check(stops.length >= 8, `a ring was checked at ${stops.length} stops (focus left the document ${wraps} time(s))`);
  check(bad.length === 0, 'a visible focus ring at every stop', bad.map((x) => `${x.tag} ${JSON.stringify(x.d)}`).join(' | '));
  check(errors.length === 0, 'no page error in the popup', errors.join(' | '));
  code = failures.length ? 1 : 0;
} catch (err) {
  check(false, 'the live first-run reached the end', err.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await top?.release?.().catch(() => {});
  await context?.close().catch(() => {});
  await new Promise((ok) => server.close(ok));
  for (const d of [...profiles, EXT]) trash(d);
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code || failures.length ? 1 : 0);
