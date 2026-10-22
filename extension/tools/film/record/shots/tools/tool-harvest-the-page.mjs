/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Harvest the page. Bible §10.3, eight bars, Expert mode. */
import { session, frameRow, reportOn, scrollOverFrames } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); await t.setMode('expert'); },
  shots: {
    1: {
      setup: async (t) => { await t.fillForm(t.stage); },
      take: async (t) => {
        /* The selectors a person would be writing by hand, one control at a
           time. The page is the subject; the guessing is the problem. */
        await t.until(0.2);
        for (const sel of ['#applicant', '#email', '#quantity', '#country', '#submit']) {
          await t.stage.locator(sel).hover().catch(() => {});
          await t.frame();
          await t.frame();
        }
      },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'harvest'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="harvest"]');
        await t.hold(1.2);
      },
    },
    3: {
      take: async (t) => { await t.until(0.2); await t.hold(2.6); },
    },
    4: {
      setup: async (t) => { await t.wait(1200); await frameRow(t, 'harvest'); },
      take: async (t) => {
        await t.until(0.2);
        await t.panel.locator('.tool-row[data-tool="harvest"] .tool-info').click().catch(() => {});
        await t.hold(2.4);
      },
    },
    5: {
      setup: async (t) => {
        await t.panel.locator('.tool-row[data-tool="harvest"] .tool-info').click().catch(() => {});
        await t.wait(300);
        await reportOn(t, 'raw', '#format');
      },
      take: async (t) => {
        await t.until(0.2);
        for (const format of ['harvest-map', 'harvest-pom', 'harvest-brief']) {
          await t.report.selectOption('#format', format).catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
          await t.wait(400);
        }
        await scrollOverFrames(t, t.report, 200, 30);
      },
    },
  },
};
