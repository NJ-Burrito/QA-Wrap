/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * F2, "The tools". Bible 4.3, re-timed to round 3.
 *
 * Opens and closes on the wall, so the film's shape is the product's own
 * shape: nineteen tools filed by what a tester is trying to do, and the same
 * wall again at the end with the group meters filled by the run in between.
 *
 * Expert mode throughout, because most of what it presses is not in the Simple
 * list and a film about all nineteen cannot be shot in a mode that shows five.
 *
 * Round 3 re-times it to seven capture shots. Two are new: the four headings
 * with their hints read on their own, and the mode switch pressed both ways.
 * The three separate tool presses of the old cut collapse into one PAIR shot,
 * where the finding is pressed and the element it is about is ringed on the
 * page — the pair the storyboard asks for, and the point the presses were
 * making one at a time.
 */
import { scrollOverFrames } from './tools/_lib.mjs';

export default {
  prelude: async (t) => {
    await t.recordShortSession();
    await t.setMode('expert');
  },
  shots: {
    /* 1  the wall
     *
     * The wall scrolls, because it cannot fit. Bible 2.3 wanted every tile in
     * one 720 px frame; measured, the four groups are 1133 px tall at that
     * width. Scaling is banned, so the shot films the product's own scroll and
     * every tile passes through.
     */
    1: {
      setup: async (t) => {
        await t.clearStatus();
        await t.reveal(t.panel, '.activity', 'start');
        await t.wait(400);
      },
      take: async (t) => {
        await t.until(0.2);
        await scrollOverFrames(t, t.panel, 620, 48, '.activity');
      },
    },

    /* 2  the four headings, with their hints under them
     *
     * A slower pass over the same wall, stopping on each heading: the hints
     * are the line's own words — Keep the evidence, Let the machine look, and
     * the rest — and they are unreadable at the speed shot 1 travels.
     */
    2: {
      setup: async (t) => {
        await t.clearStatus();
        await t.reveal(t.panel, '.activity', 'start');
      },
      take: async (t) => {
        await t.until(0.2);
        for (const group of ['capture', 'check', 'design', 'break']) {
          await t.reveal(t.panel, `.activity[data-activity="${group}"]`, 'start');
          await t.frame();
          await t.frame();
          await t.frame();
          await t.frame();
          await t.frame();
        }
        await t.hold(0.5);
      },
    },

    /* 3  Simple, then Expert
     *
     * `setMode()` writes the mode and reloads the panel, which costs real time
     * and no film time, so both presses land inside the shot's five seconds.
     */
    3: {
      setup: async (t) => {
        await t.clearStatus();
        await t.reveal(t.panel, '.activity', 'start');
      },
      take: async (t) => {
        await t.until(0.3);
        await t.setMode('simple');
        await t.reveal(t.panel, '.activity', 'start');
        await t.until(2.6);
        await t.setMode('expert');
        await t.reveal(t.panel, '.activity', 'start');
        await t.hold(1.2);
      },
    },

    /* 4  PAIR: Check accessibility pressed, and the finding ringed on the page
     *
     * Each finding row in `#a11y-out` carries the product's own "show me"
     * behaviour — `showOnPage()` in `popup/popup.js` rings the element on the
     * page — so the press in the panel and the ring on the stage are one
     * action, which is what the pair is for.
     */
    4: {
      setup: async (t) => {
        await t.clearStatus();
        await t.reveal(t.panel, '.tool-row[data-tool="a11y"]');
      },
      take: async (t) => {
        await t.until(0.25);
        await t.click(t.panel, '[data-action="a11y"]');
        await t.wait(2500);
        await t.until(2.4);
        const row = t.panel.locator('#a11y-out .a11y-finding .part').first();
        if (await row.count()) {
          await t.reveal(t.panel, '#a11y-out');
          await row.click().catch(() => {});
        }
        await t.hold(1.6);
      },
    },

    /* 5  all of it, in the one report
     *
     * The other three tools are pressed here and off camera. Nothing about
     * them is a stand-in: they are real runs on the same page, and what is
     * hidden is three repetitions of a press the film has already shown.
     */
    5: {
      setup: async (t) => {
        for (const action of ['perf', 'harvest', 'links']) {
          await t.panel.locator(`[data-action="${action}"]`).click().catch(() => {});
          await t.wait(2200);
        }
        await t.openReport('quality');
        await t.reveal(t.report, '.tab[data-tab="quality"]', 'start');
      },
      take: async (t) => { await t.until(0.3); await scrollOverFrames(t, t.report, 180, 36); },
    },

    /* 6  the wall again, with the meters filled */
    6: {
      setup: async (t) => {
        await t.panel.bringToFront();
        await t.clearStatus();
        await t.reveal(t.panel, '.activity', 'start');
        await t.wait(400);
      },
      take: async (t) => {
        await t.until(0.2);
        await scrollOverFrames(t, t.panel, 500, 36, '.activity');
      },
    },

    /* 7  the four headings alone, held
     *
     * The product draws no collapsed view of the wall, so "alone" is made by
     * the frame and not by a control that does not exist: the wall is held at
     * its head, where the four group headings and their meters read together
     * and the line hands the viewer on to the four category films.
     */
    7: {
      setup: async (t) => {
        await t.clearStatus();
        await t.reveal(t.panel, '.activity', 'start');
        await t.wait(300);
      },
      take: async (t) => { await t.until(0.3); await t.hold(3.4); },
    },
  },
};
