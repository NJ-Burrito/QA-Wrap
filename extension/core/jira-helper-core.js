/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * Jira helper, the pure part: settings shape, the JQL the poller sends, and which results become notifications.
 * No chrome.* and no network here, so tools/test-jira-helper.mjs runs it as is. Loaded by jira/notifier.js (offscreen,
 * never the worker's boot graph) and by options/jira-helper.js.
 */
export const KEY = 'qawJira';
export const ALARM = 'qaw-jira';
export const WINDOW_MIN = 2; // each poll looks 2 minutes back, the alarm fires every minute; the seen-list drops the overlap

export const DEFAULTS = Object.freeze({
  dropdown: true,
  rtl: true,
  notify: false, // off until the user turns it on
  host: '',
  projects: [],
  labels: [],
  on: { assigned: false, watched: false, mentions: false, labels: false, related: false },
});

const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/)).map((s) => String(s).trim()).filter(Boolean);

/** Host as the user typed it -> bare lowercase host, or '' when it is not one. */
export function cleanHost(v) {
  const h = String(v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(h) ? h : '';
}

export const isCloud = (host) => /\.atlassian\.net$/.test(host);

export function normalise(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const on = r.on && typeof r.on === 'object' ? r.on : {};
  return {
    dropdown: r.dropdown !== false,
    rtl: r.rtl !== false,
    notify: r.notify === true,
    host: cleanHost(r.host),
    projects: list(r.projects).map((p) => p.toUpperCase()).filter((p) => /^[A-Z][A-Z0-9_]*$/.test(p)),
    labels: list(r.labels).filter((l) => /^[^\s",()]+$/.test(l)),
    on: Object.fromEntries(Object.keys(DEFAULTS.on).map((k) => [k, on[k] === true])),
  };
}

const q = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;

/**
 * The queries one poll sends. Assigned / watched / labels / related OR together in one query; mentions cannot be said in
 * JQL, so it is a second, unfiltered query whose comments are searched for the user afterwards. With no "notify on"
 * toggle ticked, every change in the chosen projects is news.
 * @returns {{jql: string, mentions: boolean}[]}
 */
export function buildQueries(settings, { relatedKeys = [] } = {}) {
  const s = normalise(settings);
  const base = [`updated >= -${WINDOW_MIN}m`];
  if (s.projects.length) base.push(`project in (${s.projects.map(q).join(', ')})`);
  const any = [];
  if (s.on.assigned) any.push('assignee = currentUser()');
  if (s.on.watched) any.push('watcher = currentUser()');
  if (s.on.labels && s.labels.length) any.push(`labels in (${s.labels.map(q).join(', ')})`);
  if (s.on.related) for (const k of relatedKeys.slice(0, 10)) any.push(`issue in linkedIssues(${q(k)})`);
  const none = !Object.values(s.on).some(Boolean);
  const out = [];
  if (any.length || none) out.push({ jql: [...base, ...(any.length ? [`(${any.join(' OR ')})`] : [])].join(' AND ') + ' ORDER BY updated DESC', mentions: false });
  if (s.on.mentions) out.push({ jql: base.join(' AND ') + ' ORDER BY updated DESC', mentions: true });
  return out;
}

/** Cloud moved search to /search/jql; Server and Data Center keep /api/2/search. */
export const searchPath = (host, jql, fields = 'summary,updated,created,comment,assignee,labels', max = 25, api = isCloud(host) ? 3 : 2) =>
  `${api === 3 ? '/rest/api/3/search/jql' : '/rest/api/2/search'}?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=${max}`;
export const mePath = (host, api = isCloud(host) ? 3 : 2) => (api === 3 ? '/rest/api/3/myself' : '/rest/api/2/myself');

/** The host to poll: the one picked in Settings, else the Jira last opened (helper.js records it in qawJiraSeen). */
export const withSeen = (s, seen) => {
  const host = cleanHost(s?.host) || cleanHost(seen?.last);
  return { ...(s || {}), host, api: seen?.hosts?.[host] === 3 || seen?.hosts?.[host] === 2 ? seen.hosts[host] : undefined };
};

const ms = (v) => Date.parse(v) || 0;

/**
 * Turn search results into notifications, dropping what was already announced.
 * @param {any[]} issues  issue objects from the search
 * @param {{me?: string, seen?: Record<string, number>, mentions?: boolean, now?: number, host: string}} ctx
 * @returns {{notes: {key: string, kind: string, summary: string, url: string}[], seen: Record<string, number>}}
 */
export function pickNotes(issues, { me = '', seen = {}, mentions = false, now = Date.now(), host }) {
  const next = { ...seen };
  const notes = [];
  const since = now - (WINDOW_MIN + 1) * 60000;
  for (const it of issues) {
    const f = it.fields || {};
    const id = `${it.key}|${f.updated}`;
    if (next[id]) continue;
    const recent = (f.comment?.comments || []).filter((c) => ms(c.created) >= since || ms(c.updated) >= since);
    const mentioned = !!me && recent.some((c) => JSON.stringify(c.body ?? '').includes(me));
    if (mentions && !mentioned) continue;
    const theirs = recent.filter((c) => (c.author?.accountId || c.author?.name) !== me);
    const kind = mentioned ? 'mention' : ms(f.created) >= since ? 'new' : theirs.length ? 'comment' : 'update';
    next[id] = now;
    notes.push({ key: it.key, kind, summary: String(f.summary || ''), url: `https://${host}/browse/${it.key}` });
  }
  const keep = Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, 200);
  return { notes, seen: Object.fromEntries(keep) };
}
