/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Mattermost, as an account rather than a webhook.
 *
 * ── why this exists beside `background/notify.js` ──────────────────────────
 *
 * `notify.js` already speaks Mattermost. It speaks it the way it speaks Slack
 * and Teams and Discord: an incoming webhook, which is a URL that posts into
 * one channel somebody chose when they created it. That is the right shape for
 * most teams and it is not going anywhere.
 *
 * It is the wrong shape for the thing Nader asked for. "Connect to several chat
 * apps, one of them Mattermost, and when chosen and logged in, let the user
 * pick a channel to post to" is not a webhook: a webhook cannot list anything.
 * Picking a channel means signing in as a person, asking the server which teams
 * that person is in, asking which channels are in the team, and posting into
 * the one they chose. That is four REST v4 calls and they are all here.
 *
 * ── the token ──────────────────────────────────────────────────────────────
 *
 * A Mattermost personal access token is a bearer credential for a whole
 * account, so it is handled the way this product handles every credential and
 * a little more carefully:
 *
 *   - it lives in the credential vault beside the Jira and tracker tokens
 *     (`settings.trackers.mattermost.token`, AES-GCM, `platform/vault.js`), never in
 *     `sync` and never as plain JSON: only the server address and the chosen
 *     team and channel stay in `chrome.storage.local`, so the profile that
 *     typed it keeps it (`platform/settings.js` gives the argument at length).
 *     A plaintext token saved by an older build is moved into the vault once
 *     and removed only after it reads back identical (r1-03-1);
 *   - it is never logged, never put in an error message, and never written
 *     into an export. `tools/test-report.mjs` asserts the last of those against
 *     every export the product can produce, because that is the one that is
 *     easy to break by accident and impossible to notice;
 *   - `forget()` removes it, and removing it is offered on the same screen that
 *     asks for it.
 *
 * ── the three gates every send passes (r1-03-1, D-1010-03) ─────────────────
 *
 * The same ones the API tool and the chat webhooks pass: the managed policy
 * (`allows(org, 'integrations', url)`) before any fetch, the secret scan on the
 * text that is posted (a confirmed secret refuses the post), and one egress
 * ledger row per post: host and size, never the text.
 *
 * ── the name, not the mark ─────────────────────────────────────────────────
 *
 * Every surface says the word "Mattermost" and none of them shows the logo:
 * Mattermost requires prior written approval for any use of its marks, while
 * nominative use of the name is what trademark law leaves open regardless. Same
 * rule as the Jira button beside it. See `research/51d-legal-privacy-licensing.md`
 * sections 6 and 8.
 */

import { fetchT, noteScan, prepare } from '../core/egress.js';
import { scanOutbound } from '../core/secret-scan-text.js';
import { mmText as escapeText, safeHref } from '../core/events.js';
/** r3-14-4: a Markdown link target the parser cannot end early: parentheses, brackets, angle brackets, quotes, backticks, backslashes and whitespace are percent-encoded (safeHref already did parentheses and spaces). */
const mdHref = (u) => safeHref(u).replace(/[\s()[\]<>"'`\\]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
import { policy, getSettings, setSettings } from './settings.js';
import { allows } from './policy.js';

const KEY = 'mattermost';

/** The page's own words when it has them (keys that already exist), else the English default. */
function say(key, vars, english) {
  const live = globalThis.QAWi18n;
  const said = live && typeof live.t === 'function' ? live.t(key, vars) : key;
  if (said && said !== key) return said;
  return String(english).replace(/\{(\w+)\}/g, (whole, name) => (vars && name in vars ? String(vars[name]) : whole));
}

/** The managed policy is asked before any request leaves; a refusal names the key that said no. */
async function gate(url) {
  const hit = allows(await policy(), 'integrations', url);
  if (hit) {
    throw Object.assign(new Error(say('api.err.policy', { key: hit.key }, 'Turned off by your organisation ({key}). Ask your IT administrator.')), { code: 'POLICY_BLOCKED', key: hit.key });
  }
}

/**
 * https, or loopback, and nothing else.
 *
 * The same rule `background/notify.js` applies to a webhook, for the same
 * reason and with one addition: this request carries an Authorization header,
 * so plain http to another host would put an account credential on the wire in
 * the clear. A team running Mattermost on `127.0.0.1` while they try it out is
 * not crossing a network and is not refused.
 */
export function checkUrl(raw) {
  const url = String(raw || '').trim().replace(/\/+$/, '');
  if (!url) throw new Error('Type the address of your Mattermost server first.');
  if (!/^https?:\/\//i.test(url)) throw new Error('The server address needs to start with https.');
  const loopback = /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?(\/|$)/i.test(url);
  if (!/^https:\/\//i.test(url) && !loopback) {
    throw new Error(
      'A Mattermost server address must be https, or point at this machine. Over plain http ' +
        'to another host your access token would travel in the clear.'
    );
  }
  return url;
}

/**
 * One call, with the refusal turned into a sentence.
 *
 * Mattermost answers a failure with a JSON body carrying `message` and `id`,
 * and `message` is written for a person: "Invalid or expired session, please
 * login again." is worth far more to a tester than a 401. What is never
 * included is anything from the request, because the request holds the token.
 */
/** @param {{url: string, token?: string}} account @param {string} path @param {{method?: string, body?: any}} [opts] */
async function call(account, path, { method = 'GET', body } = {}) {
  const base = checkUrl(account.url);
  await gate(base);
  if (!account.token) throw new Error(say('report.mm.needToken', null, 'Paste a personal access token first.'));
  let res;
  try {
    // a post is a send: fetchT writes its one ledger row (host and size, no text); a read is not a send
    res = await fetchT(
      `${base}/api/v4${path}`,
      {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${String(account.token || '')}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      method === 'POST' ? { kind: 'mattermost' } : {}
    );
  } catch (err) {
    throw new Error(`Could not reach ${base}. ${err.message} Check the address and your network.`);
  }
  const raw = await res.text();
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.message) detail = parsed.message;
    } catch {
      /* not JSON: the status is the best we have, and the body may be an HTML error page */
    }
    if (res.status === 401) {
      throw new Error(`Mattermost refused the token: ${detail} Check it has not been revoked or expired.`);
    }
    throw new Error(`Mattermost refused the request: ${detail}`);
  }
  return raw ? JSON.parse(raw) : null;
}

/** Who the token belongs to. The first thing worth confirming, and the cheapest. */
export async function whoAmI(account) {
  const me = await call(account, '/users/me');
  return { id: me.id, username: me.username, name: [me.first_name, me.last_name].filter(Boolean).join(' ') || me.username };
}

/** The teams this account is a member of. */
export async function teams(account) {
  const list = await call(account, '/users/me/teams');
  return (list || [])
    .filter((t) => t && t.id && t.delete_at === 0)
    .map((t) => ({ id: t.id, name: t.display_name || t.name }));
}

/**
 * The channels in one team that this account can post into.
 *
 * Direct messages and group messages are filtered out: they have no name a
 * picker can show, and a session summary posted into somebody's DM by a
 * mis-click is the kind of accident a tool should not make possible. Archived
 * channels go too, for the obvious reason.
 */
export async function channels(account, userId, teamId) {
  const list = await call(account, `/users/${encodeURIComponent(userId)}/teams/${encodeURIComponent(teamId)}/channels`);
  return (list || [])
    .filter((c) => c && c.delete_at === 0 && (c.type === 'O' || c.type === 'P'))
    .map((c) => ({ id: c.id, name: c.display_name || c.name, private: c.type === 'P' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Post one message into one channel. Returns the post's id, so the caller can say it landed. */
export async function post(account, channelId, message) {
  const made = await call(account, '/posts', { method: 'POST', body: { channel_id: channelId, message } });
  return { id: made?.id || null };
}

/**
 * The post the report page makes: policy, then the secret scan, then the send.
 *
 * A confirmed secret in the text (the scan's CONFIRMED kinds, the vault's saved tokens, card and IBAN
 * shapes) refuses the post and says how many; nothing is sent and no ledger row is written. Guesses do
 * not block, as everywhere else. What is sent is the scanned text.
 */
export async function postSummary(account, channelId, summary, links = {}) {
  await gate(checkUrl(account.url));
  const known = [account.token].filter(Boolean);
  const opts = { scan: (fields, o) => scanOutbound(fields, { ...o, known }), url: account.url };
  // r2-03-2: the scan also reads the page text as typed. Markdown escaping puts a backslash before each underscore and asterisk of a token, which hides its shape from the scan.
  const typed = prepare('mattermost', summaryMarkdown(summary, links, true), opts);
  const checked = prepare('mattermost', summaryMarkdown(summary, links), opts);
  const found = (typed.findings.some((f) => f.redacted) ? typed : checked).findings.filter((f) => f.redacted);
  if (found.length) {
    throw Object.assign(
      new Error(say(found.length === 1 ? 'report.f.secretOne' : 'report.f.secretMany', { n: found.length }, found.length === 1 ? 'Secret scan: 1 secret-shaped value found' : 'Secret scan: {n} secret-shaped values found')),
      { code: 'SECRET_FOUND', findings: checked.findings }
    );
  }
  noteScan('mattermost', checked.findings.length); // the row for this post carries the scan's count
  return post(account, channelId, checked.payload);
}

/* ── the summary, as Mattermost markdown ─────────────────────────────────── */

/**
 * The same facts every other destination gets, in the dialect this one renders.
 *
 * Deliberately not a copy of `mattermostPayload()` in `background/notify.js`:
 * that one builds a webhook payload, with a `channel` field and an attachment
 * block a webhook is allowed to set. A post made as a signed-in person has a
 * channel already and no business overriding the author, so this is the message
 * body and nothing else.
 */
export function summaryMarkdown(summary, links = {}, typed = false) {
  const mmText = typed ? (v) => String(v ?? '') : escapeText; // typed: the text exactly as written, for the secret scan only
  const counts = summary.counts || {};
  const rows = [
    summary.where ? `**Where** ${mmText(summary.where)}` : null,
    summary.severity ? `**Severity** ${mmText(summary.severity)}, **priority** ${mmText(summary.priority || 'not set')}` : null,
    `**Result** ${counts.failures ?? 0} problem${counts.failures === 1 ? '' : 's'} in ${counts.events ?? 0} events, ${counts.steps ?? 0} steps recorded`,
    summary.expected ? `**Expected** ${mmText(summary.expected)}` : null,
    summary.actual ? `**Actual** ${mmText(summary.actual)}` : null,
  ].filter(Boolean);
  const linkLine = Object.entries(links)
    .filter(([, url]) => url)
    .map(([label, url]) => (typed ? `[${label}](${url})` : safeHref(url) ? `[${mmText(label)}](${mdHref(url)})` : mmText(label))) // r2-03-2: a link only for http(s), mailto, tel
    .join(' · ');
  return [`#### ${mmText(summary.title)}`, ...rows, linkLine, '', '_Captured locally with QA Wrap. Passwords and cookie values were never recorded._']
    .filter((line) => line !== null)
    .join('\n')
    .slice(0, 16000);
}

/* ── where the account is kept ───────────────────────────────────────────── */

/**
 * Read the saved account, or an empty one.
 *
 * The address and the chosen team and channel are in `chrome.storage.local` under one key; the token
 * is in the vault (`settings.trackers.mattermost.token`). `locked` is true while the vault is closed or
 * unreadable: the address still shows, the token does not, and nothing is posted.
 */
export async function load() {
  const blank = { url: '', token: '', teamId: '', channelId: '', locked: false };
  try {
    const got = await chrome.storage.local.get(KEY);
    /** @type {any} */
    const saved = got?.[KEY] || {};
    const settings = await getSettings();
    const locked = Boolean(settings.vaultLocked || settings.vaultUnreadable);
    let token = locked ? '' : String(settings.trackers?.mattermost?.token || '');
    if (!locked && saved.token) token = await migrate(saved, token);
    return { ...blank, url: saved.url || '', token, teamId: saved.teamId || '', channelId: saved.channelId || '', locked };
  } catch {
    return blank;
  }
}

/**
 * An older build kept the token as plain JSON in the same key. Move it into the vault once, read it back,
 * and only then rewrite the key without it. A failure at any step leaves the plaintext where it was for the
 * next load to try again; the return value is the token to use meanwhile.
 */
async function migrate(saved, inVault) {
  const token = String(saved.token || '');
  try {
    if (inVault !== token) await setSettings({ trackers: { mattermost: { token } } });
    if (String((await getSettings()).trackers?.mattermost?.token || '') === token) {
      const { token: _gone, ...rest } = saved;
      await chrome.storage.local.set({ [KEY]: rest });
    }
  } catch {
    /* plaintext stays until the next load tries again */
  }
  return token;
}

/** Save what was typed and chosen. The token goes to the vault and is read back; the rest stays local. Never `storage.sync`. */
export async function save(patch) {
  const { locked: _locked, token: had, ...current } = await load();
  const { token: typed, ...rest } = { ...current, ...patch };
  if (typed) {
    await setSettings({ trackers: { mattermost: { token: typed } } });
    if (String((await getSettings()).trackers?.mattermost?.token || '') !== typed) {
      throw new Error(say('report.f.locked', null, 'Unlock QA Wrap to file'));
    }
  }
  await chrome.storage.local.set({ [KEY]: rest });
  return { ...rest, token: typed || had };
}

/** Drop the account, token and all. Offered wherever the token is asked for. */
export async function forget() {
  await chrome.storage.local.remove(KEY);
  await setSettings({ trackers: { mattermost: {} } });
}
