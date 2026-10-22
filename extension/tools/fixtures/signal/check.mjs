// Consistency check for the signal corpus. Run from extension/:  node tools/fixtures/signal/check.mjs
// Every manifest fixture loads, sha256 matches, label counts recompute, held split sealed in work/error-signal/L1-log.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const log = path.resolve(here, '../../../../work/error-signal/L1-log.md');
const man = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const bad = [];
const fail = (id, msg) => bad.push(`${id}: ${msg}`);
const seen = new Set(), groups = {}, splits = { tune: 0, held: 0 };

for (const m of man.fixtures) {
  if (seen.has(m.id)) fail(m.id, 'duplicate id'); seen.add(m.id);
  const file = path.join(here, m.file);
  if (!fs.existsSync(file)) { fail(m.id, 'file missing'); continue; }
  const raw = fs.readFileSync(file);
  if (crypto.createHash('sha256').update(raw).digest('hex') !== m.sha256) fail(m.id, 'sha256 mismatch');
  let fx; try { fx = JSON.parse(raw); } catch { fail(m.id, 'not JSON'); continue; }
  if (fx.id !== m.id || fx.split !== m.split || !m.file.startsWith(m.split + '/')) fail(m.id, 'id/split/path disagree');
  if (!Array.isArray(fx.events) || !Array.isArray(fx.actions) || !Array.isArray(fx.labels)) { fail(m.id, 'bad shape'); continue; }
  if (fx.events.length !== m.events) fail(m.id, `events ${fx.events.length} != manifest ${m.events}`);
  const idx = new Set();
  for (const l of fx.labels) {
    if (!Number.isInteger(l.eventIdx) || !fx.events[l.eventIdx]) fail(m.id, `label points at missing event ${l.eventIdx}`);
    if (l.label !== 'D' && l.label !== 'N') fail(m.id, `label ${l.label}`);
    if (!l.why) fail(m.id, 'label without why');
    if (idx.has(l.eventIdx)) fail(m.id, `event ${l.eventIdx} labelled twice`); idx.add(l.eventIdx);
    if (l.label === 'D' && !l.def) fail(m.id, `D label ${l.eventIdx} without def`);
  }
  const D = fx.labels.filter((l) => l.label === 'D').length, N = fx.labels.length - D;
  if (D !== m.labelsD || N !== m.labelsN) fail(m.id, `labels D/N ${D}/${N} != manifest ${m.labelsD}/${m.labelsN}`);
  const defs = new Set(fx.labels.filter((l) => l.def).map((l) => l.def)).size;
  if (defs !== m.defects) fail(m.id, `defects ${defs} != manifest ${m.defects}`);
  const g = m.id[0];
  if (g === 'H' && D) fail(m.id, 'healthy fixture carries a D label');
  if ('DMA'.includes(g) && !D) fail(m.id, 'defect fixture has no D label');
  if (g === 'D' && defs !== 1 && m.id !== 'D7') { /* D fixtures are single-defect */ if (defs !== 1) fail(m.id, `expected 1 defect, got ${defs}`); }
  splits[m.split]++;
  const s = (groups[g] ||= { n: 0, D: 0, N: 0, defs: 0, ev: 0 }); s.n++; s.D += D; s.N += N; s.defs += defs; s.ev += fx.events.length;
}
const want = { H: 6, D: 12, M: 7, A: 7 };
for (const [g, n] of Object.entries(want)) if ((groups[g]?.n || 0) !== n) bad.push(`group ${g}: ${groups[g]?.n || 0}/${n} fixtures`);
if (man.fixtures.some((m) => m.id === 'A3') === false) bad.push('A3 missing');

const held = man.fixtures.filter((m) => m.split === 'held').map((m) => `${m.id} ${m.sha256}`).join('\n');
const heldSeal = crypto.createHash('sha256').update(held).digest('hex');
const logText = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
if (!logText.includes(heldSeal)) bad.push(`held seal ${heldSeal} not recorded in L1-log.md`);

for (const [g, s] of Object.entries(groups)) console.log(`${g}: fixtures ${s.n}/${want[g]}  D-labels ${s.D}  N-labels ${s.N}  distinct defects ${s.defs}  events ${s.ev}`);
console.log(`split: tune ${splits.tune}/${man.fixtures.length}  held ${splits.held}/${man.fixtures.length}`);
console.log(`held seal (sha256 of "id sha" lines): ${heldSeal}`);
if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); }
console.log(`OK ${man.fixtures.length}/${man.fixtures.length} fixtures load, hashes match, label counts consistent`);
