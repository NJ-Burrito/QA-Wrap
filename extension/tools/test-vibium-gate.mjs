/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The optional Vibium second opinion (lib-vibium-gate.mjs): off by default, Claude only, an extra field that never moves a status.
 * The model call is a stub; a real run needs ANTHROPIC_API_KEY.   node tools/test-vibium-gate.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyVibiumGate, checkOne, childEnv, apiKeyPresent, gateOn, modelOf, DEFAULT_MODEL } from './lib-vibium-gate.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-vg-'));
const KEY = { ANTHROPIC_API_KEY: 'k', PATH: process.env.PATH };
const trace = path.join(T, 't.zip'); fs.writeFileSync(trace, 'PK');
const calls = [], stops = [];
const stub = (status, { code = 0, extra = {} } = {}) => (argv) => {
  if (argv.includes('daemon')) { stops.push(argv); return { code: 0, stdout: '', stderr: '' }; }
  calls.push(argv);
  const rep = argv[argv.indexOf('--report') + 1];
  assert.ok(!fs.existsSync(rep), 'Vibium needs a fresh report path');
  if (code === 0) fs.writeFileSync(rep, JSON.stringify({ status, claim: 'c', summary: `saw ${status}`, ...extra }));
  return { code, stdout: '', stderr: code ? 'boom: it broke' : '' };
};
const chk = (status, runner, o = {}) => checkOne({ trace, claim: 'the total is 5', status, cli: ['vibium'], runner, env: KEY, ...o });

t('off by default; QAW_VIBIUM_GATE=1 turns it on; a non-Claude model name is ignored', () => {
  assert.equal(gateOn({}), false); assert.equal(gateOn({ QAW_VIBIUM_GATE: '1' }), true); assert.equal(gateOn({ QAW_VIBIUM_GATE: 'true' }), false);
  assert.equal(modelOf({ QAW_VIBIUM_MODEL: 'gpt-5' }), DEFAULT_MODEL); assert.equal(modelOf({ QAW_VIBIUM_MODEL: 'claude-opus-4' }), 'claude-opus-4');
});
t('an API key is detected without being read out; an empty one is none', () => {
  const home = path.join(T, 'home'); fs.mkdirSync(path.join(home, '.config', 'vibium'), { recursive: true });
  assert.equal(apiKeyPresent({}, home), false); assert.equal(apiKeyPresent({ ANTHROPIC_API_KEY: 'x' }, home), true);
  fs.writeFileSync(path.join(home, '.config', 'vibium', 'ai.env'), 'ANTHROPIC_API_KEY=\n'); assert.equal(apiKeyPresent({}, home), false);
  fs.writeFileSync(path.join(home, '.config', 'vibium', 'ai.env'), 'ANTHROPIC_API_KEY=sk-test\n'); assert.equal(apiKeyPresent({}, home), true);
});
t('the child env keeps Claude\'s key and drops every other provider key and VIBIUM_AI_*', () => {
  const e = childEnv({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b', GEMINI_API_KEY: 'c', VIBIUM_AI_PROVIDER: 'openai', PATH: 'p' });
  assert.deepEqual(Object.keys(e).sort(), ['ANTHROPIC_API_KEY', 'PATH', 'PYTHONUTF8']);
});
t('polarity: PASS wants passed, FAIL wants failed', () => {
  for (const [row, v, state] of [['PASS', 'passed', 'agree'], ['PASS', 'failed', 'disagree'], ['FAIL', 'failed', 'agree'], ['FAIL', 'passed', 'disagree']]) {
    const r = chk(row, stub(v)); assert.equal(r.state, state, `${row}/${v}`); assert.equal(r.vibiumStatus, v);
  }
});
t('Claude only, no shell, the claim after `--`, never --expect, its own session stopped', () => {
  const a = calls.at(-1);
  assert.equal(a[a.indexOf('--provider') + 1], 'anthropic'); assert.match(a[a.indexOf('--model') + 1], /^claude/);
  assert.deepEqual(a.slice(-2), ['--', 'the total is 5']); assert.ok(!a.includes('--expect'));
  const s = a[a.indexOf('--session') + 1]; assert.match(s, /^qaw-vg-/); assert.equal(stops.at(-1)[stops.at(-1).indexOf('--session') + 1], s);
});
t('inconclusive, an error, a crash and every missing piece are not-checked, never a pass', () => {
  const r = chk('PASS', stub('inconclusive', { extra: { reason: 'insufficient_evidence' } }));
  assert.equal(r.state, 'not-checked'); assert.match(r.reason, /insufficient_evidence/);
  const e = chk('PASS', stub('', { code: 1 })); assert.equal(e.state, 'not-checked'); assert.match(e.reason, /exit 1.*it broke/);
  assert.equal(chk('PASS', () => { throw new Error('ENOENT'); }).state, 'not-checked');
  assert.equal(chk('PASS', stub('passed'), { trace: path.join(T, 'none.zip') }).state, 'not-checked');
  assert.equal(chk('PASS', stub('passed'), { claim: ' ' }).state, 'not-checked');
  assert.equal(chk('PASS', stub('passed'), { cli: null }).state, 'not-checked');
  const nk = chk('PASS', stub('passed'), { env: {} }); assert.equal(nk.state, 'not-checked'); assert.match(nk.reason, /ANTHROPIC_API_KEY/);
  assert.equal(chk('SKIPPED', stub('passed')).state, 'not-checked'); assert.equal(chk('ENV-BLOCKED', stub('passed')).state, 'not-checked');
  assert.equal(chk('PASS', stub('passed'), { model: 'gemini-3' }).state, 'not-checked');
});
t('a run: off leaves the rows untouched; on annotates PASS/FAIL rows only and never changes a status', () => {
  const run = path.join(T, 'run'); fs.mkdirSync(path.join(run, 'traces'), { recursive: true });
  for (const id of ['a', 'b']) { fs.writeFileSync(path.join(run, 'traces', `${id}.zip`), 'PK'); fs.writeFileSync(path.join(run, 'traces', `${id}.claim.txt`), `claim of ${id}`); }
  const mk = () => [{ id: 'a', status: 'PASS' }, { id: 'b', status: 'FAIL' }, { id: 'c', status: 'PASS' }, { id: 'd', status: 'SKIPPED' }];
  const off = mk(); assert.deepEqual(applyVibiumGate(off, { runDir: run, env: KEY, runner: stub('passed'), cli: ['v'] }), { enabled: false });
  assert.deepEqual(off, mk(), 'off: rows identical');
  const rows = mk(), said = [];
  const sum = applyVibiumGate(rows, { runDir: run, env: { ...KEY, QAW_VIBIUM_GATE: '1' }, runner: stub('passed'), cli: ['v'], say: (l) => said.push(l) });
  assert.deepEqual(rows.map((r) => r.status), ['PASS', 'FAIL', 'PASS', 'SKIPPED'], 'statuses unchanged');
  assert.deepEqual(rows.map((r) => r.vibium?.state), ['agree', 'disagree', 'not-checked', undefined]);
  assert.deepEqual([sum.agree, sum.disagree, sum.notChecked], [1, 1, 1]); assert.equal(said.length, 1); assert.match(said[0], /VIBIUM REVIEW b/);
});
fs.rmSync(T, { recursive: true, force: true });
console.log(`${n} passed`);
