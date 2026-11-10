# qaw-1109/gate: classification of the 22 release-gate reds (main 48d5337 vs 3.8.4 base 3cf56d6)

Method: each suite run as `node tools/<suite>.mjs` from extension/ in each tree (main = wt-gate, base = wt-base384), one run each; reruns only where the two disagreed. Logs: scratchpad (not kept). QAW_TRASH was unset in the agent shell (see ENV rows).

| suite | main line | base result | class | fix commit |
|---|---|---|---|---|
| test-update-page | `FAIL Arabic ... The input did not match /أُضيف/. Input: 'أضيف'` (then /فعّل.../ and 'حاول مجددًا') | 8 passed | REGRESSION (intended: f0e9c1d "no visible tashkeel" rewrote ar.json) | stale assertions un-vowelled in tools/test-update-page.mjs; alone: 8 passed |
| test-frames | `FAIL the recorded step carries the whole frameLocator chain` (20 passed, 1 failed with QAW_TRASH) | same line | PRE-EXISTING. Extra `the note in the timeline carries the same finished locator` ("the pick left no note in the session") seen on main in 3 of 6 runs, 0 of 4 on base; test reads the note after a fixed 900 ms wait; no 3.9.0 file touches the picker or note append path -> FLAKE (timing), watch item | none |
| test-vault-live | `FAIL harness: page.fill: Timeout 30000ms exceeded` (#jira-email) | same | PRE-EXISTING | none |
| test-integrations-live | `FAIL seven tabs` (16 passed, 1 failed) | same | PRE-EXISTING | none |
| test-browser-dists | `chrome-managed: core\rate-links.js differs from the chrome build` (after its own temp rebuild; also with dist/ built) | same | PRE-EXISTING (B9 byte-identity vs managed rate-links.js); [A] "needs dist" falsified | none |
| test-bar-geometry | `FAIL 1015 en 1280: ... ["Shot","Note","Record","Open panel"]` + 4 more; 122 passed, 5 failed | identical 5 | PRE-EXISTING (Record button added to bar before 3.8.4; test expects 3 words) | none |
| test-first-run-live | gate: `FAIL the keyboard-only session reads the same: the click and the 500` + recycle FAILs | recycle FAILs only | FLAKE (keyboard line) + ENVIRONMENT (recycle). With QAW_TRASH set, main alone: 30 passed, 0 failed | none |
| test-capture-live | `session A stored 4 events` ... 47 passed, 21 failed (provenance "version": null) | 45 passed, 23 failed, same first lines | PRE-EXISTING | none |
| test-page-indicator | `ENOENT ... work\sdlc\build\i18n\PAGE.en.json` | same (absent in main checkout too, git-ignored /work/) | ENVIRONMENT (git-ignored generated file) | none |
| test-focus-follow-live | `aborted: browserContext.waitForEvent: Timeout 20000ms ... "serviceworker"` | same | PRE-EXISTING (headless channel:'chromium' --load-extension never starts the worker) | none |
| test-notes-tab | `AssertionError: Save markdown equals the timeline export` (line 103) | same | PRE-EXISTING | none |
| test-report-filing-live | `FAIL section buttons do not use .tab; all ten panels exist` (24 passed, 1 failed) | same | PRE-EXISTING | none |
| test-truth | `SyntaxError: Unexpected token 'const'` at test-truth.mjs:148 (a `//` comment on line 147 swallows `ok(...)`'s message and closing) | same | PRE-EXISTING; [A] "needs dist" falsified (parse error, file unchanged since 3.8.4). Candidate fix: move the comment off line 147 | none |
| test-game-trial-live | `SKIPPED: NOT IMPLEMENTED rule game-trial ... (by hand only: the owner presses Allow and Alt+Shift+Q)` exit 2 | same | ENVIRONMENT (owner press, --by-hand) | none |
| perf | `6 measurement(s) over budget` (x6 throttled rows 300/800/1600/30 ms) | `6 measurement(s) over budget`, same rows | PRE-EXISTING / load; x1 popup boot flipped 440 ms (main) vs 38 ms (base) in run 1 and 42 vs 440 in the back-to-back rerun, so x1 spikes are noise | none |
| test-scale-parity | `FAIL every box, spacing, size and radius equals the recorded popup` (session 315.5 -> 305) | same | PRE-EXISTING | none |
| test-e2e-practice | `FAIL built extension present at ...\dist\chrome ... run npm run build:all first` | same | ENVIRONMENT (built dist). With dist built in both trees: 62 passed, 7 failed on each, same 7 (Asleep card 46px, done card counts 3, order reference level 4) -> PRE-EXISTING behind it | none |
| test-tile-wake-live | `FAIL recycle uqa-tilewake-1011-...: python.exe: can't find '__main__' module` (14 passed, 2 failed) | same | ENVIRONMENT (QAW_TRASH unset -> python run on ''). With QAW_TRASH set, main alone: 14 passed, 0 failed | none |
| test-sound-volume-live | `FAIL recycle uqa-volume-1011-...` same python error (6 passed, 2 failed) | same | ENVIRONMENT (same); with QAW_TRASH set: 6 passed, 0 failed | none |
| test-buttons-all | `chunk ... no result (exit 1)`; child log: `browserType.launchPersistentContext: Executable doesn't exist at C:\Users\n10m1\AppData\Local\ms-playwright\chromium-1234\...` (0 passed, 16 failed) | same | ENVIRONMENT (sandbox child env drops PLAYWRIGHT_BROWSERS_PATH; C: ms-playwright has only `b`) | none |
| test-sandbox-egress | `TypeError: Cannot read properties of undefined (reading 'endsWith')` (env.QAW_TRASH) | same | ENVIRONMENT. With QAW_TRASH set it reaches `1 !== 0` at :160, child launch with the same missing chromium-1234 on C: | none |
| test-game-live | `SKIPPED: NOT IMPLEMENTED rule game ... (by hand only: the owner presses Allow ...)` exit 2 | same | ENVIRONMENT (owner press) | none |

Summary: REGRESSION 1 (test-update-page, fixed) · FLAKE 1 (first-run keyboard line; test-frames note line is a watch item) · ENVIRONMENT 8 (page-indicator, game-trial, game, e2e-practice, tile-wake, sound-volume, buttons-all, sandbox-egress; first-run recycle half) · PRE-EXISTING 12 (frames chain, vault, integrations, browser-dists, bar-geometry, capture, focus-follow, notes-tab, report-filing, truth, perf, scale-parity).
Note: the brief's 3.9.0 changes (profile/seal/timeline-md/trace-export, options, tutorials) caused no other red: every other red is identical on the 3.8.4 base.
Quick wins for the Lead (not applied, outside "regression"): QAW_TRASH exported to trash.py clears tile-wake, sound-volume and first-run recycle FAILs; test-truth line 147 comment.
