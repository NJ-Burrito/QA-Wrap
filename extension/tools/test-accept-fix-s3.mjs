/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** S3: the mask tip is drawn after the worker's strings land.   node tools/test-accept-fix-s3.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lift } from './lib-lift.mjs';

const SRC = fs.readFileSync(new URL('../content/mask.js', import.meta.url), 'utf8');
const build = () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const st = { drawn: [], picking: false, box: null, strings: {} };
  const t = (k, f) => st.strings[k] || f;
  const fn = new Function('window', 'document', 'addEventListener', 'st', 't',
    `let picking = false; let box = null; const asleep = () => false;
     const mount = () => { box = 1; st.drawn.push(t('overlay.mask.tip', 'EN')); };
     const onMove = () => {}, onClick = () => {}, onKey = () => {};
     const stop = () => { picking = false; };
     ${lift(SRC, 'start')}
     return { start, stop };`);
  const win = { UQAUiHost: { claimPointer() {}, assets: () => gate } };
  const doc = { documentElement: { classList: { add() {} } } };
  return { st, release, api: fn(win, doc, () => {}, st, t) };
};

const flush = () => new Promise((r) => setTimeout(r, 0));
let a = build();
a.api.start();
await flush();
assert.deepEqual(a.st.drawn, [], 'nothing drawn before the strings land');
a.st.strings['overlay.mask.tip'] = 'AR';
a.release();
await flush();
assert.deepEqual(a.st.drawn, ['AR'], 'first open draws the Arabic tip');

a = build();
a.api.start();
a.api.stop();
a.release();
await flush();
assert.deepEqual(a.st.drawn, [], 'stop() before the strings land draws nothing');
console.log('  ok  S3 mask tip waits for overlay strings (2 checks)');
