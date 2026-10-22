/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The test sandbox, as data and pure helpers (lane P3, 1012). The runner (P1) consumes this file; the
 * browser-side half is lib-sandbox-preload.mjs, loaded into every suite through NODE_OPTIONS=--import.
 *
 * Interface for P1 (lib-sched / lib-teardown / lib-report):
 *
 *   buildChildEnv({ runDir, suite, runId, imports, forceHeadless, sweep, engine, cftPath, allowLive })
 *       -> { env, dirs, nodeOptions }   the ONLY env a suite child gets (allow-list, redirected home, TEMP in the run dir,
 *                                       NODE_OPTIONS = [...imports, preload]); creates dirs.{tmp,profiles,downloads,home,observer}
 *   preloadUrl                          file URL of lib-sandbox-preload.mjs
 *   readObserver(runDir, suite)         -> entries of <runDir>/observer/<suite>.jsonl
 *   egressReport(entries, suite)        -> { verdict: 'PASS'|'FAIL', lines: ['FAIL EGRESS <suite> <url> (...)', 'STUBBED ...'], failures, stubbed, handoffs, warnings, preloaded }
 *   refusedLiveScript(file, {allowLive})-> null | reason string   (belt; P2's manifest flags are the primary exclusion, S6)
 *   findRunProcesses(runId)             -> [{pid, ppid, name, root}]  browsers this run launched (marker --qaw-run=<runId>)
 *   teardownRun({ runId, runDir })      -> { killed: [pid], left: [], notMine: [] }   taskkill /PID <pid> /T /F on those roots only
 *   guardSnapshot({ repoRoot, home })   -> { git, downloads: {count, newest} } ; guardDiff(before, after) -> [problem strings]
 *   scrub / leakScanDir                 re-exported from lib-scrub.mjs (S12)
 *
 * No kill by image name anywhere (S11): there is no taskkill /IM, Stop-Process -Name, pkill or killall in this file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
export { scrub, scrubTransform, leakScanDir, leakScan } from './lib-scrub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = path.resolve(HERE, '..');
export const REPO_DIR = path.resolve(EXT_DIR, '..');
export const preloadPath = path.join(HERE, 'lib-sandbox-preload.mjs');
export const preloadUrl = pathToFileURL(preloadPath).href;

/** S2: a dead-port proxy (127.0.0.1 and localhost bypass it implicitly), plus the browser's own background traffic off. */
export const EGRESS_FLAGS = [
  '--proxy-server=127.0.0.1:9',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-component-update',
  '--no-pings',
];

/** Schemes a protocol-handoff observer treats as in-browser. Anything else navigated to is a handoff attempt (S3). */
export const INERT_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'chrome-extension:', 'blob:', 'data:', 'about:', 'chrome:', 'devtools:', 'file:', 'javascript:', 'chrome-error:', 'chrome-untrusted:']);
/** The one scheme the sandbox tests may use to exercise the handoff path. Never mailto:, tel: or sms:. */
export const TEST_SCHEME = 'qaw-egress-test';
/** Seeded into each profile as "never hand to an external app" (belt; the pre-click classifier in P4 is the primary guard). */
export const EXCLUDED_SCHEMES = ['qaw-egress-test', 'mailto', 'tel', 'sms', 'callto', 'skype', 'ms-settings', 'ms-windows-store', 'search-ms', 'ms-msdt'];

/** S7 allow-list (R10): everything else, credentials and proxies included, is dropped from the child. */
export const ENV_ALLOW = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'LOCALAPPDATA', 'APPDATA', 'PYTHONUTF8', 'COMSPEC', 'PATHEXT',
  'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'ProgramW6432', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'SystemDrive',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'OS',
  'UQA_WINDOW', 'UQA_HEADLESS']; // the two harness knobs; NODE_OPTIONS, TEMP, TMP and the home vars are set below, never inherited
/** QAW_* passes through, except names that point at or hold credentials. */
const QAW_DENY = /(ENV|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CRED|AUTH)/i;

export const isLoopbackHost = (h) => h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';

/** 'loopback' | 'inert' | 'handoff' | 'external' for a URL string (what the observer logs). */
export function classifyUrl(u) {
  let x;
  try { x = new URL(u); } catch { return 'inert'; }
  if (x.protocol === 'http:' || x.protocol === 'https:' || x.protocol === 'ws:' || x.protocol === 'wss:') return isLoopbackHost(x.hostname) ? 'loopback' : 'external';
  return INERT_SCHEMES.has(x.protocol) ? 'inert' : 'handoff';
}

/** Network errors that mean "tried to leave and was stopped" (dead proxy, no route, refused). A suite's own route.abort is ERR_FAILED / ERR_ABORTED / ERR_BLOCKED_BY_CLIENT and is not one. */
export const isEgressError = (e) => /ERR_(PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED|NETWORK_CHANGED)/.test(String(e || ''));

/** Strip query and fragment (they can carry tokens) and cap the length; this is what reaches a log. */
export const safeUrl = (u) => {
  try { const x = new URL(u); return `${x.protocol}//${x.host}${x.pathname}`.slice(0, 160); } catch { return String(u).slice(0, 60).replace(/[?#].*$/, ''); }
};

/** The run's per-suite directories, created. */
export function suiteDirs(runDir, suite) {
  const safe = String(suite).replace(/[^A-Za-z0-9._-]/g, '_');
  const dirs = {
    tmp: path.join(runDir, 'tmp', safe),
    profiles: path.join(runDir, 'profiles', safe),
    downloads: path.join(runDir, 'downloads', safe),
    home: path.join(runDir, 'home', safe),
    observer: path.join(runDir, 'observer'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return dirs;
}

/**
 * S1/S2/S7/S8/S9 as one env object. `base` is the runner's env (default process.env).
 * The real trash.py path is computed here, before the home redirect, and passed as QAW_TRASH (R10).
 */
export function buildChildEnv({ runDir, suite, runId, base = process.env, imports = [], forceHeadless = false, sweep = false, engine, cftPath, allowLive = false, redirectHome = true } = {}) {
  if (!runDir || !suite) throw new Error('buildChildEnv: runDir and suite are required');
  const dirs = suiteDirs(runDir, suite);
  const env = {};
  for (const k of ENV_ALLOW) if (base[k] !== undefined) env[k] = base[k];
  for (const [k, v] of Object.entries(base)) if (/^QAW_/.test(k) && !QAW_DENY.test(k) && v !== undefined) env[k] = v;
  env.PYTHONUTF8 = '1';
  env.TEMP = dirs.tmp; env.TMP = dirs.tmp; env.TMPDIR = dirs.tmp;
  if (redirectHome) {
    env.USERPROFILE = dirs.home; env.HOME = dirs.home; env.HOMEDRIVE = dirs.home.slice(0, 2); env.HOMEPATH = dirs.home.slice(2);
    // Branded Chrome 136+ refuses --remote-debugging-pipe ("requires a non-default data directory") when it cannot resolve its own
    // default user-data dir under the redirected profile, even with a non-default --user-data-dir. An empty one there settles it.
    fs.mkdirSync(path.join(dirs.home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'), { recursive: true });
  }
  else if (base.USERPROFILE) env.USERPROFILE = base.USERPROFILE;
  if (base.QAW_TRASH) env.QAW_TRASH = base.QAW_TRASH; // optional recycle-bin helper; without it scratch is removed with fs.rmSync
  env.QAW_SANDBOX = '1';
  env.QAW_RUNDIR = runDir;
  env.QAW_RUNID = runId || path.basename(runDir);
  env.QAW_SUITE = suite;
  env.QAW_PROFILES = dirs.profiles;
  env.QAW_DOWNLOADS = dirs.downloads;
  if (forceHeadless) env.QAW_FORCE_HEADLESS = '1'; else delete env.QAW_FORCE_HEADLESS;
  if (sweep) env.QAW_SWEEP = '1'; else delete env.QAW_SWEEP;
  if (engine) env.QAW_ENGINE = engine;
  if (cftPath) env.QAW_CFT_PATH = cftPath;
  if (allowLive) env.QAW_ALLOW_LIVE = '1'; else delete env.QAW_ALLOW_LIVE;
  const nodeOptions = [...imports, preloadUrl].map((u) => `--import=${u}`).join(' ');
  env.NODE_OPTIONS = nodeOptions;
  return { env, dirs, nodeOptions };
}

/** The real home of this (runner) process, ignoring any redirect the runner itself inherited. */
export const realHome = (base = process.env) => base.QAW_REAL_HOME || os.homedir();

/** S6 belt. Exact tool names that need credentials or the live network; P2's manifest flags are the primary exclusion. */
const LIVE_BASENAMES = new Set(['jira-live.mjs', 'store-status.mjs', 'launch.mjs', 'release-record.mjs']);
/** null when the entry script may run in the sandbox, else the reason it is refused (exit 64 in the preload). */
export function refusedLiveScript(file, { allowLive = false } = {}) {
  if (allowLive || !file) return null;
  const norm = String(file).replace(/\\/g, '/');
  const base = path.posix.basename(norm);
  if (LIVE_BASENAMES.has(base)) return `${base} uses live credentials or the live network`;
  if (/\/tools\/film\//.test(norm)) return 'film/audio/voice tools call paid or live services';
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch { return null; }
  if (/\b(?:readFileSync|readFile|createReadStream|openSync)\s*\([^)]*\.config[^)]*qa-wrap/.test(src)) return 'reads a credential file under ~/.config/qa-wrap';
  return null;
}

/** True when a path points at the owner's credential folder; the preload throws on reads of it. */
export const isCredentialPath = (p) => /[\\/]\.config[\\/]qa-wrap([\\/]|$)/i.test(String(p));

/* ---------------------------------------------------------------- observer ---- */

export function readObserver(runDir, suite) {
  const safe = String(suite).replace(/[^A-Za-z0-9._-]/g, '_');
  const f = path.join(runDir, 'observer', `${safe}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * Spec S2 with the R1 correction: a stubbed request (route.fulfill) ends `finished` and is only logged STUBBED;
 * egress = a non-loopback request that failed with a proxy-class error or was answered by a non-loopback server.
 * An unresolved one at exit is a warning (the dead proxy means it never left the machine).
 */
export function egressReport(entries, suite = '?') {
  const lines = [], failures = [], stubbed = [], handoffs = [], warnings = [];
  const byId = new Map();
  for (const e of entries) if (e.kind === 'request' && e.cls === 'external') byId.set(e.id, { url: e.url, sw: !!e.sw, end: null });
  for (const e of entries) {
    if (e.kind === 'failed' && e.cls === 'external') {
      const r = byId.get(e.id) || { url: e.url, sw: false }; r.end = 'failed';
      if (isEgressError(e.err)) failures.push({ url: e.url, why: `${e.err}${r.sw ? ', from the extension worker' : ''}` });
      else r.end = 'aborted';
    } else if (e.kind === 'finished' && e.cls === 'external') { const r = byId.get(e.id); if (r) r.end = 'finished'; }
    else if (e.kind === 'response' && e.cls === 'external' && e.ip && !/^(127\.|::1$|\[::1\]$)/.test(e.ip)) failures.push({ url: e.url, why: `answered by ${e.ip}` });
    else if (e.kind === 'handoff') handoffs.push({ url: e.url, scheme: e.scheme });
  }
  for (const r of byId.values()) {
    if (r.end === 'finished') stubbed.push(r.url);
    else if (r.end === null) warnings.push(`unresolved at exit: ${r.url}`);
  }
  for (const f of failures) lines.push(`FAIL EGRESS ${suite} ${f.url} (${f.why})`);
  for (const u of stubbed) lines.push(`STUBBED ${suite} ${u}`);
  for (const sch of new Set(handoffs.map((h) => h.scheme))) lines.push(`HANDOFF-BLOCKED ${suite} ${sch}`);
  for (const w of warnings) lines.push(`WARN ${suite} ${w}`);
  return { verdict: failures.length ? 'FAIL' : 'PASS', lines, failures, stubbed, handoffs, warnings, preloaded: entries.some((e) => e.kind === 'preload') };
}

/* ---------------------------------------------------------------- sweep guard ---- */

/**
 * S4 (sweep mode): source of an init script that stops a page or extension context from closing, redirecting or
 * downloading anything outside the harness. Calls are recorded in globalThis.__qawSweepLog and as console.debug
 * "QAW-SWEEP {json}" (the preload turns those into observer entries); not forwarded: window.close, tabs.remove,
 * windows.remove; forwarded only to loopback / chrome-extension / blob / data targets: window.open, sendBeacon,
 * tabs.create/update, windows.create, downloads.download. location.assign/replace are unforgeable in Chromium and are
 * left to the dead proxy.
 */
export function sweepGuardSource() {
  return `(() => {
  if (globalThis.__qawGuard) return; globalThis.__qawGuard = true;
  const OK = /^(?:https?:\\/\\/(?:127\\.0\\.0\\.1|localhost|\\[::1\\])(?:[:\\/?#]|$)|chrome-extension:|blob:|data:|about:blank|javascript:void)/i;
  const okUrl = (u) => u == null || u === '' || OK.test(String(u)) || (typeof u === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(u));
  const log = (api, url) => { try { (globalThis.__qawSweepLog ||= []).push({ api, url: String(url ?? '').replace(/[?#].*$/, '').slice(0, 120) }); console.debug('QAW-SWEEP ' + JSON.stringify({ api, url: String(url ?? '').replace(/[?#].*$/, '').slice(0, 120) })); } catch {} };
  const swallow = (args, value) => { const cb = args[args.length - 1]; if (typeof cb === 'function') { setTimeout(() => { try { cb(value); } catch {} }, 0); return undefined; } return Promise.resolve(value); };
  const never = (obj, name, api) => { if (obj && typeof obj[name] === 'function') { try { obj[name] = function (...a) { log(api, ''); return swallow(a, undefined); }; } catch {} } };
  const urlGuard = (obj, name, api, pick) => {
    if (!obj || typeof obj[name] !== 'function') return; const orig = obj[name].bind(obj);
    try { obj[name] = function (...a) { const u = pick(a); if (okUrl(u)) return orig(...a); log(api, u); return swallow(a, undefined); }; } catch {}
  };
  try { window.close = () => { log('window.close', ''); }; } catch {}
  try { const o = window.open.bind(window); window.open = (u, ...r) => { if (okUrl(u)) return o(u, ...r); log('window.open', u); return null; }; } catch {}
  try { const b = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (u, d) => { if (okUrl(u)) return b(u, d); log('sendBeacon', u); return true; }; } catch {}
  const c = globalThis.chrome; if (!c) return;
  never(c.tabs, 'remove', 'tabs.remove'); never(c.windows, 'remove', 'windows.remove');
  urlGuard(c.tabs, 'create', 'tabs.create', (a) => a[0] && a[0].url);
  urlGuard(c.tabs, 'update', 'tabs.update', (a) => (typeof a[0] === 'object' && a[0] ? a[0].url : a[1] && a[1].url));
  urlGuard(c.windows, 'create', 'windows.create', (a) => { const u = a[0] && a[0].url; return Array.isArray(u) ? (u.find((x) => !okUrl(x)) ?? '') : u; });
  urlGuard(c.downloads, 'download', 'downloads.download', (a) => a[0] && a[0].url);
})()`;
}

/* ---------------------------------------------------------------- teardown (S11) ---- */

function cim(filter) {
  const ps = `Get-CimInstance Win32_Process -Filter "${filter}" | % { '{0}|{1}|{2}|{3}' -f $_.ProcessId,$_.ParentProcessId,$_.Name,$_.CommandLine }`;
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
  return out.split(/\r?\n/).filter(Boolean).map((l) => { const [pid, ppid, name, ...cmd] = l.split('|'); return { pid: +pid, ppid: +ppid, name, cmd: cmd.join('|') }; });
}

/** Browsers this run launched: the preload adds --qaw-run=<runId> to every launch. `root` = the browser process (no --type=). */
export function findRunProcesses(runId) {
  if (process.platform !== 'win32' || !runId) return [];
  const safe = String(runId).replace(/[^A-Za-z0-9._-]/g, '');
  return cim(`CommandLine like '%--qaw-run=${safe}%'`).filter((p) => p.pid !== process.pid).map((p) => ({ pid: p.pid, ppid: p.ppid, name: p.name, root: !/--type=/.test(p.cmd) }));
}

/**
 * Kill what this run started, by pid, tree only: `taskkill /PID <pid> /T /F` on the root browser processes carrying this
 * run's marker. Never by name. Anything else seen is reported and left alone.
 */
export function teardownRun({ runId, runDir } = {}) {
  const res = { killed: [], left: [], notMine: [] };
  const mine = findRunProcesses(runId);
  for (const p of mine.filter((x) => x.root)) {
    const r = spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    if (r.status === 0) res.killed.push(p.pid);
  }
  const after = findRunProcesses(runId);
  for (const p of after) res.left.push(p.pid);
  void runDir;
  return res;
}

/* ---------------------------------------------------------------- S8 snapshots ---- */

function downloadsOf(home) {
  const d = path.join(home, 'Downloads');
  try {
    const names = fs.readdirSync(d);
    let newest = 0;
    for (const n of names) { try { newest = Math.max(newest, fs.statSync(path.join(d, n)).mtimeMs); } catch { /* raced */ } }
    return { count: names.length, newest };
  } catch { return { count: 0, newest: 0 }; }
}

/** Repo porcelain status plus the real Downloads count and newest mtime (listing only; nothing is read or written). */
export function guardSnapshot({ repoRoot = REPO_DIR, home = realHome() } = {}) {
  let git = '';
  try { git = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }); } catch { git = '(git status unavailable)'; }
  return { git, downloads: downloadsOf(home) };
}

/** Problems between two snapshots; [] when nothing outside the run dir changed. `ignore` lists porcelain path prefixes allowed to change. */
export function guardDiff(before, after, { ignore = [] } = {}) {
  const out = [];
  const set = (s) => new Set(s.split('\n').filter(Boolean));
  const b = set(before.git), a = set(after.git);
  for (const l of a) if (!b.has(l) && !ignore.some((p) => l.slice(3).replace(/\\/g, '/').startsWith(p))) out.push(`unexpected write: ${l}`);
  if (after.downloads.count !== before.downloads.count || after.downloads.newest !== before.downloads.newest) out.push(`real Downloads changed: count ${before.downloads.count}->${after.downloads.count}`);
  return out;
}

/* ---------------------------------------------------------------- lint helpers (S1, S8, S9) ---- */

/** Browser-start routes the preload cannot see (it patches Playwright's chromium only): file:line of each in a source text. */
export const RAW_LAUNCH = /connectOverCDP|puppeteer|\b(?:firefox|webkit)\.launch|_electron|openExternal|\bspawn(?:Sync)?\(\s*['"`][^'"`]*(?:chrome|msedge|chromium)|\b(?:exec|execSync)\(\s*['"`]\s*(?:start|explorer|chrome|msedge)\b/;
export function findRawLaunches(dir, { allow = {} } = {}) {
  const found = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/\.mjs$/.test(f) || /^(?:lib-sandbox|test-sandbox)/.test(f) || allow[f]) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    src.forEach((l, i) => { if (!/^\s*(?:\/\/|\*|\/\*)/.test(l) && RAW_LAUNCH.test(l)) found.push({ file: f, line: i + 1, text: l.trim().slice(0, 100) }); });
  }
  return found;
}
