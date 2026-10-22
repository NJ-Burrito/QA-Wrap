/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The settings page saves what you changed, including the change you had not
 * finished making.
 *
 * ── The bug this file exists to stop coming back ────────────────────────────
 *
 * `save()` debounces by 250 ms and used to open with `clearTimeout(saveTimer)`,
 * then send **its own** patch when the timer eventually ran. So a patch that was
 * still waiting in the debounce was cancelled and never sent at all. Typing a
 * folder into "Save into" and then ticking "Ask where to save each file" inside
 * a quarter of a second lost the folder every time. Measured in a real profile,
 * reading `chrome.storage.sync` back out afterwards:
 *
 *     before   {"downloadFolder":"",          "saveAs":true}
 *     after    {"downloadFolder":"Portal QA", "saveAs":true}
 *
 * It swallowed a half-typed `maskExtraPattern` the same way, and it would have
 * dropped a keymap binding rebound just before another one.
 *
 * ── Why this is a structural test ───────────────────────────────────────────
 *
 * `options/options.js` is a page script: it reaches for `document` and `chrome`
 * at load and its `boot()` builds the whole form. Importing it in Node would be
 * a stub of the page rather than a test of it, so the contract is asserted
 * against the source, and the behaviour was measured in a browser instead. The
 * two together are honest; either alone is not.
 *
 *   node tools/test-options-save.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(path.join(EXT, 'options/options.js'), 'utf8');
const html = fs.readFileSync(path.join(EXT, 'options/options.html'), 'utf8');
const settings = fs.readFileSync(path.join(EXT, 'platform/settings.js'), 'utf8');
const read = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('options.js — a debounce that keeps what is waiting in it');

test('a pending patch accumulates instead of replacing the last one', () => {
  assert.match(js, /pending = \{ \.\.\.pending, \.\.\.patch, \.\.\.nested\(pending\) \}/,
    'save() must merge into the pending patch, or whatever is waiting is lost');
});

test('the commit sends the accumulated patch, never the caller\'s alone', () => {
  const commit = /const commit = async \(\) => \{([\s\S]*?)\n  \};/.exec(js);
  assert.ok(commit, 'save() has no commit()');
  assert.match(commit[1], /const body = pending;/, 'the body has to be the accumulated patch');
  assert.match(commit[1], /patch: body/, 'the message must carry `body`, not `patch`');
  assert.ok(!/UQA_SET_SETTINGS', patch \}/.test(commit[1]),
    'sending the caller\'s own patch is the bug this file exists to stop');
});

test('the commit empties the pending patch, so nothing is sent twice', () => {
  assert.match(js, /const body = pending;\s*\n\s*pending = \{\};/);
});

test('nested objects merge deeply, so two patches inside one debounce both survive', () => {
  assert.match(js, /const NESTED = \['keymap', 'jira', 'slack', 'trackers'\]/);
  const block = /(const isObj[\s\S]*?const mergeDeep[\s\S]*?\n\};)/.exec(js);
  assert.ok(block, 'no mergeDeep');
  const mergeDeep = new Function(`${block[1]}; return mergeDeep;`)();
  // the pre-existing bug: jira.baseUrl then jira.email inside 250 ms lost the first
  let pending = {};
  for (const patch of [{ jira: { baseUrl: 'https://a.example' } }, { jira: { email: 'a@b.c' } }, { jira: { priorityMap: { critical: 'Blocker' } } }, { jira: { priorityMap: { minor: 'Trivial' } } }]) {
    pending = { ...pending, ...patch, jira: mergeDeep(pending.jira || {}, patch.jira) };
  }
  assert.deepEqual(pending.jira, { baseUrl: 'https://a.example', email: 'a@b.c', priorityMap: { critical: 'Blocker', minor: 'Trivial' } });
  assert.match(js, /pending = \{ \.\.\.pending, \.\.\.patch, \.\.\.nested\(pending\) \}/);
});

test('there is one timer, and closing the page flushes what it holds', () => {
  assert.equal((js.match(/saveTimer = setTimeout/g) || []).length, 1, 'more than one debounce is two races');
  assert.match(js, /window\.addEventListener\('pagehide', flushSave\)/,
    'a settings page is closed the moment somebody has finished changing something');
  const flush = /function flushSave\(\) \{([\s\S]*?)\n\}/.exec(js);
  assert.ok(flush, 'no flushSave()');
  assert.match(flush[1], /clearTimeout\(saveTimer\)/);
  assert.match(flush[1], /patch: body/);
});

console.log('\noptions — the download folder has a control at all');

test('"Save into" and "Ask where to save each file" are both on the page', () => {
  assert.match(html, /<input type="text" id="downloadFolder"/, 'no "Save into" field');
  assert.match(html, /<input type="checkbox" id="saveAs"/, 'no "Ask where to save each file" box');
  assert.match(html, /<span data-i18n="options\.files\.saveInto">Save into<\/span>/); // r10-10-3: keyed, so Arabic reads "احفظ في"
  assert.match(html, /Ask where to save each file/);
  assert.match(html, /id="downloadFolder-help"/, 'the help paragraph has to exist to be filled');
});

test('the help text is the one string, not a retyped copy of it', () => {
  // `platform/settings.js` states a Chrome limitation exactly once; the Save sheet
  // reads the same constant. A second wording here is a second promise.
  assert.match(settings, /export const DOWNLOAD_FOLDER_HELP/);
  assert.match(js, /import \{[\s\S]*?DOWNLOAD_FOLDER_HELP[\s\S]*?\} from '\.\.\/platform\/settings\.js'/);
  assert.match(js, /help\.textContent = DOWNLOAD_FOLDER_HELP/);
  assert.ok(!/Chrome does not let an extension read the folder/.test(html),
    'the limitation is stated in platform/settings.js and nowhere else');
});

test('both controls go through the page\'s normal settings path', () => {
  assert.match(js, /save\(\{ downloadFolder: input\.value\.trim\(\) \}\)/, 'the folder must save as it is typed');
  // One commit at a time. `setSettings()` is a read-modify-write, so two in
  // flight together both read the state from before either, and the second
  // overwrites the first. Measured: the folder was written and then lost.
  assert.ok(!/downloadFolder: input\.value\.trim\(\) \}, \{ immediate: true \}/.test(js),
    'an immediate commit beside the debounced one races the worker and loses a field');
  // The fact, not the punctuation. This first matched the list character for
  // character and went red the day a switch was added after `saveAs`; then it
  // read only the *first* `.forEach(wireSwitch)`, which is the same trap one
  // step further along. Every such list is read, and the question is whether
  // any of them wires it.
  const wiredLists = [...js.matchAll(/\[([^\]]*)\]\.forEach\(wireSwitch\)/g)].map((m) => m[1]);
  assert.ok(wiredLists.length, 'nothing calls wireSwitch at all');
  assert.ok(wiredLists.some((l) => l.includes("'saveAs'")), 'saveAs is not wired to save');
  // There is more than one `for (const name of [...])` in this file, so the
  // check is that *some* checkbox list repaints it, not that the first does.
  const lists = [...js.matchAll(/for \(const name of \[([^\]]*)\]\)/g)].map((m) => m[1]);
  assert.ok(lists.some((l) => l.includes("'saveAs'")), 'saveAs is not repainted from settings');
  assert.match(js, /settings\.downloadFolder \|\| ''/, 'the folder is never painted back from settings');
});

test('both keys are real settings with defaults', () => {
  assert.match(settings, /downloadFolder: '',/);
  assert.match(settings, /saveAs: false,/);
});

test('the retention notice a profile only sees once is actually built', () => {
  // `platform/settings.js` carried a TODO saying this interface did not exist, for
  // longer than that was true. An upgraded profile is read as "keep everything"
  // until somebody chooses, and the only thing that makes that honest rather
  // than a silent default is being asked. So the asking is asserted.
  assert.match(html, /id="retention-notice"/, 'no notice to show');
  assert.match(html, /id="retention-notice-ok"/, 'nothing to answer it with');
  assert.match(js, /function wireRetentionNotice\(\)/);
  assert.match(js, /save\(\{ retentionNoticeSeen: true \}, \{ immediate: true \}\)/,
    'answering it has to be written down immediately, or it asks again');
  // Shown only while nothing has been chosen, and only while the window is
  // never: a profile that already has a real retention window is not asked.
  assert.match(js, /box\.hidden = !!settings\?\.retentionNoticeSeen \|\| Number\(settings\?\.retentionDays \|\| 0\) !== 0/);
  assert.ok(!/TODO\(options\)/.test(settings), 'platform/settings.js still claims this is not built');
});


test('D-1010-92: an invalid mask pattern is refused (never saved), keyed, and flagged; a valid one is saved', () => {
  const src = js.slice(js.indexOf('function checkMaskPattern'), js.indexOf('function wireMaskPattern'));
  assert.ok(src.length > 100, 'checkMaskPattern exists');
  const saved = [];
  const attrs = {};
  const input = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
  const state = { textContent: '', style: {} };
  const run = new Function('$', 't', 'save', `${src}; return checkMaskPattern;`)((id) => (id === 'mask-state' ? state : input), (k, v) => `${k}|${v ? v.message ? 'msg' : '' : ''}`, (p) => saved.push(p));
  assert.equal(run('([unclosed', { save: true }), false, 'a pattern that does not compile is refused');
  assert.deepEqual(saved, [], 'and nothing is saved');
  assert.match(state.textContent, /^options\.privacy\.maskInvalid/, 'the keyed error is shown');
  assert.equal(attrs['aria-invalid'], 'true');
  assert.equal(run('account|reference', { save: true }), true);
  assert.deepEqual(saved, [{ maskExtraPattern: 'account|reference' }], 'a valid pattern is saved');
  assert.equal(attrs['aria-invalid'], undefined, 'and the flag clears');
  assert.equal(run('(bad', {}), false, 'a stored pattern that does not compile shows the error on load');
  assert.equal(saved.length, 1, 'without saving anything');
  assert.match(js, /if \(settings\.maskExtraPattern\) checkMaskPattern\(settings\.maskExtraPattern\)/, 'boot checks the stored value');
  assert.match(read('popup/popup.js'), /function paintMaskNotice/, 'and the popup says why every field is masked');
});

test('D-1010-103: an erase whose stores failed shows the partial line and never the done or gone text', () => {
  const start = js.indexOf("document.getElementById('erase-all')?.addEventListener");
  const body = js.slice(start, js.indexOf('\npaintFootprint();\n', start));
  const partial = body.indexOf("t('options.safe.erasePartial', { n: failed.length })");
  assert.ok(partial > 0, 'the partial line is keyed and carries the store count');
  assert.ok(partial < body.indexOf('options.safe.eraseDoneOne'), 'it is decided before the done text is built');
  assert.match(body, /failed = \[\]/, 'failed is read from the worker result');
  assert.match(body.slice(partial, partial + 200), /return;/, 'and it returns before the gone sentence');
  const en = JSON.parse(read('platform/i18n/en.json')), ar = JSON.parse(read('platform/i18n/ar.json'));
  assert.ok(en['options.safe.erasePartial'].includes('{n}') && ar['options.safe.erasePartial'].includes('{n}') && en['options.safe.erasePartial'] !== ar['options.safe.erasePartial'], 'an EN+AR pair with the count');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
