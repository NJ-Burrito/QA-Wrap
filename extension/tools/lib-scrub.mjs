/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * S12 - secret scrubbing for every log sink the test pipeline writes.
 *
 *   scrub(text)            -> text with every secret-shaped span replaced by [REDACTED]
 *   scrubTransform()       -> a node Transform that scrubs a child's stdout/stderr line by line
 *   leakScan(text)         -> [{kind, start, end}] of what scrub() would remove (values never returned)
 *   leakScanDir(dir)       -> [{file, kind, count}] over every text file under dir (post-run leak scan)
 *
 * It layers three things: the product's own detector (core/secret-scan-text.js, which also carries the
 * privacy.js token shapes), token shapes the product does not carry (OpenRouter, Google, Atlassian, GitHub
 * fine-grained, Slack, AWS), and Authorization / x-api-key header values. Pure strings; no network, no model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { scanText, redactText, REDACTION } from '../core/secret-scan-text.js';

export { REDACTION };
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = path.resolve(HERE, '..');

/** Shapes beyond the product's: { kind, re } with the whole match replaced. */
const EXTRA = [
  { kind: 'openrouter-key', re: /\bsk-or-v1-[A-Za-z0-9]{8,}/g },
  { kind: 'sk-key', re: /\bsk-[A-Za-z0-9_-]{12,}/g },
  { kind: 'google-key', re: /\bAIza[0-9A-Za-z_-]{20,}/g },
  { kind: 'atlassian-token', re: /\bATATT[A-Za-z0-9_=+-]{16,}/g },
  { kind: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { kind: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'authorization-header', re: /\b(?:proxy-)?authorization\b["']?\s*[:=]\s*["']?(?:bearer|basic|token)?\s*[A-Za-z0-9._~+/=-]{8,}/gi },
  { kind: 'api-key-header', re: /\bx-api-key\b["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/gi },
];

/** All ranges to remove, merged: product detector plus the extra shapes. */
export function leakScan(text) {
  const s = String(text ?? '');
  const hits = scanText(s).map((h) => ({ kind: h.kind, start: h.start, end: h.end }));
  for (const { kind, re } of EXTRA) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) hits.push({ kind, start: m.index, end: m.index + m[0].length });
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h.start < last.end) { if (h.end > last.end) last.end = h.end; } else merged.push({ ...h });
  }
  return merged;
}

export function scrub(text) {
  const s = String(text ?? '');
  const hits = leakScan(s);
  return hits.length ? redactText(s, hits) : s;
}

/** Scrub a child stream whole lines at a time (a token never spans a chunk boundary that way). */
export function scrubTransform() {
  let rest = '';
  return new Transform({
    transform(chunk, _enc, cb) {
      rest += chunk.toString('utf8');
      const i = rest.lastIndexOf('\n');
      if (i < 0) return cb();
      const head = rest.slice(0, i + 1); rest = rest.slice(i + 1);
      cb(null, scrub(head));
    },
    flush(cb) { cb(null, rest ? scrub(rest) : null); },
  });
}

const TEXT_EXT = /\.(txt|log|json|jsonl|md|xml|html?|csv|out|err|mjs|js|env|yml|yaml)$/i;
/** Post-run leak scan: every text file under dir (<= maxBytes each); findings carry kind and count, never the value. */
export function leakScanDir(dir, { maxBytes = 5_000_000 } = {}) {
  const found = [];
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'profiles' && e.name !== 'unpacked') walk(p); continue; } // browser profiles and unpacked product copies (the boot-zip suite) are not log sinks
      if (!TEXT_EXT.test(e.name)) continue;
      try {
        if (fs.statSync(p).size > maxBytes) continue;
        const kinds = {};
        for (const h of leakScan(fs.readFileSync(p, 'utf8'))) kinds[h.kind] = (kinds[h.kind] || 0) + 1;
        for (const [kind, count] of Object.entries(kinds)) found.push({ file: p, kind, count });
      } catch { /* unreadable: not a sink we wrote */ }
    }
  };
  walk(dir);
  return found;
}
