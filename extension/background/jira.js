/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Jira, discovered rather than assumed.
 *
 * Almost every Jira integration that breaks does so because it hardcoded
 * something that is per-site: the epic-link custom field id, the name of the
 * "Test" issue type, which link types exist, whether the project is
 * team-managed or company-managed. None of that is knowable in advance, and all
 * of it is readable from the API. So this module asks.
 *
 * The two that matter most:
 *
 * **Epic linking is not one thing.** In a *team-managed* project an epic is the
 * parent, set through the ordinary `parent` field. In a *company-managed*
 * project it is a custom field whose id differs per site — commonly
 * `customfield_10014`, but only commonly. `epicLinkField()` finds the real one
 * by asking `/field` for the one named `Epic Link`, and `linkToEpic()` picks the
 * right mechanism from the project's style.
 *
 * **Issue types are per project.** A site can have "Test", "Test Case", "Xray
 * Test" or nothing at all. Offering a fixed list produces a 400 that reads as
 * "field 'issuetype' is required" and sends people hunting.
 */

/* ── transport ─────────────────────────────────────────────────────────── */

/**
 * Cloud and Data Center sign requests differently, speak different REST
 * versions and disagree about three endpoints. All of that is decided in
 * `core/jira-auth.js`, once, and every path below reads it from there. Nothing
 * in this file builds an Authorization header of its own, and nothing writes
 * `/rest/api/3` into a string: the version comes from the transport, so a site
 * that is not Atlassian's is asked in a dialect it has.
 */
import { jiraTransport, refusedCredentialsMessage } from '../core/jira-auth.js';

/**
 * One place that talks to Jira, so one place turns its refusals into sentences.
 *
 * Jira's errors are genuinely useful — it names the field and what is wrong with
 * it — but they arrive nested in two different shapes depending on the endpoint,
 * and a bare status code sends the reader to the wrong problem entirely.
 *
 * `path` is written relative to the REST root: `/myself`, never the version in
 * front of it, because which version it is is the transport's answer.
 */
/** @param {{ method?: string, body?: any }} [opts] */
async function call(cfg, path, opts = {}) {
  const { method = 'GET', body } = opts;
  const { base, api, headers } = jiraTransport(cfg);
  let res;
  try {
    res = await fetchT(`${base}${api}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    // A create that timed out may still have landed: never re-sent here, and the tester is told to look first.
    const maybe = err.timeout && method !== 'GET' ? ' It may have gone through: check Jira before filing again.' : '';
    const why = err.timeout ? `${err.message}, so check` : 'check';
    throw new Error(`Could not reach ${base}: ${why} the site URL and your network.${maybe}`);
  }

  const raw = await res.text();
  // A proxy or single sign-on page answers in HTML, often with a 200: never parse it, never quote it.
  const html = /^\s*</.test(raw);
  if (!res.ok) {
    let detail = html ? 'an HTML page instead of an answer' : raw.slice(0, 400);
    try {
      const parsed = JSON.parse(raw);
      const parts = [...(parsed.errorMessages || []), ...Object.entries(parsed.errors || {}).map(([k, v]) => `${k}: ${v}`)];
      if (parts.length) detail = parts.join('; ');
    } catch {
      /* not JSON — the raw body is the best we have */
    }
    // A 401 is the one refusal Jira gives no reason for, and the reason is
    // usually the sign-in mode rather than the token. See `refusedCredentialsMessage()`.
    const fail = (m) => Object.assign(new Error(m), { status: res.status });
    // Data Center locks Basic sign-in behind a CAPTCHA after a few wrong passwords, and says so only in a header.
    if (/captcha/i.test(res.headers?.get?.('x-authentication-denied-reason') || '')) {
      throw fail('Jira wants a CAPTCHA after failed sign-ins: sign in once in the browser, then try again.');
    }
    if (res.status === 401) throw fail(refusedCredentialsMessage(cfg));
    if (res.status === 403) throw fail(`Jira refused the request (403): ${detail}. The account may lack permission on this project.`);
    if (res.status === 429) throw fail(`Jira is rate-limiting this account (429)${res.headers?.get?.('retry-after') ? `; try again in ${res.headers.get('retry-after')} s` : ''}. Nothing was created twice.`);
    if (res.status === 404) throw fail(`Jira has no such resource (404) at ${path}: check the site URL and the sign-in type.`);
    throw fail(`Jira refused the request (${res.status}): ${detail}`);
  }
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Not JSON from a JSON API: in practice a proxy or single sign-on login page.
    throw new Error('Jira returned a login page: check the address and the sign-in type.');
  }
}

/* ── discovery ─────────────────────────────────────────────────────────── */

/** Who the token belongs to — the first thing worth confirming. */
export async function whoAmI(cfg) {
  const me = await call(cfg, '/myself');
  return { accountId: me.accountId, name: me.displayName, email: me.emailAddress || null };
}

/**
 * Projects this account can actually create issues in.
 *
 * `/project/search` lists what it can *see*, which is a longer list. Offering a
 * project the token cannot write to produces a 403 at the last step, after the
 * tester has filled in a whole form.
 *
 * Two shapes come back. Cloud paginates and wraps the page in `values`; Data
 * Center returns the array itself from `/project`. `res.values || res` is the
 * whole difference, and the mapping below is the same for both.
 */
export async function projects(cfg) {
  const res = await call(cfg, jiraTransport(cfg).projectsPath);
  const list = Array.isArray(res) ? res : res?.values || [];
  return list.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    // team-managed ("next-gen") vs company-managed ("classic") decides how an
    // epic is linked, so it has to travel with the project.
    style: p.style || 'classic',
    lastUsed: p.insight?.lastIssueUpdateTime || null,
  }));
}

/** Issue types this project really has, with the likely test/defect ones marked. */
import { controlFor, adfToWiki, coerce, textToAdf } from '../core/adf.js';
import { capAdf } from '../core/doc-labels.js';
import { clipTitle } from './trackers.js';
import { fingerprint, normaliseArabic } from '../core/fingerprint.js';
export { fingerprint, normaliseArabic };
import { scanFields, scanText, adfText, redactAdf, fileTexts, redactFile as redactedFile, unscannedNames } from '../core/secret-scan.js';
import { fetchT } from '../core/http.js';
import { DEFAULT_PRIORITY_MAP } from '../platform/settings.js';

/** The Jira priority name for a defect severity: `jira.priorityMap` (settings) overrides the default key by key. */
export const priorityFor = (cfg, severity) => ({ ...DEFAULT_PRIORITY_MAP, ...(cfg?.priorityMap || {}) })[severity] || null;


/** A count and its noun, agreeing. Local: see `background/service-worker.js`. */
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

/** Fields the create call fills in itself; they are never offered as extra fields. */
const HANDLED_FIELDS = new Set(['project', 'issuetype', 'summary', 'description', 'reporter', 'attachment', 'issuelinks']);

/** One createmeta field, in the shape the report page draws and the worker sends. */
function shapeField(key, f) {
  const field = {
    key,
    name: f.name || key,
    required: !!f.required,
    hasDefault: !!f.hasDefaultValue,
    schema: { type: f.schema?.type || 'string', items: f.schema?.items, custom: f.schema?.custom, system: f.schema?.system },
    allowedValues: (f.allowedValues || []).slice(0, 60).map((v) => ({ id: v.id, name: v.name ?? v.value, value: v.value })),
    autoComplete: !!f.autoCompleteUrl,
  };
  return { ...field, control: controlFor(field) };
}

const byRequired = (a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name);
const enc = encodeURIComponent;

/** Fields of one issue type: the per-type endpoint, or (DC before 8.4) the old expanded one. */
async function typeFields(cfg, projectKey, typeId) {
  const res = await call(cfg, `/issue/createmeta/${enc(projectKey)}/issuetypes/${enc(typeId)}?maxResults=200`);
  // Cloud answers `fields: [...]`, Data Center `values: [...]`; each entry names itself `fieldId`.
  return (res.fields || res.values || [])
    .map((f) => [f.fieldId || f.key, f])
    .filter(([key]) => key && !HANDLED_FIELDS.has(key))
    .map(([key, f]) => shapeField(key, f))
    .sort(byRequired);
}

/**
 * Issue types this project really has, with the likely test/defect ones marked.
 *
 * Uses `/issue/createmeta/{project}/issuetypes[/{id}]` (removed-old-endpoint safe:
 * DC 9+ dropped the expanded call, Cloud deprecated it). `fieldsFor` picks whose
 * fields are fetched: omitted = every type, a type name or id = that one, false =
 * none. Filing asks for its own type only; the picker asks for all.
 */
/** @param {{ fieldsFor?: string | number | false }} [opts] */
export async function issueTypes(cfg, projectKey, opts = {}) {
  const { fieldsFor } = opts;
  let list;
  try {
    const res = await call(cfg, `/issue/createmeta/${enc(projectKey)}/issuetypes?maxResults=200`);
    list = (res.issueTypes || res.values || []).map((t) => ({ id: t.id, name: t.name, subtask: !!t.subtask, fields: null }));
  } catch (err) {
    if (err.status !== 404 && err.status !== 405) throw err;
    return legacyIssueTypes(cfg, projectKey);
  }
  if (!list.length) throw new Error(`No project "${projectKey}", or this account cannot create issues in it.`);
  const wanted = (t) =>
    fieldsFor === false ? false : fieldsFor == null ? true : String(t.id) === String(fieldsFor) || t.name.toLowerCase() === String(fieldsFor).toLowerCase();
  const withFields = await Promise.all(list.map(async (t) => ({ ...t, fields: wanted(t) ? await typeFields(cfg, projectKey, t.id) : [] })));
  return withFields.map(finishType);
}

const finishType = (t) => ({
  id: t.id,
  name: t.name,
  subtask: !!t.subtask,
  required: t.fields.filter((f) => f.required),
  fields: t.fields,
  looksLikeTest: /test|scenario/i.test(t.name),
  looksLikeDefect: /bug|defect|incident|fault/i.test(t.name),
  looksLikeStory: /story|task|requirement/i.test(t.name),
  looksLikeEpic: /epic/i.test(t.name),
});

/** Jira before Data Center 8.4 has only the expanded call. */
async function legacyIssueTypes(cfg, projectKey) {
  const meta = await call(cfg, `/issue/createmeta?projectKeys=${enc(projectKey)}&expand=projects.issuetypes.fields`);
  const project = (meta.projects || [])[0];
  if (!project) throw new Error(`No project "${projectKey}", or this account cannot create issues in it.`);
  return (project.issuetypes || []).map((t) =>
    finishType({
      ...t,
      fields: Object.entries(t.fields || {}).filter(([k]) => !HANDLED_FIELDS.has(k)).map(([k, f]) => shapeField(k, f)).sort(byRequired),
    })
  );
}

/** The real id of the Epic Link field on this site, or null on a modern one. */
export async function epicLinkField(cfg) {
  const fields = await call(cfg, '/field');
  const epic = fields.find((f) => f.custom && /^epic link$/i.test(f.name));
  return epic?.id || null;
}

export async function linkTypes(cfg) {
  const res = await call(cfg, '/issueLinkType');
  return (res.issueLinkTypes || []).map((t) => ({ id: t.id, name: t.name, inward: t.inward, outward: t.outward }));
}

/**
 * Epics and stories worth linking to, newest activity first.
 *
 * Scoped to the project and to open work: a picker listing three years of closed
 * epics is a picker nobody uses.
 */
export async function linkTargets(cfg, projectKey, { query = '', max = 25 } = {}) {
  const escaped = String(query).replace(/["\\]/g, '\\$&');
  const textClause = escaped ? ` AND (summary ~ "${escaped}*" OR key = "${escaped.toUpperCase()}")` : '';

  const search = async (jql) => {
    const res = await call(cfg, jiraTransport(cfg).searchPath, {
      method: 'POST',
      body: { jql, maxResults: max, fields: ['summary', 'issuetype', 'status', 'parent'] },
    });
    return (res.issues || []).map((i) => ({
      key: i.key,
      summary: i.fields.summary,
      type: i.fields.issuetype?.name,
      status: i.fields.status?.name,
      parent: i.fields.parent?.key || null,
    }));
  };

  const project = `project = "${projectKey}"`;
  const open = 'statusCategory != Done';

  const [epics, stories] = await Promise.all([
    search(`${project} AND issuetype = Epic AND ${open}${textClause} ORDER BY updated DESC`).catch(() => []),
    search(`${project} AND issuetype in (Story, Task) AND ${open}${textClause} ORDER BY updated DESC`).catch(() => []),
  ]);

  return { epics, stories };
}

/* ── provenance on the ticket itself ───────────────────────────────────── */

/**
 * Attach the origin to an issue as an **issue property**.
 *
 * Issue properties are JSON stored against an issue, invisible in the UI and returned by the REST API: nothing is
 * added to the description, and a bot or audit reading the issue finds where the ticket came from.
 * Best-effort on purpose: a project can restrict who sets properties, and a report that failed to file because a
 * watermark failed would be absurd. The visible footer in the description is the fallback.
 */
export async function attachProvenance(cfg, issueKey, record) {
  try {
    await call(cfg, `/issue/${encodeURIComponent(issueKey)}/properties/qaw-provenance`, {
      method: 'PUT',
      body: record,
    });
    return { attached: true };
  } catch (err) {
    return { attached: false, error: err.message };
  }
}

/** Read it back, so the claim is checkable rather than asserted. */
export async function readProvenance(cfg, issueKey) {
  const res = await call(cfg, `/issue/${encodeURIComponent(issueKey)}/properties/qaw-provenance`);
  return res?.value ?? null;
}

/* ── status, coming back the other way ─────────────────────────────────── */

/**
 * What has happened to the issues this session filed.
 *
 * The one direction integrations usually miss. Filing is easy and every tool
 * does it; the useful half is the answer coming back, because a week later the
 * question is not "did I file it" but "was it fixed" — and a report that cannot
 * answer that is a snapshot of a day nobody remembers.
 *
 * One request for every key rather than one per issue. A session that filed a
 * suite has a dozen keys, and twelve round trips to a Jira Cloud instance is
 * several seconds of somebody's afternoon.
 */
export async function issueStatus(cfg, keys) {
  const wanted = [...new Set((keys || []).filter(Boolean))];
  if (!wanted.length) return [];

  // Jira's `key in (...)` takes an unquoted, comma-separated list. Keys are
  // [A-Z0-9_]+-[0-9]+ by construction, but they arrive from storage, so they
  // are filtered rather than trusted — a stored value is still input.
  const safe = wanted.filter((k) => /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(k));
  if (!safe.length) return [];

  const res = await call(cfg, jiraTransport(cfg).searchPath, {
    method: 'POST',
    body: {
      jql: `key in (${safe.join(',')})`,
      maxResults: Math.min(100, safe.length),
      fields: ['summary', 'status', 'resolution', 'assignee', 'updated', 'issuetype', 'priority'],
    },
  });

  const found = new Map(
    (res.issues || []).map((i) => [
      i.key,
      {
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status?.name || null,
        // The *category* is what to branch on. Every Jira site renames its
        // statuses — "Done", "Closed", "Shipped", "منجز" — and only the
        // category is stable across all of them.
        category: i.fields.status?.statusCategory?.key || null,
        categoryName: i.fields.status?.statusCategory?.name || null,
        resolution: i.fields.resolution?.name || null,
        assignee: i.fields.assignee?.displayName || null,
        priority: i.fields.priority?.name || null,
        type: i.fields.issuetype?.name || null,
        updatedAt: i.fields.updated ? Date.parse(i.fields.updated) : null,
        gone: false,
      },
    ])
  );

  // A key that comes back from nowhere was deleted or moved, and saying so is
  // more useful than dropping it — a defect that vanished from the tracker is
  // itself worth knowing about.
  return wanted.map(
    (key) => found.get(key) || { key, status: null, category: null, gone: true }
  );
}

/**
 * Roll a set of statuses up into the one sentence somebody wants.
 *
 * Pure, so it is unit-testable without a Jira site, and shared by the report
 * and the popup so the two cannot disagree about what "done" means.
 */
export function summariseStatuses(statuses) {
  const live = statuses.filter((s) => !s.gone);
  const done = live.filter((s) => s.category === 'done');
  const inProgress = live.filter((s) => s.category === 'indeterminate');
  const todo = live.filter((s) => s.category === 'new');
  const gone = statuses.filter((s) => s.gone);

  return {
    total: statuses.length,
    done: done.length,
    inProgress: inProgress.length,
    todo: todo.length,
    gone: gone.length,
    allDone: live.length > 0 && done.length === live.length,
    /* The sentence, written once. */
    line: !statuses.length
      ? 'Nothing was filed from this session.'
      : live.length && done.length === live.length
      ? `All ${plural(live.length, 'issue')} filed from this session are done.`
      : `${done.length} done · ${inProgress.length} in progress · ${todo.length} to do` +
        (gone.length ? ` · ${gone.length} no longer in Jira` : ''),
  };
}

/* ── creating ──────────────────────────────────────────────────────────── */

/**
 * Create an issue, then wire up its relationships.
 *
 * Links are made **after** creation and each is reported separately, because a
 * link that fails must not lose the issue. A tester who filled in a defect
 * report and got "could not link to the epic" still has their defect report;
 * one whose create call was rolled back has nothing.
 */
export async function createIssue(cfg, { projectKey, issueTypeName, summary, description, labels = [], fields = {} }) {
  // Every document in this product is built as ADF, which is Cloud's format.
  // A Data Center site wants wiki markup in a plain string and refuses the
  // object without naming the field, so the flattening happens here, once, at
  // the only point that knows which Jira is on the other end.
  const { adf } = jiraTransport(cfg);
  const body = {
    fields: {
      project: { key: projectKey },
      issuetype: { name: issueTypeName },
      summary: clipTitle(String(summary).replace(/\s+/g, ' ').trim(), 250),
      description: adf ? description : adfToWiki(description),
      ...(labels.length ? { labels: labels.map((l) => String(l).replace(/\s+/g, '-').slice(0, 60)) } : {}),
      ...fields,
    },
  };
  const created = await call(cfg, '/issue', { method: 'POST', body });
  return { key: created.key, id: created.id, url: `${cfg.baseUrl.replace(/\/+$/, '')}/browse/${created.key}` };
}

/**
 * Put an issue under an epic, whichever way this project does it.
 *
 * Team-managed projects use `parent`. Company-managed ones use the Epic Link
 * custom field. Choosing wrongly gives "Field 'parent' cannot be set" or
 * "Field 'customfield_10014' cannot be set" — both of which read as a bug in the
 * tool rather than a difference between two project styles.
 */
export async function linkToEpic(cfg, issueKey, epicKey, { style, epicField }) {
  if (!epicKey) return { linked: false };

  const attempts = [];
  if (style === 'next-gen') attempts.push({ parent: { key: epicKey } });
  if (epicField) attempts.push({ [epicField]: epicKey });
  // Try the other one too: a site can be mid-migration, and one extra failed
  // call is cheaper than telling the tester their epic does not exist.
  if (style !== 'next-gen') attempts.push({ parent: { key: epicKey } });

  let lastError = null;
  for (const fields of attempts) {
    try {
      await call(cfg, `/issue/${encodeURIComponent(issueKey)}`, { method: 'PUT', body: { fields } });
      return { linked: true, via: Object.keys(fields)[0] };
    } catch (err) {
      lastError = err;
    }
  }
  return { linked: false, error: lastError?.message || 'no epic-link mechanism worked on this project' };
}

/** A plain issue link — "relates to", "blocks", "is tested by". */
export async function linkIssues(cfg, { inward, outward, type }) {
  await call(cfg, '/issueLink', {
    method: 'POST',
    body: { type: { name: type }, inwardIssue: { key: inward }, outwardIssue: { key: outward } },
  });
  return { linked: true, type };
}

/**
 * The link type to use between a test and the thing it tests.
 *
 * Xray and Zephyr each install their own, and a plain Jira has neither. Pick
 * whatever this site actually has, in order of how well it says what is meant,
 * and fall back to "Relates" — which every Jira has.
 */
export function preferredLinkType(available, kind) {
  const names = available.map((t) => t.name);
  const wanted =
    kind === 'test'
      ? ['Test', 'Tests', 'Test Case Linking', 'Defect', 'Verifies', 'Relates']
      : ['Defect', 'Blocks', 'Causes', 'Relates'];
  return wanted.find((w) => names.includes(w)) || names[0] || 'Relates';
}

/** The site's attachment settings, or null when Jira will not say (then the upload itself is the check). */
export async function attachmentLimit(cfg) {
  try {
    const m = await call(cfg, '/attachment/meta');
    return m && typeof m === 'object' ? { enabled: m.enabled !== false, bytes: Number(m.uploadLimit) || null } : null;
  } catch { return null; }
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

export async function attachFile(cfg, issueKey, { filename, blob }, { limit = null } = {}) {
  // The one request that cannot go through `call()`, because multipart is not
  // JSON. It still takes its header from the same builder: this is the path
  // that would otherwise grow a second copy of the auth logic.
  if (limit && limit.enabled === false) throw new Error('Attachments are switched off on this Jira site.');
  if (limit?.bytes && blob.size > limit.bytes) throw new Error(`${filename} is ${mb(blob.size)}, over this site's ${mb(limit.bytes)} attachment limit. Not uploaded.`);
  const { base, api, headers } = jiraTransport(cfg);
  const send = () => {
    const form = new FormData();
    form.append('file', blob, filename);
    return fetchT(`${base}${api}/issue/${encodeURIComponent(issueKey)}/attachments`, {
      method: 'POST',
      headers: {
        authorization: headers.authorization,
        // Required by Jira, and the browser must set the multipart boundary
        // itself — so content-type is deliberately absent here.
        'X-Atlassian-Token': 'no-check',
      },
      body: form,
    }, { timeoutMs: 60000 });
  };
  let res;
  try { res = await send(); } catch (err) {
    // One retry, and only when the connection failed before any answer came back.
    try { res = await send(); } catch (err2) { throw new Error(`Could not upload ${filename}: ${err2.message}.`); }
  }
  if (!res.ok) throw new Error(`Jira refused the attachment (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return { attached: filename };
}

/**
 * Several files, each reported on its own.
 *
 * An attachment Jira refuses — too large for the site's limit, a type the
 * admin blocked — must never read as a failed filing: the issue exists, and
 * the tester needs to know which file did not make it, not that "it failed".
 */
export async function attachFiles(cfg, issueKey, files, { redact = false, known = [] } = {}) {
  const out = [];
  const limit = files.length ? await attachmentLimit(cfg) : null;
  for (const f of files) {
    try {
      const file = redact ? await redactedFile(f, known) : f;
      await attachFile(cfg, issueKey, file, { limit });
      out.push({ name: f.filename, ok: true, bytes: file.blob?.size ?? 0, ...(file.redacted ? { redacted: file.redacted } : {}) });
    } catch (err) {
      out.push({ name: f.filename, ok: false, error: err.message });
    }
  }
  return out;
}

/** D-1010-150: the bytes that really went up (ok rows; a `sameAs` row points at an earlier upload and sent nothing). */
const sentBytes = (rows) => (rows || []).reduce((n, a) => n + (a?.ok === true && !a.sameAs ? Number(a.bytes) || 0 : 0), 0);

/* ── secrets, before anything leaves ───────────────────────────────────── */


/**
 * Scan an issue's own text: summary, description (the editor's `body`, else the
 * model's `adf`) and every string field. Findings carry offsets, never values.
 */
export function scanSecrets({ summary, body, adf, fields = {} }, known = []) {
  const strings = Object.fromEntries(Object.entries(fields).filter(([, v]) => typeof v === 'string').map(([k, v]) => [`field:${k}`, v]));
  const { findings, redacted } = scanFields({ summary, description: body || adfText(adf), ...strings }, known);
  const cleanFields = { ...fields };
  for (const k of Object.keys(strings)) cleanFields[k.slice(6)] = redacted[k];
  return {
    findings,
    redacted: {
      summary: redacted.summary,
      body: body ? redacted.description : undefined,
      adf: !body && findings.some((f) => f.field === 'description') ? redactAdf(adf, known) : adf,
      fields: cleanFields,
    },
  };
}

/** Findings inside built attachment files, named `attachment:<filename>`. */
export async function scanFiles(files, known = []) {
  const findings = [];
  for (const f of files) {
    for (const { name, text } of await fileTexts(f)) for (const h of scanText(text, known)) findings.push({ field: `attachment:${name}`, kind: h.kind, start: h.start, end: h.end, length: h.end - h.start });
  }
  return findings;
}

/* ── fields the tester typed: shaped or refused, never dropped ─────────── */

/**
 * Shape the tester's extra fields against the live createmeta for this type.
 *
 * `dropped` lists every typed field that could not be sent (no metadata,
 * not on this type's create screen, or a value that cannot take the field's
 * shape). The caller refuses to file when it is not empty. The mapped
 * `priority` is a default, not typed input: it goes in when the screen has it
 * and the name is allowed, else it lands in `skipped` and the filing goes on.
 */
/** @param {{ priority?: string | null }} [opts] */
export async function resolveFields(cfg, projectKey, typeName, fields = {}, opts = {}) {
  const { priority } = opts;
  const typed = Object.entries(fields || {}).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length));
  const out = { extra: {}, dropped: [], skipped: [] };
  if (!typed.length && !priority) return out;

  let schema = null;
  let why = 'no-metadata';
  try {
    const t = (await issueTypes(cfg, projectKey, { fieldsFor: typeName })).find((x) => x.name.toLowerCase() === String(typeName).toLowerCase());
    if (t) schema = t.fields;
    else why = 'no-such-type';
  } catch (err) {
    why = 'no-metadata';
    out.error = err.message;
  }
  if (!schema) {
    for (const [key] of typed) out.dropped.push({ key, reason: why });
    if (priority) out.skipped.push({ key: 'priority', reason: why });
    return out;
  }
  for (const [key, raw] of typed) {
    const f = schema.find((x) => x.key === key);
    if (!f) { out.dropped.push({ key, reason: 'not-on-screen' }); continue; }
    const v = coerce(f, raw);
    if (v === undefined) out.dropped.push({ key, name: f.name, reason: 'unshapeable' });
    else out.extra[key] = v;
  }
  if (priority && !('priority' in out.extra)) {
    const f = schema.find((x) => x.key === 'priority');
    const hit = f?.allowedValues.find((v) => String(v.name).toLowerCase() === String(priority).toLowerCase());
    if (hit) out.extra.priority = { name: hit.name };
    else out.skipped.push({ key: 'priority', reason: f ? 'value-not-allowed' : 'not-on-screen' });
  }
  return out;
}

/* ── duplicates, and adding to an existing issue ───────────────────────── */

/**
 * Open issues in the project that look like this one: same fingerprint label
 * first, then the summary terms. At most `max` (default 3); read-only.
 */
export async function findDuplicates(cfg, { projectKey, url, summary, max = 3 }) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(projectKey || '')) return { fingerprint: null, candidates: [] };
  const fp = fingerprint({ url, summary });
  const terms = fp.terms.slice(0, 3).join(' ');
  const clauses = [`labels = "${fp.label}"`, ...(terms ? [`summary ~ "${terms}"`] : [])];
  const res = await call(cfg, jiraTransport(cfg).searchPath, {
    method: 'POST',
    body: {
      jql: `project = "${projectKey}" AND statusCategory != Done AND (${clauses.join(' OR ')}) ORDER BY updated DESC`,
      maxResults: 10,
      fields: ['summary', 'status', 'labels', 'updated'],
    },
  });
  const base = String(cfg.baseUrl).replace(/\/+$/, '');
  const candidates = (res.issues || [])
    .map((i) => ({
      key: i.key,
      url: `${base}/browse/${i.key}`,
      summary: i.fields.summary,
      status: i.fields.status?.name || null,
      category: i.fields.status?.statusCategory?.key || null,
      updatedAt: i.fields.updated ? Date.parse(i.fields.updated) : null,
      match: (i.fields.labels || []).includes(fp.label) ? 'fingerprint' : 'summary',
    }))
    .sort((a, b) => Number(b.match === 'fingerprint') - Number(a.match === 'fingerprint'))
    .slice(0, max);
  return { fingerprint: fp.label, candidates };
}

/** A comment on an existing issue (re-test result, new evidence). */
export async function addComment(cfg, issueKey, doc) {
  const { adf } = jiraTransport(cfg);
  const r = await call(cfg, `/issue/${encodeURIComponent(issueKey)}/comment`, { method: 'POST', body: { body: adf ? doc : adfToWiki(doc) } });
  return { id: r?.id ?? null };
}

/**
 * A single call that proves the whole configuration works, before it is needed.
 *
 * It reports the sign-in mode it used, because that is the setting people get
 * wrong and the one a 401 never names by itself: pasting a Data Center personal
 * access token while the sign-in says Cloud produces a refusal that reads as a
 * bad token. `jiraTransport()` refuses the impossible pairings before any
 * request leaves, and `refusedCredentialsMessage()` names the mode in the 401.
 */
export async function testConnection(cfg) {
  const { mode } = jiraTransport(cfg);
  const me = await whoAmI(cfg);
  const list = await projects(cfg);
  const epicField = await epicLinkField(cfg).catch(() => null);
  return {
    ok: true,
    mode,
    account: me,
    projects: list.length,
    projectKeys: list.map((p) => p.key),
    epicField,
    note: epicField
      ? `Company-managed epics link through ${epicField}.`
      : 'This site links epics through the parent field (team-managed projects).',
  };
}

/* ── the one filing path ───────────────────────────────────────────────── */

/**
 * Scan every issue's text and every attachment; never throws. `blocked` says
 * whether the caller may go on (it may when it asked to redact or allow).
 */
async function gate({ inputs, files, known, redact, allow }) {
  const findings = [];
  const cleaned = inputs.map((inp) => {
    const r = scanSecrets(inp, known);
    findings.push(...r.findings.map((f) => (inputs.length > 1 ? { ...f, field: `${inp.id}:${f.field}` } : f)));
    return r.redacted;
  });
  findings.push(...(await scanFiles(files, known)));
  return { findings, cleaned, blocked: findings.length > 0 && !redact && !allow };
}

const secretRefusal = (g) => ({
  code: 'SECRET_FOUND',
  message: `Possible secrets found in ${[...new Set(g.findings.map((f) => f.field))].join(', ')}. Nothing was sent. Send again with redact or allowSecrets to continue.`,
  data: { findings: g.findings, canRedact: true },
});

/** Link, and report the outcome instead of throwing: a failed link never loses the issue. */
async function tryLink(cfg, inward, outward, type, as) {
  try {
    await linkIssues(cfg, { inward, outward, type });
    return { to: outward, as, linked: true, type };
  } catch (err) {
    return { to: outward, as, linked: false, error: err.message };
  }
}

async function underEpic(cfg, project, key, epicKey) {
  const style = (await projects(cfg).catch(() => [])).find((x) => x.key === project)?.style;
  const epicField = await epicLinkField(cfg).catch(() => null);
  return { to: epicKey, as: 'epic', ...(await linkToEpic(cfg, key, epicKey, { style, epicField })) };
}

/**
 * File one issue, or comment on `existingKey`. `p` carries everything decided
 * in the worker (documents, project, type, labels, evidence plan, the vault's
 * tokens); `io.buildFiles(attach)` builds the evidence where the data lives.
 * Order: scan, shape typed fields, refuse (`refused`) or go on, create/comment,
 * relationships, attachments, provenance. `dryRun` stops after the checks.
 */
export async function fileIssue(cfg, p, io) {
  const built = p.attach ? await io.buildFiles(p.attach) : { files: [], failed: [] };
  const g = await gate({ inputs: [{ summary: p.summary, body: p.body, adf: p.adf, fields: p.fields }], files: built.files, known: p.known, redact: p.redact, allow: p.allow });
  const clean = g.cleaned[0];
  const r = p.existingKey ? { extra: {}, dropped: [], skipped: [] } : await resolveFields(cfg, p.project, p.typeName, p.redact ? clean.fields : p.fields, { priority: p.priority ?? (p.severity ? priorityFor(cfg, p.severity) : null) });
  if (p.dryRun) return { scan: { clean: !g.findings.length && !r.dropped.length, findings: g.findings, dropped: r.dropped, skipped: r.skipped } };
  if (r.dropped.length) {
    return { refused: { code: 'JIRA_FIELD_DROPPED', message: `Not filed: ${r.dropped.map((d) => d.key).join(', ')} would have been dropped (${[...new Set(r.dropped.map((d) => d.reason))].join(', ')}).`, data: { fields: r.dropped } } };
  }
  if (g.blocked) return { refused: secretRefusal(g) };

  const summary = p.redact ? clean.summary : p.summary;
  const full = p.body ? textToAdf(p.redact ? clean.body : p.body) : p.redact ? clean.adf : p.adf;
  const description = adfText(full).length > 32767 ? capAdf(full) : full; // D-1010-189: first and last 40 steps; the attachment keeps the rest
  const userLabels = Array.isArray(r.extra.labels) ? r.extra.labels : null;
  delete r.extra.labels;
  const labels = [...(userLabels || p.labels), fingerprint({ url: p.url, summary }).label];

  let created;
  if (p.existingKey) {
    await addComment(cfg, p.existingKey, description);
    created = { key: p.existingKey, url: `${cfg.baseUrl.replace(/\/+$/, '')}/browse/${p.existingKey}` };
  } else {
    created = await createIssue(cfg, { projectKey: p.project, issueTypeName: p.typeName, summary, description, labels, fields: r.extra });
  }

  const relationships = [];
  if (!p.existingKey) {
    if (p.epicKey) relationships.push(await underEpic(cfg, p.project, created.key, p.epicKey));
    const types = p.storyKey || p.testCaseKey ? await linkTypes(cfg).catch(() => []) : [];
    if (p.storyKey) relationships.push(await tryLink(cfg, created.key, p.storyKey, preferredLinkType(types, p.isTest ? 'test' : 'defect'), 'story'));
    if (p.testCaseKey && !p.isTest) relationships.push(await tryLink(cfg, created.key, p.testCaseKey, preferredLinkType(types, 'defect'), 'test case'));
  }
  // After the links, so a refused upload can never cost a relationship.
  const attachments = [...(await attachFiles(cfg, created.key, built.files, { redact: p.redact, known: p.known })), ...built.failed];
  // Best-effort on purpose: a watermark must not cost a filed defect.
  if (!p.existingKey && p.provenance) await attachProvenance(cfg, created.key, p.provenance);
  return { ...created, mode: p.existingKey ? 'commented' : 'created', relationships, attachments, attachedBytes: sentBytes(attachments), redacted: p.redact ? g.findings.length : 0, skipped: r.skipped, unscanned: await unscannedNames(built.files) };
}

/**
 * File a whole suite: every issue and the evidence are scanned before the
 * first is created; parent first, then children and defects, links last. A
 * failed step is reported and does not stop the rest.
 */
export async function fileSuite(cfg, s, io) {
  const built = s.attach ? await io.buildFiles(s.attach) : { files: [], failed: [] };
  const g = await gate({ inputs: s.steps.map((x) => ({ id: x.ref, summary: x.summary, adf: x.adf })), files: built.files, known: s.known, redact: s.redact, allow: s.allow });
  if (g.blocked) return { refused: secretRefusal(g) };

  const keys = new Map();
  const created = [];
  // The evidence is uploaded once per suite, onto the first step that asks for it; the others point at it.
  let evidenceOn = null;
  for (const [i, step] of s.steps.entries()) {
    try {
      const clean = g.cleaned[i];
      const issue = await createIssue(cfg, {
        projectKey: s.project, issueTypeName: step.typeName, labels: step.labels,
        summary: s.redact ? clean.summary : step.summary, description: s.redact ? clean.adf : step.adf,
      });
      keys.set(step.ref, issue.key);
      let attachments = [];
      if (step.evidence && !evidenceOn) {
        evidenceOn = issue.key;
        attachments = [...(await attachFiles(cfg, issue.key, built.files, { redact: s.redact, known: s.known })), ...built.failed];
      } else if (step.evidence) attachments = built.files.map((f) => ({ name: f.filename, ok: true, sameAs: evidenceOn }));
      created.push({ ref: step.ref, kind: step.kind, ...issue, attachments });
    } catch (err) {
      created.push({ ref: step.ref, kind: step.kind, error: err.message });
    }
  }

  // Relationships last, once every key is known.
  const links = [];
  const types = await linkTypes(cfg).catch(() => []);
  const parentKey = keys.get(s.steps[0]?.ref);
  for (const step of s.steps.slice(1)) {
    const key = keys.get(step.ref);
    if (!key || !parentKey) continue;
    const type = preferredLinkType(types, step.kind === 'defect' ? 'defect' : 'test');
    links.push({ from: key, ...(await tryLink(cfg, key, parentKey, type, 'parent')) });
    for (const link of step.links || []) {
      const target = keys.get(link.to);
      if (target) links.push({ from: key, ...(await tryLink(cfg, key, target, type, link.type)) });
    }
  }
  if (parentKey && s.epicKey) links.push({ from: parentKey, ...(await underEpic(cfg, s.project, parentKey, s.epicKey)) });
  return { created, links, parentKey, attachedBytes: created.reduce((n, c) => n + sentBytes(c.attachments), 0), redacted: s.redact ? g.findings.length : 0, unscanned: await unscannedNames(built.files) };
}
