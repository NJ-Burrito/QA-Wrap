# Submit QA Wrap to Firefox Add-ons (AMO, free)

Nothing here has been submitted and no account was created. You own the AMO account (a Firefox Account).

Official docs this follows (fetched 2026-10-23):
- Submitting an add-on, listed and self-distributed: https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- Signing and distribution overview: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- `web-ext sign`: https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- Data-collection manifest key (already set in this package): https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- Source-code submission: this repository's `store/FIREFOX-SOURCE-SUBMISSION.md`

## Upload this file

`dist/qa-wrap-<version>-firefox.zip`, made by `node tools/build-browsers.mjs firefox` from `extension/` (today `dist/qa-wrap-3.7.1-firefox.zip`; build from the release commit so the version matches). It already carries the add-on id `qa-wrap@qa-wrap.invalid`, `strict_min_version` 140.0 and `data_collection_permissions` (required: none).

## Files in this folder

| File | Goes into |
|---|---|
| `listing.en.md`, `listing.ar.md` | Describe Add-on page: name, summary, description, notes to reviewer |
| `permissions.md` | Notes to reviewer / the reviewer's questions; Firefox shows no per-permission form |
| `images/icon-128x128.png` | Listing icon (AMO also takes it from the manifest icon) |
| `images/screenshots-en/*.png`, `images/screenshots-ar/*.png` | Screenshots, 1280x800 PNG, in story order 1 to 5 |

AMO does not publish a fixed screenshot size in the pages above; 1280x800 is the size already used for the other stores.

## A. Listed on AMO (recommended)

1. Go to https://addons.mozilla.org/developers/ and sign in (create the Firefox Account if you have none; free).
2. Click **Submit Your First Add-on** (or **Submit a New Add-on**).
3. Choose **On this site** (listed). Click **Continue**.
4. **Select a file**: `dist/qa-wrap-<version>-firefox.zip`. Wait for the validator. Warnings are allowed; read the security/privacy ones and send any to the developer. An error stops you: send it to the developer.
5. Select compatible platforms: **Firefox** (leave **Firefox for Android** unticked; it is untested). Click **Continue**.
6. "Do you need to submit source code?" The package is plain unminified source, with no bundler or minifier, but the build script copies and rewrites the manifest. Answer **Yes** and upload a zip of the repository at the release commit (`git archive --format=zip -o qa-wrap-source.zip HEAD`); paste the build command from `store/FIREFOX-SOURCE-SUBMISSION.md` in the reviewer notes. Click **Continue**.
7. **Describe Add-on** page, paste from `listing.en.md`:
   - Name: `QA Wrap`
   - Add-on URL: accept `qa-wrap` or choose another; note the final slug for step 12.
   - Summary (max 250 characters), Description.
   - Experimental: leave unticked. Requires payment: leave unticked.
   - Categories (up to 2): **Web Development** (second optional: Other). Android categories: skip.
   - Support email: leave empty or use the public contact you choose (it is shown publicly); **Support website**: `https://github.com/NJ-Burrito/QA-Wrap/issues`.
   - License: **MIT License**.
   - Tick **This add-on has a privacy policy** and paste `https://nj-burrito.github.io/QA-Wrap/privacy.html` (check it loads first).
   - **Notes for Reviewers**: paste the notes block from `listing.en.md`, and add the build command and `permissions.md`.
8. Click **Submit Version**. You get a confirmation email; review can follow publication.
9. Open the add-on's **Edit Product Page**: upload the five English screenshots from `images/screenshots-en/`, set the homepage `https://nj-burrito.github.io/QA-Wrap/`.
10. Arabic: on the same page choose **Manage Translations** (locale **ar**) and paste name, summary and description from `listing.ar.md`; screenshots stay shared (the `screenshots-ar` set can be uploaded for the Arabic locale if the page offers a per-locale caption).
11. Updates later: upload the new version on this add-on's own page, never as a new add-on.
12. When it is public, the URL is `https://addons.mozilla.org/firefox/addon/<slug>/`.

## B. Self-distributed (signed, not listed)

Use this if you want a signed file to hand out from GitHub releases, without a public AMO page.

1. Via the website: https://addons.mozilla.org/developers/ -> Submit a New Add-on -> **On your own** -> **Continue**, then steps 4 to 6 above. Open "My Submissions"; you get an email when it is signed; open the version, right-click the file link, **Save Link As...** to get the signed `.xpi`.
2. Or with the command line (needs Node and the AMO API credentials from https://addons.mozilla.org/developers/addon/api/key/ ; keep both values out of the repository and out of shell history files):

```
npx web-ext sign --source-dir dist/firefox --channel=unlisted --api-key=<JWT issuer> --api-secret=<JWT secret>
```

   `--channel` is required. The signed file lands in `web-ext-artifacts/`. To let Firefox update a self-distributed copy, add `browser_specific_settings.gecko.update_url` pointing at an update manifest (see the signing overview above); the current build has none, so a self-distributed copy is updated by hand.

## After it is live: core/rate-links.js

In `extension/core/rate-links.js` set

```js
export const TODO_AMO_URL = 'https://addons.mozilla.org/firefox/addon/<slug>/';
```

Then rebuild, bump the version and upload that build as the next version on the add-on's page. Until then "Rate QA Wrap" opens the GitHub repo.

## Do not

No AMO API key or secret, no account password, in the repository, a ticket or a chat.
