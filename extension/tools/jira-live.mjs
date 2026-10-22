/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * File one real issue into a real Jira, by hand, to prove the path end to end.
 *
 * ── why this is a script and not a test ────────────────────────────────────
 *
 * `tools/test-jira-autosubmit.mjs` and `tools/test-jira-auth.mjs` assert the
 * shape of every request against recorded fixtures and never touch a network.
 * That is the right default: a suite that files into a tracker is one paste
 * away from filing into somebody's real project, and it would do so on every
 * run, from every branch, for ever.
 *
 * But a fixture can only prove that we send what we think we send. It cannot
 * prove that Jira accepts it. This does, once, when a person runs it.
 *
 * **It is not in `npm test` and must never be.**
 *
 * ── the credentials ────────────────────────────────────────────────────────
 *
 * Read from a file outside the repository, `~/.config/qa-wrap/jira.env` by
 * default, or wherever `QAW_JIRA_ENV` points. Nothing is written back to it,
 * nothing is echoed, and the token is never printed: not the value, not a
 * prefix, not its length. The summary shows the site, the account and the
 * project keys and stops there.
 *
 *     JIRA_BASE_URL=https://your-site.atlassian.net
 *     JIRA_EMAIL=you@example.com     # Cloud only; Data Center ignores it
 *     JIRA_TOKEN=...                 # Cloud: id.atlassian.com, under API tokens
 *                                    # Data Center: your profile, under PATs
 *     JIRA_AUTH=bearer|basic         # optional; the host decides when it is absent
 *     JIRA_PROJECT=QAW               # only needed to file
 *     JIRA_ISSUE_TYPE=Task           # optional; a safe default rather than Bug
 *
 * ── the two Jiras ──────────────────────────────────────────────────────────
 *
 * `JIRA_AUTH` is the same override the product's Settings page carries, in the
 * words a person writing an env file would use: `bearer` is a Data Center or
 * Server personal access token, `basic` is a Cloud email and API token pair.
 * Left out, the host decides, exactly as the extension decides:
 * `*.atlassian.net` is Cloud and everything else is Data Center. One module
 * answers that question for the product and for this script, `core/jira-auth.js`,
 * so a check that passes here is a check of what the extension will send.
 *
 * ── what it does, and what it will not do ──────────────────────────────────
 *
 * `--check` asks who the token belongs to and lists the projects it can see,
 * then stops. It files nothing, needs no `JIRA_PROJECT`, and is the right thing
 * to run against somebody else's real Jira.
 *
 * Without it, the script creates **one** issue, attaches **one** small text
 * file, reads the issue back to prove both landed, and prints its key and URL.
 * It deletes nothing, closes nothing and edits nothing else: the issue it made
 * is left for a person to look at and remove. A script that cleans up after
 * itself in somebody's real project is a script that can delete the wrong thing.
 *
 *   node tools/jira-live.mjs --check    # read the account and the projects, file nothing
 *   node tools/jira-live.mjs            # create one issue
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveAuthMode, detectAuthMode, jiraTransport, refusedCredentialsMessage } from '../core/jira-auth.js';

const ENV_PATH = process.env.QAW_JIRA_ENV || path.join(os.homedir(), '.config', 'qa-wrap', 'jira.env');
const checkOnly = process.argv.includes('--check');

function readEnv(file) {
  if (!fs.existsSync(file)) {
    console.error(`No credentials at ${file}`);
    console.error('Create it, or point QAW_JIRA_ENV at one. The header of this file says what goes in it.');
    process.exit(2);
  }
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

/**
 * `JIRA_AUTH` in the words an env file uses, mapped to the setting's own values.
 *
 * Anything else, including nothing, leaves the choice to the host. A typo must
 * not silently become Cloud: it becomes `auto`, which reads the URL, which is
 * the answer the person wanted anyway.
 */
function authModeFrom(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'bearer' || v === 'server' || v === 'pat' || v === 'datacenter') return 'server';
  if (v === 'basic' || v === 'cloud') return 'cloud';
  return 'auto';
}

const env = readEnv(ENV_PATH);
const cfg = {
  baseUrl: (env.JIRA_BASE_URL || '').replace(/\/+$/, ''),
  email: env.JIRA_EMAIL || '',
  token: env.JIRA_TOKEN || '',
  project: env.JIRA_PROJECT || '',
  authMode: authModeFrom(env.JIRA_AUTH),
};
const issueType = env.JIRA_ISSUE_TYPE || 'Task';
const mode = resolveAuthMode(cfg);

/**
 * What each run cannot do without.
 *
 * `--check` needs no project, and a Data Center site needs no email, so the
 * list is built from what this run is actually about to do rather than from
 * the union of everything the file can hold.
 */
const needed = ['baseUrl', 'token', ...(mode === 'cloud' ? ['email'] : []), ...(checkOnly ? [] : ['project'])];
const missing = needed.filter((k) => !cfg[k]);
if (missing.length) {
  const names = { baseUrl: 'JIRA_BASE_URL', email: 'JIRA_EMAIL', token: 'JIRA_TOKEN', project: 'JIRA_PROJECT' };
  console.error(`${ENV_PATH} is missing: ${missing.map((k) => names[k]).join(', ')}`);
  process.exit(2);
}

// The token is never printed, here or anywhere below: not the value, not a
// prefix of it, not its length. The sign-in line names the scheme, which is a
// property of the site rather than of the secret.
console.log(`site     ${cfg.baseUrl}`);
console.log(`sign-in  ${mode === 'server' ? 'Bearer, a Data Center personal access token' : 'Basic, a Cloud email and API token'}` +
  `${cfg.authMode === 'auto' ? ` (detected from the host: ${detectAuthMode(cfg.baseUrl)})` : ' (JIRA_AUTH)'}`);
if (mode === 'cloud') console.log(`as       ${cfg.email}`);
if (!checkOnly) {
  console.log(`project  ${cfg.project}`);
  console.log(`type     ${issueType}`);
}

const { testConnection, createIssue, attachFiles, readProvenance, attachProvenance, projects } =
  await import('../background/jira.js');
const { textToAdf } = await import('../core/adf.js');

/**
 * `--check`: the two reads that prove the credential works, and nothing else.
 *
 * `/myself` says the token is accepted and who it belongs to; the project list
 * says the account can see something. Both are GETs. Nothing is created,
 * nothing is edited, and no `JIRA_PROJECT` is consulted, so this is safe to run
 * against a real company Jira before anybody has decided which project may
 * receive a test issue.
 *
 * The status code is printed because that is the number worth reporting: a 401
 * from a Bearer header and a 401 from a Basic one mean different things, and
 * this script's whole job on a new site is to say which one came back.
 */
if (checkOnly) {
  try {
    // `/myself` is fetched through the transport rather than through
    // `whoAmI()` for one reason: the status code is the thing worth reporting,
    // and the client turns a refusal into a sentence and throws the number
    // away. The header and the REST version still come from the one builder,
    // so this is the same request the extension makes.
    const t = jiraTransport(cfg);
    const res = await fetch(`${t.base}${t.api}/myself`, { headers: t.headers });
    const raw = await res.text();
    console.log(`\nstatus   ${res.status} from ${t.api}/myself`);
    if (!res.ok) {
      console.error(`failed: ${refusedCredentialsMessage(cfg)}`);
      process.exit(1);
    }
    const me = JSON.parse(raw);
    console.log(`user     ${me.displayName || me.name || me.emailAddress || me.accountId || 'unknown'}`);
    const list = await projects(cfg);
    console.log(`projects ${list.length}: ${list.map((p) => p.key).join(', ') || 'none visible'}`);
    console.log('\n--check: two reads, nothing created.');
    process.exit(0);
  } catch (err) {
    console.error(`\nfailed: ${err.message}`);
    process.exit(1);
  }
}

try {
  const who = await testConnection(cfg);
  console.log(`\nconnected as ${who.account?.name || 'unknown'}, ${who.projects} project(s) visible, sign-in ${who.mode}`);

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const created = await createIssue(cfg, {
    projectKey: cfg.project,
    issueTypeName: issueType,
    summary: `QA Wrap live check ${stamp}`,
    description: textToAdf(
      [
        'Created by `tools/jira-live.mjs`, by hand, to prove the filing path reaches this site.',
        '',
        'Nothing about this issue is automatic: no suite creates it, and nothing will delete it.',
        'It is safe to close or remove.',
      ].join('\n'),
    ),
    labels: ['qa-wrap', 'live-check'],
  });
  console.log(`created  ${created.key}  ${created.url}`);

  const attached = await attachFiles(cfg, created.key, [
    {
      filename: `qa-wrap-live-check-${stamp.replace(/[: ]/g, '-')}.md`,
      blob: new Blob([`# QA Wrap live check\n\nFiled ${stamp} from tools/jira-live.mjs.\n`], { type: 'text/markdown' }),
    },
  ]);
  for (const f of attached) console.log(`attached ${f.name}: ${f.ok ? `${f.bytes} bytes` : `refused, ${f.error}`}`);

  const mark = await attachProvenance(cfg, created.key, { tool: 'QA Wrap', check: 'live', at: Date.now() });
  console.log(`property ${mark.attached ? 'written' : `refused, ${mark.error}`}`);
  const back = await readProvenance(cfg, created.key).catch(() => null);
  console.log(`read back ${back ? 'yes' : 'no'}`);

  console.log(`\nDone. ${created.key} is yours to look at and remove; this script deletes nothing.`);
} catch (err) {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
}
