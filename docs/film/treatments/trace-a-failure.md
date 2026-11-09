# Treatment: Tutorial 2, trace-a-failure (Trace a failure to the click / تتبع الخطأ إلى النقرة)

52 s, 16:9, EN + AR pair. Draft: `QA-Wrap-wt-tut/videos-tut/trace-a-failure-{en,ar}` (29ba208). Grammar: `commercial-bible.md` §9. This is the commercial's shot 7 told slowly: the film may quote that arc on purpose.

## Intent

The tester feels the familiar dread of a red 500 with no idea which of her clicks caused it, then sees QA Wrap draw one line from the failure back to the click right before it, with its time, ready to hand to a developer.

## Arc

Doubt (0-7, warm) · everything on one line (7-14.6, the light turns green) · the thread draws back to the cause (14.6-21.8) · the cause named (21.8-28.8) · where it sits in the report (28.8-35.8) · cause and effect side by side (35.8-43) · handed over, reproduced (43-49.6) · end card.

## Director's changes from the draft

1. Shot 1 now holds a high angle on the three numbered clicks under the question mark: the tester is small against the problem; shot 4 answers with a low angle on the named click.
2. The thread (shot 3) travels right to left in EN as it goes back in time; in AR, time runs right to left, so "back in time" travels left to right. The direction means "back", in both.
3. AR L6 now keeps the console: "بلا بحث في وحدة التحكم" (the draft dropped it; the pair must say the same thing).
4. Words "caused by", "Repeat", "Reproduced" are [PREPRO]: check against the frozen i18n before build.

## Shots

| # | Time | Size | Angle | Move | Focal | Dur (s) | Why | On-screen EN | On-screen AR | Narration EN | Narration AR (caption) | Voice direction |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.0-7.2 | WS: a Toolshop payment page (Combination Pliers in the cart, Confirm button), a console panel slides in | high angle as the three numbered click rings rise under a big question mark | push-in toward the rings after the 500 lands | the question mark over three rings | 7.2 | the problem must be felt: the tester small, the clicks equal and anonymous | Payment · Confirm · Something went wrong · 500 · Console | وحدة التحكم · 500 (the site stays English) | A page breaks. The console shows a red 500. But which click caused it? | تتعطل الصفحة، ويظهر خطأ أحمر رقمه 500. لكن أي نقرة سببته؟ | puzzled, real question at the end |
| 2 | 7.2-14.6 | EWS: one timeline across the frame | eye level | hold; the line draws linearly, seven dots land (clicks white, requests amber, errors coral) | the coral dot with its pill | 7.4 | the turn: from chaos to one ordered line; widest shot because it is the whole session | 00:38 · 00:41 · POST /payment/check 500 · Click · Request · Error | النقرة · الطلب · الخطأ (labels beside their dots) | QA Wrap keeps every click, request and error on one timeline. | كيو إيه راب يحتفظ بكل نقرة وطلب وخطأ على خط زمني واحد. | brighter, the turn |
| 3 | 14.6-21.8 | MS of the two dots | eye level | push-in by scale; others dim; an amber thread draws back from the failure to the click before it on an arc | the thread's drawing head | 7.2 | one line between cause and effect, the core of the film | caused by [PREPRO] | بسبب | When a request fails, QA Wrap links it to the click right before it. | عندما يفشل طلب، يربطه كيو إيه راب بالنقرة التي سبقته مباشرة. | steady, stress النقرة |
| 4 | 21.8-28.8 | CU: the click becomes a card | low angle (the card rises and tilts toward us) | hold after the grow | the time 00:41 | 7.0 | the anonymous click from shot 1 now has a name and a time: low angle gives it importance | Click · Confirm · 00:41 | نقرة · Confirm · 00:41 | So the click that broke the page is named, with its time. | فتعرف النقرة التي كسرت الصفحة، مع وقتها بالضبط. | quiet satisfaction |
| 5 | 28.8-35.8 | MS of the report's Timeline tab | eye level | hold; context rows fade back, the failed row glows coral, an amber link drops a "caused by" row beside it | the two linked rows | 7.0 | shows where the answer lives in the real tool | Timeline · Request 500 · caused by Click Confirm 00:41 | الخط الزمني · بسبب نقرة Confirm عند 00:41 | Open the failure in the report, and the click sits right beside it. | افتح الخطأ في التقرير، وستجد النقرة بجانبه مباشرة. | instructive, unhurried |
| 6 | 35.8-43.0 | MS: two big cards, click then 500, an arrow between, over a blurred console | eye level | hold | the arrow | 7.2 | the summary image, made simple: cause, arrow, effect | Click Confirm 00:41 → Request 500 | نقرة Confirm عند 00:41 ← طلب 500 | No guessing, and no digging through the console. Just the step that broke it. | بلا تخمين، وبلا بحث في وحدة التحكم. فقط الخطوة التي سببت العطل. | firm, a little relief |
| 7 | 43.0-49.6 | WS: the pair slides to a developer card | eye level | truck with the pair (inline-end direction); Repeat pressed | the green Reproduced pill | 6.6 | the payoff is someone else repeating it: the move hands it over | Repeat · Reproduced [PREPRO] | كرر · تم تكرار الخلل | Hand it over, and a developer can repeat it in seconds. | سلمه للمطور ليكرر الخطوات في ثوان. | warm, done |
| 8 | 49.8-52.0 | MS centred | eye level | hold | the lockup | 2.2 | stable end | QA Wrap · More tutorials, inside the tool | المزيد من الدروس داخل الأداة | (none) | (none) | bed only |

## Sign-off focus

Shot 3 thread direction (means "back in time") in both languages; the AR arrow in shot 6 points from cause to effect in reading order (right to left); 500 and 00:41 isolated as Latin runs.
