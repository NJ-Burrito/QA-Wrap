# The ten minute demo

For Nader, 08:30 on 6 September 2026. Read it once with the browser open in
front of you, then present from the minute markers alone.

Every step below was walked against the real build on the permits fixture at
23:30 on 5 September 2026, and what the audience sees is what the product
actually said, not what it is supposed to say. Where a step did not walk
cleanly it is marked and the recovery is written next to it.

---

## Before you start

Six things, five minutes, at 08:30.

1. **Serve the fixture.** From `extension/`:

   ```
   node tools/film/record/fixture.mjs
   ```

   It prints `permits fixture on http://127.0.0.1:8973`. The API answers 500
   on purpose, which is the whole demo. Leave that terminal alone.

2. **Load the extension** in the Chrome window you are presenting from, from
   `extension/` unpacked, or install `dist/qa-wrap-3.1.0-chrome.zip`. Check
   `chrome://extensions` shows the card with no Errors button.

3. **Open the portal** at `http://127.0.0.1:8973` and leave it as the only tab
   that matters. Close everything else: a stray tab in the same window is a
   tab the session records.

4. **Dock the panel.** Open QA Wrap and press **⇥** in its header, the one
   labelled "Dock to the side". This is the single most important thing on
   this page. The floating popup closes the instant you click anything on the
   page, so a demo run from the popup is a demo of the popup opening fourteen
   times. Docked, the panel stays beside the page for the whole ten minutes.

5. **Light theme, and check it on the projector.** The **◐** button in the
   header cycles light, night and follow-the-machine. Every slide in `shots/`
   is light.

6. **Simple mode**, so the switch to Expert at minute 4 has something to do.

If the projector is 1920x1080, the twelve slides in `shots/` are already that
size and in demo order.

---

## The script

Minute markers are the latest you should still be on that step. Running early
is fine; the last ninety seconds are slack on purpose.

### 0:00 to 0:45 · It is asleep

**Say:** "This is a QA toolkit that lives in the browser. Before I show you
what it does, look at what it is doing right now, which is nothing."

**Do:** Point at the switch. Do not press it yet.

**Audience sees:** the card reads **Asleep**, and under it, *Nothing is
watched, hooked or read until you wake it.* Every tool below is greyed out.
The footer reads *No account, no upload, nothing leaves this browser.*

**Slide:** `01-what-it-is.png`

### 0:45 to 1:30 · Wake it, and name the test

**Say:** "Waking it arms this window and only this window. Then I say in one
sentence what I am testing, because that sentence goes on every document that
comes out of this."

**Do:** Press **Wake up**. Type into the charter box: `Submit a food import
permit`. Press **Start recording**.

**Audience sees:** the switch flips to **Awake**, *Every tab in this window is
being watched*; five tools come alive; the panel switches to the live card
with a running clock, an event count and a problem count.

**Slide:** `02-wake-and-charter.png`

### 1:30 to 2:15 · Test the page the way you always do

**Say:** "Now I just use the site. Nothing else is asked of me."

**Do:** Fill the form. Applicant name `Layla Haddad`, email
`layla.haddad@example.com`, quantity `40`, country `Jordan`. Do not submit
yet.

**Audience sees:** the permits portal filling up, and the event count moving
in the panel beside it.

### 2:15 to 3:00 · Cover the real name first

**Say:** "That is a person's name. On a staging system it would be a real one,
and the moment I take a screenshot it is in a ticket that anyone on the
project can open. So before I photograph anything: Mask real data."

**Do:** Press **Mask real data**. Click the applicant name field on the page.
Press **Esc**.

**Audience sees:** a dark bar across the top of the page reading *Click what
should never leave this machine · Esc to finish*, and then the name disappears
under a solid block. Say the two things that make it real: the block is in the
page, so the screenshot and the video are already redacted, and the text is
dropped from the page map and the timeline rather than merely covered.

**Slide:** `06-mask-real-data.png`

### 3:00 to 3:45 · Submit, and let it fail

**Say:** "Now the bug."

**Do:** Press **Submit application**. Then in the panel, type into the note
box `Submit 500s with no reference number` and press **Screenshot + note**.

**Audience sees:** the portal says *Something went wrong. Please try again.*;
the panel's problem counter moves; the panel says *Screenshot added with the
bug.* On the walk the card read 00:07, 10 events, 2 problems at this point.

**Slide:** `03-recording-live.png`

### 3:45 to 4:45 · Sixteen tools, and every one explains itself

**Say:** "So far I have used five tools. There are sixteen."

**Do:** Press **Expert**. Scroll the list. Press the **?** on one tool.

**Audience sees:** the list grows to sixteen tools under four headings,
Capture, Check, Design and Break. The **?** opens a plain-words explanation
under the button it explains, written for someone who has never used a QA
tool.

**Slides:** `04-expert-tools.png`, `05-tool-explains-itself.png`

### 4:45 to 5:45 · Let the machine look

**Say:** "Three of these run on the page I am standing on, logged in, mid
flow, which is the state no external scanner can reach."

**Do:** Press **Check accessibility**. Press **Check page speed**. Press
**Harvest the page**.

**Audience sees:**

- accessibility: *No automatic violations found. Manual checks still apply.*
  **Note:** the fixture is a clean page, so this is the honest empty answer,
  not a failure of the tool. If you want a finding on screen, run it on a real
  staging page instead, and say why you switched.
- page speed: *LCP 108ms · CLS 0.028 · TTFB 7ms. Nothing rated poor.* The
  numbers move between runs; the shape of the line does not.
- harvest: *6 elements, 6 with a verified locator, 1 form. Page map, page
  object and brief are in the report, under Raw export.*

**Then, and this is the one to slow down on:** click into the **Quantity (kg)**
field on the page, and press **Try nasty values**. A list opens on the field
itself, built for that field: empty, a single space, leading and trailing
spaces, 256 characters, 5000 characters, zero, negative, each with the reason
it is worth trying. Say: "it read the field's own type, minimum and maximum,
and worked out the edges from that."

**One thing to know:** the panel says nothing when you press it. The palette
appears on the page, not in the panel, so look at the page and do not wait for
a status line that is not coming.

If the field is not focused first, nothing opens. Click the field, then press
the button, in that order.

**Slide:** `07-design-the-values.png`

### 5:45 to 6:15 · Stop

**Say:** "That is the session. Everything from here is written for me."

**Do:** Press **Stop and review**, then **Open the report**.

**Audience sees:** the panel offers Session sheet, Markdown, Playwright and
JSON on the spot, then the report opens.

### 6:15 to 7:45 · The report

**Say, on Overview:** "The headline is the charter I typed. Underneath it is
everything the session collected."

**Do:** Press **What broke**.

**Say:** "This is the part I care about. It does not say the page failed. It
says: you clicked Submit application, that posted to /api/applications, that
answered 500, thirteen milliseconds later. The click and the failure are one
card, with the Playwright locator for the button that did it."

**Do:** Press **File it**.

**Say:** "And from that one session, seven kinds of ticket."

**Audience sees:** Defect report, Test case, Story, Epic, Task, Sub-task,
Plain, all written from the recording, evidence attached, editable before it
is sent. The defect report and the test case both follow ISO/IEC/IEEE
29119-3.

**Slides:** `08-report-overview.png`, `09-what-broke.png`, `10-file-it.png`

### 7:45 to 8:30 · The workflow diagram

**Say:** "This is the one a product owner asks for and a tester never has time
to draw."

**Do:** Press **Diagram** in the report header.

**Audience sees:** one A4 landscape sheet: start, each step, a decision where
the application answered, a red box where it failed, the end, with the user
story and the acceptance criteria beside it in Arabic. On the last walk it drew
11 boxes and the arrows between them. Every box can be dragged, reworded and
recoloured, and the legend at the bottom explains every colour and arrow on the
page.

**Slide:** `11-workflow-diagram.png`

### 8:30 to 9:00 · Where it keeps everything, and what it never does

**Do:** Open **Settings** (the gear). Scroll to **Privacy and data
protection**.

**Say:** the three lines, in this order:

1. Local-first: everything it records stays in this browser profile on this
   machine. There is no QA Wrap server, no analytics, no remote code.
2. Asleep by default: content scripts are inert until you wake it, and it
   never records a password or a cookie value.
3. Nothing leaves without a named destination: data goes out only when you
   configure Jira, GitHub, Slack or the rest and press a button that says
   where it is going.

**Audience sees:** ten settings cards, ending in Privacy and data protection
and About.

**Slide:** `12-settings.png`

### 9:00 to 9:30 · Eight browsers, and back to sleep

**Say:** "It runs on eight browsers. Chrome and Edge are the reference build.
Brave, Opera, Opera GX and DuckDuckGo take the same package. Firefox is Gecko,
so recording and coverage are not things an extension can do there, and the
product says so on the button rather than failing when you press it. Safari
needs an Xcode wrapper we do not build here, so the folder is prepared and the
command is printed."

**Do:** Press **Sleep**.

**Audience sees:** the switch reads **Asleep** again and every tool greys out.

### 9:30 to 10:00 · Close

The films are being re-cut tonight, so do not open one live. Say instead:
"There are six short films, two minutes eight in total, that cover this same
ground for someone learning it alone." See `FILMS-PENDING.md`.

Then take questions.

---

## Recovery moves

Read this column before the demo, not during it.

| If | Then |
| --- | --- |
| **Record the screen refuses after a navigation** | This is Chrome, not a bug. The panel says it in full: *Chrome drops permission to record a tab as soon as it navigates. Press Alt+Shift+V on the page, or right-click it and choose QA Wrap → Record a video of this tab.* Both routes work, both re-grant the permission and start the clip in the same gesture. Click the page first so the keystroke lands there and not in the panel. |
| **The panel keeps closing** | You are in the floating popup. Press **⇥** in its header to dock it to the side of the browser, and it stays open while you click the page. Do this at 08:30, not on stage. |
| **Every tool is greyed out** | It is asleep, or you are in a window it was not woken in. The switch is per window by design. Press **Wake up** in the window you are presenting from. |
| **A tool says "Reload this tab"** | The page was open before the extension was loaded, so it has no content script. Reload the page and press the tool again. |
| **Try nasty values opens nothing** | The palette opens on the field you are standing in, so a field has to be focused first. Click into the field on the page, then press the button. The panel stays silent either way, by design: look at the page. |
| **Accessibility finds nothing** | The fixture is a clean page. Say so, and either move on or run it on a real staging page. An empty result is the product being honest, and it is a better line than pretending. |
| **The report opens empty** | You are looking at a different session. Use the session picker in the report header, or right-click the page and choose **Open the last report**. |
| **The fixture is not answering** | The terminal from step 1 has stopped. Restart it. If port 8973 is taken, `UQA_FILM_PORT=8991 node tools/film/record/fixture.mjs` and use the port it prints. |
| **Chrome refuses to photograph a page** | You are on a `chrome://` page. Chrome will not let an extension read its own pages. Go back to the portal. |
| **Everything goes wrong at once** | The twelve slides in `shots/` are the whole demo, in order, at 1920x1080. Present them and narrate. Nothing in this script needs the live build to be true. |

---

## Known rough edges, as of 23:30 on 5 September 2026

Say these before someone in the room finds them.

1. **One diagram label still reads oddly, and it is the fixture's fault.**
   The label fix landed at 23:16 and is recorded in
   `research/38-fixes-docs-targets.md`: labels are capped at 28 characters
   inside a node, the failure node is two clean lines rather than one bidi
   tangle, and nothing runs across the sheet any more. What is left is one box
   reading `النقر على «Permits portalHelpStatus Ap...»`, which is the cap
   working correctly on a fixture whose page header has the whole navigation
   as its accessible name. On a real page that label is the button's name. If
   anybody asks, that is the answer; do not call it a bug in the diagram.

2. **Try nasty values acts without saying so.** Every other tool writes a line
   into the panel when it has run. This one writes nothing: the palette is on
   the page, and if you are watching the panel it looks like a dead button. It
   works, it is on slide 07, and it is in the script at minute 5. Just look at
   the right surface.

3. **The Record card is outlined amber, with a paragraph inside it.** That is
   correct and it is new: Chrome only lets an extension record a tab it was
   just invoked on, and the card now says so on its face instead of hiding it
   behind the ⓘ. If it is on screen when you scroll the tool list, read it out.
   It is the same sentence as the recovery move above.

4. **The films are not final.** See `FILMS-PENDING.md`.

---

## What is in this folder

| File | What it is |
| --- | --- |
| `README.md` | This script. |
| `one-page.md` | The leave-behind: what it is, the sixteen tools, the privacy stance, the eight browsers, the films. |
| `FILMS-PENDING.md` | Why there is no `films/` yet and what has to happen before there is. |
| `shots/` | Twelve 1920x1080 slides, numbered in demo order. |
| `make-shots.mjs` | The script that walked the demo and took the twelve slides. Run it from `extension/` to re-take them after a fix: `node ../deliverables/presentation/make-shots.mjs`. |
