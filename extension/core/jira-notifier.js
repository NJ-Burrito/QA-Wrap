/* QA Wrap - local-first QA toolkit in the ISTQB shape. */
/**
 * The Jira poll. Runs in the offscreen document (loaded with import() there, so it is not in the worker's boot graph) and
 * rides the user's own logged-in Jira session: credentials 'include', no stored password. It talks only to the one host the
 * user picked in Settings (default: the Jira last opened), and the worker asks only once the user has turned notifications on. It returns notes; the worker shows them.
 */
import { buildQueries, normalise, pickNotes, searchPath, mePath, cleanHost, isCloud, withSeen } from './jira-helper-core.js';

const SEEN = 'qawJiraSeen'; // "KEY|updated" -> time, no text. The offscreen page has no chrome.storage; its own localStorage holds this.

async function get(host, path, fetchImpl) {
  const res = await fetchImpl(`https://${host}${path}`, { credentials: 'include', headers: { Accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`Jira answered ${res.status}`), { status: res.status });
  return res.json();
}

/** Ask with the API generation the detected Jira speaks; a 404/410 means the other one, so try it once (custom-domain Cloud, odd proxies). */
async function ask(host, api, make, fetchImpl) {
  try { return await get(host, make(api), fetchImpl); } catch (e) {
    if (e.status !== 404 && e.status !== 410) throw e;
    return get(host, make(api === 3 ? 2 : 3), fetchImpl);
  }
}

/** One poll. @returns the notes to show. */
export async function poll(raw, { fetchImpl = fetch, store = localStorage, now = Date.now() } = {}) {
  const w = withSeen(raw, raw?.seen); // no address picked: the Jira last opened, speaking the API generation helper.js saw
  const s = normalise(w);
  if (!s.notify || !s.host) return [];
  const api = w.api || (isCloud(s.host) ? 3 : 2);
  const who = await ask(s.host, api, (a) => mePath(s.host, a), fetchImpl);
  const me = who.accountId || who.name || who.key || '';
  let relatedKeys = [];
  if (s.on.related) {
    const mine = await ask(s.host, api, (a) => searchPath(s.host, 'assignee = currentUser() AND resolution = Unresolved AND issueLinkType is not EMPTY', 'summary', 10, a), fetchImpl);
    relatedKeys = (mine.issues || []).map((i) => i.key);
  }
  /** @type {Record<string, number>} */
  let seen = {};
  try { seen = JSON.parse(store.getItem(SEEN) || '{}'); } catch { /* a bad list is an empty list */ }
  const notes = [];
  for (const { jql, mentions } of buildQueries(s, { relatedKeys })) {
    const data = await ask(s.host, api, (a) => searchPath(s.host, jql, undefined, undefined, a), fetchImpl);
    const r = pickNotes(data.issues || [], { me, seen, mentions, now, host: s.host });
    seen = r.seen;
    notes.push(...r.notes);
  }
  store.setItem(SEEN, JSON.stringify(seen));
  return notes.slice(0, 5); // five toasts at most per minute
}

/** Settings "Check connection": does the user's session answer from the extension? @returns the HTTP status, 0 for a bad host. */
export async function check(hostRaw, fetchImpl = fetch, api = undefined) {
  const host = cleanHost(hostRaw);
  if (!host) return 0;
  const first = (await fetchImpl(`https://${host}${mePath(host, api)}`, { credentials: 'include' })).status;
  if (first !== 404 && first !== 410) return first;
  return (await fetchImpl(`https://${host}${mePath(host, (api ?? (isCloud(host) ? 3 : 2)) === 3 ? 2 : 3)}`, { credentials: 'include' })).status;
}
