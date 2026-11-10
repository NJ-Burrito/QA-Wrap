# QA Wrap brand films: six scripts and shot tables (worker BW, 2026-11-10)

Six brand films about the whole extension. They are showcases, not tutorials: no step-by-step, no walkthrough voice. Every film uses the 40 s commercial's grammar in full (`commercial-bible.md` §1-§5 and §9): one continuous stage with no cuts, basalt ground with drifting ghost blocks and bokeh, raised cards, chips, pills and amber buttons; coral = failure, amber = the user's action, green = proof; stamps slam (power4.in), arrivals overshoot (back.out), time draws linearly; one lead move per beat; beat titles in Serif Display caps with one coloured word; captions bottom inline-start, cut from the voice; voice-led; bed plus SFX on the hits; end card with the QA Wrap lockup. The tool, its popup, its report and the websites are drawn as cards and miniatures (Sauce Demo / Practice Software Testing / the-internet look, no copied logos, never lorem). The tester is Layla Haddad / ليلى حداد, seen only as a cursor with a press ripple and her name on exports (bible §9.8).

Each film has two versions identical except direction, caption language and narration language: **EN** (LTR) and **AR** (RTL, layout mirrored, time and travel right to left; Latin UI words keep their order). Machine twin for the builder: `work/film/brand/films.json`. Narration manifest: `work/film/brand/narration-manifest.json`. Source and gates: `work/film/brand/bw/films_src.py`, `work/film/brand/bw/build.py` (every number in the tables below is computed by that script, not typed).

On-screen words are the tool's real UI strings in `extension/platform/i18n/{en,ar}.json` (and `extension/game/strings/` for Bug Hunt) wherever the tool is shown. Product facts are from `README.md`, `extension/README.md`, `extension/CHANGELOG.md` (to 3.9.1), `extension/ROADMAP.md` and `helper/README.md`.

## The six films

| # | Slug | Title EN / AR | Duration | Promise |
|---|---|---|---|---|
| 1 | `every-moment` | Every Moment, Kept / <span dir="rtl">كل لحظة محفوظة</span> | 42.0 s | One recording keeps every click, request and page change, and points the one real failure at the step behind it. |
| 2 | `one-report` | One Report, Every Desk / <span dir="rtl">تقرير واحد لكل مكتب</span> | 42.0 s | The session writes the bug report, in the shape your team reads, and sends it where they work. |
| 3 | `show-it` | Show It, Don't Describe It / <span dir="rtl">أره ولا تصفه</span> | 40.0 s | Every bug arrives with its picture, its clip and the marks that point at it. |
| 4 | `the-toolbox` | The Whole Toolbox / <span dir="rtl">عدة الاختبار كاملة</span> | 43.0 s | The checks a page needs, in one popup, while you test it. |
| 5 | `yours-sealed` | Yours, and Sealed / <span dir="rtl">عملك، مختوم</span> | 47.0 s | Your evidence stays on your machine, carries your name, and shows when anyone has changed it. |
| 6 | `your-way` | Your Language, Your Numbers, Your Agent / <span dir="rtl">بلغتك، وبأرقامك، ومع وكيلك</span> | 40.0 s | QA Wrap fits the way you work: in Arabic or English, with your own numbers, beside your coding agent, learned by playing. |

## Coverage matrix (exactly one owner film per feature)

`●` = the owner film (the feature is shown and spoken there). No feature is shown as a subject in a second film. "Added" = not in the director's list, found in the product and placed. Source = where the feature is verified.

| Feature | 1 every-moment | 2 one-report | 3 show-it | 4 the-toolbox | 5 yours-sealed | 6 your-way | Source |
|---|---|---|---|---|---|---|---|
| Session recording (Wake up, Start recording, every tab of the window) | ● | | | | | | README "Records a session"; ext README feature 1, 19 |
| Failure-to-click tracing | ● | | | | | | README "Links each failure to its cause"; report.overview.traced* |
| Network filter | ● | | | | | | CHANGELOG 3.9.1 "Network filter" |
| Replay | ● | | | | | | ROADMAP "Session replay: shipped"; replay.* strings |
| Bug-first report (Copy report, What broke) | | ● | | | | | README "Writes the report"; ext README feature 16 |
| ISTQB / ISO/IEC/IEEE 29119-3 test case and defect report | | ● | | | | | ext README feature 25; report.istqb.* |
| Filing: Jira, seven other trackers, chat and webhooks | | ● | | | | | ROADMAP "Hand-over"; ext README features 12, 26, 27 |
| Screenshots | | | ● | | | | ext README feature 17; tools.shot.label |
| Annotate (Arrow, Step, Text, Redact) | | | ● | | | | ext README feature 21; annotate.tools.* |
| Screen recording (no time limit, mic, MP4 / WebM / GIF) | | | ● | | | | ext README features 17, 22 |
| Save last 1 minute (added) | | | ● | | | | CHANGELOG 3.6.0, 3.8.0 |
| Accessibility check (Show me) | | | | ● | | | ext README feature 15; tools.a11y.label |
| Page speed (LCP, CLS) | | | | ● | | | ext README feature 11 |
| Passive checks: dead button, cut-off text (added) | | | | ● | | | CHANGELOG 3.5.2, 3.5.3 |
| QA tools set (Copy a locator, Try nasty values, Design the values, Stress the layout, Break a request, Check another size) | | | | ● | | | tools.*.label; ext README features 3-6, 14 |
| Master switch: Asleep until woken, per window (added) | | | | | ● | | ext README feature 19 |
| Masking and local-first privacy (Mask real data, Nothing leaves this browser) | | | | | ● | | README Privacy; tools.mask.label; popup.foot.noSpill |
| Profile (name EN / AR, picture, trace line on exports) | | | | | ● | | CHANGELOG 3.9.0, 3.9.1; core/profile.js traceLine |
| Seal + verify (tamper evidence; hides nothing, proves no identity) | | | | | ● | | CHANGELOG 3.9.0; verify.* strings |
| Arabic and English, right to left | | | | | | ● | ext README feature 24 |
| KPI dashboard (no severity split, no trend verdict) | | | | | | ● | CHANGELOG 3.9.0; kpi.* strings |
| MCP agent bridge `qa-wrap-bridge` (read only) | | | | | | ● | helper/README.md; bridge.* strings |
| Practice game Bug Hunt (5 levels) | | | | | | ● | CHANGELOG 3.5.0, 3.5.3; game/strings |

Background, not a subject (drawn but never spoken about, so no overlap): the popup and its Start recording button appear in films 4 and 5 as furniture; film 5 shows File to Jira once as the one door out (privacy, not filing); film 6 b2 shows Start recording only as a label that mirrors.

Left out on purpose: **one-press update** (the commercial owns it, s11); **reporter mode** ("Report a problem"), **cookie editor**, **code coverage**, **Postman export**, **Draw the flow**, **Reverse-engineer the spec**, **Check the links**, **Fill the form**, **Map the page**: real, but each film already carries one promise; Design the values and Check another size appear as rows in film 4 b2 only. Nothing in the director's list was dropped: every listed feature is in the product (verified above).

Commercial story: no film re-tells "closed as cannot reproduce, traced, filed". Film 1 b4 is the single echo (the click-to-500 arc, one beat). Film 2's FILED stamp ends a different story (a blank report written by the session).


## Film 1. Every Moment, Kept / <span dir="rtl">كل لحظة محفوظة</span> (`every-moment`)

- **Duration:** 42.0 s (16:9, 30 fps; a 9:16 re-layout shares every time). **Beats:** 8. **The light turns green at 10.4 s.**
- **Promise:** One recording keeps every click, request and page change, and points the one real failure at the step behind it.
- **Feeling at the start:** Overwhelmed: forty red lines and no idea which one is the bug.
- **Feeling at the end:** Calm certainty: one failure, its cause, and the page exactly as it was.
- **Arc:** Problem (coral, 0-9.4): a flood of red requests beside a shop page. Turn at 10.4 s: the network filter folds the noise and the light goes green. Proof (14.5-31.5): the one real failure is traced to its click, replayed, and nothing was deleted. Payoff (31.5-36.5): the same column, now one traced row. End card 36.5-42.0.
- **Bookend: frame 0 is the shop miniature with a column of 40 coral request rows beside it; the payoff (34.0) is the same miniature and the same column, now one bar "39 background calls hidden" and one green-ringed traced row.**
- **First frame:** Poster frame: a Swag Labs style shop miniature (Sauce Labs Backpack, Add to cart) frame left third; beside it 40 coral request rows cascade top to bottom (back.out 1.6, stagger 0.05 s), each a real-looking line: GET /collect 404, GET /favicon.ico 404, GET /ads/tag.js (blocked), POST /api/checkout 500. **Last frame:** the QA Wrap lockup held centred with Download free (end card).

### Shots

| # | In-out s (key) | Size / angle / move | Focal point | What happens | On-screen EN | On-screen AR | Beat title EN / AR | Out |
|---|---|---|---|---|---|---|---|---|
| b1 | 0.0-4.8 (1.5) | EWS, high angle (the tester small against the flood), hold | the column of coral rows | Poster frame: a Swag Labs style shop miniature (Sauce Labs Backpack, Add to cart) frame left third; beside it 40 coral request rows cascade top to bottom (back.out 1.6, stagger 0.05 s), each a real-looking line: GET /collect 404, GET /favicon.ico 404, GET /ads/tag.js (blocked), POST /api/checkout 500. Warm coral glow behind the column. | GET /collect 404 · GET /favicon.ico 404 · POST /api/checkout 500 | <span dir="rtl">(site and request text stay Latin) GET /collect 404 · POST /api/checkout 500</span> | WHICH **ONE**? / <span dir="rtl">**أيها** خللك؟</span> (coral) | the rows freeze as the cursor enters |
| b2 | 4.8-9.2 (7.0) | MS on the popup card beside the miniature, eye level | the amber Start recording button | The QA Wrap popup card rises (back.out 1.4). Pill Asleep flips to Awake (anticipation: a 0.2 s dim). Cursor presses Start recording (amber, 8 px under-edge compresses, ripple). Lead move: a thin thread draws linearly under the miniature and catches the cursor's actions as amber dots (Clicked "Add to cart" (button), Clicked "Checkout" (button)) and requests as white dots. | Awake · Start recording · Clicked "Add to cart" (button) | <span dir="rtl">مشغل · ابدأ التسجيل · نقر على «Add to cart» (زر)</span> | (none) | the popup slides away; the thread stays |
| b3 | 9.2-14.5 (12.2) | WS (the whole thread and the red column), eye level | the folded bar | Silence 9.0-9.5: everything holds. At 10.4 the green glow rises frame right (the turn). Lead move: the 40 coral rows slide into the thread and 39 of them fold, like a fan closing (power2.inOut 0.9 s), into one grey bar; one coral row stays. Secondary: pills Strict · Balanced · Everything arrive under the bar, Balanced lit. | 39 background calls hidden · Show · Strict · Balanced · Everything | <span dir="rtl">39 طلبات خلفية مخفية · إظهار · صارمة · متوازنة · كل شيء</span> | NOISE, **FOLDED** / <span dir="rtl">الضجيج **مطوي**</span> (green) | push-in toward the coral row |
| b4 | 14.5-20.0 (17.6) | MS, push-in by scale 1.4x on two points of the thread | the arc from the click to the 500 | The commercial's one echo, told in one beat: the amber dot Clicked "Finish" (button) and the 500 box grow (back.out 2); an arc draws between them (power2.inOut 0.6 s, left to right). Pill high confidence pops (back.out 2) after the arc lands. | Clicked "Finish" (button) · POST /api/checkout 500 · high confidence | <span dir="rtl">نقر على «Finish» (زر) · POST /api/checkout 500 · ثقة عالية</span> | **TRACED** / <span dir="rtl">**تم تتبعه**</span> (green) | the 500 box flips into a page frame |
| b5 | 20.0-26.5 (23.6) | MS on a Replay card, eye level, hold | the scrub head meeting the red mark | The 500 box flips (power2.inOut 0.5 s) into the Replay card: a drawn copy of the checkout page (Checkout: Overview, Finish). Lead move: the scrub head draws linearly along the bar; the page miniature changes in step (cart, form, overview); a red mark waits on the bar at 00:41; the head reaches it and the page freezes on the Finish press. | Replay · The page as it was · 00:41 of 01:12 · 1 red mark: the moment something failed. | <span dir="rtl">إعادة التشغيل · الصفحة كما كانت · 00:41 من 01:12 · 1 علامة حمراء: اللحظة التي فشل فيها شيء.</span> | (none) | pull-out back to the thread |
| b6 | 26.5-31.5 (29.6) | WS, eye level, hold | the unfolding rows | The grey bar is pressed (Show): the 39 rows unfold dim, untouched, and fold again. Lead move: a Save sheet card slides up and every row drops into it (a stream of small dots, sine.inOut). | Show · Hide · Save | <span dir="rtl">إظهار · إخفاء · احفظ</span> | NOTHING **DELETED** / <span dir="rtl">لا شيء **محذوف**</span> (green) | the sheet closes into a session card |
| b7 | 31.5-36.5 (34.0) | MS of the shop miniature and its column (rhymes with frame 0) | the one traced row, ringed green | Bookend: the frame of b1 again, now calm: the miniature, the folded bar, one row with its arc to Clicked "Finish" (button). The overview pill lands (back.out 1.6). | 1 problem found · 1 traced to the step that caused it | <span dir="rtl">مشكلة واحدة · 1 منها متتبعة إلى الخطوة التي سببتها</span> | (none) | all objects drain to centre |
| b8 | 36.5-42.0 (39.0) | MS centred, eye level, hold (the stable end) | the green Download free button | Everything on stage drains to the centre and becomes the QA Wrap mark (graphic match); the mark draws its check (power2.out 0.6 s), the lockup settles (back.out 1.4), maker line, the Free · MIT · English and Arabic pills arrive (back.out 2, staggered 0.08 s), Download free pops last. Ghosts and bokeh keep drifting. | QA Wrap · Made by Nader Alzghoul (NJ-Burrito) · Free · MIT · English and Arabic · Download free | <span dir="rtl">QA Wrap · من صنع نادر الزغول (NJ-Burrito) · مجاني · MIT · عربي وإنجليزي · احصل عليه مجانا</span> | (none) | end (last frame = the lockup, held) |

### Captions

| # | Window s | EN caption | AR caption (unvowelled) | EN w | AR w |
|---|---|---|---|---|---|
| 1 | 0.40-2.00 | Forty red requests. | <span dir="rtl">أربعون طلبا أحمر.</span> | 3 | 3 |
| 2 | 2.00-4.60 | Which one is your bug? | <span dir="rtl">أيها خللك أنت؟</span> | 5 | 3 |
| 3 | 5.00-7.00 | Wake it up, start recording, | <span dir="rtl">شغله، ابدأ التسجيل،</span> | 5 | 3 |
| 4 | 7.00-8.90 | test as usual. | <span dir="rtl">واختبر كعادتك.</span> | 3 | 2 |
| 5 | 9.70-11.60 | The network filter folds | <span dir="rtl">تصفية الشبكة تطوي</span> | 4 | 3 |
| 6 | 11.60-14.30 | the background noise into one line. | <span dir="rtl">ضجيج الخلفية في سطر واحد.</span> | 6 | 5 |
| 7 | 14.80-17.20 | What is left points straight | <span dir="rtl">وما يبقى يشير مباشرة</span> | 5 | 4 |
| 8 | 17.20-19.80 | at the click that caused it. | <span dir="rtl">إلى النقرة التي سببته.</span> | 6 | 4 |
| 9 | 20.30-21.80 | Watch the replay: | <span dir="rtl">شاهد إعادة التشغيل:</span> | 3 | 3 |
| 10 | 21.80-23.80 | the page as it was, | <span dir="rtl">الصفحة كما كانت،</span> | 5 | 3 |
| 11 | 23.80-26.30 | up to the red mark. | <span dir="rtl">حتى العلامة الحمراء.</span> | 5 | 3 |
| 12 | 26.80-28.60 | Nothing is deleted. | <span dir="rtl">لا يحذف شيء.</span> | 3 | 3 |
| 13 | 28.60-31.30 | Every export keeps every request. | <span dir="rtl">كل تصدير يحتفظ بكل طلب.</span> | 5 | 5 |
| 14 | 31.80-34.00 | One session. Every moment kept, | <span dir="rtl">جلسة واحدة. كل لحظة محفوظة،</span> | 5 | 5 |
| 15 | 34.00-36.30 | and the cause already found. | <span dir="rtl">والسبب معروف سلفا.</span> | 5 | 3 |
| 16 | 37.10-38.80 | QA Wrap. | <span dir="rtl">QA Wrap،</span> | 2 | 2 |
| 17 | 38.80-40.60 | Free and open source. | <span dir="rtl">مجاني ومفتوح المصدر.</span> | 4 | 3 |

### Voice lines

| V# | Start s | Captions | EN voice | AR voice (unvowelled) | AR TTS text (full tashkeel) |
|---|---|---|---|---|---|
| V1 | 0.30 | 1, 2 | Forty red requests. Which one is your bug? | <span dir="rtl">أربعون طلبا أحمر. أيها خللك أنت؟</span> | <span dir="rtl">أَرْبَعُونَ طَلَبًا أَحْمَرَ. أَيُّهَا خَلَلُكَ أَنْتَ؟</span> |
| V2 | 4.90 | 3, 4 | Wake it up, start recording, test as usual. | <span dir="rtl">شغله، ابدأ التسجيل، واختبر كعادتك.</span> | <span dir="rtl">شَغِّلْهُ، ابْدَأِ التَّسْجِيلَ، وَاخْتَبِرْ كَعَادَتِكَ.</span> |
| V3 | 9.60 | 5, 6 | The network filter folds the background noise into one line. | <span dir="rtl">تصفية الشبكة تطوي ضجيج الخلفية في سطر واحد.</span> | <span dir="rtl">تَصْفِيَةُ الشَّبَكَةِ تَطْوِي ضَجِيجَ الْخَلْفِيَّةِ فِي سَطْرٍ وَاحِدٍ.</span> |
| V4 | 14.70 | 7, 8 | What is left points straight at the click that caused it. | <span dir="rtl">وما يبقى يشير مباشرة إلى النقرة التي سببته.</span> | <span dir="rtl">وَمَا يَبْقَى يُشِيرُ مُبَاشَرَةً إِلَى النَّقْرَةِ الَّتِي سَبَّبَتْهُ.</span> |
| V5 | 20.20 | 9, 10, 11 | Watch the replay: the page as it was, up to the red mark. | <span dir="rtl">شاهد إعادة التشغيل: الصفحة كما كانت، حتى العلامة الحمراء.</span> | <span dir="rtl">شَاهِدْ إِعَادَةَ التَّشْغِيلِ: الصَّفْحَةُ كَمَا كَانَتْ، حَتَّى الْعَلَامَةِ الْحَمْرَاءِ.</span> |
| V6 | 26.70 | 12, 13 | Nothing is deleted. Every export keeps every request. | <span dir="rtl">لا يحذف شيء. كل تصدير يحتفظ بكل طلب.</span> | <span dir="rtl">لَا يُحْذَفُ شَيْءٌ. كُلُّ تَصْدِيرٍ يَحْتَفِظُ بِكُلِّ طَلَبٍ.</span> |
| V7 | 31.70 | 14, 15 | One session. Every moment kept, and the cause already found. | <span dir="rtl">جلسة واحدة. كل لحظة محفوظة، والسبب معروف سلفا.</span> | <span dir="rtl">جَلْسَةٌ وَاحِدَةٌ. كُلُّ لَحْظَةٍ مَحْفُوظَةٌ، وَالسَّبَبُ مَعْرُوفٌ سَلَفًا.</span> |
| V8 | 37.00 | 16, 17 | QA Wrap. Free and open source. | <span dir="rtl">QA Wrap، مجاني ومفتوح المصدر.</span> | <span dir="rtl">QA Wrap، مَجَّانِيٌّ وَمَفْتُوحُ الْمَصْدَرِ.</span> |

### Fit (EN 150 wpm, AR 115 wpm; window = voice start to the end of its last caption)

| V# | EN words | AR words | Window s | EN needs s | AR needs s | EN slack | AR slack |
|---|---|---|---|---|---|---|---|
| V1 | 8 | 6 | 4.30 | 3.20 | 3.13 | 1.10 | 1.17 |
| V2 | 8 | 5 | 4.00 | 3.20 | 2.61 | 0.80 | 1.39 |
| V3 | 10 | 8 | 4.70 | 4.00 | 4.17 | 0.70 | 0.53 |
| V4 | 11 | 8 | 5.10 | 4.40 | 4.17 | 0.70 | 0.93 |
| V5 | 13 | 9 | 6.10 | 5.20 | 4.70 | 0.90 | 1.40 |
| V6 | 8 | 8 | 4.60 | 3.20 | 4.17 | 1.40 | 0.43 |
| V7 | 10 | 8 | 4.60 | 4.00 | 4.17 | 0.60 | 0.43 |
| V8 | 6 | 5 | 3.60 | 2.40 | 2.61 | 1.20 | 0.99 |

### Voice

- **Style:** `story` (same for EN and AR). Why: good_for: "Brand story ... about-us films": the film tells one tester's session as a short story (noise, then clarity), not a list.
- Registry direction, byte-exact, not edited: "Say this warmly and confidently, with more emotion and feeling, like a storyteller who cares about the story: "
- **Act 1, 0-9.4:** slower, a little flat, a tester staring at a wall of red; "Which one is your bug?" is a real question, the last word falls.
- **Turn, 9.6-14.5:** brighter, leaning in, pace up about 10 %; stress تصفية الشبكة / network filter.
- **Proof, 14.7-31.5:** matter-of-fact confidence; stress the noun on screen: النقرة / click, إعادة التشغيل / replay, كل طلب / every request.
- **Payoff and end, 31.7-42:** plain and warm, no rising sell; مجاني ومفتوح المصدر said like a fact.
- Continuous read: each voice line runs through its caption changes; breaths of 0.4 s or more only between voice lines. One take per line; no speed-up is planned (every line fits at 150 / 115 wpm).

### Sound

| Time s | Cue | Hits |
|---|---|---|
| 0.1 | tick | first coral row lands (then the cascade is bed-only) |
| 4.9 | swish | the popup rises |
| 6.4 | tick | Start recording pressed |
| 10.4 | reveal | the green glow rises (the turn) |
| 11.2 | swish | 39 rows fold into the bar |
| 16.4 | swish | the arc draws click to 500 |
| 17.3 | tick | high confidence pops |
| 20.1 | swish | 500 box flips into Replay |
| 25.6 | sting | scrub head hits the red mark |
| 27.0 | swish | rows unfold and fold |
| 34.2 | success | the traced row rings green (bookend) |
| 37.1 | logo | the mark draws its check |

- **Bed:** `extension/tools/film/audio/bed.py`, 120 bpm (2.0 s a bar), A Dorian, 21 bars, same seed family as `qa-wrap-40`. Sections: intro bars 1-2 (0-4 s): pluck + 8th hats, no low end, under the flood; drive bars 3-17 (4-34 s): kick + bass + 16th hats from the recording start; the mix (not the bed) holds -75 dBFS 9.0-9.5, as the commercial does; lift bars 18-18 (34-36 s): plucks up an octave into the end card; out bars 19-21 (36-42 s): single hit, ring out under the end card. Reverse swell ending at 36.5 s into the end card. Tail fade from 41.0 s.
- **The one deliberate silence:** 9.0-9.5 s, held at -75 dBFS in the mix (bed and SFX out), as the commercial's 9.5-10.0.
- Levels as the bible §5: voice -13 to -20 dBFS, bed at least 10 dB under the voice, no clipping. SFX are only the six existing cues (`work/film/audio/out/sfx/sfx.json`).

### VFX

- **Act 1 (0-10.4):** warm coral key glow (#493432 core) frame left, behind the red column; ghosts and bokeh drift linearly the whole film; grain as the commercial.
- **Turn (10.4):** green glow (#2b3931) rises frame right over 0.8 s while the coral one fades; the single remaining coral row keeps a small coral halo (one hero accent).
- **Proof (14.5-31.5):** during the push-in on the arc, everything off the two points dims to 40 %; Replay card gets a soft green rim; the red mark carries the beat's only coral.
- **Payoff (31.5-36.5):** green glow centred behind the traced row; no coral left on stage.
- Always: basalt ground #171a1d, ghost blocks (#262d38, blur 7 px, 42 %) and bokeh (#aeb6bf, blur 5 px, 28 %) drifting linearly the whole film; cards, chips, pills and amber buttons as bible §2; beat titles Serif Display 700 caps top inline-start; captions Thmanyah Sans 500 bottom inline-start.

### Arabic cut (mirroring)

AR: the shop miniature sits frame right, the request column on its left; the thread draws right to left and the click-to-500 arc travels right to left; the replay scrub head moves right to left; Strict · Balanced · Everything order reads right to left as صارمة · متوازنة · كل شيء. Do NOT flip: request lines (GET /collect 404), the shop page itself, "Finish", timestamps 00:41 of 01:12 inside isolates.

### Honesty

39 background calls hidden uses the tool's own string (panel.nf.hiddenBar). Kinds folded are the 3.9.1 list (analytics beacons, blocked third-party tags, favicon misses). "Every export keeps every request" is CHANGELOG 3.9.1 ("the HAR and every export keep every request"). Replay format "{at} of {total}" and the red-mark string are replay.* strings. No user counts.


---

## Film 2. One Report, Every Desk / <span dir="rtl">تقرير واحد لكل مكتب</span> (`one-report`)

- **Duration:** 42.0 s (16:9, 30 fps; a 9:16 re-layout shares every time). **Beats:** 8. **The light turns green at 6.0 s.**
- **Promise:** The session writes the bug report, in the shape your team reads, and sends it where they work.
- **Feeling at the start:** Tired: the test is over and the report is a blank page.
- **Feeling at the end:** Done: the same ticket, written and filed, with nothing retyped.
- **Arc:** Problem (coral, 0-4.5): a blank ticket with a blinking caret. Turn at 6.0 s: Copy report is pressed and the ticket fills itself; light goes green. Proof (9.5-32): bug-first layout, ISTQB documents, the destinations, what leaves the machine. Payoff (32-37): the same ticket, filed. End card 37-42.
- **Bookend: frame 0 is a blank ticket card (empty Summary / Steps to reproduce / What happened, caret blinking, coral); the payoff (34.0) is the same card, filled, with a green FILED stamp.**
- **First frame:** Poster frame: one raised ticket card, three empty fields with their labels; the caret blinks (linear, 0.5 s on/off) in Steps to reproduce; a faint clock in the card corner ticks. **Last frame:** the QA Wrap lockup held centred with Download free (end card).

### Shots

| # | In-out s (key) | Size / angle / move | Focal point | What happens | On-screen EN | On-screen AR | Beat title EN / AR | Out |
|---|---|---|---|---|---|---|---|---|
| b1 | 0.0-4.5 (1.4) | MS, slightly high angle on the empty card, hold | the blinking caret in the empty Steps to reproduce field | Poster frame: one raised ticket card, three empty fields with their labels; the caret blinks (linear, 0.5 s on/off) in Steps to reproduce; a faint clock in the card corner ticks. Coral key glow frame left. | Summary · Steps to reproduce · What happened | <span dir="rtl">الملخص · خطوات إعادة الإنتاج · ما حدث</span> | **BLANK** PAGE / <span dir="rtl">صفحة **فارغة**</span> (coral) | the cursor enters toward a button |
| b2 | 4.5-9.5 (7.6) | MS, eye level, hold | the fields filling top to bottom | An amber Copy report button pops beside the card (back.out 2); pressed at 5.6. At 6.0 the light turns green. Lead move: the card writes itself top-down, each field typing in linearly with a caret: title "Checkout: Finish returns 500", four numbered steps (Clicked "Add to cart" (button) ...), What happened, an evidence row with a screenshot thumbnail. | Copy report · Report copied. · Checkout: Finish returns 500 · Steps to reproduce | <span dir="rtl">انسخ التقرير · تم نسخ التقرير. · Checkout: Finish returns 500 · خطوات إعادة الإنتاج</span> | (none) | the card unfolds into the report's tabs |
| b3 | 9.5-15.0 (12.4) | WS of the report card with its tab row, then hold | the What broke card: You did, then What happened | The report opens (power2.inOut 0.6 s) with its tabs Overview · What broke · Timeline · Screens & video · Quality; What broke lifts forward. Lead move: two cells slide in side by side, You did (amber) then What happened (coral), joined by Then. | What broke · You did · Then · What happened | <span dir="rtl">ما الذي تعطل · ما فعلته · ثم · ما حدث</span> | BUG **FIRST** / <span dir="rtl">الخلل **أولا**</span> (green) | the card splits in two |
| b4 | 15.0-20.5 (18.0) | MS of two document cards, low angle (the formal documents made big) | the 29119-3 tag | The report card splits (power2.inOut 0.6 s) into two documents, Test case and Defect report; each gets a header strip. Lead move: a tag Built to the ISTQB shape slides under both, then 29119-3 pops (back.out 2). Severity and Priority land as two separate pills on the defect report (kept apart). | Test case · Defect report · Built to the ISTQB shape · 29119-3 · Severity · Priority | <span dir="rtl">حالة اختبار · تقرير خلل · مبني على قالب ISTQB · 29119-3 · الخطورة · الأولوية</span> | BUILT TO **ISTQB** / <span dir="rtl">بقالب **ISTQB**</span> (green) | the documents merge back into one card |
| b5 | 20.5-27.0 (24.2) | WS, the card centred, destinations in a ring, eye level | the ring of destination chips | Lead move: destination chips arrive around the card in a ring (back.out 1.8, stagger 0.06 s, travel on arcs): Jira first and largest, then GitHub, GitLab, Azure DevOps, Linear, Trello, ClickUp, Asana (names in chips, no logos), then a chat row Slack, Teams, Discord, Google Chat and a webhook chip. Amber File to Jira pressed at 21.6; a copy of the card flies on an arc to Jira; then copies to GitHub and to Slack. | File to Jira · Post to chat · Jira · GitHub · GitLab · Azure DevOps · Linear · Trello · ClickUp · Asana · Slack · Teams · Discord · Google Chat · Webhook address | <span dir="rtl">ارفع إلى Jira · انشر في المحادثة · عنوان الخطاف (product names stay Latin)</span> | (none) | the Jira chip opens into a confirmation sheet |
| b6 | 27.0-32.0 (29.8) | CU on the confirmation sheet | the never-sent row | The sheet What leaves this machine when you file lists Sent: summary, steps, evidence (green ticks, linear stagger) and a row Cookies and passwords with a coral cross. Secondary: Severity to Jira priority mapping strip. | What leaves this machine when you file · Cookies and passwords · Severity to Jira priority | <span dir="rtl">ما الذي يغادر جهازك عند الرفع · الكوكيز وكلمات المرور · الخطورة إلى أولوية Jira</span> | WHAT **LEAVES** / <span dir="rtl">ما الذي **يغادر**</span> (green) | the sheet folds into the ticket |
| b7 | 32.0-37.0 (34.6) | MS of the ticket card (rhymes with frame 0) | the green FILED stamp | Bookend: the b1 card returns in the same place, every field filled. Lead move: FILED slams from 1.4x (power4.in 0.3 s) at 33.8; Filed as QA-128 settles under it (follow-through). | Filed · Filed as QA-128 | <span dir="rtl">تم الرفع · رفع باسم QA-128</span> | (none) | card fades into the end card |
| b8 | 37.0-42.0 (39.5) | MS centred, eye level, hold (the stable end) | the green Download free button | Everything on stage drains to the centre and becomes the QA Wrap mark (graphic match); the mark draws its check (power2.out 0.6 s), the lockup settles (back.out 1.4), maker line, the Free · MIT · English and Arabic pills arrive (back.out 2, staggered 0.08 s), Download free pops last. Ghosts and bokeh keep drifting. | QA Wrap · Made by Nader Alzghoul (NJ-Burrito) · Free · MIT · English and Arabic · Download free | <span dir="rtl">QA Wrap · من صنع نادر الزغول (NJ-Burrito) · مجاني · MIT · عربي وإنجليزي · احصل عليه مجانا</span> | (none) | end (last frame = the lockup, held) |

### Captions

| # | Window s | EN caption | AR caption (unvowelled) | EN w | AR w |
|---|---|---|---|---|---|
| 1 | 0.40-1.60 | Test done. | <span dir="rtl">انتهى الاختبار،</span> | 2 | 2 |
| 2 | 1.60-4.40 | The report is still blank. | <span dir="rtl">والتقرير ما زال فارغا.</span> | 5 | 4 |
| 3 | 4.90-6.20 | Copy report. | <span dir="rtl">انسخ التقرير:</span> | 2 | 2 |
| 4 | 6.20-7.70 | Title, steps and evidence, | <span dir="rtl">العنوان والخطوات والدليل،</span> | 4 | 3 |
| 5 | 7.70-9.30 | already written. | <span dir="rtl">مكتوبة سلفا.</span> | 2 | 2 |
| 6 | 9.90-11.70 | The failure comes first. | <span dir="rtl">الخلل أولا:</span> | 4 | 2 |
| 7 | 11.70-14.80 | What you did, then what happened. | <span dir="rtl">ما فعلته، ثم ما حدث.</span> | 6 | 5 |
| 8 | 15.30-16.60 | Need it formal? | <span dir="rtl">تحتاجه رسميا؟</span> | 3 | 2 |
| 9 | 16.60-18.60 | Test case, defect report, | <span dir="rtl">حالة اختبار وتقرير خلل،</span> | 4 | 4 |
| 10 | 18.60-20.30 | ISTQB shape. | <span dir="rtl">بقالب ISTQB.</span> | 2 | 2 |
| 11 | 20.80-22.40 | File to Jira, | <span dir="rtl">ارفعه إلى Jira،</span> | 3 | 3 |
| 12 | 22.40-24.40 | to seven other trackers, | <span dir="rtl">أو أنظمة التتبع السبعة،</span> | 4 | 4 |
| 13 | 24.40-26.80 | or to chat. | <span dir="rtl">أو المحادثة.</span> | 3 | 2 |
| 14 | 27.30-28.80 | Before it sends, | <span dir="rtl">وقبل الإرسال</span> | 3 | 2 |
| 15 | 28.80-31.80 | it shows you exactly what leaves. | <span dir="rtl">يريك بالضبط ما الذي سيغادر جهازك.</span> | 6 | 6 |
| 16 | 32.30-33.60 | Same ticket. | <span dir="rtl">التذكرة نفسها،</span> | 2 | 2 |
| 17 | 33.60-35.30 | Written by the session, | <span dir="rtl">كتبتها الجلسة</span> | 4 | 2 |
| 18 | 35.30-36.80 | not from memory. | <span dir="rtl">لا الذاكرة.</span> | 3 | 2 |
| 19 | 37.60-39.30 | QA Wrap. | <span dir="rtl">QA Wrap،</span> | 2 | 2 |
| 20 | 39.30-41.10 | Free and open source. | <span dir="rtl">مجاني ومفتوح المصدر.</span> | 4 | 3 |

### Voice lines

| V# | Start s | Captions | EN voice | AR voice (unvowelled) | AR TTS text (full tashkeel) |
|---|---|---|---|---|---|
| V1 | 0.30 | 1, 2 | Test done. The report is still blank. | <span dir="rtl">انتهى الاختبار، والتقرير ما زال فارغا.</span> | <span dir="rtl">انْتَهَى الِاخْتِبَارُ، وَالتَّقْرِيرُ مَا زَالَ فَارِغًا.</span> |
| V2 | 4.80 | 3, 4, 5 | Copy report. Title, steps and evidence, already written. | <span dir="rtl">انسخ التقرير: العنوان والخطوات والدليل، مكتوبة سلفا.</span> | <span dir="rtl">انْسَخِ التَّقْرِيرَ: الْعُنْوَانُ وَالْخُطُوَاتُ وَالدَّلِيلُ، مَكْتُوبَةٌ سَلَفًا.</span> |
| V3 | 9.80 | 6, 7 | The failure comes first. What you did, then what happened. | <span dir="rtl">الخلل أولا: ما فعلته، ثم ما حدث.</span> | <span dir="rtl">الْخَلَلُ أَوَّلًا: مَا فَعَلْتَهُ، ثُمَّ مَا حَدَثَ.</span> |
| V4 | 15.20 | 8, 9, 10 | Need it formal? Test case, defect report, ISTQB shape. | <span dir="rtl">تحتاجه رسميا؟ حالة اختبار وتقرير خلل، بقالب ISTQB.</span> | <span dir="rtl">تَحْتَاجُهُ رَسْمِيًّا؟ حَالَةُ اخْتِبَارٍ وَتَقْرِيرُ خَلَلٍ، بِقَالَبِ آيْ إِسْ تِي كِيُو بِي.</span> |
| V5 | 20.70 | 11, 12, 13 | File to Jira, to seven other trackers, or to chat. | <span dir="rtl">ارفعه إلى Jira، أو أنظمة التتبع السبعة، أو المحادثة.</span> | <span dir="rtl">ارْفَعْهُ إِلَى جِيرَا، أَوْ أَنْظِمَةِ التَّتَبُّعِ السَّبْعَةِ، أَوِ الْمُحَادَثَةِ.</span> |
| V6 | 27.20 | 14, 15 | Before it sends, it shows you exactly what leaves. | <span dir="rtl">وقبل الإرسال يريك بالضبط ما الذي سيغادر جهازك.</span> | <span dir="rtl">وَقَبْلَ الْإِرْسَالِ يُرِيكَ بِالضَّبْطِ مَا الَّذِي سَيُغَادِرُ جِهَازَكَ.</span> |
| V7 | 32.20 | 16, 17, 18 | Same ticket. Written by the session, not from memory. | <span dir="rtl">التذكرة نفسها، كتبتها الجلسة لا الذاكرة.</span> | <span dir="rtl">التَّذْكِرَةُ نَفْسُهَا، كَتَبَتْهَا الْجَلْسَةُ لَا الذَّاكِرَةُ.</span> |
| V8 | 37.50 | 19, 20 | QA Wrap. Free and open source. | <span dir="rtl">QA Wrap، مجاني ومفتوح المصدر.</span> | <span dir="rtl">QA Wrap، مَجَّانِيٌّ وَمَفْتُوحُ الْمَصْدَرِ.</span> |

### Fit (EN 150 wpm, AR 115 wpm; window = voice start to the end of its last caption)

| V# | EN words | AR words | Window s | EN needs s | AR needs s | EN slack | AR slack |
|---|---|---|---|---|---|---|---|
| V1 | 7 | 6 | 4.10 | 2.80 | 3.13 | 1.30 | 0.97 |
| V2 | 8 | 7 | 4.50 | 3.20 | 3.65 | 1.30 | 0.85 |
| V3 | 10 | 7 | 5.00 | 4.00 | 3.65 | 1.00 | 1.35 |
| V4 | 9 | 8 | 5.10 | 3.60 | 4.17 | 1.50 | 0.93 |
| V5 | 10 | 9 | 6.10 | 4.00 | 4.70 | 2.10 | 1.40 |
| V6 | 9 | 8 | 4.60 | 3.60 | 4.17 | 1.00 | 0.43 |
| V7 | 9 | 6 | 4.60 | 3.60 | 3.13 | 1.00 | 1.47 |
| V8 | 6 | 5 | 3.60 | 2.40 | 2.61 | 1.20 | 0.99 |

### Voice

- **Style:** `reel` (same for EN and AR). Why: good_for: "Social reels, short promos, teasers, launch clips under about 60 s": a quick promo of one outcome (report written and sent).
- Registry direction, byte-exact, not edited: "Say this warmly and confidently with a smile in your voice, with more energy and a lively, upbeat pace, like a friendly expert sharing exciting news: "
- **Act 1, 0-4.5:** tired, a little flat; "still blank" lands low.
- **Turn, 4.8-9.5:** upbeat lift on Copy report / انسخ التقرير; the energy of the style arrives here.
- **Proof, 9.8-32:** lively but clear; stress the named thing: What you did / ما فعلته, ISTQB, Jira, what leaves / ما الذي سيغادر.
- **Payoff and end, 32.2-42:** warm and settled; "not from memory" / لا الذاكرة with a small smile, no rising sell.
- Continuous read: each voice line runs through its caption changes; breaths of 0.4 s or more only between voice lines. One take per line; no speed-up is planned (every line fits at 150 / 115 wpm).

### Sound

| Time s | Cue | Hits |
|---|---|---|
| 0.2 | tick | caret's first blink |
| 4.7 | tick | Copy report pops |
| 5.6 | tick | Copy report pressed |
| 6.0 | reveal | the turn: green glow and the card starts writing |
| 9.6 | swish | report opens into tabs |
| 15.1 | swish | the card splits into two documents |
| 16.9 | tick | 29119-3 tag pops |
| 20.7 | swish | destination ring arrives |
| 21.6 | tick | File to Jira pressed |
| 22.3 | success | copy lands on Jira |
| 27.1 | swish | confirmation sheet opens |
| 33.8 | sting | FILED stamp slams |
| 37.6 | logo | the mark draws its check |

- **Bed:** `extension/tools/film/audio/bed.py`, 120 bpm (2.0 s a bar), A Dorian, 21 bars, same seed family as `qa-wrap-40`. Sections: intro bars 1-2 (0-4 s): pluck + 8th hats, no low end; drive bars 3-17 (4-34 s): kick + bass + 16th hats from the turn; lift bars 18-18 (34-36 s): plucks up an octave; out bars 19-21 (36-42 s): single hit, ring out under the end card. Reverse swell ending at 37.0 s into the end card. Tail fade from 41.0 s.
- **Silence:** none planned; the bed carries every beat change.
- Levels as the bible §5: voice -13 to -20 dBFS, bed at least 10 dB under the voice, no clipping. SFX are only the six existing cues (`work/film/audio/out/sfx/sfx.json`).

### VFX

- **Act 1 (0-6.0):** coral key glow frame left behind the empty card; the caret is the only bright point.
- **Turn (6.0):** green glow rises frame right over 0.8 s as the first field types.
- **Proof (9.5-32):** green key behind the focal card each beat; in b5 the ring chips sit in a soft ring of bokeh; in b6 the one coral cross is the beat's only coral.
- **Payoff (32-37):** green glow centred on the stamp; a short green bloom (0.2 s) on the slam.
- Always: basalt ground #171a1d, ghost blocks (#262d38, blur 7 px, 42 %) and bokeh (#aeb6bf, blur 5 px, 28 %) drifting linearly the whole film; cards, chips, pills and amber buttons as bible §2; beat titles Serif Display 700 caps top inline-start; captions Thmanyah Sans 500 bottom inline-start.

### Arabic cut (mirroring)

AR: the ticket card and its fields are RTL (labels right, text right-aligned); the typing caret travels right to left; the tab row reads right to left; the two documents split with Test case on the right; the destination ring fills counter-clockwise from the right; card copies fly right to left. Do NOT flip: the English page text "Checkout: Finish returns 500", product names in chips, 29119-3, QA-128 (isolated Latin runs).

### Honesty

"Seven other trackers" = ROADMAP "Seven other trackers: GitHub, GitLab, Azure DevOps, Linear, Trello, ClickUp and Asana"; chat destinations from README feature 27. ISTQB / 29119-3 from report.istqb.* strings. What-leaves sheet and the Cookies and passwords row are options.svc.* strings. QA-128 is an illustrative ticket key in Jira's own format. No claim about time saved.


---

## Film 3. Show It, Don't Describe It / <span dir="rtl">أره ولا تصفه</span> (`show-it`)

- **Duration:** 40.0 s (16:9, 30 fps; a 9:16 re-layout shares every time). **Beats:** 7. **The light turns green at 5.6 s.**
- **Promise:** Every bug arrives with its picture, its clip and the marks that point at it.
- **Feeling at the start:** Frustrated: three questions in a ticket thread, all asking "where?".
- **Feeling at the end:** Relieved: every question already answered on the ticket.
- **Arc:** Problem (coral, 0-4.5): three question bubbles pile onto a ticket. Turn at 5.6 s: a screenshot flashes into the session and the light goes green. Proof (10-29): mark it up, record the screen, save the last minute. Payoff (29-34.5): each bubble answered by a media card. End card 34.5-40.
- **Bookend: frame 0 is three coral question bubbles on a ticket edge; the payoff (31.5) is the same three bubbles, each snapped to a media card and turned green.**
- **First frame:** Poster frame: the edge of a ticket card frame right third; three speech bubbles pop onto it one by one (back.out 2, 0.6 s apart): Where exactly? · Which button? · Can you send a video? Coral glow frame left.. **Last frame:** the QA Wrap lockup held centred with Download free (end card).

### Shots

| # | In-out s (key) | Size / angle / move | Focal point | What happens | On-screen EN | On-screen AR | Beat title EN / AR | Out |
|---|---|---|---|---|---|---|---|---|
| b1 | 0.0-4.5 (1.6) | MS, eye level, hold | the third bubble | Poster frame: the edge of a ticket card frame right third; three speech bubbles pop onto it one by one (back.out 2, 0.6 s apart): Where exactly? · Which button? · Can you send a video? Coral glow frame left. | Where exactly? · Which button? · Can you send a video? | <span dir="rtl">أين بالضبط؟ · أي زر؟ · هل ترسل فيديو؟</span> | WHERE **EXACTLY**? / <span dir="rtl">أين **بالضبط**؟</span> (coral) | a camera flash wipes the frame |
| b2 | 4.5-10.0 (6.8) | MS on a Swag Labs style cart page miniature | the still card landing on the session line | Amber Take a screenshot pressed (chip Alt+C beside it); white flash 0.12 s at 5.5; at 5.6 the light turns green. Lead move: the still lifts off the page as a card (back.out 1.6) and lands on a session line at its moment (a dot with 00:23). | Take a screenshot · Alt+C · 00:23 | <span dir="rtl">التقط لقطة شاشة · Alt+C · 00:23</span> | (none) | push-in on the still |
| b3 | 10.0-16.5 (13.0) | CU, push-in by scale 1.6x into the still on the annotate canvas | the arrow's drawing head | The still opens on the markup canvas with its tool rail: Arrow · Step · Text · Redact. Lead move: an arrow draws (power2.inOut 0.6 s) to the Checkout button; secondary: a Step badge 1 pops (back.out 2); a Redact block slams (power4.in 0.25 s) over an email address on the page. | Arrow · Step · Text · Redact · 1 | <span dir="rtl">سهم · خطوة · نص · حجب · 1</span> | POINT AT **IT** / <span dir="rtl">أشر **إليه**</span> (green) | pull-out; the still shrinks to a thumbnail |
| b4 | 16.5-23.0 (19.6) | WS, eye level | the running clip strip | Amber Record the screen pressed; a red rec dot breathes (sine.inOut). Lead move: a film strip draws linearly across the frame while the counter runs Recording: 0m 01s so far. → Recording: 2m 14s so far. (time compresses on purpose, the counter is the joke); a mic wave and a small webcam circle ride on the strip. Pills MP4 · WebM · GIF arrive at the end (back.out 2). | Record the screen · Recording: 2m 14s so far. · MP4 · WebM · GIF | <span dir="rtl">سجل الشاشة · التسجيل: 2 د 14 ث حتى الآن. · MP4 · WebM · GIF</span> | NO TIME **LIMIT** / <span dir="rtl">بلا حد **زمني**</span> (green) | the strip curls into a loop |
| b5 | 23.0-29.0 (26.2) | MS, eye level, hold | the minute clip dropping out of the loop | The strip curls into a ring that keeps turning (linear): the rolling buffer. A coral flicker on the page miniature (a bug happened while no clip was running). Amber Save last 1 minute pressed at 25.0; lead move: the last arc of the ring detaches and drops out as a clip card (back.out 1.4) with 01:00. | Save last 1 minute · 01:00 | <span dir="rtl">احفظ آخر دقيقة · 01:00</span> | THE LAST **MINUTE** / <span dir="rtl">آخر **دقيقة**</span> (amber) | the clip card flies to the ticket |
| b6 | 29.0-34.5 (31.6) | MS of the ticket edge (rhymes with frame 0) | the three bubbles turning green | Bookend: the b1 ticket and its three bubbles return. Lead move: the still with its arrow snaps to Where exactly?, the Step 1 badge to Which button?, the clip card to Can you send a video? (each travels on an arc, back.out 1.4); each bubble turns green on contact. The gallery tab Screens & video lights. | Screens & video | <span dir="rtl">اللقطات والفيديو</span> | (none) | all objects drain to centre |
| b7 | 34.5-40.0 (37.0) | MS centred, eye level, hold (the stable end) | the green Download free button | Everything on stage drains to the centre and becomes the QA Wrap mark (graphic match); the mark draws its check (power2.out 0.6 s), the lockup settles (back.out 1.4), maker line, the Free · MIT · English and Arabic pills arrive (back.out 2, staggered 0.08 s), Download free pops last. Ghosts and bokeh keep drifting. | QA Wrap · Made by Nader Alzghoul (NJ-Burrito) · Free · MIT · English and Arabic · Download free | <span dir="rtl">QA Wrap · من صنع نادر الزغول (NJ-Burrito) · مجاني · MIT · عربي وإنجليزي · احصل عليه مجانا</span> | (none) | end (last frame = the lockup, held) |

### Captions

| # | Window s | EN caption | AR caption (unvowelled) | EN w | AR w |
|---|---|---|---|---|---|
| 1 | 0.40-2.30 | Where exactly? Which button? | <span dir="rtl">أين بالضبط؟ أي زر؟</span> | 4 | 4 |
| 2 | 2.30-4.30 | Can you send a video? | <span dir="rtl">هل ترسل فيديو؟</span> | 5 | 3 |
| 3 | 4.90-6.60 | Take a screenshot. | <span dir="rtl">التقط لقطة شاشة،</span> | 3 | 3 |
| 4 | 6.60-8.30 | It lands in the session, | <span dir="rtl">فتحفظ في الجلسة</span> | 5 | 3 |
| 5 | 8.30-9.80 | at its moment. | <span dir="rtl">عند لحظتها.</span> | 3 | 2 |
| 6 | 10.30-11.60 | Mark it up: | <span dir="rtl">ضع العلامات:</span> | 3 | 2 |
| 7 | 11.60-13.30 | an arrow, a step, | <span dir="rtl">سهم، وخطوة،</span> | 4 | 2 |
| 8 | 13.30-16.30 | a Redact block on personal data. | <span dir="rtl">وحجب يغطي البيانات الشخصية.</span> | 6 | 4 |
| 9 | 16.90-18.40 | Record the screen, | <span dir="rtl">سجل الشاشة،</span> | 3 | 2 |
| 10 | 18.40-20.60 | with your voice if you like. | <span dir="rtl">وبصوتك إن شئت،</span> | 6 | 3 |
| 11 | 20.60-22.80 | No time limit. | <span dir="rtl">بلا حد زمني.</span> | 3 | 3 |
| 12 | 23.30-24.80 | Missed it? | <span dir="rtl">فاتتك اللحظة؟</span> | 2 | 2 |
| 13 | 24.80-26.80 | Save the last minute, | <span dir="rtl">احفظ آخر دقيقة،</span> | 4 | 3 |
| 14 | 26.80-28.80 | after the fact. | <span dir="rtl">بعد وقوعها.</span> | 3 | 2 |
| 15 | 29.30-31.20 | Where, which button, and how: | <span dir="rtl">أين، وأي زر، وكيف:</span> | 5 | 4 |
| 16 | 31.20-34.30 | answered before anyone asks. | <span dir="rtl">الجواب قبل أن يسأل أحد.</span> | 4 | 5 |
| 17 | 35.10-36.80 | QA Wrap. | <span dir="rtl">QA Wrap،</span> | 2 | 2 |
| 18 | 36.80-38.60 | Free and open source. | <span dir="rtl">مجاني ومفتوح المصدر.</span> | 4 | 3 |

### Voice lines

| V# | Start s | Captions | EN voice | AR voice (unvowelled) | AR TTS text (full tashkeel) |
|---|---|---|---|---|---|
| V1 | 0.30 | 1, 2 | Where exactly? Which button? Can you send a video? | <span dir="rtl">أين بالضبط؟ أي زر؟ هل ترسل فيديو؟</span> | <span dir="rtl">أَيْنَ بِالضَّبْطِ؟ أَيُّ زِرٍّ؟ هَلْ تُرْسِلُ فِيدْيُو؟</span> |
| V2 | 4.80 | 3, 4, 5 | Take a screenshot. It lands in the session, at its moment. | <span dir="rtl">التقط لقطة شاشة، فتحفظ في الجلسة عند لحظتها.</span> | <span dir="rtl">الْتَقِطْ لَقْطَةَ شَاشَةٍ، فَتُحْفَظَ فِي الْجَلْسَةِ عِنْدَ لَحْظَتِهَا.</span> |
| V3 | 10.20 | 6, 7, 8 | Mark it up: an arrow, a step, a Redact block on personal data. | <span dir="rtl">ضع العلامات: سهم، وخطوة، وحجب يغطي البيانات الشخصية.</span> | <span dir="rtl">ضَعِ الْعَلَامَاتِ: سَهْمٌ، وَخُطْوَةٌ، وَحَجْبٌ يُغَطِّي الْبَيَانَاتِ الشَّخْصِيَّةَ.</span> |
| V4 | 16.80 | 9, 10, 11 | Record the screen, with your voice if you like. No time limit. | <span dir="rtl">سجل الشاشة، وبصوتك إن شئت، بلا حد زمني.</span> | <span dir="rtl">سَجِّلِ الشَّاشَةَ، وَبِصَوْتِكَ إِنْ شِئْتَ، بِلَا حَدٍّ زَمَنِيٍّ.</span> |
| V5 | 23.20 | 12, 13, 14 | Missed it? Save the last minute, after the fact. | <span dir="rtl">فاتتك اللحظة؟ احفظ آخر دقيقة، بعد وقوعها.</span> | <span dir="rtl">فَاتَتْكَ اللَّحْظَةُ؟ احْفَظْ آخِرَ دَقِيقَةٍ، بَعْدَ وُقُوعِهَا.</span> |
| V6 | 29.20 | 15, 16 | Where, which button, and how: answered before anyone asks. | <span dir="rtl">أين، وأي زر، وكيف: الجواب قبل أن يسأل أحد.</span> | <span dir="rtl">أَيْنَ، وَأَيُّ زِرٍّ، وَكَيْفَ: الْجَوَابُ قَبْلَ أَنْ يَسْأَلَ أَحَدٌ.</span> |
| V7 | 35.00 | 17, 18 | QA Wrap. Free and open source. | <span dir="rtl">QA Wrap، مجاني ومفتوح المصدر.</span> | <span dir="rtl">QA Wrap، مَجَّانِيٌّ وَمَفْتُوحُ الْمَصْدَرِ.</span> |

### Fit (EN 150 wpm, AR 115 wpm; window = voice start to the end of its last caption)

| V# | EN words | AR words | Window s | EN needs s | AR needs s | EN slack | AR slack |
|---|---|---|---|---|---|---|---|
| V1 | 9 | 7 | 4.00 | 3.60 | 3.65 | 0.40 | 0.35 |
| V2 | 11 | 8 | 5.00 | 4.40 | 4.17 | 0.60 | 0.83 |
| V3 | 13 | 8 | 6.10 | 5.20 | 4.17 | 0.90 | 1.93 |
| V4 | 12 | 8 | 6.00 | 4.80 | 4.17 | 1.20 | 1.83 |
| V5 | 9 | 7 | 5.60 | 3.60 | 3.65 | 2.00 | 1.95 |
| V6 | 9 | 9 | 5.10 | 3.60 | 4.70 | 1.50 | 0.40 |
| V7 | 6 | 5 | 3.60 | 2.40 | 2.61 | 1.20 | 0.99 |

### Voice

- **Style:** `reel` (same for EN and AR). Why: good_for: "Social reels, short promos, teasers, launch clips under about 60 s": a bright capture showcase, quick hits on four tools.
- Registry direction, byte-exact, not edited: "Say this warmly and confidently with a smile in your voice, with more energy and a lively, upbeat pace, like a friendly expert sharing exciting news: "
- **Act 1, 0-4.5:** three questions with real impatience, each a touch quicker than the last.
- **Turn, 4.8-10:** lively and bright on Take a screenshot / التقط لقطة شاشة.
- **Proof, 10.2-29:** upbeat, one stress per line on the tool's name: Redact / حجب, Record the screen / سجل الشاشة, the last minute / آخر دقيقة.
- **Payoff and end, 29.2-40:** warm and pleased; "before anyone asks" / قبل أن يسأل أحد lands softly.
- Continuous read: each voice line runs through its caption changes; breaths of 0.4 s or more only between voice lines. One take per line; no speed-up is planned (every line fits at 150 / 115 wpm).

### Sound

| Time s | Cue | Hits |
|---|---|---|
| 0.3 | tick | bubble 1 pops |
| 0.9 | tick | bubble 2 |
| 1.5 | tick | bubble 3 |
| 5.5 | reveal | the screenshot flash and the turn |
| 7.9 | tick | still lands on the session line |
| 12.0 | swish | the arrow draws |
| 13.4 | sting | Redact block slams |
| 17.0 | tick | Record the screen pressed |
| 22.0 | tick | format pills pop |
| 25.0 | tick | Save last 1 minute pressed |
| 25.6 | swish | the minute clip drops out |
| 30.0 | success | the three bubbles turn green |
| 35.1 | logo | the mark draws its check |

- **Bed:** `extension/tools/film/audio/bed.py`, 120 bpm (2.0 s a bar), A Dorian, 20 bars, same seed family as `qa-wrap-40`. Sections: intro bars 1-2 (0-4 s): pluck + 8th hats, no low end; drive bars 3-16 (4-32 s): kick + bass + 16th hats from the flash; lift bars 17-17 (32-34 s): plucks up an octave; out bars 18-20 (34-40 s): single hit, ring out under the end card. Reverse swell ending at 34.5 s into the end card. Tail fade from 39.0 s.
- **Silence:** none planned; the bed carries every beat change.
- Levels as the bible §5: voice -13 to -20 dBFS, bed at least 10 dB under the voice, no clipping. SFX are only the six existing cues (`work/film/audio/out/sfx/sfx.json`).

### VFX

- **Act 1 (0-5.6):** coral key glow frame left behind the bubbles; ghosts drift slower (no change in speed is allowed: they keep the house rate, the bubbles carry the tension).
- **Turn (5.6):** a 0.12 s white flash (the shutter), then green glow rises frame right.
- **Proof (10-29):** during the push-in on the canvas, the world outside the still dims to 40 %; the rec dot is the only coral in b4; in b5 the coral flicker on the page is the only coral.
- **Payoff (29-34.5):** green glow behind the ticket; each bubble blooms green 0.2 s on contact.
- Always: basalt ground #171a1d, ghost blocks (#262d38, blur 7 px, 42 %) and bokeh (#aeb6bf, blur 5 px, 28 %) drifting linearly the whole film; cards, chips, pills and amber buttons as bible §2; beat titles Serif Display 700 caps top inline-start; captions Thmanyah Sans 500 bottom inline-start.

### Arabic cut (mirroring)

AR: the ticket sits frame left, bubbles stack from the right; the session line and the film strip draw right to left; the rolling ring turns counter-clockwise; media cards fly right to left to the bubbles; tool rail order reads سهم · خطوة · نص · حجب from the right. Do NOT flip: the cart page (Sauce Labs Backpack, Checkout), Alt+C, MP4 · WebM · GIF, 00:23 and 01:00 (isolated), the arrow on the still (it points at the real button).

### Honesty

Recording counter uses popup.record.since ("Recording: {m}m {s}s so far."). Formats MP4/WebM/GIF from README feature 17; "no time limit" is README ("There is no time limit, by design. The only real limit is the disk"). Save last 1 minute from CHANGELOG 3.6.0/3.8.0. Annotate tools are annotate.tools.* names. Mic in a recording: README feature 22.


---

## Film 4. The Whole Toolbox / <span dir="rtl">عدة الاختبار كاملة</span> (`the-toolbox`)

- **Duration:** 43.0 s (16:9, 30 fps; a 9:16 re-layout shares every time). **Beats:** 8. **The light turns green at 6.0 s.**
- **Promise:** The checks a page needs, in one popup, while you test it.
- **Feeling at the start:** Scattered: one tab for each check, and none of them talk to each other.
- **Feeling at the end:** In control: one popup, the page checked from several sides.
- **Arc:** Problem (coral, 0-4.5): scattered tool windows. Turn at 6.0 s: they fly into one popup, light green. Proof (10-33): accessibility, page speed, passive checks, the tool rows. Payoff (33-37.5): one popup, the scattered ghosts fade. End card 37.5-43.
- **Bookend + graphic match: frame 0 is a scatter of tool windows around a page; at 4.5-6.0 they fly together and become the popup's Tools fold (scatter into one card); the payoff (35.0) shows the same scatter as faint ghosts fading behind the one popup.**
- **First frame:** Poster frame: a Practice Software Testing style page (Toolshop: Combination Pliers, Claw Hammer) small in the centre; around it a scatter of grey tool windows drifts (sine.inOut), each with a generic label: speed, accessibility, locators, cookies, requests. **Last frame:** the QA Wrap lockup held centred with Download free (end card).

### Shots

| # | In-out s (key) | Size / angle / move | Focal point | What happens | On-screen EN | On-screen AR | Beat title EN / AR | Out |
|---|---|---|---|---|---|---|---|---|
| b1 | 0.0-4.5 (1.5) | EWS, high angle, hold | none on purpose: the scatter | Poster frame: a Practice Software Testing style page (Toolshop: Combination Pliers, Claw Hammer) small in the centre; around it a scatter of grey tool windows drifts (sine.inOut), each with a generic label: speed, accessibility, locators, cookies, requests. Coral glow frame left. | speed · accessibility · locators · cookies · requests | <span dir="rtl">السرعة · إمكانية الوصول · المحددات · الكوكيز · الطلبات</span> | TAB **SPRAWL** / <span dir="rtl">**فوضى** التبويبات</span> (coral) | the windows start pulling to one point |
| b2 | 4.5-10.0 (7.8) | MS on the popup, eye level | the Tools fold filling | Graphic match: the scattered windows fly on arcs into one point (power2.inOut 0.8 s) and that point opens as the QA Wrap popup (back.out 1.4); light turns green at 6.0. Lead move: tool rows tick in top to bottom (linear stagger 0.12 s) with their real labels. | Tools · Copy a locator · Try nasty values · Design the values · Stress the layout · Break a request · Check another size · Check accessibility · Check page speed | <span dir="rtl">الأدوات · انسخ محدد العنصر · جرب قيما صعبة · صمم القيم · أجهد التخطيط · أعطب طلبا · افحص مقاسا آخر · افحص إمكانية الوصول · افحص سرعة الصفحة</span> | **ONE** POPUP / <span dir="rtl">نافذة **واحدة**</span> (green) | the Check accessibility row glows amber |
| b3 | 10.0-16.0 (13.4) | MS on the Toolshop page | the ringed low-contrast button | Check accessibility pressed. Lead move: a scan line sweeps the page linearly; finding pins pop where it passes (back.out 2). Show me pressed on one finding: the page scrolls it into view and a ring draws round a pale Add to cart button. | Check accessibility · Findings · Show me | <span dir="rtl">افحص إمكانية الوصول · النتائج · أرني</span> | (none) | the ring becomes a gauge |
| b4 | 16.0-21.5 (18.8) | MS, low angle on three gauges (the numbers made big) | the LCP gauge | Check page speed pressed. Lead move: three gauge arcs draw (power2.out 0.7 s): LCP, CLS, requests; a toast settles under them in the tool's own format. A small signed-in avatar on the page shows the page is mid-flow. | Check page speed · LCP 1840ms · CLS 0.04 · Requests: 38 | <span dir="rtl">افحص سرعة الصفحة · LCP 1840ms · CLS 0.04 · الطلبات: 38</span> | (none) | the page returns, the cursor moves to a button |
| b5 | 21.5-27.0 (24.6) | MS on the page, eye level | the dead button ring | The cursor presses Next; nothing happens; a 1.7 s count ring draws (linear) round the button and turns coral: a dead click, filed into the session. Secondary: a price label that runs out of its box gets an orange outline. | Next · 1.7 s | <span dir="rtl">Next · 1.7 s</span> | DEAD **BUTTON** / <span dir="rtl">زر **ميت**</span> (coral) | the finding chips fly back into the popup |
| b6 | 27.0-33.0 (30.0) | WS: popup left, page right | the result of each tool on the page | Lead move: four rows fire in turn (each a tick and a small result on the page): Copy a locator gives a chip getByRole('button', { name: 'Add to cart' }); Try nasty values fills the quantity field with an edge value; Stress the layout stretches the text with orange outlines; Break a request forces a 500 on the next call. | Copy a locator · getByRole('button', { name: 'Add to cart' }) · Try nasty values · Stress the layout · Break a request · 500 | <span dir="rtl">انسخ محدد العنصر · getByRole('button', { name: 'Add to cart' }) · جرب قيما صعبة · أجهد التخطيط · أعطب طلبا · 500</span> | (none) | the page shrinks behind the popup |
| b7 | 33.0-37.5 (35.0) | MS, the popup centred (rhymes with frame 0) | the popup | Bookend: the b1 scatter returns as faint ghosts around the popup and fades out (linear 1.2 s); the popup's coverage meter fills (power2.out) as the seven activity marks tick. | Tools | <span dir="rtl">الأدوات</span> | (none) | all objects drain to centre |
| b8 | 37.5-43.0 (40.0) | MS centred, eye level, hold (the stable end) | the green Download free button | Everything on stage drains to the centre and becomes the QA Wrap mark (graphic match); the mark draws its check (power2.out 0.6 s), the lockup settles (back.out 1.4), maker line, the Free · MIT · English and Arabic pills arrive (back.out 2, staggered 0.08 s), Download free pops last. Ghosts and bokeh keep drifting. | QA Wrap · Made by Nader Alzghoul (NJ-Burrito) · Free · MIT · English and Arabic · Download free | <span dir="rtl">QA Wrap · من صنع نادر الزغول (NJ-Burrito) · مجاني · MIT · عربي وإنجليزي · احصل عليه مجانا</span> | (none) | end (last frame = the lockup, held) |

### Captions

| # | Window s | EN caption | AR caption (unvowelled) | EN w | AR w |
|---|---|---|---|---|---|
| 1 | 0.40-1.90 | A tab for speed, | <span dir="rtl">تبويب للسرعة،</span> | 4 | 2 |
| 2 | 1.90-4.40 | for accessibility, for locators. | <span dir="rtl">وآخر لإمكانية الوصول، وثالث للمحددات.</span> | 4 | 5 |
| 3 | 4.90-6.90 | QA Wrap puts them | <span dir="rtl">QA Wrap يجمعها</span> | 4 | 3 |
| 4 | 6.90-9.80 | in one popup, beside your page. | <span dir="rtl">في نافذة واحدة بجانب صفحتك.</span> | 6 | 5 |
| 5 | 10.30-12.20 | Check accessibility, | <span dir="rtl">افحص إمكانية الوصول،</span> | 2 | 3 |
| 6 | 12.20-15.80 | press Show me on any finding. | <span dir="rtl">ثم اضغط أرني عند أي نتيجة.</span> | 6 | 6 |
| 7 | 16.30-17.80 | Check page speed | <span dir="rtl">افحص سرعة صفحتك:</span> | 3 | 3 |
| 8 | 17.80-19.20 | where you stand: | <span dir="rtl">بعد الدخول،</span> | 3 | 2 |
| 9 | 19.20-21.30 | logged in, mid-flow. | <span dir="rtl">وفي منتصف المسار.</span> | 3 | 3 |
| 10 | 21.80-23.30 | While you record, | <span dir="rtl">وأثناء التسجيل،</span> | 3 | 2 |
| 11 | 23.30-25.00 | it flags dead buttons | <span dir="rtl">يرصد وحده الأزرار الميتة</span> | 4 | 4 |
| 12 | 25.00-26.80 | and cut-off text by itself. | <span dir="rtl">والنص المقطوع.</span> | 5 | 2 |
| 13 | 27.30-30.00 | Copy a locator, try nasty values, | <span dir="rtl">انسخ محدد العنصر، جرب قيما صعبة،</span> | 6 | 6 |
| 14 | 30.00-32.80 | stress the layout, break a request. | <span dir="rtl">أجهد التخطيط، أعطب طلبا.</span> | 6 | 4 |
| 15 | 33.30-34.60 | Fewer tabs, | <span dir="rtl">تبويبات أقل،</span> | 2 | 2 |
| 16 | 34.60-37.30 | and more of the page checked. | <span dir="rtl">وفحص أوسع للصفحة.</span> | 6 | 3 |
| 17 | 38.10-39.80 | QA Wrap. | <span dir="rtl">QA Wrap،</span> | 2 | 2 |
| 18 | 39.80-41.60 | Free and open source. | <span dir="rtl">مجاني ومفتوح المصدر.</span> | 4 | 3 |

### Voice lines

| V# | Start s | Captions | EN voice | AR voice (unvowelled) | AR TTS text (full tashkeel) |
|---|---|---|---|---|---|
| V1 | 0.20 | 1, 2 | A tab for speed, for accessibility, for locators. | <span dir="rtl">تبويب للسرعة، وآخر لإمكانية الوصول، وثالث للمحددات.</span> | <span dir="rtl">تَبْوِيبٌ لِلسُّرْعَةِ، وَآخَرُ لِإِمْكَانِيَّةِ الْوُصُولِ، وَثَالِثٌ لِلْمُحَدِّدَاتِ.</span> |
| V2 | 4.80 | 3, 4 | QA Wrap puts them in one popup, beside your page. | <span dir="rtl">QA Wrap يجمعها في نافذة واحدة بجانب صفحتك.</span> | <span dir="rtl">QA Wrap يَجْمَعُهَا فِي نَافِذَةٍ وَاحِدَةٍ بِجَانِبِ صَفْحَتِكَ.</span> |
| V3 | 10.20 | 5, 6 | Check accessibility, press Show me on any finding. | <span dir="rtl">افحص إمكانية الوصول، ثم اضغط أرني عند أي نتيجة.</span> | <span dir="rtl">افْحَصْ إِمْكَانِيَّةَ الْوُصُولِ، ثُمَّ اضْغَطْ أَرِنِي عِنْدَ أَيِّ نَتِيجَةٍ.</span> |
| V4 | 16.20 | 7, 8, 9 | Check page speed where you stand: logged in, mid-flow. | <span dir="rtl">افحص سرعة صفحتك: بعد الدخول، وفي منتصف المسار.</span> | <span dir="rtl">افْحَصْ سُرْعَةَ صَفْحَتِكَ: بَعْدَ الدُّخُولِ، وَفِي مُنْتَصَفِ الْمَسَارِ.</span> |
| V5 | 21.70 | 10, 11, 12 | While you record, it flags dead buttons and cut-off text by itself. | <span dir="rtl">وأثناء التسجيل، يرصد وحده الأزرار الميتة والنص المقطوع.</span> | <span dir="rtl">وَأَثْنَاءَ التَّسْجِيلِ، يَرْصُدُ وَحْدَهُ الْأَزْرَارَ الْمَيِّتَةَ وَالنَّصَّ الْمَقْطُوعَ.</span> |
| V6 | 27.20 | 13, 14 | Copy a locator, try nasty values, stress the layout, break a request. | <span dir="rtl">انسخ محدد العنصر، جرب قيما صعبة، أجهد التخطيط، أعطب طلبا.</span> | <span dir="rtl">انْسَخْ مُحَدِّدَ الْعُنْصُرِ، جَرِّبْ قِيَمًا صَعْبَةً، أَجْهِدِ التَّخْطِيطَ، أَعْطِبْ طَلَبًا.</span> |
| V7 | 33.20 | 15, 16 | Fewer tabs, and more of the page checked. | <span dir="rtl">تبويبات أقل، وفحص أوسع للصفحة.</span> | <span dir="rtl">تَبْوِيبَاتٌ أَقَلُّ، وَفَحْصٌ أَوْسَعُ لِلصَّفْحَةِ.</span> |
| V8 | 38.00 | 17, 18 | QA Wrap. Free and open source. | <span dir="rtl">QA Wrap، مجاني ومفتوح المصدر.</span> | <span dir="rtl">QA Wrap، مَجَّانِيٌّ وَمَفْتُوحُ الْمَصْدَرِ.</span> |

### Fit (EN 150 wpm, AR 115 wpm; window = voice start to the end of its last caption)

| V# | EN words | AR words | Window s | EN needs s | AR needs s | EN slack | AR slack |
|---|---|---|---|---|---|---|---|
| V1 | 8 | 7 | 4.20 | 3.20 | 3.65 | 1.00 | 0.55 |
| V2 | 10 | 8 | 5.00 | 4.00 | 4.17 | 1.00 | 0.83 |
| V3 | 8 | 9 | 5.60 | 3.20 | 4.70 | 2.40 | 0.90 |
| V4 | 9 | 8 | 5.10 | 3.60 | 4.17 | 1.50 | 0.93 |
| V5 | 12 | 8 | 5.10 | 4.80 | 4.17 | 0.30 | 0.93 |
| V6 | 12 | 10 | 5.60 | 4.80 | 5.22 | 0.80 | 0.38 |
| V7 | 8 | 5 | 4.10 | 3.20 | 2.61 | 0.90 | 1.49 |
| V8 | 6 | 5 | 3.60 | 2.40 | 2.61 | 1.20 | 0.99 |

### Voice

- **Style:** `reel` (same for EN and AR). Why: good_for: "Social reels, short promos, teasers, launch clips under about 60 s": a fast tour of many tools in one promo.
- Registry direction, byte-exact, not edited: "Say this warmly and confidently with a smile in your voice, with more energy and a lively, upbeat pace, like a friendly expert sharing exciting news: "
- **Act 1, 0-4.5:** a list said with mild exasperation, rising on each "for".
- **Turn, 4.8-10:** bright and quick; QA Wrap said clearly, exactly as in English, never rushed.
- **Proof, 10.2-33:** upbeat and crisp; each tool name stressed as it lights: Show me / أرني, page speed / سرعة, dead buttons / الأزرار الميتة; the four-tool list in b6 keeps one even beat per tool.
- **Payoff and end, 33.2-43:** warm, settled; no rising sell.
- Continuous read: each voice line runs through its caption changes; breaths of 0.4 s or more only between voice lines. One take per line; no speed-up is planned (every line fits at 150 / 115 wpm).

### Sound

| Time s | Cue | Hits |
|---|---|---|
| 0.4 | swish | the scatter drifts in |
| 4.6 | swish | windows fly together |
| 6.0 | reveal | the popup opens (the turn) |
| 10.4 | tick | Check accessibility pressed |
| 12.9 | swish | Show me scroll |
| 13.6 | tick | the ring closes |
| 16.4 | tick | Check page speed pressed |
| 17.2 | swish | gauges draw |
| 24.4 | sting | dead click ring turns coral |
| 27.4 | tick | locator chip |
| 28.8 | tick | nasty value |
| 30.2 | tick | layout stress |
| 31.4 | tick | break a request |
| 35.6 | success | coverage meter fills |
| 38.1 | logo | the mark draws its check |

- **Bed:** `extension/tools/film/audio/bed.py`, 120 bpm (2.0 s a bar), A Dorian, 22 bars, same seed family as `qa-wrap-40`. Sections: intro bars 1-2 (0-4 s): pluck + 8th hats, no low end; drive bars 3-18 (4-36 s): kick + bass + 16th hats from the turn; lift bars 19-19 (36-38 s): plucks up an octave; out bars 20-22 (38-44 s): single hit, ring out under the end card. Reverse swell ending at 37.5 s into the end card. Tail fade from 42.0 s.
- **Silence:** none planned; the bed carries every beat change.
- Levels as the bible §5: voice -13 to -20 dBFS, bed at least 10 dB under the voice, no clipping. SFX are only the six existing cues (`work/film/audio/out/sfx/sfx.json`).

### VFX

- **Act 1 (0-6.0):** coral key glow frame left; the grey windows carry the ghost-block look (blur 2 px, 70 %).
- **Turn (6.0):** green glow rises behind the popup as it opens.
- **Proof (10-33):** green key moves with the focal tool; the scan line is a thin green band; in b5 the dead-click ring is the only coral; orange outlines in b5/b6 are the tool's own stress colour, kept small.
- **Payoff (33-37.5):** green glow centred on the popup; the fading ghosts lose their colour first.
- Always: basalt ground #171a1d, ghost blocks (#262d38, blur 7 px, 42 %) and bokeh (#aeb6bf, blur 5 px, 28 %) drifting linearly the whole film; cards, chips, pills and amber buttons as bible §2; beat titles Serif Display 700 caps top inline-start; captions Thmanyah Sans 500 bottom inline-start.

### Arabic cut (mirroring)

AR: the popup is RTL (rows right-aligned, the Tools fold mirrored); in b6 the popup sits frame right and the page frame left; the scan line sweeps top to bottom (not mirrored, it is vertical) but finding pins appear right to left within a row; the stagger of tool rows reads from the right; the coverage meter fills right to left. Do NOT flip: the Toolshop page, LCP/CLS numbers, getByRole(...) code, "Next", 500, 1.7 s.

### Honesty

Tool labels are tools.*.label strings. Speed toast format is common.worker.toast.speed ("LCP {lcp}ms · CLS {cls} · Requests: {n}"); it is not Lighthouse and the doc says so (README feature 11). Dead click after 1.7 s is CHANGELOG 3.5.3 (DEAD_MS). The meter is "coverage of the seven ISTQB activities, never a score" (extension README). No claim of compliance or speed-up.


---

## Film 5. Yours, and Sealed / <span dir="rtl">عملك، مختوم</span> (`yours-sealed`)

- **Duration:** 47.0 s (16:9, 30 fps; a 9:16 re-layout shares every time). **Beats:** 9. **The light turns green at 5.6 s.**
- **Promise:** Your evidence stays on your machine, carries your name, and shows when anyone has changed it.
- **Feeling at the start:** Uneasy: a recording full of real names, cards and passwords.
- **Feeling at the end:** Trust with open eyes: masked, named, sealed, and honest about what a seal proves.
- **Arc:** Problem (coral, 0-5.0): a recording with real data drifting off. Turn at 5.6 s: the Asleep pill lands and the light goes green. Proof (10-39): masking, local-first, profile line, seal and verify, the seal's honest limits. Payoff (39-42): the same file, masked, named, intact. End card 42-47.
- **Bookend: frame 0 is a session file card with real values legible (an email, a card number, a password) drifting toward the frame edge in coral; the payoff (40.5) is the same card, values masked, the Prepared by line at its foot and a green INTACT stamp, held inside the browser frame.**
- **First frame:** Poster frame: a session file card with three legible fields (an email, a card number in groups of four, a password in plain text) drifts toward the inline-end edge (sine.inOut). **Last frame:** the QA Wrap lockup held centred with Download free (end card).

### Shots

| # | In-out s (key) | Size / angle / move | Focal point | What happens | On-screen EN | On-screen AR | Beat title EN / AR | Out |
|---|---|---|---|---|---|---|---|---|
| b1 | 0.0-5.0 (1.8) | MS, eye level, a slow drift toward the frame edge | the legible card number | Poster frame: a session file card with three legible fields (an email, a card number in groups of four, a password in plain text) drifts toward the inline-end edge (sine.inOut). Coral glow frame left. | layla@example.com · 4111 1111 1111 1111 · password: Spring2026 | <span dir="rtl">(field values stay Latin) layla@example.com · 4111 1111 1111 1111</span> | REAL **DATA** / <span dir="rtl">بيانات **حقيقية**</span> (coral) | a browser frame draws round the card and stops the drift |
| b2 | 5.0-10.0 (7.2) | MS on a browser window miniature, eye level | the Asleep pill | A browser window frame draws round the card (power2.inOut 0.6 s); the card stops. The popup's switch shows Asleep. Nothing is watched.; at 5.6 the light turns green. Lead move: a second window slides in beside it; it is woken alone (amber Wake up pressed), its pill flips to Awake in this window. while the first stays Asleep. | Asleep. Nothing is watched. · Wake up · Awake in this window. | <span dir="rtl">نائم. لا شيء يراقب. · شغله · مشغل في هذه النافذة.</span> | **ASLEEP** / <span dir="rtl">**نائم**</span> (green) | push-in on the awake window's form |
| b3 | 10.0-15.5 (12.8) | CU on the recorded form, push-in by scale 1.3x | the values turning to bullets | Lead move: the password and token values wipe to bullets (linear 0.5 s, inline direction). Amber Mask real data pressed; a solid block covers the name and email on the page. A counter Masked in this session ticks up. | •••••••• · Mask real data · Masked in this session | <span dir="rtl">•••••••• · أخف البيانات الحقيقية · ما أخفي في هذه الجلسة</span> | (none) | pull-out to the whole browser |
| b4 | 15.5-20.5 (17.8) | WS: the browser frame with the session inside | the one open door | Lead move: small arrows try to leave the browser frame and stop at its edge (each bounces, back.out). One amber button File to Jira is pressed and only then one arrow passes. The popup foot line Nothing leaves this browser. reads under it; a row What left this machine logs the one send (when, where, size). | Nothing leaves this browser. · File to Jira · What left this machine | <span dir="rtl">لا شيء يغادر هذا المتصفح. · ارفع إلى Jira · ما غادر هذا الجهاز</span> | STAYS **HERE** / <span dir="rtl">يبقى **هنا**</span> (green) | the camera rises to the top bar |
| b5 | 20.5-26.0 (23.4) | MS on the top bar, then down to an export's foot | the Prepared by line | The profile chip in the top bar: a picture and Layla Haddad; hover lifts the card with both names (Layla Haddad / ليلى حداد) and Edit profile. Lead move: the chip's name drops down the frame onto the foot of an exported file and types out the trace line (linear). | Profile · Layla Haddad · Edit profile · Prepared by Layla Haddad · 2026-11-10 · QA Wrap 3.9.1 | <span dir="rtl">الملف الشخصي · ليلى حداد · إعداد: ليلى حداد · 2026-11-10 · QA Wrap 3.9.1</span> | (none) | the file card turns into the sealed timeline |
| b6 | 26.0-32.0 (29.6) | MS on the file card, eye level | the stamps | The card becomes Timeline (sealed). Lead move: the seal block slams onto its foot (power4.in 0.4 s). Verify a sealed file: INTACT slams green. Then one letter in the text flips (a coral flash on that letter) and Verify runs again: ALTERED slams coral over the green. | Timeline (sealed) · Verify a sealed file · Intact. This file is unchanged since it was sealed. · ALTERED | <span dir="rtl">الخط الزمني (مختوم) · تحقق من ملف مختوم · سليم. لم يتغير هذا الملف منذ ختمه. · معدل</span> | **SEALED** / <span dir="rtl">**مختوم**</span> (green) | the stamp lifts away; the fingerprint row remains |
| b7 | 32.0-39.0 (35.6) | CU on the seal block, hold (the honest beat, no move) | the readable text under the seal | No lead flourish on purpose: the seal block sits under fully readable text (nothing hidden). The fingerprint row types in; a second file with the same name shows a different fingerprint and the line This is not the key of this QA Wrap install. One slow push-in only (power2.inOut 2.0 s). | Key fingerprint: 3f9a 51c2 … · This is not the key of this QA Wrap install | <span dir="rtl">بصمة المفتاح: 3f9a 51c2 … · هذا ليس مفتاح نسخة QA Wrap هذه</span> | WHAT IT **IS NOT** / <span dir="rtl">حدود **الختم**</span> (amber) | the card slides back into the browser frame |
| b8 | 39.0-42.0 (40.5) | MS of the file card inside the browser (rhymes with frame 0) | the green INTACT stamp | Bookend: the b1 card again, now masked, with its Prepared by line, the seal block and INTACT; it no longer drifts. | Intact · Prepared by Layla Haddad | <span dir="rtl">سليم · إعداد: ليلى حداد</span> | (none) | all objects drain to centre |
| b9 | 42.0-47.0 (44.5) | MS centred, eye level, hold (the stable end) | the green Download free button | Everything on stage drains to the centre and becomes the QA Wrap mark (graphic match); the mark draws its check (power2.out 0.6 s), the lockup settles (back.out 1.4), maker line, the Free · MIT · English and Arabic pills arrive (back.out 2, staggered 0.08 s), Download free pops last. Ghosts and bokeh keep drifting. | QA Wrap · Made by Nader Alzghoul (NJ-Burrito) · Free · MIT · English and Arabic · Download free | <span dir="rtl">QA Wrap · من صنع نادر الزغول (NJ-Burrito) · مجاني · MIT · عربي وإنجليزي · احصل عليه مجانا</span> | (none) | end (last frame = the lockup, held) |

### Captions

| # | Window s | EN caption | AR caption (unvowelled) | EN w | AR w |
|---|---|---|---|---|---|
| 1 | 0.40-2.20 | A test recording holds | <span dir="rtl">تسجيل الاختبار يحمل</span> | 4 | 3 |
| 2 | 2.20-4.80 | real names, cards and passwords. | <span dir="rtl">أسماء حقيقية وبطاقات وكلمات مرور.</span> | 5 | 5 |
| 3 | 5.30-7.20 | QA Wrap sleeps | <span dir="rtl">QA Wrap نائم</span> | 3 | 3 |
| 4 | 7.20-8.60 | until you wake it, | <span dir="rtl">حتى توقظه،</span> | 4 | 2 |
| 5 | 8.60-9.80 | window by window. | <span dir="rtl">نافذة بنافذة.</span> | 3 | 2 |
| 6 | 10.30-12.60 | Passwords and tokens are removed. | <span dir="rtl">كلمات المرور والرموز تحذف،</span> | 5 | 4 |
| 7 | 12.60-15.30 | Mask real data covers the rest. | <span dir="rtl">و«أخف البيانات الحقيقية» تغطي الباقي.</span> | 6 | 5 |
| 8 | 15.80-18.00 | Nothing leaves your browser | <span dir="rtl">لا شيء يغادر متصفحك</span> | 4 | 4 |
| 9 | 18.00-20.30 | until you press send. | <span dir="rtl">حتى تضغط زر الإرسال.</span> | 4 | 4 |
| 10 | 20.80-23.20 | Your profile ends every export | <span dir="rtl">ملفك الشخصي يذيل كل تصدير</span> | 5 | 5 |
| 11 | 23.20-25.80 | with one line: name, date, version. | <span dir="rtl">بسطر: الاسم والتاريخ والإصدار.</span> | 6 | 4 |
| 12 | 26.30-28.00 | Seal the timeline. | <span dir="rtl">اختم الخط الزمني.</span> | 3 | 3 |
| 13 | 28.00-29.60 | Change one letter, | <span dir="rtl">غير حرفا واحدا،</span> | 3 | 3 |
| 14 | 29.60-31.80 | and Verify says altered. | <span dir="rtl">فيقول التحقق: معدل.</span> | 4 | 3 |
| 15 | 32.30-34.00 | The seal hides nothing | <span dir="rtl">الختم لا يخفي شيئا</span> | 4 | 4 |
| 16 | 34.00-36.00 | and proves no identity: | <span dir="rtl">ولا يثبت الهوية؛</span> | 4 | 3 |
| 17 | 36.00-38.80 | only that nothing changed. | <span dir="rtl">يثبت أن الملف لم يتغير.</span> | 4 | 5 |
| 18 | 39.20-40.60 | Your evidence. Your name. | <span dir="rtl">دليلك، باسمك،</span> | 4 | 2 |
| 19 | 40.60-41.90 | Still intact. | <span dir="rtl">وسليم تماما.</span> | 2 | 2 |
| 20 | 42.60-44.30 | QA Wrap. | <span dir="rtl">QA Wrap،</span> | 2 | 2 |
| 21 | 44.30-46.10 | Free and open source. | <span dir="rtl">مجاني ومفتوح المصدر.</span> | 4 | 3 |

### Voice lines

| V# | Start s | Captions | EN voice | AR voice (unvowelled) | AR TTS text (full tashkeel) |
|---|---|---|---|---|---|
| V1 | 0.30 | 1, 2 | A test recording holds real names, cards and passwords. | <span dir="rtl">تسجيل الاختبار يحمل أسماء حقيقية وبطاقات وكلمات مرور.</span> | <span dir="rtl">تَسْجِيلُ الِاخْتِبَارِ يَحْمِلُ أَسْمَاءً حَقِيقِيَّةً وَبِطَاقَاتٍ وَكَلِمَاتِ مُرُورٍ.</span> |
| V2 | 5.20 | 3, 4, 5 | QA Wrap sleeps until you wake it, window by window. | <span dir="rtl">QA Wrap نائم حتى توقظه، نافذة بنافذة.</span> | <span dir="rtl">QA Wrap نَائِمٌ حَتَّى تُوقِظَهُ، نَافِذَةً بِنَافِذَةٍ.</span> |
| V3 | 10.20 | 6, 7 | Passwords and tokens are removed. Mask real data covers the rest. | <span dir="rtl">كلمات المرور والرموز تحذف، و«أخف البيانات الحقيقية» تغطي الباقي.</span> | <span dir="rtl">كَلِمَاتُ الْمُرُورِ وَالرُّمُوزُ تُحْذَفُ، وَ«أَخْفِ الْبَيَانَاتِ الْحَقِيقِيَّةَ» تُغَطِّي الْبَاقِيَ.</span> |
| V4 | 15.70 | 8, 9 | Nothing leaves your browser until you press send. | <span dir="rtl">لا شيء يغادر متصفحك حتى تضغط زر الإرسال.</span> | <span dir="rtl">لَا شَيْءَ يُغَادِرُ مُتَصَفِّحَكَ حَتَّى تَضْغَطَ زِرَّ الْإِرْسَالِ.</span> |
| V5 | 20.70 | 10, 11 | Your profile ends every export with one line: name, date, version. | <span dir="rtl">ملفك الشخصي يذيل كل تصدير بسطر: الاسم والتاريخ والإصدار.</span> | <span dir="rtl">مِلَفُّكَ الشَّخْصِيُّ يُذَيِّلُ كُلَّ تَصْدِيرٍ بِسَطْرٍ: الِاسْمُ وَالتَّارِيخُ وَالْإِصْدَارُ.</span> |
| V6 | 26.20 | 12, 13, 14 | Seal the timeline. Change one letter, and Verify says altered. | <span dir="rtl">اختم الخط الزمني. غير حرفا واحدا، فيقول التحقق: معدل.</span> | <span dir="rtl">اخْتِمِ الْخَطَّ الزَّمَنِيَّ. غَيِّرْ حَرْفًا وَاحِدًا، فَيَقُولَ التَّحَقُّقُ: مُعَدَّلٌ.</span> |
| V7 | 32.20 | 15, 16, 17 | The seal hides nothing and proves no identity: only that nothing changed. | <span dir="rtl">الختم لا يخفي شيئا ولا يثبت الهوية؛ يثبت أن الملف لم يتغير.</span> | <span dir="rtl">الْخَتْمُ لَا يُخْفِي شَيْئًا وَلَا يُثْبِتُ الْهُوِيَّةَ؛ يُثْبِتُ أَنَّ الْمِلَفَّ لَمْ يَتَغَيَّرْ.</span> |
| V8 | 39.10 | 18, 19 | Your evidence. Your name. Still intact. | <span dir="rtl">دليلك، باسمك، وسليم تماما.</span> | <span dir="rtl">دَلِيلُكَ، بِاسْمِكَ، وَسَلِيمٌ تَمَامًا.</span> |
| V9 | 42.50 | 20, 21 | QA Wrap. Free and open source. | <span dir="rtl">QA Wrap، مجاني ومفتوح المصدر.</span> | <span dir="rtl">QA Wrap، مَجَّانِيٌّ وَمَفْتُوحُ الْمَصْدَرِ.</span> |

### Fit (EN 150 wpm, AR 115 wpm; window = voice start to the end of its last caption)

| V# | EN words | AR words | Window s | EN needs s | AR needs s | EN slack | AR slack |
|---|---|---|---|---|---|---|---|
| V1 | 9 | 8 | 4.50 | 3.60 | 4.17 | 0.90 | 0.33 |
| V2 | 10 | 7 | 4.60 | 4.00 | 3.65 | 0.60 | 0.95 |
| V3 | 11 | 9 | 5.10 | 4.40 | 4.70 | 0.70 | 0.40 |
| V4 | 8 | 8 | 4.60 | 3.20 | 4.17 | 1.40 | 0.43 |
| V5 | 11 | 9 | 5.10 | 4.40 | 4.70 | 0.70 | 0.40 |
| V6 | 10 | 9 | 5.60 | 4.00 | 4.70 | 1.60 | 0.90 |
| V7 | 12 | 12 | 6.60 | 4.80 | 6.26 | 1.80 | 0.34 |
| V8 | 6 | 4 | 2.80 | 2.40 | 2.09 | 0.40 | 0.71 |
| V9 | 6 | 5 | 3.60 | 2.40 | 2.61 | 1.20 | 0.99 |

### Voice

- **Style:** `story` (same for EN and AR). Why: good_for: "Brand story, founder or mission narration ... about-us films": this is the product's promise (local-first, honest seal) told as its mission.
- Registry direction, byte-exact, not edited: "Say this warmly and confidently, with more emotion and feeling, like a storyteller who cares about the story: "
- **Act 1, 0-5.0:** quiet and concerned, slower; "passwords" / كلمات مرور lands low.
- **Turn, 5.2-10:** reassuring warmth, a little brighter; QA Wrap clear, exactly as in English.
- **Proof, 10.2-32:** steady confidence; stress the guarantee words: removed / تحذف, Nothing leaves / لا شيء يغادر, altered / معدل.
- **Honest beat, 32.2-39:** the most careful line of the film: even, unhurried, no smile on "proves no identity" / ولا يثبت الهوية; this is said as a fact, not a disclaimer.
- **Payoff and end, 39.2-47:** warm, a feeling of ownership; no rising sell.
- Continuous read: each voice line runs through its caption changes; breaths of 0.4 s or more only between voice lines. One take per line; no speed-up is planned (every line fits at 150 / 115 wpm).

### Sound

| Time s | Cue | Hits |
|---|---|---|
| 0.3 | swish | the card begins its drift |
| 5.1 | swish | the browser frame draws |
| 5.6 | reveal | Asleep lands (the turn) |
| 8.0 | tick | Wake up pressed |
| 10.6 | swish | values wipe to bullets |
| 12.8 | tick | Mask real data pressed |
| 16.2 | tick | arrows stop at the frame (one tick on the first bounce only) |
| 18.2 | tick | File to Jira pressed |
| 21.4 | swish | hover card lifts |
| 26.6 | sting | the seal block slams |
| 27.6 | success | INTACT |
| 30.8 | sting | ALTERED slams |
| 40.0 | success | INTACT on the bookend |
| 42.6 | logo | the mark draws its check |

- **Bed:** `extension/tools/film/audio/bed.py`, 120 bpm (2.0 s a bar), A Dorian, 24 bars, same seed family as `qa-wrap-40`. Sections: intro bars 1-2 (0-4 s): pluck + 8th hats, no low end; drive bars 3-16 (4-32 s): kick + bass + 16th hats; intro bars 17-19 (32-38 s): the honest beat: back to pluck + hats, no kick (32-38 s), so the line sits in a quieter bed; lift bars 20-20 (38-40 s): plucks up an octave into the payoff; out bars 21-24 (40-48 s): single hit, ring out under the end card. Reverse swell ending at 42.0 s into the end card. Tail fade from 46.0 s.
- **The one deliberate silence:** 31.9-32.2 s, held at -75 dBFS in the mix (bed and SFX out), as the commercial's 9.5-10.0.
- Levels as the bible §5: voice -13 to -20 dBFS, bed at least 10 dB under the voice, no clipping. SFX are only the six existing cues (`work/film/audio/out/sfx/sfx.json`).

### VFX

- **Act 1 (0-5.6):** coral key glow frame left; the drifting card leaves a faint coral trail.
- **Turn (5.6):** green glow rises frame right as the Asleep pill lands; the browser frame edge gets a thin green rim.
- **Proof (10-32):** green key behind the focal object; masking bullets carry no glow; in b6 the ALTERED stamp is the beat's coral hero, the INTACT stamp before it green.
- **Honest beat (32-39):** dim everything except the seal block to 50 %; no bloom, no flourish; grain unchanged.
- **Payoff (39-42):** green glow centred behind the card; the INTACT stamp blooms 0.2 s.
- Always: basalt ground #171a1d, ghost blocks (#262d38, blur 7 px, 42 %) and bokeh (#aeb6bf, blur 5 px, 28 %) drifting linearly the whole film; cards, chips, pills and amber buttons as bible §2; beat titles Serif Display 700 caps top inline-start; captions Thmanyah Sans 500 bottom inline-start.

### Arabic cut (mirroring)

AR: the card drifts toward the left edge; windows sit right (first) and left (second); the bullet wipe runs right to left; arrows try to leave by every edge (no direction); the name drops from the top-bar chip at the inline end (left in AR) onto the export foot; the trace line types right to left with the Latin parts isolated. Do NOT flip: field values (emails, card numbers), the fingerprint hex, 2026-11-10, QA Wrap 3.9.1, the English Latin runs inside verify strings.

### Honesty

The seal film states both limits aloud: it hides nothing and does not prove identity (CHANGELOG 3.9.0, README "What the seal is, and is not"). Masking claims: README Privacy ("Passwords, tokens and similar values are removed"); Mask real data is tools.mask.label. Trace line format is core/profile.js traceLine. "Nothing leaves this browser." is popup.foot.noSpill; the update check is the one automatic request and is not shown as leaving (it carries no data); the doc does not claim zero network. Card number 4111... is the public test card, not real data.


---

## Film 6. Your Language, Your Numbers, Your Agent / <span dir="rtl">بلغتك، وبأرقامك، ومع وكيلك</span> (`your-way`)

- **Duration:** 40.0 s (16:9, 30 fps; a 9:16 re-layout shares every time). **Beats:** 7. **The light turns green at 6.2 s.**
- **Promise:** QA Wrap fits the way you work: in Arabic or English, with your own numbers, beside your coding agent, learned by playing.
- **Feeling at the start:** Out of place: an Arabic note squeezed into a tool that only reads left to right.
- **Feeling at the end:** At home: the tool turns to your language, counts your work, talks to your agent.
- **Arc:** Problem (coral, 0-5.0): an Arabic note broken in a left-to-right card. Turn at 6.2 s: the language pill flips and the card mirrors; light green. Proof (11-29): KPI dashboard, agent bridge, Bug Hunt. Payoff (29-34.5): the same card, at home, with its new companions. End card 34.5-40.
- **Bookend + graphic match: frame 0 is a note card with an Arabic line broken by left-to-right layout (coral); at 6.2 the card flips like a page and comes back mirrored (graphic match); the payoff (31.5) is the same card, Arabic reading right to left, with three companion chips orbiting it.**
- **First frame:** Poster frame: a note card laid out left to right; an Arabic line in it sits left-aligned with its full stop on the wrong side and the Latin word API pushed to the wrong end (coral underline). **Last frame:** the QA Wrap lockup held centred with Download free (end card).

### Shots

| # | In-out s (key) | Size / angle / move | Focal point | What happens | On-screen EN | On-screen AR | Beat title EN / AR | Out |
|---|---|---|---|---|---|---|---|---|
| b1 | 0.0-5.0 (1.8) | MS, eye level, hold | the broken Arabic line | Poster frame: a note card laid out left to right; an Arabic line in it sits left-aligned with its full stop on the wrong side and the Latin word API pushed to the wrong end (coral underline). Coral glow frame left. | (the broken line, in Arabic) API | <span dir="rtl">زر الدفع لا يستجيب بعد طلب API.</span> | **WRONG** WAY / <span dir="rtl">الاتجاه **الخطأ**</span> (coral) | a language pill rises under the card |
| b2 | 5.0-11.0 (8.4) | MS, then a slight pull-out as the card mirrors | the card mid-flip | A pill English · العربية; العربية pressed (amber) at 5.8. Lead move at 6.2: the card flips on its vertical axis (power2.inOut 0.8 s) and lands mirrored: the line reads right to left, the full stop at the end, API isolated in its own order; the popup behind it mirrors too (rows right-aligned). Light turns green at 6.2. | English · العربية · Start recording / ابدأ التسجيل | <span dir="rtl">English · العربية · ابدأ التسجيل · زر الدفع لا يستجيب بعد طلب API.</span> | BOTH **WAYS** / <span dir="rtl">في **الاتجاهين**</span> (green) | the card shrinks to the corner; a dashboard rises |
| b3 | 11.0-17.0 (14.0) | WS of the Performance indicators card, low angle (your work made big) | the Time testing tile | The dashboard card rises (back.out 1.4) with the eyebrow YOUR OWN WORK. Lead move: four tiles count up (linear 1.0 s): Time testing 6 h 40 min, Sessions 14, Pages tested 18 of 24 pages, Bugs filed 9. Under them one bar chart Time spent testing per day grows bar by bar. Export as PDF sits in the corner. No severity chart, no trend arrows. | YOUR OWN WORK · Performance indicators · Time testing 6 h 40 min · Sessions 14 · Pages tested 18 of 24 pages · Bugs filed 9 · Time spent testing per day · Export as PDF | <span dir="rtl">عملك أنت · مؤشرات الأداء · وقت الاختبار 6 س 40 د · الجلسات 14 · الصفحات المختبرة 18 من 24 صفحة · الخلل المسجل 9 · الوقت المستغرق في الاختبار يوميا · تصدير بصيغة PDF</span> | YOUR OWN **WORK** / <span dir="rtl">**عملك** أنت</span> (green) | the dashboard slides away; a settings toggle arrives |
| b4 | 17.0-23.0 (20.2) | MS: toggle left, agent chip right, a dotted line between | the read-only lock on the line | The Agent bridge toggle flips on (amber press) and reads On. Connected to the helper. Lead move: a dotted line draws from the toggle to a generic coding-agent chip (no logo) through a small helper chip labelled qa-wrap-bridge; a request get_failures travels along it and a short list of failures returns. A lock with read only sits on the line; there is no arrow back into QA Wrap. | Agent bridge · On. Connected to the helper. · qa-wrap-bridge · get_failures · read only | <span dir="rtl">جسر الوكيل · مفعل. متصل بالبرنامج المساعد. · qa-wrap-bridge · get_failures · للقراءة فقط</span> | READ **ONLY** / <span dir="rtl">للقراءة **فقط**</span> (green) | the agent chip shrinks; a game card pops |
| b5 | 23.0-29.0 (26.4) | MS on a game card, eye level | the Bug caught badge | The Bug Hunt card pops (back.out 2): Level 3 of 5 · Dead button, goal Press Next. Nothing happens? Note it. The cursor presses Next; nothing; a note is typed; lead move: Bug caught slams green (power4.in 0.3 s); a sticker flies to the corner. | Bug Hunt · Level 3 of 5 · Dead button · Press Next. Nothing happens? Note it. · Bug caught | <span dir="rtl">صيد الأخطاء · المستوى 3 من 5 · زر ميت · اضغط التالي. لم يحدث شيء؟ دون ذلك. · اصطدت الخطأ</span> | **BUG HUNT** / <span dir="rtl">**صيد الأخطاء**</span> (green) | the game card joins the note card |
| b6 | 29.0-34.5 (31.6) | MS of the note card (rhymes with frame 0) | the Arabic line, now right to left | Bookend: the b1 card in the same place, the Arabic line correct; three chips (the KPI tile, the agent chip, the game sticker) settle around it on arcs (back.out 1.4). | العربية · Performance indicators · Agent bridge · Bug Hunt | <span dir="rtl">زر الدفع لا يستجيب بعد طلب API. · مؤشرات الأداء · جسر الوكيل · صيد الأخطاء</span> | (none) | all objects drain to centre |
| b7 | 34.5-40.0 (37.0) | MS centred, eye level, hold (the stable end) | the green Download free button | Everything on stage drains to the centre and becomes the QA Wrap mark (graphic match); the mark draws its check (power2.out 0.6 s), the lockup settles (back.out 1.4), maker line, the Free · MIT · English and Arabic pills arrive (back.out 2, staggered 0.08 s), Download free pops last. Ghosts and bokeh keep drifting. | QA Wrap · Made by Nader Alzghoul (NJ-Burrito) · Free · MIT · English and Arabic · Download free | <span dir="rtl">QA Wrap · من صنع نادر الزغول (NJ-Burrito) · مجاني · MIT · عربي وإنجليزي · احصل عليه مجانا</span> | (none) | end (last frame = the lockup, held) |

### Captions

| # | Window s | EN caption | AR caption (unvowelled) | EN w | AR w |
|---|---|---|---|---|---|
| 1 | 0.40-2.20 | You write in Arabic. | <span dir="rtl">تكتب بالعربية،</span> | 4 | 2 |
| 2 | 2.20-4.80 | The tool reads left to right. | <span dir="rtl">والأداة تقرأ من اليسار إلى اليمين.</span> | 6 | 6 |
| 3 | 5.30-7.20 | QA Wrap speaks | <span dir="rtl">QA Wrap يتحدث</span> | 3 | 3 |
| 4 | 7.20-8.60 | Arabic and English. | <span dir="rtl">العربية والإنجليزية،</span> | 3 | 2 |
| 5 | 8.60-10.80 | The whole screen turns with you. | <span dir="rtl">والشاشة كلها تتبعك.</span> | 6 | 3 |
| 6 | 11.30-12.60 | Your own numbers: | <span dir="rtl">أرقامك أنت:</span> | 3 | 2 |
| 7 | 12.60-15.00 | time testing, coverage, bugs filed, | <span dir="rtl">وقت الاختبار والتغطية والخلل المسجل،</span> | 5 | 5 |
| 8 | 15.00-16.80 | on your device. | <span dir="rtl">على جهازك.</span> | 3 | 2 |
| 9 | 17.30-19.00 | Turn on Agent bridge: | <span dir="rtl">فعل جسر الوكيل،</span> | 4 | 3 |
| 10 | 19.00-21.20 | your coding agent reads your sessions, | <span dir="rtl">فيقرأ وكيل البرمجة جلساتك،</span> | 6 | 4 |
| 11 | 21.20-22.80 | read only. | <span dir="rtl">للقراءة فقط.</span> | 2 | 2 |
| 12 | 23.30-24.60 | New to it? | <span dir="rtl">جديد عليك؟</span> | 3 | 2 |
| 13 | 24.60-26.60 | Bug Hunt teaches it | <span dir="rtl">لعبة صيد الأخطاء تعلمك الأداة</span> | 4 | 5 |
| 14 | 26.60-28.80 | in five levels. | <span dir="rtl">في خمسة مستويات.</span> | 3 | 3 |
| 15 | 29.30-31.40 | Your language. Your numbers. | <span dir="rtl">لغتك، أرقامك،</span> | 4 | 2 |
| 16 | 31.40-34.30 | Your agent. One tool. | <span dir="rtl">وكيلك، في أداة واحدة.</span> | 4 | 4 |
| 17 | 35.10-36.80 | QA Wrap. | <span dir="rtl">QA Wrap،</span> | 2 | 2 |
| 18 | 36.80-38.60 | Free and open source. | <span dir="rtl">مجاني ومفتوح المصدر.</span> | 4 | 3 |

### Voice lines

| V# | Start s | Captions | EN voice | AR voice (unvowelled) | AR TTS text (full tashkeel) |
|---|---|---|---|---|---|
| V1 | 0.30 | 1, 2 | You write in Arabic. The tool reads left to right. | <span dir="rtl">تكتب بالعربية، والأداة تقرأ من اليسار إلى اليمين.</span> | <span dir="rtl">تَكْتُبُ بِالْعَرَبِيَّةِ، وَالْأَدَاةُ تَقْرَأُ مِنَ الْيَسَارِ إِلَى الْيَمِينِ.</span> |
| V2 | 5.20 | 3, 4, 5 | QA Wrap speaks Arabic and English. The whole screen turns with you. | <span dir="rtl">QA Wrap يتحدث العربية والإنجليزية، والشاشة كلها تتبعك.</span> | <span dir="rtl">QA Wrap يَتَحَدَّثُ الْعَرَبِيَّةَ وَالْإِنْجِلِيزِيَّةَ، وَالشَّاشَةُ كُلُّهَا تَتْبَعُكَ.</span> |
| V3 | 11.20 | 6, 7, 8 | Your own numbers: time testing, coverage, bugs filed, on your device. | <span dir="rtl">أرقامك أنت: وقت الاختبار والتغطية والخلل المسجل، على جهازك.</span> | <span dir="rtl">أَرْقَامُكَ أَنْتَ: وَقْتُ الِاخْتِبَارِ وَالتَّغْطِيَةُ وَالْخَلَلُ الْمُسَجَّلُ، عَلَى جِهَازِكَ.</span> |
| V4 | 17.20 | 9, 10, 11 | Turn on Agent bridge: your coding agent reads your sessions, read only. | <span dir="rtl">فعل جسر الوكيل، فيقرأ وكيل البرمجة جلساتك، للقراءة فقط.</span> | <span dir="rtl">فَعِّلْ جِسْرَ الْوَكِيلِ، فَيَقْرَأَ وَكِيلُ الْبَرْمَجَةِ جَلَسَاتِكَ، لِلْقِرَاءَةِ فَقَطْ.</span> |
| V5 | 23.20 | 12, 13, 14 | New to it? Bug Hunt teaches it in five levels. | <span dir="rtl">جديد عليك؟ لعبة صيد الأخطاء تعلمك الأداة في خمسة مستويات.</span> | <span dir="rtl">جَدِيدٌ عَلَيْكَ؟ لُعْبَةُ صَيْدِ الْأَخْطَاءِ تُعَلِّمُكَ الْأَدَاةَ فِي خَمْسَةِ مُسْتَوَيَاتٍ.</span> |
| V6 | 29.20 | 15, 16 | Your language. Your numbers. Your agent. One tool. | <span dir="rtl">لغتك، أرقامك، وكيلك، في أداة واحدة.</span> | <span dir="rtl">لُغَتُكَ، أَرْقَامُكَ، وَكِيلُكَ، فِي أَدَاةٍ وَاحِدَةٍ.</span> |
| V7 | 35.00 | 17, 18 | QA Wrap. Free and open source. | <span dir="rtl">QA Wrap، مجاني ومفتوح المصدر.</span> | <span dir="rtl">QA Wrap، مَجَّانِيٌّ وَمَفْتُوحُ الْمَصْدَرِ.</span> |

### Fit (EN 150 wpm, AR 115 wpm; window = voice start to the end of its last caption)

| V# | EN words | AR words | Window s | EN needs s | AR needs s | EN slack | AR slack |
|---|---|---|---|---|---|---|---|
| V1 | 10 | 8 | 4.50 | 4.00 | 4.17 | 0.50 | 0.33 |
| V2 | 12 | 8 | 5.60 | 4.80 | 4.17 | 0.80 | 1.43 |
| V3 | 11 | 9 | 5.60 | 4.40 | 4.70 | 1.20 | 0.90 |
| V4 | 12 | 9 | 5.60 | 4.80 | 4.70 | 0.80 | 0.90 |
| V5 | 10 | 10 | 5.60 | 4.00 | 5.22 | 1.60 | 0.38 |
| V6 | 8 | 6 | 5.10 | 3.20 | 3.13 | 1.90 | 1.97 |
| V7 | 6 | 5 | 3.60 | 2.40 | 2.61 | 1.20 | 0.99 |

### Voice

- **Style:** `reel` (same for EN and AR). Why: good_for: "Social reels, short promos, teasers, launch clips under about 60 s": four quick promises in one upbeat promo.
- Registry direction, byte-exact, not edited: "Say this warmly and confidently with a smile in your voice, with more energy and a lively, upbeat pace, like a friendly expert sharing exciting news: "
- **Act 1, 0-5.0:** a wry, knowing tone; "left to right" / من اليسار إلى اليمين with a small drop.
- **Turn, 5.2-11:** bright lift; العربية والإنجليزية / Arabic and English said with pride, not speed.
- **Proof, 11.2-29:** upbeat; stress each owned noun: your own / أنت, read only / للقراءة فقط, five levels / خمسة مستويات.
- **Payoff and end, 29.2-40:** warm, rhythmic list of three with a settled "One tool" / في أداة واحدة; no rising sell.
- Continuous read: each voice line runs through its caption changes; breaths of 0.4 s or more only between voice lines. One take per line; no speed-up is planned (every line fits at 150 / 115 wpm).

### Sound

| Time s | Cue | Hits |
|---|---|---|
| 0.3 | tick | the coral underline lands |
| 5.3 | tick | language pill rises |
| 5.8 | tick | العربية pressed |
| 6.2 | reveal | the card flips (the turn) |
| 11.3 | swish | dashboard rises |
| 12.4 | tick | tiles count up (one tick at the end) |
| 17.6 | tick | Agent bridge toggled |
| 18.4 | swish | the dotted line draws |
| 23.3 | tick | game card pops |
| 26.0 | sting | Bug caught slams |
| 30.0 | success | companion chips settle |
| 35.1 | logo | the mark draws its check |

- **Bed:** `extension/tools/film/audio/bed.py`, 120 bpm (2.0 s a bar), A Dorian, 20 bars, same seed family as `qa-wrap-40`. Sections: intro bars 1-2 (0-4 s): pluck + 8th hats, no low end; drive bars 3-16 (4-32 s): kick + bass + 16th hats from the flip; lift bars 17-17 (32-34 s): plucks up an octave; out bars 18-20 (34-40 s): single hit, ring out under the end card. Reverse swell ending at 34.5 s into the end card. Tail fade from 39.0 s.
- **Silence:** none planned; the bed carries every beat change.
- Levels as the bible §5: voice -13 to -20 dBFS, bed at least 10 dB under the voice, no clipping. SFX are only the six existing cues (`work/film/audio/out/sfx/sfx.json`).

### VFX

- **Act 1 (0-6.2):** coral key glow frame left; the broken line's underline is the only coral.
- **Turn (6.2):** green glow rises as the card lands mirrored; a soft light sweep crosses the card during the flip.
- **Proof (11-29):** green key behind each focal card; KPI tiles carry no coral or green verdict colours (numbers only, neutral ink); the read-only lock is amber-free (neutral ink).
- **Payoff (29-34.5):** green glow centred behind the note card.
- Always: basalt ground #171a1d, ghost blocks (#262d38, blur 7 px, 42 %) and bokeh (#aeb6bf, blur 5 px, 28 %) drifting linearly the whole film; cards, chips, pills and amber buttons as bible §2; beat titles Serif Display 700 caps top inline-start; captions Thmanyah Sans 500 bottom inline-start.

### Arabic cut (mirroring)

AR: the whole film is mirrored as usual EXCEPT b1-b2, whose subject is direction: in BOTH cuts the broken card in b1 is left-to-right and the fixed card in b2 is right-to-left (the content is the Arabic line); only the surrounding layout (card position, title side, caption side) mirrors. KPI bars grow right to left in AR; the bridge line draws from the toggle at the inline start; the game card is RTL. Do NOT flip: API, qa-wrap-bridge, get_failures, 6 h 40 min digits, 18 of 24 in their isolates.

### Honesty

KPI shows only tiles and a time-per-day chart: no Bugs by severity chart and no trend verdict (per the director's brief), and every figure is the KPI's own format (kpi.dur.hm, kpi.tile.coverageSub). It is labelled YOUR OWN WORK, counted on this device; no claim about users. The bridge is read-only with four tools (helper/README); it is off until turned on. Bug Hunt: "Learn QA Wrap in 5 quick levels" (game strings), inside the extension since 3.5.3. Illustrative counts (6 h 40 min, 14, 18 of 24, 9) are a drawn example, consistent with each other.


---

## Shared end card (all six films)

The last beat of every film: everything drains to the centre and becomes the QA Wrap mark (graphic match), the mark draws its check, the lockup settles; then **Made by Nader Alzghoul (NJ-Burrito)** / <span dir="rtl">من صنع نادر الزغول (NJ-Burrito)</span>, the pills **Free · MIT · English and Arabic** / <span dir="rtl">مجاني · MIT · عربي وإنجليزي</span>, and the green button **Download free** / <span dir="rtl">احصل عليه مجانا</span> (the commercial's end-card strings). Voice: "QA Wrap. Free and open source." / <span dir="rtl">QA Wrap، مجاني ومفتوح المصدر.</span> Product name (common.md rule 12, Nader 2026-11-10): in the Arabic narration the name is pronounced exactly as in English, and the AR TTS text carries the Latin `QA Wrap` with full tashkeel on the Arabic words around it; Arabic captions and titles show the name only in Latin, `QA Wrap`, isolated, with no Arabic spelling and no bracket gloss. Fit tables count `QA Wrap` as 2 words in both languages. The last frame is the held lockup.

## Rules every builder keeps

1. EN and AR of a pair share every time in these tables; only direction, captions and narration change.
2. Arabic on screen: the product name only as Latin `QA Wrap` (isolated); no tashkeel, no tatweel, no Persian letters, Arabic punctuation, Western digits, every Latin run (QA Wrap, Jira, API, 500, 00:41, QA Wrap 3.9.1) in `unicode-bidi: isolate`.
3. Captions swap cleanly: the old line is fully out before the new one is readable (bible §7 flaw 1).
4. A voice line starts 0-0.25 s before its first caption and runs through its caption changes; the fit tables are at 150 / 115 wpm with no speed-up planned.
5. Fonts: Thmanyah only; titles Serif Display 700, captions Sans 500, UI labels Sans 700-900, numbers Serif Text 500.
6. 9:16 is a re-layout (world about 0.66, captions near 66 % height), never a crop.

## Self-check

| Film | Duration s | Beats | Captions | Voice lines | EN words | AR words | Min slack EN s | Min slack AR s | Style |
|---|---|---|---|---|---|---|---|---|---|
| every-moment | 42.0 | 8 | 17 | 8 | 74 | 57 | 0.60 | 0.43 | story |
| one-report | 42.0 | 8 | 20 | 8 | 68 | 56 | 1.00 | 0.43 | reel |
| show-it | 40.0 | 7 | 18 | 7 | 69 | 52 | 0.40 | 0.35 | reel |
| the-toolbox | 43.0 | 8 | 18 | 8 | 73 | 60 | 0.30 | 0.38 | reel |
| yours-sealed | 47.0 | 9 | 21 | 9 | 83 | 71 | 0.40 | 0.33 | story |
| your-way | 40.0 | 7 | 18 | 7 | 69 | 55 | 0.50 | 0.33 | reel |

Checks run by `build.py` on every film (both languages): duration 35-50 s; 6-10 contiguous beats; every caption at most 6 words, at least 0.3 s per word, inside one beat, no overlap; EN and AR captions concatenate to their voice line exactly (the (QA Wrap) gloss aside); each voice line starts 0-0.25 s before its first caption; every line fits its window at 150 / 115 wpm (slack >= 0); at least 0.4 s breath between voice lines at the planned rate; the last line ends at least 0.5 s before the film ends; no em dash; AR screen strings have no tashkeel, tatweel, Persian letters, Arabic-Indic digits or Latin , ; ? beside Arabic.

Failures:

- none: every check passed

## Narration manifest gate

`PYTHONUTF8=1 python C:\Users\ACER\Desktop\nj-plugin\skills\nj-writer\scripts\voice_style_gate.py work/film/brand/narration-manifest.json` results are recorded below by the build run (full mode needs measured seconds, which exist only after voicing; `--text-only` checks style, direction, full tashkeel, case endings and letter alignment now).

Text-only mode (`--text-only`, 94 lines = 47 EN + 47 AR), after common.md rule 12 (Latin `QA Wrap` in the AR TTS text):

```
FAIL: line every-moment-V8-ar: tts_text has 3 words, visible text 3
FAIL: line one-report-V8-ar: tts_text has 3 words, visible text 3
FAIL: line show-it-V7-ar: tts_text has 3 words, visible text 3
FAIL: line the-toolbox-V2-ar: tts_text has 6 words, visible text 6
FAIL: line the-toolbox-V8-ar: tts_text has 3 words, visible text 3
FAIL: line yours-sealed-V2-ar: tts_text has 5 words, visible text 5
FAIL: line yours-sealed-V9-ar: tts_text has 3 words, visible text 3
FAIL: line your-way-V2-ar: tts_text has 6 words, visible text 6
FAIL: line your-way-V7-ar: tts_text has 3 words, visible text 3
RESULT: FAIL (9 fail)
```

These 9 failures are the gate's letter-alignment rule (R-TASHKEEL-008): a visible Latin token must be matched by Arabic-spelled words in tts_text, so a Latin `QA Wrap` inside tts_text is counted as missing. Not worked around (no transliteration), per the Director's instruction; the gate or the rule needs a decision. Every other check (style, direction, full tashkeel, case endings) passes on all 94 lines.

Full mode (as first briefed), last line; it also lacks measured seconds until voicing:

```
RESULT: FAIL (103 fail)
```
