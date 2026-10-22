/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/* The practice page's "server". The game is a page inside the extension, so there is no server to answer its planted routes: this answers them
   from inside the page, with the same status codes and the same 4 s wait as game/server.mjs (test-practice-game.mjs asserts the two tables agree).
   It must load BEFORE content/page-hooks.js so the recorder wraps this fetch and sees the real status of every call. Other addresses go through. */
(() => {
  const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
  const PAY_DELAY_MS = 4000;
  // pathname -> [method, status, body]; /api/pay answers 200 after PAY_DELAY_MS.
  const ROUTES = {
    '/api/save-profile': ['POST', 500, '{"ok":false,"error":"save failed"}'],
    '/api/pay': ['POST', 200, '{"ok":true}'],
    '/api/coupons': ['GET', 404, '{"error":"no such table"}'],
    '/api/sync': ['POST', 503, '{"ok":false,"error":"sync unavailable"}'],
    '/api/telemetry': ['POST', 500, '{"ok":false,"error":"telemetry failed"}'],
    '/api/checkout': ['POST', 500, '{"ok":false,"error":"payment failed"}'],
    '/api/menu': ['GET', 404, '{"error":"no such menu"}'],
  };
  const ORDERS = /^\/api\/orders\/[A-Za-z0-9_-]{1,32}$/;
  const real = window.fetch.bind(window);
  const answer = (status, body, signal, delay = 0) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response(body, { status, headers: JSON_HEADERS })), delay);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('The operation was aborted.', 'AbortError')); }, { once: true });
  });
  window.fetch = (input, init) => {
    let url;
    try { url = new URL(input instanceof Request ? input.url : String(input), location.href); } catch { return real(input, init); }
    if (!url.href.startsWith(location.origin + '/')) return real(input, init); // same origin only (url.origin reads 'null' for some schemes)
    const route = ORDERS.test(url.pathname) ? ['POST', 503, '{"ok":false,"error":"kitchen offline"}'] : ROUTES[url.pathname];
    if (!route && url.pathname === '/favicon.ico') return answer(404, 'Not found', init?.signal);
    if (!route) return real(input, init);
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== route[0]) return answer(405, '{"error":"method"}', init?.signal);
    return answer(route[1], route[2], init?.signal, url.pathname === '/api/pay' ? PAY_DELAY_MS : 0);
  };
})();
