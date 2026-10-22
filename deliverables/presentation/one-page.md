# QA Wrap, on one page

**Version 3.1.0 · Made by Nader Alzghoul · 6 September 2026**

## What it is

A QA toolkit that lives in the browser and keeps everything on the machine it
runs on.

Wake it, name what you are testing, press Start. It records what you do, what
the page requests and what the console says, and when something fails it shows
the click that caused it. Press Stop and the report is already written: a
headline, the cause-and-effect chain, the screenshots, the accessibility and
speed findings, and a timeline you can scrub.

It is built to the ISTQB Foundation shape. The tools are arranged as the test
activities, and the outputs are the documents the standards name: defect
reports and test cases to ISO/IEC/IEEE 29119-3, a session sheet, a
requirements specification, a user manual, a Playwright page object with
verified locators, a Postman collection, JUnit, HAR, Excel, Markdown and JSON.

It is asleep by default. Nothing is watched, hooked or read until the switch
is pressed, and only in the window it was pressed in.

## The sixteen tools

Simple mode shows the five a first day needs. Expert mode shows all sixteen,
under four headings, in the order a tester works.

| Group | Tool | What it does |
| --- | --- | --- |
| Capture | **Photograph the page** | Takes the visible part, or the whole page scrolled and stitched into one tall image, and keeps it with the session. |
| Capture | **Record the screen** | Films this tab, or a window, or the whole screen, with the mic, the tab sound and the webcam if you ask. No time limit. |
| Capture | **Check another size** | Opens the same page again in a new window at a real phone, tablet or laptop size, so it really reflows. |
| Capture | **Mask real data** | Click a name, a national number or a whole column and it is covered for the rest of the session, in every screenshot, in the video, and out of the report. |
| Check | **Check accessibility** | Runs the engine Chrome DevTools uses, on the live page, and lists what would stop a screen reader or a keyboard. |
| Check | **Check page speed** | Measures how fast this page actually drew and responded, logged in and mid-flow, plus every request it made. |
| Check | **Check the links** | Asks every link on the page whether it still answers: broken, redirected, slow, or fine. Cross-origin included. |
| Check | **Measure code coverage** | Measures which of the page's own JavaScript actually ran while you used it, function by function. |
| Design | **Design the values** | Reads what a field declares, its type, minimum, maximum and whether it is required, and works out the classes of input it has and the value on each edge. |
| Design | **Try nasty values** | Offers a list of awkward values built for that exact field: very long text, Arabic, a date in 1800, an emoji, nothing at all. |
| Design | **Fill the form** | Fills every field with the value a tester would have chosen: a real-shaped phone number, an IBAN that passes its checksum, a date inside the allowed range, Arabic where the page is Arabic. |
| Design | **Harvest the page** | Reads every button, link and field, verifies a locator for each against the page, and writes a page map, a Playwright page object and a brief an AI can write tests from. |
| Design | **Copy a locator** | Click any control and the one line of code a test needs to find it again is on the clipboard, checked to match one thing and only one. |
| Design | **Draw the flow** | Turns the session into a workflow diagram on one A4 page: start, each step, a decision, a red box where it failed, the end, with the user story beside it in Arabic. |
| Break | **Break a request** | Makes the site fail on purpose: 500, 503, 403, 404, an empty body, a slow reply, a dead connection, a redirect, a changed or stripped header. |
| Break | **Stress the layout** | Flips the page right to left and makes every label about 40% longer, the way a translation would, and outlines anything that cuts text off. |

The five in Simple mode: Photograph the page, Record the screen, Mask real
data, Check accessibility, Check page speed.

## The privacy stance, in three lines

1. **Local-first.** Everything recorded stays in your browser profile on your
   machine. There is no QA Wrap server, no analytics, no remote code, and the
   accessibility engine is bundled inside the package.
2. **Asleep by default.** Content scripts are inert until you wake the
   extension in that window, and passwords and cookie values are never
   recorded.
3. **Nothing leaves without a named destination.** Data goes out only when you
   configure a tracker or a chat destination and press a button that says
   where it is going.

Full text: `extension/PRIVACY.md`, effective 3 September 2026, which is also
the text published at the policy URL the build checks.

## The eight browsers

Capability is detected, never assumed: the product asks the browser what it
can do and disables what cannot work, naming the browser and the alternative.

| Browser | Engine | What it gets |
| --- | --- | --- |
| **Chrome** | Chromium | The reference build. Every capability is present, and every suite runs against it. |
| **Edge** | Chromium | Identical to the Chrome build. Listed separately only because the store is. |
| **Brave** | Chromium | Takes the Chrome package. Shields block third-party requests on the page under test, which changes what the network panel sees. |
| **Opera** | Chromium | Installs from the Chrome Web Store once Chrome extensions are enabled, or from Opera add-ons. |
| **Opera GX** | Chromium | The same build as Opera. Its resource limiter can throttle a background tab mid-recording, so long clips are best taken in front. |
| **DuckDuckGo** | Chromium | The desktop browser takes this package. Its tracker protection blocks requests before they leave, reported as blocked rather than failed. |
| **Firefox** | Gecko | MV3 with an event page and no offscreen document, so recording, GIF, full-page stitching and coverage are unavailable and say so. |
| **Safari** | WebKit | Loads MV3 only after Xcode wraps it in an app, which is a macOS build step this project cannot run, so the folder is prepared and the command is printed. |

Seven zips ship from `npm run release`; the Safari folder ships with its
conversion command rather than a package claimed as built.

## The films

The set is being remade tonight. Six films, 2 minutes 8 seconds in total,
listed here as `extension/tutorials/lessons.json` had them at 23:24 on
5 September 2026. Durations and titles are provisional until the director
marks the set final: see `FILMS-PENDING.md` beside this file.

| # | Film | Length | What it shows |
| --- | --- | --- | --- |
| 1 | **QA Wrap** (trailer) | 58 s | The whole product in under a minute: what it records, what it proves, and what you hand over. |
| 2 | **Record a session** | 16 s | Wake it, name the test, press Start, then read what it caught. |
| 3 | **The tools** | 16 s | Accessibility, page speed and the page map, on the page you are standing on. |
| 4 | **File the report** | 16 s | Seven kinds of ticket, acceptance criteria written from the recording, evidence attached. |
| 5 | **Saving and the diagram** | 16 s | Every output in its own folder, named and dated, and the session as an A4 workflow. |
| 6 | **Protect the data** | 16 s | Cover a real name before it is ever recorded, then put the whole extension back to sleep. |

Every title also carries an Arabic name, and the tutorials page shows both.
