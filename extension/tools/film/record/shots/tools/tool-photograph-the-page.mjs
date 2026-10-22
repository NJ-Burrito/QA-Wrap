/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Photograph the page. Bible §10.3, six bars, Simple mode.
 *
 * One departure from the storyboard, and the reason for it.
 *
 * §10.3 shot 3 asks for the page scrolling and stitching **under** the capture.
 * A whole-page capture drives the page itself over the same debugger
 * connection this recorder screenshots through, and the two deadlocked the
 * browser three times: the take finished, the frames were made, and the run
 * then sat with a half-dead browser and no error. So the capture is pressed in
 * the setup, where it runs at full speed with nothing competing, and the take
 * films the page coming back to the top with the product's own report of what
 * it did on the row: "Whole page saved: N screens stitched". Nothing is faked
 * and nothing is re-enacted; what moved is where the press sits relative to
 * the camera.
 */
import { session, openPanel, frameRow, scrollOverFrames, reportOn } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); },
  shots: {
    1: {
      setup: async (t) => { await t.fillForm(t.stage); await t.stage.evaluate(() => window.scrollTo(0, 200)); },
      take: async (t) => { await t.until(0.2); await scrollOverFrames(t, t.stage, 120, 30); },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'shot'); },
      take: async (t) => {
        await t.until(0.3);
        await openPanel(t, 'shot', 'shot-panel', 'shot').catch(() => {});
        await t.hold(1.2);
      },
    },
    3: {
      setup: async (t) => {
        await t.stage.evaluate(() => window.scrollTo(0, 0));
        await t.panel.locator('[data-action="shot"]').click().catch(() => {});
        /* The stitch, off camera and uncontended. */
        await t.wait(6000);
        await t.stage.evaluate(() => window.scrollTo(0, 0));
        await t.wait(400);
      },
      take: async (t) => {
        await t.until(0.2);
        await frameRow(t, 'shot');
        await scrollOverFrames(t, t.stage, 300, 60);
      },
    },
    4: {
      setup: async (t) => { await t.wait(1500); await reportOn(t, 'media', '.block'); },
      take: async (t) => { await t.until(0.2); await scrollOverFrames(t, t.report, 160, 30); },
    },
  },
};
