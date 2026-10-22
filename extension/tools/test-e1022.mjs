/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * e1022: side panel cleanup, Updates tab, About credits.   node tools/test-e1022.mjs
 * Plain Node: the pure model and wheel handler run for real; the wiring is checked on the shipped files.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStack, wheelSideways, MAX_LINES } from '../popup/action-stack.js';
import { envLine, checkNow, WEBSITE_URL } from '../options/e1022.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const en = JSON.parse(read('platform/i18n/en.json'));
const ar = JSON.parse(read('platform/i18n/ar.json'));

// 1. session line: the panel hides time, events and problems (the title stays)
assert.match(read('popup/popup.css'), /html\[data-surface='panel'\] #step-live > \.meta \{ display: none; \}/);

// 2. wheel over the note box scrolls sideways, only when the text overflows
{
  const wide = { scrollWidth: 400, clientWidth: 200, scrollLeft: 0 };
  let stopped = 0;
  assert.equal(wheelSideways(wide, { deltaY: 90, deltaX: 0, preventDefault: () => stopped++ }), true);
  assert.equal(wide.scrollLeft, 90);
  assert.equal(stopped, 1, 'the page does not scroll as well');
  const fits = { scrollWidth: 100, clientWidth: 200, scrollLeft: 0 };
  assert.equal(wheelSideways(fits, { deltaY: 90, preventDefault: () => assert.fail('a short text lets the wheel through') }), false);
  assert.match(read('popup/action-stack.js'), /getElementById\('note-text'\)[\s\S]*addEventListener\('wheel'[\s\S]*passive: false/);
}

// 3. status stack: newest first, three at most, the badge counts every action; the panel keeps no record list
{
  const s = createStack();
  assert.equal(MAX_LINES, 3);
  ['Note saved.', 'Screenshot saved.', 'Could not save.', 'Note saved.', 'Screenshot saved.'].forEach((t, i) => s.add(t, i !== 2));
  assert.deepEqual(s.rows().map((r) => r.text), ['Screenshot saved.', 'Note saved.', 'Could not save.']);
  assert.deepEqual(s.rows().map((r) => r.ok), [true, true, false]);
  assert.equal(s.total(), 5, 'the badge shows the total, not the visible three');
  s.reset();
  assert.equal(s.total(), 0);
  const js = read('popup/popup.js');
  assert.match(js, /globalThis\.UQAActions\?\.add\(lastSaid, tone\)/);
  assert.match(js, /if \(!live \|\| SURFACE === 'panel'\) return null;/);
  assert.match(read('popup/popup.css'), /\.action-badge \{[^}]*border-radius: 10px;[^}]*background: var\(--fail\)/);
  assert.match(read('popup/popup.html'), /<script type="module" src="action-stack\.js">/);
}

// 4. Updates tab: present, in the tab map, manual check wired, auto check untouched
{
  const html = read('options/options.html');
  assert.match(html, /id="tab-updates" data-rail="updates"/);
  assert.match(html, /id="sec-updates"/);
  for (const id of ['upd-build', 'upd-id', 'upd-env', 'upd-checked', 'upd-check', 'upd-now', 'check-updates']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(read('options/options.js'), /updates: \['sec-updates'\]/);
  const mod = read('options/e1022.js');
  assert.match(mod, /\$\('upd-check'\)\.addEventListener\('click'/);
  assert.match(mod, /backoffUntil: 0/, 'a press always asks');
  assert.match(read('background/worker-lifecycle.js'), /qaw-update/, 'the automatic check stays');
  let seen;
  const next = await checkNow({ state: { backoffUntil: Date.now() + 1e6, etag: 'x' }, version: '3.5.0', token: '', run: async (a) => (seen = a, { checkedAt: 1, latest: null }) });
  assert.equal(seen.state.backoffUntil, 0);
  assert.equal(next.checkedAt, 1);
  assert.equal(envLine('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'), 'Chrome 141 · Windows');
  // the menu entry
  assert.match(read('popup/popup.html'), /id="menu-updates"/);
  const um = read('popup/updates-menu.js');
  assert.match(um, /popup\.e1022\.updateTo/);
  assert.match(um, /options\/options\.html#sec-updates/);
}

// 5. About: maker, links, placeholder, honest ID line, footer credit
{
  const html = read('options/options.html');
  assert.match(html, /href="https:\/\/github\.com\/NJ-Burrito\/QA-Wrap"/);
  assert.match(html, /href="https:\/\/nj-burrito\.github\.io"/);
  assert.equal(WEBSITE_URL, 'https://nj-burrito.github.io/QA-Wrap/', 'the website constant is the GitHub Pages address');
  assert.match(html, /id="about-website"[^>]*data-i18n="options\.e1022\.aboutSoon"/);
  assert.doesNotMatch(en['options.about.publishedId'], /Web Store/i);
  assert.doesNotMatch(ar['options.about.publishedId'], /Web Store/i);
  assert.equal(en['options.e1022.maker'], 'Nader Alzghoul (NJ-Burrito)');
  assert.equal(en['popup.foot.by'], 'Made by Nader Alzghoul · NJ-Burrito');
}

// 6. EN and AR together, no underscores
{
  const keys = Object.keys(en).filter((k) => /e1022/.test(k) || ['options.rail.updates', 'popup.foot.by', 'options.about.publishedId'].includes(k));
  assert.ok(keys.length >= 20);
  for (const k of keys) { assert.ok(ar[k], `ar ${k}`); assert.doesNotMatch(k, /_/); }
}
console.log('test-e1022: ok');
