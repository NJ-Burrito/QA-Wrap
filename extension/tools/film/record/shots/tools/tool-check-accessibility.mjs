/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Check accessibility. Bible §10.3, eight bars, Simple mode. */
import { session, frameRow, reportOn } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); },
  shots: {
    1: {
      setup: async (t) => { await t.fillForm(t.stage); await t.stage.locator('#applicant').focus(); },
      take: async (t) => {
        /* The keyboard walk, and the control focus skips: the fixture's
           reference field has no label, which is one of its three declared
           faults, so this is the real thing and not a staged one. */
        await t.until(0.2);
        for (let i = 0; i < 6; i++) {
          await t.stage.keyboard.press('Tab');
          await t.frame();
          await t.frame();
          await t.frame();
        }
      },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'a11y'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="a11y"]');
        await t.hold(1.2);
      },
    },
    3: {
      take: async (t) => { await t.until(0.2); await t.hold(2.6); },
    },
    4: {
      setup: async (t) => { await t.wait(1500); },
      take: async (t) => {
        await t.until(0.2);
        await t.panel.locator('.tool-row[data-tool="a11y"] .tool-info').click().catch(() => {});
        await t.hold(2.4);
      },
    },
    5: {
      setup: async (t) => {
        await t.panel.locator('.tool-row[data-tool="a11y"] .tool-info').click().catch(() => {});
        await t.wait(300);
        await reportOn(t, 'quality', '.block');
      },
      take: async (t) => { await t.until(0.2); await t.hold(3.2); },
    },
  },
};
