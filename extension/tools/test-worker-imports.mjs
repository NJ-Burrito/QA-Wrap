/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * What the service worker loads, and how it is allowed to load it.
 *
 * ── The finding this file exists to record ──────────────────────────────────
 *
 * The audit proposed converting the worker's rarely used heavy imports —
 * exporters, docs, postman, ISTQB, the flow diagram, the workbook writer — to
 * `await import()` at their call sites, so a cold start would parse a fraction
 * of the graph. It was implemented, measured, and it works beautifully: 41
 * static imports fell to 12, the boot graph from 46 modules / 718 KB to 13
 * modules / 311 KB, and the worker's module evaluation from a median of 74.9 ms
 * to 43.7 ms across six cold starts.
 *
 * It also does not run. `tools/stress.mjs` answered every export, every ISTQB
 * document and every partition with:
 *
 *     import() is disallowed on ServiceWorkerGlobalScope by the HTML
 *     specification. See https://github.com/w3c/ServiceWorker/issues/1356.
 *
 * A service worker's module graph must be knowable at registration, because the
 * browser has to be able to reinstall the worker without running it. So
 * `import()` is forbidden there — not throttled, not discouraged: it throws,
 * every time, after the initial evaluation. The change was reverted.
 *
 * That is not a null result. It found a line that had been shipping broken:
 * `UQA_VERIFY_PNG` did `const { readPng } = await import('../core/provenance.js')`,
 * which had never once succeeded on any build. And it fixes the shape of the
 * problem for whoever picks it up next — the only place in this extension that
 * *may* load a module on demand is the offscreen document, which is an ordinary
 * page. Moving the export and document builders behind it is the real version
 * of this optimisation, and it is a refactor, not an edit.
 *
 * ── So this file guards two things ─────────────────────────────────────────
 *
 *   1. **No `import()` in anything the worker loads.** It cannot work, and it
 *      fails at the moment a tester presses the button rather than at build
 *      time, which is the worst place for a failure to appear. One of these
 *      shipped; a second one must not.
 *   2. **A ceiling on the static graph.** With lazy loading off the table, the
 *      only defence left against the boot cost is not letting it grow. Adding a
 *      module to the worker should mean raising a number here on purpose.
 *
 * The graph is read from the source, not from a bundler — there is no build
 * step and the browser resolves these itself, so the source is the truth.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'background/service-worker.js';

/* ── the ceilings ─────────────────────────────────────────────────────────
 *
 * ── what the three numbers mean ──────────────────────────────────────────
 *
 *   MAX_DIRECT      how many distinct modules `background/service-worker.js`
 *                   names in a static `import` of its own. It is a measure of
 *                   how much the worker file reaches for directly.
 *   MAX_TRANSITIVE  how many modules reach the parser at boot once every one
 *                   of those imports is followed to its own imports, the
 *                   worker file included. This is the real boot graph.
 *   MAX_BYTES       the source bytes of that whole graph. MV3 parses all of
 *                   it on every cold start, and a cold start happens every
 *                   time the worker is evicted — which is constantly.
 *
 * ── why they moved, and what moved them ──────────────────────────────────
 *
 * The baseline in `research/20-backend-batch4.md` is **41 direct / 46
 * transitive / 718.3 KB**. This file was raised to **42 / 47 / 780 KB**. One
 * module joined the graph and one module grew:
 *
 *   **`core/provenance.js` (16.9 KB) became a static import** at
 *   `service-worker.js:53`. It is the +1 direct and the +1 transitive, and
 *   almost 17 KB of the byte rise. It was not new work: `UQA_VERIFY_PNG` had
 *   been doing `await import('../core/provenance.js')`, which throws inside a
 *   service worker and had therefore never once succeeded on any shipped
 *   build. Making it static is the fix for a broken feature, not a
 *   regression — the cost was always meant to be paid, it was simply being
 *   paid with an exception instead.
 *
 *   **`background/service-worker.js` itself grew**, from roughly 175 KB to
 *   190+ KB across the sleep/wake, write-queue and recovery work. That is the
 *   rest of the rise. It is the one file in the graph that nothing can be
 *   moved out of without a refactor, because it is the entry point.
 *
 * ── should the ratchet be a hard cap? ────────────────────────────────────
 *
 * **Yes, from here.** A ceiling that is raised whenever it is touched
 * measures nothing; it only records what happened. The one raise above was
 * defensible because it bought a feature back from a line that could never
 * work. The next one would not be.
 *
 * So: **do not raise these numbers to make a red test go green.** If the
 * graph outgrows them, the answer is one of
 *
 *   · move the work to `offscreen/`, which is an ordinary page and may use
 *     `await import()` — this is the real version of the lazy-loading
 *     optimisation the header above describes, and the only one the platform
 *     allows;
 *   · split `service-worker.js`, whose 190 KB is now a quarter of the graph;
 *   · or delete something.
 *
 * If a raise really is the right answer, it is a decision with a name on it:
 * change the number, say in this comment which module moved and why, and put
 * the measurement in `research/`. That is what these three paragraphs are.
 *
 * ── the one raise since, and what it cost ──────────────────────────
 *
 * **MAX_DIRECT 42 → 43**, later the same day, for `core/docshell.js` — the note
 * on the constant names it and says why. It is the one shape of raise this file
 * takes without an argument attached, because it was measured: `docshell.js`
 * was already in the graph, so `MAX_TRANSITIVE` did not move and the byte total
 * moved only with `service-worker.js`'s own growth. Nothing new reaches the
 * parser; the cold start is unchanged. The failure message on that test now
 * says this out loud when it fires, so the next person is choosing between
 * "delete one redundant line" and "move the work", rather than nudging a
 * number.
 *
 * ── the second raise, 6 September ───────────────────────────────
 *
 * **MAX_BYTES 780 → 800 KB.** This one IS a cost, unlike the direct-import
 * raise above, and the note on the constant carries the three files that grew,
 * what was tried before raising, and the refactor the raise is on loan
 * against. It is written down because a number that moves without a reason
 * beside it stops being a ceiling; this one has a reason and a debt.
 *
 * Headroom today (council-1010 r4-12-6): the cap is 763 KB, measured 753.6 KB, and the working line
 * is 755 KB, asserted by WORKING_LINE_BYTES below (a change that takes the graph past it needs the offscreen door first, not a raise). The
 * 6 September figures this paragraph once carried (43 / 47 / ~789 KB against 800 KB) are history. Both
 * module counts are **at** their cap — the next module that reaches the parser at boot fails this
 * suite, which is the point.
 */

/**
 * Distinct modules the worker names in a static `import`. Forty-three today.
 *
 * Raised from 42 on 5 September 2026, deliberately and with nothing to hide:
 * the forty-third is `core/docshell.js`, which was **already** in the graph
 * below (through `core/exporters.js`, `core/docs.js` and `core/links.js`) and is
 * now also named directly, so `brandAssets()` can prime the document
 * typefaces at the same moment it fetches the lockup. Nothing new reaches the
 * parser: the transitive count and the byte count are the numbers that measure
 * cold-start cost, and neither moved because of this. This one counts how many
 * modules the worker *names*, which is a readability figure, not a cost.
 */
// 12 Oct 2026 (OF-18): 37 -> 27, the worker's handler groups and helpers now live in ten background/worker-*.js and handlers-*.js modules.
const MAX_DIRECT = 27;

/**
 * Everything that reaches the parser at boot, transitively, the worker included.
 *
 * One of the two hard caps: with MAX_BYTES it IS the cold-start cost. Moving
 * this means the boot genuinely got more expensive, and the answer is the
 * offscreen document, a split, or a deletion — not a bigger number.
 */
// 30 Sept 2026: 47 -> 42, measured.
// 12 Oct 2026 (OF-18): 42 -> 52, the ten modules split out of service-worker.js (same code, bytes +4.3 KB; the 755 KB line below is unchanged).
const MAX_TRANSITIVE = 52;

/**
 * Bytes of source parsed on every cold start. Cap 763 KB, measured 753.6 KB, working line 755 KB.
 *
 * A hard cap. The raise below is history (780 -> 800 KB on 6 September 2026, since repaid to 763 KB),
 * recorded here rather than nudged. Three files grew in one day and together
 * they took the graph from 758.3 KB to 789.0 KB:
 *
 *   core/flow.js                    25.4 -> 33.3 KB
 *   core/artifact.js                21.5 -> 28.8 KB
 *   background/context-menus.js    13.0 -> 23.0 KB   (all sixteen tools on the
 *                                                     right-click menu)
 *
 * What was tried first, because a raise is the last answer and not the first:
 * the menu's tool catalogue was moved out of the module graph entirely, into
 * `core/tool-catalogue.json`, fetched at menu-build time rather than imported.
 * That is the offscreen-document trick applied to data, and it is why
 * context-menus.js is 23.0 KB and not 27.2. It saved less than the day's growth
 * and the graph stayed over.
 *
 * THE FOLLOW-UP, and this raise is on loan against it: move the export builders
 * (`core/exporters.js`, `core/docs.js`, `core/istqb.js`, `core/postman.js`) and the
 * flow renderer (`core/flow.js`) behind the offscreen document, which is an
 * ordinary page and may use `await import()`. That is ~120 KB of the graph and
 * it is the refactor this file's header has named since the lazy-loading
 * attempt was reverted. That follow-up has landed in part (see the 30 Sept notes below); the cap is
 * 763 KB and is a ceiling, not a budget: it is never raised to pass a gate.
 */
// 30 Sept 2026: back to 800 KB. The 29 Sept loan (800 -> 820 KB) was repaid by deleting dead exports and moving the
// Markdown/CSV ticket formats (core/formats-export.js) and the PNG/HTML stamp (core/provenance-stamp.js) out of the boot graph.
// (History) 29 Sept 2026 (devil-fix, decision recorded in research/56): 800 -> 820 KB, on loan. Lanes A1-A3, B added ~11 KB
// (replay seq + capture-gap, pre-roll ring, reporter shot, shared fetchT). The offscreen follow-up above is still owed.
// 30 Sept 2026: 800 -> 763 KB (measured 752.9 + 10). Only ever lowered by the offscreen doors.
// 1 Oct 2026 (T-034, tools/perf-worker.mjs, numbers in tools/perf-worker-baseline.json): worker module graph to end of evaluation, median of 10
// cold starts: stub 22.8 ms, real tree 125.4 ms, real + 70 KB of comments 84.9 ms. 70 KB of padding is below this machine's noise, so the cap is
// neither raised nor replaced by an ms gate on this evidence (research/56).
const MAX_BYTES = 763 * 1024;

/**
 * D-1010-68: the working line, a HARD failure under the cap. Measured 753.6 KB on 10 Oct 2026 (council-1010 round 4),
 * which leaves 1.4 KB under this line and 9.4 KB under the cap. The prose line "keep it at or under 755 KB" was breached once
 * (758.6 KB in round 2) with every gate green, so it is asserted now. Past it, the next byte goes behind the offscreen door;
 * the line is never raised.
 */
const WORKING_LINE_BYTES = 755 * 1024;

const STATIC_IMPORT = /^\s*(?:import\s+[\s\S]*?\s+from\s+|import\s+|export\s+[\s\S]*?\s+from\s+)'([^']+)';/gm;
/** `import(` as a call — not the word inside a comment, and not `import x from`. */
const DYNAMIC_IMPORT = /(^|[^.\w$])import\s*\(/g;

const rel = (p) => path.relative(root, p).replace(/\\/g, '/');

/** Every module reachable from `file` through static imports only. */
function closure(file) {
  const seen = new Map();
  const walk = (abs) => {
    const key = rel(abs);
    if (seen.has(key)) return;
    const src = fs.readFileSync(abs, 'utf8');
    seen.set(key, src);
    for (const m of src.matchAll(STATIC_IMPORT)) {
      if (!m[1].startsWith('.')) continue;
      walk(path.resolve(path.dirname(abs), m[1]));
    }
  };
  walk(path.resolve(root, file));
  return seen;
}

/** Strip comments and string literals, so prose about `import()` is not a hit. */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

const graph = closure(ENTRY);
const entrySrc = graph.get(ENTRY);
const direct = [...new Set([...entrySrc.matchAll(STATIC_IMPORT)].map((m) => m[1]))];
const bytes = [...graph.values()].reduce((a, s) => a + s.length, 0);

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('service worker — what is loaded on every cold start');
console.log(`  (${direct.length} direct, ${graph.size} transitive, ${(bytes / 1024).toFixed(1)} KB)`);

test('nothing the worker loads calls import() at runtime', () => {
  const offenders = [];
  for (const [file, src] of graph) {
    for (const m of codeOnly(src).matchAll(DYNAMIC_IMPORT)) {
      offenders.push(`${file}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(offenders, [],
    'import() throws inside a service worker — "import() is disallowed on\n' +
    '       ServiceWorkerGlobalScope by the HTML specification". Use a static import,\n' +
    '       or move the work to the offscreen document, which is an ordinary page.\n' +
    `       Found at: ${offenders.join(', ')}`);
});

test(`no more than ${MAX_DIRECT} modules are imported statically`, () => {
  // When this one goes red on its own — the transitive count and the byte total
  // unchanged — nothing new reaches the parser: a module that was already in
  // the boot graph is now also named in the entry file. That is a shape change,
  // not a cost, and the message says so, because the two want different
  // answers. A cost needs the work moved; a shape needs one line deleted, or
  // this number moved by one with the measurement written down beside it.
  assert.ok(direct.length <= MAX_DIRECT,
    `${direct.length} static imports, ceiling is ${MAX_DIRECT}. ` +
    `The boot graph is ${graph.size}/${MAX_TRANSITIVE} modules and ` +
    `${(bytes / 1024).toFixed(1)}/${(MAX_BYTES / 1024).toFixed(0)} KB. ` +
    (graph.size <= MAX_TRANSITIVE && bytes <= MAX_BYTES
      ? 'Both of those are still inside their ceilings, so this new import costs nothing at boot: ' +
        'the module was already reachable. Delete the redundant import, or raise MAX_DIRECT by one ' +
        'and say in this file which module and why.'
      : 'The boot cost moved too. Put the feature behind the offscreen document, which is an ' +
        'ordinary page and may use await import().'));
});

test(`no more than ${MAX_TRANSITIVE} modules reach the parser at boot`, () => {
  assert.ok(graph.size <= MAX_TRANSITIVE,
    `${graph.size} modules load at boot, ceiling is ${MAX_TRANSITIVE}:\n         ${[...graph.keys()].join('\n         ')}`);
});

test(`the boot graph is under ${(MAX_BYTES / 1024).toFixed(0)} KB of source`, () => {
  assert.ok(bytes <= MAX_BYTES,
    `${(bytes / 1024).toFixed(1)} KB, ceiling is ${(MAX_BYTES / 1024).toFixed(0)} KB. ` +
    'MV3 re-parses all of this on every worker start.');
});

test(`the boot graph is at or under the ${(WORKING_LINE_BYTES / 1024).toFixed(0)} KB working line (D-1010-68)`, () => {
  assert.ok(bytes <= WORKING_LINE_BYTES,
    `${(bytes / 1024).toFixed(1)} KB is past the ${(WORKING_LINE_BYTES / 1024).toFixed(0)} KB working line (cap ${(MAX_BYTES / 1024).toFixed(0)} KB). ` +
    'Move code behind the offscreen door (the offscreen document may use dynamic import(), the worker may not) or delete; do not raise the line.');
});

test('the draft, spec and title code is behind the offscreen door, not in the worker (T-075 bytes)', () => {
  // core/artifact.js, core/formats.js and core/jira-templates.js moved to the offscreen document (DEC-07);
  // tools/test-draft-door.mjs proves the door answers what the core functions answer.
  const named = direct.filter((d) => /\/core\/(artifact|formats|jira-templates)\.js$/.test(d));
  assert.deepEqual(named, [], `the worker names ${named.join(', ')} again: call it through background/draft-door.js`);
  assert.ok(direct.includes('./draft-door.js'), 'the worker no longer imports ./draft-door.js');
});

test('no module in the boot graph carries a font', () => {
  // The in-page face (UI rework round 2, S8) is read from ui/fonts.css by
  // `fetch` when the page first asks (`UQA_OVERLAY_ASSETS`), never imported: a
  // few hundred KB of base64 in this graph would be parsed on every worker
  // start for a message most starts never see.
  const carrying = [...graph].filter(([, src]) => /@font-face|font\/woff2/.test(codeOnly(src)) || /data:font\//.test(src)).map(([k]) => k);
  assert.deepEqual(carrying, [], `font bytes reached the worker's boot graph: ${carrying.join(', ')}`);
});

test('every module the worker imports actually exists', () => {
  // A typo in a specifier stops the whole worker from registering, and the only
  // symptom is an extension that does nothing at all.
  for (const spec of direct) {
    if (!spec.startsWith('.')) continue;
    const abs = path.resolve(root, 'background', spec);
    assert.ok(fs.existsSync(abs), `import from '${spec}' points at nothing`);
  }
});

test('the four things that must work the instant the worker wakes are static', () => {
  // Boot, arm, ingest, record. Everything these touch has to be in the graph
  // before the first message arrives; there is no second chance to fetch it.
  const required = [
    'core/on.js', 'core/events.js', 'core/db.js', 'platform/settings.js', 'core/privacy.js',
    'background/armed.js', 'background/media.js', 'background/context-menus.js',
    'background/write-queue.js', 'background/action-icon.js', 'background/session-state.js',
  ];
  const missing = required.filter((m) => !graph.has(m));
  assert.deepEqual(missing, [], `missing from the worker's static graph: ${missing.join(', ')}`);
});

test('every helper the worker calls from background/media.js is imported', () => {
  // The bug this catches, which shipped green: the offscreen door was called as
  // `media.trackerOp(...)` and `media.exportOp(...)`, but media.js is imported
  // by name here and there is no `media` binding at all. Nothing failed until a
  // tester pressed Export, because no headed suite exercises a path that needs
  // a configured tracker, and the export steps only ran in `diagnose`.
  const media = fs.readFileSync(path.join(root, 'background/media.js'), 'utf8');
  const exported = [...media.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
  // Two views of the same file. Comments are blanked for the import scan,
  // because a `//` note inside the import block swallowed the name that
  // followed it; strings survive there, because the module path is a string.
  // The call scan uses `codeOnly()`, which blanks strings as well, so a
  // function name mentioned in a comment or a message is not read as a call.
  const noComments = entrySrc
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const src = codeOnly(entrySrc);
  const imported = new Set();
  // `[^}]*` and not `[\s\S]*?`: the lazy form starts at the file's first
    // `import {` and runs to the first media.js close, swallowing every block in
    // between and losing the first name of the real one.
    for (const m of noComments.matchAll(/import \{([^}]*)\} from '\.\/media\.js';/g)) {
    for (const name of m[1].split(',')) {
      const clean = name.trim().split(' as ').pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(clean)) imported.add(clean);
    }
  }
  const called = exported.filter((name) => new RegExp('(^|[^.\\w])' + name + '\\s*\\(', 'm').test(src));
  const missing = called.filter((name) => !imported.has(name));
  assert.deepEqual(missing, [],
    `called but not imported from ./media.js: ${missing.join(', ')}`);
});


/* ── r6-01-2: the worker registers its listeners on its first turn ─────────────
 * Chrome wakes a stopped worker for an event only if the listener was registered while the script first ran. One
 * registered after an await, or inside a callback, is missed by the very event that woke the worker. So every
 * chrome.*.on*.addListener (and the on() wrapper around it) under background/ sits at module scope, or in a named
 * function listed here with the reason. A boot function must also be called from module scope; a dynamic one is a
 * registration that cannot happen at load (a permission that arrives later, a one-shot debugger wait). */
const BOOT = {
  'background/armed.js:watchStorage': 'called by watchWindows',
  'background/armed.js:watchTabs': 'called by watchWindows',
  'background/armed.js:watchWindows': 'armed.watchWindows() at module scope in service-worker.js',
  'background/site-access.js:watchSiteAccess': 'site.watchSiteAccess(...) at module scope in service-worker.js',
  'background/context-menus.js:installContextMenus': 'installContextMenus({...}) at module scope in service-worker.js',
  'background/handlers-tools.js:watchDebuggerDetach': 'watchDebuggerDetach() at module scope in service-worker.js',
};
const DYNAMIC = {
  'background/security-headers.js:ensureListener': 'the dynamic webRequest listener, registered when a window first needs it',
  'background/draft-door.js:bridgeSync': 'the agent bridge native port, made only while the user has the bridge on; a port listener is not the event that wakes the worker',
  'background/whitebox.js:afterLoad': 'a one-shot debugger.onEvent wait, removed when it settles',
};
const fnName = (n) => (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) ? n.name?.getText() : ts.isVariableDeclaration(n.parent) ? n.parent.name.getText() : null);
const isFn = (n) => ts.isFunctionLike(n) || ts.isClassStaticBlockDeclaration?.(n);

/** @param {Record<string,string>} files path -> source @returns {{stray: string[], tla: string[], moduleScope: Record<string, number>}} */
function scanListeners(files) {
  const stray = [];
  const tla = [];
  const moduleScope = {};
  for (const [file, src] of Object.entries(files)) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    let lastReg = -1;
    const awaits = [];
    const walk = (n) => {
      let fn = null;
      let named = null;
      for (let p = n.parent; p; p = p.parent) if (isFn(p)) { fn ||= p; if (!named && (named = fnName(p))) break; }
      if (ts.isCallExpression(n)) {
        const callee = n.expression.getText().replace(/\?/g, '');
        const wrapper = callee === 'on' && /^chrome\.[\w.]*\.on[A-Z]\w*$/.test(n.arguments[0]?.getText().replace(/\?/g, '') || '');
        if (wrapper || /\.addListener$/.test(callee)) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          if (!fn) lastReg = Math.max(lastReg, n.getStart());
          else if (!((`${file}:${named}`) in BOOT) && !((`${file}:${named}`) in DYNAMIC)) stray.push(`${file}:${line} in ${named || 'an anonymous function'}`);
        }
      }
      if (!fn && (ts.isAwaitExpression(n) || (ts.isForOfStatement(n) && n.awaitModifier))) awaits.push(n.getStart());
      ts.forEachChild(n, walk);
    };
    walk(sf);
    moduleScope[file] = lastReg;
    for (const a of awaits) if (a < lastReg) tla.push(`${file}:${sf.getLineAndCharacterOfPosition(a).line + 1}`);
  }
  return { stray, tla, moduleScope };
}

const bgFiles = () => Object.fromEntries(fs.readdirSync(path.join(root, 'background')).filter((f) => f.endsWith('.js')).map((f) => [`background/${f}`, fs.readFileSync(path.join(root, 'background', f), 'utf8')]));

test('r6-01-2: every chrome.*.on*.addListener under background/ is at module scope or on the named allow-list', () => {
  const { stray } = scanListeners(bgFiles());
  assert.deepEqual(stray, [], `a listener registered after the first turn would miss the event that woke the worker: ${stray.join('; ')}`);
});

test('r6-01-2: no top-level await comes before the last listener registration in service-worker.js', () => {
  const { tla, moduleScope } = scanListeners({ [ENTRY]: entrySrc });
  assert.ok(moduleScope[ENTRY] > 0, 'the scan found the worker\'s module-scope registrations');
  assert.deepEqual(tla, [], `top-level await before the last on(): ${tla.join(', ')}`);
});

test('r6-01-2: every boot-time registration function is called from module scope', () => {
  const sf = ts.createSourceFile(ENTRY, entrySrc, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const topCalls = sf.statements.filter(ts.isExpressionStatement).map((s) => s.expression).filter(ts.isCallExpression).map((c) => c.expression.getText());
  for (const call of ['armed.watchWindows', 'site.watchSiteAccess', 'installContextMenus', 'watchDebuggerDetach']) assert.ok(topCalls.includes(call), `${call}() is called at module scope in service-worker.js`);
  const armedSrc = fs.readFileSync(path.join(root, 'background/armed.js'), 'utf8');
  const body = armedSrc.slice(armedSrc.indexOf('export function watchWindows()'));
  assert.ok(/\bwatchStorage\(\);/.test(body) && /\bwatchTabs\(\);/.test(body), 'watchWindows() starts watchStorage() and watchTabs()');
  for (const key of [...Object.keys(BOOT), ...Object.keys(DYNAMIC)]) assert.ok(fs.readFileSync(path.join(root, key.split(':')[0]), 'utf8').includes(key.split(':')[1]), `${key} still exists, or its allow-list entry is stale`);
});

test('r6-01-2: the scan is red on its falsifiers (a listener in a callback, a stray function, an await before the last on())', () => {
  const bad = scanListeners({
    'background/a.js': 'setTimeout(() => { chrome.tabs.onUpdated.addListener(() => {}); }, 0);\nfunction later() { on(chrome.runtime?.onStartup, "x", () => {}); }',
    'background/b.js': 'const cfg = await load();\non(chrome.alarms?.onAlarm, "alarm", () => {});',
  });
  assert.equal(bad.stray.length, 2, bad.stray.join('; '));
  assert.equal(bad.tla.length, 1, 'an await ahead of the last registration is flagged');
  const good = scanListeners({ 'background/c.js': 'on(chrome.alarms?.onAlarm, "alarm", () => {});\nchrome.runtime.onMessage.addListener(() => {});\nconst later = await load();' });
  assert.deepEqual([good.stray, good.tla], [[], []], 'module scope and an await AFTER the last registration are fine');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
