/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * `cat-capture` — Capture. Round 3, research/65 §3.
 *
 * One film, four chapters, one tool each: Photograph the page, Record the
 * screen, Check another size, Mask real data — the four rows the live
 * `GROUPS` entry `capture` holds in `popup/popup.js`. Expert mode throughout,
 * because a category film opens on its own group heading and Simple mode does
 * not draw one.
 *
 * Every chapter ends on the surface where its result is actually visible, per
 * the director's ruling 7: the gallery for a photograph and a clip, the Window
 * sizes tab for a size run, the masked count for a cover. Nothing is
 * re-enacted; where a beat is pressed off camera it is because the press
 * contends with the recorder for the same debugger connection, and that is
 * said where it happens.
 */
import { session, openPanel, frameRow, scrollOverFrames, reportOn, grantRecording } from './tools/_lib.mjs';

export default {
  prelude: async (t) => {
    await session(t);
    await t.setMode('expert');
    await t.fillForm(t.stage);
  },
  shots: {
    /* 1  the Capture heading and its four rows */
    1: {
      setup: async (t) => {
        await t.clearStatus();
        await t.reveal(t.panel, '.activity[data-activity="capture"]', 'start');
      },
      take: async (t) => {
        await t.until(0.3);
        await scrollOverFrames(t, t.panel, 220, 40, '.activity[data-activity="capture"]');
        await t.reveal(t.panel, '.activity[data-activity="capture"]', 'start');
      },
    },

    /* 2  Photograph the page pressed; the row acknowledges */
    2: {
      setup: async (t) => { await frameRow(t, 'shot'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="shot"]');
        await t.hold(0.8);
      },
    },

    /* 3  the two scopes on the card */
    3: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'shot'); },
      take: async (t) => {
        await t.until(0.3);
        /* The disclosure, not the tool button: pressing the button again would
           take a second photograph rather than open the options. */
        await openPanel(t, 'shot', 'shot-panel').catch(() => {});
        await t.until(2.2);
        await t.panel.locator('#shot-panel label.scope-opt:has(input[value="full"])').click({ force: true }).catch(() => {});
        await t.hold(0.6);
      },
    },

    /* 4  the whole page, scrolled and stitched
     *
     * The stitch itself runs in the setup and off camera. A whole-page capture
     * drives the page over the same debugger connection this recorder
     * screenshots through, and the two deadlock the browser — measured in
     * `tools/tool-photograph-the-page.mjs`, whose note this follows. What the
     * take films is the page travelling under it, which is what the line says.
     */
    4: {
      setup: async (t) => {
        await t.stage.evaluate(() => window.scrollTo(0, 0));
        await t.panel.locator('[data-action="shot"]').click().catch(() => {});
        await t.wait(7000);
        await t.stage.evaluate(() => window.scrollTo(0, 0));
        await t.wait(400);
      },
      take: async (t) => {
        await t.until(0.2);
        await scrollOverFrames(t, t.stage, 420, 70);
      },
    },

    /* 5  the fixed header, passed once */
    5: {
      setup: async (t) => { await t.stage.evaluate(() => window.scrollTo(0, 520)); await t.wait(300); },
      take: async (t) => {
        await t.until(0.2);
        /* Back to the top: the sticky header is in every frame of the travel
           and lands once at the head of the page, which is the thing the
           stitch does and the line claims. */
        await scrollOverFrames(t, t.stage, -520, 60);
      },
    },

    /* 6  the picture in the gallery */
    6: {
      setup: async (t) => { await t.wait(1200); await reportOn(t, 'media', '.block'); },
      take: async (t) => { await t.until(0.3); await scrollOverFrames(t, t.report, 180, 40); },
    },

    /* 7  Record the screen pressed */
    7: {
      setup: async (t) => {
        await grantRecording(t);
        await frameRow(t, 'record');
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="record"]').catch(() => {});
        await t.hold(0.8);
      },
    },

    /* 8  microphone, tab sound, webcam */
    8: {
      setup: async (t) => {
        /* Stop the clip shot 7 started before opening its options: the video
           options are not the place to be while the recorder is running. */
        await t.send({ type: 'UQA_RECORD_STOP' }).catch(() => {});
        await t.wait(1500);
        await grantRecording(t);
        await openPanel(t, 'record', 'capture-panel').catch(() => {});
      },
      take: async (t) => {
        await t.until(0.2);
        /* The label is pressed, not the input: the product draws its own chip
           art over a hidden control, so `check()` sets a property the row
           never hears about. */
        const tick = async (id) => {
          const label = t.panel.locator(`label:has(#${id})`);
          if (await label.count()) await label.first().click({ force: true }).catch(() => {});
        };
        await tick('cap-mic');
        await t.until(1.4);
        await tick('cap-tabAudio');
        await t.until(2.6);
        await tick('cap-webcam');
        await t.hold(0.5);
      },
    },

    /* 9  it runs while you work */
    9: {
      setup: async (t) => {
        await t.panel.locator('.tool-row[data-tool="record"] .tool-more').click().catch(() => {});
        await grantRecording(t, { redrawPanel: false });
        await t.panel.locator('[data-action="record"]').click().catch(() => {});
        await t.wait(1200);
        await frameRow(t, 'record');
        await t.stage.evaluate(() => { for (const el of document.querySelectorAll('input')) el.value = ''; });
      },
      take: async (t) => {
        await t.until(0.3);
        await t.stage.fill('#applicant', t.fixture.application.applicant);
        await t.until(1.3);
        await t.stage.fill('#email', t.fixture.application.email);
        await t.until(2.3);
        await t.stage.fill('#quantity', t.fixture.application.quantity);
        await t.until(3.1);
        await t.stage.selectOption('#country', t.fixture.application.country).catch(() => {});
        await t.hold(0.4);
      },
    },

    /* 10  pressed again; the recording stops */
    10: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'record'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="record"]').catch(() => {});
        await t.wait(2500);
        await t.hold(1.0);
      },
    },

    /* 11  the video beside the screenshots */
    11: {
      setup: async (t) => {
        await t.send({ type: 'UQA_RECORD_STOP' }).catch(() => {});
        await t.wait(2500);
        await reportOn(t, 'media', '.block');
      },
      take: async (t) => { await t.until(0.3); await scrollOverFrames(t, t.report, 200, 40); },
    },

    /* 12  Check another size pressed */
    12: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'viewport'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="viewport"]').catch(() => {});
        await t.hold(0.8);
      },
    },

    /* 13  the sizes, with the widths a browser really has */
    13: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'viewport'); },
      take: async (t) => {
        await t.until(0.3);
        await openPanel(t, 'viewport', 'viewport-panel').catch(() => {});
        await t.hold(1.4);
      },
    },

    /* 14  a real window at phone width
     *
     * The product opens a genuinely new browser window, and a capture of that
     * window is a capture of another surface at another size that this
     * pipeline cannot place without scaling. So the size run is really started
     * — off camera, so the Window sizes tab in shot 16 has a real run in it —
     * and the frame shows this same page reflowing to that width, which is the
     * thing the line is about.
     */
    14: {
      setup: async (t) => {
        await t.panel.locator('#viewport-list .part').first().click().catch(() => {});
        await t.wait(2500);
        await t.clearStatus();
        await t.stage.bringToFront();
      },
      take: async (t) => {
        await t.until(0.2);
        for (const w of [980, 860, 720, 600, 500, 420, 390]) {
          await t.stage.evaluate((px) => {
            const main = document.querySelector('main');
            if (main) main.style.maxWidth = px + 'px';
          }, w);
          await t.frame();
          await t.frame();
          await t.frame();
        }
      },
    },

    /* 15  awake there, and masked there */
    15: {
      setup: async (t) => {
        /* The cover is made here rather than in shot 18, because the line is
           that a size run carries the masking on and there has to be a cover
           for it to carry. Shot 18 covers a second value on camera. */
        await t.armMask();
        await t.pickOnPage(t.stage, '#email');
        await t.stage.waitForFunction(() => document.querySelectorAll('[data-uqa-masked]').length > 0, undefined, { timeout: 6000 }).catch(() => {});
        await t.clearStatus();
      },
      take: async (t) => {
        await t.until(0.3);
        await t.stage.locator('#country').hover().catch(() => {});
        await t.hold(1.2);
      },
    },

    /* 16  filed under Window sizes, never as a desktop bug */
    16: {
      setup: async (t) => {
        await t.stage.evaluate(() => {
          const main = document.querySelector('main');
          if (main) main.style.maxWidth = '';
        });
        await reportOn(t, 'sizes', '#sizes');
      },
      take: async (t) => { await t.until(0.3); await scrollOverFrames(t, t.report, 160, 36); },
    },

    /* 17  Mask real data, armed */
    17: {
      setup: async (t) => { await t.clearStatus(); await frameRow(t, 'mask'); },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '[data-action="mask"]');
        /* Armed by the worker's answer, not by the press; shot 18 clicks the
           page next and would otherwise cover nothing (see `armMask`). */
        await t.panel.waitForSelector('[data-action="mask"][aria-pressed="true"]', { timeout: 15000 });
        await t.hold(0.8);
      },
    },

    /* 18  the name, covered by a solid block */
    18: {
      take: async (t) => {
        await t.until(0.5);
        await t.pickOnPage(t.stage, '#applicant');
        await t.stage.waitForFunction(() => document.querySelectorAll('[data-uqa-masked]').length >= 2, undefined, { timeout: 8000 }).catch(() => {});
        await t.hold(1.0);
      },
    },

    /* 19  and still covered after the page reloads */
    19: {
      take: async (t) => {
        await t.until(0.3);
        await t.stage.reload({ waitUntil: 'domcontentloaded' });
        await t.stage.waitForFunction(() => document.querySelectorAll('[data-uqa-masked]').length >= 2, undefined, { timeout: 8000 });
        await t.hold(1.2);
      },
    },

    /* 20  every picture taken with the cover on */
    20: {
      setup: async (t) => {
        await t.fillForm(t.stage);
        await t.stage.waitForFunction(() => document.querySelectorAll('[data-uqa-masked]').length >= 2, undefined, { timeout: 8000 }).catch(() => {});
        await t.panel.locator('#shot-panel label.scope-opt:has(input[value="visible"])').click({ force: true }).catch(() => {});
        await t.clearStatus();
      },
      take: async (t) => {
        await t.until(0.4);
        /* A real photograph, taken while the covers are on the page. It is the
           product's own capture path, and shot 21 counts what it did. */
        await t.panel.locator('[data-action="shot"]').click().catch(() => {});
        await t.hold(1.6);
      },
    },

    /* 21  the count, and never the words underneath */
    21: {
      setup: async (t) => {
        await t.wait(1200);
        await t.openReport();
        for (let i = 0; i < 6; i++) {
          const said = await t.report.evaluate(() => (document.getElementById('masked-note')?.textContent || '').trim());
          if (said) break;
          await t.wait(1000);
          await t.openReport();
        }
        await t.reveal(t.report, '#masked-block', 'center');
      },
      take: async (t) => { await t.until(0.3); await t.hold(2.0); },
    },

    /* 22  the group again, its meter filled */
    22: {
      setup: async (t) => {
        await t.clearStatus();
        await t.reveal(t.panel, '.activity[data-activity="capture"]', 'start');
      },
      take: async (t) => {
        await t.until(0.3);
        await scrollOverFrames(t, t.panel, 160, 32, '.activity[data-activity="capture"]');
      },
    },
  },
};
