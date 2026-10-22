/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Mask real data. Bible §10.3, eight bars, Simple mode. */
import { session, frameRow, reportOn } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); },
  shots: {
    1: {
      setup: async (t) => { await t.fillForm(t.stage); },
      take: async (t) => {
        await t.until(0.3);
        for (const sel of ['#applicant', '#email']) {
          await t.stage.locator(sel).hover().catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
        }
      },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'mask'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="mask"]');
        await t.hold(0.6);
      },
    },
    3: {
      take: async (t) => {
        await t.until(0.4);
        await t.pickOnPage(t.stage, '#applicant');
        await t.until(1.4);
        await t.armMask();
        await t.until(1.9);
        await t.pickOnPage(t.stage, '#email');
        await t.hold(0.3);
      },
    },
    4: {
      take: async (t) => {
        await t.until(0.3);
        await t.stage.reload({ waitUntil: 'domcontentloaded' });
        await t.stage.waitForFunction(() => document.querySelectorAll('[data-uqa-masked]').length >= 2, undefined, { timeout: 8000 });
        await t.hold(1.0);
      },
    },
    5: {
      setup: async (t) => { await reportOn(t, null, '#masked-block'); },
      take: async (t) => { await t.until(0.2); await t.hold(3.2); },
    },
  },
};
