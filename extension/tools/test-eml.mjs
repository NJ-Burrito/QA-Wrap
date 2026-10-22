/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The .eml the report builds (report/eml.js) is a real RFC 5322 / MIME message: CRLF lines no
 * longer than 78 characters, an encoded non-ASCII subject, a base64 text body and attachments that
 * decode to the exact bytes. Parsed here with Python's standard `email` package when python is
 * available, and structurally otherwise.
 *
 *   node tools/test-eml.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import '../report/eml.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array.from({ length: 300 }, (_, i) => i % 256)]);
const eml = globalThis.UQAEml.build({
  subject: 'تقرير QA Wrap: تجديد الرخصة',
  text: 'خطوات إعادة الإنتاج\r\n1. افتح /apply\r\n2. انقر “تقديم”\r\nhttps://127.0.0.1:1/apply',
  attachments: [{ name: 'QA-Wrap-report.md', type: 'text/markdown; charset=utf-8', bytes: new TextEncoder().encode('# ملخص\n') }, { name: 'لقطة-1.png', type: 'image/png', bytes: png }],
  id: 'fixedid1', date: new Date(Date.UTC(2026, 8, 29, 10, 11, 25)),
});

test('CRLF everywhere and no line over 78 characters', () => {
  assert.ok(!/[^\r]\n/.test(eml), 'a bare LF');
  for (const l of eml.split('\r\n')) assert.ok(l.length <= 78, `long line: ${l.slice(0, 40)}`);
});
test('headers: draft, date, message id, MIME, multipart boundary; subject is an encoded word', () => {
  assert.match(eml, /^X-Unsent: 1\r\n/);
  assert.match(eml, /\r\nDate: Tue, 29 Sep 2026 10:11:25 \+0000\r\n/);
  assert.match(eml, /\r\nMessage-ID: <fixedid1@qa-wrap\.invalid>\r\n/);
  assert.match(eml, /\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
  assert.match(eml, /Content-Type: multipart\/mixed; boundary="=_qaw_fixedid1"/);
  assert.ok(eml.trimEnd().endsWith('--=_qaw_fixedid1--'));
});

const PYTHON_PARSE = `
import sys, email, email.policy
m = email.message_from_bytes(sys.stdin.buffer.read(), policy=email.policy.default)
print(m['Subject'])
parts = list(m.iter_parts())
print(len(parts))
print('|'.join(parts[0].get_content().splitlines()))
for p in parts[1:]:
    print(p.get_filename(), p.get_content_type(), len(p.get_content() if p.get_content_type().startswith('text') else p.get_content()))
`;
// python3 first: ubuntu-latest has no `python` (completion review 8). Windows has `python`; its python3 may be a Store stub that fails, so try both.
const runPy = (cmd) => spawnSync(cmd, ['-c', PYTHON_PARSE], { input: Buffer.from(eml, 'utf8'), encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
const py = [runPy('python3'), runPy('python')].find((r) => r.status === 0) || runPy('python');
if (py.error?.code === 'ENOENT') console.log('  skip  Python parse: no python or python3 on PATH');
else {
  test('Python runs the parse without an error', () => {
    assert.equal(py.status, 0, String(py.stderr).slice(0, 300));
  });
  test('Python email parses it: subject, three parts, body text, both attachments with their names', () => {
    const [subject, n, body, a1, a2] = py.stdout.trim().split(/\r?\n/);
    assert.equal(subject, 'تقرير QA Wrap: تجديد الرخصة');
    assert.equal(n, '3');
    assert.match(body, /خطوات إعادة الإنتاج\|1\. افتح \/apply/);
    assert.match(a1, /^QA-Wrap-report\.md text\/markdown/);
    assert.match(a2, /^لقطة-1\.png image\/png 3(?:\d\d)$/, a2);
  });
}

console.log(`\n${passed} passed, 0 failed`);
