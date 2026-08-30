/* Vendify service worker — QA stable */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  // No intervenir en Supabase, CDN, fuentes ni APIs externas.
  if (url.origin !== self.location.origin) return;

  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
