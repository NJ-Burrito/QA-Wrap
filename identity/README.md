# QA Wrap — identity kit (Amman edition, September 2026)

Everything the identity is made of, as vector source and generated tokens.
Nothing here is drawn by hand: every mark, every token file and every PNG is
produced by a script in `tools/` from one source file, so the extension, a
website and a slide can never carry three slightly different versions.

## The idea

**The tool is an instrument for evidence, and it comes from Amman.**

- **Limestone and basalt** — Amman's white stone by day, the northern basalt
  by night. The grounds and the ink.
- **The four results are the only colours that speak.** PASS is guac, FAIL is
  Petra sandstone, BLOCKED is Wadi Rum ochre, SKIPPED is slate. Petra is also
  the one action colour, so the thing you must look at is always one hue.
- **The burrito is the mark**, with the seven-pointed star cut into its foil.
  The star alone is the recording indicator.
- **The seal is a designed signature** — the owner's name in Ruq'ah (Aref
  Ruqaa, shaped by fontkit, as outlines), slanted, with an underswash, the star
  as its full stop and the Latin initials beneath. It signs every footer and
  every export. `tools/signature.mjs` makes it.
- **Thmanyah is the only face** (Sans, Serif Text, Serif Display), for text,
  headings, numbers and code. It sets Arabic and Latin from one design. Cairo
  is banned.
- **Three theme states**: Light (limestone), Night (basalt) and Midnight (the
  darker mood: near-black, Petra lit).

Approved from `proposals/2026-09-03-palette-v2.png`. Earlier rounds and the
first identity are kept, not deleted: `proposals/` and `archive/v1-burrito/`.

## Use it in 30 seconds

```html
<link rel="stylesheet" href="identity/tokens/tokens.css">
<link rel="icon" href="identity/icons/favicon.svg">
<img src="identity/logo/lockup-horizontal.svg" alt="QA Wrap" height="40">
```

```css
.cta   { background: var(--accent); color: var(--accent-text); border-radius: var(--r-md); }
.name  { font-family: var(--display); font-weight: 800; }
.fail  { color: var(--fail); }   .pass { color: var(--pass); }
.seal  { mask: url(identity/logo/seal.svg) no-repeat / contain; background: currentColor; }
```

The seal and the star follow the theme through `currentColor` when drawn as a
CSS mask; an `<img>` of an SVG can only follow the OS scheme.

## What's here

| Path | What it is |
|---|---|
| `logo/mark.svg` | **The mark.** The burrito, foil, star. Transparent ground. |
| `logo/mark-mono.svg` | One colour, on `currentColor`. Stamps, watermarks. |
| `logo/wordmark.svg` | `QA Wrap` in Thmanyah Serif Display Black, **as outlines**. |
| `logo/seal.svg` · `signature/signature*.svg` | The designed signature: Ruq'ah outlines, swash, star, initials; a `currentColor` variant for masks. |
| `logo/lockup-horizontal.svg` · `lockup-stacked.svg` | Mark + wordmark; stacked adds the seal. |
| `icons/favicon.svg` · `app-icon.svg` | The mark on the Petra ground. `app-icon-small.svg` drops the star for 16–32 px. |
| `icons/star.svg` | The seven-pointed star alone, `currentColor`. |
| `palette/palette-sheet.svg` | Every colour as a vector swatch with its variable name. |
| `tokens/` | The palette in six formats, three theme states. |
| `proposals/` | The review sheets, kept as assets. |
| `archive/v1-burrito/` | The first identity: avatars, badges, portrait pipeline. |
| `dist/` | Generated: `icon16/32/48/128/512.png`, `contact-sheet.png`. |
| `tools/` | The build. Everything above is regenerated from here. |

## Tokens

| File | For |
|---|---|
| `tokens/tokens.css` | CSS variables: `:root` light, `prefers-color-scheme` dark, `[data-theme="dark"]`, `[data-theme="midnight"]`. **Start here.** |
| `tokens/tokens.scss` · `tokens.json` · `tokens.mjs` · `tokens.cjs` · `tailwind.preset.cjs` | The same values for every stack. |

All from **`tools/tokens.source.mjs`**. Edit that file, re-run, never hand-edit
a generated file. Semantic names: `--accent`, `--pass`, `--fail`, `--blocked`,
`--skipped` (each with `-soft`); `--ok / --danger / --warn / --info` remain as
aliases so older CSS keeps working.

## Comfort, verified

`node tools/ergonomics.mjs` checks every on-screen text pair for WCAG AA in all
three states, plus the two things AA does not cover: large surfaces stay below
OKLCH chroma 0.045, and body contrast stays in the 7-13:1 band. The kit ships
with the audit green.

## Watermarks

`node tools/watermark.mjs` stamps every asset in `logo/`, `icons/` and `dist/`
with three layers: declared rights metadata (Dublin Core in SVG, `tEXt` in PNG),
a verifiable token (SHA-256 over the owner line and the drawing — editing the
drawing breaks it), and a hidden signature (an invisible path in SVG, the owner
string in the blue channel's low bit in PNG). `--verify` reads them back.

## Rebuilding

```bash
node tools/tokens.mjs             # six token formats + the palette sheet
node tools/ergonomics.mjs         # the comfort and AA audit
node tools/marks.mjs              # mark, mono, favicon, app icons, star
node tools/signature.mjs          # the seal: the designed signature
node tools/wordmark.mjs           # wordmark, lockups (outlines)
node tools/preview.mjs --icons    # dist/icon16..512.png
node tools/watermark.mjs          # stamp + verify every asset
node tools/extension-tokens.mjs   # -> extension/ui/identity-tokens.css
node tools/preview.mjs            # dist/contact-sheet.png
```

Then copy `logo/*.svg`, `icons/favicon.svg`, `icons/star.svg` to
`extension/brand/` and `dist/icon*.png` to `extension/icons/`.

## The brand kit (4 September 2026)

- `BRAND.md` — the guide: names, marks, colour, type, mascot, voice, sound and motion, provenance.
- `tools/product-lockup.mjs` → `logo/qa-wrap-*.svg` — the product wordmark and lockups ("QA Wrap / by {maker}", from `meta.byline`, which reads `extension/brand/brand.json`), Thmanyah Serif Display Black + Sans Medium as outlines; the horizontal one is copied to `extension/brand/lockup.svg`.
- `tools/brand-board.mjs` → `dist/brand-board.svg` + `.png` — the nine-panel board (mark, construction, in the browser, promise, colour, type, sticker and badge, image direction, system detail), drawn from the same files the product ships with.
- The seven-pointed star is gone from every mark, icon, scene and effect: it read as another company's logo. `marks.mjs` no longer writes it.
