/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The single launch choke point (S1). Loaded into every suite child with NODE_OPTIONS=--import=<this file>
 * (chained after the assertion counter); inert unless QAW_SANDBOX=1 and QAW_RUNDIR are set, so a person running
 * `node tools/test-x.mjs` by hand sees no change. What it does for a suite:
 *
 *   - refuses a live-credential script (exit 64 unless QAW_ALLOW_LIVE=1) and any read under ~/.config/qa-wrap (S6/S7)
 *   - patches chromium.launch / launchPersistentContext on the shared Playwright object:
 *       appends the egress flags (dead-port proxy, S2) and the --qaw-run=<id> marker (teardown by pid, S11),
 *       forces a unique profile under the run dir and downloadsPath there (S8/S9), seeds excluded_schemes (S3 belt),
 *       applies QAW_FORCE_HEADLESS (R4) and the engine (QAW_ENGINE / QAW_CFT_PATH)
 *   - attaches the observer to every context: requests, failures, responses, protocol handoffs -> <run>/observer/<suite>.jsonl
 *   - sweep mode (QAW_SWEEP=1): the replace-not-tap init script for pages and extension workers (S4)
 *
 * Recipes: rehearsals R1 (preload), R2 (flags), R4 (force headless), R10 (env).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { EGRESS_FLAGS, EXCLUDED_SCHEMES, EXT_DIR, classifyUrl, isCredentialPath, refusedLiveScript, safeUrl, sweepGuardSource } from './lib-sandbox.mjs';
import { engineOptions, forceHeadless } from './lib-launch.mjs';
import { scrub } from './lib-scrub.mjs';

const E = process.env;
const isCheckRun = process.execArgv.some((a) => a === '--check' || a === '-c') || !process.argv[1];

if (E.QAW_SANDBOX === '1' && E.QAW_RUNDIR && !isCheckRun) install();

function install() {
  const RUN = E.QAW_RUNDIR;
  const suite = E.QAW_SUITE || path.basename(process.argv[1] || 'unknown');
  const safeSuite = suite.replace(/[^A-Za-z0-9._-]/g, '_');
  const obsDir = path.join(RUN, 'observer');
  fs.mkdirSync(obsDir, { recursive: true });
  const LOG = path.join(obsDir, `${safeSuite}.jsonl`);
  const log = (o) => { try { fs.appendFileSync(LOG, scrub(JSON.stringify({ suite, t: Date.now(), ...o })) + '\n'); } catch { /* the log is best effort; the proxy is the guard */ } };
  log({ kind: 'preload', pid: process.pid, node: process.version });

  // S6: live-credential scripts are refused before they run.
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  const why = refusedLiveScript(entry, { allowLive: E.QAW_ALLOW_LIVE === '1' });
  if (why) {
    log({ kind: 'refused', why });
    process.stderr.write(`QAW sandbox: REFUSED ${path.basename(entry)}: ${why}. Run it by hand, outside the pipeline, or pass --allow-live from a TTY.\n`);
    process.exit(64);
  }

  // S7: nothing under ~/.config/qa-wrap may be read by a suite (the redirected home already hides it; this is the belt).
  guardCredentialReads(log);

  let playwright;
  try { playwright = createRequire(path.join(EXT_DIR, 'package.json'))('playwright'); } catch (e) { log({ kind: 'no-playwright', err: String(e.message).slice(0, 120) }); return; }
  const { chromium } = playwright;
  let seq = 0, ids = 0;
  const idOf = new WeakMap();
  const rid = (r) => { let v = idOf.get(r); if (!v) { v = ++ids; idOf.set(r, v); } return v; };
  const sweep = E.QAW_SWEEP === '1';
  const guardSrc = sweep ? sweepGuardSource() : null;

  function mergeOptions(opts = {}, persistentDirRequested) {
    const eng = engineOptions();
    const out = { ...opts };
    const { label: _l, engine: _e, ...engineFields } = eng;
    if (engineFields.executablePath) { out.executablePath = engineFields.executablePath; delete out.channel; }
    else if (!out.executablePath && out.channel === undefined) out.channel = engineFields.channel;
    if (forceHeadless()) { out.headless = true; if (!out.executablePath) out.channel = 'chromium'; }
    const runId = E.QAW_RUNID || path.basename(RUN);
    out.args = [...(opts.args || []), ...EGRESS_FLAGS, `--qaw-run=${runId}`];
    out.downloadsPath = E.QAW_DOWNLOADS || path.join(RUN, 'downloads', safeSuite);
    fs.mkdirSync(out.downloadsPath, { recursive: true });
    delete out.proxy; // a suite proxy would replace the dead port
    log({ kind: 'launch', persistent: !!persistentDirRequested, headless: !!out.headless, engine: eng.label, argsAdded: EGRESS_FLAGS.length + 1 });
    return out;
  }

  function seedPreferences(dir) {
    const f = path.join(dir, 'Default', 'Preferences');
    if (fs.existsSync(f)) return;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ protocol_handler: { excluded_schemes: Object.fromEntries(EXCLUDED_SCHEMES.map((s) => [s, true])) } }));
  }

  async function recordPid(ctx) {
    try {
      const cdp = await ctx.browser().newBrowserCDPSession();
      const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
      const pid = processInfo.find((p) => p.type === 'browser')?.id;
      if (pid) fs.appendFileSync(path.join(RUN, 'pids.jsonl'), JSON.stringify({ suite, pid, t: Date.now() }) + '\n');
      await cdp.detach().catch(() => {});
    } catch { /* browser already gone */ }
  }

  function observe(ctx, tag) {
    const rec = (kind, r, extra = {}) => {
      const url = r.url();
      const cls = classifyUrl(url);
      if (cls === 'loopback' || cls === 'inert') return;
      log({ kind, tag, id: rid(r), cls, url: safeUrl(url), sw: kind === 'request' ? !!r.serviceWorker?.() : undefined, ...extra });
    };
    ctx.on('request', (r) => rec('request', r));
    ctx.on('requestfailed', (r) => rec('failed', r, { err: r.failure()?.errorText }));
    ctx.on('requestfinished', (r) => rec('finished', r));
    ctx.on('response', async (resp) => {
      try {
        const cls = classifyUrl(resp.url());
        if (cls !== 'external') return;
        const a = await resp.serverAddr();
        log({ kind: 'response', tag, id: rid(resp.request()), cls, url: safeUrl(resp.url()), ip: a?.ipAddress || null });
      } catch { /* page closed */ }
    });
    // S3: a navigation toward a scheme the browser would hand to the OS is logged as HANDOFF-BLOCKED (and the Preferences seed refuses it).
    const watchPage = (page) => {
      page.on('framenavigated', (f) => { const u = f.url(); if (classifyUrl(u) === 'handoff') log({ kind: 'handoff', url: safeUrl(u), scheme: schemeOf(u) }); });
      page.on('console', (m) => {
        const t = m.text();
        if (t.startsWith('QAW-SWEEP ')) { try { log({ kind: 'sweep', ...JSON.parse(t.slice(10)) }); } catch { /* malformed */ } }
      });
      page.context().newCDPSession(page).then((cdp) => {
        cdp.send('Page.enable').catch(() => {});
        cdp.on('Page.frameRequestedNavigation', (ev) => { if (classifyUrl(ev.url) === 'handoff') log({ kind: 'handoff', url: safeUrl(ev.url), scheme: schemeOf(ev.url), via: 'cdp' }); });
      }).catch(() => {});
    };
    ctx.pages().forEach(watchPage);
    ctx.on('page', watchPage);
    ctx.on('requestfailed', (r) => { const u = r.url(); if (classifyUrl(u) === 'handoff') log({ kind: 'handoff', url: safeUrl(u), scheme: schemeOf(u), via: 'requestfailed', err: r.failure()?.errorText }); });
    if (guardSrc) {
      ctx.addInitScript({ content: guardSrc }).catch(() => {});
      const patchWorker = (w) => { w.evaluate(guardSrc).catch(() => {}); w.on?.('console', (m) => { const t = m.text(); if (t.startsWith('QAW-SWEEP ')) { try { log({ kind: 'sweep', where: 'worker', ...JSON.parse(t.slice(10)) }); } catch { /* malformed */ } } }); };
      ctx.serviceWorkers().forEach(patchWorker);
      ctx.on('serviceworker', patchWorker);
    }
  }

  const lpc = chromium.launchPersistentContext.bind(chromium);
  chromium.launchPersistentContext = async (userDataDir, opts = {}) => {
    const dir = path.join(E.QAW_PROFILES || path.join(RUN, 'profiles', safeSuite), `p${++seq}`);
    fs.mkdirSync(dir, { recursive: true });
    seedPreferences(dir);
    process.env.QAW_LAST_PROFILE = dir; // the profile the browser really uses, for a suite that scans its own disk
    log({ kind: 'profile', requested: path.basename(String(userDataDir || '')), forced: path.relative(RUN, dir) });
    const ctx = await lpc(dir, mergeOptions(opts, true));
    observe(ctx, 'persistent');
    recordPid(ctx);
    return ctx;
  };
  const lch = chromium.launch.bind(chromium);
  chromium.launch = async (opts = {}) => {
    const b = await lch(mergeOptions(opts, false));
    const nc = b.newContext.bind(b);
    b.newContext = async (...a) => { const c = await nc(...a); observe(c, 'launch'); return c; };
    return b;
  };
}

const schemeOf = (u) => { try { return new URL(u).protocol; } catch { return String(u).split(':')[0] + ':'; } };

function guardCredentialReads(log) {
  const deny = (p) => { log({ kind: 'cred-read-refused' }); const e = new Error('QAW sandbox: reading ~/.config/qa-wrap is refused for suites'); e.code = 'EACCES'; throw e; };
  const wrap = (obj, name, pathArg = 0) => {
    const orig = obj[name]; if (typeof orig !== 'function') return;
    obj[name] = function (...a) { if (typeof a[pathArg] === 'string' && isCredentialPath(a[pathArg])) deny(a[pathArg]); return orig.apply(this, a); };
  };
  for (const n of ['readFileSync', 'openSync', 'createReadStream', 'readFile']) wrap(fs, n);
  wrap(fs.promises, 'readFile');
  syncBuiltinESMExports();
}
