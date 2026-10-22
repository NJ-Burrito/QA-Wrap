/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * GraphQL matching and mocking.
 *
 * Same technique as `test-rules.mjs`: the functions are lifted out of
 * `content/page-hooks.js` by name and rebuilt here, because that file runs in
 * the page's MAIN world and cannot be imported. The lift fails loudly if
 * anything is renamed, which is the only thing keeping this from testing a copy
 * that has quietly diverged.
 *
 * The assertion that carries the most weight is the last group: **a GraphQL
 * error is HTTP 200.** That is the whole reason GraphQL needs its own action
 * rather than reusing "force a 500" — a client checking `res.ok` sails past a
 * real GraphQL failure and renders undefined, and forcing a 500 tests a
 * different path and never finds it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lift as liftSource } from './lib-lift.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, '..', 'content', 'page-hooks.js'), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const lift = (name) => liftSource(SOURCE, name);

const build = new Function(
  'rulesRef',
  'awakeRef',
  'locationRef',
  `const rules = rulesRef;
   const awake = awakeRef;
   const location = locationRef;
   ${lift('graphqlInfo')}
   ${lift('graphqlErrorBody')}
   ${lift('ruleHits')}
   ${lift('matchRules')}
   return { graphqlInfo, graphqlErrorBody, ruleHits, matchRules };`
);

const engine = (rules = [], awake = true) =>
  build(rules, awake, { href: 'https://app.test/graphql' });

const ENDPOINT = 'https://app.test/graphql';

const body = (query, operationName, variables) =>
  JSON.stringify(operationName || variables ? { query, operationName, variables } : { query });

const CHECKOUT = 'mutation Checkout($id: ID!) { checkout(id: $id) { ok } }';
const ORDERS = 'query Orders { orders { id total } }';

console.log('page-hooks.js — reading a GraphQL request');

const { graphqlInfo, graphqlErrorBody } = engine();

test('the operation name is read from the field when the client sends it', () => {
  const info = graphqlInfo(body(CHECKOUT, 'Checkout', { id: '1' }), ENDPOINT);
  assert.equal(info.operationName, 'Checkout');
  assert.equal(info.operationType, 'mutation');
  assert.deepEqual(info.variables, { id: '1' });
});

test('and parsed out of the document when it does not', () => {
  // operationName is optional even on a named operation. A matcher that only
  // worked when the client happened to send it would be unusable on half the
  // APIs in the wild.
  const info = graphqlInfo(body(CHECKOUT), ENDPOINT);
  assert.equal(info.operationName, 'Checkout');
  assert.equal(info.operationType, 'mutation');
});

test('a query is a query and a mutation is a mutation', () => {
  assert.equal(graphqlInfo(body(ORDERS), ENDPOINT).operationType, 'query');
  assert.equal(graphqlInfo(body(CHECKOUT), ENDPOINT).operationType, 'mutation');
});

test('an anonymous operation has no name, and still parses', () => {
  const info = graphqlInfo(JSON.stringify({ query: '{ me { id } }' }), ENDPOINT);
  assert.ok(info, 'an anonymous query is still GraphQL');
  assert.equal(info.operationName, null);
});

test('a batched request is read from its first operation', () => {
  const batch = JSON.stringify([{ query: CHECKOUT }, { query: ORDERS }]);
  assert.equal(graphqlInfo(batch, ENDPOINT).operationName, 'Checkout');
});

test('the GET form, where the query is in the query string', () => {
  const info = graphqlInfo(null, `${ENDPOINT}?query=${encodeURIComponent(ORDERS)}`);
  assert.equal(info.operationName, 'Orders');
});

test('a plain REST body is not GraphQL, and costs almost nothing to reject', () => {
  assert.equal(graphqlInfo('{"name":"Sara"}', 'https://app.test/api/x'), null);
  assert.equal(graphqlInfo('name=Sara', 'https://app.test/api/x'), null);
  assert.equal(graphqlInfo(null, 'https://app.test/api/x'), null);
  assert.equal(graphqlInfo('{not json', 'https://app.test/api/x'), null);
});

console.log('\npage-hooks.js — matching one operation, not the whole API');

const ctx = (b) => ({ body: b, graphql: graphqlInfo(b, ENDPOINT) });

test('a rule on one operation ignores every other operation at the same URL', () => {
  const { matchRules } = engine([
    { enabled: true, operation: 'Checkout', action: 'graphqlError', label: 'break checkout' },
  ]);
  assert.equal(matchRules(ENDPOINT, 'POST', ctx(body(CHECKOUT))).all.length, 1, 'should match Checkout');
  assert.equal(matchRules(ENDPOINT, 'POST', ctx(body(ORDERS))).all.length, 0, 'must not match Orders');
});

test('this is the thing a URL rule cannot express', () => {
  // The point, stated as a test: every operation posts to the same endpoint, so
  // a URL rule is a rule on the entire API.
  const { matchRules } = engine([{ enabled: true, pattern: '/graphql', action: 'status', status: 500 }]);
  assert.equal(matchRules(ENDPOINT, 'POST', ctx(body(CHECKOUT))).all.length, 1);
  assert.equal(matchRules(ENDPOINT, 'POST', ctx(body(ORDERS))).all.length, 1, 'a URL rule catches everything');
});

test('the operation type can be required as well as the name', () => {
  const { matchRules } = engine([
    { enabled: true, operation: 'Checkout', operationType: 'query', action: 'graphqlError' },
  ]);
  assert.equal(matchRules(ENDPOINT, 'POST', ctx(body(CHECKOUT))).all.length, 0, 'Checkout is a mutation');
});

test('a regex operation matches a family of them', () => {
  const { matchRules } = engine([
    { enabled: true, operation: '^Get', operationIsRegex: true, action: 'mock' },
  ]);
  assert.equal(matchRules(ENDPOINT, 'POST', ctx(body('query GetUser { me { id } }'))).all.length, 1);
  assert.equal(matchRules(ENDPOINT, 'POST', ctx(body('query ListUsers { users { id } }'))).all.length, 0);
});

test('a GraphQL rule never matches a request with no GraphQL in it', () => {
  const { matchRules } = engine([{ enabled: true, operation: 'Checkout', action: 'graphqlError' }]);
  assert.equal(matchRules('https://app.test/api/orders', 'POST', ctx('{"a":1}')).all.length, 0);
  assert.equal(matchRules('https://app.test/api/orders', 'GET', null).all.length, 0, 'and not with no context at all');
});

test('bodyContains matches an API that puts the verb in the payload', () => {
  const { matchRules } = engine([{ enabled: true, bodyContains: '"action":"refund"', action: 'status', status: 500 }]);
  assert.equal(matchRules('https://app.test/rpc', 'POST', ctx('{"action":"refund","id":1}')).all.length, 1);
  assert.equal(matchRules('https://app.test/rpc', 'POST', ctx('{"action":"charge","id":1}')).all.length, 0);
});

test('the master switch still gates everything, GraphQL included', () => {
  const { matchRules } = engine([{ enabled: true, operation: 'Checkout', action: 'graphqlError' }], false);
  assert.equal(matchRules(ENDPOINT, 'POST', ctx(body(CHECKOUT))).all.length, 0);
});

console.log('\npage-hooks.js — mock and graphqlError are terminal');

test('both replace the response, so both stop the request', () => {
  for (const action of ['mock', 'graphqlError']) {
    const { matchRules } = engine([{ enabled: true, pattern: '/graphql', action }]);
    const { terminal } = matchRules(ENDPOINT, 'POST', ctx(body(ORDERS)));
    assert.ok(terminal, `${action} must be terminal — a request cannot be answered twice`);
    assert.equal(terminal.action, action);
  }
});

test('a modifier still composes with a terminal action', () => {
  const { matchRules } = engine([
    { enabled: true, pattern: '/graphql', action: 'headers', headers: { 'x-test': '1' } },
    { enabled: true, operation: 'Checkout', action: 'graphqlError' },
  ]);
  const { all, terminal } = matchRules(ENDPOINT, 'POST', ctx(body(CHECKOUT)));
  assert.equal(all.length, 2, 'both apply');
  assert.equal(terminal.action, 'graphqlError', 'the terminal one is the one that answers');
});

console.log('\npage-hooks.js — the shape of a GraphQL error');

test('it is a 200-shaped body: data null, errors present', () => {
  const parsed = JSON.parse(graphqlErrorBody({ message: 'nope' }, { operationName: 'Checkout' }));
  assert.equal(parsed.data, null, 'a GraphQL failure returns data: null, not an HTTP error');
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].message, 'nope');
});

test('it names the operation it broke, so the log is readable', () => {
  const parsed = JSON.parse(graphqlErrorBody({}, { operationName: 'Checkout' }));
  assert.equal(parsed.errors[0].extensions.operation, 'Checkout');
  assert.equal(parsed.errors[0].extensions.qawrap, true, 'and marks itself as forced, not real');
});

test('the error code and path can be chosen, because clients branch on them', () => {
  const parsed = JSON.parse(graphqlErrorBody({ code: 'UNAUTHENTICATED', path: 'checkout.ok' }, null));
  assert.equal(parsed.errors[0].extensions.code, 'UNAUTHENTICATED');
  assert.deepEqual(parsed.errors[0].path, ['checkout', 'ok']);
});

test('partial data can be returned alongside an error, which is the nastier case', () => {
  // A response with BOTH data and errors is legal GraphQL and the case most
  // clients handle worst — they check `errors` or `data`, rarely both.
  const parsed = JSON.parse(graphqlErrorBody({ nullData: false }, null));
  assert.equal('data' in parsed, false, 'undefined data is omitted, leaving the client to merge');
  assert.ok(parsed.errors.length);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
