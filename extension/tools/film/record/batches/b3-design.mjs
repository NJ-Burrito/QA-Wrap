/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Batch B3, Design. Bible §10.4.
 *
 * `tool-draw-the-flow` runs last so the diagram has a real session behind it:
 * by then the same browser has designed values, pushed nasty ones, filled the
 * form and harvested the page, and the sheet draws all of it.
 */
export default {
  id: 'b3',
  label: 'Design',
  films: [
    'tool-design-the-values',
    'tool-try-nasty-values',
    'tool-fill-the-form',
    'tool-harvest-the-page',
    'tool-copy-a-locator',
    'tool-draw-the-flow',
  ],
};
