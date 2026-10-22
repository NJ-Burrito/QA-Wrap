/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Shared fixtures for the lane-R suites (test-r-*.mjs): a session, event builders and secrets that must never leave. */
export const T0 = 1_757_000_000_000;
export const URL0 = 'https://app.test/apply';
export const SESSION = { id: 's-r', charter: 'Apply for a licence', startedAt: T0 - 1000, endedAt: T0 + 600_000, startUrl: URL0, env: { viewport: '1280x720', userAgent: 'Chrome/130', platform: 'Win32', language: 'en-US' } };
export const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'SflKxwRJSMeKKF2QT4fw'].join('.');
export const GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
let seq = 0;
export const click = (at, label = 'Submit') => ({ kind: 'dom', action: 'click', label, locator: `button[name="${label}"]`, ts: T0 + at, frameUrl: URL0, seq: ++seq });
export const net = (at, over = {}) => ({ kind: 'net', method: 'POST', url: 'https://app.test/api/orders', status: 500, ts: T0 + at, frameUrl: URL0, seq: ++seq, durationMs: 40, responsePreview: '{"error":"db down"}', ...over });
export const logline = (at, over = {}) => ({ kind: 'console', level: 'error', text: 'TypeError: x is undefined', ts: T0 + at, frameUrl: URL0, seq: ++seq, ...over });
/** 40 identical 500s: a different order id in the path and a different query value each time, one click before each. */
export function fortyFiveHundreds() {
  const ev = [];
  for (let i = 0; i < 40; i++) ev.push(click(i * 10_000), net(i * 10_000 + 300, { url: `https://app.test/api/orders/${1000 + i}?_=${i}` }));
  return ev;
}
