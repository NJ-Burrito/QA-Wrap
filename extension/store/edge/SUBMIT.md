# Submit QA Wrap to Microsoft Edge Add-ons (free)

Nothing here has been submitted and no account was created. You own the Partner Center account; this pack is what you paste and upload.

Official docs this follows (fetched 2026-10-23): https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension and https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account . If a screen differs from the numbers below, the live page wins.

## Upload this file

`dist/qa-wrap-<version>-edge.zip`, made by `node tools/build-browsers.mjs edge` from `extension/` (today `dist/qa-wrap-3.7.1-edge.zip`; the release build carries the release version). Build it from the release commit, not from this branch's version if the version has moved.

## Files in this folder

| File | Goes into |
|---|---|
| `listing.en.md`, `listing.ar.md` | Store listings, one "Details for <language>" page each: name, description, search terms, notes for certification |
| `permissions.md` | Privacy page, one box per permission |
| `images/logo-300x300.png` | Extension logo (1:1, 300x300; minimum 128x128) |
| `images/promo-small-440x280.png` | Small promotional tile (440x280, optional) |
| `images/promo-large-1400x560.png` | Large promotional tile (1400x560, optional) |
| `images/screenshots-en/*.png`, `images/screenshots-ar/*.png` | Screenshots, 1280x800, up to 6 per language (we have 5, in story order 1 to 5) |

## Steps

1. Open Partner Center for Edge: https://partner.microsoft.com/dashboard/microsoftedge/public/login?ref=dd and sign in with the developer account. If it does not exist yet, register first (free): https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account .
2. On Overview, click **Create new extension**. The "Upload package (.zip file)" page opens.
3. Drag `dist/qa-wrap-<version>-edge.zip` onto the page (or **Browse your files**). Wait for "verified"; if there is a validation error, stop and send it to the developer.
4. Click **Continue**. The **Availability** page opens: Visibility = **Public** (use **Hidden** first if you want a dry run), Markets = leave all. Click **Save & Continue**.
5. **Properties** page: Category = **Developer Tools**; Website = `https://nj-burrito.github.io/QA-Wrap/`; Support contact detail = `https://github.com/NJ-Burrito/QA-Wrap/issues`; Mature content = leave unchecked. Save.
6. **Privacy** page (every answer must match the product, per the docs):
   1. Single purpose: paste `Record a browser test session, explain what failed, and hand over a record of it: a timeline, the cause of each failure, and the standard test documents.`
   2. Permission justification: one box per permission; paste the row text from `permissions.md`.
   3. Remote code: **No**.
   4. Data usage: tick what `store/LISTING.md` "Privacy" says (website content, user activity, authentication information; stored locally, transmitted only when the user presses File/Send). Do not tick sold to third parties, unrelated use, or creditworthiness. Certify.
   5. Privacy Policy URL: `https://nj-burrito.github.io/QA-Wrap/privacy.html` (open it in a browser first and check it loads).
7. **Store listings**: click **Edit details** on the English row. Paste Extension name and Description from `listing.en.md`; upload the logo, both promo tiles and the five `screenshots-en` shots; paste the search terms. Save.
8. Add Arabic: on Store listings add the Arabic language, then **Edit details** on its row; paste from `listing.ar.md`; upload the same logo and tiles (use **Duplicate**) and the five `screenshots-ar` shots. The short description is the manifest's, so it stays English (store limitation, per the docs).
9. When every row reads **Complete**, click **Publish** (top right). On "Submit your extension", paste the "Notes for certification" block from `listing.en.md`, then **Publish** again.
10. Certification takes up to seven business days. When the status reads **In the Store**, copy the listing URL from the Extension overview page.

## After it is live: core/rate-links.js

In `extension/core/rate-links.js` set

```js
export const TODO_EDGE_ADDONS_URL = '<the Edge listing URL from step 10>';
```

(the form is `https://microsoftedge.microsoft.com/addons/detail/<name>/<id>`). Then rebuild, bump the version and upload the new zip as an update (Partner Center: the extension, **Update**), because the rate link is baked in at build time. Until then "Rate QA Wrap" opens the GitHub repo.

## Do not

Do not put the Partner Center login, a client ID or an API key in the repository, a ticket or a chat. The repository is public.
