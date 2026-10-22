/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * OF-1 click modifiers survive ingest; OF-2 the worker error reply forwards retryMs;
 * OF-3 (closed) nested fineprint leaves are in the deep scrub.
 *
 *   node tools/test-of-a-ingest.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitiseEvent } from '../core/events.js';
import { localizeError } from '../platform/worker-errors.js';
import { workerSrc } from './lib-worker-src.mjs';

const san = (raw) => sanitiseEvent(raw, { frameUrl: 'https://a.test/', now: 1_700_000_000_000 });
assert.deepEqual(san({ kind: 'dom', action: 'click', mods: ['Shift'] }).mods, ['Shift'], 'Shift survives');
assert.deepEqual(san({ kind: 'dom', action: 'dblclick', mods: ['Meta', 'Control', 'x'] }).mods, ['Control', 'Meta'], 'only the four known names, in a fixed order');
assert.equal('mods' in san({ kind: 'dom', action: 'click', mods: 'Shift' }), false, 'a non-array is dropped');
assert.equal('mods' in san({ kind: 'dom', action: 'click', mods: [] }), false, 'an empty list is dropped');
assert.equal('mods' in san({ kind: 'note', text: 'x', mods: ['Shift'] }), false, 'other kinds do not gain the field');
console.log('  ok  OF-1: mods survive sanitiseEvent (5 checks)');

const sw = workerSrc();
assert.match(sw, /code: err\.code, data: err\.data, retryMs: err\.retryMs/, 'the error reply carries retryMs');
const t = (key, v) => `${key}${v ? JSON.stringify(v) : ''}`;
assert.match(localizeError({ ok: false, error: 'Wrong passphrase.', code: 'VAULT_BACKOFF', retryMs: 4200 }, t, 'en'), /"secs":5/, 'a forwarded retryMs reaches the sentence as seconds');
console.log('  ok  OF-2: retryMs is forwarded and read (2 checks)');

assert.match(sw, /const SCRUB_DEEP = \[[^\]]*'checks'[^\]]*'manual'/, 'checks and manual are scrubbed to the leaf');
console.log('  ok  OF-3: closed, SCRUB_DEEP covers checks/manual (test-ingest.mjs:460 proves a secret is cleaned)');
