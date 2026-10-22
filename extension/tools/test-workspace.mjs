/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Team workspaces.
 *
 * The assertions that carry weight are all about the same promise: **a
 * workspace file never carries a credential, and importing one can never start
 * sending anything anywhere.** Everything else here is convenience; those two
 * are the reason a file is an acceptable substitute for a server.
 */
import assert from 'node:assert/strict';
import {
  ROLES, ABILITIES, VERSION, SHARED_KEYS,
  can, refusal, roleById, stripSecrets,
  exportWorkspace, importWorkspace, describeImport,
} from '../core/workspace.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

/* A settings object with every secret this product can hold. */
const SETTINGS = {
  clock: '24',
  imageFormat: 'webp',
  breakRepeat: 3,
  maskExtraPattern: 'nationalId',
  soundEnabled: true,
  jira: {
    baseUrl: 'https://team.atlassian.net',
    project: 'QA',
    issueType: 'Bug',
    email: 'qa@example.test',
    token: 'ATATT-super-secret',
  },
  slack: { webhookUrl: 'https://hooks.slack.com/services/T/B/XXXX', mention: '<!here>' },
  webhooks: [
    { id: 'w1', label: 'QA channel', provider: 'slack', minSeverity: 'all', url: 'https://hooks.slack.com/services/T/B/YYY' },
    { id: 'w2', label: 'Leads only', provider: 'teams', minSeverity: 'critical', url: 'https://x.webhook.office.com/z', template: '{"token":"leaked"}' },
  ],
  trackers: {
    github: { token: 'ghp_secret', repo: 'team/portal' },
    linear: { token: 'lin_api_secret', team: 'ENG' },
  },
  watermarkImages: false,
};

console.log('workspace.js — roles');

test('three roles, each split by consequence rather than seniority', () => {
  assert.equal(ROLES.length, 3);
  for (const role of ROLES) {
    assert.ok(role.what && role.what.length > 30, `${role.id} does not explain itself`);
    assert.ok(role.can.length, `${role.id} can do nothing at all`);
    for (const ability of role.can) assert.ok(ABILITIES[ability], `${role.id} claims an unknown ability ${ability}`);
  }
});

test('every ability says why it is gated', () => {
  for (const [id, a] of Object.entries(ABILITIES)) {
    assert.ok(a.why && a.why.length > 25, `${id} does not say why it needs gating`);
  }
});

test('an observer can record but cannot file or post', () => {
  const ws = { name: 'Team', role: 'observer' };
  assert.equal(can(ws, 'test'), true, 'recording is local, so nobody needs protecting from it');
  assert.equal(can(ws, 'file'), false);
  assert.equal(can(ws, 'notify'), false);
});

test('a tester files and posts but cannot change what the team shares', () => {
  const ws = { name: 'Team', role: 'tester' };
  assert.equal(can(ws, 'file'), true);
  assert.equal(can(ws, 'configure'), false);
  assert.equal(can(ws, 'share'), false);
});

test('a lead can do everything', () => {
  const ws = { name: 'Team', role: 'lead' };
  for (const ability of Object.keys(ABILITIES)) assert.equal(can(ws, ability), true, ability);
});

test('with no workspace, everything is permitted', () => {
  // One person with no team must not have to grant themselves permission to
  // use their own tool.
  for (const ability of Object.keys(ABILITIES)) {
    assert.equal(can(null, ability), true, ability);
    assert.equal(can({}, ability), true, ability);
  }
});

test('an unknown role is permissive, not silently restrictive', () => {
  // A file from a newer build naming a role this one has never heard of must
  // not lock somebody out of their own extension.
  assert.equal(can({ name: 'T', role: 'archivist' }, 'file'), true);
});

test('the refusal names the role, the reason and who to ask', () => {
  const said = refusal({ name: 'Portal QA', role: 'observer' }, 'file');
  assert.match(said, /Observer/);
  assert.match(said, /Portal QA/);
  assert.match(said, /triage/, 'it should carry the reason the ability is gated');
  assert.match(said, /Ask whoever set the workspace up/);
});

console.log('\nworkspace.js — nothing secret travels');

test('stripSecrets removes every credential-shaped field, at any depth', () => {
  const clean = stripSecrets(SETTINGS);
  const text = JSON.stringify(clean);
  for (const secret of ['ATATT-super-secret', 'ghp_secret', 'lin_api_secret', 'hooks.slack.com', 'leaked']) {
    assert.equal(text.includes(secret), false, `"${secret}" survived`);
  }
  // And the harmless neighbours survive, or the strip is useless.
  assert.equal(clean.jira.project, 'QA');
  assert.equal(clean.trackers.github.repo, 'team/portal');
});

test('an exported workspace contains no credential of any kind', () => {
  const ws = exportWorkspace({ name: 'Portal QA', role: 'tester', settings: SETTINGS, author: 'Nader' });
  const text = JSON.stringify(ws);
  for (const secret of ['ATATT', 'ghp_', 'lin_api', 'hooks.slack.com', 'webhook.office.com', 'leaked']) {
    assert.equal(text.includes(secret), false, `"${secret}" was exported`);
  }
});

test('a custom chat template never travels — somebody pastes a token into one', () => {
  const ws = exportWorkspace({ name: 'T', settings: SETTINGS });
  assert.equal(JSON.stringify(ws).includes('template'), false);
});

test('the useful shape survives: destinations keep label, provider and floor', () => {
  const ws = exportWorkspace({ name: 'T', settings: SETTINGS });
  assert.equal(ws.destinations.length, 2);
  assert.equal(ws.destinations[1].label, 'Leads only');
  assert.equal(ws.destinations[1].minSeverity, 'critical');
  assert.equal('url' in ws.destinations[1], false, 'the URL is the part that must not travel');
});

test('sharing is an allow-list, so a new setting does not travel by accident', () => {
  const ws = exportWorkspace({ name: 'T', settings: { ...SETTINGS, somethingNewAndPrivate: 'oops' } });
  assert.equal('somethingNewAndPrivate' in ws.settings, false);
  for (const key of Object.keys(ws.settings)) assert.ok(SHARED_KEYS.includes(key), `${key} is not on the list`);
});

test('a workspace needs a name', () =>
  assert.throws(() => exportWorkspace({ settings: SETTINGS }), /needs a name/));

console.log('\nworkspace.js — importing');

const file = JSON.stringify(exportWorkspace({ name: 'Portal QA', role: 'tester', settings: SETTINGS, author: 'Nader' }));

test('a round trip keeps the shared settings and the role', () => {
  const { workspace, settings } = importWorkspace(file);
  assert.equal(workspace.name, 'Portal QA');
  assert.equal(workspace.role, 'tester');
  assert.equal(settings.clock, '24');
  assert.equal(settings.imageFormat, 'webp');
  assert.equal(settings.jira.project, 'QA');
});

test('importing can never start posting anywhere', () => {
  // The single most important assertion in this file. A workspace that arrived
  // with a live webhook would let one file turn everybody's extension into a
  // sender.
  const { settings } = importWorkspace(file);
  for (const d of settings.webhooks) {
    assert.equal(d.url, '', 'a destination must arrive empty');
    assert.equal(d.enabled, false, 'and switched off');
  }
});

test('a hand-edited file carrying a token has it stripped, and says so', () => {
  const tampered = JSON.parse(file);
  tampered.jira.token = 'ATATT-someone-elses';
  tampered.trackers.github.token = 'ghp_someone-elses';
  const { settings, warnings } = importWorkspace(JSON.stringify(tampered));
  assert.equal(JSON.stringify(settings).includes('someone-elses'), false, 'a token must never be imported');
  assert.ok(warnings.some((w) => /credential/i.test(w)), 'and the tester should be told it happened');
});

test('a newer workspace version is read, with a warning rather than a refusal', () => {
  const newer = JSON.parse(file);
  newer.njbWorkspace = VERSION + 5;
  const { workspace, warnings } = importWorkspace(JSON.stringify(newer));
  assert.equal(workspace.name, 'Portal QA', 'it should still be usable');
  assert.ok(warnings.some((w) => /newer/i.test(w)));
});

test('an unknown role falls back to Tester, and says so', () => {
  const odd = JSON.parse(file);
  odd.role = 'archivist';
  const { workspace, warnings } = importWorkspace(JSON.stringify(odd));
  assert.equal(workspace.role, 'tester');
  assert.ok(warnings.some((w) => /archivist/.test(w)));
});

test('a file that is not a workspace is refused by name', () => {
  assert.throws(() => importWorkspace('{"hello":1}'), /no "njbWorkspace" version/);
  assert.throws(() => importWorkspace('{nope'), /not a workspace file/);
});

console.log('\nworkspace.js — saying what will happen first');

test('the description names the workspace, the role and what changes', () => {
  const said = describeImport(importWorkspace(file));
  assert.match(said.title, /Join "Portal QA" as Tester/);
  // "5 setting(s)" until 6 September; the count and the noun agree now.
  assert.match(said.changes, /\b5 settings\b/, 'the count and the noun have to agree');
  assert.match(said.changes, /switched off until you add a URL/);
  assert.ok(said.roleWhat.length > 30, 'the role has to explain itself here too');
});

test('it always says the roles are not security', () => {
  // The claim this feature would otherwise imply, and the one somebody would
  // eventually rely on. It is stated every single time.
  const said = describeImport(importWorkspace(file));
  assert.match(said.honesty, /mistakes, not malice/);
  assert.match(said.honesty, /Nothing here is a security boundary/);
});

test('a workspace with nothing in it says so rather than claiming changes', () => {
  const empty = JSON.stringify({ njbWorkspace: VERSION, name: 'Empty', role: 'tester' });
  const said = describeImport(importWorkspace(empty));
  assert.match(said.changes, /carries no settings/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
