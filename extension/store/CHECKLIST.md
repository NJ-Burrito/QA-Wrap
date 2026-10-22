# Chrome Web Store submission checklist — QA Wrap

The order a publisher works in. Every "must" is a rule the reviewer applies;
`node tools/release-check.mjs` proves the ones a script can prove.

## Before the console

- [ ] `npm run test:release-gate` (every suite including the by-hand ones, then `test:a11y`, then the clickthrough; headed) exits 0 and prints `run-suites: <N> suites, 0 red` and `red: (none)`: quote that exit line in the release note. `npm test` (node-only) is a quick check, not the gate. While `test-listing-assets` (T-031) is on the known-red list in `tools/run-suites.mjs`, it is the one allowed red until the listing images are re-shot; then remove the entry. Then, by hand and headed: `node tools/smoke.mjs`, `npm run smoke:boot`
- [ ] `node tools/manifest-check.mjs` — the manifest loads in Chrome with no warning on the card
- [ ] `npm run build && node tools/package.mjs` — `dist/qa-wrap-<version>.zip`
- [ ] `node tools/release-check.mjs` — 0 problems (manifest, permissions, contents, code, listing assets)
- [ ] Version bumped in `manifest.json` **and** `package.json`; a `CHANGELOG.md` entry dated
- [ ] The zip loads unpacked *after unzipping to a fresh folder* and the ID reads `dbdhilacpjeojfnmdbnpcbmohkhgaihn` in Settings → About
- [ ] **Publish the site by hand (never automated, never by a script or a worker):** upload `site/` (index, privacy, support, terms, `assets/thmanyah.css`) to the company web host, then confirm the privacy, support and product URLs each return 200 before pressing submit. The store fetches the privacy URL at review; PRIVACY.md is a file, the store requires a URL

## Store listing tab

- [ ] Name: `QA Wrap` (45 max) · Summary from `LISTING.md` (132 max) · Description from `LISTING.md`
- [ ] Category: Developer Tools · Language: English (add Arabic as a second listing language when the UI copy is translated)
- [ ] Icon 128×128 (`icons/icon128.png`) — the burrito on Petra, no star
- [ ] Screenshots 1280×800, 1–5 (`store/shots/*.png`), in the order they tell the story: failure and its click → popup mid-session → bar with the problems chip → values → filing dialog
- [ ] Arabic screenshots, the same five in the same order (`store/shots/ar/*.png`, shot from the Arabic UI by `node tools/ui-shots.mjs --lang=ar` then `node tools/store-shots.mjs --lang=ar`), uploaded to the Arabic listing only after the Arabic listing text has passed the terminology vote (T-076)
- [ ] Small promo tile 440×280 and marquee 1400×560 (`store/promo-*-<version>.png`)
- [ ] Official URL / homepage: the product page · Support URL: the issues page (both in `core/product.js`)

## Privacy practices tab (the reviewer reads this first)

- [ ] **Single purpose:** copy the "Single purpose" section of `LISTING.md`, one sentence
- [ ] **Permission justifications:** one per permission, from `LISTING.md`; `debugger` needs the sentence about coverage being press-to-start and impossible to make optional
- [ ] **Remote code:** "No, I am not using remote code" — true: no scripts, CSS or fonts are loaded from the network by extension pages (`release-check` proves it)
- [ ] **Data usage:** the extension collects *website content* and *user activity* (clicks, network, console) — **stored locally only**, never transmitted, except when the user presses File/Post to a tracker they configured. Tick nothing under "sold to third parties" or "used for purposes unrelated to the core functionality". Certify the disclosures.
- [ ] Privacy policy URL

## Distribution tab

- [ ] Visibility: Unlisted for the first internal round, Public after
- [ ] Regions: all
- [ ] Pricing: free

## Review notes (the free-text box — write it, reviewers read it)

> QA Wrap is a local-first QA toolkit. It records the tester's own session on the page they are testing; nothing leaves the machine unless the tester presses "File" to a tracker they configured with their own credentials. `<all_urls>` is an optional host permission: the extension holds no site access at install, and access is asked per site when the tester wakes QA Wrap on it (or once for all sites, if the tester chooses). The site under test cannot be known in advance (intranet, staging). `debugger` is used only for the "Measure code coverage" tool, started and stopped by a button, and Chrome shows its own banner while it runs. `tabCapture`/`desktopCapture` are used only when the tester presses Record. A test account is not needed: open any web page, press the toolbar icon, press Start.

## After submission

- [ ] Review usually 1–3 days; a rejection names the policy section — answer it in the same words
- [ ] Publish at 100% (or a percentage rollout for a large install base)
- [ ] Tag the release in git with the version; keep the exact zip that was uploaded in `dist/`
- [ ] Watch the developer dashboard for the first week: crash reports, reviews, the "impressions → installs" ratio

## Edge (same source)

- Edge Add-ons: upload `dist/qa-wrap-<version>-edge.zip`; the same listing text; Edge reviews within ~7 days

## Re-fetch the dated lines by hand (T-056)

- [ ] Before each release, open `site/trust.html` and re-read every dated or numeric line (30-day retention, 3-working-day security acknowledgement, 30-day fix window, the axe-core version) against `PRIVACY.md`, `SECURITY.md`, `SLA.md` and `vendor/README.md`. `tools/test-managed-schema.mjs` checks the test names and the axe hash; the dates and times are read by a person.
- [ ] Vendor comparison pages stay unwritten until the first pilot says what buyers compare us to (a stale dated comparison is a new false claim).

## Vendor-risk answers and rollback (T-074)

- **SBOM, on request:** `node tools/sbom.mjs` writes `dist/sbom-<version>.cdx.json` (CycloneDX 1.5): shipped components (axe-core with its SHA-256, the font families) as required, dev tools as `excluded` (build-only). Send it only when a questionnaire asks.
- **Disclosure:** `site/.well-known/security.txt` (T-033) is the contact and policy; publish it with the site.
- **Store status (read-only):** `node tools/store-status.mjs` calls `fetchStatus` of Chrome Web Store API v2. Credentials only in `~/.config/qa-wrap/chromewebstore.env`; the tool has no upload or publish call and CI never runs it.
- **Staged rollout for the first public release:** after approval, set the deploy percentage low in the Developer Dashboard (or `setPublishedDeployPercentage`, by hand), watch the dashboard and the first reports for a few days, then raise it. Chrome first, then Edge; English first, then Arabic.
- **Rollback, 15 minutes:** the store has no rollback button; the answer is a new, higher patch version holding the previous tree. (1) `git worktree add ../qa-wrap-rollback v<last good>`; (2) there, bump `manifest.json` and `package.json` to the next patch and add a dated `CHANGELOG.md` line "restores v<last good>"; (3) `npm run release` there; (4) upload the zip by hand as in "Before the console"; (5) if the bad version is staged, set its percentage to 0 first. Drill once on the unlisted item before the public release and write the minutes taken in the release record.
