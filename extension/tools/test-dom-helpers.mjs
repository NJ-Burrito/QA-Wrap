#!/usr/bin/env node
/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * ui/dom.js is the one home of `el`, `esc` and the theme words (1014 B3 step 6).
 * Proof: esc equals core/docshell.js escHtml on a fuzz list, el sets a class and plain text only,
 * themeWords reads the shared table first and falls back to the theme's English answer, every page
 * that used a local copy loads dom.js before its script, and no page script defines a second copy.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { escHtml } from '../core/docshell.js';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ok  ${m}`); };

// A tiny document: createElement returns a plain object with className and textContent.
const made = [];
const sandbox = {
  document: { createElement: (tag) => { const o = { tag, className: '', textContent: '' }; made.push(o); return o; } },
  QAWi18n: { has: (k) => k === 'common.theme.dark.label', t: (k) => `T(${k})` },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('ui/dom.js'), sandbox);
const { el, esc, themeWords } = sandbox.UQADom;

ok(typeof el === 'function' && typeof esc === 'function' && typeof themeWords === 'function', 'UQADom exposes el, esc, themeWords');
const fuzz = ['', 'plain', '<script>alert(1)</script>', `a&b "c" 'd' <e>`, '&amp;&lt;', null, undefined, 0, 12.5, false, 'اختبار <b>', "x'y\"z".repeat(30)];
for (const v of fuzz) assert.equal(esc(v), escHtml(v), `esc(${JSON.stringify(v)})`);
ok(true, `esc equals core/docshell.js escHtml on ${fuzz.length} inputs`);

const a = el('div', 'x y', '<b>not html</b>');
ok(a.tag === 'div' && a.className === 'x y' && a.textContent === '<b>not html</b>', 'el sets class and text as plain text');
const b = el('span');
ok(b.className === '' && b.textContent === '', 'el with no class and no text leaves both empty');
const c = el('p', null, 0);
ok(c.textContent === 0 || c.textContent === '0', 'el with text 0 still sets it (only null and undefined skip)');

const dark = themeWords('dark', { label: 'Dark', next: 'System' });
ok(dark.label === 'T(common.theme.dark.label)' && dark.next === 'System', 'themeWords takes the shared table when it has the key, else the theme answer');

// Wiring: the five pages load dom.js before the script that uses it, and none keeps a copy.
const order = (html, user, dom = 'ui/dom.js') => {
  const h = read(html);
  const i = h.indexOf(dom);
  const j = h.indexOf(user);
  return i > 0 && j > 0 && i < j;
};
ok(order('popup/popup.html', 'src="popup.js"'), 'popup loads dom.js before popup.js');
ok(order('report/report.html', 'src="filing.js"'), 'report loads dom.js before filing.js');
ok(order('report/report.html', 'src="report.js"'), 'report loads dom.js before report.js');
ok(order('devtools/panel.html', 'src="panel.js"'), 'devtools panel loads dom.js before panel.js');
ok(order('options/options.html', 'src="options.js"'), 'options loads dom.js before options.js');
ok(order('tutorials/tutorials.html', 'src="tutorials.js"'), 'tutorials loads dom.js before tutorials.js');
for (const f of ['popup/popup.js', 'report/report.js', 'devtools/panel.js', 'devtools/audit.js']) {
  ok(!/^\s*function el\(/m.test(read(f)) && /const \{ el \} = window\.UQADom/.test(read(f)), `${f} takes el from UQADom`);
}
for (const f of ['report/filing.js', 'options/integrations.js']) {
  ok(/const \{ esc \} = window\.UQADom/.test(read(f)), `${f} takes esc from UQADom`);
}

console.log(`\n${n} passed, 0 failed`);
