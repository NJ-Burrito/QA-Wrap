/* OF-7: a low-confidence action-to-failure link is not actionable and is worded "possible". */
import assert from 'node:assert/strict';
import { buildAgentBrief } from '../core/agent.js';

const T0 = 1_757_000_000_000;
const URL0 = 'https://app.test/apply';
const SESSION = { id: 's1', charter: 'brief', startedAt: T0 - 1000, endedAt: T0 + 20000, startUrl: URL0, env: {} };
let seq = 0;
const click = (at, frameUrl = URL0) => ({ kind: 'dom', action: 'click', label: 'Submit', ts: T0 + at, frameUrl, seq: ++seq });
const net = (at) => ({ kind: 'net', method: 'POST', url: 'https://app.test/api/x', status: 500, ts: T0 + at, frameUrl: URL0, seq: ++seq });
const findings = (ev) => JSON.parse(buildAgentBrief(SESSION, ev)).findings.filter((f) => f.source === 'correlated-failure');

let passed = 0;
const t = (n, fn) => { fn(); passed++; console.log(`  ok  ${n}`); };

t('a high-confidence link is actionable', () => {
  const f = findings([click(0), net(300)]);
  assert.equal(f[0].confidence, 'high');
  assert.equal(f[0].actionable, true);
});
t('a low-confidence link is not actionable and says possible', () => {
  const f = findings([click(0, 'https://app.test/other-frame'), net(300)]);
  assert.equal(f.length, 1);
  assert.equal(f[0].confidence, 'low');
  assert.equal(f[0].actionable, false);
  assert.match(f[0].basis, /possible link/i);
});
console.log(`\n${passed} passed, 0 failed`);
