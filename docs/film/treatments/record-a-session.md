# Treatment: Tutorial 1, record-a-session (Record a session / سجل جلسة)

52 s, 16:9, EN + AR pair. Draft: `QA-Wrap-wt-tut/videos-tut/record-a-session-{en,ar}` (29ba208). Grammar: `commercial-bible.md` §9. UI words: `extension/platform/i18n/{en,ar}.json` (Start recording = popup.session.start ابدأ التسجيل; Stop = popup.record.stop أوقف; Timeline = popup.foot.timeline الخط الزمني). Words not found in i18n by this seat are marked [PREPRO] and must be checked against the frozen strings before build.

## Intent

A tester who has never used QA Wrap sees that recording costs her one press and changes nothing about how she tests, and that what she did is waiting for her afterwards, in order, on her own computer.

## Arc

Problem-light opening on a real-looking shop (0-7) · the one action: wake, name, Start (7-14) · she tests as usual while the tool quietly collects (14-28) · reassurance: it stays local (28-35) · Stop, saved (35-41) · payoff: read the timeline (41-48) · end card (48-52).

## Director's changes from the draft

1. Replace "a slow push-in on every scene" with motivated moves: a truck to the toolbar in shot 1, a pull-out in shot 4, a high-angle extreme wide in shot 5, holds elsewhere.
2. Commercial palette (coral #ff7d63, amber #f0b94a, green #7bd389, ground #171a1d), not corn/coral/basalt from PREPRO.
3. Light: warm until Start is pressed, green from then on.
4. AR L6 "تحفظ الجلسة" reads two ways unvowelled; now "الجلسة محفوظة".

## Shots

| # | Time | Size | Angle | Move | Focal | Dur (s) | Why | On-screen EN | On-screen AR | Narration EN | Narration AR (caption) | Voice direction |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.0-7.2 | WS browser window with a Swag Labs inventory (Sauce Labs Backpack, Bike Light, Bolt T-Shirt) | eye level | slow truck toward the toolbar (motivated: we go where the tool sleeps) | the grey QA Wrap icon with three rising z glyphs | 7.2 | establish the real place first, then point at the sleeping tool | Swag Labs · Products · Add to cart | Swag Labs · Products · Add to cart (the site stays English: it is the site under test) | Open the site you want to test. QA Wrap sleeps until you wake it. | افتح الموقع الذي تريد اختباره، وكيو إيه راب نائم حتى توقظه. | relaxed, a friend showing a trick |
| 2 | 7.2-13.8 | CU icon, then MS popup | eye level | hold; icon wakes with an anticipation dip, dashed beam carries the eye to the popup | the amber Start recording button | 6.6 | the single action of the film, given a close size and the only amber | What are you testing? [PREPRO] · Checkout flow · Start recording | ما الذي تختبره؟ [PREPRO] · مسار الدفع · ابدأ التسجيل | Wake it on that tab, give the run a name, and press Start. | أيقظه في هذا التبويب، وأعط الجلسة اسما، ثم اضغط «ابدأ التسجيل». | three beats in the sentence, small lift on Start |
| 3 | 14.0-20.2 | MS of the shop page with a small live counter card docked at the side | eye level | track-with the cursor (Add to cart, cart badge 1, Checkout) | the cursor's press ripple | 6.2 | normal testing, shown as ordinary on purpose; one press per word of the line | Add to cart · 1 · Checkout · a red record dot | Add to cart · 1 · Checkout | Then test like you always do. Click, type, scroll. | ثم اختبر كما تفعل دائما. انقر، واكتب، ومرر الصفحة. | easy rhythm, one word per press |
| 4 | 20.2-28.0 | WS pulling out to show a lane under the page | eye level | pull-out; each event pill flies on an arc down to the lane and becomes a dot (graphic match) | the lane filling | 7.8 | the idea is "all in one place": the wider size shows the one lane | Click · Request · Error (coral) · Screenshot | نقرة · طلب · خطأ · لقطة شاشة | Every click, request, error and screenshot drops onto one timeline. | كل نقرة وطلب وخطأ ولقطة شاشة تسقط على خط زمني واحد. | list with rising energy, land on واحد |
| 5 | 28.0-35.0 | EWS: a laptop small on the ground, the lane glowing inside it | high angle | hold; a dashed arrow leaves for a cloud and stops at a coral barrier | the barrier | 7.0 | high and wide makes the outside world far and the laptop a safe box | On your computer | على جهازك | Everything stays on your computer. Nothing is sent anywhere. | كل شيء يبقى على جهازك، ولا يغادره أي شيء. | calm, slower, reassuring |
| 6 | 35.0-41.0 | MS popup | eye level | hold; Stop pressed, record dot goes out, a Saved card pops with the run's name and five dots | the green check | 6.0 | closure of the action begun in shot 2, same framing to rhyme | Stop · Checkout flow · Session saved [PREPRO] | أوقف · مسار الدفع · الجلسة محفوظة | When you are done, press Stop. The session is saved. | عندما تنتهي، اضغط «أوقف». الجلسة محفوظة. | tidy, conclusive |
| 7 | 41.0-48.4 | MS then CU of the Timeline card | eye level | push-in as an amber highlight steps down five rows | the highlighted row | 7.4 | the payoff is reading: closer size, one row lit at a time | Timeline · 00:03 Click · 00:04 Request · 00:09 Click · 00:11 Error · 00:11 Screenshot | الخط الزمني · (rows keep their times) | Open its Timeline, and read what happened, step by step. | افتح الخط الزمني، واقرأ ما حدث خطوة خطوة. | slower on خطوة خطوة, the satisfied end |
| 8 | 48.5-52.0 | MS centred | eye level | hold | the lockup | 3.5 | stable end | QA Wrap · More tutorials, inside the tool | المزيد من الدروس داخل الأداة | (none) | (none) | silence under the bed |

## Sign-off focus

Shot 2 legibility of the popup at 1080; shot 4 arc paths (no straight diagonals); shot 5 is the only high angle in the film; AR caption bidi on «ابدأ التسجيل».
