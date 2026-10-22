/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * `cat-break` — Break. Round 3, research/65 §3.
 *
 * The shortest of the four category films and the only one with two tools:
 * Break a request and Stress the layout, the two rows the live `GROUPS` entry
 * `break` holds in `popup/popup.js`. Expert mode throughout, because a
 * category film opens on its own group heading and Simple mode draws neither
 * of these rows.
 *
 * Two notes on where the pictures come from:
 *
 *   * Nothing here is faked with `fixture.fail()`. The 500 in shot 4 is the
 *     product's own rule, armed in shot 3's setup on `/api/applications`,
 *     which is exactly what the voice claims — "without touching the server".
 *   * The lengthening percentage lives on `options/options.html` and nowhere
 *     else (`popup/popup.js` only reads `settings.expandPercent`). So shot 10
 *     drives the PANEL page to the options surface and shot 11 drives it back
 *     to the popup, because shots 11 and 12 press the panel again.
 */
import { session, openPanel, frameRow, scrollOverFrames, typeOverFrames } from './tools/_lib.mjs';

/* The endpoint the rule is armed on: the one this fixture's Submit calls. */
const ENDPOINT = '/api/applications';

/* The popup's own URL, so shot 11 can come back from Settings. */
const panelHome = (t) => `chrome-extension://${t.extensionId}/popup/popup.html?surface=panel`;

export default {
  prelude: async (t) => {
    await session(t);
    await t.setMode('expert');
    await t.fillForm(t.stage);
  },
  shots: {
    /* 1  the Break heading and its two rows */
    1: {
      setup: async (t) => {
        await t.clearStatus();
        await t.reveal(t.panel, '.activity[data-activity="break"]', 'start');
      },
      take: async (t) => {
        await t.until(0.3);
        await scrollOverFrames(t, t.panel, 200, 40, '.activity[data-activity="break"]');
        await t.reveal(t.panel, '.activity[data-activity="break"]', 'start');
      },
    },

    /* 2  Break a request pressed; the builder opens on the applications endpoint */
    2: {
      setup: async (t) => { await frameRow(t, 'break'); },
      take: async (t) => {
        await t.until(0.3);
        await openPanel(t, 'break', 'break-panel', 'break-toggle');
        await t.until(2.0);
        await typeOverFrames(t, t.panel, '#break-pattern', ENDPOINT);
        await t.hold(0.5);
      },
    },

    /* 3  the four kinds, the URL pattern and the count
     *
     * The value walks the four faults the line names rather than opening the
     * list: a native select draws its options in an operating-system popup,
     * which no page raster can contain. Measured in
     * `tools/tool-break-a-request.mjs`, whose note this follows.
     */
    3: {
      setup: async (t) => { await t.reveal(t.panel, '#break-panel'); },
      take: async (t) => {
        await t.until(0.2);
        for (const value of ['500', 'offline', 'slow', 'redirect']) {
          await t.panel.selectOption('#break-preset', value).catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
        }
        await t.panel.selectOption('#break-preset', '500').catch(() => {});
        await t.until(3.6);
        /* The count is part of the picture, so it is moved where the frame can
           see it move: how many requests this rule is allowed to break. */
        await t.panel.locator('#break-count').focus().catch(() => {});
        await t.panel.locator('#break-count').press('ArrowRight').catch(() => {});
        await t.hold(0.5);
      },
    },

    /* 4  Submit, and the 500 the rule made
     *
     * Armed off camera: the arming is shot 3's control being pressed after its
     * frame, and what this shot is about is the page's answer. The wait is not
     * caught — if the rule did not take, the film should stop rather than hold
     * on a page that quietly succeeded.
     */
    4: {
      setup: async (t) => {
        await t.panel.fill('#break-pattern', ENDPOINT).catch(() => {});
        await t.panel.locator('#break-arm').click().catch(() => {});
        await t.wait(1200);
        await t.stage.bringToFront();
        await t.fillForm(t.stage);
      },
      take: async (t) => {
        await t.until(0.4);
        await t.click(t.stage, '#submit', { failure: true });
        /* The fixture answers the broken call and says nothing at all — "a
           failure this page does not announce is the point" (fixture.mjs) — so
           #note never fills. What the page really shows is the button coming
           back from busy with no receipt under it. */
        await t.stage.waitForFunction(
          () => {
            const b = document.getElementById('submit');
            return b && !b.disabled && !/Submitting/.test(b.textContent) &&
              document.getElementById('receipt')?.hidden !== false;
          },
          undefined, { timeout: 8000 }
        );
        await t.hold(1.2);
      },
    },

    /* 5  Stop breaking it pressed; the rule list empties */
    5: {
      setup: async (t) => {
        await t.panel.bringToFront();
        await t.clearStatus();
        await t.reveal(t.panel, '#break-panel');
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '#break-clear');
        await t.panel.waitForFunction(
          () => !/armed/i.test(document.getElementById('break-state')?.textContent || '') ||
                /No rule/i.test(document.getElementById('break-state')?.textContent || ''), undefined,
          { timeout: 6000 }
        ).catch(() => {});
        await t.hold(1.0);
      },
    },

    /* 6  PAIR: the empty rule list, and the next submit going through */
    6: {
      setup: async (t) => {
        t.fixture.succeed();
        await t.reveal(t.panel, '#break-state');
        await t.stage.bringToFront();
        await t.fillForm(t.stage);
      },
      take: async (t) => {
        await t.until(0.4);
        /* No reload anywhere in this shot: the page the broken submit left is
           the page this one submits from, which is the half of the line a
           tester is surprised by. */
        await t.click(t.stage, '#submit');
        await t.stage.waitForFunction(
          () => !/went wrong/.test(document.getElementById('note')?.textContent || ''), undefined,
          { timeout: 8000 }
        ).catch(() => {});
        await t.hold(1.4);
      },
    },

    /* 7  Stress the layout pressed */
    7: {
      setup: async (t) => {
        await t.panel.bringToFront();
        await t.clearStatus();
        await frameRow(t, 'rtl');
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="rtl"]');
        await t.hold(1.2);
      },
    },

    /* 8  the fixture flipped right to left, every label grown */
    8: {
      setup: async (t) => { await t.wait(1200); await t.stage.bringToFront(); },
      take: async (t) => {
        await t.until(0.2);
        for (const sel of ['#applicant', '#email', '#quantity', '#country']) {
          await t.stage.locator(sel).hover().catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
        }
        await t.hold(0.6);
      },
    },

    /* 9  the one control that cuts its text off, outlined where it happens
     *
     * `content/rtl-stress.js` puts `.uqa-overflow` on whatever loses content,
     * so the shot finds the product's own mark rather than naming a control
     * this fixture might not break. Submit is the fallback, and it is the
     * control that overflows on this form.
     */
    9: {
      setup: async (t) => {
        const marked = t.stage.locator('.uqa-overflow');
        const target = (await marked.count()) ? marked.first() : t.stage.locator('#submit');
        await target.scrollIntoViewIfNeeded().catch(() => {});
      },
      take: async (t) => {
        await t.until(0.3);
        const marked = t.stage.locator('.uqa-overflow');
        const target = (await marked.count()) ? marked.first() : t.stage.locator('#submit');
        await target.hover().catch(() => {});
        await t.hold(2.0);
      },
    },

    /* 10  Settings, open on the lengthening percentage, changed
     *
     * The percentage is an options-page setting; the popup only reads it. So
     * the PANEL page goes to `options/options.html` for this shot, and shot 11
     * brings it back. The slider is stepped by key rather than dragged: a drag
     * on a range control is one pointer event and no picture, and the arrow
     * key moves it a notch a frame.
     */
    10: {
      setup: async (t) => {
        await t.panel.goto(`chrome-extension://${t.extensionId}/options/options.html`, { waitUntil: 'domcontentloaded' });
        await t.panel.waitForSelector('[data-setting="expandPercent"]', { timeout: 15000 });
        await t.reveal(t.panel, '[data-setting="expandPercent"]', 'center');
        await t.wait(400);
      },
      take: async (t) => {
        await t.until(0.3);
        const range = t.panel.locator('#expandPercent');
        await range.focus().catch(() => {});
        for (let i = 0; i < 10; i++) {
          await range.press('ArrowRight').catch(() => {});
          await t.frame();
          await t.frame();
        }
        await t.hold(0.8);
      },
    },

    /* 11  pressed again; the page goes back the way it was */
    11: {
      setup: async (t) => {
        await t.panel.goto(panelHome(t), { waitUntil: 'domcontentloaded' });
        await t.panelReady();
        await t.clearStatus();
        await t.stage.bringToFront();
      },
      take: async (t) => {
        await t.until(0.3);
        await t.panel.locator('[data-action="rtl"]').click().catch(() => {});
        await t.stage.waitForFunction(
          () => document.documentElement.getAttribute('dir') !== 'rtl', undefined,
          { timeout: 8000 }
        ).catch(() => {});
        await t.hold(1.6);
      },
    },

    /* 12  the group again, its meter filled */
    12: {
      setup: async (t) => {
        await t.panel.bringToFront();
        await t.clearStatus();
        await t.reveal(t.panel, '.activity[data-activity="break"]', 'start');
      },
      take: async (t) => {
        await t.until(0.3);
        await scrollOverFrames(t, t.panel, 160, 32, '.activity[data-activity="break"]');
      },
    },
  },
};
