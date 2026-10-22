/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Worker helpers for the smoke and realism lane (test pipeline P5, 12 Oct 2026).
 *
 * Two halves, both plain node:
 *
 *   1. **Static.** `deriveClosure` walks the import graph from the entry points the browser loads, and
 *      `importProblems` answers the two questions `node --check` cannot: does every relative import point at a file
 *      that exists, and does every `import { name }` name something the target actually exports? `node --check` only
 *      parses, so a renamed export sails through it (rehearsal R11 measured exactly that blind spot).
 *   2. **Live.** `killWorkers` stops the extension's service worker the way Chrome does when it is idle, with
 *      `Target.closeTarget` over a browser CDP session, and `waitForWorker` polls the target list for the next one.
 *      Polls the targets, never Playwright's `serviceworker` event: it did not fire for a revived worker (R3), and a
 *      worker Playwright is attached to never idles out on its own, so an explicit kill is the only honest restart.
 *
 * The static half works on any folder (`root`), so the suites prove it on a deliberately broken temp copy as well as
 * on the real tree: a gate that has never been seen to go red is a gate nobody knows works.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/* ── static: the import closure ─────────────────────────────────────────── */

/** Lines that are not code: line comments and block-comment bodies (their lines start with a star). */
const codeOnly = (src) => src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const IMPORT_RE = /(?:^|[\s;}])(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|importScripts\(\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)/g;

/** Every specifier a file loads: `{ spec, dynamic }`. Bare specifiers (no `.` or `/`) are left to the caller. */
export function specifiersOf(src) {
  const out = [];
  const code = codeOnly(src);
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(code))) {
    if (m[3]) for (const x of m[3].matchAll(/['"]([^'"]+)['"]/g)) out.push({ spec: x[1], dynamic: false });
    else out.push({ spec: m[1] || m[2], dynamic: !!m[2] });
  }
  return out;
}

/**
 * The files reachable from `entries` (paths relative to `root`).
 *
 * @returns {{files: string[], missing: {from: string, spec: string}[], dynamicOnly: string[]}}
 *   `files` are absolute and exist; `missing` is a load that points at nothing; `dynamicOnly` are files reached only
 *   through `import()` / `importScripts`, listed so a report can say how much of the closure is lazy.
 */
export function deriveClosure(root, entries) {
  const seen = new Set();
  const staticSeen = new Set();
  const missing = [];
  const queue = entries.map((e) => ({ f: path.resolve(root, e), dyn: false }));
  while (queue.length) {
    const { f, dyn } = queue.pop();
    if (!dyn) staticSeen.add(f);
    if (seen.has(f)) continue;
    if (!fs.existsSync(f)) { missing.push({ from: '(entry)', spec: path.relative(root, f) }); seen.add(f); continue; }
    seen.add(f);
    if (!/\.(m?js|cjs)$/.test(f)) continue; // json, css, html: existence is the whole check
    const src = fs.readFileSync(f, 'utf8');
    for (const { spec, dynamic } of specifiersOf(src)) {
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
      const target = path.resolve(path.dirname(f), spec);
      if (!fs.existsSync(target)) { missing.push({ from: path.relative(root, f), spec }); continue; }
      queue.push({ f: target, dyn: dynamic });
    }
  }
  const files = [...seen].filter((f) => fs.existsSync(f) && /\.(m?js|cjs)$/.test(f));
  return { files, missing, dynamicOnly: files.filter((f) => !staticSeen.has(f)) };
}


/** The module scripts of one HTML page, as paths relative to `root`. */
export function pageScripts(root, page) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const dir = path.posix.dirname(page.split(path.sep).join('/'));
  return [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((s) => !/^(https?:)?\/\//.test(s))
    .map((s) => path.posix.normalize(s.startsWith('/') ? s.slice(1) : path.posix.join(dir, s)));
}

/**
 * The files Chrome loads on its own in an extension folder: the manifest's service worker and every script of the
 * pages the manifest names, plus the report, welcome, offscreen and devtools-panel pages the worker opens by name.
 */
export function entriesFromManifest(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const pages = new Set([manifest.options_ui?.page, manifest.options_page, manifest.side_panel?.default_path, manifest.devtools_page, manifest.action?.default_popup]
    .filter(Boolean));
  for (const p of ['popup/popup.html', 'report/report.html', 'welcome/welcome.html', 'offscreen/offscreen.html', 'devtools/panel.html']) if (fs.existsSync(path.join(root, p))) pages.add(p);
  const entries = [manifest.background?.service_worker, ...[...pages].flatMap((p) => pageScripts(root, p))].filter(Boolean);
  return { entries: [...new Set(entries)], pages: [...pages], worker: manifest.background?.service_worker, manifest };
}

/* ── static: named imports against real exports ─────────────────────────── */

const exportCache = new Map();

/** What a module exports, read with line-anchored patterns (a name in a comment or a string is not an export). */
function exportsOf(file, root, depth = 0) {
  const key = file;
  if (exportCache.has(key)) return exportCache.get(key);
  const info = { names: new Set(), hasDefault: false, unknown: false };
  exportCache.set(key, info); // set first: `export *` cycles terminate
  let src = '';
  try { src = codeOnly(fs.readFileSync(file, 'utf8')); } catch { info.unknown = true; return info; }
  let m;
  const decl = /^export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s*([A-Za-z_$][\w$]*)/gm;
  while ((m = decl.exec(src))) info.names.add(m[1]);
  if (/^export\s+(?:const|let|var)\s*[{[]/m.test(src)) info.unknown = true; // destructured export: cannot enumerate
  const named = /^export\s*\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/gm;
  while ((m = named.exec(src))) {
    for (const part of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      const as = part.split(/\s+as\s+/);
      info.names.add((as[1] || as[0]).trim());
      if (/^default$/.test((as[1] || as[0]).trim())) info.hasDefault = true;
    }
  }
  const starAs = /^export\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from/gm;
  while ((m = starAs.exec(src))) info.names.add(m[1]);
  const star = /^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm;
  while ((m = star.exec(src))) {
    const target = resolveRel(file, m[1]);
    if (!target || depth > 20) { info.unknown = true; continue; }
    const sub = exportsOf(target, root, depth + 1);
    for (const n of sub.names) info.names.add(n);
    if (sub.unknown) info.unknown = true;
  }
  if (/^export\s+default\b/m.test(src)) info.hasDefault = true;
  return info;
}

function resolveRel(from, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  const t = path.resolve(path.dirname(from), spec);
  return fs.existsSync(t) && fs.statSync(t).isFile() ? t : null;
}

/**
 * Problems in the closure that a parse cannot see.
 *
 * @returns {{kind: 'missing-file'|'missing-export'|'missing-default', from: string, spec: string, name?: string}[]} with `.checked`, the number of named imports compared
 */
export function importProblems(root, files, missing = []) {
  exportCache.clear();
  const problems = missing.map((m) => ({ kind: 'missing-file', from: m.from, spec: m.spec }));
  problems.checked = 0; // names compared against a real export list, so a suite can prove it was not vacuous
  const IMPORT_FROM = /^import\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm;
  for (const f of files) {
    const src = codeOnly(fs.readFileSync(f, 'utf8'));
    let m;
    IMPORT_FROM.lastIndex = 0;
    while ((m = IMPORT_FROM.exec(src))) {
      const clause = m[1].trim();
      const target = resolveRel(f, m[2]);
      if (!target || !/\.(m?js|cjs)$/.test(target)) continue; // missing files are reported once, by deriveClosure
      const info = exportsOf(target, root);
      const rel = path.relative(root, f).split(path.sep).join('/');
      const named = /\{([^}]*)\}/.exec(clause);
      if (named) {
        for (const part of named[1].split(',').map((x) => x.trim()).filter(Boolean)) {
          const name = part.split(/\s+as\s+/)[0].trim();
          problems.checked++;
          if (name === 'default') { if (!info.hasDefault && !info.unknown) problems.push({ kind: 'missing-default', from: rel, spec: m[2] }); continue; }
          if (!info.names.has(name) && !info.unknown) problems.push({ kind: 'missing-export', from: rel, spec: m[2], name });
        }
      }
      const def = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
      if (def && !info.hasDefault && !info.unknown) problems.push({ kind: 'missing-default', from: rel, spec: m[2] });
    }
  }
  return problems;
}

/* ── live: the browser ──────────────────────────────────────────────────── */

/**
 * The engine, as a row label: `cft-151.0.7922.34 (Chrome/151.0.7922.34, chromium-1234, headless=new)`.
 * Read from the running browser, not from the package version, so it is what actually ran.
 */
export async function engineId(ctx, { headless = 'new', exe = '' } = {}) {
  const cdp = await ctx.browser().newBrowserCDPSession();
  try {
    const v = await cdp.send('Browser.getVersion');
    const build = /\/(\d+(?:\.\d+){3})/.exec(v.product)?.[1] || v.product;
    // Playwright's bundled "chromium" channel is Chrome for Testing (rehearsal R6: its browsers.json title says so).
    const folder = /chromium(?:_headless_shell)?-\d+/.exec(exe)?.[0] || 'unknown-folder';
    return { tag: `cft-${build}`, build, label: `cft-${build} (${v.product}, ${folder}, headless=${headless})` };
  } finally { await cdp.detach().catch(() => {}); }
}

/**
 * The build Playwright's bundled Chromium will be, read from its `browsers.json` before any browser starts, so every
 * output row (including the ones printed before the launch) carries the build id. `engineId` then confirms it live.
 */
export function plannedEngine() {
  try {
    const dir = path.dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'));
    const b = JSON.parse(fs.readFileSync(path.join(dir, 'browsers.json'), 'utf8')).browsers.find((x) => x.name === 'chromium');
    return { tag: `cft-${b.browserVersion}`, build: b.browserVersion, revision: b.revision };
  } catch { return { tag: 'cft-unknown', build: 'unknown', revision: '' }; }
}

/** Service-worker targets of one extension, from the browser's own target list. */
export async function workerTargets(cdp, extId) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  return targetInfos.filter((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns truthy or `ms` passes. Returns `{value, waited, error}`; `value` is null on timeout and `error` is the last throw. */
export async function poll(fn, ms = 10000, step = 100) {
  const t0 = Date.now();
  let error = null;
  for (;;) {
    let value = null;
    try { value = await fn(); error = null; } catch (e) { error = String(e.message || e).split('\n')[0]; }
    if (value) return { value, waited: Date.now() - t0, error: null };
    if (Date.now() - t0 > ms) return { value: null, waited: Date.now() - t0, error };
    await sleep(step);
  }
}

/**
 * Stop every worker of the extension and wait until the target list is empty.
 *
 * `Target.closeTarget` on a worker that is still starting can answer success and leave it alive (measured: a kill right
 * after an alarm wake left the target for 5 s), so a target that survives is closed again, every 250 ms, until the list
 * is empty or `ms` passes. `rounds` says how many closes it took; 1 is the normal case.
 */
export async function killWorkers(cdp, extId, { ms = 6000 } = {}) {
  const first = await workerTargets(cdp, extId);
  const t0 = Date.now();
  let rounds = 0;
  for (;;) {
    const alive = await workerTargets(cdp, extId);
    if (alive.length === 0) return { stopped: first.length, gone: true, waited: Date.now() - t0, rounds };
    if (Date.now() - t0 > ms) return { stopped: first.length, gone: false, waited: Date.now() - t0, rounds };
    rounds++;
    for (const t of alive) await cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
    await sleep(250);
  }
}

/** Wait for a new worker target to exist; resolves to its target info and how long it took. */
export async function waitForWorker(cdp, extId, ms = 10000) {
  const r = await poll(async () => (await workerTargets(cdp, extId))[0] || null, ms, 50);
  return { target: r.value, waited: r.waited };
}
