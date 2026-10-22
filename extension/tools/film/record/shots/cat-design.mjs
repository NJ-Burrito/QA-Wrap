/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * `cat-design` — Design. Round 3, research/65 §3.
 *
 * The biggest group and the longest film: eight chapters, eight tools —
 * Design the values, Try nasty values, Fill the form, Harvest the page, Copy a
 * locator, Draw the flow, Reverse-engineer the spec, Send a request. Expert
 * mode; the whole group is Expert-only bar none.
 *
 * Two chapters end somewhere other than where a first reading would put them,
 * and both are research/65 §6:
 *
 *   * `spec` has no view of its own (item 8). Its draft is kept with the
 *     session and read back from the report, so the three result shots are the
 *     Raw export tab and not a spec screen that does not exist.
 *   * `api` had no rectangle at all and nothing here could open it (item 6).
 *     `t.openRequest()` in `record/driver.mjs` is the step that fixes it: the
 *     real `api/api.html`, on this session, with the panel's own worked
 *     example written into the boxes.
 */
import { session, openPanel, frameRow, reportOn, scrollOverFrames, typeOverFrames } from './tools/_lib.mjs';

/* The families the nasty-value palette offers, in the order the voice names
   them. The fixture has no date field, so the date family goes into the field
   that does exist rather than into one invented for the film. */
const NASTY = [
  'Layla '.repeat(9).trim(),
  'ليلى حداد الاسم الكامل',
  '1800-01-01',
  'Layla 🙂',
  '',
];

export default {
  prelude: async (t) => {
    await session(t);
    await t.setMode('expert');
    await t.fillForm(t.stage);
  },
  shots: {
    /* 1  the Design heading and its eight rows */
    1: {
      setup: async (t) => {
        await t.clearStatus();
        await t.reveal(t.panel, '.activity[data-activity="design"]', 'start');
      },
      take: async (t) => {
        await t.until(0.3);
        await scrollOverFrames(t, t.panel, 300, 40, '.activity[data-activity="design"]');
        await t.reveal(t.panel, '.activity[data-activity="design"]', 'start');
      },
    },

    /* 2  Design the values; Pick a field pressed */
    2: {
      setup: async (t) => { await frameRow(t, 'blackbox'); },
      take: async (t) => {
        await t.until(0.3);
        await openPanel(t, 'blackbox', 'partitions-panel', 'partitions').catch(() => {});
        await t.until(2.0);
        await t.panel.locator('#partitions-read').click().catch(() => {});
        await t.hold(0.6);
      },
    },

    /* 3  the quantity field, and the bounds it declares */
    3: {
      setup: async (t) => { await t.stage.bringToFront(); },
      take: async (t) => {
        await t.until(0.4);
        await t.stage.locator('#quantity').focus();
        await t.pickOnPage(t.stage, '#quantity');
        await t.hold(1.0);
      },
    },

    /* 4  the classes, and the exact value on every edge */
    4: {
      setup: async (t) => {
        await t.stage.locator('#quantity').focus();
        await t.panel.locator('#partitions-read').click().catch(() => {});
        await t.wait(1200);
        await t.reveal(t.panel, '#partitions-out');
      },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 5  each value named with the class it stands for */
    5: {
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
        await t.hold(0.5);
      },
    },

    /* 6  Try nasty values armed */
    6: {
      setup: async (t) => {
        await t.clearStatus();
        await frameRow(t, 'inject');
        await t.stage.locator('#applicant').focus();
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="inject"]').catch(() => {});
        await t.hold(1.2);
      },
    },

    /* 7  the field picked, and the list offered for it
     *
     * The fixture has no date field, so the field picked is the applicant
     * name. The palette is offered for whatever is picked, and the film shows
     * it being offered for a field this page really has. */
    7: {
      setup: async (t) => { await t.stage.bringToFront(); },
      take: async (t) => {
        await t.until(0.4);
        await t.stage.locator('#applicant').focus();
        await t.hold(1.8);
      },
    },

    /* 8  a value dropped in; the field stays picked
     *
     * The palette draws inside its own shadow root over the page, and pressing
     * a swatch is what puts the value in the field. Driving the field with the
     * same five families keeps the picture on the page, which is where the
     * shot is, and shows exactly what the palette would put there. */
    8: {
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

    /* 9  the form's own answer to it */
    9: {
      setup: async (t) => { await t.stage.fill('#quantity', '501').catch(() => {}); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.stage, '#submit');
        await t.hold(1.4);
      },
    },

    /* 10  Fill the form pressed */
    10: {
      setup: async (t) => {
        await t.stage.evaluate(() => { for (const el of document.querySelectorAll('input')) el.value = ''; });
        await t.clearStatus();
        await frameRow(t, 'autofill');
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="autofill"]');
        await t.hold(1.2);
      },
    },

    /* 11  the form filling, field by field */
    11: {
      setup: async (t) => { await t.stage.bringToFront(); },
      take: async (t) => { await t.until(0.2); await t.hold(2.6); },
    },

    /* 12  and Submit left alone
     *
     * The permits fixture is an English form, so there is no Arabic field on
     * it for the tool to fill in Arabic; what this shot can show honestly is
     * the second half of the line, which is the half a tester is surprised by:
     * every field filled and the submit button untouched. */
    12: {
      take: async (t) => {
        await t.until(0.3);
        await t.stage.locator('#submit').hover().catch(() => {});
        await t.hold(1.6);
      },
    },

    /* 13  filled, rejected, left alone */
    13: {
      setup: async (t) => { await t.reveal(t.panel, '#autofill-out').catch(() => {}); },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 14  Harvest the page pressed */
    14: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'harvest'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="harvest"]');
        await t.hold(1.2);
      },
    },

    /* 15  every control read, and its locator checked */
    15: {
      setup: async (t) => { await t.stage.bringToFront(); },
      take: async (t) => {
        await t.until(0.2);
        for (const sel of ['#applicant', '#email', '#quantity', '#country', '#submit']) {
          await t.stage.locator(sel).hover().catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
        }
        await t.hold(0.4);
      },
    },

    /* 16  three files, with their sizes */
    16: {
      setup: async (t) => { await t.wait(1500); await reportOn(t, 'raw', '#format'); },
      take: async (t) => {
        await t.until(0.3);
        for (const format of ['harvest-map', 'harvest-pom', 'harvest-brief']) {
          await t.report.selectOption('#format', format).catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
          await t.wait(400);
        }
        await t.hold(0.4);
      },
    },

    /* 17  the page object, with its guesses marked */
    17: {
      setup: async (t) => {
        await t.report.selectOption('#format', 'harvest-pom').catch(() => {});
        await t.wait(700);
      },
      take: async (t) => { await t.until(0.3); await scrollOverFrames(t, t.report, 220, 34); },
    },

    /* 18  Copy a locator armed */
    18: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'pick'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="pick"]').catch(() => {});
        await t.hold(1.2);
      },
    },

    /* 19  Submit clicked; the line is copied */
    19: {
      take: async (t) => {
        await t.until(0.4);
        await t.pickOnPage(t.stage, '#submit');
        await t.hold(1.2);
      },
    },

    /* 20  three more shift-clicked, then Enter */
    20: {
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
          await t.frame();
        }
        await t.stage.keyboard.press('Enter');
        await t.hold(0.6);
      },
    },

    /* 21  each one matched exactly one element */
    21: {
      take: async (t) => {
        await t.until(0.3);
        await t.stage.locator('#submit').hover().catch(() => {});
        await t.hold(2.0);
      },
    },

    /* 22  Draw the flow pressed */
    22: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'diagram'); },
      take: async (t) => {
        await t.until(0.3);
        await t.panel.locator('[data-action="diagram"]').click().catch(() => {});
        await t.hold(1.2);
      },
    },

    /* 23  the sheet generating, box by box */
    23: {
      setup: async (t) => { await t.openDiagram(); },
      take: async (t) => {
        await t.until(0.2);
        const nodes = t.diagram.locator('#sheet [data-node]');
        const n = Math.min(await nodes.count(), 6);
        for (let i = 0; i < n; i++) {
          await nodes.nth(i).hover().catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
        }
        await t.hold(0.5);
      },
    },

    /* 24  the A4 sheet alone, the red failure box drawn last */
    24: {
      setup: async (t) => { await t.renderSheet(); },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 25  a box selected and reworded; the sheet follows */
    25: {
      setup: async (t) => { await t.openDiagram(); },
      take: async (t) => {
        await t.until(0.3);
        await t.diagram.locator('#sheet [data-node]').nth(1).click().catch(() => {});
        await t.wait(400);
        const field = t.diagram.locator('#inspector input[type="text"], #inspector textarea').first();
        if (await field.count()) {
          await field.fill('Submit the application').catch(() => {});
          await field.press('Tab').catch(() => {});
        }
        await t.hold(1.4);
      },
    },

    /* 26  Reverse-engineer the spec pressed */
    26: {
      setup: async (t) => {
        await t.panel.bringToFront();
        await t.clearStatus();
        await frameRow(t, 'spec');
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="spec"]').catch(() => {});
        await t.hold(1.4);
      },
    },

    /* 27  the requirements, one per form and control
     *
     * Research/65 §6 item 8: the spec tool has no view of its own. The draft
     * is kept with the session and read back where every other export lives,
     * so these three shots are the Raw export tab. The requirements document
     * is the `srs` format — requirements with acceptance criteria, which is
     * the thing the line names. */
    27: {
      setup: async (t) => {
        await t.wait(2500);
        await reportOn(t, 'raw', '#format');
        await t.report.selectOption('#format', 'srs').catch(() => {});
        await t.wait(900);
      },
      take: async (t) => { await t.until(0.3); await scrollOverFrames(t, t.report, 200, 34); },
    },

    /* 28  the acceptance criteria under each requirement */
    28: {
      take: async (t) => { await t.until(0.2); await scrollOverFrames(t, t.report, 260, 40); },
    },

    /* 29  the guesses marked as guesses */
    29: {
      take: async (t) => { await t.until(0.2); await scrollOverFrames(t, t.report, 280, 42); },
    },

    /* 30  Send a request pressed; the request page opens */
    30: {
      setup: async (t) => {
        await t.panel.bringToFront();
        await t.clearStatus();
        await frameRow(t, 'api');
      },
      take: async (t) => {
        await t.until(0.3);
        await openPanel(t, 'api', 'api-panel').catch(() => {});
        await t.hold(1.6);
      },
    },

    /* 31  the request panel itself */
    31: {
      setup: async (t) => { await t.openRequest(); },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 32  an endpoint this session watched, imported, one header changed */
    32: {
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.request, '#import-session').catch(() => {});
        await t.request.waitForSelector('#collection .row button', { timeout: 8000 }).catch(() => {});
        await t.until(1.6);
        await t.request.locator('#collection .row button').first().click().catch(() => {});
        await t.wait(500);
        await t.until(2.6);
        /* One header changed on the request the session really watched, which
           is the whole of the line and the whole of the tool's point. */
        const row = t.request.locator('#headers .row').first();
        if (await row.count()) {
          await row.locator('input').nth(0).fill('X-QA-Wrap').catch(() => {});
          await row.locator('input').nth(1).fill('re-sent by hand').catch(() => {});
        }
        await t.hold(0.6);
      },
    },

    /* 33  the answer in the timeline, beside the page's own traffic */
    33: {
      setup: async (t) => {
        await t.request.locator('#send').click().catch(() => {});
        await t.wait(2500);
        await reportOn(t, 'timeline', '.block');
      },
      take: async (t) => { await t.until(0.3); await scrollOverFrames(t, t.report, 200, 34); },
    },

    /* 34  the group again, its meter filled */
    34: {
      setup: async (t) => {
        await t.panel.bringToFront();
        await t.clearStatus();
        await t.reveal(t.panel, '.activity[data-activity="design"]', 'start');
      },
      take: async (t) => {
        await t.until(0.3);
        await scrollOverFrames(t, t.panel, 200, 34, '.activity[data-activity="design"]');
      },
    },
  },
};
