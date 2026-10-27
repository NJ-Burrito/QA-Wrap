# QA Wrap

> Every failure, traced.

**v3.5.3** · A local-first, session-aware Chrome MV3 extension, built to the
ISTQB CTFL shape. Amman edition: the QA Wrap mark, the
owner's seal, Thmanyah (Sans and Serif Display) embedded, three theme states, and the workbench in a side
panel that stays open. Privacy policy in `PRIVACY.md`, security notes in `SECURITY.md`. Supported browsers: **Chrome and Edge**.

Record, explain, hand over. It records what a tester does in the browser, correlates it with network and console,
designs the values worth testing, measures which code actually ran, and exports the
artefacts the syllabus names (test cases, defect reports, suites) plus verified
Playwright locators and a Postman collection.

Research behind the design: `../research/`. Scope rationale: `../research/05-gap-analysis.md`.
QA pass and known issues: `../research/07-qa-report.md`.

## Install (development)

```
chrome://extensions  →  Developer mode ON  →  Load unpacked  →  select this folder
```

**It installs with access to no website.** There is no `host_permissions` and no
`content_scripts` in the manifest, so nothing of QA Wrap's is in any page until
you let it in. The first thing it does is open the welcome page, in Arabic and
English; read it and accept it, because nothing else is offered until you have.

## Use it

Click the QA Wrap icon. The popup walks you through it:

1. **Wake up on the page you are testing.** Chrome does not ask again: the
   `<all_urls>` access was granted at install, and nothing is captured until you
   wake the window. Sleeping does not revoke it; Chrome's own extension settings
   (*Site access*) take it back.
   Waking also puts the page scripts into the tabs already open in that window,
   so you do not have to reload; a tab in another window picks them up when it
   is allowed and next navigates.
2. **Name what you are testing.** This becomes the report title.
3. **Start recording**, then use the page as a tester would.
4. **Stop & review.** Press **Open the report** to read it straight away, or save a
   session sheet, Markdown report, Playwright spec or JSON to disk.

There is no time limit on anything. Recording runs until you stop it; the only real
limit is the disk, and the popup reports how much is left rather than cutting you off.
While recording, tag what you notice as a **bug**, an **issue** or a **question**; those
land in their own sections of the session sheet.

The tools are laid out as the **seven ISTQB test activities**, in process order, and each
one shows whether you have used it *on this run*, so "have I checked accessibility on
this one, or am I thinking of the last one?" is a question the screen answers. The meter
under the switch is coverage of those seven activities, never a score.

The DevTools **QA Wrap** tab shows the full timeline while you work.

### Shortcuts

Every shortcut is re-bindable. Open **Settings** with the ⚙ in the popup header.

| Default | Does |
|---|---|
| `Alt+S` | Copy a locator: click any element |
| `Alt+E` | Edge-case values for the focused field |
| `Alt+D` | Stress the layout (RTL + text expansion) |
| `Alt+N` | Quick note, taggable as bug / issue / question |
| `Alt+C` | Screenshot into the session |
| `Alt+A` | Accessibility scan |

Browser-level shortcuts, set in `chrome://extensions/shortcuts` and shown there:

| Default | Does |
|---|---|
| `Alt+Shift+Q` | Start or stop a QA session |
| `Alt+Shift+S` | Pick an element and copy its Playwright locator |
| `Alt+Shift+E` | Edge-case values for the focused field |
| `Alt+Shift+V` | Record a video of this tab |

Those are QA Wrap's own in-page shortcuts: click one in Settings, press the keys you
want, done. They are stored as physical key **codes**, so they keep working on an
Arabic keyboard layout where the character on the key is different.

Chrome's *global* shortcuts (which fire even when the page is not focused) are a
separate list, because an extension is not permitted to set them. Settings shows what
they currently are and links to `chrome://extensions/shortcuts` to change them.

### Everything is a range, not a fixed choice

Text expansion (0–200%), correlation window, typing
debounce, forced-delay length, how many requests a break-rule applies to,
timeline row cap and screenshot width: all sliders, all persisted, all synced
across your machines via `chrome.storage.sync`.

## What is built

| # | Feature | What shipped |
|---|---|---|
| 1 | Session recorder + unified timeline | all of it |
| 2 | One-click defect artefact (Markdown / JSON) | all of it |
| 3 | Selector picker: Playwright-first, uniqueness-verified | all of it |
| 4 | RTL / i18n stress mode | all of it |
| 5 | Context-aware edge-case data injector | all of it |
| 6 | Request override / mock | all of it |
| 7 | Accessibility scan (vendored axe-core) | all of it |
| 8 | Charter / SBTM session log | tagged notes, task breakdown, session sheet |
| 9 | Cookie & storage editor | values, flags, expiry, localStorage, sessionStorage, jar import/export |
| 10 | Customisable shortcuts + settings page | re-bindable keymap, ranges, privacy pattern |
| 11 | Page speed: Core Web Vitals and network timing | LCP, CLS, INP, FCP, TTFB, requests, slowest calls, long tasks |
| 12 | Integrations: Jira, Slack, GitHub/GitLab/Azure/Linear/Trello/ClickUp/Asana/Shortcut/YouTrack, TestRail/Xray | four ticket formats; Jira and Slack are opt-in |
| 13 | Right-click menu, matched to context | twelve entries, each scoped to what is under the cursor |
| 14 | Request manipulation: redirect, headers, compose | rules stack; modifiers and terminal actions are separate |
| 15 | Accessibility audit: rule browser and guided checks | 105 rules, run any subset, 12 manual checks filed as notes |
| 16 | Visual report: six tabs, each answering one question | verdict, cards, activity chart, cause-and-effect, media gallery |
| 17 | Screen recording, with no time limit | MP4 / WebM / GIF, bounded only by disk |
| 18 | Filed output: category tree, dated names | to a folder you pick, or Downloads |
| 19 | Master switch: asleep until woken, per window | no session records and no request hook is installed until you say so; page scripts stay loaded on sites you allowed |
| 20 | Per-session state: every run starts from defaults | rules, stress and filters belong to one session |
| 21 | Markup: arrows, boxes, text, blur, crop | on any screenshot, with destructive redaction |
| 22 | Mic, tab sound and webcam in a recording | composited into one track, each refusal reported |
| 23 | Night and light, on every surface | three states: light, night, follow the machine |
| 24 | Every tool explains itself, in plain words | what it does and why, under the tool it explains |
| 25 | ISTQB test cases and defect reports | ISO/IEC/IEEE 29119-3 shape, severity and priority kept apart |
| 26 | Jira filing with discovered linking | projects, types, epics, stories, read from your site |
| 27 | Chat and bots | Slack, Teams, Discord, Google Chat, or any endpoint |

## Verification

```
node tools/diagnose.mjs      # run against the REAL database, with the current worker
npm run test:full            # every suite in the chain, headed ones included (the by-hand suites are left out)
npm run test:headed          # the chain plus the by-hand suites (live Jira, boot smoke, truth, plan run); one headed run at a time
node tools/test.mjs          # 27 unit assertions over the correlation/export logic
node tools/test-settings.mjs # 16 unit assertions over bindings, ranges and storage
node tools/test-formats.mjs  # 20 unit assertions over the four ticket formats
node tools/test-rules.mjs    # 18 unit assertions over the request-rule engine
node tools/test-gif.mjs      # 11 assertions over the GIF encoder, decoded by a real browser
node tools/test-exporters.mjs # 12 assertions over HTML, text, JUnit, HAR and YAML
node tools/test-istqb.mjs    # 27 assertions over the test case and defect report
node tools/test-notify.mjs   # 23 assertions over the chat and bot layer
node tools/smoke.mjs         # 32 end-to-end assertions, local fixture, real Chromium
node tools/ui-shots.mjs      # screenshots of every surface, light and dark
node tools/scroll.mjs        # frame intervals through every surface
node tools/paint-cost.mjs    # paint + raster work per scroll, two builds compared
node tools/launch.mjs        # open a browser with QA Wrap loaded, ready to use
node tools/package.mjs       # zip for the Chrome Web Store
node tools/generate-icons.cjs
```

## Page speed (feature 11)

"Check page speed" in the popup reads the live page and records a `perf` event into the
session, rendered as a block in the panel and carried into every export.

| Reported | From |
|---|---|
| LCP, CLS, INP | `PerformanceObserver`, rated against the web.dev good / needs-work / poor thresholds |
| FCP, TTFB | paint and navigation timing |
| Requests, bytes, cache hits, slowest six | resource timing |
| Long tasks | `longtask` observer |

**This is not a Lighthouse run, and the UI says so.** Lighthouse drives its own page load
in a controlled environment; an extension cannot. What this measures instead is the page
the tester is standing on, in the state they put it in: logged in, mid-flow, real network,
real data. For QA that is usually the more useful number, and it is the only one available
on a screen you cannot reach from a cold URL.

## Integrations (feature 12)

| Format | For | Leaves the machine |
|---|---|---|
| Jira wiki markup | pasted into a Jira ticket | no |
| Markdown issue | GitHub, GitLab, Linear, Azure DevOps, Shortcut, YouTrack | no |
| Timeline CSV | TestRail, Xray, a spreadsheet | no |
| ADF over REST | "File to Jira" on the report page | **yes, opt-in** |
| Block Kit over a webhook | "Post to chat" on the report page (Slack is one destination) | **yes, opt-in** |

Slack uses an **incoming webhook**, not a bot token: it needs no OAuth, it can
only write to the one channel it was created for, and it cannot read anything.
That is the smallest permission that does this job. It posts a summary of the cause,
the counts, the first eight repro steps and the environment, rather than the whole
report, because
Slack truncates long blocks and a wall of text in a channel gets scrolled past.

Everything is a clipboard transform or a file, so the local-first promise holds by default.
The one exception is the Jira button, and it is built to be obviously exceptional: hidden
until Settings → Integrations is filled in, gated behind a confirmation naming the site it
will post to, and the settings card states plainly that the API token sits in the browser
profile, syncs with Chrome if sync is on, and is readable by anyone with the profile.

Masked values stay masked in all four formats. `tools/test-formats.mjs` asserts it.

## Right-click menu (feature 13)

The menu matches what is under the cursor, rather than listing every tool on
every context. Chrome shows only the entries whose context fits:

| Right-click | What appears |
|---|---|
| anything | Copy Playwright locator |
| a form field | Insert an edge-case value |
| a link | Make this URL fail / return 500 / go slow |
| selected text | Add as a note, or as a bug |
| the page | Start/stop recording, page speed, accessibility, layout stress, open the report |

Two implementation notes. Chrome's `contextMenus.onClicked` carries the page,
the link and the selection but **never the element**, so the content script
remembers the last `contextmenu` target, in the capture phase, because an app
with its own right-click menu would otherwise hide it. And every entry calls the
same handler the popup does; a second implementation of "start recording" is how
the two end up doing different things.

## Request manipulation (feature 14)

| Action | What it does |
|---|---|
| `status` / `body` | Replace the response. Any status, any body, any content type |
| `fail` | Kill the connection: a `TypeError` for fetch, an `error` event for XHR |
| `delay` | Hold the request, then let it through |
| `redirect` | Send it elsewhere. `$1`–`$9` capture groups when the pattern is a regex |
| `headers` | Add, replace or remove request headers. Empty value removes |
| `responseHeaders` | Override what the page sees on a replaced response |

**Rules compose.** All matching rules apply their modifiers in order; the first
terminal action (`fail`, `status`, `body`) wins and stops the request. Two
terminal actions do not stack, since that would only be an argument about which 500
to send. A single-rule model could not express "send this header *and* make it
fail", which is most of what request manipulation is actually used for.

Redirects for XHR happen in `open()`, not `send()`: by `send()` the connection
is already pointed somewhere. Header removal on XHR blanks rather than deletes,
because there is no `removeRequestHeader`, and the UI says so.

## Accessibility audit (feature 15)

Two halves, because automated checking only ever covered one of them.

**The rule browser.** All 105 axe rules, filterable by WCAG level or category,
run any subset. "Scan everything" answers *is this page compliant*; it does not
answer *does this dialog trap focus*, which is what someone auditing a screen is
usually asking. Every finding gets a **Show me** button that scrolls the element
into view and rings it.

**Twelve guided checks**, for what axe cannot decide: keyboard-only operation,
visible focus, focus order, keyboard traps, whether alt text carries meaning,
heading structure, link purpose out of context, error recovery, 400% zoom,
reduced motion, declared language and direction, and time limits. Each carries
the method, not just the criterion. Answers file into the session as tagged notes
(a failure becomes a bug, an "unsure" becomes a question), so they land in the
report, the session sheet and the ticket with everything else.

Roughly half of WCAG is not machine-decidable. A tool that stays silent on that
half leaves testers believing a clean scan means a compliant page.

## The report (feature 16)

The old report was one `<pre>` holding the entire Markdown export. Everything
was in there, which was the problem: finding one fact meant reading all of them.

It is now six tabs, one question each:

| Tab | Answers |
|---|---|
| **Overview** | the verdict, six counters, an activity chart, and the headline in one sentence |
| **What broke** | each failure as a card: what you did → what happened, with the locator and the screenshot |
| **Timeline** | everything on a rail, colour-coded and filterable by kind |
| **Screens & video** | a gallery of cards you can play, save individually, or delete |
| **Quality** | page speed and accessibility, which a different person reads |
| **Raw export** | the text artefact, unchanged, in any of the seven formats |

Nothing was removed: the raw tab *is* the old page. Two details worth keeping:
the export is built **lazily**, so opening the report no longer pays to serialise
a whole session into Markdown for a tab nobody opened; and the activity chart is
hand-drawn SVG, because shipping a charting library to draw sixty rectangles
would cost more than the rest of the page put together.

## Recording and screenshots (feature 17)

| | Formats | Notes |
|---|---|---|
| Screenshots | PNG, JPEG, WebP | Chrome only ever hands back PNG or JPEG; anything else is re-encoded through a canvas in the offscreen document |
| Recordings | MP4, WebM, GIF | MP4 and WebM come from MediaRecorder; **GIF has no encoder in any browser**, so `core/gif.js` writes one, using median-cut quantisation and LZW, in about 200 lines |

**There is no time limit, by design.** The only real limit is the disk, so that
is what gets reported: the popup says how many minutes of video will fit before
you start, and keeps saying it while recording. A tester told "40GB free, about
6MB a minute" can decide for themselves; one cut off at ten minutes cannot.

Three things are worth knowing about the machinery:

- **A service worker has no DOM**, so it has no MediaRecorder and no canvas. All
  of it runs in an offscreen document, which the worker drives by message.
- **The finished Blob never crosses `chrome.runtime` messaging.** That channel
  serialises through JSON, so a Blob arrives as `{}`, silently, with no error.
  The offscreen document shares the extension's origin, so it writes to
  IndexedDB directly and the worker only hears an id.
- **Chrome will only capture a tab the user just invoked the extension on.** That
  gate is deliberate and not something to route around; what the extension owes
  the tester is a message saying what to do, which is what it now gives instead
  of Chrome's own wording about a permission name.

Recordings and stills live in a `media` object store (database v3) as Blobs, not
base64 in the event record, because a data URI is a third larger than the bytes it
carries, and the old one was re-read on every timeline render. Deleting a session
deletes its recordings, so deleting actually frees the disk.

## Where files go (feature 18)

Saving lays down a category tree and then only adds to it:

```
<your folder>/
  QA Wrap/
    Reports/          Tickets/       Tests/
    Session sheets/   Screenshots/   Recordings/
    Accessibility/
```

Names read `test title - dd-mm-yy hh-mm`, in local time, 24- or 12-hour by
choice. **Colons and slashes are illegal in filenames on every platform**, so the
requested `hh:mm` is written `hh-mm` and `dd/mm/yy` as `dd-mm-yy`, the closest
legal thing, and it still sorts correctly.

Two destinations, one tree. `showDirectoryPicker()` lets the tester grant any
folder, and the handle is kept in IndexedDB (a path string would not work, because an
extension never learns where the folder is). Without one, `chrome.downloads`
takes the same relative path and creates the directories itself, always under
Downloads. The fallback needs no permission at all, so it is the default.

**Save everything** on the report writes all seven formats plus every screenshot
and clip, each into the folder its reader will look in.

## The master switch (feature 19)

**Nothing is recorded until you wake it, and only where you woke it.** (On a site you have allowed, the page scripts stay loaded while it sleeps.)

This extension patches `fetch` and `XMLHttpRequest`, reads cookies and can
record the screen. That is a reasonable set of powers for a tool you asked to
watch you work, and an unreasonable one for a tool that is merely installed. So
there are two gates, not one, and they are different questions:

**May it be here at all?** That is the site permission, and the answer at
install time is no. The manifest declares no `host_permissions` and no
`content_scripts`; `<all_urls>` is listed under `optional_host_permissions` and
is not held. Pressing **Wake up** asks Chrome for the origin of the tab you are
on, inside the click, with *All sites* beside it as a choice you make rather
than one you inherit. The eight page scripts are then registered at runtime, by
`background/site-access.js`, against exactly the origins you granted: the
registration is recomputed from `chrome.permissions.getAll()` every time a grant
changes, so a revoked site takes its scripts with it. Every tool that reaches
into a page refuses anywhere else, in the same sentence: *QA Wrap is not allowed
on this site yet. Wake up here to allow it.*

**May it act?** That is the master switch, per window, and it is the older gate:

- The popup opens on the switch. Everything else is **disabled** rather than hidden.
  a control that looks available and then refuses is worse than one that plainly
  is not available yet.
- On a granted site the page scripts still load at `document_start` (the only
  moment early enough to see a page's first request) but the hooks do nothing at
  all: no recording, no rule matching, not even a timing measurement. One
  boolean per request. The MAIN-world request hooks go further and are only
  registered while a window is awake.
- Every worker handler that touches a page is refused at the seam, in one place,
  so a capability cannot forget to check.
- Arming lives in `chrome.storage.session`, which the browser wipes on close.
  Nobody has to remember to switch it off.

**Per browser window, not per extension.** A tester usually has the app under
test in one window and the ticket system, email and everything else in another.
Arming everywhere would instrument all of it, so a second window is a second
decision. Inside an armed window **every tab is covered**, which is the point of
arming a window rather than a tab. A flow that opens a payment window or an
OAuth hand-off stays recorded, and the timeline marks where it moved so the two
streams stay readable instead of interleaved.

Window ids are reused by Chrome, so a closed window drops its arming
immediately; otherwise the next window to inherit that number would be armed
without anyone asking.

## Per-session state (feature 20)

Everything a feature holds now belongs to **one session** and is cleared when
another starts. The bug this kills: state that outlives the session that created
it. A rule armed on Tuesday was still armed on Wednesday, layout stress left on
stayed on, and the next session inherited a browser the last one had quietly
reconfigured, all of which look like bugs in the app under test, which is the
worst possible failure for a tool whose job is to say what the app did.

Two consequences worth naming:

**Rules stack.** Arming a second no longer replaces the first. Each has its own
countdown and its own row in the popup, and a spent one stays listed so you can
see that it fired.

**The countdown lives outside the page.** A page keeps its own copy of the rules
and is destroyed on every navigation, so "break the next three requests" had
silently become "three per page load". The page now reports each firing and the
worker owns the budget.

## Recording has no limit (feature 17, revised)

History: the SBTM time-box was once an optional prompt to stop and review, and it never
limited anything. It has since been removed from every control (see Known limits), so
sessions run until stopped. A screen recording is limited only by the disk, and the popup says how many
minutes will fit before you start.

**Storage guard and capture limits (D-1010-129, D-1010-172).** The recording never stops, but four limits keep one session from filling the
disk, each counted per session after secrets are removed:

- **200,000 events.** After that, later events are not stored and are added to the lost count; the report shows one
  capture gap note (`session-cap`).
- **256 MiB of request and response bodies.** After that, events are still stored but without their bodies; one
  capture gap note (`body-cap`).
- **Under 200 MiB of free browser storage.** One warning note (`low-disk`) and nothing is stopped. The check runs at most
  once a minute while a session is live and uses no alarm.
- **8 MiB of page replay.** After that the replay stops with a truncation mark and the rest of the session is still recorded.

Each note is written once per session. The counts live in the worker's memory and start again from zero if Chrome
restarts the worker mid-session, so a very long session can pass a limit once more after a restart.

**Not recorded at all:** requests made from Web Workers and Service Workers. The page hooks wrap the page's own
`fetch` and `XMLHttpRequest`, which a worker does not share, so a request that starts in a worker has no row.

## Markup (feature 21)

Arrows, boxes, ellipses, lines, freehand, text, numbered steps, highlighter,
blur and crop, on any screenshot, from the report's gallery.

Shapes are kept as objects and the image is redrawn from the list on every
change, so undo drops an entry rather than restoring a bitmap and a mistake
three shapes ago is still recoverable.

**Blur is the exception, and it is destructive on purpose.** A black box drawn
over a customer's name is still a name to anyone who opens the file and deletes
the box. Blur replaces the pixels by downscaling and scaling back, rather than
`ctx.filter`, which bleeds pixels from outside the region inward and fragments
of the hidden text outward.

## Mic, tab sound and webcam (feature 22)

| Source | How |
|---|---|
| Tab video | `tabCapture`, always |
| Tab sound | same stream, and **echoed back** so capturing does not mute the tab for you |
| Microphone | its own `getUserMedia`, so a refused mic does not also cost you the camera |
| Webcam | composited as a circular inset onto a canvas, because MediaRecorder takes exactly one video track |

Every refusal is reported by name: recording silently without the microphone
someone ticked is how a narrated walkthrough turns out to be silent, discovered
on playback. A GIF cannot carry sound at all, and says so rather than dropping
it quietly.

## Every file type (feature 16, revised)

| | Formats |
|---|---|
| Images | PNG, JPEG, WebP, AVIF, BMP: **whichever this browser can actually encode** |
| Video | MP4, WebM, Matroska, GIF |
| Text | Markdown, HTML, plain text, JSON, YAML, CSV, JUnit XML, HAR, Jira wiki, GitHub Markdown, Playwright spec, SBTM sheet |

Maintained: Markdown, HTML report, JSON, HAR, Jira, GitHub Markdown, JUnit, Playwright spec, xlsx session sheet and Postman. Every other format sits in the picker under **More (not maintained)**: it still works, it is unticked by default, and it gets no fixes until someone asks for it.

Image and video support is **probed at runtime**, never assumed.
`canvas.toBlob('image/avif')` hands back a PNG on a browser without the encoder,
with no error, so a menu that lists AVIF because AVIF exists produces a file
named `.avif` that is not one. Only what survives the probe is offered.

## The popup, and why it is laid out this way

Two regions, and the split is the design.

**The topper never moves.** Who this is, whether it is awake, what it just said,
the theme control and the way out to the settings and the timeline. A tester
three screens down the tool list should still be able to see that the extension
is awake and read the last thing it told them.

**The body scrolls under it,** and is disabled rather than hidden while the
extension is asleep. A control that looks available and then refuses is worse
than one that plainly is not available yet. The explanations stay readable
either way, because reading about a tool is exactly what someone does before
deciding to wake it.

**Every tool carries its own explanation.** Press the name to use it, press the
`?` to read what it does. Two sentences: what it does, and why you would want
it, written for someone who has never used a QA tool. The old version put all of
that in a glossary at the bottom, which is a place people have to decide to visit.

## Night and light (feature 23)

Three states, one button: **light**, **night**, or **follow your machine**. The
identity tokens already answered all three: a bare `:root`, a
`prefers-color-scheme` block for an unstamped document, and a `[data-theme]`
block that beats both. So `ui/theme.js` only stamps the root and remembers the
choice.

Applied from `<head>`, before the stylesheet paints, and mirrored into
`localStorage`: a popup that opens light and then flips to night is worse than
one that simply opens night, and `chrome.storage` is async enough to flash.
Changing it on one surface tells the others, so an open report follows without a
reload.

## Arabic and English (feature 24)

Every surface a tester reads is in both languages, and the pair is the unit: a
key that exists in one table and not in the other fails `npm test`. Set it in
Settings, or cycle it from the popup header: **Automatic** follows
`chrome.i18n.getUILanguage()`, or name English or العربية. Arabic sets
`dir="rtl"` on the page and every stylesheet is written with logical
properties, so there is one set of CSS and it is correct in both directions.
The choice applies without a reload, on every open surface at once, and it
follows you to another machine. Numbers stay Western in Arabic, because every
number on screen has a twin in an exported report and those are ASCII.

Exports do not change language: a Markdown report, an ISTQB test case and a
Jira ticket are documents somebody else opens, and they stay as they are.

## ISTQB test cases and defect reports (feature 25)

The ISTQB Foundation syllabus does not define its own templates. It points at
**ISO/IEC/IEEE 29119-3**, and that is the shape both documents follow.

**The test case** carries an identifier, objective, preconditions, test data,
numbered steps with their own expected results, postconditions, priority, test
level, test type, environment and traceability. Set-up navigation becomes a
precondition rather than step one. Locators travel with the steps, so the case is
automatable as well as readable. It renders to Markdown, Jira ADF, and Gherkin.

**The defect report** carries expected *and* actual as separate fields, steps to
reproduce, environment, evidence, scope, lifecycle status and traceability.

The part that matters most, and the part tools usually get wrong:

> **Severity** is the impact on the system. **Priority** is the urgency of the fix.

They are independent axes. A typo on the sign-in page is trivial severity and can
be the highest priority; a crash in a year-end report is critical severity and low
priority until December. This tool always asks for both, derives a starting value
for each from different evidence, and **labels both as suggestions until a person
chooses**. A tool with one field for both teaches the wrong thing.

**It never presents a guess as a fact.** A recording shows what the application
*did*; only a person can say what it *should* do. So an expected result copied
from a recording is marked `observed`, a step whose observed result was a failure
is flagged, and any case containing either opens with a review warning that
survives into every rendering: Markdown, ADF and Gherkin alike. The Gherkin
header says outright that the steps describe what was done, not yet what the
system is for.

## Filing into Jira (feature 26)

Everything is **discovered, not assumed**, which is why most Jira integrations
break:

| Discovered | Why it cannot be hardcoded |
|---|---|
| Projects you can create in | Seeing a project is not permission to write to it |
| Issue types | A site may call it Test, Test Case, Xray Test, or nothing |
| Required fields per type | A required custom field is the usual cause of a 400 |
| Epics and stories | Searched live, open work only, filtered as you type |
| Link types | Xray and Zephyr each install their own; plain Jira has neither |
| The Epic Link field id | Commonly `customfield_10014`, but only commonly |
| Which Jira this is | Cloud and Data Center sign in differently, and neither says so |

**There are two Jiras, and they do not accept each other's credentials.**
Atlassian's hosted Jira, at `<site>.atlassian.net`, signs a request with your
email and an API token sent together as HTTP Basic. A self-hosted Data Center or
Server site signs it with a personal access token sent as a Bearer header, with
no email at all, and refuses the Cloud pair with a bare 401 that reads exactly
like a wrong password. Settings has a Sign-in choice that reads the site URL by
default and can be set by hand; the REST version and the description format
follow it, because Data Center has neither `/rest/api/3` nor Atlassian Document
Format. One module decides all of that, `core/jira-auth.js`, and every request
path in the product asks it.

**Epic linking is not one thing.** A team-managed project uses `parent`; a
company-managed one uses the Epic Link custom field. Picking wrongly gives
"Field 'parent' cannot be set", which reads as a bug in the tool rather than a
difference between two project styles. The project's style is read, the field id
is looked up, and both mechanisms are tried.

Links are made **after** the issue exists and each is reported separately. A
tester who filled in a defect report and hit a permissions error on the epic link
still has their defect report.

## Chat and bots (feature 27)

| Destination | Payload |
|---|---|
| Slack | Block Kit: header, fields, expected/actual, steps, link buttons |
| Microsoft Teams | MessageCard, the shape every connector still accepts |
| Discord | An embed, coloured by severity |
| Google Chat | Text inside its length cap |
| Anything else | A JSON body you write, with `{{placeholders}}` |

Add as many as you like. **Each can set a severity floor.** A channel that
receives every cosmetic finding is a channel people mute, and then the critical
one is muted too. A destination below its floor is reported as *skipped*, never
silently dropped.

Two details worth knowing. A **200 is not success**: Slack answers 200 and throws
the message away when the payload is wrong, so its literal `ok` is what gets
checked. And a webhook must be **https, or point at this machine**: loopback is
not a network, so an internal bot on 127.0.0.1 is fine; plain http to another
host would carry the report in the clear.

## Full-page screenshots and screen recording (features 28-29)

**A whole page**, not just what is on screen: the page is scrolled, photographed in
tiles, and stitched into one tall image. Two artefacts of that method are handled
rather than shipped. Fixed and sticky elements are hidden after the first tile, so a
navigation bar appears once instead of five times; and each tile is drawn at its *real*
scroll offset, because the last scroll is clamped by the document and placing it at
`index x height` repeats a strip of the page exactly where the footer is.

Chrome's `captureVisibleTab` is rate-limited, so tiles are paced and a rejection is
retried. A full-page shot that silently loses tile 7 is worse than one that takes an
extra second.

**The screen or another window**, not just this tab, through `desktopCapture`. Chrome
always shows its own picker, and the extension never chooses a source for you. This is
what catches a native file dialog or a second window the flow opened. Pressing Chrome's
own "Stop sharing" bar finishes the clip properly rather than leaving the recorder
encoding a dead stream.

## Designing the values (feature 30)

Click into a field and press **Read the field**. The tool reads what the field itself
declares (`type`, `min`, `max`, `maxlength`, `required`, `pattern`, `step`) and derives:

- **Equivalence partitions** (CTFL 4.2.1), split into valid and invalid, because the
  technique treats them differently: several valid partitions may share one test, while
  each invalid one needs its own or the first rejection masks the rest.
- **Boundary values** (CTFL 4.2.2), in the two-value and three-value forms. Two-value
  catches an off-by-one in the comparison; three-value additionally catches a boundary
  that was *moved* rather than mis-compared.

Press any value to put it straight into the field, through the events a framework
listens for. Assigning `.value` leaves React and every JSF postback believing the field
is still empty.

A field with **no declared limit** reports that as the finding, and marks its values as
neither valid nor invalid. Nobody knows which side of an undeclared limit they are on,
and claiming to would be the whole failure.

## Code coverage (feature 31)

Real V8 statement and function coverage of the page's own JavaScript, through Chrome's
debugger. **The permission is required** and the debugger
stays detached until you press Measure. Chrome will show a bar saying
QA Wrap is debugging. That is expected, and the popup says so before it appears.

Branch coverage is deliberately **not** reported: V8's block coverage cannot tell an
unexecuted `else` from an unexecuted early return, and a number that is nearly branch
coverage will be quoted as branch coverage.

Whatever the number, it says a line ran. It does not say the line is right.

## Suites: parent, sub-cases, sub-defects, relations (feature 32)

*Status: the suite splitter and the Jira filing are in the service worker; a suite button, decision tables, state models and the cross-browser project have no button in any surface yet.*

A session is almost never one test case. "Submit an application" is sign in, fill the
form, upload, submit: four things that fail independently and are assigned to different
people. The suite splits at the seams (a note you tagged `split` first, then a change of
page, never a hash or query change) and gives you:

- a **parent** carrying the objective, environment and traceability, with no duplicate
  steps of its own,
- **sub-cases** each marked `passed`, `failed`, or **`not-run`**, because a case that
  failed at step 14 of 30 says nothing about 15-30, and one verdict cannot report that,
- **sub-defects** attached to the segment that produced them, so triage can tell whether
  the upload is broken or the sign-in is,
- **typed relations**: `verifies`, `covers`, `found-by`, `blocks`, `duplicates`, and
  `relates-to` offered last on purpose.

Loops in `blocks` are refused before filing: a cycle there is a schedule that cannot be
satisfied, and it is otherwise discovered by a person, in a meeting, a week later.

Filing into Jira creates the tree **parent-first** and shows you the plan, how many
issues and of what type, before anything is sent.

## Postman (feature 33)

Every request the application made, as a **Collection v2.1** you can import. Requests
that differ only by an id collapse into one endpoint with `:id` as a path variable, and
each recording is attached as an example, so you see "this returned 200 four times and
500 once" rather than five identical rows.

The origin becomes `{{baseUrl}}` and the values go into a **separate environment file**.
That split is the point of the format: a collection with staging baked into forty
requests tests staging and nothing else, and it also means the collection is safe to
commit and the environment is not.

`Authorization` exports as `Bearer {{token}}` with the variable empty and marked secret.
A collection that ships someone's bearer token is a security incident with a filename.

## Cross-browser (feature 34)

A Chrome extension **cannot launch Firefox, WebKit, or a second Chromium.** It has no
way to start a process, and no permission unlocks one. Spoofing the user-agent would be
worse than useless: the engine is still Blink, so it would find no Safari bugs while
hiding that Safari is untested.

So there are two real things instead:

- **A window at a named size**: phone, tablet, laptop, and 1280-at-400%-zoom for WCAG
  reflow. A real window that really reflows, and the extension is awake in it.
- **A runnable Playwright project**: config, spec, `package.json` and a README, written
  into the Tests folder. Playwright ships real WebKit and Gecko builds, so what runs
  there is the actual engine. Two commands, and the README lists the failures worth
  expecting.

## What the capture sees

**Network.** `fetch` and `XMLHttpRequest` are recorded with method, URL, status and timing, request and response headers and a bounded body (secrets show as «redacted»). A GraphQL answer that is HTTP 200 with a non-empty `errors` list counts as a failure. An image, script or stylesheet that failed to load, and a Content-Security-Policy violation, are recorded too. A cancelled XHR is not a failure.

**Failures only, no payload.** `WebSocket`, `EventSource` and `navigator.sendBeacon` are recorded only when they fail (an abnormal WebSocket close, an EventSource that gave up, a beacon the browser refused), as a URL and a code. Their messages and bodies are never read. A successful socket, stream or beacon leaves no row.

**Actions.** Clicks, double-clicks, right-clicks, middle-clicks, typing, selects (several options too), uploads and Enter/Escape. Drag-and-drop is not recorded. A step the page performed itself by script is kept in the event log and marked "(by the page)" in the steps, and is left out of the Playwright spec.

**The Playwright spec and several tabs.** A click that opens a new tab becomes `context.waitForEvent('page')` wrapped around that click, and the steps in the new tab run on their own page variable (`page2`, `page3`). When the click that opened a tab was not recorded, the spec says so in a `FIXME` comment and skips that tab's steps rather than run them on the wrong page. A spec with more than one tab takes `({ page, context })`.

**Known residuals of the capture.**

- *Late injection.* Evidence travels from the page to the extension over a private channel that `content/page-hooks.js` hands over once at document start. A page that is already loaded when the extension wakes it can have a listener of its own registered first, and that listener could see the hand-over (D-1010-78).
- *Update re-pair.* After the extension updates, reload the page under test. The channel is paired once per page and a page's own `hello` is never answered after pairing (D-1010-89), so a page that was open across an update does not re-pair itself; capture on it stays silent until it is reloaded.
- *Closed shadow roots.* Open shadow roots are searched for test ids, labels, placeholders and CSS, and the locator is checked against what Playwright resolves. Closed shadow roots are out of scope: their contents are not reachable from page script, so the engine does not describe elements inside them. On a page that has any open shadow root, XPath is never offered (Playwright's XPath does not cross a root) (D-1010-101).

## Sound

On by default (every click, volume 70). Twenty-four short files, QA Wrap's own
"Glass & Air" set (synthesis plus CC0 recorded layers; every layer's source, licence and a hash of every file in
`ui/sfx/CREDITS.txt`); the sounds heard most take turns between two or three variants, never the same one twice
in a row. They are fetched
from the extension's own folder and decoded once, marking things that are already on screen:
waking up, starting and stopping, a capture, a finding, a failure. "Results and alerts" plays
eight moments, "Every click" adds seven quiet touch sounds. Nothing plays in the in-page
toolbar or while the microphone is on. Every sound is an *additional* channel, so switching
it off costs nothing. Settings lets you hear each one before deciding.

## Watermarks

Every generated document carries one line: the tool, the version, the owner, the session
and the time. Six months later that is what tells you which run a loose file came from.

Marking **evidence** is separate and off by default. A screenshot is proof of what a
screen showed, and a tool that draws on it by default has altered the proof. When you do
stamp one it is corner-placed, capped at 4% of the shorter edge, and **always a copy**:
the unmarked original stays in the session.

It is attribution, and it says so. Anyone with a crop tool removes it in four seconds.

## Architecture

```
page (MAIN world)          content/page-hooks.js       patches fetch/XHR/console before app code
      │ window.postMessage                             also applies the override rules
content script (ISOLATED)  content/bridge.js           relays events, pushes rules down
                           content/selector-engine.js  Playwright locators, verified unique
                           content/recorder.js         DOM action stream, secrets masked
                           content/picker.js           hover-to-pick overlay
                           content/rtl-stress.js       pseudo-locale / RTL mirror
                           content/data-injector.js    field-aware edge-case palette
      │                    none of these are declared in manifest.json:
      │                    background/site-access.js registers them at runtime,
      │                    against the origins the tester has granted
      │ chrome.runtime
service worker             background/service-worker.js  message hub; writes to IndexedDB
      │
      ├── core/db.js         sessions, events, captures (failure flag indexed)
      ├── core/events.js     the one definition of "this event is a problem"
      ├── platform/settings.js   defaults, ranges, key bindings, synced
      └── core/artifact.js   correlation + session sheet / Markdown / JSON / Playwright
      │
UI                         ui/tokens.css   the shared design system
                           ui/download.js  chrome.downloads, with fallbacks
                           report/         read the report, copy it, save it
                           popup/          guided quick actions
                           options/        shortcuts, ranges, privacy
                           devtools/       timeline, correlated failures, a11y
      │
vendor/axe.min.js          axe-core 4.13.0 (MPL-2.0), vendored, never fetched
```

The source is in five layers, and an import may point at its own layer or a
lower one, never up: `core/` (the product's ideas, zero `chrome.*`, 45 files
that all load in plain Node), `platform/` (the shared `chrome.*` adapters),
`ui/` (tokens, fonts and the globals a page needs), then the entry points:
`background/` and `offscreen/`, `content/`, and the twelve pages. Entries talk
to each other through messages, not imports. `tools/test-layers.mjs` fails the
build if any of that reverses. `ARCHITECTURE.md` is the full code map, and
`docs/adr/` holds the two decisions behind it.

## MV3 constraints this design works around

Load-bearing. Changing them will break things.

- **Service workers terminate when idle.** No session state lives in memory. The active
  session id sits in `chrome.storage.session`; every event is written to IndexedDB on arrival.
- **A declared content script needs its `matches` at install time**, which is the
  install-time warning about every website. So there are no declared content
  scripts: `chrome.scripting.registerContentScripts` takes the same eight files,
  the same order, the same `run_at`, and the granted origins as its matches.
  A registration reaches only the *next* navigation, so waking also injects into
  the tabs already open in that window.
- **`chrome.runtime.sendMessage` from the worker does NOT reach content scripts.** It only
  reaches extension pages. Content scripts need `chrome.tabs.sendMessage`, per tab. See
  `broadcast()`. Miss this and the recorder never learns a session started.
- **Response bodies are unreachable declaratively.** `declarativeNetRequest` is rule-based
  and cannot read or replace a response; blocking `webRequest` is gone. Both capture and
  override therefore live in the MAIN-world `fetch`/`XHR` patch. On a JSF portal this is
  what matters: every partial AJAX postback is an XHR.
- **`URL.createObjectURL` does not exist in a service worker**, and an `<a download>`
  click in a *popup* is cancelled when the popup closes. Exports therefore build the blob
  in an extension page and hand it to `chrome.downloads.download()`, which the browser
  owns from that point. See F26 in the QA report.
- **DevTools pages have very limited `chrome.*` access.** `devtools.js` only registers the
  panel; `panel.js` works over runtime messaging.
- **No remote code.** axe-core is vendored. A CDN `<script>` will not execute.
- **Chrome keeps a registered service worker across a file change.** The popup and content
  scripts reload from disk; the worker may not. QA Wrap stamps its build and the popup shows a
  reload banner on a mismatch. See F20 in the QA report.
- **A blocked IndexedDB upgrade never settles.** Every connection sets `onversionchange`
  to close itself, `onblocked` rejects, and an 8s watchdog turns a hang into an error.
- **`[hidden]` loses to any author `display` rule.** `ui/tokens.css` re-asserts it. This
  silently broke the popup's step cards once already.

## Deliberate behaviours

- **Secrets are never captured.** Password fields, and anything whose name/id/label matches
  `pass|secret|token|otp|pin|cvv|card|iban|ssn|nationalid|رقم السري|كلمة المرور`, record as
  `••••••••`. The generated spec reads one environment variable per masked field,
  `QAW_SECRET_<LABEL>` (the label upper-cased, numbered `_2`, `_3` when two fields share a
  name), falling back to `process.env.UQA_SECRET`, with a FIXME rather than typing the mask
  into the field.
- **Cookie values are never exported.** Names, domains and flags only.
- **Only the tab under test is recorded.** Other tabs, and the extension's own pages, are
  filtered out of both the event stream and the navigation stream.
- **Ambiguous locators are labelled, not hidden.** The picker says so, the timeline colours
  it, and the spec carries `// FIXME: locator matched N elements`.
- **The spec asserts only what the tester picked.** A Ctrl+Shift+click marks an element as an
  expected outcome and becomes `expect(locator).toBeVisible()` or `toHaveText(...)`. A session with
  no picks has no assertions and the spec says so in a comment, so a green run proves the steps
  ran, not that the page was right.
- **The spec replays the tester's steps, not every page load.** A navigation caused by the
  preceding click or submit, and single-page route changes, are left to the click; back/forward
  becomes `page.goBack()` and a reload becomes `page.reload()`.
- **Nothing is in a site you have not allowed.** No declared content scripts, no
  host permission at install. The registered scripts are recomputed from the
  granted origins on every change, and every page-touching handler refuses at the
  seam with one sentence when the origin was never granted.
- **Nothing leaves the machine** except where you configure Jira, a tracker or a webhook. No telemetry, no account, no remote endpoint.

## Performance

Choices that matter on a long session or a big page:

- **Counts come from indexes.** `fail` is written onto each event and indexed, so
  the popup's once-a-second poll costs a key-range count instead of reading and
  filtering the whole session.
- **The timeline appends, it does not rebuild.** The panel asks only for events
  after the last sequence number it drew, and appends them inside one
  `requestAnimationFrame` via a `DocumentFragment`.
- **Rows are `content-visibility: auto`,** so the browser skips layout for
  anything scrolled out of view.
- **Screenshots load on demand** through a single `IntersectionObserver`, rather
  than one message per shot at render time.
- **The selector engine sweeps the DOM once per pick,** memoising role and
  accessible name per element, instead of re-walking for every candidate.
- **Polling stops when the panel is hidden** and resumes on `visibilitychange`.
- **Settings writes are coalesced.** Dragging a slider is one write, not fifty.
- **The popup's opening round-trips run together.** The stale-worker check and
  the settings read are independent, and waiting for one before starting the
  other put a second worker wake-up on the critical path. Running them
  concurrently took the popup from 950ms to 241ms on a 6×-throttled CPU.

### Measured budgets

`node tools/perf.mjs`, on a 3,311-element fixture, unthrottled and at 6× CPU:

| Measurement | ×1 | ×6 | budget ×6 |
|---|---|---|---|
| popup open → interactive | 40ms | 241ms | 900ms |
| settings page → interactive | 40ms | 275ms | 1600ms |
| locator describe, per call | 15.6ms | 225ms | 320ms |
| recorder overhead, per click | 1.1ms | 24ms | 30ms |
| layout stress apply | 1979ms | 7957ms | 9000ms |
| layout stress revert | 18ms | 64ms | 2000ms |
| panel render, 2000 events | 99ms | 2523ms | 3500ms |
| panel append, 20 new events | 5.4ms | 45ms | 500ms |

**Layout stress is the slow one, and almost none of it is ours.** Of that 1979ms
the extension's own script accounts for about 58ms: collecting text nodes,
rewriting them, and sweeping for clipped containers, each reported separately in
the run's observations. The rest is the browser laying 3,311 elements out again
after the document direction flips and every string grows. That cost is not
removable, so the mode now says it is working the moment it starts, instead of
letting the page look frozen.

The earlier figure for this row, 11ms, was the harness watching the first
heading flip, which happens about a millisecond in, while the overflow sweep was
still two frames away. `rtl-stress.js` now stamps `html[data-uqa-stress]` when a
pass genuinely ends, and the budget is set against the honest number.

## Responsive

The panel is a CSS container, not a fixed-width layout: docked to the side of
DevTools at 460px the timeline rows stack, the stat strip reflows, and the
toolbar wraps. `prefers-reduced-motion` is honoured across every surface.

## Identity

The extension wears the **QA Wrap** identity from `../identity/`:

| Where it comes from | What uses it |
|---|---|
| `identity/tokens/tokens.css` | copied verbatim to `ui/identity-tokens.css`, the only place colours are defined |
| `identity/icons/favicon.svg` | the monogram in every app bar (`brand/favicon.svg`) |
| `identity/avatar/avatar-round.svg` | the panel's empty state |
| `identity/dist/icon{16,48,128}.png` | the toolbar and store icons |

Refresh them by regenerating in the kit and copying across. Never hand-edit
`ui/identity-tokens.css` or anything in `brand/`.

**Font caveat, stated plainly:** the only typeface is Thmanyah. Its licence allows
embedding inside a packaged product and forbids a loose, downloadable font file, so the
faces are carried as base64 `data:` URIs in `ui/fonts.css`, generated by
`tools/build-fonts.mjs`; no `.woff2` ships. Nothing is fetched from a remote host. The monogram is pure vector besides, and carries the brand wherever the display
face is missing. Body and data
text fall back through the identity's own stacks.

Two things kept their old internal names on purpose: the IndexedDB store (`uqa`) and the
`UQA_*` message types. Renaming the store would orphan every session already recorded,
and the message names are invisible. Everything a user can see is rebranded.

## Palette comfort

The palette is tuned for people who sit in front of it all day, and
`node ../identity/tools/ergonomics.mjs` enforces it: body text 7–13:1 (higher
is harsher, not better), large surfaces under OKLCH chroma 0.045, dark ground
above L 0.17 so light text does not bloom. The first audit found nine problems,
three of them shipped WCAG AA failures. See `references/identity.md` in the
skill.

## Design

The UI uses the **QA Wrap** palette: limestone grounds and basalt ink, Petra sandstone
as the one action colour, and guac, corn and Wadi Rum ochre for pass, highlight and
blocked. It is defined once in `ui/identity-tokens.css`, generated from the identity kit
and never hand-edited, and it is shared by the
popup, the settings page and the DevTools panel. In-page overlays carry a scoped copy of
the same tokens, because a content script cannot inject a sheet that styles `body`.
Accent-coloured *text* uses `--accent-ink` rather than the fill tone, which keeps it above
4.5:1 on both grounds.

## Known limits

- Role and accessible-name computation is a pragmatic subset of ARIA, not a full
  implementation. `aria-owns` reparenting is not modelled.
- Cross-origin iframes cannot be walked, so the `frameLocator()` chain is reported
  incomplete rather than guessed at.
- Override rules can be outrun by a request fired in the page's very first tick, because rules
  arrive via async storage after `document_start`. Inherent to MV3.
- RTL string expansion mutates text nodes. Fully revertible, but an app that re-renders
  from its own state may overwrite it, so toggle after the page settles.
- Overflow detection only flags containers that overflow **and** clip **and** are not
  scrollable. A scrollable region doing its job is not a bug.
- Requests from Web Workers and Service Workers are not recorded (see the capture limits above).
- Screenshots are visible-viewport only; full-page needs scroll-and-stitch (not built).
- GIF recording is capped at 60 seconds and 800px wide. That is not timidity: an
  uncapped GIF of a real screen is hundreds of megabytes and no ticket system
  will take it. MP4 and WebM have no cap.
- A folder grant does not survive a browser restart. Chrome re-asks on the first
  save. The settings page says so rather than appearing to have forgotten it.
- A site grant is scheme and host only. `https://shop.example.com` does not carry
  `example.com`, `http://` or any other subdomain, so an application spread over
  several hosts is several grants, or one press of *All sites*. That is Chrome's
  narrowest useful unit, not a choice this tool made.
- A page no extension may enter (`chrome://`, the Web Store, a `view-source:`
  tab) cannot be granted at all. The tools say so there rather than telling you
  to press Wake, which would not help.
- The time-box is gone from every control. Sessions run until stopped. The
  setting remains in the data model only so sessions recorded before the removal
  still read correctly in their session sheets.
- Page speed is measured on the page as it stands, so LCP and CLS are only meaningful when
  the scan runs on a page that was loaded with the extension already attached. Reload first,
  or read the network and long-task numbers, which are always valid.
- Jira issue creation posts Atlassian Document Format built from the Jira wiki export, so a
  very long session is truncated to 60 blocks rather than rejected. The full report is still
  in the attached export.
- Cookie and storage **editing** shows values; cookie **recording** never does. The
  two paths never meet, and `diagnose.mjs` asserts that an export still carries
  names and flags only. If you add a third path, keep it on the recording side of
  that line.
- Right-click entries do nothing on a page with no content script (`chrome://`,
  the Web Store); `documentUrlPatterns` filters them out rather than showing a
  menu that fails.
- The in-page picker and palette carry their own scoped theme tokens; they cannot use
  `ui/tokens.css`, because a content script injecting a sheet that styles `body` and `*`
  would restyle the page under test.

## Next

Every item on the original list is built. What the field guide names as still open:
annotation on screenshots, named and shareable rule sets, full-page capture, and a
real Lighthouse run, the last of which an extension cannot do at all.
`ARCHITECTURE.md` carries the build guidance; `npm test` is the sanity check
for adding anything new.
