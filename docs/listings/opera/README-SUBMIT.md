# QA Wrap on Opera add-ons and Opera GX: the submission pack

Prepared 2026-10-28 for QA Wrap 3.8.4. Nothing was submitted, no account was created, nobody logged in. Nader does every click below.

## First: is a submission already open?

`docs/DISTRIBUTION.md` records an Opera submission on 2026-10-23 ("in review"). On 2026-10-28 the public store had no QA Wrap page
(`https://addons.opera.com/extensions/details/qa-wrap/` answered 404, and a store search for "qa wrap" listed other extensions).

- If **Submitted extensions** on https://addons.opera.com/developer/ shows QA Wrap: do **not** upload a second extension. Use
  **Upgrade** on that entry with the 3.8.4 zip below (Opera's acceptance criteria name the Upgrade button as the resubmit path).
- If nothing is there: follow "New submission" below.

## What is in this folder

| File | What it is | Goes into |
|---|---|---|
| `package/qa-wrap-3.8.4-opera.zip` | The store build, made by `node tools/build-browsers.mjs --store opera` from `extension/` (no `key`, no `updater/`, no `types/`). 372 files, 2.8 MB. | The upload field |
| `package/SHA256SUMS.txt` | SHA-256 of the zip | Keep, to prove which file was sent |
| `listing.en.md` | Name, summary, description, category, URLs, notes for the moderators (English) | General tab, English |
| `listing.ar.md` | The same in Arabic (diacritics removed) | Translations tab, Arabic, if offered |
| `permissions.md` | One line per permission, read from the built manifest | Notes box, or a moderator's question |
| `images/icon-64x64.png` | Store icon, 64x64, from `extension/icons/icon512.png` | Media tab, icon |
| `images/screenshots-en-612x408/` (5) | Opera's preferred size, store shots fitted on white, never stretched | Media tab, screenshots |
| `images/screenshots-ar-612x408/` (5) | The Arabic shots at the same size | Arabic translation, if it takes its own screenshots |

No source zip is included: the package is the plain source with no bundler or minifier. The one minified file is
`vendor/axe.min.js`, the unchanged axe-core 4.13.0 release (SHA-256 `c24f097b...70a0c1`, the same hash as `extension/vendor/README.md`);
Opera asks that well-known libraries be "genuine and unchanged", and the notes say where it comes from. If a moderator still asks
for source, give https://github.com/NJ-Burrito/QA-Wrap (tag `v3.8.4`).

## New submission (Opera add-ons, also serves Opera GX)

1. Sign in at https://addons.opera.com/developer/ with your Opera account (create one there if you have none).
2. Upload `package/qa-wrap-3.8.4-opera.zip`. The version (3.8.4) is read from the package. If the form says "Manifest format version
   is not supported" or "content_security_policy must be a string", stop and tell me: those are the old MV3 upload errors developers
   reported on Opera's forum, and our manifest is standard MV3.
3. Open the **Versions** tab and click `3.8.4` to edit it. The fields live in the **General**, **Media** and **Translations** tabs.
4. General: Name `QA Wrap`. Summary: the one sentence from `listing.en.md`. Description: the long block from `listing.en.md`.
   Category: **Web Development**. Homepage or support page: `https://nj-burrito.github.io/QA-Wrap/`. Privacy policy, if there is a field:
   `https://nj-burrito.github.io/QA-Wrap/privacy.html`.
5. Licence: pick MIT if listed, else the custom option with https://github.com/NJ-Burrito/QA-Wrap/blob/main/LICENSE. Do not keep the
   default CC BY-NC-ND 4.0; it is not QA Wrap's licence.
6. Media: upload `images/icon-64x64.png`, then the five shots in `images/screenshots-en-612x408/` in file-name order.
7. Translations: add Arabic and paste the summary and description from `listing.ar.md`. Skip if the tab offers no Arabic.
8. Notes for the moderators, if there is a box: paste the notes block from `listing.en.md`, then the line
   "vendor/axe.min.js is the unchanged axe-core 4.13.0 release, SHA-256 c24f097bd2f451d4f933e8bc7d8d539f8672a2ebcb5cc9f9f3eec8ca9470a0c1."
9. Review the last page and submit. Watch **Submitted extensions**. A rejection names the failed criterion; fix it and use **Upgrade**.
10. When it is published, send me the listing URL. I then set `TODO_OPERA_ADDONS_URL` in `extension/core/rate-links.js` (one constant
    serves Opera and Opera GX) for the next release.

## Opera GX users: how they get it

| Route | Works? | What the user clicks |
|---|---|---|
| Opera add-ons store | Yes, once the listing is live. GX installs from the same store and the same build. | The listing page, **Add to Opera** |
| GitHub release, unpacked | Yes today (same code as the store build; the store build was what was tested, below). | Download `qa-wrap-3.8.4-operagx.zip` (or `-opera.zip`) from https://github.com/NJ-Burrito/QA-Wrap/releases/latest, unzip, open `opera://extensions`, switch on **Developer mode**, **Load unpacked**, pick the folder |
| Chrome Web Store | Not available: QA Wrap is not on the Chrome Web Store (`DISTRIBUTION.md`: paid fee, skipped). GX can install Chrome Web Store extensions, but forum users report failures on the new store address, so it would not be our main route anyway. | n/a |
| GX.store Mods | Not relevant. A GX Mod is a manifest plus sounds, music, wallpapers, themes, shaders and page CSS; it carries no extension code, so a QA tool cannot be a Mod. | n/a |

## What was tested in Opera GX (2026-10-28, one run)

Opera GX 137.0.6036.65 (Chromium 153, user agent `OPR/137.0.0.0`), throwaway profile under `O:\Temp`, closed and removed after the run.
The store build `dist/opera` (3.8.4, the zip in `package/`) was loaded unpacked and driven by Playwright (`tools/lib-e2e.mjs`, the repo's own Opera harness). Raw output: `evidence/run.log`, `evidence/api-probe.json`, `evidence/copied-report.md`.

| Check | Result |
|---|---|
| Service worker boots, popup reaches ready | pass |
| Idle popup: no raw i18n key, no "undefined" | pass |
| One recorded session on the packaged Bug Hunt page: Start, level 1 (Save), level 2 (coupon), Stop | pass |
| Done card counts the problems | pass (2, the two planted) |
| Copied report: title, failed `POST /api/save-profile 500`, the uncaught coupon error | pass |
| Page errors on the popup pages | none |
| `chrome.sidePanel` | **absent** in Opera GX; the side-panel button is hidden, the float window is used instead |
| `offscreen`, `debugger`, `downloads`, `tabCapture`, `system.display` (2 displays), `webRequest`, `notifications`, `contextMenus`, `scripting.registerContentScripts`, `runtime.getContexts`, `action.getUserSettings`, `storage.session.setAccessLevel` | present |
| `storage.sync` | round trip works |
| `storage.managed` | `get` returns `{}` (no policy); does not throw |
| `desktopCapture`, `runtime.connectNative` | absent until the user grants the optional permission (expected; not tested further) |
| Recording a video, coverage, the agent bridge | not tested |

## Risks

1. **Redundant permission.** The Opera build declares `sidePanel` and a `side_panel` key, but Opera GX has no `chrome.sidePanel`.
   Opera's criteria say "no redundant permissions requested or unnecessary manifest entries". If a moderator rejects on this, the fix is
   one line in `extension/tools/targets.mjs` (drop `sidePanel` and `side_panel` for `opera` and `operagx`) and a rebuild. Not done here:
   this pack changes no product code and bumps nothing.
2. **Review time is unknown.** Opera's pages state none; developers on Opera's forum report long or indefinite waits.
3. **Agent bridge on the store build.** The store build has no `key`, so Opera assigns a new extension id. The bridge would need
   `npx qa-wrap-bridge install --extension-id <id from opera://extensions>`, and whether Opera on Windows reads the bridge's Chrome
   registry entry is not verified.
4. **Listing field limits.** Opera publishes no character limits for name, summary or description; the form itself is the authority.

## Sources (read 2026-10-28)

- Publishing guidelines (category list, licence default, screenshot 612x408 preferred, 800x600 maximum, white background, Upload form,
  Submitted extensions page): https://help.opera.com/en/extensions/publishing-guidelines/
- Acceptance criteria (no minified code without a source link, genuine unchanged libraries, no redundant permissions, no external
  JavaScript, interlaced PNG not supported, Upgrade to resubmit): https://help.opera.com/en/extensions/acceptance-criteria/
- Supported APIs (identity: only `launchWebAuthFlow`; storage `sync`/`managed` listed as differences; no sidePanel or offscreen row):
  https://help.opera.com/en/extensions/apis/
- Loading unpacked in Developer mode: https://help.opera.com/en/extensions/testing/
- Icon design (no listing size stated): https://help.opera.com/en/extensions/effective-icons/
- Store icons are served as `icon_64x64` (observed on a live listing): https://addons.opera.com/en/extensions/details/web-developer/
- Where the listing fields are after upload (Versions, then General, Media, Translations): https://forums.opera.com/topic/42938/solved-submit-new-extension
- MV3 uploads: first refused, later enabled (forum, undated): https://forums.opera.com/post/271608, https://forums.opera.com/post/258841,
  https://forums.opera.com/post/276702
- GX and the new Chrome Web Store address (forum, around late 2023): https://forums.opera.com/post/333412
- GX Mods content: https://github.com/opera-gaming/gxmods (documentation/mods.md)
