// Prints the visibleProblems summary for event dumps. Run from extension/:
//   node tools/measure-signal.mjs [file.json ...]    (default: the tune split; each file is an events array, {events}, or a fixture)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleProblems, liteCount, RULESET } from '../core/signal.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/signal');
let files = process.argv.slice(2);
if (!files.length) files = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).fixtures.filter((m) => m.split === 'tune').map((m) => path.join(dir, m.file));
console.log(`ruleset v${RULESET}\nname       events failures problems errors warnings notes(hidden) induced lite`);
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const ev = Array.isArray(j) ? j : j.events || [];
  const r = visibleProblems(ev);
  console.log(`${path.basename(f, '.json').padEnd(10)} ${String(ev.length).padStart(6)} ${String(r.failures).padStart(8)} ${String(r.problems).padStart(8)} ${String(r.errors).padStart(6)} ${String(r.warnings).padStart(8)} ${String(r.notes).padStart(13)} ${String(r.induced).padStart(7)} ${String(liteCount(ev)).padStart(4)}  ${JSON.stringify(r.hiding)}`);
}
