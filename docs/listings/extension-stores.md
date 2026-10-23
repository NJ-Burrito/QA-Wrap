# QA Wrap extension stores: where each pack is

The store packs already exist (commit 9b9486a): `extension/store/<store>/SUBMIT.md` has the click-by-click steps, `listing.en.md` and `listing.ar.md` the texts, `images/` the files. Nothing here was submitted. Build commands run from `extension/`.

| Store | Pack | Zip to upload |
|---|---|---|
| Microsoft Edge Add-ons | `extension/store/edge/` | `node tools/build-browsers.mjs edge` |
| Firefox AMO | `extension/store/firefox/` (source submission: `extension/store/FIREFOX-SOURCE-SUBMISSION.md`) | `node tools/build-browsers.mjs firefox` |
| Opera add-ons | `extension/store/opera/` (check its `SUBMIT.md`) | `node tools/build-browsers.mjs opera` |
| Chrome Web Store | `extension/store/LISTING.md`, `extension/store/CHECKLIST.md` | `node tools/package.mjs` |

Chrome Web Store is not free: Google's page (https://developer.chrome.com/docs/webstore/register) says "pay a one-time registration fee"; the amount is not on that page (search results say 5 USD, not verified). It stays outside the free kit.
