/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * The one problem number (autopilot 1011, contract C5, REQ P0-3).
 * The one problem number (autopilot 1011, contract C5, REQ P0-3).
 */

import { classify } from './signal.js';
import { groupFailures } from './dupes.js';

/**
 * @param {any[]} events
 * @returns {{ groups: number, events: number, dupes: number }}
 */
export function problemCounts(events) {
  const kept = (events || []).filter((e) => e && classify(e).c === 'D'); // a `rep` row classifies as the failure it folded
  const found = groupFailures(kept);
  const total = found.reduce((n, g) => n + g.count, 0);
  return { groups: found.length, events: total, dupes: total - found.length };
}

/** `countFindings` totals with the failure part set to the problem groups, so a headline never disagrees with the Problems row. */
export function agreeWithProblems(totals, events) {
  const failures = problemCounts(events).groups;
  return { ...totals, failures, total: totals.total - totals.failures + failures };
}
