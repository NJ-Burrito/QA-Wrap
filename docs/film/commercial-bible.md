# QA Wrap 40 s commercial: film bible (qaw-1109, D6)

The shipped English film is the reference. This bible records what it is (measured), the rules that make its look, the shot-by-shot table, the English to Arabic line map, and the grammar the six tutorials inherit. Rules cite `directing.md`; sources are in `research.md`.

Provenance: `QA-Wrap/site/media/qa-wrap-commercial-40s.mp4` (h264 1920x1080, 30 fps, 40.0 s, 1200 frames, aac 48 kHz stereo) and `-9x16.mp4` (1080x1920, 1200 frames). HyperFrames 0.8.186 source is lost; the film lane rebuilt it as `QA-Wrap-wt-film/extension/tools/film/commercial40/composition.template.html` (SSIM 0.957 to the shipped EN). Measurements below: `work/sdlc/direct/DETAIL.md` step 1. English narration text comes from the on-screen captions (repo text, no transcription); lines the shot needs beyond them are written from the shot's meaning and marked **[written]**.

## 1. What the film is

- **One continuous stage, no cuts.** ffmpeg scene detection finds 0 cuts in both cuts (only one frame scores above 0.035). Every "shot" is a beat inside one frame: objects arrive, transform and leave; the ground, the drifting ghost blocks and the bokeh never stop. This is the film's signature and the first rule for every film that follows.
- **Two acts by light.** 0 to 9.4 s is lit by a warm coral glow from frame left (sampled #493432 at its core): the problem. From 9.4 s a green glow rises on frame right (#2b3931): the tool. The turn is a colour change, not a cut.
- **A bookend.** The BUG-1042 card opens the film with a coral CANNOT REPRODUCE stamp and comes back at 33 s with a green FIXED stamp.
- **Voice-led.** Voice onsets sit within 0.25 s before every caption window; captions follow the voice. The one deliberate silence is 9.5 to 10.0 s (-75 dBFS): a half-second of nothing before the brand appears.

## 2. Look

| Element | Rule | Value (source) |
|---|---|---|
| Ground | One dark basalt plane, never pure black | #171a1d (CSS), sampled #171b1f |
| Depth | Blurred ghost blocks (#262d38, blur 7 px, 42 %) and bokeh dots (#aeb6bf, blur 5 px, 28 %) drift linearly across the full 40 s | composition lines 25-26, 180-181 |
| Key light | One soft radial glow per act, behind the focal side | warm #493432 (act 1), green #2b3931 (act 2) sampled |
| Cards | Raised, 16-18 px radius, top-lit gradient #2a2e33 to #24282c, 1 px edge #343a41, shadow 0 30 60 rgba(0,0,0,.45) | `.card` |
| Chips | 60 px rounded squares, gradient #2d3238 to #23272c, line icons 2.2 px stroke #eceae6 | `.chip`, `.ic` |
| Buttons | Amber, chunky, with a hard 8 px under-edge (#c08a25): they look pressable | `.btn` |
| Pills | 34 px, #272b30 with #3a4047 edge, caps tracked .08em | `.pill` |

**Palette, by meaning.** Ink #ecebe7 · dim #8a9096 · line #3a4047 · **coral #ff7d63 = failure, verdicts against you** · **amber #f0b94a = an action the user takes (Start, File, Update), requests on the timeline** · **green #7bd389 = success, proof, the free download**. One hero accent per beat (`directing.md` §2).

Tutorial drift to fix: `build-tut/PREPRO.md` uses basalt #1D2024, corn #E2AE38, coral #FF9270. The tutorials take the commercial values above.

## 3. Type

- Thmanyah only (Sans, Serif Display, Serif Text). **Cairo is banned**; no fallback face may render (a builder checks the rendered glyphs, not the CSS).
- Beat titles: Thmanyah Serif Display 700, 70 px on 1080, caps in English, top inline-start (left EN, right AR), ink #d8d6d1 with one coloured word (TRACED, FILED in green; 2008 on a coral block).
- Captions: Thmanyah Sans 500, 40 px on 1080, bottom inline-start, one line, ink #eeede9.
- UI labels: Thmanyah Sans 700 to 900, caps, tracked .04-.08em. Status numbers (500, 403): Thmanyah Serif Text 500.
- [A, not verified] The film lane noted the shipped EN captions look like IBM Plex, not Thmanyah. If true, the shipped EN cut breaks the font rule; the rebuild already uses Thmanyah Sans.

## 4. Motion grammar

| Object class | Lead move | Ease and time | Why |
|---|---|---|---|
| Verdict stamps | slam from 1.4x to rest | power4.in, 0.25-0.95 s | weight accelerates into impact |
| Objects that arrive (chips, buttons, badges, Jira) | scale from 0.3-0.5 with overshoot | back.out(1.4-3), 0.3-0.5 s | light things overshoot and settle |
| Repositioning, camera-like shifts | translate | power2.inOut, 0.5-1.4 s | ease in and out |
| Time (timeline line, typing caret) | draw | linear (ease "none") | time itself is linear |
| Drift (scatter, float) | small translate + rotate | sine.inOut, 2.4-3 s | breathing secondary motion |
| Ambient (ghosts, bokeh) | slow translate | linear over 40 s | never stops: the world is alive |
| Paths (the click-to-500 arc, logo check) | stroke draw | power2.inOut / out, 0.5-0.7 s | the line is the meaning |

Rules: one lead move per beat; secondary motion is smaller and later; every action has a 0.1-0.3 s anticipation (a dim state, a glow) before it; beats overlap rather than wait. Seek-safe: no callbacks, seeded jitter only.

## 5. Pacing

- 13 beats in 40 s: average 3.1 s, shortest 1.4 s (Press Start), longest 4.5 s (the Jira RTL demonstration). Act 1 (problem) 9.4 s, turn 0.6 s, act 2 (tool) 23 s, payoff 3 s, call to action 4 s.
- Caption reading: 20 captions, 2 to 6 words each; the shortest window is 0.73 s for "Press once." (2 words, 0.37 s per word, above the 0.3 s floor).
- Audio: voice beats -13 to -20 dBFS; bed-only gaps -27 to -36 (longest 5.5-7.5 s during the scatter); hard silence 9.5-10.0 s; tail fade from 39.0 s.

## 6. Voice direction (Arabic narration)

Engine: D4 names Kore, one take per line. **The machine rule bans Gemini (2026-10-23); D4 and PREPRO.md cite an owner exception for this job. The Lead confirms which engine before any call; this direction is engine-neutral.**

- Who speaks: a calm senior tester talking to a colleague, not an announcer. Close, warm, low-middle register; Modern Standard Arabic with plain, unforced pronunciation.
- Act 1 (0-9.4 s): slower, slightly flat, a tester whose bug was closed on her; the last word of "لكن الدليل ضاع" falls.
- The turn (from 10 s): brighter and forward, as if leaning in; the pace lifts about 10 %.
- Proof beats (13-33 s): matter-of-fact confidence, stress on the noun that appears on screen (النقرة، جيرا، العربية).
- Payoff and call to action (33-40 s): plain and warm, no hype, no rising sell; "مجاني ومفتوح المصدر" said like a fact.
- Continuous read (machine rule 2026-11-08): the voice runs through caption changes and never stops at a caption's last word. Lines are voiced as phrases that bridge captions (map in §8). The musical silence at 9.5 s stays; the voice carries across it.
- Pace: Arabic about 115 wpm, English 150 wpm (PREPRO gate values). Breath of at least 0.4 s only between voice lines, never inside a phrase that a caption splits.

## 7. Shot-by-shot (16:9 times; 9:16 shares every time)

Frames: `frames/sNN-16x9.png` and `frames/sNN-9x16.png` (one keyframe per beat, at the time in brackets).

| # | In-out s (key) | Size / angle / move | Focal point | What happens | On-screen words EN / AR | Out |
|---|---|---|---|---|---|---|
| s01 | 0.0-2.45 (1.2) | MS of the BUG-1042 card, eye level, hold; the stamp travels in from oversize | the stamp | CANNOT REPRODUCE slams from 1.4x, dim red to coral, onto the card (power4.in 0.95 s); tag CLOSED; warm glow left | CANNOT REPRODUCE, CLOSED, BUG-1042 / تعذر التكرار، مغلق | bug icon pops on the card |
| s02 | 2.45-4.0 (3.2) | MS, hold | the bug icon | a coral bug icon pops (back.out 2) and drifts to the card's corner: the bug was real | (none) | title wipes in |
| s03 | 4.0-5.9 (4.8) | MS, hold, title above | the title | STEPS? · REQUEST? · CONSOLE? reveals top-left; at 5.2 the stamp drops away | STEPS? · REQUEST? · CONSOLE? / الخطوات؟ · الطلب؟ · وحدة التحكم؟ | card dissolves into chips |
| s04 | 5.9-8.0 (6.8) | WS to EWS, slight push-out feel as chips spread | none on purpose: scattered evidence | 12 evidence chips (clicks, requests, console, camera, timer) burst from centre and drift apart; the bug flies loose | (none; bed only) | Start button rises among them |
| s05 | 8.0-9.4 (8.6) | WS, hold | the amber START button | START pops (back.out 2) in the scatter, is pressed | START / ابدأ | chips sucked to centre (9.4) |
| s06 | 9.4-13.0 (11.5) | WS then EWS, the mark slides left and the line draws right | the drawing timeline | silence 9.5-10.0; the QA mark draws its check (10.0-10.7), slides left; a timeline draws 2.4 s linear; amber and white dots land; clock counts 00:01 to 00:07; pills CLICKS · REQUESTS · CONSOLE; glow turns green | 00:01…00:07, CLICKS REQUESTS CONSOLE / النقرات، الطلبات، وحدة التحكم | burst dot grows |
| s07 | 13.0-17.0 (15.6) | MS on two points of the line (push-in feel by scale 1.5x) | the arc from click to 500 | the click burst (13.2) and a 500 box (13.9) grow; an arc draws between them (15.0) with +212 ms; TRACED title; HIGH pill (16.4) | TRACED, 500, +212 ms, HIGH / تم تتبعه، 500، +212 مللي ثانية، عالية | the line collapses into the card |
| s08 | 17.0-20.0 (18.9) | MS card, then CU on the Jira chip, truck right | FILE then the Jira check | the card returns OPEN with filled evidence rows; FILE pressed (17.5); the card flies to a J chip (18.3); green check (19.2); attachment 3; FILED | OPEN, FILE, J, 3, FILED / مفتوح، ارفع، تم الرفع | Jira issue opens as a document |
| s09 | 20.0-24.5 (23.0) | MS of a document card, hold | the caret and the typed line | Arabic types right to left with a caret, the English API and Login stay in their order; RTL ı LTR pill; ASKED FOR SINCE 2008 | RTL ı LTR, ASKED FOR SINCE 2008 / مطلوب منذ 2008 | the document exits left (24.5) |
| s10 | 24.5-28.6 (27.0) | MS, hold | the key, then the plain sentence | three password fields, a key, green check (26.2): sign-in works; a 403 box turns into a plain sentence card | DATA CENTER, 403, "The token works but is not allowed to do this." / مركز البيانات (Data Center)، الرمز يعمل لكنه غير مصرح له بهذا الإجراء. | the mark returns centre |
| s11 | 28.6-33.0 (31.5) | WS, hold | the week row, then UPDATE | seven day tiles tick one by one; NEW on the last day; a download chip with badge 1; amber UPDATE pressed; SESSIONS KEPT | M T W T F S S, NEW, UPDATE, SESSIONS KEPT / ن ث ر خ ج س ح، جديد، تحديث، الجلسات محفوظة | the bug card returns |
| s12 | 33.0-35.9 (34.8) | MS of the BUG-1042 card (rhymes with s01) | the green stamp | the card is OPEN with full evidence rows; FIXED slams (power4.in 0.25 s) at 34.4; tag turns green | OPEN, FIXED / مفتوح، تم الإصلاح | card fades (35.7) |
| s13 | 36.0-40.0 (38.5) | MS centred (the stable end), hold | the green download button | QA Wrap lockup (mark draws), maker line, Free · MIT · English and Arabic, Download free (37.4), site URL (37.6), GitHub (37.9) | QA Wrap, Made by Nader Alzghoul (NJ-Burrito), Free, MIT, English and Arabic, Download free / من صنع نادر الزغول (NJ-Burrito)، مجاني، MIT، عربي وإنجليزي، احصل عليه مجانا | end |

9:16 cut: the same timeline re-laid out (world scaled about 0.66, captions and titles in screen space; captions sit near 66 % height, inside the Reels and Shorts safe area); never a crop.

Known flaws to fix in the Arabic cut (and noted for any EN re-render):

1. Split captions ghost over each other at 15.5 s and 31.5 s. Rule: the old line is fully out before the new line is readable (`directing.md` §5).
2. Direction: in the Arabic cut, time flows right to left everywhere (the days row already does; the timeline line, the click-to-500 arc, the dots and the card's flight to Jira must mirror too). The RTL demonstration in s09 is unchanged.

## 8. English to Arabic line map

Captions (window = shipped EN window, measured). AR changes from `build-film/script-ar.md` are marked **changed** with the reason.

| # | Window s | EN caption | AR caption (on screen, unvowelled) | Note |
|---|---|---|---|---|
| 1 | 0.37-2.07 | Cannot reproduce. Closed. | تعذر تكراره. مغلق. | **changed**: the bug (الخلل) is masculine, so تكراره; مغلق matches the CLOSED tag on screen |
| 2 | 2.47-4.0 | Your bug was real. | كان الخلل حقيقيا. | |
| 3 | 4.03-5.9 | The proof was gone. | لكن الدليل ضاع. | |
| 3b | 6.0-8.0 | Steps, requests, console: scattered. **[written]** | الخطوات والطلبات ووحدة التحكم، تبعثرت كلها. | **new**: voice bridge over the scatter (continuous-narration rule); EN has no voice here today |
| 4 | 8.2-9.27 | Press Start. | اضغط ابدأ. | |
| 5 | 10.37-13.0 | QA Wrap records while you test. | كيو إيه راب (QA Wrap) يسجل أثناء اختبارك. | |
| 6 | 13.07-15.47 | Every failure links to the click | كل خطأ يرتبط بالنقرة | swap cleanly at 15.47 |
| 7 | 15.47-16.9 | that caused it. | التي سببته. | |
| 8 | 16.97-17.7 | Press once. | اضغط مرة. | |
| 9 | 17.77-20.0 | It's in Jira, proof attached. | وهو في جيرا (Jira) بدليله. | |
| 10 | 20.07-21.6 | In Jira, Arabic reads | العربية في جيرا | **changed**: تقرأ unvowelled reads as "you read"; the verbless line has one reading |
| 11 | 21.6-22.65 | right to left. | من اليمين إلى اليسار. | |
| 12 | 22.7-24.7 | English keeps its order. | والإنجليزية بترتيبها. | |
| 13 | 24.77-26.35 | Data Center sign-in works. | دخول مركز البيانات (Data Center) يعمل. | **changed**: 6 to 5 words for a 1.58 s window |
| 14 | 26.4-28.6 | Errors read as plain sentences. | والأخطاء جمل واضحة. | |
| 15 | 28.67-30.05 | Updates are checked daily. | التحديثات تفحص يوميا. | |
| 16 | 30.1-31.5 | After one-time setup, | وبعد الإعداد الأول | swap cleanly at 31.5 |
| 17 | 31.5-32.9 | one press installs. | تثبتها بضغطة. | |
| 18 | 33.07-35.7 | Your next bug comes with proof. | الخلل القادم يأتي بدليله. | |
| 19 | 36.37-37.4 | Download QA Wrap. | احصل على كيو إيه راب. | **changed**: حمل unvowelled also reads "carried"; matches the end-card button احصل عليه مجانا |
| 20 | 37.43-39.27 | It's free and open source. | مجاني ومفتوح المصدر. | |

Voice lines (phrases that run through caption changes; the TTS text may carry tashkeel, the screen never does):

| V | Starts s | Covers captions | EN voice | AR TTS text |
|---|---|---|---|---|
| 1 | 0.4 | 1 | Cannot reproduce. Closed. | تَعَذَّرَ تَكْرَارُهُ. مُغْلَقٌ. |
| 2 | 2.5 | 2, 3, 3b | Your bug was real. The proof was gone. Steps, requests, console: scattered. | كَانَ الْخَلَلُ حَقِيقِيًّا، لَكِنَّ الدَّلِيلَ ضَاعَ. الْخُطُوَاتُ وَالطَّلَبَاتُ وَوَحْدَةُ التَّحَكُّمِ، تَبَعْثَرَتْ كُلُّهَا. |
| 3 | 8.22 | 4, 5 | Press Start, and QA Wrap records while you test. | اضْغَطِ ابْدَأْ، وَكِيُو إِي رَاب يُسَجِّلُ أَثْنَاءَ اخْتِبَارِكَ. |
| 4 | 13.08 | 6, 7 | Every failure links to the click that caused it. | كُلُّ خَطَأٍ يَرْتَبِطُ بِالنَّقْرَةِ الَّتِي سَبَّبَتْهُ. |
| 5 | 16.98 | 8, 9 | Press once. It's in Jira, proof attached. | اضْغَطْ مَرَّةً، وَهُوَ فِي جِيرَا بِدَلِيلِهِ. |
| 6 | 20.1 | 10, 11, 12 | In Jira, Arabic reads right to left. English keeps its order. | الْعَرَبِيَّةُ فِي جِيرَا مِنَ الْيَمِينِ إِلَى الْيَسَارِ، وَالْإِنْجِلِيزِيَّةُ بِتَرْتِيبِهَا. |
| 7 | 24.8 | 13, 14 | Data Center sign-in works. Errors read as plain sentences. | دُخُولُ مَرْكَزِ الْبَيَانَاتِ يَعْمَلُ، وَالْأَخْطَاءُ جُمَلٌ وَاضِحَةٌ. |
| 8 | 28.7 | 15, 16, 17 | Updates are checked daily. After one-time setup, one press installs. | التَّحْدِيثَاتُ تُفْحَصُ يَوْمِيًّا، وَبَعْدَ الْإِعْدَادِ الْأَوَّلِ تُثَبِّتُهَا بِضَغْطَةٍ. |
| 9 | 33.1 | 18 | Your next bug comes with proof. | الْخَلَلُ الْقَادِمُ يَأْتِي بِدَلِيلِهِ. |
| 10 | 36.4 | 19, 20 | Download QA Wrap. It's free and open source. | احْصُلْ عَلَى كِيُو إِي رَاب، مَجَّانِيٌّ وَمَفْتُوحُ الْمَصْدَرِ. |

V2 now runs 2.5 to about 8.0 s and V3 crosses the 9.5 s musical silence; the voice lane fits both inside their windows (mix.py speeds a take at most 1.15x; an overrun is reported, never re-voiced).

Arabic rules on screen: no tashkeel, no tatweel, no Persian letters (ک ی گ پ چ ژ), Arabic punctuation (، ؟), Western digits, Latin runs isolated (`unicode-bidi: isolate`), product words as the tool writes them, foreign words glossed on first use.

## 9. Tutorial grammar (what the six tutorials inherit)

1. **Same world.** Basalt ground, drifting ghost blocks and bokeh, raised cards and chips, the palette and type of §2-3. No screen recording: the tool, its popup and its report are drawn as cards; websites are drawn miniatures.
2. **One continuous stage.** No hard cuts; beats change by objects arriving, transforming (graphic match) and leaving. A beat may change size by scaling the world (push-in or pull-out), never by cutting.
3. **Light tells the act.** Each film opens in the warm problem light and turns green at the moment the tool does its job; one hero accent per beat (coral failure, amber the user's action, green proof).
4. **Arc in 40-60 s:** a felt problem on a real-looking page (0-7 s), the action in the tool (one press, drawn big), what the tool records or produces, the proof or result, an honest limit if one exists, end card. Six to eight beats of 5 to 8 s.
5. **One task per film.** Show only the controls the task needs; label things where they are (no legends).
6. **Words.** Voice explains; the screen shows only the tool's own words, at their real names (frozen UI strings), plus one beat title in Serif Display. Captions bottom, inline-start, cut from the voice lines; the voice runs through them.
7. **Websites** look like the public practice apps: Sauce Demo (Swag Labs: Sauce Labs Backpack, Add to cart, Checkout), Practice Software Testing (Toolshop: Combination Pliers, Claw Hammer, contact form, payment), the-internet (Form Authentication, Status Codes, Dynamic Loading). Drawn in our style, no logos copied, never lorem.
8. **The person.** One recurring tester across the six films, seen only as a cursor with a press ripple and her name on exports: Layla Haddad / ليلى حداد (the name used in the frozen profile strings).
9. **Direction.** EN films flow left to right; AR films mirror the layout and time flows right to left (timeline, travel, progress). Latin UI words keep their own order.
10. **End card.** The QA Wrap lockup with the maker line, then "More tutorials, inside the tool / المزيد من الدروس داخل الأداة", held 3 s, centred.
11. **Numbers on screen** are the tool's real formats (00:41, +212 ms, 3 of 12 pages) and never claims about users.
