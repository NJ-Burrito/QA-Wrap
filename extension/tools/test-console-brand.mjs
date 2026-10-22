/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// The console voice: one banner per context, styled chip, caller arguments untouched, absent from content scripts.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const calls = [];
const real = { info: console.info, warn: console.warn };
console.info = (...a) => calls.push(['info', a]);
console.warn = (...a) => calls.push(['warn', a]);
await import('../platform/console-brand.js');
const Q = globalThis.QAConsole;
Q.banner('service worker'); Q.banner('service worker'); Q.banner('devtools panel');
const err = new Error('boom');
Q.warn('a batch could not be stored:', err);
console.info = real.info; console.warn = real.warn;

let n = 0;
let ok = true;
const t = (name, fn) => {
  try { fn(); n++; console.log('  ok  ' + name); } catch (e) { ok = false; console.log('  FAIL ' + name + '\n       ' + e.message); }
};
t('one banner per context', () => assert.equal(calls.filter((c) => c[0] === 'info').length, 2));
t('banner has one CSS entry per %c', () => {
  const [f, ...css] = calls[0][1];
  assert.equal((f.match(/%c/g) || []).length, css.length);
  assert.ok(f.includes('QA Wrap') && f.includes('service worker'));
});
t('warn: chip first, caller args untouched', () => {
  const a = calls.find((c) => c[0] === 'warn')[1];
  assert.ok(a[0].includes('QA Wrap'));
  assert.equal(a[3], 'a batch could not be stored:');
  assert.equal(a[4], err);
});
t('no content script loads or mentions it', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const js = (m.content_scripts || []).flatMap((c) => c.js || []);
  assert.ok(!js.some((f) => f.includes('console-brand')));
  for (const f of js) assert.ok(!fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').includes('QAConsole'), f);
});
t('no watermark code in capture, screenshot or recording paths', () => {
  for (const f of ['background/media.js', 'background/capture.js', 'offscreen/offscreen.js']) {
    try { assert.ok(!/QAConsole|console-brand|watermark/i.test(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')), f); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
});
console.log(`\n${n} passed`);
if (!ok) process.exit(1);
console.log('test-console-brand: PASS');
