/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * 1014 B1, bug 1: "open in side panel" docks QA Wrap in Chrome's side panel.
 *
 *   node tools/test-dock-panel.mjs
 *
 * Two ways in, and both must work:
 *  - the float's Dock button: the popup calls `sidePanel.open()` before anything is awaited (a gesture does not survive an
 *    `await`), and the float it replaces closes;
 *  - the toolbar icon with "open the side panel" chosen in Settings: Chrome opens the panel itself (`setPanelBehavior`), because a
 *    worker that read the setting first had already lost the click's gesture. The behaviour follows the setting, both ways.
 * Part 1 reads the source; part 2 drives a real headed Chromium with the extension loaded and proves it saw the ready state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXT } from './lib-paths.mjs';
import { workerSrc } from './lib-worker-src.mjs';
import { launchPopupHarness } from './test-next-primary.mjs';

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };

/* Part 1: the source. */
const js = fs.readFileSync(path.join(EXT, 'popup', 'popup.js'), 'utf8');
const at = js.indexOf("$('dock')?.addEventListener('click'");
const body = js.slice(at, js.indexOf("$('view-report')", at));
check(at > 0 && /chrome\.sidePanel\.open\(\{ windowId \}\)/.test(body), 'the Dock button calls sidePanel.open with a window id');
check(!/\bawait\b/.test(body.slice(0, body.indexOf('chrome.sidePanel')).replace(/\/\/.*$/gm, '')), 'nothing is awaited before the first open() (the gesture is still live)');
check(/\.catch\(\(\) => attempt\(id\)\)/.test(body), 'a failed target is retried on the next candidate window, not dropped');
check(/\.catch\(dockFailed\)/.test(body) && /catch \(err\) \{\s*dockFailed\(err\)/.test(body), 'both a rejection and a synchronous throw reach the status line (dockFailed: Opera hides the button and says the plain sentence, anything else is sayFailure)');

const worker = workerSrc();
check(/const syncPanelBehavior = async \(\) => \{ try \{ if \(hasSidePanel\(\)\) await chrome\.sidePanel\.setPanelBehavior\?\.\(\{ openPanelOnActionClick: \(await getSettings\(\)\)\.launchSurface === 'panel' \}\); \} catch/.test(worker), 'the toolbar behaviour is derived from the launchSurface setting, and a failed read is caught (R-06)');
check(!/openPanelOnActionClick:\s*false/.test(worker) && !/undockPanel/.test(worker), 'nothing pins the toolbar behaviour to "off" any more');
check((worker.match(/syncPanelBehavior/g) || []).length >= 6, 'it runs at worker start, onInstalled, onStartup and on every settings change', `${(worker.match(/syncPanelBehavior/g) || []).length} mentions`);
check(/if \('settings' in c \|\| \(area === 'managed' && 'launchSurface' in c\)\) syncPanelBehavior\(\);/.test(worker), 'a settings change, or a managed launchSurface change, re-syncs it');

/* Part 2: a real browser. */
let h;
let code = 1;
try {
  h = await launchPopupHarness({ label: 'dock-panel' });
  const { context, id } = h;
  const sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  const behaviour = () => sw.evaluate(() => chrome.sidePanel.getPanelBehavior().then((b) => b.openPanelOnActionClick));
  const until = async (want) => { for (let i = 0; i < 40; i++) { if ((await behaviour()) === want) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  const setSurface = (page, launchSurface) => page.evaluate((v) => chrome.runtime.sendMessage({ type: 'UQA_SET_SETTINGS', patch: { launchSurface: v } }), launchSurface);

  check(await until(false), 'default settings (float): the toolbar icon does not open the panel itself');
  await setSurface(h.popup, 'panel');
  check(await until(true), 'launchSurface "panel": Chrome opens the side panel on the toolbar click');
  await setSurface(h.popup, 'float');
  check(await until(false), 'launchSurface back to "float": the behaviour follows');

  // The float's Dock button, on a real float window beside a real page.
  const [pop] = await Promise.all([
    context.waitForEvent('page'),
    sw.evaluate((u) => chrome.windows.create({ url: u, type: 'popup', width: 420, height: 700, focused: true }), `chrome-extension://${id}/popup/popup.html?surface=float`),
  ]);
  await pop.waitForFunction(() => document.body?.dataset.ready === 'true', null, { timeout: 20000 });
  const dock = await pop.evaluate(() => { const b = document.getElementById('dock'); const r = b.getBoundingClientRect(); return { shown: getComputedStyle(b).display !== 'none' && r.width > 0, enabled: !b.disabled }; });
  check(dock.shown && dock.enabled, 'ready: the float shows an enabled Dock button', JSON.stringify(dock));
  let closed = false;
  pop.on('close', () => { closed = true; });
  await pop.click('#dock');
  for (let i = 0; i < 40 && !closed; i++) await new Promise((r) => setTimeout(r, 100));
  const panels = await sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }).then((c) => c.map((x) => x.documentUrl)));
  check(closed, 'the float closes itself once the panel is open');
  check(panels.some((u) => u.includes('sidepanel/sidepanel.html')), 'a side panel context exists after the press', JSON.stringify(panels));
  check(h.errors.length === 0, 'no page error in the popup', h.errors.join(' | '));
  code = failures.length ? 1 : 0;
} catch (err) {
  console.log(`  FAIL  run aborted: ${err.stack || err.message}`);
} finally {
  await h?.close();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(code);
