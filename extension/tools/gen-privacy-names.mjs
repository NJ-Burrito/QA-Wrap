/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * core/privacy-names.json is the one list of secret-looking field names. The MAIN-world
 * page-hooks, the recorder and the replay recorder cannot import it, so the same block is generated into each
 * file between the markers below. `node tools/gen-privacy-names.mjs` rewrites; `--check`
 * (what test-privacy-contract runs) fails on drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '/* privacy-names:begin (generated from core/privacy-names.json; do not edit) */';
const END = '/* privacy-names:end */';
export const TARGETS = [
  { file: 'content/page-hooks.js', ex: '' },
  { file: 'content/recorder.js', ex: '' },
  { file: 'content/replay-recorder.js', ex: '' },
];

export function block(ex) {
  const { names } = JSON.parse(fs.readFileSync(path.join(EXT, 'core/privacy-names.json'), 'utf8'));
  return `${BEGIN}\nconst SECRET_NAMES = new Set(${JSON.stringify(names)});\n${ex}const isSecretName = (name) => { const t = String(name).replace(/([a-z\\d])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z\\d\\u0600-\\u06ff]+/).filter(Boolean); return t.some((w, i) => SECRET_NAMES.has(w) || (i > 0 && SECRET_NAMES.has(t[i - 1] + w))); };\n${END}`;
}

const re = /\/\* privacy-names:begin[\s\S]*?\/\* privacy-names:end \*\//;

export function sync({ check = false } = {}) {
  const drift = [];
  for (const { file, ex } of TARGETS) {
    const p = path.join(EXT, file);
    const src = fs.readFileSync(p, 'utf8');
    if (!re.test(src)) { drift.push(`${file}: no marker block`); continue; }
    const next = src.replace(re, () => block(ex));
    if (next !== src) { drift.push(file); if (!check) fs.writeFileSync(p, next); }
  }
  return drift;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const drift = sync({ check: process.argv.includes('--check') });
  console.log(drift.length ? `privacy-names: ${process.argv.includes('--check') ? 'DRIFT' : 'updated'} ${drift.join(', ')}` : 'privacy-names: in sync');
  if (drift.length && process.argv.includes('--check')) process.exit(1);
}
