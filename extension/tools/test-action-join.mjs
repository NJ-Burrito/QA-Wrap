/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Gap G2: a picked locator labeled with the action(s) performed on it.
 *
 *   node tools/test-action-join.mjs
 *
 * Covers the matching rule in `core/action-join.js`: css/xpath + frame join,
 * no time window, dedupe-when-repeated, several picks sharing a locator, and
 * the unmatched case, which must come back `null` — never `[]`, never an
 * error — because "no action recorded" is the correct answer for a pick
 * made to assert on, not to act on.
 */
import assert from 'node:assert/strict';
import { actionsForPick } from '../core/action-join.js';

const FRAME = 'https://app.example.test/';

function pick({ css = '#submit', xpath = null } = {}) {
  return {
    kind: 'selectorcopy',
    frameUrl: FRAME,
    flavours: [
      { name: 'playwright', expr: "page.getByTestId('submit')" },
      ...(css ? [{ name: 'css', expr: css }] : []),
      ...(xpath ? [{ name: 'xpath', expr: xpath }] : []),
    ],
  };
}

function dom({ ts, action, selector = '#submit', xpath = null, frameUrl = FRAME }) {
  return { kind: 'dom', ts, action, selector, xpath, frameUrl };
}

// 1. No dom event ever touched this locator: the ordinary "picked to assert
//    on" case. Must be `null`, not `[]` and not a thrown error.
assert.equal(actionsForPick(pick(), []), null);
assert.equal(actionsForPick(pick(), [dom({ ts: 1, action: 'click', selector: '#other' })]), null);

// 2. One matching action.
assert.deepEqual(
  actionsForPick(pick(), [dom({ ts: 1, action: 'click' })]),
  ['click']
);

// 3. Several distinct actions, out of chronological order in the input,
//    joined by timestamp — not input order.
assert.deepEqual(
  actionsForPick(pick(), [
    dom({ ts: 200, action: 'submit' }),
    dom({ ts: 100, action: 'click' }),
  ]),
  ['click', 'submit']
);

// 4. Repeated back-to-back action types collapse to one; a repeat after a
//    different action in between stays distinct.
assert.deepEqual(
  actionsForPick(pick(), [
    dom({ ts: 100, action: 'click' }),
    dom({ ts: 110, action: 'click' }),
    dom({ ts: 120, action: 'input' }),
    dom({ ts: 130, action: 'click' }),
  ]),
  ['click', 'input', 'click']
);

// 5. No time window: an action recorded well before or after the pick still
//    matches — the pick has no `ts` role in the rule at all.
assert.deepEqual(
  actionsForPick(pick(), [dom({ ts: 999_999, action: 'change' })]),
  ['change']
);

// 6. Different frame, same css string: must not match (a page can repeat a
//    selector across two frames for two unrelated elements).
assert.equal(
  actionsForPick(pick(), [dom({ ts: 1, action: 'click', frameUrl: 'https://other.test/' })]),
  null
);

// 7. No css on the pick: falls back to xpath.
assert.deepEqual(
  actionsForPick(pick({ css: null, xpath: '//button[1]' }), [
    dom({ ts: 1, action: 'click', selector: null, xpath: '//button[1]' }),
  ]),
  ['click']
);

// 8. Two picks sharing a locator get the identical action list — same
//    target, not a collision.
const a = pick();
const b = pick();
const events = [dom({ ts: 1, action: 'click' })];
assert.deepEqual(actionsForPick(a, events), actionsForPick(b, events));

// 9. Not a selectorcopy event, or no events array: `null`, never a throw.
assert.equal(actionsForPick({ kind: 'dom' }, []), null);
assert.equal(actionsForPick(pick(), null), null);

console.log('test-action-join: 9/9 PASS');
