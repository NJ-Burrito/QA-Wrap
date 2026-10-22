/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * 1014 B1, bug 1, on branded Chrome: a real press on the pinned toolbar icon follows Settings.
 *
 *   node tools/test-toolbar-panel.mjs
 *
 * Measured 2026-10-14: `sidePanel.open()` called after any await inside `action.onClicked` fails with "may only be called in
 * response to a user gesture", so choosing "the side panel" in Settings opened a float. Now `setPanelBehavior` has Chrome open the
 * panel itself (and `action.onClicked` does not fire, so that tab is not granted for tab recording: the shortcut grants it), while
 * "float" still reaches `action.onClicked` and grants the tab. The press is UI Automation / MSAA, never the OS mouse; a press that
 * cannot be proven is a visible SKIPPED (exit 2), never a pass. Branded Chrome ignores --load-extension: CDP Extensions.loadUnpacked.
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
const PROFILE = profile('.toolbar-panel-profile');
const TITLE = 'QAWRAP-TOOLBAR-PANEL';

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
console.log(`toolbar press — ${EXT}`);
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: null,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging', `--window-position=${SPOT.x},${SPOT.y}`, `--window-size=${SPOT.width},${SPOT.height}`, '--no-first-run', '--no-default-browser-check'],
});
const top = await keepOnTop(ctx);
const floats = () => ctx.pages().filter((p) => p.url().includes('popup/popup.html?surface=float'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const mgr = ctx.pages()[0] || (await ctx.newPage());
  await mgr.goto('chrome://extensions');
  await mgr.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  const cdp = await ctx.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: EXT });
  const sw = ctx.serviceWorkers().find((w) => w.url().includes(id))
    || (await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().includes(id), timeout: 10000 }));
  await mgr.waitForTimeout(2500);
  const tab = await ctx.newPage();
  await tab.goto(`data:text/html,<title>${TITLE}</title><h1>target</h1>`);
  const ext = await ctx.newPage();
  await ext.goto(`chrome-extension://${id}/welcome/welcome.html`);
  await mgr.evaluate((x) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: x, pinnedToToolbar: true }), id);

  const choose = async (launchSurface) => {
    await ext.evaluate((v) => chrome.runtime.sendMessage({ type: 'UQA_SET_SETTINGS', patch: { launchSurface: v } }), launchSurface);
    for (let i = 0; i < 40; i++) { if ((await sw.evaluate(() => chrome.sidePanel.getPanelBehavior())).openPanelOnActionClick === (launchSurface === 'panel')) return true; await wait(100); }
    return false;
  };
  const press = async () => {
    await sw.evaluate(async () => { for (const t of await chrome.tabs.query({})) if (t.url.startsWith('data:')) await chrome.tabs.update(t.id, { active: true }); });
    await tab.waitForTimeout(800);
    let out;
    try { out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PRESS_PS, 'utf16le').toString('base64')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { out = String(e.stdout || e.message).trim(); }
    out = out.split(String.fromCharCode(10)).pop().trim();
    await wait(3500);
    return out.startsWith('UIA|') ? out.slice(4) : null;
  };
  const panels = () => sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length);
  const granted = () => sw.evaluate(async () => { const [t] = await chrome.tabs.query({ url: 'data:*' }); try { await chrome.tabCapture.getMediaStreamId({ targetTabId: t.id }); return true; } catch { return false; } });

  check(await choose('panel'), 'ready: Settings "side panel" is applied to the toolbar behaviour');
  const how = await press();
  if (!how) { skipped++; console.log('  SKIPPED: the toolbar press is not possible here'); }
  else {
    check((await panels()) > 0, `the toolbar press (${how}) opens the side panel`);
    check(floats().length === 0, 'and opens no float');
    await choose('float');
    for (const c of ctx.pages()) if (c.url().includes('sidepanel')) await c.close().catch(() => {});
    await press();
    check(floats().length === 1, 'back on "float", the same press opens the float');
    check(await granted(), 'and Chrome has granted that tab (action.onClicked ran)');
  }
} catch (err) {
  check(false, 'toolbar press ran to the end', err.message);
} finally {
  await top.release();
  await ctx.close();
}
console.log(`
${passed} passed, ${failures.length} failed${skipped ? `, ${skipped} SKIPPED (toolbar press not proven)` : ''}`);
if (failures.length) process.exit(1);
if (skipped) process.exit(2);
