/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The refusals release-check makes about the TREE and the ZIP's relationship to it (T-005).
 * Each function takes its inputs and returns `null` (fine) or a sentence naming the fault, so a
 * test can feed it a stale zip or a flipped byte without touching the real tree.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { shipping } from './lib-ship.mjs';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const git = (repo, ...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();

/** Files changed or new (untracked, not ignored) under the shipping inputs: a new source file must not ship in a zip no commit contains. work/ is outside the paths. */
export function dirtyTree(repo) {
  const out = git(repo, 'status', '--porcelain', '--untracked-files=normal', '--', 'extension', 'site');
  return out ? `uncommitted changes in the tree (${out.split('\n').length} file(s), first: ${out.split('\n')[0].trim()})` : null;
}

/** Newest mtime (ms) among the files that go into the package. */
export function newestSource(ext) {
  let newest = { t: 0, file: '' };
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const n of fs.readdirSync(p)) if (n !== 'node_modules') walk(path.join(p, n)); } else if (st.mtimeMs > newest.t) newest = { t: st.mtimeMs, file: p };
  };
  for (const n of shipping(fs.readdirSync(ext))) walk(path.join(ext, n));
  return newest;
}

export function staleZip(zipMtimeMs, newest, ext) {
  return zipMtimeMs < newest.t ? `zip is older than ${path.relative(ext, newest.file)} (zip ${new Date(zipMtimeMs).toISOString()}, source ${new Date(newest.t).toISOString()}): rebuild it` : null;
}

const parts = (v) => v.replace(/^v/, '').split('.').map(Number);
export const cmpVersion = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };

export const lastTag = (repo) => git(repo, 'tag', '--list', 'v[0-9]*', '[0-9]*').split('\n').filter(Boolean).sort(cmpVersion).pop() || null;

/** `tag` null = nothing has been tagged yet, so any version is new. */
export function versionNotNew(version, tag) {
  return tag && cmpVersion(version, tag) <= 0 ? `manifest version ${version} is not greater than the last tag ${tag}: bump it` : null;
}

export function changelogUndated(text, version) {
  const esc = version.replaceAll('.', String.raw`\.`);
  return new RegExp(String.raw`^## ${esc}[,\s]+\d{4}-\d{2}-\d{2}\b`, 'm').test(text) ? null : `CHANGELOG.md has no dated section "## ${version}, YYYY-MM-DD"`;
}

/** vendor/README.md names the SHA-256; recompute it from the file. */
export function axeMismatch(readme, axeBytes) {
  const want = (readme.match(/SHA-256:\s*([0-9a-f]{64})/i) || [])[1];
  if (!want) return 'vendor/README.md names no SHA-256 for axe.min.js';
  const got = sha256(axeBytes);
  return got === want.toLowerCase() ? null : `vendor/axe.min.js hashes to ${got}, vendor/README.md says ${want}`;
}

/** Retired sentences found in `files` ([{ name, text }]); case-insensitive. */
export function retiredHits(files, sentences) {
  const hits = [];
  for (const f of files) for (const s of sentences) if (f.text.toLowerCase().includes(s.text.toLowerCase())) hits.push(`${f.name}: "${s.text}" (${s.why})`);
  return hits;
}

/** Store images older than the newest ui/ or popup/ change: a warning, never an error. */
export function staleStoreAssets(ext) {
  const newest = Math.max(...['ui', 'popup'].map((d) => dirNewest(path.join(ext, d))));
  const old = fs.readdirSync(path.join(ext, 'store')).filter((n) => /\.png$/.test(n)).filter((n) => fs.statSync(path.join(ext, 'store', n)).mtimeMs < newest);
  return old.length ? `store assets older than the newest ui/ or popup/ change: ${old.join(', ')}` : null;
}
function dirNewest(d) { let t = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); t = Math.max(t, e.isDirectory() ? dirNewest(p) : fs.statSync(p).mtimeMs); } return t; }
