/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * lib-verdict.mjs — result states and honesty (P1, test pipeline 1012, spec 2.7 and 2.9).
 *
 *   classify(...)      one suite result  -> PASS | FAIL | ENV-BLOCKED | SKIPPED | SKIPPED-NOT-ENFORCED | QUARANTINED
 *   countAssertions()  `ok` lines, else the "N passed" summary, else null (R8)
 *   tierVerdict(...)   the rows of a run -> PASS | FAIL | INCOMPLETE and the exit code (0 / 1 / 2)
 *   compareGate(...)   GATE LOOSENED: ceilings raised, hashes changed, assertions lost (spec 2.9 / 3)
 *   ledgerSummary()    HUMAN CHECKS OPEN and NOT COVERED ON BRANDED CHROME from tools/human-checks.json
 *   budgetCheck()      per-tier time budget, provisional for the first three recorded runs, then enforced
 *
 * Pure functions: no process is spawned and no file is written here. FLAKY is set by the scheduler after its one probe.
 */

export const EXIT = { PASS: 0, FAIL: 1, INCOMPLETE: 2, REFUSED: 3, USAGE: 64 };
export const SKIP_LINE = /^\s*(SKIPPED|not run|deferred)/im; // R8: anchored, 2 true hits and 0 false hits on the tree
const NOT_ENFORCED = /NOT (?:IMPLEMENTED|ENFORCED)/i;

/** Observed assertions: `ok` lines, else the `N passed` summary, else null (an exit-code-only suite). */
export function countAssertions(output) {
  const text = String(output || '');
  const okLines = (text.match(/^\s*ok\s/gm) || []).length;
  if (okLines > 0) return { n: okLines, source: 'ok-lines' };
  const summary = [...text.matchAll(/(\d+)\s+passed\b/g)].pop();
  if (summary) return { n: Number(summary[1]), source: 'summary' };
  return { n: null, source: null };
}

/** `SKIPPED:` / `ENV-BLOCKED:` protocol line (suite exit 2), searched at the start of a line. */
export function protocolMarker(output) {
  const lines = String(output || '').split(/\r?\n/);
  const first = lines.find((l) => l.trim());
  const m1 = first && first.match(/^\s*(SKIPPED|ENV-BLOCKED):\s*(.*)$/);
  if (m1) return { kind: m1[1], reason: m1[2].trim() };
  for (const l of lines) {
    const m = l.match(/^\s*(ENV-BLOCKED|SKIPPED):\s*(.*)$/);
    if (m) return { kind: m[1], reason: m[2].trim() };
  }
  return null;
}

/** First lines of failing output, normalised to single lines, for the one-line "why" in the summary. */
export function firstFailure(output) {
  const lines = String(output || '').split(/\r?\n/);
  const hit = lines.find((l) => /(^|\s)(FAIL|not ok|✗|AssertionError|Error:|SyntaxError|TypeError)/.test(l)) || lines.find((l) => l.trim()) || '';
  return hit.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/**
 * One suite result. `row` is a normalised manifest row (lib-sched.normalizeRow), `result` the finished child.
 * `quarantine` / `knownRed` are the entries of lib-suites (or undefined), `today` is YYYY-MM-DD.
 * A byHand quarantine entry never excuses a red here: the pipeline run is the by-hand run (D-1010-166).
 */
export function classify({ row, result, quarantine, knownRed, today = new Date().toISOString().slice(0, 10), softPythonOk = false }) {
  const output = String(result.output || '');
  const out = { status: 'FAIL', reason: '', assertions: null, assertionSource: null, skips: [], degraded: false, notEnforced: false, rule: null };
  const counted = countAssertions(output);
  out.assertions = counted.n;
  out.assertionSource = counted.source;
  const skipLines = output.split(/\r?\n/).filter((l) => SKIP_LINE.test(l)).map((l) => l.trim().slice(0, 200));
  out.skips = skipLines;
  const exit = result.exitCode;

  if (result.timedOut) { out.reason = `timed out after ${result.timeoutS ?? '?'}s`; return out; }
  if (exit !== 0 && exit !== 2) {
    const q = quarantine && !quarantine.byHand && quarantine.until >= today;
    const k = knownRed && knownRed.until >= today && (!knownRed.match || knownRed.match.test(output));
    if (q || k) { out.status = 'QUARANTINED'; out.reason = q ? `quarantined until ${quarantine.until}: ${quarantine.reason}` : `known red until ${knownRed.until}: ${knownRed.reason}`; out.knownRed = Boolean(k && !q); return out; }
    out.reason = firstFailure(output) || `exit ${exit}`;
    return out;
  }
  if (exit === 2) {
    const mark = protocolMarker(output);
    if (!mark) { out.reason = 'exit 2 without a first line SKIPPED: or ENV-BLOCKED: (suite exit protocol, spec 2.7)'; return out; }
    out.reason = mark.reason;
    if (mark.kind === 'ENV-BLOCKED') { out.status = 'ENV-BLOCKED'; return out; }
    out.status = NOT_ENFORCED.test(mark.reason) || NOT_ENFORCED.test(output) ? 'SKIPPED-NOT-ENFORCED' : 'SKIPPED';
    out.notEnforced = out.status === 'SKIPPED-NOT-ENFORCED';
    const rule = (mark.reason + ' ' + output).match(/rule\s+(\d+)/i);
    if (rule) out.rule = Number(rule[1]);
    return out;
  }
  // exit 0
  if (skipLines.length) {
    const soft = row?.deps?.python === 'soft';
    if (soft && !softPythonOk) { out.status = 'PASS'; out.degraded = true; out.reason = `degraded: ${skipLines[0]}`; return out; }
    out.status = NOT_ENFORCED.test(skipLines.join('\n')) ? 'SKIPPED-NOT-ENFORCED' : 'SKIPPED';
    out.notEnforced = out.status === 'SKIPPED-NOT-ENFORCED';
    out.reason = skipLines[0];
    const rule = skipLines.join(' ').match(/rule\s+(\d+)/i);
    if (rule) out.rule = Number(rule[1]);
    return out;
  }
  if ((row?.assertMode || 'exitcode') === 'counted' && !(counted.n > 0)) { out.reason = `vacuous: assertMode counted but 0 assertions observed (${counted.source || 'no ok lines and no "N passed" summary'})`; return out; }
  out.status = 'PASS';
  return out;
}

/* ---- counts --------------------------------------------------------------------------------------------------- */

export function counts(rows) {
  const c = { run: 0, pass: 0, fail: 0, flaky: 0, envBlocked: 0, quarantined: 0, skipped: 0, notEnforced: 0, notRun: 0, degraded: 0 };
  for (const r of rows) {
    if (r.status === 'NOT-RUN') { c.notRun++; continue; }
    c.run++;
    if (r.status === 'PASS') { c.pass++; if (r.degraded) c.degraded++; }
    else if (r.status === 'FAIL') c.fail++;
    else if (r.status === 'FLAKY') c.flaky++;
    else if (r.status === 'ENV-BLOCKED') c.envBlocked++;
    else if (r.status === 'QUARANTINED') c.quarantined++;
    else if (r.status === 'SKIPPED') c.skipped++;
    else if (r.status === 'SKIPPED-NOT-ENFORCED') { c.skipped++; c.notEnforced++; }
  }
  return c;
}

/* ---- tier verdict --------------------------------------------------------------------------------------------- */

/**
 * rows: finished rows (status per spec 2.7, `smoke` true for smoke members). Options:
 *   tier, acceptEnv ['python'], gateLoosened [] (strings), gateAccepted (reason or ''), ledger ({open,notCovered,missing}),
 *   delivery (the tier is full or release), guardProblems [], leaks [], preflightFail (string), budget ({status}), refused (string)
 * Returns { verdict, exit, reasons[] }: FAIL beats INCOMPLETE beats PASS. A green with caveats does not exist.
 */
export function tierVerdict({ rows, tier, acceptEnv = [], gateLoosened = [], gateAccepted = '', ledger = null, delivery = false, guardProblems = [], leaks = [], preflightFail = '', budget = null, subset = false } = {}) {
  const fail = [];
  const inc = [];
  if (preflightFail) fail.push(`preflight: ${preflightFail}`);
  for (const r of rows) {
    if (r.status === 'FAIL') fail.push(`FAIL ${r.id}${r.reason ? `: ${r.reason}` : ''}`);
    else if (r.status === 'FLAKY') fail.push(`FLAKY ${r.id} (red for delivery)`);
    else if (r.status === 'ENV-BLOCKED') {
      const cause = r.envKind || (/python|uv\b/i.test(r.reason || '') ? 'python' : '');
      if (!(cause && acceptEnv.includes(cause))) inc.push(`ENV-BLOCKED ${r.id}${r.reason ? `: ${r.reason}` : ''}`);
    } else if (r.status === 'SKIPPED' || r.status === 'SKIPPED-NOT-ENFORCED') {
      if (r.smoke) fail.push(`SKIPPED smoke member ${r.id} is a FAIL: ${r.reason || ''}`);
      else inc.push(`${r.status} ${r.id}${r.reason ? `: ${r.reason}` : ''}`);
    } else if (r.status === 'NOT-RUN') {
      if (!subset) inc.push(`NOT RUN ${r.id}${r.reason ? ` (${r.reason})` : ''}`);
    } else if (r.status === 'PASS' && r.degraded && !acceptEnv.includes('python')) inc.push(`DEGRADED ${r.id}: ${r.reason}`);
  }
  for (const g of guardProblems) fail.push(`guard: ${g}`);
  for (const l of leaks) fail.push(`leak scan: ${l}`);
  if (budget && budget.status === 'fail') fail.push(`over budget: ${budget.message}`);
  if (gateLoosened.length && !gateAccepted) inc.push(`GATE LOOSENED: ${gateLoosened.join('; ')}`);
  if (delivery) {
    if (!ledger || ledger.missing) fail.push('human-checks ledger missing: a delivery tier cannot print HUMAN CHECKS OPEN');
    else if (ledger.open > 0) inc.push(`HUMAN CHECKS OPEN: ${ledger.open}`);
  }
  const verdict = fail.length ? 'FAIL' : inc.length ? 'INCOMPLETE' : 'PASS';
  return { verdict, exit: EXIT[verdict], reasons: [...fail, ...inc], tier };
}

/* ---- GATE LOOSENED -------------------------------------------------------------------------------------------- */

/**
 * baseline: gate-baseline.json as it is in the working tree; committed: the same file at HEAD (or null);
 * current: { ceilings:{types,typesWide}, hashes:{...}, assertions:{id:n} } measured in this run.
 * Returns the list of loosenings: a ceiling raised against HEAD, a hash that differs from the baseline, a suite with fewer assertions than recorded.
 */
export function compareGate({ baseline, committed = null, current = {} }) {
  const out = [];
  if (!baseline) return ['gate-baseline.json is missing'];
  for (const k of ['types', 'typesWide']) {
    const b = baseline.ceilings?.[k];
    const c = committed?.ceilings?.[k];
    if (Number.isFinite(b) && Number.isFinite(c) && b > c) out.push(`ceiling ${k} raised ${c} -> ${b} against the committed baseline`);
    const cur = current.ceilings?.[k];
    if (Number.isFinite(b) && Number.isFinite(cur) && cur > b) out.push(`ceiling ${k}: ${cur} measured above the baseline ${b}`);
  }
  for (const [k, h] of Object.entries(current.hashes || {})) {
    const b = baseline.hashes?.[k];
    if (b && h && b !== h) out.push(`${k} changed since the baseline (hash ${String(h).slice(0, 8)} vs ${String(b).slice(0, 8)})`);
  }
  for (const [id, n] of Object.entries(current.assertions || {})) {
    const b = baseline.assertions?.[id];
    if (Number.isFinite(b) && Number.isFinite(n) && n < b) out.push(`assertions ${id}: ${n} < baseline ${b}`);
  }
  for (const [id, b] of Object.entries(baseline.assertions || {})) {
    const c = committed?.assertions?.[id];
    if (Number.isFinite(b) && Number.isFinite(c) && b < c) out.push(`assertions ${id} lowered ${c} -> ${b} against the committed baseline`);
  }
  return out;
}

/* ---- ledger --------------------------------------------------------------------------------------------------- */

const verNum = (v) => String(v || '0').split('.').map((x) => parseInt(x, 10) || 0);
export function versionLess(a, b) {
  const x = verNum(a), y = verNum(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); }
  return false;
}

/** ledger: parsed human-checks.json (array or {items}) or null. version: manifest.json version. */
export function ledgerSummary(ledger, version) {
  if (!ledger) return { missing: true, open: null, notCovered: null, items: 0 };
  const items = Array.isArray(ledger) ? ledger : (ledger.items || ledger.checks || []);
  const open = items.filter((i) => !i.lastTickedVersion || versionLess(i.lastTickedVersion, version));
  const notCovered = open.filter((i) => i.gesture === true || i.engine === 'chrome');
  return { missing: false, open: open.length, notCovered: notCovered.length, items: items.length, openIds: open.map((i) => i.id) };
}

/* ---- budgets -------------------------------------------------------------------------------------------------- */

/**
 * budgets: pipeline-budgets.json { tiers: { smoke: { budgetSec, enforce?, frozenSec? } }, provisionalRuns: 3 }.
 * history: durations (ms) of earlier recorded PASS runs of this tier. Provisional until `provisionalRuns` are recorded
 * (a breach is a WARN naming the slowest five), then enforced at max(frozenSec, p95 x 1.25) when frozen, else budgetSec.
 */
export function budgetCheck({ budgets, tier, elapsedMs, rows = [], history = [] }) {
  const t = budgets?.tiers?.[tier];
  if (!t) return { status: 'none', budgetMs: null, message: '' };
  const need = budgets.provisionalRuns ?? 3;
  const enforced = t.enforce === true || history.length >= need;
  let budgetSec = t.budgetSec;
  if (Number.isFinite(t.frozenSec)) budgetSec = t.frozenSec;
  const budgetMs = budgetSec * 1000;
  const slowest = rows.filter((r) => Number.isFinite(r.durationMs)).sort((a, b) => b.durationMs - a.durationMs).slice(0, 5).map((r) => `${r.id} ${(r.durationMs / 1000).toFixed(1)}s`);
  if (elapsedMs <= budgetMs) return { status: 'ok', budgetMs, enforced, slowest, message: '' };
  return { status: enforced ? 'fail' : 'warn', budgetMs, enforced, slowest, message: `${(elapsedMs / 1000).toFixed(0)}s of ${budgetSec}s${enforced ? '' : ' (provisional)'}; slowest 5: ${slowest.join(' | ')}` };
}

export function p95(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
