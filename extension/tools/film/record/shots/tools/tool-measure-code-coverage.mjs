/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Measure code coverage. Bible §10.3, six bars, Expert mode. */
import { session, frameRow, typeOverFrames } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); await t.setMode('expert'); },
  shots: {
    1: {
      setup: async (t) => { await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' }); },
      take: async (t) => {
        await t.until(0.2);
        await t.fillForm(t.stage);
        await t.frame();
        await t.click(t.stage, '#submit');
        await t.hold(0.8);
      },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'whitebox'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="coverage"]').catch(() => {});
        await t.hold(1.4);
      },
    },
    3: {
      take: async (t) => {
        await t.until(0.2);
        await typeOverFrames(t, t.stage, '#applicant', t.fixture.application.applicant);
        await t.stage.locator('#country').hover().catch(() => {});
        await t.hold(0.4);
      },
    },
    4: {
      setup: async (t) => { await frameRow(t, 'whitebox'); },
      /*
       * The figure has to be on screen, not merely asked for.
       *
       * The first cut of this shot pressed stop and cut away before the
       * per-function numbers arrived, so the film promised a coverage figure
       * and never showed one. The press now happens early in the take and the
       * shot waits, on the film's own clock, for the row to say something.
       */
      take: async (t) => {
        await t.until(0.15);
        await t.click(t.panel, '[data-action="coverage"]').catch(() => {});
        for (let i = 0; i < 40; i++) {
          const said = await t.panel.evaluate(() => {
            const row = document.querySelector('.tool-row[data-tool="whitebox"]');
            return ((row?.querySelector('.tool-state')?.textContent || '') + (document.getElementById('status')?.textContent || '')).trim();
          });
          if (/\d/.test(said)) break;
          await t.wait(250);
        }
        await t.reveal(t.panel, '.tool-row[data-tool="whitebox"]');
        await t.hold(1.4);
      },
    },
  },
};
