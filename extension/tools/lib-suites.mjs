/**
 * lib-suites.mjs — the per-suite machinery of run-suites.mjs, extracted without a change of behaviour (P1, test pipeline 1012).
 * run-suites.mjs (the delivery gate, D-1010-67) and pipeline.mjs both import it. QUARANTINE, KNOWN_RED and LOCKED_SUITES stay
 * authoritative here; every function below is the one that used to sit in run-suites.mjs, byte for byte except for `export`.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..'); // extension/tools -> repo root
export const DEFAULT_EXT = path.resolve(__dirname, '..'); // the extension/ folder this file sits in

// The three suites that share one fixed, persistent browser profile each
// (lib-paths.mjs `profile(...)`), so two lanes must not run one at once.
export const LOCKED_SUITES = new Set(['test-exporters', 'test-frames', 'test-gif']);

// Quarantined suites: still run and still printed, never counted red, until `until` (YYYY-MM-DD).
// byHand: opens a headed browser on the desktop, so it runs only with --by-hand (never in a plain or --ci run).
// An expired entry is red. Every tools/test-*.mjs must be in the package.json chain or here, or the run fails
// (T-004). Chain order is not tested: no ordering dependency is known [U]; suites share only the locked profiles above.
export const QUARANTINE = {
  'test-jira-live': { byHand: true, until: '2026-12-31', reason: 'headed Chrome against a local mock Jira: run by hand' },
  'test-report-filing-live': { byHand: true, until: '2026-12-31', reason: 'headed Chrome against a local mock Jira: run by hand' },
  'test-truth': { byHand: true, until: '2026-12-31', reason: 'real headless Chromium on the zip contents; 21 scenarios on the zip contents (boot, upgrades, erase-all, wrappers, locator truth, handler oracle, keymap, top layer, worker restart); nightly and per release candidate: npm run test:truth. NOT covered yet: two-window ingest, 6,000 px capture, sleeping-tab replay chunk, worker kill, top layer, keymap, consent repaint' },
  'test-game-trial-live': { byHand: true, until: '2026-12-31', reason: 'Bug Hunt hard trials calibration run: headed, owner presses Allow and Alt+Shift+Q once; run by hand with --by-hand' },
  perf: { byHand: true, until: '2026-12-31', reason: 'D-1010-158: headed Chrome with CPU throttling, desktop and x6 budgets, English and Arabic popup rows: run by hand with npm run perf' },
  'test-boot-smoke': { byHand: true, until: '2026-12-31', reason: 'real headed Chrome loading the extension: run by hand with npm run smoke:boot' },
  'test-draft-door-live': { byHand: true, until: '2026-12-31', reason: 'T-075: real headed Chrome, worker handlers and the offscreen draft door: run by hand with the boot smoke' },
  'test-capture-live': { byHand: true, until: '2026-12-31', reason: 'D-1010-114: headed Chrome on the secondary monitor, capture bridge and fixtures end to end: run by hand with the boot smoke' },
  'test-dock-live': { byHand: true, until: '2026-12-31', reason: 'sidepanel-1010: headed Chromium, the float Dock button opens the side panel with and without a testable page: run by hand' },
  'test-onboarding-live': { byHand: true, until: '2026-12-31', reason: 'features-1010 lane O: headed walk from the welcome page to the first copied report on the packaged practice page, with the click count: run by hand' },
  'test-first-run-live': { byHand: true, until: '2026-12-31', reason: 'D-1010-117: headed first-run frame (a throttled-window first frame is only provable in a visible window): run by hand' },
  'test-integrations-live': { byHand: true, until: '2026-12-31', reason: 'D-1010-114: headed Chrome against local mock integrations: run by hand' },
  'test-integrations-perm': { byHand: true, until: '2026-12-31', reason: 'integ-1020 FX-4: headed Chrome, site access withheld except loopback: run by hand' },
  'test-secrets-page': { byHand: true, until: '2026-12-31', reason: 'D-1010-114: headed Chrome on the secrets page: run by hand' },
  'test-vault-live': { byHand: true, until: '2026-12-31', reason: 'D-1010-114: headed Chrome, real vault storage: run by hand' },
  'test-worker-restart': { byHand: true, until: '2026-12-31', reason: 'D-1010-114: headed Chrome, real service-worker restart: run by hand' },
  'test-origin-gate-live': { byHand: true, until: '2026-12-31', reason: 'D-1010-170: headed Chrome, one 127.0.0.1 grant, a localhost frame must not reach the security-headers snapshot: run by hand' },
  'test-next-primary': { byHand: true, until: '2026-12-31', reason: 'DESIGN-1011 lane POP: headed Chrome on the secondary monitor, the real popup; run by hand' },
  'test-reach-popup': { byHand: true, until: '2026-12-31', reason: 'DESIGN-1011 lane POP: headed Chrome on the secondary monitor, the real popup; run by hand' },
  'test-stable-layout': { byHand: true, until: '2026-12-31', reason: 'DESIGN-1011 lane POP: headed Chrome on the secondary monitor, the real popup; run by hand' },
  'test-done-card': { byHand: true, until: '2026-12-31', reason: 'DESIGN-1011 lane POP: headed Chrome on the secondary monitor, the real popup; run by hand' },
  'test-popup-outcomes': { byHand: true, until: '2026-12-31', reason: 'ui-1016 H2: headed Chrome, the real popup (camera, tool outcomes, float size); run by hand' },
  'test-dock-panel': { byHand: true, until: '2026-12-31', reason: '1014 B1: headed Chrome, the float Dock button and the toolbar side-panel behaviour; run by hand' },
  'test-toolbar-panel': { byHand: true, until: '2026-12-31', reason: '1014 B1: branded Chrome, a real toolbar press (UIA/MSAA) in side-panel and float mode; run by hand' },
  'test-top-space': { byHand: true, until: '2026-12-31', reason: '1014 B1: headed Chrome, the rendered session region of the float and the side panel; run by hand' },
  'test-scale-parity': { byHand: true, until: '2026-12-31', reason: '1014 B2: headed Chrome, the real popup before/after a size-token change (computed boxes and spacing); run by hand' },
  'test-action-icon-art': { byHand: true, until: '2026-12-31', reason: '1014 B1: headed Chrome, the recording icon frames against the manifest PNGs; run by hand' },
  'test-copy-length': { byHand: true, until: '2026-12-31', reason: 'DESIGN-1011 lane POP: headed Chrome on the secondary monitor, the real popup; run by hand' },
  'test-e2e-practice': { byHand: true, until: '2026-12-31', reason: 'sdlc-1014b: the built extension in a real browser (Chrome, Opera GX when installed), the practice walk in EN and AR; headed on the secondary monitor, headless in regression' },
  'test-autopilot-live': { byHand: true, until: '2026-12-31', reason: 'review D6: headed Chrome on the secondary monitor, the real worker and content script start a session by itself and show the dot; run by hand' },
  'test-tile-wake-live': { byHand: true, until: '2026-12-31', reason: '1011 B1: headed Chrome on the secondary monitor, a tool tile pressed asleep wakes the site and opens the tool: run by hand' },
  'test-sound-volume-live': { byHand: true, until: '2026-12-31', reason: '1011 B4: headed Chrome on the secondary monitor, the Settings volume slider moves, repaints and saves: run by hand' },
  'test-buttons-all': { byHand: true, until: '2026-12-31', reason: 'DESIGN-1011 test stage: headed Chrome, presses every button; run by hand' },
  'test-plan-run': { byHand: true, until: '2026-12-31', reason: 'launches a browser and runs a generated plan: run by hand with npm run plan-run' },
  'test-sandbox-egress': { byHand: true, until: '2026-12-31', reason: 'council-1012 P3: six browsers, one headed on the secondary monitor, proves the sandbox egress and handoff blocks (about 75 s): run by hand' },
  'test-notes-tab': { byHand: true, until: '2026-12-31', reason: 'ui-1020: headed Chrome, the real report page with a fixture session (Notes tab, filter, copy, save, Arabic RTL): run by hand' },
  'test-game-live': { byHand: true, until: '2026-12-31', reason: 'Bug Hunt lane E: headed play-through on the secondary monitor with the owner Allow press (prints per-level seconds): run by hand with --by-hand' },
};
// Known red (council-1009 12-1): a suite that is red on purpose until `until`. It still runs and its red is still printed;
// an unlisted red, a listed suite that turned green, or an expired entry each make the run exit 1. Nothing is hidden or skipped.
// `match` (r2-12-1): the entry covers only the failure it names. Red with any other output, or a timeout, is a plain FAIL.
// 2026-10-22: the CI-green baseline reds live in tools/known-red.json (id, until, match regex, reason); each names its failure.
export const KNOWN_RED = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, 'known-red.json'), 'utf8'))).map(([k, v]) => [k, { ...v, match: new RegExp(v.match) }]));
if (process.env.QAW_KNOWN_RED_FIXTURE && process.argv.includes('--ext')) {
  for (const [k, v] of Object.entries(JSON.parse(process.env.QAW_KNOWN_RED_FIXTURE))) KNOWN_RED[k] = { ...v, match: v.match ? new RegExp(v.match) : undefined };
}
export const today = () => process.env.QAW_TODAY || new Date().toISOString().slice(0, 10); // QAW_TODAY: test hook for the expiry fixtures
export const expired = (suite) => QUARANTINE[suite] && QUARANTINE[suite].until < today();

/** Every tools/test-*.mjs (and test.mjs) must be gated or quarantined; returns the problems. */
export function coverageProblems(extDir, chain) {
  const files = fs.readdirSync(path.join(extDir, 'tools')).filter((f) => /^test(-[\w-]+)?\.mjs$/.test(f)).map((f) => f.slice(0, -4));
  const problems = files.filter((f) => !chain.includes(f) && !QUARANTINE[f]).map((f) => `tools/${f}.mjs is in neither package.json scripts.test nor QUARANTINE`);
  // D-1010-114: derived from the file, so the next headed suite cannot slip into a plain run. A suite that imports
  // lib-launch / lib-test-window opens a visible Chrome: it needs a byHand entry or a LOCKED_SUITES entry.
  for (const f of files) {
    let src = '';
    try { src = fs.readFileSync(path.join(extDir, 'tools', f + '.mjs'), 'utf8'); } catch { continue; }
    if (/from\s+['"]\.\/(?:lib-launch|lib-test-window)\.mjs['"]/.test(src) && !QUARANTINE[f]?.byHand && !LOCKED_SUITES.has(f)) problems.push(`tools/${f}.mjs launches a headed Chrome (imports lib-launch) but has no byHand entry in QUARANTINE and is not in LOCKED_SUITES (D-1010-114)`);
  }
  // r10-12-2 (D-247): a visible Chrome through a raw launch flag (no lib-launch import) would slip into a plain run as well.
  for (const f of files) {
    if (QUARANTINE[f]?.byHand || LOCKED_SUITES.has(f)) continue;
    let src = '';
    try { src = fs.readFileSync(path.join(extDir, 'tools', f + '.mjs'), 'utf8'); } catch { continue; }
    if (/headless:\s*false|--headed\b/.test(src)) problems.push(`tools/${f}.mjs sets headless: false or --headed but has no byHand entry in QUARANTINE and is not in LOCKED_SUITES (r10-12-2)`);
  }
  for (const q of Object.keys(QUARANTINE)) if (expired(q)) problems.push(`${q} quarantine expired ${QUARANTINE[q].until}: fix it or renew with a reason`);
  for (const k of Object.keys(KNOWN_RED)) if (KNOWN_RED[k].until < today()) problems.push(`${k} known-red entry (${KNOWN_RED[k].id}) expired ${KNOWN_RED[k].until}: fix the suite or renew with a reason`);
  return problems;
}

// A suite that launches a browser (playwright import) cannot run on a bare CI runner.
export function isBrowserSuite(extDir, suite) {
  try { return /from ['"](?:[@]playwright[/]test|playwright)['"]/.test(fs.readFileSync(path.join(extDir, 'tools', suite + '.mjs'), 'utf8')); } catch { return false; }
}

export const DEFAULT_SUITE_TIMEOUT_S = 300;
export const LOCK_STEP_MS = 5000;
export const LOCK_CEILING_MS = 20 * 60 * 1000;
export const LOCK_STALE_MS = 60 * 60 * 1000;

/** The suite ids in `package.json` `scripts.test`, in chain order. */
export function loadSuiteList(extDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf8'));
  const chain = [pkg.scripts['test:chain'] || pkg.scripts.test, pkg.scripts['test:extra'] || '']
    .join(' && ').split(/&&|;/).map((s) => s.trim()).filter(Boolean);
  return chain.map((cmd) => {
    const m = cmd.match(/tools\/(test(?:-[\w-]+)?)\.mjs$/);
    if (!m) throw new Error(`could not parse a suite id from: ${cmd}`);
    return m[1];
  });
}

/** Chain plus the by-hand quarantined suites, after the coverage gate; exits 1 on a problem. */
export function suitesToRun(extDir, byHand = false) {
  const chain = loadSuiteList(extDir);
  const problems = coverageProblems(extDir, chain);
  const out = [...chain.filter((s) => byHand || !QUARANTINE[s]?.byHand), ...Object.keys(QUARANTINE).filter((q) => !chain.includes(q) && (byHand || !QUARANTINE[q].byHand) && fs.existsSync(path.join(extDir, 'tools', q + '.mjs')))];
  // The run is every tools/test*.mjs minus the by-hand ones: say so with numbers, and go red when they disagree.
  const files = fs.readdirSync(path.join(extDir, 'tools')).filter((f) => /^test(-[\w-]+)?\.mjs$/.test(f)).map((f) => f.slice(0, -4));
  const skipped = byHand ? [] : files.filter((f) => QUARANTINE[f]?.byHand);
  // perf is a by-hand QUARANTINE entry that is not a tools/test-*.mjs file, so under --by-hand it is not part of this count.
  const listed = out.filter((q) => files.includes(q)).length;
  if (listed !== files.length - skipped.length) problems.push(`the run lists ${listed} suites but tools/ holds ${files.length} test files minus ${skipped.length} by-hand`);
  for (const p of problems) console.error(`COVERAGE FAIL: ${p}`);
  if (problems.length) process.exit(1);
  if (skipped.length) console.log(`by hand (headed browser, add --by-hand): ${skipped.join(', ')}`);
  return out;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Script waits for a lock file, never a model polling. */
export async function acquireLock(suite) {
  const lockPath = path.join(os.tmpdir(), `qaw-suite-${suite}.lock`);
  const start = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return lockPath;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let ageMs = 0;
      try { ageMs = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { continue; }
      if (ageMs > LOCK_STALE_MS) {
        try { fs.unlinkSync(lockPath); } catch { /* raced another taker */ }
        continue;
      }
      if (Date.now() - start > LOCK_CEILING_MS) {
        console.error(`busy: ${suite} (${lockPath})`);
        process.exit(1);
      }
      await sleep(LOCK_STEP_MS);
    }
  }
}

export function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
}

export function runSuite(suite, extDir, timeoutS = DEFAULT_SUITE_TIMEOUT_S) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [`tools/${suite}.mjs`], { cwd: extDir, env: process.env });
    let output = '';
    let timedOut = false;
    // 12-4: a hung suite is killed and named, not waited on forever. SIGKILL: a hung child may ignore SIGTERM.
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch { /* already gone */ } }, timeoutS * 1000);
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (err) => { output += `spawn error: ${err.message}\n`; });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) output += `\nFAIL ${suite} timed out after ${timeoutS}s (--suite-timeout)\n`;
      resolve({ exitCode: timedOut ? 124 : exitCode, output, durationMs: Date.now() - start, timedOut });
    });
  });
}

/**
 * Windows/POSIX absolute paths, durations and the "N clean file(s)" tally
 * (test-copy.mjs, test-plurals.mjs — the count of every clean file walked,
 * not of the violation) collapsed, so a diff is real, not incidental.
 *
 * The three measured numbers this runner already checks itself — boot-graph
 * KB (test-worker-imports), tsc error count (test-types), dead-key count
 * (test-i18n) — are collapsed here too, in their exact wording only. Those
 * numbers move run to run and have their own ceiling/allowance check below
 * (`numberRegressions`); left un-normalized, a same-cause FAIL block reads as
 * a "new" line on every tiny wobble even when it is within the allowed
 * range. The ceiling side of each phrase (a constant, not a measurement) is
 * left exact, so a changed ceiling still shows as a real diff.
 */
export function normalize(line) {
  return line
    .replace(/[A-Za-z]:\\[^\s"'<>|]+/g, '<path>')
    .replace(/(?<![\w.])\/(?:[^\s"'<>|]+\/)+[^\s"'<>|]*/g, '<path>')
    .replace(/\b\d+(?:\.\d+)?\s?ms\b/g, '<ms>')
    .replace(/\b\d+(?= clean files?\b)/g, '<n>')
    .replace(/\b\d+(?:\.\d+)?(?=\s*KB,\s*ceiling is\s*\d+\s*KB\.)/g, '<num>')
    .replace(/\b\d+(?=\s*errors,\s*ceiling is\s*\d+\.)/g, '<num>')
    .replace(/\b\d+(?=\s*key\(s\) nothing asks for:)/g, '<num>')
    // The list itself (S1 CHALLENGE, run-suites.mjs): which keys are dead
    // shuffles shape run to run within the same allowed count — the number
    // check above (`numberRegressions`, off the un-normalized output) is
    // what actually gates a real new dead key; this text-diff must not
    // re-flag the same allowance as a "new" FAIL line on every wobble.
    .replace(/(?<=key\(s\) nothing asks for:).*$/, ' <keys>')
    .trimEnd();
}

/**
 * `normalize()` above is per-line; this multi-line piece can't be, because
 * test-i18n.mjs's always-printed key/prefix tally does not just change its
 * numbers when keys are added or removed (the same allowed event as the
 * dead-key list above) — it can change its ROW COUNT too, e.g. a prefix
 * appearing or disappearing (`overlay`, 21 Sept). No per-line number-mask
 * can equalize a 10-row block against an 11-row one, so the whole tally is
 * collapsed to one token here, after normalize() has run on every line.
 * Applied identically to a fresh block and a re-normalized baseline one
 * (both call sites below), or the two would never compare equal.
 */
export function normalizeBlock(text) {
  return text.replace(
    /\n\s*\d+ key\(s\), Arabic and English, across \d+ prefixes:(?:\n\s*\d+\s+\S+)+\n/,
    '\n  <key-tally>\n',
  );
}

/**
 * Each FAIL/not-ok/✗ line plus the assertion message and diff lines that
 * follow it, up to the next test verdict (an `ok`/`FAIL`/`not ok` line) or
 * end of output. A verdict line is one that *starts* with the word (after
 * indentation); a diff line (Node's assert output, tsc errors, …) does not,
 * even when it is flush-left or contains a blank line in the middle of it.
 */
export function extractFailDetail(output) {
  const lines = output.split(/\r?\n/);
  const marker = /FAIL|not ok|✗/;
  const verdictStart = /^\s*(ok\b|FAIL\b|not ok\b|✗)/;
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!marker.test(lines[i])) continue;
    const block = [lines[i]];
    let j = i + 1;
    while (j < lines.length && !verdictStart.test(lines[j])) {
      block.push(lines[j]);
      j++;
    }
    blocks.push(normalizeBlock(block.map(normalize).join('\n')));
    i = j - 1;
  }
  return blocks;
}

/** The three tracked numbers, only for the suite that prints each. */
export function extractNumbers(suite, output) {
  if (suite === 'test-worker-imports') {
    const m = output.match(/\(\d+ direct,\s*\d+ transitive,\s*([\d.]+)\s*KB\)/);
    if (m) return { bootGraphKB: parseFloat(m[1]) };
  } else if (suite === 'test-types') {
    const m = output.match(/\((\d+)\s*tsc errors total/);
    if (m) return { tscErrors: parseInt(m[1], 10) };
  } else if (suite === 'test-types-wide') {
    const m = output.match(/wide tsc errors by directory: ([^)]+)\)/);
    if (m) return { tscWide: Object.fromEntries(m[1].trim().split(/\s+/).map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)])) };
  } else if (suite === 'test-i18n') {
    const m = output.match(/(\d+)\s*key\(s\) nothing asks for/);
    if (m) return { deadKeys: parseInt(m[1], 10) };
  }
  return {};
}

export async function runAll(suites, extDir, { logDir, timeoutS, byHand = false } = {}) {
  const results = [];
  const numbers = {};
  for (let i = 0; i < suites.length; i++) {
    const suite = suites[i];
    const locked = LOCKED_SUITES.has(suite);
    const lockPath = locked ? await acquireLock(suite) : null;
    let r;
    try {
      r = await runSuite(suite, extDir, timeoutS);
    } finally {
      if (lockPath) releaseLock(lockPath);
    }
    // r2-12-2: a suite that hung is never excused by either list, whatever its exit code says.
    // D-1010-166: --by-hand is the run that exists to prove the by-hand suites, so a byHand suite that exits non-zero there is a FAIL.
    const quarantined = !r.timedOut && r.exitCode !== 0 && Boolean(QUARANTINE[suite]) && !expired(suite) && !(byHand && QUARANTINE[suite].byHand);
    const knownRed = !r.timedOut && r.exitCode !== 0 && Boolean(KNOWN_RED[suite]) && !quarantined
      && (!KNOWN_RED[suite].match || KNOWN_RED[suite].match.test(r.output));
    // D-1010-63: the SKIPPED count a suite prints, shown beside PASS; in the release gate (--by-hand) a skipped toolbar press is a FAIL.
    const skippedN = Number([...r.output.matchAll(/(\d+) SKIPPED/g)].pop()?.[1] || 0);
    const skippedPress = byHand && suite === 'test-boot-smoke' && skippedN > 0;
    const pass = (r.exitCode === 0 || quarantined || knownRed) && !skippedPress;
    const failDetail = skippedPress ? [`SKIPPED toolbar press (${skippedN}): the release gate needs the press proven`] : extractFailDetail(r.output);
    Object.assign(numbers, extractNumbers(suite, r.output));
    if (logDir) fs.writeFileSync(path.join(logDir, `${suite}.log`), r.output);
    console.log(`[${i + 1}/${suites.length}] ${suite} ... ${quarantined ? 'QUARANTINED' : knownRed ? 'KNOWN-RED' : pass ? 'PASS' : 'FAIL'}${skippedN ? `, ${skippedN} SKIPPED` : ''} (exit ${r.exitCode}, ${r.durationMs}ms${r.timedOut ? `, ${suite} timed out after ${timeoutS ?? DEFAULT_SUITE_TIMEOUT_S}s` : ''})`);
    if (!pass) { const all = r.output.trimEnd().split(/\r?\n/); // CI keeps no logs: every FAIL/x line (it can sit above the tail), then the last 20
      console.log([...all.slice(0, -20).filter((l) => /^\s*(?:FAIL|✗)/.test(l)), ...all.slice(-20)].map((l) => `    | ${l}`).join('\n')); }
    results.push({ suite, exitCode: r.exitCode, pass, quarantined, knownRed, timedOut: r.timedOut || undefined, reason: quarantined ? QUARANTINE[suite].reason : knownRed ? `${KNOWN_RED[suite].id}: ${KNOWN_RED[suite].reason}` : undefined, failDetail: quarantined ? [] : failDetail });
  }
  return { results, numbers };
}

/** The total, every run: all FAIL suites, the known-red and the quarantined ones with their reasons, not only new ones. */
export function printTally(results) {
  const fail = results.filter((r) => !r.pass).map((r) => r.suite);
  const quar = results.filter((r) => r.quarantined);
  const known = results.filter((r) => r.knownRed);
  console.log(`TOTAL: ${results.length} suites, ${fail.length} FAIL, ${known.length} known red, ${quar.length} quarantined, ${results.length - fail.length - quar.length - known.length} PASS`);
  if (fail.length) console.log(`TOTAL FAIL: ${fail.join(', ')}`);
  for (const k of known) console.log(`known red (red on purpose, until ${KNOWN_RED[k.suite].until}): ${k.suite} - ${k.reason}`);
  for (const q of quar) console.log(`quarantined: ${q.suite} - ${q.reason}`);
}

/** 12-1: a listed known-red suite that exited 0 is a stale allowance - red, so the entry is removed the day the suite is fixed. */
export function staleKnownRed(results) {
  const stale = results.filter((r) => r.exitCode === 0 && KNOWN_RED[r.suite] && !KNOWN_RED[r.suite].ciOnly).map((r) => r.suite);
  for (const s of stale) console.log(`STALE KNOWN-RED: ${s} (${KNOWN_RED[s].id}) is green now: remove it from KNOWN_RED in tools/run-suites.mjs`);
  return stale.length;
}

/** 12-3: --node-only drops browser suites; name them and keep the list for the record. */
export function nodeOnlyFilter(suites, extDir, args) {
  const skipped = [];
  const kept = suites.filter((s) => {
    const why = LOCKED_SUITES.has(s) ? 'locked profile' : isBrowserSuite(extDir, s) ? 'browser' : (QUARANTINE[s] && args.ci) ? 'quarantined' : null;
    if (why) skipped.push(s);
    return !why;
  });
  console.log(`skipped (--node-only): ${skipped.length}${skipped.length ? ': ' + skipped.join(', ') : ''}`);
  return { kept, skipped };
}
