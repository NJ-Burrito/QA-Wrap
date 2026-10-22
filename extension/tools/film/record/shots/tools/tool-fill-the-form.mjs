/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Fill the form. Bible §10.3, six bars, Expert mode. */
import { session, frameRow, typeOverFrames } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); await t.setMode('expert'); },
  shots: {
    1: {
      setup: async (t) => {
        await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' });
      },
      take: async (t) => {
        /* By hand, slowly, which is the problem this tool answers. */
        await t.until(0.15);
        await typeOverFrames(t, t.stage, '#applicant', t.fixture.application.applicant);
        await t.hold(0.3);
      },
    },
    2: {
      setup: async (t) => {
        await t.stage.evaluate(() => {
          for (const el of document.querySelectorAll('input')) el.value = '';
        });
        await frameRow(t, 'autofill');
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="autofill"]');
        await t.hold(1.4);
      },
    },
    3: {
      take: async (t) => { await t.until(0.2); await t.hold(3.1); },
    },
    4: {
      take: async (t) => {
        await t.until(0.2);
        await t.click(t.stage, '#submit');
        await t.hold(1.2);
      },
    },
  },
};
