/* =========================================================
   update.js — "a new version is ready" banner.

   This app is a PWA: once it's installed on the phone it can
   sit open for days on code that shipped a week ago. The
   service worker is network-first, so a *relaunch* always
   picks up the newest build — but nothing tells you that a
   relaunch is due. This does: it re-fetches the deployed
   build stamp in the background, and when it stops matching
   the code that's running, a banner offers a one-tap refresh
   (syncing first). Refresh, and the banner is gone for good.
   ========================================================= */
"use strict";

const AppUpdate = (() => {
  const CHECK_MS = 15 * 60 * 1000;         // background re-check while the app is open
  const DISMISS_KEY = "anstett_update_dismissed";  // version the user tapped "Later" on
  const APPLIED_KEY = "anstett_update_applied";    // version we reloaded into — confirms on arrival

  let latest = null;      // the build stamp found on the server
  let checking = false;
  let timer = null;

  // top-level `const` lives in the script scope, not on window — check it by name
  const runningVersion = () => (typeof APP_BUILD !== "undefined" && APP_BUILD.version) || "";
  const ss = {
    get(k) { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode — no matter */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* no matter */ } },
  };

  /** The build stamp that is actually deployed right now, read straight off the
      host. Same file the page loaded — one version string, no drift possible. */
  async function fetchDeployedBuild() {
    const res = await fetch(`js/version.js?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const txt = await res.text();
    const v = txt.match(/version:\s*"([^"]*)"/);
    if (!v || !v[1]) throw new Error("no version stamp in the response");
    const n = txt.match(/notes:\s*"([^"]*)"/);
    return { version: v[1], notes: n ? n[1] : "" };
  }

  /** Compare deployed vs. running. → the new build, or null when up to date. */
  async function check({ silent = true } = {}) {
    if (checking) return null;
    if (!/^https?:$/.test(location.protocol)) return null;   // file:// — nothing to check against
    if (!navigator.onLine) {
      if (!silent) UI.toast("You're offline — reconnect to check for updates", "default", 4000);
      return null;
    }
    checking = true;
    try {
      const build = await fetchDeployedBuild();
      latest = build;
      if (runningVersion() && build.version !== runningVersion()) { paint(); return build; }
      hide();
      if (!silent) UI.toast(`You're on the latest version (${runningVersion()}) ✓`, "success", 4000);
      return null;
    } catch (e) {
      if (!silent) UI.toast(`Couldn't check for updates — ${e.message}`, "error", 5000);
      return null;
    } finally {
      checking = false;
    }
  }

  /* ---------- the banner ---------- */
  const bannerEl = () => document.getElementById("update-banner");

  function hide() {
    const el = bannerEl();
    if (el) el.hidden = true;
  }

  function paint() {
    const el = bannerEl();
    if (!el || !latest) return;
    if (ss.get(DISMISS_KEY) === latest.version) return;   // they tapped Later on this one
    el.querySelector("#ub-note").textContent = latest.notes
      ? U.truncate(latest.notes, 110)
      : `Version ${latest.version} is ready — refresh to load it.`;
    el.hidden = false;
  }

  /** Sync what's on this device, force the new code past every cache, reload. */
  async function applyUpdate() {
    const btn = document.getElementById("ub-refresh");
    if (btn) { btn.disabled = true; btn.textContent = "Updating…"; }

    Store.save();   // flush anything typed in the last moment before we reload
    // push this device's records first, so nothing waits on the old code
    if (window.Sync && Sync.config.enabled) {
      await Promise.race([
        Sync.now().catch(() => {}),
        new Promise(r => setTimeout(r, 6000)),   // a slow sync must not block the update
      ]);
    }

    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    } catch (e) { /* no service worker — the cache bust below still does the job */ }

    // re-request every shell file with cache:"reload", so the reload lands on new
    // code instead of whatever the HTTP cache is still holding
    const urls = [location.pathname,
      ...[...document.querySelectorAll('script[src], link[rel="stylesheet"]')].map(el => el.src || el.href)];
    await Promise.all(urls.map(u => fetch(u, { cache: "reload" }).catch(() => {})));

    if (latest) ss.set(APPLIED_KEY, latest.version);
    ss.del(DISMISS_KEY);
    location.reload();
  }

  function later() {
    if (latest) ss.set(DISMISS_KEY, latest.version);
    hide();
    UI.toast("Reminder dismissed — the update loads next time you open the app", "default", 4000);
  }

  /* ---------- wiring ---------- */
  function init() {
    const el = bannerEl();
    if (el) {
      el.querySelector("#ub-refresh").addEventListener("click", () => applyUpdate());
      el.querySelector("#ub-later").addEventListener("click", later);
    }

    // arriving on the other side of an update: confirm it, then never mention it again
    const applied = ss.get(APPLIED_KEY);
    if (applied) {
      ss.del(APPLIED_KEY);
      if (applied === runningVersion()) {
        setTimeout(() => UI.toast(`✓ Updated to ${runningVersion()}`, "success", 4500), 900);
      }
    }

    setTimeout(() => check(), 5000);
    timer = setInterval(() => check(), CHECK_MS);
    // coming back to the app on the phone is the moment that matters most
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
    window.addEventListener("online", () => check());
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("controllerchange", () => check());
  }

  return { init, check, applyUpdate, later, get version() { return runningVersion(); }, get latest() { return latest; } };
})();
