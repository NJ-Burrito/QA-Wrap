/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// @ts-check
/**
 * Gap G2: label a picked locator with the action(s) performed on it.
 *
 * ── why this is not a field on the pick ───────────────────────────────────
 *
 * `research/116` §10 row G2: whether an element is *the submit button* is a
 * fact about the walk, not about the element. The walk is recorded as `dom`
 * events (`core/events.js:63-68`, action/locator/value); the pick is a
 * `selectorcopy` event (`events.js:71-76`). Neither carries the other's
 * information, so this file joins them after the fact instead of teaching
 * the picker to guess at capture time — a guess made once at pick time can
 * never see an action recorded later in the same walk.
 *
 * ── the matching rule, decided once, here ─────────────────────────────────
 *
 * **Key: `selector` (the CSS string), falling back to `xpath` when either
 * side has no CSS, plus an exact `frameUrl` match.** Not the Playwright
 * locator: a `dom` event's `locator` is the bare expression
 * (`selector-engine.js:780`) while a pick's copied flavour is the full
 * `page.<frame>.<expr>` statement (`picker.js:169`, built from
 * `desc.playwright`) — same describe() call, different string shape, so
 * comparing them needs prefix-stripping for no real gain. CSS and XPath are
 * already on both allow-lists in their raw, comparable form
 * (`events.js:65-66` for `dom`, implicitly via `flavours[].expr` for
 * `selectorcopy`) and both come from the same `describe()` on the same
 * live element, so an exact string match is the honest comparison, not a
 * normalised one — normalising (e.g. stripping `:nth-of-type`) would start
 * matching *different* elements that merely look similar.
 *
 * **No time window.** A tester picks a locator to mark what the automated
 * test should touch or assert on; the action on it can happen before the
 * pick (they acted on it, then decided it mattered enough to copy) or after
 * (they copy it, then keep walking and act on it later). Restricting the
 * join to a window near the pick's timestamp would silently drop real
 * matches for no stated reason, so the join runs over the whole session.
 *
 * **Several actions on one locator: all of them, in order, action-type
 * deduped when repeated back to back** (three clicks in a row on one button
 * read as one `click`, not three) but kept distinct otherwise (`click` then
 * `input` then `submit` stays three). This is the honest summary of what a
 * person did to that element, not a single guess at "the" action.
 *
 * **Two picks that share a locator** get the identical action list, because
 * they name the same target — this is correct, not a collision to resolve.
 *
 * **A pick with no matching action is common and correct**, not a defect: a
 * tester picks a label or a heading to *assert on*, never to act on.
 * `actionsForPick` returns `null` for that case and every caller must render
 * that as "no action recorded" — never as empty-looking, a warning, or a
 * failure. (`isFailure` in `./events.js` never sees a pick either way; this
 * file adds no new failure condition.)
 */

/**
 * The `dom` events acted on the same locator as `pick`, oldest first.
 * Internal; `actionsForPick` is the public shape callers should use.
 */
function matchingDomEvents(pick, events) {
  const pickCss = pick?.flavours?.find((f) => f.name === 'css')?.expr || null;
  const pickXpath = pick?.flavours?.find((f) => f.name === 'xpath')?.expr || null;
  if (!pickCss && !pickXpath) return [];

  return events
    .filter((e) => e.kind === 'dom' && e.frameUrl === pick.frameUrl)
    .filter((e) => (pickCss && e.selector === pickCss) || (pickXpath && e.xpath === pickXpath))
    .sort((a, b) => a.ts - b.ts);
}

/**
 * The action(s) performed on a picked locator during the session, or `null`
 * when none were — which is the ordinary case for a pick made to assert on,
 * not to act on. See the module comment for the matching rule.
 *
 * @param {object} pick a `selectorcopy` event
 * @param {object[]} events the full session, any order
 * @returns {string[] | null}
 */
export function actionsForPick(pick, events) {
  if (!pick || pick.kind !== 'selectorcopy' || !Array.isArray(events)) return null;
  const matches = matchingDomEvents(pick, events);
  if (!matches.length) return null;

  const actions = [];
  for (const m of matches) {
    if (!m.action) continue;
    if (actions[actions.length - 1] !== m.action) actions.push(m.action);
  }
  return actions.length ? actions : null;
}
