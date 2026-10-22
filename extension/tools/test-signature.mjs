/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The console signature, and the handle it advertises.
 *
 * Worth its own suite for one reason: a banner that lies is worse than no
 * banner. It prints a version, a state and a list of commands, and every one of
 * those is a claim that can rot — a command that no longer exists, a version
 * read from the wrong place, a banner that reprints on every worker wake and
 * buries the logs it was meant to sit above.
 */
import assert from 'node:assert/strict';
import { signConsole, installConsoleApi, tagCalls } from '../background/signature.js';
import { MAKER } from '../core/provenance.js';

let passed = 0;
const failures = [];

/**
 * Awaits the body.
 *
 * The first version did not, so an async assertion resolved after the next test
 * had already run — `sleep()` reported zero windows because `wake()` had not
 * finished arming one. A harness that does not await is a harness that tests a
 * different order than the one it prints.
 */
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

/* A console that records rather than prints, and a chrome that answers. */
function capture() {
  const lines = [];
  const real = { log: console.log, groupCollapsed: console.groupCollapsed, groupEnd: console.groupEnd };
  const methods = [];
  console.log = (...args) => { methods.push('log'); lines.push(args); };
  console.groupCollapsed = (...args) => { methods.push('groupCollapsed'); lines.push(args); };
  console.groupEnd = () => { methods.push('groupEnd'); };
  return {
    lines,
    methods,
    text: () => lines.map((a) => a[0]).join('\n'),
    restore: () => {
      Object.assign(console, real);
    },
  };
}

globalThis.chrome = {
  runtime: { getManifest: () => ({ version: '9.9.9' }) },
  tabs: { query: async () => [{ id: 7, windowId: 42 }] },
};

console.log('signature.js — the banner');

{
  delete globalThis.__UQA_SIGNED;
  const cap = capture();
  const first = signConsole({ version: '9.9.9', sessionId: 's_abc', armedWindows: [1, 2] });
  const second = signConsole({ version: '9.9.9' });
  cap.restore();
  const text = cap.text();

  await test('it prints once and only once per worker lifetime', () => {
    assert.equal(first, true, 'the first call should print');
    assert.equal(second, false, 'a second call must not — MV3 wakes this worker constantly');
  });

  await test('it names the product, the owner and the real build', () => {
    assert.match(text, new RegExp(MAKER.product));
    assert.match(text, new RegExp(MAKER.owner));
    assert.match(text, /9\.9\.9/, 'the version must be the one passed in, not a literal');
  });

  await test('it says what the worker is actually doing', () => {
    assert.match(text, /recording s_abc/, 'an active session should be named');
    // Counted and agreeing: the banner said "2 window(s)" until 6 September.
    assert.match(text, /awake in 2 windows\b/, 'the armed windows should be counted, and the noun should agree');
    assert.ok(!/\(s\)/.test(text), 'no bracketed plural in a line a developer reads');
  });

  await test('an idle worker says idle rather than nothing', () => {
    delete globalThis.__UQA_SIGNED;
    const c2 = capture();
    signConsole({ version: '1.0.0', sessionId: null, armedWindows: [] });
    c2.restore();
    assert.match(c2.text(), /idle/);
    assert.match(c2.text(), /asleep everywhere/);
  });

  await test('nothing is printed at a level that could read as a fault', () => {
    // console.log only. A banner on warn or error pollutes a filtered view and
    // looks like a problem the moment anybody opens DevTools.
    assert.ok(cap.lines.length >= 6, 'expected the plate, the tape, the facts line and the toolbox');
    assert.deepEqual([...new Set(cap.methods)].sort(), ['groupCollapsed', 'groupEnd', 'log'], 'log and a collapsed group only');
  });

  await test('every %c has its CSS, and the Evidence Tag is one plate, one tape, one facts line', () => {
    for (const [fmt, ...css] of cap.lines) assert.equal((fmt.match(/%c/g) || []).length, css.length, fmt);
    assert.ok(cap.lines[0][1].includes('background:url('), 'the plate is a real image behind the first line');
    assert.match(text, /EVERY FAILURE, TRACED\./);
    for (const label of ['BUILD', 'AT BOOT', 'QAW1']) assert.ok(text.includes(label), label);
    assert.ok(!/hazard|repeating-linear/.test(JSON.stringify(cap.lines)), 'no hazard stripes: Petra is the tape alone');
    assert.ok(!/poke at it/.test(text), 'the old list heading must not come back');
    assert.ok(!/Thmanyah|Cairo/.test(JSON.stringify(cap.lines).replace(/'Thmanyah Sans',ui-sans-serif,system-ui,sans-serif/g, '')) , 'Thmanyah only, with a generic fallback');
  });
}

{
  await test('the helpers say await where the call is async, and the title counts them', () => {
    delete globalThis.__UQA_SIGNED;
    const cap = capture();
    signConsole({ version: '1.0.0' });
    cap.restore();
    assert.match(cap.text(), /await qaw\.state\(\)/);
    const listed = cap.lines.filter((l) => /qaw\.\w+\((text)?\)/.test(l[0])).length;
    assert.match(cap.text(), new RegExp(`helpers \\(${listed}\\)`), 'the count in the title is the count listed');
  });

  await test('Arabic gets the brand tagline and no letter-spacing', () => {
    const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'ar' }, configurable: true });
    const all = JSON.stringify(tagCalls({ version: '1.0.0' }));
    if (was) Object.defineProperty(globalThis, 'navigator', was); else delete globalThis.navigator;
    assert.ok(all.includes('كل خطأ، وأثره.'), 'the brand line, not a console-only variant');
    assert.ok(!/letter-spacing/.test(all), 'tracking breaks Arabic joins');
  });
}

console.log('\nsignature.js — the console handle');

{
  const handlers = {
    UQA_GET_STATE: async () => ({ recording: true, session: { id: 's_1' } }),
    UQA_LIST_SESSIONS: async () => [
      { id: 's_1', charter: 'One', startedAt: Date.parse('2026-08-28T10:00:00Z'), status: 'stopped' },
    ],
    UQA_PING: async () => ({}),
  };
  const armedSet = new Set();
  const armed = {
    arm: async (id) => armedSet.add(id),
    armedWindows: async () => [...armedSet],
    disarmAll: async () => armedSet.clear(),
  };
  const sessionState = { getUsed: async () => ({ shot: { count: 3 } }) };

  const api = installConsoleApi({ handlers, sessionState, armed });

  await test('it is reachable as `qaw`, which is what the banner promises', () => {
    assert.equal(globalThis.qaw, api);
  });

  await test('the retired `njb` handle still answers, so an old snippet keeps working', () => {
    assert.equal(globalThis.njb, api);
  });

  await test('every command the banner lists actually exists', () => {
    // The banner is source, so this reads the banner rather than a second list.
    delete globalThis.__UQA_SIGNED;
    const cap = capture();
    signConsole({ version: '1.0.0' });
    cap.restore();
    const advertised = [...cap.text().matchAll(/qaw\.(\w+)\(\)/g)].map((m) => m[1]);
    assert.ok(advertised.length >= 5, `only ${advertised.length} commands advertised`);
    for (const name of advertised) {
      assert.equal(typeof api[name], 'function', `qaw.${name}() is advertised and does not exist`);
    }
    assert.ok(!/\bnjb\./.test(cap.text()), 'the banner must not teach the retired handle');
  });

  await test('sessions() answers in a shape a person can read', async () => {
    const list = await api.sessions();
    assert.equal(list.length, 1);
    assert.equal(list[0].when, '2026-08-28 10:00', 'an ISO string with a T in it is not for humans');
  });

  await test('handlers() lists what the worker really answers to', async () => {
    const names = api.handlers();
    assert.ok(names.includes('UQA_GET_STATE'));
    assert.deepEqual(names, [...names].sort(), 'sorted, or it is a wall');
  });

  await test('wake() arms the window the tester is looking at', async () => {
    const said = await api.wake();
    assert.match(said, /42/);
    assert.deepEqual(await armed.armedWindows(), [42]);
  });

  await test('help() prints the card again with the live state, though the boot print is guarded', async () => {
    const cap = capture();
    await api.help();
    cap.restore();
    assert.match(cap.text(), /NOW/);
    assert.match(cap.text(), /recording s_1/);
  });

  await test('sleep() puts them all back, and says how many', async () => {
    const said = await api.sleep();
    assert.match(said, /1 window/);
    assert.deepEqual(await armed.armedWindows(), []);
  });

  await test('about carries the build, not a hardcoded version', () => {
    assert.equal(api.about.build, '9.9.9');
    assert.equal(api.about.owner, MAKER.owner);
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
