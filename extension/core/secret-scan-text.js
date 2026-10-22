/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The text half of the secret scan: pure strings in, offsets out, no zip or workbook code.
 * It is loaded in the offscreen document (UQA_OFF_SCAN), never in the service worker.
 * Findings never carry the value. Token shapes, URL userinfo included, come from core/privacy.js (SHAPES).
 */
import { SHAPES, redact, isSecretParam, isSecretHeader, namedSpans, redactEntropy } from './privacy.js';

export const REDACTION = '[REDACTED]';

/* r3-03-2: the secret-name list and isSecretParam moved into core/privacy.js (capture needs them too); re-exported here for the exporters. */
export { isSecretParam, isSecretHeader };

/** D-1010-133: the 11 legacy credential headers; isSecretHeader (privacy.js) is the rule every caller uses, this list is its regression oracle. */
export const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token)$/i;

/** D-1010-133: a copy of a request body with each credential-named key's value replaced by rep(key): urlencoded, FormData text parts, JSON (also cut off). */
export function maskBodyKeys(b, /** @type {(key: string) => string} */ rep = (key) => REDACTION) {
  const t = b?.text, dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
  if (b?.kind === 'FormData' && Array.isArray(b.parts)) return { ...b, parts: b.parts.map((p) => (p && !p.file && isSecretParam(p.name) ? { ...p, value: rep(p.name) } : p)) };
  if (typeof t !== 'string') return b;
  if (b.kind === 'form') return { ...b, text: t.split('&').map((x) => { const i = x.indexOf('='), k = dec(x.slice(0, i)); return i > 0 && isSecretParam(k) ? x.slice(0, i + 1) + encodeURIComponent(rep(k)) : x; }).join('&') };
  if (b.kind !== 'json' && !(b.kind === 'text' && /^\s*[[{]/.test(t))) return b;
  const hit = (k, v) => isSecretParam(k) && v != null && !/^(null|true|false)$/.test(v);
  try {
    let n = 0;
    const walk = (v) => (Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => (hit(k, x && typeof x === 'object' ? 'o' : x) ? (n++, [k, rep(k)]) : [k, walk(x)]))) : v);
    const out = walk(JSON.parse(t));
    return n ? { ...b, text: JSON.stringify(out) } : b;
  } catch {
    return { ...b, text: t.replace(/("(?:[^"\\]|\\.)*")(\s*:\s*)("(?:[^"\\]|\\.)*"|[^\s,}\]]+)/g, (m, k, c, v) => (hit(JSON.parse(k), v) ? k + c + JSON.stringify(rep(JSON.parse(k))) : m)) };
  }
}

const PLACEHOLDER = /^(?:[•*x#._\-\s]+|\[?«?redacted»?\]?|<[^>]*>|\{\{.*\}\}|\$\{.*\}|null|undefined|true|false|string|none)$/i;

/** { kind, re, group }: group holds the secret (0 = whole match). */
const PATTERNS = [
  ...SHAPES,
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, group: 0 },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, group: 0 },
  { kind: 'authorization', re: /\bauthorization["']?\s*[:=]\s*["']?((?:bearer|basic|token|digest|negotiate)\s+[^\s"',;]{6,})/gi, group: 1 },
  // A bare "Bearer <token>" in prose or a title; 20+ characters so the English word alone never matches.
  { kind: 'bearer', re: /\bBearer\s+([A-Za-z0-9._~+/=-]{20,})/g, group: 1 },
  { kind: 'cookie', re: /\b(?:set-)?cookie["']?\s*[:=]\s*["']?([^\r\n"']{6,})/gi, group: 1 },
  { kind: 'webhook-url', re: /https:\/\/(?:hooks\.slack\.com\/services|discord(?:app)?\.com\/api\/webhooks|[\w.-]+\.webhook\.office\.com)\/[^\s"'<>]{10,}/g, group: 0 },
  { kind: 'password', re: /["']?\b(?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|apikey|credential|passphrase|private[_-]?key|bearer|(?:access|refresh|auth|id|session|csrf|xsrf)[_-]?token|token)\b["']?\s*[:=]\s*["']?([^\s"',;&<>]{6,})/gi, group: 1 },
];

/** Every range in `text` that looks secret, merged, as { kind, start, end }. */
export function scanText(text, known = []) {
  const s = String(text ?? '');
  const hits = [];
  if (!s) return hits;
  for (const { kind, re, group } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) {
      const v = m[group];
      // QA Wrap's own provenance stamp ("token": "qaw1:..." in every HAR it writes) is a public integrity mark, not a credential.
      if (!v || PLACEHOLDER.test(v.trim()) || v.startsWith('qaw1:')) continue;
      const start = group ? m.index + m[0].indexOf(v) : m.index;
      hits.push({ kind, start, end: start + v.length });
    }
  }
  // r3-03-2: the same name rule capture uses (privacy.js namedSpans), so a PHPSESSID or pass= pair is one finding in either place.
  for (const [start, end] of namedSpans(s)) hits.push({ kind: 'password', start, end });
  // Exact matches: the vault's own tokens. Short values would flag ordinary words.
  for (const k of new Set(known)) {
    const v = String(k || '');
    if (v.length < 8) continue;
    for (let i = s.indexOf(v); i !== -1; i = s.indexOf(v, i + v.length)) hits.push({ kind: 'saved-token', start: i, end: i + v.length });
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h.start < last.end) { if (h.end > last.end) last.end = h.end; if (h.kind === 'saved-token') last.kind = 'saved-token'; }
    else merged.push({ ...h });
  }
  return merged;
}

/** Replace each range with the fixed placeholder, right to left so offsets hold. */
export function redactText(text, hits) {
  let out = String(text ?? '');
  for (const h of [...hits].sort((a, b) => b.start - a.start)) out = out.slice(0, h.start) + REDACTION + out.slice(h.end);
  return out;
}

/**
 * Scan named strings. `findings` is what a page may see (field, kind, start,
 * end, length: never the value); `redacted` is the same strings cleaned.
 */
export function scanFields(fields, known = []) {
  const findings = [];
  const redacted = {};
  for (const [field, text] of Object.entries(fields || {})) {
    const hits = scanText(text, known);
    redacted[field] = hits.length ? redactText(text, hits) : String(text ?? '');
    for (const h of hits) findings.push({ field, kind: h.kind, start: h.start, end: h.end, length: h.end - h.start });
  }
  return { findings, redacted };
}

const BLOCK = new Set(['paragraph', 'heading', 'codeBlock', 'tableCell', 'tableHeader', 'listItem']);

/** The text of an ADF document, one newline after each block. */
export function adfText(doc) {
  let out = '';
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'text') out += n.text || '';
    (n.content || []).forEach(walk);
    if (BLOCK.has(n.type)) out += '\n';
  };
  walk(doc);
  return out;
}

/** Redact every text node of an ADF document in place-free fashion (returns a copy). */
export function redactAdf(doc, known = []) {
  const walk = (n) => {
    if (!n || typeof n !== 'object') return n;
    if (n.type === 'text') { const hits = scanText(n.text, known); return hits.length ? { ...n, text: redactText(n.text, hits) } : n; }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return walk(doc);
}

/** Kinds with an unmistakable shape: these are redacted even in observe mode. The rest are recorded only. */
export const CONFIRMED = new Set(['private-key', 'jwt', 'vendor-token', 'basic-auth', 'url-param', 'authorization', 'webhook-url']);

/**
 * Scan strings that are about to leave the product (an export, a chat post, a Reporter or .eml body).
 * Observe mode: every finding is returned, but only CONFIRMED kinds are redacted from the text, so a
 * guess can never cost a report. mode "enforce" redacts everything.
 */
export function scanOutbound(fields, { known = [], mode = 'observe', extra = [] } = {}) {
  const findings = [];
  const redacted = {};
  for (const [field, text] of Object.entries(fields || {})) {
    const hits = scanText(text, known);
    const cut = mode === 'enforce' ? hits : hits.filter((h) => CONFIRMED.has(h.kind) || h.kind === 'saved-token');
    for (const h of hits) findings.push({ field, kind: h.kind, length: h.end - h.start, redacted: cut.includes(h) });
    // The same redactor capture uses (cards, IBANs, tokens), so one fixture gets one verdict everywhere.
    const p = redact(cut.length ? redactText(text, cut) : String(text ?? ''), { extra });
    const e = redactEntropy(p.text);
    redacted[field] = e.text;
    for (const f of p.found) findings.push({ field, kind: f.id, count: f.count, redacted: true });
    if (e.count) findings.push({ field, kind: 'high-entropy', count: e.count, redacted: true });
  }
  return { findings, redacted };
}
