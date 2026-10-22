/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-030: the two Chrome 155 policy refusals are named, coded and localised.
 *
 *   node tools/test-policy-refusals.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { policyRefusal } from '../background/whitebox.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const cat = (l) => JSON.parse(read(`platform/i18n/${l}.json`));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

console.log('policy refusals (Chrome 155)');

test('each raw Chrome string maps to its code and catalog key', () => {
  assert.equal(policyRefusal('Host access is restricted by policy.').code, 'POLICY_HOSTS');
  assert.equal(policyRefusal('Error: Screenshot capture is restricted by policy.').code, 'POLICY_SCREENSHOT');
  assert.equal(policyRefusal('Host access is restricted by policy.').key, 'common.worker.policy.hosts');
  assert.equal(policyRefusal('Screenshot capture is restricted by policy.').key, 'common.worker.policy.screenshot');
});

test('other refusals are not mistaken for policy', () => {
  for (const s of ['Cannot attach to this target.', 'MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded', 'restricted', '', undefined]) {
    assert.equal(policyRefusal(s), null, String(s));
  }
});

test('the localised text exists in English and Arabic, names the organisation and differs by language', () => {
  for (const code of ['hosts', 'screenshot']) {
    const k = `common.worker.policy.${code}`;
    assert.match(cat('en')[k], /Turned off by your organisation/);
    assert.match(cat('ar')[k], /[؀-ۿ]{3}/);
    assert.notEqual(cat('en')[k], cat('ar')[k]);
    assert.match(cat('ar')[k], /مسؤول/, 'Arabic gives the next step');
    assert.match(cat('en')[k], /IT administrator/, 'English gives the next step');
  }
});

test('the worker answers a policy refusal with the code and the tester\'s language, and the debugger path lets it through', () => {
  const sw = read('background/service-worker.js');
  assert.ok(/whitebox\.policyRefusal\(err\?\.message\)/.test(sw));
  assert.ok(/await tw\(p\.key, p\.en\)/.test(sw) && /code: p\.code/.test(sw));
  assert.ok(/if \(policyRefusal\(err\.message\)\) throw err;/.test(read('background/whitebox.js')), 'not swallowed by the generic debugger refusal');
});

test('r1-03-1 / D-1010-18: the Mattermost refusals reuse existing strings, in both languages, and add no key', () => {
  const src = read('platform/chat-mattermost.js');
  const used = [...src.matchAll(/'((?:api|report|common|options|popup)\.[\w.]+)'/g)].map((m) => m[1]);
  for (const k of ['api.err.policy', 'report.f.secretOne', 'report.f.secretMany']) assert.ok(used.includes(k), `${k} is used`);
  for (const k of used) for (const l of ['en', 'ar']) assert.ok(cat(l)[k], `${k} missing in ${l}`);
  assert.match(cat('en')['api.err.policy'], /Turned off by your organisation/);
});

test('H1: the raw Profiler JSON from chrome.debugger becomes a short localised sentence, never JSON', () => {
  const raw = '{"code":-32601,"message":"\'Profiler.enable\' wasn\'t found"}';
  const p = policyRefusal(raw);
  assert.equal(p.code, 'COVERAGE_UNAVAILABLE');
  assert.equal(p.key, 'common.worker.coverage.unavailable');
  assert.equal(policyRefusal('{"code":-32000,"message":"Not allowed"}').code, 'DEBUGGER_REFUSED');
  assert.equal(policyRefusal('{"code":-32601,"message":"\'Page.reload\' wasn\'t found"}').code, 'DEBUGGER_REFUSED', 'only the Profiler domain means coverage is blocked');
  for (const key of ['common.worker.coverage.unavailable', 'common.worker.debugger.refused']) {
    for (const l of ['en', 'ar']) {
      const text = cat(l)[key];
      assert.ok(text && !/[{}]|"code"/.test(text), `${key} ${l}`);
      assert.ok(text.trim().split(/\s+/).length <= 8, `${key} ${l} is at most 8 words: ${text}`);
    }
    assert.match(cat('ar')[key], /[؀-ۿ]{3}/);
    assert.notEqual(cat('en')[key], cat('ar')[key]);
  }
});

console.log(`\n${passed} passed, 0 failed`);
