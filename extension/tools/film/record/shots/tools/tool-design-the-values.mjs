/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Design the values. Bible §10.3, eight bars, Expert mode. */
import { session, openPanel, frameRow, typeOverFrames } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); await t.setMode('expert'); },
  shots: {
    1: {
      setup: async (t) => { await t.fillForm(t.stage); },
      take: async (t) => {
        /* A tester typing random numbers into a field with a declared range. */
        await t.until(0.2);
        for (const v of ['7', '128', '64', '999']) {
          await t.stage.fill('#quantity', v);
          await t.frame();
          await t.frame();
          await t.frame();
        }
      },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'blackbox'); },
      take: async (t) => {
        await t.until(0.2);
        await t.stage.locator('#quantity').focus();
        await openPanel(t, 'blackbox', 'partitions-panel', 'partitions');
        await t.until(1.0);
        await t.panel.locator('#partitions-read').click().catch(() => {});
        await t.hold(0.6);
      },
    },
    3: {
      setup: async (t) => { await t.reveal(t.panel, '#partitions-out'); },
      take: async (t) => { await t.until(0.2); await t.hold(2.6); },
    },
    4: {
      take: async (t) => {
        await t.until(0.2);
        const parts = t.panel.locator('#partitions-out .part');
        const n = Math.min(await parts.count(), 6);
        for (let i = 0; i < n; i++) {
          await parts.nth(i).hover().catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
        }
        await t.hold(0.4);
      },
    },
    5: {
      take: async (t) => {
        await t.until(0.2);
        await typeOverFrames(t, t.stage, '#quantity', '501');
        await t.click(t.stage, '#submit');
        await t.hold(1.0);
      },
    },
  },
};
