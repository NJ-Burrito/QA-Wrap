/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The walk, as a Playwright **test plan** — the format the agent already reads.
 *
 * `core/locatorset.js` answers "where are the elements" in a schema of our own.
 * That was written for an imaginary agent. The real one (Nader, 20 Sept 2026)
 * is Claude Code in VS Code driving `playwright-cli`, and that toolchain has a
 * documented authoring workflow — Plan, Generate, Heal — whose **input** is a
 * markdown spec at `specs/<feature>.plan.md` plus a minimal `tests/seed.spec.ts`
 * (microsoft/playwright-cli, `skills/playwright-cli/references/test-generation.md`,
 * retrieved 2026-09-20). Its Generate stage opens the real page, takes a
 * snapshot and derives its own refs.
 *
 * Two consequences, and they are the whole design of this file:
 *
 *   1. **Our locators are not the payload.** The agent will re-derive them from
 *      the live page whatever we ship, and a stale `css` path handed to it is
 *      worse than none — it invites code nobody watched fail. They are included
 *      once, as a hint per step, never as the instruction.
 *   2. **The tester's intent is the payload.** Walk order, what was acted on,
 *      what was supposed to happen, what is redacted and what needs a secret.
 *      None of it is on the page; all of it is in the session.
 *
 * `- expect:` bullets become the assertions at Generate time. That is why
 * `content/picker.js`'s Ctrl+Shift+click exists: a plan with no expect bullets
 * produces a test that runs green for ever and catches nothing, and this file
 * says so out loud in the plan rather than quietly emitting a click macro.
 *
 * Privacy rides along exactly as it does in `locatorset.js`: a pick whose
 * source was masked never reaches this file's output, and `text` is re-checked
 * with `hasSensitive()` for sessions recorded before that guard shipped.
 */
import { hasSensitive } from './privacy.js';
import { actionsForPick } from './action-join.js';

import { fence, FENCE_NOTE } from './fence.js';
import { fenceFor } from './docshell.js';
import { esc } from './artifact.js';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const unsafe = (text) => { try { return hasSensitive(String(text ?? '')); } catch { return false; } };

/** `Add to cart` -> `add-to-cart`. The plan format names files in kebab case. */
export function kebab(s) {
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'scenario';
}

/** The picks this plan is built from: the tester's curation, in walk order, minus anything covered. */
function picksOf(events) {
  return events
    .filter((e) => e.kind === 'selectorcopy')
    .filter((e) => !e.maskedSource && !unsafe(e.text))
    .sort((a, b) => a.ts - b.ts);
}

/** Origin+path, which is what a scenario group is: one page of the flow. */
function pageOf(ev) {
  try {
    const u = new URL(ev.frameUrl);
    return { url: u.origin + u.pathname, label: u.pathname || '/' };
  } catch {
    return { url: '', label: 'the page' };
  }
}

/** Consecutive picks on the same page, in walk order — never regrouped or re-sorted. */
function groupByPage(picks) {
  const groups = [];
  for (const ev of picks) {
    const page = pageOf(ev);
    const last = groups[groups.length - 1];
    if (last && last.url === page.url) last.picks.push(ev);
    else groups.push({ url: page.url, label: page.label, picks: [ev] });
  }
  return groups;
}

/** What the element is called in a sentence a human wrote, not a selector. */
function nameOf(ev, n) {
  // The label first: a form field has no text of its own, and "the textbox"
  // four times in a row is a plan nobody can follow.
  // T-043 (G04): the index, the role and 24 characters of the label; the rest sits in the sheet's data table.
  const text = fence(clean(ev.label) || clean(ev.text), 24);
  const role = fence(clean(ev.role) || clean(ev.tag) || 'element', 24);
  const at = n ? `[${n}] ` : '';
  return text ? `${at}the ${role} “${text}”` : `${at}the ${role}`;
}

/**
 * One step, in the plan's own voice: a user-level instruction, never code.
 *
 * The verb comes from `action-join.js` — what the recorder saw the tester
 * actually do to this element during the walk. A pick with no action was made
 * to look at, not to act on, and says so rather than inventing a click.
 */
function stepFor(ev, events, n) {
  const actions = actionsForPick(ev, events) || [];
  const cred = ev.credRef?.name;
  if (cred) return `Fill ${nameOf(ev, n)} with the value of the \`${cred}\` environment variable`;
  if (ev.purpose === 'sensitive') {
    return `Fill ${nameOf(ev, n)} with a value read from the environment. It is sensitive: never write a literal into the test`;
  }
  if (actions.includes('input')) return `Type into ${nameOf(ev, n)}`;
  if (actions.includes('submit')) return `Submit from ${nameOf(ev, n)}`;
  if (actions.includes('click')) return `Click ${nameOf(ev, n)}`;
  return `Find ${nameOf(ev, n)}`;
}

/** The expect bullets for an assert pick — the only assertions in this file that a person authored. */
function expectsFor(ev, n) {
  const out = [];
  const text = fence(ev.expected?.text);
  if (ev.expected?.visible !== false) out.push(`${nameOf(ev, n)} is visible`);
  if (text) out.push(`${nameOf(ev, n)} contains the text “${text}”`);
  return out;
}

/**
 * The seed test: the fresh state every scenario starts from.
 *
 * Minimal on purpose — the plan format's own example is three lines. Anything
 * more (a login, a fixture) is a decision the agent makes with the credential
 * names this plan hands it, not one this file can make from a recording.
 */
export function buildSeedSpec(session) {
  return [
    "import { test } from '@playwright/test';",
    '',
    "test('seed', async ({ page }) => {",
    `  await page.goto('${esc(session.startUrl || '/')}');`,
    '});',
    '',
  ].join('\n');
}

export function buildTestPlan(session, events) {
  const picks = picksOf(events);
  const groups = groupByPage(picks);
  const asserts = picks.filter((p) => p.intent === 'assert');
  const creds = [...new Set(picks.map((p) => p.credRef?.name).filter(Boolean))];
  const masked = Number(session.masked || 0);
  const feature = clean(session.charter) || 'Recorded flow';

  const L = [];
  L.push(`# ${feature} Test Plan`);
  L.push('');
  L.push('## Application Overview');
  L.push('');
  L.push(
    `A tester walked this flow by hand and picked the elements the automation should touch, in the order ` +
    `they picked them. That order is the navigation: follow it, do not re-derive it and do not reorder it. ` +
    `The flow starts at ${session.startUrl || 'the application'} and covers ` +
    `${groups.length} page${groups.length === 1 ? '' : 's'} with ${picks.length} picked element` +
    `${picks.length === 1 ? '' : 's'}.`
  );
  L.push('');
  L.push(
    'Derive locators yourself from a live snapshot; the ones quoted under each step are what the picker ' +
    'saw at capture time and are a hint, not an instruction. A step marked `ambiguous` matched more than ' +
    'one element on the page when it was picked, so disambiguate it before you rely on it.'
  );
  L.push('');
  L.push(`${FENCE_NOTE} Element names in the steps are the page's words, cut short; \`[3]\` is the pick's number in the locator sheet.`);
  L.push('');

  if (!asserts.length) {
    L.push(
      '> **No expected outcomes were recorded.** Every step below is an action and none of them is a check, ' +
      'so a suite generated from this plan as it stands will pass whatever the application does. Ask the ' +
      'tester to re-walk the flow picking outcomes as Elements (key 3 in the picker), or write the `expect:` ' +
      'bullets yourself and have them reviewed before anyone trusts a green run.'
    );
    L.push('');
  }

  if (creds.length) {
    L.push('**Credentials.** These names carry no values and never will. Read each one from the environment ' +
      'and fail loudly when it is unset:');
    L.push('');
    for (const name of creds) L.push(`- \`process.env.${name}\``);
    L.push('');
  }

  if (masked) {
    L.push(
      `**Redacted.** ${masked} element${masked === 1 ? ' was' : 's were'} masked by hand during this walk and ` +
      'every locator built from one was withheld from this plan. Those regions hold real data: do not assert ' +
      'on their text, and do not treat their absence here as a gap in the flow.'
    );
    L.push('');
  }

  L.push('## Test Scenarios');
  L.push('');

  if (!groups.length) {
    L.push('No elements were picked during this session, so there is nothing to generate. Walk the flow with ' +
      'the locator picker first.');
    L.push('');
  }

  groups.forEach((group, gi) => {
    const n = gi + 1;
    L.push(`### ${n}. ${group.label}`);
    L.push('');
    L.push('**Seed:** `tests/seed.spec.ts`');
    L.push('');
    const slug = kebab(`${feature} ${group.label}`);
    L.push(`#### ${n}.1. ${slug}`);
    L.push('');
    L.push(`**File:** \`tests/${kebab(group.label)}/${slug}.spec.ts\``);
    L.push('');
    L.push('**Steps:**');
    if (group.url && group.url !== session.startUrl) {
      L.push(`  1. Go to ${group.url}`);
    }
    let step = group.url && group.url !== session.startUrl ? 1 : 0;
    for (const ev of group.picks) {
      step += 1;
      const n = picks.indexOf(ev) + 1;
      L.push(`  ${step}. ${stepFor(ev, events, n)}`);
      if (ev.intent === 'assert') {
        for (const line of expectsFor(ev, n)) L.push(`    - expect: ${line}`);
      }
      const hint = clean(ev.copied);
      if (hint) L.push(`    - locator seen at capture: \`${hint}\`${ev.ambiguous ? ' (ambiguous)' : ''}`);
    }
    L.push('');
  });

  L.push('## Seed test');
  L.push('');
  L.push('Write this to `tests/seed.spec.ts` before generating:');
  L.push('');
  const seed = buildSeedSpec(session).trimEnd(), f = fenceFor(seed);
  L.push(f + 'ts', seed, f);
  L.push('');
  return L.join('\n');
}

/* ───────────────────────────────────────────────── the locator sheet ────── */

/**
 * The order a script author reads the purposes in, and what each heading tells
 * the agent to DO with what is under it. `content/picker.js#PURPOSES` is where
 * the tester says which; a session from before purposes existed lands in `any`.
 */
const SHEET_PURPOSES = [
  ['step', 'Steps of the flow',
    'What the flow does, in the order the tester walked it. This order is the navigation: follow it, do not reorder it.'],
  ['element', 'Elements to account for',
    'What the script must check once it gets there. Each one carries how it looked when it was picked: turn that into an assertion.'],
  ['sensitive', 'Sensitive values',
    'Where a value goes that must never be written down. Read it from the environment and fail loudly when it is unset. The element\'s own words were withheld at capture, on purpose.'],
  ['any', 'Uncategorised',
    'Picked with no purpose said. A locator and nothing more; ask before building on one.'],
];

const purposeOf = (ev) => (SHEET_PURPOSES.some(([id]) => id === ev.purpose) ? ev.purpose : 'any');
const code = (s) => `\`${String(s).replace(/`/g, '\\`')}\``;

/** "+mm:ss" from session start — the clock the report's walk map uses. */
function offsetOf(ts, start) {
  const s = Math.max(0, Math.round((ts - start) / 1000));
  return `+${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Every picked locator, as a markdown reference sheet sorted by purpose.
 *
 * `buildTestPlan()` above is the walk as *instructions*: it is what
 * `playwright-cli`'s Plan stage reads. This is the walk as a *reference*: the
 * file an agent keeps open beside the plan, or is handed on its own when the
 * tester wants a script and has no plan to give. Per pick it says what a
 * person calls the element (label), what it is (tag, role), how to find it
 * (id, class, and every locator flavour the picker verified, with its match
 * count), where and when it was picked, what was done to it, and — for the
 * purposes that have one — what was expected of it or which secret it takes.
 *
 * Markdown and not JSON because the reader is a language model being talked
 * to, not a parser: headings carry the purpose, and the instruction for each
 * purpose sits directly above the locators it governs, which is where a model
 * actually applies it. `locatorset.js` is still there for a parser.
 *
 * Same privacy gate as everything else in this file (`picksOf`): a pick whose
 * source was masked is absent, and a sensitive pick arrives with its words
 * already withheld by `content/picker.js`.
 */
export function buildLocatorSheet(session, events) {
  const picks = picksOf(events);
  const feature = clean(session.charter) || 'Recorded flow';
  const L = [];

  L.push(`# ${feature}: Locators`);
  L.push('');
  L.push(
    `${picks.length} element${picks.length === 1 ? '' : 's'} picked by a tester walking this flow by hand, ` +
    `starting at ${session.startUrl || 'the application'}. They are sorted by what the tester said each ` +
    'one was FOR, and numbered in the order they were picked across the whole walk.'
  );
  L.push('');
  L.push('**How to use this with `playwright-cli`.** Open the page, take a `snapshot`, and match each entry ' +
    'below to a ref by its label and role; the locators quoted here were verified against the page when ' +
    'they were picked and are the fallback when a snapshot is ambiguous. Prefer a locator marked `unique`. ' +
    'One marked `matches N` found more than one element at capture time: disambiguate it, do not trust it.');
  L.push('');
  L.push(`${FENCE_NOTE} Every label, text, id and class below is the page's own words.`);
  L.push('');

  const masked = Number(session.masked || 0);
  if (masked) {
    L.push(`**Redacted.** ${masked} element${masked === 1 ? ' was' : 's were'} masked by hand during this ` +
      'walk. Any pick built from one is absent from this file by design: that is not a gap in the flow.');
    L.push('');
  }

  if (!picks.length) {
    L.push('Nothing was picked during this session. Walk the flow with the locator picker first.');
    L.push('');
    return L.join('\n');
  }

  // Numbered once, in walk order, before sorting by purpose: the number is how
  // the agent recovers the navigation from a file that is not in that order.
  const numbered = picks.map((ev, i) => ({ ev, n: i + 1 }));

  for (const [id, title, instruction] of SHEET_PURPOSES) {
    const group = numbered.filter(({ ev }) => purposeOf(ev) === id);
    if (!group.length) continue;
    L.push(`## ${title} (${group.length})`);
    L.push('');
    L.push(instruction);
    L.push('');

    for (const { ev, n } of group) {
      const label = fence(clean(ev.label) || clean(ev.text) || clean(ev.role) || clean(ev.tag)) || 'element';
      L.push(`### ${n}. ${label}`);
      L.push('');
      if (fence(ev.label)) L.push(`- **Label:** ${fence(ev.label)}`);
      L.push(`- **Element:** ${code(`<${ev.tag || 'element'}>`)}${ev.role ? `, role ${code(ev.role)}` : ''}` +
        `${ev.category ? `, kind ${ev.category}` : ''}`);
      if (ev.elementId) L.push(`- **ID:** ${code(`#${fence(ev.elementId)}`)}`);
      if (ev.classes) L.push(`- **Class:** ${code(`.${fence(ev.classes).split(' ').join(' .')}`)}`);
      // A withheld text is a row of bullets, and printing it tells the agent nothing.
      if (clean(ev.text) && clean(ev.text) !== clean(ev.label) && !/^[•\s]+$/.test(ev.text)) L.push(`- **Text:** ${fence(ev.text)}`);

      for (const f of ev.flavours || []) {
        if (!f?.expr) continue;
        const state = f.unique ? 'unique' : f.matches != null ? `matches ${f.matches}` : 'not counted';
        L.push(`- **${f.name}:** ${code(f.expr)} (${state}${f.copied ? ', the one copied' : ''})`);
      }

      const page = pageOf(ev);
      L.push(`- **Page:** ${page.url || page.label} · picked at ${offsetOf(ev.ts, session.startedAt)}`);

      const actions = actionsForPick(ev, events);
      if (actions) L.push(`- **Done to it during the walk:** ${actions.join(' → ')}`);

      if (ev.intent === 'assert' || id === 'element') {
        const want = expectsFor(ev, n);
        if (want.length) L.push(`- **Expected:** ${want.join('; ')}`);
      }
      if (ev.credRef?.name) {
        L.push(`- **Secret:** read ${code(`process.env.${ev.credRef.name}`)}; never a literal`);
      } else if (id === 'sensitive') {
        L.push('- **Secret:** no name was given; choose an environment variable for it, never a literal');
      }
      L.push('');
    }
  }
  return L.join('\n');
}
