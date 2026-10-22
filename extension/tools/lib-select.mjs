/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * lib-select.mjs: the test pipeline's manifest, selection and coverage library (lane P2, council-1012).
 *
 * Plain node, no browser, no network, no writes except `writeGateBaseline`. The runner (`pipeline.mjs`, lane P1) imports
 * this file; nothing here executes a suite. Spec: work/council-1012/devil-round-2.md section 2 and the 10 rehearsal
 * corrections in work/council-1012/rehearsals/RESULTS.md (R12 is the selection recipe).
 *
 * Interface (what P1 consumes; also listed in work/sdlc/build/notes-1012/P2.md):
 *   manifest   loadManifest(extDir?) -> { ...json, rows, byId }          LANES, laneOf(row), tagsOf(row)
 *   exclusion  isLive(row), exclusionReason(row), isReachable(row)       (S6: liveCredentials, liveNetwork, kind:tool, optIn)
 *   selectors  selectTier / selectFeature / selectLane / selectTag / selectSuite (all return { ids, rejected })
 *              vocabulary(m), nearest(m, word, n)                       (router word resolution is P1's lib-router)
 *   changed    changedFiles(base?), buildGraph(extDir, m), selectChanged(m, graph, files, opts)
 *   classify   classify(extDir, relPath) (auto-classification rule of seat 1), suggestRow(extDir, relPath)
 *   coverage   coverageCheck(extDir, m, graph?) -> { problems, warnings, stats }   (C1-C6 plus the P2 additions)
 *   baseline   gateState(extDir), compareGateState(current, baseline), readQuarantine(extDir), writeGateBaseline(extDir, reason)
 *   ledgers    loadHumanChecks(extDir), humanChecksOpen(list, version), loadAutopilotRules(extDir), autopilotSummary(rules)
 *
 *   node tools/lib-select.mjs coverage            C1-C6 report (exit 1 on a problem)
 *   node tools/lib-select.mjs list <tier|word>    the selection for a tier name, feature, lane, tag or suite id
 *   node tools/lib-select.mjs changed [a b ...]   the --changed selection (files given, else git)
 *   node tools/lib-select.mjs classify <path>     the auto-classification of one tools/ file
 *   node tools/lib-select.mjs write-baseline "<reason>"   rewrite gate-baseline.json from the tree (a named, reasoned act)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_EXT = path.resolve(HERE, '..');
export const LANES = ['gate', 'node', 'headless', 'headed', 'measure'];
export const MANIFEST_FILE = 'test-manifest.json';

const posix = (p) => p.split(path.sep).join('/').replaceAll('\\', '/');
const repoRootOf = (extDir) => path.resolve(extDir, '..');
const readText = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const readJson = (f) => JSON.parse(readText(f));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const stableJson = (v) => JSON.stringify(sortKeys(v));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

// ---------------------------------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------------------------------

/** The manifest with `rows` (the suites array) and `byId` (Map id -> row) added. Rows keep their JSON order (= run order within a lane). */
export function loadManifest(extDir = DEFAULT_EXT) {
  const m = readJson(path.join(extDir, 'tools', MANIFEST_FILE));
  m.rows = m.suites;
  m.byId = new Map(m.rows.map((r) => [r.id, r]));
  return m;
}

export const laneOf = (row) => row.lane;

/** Every tag of a row: its stored tags plus `feature:<f>` for each feature (the router resolves features before tags). */
export function tagsOf(row) {
  return [...new Set([...(row.tags || []), ...(row.features || []).map((f) => `feature:${f}`)])];
}

/**
 * Tags a row must carry because of its fields (single source of truth is the field; the stored `tags` array repeats them so a
 * reader that only opens the JSON still sees them, and test-pipeline-manifest fails if the two disagree).
 */
export function deriveTags(row) {
  const t = [];
  if (row.byHand) t.push('byHand');
  if (row.serial) t.push('serial');
  if (row.exclusive) t.push('exclusive');
  if (row.headlessOk) t.push('headlessOk');
  if (row.liveCredentials) t.push('liveCredentials');
  if (row.liveNetwork) t.push('liveNetwork');
  if (row.python && row.python !== 'none') t.push(`needs-python:${row.python}`);
  if (row.net && row.net !== 'none') t.push(`net:${row.net}`);
  if (row.assertMode) t.push(`assertMode:${row.assertMode}`);
  if (row.layer) t.push(`layer:${row.layer}`);
  if (row.kind === 'tool') t.push('kind:tool');
  if (row.stage) t.push(`stage:${row.stage}`);
  return t;
}

// ---------------------------------------------------------------------------------------------------------------------
// Exclusion by construction (S6) and selectors
// ---------------------------------------------------------------------------------------------------------------------

/** True for a suite that reaches a real credential or the real network: no tier, feature, lane, tag or changed selection may run it. */
export const isLive = (row) => !!(row.liveCredentials || row.liveNetwork);

/** Why a row can never be picked by a selector, or null when it is reachable. */
export function exclusionReason(row) {
  if (row.liveCredentials) return 'liveCredentials (reads a real credential)';
  if (row.liveNetwork) return 'liveNetwork (reaches the real network)';
  if (row.optIn) return 'optIn (explicit owner command only)';
  if (row.kind === 'tool') return 'kind:tool (a tool, not a test)';
  return null;
}
export const isReachable = (row) => exclusionReason(row) === null;

function partition(rows, pred) {
  const ids = [];
  const rejected = [];
  for (const r of rows) {
    if (!pred(r)) continue;
    const why = exclusionReason(r);
    if (why) rejected.push({ id: r.id, reason: why });
    else ids.push(r.id);
  }
  return { ids, rejected };
}

const laneRank = (m) => Object.fromEntries((m.laneOrder || LANES).map((l, i) => [l, i]));

/** Orders ids by lane order, then manifest order. */
export function orderIds(m, ids) {
  const rank = laneRank(m);
  const pos = new Map(m.rows.map((r, i) => [r.id, i]));
  return [...new Set(ids)].sort((a, b) => (rank[m.byId.get(a).lane] - rank[m.byId.get(b).lane]) || (pos.get(a) - pos.get(b)));
}

/**
 * A tier by name. The tier definition lives in the manifest (`tiers.<name>`): `lanes`, `byHand` (include byHand rows),
 * `measure` (include the measure lane), `tag` (smoke selects by tag), `extras` (names the runner adds after the lanes).
 * Returns { ids, rejected, extras, def }. `full` and `release` are the only tiers with `deliveryGate: true`.
 */
export function selectTier(m, tier) {
  const def = m.tiers?.[tier];
  if (!def) return { ids: [], rejected: [], extras: [], def: null };
  let pred;
  if (def.tag) pred = (r) => (r.tags || []).includes(def.tag);
  else pred = (r) => def.lanes.includes(r.lane) && (def.byHand || !r.byHand) && (def.measure || r.lane !== 'measure');
  const sel = partition(m.rows, pred);
  const order = def.order || (def.tag === 'smoke' ? m.smokeOrder : null);
  const ids = order ? order.filter((id) => sel.ids.includes(id)).concat(orderIds(m, sel.ids.filter((id) => !order.includes(id)))) : orderIds(m, sel.ids);
  return { ids, rejected: sel.rejected, extras: def.extras || [], def };
}

export const selectFeature = (m, f) => partition(m.rows, (r) => (r.features || []).includes(f));
export const selectLane = (m, lane) => partition(m.rows, (r) => r.lane === lane);
/** A tag, including the `stage:<old name>` aliases and `feature:<f>`. */
export const selectTag = (m, tag) => partition(m.rows, (r) => tagsOf(r).includes(tag));
/** One suite by exact id; a live or tool suite comes back in `rejected` (the runner exits 64 unless `--allow-live`). */
export const selectSuite = (m, id) => partition(m.rows, (r) => r.id === id);

/** Every word the router may be given, by kind. */
export function vocabulary(m) {
  const tags = new Set();
  for (const r of m.rows) for (const t of tagsOf(r)) if (!t.startsWith('feature:')) tags.add(t);
  return { tiers: Object.keys(m.tiers || {}), features: [...m.features], lanes: [...(m.laneOrder || LANES)], tags: [...tags].sort(), suites: m.rows.map((r) => r.id) };
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** The n nearest known words to an unknown one (substring hits first, then edit distance), for the exit-64 message. */
export function nearest(m, word, n = 3) {
  const v = vocabulary(m);
  const all = [...v.tiers, ...v.features, ...v.lanes, ...v.tags, ...v.suites];
  const w = word.toLowerCase();
  return [...new Set(all)].map((x) => ({ x, s: x.toLowerCase().includes(w) || w.includes(x.toLowerCase()) ? 0 : editDistance(x.toLowerCase(), w) })).sort((a, b) => a.s - b.s || a.x.length - b.x.length).slice(0, n).map((o) => o.x);
}

// ---------------------------------------------------------------------------------------------------------------------
// Globs
// ---------------------------------------------------------------------------------------------------------------------

/** `**`, `*`, `?` and `{a,b}` over posix paths; case-insensitive (Windows). */
function globBody(glob) {
  const esc = (c) => (/[.+^$()|[\]\\]/.test(c) ? '\\' + c : c);
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < glob.length && depth) { if (glob[j] === '{') depth++; else if (glob[j] === '}') depth--; j++; }
      const inner = glob.slice(i + 1, j - 1);
      const alts = [];
      let cur = '';
      let d = 0;
      for (const ch of inner) { if (ch === '{') d++; if (ch === '}') d--; if (ch === ',' && d === 0) { alts.push(cur); cur = ''; } else cur += ch; }
      alts.push(cur);
      re += '(?:' + alts.map(globBody).join('|') + ')';
      i = j - 1;
    } else re += esc(c);
  }
  return re;
}
export function globToRegExp(glob) { return new RegExp('^' + globBody(glob) + '$', 'i'); }
export const matchesGlob = (p, glob) => globToRegExp(glob).test(p);

// ---------------------------------------------------------------------------------------------------------------------
// Import graph (R12 recipe)
// ---------------------------------------------------------------------------------------------------------------------

const IMP = /(?:^|[\s;}])(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const NEW_URL = /new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url/g;
// String-path edges are read only from tools/ sources, never from these (they name the whole tree on purpose), and never point into tools/test-*.mjs.
const STRING_EDGE_EXEMPT = /(?:^|\/)(?:lib-ship|release-check|lib-release-guard|lib-zip|package|build-browsers|lib-select)\.mjs$/;
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist)(\/|$)|(^|\/)tools\/film\/(out|capture|audio)(\/|$)/;

function walkFiles(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    const rel = posix(p);
    if (SKIP_DIR.test(rel)) continue;
    if (e.isDirectory()) walkFiles(p, out); else out.push(p);
  }
  return out;
}

/**
 * The dependency graph of the tree: node ids are repo-root-relative posix paths (`extension/popup/popup.js`).
 * Edges: import / export-from / import() / new URL(.., import.meta.url) everywhere; string-path reads (path.join/resolve literals, bare
 * `dir/file.ext` literals, readdirSync arguments, `dir/${x}` template prefixes, directories expanded to their files) only from tools/
 * sources; plus each manifest row's `reads` (the @reads annotation for walkers that loop over an array of directories).
 * Returns { deps, closure(id), suiteClosure, reverse, files }.
 */
export function buildGraph(extDir, m) {
  const root = repoRootOf(extDir);
  const rootAbs = path.resolve(root);
  const rel = (abs) => posix(path.relative(rootAbs, abs));
  const abs = (r) => path.join(rootAbs, r);
  const inRoot = (p) => path.resolve(p).startsWith(rootAbs + path.sep) && !/(^|[\\/])node_modules([\\/]|$)/.test(p);
  const exists = (p) => { try { return fs.statSync(p); } catch { return null; } };
  const cache = new Map();
  const dirCache = new Map();
  const expandDir = (d) => { if (!dirCache.has(d)) dirCache.set(d, walkFiles(d)); return dirCache.get(d); };
  const testFile = /(?:^|\/)tools\/test-[^/]*\.mjs$/;
  const allowedTarget = (r) => /^(?:extension|helper|site)\//.test(r) || !r.includes('/'); // string edges stay inside the product folders (or a root file); work/, dist/, research/ are output and notes
  const toolsFile = /(?:^|\/)extension\/tools\//;

  function resolveSpec(from, spec) {
    const base = path.resolve(path.dirname(abs(from)), spec);
    for (const cand of [base, base + '.js', base + '.mjs', path.join(base, 'index.js')]) {
      const st = exists(cand);
      if (st && st.isFile() && inRoot(cand)) return rel(cand);
    }
    return null;
  }

  function depsOf(id) {
    if (cache.has(id)) return cache.get(id);
    const out = new Set();
    cache.set(id, out);
    if (!/\.m?js$/.test(id)) return out;
    let src = '';
    try { src = readText(abs(id)); } catch { return out; }
    let mm;
    IMP.lastIndex = 0;
    while ((mm = IMP.exec(src))) { const s = mm[1] || mm[2]; if (s && s.startsWith('.')) { const t = resolveSpec(id, s); if (t) out.add(t); } }
    NEW_URL.lastIndex = 0;
    while ((mm = NEW_URL.exec(src))) {
      const t = resolveSpec(id, mm[1]);
      if (t) { out.add(t); continue; }
      const dir = path.resolve(path.dirname(abs(id)), mm[1]); // new URL('../content/', import.meta.url): a folder the suite walks
      const st = exists(dir);
      if (st && st.isDirectory() && inRoot(dir) && allowedTarget(rel(dir) + '/x')) for (const x of expandDir(dir)) { const r = rel(x); if (!testFile.test(r)) out.add(r); }
    }
    if (!toolsFile.test(id) || STRING_EDGE_EXEMPT.test(id)) return out;
    const bases = [path.join(rootAbs, 'extension'), path.dirname(abs(id)), rootAbs];
    const tryAdd = (lit) => {
      if (!lit || lit.length < 3 || /^[.\\/]+$/.test(lit)) return;
      for (const b of bases) {
        const t = path.resolve(b, lit);
        if (!inRoot(t)) continue;
        const st = exists(t);
        if (!st) continue;
        if (st.isFile()) { const r = rel(t); if (!testFile.test(r) && allowedTarget(r)) out.add(r); } else if (st.isDirectory()) { if (allowedTarget(rel(t) + '/x')) for (const x of expandDir(t)) { const r = rel(x); if (!testFile.test(r)) out.add(r); } }
        return;
      }
    };
    for (const j of src.matchAll(/(?:path\.)?(?:join|resolve)\(([^)]*)\)/g)) {
      const lits = [...j[1].matchAll(/['"`]([^'"`$]+)['"`]/g)].map((x) => x[1]);
      if (lits.length) tryAdd(lits.join('/'));
      for (const l of lits) if (/[./]/.test(l)) tryAdd(l);
    }
    for (const j of src.matchAll(/readdirSync\(([^)]*)\)/g)) {
      const lits = [...j[1].matchAll(/['"`]([^'"`$]+)['"`]/g)].map((x) => x[1]);
      for (const l of lits) tryAdd(l);
      if (lits.length > 1) tryAdd(lits.join('/'));
    }
    for (const j of src.matchAll(/[`]([A-Za-z0-9_\-./]*\/)\$\{/g)) tryAdd(j[1].replace(/\/$/, ''));
    for (const j of src.matchAll(/(?:join|resolve)\(([^)]*\$\{[^)]*)\)/g)) {
      const lits = [...j[1].matchAll(/['"`]([A-Za-z0-9_\-./]+)['"`]/g)].map((x) => x[1]);
      if (lits.length) tryAdd(lits.join('/'));
    }
    for (const l of src.matchAll(/['"`]((?:\.\.?\/)?[A-Za-z0-9_\-./]+\.(?:js|mjs|json|html|css|md|svg))['"`]/g)) tryAdd(l[1]);
    return out;
  }

  function closure(entryId, extra = []) {
    const seen = new Set();
    const q = [entryId, ...extra];
    while (q.length) {
      const f = q.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      for (const d of depsOf(f)) if (!seen.has(d)) q.push(d);
    }
    return seen;
  }

  const suiteClosure = new Map();
  const reverse = new Map(); // file -> Set(suite id)
  for (const row of m.rows) {
    const entry = posix(path.relative(rootAbs, path.resolve(extDir, row.path)));
    const extra = [];
    for (const r of row.reads || []) {
      const t = path.resolve(extDir, r);
      const st = exists(t);
      if (!st) continue;
      if (st.isFile()) extra.push(rel(t)); else for (const x of expandDir(t)) extra.push(rel(x));
    }
    const c = closure(entry, extra);
    suiteClosure.set(row.id, c);
    for (const f of c) { if (!reverse.has(f)) reverse.set(f, new Set()); reverse.get(f).add(row.id); }
  }
  return { deps: cache, closure, suiteClosure, reverse, rel, abs, rootAbs };
}

// ---------------------------------------------------------------------------------------------------------------------
// --changed
// ---------------------------------------------------------------------------------------------------------------------

/** Repo-root-relative paths changed against `base` (default origin/main, falling back to HEAD~1), plus unstaged and untracked. */
export function changedFiles(base, cwd = repoRootOf(DEFAULT_EXT)) {
  const git = (args) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).filter(Boolean); } catch { return null; } };
  let committed = base ? git(['diff', '--name-only', `${base}...HEAD`]) : git(['diff', '--name-only', 'origin/main...HEAD']);
  if (committed === null) committed = git(['diff', '--name-only', 'HEAD~1']) || [];
  const unstaged = git(['diff', '--name-only']) || [];
  const staged = git(['diff', '--name-only', '--cached']) || [];
  const untracked = git(['ls-files', '--others', '--exclude-standard']) || [];
  return [...new Set([...committed, ...staged, ...unstaged, ...untracked].map((p) => posix(p).replace(/^\.\//, '')))];
}

/**
 * Selection for a set of changed files (repo-root-relative). Never satisfies the delivery gate.
 * Order of evidence: (1) a changed file that is a suite selects it; (2) the reverse import graph; (3) the hand map ADDS the feature
 * smoke member; (4) a hub file escalates to the whole regression tier; en.json / ar.json add the i18n parity suites; (5) an unmapped path
 * adds the smoke tier and a warning. Nothing changed = smoke.
 */
export function selectChanged(m, graph, files, opts = {}) {
  const lower = (p) => p.toLowerCase();
  const norm = [...new Set(files.map((p) => posix(p).replace(/^\.\//, '')))];
  const reasons = new Map();
  const add = (id, why) => { if (!reasons.has(id)) reasons.set(id, []); const a = reasons.get(id); if (a.length < 3 && !a.includes(why)) a.push(why); };
  const idByPath = new Map(m.rows.map((r) => [lower(posix(path.posix.join('extension', r.path))), r.id]));
  const revLower = new Map([...graph.reverse].map(([k, v]) => [lower(k), v]));
  const hubRes = (m.hubFiles || []).map((g) => ({ g, re: globToRegExp(g) }));
  const okRes = (m.unmappedOk || []).map((o) => ({ ...o, re: globToRegExp(o.glob) }));
  const unmapped = [];
  const hubHits = [];
  const ignored = [];
  let parity = false;
  for (const f of norm) {
    let mapped = false;
    const self = idByPath.get(lower(f));
    if (self) { add(self, `changed: ${f}`); mapped = true; }
    const rev = revLower.get(lower(f));
    if (rev) { for (const id of rev) add(id, `imports/reads ${f}`); mapped = true; }
    const hub = hubRes.find((h) => h.re.test(f));
    if (hub) { hubHits.push(f); mapped = true; }
    if (/(^|\/)(en|ar)\.json$/i.test(f) && /i18n|_locales/i.test(f)) { parity = true; mapped = true; }
    for (const h of m.changedMap || []) {
      if (!matchesGlob(f, h.glob)) continue;
      for (const feat of h.addFeatureSmoke || []) { const id = m.featureSmoke?.[feat]; if (id) { add(id, `hand map ${h.glob}`); } }
      if ((h.addFeatureSmoke || []).length) mapped = true;
    }
    if (!mapped) {
      const ok = okRes.find((o) => o.re.test(f));
      if (ok) ignored.push({ path: f, reason: ok.reason }); else unmapped.push(f);
    }
  }
  const warnings = [];
  let picked = 'changed';
  let ids = [];
  if (!norm.length) {
    picked = 'smoke';
    ids = selectTier(m, 'smoke').ids;
    warnings.push('nothing changed: running smoke');
  } else {
    if (hubHits.length) {
      for (const id of selectTier(m, 'regression').ids) add(id, `hub escalation: ${hubHits[0]}`);
      warnings.push(`hub file changed (${hubHits.slice(0, 3).join(', ')}): whole regression tier`);
    }
    if (parity) for (const id of m.i18nParity || []) add(id, 'en.json / ar.json changed: i18n parity');
    if (unmapped.length) {
      for (const id of selectTier(m, 'smoke').ids) add(id, 'unmapped path: smoke');
      warnings.push(`unmapped path${unmapped.length > 1 ? 's' : ''} (${unmapped.slice(0, 3).join(', ')}): smoke added`);
    }
    ids = [...reasons.keys()].filter((id) => m.byId.has(id) && isReachable(m.byId.get(id)));
  }
  if (picked !== 'smoke') ids = orderIds(m, ids);
  const reachable = m.rows.filter(isReachable).length;
  return { picked, ids, reasons: Object.fromEntries(ids.map((id) => [id, reasons.get(id) || []])), hubHits, escalated: hubHits.length > 0, parity, unmapped, ignored, warnings, notRun: reachable - ids.length, deliveryGate: false, next: 'npm run t full' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Auto-classification (seat 1, section 3)
// ---------------------------------------------------------------------------------------------------------------------

const HEADED_LIBS = ['lib-launch.mjs', 'lib-test-window.mjs', 'test-next-primary.mjs'];
const PRODUCT_FEATURE = { background: 'worker', offscreen: 'worker', content: 'content-page', popup: 'popup', ui: 'popup', report: 'report', options: 'options-settings', annotate: 'media-replay-annotate', diagram: 'media-replay-annotate', platform: 'i18n-copy', api: 'jira-integrations' };

/** Relative imports of one file (tools/ siblings only, for the transitive scan). */
function toolImports(extDir, rel) {
  let src = '';
  try { src = readText(path.join(extDir, rel)); } catch { return { src: '', imports: [] }; }
  const imports = [];
  let mm;
  IMP.lastIndex = 0;
  while ((mm = IMP.exec(src))) { const s = mm[1] || mm[2]; if (s && s.startsWith('.')) imports.push(posix(path.posix.normalize(path.posix.join(path.posix.dirname(rel), s)))); }
  return { src, imports };
}

function transitive(extDir, rel) {
  const seen = new Map();
  const q = [rel];
  while (q.length) {
    const f = q.pop();
    if (seen.has(f)) continue;
    const t = toolImports(extDir, f);
    seen.set(f, t);
    for (const i of t.imports) if (!seen.has(i) && /^tools\/(?:lib-[\w-]+|test-next-primary)\.mjs$/.test(i) && fs.existsSync(path.join(extDir, i))) q.push(i);
  }
  return seen;
}

/** `// @suite lane=<l> feature=<f> tags=<t> reason=<text>` header, or null. An override without `reason=` is a problem. */
export function parseSuiteHeader(src) {
  const line = src.split('\n').slice(0, 40).find((l) => /^\s*(?:\/\/|\*)\s*@suite\b/.test(l));
  if (!line) return null;
  const body = line.replace(/^\s*(?:\/\/|\*)\s*@suite\b/, '').trim();
  const h = { raw: body };
  const at = body.search(/(?:^|\s)reason=/); // reason= runs to the end of the line
  const head = at >= 0 ? body.slice(0, at) : body;
  if (at >= 0) h.reason = body.slice(at).replace(/^\s*reason=/, '').trim();
  for (const mm of head.matchAll(/(\w+)=([^\s]+)/g)) h[mm[1]] = mm[2];
  return h;
}

/**
 * Classify one tools/ file (relPath is relative to extension/, e.g. `tools/test-foo.mjs`). First match wins:
 * kind -> headed -> headless -> measure -> gate -> node. Returns { kind, lane, headed, headlessLaunch, python, serial, state, net,
 * features, featureVia, header, reasons }.
 */
export function classify(extDir, relPath) {
  const rel = posix(relPath);
  const base = path.posix.basename(rel);
  const closure = transitive(extDir, rel);
  const own = closure.get(rel) || { src: '', imports: [] };
  const src = own.src;
  const allSrc = [...closure.values()].map((c) => c.src).join('\n');
  const reasons = [];
  const header = parseSuiteHeader(src);
  const isTest = /^test(-[\w-]+)?\.mjs$|\.test\.mjs$/.test(base);
  let kind = isTest ? 'test' : 'script';
  if (/@kind\s+tool\b/.test(src.slice(0, 2000))) kind = 'tool';

  const importsHeadedLib = [...closure.keys()].some((k) => HEADED_LIBS.includes(path.posix.basename(k)) && k !== rel);
  const code = src.split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l)).join('\n');
  const rawHeaded = /headless:\s*false|--headed\b/.test(code);
  const launchOptionsNoOverride = /\blaunchOptions\(/.test(code) && !/headless\s*:/.test(code) && !/UQA_HEADLESS/.test(code);
  const playwright = /from\s+['"](?:@playwright\/test|playwright)['"]/.test(allSrc) || /\bchromium\s*\.\s*launch\w*\(/.test(allSrc);
  let lane;
  let headed = false;
  if (importsHeadedLib) { lane = 'headed'; headed = true; reasons.push('imports lib-launch / lib-test-window / test-next-primary (transitive)'); } else if (rawHeaded || launchOptionsNoOverride) { lane = 'headed'; headed = true; reasons.push('headless:false / --headed / launchOptions( without a headless override'); } else if (playwright || importsHeadedLib) { lane = 'headless'; reasons.push('playwright (transitive) or chromium.launch*( without a headed flag'); } else if (header?.lane === 'measure' || /^(perf|stress)(-|\.|$)/.test(base)) { lane = 'measure'; reasons.push('measure: header, or perf*/stress* name'); } else {
    const spawnsOther = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\(\s*(?!['"`](?:tsc|git)['"`])/.test(src) && !/node\s+--check|'--check'/.test(src);
    const relImportsProduct = (own.imports || []).some((i) => !/^tools\/lib-/.test(i));
    const isGate = !relImportsProduct && !/await\s+import\(/.test(src) && !/\bvm\.\w*[Rr]un\w*|\bnew\s+vm\./.test(src) && !/pathToFileURL/.test(src) && !spawnsOther;
    if (isGate) { lane = 'gate'; reasons.push('gate: no product import, no dynamic import, no vm, no foreign spawn'); } else { lane = 'node'; reasons.push('node: any other node-only suite'); }
  }
  if (header?.lane && LANES.includes(header.lane)) { reasons.push(`header override lane=${header.lane}`); lane = header.lane; headed = lane === 'headed'; }

  const pyCall = allSrc.split('\n').some((l) => /['"`](?:uv|python3?)['"`]/.test(l) && !/trash/i.test(l) && !/^\s*(?:\/\/|\*)/.test(l));
  const python = pyCall ? 'uses' : 'none';
  const state = /fake-indexeddb|globalThis\.chrome\s*=|createServer|mkdtemp/.test(src);
  const serial = lane === 'measure';
  const net = /listen\(\s*\d|createServer|127\.0\.0\.1|localhost/.test(src) ? 'loopback' : 'none';

  const votes = {};
  for (const k of closure.keys()) {
    const mm = /^(?:\.\.\/)?([a-z-]+)\//.exec(k.replace(/^tools\//, ''));
    const top = mm ? mm[1] : null;
    if (/^\.\.\//.test(path.posix.relative('tools', k)) && top && PRODUCT_FEATURE[top]) votes[PRODUCT_FEATURE[top]] = (votes[PRODUCT_FEATURE[top]] || 0) + 1;
  }
  for (const k of closure.keys()) {
    const top = k.split('/')[0];
    if (top !== 'tools' && PRODUCT_FEATURE[top]) votes[PRODUCT_FEATURE[top]] = (votes[PRODUCT_FEATURE[top]] || 0) + 1;
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const features = ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? [ranked[0][0]] : [];
  return { kind, lane, headed, python, serial, state, net, features, featureVia: ranked.length ? 'imports' : 'none', header, reasons, playwright, importsHeadedLib };
}

/** The proposed manifest row for a new file (the integrator pastes it; features may be empty and must then be filled by hand). */
export function suggestRow(extDir, relPath) {
  const c = classify(extDir, relPath);
  const id = path.posix.basename(relPath, '.mjs');
  const tags = [];
  if (c.state) tags.push('state');
  if (c.serial) tags.push('serial');
  return { id, path: posix(relPath), kind: c.kind, lane: c.lane, features: c.features, tags, headed: c.headed, byHand: c.headed, headlessOk: false, python: c.python === 'uses' ? 'soft' : 'none', net: c.net, timeout: null, timeoutSource: 'guess', assertMode: 'counted', _why: c.reasons };
}

// ---------------------------------------------------------------------------------------------------------------------
// Quarantine, gate state, baseline
// ---------------------------------------------------------------------------------------------------------------------

/** The QUARANTINE table, read from the source of the runner (run-suites.mjs, or lib-suites.mjs once P1 extracts it). { id: { byHand, until } } */
export function readQuarantine(extDir = DEFAULT_EXT) {
  for (const f of ['lib-suites.mjs', 'run-suites.mjs']) {
    let src = '';
    try { src = readText(path.join(extDir, 'tools', f)); } catch { continue; }
    const at = src.indexOf('const QUARANTINE = {');
    if (at < 0) continue;
    const end = src.indexOf('\n};', at);
    const body = src.slice(at, end);
    const out = {};
    for (const mm of body.matchAll(/^\s*(?:'([\w-]+)'|([\w-]+)):\s*\{([^\n]*?)(?:\},?\s*)?$/gm)) {
      const id = mm[1] || mm[2];
      const rest = mm[3];
      out[id] = { byHand: /byHand:\s*true/.test(rest), until: (/until:\s*'([\d-]+)'/.exec(rest) || [])[1] || null };
    }
    return out;
  }
  return {};
}

function readKnownRed(extDir) {
  for (const f of ['lib-suites.mjs', 'run-suites.mjs']) {
    let src = '';
    try { src = readText(path.join(extDir, 'tools', f)); } catch { continue; }
    const at = src.indexOf('const KNOWN_RED = {');
    if (at < 0) continue;
    const line = src.slice(at, src.indexOf('\n', at));
    if (/const KNOWN_RED = \{\};/.test(line)) return {};
    const end = src.indexOf('\n};', at);
    return { raw: sha(src.slice(at, end)) };
  }
  return {};
}

const ALLOW_LIST_FILES = ['tools/copy-claims-baseline.json', 'tools/a11y-baseline.json', 'tools/copy-claims.json', 'tools/retired-sentences.json'];

/**
 * The current state of everything that can loosen the gate, as one object shaped like gate-baseline.json:
 * { ceilings:{types,typesWide}, hashes:{quarantine,knownRed,allowLists,lineRatchet,budgets}, detail:{...} }.
 * Hash recipe: sha256 of stable JSON (keys sorted) of the parsed value, or of LF-normalised file text; a missing file hashes as "absent".
 */
export function gateState(extDir = DEFAULT_EXT) {
  // The ceiling a suite may never exceed is the number in its own source: LAST_KNOWN_COUNT / LAST_KNOWN (lane P6 moved the live
  // value into gate-baseline.json and kept these as the cap); the pre-P6 names are read as a fallback.
  const types = (() => { try { const src = readText(path.join(extDir, 'tools', 'test-types.mjs')); return Number((/const LAST_KNOWN_COUNT = (\d+);/.exec(src) || /const BASELINE_COUNT = (\d+);/.exec(src))[1]); } catch { return null; } })();
  let typesWide = null;
  try {
    const src = readText(path.join(extDir, 'tools', 'test-types-wide.mjs'));
    const mm = /const LAST_KNOWN = (\{[^}]*\});/.exec(src) || /export const CEILINGS = (\{[^}]*\});/.exec(src);
    typesWide = Function(`"use strict"; return (${mm[1]});`)();
  } catch { typesWide = null; }
  const fileHash = (rel) => { try { return sha(readText(path.join(extDir, rel))); } catch { return 'absent'; } };
  const quarantine = readQuarantine(extDir);
  const knownRed = readKnownRed(extDir);
  const allow = {};
  for (const f of ALLOW_LIST_FILES) allow[f] = fileHash(f);
  let ratchet = {};
  try { ratchet = readJson(path.join(extDir, 'tools', 'line-ratchet.json')); } catch { /* absent */ }
  const budgets = fileHash('tools/pipeline-budgets.json');
  return {
    ceilings: { types, typesWide },
    hashes: { quarantine: sha(stableJson(quarantine)), knownRed: sha(stableJson(knownRed)), allowLists: sha(stableJson(allow)), lineRatchet: sha(stableJson({ lines: ratchet.lines, swallows: ratchet.swallows, deadExportAllowlist: ratchet.deadExportAllowlist })), budgets },
    detail: { quarantine, knownRed, allowLists: allow, lineRatchet: { lines: ratchet.lines || {}, swallows: ratchet.swallows || {}, deadExportAllowlist: ratchet.deadExportAllowlist || [] } },
  };
}

/**
 * GATE LOOSENED detector. Returns [{ key, kind:'loosened'|'tightened'|'changed', what }]. Raised ceiling, added or extended quarantine,
 * a new known-red, a grown allow-list or a raised line/swallow ceiling = loosened. A lowered ceiling or a removed entry = tightened
 * (the baseline is stale but the gate is stricter). Any other hash change = changed (counts as loosened until accepted).
 */
export function compareGateState(cur, base) {
  const out = [];
  const num = (key, a, b) => { if (a == null || b == null) { if (a !== b) out.push({ key, kind: 'changed', what: `${a} vs baseline ${b}` }); } else if (a > b) out.push({ key, kind: 'loosened', what: `${b} -> ${a}` }); else if (a < b) out.push({ key, kind: 'tightened', what: `${b} -> ${a}` }); };
  num('ceilings.types', cur.ceilings.types, base.ceilings?.types);
  const dirs = new Set([...Object.keys(cur.ceilings.typesWide || {}), ...Object.keys(base.ceilings?.typesWide || {})]);
  for (const d of dirs) num(`ceilings.typesWide.${d}`, cur.ceilings.typesWide?.[d] ?? null, base.ceilings?.typesWide?.[d] ?? null);
  const dq = cur.detail?.quarantine || {};
  const bq = base.detail?.quarantine || {};
  for (const id of Object.keys(dq)) { if (!bq[id]) out.push({ key: 'quarantine', kind: 'loosened', what: `${id} added` }); else if (dq[id].until > bq[id].until) out.push({ key: 'quarantine', kind: 'loosened', what: `${id} until ${bq[id].until} -> ${dq[id].until}` }); else if (dq[id].byHand !== bq[id].byHand) out.push({ key: 'quarantine', kind: dq[id].byHand ? 'tightened' : 'loosened', what: `${id} byHand ${bq[id].byHand} -> ${dq[id].byHand}` }); }
  for (const id of Object.keys(bq)) if (!dq[id]) out.push({ key: 'quarantine', kind: 'tightened', what: `${id} removed` });
  if (cur.hashes.knownRed !== base.hashes?.knownRed) out.push({ key: 'knownRed', kind: 'loosened', what: 'known-red table changed' });
  for (const f of Object.keys(cur.detail?.allowLists || {})) if (cur.detail.allowLists[f] !== base.detail?.allowLists?.[f]) out.push({ key: 'allowLists', kind: 'loosened', what: `${f} changed` });
  const cl = cur.detail?.lineRatchet || {};
  const bl = base.detail?.lineRatchet || {};
  for (const kind of ['lines', 'swallows']) for (const f of new Set([...Object.keys(cl[kind] || {}), ...Object.keys(bl[kind] || {})])) {
    if (!(f in (bl[kind] || {}))) out.push({ key: `lineRatchet.${kind}`, kind: 'changed', what: `${f} added (${cl[kind][f]})` }); else if (!(f in (cl[kind] || {}))) out.push({ key: `lineRatchet.${kind}`, kind: 'tightened', what: `${f} removed` }); else num(`lineRatchet.${kind}.${f}`, cl[kind][f], bl[kind][f]);
  }
  if (stableJson(cl.deadExportAllowlist) !== stableJson(bl.deadExportAllowlist) && (cl.deadExportAllowlist || []).length > (bl.deadExportAllowlist || []).length) out.push({ key: 'lineRatchet.deadExportAllowlist', kind: 'loosened', what: 'allow-list grew' });
  if (cur.hashes.budgets !== base.hashes?.budgets) out.push({ key: 'budgets', kind: 'changed', what: 'pipeline-budgets.json changed (frozen budgets must not rise unnoticed)' });
  return out;
}

/** Rewrite gate-baseline.json from the tree. A named act: the reason is stored. Keeps measured `assertions`. */
export function writeGateBaseline(extDir, reason) {
  if (!reason || reason.trim().length < 8) throw new Error('write-baseline needs a reason of at least 8 characters');
  const file = path.join(extDir, 'tools', 'gate-baseline.json');
  let old = {};
  try { old = readJson(file); } catch { /* first write */ }
  const cur = gateState(extDir);
  const next = { _doc: old._doc, version: 1, acceptedReason: reason.trim(), acceptedOn: new Date().toISOString().slice(0, 10), ...cur, assertions: old.assertions || {}, assertionsNote: old.assertionsNote };
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ledgers
// ---------------------------------------------------------------------------------------------------------------------

export function loadHumanChecks(extDir = DEFAULT_EXT) { return readJson(path.join(extDir, 'tools', 'human-checks.json')); }
const semverNum = (v) => String(v || '0').split('.').map((n) => Number(n) || 0);
const semverLess = (a, b) => { const x = semverNum(a); const y = semverNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
/** Items whose lastTickedVersion is below the manifest version (or never ticked). */
export function humanChecksOpen(ledger, version) {
  const items = ledger.items || [];
  const open = items.filter((i) => !i.lastTickedVersion || semverLess(i.lastTickedVersion, version));
  return { open, total: items.length, notCoveredOnBrandedChrome: open.filter((i) => i.gesture).length };
}
export function loadAutopilotRules(extDir = DEFAULT_EXT) { return readJson(path.join(extDir, 'tools', 'autopilot-rules.json')); }
/** `AUTOPILOT RULES: n enforced, m NOT ENFORCED (list)` */
export function autopilotSummary(rules) {
  const list = rules.rules || [];
  const ne = list.filter((r) => r.status !== 'enforced');
  return `AUTOPILOT RULES: ${list.length - ne.length} enforced, ${ne.length} NOT ENFORCED${ne.length ? ` (${ne.map((r) => `rule ${r.rule}`).join(', ')})` : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Coverage: C1-C6 and the P2 additions
// ---------------------------------------------------------------------------------------------------------------------

const tools = (extDir) => path.join(extDir, 'tools');
const isTestFile = (n) => /^test(-[\w-]+)?\.mjs$/.test(n);

function extSourceFiles(extDir, m) {
  const skip = new RegExp(m.sourceScope?.skip || '^$', 'i');
  const exts = new RegExp(m.sourceScope?.ext || '\\.(m?js|json|html|css)$', 'i');
  return walkFiles(extDir).map((p) => posix(path.relative(extDir, p))).filter((r) => exts.test(r) && !skip.test(r) && !/^(node_modules|dist)\//.test(r));
}

/**
 * C1 every tools/test*.mjs is a row and every row's file exists (pending rows excepted, with an expiry); every non-lib tools/*.mjs
 * script is a row or on `infraScripts`. C2 every feature has a smoke member (canary) and, from `enforceC2From`, a `real` suite or a
 * ledger entry. C3 every extension source file maps to at least one suite (graph) or to `unmappedOk` with a reason. C4 byHand / headed /
 * lane / python agree with QUARANTINE and the source scan (an `overrides` entry with a reason skips one field). C5 every lane and tier
 * has members. C6 features named in the changedMap, tiers and featureSmoke exist. Plus: tags equal derive, ledgers well-formed.
 */
export function coverageCheck(extDir = DEFAULT_EXT, m = loadManifest(extDir), graph = null, opts = {}) {
  const problems = [];
  const warnings = [];
  const add = (check, msg) => problems.push({ check, msg });
  const root = repoRootOf(extDir);
  const today = opts.today || process.env.QAW_TODAY || new Date().toISOString().slice(0, 10);
  const pending = new Set(m.pendingRows || []);

  // schema
  if (m.version !== 2) add('C0', `manifest version is ${m.version}, expected 2`);
  const ids = new Set();
  for (const r of m.rows) {
    if (ids.has(r.id)) add('C1', `duplicate id ${r.id}`);
    ids.add(r.id);
    if (!LANES.includes(r.lane)) add('C0', `${r.id}: lane ${r.lane} is not one of ${LANES.join(',')}`);
    if (!['test', 'script', 'tool'].includes(r.kind)) add('C0', `${r.id}: kind ${r.kind}`);
    if (!['counted', 'exitcode'].includes(r.assertMode)) add('C0', `${r.id}: assertMode ${r.assertMode}`);
    if (r.assertMode === 'exitcode' && !r.exitcodeReason) add('C0', `${r.id}: assertMode exitcode needs exitcodeReason`);
    if (r.timeout !== null && r.timeoutSource === 'guess') add('C0', `${r.id}: a stated timeout needs timeoutSource measured`);
    const derived = deriveTags(r);
    const have = new Set(r.tags || []);
    for (const t of derived) if (!have.has(t)) add('C0', `${r.id}: tag ${t} missing (derived from fields)`);
    for (const t of have) if (/^(byHand|serial|exclusive|headlessOk|liveCredentials|liveNetwork|kind:tool|needs-python:|net:|assertMode:|layer:|stage:)/.test(t) && !derived.includes(t)) add('C0', `${r.id}: tag ${t} has no field behind it`);
    for (const f of r.features || []) if (!m.features.includes(f)) add('C6', `${r.id}: unknown feature ${f}`);
    if (r.kind !== 'tool' && !(r.features || []).length) add('C1', `${r.id}: no feature (suggestion: ${classify(extDir, r.path).features.join(',') || 'none, add // @suite feature=<f>'})`);
    if (r.overrides) for (const [k, why] of Object.entries(r.overrides)) if (!why || String(why).length < 8) add('C4', `${r.id}: override of ${k} needs a stated reason`);
  }

  // C1 files
  const onDisk = fs.readdirSync(tools(extDir)).filter(isTestFile);
  for (const f of onDisk) {
    const id = f.slice(0, -4);
    if (m.byId.has(id)) continue;
    if (pending.has(id)) { warnings.push(`awaiting integrator row: ${id}`); continue; }
    add('C1', `tools/${f} is not in the manifest (add a row: node tools/lib-select.mjs classify tools/${f})`);
  }
  for (const r of m.rows) {
    const p = path.resolve(extDir, r.path);
    if (!fs.existsSync(p)) add('C1', `${r.id}: ${r.path} does not exist`);
    if (r.kind === 'test' && r.path.startsWith('tools/') && !isTestFile(path.posix.basename(r.path))) add('C1', `${r.id}: kind test but ${r.path} is not tools/test*.mjs`);
  }
  const infra = new Set((m.infraScripts || []).map((s) => s.file));
  for (const f of fs.readdirSync(tools(extDir)).filter((n) => /\.mjs$/.test(n) && !isTestFile(n) && !/^lib-/.test(n))) {
    const id = f.slice(0, -4);
    if (!m.byId.has(id) && !infra.has(f)) add('C1', `tools/${f} is neither a manifest row (kind script/tool) nor on infraScripts`);
  }
  for (const s of m.infraScripts || []) if (!s.reason) add('C1', `infraScripts ${s.file}: reason required`);
  for (const id of pending) if (m.byId.has(id)) add('C1', `${id} is in pendingRows but already has a row: remove it from pendingRows`);
  if (pending.size && m.pendingExpires && today > m.pendingExpires) add('C1', `pendingRows still lists ${pending.size} ids after ${m.pendingExpires}: the integrator must add their rows`);

  // C4 against QUARANTINE and the source scan
  const q = readQuarantine(extDir);
  for (const [id, e] of Object.entries(q)) {
    const r = m.byId.get(id);
    if (!r) { if (!pending.has(id)) add('C4', `QUARANTINE entry ${id} has no manifest row`); continue; }
    if (e.byHand && !r.byHand) add('C4', `${id}: QUARANTINE byHand but the manifest row is not`);
  }
  for (const r of m.rows) {
    if (r.byHand && !q[r.id] && !r.overrides?.byHand) add('C4', `${r.id}: manifest byHand without a QUARANTINE entry (add one or a reasoned override)`);
    if (!fs.existsSync(path.resolve(extDir, r.path))) continue;
    const c = classify(extDir, r.path);
    const ov = r.overrides || {};
    if (!ov.kind && c.kind !== r.kind && !(r.kind === 'tool' && c.kind === 'script')) add('C4', `${r.id}: kind ${r.kind} but the file scans as ${c.kind}`);
    if (r.kind === 'tool') continue;
    if (!ov.lane && c.lane !== r.lane) add('C4', `${r.id}: lane ${r.lane} but the source scan says ${c.lane} (${c.reasons[0]})`);
    if (!ov.headed && c.headed !== !!r.headed) add('C4', `${r.id}: headed ${!!r.headed} but the source scan says ${c.headed}`);
    if (!ov.python) {
      if (c.python === 'none' && r.python !== 'none') add('C4', `${r.id}: python ${r.python} but the source does not spawn uv/python`);
      if (c.python === 'uses' && r.python === 'none') add('C4', `${r.id}: spawns uv/python but the row says python none`);
    }
    if (r.kind === 'test' && r.headed && !r.byHand && !ov.byHand && r.lane === 'headed' && !r.lockedProfile) add('C4', `${r.id}: headed row is not byHand and not on a locked profile`);
    if (r.headlessOk && r.lane !== 'headed') add('C4', `${r.id}: headlessOk only makes sense on a headed row`);
    if (!c.header && 0) continue;
  }

  // C5 lanes and tiers
  for (const l of m.requiredLanes || LANES) if (!m.rows.some((r) => r.lane === l && r.kind !== 'tool')) add('C5', `lane ${l} has no member`);
  for (const [t, def] of Object.entries(m.tiers || {})) { const sel = selectTier(m, t); if (!sel.ids.length) add('C5', `tier ${t} selects nothing`); if (def.deliveryGate && !['full', 'release'].includes(t)) add('C5', `tier ${t} must not be a delivery gate`); }
  for (const t of ['full', 'release']) if (m.tiers?.[t] && !m.tiers[t].deliveryGate) add('C5', `tier ${t} must carry deliveryGate:true`);

  // C6 + C2 features
  for (const h of m.changedMap || []) for (const f of h.addFeatureSmoke || []) if (!m.features.includes(f)) add('C6', `changedMap ${h.glob}: unknown feature ${f}`);
  for (const f of m.features) {
    const sid = m.featureSmoke?.[f];
    const sr = sid && m.byId.get(sid);
    if (!sid) add('C2', `feature ${f} has no smoke member (featureSmoke)`);
    else if (!sr) add('C2', `feature ${f}: smoke member ${sid} is not a manifest row`);
    else {
      if (!(sr.features || []).includes(f)) add('C2', `feature ${f}: smoke member ${sid} does not list the feature`);
      if (!(sr.tags || []).includes('smoke')) add('C2', `feature ${f}: smoke member ${sid} is not tagged smoke`);
      if (!isReachable(sr) || !['gate', 'node'].includes(sr.lane) || sr.byHand) add('C2', `feature ${f}: smoke member ${sid} must be a reachable node-only suite`);
    }
    if (m.enforceC2From && today >= m.enforceC2From) {
      const real = m.rows.some((r) => (r.features || []).includes(f) && r.layer === 'real');
      const led = (loadHumanChecks(extDir).items || []).some((i) => (i.features || []).includes(f));
      if (!real && !led) add('C2', `feature ${f} has no layer:real suite and no human-checks entry`);
    }
  }
  for (const id of m.smokeOrder || []) if (!m.byId.has(id) && !pending.has(id)) add('C2', `smokeOrder member ${id} is neither a row nor pending`);

  // C3 every extension source file maps to a suite
  let g = graph;
  const unmapped = [];
  try {
    g = g || buildGraph(extDir, m);
    const rev = new Set([...g.reverse.keys()].map((k) => k.toLowerCase()));
    const okRes = (m.unmappedOk || []).map((o) => ({ ...o, re: globToRegExp(o.glob), used: 0 }));
    for (const o of m.unmappedOk || []) if (!o.reason) add('C3', `unmappedOk ${o.glob}: reason required`);
    for (const f of extSourceFiles(extDir, m)) {
      const id = `extension/${f}`;
      if (/^tools\/test-[\w-]+\.mjs$/.test(f) && pending.has(f.slice(6, -4))) continue;
      if (rev.has(id.toLowerCase())) continue;
      const ok = okRes.find((o) => o.re.test(id));
      if (ok) { ok.used++; continue; }
      unmapped.push(id);
    }
    for (const u of unmapped.slice(0, 40)) add('C3', `${u} maps to no suite and is not on unmappedOk`);
    if (unmapped.length > 40) add('C3', `... and ${unmapped.length - 40} more unmapped files`);
  } catch (e) { add('C3', `graph failed: ${e.message}`); }

  // ledgers
  try {
    const hc = loadHumanChecks(extDir);
    const seen = new Set();
    for (const i of hc.items || []) {
      for (const k of ['id', 'title', 'gesture', 'engine', 'lastTickedVersion', 'by', 'date']) if (!(k in i)) add('C7', `human-checks ${i.id || '?'}: field ${k} missing`);
      if (seen.has(i.id)) add('C7', `human-checks duplicate id ${i.id}`);
      seen.add(i.id);
      if (i.lastTickedVersion && !(i.by && i.date)) add('C7', `human-checks ${i.id}: a ticked item needs by and date`);
    }
  } catch (e) { add('C7', `human-checks.json: ${e.message}`); }
  try {
    const ar = loadAutopilotRules(extDir);
    const nums = (ar.rules || []).map((r) => r.rule).join(',');
    if (nums !== '1,2,3,4,5,6,7,8,9,10,11,12') add('C8', `autopilot-rules.json lists rules ${nums}, expected 1..12`);
    for (const r of ar.rules || []) {
      if (!['enforced', 'NOT ENFORCED'].includes(r.status)) add('C8', `rule ${r.rule}: status ${r.status}`);
      if (r.status !== 'enforced' && !r.reason) add('C8', `rule ${r.rule}: NOT ENFORCED needs a reason`);
      if (!(r.suites || []).length) add('C8', `rule ${r.rule}: no suites`);
      for (const s of r.suites || []) if (!m.byId.has(s) && !pending.has(s)) add('C8', `rule ${r.rule}: suite ${s} is not in the manifest`);
    }
  } catch (e) { add('C8', `autopilot-rules.json: ${e.message}`); }
  try {
    const gb = readJson(path.join(extDir, 'tools', 'gate-baseline.json'));
    for (const k of ['ceilings', 'hashes', 'assertions']) if (!(k in gb)) add('C9', `gate-baseline.json: ${k} missing`);
    for (const k of ['quarantine', 'knownRed', 'allowLists', 'lineRatchet', 'budgets']) if (!(k in (gb.hashes || {}))) add('C9', `gate-baseline.json: hashes.${k} missing`);
    for (const id of Object.keys(gb.assertions || {})) if (!m.byId.has(id)) add('C9', `gate-baseline.json: assertions for unknown suite ${id}`);
    for (const d of compareGateState(gateState(extDir), gb).filter((x) => x.kind !== 'tightened')) add('C9', `GATE LOOSENED ${d.key}: ${d.what} (accept with: node tools/lib-select.mjs write-baseline "<reason>")`);
  } catch (e) { add('C9', `gate-baseline.json: ${e.message}`); }

  const stats = { rows: m.rows.length, tests: m.rows.filter((r) => r.kind === 'test').length, byLane: Object.fromEntries(LANES.map((l) => [l, m.rows.filter((r) => r.lane === l).length])), unmappedFiles: unmapped.length, sourceFiles: extSourceFiles(extDir, m).length };
  return { problems, warnings, stats, repoRoot: root };
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------

async function cli(argv) {
  const [cmd, ...rest] = argv;
  const ext = DEFAULT_EXT;
  if (cmd === 'coverage') {
    const r = coverageCheck(ext);
    for (const p of r.problems) console.log(`FAIL ${p.check} ${p.msg}`);
    for (const w of r.warnings) console.log(`warn ${w}`);
    console.log(`${r.problems.length ? 'FAIL' : 'ok'}: ${r.stats.rows} rows, lanes ${JSON.stringify(r.stats.byLane)}, ${r.stats.sourceFiles} extension source files, ${r.stats.unmappedFiles} unmapped`);
    process.exit(r.problems.length ? 1 : 0);
  } else if (cmd === 'list') {
    const m = loadManifest(ext);
    const w = rest[0];
    const pick = m.tiers?.[w] ? selectTier(m, w) : m.features.includes(w) ? selectFeature(m, w) : m.byId.has(w) ? selectSuite(m, w) : LANES.includes(w) ? selectLane(m, w) : selectTag(m, w);
    console.log(pick.ids.join('\n'));
    if (pick.rejected.length) console.log(`rejected: ${pick.rejected.map((x) => `${x.id} (${x.reason})`).join('; ')}`);
    console.log(`${pick.ids.length} suites`);
  } else if (cmd === 'changed') {
    const m = loadManifest(ext);
    const files = rest.length ? rest : changedFiles();
    const sel = selectChanged(m, buildGraph(ext, m), files);
    console.log(`PICKED ${sel.picked}: ${sel.ids.length} suites, NOT RUN ${sel.notRun}${sel.warnings.length ? '; ' + sel.warnings.join('; ') : ''}`);
    for (const id of sel.ids) console.log(`  ${id}  <- ${sel.reasons[id].join(' | ')}`);
    console.log(`NEXT: ${sel.next}`);
  } else if (cmd === 'classify') {
    console.log(JSON.stringify(suggestRow(ext, rest[0]), null, 2));
  } else if (cmd === 'write-baseline') {
    const b = writeGateBaseline(ext, rest.join(' '));
    console.log(`gate-baseline.json written: ${b.acceptedReason}`);
  } else {
    console.error('usage: node tools/lib-select.mjs coverage | list <word> | changed [paths] | classify <tools/file> | write-baseline "<reason>"');
    process.exit(64);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli(process.argv.slice(2));
