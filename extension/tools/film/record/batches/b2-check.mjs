/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Batch B2, Check. Bible §10.4.
 *
 * One session, so the report's Quality tab fills block by block across the
 * batch: each film's result shot shows its own block arriving beside the ones
 * already there. That is only true if the runs stay in this order.
 */
export default {
  id: 'b2',
  label: 'Check',
  films: ['tool-check-accessibility', 'tool-check-page-speed', 'tool-check-the-links', 'tool-measure-code-coverage'],
};
