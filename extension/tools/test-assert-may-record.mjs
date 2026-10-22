/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-042: `assertMayRecord`, the consent revision, and the sender's window.
 *
 *   node tools/test-assert-may-record.mjs
 *
 * Behaviour is run against the real background/armed.js with a fake chrome;
 * the worker's wiring (ingest, UQA_ARM, the write doors) is asserted against
 * the source, as test-handlers.mjs does, because the worker cannot be imported.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

function fakeChrome({ local = {}, armedWindows = [] } = {}) {
  const session = new Map([['armedWindows', armedWindows]]);
  const tabs = { 11: { id: 11, windowId: 1 }, 22: { id: 22, windowId: 2 } };
  globalThis.chrome = {
    runtime: { id: 't', getURL: (p) => p },
    storage: {
      session: {
        get: async (k) => ({ [k]: session.get(k) }), set: async (o) => { for (const [k, v] of Object.entries(o)) session.set(k, v); },
        remove: async (k) => { session.delete(k); }, onChanged: { addListener() {} },
      },
      local: { get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in local).map((k) => [k, local[k]])) },
    },
    tabs: { get: async (id) => tabs[id] || null, onRemoved: { addListener() {} }, onAttached: { addListener() {} }, onDetached: { addListener() {} }, onReplaced: { addListener() {} } },
    windows: { onRemoved: { addListener() {} } },
  };
  return import(`../background/armed.js?x=${Math.random()}`).then((m) => { m.watchWindows?.(); return m; });
}

await t('arm() refuses with NEEDS_CONSENT until consent is recorded', async () => {
  const armed = await fakeChrome({ local: {} });
  await assert.rejects(() => armed.arm(1), (e) => e.code === 'NEEDS_CONSENT');
});

await t('a consent from before revisions counts as revision 1; a bump refuses new wakes', async () => {
  const armed = await fakeChrome({ local: { consentedAt: 1 } });
  assert.equal(await armed.consentCurrent(), true);
  const bumped = await fakeChrome({ local: { consentedAt: 1, consentRevision: armed.CONSENT_REVISION - 1 } });
  assert.equal(await bumped.consentCurrent(), false);
  await assert.rejects(() => bumped.assertMayRecord({ windowId: 1 }, { consent: true }), (e) => e.code === 'NEEDS_CONSENT');
});

await t('a revision bump never refuses a live armed tab (new wakes only)', async () => {
  const armed = await fakeChrome({ local: { consentedAt: 1, consentRevision: 0 }, armedWindows: [1] });
  await armed.assertMayRecord({ tab: { id: 11 } }); // resolves
});

await t('a sleeping tab and a tab outside the session are refused with ingest reasons', async () => {
  const armed = await fakeChrome({ local: { consentedAt: 1 }, armedWindows: [1] });
  await assert.rejects(() => armed.assertMayRecord({ tab: { id: 22 } }), (e) => e.reason === 'asleep');
  await assert.rejects(() => armed.assertMayRecord({ tab: { id: 11 } }, { belongs: async () => false }), (e) => e.reason === 'other-tab');
  await armed.assertMayRecord({ tab: { id: 11 } }, { belongs: async () => true });
});

const SW = workerSrc();
const DT = fs.readFileSync(path.join(EXT, 'background', 'dispatch-tables.js'), 'utf8');

await t('two windows: ingest and every tab-bound write resolve the session from the sender', () => {
  assert.match(SW, /async function ingest\(event, sender, preRoll = false\) \{\n  const sessionId = await activeSessionId\(sender\);/);
  assert.match(SW, /UQA_NOTE: \(msg, sender\) => addNote\(msg\.text, msg\.tag, sender\)/);
  assert.match(SW, /UQA_REPLAY_CHUNK: async \(msg, sender\) => \{\n    const sessionId = await activeSessionId\(sender\)/);
  for (const fn of ['captureScreenshot', 'captureFullPage', 'scanAccessibility', 'scanPerformance', 'harvestPage', 'checkFinePrint', 'reverseSpec', 'autofillPage', 'checkLinks']) {
    const from = SW.indexOf(`async function ${fn}(`);
    const rest = SW.slice(from + 1);
    const body = SW.slice(from, from + 1 + rest.search(/\n(?:async )?function /));
    assert.match(body, /activeSessionId\(\{ tabId/, `${fn} files under the sender's window`);
  }
});

await t('ingest, replay chunks and the guard all go through assertMayRecord; UQA_ARM checks consent first', () => {
  assert.equal((SW.match(/armed\.assertMayRecord\(sender/g) || []).length, 3, 'ingest, replay chunk, guardSender');
  assert.match(SW, /assertMayRecord\(\{ windowId \}, \{ consent: true \}\)/);
  assert.match(SW, /armed\.arm\(created\.id, \{ inherit: true \}\)/);
  assert.match(SW, /consentRevision: armed\.CONSENT_REVISION/);
  assert.match(DT, /RECORDING_DOORS = new Set\(\['UQA_EVENT', 'UQA_NOTE', 'UQA_REPLAY_CHUNK', 'UQA_RULE_FIRED'\]\)/);
});

await t('the consent refusal is localised as a key pair', () => {
  for (const l of ['en', 'ar']) {
    assert.ok(JSON.parse(fs.readFileSync(path.join(EXT, 'platform', 'i18n', `${l}.json`), 'utf8'))['common.worker.needsConsent'], l);
  }
});

// Next-review T-042: the unhinted callers. Real activeSessionId / windowOf / hintFor and the real UQA_MASK_GET and
// UQA_API_RECORD source run with two live sessions; a page in window B must see window B's masks and file under B.
await t('two live sessions: mask read and API record go to the sender\'s window, not the last-active one', async () => {
  const cut = (head, tail) => { const a = SW.indexOf(head); assert.ok(a > 0, head); return SW.slice(a, SW.indexOf(tail, a)); };
  const fns = [cut('async function activeSessionId(hint)', '\n}\n') + '\n}', cut('async function windowOf(hint)', '\n}\n') + '\n}', cut('function hintFor(msg, sender)', '\n}\n') + '\n}'].join('\n');
  const maskGet = cut('UQA_MASK_GET: async (msg, sender) =>', '\n  },').replace('UQA_MASK_GET: ', '') + '\n  }';
  const apiRec = cut('UQA_API_RECORD: async (msg, sender) =>', '\n    const { stored'); // only the session line matters here
  assert.match(apiRec, /activeSessionId\(hintFor\(msg, sender\)\)/, 'UQA_API_RECORD hints the sender');
  const chrome = {
    tabs: { get: async (id) => ({ id, windowId: id === 11 ? 1 : 2 }) },
    storage: { session: { get: async (k) => (k === 'last' ? { last: 'A' } : { [k]: k === 'masks:A' ? ['colA'] : ['colB'] }) } },
  };
  const env = { sessionsByWindow: async () => ({ 1: 'A', 2: 'B' }), chrome, ACTIVE: 'last', maskKey: (id) => `masks:${id}` };
  const make = new Function('env', `const { sessionsByWindow, chrome, ACTIVE, maskKey } = env; ${fns}; return { activeSessionId, handler: (${maskGet}) };`);
  const { activeSessionId, handler } = make(env);
  assert.equal(await activeSessionId(), 'A', 'precondition: unhinted falls back to the last-active session');
  assert.deepEqual(await handler({}, { tab: { id: 22 } }), { masks: ['colB'] }, 'a page in window B reads B\'s masks');
  assert.deepEqual(await handler({}, { tab: { id: 11 } }), { masks: ['colA'] }, 'a page in window A reads A\'s masks');
  // no handler of the recording family may fall back unhinted
  for (const name of ['UQA_API_RECORD', 'UQA_OPEN_API', 'UQA_RECORD_START', 'UQA_RECORD_SCREEN', 'UQA_MASK_GET', 'UQA_MASK_CLEAR']) {
    const from = SW.indexOf(`${name}: async (`); assert.ok(from > 0, name);
    const body = SW.slice(from, from + 1500).split(/\n  (?:UQA_|\/\*\*)/)[0];
    assert.ok(!/activeSessionId\(\)/.test(body), `${name} still calls activeSessionId() with no hint`);
  }
});

console.log(`${n} passed`);
