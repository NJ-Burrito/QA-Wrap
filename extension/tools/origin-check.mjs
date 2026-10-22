/* QA Wrap: the Origin check. `node tools/origin-check.mjs <file> [sha256-from-the-session-card]` */
import { readFileSync } from 'node:fs';
import { originCheck } from '../core/integrity.js';

const [file, sha256] = process.argv.slice(2);
if (!file) { console.error('usage: node tools/origin-check.mjs <file> [sha256]'); process.exit(2); }
const r = await originCheck(readFileSync(file), { sha256 });
console.log(`${r.status}: ${file}`);
process.exit(r.status === 'content changed' ? 1 : 0);
