# Treatment: Tutorial 4, export-and-seal (Export and seal / التصدير والختم)

54 s, 16:9, EN + AR pair. Not built yet. Grammar: `commercial-bible.md` §9. Words: the frozen strings in `QA-Wrap-wt-profile/work/sdlc/build-profile/strings.md` (seal.*, verify.*). Honest framing is binding (D3): the seal shows a file is unchanged since it was sealed; it hides nothing and does not prove who the person is. Never say secure, encrypted, or proof of identity.

## Intent

The tester learns that her exported timeline is a plain readable file that anyone can open, and that one hand edit is caught by Verify. She also hears the limit plainly, so she trusts the tool more, not less.

## Arc

A finished session (0-7) · export it sealed (7-14) · it is plain text with her name (14-21) · the seal at its foot (21-29) · tamper: one word changed (29-36, coral) · Verify says intact or altered (36-44, green and coral side by side) · the honest limit (44-51) · end card.

## Director's changes from PREPRO

1. Paths corrected to the frozen UI: the export is "Timeline (sealed)" in the popup's More menu after Stop, or "Timeline (Markdown, sealed)" in the report's Save sheet; Verify is "Verify a sealed file" in Settings > Sessions. PREPRO's "Export button on the Timeline tab" and "Verify file" are wrong.
2. Product term clash, for the Lead: the new seal strings say الجدول الزمني, the rest of the Arabic UI says الخط الزمني (24 uses against 4). This treatment draws الخط الزمني (مختوم) and assumes the product is unified to الخط الزمني; if not, the AR caption of L1 must change to match the button.
3. PREPRO's close "That is proof, not secrecy" overclaims ("proof" invites "proof of who"). New L7 states both limits.
4. Fingerprint shown as 16 hex characters in groups of four, an obviously sample value; the hash and public key are drawn abstract (bars), never readable.

## Shots

| # | Time | Size | Angle | Move | Focal | Dur (s) | Why | On-screen EN | On-screen AR | Narration EN | Narration AR (caption) | Voice direction |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.0-7.0 | MS: the Saved session card from tutorial 1 (Checkout flow, five dots) beside the popup | eye level | hold; Stop already pressed, More opens with an anticipation dip | the More menu | 7.0 | continuity with tutorial 1: same session, next step | Checkout flow · More · Timeline (sealed) | مسار الدفع · المزيد · الخط الزمني (مختوم) | When the session is done, open More and choose Timeline, sealed. | عندما تنتهي الجلسة، افتح «المزيد» واختر الخط الزمني مختوما. | instructive, relaxed |
| 2 | 7.0-14.0 | MS: a document card slides out of the popup and unfolds | eye level | track-with the document as it unfolds | the .md file name | 7.0 | the thing she gets is a file; the move follows it out of the tool | qaw-timeline-checkout-flow.md · Timeline · Session | الخط الزمني · الجلسة (file name stays Latin) | It is a plain text file: every event, in order, readable by anyone. | ملف نصي بسيط: كل حدث بترتيبه، يقرؤه أي أحد. | plain, open |
| 3 | 14.0-21.0 | CU of the document head | eye level | hold; the first lines type themselves | the Profile line with her name in an amber band | 7.0 | her name is the personal part; close size | Profile · Layla Haddad | الملف الشخصي · ليلى حداد | Your name from Settings is written at the top. | واسمك من الإعدادات مكتوب في أعلاه. | warm on اسمك |
| 4 | 21.0-29.0 | MS: the document scrolls to its end; a seal block stamps down | eye level | tilt down (scroll), then hold on the stamp (power4.in) | the seal block | 8.0 | the seal is a verdict-like object: it gets the commercial's stamp weight | Seal · Signed by Layla Haddad · Date · Tool · Key fingerprint 3F9A 1C07 B2E4 58D1 · Signature | الختم · مختوم باسم: ليلى حداد · التاريخ · الأداة · بصمة المفتاح | At the end sits a seal: your name, the date, a fingerprint of the text, and a signature. | وفي آخره ختم: اسمك، والتاريخ، وبصمة النص، وتوقيع. | list, evenly weighted |
| 5 | 29.0-36.0 | CU of one body line | eye level | push-in; a pencil changes one word; the seal's check flips to a coral cross | the changed word, then the cross | 7.0 | cause and effect at detail size; warm light returns with the tamper | (a body line, e.g. Click Checkout → Click Continue) | (the body line stays as recorded) | Change one word by hand, and the seal no longer matches. | غير كلمة واحدة بيدك، فلا يعود الختم مطابقا. | a small "uh-oh" |
| 6 | 36.0-44.0 | WS: Settings > Sessions with Verify a sealed file, then two result cards side by side | eye level | pull-out to fit both cards; button pressed | the two verdicts, green then coral | 8.0 | comparison needs both in one frame (no split attention) | Verify a sealed file · Intact. This file is unchanged since it was sealed. · Altered. This file was changed after it was sealed. · Sealed by: Layla Haddad | تحقق من ملف مختوم · سليم. لم يتغير هذا الملف منذ ختمه. · معدل. تغير هذا الملف بعد ختمه. · مختوم باسم: ليلى حداد | In Settings, press Verify a sealed file. QA Wrap says intact or altered, and who sealed it. | في الإعدادات، اضغط «تحقق من ملف مختوم»، فيخبرك كيو إيه راب: سليم أو معدل، ومن ختمه. | clear, two-beat on سليم / معدل |
| 7 | 44.0-51.0 | MS: the open document under clear glass, the seal at its foot | eye level | hold; centred | the readable text through the glass | 7.0 | the honest close: open, readable, sealed; centred because it is the settled truth | A seal shows a change. It hides nothing. | الختم يكشف التغيير، ولا يخفي شيئا. | A seal shows a change. It hides nothing, and it does not prove who you are. | الختم يكشف التغيير. لا يخفي شيئا، ولا يثبت هويتك. | honest, level, no sell |
| 8 | 51.0-54.0 | MS centred | eye level | hold | the lockup | 3.0 | stable end | QA Wrap · More tutorials, inside the tool | المزيد من الدروس داخل الأداة | (none) | (none) | bed only |

## Sign-off focus

No claim beyond the honest note; fingerprint obviously sample; shot 6 both cards readable at 1080 for at least 0.3 s per word of each verdict line; AR file name and fingerprint isolated as Latin runs.
