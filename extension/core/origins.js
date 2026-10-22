/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Whose failure is it?
 *
 * The number at the top of a report is the one number everybody reads. On any
 * site that embeds analytics it was reporting **the ad blocker's work, not the
 * product's** — an independent field test recorded "27 problems found" where
 * all 27 were blocked beacons to a third-party host and the application under
 * test had failed exactly zero times.
 *
 * The correlation engine had been right about each one individually; every
 * chain named the correct click. The conclusion was wrong entirely, because
 * nothing had asked *whose server* had failed.
 *
 * ── decided from where the tester went, never from a blocklist ────────────
 *
 * The temptation is a list of known ad and analytics hosts. It is the wrong
 * mechanism twice over: a blocklist goes stale the week after it is written,
 * and it is actively wrong for an internal tool whose own telemetry host looks
 * exactly like somebody else's tracker.
 *
 * "Did the tester actually visit it?" needs no list, never goes stale, and
 * stays right on a site nobody has heard of — including one on a private LAN,
 * which is most of what this extension is used against.
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

/**
 * `api.shop.com` is not third party to `shop.com`.
 *
 * So the comparison is on the registrable tail rather than the exact host —
 * otherwise every application whose API lives on a subdomain would have its own
 * failures thrown out of its own report, which is the opposite mistake and a
 * worse one.
 *
 * A failure with no URL at all — a console error, an uncaught exception —
 * belongs to the page by definition.
 */
export function isFirstParty(url, hosts) {
  return isFirstPartyHost(hostOf(url), hosts);
}

/**
 * The same question asked of a host that has already been extracted.
 *
 * The running tally the worker keeps for the popup counts failures by host
 * rather than holding every failing event in session storage, so it needs to
 * ask this without a URL to hand. Splitting it out is what stops that tally
 * and the report's own split answering differently.
 */
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
