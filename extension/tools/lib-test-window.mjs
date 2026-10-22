/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Where a headed test window opens: the SECONDARY monitor, never the main one
 * (owner rule, 9 Oct 2026, fix-1009). One monitor attached, or not on Windows:
 * the old placement is kept and a visible note is printed once.
 *
 *   UQA_WINDOW=x,y   still wins (absolute screen coordinates)
 *
 * Layout comes from System.Windows.Forms.Screen.AllScreens, read once per process.
 */
import { execFileSync } from 'node:child_process';

const PS = `Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | % { '{0}|{1}|{2},{3},{4},{5}' -f $_.DeviceName,$_.Primary,$_.Bounds.X,$_.Bounds.Y,$_.Bounds.Width,$_.Bounds.Height }`;

let cache;
/** [{name, primary, x, y, w, h}] — [] when it cannot be read. */
export function monitors() {
  if (cache) return cache;
  cache = [];
  if (process.platform !== 'win32') return cache;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS, 'utf16le').toString('base64')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of out.split(/\r?\n/).filter(Boolean)) {
      const [name, primary, b] = line.split('|');
      const [x, y, w, h] = b.split(',').map(Number);
      cache.push({ name, primary: primary === 'True', x, y, w, h });
    }
  } catch { /* fall back */ }
  return cache;
}

/** The first non-primary monitor, or null. */
export function secondaryMonitor() { return monitors().find((m) => !m.primary) || null; }

let noted = false;
/**
 * { x, y, width, height, monitor } for a window of the asked size.
 * `offset` is relative to the secondary monitor's origin (or absolute on the
 * fallback, which is the previous behaviour). Size is clamped to the monitor.
 */
export function placeOnSecondary({ width = 1280, height = 900, offset = [60, 60] } = {}) {
  const m = secondaryMonitor();
  if (!m) {
    if (!noted) { noted = true; console.log('  NOTE: only one monitor detected - test windows open on the main monitor (old placement)'); }
    return { x: offset[0], y: offset[1], width, height, monitor: null };
  }
  const w = Math.min(width, m.w - 2 * offset[0]), h = Math.min(height, m.h - 2 * offset[1]);
  return { x: m.x + offset[0], y: m.y + offset[1], width: w, height: h, monitor: m };
}

/** True when a window rect lies fully inside monitor m. */
export const inside = (r, m) => !!m && r.left >= m.x && r.top >= m.y && r.left + r.width <= m.x + m.w && r.top + r.height <= m.y + m.h;

/**
 * Where the browser really put the window: CDP Browser.getWindowForTarget on a page of ctx.
 * { ok, bounds: {left, top, width, height, windowState}, why }. A headless browser has no screen window:
 * ok=false, why='headless'.
 */
export async function windowBounds(ctx, page) {
  if (await isHeadless(ctx)) return { ok: false, bounds: null, why: 'headless' };
  let cdp;
  try {
    const pg = page || ctx.pages()[0] || await ctx.newPage();
    cdp = await ctx.newCDPSession(pg);
    const { bounds } = await cdp.send('Browser.getWindowForTarget');
    return { ok: true, bounds, why: null };
  } catch (e) { return { ok: false, bounds: null, why: `getWindowForTarget failed: ${e.message}` }; }
  finally { try { await cdp?.detach(); } catch { /* page already gone */ } }
}

/**
 * Placement check for a headed run: is the real window (Browser.getWindowForTarget) on the secondary monitor?
 * { status: 'OK' | 'MISPLACED' | 'NOT RUN', why, bounds, monitor }. NOT RUN covers one monitor, non-Windows,
 * headless and an unreadable window; a caller prints it, never turns it into a pass.
 */
export async function verifyPlacement(ctx, page) {
  const m = secondaryMonitor();
  if (!m) return { status: 'NOT RUN', why: 'single monitor', bounds: null, monitor: null };
  const wb = await windowBounds(ctx, page);
  if (!wb.ok) return { status: 'NOT RUN', why: wb.why, bounds: null, monitor: m };
  const b = wb.bounds;
  // The outer rect is the viewport plus the browser frame (measured 1296x1034 for a 1280x900 viewport), which can overhang the
  // monitor edge by a few pixels; "on the secondary monitor" means the top-left and the centre are inside and >= 90 % of the area is.
  const ix = Math.max(0, Math.min(b.left + b.width, m.x + m.w) - Math.max(b.left, m.x)), iy = Math.max(0, Math.min(b.top + b.height, m.y + m.h) - Math.max(b.top, m.y));
  const share = (ix * iy) / (b.width * b.height);
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  const ok = b.left >= m.x && b.top >= m.y && cx < m.x + m.w && cy < m.y + m.h && share >= 0.9;
  return ok
    ? { status: 'OK', why: null, bounds: b, monitor: m, share: +share.toFixed(3), overhang: { right: Math.max(0, b.left + b.width - (m.x + m.w)), bottom: Math.max(0, b.top + b.height - (m.y + m.h)) } }
    : { status: 'MISPLACED', why: `window ${b.left},${b.top} ${b.width}x${b.height} is not on ${m.name} ${m.x},${m.y} ${m.w}x${m.h} (${Math.round(share * 100)} % inside)`, bounds: b, monitor: m, share };
}

/** True when the browser behind ctx runs headless (user agent marker, or the force switch). */
export async function isHeadless(ctx) {
  if (process.env.QAW_FORCE_HEADLESS === '1') return true;
  try {
    const cdp = await ctx.browser().newBrowserCDPSession();
    const { userAgent } = await cdp.send('Browser.getVersion');
    return /HeadlessChrome/.test(userAgent);
  } catch { return false; }
}

/**
 * Keep the test browser's own top-level windows above everything else while the
 * run lasts (HWND_TOPMOST, no move/resize/activate, so no focus is stolen), and
 * put them back (HWND_NOTOPMOST) on release(). Only windows owned by the browser
 * process this run launched are touched; the owner's windows never are.
 * Returns { ok, why, count, release } - on failure ok=false and `why` says so,
 * and the caller keeps the covered-window SKIP path.
 */
export async function keepOnTop(ctx) {
  const fail = (why) => { console.log(`  NOTE: test window not made topmost (${why}); covered-window SKIP path stays as fallback`); return { ok: false, why, count: 0, release: async () => {} }; };
  if (process.platform !== 'win32') return fail('not Windows');
  // A headless browser has no window to pin: skip silently (no NOTE), the covered-window path is moot there too.
  if (await isHeadless(ctx)) return { ok: false, why: 'headless', count: 0, silent: true, release: async () => {} };
  let pid;
  try {
    const cdp = await ctx.browser().newBrowserCDPSession();
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    pid = processInfo.find((p) => p.type === 'browser')?.id;
  } catch (e) { return fail(`no browser pid: ${e.message}`); }
  if (!pid) return fail('no browser pid');
  const script = (flag) => `Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class T {
  delegate bool CB(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(CB cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  public static int Set(uint pid, bool top) { int n = 0;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); var sb = new StringBuilder(64); GetClassName(h, sb, 64);
      if (p == pid && IsWindowVisible(h) && sb.ToString() == "Chrome_WidgetWin_1") {
        if (SetWindowPos(h, top ? new IntPtr(-1) : new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)) n++; }
      return true; }, IntPtr.Zero); return n; } }
'@
[T]::Set(${pid}, ${flag})`;
  const run = (flag) => parseInt(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script(flag), 'utf16le').toString('base64')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 10);
  let count;
  try { count = run('$true'); } catch (e) { return fail(`SetWindowPos failed: ${e.message}`); }
  if (!(count > 0)) return fail('no visible Chrome window of the test browser found');
  console.log(`  topmost: ${count} test window(s) of browser pid ${pid} pinned above others until the run ends`);
  let released = false;
  const release = async () => { if (released) return; released = true; try { run('$false'); } catch { /* browser already closed */ } };
  // Every launcher then needs one line: close() releases first, so nothing stays topmost.
  const close = ctx.close.bind(ctx);
  ctx.close = async (...a) => { await release(); return close(...a); };
  return { ok: true, why: null, count, release };
}
