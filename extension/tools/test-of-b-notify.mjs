/* OF-8: card field names follow the session language; English sessions are unchanged. */
import assert from 'node:assert/strict';
import { summarise, buildPayload } from '../background/notify.js';

const T0 = 1_700_000_000_000;
const events = [{ kind: 'dom', ts: T0 + 1000, action: 'click', label: 'Submit', frameUrl: 'a' }];
const defect = { summary: 'x', severity: 'major', priority: 'high', expected: 'e', actual: 'a', steps: ['s'] };
const mk = (env, charter) => summarise({ session: { id: 's', charter, startedAt: T0, startUrl: 'https://e.test/', env }, events, defect, links: {} });
const json = (p, s) => JSON.stringify(buildPayload(p, s, p === 'telegram' ? { chatId: '1' } : p === 'mattermost' ? { channel: 'c', username: 'u' } : {}));
const PROVIDERS = ['slack', 'teams', 'discord', 'google', 'telegram', 'mattermost'];
let passed = 0;
const t = (n, fn) => { fn(); passed++; console.log(`  ok  ${n}`); };

t('an Arabic session (env.language ar) gets Arabic labels on every card', () => {
  const s = mk({ language: 'ar-EG' }, 'Submit');
  assert.equal(s.lang, 'ar');
  for (const p of PROVIDERS) {
    const out = json(p, s);
    assert.match(out, /الخطورة/, p);
    assert.match(out, /المتوقع|المشكلات/, p);
    assert.doesNotMatch(out, /Severity|Expected/, p);
  }
});
t('an Arabic charter in an English browser is an Arabic session', () => {
  assert.equal(mk({ language: 'en-US' }, 'تقديم الطلب').lang, 'ar');
});
t('an English session keeps the English labels', () => {
  const s = mk({ language: 'en-US' }, 'Submit');
  assert.equal(s.lang, 'en');
  for (const p of PROVIDERS) assert.match(json(p, s), /Severity/, p);
});
t('the "problems in events" phrase follows summary.lang on the Google, Telegram and Mattermost cards (EN + AR pair)', () => {
  const withCounts = (env, failures, evs) => { const s = mk(env, 'Submit'); s.counts.failures = failures; s.counts.events = evs; return s; };
  for (const p of ['google', 'telegram', 'mattermost']) {
    assert.match(json(p, withCounts({ language: 'en-US' }, 3, 12)), /3 problems in 12 events/, p);
    assert.match(json(p, withCounts({ language: 'en-US' }, 1, 1)), /1 problem in 1 event(?!s)/, p);
    const ar = json(p, withCounts({ language: 'ar-EG' }, 3, 12));
    assert.match(ar, /3 مشكلات في 12 حدثًا/, p);
    assert.doesNotMatch(ar, /problem|events/, p);
    assert.match(json(p, withCounts({ language: 'ar' }, 1, 2)), /مشكلة واحدة في حدثين/, p);
    assert.match(json(p, withCounts({ language: 'ar' }, 2, 5)), /مشكلتان في 5 أحداث/, p);
    assert.match(json(p, withCounts({ language: 'ar' }, 0, 40)), /لا مشكلات في 40 حدثًا/, p);
    assert.match(json(p, withCounts({ language: 'ar' }, 11, 1)), /11 مشكلة في حدث واحد/, p);
    assert.match(json(p, withCounts({ language: 'ar' }, 0, 0)), /لا مشكلات في صفر أحداث/, p);
  }
  assert.match(json('google', withCounts({ language: 'ar' }, 3, 12)), /ما حدث/);
});
console.log(`\n${passed} passed, 0 failed`);
