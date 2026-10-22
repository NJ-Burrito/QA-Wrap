/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Session replay: the mutation log, and the promise that a masked value is
 * never written down.
 *
 * ── the claim under test, and why it is tested this way ────────────────────
 *
 * "Masking applies at record time" is either true of the bytes or it is
 * marketing. So this file does not check that `content/replay-recorder.js`
 * *looks* right: it runs the shipped file, in a Node sandbox, against a DOM
 * made of plain objects, and then searches the serialised log for the secret
 * string. If `SECRET` appears anywhere in `JSON.stringify(log)`, the feature has
 * failed however clean the code reads.
 *
 * Running the real file matters. A copy of the serialiser here would pass
 * forever while the shipped one drifted, and the shipped one is the one that
 * writes to a tester's disk.
 *
 * The playback half (`core/replay.js`) is a plain module and is imported
 * normally.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { stateAt, toHtml, toDocument, span, failureMarks, humanSize, indexNodes } from '../core/replay.js';
import { workerSrc as allWorkerSrc } from './lib-worker-src.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];
const later = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') { // an async case: settled before the summary
      later.push(r.then(() => { passed++; console.log(`  ok  ${name}`); }, (err) => { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }));
      return;
    }
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

/* ── a DOM made of plain objects ────────────────────────────────────────────
 *
 * Enough of one for the serialiser: node types, attributes, children, and the
 * three things a field has. Deliberately not jsdom — a dependency for this
 * would be a dependency in the package's tree, and what is being tested is
 * whether a string survives a walk, which needs no browser.
 */
const SECRET = 'Ahmad Al-Masri 9891012345';

function elem(tag, attrs = {}, children = [], extra = {}) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    _attrs: { ...attrs },
    childNodes: children,
    parentElement: null,
    ...extra,
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n); },
    getAttribute(n) { return this._attrs[n] ?? null; },
    setAttribute(n, v) { this._attrs[n] = String(v); },
    matches() { return false; },
  };
  Object.defineProperty(node, 'attributes', {
    get() { return Object.entries(this._attrs).map(([name, value]) => ({ name, value })); },
  });
  for (const c of children) if (c && typeof c === 'object') c.parentElement = node;
  return node;
}
const text = (v) => ({ nodeType: 3, nodeValue: v, parentElement: null });

/** The shipped recorder, loaded into a sandbox with just enough globals. */
function loadRecorder() {
  const sandbox = {
    console,
    performance: { now: () => 0 },
    requestAnimationFrame: (fn) => fn(),
    setInterval: () => 0,
    clearInterval: () => {},
    MutationObserver: class { observe() {} disconnect() {} },
    document: { documentElement: null, title: 'fixture' },
    location: { href: 'https://example.test/form' },
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1280,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'content/replay-recorder.js'), 'utf8'), sandbox, {
    filename: 'content/replay-recorder.js',
  });
  return { api: sandbox.window.UQAReplayRecorder, sandbox };
}

console.log('session replay — the log, and what never reaches it');

/* ── serialising ────────────────────────────────────────────────────────── */

test('the recorder loads and exports its serialiser', () => {
  const { api } = loadRecorder();
  assert.equal(typeof api?.serialize, 'function');
  assert.equal(typeof api?.masked, 'function');
});

test('an ordinary element is recorded with its tag, attributes and text', () => {
  const { api } = loadRecorder();
  const node = api.serialize(elem('p', { class: 'lead' }, [text('Submit the application')]));
  assert.equal(node.n, 'P');
  assert.equal(node.a.class, 'lead');
  assert.equal(node.c[0].v, 'Submit the application');
});

test('a script is never serialised, even when the page has one', () => {
  const { api } = loadRecorder();
  const div = elem('div', {}, [elem('script', {}, [text('alert(1)')]), elem('b', {}, [text('kept')])]);
  const out = api.serialize(div);
  assert.equal(out.c.length, 1);
  assert.equal(out.c[0].n, 'B');
  assert.ok(!JSON.stringify(out).includes('alert(1)'));
});

test('a url attribute is stored empty, so a log cannot fetch anything', () => {
  const { api } = loadRecorder();
  const img = api.serialize(elem('img', { src: 'https://tracker.example/pixel.gif', alt: 'x' }));
  assert.equal(img.a.src, '');
  assert.equal(img.a.alt, 'x');
});

test('an inline handler attribute is dropped rather than stored', () => {
  const { api } = loadRecorder();
  const b = api.serialize(elem('button', { onclick: 'steal()', id: 'go' }));
  assert.equal(b.a.onclick, undefined);
  assert.equal(b.a.id, 'go');
});

/* ── the masking claim ──────────────────────────────────────────────────── */

test('a masked element is recorded as a block, and its text is not in the log', () => {
  const { api } = loadRecorder();
  const cell = elem('td', { 'data-uqa-masked': '' }, [text(SECRET)]);
  const row = elem('tr', {}, [elem('td', {}, [text('Applicant')]), cell]);
  const out = api.serialize(row);
  const json = JSON.stringify(out);
  assert.ok(!json.includes(SECRET), `the masked text reached the log: ${json.slice(0, 200)}`);
  assert.ok(json.includes('"masked":true'), 'the block was not marked as masked');
  assert.ok(json.includes('Applicant'), 'the unmasked cell beside it was lost');
});

test('nothing below a masked element is walked, however deep', () => {
  const { api } = loadRecorder();
  const deep = elem('div', { 'data-uqa-masked': '' }, [
    elem('div', {}, [elem('span', {}, [elem('em', {}, [text(SECRET)])])]),
  ]);
  const out = api.serialize(deep);
  assert.equal(out.c.length, 0);
  assert.equal(out.masked, true);
  assert.ok(!JSON.stringify(out).includes(SECRET));
});

test('a masked field records the placeholder, not what was typed', () => {
  const { api } = loadRecorder();
  const field = elem('input', { 'data-uqa-masked-field': '', name: 'national-id' }, [], { value: SECRET, type: 'text' });
  const out = api.serialize(field);
  assert.ok(!JSON.stringify(out).includes(SECRET));
  assert.equal(out.value, api.placeholder());
  // Fixed length: a mask that leaks the length is not a mask.
  assert.notEqual(out.value.length, SECRET.length);
});

test('a password field is masked whether or not anyone marked it', () => {
  const { api } = loadRecorder();
  const pw = elem('input', { name: 'pw' }, [], { value: 'hunter2', type: 'password' });
  assert.ok(!JSON.stringify(api.serialize(pw)).includes('hunter2'));
});

test('an unmasked field keeps its value, or the replay shows an empty form', () => {
  const { api } = loadRecorder();
  const field = elem('input', { name: 'city' }, [], { value: 'Amman', type: 'text' });
  assert.equal(api.serialize(field).value, 'Amman');
});

test('D-1010-91 / r5-03-1: a maskExtraPattern that does not compile masks every text-class input (placeholder), with one warning; a valid pattern still matches', () => {
  const { api, sandbox } = loadRecorder();
  const warns = []; sandbox.console = { ...console, warn: (...a) => warns.push(a.join(' ')) };
  sandbox.window.UQASettings = { maskExtraPattern: '(' };
  const field = elem('input', { name: 'city' }, [], { value: 'Amman', type: 'text', name: 'city' });
  const area = elem('textarea', { name: 'notes' }, [], { value: 'free text', name: 'notes' });
  const check = elem('input', { name: 'agree' }, [], { value: 'on', type: 'checkbox' });
  assert.equal(api.serialize(field).value, api.placeholder(), 'a broken pattern must fail closed');
  assert.equal(api.serialize(area).value, api.placeholder());
  assert.equal(api.serialize(check).value, 'on', 'a checkbox is not text-class');
  assert.equal(warns.length, 1, `one warning, got ${warns.length}`);
  sandbox.window.UQASettings = { maskExtraPattern: 'city' };
  assert.equal(api.serialize(field).value, api.placeholder(), 'a valid pattern matches the name');
  assert.equal(api.serialize(area).value, 'free text', 'a valid pattern does not mask the rest');
});

test('a text mutation inside a masked subtree is dropped, not substituted', () => {
  const { api, sandbox } = loadRecorder();
  const masked = elem('div', { 'data-uqa-masked': '' }, []);
  const node = text(SECRET);
  node.parentElement = masked;
  sandbox.window.UQAReplayRecorder._start('s1');
  api.onMutations([{ type: 'characterData', target: node }]);
  const json = JSON.stringify(api._buffer());
  assert.ok(!json.includes(SECRET), `a masked mutation reached the buffer: ${json}`);
  sandbox.window.UQAReplayRecorder._stop();
});

test('an attribute change on a masked element is not logged either', () => {
  const { api, sandbox } = loadRecorder();
  const masked = elem('div', { 'data-uqa-masked': '', title: SECRET }, []);
  sandbox.window.UQAReplayRecorder._start('s1');
  api.onMutations([{ type: 'attributes', target: masked, attributeName: 'title' }]);
  assert.ok(!JSON.stringify(api._buffer()).includes(SECRET));
  sandbox.window.UQAReplayRecorder._stop();
});

test('an ordinary mutation IS logged, so the test above is not passing by doing nothing', () => {
  const { api, sandbox } = loadRecorder();
  const el = elem('p', { class: 'was' }, []);
  el._attrs.class = 'now';
  sandbox.window.UQAReplayRecorder._start('s1');
  api.onMutations([{ type: 'attributes', target: el, attributeName: 'class' }]);
  // `_start` takes the snapshot first, so the mutation is the entry after it.
  const buffer = api._buffer();
  assert.equal(buffer.length, 2);
  assert.equal(buffer[0].k, 'snapshot');
  assert.equal(buffer[1].k, 'attr');
  assert.equal(buffer[1].v, 'now');
  sandbox.window.UQAReplayRecorder._stop();
});

/* ── playback ───────────────────────────────────────────────────────────── */

const snapshot = {
  k: 'snapshot',
  t: 0,
  url: 'https://example.test/form',
  title: 'Form',
  w: 1280,
  h: 800,
  x: 0,
  y: 0,
  doc: {
    t: 1,
    id: 1,
    n: 'HTML',
    a: {},
    c: [
      {
        t: 1,
        id: 2,
        n: 'BODY',
        a: {},
        c: [
          { t: 1, id: 3, n: 'H1', a: {}, c: [{ t: 3, v: 'Apply' }] },
          { t: 1, id: 4, n: 'INPUT', a: { name: 'city' }, c: [], value: '' },
        ],
      },
    ],
  },
};
const LOG = [
  snapshot,
  { k: 'input', t: 500, id: 4, v: 'Amman' },
  { k: 'text', t: 900, id: 3, v: 'Applied' },
  { k: 'add', t: 1200, parent: 2, before: null, nodes: [{ t: 1, id: 9, n: 'P', a: { class: 'err' }, c: [{ t: 3, v: 'Failed' }] }] },
  { k: 'scroll', t: 1500, x: 0, y: 240 },
  { k: 'remove', t: 1800, id: 3 },
];

test('the state at zero is the snapshot, and nothing after it', () => {
  const s = stateAt(LOG, 0);
  assert.equal(s.title, 'Form');
  assert.equal(toHtml(s.doc).includes('Apply'), true);
  assert.equal(toHtml(s.doc).includes('Applied'), false);
});

test('scrubbing forward applies each kind of change', () => {
  const s = stateAt(LOG, 1600);
  const html = toHtml(s.doc);
  assert.ok(html.includes('Applied'), 'a text change did not apply');
  assert.ok(html.includes('value="Amman"'), 'an input value did not apply');
  assert.ok(html.includes('class="err"'), 'an added node did not apply');
  assert.deepEqual(s.scroll, { x: 0, y: 240 });
});

test('scrubbing backwards gives exactly what that moment gave the first time', () => {
  // The property that makes a scrubber trustworthy: position, not history.
  assert.equal(toHtml(stateAt(LOG, 600).doc), toHtml(stateAt(LOG, 600).doc));
  assert.notEqual(toHtml(stateAt(LOG, 600).doc), toHtml(stateAt(LOG, 1600).doc));
  assert.equal(toHtml(stateAt(LOG, 0).doc), toHtml(stateAt(LOG, 0).doc));
});

test('a removed node is gone from the state after its moment', () => {
  assert.ok(toHtml(stateAt(LOG, 1700).doc).includes('Applied'));
  assert.ok(!toHtml(stateAt(LOG, 1900).doc).includes('Applied'));
});

test('an entry naming a node that is not there is counted, not thrown', () => {
  const s = stateAt([...LOG, { k: 'attr', t: 2000, id: 999, name: 'x', v: 'y' }], 3000);
  assert.equal(s.skipped, 1);
});

test('a log with no snapshot replays as nothing rather than as an exception', () => {
  assert.equal(stateAt([{ k: 'scroll', t: 1, x: 0, y: 0 }], 10), null);
});

test('every node in the snapshot is indexed by its id', () => {
  const { byId } = indexNodes(snapshot.doc);
  assert.deepEqual([...byId.keys()].sort((a, b) => a - b), [1, 2, 3, 4]);
});

/* ── the document that goes into the iframe ─────────────────────────────── */

test('the rendered document carries no script, no base and no live url', () => {
  const doc = toDocument(
    stateAt(
      [
        {
          ...snapshot,
          doc: {
            t: 1, id: 1, n: 'HTML', a: {}, c: [{
              t: 1, id: 2, n: 'BODY', a: {}, c: [
                { t: 1, id: 5, n: 'SCRIPT', a: {}, c: [{ t: 3, v: 'alert(1)' }] },
                { t: 1, id: 6, n: 'BASE', a: { href: 'https://evil.test/' }, c: [] },
                { t: 1, id: 7, n: 'IMG', a: { src: 'https://tracker.test/p.gif' }, c: [] },
              ],
            }],
          },
        },
      ],
      0
    )
  );
  assert.ok(!/<script/i.test(doc), 'a script reached the replay document');
  assert.ok(!/<base/i.test(doc), 'a base tag reached the replay document');
  assert.ok(!doc.includes('tracker.test'), 'a live url reached the replay document');
  assert.ok(doc.includes('about:blank'), 'the url was removed rather than made inert');
});

test('the rendered document declares a policy that fetches nothing', () => {
  const doc = toDocument(stateAt(LOG, 0));
  assert.match(doc, /default-src 'none'/);
});

test('text is escaped, so a page that contains markup cannot become markup', () => {
  const html = toHtml({ t: 1, id: 1, n: 'P', a: {}, c: [{ t: 3, v: '<img src=x onerror=go()>' }] });
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('&lt;img'));
});

/* ── the numbers the page prints ────────────────────────────────────────── */

test('the span is the first and last stamps in the log', () => {
  assert.deepEqual(span(LOG), { from: 0, to: 1800, ms: 1800 });
  assert.deepEqual(span([]), { from: 0, to: 0, ms: 0 });
});

test('failure marks are the failed events, on the session clock', () => {
  const marks = failureMarks(
    [
      { ts: 1000, fail: 0, kind: 'click' },
      { ts: 2500, fail: 1, kind: 'net', method: 'POST', url: '/api/apply' },
    ],
    1000
  );
  assert.equal(marks.length, 1);
  assert.equal(marks[0].t, 1500);
  assert.match(marks[0].what, /POST \/api\/apply/);
});

test('sizes read as a person would say them', () => {
  assert.equal(humanSize(0), '0 B');
  assert.equal(humanSize(900), '900 B');
  assert.equal(humanSize(2048), '2 KB');
  assert.equal(humanSize(3 * 1024 * 1024), '3.0 MB');
});

/* ── r3-03-1: the replay log passes the same two layers as every other record ─
 *
 * Layer 3 (names) is the recorder: a field recorder.js would mask is a placeholder here too.
 * Layer 2 (shapes) is the worker: UQA_REPLAY_CHUNK runs every string leaf of an entry through
 * redact() before putReplayChunk. The worker cannot be imported, so its scrubReplay is lifted from
 * the real file and run against the real redact(). */

const workerSrc = allWorkerSrc();
const { redact: redactReal } = await import('../core/privacy.js');
const { lift } = await import('./lib-lift.mjs');
const keepLine = workerSrc.match(/^const REPLAY_KEEP = .*;$/m)?.[0] ?? 'const REPLAY_KEEP = new Set();';
const makeReplayScrub = (cfg) => new Function('scrubCfg', 'loadScrubCfg', 'redact', `${keepLine}\nasync ${lift(workerSrc, 'scrubReplay')}\nreturn scrubReplay;`)(cfg, async () => cfg, redactReal);

const CARD_NO = '4539 1488 0343 6467'; // Luhn-valid, not a published test number
const JWT_TXT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
const chunk = () => [
  { k: 'snapshot', t: 1, tree: { t: 1, id: 1, n: 'BODY', a: { class: 'x', 'data-note': `ref ${CARD_NO}` }, c: [{ t: 3, v: `session ${JWT_TXT} end` }, { t: 1, id: 2, n: 'INPUT', a: {}, value: `pay ${CARD_NO}`, c: [] }] } },
  { k: 'input', id: 2, v: CARD_NO },
  { k: 'text', id: 1, v: `header ${JWT_TXT}` },
  { k: 'attr', id: 1, name: 'title', v: 'plain title text here' },
  { k: 'add', parent: 1, nodes: [{ t: 3, v: `{"password":"hunter2abc"}` }] },
];
const scrubbed = await makeReplayScrub({ on: true, extra: [] })(chunk());
const untouched = await makeReplayScrub({ on: false, extra: [] })(chunk());
const scrubbedJson = JSON.stringify(scrubbed);

test('r3-03-1: a Luhn card in an input value, a JWT in a text node and a password in added markup never reach the stored chunk', () => {
  for (const secret of ['4539 1488', 'eyJhbGci', 'hunter2abc']) assert.ok(!scrubbedJson.includes(secret), `${secret} survived: ${scrubbedJson.slice(0, 300)}`);
  assert.ok(scrubbedJson.includes('••••••••'));
  assert.ok(JSON.stringify(untouched).includes('4539 1488'), 'with redaction switched off the chunk is left as the page sent it');
});

test('r3-03-1: the structure of the log survives the scrub (kinds, ids, tag names, attribute names, plain text)', () => {
  const [snap, input, , attr] = scrubbed;
  assert.equal(snap.k, 'snapshot');
  assert.equal(snap.tree.n, 'BODY');
  assert.equal(snap.tree.c[1].n, 'INPUT');
  assert.equal(snap.tree.a.class, 'x');
  assert.equal(input.id, 2);
  assert.equal(attr.name, 'title');
  assert.equal(attr.v, 'plain title text here');
});

test('D-1010-104 / r5-06-2: a failed chunk write keeps the recorder recording and writes one replay-gap note per page', async () => {
  const a = workerSrc.indexOf('  UQA_REPLAY_CHUNK: async'); const b = workerSrc.indexOf('/* The log, inflated');
  assert.ok(a > 0 && b > a, 'UQA_REPLAY_CHUNK handler not found');
  const notes = [];
  const build = new Function('activeSessionId', 'policy', 'armed', 'belongsToSession', 'putReplayChunk', 'appendEvent', 'replayGapPages', 'replayRefused', 'replayBytes', `return ({ ${workerSrc.slice(a, b).trim().replace(/,$/, '')} });`);
  const h = build(async () => 's1', async () => ({}), { assertMayRecord: async () => {} }, () => true, async () => { throw new Error('QuotaExceededError'); }, async (e) => { notes.push(e); }, new Set(), async () => false, new Map());
  const send = () => h.UQA_REPLAY_CHUNK({ entries: [{ k: 'x' }] }, { tab: { id: 7 } });
  const r1 = await send(); const r2 = await send();
  for (const r of [r1, r2]) { assert.equal(r.recording, true, 'the recorder must keep going'); assert.equal(r.stored, false); }
  assert.equal(notes.length, 1, 'one gap note per page, not one per chunk');
  assert.equal(notes[0].tag, 'replay-gap');
  assert.equal(notes[0].kind, 'note');
});

test('D-206 / r9-06-2: past the per-session replay cap, or on low disk, the wrapper refuses REPLAY_CAP; the handler answers reason replay-cap with one digit-free capture-gap note and keeps recording', async () => {
  const x = workerSrc.indexOf('  UQA_REPLAY_CHUNK: async'); const y = workerSrc.indexOf('/* The log, inflated');
  const notes = []; let refuse = true;
  const build = new Function('activeSessionId', 'policy', 'armed', 'belongsToSession', 'putReplayChunk', 'appendEvent', 'replayGapPages', `return ({ ${workerSrc.slice(x, y).trim().replace(/,$/, '')} });`);
  const h = build(async () => 's1', async () => ({}), { assertMayRecord: async () => {} }, () => true, async () => { if (refuse) throw Object.assign(new Error('cap'), { code: 'REPLAY_CAP' }); return { stored: 100 }; }, async (e) => { notes.push(e); }, new Set());
  const send = () => h.UQA_REPLAY_CHUNK({ entries: [{ k: 'x' }] }, { tab: { id: 7 } });
  const r1 = await send(); const r2 = await send();
  for (const r of [r1, r2]) assert.deepEqual([r.recording, r.stored, r.reason], [true, false, 'replay-cap']);
  assert.equal(notes.length, 1, 'one note, not one per chunk');
  assert.deepEqual([notes[0].tag, notes[0].gap, /[0-9]/.test(notes[0].text)], ['capture-gap', 'replay-cap', false]);
  refuse = false;
  assert.equal((await send()).stored, 100);
  assert.ok(workerSrc.includes('replayBytes.get(sessionId) >= 256 * 1024 * 1024'));
  assert.ok(workerSrc.includes('(await replaySize(sessionId)'), 'seeded from the store after a wake');
  assert.ok(workerSrc.includes('replayBytes.set(chunk.sessionId, (replayBytes.get(chunk.sessionId) || 0) + (out?.stored || 0))'), 'stored bytes are added');
});

test('r3-03-1: every write to the replay store goes through the scrub (the putReplayChunk the handler calls is the scrubbing wrapper)', () => {
  assert.match(workerSrc, /putReplayChunk as putReplayChunkRaw/);
  assert.ok(workerSrc.includes('const putReplayChunk = async (chunk) => {') && workerSrc.includes('const out = await putReplayChunkRaw({ ...chunk, entries: await scrubReplay(chunk.entries) });'));
  assert.equal((workerSrc.match(/putReplayChunkRaw\(/g) || []).length, 1, 'the raw writer is called in one place only');
});

test('r3-03-1: a credit-card, one-time-code or secret-named field records the placeholder, however it is typed into', () => {
  const { api, sandbox } = loadRecorder();
  const fields = [
    elem('input', { name: 'cc', autocomplete: 'cc-number' }, [], { value: CARD_NO, type: 'text', autocomplete: 'cc-number' }),
    elem('input', { name: 'code', autocomplete: 'one-time-code' }, [], { value: '493021', type: 'text', autocomplete: 'one-time-code' }),
    elem('input', { name: 'cvv' }, [], { value: '913', type: 'text', name: 'cvv' }),
    elem('input', { id: 'user-otp' }, [], { value: '772910', type: 'tel', id: 'user-otp' }),
    elem('input', { name: 'x', 'aria-label': 'Card number' }, [], { value: CARD_NO, type: 'text' }),
  ];
  for (const f of fields) {
    assert.equal(api.secretField(f), true, `${f._attrs.name || f._attrs.id} should be secret`);
    const out = api.serialize(f);
    assert.equal(out.value, api.placeholder());
    api._start('s1');
    api.onInput({ target: f });
    const logged = JSON.stringify(api._buffer());
    assert.ok(!/4539|493021|\b913\b|772910/.test(logged), `a secret reached the buffer: ${logged}`);
    api._stop();
  }
  const city = elem('input', { name: 'city' }, [], { value: 'Amman', type: 'text' });
  assert.equal(api.secretField(city), false);
  assert.equal(api.serialize(city).value, 'Amman');
  void sandbox;
});

test('r3-03-1: the replay recorder keeps the same secret-name words as content/recorder.js', () => {
  const words = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').match(/const SECRET_NAMES = new Set\((\[.*?\])\)/)[1]).sort();
  assert.deepEqual(words('content/replay-recorder.js'), words('content/recorder.js'));
});

test('r2-02-3: an attribute name that is not a plain name never reaches the markup', () => {
  const html = toHtml({ t: 1, id: 1, n: 'P', a: { class: 'ok', 'data-ok': '1', 'x onmouseover=alert(1) y': 'v', '"><img src=x onerror=alert(1)>': 'v', 'a=b': 'v', '1bad': 'v' }, c: [{ t: 3, v: 'hi' }] });
  assert.ok(html.includes('class="ok"') && html.includes('data-ok="1"'), html);
  assert.ok(!html.includes('onmouseover') && !html.includes('<img') && !html.includes('a=b') && !html.includes('1bad'), html);
});

test('r7-05-1 (D-1010-152): a secret field keeps no value attribute, a secret textarea no children, a secret meta no content; the canary is absent from the serialisation and from _buffer()', () => {
  const CANARY = 'CANARY-9f3a71c2e8';
  const { api, sandbox } = loadRecorder();
  const pw = elem('input', { name: 'pw', type: 'password', value: CANARY }, [], { value: CANARY, type: 'password' });
  const hidden = elem('input', { name: 'csrf_token', type: 'hidden', value: CANARY }, [], { value: CANARY, type: 'hidden', name: 'csrf_token' });
  const area = elem('textarea', { name: 'api_secret' }, [text(CANARY)], { value: CANARY, name: 'api_secret' });
  const meta = elem('meta', { name: 'csrf-token', content: CANARY }, []);
  const form = elem('form', {}, [pw, hidden, area, meta]);
  const out = api.serialize(form);
  assert.ok(!JSON.stringify(out).includes(CANARY), `the canary survived serialize: ${JSON.stringify(out)}`);
  // ordinary fields and metas are untouched, so the cases above are not passing by dropping everything
  const city = elem('input', { name: 'city', value: 'Amman' }, [], { value: 'Amman', type: 'text' });
  const note = elem('textarea', { name: 'note' }, [text('hello')], { value: 'hello', name: 'note' });
  const viewport = elem('meta', { name: 'viewport', content: 'width=device-width' }, []);
  const ok = api.serialize(elem('form', {}, [city, note, viewport]));
  assert.equal(ok.c[0].a.value, 'Amman');
  assert.equal(ok.c[1].c[0].v, 'hello');
  assert.equal(ok.c[2].a.content, 'width=device-width');
  // the live path: a snapshot and then mutations
  sandbox.document.documentElement = form;
  api._start('s1');
  api.onMutations([
    { type: 'attributes', target: pw, attributeName: 'value' },
    { type: 'attributes', target: hidden, attributeName: 'value' },
    { type: 'attributes', target: meta, attributeName: 'content' },
    { type: 'characterData', target: area.childNodes[0] },
    { type: 'childList', target: area, addedNodes: [text(CANARY)], removedNodes: [] },
  ]);
  assert.ok(!JSON.stringify(api._buffer()).includes(CANARY), `the canary reached the buffer: ${JSON.stringify(api._buffer())}`);
  api._stop();
});

test('r8-06-5: the next replay seq is read as one key through a reverse cursor over 2,000 chunks, and getAll is never called', async () => {
  await import('fake-indexeddb/auto');
  const db = await import('../core/db.js?r8-06-5');
  for (let i = 0; i < 2000; i++) await db.putReplayChunk({ sessionId: 'big', seq: i, entries: [{ i }] });
  await db.putReplayChunk({ sessionId: 'big2', seq: 7, entries: [{ other: 1 }] });
  const calls = { getAll: 0, cursor: 0 };
  const realIdx = IDBIndex.prototype.getAll;
  const realStore = IDBObjectStore.prototype.getAll;
  const realKey = IDBObjectStore.prototype.openKeyCursor;
  IDBIndex.prototype.getAll = function (...a) { calls.getAll++; return realIdx.apply(this, a); };
  IDBObjectStore.prototype.getAll = function (...a) { calls.getAll++; return realStore.apply(this, a); };
  IDBObjectStore.prototype.openKeyCursor = function (...a) { calls.cursor++; return realKey.apply(this, a); };
  try {
    // a fresh module instance has no seq memo: the seed must come from the store
    const fresh = await import('../core/db.js?r8-06-5-fresh');
    const put = await fresh.putReplayChunk({ sessionId: 'big', entries: [{ next: 1 }] });
    assert.equal(put.seq, 2000, 'the seed is the highest stored seq plus one');
    assert.equal((await fresh.putReplayChunk({ sessionId: 'big2', entries: [{ next: 1 }] })).seq, 8, 'another session is not mixed in');
    assert.equal((await fresh.putReplayChunk({ sessionId: 'empty', entries: [{ next: 1 }] })).seq, 0, 'a session with no chunks starts at 0');
  } finally {
    IDBIndex.prototype.getAll = realIdx; IDBObjectStore.prototype.getAll = realStore; IDBObjectStore.prototype.openKeyCursor = realKey;
  }
  assert.equal(calls.getAll, 0, 'no getAll while seeding');
  assert.equal(calls.cursor, 3, 'one reverse key cursor per fresh session');
});

await Promise.all(later);
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
