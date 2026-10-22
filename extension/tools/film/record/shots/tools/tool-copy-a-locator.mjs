/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Copy a locator. Bible §10.3, six bars, Expert mode. */
import { session, frameRow } from './_lib.mjs';

export default {
  prelude: async (t) => { await session(t); await t.setMode('expert'); },
  shots: {
    1: {
      setup: async (t) => { await t.fillForm(t.stage); },
      take: async (t) => {
        /* The selector written by hand into the page's own reference field,
           deleted, and retyped: the thing this tool replaces. */
        await t.until(0.15);
        const guess = '#main > form > button.submit';
        for (let i = 1; i <= guess.length; i += 4) {
          await t.stage.fill('#reference', guess.slice(0, i));
          await t.frame();
        }
        for (let i = guess.length; i >= 0; i -= 6) {
          await t.stage.fill('#reference', guess.slice(0, i));
          await t.frame();
        }
      },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'pick'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="pick"]').catch(() => {});
        await t.hold(1.4);
      },
    },
    3: {
      take: async (t) => {
        await t.until(0.3);
        await t.pickOnPage(t.stage, '#submit');
        await t.hold(1.4);
      },
    },
    4: {
      setup: async (t) => { await t.armPicker?.(); },
      take: async (t) => {
        await t.until(0.2);
        await t.send({ type: 'UQA_PICK' }).catch(() => {});
        await t.wait(500);
        await t.stage.bringToFront();
        for (const sel of ['#applicant', '#email', '#quantity']) {
          const box = await t.stage.evaluate((q) => {
            const r = document.querySelector(q)?.getBoundingClientRect();
            return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
          }, sel);
          if (!box) continue;
          await t.stage.mouse.move(box.x, box.y, { steps: 6 });
          await t.stage.keyboard.down('Shift');
          await t.stage.mouse.click(box.x, box.y);
          await t.stage.keyboard.up('Shift');
          await t.frame();
          await t.frame();
        }
        await t.stage.keyboard.press('Enter');
        await t.hold(0.5);
      },
    },
  },
};
