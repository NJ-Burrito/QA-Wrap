# Architecture

**QA Wrap 3.6.10.** Rewritten 10 October 2026, against the source, after the
layered restructure. Every count in it was measured that day; the commands that
produced them are named beside them so the next person can re-measure rather
than trust.

This document is a **code map**, in the shape matklad's *ARCHITECTURE.md* (2021)
and rust-analyzer's own file recommend: a bird's eye view, the entry points, a
map of the coarse modules and how they relate, and the cross-cutting concerns.
It names important files; it does not link them, because links rot faster than
names. Revisit it twice a year, not line by line.

The most useful parts are the **Architecture Invariant** callouts. There are
twelve. They are mostly statements of *absence* — what must never depend on
what — because those are the rules a newcomer cannot infer from any single file,
and the ones that break silently when they are broken.

Six of the twelve are now enforced by a script rather than by care. Where one is
enforced, the callout names the gate. Where one is not, it says so.

This file does not ship in the package: `tools/lib-ship.mjs` treats any Markdown
outside `SHIPPING_DOCS` as a working note. It is for whoever works on the source.

---

## Bird's eye view

QA Wrap records a tester's own browsing session — DOM actions, network, console,
navigation — links every failure back to the action that caused it, and turns
the result into documents a team can act on: ISTQB test cases and defect
reports, thirty-four export formats, a Jira issue, a Playwright spec.

Everything happens on the machine. There is no QA Wrap server, no account, and
no telemetry. The only outbound traffic goes to a destination the user typed in
themselves.

The source is in **five layers**, and an import may point at its own layer or a
lower one, never up:

```
  ┌──────────────────────────────────────────────────────────────┐
  │  ENTRIES     background/ + offscreen/   the worker pair       │  rank 4
  │              content/                   the page scripts      │
  │              popup/ report/ options/ devtools/ + eight more   │
  └────────────────────────────┬─────────────────────────────────┘
                               │  may import ↓, never sideways
  ┌────────────────────────────┴─────────────────────────────────┐
  │  ui/         tokens, fonts, and the globals a page needs      │  rank 3
  └────────────────────────────┬─────────────────────────────────┘
  ┌────────────────────────────┴─────────────────────────────────┐
  │  platform/   the shared chrome.* adapters. 10 files + i18n/    │  rank 2
  └────────────────────────────┬─────────────────────────────────┘
  ┌────────────────────────────┴─────────────────────────────────┐
  │  core/       the product's ideas. Zero chrome.*. 77 files     │  rank 1
  └──────────────────────────────────────────────────────────────┘
     vendor/ icons/ brand/   assets and third-party code           rank 0
```

**Read `core/` first.** It is where the product's ideas live, it is 19,272 of
the extension's 71,278 lines, and every one of its files loads in plain Node
with no browser at all — which is what makes seventy-two test suites possible.

> **Architecture Invariant.** `core/` never touches `chrome.*`, and imports only
> from `core/`. `platform/` imports only `core/` and `platform/`. `ui/` imports
> neither an entry nor another surface. An import that points at a higher layer
> is a failing test.
>
> Enforced by `tools/test-layers.mjs`, which walks every `import`,
> `export … from`, dynamic `import()`, `importScripts()`, HTML `<script src>`
> and HTML `<link href>` in the shipped tree — 253 internal edges across 142
> files — and also fails on an import cycle or a dangling path.
>
> The rule is `chrome.*` and deliberately **not** "no browser globals". Five
> core files name a DOM global inside a function: `db.js` (`indexedDB`),
> `docshell.js` and `fine-print.js` (`document`), `file-types.js`
> (`MediaRecorder`), `capabilities.js` (`navigator`). Making "zero DOM" the
> boundary would push `docshell.js` into `platform/`, and `docs.js`,
> `exporters.js` and `links-report.js` all import it — so the rule would have
> been broken on the day it was written.

> **Architecture Invariant.** An entry never imports another entry. Entries talk
> through messages; shared code goes down a layer. `background/` and
> `offscreen/` are one group and the only exception, because the offscreen
> document is the worker's own DOM and the doors exist so it can load the
> worker's heavy clients on demand.
>
> Enforced by the same gate, which keeps a `KNOWN` list of exceptions that each
> carry a written reason — and fails both on an unlisted violation *and* on a
> listed exception that is no longer a violation, so the list can only shrink.
> **There is exactly one row today:** `report/report.js` lazily imports
> `summarise()` from `background/notify.js`.

---

## Entry points

Everything the browser can start on its own. There are no others.

| Entry | File | Started by |
| --- | --- | --- |
| Service worker | `background/service-worker.js` | any event, any message, install, alarm |
| Page hooks (MAIN world) | `content/page-hooks.js` | registered by `background/armed.js` while a window is awake; `document_start`, every frame |
| Content scripts (ISOLATED) | `content/selector-engine.js`, `bridge.js`, `recorder.js`, `ui-host.js` | registered by `background/site-access.js` on granted origins; `document_start` |
| Late content scripts | `content/mask.js`, `replay-recorder.js`, `vitals.js`, `keymap.js` | the same registration; `document_idle` |
| Welcome, the first-run consent page | `welcome/welcome.html` | `runtime.onInstalled`, and Settings' *Show the welcome page again* |
| Toolbar popup | `popup/popup.html` | clicking the action icon |
| Side panel | `sidepanel/sidepanel.html` | `chrome.sidePanel.open()` |
| DevTools panel | `devtools/devtools.html` → `panel.html` | opening DevTools |
| Options | `options/options.html` | the extension's card, or the popup |
| Offscreen document | `offscreen/offscreen.html` | the worker, with a declared reason |
| Report and the rest | `report/`, `annotate/`, `diagram/`, `replay/`, `reporter/`, `api/`, `tutorials/` | a tab the worker opens |
| Keyboard commands | five, in `manifest.json` `commands` | the user's shortcut |

`manifest.json` is the map of all of them, and it is a map with a hole in it on
purpose: there is no `content_scripts` block and no `host_permissions`. The
eight page scripts are registered at runtime, so read `background/site-access.js`
beside it or half the entry points are invisible.

---

## Code map

### `core/` — the logic. 71 modules and three data files, about 19,300 lines

The product's ideas, and the layer worth understanding first. Nothing in it
calls a browser API that a Node process does not have, which is why the suites
can load all of it.

- **`events.js`** — what counts as a failure. Twelve lines, and the single most
  load-bearing definition in the program.
- **`artifact.js`** — correlation. Given a session's events it builds the causal
  chains: each failure attributed to the DOM action that most plausibly caused
  it. It also owns `causalWindowMs`, so the report, the panel and every exported
  document agree on how wide the window is. Everything downstream reads its
  output.
- **`steps.js`** — step labels and `reproSteps()`, split out of `artifact.js` so
  the worker's defect form (`istqb.js`) does not pull the whole builder into the
  boot graph; `artifact.js` re-exports it.
- **`db.js`** — IndexedDB. Database `uqa`, version 5, with `sessions`, `events`,
  `captures`, `media`, `mediaParts`, `mediaPending` and `replay`. A blocked
  upgrade never settles, so every connection sets `onversionchange` to close
  itself and an 8-second watchdog turns a hang into an error.
- **`sessions.js`** — the session lifecycle, reconciliation and retention, plus
  `countFindings()`, the one reducer three surfaces share.
- **`filing.js`** — `FORMATS`, the thirty-four export formats, and where files
  go. It describes the download rules; it does not call `chrome.downloads`.
- **`blackbox.js`** — CTFL 4.2: equivalence partitions, boundary values,
  decision tables, state transitions.
- **`istqb.js`, `istqb-render.js`, `docs.js`, `suite.js`, `artifact-docs.js`** —
  ISO/IEC/IEEE 29119-3 documents.
- **`exporters.js`, `formats.js`, `postman.js`, `xlsx.js`, `sheets.js`,
  `cookie-formats.js` (the worker reaches it through the offscreen document, `UQA_OFF_COOKIEFMT`, not by import), `adf.js`, `mdhtml.js`, `gif.js`, `docshell.js`** — one
  adapter per output shape. `docshell.js` is the shared HTML shell every
  exported document is poured into.
- **`tracker-specs.js`** — the nine issue trackers behind the offscreen door
  (GitHub, GitLab, Azure DevOps, Linear, Trello, ClickUp, Asana, Shortcut,
  YouTrack), each mapping the seven document kinds onto its own issue types.
  Data, not code; Jira is the tenth and has its own client and its own door.
- **`provenance.js`** — the `qaw1:` attribution token every artefact carries.
  Read `NOTICE` for what it claims and, more importantly, what it does not.
- **`capabilities.js`** — `TARGETS`, the eight browser builds, and the
  per-permission blockers each surface reports.
- **`product.js`** — the eight deployment values, in one place. See
  `DEPLOYMENT-VALUES.txt`.
- **`api-send.js`** — the API tool's HTTP sender. It lived in `background/`
  until the restructure, and `api/api.js` importing it across two entries was
  the invariant this document used to record as broken.
- **`on.js`** — twenty-four lines that stop an async listener's rejection from
  landing on the extension's card as an error the tester has to clear by hand.
- **`tool-catalogue.json`, `tracker-hosts.json`, `privacy-names.json`** — data, fetched at runtime
  rather than imported, so neither reaches the worker's boot graph.

### `platform/` — the shared `chrome.*` adapters. 10 files and the `i18n/` tables, about 1,970 lines

Small on purpose. This is not "everywhere `chrome.*` appears" — the entries are
full of it, and that is what an entry is for. It is the code that wraps a
browser API so that *more than one entry* can share it.

- **`settings.js`** — defaults, ranges, key bindings, and the admin policy.
  Preferences in `chrome.storage.sync`; secrets (Jira, tracker and webhook
  credentials) as one AES-GCM ciphertext record in `chrome.storage.local`
  written by `vault.js`, decrypted only in the service worker, merged at read. Writes are serialised, so two surfaces
  saving at once cannot lose a field.
- **`i18n.js`** — the language table and the paint. A classic script in `<head>`
  on eight surfaces, so it is loaded before first paint rather than after it;
  `platform/i18n/en.json` and `ar.json` are its two tables, fetched, and held
  identical by `tools/test-i18n.mjs`.
- **`chat-mattermost.js`** — the Mattermost connection. The account settings
  (server, team, channel) sit in `chrome.storage.local`; the token is not among
  them, it is in the encrypted vault (`vault.js`). The policy check and the secret
  scan run before each post.
- **`worker-errors.js`** — the UI-side worker-error mapper (D-1010-04). It maps
  the exact English sentence a worker handler throws to a `common.worker.err.*`
  key, loaded by the popup only, so it adds 0 bytes to the worker graph.

### `ui/` — the shared surface. 17 scripts and stylesheets, 3,750 lines, plus fonts

`tokens.css` and `identity-tokens.css` are the only places colours are defined;
`identity-tokens.css` is copied verbatim from `../identity/` and is not edited
here. `fonts.css` carries Thmanyah (Sans, Serif Display) as base64 `data:`
URIs, generated by `tools/build-fonts.mjs`, so no loose font file ships and the
licence's no-standalone-file rule holds. `theme.js`, `sound.js`, `motion.js`, `vfx.js`, `scenes.js`,
`download.js` and `folder.js` attach globals, because four of the surfaces that
load them are classic scripts and cannot import. Three of those globals call
`chrome.*` — which is why `ui/` sits above `platform/` and not beside `core/`.

### `background/` and `offscreen/` — the worker pair. 39 files, 16449 lines

`background/service-worker.js` is the entry and nothing else: 673 lines of listener registration, the
message seam (`onMessage`, the sender and arming guards), the shortcuts, the alarms and the boot sequence.
Until 12 October 2026 (OF-18) it was one 6,017-line file holding every handler; the code is now split into
ten static modules it imports, moved unchanged. Chrome needs every listener registered in the worker's first
turn, so the entry keeps each `on(...)` / `addListener` call, in the original order; the modules hold only the
functions and handler tables those listeners call. The direction is one-way, so there are no cycles
(`tools/test-layers.mjs` checks): each `worker-*` module imports only from those before it in this order,
`worker-base`, `worker-tabs`, `worker-scrub`, `worker-session`, `worker-filing`, `worker-scans`, `worker-lifecycle`;
the three `handlers-*` modules import from the `worker-*` ones, and `service-worker` imports from all of them.

- **`worker-base.js`** — the console tag, the `handlers` registry (filled by the entry with `Object.assign`),
  the active-session lookup, i18n for worker sentences, menu refresh.
- **`worker-tabs.js`** — which tab a tool may touch, `sendToTab` / `sendToFeature`, frames, overlays, broadcast.
- **`worker-scrub.js`** — the privacy scrub applied to every event and replay chunk before it is stored.
- **`worker-session.js`** — the write queue, appending and counting events, start and stop, the badge, notes,
  rules, and the Jira filing a stop can trigger (these are one cycle, so one module).
- **`worker-scans.js`** — screenshots, accessibility, performance, harvest, reporter, fine print, links, autofill.
- **`worker-filing.js`** — ISTQB drafts, suite filing, Jira status sync, duplicates, quick filing, chat notify.
- **`worker-lifecycle.js`** — per-tab grants, the retention purge, interrupted-session recovery, the float, sleep.
- **`handlers-session.js`, `handlers-tools.js`, `handlers-app.js`** — the 17 message-handler groups
  (190 names, `tools/test-handlers.mjs`): sessions, recording and library; the testing tools; settings, the
  armed switch and the browser.

The boot graph is 52 modules and 752 KB (`tools/test-worker-imports.mjs`): the split costs about 4 KB of
import lines and a ceiling of 52 modules instead of 42; the 755 KB line did not move. Suites that read the
worker as text use `tools/lib-worker-src.mjs`, which joins the entry and the ten modules.

- **`dispatch-tables.js`** — six lookups keyed by message name: is this window
  allowed, which ability does it need, what does it count as, how long may it
  take, what to say when it overruns, whose `tabId` means something else. Data
  only, no imports, no `chrome.*` — which is the point: `tools/test-handlers.mjs`
  loads it in plain Node and checks every key against the real handler list, so
  a typo in a key is a failing test rather than a silent no-op.
- **`write-queue.js`** — batched IndexedDB writes. 429 events per second stored
  against 1,067 arriving; the drain went from 46.6 s to 18.7 s under
  `tools/stress.mjs`.
- **`armed.js`** — the master switch, per window. It registers
  `content/page-hooks.js` in the MAIN world while a window is awake, and
  unregisters it when none is.
- **`site-access.js`** — which sites this extension has been let into, and the
  runtime registration of the eight page scripts. Also `NOT_ALLOWED`, the one
  sentence every tool says on a site that was never granted.
- **`session-state.js`** — the active session id, in `chrome.storage.session`.
- **`media.js`** — tab, screen and window capture; brokers streams to the
  offscreen document.
- **`notify.js`, `trackers.js`, `jira.js`** — chat destinations, system
  notifications, and the ten tracker clients.
- **`context-menus.js`, `action-icon.js`, `fullpage.js`, `whitebox.js`,
  `storage-editor.js`, `signature.js`, `export-build.js`,
  `security-headers.js`** — one concern each.
- **What `security-headers.js` cannot see (measured 10 Oct 2026, D-1010-136).**
  The `onHeadersReceived` listener is added after an asynchronous
  `permissions.getAll()`, never at load (D-1010-01), so a worker that was
  stopped while a window was armed wakes on the next document response but
  registers its listener too late for that response. Headed run with the
  granted copy: with the worker alive a document response was captured; after
  `ServiceWorker.stopAllWorkers` through CDP the next navigation woke the worker
  (state `stopped` to `running`) and that one response was **not** captured; the
  navigation after it was. The limit is exactly one document response per
  worker wake, not a stretch of the session. The armed window set itself
  survives (`storage.session`). Fine-print rows then say "not measured" for that
  URL, not "absent"; the one soft spot is the same-origin fallback in
  `core/fine-print.js` `headersOf`, which can answer with the latest
  `main_frame` of the origin, so a missed page may show the previous page's
  headers (listed for round 7). Two syncs never overlap (one in-flight promise
  plus a dirty flag), and a `getAll()` that rejects counts as no grant.
- **`offscreen/offscreen.js`** (2,262 lines) is the DOM the worker does not
  have. A service worker has no `document`, no `URL.createObjectURL`, no
  `MediaRecorder` and no `DOMParser`. The worker opens the document with a
  declared reason (`USER_MEDIA`, `BLOBS`) and closes it when done; only one may
  be open at a time.

**Doors.** A *door* is a shim in `background/` that keeps the worker's call
sites reading exactly as they did while the implementation loads on demand
behind the offscreen document — which is an ordinary page and therefore the only
place in the extension that may `import()` lazily. `jira-door.js` is the
reference: 19 KB of Jira client used for a few seconds when somebody files a
defect, which used to be parsed on every cold start. `istqb-render-door.js` and
`postman-door.js` followed. A door writes its method names out by hand rather
than using a `Proxy`, so calling something the client does not have is a
`TypeError` at the call site, the way it was when the module was imported
directly. **When you add something large that runs rarely, write a door.**

### `content/` — the page. 19 files, 9,816 lines

- **`page-hooks.js`** runs in the **MAIN world** at `document_start` on every
  frame of every URL. It has to: patching `fetch` and `XMLHttpRequest` before
  the application's own code reads them is the only way to see a response body,
  because `declarativeNetRequest` is rule-based and blocking `webRequest` is
  gone. It is also the single most expensive and most review-sensitive thing the
  extension does.
- **`bridge.js`** relays between the MAIN world and the worker.
- **`selector-engine.js`** builds Playwright locators and verifies they are
  unique. It sweeps the DOM once per pick, memoising role and accessible name.
- **`recorder.js`** is the DOM action stream. **`replay-recorder.js`** is the
  separate DOM-mutation recording.
- **`mask.js`, `picker.js`, `ui-host.js`** draw in a **closed shadow root**, so
  the tool never appears in the page's own DOM.
- **`data-injector.js`** holds the edge-case value palette. It contains two
  literal NUL bytes as test payloads, which makes `grep`, `ripgrep` and most
  linters treat the whole file as binary and skip it. Writing them as a `\u0000`
  would keep the behaviour and give the file back to the tools.

### The surfaces. 12 pages, 31,232 lines

`popup/` (9,595), `report/` (9,152), `options/` (4,157), `devtools/` (2,795),
`annotate/`, `api/`, `diagram/`, `replay/`, `reporter/`, `tutorials/`,
`welcome/`, `sidepanel/`.

They are not consistent, and the inconsistency is structural rather than
cosmetic. Eight load their script with `type="module"` and can `import`. Four —
**`popup/popup.js` (5,925 lines), `report/report.js` (4,354),
`devtools/panel.js` (1,030), `annotate/annotate.js` (1,054)** — are classic
scripts and cannot. They are also the four largest, which is not a coincidence:
a file that cannot import has to contain everything it needs.

They are no longer *copying* the shared definitions, though. `report.js` and
`panel.js` both reach `core/events.js` and `core/artifact.js` through an awaited
dynamic `import()` and hold the result in a module-level binding. **When you add
a script to one of those four pages, you are choosing that constraint for it
too**, and the dynamic-import pattern is how you live with it.

### `vendor/`, `icons/`, `brand/`

Third-party and asset. `vendor/axe.min.js` is axe-core 4.13.0, vendored
unmodified and pinned. `brand/` holds the mark and the lockup; `icons/` the five
PNG sizes the manifest names.

### `game/` — never ships. Bug Hunt, the practice game

A separate page on its own server (`npm run game`, `http://localhost:4173`) that teaches five QA Wrap features in five levels.
It reads QA Wrap only through five-plus count attributes the content bridge writes on that one origin (`qawState`, `qawNotes`,
`qawShots`, ...), makes no network request beyond its own server, and is excluded from every store package by `lib-ship.mjs`.
Voice lines are rendered once by `tools/voice-render.mjs`.

### `tools/` — never ships. 355 files, plus 103 under `film/`

248 `test-*.mjs` suites, chained in `package.json`'s `test:chain` script and
run in plain Node with `node:assert`. Then the harnesses: `clickthrough.mjs`,
`smoke.mjs`, `diagnose.mjs`, `uat.mjs`, `perf.mjs`, `stress.mjs`,
`recording.mjs`. Then the build and release path: `build-browsers.mjs`,
`package.mjs`, `lib-ship.mjs`, `release-check.mjs`, `manifest-check.mjs`.
The staged test pipeline (1012) is `pipeline.mjs` (`npm run t`, words `smoke`, `regression`, `e2e`, `full`, a feature,
a lane or a suite id) over `test-manifest.json`, with `lib-select.mjs`, `lib-sched.mjs`, `lib-verdict.mjs`,
`lib-sandbox.mjs` and `canary.mjs`; `run-suites.mjs` stays as the delivery gate.
`tools/film/` is the tutorial-film pipeline and is a separate program that
happens to live here.

`tools/lib-ship.mjs` decides what reaches a package, by deny-list: it excludes
`tools/`, `node_modules/`, dotfiles, and every Markdown file at any depth that
is not on its `SHIPPING_DOCS` list. A new source folder therefore ships without
anyone remembering to add it.

### `docs/adr/`

Two decision records, MADR shape: `0001-layered-layout.md` for the layers above
and `0002-no-build-step.md` for why there is no bundler. Add one when a choice
would otherwise only survive as a habit.

---

## Cross-cutting concerns

### The message protocol

169 distinct `UQA_*` message names in the source; 163 handlers in the worker; 74
of them carry a row in `background/dispatch-tables.js`.

The convention: `UQA_` + verb or noun, screaming snake case. The worker answers
every message or times out at 10 seconds with a named error, because a handler
that hangs used to leave the caller with "the message port closed before a
response was received" and no clue which call died. Three handlers that wait on
a person — choosing a window to record, granting a folder, picking a file — have
longer deadlines in `WAITS_FOR_A_PERSON`, and stopping a recording gets five
minutes because its duration scales with the clip.

**There is no envelope and no version field.** A message is a plain object whose
`type` is the name; the dispatch table is the schema. 51c proposes a `v:` field
so an old page and a new worker can disagree safely, and it is the right shape,
but nothing reads one today and adding one that nothing reads is decoration. It
is named here so the next person knows it was considered, not forgotten.

Two things that are easy to get wrong and cost a day each:

- **`chrome.runtime.sendMessage` from the worker does not reach content
  scripts.** It reaches extension pages only. Content scripts need
  `chrome.tabs.sendMessage`, per tab. See `broadcast()`.
- **Messages are serialised as JSON, not structure-cloned.** `undefined` becomes
  `null`; `Map`, `Set`, `Date`, `Blob` and `ArrayBuffer` do not survive. This is
  why `jira-door.js` cannot forward attachments and the offscreen document reads
  the blobs out of IndexedDB itself.

> **Architecture Invariant.** Every `onMessage` handler validates its sender.
> The worker rejects any message whose `sender.id` is not this extension
> (`service-worker.js:6355`) and any whose `sender.url` is not an extension URL
> for the privileged paths (`:6345`). Authorise on `sender.id` or
> `sender.origin`, never on `sender.url` alone. Never add a generic
> `{ url, headers }` fetch handler: that is a confused deputy, and it hands any
> compromised content script the user's Jira token.
>
> Pinned by `tools/test-sender-checks.mjs`.

### State, and where it lives

> **Architecture Invariant.** The service worker holds no state between events.
> Chrome kills it after 30 seconds idle and every module-level variable dies
> with it. Register listeners synchronously at top level; read what you need
> inside the handler. Not enforced by a script — this one is on you.

Five stores, and they are not interchangeable:

| Store | Holds | Why |
| --- | --- | --- |
| `chrome.storage.session` | the active session id, arming, transient per-run state | in memory, cleared on reload, survives worker suspension. The most used of the four |
| `chrome.storage.local` | the vault record (AES-GCM ciphertext of credentials, tokens and webhooks) and the first-run consent record (`consentedAt`, `consentVersion`) | never synced, never exported, ciphertext at rest, masked in the UI |
| `chrome.storage.sync` | preferences | follows the tester between machines. About 100 KB total, 8 KB per item — never put a session in it |
| `chrome.storage.managed` | admin policy: `microphoneAllowed` and `hostPermissionsPolicy`, schema in `managed-schema.json` | read-only, set by the customer's fleet policy. Neither key grants anything; they decide what may be offered |
| IndexedDB (`core/db.js`) | sessions, events, captures, media, replay | the only store that can hold a recording |

`localStorage` holds exactly three things, all per-profile UI preferences: the
theme (`ui/theme.js`), the popup's simple/expert mode, and two "seen it" flags.

There are **76 direct `chrome.storage.*` call sites** with comments and strings
stripped, 58 of them in `background/`, 13 in `platform/`, three in the popup and
two in the API page. The professional shape is one repository module with the
three named stores behind it, and `platform/settings.js` plus `core/db.js` are
the seed of it. **This is the next move, and it is the reason `platform/` exists
as a folder with only three files in it: it is where that repository goes.**

### The budget that shapes everything

MV3 forbids dynamic `import()` in a service worker: the module graph must be
knowable at registration. So every module the worker statically imports is
parsed on **every cold start**, and the worker wakes constantly.

`tools/test-worker-imports.mjs` is the gate. Ceilings, and where the graph sits
today:

| | ceiling (`MAX_DIRECT` / `MAX_TRANSITIVE` / `MAX_BYTES`) |
| --- | --- |
| direct imports | 27 |
| modules at boot | 52 |
| bytes parsed at boot | 763 KB |

Where the graph sits today is whatever `node tools/test-worker-imports.mjs`
prints (754.4 KB at the 11 October 2026 merge); the ceilings above are
the constants in that file, and `tools/test-docs.mjs` fails when this table and
those constants disagree.

**Bytes are the binding cap, not the module counts.** The headroom is the
difference between the ceiling and the printed figure: the next module of any
size can fail the gate. Do not copy a measured figure into this file; it is
stale by the next commit.

> **Architecture Invariant.** Do not raise the ceilings to fit a new import.
> Write a door instead. The last raise (780 → 800 KB, 6 September 2026) is
> recorded in `test-worker-imports.mjs` with its reason and its debt, and that
> is the only acceptable way to raise one.

The path out is the one already proven: the tracker adapters left the graph
behind the offscreen door and took it from 803.0 KB to 787.8 KB. Roughly 120 KB
more can follow the same route.

### Permissions, and what the tester was asked

> **Architecture Invariant.** The registered set always mirrors the granted set,
> and neither block is in the manifest.
>
> One function computes the whole registration from `chrome.permissions.getAll()`
> rather than patching it: `syncSiteScripts()` in `background/site-access.js`,
> called at every worker start and from `permissions.onAdded` and
> `permissions.onRemoved`. Never register a script from anywhere else, and never
> patch this registration incrementally: a revoked origin has to lose its scripts
> on the next navigation, and a worker that died between the grant and the
> registration has to repair itself on its next breath. `persistAcrossSessions`
> is `true` here and `false` in `armed.js`, and the difference is the point: a
> permission survives a browser restart and arming does not.
>
> There is no declared `content_scripts` block. `<all_urls>` is declared under
> `host_permissions` (ui-1019: Start is the consent), so the install dialog warns
> about every website and the page scripts are registered for all of them. Nothing
> is captured until Wake or Start, and then only the focused tab or window.
>
> Pinned by `tools/test-permissions.mjs`, which holds the script list, and by
> `tools/manifest-check.mjs`, which loads a real Chrome and asserts the card
> shows no warning.

> **Architecture Invariant.** Content scripts are in granted sites only, and
> even there they do nothing. They hook nothing, read nothing and write nothing
> until the window they are in is armed. `background/site-access.js` decides
> where they may be at all; `background/armed.js` decides whether they may act.
> "Asleep" means every one of them is inert; "not allowed here" means none of
> them is present.

> **Architecture Invariant.** Every tool that reaches into a page refuses on an
> ungranted origin with one string, `site.NOT_ALLOWED`, checked at the seam
> (`service-worker.js:481` and `:5873`) rather than in each tool. A tool that
> writes its own wording is a tool that will drift from the sentence the wake
> card answers.

### Security

> **Architecture Invariant.** Nothing leaves the machine unless the user sent
> it, and nothing executable arrives. The package makes no request to any host
> of its own: every `fetch()` in the product goes to a destination the user
> configured — their Jira site (`background/jira.js`), their tracker
> (`trackers.js`), their chat webhook (`notify.js`), or the request they typed
> into the API tool (`core/api-send.js`) — or to a `chrome-extension://` URL for
> a bundled asset. There is no telemetry, no analytics, no crash reporting and
> no update ping. Everything executable ships in the package; `vendor/axe.min.js`
> is pinned and never fetched. The declared CSP is `script-src 'self';
> object-src 'none'; base-uri 'none'; frame-ancestors 'self'`.
>
> Enforced by `tools/test-independent.mjs`, which reads every shipped file and
> fails on a remote host that is not a user's own, and by
> `tools/release-check.mjs`, which fails the build if an analytics endpoint
> appears.

> **Architecture Invariant.** Nothing runs before consent. `welcome/welcome.html`
> opens on `runtime.onInstalled`, and until `consentedAt` is in
> `chrome.storage.local` the popup offers the consent card and the tutorials link
> and nothing else. The store's rule is that disclosure and a specific
> affirmative action live in the product's own UI: a description and a privacy
> policy do not count. Do not add a path that reaches a tool around that card.

> **Architecture Invariant.** Page-derived strings — labels, URLs, console text,
> anything that came out of the page under test — are rendered with
> `textContent`. There are fourteen `innerHTML` assignments in the whole product
> and every one sets static markup from a constant table. Keep it that way: this
> is an extension that reads hostile pages by design.

`externally_connectable` is declared `{ "ids": [] }`, so no other extension may
connect at all, and `chrome.storage.local` is set to `TRUSTED_CONTEXTS`
(`service-worker.js:164`) so content scripts cannot read it — which matters here
more than in most extensions, because a content script of ours is in every page
of every site the tester has allowed, and one of those pages is hostile by
assumption.

Secrets: encrypted by `platform/vault.js` (AES-GCM-256; a non-extractable device
key kept in IndexedDB, or an optional passphrase lock, PBKDF2-SHA256), stored in
`chrome.storage.local`, never `sync`, never in an export, never logged. This
defeats disk and profile scanners and sync leaks; it does not defeat malware
running as the logged-in user while QA Wrap is unlocked, which is why the
Settings page still tells the tester to use a scoped, short-expiry token.

### One definition of a failure

> **Architecture Invariant.** There is exactly one definition of "this event is
> a failure", in `core/events.js`, and one causal window, in `core/artifact.js`,
> so the store, the builder, the report and the panel can never disagree.
>
> This used to be broken three ways — `isFailure` and `correlate` were written
> again in `report/report.js` and `devtools/panel.js`, and the causal window had
> already diverged. Both pages now hold a binding filled from an awaited dynamic
> `import()` of the shared module, because they are classic scripts and that is
> the only import they have. `tools/test-correlate.mjs` pins the arrangement.

### Language

Two tables, `platform/i18n/en.json` and `ar.json`, with identical key sets, held
so by `tools/test-i18n.mjs` — which also fails on an em dash in copy, an "(s)"
plural, Latin punctuation inside an Arabic sentence, an unsorted key, and a key
nothing asks for. `platform/i18n.js` is a classic script in `<head>` on the
eight surfaces that carry copy, so the first paint is already in the tester's
language. `npm run i18n` shoots every surface at three widths in Arabic and
reports layout that broke under RTL.

### Browser targets

`core/capabilities.js` `TARGETS` defines eight builds from one source: Chrome,
Edge, Brave, Opera, Opera GX, DuckDuckGo, Firefox (`gecko.id`
`geckoId` in `brand/brand.json`, `strict_min_version` 128.0) and Safari as a
prepared folder. `tools/build-browsers.mjs all` writes them; `release-check.mjs`
asserts every zip holds the same file set as the store package.

`minimum_chrome_version` is **116**, set by `chrome.tabCapture.getMediaStreamId`.
Prefer runtime feature detection (`typeof chrome.offscreen`,
`MediaRecorder.isTypeSupported`) over version numbers: Edge, Brave, Opera and
Vivaldi report Chromium versions with different API sets behind them.

### Testing

The suites are listed in `tools/run-suites.mjs` and run with `npm test`: plain
Node with `node:assert`, no browser and no test framework. They work because
`core/` is pure. `tsc --noEmit` runs last, over `core/**`, `platform/**` and
`background/**`, as a ratchet: the ceiling is the constant in
`tools/test-types.mjs`, and the named files held at zero are listed there too.

The headed harnesses drive a real Chrome through Playwright with a persistent
context and are run by hand, one at a time, because they fight over the browser:
`clickthrough` (56 checks), `diagnose` (67), `recording` (83), plus `smoke`,
`uat`, `perf` and `stress`. `manifest-check` loads the extension and reads the
card. `release-check` (165 checks) reads the built zips.

There is **no CI, no linter and no formatter**, and no version control. The
suites are the whole of the automated enforcement, and they run only when
somebody remembers. That remains the single largest risk to anyone taking the
project over.

---

## Where this is going

Three moves, in this order, and the first is the one that pays:

1. **One storage repository in `platform/storage/`.** 76 scattered
   `chrome.storage.*` call sites become one module with the three named stores,
   a schema version and a migration list. `platform/settings.js` and
   `core/db.js` are the seed. This is why `platform/` is a folder rather than a
   file.
2. **`background/service-worker.js` split.** Done on 12 October 2026 (OF-18), see the `background/` section: the
   entry is 673 lines, the handlers and helpers sit in ten modules, and the boot graph ceiling moved from 42 to 52 modules.
3. **A message envelope with a version field**, once there are two versions to
   tell apart.

`tools/test-layers.mjs` is what makes each of these safe to attempt: the
direction cannot silently reverse while the work is in flight.

---

## If you are new here

1. `manifest.json` — every entry point in one file.
2. `core/events.js` and `core/artifact.js` — what the product actually thinks.
3. `background/dispatch-tables.js` — the shape of the message protocol.
4. `tools/test-layers.mjs` — the five layers and what may point at what.
5. `npm test` — seventy-two suites, no browser, about ninety seconds.
6. `README.md` — the feature-by-feature account, and the *Deliberate behaviours*
   and *Known limits* sections in particular.
7. `node tools/clickthrough.mjs` — a real Chrome driving the real popup, when
   nobody else is holding the browser.

The rest is reachable from those.
