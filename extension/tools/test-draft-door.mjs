/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * T-075 bytes (DEC-07): the draft, spec, title and repro-steps code lives behind the offscreen door.
 *
 *   node tools/test-draft-door.mjs
 *
 * Runs the real `offDraft` from `offscreen/offscreen.js` (its source is cut out and loaded with a
 * stub database), then compares every op with what Node gets from the core functions directly.
 * The wiring is checked from the worker's own call sites: each op it names must exist in the
 * door and in the offscreen switch.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPlaywrightSpec } from '../core/artifact.js';
import { title } from '../core/formats.js';
import { draft, pickIssueType, KINDS } from '../core/jira-templates.js';
import { problemEvents } from '../core/events.js';
import { workerSrc } from './lib-worker-src.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}
const json = (v) => JSON.parse(JSON.stringify(v ?? null));

const T0 = 1_700_000_000_000;
const url = 'https://example.gov/apply';
const session = {
  id: 's_fixture', charter: 'Submit an application with an expired document', startedAt: T0, endedAt: T0 + 12_000,
  startUrl: url, env: { viewport: '1920x1080 @1x', userAgent: 'Chrome/126', platform: 'Win32', language: 'ar-JO' }, status: 'stopped',
};
const events = [
  { kind: 'nav', ts: T0 + 100, url, frameUrl: url },
  { kind: 'dom', ts: T0 + 2000, action: 'input', value: 'nader', label: 'user', locator: "getByLabel('user')", framePrefix: '', frameUrl: url, tag: 'input' },
  { kind: 'dom', ts: T0 + 3000, action: 'click', label: 'Send', locator: "getByRole('button', { name: 'Send', exact: true })", framePrefix: '', frameUrl: url, tag: 'button' },
  { kind: 'net', ts: T0 + 3400, method: 'POST', url: '/api/applications', status: 500, durationMs: 380, error: false, responsePreview: '{"error":"NullPointerException"}', frameUrl: url },
  { kind: 'net', ts: T0 + 3401, method: 'POST', url: '/api/applications', status: 500, durationMs: 380, error: false, frameUrl: url },
  { kind: 'console', ts: T0 + 3450, level: 'error', text: 'Submit failed: 500', frameUrl: url },
  { kind: 'note', ts: T0 + 4000, text: 'Reproduced three times in a row.' },
];

/** Cut `offDraft` out of the offscreen document (which cannot load in Node) and load it against a stub database. */
const src = read('offscreen/offscreen.js');
const start = src.indexOf('export async function offDraft');
assert.ok(start > 0, 'offDraft is missing from offscreen/offscreen.js');
const end = src.indexOf('\nasync function offExport', start);
const body = src.slice(start, end).replaceAll("'../core/", `'${pathToFileURL(path.join(root, 'core')).href}/`);
const tmp = path.join(os.tmpdir(), `uqa-offdraft-${process.pid}.mjs`);
fs.writeFileSync(tmp, `const dbLib = async () => globalThis.__uqaDb;\n${body}\n`);
globalThis.__uqaDb = {
  getSession: async (id) => (id === session.id ? session : undefined),
  getEvents: async (id) => (id === session.id ? events : []),
};
const { offDraft } = await import(pathToFileURL(tmp).href);
const ask = (fn, args) => offDraft({ fn, args });

console.log('draft door (T-075 bytes)');

await test('playwrightSpec through the door equals buildPlaywrightSpec called directly', async () => {
  const via = await ask('playwrightSpec', { sessionId: session.id });
  assert.equal(via, buildPlaywrightSpec(session, events));
  assert.ok(via.includes('getByRole'), 'the fixture produced a real spec, not an empty string');
});
await test('ticketTitle through the door equals title() called directly, and a gone session is null', async () => {
  const via = await ask('ticketTitle', { sessionId: session.id });
  assert.equal(via, title(session, events));
  assert.ok(via && via.length > 3);
  assert.equal(await ask('ticketTitle', { sessionId: 'nope' }), null);
});
await test('draftIssue equals draft() for the whole timeline, and with problemsOnly for problemEvents()', async () => {
  for (const { id: kind } of KINDS) {
    assert.deepEqual(json(await ask('draftIssue', { kind, sessionId: session.id })), json(draft(kind, session, events)), kind);
    assert.deepEqual(json(await ask('draftIssue', { kind, sessionId: session.id, problemsOnly: true })), json(draft(kind, session, problemEvents(events))), `${kind} problemsOnly`);
  }
  let differs = 0;
  for (const { id: kind } of KINDS) {
    const all = await ask('draftIssue', { kind, sessionId: session.id });
    const problems = await ask('draftIssue', { kind, sessionId: session.id, problemsOnly: true });
    if (all.body !== problems.body) differs++;
  }
  assert.ok(differs > 0, 'the notes-off flag changes some body, so the flag is not decoration');
});
await test('pickIssueType equals pickIssueType() and needs no session', async () => {
  const types = [{ id: '1', name: 'Task' }, { id: '2', name: 'Bug' }, { id: '3', name: 'Story' }];
  assert.deepEqual(await ask('pickIssueType', { kind: 'defect', types }), pickIssueType('defect', types) ?? null);
  assert.equal((await ask('pickIssueType', { kind: 'defect', types }))?.name, 'Bug');
});
await test('an unknown session throws for the ops that need one, and an unknown op throws', async () => {
  await assert.rejects(ask('draftIssue', { kind: 'defect', sessionId: 'nope' }), /Unknown session/);
  await assert.rejects(ask('nothing', { sessionId: session.id }), /no nothing/);
});

await test('wiring: every op the worker calls exists in the door and in the offscreen document', () => {
  const worker = workerSrc();
  const door = read('background/draft-door.js');
  const used = [...new Set([...worker.matchAll(/\bdraft\('(\w+)'/g)].map((m) => m[1]))];
  assert.deepEqual(used.sort(), ['draftIssue', 'pickIssueType', 'playwrightSpec', 'ticketTitle']);
  for (const op of used) {
    assert.ok(new RegExp(`export const ${op} = call\\('${op}'\\)`).test(door), `draft-door.js lacks ${op}`);
    assert.ok(op === 'pickIssueType' || new RegExp(`case '${op}'`).test(src), `offscreen lacks case ${op}`);
  }
  assert.ok(door.includes("exportOp('draft'") && src.includes("if (op === 'draft') return offDraft"), 'door -> offExport -> offDraft is not connected');
});
await test('wiring: the worker flushes the write queue before it asks the door', () => {
  assert.ok(/async function draft\(op, args\) \{\s*await flushEvents\(\);\s*return draftDoor\[op\]\(args\);/.test(workerSrc()));
});
await test('the worker keeps none of the three modules, and no direct call to them', () => {
  const worker = workerSrc();
  for (const m of ['artifact', 'formats', 'jira-templates']) assert.ok(!worker.includes(`../core/${m}.js'`), `${m}.js is imported by the worker`);
  assert.ok(!/\b(buildPlaywrightSpec|reproStepsFor|ticketTitle)\(/.test(worker.replace(/\/\*[\s\S]*?\*\//g, '')), 'a direct call survives in the worker');
});

fs.rmSync(tmp, { force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
