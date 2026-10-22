/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * F3, "File the report". Bible 4.4.
 *
 * Every shot is the report, so the session under it is driven off camera by
 * `recordShortSession()`. Nothing about that session is a stand-in: it is a
 * real run on the same fixture, recorded by the same code F1 shows in full.
 * What is hidden is the repetition, not the work.
 */
export default {
  prelude: async (t) => {
    await t.recordShortSession();
    await t.openReport();
  },
  shots: {
    /* 1  What broke: the failure chain */
    1: {
      setup: async (t) => { await t.openReport('broke'); await t.reveal(t.report, '.tab[data-tab="broke"]', 'start'); },
      take: async () => {},
    },

    /* 2  File it, and the seven kinds */
    2: {
      setup: async (t) => { await t.reveal(t.report, '.tab[data-tab="file"]', 'start'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.report, '.tab[data-tab="file"]');
        await t.report.waitForSelector('[data-artefact]', { timeout: 8000 });
        await t.report.locator('[data-artefact="defect"]').click().catch(() => {});
      },
    },

    /* 3  the document, written from the recording */
    3: {
      setup: async (t) => { await t.wait(900); await t.reveal(t.report, '#jira-body', 'center'); },
      take: async () => {},
    },

    /* 4  the same session, as a test case */
    4: {
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.report, '[data-artefact="testcase"]').catch(async () => {
          /* The kinds are keyed by the product, not by this file. If the test
             case is not called `testcase`, press the second segment: the shot
             is about the row changing shape, not about one identifier. */
          await t.report.locator('[data-artefact]').nth(1).click();
        });
        await t.wait(900);
      },
    },

    /* 5  Copy, and the status line that confirms it */
    5: {
      setup: async (t) => {
        await t.report.locator('#jira-copy, [data-action="copy"]').first().click().catch(() => {});
        await t.wait(700);
        await t.reveal(t.report, '#jira-body', 'center');
      },
      take: async () => {},
    },

    /* 6  the Jira block and its attachment list */
    6: {
      setup: async (t) => { await t.reveal(t.report, '#jira-attach-list', 'center'); },
      take: async () => {},
    },

    /* 7  the ticket, finished, held
     *
     * The storyboard asks for the filed ticket with its key. Filing needs a
     * real Jira, and a film that connected one would put somebody's instance,
     * account and issue key into a public frame — bible 5.4 draws that line
     * for absolute paths and it is the same line. So the shot holds what
     * filing would send: the summary, the body written from the recording, and
     * `#jira-last`, which carries the key when this browser has filed one.
     * Nothing was retyped to make it, which is what the line claims.
     */
    7: {
      setup: async (t) => {
        await t.reveal(t.report, '#jira-summary', 'start');
        await t.wait(400);
      },
      take: async (t) => { await t.until(0.3); await t.hold(2.4); },
    },
  },
};
