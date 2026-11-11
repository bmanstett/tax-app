/* =========================================================
   sw.js — service worker. Network-first, so an online launch
   always runs the newest deployed code — but it no longer
   waits on the network for ever:

   - The page gets a few seconds to answer. On a weak or
     captive signal (the normal state at a loss site) the
     launch starts from the cached copy instead of sitting on
     a blank screen, and takes its other files from the cache
     too, so one launch runs one consistent set of files.
   - Installing caches the whole app up front, so the very
     next launch already works offline.
   - The update check (js/version.js?ts=…) always goes to the
     network and is never stored.

   No version bump needed — pushing new files to the host is
   enough; js/update.js tells an open app when one is waiting.
   ========================================================= */
"use strict";

const CACHE = "anstett-books-v2";
const NAV_TIMEOUT_MS = 4000;   // how long a launch waits for the network before starting from the cached copy
let cacheOnlyUntil = 0;        // a launch that fell back to the cached page takes its other files from the cache too

// update.js asks for js/version.js?ts=<now> on every check: never store those, never answer them from the cache
const isProbe = url => /\/js\/version\.js\?ts=\d+$/.test(url);
const fromCache = req => caches.match(req, { ignoreSearch: true });

/** Store a good response; hand the original back. */
function keep(req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener("install", e => {
  // Best effort: cache the page and every file it names, so the next launch works with no
  // signal at all. (Nothing used to be cached until a second full online launch.)
  e.waitUntil((async () => {
    try {
      const page = await fetch("index.html", { cache: "no-cache" });
      if (page.ok) {
        const html = await page.clone().text();
        const urls = new Set(["manifest.webmanifest"]);
        for (const m of html.matchAll(/<(?:script[^>]+src|link[^>]+href)="([^"]+)"/g)) {
          if (!/^(data:|https?:|\/\/)/i.test(m[1])) urls.add(m[1]);
        }
        const got = await Promise.all([...urls].map(u =>
          fetch(u, { cache: "no-cache" }).then(r => (r.ok ? [u, r] : null)).catch(() => null)));
        // the page goes in only together with every file it names: a new page beside old
        // scripts would be worse than no cached page at all
        if (got.every(Boolean)) {
          const cache = await caches.open(CACHE);
          await Promise.all(got.map(([u, r]) => cache.put(u, r)));
          await cache.put("index.html", page.clone());
          await cache.put("./", page);
        }
      }
    } catch (err) { /* offline — the fetch handler fills the cache as files are used */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      // one-off cleanup: earlier builds stored a copy of every update check, for ever
      .then(() => caches.open(CACHE))
      .then(c => c.keys().then(reqs => Promise.all(reqs.filter(r => isProbe(r.url)).map(r => c.delete(r)))))
      .catch(() => {})
      .then(() => self.clients.claim())
  );
});

async function respond(req) {
  if (req.mode === "navigate") {
    cacheOnlyUntil = 0;
    const net = fetch(req, { cache: "no-cache" });
    net.catch(() => {});                         // handled below; never an unhandled rejection
    const cached = await fromCache(req);
    if (!cached) return keep(req, await net);    // nothing to fall back on — wait for the network
    const fresh = await Promise.race([
      net.catch(() => null),
      new Promise(r => setTimeout(r, NAV_TIMEOUT_MS, null)),
    ]);
    // Only a page that is actually shown is stored. A late answer stored on its own would
    // pair a new index.html with the old scripts on the next weak-signal launch.
    // (A redirect is an answer too — the site moved, a trailing slash — so it is passed on,
    // not masked by the cached page for ever; keep() only stores ok responses.)
    if (fresh && (fresh.ok || fresh.type === "opaqueredirect")) return keep(req, fresh);
    cacheOnlyUntil = Date.now() + 30000;
    return cached;
  }
  // Every file of a launch that started from the cache — including the revalidating requests
  // a pull-to-refresh makes — so one launch never mixes new and old files. Only Sync & refresh
  // ("reload") and the update check ("no-store") insist on the network.
  if (req.cache !== "reload" && req.cache !== "no-store" && Date.now() < cacheOnlyUntil) {
    const cached = await fromCache(req);
    if (cached) return cached;
  }
  try {
    // "no-cache" skips the browser's own HTTP cache (it revalidates with the server), so a
    // new deploy is picked up on the next online launch
    return keep(req, await fetch(req, { cache: "no-cache" }));
  } catch (err) {
    const cached = await fromCache(req);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  if (isProbe(req.url)) return;   // straight to the network, never stored
  // if anything in the cache logic itself fails, fall back to a plain request
  e.respondWith(respond(req).catch(() => fetch(req)));
});
