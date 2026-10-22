/* L3: live tally == batch count, badge counts problems only, folds carry counts. */
import assert from 'node:assert/strict';
import { BLANK_FINDINGS, foldFinding, findingTotals, countFindings } from '../core/sessions.js';
import { correlate } from '../core/correlate.js';
import { sanitiseEvent } from '../core/events.js';

const site = 'https://app.test/';
const T = 1e12;
const net = (o) => ({ kind: 'net', method: 'GET', url: 'https://app.test/api/u/1', status: 500, act: 0, ts: T, ...o });
const evs = [
  { kind: 'nav', url: site, ts: T },
  net({}), net({ url: 'https://app.test/api/u/2', ts: T + 1 }),           // same template: one problem
  net({ status: 200, error: true, en: 'AbortError', nh: 'abort' }),        // Note: not counted
  net({ nh: 'abort', status: 503 }),                                       // forged hint on an HTTP error: counts
  net({ url: 'https://ads.other.io/p', status: 404 }),                     // warning
  net({ overridden: true }), net({ via: 'api', url: 'https://app.test/z' }),  // induced
  { kind: 'console', level: 'error', text: 'Boom 42', act: 0, ts: T + 5 },
  { kind: 'pageerror', text: 'x', nh: 'opaque', ts: T + 6 },               // Note
  { kind: 'console', level: 'error', text: 'Boom 42', act: 1, ts: T + 7 }, // new epoch: new row
];
let live = BLANK_FINDINGS;
for (const e of evs) live = foldFinding(live, e);
const t = findingTotals(live);
assert.equal(t.problems, 4, '/api/u/:id 500, 503, ads 404, console (the second epoch is the same problem: the one number)');
assert.equal(t.warnings, 1);
assert.equal(t.errors, 3);
assert.deepEqual(findingTotals(live), countFindings(evs, { session: { startUrl: site } }), 'live == batch');
assert.equal(findingTotals(BLANK_FINDINGS).problems, 0);
// old event with no new fields still counts
assert.equal(countFindings([{ kind: 'console', level: 'error', text: 'e', ts: 1 }]).problems, 1);

// badge colour: a console error's src decides first/third party
const col = (o) => findingTotals(foldFinding(foldFinding(BLANK_FINDINGS, { kind: 'nav', url: site, ts: T }),
  { kind: 'console', level: 'error', text: 'e', ts: T, ...o }));
assert.equal(col({ src: 'https://cdn.other.io/a.js' }).warnings, 1, 'third-party src: amber');
assert.equal(col({ src: 'https://app.test/a.js' }).errors, 1, 'first-party src: red');
assert.equal(col({}).errors, 1, 'no src: red');

// correlate: repeats carry a count and point at the first
const chains = correlate([
  { kind: 'dom', ts: 1, frameUrl: 'f' }, net({ ts: 10 }), net({ url: 'https://app.test/api/u/9', ts: 900 }),
  { kind: 'rep', ofKind: 'net', method: 'GET', url: 'https://app.test/api/u/3', status: 500, act: 0, n: 7, ts: 950 },
]);
assert.equal(chains.length, 2);
assert.equal(chains[1].repeatOf, chains[0]);
assert.equal(chains[0].count, 1 + 1 + 7);

// EVENT_FIELDS carries raw facts; forged sg dropped
const c = sanitiseEvent({ kind: 'net', status: 500, en: 'TypeError', act: 3, nh: 'abort', sg: 'x' }, { now: T });
assert.ok(c.en && c.act === 3 && c.nh && !('sg' in c));
assert.equal(sanitiseEvent({ kind: 'rep', ofKind: 'net', n: 4, url: 'u' }, { now: T }).n, 4);
console.log('test-signal-worker: ok');
