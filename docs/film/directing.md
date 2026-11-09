# Directing checklist (qaw-1109)

One rule per line, each with its source. Apply in this order when writing a treatment and again when reviewing an animatic or render (`review-checklist.md` turns these into pass/fail checks). Digests behind each source: `research.md`. House values (colours, eases, timings): `commercial-bible.md`.

Vocabulary for a 2D motion stage: **size** = how much of the world the frame holds (EWS whole system, WS several objects, MS one object with its neighbours, CU one object, ECU one detail); **angle** = flat front (eye level), high (looking down, tilted plane) or low; **move** = hold, push-in, pull-out, truck (sideways), tilt, track-with (follow an object), whip (fast blur hand-off).

## 1. The shot

- [ ] One idea per shot: if the shot needs "and" to describe, split it. Source: staging, https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
- [ ] Name the focal point before anything else; light, contrast, placement and motion all point at it. Source: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
- [ ] Choose the size for the job: wide to place things, medium to relate, close to isolate one thing. Source: https://en.wikipedia.org/wiki/Shot_(filmmaking)
- [ ] Open each act on a wider size that sets the geography, then go closer. Source: https://www.studiobinder.com/blog/ultimate-guide-to-camera-shots/
- [ ] Vary size between consecutive beats; two same-size beats in a row need a reason. Source: https://www.studiobinder.com/blog/ultimate-guide-to-camera-shots/
- [ ] Use the extreme wide only for isolation or scale (the scattered, lost evidence). Source: https://www.studiobinder.com/blog/ultimate-guide-to-camera-shots/
- [ ] Angle carries power: high makes the problem small, low makes the tool or the result big; default is eye level. Source: https://en.wikipedia.org/wiki/Camera_angle
- [ ] Put the focal object on a third line unless the beat is about stability or the end (then centre it). Source: https://en.wikipedia.org/wiki/Rule_of_thirds
- [ ] The strongest value contrast in the frame sits on the focal point, nowhere else. Source: https://en.wikipedia.org/wiki/Composition_(visual_arts)
- [ ] Use lines (a timeline, a thread, a row of chips) to carry the eye to the focal point. Source: https://en.wikipedia.org/wiki/Composition_(visual_arts)
- [ ] Leave negative space around the hero; crowding kills weight. Source: https://en.wikipedia.org/wiki/Composition_(visual_arts)
- [ ] A move must have a motive (follow an action, reveal, or shrink/grow meaning); a constant slow push on every shot is no longer a choice. Source: https://www.studiobinder.com/blog/ultimate-guide-to-camera-shots/
- [ ] Hold the result: after the lead move lands, give the eye at least the reading time of what just appeared (see section 5). Source: https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/

## 2. Light and colour as meaning

- [ ] Dark ground, one lit subject: a single key glow per beat, placed behind the focal point. Source: https://en.wikipedia.org/wiki/Low-key_lighting
- [ ] Colour carries state: warm coral light for the problem act, green for the solved act; never mix them in one beat except at the turn. Source: https://en.wikipedia.org/wiki/Mise-en-sc%C3%A8ne
- [ ] One hero accent per beat (coral = failure, amber = an action the user takes, green = success); the rest stays neutral. Source: https://en.wikipedia.org/wiki/Mise-en-sc%C3%A8ne
- [ ] The look is a system with fixed reference values; no per-shot colour taste. Source: https://en.wikipedia.org/wiki/Color_grading

## 3. The sequence

- [ ] Arc for 40-60 s: hook (0-3 s), problem felt, turn, payoff shown, one call to action. Source: https://en.wikipedia.org/wiki/AIDA_(marketing)
- [ ] The hook is emotional before it is informative; the viewer must feel the problem before hearing the fix. Source: https://en.wikipedia.org/wiki/AIDA_(marketing)
- [ ] Change beats on an action: start a move in one beat and finish it in the next. Source: https://en.wikipedia.org/wiki/Cutting_on_action
- [ ] Use a graphic match where one thing becomes another (scattered chips become the logo, a dot becomes a card). Source: https://en.wikipedia.org/wiki/Match_cut
- [ ] Keep screen direction: things travel one way through the film; reverse it only to mean reversal. Source: https://en.wikipedia.org/wiki/180-degree_rule
- [ ] In the Arabic cut, time and progress flow right to left, consistently, in every beat. Source: https://en.wikipedia.org/wiki/180-degree_rule
- [ ] Lay the voice or the music bed across every beat change so the change reads as continuous. Source: https://en.wikipedia.org/wiki/Continuity_editing
- [ ] What follows a beat sets its meaning; order beats so the proof always follows the doubt. Source: https://en.wikipedia.org/wiki/Kuleshov_effect
- [ ] Judge a beat change by feeling and story first, smoothness last. Source: https://en.wikipedia.org/wiki/Walter_Murch
- [ ] No jump in time inside one continuous action unless the jump is the point. Source: https://en.wikipedia.org/wiki/Jump_cut
- [ ] Bookend: the last payoff rhymes with the opening image (the same card, the opposite verdict). Source: https://en.wikipedia.org/wiki/Match_cut
- [ ] Break a convention only where the viewer should feel it break. Source: https://en.wikipedia.org/wiki/Film_grammar

## 4. Animation

- [ ] One lead move per beat; everything else is secondary and smaller, slower or later. Source: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
- [ ] Every significant action gets an anticipation (wind-up, dip, glow) before it. Source: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
- [ ] Ease in and out; linear only for time itself (a timeline drawing, a clock). Source: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
- [ ] Weight through timing: heavy things (stamps, verdicts) accelerate into impact; light things (chips, pills) overshoot and settle. Source: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
- [ ] Squash on impact keeps volume; no rubbery UI. Source: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
- [ ] Travel on arcs, not straight diagonals, for anything that flies. Source: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
- [ ] Follow-through: parts settle after the body stops (a tag after its card, a badge after its chip). Source: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
- [ ] The ease is the personality; pick it per object class and keep it. Source: https://gsap.com/docs/v3/Eases/
- [ ] Beats overlap by design (position parameter "-="), named by labels so retiming moves a label, not twenty tweens. Source: https://gsap.com/docs/v3/GSAP/Timeline/

## 5. Voice and words

- [ ] Narration describes what is on screen at that moment (synchronous), never a different thing. Source: https://en.wikipedia.org/wiki/Voice-over
- [ ] Captions follow the voice; a caption never holds words the voice has not said. Source: https://en.wikipedia.org/wiki/Voice-over
- [ ] Minimum caption time about 0.3 s per word; a line shorter than that is cut down, not rushed. Source: https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/
- [ ] At most two caption lines; break at phrase boundaries, bottom-heavy, never one or two words alone on top. Source: https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-Timed-Text-Style-Guide
- [ ] A caption does not straddle a beat change; split it at the change. Source: https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/
- [ ] A split caption swaps cleanly: the old line is gone before the new one is readable (no ghosted overlap). Source: https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/
- [ ] When the voice explains a picture, do not also print the same sentence as a big title; print only the key word. Source: https://en.wikipedia.org/wiki/Modality_effect
- [ ] Kinetic type acts its word (STAMP slams, TRACED draws) instead of just appearing. Source: https://en.wikipedia.org/wiki/Kinetic_typography

## 6. Arabic

- [ ] On-screen Arabic carries no tashkeel; where a word would be ambiguous, rewrite the line rather than vowel it. Source: https://en.wikipedia.org/wiki/Arabic_diacritics
- [ ] Latin runs (QA Wrap, Jira, URLs, numbers with units) are isolated inside Arabic lines so brackets and punctuation land on the right side. Source: https://en.wikipedia.org/wiki/Bidirectional_text
- [ ] Arabic captions and titles align to the inline start (right); English UI words keep their own order. Source: https://en.wikipedia.org/wiki/Bidirectional_text

## 7. Teaching (tutorials)

- [ ] Labels sit next to the thing they name, never in a separate legend. Source: https://en.wikipedia.org/wiki/Split_attention_effect
- [ ] Explain with voice plus picture; keep on-screen text to the tool's own words. Source: https://en.wikipedia.org/wiki/Modality_effect
- [ ] Cut everything that does not serve the one task; extra controls are extraneous load. Source: https://en.wikipedia.org/wiki/Cognitive_load
- [ ] One task and its result per film, in short segments (one beat per step). Source: https://en.wikipedia.org/wiki/Multimedia_learning

## 8. Animatics and review

- [ ] Every film is reviewed as an animatic (stills on the timed voice or a scratch track) before animation is polished. Source: https://en.wikipedia.org/wiki/Storyboard
- [ ] Camera, shot list and timing problems are fixed at the animatic, not in the render. Source: https://en.wikipedia.org/wiki/Storyboard
- [ ] A beat that does not earn its time in the animatic is cut there. Source: https://en.wikipedia.org/wiki/Storyboard
