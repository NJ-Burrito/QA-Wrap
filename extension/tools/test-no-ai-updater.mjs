/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The update path is AI-free (Nader, 2026-10-22): no model, LLM or AI service in the installers, the updater host, the update check,
 * the What's new page, the release notes script or the release workflow. Fails when any of them names an AI endpoint or vendor.
 *   node tools/test-no-ai-updater.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from './test-site-powers.mjs';

const REPO = path.resolve(EXT, '..');
const FILES = [
  ...fs.readdirSync(path.join(EXT, 'updater')).map((f) => path.join(EXT, 'updater', f)),
  ...fs.readdirSync(path.join(EXT, 'whatsnew')).map((f) => path.join(EXT, 'whatsnew', f)),
  path.join(EXT, 'core', 'update-check.js'), path.join(EXT, 'core', 'whats-new-open.js'), path.join(EXT, 'ui', 'update-card.js'),
  path.join(EXT, 'tools', 'release-notes.mjs'), path.join(REPO, '.github', 'workflows', 'release.yml'),
];
const AI = /openai|anthropic|claude|openrouter|generativelanguage|gemini|googleapis\.com\/v1beta|api\.cohere|mistral\.ai|huggingface|replicate\.com|perplexity|groq\.com|together\.ai|deepseek|\bgpt-\d|\bllm\b|chatgpt/i;
let bad = 0;
for (const f of FILES) {
  const hit = AI.exec(fs.readFileSync(f, 'utf8'));
  if (hit) { bad++; console.log(`  FAIL ${path.relative(REPO, f)}: names "${hit[0]}"`); }
}
assert.ok(FILES.length >= 12, 'the scan reached the updater, whatsnew and release files');
assert.ok(fs.existsSync(path.join(EXT, 'updater', 'install.sh')) && fs.existsSync(path.join(EXT, 'updater', 'install.cmd')), 'both installers exist');
const urls = FILES.flatMap((f) => fs.readFileSync(f, 'utf8').split(String.fromCharCode(92)).join('').match(/https?:\/\/[A-Za-z0-9.-]+/g) || []);
const hosts = new Set(urls.map((u) => new URL(u).hostname));
const ok = (h) => /(^|\.)github\.com$|^api\.github\.com$|^evil\.example$|^127\.0\.0\.1$|^chrome-extension$|^w3\.org$|www\.w3\.org$/.test(h);
for (const h of hosts) if (!ok(h)) { bad++; console.log(`  FAIL unexpected host in the update path: ${h}`); }
console.log(bad ? `\n${bad} problem(s)` : `ok  ${FILES.length} files, hosts: ${[...hosts].sort().join(', ')}\n\n1 passed`);
process.exit(bad ? 1 : 0);
