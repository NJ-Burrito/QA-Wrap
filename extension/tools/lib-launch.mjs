/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * One place that decides how a browser is launched.
 *
 * Rules, in the order they matter:
 *
 *   1. **Always headed.** Never headless.
 *   2. **Never in front.** A suite must not interrupt what you are doing. The
 *      window opens at a normal size, off to one side, and no tool calls
 *      bringToFront() — tab-targeted messages carry an explicit tabId instead.
 *   3. **Never maximized.**
 *
 * A window that is not focused would normally have its timers and rendering
 * throttled by Chromium, which would quietly corrupt both the measurements and
 * the behaviour under test. The three --disable-*backgrounding* flags below turn
 * that off, so being behind your movie changes nothing but what you can see.
 *
 *   UQA_WINDOW=x,y   put the window somewhere else (absolute; default is the secondary monitor)
 *
 * Pipeline knobs (P3, 1012; the runner sets them, a person normally does not):
 *   QAW_ENGINE=chromium|cft-<milestone>   which browser; default is Playwright's bundled Chrome for Testing
 *   QAW_CFT_PATH=<chrome.exe>             required by cft-*; absent = ENV-BLOCKED (thrown), never a silent fallback
 *   QAW_FORCE_HEADLESS=1                  headless even for `headed: true` callers; the runner sets it only for
 *                                         suites whose manifest row says headlessOk (UQA_HEADLESS alone cannot,
 *                                         launchPopupHarness passes headed:true - rehearsal R4)
 * lib-sandbox-preload.mjs applies the same engine and headless rules to a launch that did not come through here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeOnSecondary } from './lib-test-window.mjs';

/** { engine, executablePath?, channel?, label } from QAW_ENGINE / QAW_CFT_PATH. Throws `ENV-BLOCKED ...` when cft has no binary. */
export function engineOptions(env = process.env) {
  const engine = env.QAW_ENGINE || 'chromium';
  if (/^cft/i.test(engine)) {
    const p = env.QAW_CFT_PATH;
    if (!p || !fs.existsSync(p)) throw new Error(`ENV-BLOCKED: engine ${engine} needs QAW_CFT_PATH to an existing chrome binary (got ${p || 'nothing'})`);
    return { engine, executablePath: p, label: engine };
  }
  return { engine, channel: 'chromium', label: `chromium-${bundledChromiumBuild() || 'unknown'}` };
}

let bundled;
/** Playwright's bundled Chromium build id (Chrome for Testing), read from browsers.json; null if unreadable. */
export function bundledChromiumBuild(ext) {
  if (bundled !== undefined) return bundled;
  try {
    const base = ext || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const json = path.join(base, 'node_modules', 'playwright-core', 'browsers.json');
    bundled = JSON.parse(fs.readFileSync(json, 'utf8')).browsers.find((b) => b.name === 'chromium')?.browserVersion || null;
  } catch { bundled = null; }
  return bundled;
}

/** True when this process is told to run headless regardless of the caller. */
export const forceHeadless = (env = process.env) => env.QAW_FORCE_HEADLESS === '1';

export function launchOptions(EXT, { width = 1280, height = 900, position, headed = false } = {}) {
  // `headed: true` is not a preference, it is the point: tools/launch.mjs exists
  // to hand you a browser to use. UQA_HEADLESS is for test runs, and it must not
  // reach through and open nothing. QAW_FORCE_HEADLESS is the pipeline's switch and does.
  const headless = forceHeadless() || (!headed && process.env.UQA_HEADLESS === '1');
  // Secondary monitor by default (lib-test-window.mjs); UQA_WINDOW is absolute and wins. A headless run has no window to place.
  const off = (position || '60,60').split(',').map(Number);
  const spot = headless ? { x: off[0], y: off[1], width, height } : placeOnSecondary({ width, height, offset: off });
  const [x, y] = process.env.UQA_WINDOW ? process.env.UQA_WINDOW.split(',').map(Number) : [spot.x, spot.y];
  if (!process.env.UQA_WINDOW) { width = spot.width; height = spot.height; }
  const eng = engineOptions();
  const { label, engine, ...engineFields } = eng;

  return {
    headless,
    ...engineFields,
    viewport: { width, height },
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      `--window-size=${width},${height}`,
      `--window-position=${x},${y}`,

      // Behaving identically while unfocused is the whole point.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',

      // Nothing here should ever pop a dialog or a first-run tab.
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,MediaRouter',
    ],
  };
}
