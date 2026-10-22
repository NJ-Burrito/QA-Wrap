# Roadmap

**QA Wrap**, by Nader Alzghoul. Last revised 1 October 2026, at version 3.5.3.

Every count below was measured against the source on the day it was revised, not
remembered. Where a line says **decision**, it is waiting on Nader and names
what for.

A published roadmap is a list of intentions in priority order. It is not a set
of dates, and pretending otherwise would make it useless the first time one
slipped. What it *is* good for is telling you what will not be built, so you can
stop waiting.

---

## Shipped

Where the product actually is, so the rest of this page has a baseline.

**The session.** Records DOM, network, console and navigation across every tab
in one window; correlates each failure to the action that caused it; per-session
state that resets on every run; a master switch: no session records and no request hook is installed until
you wake the window (page scripts stay loaded on sites you allowed).

**Design techniques** (CTFL 4.2). Equivalence partitioning and boundary value
analysis derived from a field's own declared constraints. Decision tables and
state-transition models are built in the service worker but have no button yet.

**Coverage** (CTFL 4.3). Real V8 statement and function coverage.

**Documents.** Test case and defect report to ISO/IEC/IEEE 29119-3. A suite with
sub-cases, sub-defects, notes and cycle-checked typed relations is built and files
to Jira, but has no button in the interface yet.

**Hand-over.** **Thirty-four** export formats (`FORMATS` in `core/filing.js`).
Jira takes a single issue or a whole tree, filed parent-first, with status coming
back. **Seven** other trackers: GitHub, **GitLab**, **Azure DevOps**, Linear,
Trello, ClickUp and Asana, each mapping the seven document kinds onto its own
issue types. Five chat destinations with severity floors. A Postman collection
and a separate environment. A cross-browser Playwright project is built in the
service worker and has no button yet. An exported HTML document carries its own typeface and makes no network request.

**Capture.** Screenshot, full-page stitch, tab recording, screen and window
recording, microphone, tab or system audio, webcam picture-in-picture, twelve
image and video formats.

**The rest.** Cookies in four formats plus saved profiles; team workspaces
(built, switched off, not offered); **two** published browser builds, Chrome and
Edge, from one source (`TARGETS` in `core/capabilities.js` keeps the other
engines for later); a recorded sound library (16 CC0 files, 15 sounds for 53
events); Arabic and RTL layout stress verified against a live government
portal; twenty-two tutorial films, one per tool.

---

## Next

In order. Each says what it is for, because a roadmap entry that only names a
feature is a wish.

### 1. Session replay: shipped

A DOM-recording replay page (`replay/`) now ships. What remains is the masking
question it raised: a replay that reproduces the page reproduces what was typed.

### 2. A reporter mode for people who are not testers: shipped

The reporter surface (`reporter/`) ships: describe the problem, one screenshot,
the technical evidence attached automatically.

### 3. An API client with environments

Requestly's advantage. The session already produces a Postman collection, which
covers the export half. The missing half is sending a request *from* the
extension against the page's live session, with environments and a pre-request
script, so that checking an endpoint mid-flow does not mean leaving the browser.

### 4. Deduplicated accessibility findings, and component checks

axe DevTools Pro deduplicates across a flow and checks components rather than
pages. The same twelve violations reported on every page of a wizard is noise
that hides the one new finding. Deduplication is tractable; component-level
checks need a component boundary the extension does not currently know about.

### 5. Long-run behaviour

Still the honest gap, but smaller than it was. `tools/stress.mjs` drives a
20,000-event session and the write path was rebuilt behind it
(`background/write-queue.js`, 429 events per second stored against 1,067, the
drain from 46.6 s to 18.7 s), and interrupted sessions are now closed and swept
rather than kept for ever. What is still untested is *duration*: the longest
session measured is minutes, and a tester recording for three hours is a
different program. **Open**: it needs a soak test, and that is buildable without
a decision from anyone.

---

## Later, or when somebody asks

- **A Safari package.** The folder is prepared and the converter command is
  printed; it needs a Mac with Xcode, which this project does not have.
- **Signing for addons.mozilla.org**, so the Firefox build installs permanently
  rather than as a temporary add-on.
- ~~**More trackers**: Azure DevOps~~ is **done, 6 September 2026**, with GitLab
  beside it. Shortcut and YouTrack are still a day each and nobody has asked:
  **decision** for Nader, since "when somebody asks" is the entry condition and
  no one has.
- ~~**Localised interface.**~~ **Done, 8 September 2026.** Every surface a
  tester reads is in Arabic and English, from one pair of tables held identical
  by `tools/test-i18n.mjs`, with `dir="rtl"` and logical-property CSS checked in
  a browser by `tools/i18n-shots.mjs`. The service worker's own notifications
  and the right-click menu are still English: the boot graph is at its ceiling
  and their table has to be fetched at call time, which is the next round.
- ~~A settings surface for the tracker credentials.~~ Done in 2.0.0: Settings
  draws one form per adapter and the report offers *File elsewhere*.

---

## Not planned, and why

The most useful section, because it tells you what to use something else for.

| | |
|---|---|
| **Cross-browser cloud** | BrowserStack and Sauce Labs exist and are good. The extension writes a Playwright project that runs on either. |
| **Load and performance testing** | k6 and JMeter. Measuring a page a tester is standing on is a different question from load. |
| **Security scanning** | Burp and ZAP. Breaking a request to see how the front end copes is not a security scan, and calling it one would be dangerous. |
| **Test management** | TestRail, Xray, Zephyr. The exports feed all three. |
| **A hosted service** | It would break the one promise the product rests on. Everything on this roadmap has to work with the network cable unplugged. |
| **Rebuilding axe-core or Lighthouse** | axe is vendored. Lighthouse drives its own page load, which an extension cannot do, and every surface says so rather than pretending. |
| **OAuth for the trackers** | An extension cannot keep a client secret: anything in the bundle is readable by anyone who installs it. Personal tokens are the honest mechanism. |

---

## Waiting on a decision, 6 September 2026

Nothing here is blocked on code. Each names the person and the choice.

| What | The decision |
| --- | --- |
| The public addresses (`brand/brand.json` `urls`) | set 2026-10-23 to the GitHub Pages site https://nj-burrito.github.io/QA-Wrap/ (served from `site/`) |
| The support mailbox (`brand/brand.json` `emails.support`) | set to naderalzghoulbusiness@gmail.com |
| The store listing's privacy page (`store/LISTING.md:69`) | the same page, from the store's side |
| Shortcut and YouTrack adapters | a day each, and the entry condition on this page is "when somebody asks" |
| A Safari package | needs a Mac with Xcode, which this project does not have |
| Signing for addons.mozilla.org | an AMO account and a signing decision |
| Expert mode's own theme | instruction 7 asked for one and instruction 38 removed it as a generated-interface reflex. Two instructions collide and Nader picks |

## Done since the last revision

6 September 2026, all verified by a gate rather than by eye:

- GitLab Issues and Azure DevOps adapters, with the seven document kinds mapped
  once in each adapter.
- The tracker adapters left the service worker's boot graph and load on demand
  behind the offscreen document; the graph went 803.0 KB to 787.8 KB against a
  ceiling of 800 that was not raised.
- Settings writes are serialised, so two surfaces saving at once cannot lose a
  field.
- "Save into" and "Ask where to save each file" have controls at last, grouped
  under *Where files go*.
- The films moved out of Settings onto their own page, and the popup footer's
  Timeline link opens the timeline instead of printing instructions.
- Exported HTML documents embed Thmanyah and make no network request at all.
- The NJ-Burrito name is gone from everything a tester reads.

---

## How this list is ordered

Three questions, in this order:

1. **Does it lose or misrepresent evidence?** That is not a roadmap item, it is
   the next thing done.
2. **Does it close a gap against a tool a team would otherwise install
   alongside?** The four in the benchmark report are the reference points.
3. **Does it make the honest thing easier than the dishonest one?** The
   partition designer earned its place this way: the values existed already, but
   naming the technique is what makes coverage measurable instead of a feeling.

Anything that fails all three is on this page under *Not planned*, with the
reason.
