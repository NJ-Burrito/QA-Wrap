/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Try nasty values. Bible §10.3, six bars, Expert mode. */
import { session, frameRow, typeOverFrames } from './_lib.mjs';

/* The families the palette offers, pushed in the order the voice names them. */
const NASTY = [
  'Layla '.repeat(9).trim(),
  'اسم تجريبي كامل',
  '1800-01-01',
  'Layla 🙂',
  '',
];

export default {
  prelude: async (t) => { await session(t); await t.setMode('expert'); },
  shots: {
    1: {
      setup: async (t) => { await t.fillForm(t.stage); },
      take: async (t) => {
        await t.until(0.2);
        await typeOverFrames(t, t.stage, '#applicant', t.fixture.application.applicant);
        await t.hold(0.4);
      },
    },
    2: {
      setup: async (t) => {
        await frameRow(t, 'inject');
        await t.stage.locator('#applicant').focus();
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="inject"]').catch(() => {});
        await t.hold(1.6);
      },
    },
    3: {
      /*
       * The values pushed in turn.
       *
       * The product's palette draws inside its own shadow root over the page,
       * and pressing a swatch is what puts the value in the field. Driving the
       * field directly with the same five families keeps the picture on the
       * page, which is where the shot is, and shows exactly what the palette
       * would put there.
       */
      setup: async (t) => { await t.stage.keyboard.press('Escape').catch(() => {}); },
      take: async (t) => {
        await t.until(0.2);
        for (const value of NASTY) {
          await t.stage.fill('#applicant', value);
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
        await t.click(t.stage, '#submit');
        await t.hold(1.2);
      },
    },
  },
};
