# 1. A layered layout, enforced by a script

- Status: accepted
- Date: 2026-09-08
- Deciders: Nader Alzghoul
- Supersedes: nothing

## Context and problem statement

The extension was organised by surface: `background/`, `content/`, `popup/`,
`report/`, and a `lib/` that held everything else. A newcomer could not tell
from the tree which files were safe to reason about on their own, and nothing
stopped a `chrome.*` call appearing in a module the Node suites depend on being
pure. Two entry points already imported each other's internals.

How should the source be arranged so that a developer who has never seen it can
tell in ten minutes which part is which, and so that the arrangement cannot
quietly decay?

## Decision drivers

- A handover in ten minutes, not a week.
- The forty-seven Node test suites exist only because most of `lib/` is pure. If
  a `chrome.*` call lands in the wrong file the suites stop being possible, and
  nothing would have said so.
- No build step, no new runtime dependency (ADR 0002).
- Behaviour-preserving: the shipped extension must be byte-for-byte equivalent
  in behaviour, and the moves must be moves.

## Considered options

1. **Leave it as it is** and write the rules down in `ARCHITECTURE.md`.
2. **`core/` and `platform/`, plus wrapper folders** — `entries/` for the entry
   points, `workers/` for the worker pair, `surfaces/` for the pages, as
   research/51c sketches.
3. **`core/` and `platform/`, with the surface folders kept as entry points**,
   and a Node script that enforces the direction.

## Decision outcome

**Option 3.**

Five layers. An import may point at its own layer or a lower one, never up:

| rank | layer | folders |
| --- | --- | --- |
| 0 | assets | `icons/`, `brand/`, `vendor/` |
| 1 | core | `core/` — the product's ideas, zero `chrome.*` |
| 2 | platform | `platform/` — the shared `chrome.*` adapters |
| 3 | ui | `ui/` — tokens, fonts, the globals a page needs |
| 4 | entries | `background/` + `offscreen/`, `content/`, the twelve pages |

Plus one rule ranks cannot express: an entry may not import another entry.
`background/` and `offscreen/` are one group and the only exception, because the
offscreen document is the worker's own DOM.

`tools/test-layers.mjs` enforces all of it, in `npm test`.

### The membership rule, and why it is not the one the brief asked for

The brief said `grep -l "chrome\." lib/*.js` decides who may enter `core/`. Run
raw, that rule put ten of forty-seven files in `platform/`, and seven of the ten
matched only in **prose**: `correlate.js` says, in a comment, "this module stays
pure — no `chrome.*`". A rule that punishes a file for documenting that it obeys
the rule gets ignored within a month.

So the rule is the same rule with comments and string literals stripped first:
three files call `chrome.*`, and forty-four do not.

The boundary is `chrome.*` and deliberately **not** "no browser globals". Five
core files name a DOM global inside a function (`indexedDB`, `document`,
`MediaRecorder`, `navigator`). Making "zero DOM" the boundary would push
`docshell.js` into `platform/`, and three core modules import it — so the
invariant would have been broken on the day it was written. An architecture
document that describes an aspiration is worse than none.

### Consequences

- Good: 45 files whose purity is now a failing test rather than a habit.
- Good: `api/api.js` importing `background/api-send.js` — the invariant this
  repo's own `ARCHITECTURE.md` recorded as broken — is fixed by moving one file.
- Good: the wrapper folders were skipped, so `manifest.json` needed **no** path
  change and the twelve page folders kept their names.
- Bad: `platform/` has three files in it, which looks thin. It is the address
  for the storage repository that comes next, and naming the address before
  filling it is the point.
- Bad: one entry-to-entry edge survives (`report/report.js` → `notify.js`), and
  is recorded in the gate with its reason rather than hidden.

## Why not the alternatives

**Option 1** is what was already being done. `ARCHITECTURE.md` listed four
broken invariants, in named files, because nothing checked them.

**Option 2** costs every path in `manifest.json`, every `<script src>` in twelve
HTML files, every harness in `tools/`, and every `file:line` pointer in
`DEPLOYMENT-VALUES.txt` — to gain a directory level that says what the manifest
already says. The layers are a *rule about imports*, and the rule is enforced by
reading imports, not by reading paths.

`dependency-cruiser` is the standard tool and research/51c names it. It was not
adopted because half this extension's edges are HTML `<script src>` — four
surfaces are classic scripts that cannot import — and teaching a resolver about
those costs more than the 200-line script that reads them directly. See ADR
0002.
