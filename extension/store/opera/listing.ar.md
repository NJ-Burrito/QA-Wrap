# Opera add-ons: listing text (Arabic) for QA Wrap 3.8.4

Paste each block into the field named above it. Source of truth: `tools/store-packs-text.mjs`.

- **Name:** `QA Wrap`
- **Category:** Web Development
- **Privacy policy URL:** https://nj-burrito.github.io/QA-Wrap/privacy.html
- **Support URL:** https://github.com/NJ-Burrito/QA-Wrap/issues
- **Website / homepage:** https://nj-burrito.github.io/QA-Wrap/
- **Licence (if asked):** MIT
- **Price:** free

## Short description / summary (one sentence)

```
مسجّل تقارير أخطاء مجاني ومحلي للمختبرين: يُربط كل إخفاق بالنقرة التي سبّبته، ثم يُرفع إلى Jira بضغطة واحدة.
```

## Long description

```
تجد خللا في الموقع، ثم تقضي وقتا في إعادة بناء الطريق إليه: الخطوات ولقطة الشاشة وسجل وحدة التحكم والطلب الذي فشل. QA Wrap يتولى هذا الجزء أثناء اختبارك.

سجّل، فسّر، سلّم.
- سجّل: أيقظه على الموقع الذي تختبره، سمِّ ما تختبره، ثم اضغط «ابدأ». يحفظ نقراتك وكتابتك وتنقّلك وطلبات الصفحة وسجل وحدة التحكم في خط زمني واحد.
- فسّر: عندما يفشل شيء يريك النقرة التي سبّبته. اضغط «أوقف» فيجهز التقرير: عنوان وسلسلة السبب والنتيجة ولقطات الشاشة ونتائج إمكانية الوصول والسرعة وخط زمني تتنقل فيه.
- سلّم: انسخ التقرير بصيغة Markdown، أو احفظه ملفات في مجلد تختاره، أو ارفعه إلى Jira بحقول مشروعك نفسها. وهناك تسع أدوات تتبّع أخرى وسبع وجهات محادثة، ولا يعمل أيّ منها إلا بعد أن تعدّه أنت وتضغط الزر.

ما لا يفعله
- لا يرفع شيئا من تلقاء نفسه. لا خادم ولا تحليلات ولا شيفرة بعيدة. لا تخرج البيانات إلا حين تضغط زرا يسمّي وجهتها.
- لا يسجّل حقول كلمات المرور ولا قيم ملفات تعريف الارتباط في الجلسة ولا في أي تصدير.
- يستطيع قراءة كل المواقع منذ التثبيت (والمتصفح يذكر ذلك في نافذة التثبيت)، لكنه لا يسجّل إلا بعد أن توقظ النافذة وتضغط «ابدأ»، ولا يسجّل إلا التبويب الذي عليه التركيز.
- تُحذف الجلسات المنتهية بعد 30 يوما افتراضيا، ويمكنك اختيار يوم واحد إلى سنة، أو عدم الحذف.

وفي الصندوق أيضا: جمع عناصر الصفحة بمحدِّدات موثَّقة وكائن صفحة لـ Playwright، وفحص الروابط، وقيم نماذج مصمَّمة، وكسر الطلبات، وفحص إمكانية الوصول (axe-core مضمَّن)، ومؤشرات Core Web Vitals، واختبار الاتجاه من اليمين إلى اليسار وتمدّد النص (العربية حالة أساسية)، ولقطات وتسجيلات مع تعليم وإخفاء، ومحرِّر ملفات تعريف الارتباط، وتصدير إلى Markdown وJSON وHAR وPostman وJUnit وExcel.

مجاني ومفتوح المصدر بترخيص MIT. الواجهة بالعربية والإنجليزية. المصدر: https://github.com/NJ-Burrito/QA-Wrap
```

## Notes for the moderators (if the form has a free-text box)

```
QA Wrap is a free, MIT-licensed, local-first QA tool. It needs no account and has no server.

How to try it in two minutes (no login):
1. Open https://nj-burrito.github.io/QA-Wrap/try/ (a practice page we host).
2. Click the QA Wrap toolbar button, accept the welcome notice, press Wake up, then Start.
3. Use the form on the practice page (fill a field, press Save changes), then press Stop in the toolbar popup.
4. The report shows the session timeline with each click and any failure beside the action that caused it. Press Copy report.

Why the broad host permission: A QA tool has to work on whatever site is under test, including intranet and staging hosts that cannot be listed in advance, so its page scripts are present on every site. They record nothing until the tester wakes that window and presses Start, and then only the focused tab. No data leaves the browser except on a button press that names the destination.
Remote code: none. Every script ships in the package; axe-core is vendored. No analytics, no telemetry, no server of ours.
Network: the extension makes no request of its own. The only egress is a button the tester presses to file or send a report to a tracker or webhook they configured, or a request they wrote in the API tool.
Source: https://github.com/NJ-Burrito/QA-Wrap (public). The package is the plain, unminified source; no bundler or minifier is used.
```
