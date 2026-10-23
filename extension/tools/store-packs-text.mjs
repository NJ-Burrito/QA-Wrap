/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Listing texts for the free stores, one source: store/<edge|firefox|opera>/{listing.en.md,listing.ar.md,permissions.md}.
 * SUBMIT.md in each folder is written by hand (the click path is the store's, not ours).
 *
 *   node tools/store-packs-text.mjs
 *
 * Permissions are read from the BUILT manifests (dist/<browser>/manifest.json), so the table cannot name a permission the package
 * does not carry and cannot miss one it does: run `node tools/build-browsers.mjs edge firefox opera` first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIST } from './lib-paths.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brand = JSON.parse(fs.readFileSync(path.join(EXT, 'brand/brand.json'), 'utf8'));
const U = brand.urls;
const ISSUES = 'https://github.com/NJ-Burrito/QA-Wrap/issues';
const VER = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;

const SHORT = {
  en: 'Free, local bug-report recorder for testers: each failure is linked to the click behind it, then filed to Jira in one press.',
  ar: 'مسجّل تقارير أخطاء مجاني ومحلي للمختبرين: يُربط كل إخفاق بالنقرة التي سبّبته، ثم يُرفع إلى Jira بضغطة واحدة.',
};

const LONG = {
  en: `You find a bug, and then you spend time rebuilding how you got there: the steps, the screenshot, the console, the request that failed. QA Wrap does that part while you test.

Record, explain, hand over.
- Record: wake it on the site you are testing, name what you are testing, press Start. It keeps your clicks, typing and navigation, the page's requests and the console in one timeline.
- Explain: when something fails it shows the click that caused it. Press Stop and the report is ready: a headline, the cause-and-effect chain, the screenshots, accessibility and speed findings, and a timeline you can scrub.
- Hand over: copy the report as Markdown, save it as files in a folder you choose, or file it to Jira with the project's own fields. Nine other trackers and seven chat destinations are there too, each only when you set it up and press the button.

What it does not do
- It never uploads anything of its own. No server, no analytics, no remote code. Data leaves only when you press a button that names where it goes.
- It does not record password fields or cookie values into a session or an export.
- It can read every site from install (the browser says so on the install dialog), but it records only after you wake a window and press Start, and only for the focused tab.
- Finished sessions are deleted after 30 days by default; you can choose one day to a year, or never.

Also in the box: page harvest with verified locators and a Playwright page object, link checking, designed form values, request breaking, an accessibility scan (axe-core, bundled), Core Web Vitals, right-to-left and text-expansion stress (Arabic is a first-class case), screenshots and recordings with mark-up and redaction, a cookie editor, and exports to Markdown, JSON, HAR, Postman, JUnit and Excel.

Free and open source under the MIT licence. Interface in English and Arabic. Source: https://github.com/NJ-Burrito/QA-Wrap`,
  ar: `تجد خللا في الموقع، ثم تقضي وقتا في إعادة بناء الطريق إليه: الخطوات ولقطة الشاشة وسجل وحدة التحكم والطلب الذي فشل. QA Wrap يتولى هذا الجزء أثناء اختبارك.

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

مجاني ومفتوح المصدر بترخيص MIT. الواجهة بالعربية والإنجليزية. المصدر: https://github.com/NJ-Burrito/QA-Wrap`,
};

const NAME = { en: 'QA Wrap', ar: 'QA Wrap' };

/** One sentence per permission, the same words in all three stores; a Firefox build simply has fewer rows. */
const WHY = {
  storage: 'Keeps sessions, settings and reports in the browser profile, on this computer.',
  unlimitedStorage: 'A long session with screenshots and recordings is larger than the default storage quota.',
  contextMenus: 'The right-click entries that start a recording, copy a Playwright locator or add a note.',
  tabs: 'Follows the tabs of the window under test and opens the extension\'s own report and settings pages.',
  scripting: 'Puts the in-page tools (locator picker, value palette, layout stress) into the page the tester is testing, on demand.',
  webNavigation: 'Records navigations and the HTTP status of the page itself, and reads the frame tree so a locator inside an iframe can be built.',
  clipboardWrite: 'Copies a Playwright locator or a report to the clipboard when the tester presses Copy.',
  alarms: 'The daily purge of sessions older than the retention period the tester chose; it must run while the background page is suspended.',
  downloads: 'Saves exports (Markdown, HAR, Excel, recordings) into the folder the tester chose.',
  notifications: 'Tells the tester when a session is saved, a recording starts or stops, and the extension goes to sleep. Switchable off in Settings; nothing in it is sent anywhere.',
  offscreen: 'Encoding screen recordings and GIFs needs a document, which a service worker does not have.',
  activeTab: 'Reads the URL and title of the tab the tester invoked the extension on.',
  tabCapture: 'Records a video of the tab when the tester presses Record.',
  debugger: 'Code coverage needs the debugger permission. It is attached to a tab only when the tester presses Measure and detached when the run ends; nothing attaches it on its own.',
  webRequest: 'Observation only, never blocking: reads six security headers (CSP, HSTS, CORS, X-Frame-Options, Referrer-Policy, Permissions-Policy) off each response while a session records, so the fine-print check can report on them. Nothing is modified, redirected or delayed.',
  sidePanel: 'The docked workbench beside the page, for testers who prefer it to the floating window.',
  'system.display': 'Reads monitor work areas so the floating window opens beside the browser, including on a second monitor, instead of off-screen.',
  cookies: 'Optional. The cookie editor and saved cookie profiles on the site under test; asked for the first time the tester opens it.',
  desktopCapture: 'Optional. Records a window or the whole screen, asked for the first time the tester chooses one of those.',
  nativeMessaging: 'Optional. The agent bridge: asked for only when the tester switches Agent bridge on in Settings, so a helper program the tester installed can answer read-only questions about their own sessions for their coding agent. Handed back when it is switched off.',
  '<all_urls>': 'A QA tool has to work on whatever site is under test, including intranet and staging hosts that cannot be listed in advance, so its page scripts are present on every site. They record nothing until the tester wakes that window and presses Start, and then only the focused tab. No data leaves the browser except on a button press that names the destination.',
};

const STORES = {
  edge: { label: 'Microsoft Edge Add-ons', cat: 'Developer Tools', short: `The short description is the manifest's description field (it comes from the package, not from the form).`, notes: 'edge' },
  firefox: { label: 'Firefox Add-ons (AMO)', cat: 'Web Development (primary); Other (second, optional)', notes: 'firefox' },
  opera: { label: 'Opera add-ons', cat: 'Web Development', notes: 'opera' },
};

const REVIEW_NOTES = (store) => `QA Wrap is a free, MIT-licensed, local-first QA tool. It needs no account and has no server.

How to try it in two minutes (no login):
1. Open ${U.practice} (a practice page we host).
2. Click the QA Wrap toolbar button, accept the welcome notice, press Wake up, then Start.
3. Use the form on the practice page (fill a field, press Save changes), then press Stop in the toolbar popup.
4. The report shows the session timeline with each click and any failure beside the action that caused it. Press Copy report.

Why the broad host permission: ${WHY['<all_urls>']}
Remote code: none. Every script ships in the package; axe-core is vendored. No analytics, no telemetry, no server of ours.
Network: the extension makes no request of its own. The only egress is a button the tester presses to file or send a report to a tracker or webhook they configured, or a request they wrote in the API tool.
Source: https://github.com/NJ-Burrito/QA-Wrap (public). The package is the plain, unminified source; no bundler or minifier is used.${store === 'firefox' ? `
Firefox build: \`node tools/build-browsers.mjs firefox\` from \`extension/\` reproduces the package byte for byte; see store/FIREFOX-SOURCE-SUBMISSION.md in the repository. Recording, GIF and coverage need APIs Firefox does not implement, so those tools are absent and say so at runtime.` : ''}`;

function permsFor(browser) {
  const m = JSON.parse(fs.readFileSync(path.join(DIST, browser, 'manifest.json'), 'utf8'));
  const row = (p, kind) => `| \`${p}\` | ${kind} | ${WHY[p] ?? `**MISSING JUSTIFICATION**`} |`;
  const rows = [
    ...m.permissions.map((p) => row(p, 'required')),
    ...(m.host_permissions || []).map((p) => row(p, 'required (host)')),
    ...(m.optional_permissions || []).map((p) => row(p, 'optional')),
  ];
  const hist = rows.filter((r) => r.includes('MISSING'));
  if (hist.length) throw new Error(`a ${browser} permission has no justification: ${hist.join(' ')}`);
  return rows;
}

for (const [dir, s] of Object.entries(STORES)) {
  const root = path.join(EXT, 'store', dir);
  fs.mkdirSync(root, { recursive: true });
  const fields = (lang) => `# ${s.label}: listing text (${lang === 'en' ? 'English' : 'Arabic'}) for QA Wrap ${VER}

Paste each block into the field named above it. Source of truth: \`tools/store-packs-text.mjs\`.

- **Name:** \`${NAME[lang]}\`
- **Category:** ${s.cat}
- **Privacy policy URL:** ${U.privacy}
- **Support URL:** ${ISSUES}
- **Website / homepage:** ${U.homepage}
- **Licence (if asked):** MIT
- **Price:** free

## Short description / summary${dir === 'firefox' ? ' (max 250 characters)' : dir === 'edge' ? ' (max 132, taken from the manifest)' : ' (one sentence)'}

\`\`\`
${SHORT[lang]}
\`\`\`

## Long description${dir === 'edge' ? ' (250 to 10,000 characters)' : ''}

\`\`\`
${LONG[lang]}
\`\`\`
${dir === 'edge' ? `
## Search terms (max 7 terms, 30 characters each)

${lang === 'en' ? 'bug report, QA testing, test recorder, Jira, accessibility check, Playwright locator, ISTQB' : 'تقرير خلل, اختبار البرمجيات, مسجل اختبار, Jira, فحص إمكانية الوصول, محدد Playwright, ISTQB'}
` : ''}
## ${dir === 'firefox' ? 'Notes to reviewer' : dir === 'edge' ? 'Notes for certification' : 'Notes for the moderators (if the form has a free-text box)'}

\`\`\`
${REVIEW_NOTES(dir)}
\`\`\`
`;
  fs.writeFileSync(path.join(root, 'listing.en.md'), fields('en'));
  fs.writeFileSync(path.join(root, 'listing.ar.md'), fields('ar').replace('Notes to reviewer', 'Notes to reviewer (English, the reviewers read English)'));
  fs.writeFileSync(path.join(root, 'permissions.md'), `# ${s.label}: permission justifications for QA Wrap ${VER}

Read from the built \`dist/${dir}/manifest.json\`; every permission the package declares has a row. Copy a row into the store's per-permission box.

| Permission | Kind | Why |
|---|---|---|
${permsFor(dir).join('\n')}

Remote code: none (all code ships in the package; axe-core is vendored). Data: nothing is collected by the developer; sessions stay in the browser profile.${dir === 'firefox' ? `

\`data_collection_permissions\` in the Firefox manifest: required = none (nothing needs to leave the machine for the extension to work); optional = websiteContent, websiteActivity, authenticationInfo (only when the tester presses File/Send to a tracker or webhook they configured).` : ''}
`);
  console.log(`  store/${dir}/listing.{en,ar}.md permissions.md`);
}
