# Decision: network filter (غربلة) and click labels, 2026-11-10

Owner (Nader): the timeline records a flood of "bad" API calls while the site works fine for customers; filter and fine-tune what is recorded and called out. Clicks must record the label of the element clicked.

Board: QA lead, network engineer, product/UX, devil's advocate + privacy (read-only seats, all read the code). Program director decided.

## Root causes (from the code)
1. Every 5xx, transport error and GraphQL error always counts, with no first-party or user-caused test (`content/page-hooks.js:263-265`). Third-party tagging exists only for resource loads (`:1153`).
2. Fetch rejections record every abort (navigation, AbortController, StrictMode double fetch) as `error:true` (`:774-781`).
3. Ad-blocked requests arrive as status 0 and look like server failures.
4. No recovery rule: 401 then refresh then 200 stays a failure. Favicon and `.map` 404s, failed pixels, WS/SSE reconnects all count.
5. Dedupe is per click epoch (`:116`), so the same failure after every click is a new row. The 300-row cap is first-come, so a noisy minute 1 starves minute 40.
6. Click label `desc.name || role || tag` (`content/recorder.js:141`): no length cap, no icon-only handling, rows show only `Clicked {target}`.

## Decisions
- **D1 Nothing is deleted.** The session model and the HAR keep every request. The timeline is curated: every hidden row is counted per reason behind "N background calls hidden · Show". shown + hidden = total in the UI and in session.json. Reports end with "N calls hidden by filter (preset)". No "no issues" wording anywhere; always "M real failures, N hidden, K third-party".
- **D2 Never hidden (hard rule, no setting can override):**
  - a 5xx, a non-abort transport error, or a GraphQL `errors` response on a host in the session's host set;
  - any status of 400 or above within 2 s after a trusted user action;
  - a request carrying the app's auth header or cookie that fails.
- **D3 Host set (first party):**
  - the eTLD+1 of every navigated top-level and framed origin, plus every host that served a script, document or frame to the page, plus hosts the tester pins ("My hosts");
  - eTLD+1 uses a vendored Public Suffix List snapshot, not the hand-kept list in `core/origins.js`.
  - Payment, SSO and CDN hosts that serve the app's own scripts are therefore first party; they are never noise.
- **D4 Noise classes** (collapsed and counted; never in the problem count):
  - aborts from navigation or the user (a timeout abort, or one taking longer than 10 s, stays a failure);
  - the known-telemetry denylist, editable (google-analytics, googletagmanager, hotjar, sentry, segment, datadog, clarity, doubleclick, newrelic and similar);
  - third-party status 0 (ad-blocked); a first-party status 0 stays REAL;
  - favicon and `.map` 404s, and third-party font, image or pixel failures;
  - WS/SSE closes on reconnect when the connection had opened (a socket that never opened stays REAL);
  - 3xx and 304.
- **D5 Recovered:** a failure followed by a 2xx or 3xx on the same key within 30 s collapses to one amber row, "failed N×, then OK". Not counted as a problem, never removed. A 5xx that needed more than 2 retries, or appeared more than 3 times, stays a red problem.
- **D6 Grouping:**
  - Key: method + origin + path template (ids and uuids templated) + status + GraphQL operation + error name. Bodies are never merged.
  - Window: 30 s, across click epochs.
  - Each group keeps its first occurrence, last occurrence and worst status.
  - Row format: `12× GET /api/users/:id › 404 · over 3 s`. A mixed group reads `9 ok, 3× 500` and is coloured by its worst status, never by the majority.
- **D7 Caps:** always keep the first and the last occurrence of every distinct fingerprint. Keep a reserved budget per 5-minute slice, so minute 40 is always stored. Overflow becomes a counted row, never silence.
- **D8 Where it runs:** classification runs in the page hook (`report()`); the service worker only counts and stores. Bench: 10k events under 50 ms of added main-thread time.
- **D9 User controls:**
  - Settings «تصفية الشبكة» / "Network filter", with presets Strict (only failures my actions caused), Balanced (default) and Everything.
  - "Advanced" holds ignored domains, ignored path patterns (`*`), ignored statuses and My hosts.
  - Per-row menu: "Hide this endpoint", "Hide this domain", "Always show", with Undo. Rules are stored per site; the header chip reads "Filter: Balanced · 3 rules for this site".
  - A hide rule defaults to one method + path template, and warns when it would hide more than 20 recorded rows.
  - Cut for now: a regex editor, header or body rules, import and export, auto-suggest, per-method filters, a separate noise tab.
- **D10 Click labels:**
  - Source order: accessible name (aria-labelledby, aria-label, label), then the button's own visible text, then title, alt, the value of a button-type input, then the icon's SVG `<title>` or icon name. With nothing found: "icon button" / «زر بأيقونة», or "button without a name" / «زر بلا اسم», which is also logged as an accessibility finding.
  - Never taken from text-input values, and never inside password, `cc-*`, `one-time-code`, masked or contenteditable elements.
  - Table rows (`tr`, `row`, `gridcell`) record the role only, with no cell text.
  - Scrub before storing: emails, phone numbers, card-like runs of 12 or more digits, any run of 6 or more digits, and the existing secret-name pattern.
  - At most 80 graphemes, cut on a grapheme boundary, with bidi controls stripped.
  - Rows read EN `Clicked "Save" (button)`, AR `نقر على «حفظ» (زر)`, with the label in `<bdi>`. The full label shows in a tooltip.
  - A "Record click labels" switch (on by default). PRIVACY.md and PRIVACY.ar.md are updated in the same change.
- **D11 The fixture page** (it gates the release):
  - It is a local page with a controllable server and a manifest of REAL and NOISE rows. The test asserts that every REAL row is visible, every NOISE row is counted behind "hidden", and the HAR has every row.
  - REAL:
    - a first-party 500;
    - a 503 then 200 retry (amber, visible);
    - a 403 poll every 2 s;
    - a 404 3 s after a click;
    - payment-provider and SSO 4xx;
    - a CDN app-script 404;
    - an API on a sibling eTLD+1 that served a script;
    - a first-party host blocked (status 0);
    - two GraphQL operations failing differently on one URL;
    - a 500 at simulated minute 40 after 400 earlier noise failures.
  - NOISE: navigation aborts, analytics beacons, an ad-blocked third-party tag, a duplicate favicon 404, a third-party font 404.
  - Click label checks: buttons labelled with a name+email, a 16-digit card, an OTP "digit 3 of 6", a table-row action, a password wrapper, an Arabic label with bidi marks, a 300-character label, and emoji or combining marks. No email, card number or long digit run reaches any stored label or export; the Arabic stays intact; every label is at most 80 graphemes.
