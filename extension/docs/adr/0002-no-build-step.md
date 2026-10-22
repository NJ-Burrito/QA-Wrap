# 2. No build step

- Status: accepted
- Date: 2026-09-08
- Deciders: Nader Alzghoul
- Related: ADR 0001

## Context and problem statement

The folder Chrome loads is the folder in the repository. There is no bundler, no
transpiler, no minifier and no generated artefact in the package: every file a
user runs is a file somebody wrote and can read. Most extensions of this size
bundle, and the round-2 restructure was the moment to decide whether this one
should.

## Decision drivers

- **Firefox review.** An add-on that ships generated code must submit the source
  and the exact commands that reproduce it, byte for byte, on a reviewer's
  machine. `store/FIREFOX-SOURCE-SUBMISSION.md` currently says there is nothing
  to reproduce, and that is the cheapest true statement a submission can make.
- **The tester is the audience.** QA Wrap is loaded unpacked by people who read
  extensions for a living. A stack trace that points at `chunk-4f2a.js:1:88213`
  is a stack trace that gets reported to us instead of understood.
- **One less thing to be broken at 2 a.m.** There is no CI. A build step that
  runs only on somebody's laptop is a build step that will one day not have run.
- Against: no bundler means no tree-shaking, no `.ts`, no npm package can be
  imported directly, and every module the service worker imports is parsed on
  every cold start.

## Considered options

1. **Keep it.** Plain ES modules, classic scripts where a page needs one,
   JSDoc plus `tsc --noEmit` for types.
2. **Bundle** with esbuild or Rollup, and move to `.ts`.

## Decision outcome

**Option 1, kept deliberately rather than by inertia.**

The consequences are managed rather than wished away:

- **The boot-graph budget is a gate, not a hope.**
  `tools/test-worker-imports.mjs` measures what the service worker parses on
  every cold start — 38 direct imports, 42 modules, 797.6 KB — against ceilings
  of 43 / 47 / 800 KB. Without a bundler this is the only thing between the
  worker and a slow wake, and it is checked on every `npm test`.
- **Doors instead of tree-shaking.** A *door* is a shim in `background/` that
  keeps a call site reading as it did while the implementation loads on demand
  behind the offscreen document, which is an ordinary page and may `import()`
  lazily. The tracker adapters left the boot graph this way and took it from
  803.0 KB to 787.8 KB.
- **Types without a build.** JSDoc with `checkJs`, `tsc --noEmit` in `npm test`,
  as a ratchet: 198 errors against a ceiling of 199, with seven named files held
  at zero. research/51c is right that JSDoc without an enforced check is
  decoration; the check is enforced.
- **No new runtime dependency, ever.** `vendor/axe.min.js` is the single piece
  of third-party code, vendored unmodified and pinned. Everything else is ours.

This also decides the shape of the layer gate. `dependency-cruiser` is the
standard tool for ADR 0001's rule, but four surfaces are classic scripts whose
dependencies are `<script src>` attributes in HTML rather than imports, and no
resolver reads those out of the box. `tools/test-layers.mjs` is 200 lines with
no dependency and reads all of them.

## Consequences

- Good: what ships is what was written. A Firefox reviewer, a security auditor
  and a tester with DevTools open all read the same file.
- Good: `git diff` on a release is a diff of source, not of a minifier's output.
- Bad: `background/service-worker.js` is 6,660 lines partly *because* splitting
  it costs boot-graph bytes rather than saving them. That cost is real and is
  named in `ARCHITECTURE.md`.
- Bad: no npm package can be added without vendoring it by hand, which is a
  feature until the day it is not.

Revisit if the boot graph reaches its ceiling with no door left to write, or if
a dependency worth having cannot be vendored.
