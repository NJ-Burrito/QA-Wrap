/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The --changed selection of the test pipeline (lane P2, council-1012; recipe = rehearsal R12): the import graph, the string-path
 * edges that only tools/ sources count, directory expansion, hub escalation, the i18n parity pair, the unmapped-path fallback, and
 * ten historical fix commits (frozen in tools/fixtures/select-history.json, so the test needs no git history).
 *
 *   node tools/test-pipeline-select.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sel from './lib-select.mjs';
import { recycle } from './lib-trash.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`); }
}

const m = sel.loadManifest(EXT);
const t0 = Date.now();
const g = sel.buildGraph(EXT, m);
const buildMs = Date.now() - t0;
const reachable = m.rows.filter(sel.isReachable).length;
const pick = (...files) => sel.selectChanged(m, g, files);

console.log('A. the real graph');
test(`the graph builds in under 15 s (${buildMs} ms) and maps the product tree`, () => {
  assert.ok(buildMs < 15000, `${buildMs} ms`);
  assert.ok(g.reverse.size > 500, `${g.reverse.size} files reached by some suite`);
});
test('a core module selects the suites that import it, with the reason', () => {
  const r = pick('extension/core/secret-scan.js');
  assert.ok(r.ids.includes('test-secret-scan'));
  assert.match(r.reasons['test-secret-scan'][0], /imports\/reads extension\/core\/secret-scan\.js/);
  assert.ok(!r.escalated && r.ids.length < reachable / 2, `${r.ids.length} of ${reachable}`);
});
test('a content script selects its tests but not the whole tier', () => {
  const r = pick('extension/content/mask.js');
  assert.ok(r.ids.length > 3 && r.ids.length < reachable / 2 && !r.escalated, `${r.ids.length}`);
});
test('a changed test file selects itself', () => {
  const r = pick('extension/tools/test-copy.mjs');
  assert.ok(r.ids.includes('test-copy'));
  assert.match(r.reasons['test-copy'][0], /changed: extension\/tools\/test-copy\.mjs/);
});
test('Windows slashes and case do not matter', () => {
  const r = pick('Extension\\Core\\Secret-Scan.js'.replaceAll('\\', '/'));
  assert.ok(r.ids.includes('test-secret-scan'));
});
test('a hub file escalates to the whole regression tier and says so; headed rows stay out of the escalation', () => {
  for (const hub of ['extension/popup/popup.js', 'extension/background/service-worker.js', 'extension/report/report.js', 'extension/manifest.json', 'extension/tools/lib-launch.mjs', 'extension/package.json']) {
    const r = pick(hub);
    assert.ok(r.escalated && r.hubHits.includes(hub), hub);
    const reg = sel.selectTier(m, 'regression').ids;
    assert.deepEqual(reg.filter((id) => !r.ids.includes(id)), [], hub);
    assert.match(r.warnings.join(' '), /hub file changed/);
  }
});
test('en.json or ar.json also adds the two i18n parity suites; the order is lane order', () => {
  for (const f of ['extension/platform/i18n/en.json', 'extension/platform/i18n/ar.json']) {
    const r = pick(f);
    for (const id of m.i18nParity) assert.ok(r.ids.includes(id), `${f}: ${id}`);
    assert.ok(r.parity);
  }
  const r = pick('extension/core/secret-scan.js', 'extension/content/mask.js');
  const rank = Object.fromEntries(sel.LANES.map((l, i) => [l, i]));
  for (let i = 1; i < r.ids.length; i++) assert.ok(rank[m.byId.get(r.ids[i - 1]).lane] <= rank[m.byId.get(r.ids[i]).lane], 'lane order');
});
test('the hand map only adds the feature smoke member (a path the graph cannot see is still mapped)', () => {
  const r = pick('extension/options/not-yet-imported.js');
  assert.ok(r.ids.includes(m.featureSmoke['options-settings']) && r.unmapped.length === 0);
  assert.match(r.reasons[m.featureSmoke['options-settings']][0], /hand map/);
});
test('nothing changed = smoke; an unmapped path adds the smoke tier and a warning', () => {
  const none = pick();
  assert.equal(none.picked, 'smoke');
  assert.deepEqual(none.ids, sel.selectTier(m, 'smoke').ids);
  const u = pick('somewhere/new-file.xyz');
  assert.deepEqual(u.unmapped, ['somewhere/new-file.xyz']);
  for (const id of sel.selectTier(m, 'smoke').ids) assert.ok(u.ids.includes(id), id);
  assert.match(u.warnings.join(' '), /unmapped path/);
});
test('--changed never satisfies the delivery gate: deliveryGate false, a NEXT line, NOT RUN counted', () => {
  for (const r of [pick('extension/core/secret-scan.js'), pick('extension/popup/popup.js'), pick()]) {
    assert.equal(r.deliveryGate, false);
    assert.equal(r.next, 'npm run t full');
    assert.equal(r.notRun, reachable - r.ids.length);
  }
});
test('a selection never contains a live, optIn or tool row', () => {
  const bad = new Set(m.rows.filter((r) => !sel.isReachable(r)).map((r) => r.id));
  for (const f of ['extension/popup/popup.js', 'extension/tools/jira-live.mjs', 'extension/tools/uat.mjs', 'extension/core/secret-scan.js']) assert.deepEqual(pick(f).ids.filter((id) => bad.has(id)), [], f);
});

console.log('B. ten historical fix commits (R12): --changed selects the suite the fix itself added or changed');
const hist = JSON.parse(fs.readFileSync(path.join(EXT, 'tools', 'fixtures', 'select-history.json'), 'utf8')).commits;
test('the fixture holds ten commits with changed files and expected suites', () => {
  assert.equal(hist.length, 10);
  assert.ok(hist.every((c) => c.changed.length && c.expected.length));
});
let hit = 0;
let total = 0;
for (const c of hist) {
  test(`${c.commit} (${c.subject.slice(0, 50)}): ${c.expected.length} expected suite(s) selected`, () => {
    const r = sel.selectChanged(m, g, c.changed);
    const miss = c.expected.filter((e) => !r.ids.includes(e));
    hit += c.expected.length - miss.length;
    total += c.expected.length;
    assert.deepEqual(miss, [], `selected ${r.ids.length} of ${reachable}${r.escalated ? ' (hub escalation)' : ''}`);
  });
}
test(`overall ${hit} of ${total} expected suites selected (R12 reached 19 of 20 before the @reads annotation)`, () => assert.equal(hit, total));

console.log('C. the graph rules on a throw-away tree');
const PARENT = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-ps-'));
let seq = 0;
function tree(files, suites) {
  const root = path.join(PARENT, `t${seq++}`);
  const ext = path.join(root, 'extension');
  for (const [rel, text] of Object.entries(files)) { const p = path.join(ext, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
  const man = { rows: suites.map((s) => ({ id: path.basename(s.path, '.mjs'), kind: 'test', lane: 'node', features: [], tags: [], ...s })) };
  man.byId = new Map(man.rows.map((r) => [r.id, r]));
  return { ext, man, graph: sel.buildGraph(ext, man), root };
}
const closureOf = (t, id) => [...t.graph.suiteClosure.get(id)].map((f) => f.replace(/^extension\//, '')).sort();
test('import, export-from and import() edges are followed, relative only', () => {
  const t = tree({
    'core/a.js': "import { b } from './b.js';\nexport { c } from './c.js';\nexport const a = 1;\n", 'core/b.js': 'export const b = 1;\n', 'core/c.js': 'export const c = 1;\n', 'core/d.js': 'export const d = 1;\n',
    'tools/test-x.mjs': "import { a } from '../core/a.js';\nimport fs from 'node:fs';\nconst m = await import('../core/d.js');\n",
  }, [{ path: 'tools/test-x.mjs' }]);
  assert.deepEqual(closureOf(t, 'test-x'), ['core/a.js', 'core/b.js', 'core/c.js', 'core/d.js', 'tools/test-x.mjs']);
});
test('string path reads in a tools/ source count: path.join literals, bare dir/file.ext literals, directories expanded, template prefixes', () => {
  const t = tree({
    'core/one.js': 'x\n', 'core/two.js': 'x\n', 'popup/p.js': 'x\n', 'popup/q.js': 'x\n', 'ui/u.css': 'x\n', 'report/r.js': 'x\n', 'report/s.js': 'x\n',
    'tools/test-s.mjs': "import path from 'node:path';\nconst EXT = '.';\nconst a = path.join(EXT, 'core', 'one.js');\nconst b = 'ui/u.css';\nconst c = path.join(EXT, 'popup');\nconst d = (n) => `report/${n}.js`;\n",
  }, [{ path: 'tools/test-s.mjs' }]);
  assert.deepEqual(closureOf(t, 'test-s'), ['core/one.js', 'popup/p.js', 'popup/q.js', 'report/r.js', 'report/s.js', 'tools/test-s.mjs', 'ui/u.css']);
});
test('string edges are read from tools/ only: a product file naming another file creates no edge', () => {
  const t = tree({ 'core/a.js': "export const n = 'core/b.js';\n", 'core/b.js': 'x\n', 'tools/test-p.mjs': "import { n } from '../core/a.js';\n" }, [{ path: 'tools/test-p.mjs' }]);
  assert.deepEqual(closureOf(t, 'test-p'), ['core/a.js', 'tools/test-p.mjs']);
});
test('a string edge never points into tools/test-*.mjs, and the exempt release scripts add none', () => {
  const t = tree({
    'tools/test-q.mjs': "const o = 'tools/test-other.mjs';\nconst z = 'core/z.js';\n", 'tools/test-other.mjs': 'x\n', 'core/z.js': 'x\n',
    'tools/lib-zip.mjs': "export const all = 'core/z.js';\n", 'tools/test-r.mjs': "import './lib-zip.mjs';\n",
  }, [{ path: 'tools/test-q.mjs' }, { path: 'tools/test-r.mjs' }]);
  assert.deepEqual(closureOf(t, 'test-q'), ['core/z.js', 'tools/test-q.mjs']);
  assert.deepEqual(closureOf(t, 'test-r'), ['tools/lib-zip.mjs', 'tools/test-r.mjs']);
});
test('new URL("../dir/", import.meta.url) expands the folder; a manifest `reads` entry does the same for array-driven walkers', () => {
  const t = tree({
    'content/k.js': 'x\n', 'content/l.js': 'x\n', 'popup/p.js': 'x\n', 'welcome/w.js': 'x\n',
    'tools/test-u.mjs': "const DIR = new URL('../content/', import.meta.url);\n", 'tools/test-v.mjs': "const SURFACES = ['popup', 'welcome'];\n",
  }, [{ path: 'tools/test-u.mjs' }, { path: 'tools/test-v.mjs', reads: ['popup', 'welcome'] }]);
  assert.deepEqual(closureOf(t, 'test-u'), ['content/k.js', 'content/l.js', 'tools/test-u.mjs']);
  assert.deepEqual(closureOf(t, 'test-v'), ['popup/p.js', 'tools/test-v.mjs', 'welcome/w.js']);
});
test('targets stay inside extension/ and helper/: a literal naming work/ or a root folder adds nothing', () => {
  const t = tree({ 'tools/test-w.mjs': "const a = 'work/big/file.json';\nconst b = '../dist/x.zip';\n" }, [{ path: 'tools/test-w.mjs' }]);
  fs.mkdirSync(path.join(t.root, 'work', 'big'), { recursive: true });
  fs.writeFileSync(path.join(t.root, 'work', 'big', 'file.json'), '{}');
  const g2 = sel.buildGraph(t.ext, t.man);
  assert.deepEqual([...g2.suiteClosure.get('test-w')].map((f) => f.replace(/^extension\//, '')), ['tools/test-w.mjs']);
});
test('selectChanged on the throw-away tree: the reverse index, the self rule, the hub rule', () => {
  const t = tree({ 'core/a.js': 'x\n', 'tools/test-x.mjs': "import '../core/a.js';\n", 'tools/lib-y.mjs': 'x\n' }, [{ path: 'tools/test-x.mjs' }]);
  t.man.hubFiles = ['extension/tools/lib-*.mjs'];
  t.man.tiers = { smoke: { tag: 'smoke' }, regression: { lanes: ['node'], byHand: false, measure: false } };
  t.man.unmappedOk = [{ glob: 'extension/*.md', reason: 'docs' }];
  t.man.featureSmoke = {};
  const one = sel.selectChanged(t.man, t.graph, ['extension/core/a.js']);
  assert.deepEqual(one.ids, ['test-x']);
  const hub = sel.selectChanged(t.man, t.graph, ['extension/tools/lib-y.mjs']);
  assert.ok(hub.escalated && hub.ids.includes('test-x'));
  const doc = sel.selectChanged(t.man, t.graph, ['extension/NOTES.md']);
  assert.deepEqual(doc.unmapped, []);
  assert.equal(doc.ignored[0].reason, 'docs');
});

console.log('D. vocabulary and the nearest words');
test('vocabulary lists tiers, features, lanes, tags and suite ids; nearest finds a typo', () => {
  const v = sel.vocabulary(m);
  assert.ok(v.tiers.includes('smoke') && v.features.includes('popup') && v.lanes.includes('headed') && v.tags.includes('byHand') && v.suites.includes('test-copy'));
  assert.ok(sel.nearest(m, 'popap').includes('popup'));
  assert.equal(sel.nearest(m, 'test-sleep', 3).length, 3);
});
test('changedFiles returns repo-relative posix paths from git (an array, possibly empty)', () => {
  const files = sel.changedFiles();
  assert.ok(Array.isArray(files) && files.every((f) => !f.includes('\\')));
});

const cleanup = recycle(PARENT, 'qaw-ps fixtures');
test('the fixture trees went to the recycle bin', () => assert.ok(cleanup.ok));

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
