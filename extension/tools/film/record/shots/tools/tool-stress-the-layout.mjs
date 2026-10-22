/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Stress the layout. Bible §10.3, six bars, Expert mode. */
import { session, frameRow } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); await t.setMode('expert'); },
  shots: {
    1: {
      setup: async (t) => {
        await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' });
        await t.fillForm(t.stage);
      },
      take: async (t) => {
        await t.until(0.2);
        for (const sel of ['#applicant', '#email', '#quantity', '#country']) {
          await t.stage.locator(sel).hover().catch(() => {});
          await t.frame();
          await t.frame();
        }
      },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'rtl'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="rtl"]');
        await t.hold(1.4);
      },
    },
    3: {
      setup: async (t) => { await t.wait(1200); },
      take: async (t) => { await t.until(0.2); await t.hold(3.1); },
    },
    4: {
      take: async (t) => {
        await t.until(0.2);
        await t.stage.locator('#country').hover().catch(() => {});
        await t.hold(0.7);
        /* Pressed again, and the page goes back: the tool is a toggle and the
           film has to show the way out as well as the way in. */
        await t.click(t.panel, '[data-action="rtl"]');
        await t.hold(0.6);
      },
    },
  },
};
