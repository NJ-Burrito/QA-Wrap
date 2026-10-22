/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** T-074: SBOM lists shipped vs build-only; store-status is read-only and keeps credentials out of the repo.  node tools/test-vendor-risk.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSbom } from './sbom.mjs';
import { parseEnv, statusUrl, missing, ENV_FILE, NEEDED } from './store-status.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

t('SBOM is CycloneDX with axe and every devDependency marked excluded', () => {
  const s = buildSbom();
  assert.equal(s.bomFormat, 'CycloneDX');
  const axe = s.components.find((c) => c.name === 'axe-core');
  assert.ok(axe.version && /^[0-9a-f]{64}$/.test(axe.hashes[0].content) && axe.scope === 'required');
  const dev = s.components.filter((c) => c.scope === 'excluded').map((c) => c.name).sort();
  assert.deepEqual(dev, Object.keys(pkg.devDependencies).sort());
  assert.ok(s.components.some((c) => /Thmanyah/i.test(c.name)));
});

t('store-status builds the fetchStatus url and names missing credentials', () => {
  const e = parseEnv('CWS_PUBLISHER_ID=pub\nCWS_ITEM_ID="item1"\n# c\n');
  assert.equal(statusUrl(e), 'https://chromewebstore.googleapis.com/v2/publishers/pub/items/item1:fetchStatus');
  assert.deepEqual(missing(e), ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN']);
  assert.equal(NEEDED.length, 5);
  assert.match(ENV_FILE.split('\\').join('/'), /\.config\/qa-wrap\/chromewebstore\.env$/);
});

t('store-status is read-only: no write endpoint, no repo credential', () => {
  const src = fs.readFileSync('tools/store-status.mjs', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/:publish|:cancelSubmission|setPublishedDeployPercentage|\/upload/.test(src));
  assert.ok(!/method:\s*'(PUT|DELETE|PATCH)'/.test(src));
});

t('the checklist carries the rollback and rollout answers', () => {
  const c = fs.readFileSync('store/CHECKLIST.md', 'utf8');
  for (const w of ['Rollback, 15 minutes', 'Staged rollout', 'tools/sbom.mjs', 'tools/store-status.mjs']) assert.ok(c.includes(w), w);
});

console.log(`\n${n} passed, 0 failed`);
