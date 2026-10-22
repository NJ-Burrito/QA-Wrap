/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Disk warning reaches the popup/side panel; worker strings go through the catalog.  node tools/test-devil-r2-c2.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { workerSrc } from './lib-worker-src.mjs';
const sw = workerSrc();
const pj = fs.readFileSync('popup/popup.js', 'utf8');
const ph = fs.readFileSync('popup/popup.html', 'utf8');
const loc = { en: JSON.parse(fs.readFileSync('platform/i18n/en.json', 'utf8')), ar: JSON.parse(fs.readFileSync('platform/i18n/ar.json', 'utf8')) };
const keys = ['popup.record.diskWarn', 'common.worker.disk.title', 'common.worker.disk.body', 'common.worker.clip.failed', 'common.worker.clip.ramCap', 'common.worker.clip.gifFull', 'common.worker.clip.sharingStopped'];
for (const k of keys) { assert.ok(loc.en[k] && loc.ar[k], k); assert.ok(sw.includes(`'${k}'`) || pj.includes(k) || ph.includes(k), `${k} used`); }
assert.ok(!/label = msg\?\.failed\s*\?\s*'/.test(sw), 'clip labels are no longer literals');
assert.ok(sw.includes("[DISK_WARN]: true") && sw.includes('diskWarn: true'), 'worker exposes the flag via UQA_RECORD_STATE');
assert.ok(pj.includes('r.result?.diskWarn') && pj.includes('state.result?.diskWarn'), 'popup paints it');
assert.ok(ph.includes('id="disk-warn"'));
console.log('  ok  disk warning + catalog strings');
