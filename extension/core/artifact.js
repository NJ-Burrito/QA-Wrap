/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Defect-artefact builder: correlate() (re-exported from correlate.js) and the Playwright spec; the Markdown and JSON builders live in artifact-docs.js. Pure: no network, no Chrome APIs. */

import { isFailure, liteProblem, liteFp, safeLocator, safePrefix } from './events.js';

import { MAKER, docFooter, embed, provenance } from './provenance.js';

// Re-exported; the one definition lives in events.js so every surface agrees what a failure is.
export { isFailure };

/* Correlation lives in `core/correlate.js` (8 Sept 2026) so the classic-script pages can import it without this module's weight; re-exported so importers are unchanged. */
export {
  DEFAULT_CAUSAL_WINDOW_MS,
  causalWindowMs,
  setCausalWindowMs,
  correlate,
} from './correlate.js';


/* ── labels and repro steps live in core/steps.js (re-exported, importers unchanged) ── */
import {
  LABEL_MAX, LABEL_PROSE_MAX, decodeSafe, clampLabel, isRunOnName, isSelectorLike,
  stepLabel, pathLabel, pageLabel, describeDom, reproSteps, dropDoubleSubmits,
} from './steps.js';
export {
  LABEL_MAX, LABEL_PROSE_MAX, decodeSafe, clampLabel, isRunOnName, isSelectorLike,
  stepLabel, pathLabel, pageLabel, describeDom, reproSteps, dropDoubleSubmits,
};

/* ── how much of the evidence a document may carry inside itself ─────────── */

/**
 * The rule for embedding screenshots, decided once for every document (research/54: a real session wrote 29.9 MB of storyboard
 * HTML and 13.7 MB of Markdown because every screenshot was inlined at full size).
 *
 * A document has a budget, spent in the order the pictures were taken: an image over `INLINE_IMAGE_MAX` is never inlined; anything
 * that still fits under `INLINE_BUDGET` is; the rest is named with its size instead of embedded. Nothing is lost: the files are
 * written under `Screenshots/` beside the document and the raw JSON keeps every capture. 2 MB is about where a Markdown file stops
 * opening instantly; 512 KB is a generous full-width PNG. Both are measured on the base64 string, which is what lands in the file.
 */
export const INLINE_IMAGE_MAX = 512 * 1024;
export const INLINE_BUDGET = 2 * 1024 * 1024;

/** Roughly how many bytes a base64 payload stands for, for a sentence a reader sees. */
export const decodedBytes = (dataUrl) => Math.round((String(dataUrl || '').length * 3) / 4);

/**
 * Which screenshots this document may carry, and what to say about the rest.
 *
 * Pure, and shared by every builder: `buildMarkdown` here, the manual and the
 * storyboard in `core/docs.js`. One rule, applied in one place, so the three
 * documents cannot disagree about which pictures they hold.
 *
 * `captures[id].path` (set by the bundle in background/export-build.js, r10-11-2) makes a linked screenshot a real link; without it the sentence names the folder.
 *
 * Returns a Map from capture id to one of:
 *   `{ inline: true, dataUrl }`         — embed it
 *   `{ inline: false, bytes, path }`    — name it; `path` may be null
 */
export function inlinePlan(shots, captures = {}, { budget = INLINE_BUDGET, max = INLINE_IMAGE_MAX } = {}) {
  const plan = new Map();
  let spent = 0;
  for (const shot of shots) {
    const id = shot.captureId ?? shot.mediaId ?? shot.id ?? shot;
    const cap = captures[id];
    const dataUrl = cap?.dataUrl || null;
    if (!dataUrl) {
      plan.set(id, { inline: false, bytes: 0, path: cap?.path || null, missing: true });
      continue;
    }
    const cost = dataUrl.length;
    if (cost <= max && spent + cost <= budget) {
      spent += cost;
      plan.set(id, { inline: true, dataUrl });
    } else {
      plan.set(id, { inline: false, bytes: decodedBytes(dataUrl), path: cap?.path || null });
    }
  }
  return plan;
}

/** One line saying where a picture is, when the document is not carrying it. */
export function describeOmitted(entry, ordinal) {
  if (entry?.missing) return '_(image not exported)_';
  const size = entry?.bytes ? `${Math.round(entry.bytes / 1024)} KB` : 'the full size';
  // r9-11-6: each path segment is percent-encoded and parentheses escaped, so a space, a bracket or an Arabic name cannot break the link.
  if (entry?.path) return `[Screenshot ${ordinal}](${String(entry.path).split('/').map((x) => encodeURIComponent(x).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')}) is saved beside this document (${size}).`;
  return `_Screenshot ${ordinal} is saved beside this document, under Screenshots (${size}). It is named here rather than embedded, so this file stays small enough to open._`;
}


/* ------------------------------------------------------ SBTM session sheet (8) */

/**
 * Session-Based Test Management session sheet.
 *
 * The discipline that makes unscripted testing auditable: a charter, a time-box,
 * and a log of what was actually covered. That is what a regulated or government
 * client needs from exploratory work — evidence, not just a bug list.
 *
 * Section names follow the classic Bach session sheet so it is recognisable to
 * anyone who already runs SBTM.
 */

/** Bach's duration bands. */
/* `buildMarkdown`, `buildJson` and `buildSessionSheet` live in `core/artifact-docs.js` (8 Sept 2026): only the offscreen export reaches them, and this module is in the worker's boot graph. `describeDom()` stays here. */

export function durationBand(minutes) {
  if (minutes <= 30) return 'short';
  if (minutes <= 60) return 'normal';
  return 'long';
}

/** Distinct pages actually visited — the coverage claim, derived not asserted. */
export function areasCovered(events) {
  const seen = new Map();
  for (const ev of events) {
    const raw = ev.kind === 'nav' ? ev.url : ev.frameUrl;
    if (!raw) continue;
    try {
      const u = new URL(raw);
      const key = u.origin + u.pathname;
      seen.set(key, (seen.get(key) || 0) + 1);
    } catch {
      /* not a parseable URL */
    }
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url, hits]) => ({ url, hits }));
}


/* ------------------------------------------------- Playwright spec generation */

export function esc(s) {
  // Everything that could end a JS string literal early: line terminators (LF, CR, U+2028/2029)
  // and the other C0 controls. A value with a newline must not break the spec or inject a line.
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, (c) =>
      c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
    );
}

/** Text for a `//` comment: one line, no control characters, clamped. */
function cmt(s, max = 200) {
  return clampLabel(String(s ?? '').replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' '), max);
}

/** The control a `change` event came from: the recorder's `control`, else inferred (old sessions). */
function controlOf(ev) {
  if (ev.control) return String(ev.control).toLowerCase();
  if (String(ev.tag || '').toLowerCase() === 'select') return 'select';
  if (ev.value === 'checked' || ev.value === 'unchecked') return 'checkbox';
  return 'text';
}

/** A recorded locator is already Playwright source (e.g. `getByRole('button', ...)`). */
const UNSAFE = '// SKIPPED: unsafe locator';
function locatorExpr(ev) {
  /* r2-02-1: the output re-checks what ingest checked, because an imported session never passed through ingest. */
  if (!safePrefix(ev.framePrefix) || (ev.locator && !safeLocator(ev.locator))) return UNSAFE;
  if (ev.locator) return `page.${ev.framePrefix || ''}${ev.locator}`;
  if (ev.selector) return `page.${ev.framePrefix || ''}locator('${esc(ev.selector)}')`;
  return null;
}

/** r1-11-4: an environment-variable name from a field's label: ASCII upper-case, one underscore between runs, never empty. */
function secretName(label) {
  const base = String(label ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return base || 'FIELD';
}

/** r1-11-2: a navigation the preceding click or submit caused, which the click already replays. */
const CAUSED = /^(link|form_submit)$/;
const redirected = (ev) => (ev.qualifiers || []).some((q) => q === 'server_redirect' || q === 'client_redirect');

/** r1-11-3: the picked element's expectation as Playwright source, or null when the copied locator is not a single safe line. */
function assertionLine(ev, pg = 'page') {
  const raw = String(ev.copied ?? '');
  if (/^page\./.test(raw) && !safeLocator(raw.slice(5))) return `  ${UNSAFE}`;
  const loc = pg + raw.slice(4); // the page variable of the tab the pick was made in (r3-11-1)
  if (!/^page\./.test(raw) || /[\r\n\u2028\u2029]/.test(raw)) return null;
  const text = ev.maskedSource ? '' : String(ev.expected?.text ?? '');
  if (text) {
    // The recorder keeps 80 characters; a full-length string is a prefix, not the whole text.
    return text.length >= 80 ? `  await expect(${loc}).toContainText('${esc(text)}');` : `  await expect(${loc}).toHaveText('${esc(text)}');`;
  }
  return ev.expected?.visible ? `  await expect(${loc}).toBeVisible();` : `  await expect(${loc}).toBeAttached();`;
}

/** r10-05-1: click options: the button, then the held `modifiers`. */
const clickOpts = (ev, btn) => {
  const m = (Array.isArray(ev.mods) ? ev.mods : []).filter((x) => /^(Control|Shift|Alt|Meta)$/.test(x));
  const o = [btn, m.length && `modifiers: ['${m.join("', '")}']`].filter(Boolean);
  return o.length ? `{ ${o.join(', ')} }` : '';
};

/** r9-05-3: an Enter or Space keydown followed by a click on the same element within 50 ms is the click's own cause, so the click stays and the keydown goes. */
function foldKeyClicks(events) {
  const key = (x) => x.locator || x.selector;
  const drop = new Set();
  events.forEach((e, i) => {
    if (e.kind !== 'dom' || e.action !== 'keydown' || (e.key !== 'Enter' && e.key !== 'Space') || !key(e)) return;
    for (let j = i + 1; j < events.length && !(events[j].ts - e.ts > 50); j++) {
      if (events[j].kind === 'dom' && events[j].action === 'click' && key(events[j]) === key(e)) { drop.add(i); break; }
    }
  });
  return drop.size ? events.filter((_, i) => !drop.has(i)) : events;
}

export function buildPlaywrightSpec(session, events) {
  events = dropDoubleSubmits(foldKeyClicks(events)); // r2-05-2, r9-05-3
  // D-1010-47: a step the page's own script performed (trusted === false) is evidence in the log, never a replayed action.
  const scripted = events.filter((e) => e.kind === 'dom' && e.trusted === false).length;
  if (scripted) events = events.filter((e) => e.trusted !== false);
  const L = [];
  const title = (session.charter || 'recorded session').replace(/'/g, '');

  // Signed, and said to be generated. A file that looks hand-written gets
  // edited without anyone realising it can be regenerated; one that looks
  // untouchable gets abandoned. The header says both.
  // A comment banner: the only channel a source file has, and one that never
  // interferes with the code below it.
  L.push(embed.code({ session, kind: 'playwright-spec' }));
  L.push('');
  L.push("import { test, expect } from '@playwright/test';");
  L.push('');
  const testAt = L.length;
  L.push(`test('${esc(title)}', async ({ page }) => {`);

  let wrote = false;
  let cause = null; // the click or submit whose navigation the page performs on its own
  let asserted = 0;
  const secrets = new Map(); // locator expression -> env var name (r1-11-4)
  // r3-11-1: one page variable per recorded tab. A tab the previous click opened is `context.waitForEvent('page')`
  // wrapped around that click; a tab with no known opener is a FIXME and its steps are skipped.
  let cur = 'page'; // the page variable of the tab being replayed
  let curTab = null;
  let opener = null; // the last click: { tab, i: its line in L, expr }
  let usesContext = false;
  const tabs = new Map(); // tabId -> page variable
  const skipTabs = new Set();

  // A session started on an already-open page records no navigation, which would
  // leave the spec with nowhere to go. Seed the entry point from the session.
  const firstAction = events.find((e) => e.kind === 'nav' || e.kind === 'dom');
  if (firstAction?.kind !== 'nav' && session.startUrl) {
    L.push(`  await page.goto('${esc(session.startUrl)}');`);
    wrote = true;
  }

  for (const ev of events) {
    if (ev.tabId != null && (ev.kind === 'nav' || ev.kind === 'dom' || (ev.kind === 'selectorcopy' && ev.intent === 'assert'))) {
      if (curTab == null) { curTab = ev.tabId; tabs.set(curTab, 'page'); }
      else if (ev.tabId !== curTab) {
        if (skipTabs.has(ev.tabId)) continue;
        if (tabs.has(ev.tabId)) {
          cur = tabs.get(ev.tabId);
          curTab = ev.tabId;
          L.push(`  await ${cur}.bringToFront();`);
        } else if (opener && opener.tab === curTab && opener.i === L.length - 1) {
          cur = `page${tabs.size + 1}`;
          tabs.set(ev.tabId, cur);
          curTab = ev.tabId;
          usesContext = true;
          L[opener.i] = `  const [${cur}] = await Promise.all([context.waitForEvent('page'), ${opener.expr}]);`;
          opener = null;
        } else {
          skipTabs.add(ev.tabId);
          L.push('  // FIXME: actions in a second tab were skipped: the click that opened it was not recorded.');
          continue;
        }
      }
    }
    if (ev.kind === 'selectorcopy' && ev.intent === 'assert') {
      // r1-11-3: only what the tester picked with Ctrl+Shift+click becomes an assertion.
      const line = assertionLine(ev, cur);
      if (line) { L.push(line); if (!line.startsWith('  //')) { asserted += 1; wrote = true; } }
      continue;
    }
    if (ev.kind === 'nav') {
      const q = ev.qualifiers || [];
      // r1-11-2: back/forward and reload are replayed as themselves, not as a goto that would drop the page's state.
      if (wrote && (ev.transition === 'reload' || q.includes('forward_back'))) {
        L.push(ev.transition === 'reload' ? `  await ${cur}.reload();` : `  await ${cur}.goBack();`);
        cause = null;
        continue;
      }
      // A route change (pushState, hash) has no new document; a link or form the preceding click or submit
      // caused loads by itself when that click replays. Replaying either as a goto drops the state in between.
      if (wrote && (ev.route || (cause && (CAUSED.test(ev.transition || '') || redirected(ev))))) continue;
      cause = null;
      // Skip a navigation only when the statement just before it is the very same
      // goto (the seeded entry point). A return to an earlier page, A then B then
      // A, is a real navigation and stays (council-1009 r3-11-2).
      const gotoLine = `  await ${cur}.goto('${esc(ev.url)}');`;
      const prev = [...L].reverse().find((l) => !l.startsWith('  //'));
      if (wrote && prev === gotoLine) continue;
      L.push(gotoLine);
      wrote = true;
      continue;
    }
    if (ev.kind !== 'dom') continue;
    cause = (ev.action === 'click' && ev.button !== 2) || ev.action === 'dblclick' || ev.action === 'submit' ? ev : null;

    const expr0 = locatorExpr(ev);
    if (!expr0) continue;
    if (expr0 === UNSAFE) { L.push(`  ${UNSAFE}`); continue; }
    const expr = cur === 'page' ? expr0 : cur + expr0.slice(4);

    /**
     * "Matched several" and "matched none" are different problems.
     *
     * They used to be collapsed into one warning, and then the statement was
     * emitted regardless — so a spec came out with seven FIXMEs and locators
     * that could not match anything, which is a file that cannot run. An
     * independent field test found one built from a validation banner: a
     * `getByRole('form', { name: 'Epic sadface: Username is required' })`,
     * named after a message that only exists while the error is on screen, so
     * it can never match on the clean run when the test would actually execute.
     *
     * Ambiguous needs a person to choose. Matched-nothing is simply wrong —
     * and the recorder already stored a CSS selector that *was* right at
     * capture time, so there is something better to emit.
     */
    let use = expr;
    if (ev.locatorMatches === 0) {
      if (ev.selector) {
        L.push('  // NOTE: the generated locator matched nothing at capture time;');
        L.push('  // falling back to the CSS selector that did. Replace with a role or a test id.');
        use = `${cur}.${safePrefix(ev.framePrefix) ? ev.framePrefix || '' : ''}locator('${esc(ev.selector)}')`;
      } else {
        L.push(
          `  // SKIPPED: nothing matched this element when recorded, ` +
            `${cmt(ev.action, 40)} on ${cmt(ev.label || ev.tag || 'element', 80)}`
        );
        continue;
      }
    } else if (ev.locatorAmbiguous) {
      L.push(`  // FIXME: locator matched ${ev.locatorMatches} elements when recorded. Disambiguate.`);
    }

    switch (ev.action) {
      case 'click': {
        const opt = clickOpts(ev, ev.button === 2 ? "button: 'right'" : ev.button === 1 ? "button: 'middle'" : '');
        L.push(`  await ${use}.click(${opt});`);
        opener = { tab: curTab, i: L.length - 1, expr: `${use}.click(${opt})` };
        break;
      }
      case 'dblclick':
        L.push(`  await ${use}.dblclick(${clickOpts(ev, '')});`);
        break;
      case 'input':
      case 'change':
        if (ev.masked) {
          // The real value was never captured. Filling the mask would just type
          // bullet characters into the field, so make the gap explicit instead.
          // r1-11-4: one variable per masked field (password, confirm and OTP differ); UQA_SECRET stays as the old shared fallback.
          if (!secrets.has(use)) {
            const base = `QAW_SECRET_${secretName(stepLabel(ev) || ev.label || ev.tag)}`;
            let name = base;
            for (let n = 2; [...secrets.values()].includes(name); n += 1) name = `${base}_${n}`;
            secrets.set(use, name);
          }
          const envName = secrets.get(use);
          L.push(`  // FIXME: secret field. Set ${envName} (or UQA_SECRET for every secret field); the value was never recorded.`);
          L.push(`  await ${use}.fill(process.env.${envName} ?? process.env.UQA_SECRET ?? '');`);
        } else if (['range', 'color'].includes(controlOf(ev))) { // D-1010-174: Playwright refuses fill() on these; set the value and fire the events the page listens to
          L.push(`  await ${use}.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, '${esc(ev.value ?? '')}');`);
        } else if (ev.action === 'change' && ['checkbox', 'radio', 'select', 'select-multiple'].includes(controlOf(ev))) {
          const c = controlOf(ev);
          if (c === 'select-multiple') L.push(`  await ${use}.selectOption([${String(ev.value ?? '').split('\n').filter(Boolean).map((v) => `{ label: '${esc(v)}' }`).join(', ')}]);`);
          else if (c === 'select') L.push(`  await ${use}.selectOption({ label: '${esc(ev.value ?? '')}' });`);
          else if (c === 'checkbox' && ev.value === 'unchecked') L.push(`  await ${use}.uncheck();`);
          else L.push(`  await ${use}.check();`);
        } else {
          L.push(`  await ${use}.fill('${esc(ev.value ?? '')}');`);
        }
        break;
      case 'upload':
        if (ev.control === 'drop') { // D-1010-87: a drop has no file input to fill, so no setInputFiles
          L.push(`  // FIXME: dropped '${esc(ev.value ?? '')}' onto this element when recorded. Replay the drop with a DataTransfer, or use the page's own file input.`);
          break;
        }
        L.push(`  // FIXME: uploaded '${esc(ev.value ?? '')}' when recorded. Point this at a fixture file.`);
        L.push(`  await ${use}.setInputFiles(process.env.UQA_UPLOAD_FILE ?? '');`);
        break;
      case 'keydown':
        L.push(`  await ${use}.press('${esc(ev.key)}');`);
        break;
      case 'submit':
        L.push(`  await ${use}.press('Enter');`);
        break;
      default:
        continue;
    }
    wrote = true;
  }

  if (!events.some((e) => e.kind === 'dom')) {
    L.push('  // No replayable interactions were recorded.');
  }
  if (scripted) L.push(`  // ${scripted} step${scripted === 1 ? '' : 's'} the page performed by its own script ${scripted === 1 ? 'was' : 'were'} left out (D-1010-47).`);
  if (usesContext) L[testAt] = L[testAt].replace('({ page })', '({ page, context })');
  // r1-11-3: a spec asserts only what the tester picked; with no pick it says so rather than pass vacuously in silence.
  if (!asserted) L.push('  // No assertions: nothing was picked as an expected outcome (Ctrl+Shift+click an element to add one).');

  const seenFp = new Set();
  const failures = events.filter((e) => liteProblem(e) && !seenFp.has(liteFp(e)) && seenFp.add(liteFp(e)));
  if (failures.length) {
    L.push('');
    L.push(`  // The recorded session ended with ${failures.length} problem${failures.length === 1 ? '' : 's'}:`);
    failures.forEach((f) =>
      L.push(`  //   ${cmt(f.kind === 'net' ? `${f.method} ${f.url} → ${f.error ? 'error' : f.status}` : f.text)}`)
    );
  }

  L.push('});');
  L.push('');
  return L.join('\n');
}
