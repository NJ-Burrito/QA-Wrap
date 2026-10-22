/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The only check that means anything about a generated test plan: does it go RED?
 *
 * Every other gate in this tree reads source. A plan whose steps are all actions
 * and no checks passes all of them and still produces a suite that is green
 * whatever the application does — which is the failure research/135 objection 3
 * names, and the reason `report.selcopy.health.noAsserts` exists.
 *
 * So this one runs a browser. It builds a plan from a synthetic session against
 * a real page, lifts the `- expect:` bullets back out of the markdown, turns
 * them into Playwright assertions, and runs them twice:
 *
 *   against the page as recorded    -> must pass
 *   against the page with one thing broken -> must fail
 *
 * The second half is the whole test. A check that cannot fail is not a check,
 * and neither is a test plan that cannot produce one.
 *
 *   node tools/test-plan-run.mjs
 *
 * Chromium comes from the tree's own `@playwright/test`. If it is not installed
 * this exits 0 with a printed reason rather than failing a suite over a missing
 * browser — the source gates still hold on a machine with no Chromium.
 */
import assert from 'node:assert/strict';
import { buildTestPlan } from '../core/locatorplan.js';

const T0 = Date.parse('2026-09-20T09:00:00Z');

/** The page under test, with one switch: what the confirmation heading says. */
const fixture = (heading) => `data:text/html,${encodeURIComponent(`
  <!doctype html><meta charset="utf-8"><title>Permit</title>
  <main>
    <label for="u">User</label><input id="u">
    <button id="go">Submit</button>
    <h1>${heading}</h1>
  </main>`)}`;

const session = {
  id: 'plan-run',
  charter: 'Apply for a permit',
  startUrl: 'https://example.gov/apply',
  startedAt: T0,
  masked: 0,
};

const events = [
  {
    kind: 'selectorcopy', ts: T0 + 1000, frameUrl: 'https://example.gov/apply',
    copied: "page.getByLabel('User')", tag: 'input', role: 'textbox', text: 'User',
  },
  {
    kind: 'selectorcopy', ts: T0 + 2000, frameUrl: 'https://example.gov/apply',
    copied: "page.getByRole('heading')", tag: 'h1', role: 'heading', text: 'Thanks',
    intent: 'assert', expected: { visible: true, text: 'Thanks, your permit is approved' },
  },
];

/**
 * The bullets, back out of the plan.
 *
 * Read from the generated markdown rather than from the events, because the
 * markdown is what the agent is handed: if a bullet is lost between the pick
 * and the file, this must not quietly assert on the pick instead.
 */
function expectedTexts(md) {
  return [...md.matchAll(/- expect: .*contains the text “([^”]+)”/g)].map((m) => m[1]);
}

async function run() {
  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    console.log('No @playwright/test in this tree — skipped, and the source gates still ran.');
    return 0;
  }

  const md = buildTestPlan(session, events);
  const texts = expectedTexts(md);
  assert.ok(texts.length, 'the plan carried no expected text at all, so nothing here can fail');

  const browser = await chromium.launch();
  let green;
  let red;
  try { // r10-12-3: from launch to close, so an assertion or a navigation error never leaves a Chromium running
    const page = await browser.newPage();

    /** The generated check, run against one version of the page. */
    const check = async (heading) => {
      await page.goto(fixture(heading));
      for (const want of texts) {
        const body = await page.locator('body').innerText();
        if (!body.includes(want)) return false;
      }
      return true;
    };

    green = await check('Thanks, your permit is approved');
    red = await check('Sorry, something went wrong');
  } finally {
    await browser.close();
  }

  let failures = 0;
  const test = (name, ok) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) failures += 1;
  };

  test('the plan passes against the page it was recorded from', green === true);
  test('the plan FAILS when the page stops doing what the tester expected', red === false);

  console.log(`\n${2 - failures} passed, ${failures} failed`);
  return failures ? 1 : 0;
}

process.exit(await run());
