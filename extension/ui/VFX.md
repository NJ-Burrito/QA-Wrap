# QA Wrap — the motion library

`ui/vfx.js` + `ui/vfx.css`. On by default, off under `prefers-reduced-motion`
and under Settings → Sound → "Show small motion effects".

## The rules

1. **Transform and opacity only.** Nothing animates width, height, margin,
   colour or shadow. Composited properties cost the main thread nothing; the
   clickthrough suite reads every `vfx-*` keyframe and fails on any other
   property.
2. **Short.** 120–520 ms. Punctuation, not a sentence.
3. **Few nodes.** The largest effect adds eight spans and removes them; the
   suite checks nothing is left behind after 800 ms.
4. **Never blocks.** A class plus `animationend`; no per-frame JavaScript;
   thirty effects in a row must cost under 40 ms of main thread (checked).
5. **Meaning, not decoration.** One effect per kind of event, used only for
   that, so the vocabulary is learnt in a minute.

## The vocabulary

| Effect | What it says | How | Where it fires |
|---|---|---|---|
| `pulse` | a control was pressed and taken | scale 1 → 0.965 → 1, 180 ms | every tile, primary button, segment (wired once, by delegation) |
| `pop` | something succeeded here | scale 0.98 → 1.03 → 1 + a green ring expanding, 320 ms | the status line on good news; the save dialog's result |
| `shake` | refused, or wrong | ±4 px on x, 260 ms | the status line on bad news |
| `flash` | a picture was taken | a limestone layer fading 0.85 → 0, 180 ms | screenshot, full page — the one effect kept under reduced motion, because it is what a shutter *is* |
| `wobble` | the burrito wakes | rotate −9° → 7° → −3° → 0, 420 ms | the mark, on wake |
| `sparks` | a ticket left the machine | eight round sparks in Petra, corn and guac thrown 26–48 px and faded, 520 ms | Jira filed |
| `settle` | a surface arrived | translateY 6 px → 0 with a fade, 220 ms | the save dialog |
| `count` | a number changed | scale 1 → 1.18 → 1, 200 ms | counters, when a surface asks for it |
| `glow` | recording — a state, not an event | opacity breathing 1 → 0.72, 1.6 s loop | the Record tile while a clip runs |
| `qaw-scene-in` | an illustrated scene (`ui/scenes.js`) settled onto the glass | scale 0.97 → 1 + translateY 4px → 0, 380 ms soft spring, once | every scene, on the frame `<svg>` itself |

## Using it

```js
window.UQAVfx.play('pop', element);          // one effect, once
window.UQAVfx.status(statusEl, 'ok' | 'err'); // pop or shake by tone
window.UQAVfx.state('glow', tile, true);      // a state on; false takes it off
window.UQAVfx.wire();                         // pulses on presses, by delegation
window.UQAVfx.configure({ enabled: false });  // the setting
```

`play()` returns whether anything was drawn, so a caller can fall back to
words. It never throws and never awaits.

## The shared motion utilities (`ui/motion.css`, 21 Sept 2026)

Not events on a control — the vocabulary every surface's glass panels, enters
and exits are built from. Same rules as above: transform/opacity/stroke-
dashoffset only, reduced motion collapses each to its end state.

| Class / token | What it does |
|---|---|
| `--motion-spring` (+ `--motion-spring-fallback`) | a `linear()` spring for materialising glass; the cubic-bezier fallback is a separate declaration line, first, so an unsupported `linear()` leaves it standing |
| `--motion-exit` | the curve for leaving: faster than arriving, accelerates instead of settling |
| `.qaw-materialize` | opacity 0→1, scale .98→1, on the spring — a glass card arriving |
| `.qaw-out` | fade only, on `--motion-exit`, `--motion-fast` — a thing leaving |
| `.qaw-draw-on` + `--qaw-draw-len` | a one-time stroke draw-on for an icon or check; the caller sets `--qaw-draw-len` to the path's own length |

## Adding one

Name the meaning first. If two events would use the same effect for different
reasons, one of them needs a different effect or no effect at all. Keep the
keyframes to `transform` and `opacity`, keep it under half a second, add it to
the table above, and let the suite prove the cost.
