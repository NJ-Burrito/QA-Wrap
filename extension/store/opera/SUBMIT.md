# Submit QA Wrap to Opera add-ons (free)

Nothing here has been submitted and no account was created. You own the Opera account.

Official docs this follows (fetched 2026-10-23):
- Publishing guidelines (what to prepare, category, licence, screenshot sizes, the submit flow): https://dev.opera.com/extensions/publishing-guidelines/
- Acceptance criteria (what the moderators test; note "no redundant permissions"): https://dev.opera.com/extensions/acceptance-criteria/
- Icons: https://dev.opera.com/extensions/effective-icons/
- Upload form (sign in first): https://addons.opera.com/developer/ and the guide's "Upload Extensions form" link

The Opera docs are short on form-field detail. The steps below are the ones the guide states; anything marked (check) is what the form may ask and the page itself wins.

## Upload this file

`dist/qa-wrap-<version>-opera.zip`, made by `node tools/build-browsers.mjs opera` from `extension/` (today `dist/qa-wrap-3.7.1-opera.zip`; build from the release commit). The same build serves Opera GX. If the form refuses a `.zip`, tell the developer: the fallback is to load the unpacked `dist/opera` in `opera://extensions` and pack it to `.crx` there (check).

## Files in this folder

| File | Goes into |
|---|---|
| `listing.en.md`, `listing.ar.md` | Title, summary (one sentence), description, category |
| `permissions.md` | The moderators' permission questions (Opera has no per-permission form that we know of) |
| `images/icon-64x64.png` | Listing icon (64x64, per the icon guide; the 128 in the package is for the browser) |
| `images/screenshots-en-612x408/*.png` (and `-ar-`) | Screenshots at the **preferred** size, 612x408, on white |
| `images/screenshots-en-800x600/*.png` (and `-ar-`) | The **maximum** size, 800x600, if the 612 versions read too small |

The guide says: screenshots 612x408 (preferred), never larger than 800x600, white background, show the extension working. Our 1280x800 shots are fitted into those sizes on white, never stretched.

## Steps

1. Sign in at https://addons.opera.com/developer/ with the Opera account (free; register if none).
2. Open the **Upload Extensions form** and upload `dist/qa-wrap-<version>-opera.zip`.
3. Pick a name and version: Title `QA Wrap`; the version is read from the package.
4. Summary and description: paste from `listing.en.md` (summary is one sentence; the description must not just repeat it). Add the Arabic text from `listing.ar.md` if the form offers a second language (check).
5. Category: **Web Development**.
6. Licence: choose the licence the form offers that matches MIT, or **Custom** with a link to https://github.com/NJ-Burrito/QA-Wrap/blob/main/LICENSE (check); do not take the default CC BY-NC-ND, it is not our licence.
7. Support page / homepage: `https://nj-burrito.github.io/QA-Wrap/`; support: `https://github.com/NJ-Burrito/QA-Wrap/issues`; privacy policy: `https://nj-burrito.github.io/QA-Wrap/privacy.html` (if a field exists).
8. Upload the icon (`images/icon-64x64.png`) and the screenshots (start with the five 612x408 English shots).
9. Notes to moderators (if there is a text box): paste the notes block from `listing.en.md`.
10. On the final page, review all choices and submit. Track it on the **Submitted extensions** page. If it is rejected, the page says which acceptance criterion failed; fix and use the **Upgrade** button beside the package name to resubmit.
11. When published, copy the listing URL (`https://addons.opera.com/extensions/details/<slug>/`).

## After it is live: core/rate-links.js

In `extension/core/rate-links.js` set

```js
export const TODO_OPERA_ADDONS_URL = 'https://addons.opera.com/extensions/details/<slug>/';
```

This one constant also serves the Opera GX build. Then rebuild, bump the version and upload as an update with **Upgrade**. Until then "Rate QA Wrap" opens the GitHub repo.

## Do not

No Opera password or token in the repository, a ticket or a chat.
