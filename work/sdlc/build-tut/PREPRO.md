# QA Wrap tutorials, pre-production (run qaw-1109, R2 / D1)

Six AR + EN pairs, each 40 to 60 s, 1920x1080, 30 fps, narrated, HyperFrames. The pair is the unit: one script file per film
(`videos-tut/src/<id>.json`) holds EN, AR, the Arabic TTS text and the shot list, and this document is generated from those
files by `node videos-tut/gen-prepro.mjs`, so it cannot drift from the films.

## Style (the commercial's look)
- Basalt ground (#1D2024), blurred ghost blocks drifting, one soft glow per scene (corn, coral, green), raised cards with a hairline edge,
  corn (#E2AE38) as the highlight, coral (#FF9270) for failure, limestone ink. Thmanyah only (Sans 400/700, Serif Display 700). No Cairo.
- Illustrative motion and story, never a screen recording and never a walkthrough. Each film is one story: a tester, a page, a thing
  the tool does, the proof. The tool is drawn (popup, report card), not captured.
- Web scenes are miniatures of public practice apps: Sauce Demo (Swag Labs), Practice Software Testing (Toolshop), the-internet. No lorem.
- Motion: cursor with press ripple, pill events that fly onto one timeline lane, counters that tick, a glow that follows the action, a slow push-in on every scene.
- Captions: bottom, inline-start (right in Arabic), cut from the narration lines and timed by word share, so the voice runs
  through caption changes and never stops at a caption's last word. No emoji.
- End card: QA Wrap lockup (carries the maker line) and "More tutorials, inside the tool".

## Language rules
- Visible Arabic: no tashkeel, no tatweel, no Persian letters, Arabic punctuation (، ؟ «»), Western digits, product words as the tool writes them
  (ابدأ التسجيل، الخط الزمني، ملاحظة، خلل). The brand in captions is كيو إيه راب; the tool's own drawn header stays "QA Wrap" as in the product.
  Foreign words with an Arabic meaning are glossed in Arabic (console = وحدة التحكم); PDF is spelled بي دي إف.
- TTS Arabic (`ar_tts`, films 1 to 3): full tashkeel on every word and case ending, letters unchanged, numbers spelled out where they are voiced.
  Visible text never carries the marks. `node videos-tut/gates.mjs` checks letters-unchanged and that the marks are there.
- English: plain, one idea per sentence, UI words capitalised as in the tool (Start, Stop, Timeline, Note, Bug).
- Pace: English 150 wpm (gate: at most 2.5 words/s per slot), Arabic 115 wpm (gate: at most 1.9 words/s per slot). Breath of at least 0.4 s between lines.

## Voice plan (owner exception for this job only, 2026-11-09)
Gemini Kore via OpenRouter `google/gemini-3.1-flash-tts-preview`, registered style `manual` (tutorials), direction byte-exact from
`voice-styles.json`. One request per line, one take, no verify, no re-voice, no ASR or LLM judge. Key file
`~/.config/openrouter/qa-wrap-1109.env`, loaded at runtime only. `videos-tut/voice.py` voices each line, places it at its slot and muxes
it onto the rendered master (video stream copied, not re-encoded). A line longer than its slot is sped up by at most 1.25 and otherwise left to run into the breath.

## Film 1: record-a-session (Record a session / سجل جلسة)

- Status: animatic. Length 52 s. Site props: Sauce Demo (Swag Labs inventory and cart).
- Blurb EN: Wake QA Wrap on the site you are testing, name the run, press Start, then read what it caught.
- Blurb AR: أيقظ كيو إيه راب على الموقع الذي تختبره، وأعط الجلسة اسما، واضغط ابدأ، ثم اقرأ ما التقطه.

### Script and voice lines

| Line | Slot (s) | EN (caption and voice) | AR (caption) | words EN/AR |
|---|---|---|---|---|
| L1 | 0.5-6.8 | Open the site you want to test. QA Wrap sleeps until you wake it. | افتح الموقع الذي تريد اختباره، وكيو إيه راب نائم حتى توقظه. | 14/11 |
| L2 | 7.5-13.5 | Wake it on that tab, give the run a name, and press Start. | أيقظه في هذا التبويب، وأعط الجلسة اسما، ثم اضغط «ابدأ التسجيل». | 13/11 |
| L3 | 14.2-19.8 | Then test like you always do. Click, type, scroll. | ثم اختبر كما تفعل دائما. انقر، واكتب، ومرر الصفحة. | 9/9 |
| L4 | 20.5-27.6 | Every click, request, error and screenshot drops onto one timeline. | كل نقرة وطلب وخطأ ولقطة شاشة تسقط على خط زمني واحد. | 10/11 |
| L5 | 28.3-34.6 | Everything stays on your computer. Nothing is sent anywhere. | كل شيء يبقى على جهازك، ولا يغادره أي شيء. | 9/9 |
| L6 | 35.3-40.6 | When you are done, press Stop. The session is saved. | عندما تنتهي، اضغط «أوقف». الجلسة محفوظة. | 10/6 |
| L7 | 41.3-48 | Open its Timeline, and read what happened, step by step. | افتح الخط الزمني، واقرأ ما حدث خطوة خطوة. | 10/8 |

Arabic TTS text (voice only):

- L1: افْتَحِ الْمَوْقِعَ الَّذِي تُرِيدُ اخْتِبَارَهُ، وَكِيُو إِيهْ رَاب نَائِمٌ حَتَّى تُوقِظَهُ.
- L2: أَيْقِظْهُ فِي هَذَا التَّبْوِيبِ، وَأَعْطِ الْجَلْسَةَ اسْمًا، ثُمَّ اضْغَطْ «ابْدَأِ التَّسْجِيلَ».
- L3: ثُمَّ اخْتَبِرْ كَمَا تَفْعَلُ دَائِمًا. انْقُرْ، وَاكْتُبْ، وَمَرِّرِ الصَّفْحَةَ.
- L4: كُلُّ نَقْرَةٍ وَطَلَبٍ وَخَطَأٍ وَلَقْطَةِ شَاشَةٍ تَسْقُطُ عَلَى خَطٍّ زَمَنِيٍّ وَاحِدٍ.
- L5: كُلُّ شَيْءٍ يَبْقَى عَلَى جِهَازِكَ، وَلَا يُغَادِرُهُ أَيُّ شَيْءٍ.
- L6: عِنْدَمَا تَنْتَهِي، اضْغَطْ «أَوْقِفْ». الْجَلْسَةُ مَحْفُوظَةٌ.
- L7: افْتَحِ الْخَطَّ الزَّمَنِيَّ، وَاقْرَأْ مَا حَدَثَ خُطْوَةً خُطْوَةً.

### Shot list

| Time | What happens |
|---|---|
| 0.0-7.2 | WS: a Swag Labs inventory in a browser; QA Wrap asleep in the toolbar (grey, rising z). Slow truck toward the toolbar. |
| 7.2-13.8 | CU the icon wakes (dip, amber glow), then MS the popup: a name is typed, Start recording pressed. The light turns green. |
| 14.0-20.2 | MS the shop, a live counter card docked at the side; the cursor clicks Add to cart, opens the cart, types a name, scrolls. |
| 20.2-28.0 | Pull-out to one lane under the page; each event pill flies on an arc down to it and becomes a dot. |
| 28.0-35.0 | EWS high angle: a small laptop with the lane glowing inside; a dashed arrow toward a cloud stops at a coral barrier. Title: On your computer. |
| 35.0-41.0 | MS the popup: Stop pressed, the record dot goes out, Recording saved pops with the run name and its dots. |
| 41.0-48.4 | MS then push-in on the Timeline card; an amber highlight steps down five rows. |
| 48.5-52.0 | End card, centred: the QA Wrap lockup and More tutorials, inside the tool. |

### On-screen words (EN / AR)

- QA Wrap
- What are you testing? / ما الذي تختبره؟
- Checkout flow / مسار الدفع
- Start recording / ابدأ التسجيل
- Records every tab here until you stop. / يسجل كل تبويب هنا حتى تضغط الإيقاف.
- On your computer / على جهازك
- Stop / أوقف
- Recording saved / تم حفظ التسجيل
- Timeline / الخط الزمني
- Actions, Network, Errors, Shots / الإجراءات، الشبكة، الأخطاء، اللقطات

## Film 2: trace-a-failure (Trace a failure to the click / تتبع الخطأ إلى النقرة)

- Status: animatic. Length 52 s. Site props: Practice Software Testing, Toolshop (payment step).
- Blurb EN: A request fails. QA Wrap shows the click that came right before it, with its time.
- Blurb AR: يفشل طلب، فيعرض كيو إيه راب النقرة التي سبقته مباشرة مع وقتها.

### Script and voice lines

| Line | Slot (s) | EN (caption and voice) | AR (caption) | words EN/AR |
|---|---|---|---|---|
| L1 | 0.5-6.8 | A page breaks. The console shows a red 500. But which click caused it? | تتعطل الصفحة، ويظهر خطأ أحمر رقمه 500. لكن أي نقرة سببته؟ | 14/11 |
| L2 | 7.6-14.2 | QA Wrap keeps every click, request and error on one timeline. | كيو إيه راب يحتفظ بكل نقرة وطلب وخطأ على خط زمني واحد. | 11/12 |
| L3 | 15-21.4 | When a request fails, QA Wrap links it to the click right before it. | عندما يفشل طلب، يربطه كيو إيه راب بالنقرة التي سبقته مباشرة. | 14/11 |
| L4 | 22.2-28.4 | So the click that broke the page is named, with its time. | فتعرف النقرة التي كسرت الصفحة، مع وقتها بالضبط. | 12/8 |
| L5 | 29.2-35.4 | Open the failure in the report, and the click sits right beside it. | افتح الخطأ في التقرير، وستجد النقرة بجانبه مباشرة. | 13/8 |
| L6 | 36.2-42.6 | No guessing, and no digging through the console. Just the step that broke it. | بلا تخمين، وبلا بحث في وحدة التحكم. فقط الخطوة التي سببت العطل. | 14/12 |
| L7 | 43.4-49 | Hand it over, and a developer can repeat it in seconds. | سلمه للمطور ليكرر الخطوات في ثوان. | 11/6 |

Arabic TTS text (voice only):

- L1: تَتَعَطَّلُ الصَّفْحَةُ، وَيَظْهَرُ خَطَأٌ أَحْمَرُ رَقْمُهُ خَمْسُمِائَةٍ. لَكِنْ أَيُّ نَقْرَةٍ سَبَّبَتْهُ؟
- L2: كِيُو إِيهْ رَاب يَحْتَفِظُ بِكُلِّ نَقْرَةٍ وَطَلَبٍ وَخَطَأٍ عَلَى خَطٍّ زَمَنِيٍّ وَاحِدٍ.
- L3: عِنْدَمَا يَفْشَلُ طَلَبٌ، يَرْبِطُهُ كِيُو إِيهْ رَاب بِالنَّقْرَةِ الَّتِي سَبَقَتْهُ مُبَاشَرَةً.
- L4: فَتَعْرِفُ النَّقْرَةَ الَّتِي كَسَرَتِ الصَّفْحَةَ، مَعَ وَقْتِهَا بِالضَّبْطِ.
- L5: افْتَحِ الْخَطَأَ فِي التَّقْرِيرِ، وَسَتَجِدُ النَّقْرَةَ بِجَانِبِهِ مُبَاشَرَةً.
- L6: بِلَا تَخْمِينٍ، وَبِلَا بَحْثٍ فِي وَحْدَةِ التَّحَكُّمِ. فَقَطِ الْخُطْوَةُ الَّتِي سَبَّبَتِ الْعُطْلَ.
- L7: سَلِّمْهُ لِلْمُطَوِّرِ لِيُكَرِّرَ الْخُطُوَاتِ فِي ثَوَانٍ.

### Shot list

| Time | What happens |
|---|---|
| 0.0-7.2 | WS high angle: a Toolshop payment page; three quick clicks, Confirm, the page breaks and the console shows a red 500; three numbered click rings rise under a big question mark; push-in on the rings. |
| 7.2-14.6 | EWS: one timeline draws across the frame (linear); seven dots land; the coral 500 dot carries its pill. The light turns green. |
| 14.6-21.8 | MS push-in on the last click and the 500; the rest dims; an amber thread draws back from the failure to the click before it, on an arc. likely cause. |
| 21.8-28.8 | CU low angle: the click becomes a card (You did · Confirm · 00:41). |
| 28.8-35.8 | MS the report Timeline: context rows dim, the failed row glows coral, an amber link joins it to the Confirm click with likely cause. |
| 35.8-43.0 | MS: two big cards, You did Confirm 00:41, an arrow, Then POST /payment/check 500, over a blurred console. |
| 43.0-49.6 | WS: the pair slides to a developer card (truck to the inline end); Watch the replay pressed; a green check. |
| 49.8-52.0 | End card, centred. |

### On-screen words (EN / AR)

- Console / وحدة التحكم
- Something went wrong (site)
- POST /payment/check 500
- 00:38 · 00:41
- likely cause / سبب مرجح
- You did / ما فعلته
- Then / ثم
- Timeline / الخط الزمني
- Actions, Network / الإجراءات، الشبكة
- Watch the replay / شاهد إعادة التشغيل

## Film 3: notes-and-bugs (Notes and bugs / الملاحظات والأخطاء)

- Status: animatic. Length 52 s. Site props: Practice Software Testing, Toolshop (contact form).
- Blurb EN: Write a note while you test, mark it as a bug, attach a screenshot, and find it again on the timeline.
- Blurb AR: دون ملاحظة أثناء الاختبار، وسجلها كخلل، وأرفق لقطة شاشة، ثم اعثر عليها على الخط الزمني.

### Script and voice lines

| Line | Slot (s) | EN (caption and voice) | AR (caption) | words EN/AR |
|---|---|---|---|---|
| L1 | 0.5-6.6 | While you test, you spot things worth writing down. | أثناء الاختبار، تلاحظ أشياء تستحق التدوين. | 9/6 |
| L2 | 7.4-13.4 | Type a short note, like: Send stays disabled. | اكتب ملاحظة قصيرة، مثلا: زر الإرسال يبقى معطلا. | 8/8 |
| L3 | 14-20.6 | Pick Note for something you saw, or Bug when something is wrong. | اختر «ملاحظة» لما رأيته، أو «خلل» عندما يكون هناك خطأ. | 12/10 |
| L4 | 21.2-27.4 | Add a screenshot, and it is attached to that note. | أضف لقطة شاشة، فتلتصق بتلك الملاحظة. | 10/6 |
| L5 | 28.2-35.4 | Each note lands on the timeline, at the moment you made it. | تقع كل ملاحظة على الخط الزمني، في اللحظة التي كتبتها فيها. | 12/11 |
| L6 | 36.2-42.6 | Later, filter to the bugs, and your list for the report is ready. | لاحقا، اعرض الخلل فقط، وتصبح قائمة التقرير جاهزة. | 13/8 |
| L7 | 43.6-49 | Only what you file as a bug counts toward your numbers. | وما تسجله كخلل فقط هو ما يدخل في أرقامك. | 11/9 |

Arabic TTS text (voice only):

- L1: أَثْنَاءَ الِاخْتِبَارِ، تُلَاحِظُ أَشْيَاءَ تَسْتَحِقُّ التَّدْوِينَ.
- L2: اكْتُبْ مُلَاحَظَةً قَصِيرَةً، مَثَلًا: زِرُّ الْإِرْسَالِ يَبْقَى مُعَطَّلًا.
- L3: اخْتَرْ «مُلَاحَظَةً» لِمَا رَأَيْتَهُ، أَوْ «خَلَلٌ» عِنْدَمَا يَكُونُ هُنَاكَ خَطَأٌ.
- L4: أَضِفْ لَقْطَةَ شَاشَةٍ، فَتَلْتَصِقُ بِتِلْكَ الْمُلَاحَظَةِ.
- L5: تَقَعُ كُلُّ مُلَاحَظَةٍ عَلَى الْخَطِّ الزَّمَنِيِّ، فِي اللَّحْظَةِ الَّتِي كَتَبْتَهَا فِيهَا.
- L6: لَاحِقًا، اعْرِضِ الْخَلَلَ فَقَطْ، وَتُصْبِحُ قَائِمَةُ التَّقْرِيرِ جَاهِزَةً.
- L7: وَمَا تُسَجِّلُهُ كَخَلَلٍ فَقَطْ هُوَ مَا يَدْخُلُ فِي أَرْقَامِكَ.

### Shot list

| Time | What happens |
|---|---|
| 0.0-7.2 | MS: a Toolshop contact form, Send greyed out; the cursor presses Send twice, nothing; an amber thought bubble pops beside it. |
| 7.2-13.8 | MS split: the page slides to the inline start, the tool note card arrives at the inline end; the placeholder, then the note is typed. |
| 13.8-21.0 | CU the type menu: Note highlighted, then Bug pressed; the tag turns coral. |
| 21.0-27.8 | MS the note card: Screenshot, note pressed, a flash, a thumbnail drops under the note and clips on; Add note pressed. The light turns green. |
| 27.8-35.9 | WS pull-out to a timeline with six dots; the note flies down on an arc and rises as a coral flag at 00:27. |
| 36.0-43.0 | MS the Timeline tab: Bugs pressed; notes and clicks fade, three bug rows slide up. |
| 43.4-49.6 | CU low angle: a counter; three bug pills drop in and it counts 1, 2, 3; two note pills drift past and fade. Title: Only bugs count. |
| 49.8-52.0 | End card, centred. |

### On-screen words (EN / AR)

- Contact · Send (site)
- Name it, e.g. Submit stays disabled / سمها، مثلا: زر الإرسال يبقى معطلا
- Send stays disabled / زر الإرسال يبقى معطلا
- Note / ملاحظة
- Bug / خلل
- Screenshot, note / لقطة مع ملاحظة
- Add note / أضف ملاحظة
- Timeline / الخط الزمني
- All / الكل
- Bugs / الخلل
- Only bugs count / الخلل وحده في العدد

## Film 4: export-and-seal (Export and seal / التصدير والختم)

- Status: prepro (scripted provisional; UI strings freeze after the R3/R5 lanes, Lead sends AMEND). Length 55 s. Site props: Sauce Demo (the session being exported), no new site.
- Blurb EN: Export the whole timeline as a Markdown file with your profile in it, sealed so any hand edit is detected, then check it with Verify file.
- Blurb AR: صدر الخط الزمني كاملا في ملف نصي ومعه ملفك الشخصي، مختوما ليكشف أي تعديل يدوي، ثم افحصه بزر فحص الملف.

### Script and voice lines

| Line | Slot (s) | EN (caption and voice) | AR (caption) | words EN/AR |
|---|---|---|---|---|
| L1 | 0.8-6.8 | When the session is done, export it from the Timeline tab. | عندما تنتهي الجلسة، صدرها من تبويب الخط الزمني. | 11/8 |
| L2 | 7.4-14 | Both download options now include the whole timeline as a text file. | يتضمن خيارا التنزيل الآن الخط الزمني كاملا في ملف نصي. | 12/10 |
| L3 | 14.6-20.4 | Your name from your profile is written into it. | ويكتب فيه اسمك من ملفك الشخصي. | 9/6 |
| L4 | 21-28.6 | At the end sits a seal: your name, the date, a fingerprint of the content, and a signature. | وفي آخره ختم: اسمك، والتاريخ، وبصمة المحتوى، وتوقيع. | 18/8 |
| L5 | 29.2-36 | The text stays readable. But change one word by hand, and the seal no longer matches. | يبقى النص مقروءا. لكن غير كلمة واحدة بيدك، ولن يطابق الختم. | 16/11 |
| L6 | 36.6-44 | Press Verify file, and QA Wrap says intact or altered, and whose file it is. | اضغط «فحص الملف»، فيقول كيو إيه راب سليم أو معدل، ولمن الملف. | 15/12 |
| L7 | 44.6-52 | It shows that a file was changed. It does not hide anything. That is proof, not secrecy. | يكشف أن الملف تغير، ولا يخفي شيئا. هذا دليل وليس سرية. | 17/11 |

### Shot list

| Time | What happens |
|---|---|
| 0-7 | The saved session card from film 1 sits on the ground; its Timeline tab opens and an Export button on the tab bar glows. |
| 7-14 | The two download options drawn as two paper-cut cards, each now holding a small .md document that slides in beside its usual files. |
| 14-21 | The document unfolds; the first lines type themselves: the session title, then the profile name (the name from film 5) in a corn header band. |
| 21-29 | The document scrolls to its end; a seal block stamps down: name, date, version, a hash string (shown abstract), a signature line, a small key glyph. |
| 29-36 | A pencil edits one word in the body; the seal block's check mark flips to a coral cross; the hash string visibly changes colour. |
| 36-44 | Cursor presses Verify file on the popup; two result cards: a green Intact with the owner's name and key fingerprint; a coral Altered with a diff dot on the changed line. |
| 44-52 | A plain, honest close: an open document under glass (readable, nothing hidden) with a seal; words: Proof, not secrecy. Then the end card. |

### On-screen words (EN / AR)

- Export / تصدير
- Timeline (.md) / الخط الزمني (.md)
- Seal / الختم
- Verify file / فحص الملف
- Intact / سليم
- Altered / معدل
- Proof, not secrecy / دليل وليس سرية

## Film 5: profile-and-fine-print (Your profile and the fine print / ملفك الشخصي والسطر التعريفي)

- Status: prepro (scripted provisional; UI strings freeze after the R3 lane, Lead sends AMEND). Length 48 s. Site props: none (tool UI and exported documents only).
- Blurb EN: Set your name and an optional picture once. Every export carries a fine-print line with your name, the date and the tool version.
- Blurb AR: اضبط اسمك وصورة اختيارية مرة واحدة. يحمل كل تصدير سطرا تعريفيا فيه اسمك والتاريخ ونسخة الأداة.

### Script and voice lines

| Line | Slot (s) | EN (caption and voice) | AR (caption) | words EN/AR |
|---|---|---|---|---|
| L1 | 0.8-6.4 | Work should be traceable to whoever did it. | يجب أن يتتبع العمل إلى صاحبه. | 8/6 |
| L2 | 7-13.2 | Open your profile in Settings, and type your name. | افتح ملفك الشخصي من الإعدادات، واكتب اسمك. | 9/7 |
| L3 | 13.8-19.4 | A picture is optional. It stays on your computer. | الصورة اختيارية، وتبقى على جهازك. | 9/5 |
| L4 | 20-27.2 | From then on, every export carries a fine-print line at the bottom. | ومن ثم يحمل كل تصدير سطرا تعريفيا في أسفله. | 12/9 |
| L5 | 27.8-35.2 | It names you, the date, and the version of QA Wrap that made the file. | يذكر اسمك والتاريخ ونسخة كيو إيه راب التي صنعت الملف. | 15/10 |
| L6 | 35.8-42.4 | So a report always points back to its author. | فيشير أي تقرير دائما إلى كاتبه. | 9/6 |

### Shot list

| Time | What happens |
|---|---|
| 0-6.4 | A stack of unsigned report pages drifts; one page lights a question mark where a name should be. |
| 7-13.2 | The Settings card opens on Profile; a name is typed into the Name field; the avatar circle updates with initials. |
| 13.8-19.4 | A picture slides into the avatar circle from a file tile; a small lock-and-laptop glyph shows it staying local. |
| 20-27.2 | Three different exports (a PDF page, a Markdown file, a bug report) fly in; each gets a thin fine-print line at its foot. |
| 27.8-35.2 | Zoom on one line: name, date, QA Wrap version, each part lit in turn. |
| 35.8-42.4 | The three documents connect to one avatar by corn threads. End card. |

### On-screen words (EN / AR)

- Profile / الملف الشخصي
- Name / الاسم
- Picture (optional) / صورة (اختيارية)
- Fine print: name, date, version / السطر التعريفي: الاسم، التاريخ، النسخة

## Film 6: kpi-dashboard (Your performance dashboard / لوحة مؤشرات أدائك)

- Status: prepro (scripted provisional; UI strings freeze after the R4 lane, Lead sends AMEND). Length 56 s. Site props: Sauce Demo, the-internet and Practice Software Testing as three site tiles on the charts.
- Blurb EN: A personal dashboard built from your own sessions: time spent testing, coverage of pages, bugs per day, and a PDF to hand over.
- Blurb AR: لوحة شخصية من جلساتك أنت: وقت الاختبار، وتغطية الصفحات، والأخطاء في كل يوم، وملف بي دي إف للتسليم.

### Script and voice lines

| Line | Slot (s) | EN (caption and voice) | AR (caption) | words EN/AR |
|---|---|---|---|---|
| L1 | 0.8-6.8 | Every session you record feeds a dashboard that belongs to you. | كل جلسة تسجلها تغذي لوحة تخصك وحدك. | 11/7 |
| L2 | 7.4-14.4 | See how long you test, each day and each week, and on which sites. | اعرف كم تختبر كل يوم وكل أسبوع، وعلى أي مواقع. | 14/10 |
| L3 | 15-22 | Coverage compares the pages you tested with the pages you found but have not touched. | تقارن التغطية بين الصفحات التي اختبرتها والتي وجدتها ولم تلمسها بعد. | 15/11 |
| L4 | 22.6-29.6 | Bugs per day count only the notes you filed as bugs, never console errors. | تحسب الأخطاء في كل يوم ملاحظاتك المسجلة كخلل فقط، لا أخطاء وحدة التحكم. | 14/13 |
| L5 | 30.2-37.4 | Bugs by severity, sessions per day and average session length sit beside them. | وبجانبها الأخطاء بحسب الخطورة، والجلسات في كل يوم، ومتوسط طول الجلسة. | 13/11 |
| L6 | 38-45 | Trend lines show whether this week is better than last. | وخطوط الاتجاه تبين هل هذا الأسبوع أفضل من الذي قبله. | 10/10 |
| L7 | 45.6-53 | Export the dashboard as a PDF. It carries your name, the date and the version. | صدر اللوحة بصيغة بي دي إف. تحمل اسمك والتاريخ والنسخة. | 15/10 |

### Shot list

| Time | What happens |
|---|---|
| 0-7 | Session cards from films 1 to 3 stack up and pour into an empty dashboard frame, which lights up. |
| 7-14.4 | A bar chart of hours per day builds bar by bar; a week toggle swaps it for weekly columns; three site tiles (Swag Labs, The Internet, Toolshop) split the stack colours. |
| 15-22 | A site map of squares: tested squares fill corn, undiscovered stay hollow; a ring gauge counts the share. |
| 22.6-29.6 | A line chart of bugs per day; only coral bug flag points count; console and request markers drift past, greyed and ignored. |
| 30.2-37.4 | Three small tiles slide in: severity bars, sessions per day dots, average session length as a clock arc. |
| 38-45 | Trend lines draw across with a small week-over-week arrow. |
| 45.6-53 | A PDF page assembles from the dashboard; fine print line at its foot with name, date, version. End card. |

### On-screen words (EN / AR)

- Time spent testing / وقت الاختبار
- Coverage / التغطية
- Bugs per day / الأخطاء في كل يوم
- Severity / الخطورة
- Sessions per day / الجلسات في كل يوم
- Export PDF / تصدير بي دي إف

## Build status
Films 1 to 3 are built and rendered (EN and AR). Films 4 to 6 are scripted and shot-listed; their on-screen strings are provisional and
are frozen by the Lead's AMEND after the profile, KPI and seal lanes land their UI strings.
