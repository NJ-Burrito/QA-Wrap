/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-064 (owner answer Q-13): a fresh install resolves 30 days, an upgraded profile keeps what it
 * had (never starts deleting), through the real getSettings(); the session-delete confirm names
 * the count in both languages; the welcome and Settings text state both cases.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lift } from './lib-lift.mjs';

const sync = {}; const local = {};
const area = (b) => ({ get: async (k) => (k === null ? { ...b } : { [k]: b[k] }), set: async (o) => Object.assign(b, o), remove: async (k) => { for (const x of [].concat(k)) delete b[x]; } });
globalThis.chrome = { storage: { sync: area(sync), local: area(local), managed: { get: async () => ({}) } } };
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32' }, configurable: true });
const { getSettings, DEFAULTS } = await import('../platform/settings.js');
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

let passed = 0; const failures = [];
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL  ${name}\n        ${e.message}`); } };

await test('a fresh install (nothing stored) resolves 30 days', async () => {
  assert.equal((await getSettings()).retentionDays, 30);
  assert.equal(DEFAULTS.retentionDays, 30);
});
await test('an upgraded profile with no retention key keeps everything (0), never 30', async () => {
  sync.settings = { expandPercent: 45 }; local.settings = { expandPercent: 45 };
  assert.equal((await getSettings()).retentionDays, 0);
});
await test('an upgraded profile that chose a value keeps that value', async () => {
  sync.settings = { retentionDays: 90 }; local.settings = { retentionDays: 90 };
  assert.equal((await getSettings()).retentionDays, 90);
});
await test('the delete-session confirm names the count, in English and Arabic, and report.js passes it', () => {
  for (const f of ['en', 'ar']) assert.match(JSON.parse(read(`platform/i18n/${f}.json`))['report.session.deleteConfirm'], /\{count\}/, f);
  assert.match(read('report/report.js'), /report\.session\.deleteConfirm', \{ name, count: events\.length \}/);
});

await test('the call site fills the confirm with the real event count (the argument object is evaluated, not grepped)', () => {
  const m = read('report/report.js').match(/t\('report\.session\.deleteConfirm', (\{[^}]*\})\)/);
  assert.ok(m, 'call site not found');
  const events = new Array(7).fill({});
  const vars = new Function('name', 'events', `return (${m[1]});`)('Checkout run', events);
  for (const f of ['en', 'ar']) {
    const text = JSON.parse(read(`platform/i18n/${f}.json`))['report.session.deleteConfirm'].replace(/\{(\w+)\}/g, (_, k) => vars[k]);
    assert.ok(/(?<![0-9])7(?![0-9])|٧/.test(text), `${f}: the count 7 is not in "${text}"`);
    assert.ok(!/undefined|\{/.test(text), `${f}: an unfilled slot in "${text}"`);
  }
});
await test('the welcome page and Settings say both cases', () => {
  assert.match(read('welcome/welcome.html'), /existed before keeps the value it already had/);
  assert.match(JSON.parse(read('platform/i18n/en.json'))['options.privacy.retentionNote'], /new install starts at 30 days; an install that existed before keeps/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
