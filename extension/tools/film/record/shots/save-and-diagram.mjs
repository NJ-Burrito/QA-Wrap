/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * F4, "Saving and the diagram". Bible 4.5.
 *
 * The Save beat films the product's own format list, never the operating
 * system's save dialog: an OS dialog is not part of the page raster, and it is
 * the one place in the whole set where an absolute path would walk into a
 * frame. Bible 5.4 draws that line and this file keeps to it.
 */
export default {
  prelude: async (t) => {
    await t.recordShortSession();
    await t.openReport();
  },
  shots: {
    /* 1  Save, and the format list opening */
    1: {
      setup: async (t) => { await t.reveal(t.report, '#save-all', 'center'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.report, '#save-all');
        await t.report.waitForFunction(() => document.getElementById('save-dialog')?.open === true, undefined, { timeout: 8000 });
      },
    },

    /* 2  the whole list, held */
    2: {
      setup: async (t) => {
        await t.report.evaluate(() => document.getElementById('save-parts')?.scrollTo(0, 0));
        await t.wait(400);
      },
      take: async () => {},
    },

    /* 3  the saved list: real names, real sizes, no path from this machine */
    3: {
      setup: async (t) => {
        await t.report.locator('#save-none').click().catch(() => {});
        await t.report.locator('#save-parts input[value="srs"]').check().catch(() => {});
        await t.report.locator('#save-parts input[value="markdown"]').check().catch(() => {});
        await t.report.locator('#save-go').click().catch(() => {});
        await t.report.waitForFunction(() => /Saved|failed/.test(document.getElementById('save-status')?.textContent || ''), undefined, { timeout: 30000 }).catch(() => {});
        await t.report.locator('#save-close').click().catch(() => {});
        await t.report.locator('.tab[data-tab="raw"]').click().catch(() => {});
        await t.wait(700);
        await t.reveal(t.report, '#saved', 'center');
      },
      take: async () => {},
    },

    /* 4  the diagram page, drawing the session */
    4: {
      setup: async (t) => { await t.openDiagram(); },
      take: async (t) => {
        await t.until(0.4);
        await t.diagram.locator('#sheet [data-node]').first().hover().catch(() => {});
      },
    },

    /* 5  the A4 sheet alone */
    5: {
      setup: async (t) => { await t.renderSheet(); },
      take: async () => {},
    },

    /* 6  a box selected and reworded; the sheet follows */
    6: {
      setup: async (t) => { await t.openDiagram(); },
      take: async (t) => {
        await t.until(0.3);
        const node = t.diagram.locator('#sheet [data-node]').nth(1);
        await node.click().catch(() => {});
        await t.wait(400);
        const field = t.diagram.locator('#inspector input[type="text"], #inspector textarea').first();
        if (await field.count()) {
          await field.fill('Submit the application');
          await field.press('Tab').catch(() => {});
        }
        await t.wait(500);
      },
    },

    /* 7  the finished sheet, held
     *
     * The same A4 sheet as shot 5, re-rendered after shot 6's rewording, so
     * what is held is the page the edit produced and not the page before it.
     */
    7: {
      setup: async (t) => { await t.renderSheet(); },
      take: async (t) => { await t.until(0.3); await t.hold(2.2); },
    },
  },
};
