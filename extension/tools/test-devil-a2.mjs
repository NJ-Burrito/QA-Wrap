// devil-fix A2: points 15 (no probe timer), 2 (reporter shot at open), 19 (attack surface).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { workerSrc } from './lib-worker-src.mjs';
const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL', name, '-', e.message); } };

const manifest = JSON.parse(read('manifest.json'));
const sw = workerSrc();

t('15: replay recorder has no polling timer', () => {
  const src = read('content/replay-recorder.js');
  assert.doesNotMatch(src, /PROBE_MS|probeTimer/);
  assert.match(src, /UQA_STATE_CHANGED'\) probe\(\)/);
});

t('2: reporter opens only after the buggy tab is photographed', () => {
  const open = sw.match(/UQA_OPEN_REPORTER: async \(\) => \{([\s\S]*?)\},/)[1];
  assert.ok(open.indexOf('shootBeforeReporter') >= 0 && open.indexOf('shootBeforeReporter') < open.indexOf('openOwnPage'));
  const file = sw.match(/async function reporterFile[\s\S]*?\n\}/)[0];
  assert.match(file, /takeReporterShot/);
  assert.doesNotMatch(file, /captureScreenshot/);
});

t('19: overlay.css is not web-accessible and ui-host no longer fetches it', () => {
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.doesNotMatch(read('content/ui-host.js'), /fetch\(chrome/);
  assert.match(sw, /css: \(await overlayCss\)/);
});

t('19: cookies is optional, not required', () => {
  assert.ok(!manifest.permissions.includes('cookies'));
  assert.ok(manifest.optional_permissions.includes('cookies'));
  assert.doesNotMatch(read('background/storage-editor.js'), /chrome\.cookies\./);
});

t('19: content-script allow-list covers what content scripts send, and nothing dangerous', () => {
  const list = new Set([...sw.match(/const CONTENT_SCRIPT_TYPES = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'(UQA_\w+)'/g)].map((m) => m[1]));
  const sent = new Set();
  for (const f of fs.readdirSync(path.join(EXT, 'content')).filter((f) => f.endsWith('.js'))) {
    for (const m of read('content/' + f).matchAll(/(?:send|sendMessage)\(\s*\{\s*type:\s*'(UQA_\w+)'/g)) sent.add(m[1]);
    for (const m of read('content/' + f).matchAll(/type:\s*'(UQA_CURSOR|UQA_EVENT)'/g)) sent.add(m[1]);
  }
  sent.add('UQA_REPLAY_CHUNK');
  for (const s of sent) assert.ok(list.has(s), `${s} is sent by a content script but not allowed`);
  for (const bad of ['UQA_SET_SETTINGS', 'UQA_COOKIES', 'UQA_COOKIE_SET', 'UQA_VAULT_UNLOCK', 'UQA_JIRA_FILE', 'UQA_OPEN_REPORTER']) assert.ok(!list.has(bad), bad);
  assert.match(sw, /sender\?\.tab && !isExtensionPage\(sender\) && !CONTENT_SCRIPT_TYPES\.has\(type\)/);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
