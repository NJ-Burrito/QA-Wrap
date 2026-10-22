/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Sweep library (test pipeline lane P4, 2026-10-12): everything a sweep that presses controls needs so that pressing
 * is safe, quick and resumable. Used by tools/test-buttons-all.mjs; clickthrough.mjs takes the guard from here too.
 *
 *   1. CLASSIFY FIRST (S3, S5). Before any control is pressed it is put in one class, by rule, not by a hand list:
 *        outward     the href is not a local scheme (mailto:, tel:, sms:, ms-*:, custom), or the handler it reaches
 *                    (read from the extension's own source, followed through the functions it calls) names an outward
 *                    message or API: UQA_JIRA_*, UQA_NOTIFY_*, UQA_TRACKER_*, mailto:, .eml, sendBeacon, a non-loopback fetch
 *        href-only   an http(s) link to a non-loopback host, chrome: or about: (judged by its href, never pressed)
 *        local       a handler was found and none of the outward markers is reachable from it, or a native form control
 *        listed      the handler cannot be read statically but the key is on tools/sweep-safe.json with a reason
 *        unclassified none of the above: FAIL classify me, and the control is NOT pressed
 *      A scheme that is outward is never pressed, not even with --include-outward.
 *   2. REPLACE, DO NOT TAP (S4). The in-page instrument records window.open, window.close, tabs.*, windows.*,
 *      downloads.download, sendBeacon and runtime.reload, and does NOT call the original when that would close or
 *      replace a harness page or reach a non-loopback target.
 *   3. QUIET SETTLE. A press is judged once the page has been quiet (no DOM mutation, no pending message or fetch) for a
 *      short window, instead of a fixed 650 ms per control. `--settle fixed` keeps the old waits for the equality check.
 *   4. CHUNKS. At most CHUNK_MAX (60) pressed controls per chunk, each chunk in a fresh browser, remaining work persisted
 *      so a run can --resume.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXT as EXT_ROOT, REPO } from './lib-paths.mjs';

export const CHUNK_MAX = 60;
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SAFE_FILE = path.join(HERE, 'sweep-safe.json');

/* ─────────────────────────── href rule ─────────────────────────── */

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])$/i;
export const schemeOf = (href) => { const m = /^\s*([a-z][a-z0-9+.-]*):/i.exec(String(href ?? '')); return m ? m[1].toLowerCase() : ''; };

/** @returns {{cls:'local'|'href-only'|'outward', why:string}} the class of a link target, by scheme alone. */
export function classifyHref(href) {
  const s = schemeOf(href);
  if (!s) return { cls: 'local', why: 'relative or fragment link' };
  if (s === 'http' || s === 'https') {
    try { return LOOPBACK_HOST.test(new URL(href).hostname) ? { cls: 'local', why: 'loopback link' } : { cls: 'href-only', why: `external ${s} link` }; } catch { return { cls: 'outward', why: 'unparseable http(s) target' }; }
  }
  if (s === 'chrome-extension' || s === 'blob' || s === 'data') return { cls: 'local', why: `${s}: link` };
  if (s === 'chrome' || s === 'about' || s === 'edge') return { cls: 'href-only', why: `${s}: page` };
  if (s === 'javascript') return /^javascript:\s*void/i.test(href) ? { cls: 'local', why: 'javascript:void' } : { cls: 'outward', why: 'javascript: with a body' };
  return { cls: 'outward', why: `scheme ${s}: leaves the browser (mail client or OS handler)` };
}

/* ─────────────────────────── source reading ─────────────────────────── */

const GROUP_DIRS = {
  popup: ['popup', 'ui', 'core', 'platform'], float: ['popup', 'ui', 'core', 'platform'], sidepanel: ['sidepanel', 'popup', 'ui', 'core', 'platform'],
  options: ['options', 'ui', 'core', 'platform'], report: ['report', 'ui', 'core', 'platform'], reporter: ['reporter', 'ui', 'core'],
  api: ['api', 'ui', 'core'], diagram: ['diagram', 'ui', 'core'], welcome: ['welcome', 'ui', 'core'], practice: ['practice', 'game'],
  annotate: ['annotate', 'ui', 'core'], replay: ['replay', 'ui', 'core'], videoedit: ['videoedit', 'ui', 'core'], devtools: ['devtools', 'ui', 'core'],
};
/** 'popup-awake' -> 'popup', 'devtools-panel' -> 'devtools'. */
export const groupOf = (surface) => { const g = String(surface).split('-')[0]; return GROUP_DIRS[g] ? g : 'popup'; };

/** Comments removed, strings kept. Not a parser: enough to keep `//` in a URL and `{` in a string out of the way. */
export function stripComments(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c; out += c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') { out += src[i++]; } if (q !== '`' && src[i] === '\n') break; out += src[i++]; }
      out += src[i] ?? ''; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

/** The balanced `{...}` starting at text[open] === '{' (string-aware), capped. */
export function blockAt(text, open, cap = 24000) {
  let depth = 0, i = open;
  const end = Math.min(text.length, open + cap);
  while (i < end) {
    const c = text[i];
    if (c === '\'' || c === '"' || c === '`') { const q = c; i++; while (i < end && text[i] !== q) { if (text[i] === '\\') i++; i++; } i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(open, i + 1); }
    i++;
  }
  return text.slice(open, end);
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await', 'new', 'else', 'do', 'try', 'with', 'super', 'import', 'delete', 'void', 'in', 'of', 'async', 'case', 'throw']);
const walkJs = (dir, out = []) => {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.isDirectory()) { if (!/^(node_modules|vendor|tools|tutorials|store|docs|types|_locales|brand|icons|dist|film)$/.test(e.name)) walkJs(path.join(dir, e.name), out); }
    else if (/\.(m?js)$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
};

const fileCache = new Map();
const fileText = (p) => { if (!fileCache.has(p)) fileCache.set(p, stripComments(fs.readFileSync(p, 'utf8'))); return fileCache.get(p); };
const groupFiles = new Map();
function filesOf(group) {
  if (!groupFiles.has(group)) {
    const list = [];
    for (const d of GROUP_DIRS[group] || GROUP_DIRS.popup) for (const f of walkJs(path.join(EXT_ROOT, d))) list.push(f);
    groupFiles.set(group, [...new Set(list)].map((f) => ({ file: f, rel: path.relative(EXT_ROOT, f).replace(/\\/g, '/'), text: fileText(f) })));
  }
  return groupFiles.get(group);
}

const DEFS = [
  /(?:^|[\s;{}(])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g,
  /(?:^|[\s;{}])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b[^(]*\(|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
  /^[ \t]*(?:async\s+|static\s+|get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm,
  /([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b[^(]*\([^)]*\)|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
];
const defIndex = new Map();
/** name -> [{rel, body}] for every function-like definition in the surface's source. */
function defsOf(group) {
  if (defIndex.has(group)) return defIndex.get(group);
  const map = new Map();
  for (const { rel, text } of filesOf(group)) {
    for (const re of DEFS) {
      re.lastIndex = 0;
      for (let m; (m = re.exec(text));) {
        const name = m[1];
        if (KEYWORDS.has(name)) continue;
        let from = m.index + m[0].length - 1;
        // for the three function forms the `{` is after the parameter list; for a method shorthand the match ends on it
        let open = text.indexOf('{', text[from] === '{' ? from : from);
        const eol = text.indexOf('\n', from);
        let body;
        if (open < 0 || (text.slice(from, open).includes('=>') && !/^\s*\{/.test(text.slice(text.indexOf('=>', from) + 2, text.indexOf('=>', from) + 8)) && open > (eol < 0 ? text.length : eol))) {
          body = text.slice(from, eol < 0 ? text.length : eol); // expression-bodied arrow
        } else body = blockAt(text, open);
        if (!map.has(name)) map.set(name, []);
        map.get(name).push({ rel, body });
      }
    }
  }
  defIndex.set(group, map);
  return map;
}

/* ─────────────────────────── outward markers ─────────────────────────── */

/** Message-type name classes that leave the machine (filing, chat, trackers, mail, AI providers). A rule on names, not a list of ids. */
export const OUT_MSG = /\bUQA_(?:JIRA|TRACKER|NOTIFY|MM|MATTERMOST|SLACK|TEAMS|TELEGRAM|EMAIL|MAIL|SEND|SHARE|PUBLISH|WEBHOOK|LLM|OPENROUTER)[A-Z0-9_]*\b/;
const OUT_OTHER = [
  [/mailto:/, 'mailto:'], [/\.eml\b/, '.eml file'], [/\bsendBeacon\b/, 'sendBeacon'], [/new\s+WebSocket\b/, 'WebSocket'],
  [/\bfetch\(\s*['"`]https?:\/\/(?!127\.0\.0\.1|localhost|\[::1\])/, 'fetch to a non-loopback URL'],
];
/** Functions (by name) whose own body makes a network call to something that is not the extension's own file. Derived from the source, per surface. */
const NET_CALL = /\bfetch\(\s*(?!chrome\.runtime\.getURL|['"`](?:\.|\/|chrome-extension))|\bXMLHttpRequest\b|\bsendBeacon\b/;
const netIndex = new Map();
function netFnsOf(group) {
  if (netIndex.has(group)) return netIndex.get(group);
  const set = new Map();
  for (const [name, list] of defsOf(group)) for (const d of list) if (NET_CALL.test(d.body) && d.body.length < 6000) { set.set(name, d.rel); break; }
  netIndex.set(group, set);
  return set;
}
const primaryDirs = (group) => (group === 'sidepanel' ? ['sidepanel', 'popup'] : group === 'float' ? ['popup'] : [(GROUP_DIRS[group] || GROUP_DIRS.popup)[0]]);
const outwardMarker = (txt) => {
  const m = OUT_MSG.exec(txt); if (m) return m[0];
  for (const [re, w] of OUT_OTHER) if (re.test(txt)) return w;
  return null;
};
/** Call names that say the call posts, publishes, uploads or notifies someone else (postSummary, sendReport, publishIssue ...). Local look-alikes are excluded. */
const OUT_FN = /^(?:post|send|publish|upload|notify)[A-Z]\w*$/;
const OUT_FN_LOCAL = /^(?:postMessage|sendMessage|sendResponse|sendToWorker|sendToTab|sendMsg|postToWorker)$/;
const LABEL_OUTWARD = /^(send|file)\b|\bmail\b|\.eml|e-?mail (this|the|report|me)/i;

/* ─────────────────────────── handler discovery ─────────────────────────── */

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokensOf = (c) => [...new Set([c.id, ...(c.tokens || [])].filter((t) => t && /^[\w:.\-]{2,48}$/.test(t)))];

/** Text windows that handle token `T` in this surface's source: bindings (addEventListener/onclick) and dispatch (=== 'T', case 'T', 'T': ). */
function sitesFor(T, group) {
  const re = new RegExp(`(?:['"\`]|#|\\[data-[\\w-]+=['"]?)${esc(T)}(?![\\w-])`, 'g');
  const out = [];
  for (const { rel, text } of filesOf(group)) {
    if (!text.includes(T)) continue;
    re.lastIndex = 0;
    for (let m; (m = re.exec(text));) {
      const at = m.index;
      if (/(?:\bid|\bdata-[\w-]+|\bname|\bfor)=\?$/.test(text.slice(Math.max(0, at - 24), at))) continue; // markup that defines the token
      const afterTok = at + m[0].length;
      let lineEnd = text.indexOf('\n', at); if (lineEnd < 0) lineEnd = text.length;
      const lineStart = text.lastIndexOf('\n', at) + 1;
      const beforeLine = text.slice(lineStart, at).trimEnd();
      const nearTail = text.slice(afterTok, Math.min(text.length, afterTok + 260));
      const lineRest = text.slice(afterTok, lineEnd);
      let kind = null, from = afterTok;
      const bind = /^[\s\S]{0,160}?(?:\.addEventListener\(\s*['"](?:click|change|input|submit|keydown|keyup|pointerdown|mousedown)['"]\s*,\s*|\.on(?:click|change|input|submit)\s*=\s*)/.exec(nearTail);
      if (bind && (bind[0].match(/\n/g) || []).length <= 2 && !/;\s*\n/.test(bind[0])) { kind = 'bind'; from = afterTok + bind[0].length; }
      else if (/(?:===?|!==?)$/.test(beforeLine) || /\bcase$/.test(beforeLine) || /^\s*:/.test(lineRest)) kind = 'dispatch';
      else if (T.startsWith('.') && /(?:closest|matches|querySelector(?:All)?)\(\s*$/.test(beforeLine)) kind = 'use'; // a class a delegated listener or a loop looks for
      if (!kind) continue;
      let expr = text.slice(from, Math.min(text.length, from + 1200));
      if (/\bcase$/.test(beforeLine)) { const next = expr.search(/\bcase\b|\bdefault\s*:/); if (next > 0) expr = expr.slice(0, Math.min(next, 1500)); }
      const brace = expr.search(/\{/);
      const body = brace >= 0 && brace < 220 ? expr.slice(0, brace) + blockAt(text, from + brace, 12000) : expr.slice(0, 380);
      out.push({ rel, kind, text: body, head: expr.slice(0, 60) });
    }
  }
  return out;
}

const CALLEE = /(?:^|[^\w$.])(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)\s*\(/g;
const callNames = (txt) => { const s = new Set(); CALLEE.lastIndex = 0; for (let m; (m = CALLEE.exec(txt));) if (!KEYWORDS.has(m[1]) && m[1].length > 2) s.add(m[1]); const ref = /(?:addEventListener\(\s*['"]\w+['"]\s*,\s*|\.on\w+\s*=\s*)([A-Za-z_$][\w$]*)\s*[,);]/g; for (let m; (m = ref.exec(txt));) s.add(m[1]); return s; };

/** Follow calls from `txt` through the surface's own functions; stop at depth/size caps. Returns the first outward marker with its chain. */
function reach(txt, group, chain, depth, seen, budget) {
  const hit = outwardMarker(txt);
  if (hit) return { marker: hit, chain };
  if (depth <= 0) return null;
  const defs = defsOf(group), net = netFnsOf(group), prim = primaryDirs(group).map((d) => d + '/');
  for (const name of callNames(txt)) {
    if (OUT_FN.test(name) && !OUT_FN_LOCAL.test(name)) return { marker: `outward-named call ${name}()`, chain };
    if (seen.has(name) || budget.n <= 0) continue;
    if (net.has(name)) return { marker: `network call ${name}() (${net.get(name)})`, chain };
    const list = (defs.get(name) || []).filter((d) => prim.some((p) => d.rel.startsWith(p)));
    if (!list.length || list.length > 3) continue;
    seen.add(name);
    for (const d of list) {
      budget.n--;
      const r = reach(d.body, group, [...chain, `${name} (${d.rel})`], depth - 1, seen, budget);
      if (r) return r;
    }
  }
  return null;
}

/* ─────────────────────────── classifier ─────────────────────────── */

let safeCache = null;
export function loadSafe() {
  if (safeCache) return safeCache;
  let j = { keys: {}, ids: {}, patterns: [] };
  try { j = { ...j, ...JSON.parse(fs.readFileSync(SAFE_FILE, 'utf8')) }; } catch { /* absent = nothing listed */ }
  safeCache = { keys: j.keys || {}, ids: j.ids || {}, patterns: (j.patterns || []).map((p) => ({ ...p, re: new RegExp(p.re) })) };
  return safeCache;
}
export const normKey = (key) => String(key).replace(/\d+/g, '#');
export const listedWhy = (group, c) => {
  const s = loadSafe();
  if (c.id && s.ids[c.id]) return s.ids[c.id];
  const k = normKey(c.key);
  if ((s.keys[group] || []).includes(k) || (s.keys['*'] || []).includes(k)) return `listed in sweep-safe.json (${group})`;
  const p = s.patterns.find((x) => x.re.test(`${group} :: ${c.key}`));
  return p ? p.why : null;
};

const NATIVE_LOCAL = /^(checkbox|radio|color|range|file|text|search|number|email|password|url|tel|date|time|datetime-local)$/;

/**
 * Put one control in one class before it is pressed.
 * @param c {{key:string,id:string,tag:string,type:string,role:string,label:string,href:string|null,formaction?:string,tokens?:string[]}}
 * @returns {{cls:'outward'|'href-only'|'local'|'listed'|'unclassified', why:string, rule:string}}
 */
export function classify(c, surface) {
  const group = groupOf(surface);
  // 1. the target scheme
  for (const h of [c.href, c.formaction]) {
    if (h == null || h === '') continue;
    const r = classifyHref(h);
    if (r.cls === 'outward') return { cls: 'outward', why: r.why, rule: 'href' };
    if (r.cls === 'href-only' && h === c.href) return { cls: 'href-only', why: r.why, rule: 'href' };
  }
  // 2. native value/fold controls change a value or a fold; sending needs a press on a button, so no handler is chased for them
  const native = c.tag === 'select' || c.tag === 'summary' || c.role === 'tab' || (c.tag === 'input' && NATIVE_LOCAL.test(c.type || 'text')) || c.role === 'switch' || c.role === 'checkbox' || c.role === 'radio';
  if (native) return { cls: 'local', why: `native ${c.tag}${c.type ? '[' + c.type + ']' : ''}${c.role ? ' role=' + c.role : ''}`, rule: 'native' };
  // 2b. a label (or the text span inside one) presses the native control it wraps; the control itself is judged on its own row
  if (c.tag === 'label' || (c.inLabel && !['button', 'a', 'summary'].includes(c.tag))) return { cls: 'local', why: 'label wrapper of a native control', rule: 'native' };
  // 3. the handler it reaches
  let resolved = false, via = '';
  for (const T of tokensOf(c)) {
    for (const site of sitesFor(T, group)) {
      resolved = true; via = via || `${site.kind} '${T}' in ${site.rel}`;
      const r = reach(site.text, group, [`${site.kind} '${T}' (${site.rel})`], 3, new Set(), { n: 40 });
      if (r) return { cls: 'outward', why: `reaches ${r.marker} via ${r.chain.join(' > ')}`, rule: 'handler' };
    }
  }
  // 3b. delegated tables: one listener on the document reads data-action / data-act and calls the entry named after it
  //     (popup.js: `mask: async ({ btn }) => {...}`), so the control has no binding of its own; the entry of that name is its handler
  for (const T of tokensOf(c)) {
    if (T.startsWith('.') || T === c.id) continue;
    const prim = primaryDirs(group).map((d) => d + '/');
    const defs = (defsOf(group).get(T) || []).filter((d) => prim.some((p) => d.rel.startsWith(p)));
    if (!defs.length || defs.length > 3) continue;
    for (const d of defs) {
      resolved = true; via = via || `table entry '${T}' in ${d.rel}`;
      const r = reach(d.body, group, [`table entry '${T}' (${d.rel})`], 3, new Set(), { n: 40 });
      if (r) return { cls: 'outward', why: `reaches ${r.marker} via ${r.chain.join(' > ')}`, rule: 'handler' };
    }
  }
  if (c.tag === 'button' && c.role !== 'tab' && LABEL_OUTWARD.test(c.label || '')) return { cls: 'outward', why: 'label says send/file/mail', rule: 'label' };
  if (resolved) return { cls: 'local', why: `handler read: ${via}`, rule: 'handler' };
  if (c.tag === 'a' && c.href != null && classifyHref(c.href).cls === 'local') return { cls: 'local', why: 'local link', rule: 'href' };
  // 4. the list
  const why = listedWhy(group, c);
  if (why) return { cls: 'listed', why, rule: 'list' };
  return { cls: 'unclassified', why: 'no handler found in the source and not on sweep-safe.json', rule: 'none' };
}

/* ─────────────────────────── in-page instrument ─────────────────────────── */

/**
 * Serialised into every page by context.addInitScript, so it must be self-contained.
 * Records what a press leaves behind AND replaces (does not forward) what could close a harness page or reach outside.
 */
export function sweepInstrument() {
  if (window.__fx) return;
  const fx = (window.__fx = { log: [], pending: 0, blocked: [] });
  const note = (k) => { try { fx.log.push(k); } catch { /* */ } };
  const local = (u) => {
    try {
      const x = new URL(String(u), location.href);
      if (/^(chrome-extension|blob|data):$/.test(x.protocol) || (x.protocol === 'about:' && /^(blank|srcdoc)$/.test(x.pathname))) return true;
      return /^https?:$/.test(x.protocol) && /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(x.hostname);
    } catch { return false; }
  };
  const urlsIn = (a) => { const o = []; for (const x of a) { if (typeof x === 'string') o.push(x); else if (x && typeof x === 'object') { if (typeof x.url === 'string') o.push(x.url); if (Array.isArray(x.url)) o.push(...x.url); } } return o; };
  /** mode: 'log' = record and forward; 'never' = record, never forward; 'url' = forward only when every URL argument is local. */
  const wrap = (obj, name, label, mode = 'log', stub) => {
    try {
      const orig = obj?.[name];
      if (typeof orig !== 'function') return;
      obj[name] = function (...a) {
        note(label);
        let block = mode === 'never';
        if (mode === 'url') { const u = urlsIn(a); block = u.some((x) => !local(x)); }
        if (block) {
          fx.blocked.push(label + (mode === 'url' ? ':' + urlsIn(a).join(',').slice(0, 60) : ''));
          const cb = typeof a[a.length - 1] === 'function' ? a[a.length - 1] : null;
          const val = typeof stub === 'function' ? stub() : stub;
          if (cb) { setTimeout(() => { try { cb(val); } catch { /* */ } }, 0); return undefined; }
          return stub === undefined && label.startsWith('window.') ? undefined : Promise.resolve(val);
        }
        return orig.apply(this, a);
      };
    } catch { /* */ }
  };
  const track = (obj, name, label) => {
    try {
      const orig = obj?.[name];
      if (typeof orig !== 'function') return;
      obj[name] = function (...a) {
        note(label); fx.pending++;
        const done = () => { fx.pending = Math.max(0, fx.pending - 1); };
        try { const r = orig.apply(this, a); if (r && typeof r.then === 'function') r.then(done, done); else done(); return r; } catch (e) { done(); throw e; }
      };
    } catch { /* */ }
  };
  try {
    const rt = chrome.runtime;
    const send = rt.sendMessage.bind(rt);
    rt.sendMessage = function (...a) {
      const m = a.find((x) => x && typeof x === 'object' && x.type);
      note('msg:' + (m?.type || '?'));
      fx.pending++;
      const done = () => { fx.pending = Math.max(0, fx.pending - 1); };
      const cb = typeof a[a.length - 1] === 'function' ? a.pop() : null;
      if (cb) { a.push((res) => { done(); if (res && res.ok === false) note('reply-error:' + (m?.type || '?') + ':' + String(res.error || '').slice(0, 60)); return cb(res); }); return send(...a); }
      const r = send(...a);
      if (r && typeof r.then === 'function') r.then(done, done); else done();
      return r;
    };
  } catch { /* */ }
  try {
    wrap(chrome.tabs, 'create', 'api:tabs.create', 'url', { id: -1 }); wrap(chrome.tabs, 'update', 'api:tabs.update', 'url', { id: -1 }); wrap(chrome.tabs, 'remove', 'api:tabs.remove', 'never', undefined);
    wrap(chrome.windows, 'create', 'api:windows.create', 'url', { id: -1 }); wrap(chrome.windows, 'update', 'api:windows.update', 'url', { id: -1 }); wrap(chrome.windows, 'remove', 'api:windows.remove', 'never', undefined);
    wrap(chrome.downloads, 'download', 'api:downloads.download', 'url', -1); wrap(chrome.sidePanel, 'open', 'api:sidePanel.open'); wrap(chrome.runtime, 'openOptionsPage', 'api:openOptionsPage');
    wrap(chrome.runtime, 'reload', 'api:runtime.reload', 'never', undefined);
  } catch { /* */ }
  try { for (const a of ['local', 'sync', 'session']) wrap(chrome.storage[a], 'set', 'storage.' + a + '.set'); } catch { /* */ }
  wrap(window, 'open', 'window.open', 'url', null); wrap(window, 'print', 'window.print'); wrap(window, 'close', 'window.close', 'never', undefined);
  wrap(navigator, 'sendBeacon', 'sendBeacon', 'url', true);
  wrap(navigator.clipboard, 'writeText', 'clipboard.write'); wrap(navigator.clipboard, 'write', 'clipboard.write');
  wrap(document, 'execCommand', 'execCommand'); wrap(URL, 'createObjectURL', 'createObjectURL');
  wrap(window, 'showSaveFilePicker', 'savePicker'); wrap(window, 'showDirectoryPicker', 'dirPicker');
  track(window, 'fetch', 'fetch'); wrap(HTMLDialogElement.prototype, 'showModal', 'dialog.showModal'); wrap(HTMLDialogElement.prototype, 'show', 'dialog.show');
  wrap(HTMLElement.prototype, 'requestFullscreen', 'fullscreen'); wrap(Element.prototype, 'scrollIntoView', 'scrollIntoView');
  wrap(window, 'scrollTo', 'scrollTo'); wrap(HTMLElement.prototype, 'showPopover', 'popover');
  addEventListener('beforeunload', () => note('unload'));
}

/**
 * The guard alone, for scripted walks (clickthrough.mjs) that must not close their own pages or reach outside, and must not
 * change their effects log. Same replace-not-tap rules as above.
 */
export function sweepGuard() {
  if (window.__qawGuard) return;
  window.__qawGuard = true;
  const local = (u) => {
    try {
      const x = new URL(String(u), location.href);
      if (/^(chrome-extension|blob|data):$/.test(x.protocol) || (x.protocol === 'about:' && /^(blank|srcdoc)$/.test(x.pathname))) return true;
      return /^https?:$/.test(x.protocol) && /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(x.hostname);
    } catch { return false; }
  };
  const urlsIn = (a) => { const o = []; for (const x of a) { if (typeof x === 'string') o.push(x); else if (x && typeof x === 'object') { if (typeof x.url === 'string') o.push(x.url); if (Array.isArray(x.url)) o.push(...x.url); } } return o; };
  const guard = (obj, name, mode, stub) => {
    try {
      const orig = obj?.[name];
      if (typeof orig !== 'function') return;
      obj[name] = function (...a) {
        const block = mode === 'never' || (mode === 'url' && urlsIn(a).some((x) => !local(x)));
        if (!block) return orig.apply(this, a);
        (window.__qawBlocked ||= []).push(`${name}${mode === 'url' ? ':' + urlsIn(a).join(',').slice(0, 60) : ''}`);
        const cb = typeof a[a.length - 1] === 'function' ? a[a.length - 1] : null;
        if (cb) { setTimeout(() => { try { cb(stub); } catch { /* */ } }, 0); return undefined; }
        return name === 'open' || name === 'close' || name === 'sendBeacon' ? stub : Promise.resolve(stub);
      };
    } catch { /* */ }
  };
  try { guard(chrome.tabs, 'create', 'url', { id: -1 }); guard(chrome.tabs, 'update', 'url', { id: -1 }); guard(chrome.tabs, 'remove', 'never'); guard(chrome.windows, 'create', 'url', { id: -1 }); guard(chrome.windows, 'update', 'url', { id: -1 }); guard(chrome.windows, 'remove', 'never'); guard(chrome.downloads, 'download', 'url', -1); } catch { /* */ }
  guard(window, 'open', 'url', null); guard(window, 'close', 'never'); guard(navigator, 'sendBeacon', 'url', true);
}

/* ─────────────────────────── settle ─────────────────────────── */

/**
 * Wait until the page has been quiet: no DOM mutation and no pending runtime message or fetch for `quietMs`, at least `minMs`
 * after the call, at most `capMs`. Replaces the fixed per-control waits. Returns { ms, capped }.
 */
export async function quietSettle(frameOrPage, { minMs = 60, quietMs = 120, capMs = 500 } = {}) {
  try {
    return await frameOrPage.evaluate(({ minMs, quietMs, capMs }) => new Promise((res) => {
      const fx = window.__fx;
      const t0 = performance.now();
      let last = t0;
      const mo = new MutationObserver(() => { last = performance.now(); });
      mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      const iv = setInterval(() => {
        const now = performance.now();
        if ((fx?.pending || 0) > 0) last = now;
        const quiet = now - last >= quietMs;
        if ((now - t0 >= minMs && quiet) || now - t0 >= capMs) { clearInterval(iv); mo.disconnect(); res({ ms: Math.round(now - t0), capped: !quiet }); }
      }, 20);
    }), { minMs, quietMs, capMs });
  } catch { return { ms: 0, capped: false, gone: true }; }
}

/** One settle for both modes. fixed = the old behaviour (a flat wait of `fixedMs`); quiet = quietSettle. */
export async function settle(page, frame, mode, fixedMs, opts) {
  if (mode === 'fixed') { await page.waitForTimeout(fixedMs).catch(() => {}); return { ms: fixedMs }; }
  return quietSettle(frame || page, opts);
}

/* ─────────────────────────── chunks, state, results ─────────────────────────── */

/** Base controls given to one chunk. Reveals (what a press brings on screen) ride along, and the chunk stops at CHUNK_MAX presses. */
export const BASE_PER_CHUNK = 45;
/** [[from,to),...] slices of `n` base controls; every chunk stays within CHUNK_MAX presses once reveals are counted (overflow becomes follow-up chunks). */
export function planSlices(n, per = BASE_PER_CHUNK) { const out = []; for (let a = 0; a < n; a += per) out.push([a, Math.min(n, a + per)]); return out.length ? out : [[0, 0]]; }

/** ceil(n / size) chunks. */
export const chunkCount = (n, size = CHUNK_MAX) => Math.ceil(n / Math.min(size, CHUNK_MAX));
export const clampChunk = (n) => { const v = Number(n); return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), CHUNK_MAX) : CHUNK_MAX; };

export function saveState(file, state) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state)); }
export function loadState(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

/** Where the pipeline wants per-sweep results: <run dir>/sweeps/<label>.json, when QAW_RUN_DIR is set. Returns the path or null. */
export function writeRunResult(label, summary) {
  const dir = process.env.QAW_RUNDIR || process.env.QAW_RUN_DIR;
  if (!dir) return null;
  const f = path.join(dir, 'sweeps', `${label}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(summary, null, 1));
  return f;
}

export const workRoot = () => path.join(REPO, 'work', 'btn-1011');
