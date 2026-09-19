/* Byline's service worker: the page works offline once it has been seen
   online. Network first, so an updated file wins; the cached copy answers
   when the network cannot. Only same-origin GETs are kept — the relay, a
   model, a did:web document are never cached here.

   Registered by byline.html only when this file is served next to it over
   http(s); on a hosted page where it is absent, nothing is registered. */
const CACHE = 'byline-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
