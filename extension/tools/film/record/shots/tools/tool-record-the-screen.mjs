/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Record the screen. Bible §10.3, eight bars, Simple mode. */
import { session, openPanel, frameRow, typeOverFrames, reportOn, grantRecording } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); },
  shots: {
    1: {
      setup: async (t) => { await t.fillForm(t.stage); },
      take: async (t) => {
        /* The bug that only exists while you move: the field clears itself. */
        await t.until(0.3);
        await typeOverFrames(t, t.stage, '#applicant', t.fixture.application.applicant);
        await t.stage.fill('#applicant', '');
        await t.frame();
        await t.frame();
      },
    },
    2: {
      setup: async (t) => {
        await grantRecording(t);
        await frameRow(t, 'record');
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="record"]').catch(() => {});
        await t.hold(0.6);
      },
    },
    3: {
      setup: async (t) => {
        /* Stop the clip shot 2 started first: the video options are not the
           place to be while the recorder is running, and the commercial found
           the same thing at its own shot 7. */
        await t.send({ type: 'UQA_RECORD_STOP' }).catch(() => {});
        await t.wait(1500);
        await grantRecording(t);
        await openPanel(t, 'record', 'capture-panel');
      },
      take: async (t) => {
        await t.until(0.2);
        /*
         * The label is pressed, not the input.
         *
         * The product draws its own radio and chip art and hides the real
         * control behind it, so `check({ force: true })` sets the property and
         * the row never hears about it: the box read back unticked and the
         * shot failed on its own assertion. Clicking the label is what a hand
         * does and what the product listens for.
         */
        const tick = async (id) => {
          const label = t.panel.locator(`label:has(#${id})`);
          if (await label.count()) await label.first().click({ force: true }).catch(() => {});
          else await t.panel.locator(`#${id}`).check({ force: true }).catch(() => {});
        };
        const scope = t.panel.locator('label.scope-opt:has(input[value="screen"])');
        if (await scope.count()) await scope.first().click({ force: true }).catch(() => {});
        await t.frame();
        await t.frame();
        await t.until(1.0);
        await tick('cap-tabAudio');
        await t.frame();
        await t.frame();
        await t.until(1.8);
        await tick('cap-mic');
        await t.hold(0.4);
      },
    },
    4: {
      setup: async (t) => {
        await t.fillForm(t.stage);
        await grantRecording(t, { redrawPanel: false });
      },
      take: async (t) => {
        await t.until(0.3);
        await typeOverFrames(t, t.stage, '#applicant', t.fixture.application.applicant);
        await t.click(t.stage, '#submit');
        await t.hold(0.5);
      },
    },
    5: {
      setup: async (t) => {
        await t.send({ type: 'UQA_RECORD_STOP' }).catch(() => {});
        await t.wait(2500);
        await grantRecording(t, { redrawPanel: false });
        await reportOn(t, 'media', '.block');
      },
      take: async (t) => { await t.until(0.2); await t.hold(3.2); },
    },
  },
};
