/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * Duplicate collapse (features-1010, lane R, item 3).
 *
 * Forty identical 500s are one problem. This folds failures that are the same thing seen again: the same kind, the same
 * message (or status), and the same place (the URL pattern for a request, the file and line for a console error).
 * Deterministic: no model, no network, no clock. Pure, so the report, the AI block, `session.json` and the Markdown
 * export all fold the same way and a test can reach it.
 *
 * Unlike `liteFp()` in events.js (the worker's live tally), the key here does NOT carry the action epoch: a click that
 * fails again IS the same problem, and the whole point is to see it once. `liteFp` stays what it is, for the tally.
 *
 * Nothing is dropped: a group keeps every occurrence, and its `count` is the raw total (occurrences plus the hook's
 * folded `rep` counts), so the number on the card equals the number of failures the recorder saw.
 */

import { isFailure, dupeKey } from './events.js';
import { redact } from './privacy.js';

export { dupeKey };

/** One line for a failure, in plain words and in the same shape everywhere (the AI block, session.json, the report list). */
export function failureLine(ev) {
  if (ev.kind === 'net') return `${String(ev.method || 'GET').toUpperCase()} ${ev.url} -> ${ev.error ? 'network error' : ev.status}${ev.text && ev.error ? ` (${String(ev.text).slice(0, 120)})` : ''}`;
  if (ev.kind === 'pageerror') return `Uncaught: ${String(ev.text || '').slice(0, 300)}`;
  return `console.${ev.level === 'assert' ? 'assert' : 'error'}: ${String(ev.text || '').slice(0, 300)}`;
}

/**
 * @typedef {{ key: string, kind: string, first: any, occurrences: any[], count: number, folded: number, expected?: boolean }} FailureGroup
 */

/**
 * Every failure in the session, folded. Groups come out in the order their first occurrence happened.
 * `count` = occurrences + the hook's own folded repeats (`rep` rows) = the raw total the recorder saw.
 * `expected: true` = the tester pressed "Not a bug" (an `expected` event whose `forKey` is this key). It is a flag, never a
 * removal: the group stays in every count and every export (AUTO-5).
 * @param {any[]} events
 * @returns {FailureGroup[]}
 */
export function groupFailures(events) {
  const ordered = (events || []).map((e, i) => ({ e, i })).sort((a, b) => {
    const x = Number(a.e.ts);
    const y = Number(b.e.ts);
    return Number.isFinite(x) && Number.isFinite(y) && x !== y ? x - y : a.i - b.i;
  }).map((x) => x.e);
  /** @type {Map<string, FailureGroup>} */
  const groups = new Map();
  for (const e of ordered) {
    if (!isFailure(e)) continue;
    const key = dupeKey(e);
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, kind: e.kind, first: e, occurrences: [], count: 0, folded: 0 });
    g.occurrences.push(e);
    g.count += 1;
  }
  // The worker redacts what it stores, the page keyed the raw text: compare both sides after the same redact so a failure that
  // carried a secret still matches the "Not a bug" press.
  const norm = (k) => redact(String(k ?? '')).text.replace(/\|+$/, ''); // a secret at the end of the text can swallow the trailing separator
  const byRedacted = new Map();
  if (ordered.some((e) => e.kind === 'expected')) for (const [k, g] of groups) byRedacted.set(norm(k), g);
  for (const e of ordered) {
    const g = e.kind === 'expected' ? groups.get(e.forKey) || byRedacted.get(norm(e.forKey)) : groups.get(e.kind === 'rep' ? dupeKey(e) : undefined);
    if (!g) continue;
    if (e.kind === 'expected') g.expected = true;
    else { const n = Number(e.n) || 0; g.count += n; g.folded += n; }
  }
  return [...groups.values()];
}

/**
 * The groups of a list of causal chains: chains whose lead failure has the same key are one group, and the group's
 * occurrences are every failure event with that key (a chain's `siblings` included). Same order as the chains.
 * @param {any[]} chains
 * @param {any[]} events
 */
export function groupChains(chains, events) {
  const all = new Map(groupFailures(events).map((g) => [g.key, g]));
  /** @type {Map<string, { key: string, chain: any, chains: any[], count: number, occurrences: any[], expected?: boolean }>} */
  const out = new Map();
  for (const c of chains) {
    const key = dupeKey(c.failure);
    let g = out.get(key);
    if (!g) {
      const full = all.get(key);
      out.set(key, g = { key, chain: c, chains: [], count: full ? full.count : 1, occurrences: full ? full.occurrences : [c.failure], ...(full?.expected ? { expected: true } : {}) });
    }
    g.chains.push(c);
  }
  return [...out.values()];
}
