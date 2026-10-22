/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// The workflow diagram: the model from a session, its layout on A4, the SVG.
import { buildFlow, flowToSvg, layout, regions, usedLegend, wrap, countAr, STEPS_AR, FAILURES_AR, A4, KINDS, EDGES } from '../core/flow.js';
import { clampLabel, isSelectorLike, isRunOnName, stepLabel, pageLabel, pathLabel, reproSteps, LABEL_MAX } from '../core/artifact.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); } };

const T = 1_750_000_000_000;
const session = { id: 's7', charter: 'Submit an application', startedAt: T, endedAt: T + 120000, startUrl: 'https://portal.example.test/apply' };
const events = [
  { kind: 'nav', ts: T + 1000, url: 'https://portal.example.test/apply' },
  { kind: 'dom', ts: T + 2000, action: 'input', tag: 'input', label: 'Applicant name', value: 'Layla', frameUrl: 'https://portal.example.test/apply' },
  { kind: 'dom', ts: T + 2500, action: 'input', tag: 'input', label: 'Email', value: 'a@b', frameUrl: 'https://portal.example.test/apply' },
  { kind: 'dom', ts: T + 4000, action: 'click', tag: 'button', label: 'Submit application', frameUrl: 'https://portal.example.test/apply' },
  { kind: 'net', ts: T + 4300, method: 'POST', url: 'https://portal.example.test/api/applications', status: 500, durationMs: 300, frameUrl: 'https://portal.example.test/apply' },
  { kind: 'dom', ts: T + 7000, action: 'click', tag: 'button', label: 'Submit application', frameUrl: 'https://portal.example.test/apply' },
  { kind: 'net', ts: T + 7200, method: 'POST', url: 'https://portal.example.test/api/applications', status: 200, durationMs: 200, frameUrl: 'https://portal.example.test/apply' },
  { kind: 'nav', ts: T + 8000, url: 'https://portal.example.test/apply/done' },
  { kind: 'note', ts: T + 9000, text: 'The reference number is missing', tag: 'bug' },
];

{
  const flow = buildFlow(session, events);
  const kinds = flow.nodes.map((n) => n.kind);
  check('start first, end last', kinds[0] === 'start' && kinds.filter((k) => k !== 'note').at(-1) === 'end', kinds.join(','));
  check('a page node for the navigation', kinds.includes('page'));
  check('consecutive inputs become one entry node', kinds.filter((k) => k === 'input').length === 1);
  const input = flow.nodes.find((n) => n.kind === 'input');
  check('entry node lists the fields in Arabic, and the model holds plain text', input.ar === 'تعبئة الحقول: Applicant name، Email' && !/[\u2066-\u2069]/.test(input.ar), input.ar);
  check('the failing click gets a decision and a failure', kinds.includes('decision') && kinds.includes('failure'));
  const failure = flow.nodes.find((n) => n.kind === 'failure');
  // The model holds plain text. Direction is a property of how it is drawn,
  // not of what it says, so the isolate is asserted on the SVG below.
  check('failure names the status, then the path on its own line', failure.ar === `فشل: 500\n/api/applications` && failure.en === 'Failure: 500', `${JSON.stringify(failure.ar)} / ${failure.en}`);
  const decision = flow.nodes.find((n) => n.kind === 'decision');
  const no = flow.edges.find((e) => e.from === decision.id && e.kind === 'no');
  const yes = flow.edges.find((e) => e.from === decision.id && e.kind === 'yes');
  check('decision has a no-arrow to the failure and a yes-arrow onward', no?.to === failure.id && !!yes && yes.label === 'نعم');
  const loop = flow.edges.find((e) => e.kind === 'loop');
  check('the second press of the same button is a loop from the failure, not a new box', loop && loop.from === failure.id && kinds.filter((k) => k === 'process').length === 1, JSON.stringify(loop));
  check('bug note becomes a floating note', flow.nodes.some((n) => n.kind === 'note' && n.floating));
  check('story in Arabic first', flow.story.ar.as.startsWith('بصفتي مستخدمًا') && flow.story.ar.criteria.length >= 1 && flow.story.en.as.startsWith('As a user'));
  check('criteria mark the failed step', flow.story.ar.criteria.some((c) => /سُجِّل فشل/.test(c)));
  check('meta counts', flow.meta.failures === 1 && flow.meta.steps === 6, `${flow.meta.steps}`);

  // Layout: inside the drawing area, left to right, rows top to bottom.
  const r = regions(flow);
  const placed = flow.nodes.filter((n) => !n.floating);
  check('every node inside the canvas region', placed.every((n) => n.x >= r.canvas.x && n.x + n.w <= r.canvas.x + r.canvas.w + 1 && n.y >= r.canvas.y && n.y + n.h <= r.canvas.y + r.canvas.h + 1));
  const rows = [...new Set(placed.map((n) => n.y))].sort((a, b) => a - b);
  const firstRow = placed.filter((n) => n.y === rows[0]).map((n) => n.x);
  check('first row runs left to right', firstRow.every((x, i) => i === 0 || x > firstRow[i - 1]));
  check('the story column sits at the right, the legend at the bottom', r.story.x > r.canvas.x + r.canvas.w && r.legend.y > r.canvas.y + r.canvas.h);

  const legend = usedLegend(flow);
  check('legend lists only what is on the page', legend.some((l) => l.kind === 'failure') && legend.some((l) => l.kind === 'loop') && !legend.some((l) => l.kind === 'request'));
  check('legend entries are bilingual', legend.every((l) => l.ar && l.en));

  const svg = flowToSvg(flow, { lockup: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' });
  check('svg is A4 landscape', /viewBox="0 0 1123 794"/.test(svg) && /width="297mm" height="210mm"/.test(svg));
  check('svg has the regions', ['title', 'canvas', 'story', 'legend'].every((k) => svg.includes(`data-region="${k}"`)));
  check('node text is RTL Arabic', (svg.match(/direction="rtl"/g) || []).length >= placed.length);
  // A Latin run inside an Arabic line has to be isolated or it renders
  // mirrored, and a trailing stop jumps to the far end of the line.
  check('a path inside an Arabic label is isolated', svg.includes('⁦/api/applications⁩'), 'no isolate around the path');
  check('an English note in an RTL line is isolated whole', /⁦[A-Za-z][^⁩]*⁩/.test(svg));
  check('arrowheads defined per edge kind', Object.keys(EDGES).every((k) => svg.includes(`id="arrow-${k}"`)));
  check('legend explains the ring arrow', svg.includes('تكرار أو إعادة محاولة') && svg.includes('a retry, back to an earlier step'));
  check('lockup inlined, maker named', svg.includes('<rect width="10" height="10"/>') && svg.includes('QA Wrap'));
  check('no unescaped ampersand', !/&(?!amp;|lt;|gt;|quot;|#)/.test(svg));
  check('Arabic charter can be given', buildFlow({ ...session, charterAr: 'تقديم طلب' }, events).title.ar === 'تقديم طلب');
}

{
  check('wrap keeps words whole', wrap('one two three four five', 9).join('|') === 'one two|three|four five');
  check('wrap of nothing is one empty line', wrap('').length === 1);
  const many = { nodes: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, kind: 'process', ar: 'خطوة', en: 'step' })), edges: [] };
  layout(many);
  const r = regions(many);
  check('forty boxes still fit the sheet', many.nodes.every((n) => n.y + n.h <= r.canvas.y + r.canvas.h + 1 && n.x + n.w <= A4.w));
  check('every kind has a shape, colours and both names', Object.values(KINDS).every((k) => k.shape && k.fill && k.stroke && k.ar && k.en));
}

/* ── labels a recording produces that are not names ───────────────────── */
/*
 * The three faults in the film sample, each asserted on the label that is
 * actually rendered. A diagram whose text runs across the sheet is not a
 * cosmetic complaint: it covers the boxes, the arrows and the story column, so
 * the page stops being a workflow diagram at all.
 */
{
  const U = 'https://www.example.test/Ar/Pages/%D9%84%D8%A7%D8%A6%D8%AD%D8%A9-%D8%AA%D8%B3%D8%AC%D9%8A%D9%84-%D8%A7%D9%84%D8%A3%D8%AF%D9%88%D9%8A%D8%A9.aspx';
  const SELECTOR = '#ticket-container{width:100%}#newsScroll{overflow:hidden}#ticker li{float:left}';
  const HUGE = 'الغذاء والدواء مستحضرات التجميل المحتوى '.repeat(50); // 2,000 characters
  const t = 1_800_000_000_000;
  const sess = { id: 'sX', charter: 'تسجيل دواء', startedAt: t, startUrl: U };
  const evs = [
    { kind: 'nav', ts: t + 1000, url: U },
    { kind: 'dom', ts: t + 2000, action: 'click', tag: 'div', label: SELECTOR, frameUrl: U },
    { kind: 'dom', ts: t + 3000, action: 'keydown', key: 'Enter', tag: 'body', label: HUGE, frameUrl: U },
  ];
  const f = buildFlow(sess, evs);
  const page = f.nodes.find((n) => n.kind === 'page');
  const clicks = f.nodes.filter((n) => n.kind === 'process');

  // 1. a page opened at a percent-encoded Arabic path
  check('page label is decoded, never percent-encoded', !/%[0-9A-Fa-f]{2}/.test(page.ar) && !/%[0-9A-Fa-f]{2}/.test(page.en), page.ar);
  check('page label is the last meaningful segment, in Arabic', page.ar === 'فتح الصفحة: لائحة تسجيل الأدوية', page.ar);
  check('a directory index, and the plumbing around it, fall back to the host', pageLabel('https://x.test/Ar/Pages/Default.aspx') === 'x.test', pageLabel('https://x.test/Ar/Pages/Default.aspx'));
  check('an origin with no path is the host', pageLabel('https://portal.example.test/') === 'portal.example.test');

  // 2. a click on an element with no accessible name
  check('a CSS selector is never shown as a label', clicks.every((n) => !/[{}]/.test(n.ar) && !/[{}]/.test(n.en)), clicks.map((n) => n.ar).join(' | '));
  check('the selector falls back to the role or tag', clicks[0].ar === 'النقر على «div»' && clicks[0].en === 'Click "div"', `${clicks[0].ar} / ${clicks[0].en}`);
  check('with no role either, it is an element, in both languages', stepLabel({ label: '#a>b' }) === '' && buildFlow(sess, [{ kind: 'dom', ts: t, action: 'click', label: '#a>b' }]).nodes.find((n) => n.kind === 'process').en === 'Click "an element"');
  check('a real name that starts with a dot is still a name', !isSelectorLike('.NET Developer') && stepLabel({ label: '.NET Developer' }) === '.NET Developer');
  check('a selector is one', ['#submit', '.btn.primary', 'div > .row', '[data-id=3]'].every(isSelectorLike));

  // 3. a document-level keypress whose accessible name is the whole page
  const huge = clicks[1];
  check('a keypress recorded on the page is called what it is, not what it contains', huge.ar === 'النقر على «body»', huge.ar);
  // The same name on something that is not a container is still capped: the
  // cap is what stops any single label running off the sheet.
  const cappedName = buildFlow(sess, [{ kind: 'dom', ts: t + 4000, action: 'click', tag: 'button', label: HUGE, frameUrl: U }])
    .nodes.find((nd) => nd.kind === 'process');
  check('a 2,000-character name on a control is capped at the node', cappedName.ar.length < 60 && /…»$/.test(cappedName.ar), `${cappedName.ar.length}: ${cappedName.ar}`);
  check('the capped name keeps its first words', cappedName.ar.startsWith('النقر على «الغذاء والدواء'), cappedName.ar);

  // no label may exceed its node, whatever produced it
  const overLong = f.nodes.filter((n) => !n.floating).flatMap((n) => [n.ar, n.en]).filter((x) => x && x.length > LABEL_MAX * 2);
  check('no node label is longer than two capped labels', overLong.length === 0, overLong.join(' | '));

  const svg = flowToSvg(f);
  check('every node clips its own text', f.nodes.every((n) => svg.includes(`<clipPath id="clip-${n.id}">`) && svg.includes(`clip-path="url(#clip-${n.id})"`)));
  check('no drawn run of text is longer than a node holds', (svg.match(/<tspan[^>]*>([^<]*)</g) || []).every((m) => m.replace(/<[^>]*>/g, '').length <= 24), (svg.match(/<tspan[^>]*>([^<]*)</g) || []).map((m) => m.replace(/<[^>]*>/g, '')).filter((x) => x.length > 24).join(' | '));
  check('the percent-encoded path is nowhere in the drawing', !/%D9%|%D8%/.test(svg));
  check('the stylesheet is nowhere in the drawing', !svg.includes('#newsScroll'));

  // the same labels in prose: a repro step is a line, not a box, so it gets the
  // wider cap — but it is still capped, which is the ticket.
  const steps = reproSteps(evs);
  // A navigation step keeps the whole URL on purpose: that line is what a
  // person pastes into a browser to reproduce. It is the *element* labels that
  // were unbounded.
  check('a repro step caps the page-text name too', steps.slice(1).every((x) => x.length < 140), steps.map((x) => x.length).join(','));
  check('the navigation step still carries the full URL', steps[0].endsWith(U));
  check('a click with no name falls back to the tag, not to a selector', steps[1] === '2. Click div', steps[1]);

  // the helpers themselves
  check('a path loses its middle, not its end', clampLabel('/Ar/Pages/one/two/three/four/five/six', 28) === '/Ar/Pages/one/…four/five/six', clampLabel('/Ar/Pages/one/two/three/four/five/six', 28));
  check('prose loses its tail', clampLabel('a'.repeat(50)) === `${'a'.repeat(27)}…`);
  check('a short label is left exactly alone', clampLabel('Submit application') === 'Submit application');
  check('a broken percent escape does not throw', pathLabel('https://x.test/100%') === '/100%');
  check('a long word with no spaces still wraps', wrap('x'.repeat(50), 10).every((l) => l.length <= 10));
}

/* ── a failure's label, and a story that has to fit its box ───────────── */
/*
 * Two blemishes in the accepted frame, both about text that a person reads
 * rather than about the model behind it.
 */
{
  const t = 1_810_000_000_000;
  const base = { id: 'sF', charter: 'Register a medicine', startedAt: t, startUrl: 'https://x.test/apply' };
  const failing = (status, url) => [
    { kind: 'dom', ts: t + 1000, action: 'click', tag: 'button', label: 'إرسال الطلب', frameUrl: 'https://x.test/apply' },
    { kind: 'net', ts: t + 1200, method: 'POST', url, status, durationMs: 120, frameUrl: 'https://x.test/apply' },
  ];

  // 1. no stray separator, whatever the status is
  for (const [status, url, path] of [[500, 'https://x.test/api/applications', '/api/applications'], [404, 'https://x.test/api/x', '/api/x'], [503, 'https://x.test/', 'x.test']]) {
    const f = buildFlow(base, failing(status, url)).nodes.find((nd) => nd.kind === 'failure');
    check(`a ${status} reads as a status and a path, on two lines`, f.ar === `فشل: ${status}\n${path}` && f.en === `Failure: ${status}`, `${JSON.stringify(f.ar)} / ${f.en}`);
    check(`a ${status} label carries no stray separator`, !/[·]/.test(f.ar) && !/[·:]\s*$/.test(f.ar) && !/[·:]\s*$/.test(f.en), f.ar);
  }

  // a failure that is not a request has no path: one line, nothing trailing
  const consoleFail = buildFlow(base, [
    { kind: 'dom', ts: t + 1000, action: 'click', tag: 'button', label: 'إرسال الطلب', frameUrl: 'https://x.test/apply' },
    { kind: 'console', ts: t + 1100, level: 'error', text: 'TypeError: undefined is not a function', frameUrl: 'https://x.test/apply' },
  ]).nodes.find((nd) => nd.kind === 'failure');
  check('a failure with no path is one line, with nothing trailing', !consoleFail.ar.includes('\n') && /^فشل: TypeError/.test(consoleFail.ar) && !/[·:]\s*$/.test(consoleFail.ar), consoleFail.ar);
  check('a failure with no path still fits the node', consoleFail.ar.length <= 'فشل: '.length + 36, consoleFail.ar);

  // and the two lines survive into the drawing, in that order
  const svgF = flowToSvg(buildFlow(base, failing(500, 'https://x.test/api/applications')));
  const fNode = buildFlow(base, failing(500, 'https://x.test/api/applications')).nodes.find((nd) => nd.kind === 'failure');
  const drawn = (svgF.match(new RegExp(`<g data-node="${fNode.id}"[\\s\\S]*?</g></g>`)) || [''])[0];
  const tspans = (drawn.match(/<tspan[^>]*>([^<]*)</g) || []).map((m) => m.replace(/<[^>]*>/g, '').replace(/<$/, '').replace(/[\u2066\u2069]/g, ''));
  // The separator has to stay OUTSIDE the isolate. An isolate with no strong
  // character in it resolves left-to-right, so a colon swallowed into one is
  // drawn at the far end of an Arabic line: "فشل500 :".
  check('a separator before a Latin run stays in the Arabic flow', svgF.includes('فشل: ⁦500⁩'), (svgF.match(/فشل[^<]*/) || [''])[0]);
  check('a path keeps its leading slash inside the isolate', svgF.includes('⁦/api/applications⁩'));
  check('the failure box draws the status line then the path line', tspans[0] === 'فشل: 500' && tspans[1] === '/api/applications', JSON.stringify(tspans));

  // 2. the story column: never a hard clip of prose
  const wordy = Array.from({ length: 5 }, (_, i) => ({
    kind: 'dom', ts: t + 2000 + i * 100, action: 'click', tag: 'button',
    label: `تحديث بيانات المستحضر ${i + 1}`, frameUrl: 'https://x.test/apply',
  }));
  const long = { ...base, charter: 'A pharmacist looking for the drug registration requirements published by the Jordan Food and Drug Administration on its website', charterAr: 'صيدلانية تبحث عن متطلبات تسجيل دواء منشورة على موقع المؤسسة العامة للغذاء والدواء الأردنية وعن النماذج المطلوبة لتقديم الطلب' };
  const wordyFlow = buildFlow(long, wordy);
  const svgS = flowToSvg(wordyFlow);
  const rS = regions(wordyFlow);
  const storyChunk = svgS.slice(svgS.indexOf('data-region="story"'), svgS.indexOf('data-region="legend"'));
  const baselines = [...storyChunk.matchAll(/<text[^>]*y="([\d.]+)"/g)].map((m) => Number(m[1]));
  check('every line of the story sits inside its box', baselines.length > 4 && Math.max(...baselines) <= rS.story.y + rS.story.h, `${Math.max(...baselines)} vs ${rS.story.y + rS.story.h}`);
  check('what does not fit is counted, in both languages', /معايير أخرى في التقرير|ومعيار آخر في التقرير/.test(storyChunk) && /more in the report/.test(storyChunk), storyChunk.slice(-400));
  check('a charter long enough to eat the column is capped, not dropped', wordyFlow.story.ar.want.includes('…') && wordyFlow.story.en.want.includes('…'), wordyFlow.story.en.want);

  // a short story is not truncated for the sake of it
  const shortFlow = buildFlow(base, failing(500, 'https://x.test/api/applications'));
  const shortStory = flowToSvg(shortFlow);
  const shortChunk = shortStory.slice(shortStory.indexOf('data-region="story"'), shortStory.indexOf('data-region="legend"'));
  check('a story that fits says nothing about a remainder', !/معايير أخرى|more in the report/.test(shortChunk));
}

/* ── the title strip: a date that reads forwards, and Arabic that agrees ── */
{
  const t = Date.UTC(2026, 8, 5, 9, 30);
  const sess = { id: 'sD', charter: 'تسجيل دواء', startedAt: t, startUrl: 'https://x.test/a' };
  const clicks = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'dom', ts: t + 1000 + i * 100, action: 'click', tag: 'button', label: `زر ${i + 1}`, frameUrl: 'https://x.test/a' }));

  // Arabic counts its nouns in four shapes. Every one of them, both nouns.
  check('one is the noun alone', countAr(1, STEPS_AR) === 'خطوة واحدة' && countAr(1, FAILURES_AR) === 'حالة فشل واحدة');
  check('two is the dual, not a numeral', countAr(2, STEPS_AR) === 'خطوتان' && countAr(2, FAILURES_AR) === 'حالتا فشل');
  check('three to ten take the plural', countAr(5, STEPS_AR) === '5 خطوات' && countAr(10, FAILURES_AR) === '10 حالات فشل');
  check('eleven and up take the singular', countAr(11, STEPS_AR) === '11 خطوة' && countAr(40, FAILURES_AR) === '40 حالة فشل');
  check('zero is said in words', countAr(0, STEPS_AR) === 'دون خطوات' && countAr(0, FAILURES_AR) === 'دون فشل');
  check('a fraction or a string does not produce NaN', countAr('3', STEPS_AR) === '3 خطوات' && countAr(undefined, FAILURES_AR) === 'دون فشل');

  const svgD = flowToSvg(buildFlow(sess, clicks(2)));
  const strip = (svgD.match(/مخطط سير العمل[^<]*/) || [''])[0];
  check('the ISO date is isolated, so it cannot reverse in the RTL line', strip.includes('⁦2026-09-05⁩'), strip);
  check('the strip agrees with what it counts', strip.includes('خطوتان') && strip.includes('دون فشل') && !/\d+ خطوة /.test(strip), strip);

  const svgMany = flowToSvg(buildFlow(sess, clicks(5)));
  check('five steps read as five', (svgMany.match(/مخطط سير العمل[^<]*/) || [''])[0].includes('5 خطوات'));
}

/* ── an arrow into the end is not a verdict ──────────────────────────────── */
{
  const t = 1_820_000_000_000;
  const sess = { id: 'sE', charter: 'x', startedAt: t, startUrl: 'https://x.test/a' };
  const flow = buildFlow(sess, [
    { kind: 'dom', ts: t + 1000, action: 'click', tag: 'button', label: 'إرسال', frameUrl: 'https://x.test/a' },
    { kind: 'net', ts: t + 1200, method: 'POST', url: 'https://x.test/api/a', status: 500, frameUrl: 'https://x.test/a' },
  ]);
  const end = flow.nodes.find((nd) => nd.kind === 'end');
  const intoEnd = flow.edges.filter((e) => e.to === end.id);
  check('the arrow into the end is neutral, never "yes: it worked"', intoEnd.length === 1 && intoEnd[0].kind === 'flow' && !intoEnd[0].label, JSON.stringify(intoEnd));
  check('the legend does not promise a success that was not observed', !usedLegend(flow).some((l) => l.kind === 'yes'));

  // a decision that really did continue keeps its green arrow
  const carried = buildFlow(sess, [
    { kind: 'dom', ts: t + 1000, action: 'click', tag: 'button', label: 'إرسال', frameUrl: 'https://x.test/a' },
    { kind: 'net', ts: t + 1200, method: 'POST', url: 'https://x.test/api/a', status: 500, frameUrl: 'https://x.test/a' },
    { kind: 'nav', ts: t + 2000, url: 'https://x.test/done' },
  ]);
  check('a decision that continued into another step keeps its yes', carried.edges.some((e) => e.kind === 'yes'));
}

/* ── the English line under a node says that it is one line ─────────────── */
{
  const t = 1_830_000_000_000;
  const sess = { id: 'sL', charter: 'x', startedAt: t, startUrl: 'https://x.test/a' };
  const flow = buildFlow(sess, ['Applicant name', 'Email address', 'Phone number'].map((label, i) => ({
    kind: 'dom', ts: t + 1000 + i * 100, action: 'input', tag: 'input', label, frameUrl: 'https://x.test/a',
  })));
  const input = flow.nodes.find((nd) => nd.kind === 'input');
  const svgL = flowToSvg(flow);
  const i = svgL.indexOf(`data-node="${input.id}"`);
  const enLine = (svgL.slice(i, i + 1400).match(/<text[^>]*opacity="\.78"[^>]*>[^<]*/) || [''])[0].replace(/<[^>]*>/, '');
  check('a truncated English line ends in an ellipsis, not a dangling comma', enLine.endsWith('…') && !/,…$/.test(enLine), enLine);
  check('a short English line is left exactly as it is', flowToSvg(buildFlow(sess, [{ kind: 'nav', ts: t, url: 'https://x.test/apply' }])).includes('>Open apply<'));
}

/* ── a label is a phrase a person would say ──────────────────────────────── */
/*
 * The two faults the critic found on screen in `research/36-frames`, asserted
 * on the label that is drawn.
 */
{
  const t = 1_840_000_000_000;
  const U = 'https://x.test/apply';
  const sess = { id: 'sP', charter: 'x', startedAt: t, startUrl: U };
  const NAV = 'PermitsportalHelpStatusDownloads';

  // 1. a click on the site header
  const header = buildFlow(sess, [{ kind: 'dom', ts: t + 1000, action: 'click', tag: 'header', label: NAV, frameUrl: U }])
    .nodes.find((nd) => nd.kind === 'process');
  check('a container is called what it is, never the text it contains', header.ar === 'النقر على «header»' && header.en === 'Click "header"', `${header.ar} / ${header.en}`);
  check('the run-together nav text is nowhere in the label', !header.ar.includes('Permits') && !header.en.includes('Permits'));
  check('a nav, a list and a table are containers too', ['nav', 'ul', 'table'].every((tag) => stepLabel({ label: 'one two three', tag }) === tag));
  check('a role can say it as well as a tag', stepLabel({ label: 'a b c', tag: 'div', role: 'navigation' }) === 'navigation');

  // the run-on test on its own, and the names it must not touch
  check('several words with no spaces are not a phrase', isRunOnName(NAV) && isRunOnName('SubmitApplicationFormNow'));
  check('an ordinary CamelCase name is still a name', ['PayPal', 'eBay', 'GitHub', 'MyAccount', 'iPhone'].every((x) => !isRunOnName(x)));
  check('a real phrase is never a run-on', ['Submit application', 'Country of origin', 'ابحث في الموقع'].every((x) => !isRunOnName(x)));
  check('a run-on on a plain control still falls back to the tag', stepLabel({ label: NAV, tag: 'a' }) === 'a' && stepLabel({ label: NAV }) === '');

  // 2. the Arabic comma in front of a Latin run
  const fields = ['Applicant name', 'Email', 'Country of origin'];
  const flow = buildFlow(sess, fields.map((label, i) => ({ kind: 'dom', ts: t + 2000 + i * 100, action: 'input', tag: 'input', label, frameUrl: U })));
  const input = flow.nodes.find((nd) => nd.kind === 'input');
  check('the model carries no bidi control of its own', !/[\u200E\u200F\u2066-\u2069\u202A-\u202E]/.test(input.ar), input.ar);
  check('a label cannot smuggle one in either', !/[\u2066-\u2069]/.test(clampLabel('a ⁦b⁩ c')), JSON.stringify(clampLabel('a ⁦b⁩ c')));

  const svg = flowToSvg(flow);
  const i = svg.indexOf(`data-node="${input.id}"`);
  const lines = (svg.slice(i, i + 1400).match(/<tspan[^>]*>[^<]*/g) || []).map((m) => m.replace(/<[^>]*>/, ''));
  const opens = (x) => (x.match(/\u2066/g) || []).length;
  const closes = (x) => (x.match(/\u2069/g) || []).length;
  check('every drawn line closes every isolate it opens', lines.length > 1 && lines.every((l) => opens(l) === closes(l)), JSON.stringify(lines));
  check('no run is isolated twice', lines.every((l) => !l.includes('⁦⁦') && !l.includes('⁩⁩')), JSON.stringify(lines));
  check('each Latin run gets an isolate of its own', lines.some((l) => /⁦Applicant name⁩، ⁦Email⁩/.test(l)), JSON.stringify(lines));
  check('the Arabic comma stays outside the isolate, after the run', lines.every((l) => !/⁦[^⁩]*،/.test(l)), JSON.stringify(lines));
}

console.log(`test-flow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
