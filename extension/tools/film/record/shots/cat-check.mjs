/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * `cat-check` — Check. Round 3, research/65 §3.
 *
 * Five chapters, five tools: Check accessibility, Check page speed, Check the
 * links, Measure code coverage, Check the fine print — the live `GROUPS`
 * entry `check`. Expert mode, because three of the five are not in the Simple
 * list.
 *
 * Four of the five end in the report's Quality tab. Coverage does not, and
 * that is the director's ruling 5, not an omission: `report.quality.*` is
 * Accessibility, Page speed, Links, Page map and The fine print, and the
 * coverage figure exists only on the tool card (`popup.coverage.result`). So
 * that chapter's result shot is the card, and it will move to the report on
 * the day the report grows a block for it.
 */
import { session, frameRow, reportOn, scrollOverFrames, typeOverFrames } from './tools/_lib.mjs';

export default {
  prelude: async (t) => {
    await session(t);
    await t.setMode('expert');
    await t.fillForm(t.stage);
  },
  shots: {
    /* 1  the Check heading and its five rows */
    1: {
      setup: async (t) => {
        await t.clearStatus();
        await t.reveal(t.panel, '.activity[data-activity="check"]', 'start');
      },
      take: async (t) => {
        await t.until(0.3);
        await scrollOverFrames(t, t.panel, 240, 40, '.activity[data-activity="check"]');
        await t.reveal(t.panel, '.activity[data-activity="check"]', 'start');
      },
    },

    /* 2  Check accessibility pressed */
    2: {
      setup: async (t) => { await frameRow(t, 'a11y'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="a11y"]');
        await t.hold(1.2);
      },
    },

    /* 3  the findings, with their rule names and counts */
    3: {
      setup: async (t) => { await t.wait(2500); await t.reveal(t.panel, '#a11y-out'); },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 4  the full rule list, opened behind the findings */
    4: {
      take: async (t) => {
        await t.until(0.3);
        await t.panel.locator('.tool-row[data-tool="a11y"] .tool-info').click().catch(() => {});
        await t.hold(1.8);
      },
    },

    /* 5  a finding pressed, and the element ringed on the page */
    5: {
      setup: async (t) => {
        await t.panel.locator('.tool-row[data-tool="a11y"] .tool-info').click().catch(() => {});
        await t.wait(400);
        await t.clearStatus();
        await t.reveal(t.panel, '#a11y-out');
      },
      take: async (t) => {
        await t.until(0.4);
        const finding = t.panel.locator('#a11y-out button, #a11y-out .part, #a11y-out li').first();
        if (await finding.count()) await finding.click().catch(() => {});
        await t.wait(600);
        await t.stage.bringToFront();
        await t.hold(1.6);
      },
    },

    /* 6  the accessibility block in the report */
    6: {
      setup: async (t) => { await reportOn(t, 'quality', '.block'); },
      take: async (t) => { await t.until(0.3); await scrollOverFrames(t, t.report, 150, 34); },
    },

    /* 7  Check page speed pressed */
    7: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'perf'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="perf"]');
        await t.hold(1.2);
      },
    },

    /* 8  the timings and the request count */
    8: {
      setup: async (t) => { await t.wait(1500); await frameRow(t, 'perf'); },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 9  logged in, mid-flow, on the real network */
    9: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'perf'); },
      take: async (t) => {
        await t.until(0.3);
        await typeOverFrames(t, t.stage, '#quantity', '120');
        await t.stage.locator('#country').hover().catch(() => {});
        await t.hold(0.6);
      },
    },

    /* 10  the numbers settling on the card */
    10: {
      setup: async (t) => {
        await t.panel.locator('[data-action="perf"]').click().catch(() => {});
        await t.wait(1800);
        await frameRow(t, 'perf');
      },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 11  the page speed block in the report */
    11: {
      setup: async (t) => { await reportOn(t, 'quality', '.block'); await scrollOverFrames(t, t.report, 220, 1); },
      take: async (t) => { await t.until(0.3); await scrollOverFrames(t, t.report, 160, 34); },
    },

    /* 12  Check the links pressed */
    12: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'links'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="links"]');
        await t.hold(1.2);
      },
    },

    /* 13  the counter climbing as each link answers */
    13: {
      take: async (t) => { await t.until(0.2); await t.hold(2.4); },
    },

    /* 14  broken, redirected, slow, fine */
    14: {
      setup: async (t) => { await t.wait(2500); await frameRow(t, 'links'); },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 15  the dead link where it sits on the page
     *
     * `Downloads` is one of the fixture's three declared faults, so the count
     * the card shows is a count of real ones and this is where the real one
     * lives. */
    15: {
      setup: async (t) => { await t.stage.bringToFront(); await t.stage.evaluate(() => window.scrollTo(0, 0)); },
      take: async (t) => {
        await t.until(0.3);
        for (const text of ['Help', 'Status', 'Downloads']) {
          await t.stage.locator(`header a:has-text("${text}")`).hover().catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
        }
        await t.stage.locator('header a:has-text("Downloads")').hover().catch(() => {});
        await t.hold(0.8);
      },
    },

    /* 16  the links block, with the broken one named */
    16: {
      setup: async (t) => { await reportOn(t, 'quality', '.block'); await scrollOverFrames(t, t.report, 420, 1); },
      take: async (t) => { await t.until(0.3); await scrollOverFrames(t, t.report, 160, 34); },
    },

    /* 17  Measure code coverage, and the Ready line */
    17: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'whitebox'); },
      take: async (t) => {
        await t.until(0.3);
        await t.panel.locator('.tool-row[data-tool="whitebox"] .tool-more').click().catch(() => {});
        await t.hold(1.4);
      },
    },

    /* 18  Ready, or the reason why not, for this page */
    18: {
      setup: async (t) => { await t.reveal(t.panel, '#whitebox-out').catch(() => {}); },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 19  started, and the page used
     *
     * Chrome's debugger bar is browser chrome, and a page raster cannot
     * contain it: `page.screenshot()` sees the viewport and nothing above it.
     * So the bar the line names is outside every frame this pipeline can take,
     * and what the shot honestly shows is the run happening — the form being
     * used while the measurement is on.
     */
    19: {
      setup: async (t) => {
        await t.panel.locator('[data-action="coverage"]').click().catch(() => {});
        await t.wait(1500);
        await t.stage.bringToFront();
      },
      take: async (t) => {
        await t.until(0.2);
        await typeOverFrames(t, t.stage, '#applicant', t.fixture.application.applicant);
        await t.click(t.stage, '#submit');
        await t.hold(0.8);
      },
    },

    /* 20  stopped, and the page carries on */
    20: {
      setup: async (t) => {
        await t.panel.locator('[data-action="coverage"]').click().catch(() => {});
        await t.wait(2500);
        await t.stage.bringToFront();
      },
      take: async (t) => {
        await t.until(0.3);
        await t.stage.locator('#country').hover().catch(() => {});
        await t.hold(1.4);
      },
    },

    /* 21  the figure itself, on the card
     *
     * Not the report: coverage has no block there (research/65 §6 item 5), and
     * the shot waits on the film's own clock until the row says a number
     * rather than cutting away from a promise. */
    21: {
      setup: async (t) => {
        for (let i = 0; i < 40; i++) {
          const said = await t.panel.evaluate(() => {
            const row = document.querySelector('.tool-row[data-tool="whitebox"]');
            return ((row?.querySelector('.tool-state')?.textContent || '') + (document.getElementById('whitebox-out')?.textContent || '')).trim();
          });
          if (/\d/.test(said)) break;
          await t.wait(250);
        }
        await t.clearStatus();
        await frameRow(t, 'whitebox');
      },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 22  Check the fine print pressed */
    22: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'fineprint'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="fineprint"]');
        await t.hold(1.0);
      },
    },

    /* 23  the checklist filling row by row */
    23: {
      take: async (t) => { await t.until(0.2); await t.hold(2.4); },
    },

    /* 24  the page's own legal surface, beside the checklist
     *
     * The permits fixture has no footer and no cookie note — it is a form and
     * a nav — so what is in frame is the surface the tool actually read: the
     * page's own links, `/help`, `/status` and the dead `/forms/2019.pdf`.
     * Filming a footer this fixture does not have would be staging one.
     */
    24: {
      setup: async (t) => {
        await t.wait(1500);
        await frameRow(t, 'fineprint');
        await t.stage.evaluate(() => window.scrollTo(0, 0));
      },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 25  the findings counted on the card */
    25: {
      setup: async (t) => { await frameRow(t, 'fineprint'); },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 26  the fine print block, and the four filed as questions */
    26: {
      setup: async (t) => { await reportOn(t, 'quality', '#fineprint-block'); },
      take: async (t) => { await t.until(0.3); await scrollOverFrames(t, t.report, 160, 34); },
    },

    /* 27  all five, in the one report */
    27: {
      setup: async (t) => { await reportOn(t, 'quality', '.tab[data-tab="quality"]'); await t.reveal(t.report, '.tab[data-tab="quality"]', 'start'); },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },
  },
};
