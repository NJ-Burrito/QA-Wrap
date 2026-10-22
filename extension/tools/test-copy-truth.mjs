/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/**
 * T-008 / T-029 (DEC-05): the public copy stays true.
 *
 *   node tools/test-copy-truth.mjs            run the checks
 *   QAW_REBASELINE_REASON="why" node tools/test-copy-truth.mjs --write-baseline
 *                                             re-snapshot the grandfathered absolute sentences (manual owner command:
 *                                             refused under `npm run` and without a reason; prints the diff first)
 *
 *   1. The ten quoted sentences (copy-claims.json) are still in their files and
 *      each is bound to a test that is in package.json scripts.test.
 *   2. No retired sentence (retired-sentences.json) and no forbidden word
 *      ("evidence you can sign", "tamper-proof"; "accessible"/"WCAG" on the
 *      listing and the home page, DEC-04) is in a public document.
 *   3. A new absolute sentence in PRIVACY.md ("never", "always", "nothing ...")
 *      needs a row in copy-claims.json or the baseline: it is flagged otherwise.
 *   4. Every "nothing leaves" sentence names the Jira / tracker / webhook exception.
 *   5. The listing summary is at most 132 characters.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebaselineGuard } from './lib-assert.mjs';
import { workerSrc } from './lib-worker-src.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(HERE, '..');
const REPO = path.join(EXT, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const BASELINE = path.join(HERE, 'copy-claims-baseline.json');
const REG = await import('../core/store-registry.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const norm = (s) => s.replace(/[*_`>#|]/g, '').replace(/\s+/g, ' ').trim();
const ABSOLUTE = /\b(never|always|nothing|no (?:\w+ )?(?:is|are|server|account))\b/i;

// r2-03-1 / r2-14-4 / r2-03-4: three public sentences that were true in code and missing from the copy.
test('r2-03-1: the vault paragraph names the Mattermost account token as the one page-side exception, in PRIVACY.md and on the site (EN and AR)', () => {
  const md = norm(read('extension/PRIVACY.md'));
  assert.match(md, /decrypted only inside the extension's service worker.{0,200}The one exception is the Mattermost account token, which the report page opens only while it is posting/, 'PRIVACY.md');
  const html = norm(read('site/privacy.html').replace(/<[^>]+>/g, ''));
  assert.match(html, /The one exception is the Mattermost account token, which the report page opens only while it is posting/, 'site EN');
  assert.match(html, /والاستثناء الوحيد رمز حساب Mattermost[^.]{0,80}صفحة التقرير أثناء إرسال المشاركة فقط/, 'site AR');
});

test('r4-03-2 (D-1010-74): the sync:settings registry row, PRIVACY.md and the site (EN and AR) say the download folder, the extra mask pattern and the extra redaction words sync, and to keep secrets and client names out of them', () => {
  const row = REG.REGISTRY.find((r) => r.id === 'sync:settings');
  for (const k of ['downloadFolder', 'maskExtraPattern', 'redactExtra']) assert.ok(row.syncs.includes(k), `${k} is a synced key`);
  assert.match(row.holds, /download folder, the extra mask pattern and the extra redaction words sync too, so keep secrets and client names out of them/, 'registry row');
  const en = /download folder, the extra mask pattern and the extra redaction words\. They sync with the rest, so keep secrets and client names out of them/;
  assert.match(norm(read('extension/PRIVACY.md')), en, 'PRIVACY.md');
  assert.match(norm(read('site/privacy.html').replace(/<[^>]+>/g, '')), en, 'site EN');
  assert.match(norm(read('site/privacy.html').replace(/<[^>]+>/g, '')), /ونمط الإخفاء الإضافي وكلمات الحجب الإضافية[^.]{0,20}\. تُزامَن مع بقية التفضيلات، فأبقِ الأسرار وأسماء العملاء خارجها/, 'site AR');
});

test('r4-02-2 (D-1010-71): PRIVACY.md and the site (EN and AR) say cookie profiles and API variables are sealed, and the registry rows say encrypted', () => {
  for (const key of ['cookieProfiles', 'apiEnvironments']) assert.match(REG.REGISTRY.find((r) => r.key === key).holds, /encrypted/, key);
  const en = /Saved cookie profiles and the variables you keep in the API tool are sealed the same way/;
  assert.match(norm(read('extension/PRIVACY.md')), en, 'PRIVACY.md');
  assert.match(norm(read('site/privacy.html').replace(/<[^>]+>/g, '')), en, 'site EN');
  assert.match(norm(read('site/privacy.html').replace(/<[^>]+>/g, '')), /تُختم ملفات تعريف الارتباط المحفوظة والمتغيرات التي تحفظها في أداة واجهة البرمجة بالطريقة نفسها/, 'site AR');
});

test('r10-14-1 (D-225): the outbound-path and data-use claims name the API tool, the link checker and the cookie and header data (LISTING.md, PRIVACY.md, the site EN and AR)', () => {
  const listing = norm(read('extension/store/LISTING.md'));
  const uploads = listing.slice(listing.indexOf('It never uploads anything of its own'), listing.indexOf('It does not record password fields'));
  assert.match(uploads, /API tool.{0,120}cookies for that host/, 'LISTING.md:30 names the API tool and its cookies');
  assert.match(uploads, /link checker/, 'LISTING.md:30 names the link checker');
  assert.ok(!/Data leaves only to a Jira site, tracker or webhook you configure/.test(listing), 'the narrower sentence is gone');
  const use = listing.slice(listing.indexOf('Data use disclosures:'), listing.indexOf('## Assets'));
  assert.match(use, /cookie values and request headers/, 'LISTING.md:114 names cookie values and request headers as authentication data');
  assert.match(use, /API tool/); assert.match(use, /link-checker/);
  assert.ok(!/All of it stays local unless the user files a report/.test(use), 'the "stays local unless a report" sentence is gone');
  const clause = /nothing leaves it except where you configure Jira, a tracker or a webhook, or where you send the one request you wrote in the API tool or run the link checker/;
  assert.match(norm(read('extension/PRIVACY.md')), clause, 'PRIVACY.md summary');
  const site = norm(read('site/privacy.html').replace(/<[^>]+>/g, ''));
  assert.match(site, clause, 'site EN');
  assert.match(site, /يغادره إلا حيث تعد Jira أو أداة تتبع أو ويب هوك، أو ترسل الطلب الواحد الذي كتبته في أداة API أو تشغل فاحص الروابط/, 'site AR');
});

test('r2-14-4: every public statement of the header read says it happens only on sites you have granted access to (D-1010-37)', () => {
  const en = /reading six security headers off each response while a session is recording and only on sites you have granted access to/;
  assert.match(norm(read('extension/PRIVACY.md')), en, 'PRIVACY.md');
  assert.match(norm(read('site/privacy.html').replace(/<[^>]+>/g, '')), en, 'site EN');
  assert.match(norm(read('site/privacy.html').replace(/<[^>]+>/g, '')), /أثناء تسجيل جلسة، وفي المواقع التي منحتها الوصول فقط/, 'site AR');
  const listing = norm(read('extension/store/LISTING.md'));
  assert.equal((listing.match(/while a session is recording and only on sites you have granted access to/g) || []).length, 2, 'LISTING.md: the permission table and the justification');
});

test('r2-03-4: a pinned session outliving the retention window is stated in PRIVACY.md and on the site (EN and AR)', () => {
  assert.match(norm(read('extension/PRIVACY.md')), /A pinned session is kept past the retention window\. A session you pinned is not deleted by the daily sweep, whatever its age, until you unpin it/);
  const html = norm(read('site/privacy.html').replace(/<[^>]+>/g, ''));
  assert.match(html, /A pinned session is kept past the retention window\. A session you pinned is not deleted by the daily sweep/);
  assert.match(html, /الجلسة المثبتة تبقى بعد انتهاء مدة الاحتفاظ/);
});

/** Absolute sentences of a document that no claim anchor covers and the baseline does not grandfather. */
export function uncoveredAbsolutes(text, anchors, baseline) {
  const out = [];
  for (const para of text.split(/\n\s*\n/)) {
    for (const sentence of norm(para).split(/(?<=[.!?])\s+/)) {
      if (!ABSOLUTE.test(sentence)) continue;
      const key = sentence.slice(0, 80);
      if (baseline.includes(key)) continue;
      if (anchors.some((a) => sentence.includes(norm(a)) || norm(a).includes(sentence))) continue;
      out.push(key);
    }
  }
  return out;
}

const claims = JSON.parse(fs.readFileSync(path.join(HERE, 'copy-claims.json'), 'utf8')).claims;
const pkg = JSON.parse(fs.readFileSync(path.join(EXT, 'package.json'), 'utf8'));
const privacy = read('extension/PRIVACY.md');
const anchorsFor = (file) => claims.filter((c) => c.file === file).map((c) => c.anchor);

// The public page carries the same promises in HTML; text only, one block per paragraph, so the same check reads it.
const siteText = (f) => read(f).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|li|h\d|div|tr|section)>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

if (process.argv.includes('--write-baseline')) {
  const keys = uncoveredAbsolutes(privacy, anchorsFor('extension/PRIVACY.md'), []);
  const site = [...new Set(uncoveredAbsolutes(siteText('site/privacy.html'), anchorsFor('site/privacy.html'), []))];
  const reason = rebaselineGuard('--write-baseline');
  const before = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { sentences: [], site: [] };
  const diff = (a, b, tag) => [...b.filter((x) => !a.includes(x)).map((x) => `+ ${tag} ${x}`), ...a.filter((x) => !b.includes(x)).map((x) => `- ${tag} ${x}`)];
  const lines = [...diff(before.sentences || [], [...new Set(keys)], 'PRIVACY.md'), ...diff(before.site || [], site, 'site')];
  console.log(`baseline diff (${lines.length} change(s)), reason: ${reason}`);
  for (const l of lines) console.log(`  ${l}`);
  fs.writeFileSync(BASELINE, `${JSON.stringify({ _note: 'Absolute sentences in PRIVACY.md and (key site) site/privacy.html that existed when T-008 landed (1 Oct 2026), reviewed in that pass. New ones need a row in copy-claims.json.', sentences: [...new Set(keys)], site }, null, 2)}\n`);
  console.log(`baseline written: ${keys.length} + site ${site.length}`);
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).sentences;
const siteBaseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).site || [];

console.log('copy truth - the ten quoted sentences');
test('there are fourteen claims, each with an owner', () => {
  assert.equal(claims.length, 14);
  for (const c of claims) assert.ok(c.owner && c.id && c.test, c.id);
});
for (const c of claims) {
  test(`${c.id}: anchor is in ${c.file} and ${c.test} is in the test chain`, () => {
    assert.ok(read(c.file).replace(/\r\n/g, '\n').includes(c.anchor), `anchor moved or reworded: "${c.anchor}"`);
    assert.ok(fs.existsSync(path.join(EXT, c.test)), `${c.test} does not exist`);
    assert.ok(pkg.scripts['test:chain'].includes(`node ${c.test}`), `${c.test} is not in package.json scripts.test`);
  });
}

test('D-1010-120 / r5-14-2: release-check decodes every zip text entry and fails on the banned typeface or a Google font host', () => {
  const rc = read('extension/tools/release-check.mjs');
  assert.match(rc, /bannedInZip = names\.filter\(\(n\) => \/\\\.\(css\|js\|mjs\|html\|json\|svg\|md\|txt\)\$\//, 'the zip text scan is missing');
  assert.match(rc, /cairo\|fonts\\\.googleapis\|fonts\\\.gstatic/);
  assert.match(rc, /check\(!bannedInZip\.length/);
});

test('D-1010-119 / r5-14-1: no alarms row mentions a time-box or countdown, and its purpose maps to an alarms.create call', () => {
  const rows = [
    ...read('extension/PRIVACY.md').split('\n').filter((l) => /^\|\s*`alarms`/.test(l)),
    ...read('extension/store/LISTING.md').split('\n').filter((l) => /`alarms`|\*\*alarms\*\*/.test(l)),
    ...read('site/privacy.html').split('\n').filter((l) => /<code>alarms<\/code>/.test(l)),
  ];
  assert.ok(rows.length >= 5, `expected the alarms rows in PRIVACY.md, LISTING.md (2) and privacy.html (2); found ${rows.length}`);
  for (const r of rows) {
    assert.ok(!/time-?box|countdown|صندوق وقت|العد التنازلي/i.test(r), `alarms row still describes a time-box: ${r.trim().slice(0, 90)}`);
    if (!/[\u0600-\u06FF]/.test(r)) assert.ok(/daily purge of sessions older than the retention period/i.test(r), `alarms row lacks the retention purpose: ${r.trim().slice(0, 90)}`);
  }
  assert.ok(/alarms\??\.create\??\.?\(\s*'retention'/.test(workerSrc()), 'the named purpose (daily retention purge) has no alarms.create call');
});

console.log('\ncopy truth - what must not come back');
const PUBLIC = ['extension/PRIVACY.md', 'extension/SECURITY.md', 'extension/README.md', 'extension/ROADMAP.md', 'extension/TERMS.md',
  'extension/SUPPORT.md', 'extension/SLA.md', 'extension/store/LISTING.md', 'site/index.html', 'site/privacy.html', 'site/terms.html', 'site/support.html', 'site/trust.html', 'extension/ADMIN.md'];
test('no retired sentence is in a public document', () => {
  const list = path.join(HERE, 'retired-sentences.json');
  const sentences = fs.existsSync(list) ? JSON.parse(fs.readFileSync(list, 'utf8')).sentences : [];
  assert.ok(sentences.length >= 5, 'retired-sentences.json is missing or empty');
  const hits = [];
  for (const f of PUBLIC) { const t = read(f).toLowerCase(); for (const s of sentences) if (t.includes(s.text.toLowerCase())) hits.push(`${f}: ${s.text}`); }
  assert.deepEqual(hits, []);
});
test('no "evidence you can sign" or "tamper-proof" anywhere public (DEC-04)', () => {
  for (const f of PUBLIC) assert.doesNotMatch(read(f), /evidence you can sign|tamper-?proof/i, f);
});
test('the listing and the home page never say "accessible" or "WCAG" (DEC-04)', () => {
  for (const f of ['extension/store/LISTING.md', 'site/index.html']) assert.doesNotMatch(read(f), /\baccessible\b|WCAG/i, f);
});
test('the listing says a record you can hand over, and not "turn it into evidence"', () => {
  const t = read('extension/store/LISTING.md');
  assert.match(t, /a record of the session you can hand over/);
  assert.doesNotMatch(t, /turn it into evidence/i);
});

console.log('\ncopy truth - absolute sentences are bound');
test('PRIVACY.md has no absolute sentence without a row or a baseline entry', () => {
  assert.deepEqual(uncoveredAbsolutes(privacy, anchorsFor('extension/PRIVACY.md'), baseline), []);
});
test('site/privacy.html has no absolute sentence without a row or a baseline entry (Now-review fault 15)', () => {
  const text = siteText('site/privacy.html');
  assert.ok(text.length > 2000, 'R15: the page text was read');
  assert.deepEqual(uncoveredAbsolutes(text, anchorsFor('site/privacy.html'), siteBaseline), []);
  assert.equal(uncoveredAbsolutes(`${text}\n\nQA Wrap never stores anything anywhere.\n`, anchorsFor('site/privacy.html'), siteBaseline).length, 1, 'the check can fail on the page');
});
test('a scratch absolute sentence in PRIVACY.md is flagged (the check can fail)', () => {
  const scratch = `${privacy}\n\nAs of 1 October 2026 QA Wrap never stores anything anywhere.\n`;
  assert.equal(uncoveredAbsolutes(scratch, anchorsFor('extension/PRIVACY.md'), baseline).length, 1);
});
test('every "nothing leaves" sentence names the exception', () => {
  for (const f of ['extension/PRIVACY.md', 'extension/store/LISTING.md', 'extension/README.md', 'extension/SECURITY.md']) {
    for (const sentence of norm(read(f)).split(/(?<=[.!?])\s+/)) {
      if (/nothing leaves/i.test(sentence)) assert.match(sentence, /except where you configure|unless you|until you/i, `${f}: ${sentence.slice(0, 80)}`);
    }
  }
});

console.log('\ncopy truth - "nothing leaves" and the browser list (T-008 step 6, T-047)');
// The table: copy-claims.json "nothingLeaves" and "browsers". `open` rows are lines the guard found that still need a copy edit
// in a file outside this batch's write set; each is named, and a row that no longer matches a line must be deleted (stale).
const table = JSON.parse(fs.readFileSync(path.join(HERE, 'copy-claims.json'), 'utf8'));
const metaText = (html) => [...html.matchAll(/<meta[^>]+content="([^"]+)"/gi)].map((m) => m[1]).join('. ');
const docText = (f) => { const raw = read(f); return norm(f.endsWith('.html') ? `${siteText(f)} ${metaText(raw)}` : raw); };
const sentencesOf = (text) => text.split(/(?<=[.!?])\s+/);
const LEAVES = /\bnothing leaves\b|\bdata never leaves\b|\bdata leaves only\b|(?<![؀-ۿ])لا\s+(?:شيء\s+)?يغادر(?![؀-ۿ])/i;
const CLAUSE = /Jira|tracker|webhook|أداة تتبع|ويب هوك/i;
const nothingLeavesGaps = () => {
  const gaps = [];
  const check = (where, list, carried) => {
    list.forEach((s, i) => { if (LEAVES.test(s) && !CLAUSE.test(s) && !CLAUSE.test(list[i + 1] || '') && !carried?.(s)) gaps.push({ where, s }); });
  };
  for (const f of [...PUBLIC, 'extension/README.md', 'extension/SLA.md']) check(f, sentencesOf(docText(f)));
  for (const lang of ['en', 'ar']) {
    const j = JSON.parse(read(`extension/platform/i18n/${lang}.json`));
    for (const [k, v] of Object.entries(j)) {
      if (typeof v !== 'string') continue;
      const via = table.nothingLeaves.carriedBy[k];
      check(`i18n/${lang}:${k}`, sentencesOf(v), via ? () => CLAUSE.test(j[via] || '') : null);
    }
  }
  return gaps;
};
const openMatches = (open, gaps) => open.map((o) => ({ o, hit: gaps.some((g) => (g.where === o.file || (o.file.startsWith('i18n') && g.where.startsWith(o.file))) && g.s.includes(o.anchor)) }));
test('every "nothing leaves" claim names Jira, a tracker or a webhook, or is a named open row', () => {
  const gaps = nothingLeavesGaps();
  assert.ok(sentencesOf(docText('site/privacy.html')).some((s) => LEAVES.test(s)), 'R15: the scan saw a known "nothing leaves" line');
  const unnamed = gaps.filter((g) => !table.nothingLeaves.open.some((o) => g.where === o.file && g.s.includes(o.anchor)));
  assert.deepEqual(unnamed.map((g) => `${g.where}: ${g.s.slice(0, 90)}`), []);
});
test('a "nothing leaves" row marked open is still a gap (a fixed line leaves the table)', () => {
  const stale = openMatches(table.nothingLeaves.open, nothingLeavesGaps()).filter((x) => !x.hit).map((x) => `${x.o.file}: ${x.o.anchor}`);
  assert.deepEqual(stale, []);
});
test('no open rows: a known-fault row is a fault (completion review 1)', () => {
  assert.deepEqual([table.nothingLeaves.open, table.browsers.open], [[], []]);
});
test('the scan can fail: a scratch "nothing leaves" sentence is a gap, one with the clause is not', () => {
  assert.ok(LEAVES.test('Nothing leaves your machine.') && !CLAUSE.test('Nothing leaves your machine.'));
  assert.ok(LEAVES.test('لا شيء يغادر جهازك.') && !LEAVES.test('بمفتاح لا يغادره.') && !LEAVES.test('يجب ألا يغادر هذا الجهاز.'));
  assert.ok(CLAUSE.test('Nothing leaves it except where you configure Jira, a tracker or a webhook.'));
});

const BROWSER_DOCS = ['README.md', 'extension/README.md', 'extension/store/LISTING.md', 'extension/PRIVACY.md', 'extension/TERMS.md', 'extension/SECURITY.md',
  'extension/SUPPORT.md', 'extension/SLA.md', 'extension/ADMIN.md', 'site/index.html', 'site/privacy.html', 'site/terms.html', 'site/support.html', 'site/trust.html'];
const NAMES_OTHER = /Firefox|Safari|فايرفوكس|سفاري/i;
const LIMITED = /\b(?:not|cannot|can't|never|no|none|nor|without|isn't|doesn't|untested)\b|(?<![؀-ۿ])(?:لا|ليس|لن|غير|بدون)(?![؀-ۿ])/i;
const browserClaims = () => {
  const out = [];
  for (const f of BROWSER_DOCS) if (fs.existsSync(path.join(REPO, f))) for (const s of sentencesOf(docText(f))) if (NAMES_OTHER.test(s) && !LIMITED.test(s)) out.push({ where: f, s });
  return out;
};
// ROADMAP.md is left out on purpose: it lists the Safari package and Firefox signing as work not done.
test('no public page, README or LISTING names Firefox or Safari as working (T-047)', () => {
  const hits = browserClaims().filter((c) => !table.browsers.open.some((o) => c.where === o.file && c.s.includes(o.anchor)));
  assert.deepEqual(hits.map((c) => `${c.where}: ${c.s.slice(0, 100)}`), []);
  assert.ok(sentencesOf(docText('site/support.html')).some((s) => NAMES_OTHER.test(s)), 'R15: the scan saw support.html\'s "not launched" row, which is allowed');
});
test('a "browsers" row marked open is still a claim (a fixed line leaves the table)', () => {
  const claims = browserClaims();
  const stale = table.browsers.open.filter((o) => !claims.some((c) => c.where === o.file && c.s.includes(o.anchor))).map((o) => `${o.file}: ${o.anchor}`);
  assert.deepEqual(stale, []);
});
test('the browser scan can fail: a scratch claim is flagged, "cannot" and "no" sentences are not', () => {
  assert.ok(NAMES_OTHER.test('Works in Firefox.') && !LIMITED.test('Works in Firefox.'));
  assert.ok(LIMITED.test('Firefox and Safari cannot record.') && LIMITED.test('No WebKit or Firefox is launched.') && LIMITED.test('لا يشغل WebKit ولا Firefox'));
});

console.log('\ncopy truth - the listing');
test('the listing summary is at most 132 characters', () => {
  const m = read('extension/store/LISTING.md').match(/\*\*Summary\*\*[^\n]*\n`([^`]+)`/);
  assert.ok(m, 'summary line not found');
  assert.ok(m[1].length <= 132, `${m[1].length} characters`);
});

{
  // council-1009 14-7: npm test is the node-only run (run-suites --node-only --ci); the docs must say so rather than imply it covers the headed suites.
  const pkg = JSON.parse(read('extension/package.json'));
  const bad = [];
  if (!/--node-only/.test(pkg.scripts.test)) bad.push('package.json test is no longer node-only: rewrite this check and the two docs');
  if (!/node-only/.test(read('extension/store/CHECKLIST.md'))) bad.push('store/CHECKLIST.md does not say npm test is node-only');
  if (!/node-only/.test(read('extension/RELEASE.md'))) bad.push('RELEASE.md does not say npm test is node-only');
  if (bad.length) { console.log('FAIL 14-7: ' + bad.join('; ')); process.exit(1); }
  console.log('  ok  CHECKLIST and RELEASE name the node-only semantics of npm test');
}
// r5-14-3: a button label the README quotes for the report page exists in the English strings
test('README quotes only report-page button labels that exist in en.json', () => {
  const en = JSON.parse(read('extension/platform/i18n/en.json'));
  const labels = new Set(Object.values(en).map((v) => String(v).replace(/[….]+$/, '').trim()));
  const readme = read('extension/README.md');
  const quoted = [...readme.matchAll(/"([^"\n]{3,60})" on the report page/g)].map((x) => x[1]);
  assert.ok(quoted.length >= 2, 'README still quotes its report-page buttons');
  for (const q of quoted) assert.ok(labels.has(q), `README quotes "${q}" on the report page, but no string in en.json says it`);
  assert.ok(!/"Post to Slack"/.test(readme), 'README promises a Slack-only button that the report page does not have');
});

test('r3-03-8: PRIVACY.md carries every registry row (shown rows one each, the rest grouped as small internal values) and the consent paragraph names consentRevision', () => {
  // the registry module is plain ES with no chrome.*; a top-level await import keeps this file's test() synchronous
  const md = read('extension/PRIVACY.md');
  const table = md.slice(md.indexOf('<!-- store-registry:start -->'), md.indexOf('<!-- store-registry:end -->'));
  const names = REG.REGISTRY.map((r) => r.store || r.key);
  const missing = names.filter((n) => !table.includes('`' + n + '`'));
  assert.deepEqual(missing, [], 'registry rows missing from the PRIVACY table');
  const cells = [...table.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const extra = cells.filter((c) => !names.includes(c) && !/^chrome\.storage/.test(c));
  assert.deepEqual(extra, [], 'table names that are not registry rows');
  assert.match(md, /`consentRevision`/);
  assert.ok(!/no version compares it/.test(md), 'the stale consent sentence is gone');
  assert.ok(!/no version compares it|لا تقارنها أي نسخة/.test(read('site/privacy.html')), 'the site is corrected too (EN and AR)');
  assert.ok(/consentRevision/.test(read('site/privacy.html')));
});

// r7-02-2 (D-1010-151): the manifest lists debugger as a REQUIRED permission, so no sentence may say this build "does not hold" it.
test('r7-02-2: whitebox.js never says QA Wrap does not hold the debugger while the manifest requires it', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.ok(manifest.permissions.includes('debugger'), 'the manifest no longer requires debugger: this assertion is stale');
  assert.ok(!/does not hold/.test(read('extension/background/whitebox.js')), 'whitebox.js still says the debugger is not held');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);

// Next-review T-056 / T-060: the Trust page is reachable from the welcome notice, says what it fetches on a click,
// and carries the audit line in both languages; no public page says eight packages.
{
  const fsx = await import('node:fs');
  const site = (f) => fsx.readFileSync(new URL(`../../site/${f}`, import.meta.url), 'utf8');
  const welcome = fsx.readFileSync(new URL('../welcome/welcome.html', import.meta.url), 'utf8');
  const welcomeJs = fsx.readFileSync(new URL('../welcome/welcome.js', import.meta.url), 'utf8');
  const trust = site('trust.html');
  const bad = [];
  if (!/id="trust-web"/.test(welcome) || !/PRODUCT\.urls\.trust/.test(welcomeJs)) bad.push('welcome does not link the Trust page');
  if (!/Not independently audited; self-scan in progress/.test(trust) || !/لم يخضع لتدقيق مستقل/.test(trust)) bad.push('trust page lacks the audit line in en+ar');
  if (!/fetch nothing from the internet/.test(trust)) bad.push('trust page does not state that the extension pages fetch nothing (the films were removed in S-07, so no click-time film fetch remains)');
  if (/Eight packages|identical in all eight|ثماني حزم/.test(site('index.html'))) bad.push('site/index.html still says eight packages');
  if (/Workspace roles are not security/.test(site('support.html'))) bad.push('support.html still documents workspaces');
  if (bad.length) { console.log(`FAIL Next-review public copy: ${bad.join('; ')}`); process.exit(1); }
  console.log('  ok  Next-review: trust linked, audit line, film exception, two packages, no workspace copy');
}

{
  // r8-05-5 (D-1010-172): the capture limit a tester cannot see from the report is stated in the README, and the code still has the reason.
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const bad = [];
  if (!/requests made from Web Workers and Service Workers/.test(readme)) bad.push('README does not state that worker requests are not recorded');
  if (!/Requests from Web Workers and Service Workers are not recorded/.test(readme)) bad.push('Known limits lacks the workers line');
  if (/Worker\b/.test(fs.readFileSync(new URL('../content/page-hooks.js', import.meta.url), 'utf8')) && /new Worker|WorkerGlobalScope/.test(fs.readFileSync(new URL('../content/page-hooks.js', import.meta.url), 'utf8'))) bad.push('page-hooks now touches workers: revisit the limit');
  if (bad.length) { console.log(`FAIL r8-05-5 workers limit: ${bad.join('; ')}`); process.exit(1); }
  console.log('  ok  r8-05-5: the README states that Web Worker and Service Worker requests are not recorded');
}

test('r9-02-3 (D-209): PRIVACY.md and the site (EN and AR) name the link checker, its policy refusal and the count-only ledger row; the worker really does both', () => {
  const en = /Link checker.{0,260}own machine or network are skipped.{0,160}listed under what left this machine as a count.{0,200}policy \(integrations off\) is checked first/;
  assert.match(norm(read('extension/PRIVACY.md')), en, 'PRIVACY.md');
  const html = norm(read('site/privacy.html').replace(/<[^>]+>/g, ''));
  assert.match(html, en, 'site EN');
  assert.match(html, /فاحص الروابط.{0,300}تتخطى العناوين الموجودة على جهازك أو شبكتك.{0,200}عددا فقط.{0,200}إيقاف التكاملات/, 'site AR');
  const sw = workerSrc();
  assert.ok(sw.includes("ledgerRow('link-check', page.url, ''") && sw.includes('policy: await policy(), tabUrl: page.url'));
});
