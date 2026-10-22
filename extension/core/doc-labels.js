/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-053: the words an exported document is made of, in both languages, in one file.
 *
 * They live here and not in `platform/i18n/*.json` on purpose: the exporters run in the offscreen
 * document and in Node tests, with no catalogue loaded, and a document must carry its own words.
 * `tools/test-arabic-edges.mjs` pins that the two tables have the same keys and the same `{holes}`.
 *
 * Only generic labels are here. ISTQB-term documents (the SRS, the manual, the session sheet) keep
 * their English terms until the owner's terminology vote (T-053 step 7).
 */

export const DOC_LABELS = {
  en: {
    kindReport: 'Test session report',
    problemFound: 'problem found', problemsFound: 'problems found',
    stepsRecorded: 'steps recorded', duration: 'duration', min: 'min', sec: 's', requests: 'requests',
    screenshotsCount: 'screenshots', notesCount: 'tester notes',
    verdictProblem: '1 problem', verdictProblems: '{n} problems', verdictClean: 'clean',
    hBroke: 'What broke', hSteps: 'Steps to reproduce', hNotes: 'Tester notes', hSelectors: 'Selector copy',
    hSpeed: 'Page speed', hA11y: 'Accessibility', hLinks: 'Links', hMap: 'Page map', hEnv: 'Environment', hShots: 'Screenshots',
    youDid: 'You did', then: 'Then', thenGap: 'Then, {ms} ms later', confidence: '{v} confidence',
    clean: 'clean', nothingFailed: 'Nothing failed in this session.',
    byPage: '(by the page)',
    colWhen: 'When', colSelector: 'Selector copied', colElement: 'Element', colImpact: 'Impact', colRule: 'Rule',
    colIssue: 'Issue', colElements: 'Elements', colLink: 'Link', colText: 'Text', colStatus: 'Status',
    linksBroken: 'broken', linksRedirected: 'redirected', linksSlow: 'slow', linksTotal: 'links on the page',
    pageMap: '{e} interactive elements, {u} with a locator verified to match one element, {f}. The page object and the JSON map are saved beside this file.',
    envUrl: 'URL', envViewport: 'Viewport', envBrowser: 'Browser', envPlatform: 'Platform', envLanguage: 'Language',
    envRecorded: 'Recorded', envEvents: 'Events', envSession: 'Session',
    eventsValue: '{n} ({p} problems, {f} raw failures)',
    eventsFailures: '{n} ({f} failures)',
    screenshot: 'Screenshot',
    rateGood: 'good', rateNeeds: 'needs-improvement', ratePoor: 'poor', rateNa: 'n/a',
    confHigh: 'high', confMedium: 'medium', confLow: 'low',
    // The shell around every document.
    howToRead: 'How to read this', howToReadAria: 'How to read this document', madeBy: 'Made by', by: 'by',
    legendBad: 'Petra red: a failure, or the one action that caused it.',
    legendOk: 'Guac green: a pass; measured, met, verified.',
    legendWarn: 'Wadi Rum ochre: blocked, or a gap only a person can fill.',
    legendCorn: 'Corn: a note from the tool, worth reading before the section.',
    legendArrow: 'An arrow: cause on the left, effect on the right, the gap in milliseconds above it.',
    legendGap: 'GAP in a status: the recording could not know; decide it and the mark goes away.',
    // Footers.
    checksums: 'SHA-256 checksums',
    // Jira (formats.js).
    jWhat: 'What happened', jSteps: 'Steps to reproduce', tableScroll: 'Scrollable table', stepsOmitted: '{n} steps omitted; the full list is in the attached report.', jNotes: 'Tester notes', jA11y: 'Accessibility',
    jPerf: 'Performance', jEnv: 'Environment', jLocators: 'Verified locators', jField: 'Field', jValue: 'Value',
    jCause: 'Caused by', jEarlier: '{ms}ms earlier', jNoCause: 'No user action lines up with this: likely background activity.',
    jNoFailures: 'No failures were captured. Charter',
    // The Markdown report (artifact-docs.js) and the Markdown issue (formats-export.js).
    mSession: 'Session', mStarted: 'Started', mDuration: 'Duration', mStartUrl: 'Start URL', mUserAgent: 'User agent',
    mEvents: 'Events', mFindings: 'Findings', mProblems: 'Problems',
    mCorrelated: 'Correlated failures', mCorrelatedNote: 'Each failure linked back to the action that most plausibly triggered it.',
    mTriggeredBy: 'Triggered by', mFailure: 'Failure', mAlsoAt: 'Also at this instant', mOccurred: 'Seen', mOccurredN: '{n} times in this session (all kept in the Raw JSON)', mNoTrigger: 'no DOM action within the causal window: likely background activity',
    mNoInteractions: 'No interactions recorded.', mBugs: 'Bugs', mIssues: 'Issues', mQuestions: 'Questions', mNotes: 'Notes',
    mTimeline: 'Full timeline', mCookies: 'Cookies at capture time', mCookieNote: 'Cookie values are deliberately omitted.',
    mName: 'Name', mDomain: 'Domain', mPath: 'Path', mA11yNote: 'Automated checks catch roughly a third of real barriers. Manual review still applies.',
    mLeft: 'Nothing in this report left the machine.',
    mIssueFoot: 'Captured locally with QA Wrap. Cookie values and passwords were never recorded.',
    mMetric: 'Metric', mRating: 'Rating',
    gapLine: 'Capture gap: {lost} events were not stored and {unconfirmed} could not be confirmed, so this record may be incomplete.',
    gapCoverageDetached: 'Coverage stopped when the debugger was detached, so the coverage figures may be incomplete.',
    gapRecordingOrphaned: 'A recording could not be re-filed under this session, so it may be missing here.',
    gapSessionCap: 'This session reached its storage limit, so later events were not saved.',
    gapBodyCap: 'This session reached its size limit, so later request and response bodies were not saved. Events were kept.',
    gapLowDisk: 'Free storage space is low. Save or export this session soon.',
    defBuild: 'Build', defRepro: 'Reproducibility', notStated: 'not stated',
    reproAlways: 'always', reproSometimes: 'sometimes', reproOnce: 'once', reproUnknown: 'unknown',
    techLine: 'Technique coverage: {covered} of {total} values across {fields} fields opened',
    techLineOne: 'Technique coverage: {covered} of {total} values in {fields} field opened',
    gapOther: 'Capture gap: the recorder noted a gap of a kind this version does not know, so this record may be incomplete.',
    gapReplayCap: 'This session reached its replay size limit, so later replay data was not saved. Events were kept.',
    reqExecuted: '{n} of {m} executed',
    cutNote: "The rest was cut to fit this tracker's size limit. The full text is in the attached report.",
  },
  ar: {
    kindReport: 'تقرير جلسة اختبار',
    problemFound: 'مشكلة مرصودة', problemsFound: 'مشكلات مرصودة',
    stepsRecorded: 'خطوات مسجّلة', duration: 'المدة', min: 'دقيقة', sec: 'ثانية', requests: 'طلبات',
    screenshotsCount: 'لقطات شاشة', notesCount: 'ملاحظات المختبِر',
    verdictProblem: 'مشكلة واحدة', verdictProblems: 'المشكلات: {n}', verdictClean: 'سليمة',
    hBroke: 'ما الذي تعطّل', hSteps: 'خطوات إعادة الإنتاج', hNotes: 'ملاحظات المختبِر', hSelectors: 'نسخ المحدِّدات',
    hSpeed: 'سرعة الصفحة', hA11y: 'سهولة الوصول', hLinks: 'الروابط', hMap: 'خريطة الصفحة', hEnv: 'البيئة', hShots: 'لقطات الشاشة',
    youDid: 'فعلتَ', then: 'ثم', thenGap: 'ثم، بعد {ms} مللي ثانية', confidence: 'ثقة {v}',
    clean: 'سليمة', nothingFailed: 'لم يفشل شيء في هذه الجلسة.',
    byPage: '(نفذته الصفحة)',
    colWhen: 'الوقت', colSelector: 'المحدِّد المنسوخ', colElement: 'العنصر', colImpact: 'الأثر', colRule: 'القاعدة',
    colIssue: 'المشكلة', colElements: 'العناصر', colLink: 'الرابط', colText: 'النص', colStatus: 'الحالة',
    linksBroken: 'معطّلة', linksRedirected: 'محوَّلة', linksSlow: 'بطيئة', linksTotal: 'روابط في الصفحة',
    pageMap: '{e} عنصرًا تفاعليًا، منها {u} بمحدِّد جرى التحقق من أنه يطابق عنصرًا واحدًا، وعدد النماذج {f}. حُفظ كائن الصفحة وخريطة JSON بجانب هذا الملف.',
    envUrl: 'عنوان الصفحة', envViewport: 'نافذة العرض', envBrowser: 'المتصفح', envPlatform: 'المنصّة', envLanguage: 'اللغة',
    envRecorded: 'وقت التسجيل', envEvents: 'الأحداث', envSession: 'الجلسة',
    eventsValue: '{n} (المشكلات {p}، الإخفاقات الخام {f})',
    eventsFailures: '{n} (الإخفاقات {f})',
    screenshot: 'لقطة شاشة',
    rateGood: 'جيد', rateNeeds: 'يحتاج تحسينًا', ratePoor: 'ضعيف', rateNa: 'غير متاح',
    confHigh: 'عالية', confMedium: 'متوسطة', confLow: 'منخفضة',
    howToRead: 'كيف تقرأ هذا المستند', howToReadAria: 'كيف تقرأ هذا المستند', madeBy: 'من تطوير', by: 'من',
    legendBad: 'أحمر البتراء: إخفاق، أو الإجراء الوحيد الذي تسبّب به.',
    legendOk: 'أخضر الغواك: نجاح؛ جرى قياسه أو استيفاؤه أو التحقق منه.',
    legendWarn: 'مغرة وادي رم: أمر معطّل، أو فجوة لا يسدّها إلا شخص.',
    legendCorn: 'أصفر الذرة: ملاحظة من الأداة، تستحق القراءة قبل القسم.',
    legendArrow: 'السهم: السبب قبله والنتيجة بعده، والفجوة بالمللي ثانية فوقه.',
    legendGap: 'GAP في الحالة: تعذّر على التسجيل معرفتها؛ قرّرها لتزول العلامة.',
    checksums: 'المجاميع الاختبارية SHA-256',
    jWhat: 'ما الذي حدث', jSteps: 'خطوات إعادة الإنتاج', tableScroll: 'جدول قابل للتمرير', stepsOmitted: 'حُذفت {n} من الخطوات؛ القائمة الكاملة في التقرير المرفق.', jNotes: 'ملاحظات المختبِر', jA11y: 'سهولة الوصول',
    jPerf: 'الأداء', jEnv: 'البيئة', jLocators: 'المحدِّدات المتحقَّق منها', jField: 'الحقل', jValue: 'القيمة',
    jCause: 'السبب', jEarlier: 'قبل {ms} مللي ثانية', jNoCause: 'لا يوجد إجراء من المستخدم يتوافق مع هذا: الأرجح أنه نشاط في الخلفية.',
    jNoFailures: 'لم يُلتقط أي إخفاق. الميثاق',
    mSession: 'الجلسة', mStarted: 'البدء', mDuration: 'المدة', mStartUrl: 'عنوان البدء', mUserAgent: 'وكيل المستخدم',
    mEvents: 'الأحداث', mFindings: 'النتائج', mProblems: 'المشكلات',
    mCorrelated: 'الإخفاقات المترابطة', mCorrelatedNote: 'كل إخفاق مربوط بالإجراء الأرجح أنه تسبّب به.',
    mTriggeredBy: 'تسبّب به', mFailure: 'الإخفاق', mAlsoAt: 'وفي اللحظة نفسها', mOccurred: 'تكرر', mOccurredN: '{n} مرات في هذه الجلسة (كلها محفوظة في ملف JSON الخام)', mNoTrigger: 'لا إجراء على الصفحة ضمن نافذة السببية: الأرجح أنه نشاط في الخلفية',
    mNoInteractions: 'لم تُسجَّل أي تفاعلات.', mBugs: 'العيوب', mIssues: 'القضايا', mQuestions: 'الأسئلة', mNotes: 'الملاحظات',
    mTimeline: 'الجدول الزمني الكامل', mCookies: 'ملفات تعريف الارتباط وقت الالتقاط', mCookieNote: 'قيم ملفات تعريف الارتباط محذوفة عمدًا.',
    mName: 'الاسم', mDomain: 'النطاق', mPath: 'المسار', mA11yNote: 'الفحوص الآلية تكشف نحو ثلث العوائق الحقيقية فقط، ولا تغني عن المراجعة اليدوية.',
    mLeft: 'لم يغادر شيء من هذا التقرير الجهاز.',
    mIssueFoot: 'التُقط محليًا بواسطة QA Wrap. لم تُسجَّل قيم ملفات تعريف الارتباط ولا كلمات المرور.',
    mMetric: 'المقياس', mRating: 'التقييم',
    gapLine: 'تنبيه: {lost} حدثًا لم يُحفظ و{unconfirmed} حدثًا لم يتأكد حفظه، فقد يكون هذا السجل ناقصًا.',
    gapCoverageDetached: 'توقّف قياس التغطية عند فصل أداة التصحيح، فقد تكون أرقام التغطية ناقصة.',
    gapRecordingOrphaned: 'تعذّر إلحاق تسجيل بهذه الجلسة، فقد يكون غائبًا عن هذا السجل.',
    gapSessionCap: 'بلغت هذه الجلسة حدّ التخزين، فلم تُحفَظ الأحداث اللاحقة.',
    gapBodyCap: 'بلغت هذه الجلسة حدّ الحجم، فلم تُحفَظ نصوص الطلبات والاستجابات اللاحقة، وبقيت الأحداث محفوظة.',
    gapLowDisk: 'مساحة التخزين المتاحة منخفضة. احفظ هذه الجلسة أو صدّرها قريبًا.',
    defBuild: 'رقم البناء', defRepro: 'قابلية إعادة الإنتاج', notStated: 'غير مذكور',
    reproAlways: 'في كل مرة', reproSometimes: 'أحيانًا', reproOnce: 'مرة واحدة', reproUnknown: 'غير معروفة',
    techLine: 'تغطية تقنيات التصميم: {covered} من {total} من القيم، في {fields} من الحقول المفتوحة',
    techLineOne: 'تغطية تقنيات التصميم: {covered} من {total} من القيم، في {fields} من الحقول المفتوحة',
    gapOther: 'تنبيه: سجّلت الأداة فجوة من نوع لا تعرفه هذه النسخة، فقد يكون هذا السجل ناقصًا.',
    gapReplayCap: 'بلغت هذه الجلسة حدّ حجم بيانات إعادة التشغيل، فلم تُحفَظ بيانات إعادة التشغيل اللاحقة، وبقيت الأحداث محفوظة.',
    reqExecuted: 'نُفِّذ {n} من {m}',
    cutNote: 'قُصَّ الباقي ليناسب حدّ الحجم في هذا المتتبّع. النص الكامل في التقرير المرفق.',
  },
};

/** The table for a language code ('ar', 'ar-JO', 'en-US', ''): Arabic or English, nothing else. */
export const docLabels = (lang) => DOC_LABELS[String(lang || '').slice(0, 2).toLowerCase() === 'ar' ? 'ar' : 'en'];

/** `fill('{n} problems', { n: 3 })`: the one placeholder syntax both tables use. */
export const fill = (text, values = {}) => String(text).replace(/\{(\w+)\}/g, (_, k) => (k in values ? values[k] : `{${k}}`));

/** The confidence value of a correlation (`high`, `medium`, `low`) in the table's language; an unknown value is returned as it came. */
export const confWord = (L, v) => ({ high: L.confHigh, medium: L.confMedium, low: L.confLow })[v] || v;

const STEPS_H = new RegExp(`^#{1,6}\\s+(?:${DOC_LABELS.en.jSteps}|${DOC_LABELS.ar.jSteps})\\s*$`);
const omitted = (lang, n) => fill(docLabels(lang).stepsOmitted, { n });
const AR = /[\u0600-\u06ff]/;

/** D-1010-189: over a tracker's cap, the Markdown body keeps the first and last `keep` repro steps and says how many it dropped (the attachment holds the full record). */
export function capSteps(md, keep = 40) {
  const L = String(md).split('\n');
  const i = L.findIndex((l) => STEPS_H.test(l));
  if (i < 0) return md;
  let a = i + 1;
  while (a < L.length && !L[a].trim()) a++;
  let b = a;
  while (b < L.length && L[b].trim()) b++;
  if (b - a <= keep * 2) return md;
  L.splice(a + keep, b - a - keep * 2, `_${omitted(AR.test(L[i]) ? 'ar' : 'en', b - a - keep * 2)}_`);
  return L.join('\n');
}

/** The same cut for an ADF document: every ordered list longer than 2 x `keep` items. */
export function capAdf(doc, keep = 40) {
  return { ...doc, content: (doc?.content || []).map((n) => {
    const c = n.type === 'orderedList' ? n.content : null;
    if (!c || c.length <= keep * 2) return n;
    const text = omitted(AR.test(JSON.stringify(c[0])) ? 'ar' : 'en', c.length - keep * 2);
    return { ...n, content: [...c.slice(0, keep), { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, ...c.slice(-keep)] };
  }) };
}
