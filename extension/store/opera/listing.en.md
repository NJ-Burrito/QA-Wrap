# Opera add-ons: listing text (English) for QA Wrap 3.9.2

Paste each block into the field named above it. Source of truth: `tools/store-packs-text.mjs`.

- **Name:** `QA Wrap`
- **Category:** Web Development
- **Privacy policy URL:** https://nj-burrito.github.io/QA-Wrap/privacy.html
- **Support URL:** https://github.com/NJ-Burrito/QA-Wrap/issues
- **Website / homepage:** https://nj-burrito.github.io/QA-Wrap/
- **Licence (if asked):** MIT
- **Price:** free

## Short description / summary (one sentence)

```
Free, local bug-report recorder for testers: each failure is linked to the click behind it, then filed to Jira in one press.
```

## Long description

```
You find a bug, and then you spend time rebuilding how you got there: the steps, the screenshot, the console, the request that failed. QA Wrap does that part while you test.

Record, explain, hand over.
- Record: wake it on the site you are testing, name what you are testing, press Start. It keeps your clicks, typing and navigation, the page's requests and the console in one timeline.
- Explain: when something fails it shows the click that caused it. Press Stop and the report is ready: a headline, the cause-and-effect chain, the screenshots, accessibility and speed findings, and a timeline you can scrub.
- Hand over: copy the report as Markdown, save it as files in a folder you choose, or file it to Jira with the project's own fields. Nine other trackers and seven chat destinations are there too, each only when you set it up and press the button.

New in 3.9.1
- Profile tab and top-bar chip: Profile has its own tab in Settings, with your name in English and in Arabic. Your picture and name show at the end of the top bar, in the language you use QA Wrap in. The picture stays on your computer.
- Network filter: the timeline no longer drowns in background noise (analytics beacons, blocked ad tags, cancelled requests, favicon and font misses). It is folded behind one line that counts it, never deleted, and every export keeps every request. A failure on your own site, a failure right after your action and a failed signed-in request are never hidden.
- Click labels: a recorded click carries the name of the button pressed, such as Clicked "Save" (button). Emails, phone numbers, card numbers and long digit runs are removed, and nothing is read from fields or passwords. One switch turns it off.

New in 3.9.0
- Your profile: set a name and, if you like, a picture. Every file you export ends with one small line (name, date, QA Wrap version) so the work can be traced to you. The name and picture stay on your computer.
- Sealed timeline: both download options can include the whole timeline as a readable Markdown file with your profile in it and a seal at the end. Verify file says whether it is intact or altered, and whose it is. The seal is tamper-evidence, not secrecy: the text stays readable, and anyone can edit a file and seal it again with their own key (the key fingerprint then differs).
- Performance indicators (KPI): a dashboard of time spent testing, page coverage and bugs filed per day and week, counted only from your own sessions on this device and only from notes you filed as a bug. Export it as a PDF.
- Films: an Arabic cut of the 40-second film and six short tutorials in English and Arabic, hosted on the website. Nothing loads until you press a link.

What it does not do
- It never uploads anything of its own. No server, no analytics, no remote code. Data leaves only when you press a button that names where it goes.
- It does not record password fields or cookie values into a session or an export.
- It can read every site from install (the browser says so on the install dialog), but it records only after you wake a window and press Start, and only for the focused tab.
- Finished sessions are deleted after 30 days by default; you can choose one day to a year, or never.

Also in the box: page harvest with verified locators and a Playwright page object, link checking, designed form values, request breaking, an accessibility scan (axe-core, bundled), Core Web Vitals, right-to-left and text-expansion stress (Arabic is a first-class case), screenshots and recordings with mark-up and redaction, a cookie editor, and exports to Markdown, JSON, HAR, Postman, JUnit and Excel.

Free and open source under the MIT licence. Interface in English and Arabic. Source: https://github.com/NJ-Burrito/QA-Wrap
```

## What's new in this version (short field, if the form has one)

```
Profile in its own Settings tab and in the top bar, a network filter that hides background noise but never a real failure, and click labels.
```

## Notes for the moderators (if the form has a free-text box)

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
