/* =========================================================
   sw.js — service worker. Network-first with cache fallback:
   always serves the newest deployed code when online, and the
   last-cached copy when offline. No version bump needed —
   pushing new files to the host is enough to update installs.
   ========================================================= */
"use strict";

const CACHE = "anstett-books-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    // cache: "no-cache" bypasses the browser's heuristic HTTP cache (revalidates
    // with the server), so new deploys are picked up on the next online launch
    fetch(e.request, { cache: "no-cache" })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
