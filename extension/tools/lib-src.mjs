/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * lib-src.mjs: the text of a surface's script, wherever its code lives (1014 B3 step 7).
 *
 * popup.js and report.js are split into sibling scripts that share one global scope (the page loads them
 * as classic scripts). A test that reads the popup or the report as text asks for `surfaceSource(file)`
 * and gets the main file followed by its siblings, so a needle still finds the code, not the file it
 * happens to sit in. Any other file is returned as it is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The main file, then the siblings cut out of it. Keep in step with the <script> order of the page. */
export const SPLIT = {
  'popup/popup.js': ['popup/tool-actions.js', 'popup/tool-rows.js', 'popup/viewport.js'],
  'report/report.js': ['report/quality.js', 'report/sizes.js'],
};

export function surfaceSource(file, ext = EXT) {
  const parts = [file, ...(SPLIT[file] || [])];
  return parts.map((f) => fs.readFileSync(path.join(ext, f), 'utf8')).join('\n');
}
