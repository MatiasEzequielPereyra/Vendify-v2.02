/* Vendify v2.31 — safe app-shell offline cache */
const CACHE = "vendify-shell-v2310";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => null)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) =>
              key.startsWith("vendify-shell-") &&
              key !== CACHE
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // External APIs remain network-owned.
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE)
            .then((cache) =>
              cache.put("./index.html", copy)
            );
          return response;
        })
        .catch(() =>
          caches.match("./index.html")
            .then((cached) =>
              cached || caches.match("./")
            )
        )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response?.ok) {
            const copy = response.clone();
            caches.open(CACHE)
              .then((cache) =>
                cache.put(event.request, copy)
              );
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
