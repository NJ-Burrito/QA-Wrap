# QA Wrap UI sounds

Generated from `ui/sound.js` and `tools/sound-levels.json` by `tools/sound-doc.mjs`; do not edit by hand.

Twenty-four OGG files, family "Glass & Air": QA Wrap's own synthesis with CC0 recorded layers (see `ui/sfx/CREDITS.txt` for each layer's author, source, licence and the sha256 of each file). Names with several files (tap 3; shot, on, off, open, close, remove, copy 2 each) play one at random, never the same twice in a row. Fifteen sound names in two scopes: eight **core** moments ("Results and alerts") and seven **touch** sounds (added by "Every click"). Defaults: on, every click, volume 70.

The files are already loudness-matched per class (moments about -16 to -20 LKFS, touch -23 to -28), so the per-file gain in dB at volume 100 is 0, except `error` at +2.5 so that it is the loudest and most distinct sound in the product, on purpose. Nobody has listened to the set yet; Nader checks it by ear.

| sound | scope | file | length s | peak | mean | trim dB | final peak | final mean |
|---|---|---|---|---|---|---|---|---|
| wake | core | wake.ogg | 1.000 | -7.1 | -20.6 | 0.0 | -7.1 | -20.6 |
| sleep | core | sleep.ogg | 1.000 | -6.9 | -21.6 | 0.0 | -6.9 | -21.6 |
| start | core | start.ogg | 0.850 | -5.8 | -19.6 | 0.0 | -5.8 | -19.6 |
| stop | core | stop.ogg | 0.850 | -5.6 | -20.4 | 0.0 | -5.6 | -20.4 |
| shot | core | shot.ogg | 0.300 | -5.2 | -25.7 | 0.0 | -5.2 | -25.7 |
| shot | core | shot2.ogg | 0.300 | -5.7 | -26.6 | 0.0 | -5.7 | -26.6 |
| done | core | done.ogg | 0.800 | -6.2 | -20.2 | 0.0 | -6.2 | -20.2 |
| notice | core | notice.ogg | 0.800 | -6.9 | -21.0 | 0.0 | -6.9 | -21.0 |
| error | core | error.ogg | 0.850 | -4.9 | -21.6 | 2.5 | -2.4 | -19.1 |
| tap | touch | tap.ogg | 0.100 | -15.2 | -31.2 | 0.0 | -15.2 | -31.2 |
| tap | touch | tap2.ogg | 0.100 | -14.0 | -31.5 | 0.0 | -14.0 | -31.5 |
| tap | touch | tap3.ogg | 0.100 | -14.0 | -31.1 | 0.0 | -14.0 | -31.1 |
| on | touch | on.ogg | 0.140 | -12.1 | -31.1 | 0.0 | -12.1 | -31.1 |
| on | touch | on2.ogg | 0.140 | -12.0 | -30.8 | 0.0 | -12.0 | -30.8 |
| off | touch | off.ogg | 0.200 | -13.0 | -29.1 | 0.0 | -13.0 | -29.1 |
| off | touch | off2.ogg | 0.200 | -14.3 | -29.3 | 0.0 | -14.3 | -29.3 |
| open | touch | open.ogg | 0.260 | -11.9 | -29.7 | 0.0 | -11.9 | -29.7 |
| open | touch | open2.ogg | 0.260 | -11.6 | -28.3 | 0.0 | -11.6 | -28.3 |
| close | touch | close.ogg | 0.260 | -13.5 | -28.6 | 0.0 | -13.5 | -28.6 |
| close | touch | close2.ogg | 0.260 | -13.2 | -28.3 | 0.0 | -13.2 | -28.3 |
| remove | touch | remove.ogg | 0.299 | -12.0 | -26.5 | 0.0 | -12.0 | -26.5 |
| remove | touch | remove2.ogg | 0.300 | -12.6 | -26.3 | 0.0 | -12.6 | -26.3 |
| copy | touch | copy.ogg | 0.220 | -14.9 | -30.9 | 0.0 | -14.9 | -30.9 |
| copy | touch | copy2.ogg | 0.220 | -13.4 | -31.0 | 0.0 | -13.4 | -31.0 |

## Events

A call site names *what happened* (`UQASound.play('jira.filed')`), never a sound; this map is the only place the two meet.

| event | sound |
|---|---|
| `ui.tap` | tap |
| `ui.tap-soft` | tap |
| `ui.primary` | tap |
| `ui.quiet` | tap |
| `ui.danger` | remove |
| `ui.tick` | tap |
| `ui.on` | on |
| `ui.off` | off |
| `ui.check` | on |
| `ui.uncheck` | off |
| `ui.choose` | tap |
| `ui.slide` | tap |
| `ui.open` | open |
| `ui.close` | close |
| `ui.tab` | tap |
| `ui.modal-open` | open |
| `ui.modal-close` | close |
| `ui.copy` | copy |
| `ui.navigate` | tap |
| `ui.remove` | remove |
| `switch.wake` | wake |
| `switch.sleep` | sleep |
| `session.start` | start |
| `session.stop` | stop |
| `capture.shot` | shot |
| `capture.full` | shot |
| `record.start` | start |
| `record.stop` | stop |
| `status.ok` | copy |
| `status.warn` | notice |
| `status.error` | error |
| `status.refused` | notice |
| `scan.clean` | done |
| `scan.found` | notice |
| `rule.armed` | on |
| `rule.fired` | notice |
| `value.inserted` | copy |
| `jira.filed` | done |
| `jira.draft` | copy |
| `chat.sent` | done |
| `export.done` | done |
| `file.saved` | done |
| `save.open` | open |
| `save.done` | done |
| `team.card` | tap |
| `harvest.done` | done |
| `autofill.done` | done |
| `links.clean` | done |
| `links.broken` | notice |
| `pick.added` | tap |
| `pick.all` | copy |
| `diagram.node` | tap |
| `diagram.line` | tap |

## Rules of play

1. The same sound is dropped inside 60 ms of itself.
2. A touch sound is dropped when a different sound started within 120 ms; a moment never is.
3. At most three at once; over that the oldest touch sound is released over about 15 ms.
4. A hidden page, a disabled setting, a scope mismatch, `suspended` (microphone hot) and "not decoded yet" play nothing. A hidden page hands a moment to the worker (`UQA_CUE`).
5. The in-page toolbar plays no sound (its files are not web-accessible); the offscreen document plays moments for finished jobs and gets no `AUDIO_PLAYBACK` reason.

