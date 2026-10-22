/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * F1, "Record a session". Bible 4.2, re-timed to round 3.
 *
 * The one film with no off-camera setup at all: it opens on a sleeping popup
 * and everything the report at the end is built from happens in front of the
 * camera. That is the point of it.
 *
 * Round 3 splits the old opening in two — the sleeping card is held on its own
 * before the switch is pressed, because the wake card's sentence is the first
 * claim the film makes and it was previously on screen for a third of a second
 * — and gives the report its own shot at the end. Seven capture shots and an
 * end card.
 */
const CHARTER = 'Food import permit, submit path';

export default {
  prelude: async (t) => {
    t.fixture.fail();
    await t.stage.goto(t.origin, { waitUntil: 'domcontentloaded' });
    await t.panelReady();
  },
  shots: {
    /* 1  asleep, and the sentence under the card */
    1: {
      setup: async (t) => { await t.clearStatus(); await t.reveal(t.panel, '#switch', 'start'); },
      take: async (t) => { await t.until(0.3); await t.hold(3.0); },
    },

    /* 2  Wake up pressed; the row turns to Awake in this window */
    2: {
      take: async (t) => {
        await t.until(0.35);
        await t.click(t.panel, '#switch');
        await t.panel.waitForFunction(() => document.body.dataset.awake === 'true', undefined, { timeout: 8000 });
        await t.hold(1.4);
      },
    },

    /* 3  the charter, and Start */
    3: {
      take: async (t) => {
        await t.until(0.15);
        await t.type(t.panel, '#charter', CHARTER, 26);
        await t.click(t.panel, '#start');
        await t.panel.waitForFunction(() => !document.getElementById('step-live').hidden, undefined, { timeout: 10000 });
        await t.hold(0.6);
      },
    },

    /* 4  PAIR: the live row climbing, the form being filled beside it */
    4: {
      take: async (t) => {
        await t.until(0.2);
        await t.stage.fill('#applicant', t.fixture.application.applicant);
        await t.until(0.9);
        await t.stage.fill('#email', t.fixture.application.email);
        await t.until(1.4);
        await t.stage.fill('#quantity', t.fixture.application.quantity);
        await t.until(1.7);
        await t.stage.selectOption('#country', t.fixture.application.country).catch(() => {});
        await t.hold(0.4);
      },
    },

    /* 5  Submit, and the 500 */
    5: {
      setup: async (t) => { t.fixture.fail(); await t.fillForm(t.stage); },
      take: async (t) => {
        await t.until(0.5);
        await t.click(t.stage, '#submit', { failure: true });
        /* The fixture answers 500 and says nothing at all (fixture.mjs: "A failure
           this page does not announce is the point"), so #note never fills. The
           settled state this shot really opens on is the button back from busy. */
        await t.stage.waitForFunction(
          () => { const b = document.getElementById('submit'); return b && !b.disabled && !/Submitting/.test(b.textContent); },
          undefined, { timeout: 8000 }
        );
        await t.hold(1.4);
      },
    },

    /* 6  Stop and review; the saved row and its summary */
    6: {
      setup: async (t) => {
        await t.panel.bringToFront();
        await t.clearStatus();
        await t.reveal(t.panel, '#stop', 'center');
      },
      take: async (t) => {
        await t.until(0.3);
        await t.click(t.panel, '#stop');
        await t.panel.waitForFunction(() => !document.getElementById('step-done').hidden, undefined, { timeout: 10000 });
        await t.reveal(t.panel, '#done-summary');
        await t.hold(1.0);
      },
    },

    /* 7  the report's overview */
    7: {
      setup: async (t) => { await t.openReport(); await t.reveal(t.report, '#hero-title', 'start'); },
      take: async (t) => { await t.until(0.3); await t.hold(2.4); },
    },
  },
};
