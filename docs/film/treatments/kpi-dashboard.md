# Treatment: Tutorial 6, kpi-dashboard (Your performance dashboard / لوحة مؤشرات أدائك)

54 s, 16:9, EN + AR pair. Not built yet. Grammar: `commercial-bible.md` §9. Words: `QA-Wrap-wt-kpi/work/sdlc/build-kpi/strings.md` (kpi.*). Entry: Settings > About > Performance indicators > Open the dashboard. The product's Arabic KPI strings carry tashkeel (يوميًا، تُختبر، سجّل، مصنّفة); the film draws them without marks.

## Intent

The tester sees that the work she already records becomes her own dashboard (time, coverage, bugs) computed on her device, and that she can hand it over as a PDF. Every number shown is a format the tool really prints, never a claim about users.

## Arc

Sessions pile up (0-7) · the dashboard lights up, on her device (7-14) · time per day and per site (14-22) · coverage: tested against found (22-30) · bugs filed, only real bugs (30-37) · sessions and average (37-44) · export as PDF (44-51) · end card.

## Director's changes from PREPRO

1. PREPRO L5 "bugs by severity" and L6 "trend lines show whether this week is better" are dropped: notes do not store a severity yet (kpi.note.severity: bugs show as Not rated), and no week-over-week verdict exists in the strings. Showing a coloured severity split would be a false picture.
2. Coverage wording follows D5 and kpi.note.basis.*: pages the sessions visited plus links found, against pages with at least one recorded action.
3. Product term clash, for the Lead: the KPI Arabic calls bugs الأخطاء (kpi.col.bugs, kpi.tile.bugs) and console errors are also أخطاء; tutorials 1-3 say خلل. The film's narration says "ما سجلته كخلل" and draws the product label as it is.
4. PREPRO L7 "It carries your name" is not in kpi.print.trace ("QA Wrap {version} · {date}"); the film shows only what the strings confirm, unless the Lead confirms the fine print from tutorial 5 is also printed on this PDF.
5. Site tiles: Swag Labs, The Internet, Toolshop (the three practice sites), sample numbers only.

## Shots

| # | Time | Size | Angle | Move | Focal | Dur (s) | Why | On-screen EN | On-screen AR | Narration EN | Narration AR (caption) | Voice direction |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.0-7.0 | WS: session cards from tutorials 1-3 stack and pour into an empty frame | slight high | cards fall on arcs into the frame (graphic match: cards become data) | the frame filling | 7.0 | the source of every number is her own sessions; show it before any chart | Checkout flow · Payment check · Contact form | مسار الدفع · فحص الدفع · نموذج التواصل | Every session you record feeds a dashboard that is yours alone. | كل جلسة تسجلها تغذي لوحة تخصك وحدك. | warm, personal |
| 2 | 7.0-14.4 | MS: the dashboard head lights up | eye level | hold; the lede line writes in | the lede "Nothing leaves your browser." | 7.4 | privacy is the first thing she must believe | YOUR OWN WORK · Performance indicators · Time, coverage and bugs, counted only from your own sessions on this device. Nothing leaves your browser. | عملك أنت · مؤشرات الأداء · الوقت والتغطية والأخطاء، محسوبة من جلساتك أنت فقط على هذا الجهاز. لا يغادر شيء متصفحك. | Open it from Settings, under Performance indicators. Nothing leaves your browser. | افتحها من الإعدادات، من «مؤشرات الأداء». ولا يغادر شيء متصفحك. | calm, trustworthy |
| 3 | 14.4-22.0 | MS: bar chart of time per day; Group by flips to Week; site colours split the bars | eye level | hold; bars grow one by one (ease out), then a toggle swaps the grouping | the Day / Week toggle | 7.6 | one chart, one interaction | Time spent testing per day · Day · Week · Time per site · Swag Labs · The Internet · Toolshop | الوقت المستغرق في الاختبار يوميا · يوم · أسبوع · الوقت لكل موقع | See how long you test, per day or per week, and on which sites. | اعرف كم تختبر، في اليوم أو في الأسبوع، وعلى أي مواقع. | easy |
| 4 | 22.0-30.0 | WS: a site map of squares; tested squares fill amber, untested stay hollow | high angle (a map is read from above) | hold; a ring counts up as squares fill | the ring's number | 8.0 | coverage is a map: the high wide view reads it | Page coverage per site · Tested (at least one recorded action) · Not tested yet · 9 of 14 pages | تغطية الصفحات لكل موقع · مختبرة (إجراء مسجل واحد على الأقل) · لم تختبر بعد · 9 من 14 صفحة | Coverage compares the pages you tested with the pages your sessions found. | التغطية تقارن الصفحات التي اختبرتها بالصفحات التي وجدتها جلساتك. | precise, slightly slower |
| 5 | 30.0-37.0 | MS: a line of bugs filed per day | eye level | hold; coral bug flags land on the line; console and request markers drift past, grey, and fall away | a coral flag landing | 7.0 | the rule from tutorial 3 pays off: only real bugs count | Bugs filed per day · Only notes you filed as a bug are counted. | الأخطاء المسجلة يوميا · لا تحسب إلا الملاحظات التي سجلتها أنت كخطأ. | Bugs filed counts only the notes you filed as bugs. Console errors do not count. | ولا تحسب «الأخطاء المسجلة» إلا ما سجلته كخلل، لا أخطاء وحدة التحكم. | firm on only / إلا |
| 6 | 37.0-44.0 | MS: tiles slide in: Sessions, Average session, Bugs filed, Pages tested | eye level | hold; numbers tick | the Average session tile | 7.0 | the summary row, read at a glance | Sessions · Average session · 24 min · Bugs filed · Pages tested | الجلسات · متوسط الجلسة · 24 د · الأخطاء المسجلة · الصفحات المختبرة | Sessions per day and your average session sit beside them. | وبجانبها الجلسات في كل يوم، ومتوسط جلستك. | light |
| 7 | 44.0-51.0 | MS then CU: Export as PDF pressed, the print window, a page assembles | eye level | push-in on the page foot | the trace line at the foot | 7.0 | the hand-over object; ends on what is printed on it | Export as PDF · KPI report · QA Wrap 3.9.0 · 2026-11-09 | تصدير بصيغة PDF · تقرير مؤشرات الأداء · QA Wrap 3.9.0 · 2026-11-09 | Export it as a PDF, and hand the page over. | صدرها بصيغة بي دي إف، وسلم الصفحة. | satisfied close |
| 8 | 51.0-54.0 | MS centred | eye level | hold | the lockup | 3.0 | stable end | QA Wrap · More tutorials, inside the tool | المزيد من الدروس داخل الأداة | (none) | (none) | bed only |

## Sign-off focus

No severity split and no trend verdict on screen; every label matches kpi.* exactly (minus tashkeel in AR); AR "9 من 14 صفحة" and "24 د" use Western digits; PDF in AR captions is spelled بي دي إف, in the drawn button as the product writes it (PDF).
