/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * lib-report.mjs — everything a run leaves behind (P1, test pipeline 1012, spec 2.7 and seat 5 sections 4 to 7).
 *
 *   renderScreen(run)       the one-screen summary, at most 20 lines, a copy-paste rerun for every failure, REPORT and NEXT last
 *   renderSummaryTxt(run)   summary.txt: STATUS / FINDING / EVIDENCE / FILES / RISK / NEXT, at most 10 lines
 *   resultLine(run)         work/test-runs/latest/RESULT, one line: `FAIL 1 tier=changed fail=2 flaky=1 blocked=1`
 *   renderJunit(run), renderIndexHtml(run, { logBase })
 *   writeRun(runDir, run, extra)  run.json, junit.xml, summary.txt, screen.txt, index.html, RESULT, env.json, leftovers.txt
 *   publishLatest(runsRoot, runDir, run), pruneRuns(runsRoot, keep)  latest/ is a copy (Windows symlinks need rights), 20 runs kept
 *
 * index.html is a developer tool page, not a deliverable: system fonts, no network, no script source other than the file itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { counts } from './lib-verdict.mjs';

export const MAX_SCREEN_LINES = 20;
export const KEEP_RUNS = 20;

export function fmtDur(ms) {
  if (!Number.isFinite(ms)) return '?';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}
const one = (s, n = 110) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xml = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export function rerunCommand(id) { return `npm run t ${id}`; }

export function resultLine(run) {
  const c = run.counts;
  return `${run.verdict} ${run.exit} tier=${run.label} fail=${c.fail} flaky=${c.flaky} blocked=${c.envBlocked}${run.deliveryGate ? ' deliveryGate=true' : ''}`;
}

function nextLine(run) {
  const bad = run.rows.filter((r) => ['FAIL', 'FLAKY', 'ENV-BLOCKED'].includes(r.status));
  if (run.mode === 'last' && !bad.length && run.verdict !== 'FAIL') return `NEXT: tier ${run.of || 'changed'} still needs a full rerun: npm run t${run.of && run.of !== 'changed' ? ` ${run.of}` : ''}`;
  if (run.rows.some((r) => r.status === 'FAIL' || r.status === 'FLAKY')) return `NEXT: npm run t last   (reruns the ${bad.length} red or blocked)`;
  if (run.verdict === 'PASS' && !run.deliveryGate) return 'NEXT: npm run t full';
  if (run.verdict === 'INCOMPLETE') return run.reasons.some((x) => /HUMAN CHECKS OPEN/.test(x)) ? 'NEXT: tick the open items in tools/human-checks.json by hand, then npm run t full' : 'NEXT: npm run t last (or fix the cause named above)';
  if (run.verdict === 'PASS') return 'NEXT: nothing failed. Delivery also needs npm run test:release-gate until the parity check passes';
  return 'NEXT: npm run t last';
}

/** The one-screen summary. Returns an array of at most 20 lines. */
export function renderScreen(run) {
  const c = run.counts;
  const head = [];
  head.push(`RESULT: ${run.verdict}   (exit ${run.exit})   tier=${run.label}  engine=${run.engine || 'none'}${run.zipSha ? `  zip sha=${run.zipSha}` : ''}   ${fmtDur(run.elapsedMs)}${run.budget?.budgetMs ? ` of ${fmtDur(run.budget.budgetMs)} budget${run.budget.status === 'fail' ? '!' : run.budget.status === 'warn' ? ' (provisional, over)' : ''}` : ''}`);
  head.push(`  ${c.run} run   ${c.pass} pass   ${c.fail} FAIL   ${c.flaky} FLAKY   ${c.envBlocked} ENV-BLOCKED   ${c.skipped} skipped   ${c.quarantined} quarantined   NOT RUN ${c.notRun}`);
  const led = run.ledger || {};
  head.push(`  NOT COVERED ON BRANDED CHROME: ${led.notCovered ?? '?'}   HUMAN CHECKS OPEN: ${led.open ?? '?'}   leftovers: ${run.leftovers ?? '?'}   GATE LOOSENED: ${run.gate?.loosened?.length ? `${run.gate.loosened.length}${run.gate.accepted ? ` (accepted: ${one(run.gate.accepted, 40)})` : ''}` : run.gate?.missing ? 'n/a (no gate-baseline.json)' : 'none'}`);
  const ap = run.autopilot;
  head.push(`  AUTOPILOT RULES: ${ap ? `${ap.enforced} enforced, ${ap.notEnforced.length} NOT ENFORCED${ap.notEnforced.length ? ` (${ap.notEnforced.join(', ')})` : ''}` : 'unknown (no autopilot-rules.json and no rule skipped)'}`);
  if (run.canary) head.push(`  CANARY ${run.canary.k}/${run.canary.n} killed`);
  head.push(`  DELIVERY GATE: ${run.deliveryGate ? 'this tier writes deliveryGate:true' : `no (${run.label} never satisfies it)`}${run.acceptEnv?.length ? `   accepted env: ${run.acceptEnv.join(',')}` : ''}${run.mode === 'last' ? `   ${run.lastLine || ''}` : ''}`.trimEnd());
  const tail = [];
  tail.push(`REPORT: ${run.reportRel}`);
  tail.push(nextLine(run));
  const body = [];
  const failed = run.rows.filter((r) => r.status === 'FAIL');
  const flaky = run.rows.filter((r) => r.status === 'FLAKY');
  const blocked = run.rows.filter((r) => r.status === 'ENV-BLOCKED');
  const skipped = run.rows.filter((r) => r.status === 'SKIPPED' || r.status === 'SKIPPED-NOT-ENFORCED');
  const maxFail = 4;
  if (failed.length) {
    body.push(`FAILED (${failed.length})`);
    for (const r of failed.slice(0, maxFail)) { body.push(`  ${r.id}  ${r.lane}  ${one(r.reason, 80)}`); body.push(`      ${rerunCommand(r.id)}   log: ${run.logRel}/${r.id}.log`); }
    if (failed.length > maxFail) body.push(`  ... +${failed.length - maxFail} more FAILED: summary.txt, run.json`);
  }
  if (flaky.length) body.push(`FLAKY (${flaky.length})  ${flaky.slice(0, 3).map((r) => r.id).join(', ')}  passed on probe -> red for delivery`);
  if (blocked.length) body.push(`ENV-BLOCKED (${blocked.length})  ${blocked.slice(0, 2).map((r) => r.id).join(', ')}: ${one(blocked[0].reason, 70)}  (accept: --accept-env ${blocked[0].envKind || 'python'})`);
  if (skipped.length) body.push(`SKIPPED (${skipped.length})  ${skipped.slice(0, 3).map((r) => r.id + (r.rule ? ` rule ${r.rule}` : '')).join(', ')}${skipped.length > 3 ? ', ...' : ''}`);
  if (run.guardProblems?.length) body.push(`GUARD  ${one(run.guardProblems[0], 100)}`);
  if (run.leaks?.length) body.push(`LEAK SCAN  ${run.leaks.length} finding(s): ${one(run.leaks[0], 80)}`);
  if (run.refused) body.push(`REFUSED  ${one(run.refused, 120)}`);
  const slow = run.rows.filter((r) => Number.isFinite(r.durationMs) && r.durationMs > 0).sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);
  const slowest = slow.length ? [`SLOWEST 5   ${slow.map((r) => `${r.id} ${fmtDur(r.durationMs)}`).join(' | ')}`] : [];
  let lines = [...head, ...body, ...slowest, ...tail];
  if (lines.length > MAX_SCREEN_LINES) lines = [...head, ...body, ...tail];
  while (lines.length > MAX_SCREEN_LINES) {
    const i = lines.findIndex((l) => /^ {6}npm run t /.test(l));
    if (i < 0) break;
    lines.splice(i - 1, 2);
  }
  while (lines.length > MAX_SCREEN_LINES) lines.splice(head.length + 1, 1);
  return lines.map((l) => (l.length > 200 ? l.slice(0, 199) + '…' : l));
}

/** summary.txt: STATUS / FINDING / EVIDENCE / FILES / RISK / NEXT, at most 10 lines. */
export function renderSummaryTxt(run) {
  const c = run.counts;
  const bad = run.rows.filter((r) => ['FAIL', 'FLAKY', 'ENV-BLOCKED', 'SKIPPED', 'SKIPPED-NOT-ENFORCED'].includes(r.status));
  const lines = [];
  lines.push(`STATUS: ${run.verdict} (exit ${run.exit}) tier=${run.label} engine=${run.engine || 'none'} ${fmtDur(run.elapsedMs)}${run.budget?.budgetMs ? ` of ${fmtDur(run.budget.budgetMs)}` : ''}`);
  lines.push(`FINDING: ${bad.length ? bad.slice(0, 4).map((r) => `${r.status} ${r.id}: ${one(r.reason, 70)}`).join(' | ') : 'every selected suite passed'}${bad.length > 4 ? ` | +${bad.length - 4} more (run.json)` : ''}`);
  lines.push(`EVIDENCE: ${c.run} run / ${c.pass} pass / ${c.fail} fail / ${c.flaky} flaky / ${c.envBlocked} env-blocked / ${c.quarantined} quarantined / ${c.skipped} skipped / NOT RUN ${c.notRun}; picked ${run.picked}`);
  if (run.reasons.length) lines.push(`REASONS: ${run.reasons.slice(0, 3).map((x) => one(x, 70)).join(' | ')}${run.reasons.length > 3 ? ` | +${run.reasons.length - 3}` : ''}`);
  lines.push(`FILES: ${run.reportRel}/run.json, junit.xml, index.html, logs/ ; latest: ${run.latestRel}`);
  lines.push(`RISK: NOT COVERED ON BRANDED CHROME ${run.ledger?.notCovered ?? '?'}; HUMAN CHECKS OPEN ${run.ledger?.open ?? '?'}; GATE LOOSENED ${run.gate?.loosened?.length ? run.gate.loosened.length : 'none'}; leftovers ${run.leftovers ?? '?'}; deliveryGate ${run.deliveryGate}`);
  lines.push(nextLine(run));
  return lines.slice(0, 10);
}

export function renderJunit(run) {
  const byLane = new Map();
  for (const r of run.rows) { const k = r.lane || 'node'; if (!byLane.has(k)) byLane.set(k, []); byLane.get(k).push(r); }
  const sec = (ms) => ((ms || 0) / 1000).toFixed(3);
  const c = run.counts;
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', `<testsuites name="qaw-pipeline ${xml(run.label)}" tests="${run.rows.length}" failures="${c.fail + c.flaky}" errors="${c.envBlocked}" skipped="${c.skipped + c.quarantined + c.notRun}" time="${sec(run.elapsedMs)}">`];
  for (const [lane, rows] of byLane) {
    const f = rows.filter((r) => r.status === 'FAIL' || r.status === 'FLAKY').length;
    const e = rows.filter((r) => r.status === 'ENV-BLOCKED').length;
    const s = rows.filter((r) => ['SKIPPED', 'SKIPPED-NOT-ENFORCED', 'QUARANTINED', 'NOT-RUN'].includes(r.status)).length;
    out.push(` <testsuite name="${xml(lane)}" tests="${rows.length}" failures="${f}" errors="${e}" skipped="${s}" time="${sec(rows.reduce((a, r) => a + (r.durationMs || 0), 0))}">`);
    for (const r of rows) {
      out.push(`  <testcase classname="${xml(lane + '.' + (r.features?.[0] || 'none'))}" name="${xml(r.id)}" time="${sec(r.durationMs)}">`);
      if (r.status === 'FAIL' || r.status === 'FLAKY') out.push(`   <failure type="${r.status}" message="${xml(one(r.reason, 200))}">${xml((r.tail || []).join('\n'))}</failure>`);
      else if (r.status === 'ENV-BLOCKED') out.push(`   <error type="ENV-BLOCKED" message="${xml(one(r.reason, 200))}"/>`);
      else if (r.status !== 'PASS') out.push(`   <skipped message="${xml(r.status + ': ' + one(r.reason, 200))}"/>`);
      out.push('  </testcase>');
    }
    out.push(' </testsuite>');
  }
  out.push('</testsuites>');
  return out.join('\n') + '\n';
}

export function renderIndexHtml(run, { logBase = 'logs/' } = {}) {
  const c = run.counts;
  const bad = run.rows.filter((r) => ['FAIL', 'FLAKY'].includes(r.status));
  const other = run.rows.filter((r) => ['ENV-BLOCKED', 'SKIPPED', 'SKIPPED-NOT-ENFORCED'].includes(r.status));
  const slow = [...run.rows].filter((r) => r.durationMs > 0).sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
  const maxMs = slow[0]?.durationMs || 1;
  const tile = (n, l) => `<div class="tile"><b>${n}</b><span>${esc(l)}</span></div>`;
  const row = (r) => `<tr data-s="${esc(r.status)}" data-l="${esc(r.lane)}" data-f="${esc(r.features?.[0] || '')}"><td>${esc(r.status)}</td><td><a href="${esc(logBase)}${esc(r.id)}.log">${esc(r.id)}</a></td><td>${esc(r.lane)}</td><td>${esc(r.features?.[0] || '')}</td><td>${fmtDur(r.durationMs)}</td><td>${esc(one(r.reason, 120))}</td></tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>QA Wrap tests: ${esc(run.verdict)} ${esc(run.label)}</title>
<!-- Developer tool page, not a deliverable: system fonts, no network, one file. Generated by tools/lib-report.mjs. -->
<style>body{font:14px system-ui,Segoe UI,Arial,sans-serif;margin:24px;max-width:1100px}h1{font-size:20px}.banner{padding:12px 16px;border:2px solid #333;font-weight:700}.PASS{border-color:#146c2e}.FAIL{border-color:#a11}.INCOMPLETE{border-color:#b60}.tiles{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tile{border:1px solid #aaa;padding:6px 12px;min-width:90px}.tile b{display:block;font-size:20px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:4px 8px;text-align:left;vertical-align:top}pre{background:#f4f4f4;padding:8px;overflow:auto;max-height:260px}.bar{background:#468;height:10px}button{cursor:pointer}</style></head><body>
<div class="banner ${esc(run.verdict)}">RESULT: ${esc(run.verdict)} (exit ${run.exit}) tier=${esc(run.label)} engine=${esc(run.engine || 'none')} ${fmtDur(run.elapsedMs)}</div>
<div class="tiles">${tile(c.run, 'run')}${tile(c.pass, 'pass')}${tile(c.fail, 'FAIL')}${tile(c.flaky, 'FLAKY')}${tile(c.envBlocked, 'ENV-BLOCKED')}${tile(c.skipped, 'skipped')}${tile(c.quarantined, 'quarantined')}${tile(c.notRun, 'NOT RUN')}</div>
<p>NOT COVERED ON BRANDED CHROME: ${run.ledger?.notCovered ?? '?'} &middot; HUMAN CHECKS OPEN: ${run.ledger?.open ?? '?'} &middot; leftovers: ${run.leftovers ?? '?'} &middot; deliveryGate: ${run.deliveryGate} &middot; picked: ${esc(run.picked)}</p>
<h1>Failures</h1>${bad.length ? bad.map((r) => `<details open><summary>${esc(r.status)} ${esc(r.id)} &mdash; ${esc(one(r.reason, 140))}</summary><pre>${esc((r.tail || []).join('\n'))}</pre><button data-cmd="${esc(rerunCommand(r.id))}">copy rerun command</button> <code>${esc(rerunCommand(r.id))}</code></details>`).join('\n') : '<p>none</p>'}
<h1>Flaky, blocked, skipped</h1>${other.length ? `<table>${other.map(row).join('')}</table>` : '<p>none</p>'}
<h1>Slowest 10</h1>${slow.map((r) => `<div>${esc(r.id)} ${fmtDur(r.durationMs)}<div class="bar" style="width:${Math.max(2, Math.round((100 * r.durationMs) / maxMs))}%"></div></div>`).join('')}
<h1>Every suite</h1><p><input id="q" placeholder="filter by status, lane, feature or id" size="50"></p>
<details><summary>${run.rows.length} rows</summary><table id="all">${run.rows.map(row).join('')}</table></details>
<script>document.getElementById('q').addEventListener('input',function(e){var v=e.target.value.toLowerCase();document.querySelectorAll('#all tr').forEach(function(t){t.style.display=t.textContent.toLowerCase().indexOf(v)<0?'none':''})});document.querySelectorAll('button[data-cmd]').forEach(function(b){b.addEventListener('click',function(){navigator.clipboard&&navigator.clipboard.writeText(b.dataset.cmd)})});</script>
</body></html>
`;
}

/** Write every file of a finished run. `extra`: { env (preflight body), leftoversText }. Returns the paths. */
export function writeRun(runDir, run, extra = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  const w = (name, text) => fs.writeFileSync(path.join(runDir, name), text);
  const screen = renderScreen(run);
  w('run.json', JSON.stringify(run, null, 2) + '\n');
  w('junit.xml', renderJunit(run));
  w('summary.txt', renderSummaryTxt(run).join('\n') + '\n');
  w('screen.txt', screen.join('\n') + '\n');
  w('index.html', renderIndexHtml(run, { logBase: 'logs/' }));
  w('RESULT', resultLine(run) + '\n');
  w('env.json', JSON.stringify(extra.env || {}, null, 2) + '\n');
  w('leftovers.txt', extra.leftoversText || `leftovers: ${run.leftovers ?? 0}\n`);
  return { screen };
}

const FILES = ['RESULT', 'summary.txt', 'screen.txt', 'run.json', 'junit.xml', 'env.json', 'leftovers.txt'];
/** latest/ is a copy of the newest run. Logs stay in the run folder; index.html in latest/ links to them. */
export function publishLatest(runsRoot, runDir, run) {
  const latest = path.join(runsRoot, 'latest');
  fs.mkdirSync(latest, { recursive: true });
  for (const f of FILES) { try { fs.copyFileSync(path.join(runDir, f), path.join(latest, f)); } catch { /* a file this run did not write */ } }
  fs.writeFileSync(path.join(latest, 'index.html'), renderIndexHtml(run, { logBase: `../${path.basename(runDir)}/logs/` }));
  fs.writeFileSync(path.join(latest, 'RUN'), path.basename(runDir) + '\n');
  return latest;
}

/** Keep the newest `keep` runs; older ones go to the recycle bin through lib-trash (never removed outright). Returns the recycled names. */
export async function pruneRuns(runsRoot, extDir, keep = KEEP_RUNS) {
  let names = [];
  try { names = fs.readdirSync(runsRoot).filter((n) => /^\d{8}-\d{6}/.test(n)).sort(); } catch { return []; }
  const old = names.slice(0, Math.max(0, names.length - keep));
  if (!old.length) return [];
  let recycle = null;
  try { recycle = (await import(pathToFileURL(path.join(extDir, 'tools', 'lib-trash.mjs')).href)).recycle; } catch { return []; }
  for (const n of old) recycle(path.join(runsRoot, n), n);
  return old;
}

export { counts };
