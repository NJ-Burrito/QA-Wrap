# Chrome Web Store listing: QA Wrap

Working copy of everything the developer console asks for. Paste from here;
keep this file as the source so the listing and the product say the same thing.

## Product details

**Name** (45 max): `QA Wrap`. Store title, once the trademark check is clean: `QA Wrap: bug reports for testers` (32 characters).

**Summary** (132 max, 124 used; Nader picks the final wording):
`Free, local bug-report recorder for testers: each failure is linked to the click behind it, then filed to Jira in one press.`

**Category:** Developer Tools · **Language:** English · **Made by:** Nader Alzghoul

**Description:**

You find a bug, and then you spend time rebuilding how you got there: the steps, the screenshot, the console, the request that failed. QA Wrap does that part while you test.

Record, explain, hand over.
- Record: wake it on the site you are testing, name what you are testing, press Start. It keeps your clicks, typing and navigation, the page's requests and the console in one timeline, across every tab in the window.
- Explain: when something fails it shows the click that caused it. Press Stop and the report is ready: a headline, the cause-and-effect chain, the screenshots, the accessibility and speed findings, and a timeline you can scrub.
- Hand over: a record of the session you can hand over, filed to Jira with the project's own fields, or to nine other trackers and seven chat destinations, or saved as files in a folder you choose.

What that looks like in numbers
- No time cap on a recording: it is bounded by your disk, not by a plan.
- Jira and nine other trackers (GitHub, GitLab, Azure DevOps, Linear, Trello, ClickUp, Asana, Shortcut, YouTrack), and seven chat destinations (Slack, Microsoft Teams, Mattermost, Discord, Google Chat, Telegram, a custom webhook), each only when you set it up and press the button.
- Finished sessions are deleted after 30 days by default on a fresh install; you can choose one day to a year, or never.

What it does not do
- It never uploads anything of its own. No server, no analytics, no remote code. Data leaves only on a button press that names where it goes: to a Jira site, tracker or webhook you configure, to the one host you type into the API tool (the request you wrote, with this profile's cookies for that host when you have granted site access), and to each link on a page you run the link checker on (no cookies).
- It does not record password fields or cookie values into a session or an export. The cookie editor's saved profiles do hold cookie values, on your machine, until you delete them.
- It installs with access to no website. It asks for the site you are on, when you wake it there, and you can take that back at any time.
- Asleep means no session records and no request hook is installed. On sites you have allowed, its page scripts stay loaded.
- It does not keep recordings for ever by default: on a fresh install finished sessions are deleted after 30 days, and the welcome page says so. Zero keeps everything.
- Code coverage needs Chrome's debugger permission, which Chrome shows at install; it is off until you press Measure.

Also in the box: page harvest with verified locators and a Playwright page object, link checking, designed form values, request breaking, an accessibility scan (axe-core, bundled), Core Web Vitals, RTL and text-expansion stress (Arabic is a first-class case), screenshots and recordings with mark-up and redaction, a cookie editor, and exports to Markdown, JSON, HAR, Postman, JUnit and Excel.

**Team use:** QA Wrap is free for a tester or a team to install. For a managed rollout, a policy file, or questions about the vendor-risk pack, write to the developer contact on the Chrome Web Store listing.

Every tool explains itself in plain words under the button. Every shortcut is re-bindable.

It is built to the ISTQB Foundation shape: the tools are arranged as the test activities, and the outputs are the documents the standards name, defect reports and test cases to ISO/IEC/IEEE 29119-3 among them.

## Single purpose

**QA Wrap has one purpose: to record a browser test session on the site the tester is testing, explain what failed, and hand over a record of that session.** Every permission below serves that one purpose. The recording, the correlation of a failure with the action that caused it, the accessibility and speed checks, the documents and the filing are all steps of that single job. There is no second feature, no unrelated content injection, no advertising, no data collection of any kind for anybody but the tester.

The one line for the console's single-purpose field:

`Record a browser test session, explain what failed, and hand over a record of it: a timeline, the cause of each failure, and the standard test documents.`

## Permissions, one row each

Everything the manifest declares. The optional half is not held on installation: Chrome asks for it the first time it is needed, and the tester can refuse or take it back.

| Permission | Required or optional | What it is for, in one sentence |
|---|---|---|
| `storage` | required | Keeps sessions, settings and reports in the browser profile. |
| `unlimitedStorage` | required | A long session with recordings exceeds the default quota. |
| `activeTab` | required | Reads the URL and title of the tab the tester invoked the extension on. |
| `tabs` | required | Follows the tabs of the window under test and opens the extension's own report and settings pages. |
| `scripting` | required | Puts the in-page tools into the page under test, and registers the page scripts against the sites the tester has allowed. |
| `webNavigation` | required | Records navigations, the HTTP status of the page itself, and the frame tree a locator inside an iframe needs. |
| `webRequest` | required | Reads six security headers off each response while a session is recording and only on sites you have granted access to, and never blocks, modifies or redirects anything. |
| `cookies` | **optional** | The cookie editor and the saved cookie profiles on the site under test. |
| `contextMenus` | required | The right-click entries that start a recording, copy a locator or add a note. |
| `clipboardWrite` | required | Copies a Playwright locator to the clipboard. |
| `alarms` | required | The daily purge of sessions older than the retention period you set, which must run even while the service worker is suspended. |
| `downloads` | required | Saves exports into the folder the tester chose. |
| `notifications` | required | Tells the tester when a session is saved, a recording starts or stops, and the extension sleeps. |
| `offscreen` | required | Encoding recordings and GIFs needs a document, which a service worker does not have. |
| `sidePanel` | required | The docked workbench beside the page, for testers who prefer it to the popup. |
| `tabCapture` | required | Records a video of the tab when the tester presses Record. |
| `debugger` | required | Code coverage needs Chrome's debugger permission; it is off until you press Measure. |
| `system.display` | required | Reads monitor work areas so the floating window opens beside the browser (or falls back cleanly) instead of landing off-screen on a second monitor. Chrome shows no install-time warning for it. |
| `desktopCapture` | **optional** | Records a window or the whole screen, asked for the first time the tester chooses one of those. |
| host permission `<all_urls>` | **optional** | The *All sites* choice on the wake card, for a tester who works across many hosts; nothing is held at install and access is asked for per site at the moment of use. |

## Permission justifications

Copy each into the console's per-permission field.

- **storage, unlimitedStorage**: Sessions, screenshots and recordings are stored locally in the browser profile. A long session with recordings can exceed the default quota.
- **activeTab, tabs**: To read the URL and title of the page under test for the session, and to open the extension's own report and settings pages.
- **scripting**: To inject the in-page tools (locator picker, value palette, layout stress, coverage measurement) into the page the tester is testing, on demand.
- **webNavigation**: To record navigations in the session timeline and the HTTP status of the page itself, which no page-level hook can see, and to read the frame tree so that a locator copied from inside a cross-origin iframe carries the frameLocator chain that reaches it. No frame can see that chain from the inside.
- **webRequest**: To read six security headers off each response while a session is recording and only on sites you have granted access to: Content-Security-Policy, Strict-Transport-Security, Access-Control-Allow-Origin, X-Frame-Options, Referrer-Policy and Permissions-Policy. The fine-print check reports on all six, and none of them can be read any other way: a cross-origin response exposes only CORS-safelisted headers to a page's own script, and the document's own response never passes through one. Observation only, never blocking: nothing is modified, redirected or delayed, no other header is kept, values are cut at 512 characters, and the listener is attached only while a session is running and only for the window that session covers.
- **cookies**: The cookie editor: viewing, editing, exporting and switching cookie profiles on the site under test.
- **contextMenus**: The right-click menu entries (copy a locator, add a note, capture).
- **clipboardWrite**: Copying a Playwright locator to the clipboard.
- **alarms**: The daily purge of sessions older than the retention period you set, which must run even while the service worker is suspended.
- **downloads**: Saving exports into the folder the tester chose.
- **notifications**: A system notification when a session is saved (naming the folder), when a recording starts or stops, and when the extension goes to sleep. On by default, off in Settings ("systemNotifications"). Nothing in it is sent anywhere: the product is local-first.
- **sidePanel**: The docked workbench: the same tool list beside the page, for testers who prefer it to the floating window.
- **offscreen**: Encoding screen recordings and GIFs requires a document; the service worker has none.
- **tabCapture, desktopCapture**: Recording the tab, a window or the screen when the tester presses Record.
- **debugger**: Code coverage needs Chrome's debugger permission. The debugger is attached to a tab only when the tester presses Measure, and detached when the run ends. Nothing attaches it on its own.
- **system.display**: Reading monitor work areas so the floating window can open beside the browser and reopen where it was left, including on a second monitor, instead of landing off-screen. Chrome shows no install-time warning for it.
- **desktopCapture (optional)**: Recording a window or the whole screen, which is how a native file dialog or a second window the flow opened is captured. Asked for the first time the tester chooses one of those, never at install, and refusable.
- **nativeMessaging (optional)**: The agent bridge. Asked for only when the tester switches **Agent bridge** on in Settings, and handed back when it is switched off. It lets a small helper program the tester installed themselves answer read-only questions about their own sessions for their coding agent. The helper is the only recipient, and it answers only when the tester's agent asks.
- **Optional host permissions `https://api.anthropic.com/*`, `https://api.openai.com/*`, `https://openrouter.ai/*`**: AI writing, off by default. The tester picks one provider and pastes their own key; the browser is asked for that one host the first time they press Suggest, and only then is the masked report text they asked to be improved sent to it. Never at install, never in the background, refusable.
- **Optional host permission `<all_urls>`**: The extension declares **no** `host_permissions` and **no** `content_scripts`, so it installs with access to no website and injects nothing anywhere. Access is asked for **per site, at the moment of use**: pressing "Wake up" asks Chrome for the origin of the tab the tester is on (`https://host/*`, scheme and host, no wider), inside the click. `<all_urls>` is declared optional because a QA tool must be able to work on whatever site is under test, including intranet and staging hosts that cannot be listed in advance, and a tester who works across many of them can press "All sites" once instead of answering a dialog per host. That press is theirs to make and theirs to take back in Chrome's own extension settings. Where a site has not been allowed, every tool refuses with one sentence rather than acting: "QA Wrap is not allowed on this site yet. Wake up here to allow it."
- **Remote code:** none. All code ships in the package; axe-core is vendored.

## First-run disclosure and consent

The extension opens one page on installation, in Arabic and English, and the popup offers nothing but that card until it is accepted: what is stored and where (locally, in the browser profile), what a recording captures, what masking does, that the extension starts with access to no site and asks for one site at a time, and the microphone consent line. The acceptance is recorded as `consentedAt` and `consentVersion` in `chrome.storage.local`, and Settings has "Show the welcome page again".

For a managed deployment, `managed-schema.json` carries `hostPermissionsPolicy` (`ask`, `all`, `none`) beside `microphoneAllowed`. It decides what the wake card may offer and grants nothing by itself, because Chrome gives an administrator no way to hand a host permission to an extension.

## Privacy

- Privacy policy: the address is `urls.privacy` in `brand/brand.json` (empty today) and must serve the text of `PRIVACY.md`, which also ships in the package. **TODO(nader): publish that page and set the address before the submission. The store checks it.**
- Terms of service: `urls.terms` in `brand/brand.json` (empty today); the text is `TERMS.md`, which also ships in the package. Same rule: the page has to exist before the submission.
- Data use disclosures: collects **website content** and **user activity** (clicks, typing, navigation on the page under test) and **authentication information**: the tokens the user pastes for trackers, and cookie values and request headers (such as Authorization) that the cookie editor and the API tool save on the user's machine. It leaves the machine only on a user action that names where it goes: filing or sending a report, a request in the API tool (which can carry cookies for its host), or a link-checker run (no cookies). Not sold, not used for unrelated purposes, not for creditworthiness or lending. Collection happens only on a site the user has allowed the extension onto, in a window they have woken, and after the first-run notice has been accepted.

## Assets

| Asset | Size | Source |
|---|---|---|
| Store icon | 128×128 | `icons/icon128.png` |
| Screenshots (up to 5) | 1280×800 | `node tools/store-shots.mjs` → `store/shots/` |
| Small promo tile | 440×280 | `store/promo-440x280-<version>.png` (from `store-shots.mjs`) |
| Marquee promo tile (optional) | 1400×560 | `store/promo-1400x560-<version>.png` (from `store-shots.mjs`) |

Screenshots, in order (T-058, `node tools/ui-shots.mjs` then `node tools/store-shots.mjs`, one run per release): the report with a real failure and the click before it (the hero, never "Passed"); the popup mid-session; the bar with the problems chip; the value palette on a form; the filing dialog. English set shot 1 Oct 2026; the Arabic set is shot after the Arabic listing pass (T-076 promotion gate).

Website: https://nj-burrito.github.io/QA-Wrap/ · Contact: naderalzghoulbusiness@gmail.com
