/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Locator set (for an AI) — the picked-locator basket, ordered as the tester
 * walked it, and nothing else.
 *
 * The client's own words: they walk the flow once, copying every element the
 * automation should touch, then hand an AI a file "in a format it can easily
 * interpret" so it writes the whole script without spending tokens guessing
 * where things are. `agent.js` answers "what went wrong"; the Playwright spec
 * answers "replay the raw recording"; neither is this — a picker basket
 * (`kind: 'selectorcopy'`, filed by `content/picker.js`) is the tester's own
 * curation, in the order they picked it, and that order is the point.
 *
 * Privacy rides along for free: `picker.js` never puts a locator flavour built
 * out of masked words on the clipboard (`clean()` there checks `UQAMask.leaks`
 * per flavour before the event is even sent), so `flavours` on the stored event
 * is already clean. `text` is defensively re-checked here anyway — a session
 * recorded before that guard shipped is still a file this export may open.
 */
import { PRODUCT } from './product.js';
import { hasSensitive } from './privacy.js';
import { actionsForPick } from './action-join.js';
import { fence, FENCE_NOTE } from './fence.js';

export const LOCATOR_SET_SCHEMA = 'njb.locator-set/1';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** "+mm:ss" from session start, the walk order's own clock. */
function offset(ts, start) {
  const s = Math.max(0, Math.round((ts - start) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `+${m}:${String(r).padStart(2, '0')}`;
}

/** A flavour by name, off the array `picker.js` files on the event. */
const flavour = (flavours, name) => (flavours || []).find((f) => f.name === name) || null;

/** Never true for what `picker.js` already refused to copy; here to catch an older session. */
const unsafe = (text) => { try { return hasSensitive(String(text ?? '')); } catch { return false; } };

export function buildLocatorSet(session, events) {
  const start = session.startedAt;

  const picks = events
    .filter((e) => e.kind === 'selectorcopy')
    .filter((e) => !unsafe(e.text) && !e.maskedSource)
    .sort((a, b) => a.ts - b.ts)
    .map((e, i) => {
      const pw = flavour(e.flavours, 'playwright');
      const css = flavour(e.flavours, 'css');
      const xp = flavour(e.flavours, 'xpath');
      const entry = {
        n: i + 1,
        ts: new Date(e.ts).toISOString(),
        offset: offset(e.ts, start),
        label: clean(e.role || e.tag || '') || null,
        text: fence(e.text) || null,
        playwright: pw?.expr || null,
        css: css?.expr || null,
        xpath: xp?.expr || null,
        unique: pw ? !e.ambiguous : null,
        matches: e.matches ?? null,
        frameUrl: e.frameUrl || null,
      };
      // Gap G1 may add `category` to the event; carried through when present,
      // never required.
      if (e.category != null) entry.category = e.category;
      // Gap G2: the action(s) the tester performed on this same locator
      // elsewhere in the walk, oldest first — `null` (the ordinary case: a
      // pick made to assert on, never acted on) is omitted rather than
      // written as an empty or null field, for the same reason the report
      // renders nothing extra for it.
      const actions = actionsForPick(e, events);
      if (actions) entry.action = actions;
      // Gap G5, stage 1 only: a placeholder NAME, never a value — there is
      // no vault. `picker.js` never lets the tester type it into anything
      // masked, and this file never reads a value from anywhere.
      if (e.credRef?.name) entry.credential = { env: e.credRef.name };
      return entry;
    });

  const hasCredential = picks.some((p) => p.credential);

  return JSON.stringify(
    {
      schema: LOCATOR_SET_SCHEMA,
      tool: PRODUCT.name,
      generatedAt: new Date().toISOString(),

      header:
        'A locator set: the elements a tester picked while walking a flow by hand, in the exact ' +
        'order they picked them. That order IS the navigation the automated script should follow: ' +
        'do not re-derive it, do not reorder it. Each pick already carries a working locator; prefer ' +
        '`playwright` when `unique` is true, fall back to `css` or `xpath` otherwise, and treat a pick ' +
        'with `matches` above 1 as ambiguous on this page. When a pick carries `action`, that is what ' +
        'the tester did to it during the walk, oldest first (e.g. `["click"]`, `["input","submit"]`); ' +
        'a pick with no `action` was made to assert on, never to act on: that is normal, not an error. ' +
        FENCE_NOTE +
        (hasCredential
          ? ' A pick carrying `credential.env` needs a value this file does not have and never will: ' +
            'read it from the environment by that name (e.g. `process.env.LOGIN_PASSWORD`) and fail ' +
            'loudly if it is unset. Held back on purpose. Fill this in from your own credentials.'
          : ''),

      session: {
        id: session.id,
        charter: clean(session.charter),
        startUrl: session.startUrl,
      },

      count: picks.length,
      picks,
    },
    null,
    2
  );
}
