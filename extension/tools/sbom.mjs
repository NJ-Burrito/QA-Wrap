/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * CycloneDX 1.5 SBOM, on request from a procurement questionnaire (T-074).
 *
 *   node tools/sbom.mjs [out.json]      default: dist/sbom-<version>.cdx.json
 *
 * Shipped components (what is in the zip): the extension itself, axe-core (vendor/axe.min.js) and the font
 * families ui/fonts.css embeds. Dev tools are listed with scope "excluded": build-only, none of them ships.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './lib-brand.mjs';
import { DIST } from './lib-paths.mjs';
import { sha256 } from './lib-release-guard.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildSbom(ext = EXT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ext, 'package.json'), 'utf8'));
  const axe = fs.readFileSync(path.join(ext, 'vendor', 'axe.min.js'));
  const axeVer = (fs.readFileSync(path.join(ext, 'vendor', 'README.md'), 'utf8').match(/axe-core@([\d.]+)/) || [])[1];
  const families = [...new Set([...fs.readFileSync(path.join(ext, 'ui', 'fonts.css'), 'utf8').matchAll(/-family:\s*'([^']+)'/g)].map((m) => m[1]))];
  const comp = (type, name, version, scope, extra = {}) => ({ type, name, ...(version ? { version } : {}), scope, ...extra });
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: { component: comp('application', manifest.name, manifest.version, 'required', { supplier: { name: BRAND.publisher.en } }) },
    components: [
      comp('library', 'axe-core', axeVer, 'required', { licenses: [{ license: { id: 'MPL-2.0' } }], hashes: [{ alg: 'SHA-256', content: sha256(axe) }], purl: `pkg:npm/axe-core@${axeVer}` }),
      ...families.map((f) => comp('data', `font family ${f}`, null, 'required', { description: 'embedded by ui/fonts.css; terms in NOTICE' })),
      ...Object.entries(pkg.devDependencies || {}).map(([n, v]) => comp('library', n, v.replace(/^[\^~]/, ''), 'excluded', { description: 'build-only; not in the package' })),
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sbom = buildSbom();
  const out = process.argv[2] || path.join(DIST, `sbom-${sbom.metadata.component.version}.cdx.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(sbom, null, 2)}\n`);
  console.log(`wrote ${out} (${sbom.components.length} components)`);
}
