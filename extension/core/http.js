/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
// The fetch lives in core/egress.js now (T-070: the egress ledger records at the one choke point).
export { TIMEOUT_MS, HttpTimeout, retryAfterMs, fetchT } from './egress.js';
