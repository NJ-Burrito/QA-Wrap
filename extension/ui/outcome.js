/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Shared outcome helpers (T-017). The Reset sentence is built from `core/store-registry.js` (T-054); the
 * hand list that stood here is gone (completion review 7).
 */

/**
 * What the Reporter may say about a filing. `posted` is the worker's answer to
 * "send": null when only saved, `{ error }` when nothing could be posted, else
 * `{ results: [{ sent, label, ... }] }`. Anything not proven sent is not "Sent".
 */
export function filingState(how, posted) {
  if (how !== 'send') return { state: 'saved' };
  if (!posted) return { state: 'notSent', reason: '' };
  if (posted.error) return { state: 'notSent', reason: posted.error };
  const results = Array.isArray(posted.results) ? posted.results : [];
  const sent = results.filter((r) => r && r.sent).length;
  if (sent && sent === results.length) return { state: 'sent' };
  if (sent) return { state: 'partial', sent, total: results.length };
  return { state: 'notSent', reason: results.map((r) => r?.error).find(Boolean) || '' };
}
