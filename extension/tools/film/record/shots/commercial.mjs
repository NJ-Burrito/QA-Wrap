/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The commercial, revision 3. Bible §3.3 and §5.2a.
 *
 * Thirteen shots, twelve of them captured, none shorter than four seconds. The
 * film argues rather than lists: a bug that cannot be reproduced, what that
 * costs, the product, three claims each held four seconds on its result, the
 * A4 flow, and the wall.
 *
 * **Shot 3 has to be filmed before anything starts a session.** It is the
 * report's empty state, the one picture in the product that honestly says
 * there is no evidence, and it stops being available the moment a session
 * exists. The driver runs shots in order and nothing before shot 4 starts one,
 * so the order is the guarantee; `sessionsExist()` checks it rather than
 * trusting it.
 */

const CHARTER = 'Food import permit, submit path';

const isOpen = (t, id) => t.panel.evaluate((p) => { const el = document.getElementById(p); return !!el && !el.hidden; }, id);

/** Open a tool's own disclosure, whichever control the product hangs it on. */
async function openPanel(t, tool, panelId, action) {
  if (await isOpen(t, panelId)) return;
  const more = t.panel.locator(`.tool-row[data-tool="${tool}"] .tool-more`);
  if (await more.count()) { await more.click().catch(() => {}); await t.wait(500); }
  if (!(await isOpen(t, panelId)) && action) { await t.panel.locator(`[data-action="${action}"]`).click().catch(() => {}); await t.wait(600); }
  for (let i = 0; i < 12 && !(await isOpen(t, panelId)); i++) await t.wait(200);
  if (!(await isOpen(t, panelId))) throw new Error(`${panelId} would not open from the ${tool} row`);
  await t.reveal(t.panel, `#${panelId}`);
}

/**
 * Scroll a page a few pixels a frame, so the film sees a scroll and not a jump.
 *
 * The popup scrolls an inner element rather than its document, so the scroller
 * is found from the thing being scrolled towards; the document is the fallback.
 */
async function scrollOverFrames(t, page, totalPx, frames, anchor = null) {
  const step = totalPx / frames;
  for (let i = 0; i < frames; i++) {
    await page.evaluate(({ by, sel }) => {
      const start = (sel && document.querySelector(sel)) || document.body;
      let el = start.parentElement;
      while (el) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) {
          el.scrollTop += by;
          return;
        }
        el = el.parentElement;
      }
      (document.scrollingElement || document.documentElement).scrollBy(0, by);
    }, { by: step, sel: anchor });
    if (!(await t.frame())) return;
  }
}

/**
 * A real activeTab grant on the fixture tab, taken after the last navigation.
 *
 * Without one the Record row draws an amber outline and a sentence telling the
 * tester to press Alt+Shift+V, and the critic found it in frame across several
 * seconds of revision 2. Chrome revokes the grant on navigation, so this runs
 * after the last `goto`, and the panel is redrawn afterwards because the row
 * asks `UQA_CAN_RECORD` when it renders. Nothing is hidden: the condition the
 * warning reports is made untrue.
 */
async function grantRecording(t, { redrawPanel = true } = {}) {
  await t.pressRecordShortcut(t.stage);
  await t.wait(1500);
  await t.send({ type: 'UQA_RECORD_STOP' }).catch(() => {});
  await t.wait(1000);
  const tabId = await t.panel.evaluate(
    (origin) => new Promise((r) => chrome.tabs.query({}, (ts) => r(ts.find((x) => x.url?.startsWith(origin))?.id ?? null))),
    t.origin
  );
  const can = await t.send({ type: 'UQA_CAN_RECORD', tabId });
  if (!can?.result?.can) {
    throw new Error(`the tab is not recordable after the shortcut (${can?.result?.why ?? 'no answer'}), so the row would draw its warning`);
  }
  if (redrawPanel) {
    await t.panel.reload();
    await t.panelReady();
    await t.wait(400);
  }
  await t.panel.evaluate(() => {
    for (const h of document.querySelectorAll('.tool-help')) h.hidden = true;
  }).catch(() => {});
  await t.clearStatus();
}

/**
 * The same grant, for a shot that opens with the extension asleep.
 *
 * Shot 4 is the wake, so it cannot be preceded by a woken panel. Chrome's
 * activeTab grant is the browser's, not the product's, so it survives the
 * extension going back to sleep: wake, take the grant, sleep again, redraw.
 * The proof is the absence of the note itself, checked rather than assumed,
 * because the product decides when to draw it and this file does not.
 */
async function grantWhileAsleep(t) {
  /* No arm and no disarm: arming and then sleeping again clears the product's
     own record of the invocation, which is what left the note drawn on the
     first attempt. Chrome's grant does not need the extension awake. */
  await t.pressRecordShortcut(t.stage);
  await t.wait(1600);
  await t.send({ type: 'UQA_RECORD_STOP' }).catch(() => {});
  await t.wait(900);
  await t.panel.reload();
  await t.panelReady();
  await t.wait(500);
  await t.panel.evaluate(() => {
    for (const h of document.querySelectorAll('.tool-help')) h.hidden = true;
  }).catch(() => {});
  const left = await t.panel.evaluate(
    () => document.querySelectorAll('.tool-invoke, [data-needs-invoke="true"]').length
  );
  if (left) throw new Error(`${left} needs-invoke marker(s) still drawn after taking the grant`);
  const asleep = await t.panel.evaluate(() => document.body.dataset.awake);
  if (asleep === 'true') throw new Error('the panel is awake, and this shot has to open asleep');
  await t.clearStatus();
}

/** Put the tool list exactly at a group header, and refuse a sliced row. */
async function alignToGroup(t, index, { wantTiles = 8, wantHeads = 2 } = {}) {
  await t.panel.evaluate((i) => {
    const target = [...document.querySelectorAll('.activity')][i];
    if (!target) return;
    let el = target.parentElement;
    while (el) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) {
        el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top;
        return;
      }
      el = el.parentElement;
    }
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, index);
  await t.wait(400);
  const whole = await t.panel.evaluate(() => {
    const inFrame = (el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
    };
    return {
      tiles: [...document.querySelectorAll('.tool-row[data-tool]')].filter(inFrame).length,
      heads: [...document.querySelectorAll('.activity-head')].filter(inFrame).length,
    };
  });
  if (whole.tiles < wantTiles || whole.heads < wantHeads) {
    throw new Error(`group ${index} frames ${whole.tiles} whole tile(s) and ${whole.heads} header(s), wanted ${wantTiles} and ${wantHeads}`);
  }
}

/** Has anything started a session yet? Shot 3 is only honest if nothing has. */
const sessionsExist = (t) =>
  t.panel.evaluate(() => new Promise((r) => chrome.storage.session.get(['activeSessionId', 'lastSessionId'], (v) => r(!!(v.activeSessionId || v.lastSessionId)))));

export default {
  shots: {
    /* 1  the form, the Submit that 500s, and the note held */
    1: {
      setup: async (t) => {
        t.fixture.fail();
        await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' });
        await t.fillForm(t.stage);
      },
      take: async (t) => {
        await t.until(0.6);
        await t.click(t.stage, '#submit', { failure: true });
        /* Wait for the button to settle back, which is the only thing that
           moves: the page issues nothing, and the shot holds on that. */
        await t.stage.waitForFunction(() => !document.getElementById('submit').disabled, undefined, { timeout: 8000 });
        await t.hold(2.4);
      },
    },

    /* 2  refilled, submitted, and the reference number the page promised */
    2: {
      setup: async (t) => { t.fixture.succeed(); },
      /*
       * The receipt has to be the picture, not a late arrival at the edge.
       *
       * The press lands at 1.3 s into the shot (6.300 on the film clock) and
       * the panel is scrolled to sit mid-frame immediately after, so it is
       * wholly inside the capture rectangle by 1.6 s and holds there for the
       * remaining 3.4 s. The storyboard asserts that on every frame from 51.
       */
      take: async (t) => {
        const a = t.fixture.application;
        await t.until(0.15);
        for (const [sel, value] of [['#applicant', a.applicant], ['#email', a.email], ['#quantity', a.quantity]]) {
          await t.stage.fill(sel, value);
          await t.frame();
        }
        await t.stage.selectOption('#country', a.country).catch(() => {});
        await t.until(1.25);
        await t.click(t.stage, '#submit', { approachFrames: 1 });
        await t.stage.waitForFunction(() => !document.getElementById('receipt').hidden, undefined, { timeout: 8000 });
        /* Mid-frame, not at the bottom edge: the panel sits below a long form,
           so without this it enters the capture only as the page happens to
           end. `center` puts it where a viewer is already looking. */
        await t.stage.evaluate(() => {
          document.getElementById('receipt').scrollIntoView({ block: 'center', behavior: 'instant' });
        });
        await t.wait(200);
        await t.hold(3.4);
      },
    },

    /* 3  the report with nothing in it. NEW, and only filmable now */
    3: {
      setup: async (t) => {
        if (await sessionsExist(t)) {
          throw new Error('a session already exists, so the empty state is no longer honest; shot 3 must be filmed before shot 4');
        }
        await t.openReportEmpty();
      },
      take: async (t) => {
        await t.until(0.3);
        /* The cursor moves across the empty page and stops: nothing to click,
           which is the whole point of the shot. */
        for (const [x, y] of [[420, 300], [760, 380], [1040, 300]]) {
          await t.report.mouse.move(x, y, { steps: 12 });
          await t.frame();
          await t.frame();
          await t.frame();
        }
        await t.hold(1.2);
      },
    },

    /* 4  one continuous take: asleep, woken, named, started, counting */
    4: {
      setup: async (t) => {
        t.fixture.fail();
        await t.panelReady();
        /*
         * The panel opens at its top, which is where this shot lives.
         *
         * The Record row and its needs-invoke note sit below the fold of a
         * 420 px panel; the shot is the wake, the charter and Start, and none
         * of those are near it. The guard counts what is in the frame, so if
         * the note ever climbs into shot the take fails rather than ships.
         */
        await grantWhileAsleep(t);
        await t.panel.evaluate(() => (document.scrollingElement || document.documentElement).scrollTo(0, 0)).catch(() => {});
        await t.clearStatus();
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '#switch');
        await t.panel.waitForFunction(() => document.body.dataset.awake === 'true', undefined, { timeout: 12000 });
        await t.hold(0.3);
        await t.type(t.panel, '#charter', CHARTER, 22);
        await t.until(3.0);
        await t.click(t.panel, '#start');
        await t.panel.waitForFunction(() => !document.getElementById('step-live').hidden, undefined, { timeout: 12000 });
        /* A second of tail on the climbing counter, which is what revision 3
           added to this take. */
        await t.hold(1.0);
      },
    },

    /* 5  armed and fired, in one take */
    5: {
      setup: async (t) => {
        await t.setMode('expert');
        await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' });
        await t.fillForm(t.stage);
        await grantRecording(t);
        await openPanel(t, 'break', 'break-panel', 'break-toggle');
        await t.panel.selectOption('#break-preset', '500').catch(() => {});
        await t.panel.fill('#break-pattern', '/api/').catch(() => {});
        t.fixture.fail();
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '#break-arm');
        await t.hold(0.5);
        await t.until(1.4);
        await t.click(t.stage, '#submit', { failure: true });
        await t.stage.waitForFunction(() => !document.getElementById('submit').disabled, undefined, { timeout: 8000 });
        await t.hold(1.2);
      },
    },

    /* 6  the failure chain, and the click that caused it. NEW */
    6: {
      setup: async (t) => {
        await t.wait(1500);
        await t.openReport('broke');
        await t.reveal(t.report, '.tab[data-tab="broke"]', 'start');
      },
      take: async (t) => {
        await t.until(0.3);
        await scrollOverFrames(t, t.report, 240, 60);
        await t.hold(0.6);
      },
    },

    /* 7  four artefact kinds, the document rewriting itself each time */
    7: {
      setup: async (t) => {
        await t.openReport('file');
        await t.wait(900);
        await t.reveal(t.report, '[data-artefact]', 'start');
        await t.report.evaluate(() => window.scrollBy(0, -40));
        await t.wait(300);
      },
      take: async (t) => {
        await t.until(0.2);
        const kinds = await t.report.locator('[data-artefact]').evaluateAll((els) => els.map((e) => e.dataset.artefact));
        for (const kind of kinds.slice(0, 4)) {
          await t.report.locator(`[data-artefact="${kind}"]`).click().catch(() => {});
          await t.frame(); await t.frame(); await t.frame(); await t.frame(); await t.frame();
          await t.wait(500);
        }
        await t.hold(0.4);
      },
    },

    /* 8  the evidence list, real, then the one press that files it */
    8: {
      /*
       * "File as Bug now" could not be filmed, and this is what was filmed.
       *
       * `#jira-quick` is `hidden` until a tracker is configured
       * (`istqb.js:729`), and `quick()` then sends the session to a Jira site.
       * Filming it would mean putting a token in the throwaway profile and
       * making an outbound request to somebody's host: bible 5.4 forbids a
       * token in frame, 7.6 lists the only accepted egress in this pipeline
       * and it is not this, and the film itself claims "no account, no upload"
       * eight seconds later. So the shot films the product's own local
       * hand-over instead, which is the same sentence made true without an
       * account: one press, and the screenshots and the video and the report
       * are written out together, with the product's own line confirming it.
       *
       * The evidence is real, not a ticked box: the setup takes a screenshot
       * into the session and records a clip first, so "the screenshots and the
       * video" name things that exist.
       */
      setup: async (t) => {
        await t.setMode('expert');
        await grantRecording(t);
        /* A real screenshot and a real clip in the session. */
        await t.panel.locator('[data-action="shot"]').click().catch(() => {});
        await t.wait(2500);
        await t.pressRecordShortcut(t.stage);
        await t.wait(2500);
        await t.pressRecordShortcut(t.stage);
        await t.wait(2500);
        await t.send({ type: 'UQA_RECORD_STOP' }).catch(() => {});
        await t.wait(1500);
        await t.clearStatus();

        await t.openReport('file');
        await t.report.locator('[data-artefact="defect"]').click().catch(() => {});
        await t.wait(900);
        await t.reveal(t.report, '#jira-attach-list', 'center');
        const boxes = t.report.locator('#jira-attach-list input');
        const n = Math.min(await boxes.count(), 6);
        for (let i = 0; i < n; i++) await boxes.nth(i).check({ force: true }).catch(() => {});
        await t.wait(700);

        /* The hand-over itself, opened and set, so the take is the press. */
        await t.report.locator('#save-all').click().catch(() => {});
        await t.report.waitForFunction(() => document.getElementById('save-dialog')?.open === true, undefined, { timeout: 12000 });
        await t.report.locator('#save-none').click().catch(() => {});
        /* The screenshots and the video first, because they are what the voice
           names; the report and the network log with them. `media:screenshot`
           and `media:recording` are the product's own ids for the two Evidence
           shelves (report.js:1272). */
        for (const v of ['media:screenshot', 'media:recording', 'markdown', 'har']) {
          await t.report.locator(`#save-parts input[value="${v}"]`).check({ force: true }).catch(() => {});
        }
        await t.wait(400);
        /* Framed on the Evidence group, so the shot shows what is being filed
           rather than the shelves that are not. */
        await t.reveal(t.report, '#save-parts input[value="media:screenshot"]', 'center');
        await t.wait(400);
      },
      take: async (t) => {
        await t.until(0.6);
        await t.click(t.report, '#save-go');
        await t.report.waitForFunction(
          () => /Saved|failed/.test(document.getElementById('save-status')?.textContent || ''), undefined,
          { timeout: 40000 }
        );
        /* Held on the line that confirms it, which is the whole claim. */
        await t.hold(1.6);
      },
    },

    /* 9  two values covered, unhurried */
    9: {
      setup: async (t) => {
        await grantRecording(t, { redrawPanel: false });
        await t.armMask();
      },
      take: async (t) => {
        await t.until(0.6);
        await t.pickOnPage(t.stage, '#applicant');
        await t.until(1.9);
        await t.armMask();
        await t.until(2.4);
        await t.pickOnPage(t.stage, '#email');
        await t.hold(0.5);
      },
    },

    /* 10  the reload, both covers redrawing, the count rising beside them */
    10: {
      take: async (t) => {
        await t.until(0.4);
        await t.stage.reload({ waitUntil: 'domcontentloaded' });
        await t.stage.waitForFunction(() => document.querySelectorAll('[data-uqa-masked]').length >= 2, undefined, { timeout: 9000 });
        await t.hold(2.0);
      },
    },

    /* 11  the A4 sheet alone, unhurried */
    11: {
      setup: async (t) => { await t.renderSheet(); },
      take: async (t) => { await t.until(0.3); await t.hold(3.4); },
    },

    /* 12  the wall held long enough to count, then one scroll to its foot */
    12: {
      setup: async (t) => {
        await t.setMode('expert');
        await grantRecording(t);
        await t.panel.mouse.move(4, 4);
        await t.clearStatus();
        await alignToGroup(t, 0);
      },
      take: async (t) => {
        /* Two seconds still, which is what a viewer counts on, then one scroll
           to the foot for the product's own no-spill line. */
        await t.until(2.0);
        await scrollOverFrames(t, t.panel, 1000, 55, '.activity');
        await t.hold(0.2);
      },
    },
  },
};
