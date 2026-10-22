/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The service worker's source as one string.
 *
 * OF-18 split `background/service-worker.js` into the entry (listeners, the dispatch seam, boot) and the
 * `background/worker-*.js` and `background/handlers-*.js` modules it imports. The code is the same code, so the suites
 * that read it as text read all of it: entry first, then the modules in alphabetical order.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const WORKER_MODULES = () =>
  fs.readdirSync(path.join(EXT, 'background')).filter((f) => /^(worker-|handlers-).*\.js$/.test(f)).sort();

export const workerSrc = () =>
  [path.join(EXT, 'background', 'service-worker.js'), ...WORKER_MODULES().map((f) => path.join(EXT, 'background', f))]
    .map((f) => fs.readFileSync(f, 'utf8')).join('\n')
    // The text as the one file read before the split: a module boundary is not what the suites assert on.
    .replace(/^export (?=(?:async )?function|const |let )/gm, '');
