/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-034: the perf run's pure parts and the evidence it left.  node tools/test-perf-worker.mjs
 * The browser run itself is `node tools/perf-worker.mjs` (noisy, run by hand); this guards what is
 * deterministic: the median, the boot-graph walker agreeing with the gate, and the recorded baseline
 * being present, plausible and cited by the gate's header.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { median, bootGraphBytes, soakLine, soakCeilings, soakOver } from './perf-worker.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

t('median handles odd, even and unsorted input', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([5]), 5);
});

t('the walker finds a boot graph of plausible size', () => {
  const kb = bootGraphBytes(fileURLToPath(new URL('..', import.meta.url))) / 1024;
  assert.ok(kb > 500 && kb < 1000, `${kb} KB`);
  // Now-review fault 11: agreement with the gate, measured. The walker counts whole files; the gate reports its own KB.
  const gate = spawnSync(process.execPath, [fileURLToPath(new URL('./test-worker-imports.mjs', import.meta.url))], { encoding: 'utf8' }).stdout.match(/([\d.]+) KB\)/);
  assert.ok(gate, 'R15: the gate printed its size');
  assert.ok(Math.abs(kb - Number(gate[1])) / Number(gate[1]) < 0.03, `walker ${kb.toFixed(1)} KB vs gate ${gate[1]} KB differ by more than 3%`);
});

t('the baseline records the table and the decision, and the gate header cites it', () => {
  const b = JSON.parse(fs.readFileSync(new URL('./perf-worker-baseline.json', import.meta.url), 'utf8'));
  assert.ok(b.cold && b.cold.stub && b.paint && b.overlay, 'cold, paint and overlay numbers');
  assert.ok(['ms-gate', 'keep-byte-cap'].includes(b.decision), 'a decision is recorded');
  assert.match(fs.readFileSync(new URL('./test-worker-imports.mjs', import.meta.url), 'utf8'), /perf-worker/);
});

t('the baseline is no more than 30 days old (D-1010-158): measuredOn starts with its date', () => {
  const b = JSON.parse(fs.readFileSync(new URL('./perf-worker-baseline.json', import.meta.url), 'utf8'));
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(String(b.measuredOn || ''));
  assert.ok(day, 'measuredOn starts with an ISO date');
  const age = (Date.now() - Date.parse(day[1])) / 86400000;
  assert.ok(age <= 30, `baseline measured ${day[1]}, ${Math.floor(age)} days ago: rerun node tools/perf-worker.mjs --json tools/perf-worker-baseline.json`);
});

// r8-07-3: the stored cold-start median must sit under a sanity ceiling (not a budget: a run that stored 200 ms was a loaded box), and a stored spread, when present, is inside the limit.
t('the stored cold-start median is under the sanity ceiling and its spread was acceptable', () => {
  const b = JSON.parse(fs.readFileSync(new URL('./perf-worker-baseline.json', import.meta.url), 'utf8'));
  const CEILING_MS = 60;
  for (const [name, r] of Object.entries(b.cold)) assert.ok(r.median < CEILING_MS, name + ' cold median ' + r.median.toFixed(1) + ' ms is over the ' + CEILING_MS + ' ms ceiling: the baseline was recorded on a loaded machine');
  for (const [name, r] of Object.entries(b.cold)) if (r.spreadPct != null) assert.ok(r.spreadPct <= 25, name + ' sample spread ' + r.spreadPct.toFixed(0) + '% is over 25%');
});

// D-1010-195: the soak probe is by hand and report-only; this guards its row format and that it never feeds the gate or the baseline.
t('the soak row formats numbers and failures, and the probe writes no baseline', () => {
  const ok = soakLine({ events: 200000, seedMs: 41000, timeline: { ok: true, ms: 2300, rows: 200000 }, html: { ok: true, ms: 9100, bytes: 52428800 }, peakHeap: 805306368 });
  assert.match(ok, /200000 events: seed 41000 ms; UQA_GET_TIMELINE 2300 ms \(200000 rows\); HTML export 9100 ms \(50 MB\); peak memory 768 MB/);
  const bad = soakLine({ events: 10, seedMs: 1, timeline: { ok: false, error: 'Message length exceeded maximum allowed length' }, html: { ok: true, ms: 5 }, peakHeap: null });
  assert.match(bad, /UQA_GET_TIMELINE FAILED \(Message length[^)]*\)/);
  assert.match(bad, /peak memory n\/a/);
  const src = fs.readFileSync(new URL('./perf-worker.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(MAIN && SOAK\) \{[\s\S]*?process\.exit\(code\);/, 'the soak branch exits before the baseline code');
});

// r10-07-2 (D-230): the stored soak line carries 1.5x ceilings and the soak run fails above them.
t('the soak baseline stores 1.5x ceilings and soakOver fails above each one', () => {
  const b = JSON.parse(fs.readFileSync(new URL('./perf-worker-baseline.json', import.meta.url), 'utf8'));
  assert.ok(b.soak && b.soak.events >= 200000 && b.soak.ceilings, 'a soak section with its event count and ceilings is stored');
  const m = b.soak.measured;
  assert.equal(b.soak.ceilings.peakBytes, Math.ceil(m.peakBytes * 1.5), 'peak ceiling is 1.5x the measured peak');
  assert.ok(Math.abs(b.soak.ceilings.timelineMs - m.timelineMs * 1.5) <= 1.5, 'timeline ceiling is 1.5x (measured ms are stored rounded)');
  assert.ok(Math.abs(b.soak.ceilings.htmlMs - m.htmlMs * 1.5) <= 1.5, 'export ceiling is 1.5x');
  const run = (over = {}) => ({ events: b.soak.events, timeline: { ok: true, ms: m.timelineMs }, html: { ok: true, ms: m.htmlMs }, peakHeap: m.peakBytes, ...over });
  assert.deepEqual(soakOver(run(), b.soak), [], 'the measured run itself is inside');
  const c = b.soak.ceilings;
  assert.deepEqual(soakOver(run({ timeline: { ok: true, ms: c.timelineMs } }), b.soak), [], 'exactly at a ceiling is inside');
  assert.match(soakOver(run({ timeline: { ok: true, ms: c.timelineMs + 1 } }), b.soak).join(), /UQA_GET_TIMELINE .* over/);
  assert.match(soakOver(run({ html: { ok: true, ms: c.htmlMs + 1 } }), b.soak).join(), /HTML export .* over/);
  assert.match(soakOver(run({ peakHeap: c.peakBytes + 1 }), b.soak).join(), /peak memory .* over/);
  assert.match(soakOver(run({ html: { ok: false, error: 'x' } }), b.soak).join(), /HTML export FAILED/);
  assert.match(soakOver(run({ events: 10 }), b.soak).join(), /seeded 10 events/);
  assert.match(soakOver(run(), {}).join(), /no soak ceilings/);
  assert.equal(soakCeilings(run({ peakHeap: null })), null, 'a run with a failed step is never stored');
  assert.ok(Math.abs(soakCeilings(run()).htmlMs - c.htmlMs) <= 1, 'soakCeilings reproduces the stored ceilings');
  assert.match(fs.readFileSync(new URL('./perf-worker.mjs', import.meta.url), 'utf8'), /soakOver\(r, base\.soak\)/, 'the soak branch calls the check');
});

t('run-suites carries the baseline into its record', () => {
  assert.match(fs.readFileSync(new URL('./run-suites.mjs', import.meta.url), 'utf8'), /perf-worker-baseline\.json/);
});

console.log(`\n${n} passed, 0 failed`);
