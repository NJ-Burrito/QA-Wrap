/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * lib-router.mjs — `npm run t <word>` (P1, test pipeline 1012, spec 2.2 and objection 6).
 *
 * One verb, words not flags. A word resolves in this order: tier, feature, lane, tag, exact suite id, then a unique suite-id prefix.
 * No word means "changed". Unknown or ambiguous means exit 64, nothing runs, the nearest words are printed.
 * Sandbox and exclusions are identical for every selector (S6): kind:tool, liveCredentials and liveNetwork rows are never selected.
 *
 * Everything here is pure (no file, no process), so test-pipeline-router.mjs drives it with fixture rows.
 * npm facts (R7): flags only after `--`; a bare `npm run t --changed` arrives as env npm_config_changed=true; `?` is not a word (Git Bash globs it): use `list`.
 */

export const TIERS = ['smoke', 'regression', 'e2e', 'full', 'release'];
export const LANES = ['gate', 'node', 'headless', 'headed', 'measure'];
export const MODES = ['changed', 'last', 'list', 'coverage', 'cft'];

/** name -> kind. `value` takes the next token, `opt` takes it only when it does not start with `--`, `bool` takes none. */
export const FLAGS = {
  '--jobs': 'value', '--shuffle': 'value', '--flake-probe': 'opt', '--accept-env': 'value', '--accept-gate': 'value', '--allow-primary': 'bool',
  '--engine': 'value', '--source': 'bool', '--zip': 'opt', '--resume': 'value', '--live-sweep': 'bool', '--out': 'value',
  '--stage': 'value', '--feature': 'value', '--tag': 'value', '--lane': 'value', '--only': 'value', '--tier': 'value',
  '--changed': 'opt', '--list': 'bool', '--dry-run': 'bool', '--open': 'bool', '--allow-live': 'bool', '--suite-timeout': 'value',
  '--ext': 'value', '--manifest': 'value', '--runs-root': 'value', '--changed-files': 'value', '--write-baseline': 'bool', '--freeze-budgets': 'bool',
  '--no-latest': 'bool', '--coverage': 'bool', '--help': 'bool', '--tty': 'bool',
};

const camel = (s) => s.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/**
 * argv: tokens after `node pipeline.mjs`. env: process.env (for npm_config_changed). Returns { word, flags, errors }.
 * Anything after a bare `--` is a word/flag as written (npm passes the second `--` through). Unknown flags are errors (exit 64).
 */
export function parseArgv(argv, env = {}) {
  const flags = {};
  const words = [];
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(0, eq) : a;
      const kind = FLAGS[name];
      if (!kind) { errors.push(`unknown flag ${name}`); continue; }
      let val;
      if (eq > 0) val = a.slice(eq + 1);
      else if (kind === 'value') { val = argv[++i]; if (val === undefined || (val.startsWith('--') && name !== '--accept-gate')) { errors.push(`${name} needs a value`); i--; val = undefined; } }
      else if (kind === 'opt') {
        const nx = argv[i + 1];
        const refLike = /^(?:[\w.-]+\/[\w./-]+|HEAD(?:[~^]\d*)?|[0-9a-f]{7,40})$/;
        const takes = nx !== undefined && !nx.startsWith('--') && (name === '--changed' ? refLike.test(nx) : name === '--flake-probe' ? /^\d+$/.test(nx) : true);
        if (takes) val = argv[++i]; else val = true;
      }
      else val = true;
      if (val !== undefined) flags[camel(name)] = val;
    } else words.push(a);
  }
  if (env.npm_config_changed === 'true' && flags.changed === undefined) flags.changed = true;
  if (words.length > 1) errors.push(`one word only, got ${words.length} (${words.join(' ')}); use --only a,b for several suites`);
  return { word: words[0] || '', flags, errors };
}

/* ---- vocabulary and nearest words ---------------------------------------------------------------------------- */

export function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export function nearest(word, vocab, k = 3) {
  const w = word.toLowerCase();
  return [...new Set(vocab)].map((v) => ({ v, d: Math.min(lev(w, v.toLowerCase()), v.toLowerCase().includes(w) ? 1 : 99) })).sort((a, b) => a.d - b.d || a.v.length - b.v.length).slice(0, k).map((x) => x.v);
}

/** Why a row can never be selected (S6): '' when it can. */
export function excludedReason(row) {
  if (row.optIn) return 'optIn (explicit owner command only)';
  if (row.kind === 'tool') return 'kind:tool (a generator or measurement script, never reachable by a tier)';
  if (row.liveCredentials) return 'liveCredentials (talks to a real service with credentials)';
  if (row.liveNetwork) return 'liveNetwork (needs the real network)';
  return '';
}

export function vocabulary(rows, features = []) {
  const feats = new Set(features);
  const tags = new Set();
  for (const r of rows) { for (const f of r.features || []) feats.add(f); for (const t of r.tags || []) tags.add(t); }
  return { tiers: TIERS, modes: MODES, features: [...feats].sort(), lanes: LANES, tags: [...tags].sort(), ids: rows.map((r) => r.id) };
}

/* ---- tiers ---------------------------------------------------------------------------------------------------- */

const isExtra = (r) => (r.tags || []).includes('extra');

/** Rows of a named tier (spec 2.4). Excluded rows never appear. */
export function selectTier(tier, rows) {
  const isSmoke = (r) => (r.tags || []).includes('smoke');
  const ok = rows.filter((r) => !excludedReason(r));
  const notByHand = (r) => !r.byHand;
  switch (tier) {
    case 'smoke': return ok.filter(isSmoke);
    case 'regression': return ok.filter((r) => ['gate', 'node', 'headless'].includes(r.lane) && notByHand(r) && !isExtra(r));
    case 'e2e': return ok.filter((r) => ['headless', 'headed'].includes(r.lane) && !isExtra(r));
    case 'full': return ok;
    case 'release': return ok.filter((r) => (r.tags || []).includes('release'));
    default: return [];
  }
}

/* ---- the word ------------------------------------------------------------------------------------------------- */

/**
 * Resolve to { ok:true, kind, name, ids, tier, engine?, via } or { ok:false, exit:64, message, candidates }.
 * `rows` are normalised manifest rows. `word` '' means changed.
 */
export function resolveWord(word, rows, features = [], tierApi = null) {
  const voc = vocabulary(rows, features);
  const tierNames = tierApi?.names || TIERS;
  const tierRows = (t) => (tierApi ? tierApi.select(t) : selectTier(t, rows).map((x) => x.id));
  const w = String(word || '').trim();
  if (!w) return { ok: true, kind: 'changed', name: 'changed', via: 'no word given' };
  const lw = w.toLowerCase();
  if (lw === 'changed') return { ok: true, kind: 'changed', name: 'changed', via: 'word' };
  if (lw === 'last') return { ok: true, kind: 'last', name: 'last', via: 'word' };
  if (lw === 'list') return { ok: true, kind: 'list', name: 'list', via: 'word' };
  if (lw === 'coverage') return { ok: true, kind: 'coverage', name: 'coverage', via: 'word' };
  if (lw === 'cft') return { ok: true, kind: 'tier', name: 'smoke', tier: 'smoke', engine: 'cft', ids: tierRows('smoke'), via: 'word cft (smoke on the CfT engine)' };
  if (tierNames.includes(lw)) return { ok: true, kind: 'tier', name: lw, tier: lw, ids: tierRows(lw), via: 'tier' };
  const pick = (kind, pred) => {
    const sel = rows.filter((r) => !excludedReason(r) && !isExtra(r) && pred(r));
    return { ok: true, kind, name: w, ids: sel.map((r) => r.id), tier: null, via: kind };
  };
  const also = [];
  const feat = voc.features.includes(lw) ? 'feature' : null;
  const lane = LANES.includes(lw) ? 'lane' : null;
  const tag = voc.tags.includes(w) || voc.tags.includes(lw) ? 'tag' : null;
  const found = feat || lane || tag;
  if (found) {
    for (const k of [feat, lane, tag]) if (k && k !== found) also.push(k);
    const r = found === 'feature' ? pick('feature', (x) => (x.features || []).includes(lw))
      : found === 'lane' ? pick('lane', (x) => x.lane === lw)
        : pick('tag', (x) => (x.tags || []).some((t) => t === w || t === lw));
    if (also.length) r.via += ` (also a ${also.join(' and ')}; first match wins)`;
    return r;
  }
  const byId = rows.find((r) => r.id === w) || rows.find((r) => r.id === `test-${w}`);
  if (byId) {
    const why = excludedReason(byId);
    if (why) return { ok: false, exit: 64, message: `${byId.id} is excluded by construction: ${why}. A named run needs --allow-live from a terminal.`, candidates: [byId.id], excluded: true, id: byId.id };
    return { ok: true, kind: 'suite', name: byId.id, ids: [byId.id], tier: null, via: 'exact suite id' };
  }
  const preAll = rows.filter((r) => r.id.startsWith(lw) || r.id.replace(/^test-/, '').startsWith(lw));
  const preOk = preAll.filter((r) => !excludedReason(r));
  const pre = preOk.length ? preOk : preAll;
  if (pre.length === 1) {
    const why = excludedReason(pre[0]);
    if (why) return { ok: false, exit: 64, message: `${pre[0].id} is excluded by construction: ${why}.`, candidates: [pre[0].id], excluded: true, id: pre[0].id };
    return { ok: true, kind: 'suite', name: pre[0].id, ids: [pre[0].id], tier: null, via: `unique prefix of ${pre[0].id}` };
  }
  if (pre.length > 1) return { ok: false, exit: 64, message: `"${w}" is ambiguous: ${pre.length} suites start with it; nothing ran`, candidates: pre.map((r) => r.id).slice(0, 12), ambiguous: true };
  const all = [...voc.tiers, ...voc.modes, ...voc.features, ...voc.lanes, ...voc.tags, ...voc.ids];
  return { ok: false, exit: 64, message: `unknown word "${w}"; nothing ran. Nearest: ${nearest(w, all).join(', ')}. Type: npm run t list`, candidates: nearest(w, all), unknown: true };
}

/** Filters from flags (--feature --tag --lane --stage --only), ANDed over `ids`. */
export function applyFilters(rows, ids, flags) {
  let sel = rows.filter((r) => ids.includes(r.id));
  const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
  if (flags.feature) { const f = list(flags.feature); sel = sel.filter((r) => (r.features || []).some((x) => f.includes(x))); }
  if (flags.tag) { const f = list(flags.tag); sel = sel.filter((r) => (r.tags || []).some((x) => f.includes(x))); }
  if (flags.lane) { const f = list(flags.lane); sel = sel.filter((r) => f.includes(r.lane)); }
  if (flags.stage) { const f = list(flags.stage).map((s) => `stage:${s}`); sel = sel.filter((r) => (r.tags || []).some((x) => f.includes(x))); }
  return sel;
}

/**
 * The full decision for one command line. Returns
 * { ok, exit?, message?, mode: 'run'|'changed'|'last'|'list'|'coverage', kind, name, rows?, tier, label, engine, delivery, picked }.
 * `--only a,b`: exact ids (or prefixes); an excluded one exits 64 unless allowLive (a TTY, one named suite).
 */
export function route({ argv, env = {}, rows, features = [], isTTY = false, tierApi = null }) {
  const { word, flags, errors } = parseArgv(argv, env);
  if (errors.length) return { ok: false, exit: 64, message: errors.join('; '), flags };
  if (flags.help) return { ok: true, mode: 'help', flags };
  const only = flags.only ? String(flags.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (only) {
    const picked = [];
    for (const o of only) {
      const r = resolveWord(o, rows, [], tierApi);
      if (!r.ok && r.excluded && flags.allowLive && isTTY && only.length === 1) { picked.push(r.id); continue; }
      if (!r.ok || r.kind !== 'suite') return { ok: false, exit: 64, message: r.ok ? `--only takes suite ids, "${o}" is a ${r.kind}` : r.message, candidates: r.candidates, flags };
      picked.push(r.ids[0]);
    }
    return { ok: true, mode: 'run', kind: 'suite', name: only.join(','), rows: rows.filter((x) => picked.includes(x.id)), tier: null, label: only.length <= 2 ? `only ${only.join(',')}` : `only ${only[0]} +${only.length - 1}`, engine: flags.engine || null, delivery: false, flags, picked: `only ${only.join(',')}` };
  }
  let res;
  if (!word && flags.tier) res = resolveWord(flags.tier, rows, features, tierApi);
  else if (!word && flags.list) res = { ok: true, kind: 'list', name: 'list' };
  else if (!word && flags.coverage) res = { ok: true, kind: 'coverage', name: 'coverage' };
  else if (!word && flags.changed) res = { ok: true, kind: 'changed', name: 'changed', via: '--changed' };
  else if (!word && (flags.feature || flags.tag || flags.lane || flags.stage)) res = { ok: true, kind: 'filter', name: 'filter', ids: rows.filter((r) => !excludedReason(r) && !(r.tags || []).includes('extra')).map((r) => r.id) };
  else res = resolveWord(word, rows, features, tierApi);
  if (!res.ok && res.excluded && flags.allowLive && isTTY) res = { ok: true, kind: 'suite', name: res.id, ids: [res.id], tier: null, via: '--allow-live from a terminal' };
  if (!res.ok) return { ...res, flags };
  if (res.kind === 'changed' || res.kind === 'last' || res.kind === 'list' || res.kind === 'coverage') {
    return { ok: true, mode: res.kind, kind: res.kind, name: res.name, flags, picked: res.kind === 'changed' ? `changed (${res.via})` : res.kind, engine: flags.engine || null, delivery: false, tier: res.kind === 'changed' ? 'changed' : res.kind, label: res.kind };
  }
  const sel = applyFilters(rows, res.ids, flags);
  const filtered = Boolean(flags.feature || flags.tag || flags.lane || flags.stage);
  const tier = res.tier && !filtered ? res.tier : null;
  const label = tier || (filtered ? `${res.name || 'filter'}+filters` : res.name);
  return {
    ok: true, mode: 'run', kind: res.kind, name: res.name, rows: sel, tier, label, engine: res.engine || flags.engine || null, flags,
    delivery: tier === 'full' || tier === 'release', picked: `${res.kind} ${res.name}${res.via && res.kind !== 'tier' ? ` (${res.via})` : ''}`,
  };
}
