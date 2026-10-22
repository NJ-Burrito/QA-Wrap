/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Where the big, regenerable things live: outside the extension folder.
 *
 * ── the measurement that produced this file ────────────────────────────────
 *
 * `chrome://extensions` showed the unpacked extension at about **7,000 MB**.
 * That is not a rounding error on a 33 MB package, it is the number a tester
 * reads on the card before they have pressed anything, and it says the thing
 * they are about to load is enormous.
 *
 * Measured, 6 September 2026 — the unpacked folder was **6,391 MB**:
 *
 *   tools/film/out         2,217 MB   composed frames, one PNG per frame
 *   tools/film/audio       1,289 MB   takes, stems, masters
 *   dist                     565 MB   eight browser builds plus the store zip
 *   tools/film/capture       413 MB   raw screen captures
 *
 * None of it ships. `tools/` and `dist/` are both on the deny-list in
 * `lib-ship.mjs`, so every byte above is in the folder purely because that is
 * where it happened to be written. Chrome does not know that: it walks the
 * folder it was given.
 *
 * So the working trees move out of the extension entirely, to the repository
 * root, and the tools that write them are pointed here. Nothing about the film
 * pipeline changes except where its output lands.
 *
 *   work/film/out       ← extension/tools/film/out
 *   work/film/capture   ← extension/tools/film/capture
 *   work/film/audio/out ← extension/tools/film/audio/out
 *   dist/               ← extension/dist
 *
 * `work/` and `dist/` are both in `.graphifyignore`, for the same reason they
 * are not in the package: they are output, not source.
 *
 * ── why one module rather than four constants in eight files ───────────────
 *
 * Because that is what it was. `film/out` was computed independently in
 * `compose/encode.mjs`, `compose/frames.mjs`, `compose/verify.mjs` and
 * `record/manifest.mjs`, and `dist` in three more. Eight places to change is
 * eight places for the ninth to be missed, and a film tool that writes to the
 * old path still works — it just quietly refills the folder this file exists
 * to empty.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `extension/` — the folder Chrome loads. Nothing large may live below it. */
export const EXT = path.resolve(HERE, '..');

/** The repository root, which is one level above the extension. */
export const REPO = path.resolve(EXT, '..');

/**
 * Browser builds and the store zip. Was `extension/dist`.
 *
 * `QAW_DIST=<dir>` points every tool that writes or reads `dist/` somewhere else (the test pipeline packages into a
 * temp folder with it, so a test run can never overwrite the delivered `qa-wrap-<version>.zip`). Unset or empty, it
 * is the repo-root `dist/` as before.
 */
export const DIST = process.env.QAW_DIST ? path.resolve(process.env.QAW_DIST) : path.join(REPO, 'dist');

/** Everything the film pipeline writes while it works. */
export const FILM_WORK = path.join(REPO, 'work', 'film');

/** Composed frames, `<name>/f%05d.png`. Was `extension/tools/film/out`. */
export const FILM_OUT = path.join(FILM_WORK, 'out');

/** Raw screen captures. Was `extension/tools/film/capture`. */
export const FILM_CAPTURE = path.join(FILM_WORK, 'capture');

/** Voice takes, stems and masters. Was `extension/tools/film/audio/out`. */
export const FILM_AUDIO_OUT = path.join(FILM_WORK, 'audio', 'out');

/**
 * Where a tool's throwaway Chromium profile goes.
 *
 * Each harness launches a persistent context so the extension can be loaded
 * unpacked, and each one left its profile in the extension folder: measured on
 * 6 September, `.gif-profile` 776 MB and `.export-profile` 775 MB alone, with
 * eighteen more behind them for a total near 2,000 MB. A browser profile is a
 * cache of the run that made it — it is regenerable, it ships nowhere, and it
 * has no business inside the folder Chrome measures.
 *
 * The name is kept, dot and all, so an existing `.gif-profile` is recognisable
 * in its new home and so `lib-ship.mjs`'s deny-list still reads true.
 */
export const profile = (name) => path.join(REPO, 'work', 'profiles', name);

/** The gate shots the store listing is built from. Was `extension/.ui-shots`. */
export const UI_SHOTS = path.join(REPO, 'work', 'ui-shots');

/** The tutorial pipeline's own working tree, for the same reason. */
export const TUTORIAL_WORK = path.join(REPO, 'work', 'tutorials');

/**
 * A `file://`-safe URL for a working directory, for the pages the composer
 * loads in Chromium.
 *
 * The frame composer used to reach its clips through `${baseUrl}/tools/film/…`,
 * where `baseUrl` was the extension folder served over `file://`. That worked
 * only because the captures were inside the extension; now they are not, so the
 * path has to be built from the working root instead of from the extension.
 */
export const fileUrl = (abs) => new URL(`file:///${abs.replace(/\\/g, '/')}`).href;

/**
 * The voice-style registry folder (voice-styles.json, scripts/voice_style_gate.py).
 * `NJ_WRITER_DIR` wins; else the committed fixture (same registry and gate scripts, LF), so a fresh clone enforces the voice gates.
 */
export const NJ_WRITER_DIR = process.env.NJ_WRITER_DIR || path.join(EXT, 'tools', 'fixtures', 'nj-writer');
