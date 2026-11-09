# Treatment: Tutorial 3, notes-and-bugs (Notes and bugs / الملاحظات والأخطاء)

52 s, 16:9, EN + AR pair. Draft: `QA-Wrap-wt-tut/videos-tut/notes-and-bugs-{en,ar}` (29ba208). Grammar: `commercial-bible.md` §9. UI words from i18n: Add note = popup.note.add أضف ملاحظة; Screenshot, note = popup.note.shot لقطة مع ملاحظة; Bugs = popup.breakdown.bugs الخلل; note placeholder = popup.note.placeholder (EN "Name it, e.g. Submit stays disabled"; AR carries tashkeel in the product, drawn here without it).

## Intent

While testing, the tester can catch a thought in five words, say whether it is a note or a bug, pin a screenshot to it, and later find only the bugs, already in order, ready for her report and her numbers.

## Arc

Something is off (0-7, warm) · write it down (7-14) · note or bug (14-21) · attach proof (21-28, light turns green when the screenshot attaches) · it lands at its moment on the timeline (28-36) · filter to bugs (36-43) · only bugs count (43-49.6) · end card.

## Director's changes from the draft

1. Product term clash, for the Lead: the overlay tag says عيب (overlay.note.tag.bug) while the panel and popup say خلل. The film uses خلل; the product should use one word.
2. Shot 5 goes to a pull-out wide to place the note in time (the draft held the same size as shot 4).
3. Shot 7 drops the "bars grow" decoration; one lead move: the counter counts.

## Shots

| # | Time | Size | Angle | Move | Focal | Dur (s) | Why | On-screen EN | On-screen AR | Narration EN | Narration AR (caption) | Voice direction |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.0-7.2 | MS: Toolshop contact form, Send greyed out | eye level | hold; the cursor presses Send twice, nothing; an amber thought bubble pops beside it | the dead Send button, then the bubble | 7.2 | the thing worth writing down must happen before we write it | Contact · Send | (the site stays English) | While you test, you spot things worth writing down. | أثناء الاختبار، تلاحظ أشياء تستحق التدوين. | observant, light |
| 2 | 7.2-13.8 | MS split: browser slides to the inline start, the tool's note card arrives at the inline end | eye level | truck (the page makes room; cut on action as the card enters) | the typing caret | 6.6 | the note sits beside the page it is about (labels next to the thing) | Name it, e.g. Submit stays disabled · Submit stays disabled | سمها، مثلا: زر الإرسال يبقى معطلا · زر الإرسال يبقى معطلا | Type a short note, like: Submit stays disabled. | اكتب ملاحظة قصيرة، مثلا: زر الإرسال يبقى معطلا. | quote the note in a slightly different colour of voice |
| 3 | 13.8-21.0 | CU of the type menu | eye level | hold; Note highlighted, then Bug pressed; the tag turns coral | the coral Bug tag | 7.2 | a choice needs a close size; coral is the colour of "wrong" | Note · Bug | ملاحظة · خلل | Pick Note for something you saw, or Bug when something is wrong. | اختر «ملاحظة» لما رأيته، أو «خلل» عندما يكون هناك خطأ. | contrast the two words |
| 4 | 21.0-27.8 | MS note card | eye level | hold; Screenshot, note pressed, a flash, a thumbnail drops under the note and clips on (follow-through), Add note pressed | the attached thumbnail | 6.8 | proof joins the claim; the clip-on settle gives it weight | Screenshot, note · Add note | لقطة مع ملاحظة · أضف ملاحظة | Add a screenshot, and it is attached to that note. | أضف لقطة شاشة، فتلتصق بتلك الملاحظة. | pleased, small click in the voice |
| 5 | 27.8-35.9 | WS pulling out to a timeline with six dots | eye level | pull-out; a coral flag rises from the lane at 00:27 | the flag | 8.1 | placing in time needs the wide view | 00:27 · Bug | 00:27 · خلل | Each note lands on the timeline, at the moment you made it. | تقع كل ملاحظة على الخط الزمني، في اللحظة التي كتبتها فيها. | measured |
| 6 | 36.0-43.0 | MS of the Timeline tab | eye level | hold; Bugs filter pressed; notes and clicks fade, three bug rows slide up | the three remaining rows | 7.0 | the reveal is subtraction: everything else leaves | Timeline · All · Bugs | الخط الزمني · الكل · الخلل | Later, filter to the bugs, and your list for the report is ready. | لاحقا، اعرض الخلل فقط، وتصبح قائمة التقرير جاهزة. | brisk |
| 7 | 43.4-49.6 | CU of a counter card | low angle (the counter towers slightly) | hold; three bug pills drop in and the number counts 1, 2, 3; two note pills drift past and fade | the number | 6.2 | the rule this film teaches, and the link to the KPI dashboard (tutorial 6) | Only bugs count | الخلل وحده يحسب | Only what you file as a bug counts toward your numbers. | وما تسجله كخلل فقط هو ما يدخل في أرقامك. | plain rule, slight emphasis on فقط |
| 8 | 49.8-52.0 | MS centred | eye level | hold | the lockup | 2.2 | stable end | QA Wrap · More tutorials, inside the tool | المزيد من الدروس داخل الأداة | (none) | (none) | bed only |

## Sign-off focus

Shot 2 split layout mirrors in AR (the page at the inline start, right; the note card at the left); "Only bugs count" is the only title in the film; the AR placeholder line shows no shadda or tanween.
