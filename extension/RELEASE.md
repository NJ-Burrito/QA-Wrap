# Releasing QA Wrap

The build that leaves the building is a zip made by scripts, checked by a
script, and uploaded by a person. Nothing in it is hand-assembled.

```
npm run test:release-gate                # THE gate: every suite incl. the by-hand ones, then test:a11y, then the clickthrough (headed)
node tools/smoke.mjs                     # boot and record, headed
node tools/manifest-check.mjs            # Chrome loads it with no warning
npm test                                 # quick check only (node-only, no browser): it skips the by-hand suites and test:a11y
npm run test:chain                       # a fixed chain of node tools, not the gate
npm run release                          # build Chrome and Edge + package + release-check
npm run build:all                        # on demand: the other six targets (not part of a release)
```

The gate line is `npm run test:release-gate`. It passes only when it exits 0 and its first stage prints
`run-suites: <N> suites, 0 red` with `red: (none)` under it, then `test:a11y` and the clickthrough finish clean.
Paste that exit line into the release note; green on `npm test` alone is not a release.

`npm run release` leaves:

One store package, plus the two browsers QA Wrap is released for: **Chrome and
Edge**. `npm run build:all` (or `npm run build -- all`) builds every other target in
`TARGETS` (`core/capabilities.js`) on demand, and `release-check.mjs` checks them
when they are present and never requires them. None of them is a supported or
advertised browser; Firefox cannot run the filing doors (they need
`chrome.offscreen`) and Safari is a folder, not a package: turning it into one needs
`xcrun`, which needs Xcode, which needs macOS, and a package produced by
something other than the tool that has to produce it is a claim rather than an
artefact.

| Artefact | Zip? | For |
| --- | --- | --- |
| `dist/qa-wrap-<version>.zip` | yes | the Chrome Web Store developer console; this is the upload |
| `dist/qa-wrap-<version>-chrome.zip` | yes | the same tree plus `BROWSER.md`; the matrix's reference build |
| `dist/qa-wrap-<version>-edge.zip` | yes | Microsoft Edge Add-ons |
| `dist/qa-wrap-<version>-brave.zip` | yes | Brave. Chromium, normally installed from the Chrome Web Store |
| `dist/qa-wrap-<version>-opera.zip` | yes | Opera add-ons, which reviews separately |
| `dist/qa-wrap-<version>-operagx.zip` | yes | Opera GX. The same build as Opera |
| `dist/qa-wrap-<version>-duckduckgo.zip` | yes | the DuckDuckGo desktop browser |
| `dist/qa-wrap-<version>-firefox.zip` | yes | Firefox AMO. Event page, no `sidePanel`/`side_panel`/`key`, and recording, GIF, full-page stitching and coverage removed (no API) |
| `dist/safari/` | **no** | on a Mac with Xcode: `xcrun safari-web-extension-converter ./safari`, then build the Xcode project it writes |

Every zip that was built is opened and checked by `release-check.mjs`, not believed: its whole
file-name set must equal the store package's plus `BROWSER.md`. A count alone
would pass a package that swapped one file for another, which is how a Brave zip
once shipped at 151 of 152 entries with `vendor/axe.min.js` missing.

What the zip contains: the extension folders (`background/`, `content/`,
`popup/`, `report/`, `options/`, `diagram/`, `sidepanel/`, `devtools/`,
`annotate/`, `offscreen/`, `core/`, `platform/`, `ui/`, `brand/`, `icons/`, `vendor/`),
the manifest, and the shipping documents (`README.md`, `LICENSE`, `NOTICE`,
`CHANGELOG.md`, `PRIVACY.md`, `SECURITY.md`, `SUPPORT.md`, `SLA.md`,
`ROADMAP.md`), the list in `tools/lib-ship.mjs`. There is exactly **one**
licence file and it is `LICENSE`; a second one, `LICENSE.md`, used to ship
beside it naming a different rights holder, and `release-check.mjs` now fails
the build if either comes back.

It never contains `keys/`, `tools/`, `node_modules/`, `store/`, `research/`, a
browser profile, a source map, a dot-file, or a Markdown working note at any
depth, and `tools/release-check.mjs` fails the build if one slips in.

## Versioning

`major.minor.patch`, dotted integers only (the store rejects anything else).
Bump `manifest.json` and `package.json` together; the build reads the
manifest. Add the entry to `CHANGELOG.md` under the version and the date.
The extension ID never changes: it is fixed by the `key` in the manifest,
whose private half lives in `keys/` and is never packaged.

## Which targets a release gates

`npm run release` builds and gates **Chrome and Edge** only. A zip of any other target left in `dist/` (Brave, Opera,
Opera GX, DuckDuckGo, Firefox, from `npm run build:all`) is ignored by the release; `node tools/release-check.mjs --all`
checks those too. Old versions' zips in `dist/` are never read.

## Uploading (by hand)

1. `chrome.google.com/webstore/devconsole` → the item → **Package** → upload `dist/qa-wrap-<version>.zip`.
2. Store listing, privacy practices, distribution: follow `store/CHECKLIST.md`; the text is in `store/LISTING.md`.
3. Submit for review. Keep the exact zip in `dist/` and tag the commit.

## What the reviewer will ask about

`<all_urls>`, `debugger`, `tabCapture`, `desktopCapture`, `cookies`. Each has
a justification in `store/LISTING.md`; the review-notes paragraph in
`store/CHECKLIST.md` says them in three sentences. The honest answers are
the ones that pass: the tool works on whatever site is under test, and it
never sends anything anywhere unless the tester presses a button that says so.

## Publishing a release (update notifications)

1. Put the GitHub owner and repository in `core/update-source.json` (`{ "repo": "owner/name" }`); while it says `OWNER/REPO` the extension makes no update request.
2. Add the `## x.y.z, date` section to `CHANGELOG.md`, set the same version in `manifest.json`, commit.
3. Tag the commit `vx.y.z` and send the tag to GitHub. `.github/workflows/release.yml` builds the zips and creates the release with that CHANGELOG section as its notes (`node tools/release-notes.mjs vx.y.z` previews it).
