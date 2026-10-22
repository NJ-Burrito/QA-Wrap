/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-058: what the listing pictures were shot from. A hash of every file in the surfaces the shots show
 * (line endings normalised), written next to the shots by `store-shots.mjs` and checked by
 * `test-listing-assets.mjs`. Not an mtime: a fresh checkout resets those, and `content/` (the bar and
 * the palette), `report/` and `replay/` used to be outside the check.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SHOT_SURFACES = ['ui', 'popup', 'content', 'report', 'replay', 'annotate'];
export const SHOTS_SOURCE_FILE = path.join('store', 'shots-source.json');

export function sourceHash(ext) {
  const h = crypto.createHash('sha256');
  for (const dir of SHOT_SURFACES) {
    const walk = (d) => fs.readdirSync(path.join(ext, d), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((e) => {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) return walk(rel);
      h.update(rel).update(fs.readFileSync(path.join(ext, rel), 'utf8').replace(/\r\n/g, '\n'));
    });
    walk(dir);
  }
  return h.digest('hex');
}
