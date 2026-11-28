/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * lib-src.mjs: the text of a surface's script, wherever its code lives (1014 B3 step 7).
 *
 * popup.js and report.js are split into sibling scripts that share one global scope (the page loads them
 * as classic scripts); offscreen.js and options.js are split into sibling modules, and popup.css, report.css into
 * sibling sheets (the QW-split run). A test that reads the popup or the report as text asks for `surfaceSource(file)`
 * and gets the main file followed by its siblings, so a needle still finds the code, not the file it
 * happens to sit in. Any other file is returned as it is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The main file, then the siblings cut out of it. Keep in step with the <script>/<link> order of the page (modules: the import order is not load order, but a needle only cares that the text is there). */
export const SPLIT = {
  'popup/popup.js': ['popup/popup-session.js', 'popup/popup-panels.js', 'popup/popup-tools.js', 'popup/popup-switch.js', 'popup/popup-notes.js', 'popup/tool-actions.js', 'popup/tool-rows.js', 'popup/viewport.js'],
  'report/report.js': ['report/report-chains.js', 'report/report-media.js', 'report/report-save.js', 'report/report-boot.js', 'report/quality.js', 'report/sizes.js'],
  'offscreen/offscreen.js': ['offscreen/offscreen-base.js', 'offscreen/offscreen-composite.js', 'offscreen/offscreen-gif.js', 'offscreen/offscreen-image.js', 'offscreen/offscreen-libs.js'],
  'options/options.js': ['options/options-state.js', 'options/options-base.js', 'options/options-panels.js', 'options/options-paint.js'],
  'popup/popup.css': ['popup/popup-tools.css', 'popup/popup-rows.css', 'popup/popup-chrome.css'],
  'report/report.css': ['report/report-quality.css'],
};

export function surfaceSource(file, ext = EXT) {
  file = file.replace(/^\.\.\//, ''); // tests that read relative to tools/ name it '../popup/popup.js'
  const parts = [file, ...(SPLIT[file] || [])];
  return parts.map((f) => fs.readFileSync(path.join(ext, f), 'utf8')).join('\n');
}
