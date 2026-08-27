/* Vendify v2.22 */
const CACHE = "vendify-v222-shell";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache app code/styles/html while Vendify is under active development.
  if (
    url.origin === self.location.origin &&
    (
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".html") ||
      url.pathname === "/"
    )
  ) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

  event.respondWith(fetch(req).catch(() => caches.match(req)));
});
