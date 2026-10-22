/* QA Wrap — local-first QA toolkit in the ISTQB shape. */

import { SHORT, copyright, token } from './provenance.js';
/**
 * Ticket formats for the tools QA teams actually file into.
 *
 * These are pure text transforms, on purpose. The product's promise is that
 * nothing leaves the machine, and a clipboard button honours that completely
 * while still landing a properly formatted ticket in Jira, GitHub or Azure.
 * Posting over the network is a separate, opt-in thing — see `jira.js`.
 *
 * Every format carries the same content: what broke, what caused it, how to
 * reproduce it, and the environment. Only the markup differs.
 */

import { isTesterNote } from './events.js';
import { correlate, isFailure, reproSteps } from './artifact.js';
import { byPageOf } from './artifact-docs.js';
import { sessionIsArabic } from './docshell.js';
import { docLabels, fill, confWord } from './doc-labels.js';


/** A count and its noun, agreeing. Local: see `background/service-worker.js`. */
export const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

export const when = (ts, start) => {
  const d = (ts - start) / 1000;
  return `${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(2)}s`;
};

export function summarise(ev) {
  switch (ev.kind) {
    case 'nav':
      return `Opened ${ev.url}`;
    case 'dom': {
      const t = ev.label || ev.tag || 'element';
      if (ev.action === 'click') return `Clicked ${t}`;
      if (ev.action === 'input') return `Typed "${ev.value ?? ''}" into ${t}`;
      if (ev.action === 'change') return `Set ${t} to "${ev.value ?? ''}"`;
      if (ev.action === 'submit') return `Submitted ${t}`;
      if (ev.action === 'keydown') return `Pressed ${ev.key} on ${t}`;
      return `${ev.action} on ${t}`;
    }
    case 'net':
      return `${ev.method} ${ev.url} → ${ev.error ? 'network error' : ev.status} (${Math.round(ev.durationMs)}ms)`;
    case 'console':
      return `console.${ev.level}: ${ev.text}`;
    case 'pageerror':
      return ev.text;
    case 'selectorcopy':
      return `Copied the locator ${ev.copied}`;
    default:
      return ev.text || ev.kind;
  }
}

/**
 * The one-line title a tracker shows in a list.
 *
 * Jira's `summary` is a single line capped at 255 characters and it rejects the
 * whole issue with a 400 rather than truncating, so every path out of here —
 * including the charter fallback — is collapsed and cut.
 */
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);

export function title(session, events) {
  const [first] = correlate(events);
  if (!first) return oneLine(session.charter) || 'QA session';
  const what =
    first.failure.kind === 'net'
      ? `${first.failure.method} ${first.failure.url} returns ${first.failure.error ? 'a network error' : first.failure.status}`
      : first.failure.text;
  const where = first.trigger ? ` after ${summarise(first.trigger).toLowerCase()}` : '';
  return oneLine(`${what}${where}`);
}

/* ── shared body, rendered per markup dialect ─────────────────────────── */

export function sections(session, events) {
  const chains = correlate(events);
  const failures = events.filter(isFailure);
  const notes = events.filter(isTesterNote);
  const a11y = [...events].reverse().find((e) => e.kind === 'a11y');
  const perf = [...events].reverse().find((e) => e.kind === 'perf');

  return {
    chains: chains.map((c) => ({
      failure: summarise(c.failure),
      trigger: c.trigger ? summarise(c.trigger) : null,
      gapMs: c.gapMs,
      confidence: c.confidence,
      detail: c.failure.responsePreview || c.failure.stack || null,
    })),
    steps: reproSteps(events, byPageOf(session, events)),
    notes: notes.map((n) => ({ tag: n.tag, text: n.text, at: when(n.ts, session.startedAt) })),
    env: [
      ['URL', session.startUrl || '—'],
      ['Viewport', session.env?.viewport || '—'],
      ['Browser', session.env?.userAgent || '—'],
      ['Platform', session.env?.platform || '—'],
      ['Language', session.env?.language || '—'],
      ['Recorded', new Date(session.startedAt).toISOString()],
      ['Events', `${events.length} (${failures.length} failure${failures.length === 1 ? '' : 's'})`],
    ],
    a11y,
    perf,
    locators: events
      .filter((e) => e.kind === 'dom' && e.locator)
      .slice(0, 12)
      .map((e) => `page.${e.framePrefix || ''}${e.locator}`),
  };
}

/* ── Jira wiki markup ─────────────────────────────────────────────────── */

/** T-053: the words of the Jira text follow the tester's language; the product line at the foot stays as it is. */
const JIRA_ENV = { URL: 'envUrl', Viewport: 'envViewport', Browser: 'envBrowser', Platform: 'envPlatform', Language: 'envLanguage', Recorded: 'envRecorded' };

/**
 * r3-11-3: console, error and page text is hostile input. In Jira wiki it could plant an image
 * (`!http://...!`), a link that reads as the tester's own (`[x|http://...]`) or a macro (`{panel}`).
 * `wikiEsc` backslash-escapes the markup characters and joins lines; a `-`, `+` or `?` is escaped
 * only where it could open or close a span (not between two letters or digits, so `my-page` stays).
 */
const isWord = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);
export function wikiEsc(text) {
  return String(text ?? '')
    .replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ')
    .replace(/[\\{}[\]|!*_^~]/g, '\\$&')
    .replace(/[-+?]/g, (m, i, str) => (isWord(str[i - 1]) && isWord(str[i + 1]) ? m : `\\${m}`));
}
/** A table cell that may hold a URL: only what changes structure, links, images or macros is escaped, so the URL stays clickable. */
export function wikiCell(text) {
  return String(text ?? '')
    .replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ')
    .replace(/[\\{}[\]|!]/g, '\\$&');
}
/** Inside {code}/{noformat} only a closing macro matters: `{code}` or `{noformat}` in the text gets a space after the brace. */
export function wikiCode(text) {
  return String(text ?? '').replace(/\{(?=\s*(?:code|noformat)\b)/gi, '{ ');
}

export function toJira(session, events, { plain = false } = {}) {
  const E = plain ? (t) => String(t ?? '') : wikiEsc;
  const C = plain ? (t) => String(t ?? '') : wikiCell;
  const s = sections(session, events);
  const ar = sessionIsArabic(session, events);
  const W = docLabels(ar ? 'ar' : 'en');
  const L = [];

  L.push(`h2. ${W.jWhat}`);
  if (s.chains.length) {
    for (const c of s.chains) {
      L.push(`* *${E(c.failure)}*`);
      L.push(
        c.trigger
          ? `** ${W.jCause}: ${E(c.trigger)} _(${fill(W.jEarlier, { ms: c.gapMs })}, ${fill(W.confidence, { v: confWord(W, c.confidence) })})_`
          : `** ${W.jNoCause}`
      );
      if (c.detail) L.push(`{code}\n${plain ? c.detail : wikiCode(c.detail)}\n{code}`);
    }
  } else {
    L.push(`${W.jNoFailures}: ${E(session.charter)}`);
  }

  L.push('', `h2. ${W.jSteps}`);
  s.steps.forEach((step) => L.push(`# ${E(step.replace(/^\d+\.\s*/, ''))}`));

  if (s.notes.length) {
    L.push('', `h2. ${W.jNotes}`);
    s.notes.forEach((n) => L.push(`* ${n.tag ? `*${E(n.tag.toUpperCase())}* ` : ''}${E(n.text)} _(${n.at})_`));
  }

  if (s.a11y) {
    L.push('', `h2. ${W.jA11y}`);
    L.push(`${plural(s.a11y.total, 'issue')} across ${plural(s.a11y.violations.length, 'rule')}, found by axe-core.`);
    L.push('||Impact||Rule||Elements||Issue||');
    s.a11y.violations.forEach((v) => L.push(`|${E(v.impact || 'n/a')}|${E(v.id)}|${v.count}|${E(v.help)}|`));
  }

  if (s.perf) {
    L.push('', `h2. ${W.jPerf}`);
    L.push('||Metric||Value||Rating||');
    for (const [k, v] of Object.entries(s.perf.metrics)) {
      L.push(`|${k.toUpperCase()}|${v ?? '—'}|${s.perf.ratings[k]}|`);
    }
  }

  L.push('', `h2. ${W.jEnv}`);
  L.push(`||${W.jField}||${W.jValue}||`);
  const failureCount = events.filter(isFailure).length;
  s.env.forEach(([k, v]) => L.push(`|${W[JIRA_ENV[k]] || k}|${C(k === 'Events' && ar ? fill(W.eventsFailures, { n: events.length, f: failureCount }) : v)}|`));

  if (s.locators.length) {
    L.push('', `h2. ${W.jLocators}`);
    L.push('{code:javascript}');
    s.locators.forEach((l) => L.push(plain ? l : wikiCode(l)));
    L.push('{code}');
  }

  /*
   * The footer, and the one place the two audiences genuinely collide.
   *
   * Jira wiki markup has no comment syntax, so unlike every other format there
   * is nowhere to put a token that a person will not see. A ticket filed
   * through the REST API carries its provenance as an issue property instead,
   * invisible in the UI — but this is the *clipboard* format, pasted by hand,
   * and a pasted ticket has no property to hang anything on. The token has to
   * be in the text or there is no attribution at all.
   *
   * So the compromise is about shape, not presence. One human line that reads
   * as a sentence, then the token alone in `{{monospace}}`, which Jira renders
   * as a code fingerprint — the eye skips it the way it skips a commit hash,
   * instead of trying to read 150 characters of base64 as prose.
   */
  L.push(
    '',
    `_${SHORT} · ${copyright()} · Captured locally; cookie values and passwords were never recorded._`,
    `{{${token({ session, kind: 'jira-wiki' })}}}`
  );
  return L.join('\n');
}
