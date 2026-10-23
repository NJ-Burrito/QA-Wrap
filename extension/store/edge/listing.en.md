# Microsoft Edge Add-ons: listing text (English) for QA Wrap 3.8.0

Paste each block into the field named above it. Source of truth: `tools/store-packs-text.mjs`.

- **Name:** `QA Wrap`
- **Category:** Developer Tools
- **Privacy policy URL:** https://nj-burrito.github.io/QA-Wrap/privacy.html
- **Support URL:** https://github.com/NJ-Burrito/QA-Wrap/issues
- **Website / homepage:** https://nj-burrito.github.io/QA-Wrap/
- **Licence (if asked):** MIT
- **Price:** free

## Short description / summary (max 132, taken from the manifest)

```
Free, local bug-report recorder for testers: each failure is linked to the click behind it, then filed to Jira in one press.
```

## Long description (250 to 10,000 characters)

```
You find a bug, and then you spend time rebuilding how you got there: the steps, the screenshot, the console, the request that failed. QA Wrap does that part while you test.

Record, explain, hand over.
- Record: wake it on the site you are testing, name what you are testing, press Start. It keeps your clicks, typing and navigation, the page's requests and the console in one timeline.
- Explain: when something fails it shows the click that caused it. Press Stop and the report is ready: a headline, the cause-and-effect chain, the screenshots, accessibility and speed findings, and a timeline you can scrub.
- Hand over: copy the report as Markdown, save it as files in a folder you choose, or file it to Jira with the project's own fields. Nine other trackers and seven chat destinations are there too, each only when you set it up and press the button.

What it does not do
- It never uploads anything of its own. No server, no analytics, no remote code. Data leaves only when you press a button that names where it goes.
- It does not record password fields or cookie values into a session or an export.
- It can read every site from install (the browser says so on the install dialog), but it records only after you wake a window and press Start, and only for the focused tab.
- Finished sessions are deleted after 30 days by default; you can choose one day to a year, or never.

Also in the box: page harvest with verified locators and a Playwright page object, link checking, designed form values, request breaking, an accessibility scan (axe-core, bundled), Core Web Vitals, right-to-left and text-expansion stress (Arabic is a first-class case), screenshots and recordings with mark-up and redaction, a cookie editor, and exports to Markdown, JSON, HAR, Postman, JUnit and Excel.

Free and open source under the MIT licence. Interface in English and Arabic. Source: https://github.com/NJ-Burrito/QA-Wrap
```

## Search terms (max 7 terms, 30 characters each)

bug report, QA testing, test recorder, Jira, accessibility check, Playwright locator, ISTQB

## Notes for certification

```
QA Wrap is a free, MIT-licensed, local-first QA tool. It needs no account and has no server.

How to try it in two minutes (no login):
1. Open https://nj-burrito.github.io/QA-Wrap/try/ (a practice page we host).
2. Click the QA Wrap toolbar button, accept the welcome notice, press Wake up, then Start.
3. Use the form on the practice page (fill a field, press Save changes), then press Stop in the toolbar popup.
4. The report shows the session timeline with each click and any failure beside the action that caused it. Press Copy report.

Why the broad host permission: A QA tool has to work on whatever site is under test, including intranet and staging hosts that cannot be listed in advance, so its page scripts are present on every site. They record nothing until the tester wakes that window and presses Start, and then only the focused tab. No data leaves the browser except on a button press that names the destination.
Remote code: none. Every script ships in the package; axe-core is vendored. No analytics, no telemetry, no server of ours.
Network: the extension makes no request of its own. The only egress is a button the tester presses to file or send a report to a tracker or webhook they configured, or a request they wrote in the API tool.
Source: https://github.com/NJ-Burrito/QA-Wrap (public). The package is the plain, unminified source; no bundler or minifier is used.
```
