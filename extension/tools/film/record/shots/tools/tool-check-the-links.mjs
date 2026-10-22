/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Check the links. Bible §10.3, six bars, Expert mode. */
import { session, frameRow, reportOn } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); await t.setMode('expert'); },
  shots: {
    1: {
      setup: async (t) => { await t.stage.evaluate(() => window.scrollTo(0, 0)); },
      take: async (t) => {
        /* Help and Status answer; Downloads is the fixture's declared dead
           link, so the count this film shows is a count of real faults. */
        await t.until(0.2);
        for (const text of ['Help', 'Status', 'Downloads']) {
          await t.stage.locator(`header a:has-text("${text}")`).hover().catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
        }
      },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'links'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="links"]');
        await t.hold(1.4);
      },
    },
    3: {
      take: async (t) => { await t.until(0.2); await t.hold(3.1); },
    },
    4: {
      setup: async (t) => { await t.wait(2000); await reportOn(t, 'quality', '.block'); },
      take: async (t) => { await t.until(0.2); await t.hold(1.5); },
    },
  },
};
