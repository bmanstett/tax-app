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
      // GitHub marks API answers fresh for 60 s. Served from the browser's cache, a poll
      // sees a minute-old repo: the other device's change arrives late, and a write made
      // against the stale file sha is refused (409) and retried against the same stale copy.
      cache: "no-store",
      headers: {
        "Authorization": "Bearer " + cfg.token,
        "Accept": accept,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /** A failed request as an Error. GitHub also answers 403 (or 429) when it is rate-limiting —
      a burst of attachment uploads does it. That is not a bad token: the error carries how
      long GitHub asked us to stay away (waitMs), and sync waits that out. */
  const ghErr = (res, what) => {
    const limited = (res.status === 403 || res.status === 429) &&
      (res.headers.get("retry-after") || res.headers.get("x-ratelimit-remaining") === "0");
    const e = new Error(`GitHub ${res.status}${limited ? " rate-limited" : ""} ${what}`);
    if (limited) e.waitMs = Math.min(Math.max(Number(res.headers.get("retry-after")) || 60, 60), 600) * 1000;
    return e;
  };

  /** Unicode-safe base64 */
  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /** The repo's HEAD commit — a 40-character answer to "has anything changed?"; "" when the repo is empty. */
  async function getHead() {
    const res = await api(`/repos/${cfg.repoFull}/commits/HEAD`, { accept: "application/vnd.github.sha" });
    if (res.status === 404 || res.status === 409 || res.status === 422) return "";
    if (!res.ok) throw ghErr(res, "reading repo head");
    return (await res.text()).trim();
  }

  /** path → blob sha for every file in the repo, or null if the repo is empty */
  async function getTree() {
    const res = await api(`/repos/${cfg.repoFull}/git/trees/HEAD?recursive=1`);
    if (res.status === 404 || res.status === 409) return null; // empty repo
    if (!res.ok) throw ghErr(res, "reading repo tree");
    const json = await res.json();
    const map = {};
    for (const t of json.tree || []) if (t.type === "blob") map[t.path] = t.sha;
    return map;
  }

  async function getRaw(path) {
    const res = await api(`/repos/${cfg.repoFull}/contents/${path}`, { accept: "application/vnd.github.raw+json" });
    if (res.status === 404) return null;
    if (!res.ok) throw ghErr(res, `reading ${path}`);
    return res.text();
  }

  async function putFile(path, contentStr, sha) {
    const res = await api(`/repos/${cfg.repoFull}/contents/${path}`, {
      method: "PUT",
      body: { message: `sync: ${path}`, content: b64(contentStr), ...(sha ? { sha } : {}) },
    });
    if (res.status === 409 || res.status === 422) { const e = new Error("conflict"); e.conflict = true; throw e; }
    if (!res.ok) throw ghErr(res, `writing ${path}`);
    return res.json();
  }

  async function delFile(path, sha) {
    const res = await api(`/repos/${cfg.repoFull}/contents/${path}`, {
      method: "DELETE",
      body: { message: `sync: remove ${path}`, sha },
    });
    if (res.status === 409 || res.status === 422) { const e = new Error("conflict"); e.conflict = true; throw e; }
    if (!res.ok && res.status !== 404) throw ghErr(res, `deleting ${path}`);
  }

  /* ---------- merge ---------- */
  const COLLECTIONS = ["clients", "workOrders", "invoices", "income", "expenses", "mileage",
    "receipts", "assets", "contractors", "taxPayments", "form1099s", "officeBills"];
  const recTime = r => r.updatedAt || r.createdAt || "";

  /** Newest first, ties broken by id — the same order on every pass and on every device.
      (The comparator this replaces answered "b first" for two entries stamped in the same
      millisecond whichever way round they came, so each sort swapped them: every sync then
      looked like a pulled change, redrew the page and re-uploaded the books.) */
  const newestFirst = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  /** A copy's last-backup date. In data.json it sits beside the settings, not inside them
      (forRepo): a device still on build 2026.11.10 ranks a blank date inside the profile above
      a real one and uploads its blank over it each time it sees one, so two devices on
      different builds would re-upload the books at each other for as long as both were open.
      Beside the settings, that build leaves the date alone. Both places are read — a copy
      written by that build can carry the date in its settings. */
  const backupDate = st => [st.lastBackupAt || "", (st.settings || {}).lastBackupAt || ""].sort()[1];
  /** The books as data.json holds them. */
  const forRepo = st => ({ ...st, settings: { ...st.settings, lastBackupAt: null }, lastBackupAt: backupDate(st) || null });

  /** Everything that syncs, as one string that doesn't care what order the lists are in.
      Two devices holding the same books never produced the same raw JSON — a record pulled
      from the other device sits at the end of the list here and at the front there, and
      each device has its own first-run date and theme — so they used to re-upload the whole
      file over each other for as long as both were open. */
  function fingerprint(s) {
    const set = arr => (arr || []).map(x => JSON.stringify(x)).sort();
    const o = {   // canon(): keys in a fixed order, so {a, b} and {b, a} read the same

      settings: canon({ ...(s.settings || {}), theme: "", lastBackupAt: "" }), backupAt: backupDate(s),
      settingsUpdatedAt: s.settingsUpdatedAt || "",
      homeOffice: canon(s.homeOffice || {}), yearChecklists: canon(s.yearChecklists || {}),
      lockedYears: [...(s.lockedYears || [])].map(Number).sort(), dupeIgnores: [...(s.dupeIgnores || [])].sort(),
      demoDataLoaded: !!s.demoDataLoaded,
      tombstones: set(s.tombstones), auditLog: (s.auditLog || []).map(a => a.id).sort(),
    };
    for (const c of COLLECTIONS) o[c] = set(s[c]);
    return JSON.stringify(o);
  }

  /** Merge remote state into local: newest edit wins per record; tombstones delete. */
  function mergeStates(local, remote) {
    const merged = U.clone(local);

    // union tombstones (newest per record id)
    const tombs = {};
    for (const t of [...(local.tombstones || []), ...(remote.tombstones || [])]) {
      if (!tombs[t.id] || tombs[t.id].at < t.at) tombs[t.id] = t;
    }
    merged.tombstones = Object.values(tombs).sort(newestFirst).slice(0, 2000);

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
      .sort(newestFirst).slice(0, 4000);

    const s = mergeSettings(local, remote);
    // The Tax Savings plan carries its own stamp (taxideas.js): whichever profile wins, the
    // plan edited last stays, so marking an idea done on the phone and saving something in
    // Settings on the computer don't cancel each other. On a first sync the rules above
    // decide instead (a newcomer never replaces the synced plan) — except that a plan is
    // never dropped for no plan at all.
    const planAt = p => (p && p.updatedAt) || "";
    for (const p of [(local.settings || {}).taxPlan, (remote.settings || {}).taxPlan]) {
      const cur = s.settings.taxPlan;
      if (p && (!cur || (cfg.lastSyncAt && planAt(p) > planAt(cur)))) s.settings.taxPlan = U.clone(p);
    }
    // The last-backup date is saved without stamping the profile (Store.markBackedUp), so it
    // can't ride on whichever profile wins: the later date is kept. (Left to the equal-stamp
    // tie-break it lost to a blank — "null" sorts above any date — so the date was wiped at
    // the next pull and the backup reminder never cleared.)
    const backupAt = [local, remote].map(backupDate).sort()[1];
    if (backupAt) s.settings.lastBackupAt = backupAt;
    merged.settings = s.settings;
    merged.settingsUpdatedAt = s.stamp;
    // home office: it carries its own updatedAt
    if (((remote.homeOffice || {}).updatedAt || "") > ((local.homeOffice || {}).updatedAt || "")) {
      merged.homeOffice = remote.homeOffice;
    }
    // year checklists: merge per year, local wins per item…
    merged.yearChecklists = merged.yearChecklists || {};   // (a copy from an old build may not have one)
    for (const [y, obj] of Object.entries(remote.yearChecklists || {})) {
      merged.yearChecklists[y] = { ...(obj || {}), ...(merged.yearChecklists[y] || {}) };
    }
    // …except an item with a tick or untick in the merged audit trail (Store.setYearCheck):
    // its newest entry decides, on every device. "Local wins" alone meant an untick never
    // travelled — the other copy still had the tick and kept it. Items last touched before
    // entries were written have none, and stay as they are.
    const settled = new Set();
    for (const a of merged.auditLog) {   // newest first
      if (a.recordId !== "yearChecklist") continue;
      for (const c of a.changes || []) {
        const cut = String(c.field).indexOf(":");   // "2026:backup"
        if (cut < 1 || settled.has(c.field)) continue;
        settled.add(c.field);
        const y = c.field.slice(0, cut);
        (merged.yearChecklists[y] = merged.yearChecklists[y] || {})[c.field.slice(cut + 1)] = !!c.to;
      }
    }
    // locked years: union — except a year whose newest lock/unlock entry in the merged audit
    // trail is an unlock. A plain union meant an unlock never survived a sync: the other copy
    // still listed the year, so it was locked again a second later.
    const lastLockChange = y => {
      for (const a of merged.auditLog) {   // newest first
        if (a.recordId !== "yearLock") continue;
        for (const c of a.changes || []) {
          if (c.field === "lockedYear" && Number(c.to) === y) return "locked";
          if (c.field === "unlockedYear" && Number(c.from) === y) return "unlocked";
        }
      }
      return "";
    };
    // …and only when the two copies disagree: a year both list was locked again after that
    // entry (earlier builds re-locked every unlock at the next sync, leaving the entry behind —
    // honouring it now would quietly unlock the year on every device).
    const lists = (st, y) => (st.lockedYears || []).map(Number).includes(y);
    merged.lockedYears = [...new Set([...(local.lockedYears || []), ...(remote.lockedYears || [])].map(Number))]
      .filter(y => (lists(local, y) && lists(remote, y)) || lastLockChange(y) !== "unlocked").sort();
    // duplicate pairs dismissed as "keep both" — union, so reviewing on one device settles it
    // everywhere; except a pair whose newest note in the merged audit trail is an "undo"
    const lastDupe = {};
    for (const a of merged.auditLog) {   // newest first
      if (a.recordId !== "dupeReview") continue;
      for (const c of a.changes || []) if (c.to && !(c.to in lastDupe)) lastDupe[c.to] = c.field;
    }
    merged.dupeIgnores = [...new Set([...(local.dupeIgnores || []), ...(remote.dupeIgnores || [])])]
      .filter(k => lastDupe[k] !== "undidKeptBoth");
    merged.demoDataLoaded = !!(local.demoDataLoaded || remote.demoDataLoaded);
    return merged;
  }

  /** Settings travel as one profile: the newer save wins, and the winner keeps its own stamp
      (an older profile is never re-dated as new, so a later edit elsewhere still beats it).
      Three guards, after 2026-10-13, when a new install switching sync on blanked the business
      address, contact details and invoice defaults on every device:
      - a factory-fresh profile (a new install) never replaces a real one, whatever its stamp;
      - on this device's first sync, its own newer changes are laid over the synced profile key
        by key, never the whole profile: a phone that set one tax assumption before turning sync
        on brings that one value, not its blanks;
      - equal stamps with different content settle on the same profile on every device.
      The theme always stays local, and the last-backup date is settled apart (mergeStates).
      → {settings, stamp} */
  function mergeSettings(local, remote) {
    const ls = local.settings || {}, rs = remote.settings;
    const lt = local.settingsUpdatedAt || "", rt = remote.settingsUpdatedAt || "";
    const keepLocal = { settings: U.clone(ls), stamp: local.settingsUpdatedAt || null };
    if (!rs) return keepLocal;
    const takeRemote = { settings: U.clone({ ...rs, theme: ls.theme }), stamp: remote.settingsUpdatedAt || null };
    const lf = Store.isFactorySettings(ls), rf = Store.isFactorySettings(rs);
    if (lf !== rf) return lf ? takeRemote : keepLocal;
    if (!cfg.lastSyncAt && !lf) {
      if (lt <= rt) return takeRemote;   // the synced profile is the newer one
      // only values this device filled in: never a blank (a cleared Home base must not erase the
      // synced one), the theme, the backup date or the year-based defaults (a phone set up last
      // year would otherwise bring last year's mileage rates)
      const d = Store.defaultSettings(), mine = {};
      const blankValue = v => v === "" || v == null || (Array.isArray(v) && !v.length);
      for (const k of Object.keys(ls)) {
        if (OVERLAY_SKIPPED.includes(k) || blankValue(ls[k])) continue;
        if (k === "taxPlan" && rs.taxPlan) continue;   // one nested profile: a newcomer never replaces the synced Tax Savings plan
        if (canon(ls[k]) !== canon(d[k])) mine[k] = ls[k];
      }
      return { settings: U.clone({ ...rs, ...mine, theme: ls.theme }), stamp: local.settingsUpdatedAt };
    }
    if (lt !== rt) return rt > lt ? takeRemote : keepLocal;
    const bare = o => canon({ ...o, theme: null, lastBackupAt: null });   // (the backup date is settled apart — mergeStates)
    return bare(rs) > bare(ls) ? takeRemote : keepLocal;   // same stamp: the same pick everywhere
  }

  const OVERLAY_SKIPPED = ["theme", "lastBackupAt", "taxYear", "mileageRates", "mileageRatesH2"];

  /** JSON with object keys sorted, so the same settings compare equal on every device. */
  function canon(v) {
    if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
    return JSON.stringify(v === undefined ? null : v);
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

  /* ---------- one pull-merge-push pass (throws on error; e.conflict = 409/422) ----------
     NOTE: settings ownership comes ONLY from real edits (Store.markSettingsChanged stamps
     settingsUpdatedAt at save time). Never re-stamp here — a fingerprint heuristic used to
     do that and it let a device with a stale sync bookmark claim ownership of settings it
     hadn't touched, permanently out-voting genuine edits from the other device. */
  /* When nothing has changed on either side, a pass is one tiny request: "is the repo's HEAD
     still the commit we finished on?" The books are downloaded and merged only when it has
     moved, when something was saved here, or every few minutes as a safety net. (Every pass
     used to download and re-merge the whole file — every 20 seconds while the app was open.) */
  let dirty = true;        // something was saved on this device since its last full pass (unknown at launch)
  let seenRev = -1;        // Store.rev when a full pass last read the books (moves on every save, stored or not)
  let lastHead = "";       // the repo's HEAD when a full pass last ended without writing anything
  let lastFullAt = 0;
  const FULL_EVERY_MS = 5 * 60 * 1000;

  /** force: "Sync now" always looks properly. */
  async function syncOnce(force = false) {
    const head = await getHead();
    if (!force && !dirty && Store.rev === seenRev && head && head === lastHead && Date.now() - lastFullAt < FULL_EVERY_MS) {
      cfg.lastSyncAt = U.nowISO();
      saveCfg();
      return { pulledChanges: false, attMoved: 0, idle: true };   // nothing new here, nothing new there
    }
    dirty = false;           // cleared first: an edit that lands mid-pass sets it again
    let wrote = false;
    try {
      const tree = await getTree() || {};
      let remoteState = null;
      if (tree["data.json"]) {
        const parsed = JSON.parse(await getRaw("data.json"));
        remoteState = parsed.data || parsed;
      }

      if (!cfg.enabled) return { pulledChanges: false, attMoved: 0 };   // turned off mid-pass: don't merge the repo back in

      const local = Store.state;
      const merged = remoteState ? mergeStates(local, remoteState) : local;

      // apply pulled changes locally — only when the merge really brought something in
      let pulledChanges = false;
      if (remoteState && fingerprint(merged) !== fingerprint(local)) {
        applying = true;
        try { Store.applySynced(merged); } finally { applying = false; }
        pulledChanges = true;
      }

      seenRev = Store.rev;   // what the repo will hold after this pass; a later edit moves Store.rev on

      // push only when this device holds something the repo's copy lacks: merge our state INTO
      // the remote copy and see whether that changes it (theme, first-run date and list order
      // never do). data.json goes first — a sha conflict here just means re-merge and retry.
      if (!remoteState || fingerprint(mergeStates(remoteState, Store.state)) !== fingerprint(remoteState)) {
        const payload = JSON.stringify({
          app: "Anstett Consulting — Books & Tax Organizer",
          syncedAt: U.nowISO(),
          schemaVersion: Store.state.schemaVersion,
          data: forRepo(Store.state),
        });
        await putFile("data.json", payload, tree["data.json"]);
        wrote = true;
      }

      // attachments: upload missing remote, download missing local, prune orphans
      const needed = referencedAttachmentIds(Store.state);
      const localIds = new Set(await Store.Attachments.listIds());
      const remoteIds = new Set(Object.keys(tree).filter(p => p.startsWith("attachments/")).map(p => p.slice("attachments/".length, -".json".length)));
      let attMoved = 0;
      for (const id of needed) {
        if (localIds.has(id) && !remoteIds.has(id)) {
          const rec = await Store.Attachments.get(id);
          if (rec) { await putFile(`attachments/${id}.json`, JSON.stringify(rec)); attMoved++; wrote = true; }
        } else if (!localIds.has(id) && remoteIds.has(id)) {
          const txt = await getRaw(`attachments/${id}.json`);
          if (txt) { await Store.Attachments.put(JSON.parse(txt)); attMoved++; pulledChanges = true; }
        }
      }
      for (const id of remoteIds) {
        if (!needed.has(id)) { await delFile(`attachments/${id}.json`, tree[`attachments/${id}.json`]); wrote = true; }
      }

      cfg.lastSyncAt = U.nowISO();
      saveCfg();
      lastFullAt = Date.now();
      // Our own commits moved HEAD, so look once more next time and settle then. (Never take
      // the sha from our own write: another device's commit could sit just before it, unread.)
      lastHead = wrote ? "" : head;
      return { pulledChanges, attMoved };
    } catch (e) {
      dirty = true;   // unfinished — the next pass must look properly
      throw e;
    }
  }

  /* ---------- the sync pass (orchestration: one-at-a-time, resilient to conflicts) ---------- */
  let authPausedUntil = 0;   // the token was refused: stop asking (and nagging) for a while

  async function sync({ manual = false } = {}) {
    if (!cfg.enabled || !cfg.token || !cfg.repoFull) return { skipped: true };
    if (!manual && Date.now() < authPausedUntil) return { skipped: true };
    if (!navigator.onLine) { if (manual) UI.toast("You're offline — will sync when back online", "default"); return { skipped: true }; }
    if (running) { queued = true; return { queued: true }; }
    running = true;
    setStatus("syncing");
    try {
      let res;
      for (let attempt = 0; ; attempt++) {
        try { res = await syncOnce(manual); break; }
        catch (e) {
          // 409/422 = another device pushed between our read and write. Re-merge & retry
          // with exponential backoff + jitter so both devices don't collide again.
          if (e.conflict && attempt < 5) {
            await new Promise(r => setTimeout(r, 250 * Math.pow(2, attempt) + Math.random() * 500));
            continue;
          }
          throw e;
        }
      }
      setStatus("ok");
      authPausedUntil = 0;   // the token works (a manual retry, or the 403 was a rate limit): automatic passes resume
      // records pulled from another device may predate the payment defaults — tidy them too
      // (App and WO are top-level consts, not window properties — a `window.App` test is always
      // false; sync() only ever runs after every script has loaded, so the names are bound)
      if (res.pulledChanges) {
        // UI follow-ups on pulled records — never let one count as a sync failure
        try { App.tidyData(); App.rerenderIfIdle(); } catch (e) { console.warn("Post-sync tidy/redraw skipped:", e); }
        // jobs that arrived from the other device get asked: IRS mileage or expenses?
        try { WO.noticeArrivals(); } catch (e) { console.warn("Travel question skipped:", e); }
      }
      if (manual) UI.toast("Sync complete ✓", "success");
      return { ok: true, ...res };
    } catch (e) {
      if (e.conflict) {
        // repo was busy this whole pass — not an error; the next scheduled sync resolves it
        setStatus("ok");
        scheduleSync(5000 + Math.random() * 4000);
        return { deferred: true };
      }
      console.warn("Sync failed:", e);
      if (e.waitMs) {
        // rate-limited: polls and saves wait it out; "Sync now" still runs at once
        authPausedUntil = Date.now() + e.waitMs;
        setStatus("error", "GitHub asked sync to slow down — it resumes by itself");
        scheduleSync(e.waitMs + 1000 + Math.random() * 4000);
        if (manual) UI.toast("GitHub asked sync to slow down — it will resume by itself in a minute or so", "default", 5000);
        return { error: e.message };
      }
      const authErr = /^GitHub (401|403)\b/.test(e.message);   // (a rate-limited 403 never reaches this line)
      if (authErr) {
        // say so once, then re-check every 10 minutes (and at once on a manual sync or a new
        // token) — not on every 20-second poll, each with its own 7-second red toast
        const firstTime = Date.now() >= authPausedUntil;
        authPausedUntil = Date.now() + 10 * 60 * 1000;
        setStatus("error", "Sync paused — token invalid or expired");
        if (firstTime || manual) UI.toast("Sync paused — your GitHub token is invalid or expired. Update it in Settings.", "error", 7000);
      } else {
        setStatus("error", "Sync will retry");
        scheduleSync(9000 + Math.random() * 5000);
        if (manual) UI.toast("Sync hiccup — retrying automatically", "default", 3000);
      }
      return { error: e.message };
    } finally {
      running = false;
      if (queued) { queued = false; scheduleSync(1200 + Math.random() * 800); }
    }
  }

  function scheduleSync(ms = 1500) {
    if (!cfg.enabled) return;
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(() => sync(), ms);
  }

  /* ---------- enable / disable ---------- */
  async function enable(repoFull, token) {
    const probe = await fetch(API + `/repos/${repoFull}`, {
      cache: "no-store",
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
    // a device with its own filled-in profile claims it as sync is switched on; a new install's
    // factory profile claims nothing, so the synced profile comes down instead of blanking it
    if (!Store.state.settingsUpdatedAt && !Store.isFactorySettings(Store.state.settings))
      Store.state.settingsUpdatedAt = U.nowISO();
    dirty = true; lastHead = ""; authPausedUntil = 0;   // the first pass reads the repo properly
    saveCfg();
    setStatus("syncing");
    return sync({ manual: true });
  }

  function disable() {
    cfg.enabled = false;
    cfg.token = "";
    cfg.lastSyncAt = null;   // turning it back on is a first sync again (see mergeSettings)
    dirty = true; lastHead = "";
    saveCfg();
    setStatus("off");
  }

  /** After Clear ALL data: this device starts over, so its next sync is a first sync. */
  function forgetLastSync() { cfg.lastSyncAt = null; dirty = true; lastHead = ""; saveCfg(); }

  /* ---------- wiring ---------- */
  function init() {
    loadCfg();
    setStatus(cfg.enabled ? "ok" : "off");
    // wire triggers unconditionally — scheduleSync() is a no-op while disabled,
    // so enabling later in Settings starts syncing without a reload
    Store.onSave(() => { if (!applying) { dirty = true; scheduleSync(900); } });   // push edits ~1s after a change (coalesces rapid edits)
    window.addEventListener("online", () => scheduleSync(500));
    let lastFocusSync = 0;
    const focusSync = () => {
      // pull the latest when the app comes forward — but debounce so focus+visibility
      // (which both fire together) don't launch two syncs and collide.
      if (Date.now() - lastFocusSync < 1500) return;
      lastFocusSync = Date.now();
      clearTimeout(scheduleTimer); sync();
    };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") focusSync(); });
    window.addEventListener("focus", focusSync);
    // poll while foreground; jittered so two devices don't align. Quiet when hidden.
    setInterval(() => { if (document.visibilityState !== "hidden") scheduleSync(Math.random() * 2500); }, 20 * 1000);
    const mob = document.getElementById("sync-mobile");
    if (mob) mob.addEventListener("click", () => sync({ manual: true }));
    if (cfg.enabled) scheduleSync(800);
  }

  return {
    init, enable, disable, forgetLastSync,
    _merge: mergeStates, _fingerprint: fingerprint,   // exposed for self-checks only
    now: () => sync({ manual: true }),
    get config() { return { enabled: cfg.enabled, repoFull: cfg.repoFull, lastSyncAt: cfg.lastSyncAt, hasToken: !!cfg.token }; },
    get lastError() { return lastError; },
  };
})();
