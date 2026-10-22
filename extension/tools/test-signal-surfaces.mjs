// T-ONE for the surfaces (spec §7/§9): one problem number from core/signal.js visibleProblems on the tune fixtures,
// read the way the popup, panel, report, filing and every export read it. Run from extension/: node tools/test-signal-surfaces.mjs
import { problemCounts } from '../core/finding-count.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleProblems, REASONS } from '../core/signal.js';
import { buildJson, buildMarkdown, headline } from '../core/artifact-docs.js';
import { buildAgentBrief } from '../core/agent.js';
import { buildText, buildHtml, buildYaml } from '../core/exporters.js';
import { buildSessionManifest } from '../core/docs.js';
import { countFindings } from '../core/sessions.js';
import { loadDocFonts } from '../core/docshell.js';
import { workerSrc } from './lib-worker-src.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, '..');
const dir = path.join(here, 'fixtures/signal');
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const fx = man.fixtures.filter((m) => m.split === 'tune').map((m) => JSON.parse(fs.readFileSync(path.join(dir, m.file), 'utf8')));
await loadDocFonts();
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const read = (f) => fs.readFileSync(path.join(ext, f), 'utf8');

// known-true samples first (R15): the fixtures must hold a session with a problem and one without
const counts = fx.map((f) => visibleProblems(f.events, 'problems').problems);
ok(counts.some((n) => n > 0) && counts.some((n) => n === 0), 'sample: tune corpus has both a zero and a non-zero session', counts.join(','));

let exportsChecked = 0;
// every fixture twice: as recorded, and with the tester's own tools having found 85 things (a11y 83 + 2 broken links)
const TOOLS = [{ kind: 'a11y', total: 83, byImpact: {}, violations: [], ts: 5, frameUrl: 'https://a.test/' }, { kind: 'links', broken: [{ href: 'https://a.test/x' }, { href: 'https://a.test/y' }], redirected: [], slow: [], ts: 6, frameUrl: 'https://a.test/' }];
const cases = fx.flatMap((f) => [{ id: f.id, events: f.events, tool: 0 }, { id: f.id + '+tools', events: [...f.events, ...TOOLS], tool: 85 }]);
for (const f of cases) {
  const ev = f.events;
  const p = visibleProblems(ev, 'problems');
  const want = p.problems + f.tool; // the headline every surface and export states
  const a = visibleProblems(ev, 'all');
  ok(p.problems === a.problems, `${f.id}: Problems and Everything give one number`, `${p.problems} vs ${a.problems}`);
  ok(visibleProblems({ events: ev }, 'problems').problems === p.problems, `${f.id}: {events} input same`);
  const session = { id: 's', charter: f.id, startedAt: 1, endedAt: 2, startUrl: 'https://a.test/', env: {} };
  let json, brief, text, html, yaml, md;
  try {
    json = JSON.parse(buildJson(session, ev));
    brief = JSON.parse(buildAgentBrief(session, ev));
    text = buildText(session, ev);
    html = buildHtml(session, ev);
    yaml = buildYaml(session, ev);
    md = buildMarkdown(session, ev);
  } catch (e) { ok(false, `${f.id}: exports build`, e.message); continue; }
  ok(JSON.parse(buildSessionManifest(session, ev)).counts.problems === problemCounts(ev).groups, `${f.id}: docs manifest number (distinct problems, 1011 B5)`);
  exportsChecked++;
  ok(headline(ev, session).total === want, `${f.id}: headline() = problems + tool findings`, `${headline(ev, session).total} vs ${want}`);
  ok(json.problems === problemCounts(ev).groups, `${f.id}: json export number (distinct problems, one count everywhere, 1011 P0-3)`, `${json.problems}`);
  ok(brief.signal.problems === problemCounts(ev).groups, `${f.id}: agent brief number (distinct problems)`);
  ok(text.includes(`Found:    ${problemCounts(ev).groups} problem`), `${f.id}: text export number (distinct problems, 1011 B5)`);
  { const g = problemCounts(ev).groups; ok(html.includes(`<b>${g}</b><span>${g === 1 ? 'problem found' : 'problems found'}`), `${f.id}: html export number (distinct problems, 1011 B5)`); }
  ok(new RegExp(`problems: ${problemCounts(ev).groups}(?![0-9])`).test(yaml), `${f.id}: yaml export number (distinct problems, 1011 B5)`);
  ok(md.includes(`| Problems | ${problemCounts(ev).groups} |`), `${f.id}: markdown export number (distinct problems, core/finding-count.js: one count everywhere, 1011 P0-3)`);
  // nothing silently dropped: every raw event survives, and every hidden note names its reason
  ok(json.events.length === ev.length, `${f.id}: export keeps all ${ev.length} raw events`, `${json.events.length}`);
  const named = json.events.filter((e) => e.suppressedReason).length;
  const hiddenEvents = json.events.filter((e) => e.derived.c === 'N' || e.derived.c === 'X').length;
  ok(named === hiddenEvents && json.events.every((e) => !e.suppressedReason || REASONS[e.suppressedReason]), `${f.id}: every hidden event carries suppressedReason`);
}
ok(exportsChecked === cases.length, 'every tune fixture exported, with and without tool findings', `${exportsChecked}/${cases.length}`);

// the surfaces read the one function (popup = panel = report = filing)
ok(/SIG\.visibleProblems\(events, 'all'\)/.test(read('popup/popup.js')) && /sg.num/.test(read('popup/popup.js')), 'popup reads visibleProblems');
ok(/sgView\(events, session\.id\)/.test(read('devtools/panel.js')) && /sg.num/.test(read('devtools/panel.js')), 'panel reads visibleProblems');
ok(/sg.num/.test(read('report/report.js')) && /sgv.num/.test(read('report/report.js')), 'report reads visibleProblems');
ok(/signal: sgv && \{ problems: sgv.num/.test(read('report/report.js')) && /X\.signal/.test(read('report/filing.js')) && /s\.problems/.test(read('report/filing.js')), 'filing takes the report number');
ok(!/qaw\.sg\.level/.test(read('popup/popup.js')) && !/common\.signal\.show/.test(read('popup/popup.js')), 'popup has no Problems/Everything switch (removed 5 Oct 2026; report and DevTools keep theirs)');
ok(!/paintProcess/.test(read('popup/popup.js')), 'popup no longer paints a process meter');
ok(/common\.signal\.hiding/.test(read('report/report.js')), 'the report keeps the hiding breakdown');
ok(/common\.signal\.coverage/.test(read('report/report.js')), 'report has the coverage line');
ok(/ev-preroll/.test(read('report/report.js')), 'report marks pre-roll events');

// the popup's real state-to-headline path: the popup's own popupProblems(), lifted from its source, fed the UQA_GET_STATE reply shape.
{
  const src = read('popup/popup.js');
  const a = src.indexOf('function popupProblems(');
  const m = a < 0 ? null : [src.slice(a, src.indexOf('\n}\n', a) + 3)];
  ok(!!m, 'popup.js defines popupProblems');
  const popupProblems = m ? new Function(`${m[0]}; return popupProblems;`)() : () => -1;
  // known-true sample (R15): the old behaviour would answer 36 here
  const reply = { recording: true, eventCount: 355, failureCount: 36, findingCount: 36 };
  ok(popupProblems({ sid: null, problems: null }, 's1', reply, true) === 36, 'sample: with the signal module missing the legacy count is the fallback');
  ok(popupProblems({ sid: null, problems: null }, 's1', reply, false) === 0, 'stored failure counts are never the headline while signal.js is loaded');
  ok(popupProblems({ sid: null, problems: null }, 's1', { ...reply, problems: 2 }, false) === 2, 'a problems field on the state reply is used');
  for (const f of fx) {
    const sid = 's_' + f.id;
    const session = { id: sid, startUrl: 'https://a.test/' };
    // what the badge shows: findingTotals().problems over the worker's own tally of the same events
    const badge = countFindings(f.events, { session }).problems;
    // what the popup paints: the timeline pass (visibleProblems + tool findings) fills sgLast, the ticker's state reply arrives after
    const num = problemCounts(f.events).groups;
    const painted = popupProblems({ sid, problems: num }, sid, { ...reply, failureCount: f.events.length, findingCount: f.events.length }, false);
    // ponytail: H2, M1 and M6 are old-shape fixtures (no hook facts) where the worker's lite tally over-counts (L2's T-LITE prints the same three); real captures carry en/ev/nh and agree (L6: /noisy 2 = 2). Never under.
    if (['H2', 'M1', 'M6'].includes(f.id)) ok(badge >= painted, `${f.id}: the lite badge may over-count, never under`, `${badge} vs ${painted}`);
    else ok(painted === badge, `${f.id}: popup headline equals the badge`, `${painted} vs ${badge}`);
    // before the timeline has been read the popup must not show the stored-failure tally
    ok(popupProblems({ sid: null, problems: null }, sid, { failureCount: 36, findingCount: 36 }, false) !== 36, `${f.id}: no stored-failure flash`);
  }
}

// Now-review fault 3 (T-020): the REPORT's own headline (its real sgView, lifted) and the BAR's chip, against the badge and the popup,
// on every fixture. Badge and bar read the same worker field (findingTotals(...).problems); the geometry test shows the chip prints it.
{
  const rsrc = read('report/report.js');
  const ra = rsrc.indexOf('function sgView(');
  ok(ra >= 0, 'report.js defines sgView');
  const sgViewReport = new Function('SIG', 'SESS', 'FC', 'sgLevel', 'sgPromoted', `${rsrc.slice(ra, rsrc.indexOf('\n}\n', ra) + 3)}; return sgView;`)({ visibleProblems }, { countFindings }, { problemCounts }, () => 'problems', () => new Set());
  const psrc = read('popup/popup.js');
  const pa = psrc.indexOf('function sgView(');
  const sgViewPopup = new Function('SIG', 'SESS', 'FC', 'sgLevel', 'sgPromoted', `${psrc.slice(pa, psrc.indexOf('\n}\n', pa) + 3)}; return sgView;`)({ visibleProblems }, { countFindings }, { problemCounts }, () => 'problems', () => new Set());
  const popupProblems2 = new Function(`${psrc.slice(psrc.indexOf('function popupProblems('), psrc.indexOf('\n}\n', psrc.indexOf('function popupProblems(')) + 3)}; return popupProblems;`)();
  ok(/problems: s\.problems \| 0/.test(read('content/bar.js')) && /problems: findingTotals\(state\.findings\)\.problems/.test(workerSrc()), 'the bar chip reads the worker field the badge reads');
  for (const f of cases) {
    const session = { id: 's_' + f.id, startUrl: 'https://a.test/' };
    const report = sgViewReport(f.events, session.id).num;
    const popup = sgViewPopup(f.events, session.id).num;
    ok(report === popup, `${f.id}: report headline equals popup headline`, `${report} vs ${popup}`);
    ok(report === problemCounts(f.events).groups, `${f.id}: report headline is the one number (distinct failures; tool findings are counted apart)`, `${report}`);
    if (f.tool) continue;
    const badge = countFindings(f.events, { session }).problems;
    const painted = popupProblems2({ sid: session.id, problems: report }, session.id, { failureCount: 1, findingCount: 1 }, false);
    // 16 Oct 2026 (ui-1016 J): the number is core/finding-count.js (distinct failures). The badge and the bar chip are the worker's running
    // tally keyed by the same dupeKey, so they are equal; the old-shape fixtures carry no hook facts (`nh`), where it may sit above, never under.
    if (['H2', 'M1'].includes(f.id)) ok(badge >= report, `${f.id}: report vs badge/bar (old-shape fixture), the running tally never under`, `${badge} vs ${report}`);
    else ok(badge === report, `${f.id}: the report's number equals the badge and the bar chip`, `${badge} vs ${report}`);
    ok(painted === report, `${f.id}: popup shows the report's number`, `${painted} vs ${report}`);
  }
}

// D-1010-102: a third-party resource row stays in the list as a Warning, below the app's own 4xx/5xx, and never leads the Errors
{
  const page = 'https://app.test/';
  const res = { kind: 'net', via: 'resource', method: 'GET', url: 'https://tracker.example/p.gif', status: 0, ok: false, error: true, ev: 'error', text: '<img> failed to load', ts: 1, frameUrl: page, thirdParty: true };
  const own = { kind: 'net', method: 'GET', url: '/api/x', status: 500, ok: false, ts: 2, frameUrl: page };
  const r = visibleProblems([res, own], 'problems', { pageHost: 'app.test' });
  ok(r.rows.length === 2 && r.errors === 1 && r.warnings === 1, 'D-102: the tracker is a warning beside the app error', JSON.stringify([r.errors, r.warnings]));
  ok(r.rows.find((x) => x.r === 'd-third')?.url.includes('tracker.example'), 'D-102: the resource row keeps its place in the timeline');
  const sameOrigin = visibleProblems([{ ...res, url: 'https://app.test/missing.png', thirdParty: false }], 'problems', { pageHost: 'app.test' });
  ok(sameOrigin.errors === 1, 'D-102: a same-origin resource failure is still an error');
  const noHost = visibleProblems([res], 'problems', {});
  ok(noHost.warnings === 1 && noHost.errors === 0, 'D-102: the thirdParty tag alone down-weights it');
}
// i18n: a label for every reason code, in both languages
const en = JSON.parse(read('platform/i18n/en.json')), ar = JSON.parse(read('platform/i18n/ar.json'));
for (const code of Object.keys(REASONS)) ok(en[`common.signal.r.${code}`] && ar[`common.signal.r.${code}`], `label for ${code} in en and ar`);
console.log(`${fail ? 'FAILED' : 'OK'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
