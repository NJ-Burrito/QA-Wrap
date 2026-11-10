/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Whose failure is it? Decided from where the tester went, never from a blocklist (a list goes stale, and is wrong for
 * an internal tool whose own telemetry host looks like a tracker). The exact test, with the Public Suffix List, runs in
 * the page hook and in core/netfilter.js (D3); this file is the worker's light fallback and must stay small, because
 * the service worker's boot graph is at its ceiling (test-worker-imports).
 */

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Every host this session genuinely went to: the start URL, navigations, frames. */
export function sessionHosts(session, events = []) {
  const hosts = new Set();
  const add = (u) => {
    const h = hostOf(u);
    if (h) hosts.add(h);
  };
  add(session?.startUrl);
  for (const e of events) {
    if (e.kind === 'nav') add(e.url);
    if (e.frameUrl) add(e.frameUrl);
  }
  return hosts;
}

/** `api.shop.com` is not third party to `shop.com`; a failure with no URL (a console error) belongs to the page. */
export function isFirstParty(url, hosts) {
  return isFirstPartyHost(hostOf(url), hosts);
}

/** The same question for a host already extracted (the worker's tally counts by host). */
export function isFirstPartyHost(h, hosts) {
  if (!h) return true;
  for (const known of hosts) {
    if (h === known) return true;
    const tail = known.split('.').slice(-2).join('.');
    if (tail && (h === tail || h.endsWith(`.${tail}`))) return true;
  }
  return false;
}

/**
 * Failures split by whose server produced them.
 *
 * `theirs` is counted and named, never hidden. A blocked beacon is worth
 * knowing about — it is just not a defect in the application somebody is being
 * asked to fix, and putting it in the headline says that it is.
 */
export function splitFailures(failures = [], hosts = new Set()) {
  const own = [];
  const theirs = [];
  for (const f of failures) {
    (f.kind === 'net' && !isFirstParty(f.url, hosts) ? theirs : own).push(f);
  }
  return {
    own,
    theirs,
    theirHosts: [...new Set(theirs.map((f) => hostOf(f.url)).filter(Boolean))],
  };
}

/** The aside, written once so the report and the brief cannot word it differently. */
export function describeThirdParty({ theirs, theirHosts }) {
  if (!theirs.length) return null;
  const named = theirHosts.slice(0, 2).join(', ');
  const more = theirHosts.length > 2 ? ` and ${theirHosts.length - 2} more` : '';
  return `+${theirs.length} from ${named}${more}, not this site`;
}
