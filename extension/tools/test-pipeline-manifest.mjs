/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The test pipeline's manifest and ledgers (lane P2, council-1012): tools/test-manifest.json, human-checks.json,
 * autopilot-rules.json, gate-baseline.json, and the coverage checks C0-C9 in lib-select.mjs.
 *
 *   node tools/test-pipeline-manifest.mjs
 *
 * Part A runs the checks on the real tree (every test file is a row, every feature has a smoke member, every extension source file
 * maps to a suite, lane / headed / python / byHand agree with the source scan and QUARANTINE). Part B proves each check has teeth on a
 * throw-away tree in the OS temp folder (sent to the recycle bin at the end). Part C pins the auto-classification rule, Part D the
 * GATE LOOSENED comparison, Part E the exclusion of live and tool suites (S6).
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
const pkg = JSON.parse(fs.readFileSync(path.join(EXT, 'package.json'), 'utf8'));

console.log('A. the real tree');
const cov = sel.coverageCheck(EXT, m);
for (const code of ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9']) {
  test(`${code}: no problems`, () => {
    const mine = cov.problems.filter((p) => p.check === code);
    assert.deepEqual(mine.map((p) => p.msg), []);
  });
}
test('every tools/test*.mjs on disk is a row or a pending id, and every row file exists', () => {
  const rows = new Set(m.rows.map((r) => r.id));
  const pend = new Set(m.pendingRows || []);
  const missing = fs.readdirSync(path.join(EXT, 'tools')).filter((f) => /^test(-[\w-]+)?\.mjs$/.test(f)).map((f) => f.slice(0, -4)).filter((id) => !rows.has(id) && !pend.has(id));
  assert.deepEqual(missing, []);
  assert.deepEqual(m.rows.filter((r) => !fs.existsSync(path.resolve(EXT, r.path))).map((r) => r.id), []);
});
test('pendingRows is a short-lived list: not already rows, and it expires', () => {
  assert.ok(m.pendingExpires, 'pendingExpires is set');
  assert.deepEqual((m.pendingRows || []).filter((id) => m.byId.has(id)), []);
});
test('manifest shape: version 2, five lanes in order, tiers with the delivery gate on full and release only', () => {
  assert.equal(m.version, 2);
  assert.deepEqual(m.laneOrder, sel.LANES);
  assert.deepEqual(Object.keys(m.tiers).filter((t) => m.tiers[t].deliveryGate).sort(), ['full', 'release']);
  for (const t of ['smoke', 'regression', 'e2e', 'full', 'release']) assert.ok(m.tiers[t], `tier ${t}`);
});
test('features: the 16 of the draft plus ai-writing, tutorials-films and game, each with a smoke member listing it', () => {
  assert.equal(m.features.length, 19);
  for (const f of ['ai-writing', 'tutorials-films', 'game']) assert.ok(m.features.includes(f), f);
  for (const f of m.features) {
    const s = m.byId.get(m.featureSmoke[f]);
    assert.ok(s, `${f} has a smoke member`);
    assert.ok(s.features.includes(f) && s.tags.includes('smoke') && s.tags.includes('canary'), `${f}: ${s.id} is a tagged canary of the feature`);
  }
});
test('the smoke tier lists its members in order and starts with the cheap gates', () => {
  assert.deepEqual(m.smokeOrder.slice(0, 4), ['test-pipeline-manifest', 'test-types', 'test-worker-loads', 'test-boot-zip']);
  const pend = new Set(m.pendingRows);
  for (const id of m.smokeOrder) assert.ok(m.byId.has(id) || pend.has(id), id);
  assert.deepEqual(m.rows.filter((r) => r.tags.includes('smoke')).map((r) => r.id).filter((id) => !m.smokeOrder.includes(id)), []);
});
test('timeouts: null with timeoutSource guess, or a stated one that is measured (self-a11y outgrew the 300 s default); lane defaults exist', () => {
  assert.deepEqual(m.rows.filter((r) => (r.timeout === null ? r.timeoutSource !== 'guess' : r.timeoutSource !== 'measured' || !(r.measuredSeconds > 0))).map((r) => r.id), []);
  for (const l of sel.LANES) assert.ok(m.lanes[l].defaultTimeout > 0, l);
});
test('tags equal the tags derived from the fields on every row, and feature tags resolve', () => {
  for (const r of m.rows) {
    for (const t of sel.deriveTags(r)) assert.ok(r.tags.includes(t), `${r.id} lacks ${t}`);
    assert.ok(sel.tagsOf(r).includes(`feature:${(r.features || [])[0]}`) || !(r.features || []).length, r.id);
  }
});
test('C4 byHand: the manifest equals QUARANTINE byHand for every test row', () => {
  const q = sel.readQuarantine(EXT);
  const qIds = Object.keys(q).filter((id) => q[id].byHand);
  assert.ok(qIds.length >= 25, `QUARANTINE read: ${qIds.length} byHand entries`);
  assert.deepEqual(qIds.filter((id) => m.byId.has(id) && !m.byId.get(id).byHand), []);
  assert.deepEqual(m.rows.filter((r) => r.byHand && !q[r.id]).map((r) => r.id), []);
});

console.log('A2. the seat 1 corrections are in');
const row = (id) => m.byId.get(id);
test('stage rows: harvest unit, sleep-stop headless and content-page, popup-structure and handlers unit (no longer smoke), film readers static', () => {
  assert.equal(row('test-harvest').stage, 'unit');
  assert.equal(row('test-sleep-stop').lane, 'headless');
  assert.ok(row('test-sleep-stop').features.includes('content-page'));
  assert.equal(row('test-popup-structure').stage, 'unit');
  assert.equal(row('test-handlers').stage, 'unit');
  for (const id of ['test-film-transitions', 'test-listing-assets', 'test-listing-assets-ar', 'test-films-hosted']) assert.equal(row(id).stage, 'static', id);
  assert.equal(row('test-perf-worker').lane, 'node');
});
test('release rows: seven contract/unit rows keep the release tag, test-truth is headless byHand, manifest-check is headed', () => {
  for (const id of ['test-security-headers', 'test-signature', 'test-vendor-risk', 'test-store-registry', 'test-support-bundle', 'test-managed-flavour', 'test-release-guard']) {
    assert.ok(row(id).tags.includes('release') && row(id).stage === 'contract' && ['gate', 'node'].includes(row(id).lane), id);
  }
  assert.equal(row('test-truth').lane, 'headless');
  assert.ok(row('test-truth').byHand && row('test-truth').tags.includes('release'));
  assert.ok(row('manifest-check').headed && row('manifest-check').lane === 'headed');
});
test('python: only test-glyphs and the plain-python filing suite are hard, formats-contract / eml / portable-zip soft, self-a11y none', () => {
  assert.deepEqual(m.rows.filter((r) => r.python === 'hard').map((r) => r.id).sort(), ['test-glyphs', 'test-report-filing-live']);
  assert.deepEqual(m.rows.filter((r) => r.python === 'soft').map((r) => r.id).sort(), ['test-eml', 'test-formats-contract', 'test-game-voice', 'test-pipeline-verdict', 'test-portable-zip', 'test-voice-render']); // the last three in 1012: each spawns python once for the offline voice style gate or a fixture
  assert.equal(row('self-a11y').python, 'none');
  assert.equal(row('test-glyphs').pythonVia, ['u', 'v'].join(''));
});
test('features: trackers, sound, ai-write, agent-brief, films corrected', () => {
  assert.deepEqual(row('test-trackers').features, ['jira-integrations', 'privacy-security']);
  assert.deepEqual(row('test-sound').features, ['options-settings']);
  assert.deepEqual(row('test-ai-write').features, ['ai-writing', 'privacy-security']);
  assert.deepEqual(row('test-agent-brief').features, ['exporters-formats']);
  for (const id of ['test-film-transitions', 'test-films-hosted', 'test-tutorials']) assert.deepEqual(row(id).features, ['tutorials-films'], id);
});
test('the five harness suites are headed through the shared launcher; headlessOk is exactly the four R4 proved plus test-e2e-practice, not stable-layout', () => {
  for (const id of ['test-copy-length', 'test-done-card', 'test-reach-popup', 'test-stable-layout', 'test-autopilot-live', 'test-next-primary']) assert.equal(row(id).lane, 'headed', id);
  assert.deepEqual(m.rows.filter((r) => r.headlessOk).map((r) => r.id).sort(), ['test-copy-length', 'test-done-card', 'test-e2e-practice', 'test-next-primary', 'test-reach-popup']);
});
test('measure lane: perf is byHand and exclusive; test-speed and test-page-cost keep their resource lane but run serial', () => {
  assert.ok(row('perf').lane === 'measure' && row('perf').exclusive && row('perf').byHand);
  for (const id of ['test-speed', 'test-page-cost']) assert.ok(row(id).serial && row(id).lane !== 'measure', id);
});
test('assertMode: exit-code suites say why, the stub rules 4 and 5 are counted so a "0 passed" is red', () => {
  for (const id of ['test-copy', 'test-plurals', 'test-i18n', 'test-locator-truth', 'test-devil-d-literals']) assert.ok(row(id).assertMode === 'exitcode' && row(id).exitcodeReason, id);
  assert.equal(row('test-interrupted-and-keep').assertMode, 'counted');
  assert.ok(m.rows.filter((r) => r.assertMode === 'counted').length > 150);
});
test('test-i18n carries its @reads list (an array-driven walker the static scan cannot see)', () => {
  assert.ok(row('test-i18n').reads.includes('popup') && row('test-i18n').reads.includes('platform/i18n.js'));
});

console.log('B. every check has teeth (a throw-away tree)');
const PARENT = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-pm-'));
let seq = 0;
const withTags = (man) => { for (const r of man.suites) r.tags = [...new Set([...sel.deriveTags(r), ...r.tags])]; return man; };
const baseManifest = () => withTags({
  version: 2, laneOrder: sel.LANES, lanes: Object.fromEntries(sel.LANES.map((l) => [l, { defaultTimeout: 30 }])),
  tiers: { smoke: { tag: 'smoke', budgetSeconds: 1 }, regression: { lanes: ['gate', 'node', 'headless'], byHand: false, measure: false }, full: { lanes: sel.LANES, byHand: true, measure: true, deliveryGate: true }, release: { tag: 'release', deliveryGate: true } },
  requiredLanes: ['node', 'headed'], features: ['f1'], featureSmoke: { f1: 'test-a' }, smokeOrder: ['test-a'], pendingRows: [], hubFiles: [], changedMap: [], unmappedOk: [], infraScripts: [{ file: 'run-suites.mjs', reason: 'fixture runner' }],
  sourceScope: { ext: '\\.(m?js|json)$', skip: '^(tools/)' },
  suites: [
    { id: 'test-a', path: 'tools/test-a.mjs', kind: 'test', lane: 'node', features: ['f1'], tags: ['canary', 'smoke', 'release'], headed: false, python: 'none', net: 'none', timeout: null, timeoutSource: 'guess', assertMode: 'counted' },
    { id: 'test-b', path: 'tools/test-b.mjs', kind: 'test', lane: 'headed', features: ['f1'], tags: ['byHand'], headed: true, byHand: true, python: 'none', net: 'none', timeout: null, timeoutSource: 'guess', assertMode: 'counted' },
    { id: 'test-types', path: 'tools/test-types.mjs', kind: 'test', lane: 'gate', features: ['f1'], tags: [], headed: false, python: 'none', net: 'none', timeout: null, timeoutSource: 'guess', assertMode: 'exitcode', exitcodeReason: 'fixture' },
    { id: 'test-types-wide', path: 'tools/test-types-wide.mjs', kind: 'test', lane: 'gate', features: ['f1'], tags: [], headed: false, python: 'none', net: 'none', timeout: null, timeoutSource: 'guess', assertMode: 'exitcode', exitcodeReason: 'fixture' },
  ],
});
const ledgers = {
  'human-checks.json': { version: 1, items: [{ id: 'h1', title: 't', gesture: true, engine: 'chrome', lastTickedVersion: null, by: null, date: null }] },
  'autopilot-rules.json': { version: 1, rules: Array.from({ length: 12 }, (_, i) => ({ rule: i + 1, title: 'r', suites: ['test-a'], status: 'enforced' })) },
};
function build(mutate = () => {}) {
  const ext = path.join(PARENT, `t${seq++}`, 'extension');
  fs.mkdirSync(path.join(ext, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(ext, 'core'), { recursive: true });
  const w = (rel, text) => fs.writeFileSync(path.join(ext, rel), text);
  w('core/a.js', 'export const a = 1;\n');
  w('tools/test-a.mjs', "import { a } from '../core/a.js';\nconsole.log('  ok  a');\nconsole.log(`${a} passed, 0 failed`);\n");
  w('tools/lib-launch.mjs', 'export const x = 1;\n');
  w('tools/test-b.mjs', "import { x } from './lib-" + "launch.mjs';\nconsole.log('  ok  b', x);\nconsole.log('1 passed');\n");
  w('tools/run-suites.mjs', "const QUARANTINE = {\n  'test-b': { byHand: true, until: '2026-12-31', reason: 'x' },\n};\nconst KNOWN_RED = {};\n");
  w('tools/test-types.mjs', 'const BASELINE_COUNT = 5;\n');
  w('tools/test-types-wide.mjs', 'export const CEILINGS = { content: 1 };\n');
  w('tools/line-ratchet.json', JSON.stringify({ lines: { 'a.js': 10 }, swallows: {}, deadExportAllowlist: [] }));
  const man = baseManifest();
  const led = JSON.parse(JSON.stringify(ledgers));
  const ctx = { man, led, w, ext };
  mutate(ctx);
  w('tools/test-manifest.json', JSON.stringify(man));
  for (const [f, v] of Object.entries(led)) w(`tools/${f}`, JSON.stringify(v));
  const gb = { ceilings: {}, hashes: { quarantine: '', knownRed: '', allowLists: '', lineRatchet: '', budgets: '' }, assertions: {} };
  Object.assign(gb, sel.gateState(ext), { assertions: {} });
  w('tools/gate-baseline.json', JSON.stringify(ctx.baseline || gb));
  return ext;
}
const problemsOf = (ext) => sel.coverageCheck(ext, sel.loadManifest(ext), null, { today: '2026-10-12' }).problems;
const has = (ps, code, re) => ps.some((p) => p.check === code && re.test(p.msg));

test('the fixture tree itself is clean (so every red below comes from its one change)', () => {
  assert.deepEqual(problemsOf(build()).map((p) => `${p.check} ${p.msg}`), []);
});
test('C1: a tools/test*.mjs that is not a row is red; a pending id is a warning until it expires', () => {
  const ext = build(({ w }) => w('tools/test-new.mjs', "console.log('x');\n"));
  assert.ok(has(problemsOf(ext), 'C1', /test-new\.mjs is not in the manifest/));
  const ext2 = build(({ w, man }) => { w('tools/test-new.mjs', "console.log('x');\n"); man.pendingRows = ['test-new']; man.pendingExpires = '2026-10-19'; });
  assert.ok(!problemsOf(ext2).some((p) => p.check === 'C1'));
  const ext3 = build(({ w, man }) => { w('tools/test-new.mjs', "console.log('x');\n"); man.pendingRows = ['test-new']; man.pendingExpires = '2026-10-01'; });
  assert.ok(has(problemsOf(ext3), 'C1', /still lists 1 ids after 2026-10-01/));
});
test('C1: a row whose file is gone, a script with no row, and an infra script without a reason are red', () => {
  assert.ok(has(problemsOf(build(({ man }) => man.suites.push({ ...man.suites[0], id: 'test-gone', path: 'tools/test-gone.mjs' }))), 'C1', /test-gone: tools\/test-gone\.mjs does not exist/));
  assert.ok(has(problemsOf(build(({ w }) => w('tools/gen-thing.mjs', 'export {};\n'))), 'C1', /gen-thing\.mjs is neither a manifest row/));
  assert.ok(has(problemsOf(build(({ man }) => { man.infraScripts[0].reason = ''; })), 'C1', /reason required/));
});
test('C2: a feature without a smoke member, and a smoke member that is headed or not tagged, are red', () => {
  assert.ok(has(problemsOf(build(({ man }) => { man.features.push('f2'); })), 'C2', /feature f2 has no smoke member/));
  assert.ok(has(problemsOf(build(({ man }) => { man.featureSmoke.f1 = 'test-b'; })), 'C2', /must be a reachable node-only suite/));
  assert.ok(has(problemsOf(build(({ man }) => { man.suites[0].tags = man.suites[0].tags.filter((t) => t !== 'smoke'); })), 'C2', /not tagged smoke/));
});
test('C3: an extension source file that no suite reaches is red; an unmappedOk entry needs a reason and clears it', () => {
  const mk = (extra) => build(({ w, man }) => { w('core/orphan.js', 'export const o = 1;\n'); extra?.(man); });
  assert.ok(has(problemsOf(mk()), 'C3', /extension\/core\/orphan\.js maps to no suite/));
  assert.ok(!problemsOf(mk((man) => { man.unmappedOk = [{ glob: 'extension/core/orphan.js', reason: 'fixture' }]; })).some((p) => p.check === 'C3'));
  assert.ok(has(problemsOf(mk((man) => { man.unmappedOk = [{ glob: 'extension/core/orphan.js' }]; })), 'C3', /reason required/));
});
test('C4: byHand without QUARANTINE, QUARANTINE byHand without the row, a wrong lane, a wrong headed flag, a headed row not byHand', () => {
  assert.ok(has(problemsOf(build(({ man }) => { man.suites[0].byHand = true; man.suites[0].tags.push('byHand'); })), 'C4', /test-a: manifest byHand without a QUARANTINE entry/));
  assert.ok(has(problemsOf(build(({ man }) => { man.suites[1].byHand = false; man.suites[1].tags = man.suites[1].tags.filter((t) => t !== 'byHand'); })), 'C4', /QUARANTINE byHand but the manifest row is not/));
  assert.ok(has(problemsOf(build(({ man }) => { man.suites[1].lane = 'node'; })), 'C4', /test-b: lane node but the source scan says headed/));
  assert.ok(has(problemsOf(build(({ man }) => { man.suites[0].headed = true; man.suites[0].tags.push('x'); })), 'C4', /test-a: headed true but the source scan says false/));
});
test('C4: an override skips one field only when it states a reason', () => {
  const ov = (why) => build(({ man }) => { man.suites[1].lane = 'node'; man.suites[1].overrides = { lane: why }; });
  assert.ok(!has(problemsOf(ov('the harness runs it headless on purpose, stated here')), 'C4', /lane node/));
  assert.ok(has(problemsOf(ov('')), 'C4', /override of lane needs a stated reason/));
});
test('C4: python in the source needs a python row, and a python row needs the spawn', () => {
  const uv = ['u', 'v'].join('');
  assert.ok(has(problemsOf(build(({ w }) => w('tools/test-a.mjs', `import { spawnSync } from 'node:child_process';\nspawnSync('${uv}', ['--version']);\nconsole.log('1 passed');\n`))), 'C4', /spawns uv\/python but the row says python none/));
  assert.ok(has(problemsOf(build(({ man }) => { man.suites[0].python = 'soft'; man.suites[0].tags.push('needs-python:soft'); })), 'C4', /python soft but the source does not spawn/));
});
test('C5: a lane with no member and a tier that selects nothing are red', () => {
  assert.ok(has(problemsOf(build(({ man }) => { man.requiredLanes = ['node', 'headed', 'measure']; })), 'C5', /lane measure has no member/));
  const ps = problemsOf(build(({ man }) => { man.tiers.release.tag = 'nothing-has-this'; }));
  assert.ok(has(ps, 'C5', /tier release selects nothing/));
});
test('C6: an unknown feature on a row or in the hand map is red', () => {
  assert.ok(has(problemsOf(build(({ man }) => { man.suites[0].features = ['f9']; })), 'C6', /unknown feature f9/));
  assert.ok(has(problemsOf(build(({ man }) => { man.changedMap = [{ glob: 'extension/core/**', addFeatureSmoke: ['f9'] }]; })), 'C6', /changedMap/));
});
test('C0: a derived tag missing from the row, an exit-code suite with no reason, a stated timeout marked guess', () => {
  assert.ok(has(problemsOf(build(({ man }) => { man.suites[0].serial = true; })), 'C0', /tag serial missing/));
  assert.ok(has(problemsOf(build(({ man }) => { man.suites[0].assertMode = 'exitcode'; man.suites[0].tags.push('assertMode:exitcode'); })), 'C0', /needs exitcodeReason/));
  assert.ok(has(problemsOf(build(({ man }) => { man.suites[0].timeout = 99; })), 'C0', /stated timeout needs timeoutSource measured/));
});
test('C7 / C8: the ledgers must be complete (duplicate ids, a ticked item without by/date, 11 rules, a NOT ENFORCED rule without a reason, an unknown suite)', () => {
  assert.ok(has(problemsOf(build(({ led }) => led['human-checks.json'].items.push({ ...led['human-checks.json'].items[0] }))), 'C7', /duplicate id h1/));
  assert.ok(has(problemsOf(build(({ led }) => { led['human-checks.json'].items[0].lastTickedVersion = '3.4.1'; })), 'C7', /ticked item needs by and date/));
  assert.ok(has(problemsOf(build(({ led }) => led['autopilot-rules.json'].rules.pop())), 'C8', /expected 1\.\.12/));
  assert.ok(has(problemsOf(build(({ led }) => { led['autopilot-rules.json'].rules[3].status = 'NOT ENFORCED'; })), 'C8', /rule 4: NOT ENFORCED needs a reason/));
  assert.ok(has(problemsOf(build(({ led }) => { led['autopilot-rules.json'].rules[0].suites = ['test-nope']; })), 'C8', /test-nope is not in the manifest/));
});
test('C9: a raised ceiling, a new quarantine entry and a changed allow-list each read GATE LOOSENED against the stored baseline', () => {
  const ext = build();
  const base = JSON.parse(fs.readFileSync(path.join(ext, 'tools', 'gate-baseline.json'), 'utf8'));
  const ext2 = build(({ w }) => { w('tools/test-types.mjs', 'const BASELINE_COUNT = 9;\n'); });
  fs.writeFileSync(path.join(ext2, 'tools', 'gate-baseline.json'), JSON.stringify(base));
  assert.ok(has(problemsOf(ext2), 'C9', /GATE LOOSENED ceilings\.types: 5 -> 9/));
  const ext3 = build(({ w }) => { w('tools/run-suites.mjs', "const QUARANTINE = {\n  'test-b': { byHand: true, until: '2026-12-31', reason: 'x' },\n  'test-a': { byHand: true, until: '2026-12-31', reason: 'x' },\n};\nconst KNOWN_RED = {};\n"); });
  fs.writeFileSync(path.join(ext3, 'tools', 'gate-baseline.json'), JSON.stringify(base));
  assert.ok(has(problemsOf(ext3), 'C9', /GATE LOOSENED quarantine: test-a added/));
});

console.log('C. auto-classification (seat 1 rule), first match wins');
const cls = (name, text, extra = {}) => {
  const ext = build(({ w }) => { for (const [f, t] of Object.entries(extra)) w(f, t); w(`tools/${name}`, text); });
  return sel.classify(ext, `tools/${name}`);
};
const pw = ['import { chromium } from', " '", 'playwright', "';\n"].join('');
const hl = ['headless', ': ', 'false'].join('');
const L = ['lau', 'nch'].join('');
test('a transitive import of lib-launch is headed; a launch flag is headed; a bare browser import is headless', () => {
  assert.equal(cls('test-x1.mjs', "import './lib-launch.mjs';\n").lane, 'headed');
  assert.equal(cls('test-x2.mjs', `${pw}const b = await chromium.${L}({ ${hl} });\n`).lane, 'headed');
  assert.equal(cls('test-x3.mjs', `${pw}const b = await chromium.${L}();\n`).lane, 'headless');
  assert.equal(cls('test-x4.mjs', "import './lib-mid.mjs';\n", { 'tools/lib-mid.mjs': "import './lib-launch.mjs';\n" }).lane, 'headed');
});
test('the shared popup harness counts as headed through test-next-primary', () => {
  const c = cls('test-x5.mjs', "import { go } from './test-next-primary.mjs';\n", { 'tools/test-next-primary.mjs': "import './lib-launch.mjs';\nexport const go = 1;\n" });
  assert.ok(c.headed && c.lane === 'headed');
});
test('perf and stress names are measure; kind is script for a non-test file and test for a test file', () => {
  assert.equal(cls('perf-thing.mjs', 'console.log(1);\n').lane, 'measure');
  assert.equal(cls('stress.mjs', 'console.log(1);\n').kind, 'script');
  assert.equal(cls('test-x6.mjs', 'console.log(1);\n').kind, 'test');
});
test('gate = no product import, no dynamic import, no vm, no foreign spawn; anything else node', () => {
  assert.equal(cls('test-g1.mjs', "import fs from 'node:fs';\nconsole.log(fs.existsSync('.'));\n").lane, 'gate');
  assert.equal(cls('test-g2.mjs', "import { a } from '../core/a.js';\nconsole.log(a);\n").lane, 'node');
  assert.equal(cls('test-g3.mjs', "const m = await import('node:fs');\n").lane, 'node');
  assert.equal(cls('test-g4.mjs', "import vm from 'node:vm';\nvm.runInNewContext('1');\n").lane, 'node');
  assert.equal(cls('test-g5.mjs', "import { spawnSync } from 'node:child_process';\nspawnSync('tsc', ['--noEmit']);\n").lane, 'gate');
  assert.equal(cls('test-g6.mjs', "import { spawnSync } from 'node:child_process';\nspawnSync('node', ['x.mjs']);\n").lane, 'node');
});
test('python use is found; the trash helper is not python use', () => {
  const uv = ['u', 'v'].join('');
  assert.equal(cls('test-p1.mjs', `spawnSync('${uv}', ['run']);\n`).python, 'uses');
  assert.equal(cls('test-p2.mjs', "const TRASH = 'x';\nspawnSync('python', [TRASH, dir]);\n").python, 'none');
});
test('a // @suite header overrides the lane and is reported with its text; suggestRow proposes a complete row', () => {
  const c = cls('test-h1.mjs', '// @suite lane=measure reason=wall-clock ceilings\nconsole.log(1);\n');
  assert.equal(c.lane, 'measure');
  assert.equal(c.header.reason, 'wall-clock ceilings');
  const ext = build(({ w }) => w('tools/test-h2.mjs', "import './lib-launch.mjs';\n"));
  const s = sel.suggestRow(ext, 'tools/test-h2.mjs');
  assert.ok(s.id === 'test-h2' && s.lane === 'headed' && s.byHand && s.timeout === null && s.assertMode === 'counted');
});
test('the real tree: the scan puts the known files in the lanes the corrections name', () => {
  const want = { 'test-next-primary': 'headed', 'test-popup-structure': 'node', 'test-sleep-stop': 'headless', 'manifest-check': 'headed', 'test-worker-imports': 'node', 'test-boot-smoke': 'headed' };
  for (const [id, lane] of Object.entries(want)) assert.equal(sel.classify(EXT, `tools/${id}.mjs`).lane, lane, id);
});

console.log('D. GATE LOOSENED comparison');
const gs = (over = {}) => {
  const base = { ceilings: { types: 152, typesWide: { content: 47, ui: 10 } }, hashes: { knownRed: 'k', budgets: 'b' }, detail: { quarantine: { s1: { byHand: true, until: '2026-12-31' } }, allowLists: { 'tools/a.json': 'h1' }, lineRatchet: { lines: { 'a.js': 100 }, swallows: { 'a.js': 3 }, deadExportAllowlist: [] } } };
  return JSON.parse(JSON.stringify({ ...base, ...over }));
};
const kinds = (cur, b = gs()) => sel.compareGateState(cur, b).map((d) => `${d.kind}:${d.key}`);
test('an equal state reports nothing', () => assert.deepEqual(kinds(gs()), []));
test('a raised ceiling is loosened, a lowered one is tightened', () => {
  const up = gs(); up.ceilings.types = 153; up.ceilings.typesWide.content = 48;
  assert.deepEqual(kinds(up), ['loosened:ceilings.types', 'loosened:ceilings.typesWide.content']);
  const down = gs(); down.ceilings.types = 150;
  assert.deepEqual(kinds(down), ['tightened:ceilings.types']);
});
test('quarantine: added, extended and un-byHand-ed are loosened; removed is tightened', () => {
  const a = gs(); a.detail.quarantine.s2 = { byHand: true, until: '2026-12-31' };
  assert.deepEqual(kinds(a), ['loosened:quarantine']);
  const b = gs(); b.detail.quarantine.s1.until = '2027-06-30';
  assert.deepEqual(kinds(b), ['loosened:quarantine']);
  const c = gs(); c.detail.quarantine.s1.byHand = false;
  assert.deepEqual(kinds(c), ['loosened:quarantine']);
  const d = gs(); delete d.detail.quarantine.s1;
  assert.deepEqual(kinds(d), ['tightened:quarantine']);
});
test('a changed allow-list, a changed known-red table and a raised line ratchet are loosened; a new ratchet file is a plain change', () => {
  const a = gs(); a.detail.allowLists['tools/a.json'] = 'h2';
  assert.deepEqual(kinds(a), ['loosened:allowLists']);
  const b = gs(); b.hashes.knownRed = 'k2';
  assert.deepEqual(kinds(b), ['loosened:knownRed']);
  const c = gs(); c.detail.lineRatchet.lines['a.js'] = 101;
  assert.deepEqual(kinds(c), ['loosened:lineRatchet.lines.a.js']);
  const d = gs(); d.detail.lineRatchet.lines['new.js'] = 50;
  assert.deepEqual(kinds(d), ['changed:lineRatchet.lines']);
});
test('the stored baseline matches the tree now (no GATE LOOSENED), and its assertion counts name real suites', () => {
  const stored = JSON.parse(fs.readFileSync(path.join(EXT, 'tools', 'gate-baseline.json'), 'utf8'));
  assert.deepEqual(sel.compareGateState(sel.gateState(EXT), stored).filter((d) => d.kind !== 'tightened'), []);
  assert.ok(Object.keys(stored.assertions).length >= 15, 'measured assertion counts present');
  assert.ok(stored.ceilings.types > 0 && Object.keys(stored.ceilings.typesWide).length >= 6, 'ceilings read from test-types / test-types-wide');
  assert.deepEqual(Object.keys(stored.assertions).filter((id) => !m.byId.has(id)), []);
});
test('write-baseline refuses a missing reason', () => {
  assert.throws(() => sel.writeGateBaseline(build(), ''), /needs a reason/);
});

console.log('E. exclusion by construction (S6) and the ledgers');
test('no tier, lane, feature, tag or changed selection can return a live, optIn or tool row', () => {
  const bad = new Set(m.rows.filter((r) => !sel.isReachable(r)).map((r) => r.id));
  assert.ok(bad.size >= 45, `unreachable rows: ${bad.size}`);
  const picks = [];
  for (const t of Object.keys(m.tiers)) picks.push([`tier ${t}`, sel.selectTier(m, t).ids]);
  for (const l of sel.LANES) picks.push([`lane ${l}`, sel.selectLane(m, l).ids]);
  for (const f of m.features) picks.push([`feature ${f}`, sel.selectFeature(m, f).ids]);
  for (const t of sel.vocabulary(m).tags) picks.push([`tag ${t}`, sel.selectTag(m, t).ids]);
  for (const [name, ids] of picks) assert.deepEqual(ids.filter((id) => bad.has(id)), [], name);
  const g = sel.buildGraph(EXT, m);
  const everything = sel.selectChanged(m, g, ['extension/popup/popup.js', 'extension/core/harvest.js', 'extension/tools/test-manifest.json']);
  assert.deepEqual(everything.ids.filter((id) => bad.has(id)), []);
});
test('the named live suites are rejected with their reason; the loopback mock Jira suites are not live', () => {
  for (const [id, why] of [['jira-live', /liveCredentials/], ['store-status', /liveCredentials/], ['film-voice', /liveCredentials/], ['launch', /liveNetwork/], ['perf-editor', /kind:tool/], ['stress', /kind:tool/]]) {
    const r = sel.selectSuite(m, id);
    assert.deepEqual(r.ids, [], id);
    assert.match(r.rejected[0].reason, why, id);
  }
  assert.deepEqual(sel.selectSuite(m, 'test-jira-live').ids, ['test-jira-live']);
  assert.deepEqual(sel.selectSuite(m, 'test-report-filing-live').ids, ['test-report-filing-live']);
});
test('tiers: smoke is the tagged set in order; regression has no headed or byHand row; full has the measure lane; counts add up', () => {
  const sm = sel.selectTier(m, 'smoke').ids;
  assert.equal(sm[0], 'test-pipeline-manifest');
  assert.ok(sm.length >= 20 && sm.length <= 30, `smoke members: ${sm.length}`);
  const rg = sel.selectTier(m, 'regression').ids.map((id) => m.byId.get(id));
  assert.deepEqual(rg.filter((r) => r.headed || r.byHand || r.lane === 'measure').map((r) => r.id), []);
  const full = sel.selectTier(m, 'full').ids;
  assert.ok(full.includes('perf') && full.includes('test-boot-smoke') && full.includes('clickthrough'));
  assert.equal(full.length, m.rows.filter(sel.isReachable).length);
  assert.ok(sel.selectTier(m, 'e2e').ids.every((id) => ['headless', 'headed'].includes(m.byId.get(id).lane)));
});
test('human checks: all open on day one, gesture items counted, a ticked item leaves the open list', () => {
  const hc = sel.loadHumanChecks(EXT);
  assert.ok(hc.items.length >= 18);
  const now = sel.humanChecksOpen(hc, pkg.version);
  assert.equal(now.total, hc.items.length);
  assert.equal(now.notCoveredOnBrandedChrome, now.open.filter((i) => i.gesture).length);
  const ticked = JSON.parse(JSON.stringify(hc));
  ticked.items[0].lastTickedVersion = pkg.version;
  assert.equal(sel.humanChecksOpen(ticked, pkg.version).open.length, now.open.length - (now.open.includes(hc.items[0]) ? 1 : 0));
  assert.equal(sel.humanChecksOpen(ticked, '99.0.0').open.length, hc.items.length, 'a newer manifest version reopens every item');
  const ids = hc.items.map((i) => i.id);
  for (const need of ['toolbar-press-popup', 'popup-blur-reopen', 'permission-bubble', 'keyboard-chords', 'side-panel-toolbar', 'capture-pickers', 'native-messaging-prompt', 'store-install', 'upgrade-in-place', 'mailto-handoff', 'real-filing', 'downloads-folder', 'arabic-rtl-branded', 'screen-reader-contrast', 'real-sites', 'file-incognito-toggles', 'multi-monitor-dpi', 'enterprise-policy', 'storage-sync-profiles', 'branded-chrome-load']) assert.ok(ids.includes(need), need);
});
test('autopilot rules: 12 rules map to rows; all 12 are enforced (4 and 5 since REQ-P2-1..3) and the summary line says so', () => {
  const ar = sel.loadAutopilotRules(EXT);
  assert.equal(ar.rules.length, 12);
  for (const r of ar.rules) for (const s of r.suites) assert.ok(m.byId.has(s), `rule ${r.rule}: ${s}`);
  assert.deepEqual(ar.rules.filter((r) => r.status !== 'enforced').map((r) => r.rule), []);
  assert.equal(sel.autopilotSummary(ar), 'AUTOPILOT RULES: 12 enforced, 0 NOT ENFORCED');
  assert.deepEqual(ar.rules[0].suites, ['test-next-primary']);
  assert.deepEqual(ar.rules[11].suites, ['test-autopilot-privacy', 'test-autostart', 'test-autoshot']);
});
test('globs: ** crosses folders, * does not, braces alternate, case is ignored', () => {
  assert.ok(sel.matchesGlob('extension/popup/a/b.js', 'extension/popup/**'));
  assert.ok(!sel.matchesGlob('extension/popup/a/b.js', 'extension/popup/*'));
  assert.ok(sel.matchesGlob('extension/annotate/x.js', 'extension/{replay,annotate}/**'));
  assert.ok(sel.matchesGlob('Extension/Popup/A.js', 'extension/popup/**'));
  assert.ok(sel.matchesGlob('extension/tools/lib-x.mjs', 'extension/tools/lib-*.mjs'));
});

const cleanup = recycle(PARENT, 'qaw-pm fixtures');
test('the fixture trees went to the recycle bin', () => assert.ok(cleanup.ok));

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
