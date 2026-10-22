/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Draw the flow. Bible §10.3, eight bars, Expert mode.
 *
 * Runs last in batch B3 so the diagram has the richest session behind it: by
 * then the same browser has filled a form, broken a request, harvested the
 * page and designed values, and the sheet draws all of it.
 */
import { session, frameRow, reportOn, scrollOverFrames } from './_lib.mjs';

export default {
  prelude: async (t) => {
    await session(t);
    await t.setMode('expert');
    /* A failure in the session, so the sheet has its red box to draw. */
    t.fixture.fail();
    await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' });
    await t.fillForm(t.stage);
    await t.stage.click('#submit').catch(() => {});
    await t.wait(1500);
    await t.clearStatus();
  },
  shots: {
    1: {
      setup: async (t) => { await reportOn(t, 'timeline', '.block'); },
      take: async (t) => { await t.until(0.2); await scrollOverFrames(t, t.report, 220, 40); },
    },
    2: {
      setup: async (t) => { await frameRow(t, 'diagram'); },
      take: async (t) => {
        await t.until(0.3);
        await t.panel.locator('[data-action="diagram"]').click().catch(() => {});
        await t.hold(1.2);
      },
    },
    3: {
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
        await t.hold(0.4);
      },
    },
    4: {
      take: async (t) => {
        await t.until(0.2);
        const nodes = t.diagram.locator('#sheet [data-node]');
        const total = await nodes.count();
        for (let i = Math.max(0, total - 4); i < total; i++) {
          await nodes.nth(i).hover().catch(() => {});
          await t.frame();
          await t.frame();
          await t.frame();
          await t.frame();
        }
        await t.hold(0.5);
      },
    },
    5: {
      setup: async (t) => {
        /* A box reworded, kept with the session, then the sheet exported and
           filmed alone: the same vector the product hands over. */
        const field = t.diagram.locator('#inspector input[type="text"], #inspector textarea').first();
        await t.diagram.locator('#sheet [data-node]').nth(1).click().catch(() => {});
        await t.wait(400);
        if (await field.count()) {
          await field.fill('Submit the application').catch(() => {});
          await field.press('Tab').catch(() => {});
        }
        await t.diagram.locator('#save-session').click().catch(() => {});
        await t.wait(900);
        await t.renderSheet();
      },
      take: async (t) => { await t.until(0.2); await t.hold(3.2); },
    },
  },
};
