/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Recorder disk failure is warned once and bounded; audio errors are real; pre-roll label (devil 17).  node tools/test-devil-f.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { partWriter } from '../offscreen/part-writer.js';
import { decodeFailure, encodeWav } from '../offscreen/wav.js';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };
const blob = (size) => ({ size });

await test('a rejected write warns once and falls back to RAM in order', async () => {
  let fails = 0, warned = 0;
  const w = partWriter({ put: async () => { fails++; throw new Error('QuotaExceeded'); }, onFail: () => warned++ });
  for (let i = 0; i < 5; i++) w.add(blob(10), i);
  await w.chain;
  assert.equal(warned, 1);
  assert.equal(fails, 1, 'no further disk attempts once it has failed');
  assert.equal(w.chunks.length, 5);
  assert.match(w.error.message, /Quota/);
});

await test('the RAM fallback is capped: onCap fires once at the limit', async () => {
  let capped = 0;
  const w = partWriter({ put: async () => { throw new Error('x'); }, onCap: () => capped++, capBytes: 25 });
  for (let i = 0; i < 6; i++) w.add(blob(10), i);
  await w.chain;
  assert.equal(capped, 1);
  assert.equal(w.capped, true);
});

await test('healthy disk: nothing warned, nothing held', async () => {
  let warned = 0;
  const w = partWriter({ put: async () => {}, onFail: () => warned++ });
  w.add(blob(10), 0);
  await w.chain;
  assert.equal(warned + w.chunks.length, 0);
});

await test('decode failure states the real error, not just "no sound"', () => {
  const oom = decodeFailure(Object.assign(new RangeError('Array buffer allocation failed'), {}));
  assert.match(oom.message, /RangeError: Array buffer allocation failed/);
  assert.doesNotMatch(oom.message, /no sound/i);
  const enc = decodeFailure(Object.assign(new Error('Unable to decode audio data'), { name: 'EncodingError' }));
  assert.match(enc.message, /EncodingError: Unable to decode/);
});

await test('windowed WAV equals a single pass', async () => {
  const data = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7));
  const audio = { numberOfChannels: 1, sampleRate: 8000, length: 1000, getChannelData: () => data };
  const a = Buffer.from(await encodeWav(audio, 64).arrayBuffer());
  const b = Buffer.from(await encodeWav(audio, 1 << 20).arrayBuffer());
  assert.equal(a.length, 44 + 2000);
  assert.ok(a.equals(b));
  assert.equal(a.readUInt32LE(40), 2000);
});

await test('offscreen wires the writer, the warning and the cap; report renders the pre-roll label', () => {
  const off = fs.readFileSync(new URL('../offscreen/offscreen.js', import.meta.url), 'utf8');
  assert.ok((off.match(/partWriter\(/g) || []).length === 2 && off.includes("reason: 'ram-cap'") && off.includes("reason: 'disk-warn'"));
  const rep = fs.readFileSync(new URL('../report/report.js', import.meta.url), 'utf8');
  assert.match(rep, /if \(ev\.preRoll\) body\.append\(el\('span', 'ev-preroll', t\('report\.ev\.preRoll'\)\)\)/);
  for (const c of ['en', 'ar']) assert.ok(JSON.parse(fs.readFileSync(new URL(`../platform/i18n/${c}.json`, import.meta.url), 'utf8'))['report.ev.preRoll']);
});

console.log(`\n${n} passed, 0 failed`);
