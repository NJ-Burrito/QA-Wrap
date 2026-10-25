/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * r363: where "Rate QA Wrap" points, per browser build.
 *
 * ONE place for the store listings. Fill a TODO_ constant when that store lists QA Wrap; while it is empty the
 * link falls back to the GitHub repo (stars). `tools/build-browsers.mjs` rewrites the BUILD_DIST line in each
 * dist, so the map is applied at build time; the source tree stays "chrome". Nothing is fetched: the link is
 * only opened when the person presses it.
 */
export const GITHUB_REPO = 'https://github.com/NJ-Burrito/QA-Wrap';
export const TODO_EDGE_ADDONS_URL = '';
export const TODO_AMO_URL = '';
export const TODO_OPERA_ADDONS_URL = '';

/** chrome has no listing yet, so GitHub; other engines (brave, duckduckgo, safari) use GitHub too. */
export const RATE_TARGETS = Object.freeze({
  chrome: '',
  edge: TODO_EDGE_ADDONS_URL,
  firefox: TODO_AMO_URL,
  opera: TODO_OPERA_ADDONS_URL,
  operagx: TODO_OPERA_ADDONS_URL,
});

export const BUILD_DIST = 'chrome'; // build-browsers rewrites this line per dist
export const BUILD_STORE = false; // --store build: the store updates it
export const BUILD_FLAVOUR = ''; // build-browsers sets 'managed' for the managed Chrome build, which updates to its own zip

/** The rating URL for a dist; an unknown dist or an empty placeholder gives the GitHub repo. */
export function rateUrl(dist = BUILD_DIST, targets = RATE_TARGETS) {
  return targets[dist] || GITHUB_REPO;
}
