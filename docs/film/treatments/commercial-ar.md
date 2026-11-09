# Treatment: QA Wrap 40 s commercial, Arabic cut (كيو إيه راب في 40 ثانية)

Deliverables (D2, D4): `site/media/qa-wrap-commercial-40s-ar.mp4` (1920x1080) and `-ar-9x16.mp4` (1080x1920), 30 fps, 40.0 s. Draft to rework: `QA-Wrap-wt-film` a0e1e73 (`extension/tools/film/commercial40/`).

## Intent

An Arabic-speaking tester should feel, in the first four seconds, the specific insult of "تعذر التكرار" on a bug she knows is real, and leave at 40 s knowing one press gives her the proof, in Jira, in her own language. Same film as the English one (D4): same beats, timing and motion; Arabic UI, words and voice; direction mirrored where direction is meaning.

## Arc

Hook 0-2.5 (the stamp) · problem 2.5-9.4 (proof gone, evidence scatters) · turn 9.4-10.4 (silence, the mark draws, light turns green) · proof 10.4-33 (records, traces, files to Jira, reads Arabic, signs in, updates) · payoff 33-36 (the same card, FIXED) · call to action 36-40.

## Rules for this cut (beyond the bible)

- Every Arabic string from `commercial-bible.md` §8 (four captions changed, one bridge line added). No tashkeel on screen; TTS text only.
- Mirror direction: the timeline draws right to left, dots land right to left, the click sits right of the 500 and the arc travels leftward, the card flies left to the Jira chip, the day row runs right to left (already does). The RTL demonstration (s09) keeps its own logic: Arabic right to left, English runs in their order.
- Titles and captions at the inline start (right). Latin runs isolated (QA Wrap, Jira, Data Center, 500, 403, +212, 2008, MIT, URLs).
- Fix the ghosting at the two split captions (15.47 and 31.5 s): out 0.1 s before in.
- Fonts: Thmanyah Sans / Serif Display / Serif Text only; the builder proves glyphs come from Thmanyah (no fallback face).

## Shots

Times in seconds; 9:16 shares every time (re-layout, never a crop). Voice column = the AR voice line that is sounding (map: bible §8).

| # | Time | Size | Angle | Move | Focal | Dur (s) | Why | On-screen EN | On-screen AR | Narration EN | Narration AR (caption) | Voice direction |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.0-2.45 | MS card | eye level | hold; stamp travels in from 1.4x | the stamp | 2.45 | a verdict needs weight: power4.in slam, then the eye reads the word | CANNOT REPRODUCE · CLOSED · BUG-1042 | تعذر التكرار · مغلق · BUG-1042 | Cannot reproduce. Closed. | تعذر تكراره. مغلق. | flat, a little tired, as if reading the ticket aloud |
| 2 | 2.45-4.0 | MS card | eye level | hold; bug icon pops and drifts to the corner | coral bug icon | 1.55 | one fact: the bug existed; short because it is a counter-punch to the stamp | (none) | (none) | Your bug was real. | كان الخلل حقيقيا. | firmer on حقيقيا |
| 3 | 4.0-5.9 | MS card + title | eye level | hold; title wipes in from the right; stamp falls away at 5.2 | the title | 1.9 | names what was lost before we see it lost | STEPS? · REQUEST? · CONSOLE? | الخطوات؟ · الطلب؟ · وحدة التحكم؟ | The proof was gone. | لكن الدليل ضاع. | the last word falls |
| 4 | 5.9-8.0 | WS opening to EWS | slight high (chips spread on a plane) | world drifts outward as chips scatter | none on purpose; the gaps between chips | 2.1 | isolation shot: evidence too small and too far apart to hold | (chip icons only) | (chip icons only) | Steps, requests, console: scattered. [written] | الخطوات والطلبات ووحدة التحكم، تبعثرت كلها. | quiet, almost to herself; keeps going into the next line |
| 5 | 8.0-9.4 | WS | eye level | hold; START pops with anticipation dip | amber START | 1.4 | the only bright object in the scatter: the one action | START | ابدأ | Press Start, | اضغط ابدأ. | lift, an invitation; do not stop at ابدأ, carry across the silence |
| 6 | 9.4-13.0 | WS to EWS | eye level | chips sucked to centre (graphic match into the mark), mark slides right, timeline draws right to left | the line's drawing head | 3.6 | the turn: scatter becomes one line; linear draw because it is time | 00:01…00:07 · CLICKS REQUESTS CONSOLE | 00:01…00:07 · النقرات · الطلبات · وحدة التحكم | and QA Wrap records while you test. | كيو إيه راب (QA Wrap) يسجل أثناء اختبارك. | brighter, forward, pace up about 10 % |
| 7 | 13.0-17.0 | MS of two points (scale 1.5x) | eye level | push-in by scale; arc draws leftward from click to 500 | the arc | 4.0 | the product's core claim needs one clear line between cause and effect | TRACED · 500 · +212 ms · HIGH | تم تتبعه · 500 · +212 مللي ثانية · عالية | Every failure links to the click that caused it. | كل خطأ يرتبط بالنقرة / التي سببته. | stress النقرة; one phrase across the caption swap |
| 8 | 17.0-20.0 | MS card, then CU Jira chip | eye level | card flies on an arc to the left; Jira chip pops | FILE, then the green check | 3.0 | one press, one result; the flight is the "press once" | OPEN · FILE · J · 3 · FILED | مفتوح · ارفع · J · 3 · تم الرفع | Press once. It's in Jira, proof attached. | اضغط مرة. / وهو في جيرا (Jira) بدليله. | quick, satisfied |
| 9 | 20.0-24.5 | MS document | eye level | hold; caret types right to left | the caret and the bracketed English words | 4.5 | the longest beat: Arabic readers must see their script behave, and it needs reading time | RTL ı LTR · ASKED FOR SINCE 2008 | RTL ı LTR · مطلوب منذ 2008 | In Jira, Arabic reads right to left. English keeps its order. | العربية في جيرا / من اليمين إلى اليسار. / والإنجليزية بترتيبها. | warm pride, unhurried |
| 10 | 24.5-28.6 | MS | eye level | document exits right (mirrored); fields and key arrive; 403 morphs into a sentence | the key, then the sentence card | 4.1 | two quick proofs in one place: it signs in, and its errors speak plainly | DATA CENTER · 403 · The token works but is not allowed to do this. | مركز البيانات (Data Center) · 403 · الرمز يعمل لكنه غير مصرح له بهذا الإجراء. | Data Center sign-in works. Errors read as plain sentences. | دخول مركز البيانات (Data Center) يعمل. / والأخطاء جمل واضحة. | matter-of-fact |
| 11 | 28.6-33.0 | WS | eye level | hold; day tiles tick right to left; UPDATE pressed | the week row, then UPDATE | 4.4 | time passing (a week) needs a wide row; ends on the one press | ن ث ر خ ج س ح (EN M-S) · NEW · UPDATE · SESSIONS KEPT | جديد · تحديث · الجلسات محفوظة | Updates are checked daily. After one-time setup, one press installs. | التحديثات تفحص يوميا. / وبعد الإعداد الأول / تثبتها بضغطة. | reassuring, light |
| 12 | 33.0-35.9 | MS card (same framing as shot 1) | eye level | hold; FIXED slams (power4.in 0.25 s) | the green stamp | 2.9 | bookend: the opening image with the opposite verdict | OPEN · FIXED | مفتوح · تم الإصلاح | Your next bug comes with proof. | الخلل القادم يأتي بدليله. | the line of the film: slower, warm, a small smile |
| 13 | 36.0-40.0 | MS centred | eye level | hold; mark draws, items fade in in order | the green button | 4.0 | the end is stable (centre); the button is the one bright thing | QA Wrap · Made by Nader Alzghoul (NJ-Burrito) · Free · MIT · English and Arabic · Download free · URL | من صنع نادر الزغول (NJ-Burrito) · مجاني · MIT · عربي وإنجليزي · احصل عليه مجانا | Download QA Wrap. It's free and open source. | احصل على كيو إيه راب. / مجاني ومفتوح المصدر. | plain fact, no sell |

## Changes from the draft (a0e1e73)

1. Captions 1, 10, 13, 19 rewritten; bridge 3b added (voice and caption) - `commercial-bible.md` §8.
2. Mirrored time direction in shots 6, 7, 8, 10.
3. No ghosting at the 15.47 and 31.5 caption swaps.
4. Voice read as 10 continuous phrases (bible §8), crossing the 9.5 s silence.

## Sign-off focus

Shot 1 slam weight and the stamp's Arabic size (84 px in the draft: check it fits the card at the rotated angle); shot 6 direction; shot 9 bidi of the typed line; the four changed captions; frame 0 and the last frame of both aspects.
