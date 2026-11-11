/* =========================================================
   sw.js — service worker. Network-first, so an online launch
   always runs the newest deployed code — but it never waits
   on the network for ever, and its offline copy is always
   one complete build:

   - The page gets a few seconds to answer. On a weak or
     captive signal (the normal state at a loss site) the
     launch starts from the cached copy instead of sitting on
     a blank screen, and takes its other files from the cache
     too, so one launch runs one consistent set of files.
   - The cached copy is replaced only as a whole: the page and
     every file it names are downloaded first, stored in a new
     cache, and switched to in one step. Nothing is stored one
     file at a time, so a download that broke off half-way can
     never leave a new page beside old scripts.
   - Installing caches the whole app up front, so the very
     next launch already works offline.
   - The update check (js/version.js?ts=…) always goes to the
     network and is never stored.

   Bump js/version.js with every deploy: the update banner
   needs it, and it is how the worker knows its cached copy
   is out of date.
   ========================================================= */
"use strict";

const META = "anstett-books-meta";          // one entry, "current": the name of the cache in use
const BUILD_PREFIX = "anstett-books-build-";
const NAV_TIMEOUT_MS = 4000;   // how long a launch waits for the network before starting from the cached copy
let cacheOnlyUntil = 0;        // a launch that fell back to the cached page takes its other files from the cache too

// update.js asks for js/version.js?ts=<now> on every check: never store those, never answer them from the cache
const isProbe = url => /\/js\/version\.js\?ts=\d+$/.test(url);

let currentMemo = null;   // read once per worker start (a worker is restarted often); precache() moves it
async function currentName() {
  if (currentMemo == null) {
    const hit = await (await caches.open(META)).match("current");
    const name = hit ? await hit.text() : "";
    currentMemo = name && (await caches.has(name)) ? name : "";
  }
  return currentMemo;
}
/** The cache holding the complete build in use, or null when there isn't one yet. */
async function currentCache() {
  const name = await currentName();
  return name ? caches.open(name) : null;
}

/** Download the page and every file it names; switch to them only if every one arrived in
    full. → true when the cached build was replaced. */
async function precache() {
  const page = await fetch("index.html", { cache: "no-cache" });
  if (!page.ok) return false;
  const html = await page.text();
  const urls = new Set(["manifest.webmanifest"]);
  for (const m of html.matchAll(/<(?:script[^>]+src|link[^>]+href)="([^"]+)"/g)) {
    if (!/^(data:|https?:|\/\/)/i.test(m[1])) urls.add(m[1]);
  }
  // bodies are read to the end before anything is stored: a connection that drops mid-file fails here
  const got = await Promise.all([...urls].map(u =>
    fetch(u, { cache: "no-cache" })
      .then(async r => (r.ok ? { url: u, body: await r.blob(), type: r.headers.get("Content-Type") } : null))
      .catch(() => null)));
  if (!got.every(Boolean)) return false;

  // (only the type is kept: the stored body is already decoded, so the server's
  // Content-Encoding / Content-Length / Vary would describe something else)
  const typed = type => ({ headers: type ? { "Content-Type": type } : {} });
  const pageType = page.headers.get("Content-Type") || "text/html; charset=utf-8";
  const name = BUILD_PREFIX + Date.now();
  const cache = await caches.open(name);
  await Promise.all(got.map(f => cache.put(f.url, new Response(f.body, typed(f.type)))));
  await cache.put("index.html", new Response(html, typed(pageType)));
  await cache.put("./", new Response(html, typed(pageType)));
  // the switch: one small write. Until it lands, launches keep using the previous build.
  await (await caches.open(META)).put("current", new Response(name));
  currentMemo = name;
  await dropOtherBuilds(name);
  return true;
}

/** Remove this app's caches that are no longer in use (earlier builds, and the file-by-file
    caches of earlier workers). Other sites on the same host are left alone. */
async function dropOtherBuilds(keepName) {
  const keys = await caches.keys();
  await Promise.all(keys
    .filter(k => k.startsWith("anstett-books") && k !== META && k !== keepName)
    .map(k => caches.delete(k)));
}

let refreshing = null;
/** After a launch that reached the server: make the cached build the deployed one. Nothing
    is downloaded when it already is (same page, same js/version.js). */
function refreshCache(freshPageText) {
  if (!refreshing) {
    refreshing = (async () => {
      const cache = await currentCache();
      if (cache) {
        const [havePage, haveVersion] = await Promise.all([cache.match("index.html"), cache.match("js/version.js")]);
        if (havePage && haveVersion && (await havePage.text()) === freshPageText) {
          const now = await fetch("js/version.js", { cache: "no-cache" });
          if (now.ok && (await now.text()) === (await haveVersion.text())) return;
        }
      }
      await precache();
    })().catch(() => {}).then(() => { refreshing = null; });
  }
  return refreshing;
}

self.addEventListener("install", e => {
  // Best effort: with no connection the worker still installs, and the first launch that
  // reaches the server fills the cache.
  e.waitUntil(precache().catch(() => false).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    try { await dropOtherBuilds(await currentName()); } catch (err) { /* no matter */ }
    await self.clients.claim();
  })());
});

async function respond(req, e) {
  const cache = await currentCache();
  const cachedCopy = () => (cache ? cache.match(req, { ignoreSearch: true }) : Promise.resolve(undefined));

  if (req.mode === "navigate") {
    cacheOnlyUntil = 0;
    const net = fetch(req, { cache: "no-cache" });
    net.catch(() => {});                         // handled below; never an unhandled rejection
    // a page that came from the server: check the cached build against it, in the background
    const shown = res => {
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(copy.text().then(refreshCache).catch(() => {}));
      }
      return res;
    };
    const cached = await cachedCopy();
    if (!cached) return shown(await net);        // nothing to fall back on — wait for the network
    const fresh = await Promise.race([
      net.catch(() => null),
      new Promise(r => setTimeout(r, NAV_TIMEOUT_MS, null)),
    ]);
    // (A redirect is an answer too — the site moved, a trailing slash — so it is passed on,
    // not masked by the cached page for ever.)
    if (fresh && (fresh.ok || fresh.type === "opaqueredirect")) return shown(fresh);
    cacheOnlyUntil = Date.now() + 30000;
    return cached;
  }

  // Every file of a launch that started from the cache — including the revalidating requests
  // a pull-to-refresh makes — so one launch never mixes new and old files. Only Sync & refresh
  // ("reload") and the update check ("no-store") insist on the network.
  if (req.cache !== "reload" && req.cache !== "no-store" && Date.now() < cacheOnlyUntil) {
    const cached = await cachedCopy();
    if (cached) return cached;
  }
  try {
    // "no-cache" skips the browser's own HTTP cache (it revalidates with the server), so a
    // new deploy is picked up on the next online launch
    return await fetch(req, { cache: "no-cache" });
  } catch (err) {
    const cached = await cachedCopy();
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  if (isProbe(req.url)) return;   // straight to the network, never stored
  // if anything in the cache logic itself fails, fall back to a plain request
  e.respondWith(respond(req, e).catch(() => fetch(req)));
});
