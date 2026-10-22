// T-021 / T-022: one tone module (glyph + word + colour), the bar problems chip, the badge title, the finish-cue twin.
// Run from extension/: node tools/test-tone.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { workerSrc } from './lib-worker-src.mjs';
const read = (f) => fs.readFileSync(f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const en = JSON.parse(read('platform/i18n/en.json'));
const ar = JSON.parse(read('platform/i18n/ar.json'));

// ui/tone.js run for real against a stub DOM: three tiers, three distinct glyph shapes, a word in every chip
const made = [];
const mk = () => ({ className: '', innerHTML: '', children: [], textContent: '', append(...k) { this.children.push(...k); } });
const win = { UQAIcon: (id) => `<svg data-id="${id}"/>` };
vm.runInNewContext(read('ui/tone.js'), { window: win, document: { createElement: () => { const n = mk(); made.push(n); return n; } } });
const T = win.UQATone;
ok(!!T && ['error', 'warning', 'note'].every((k) => T.TIERS[k]), 'sample: UQATone has the three tiers');
const shapes = ['error', 'warning', 'note'].map((k) => T.TIERS[k].icon);
ok(new Set(shapes).size === 3, 'three tiers use three different glyph shapes', shapes.join());
const icons = read('ui/icons.js');
for (const id of shapes) ok(icons.includes(`"${id}":`), `glyph ${id} exists in ui/icons.js`);
ok(T.tierOf('Error') === 'error' && T.tierOf('Warning') === 'warning' && T.tierOf('Induced') === 'note' && T.tierOf(undefined) === 'note', 'tierOf maps the signal tiers');
const c = T.chip('error', 'Error');
ok(/tier-error/.test(c.className) && c.innerHTML.includes('data-id="stop"') && c.children[0].textContent === 'Error', 'chip = glyph + word + tier class');
for (const k of ['common.signal.tier.error', 'common.signal.tier.warning', 'common.signal.tier.note', 'overlay.bar.problems']) ok(en[k] && ar[k], `${k} is a pair`);

// every row the pages colour by tier carries the chip
for (const f of ['popup/popup.js', 'report/report.js', 'devtools/panel.js']) {
  const s = read(f);
  ok(/function sgRow[\s\S]{0,700}UQATone\.chip/.test(s), `${f}: signal rows carry the tone chip`);
}
ok(/isFailure\(ev\)[\s\S]{0,200}UQATone\.chip/.test(read('report/report.js')), 'report timeline problem rows carry the tone chip');
for (const f of ['popup/popup.html', 'report/report.html', 'devtools/panel.html']) {
  const s = read(f);
  ok(s.includes('ui/tone.css') && s.includes('ui/tone.js'), `${f} loads the tone module`);
}
// grep gate: no class that colours a problem row red is left without a glyph at its creation site
ok(/\.ev\.tone-bad/.test(read('report/report.css')) && /isFailure\(ev\)[\s\S]{0,200}UQATone\.chip/.test(read('report/report.js')), 'gate: .ev.tone-bad rows have a glyph');
ok(/has-problems/.test(read('popup/popup.css')) && /function paintTone[\s\S]{0,800}UQATone\.chip|T\.chip/.test(read('popup/popup.js')), 'gate: popup has-problems count has a glyph');

// the bar chip
const bar = read('content/bar.js'), css = read('content/overlay.css');
ok(/probs\.hidden = !on/.test(bar) && /const on = state\.live;/.test(bar), 'bar chip is shown while live, quiet at zero (f1022)');
ok(/UQATone\?\.glyph\(tier\)[\s\S]{0,120}uqa-problems-n/.test(bar), 'bar chip is a glyph and a number');
ok(/setAttribute\('aria-label', words\)/.test(bar) && /const words = tCount\('overlay\.bar\.problemsCount', n\)/.test(bar) && /announce\(t\('overlay\.bar\.problems', n\)\)/.test(bar), 'bar chip is named in words (1015: the visible "3 problems" is its name; the spoken cue keeps "Problems: n")');
ok(/'overlay\.bar\.problems': 'Problems: \{n\}'/.test(bar) && en['overlay.bar.problems'] === 'Problems: {n}', 'bar fallback equals the table');
ok(/tier !== 'error' \|\| n <= prev/.test(bar) && /reduced\(\)\) requestAnimationFrame\(\(\) => requestAnimationFrame/.test(bar), 'cue: only a rising Error count; reduced motion is a one-frame outline change');
ok(/\.uqa-problems\.is-cue \{ outline-color: currentColor/.test(css) && /reduce\)[\s\S]*\.uqa-problems\.is-cue \{ animation: none/.test(css), 'cue css: outline stays, animation off under reduced motion');
ok(/Date\.now\(\) - saidAt > 5000/.test(bar), 'bar live line is throttled');
ok(/problems: Number\(r\?\.problems\) \|\| 0/.test(read('content/bridge.js')), 'bridge publishes problems');
ok(/BAR_FILES = \['ui\/icons\.js', 'ui\/tone\.js'/.test(workerSrc()), 'worker injects tone.js with the bar');

// badge title in words, finish-cue twin (T-022)
const sw = workerSrc();
ok(/Errors'\}: \$\{t\.errors\}/.test(sw) || /'Errors'/.test(sw), 'badge title carries the tiers in words');
ok(/why === 'off' && timed && Date\.now\(\) - startedAt >= 5000/.test(sw), 'visual twin: sound off and job over 5 s');
ok(/UQA_CUE: async[\s\S]{0,200}why === 'off'\) signalDone/.test(sw), 'visual twin: hidden-page cue with sound off');
ok(/DONE_KEY in c && !c\[DONE_KEY\]\.newValue\) paintBadge/.test(sw), 'the mark clears when the popup acknowledges');
ok(/uqa\.doneJob[\s\S]{0,200}popup\.done\.finishedAway/.test(read('popup/popup.js')) && en['popup.done.finishedAway'] && ar['popup.done.finishedAway'], 'popup says it once in the status line (role=status)');
ok(/id="status" role="status"/.test(read('popup/popup.html')), 'popup status line is role=status');

// behaviour of the worker pair, run for real: with sound off one job over 5 s leaves exactly one mark
{
  const src = sw.slice(sw.indexOf('for (const [t, cue, timed] of'), sw.indexOf('const FILING = '));
  let marks = 0;
  const handlers = { UQA_HARVEST: async () => ({ ok: true }) };
  const ctx = { handlers, cueOp: async () => 'off', signalDone: () => { marks++; }, Date: { now: ((n) => () => (n += 6000))(0) } };
  vm.runInNewContext(src.replace(/\/\*\*[\s\S]*?\*\/ \(\[/, '(['), ctx);
  await handlers.UQA_HARVEST({}, {});
  await new Promise((r) => setTimeout(r, 10));
  ok(marks === 1, 'sound off + 6 s job -> one visual signal', String(marks));
  ctx.Date.now = ((n) => () => (n += 1000))(0);
  await handlers.UQA_HARVEST({}, {});
  await new Promise((r) => setTimeout(r, 10));
  ok(marks === 1, 'a job under 5 s adds none', String(marks));
}
console.log(`tone: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
