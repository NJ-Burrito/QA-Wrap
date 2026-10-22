/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Performance budget run.
 *
 *   node tools/perf.mjs            # both machines
 *   node tools/perf.mjs --fast     # 1× only
 *
 * Measures the work the extension actually does, twice: once unthrottled (a
 * decent desktop) and once at 6× CPU throttling via CDP, which is the standard
 * stand-in for a low-end laptop. A budget that only holds on the fast machine
 * is not a budget.
 *
 * Every measurement runs against a deliberately heavy page — 3,000 elements,
 * deep nesting, a long form — because the cheap cases were never the risk.
 */
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { profile } from './lib-paths.mjs';
import { grantedExtension, seedConsent, awaitSiteScripts } from './lib-granted.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const PROFILE = profile(process.env.UQA_PERF_PROFILE || '.perf-profile');
const FAST_ONLY = process.argv.includes('--fast');

/* ── budgets ─────────────────────────────────────────────────────────────
   Chosen from what a person notices: 100ms feels instant, 300ms feels
   responsive, past 1s they wonder if it worked. The 6× column is the same
   experience on a machine roughly six times slower.                        */
const BUDGET = {
  // Two popup numbers, deliberately.
  //
  // "our code" is boot(): the round trip, the render, the first paint of state.
  // That is the half we can make faster and the half a regression shows up in.
  //
  // "open → interactive" is the whole wall-clock, including Chrome parsing the
  // page and running three stylesheets — real cost to the tester, and not
  // something a code change moves much. Measuring only the total made "the
  // popup is slow" un-actionable; measuring only ours would hide the cost the
  // tester actually feels. Both, labelled.
  //
  // Re-based on an idle machine once the suite stopped running a cached,
  // pre-master-switch worker: boot is ~10ms at ×1 and ~84ms at ×6. These sit at
  // roughly 3× the real reading — loose enough to survive a busy laptop, tight
  // enough that a genuine regression trips them. The previous 600/1400 could
  // not have fired for anything short of a catastrophe.
  'popup boot (our code)':         { x1: 60,   x6: 300  },
  'popup open → interactive':      { x1: 200,  x6: 800  },
  // D-1010-158: the same two rows in Arabic, at the English budgets (a red row is reported, never cured by a bigger budget).
  'popup boot (ar)':               { x1: 60,   x6: 300  },
  'popup open (ar)':               { x1: 200,  x6: 800  },
  'settings page → interactive':   { x1: 400,  x6: 1600 },
  'locator describe (per call)':   { x1: 60,   x6: 320  },
  'recorder overhead (per click)': { x1: 5,    x6: 30   },
  // Re-based once the harness stopped stopping the clock early. The old 900/3500
  // was measured against the first heading flipping, which happens in about a
  // millisecond; the browser then spends ~1.9s laying 3,311 elements out again.
  // Of that, our own script is ~50ms (collect, rewrite, sweep — all reported in
  // the observations). The budget now covers the honest number, and it is a
  // budget on the browser's layout, not on code we can make faster.
  'layout stress apply':           { x1: 2500, x6: 9000 },
  'layout stress revert':          { x1: 500,  x6: 2000 },
  'panel render, 2000 events':     { x1: 900,  x6: 3500 },
  'panel append, 20 new events':   { x1: 120,  x6: 500  },
  // r10-07-1 (D-229): promoted out of report-only. Each ceiling is 1.5x the best of three readings (10 Oct 2026, this machine, three
  // full `npm run perf` runs): report open 1108 / 9686 ms, HTML export 520 / 2268 ms (x1 / x6). A red row is reported, never cured by a bigger budget.
  'report open, 10k events':       { x1: 1662, x6: 14529 },
  'HTML export, 10k rows':         { x1: 780,  x6: 3402  },
};

/* ── a page heavy enough to be worth measuring ───────────────────────── */
const HEAVY = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Heavy fixture</title><style>
 body{font:14px "Thmanyah Sans",sans-serif;margin:0;padding:16px}
 .card{border:1px solid #ddd;padding:8px;margin:4px 0;border-radius:6px}
 .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
 .clip{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;height:20px}
 label{display:block;font-size:12px;margin-top:6px}
 input,select{width:100%;padding:5px}
</style></head><body>
<h1>Heavy fixture</h1><div id="root"></div>
<button id="go" type="button">Submit application</button><div id="out"></div>
<script>
 const root=document.getElementById('root');
 let html='';
 for(let i=0;i<300;i++){
   html+='<div class="card"><div class="grid">'+
     '<div class="clip">Row '+i+' — a label long enough to clip when text grows</div>'+
     '<div><label for="f'+i+'">Field '+i+'</label><input id="f'+i+'" name="field'+i+'" maxlength="40"></div>'+
     '<div><label for="s'+i+'">Choice '+i+'</label><select id="s'+i+'"><option>One</option><option>Two</option></select></div>'+
     '</div></div>';
 }
 root.innerHTML=html;
 document.getElementById('go').addEventListener('click',async()=>{
   const r=await fetch('/api/x',{method:'POST',body:'{}'});
   if(!r.ok)console.error('Submit failed: '+r.status);
   document.getElementById('out').textContent='status '+r.status;
 });
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"boom"}');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(HEAVY);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const results = [];
const record = (name, rate, ms, extra) => results.push({ name, rate, ms, extra });

/* Median of several runs — a single sample on a throttled CPU is noise. */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// A budget measured against a cached, weeks-old worker is a budget for a build
// nobody is running.
purgeWorkerCache(PROFILE);

// A tester who has allowed the site: the sleeping extension is not allowed on a page until its access is granted.
const RUN_EXT = grantedExtension({ label: 'perf' });
const context = await chromium.launchPersistentContext(PROFILE, launchOptions(RUN_EXT));
await keepOnTop(context); // test window stays above others; released on close

try {
  const worker = await freshWorker(context);
  await seedConsent(worker); // the first-run notice gates UQA_ARM; this run is the tester who pressed "I understand"
  await awaitSiteScripts(worker);
  const id = new URL(worker.url()).host;

  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'load' });
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
  console.log(`fixture: ${nodes.toLocaleString()} DOM elements\n`);

  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
  const call = (m) => ctl.evaluate((x) => new Promise((r) => chrome.runtime.sendMessage(x, r)), m);
  const tabId = await ctl.evaluate(
    async (o) => (await chrome.tabs.query({ url: `${o}/*` }))[0]?.id ?? null,
    origin
  );

  /* Seed a session with 2,000 events so the panel measurement is honest. */
  console.log('seeding 2,000 events for the panel measurement…');
  // Wake it first, and check that it woke.
  //
  // Every capability is asleep until the window is armed. This suite never did,
  // and did not notice for two versions because it was running a cached worker
  // that predated the master switch. With a current worker the session is
  // simply refused, and every number after it would have been measured against
  // nothing at all.
  const windowId = await ctl.evaluate(
    (id) => new Promise((r) => chrome.tabs.get(id, (t) => r(t?.windowId ?? null))),
    tabId
  );
  const armRes = await call({ type: 'UQA_ARM', windowId });
  const awake = await call({ type: 'UQA_ARMED', windowId });
  if (!awake?.result?.armed) throw new Error(`could not wake the extension (tab ${tabId}, window ${windowId}, arm ${JSON.stringify(armRes)}, armed ${JSON.stringify(awake)}) — every measurement below would be of nothing`);

  const perfRun = await call({ type: 'UQA_START', charter: 'Perf run', tabId, startUrl: `${origin}/` });
  if (!perfRun?.ok) throw new Error(`the seeding session did not start: ${perfRun?.error}`);
  // Seed from INSIDE the page under test. Events sent from any other tab are
  // correctly rejected as "other-tab" — the filter that stops a tester's email
  // tab polluting a session also stops a harness faking events from the wrong
  // place. So the harness has to speak from the right place.
  const [{ result: seeded }] = await ctl.evaluate(
    async (t) =>
      chrome.scripting.executeScript({
        target: { tabId: t },
        world: 'ISOLATED',
        func: async () => {
          const t0 = Date.now();
          let sent = 0;
          for (let i = 0; i < 2000; i++) {
            await window.UQABridge.send({
              type: 'UQA_EVENT',
              event: {
                kind: i % 5 === 0 ? 'net' : 'dom',
                ts: t0 + i * 10,
                frameUrl: location.href,
                action: 'click',
                label: 'Row ' + i,
                locator: "getByRole('button', { name: 'Row " + i + "' })",
                method: 'GET',
                url: '/api/' + i,
                status: i % 25 === 0 ? 500 : 200,
                durationMs: 12,
              },
            });
            sent++;
          }
          return sent;
        },
      }),
    tabId
  );
  const perfSessionId = (await call({ type: 'UQA_GET_STATE' })).result.session.id;
  await call({ type: 'UQA_STOP' });
  // Verify the seed landed. A panel measurement against an empty session would
  // report a wonderful number and mean nothing.
  const seededCount = (await call({ type: 'UQA_GET_TIMELINE', sessionId: perfSessionId })).result.events.length;
  console.log(`seeded ${seededCount} events (dispatch returned ${seeded})\n`);
  if (seededCount < 500) throw new Error(`seeding failed — only ${seededCount} events stored`);

  // D-1010-196: a stopped 10,000-event session, written straight into IndexedDB, for the two report-only rows below (report open, HTML export).
  const tenK = await ctl.evaluate(async (n) => {
    const db = await import('../core/db.js');
    const sid = 's_perf10k_' + Date.now().toString(36);
    const t0 = Date.now() - 3_600_000 - n * 5;
    await db.putSession({ id: sid, seq: 1, charter: 'Perf 10k', startedAt: t0, endedAt: t0 + n * 5, tabId: null, windowId: null, startUrl: 'http://127.0.0.1/', env: null, timeboxMinutes: null, expiresAt: null, breakdown: null, status: 'stopped' });
    for (let i = 0; i < n; i += 5000) {
      const batch = [];
      for (let j = i; j < Math.min(n, i + 5000); j++) batch.push({ sessionId: sid, kind: j % 5 === 0 ? 'net' : 'dom', ts: t0 + j * 5, frameUrl: 'http://127.0.0.1/', action: 'click', label: 'Row ' + j, locator: "getByRole('button', { name: 'Row " + j + "' })", method: 'GET', url: '/api/' + j, status: j % 25 === 0 ? 500 : 200, durationMs: 12 });
      await db.appendEvents(batch);
    }
    return sid;
  }, 10_000);

  const rates = FAST_ONLY ? [1] : [1, 6];

  for (const rate of rates) {
    console.log(`── CPU ×${rate} ${rate === 1 ? '(desktop)' : '(low-end laptop)'} ──`);

    /* Throttle every context that matters. */
    const throttle = async (target) => {
      const client = await context.newCDPSession(target);
      await client.send('Emulation.setCPUThrottlingRate', { rate });
      return client;
    };
    const pageClient = await throttle(page);

    /* ---- popup open → interactive ---- */
    const popupTimes = [];
    let phases = null;
    for (let i = 0; i < 5; i++) {
      const p = await context.newPage();
      const c = await throttle(p);
      const t0 = Date.now();
      await p.goto(`chrome-extension://${id}/popup/popup.html`);
      // Interactive = boot() said so. This used to watch a slider's output
      // text; the slider was deleted with the time-box control and the wait
      // then timed out for two versions, so the popup budget went unmeasured.
      await p.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 20000 });
      popupTimes.push(Date.now() - t0);
      // The phases, from the popup itself. Without them "the popup is slow" is
      // a complaint; with them it is a decision about which half to work on.
      phases = await p.evaluate(() => window.UQABootTimings).catch(() => null);
      await c.detach().catch(() => {});
      await p.close();
    }
    // Two numbers, because they are two different things and only one of them
    // is ours. Chrome parsing the page and running three stylesheets is real
    // cost to the tester and is not a code smell; conflating it with our boot
    // made "the popup is slow" un-actionable for two versions.
    if (phases) record('popup boot (our code)', rate, phases.totalMs,
      `chrome ${phases.chromeMs}, fetch ${phases.fetchMs}, render ${phases.renderMs}, refresh ${phases.refreshMs}`);
    record('popup open → interactive', rate, median(popupTimes), phases
      ? `boot ${phases.totalMs}ms in-page (chrome ${phases.chromeMs}, fetch ${phases.fetchMs}, render ${phases.renderMs}, refresh ${phases.refreshMs}) — the rest is Chrome opening the page`
      : undefined);

    /* ---- popup, Arabic (D-1010-158): the language is the user's choice, stored in sync and mirrored in localStorage ---- */
    await ctl.evaluate(() => new Promise((r) => { localStorage.setItem('qaw-lang', 'ar'); chrome.storage.sync.set({ qawLanguage: 'ar' }, r); }));
    const arTimes = [];
    let arPhases = null;
    for (let i = 0; i < 5; i++) {
      const p = await context.newPage();
      const c = await throttle(p);
      const t0 = Date.now();
      await p.goto(`chrome-extension://${id}/popup/popup.html`);
      await p.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 20000 });
      arTimes.push(Date.now() - t0);
      arPhases = await p.evaluate(() => window.UQABootTimings).catch(() => null);
      await c.detach().catch(() => {});
      await p.close();
    }
    await ctl.evaluate(() => new Promise((r) => { localStorage.removeItem('qaw-lang'); chrome.storage.sync.remove('qawLanguage', r); }));
    if (arPhases) record('popup boot (ar)', rate, arPhases.totalMs,
      `chrome ${arPhases.chromeMs}, fetch ${arPhases.fetchMs}, render ${arPhases.renderMs}, refresh ${arPhases.refreshMs}`);
    record('popup open (ar)', rate, median(arTimes));

    /* ---- settings page → interactive ---- */
    const optTimes = [];
    for (let i = 0; i < 3; i++) {
      const p = await context.newPage();
      const c = await throttle(p);
      p.on('requestfailed', (r) => console.error('[options requestfailed]', r.url(), r.failure()?.errorText));
      p.on('pageerror', (e) => console.error('[options pageerror]', String(e).slice(0, 300)));
      p.on('console', (m) => { if (m.type() === 'error') console.error('[options console]', m.text().slice(0, 300)); });
      const t0 = Date.now();
      try { await p.goto(`chrome-extension://${id}/options/options.html`); } catch (e) {
        console.error('DIAG goto failed', e.message.split('\n')[0], 'sw', context.serviceWorkers().length, 'pages', context.pages().map((x) => x.url()));
        console.error('DIAG fetch', await ctl.evaluate((u) => fetch(u).then((r) => r.status + ' ' + r.headers.get('content-type'), (er) => String(er)), `chrome-extension://${id}/options/options.html`));
        throw e;
      }
      await p.waitForFunction(() => document.querySelectorAll('.key-row').length >= 6, { timeout: 25000 });
      optTimes.push(Date.now() - t0);
      await c.detach().catch(() => {});
      await p.close();
    }
    record('settings page → interactive', rate, median(optTimes));

    /* ---- selector engine on the heavy DOM ---- */
    const [{ result: describeMs }] = await ctl.evaluate(
      async (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: () => {
            const targets = [...document.querySelectorAll('input, select, .clip, button')].slice(0, 20);
            const times = [];
            for (const el of targets) {
              const t0 = performance.now();
              window.UQASelector.describe(el);
              times.push(performance.now() - t0);
            }
            times.sort((a, b) => a - b);
            // T-043: p95 beside the median (nearest rank of the 20 calls), measured, never typed.
            return { median: times[Math.floor(times.length / 2)], p95: times[Math.ceil(times.length * 0.95) - 1] };
          },
        }),
      tabId
    );
    record('locator describe (per call)', rate, Math.round(describeMs.median * 10) / 10, `20 calls, median; p95 ${Math.round(describeMs.p95 * 10) / 10} ms`);

    /* ---- recorder overhead per click ---- */
    await call({ type: 'UQA_START', charter: 'Overhead', tabId, startUrl: `${origin}/` });
    await page.waitForTimeout(400);
    const [{ result: clickMs }] = await ctl.evaluate(
      async (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: () => {
            const btn = document.getElementById('go');
            const times = [];
            for (let i = 0; i < 30; i++) {
              const t0 = performance.now();
              btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              times.push(performance.now() - t0);
            }
            times.sort((a, b) => a - b);
            return times[Math.floor(times.length / 2)];
          },
        }),
      tabId
    );
    record('recorder overhead (per click)', rate, Math.round(clickMs * 10) / 10, '30 clicks, median');
    // D-197: the recorder's own phase measures (selector, sanitise, privacy, send), written only while window.__qawRecMarks is set. Report-only.
    const [{ result: recPhases }] = await ctl.evaluate(
      async (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: () => {
            window.__qawRecMarks = true;
            performance.clearMeasures();
            const btn = document.getElementById('go');
            for (let i = 0; i < 30; i++) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const by = {};
            for (const m of performance.getEntriesByType('measure')) if (m.name.startsWith('qaw:rec:')) (by[m.name.slice(8)] ||= []).push(m.duration);
            window.__qawRecMarks = false;
            const med = (xs) => { xs.sort((a, b) => a - b); return xs[xs.length >> 1]; };
            return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Math.round(med(v) * 1000) / 1000]));
          },
        }),
      tabId
    );
    const phaseNames = Object.keys(recPhases || {});
    if (phaseNames.length) record('recorder phases (per click)', rate, Math.round(phaseNames.reduce((a, k) => a + recPhases[k], 0) * 100) / 100, `qaw:rec:* median ms, ${phaseNames.map((k) => `${k} ${recPhases[k]}`).join(', ')}`);
    else record('recorder phases (per click)', rate, 0, 'no qaw:rec:* measure found (the recorder was not marking)');
    const overhead = await call({ type: 'UQA_STOP' });
    // Drop it, so the 2,000-event session is still the newest and the panel
    // opens straight onto it.
    if (overhead?.result?.id) await call({ type: 'UQA_DELETE_SESSION', sessionId: overhead.result.id });

    /* ---- layout stress on the heavy DOM ---- */
    await page.waitForTimeout(200);
    const applyTimes = [];
    const revertTimes = [];
    let clipped = 0;
    let applyPhases = {};

    // UQA_TOGGLE_RTL toggles. Timing a "toggle" without knowing which way it
    // went produced a 17ms apply and zero clipped elements — a measurement of
    // nothing. Force a known state first, untimed.
    //
    // The second trap took longer to see. Watching the first heading flip is
    // watching the first millisecond of the pass: text nodes are rewritten in
    // document order, and the overflow sweep — a layout read over all 3,311
    // elements — runs two frames later. The old harness stopped the apply clock
    // before that sweep started, then let the sweep run down the revert clock,
    // which is how apply read 70ms and revert read 3,958ms for the same work.
    // rtl-stress.js now stamps html[data-uqa-stress] when a pass truly ends.
    const settled = (want) =>
      page.waitForFunction((w) => document.documentElement.dataset.uqaStress === w, want, { timeout: 60000 });
    const rtlIsOn = async () => (await call({ type: 'UQA_RTL_STATE', tabId }))?.result?.enabled === true;
    const ensureOff = async () => {
      if (await rtlIsOn()) {
        await call({ type: 'UQA_TOGGLE_RTL', tabId });
        await settled('off');
      }
    };

    for (let i = 0; i < 3; i++) {
      await ensureOff();
      const tApply = Date.now();
      await call({ type: 'UQA_TOGGLE_RTL', tabId, options: { rtl: true, expand: true, accent: false, bidi: false } });
      await settled('on');
      applyTimes.push(Date.now() - tApply);
      applyPhases = await page.evaluate(() =>
        JSON.parse(document.documentElement.dataset.uqaStressTimings || '{}')
      );
      clipped = await page.evaluate(() => document.querySelectorAll('.uqa-overflow').length);
      // A warning, not a failure: overflow detection is verified by the smoke
      // and portal suites. Zero here means this fixture's layout did not clip,
      // which makes the timing optimistic — worth knowing, not worth stopping.
      if (!clipped && i === 0) console.log('  note: fixture produced no clipped elements — apply timing is a lower bound');

      const tRevert = Date.now();
      await call({ type: 'UQA_TOGGLE_RTL', tabId });
      await settled('off');
      revertTimes.push(Date.now() - tRevert);
    }
    const spread = Math.max(...applyTimes) - Math.min(...applyTimes);
    record(
      'layout stress apply',
      rate,
      median(applyTimes),
      `${clipped} clipped · spread ${spread}ms · in-page ${applyPhases.totalMs}ms (collect ${applyPhases.collectMs}, rewrite ${applyPhases.rewriteMs}, sweep ${applyPhases.sweepMs})`
    );
    record('layout stress revert', rate, median(revertTimes));

    /* ---- panel: full render, then incremental append ---- */
    const panel = await context.newPage();
    const panelClient = await throttle(panel);
    const tPanel = Date.now();
    // On the seeded session explicitly.
    //
    // Without the id the panel opens on whatever session is *last*, and by this
    // point in the loop that is the tiny "Overhead" session the click benchmark
    // just created — thirty events, so the wait for a hundred rows never
    // returns. The measurement is of the 2,000-event session or it is of
    // nothing; naming it is the difference.
    await panel.goto(`chrome-extension://${id}/devtools/panel.html?session=${perfSessionId}`);
    await panel.waitForFunction(() => document.querySelectorAll('#timeline .ev').length > 100, { timeout: 60000 });
    record('panel render, 2000 events', rate, Date.now() - tPanel, `${await panel.evaluate(() => document.querySelectorAll('#timeline .ev').length)} rows drawn`);

    const tAppend = await panel.evaluate(async () => {
      const host = document.getElementById('timeline');
      const before = host.childElementCount;
      const t0 = performance.now();
      // Exercise the same append path the live poll uses.
      const frag = document.createDocumentFragment();
      for (let i = 0; i < 20; i++) {
        const row = document.createElement('div');
        row.className = 'ev';
        row.textContent = 'appended ' + i;
        frag.append(row);
      }
      host.append(frag);
      await new Promise((r) => requestAnimationFrame(r));
      return { ms: performance.now() - t0, before };
    });
    record('panel append, 20 new events', rate, Math.round(tAppend.ms * 10) / 10);

    // D-1010-196 / r10-07-1: report open at 10,000 events and the HTML export of 10,000 rows, both in BUDGET now.
    const rep = await context.newPage();
    const repClient = await throttle(rep);
    const repErrs = [];
    rep.on('pageerror', (e) => repErrs.push(String(e.message || e).slice(0, 140)));
    rep.on('console', (m) => { if (m.type() === 'error') repErrs.push(m.text().slice(0, 140)); });
    const tRep = Date.now();
    await rep.goto(`chrome-extension://${id}/report/report.html?session=${tenK}`);
    const repOk = await rep.waitForFunction(() => document.querySelectorAll('#timeline .ev').length > 100, null, { timeout: 120000 }).then(() => true, () => false);
    record('report open, 10k events', rate, Date.now() - tRep, repOk ? 'until the timeline has drawn rows' : `the timeline drew no rows within 120 s (${await rep.evaluate(() => document.querySelectorAll('#timeline > *').length).catch(() => '?')} children; errors: ${repErrs.slice(0, 3).join(' | ') || 'none'})`);
    const exp = await rep.evaluate(async (sid) => { const t = performance.now(); const r = await chrome.runtime.sendMessage({ type: 'UQA_EXPORT', sessionId: sid, format: 'html' }); return { ms: performance.now() - t, ok: r?.ok !== false, bytes: typeof r?.result?.content === 'string' ? r.result.content.length : (r?.result?.size ?? null) }; }, tenK);
    record('HTML export, 10k rows', rate, exp.ok ? Math.round(exp.ms) : 999999, `${exp.ok ? 'ok' : 'FAILED (counted as over budget)'}${exp.bytes != null ? `, ${(exp.bytes / 1048576).toFixed(1)} MB` : ''}`);
    await repClient.detach().catch(() => {});
    await rep.close();

    await panelClient.detach().catch(() => {});
    await panel.close();
    await pageClient.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await pageClient.detach().catch(() => {});
    console.log('');
  }

  /* ── report ──────────────────────────────────────────────────────── */
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);

  console.log('┌─ results ──────────────────────────────────────────────────────────────┐');
  console.log(`  ${pad('measurement', 30)}${lpad('×1', 8)}${lpad('budget', 8)}${lpad('×6', 8)}${lpad('budget', 8)}  verdict`);
  console.log('  ' + '─'.repeat(70));

  let failures = 0;
  for (const name of Object.keys(BUDGET)) {
    const one = results.find((r) => r.name === name && r.rate === 1);
    const six = results.find((r) => r.name === name && r.rate === 6);
    const b = BUDGET[name];
    const okOne = one && one.ms <= b.x1;
    const okSix = !six || six.ms <= b.x6;
    if (!okOne || !okSix) failures++;
    const verdict = !okOne ? 'OVER on desktop' : !okSix ? 'OVER on low-end' : 'ok';
    console.log(
      `  ${pad(name, 30)}${lpad(one ? one.ms : '—', 8)}${lpad(b.x1, 8)}${lpad(six ? six.ms : '—', 8)}${lpad(b.x6, 8)}  ${verdict}`
    );
  }
  console.log('└────────────────────────────────────────────────────────────────────────┘');

  const notes = results.filter((r) => r.extra);
  if (notes.length) {
    console.log('\nobservations');
    notes.forEach((r) => console.log(`  ×${r.rate}  ${r.name}: ${r.name in BUDGET ? '' : `${r.ms} ms, `}${r.extra}`));
  }

  console.log(`\n${failures ? failures + ' measurement(s) over budget' : 'every measurement within budget'}`);
  console.log(
    '\nThe ×6 column is a CPU-throttled simulation, and it is sensitive to whatever\n' +
      'else the machine is doing. A wide "spread" on layout stress means the reading\n' +
      'was taken under load — re-run on an idle machine before acting on it.'
  );
  process.exitCode = failures ? 1 : 0;
} finally {
  await context.close();
  server.close();
}
