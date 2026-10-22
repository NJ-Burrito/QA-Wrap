/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Break a request. Bible §10.3, eight bars, Expert mode. */
import { session, openPanel, frameRow, typeOverFrames } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); await t.setMode('expert'); },
  shots: {
    1: {
      setup: async (t) => {
        t.fixture.succeed();
        await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' });
        await t.fillForm(t.stage);
      },
      take: async (t) => {
        /* It submits happily, twice, which is the problem. */
        await t.until(0.2);
        await t.click(t.stage, '#submit');
        await t.hold(0.6);
        await t.click(t.stage, '#submit');
        await t.hold(0.4);
      },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'break'); },
      take: async (t) => {
        await t.until(0.3);
        await openPanel(t, 'break', 'break-panel', 'break-toggle');
        await t.hold(1.0);
      },
    },
    3: {
      take: async (t) => {
        await t.until(0.15);
        /*
         * The value walks all ten faults, not an open list.
         *
         * A native select draws its list in an operating-system popup, which
         * no page raster can contain. So the control is stepped through every
         * option it has, one visible value at a time, and the storyboard
         * asserts all ten are there.
         */
        const options = await t.panel.locator('#break-preset option').evaluateAll((els) => els.map((e) => e.value));
        await t.panel.locator('#break-preset').focus();
        for (const value of options) {
          await t.panel.selectOption('#break-preset', value).catch(() => {});
          await t.frame();
          await t.frame();
        }
        await t.panel.selectOption('#break-preset', '500').catch(() => {});
        await t.hold(0.3);
      },
    },
    4: {
      take: async (t) => {
        await t.until(0.15);
        await typeOverFrames(t, t.panel, '#break-pattern', '/api/applications');
        await t.until(2.0);
        await t.click(t.panel, '#break-arm');
        await t.hold(0.6);
      },
    },
    5: {
      setup: async (t) => {
        t.fixture.fail();
        await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' });
        await t.fillForm(t.stage);
      },
      take: async (t) => {
        await t.until(0.4);
        await t.click(t.stage, '#submit', { failure: true });
        await t.stage.waitForFunction(() => /went wrong/.test(document.getElementById('note').textContent), undefined, { timeout: 6000 });
        await t.hold(1.5);
      },
    },
  },
};
