# Firefox Add-ons (AMO): permission justifications for QA Wrap 3.7.1

Read from the built `dist/firefox/manifest.json`; every permission the package declares has a row. Copy a row into the store's per-permission box.

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
| `activeTab` | required | Reads the URL and title of the tab the tester invoked the extension on. |
| `webRequest` | required | Observation only, never blocking: reads six security headers (CSP, HSTS, CORS, X-Frame-Options, Referrer-Policy, Permissions-Policy) off each response while a session records, so the fine-print check can report on them. Nothing is modified, redirected or delayed. |
| `<all_urls>` | required (host) | A QA tool has to work on whatever site is under test, including intranet and staging hosts that cannot be listed in advance, so its page scripts are present on every site. They record nothing until the tester wakes that window and presses Start, and then only the focused tab. No data leaves the browser except on a button press that names the destination. |
| `cookies` | optional | Optional. The cookie editor and saved cookie profiles on the site under test; asked for the first time the tester opens it. |
| `nativeMessaging` | optional | Optional. The agent bridge: asked for only when the tester switches Agent bridge on in Settings, so a helper program the tester installed can answer read-only questions about their own sessions for their coding agent. Handed back when it is switched off. |

Remote code: none (all code ships in the package; axe-core is vendored). Data: nothing is collected by the developer; sessions stay in the browser profile.

`data_collection_permissions` in the Firefox manifest: required = none (nothing needs to leave the machine for the extension to work); optional = websiteContent, websiteActivity, authenticationInfo (only when the tester presses File/Send to a tracker or webhook they configured).
