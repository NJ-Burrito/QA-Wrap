# Opera add-ons: permission justifications for QA Wrap 3.8.0

Read from the built `dist/opera/manifest.json`; every permission the package declares has a row. Copy a row into the store's per-permission box.

| Permission | Kind | Why |
|---|---|---|
| `storage` | required | Keeps sessions, settings and reports in the browser profile, on this computer. |
| `unlimitedStorage` | required | A long session with screenshots and recordings is larger than the default storage quota. |
| `contextMenus` | required | The right-click entries that start a recording, copy a Playwright locator or add a note. |
| `tabs` | required | Follows the tabs of the window under test and opens the extension's own report and settings pages. |
| `scripting` | required | Puts the in-page tools (locator picker, value palette, layout stress) into the page the tester is testing, on demand. |
| `webNavigation` | required | Records navigations and the HTTP status of the page itself, and reads the frame tree so a locator inside an iframe can be built. |
| `clipboardWrite` | required | Copies a Playwright locator or a report to the clipboard when the tester presses Copy. |
| `alarms` | required | The daily purge of sessions older than the retention period the tester chose; it must run while the background page is suspended. |
| `downloads` | required | Saves exports (Markdown, HAR, Excel, recordings) into the folder the tester chose. |
| `notifications` | required | Tells the tester when a session is saved, a recording starts or stops, and the extension goes to sleep. Switchable off in Settings; nothing in it is sent anywhere. |
| `offscreen` | required | Encoding screen recordings and GIFs needs a document, which a service worker does not have. |
| `activeTab` | required | Reads the URL and title of the tab the tester invoked the extension on. |
| `tabCapture` | required | Records a video of the tab when the tester presses Record. |
| `debugger` | required | Code coverage needs the debugger permission. It is attached to a tab only when the tester presses Measure and detached when the run ends; nothing attaches it on its own. |
| `webRequest` | required | Observation only, never blocking: reads six security headers (CSP, HSTS, CORS, X-Frame-Options, Referrer-Policy, Permissions-Policy) off each response while a session records, so the fine-print check can report on them. Nothing is modified, redirected or delayed. |
| `sidePanel` | required | The docked workbench beside the page, for testers who prefer it to the floating window. |
| `system.display` | required | Reads monitor work areas so the floating window opens beside the browser, including on a second monitor, instead of off-screen. |
| `<all_urls>` | required (host) | A QA tool has to work on whatever site is under test, including intranet and staging hosts that cannot be listed in advance, so its page scripts are present on every site. They record nothing until the tester wakes that window and presses Start, and then only the focused tab. No data leaves the browser except on a button press that names the destination. |
| `cookies` | optional | Optional. The cookie editor and saved cookie profiles on the site under test; asked for the first time the tester opens it. |
| `desktopCapture` | optional | Optional. Records a window or the whole screen, asked for the first time the tester chooses one of those. |
| `nativeMessaging` | optional | Optional. The agent bridge: asked for only when the tester switches Agent bridge on in Settings, so a helper program the tester installed can answer read-only questions about their own sessions for their coding agent. Handed back when it is switched off. |

Remote code: none (all code ships in the package; axe-core is vendored). Data: nothing is collected by the developer; sessions stay in the browser profile.
