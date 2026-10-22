// T-020: the report never says "passed" from absence; one definition of "a problem" on the report page.
// Run from extension/: node tools/test-verdict-honesty.mjs
import fs from 'node:fs';
const read = (f) => fs.readFileSync(f, 'utf8');
const en = JSON.parse(read('platform/i18n/en.json'));
const ar = JSON.parse(read('platform/i18n/ar.json'));
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

// known-true positive (R15): the keys the gate guards exist
ok(!!en['report.v.clean'] && !!ar['report.v.clean'] && !!en['report.team.clean'], 'sample: verdict keys exist');
// no shipped verdict string says passed / clean without a coverage clause (tester-facing report and popup strings)
const SKIP = /^(report\.istqb\.|.*autofill)/;
const WORD_EN = /\b(passed|passes|pass|clean)\b/i, WORD_AR = /(نجح|ناجح|نظيف|اجتاز)/;
const CLAUSE_EN = /(recorded|observed|seen)/i, CLAUSE_AR = /(رصد|سُجّل|سجّل)/;
for (const k of Object.keys(en)) {
  if (!/^(report|popup)\./.test(k) || SKIP.test(k)) continue;
  if (WORD_EN.test(en[k])) ok(CLAUSE_EN.test(en[k]), `en ${k} says pass/clean without a coverage clause`, en[k]);
  if (WORD_AR.test(ar[k] || '')) ok(CLAUSE_AR.test(ar[k]), `ar ${k} says pass/clean without a coverage clause`, ar[k]);
}
ok(/\{steps\}/.test(en['report.v.clean']) && /\{requests\}/.test(en['report.v.clean']) && /\{pages\}/.test(en['report.v.clean']), 'en wording carries steps, requests and pages');
ok(/\{steps\}/.test(ar['report.v.clean']) && /\{requests\}/.test(ar['report.v.clean']) && /\{pages\}/.test(ar['report.v.clean']), 'ar wording carries steps, requests and pages');
ok(en['report.v.seenNone'] && ar['report.v.seenNone'] && !('report.v.passed' in en) && !('report.v.passed' in ar), 'badge key renamed in the pair');

const rep = read('report/report.js');
ok(!/report\.v\.passed/.test(rep), 'report.js no longer reads report.v.passed');
ok(/seenNone[\s\S]{0,400}v-cov[\s\S]{0,80}common\.signal\.coverage/.test(rep), 'coverage line sits beside the no-problems verdict');
ok(/common\.signal\.coverage/.test(rep.slice(rep.indexOf("t('report.team.clean')") - 60, rep.indexOf("t('report.team.clean')") + 120)), 'team view clean cell carries the coverage clause');
ok(/const isFailure = \(e\) => \(SIG \? SIG\.classify\(e\)\.c === 'D'/.test(rep), "report's chip, list and timeline use the signal.js problem definition");
ok(!/\bisFailure = m\.isFailure/.test(rep), 'report.js does not take core isFailure as its problem test');
ok(/const bad = !!\(lead \|\| num\)/.test(rep), 'badge reads the one number');
ok(/\.v-cov/.test(read('report/report.css')), 'coverage line has style');
// the headline formula is the same text as the popup's
const f = (s) => (s.match(/const num = FC \? FC\.problemCounts\(events\)\.groups : sig\.problems;/) || [''])[0]; // ui-1016 H2: the one number, core/finding-count.js
ok(f(rep) && f(rep) === f(read('popup/popup.js')), 'report and popup count problems with the same expression');

// 5 Oct 2026: the verdict card shows a short headline, the path first, the query collapsed; exports keep the full line.
{
  const a = rep.indexOf('function urlParts(');
  const urlParts = new Function(`${rep.slice(a, rep.indexOf('\n}\n', a) + 3)}; return urlParts;`)();
  const u = urlParts('https://acme.example/api/stats/qoe?a=1&b=2&c=%20x');
  ok(u.host === 'acme.example' && u.path === '/api/stats/qoe' && u.query === 'a=1&b=2&c=%20x' && u.params === 3 && u.full.startsWith('https://'), 'urlParts splits host, path, query, count');
  const bad = urlParts('/api/x?y=1');
  ok(bad.path === '/api/x' && bad.query === 'y=1' && bad.params === 1 && bad.host === '', 'urlParts falls back to text before the ?');
  ok(urlParts('https://h/p').query === '' && urlParts('https://h/p').params === 0, 'urlParts: no query, no parameters');
  ok(/class="?v-query|'details', 'v-query'/.test(rep) && /report\.v\.copyUrl/.test(rep) && /report\.v\.copyQuery/.test(rep), 'query sits in a collapsed details with Copy URL and Copy query');
  ok(/, line,\s/.test(rep) || /steps, line,/.test(rep), 'filing still receives the full line');
  for (const k of ['where', 'youDid', 'query', 'copyUrl', 'copyQuery', 'queryParams', 'queryChars']) ok(en[`report.v.${k}`] && ar[`report.v.${k}`], `report.v.${k} in both languages`);
}

console.log(`verdict-honesty: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
