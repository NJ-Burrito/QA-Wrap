# build-kpi detail (run qaw-1109, lane kpi, branch wt-qaw-kpi)

## Store and schema (answers [U]: where sessions, notes, time live)
- IndexedDB `uqa` v5, extension/core/db.js:11-12 (name, version); stores `sessions` (keyPath id, index startedAt, db.js:60-62) and `events` (autoIncrement seq, index sessionId, db.js:64-68).
- Session record: extension/background/worker-session.js:305-314 — id, seq, charter, startedAt, endedAt (null while recording), startUrl, status.
- Notes: event `{kind:'note', tag, text, frameUrl}` — fields allowed by core/events.js:126 (`note: ['text','tag']`); tag values bug|issue|question|null from popup/note-row.js:7 and the machine tags `technique|capture-gap|split|dropped` (core/events.js:22 `isTesterNote`). A bug = tag 'bug'. Two writers set it, both user actions: the bug reporter (background/worker-scans.js:496-501) and a failed guided a11y check (background/handlers-tools.js:155).
- Time: no stored duration; endedAt - startedAt (worker-session.js:431 sets endedAt on stop; core/sessions.js reconcile sets it for crashed sessions).
- Pages: `nav` events (service-worker.js:404-415, url), `dom` events with `action` (core/events.js:117-123, frameUrl), `links` events (worker-scans.js:781, rows[].href/internal) for discovered same-site pages.
- NOT stored: a severity on a note. Severity exists only on a defect report built at filing time (core/istqb.js:442). So the severity chart counts `note.severity` when present (five known ids) and shows `Not rated` otherwise, and the page says so. This is the one place the brief's "bugs by severity" is limited by data.

## Decisions
- Entry: Settings > About > "Performance indicators" link (options/options.html, 2 lines) opening kpi/kpi.html in a new tab. Same pattern as the tutorials link.
- D5 coverage: discovered = visited pages + same-site links found by a link check; tested = a page with a recorded `dom` action. A site with no link check uses basis `visited` and the chart states it (kpi.note.basis.*). Fallback is therefore implemented and labelled.
- Per-site time = session time split by that site's share of the session's navigations and actions (sums back to the total, asserted).
- A session counts on the day it started; a bug on the day its note was filed; a recording session with no end uses its last event (never "now").
- RTL: the plot mirrors (time right to left, value axis on the right). Debatable convention for time axes; chosen so charts read in the page direction. SVG text-anchor is direction-relative, handled by `anc()` in kpi/charts.js. Arabic axis dates are day/month in Latin digits, wrapped in an LRI isolate so 9/11 does not read 11/9.
- Week starts Monday in English, Saturday in Arabic (weekStartsOn passed by the page).
- PDF = the browser's print-to-PDF of the page under @media print (A4, controls hidden, cards unbroken). Real text, vector SVG, Thmanyah via the page's font token, direction from the UI language. Chosen over a hand-rolled PDF writer (no Arabic shaping, no font embedding) and over a canvas raster (not real text). Cost: the user picks "Save as PDF" in the print window (hint shown).
- Profile fine print: ONE call site, kpi/pdf.js `traceLine()`, dynamic `import('../core/profile.js')`, `loadProfile()` then `traceLine({lang,date,version})`; when the module is absent (current state: not on this branch) it returns '' and the page prints `QA Wrap {version} · {date}`. See RISK.

## Gates (this run)
- node tools/test-kpi.mjs: ok (known-true sample first, then non-bug notes / console / net / pageerror excluded; totals, weeks, sites, coverage, tz, week start).
- node tools/test-kpi-page.mjs: A markup EN+AR day+week, RTL geometry, i18n key parity; B headless Chromium with the extension loaded, profile tagged qaw-1109, fixture written to IndexedDB, empty card first, then 6 charts, tiles 12 / 6; Arabic RTL; fine-print fill and clear; with QAW_KPI_SHOTS: PNG EN/AR + PDF EN/AR, pdftotext asserts the text and the trace line.
- Renders: work/sdlc/build-kpi/kpi-en.png, kpi-ar.png, kpi-en.pdf, kpi-ar.pdf. The first AR render showed anchor and axis-margin defects (fixed, re-rendered once).
- npm run test:ci: see the receipt.

## failed attempts
- First AR render: text-anchor flipped in RTL, axis labels inside the plot, month names colliding, fractional ticks on count charts. Cause: IMPLEMENTATION_DEFECT. Fixed in charts.js/view.js.

## next step
Lead: merge wt-qaw-kpi after the profile lane lands, then send AMEND if traceLine's signature differs from `{lang,date,version}`; the tutorial lane reads work/sdlc/build-kpi/strings.md.
