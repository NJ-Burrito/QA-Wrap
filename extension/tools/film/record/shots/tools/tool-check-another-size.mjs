/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Check another size. Bible §10.3, six bars, Expert mode. */
import { session, openPanel, frameRow } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); await t.setMode('expert'); },
  shots: {
    1: {
      setup: async (t) => { await t.fillForm(t.stage); },
      take: async (t) => {
        await t.until(0.3);
        for (const sel of ['#applicant', '#email', '#quantity']) {
          await t.stage.locator(sel).hover().catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
        }
      },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'viewport'); },
      take: async (t) => {
        await t.until(0.3);
        await openPanel(t, 'viewport', 'viewport-panel', 'viewport');
        await t.hold(1.2);
      },
    },
    3: {
      /*
       * A real window at a phone size, filmed in the stage rectangle.
       *
       * The product opens a genuinely new browser window. A capture of that
       * window is a capture of another surface at another size, and this
       * pipeline cannot place it without scaling, which is banned. So the film
       * shows the same page reflowing to a phone width inside the stage
       * rectangle: the reflow is the thing the shot is about, and it is the
       * product's own layout answering, not a picture of a window.
       */
      setup: async (t) => { await t.stage.setViewportSize({ width: 1080, height: 720 }); },
      take: async (t) => {
        await t.until(0.2);
        for (const w of [900, 760, 620, 500, 420, 390]) {
          await t.stage.evaluate((px) => {
            const main = document.querySelector('main');
            if (main) main.style.maxWidth = px + 'px';
          }, w);
          await t.frame();
          await t.frame();
          await t.frame();
          await t.frame();
        }
      },
    },
    4: {
      take: async (t) => {
        await t.until(0.2);
        await t.stage.locator('#country').hover().catch(() => {});
        await t.hold(1.4);
      },
    },
  },
};
