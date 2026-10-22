/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * F5, "Protect the data". Bible 4.6.
 *
 * The value that gets covered is a synthetic applicant from `fixture.mjs`. The
 * point is not that anything real is being hidden, because nothing real was
 * ever on the machine: it is that the product is filmed doing the thing this
 * pipeline separately guarantees, and `safety.mjs` fails the build if a mask
 * ever fails to cover in a recorded frame.
 */
export default {
  prelude: async (t) => {
    t.fixture.fail();
    await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' });
    await t.panelReady();
    if ((await t.panel.evaluate(() => document.body.dataset.awake)) !== 'true') {
      await t.panel.click('#switch');
      await t.panel.waitForFunction(() => document.body.dataset.awake === 'true', undefined, { timeout: 8000 });
    }
    await t.panel.fill('#charter', 'Food import permit, submit path');
    await t.panel.click('#start');
    await t.panel.waitForFunction(() => !document.getElementById('step-live').hidden, undefined, { timeout: 10000 });
    await t.fillForm(t.stage);
    await t.clearStatus();
  },
  shots: {
    /* 1  the form, carrying a person-shaped record */
    1: { take: async () => {} },

    /* 2  Mask real data, armed */
    2: {
      setup: async (t) => { await t.clearStatus(); await t.reveal(t.panel, '.tool-row[data-tool="mask"]'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="mask"]');
        /* The crosshair is armed by the worker's answer, not by the press: the
           status line says "Starting the masking crosshair…" first and the row
           only reads armed when the answer lands. Shot 3 clicks the page, so
           the shot has to end on the armed state or the click arrives early. */
        await t.panel.waitForSelector('[data-action="mask"][aria-pressed="true"]', { timeout: 15000 });
      },
    },

    /* 3  the name, covered by a solid block */
    3: {
      take: async (t) => {
        await t.until(0.55);
        await t.pickOnPage(t.stage, '#applicant');
        await t.stage.waitForFunction(() => document.querySelectorAll('[data-uqa-masked]').length > 0, undefined, { timeout: 5000 });
      },
    },

    /* 4  and still covered after the page reloads */
    4: {
      take: async (t) => {
        await t.until(0.4);
        await t.stage.reload({ waitUntil: 'domcontentloaded' });
        await t.stage.waitForFunction(() => document.querySelectorAll('[data-uqa-masked]').length > 0, undefined, { timeout: 6000 });
      },
    },

    /* 5  what the report says about it, and does not say */
    5: {
      setup: async (t) => {
        /*
         * The masked block is drawn only once the session has masked values in
         * it, and a report opened the instant after the covers were made can
         * be a beat early. So the report is opened, given a moment, and opened
         * again if the note has not arrived.
         */
        await t.openReport();
        for (let i = 0; i < 6; i++) {
          const said = await t.report.evaluate(() => (document.getElementById('masked-note')?.textContent || '').trim());
          if (said) break;
          await t.wait(1000);
          await t.openReport();
        }
        await t.reveal(t.report, '#masked-block', 'center');
      },
      take: async () => {},
    },

    /* 6  back to sleep */
    6: {
      setup: async (t) => { await t.clearStatus(); await t.reveal(t.panel, '#switch', 'start'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '#switch');
        await t.panel.waitForFunction(() => document.body.dataset.awake === 'false', undefined, { timeout: 8000 });
      },
    },

    /* 7  the site still listed as allowed, after sleep
     *
     * The storyboard's picture is a composite — the asleep popup in front,
     * Settings behind it — and one pass rasters one surface, so it cannot be
     * shot as written. Shot 6 has just held the asleep card; what this shot
     * carries that nothing else does is the other half of the line, so the
     * PANEL page goes to the permissions card on `options/options.html` and
     * holds the site list, which still names the site the run was recorded on.
     * Sleep stopped the work; the permission is still there, and Settings is
     * where it is taken back.
     */
    7: {
      setup: async (t) => {
        await t.panel.goto(`chrome-extension://${t.extensionId}/options/options.html#sec-permissions`, { waitUntil: 'domcontentloaded' });
        await t.panel.waitForSelector('#site-list', { timeout: 15000 });
        await t.reveal(t.panel, '#sec-permissions', 'start');
        await t.wait(600);
      },
      take: async (t) => { await t.until(0.3); await t.hold(3.2); },
    },
  },
};
