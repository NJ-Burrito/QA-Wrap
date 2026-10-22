/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The Postman exporter.
 *
 * The assertions here are about the two things that make an exported collection
 * worth keeping — that it is parameterised, and that it does not carry
 * anybody's credentials — plus the grouping that stops it being a log.
 */
import {
  buildPostmanCollection,
  buildPostmanEnvironment,
  summarisePostman,
  templatePath,
  endpointKey,
  normaliseNetEvent,
} from '../core/postman.js';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    const detail = fn();
    pass++;
    console.log(`  ok  ${name}${detail ? ` → ${JSON.stringify(detail)}` : ''}`);
  } catch (err) {
    fail++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

const eq = (a, b, why) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${why}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
const ok = (v, why) => {
  if (!v) throw new Error(why);
};

const SESSION = {
  id: 's_abc123',
  charter: 'Submit an application',
  startedAt: Date.parse('2026-08-27T09:00:00Z'),
  startUrl: 'https://app.example.test/apply',
};

const net = (over) => ({
  kind: 'net',
  via: 'fetch',
  method: 'GET',
  url: '/api/orders',
  status: 200,
  ok: true,
  durationMs: 40,
  ts: SESSION.startedAt + 1000,
  reqHeaders: {},
  ...over,
});

const EVENTS = [
  net({ method: 'POST', url: '/api/applications', status: 201,
        reqHeaders: { 'content-type': 'application/json', authorization: '«redacted»', 'user-agent': 'Chrome' },
        reqBody: { kind: 'json', text: '{"name":"Sara","password":"«redacted»"}' },
        resHeaders: { 'content-type': 'application/json' } }),
  net({ url: '/api/orders/8813' }),
  net({ url: '/api/orders/8814' }),
  net({ url: '/api/orders/9001', status: 500, ok: false, responsePreview: '{"error":"boom"}' }),
  net({ url: 'https://analytics.other.test/collect', method: 'POST' }),
  net({ url: '/api/redirected', redirectedTo: '/api/elsewhere' }),
  { kind: 'dom', action: 'click', ts: SESSION.startedAt + 5 },
];

console.log('\n— path templating —');

test('a numeric id becomes a path variable', () => {
  eq(templatePath('/api/orders/8813'), '/api/orders/:id', 'numeric segment');
  return templatePath('/api/orders/8813');
});

test('a uuid becomes its own variable, not :id', () =>
  eq(templatePath('/x/3f2504e0-4f89-11d3-9a0c-0305e82c3301'), '/x/:uuid', 'uuid segment'));

test('a long hex id is an id, and a word is left alone', () => {
  eq(templatePath('/x/507f1f77bcf86cd799439011'), '/x/:id', 'mongo id');
  eq(templatePath('/api/applications'), '/api/applications', 'a word is not an id');
});

test('the same endpoint with different ids is one key', () =>
  eq(
    endpointKey({ method: 'GET', url: '/api/orders/8813' }, SESSION.startUrl),
    endpointKey({ method: 'GET', url: '/api/orders/9001' }, SESSION.startUrl),
    'ids should collapse'
  ));

test('a different method is a different endpoint', () => {
  const a = endpointKey({ method: 'GET', url: '/api/x' }, SESSION.startUrl);
  const b = endpointKey({ method: 'POST', url: '/api/x' }, SESSION.startUrl);
  ok(a !== b, 'GET and POST on one path are two requests, not one');
});

console.log('\n— the collection —');

const collection = buildPostmanCollection(SESSION, EVENTS);
const flat = (items) => items.flatMap((i) => (i.item ? flat(i.item) : [i]));
const all = flat(collection.item);

test('it declares the v2.1 schema Postman actually imports', () => {
  ok(/collection\/v2\.1\.0/.test(collection.info.schema), `schema was ${collection.info.schema}`);
  return collection.info.schema.split('/').slice(-2).join('/');
});

test('three recordings of one endpoint collapse into one item', () => {
  const orders = all.filter((i) => i.name.includes('/api/orders/:id'));
  eq(orders.length, 1, 'three ids, one endpoint');
  return { items: all.length, names: all.map((i) => i.name) };
});

test('every recording is still attached as an example', () => {
  const orders = all.find((i) => i.name.includes('/api/orders/:id'));
  ok(orders.response.length >= 2, `only ${orders.response.length} example(s)`);
  ok(orders.response.some((r) => r.code === 500), 'the failure must survive — it is the interesting one');
  return orders.response.map((r) => r.code);
});

test('a redirect record is not exported as a request', () =>
  ok(!all.some((i) => i.name.includes('/api/redirected')), 'a redirect note is not an endpoint'));

test('a second host gets its own folder', () => {
  ok(collection.item.every((i) => i.item), 'two origins should produce folders');
  return collection.item.map((i) => i.name);
});

console.log('\n— parameterised, which is the point —');

test('the session origin becomes {{baseUrl}}', () => {
  const post = all.find((i) => i.name.includes('/api/applications'));
  eq(post.request.url.raw, '{{baseUrl}}/api/applications', 'origin should be a variable');
  return post.request.url.raw;
});

test('a third-party host stays literal, because it is not the environment', () => {
  const other = all.find((i) => i.name.includes('/collect'));
  ok(other.request.url.raw.startsWith('https://analytics.other.test'), other.request.url.raw);
  return other.request.url.raw;
});

test('path variables are declared, not just written', () => {
  const orders = all.find((i) => i.name.includes('/api/orders/:id'));
  eq(orders.request.url.variable.map((v) => v.key), ['id'], 'the :id must be declared');
  eq(orders.request.url.variable[0].value, '8813', 'the value is the first recorded segment, as the description says');
});

test('baseUrl is a collection variable', () =>
  ok(collection.variable.some((v) => v.key === 'baseUrl'), 'baseUrl should be declared'));

console.log('\n— nothing secret leaves ——');

test('the Authorization header exports as an empty {{token}}', () => {
  const post = all.find((i) => i.name.includes('/api/applications'));
  const auth = post.request.header.find((h) => /^authorization$/i.test(h.key));
  ok(auth, 'the header should still be declared so the request works');
  eq(auth.value, 'Bearer {{token}}', 'it must be a variable');
  const token = collection.variable.find((v) => v.key === 'token');
  eq(token.value, '', 'and the variable must be empty');
  // T-067: the v2.1 collection schema has no `secret` variable type; the environment file marks it.
  eq(token.type, 'string', 'with a schema-valid type');
  eq(buildPostmanEnvironment(SESSION, EVENTS).values.find((v) => v.key === 'token').type, 'secret', 'and marked secret in the environment');
  return auth.value;
});

test('no redacted marker is ever un-redacted', () => {
  const text = JSON.stringify(collection);
  ok(!/"password":"(?!«)/.test(text), 'a password value appeared in the collection');
  // D-1010-133: a credential-named body key is a declared, empty variable now, so the gap stays visible and fillable.
  ok(text.includes('{{password}}') && collection.variable.some((v) => v.key === 'password' && v.value === ''), 'the credential should show as a declared empty variable, not be silently dropped');
});

test('browser-set headers are not exported as if the tester chose them', () => {
  const post = all.find((i) => i.name.includes('/api/applications'));
  ok(!post.request.header.some((h) => /user-agent/i.test(h.key)), 'user-agent is noise in a collection');
  ok(post.request.header.some((h) => /content-type/i.test(h.key)), 'content-type is not');
  return post.request.header.map((h) => h.key);
});

console.log('\n— bodies —');

test('a JSON body is exported as pretty raw JSON', () => {
  const post = all.find((i) => i.name.includes('/api/applications'));
  eq(post.request.body.mode, 'raw', 'json should be raw');
  eq(post.request.body.options.raw.language, 'json', 'and marked as json');
  ok(post.request.body.raw.includes('\n'), 'and pretty-printed, or nobody will read it');
});

test('a form body becomes urlencoded pairs Postman can edit', () => {
  const c = buildPostmanCollection(SESSION, [
    net({ method: 'POST', url: '/f', reqBody: { kind: 'form', text: 'a=1&b=two' } }),
  ]);
  const item = flat(c.item)[0];
  eq(item.request.body.mode, 'urlencoded', 'form should be urlencoded');
  eq(item.request.body.urlencoded, [{ key: 'a', value: '1' }, { key: 'b', value: 'two' }], 'pairs');
});

test('a file upload is named rather than invented', () => {
  const c = buildPostmanCollection(SESSION, [
    net({ method: 'POST', url: '/u', reqBody: { kind: 'FormData', note: 'FormData body: not recorded' } }),
  ]);
  const item = flat(c.item)[0];
  eq(item.request.body.mode, 'formdata', 'a file upload is formdata');
  ok(/not recorded/.test(item.request.body.description), 'and it must say why it is empty');
});

console.log('\n— the environment —');

const env = buildPostmanEnvironment(SESSION, EVENTS);

test('the environment holds the values the collection does not', () => {
  const base = env.values.find((v) => v.key === 'baseUrl');
  eq(base.value, 'https://app.example.test', 'baseUrl belongs in the environment');
  return base.value;
});

test('a secret is still empty even in the environment', () => {
  const token = env.values.find((v) => v.key === 'token');
  eq(token.value, '', 'nothing fills a secret in for the tester');
  eq(token.type, 'secret', 'and Postman is told to mask it');
});

test('the environment warns that it is the half not to commit', () =>
  ok(/version control/i.test(env._qawrap_note), 'the warning has to travel with the file'));

console.log('\n— saying so first —');

test('the summary counts endpoints and requests separately', () => {
  const s = summarisePostman(SESSION, EVENTS);
  ok(s.requests > s.endpoints, 'six recordings, fewer endpoints');
  ok(s.secrets.includes('token'), 'the tester should be told what was held back');
  return s;
});

test('a session with no requests summarises as empty rather than throwing', () => {
  const s = summarisePostman(SESSION, [{ kind: 'dom', ts: 1 }]);
  eq(s.endpoints, 0, 'nothing recorded, nothing exported');
  eq(s.requests, 0, 'and it says so');
});

test('a session with no start URL does not crash the export', () => {
  const c = buildPostmanCollection({ ...SESSION, startUrl: null }, [
    net({ url: 'https://a.test/x' }),
  ]);
  ok(flat(c.item).length === 1, 'the request should still export');
  eq(c.variable.find((v) => v.key === 'baseUrl')?.value, 'https://a.test', 'with no start URL the first http(s) request supplies the origin (r3-postman-baseurl)');
});

console.log('\n— council-1009 lane C ——');

test('11-7 repeated path variables get distinct keys; the endpoint key stays stable', () => {
  const c = buildPostmanCollection(SESSION, [net({ url: '/orders/1/items/2' }), net({ url: '/orders/7/items/9' })]);
  const items = [];
  (function walk(list) { for (const i of list) (i.item ? walk(i.item) : items.push(i)); })(c.item);
  eq(items.length, 1, 'both recordings are one endpoint');
  const u = items[0].request.url;
  ok(u.raw.endsWith('/orders/:id/items/:id2'), `raw should number the repeat, got ${u.raw}`);
  eq(u.variable.map((v) => v.key), ['id', 'id2'], 'two distinct variable keys');
  eq(u.path, ['orders', ':id', 'items', ':id2'], 'path parts agree with raw');
});

test('11-8 every header-derived environment value is secret, empty; x-csrf-token is declared empty', () => {
  const evs = [net({ reqHeaders: { 'x-api-key': 'k', 'x-csrf-token': 'c', authorization: 'Bearer z' } })];
  const col = buildPostmanCollection(SESSION, evs);
  const e = buildPostmanEnvironment(SESSION, evs);
  eq(e.values.find((v) => v.key === 'x_api_key').type, 'secret', 'x-api-key is secret');
  const csrf = e.values.find((v) => v.key === 'x_csrf_token');
  ok(csrf && csrf.value === '' && csrf.type === 'secret', 'x-csrf-token is declared empty and secret');
  eq(e.values.find((v) => v.key === 'baseUrl').type, 'default', 'baseUrl is not secret');
  ok(!JSON.stringify(col).includes('"c"'), 'the csrf value did not leak');
  ok(summarisePostman(SESSION, evs).secrets.includes('x_api_key'), 'the summary names it too');
});

const API_EVENT = net({
  via: 'api',
  method: 'POST',
  url: 'https://app.example.test/api/echo',
  status: 200,
  reqHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Trace', value: 'a' }, { name: 'x-trace', value: 'b' }],
  reqBody: '{"a":1}',
  resHeaders: [{ name: 'content-type', value: 'application/json; charset=utf-8' }],
  resBody: '{"ok":true}',
});

test('r3-11-1 a hand-sent (via:api) event exports a Content-Type key, a raw JSON body and a response example', () => {
  const col = buildPostmanCollection(SESSION, [API_EVENT]);
  const req = flat(col.item)[0].request;
  ok(req.header.some((h) => h.key === 'Content-Type' && h.value === 'application/json'), `Content-Type key: ${JSON.stringify(req.header)}`);
  ok(!req.header.some((h) => /^\d+$/.test(h.key) || h.value === '[object Object]'), 'no array-index key or [object Object]');
  eq(req.header.filter((h) => h.key === 'X-Trace').map((h) => h.value), ['a, b'], 'a repeated header is folded once');
  eq(req.body.mode, 'raw', 'raw body');
  eq(req.body.options.raw.language, 'json', 'json language');
  eq(JSON.parse(req.body.raw), { a: 1 }, 'body round-trips');
  const ex = flat(col.item)[0].response[0];
  eq(ex.body, '{"ok":true}', 'resBody becomes the example body');
  eq(ex._postman_previewlanguage, 'json', 'json preview');
  ok(ex.header.some((h) => h.key === 'content-type'), 'response header key is a name, not an index');
});

test('r3-11-1 normaliseNetEvent leaves a recorder-shaped event untouched and infers kind from content-type', () => {
  const e = net({ reqHeaders: { a: 'b' } });
  ok(normaliseNetEvent(e) === e, 'same object for the recorder shape');
  const f = normaliseNetEvent(net({ reqHeaders: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }], reqBody: 'a=1&b=2' }));
  eq(f.reqBody, { kind: 'form', text: 'a=1&b=2' }, 'form kind');
  eq(normaliseNetEvent(net({ reqHeaders: [], reqBody: 'plain' })).reqBody, { kind: 'text', text: 'plain' }, 'text kind');
});

test('r3-11-4 baseUrl is never "null": about:blank / chrome:// / file:// starts fall back to the first http(s) event origin', () => {
  for (const startUrl of ['about:blank', 'chrome://newtab/', 'file:///C:/x.html']) {
    const s = { ...SESSION, startUrl };
    const evs = [net({ url: 'https://api.example.test/v1/a' }), net({ url: 'https://other.test/b' })];
    const col = buildPostmanCollection(s, evs);
    eq(col.variable.find((v) => v.key === 'baseUrl').value, 'https://api.example.test', `baseUrl for ${startUrl}`);
    ok(!JSON.stringify(col).includes('"null"'), 'no "null" string');
    eq(buildPostmanEnvironment(s, evs).values.find((v) => v.key === 'baseUrl').value, 'https://api.example.test', 'environment agrees');
  }
  const none = buildPostmanCollection({ ...SESSION, startUrl: 'about:blank' }, []);
  ok(!none.variable.some((v) => v.key === 'baseUrl'), 'no http(s) event, no baseUrl variable');
});

test('r5-11-3 the Authorization header keeps its recorded scheme word, never the credential', () => {
  const scheme = (authorization) => {
    const c = buildPostmanCollection(SESSION, [net({ method: 'POST', url: '/api/x', reqHeaders: { authorization } })]);
    const item = flat(c.item)[0];
    return item.request.header.find((h) => /^authorization$/i.test(h.key)).value;
  };
  eq(scheme('Basic dXNlcjpwdw=='), 'Basic {{token}}', 'Basic stays Basic');
  eq(scheme('Bearer abc.def'), 'Bearer {{token}}', 'Bearer stays Bearer');
  eq(scheme('rawtokenwithoutscheme'), 'Bearer {{token}}', 'no scheme defaults to Bearer');
  ok(!scheme('Basic dXNlcjpwdw==').includes('dXNl'), 'and the credential is not in the file');
});

test('r3-postman-baseurl with no start URL at all, baseUrl is the first http(s) event origin, in the collection and the environment', () => {
  const evs = [net({ url: '/relative/only' }), net({ url: 'https://api.example.test/v1/a' }), net({ url: 'https://other.test/b' })];
  for (const startUrl of [null, undefined, '']) {
    const s = { ...SESSION, startUrl };
    eq(buildPostmanCollection(s, evs).variable.find((v) => v.key === 'baseUrl').value, 'https://api.example.test', `collection for ${String(startUrl)}`);
    eq(buildPostmanEnvironment(s, evs).values.find((v) => v.key === 'baseUrl').value, 'https://api.example.test', 'environment agrees');
  }
});

/* ── council-1010 r2-11-1 / r2-11-2 ── */

const NETEV = (url, extra = {}) => ({ kind: 'net', method: 'GET', url, status: 200, ts: 1, ...extra });

test('r2-11-1 a query value named token, api_key, password, sig or an Arabic secret name becomes {{name}} in url.raw and url.query; ?q= is kept', () => {
  const url = 'https://app.example.test/api?q=hello&token=abcDEF123456&api_key=KKKK1234&password=hunter22&sig=Zm9vYmFy&' + encodeURIComponent('كلمة المرور') + '=sirr1234';
  const col = buildPostmanCollection(SESSION, [NETEV(url)]);
  const text = JSON.stringify(col);
  for (const v of ['abcDEF123456', 'KKKK1234', 'hunter22', 'Zm9vYmFy', 'sirr1234']) ok(!text.includes(v), `${v} leaked`);
  const u = col.item[0].request.url;
  const q = Object.fromEntries(u.query.map((x) => [x.key, x.value]));
  eq(q.q, 'hello', 'a plain parameter keeps its value');
  eq(q.token, '{{token}}', 'token');
  eq(q.api_key, '{{api_key}}', 'api_key');
  eq(q.sig, '{{sig}}', 'sig');
  ok(u.raw.includes('q=hello') && u.raw.includes('token={{token}}') && u.raw.includes('password={{password}}'), u.raw);
  for (const k of ['token', 'api_key', 'password', 'sig']) ok(col.variable.some((v) => v.key === k && v.value === ''), `${k} is declared empty`);
  eq(buildPostmanEnvironment(SESSION, [NETEV(url)]).values.find((v) => v.key === 'api_key').type, 'secret', 'and secret in the environment');
  const plain = buildPostmanCollection(SESSION, [NETEV('https://app.example.test/s?q=a+b&page=2')]);
  eq(plain.item[0].request.url.raw, '{{baseUrl}}/s?q=a+b&page=2', 'no secret, the query is untouched');
});

test('r2-11-2 two GraphQL operations and a JSON-RPC method on one endpoint are separate items with their own bodies; a plain REST pair is still one', () => {
  const post = (path, body) => NETEV('https://app.example.test' + path, { method: 'POST', reqBody: { kind: 'json', text: JSON.stringify(body) } });
  const col = buildPostmanCollection(SESSION, [
    post('/graphql', { operationName: 'GetUser', query: 'query GetUser { user { id } }' }),
    post('/graphql', { query: 'mutation SaveUser($i: Int) { saveUser(i: $i) { id } }' }),
    post('/graphql', { operationName: 'GetUser', query: 'query GetUser { user { id } }' }),
    post('/rpc', { jsonrpc: '2.0', method: 'user.get', id: 1 }),
    post('/rpc', { jsonrpc: '2.0', method: 'user.set', id: 2 }),
    NETEV('https://app.example.test/p/1'),
    NETEV('https://app.example.test/p/2'),
  ]);
  const names = col.item.map((i) => i.name);
  eq(names, ['POST /graphql (GetUser)', 'POST /graphql (SaveUser)', 'POST /rpc (user.get)', 'POST /rpc (user.set)', 'GET /p/:id'], 'one item per operation');
  ok(col.item[0].request.body.raw.includes('GetUser') && col.item[1].request.body.raw.includes('SaveUser'), 'each keeps its own body');
  eq(endpointKey(post('/graphql', {}), SESSION.startUrl), 'POST https://app.example.test/graphql', 'endpointKey itself is unchanged');
});


console.log('\n— D-1010-133 / D-1010-134: credentials held back with redaction off —');

const SECRETS = ['hunter2', 'K-123', 'SECRET-OAUTH', 'tok-body', 'live-bearer-xyz', 'cookie-val-1', 'q-token-abc'];
const HOSTILE = [
  net({ method: 'POST', url: '/login', reqHeaders: { authorization: 'Bearer live-bearer-xyz', cookie: 'sid=cookie-val-1', 'x-api-key': 'K-123' },
    reqBody: { kind: 'json', text: '{"user":"sara","password":"hunter2","nested":{"api_key":"K-123","ok":1},"list":[{"token":"tok-body"}],"remember":true}' } }),
  net({ method: 'POST', url: '/form', reqBody: { kind: 'form', text: 'a=1&password=hunter2&access_token=tok-body' } }),
  net({ method: 'POST', url: '/multi', reqBody: { kind: 'FormData', parts: [{ name: 'client_secret', value: 'SECRET-OAUTH' }, { name: 'note', value: 'plain note' }, { name: 'doc', file: { name: 'a.pdf', type: 'application/pdf', size: 3 } }] } }),
  net({ method: 'POST', url: '/cut', reqBody: { kind: 'json', text: '{"name":"x","password":"hunter2","tail":"abc' } }),
  net({ method: 'GET', url: '/q?token=q-token-abc&page=2' }),
];

test('hostile bodies and headers with redaction off carry no credential value', () => {
  const col = buildPostmanCollection(SESSION, HOSTILE);
  const text = JSON.stringify(col);
  for (const secret of SECRETS) ok(!text.includes(secret), 'a credential value is in the collection: ' + secret);
  ok(text.includes('plain note') && text.includes('sara') && text.includes('remember'), 'non-credential fields are kept');
  const keys = col.variable.map((v) => v.key);
  for (const k of ['token', 'password', 'api_key', 'client_secret', 'access_token', 'cookie', 'x_api_key']) ok(keys.includes(k) || keys.some((x) => x.startsWith(k + '_')), 'declared: ' + k);
  ok(col.variable.filter((v) => v.key !== 'baseUrl').every((v) => v.value === ''), 'every credential variable is empty');
  const multi = flat(col.item).find((i) => i.name.includes('/multi'));
  eq(multi.request.body.formdata.find((p) => p.key === 'client_secret').value, '{{client_secret}}', 'FormData text part');
  const cut = flat(col.item).find((i) => i.name.includes('/cut'));
  ok(!cut.request.body.raw.includes('hunter2') && cut.request.body.raw.includes('{{password}}'), 'a body cut off at the cap is masked by pattern');
});

test('a response Set-Cookie header is not copied into an example', () => {
  const col = buildPostmanCollection(SESSION, [net({ url: '/r', resHeaders: { 'set-cookie': 'sid=resp-cookie-9', 'content-type': 'text/plain' } })]);
  ok(!JSON.stringify(col).includes('resp-cookie-9'), 'the Set-Cookie value left in the collection');
});

test('two distinct credentials get two variables (token, token_2) and a repeated one keeps its name', () => {
  const col = buildPostmanCollection(SESSION, [
    net({ url: '/a', reqHeaders: { authorization: 'Bearer one' } }),
    net({ url: '/b?token=other-token', reqHeaders: { authorization: 'Bearer one' } }),
    net({ url: '/c?token=other-token' }),
  ]);
  const keys = col.variable.map((v) => v.key);
  eq(keys.filter((k) => k === 'token' || k === 'token_2'), ['token', 'token_2'], 'the header keeps token, the query gets token_2');
  const items = flat(col.item);
  eq(items.find((i) => i.name.includes('/a')).request.header.find((h) => /authorization/i.test(h.key)).value, 'Bearer {{token}}', 'header uses token');
  eq(items.find((i) => i.name.includes('/b')).request.url.query[0].value, '{{token_2}}', 'query uses token_2');
  eq(items.find((i) => i.name.includes('/c')).request.url.query[0].value, '{{token_2}}', 'the same query credential reuses token_2');
});

test('r7-11-2: a literal {{ in page-derived header, query, urlencoded and raw values is broken to "{ {"; only the generated variables keep {{', () => {
  const col = buildPostmanCollection(SESSION, [
    net({ method: 'POST', url: '/g1?q={{$guid}}&x=%7B%7B$randomInt%7D%7D', reqHeaders: { 'x-trace': '{{$guid}}', authorization: 'Bearer abc' }, reqBody: { kind: 'json', text: '{"id":"{{$guid}}","password":"hunter2hunter2"}' } }),
    net({ method: 'POST', url: '/g2', reqHeaders: { 'content-type': 'application/x-www-form-urlencoded' }, reqBody: { kind: 'form', text: 'a=%7B%7B%24guid%7D%7D&b={{$timestamp}}&password=hunter2hunter2' } }),
    net({ method: 'POST', url: '/g3', reqBody: { kind: 'text', text: 'hello {{$randomUUID}}' } }),
  ]);
  const generated = new Set(col.variable.map((v) => v.key));
  const stray = (txt) => [...String(txt).matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1]).filter((n) => !generated.has(n) && n !== 'baseUrl');
  for (const it of flat(col.item)) {
    const r = it.request;
    const texts = [r.url.raw, ...r.url.query.map((p) => p.value), ...r.header.map((h) => h.value), r.body?.raw, ...(r.body?.urlencoded || []).map((p) => p.value)].filter((t) => t != null);
    for (const t of texts) eq(stray(t), [], `${it.name}: a page-derived {{ survived in ${JSON.stringify(t)}`);
    ok(/\{ \{/.test(r.description), `${it.name}: the description names the change`);
  }
  const g2 = flat(col.item).find((i) => i.name.includes('/g2')).request.body.urlencoded;
  eq(g2.find((p) => p.key === 'a').value, '{ {$guid}}', 'the encoded form value is broken after decoding');
  ok(g2.find((p) => p.key === 'password').value.startsWith('{{'), 'the generated variable for a credential key is intact');
  ok(!JSON.stringify(col).includes('hunter2hunter2'), 'the credential value is still held back');
});

test('D-1010-173: a custom credential header (Private-Token, X-Goog-Api-Key) is declared empty and secret; a benign one keeps its value', () => {
  const evs = [net({ reqHeaders: { 'Private-Token': 'glpat-secretvalue1', 'X-Goog-Api-Key': 'AIzaSecretValue', 'X-Trace-Id': 'trace-1' } })];
  const col = buildPostmanCollection(SESSION, evs);
  const e = buildPostmanEnvironment(SESSION, evs);
  const text = JSON.stringify(col) + JSON.stringify(e);
  ok(!text.includes('glpat-secretvalue1') && !text.includes('AIzaSecretValue'), 'neither credential value is in the file');
  for (const k of ['private_token', 'x_goog_api_key']) eq(e.values.find((v) => v.key === k)?.type, 'secret', `${k} is a secret variable`);
  ok(text.includes('trace-1'), 'a benign header keeps its value');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
