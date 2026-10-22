/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Boot smoke: the extension as a tester gets it — real Chrome, loaded unpacked.
 *
 *   node tools/test-boot-smoke.mjs [--ext <dir>] [--no-click]
 *
 * Asserts: the card on chrome://extensions has no warning or error, the worker
 * starts without one, and the float opens and renders — first through the
 * worker's UQA_OPEN_FLOAT path, then (unless --no-click, Windows only) by a
 * press on the pinned toolbar icon through UI Automation / MSAA, which reaches
 * action.onClicked without the OS mouse (tests never move or click the owner's
 * cursor). A press that cannot be proven is a visible SKIPPED, never a pass.
 *
 * Why it exists: 3.2.0 shipped with every icon click failing inside a listener
 * whose failure is a console.warn, so nothing ever turned red (research:
 * work/debug-0928/DEBUG.md). Branded Chrome ignores --load-extension, so the
 * extension is loaded by CDP Extensions.loadUnpacked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { EXT as HOME, profile } from './lib-paths.mjs';
import { placeOnSecondary, inside, keepOnTop } from './lib-test-window.mjs';
import { ON_FAILED, RING_KEY } from '../core/on.js';

const argv = process.argv.slice(2);
const EXT = argv.includes('--ext') ? path.resolve(argv[argv.indexOf('--ext') + 1]) : HOME;
const CLICK = !argv.includes('--no-click') && process.platform === 'win32';
const PROFILE = profile('.boot-smoke-profile');
const TITLE = 'QAWRAP-BOOT-SMOKE';

const failures = [];
let passed = 0;
let skipped = 0;
const check = (ok, name, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

// Press the toolbar button named `QA Wrap…` in the window titled TITLE - never
// with the real OS mouse (owner rule, 9 Oct 2026, fix-1009-r3: a test must not
// move or click the owner's cursor; W5 found the old OS-level click landing
// in a fullscreen game that held the cursor). Order: UIA Invoke, then MSAA
// accDoDefaultAction at the button centre (only if the accessible there is
// named "QA Wrap…"; Chrome turns it into a synthetic press of the view, which
// dispatches action.onClicked), then UIA Expand. No focus change.
// Output, last line: UIA|<how> | NOPRESS | NOWINDOW | NOBUTTON
const PRESS_PS = String.raw`
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class M { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
public struct P { public int X; public int Y; } }
public static class X { [DllImport("oleacc.dll")] static extern int AccessibleObjectFromPoint(M.P pt, [MarshalAs(UnmanagedType.Interface)] out Accessibility.IAccessible a, out object c);
  public static string Press(int x, int y) { M.P p; p.X = x; p.Y = y; Accessibility.IAccessible a; object c;
    if (AccessibleObjectFromPoint(p, out a, out c) != 0 || a == null) return null;
    string n = a.get_accName(c) ?? ""; if (!n.StartsWith("QA Wrap")) return null;
    a.accDoDefaultAction(c); return n; } }
'@ -ReferencedAssemblies Accessibility
[M]::SetProcessDPIAware() | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]; $root = $A::RootElement
$all = [System.Windows.Automation.Condition]::TrueCondition
$win = $null; foreach ($i in 1..20) { $win = $root.FindAll('Children', $all) | ? { $_.Current.Name -like '*${TITLE}*' } | Select -First 1; if ($win) { break }; Start-Sleep -Milliseconds 250 }
if (-not $win) { 'NOWINDOW'; exit 2 }
$bc = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$btn = $null; foreach ($i in 1..20) { $btn = $win.FindAll('Descendants', $bc) | ? { $_.Current.Name -like 'QA Wrap*' } | Select -First 1; if ($btn) { break }; Start-Sleep -Milliseconds 250 }
if (-not $btn) { 'NOBUTTON'; exit 3 }
$p = $null
if ($btn.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); 'UIA|Invoke'; exit 0 }
$r = $btn.Current.BoundingRectangle
if ([X]::Press([int]($r.X + $r.Width/2), [int]($r.Y + $r.Height/2))) { 'UIA|MSAA DoDefaultAction'; exit 0 }
if ($btn.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { $p.Expand(); 'UIA|Expand'; exit 0 }
'NOPRESS'; exit 4`;

const SPOT = placeOnSecondary({ width: 1280, height: 900 });
fs.rmSync(PROFILE, { recursive: true, force: true });
console.log(`boot smoke — ${EXT}`);
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: null,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging', `--window-position=${SPOT.x},${SPOT.y}`, `--window-size=${SPOT.width},${SPOT.height}`, '--no-first-run', '--no-default-browser-check'],
});
const top = await keepOnTop(ctx); // never covered; released in finally
const warnings = [];
const onFailed = []; // T-055: the oracle for core/on.js, which turns a handler throw into a console.warn
ctx.on('console', (m) => {
  if (ON_FAILED.test(m.text())) onFailed.push(m.text());
  if (m.type() === 'error' || m.type() === 'warning') warnings.push(`${m.type()}: ${m.text()}`);
});
ctx.on('weberror', (e) => warnings.push(`uncaught: ${e.error()}`));

const floats = () => ctx.pages().filter((p) => p.url().includes('popup/popup.html?surface=float'));
async function floatRenders(name, why = async () => '') {
  const deadline = Date.now() + 8000;
  while (!floats().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  const f = floats()[0];
  check(!!f, `${name}: the float window opens`, f ? '' : [await why(), ...warnings].filter(Boolean).join(' | '));
  if (!f) return;
  const ready = await f.waitForSelector('body[data-ready="true"]', { timeout: 8000 }).then(() => true, () => false);
  check(ready, `${name}: the float renders (body[data-ready="true"])`);
  await f.close();
}

try {
  const mgr = ctx.pages()[0] || (await ctx.newPage());
  await mgr.goto('chrome://extensions');
  await mgr.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  const cdp = await ctx.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: EXT });
  const sw = ctx.serviceWorkers().find((w) => w.url().includes(id))
    || (await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().includes(id), timeout: 10000 }));
  await mgr.waitForTimeout(2500); // onInstalled work settles

  // Placement proof: the real window rect (CDP) must lie inside the secondary monitor.
  if (SPOT.monitor) {
    const m = SPOT.monitor;
    const wcdp = await ctx.newCDPSession(mgr);
    const { windowId } = await wcdp.send('Browser.getWindowForTarget');
    const { bounds } = await wcdp.send('Browser.getWindowBounds', { windowId });
    console.log(`  window bounds ${bounds.left},${bounds.top} ${bounds.width}x${bounds.height}; secondary monitor ${m.name} ${m.x},${m.y} ${m.w}x${m.h}`);
    check(inside(bounds, m), 'the test window is on the secondary monitor');
  }

  const info = await mgr.evaluate((x) => chrome.developerPrivate.getExtensionInfo(x), id);
  const card = [...info.installWarnings, ...info.manifestErrors.map((e) => e.message), ...info.runtimeErrors.map((e) => `${e.message} @ ${e.source}`)];
  check(info.state === 'ENABLED', `the extension is enabled (${info.state})`);
  check(!card.length, 'chrome://extensions shows no warning or error', card.join(' | '));
  check(!warnings.length, 'the worker starts with no error or warning', warnings.join(' | '));

  // Path 1: the worker's own open-float door, from an extension page in a normal window.
  const tab = await ctx.newPage();
  await tab.goto(`data:text/html,<title>${TITLE}</title><h1>target</h1>`);
  const ext = ctx.pages().find((p) => p.url().startsWith(`chrome-extension://${id}/`) && !p.url().includes('surface=float'))
    || (await ctx.newPage().then(async (p) => (await p.goto(`chrome-extension://${id}/welcome/welcome.html`), p)));
  await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'UQA_OPEN_FLOAT' }));
  await floatRenders('UQA_OPEN_FLOAT');

  // Path 2: a press on the pinned toolbar icon (UIA/MSAA, never the OS mouse).
  if (CLICK) {
    await mgr.evaluate((x) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: x, pinnedToToolbar: true }), id);
    await ext.close();
    await sw.evaluate(async () => {
      for (const t of await chrome.tabs.query({})) if (t.url.startsWith('data:')) await chrome.tabs.update(t.id, { active: true });
    });
    await tab.waitForTimeout(800);
    // Oracle for "did action.onClicked fire?": a second listener, read only when the float does not open.
    const pre = await sw.evaluate(async () => {
      globalThis.__smokeClicks = 0;
      chrome.action.onClicked.addListener(() => { globalThis.__smokeClicks++; });
      return { popup: await chrome.action.getPopup({}) };
    });
    const why = async () => `action.onClicked fired ${await sw.evaluate(() => globalThis.__smokeClicks)}x, popup "${pre.popup}"`;
    let out;
    try {
      out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PRESS_PS, 'utf16le').toString('base64')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) { out = String(e.stdout || e.message).trim(); }
    out = out.split(/\r?\n/).pop().trim();
    const how = out.startsWith('UIA|') ? out.slice(4) : null;
    const deadline = Date.now() + (how ? 8000 : 0);
    while (!floats().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    if (floats().length) { check(true, `the toolbar icon is pressed through ${how}`); await floatRenders(`toolbar press (${how})`); }
    else { skipped++; console.log(`  SKIPPED: toolbar press ${how ? `through ${how} did not open the float` : `not possible (${out})`}; ${await why()}`); }
  } else console.log('  --  toolbar press skipped');
  check(!warnings.length, 'no error or warning after opening the float', warnings.join(' | '));
  check(!onFailed.length, 'no handler failed (core/on.js warned)', onFailed.join(' | '));
  const ring = await sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k] || [], RING_KEY);
  check(!ring.length, 'the handler ring is empty', JSON.stringify(ring));
} catch (err) {
  check(false, 'boot smoke ran to the end', err.message);
} finally {
  await top.release();
  await ctx.close();
}

console.log(`\n${passed} passed, ${failures.length} failed${skipped ? `, ${skipped} SKIPPED (toolbar press not proven)` : ''}`);
if (failures.length) process.exit(1);
// Skip protocol (test pipeline 2.7): a toolbar press that was not proven is SKIPPED (exit 2), never a quiet exit 0.
if (skipped) { console.log(`SKIPPED: toolbar press not proven (${skipped})`); process.exit(2); }
