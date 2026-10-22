/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-055: a swallowed handler error is a test oracle. core/on.js warns in one
 * shape (ON_FAILED reads it), boot-smoke and the truth harness fail on it and
 * assert the ring empty, and the ring is capped at 50 and erased by Reset.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bag = {};
const area = (b) => ({
  get: async (k) => (k === null ? { ...b } : { [k]: b[k] }),
  set: async (o) => Object.assign(b, o),
  remove: async (k) => { for (const x of [].concat(k)) delete b[x]; },
});
const sync = {};
globalThis.chrome = { storage: { sync: area(sync), local: area(bag), managed: { get: async () => ({}) } } };
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32' }, configurable: true });

const { on, ON_FAILED, RING_KEY, RING_MAX } = await import('../core/on.js');
const { resetSettings } = await import('../platform/settings.js');
const { REGISTRY } = await import('../core/store-registry.js');

let passed = 0; const failures = [];
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL  ${name}\n        ${e.message}`); } };
const tick = () => new Promise((r) => setTimeout(r, 5));
const listener = (event, name, fn) => { let l; on({ addListener: (f) => { l = f; } }, name, fn); return l; };
const warnings = [];
const realWarn = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));

console.log('on.js oracle');
await test('a throwing listener warns in the shape the oracle reads, and adds one ring row', async () => {
  warnings.length = 0;
  listener(null, 'scratch.onClicked', () => { throw new Error('boom'); })();
  await tick();
  assert.equal(warnings.length, 1);
  assert.ok(ON_FAILED.test(warnings[0]), warnings[0]);
  assert.equal(bag[RING_KEY].length, 1);
  assert.equal(bag[RING_KEY][0].name, 'scratch.onClicked');
});
await test('a handler that succeeds warns nothing and adds nothing', async () => {
  warnings.length = 0; const before = bag[RING_KEY].length;
  listener(null, 'ok.handler', async () => 1)();
  await tick();
  assert.equal(warnings.length, 0);
  assert.equal(bag[RING_KEY].length, before);
});
await test('the ring keeps the last 50', async () => {
  let k = 0;
  const l = listener(null, 'flood', () => { throw new Error(`x${k++}`); });
  for (let i = 0; i < 60; i++) { l(); await tick(); }
  assert.equal(bag[RING_KEY].length, RING_MAX);
});
await test('the same failure on every event writes storage once, and two failures in one tick both land', async () => {
  const before = bag[RING_KEY].length; let writes = 0;
  const set = chrome.storage.local.set; chrome.storage.local.set = async (o) => { writes++; return set(o); };
  const same = listener(null, 'storm', () => { throw new Error('same'); });
  for (let i = 0; i < 40; i++) same();
  await tick(); await tick();
  assert.equal(writes, 1, `${writes} storage writes for one repeated failure`);
  const a = listener(null, 'twinA', () => { throw new Error('a'); }); const b = listener(null, 'twinB', () => { throw new Error('b'); });
  a(); b(); await tick(); await tick();
  chrome.storage.local.set = set;
  assert.deepEqual(bag[RING_KEY].slice(-2).map((r) => r.name), ['twinA', 'twinB'], 'a read-modify-write race lost a row');
  assert.ok(before >= 0);
});
await test('boot-smoke and the truth harness read the oracle and assert the ring empty', () => {
  for (const f of ['tools/test-boot-smoke.mjs', 'tools/test-truth.mjs']) {
    const s = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.match(s, /ON_FAILED\.test\(/, `${f} does not test ON_FAILED`);
    assert.match(s, /RING_KEY/, `${f} does not read the ring`);
  }
});
await test('D-1010-57: a failure message is masked and stripped of addresses and hosts before it is stored', async () => {
  const bad = new Error('fetch https://acme.example.com/a?token=abcdef123456 failed for 10.0.0.7:8080 and api.acme.com; password=hunter2hunter2');
  listener(null, 'leaky.handler', () => { throw bad; })();
  await tick();
  const row = bag[RING_KEY].filter((r) => r.name === 'leaky.handler').pop();
  assert.ok(row, 'row written');
  for (const raw of ['acme', 'abcdef123456', '10.0.0.7', '8080', 'hunter2hunter2']) assert.ok(!row.msg.includes(raw), `${raw} survived: ${row.msg}`);
  assert.ok(row.msg.includes('failed for'), 'the words stay');
});
await test('Reset empties the ring, and the registry says Erase all does (D-1010-57)', async () => {
  assert.ok(bag[RING_KEY].length > 0);
  await resetSettings();
  assert.equal(bag[RING_KEY], undefined);
  assert.equal(REGISTRY.find((r) => r.key === RING_KEY)?.erasedBy, 'eraseAll');
});

console.warn = realWarn;
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
