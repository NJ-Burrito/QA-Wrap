/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Every button, pressed. btn-1011, rebuilt for the test pipeline (P4, 2026-10-12).
 *
 * tools/clickthrough.mjs presses the controls somebody thought of; this one presses the ones nobody did. It opens every
 * extension surface in a real, headed Chrome (the secondary monitor, Playwright clicks only, never the OS mouse), lists every
 * control that is drawn and presses each one. "Does something" is measured: a press counts when the DOM, a form value, the
 * focus, a message to the worker, a tab, window, download, dialog, file chooser, clipboard write or navigation moved after it.
 * No effect = DEAD, an error logged = BROKEN, cannot be pressed = UNPRESSABLE; all three fail the run (EXPECTED lists the few
 * allowed to stay silent, each with its reason).
 *
 *   node tools/test-buttons-all.mjs [--only popup,options] [--live-sweep] [--jobs 3] [--label x]
 *
 * Safety, in the order it happens (spec S3, S4, S5):
 *   1. DRY-RUN BY DEFAULT. Without --live-sweep nothing is pressed: every surface is opened, every control is listed and
 *      classified, the chunk plan is printed, the exit code is 2 and the first line says SKIPPED (a skip is never a pass).
 *   2. CLASSIFY FIRST (lib-sweep.mjs). Outward controls are derived by rule (href scheme, the handler read from the source,
 *      outward message names), never from a hand list. An outward control is not pressed. A control that cannot be classified
 *      is "FAIL classify me" and is not pressed either; tools/sweep-safe.json lists the few whose handler cannot be read.
 *   3. REPLACE, DO NOT TAP. window.close, tabs.remove, windows.remove, runtime.reload are recorded and never forwarded; opens
 *      and downloads go only to loopback / extension / blob / data targets.
 *   4. CHUNKS. At most 60 presses per chunk, each chunk in its own child process with its own fresh browser, started through
 *      lib-sandbox (dead-port proxy, run-scoped home and temp, egress observer, sweep guard). --jobs chunks run side by side.
 *
 * Exit: 0 live and clean, 1 any dead / broken / unpressable / silent-error / unclassified / egress, 2 dry-run clean, 64 usage.
 * Output: a table on stdout, work/btn-1011/audit-<label>.json, and <QAW_RUNDIR>/sweeps/buttons-all-<label>.json for run.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib-launch.mjs';
import { keepOnTop } from './lib-test-window.mjs';
import { freshWorker, purgeWorkerCache } from './lib-fresh.mjs';
import { awaitSiteScripts, grantedExtension, seedConsent } from './lib-granted.mjs';
import { REPO } from './lib-paths.mjs';
import { BASE_PER_CHUNK, classify, clampChunk, normKey, settle, sweepInstrument, writeRunResult } from './lib-sweep.mjs';
import { buildChildEnv, egressReport, readObserver, teardownRun } from './lib-sandbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const flag = (n) => argv.includes(`--${n}`);
const ONLY = (arg('only') || '').split(',').filter(Boolean);
const LABEL = (arg('label') || 'run').replace(/[^A-Za-z0-9._-]/g, '_');
const SIZE = (arg('size') || '').match(/^(\d+)x(\d+)$/) ? { width: +arg('size').split('x')[0], height: +arg('size').split('x')[1] } : null;
const SETTLE = arg('settle') === 'fixed' ? 'fixed' : 'quiet';
const CAP = clampChunk(arg('chunk-size'));
const BASE = Math.max(1, Math.min(BASE_PER_CHUNK, Math.floor(CAP * 0.75)));
const JOBS = Math.max(1, Math.min(4, Number(arg('jobs')) || 3));
const MAXC = Number(arg('max-chunks')) || Infinity; // debugging aid: stop scheduling follow-up chunks after this many per surface
const LIVE = flag('live-sweep') || (process.env.QAW_SANDBOX === '1' && process.env.QAW_SWEEP === '1' && !argv.includes('--worker')); // the pipeline sets QAW_SWEEP only for its --live-sweep
const OUT = path.join(REPO, 'work', 'btn-1011');

/** Controls allowed to leave no trace, each with the reason. Matched against "surface :: key". Keep it short and honest. */
const EXPECTED = [
  { re: /^practice :: button#p-(save|apply)\(/, why: 'the practice page is a training ground with deliberate bugs (practice/faults.js, the fixture)' },
  { re: /^videoedit :: button#play\(/, why: 'the harness can only seed a PNG screenshot, so the editor has no video source to play; the editor itself is covered by test-videoedit' },
];

const SURFACE_NAMES = ['popup-asleep', 'popup-awake', 'popup-recording', 'float', 'sidepanel', 'options', 'report', 'reporter', 'api', 'diagram', 'welcome', 'practice', 'annotate', 'replay', 'videoedit', 'devtools-panel'];
const pickSurfaces = (all) => all.filter((s) => !ONLY.length || ONLY.some((o) => s === o || s.startsWith(o + '-')));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD = ['dead', 'broken', 'unpressable', 'silent-error', 'unclassified'];

/* ═══════════════════════════════ orchestrator ═══════════════════════════════ */

async function orchestrate() {
  const names = pickSurfaces(SURFACE_NAMES);
  if (!names.length) { console.log(`usage: --only matches no surface (${SURFACE_NAMES.join(', ')})`); process.exit(64); }
  const standalone = !process.env.QAW_RUNDIR;
  const runDir = standalone ? fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-sweep-')) : process.env.QAW_RUNDIR;
  const runId = process.env.QAW_RUNID || path.basename(runDir);
  const ext = grantedExtension({ label: `buttons-${LABEL}` });
  const stateDir = path.join(runDir, `buttons-${LABEL}`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  console.log(LIVE ? `LIVE SWEEP ${LABEL}: ${names.length} surfaces, chunks of at most ${CAP} presses, ${JOBS} at a time, settle ${SETTLE}` : `SKIPPED: dry-run (no --live-sweep): nothing is pressed. Surfaces ${names.length}, classify only.`);

  const queue = names.map((surface) => ({ surface, no: 0, slice: LIVE ? [0, BASE] : null, dry: !LIVE }));
  const done = [];
  const chunkTimes = [];
  const suites = [];
  let active = 0;
  const runJob = (job, slot) => new Promise((resolve) => {
    const suite = `buttons-${LABEL}-${job.surface}-${job.no}`;
    suites.push(suite);
    const descFile = path.join(stateDir, `${suite}.job.json`);
    const outFile = path.join(stateDir, `${suite}.out.json`);
    fs.writeFileSync(descFile, JSON.stringify({ ...job, label: LABEL, cap: CAP, settle: SETTLE, slot, ext, runDir, out: outFile, profile: path.join(runDir, 'profiles', suite) }));
    const built = buildChildEnv({ runDir, suite, runId, sweep: true, engine: process.env.QAW_ENGINE });
    const logFd = fs.openSync(path.join(stateDir, `${suite}.log`), 'w');
    const t = Date.now();
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', descFile], { cwd: path.dirname(HERE), env: built.env, stdio: ['ignore', logFd, logFd], windowsHide: false });
    const timer = setTimeout(() => { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); }, 9 * 60 * 1000);
    child.on('error', (e) => { fs.appendFileSync(path.join(stateDir, `${suite}.log`), `spawn error ${e.message}
`); });
    child.on('close', (code) => {
      clearTimeout(timer); fs.closeSync(logFd);
      let out = null; try { out = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { /* worker died */ }
      const ms = Date.now() - t;
      chunkTimes.push({ surface: job.surface, chunk: job.no + 1, ms, settle: SETTLE });
      if (!out && !job.retried) { console.log(`  chunk ${job.surface}#${job.no + 1}: no result (exit ${code}), starting it once more`); queue.unshift({ ...job, retried: true }); resolve(); return; }
      if (!out) out = { surface: job.surface, results: [{ key: `(chunk ${job.no + 1})`, verdict: 'broken', why: `chunk process ended with exit ${code} and no result (see ${suite}.log)` }], total: 0, rest: [] };
      done.push(out);
      const r = out.results || [];
      const pf = out.prof ? ` [open ${Math.round(out.prof.open / 1000)}s x${out.prof.nOpen}, enum ${Math.round(out.prof.enumerate / 1000)}s, find ${Math.round(out.prof.find / 1000)}s, press ${Math.round(out.prof.press / 1000)}s x${out.prof.nPress}]` : '';
      console.log(`  chunk ${job.surface}#${job.no + 1}: ${r.filter((x) => x.verdict === 'alive').length} alive, ${r.filter((x) => BAD.includes(x.verdict)).length} bad of ${r.length} in ${(ms / 1000).toFixed(0)} s${out.total ? ` (surface has ${out.total} controls)` : ''}${pf}`);
      if (LIVE && job.no === 0 && job.slice) for (let a = BASE, k = 0; a < (out.total || 0) && k + 1 < MAXC; a += BASE, k++) queue.push({ surface: job.surface, no: 100 + k, slice: [a, Math.min(out.total, a + BASE)] });
      if (LIVE && (out.rest || []).length) for (let k = 0; k < out.rest.length; k += CAP) queue.push({ surface: job.surface, no: 200 + Math.floor(Math.random() * 1e6), tasks: out.rest.slice(k, k + CAP) });
      resolve();
    });
  });
  await Promise.all([...Array(JOBS).keys()].map(async (slot) => {
    for (;;) {
      const job = queue.shift();
      if (!job) { if (active === 0) return; await sleep(250); continue; }
      active++;
      try { await runJob(job, slot); } finally { active--; }
    }
  }));

  /* ── assemble ── */
  const results = [];
  for (const o of done) for (const r of o.results || []) results.push({ surface: o.surface, ...r });
  const tally = {}; for (const r of results) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
  const classes = {}; for (const o of done) for (const [k, v] of Object.entries(o.classes || {})) classes[k] = (classes[k] || 0) + v;
  const bySurface = {}; for (const r of results) bySurface[r.surface] = (bySurface[r.surface] || 0) + 1;
  const controls = {}; for (const o of done) if (o.total) controls[o.surface] = Math.max(controls[o.surface] || 0, o.total);
  const bad = results.filter((r) => BAD.includes(r.verdict) && !EXPECTED.some((e) => e.re.test(`${r.surface} :: ${r.key}`)));
  let egress = { fails: [], stubbed: 0, handoffs: [] };
  for (const s of suites) {
    try { const e = egressReport(readObserver(runDir, s), s); egress.fails.push(...e.failures.map((f) => `${s} ${f.url} (${f.why})`)); egress.stubbed += e.stubbed.length; egress.handoffs.push(...e.handoffs.map((h) => h.scheme)); } catch { /* no observer: the chunk never launched */ }
  }
  const ms = Date.now() - t0;
  const summary = { at: new Date().toISOString(), label: LABEL, mode: LIVE ? 'live' : 'dry', settle: SETTLE, chunkSize: CAP, jobs: JOBS, wallMs: ms, tally, classes, controls, bySurface, chunks: chunkTimes.length, timing: { chunks: chunkTimes }, egress, bad, badCount: bad.length + egress.fails.length };
  fs.writeFileSync(path.join(OUT, `audit-${LABEL}.json`), JSON.stringify({ ...summary, results }, null, 1));
  const runFile = writeRunResult(`buttons-all-${LABEL}`, summary);

  console.log('\n' + '─'.repeat(60));
  console.log('tally', JSON.stringify(tally));
  console.log('classes', JSON.stringify(classes));
  console.log(`surfaces: ${[...new Set(results.map((r) => r.surface))].join(', ')}`);
  console.log(`chunks ${chunkTimes.length}, wall ${(ms / 60000).toFixed(1)} min (${(ms / 1000).toFixed(0)} s), egress failures ${egress.fails.length}, stubbed ${egress.stubbed}, handoffs ${egress.handoffs.length}`);
  console.log(`DEAD/BROKEN/UNPRESSABLE/UNCLASSIFIED: ${bad.length}`);
  console.log(`dead ${bad.length}`);
  for (const b of bad) console.log(`  ${b.verdict.toUpperCase().padEnd(11)} ${b.surface} :: ${b.key}  ${b.why || ''}`);
  for (const f of egress.fails) console.log(`  FAIL EGRESS ${f}`);
  if (runFile) console.log(`run.json input: ${runFile}`);
  const alive = tally.alive || 0;
  console.log(`${alive} passed, ${bad.length + egress.fails.length} failed`);

  // the children's profiles are the sweep's own scratch: to the recycle bin, never rm
  const trash = process.env.QAW_TRASH || '';
  const prof = path.join(runDir, 'profiles');
  if (standalone) { const t = teardownRun({ runId, runDir }); if (t.left.length) console.log(`  WARN browser processes of this sweep still alive: ${t.left.join(',')}`); }
  if (fs.existsSync(prof) && fs.existsSync(trash)) spawnSync('python', [trash, prof], { stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } });
  if (fs.existsSync(ext) && fs.existsSync(trash)) spawnSync('python', [trash, ext], { stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } });
  if (!LIVE) process.exit(bad.length ? 1 : 2);
  process.exit(bad.length || egress.fails.length ? 1 : 0);
}

/* ═══════════════════════════════ worker (one chunk, one fresh browser) ═══════════════════════════════ */

const CANDIDATES = `button, a[href], summary, select, input[type=checkbox], input[type=radio], input[type=button], input[type=submit], input[type=reset], input[type=file], input[type=color], input[type=range],
  [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=switch], [role=link], [role=checkbox], [role=radio], [role=option], [onclick], [data-action]`;

/** Page side, installed in every document: snapshots stay in the page, only counts cross the wire. */
function snapInstall() {
  if (window.__snapT) return;
  window.__snaps = {}; window.__snapN = {};
  window.__snapT = (name) => {
    const out = {}; let n = 0;
    for (const el of document.querySelectorAll('body, body *')) {
      if (/^(SCRIPT|STYLE|LINK|META)$/.test(el.tagName)) continue;
      const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).join('|').slice(0, 80);
      const at = [...el.attributes].map((a) => `${a.name}=${a.name === 'src' || a.name === 'href' ? a.value.slice(0, 40) : a.value}`).join(';');
      const props = (el.value !== undefined && el.tagName !== 'BUTTON' ? 'v=' + String(el.value).slice(0, 40) : '') + (el.checked !== undefined ? 'c=' + el.checked : '') + (el.open !== undefined ? 'o=' + el.open : '') + (el.selectedIndex !== undefined ? 's=' + el.selectedIndex : '');
      out[n++ + ':' + el.tagName] = `${at}#${own}#${props}`;
    }
    const a = document.activeElement;
    out['@focus'] = a ? (a.dataset?.bt ?? a.tagName) + (a.id || '') : '';
    out['@scroll'] = `${scrollX},${scrollY}`; out['@title'] = document.title; out['@count'] = String(n);
    window.__snaps[name] = out; return n;
  };
  const keys = (a, b) => { const A = window.__snaps[a], B = window.__snaps[b]; return Object.keys({ ...A, ...B }).filter((k) => A[k] !== B[k]); };
  window.__snapNoise = (a, b, name) => { window.__snapN[name] = new Set(keys(a, b)); return window.__snapN[name].size; };
  window.__snapD = (a, b, noise) => { const N = noise ? window.__snapN[noise] : null; return keys(a, b).filter((k) => !(N && N.has(k))).length; };
}

/** Stamp every control not stamped before and return them. */
function enumeratePage(sel) {
  const seen = (window.__btN ||= { n: 0 });
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none' || el.matches('input[type=checkbox],input[type=radio]');
  };
  const tokens = (el) => {
    const t = new Set();
    for (const n of ['data-action', 'data-act', 'data-tab', 'data-tool', 'data-fav', 'data-open', 'data-cmd', 'data-kind', 'data-mode', 'data-fmt', 'data-lang', 'data-id', 'name']) { const v = el.getAttribute(n); if (v) t.add(v); }
    const row = el.closest('[data-tool]'); if (row?.dataset.tool) t.add(row.dataset.tool);
    for (const c of el.classList) if (c.length >= 4 && !/^(btn|button|active|hidden|primary|secondary)$/.test(c)) t.add('.' + c);
    return [...t].slice(0, 12);
  };
  const out = [];
  const take = (el, how) => {
    if (el.dataset.bt != null) return;
    if (!visible(el) && !(el.matches('input[type=checkbox],input[type=radio],input[type=file]') && el.closest('label') && visible(el.closest('label')))) return;
    const i = seen.n++;
    el.dataset.bt = String(i);
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || el.getAttribute('data-action') || el.getAttribute('placeholder') || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    const role = el.getAttribute('role') || el.type || '';
    out.push({
      i, how,
      key: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${role ? '(' + role + ')' : ''}[${label}]`,
      disabled: !!el.closest('[disabled],[aria-disabled=true],fieldset:disabled'),
      href: el.tagName === 'A' ? el.getAttribute('href') : null,
      formaction: el.getAttribute('formaction'), inLabel: !!el.closest('label'),
      tag: el.tagName.toLowerCase(), type: el.type || '', id: el.id || '', act: el.getAttribute('data-act') || '', role: el.getAttribute('role') || '', label,
      tokens: tokens(el),
    });
  };
  for (const el of document.querySelectorAll(sel)) take(el, 'semantic');
  for (const el of document.body.querySelectorAll('*')) {
    if (el.dataset.bt != null || el.matches(sel) || el.closest(sel)) continue;
    if (/^(HTML|BODY|SCRIPT|STYLE|SVG|PATH|CANVAS|HEAD)$/i.test(el.tagName)) continue;
    if (getComputedStyle(el).cursor === 'pointer') take(el, 'pointer');
  }
  return out;
}

async function worker(descFile) {
  const D = JSON.parse(fs.readFileSync(descFile, 'utf8'));
  const result = { surface: D.surface, no: D.no, total: 0, results: [], rest: [], classes: {} };
  const prof = (result.prof = { open: 0, nOpen: 0, enumerate: 0, press: 0, nPress: 0, find: 0 });
  const timed = async (k, fn) => { const t = Date.now(); try { return await fn(); } finally { prof[k] += Date.now() - t; } };
  const finish = (code = 0) => { fs.writeFileSync(D.out, JSON.stringify(result)); process.exit(code); };
  const EXT = D.ext;
  fs.mkdirSync(D.profile, { recursive: true });
  purgeWorkerCache(D.profile);
  const slot = D.slot || 0;
  const context = await chromium.launchPersistentContext(D.profile, launchOptions(EXT, { position: `${60 + slot * 45},${60 + slot * 35}` }));
  await keepOnTop(context);

  const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title></head>
<body><h1>Application form</h1>
<label for="applicant">Applicant name</label><input id="applicant" type="text" maxlength="40" required />
<label for="amount">Amount</label><input id="amount" type="number" min="1" max="500" step="1" />
<button id="submit" type="button">Submit application</button><div id="r"></div>
<script>document.getElementById('submit').onclick=async()=>{
  const res=await fetch('/api/applications',{method:'POST',headers:{'content-type':'application/json'},body:'{"a":1}'});
  document.getElementById('r').textContent='status '+res.status;};</script></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"boom"}'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  /* Nothing leaves the machine: any other host answers with a stub page (the dead-port proxy is the belt). */
  await context.route((u) => !/^(chrome-extension|chrome|data|blob|about):/.test(u.href) && u.hostname !== '127.0.0.1', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: '<title>external stub</title>external' }));
  await context.addInitScript(sweepInstrument);
  await context.addInitScript(snapInstall);

  const errors = [];
  const SANDBOX_NOISE = /^Blocked script execution in 'about:(blank|srcdoc)' because the document's frame is sandboxed/;
  const watchErrors = (p, label) => {
    p.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !(label === 'replay' && SANDBOX_NOISE.test(m.text()))) errors.push(`[${label}] ${m.text()}`); });
  };

  const target = await context.newPage(); watchErrors(target, 'fixture');
  let ctl = await context.newPage(); watchErrors(ctl, 'ctl');
  const wk = await freshWorker(context); watchErrors(wk, 'worker');
  const id = new URL(wk.url()).host;
  await seedConsent(wk);
  await awaitSiteScripts(wk);
  await target.goto(origin, { waitUntil: 'domcontentloaded' });
  await ctl.goto(`chrome-extension://${id}/popup/popup.html`);
  await ctl.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 15000 });

  const send = (msg) => ctl.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), msg);
  const stateOf = () => ctl.evaluate(() => ({ awake: document.body.dataset.awake === 'true', live: !document.getElementById('step-live')?.hidden }));
  async function ctlReload() {
    try { await ctl.reload({ timeout: 15000 }); }
    catch { await ctl.close().catch(() => {}); ctl = await context.newPage(); watchErrors(ctl, 'ctl'); await ctl.goto(`chrome-extension://${id}/popup/popup.html`); }
  }
  const unfold = (pg, ids = ['wake-options', 'tools-fold']) => pg.evaluate((l) => l.forEach((i) => { const d = document.getElementById(i); if (d && d.tagName === 'DETAILS') d.open = true; }), ids).catch(() => {});
  async function ensure(want) {
    await ctlReload();
    await ctl.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 15000 });
    let s = await stateOf();
    if (s.live && want !== 'recording') { await send({ type: 'UQA_STOP' }); await ctlReload(); await ctl.waitForFunction(() => document.body.dataset.ready === 'true'); s = await stateOf(); }
    await unfold(ctl);
    if (want === 'asleep' && s.awake) { if (await ctl.locator('#awake-pill').isVisible()) await ctl.click('#awake-pill'); await ctl.click('#switch'); await ctl.waitForFunction(() => document.body.dataset.awake === 'false', { timeout: 8000 }); }
    if (want !== 'asleep' && !s.awake) { if (await ctl.locator('#awake-pill').isVisible()) await ctl.click('#awake-pill'); await ctl.click('#switch'); await ctl.waitForFunction(() => document.body.dataset.awake === 'true', { timeout: 8000 }); }
    if (want === 'recording' && !s.live) {
      await send({ type: 'UQA_START', charter: 'Buttons audit' });
      await ctlReload();
      await ctl.waitForFunction(() => !document.getElementById('step-live').hidden, { timeout: 8000 });
    }
  }
  const seeded = {};
  async function seed() {
    await ensure('recording');
    await target.bringToFront().catch(() => {});
    await target.fill('#applicant', 'Seed');
    await target.click('#submit');
    await target.waitForTimeout(500);
    await unfold(ctl);
    await ctl.click('[data-action="shot"]');
    await ctl.waitForTimeout(2200);
    const sessionId = await ctl.evaluate(() => new Promise((r) => chrome.storage.session.get('activeSessionId', (v) => r(v.activeSessionId))));
    const media = await send({ type: 'UQA_MEDIA_LIST', sessionId });
    await send({ type: 'UQA_STOP' });
    await ctl.waitForTimeout(500);
    const last = await ctl.evaluate(() => new Promise((r) => chrome.storage.session.get('lastSessionId', (v) => r(v.lastSessionId))));
    seeded.sessionId = last || sessionId;
    const shots = (media?.result || []);
    seeded.mediaId = (shots.find((m) => /image|png|shot/i.test(`${m.kind || ''}${m.type || ''}${m.mime || ''}`)) || shots[0])?.id || null;
    return seeded;
  }
  const sessionAlive = async () => { const l = await send({ type: 'UQA_LIST_SESSIONS' }); return (l?.result || []).some((s) => s.id === seeded.sessionId); };

  const X = (p) => `chrome-extension://${id}/${p}`;
  const DEFS = {
    'popup-asleep': { url: () => X('popup/popup.html'), state: 'asleep', ready: 'body[data-ready=true]' },
    'popup-awake': { url: () => X('popup/popup.html'), state: 'awake', ready: 'body[data-ready=true]' },
    'popup-recording': { url: () => X('popup/popup.html'), state: 'recording', ready: 'body[data-ready=true]' },
    float: { url: () => X('popup/popup.html?surface=float'), state: 'awake', ready: 'body[data-ready=true]' },
    sidepanel: { url: () => X('sidepanel/sidepanel.html'), state: 'awake', frame: 'popup/popup.html', ready: 'body[data-ready=true]' },
    options: { url: () => X('options/options.html'), state: 'awake' },
    report: { url: () => X(`report/report.html?session=${seeded.sessionId}`), state: 'awake', session: true },
    reporter: { url: () => X('reporter/reporter.html'), state: 'awake' },
    api: { url: () => X('api/api.html'), state: 'recording' },
    diagram: { url: () => X(`diagram/diagram.html?session=${seeded.sessionId}`), state: 'awake', session: true },
    welcome: { url: () => X('welcome/welcome.html'), state: 'awake' },
    practice: { url: () => X('practice/practice.html'), state: 'awake' },
    annotate: { url: () => X(`annotate/annotate.html?id=${seeded.mediaId}`), state: 'awake', session: true },
    replay: { url: () => X(`replay/replay.html?session=${seeded.sessionId}`), state: 'awake', session: true },
    videoedit: { url: () => X(`videoedit/videoedit.html?id=${seeded.mediaId}`), state: 'awake', session: true },
    'devtools-panel': { url: () => X(`devtools/panel.html?session=${seeded.sessionId}`), state: 'awake', session: true },
  };
  const S = { name: D.surface, ...DEFS[D.surface] };
  const events = [];
  let page;
  context.on('page', (p) => { if (p !== page) events.push('new-page:' + p.url().slice(0, 60)); });

  async function open(full = true) {
    // A plain re-open (the world is unchanged beyond this page) navigates the same page again: a new tab plus the fixture
    // reload cost about 1.2 s a press, the navigation about 0.3 s.
    const reuse = !full && page && !page.isClosed();
    if (!reuse) {
      if (page && !page.isClosed()) await page.close().catch(() => {});
      if (full) await send({ type: 'UQA_RESET_SETTINGS' }).catch(() => {});
      if (full) await ctl.evaluate(async () => { try { localStorage.clear(); await chrome.storage.sync.clear(); await chrome.storage.local.remove('qawLanguage'); } catch { /* */ } }).catch(() => {});
      if (full) await seedConsent(wk).catch(() => {});
      if (full && S.state) await ensure(S.state);
      if (full && S.session && !(await sessionAlive())) { await seed(); await ensure(S.state); }
      await target.goto(origin, { waitUntil: 'domcontentloaded' }).catch(() => {});
      page = await context.newPage();
      watchErrors(page, S.name);
      const sz = SIZE || (/^(popup|float|sidepanel)/.test(S.name) ? { width: 400, height: 600 } : null);
      if (sz) await page.setViewportSize(sz);
      page.on('dialog', (d) => { events.push('dialog:' + d.type()); d.accept(d.type() === 'prompt' ? 'x' : undefined).catch(() => {}); });
      page.on('download', () => events.push('download'));
      page.on('filechooser', () => events.push('filechooser'));
      page.on('close', () => events.push('page-closed'));
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) events.push('navigated:' + f.url().slice(0, 60)); });
    }
    await page.goto(S.url(), { waitUntil: 'domcontentloaded' });
    const frame = () => (S.frame ? page.frames().find((f) => f.url().includes(S.frame)) : page.mainFrame());
    if (S.frame) await page.waitForFunction(() => document.querySelectorAll('iframe').length > 0, null, { timeout: 5000 }).catch(() => {});
    const f0 = frame();
    if (S.ready && f0) await f0.waitForSelector(S.ready, { timeout: 15000, state: 'attached' }).catch(() => events.push('NOT-READY'));
    else await page.waitForTimeout(500);
    return frame;
  }

  /** Controls drawn late (popup rows) are waited for: the candidate count must hold still for two polls. */
  async function enumerateStable(f) {
    let last = -1, same = 0;
    for (const t0 = Date.now(); Date.now() - t0 < 3000;) {
      const n = await f.evaluate((sel) => document.querySelectorAll(sel).length, CANDIDATES).catch(() => -1);
      if (n === last) { if (++same >= 2) break; } else { same = 0; last = n; }
      await page.waitForTimeout(120).catch(() => {});
    }
    return f.evaluate(enumeratePage, CANDIDATES);
  }
  const enumerateIn = (f) => f.evaluate(enumeratePage, CANDIDATES);

  const classCount = (cl) => { result.classes[cl.cls] = (result.classes[cl.cls] || 0) + 1; };

  /** Press one control and return the record. Never throws. */
  async function pressOne(frameOf, c) {
    const f = frameOf();
    if (!f) return { key: c.key, verdict: 'broken', why: 'surface frame is gone' };
    if (c.disabled) return { key: c.key, verdict: 'disabled' };
    // 1. classify first
    const cl = classify(c, S.name);
    if (cl.cls === 'outward') return { key: c.key, verdict: 'skipped-outward', cls: cl.cls, why: `outward (${cl.rule}): ${cl.why}`.slice(0, 220) };
    if (cl.cls === 'href-only') return { key: c.key, verdict: 'alive', cls: cl.cls, effects: ['external-href:' + String(c.href).slice(0, 50)] };
    if (cl.cls === 'unclassified') return { key: c.key, verdict: 'unclassified', cls: cl.cls, why: `FAIL classify me: ${c.key} on ${S.name} (${cl.why})` };
    const loc = f.locator(`[data-bt="${c.i}"]`).first();
    try { fs.writeFileSync(path.join(path.dirname(D.out), `last-press-${S.name}-${D.no}.txt`), `${S.name} :: ${c.key}\n`); } catch { /* */ }
    // a control that vanished is not waited for (a locator would burn its whole timeout)
    if (!(await loc.count().catch(() => 0))) return { key: c.key, verdict: 'inconclusive', why: 'gone: the row was re-rendered or removed before the press' };
    const tmo = { timeout: 1500 };
    await f.evaluate(snapInstall).catch(() => {});
    await f.evaluate(() => { window.__snapT('s0'); }).catch(() => {});
    await page.waitForTimeout(100).catch(() => {});
    const noiseN = await f.evaluate(() => { window.__snapT('s1'); return window.__snapNoise('s0', 's1', 'n'); }).catch(() => null);
    if (noiseN === null) return { key: c.key, verdict: 'broken', why: 'page could not be read before the press' };
    await f.evaluate(() => { window.__fx.log.length = 0; }).catch(() => {});
    events.length = 0;
    const errMark = errors.length;
    await loc.evaluate((el) => { for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true; }, null, tmo).catch(() => {});
    try {
      if (c.tag === 'select') {
        const n = await loc.evaluate((e) => e.options.length, null, tmo);
        await loc.selectOption({ index: n > 1 ? ((await loc.evaluate((e) => e.selectedIndex, null, tmo)) + 1) % n : 0 }, { timeout: 3000 });
      } else if (c.type === 'range') {
        if (!(await loc.isVisible().catch(() => false))) {
          if (!(await f.locator('#soundEnabled').isChecked(tmo).catch(() => true))) await f.locator('label:has(#soundEnabled)').click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(400).catch(() => {});
          if (!(await loc.isVisible().catch(() => false))) return { key: c.key, verdict: 'not-shown', why: 'hidden by design: sound is off (options.js paintSound); covered by test-sound-volume-live' };
        }
        const before = await loc.inputValue({ timeout: 3000 }); await loc.focus({ timeout: 3000 });
        await loc.evaluate((e) => { e.__rangeEv = 0; for (const t of ['input', 'change']) e.addEventListener(t, () => { e.__rangeEv++; }); });
        for (const k of ['ArrowRight', 'ArrowLeft']) {
          await page.keyboard.press(k);
          const moved = (await loc.inputValue({ timeout: 3000 })) !== before || (await loc.evaluate((e) => e.__rangeEv)) > 0;
          if (moved) { events.push('range-value-moved'); break; }
        }
      } else if (c.type === 'color') {
        await loc.focus({ timeout: 3000 }); events.push('focus-only-color');
      } else if ((c.type === 'checkbox' || c.type === 'radio') && await loc.evaluate((e) => {
        if (!e.closest('label')) return false;
        const r = e.getBoundingClientRect();
        if (r.width < 4 || getComputedStyle(e).opacity === '0') return true;
        const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!h && h !== e;
      }, null, tmo).catch(() => false)) {
        await loc.locator('xpath=ancestor::label[1]').click({ timeout: 1500, noWaitAfter: true });
      } else if (await loc.evaluate((e) => e.hasAttribute('data-edge'), null, tmo).catch(() => false)) {
        const at = await loc.evaluate((g) => { const p = g.querySelector('path:not(.edge-hit)'); const m = p.getPointAtLength(p.getTotalLength() / 2).matrixTransform(p.getScreenCTM()); return { x: m.x, y: m.y }; });
        await page.mouse.click(at.x, at.y);
      } else {
        await loc.click({ timeout: 1500, noWaitAfter: true });
      }
    } catch (e) {
      if (page.isClosed()) return { key: c.key, verdict: 'alive', cls: cl.cls, effects: ['page-closed'] };
      const why = String(e.message).replace(/\x1b\[\d+m/g, '').split('\n').filter((l) => /intercepts|not visible|not enabled|not stable|outside|detached/i.test(l)).slice(-2).map((l) => l.trim()).join(' ; ');
      const hit = await loc.evaluate((el) => {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') return { kind: 'hidden' };
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { kind: 'offscreen', at: `${Math.round(x)},${Math.round(y)}` };
        const h = document.elementFromPoint(x, y);
        if (!h || h === document.documentElement || h === document.body) return { kind: 'offscreen', at: 'html/body under pointer' };
        const lab = el.closest('label');
        if (h === el || el.contains(h) || h.contains(el) || (lab && (lab === h || lab.contains(h)))) return { kind: 'ok-transient' };
        return { kind: 'covered', by: `${h.tagName.toLowerCase()}${h.id ? '#' + h.id : ''}${h.className && typeof h.className === 'string' ? '.' + h.className.split(' ')[0] : ''}` };
      }, null, tmo).catch(() => ({ kind: 'gone' }));
      if (hit.kind === 'hidden' || hit.kind === 'offscreen') return { key: c.key, verdict: 'not-shown', why: `${hit.kind} (closed sheet / collapsed section / hidden by design) ${hit.at || ''}` };
      if (hit.kind === 'covered') return { key: c.key, verdict: 'unpressable', why: `covered by ${hit.by}` };
      if (hit.kind === 'gone' || hit.kind === 'ok-transient') return { key: c.key, verdict: 'inconclusive', why: `${hit.kind}: ` + (why || String(e.message).split('\n')[0]).slice(0, 120) };
      return { key: c.key, verdict: 'unpressable', why: `not actionable in 1500 ms (${hit.kind}): ` + (why || String(e.message).split('\n')[0]).slice(0, 160) };
    }
    if (page.isClosed()) return { key: c.key, verdict: 'alive', cls: cl.cls, effects: ['page-closed'] };
    const measure = async () => {
      const dA = await f.evaluate(() => { window.__snapT('sA'); return window.__snapD('s1', 'sA', 'n'); }).catch(() => null);
      const st = await settle(page, f, D.settle, 650, { minMs: 60, quietMs: 120, capMs: 500 });
      if (page.isClosed()) return { closed: true };
      const dB = await f.evaluate(() => { window.__snapT('sB'); return window.__snapD('s1', 'sB', 'n'); }).catch(() => null);
      return { dA, dB, st };
    };
    let m = await measure();
    if (m.closed) return { key: c.key, verdict: 'alive', cls: cl.cls, effects: ['page-closed'] };
    const gather = async (mm) => {
      const effects = [];
      const dd = Math.max(mm.dA || 0, mm.dB || 0);
      if (dd) effects.push(`dom(${dd})`);
      if (mm.dA === null && mm.dB === null) effects.push('page-gone');
      const fxLog = await f.evaluate(() => window.__fx?.log.slice() || []).catch(() => ['unreadable']);
      for (const l of fxLog) if (!effects.includes(l)) effects.push(l);
      for (const e of events) if (!effects.includes(e) && e !== 'NOT-READY') effects.push(e);
      return effects;
    };
    let effects = await gather(m);
    const realOf = (list) => list.filter((e) => !/^msg:UQA_(PING|GET_STATE|POPUP_STATE|ARMED|RECORD_STATE)$/.test(e));
    // a press that looks dead gets one more fixed window before it is called dead, so the quiet settle cannot create a false dead
    if (!realOf(effects).length && D.settle === 'quiet') {
      await page.waitForTimeout(500).catch(() => {});
      if (page.isClosed()) return { key: c.key, verdict: 'alive', cls: cl.cls, effects: ['page-closed'] };
      const dC = await f.evaluate(() => { window.__snapT('sC'); return window.__snapD('s1', 'sC', 'n'); }).catch(() => null);
      m = { dA: m.dA, dB: Math.max(m.dB || 0, dC || 0) };
      effects = await gather(m);
    }
    const errs = errors.slice(errMark);
    const real = realOf(effects);
    if (errs.length) return { key: c.key, verdict: 'broken', cls: cl.cls, why: errs.join(' | ').slice(0, 200), effects };
    if (!real.length) return { key: c.key, verdict: 'dead', cls: cl.cls, why: 'no DOM, state, message, tab, download or dialog change after the settle plus a fixed 500 ms', effects };
    const replyErr = effects.filter((e) => e.startsWith('reply-error'));
    if (replyErr.length && !effects.some((e) => e.startsWith('dom'))) return { key: c.key, verdict: 'silent-error', cls: cl.cls, why: replyErr.join(' '), effects };
    return { key: c.key, verdict: 'alive', cls: cl.cls, effects };
  }

  const t0 = Date.now();
  try {
    if (S.session) await seed();
    let frameOf = await open();
    let base = await enumerateStable(frameOf());
    result.total = base.length;
    const stamped = new Map(); for (const b of base) if (!stamped.has(b.key)) stamped.set(b.key, b);
    const seenKeys = new Set(base.map((b) => b.key));
    if (D.dry || D.no === 0) for (const b of base) classCount(classify(b, S.name)); // classify the whole surface before anything is pressed
    console.log(`  ${S.name}: ${base.length} controls drawn; classes ${JSON.stringify(result.classes)}`);
    if (D.dry) {
      result.controls = base.map((b) => { const cl = classify(b, S.name); return { key: b.key, cls: cl.cls, rule: cl.rule, why: cl.why.slice(0, 160), id: b.id, tag: b.tag, role: b.role, type: b.type, label: b.label, href: b.href, tokens: b.tokens }; });
      for (const r of result.controls) if (r.cls === 'unclassified') result.results.push({ key: r.key, verdict: 'unclassified', why: `FAIL classify me: ${r.key} on ${S.name}` });
      for (const r of result.controls) if (r.cls !== 'unclassified') result.results.push({ key: r.key, verdict: 'planned', cls: r.cls });
      await context.close().catch(() => {}); server.close(); finish(0);
    }
    const tasks = D.tasks ? D.tasks.map((p) => p.slice()) : base.slice(D.slice[0], D.slice[1]).map((b) => [b.key]);
    const keyCount = new Map();
    const findByKey = async (fo, key) => {
      const fr = fo(); if (!fr) return null;
      const fresh = await enumerateIn(fr).catch(() => []);
      for (const x of fresh) if (!stamped.has(x.key)) stamped.set(x.key, x);
      return fresh.find((x) => x.key === key) || stamped.get(key) || null;
    };
    let dirty = false, fullReset = false, pressedN = 0;
    while (tasks.length && pressedN < D.cap) {
      const pathKeys = tasks.shift();
      const last = pathKeys[pathKeys.length - 1];
      const norm = normKey(last);
      const n = (keyCount.get(norm) || 0) + 1;
      keyCount.set(norm, n);
      if (n > 2) { result.results.push({ key: last, verdict: 'sampled' }); continue; }
      if (dirty || page.isClosed() || pathKeys.length > 1) {
        frameOf = await timed('open', () => open(fullReset)); prof.nOpen++; fullReset = false;
        stamped.clear(); for (const b of await timed('enumerate', () => enumerateStable(frameOf()))) if (!stamped.has(b.key)) stamped.set(b.key, b);
        dirty = false;
        let ok = true;
        for (const k of pathKeys.slice(0, -1)) {
          const parent = await findByKey(frameOf, k);
          if (!parent) { ok = false; break; }
          await pressOne(frameOf, parent); // already judged when it was queued
          await page.waitForTimeout(150).catch(() => {});
        }
        if (!ok) { result.results.push({ key: last, verdict: 'gone', why: `parent "${pathKeys[0]}" did not bring it back`, path: pathKeys.join(' > ') }); continue; }
      }
      const c = await timed('find', () => findByKey(frameOf, last));
      if (!c) { result.results.push({ key: pathKeys.join(' > '), verdict: 'gone' }); continue; }
      const r = await timed('press', () => pressOne(frameOf, c)); prof.nPress++;
      r.path = pathKeys.length > 1 ? pathKeys.join(' > ') : undefined;
      result.results.push(r);
      if (!['disabled', 'skipped-outward', 'unclassified', 'inconclusive'].includes(r.verdict)) pressedN++;
      if (r.verdict === 'alive' || r.verdict === 'broken') dirty = true;
      // only a press that can have changed the world (settings, state, tabs, files, a mutating message) pays for the full reset;
      // reads (UQA_GET_*, UQA_LIST_* ...) and page-local effects are undone by navigating the same page again
      const READ_ONLY = /^(dom\(|scroll|fetch$|clipboard|createObjectURL|focus-only|range-value|window\.print|fullscreen|popover|dialog\.show|external-href|msg:UQA_(GET|LIST|PING|PEEK|READ|HAS|IS|STATUS|STATE|INFO|CHECK|PREVIEW|COUNT|MEDIA_LIST|OPEN_))/;
      if (r.verdict !== 'alive' || (r.effects || []).some((e) => !READ_ONLY.test(e))) fullReset = true;
      if (r.verdict === 'alive' && pathKeys.length < 2 && !page.isClosed()) {
        const f2 = frameOf();
        const fresh = f2 ? await enumerateIn(f2).catch(() => []) : [];
        for (const d of fresh) { if (!stamped.has(d.key)) stamped.set(d.key, d); if (!seenKeys.has(d.key)) { seenKeys.add(d.key); tasks.unshift([...pathKeys, d.key]); } }
      }
      for (const p of context.pages()) if (p !== page && p !== target && p !== ctl) await p.close().catch(() => {});
    }
    result.rest = tasks.filter((p) => !(keyCount.get(normKey(p[p.length - 1])) >= 2));
  } catch (e) {
    result.results.push({ key: '(whole chunk)', verdict: 'broken', why: String(e.message).slice(0, 200) });
  }
  result.ms = Date.now() - t0;
  for (const p of context.pages()) await p.close().catch(() => {});
  await context.close().catch(() => {});
  server.close();
  finish(0);
}

const wi = argv.indexOf('--worker');
if (wi >= 0) await worker(argv[wi + 1]); else await orchestrate();
