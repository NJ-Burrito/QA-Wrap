# QA Wrap brand guide

Two names, two jobs. **QA Wrap** is the product, and the only one a tester
needs. **the maker** (`maker` and `publisher` in `extension/brand/brand.json`, the one place to edit) is the owner and the publisher: it appears where a
person asks "who made this, and who do I write to?", and it is the name on the
rights line, the provenance stamp and every footer. These are the two names in
`meta` (`identity/tools/tokens.source.mjs`), and this document holds no third.

There used to be a third — **NJ-Burrito**, called the product line. It was
written into the by-line under the wordmark, and that lockup sits on the cover
of every document this product hands to a client, so a reader was asked to work
out which of two names was the product and which was the maker. A product line
that only ever appears beside the product is not a category, it is a second
name for the same thing. It is retired from everything a person reads. What
stays is what a rename would break for no gain: the `njb` file prefixes, the
`njbWorkspace` storage key, and the `globalThis.njb` console handle, all of
which are identifiers rather than words.

Written together, product and owner are the lockup, always in that order:
**QA Wrap by {maker}**. Version 3.1.0, identity "Salsa & Slate, Amman
edition", mark redrawn 4 September 2026.

## 1. The idea

A wrap closes a session (every click, request, error and screenshot) into one
thing you can hand over. The mark says exactly that: **an open ring with
a check coming out of it**. The ring is the wrap and has a seam, because a
wrap does; the check starts inside it and leaves through the seam, because
that is what a report is: evidence going out as an answer. Together they
draw a **Q**, the product's initial, drawn rather than typed.

The palette is Jordan: Petra sandstone, limestone, basalt, Wadi Rum ochre.
No star, no asterisk, no spark: those read as other companies' marks. The
tone is a good colleague: plain, warm, specific, never loud.

## 2. Names, and how they are written

| Context | Write | Never |
| --- | --- | --- |
| Product, anywhere a person reads it | **QA Wrap** | QA-Wrap, QAWrap, qa wrap, "the extension" |
| With the by-line (lockup, store tile, documents) | **QA Wrap by {maker}** | a product line in the by-line, or the owner's name ahead of the product's |
| The publisher (page footers, About, film end card) | **Made by {maker}** | a spelling that is not the one in brand.json |
| Rights line | © 2026 {maker}. All rights reserved. | a different name from brand.json |
| Product code (labels, filenames, tickets) | `QAW`, `QAW-3.1.0` | `njb` in anything a person reads; it is an identifier, and it stays only in file prefixes and storage keys |
| Folder on disk | `QA Wrap/` | anything with the maker in it |
| Extension ID | `dbdhilacpjeojfnmdbnpcbmohkhgaihn` | quoting a different one from an unpacked copy |

### Where the publisher is named

Three places, and nowhere else. The rule exists because a credit repeated on
every surface stops reading as a signature and starts reading as an
advertisement, which is the thing the product's tone avoids.

| Place | How it reads |
| --- | --- |
| The footer of every page the product opens | `QA Wrap · Made by {maker}` |
| The About card in Settings | `Made by  {maker}` — one row, no product line |
| The end card of each tutorial film | the maker's logo when brand.json supplies one, under the product lockup |

Not in the popup body, not on a report, not on an exported document, not
painted onto a screenshot. Exported files carry the publisher in metadata
instead. See §10.

## 3. The marks

| Asset | File | Use |
| --- | --- | --- |
| Mark | `logo/mark.svg` (light ground), `logo/mark-dark.svg` (dark ground), `mark-mono.svg` (one colour, `currentColor`) | toolbar icon, favicon, the corner of every surface |
| Mark, animated | `logo/mark-motion.svg`, `logo/mark-motion-dark.svg` → `extension/brand/` | the two states in §4, and nothing else. Never on a cover or a store tile |
| Mark, heavy | `icons/app-icon-small.svg` | 16–24 px only: a heavier stroke, because a hairline disappears there |
| Product wordmark | `logo/qa-wrap-wordmark.svg` (host-led), `-light.svg`, `-dark.svg` | a document title, a store header |
| Lockup, horizontal (drawn as outlines: "QA Wrap" in Thmanyah Serif Display Black, the by-line in Thmanyah Sans Medium; D-1010-43) | `logo/qa-wrap-lockup.svg` (host-led) → `extension/brand/lockup.svg`; `-light.svg`, `-dark.svg` | headers, promo tiles, document covers |
| Lockup, stacked | `logo/qa-wrap-lockup-stacked.svg` (host-led), `-light.svg`, `-dark.svg` | square spaces |
| App icon | `icons/favicon.svg`, `icons/app-icon.svg` → `extension/icons/icon*.png` | the browser and the store |
| Construction | `logo/construction.svg` | the grid, the radii, the angles, for anyone redrawing it |

**Geometry** (64 grid): ring centre 30,30, radius 17, stroke 7; seam centred
on the 45° diagonal, ±28°; check 36,36 → 42.5,44 → 55,20; the whole group
nudged −2,+3.5 to sit optically centred. One stroke weight, round caps, no
gradient, no shadow.

**Rules.** The check never crosses the ring's stroke, because a bar through a ring
is a "prohibited" sign. The mark never rotates, never gains a shadow, never
sits on Petra unless it is the limestone version. Clear space is the ring's
stroke × 3. Minimum 16 px for the mark, 18 px high for the lockup. The
by-line is never bolder than the wordmark, never more than a third of its
size, and always dimmed.

### Which colour a mark takes

**A mark's colours follow its host, never the machine.**

No mark carries `@media (prefers-color-scheme: dark)` any more. Every one of
them used to, and it was the wrong question asked well: the media query reports
what the reader's *operating system* is set to, and a mark sits on a *ground*.
When the two disagree, the mark loses. Measured on 5 September 2026, a reader
whose OS was in night mode opening the wordmark on a white page got near-white
ink on white: **1.20:1**, against the 4.5:1 a word must clear. The mark and the
lockup measured 2.30:1.

So each shape ships in three forms, and the placement picks one on purpose:

| Form | File | Colours | Pick it when |
| --- | --- | --- | --- |
| Light ground | `<name>.svg` for the mark, `<name>-light.svg` for the wordmark and lockups | basalt ink, Petra accent | the ground behind it is paper, limestone or white |
| Dark ground | `<name>-dark.svg` | limestone ink, night Petra | the ground is basalt or darker |
| Host-led | `mark-mono.svg`; `<name>.svg` for the wordmark and lockups | `currentColor`, accent `var(--bad, #B5432B)` | the mark is **inlined** into a document, where the host's own text colour is already the right answer |

Who picks, today:

- **The extension.** `ui/identity-tokens.css` swaps `<img class="brand-mark">`
  between `mark.svg` and `mark-dark.svg` by the extension's own theme — the one
  the tester chose — with `content: url(…)`. The `src` attribute is untouched,
  so `ui/motion.js` keeps driving the wake and the recording breathe through it,
  fragment and all.
- **The site.** `site/assets/site.css` inlines the geometry and paints the ring
  `currentColor`, so the mark is the same ink as the word beside it.
- **Exported document covers.** `extension/brand/lockup.svg` is the host-led
  lockup, read as text and pasted into the cover, where it takes the document's
  `--ink`. Its accent reads `var(--bad, #B5432B)`, and `--bad` is what the
  document shell calls the failure colour — which is Petra in both themes.
- **A PNG, a print, a store tile.** No host, so commit: `-light` or `-dark`.

## 4. Motion

The mark has one animation, and it is about the product rather than about
itself.

**Rule one: it moves when the product changes state.** Two states, no third.

| State | What happens | How long |
| --- | --- | --- |
| Wake | the ring draws itself, then the check strokes out through the seam, overshooting 4% and settling | 520 ms, then 260 ms, so 780 ms, played once |
| Recording | the check breathes, opacity 1 → 0.55 → 1. Nothing moves | 1.8 s, looping until the session or the clip ends |

**Rule two: it moves at no other time.** Not on load, not on hover, not to
fill a wait, not because a page is open. A mark that greets you every time
stops being a mark and becomes an advertisement for itself. And §3 still
holds while it moves: the mark never rotates, never bounces, never spins.

**Easing.** `cubic-bezier(.2, .8, .2, 1)` for the wake, so it arrives quickly
and lands softly. `ease-in-out` for the breathe, because a breath has no
beginning.

**Reduced motion is off, not slower.** Under `prefers-reduced-motion: reduce`
both states are the static mark: the animated file is never fetched at all,
and a mark inlined as `<svg>` has its animations set to `none`.

**Where it lives.** `logo/mark-motion.svg`, the geometry of `mark.svg`
exactly, with the keyframes carried inside it so it works through `<img>` as
well as inlined. The state reaches it as a URL fragment
(`mark-motion.svg#wake`) in the `<img>` case and as a class on an ancestor
(`qaw-wake`, `qaw-recording`) when it is inlined. `extension/ui/motion.js`
sets them from signals the surfaces already give off; no other file knows.

**The toolbar icon** breathes the same check on the same 1.8 s period, as
eight frames rendered once (a bitmap icon cannot carry a stylesheet) with a
red dot on the badge while it runs. It stops and restores the manifest icon
when recording stops, and again when the browser starts, because a killed
service worker would otherwise leave a half-faded check up there for ever.

## 5. Colour

The tokens are generated from `tools/tokens.source.mjs`; never hand-edit
`extension/ui/identity-tokens.css`.

| Name | Light | Dark | Midnight | Means |
| --- | --- | --- | --- | --- |
| Petra | `#B5432B` | `#FF8A6E` | `#FF9578` | a failure, the one primary action, the check in the mark. Never decoration. |
| Guac | `#2A7A3B` | `#7ED08A` | `#86D993` | a pass; saved, complete, verified |
| Corn | `#E2AE38` | `#FFD166` | `#FFD770` | a warm highlight; never under small text |
| Wadi Rum | `#8E5A10` | `#F1BE5C` | `#F5C766` | BLOCKED, and nothing else |
| Tortilla | `#D8C6A4` | `#6F5C40` | `#5E4D35` | borders, the foil, the burrito |
| Limestone | `#F1EFE9` | `#ECEAE3` | `#EFEDE6` | the ground by day, the ink at night |
| Basalt | `#1D2024` | `#15181B` | `#0B0D10` | the ink by day, the ground at night |

Results carry colour; nothing else does. A screen with no result has no red
and no green on it. Slate greys are one warm ramp, limestone to basalt, never
a blue grey.

## 6. Type

**Thmanyah, only** (Nader, 18 and 27 Sept 2026; Cairo is banned). Thmanyah Sans
400/500/700 and Thmanyah Serif Display 400, carried as base64 in
`extension/ui/fonts.css` — the licence forbids a loose font file, so nothing ships
under `extension/ui/fonts/`. Arabic and English are both first-class: the same
face, the same weights, RTL when the text is Arabic. Headings 700, body 400–500,
labels 500, the report title in Serif Display. Never Inter, never a system stack
as the first choice.

**Where the faces come from (for regenerating the lockup).** The wordmark and
lockup SVGs are outlines drawn by `identity/tools/product-lockup.mjs` from two
licensed OTF files, `thmanyahserifdisplay-Black.otf` and `thmanyahsans-Medium.otf`.
They are not in git (`work/*` is ignored, and the licence in `extension/NOTICE`
forbids redistributing a loose font file). The tool looks, in order, in
`work/fonts-staged`; setting
`QAW_FONT_DIR` makes that one folder the only place it looks. If a face is missing it
stops with one error that names every folder it searched and the NOTICE licence,
and writes nothing. Get the files from your licensed copy, never from a download site.

## 6a. Shape, depth and light

**One radius scale: 4 / 7 / 10, plus a pill at 999.** `--r-sm` for a chip, a
kbd, a small field; `--r-md` for a button, a card, a panel; `--r-lg` for the
outermost container only. Nothing in the product carries a hand-written radius;
if a corner needs a value that is not on the scale, the scale is wrong and it
is changed in `tools/tokens.source.mjs`. The instrument this is aiming at is a
measuring tool, not a card in a feed, so the corners are eased only far enough
that a hairline border does not read as a hard cut.

**One shadow, and it is not on the page.** `--shadow-2` is for something that
genuinely floats over something else: a dialog, a popover, a menu. It is
tinted with the ink rather than with black, because a black shadow on a warm
ground is a grey smear. `--shadow-1` is a hairline that sits UNDER a border,
never instead of one. Nothing repeated on a page carries either: not a row,
not a card, not a tile, not a chip. Depth is information, and forty stacked
shadows are not.

**Two rings, and no glow.** `--ring-live` (2px, the failure colour) marks the
one state where being wrong matters most: a recording in progress.
`--ring-quiet` (1px, the accent) marks a control being reached for or holding a
choice. Both are solid rings with no blur. A glow is a claim that light is
coming off a QA panel, and it is not.

**No gradient that is not a measurement.** A gradient is allowed where it shows
a quantity, which in this product means exactly one thing: the filled portion
of a range track, drawn with hard stops. Ambient washes, mesh grounds and
radial bloom have no place here.

## 7. The mascot

The burrito is a character, not an icon. In explanatory scenes it does what
the tool does. It holds a camera for a screenshot, wears a stethoscope for a
check, carries a basket for a harvest, drawn flat, three colours plus
limestone, no outlines heavier than 1.75 px, always the same face. It never
speaks in bubbles; the caption under the scene speaks. It appears in help,
onboarding and empty states; never in a result, never in a document a client
receives.

## 8. Voice

- Plain sentences. Say what happened and what to do next.
- Nouns a tester uses: session, failure, cause, evidence, report.
- Never "oops", "whoops", "simply", "seamless", "powerful". No exclamation marks.
- Arabic copy is written in Arabic, not translated word by word; both languages
  get the same care.

## 9. Sound and motion

Off by default. When on, every sound marks something that is also on screen
(`extension/ui/SOUNDS.md`); every effect is a transform or an opacity, under
200 ms, and honours reduced-motion (`extension/ui/VFX.md`).

This is the interface's motion: buttons, panels, results. The mark's own motion
is §4, is not a setting, and follows different rules.

**Hover changes colour, never geometry.** A control under the pointer may
change its border, its ground or its ink. It may not move, grow, or gain a
shadow. A press may move by one pixel, because a press is something the person
did and it is owed an answer; a hover is only the pointer passing through.

## 10. Provenance

Every artefact carries the maker in metadata, never as a painted mark: PNG
`tEXt`, PDF/XLSX creator, JSON `_provenance`, an HTML comment, a verifiable
token. The rights holder is **{maker}** (brand.json), the same entity named in
`LICENSE`, in `NOTICE`, in the rights line of §2 and in `MAKER.owner`
(`extension/lib/provenance.js`). One product can only have one. See
`tools/watermark.mjs`.
