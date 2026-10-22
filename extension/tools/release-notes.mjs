/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The release notes of one version, cut out of CHANGELOG.md by script (no model).
 *
 *   node tools/release-notes.mjs v3.5.3 [CHANGELOG.md]     prints the section body; exit 1 if the version has none
 *
 * A section starts at `## <version>` (optionally followed by `, date`) and ends before the next `## ` heading.
 * Used by .github/workflows/release.yml, and runnable by hand to preview what a release will say.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @returns {string|null} the section (heading line dropped, trimmed), or null when the version is absent or empty. */
export function extractNotes(changelog, version) {
  const v = String(version).trim().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(v)) return null;
  const lines = String(changelog).replace(/\r\n?/g, '\n').split('\n');
  const head = new RegExp(`^##\\s+v?${v.replace(/\./g, '\\.')}(?:\\s*[,(–-].*|\\s*)$`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md')] = process.argv.slice(2);
  const notes = version && fs.existsSync(file) ? extractNotes(fs.readFileSync(file, 'utf8'), version) : null;
  if (!notes) { console.error(`release-notes: no CHANGELOG section for ${version || '(no version given)'} in ${file}`); process.exit(1); }
  process.stdout.write(`${notes}\n`);
}
