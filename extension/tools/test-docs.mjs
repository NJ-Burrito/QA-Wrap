/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// The workbook writer, the documentation pack, and the filing tree with audiences.
import { crc32, zipStored, buildXlsx, colRef, toBase64, fromBase64 } from '../core/xlsx.js';
import { buildSrs, buildSrsHtml, buildManual, buildStoryboard, buildStoryboardHtml, buildSessionManifest, storyboardScenes, paintStatuses } from '../core/docs.js';
import { buildTimelineWorkbook, buildSessionWorkbook } from '../core/sheets.js';
import { ROOT, filePath, FORMATS, treePaths, describeDestination, exportPath, evidencePath, withFolder } from '../core/filing.js';
import { DEFAULTS, DOWNLOAD_FOLDER_HELP } from '../platform/settings.js';
import { loadDocFonts, sessionIsArabic } from '../core/docshell.js';

// `buildSrsHtml`/`buildStoryboardHtml` below reach `shell()`, which refuses to
// build without this having resolved first (core/docshell.js). Every real
// caller reaches it through `background/export-build.js`'s `brandAssets()`;
// this file calls the builders directly, so it does the same thing here once.
await loadDocFonts();

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const dec = new TextDecoder();

/** Enough of a zip reader to list STORED entries: name → bytes. */
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  let p = 0;
  while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true);
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const name = dec.decode(bytes.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extraLen;
    out[name] = bytes.subarray(start, start + size);
    p = start + size;
  }
  return { entries: out, centralAt: p, count: Object.keys(out).length };
}

/* ── r7-07-3 / r8-14-2 / r8-05-5 / r8-07-5: the README limits and the architecture header are the code's numbers ── */
{
  const fs = await import('node:fs');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const arch = fs.readFileSync(new URL('../ARCHITECTURE.md', import.meta.url), 'utf8');
  const { ROW_CAP, BODY_CAP, LOW_DISK } = await import('../background/write-queue.js');
  const replayMiB = Number(/const MAX_SESSION_BYTES = (\d+) \* 1024 \* 1024;/.exec(fs.readFileSync(new URL('../content/replay-recorder.js', import.meta.url), 'utf8'))?.[1]);
  const num = (re) => Number((re.exec(readme)?.[1] || 'NaN').replace(/,/g, ''));
  check('README: the row cap equals ROW_CAP', num(/\*\*([\d,]+) events\.\*\*/) === ROW_CAP, `${num(/\*\*([\d,]+) events\.\*\*/)} vs ${ROW_CAP}`);
  check('README: the body cap equals BODY_CAP (MiB)', num(/\*\*(\d+) MiB of request and response bodies/) * 1024 * 1024 === BODY_CAP);
  check('README: the low-disk line equals LOW_DISK (MiB)', num(/\*\*Under (\d+) MiB of free browser storage/) * 1024 * 1024 === LOW_DISK);
  check('README: the replay cap equals the recorder MAX_SESSION_BYTES (MiB)', replayMiB > 0 && num(/\*\*(\d+) MiB of page replay/) === replayMiB);
  check('README: names the Web Worker and Service Worker limit', /requests made from Web Workers and Service Workers/.test(readme));
  const head = /^\*\*QA Wrap (\d+\.\d+\.\d+)\.\*\* Rewritten /m.exec(arch);
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  check('ARCHITECTURE.md: the header version equals manifest.json', head?.[1] === manifest.version, `${head?.[1]} vs ${manifest.version}`);
}

/* ── zip / xlsx ───────────────────────────────────────────────────────── */
{
  check('crc32 of "123456789" is CBF43926', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
  check('colRef', colRef(0) === 'A' && colRef(25) === 'Z' && colRef(26) === 'AA' && colRef(701) === 'ZZ' && colRef(702) === 'AAA');

  const z = zipStored([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.txt', data: new Uint8Array([1, 2, 3]) }], new Date(2026, 8, 3, 10, 30));
  const u = unzip(z);
  check('zip: two local entries readable', u.count === 2 && dec.decode(u.entries['a.txt']) === 'hello' && u.entries['dir/b.txt'].length === 3);
  const dv = new DataView(z.buffer);
  check('zip: central directory follows the entries', dv.getUint32(u.centralAt, true) === 0x02014b50);
  check('zip: end record last', dv.getUint32(z.length - 22, true) === 0x06054b50 && dv.getUint16(z.length - 22 + 10, true) === 2);
  check('zip: crc stored matches', dv.getUint32(14, true) === crc32(new TextEncoder().encode('hello')));

  const wb = buildXlsx([{ name: 'Timeline', rows: [['at', 'kind', 'n'], ['+1s', 'dom <click> & "x"', 3], ['+2s', 'net', 4.5]] }, { name: 'Bad/Name:Here?', rows: [['k', 'v'], ['a', true]] }], { title: 'T', when: new Date(2026, 8, 3) });
  const x = unzip(wb);
  const names = Object.keys(x.entries);
  check('xlsx: required parts present', ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'docProps/core.xml', 'docProps/app.xml'].every((n) => names.includes(n)), names.join(','));
  const sheet1 = dec.decode(x.entries['xl/worksheets/sheet1.xml']);
  check('xlsx: header bold + frozen', sheet1.includes('<c r="A1" t="inlineStr" s="1">') && sheet1.includes('state="frozen"'));
  check('xlsx: strings escaped, numbers numeric', sheet1.includes('dom &lt;click&gt; &amp; &quot;x&quot;') && sheet1.includes('<c r="C2"><v>3</v></c>') && sheet1.includes('<v>4.5</v>'));
  check('xlsx: autofilter over the table', sheet1.includes('<autoFilter ref="A1:C3"/>'));
  const wbx = dec.decode(x.entries['xl/workbook.xml']);
  check('xlsx: sheet name sanitised', wbx.includes('name="Bad Name Here"'));
  const core = dec.decode(x.entries['docProps/core.xml']);
  check('xlsx: creator is the product', core.includes('<dc:creator>QA Wrap</dc:creator>'));
  // The round-2 decision (research/56:194) supersedes decision 135: an XLSX
  // names Thmanyah rather than embedding it, because a spreadsheet's style
  // part has no slot for font bytes at all — Excel substitutes elsewhere.
  check('xlsx: names Thmanyah Sans, not Segoe UI; no Cairo', dec.decode(x.entries['xl/styles.xml']).includes('<name val="Thmanyah Sans"/>')
    && !/Cairo/.test(dec.decode(x.entries['xl/styles.xml']))
    && !/Segoe UI/.test(dec.decode(x.entries['xl/styles.xml'])));
  check('xlsx: booleans', dec.decode(x.entries['xl/worksheets/sheet2.xml']).includes('t="b"'));
  check('base64 round trip', fromBase64(toBase64(wb)).length === wb.length && fromBase64(toBase64(wb))[0] === 0x50);
}

/* ── a session to document ────────────────────────────────────────────── */
const session = { id: 's9', charter: 'Submit an application', startedAt: 1_750_000_000_000, endedAt: 1_750_000_300_000, startUrl: 'https://portal.example.test/apply', env: { platform: 'Win32', viewport: '1280×720', language: 'en-GB', userAgent: 'Chrome/140' } };
const T = session.startedAt;
const events = [
  { kind: 'nav', ts: T + 1000, url: 'https://portal.example.test/apply' },
  { kind: 'dom', ts: T + 3000, action: 'input', tag: 'input', label: 'Applicant name', value: 'Layla', frameUrl: 'https://portal.example.test/apply' },
  { kind: 'screenshot', ts: T + 3500, captureId: 'c1', text: 'Name typed' },
  { kind: 'dom', ts: T + 6000, action: 'click', tag: 'button', label: 'Submit application', frameUrl: 'https://portal.example.test/apply' },
  { kind: 'net', ts: T + 6400, method: 'POST', url: 'https://portal.example.test/api/applications', status: 500, durationMs: 300, frameUrl: 'https://portal.example.test/apply' },
  { kind: 'screenshot', ts: T + 7000, captureId: 'c2', text: 'Error shown' },
  { kind: 'note', ts: T + 9000, text: 'Is the reference number meant to appear here?', tag: 'question' },
  { kind: 'perf', ts: T + 10000, metrics: { lcp: 1800, cls: 0.02, inp: 90 }, ratings: { lcp: 'good' } },
  { kind: 'a11y', ts: T + 11000, total: 2, violations: [{ id: 'label', impact: 'critical', count: 2 }] },
  { kind: 'links', ts: T + 12000, total: 5, checked: 5, broken: [], redirected: [], slow: [] },
  { kind: 'harvest', ts: T + 13000, dir: 'ltr', elements: [{ n: 0, kind: 'field', label: 'Applicant name', required: true, tag: 'input', type: 'text' }, { n: 1, kind: 'button', name: 'Submit application', tag: 'button' }], forms: [{ n: 0, name: 'Application', fields: [0], submit: 1 }] },
];
const captures = { c1: { dataUrl: 'data:image/png;base64,AAAA' } };

{
  const srs = buildSrs(session, events);
  check('srs: title and standard', srs.startsWith('# Software Requirements Specification: Submit an application') && srs.includes('29148'));
  check('srs: scope lists the area', srs.includes('- https://portal.example.test/apply: '));
  check('srs: functional requirement from a step', /\*\*FR-01\.2\*\* The system shall allow the user to /.test(srs));
  check('srs: failed step marked', srs.includes('OBSERVED: FAILED'));
  check('srs: form requirement with required field', srs.includes('**FR-F1.0** "Applicant name" shall be required'));
  check('srs: failure behaviour is a GAP', /FR-E1.*GAP/.test(srs));
  check('srs: NFR from measured perf', srs.includes('Observed: 1800 ms') && srs.includes('OBSERVED: MET'));
  check('srs: a11y not met', /NFR-A1.*2 issue\(s\).*OBSERVED: NOT MET/.test(srs));
  check('srs: links met', /NFR-L1.*0 broken of 5.*OBSERVED: MET/.test(srs));
  check('srs: reliability not met', /NFR-R1.*OBSERVED: NOT MET/.test(srs));
  check('srs: verification table', srs.includes('| Requirement | Verified by | Status |'));
  check('srs: open question carried', srs.includes('Is the reference number meant to appear here?'));
  check('srs: gap count in the footer', /\d+ requirements; \d+ marked GAP/.test(srs));

  /* The status marks, as they are coloured in the exported page. A failed
     requirement painted green is worse than no colour at all, so this asserts
     the class AND the colour token the shell gives that class. */
  const srsHtml = buildSrsHtml(session, events);
  const colourOf = (cls) => (srsHtml.match(new RegExp(String.raw`\.${cls}\b[^{}]*\{[^}]*color:var\((--[a-z]+)\)`)) || [])[1];
  check('srs html: NOT MET is classed FAILED', srsHtml.includes('<span class="status-FAILED">OBSERVED: NOT MET</span>'));
  check('srs html: NOT MET is not left green', !/status-OBSERVED">OBSERVED<\/span>:?\s*(NOT MET|FAILED)/.test(srsHtml));
  check('srs html: the FAILED class paints var(--bad)', colourOf('status-FAILED') === '--bad', String(colourOf('status-FAILED')));
  check('srs html: a met requirement stays OBSERVED and var(--ok)', srsHtml.includes('<span class="status-OBSERVED">OBSERVED: MET</span>') && colourOf('status-OBSERVED') === '--ok');
  check('srs html: GAP paints var(--warn)', srsHtml.includes('<span class="status-GAP">GAP</span>') && colourOf('status-GAP') === '--warn');
  const failedMarks = (srs.match(/OBSERVED: (NOT MET|FAILED)/g) || []).length;
  const paintedBad = (srsHtml.match(/<span class="status-FAILED">OBSERVED[^<]*<\/span>/g) || []).length;
  check('srs html: every failed status in the markdown is painted bad', failedMarks > 0 && paintedBad === failedMarks, `${failedMarks} in markdown, ${paintedBad} painted`);
  // The bug this replaces: the class was keyed on the punctuation, so the
  // em-dash-to-colon copy sweep silently turned failures green.
  check('status painting keys on the token, not the punctuation',
    ['OBSERVED: NOT MET', 'OBSERVED — NOT MET', 'OBSERVED - FAILED', 'OBSERVED:FAILED'].every((t) => paintStatuses(t).startsWith('<span class="status-FAILED">'))
    && paintStatuses('OBSERVED').startsWith('<span class="status-OBSERVED">')
    && paintStatuses('OBSERVED: MET').startsWith('<span class="status-OBSERVED">'));
  /*
   * MANUAL is the fourth word in the vocabulary and has to be painted like one.
   *
   * `core/fine-print.js` files a check the browser could not measure — no
   * cookies to read, no HTTPS to look at — as MANUAL, and the exported block
   * carries the word into these documents. It was not in this painter, so it
   * came out as ordinary black prose beside a green OBSERVED and an amber GAP:
   * the one status meaning *nobody checked this* was the quietest mark on the
   * page. The colour is asserted too, because painting it and painting it the
   * same as a pass are the same failure.
   */
  check('status painting knows MANUAL, the fourth word in the vocabulary',
    paintStatuses('MANUAL') === '<span class="status-MANUAL">MANUAL</span>');
  check('MANUAL is painted as neither a pass nor a failure',
    /\.status-MANUAL\b[^{}]*\{[^}]*color:var\(--soft\)/.test(srsHtml),
    'the docshell has no rule for .status-MANUAL, so the span paints nothing');

  const man = buildManual(session, events, captures);
  check('manual: title', man.startsWith('# User manual: Submit an application'));
  check('manual: numbered step headings', man.includes('### 1. ') && man.includes('### 3. '));
  check('manual: screenshot embedded where it has data', man.includes('![Name typed](data:image/png;base64,AAAA)'));
  check('manual: screenshot without data is named', man.includes('_Screenshot: Error shown'));
  check('manual: failing step warned', man.includes('⚠ On the day this was recorded'));
  check('manual: troubleshooting names the request', man.includes('**If the request to /api/applications fails (500)**'));
  check('manual: fields table from the page map', man.includes('| Applicant name | yes |'));

  /* The same label rule the diagram needs, in the documents that quote a step:
     a requirement that carries 2,000 characters of page text is not readable,
     and a selector is not the name of anything. */
  const noisy = [
    { kind: 'nav', ts: T + 100, url: 'https://portal.example.test/Ar/Pages/%D9%84%D8%A7%D8%A6%D8%AD%D8%A9.aspx' },
    { kind: 'dom', ts: T + 200, action: 'click', tag: 'div', label: '#ticket-container{width:100%}#newsScroll{overflow:hidden}', frameUrl: 'https://portal.example.test/' },
    { kind: 'dom', ts: T + 300, action: 'keydown', key: 'Enter', tag: 'body', label: 'x'.repeat(2000), frameUrl: 'https://portal.example.test/' },
    { kind: 'dom', ts: T + 350, action: 'click', tag: 'button', label: 'y'.repeat(2000), frameUrl: 'https://portal.example.test/' },
  ];
  noisy.push({ kind: 'dom', ts: T + 400, action: 'click', tag: 'header', label: 'PermitsportalHelpStatusDownloads', frameUrl: 'https://portal.example.test/' });
  const noisySrs = buildSrs({ ...session, id: 's10' }, noisy);
  check('srs: a container is named for what it is, not for the nav it holds', !noisySrs.includes('Permitsportal') && /click header|Click header|header/.test(noisySrs));
  check('srs: no requirement carries a stylesheet as a name', !noisySrs.includes('#newsScroll') && !noisySrs.includes('{width:100%}'));
  check('srs: a keypress on the page is named for the element, not the page text', !/x{40}/.test(noisySrs) && /body/.test(noisySrs));
  check('srs: a page-length name on a control is capped', !/y{100}/.test(noisySrs) && noisySrs.includes('yyy…'));
  const frLines = noisySrs.split('\n').filter((l) => l.startsWith('- **FR'));
  check('srs: every requirement line stays a line', frLines.every((l) => l.length < 220), frLines.map((l) => l.length).join(','));

  const { scenes, totalSec } = storyboardScenes(session, events, captures);
  check('storyboard: title + 3 steps + 1 failure + outro', scenes.length === 6 && scenes[0].kind === 'title' && scenes[scenes.length - 1].kind === 'outro', String(scenes.length));
  check('storyboard: failure scene after its step', scenes[4].kind === 'failure' && scenes[4].step === 3);
  check('storyboard: timings accumulate', scenes[1].startSec === 4 && totalSec === scenes.reduce((n, s) => n + s.durationSec, 0));
  const sb = JSON.parse(buildStoryboard(session, events, captures));
  // No `$schema`: the only host it ever named does not exist and
  // never served a schema, so a dead URL was being written into every export.
  check('storyboard json: no dead $schema, voice and scenes present', sb.$schema === undefined && sb.voice.tone && sb.scenes.length === 6);
  check('storyboard json: image only where captured', sb.scenes.find((s) => s.screenshot === 'c1')?.image?.startsWith('data:') && !sb.scenes.find((s) => s.screenshot === 'c2')?.image);
  const html = buildStoryboardHtml(session, events, captures);
  check('storyboard html: six cards, print rule, product named', (html.match(/<article class="scene/g) || []).length === 6 && html.includes('@media print') && html.includes('QA Wrap'));

  const files = ['a.md', 'QA Wrap/Screenshots/01 One.png', 'QA Wrap/Screenshots/02 Two.png'];
  const mf = JSON.parse(buildSessionManifest(session, events, { tester: 'tester-1', version: '3.0.0', files }));
  check('manifest: identity and counts', mf.id === 's9' && mf.tester === 'tester-1' && mf.counts.failures === 1 && mf.counts.screenshots === 2 && mf.verdict === 'failures' && mf.files[0] === 'a.md');
  // The card describes the folder it ships in. An earlier session card said
  // seven screenshots beside six files (research/54, finding 13); a manifest
  // written with a file list now counts that list.
  const short = JSON.parse(buildSessionManifest(session, events, { files: ['a.md', 'QA Wrap/Screenshots/01 One.png'] }));
  check('manifest: the screenshot count is the files, not the events', short.counts.screenshots === 1);
  const noFiles = JSON.parse(buildSessionManifest(session, events, {}));
  check('manifest: with no file list it falls back to the events', noFiles.counts.screenshots === 2);
}

/* ── workbooks ────────────────────────────────────────────────────────── */
{
  const tl = unzip(buildTimelineWorkbook(session, events));
  const wb = dec.decode(tl.entries['xl/workbook.xml']);
  check('timeline workbook: four sheets', ['Summary', 'Timeline', 'Failures', 'Steps'].every((n) => wb.includes(`name="${n}"`)), wb);
  const s2 = dec.decode(tl.entries['xl/worksheets/sheet2.xml']);
  check('timeline sheet: header + one row per event', s2.includes('>at<') && (s2.match(/<row /g) || []).length === events.length + 1);
  check('timeline sheet: the 500 is there', s2.includes('/api/applications') && s2.includes('<v>500</v>'));
  const s3 = dec.decode(tl.entries['xl/worksheets/sheet3.xml']);
  check('failures sheet: cause named', s3.includes('Submit application'));

  const ss = unzip(buildSessionWorkbook(session, events));
  const wb2 = dec.decode(ss.entries['xl/workbook.xml']);
  check('session workbook: sheets', ['Session', 'Areas', 'Notes', 'Metrics'].every((n) => wb2.includes(`name="${n}"`)), wb2);
  const s1 = dec.decode(ss.entries['xl/worksheets/sheet1.xml']);
  check('session sheet: charter row', s1.includes('Submit an application'));
  const notes = dec.decode(ss.entries['xl/worksheets/sheet3.xml']);
  check('notes sheet: tagged question', notes.includes('question') && notes.includes('reference number'));
  // completion review 5 (T-053 step 3): an Arabic-language tester recording an English page gets an Arabic document; an English one does not.
  const enSession = { ...session, charter: 'Submit an application', env: { ...(session.env || {}), language: 'en-US' } };
  check('document language: env.language ar-JO makes an English-content session Arabic, en-US does not',
    sessionIsArabic({ ...enSession, env: { language: 'ar-JO' } }, []) === true && sessionIsArabic(enSession, []) === false);
  // completion review 3 (T-066): both workbooks list each screenshot's full SHA-256.
  const H = 'a'.repeat(64);
  const sha = (zip, n) => dec.decode(unzip(zip).entries[`xl/worksheets/sheet${n}.xml`]);
  check('workbooks: the Session sheet and the timeline Summary carry the full SHA-256',
    sha(buildSessionWorkbook(session, events, { c_1: H }), 1).includes(H) && sha(buildTimelineWorkbook(session, events, { c_1: H }), 1).includes(H)
    && !s1.includes(H));
}

/* ── filing ───────────────────────────────────────────────────────────── */
{
  check('root is the product name', ROOT === 'QA Wrap');
  const when = new Date(2026, 8, 4, 14, 32).getTime();
  const sess = { charter: 'Submit an application', startedAt: when };

  const p = filePath({ part: 'Bug report', kind: 'report', ext: 'md', when, clock: '24' });
  check('path: root, category, name-date-time', p === 'QA Wrap/Reports/Bug report-04-09-26-14-32.md', p);
  check('path: no spaces in the stamp', !/\d \d/.test(p));
  check('export path follows the format table', exportPath('markdown', sess) === 'QA Wrap/Reports/Submit an application 2026-09-04/Bug report - Submit an application 2026-09-04.md', exportPath('markdown', sess));
  check('export path: a document goes to Documents', exportPath('srs-html', sess) === 'QA Wrap/Documents/Submit an application 2026-09-04/Requirements specification - Submit an application 2026-09-04.html', exportPath('srs-html', sess));
  check('export path: a page object goes to Tests', exportPath('harvest-pom', sess) === 'QA Wrap/Tests/Submit an application 2026-09-04/Page object - Submit an application 2026-09-04.ts', exportPath('harvest-pom', sess));
  check('export path: the session card', exportPath('session-manifest', sess) === 'QA Wrap/Sessions/Submit an application 2026-09-04/Session card - Submit an application 2026-09-04.json', exportPath('session-manifest', sess));
  const ev = evidencePath({ ts: new Date(2026, 8, 4, 14, 33, 10).getTime(), type: 'image/png', label: 'Error shown', kind: 'screenshot' }, 2, sess, { clock: '24' });
  check('evidence: numbered, named, stamped', ev === 'QA Wrap/Screenshots/Submit an application 2026-09-04/02 Error shown - Submit an application 2026-09-04.png', ev);
  check('evidence: a clip', evidencePath({ ts: when, type: 'video/mp4', kind: 'recording' }, 1, sess).endsWith('QA Wrap/Recordings/Submit an application 2026-09-04/01 Recording - Submit an application 2026-09-04.mp4'));
  check('every category is a folder in the tree', treePaths().includes('QA Wrap/Reports') && treePaths().includes('QA Wrap/Screenshots') && treePaths().includes('QA Wrap/Documents'));
  check('the tree starts at the product folder', treePaths()[0] === 'QA Wrap');
  check('destination text names the root', describeDestination({ folderName: 'QA' }).includes('QA/QA Wrap/'));
  check('destination text promises the check', /checked and created/.test(describeDestination({ folderName: 'QA' })));
  check('every format but the card has a name and a category', Object.entries(FORMATS).filter(([k]) => k !== 'session-manifest').every(([, f]) => f.part && f.category));
  check('a name with illegal characters is made safe', filePath({ part: 'a/b:c*d?', kind: 'report', ext: 'md', when }).includes('a b c d'));

  /* "Remember the folder", as far as a browser lets an extension remember it.
     Chrome hands `chrome.downloads.download()` a path relative to Downloads and
     never says which folder its own dialog wrote to, so the whole of what can
     be kept is a subfolder name — prefixed here, on every path this file
     builds. */
  check('no folder set changes nothing at all', exportPath('markdown', sess) === `${ROOT}/Reports/Submit an application 2026-09-04/Bug report - Submit an application 2026-09-04.md`);
  check('a folder is prefixed in front of the product folder', exportPath('markdown', sess, { folder: 'Clients/ACME' }) === `Clients/ACME/${ROOT}/Reports/Submit an application 2026-09-04/Bug report - Submit an application 2026-09-04.md`, exportPath('markdown', sess, { folder: 'Clients/ACME' }));
  check('evidence goes to the same folder', evidencePath({ ts: when, type: 'image/png', label: 'Error', kind: 'screenshot' }, 2, sess, { clock: '24', folder: 'ACME' }).startsWith(`ACME/${ROOT}/Screenshots/`));
  check('a folder cannot climb out of Downloads', withFolder('a.md', '../../etc') === 'etc/a.md' && withFolder('a.md', '..') === 'a.md', withFolder('a.md', '../../etc'));
  check('an illegal character in a folder is made safe, and the nesting kept', withFolder('a.md', 'bad:name/deep') === 'bad name/deep/a.md', withFolder('a.md', 'bad:name/deep'));
  check('an empty, blank or missing folder is no folder', ['', '   ', null, undefined, '/', '//'].every((f) => withFolder('a.md', f) === 'a.md'));
  check('a gzipped export keeps the folder and the .gz', exportPath('markdown', sess, { gz: true, folder: 'ACME' }).startsWith('ACME/') && exportPath('markdown', sess, { gz: true, folder: 'ACME' }).endsWith('.gz'));

  check('the two save preferences have defaults', DEFAULTS.downloadFolder === '' && DEFAULTS.saveAs === false);
  check('the help text says what Chrome will not do, in the one place both surfaces read', /does not let an extension read the folder/.test(DOWNLOAD_FOLDER_HELP) && /Downloads\/QA Wrap/.test(DOWNLOAD_FOLDER_HELP));
}

{
  // T-043 (G20): every Alt+ shortcut the README names is real: a manifest command or an in-page keymap default.
  const fsx = await import('node:fs');
  const readme = fsx.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const manifest = JSON.parse(fsx.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const real = new Set([
    ...Object.values(manifest.commands || {}).map((c) => c.suggested_key?.default).filter(Boolean),
    ...Object.values(DEFAULTS.keymap).map((k) => k.replace(/Key([A-Z])$/, '$1')),
  ]);
  const named = [...readme.matchAll(/`((?:Ctrl\+|Alt\+|Shift\+)+[A-Z0-9])`/g)].map((m) => m[1]);
  check('the README names shortcuts at all', named.length >= 8, String(named.length));
  check('every shortcut the README names is a manifest command or an in-page default', named.every((k) => real.has(k)), named.filter((k) => !real.has(k)).join(', '));
}

{
  // council-1009 14-4 / 13-8: the ceiling row in ARCHITECTURE.md is the constants in test-worker-imports.mjs, and the counts it states are real.
  const fsx = await import('node:fs');
  const rd = (p) => fsx.readFileSync(new URL(p, import.meta.url), 'utf8');
  const gate = rd('./test-worker-imports.mjs');
  const num = (re) => Number((gate.match(re) || [])[1]);
  const direct = num(/^const MAX_DIRECT = (\d+);/m);
  const transitive = num(/^const MAX_TRANSITIVE = (\d+);/m);
  const kb = num(/^const MAX_BYTES = (\d+) \* 1024;/m);
  const arch = rd('../ARCHITECTURE.md');
  const row = (label) => Number(((arch.match(new RegExp('^\\| ' + label + ' \\| (\\d+)(?: KB)? \\|$', 'm'))) || [])[1]);
  check('the gate constants were read', direct > 0 && transitive > 0 && kb > 0, [direct, transitive, kb].join('/'));
  check('ARCHITECTURE.md ceiling: direct imports equals MAX_DIRECT', row('direct imports') === direct, String(row('direct imports')) + ' vs ' + direct);
  check('ARCHITECTURE.md ceiling: modules at boot equals MAX_TRANSITIVE', row('modules at boot') === transitive, String(row('modules at boot')) + ' vs ' + transitive);
  check('ARCHITECTURE.md ceiling: bytes at boot equals MAX_BYTES', row('bytes parsed at boot') === kb, String(row('bytes parsed at boot')) + ' vs ' + kb);
  const count = (dir, ext) => fsx.readdirSync(new URL('../' + dir + '/', import.meta.url)).filter((f) => f.endsWith(ext)).length;
  check('ARCHITECTURE.md core/ file count is the real one', arch.includes('core/       the product\'s ideas. Zero chrome.*. ' + count('core', '.js') + ' files'), String(count('core', '.js')));
  check('ARCHITECTURE.md platform/ file count is the real one', arch.includes('adapters. ' + count('platform', '.js') + ' files + i18n/'), String(count('platform', '.js')));
  // 01-4: the manifest holds <all_urls> as optional, so no store document may call it required.
  const manifest = JSON.parse(rd('../manifest.json'));
  if ((manifest.optional_host_permissions || []).includes('<all_urls>') && !(manifest.host_permissions || []).includes('<all_urls>')) {
    for (const doc of ['../store/CHECKLIST.md', '../store/LISTING.md', '../PRIVACY.md']) {
      check(doc + ' does not call <all_urls> required', !/<all_urls>`? (?:is|are) required/.test(rd(doc)));
    }
  }
  // 01-5: the offscreen justification states the number of duties it lists, and does not claim audio playback as a reason.
  const media = rd('../background/media.js');
  const just = (media.match(/justification:\s*([\s\S]*?),\s*\}\);/) || [])[1] || '';
  const words = { four: 4, five: 5, six: 6, seven: 7 };
  const stated = words[(just.match(/none of\s*'?\s*\+?\s*'?the (\w+)/) || [])[1]];
  const listed = (just.match(/records|re-encodes|loads|copies|plays/gi) || []).length;
  check('offscreen justification: the stated duty count equals the duties listed', stated === listed, stated + ' vs ' + listed);
  check('offscreen reasons do not include AUDIO_PLAYBACK (Chrome closes such a document after 30 s of silence)', !/reasons:\s*\[[^\]]*AUDIO_PLAYBACK/.test(media));
}

{
  // council-1009 r2-14-1 / r2-14-4: the testing prose points at the source of truth and carries no literal suite, check or error count.
  const fsx = await import('node:fs');
  const rd = (p) => fsx.readFileSync(new URL(p, import.meta.url), 'utf8');
  const arch = rd('../ARCHITECTURE.md');
  const testing = arch.slice(arch.indexOf('### Testing'), arch.indexOf('The headed harnesses'));
  check('ARCHITECTURE.md Testing section was found', testing.length > 100, String(testing.length));
  check('ARCHITECTURE.md Testing section states no literal suite, check or tsc figure', !/\b\d[\d,]*\s+(?:checks|suites|assertions|errors)\b|ceiling of \d|\b(?:seventy|sixty|eighty|ninety)[- ]\w+ suites\b/i.test(testing), (testing.match(/[^.\n]*\b\d[\d,]*\s+(?:checks|suites|assertions|errors)[^.\n]*/i) || [''])[0]);
  const support = rd('../SUPPORT.md');
  check('SUPPORT.md states no literal assertion count', !/\b\d+-odd assertions\b|\b\d[\d,]*\s+(?:assertions|checks)\b/i.test(support), (support.match(/[^\n]*-odd assertions[^\n]*/) || [''])[0]);
}

{
  // r5-14-1: the changelog names the behaviour changes a user of the CSV or the API tool will notice
  const fsx = await import('node:fs');
  const log = fsx.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const top = log.slice(log.indexOf('## '), log.indexOf('## 3.4.0'));
  const cur = JSON.parse(fsx.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  check('CHANGELOG.md has the dated current-version section above 3.4.0 (r9-14-2, D-244; an Unreleased block between releases is allowed since the update-check lane, test-release-notes requires it)', log.split('\n').some((l) => l.startsWith(`## ${cur}, `) && /^## [\d.]+, \d{4}-\d{2}-\d{2}$/.test(l)) && log.indexOf(`## ${cur}`) < log.indexOf('## 3.4.0'), top.slice(0, 40));
  check('CHANGELOG.md Unreleased names the CSV byte-order mark', /CSV[\s\S]*\bBOM\b/i.test(top), '');
  check('CHANGELOG.md Unreleased names the API-tool policy refusal', /API tool[\s\S]*managed policy[\s\S]*refused/i.test(top), '');
  const guard = await import('./lib-release-guard.mjs');
  const man = JSON.parse(fsx.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  check('lib-release-guard still finds the dated section for the manifest version', guard.changelogUndated(log, man.version) === null, String(guard.changelogUndated(log, man.version)));
}

{
  // council-1010 r3-14-2 / D-1010-55: page text in the Markdown builders is escaped, and every standalone document carries the meta CSP.
  const { marked } = await import('marked');
  const { DOC_CSP } = await import('../core/docshell.js');
  const BAD = '[go](javascript:alert(1)) ![p](http://evil.test/p.png) <script>x()</script> # H1 | a | b | - item';
  const BADL = ['Click [go](javascript:alert(1))', '# Injected heading', '| a | b |', '|---|---|', '- item ![p](http://evil.test/p.png) <b>raw</b>'].join('\n');
  const twin = (v, long) => events.map((e) => (e.kind === 'dom' ? { ...e, label: v } : e.kind === 'note' ? { ...e, text: v } : e.kind === 'screenshot' ? { ...e, text: v } : e.kind === 'harvest' ? { ...e, elements: e.elements.map((x) => ({ ...x, label: x.label ? v : x.label, name: x.name ? v : x.name })) } : e));
  const count = (md) => {
    const c = {};
    const walk = (ts) => { for (const t of ts) { c[t.type] = (c[t.type] || 0) + 1; if (t.tokens) walk(t.tokens); if (t.items) walk(t.items); } };
    walk(marked.lexer(md));
    return c;
  };
  const shapes = (fn) => {
    const hostile = fn(twin(BAD));
    const benign = fn(twin('Plain label'));
    return { hostile: count(hostile), benign: count(benign), raw: hostile };
  };
  for (const [name, fn] of [['buildSrs', (ev) => buildSrs(session, ev)], ['buildManual', (ev) => buildManual(session, ev, captures)]]) {
    const { hostile, benign, raw } = shapes(fn);
    const keys = ['heading', 'table', 'list', 'blockquote', 'html', 'link', 'image', 'code', 'hr'];
    check(`${name}: a hostile label yields the same block and link counts as a benign twin`, JSON.stringify(keys.map((k) => hostile[k] || 0)) === JSON.stringify(keys.map((k) => benign[k] || 0)), JSON.stringify({ hostile, benign }));
    const bare = raw.replace(/\\./g, ''); // escaped characters are text
    check(`${name}: no raw script tag, javascript link or foreign image survives in the Markdown`, !/<script/i.test(bare) && !/\]\(javascript:/i.test(bare) && !/\]\(http:\/\/evil/i.test(bare));
  }
  {
    // a label that carries its own line breaks must not open a heading, list or table
    const ev = twin(BADL);
    const a = count(buildSrs(session, ev)); const b = count(buildSrs(session, twin('Plain label')));
    check('buildSrs: line breaks in a label do not add a heading, list item or table', (a.heading || 0) === (b.heading || 0) && (a.table || 0) === (b.table || 0) && (a.list_item || 0) === (b.list_item || 0), JSON.stringify({ a, b }));
  }
  for (const [name, html] of [['buildSrsHtml', buildSrsHtml(session, events)], ['buildStoryboardHtml', buildStoryboardHtml(session, events, captures)]]) {
    check(`${name}: the meta CSP follows the charset and a hostile label adds no script`, html.includes('<meta charset="utf-8">') && html.includes(`content="${DOC_CSP}"`) && html.indexOf('Content-Security-Policy') < html.indexOf('<style>'));
  }
  const hostileHtml = buildSrsHtml(session, twin(BAD));
  check('buildSrsHtml with a hostile label has no script element or inline handler', !/<script/i.test(hostileHtml) && !/\son\w+=/i.test(hostileHtml.replace(/<style[\s\S]*?<\/style>/, '')));
}

// r7-13-3: one HTML escaper. docshell.js owns it (and escapes the apostrophe); the module copies are gone.
{
  const fsx = await import('node:fs');
  const { escHtml } = await import('../core/docshell.js');
  check('escHtml escapes & < > " and the apostrophe', escHtml(`a&b<c>d"e'f`) === 'a&amp;b&lt;c&gt;d&quot;e&#39;f', escHtml(`a&b<c>d"e'f`));
  check('escHtml answers "" for null and undefined', escHtml(null) === '' && escHtml(undefined) === '');
  const COPY = /\.replace\(\/&\/g, '&amp;'\)/;
  for (const f of ['docs', 'flow', 'mdhtml', 'provenance-stamp', 'xlsx', 'exporters']) {
    const src = fsx.readFileSync(new URL(`../core/${f}.js`, import.meta.url), 'utf8');
    check(`core/${f}.js imports escHtml and carries no escaper of its own`, /import \{[^}]*\bescHtml\b[^}]*\} from '\.\/docshell\.js'/.test(src) && !COPY.test(src));
  }
  check('core/docshell.js is the one module that spells the escaper', COPY.test(fsx.readFileSync(new URL('../core/docshell.js', import.meta.url), 'utf8')));
}

{
  // council-1010 r9-14-1: the Firefox source-submission guide names the version the tree really has (package.json), on both lines that carry one.
  const fsx = await import('node:fs');
  const ver = JSON.parse(fsx.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const guide = fsx.readFileSync(new URL('../store/FIREFOX-SOURCE-SUBMISSION.md', import.meta.url), 'utf8');
  const named = [...guide.matchAll(/qa-wrap-(\d+\.\d+\.\d+)-firefox\.zip/g)].map((m) => m[1]);
  const row = /package version \| (\d+\.\d+\.\d+)/.exec(guide)?.[1];
  check('FIREFOX-SOURCE-SUBMISSION.md names the package.json version (table row and zip name)', row === ver && named.length > 0 && named.every((v) => v === ver), `package.json ${ver}, table ${row}, zip names ${named}`);
}


{
  // council-1010 r2-14-2: the Mattermost paragraph says where the token lives (the vault), not that it sits in storage.local.
  const fsx = await import('node:fs');
  const arch = fsx.readFileSync(new URL('../ARCHITECTURE.md', import.meta.url), 'utf8');
  const at = arch.indexOf('**`chat-mattermost.js`**');
  const para = arch.slice(at, arch.indexOf('\n- **', at + 10));
  check('ARCHITECTURE.md chat-mattermost paragraph names the vault', at > 0 && /vault/i.test(para) && /secret\s+scan/i.test(para), para.slice(0, 120));
}

{
  // r10-14-2 (D-226): the release docs name the real gate and its exit line; npm test is a quick check only.
  const fsx = await import('node:fs');
  const gate = JSON.parse(fsx.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts['test:release-gate'] || '';
  check('package.json defines test:release-gate as test:full, test:a11y and the clickthrough', /test:full/.test(gate) && /test:a11y/.test(gate) && /clickthrough/.test(gate), gate);
  for (const f of ['RELEASE.md', 'store/CHECKLIST.md']) {
    const t = fsx.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    check(`${f} names npm run test:release-gate as the gate with its exit line`, t.includes('npm run test:release-gate') && t.includes('run-suites: <N> suites, 0 red') && t.includes('red: (none)'), '');
    check(`${f} calls npm test a quick check, not the gate`, /quick check/.test(t) && /npm test/.test(t), '');
  }
}

{
  // r10-14-3 (D-245): the lockup tool says what is missing and where to get it, instead of a bare ENOENT.
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const fsx = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const empty = fsx.mkdtempSync(`${os.tmpdir()}/qaw-no-fonts-`);
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../../identity/tools/product-lockup.mjs', import.meta.url))], { env: { ...process.env, QAW_FONT_DIR: empty }, encoding: 'utf8' });
  fsx.rmSync(empty, { recursive: true, force: true });
  const err = run.stderr || '';
  check('product-lockup.mjs with no faces exits non-zero with one named error (face, folders searched, NOTICE licence)', run.status !== 0 && /cannot find thmanyah/i.test(err) && err.includes(empty) && err.includes('extension/NOTICE') && !/ENOENT/.test(err), err.split('\n').find((l) => /Error/.test(l)) || err.slice(0, 120));
  const brand = fsx.readFileSync(new URL('../../identity/BRAND.md', import.meta.url), 'utf8');
  check('BRAND.md documents where the lockup faces come from (QAW_FONT_DIR, work/fonts-staged, NOTICE)', brand.includes('Where the faces come from') && brand.includes('QAW_FONT_DIR') && brand.includes('work/fonts-staged') && brand.includes('extension/NOTICE'), '');
}

console.log(`test-docs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
