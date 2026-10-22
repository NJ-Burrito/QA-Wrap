/* Practice page: answers the form's save request with a 500, so the fault is a real
   network response a recorder can see. Relative scope: works under any path prefix. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.pathname.endsWith('/try/save')) {
    e.respondWith(new Response(JSON.stringify({ error: 'save failed' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    }));
  }
});
