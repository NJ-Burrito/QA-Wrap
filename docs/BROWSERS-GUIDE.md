# QA Wrap browser guide

One source tree, nine dist folders. This file is the rule list, the support matrix and the device notes. The rules are
numbered B1-B15, each one a testable assertion; `extension/tools/test-browser-dists.mjs` (run from `extension/`) checks
them, and the 12 Autopilot rules in `CLAUDE.md` keep applying because B9 proves every dist is the same code.

Facts are graded: [V] read in a primary source, [A] inferred from a primary source or the build's own record, [U] not
verified. MDN browser-compat-data (BCD) 8.1.6, retrieved 2026-10-20 from unpkg.com/@mdn/browser-compat-data; web-ext lint
via npx the same day; Edge policy page learn.microsoft.com/deployedge/microsoft-edge-manage-extensions-ref-guide
retrieved 2026-10-20. Sources per row: `work/ui-1020/browsers.md`.

## Rules

| # | Rule (assertion) | Checked by |
|---|---|---|
| B1 | Every dist has a valid MV3 manifest, no duplicated or required-and-optional permission, every icon, the `en` and `ar` locales and a `BROWSER.md`; every file the manifest names ships. | test-browser-dists |
| B2 | Chromium family (chrome, chrome-managed, edge, brave, opera, operagx, duckduckgo): `background.service_worker`, `side_panel`, the shared `key`, `minimum_chrome_version` >= 116, no `browser_specific_settings`, no `default_area`. | test-browser-dists |
| B3 | chrome-managed is the Chrome build minus `debugger` and only `debugger`; its `BROWSER.md` carries the pin policy line. | test-browser-dists, test-managed-flavour |
| B4 | Firefox: `background.scripts` (event page), `browser_specific_settings.gecko.id`, `strict_min_version` >= 140 (F3, fixed), `data_collection_permissions` with `required: ["none"]`, no `side_panel`, `key` or `minimum_chrome_version`, none of sidePanel, offscreen, tabCapture, desktopCapture, debugger, system.display (required or optional). | test-browser-dists, web-ext lint |
| B5 | Safari folder: no `side_panel`, `key`, `minimum_chrome_version`, `browser_specific_settings`, none of the permissions in B4, and neither `downloads` nor `notifications` (F2, fixed: `omit` in targets.mjs). | test-browser-dists |
| B6 | Every call to an API the engine lacks is guarded inline (`?.`, `typeof`, `hasSidePanel()`, `try`/`.catch`) or lives in a module reached only through a `CAPABILITIES` entry the popup checks (media.js and whitebox.js). | test-browser-dists static scan |
| B7 | Each of offscreen, tabCapture, desktopCapture, debugger has a `CAPABILITIES` entry (with the fallback sentence) and is in the `drop` list of Firefox and Safari. | test-capabilities, test-browser-dists |
| B8 | `storage.session.setAccessLevel`, `scripting.registerContentScripts`, `notifications`, `system.display`, `windows.onBoundsChanged` are only called through `?.` or a guard. | B6 scan, web-ext lint |
| B9 | Every dist is byte-identical to the source tree except `manifest.json` and `BROWSER.md`. So the Jira helper, the Autopilot rules and every unit suite proven on the tree are proven on the dist. | test-browser-dists |
| B10 | Suggested chords are `Alt+Shift+<letter>`, unique, and not on a chord Opera or Firefox keep for the browser; every command is also a button in the popup (users can rebind or lose a chord). | test-browser-dists |
| B11 | Touch: the hit-size token is >= 44 px; no action is hover-only; the popup has a viewport meta and uses logical (RTL-safe) properties. | test-browser-dists, test-reach-popup, test-a11y-static |
| B12 | Live: each Chromium-family dist loads into Chromium, the service worker boots with no console error, `popup/popup.html` reaches `body[data-ready="true"]`, and the managed dist has no `debugger`. | test-browser-dists (live) |
| B13 | Firefox: `web-ext lint` has 0 errors and no `MANIFEST_*` warning. | `QAW_WEBEXT=1 node tools/test-browser-dists.mjs` |
| B14 | Pin: Firefox `action.default_area` is `navbar`; the managed recipes ship `toolbar_pin: force_pinned` (Chrome) and `toolbar_state: force_shown` (Edge); every other browser gets the welcome-page pin hint, shown only while `chrome.action.getUserSettings()` says `isOnToolbar` is false (guarded), re-checked on focus, visibility and `onUserSettingsChanged`, one hint line <= 25 words in EN and AR, no `&` or `+`, the animation is one-shot and off under reduced motion. | test-browser-dists, test-ui-names, test-copy-length |
| B15 | No `windows` API (Firefox for Android): `chrome.windows` is replaced at worker load by a tab-backed shim (float id = tab id + 1e9, any other id = the one browser window); where `windows` exists the shim is never installed. | test-no-windows |

A new API call that the matrix marks missing on any engine must come with a guard or a `CAPABILITIES` entry in the same
commit. A new user-facing string goes in EN and AR together.

## Matrix: what QA Wrap uses, per browser

`yes` supported, `guard` missing and handled in code, `off` removed from that manifest and the feature says so in the
interface (`core/capabilities.js`). Chromium forks inherit Chrome's column: Edge, Opera and Opera GX [V] BCD; Brave and
DuckDuckGo are not in BCD [A] (Chromium builds, `BROWSER.md` notes their tracker blocking).

| API / key | Chrome, Edge, Brave, Opera/GX, DuckDuckGo | Firefox desktop | Firefox Android | Safari macOS | Safari iOS |
|---|---|---|---|---|---|
| `background.service_worker` | yes (Chrome 88, Opera 74) | not supported [V]; event page `background.scripts` | event page | yes (15.4), `type: module` [U] | same |
| `sidePanel` + `side_panel` | yes (Chrome/Edge 114, Opera 100) | off; falls back to the float window (`hasSidePanel()`) | off | off | off |
| `offscreen` (recorder, GIF, stitching) | yes | off, capability message | off | off | off |
| `tabCapture`, `desktopCapture` | yes | off | off | off | off |
| `debugger` (coverage, full-page) | yes; absent in chrome-managed | off [V] BCD | off | off [V] | off |
| `scripting.registerContentScripts`, `world: MAIN` | yes (Chrome 96/102) | yes (102); MAIN world from 128 [A] | yes | yes (16.4) | yes |
| `storage.session` | yes | yes (115) | yes | yes (16.4) | yes |
| `storage.session.setAccessLevel` | yes (102) | guard (`?.`) [V] missing | guard | yes | yes |
| `storage.managed` + `managed_schema` | yes | storage.managed yes (57); the `storage` manifest key is unsupported [V] | no | no | no |
| `alarms` | yes | yes | yes | yes (14) | yes |
| `notifications` | yes | yes | yes | guard (`chrome.notifications?.create`) [V] missing | guard |
| `downloads` | yes | yes | yes | missing in Safari [V]; permission still listed (open finding F2) | missing |
| `commands` (shortcuts) | yes | yes (48) | no [V] | yes | yes |
| `contextMenus` | yes | yes (`menus` alias) | no [V] | yes | no [V] |
| `action` + `getUserSettings` | yes (91) | yes (109 / 116) | yes | `action` yes, `getUserSettings` no [V] | no |
| `windows` (float window) | yes | yes | no [V]; float opens as a tab (B15) | yes | yes (limited) [U] |
| `runtime.getContexts` | yes (116) | yes (127) | yes | no [V] | no |
| `devtools_page` | yes | yes (54) | no [V] | yes (16) | no |
| `tabs.captureVisibleTab` | yes | yes | yes | yes | yes |
| `system.display` | yes | removed from the manifest [A] | removed | removed | removed |
| `host_permissions <all_urls>` | yes | yes (109), user can withhold | yes | yes (15.4), per-site prompt [A] | yes |
| `cookies`, `nativeMessaging` (optional) | yes | yes; nativeMessaging no on Android [V] | cookies yes | yes | yes |

Identity keys: Chromium `key` pins the id; Firefox needs `gecko.id` (`qa-wrap@qa-wrap.invalid`); Safari uses the bundle
id Xcode generates. Firefox store: `data_collection_permissions` is required for new AMO submissions (3 Nov 2025) [A,
extensionworkshop.com, checked 2026-09-08]; versions below 140 ignore the key (F3).

## Store and UX guidelines that bite

- **Chrome Web Store**: single purpose, permissions justified one by one (`debugger` and `<all_urls>` need a
  justification), no remote code, privacy disclosure; the project never uploads (CLAUDE.md). [A]
- **Edge Add-ons**: accepts the Chrome package; reviews separately; same permission justification. [A]
- **Opera add-ons**: reviews separately; Opera also installs from the Chrome store once "Install Chrome extensions" is on. [A]
- **Firefox AMO**: gecko id, `data_collection_permissions`, no obfuscated or minified-without-source code (the vendored
  `axe.min.js` needs its source noted), `innerHTML` assignments get a lint warning (44 today, reviewer reads them). [V] lint, [A] policy.
- **Safari App Store**: wrapped by Xcode `safari-web-extension-converter`; needs a macOS build and an Apple developer
  account. Not testable on Windows. [A]
- **Brave and DuckDuckGo**: no store of their own for desktop extensions; they install the Chrome package. [A]

## Devices

| Device class | Extensions? | What QA Wrap does |
|---|---|---|
| Windows, macOS, Linux desktop Chromium family | yes | the full surface; live-tested here on Windows via Chromium |
| Firefox desktop | yes | event page, no recorder/coverage/side panel, capability messages |
| Firefox for Android | yes (add-ons subset) [V]; **best effort, untested on device** (no device here; no `gecko_android` key is set in the manifest) | no `windows` (float opens as a tab, B15), `commands`, `contextMenus`, `devtools` |
| Safari macOS / iOS / iPadOS | yes via an Xcode app | static checks only; **not testable on Windows** |
| Chrome / Edge / Opera / Brave on Android or iOS | no extension support [A] | not applicable |
| Touch input | any of the above | hit targets >= 44 px (B11); no hover-only actions; the float is 560x720 and the popup is 348 px wide, so on a small viewport use the tab surface |
| RTL Arabic | any | `dir="rtl"` from `platform/i18n.js`, logical CSS properties, bidi isolates (`<bdi>`) in mixed labels |

Keyboard chords: ours are `Alt+Shift+Q/S/E/V`. Firefox's `commands` accepts `Alt+Shift+<letter>`; Opera and Opera GX keep
several `Alt+<letter>` and Ctrl chords for the browser, so the chosen set avoids `F D P T B`. [V] Opera's list (https://help.opera.com/en/latest/shortcuts/, read 2026-10-20) has only
`Alt+P`, `Alt+Left/Right`, `Alt+F4` and `Alt+Tab` as Alt chords and every Shift chord carries Ctrl/Cmd, so `Alt+Shift+Q/S/E/V` and the in-page `Alt+S/E/D/N/C/A/B` do not collide (Opera GX has no such page: [A], same base). macOS maps Alt to Option, which types a character; the Autopilot rule 3 already refuses a
character-producing Option press in text fields. Any user can rebind at `chrome://extensions/shortcuts`,
`about:addons` (Manage Extension Shortcuts) or Safari's extension settings.

## Pinning

| Browser | How it is pinned | Source |
|---|---|---|
| Firefox | `action.default_area: "navbar"` in the manifest (Firefox 109+) | [V] BCD |
| Chrome managed | `ExtensionSettings` `toolbar_pin: "force_pinned"` | [A] ADMIN.md; Chrome Enterprise |
| Edge managed | `ExtensionSettings` `toolbar_state: "force_shown"` | [V] learn.microsoft.com |
| Chrome, Edge, Brave, Opera, Opera GX, DuckDuckGo, Safari (unmanaged) | no API can pin. The welcome page hint shows how, and hides once `getUserSettings().isOnToolbar` is true. Wording follows the browser: puzzle piece and pin (Chrome, Brave, DuckDuckGo), puzzle piece and eye (Edge), cube and pin (Opera, Opera GX), Customize Toolbar (Safari). | [V] BCD getUserSettings: Chrome/Edge 91, Opera 77, Firefox 116, Safari not supported |

## Open findings, ranked

1. **F1 Firefox for Android has no `windows` API.** FIXED: `tabWindows` in `worker-lifecycle.js` opens the float as a tab (rule B15).
2. **F2 Safari lists `downloads` and `notifications`**, which Safari does not implement. FIXED (2026-10-20): `TARGETS.safari.omit` removes both from the Safari folder; the calls were already guarded. Converting the folder to an Xcode app still needs a Mac (F4).
3. **F3 Firefox `strict_min_version`** FIXED: raised 128 to 140 (first version reading `data_collection_permissions`); ESR 128-139 users dropped (Nader, 2026-10-20).
4. **F4 Safari `background.type: "module"`** and `commands` on iOS are unverified [U]; needs a Mac.
5. **F5 Opera/Opera GX reserved chords** FIXED as "no collision" [V] (see Keyboard chords); no suggested_key changed. Firefox Android: tab fallback kept, best effort, untested on device.
6. Fixed in this pass: `system.display` and optional `desktopCapture` removed from the Firefox and Safari manifests
   (web-ext lint named both), Firefox `default_area: "navbar"`, managed pin recipes, the welcome pin hint.
