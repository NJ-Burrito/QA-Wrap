# Changelog

All notable changes, newest first. Versions are `major.minor.patch`.

## Unreleased

Not shown to users: a release copies its own `## <version>` section only. Rename this heading to the new version when it is cut.

## 3.6.7, 2026-10-23

- Added: the 40-second QA Wrap film on the website and in the video area.

## 3.6.6, 2026-10-23

- Fixed: Awake no longer falls back to Asleep on its own. After the background worker had been idle, the panel's own state read could be answered "asleep" because a slow first read of the awake window was given up after 0.4 s; and waking a window with a page that has a frame that never finishes loading (a slow dashboard gadget) could outlast the 10 s limit and show "QA Wrap is taking longer than usual". The wake now answers within 3 s, the awake state is never guessed, and a timed-out press leaves the switch showing what the worker actually did.

## 3.6.5, 2026-10-23

- Fixed: filing to Jira no longer shows `[object Object]` as the "Expected vs actual" table header (Cloud and Data Center), and the "Include notes" option now appears whenever the session has your own notes; they are filed as a numbered list, Arabic notes reading right-to-left.
- Added: the Tutorials card "QA Wrap in 40 seconds" opens the film on the website in a new tab, and the website gets a "Watch the 40-second film" section; both stay hidden until the film is published.

## 3.6.4, 2026-10-23

### Added

- The QA Wrap website: https://nj-burrito.github.io/QA-Wrap/ (GitHub Pages, served from `site/`, English and Arabic). Settings > About links to it.
- MIT licence and a privacy policy in English and Arabic.
- A test that every outbound link in the extension and the site is on the allowed list.

### Changed

- One contact address everywhere: naderalzghoulbusiness@gmail.com.
- Portability clean-up: no path, tool or account of the author's machine is needed to build, test or use QA Wrap; optional helpers are chosen with environment variables (`QAW_TRASH`, `NJ_WRITER_DIR`, `QAW_FONTS_DIR`, `QAW_LAUNCH_HOSTS`).
- Internal process notes, agent files and client-specific tools are no longer part of the public tree.

## 3.6.3, 2026-10-23

### Added

- The side panel note box shows a thin slider under it when your text is longer than the box. It shows which part you see, follows typing, the wheel and the caret, and you can drag it. It works right-to-left too.

### Changed

- "Rate QA Wrap" now opens the page for the browser you installed it in. Until a store lists QA Wrap, it opens the GitHub page (stars).

## 3.6.2, 2026-10-22

### Added

- Settings has an Updates tab: check for updates by hand, see system info, and press Update now. The ⋯ menu has an Updates entry too.
- About lists the credits: Nader Alzghoul (NJ-Burrito), with GitHub and portfolio links; the website is coming soon (3.6.4 adds it).
- The floating toolbar shows problems and evidence counters and has a Record button.
- Every tool button animates while it works and ends with a check on success or a shake and a cross on failure.

### Changed

- The side panel shows only the test title under Awake.
- The note box scrolls sideways with the mouse wheel.
- The side panel shows the last 3 actions as green or red status lines with a count badge, instead of the note list.

## 3.6.1, 2026-10-22

### Fixed

- Automatic update on Windows: the updater could not download the release under the built-in Windows PowerShell 5.1 and reported a failure. It now fetches the signed link itself, sending the GitHub token to api.github.com only. The Mac and Linux updater does the same. The What's new page no longer shows the update card above its title.

## 3.6.0, 2026-10-22

### Added

- Automatic update for unpacked installs: the Update card now runs a small updater (Windows, Mac, Linux; one-time `updater/install.cmd` or `install.sh`, no admin rights) that downloads the release, checks its SHA-256, swaps the extension folder in place with a backup and rollback, and reloads. Your sessions, notes and settings are untouched. Without the updater it downloads the zip and shows three steps.
- "What's new in this version" page after an update (English and Arabic), showing the release notes as text.
- Optional read-only GitHub token in Settings for a private repository.
- "Not now" now hides the update card until the browser next starts, or the next version.

- **Optional update notifications.** Once a day the extension can ask GitHub for the latest release (one plain request, nothing about you). When a newer version exists, the popup and Settings show a card with "What's new". Updating is never forced, "Not now" hides that version, and Settings has a switch to turn the check off. On a store install the card offers "Restart to update" once the browser has the new version ready, and restarts only when you press it. The toolbar shows "NEW" while idle; the recording dot, counts and the low-disk warning always come first.
- **Jira Data Center sign-in with username and password** (as well as a personal access token).
- **Loopback addresses** (127.0.0.1, localhost) are accepted for trackers without a trailing slash.
- **Telegram access check.** The Telegram test in Settings now confirms the browser may reach api.telegram.org.

- **Notes checkbox in Save.** Save can also write your notes as a numbered notes file: .docx (right to left) and .md.
- **Folders per type, then per test.** Exports go into a folder for each type, then one per test title and date. Every file name carries the title and date.
- **Move and erase in photo markup and the video editor.** Marks are objects: pick one, move it or erase it. In the video editor each object has its own time window, and keyframes set its position and text, burned into the export.
- **Side panel 60/40.** The side panel splits 60 to 40.
- **Quieter live detection.** Live checks raise fewer findings; the deep scan stays on Tools.
- **Save last 1 minute.** The extension keeps a rolling buffer, so you can save the last minute of a session.

### Fixed

- **Jira typing.** Typing in the Jira fields no longer loses characters.
- **Readable tracker and Jira errors.** Every tracker reports a failed test or filing as a plain sentence instead of a raw status.

## 3.5.3, 2026-10-15

The practice page is now Bug Hunt, the game, and the popup stops doing things the browser cannot or should not do twice.

### Changed

- **The practice page is the Bug Hunt game.** "Open practice" (popup, welcome page, toolbar) now opens Bug Hunt, five short levels, inside the extension: no server, no outside request, English and Arabic. Its 15 voice lines are Ogg Opus (224 KB instead of 5.4 MB). The old four-fault page stays as `practice/faults.html`, reachable by address only, for tests. The package is 6.58 MB, and its ceiling in `test-films-hosted` moved from 6.25 MB to 6.7 MB on the owner's decision.
- **Copy.** The first-run pointer in the popup and the "Try it on the practice page" step on the welcome page now describe the game and its five levels instead of four planted faults, in English and Arabic.
- **Passive checks.** A press counts as a dead click after 1.7 s (was 1.2 s) of nothing changing on the page (`DEAD_MS` in `content/checks.js`); the game's own reaction landed inside the old window and hid its dead button.

### Fixed

- **Stop during Start.** Stopping while a start is still in flight waits for it, in the popup and in the worker, instead of leaving a session half started.
- **Side panel on Opera.** One shared check (`hasSidePanel()`) now gates the Settings choice, the toolbar behaviour, the action click and the Dock command; Opera shows none of them.
- **Asleep card and Tools fold.** The Asleep card shows after any Sleep, and the Tools fold fills the room that is free.
- **Badge on wake.** Waking a window no longer blanks the session badge.
- **Store zip.** A stray PowerShell cache file (`Microsoft/Windows/PowerShell/ModuleAnalysisCache`) no longer ships in the package.

### Tooling

- The end-to-end suite runs on the laptop: `QAW_TRASH`, the RTL slider, the vault grid, the dock fixture, Chrome's default folder, the egress and accessibility timeouts; the voice-style registry resolves from `NJ_WRITER_DIR` or the committed fixture.
- The nine `test-game-trial-*` suites and `test-pipeline-sweep` are in the test chain.

## 3.5.2, 2026-10-14

The popup stops offering things the browser cannot do, errors state their fix as a button, and a real-browser end-to-end test now walks the built extension.

### Fixed

- **Dock button on Opera and Opera GX.** Opera has no side-panel API, so the header button did nothing and ended in an error. The button is now drawn only where the API exists, and Settings no longer offers "side panel" there.
- **"Something went wrong. The technical detail is in the tooltip."** An unknown failure now says so in one sentence and carries a visible "Copy details" button instead of hiding the cause in a tooltip. The same holds in the annotator, the video editor, Settings and the report.
- **The scan tools on the practice page.** Chrome cannot script a page inside an extension, and the raw Chrome words (with an "Open Settings" button that could not help) are now one sentence.
- **The done card.** It no longer says "Untitled session" while problems were found (it uses the report's title rule), and the line, the Duration tile and the "no problems" line read one duration.
- **The Asleep card.** It is one line on an allowed site, and after the first press anywhere on a site that is not yet allowed. The link on it is "Wake only", not "Options".

### Added

- **Passive checks while recording (`content/checks.js`).** QA Wrap now finds, on any page it records and on the practice page, a click that did nothing (a button, link or role=button with no change on the page, no request, no navigation and no dialog for 1.5 s), text that is cut off or runs out of its box over a neighbour, and text under WCAG AA contrast. Each lands in the session as a problem, in the done card's count and in the copied report; they run only while recording, at most once per 3 s, 8 findings per session, and nothing leaves the page. The practice page loads the same file, so "Find all four with QA Wrap" is true again. `tools/test-layout-checks.mjs` covers both the findings and the cases that must stay quiet.
- **`tools/test-e2e-practice.mjs` and `tools/lib-e2e.mjs`.** The built extension in a real browser (Chrome, and Opera GX when installed), English and Arabic: the practice walk from Test this site to Copy report, with the checks above.

## 3.5.1, 2026-10-14

The side panel works, the popup loses its empty band, the toolbar icon keeps its current art, and the security review of October 2026 is closed.

### Fixed

- **Side panel from the toolbar.** With the setting "open the side panel", pressing the toolbar icon now opens the panel instead of a floating window. In that mode Chrome gives the tab no one-press grant, so "Record tab" on it needs the shortcut first.
- **Empty space above the tools.** The popup no longer reserves a band for an empty status line or an empty "Last locator" row.
- **Toolbar icon.** The recording icon is drawn in the current identity colours instead of falling back to the first design.
- **A calmer popup.** The tool rows no longer rise a moment after the popup opens.
- **Contrast and target size.** The Start shortcut chip, the export stamp and the export contents links meet the contrast and 24 px target rules in light and dark, English and Arabic.
- **Fonts in reports.** An embedded font in a report is no longer blanked by the redactor.
- **Long text.** Long text no longer slows report masking.

### Security

- **Redaction.** URL hosts and paths survive the entropy fallback (identifiers, slugs, joined hex), dates and IPv4 addresses are no longer taken for phone numbers, chat posts mask email and phone numbers, and the redactor is bounded.
- **AI and agent bridge.** The AI brief and the MCP text treat page data as data, not instructions; the AI key lives in the vault; the bridge token never crosses the socket (challenge and response), its file is private to the user, and the helper install refuses a group- or world-writable folder.
- **Practice game.** The Bug Hunt signal is written only for a page that carries the game's own status line and the current run's nonce.
- **Package.** The tutorial films are removed from the package, extension pages declare `img-src`, `media-src` and `form-action`, and the packaged `node_modules` equals the lockfile.

### Changed

- **Brand and size tokens.** One brand file feeds the name, owner and icons; spacing and sizes in the popup, report and options pages come from shared tokens. The popup and report scripts are split into smaller files; behaviour is unchanged.

## 3.5.0, 2026-10-12

Autopilot and a calmer popup, the dead-button fixes, a staged test pipeline for development, and a practice game that stays on your machine.

### Added

- **Autopilot and ADHD-friendly QA Wrap (1011).** One primary button per state that always says the next step, a note row where typing and pressing Enter saves a bug, a finish that is one press (Copy report, above the fold), a copied report that already reads as a bug report with a real title, a recording badge and page indicator so the state is always visible, and a screen that does not move by itself. Short hints, one name per thing, and every string in English and Arabic together.
- **Nothing you typed is lost.** Note and charter text survive closing and reopening the popup in the same session, and an interrupted recording is shown as one card with its saved event count.
- **Bug Hunt, a practice game (1012).** Five short levels that each teach one real QA Wrap feature. It runs only on your own computer (`npm run game`, `http://localhost:4173`), reads three counts from QA Wrap on that one address and nothing else, makes no outside request, and is **not part of the store package**.

### Fixed

- **Dead buttons (1011).** A sweep of every control found buttons that did nothing; each now does what its label says or is removed.
- **Alt+Shift+Q** is counted as a shortcut start (for the practice game) without changing how the shortcut behaves.

### Development

- **Staged test pipeline (1012).** `npm run t` runs the tests by stage (`smoke`, `regression`, `e2e`, `full`), by feature, by lane or by what changed, over a test manifest, in a sandbox with no outside network and with its own teardown, a mutation canary and a gate baseline that fails when a check is loosened. None of it ships.

## 3.4.1, 2026-10-10

Covers the council rounds of October 2026 (five rounds, then round 10).

### Security

- **Redaction is applied in more places.** The scrub now covers more of the text a session stores and exports, not only the main fields.
- **The API tool obeys the managed policy.** If your organisation turned integrations off, or lists allowed hosts, a request to any other host is refused before anything is sent, with a message that names the policy key.
- **Redirects under policy.** When your organisation lists hosts, the API tool does not follow a redirect (it refuses it with a clear message) and a response that landed on a blocked host is discarded unread. With no host list set, redirects are followed as before. PRIVACY.md and SECURITY.md say so.

### Changed

- **CSV export starts with a UTF-8 byte-order mark (BOM)**, so Excel shows Arabic text correctly instead of garbled characters. A cell that a spreadsheet would run as a formula (starting with `=`, `+`, `@`, a tab or a carriage return, or `-` when it is not a plain number) is written with a leading quote, so it is read as text.
- **The Slack-only post handler is removed.** "Post to chat" on the report page is the one button, and Slack is one of its destinations.
- **The session time-box was removed.** The one remaining alarm is a daily retention alarm that purges sessions older than the retention period you set; the store listing and privacy copy now say so.
- The accessibility of the API page: the request preview, the response headers and the response body are reachable with Tab, have a visible focus ring and a name in English and Arabic. On the report page each view tab points at its own panel.

### Fixed

- **Recorded Shift+Enter, Ctrl+Enter and modified clicks replay as typed.** A held Control, Shift, Alt or Meta is kept in the key name ("Shift+Enter") and on clicks and double-clicks, and the Playwright spec presses and clicks with it. The Enter that commits an input-method composition is no longer recorded as a step.
- **Page text can no longer cross-link issues or start a heading.** In the Markdown documents a `#123`, `owner/repo#5`, a leading list marker or "1." from the page is escaped.
- **The export bundle links an omitted picture to its file.** When a picture is too large to embed, the Markdown now links `Screenshots/<id>.png`, the entry that is in the zip.
- **The privacy copy names every outbound path.** The listing, the privacy summary and the site now name the API tool and the link checker, and say that cookie values and request headers are authentication data.
- **The release docs name the real gate**, `npm run test:release-gate`, and the version labels in the documents match the package.
- **YAML export** of lists of mappings (problems, notes) no longer writes keys at the wrong column, so the file is valid YAML.

## 3.4.0, 2026-10-01

### Added

- **Consent gates wakes.** A new notice revision (`CONSENT_REVISION`) blocks new wakes until the notice is accepted again; a window already awake is never cut off. Every write door (events, notes, replay chunks, rule firings) refuses a sleeping tab or a tab outside the session, per window.
- **Alt+B** opens the extension from the keyboard (`_execute_action`), and a click on the toolbar icon while the floating window is hidden behind the browser brings it forward instead of closing it.
- **Handler-failure ring and support bundle.** A failing listener adds one row to a local ring (the same failure is not stored again inside five seconds); Settings builds a plain-text bundle (build, browser, granted-site count, settings changed from default, last 30 failures) that is previewed, redacted of URLs, mailboxes, IPs, hosts with ports, paths and long numbers, and never sent.
- **Arabic where the tester looks:** menu, toasts, notifications, manifest text, refusals chosen by code, the on-disk footprint line, and right-to-left exported documents and sheets when their content is Arabic.
- **Locator truth set** that compares every emitted locator with Playwright's count, and a by-hand truth harness (nine scenarios) that runs on the zip contents.
- **Save presets and one-file bundle.** Five chips tick a sensible set of formats; the bundle is one zip with the documents, the session JSON, the checksummed session card and every screenshot.
- **Managed-policy registry.** Replay, integrations (with an allowed-hosts list), the debugger tools, locked redaction and a retention ceiling can be set by the organisation; Settings lists each key, and the controls it takes away are shown disabled with the reason.
- **"What left this machine".** Settings lists the last 200 sends to Jira, trackers and chat and the picker's locator copies: when, where to, how big, never the content. Copies made inside reports and the editor are not listed.
- **SHA-256 checksums.** Screenshots are sealed when written, the session card and the HTML report footer list them, and `tools/origin-check.mjs` says whether a file changed.
- **Organisation consent mode.** `consentMode: organisation` with an https `consentUrl`: no welcome tab on install, the popup card links your notice, acceptance is still recorded.
- **Editor craft.** Copy image, Redo (Ctrl+Y), arrow keys nudge the last shape (inside the image), and pointer moves repaint over a cached layer.
- **Heavy-page guard.** Replay stops following a page that stays over 2,000 records a second for two seconds, the worker takes at most 400 events a second per session and leaves a note saying how many were dropped, and one long string is cut at 32 KB. Replay reloads its frame at most twice a second while playing.

### Changed

- **UI sounds are recordings now.** The synthesised library (20 sounds, two voices) is gone; 24 short files (QA Wrap's "Glass & Air" set: own synthesis plus CC0 recorded wine-glass, pen and switch layers) play through a small Web Audio player; the frequent sounds have 2 to 3 variants picked at random, never the same twice in a row, and `error` is the loudest sound. Each of the fifteen sounds has its own melody, rhythm and material: start rises a fifth and stop falls one (both long), open and close are short air swells with a glass tick and no melody, on and off are switch clicks with a rising or falling pitch tick, wake and sleep are high airy three-note arpeggios. Same settings and defaults (on, every click, 70), same call sites, source and hashes in `ui/sfx/CREDITS.txt`. The in-page toolbar no longer plays click sounds.
- **Films are hosted with the site, not packaged**, and no poster or film is fetched until you press play on the Tutorials page. The package stays under 6 MB (`test-films-hosted`).
- **Formats cut to the ten defaults**; the rest sit under "More (not maintained)" in both pickers, unticked in the Save sheet: they still work and get no fixes until someone asks for them (`test-formats-keep`).
- **Team workspaces are switched off** (the join path is disabled, the code is kept); Reset and the public documents no longer mention them.
- **Retention is 30 days on a fresh install**; an upgraded install keeps the value it had. The delete-session confirmation names the count.
- The report footer carries the site address as plain text. The site and the Trust page now say what the extension fetches (a film, on a click) and that it is not independently audited (self-scan in progress). The welcome notice links the Trust page; the "Rate it" link stays hidden until the store listing is live.
- `npm run release` gates Chrome and Edge only; other targets are checked with `--all`.

### Fixed

- Two live sessions: mask read and clear, API record, recording start and stop, screen recording and SPA route events each resolve the session from the asking tab's window, not the last-active one.
- Fullscreen of a bare video hides the in-page bar; this is documented in SUPPORT.

## 3.3.0, 2026-10-01

### Added

- **One problem number everywhere.** A read-time classifier (`core/signal.js`)
  separates real problems from page noise; the badge, popup, panel, report,
  filing and exports all state the same headline, with a Problems / Everything
  control. On a noisy fixture the badge fell from 516 to 2.
- **A background finish cue**, played through the offscreen document, and a
  20-sound set with a scope setting; the sound and motion switches now persist.
- **Report truth.** The report says what was seen (no "Passed" from absence),
  and the status uses a glyph, a word and a colour together.
- **Secret scan on text exports and chat**, behind the offscreen door; the chat
  and the .eml door fail closed. Redact is an opaque fill; the blur tool is
  renamed Soften.
- **Release record.** `npm run release` writes `dist/RELEASE-<version>.json`
  (commit, zip SHA-256, shipped component hashes) and refuses a dirty tree, a
  stale zip, a reused version or an undated changelog.

### Changed

- **Thmanyah everywhere**, including canvas text and code or locator text.
- The debugger permission is disclosed plainly in the store documents.
- The site and listing name Chrome and Edge only.
- Colour-scheme and forced-colours fallbacks; the popup, bar and panel follow
  the manual theme.

### Fixed
- **Locators quote the page's own text.** An Arabic button is emitted with its own letters (the fold that turned
  `ة` into `ه` and `إ` into `ا` stays for comparison only), a label over 120 characters gets no quoted candidate, invisible
  characters are written as `\uXXXX`, hidden duplicates are counted the way Playwright counts them, and the XPath flavour is
  valid (`/html/body[1]/...`, not `///html/...`). Sessions recorded before this keep their old strings; exports re-quote what
  was stored. A real-Chromium truth set (`tools/test-locator-truth.mjs`) compares every emitted locator with Playwright's count.
- **The spec reader asks every frame by id** (up to 8, one 6 s budget), puts each in its own labelled section, says when a frame
  was not read, and never reads masked words. Page text in the plan, sheet, set and brief is quoted as data, cut short, with
  the plan naming steps by pick number.

- Erase now covers replay and cookie profiles; the vault refuses to overwrite an
  unreadable blob and says so.
- A refused note keeps its composer; command failures are visible; saving
  settings keeps the patch; welcome no longer auto-closes.
- The video editor falls back to the stored duration when the browser reports
  `Infinity`.
- Whole-token secret names are generated from one list (a template literal had
  cooked a backslash).

### Documents

- **Store-facing documents now match the package.** `PRIVACY.md`, the public
  privacy page, `README.md`, `ARCHITECTURE.md`, `ROADMAP.md`, the store listing
  and `NOTICE` describe the vault (AES-GCM ciphertext, not plaintext tokens),
  Thmanyah (not the earlier typeface), all 18 services, per-service host grants,
  evidence attachments, and that media attachments are not secret-scanned.
- `tools/release-check.mjs` fails if a shipped document or the site names the
  earlier typeface or a Google font host, or if `PRIVACY.md` omits a provider
  the integrations screen offers, and warns that the store URLs are unpublished.

## 3.2.0, 2026-09-09

### Added

- **The facecam has a corner.** The webcam bubble can sit in any of the four
  corners of the clip instead of always the bottom right, chosen on the Record
  panel and remembered as a default in Settings (`WEBCAM_POSITIONS`).
- **A "show the mouse pointer" toggle, ticked to begin with.** A screen
  recording keeps the cursor unless you turn it off; the constraint is applied
  on the stream itself (`getDisplayMedia({ video: { cursor } })`) and the clip
  records which way it went.
- **The report has a Selector copy section.** Every locator you copied during
  the session, in the order you copied them, with the element it came from,
  and now a **cropped picture of that element**, taken at the moment of the
  copy, with the written outline as its alt text. The copies also appear on
  the session timeline instead of only in the note stream.
- **HTML exports carry the element previews too.** The exported report's
  Selector copy table inlines the same cropped image beside each row. Nothing
  is fetched: the picture travels inside the file.

### Changed

- **Expert mode no longer wears a warning.** The amber banner and the yellow
  paragraph on the Record card are gone; the card says what it does in the
  ordinary voice the rest of the popup uses.
- **One motion system.** Every duration, easing curve and keyframe on the
  popup, Settings, the side panel and the welcome page now comes from
  `ui/motion.css`: two easings, four durations, one direction token so a
  horizontal move mirrors itself under RTL, and a reduced-motion block on every
  surface. No page invents a timing of its own any more.
- **One typeface everywhere, including in the page.** (Historical: the typeface
  was then the earlier open-licence face; it is now Thmanyah.)
  Every font family in the product resolved to the bundled face. The in-page overlay was the last holdout: its
  stylesheet is inlined into a closed shadow root, where a relative URL resolves
  against the site under test and where Chrome ignores an `@font-face` rule
  altogether. The eight weights are now registered on the page's own font set
  from `content/ui-host.js`, under a private family name so
  that a site asking for the same family still gets its own copy and not ours, and
  `ui/fonts/*` is web-accessible for that. No element is added to the page, and
  no weight is fetched until the overlay paints text in it.
- **Simple and Expert are checked as one product.** `tools/clickthrough.mjs`
  now runs its whole walk once in each mode, in its own browser, and asserts
  the parity rule directly. Simple may hide a tool, it may not strand one. The
  mode switch is on screen in both modes, Expert shows all nineteen tools, and
  every tool Simple hides is one press away.
- **The source is in five layers, and the direction is a failing test.** `lib/`
  is gone. Its forty-four pure modules and its two data files are now `core/`:
  the product's ideas, zero `chrome.*`, every file loadable in plain Node. And
  the three that call `chrome.storage` are `platform/settings.js`,
  `platform/i18n.js` and `platform/chat-mattermost.js`, with the two language
  tables at `platform/i18n/`. Above them sit `ui/` and then the entry points,
  which keep their own names: `background/` and `offscreen/`, `content/`, and
  the twelve pages. An import may point at its own layer or a lower one, never
  up, and an entry may not import another entry.

  `tools/test-layers.mjs` enforces it, in `npm test`: it walks every `import`,
  `export ... from`, dynamic `import()`, `importScripts()`, HTML `<script src>`
  and HTML `<link href>` in the shipped tree, 253 internal edges across 142
  files, and fails on an upward import, a cross-entry import, a `chrome.*` call
  inside `core/`, an import cycle or a path that points at nothing. Exceptions
  are listed with a written reason and the gate fails when one goes stale, so the
  list can only shrink. There is one: `report/report.js` lazily importing
  `summarise()` from `background/notify.js`.

  Nothing about the shipped extension changed. `manifest.json` needed no edit,
  the service worker's boot graph is the same 797.6 KB of the same 42 modules,
  and every suite passes with an updated path and no altered assertion: 1,595
  checks against 1,588, and the seven new ones are the gate itself.

- **`background/api-send.js` is `core/api-send.js`.** `api/api.js` imported it
  across two entry points, which is the one broken invariant `ARCHITECTURE.md`
  had been recording by name since it was written. It is a pure HTTP sender with
  no `chrome.*` in it, nothing in `background/` imports it, and moving it was the
  fix the document itself proposed.

- **`ARCHITECTURE.md` rewritten**, in the rust-analyzer shape: bird's eye view,
  entry points, a code map with one section per folder, cross-cutting concerns,
  and twelve **Architecture Invariant** callouts of which six now name the script
  that enforces them. `docs/adr/0001-layered-layout.md` and
  `docs/adr/0002-no-build-step.md` record the two decisions behind it. `docs/` is
  excluded from every package.

### Fixed

- **The three scanners read every frame of the page, not only the top one.**
  Check accessibility, Check the links and Check the fine print injected into
  the main frame alone, so a page under test that lives inside a cross-origin
  iframe (an artifact view, a payment widget, an embedded ministry portal, a CMS
  preview) got three clean bills of health for a document nobody was testing.
  Measured on 7 September against one such page: 0 violations reported where
  axe run by hand inside the frame found 83 failing nodes across 5 rules; 1 link
  reported where the page had 33, 8 of them dead; and "no privacy policy, no
  terms, no cookie policy, no business details" for a footer that carried all
  four. All three now enumerate the frame tree, run per frame and merge, with
  the frame URL and its depth on every finding. The frame count is on the status
  line, in the report and in the fine-print document, so a narrow answer can be
  told from a thorough one. A page with one frame reports exactly what it always
  did, and `tools/test-frames.mjs` holds it to that.
- **A click recorded inside a cross-origin iframe carries the whole
  frameLocator chain.** The recorder stored the selector engine's own prefix,
  which is empty across an origin boundary, so every generated Playwright step
  from such a frame addressed the top document and found nothing. It asks the
  worker once, when recording starts, and caches, exactly as the picker does.
  `UQA_FRAME_SELECTOR` moved from `content/picker.js` (injected on demand, so it
  could only answer while somebody was picking) to `content/bridge.js`, which is
  in every frame from `document_start`.
- **The report no longer opens with "0 problems found" over a session full of
  findings.** The headline counted failing requests, console errors and uncaught
  exceptions, so an accessibility scan with 83 violations, a link check with two
  broken links, four elements clipped under layout stress and five fine-print
  gaps were all outside it. `countFindings()` in `lib/sessions.js` is now the one
  definition, used by the report headline, the popup's live line and the Markdown
  export, and `tools/test-report.mjs` asserts the three agree.
- **`UQA_EXPORT` can build the `fine-print` format.** `lib/filing.js` had
  declared the artefact since the tool shipped and the switch had no case for
  it, so anything asking for it by name got "Unknown export format: fine-print".
  `tools/test-formats.mjs` now compares the picker's list, the filing table and
  the switch, so the next one cannot drift apart quietly.
- **The fine print no longer throws when a link check ran first in the same
  session.** `summariseLinks` answers three arrays and one number, and the input
  list spread all four: `...(links.ok || [])` on a number is "is not iterable",
  which failed the whole check with a raw TypeError. Found by the new frame
  suite on its first pass.

### Added

- **Every surface a tester reads is now in Arabic and English, and the pair is
  the unit.** 2,125 keys across the popup, Settings, the report, the DevTools
  panel, the annotator, the workflow diagram and Tutorials, from one pair of
  tables (`lib/i18n/en.json`, `lib/i18n/ar.json`) held identical by
  `tools/test-i18n.mjs`: a key in one and not the other fails `npm test`, and so
  does an em dash, an "(s)" plural, a tatweel inside a word, a Persian letter, an
  Arabic-Indic digit, a Latin comma inside an Arabic sentence, a dead key, and
  any English still written straight into `textContent`. Choose it in Settings
  or from the popup header: **Automatic** follows `chrome.i18n.getUILanguage()`,
  or name English or العربية. It applies with no reload, on every open surface at
  once, and follows the tester to another machine. Arabic sets `dir="rtl"`, and
  the stylesheets were converted to logical properties rather than gaining
  per-direction rules. Numbers stay Western in both languages, because every
  number on screen has a twin in an exported report and those are ASCII.
  `lib/i18n.js` is a classic script in `<head>`, like `ui/theme.js` and for the
  same reason: `report.js` and `annotate.js` start work while the document is
  still parsing, and a page that renders left-to-right and then flips is a jump
  on every load. Exports do not change language: a Markdown report, an ISTQB
  test case and a Jira ticket are documents somebody else opens. Decision 16;
  decisions 63 to 76 record what was chosen and why. The consent notice is the
  one surface that is not translated, because it is already in both languages at
  once and a store reviewer and a tester in Amman read the same screen.
  The service worker's own notifications and the right-click menu stay English
  this round: the boot graph is 3 KB under its ceiling and their table has to be
  fetched at call time.
- **`npm run i18n` opens every surface in Arabic and measures it.**
  `tools/i18n-shots.mjs` drives the popup at its own width, Settings, the consent
  notice and the report at 1100 px and at 390 px, with a real session and the
  site permission granted, and asserts `dir="rtl"`, no sideways scroll, and no
  element that overflows *and* clips, reusing the two-pass measurement from
  `content/rtl-stress.js`. It found three faults nobody had seen: the popup's
  grid column was `auto`, so a header wider than the 348 px body widened the
  column instead of shrinking the header and Chrome cut the Settings gear in
  half at the leading edge (silent in English for as long as the file has
  existed); the tool cards' two-line clamp lost the last line of four Arabic
  one-liners; and a screen-reader-only element was being reported as clipped.
  Screenshots land in `work/ui-shots/ar/`, outside the package.

- **Shortcut and YouTrack join the other trackers a defect report can file into**,
  the same personal-token shape as the other seven: Shortcut takes a story type,
  team or project, and workflow state, links uploaded screenshots onto the story
  it just made; YouTrack resolves a project's short name to its id, sets the
  Type field when the project has one and never fails the filing when it does
  not, and attaches files straight to the issue. Decision 13.
- **Six security headers are measured rather than asked about.**
  Content-Security-Policy, Strict-Transport-Security, Access-Control-Allow-Origin,
  X-Frame-Options, Referrer-Policy and Permissions-Policy are read off each
  response while a session is recording and reported as rows of the fine print.
  Three of those rows used to say "read them with curl -I". Observation only,
  never blocking; only those six names are kept, values are cut at 512
  characters, the whole record is capped at a kilobyte, and the listener is
  attached only while a session runs and only for that window. Adds the
  `webRequest` permission, which carries no new install warning on top of the
  host permissions already required. Decisions 42 and 43.
- **Persistent storage is asked for, once, at the first session start**, and
  what the browser answered is on the footprint line in Settings. Without a
  grant the browser may evict a recorded session under disk pressure, which is
  the thirty-day retention promise broken silently.
- **One line before the first recording of a session with the microphone on**,
  with Continue and Record without mic, remembered per session. Recording a room
  is not the same act as recording a screen, and in an all-party jurisdiction
  everyone whose voice is captured has to have agreed.

### Security

- **Every `chrome.runtime.onMessage` listener outside the service worker checks
  who sent the message.** Fifteen listeners acted on anything that arrived:
  between them they read the page's whole DOM back, filled every field on it,
  unmasked a value the tester had covered by hand, rewrote the layout, drew over
  the page and handed back the session's settings. None of it was reachable from
  a web page; all of it was reachable from any other extension installed beside
  QA Wrap. `content/bridge.js` was already correct and is the model.
  `tools/test-sender-checks.mjs` reads every listener in the tree and fails per
  file, so the one added next month cannot slip through.

### Changed

- **One implementation of `isFailure` and `correlate`.** Both were written three
  times: in `lib/`, in `report/report.js` and in `devtools/panel.js`, because
  the two pages are classic scripts and cannot `import`. One session could
  therefore be described three ways, and the description that reached the
  developer was whichever surface the tester exported from. The rule lives in
  `lib/correlate.js`; both pages pull it in with a dynamic `import()` awaited
  before the first render, the shape `report/charts.js` already used.
- **The service worker's boot graph came down from 797.8 KB to 785.8 KB** with
  everything above in it. `buildMarkdown`, `buildJson` and `buildSessionSheet`
  moved to `lib/artifact-docs.js`, and the link-check renderers to
  `lib/links-report.js`; both are reached only through the offscreen document,
  and the second was dragging 30 KB of document shell into every cold start for
  a function the worker cannot call.

### Fixed

- **Jira Data Center and Server are supported, not only Jira Cloud.** Every
  request signed itself with `Authorization: Basic base64(email:token)`, which
  is Atlassian Cloud's scheme; a self-hosted site wants a personal access token
  as `Authorization: Bearer` and refuses the Basic pair with a bare 401 that
  reads like a wrong password. Settings gains a Sign-in choice that reads the
  site URL by default (`*.atlassian.net` is Cloud, anything else is Data
  Center) and can be set by hand when the detection is wrong. The REST version
  travels with it, because Data Center has no `/rest/api/3`, and so does the
  description format, because it has no Atlassian Document Format either. The
  header is built in one place, `lib/jira-auth.js`, and the copy of it that
  lived in the service worker's own "Create Jira issue" path is gone.
- **A 401 from Jira now says which sign-in produced it**, so a personal access
  token sent as Basic reads as a wrong sign-in rather than a wrong token.
- **The report page offers the Jira button without an email.** A Data Center
  site has no email to give, and requiring one hid the button from every
  self-hosted Jira.

## 3.1.0, 2026-09-06

The presentation build. Everything below shipped after the 4 September cut
of the same version, which is recorded under its own heading further down.

### Changed

- **One name in front of a tester: QA Wrap, made by its author.** The
  NJ-Burrito brand line is out of everything a tester or a client can read: the
  Settings About card, the lockup's accessible name (which is inlined into the
  cover of every exported document), `README`, `SUPPORT`, `SLA`, `SECURITY` and
  `ROADMAP`. Internal identifiers that name old files are untouched on purpose,
  the workspace key `njbWorkspace` above all: renaming it would make every
  workspace saved before today unreadable.
- **The worker console handle is `qaw`.** `qaw.state()`, `qaw.sessions()`,
  `qaw.wake()` and the rest, matching the `qaw1:` token every artefact carries.
  `njb` still answers to the same object, so a snippet you saved keeps working;
  the banner no longer teaches it.
- **Issues this product files are labelled `qa-wrap`, not `njb`.** Jira, GitHub,
  Linear, Trello, ClickUp and Asana, and the Labels field the report prefills.
  Issues filed before this keep the label they were given, so a saved filter on
  `njb` needs updating by hand.
- **An exported Postman environment marks itself `_qawrap_provenance` and
  `_qawrap_note`.** Nothing reads one of these files back in, so there is no old
  key to keep reading; a file exported before today is unaffected.
- **An exported HTML document requests nothing at all, and carries its typeface
  with it.** The shared document shell pulled the typeface from Google's font service, so
  opening a report told Google's font service who was reading it and when. The
  extension never made that request; the reader's browser did. The `@import` is
  gone and the face is embedded instead: two woff2 weights read out of
  `ui/fonts/` when a document is built and written into it as base64, about
  89 KB a document. `tools/test-exporters.mjs` opens a freshly built report in a
  real browser, waits for its fonts, and fails if it attempts a single request.
  Disclosed in `PRIVACY.md`, and `NOTICE` records the two woff2 conversions.
- Exported HARs mark themselves `_qawrap`, and a forced GraphQL error carries
  `extensions.qawrap`. Both were `njb`. Neither is ever read back, so a file
  written before today keeps the name it was given.
- The popup's first-run line counts the films instead of naming a number. It
  said "Five short films" and there are six.
- `LICENSE` described the provenance token as `njb1:`. The product has always
  written `qaw1:`; the licence now says so.
- `tools/test-copy.mjs` reads the shipped Markdown as well as the JavaScript and
  HTML, and the twenty-one em dashes it found in `CHANGELOG`, `RELEASE` and
  `SECURITY` have been rewritten.

- **Screen recordings are MP4 by default, not WebM.** A clip is evidence
  somebody else has to open, and WebM is the format Jira previews as a download
  link, Teams refuses inline, Windows Photos opens only after a codec install
  and no iPhone plays at all. Chrome has been able to write MP4 through
  `MediaRecorder` since 126; the encoder is still probed rather than assumed, so
  a Chrome between 116 and 125 falls back to WebM exactly as before and the file
  is named `.webm`, never `.mp4`. `minimum_chrome_version` stays at **116**: the
  fallback is real and tested, and locking testers out of the whole extension to
  change the container of one artefact would be the wrong trade. Whichever
  container actually won is written onto the stored clip (`type`) and into the
  timeline entry (`mediaType`), so the report says what you have rather than
  what was asked for.
- **Large JSON exports are written compressed.** A `json`, `agent`, `har`,
  `harvest-map`, `flow-json`, `storyboard` or Postman export over 256 KB is
  saved gzipped, with `.gz` appended to the name it would have had:
  `Session-2026-09-05.json.gz`. Smaller ones are untouched, and so is every
  export a person opens by double-clicking (Markdown, HTML, the specification
  documents).
  Measured on a 20,000-event session: the fourteen exports together fell from
  17,860 KB to 5,609 KB.
- **Events are written to the database in batches.** Each one used to be its own
  IndexedDB transaction, and the transaction is the expensive part. They are now
  collected for up to 50 ms, or 32 events, whichever comes first, and written
  together; stopping a session, putting a window to sleep, and every read that
  must see the tail flush first, so nothing can observe the delay. Stopping a
  session writes its row and the last of its timeline in a single transaction,
  which closes the window in which a session could read as "stopped" with its
  final events missing. Measured on the 20,000-event stress run: 429 events per
  second stored, to **1,067**, and the drain from 46.6 s to 18.7 s.

### Fixed

- Verifying a signed PNG (`UQA_VERIFY_PNG`) threw on every build. It fetched its
  reader with `await import()`, which the HTML specification forbids inside a
  service worker; Chrome answers it with an error rather than a module. The
  "Link check (page)" export failed the same way, for the same reason. Both now
  use ordinary imports, and a test refuses any `import()` in anything the
  service worker loads.

## 3.1.0, 2026-09-04

### Changed

- **Retention now asks before it deletes.** Finished sessions are still removed
  after 30 days by default, but that default applies to a **fresh install**
  only. A profile upgrading from an earlier version has never been offered the
  setting, so its window is read as *never*, and nothing is deleted, until the
  choice is made in Settings → Privacy. Before this, the first start after the
  update deleted every finished session older than thirty days, under a policy
  nobody had agreed to and with no undo. If you upgraded to 3.1.0 before this
  release, that deletion has already happened and cannot be reversed.
- **A session the browser never let finish is now closed and can be deleted.**
  A crash, a power cut or an update during recording left a session with no end
  time, and a session with no end time was skipped by retention for ever. Those
  are now marked `interrupted` at the next start, ended at their last recorded
  event, and swept on the same schedule as any other. What such a session cannot
  know (values masked, cookies, rules fired, tools used) reads as unknown
  rather than as zero.
- One licence file, `LICENSE`. `LICENSE.md` named a different rights holder and
  has been removed; the holder is named once, in `LICENSE`.
- `NOTICE` lists what is actually redistributed: axe-core 4.13.0 (MPL-2.0, with
  its source-availability statement) and the earlier typeface (OFL-1.1, since replaced by Thmanyah). The three fonts it used to name are not in the
  product and never were.
- The homepage, support and privacy addresses point at the publisher's domain
  instead of a repository that does not exist.

### Added

- Renamed: the product is **QA Wrap**. New lockups, brand guide and brand board; the seven-pointed star removed from every mark.
- Copy several locators at once: Shift+click collects, Enter copies.
- Sound library (51 events, off by default) and a motion library (transform/opacity only, budget checked).
- Every HTML document through one shell: cover, legend, contents, print.
- Burrito explainer scenes in every help panel; a first-run tour.
- Workflow diagram editor: the session on one A4 landscape page, Arabic labels, legend from what is drawn, SVG/PNG/JSON.
- Saving: one folder per session (`S007 · date · charter`), "For people" and "For AI" shelves, numbered files in reading order, evidence numbered by capture time; popup and DevTools exports use the same tree.
- Field-tested on a public site as three visitor personas; the link check and the Harvester were fixed for a 5,000-node page; Arabic page-object keys.
- Release gate: `tools/release-check.mjs` checks the zip against the store's rules.

## 3.0.0, 2026-09-03

- Floating window by default, side panel optional; Simple and Expert modes; tiles by intent.
- Jira: defect, test case, story, epic, task, sub-task; the project's own fields; editable text; evidence attached; one-press filing.
- Harvester (page map, page object, AI brief), link check, form autofill with designed values.
- Documents pack: requirements specification, user manual, video storyboard; Excel workbooks; session cards for a team folder.
- Identity "Salsa & Slate, Amman edition"; stable extension ID.
