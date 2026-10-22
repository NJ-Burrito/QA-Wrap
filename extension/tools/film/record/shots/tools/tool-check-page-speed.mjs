/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Check page speed. Bible §10.3, six bars, Simple mode. */
import { session, frameRow, reportOn } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); },
  shots: {
    1: {
      setup: async (t) => { await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' }); },
      take: async (t) => {
        await t.until(0.2);
        await t.fillForm(t.stage);
        await t.frame();
        await t.stage.locator('#quantity').hover().catch(() => {});
        await t.hold(1.0);
      },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'perf'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="perf"]');
        await t.hold(1.4);
      },
    },
    3: {
      take: async (t) => { await t.until(0.2); await t.hold(3.1); },
    },
    4: {
      setup: async (t) => { await t.wait(1200); await reportOn(t, 'quality', '.block'); },
      take: async (t) => { await t.until(0.2); await t.hold(1.5); },
    },
  },
};
