/* =========================================================
   sync.js — automatic multi-device sync via a PRIVATE GitHub
   repo. Every device pushes its changes and pulls everyone
   else's; newest edit wins per record, deletions propagate
   via tombstones, and receipt attachments ride along as
   individual files. The repo doubles as an off-device backup
   with full history (every sync is a git commit).

   Layout in the data repo:
     data.json               — full record state (no attachments)
     attachments/<id>.json   — one file per receipt image/PDF
   ========================================================= */
"use strict";

const Sync = (() => {
  const CFG_KEY = "anstett_sync_v1";
  const API = "https://api.github.com";

  let cfg = {
    enabled: false,
    repoFull: "",        // "owner/repo"
    token: "",
    lastSyncAt: null,
    lastSettingsFp: "",  // fingerprint of settings at last sync, to stamp settingsUpdatedAt
  };
  let running = false, queued = false, applying = false;
  let lastError = "";
  let scheduleTimer = null;

  /* ---------- config ---------- */
  function loadCfg() {
    try { cfg = { ...cfg, ...(JSON.parse(localStorage.getItem(CFG_KEY)) || {}) }; } catch (e) {}
  }
  function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

  /* ---------- GitHub API helpers ---------- */
  function api(path, { method = "GET", accept = "application/vnd.github+json", body } = {}) {
    return fetch(API + path, {
      method,
      headers: {
        "Authorization": "Bearer " + cfg.token,
        "Accept": accept,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /** Unicode-safe base64 */
  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /** path → blob sha for every file in the repo, or null if the repo is empty */
  async function getTree() {
    const res = await api(`/repos/${cfg.repoFull}/git/trees/HEAD?recursive=1`);
    if (res.status === 404 || res.status === 409) return null; // empty repo
    if (!res.ok) throw new Error(`GitHub ${res.status} reading repo tree`);
    const json = await res.json();
    const map = {};
    for (const t of json.tree || []) if (t.type === "blob") map[t.path] = t.sha;
    return map;
  }

  async function getRaw(path) {
    const res = await api(`/repos/${cfg.repoFull}/contents/${path}`, { accept: "application/vnd.github.raw+json" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status} reading ${path}`);
    return res.text();
  }

  async function putFile(path, contentStr, sha) {
    const res = await api(`/repos/${cfg.repoFull}/contents/${path}`, {
      method: "PUT",
      body: { message: `sync: ${path}`, content: b64(contentStr), ...(sha ? { sha } : {}) },
    });
    if (res.status === 409 || res.status === 422) { const e = new Error("conflict"); e.conflict = true; throw e; }
    if (!res.ok) throw new Error(`GitHub ${res.status} writing ${path}`);
    return res.json();
  }

  async function delFile(path, sha) {
    const res = await api(`/repos/${cfg.repoFull}/contents/${path}`, {
      method: "DELETE",
      body: { message: `sync: remove ${path}`, sha },
    });
    if (res.status === 409 || res.status === 422) { const e = new Error("conflict"); e.conflict = true; throw e; }
    if (!res.ok && res.status !== 404) throw new Error(`GitHub ${res.status} deleting ${path}`);
  }

  /* ---------- merge ---------- */
  const COLLECTIONS = ["clients", "workOrders", "invoices", "income", "expenses", "mileage",
    "receipts", "assets", "contractors", "taxPayments", "form1099s"];
  const recTime = r => r.updatedAt || r.createdAt || "";

  function settingsFingerprint(s) {
    const c = { ...(s || {}) };
    delete c.theme; delete c.lastBackupAt; // device-local / incidental
    return JSON.stringify(c);
  }

  /** Merge remote state into local: newest edit wins per record; tombstones delete. */
  function mergeStates(local, remote) {
    const merged = U.clone(local);

    // union tombstones (newest per record id)
    const tombs = {};
    for (const t of [...(local.tombstones || []), ...(remote.tombstones || [])]) {
      if (!tombs[t.id] || tombs[t.id].at < t.at) tombs[t.id] = t;
    }
    merged.tombstones = Object.values(tombs).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 2000);

    for (const c of COLLECTIONS) {
      const remoteById = new Map((remote[c] || []).map(r => [r.id, r]));
      const seen = new Set();
      const out = [];
      for (const r of (local[c] || [])) {
        seen.add(r.id);
        const rr = remoteById.get(r.id);
        const pick = rr && recTime(rr) > recTime(r) ? rr : r;
        const tb = tombs[r.id];
        if (tb && tb.at > recTime(pick)) continue; // deleted on some device after last edit
        out.push(pick);
      }
      for (const [id, rr] of remoteById) {
        if (seen.has(id)) continue;
        const tb = tombs[id];
        if (tb && tb.at > recTime(rr)) continue;
        out.push(rr);
      }
      merged[c] = out;
    }

    // audit log: union by entry id, newest first, capped
    const haveAudit = new Set((local.auditLog || []).map(a => a.id));
    merged.auditLog = [...(local.auditLog || []), ...(remote.auditLog || []).filter(a => !haveAudit.has(a.id))]
      .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 4000);

    // settings: newest stamp wins; theme always stays local
    if ((remote.settingsUpdatedAt || "") > (local.settingsUpdatedAt || "")) {
      merged.settings = { ...remote.settings, theme: (local.settings || {}).theme };
      merged.settingsUpdatedAt = remote.settingsUpdatedAt;
    }
    // home office: it carries its own updatedAt
    if (((remote.homeOffice || {}).updatedAt || "") > ((local.homeOffice || {}).updatedAt || "")) {
      merged.homeOffice = remote.homeOffice;
    }
    // year checklists: merge per year, local wins per item
    for (const [y, obj] of Object.entries(remote.yearChecklists || {})) {
      merged.yearChecklists[y] = { ...(obj || {}), ...(merged.yearChecklists[y] || {}) };
    }
    merged.lockedYears = [...new Set([...(local.lockedYears || []), ...(remote.lockedYears || [])])].sort();
    merged.demoDataLoaded = !!(local.demoDataLoaded || remote.demoDataLoaded);
    return merged;
  }

  /** every attachmentId referenced by any record */
  function referencedAttachmentIds(state) {
    const ids = new Set();
    for (const c of COLLECTIONS) for (const r of (state[c] || [])) if (r.attachmentId) ids.add(r.attachmentId);
    return ids;
  }

  /* ---------- status indicator ---------- */
  function setStatus(state, message = "") {
    lastError = state === "error" ? message : "";
    const icon = { syncing: "🔄", ok: "☁️", error: "⚠️", off: "" }[state] || "";
    const text = { syncing: "Syncing…", ok: "Synced " + (cfg.lastSyncAt ? new Date(cfg.lastSyncAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : ""), error: "Sync error", off: "" }[state] || "";
    const el = document.getElementById("sync-indicator");
    if (el) {
      el.hidden = !cfg.enabled;
      el.title = message || text;
      const t = document.getElementById("sync-indicator-text");
      if (t) t.textContent = text;
      const ic = document.getElementById("sync-indicator-icon");
      if (ic) ic.textContent = icon;
    }
    const mob = document.getElementById("sync-mobile");
    if (mob) { mob.hidden = !cfg.enabled; mob.textContent = icon || "☁️"; mob.title = message || text; }
  }

  /* ---------- the sync pass ---------- */
  async function sync({ manual = false, attempt = 0 } = {}) {
    if (!cfg.enabled || !cfg.token || !cfg.repoFull) return { skipped: true };
    if (!navigator.onLine) { if (manual) UI.toast("You're offline — will sync when back online", "default"); return { skipped: true }; }
    if (running) { queued = true; return { queued: true }; }
    running = true;
    setStatus("syncing");
    try {
      // stamp settings age so the merged winner is the device that actually changed them
      const fp = settingsFingerprint(Store.state.settings);
      if (cfg.lastSettingsFp && fp !== cfg.lastSettingsFp) {
        Store.state.settingsUpdatedAt = U.nowISO();
      }

      const tree = await getTree() || {};
      let remoteState = null;
      if (tree["data.json"]) {
        const parsed = JSON.parse(await getRaw("data.json"));
        remoteState = parsed.data || parsed;
      }

      const local = Store.state;
      const merged = remoteState ? mergeStates(local, remoteState) : U.clone(local);

      // apply pulled changes locally
      const localJson = JSON.stringify(local);
      const mergedJson = JSON.stringify(merged);
      let pulledChanges = false;
      if (mergedJson !== localJson) {
        applying = true;
        try { Store.applySynced(merged); } finally { applying = false; }
        pulledChanges = true;
      }

      // push if remote differs
      if (!remoteState || JSON.stringify(remoteState) !== JSON.stringify(Store.state)) {
        const payload = JSON.stringify({
          app: "Anstett Consulting — Books & Tax Organizer",
          syncedAt: U.nowISO(),
          schemaVersion: Store.state.schemaVersion,
          data: Store.state,
        });
        await putFile("data.json", payload, tree["data.json"]);
      }

      // attachments: upload missing remote, download missing local, prune orphans
      const needed = referencedAttachmentIds(Store.state);
      const localIds = new Set(await Store.Attachments.listIds());
      const remoteIds = new Set(Object.keys(tree).filter(p => p.startsWith("attachments/")).map(p => p.slice("attachments/".length, -".json".length)));
      let attMoved = 0;
      for (const id of needed) {
        if (localIds.has(id) && !remoteIds.has(id)) {
          const rec = await Store.Attachments.get(id);
          if (rec) { await putFile(`attachments/${id}.json`, JSON.stringify(rec)); attMoved++; }
        } else if (!localIds.has(id) && remoteIds.has(id)) {
          const txt = await getRaw(`attachments/${id}.json`);
          if (txt) { await Store.Attachments.put(JSON.parse(txt)); attMoved++; pulledChanges = true; }
        }
      }
      // prune remote attachments no record references anymore (local orphans are
      // left alone — deleting records already removes their file explicitly)
      for (const id of remoteIds) {
        if (!needed.has(id)) await delFile(`attachments/${id}.json`, tree[`attachments/${id}.json`]);
      }

      cfg.lastSyncAt = U.nowISO();
      cfg.lastSettingsFp = settingsFingerprint(Store.state.settings);
      saveCfg();
      setStatus("ok");
      if (pulledChanges && window.App) App.rerender();
      if (manual) UI.toast("Sync complete ✓", "success");
      return { ok: true, pulledChanges, attMoved };
    } catch (e) {
      if (e.conflict && attempt < 2) {
        running = false;
        return sync({ manual, attempt: attempt + 1 }); // another device pushed mid-sync — re-pull and retry
      }
      console.warn("Sync failed:", e);
      const msg = /401|403/.test(e.message) ? "Sync token invalid or expired — update it in Settings" : "Sync failed: " + e.message;
      setStatus("error", msg);
      if (manual) UI.toast(msg, "error", 6000);
      return { error: msg };
    } finally {
      running = false;
      if (queued) { queued = false; scheduleSync(1500); }
    }
  }

  function scheduleSync(ms = 4000) {
    if (!cfg.enabled) return;
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(() => sync(), ms);
  }

  /* ---------- enable / disable ---------- */
  async function enable(repoFull, token) {
    const probe = await fetch(API + `/repos/${repoFull}`, {
      headers: { "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (probe.status === 401) throw new Error("GitHub didn't accept that token. Copy it again (it starts with github_pat_ or ghp_).");
    if (probe.status === 404) throw new Error(`Can't see ${repoFull} with that token. Make sure the token's "Repository access" includes it.`);
    if (!probe.ok) throw new Error(`GitHub error ${probe.status} checking the repo.`);
    const repo = await probe.json();
    if (!repo.private) throw new Error(`${repoFull} is PUBLIC — sync only writes to a private repo. Pick the private data repo.`);
    if (!repo.permissions || !repo.permissions.push) throw new Error(`That token can read ${repoFull} but not write. Set the token's Contents permission to "Read and write".`);
    cfg.enabled = true;
    cfg.repoFull = repoFull;
    cfg.token = token;
    // this device's settings are the freshest at the moment sync is switched on
    Store.state.settingsUpdatedAt = Store.state.settingsUpdatedAt || U.nowISO();
    cfg.lastSettingsFp = ""; // force a stamp check next pass
    saveCfg();
    setStatus("syncing");
    return sync({ manual: true });
  }

  function disable() {
    cfg.enabled = false;
    cfg.token = "";
    saveCfg();
    setStatus("off");
  }

  /* ---------- wiring ---------- */
  function init() {
    loadCfg();
    setStatus(cfg.enabled ? "ok" : "off");
    // wire triggers unconditionally — scheduleSync() is a no-op while disabled,
    // so enabling later in Settings starts syncing without a reload
    Store.onSave(() => { if (!applying) scheduleSync(); });
    window.addEventListener("online", () => scheduleSync(2000));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" &&
          (!cfg.lastSyncAt || Date.now() - new Date(cfg.lastSyncAt).getTime() > 60000)) scheduleSync(1200);
    });
    setInterval(() => scheduleSync(0), 4 * 60 * 1000);
    const mob = document.getElementById("sync-mobile");
    if (mob) mob.addEventListener("click", () => sync({ manual: true }));
    if (cfg.enabled) scheduleSync(800);
  }

  return {
    init, enable, disable,
    now: () => sync({ manual: true }),
    get config() { return { enabled: cfg.enabled, repoFull: cfg.repoFull, lastSyncAt: cfg.lastSyncAt, hasToken: !!cfg.token }; },
    get lastError() { return lastError; },
  };
})();
