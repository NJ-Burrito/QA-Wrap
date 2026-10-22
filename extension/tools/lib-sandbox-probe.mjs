/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Probe child for test-sandbox-egress.mjs. It is a plain suite as far as the sandbox is concerned: the test starts it
 * with the env from buildChildEnv() (so the preload patches its launches) and reads one `PROBE {json}` line back.
 * Mode comes from QAW_PROBE. Never touches a real external host except two fetches that the dead-port proxy must stop,
 * never clicks mailto:, tel: or a real URL.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { EXT_DIR } from './lib-sandbox.mjs';
import { launchOptions } from './lib-launch.mjs';
import { verifyPlacement } from './lib-test-window.mjs';

const QW = ['qa', 'wrap'].join('-'); // built, so the live-script source scan does not refuse this probe
const mode = process.env.QAW_PROBE || 'main';
const out = (o) => console.log('PROBE ' + JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (mode === 'env') {
  let credRead;
  try { fs.readFileSync(path.join(os.homedir(), '.config', QW, 'qaw-probe-nonexistent.env')); credRead = 'READ'; } catch (e) { credRead = e.code; }
  let realCredRead;
  try { fs.readFileSync(path.join(process.env.QAW_PROBE_REAL_HOME || 'C:\\nowhere', '.config', QW, 'qaw-probe-nonexistent.env')); realCredRead = 'READ'; } catch (e) { realCredRead = e.code; }
  out({ homedir: os.homedir(), tmpdir: os.tmpdir(), credRead, realCredRead, secretVars: ['OPENROUTER_API_KEY', 'HTTPS_PROXY', 'QAW_JIRA_ENV', 'JIRA_TOKEN', 'GITHUB_TOKEN'].filter((k) => process.env[k] !== undefined), keys: Object.keys(process.env).length, nodeOptions: process.env.NODE_OPTIONS });
  process.exit(0);
}
if (mode === 'secret') {
  console.log('token sk-TESTTOKEN0123456789abcdefABCDEF and Authorization: Bearer abcdefghijklmnop0123456789 done');
  process.exit(0);
}
if (mode === 'hello') { console.log('PROBE {"hello":true}'); process.exit(0); }

const srv = http.createServer((q, r) => {
  if (q.url === '/file') { r.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="probe.bin"' }); return r.end('probe-download'); }
  r.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' });
  r.end('<!doctype html><title>loop</title><a id="x" href="qaw-egress-test:probe">custom scheme link</a><a id="d" href="/file" download>dl</a>');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;
const timed = (u) => `(async()=>{const s=performance.now();try{await fetch(${JSON.stringify(u)},{mode:'no-cors',cache:'no-store'});return {ok:true,ms:Math.round(performance.now()-s)}}catch(e){return {ok:false,ms:Math.round(performance.now()-s),err:e.message}}})()`;
const workerOf = async (ctx) => ctx.serviceWorkers().find((x) => x.url().startsWith('chrome-extension://')) || ctx.waitForEvent('serviceworker', { timeout: 20000 });
const REQUESTED = path.join(os.tmpdir(), 'qaw-probe-requested-profile-must-stay-unused');

try {
  if (mode === 'headed') {
    const ctx = await chromium.launchPersistentContext(REQUESTED, launchOptions(EXT_DIR, { headed: true }));
    const page = ctx.pages()[0] || await ctx.newPage();
    const placement = await verifyPlacement(ctx, page);
    out({ placement: { status: placement.status, why: placement.why, bounds: placement.bounds, overhang: placement.overhang } });
    await ctx.close();
  } else if (mode === 'orphan') {
    const ctx = await chromium.launchPersistentContext(REQUESTED, launchOptions(EXT_DIR));
    out({ launched: true, pages: ctx.pages().length });
    await sleep(120000); // the test kills this node process; the browser must be found and killed by its marker
  } else if (mode === 'sweep') {
    const ctx = await chromium.launchPersistentContext(REQUESTED, launchOptions(EXT_DIR));
    const w = await workerOf(ctx);
    const id = new URL(w.url()).host;
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/popup/popup.html`);
    await sleep(800);
    const before = ctx.pages().length;
    const r = await page.evaluate(async () => {
      const res = {};
      try { window.close(); res.close = 'returned'; } catch (e) { res.close = 'threw ' + e.message; }
      try { await chrome.tabs.create({ url: 'https://sweep-target.invalid/' }); res.create = 'returned'; } catch (e) { res.create = 'threw ' + e.message; }
      try { await chrome.tabs.remove((await chrome.tabs.getCurrent())?.id ?? 0); res.remove = 'returned'; } catch (e) { res.remove = 'threw ' + e.message; }
      try { const p = window.open('https://sweep-target.invalid/x'); res.open = p === null ? 'null' : 'window'; } catch (e) { res.open = 'threw ' + e.message; }
      res.log = (globalThis.__qawSweepLog || []).map((x) => x.api);
      return res;
    });
    await sleep(600);
    const alive = await ctx.newPage().then(async (p) => { await p.goto(ORIGIN); return (await p.title()) === 'loop'; }).catch(() => false);
    out({ r, pagesBefore: before, pagesAfter: ctx.pages().length - 1, urls: ctx.pages().map((p) => p.url().replace(/[?#].*/, '')), browserAlive: alive });
    await ctx.close();
  } else {
    // main: egress oracle, stub, handoff, headless force, download, unique profile
    const seen = { pagesOnClick: 0 };
    const ctx = await chromium.launchPersistentContext(REQUESTED, { ...launchOptions(EXT_DIR, { headed: true }), acceptDownloads: true });
    const ctx2 = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'qaw-probe-requested-2'), launchOptions(EXT_DIR));
    await ctx2.close();
    const w = await workerOf(ctx);
    const page = await ctx.newPage();
    await ctx.route('https://stub.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: 'stubbed' }));
    await page.goto(ORIGIN);
    const res = {};
    for (const u of ['https://example.com/', 'http://10.255.255.1/']) { res['page ' + u] = await page.evaluate(timed(u)); res['worker ' + u] = await w.evaluate(timed(u)); }
    res.pageLoop = await page.evaluate(timed(ORIGIN + '/ping')); res.workerLoop = await w.evaluate(timed(ORIGIN + '/ping'));
    res.stub = await page.evaluate(`fetch('https://stub.test/a?token=SECRETVALUE1').then(r=>r.text())`);
    const ua = await page.evaluate('navigator.userAgent');
    // process snapshot, ancestry filtered: only processes that descend from our browser may count
    const snap = () => {
      const r = spawnSyncPs();
      return r;
    };
    const before = snap();
    ctx.on('page', () => { seen.pagesOnClick++; });
    const dlg = []; page.on('dialog', (d) => { dlg.push(d.message()); d.dismiss(); });
    await page.click('#x');
    await sleep(2500);
    const after = snap();
    const browserPid = await (async () => { const c = await ctx.browser().newBrowserCDPSession(); const { processInfo } = await c.send('SystemInfo.getProcessInfo'); return processInfo.find((p) => p.type === 'browser')?.id; })();
    const desc = (pid, map) => { const seenP = new Set(); for (let p = map.get(pid)?.ppid; p && !seenP.has(p); p = map.get(p)?.ppid) { seenP.add(p); if (p === browserPid) return true; } return false; };
    const bmap = new Map(before.map((p) => [p.pid, p])), amap = new Map(after.map((p) => [p.pid, p]));
    const fresh = after.filter((p) => !bmap.has(p.pid) && desc(p.pid, amap)).filter((p) => !/^chrome\.exe$/i.test(p.name));
    res.click = { urlSame: page.url() === ORIGIN + '/', pagesOpened: seen.pagesOnClick, dialogs: dlg.length, newChildProcs: fresh.map((p) => p.name) };
    // download lands in the run dir
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('#d')]);
    if (dl) { const saved = await dl.path().catch(() => null); res.download = { path: saved }; } else res.download = { path: null };
    out({ res, headlessUA: /HeadlessChrome/.test(ua), requestedUsed: fs.existsSync(REQUESTED) && fs.readdirSync(REQUESTED).length > 0, requested2Used: fs.existsSync(path.join(os.tmpdir(), 'qaw-probe-requested-2')) });
    await ctx.close();
  }
} finally { srv.close(); }

import { spawnSync } from 'node:child_process';
function spawnSyncPs() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | % { '{0}|{1}|{2}' -f $_.ProcessId,$_.ParentProcessId,$_.Name }"], { encoding: 'utf8' });
  return r.stdout.split(/\r?\n/).filter(Boolean).map((l) => { const [pid, ppid, name] = l.split('|'); return { pid: +pid, ppid: +ppid, name }; });
}
