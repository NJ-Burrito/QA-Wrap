# 55 — "Check another size": the window-sizes contract

Written by Group E on 7 September 2026, first thing, so Groups F and G can code
against it without waiting. It fixes **message names, payloads, the stored
shape and the report section name** for brief item E16 / F8 / G8.

> E16: "Check another size: the new window must record like the main session
> (video if the main session records video, masking if masked) and its results
> go under their own report section, 'Window sizes' or a better name."

Ownership, as the brief sets it:

| half | owner | files |
| --- | --- | --- |
| the press, the panel, the status line, the inheritance flags sent | **E** | `popup/**`, `content/**` |
| creating the window, arming it, recording it, filing the media | **G** | `background/**`, `offscreen/**`, `content/recorder*.js` |
| the report section that shows the result | **F** | `report/**` |

Nobody edits another group's file to make this work. The three halves meet at
the message names below and nowhere else.

The section is called **Window sizes**. Not "Viewports": the tester's word for
this is the size of a screen, and the popup's own card already says "Check
another size". The tab id is `sizes`, the count element is `count-sizes`.

---

## 1. The vocabulary

**run** — one window opened at one size, from one session. It has a `runId`,
it belongs to exactly one parent session, and it ends when the window closes.
A tester who opens iPhone, iPad and laptop from one session has three runs.

**inheritance** — the four things the new window copies from the parent
session at the moment it is opened: video, masking, the microphone tick, the
tab-sound tick. They are decided **once, by the worker, at creation**, and
carried in the reply so the popup can say what actually happened rather than
what it hoped for. Nothing re-reads them later.

```js
/** What a window-size run copied from its parent session. Booleans only. */
const inherited = {
  video: false,      // the parent session was recording a clip when this opened
  mask: false,       // the parent session holds at least one mask
  mic: false,        // the parent clip had the microphone in it
  tabAudio: false,   // the parent clip had the tab's sound in it
};
```

`webcam` is deliberately absent: one webcam cannot be in two clips at once,
and a second window that silently seizes it would stop the parent's clip
mid-recording. G refuses it and says so; see §5.

---

## 2. Popup to worker — `UQA_OPEN_VIEWPORT` (extended, not replaced)

The message already exists (`background/service-worker.js`, `viewport`
dispatch group). Two optional fields are added; the old shape keeps working.

```js
// sent by popup/popup.js, renderViewports()
{
  type: 'UQA_OPEN_VIEWPORT',
  viewport: 'iphone-14',      // the id from UQA_VIEWPORTS. unchanged
  tabId: 123,                 // the tab under test. unchanged
  url: 'https://…',           // optional, unchanged
  inherit: true,              // NEW, default true. false = a plain window, no run
}
```

Reply (`res.result`), where everything before `run` is what it already
returns and must not change shape:

```js
{
  windowId: 42,
  viewport: { id: 'iphone-14', label: 'iPhone 14', width: 390, height: 844 },
  measured: { w: 390, h: 844 } | null,

  // NEW. null when there is no running session, or when inherit was false.
  run: {
    id: 'vr_l8x2k9_1a',       // the runId. opaque, stable, see §3
    sessionId: 's_…',         // the parent
    tabId: 77,                // the tab inside the new window
    startedAt: 1757203200000,
    inherited: { video: true, mask: true, mic: false, tabAudio: true },
    refused: ['webcam'],      // things asked for that this window will not take
  },
}
```

**Who fills `run`:** Group G, inside `UQA_OPEN_VIEWPORT`. The popup sends no
inheritance flags of its own — it cannot see whether a clip is running without
a second round trip, and a second round trip is a second chance to disagree.

**What Group E does with it:** says it. The status line after a successful
press reads, in this order, only the parts that are true:

> Open at iPhone 14. Recording and masking here too.

and when `run` is null:

> Open at iPhone 14. It is awake there too.

## 3. The runId

Minted by the worker. Format is opaque to E and F; the only promises are that
it is a non-empty string, unique per run, and safe in a DOM id and a filename:

```
vr_<base36 of Date.now()>_<2 random base36 chars>
```

F must not parse it. E must not mint one.

## 4. What is stored, and where F reads it

Two events on the **parent session's** stream, so a run travels with the
session through every export the product already has, and F needs no new
store. Both carry `kind: 'viewport'` and are told apart by `phase`.

```js
// appended by G the moment the window is created
{
  kind: 'viewport', phase: 'opened',
  ts: 1757203200000,
  runId: 'vr_l8x2k9_1a',
  windowId: 42, tabId: 77,
  url: 'https://app.test/apply',
  viewport: { id: 'iphone-14', label: 'iPhone 14', width: 390, height: 844 },
  measured: { w: 390, h: 844 } | null,
  inherited: { video: true, mask: true, mic: false, tabAudio: true },
  refused: ['webcam'],
}

// appended by G when the window closes, or when the session stops with it open
{
  kind: 'viewport', phase: 'closed',
  ts: 1757203260000,
  runId: 'vr_l8x2k9_1a',
  durationMs: 60000,
  mediaId: 'm_…' | null,     // the clip filed for this run, when video was inherited
  reason: 'closed' | 'session-stopped' | 'refused',
}
```

`measured` is the inner size Chrome actually gave the window. It is the honest
number and F should show it beside the requested one whenever they differ,
because that difference is where a broken breakpoint hides.

**Media.** A clip recorded in a window-size run is filed with the parent
session (so it is not orphaned) and carries two extra fields on its media
record, both set by G:

```js
{ …existing media record…, runId: 'vr_l8x2k9_1a', viewport: { id, label, width, height } }
```

F's rule: a media record **with** `runId` belongs under Window sizes, not
under Screens & video. One clip, one home, no double count.

**Findings.** Anything a tool produces inside the new window (an a11y scan, a
links check, a screenshot) is already an event on the parent session and
already carries `frameUrl`. It does **not** need a `runId`: F folds by
`windowId`, which the run's `opened` event names. If that proves too weak in
practice, G adds `runId` to events raised from a run's tab and this document
is amended rather than worked around.

## 5. Refusals, stated rather than swallowed

A run that cannot inherit something says so instead of quietly doing less.
`refused` is a list of plain lowercase words from a closed set:

| word | when |
| --- | --- |
| `webcam` | one camera, two clips. Never inherited. |
| `mic` | the parent clip has the microphone and the platform will not open a second capture of it |
| `video` | **amended again 8 Sep 2026, per §11 — and the amendment of 7 Sep is withdrawn.** The platform fact stands: `chrome.tabCapture.getMediaStreamId` only hands out a stream for a tab the user has just *invoked* the extension on, and `chrome.windows.create` is not an invocation, so a window this extension opened is a window it may not film. The conclusion drawn from it on 7 Sep — that `video` is therefore refused for **every** run — was wrong, because it assumed a run must open a window. **A run that happens while a clip is running opens nothing: the session's own window is resized in place.** A tab capture follows the tab, not the pixels of a frame, so the capture already running goes on filming the same tab at the new size, and the run is a stretch of the clip the tester already has. Nothing is opened twice, so nothing is refused: `inherited.video` is `true`, and `mic` / `tabAudio` are whatever that clip holds. `video` is refused in exactly one case now — a clip is running, but in a **different window** from the tab under test, so resizing this window would not put the run in that clip; the run opens its own window and says `video`. No new word joins the closed set. |
| `mask` | there is no running session, so there is no mask list to carry |

E prints them: `Open at iPhone 14. Recording here too, but without: webcam.`

## 6. Masking needs no new message

This is the part most likely to be reimplemented by mistake, so it is written
down: **masking already inherits.** `content/mask.js` asks
`UQA_MASK_GET` on every page load, the worker answers with the active
session's list, and `UQA_MASK_SET` fans a new mask out to every *armed* tab.
`UQA_OPEN_VIEWPORT` already arms the window it creates. So a window-size run
is masked the moment its page loads, and stays masked as the tester adds more.

The only thing E adds is a test that asserts it, and the `inherited.mask` flag
so the sentence on screen can be true. **Nobody adds a `UQA_MASK_TO_WINDOW`.**

## 7. Broadcasts

One, so the popup and any open report repaint without polling:

```js
{ type: 'UQA_VIEWPORT_CHANGED', runId, phase: 'opened' | 'closed', sessionId }
```

Sent by G through the existing `broadcast()`. E listens in `popup/popup.js`
beside `UQA_RECORDING_CHANGED`; F listens in `report/report.js` beside
whatever it already listens to and re-renders the Window sizes tab only.

## 8. One convenience read, for F

Folding two event phases is F's business and F may do it. If F would rather
not, G exposes one handler that does the fold in the place that already holds
the data:

```js
{ type: 'UQA_VIEWPORT_RUNS', sessionId: 's_…' }
// → [{ runId, viewport, measured, openedAt, closedAt, durationMs,
//      windowId, tabId, url, inherited, refused, mediaId }]
```

Sorted by `openedAt`, oldest first. An empty array when the session has no
runs, never null. **F decides whether this is built**; the events in §4 are
the source of truth either way, and this handler is only allowed to be a fold
over them.

## 9. What each group must not do

- **E** must not create windows, arm them, start recordings, or write events.
  It presses, it reads the reply, it says what happened.
- **G** must not decide what the report looks like, and must not name a
  section. It mints the run, fills `inherited`/`refused` honestly, and files
  the media with `runId`.
- **F** must not re-derive inheritance from settings. If `inherited.video` is
  false, the run had no video, whatever the settings say now.

## 10. Test hooks each group owns

| test | owner | asserts |
| --- | --- | --- |
| `tools/test-popup-structure.mjs` | E | the viewport panel says what a new window will inherit; the popup sends `inherit` |
| `tools/test-viewport-inherit.mjs` | E | the sentence built from `run.inherited` / `run.refused` is correct for every combination |
| `tools/test-handlers.mjs` | G | `UQA_OPEN_VIEWPORT` returns `run`, mints a runId, appends both phases |
| `tools/test-sessions.mjs` | G | a media record from a run carries `runId` and `viewport` |
| the report suite | F | a `viewport` event pair renders one Window sizes row; a clip with a `runId` appears once, there and not under Screens & video |

## 11. Status

- Contract fixed by Group E, 7 September 2026, before any of the three halves
  was coded. Amend by editing this file and saying so in your report, never by
  diverging in code.
- Group E has shipped its half: the panel copy, the `inherit` flag, the
  sentence, and the masking-inheritance test.
- **Amended 8 September 2026.** Two changes, both in the worker's half.

  **1. A run is recorded, by not opening a window.** §5's `video` row above is
  rewritten and the 7 September amendment withdrawn. The rule the code now
  follows, in one line: **while a clip is filming this window, "Check another
  size" resizes this window in place; otherwise it opens a new one.** The
  resized run lives inside the clip that was already running, so `run.mode` is
  `'resized'`, `inherited.video` is `true` and `refused` is empty. `video` is
  refused only when a clip is running in some *other* window, where a resize of
  this one would not reach it.

  Three fields join §4's events, and the reply, and are absent on runs recorded
  before today — a reader must treat absent as `'window'`, `true`, `null`:

  - `mode`: `'resized' | 'window'`, on both phases.
  - `exact`: `boolean` on `opened`, and on the `UQA_OPEN_VIEWPORT` reply beside
    `measured` — whether the browser actually gave the size that was asked for.
    `measured` alone was not enough: a caller reading only `ok` took a window
    Chrome had clamped to 502 px for a successful 768.
  - `clip`: `{ mediaId, startedAt, offsetMs }` on `opened` and
    `{ …, endOffsetMs }` on `closed`, for a resized run only. It is where in the
    session's own clip the run sits. **The parent clip is not stamped with a
    `runId`** — it stays under Screens & video, where it belongs, and the Window
    sizes row links into it at `offsetMs`. One clip, one home, unchanged.

  `restore` also travels on the `opened` event (the bounds to put the window
  back to). It is the worker's business; F ignores it.

  One message name is added, and it is the other half of resizing in place:
  `UQA_RESTORE_WINDOW_SIZE` — put the window back to the size it was, and close
  the run. Without it a run that resized the tester's own window could only be
  ended by stopping the session or picking another size.

  **2. The size correction was wrong and is fixed.** It computed
  `spec.width + (spec.width - inner.w)` from one measurement — the *asked-for*
  size corrected by the frame, which is only the same as correcting the *actual
  outer* size when the browser gave exactly what was asked for. In the field:
  390 asked, 1426 measured, `-646` handed to `chrome.windows.update`, which
  threw a raw API error at the tester; and 768 asked gave 110, which Chrome
  clamped to about 502 while the tool answered `ok: true`. It now measures,
  distrusts a reading larger than the window that holds it, corrects once from
  the real outer size, re-measures, clamps to a positive size that fits the
  screen, and reports what it achieved with `exact` saying whether that is what
  was asked for. Both routes go through the one function.

- Group G shipped its half on 7 September 2026: `run` on the reply,
  `viewportRuns()` in `lib/sessions.js`, both event phases, the
  `UQA_VIEWPORT_CHANGED` broadcast, `UQA_VIEWPORT_RUNS` (§8 — built, so F
  need not fold), and the `runId`/`viewport` stamp on a clip recorded inside a
  run. One amendment, in §5's `video` row above. The other change worth
  knowing: a run's window is added to `session.windowIds`, and
  `belongsToSession()` matches that list — without it every click and request
  in the new window was discarded as "other-tab", which is the whole feature.
- The `run` object is absent until Group G ships. Group E's popup treats a
  missing `run` as "no session", which is the same sentence it printed before
  this document existed, so nothing regresses while G is still working.
