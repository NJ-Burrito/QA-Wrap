/* Applies one of the three glass-plate icon variants (icon-variants.mjs) as
   the product's extension icon: identity/icons/{favicon,app-icon,app-icon-small}.svg.
   Then run `node tools/generate-icons.mjs` from extension/ to re-rasterise.

     node tools/apply-icon-variant.mjs A|B|C
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.resolve(ROOT, '..', 'work', 'ui-rework', 'logo');

const which = (process.argv[2] || '').toUpperCase();
if (!['A', 'B', 'C'].includes(which)) {
  console.error('Usage: node tools/apply-icon-variant.mjs A|B|C');
  process.exit(1);
}

const full = fs.readFileSync(path.join(WORK, which, 'icon.svg'), 'utf8');
const small = fs.readFileSync(path.join(WORK, which, 'icon-small.svg'), 'utf8');

fs.writeFileSync(path.join(ROOT, 'icons', 'app-icon.svg'), full, 'utf8');
fs.writeFileSync(path.join(ROOT, 'icons', 'app-icon-small.svg'), small, 'utf8');
fs.writeFileSync(path.join(ROOT, 'icons', 'favicon.svg'), small, 'utf8');

console.log(`Applied variant ${which}: identity/icons/{app-icon,app-icon-small,favicon}.svg`);
console.log('Now run: (cd extension && node tools/generate-icons.mjs)');
