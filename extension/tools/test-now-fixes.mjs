/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Behavioural tests for the faults of the "Now" devil pass (work/delivery/Now-review.md) that had only a source-grep test:
 *   1  T-012  the .eml builder in report/filing.js sends its body through UQA_SCAN, and a canary token is gone from the draft;
 *             a dead scan door writes no draft at all
 *   4  T-011  the options vault card shows the refusal (a key pair) when the vault is unreadable, in both languages
 *   7  T-009  the erase-all confirm text names the replay data and the saved cookie profiles, in both languages
 *
 *   node tools/test-now-fixes.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { scanOutbound } from '../core/secret-scan-text.js';
import { workerSrc } from './lib-worker-src.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const EN = JSON.parse(read('platform/i18n/en.json'));
const AR = JSON.parse(read('platform/i18n/ar.json'));
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`  ok  ${name}`); };

/* ── 1: the .eml draft, through the real download() ─────────────────────── */
const CANARY = 'ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
async function runEml({ scanOk }) {
  const sent = [];
  const said = [];
  let blob = null;
  const sandbox = {
    window: { UQAIcon: null }, location: { href: 'chrome-extension://x/report/report.html' },
    document: { addEventListener() {}, getElementById: () => null, createElement: () => ({ click() {}, remove() {} }), body: { append() {} } },
    QAWi18n: { t: (k) => k }, URL: { createObjectURL: (b) => { blob = b; return 'blob:x'; }, revokeObjectURL() {} }, Blob, TextEncoder, btoa, setTimeout: () => 0,
    console, chrome: {}, globalThis: null,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('ui/dom.js'), sandbox);
  vm.runInContext(read('report/eml.js'), sandbox);
  vm.runInContext(read('report/filing.js'), sandbox);
  const ctx = {
    title: `Login fails with ${CANARY}`, line: 'one line', steps: [`Open /login`, `Paste ${CANARY} in the box`],
    send: async (m) => {
      sent.push(m.type);
      if (m.type === 'UQA_SCAN') return scanOk ? { ok: true, result: scanOutbound(m.fields) } : { ok: false, error: 'door closed' };
      return { ok: true, result: m.type === 'UQA_TRACKER_STATE' ? [] : {} };
    },
    say: (text, tone) => said.push([text, tone]), markdown: async () => '', screens: async () => [],
  };
  await sandbox.window.UQAFiling.integrations(ctx);
  await sandbox.window.UQAFiling.download();
  return { sent, said, eml: blob ? await blob.text() : null };
}
const decoded = (eml) => {
  const parts = eml.split(/\r\n--=_qaw_[^\r\n]*/);
  const text = parts.map((p) => { const m = p.match(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*)$/); return m ? Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8') : ''; }).join('\n');
  const subject = (eml.match(/Subject: ([\s\S]*?)\r\n[A-Z]/) || [])[1] || '';
  const words = [...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) => Buffer.from(m[1], 'base64').toString('utf8')).join('');
  return { text, subject: words || subject };
};

await test('the .eml body, steps and subject go through UQA_SCAN and the canary is gone from the draft', async () => {
  const r = await runEml({ scanOk: true });
  assert.ok(r.sent.includes('UQA_SCAN'), 'the page asked the worker to scan');
  assert.ok(r.eml, 'a draft was written');
  const d = decoded(r.eml);
  assert.ok(d.text.includes('Open /login'), 'R15: the body was decoded and the keep is in it');
  assert.ok(!d.text.includes(CANARY) && !r.eml.includes(CANARY), 'no canary in the body');
  assert.ok(!d.subject.includes(CANARY), 'no canary in the subject');
  assert.ok(d.subject.includes('Login fails'), 'R15: the subject was decoded');
});

await test('a dead scan door writes no draft and says so loudly (a dead door is not "no findings")', async () => {
  const r = await runEml({ scanOk: false });
  assert.equal(r.eml, null, 'nothing was written');
  assert.deepEqual(r.said.at(-1), ['report.f.emlScanFailed', 'err']);
});

await test('the chat post fails loudly when the scan cannot run, like the export path', () => {
  const sw = workerSrc();
  assert.ok(/const sc = await scanOutbound\(\{ \.\.\.flds, \.\.\.summary\.steps \}, \{ extra: \['email', 'phone'\] \}\);/.test(sw), 'the chat scan is awaited with no catch');
  assert.ok(!/scanOutbound\(\{ \.\.\.flds[^\n]*\.catch/.test(sw), 'no catch turns a dead door into no findings');
  assert.ok(!/sc\?\.findings/.test(sw), 'no silent "no findings" fallback');
});

/* ── 4: the vault card shows the refusal ─────────────────────────────────── */
await test('the vault card says the vault is unreadable (key pair), instead of a mode line', async () => {
  assert.ok(EN['options.vault.unreadable'] && AR['options.vault.unreadable'], 'the key pair exists');
  assert.ok(/[؀-ۿ]/.test(AR['options.vault.unreadable']) && !/[؀-ۿ]/.test(EN['options.vault.unreadable']));
  const els = {};
  const el = (id) => (els[id] ??= { id, textContent: '', hidden: false, value: '', classList: { toggle() {}, add() {}, remove() {} }, set onclick(f) { this._c = f; } });
  globalThis.document = { getElementById: el };
  const { wireVault } = await import('../options/vault-ui.js');
  for (const lang of ['en', 'ar']) {
    const cat = lang === 'ar' ? AR : EN;
    for (const unreadable of [true, false]) {
      await wireVault({ send: async () => ({ ok: true, result: { pass: false, locked: false } }), t: (k) => cat[k] || k, changed() {}, unreadable: () => unreadable });
      assert.equal(els['vault-mode'].textContent, unreadable ? cat['options.vault.unreadable'] : cat['options.vault.modeOff'], `${lang} ${unreadable}`);
    }
  }
  const opt = read('options/options.js');
  assert.match(opt, /res\.code === 'VAULT_UNREADABLE' \? t\('options\.vault\.unreadable'\) : res\.error/, 'a refused credential save shows the translated refusal');
  assert.match(opt, /unreadable: \(\) => !!\/\*\* @type \{any\} \*\/ \(settings\)\.vaultUnreadable/);
});

/* ── 7: the erase-all confirm names everything it erases ─────────────────── */
await test('erase-all confirm text names replay data and saved cookie profiles in both languages', () => {
  assert.match(EN['options.safe.eraseQuestion'], /replay data/);
  assert.match(EN['options.safe.eraseQuestion'], /cookie profiles/);
  assert.match(AR['options.safe.eraseQuestion'], /إعادة التشغيل/);
  assert.match(AR['options.safe.eraseQuestion'], /ملفات تعريف الارتباط/);
});

await test('both image editors act on a failed Thmanyah load (no silent system face in a PNG), key pair present', () => {
  assert.ok(EN['common.canvasFontMissing'] && AR['common.canvasFontMissing']);
  assert.match(read('annotate/annotate.js'), /if \(!fontOk\) say\(QAWi18n\.t\('common\.canvasFontMissing'\), 'err'\)/);
  assert.match(read('videoedit/videoedit.js'), /if \(!\(await Shapes\.ensureCanvasFont\(\)\)\) say\(t\('common\.canvasFontMissing'\), 'err'\)/);
});

await test('T-021: the badge words come from the catalogue through tw() as an en/ar pair, with no literal word left in paintBadge', () => {
  const sw = workerSrc();
  const fn = sw.slice(sw.indexOf('async function paintBadge'), sw.indexOf("const DONE_KEY"));
  for (const [key, en, ar] of [['done', 'Task finished', 'اكتملت مهمة'], ['errors', 'Errors', 'الأخطاء'], ['warnings', 'Warnings', 'التحذيرات']]) {
    assert.ok(fn.includes(`tw('common.worker.badge.${key}', '${en}')`), `paintBadge asks tw for badge.${key}`);
    assert.equal(EN[`common.worker.badge.${key}`], en);
    assert.equal(AR[`common.worker.badge.${key}`], ar);
    assert.ok(!fn.includes(`'${ar}'`), `no Arabic literal '${ar}' left in paintBadge`);
  }
  assert.ok(!/getUILanguage|ar \?/.test(fn), 'paintBadge no longer picks the language itself');
});

console.log(`now fixes: ${passed} passed`);
