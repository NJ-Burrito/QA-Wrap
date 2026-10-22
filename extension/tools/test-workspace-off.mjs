/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** T-045: team workspaces are gated off. The worker never imports core/workspace.js and every join door refuses. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workerSrc } from './lib-worker-src.mjs';

const sw = workerSrc();
let failed = 0;
const test = (n, f) => { try { f(); console.log(`  ok  ${n}`); } catch (e) { failed++; console.log(`  FAIL ${n}\n       ${e.message}`); } };

test('the worker does not import core/workspace.js', () => assert.ok(!/core\/workspace\.js/.test(sw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))));
test('join, preview and export refuse', () => {
  for (const k of ['UQA_WORKSPACE_JOIN', 'UQA_WORKSPACE_PREVIEW', 'UQA_WORKSPACE_EXPORT'])
    assert.ok(sw.includes(`${k}: () => { throw new Error(WORKSPACES_OFF); }`), k);
});
test('no handler applies an imported workspace to settings', () => assert.ok(!/importWorkspace|parsed\.settings/.test(sw)));
test('the module is kept on disk (gated, not deleted)', () => assert.ok(readFileSync(new URL('../core/workspace.js', import.meta.url), 'utf8').length > 1000));
console.log(`\n${4 - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
