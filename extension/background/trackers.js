/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Filing a defect into whatever the team actually uses.
 *
 * Jira has its own module (per-project issue types, required custom fields, two ways to link an epic). Everything
 * else is the same three questions, so the adapters share one interface: who am I (prove the credential before
 * anything is sent), where can I file (the repos, teams, boards or lists you can write to), file this (a title, a
 * body, a link back).
 *
 * Not a workflow integration: it files, and for Jira reads status back (`jira.js`); it does not sync labels,
 * assignees, sprints or comments, because an extension with no backend cannot do that reliably. Not an OAuth client:
 * every adapter takes a personal token the tester pastes, since a client secret in the bundle is readable by anyone.
 *
 * The rule every adapter obeys: a 200 is not success. Trello answers 200 with an error string, GitHub 201 with the
 * problem in the body, Linear 200 with an `errors` array. Each adapter checks what indicates success for that API
 * and returns the vendor's own message, because that one is actionable.
 */

import { fetchT } from '../core/http.js';
import { fingerprint } from '../core/fingerprint.js';
import { capSteps, docLabels } from '../core/doc-labels.js';
import { scanFields, redactFile, unscannedNames } from '../core/secret-scan.js';

/* ── the shared HTTP floor ─────────────────────────────────────────────── */

/** @param {string} url @param {{ method?: string, headers?: Record<string, string>, body?: any, label?: string, read?: boolean }} [opts] */
async function request(url, { method = 'GET', headers = {}, body, label, read = method === 'GET' } = {}) {
  let res;
  try {
    res = await fetchT(url, {
      method,
      headers: { accept: 'application/json', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    }, { noRedirect: label === 'Trello' }); // D-1010-184: the key and token ride in the query
  } catch (err) {
    // A create that timed out may still have landed; it is never re-sent here.
    const maybe = err.timeout && !read ? ' It may have gone through: check before filing again.' : '';
    throw Object.assign(new Error(`Could not reach ${label}. ${netReason(err)}${maybe} Check the host address and your network.`), { network: true });
  }

  const text = await res.text();
  let parsed = null;
  let notJson = false;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    notJson = true; // the raw text is the message
  }

  if (!res.ok) {
    const wait = res.status === 429 ? res.headers?.get?.('retry-after') : null;
    const limited = res.status === 429 ? `. Rate-limited${wait ? `; try again in ${wait} s` : ''}; nothing was created twice` : '';
    const fix = FIX[res.status] || (res.status >= 500 ? FIX[500] : '');
    throw Object.assign(new Error(`${label} refused this (${res.status}): ${vendorMessage(parsed, text).replace(/\.$/, '')}${limited}.${fix}`), { status: res.status });
  }
  // A sign-in or proxy page answers 200 too; reading it as data gave the tester a raw TypeError (F-4).
  if (notJson) {
    throw Object.assign(new Error(`${label} sent back a web page instead of data. Check the host address; a sign-in page means the server is behind a company login.`), { html: true }); // no status: a POST is never re-sent on this (YouTrack retry)
  }
  return { data: parsed, text, status: res.status };
}

/** The fix that goes with each refusal, so the sentence ends in something the tester can do. */
const FIX = {
  401: ' Check the token, or paste a new one.',
  403: ' The token works but is not allowed to do this: give it access to this project, or use one that has it.',
  404: ' Check the host, organisation and project names; a token that cannot see a project gets this too.',
  500: ' The service failed on its side; try again in a few minutes.',
};

/** Why a request never got an answer, in words rather than `fetch failed`. Node puts the reason in `cause.code`; Chrome gives none. */
function netReason(err) {
  const code = String(err?.cause?.code || '');
  if (err?.timeout) return `No answer after ${String(err.message).match(/\d+/)?.[0] || 20} s.`;
  if (err?.code) return err.message; // the redirect/policy guard already speaks in sentences
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return 'That host name does not exist.';
  if (/ECONNREFUSED|ECONNRESET/.test(code)) return 'Nothing answered at that address.';
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return 'Its security certificate is not trusted.';
  return 'The connection failed.';
}

/**
 * The one exit every adapter's failure goes through. Errors `request()` and the adapters raise are already
 * sentences; anything else (a TypeError on an answer of the wrong shape, `btoa` refusing a pasted token) is a
 * code fault the tester cannot act on, so it becomes one that names the fix.
 */
function plain(tracker, err, filing = false) {
  if (err?.name === 'Error' || err?.name === 'HttpTimeout') return err;
  if (err?.name === 'InvalidCharacterError') return new Error(`The ${tracker.label} token contains characters a token cannot have; paste it again.`);
  const check = filing ? ` Check in ${tracker.label} whether the issue was created before filing again.` : ' Check the host address and the token.';
  return new Error(`${tracker.label} answered, but not with what QA Wrap expected.${check}`);
}

/**
 * Dig the human-readable complaint out of whatever the vendor returned.
 *
 * Each of these puts it somewhere different, and a bare status code sends the
 * tester to a search engine rather than to the fix.
 */
function vendorMessage(parsed, text) {
  if (!parsed) return /^\s*</.test(text || '') ? 'it sent a web page, not an error message' : String(text || '').slice(0, 300) || 'no reason given';
  const candidates = [
    parsed.message,
    parsed.error,
    parsed.err,
    parsed.errors?.[0]?.message,
    parsed.errors?.[0]?.detail,
    parsed.errors && typeof parsed.errors === 'string' ? parsed.errors : null,
  ].filter(Boolean);
  const detail = parsed.errors?.map?.((e) => e.message || e.detail).filter(Boolean).join('; ');
  return (candidates[0] || detail || JSON.stringify(parsed)).slice(0, 300);
}

/** Same non-JSON tolerance as `request()`, for the two multipart uploads that
 *  cannot go through it (Shortcut and YouTrack attachments — see Jira's own
 *  `attachFile` for why multipart never reuses the JSON-body helper). */
function tryParse(text) {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/** One multipart upload with a longer timeout; the vendor's own words on refusal. */
async function postForm(url, headers, form) {
  const res = await fetchT(url, { method: 'POST', headers, body: form }, { timeoutMs: 60000 });
  const text = await res.text();
  if (!res.ok) throw new Error(vendorMessage(tryParse(text), text));
  return tryParse(text);
}

/** One request per file, so a rejected attachment never reads as a failed filing. */
async function uploadEach(files, field, send) {
  const out = [];
  for (const f of files) {
    try {
      const form = new FormData();
      form.append(field, f.blob, f.filename);
      await send(form);
      out.push({ name: f.filename, ok: true });
    } catch (err) {
      out.push({ name: f.filename, ok: false, error: err.message });
    }
  }
  return out;
}

/* ── GitHub ────────────────────────────────────────────────────────────── */

const github = {
  id: 'github',
  label: 'GitHub Issues',
  needs: [
    { key: 'token', label: 'Personal access token', secret: true,
      hint: 'github.com › Settings › Developer settings › Fine-grained tokens. Needs Issues: Read and write on the repo.' },
    { key: 'repo', label: 'Repository', hint: 'owner/name, e.g. acme/portal' },
  ],
  /** Markdown, natively — which is why the defect report exports to it already. */
  bodyFormat: 'markdown',
  maxBody: 65536,

  head(cfg) {
    return {
      authorization: `Bearer ${cfg.token}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    };
  },

  async whoAmI(cfg) {
    const { data } = await request('https://api.github.com/user', { headers: this.head(cfg), label: 'GitHub' });
    return { name: data.name || data.login, id: data.login };
  },

  async targets(cfg) {
    // Configured, not picked: an account with three hundred repositories turns
    // a picker into a scrolling exercise.
    const { data } = await request(`https://api.github.com/repos/${cfg.repo}`, {
      headers: this.head(cfg),
      label: 'GitHub',
    });
    if (!data.permissions?.push && !data.permissions?.triage) {
      throw new Error(`You can read ${cfg.repo} but not file issues on it.`);
    }
    return [{ id: data.full_name, label: data.full_name, note: data.private ? 'private' : 'public' }];
  },

  async create(cfg, { title, body, labels }) {
    const { data } = await request(`https://api.github.com/repos/${cfg.repo}/issues`, {
      method: 'POST',
      headers: this.head(cfg),
      body: { title, body, labels },
      label: 'GitHub',
    });
    return { key: `#${data.number}`, url: data.html_url, id: data.number };
  },

  /** Search API: an open issue carrying the fingerprint label (GitHub creates the label on first use). */
  async findExisting(cfg, { label }) {
    const q = encodeURIComponent(`repo:${cfg.repo} is:issue is:open label:"${label}"`);
    const { data } = await request(`https://api.github.com/search/issues?q=${q}&per_page=1`, { headers: this.head(cfg), label: 'GitHub' });
    const hit = data?.items?.[0];
    return hit ? { key: `#${hit.number}`, url: hit.html_url, id: hit.number } : null;
  },
};

/* ── Linear ────────────────────────────────────────────────────────────── */

const linear = {
  id: 'linear',
  label: 'Linear',
  needs: [
    { key: 'token', label: 'API key', secret: true,
      hint: 'Linear › Settings › API › Personal API keys.' },
    { key: 'team', label: 'Team key', hint: 'The prefix on your issue ids, e.g. ENG. Leave empty to be asked.' },
  ],
  bodyFormat: 'markdown',

  head(cfg) {
    // Linear personal keys go in Authorization with no scheme. Sending
    // "Bearer <key>" fails with an unhelpful 400, and that has cost people days.
    return { authorization: cfg.token, 'content-type': 'application/json' };
  },

  /**
   * One GraphQL endpoint for everything.
   *
   * And the reason this adapter cannot use the shared `request` unchanged:
   * Linear answers **HTTP 200 with an `errors` array** when a mutation fails.
   * A caller that trusts the status files nothing and reports success.
   */
  async gql(cfg, query, variables) {
    const { data } = await request('https://api.linear.app/graphql', {
      method: 'POST',
      headers: this.head(cfg),
      body: { query, variables },
      label: 'Linear',
      read: !/^\s*mutation\b/.test(query), // a GraphQL query is a POST that changes nothing
    });
    if (data?.errors?.length) {
      throw new Error(`Linear refused this: ${data.errors.map((e) => e.message).join('; ')}`);
    }
    return data?.data;
  },

  async whoAmI(cfg) {
    const out = await this.gql(cfg, '{ viewer { id name email } }');
    return { name: out.viewer.name, id: out.viewer.id };
  },

  async targets(cfg) {
    const out = await this.gql(cfg, '{ teams(first: 50) { nodes { id key name } } }');
    return out.teams.nodes.map((t) => ({ id: t.id, key: t.key, label: `${t.key}: ${t.name}` }));
  },

  async team(cfg, target) {
    const teams = await this.targets(cfg);
    const team = teams.find((t) => t.id === target || t.key === (target || cfg.team)) || teams[0];
    if (!team) throw new Error('No Linear team you can file into.');
    return team;
  },

  /** Label ids for names, creating the missing ones on the team. Linear takes ids, not names. A failure means no labels, never no filing. */
  async labelIds(cfg, team, names) {
    try {
      const found = await this.gql(cfg, 'query L($names: [String!]) { issueLabels(filter: { name: { in: $names } }) { nodes { id name team { id } } } }', { names });
      const nodes = found.issueLabels?.nodes || [];
      const ids = [];
      for (const n of names) {
        let l = nodes.find((x) => x.name === n && (!x.team || x.team.id === team.id));
        if (!l) {
          const made = await this.gql(cfg, 'mutation M($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success issueLabel { id } } }', { input: { name: n, teamId: team.id } });
          l = made.issueLabelCreate?.issueLabel;
        }
        if (l?.id) ids.push(l.id);
      }
      return ids;
    } catch { return []; }
  },

  async create(cfg, { title, body, target, labels }) {
    const team = await this.team(cfg, target);
    // Only the fingerprint travels as a label: the other names would each need a workspace label first.
    const fp = (labels || []).filter((l) => /^qaw-fp-/.test(l));
    const labelIds = fp.length ? await this.labelIds(cfg, team, fp) : [];

    const out = await this.gql(
      cfg,
      `mutation Create($input: IssueCreateInput!) {
         issueCreate(input: $input) { success issue { id identifier url } }
       }`,
      { input: { teamId: team.id, title, description: body, ...(labelIds.length ? { labelIds } : {}) } }
    );
    if (!out.issueCreate?.success) throw new Error('Linear accepted the request but did not create the issue.');
    return { key: out.issueCreate.issue.identifier, url: out.issueCreate.issue.url, id: out.issueCreate.issue.id };
  },

  /** An open issue on the team with the fingerprint label. */
  async findExisting(cfg, { label, target }) {
    const team = await this.team(cfg, target);
    const out = await this.gql(
      cfg,
      `query D($f: IssueFilter) { issues(filter: $f, first: 1) { nodes { id identifier url } } }`,
      { f: { team: { id: { eq: team.id } }, labels: { name: { eq: label } }, state: { type: { nin: ['completed', 'canceled'] } } } }
    );
    const hit = out.issues?.nodes?.[0];
    return hit ? { key: hit.identifier, url: hit.url, id: hit.id } : null;
  },

  /**
   * fileUpload gives a signed URL: PUT the bytes there with the headers Linear
   * returned, then attachmentCreate links the asset to the issue
   * (linear.app/developers/how-to-upload-a-file-to-linear).
   */
  async attach(cfg, issueId, files) {
    const out = [];
    for (const f of files) {
      try {
        const type = f.blob.type || 'application/octet-stream';
        const up = (await this.gql(cfg,
          'mutation U($size: Int!, $type: String!, $name: String!) { fileUpload(size: $size, contentType: $type, filename: $name) { success uploadFile { uploadUrl assetUrl headers { key value } } } }',
          { size: f.blob.size, type, name: f.filename })).fileUpload;
        if (!up?.success || !up.uploadFile) throw new Error('Linear gave no upload address.');
        const headers = { 'content-type': type, 'cache-control': 'public, max-age=31536000' };
        for (const h of up.uploadFile.headers || []) headers[h.key] = h.value;
        const put = await fetchT(up.uploadFile.uploadUrl, { method: 'PUT', headers, body: f.blob }, { timeoutMs: 60000 });
        if (!put.ok) throw new Error(`upload refused (${put.status})`);
        const link = (await this.gql(cfg,
          'mutation A($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }',
          { input: { issueId, title: f.filename, url: up.uploadFile.assetUrl } })).attachmentCreate;
        if (!link?.success) throw new Error('Linear did not link the file to the issue.');
        out.push({ name: f.filename, ok: true });
      } catch (err) {
        out.push({ name: f.filename, ok: false, error: err.message });
      }
    }
    return out;
  },
};

/* ── Trello ────────────────────────────────────────────────────────────── */

const trello = {
  id: 'trello',
  label: 'Trello',
  needs: [
    { key: 'key', label: 'API key', hint: 'trello.com/power-ups/admin › your Power-Up › API key.' },
    { key: 'token', label: 'Token', secret: true, hint: 'Generated from the API key page. Needs write scope.' },
    { key: 'list', label: 'List id', hint: 'Open the board, add .json to the URL, and find the list you want.' },
  ],
  /** Trello renders a limited Markdown, and it is the closest thing it has. */
  bodyFormat: 'markdown',
  maxBody: 16384,

  auth(cfg) {
    return `key=${encodeURIComponent(cfg.key)}&token=${encodeURIComponent(cfg.token)}`;
  },

  async whoAmI(cfg) {
    const { data } = await request(`https://api.trello.com/1/members/me?${this.auth(cfg)}`, { label: 'Trello' });
    return { name: data.fullName || data.username, id: data.username };
  },

  async targets(cfg) {
    const { data } = await request(
      `https://api.trello.com/1/members/me/boards?fields=name&${this.auth(cfg)}`,
      { label: 'Trello' }
    );
    const lists = [];
    // One board's lists at a time. Trello has no "every list I can see" call,
    // and fanning out over fifty boards to build a picker is rude to their API.
    for (const board of data.slice(0, 10)) {
      const { data: boardLists } = await request(
        `https://api.trello.com/1/boards/${board.id}/lists?fields=name&${this.auth(cfg)}`,
        { label: 'Trello' }
      ).catch(() => ({ data: [] }));
      for (const l of boardLists) lists.push({ id: l.id, label: `${board.name} › ${l.name}` });
    }
    return lists;
  },

  async create(cfg, { title, body, target }) {
    const list = target || cfg.list;
    if (!list) throw new Error('No Trello list chosen.');
    const { data } = await request(
      `https://api.trello.com/1/cards?${this.auth(cfg)}&idList=${encodeURIComponent(list)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { name: title, desc: body },
        label: 'Trello',
      }
    );
    return { key: data.idShort ? `#${data.idShort}` : data.id, url: data.shortUrl || data.url, id: data.id };
  },

  /** POST /cards/{id}/attachments, multipart `file` (developer.atlassian.com/cloud/trello). */
  attach(cfg, cardId, files) {
    return uploadEach(files, 'file', (form) => postForm(`https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/attachments?${this.auth(cfg)}`, {}, form));
  },
};

/* ── ClickUp ───────────────────────────────────────────────────────────── */

const clickup = {
  id: 'clickup',
  label: 'ClickUp',
  needs: [
    { key: 'token', label: 'API token', secret: true, hint: 'ClickUp › Settings › Apps › API token.' },
    { key: 'list', label: 'List id', hint: 'The number in the URL when a list is open.' },
  ],
  bodyFormat: 'markdown',

  head(cfg) {
    // ClickUp personal tokens go in Authorization with no scheme, like Linear.
    return { authorization: cfg.token, 'content-type': 'application/json' };
  },

  async whoAmI(cfg) {
    const { data } = await request('https://api.clickup.com/api/v2/user', { headers: this.head(cfg), label: 'ClickUp' });
    return { name: data.user.username, id: String(data.user.id) };
  },

  async targets(cfg) {
    const { data: teams } = await request('https://api.clickup.com/api/v2/team', {
      headers: this.head(cfg),
      label: 'ClickUp',
    });
    const out = [];
    for (const team of teams.teams || []) {
      const { data: spaces } = await request(
        `https://api.clickup.com/api/v2/team/${team.id}/space?archived=false`,
        { headers: this.head(cfg), label: 'ClickUp' }
      ).catch(() => ({ data: { spaces: [] } }));
      for (const space of spaces.spaces || []) {
        const { data: lists } = await request(
          `https://api.clickup.com/api/v2/space/${space.id}/list?archived=false`,
          { headers: this.head(cfg), label: 'ClickUp' }
        ).catch(() => ({ data: { lists: [] } }));
        for (const l of lists.lists || []) out.push({ id: l.id, label: `${space.name} › ${l.name}` });
      }
    }
    return out;
  },

  async create(cfg, { title, body, target }) {
    const list = target || cfg.list;
    if (!list) throw new Error('No ClickUp list chosen.');
    const { data } = await request(`https://api.clickup.com/api/v2/list/${list}/task`, {
      method: 'POST',
      headers: this.head(cfg),
      body: { name: title, markdown_description: body },
      label: 'ClickUp',
    });
    return { key: data.id, url: data.url, id: data.id };
  },

  /** POST /task/{id}/attachment, multipart `attachment`; the token goes bare (developer.clickup.com). */
  attach(cfg, taskId, files) {
    return uploadEach(files, 'attachment', (form) => postForm(`https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}/attachment`, { authorization: cfg.token }, form));
  },
};

/* ── Asana ─────────────────────────────────────────────────────────────── */

const asana = {
  id: 'asana',
  label: 'Asana',
  needs: [
    { key: 'token', label: 'Personal access token', secret: true,
      hint: 'Asana › My settings › Apps › Manage developer apps › Personal access tokens.' },
    { key: 'project', label: 'Project gid', hint: 'The long number in the URL when a project is open.' },
  ],
  /** Asana has no Markdown. Its notes field is plain text, and it is honest to say so. */
  bodyFormat: 'text',

  head(cfg) {
    return { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' };
  },

  async whoAmI(cfg) {
    const { data } = await request('https://app.asana.com/api/1.0/users/me', { headers: this.head(cfg), label: 'Asana' });
    return { name: data.data.name, id: data.data.gid };
  },

  async targets(cfg) {
    const { data: me } = await request('https://app.asana.com/api/1.0/users/me', {
      headers: this.head(cfg),
      label: 'Asana',
    });
    const out = [];
    for (const ws of me.data.workspaces || []) {
      const { data } = await request(
        `https://app.asana.com/api/1.0/projects?workspace=${ws.gid}&archived=false&limit=50`,
        { headers: this.head(cfg), label: 'Asana' }
      ).catch(() => ({ data: { data: [] } }));
      for (const p of data.data || []) out.push({ id: p.gid, label: `${ws.name} › ${p.name}` });
    }
    return out;
  },

  async create(cfg, { title, body, target }) {
    const project = target || cfg.project;
    if (!project) throw new Error('No Asana project chosen.');
    const { data } = await request('https://app.asana.com/api/1.0/tasks', {
      method: 'POST',
      headers: this.head(cfg),
      body: { data: { name: title, notes: body, projects: [project] } },
      label: 'Asana',
    });
    return { key: data.data.gid, url: `https://app.asana.com/0/${project}/${data.data.gid}`, id: data.data.gid };
  },

  /** POST /tasks/{gid}/attachments, multipart `file` (developers.asana.com). */
  attach(cfg, taskId, files) {
    return uploadEach(files, 'file', (form) => postForm(`https://app.asana.com/api/1.0/tasks/${encodeURIComponent(taskId)}/attachments`, { authorization: `Bearer ${cfg.token}` }, form));
  },
};

/* ── GitLab ───────────────────────────────────────────────────────────── */

/* Self-hosted as often as not, so the host is a field. The project is an id and
   not a path, because a path needs encoding a tester will get wrong. */
const gitlab = {
  id: 'gitlab',
  label: 'GitLab Issues',
  needs: [
    { key: 'host', label: 'GitLab host', hint: 'https://gitlab.com, or your own server.' },
    { key: 'token', label: 'Personal access token', secret: true,
      hint: 'User settings › Access tokens. Needs the `api` scope.' },
    { key: 'project', label: 'Project id', hint: 'The number under the project name on its overview page.' },
  ],
  bodyFormat: 'markdown',

  /* The seven kinds, mapped once. A defect is an incident because that is what
     GitLab's dashboards count; anything untyped stays an issue. */
  types: {
    defect: 'incident', testcase: 'test_case', task: 'task', subtask: 'task',
    story: 'issue', epic: 'issue', plain: 'issue',
  },

  base(cfg) { return String(cfg.host || 'https://gitlab.com').replace(/\/+$/, ''); },
  head(cfg) { return { 'private-token': cfg.token, 'content-type': 'application/json' }; },

  async whoAmI(cfg) {
    const { data } = await request(`${this.base(cfg)}/api/v4/user`, { headers: this.head(cfg), label: 'GitLab' });
    return { name: data.name || data.username, id: data.username };
  },

  async targets(cfg) {
    const { data } = await request(`${this.base(cfg)}/api/v4/projects/${encodeURIComponent(cfg.project)}`, {
      headers: this.head(cfg),
      label: 'GitLab',
    });
    return [{ id: String(data.id), label: data.path_with_namespace || data.name, note: data.visibility }];
  },

  async create(cfg, { title, body, labels, kind }) {
    const { data } = await request(`${this.base(cfg)}/api/v4/projects/${encodeURIComponent(cfg.project)}/issues`, {
      method: 'POST',
      headers: this.head(cfg),
      body: {
        title,
        description: body,
        issue_type: this.types[kind] || 'issue',
        labels: (labels || []).join(','),
      },
      label: 'GitLab',
    });
    return { key: `#${data.iid}`, url: data.web_url, id: data.id, iid: data.iid };
  },

  /** An open issue with the fingerprint label (GitLab creates project labels from the issue's own list). */
  async findExisting(cfg, { label }) {
    const { data } = await request(`${this.base(cfg)}/api/v4/projects/${encodeURIComponent(cfg.project)}/issues?labels=${encodeURIComponent(label)}&state=opened&per_page=1`, {
      headers: this.head(cfg), label: 'GitLab',
    });
    const hit = Array.isArray(data) ? data[0] : null;
    return hit ? { key: `#${hit.iid}`, url: hit.web_url, id: hit.id, iid: hit.iid } : null;
  },

  /**
   * POST /projects/:id/uploads (multipart `file`) answers a Markdown snippet; an
   * issue has no attachment list, so the snippets are appended to its description
   * (docs.gitlab.com/ee/api/projects.html#upload-a-file).
   */
  async attach(cfg, _id, files, { created, body = '' } = {}) {
    const project = encodeURIComponent(cfg.project);
    const out = [];
    const snippets = [];
    for (const f of files) {
      try {
        const form = new FormData();
        form.append('file', f.blob, f.filename);
        const up = await postForm(`${this.base(cfg)}/api/v4/projects/${project}/uploads`, { 'private-token': cfg.token }, form);
        if (!up?.markdown) throw new Error('GitLab gave no link for the upload.');
        snippets.push(up.markdown);
        out.push({ name: f.filename, ok: true });
      } catch (err) {
        out.push({ name: f.filename, ok: false, error: err.message });
      }
    }
    if (snippets.length) {
      await request(`${this.base(cfg)}/api/v4/projects/${project}/issues/${created.iid}`, {
        method: 'PUT', headers: this.head(cfg), body: { description: `${body}\n\n${snippets.join('\n')}` }, label: 'GitLab',
      }).catch((err) => out.push({ name: '(linking files to the issue)', ok: false, error: err.message }));
    }
    return out;
  },
};

/* ── Azure DevOps ─────────────────────────────────────────────────────── */

/* The one create call that is not ordinary JSON: Azure takes a JSON Patch
   document under `application/json-patch+json`, and the type is a path
   segment rather than a field. */
const azure = {
  id: 'azure',
  label: 'Azure DevOps',
  needs: [
    { key: 'org', label: 'Organisation', hint: 'The name in dev.azure.com/<organisation>.' },
    { key: 'project', label: 'Project', hint: 'The project name as it appears in the URL.' },
    { key: 'token', label: 'Personal access token', secret: true,
      hint: 'User settings › Personal access tokens. Needs Work Items: Read & write.' },
  ],
  bodyFormat: 'html',

  /* The seven kinds, mapped once, in the Agile template's names. Scrum and CMMI
     differ; Azure names the type it did not know and that message is passed
     straight through. */
  types: {
    defect: 'Bug', testcase: 'Test Case', story: 'User Story', epic: 'Epic',
    task: 'Task', subtask: 'Task', plain: 'Issue',
  },

  base(cfg) { return `https://dev.azure.com/${encodeURIComponent(cfg.org)}/${encodeURIComponent(cfg.project)}`; },
  /* Basic with an empty username is what a PAT is, per Azure's own docs. */
  head(cfg, contentType = 'application/json') {
    return { authorization: `Basic ${btoa(`:${cfg.token}`)}`, 'content-type': contentType };
  },

  async whoAmI(cfg) {
    const { data } = await request(
      `https://dev.azure.com/${encodeURIComponent(cfg.org)}/_apis/projects?api-version=7.0`,
      { headers: this.head(cfg), label: 'Azure DevOps' },
    );
    const names = (data.value || []).map((v) => v.name);
    if (!names.includes(cfg.project)) {
      throw new Error(`That token reaches ${cfg.org} but not the project "${cfg.project}".`);
    }
    return { name: cfg.org, id: cfg.project };
  },

  async targets(cfg) {
    const { data } = await request(`${this.base(cfg)}/_apis/wit/workitemtypes?api-version=7.0`, {
      headers: this.head(cfg), label: 'Azure DevOps',
    });
    return (data.value || []).map((t) => ({ id: t.name, label: t.name }));
  },

  async create(cfg, { title, body, labels, kind }) {
    const type = this.types[kind] || 'Issue';
    const { data } = await request(
      `${this.base(cfg)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.0`,
      {
        method: 'POST',
        headers: this.head(cfg, 'application/json-patch+json'),
        body: [
          { op: 'add', path: '/fields/System.Title', value: title },
          { op: 'add', path: '/fields/System.Description', value: body },
          ...(labels?.length ? [{ op: 'add', path: '/fields/System.Tags', value: labels.join('; ') }] : []),
        ],
        label: 'Azure DevOps',
      },
    );
    return {
      key: `#${data.id}`,
      url: data._links?.html?.href || `${this.base(cfg)}/_workitems/edit/${data.id}`,
      id: data.id,
    };
  },

  /** WIQL on the tag; closed states are not duplicates. */
  async findExisting(cfg, { label }) {
    const { data } = await request(`${this.base(cfg)}/_apis/wit/wiql?api-version=7.0`, {
      method: 'POST', headers: this.head(cfg), label: 'Azure DevOps',
      body: { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS '${label}' AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Resolved') ORDER BY [System.ChangedDate] DESC` },
    });
    const hit = data?.workItems?.[0];
    return hit ? { key: `#${hit.id}`, url: `${this.base(cfg)}/_workitems/edit/${hit.id}`, id: hit.id } : null;
  },

  /**
   * POST _apis/wit/attachments?fileName= (octet-stream) answers { id, url }; a
   * JSON Patch `add /relations/-` of rel AttachedFile then ties it to the work
   * item (learn.microsoft.com/rest/api/azure/devops/wit/attachments/create).
   */
  async attach(cfg, workItemId, files) {
    const out = [];
    const ops = [];
    for (const f of files) {
      try {
        const res = await fetchT(`${this.base(cfg)}/_apis/wit/attachments?fileName=${encodeURIComponent(f.filename)}&api-version=7.0`, {
          method: 'POST', headers: { authorization: this.head(cfg).authorization, 'content-type': 'application/octet-stream' }, body: f.blob,
        }, { timeoutMs: 60000 });
        const text = await res.text();
        const parsed = tryParse(text);
        if (!res.ok) throw new Error(vendorMessage(parsed, text));
        if (!parsed?.url) throw new Error('Azure DevOps gave no address for the upload.');
        ops.push({ op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: parsed.url, attributes: { comment: f.filename } } });
        out.push({ name: f.filename, ok: true });
      } catch (err) {
        out.push({ name: f.filename, ok: false, error: err.message });
      }
    }
    if (ops.length) {
      await request(`${this.base(cfg)}/_apis/wit/workitems/${encodeURIComponent(workItemId)}?api-version=7.0`, {
        method: 'PATCH', headers: this.head(cfg, 'application/json-patch+json'), body: ops, label: 'Azure DevOps',
      }).catch((err) => out.push({ name: '(linking files to the work item)', ok: false, error: err.message }));
    }
    return out;
  },
};

/* ── Shortcut ─────────────────────────────────────────────────────────── */

/* Formerly Clubhouse. https://developer.shortcut.com/api/rest/v3 — one fixed
   host, a `Shortcut-Token` header (never Bearer), and a story that belongs to
   a legacy Project, a Team ("group"), or a specific workflow state: any one
   of the three is enough, so all three are optional fields and only their
   total absence is refused locally. */
const shortcut = {
  id: 'shortcut',
  label: 'Shortcut',
  needs: [
    { key: 'token', label: 'API token', secret: true,
      hint: 'Shortcut › your avatar › Settings › API Tokens.' },
    { key: 'project_id', label: 'Project id', hint: 'The number in a legacy Project’s URL. Optional if Team id or Workflow state id is set.' },
    { key: 'group_id', label: 'Team id', hint: 'Settings › Teams › the team, from its URL. Optional if Project id or Workflow state id is set.' },
    { key: 'workflow_state_id', label: 'Workflow state id', hint: 'Optional. Leave empty to file into the team or project’s default state.' },
  ],
  /** Shortcut renders Markdown in a story's description. */
  bodyFormat: 'markdown',

  /* The seven kinds onto Shortcut's three story types
     (developer.shortcut.com/api/rest/v3#Create-Story, story_type is one of
     "feature", "bug" or "chore"). Nothing here maps to "feature" but a story
     or an epic: Shortcut has no epic-shaped story, so an epic files as a
     feature and stays findable by its title. */
  types: {
    defect: 'bug', testcase: 'chore', task: 'chore', subtask: 'chore',
    story: 'feature', epic: 'feature', plain: 'chore',
  },

  head(cfg) { return { 'Shortcut-Token': cfg.token, 'content-type': 'application/json' }; },

  async whoAmI(cfg) {
    // developer.shortcut.com/api/rest/v3#Get-Current-Member-Info
    const { data } = await request('https://api.app.shortcut.com/api/v3/member', {
      headers: this.head(cfg), label: 'Shortcut',
    });
    return { name: data.profile?.name || data.name || data.mention_name, id: data.id };
  },

  async targets(cfg) {
    // developer.shortcut.com/api/rest/v3#List-Groups and #List-Projects. Both
    // are fetched because either can be what `create` files into.
    const [groups, projects] = await Promise.all([
      request('https://api.app.shortcut.com/api/v3/groups', { headers: this.head(cfg), label: 'Shortcut' })
        .then((r) => r.data).catch(() => []),
      request('https://api.app.shortcut.com/api/v3/projects', { headers: this.head(cfg), label: 'Shortcut' })
        .then((r) => r.data).catch(() => []),
    ]);
    return [
      ...(groups || []).map((g) => ({ id: g.id, label: `Team: ${g.name}`, note: 'group_id' })),
      ...(projects || []).map((p) => ({ id: p.id, label: `Project: ${p.name}`, note: 'project_id' })),
    ];
  },

  async create(cfg, { title, body, labels, kind }) {
    if (!cfg.project_id && !cfg.group_id && !cfg.workflow_state_id) {
      throw new Error('No Shortcut project, team or workflow state chosen.');
    }
    const { data } = await request('https://api.app.shortcut.com/api/v3/stories', {
      method: 'POST',
      headers: this.head(cfg),
      body: {
        name: title,
        description: body,
        story_type: this.types[kind] || 'feature',
        ...(cfg.project_id ? { project_id: Number(cfg.project_id) } : {}),
        ...(cfg.group_id ? { group_id: cfg.group_id } : {}),
        ...(cfg.workflow_state_id ? { workflow_state_id: Number(cfg.workflow_state_id) } : {}),
        // Shortcut labels are objects, not bare strings.
        labels: (labels || []).map((name) => ({ name })),
      },
      label: 'Shortcut',
    });
    return { key: `sc-${data.id}`, url: data.app_url, id: data.id };
  },

  /**
   * developer.shortcut.com/api/rest/v3#Upload-Files, then
   * developer.shortcut.com/api/rest/v3#Update-Story to link them: Shortcut
   * uploads a file on its own, unattached, and a second call is what puts it
   * on the story. One request per file, like Jira, so one bad attachment
   * cannot be read as the filing itself having failed.
   */
  async attach(cfg, storyId, files) {
    const out = [];
    const ids = [];
    for (const f of files) {
      try {
        const form = new FormData();
        form.append('file0', f.blob, f.filename);
        const res = await fetchT('https://api.app.shortcut.com/api/v3/files', {
          method: 'POST',
          // No content-type: the browser sets the multipart boundary itself.
          headers: { 'Shortcut-Token': cfg.token },
          body: form,
        }, { timeoutMs: 60000 });
        const text = await res.text();
        const parsed = tryParse(text);
        if (!res.ok) throw new Error(vendorMessage(parsed, text));
        const uploaded = Array.isArray(parsed) ? parsed[0] : parsed;
        ids.push(uploaded.id);
        out.push({ name: f.filename, ok: true });
      } catch (err) {
        out.push({ name: f.filename, ok: false, error: err.message });
      }
    }
    if (ids.length) {
      await request(`https://api.app.shortcut.com/api/v3/stories/${storyId}`, {
        method: 'PUT',
        headers: this.head(cfg),
        body: { file_ids: ids },
        label: 'Shortcut',
      }).catch((err) => out.push({ name: '(linking files to the story)', ok: false, error: err.message }));
    }
    return out;
  },
};

/* ── YouTrack ─────────────────────────────────────────────────────────── */

/* jetbrains.com/help/youtrack/devportal — cloud (*.youtrack.cloud) and
   self-hosted answer the same `/api/...` shape off whatever host the tester
   configures, which is also the entire egress rule: every request in this
   adapter is built from `this.base(cfg)` and nothing here ever falls back to
   a JetBrains-owned default the way GitLab's `host` deliberately does not
   default to gitlab.com either. */
const youtrack = {
  id: 'youtrack',
  label: 'YouTrack',
  needs: [
    { key: 'host', label: 'YouTrack host', hint: 'https://yourname.youtrack.cloud, or your self-hosted server.' },
    { key: 'token', label: 'Permanent token', secret: true,
      hint: 'Profile › Account Security › New token. Needs read and write access to the project.' },
    { key: 'shortName', label: 'Project short name', hint: 'The prefix on your issue ids, e.g. DEMO.' },
  ],
  bodyFormat: 'markdown',

  /* The seven kinds onto the Type values YouTrack ships by default
     (jetbrains.com/help/youtrack/cloud/default-custom-fields.html: Bug,
     Cosmetics, Exception, Feature, Task, Epic, Story, Usability Problem).
     A project that renamed or removed its Type field just has this skipped —
     see the retry in create(), which is the point of asking best-effort. */
  types: {
    defect: 'Bug', testcase: 'Task', task: 'Task', subtask: 'Task',
    story: 'Story', epic: 'Epic', plain: 'Task',
  },

  base(cfg) { return String(cfg.host || '').replace(/\/+$/, ''); },
  head(cfg) { return { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' }; },

  /** jetbrains.com/help/youtrack/devportal/resource-api-admin-projects.html
   *  The tester gives the short name (the id everyone actually recognises);
   *  every other call needs the database id, so this is one round trip every
   *  operation below starts with. */
  async projectId(cfg) {
    if (!String(cfg.shortName || '').trim()) throw new Error('No YouTrack project short name given.');
    const { data } = await request(`${this.base(cfg)}/api/admin/projects?fields=id,shortName`, {
      headers: this.head(cfg), label: 'YouTrack',
    });
    const project = (data || []).find((p) => p.shortName === cfg.shortName);
    if (!project) throw new Error(`No project "${cfg.shortName}" on ${this.base(cfg)}.`);
    return project.id;
  },

  async whoAmI(cfg) {
    // Proves the project in the same call as the token: a token that reaches
    // the server but not this project is exactly the Azure DevOps case above.
    await this.projectId(cfg);
    // jetbrains.com/help/youtrack/devportal/operations-api-users-me.html
    const { data } = await request(`${this.base(cfg)}/api/users/me?fields=login,name`, {
      headers: this.head(cfg), label: 'YouTrack',
    });
    return { name: data.name || data.login, id: data.login };
  },

  async targets(cfg) {
    return [{ id: await this.projectId(cfg), label: cfg.shortName }];
  },

  /**
   * jetbrains.com/help/youtrack/devportal/api-howto-create-issue-with-fields.html
   *
   * Filed with the Type custom field first; if the project has no such field,
   * or not this value, YouTrack refuses the whole request — and losing the
   * report the tester just wrote over one optional field would be worse than
   * filing without it, so this retries once, plainly, and says which happened.
   */
  async create(cfg, { title, body, kind }) {
    const projectId = await this.projectId(cfg);
    const type = this.types[kind] || 'Task';

    const attempt = (withType) => request(`${this.base(cfg)}/api/issues?fields=id,idReadable`, {
      method: 'POST',
      headers: this.head(cfg),
      body: {
        project: { id: projectId },
        summary: title,
        description: body,
        ...(withType ? { customFields: [{ name: 'Type', $type: 'SingleEnumIssueCustomField', value: { name: type } }] } : {}),
      },
      label: 'YouTrack',
    });

    let data;
    let typeApplied = true;
    try {
      ({ data } = await attempt(true));
    } catch (err) {
      // Only a refusal of the Type field is retried. A timeout, a dropped connection or a 429 may
      // have created the issue already: re-sending would file it twice.
      if (err.network || !err.status || err.status === 429 || err.status >= 500) throw err;
      typeApplied = false;
      ({ data } = await attempt(false));
    }
    const key = data.idReadable || `#${data.id}`;
    return { key, url: `${this.base(cfg)}/issue/${key}`, id: data.id, typeApplied };
  },

  /**
   * jetbrains.com/help/youtrack/devportal/api-usecase-attach-files.html
   * "You cannot simultaneously create a new issue and add attachments to it" —
   * so this is always the second call, by the numeric id `create` returned,
   * one request per file so a rejected attachment cannot read as a failed
   * filing.
   */
  async attach(cfg, issueId, files) {
    const out = [];
    for (const f of files) {
      try {
        const form = new FormData();
        form.append(f.filename, f.blob, f.filename);
        const res = await fetchT(`${this.base(cfg)}/api/issues/${encodeURIComponent(issueId)}/attachments?fields=id,name`, {
          method: 'POST',
          // No content-type here either — same reason as Shortcut and Jira.
          headers: { authorization: this.head(cfg).authorization },
          body: form,
        }, { timeoutMs: 60000 });
        const text = await res.text();
        if (!res.ok) throw new Error(vendorMessage(tryParse(text), text));
        out.push({ name: f.filename, ok: true });
      } catch (err) {
        out.push({ name: f.filename, ok: false, error: err.message });
      }
    }
    return out;
  },
};

/* ── the body, in the format the tracker takes ───────────────────────────── */

/*
 * The worker always sends the defect as Markdown (docshell's mdEsc/mdCell escape page text with backslashes). A tracker
 * that renders Markdown gets it unchanged; Asana ('text') and Azure DevOps ('html') get it rendered here, once, with the
 * escapes undone. Structure is read while the escapes are still in place, so an escaped `\*` is never taken for bold.
 */
const UNESC = /\\([\\`*_[\]()!<>|~@/.])/g;
function inlineText(line) {
  const spans = [];
  const kept = line.replace(/(`+)(.+?)\1/g, (_m, _f, code) => `\u0000${spans.push(code) - 1}\u0000`)
    .replace(/(?<!\\)\*\*(.+?)(?<!\\)\*\*/g, '$1');
  return kept.replace(UNESC, '$1').replace(/\u0000(\d+)\u0000/g, (_m, i) => spans[+i]);
}
const cellsOf = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => inlineText(c.trim()));
export function render(markdown, bodyFormat = 'markdown') {
  if (bodyFormat !== 'text' && bodyFormat !== 'html') return String(markdown ?? '');
  const html = bodyFormat === 'html';
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocks = [];
  let para = null;
  const flush = () => { if (para) blocks.push(para); para = null; };
  const lines = String(markdown ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      flush();
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) code.push(lines[i]);
      blocks.push({ t: 'code', code });
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      if (!para || para.t !== 'table') { flush(); para = { t: 'table', rows: [] }; }
      if (!/^[\s|:-]+$/.test(line)) para.rows.push(cellsOf(line));
    } else if (!line.trim()) {
      flush();
    } else {
      if (!para || para.t !== 'p') { flush(); para = { t: 'p', lines: [] }; }
      para.lines.push(inlineText(line.replace(/^\s{0,3}#{1,6}\s*/, '')));
    }
  }
  flush();
  if (!html) {
    return blocks.map((b) => b.t === 'code' ? b.code.join('\n') : b.t === 'table' ? b.rows.map((r) => r.join('  ')).join('\n') : b.lines.join('\n'))
      .join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return blocks.map((b) => b.t === 'code' ? `<pre>${esc(b.code.join('\n'))}</pre>`
    : b.t === 'table' ? `<table>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`
      : `<p>${b.lines.map(esc).join('<br>')}</p>`).join('');
}

/* ── the registry ──────────────────────────────────────────────────────── */

export const TRACKERS = [github, gitlab, azure, linear, trello, clickup, asana, shortcut, youtrack];

export const trackerById = (id) => TRACKERS.find((t) => t.id === id) || null;

/** What the settings page needs to draw a form, without knowing any of this. */
export function trackerCatalogue() {
  return TRACKERS.map((t) => ({
    id: t.id,
    label: t.label,
    bodyFormat: t.bodyFormat,
    ...(t.maxBody ? { maxBody: t.maxBody } : {}),
    // Can this tracker take the screenshots? The dialog says so before Create when it cannot.
    attach: typeof t.attach === 'function',
    needs: t.needs,
    // The seven kinds this tracker files them as, or null where it has no
    // types at all and a label is the only handle it offers.
    types: t.types || null,
  }));
}

/** Chosen at filing time, or defaulted by the vendor, rather than gating the
 *  "test connection" button. Shortcut's three are its `create()` in three
 *  different clothes — one of them is enough, so none of them is required. */
const OPTIONAL_AT_FILING_TIME = new Set([
  'list', 'project', 'team', 'project_id', 'group_id', 'workflow_state_id',
]);

/** Is this one configured enough to try? Asked before a button is offered. */
export function isConfigured(id, cfg = {}) {
  const tracker = trackerById(id);
  if (!tracker) return false;
  return tracker.needs.filter((n) => !OPTIONAL_AT_FILING_TIME.has(n.key))
    .every((n) => String(cfg[n.key] || '').trim());
}

/**
 * Prove the credential works before anything real is sent.
 *
 * Every adapter can answer "who am I", and finding out a token is wrong while
 * filing a defect you have just spent ten minutes writing is the worst possible
 * moment for it.
 */
export async function testConnection(id, cfg) {
  const tracker = trackerById(id);
  if (!tracker) throw new Error(`Unknown tracker: ${id}`);

  const missing = tracker.needs.filter((n) => n.secret !== undefined || n.key === 'token' || n.key === 'key')
    .filter((n) => !String(cfg[n.key] || '').trim());
  if (missing.length) {
    throw new Error(`${tracker.label} needs ${missing.map((n) => n.label).join(' and ')}.`);
  }

  const account = await tracker.whoAmI(cfg).catch((err) => { throw plain(tracker, err); });
  return { tracker: tracker.id, label: tracker.label, account, bodyFormat: tracker.bodyFormat };
}

export async function listTargets(id, cfg) {
  const tracker = trackerById(id);
  if (!tracker) throw new Error(`Unknown tracker: ${id}`);
  return tracker.targets(cfg).catch((err) => { throw plain(tracker, err); });
}

/**
 * The secret gate for every tracker, in the one place all nine route through.
 * Title, body and text attachments are scanned and findings replaced by
 * [REDACTED]: these dialogs have no "send anyway" control, so the safe default
 * is to file without the secret and say how many were removed. The tracker's
 * own credential and any `known` vault tokens are matched exactly. Media
 * cannot be read and is named as unscanned.
 */
async function guard(tracker, cfg, { title, body, attachments, known = [] }) {
  const all = [...known, ...tracker.needs.filter((n) => n.secret).map((n) => cfg[n.key]).filter(Boolean)];
  const { findings, redacted } = scanFields({ title, body }, all);
  const files = attachments ? await Promise.all(attachments.map((f) => redactFile(f, all))) : attachments;
  const inFiles = (files || []).reduce((n, f) => n + (f.redacted || 0), 0);
  return { title: redacted.title, body: redacted.body, files, redacted: findings.length + inFiles, unscanned: await unscannedNames(files) };
}

/** D-1010-150: the bytes of the files that really went up (ok rows only, matched to the file by name), so the worker's egress row can count them. */
function attachedBytesOf(attachments, rows) {
  const pool = [...(attachments || [])];
  let n = 0;
  for (const row of rows || []) {
    if (!row?.ok) continue;
    const i = pool.findIndex((f) => f.filename === row.name);
    if (i >= 0) n += Number(pool.splice(i, 1)[0].blob?.size) || 0;
  }
  return n;
}

/** D-1010-189: the body in the tracker's format, within its cap (default 32767): over it, the first and last 40 repro steps, and as a last resort a plain cut. */
export function fitBody(md, tracker) {
  const max = tracker.maxBody || 32767;
  let out = render(md, tracker.bodyFormat);
  if (out.length > max) out = render(capSteps(md), tracker.bodyFormat);
  return out.length > max ? cutToFit(md, tracker, max) : out;
}

/** D-1010-205: a title cut to `n` UTF-16 units never ends on a lone high surrogate (JSON.stringify would emit it and some servers answer 400). */
export const clipTitle = (s, n) => String(s ?? '').slice(0, n).replace(/[\ud800-\udbff]$/, ''); // glyph-ok

/** The fence still open after these lines (its opening marker), or ''. */
function openFence(lines) {
  let open = '';
  for (const l of lines) {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(l);
    if (!m) continue;
    if (!open) open = m[1];
    else if (m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim()) open = '';
  }
  return open;
}

/** D-1010-205: the last resort. Keep as many whole lines as fit, close a fence left open, and say that the rest was cut. */
function cutToFit(md, tracker, max) {
  const first = String(md).split('\n').find((l) => /^#{1,6}\s/.test(l)) || '';
  const note = docLabels(/[\u0600-\u06ff]/.test(first) ? 'ar' : 'en').cutNote;
  const build = (lines) => {
    const fence = openFence(lines);
    return render([...lines, ...(fence ? [fence] : []), '', `_${note}_`].join('\n'), tracker.bodyFormat);
  };
  const fit = (L) => {
    let lo = 0, hi = L.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (build(L.slice(0, mid)).length <= max) lo = mid; else hi = mid - 1; }
    return lo ? build(L.slice(0, lo)) : '';
  };
  const lines = String(md).split(/\r?\n/);
  // One enormous line (nothing to cut at): fall back to cutting inside it.
  const out = fit(lines) || fit([clipTitle(lines[0], Math.max(0, max - 300))]);
  return out.length <= max ? out : clipTitle(out, max);
}

export async function fileIssue(id, cfg, { title, body, target, labels, kind = 'defect', attachments, known, url, dedupe = true }) {
  const tracker = trackerById(id);
  if (!tracker) throw new Error(`Unknown tracker: ${id}`);
  if (!String(title || '').trim()) throw new Error('An issue needs a title.');

  const safe = await guard(tracker, cfg, { title: String(title), body: String(body || ''), attachments, known });
  attachments = safe.files;
  const cleanTitle = clipTitle(safe.title.replace(/\s+/g, ' ').trim(), 240);
  const canAttach = typeof tracker.attach === 'function';
  const unscanned = canAttach ? safe.unscanned : [];

  // Duplicate check, for the trackers whose API can search by label or tag. A failed search
  // never blocks filing (it only means no check); a hit is returned instead of creating.
  // Jira, Trello, ClickUp, Asana, Shortcut and YouTrack are not searched: see r2-I1-detail.md.
  const fp = dedupe && typeof tracker.findExisting === 'function' ? fingerprint({ url, summary: cleanTitle }).label : null;
  if (fp) {
    const hit = await tracker.findExisting(cfg, { label: fp, target }).catch(() => null);
    if (hit) return { ...hit, tracker: tracker.id, label: tracker.label, duplicate: true, attachSupported: canAttach, attachedBytes: 0, redacted: safe.redacted, unscanned: [] };
  }

  const created = await tracker.create(cfg, {
    // Every one of these truncates a long title server-side, some silently.
    title: cleanTitle,
    body: fitBody(safe.body, tracker),
    target,
    labels: fp ? [...(labels || []), fp] : labels,
    // The document kind, so an adapter with real work item types can pick
    // one. Adapters without types ignore it; none of them may invent one.
    kind,
  }).catch((err) => { throw plain(tracker, err, true); });

  // GitHub alone has no public call that puts a file on an issue: the files are not sent, and the
  // result says so (`attachSupported: false`) instead of implying they were.
  const attached = attachments?.length && canAttach
    ? await tracker.attach(cfg, created.id, attachments, { created, body: safe.body }).catch((err) => attachments.map((f) => ({ name: f.filename, ok: false, error: err.message })))
    : undefined;

  return {
    ...created, tracker: tracker.id, label: tracker.label,
    ...(attached ? { attached } : {}),
    attachSupported: canAttach,
    attachedBytes: attachedBytesOf(attachments, attached), // D-1010-150: 0 when nothing was uploaded
    redacted: safe.redacted,
    unscanned,
  };
}
