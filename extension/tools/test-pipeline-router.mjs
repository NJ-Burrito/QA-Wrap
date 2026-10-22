/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * test-pipeline-router.mjs — `npm run t <word>` (P1, 1012, spec 2.2, objection 6, R7).
 *   node tools/test-pipeline-router.mjs   (run from extension/)
 *
 * Pure part: lib-router on fixture rows (word order, ambiguity, unknown, no word, npm passthrough, exclusions, filters).
 * Real part: the command line against the real test-manifest.json (exit 64 runs nothing, no run folder; tier selections never
 * contain an excluded row) and a fixture run for the no-word path (PICKED first, NEXT last).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recycle } from './lib-trash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..');
const PIPE = path.join(HERE, 'pipeline.mjs');
const Rt = await import(pathToFileURL(path.join(HERE, 'lib-router.mjs')).href);
const S = await import(pathToFileURL(path.join(HERE, 'lib-sched.mjs')).href);

let passed = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failed++; console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
};

const mk = (id, o = {}) => S.normalizeRow({ id, lane: 'node', features: [], tags: [], ...o });
const rows = [
  mk('test-copy', { features: ['i18n-copy'], tags: ['smoke', 'canary'] }),
  mk('test-copy-length', { lane: 'headed', byHand: true, features: ['popup'] }),
  mk('test-copy-report', { lane: 'headless', features: ['report'] }),
  mk('test-popup-structure', { features: ['popup'], tags: ['smoke'] }),
  mk('test-next-primary', { lane: 'headed', byHand: true, headed: true, features: ['popup'], tags: ['rule12'] }),
  mk('test-types', { lane: 'gate', features: ['build-package'], tags: ['smoke'] }),
  mk('test-perf', { lane: 'measure', features: ['perf'] }),
  mk('test-jira-live', { lane: 'headed', byHand: true, features: ['jira-integrations'] }),
  mk('jira-live', { kind: 'tool', liveCredentials: true, features: ['jira-integrations'] }),
  mk('field-smoke', { kind: 'tool', liveNetwork: true, features: ['popup'] }),
  mk('net-smoke', { kind: 'tool', optIn: true, liveNetwork: true, features: ['content-page'] }),
  mk('canary', { kind: 'tool', tags: ['extra'], features: [] }),
];
const features = ['popup', 'report', 'i18n-copy', 'perf', 'build-package', 'jira-integrations', 'content-page'];
const go = (argv, o = {}) => Rt.route({ argv, env: o.env || {}, rows, features, isTTY: o.tty || false });
const ids = (r) => r.rows.map((x) => x.id).sort();

/* ---- pure ---- */
t('no word = changed, with the reason "no word given"', () => {
  const r = go([]);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'changed');
  assert.match(r.picked, /^changed \(no word given\)$/);
  assert.equal(r.delivery, false);
});
t('npm passthrough (R7): a bare npm_config_changed=true means --changed; flags only after "--"; "list" replaces "?"', () => {
  assert.equal(go([], { env: { npm_config_changed: 'true' } }).mode, 'changed');
  assert.equal(go(['--', '--changed']).mode, 'changed');
  assert.equal(go(['list']).mode, 'list');
  assert.equal(go(['last']).mode, 'last');
  assert.equal(go(['coverage']).mode, 'coverage');
  assert.deepEqual(Rt.parseArgv(['--', '--jobs', '3', '--accept-gate', 'reason words']).flags, { jobs: '3', acceptGate: 'reason words' });
  assert.deepEqual(Rt.parseArgv(['popup', '-s']).word, 'popup');
});
t('tier words resolve first, and the sets are the spec tiers', () => {
  const smoke = go(['smoke']);
  assert.equal(smoke.kind, 'tier');
  assert.deepEqual(ids(smoke), ['test-copy', 'test-popup-structure', 'test-types']);
  assert.deepEqual(ids(go(['regression'])), ['test-copy', 'test-copy-report', 'test-popup-structure', 'test-types']);
  assert.ok(ids(go(['e2e'])).includes('test-next-primary') && !ids(go(['e2e'])).includes('test-copy'));
  assert.ok(ids(go(['full'])).includes('test-perf'));
  assert.equal(go(['full']).delivery, true);
  assert.equal(go(['smoke']).delivery, false);
});
t('order: tier, feature, lane, tag, exact suite id, unique prefix', () => {
  assert.equal(go(['popup']).kind, 'feature');
  assert.deepEqual(ids(go(['popup'])), ['test-copy-length', 'test-next-primary', 'test-popup-structure']);
  assert.equal(go(['headed']).kind, 'lane');
  assert.equal(go(['rule12']).kind, 'tag');
  assert.deepEqual(ids(go(['rule12'])), ['test-next-primary']);
  assert.equal(go(['test-types']).kind, 'suite');
  assert.equal(go(['next-prim']).kind, 'suite');
  assert.deepEqual(ids(go(['next-prim'])), ['test-next-primary']);
  const dual = Rt.resolveWord('perf', rows, features);
  assert.equal(dual.kind, 'feature', 'feature wins over a same-named lane or tag');
});
t('exact id wins over a longer prefix match (test-copy vs test-copy-length)', () => {
  const r = go(['test-copy']);
  assert.equal(r.kind, 'suite');
  assert.deepEqual(ids(r), ['test-copy']);
});
t('ambiguous prefix: exit 64, runs nothing, lists the candidates', () => {
  const r = go(['test-co']);
  assert.equal(r.ok, false);
  assert.equal(r.exit, 64);
  assert.equal(r.ambiguous, true);
  assert.deepEqual([...r.candidates].sort(), ['test-copy', 'test-copy-length', 'test-copy-report']);
  assert.ok(!r.rows);
});
t('unknown word: exit 64 and the three nearest words', () => {
  const r = go(['popap']);
  assert.equal(r.exit, 64);
  assert.equal(r.candidates.length, 3);
  assert.ok(r.candidates.includes('popup'));
  assert.match(r.message, /npm run t list/);
});
t('one word only; unknown flag and a value-less flag are usage errors (64)', () => {
  assert.equal(go(['popup', 'report']).exit, 64);
  assert.equal(go(['popup', '--nonsense']).exit, 64);
  assert.equal(go(['--jobs']).exit, 64);
});
t('exclusion by construction (S6): no tier, feature, lane, tag or glob selection ever holds a tool, liveCredentials, liveNetwork or optIn row', () => {
  const bad = new Set(['jira-live', 'field-smoke', 'net-smoke', 'canary']);
  for (const w of ['smoke', 'regression', 'e2e', 'full', 'release', 'popup', 'jira-integrations', 'content-page', 'headed', 'node', 'extra', 'perf']) {
    const r = go([w]);
    if (!r.ok) continue;
    assert.ok(!r.rows.some((x) => bad.has(x.id)), `${w} selected an excluded row`);
  }
  assert.ok(!ids(go(['jira-integrations'])).includes('jira-live'));
});
t('--only of an excluded suite exits 64 without --allow-live; --allow-live alone (no terminal) still exits 64; a terminal with one named suite is allowed', () => {
  assert.equal(go(['--only', 'jira-live']).exit, 64);
  assert.match(go(['--only', 'jira-live']).message, /excluded by construction/);
  assert.equal(go(['--only', 'jira-live', '--allow-live']).exit, 64);
  const ok = go(['--only', 'jira-live', '--allow-live'], { tty: true });
  assert.equal(ok.ok, true);
  assert.deepEqual(ids(ok), ['jira-live']);
  assert.equal(go(['--only', 'jira-live,uat', '--allow-live'], { tty: true }).exit, 64, 'two named suites are not a named suite');
  assert.equal(go(['uat']).exit, 64);
});
t('--only takes several exact ids; a feature word after --only is refused', () => {
  assert.deepEqual(ids(go(['--only', 'test-copy,test-types'])), ['test-copy', 'test-types']);
  assert.equal(go(['--only', 'popup']).exit, 64);
});
t('filters AND with the word: regression --feature popup; flags alone select over all reachable rows', () => {
  assert.deepEqual(ids(go(['popup', '--lane', 'headed'])), ['test-copy-length', 'test-next-primary']);
  assert.equal(go(['regression', '--feature', 'popup']).tier, null, 'a filtered tier is no longer the tier (no budget, no delivery)');
  assert.deepEqual(ids(go(['--feature', 'perf'])), ['test-perf']);
  assert.equal(go(['full', '--tag', 'smoke']).delivery, false);
});
t('word cft = the smoke tier on the CfT engine; --engine is carried; --changed takes an optional base', () => {
  const c = go(['cft']);
  assert.equal(c.engine, 'cft');
  assert.deepEqual(ids(c), ids(go(['smoke'])));
  assert.equal(go(['smoke', '--engine', 'cft']).engine, 'cft');
  assert.equal(Rt.parseArgv(['--changed', 'origin/main']).flags.changed, 'origin/main');
  assert.equal(Rt.parseArgv(['--changed', 'popup']).word, 'popup');
});
t('nearest words: substring first, then edit distance', () => {
  assert.equal(Rt.nearest('popu', ['popup', 'report', 'perf'])[0], 'popup');
  assert.equal(Rt.lev('kitten', 'sitting'), 3);
});

/* ---- real manifest, real command line ---- */
const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-pr-'));
const cli = (args, o = {}) => spawnSync(process.execPath, [PIPE, ...args, '--runs-root', runs], { cwd: EXT, encoding: 'utf8', timeout: 120000, env: { ...process.env, PYTHONUTF8: '1', ...(o.env || {}) } });
t('cli: an unknown word exits 64, prints the nearest words and creates no run folder', () => {
  const r = cli(['zzzzzz']);
  assert.equal(r.status, 64);
  assert.match(r.stderr, /unknown word "zzzzzz"/);
  assert.deepEqual(fs.readdirSync(runs), []);
});
t('cli: an ambiguous prefix exits 64 with candidates; --only jira-live exits 64 (the real manifest marks it a tool)', () => {
  const a = cli(['test-jira']);
  assert.equal(a.status, 64);
  assert.match(a.stderr, /ambiguous/);
  const j = cli(['--only', 'jira-live']);
  assert.equal(j.status, 64);
  assert.match(j.stderr, /excluded by construction/);
  assert.deepEqual(fs.readdirSync(runs), []);
});
t('cli: "list" prints tiers, lanes, features and the excluded count; "--list" prints a selection without running it', () => {
  const l = cli(['list']);
  assert.equal(l.status, 0);
  assert.match(l.stdout, /^tiers +smoke \d+/m);
  assert.match(l.stdout, /excluded by construction \(S6\): \d+ of \d+ rows/);
  const s = cli(['test-copy', '--list']);
  assert.equal(s.status, 0);
  assert.match(s.stdout, /^PICKED suite test-copy/m);
  assert.deepEqual(fs.readdirSync(runs), []);
});
t('real manifest: every tier word selects only reachable rows and only existing files are planned', () => {
  const mf = S.loadManifest(EXT);
  const real = Rt.route({ argv: ['full'], env: {}, rows: mf.rows, features: mf.features });
  assert.equal(real.ok, true);
  assert.ok(real.rows.length > 100);
  assert.ok(!real.rows.some((x) => Rt.excludedReason(x)), 'full contains an excluded row');
  for (const w of ['smoke', 'regression', 'e2e', 'release']) {
    const r = Rt.route({ argv: [w], env: {}, rows: mf.rows, features: mf.features });
    assert.ok(r.ok && r.rows.length > 0, `${w} is empty`);
    assert.ok(!r.rows.some((x) => Rt.excludedReason(x)), `${w} contains an excluded row`);
  }
});

/* ---- fixture: the no-word path ---- */
const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'qaw-pr-fx-'));
const ext = path.join(fx, 'extension');
fs.mkdirSync(path.join(ext, 'tools'), { recursive: true });
fs.writeFileSync(path.join(ext, 'package.json'), '{"type":"module"}');
fs.writeFileSync(path.join(ext, 'manifest.json'), '{"version":"1.0.0"}');
for (const id of ['test-a', 'test-b']) fs.writeFileSync(path.join(ext, 'tools', `${id}.mjs`), "console.log('  ok  one');");
fs.writeFileSync(path.join(ext, 'tools', 'test-manifest.json'), JSON.stringify({ version: 2, features: ['x'], suites: ['test-a', 'test-b'].map((id) => ({ id, path: `tools/${id}.mjs`, kind: 'test', lane: 'node', features: ['x'], tags: id === 'test-b' ? ['smoke'] : [], timeout: null })) }));
const bare = spawnSync(process.execPath, [PIPE, '--ext', ext, '--runs-root', path.join(fx, 'runs'), '--changed-files', 'extension/tools/test-a.mjs'], { cwd: EXT, encoding: 'utf8', timeout: 120000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: fx, TMP: fx, PYTHONUTF8: '1', LOCALAPPDATA: process.env.LOCALAPPDATA } });
t('cli, no word: the first line is "PICKED changed (no word given)", the changed suite ran, the last line is "NEXT: npm run t full", exit 0', () => {
  assert.equal(bare.status, 0, bare.stdout + bare.stderr);
  const lines = bare.stdout.trim().split('\n');
  assert.equal(lines[0], 'PICKED changed (no word given)');
  assert.equal(lines.at(-1), 'NEXT: npm run t full');
  const j = JSON.parse(fs.readFileSync(path.join(fx, 'runs', 'latest', 'run.json'), 'utf8'));
  assert.deepEqual(j.suites.map((s) => s.id), ['test-a']);
  assert.equal(j.deliveryGate, false);
  assert.equal(j.mode, 'changed');
});
const nothing = spawnSync(process.execPath, [PIPE, '--ext', ext, '--runs-root', path.join(fx, 'runs'), '--changed-files', 'work/notes.md'], { cwd: EXT, encoding: 'utf8', timeout: 120000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: fx, TMP: fx, PYTHONUTF8: '1', LOCALAPPDATA: process.env.LOCALAPPDATA } });
t('cli, a change that maps to no suite: the smoke tier runs instead (nothing changed = smoke)', () => {
  assert.equal(nothing.status, 0, nothing.stdout + nothing.stderr);
  const j = JSON.parse(fs.readFileSync(path.join(fx, 'runs', 'latest', 'run.json'), 'utf8'));
  assert.deepEqual(j.suites.map((s) => s.id), ['test-b']);
});

recycle(runs);
recycle(fx);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
