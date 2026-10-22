/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * sdlc-1014c: the passive checks the recorder runs while a session records (content/checks.js), on the real file in headless Chromium
 * with real (trusted) mouse presses and a hand-made bridge (isRecording, emit, tap) that collects what would reach the session.
 *
 *   Dead click   positive: a button with no handler, a link that only points at "#" and a div[role=button] with no handler are each
 *                reported once as "Click did nothing" with the label.
 *                negative: a button that changes the page, one that fires a request, a handler that throws (the page error is the report),
 *                a disabled button, a real link, a Copy button, a form submit, a hash link that moves the address, and a click while not recording.
 *   Overflow     positive: text cut by overflow:hidden, and text that runs out of a fixed box over its neighbour. Negative: text that wraps,
 *                a scrolling box, text that fits.
 *   Contrast     positive: 1.7:1 small text, 2.8:1 large text. Negative: 4.54:1 (#767676 on white), black on white, text on an image,
 *                disabled text.
 *   Caps         no more than 3 contrast and 8 findings, nothing twice, nothing while not recording.
 *
 *   node tools/test-layout-checks.mjs            (run from extension/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKS = fs.readFileSync(path.join(EXT, 'content', 'checks.js'), 'utf8');

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) passed++; else { failures.push(name); console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); } };

const PAGE = `<!doctype html><meta charset="utf-8"><title>checks</title>
<style>body{font-size:16px;background:#fff;color:#111;margin:20px} button,a,div{margin:4px}
.cut{width:60px;overflow:hidden;white-space:nowrap;border:1px solid #888}
.row{display:grid;grid-template-columns:auto 9ch auto;gap:12px;width:420px}.row .ref{white-space:nowrap}
.wrap{width:60px}.scroll{width:60px;overflow:auto;white-space:nowrap}
.low{color:#c9c9c9;font-size:12px}.big{color:#999;font-size:28px}.edge{color:#767676}.dark{color:#000}
.img{color:#ccc;background:url("data:image/gif;base64,R0lGODlhAQABAAAAACw=")}</style>
<button id="dead">Dead one</button>
<a id="deadlink" href="#" onclick="return false">Dead link</a>
<div id="deadrole" role="button" tabindex="0">Dead role</div>
<button id="live">Live one</button><span id="out"></span>
<button id="net">Fetch one</button>
<button id="throws">Throws one</button>
<button id="off" disabled>Disabled one</button>
<a id="real" href="/elsewhere" onclick="return false">Real link</a>
<button id="copy">Copy link</button>
<form onsubmit="return false"><button id="submit">Send form</button></form>
<a id="hash" href="#moved">Hash link</a>
<div class="cut" id="cutbox">This text is far too long for its box</div>
<div class="row"><span>Ref</span><span class="ref" id="ref">QAW-2026-10-10-000417-PRACTICE</span><span>49.00 JOD</span></div>
<div class="wrap" id="wrapbox">Long words wrap inside a narrow box fine</div>
<div class="scroll" id="scrollbox">This text scrolls inside its own box</div>
<p class="low" id="low">Prices include tax. Delivery within 3 to 5 working days.</p>
<p class="big" id="big">Large pale heading text</p>
<p class="edge" id="edge">Grey that passes AA at 4.54 to 1</p>
<p class="dark" id="dark">Black on white is fine</p>
<p class="img" id="img">Text over an image is not judged</p>
<button id="paleoff" disabled style="color:#ddd">Pale disabled</button>`;

/* ── the report side: a layout finding is not blamed on a click, a dead click is blamed on its own ── */
{
  const { correlate } = await import('../core/correlate.js');
  const click = { kind: 'dom', action: 'click', label: 'Next step', ts: 1000, frameUrl: 'https://app.test/' };
  const mk = (check, ts) => ({ kind: 'console', level: 'error', text: `x ${check}`, check, ts, frameUrl: 'https://app.test/' });
  const chains = correlate([click, mk('overflow', 1400), mk('dead-click', 1001)]);
  check(chains.find((c) => c.failure.check === 'overflow')?.trigger == null, 'a layout finding has no trigger click in the report');
  check(chains.find((c) => c.failure.check === 'dead-click')?.trigger === click, 'a dead click is linked to the click it belongs to');
}

const browser = await chromium.launch({ headless: true });
async function open({ recording = true, html = PAGE } = {}) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', () => {});
  await page.addInitScript((rec) => {
    window.__emitted = []; window.__taps = new Set(); window.__rec = rec;
    window.UQABridge = { isRecording: () => window.__rec, emit: (e) => { window.__emitted.push(e); for (const f of window.__taps) f(e); }, tap: (fn) => (window.__taps.add(fn), () => window.__taps.delete(fn)) };
    window.__fire = (e) => { for (const f of window.__taps) f(e); };
  }, recording);
  await page.route('https://app.test/**', (r) => (r.request().url().endsWith('/elsewhere') ? r.fulfill({ contentType: 'text/html', body: 'ok' }) : r.fulfill({ contentType: 'text/html', body: html })));
  await page.route('https://app.test/data', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.goto('https://app.test/');
  await page.evaluate(() => {
    document.getElementById('live')?.addEventListener('click', () => { document.getElementById('out').textContent = 'changed'; });
    document.getElementById('net')?.addEventListener('click', () => { fetch('/data'); });
    document.getElementById('throws')?.addEventListener('click', () => { setTimeout(() => window.__fire({ kind: 'pageerror', text: 'Uncaught boom' }), 50); });
    document.getElementById('submit')?.addEventListener('click', () => {});
  });
  await page.addScriptTag({ content: CHECKS });
  await page.waitForFunction(() => !!window.UQAChecks);
  return page;
}
const emitted = (page) => page.evaluate(() => window.__emitted.map((e) => e.text));
const press = async (page, id) => { await page.click(`#${id}`); };

try {
  /* ── dead clicks ─────────────────────────────────────────────────────── */
  {
    const page = await open();
    for (const id of ['dead', 'deadlink', 'deadrole', 'live', 'net', 'throws', 'off', 'copy', 'submit', 'hash', 'real']) {
      if (id === 'off') { await page.click('#off', { force: true }).catch(() => {}); continue; }
      await press(page, id).catch((e) => console.log('   click', id, String(e.message).slice(0, 160)));
      await page.waitForTimeout(1700);
    }
    const out = (await page.evaluate(() => window.__emitted.map((e) => e.text))).filter((t) => /^Click did nothing/.test(t));
    check(out.length >= 3 && out.some((t) => /Dead one/.test(t)), 'a button with no effect is reported as "Click did nothing" with its label', JSON.stringify(out));
    check(out.some((t) => /Dead link/.test(t)), 'a link that only points at "#" and does nothing is reported');
    check(out.some((t) => /Dead role/.test(t)), 'a div[role=button] with no effect is reported');
    for (const [label, re] of [['a button that changes the page', /Live one/], ['a button that fires a request', /Fetch one/], ['a handler that throws', /Throws one/], ['a disabled button', /Disabled one/], ['a real link', /Real link/], ['a Copy button', /Copy link/], ['a form submit', /Send form/], ['a hash link that moves the address', /Hash link/]]) {
      check(!out.some((t) => re.test(t)), `not reported: ${label}`, JSON.stringify(out));
    }
    check(out.every((t) => /\(.*\)/.test(t) && /1\.5 s/.test(t)), 'the finding says what it waited for');
    await page.close();
  }
  {
    const page = await open({ recording: false });
    await press(page, 'dead');
    await page.waitForTimeout(1900);
    check((await emitted(page)).length === 0, 'not recording: no click is judged');
    await page.close();
  }
  {
    const page = await open();
    await press(page, 'dead');
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.__rec = false; });
    await page.waitForTimeout(1700);
    check((await emitted(page)).length === 0, 'recording stopped inside the wait: nothing is reported');
    await page.close();
  }
  {
    const page = await open();
    await press(page, 'dead'); await page.waitForTimeout(1700);
    await press(page, 'dead'); await page.waitForTimeout(1700);
    check((await emitted(page)).filter((t) => /Dead one/.test(t)).length === 1, 'the same dead button is reported once');
    await page.close();
  }

  /* ── overflow and contrast: cap1022, only on demand (the Tools deep scan), never by themselves in a session ── */
  const deepOf = async (page) => (await page.evaluate(() => window.UQAChecks.deep())).map((f) => f.text);
  {
    const page = await open();
    const out = await deepOf(page);
    const over = out.filter((t) => /^Text (is cut off|overflows its box)/.test(t));
    const con = out.filter((t) => /^Low contrast/.test(t));
    check(over.some((t) => /is cut off.*far too long/.test(t)), 'text cut by overflow:hidden is reported', JSON.stringify(over));
    check(over.some((t) => /overflows its box.*QAW-2026/.test(t) && /49\.00 JOD/.test(t)), 'text that runs out of its fixed box over its neighbour is reported', JSON.stringify(over));
    check(!over.some((t) => /Long words wrap|scrolls inside/.test(t)), 'wrapping text and a scrolling box are not reported', JSON.stringify(over));
    check(con.some((t) => /Prices include tax/.test(t) && /1\.\d:1/.test(t) && /#c9c9c9/.test(t)), 'small pale text is reported with its ratio and colours', JSON.stringify(con));
    check(con.some((t) => /Large pale heading/.test(t) && /needs 3:1/.test(t)), 'large pale text is judged against 3:1', JSON.stringify(con));
    check(!con.some((t) => /Grey that passes|Black on white|Text over an image|Pale disabled/.test(t)), '4.54:1, black, text on an image and disabled text are not reported', JSON.stringify(con));
    check((await deepOf(page)).length === out.length, 'a second deep scan finds the same, nothing twice inside one scan');
    check((await emitted(page)).length === 0, 'a deep scan puts nothing into the live session');
    await page.close();
  }
  {
    const page = await open();
    await page.click('#live');
    await page.waitForTimeout(2600);
    check((await emitted(page)).filter((t) => /^(Text |Low contrast)/.test(t)).length === 0, 'cap1022: a recording session never scans layout by itself');
    await page.close();
  }
  {
    const many = `<!doctype html><title>many</title><body style="background:#fff">${Array.from({ length: 12 }, (_, i) => `<p style="color:rgb(${200 + i},${200 + i},${200 + i})">Pale line number ${i} of text</p>`).join('')}</body>`;
    const page = await open({ html: many });
    check((await deepOf(page)).length === 12, 'the deep scan is not held to the old live cap of 3');
    await page.close();
  }
  {
    const page = await open({ html: '<!doctype html><title>quiet</title><body style="background:#fff;color:#222"><h1>Hello</h1><button id="b">Go</button><p>All fine here.</p></body>' });
    check((await deepOf(page)).length === 0, 'a clean page reports nothing');
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
