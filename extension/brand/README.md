# Brand: one file to edit

`brand.json` is the only place a person edits the product's identity: name, owner, publisher, website,
mailboxes, tagline. Then run `node tools/build-brand.mjs --write` (from `extension/`) and commit.
`node tools/build-brand.mjs --check` (also `node tools/test-brand-sync.mjs`) fails if any generated
region differs from `brand.json`.

Rules (owner decisions, Nader, 2026-10-14):

- `maker` / `publisher` hold the owner's name in English and Arabic. The Arabic form is used in Arabic strings.
- Every URL and email may be empty. A surface that reads an empty value hides its link; nothing falls back to another domain.
- `madeBy` templates produce the footer strings in both languages; `{maker}` is replaced per language.
- `reviewUrl` / `listed`: the rating link is shown only when `listed` is true.

Generated regions (do not hand-edit between the markers):

| Target | Region |
|---|---|
| `core/product.js` | between `// brand:begin` and `// brand:end` |
| `manifest.json` | `name`, `short_name`, `action.default_title`, `homepage_url` (omitted while empty) |
| `platform/i18n/en.json`, `ar.json` | `common.madeBy`, `options.foot.madeBy`, `popup.foot.by`, `report.foot.madeBy` |
| HTML footers | fallback text of the `data-i18n` spans above, `#about-maker`, the welcome head and foot |
| `platform/console-brand.js` | the `by` strings in `WORDS` |

Why a generator: `manifest.json`, the i18n JSON files and classic scripts cannot import a module.
