/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * How this Jira wants to be asked, and the one place that builds the header.
 *
 * ── the bug this exists to end ─────────────────────────────────────────────
 *
 * There are two Jiras. Atlassian's hosted one, at `<site>.atlassian.net`, signs
 * a request with an email and an API token joined by a colon and sent as HTTP
 * Basic. Every self-hosted one, which Atlassian calls Data Center (and Server
 * before that), signs it with a personal access token sent as
 * `Authorization: Bearer <token>` and no email at all. Data Center *refuses*
 * Basic with a personal access token, and the refusal is a bare 401 that reads
 * exactly like a wrong password: people spend an afternoon regenerating tokens
 * that were fine.
 *
 * `background/jira.js` sent the Cloud form to both for as long as it existed.
 * That is what this module fixes, and it fixes it once: the header is built
 * here and nowhere else, so a request path added next year cannot get it wrong
 * by copying the old shape.
 *
 * ── auto, and why it is a default rather than the whole answer ─────────────
 *
 * The host tells you: `*.atlassian.net` is Cloud, anything else is Data Center.
 * That is right for almost everybody and wrong for the exceptions, which do
 * exist (a Cloud site reached through a company domain), so the setting keeps
 * a visible override and this module honours it over the detection.
 *
 * ── the API version travels with the mode ──────────────────────────────────
 *
 * `/rest/api/3` is Cloud only. Data Center has never had it and answers 404,
 * which the transport reads as "check the site URL" and sends the reader
 * somewhere else again. Data Center speaks `/rest/api/2`, whose bodies are the
 * same for everything this product sends except two endpoints that were split
 * apart on Cloud and one field:
 *
 * - listing projects: Cloud paginates at `/project/search`, Data Center returns
 *   the whole array at `/project`.
 * - searching: Cloud moved JQL to `/search/jql`, Data Center has `/search`.
 * - the description: Cloud takes Atlassian Document Format, Data Center takes
 *   wiki markup as a plain string.
 *
 * So the mode carries those three answers too. They are the whole difference,
 * and keeping them beside the header is what stops each one being rediscovered
 * separately.
 *
 * ── a third mode: Data Center with a username and password ────────────────
 *
 * Some Data Center sites never hand out personal access tokens, and people
 * there sign in with the same username and password they type into the web
 * page. That is HTTP Basic, like Cloud, but on `/rest/api/2` with Data Center's
 * paths (`server-basic`). The username travels in the `email` setting, the
 * password in `token`: one field each, whatever the label calls it. It is only
 * ever chosen by name. Auto never picks it and never falls back to it after a
 * Bearer 401: sending a password nobody asked us to send is the one mistake a
 * sign-in cannot take back.
 */

function hostOf(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return '';
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Which Jira a URL points at, read from the host alone.
 *
 * A site with nothing typed into it yet is called Cloud, because that is what
 * the field's own placeholder shows and because an empty URL never reaches a
 * network anyway: the transport refuses it first.
 */
export function detectAuthMode(baseUrl) {
  const host = hostOf(baseUrl);
  if (!host) return 'cloud';
  return /(^|\.)atlassian\.net$/.test(host) ? 'cloud' : 'server';
}

/** The mode actually in force: the override if there is one, otherwise the host. */
/** Every mode a setting can name; anything else means auto. */
export const AUTH_MODES = ['cloud', 'server', 'server-basic'];

export function resolveAuthMode(cfg = {}) {
  const chosen = String(cfg.authMode || 'auto').toLowerCase();
  return AUTH_MODES.includes(chosen) ? chosen : detectAuthMode(cfg.baseUrl);
}

/** True when the setting is leaving the choice to the host rather than naming one. */
export const isAutoMode = (cfg = {}) => !AUTH_MODES.includes(String(cfg.authMode || 'auto').toLowerCase());

/** What each mode calls the thing you paste, because they are not the same thing. */
export const TOKEN_LABEL = {
  cloud: 'API token',
  server: 'personal access token',
  'server-basic': 'password',
};

/**
 * Base64 for the Basic pair, of its UTF-8 bytes.
 *
 * `btoa` exists in the service worker, in the offscreen document, in a page and
 * in Node, which is every place this runs. It refuses anything outside Latin-1,
 * and a password, unlike an API token, may well be Arabic: encoding to UTF-8
 * first is what Jira's own login form sends, and is the identity for ASCII.
 */
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/**
 * The Authorization header for this configuration. The only one in the product.
 */
export function authHeader(cfg = {}) {
  const token = String(cfg.token || '');
  if (resolveAuthMode(cfg) === 'server') return `Bearer ${token}`;
  // Cloud and server-basic are both Basic: email or username, then the secret.
  return `Basic ${b64(`${String(cfg.email || '')}:${token}`)}`;
}

/**
 * What is missing before anything is sent, in a sentence, or null when nothing is.
 *
 * Only the impossible combinations: a Basic header cannot be built without an
 * email, and neither header can be built without a token. A configuration that
 * looks unusual but could work is left alone and allowed to try, because the
 * unusual ones are real and a tool that refuses them is a tool people work
 * around.
 */
export function credentialProblem(cfg = {}) {
  if (!String(cfg.baseUrl || '').trim()) return 'Jira is not configured: the site URL is missing.';
  const mode = resolveAuthMode(cfg);
  if (!String(cfg.token || '').trim()) {
    return `Jira is not configured: the ${TOKEN_LABEL[mode]} is missing.`;
  }
  if (mode === 'cloud' && !String(cfg.email || '').trim()) {
    return 'Jira is not configured: the email is missing. Jira Cloud signs in with an email and an API token; a Data Center site signs in with a personal access token on its own, so switch the sign-in if that is what you pasted.';
  }
  if (mode === 'server-basic' && !String(cfg.email || '').trim()) {
    return 'Jira is not configured: the username is missing.';
  }
  return null;
}

/**
 * What a 401 means here, said in terms of the mode that produced it.
 *
 * Jira answers a Basic header carrying a personal access token with the same
 * bare 401 it answers a wrong password with. Nothing in the body distinguishes
 * them, so the distinction has to come from what we sent and where we sent it:
 * Basic, to a host that is not Atlassian's, is the one combination that cannot
 * work no matter how good the token is.
 */
export function refusedCredentialsMessage(cfg = {}) {
  const mode = resolveAuthMode(cfg);
  if (mode === 'cloud' && detectAuthMode(cfg.baseUrl) === 'server') {
    return 'Jira refused the credentials. This site is not a Jira Cloud site, and Data Center will not accept an email and API token pair: set the sign-in to Data Center in Settings and paste a personal access token, or pick username and password.';
  }
  if (mode === 'server-basic') {
    return 'Jira refused the username and password. Check both in Settings.';
  }
  if (mode === 'server' && isAutoMode(cfg)) {
    // Never retried with a password: the person says which sign-in this is.
    return 'Jira refused the credentials. Check the personal access token in Settings; if you sign in with a username and password, choose that under Sign-in.';
  }
  if (mode === 'server') {
    return 'Jira refused the credentials. Check the personal access token in Settings, and that it has not expired.';
  }
  return 'Jira refused the credentials. Check the email and API token in Settings.';
}

/**
 * Everything a request needs, decided once: where to send it, how to sign it,
 * which REST version to speak, and the three endpoints that differ.
 *
 * Throws the sentence from `credentialProblem()` rather than returning half a
 * transport, so no caller has to remember to check.
 */
export function jiraTransport(cfg = {}) {
  const problem = credentialProblem(cfg);
  if (problem) throw new Error(problem);

  const mode = resolveAuthMode(cfg);
  const cloud = mode === 'cloud';
  return {
    mode,
    base: String(cfg.baseUrl).trim().replace(/\/+$/, ''),
    /** The REST prefix every path in `background/jira.js` is written against. */
    api: cloud ? '/rest/api/3' : '/rest/api/2',
    /** Cloud paginates its project list; Data Center returns the array whole. */
    projectsPath: cloud
      ? '/project/search?maxResults=100&expand=insight&orderBy=lastIssueUpdatedTime'
      : '/project?expand=insight',
    /** Cloud moved JQL search to its own path; Data Center kept the old one. */
    searchPath: cloud ? '/search/jql' : '/search',
    /** Cloud takes Atlassian Document Format; Data Center takes wiki markup. */
    adf: cloud,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: authHeader(cfg),
    },
  };
}
