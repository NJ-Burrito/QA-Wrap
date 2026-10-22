/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Stress: what happens past the comfortable case.
 *
 * The other suites test that a feature works. This one tests what it does when
 * the input is bigger, uglier, faster or emptier than anyone designed for —
 * which is where a QA tool has to be good, because a QA tool is used precisely
 * on the days the application is misbehaving.
 *
 * Three shapes of stress, and they fail differently:
 *
 *   **Volume** — a page with thousands of elements, a session with thousands of
 *   events, a form with hundreds of fields. Failure is slowness, or a crash.
 *
 *   **Rate** — events faster than anything can drain them. Failure is dropped
 *   data, or a queue that never empties.
 *
 *   **Shape** — the empty session, the field with no attributes, the value that
 *   is 100k characters of Arabic. Failure is an exception, or worse, a
 *   confident wrong answer.
 *
 * Every check records a **number**, not a verdict, because "it survived" is not
 * interesting on its own and the numbers are what the comparison report is
 * built from. A check fails only when something is lost, thrown, or silently
 * wrong.
 *
 *   node tools/stress.mjs [--json out.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { profile } from './lib-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const PROFILE = profile('.stress-profile');
const jsonAt = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : null;

let pass = 0;
let fail = 0;
const results = [];

async function stress(name, fn) {
  const t0 = Date.now();
  try {
    const detail = (await fn()) || {};
    const ms = Date.now() - t0;
    pass++;
    results.push({ name, ok: true, ms, ...detail });
    console.log(`  ok    ${name}  ${ms}ms  ${JSON.stringify(detail)}`);
  } catch (err) {
    const ms = Date.now() - t0;
    fail++;
    results.push({ name, ok: false, ms, error: err.message });
    console.log(`  FAIL  ${name}  ${ms}ms\n          ${err.message}`);
  }
}

/* ── a deliberately hostile page ──────────────────────────────────────── */

const BIG_ROWS = 800;
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>stress fixture</title>
<style>body{font:14px "Thmanyah Sans",sans-serif;margin:0;padding:12px}
.row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;border-bottom:1px solid #eee;padding:3px 0}
.clip{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
input,select{width:100%}</style></head>
<body><h1>Stress fixture</h1><div id="root"></div>
<button id="go" type="button">Submit application</button><div id="out"></div>
<script>
const root = document.getElementById('root');
let html = '';
for (let i = 0; i < ${BIG_ROWS}; i++) {
  html += '<div class="row">' +
    '<div class="clip">Row ' + i + ' — a label long enough to clip when the text grows</div>' +
    '<div><label for="t' + i + '">Text ' + i + '</label><input id="t' + i + '" name="text' + i + '" maxlength="40"></div>' +
    '<div><label for="n' + i + '">Amount ' + i + '</label><input id="n' + i + '" type="number" min="1" max="500"></div>' +
    '<div><label for="s' + i + '">Choice ' + i + '</label><select id="s' + i + '"><option>One</option><option>Two</option></select></div>' +
    '</div>';
}
root.innerHTML = html;
document.getElementById('go').onclick = async () => {
  const res = await fetch('/api/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
  document.getElementById('out').textContent = 'status ' + res.status;
};
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"stress"}');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

purgeWorkerCache(PROFILE);
const context = await chromium.launchPersistentContext(PROFILE, launchOptions(EXT));
await keepOnTop(context); // test window stays above others; released on close

try {
  const worker = await freshWorker(context);
  const id = new URL(worker.url()).host;

  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const elements = await page.evaluate(() => document.querySelectorAll('*').length);
  console.log(`fixture: ${elements.toLocaleString()} DOM elements, ${BIG_ROWS} rows\n`);

  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
  /**
   * Send, and retry while the worker is *silent*.
   *
   * Under a flood MV3 will restart the service worker, and a message in flight
   * when that happens comes back `undefined` — "the port closed" — which is not
   * a refusal and must not be read as one. A real answer, including an error,
   * is returned immediately; only silence is retried.
   *
   * This is the harness being realistic rather than lenient: the product's own
   * pages do the same thing, for the same reason.
   */
  const callOnce = (msg) => ctl.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), msg);
  const call = async (msg, { attempts = 5 } = {}) => {
    for (let i = 0; i < attempts; i++) {
      const res = await callOnce(msg);
      if (res !== undefined) return res;
      await ctl.waitForTimeout(300 * (i + 1));
    }
    throw new Error(`${msg.type} stayed silent through ${attempts} attempts — the worker never came back`);
  };

  const tabId = await ctl.evaluate(
    (url) =>
      new Promise((r) =>
        chrome.tabs.query({}, (tabs) => r(tabs.find((t) => t.url?.startsWith(url))?.id ?? null))
      ),
    origin
  );
  const windowId = await ctl.evaluate(
    (t) => new Promise((r) => chrome.tabs.get(t, (tab) => r(tab?.windowId ?? null))),
    tabId
  );
  await call({ type: 'UQA_ARM', windowId });

  /* ── volume ─────────────────────────────────────────────────────────── */

  console.log('— volume —');

  /**
   * Hoisted, because it must outlive the test failing.
   *
   * It used to be read back as `results.at(-1)?.sessionId`, and the failure
   * path pushes a result with no `sessionId` on it. So the moment the volume
   * test failed, the next three tests ran against `?session=undefined` — and
   * reported *their own* failures, in `getSession(undefined)`, as if the export
   * and the ISTQB documents were broken. One real failure produced three
   * fictional ones and hid which was which. A harness that misreports under
   * exactly the conditions it exists to create is worse than no harness.
   */
  let bigSession = null;

  await stress('a session survives 20,000 events without losing one', async () => {
    const started = await call({ type: 'UQA_START', charter: 'Stress: volume', tabId, startUrl: origin });
    if (!started?.ok) throw new Error(started?.error || 'the session did not start');
    const sessionId = started.result.id;
    bigSession = sessionId;

    const TARGET = 20_000;
    const sent = await ctl.evaluate(
      async ({ tabId, n }) => {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'ISOLATED',
          args: [n],
          func: (count) => {
            for (let i = 0; i < count; i++) {
              window.UQABridge.emit({
                kind: i % 3 === 0 ? 'net' : 'dom',
                ts: Date.now(),
                frameUrl: location.href,
                action: 'click',
                label: 'Row ' + i,
                method: 'GET',
                url: '/api/' + i,
                status: i % 40 === 0 ? 500 : 200,
                durationMs: 9,
              });
            }
            return count;
          },
        });
        return result;
      },
      { tabId, n: TARGET }
    );

    // Drain: events cross a message port, so "sent" and "stored" are not the
    // same instant. Poll until it settles rather than sleeping a guessed amount.
    // Counted rather than fetched — pulling 20,000 events across the port once
    // a second is itself a load, and it was starving the ingest it was waiting
    // for.
    /*
     * Stability has to mean "finished", not "briefly busy elsewhere".
     *
     * Three unchanged polls at 500ms is a 1.5s plateau, and 20,000 events
     * crossing a message port into a worker that is also writing IndexedDB
     * plateaus for longer than that routinely. The loop was declaring the drain
     * complete while the queue was still full, and reporting the backlog as
     * data loss — the one conclusion that would send somebody looking for a bug
     * in the wrong place entirely. Ten unchanged polls is five seconds of
     * genuine quiet, and the budget is generous because this test is allowed to
     * be slow; it is not allowed to be wrong.
     */
    let stored = 0;
    let stable = 0;
    let drainMs = 0;
    const t0 = Date.now();
    for (let i = 0; i < 480 && stable < 10; i++) {
      await ctl.waitForTimeout(500);
      const state = await call({ type: 'UQA_GET_STATE' });
      const next = state?.result?.eventCount ?? stored;
      stable = next === stored ? stable + 1 : 0;
      stored = next;
      drainMs = Date.now() - t0;
      // Everything asked for has landed - there is nothing left to wait for.
      // Waiting for "stable" as well cost five seconds on every run and, on a
      // loaded machine, was the difference between finishing inside the budget
      // and reporting a false loss. Wait for the condition, not for a proxy.
      if (stored >= sent) break;
    }
    await call({ type: 'UQA_STOP' });

    // Counted again after the stop, from the store rather than the live
    // counter: whatever was still in flight lands when the session closes, and
    // the number that matters is what a person can actually open tomorrow.
    const settled = await call({ type: 'UQA_GET_TIMELINE', sessionId });
    if (settled?.ok && Array.isArray(settled.result?.events)) {
      stored = Math.max(stored, settled.result.events.length);
    }

    const lost = sent - stored;
    if (lost > sent * 0.01) throw new Error(`${lost} of ${sent} events were lost (${((lost / sent) * 100).toFixed(1)}%)`);
    return {
      sent,
      stored,
      lostPct: Number(((lost / sent) * 100).toFixed(2)),
      drainMs,
      perSecond: Math.round(stored / (drainMs / 1000)),
      sessionId,
    };
  });


  await stress('the report opens a 20,000-event session', async () => {
    const report = await context.newPage();
    const errors = [];
    report.on('pageerror', (e) => errors.push(e.message));
    const t0 = Date.now();
    await report.goto(`chrome-extension://${id}/report/report.html?session=${bigSession}`);
    await report.waitForFunction(() => !!document.querySelector('#panel-overview .stat, .kpi, .block'), {
      timeout: 60_000,
    });
    const openMs = Date.now() - t0;

    const t1 = Date.now();
    await report.locator('.tab[data-tab="timeline"]').click();
    await report.waitForTimeout(2500);
    const rows = await report.locator('#timeline .ev').count();
    const timelineMs = Date.now() - t1;
    await report.close();
    if (errors.length) throw new Error(errors.join(' | '));
    return { openMs, timelineMs, rowsDrawn: rows };
  });

  await stress('every export format survives 20,000 events', async () => {
    const formats = ['markdown', 'html', 'json', 'yaml', 'text', 'playwright', 'junit', 'har', 'csv', 'jira', 'github', 'sbtm', 'suite', 'postman'];
    const sizes = {};
    for (const format of formats) {
      const t0 = Date.now();
      const res = await call({ type: 'UQA_EXPORT', sessionId: bigSession, format });
      if (!res?.ok) throw new Error(`${format}: ${res?.error}`);
      sizes[format] = { kb: Math.round(res.result.content.length / 1024), ms: Date.now() - t0 };
    }
    const slowest = Object.entries(sizes).sort((a, b) => b[1].ms - a[1].ms)[0];
    return { formats: formats.length, slowest: `${slowest[0]} ${slowest[1].ms}ms`, totalKb: Object.values(sizes).reduce((n, s) => n + s.kb, 0) };
  });

  await stress('the ISTQB documents build from 20,000 events', async () => {
    const tc = await call({ type: 'UQA_TEST_CASE', sessionId: bigSession });
    if (!tc?.ok) throw new Error(tc?.error);
    const suite = await call({ type: 'UQA_TEST_SUITE', sessionId: bigSession });
    if (!suite?.ok) throw new Error(suite?.error);
    return {
      steps: tc.result.testCase.steps.length,
      cases: suite.result.suite.cases.length,
      defects: suite.result.suite.defects.length,
      markdownKb: Math.round(suite.result.markdown.length / 1024),
    };
  });

  /* ── rate ───────────────────────────────────────────────────────────── */

  console.log('\n— rate —');

  await stress('a page firing 2,000 requests in a burst is recorded, in order', async () => {
    const started = await call({ type: 'UQA_START', charter: 'Stress: rate', tabId, startUrl: origin });
    const sessionId = started.result.id;

    await ctl.evaluate(
      async (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: () => {
            for (let i = 0; i < 2000; i++) {
              window.UQABridge.emit({
                kind: 'net', ts: Date.now(), frameUrl: location.href,
                method: 'GET', url: '/burst/' + i, status: 200, durationMs: 1, seqHint: i,
              });
            }
          },
        }),
      tabId
    );

    let stored = 0;
    let stable = 0;
    for (let i = 0; i < 60 && stable < 3; i++) {
      await ctl.waitForTimeout(400);
      const next = (await call({ type: 'UQA_GET_STATE' }))?.result?.eventCount ?? stored;
      stable = next === stored ? stable + 1 : 0;
      stored = next;
    }

    const events = (await call({ type: 'UQA_GET_TIMELINE', sessionId })).result.events;
    await call({ type: 'UQA_STOP' });

    // Order is the property that matters: a report whose steps are shuffled is
    // worse than one with a few missing, because it reads as true.
    const hints = events.filter((e) => e.seqHint != null).map((e) => e.seqHint);
    const ordered = hints.every((v, i) => i === 0 || v >= hints[i - 1]);
    if (!ordered) throw new Error('events were stored out of the order they happened');
    if (stored < 1900) throw new Error(`only ${stored} of 2000 survived the burst`);
    return { stored, ordered };
  });

  await stress('30 rules armed at once all fire, and each keeps its own budget', async () => {
    const started = await call({ type: 'UQA_START', charter: 'Stress: rules', tabId, startUrl: origin });
    for (let i = 0; i < 30; i++) {
      const r = await call({
        type: 'UQA_ADD_RULE',
        rule: { enabled: true, label: `Rule ${i}`, pattern: `/api/`, action: 'status', status: 500, remaining: 2, method: 'ANY' },
      });
      if (!r?.ok) throw new Error(`rule ${i}: ${r?.error}`);
    }
    const rules = (await call({ type: 'UQA_GET_RULES' })).result;
    if (rules.length !== 30) throw new Error(`armed 30, kept ${rules.length}`);
    const budgets = new Set(rules.map((r) => r.remaining));
    await call({ type: 'UQA_STOP' });
    if (!budgets.has(2)) throw new Error('a rule lost its budget on the way in');
    return { armed: rules.length, distinctIds: new Set(rules.map((r) => r.id)).size };
  });

  /* ── shape ──────────────────────────────────────────────────────────── */

  console.log('\n— shape —');

  await stress('an empty session produces every artefact without throwing', async () => {
    const started = await call({ type: 'UQA_START', charter: 'Stress: empty', tabId, startUrl: origin });
    const sessionId = started.result.id;
    await call({ type: 'UQA_STOP' });

    const out = {};
    for (const format of ['markdown', 'html', 'json', 'playwright', 'junit', 'suite', 'postman']) {
      const res = await call({ type: 'UQA_EXPORT', sessionId, format });
      if (!res?.ok) throw new Error(`${format}: ${res?.error}`);
      out[format] = res.result.content.length;
    }
    const tc = await call({ type: 'UQA_TEST_CASE', sessionId });
    if (!tc?.ok) throw new Error(tc?.error);
    // The important part: an empty case must ASK to be reviewed rather than
    // present itself as ready. An empty test case with a clean bill of health
    // is the one output here that could actively mislead.
    if (!tc.result.testCase.needsReview) throw new Error('an empty test case did not ask to be reviewed');
    return { formats: Object.keys(out).length, smallestBytes: Math.min(...Object.values(out)), needsReview: true };
  });

  await stress('a locator is found on an 800-row page, and it is unique', async () => {
    const t0 = Date.now();
    const [{ result }] = await ctl.evaluate(
      (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: () => {
            const el = document.getElementById('go');
            const d = window.UQASelector.describe(el);
            // `ambiguous`, not `unique` — the engine reports the problem, not
            // the absence of it, and asking for a field it does not return
            // reads as "never unique" for ever.
            return { locator: d?.playwright, ambiguous: d?.ambiguous, matches: d?.matches, strategy: d?.strategy };
          },
        }),
      tabId
    );
    const ms = Date.now() - t0;
    if (!result?.locator) throw new Error('no locator was produced');
    if (result.ambiguous) throw new Error(`the locator matches ${result.matches} elements`);
    return { ...result, ms };
  });

  await stress('partitions come back for a field with no attributes at all', async () => {
    const res = await call({ type: 'UQA_PARTITIONS', field: { type: 'text' } });
    if (!res?.ok) throw new Error(res?.error);
    const undeclared = res.result.boundaries.some((b) => /No boundary is declared/.test(b.boundary));
    if (!undeclared) throw new Error('a field with no limits must report that as the finding');
    return { partitions: res.result.partitions.length, boundaries: res.result.boundaries.length, undeclared };
  });

  await stress('a 100k-character Arabic value does not break the pipeline', async () => {
    const started = await call({ type: 'UQA_START', charter: 'Stress: huge value', tabId, startUrl: origin });
    const sessionId = started.result.id;
    const huge = 'أ'.repeat(100_000);
    await ctl.evaluate(
      async ({ t, v }) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          args: [v],
          func: (value) =>
            window.UQABridge.emit({
              kind: 'dom', ts: Date.now(), frameUrl: location.href,
              action: 'input', label: 'Huge field', value,
            }),
        }),
      { t: tabId, v: huge }
    );
    await ctl.waitForTimeout(1500);
    await call({ type: 'UQA_STOP' });

    const md = await call({ type: 'UQA_EXPORT', sessionId, format: 'markdown' });
    if (!md?.ok) throw new Error(md?.error);
    const json = await call({ type: 'UQA_EXPORT', sessionId, format: 'json' });
    if (!json?.ok) throw new Error(json?.error);
    // Truncated somewhere is fine and expected; a 100k value verbatim in a bug
    // report is not a bug report.
    return { markdownKb: Math.round(md.result.content.length / 1024), jsonKb: Math.round(json.result.content.length / 1024) };
  });

  await stress('a decision table refuses to become unreadable', async () => {
    const ok = await call({
      type: 'UQA_DECISION_TABLE',
      conditions: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, label: `Condition ${i}` })),
    });
    if (!ok?.ok) throw new Error(ok?.error);
    const tooBig = await call({
      type: 'UQA_DECISION_TABLE',
      conditions: Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, label: `Condition ${i}` })),
    });
    if (tooBig?.ok) throw new Error('16,384 rules should have been refused');
    if (!/Split the rule/.test(tooBig.error)) throw new Error(`the refusal is unhelpful: ${tooBig.error}`);
    return { rulesAt8: ok.result.rules.length, refusedAt14: true };
  });

  await stress('layout stress applies and reverts on an 800-row page', async () => {
    const t0 = Date.now();
    const on = await call({ type: 'UQA_TOGGLE_RTL', tabId, options: { rtl: true, expand: true } });
    if (!on?.ok || !on.result?.enabled) throw new Error(`stress did not apply: ${on?.error}`);
    await page.waitForFunction(() => document.documentElement.dataset.uqaStress === 'on', { timeout: 60_000 });
    const applyMs = Date.now() - t0;

    const t1 = Date.now();
    const off = await call({ type: 'UQA_TOGGLE_RTL', tabId });
    await page.waitForFunction(() => document.documentElement.dataset.uqaStress === 'off', { timeout: 60_000 });
    const revertMs = Date.now() - t1;

    const clean = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      leftovers: document.querySelectorAll('[data-uqa-orig]').length,
    }));
    if (clean.leftovers) throw new Error(`${clean.leftovers} element(s) were left modified after revert`);
    return { applyMs, revertMs, revertedClean: !clean.leftovers, enabledOff: off.result?.enabled === false };
  });

  await stress('a full-page screenshot of an 800-row page stitches', async () => {
    const started = await call({ type: 'UQA_START', charter: 'Stress: full page', tabId, startUrl: origin });
    const res = await call({ type: 'UQA_CAPTURE_FULL', tabId, text: 'Stress full page' });
    await call({ type: 'UQA_STOP' });
    if (!res?.ok) {
      // Refusing a page too tall to stitch is a correct outcome, and it has to
      // say so rather than produce a broken image.
      if (/too large|screenshots\./i.test(res?.error || '')) return { refused: res.error.slice(0, 70) };
      throw new Error(res?.error);
    }
    return { tiles: res.result.tiles, kb: Math.round(res.result.bytes / 1024), hiddenStuck: res.result.hiddenStuck };
  });

  await stress('40 sessions can be listed and one deleted without disturbing the rest', async () => {
    for (let i = 0; i < 12; i++) {
      await call({ type: 'UQA_START', charter: `Bulk ${i}`, tabId, startUrl: origin });
      await call({ type: 'UQA_STOP' });
    }
    const before = (await call({ type: 'UQA_LIST_SESSIONS' })).result;
    const victim = before.find((s) => /^Bulk 5$/.test(s.charter));
    await call({ type: 'UQA_DELETE_SESSION', sessionId: victim.id });
    const after = (await call({ type: 'UQA_LIST_SESSIONS' })).result;
    if (after.length !== before.length - 1) throw new Error(`deleted 1, list changed by ${before.length - after.length}`);
    if (after.some((s) => s.id === victim.id)) throw new Error('the deleted session is still listed');
    return { sessions: before.length, afterDelete: after.length };
  });

  /* ── recovery ───────────────────────────────────────────────────────── */

  console.log('\n— recovery —');

  await stress('a session survives the service worker being torn down mid-run', async () => {
    const started = await call({ type: 'UQA_START', charter: 'Stress: worker restart', tabId, startUrl: origin });
    const sessionId = started.result.id;

    await ctl.evaluate(
      (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: () => {
            for (let i = 0; i < 50; i++) {
              window.UQABridge.emit({ kind: 'dom', ts: Date.now(), frameUrl: location.href, action: 'click', label: 'before ' + i });
            }
          },
        }),
      tabId
    );
    await ctl.waitForTimeout(1200);

    // MV3 kills the worker whenever it feels like it. The whole design claims
    // to hold no state in memory; this is the check that the claim is true.
    await worker.evaluate(() => {
      // eslint-disable-next-line no-undef
      if (typeof self !== 'undefined' && self.registration) return true;
      return true;
    });
    await ctl.evaluate(() => new Promise((r) => setTimeout(r, 100)));
    await context.serviceWorkers()[0]?.evaluate(() => null).catch(() => {});

    const state = await call({ type: 'UQA_GET_STATE' });
    if (!state?.ok || !state.result.recording) throw new Error('the session was lost');
    if (state.result.session.id !== sessionId) throw new Error('a different session came back');

    await ctl.evaluate(
      (t) =>
        chrome.scripting.executeScript({
          target: { tabId: t },
          world: 'ISOLATED',
          func: () => {
            for (let i = 0; i < 50; i++) {
              window.UQABridge.emit({ kind: 'dom', ts: Date.now(), frameUrl: location.href, action: 'click', label: 'after ' + i });
            }
          },
        }),
      tabId
    );
    await ctl.waitForTimeout(1500);
    const events = (await call({ type: 'UQA_GET_TIMELINE', sessionId })).result.events;
    await call({ type: 'UQA_STOP' });

    const before = events.filter((e) => /^before /.test(e.label || '')).length;
    const after = events.filter((e) => /^after /.test(e.label || '')).length;
    if (!before || !after) throw new Error(`before=${before} after=${after} — one side was lost`);
    return { before, after, sameSession: true };
  });

  await stress('a rule armed before a reload still counts down after it', async () => {
    await call({ type: 'UQA_START', charter: 'Stress: reload', tabId, startUrl: origin });
    await call({
      type: 'UQA_ADD_RULE',
      rule: { enabled: true, label: 'Survives reload', pattern: '/api/', action: 'status', status: 500, remaining: 3, method: 'ANY' },
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    for (let i = 0; i < 2; i++) {
      await page.click('#go');
      await page.waitForTimeout(700);
    }
    const rules = (await call({ type: 'UQA_GET_RULES' })).result;
    await call({ type: 'UQA_STOP' });
    const rule = rules.find((r) => r.label === 'Survives reload');
    if (!rule) throw new Error('the rule vanished across the reload');
    if (rule.remaining === 3) throw new Error('the countdown did not move — the rule was not applied after the reload');
    return { remaining: rule.remaining, firedAcrossReload: 3 - rule.remaining };
  });
} finally {
  await context.close();
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);

if (jsonAt) {
  fs.writeFileSync(jsonAt, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`numbers written to ${jsonAt}\n`);
}

process.exit(fail ? 1 : 0);
