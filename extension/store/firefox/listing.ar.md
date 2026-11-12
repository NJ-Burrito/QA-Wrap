# Firefox Add-ons (AMO): listing text (Arabic) for QA Wrap 3.9.2

Paste each block into the field named above it. Source of truth: `tools/store-packs-text.mjs`.

- **Name:** `QA Wrap`
- **Category:** Web Development (primary); Other (second, optional)
- **Privacy policy URL:** https://nj-burrito.github.io/QA-Wrap/privacy.html
- **Support URL:** https://github.com/NJ-Burrito/QA-Wrap/issues
- **Website / homepage:** https://nj-burrito.github.io/QA-Wrap/
- **Licence (if asked):** MIT
- **Price:** free

## Short description / summary (max 250 characters)

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

الجديد في 3.9.2
- عنوان التقرير: يبدأ التقرير الآن باسم الجلسة الذي كتبته، وينتقل الخلل إلى سطر «ما الذي تعطل» تحته؛ والجلسة التي لا اسم لها يبقى الخلل عنوانها.
- إعادة التشغيل عبر الصفحات: الجلسة التي تنقلت بين عدة صفحات تُعاد الآن كل صفحة كما كانت في تلك اللحظة، بطولها الكامل، والعلامات الحمراء في مكانها على المسار.

الجديد في 3.9.1
- تبويب الملف الشخصي وشارة الشريط العلوي: صار للملف الشخصي تبويبه الخاص في الإعدادات، باسمك بالإنجليزية واسمك بالعربية. وتظهر صورتك واسمك في آخر الشريط العلوي بلغة QA Wrap التي تستعملها. تبقى الصورة على حاسوبك.
- غربلة الشبكة: لم يعد الخط الزمني يغرق في ضجيج الخلفية (إشارات التحليلات ووسوم الإعلانات المحجوبة والطلبات الملغاة وغياب الأيقونة والخطوط). يُطوى خلف سطر واحد يعدّه ولا يُحذف شيء، وكل تصدير يحتفظ بكل الطلبات. ولا يُخفى أبدا فشل في موقعك أنت، ولا فشل بعد إجرائك مباشرة، ولا فشل طلب مسجّل الدخول.
- أسماء النقرات: تحمل النقرة المسجّلة اسم الزر الذي ضُغط، مثل: نقر على «حفظ» (زر). تُزال عناوين البريد وأرقام الهواتف وأرقام البطاقات وسلاسل الأرقام الطويلة، ولا يُقرأ شيء من الحقول ولا كلمات المرور. ومفتاح واحد يوقفها.

الجديد في 3.9.0
- ملفك الشخصي: اكتب اسمك وأضف صورة إن شئت. ينتهي كل ملف تصدّره بسطر صغير واحد (الاسم والتاريخ وإصدار QA Wrap) ليُنسب العمل إليك. يبقى الاسم والصورة على حاسوبك.
- خط زمني مختوم: يمكن لخياري التنزيل أن يضمّا الخط الزمني كاملا في ملف Markdown (نص منسّق) مقروء، وفيه ملفك الشخصي وختم في آخره. ويقول «تحقق من ملف مختوم» إن كان الملف سليما أو معدّلا ولمن هو. الختم كاشف للتعديل وليس سرّية: يبقى النص مقروءا، ويستطيع أي شخص تعديل الملف وختمه من جديد بمفتاحه (فتختلف بصمة المفتاح).
- مؤشرات الأداء (KPI): لوحة للوقت الذي قضيته في الاختبار وتغطية الصفحات والأخطاء المسجّلة في اليوم والأسبوع، محسوبة من جلساتك أنت على هذا الجهاز فقط، ومن الملاحظات التي سجّلتها كخلل فقط. وتصدَّر بصيغة PDF.
- أفلام: نسخة عربية من الفيلم القصير (40 ثانية) وستة دروس قصيرة بالإنجليزية والعربية، على الموقع. لا يُحمَّل شيء قبل أن تضغط رابطا.

ما لا يفعله
- لا يرفع شيئا من تلقاء نفسه. لا خادم ولا تحليلات ولا شيفرة بعيدة. لا تخرج البيانات إلا حين تضغط زرا يسمّي وجهتها.
- لا يسجّل حقول كلمات المرور ولا قيم ملفات تعريف الارتباط في الجلسة ولا في أي تصدير.
- يستطيع قراءة كل المواقع منذ التثبيت (والمتصفح يذكر ذلك في نافذة التثبيت)، لكنه لا يسجّل إلا بعد أن توقظ النافذة وتضغط «ابدأ»، ولا يسجّل إلا التبويب الذي عليه التركيز.
- تُحذف الجلسات المنتهية بعد 30 يوما افتراضيا، ويمكنك اختيار يوم واحد إلى سنة، أو عدم الحذف.

وفي الصندوق أيضا: جمع عناصر الصفحة بمحدِّدات موثَّقة وكائن صفحة لـ Playwright، وفحص الروابط، وقيم نماذج مصمَّمة، وكسر الطلبات، وفحص إمكانية الوصول (axe-core مضمَّن)، ومؤشرات Core Web Vitals، واختبار الاتجاه من اليمين إلى اليسار وتمدّد النص (العربية حالة أساسية)، ولقطات وتسجيلات مع تعليم وإخفاء، ومحرِّر ملفات تعريف الارتباط، وتصدير إلى Markdown وJSON وHAR وPostman وJUnit وExcel.

مجاني ومفتوح المصدر بترخيص MIT. الواجهة بالعربية والإنجليزية. المصدر: https://github.com/NJ-Burrito/QA-Wrap
```

## What's new in this version (Arabic short field, if the form has one)

```
الملف الشخصي في تبويب خاص وفي الشريط العلوي، وغربلة للشبكة تخفي ضجيج الخلفية ولا تخفي فشلا حقيقيا أبدا، وأسماء الأزرار في النقرات المسجّلة.
```

## Notes to reviewer (English, the reviewers read English)

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
Firefox build: `node tools/build-browsers.mjs firefox` from `extension/` reproduces the package byte for byte; see store/FIREFOX-SOURCE-SUBMISSION.md in the repository. Recording, GIF and coverage need APIs Firefox does not implement, so those tools are absent and say so at runtime.
```
