/* =========================================================
   inbox.js — "Ledger", the Tax App side of the FCGA agents:
   picks up work orders filed by Dispatch (the intake agent).

   The intake agent (Claude) files each FCGA work-order email into
   Work Orders\CYxx\P#xxxxx_…\ and writes a job.json there using this
   app's work-order field names. Pick the Work Orders folder once
   (Settings → 📥 Work-order inbox). After that, whenever the app opens
   or comes back into focus, it:
     • adds work orders it hasn't seen, with the work-order PDF attached;
     • applies FCGA revisions (e.g. mileage No → Yes) to existing work
       orders, without overwriting fields you have edited yourself;
     • stamps job.json so the agent knows the tracker is up to date.
   Needs Chrome or Edge on the computer that holds the folder. Phones
   get the records through the normal GitHub sync.
   ========================================================= */
"use strict";

const Inbox = (() => {
  const DB = "anstett_inbox", STORE = "handles", KEY = "workOrdersRoot";
  const FIELDS = [
    "woNumber", "projectNumber", "dateAssigned", "status", "fieldEngineer", "peNumber", "coaNumber",
    "insuranceCarrier", "carrierContact", "carrierContactPhone", "claimNumber", "policyNumber", "catNumber",
    "dateOfLoss", "jobType", "serviceType", "residentialCommercial", "insuredName", "insuredContact",
    "insuredPhone", "insuredEmail", "lossLocation", "workState", "descriptionOfLoss", "descriptionOfProperty",
    "scopeOfService", "additionalNotes", "paContact", "paPhoneEmail", "attorneyContact", "attorneyPhoneEmail",
    "feeType", "flatFee", "mileageAllowed", "mileageAmount", "reportRemittance", "invoiceRemittance",
    "uploadLocation",
  ];

  let root = null;          // FileSystemDirectoryHandle for "Work Orders"
  let busy = false;
  let lastScanAt = 0;
  let last = null;          // { at, imported: [...], needsPermission, error }

  const supported = () => typeof window.showDirectoryPicker === "function";

  /* ---------- remembered folder (IndexedDB can store directory handles) ---------- */
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }
  const loadRoot = () => idb("readonly", s => s.get(KEY)).catch(() => null);
  const saveRoot = h => idb("readwrite", s => s.put(h, KEY));
  const clearRoot = () => idb("readwrite", s => s.delete(KEY));

  /* ---------- folder walk ---------- */
  // Work Orders\CYxx\P#…  and  Work Orders\CYxx\<Complete | Peer Review Pending | Working | …>\P#…
  async function* jobDirs(dir) {
    const yy = new Date().getFullYear() % 100;
    for await (const [name, h] of dir.entries()) {
      const m = /^CY(\d{2})$/i.exec(name);
      if (h.kind !== "directory" || !m || Number(m[1]) < yy - 1) continue;
      for await (const [n2, h2] of h.entries()) {
        if (h2.kind !== "directory") continue;
        if (/^P#/i.test(n2)) { yield { handle: h2, path: `${name}/${n2}` }; continue; }
        for await (const [n3, h3] of h2.entries()) {
          if (h3.kind === "directory" && /^P#/i.test(n3)) yield { handle: h3, path: `${name}/${n2}/${n3}` };
        }
      }
    }
  }

  async function readJson(dir, name) {
    try {
      const fh = await dir.getFileHandle(name);
      return JSON.parse(await (await fh.getFile()).text());
    } catch (e) { return null; }
  }

  /** One line in the job's "00_Agent Log.md" (shared with Dispatch, Recon, Scribe, …). */
  async function agentLog(dir, text) {
    try {
      let prior = "";
      try { prior = await (await (await dir.getFileHandle("00_Agent Log.md")).getFile()).text(); } catch (e) { prior = "# Agent log\r\n\r\n"; }
      const d = new Date();
      const p2 = n => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
      const line = `- ${stamp} \u00b7 **Ledger** \u00b7 ${text}\r\n`;
      const fh = await dir.getFileHandle("00_Agent Log.md", { create: true });
      const w = await fh.createWritable();
      await w.write(prior + (prior.endsWith("\n") ? "" : "\r\n") + line);
      await w.close();
    } catch (e) { console.warn("Ledger: could not write the agent log", e); }
  }

  async function markLogged(dir, job, at) {
    try {
      job.pipeline = { ...(job.pipeline || {}), trackerLogged: at };
      const fh = await dir.getFileHandle("job.json");
      const w = await fh.createWritable();
      await w.write(JSON.stringify(job, null, 2));
      await w.close();
    } catch (e) { console.warn("Inbox: could not stamp job.json", e); }
  }

  /* ---------- record helpers ---------- */
  function findExisting(wo) {
    return Store.all("workOrder").find(w =>
      (wo.projectNumber && String(w.projectNumber) === String(wo.projectNumber)) ||
      (wo.claimNumber && w.claimNumber === wo.claimNumber));
  }

  const blank = v => v === undefined || v === null || v === "";
  const same = (a, b) => (blank(a) && blank(b)) || String(a) === String(b);

  function pickPE(wo) {
    if (wo.peNumber) return wo.peNumber;
    const pes = (Store.state.settings.peNumbers || []).filter(p => p.number);
    const byState = pes.find(p => p.state && p.state.toUpperCase() === wo.workState);
    return byState ? byState.number : (pes.length === 1 ? pes[0].number : "");
  }

  async function attachPdf(dir, job, workOrder) {
    const name = job.source && job.source.pdf;
    if (!name) return false;
    const already = Store.all("receipt").some(r => r.workOrderId === workOrder.id && r.reference === name);
    if (already) return false;
    try {
      const file = await (await dir.getFileHandle(name)).getFile();
      const dataUrl = await Store.Attachments.fileToDataUrl(file);
      const attId = U.uid("att");
      await Store.Attachments.put({ id: attId, name, type: file.type || "application/pdf", dataUrl });
      Store.add("receipt", {
        date: workOrder.dateAssigned || U.todayISO(),
        vendor: "FCG Associates (FCGA)",
        amount: null, status: "Attached",
        reference: name,
        workOrderId: workOrder.id,
        attachmentId: attId, attachmentName: name,
        notes: `Work order PDF for ${workOrder.woNumber || workOrder.projectNumber || "job"} (filed by intake).`,
      });
      return true;
    } catch (e) {
      console.warn("Inbox: could not attach", name, e);
      return false;
    }
  }

  /** One job folder → tracker. Returns a result line or null when nothing changed. */
  async function applyJob(dir, path, job) {
    const wo = job.workOrder || {};
    const key = job.source && job.source.pdfSha256;
    if (!key || !wo.projectNumber) return null;
    const existing = findExisting(wo);
    if (existing && existing.intakeKey === key) {
      if (!(job.pipeline && job.pipeline.trackerLogged)) await markLogged(dir, job, U.nowISO());
      return null;
    }
    const now = U.nowISO();
    const stamp = U.fmtDate ? U.fmtDate(U.todayISO()) : U.todayISO();

    if (!existing) {
      const vals = {};
      for (const f of FIELDS) if (!blank(wo[f])) vals[f] = wo[f];
      const s = Store.state.settings;
      Object.assign(vals, {
        status: "New",
        clientId: ImportWO.fcgaClient().id,
        fieldEngineer: wo.fieldEngineer || s.engineerName || "",
        peNumber: pickPE(wo),
        coaNumber: wo.coaNumber || s.coaNumber || "",
        officeState: s.officeState || "",
        fieldWorkPct: s.defaultFieldWorkPct ?? 50,
        intakeKey: key,
        jobFolder: path,
        internalNotes: `Filed automatically from the FCGA email on ${stamp}. Job folder: Work Orders/${path}`,
      });
      const rec = Store.add("workOrder", vals);
      if (!rec) return { kind: "error", label: vals.woNumber, text: "year is locked — not added" };
      await attachPdf(dir, job, rec);
      await markLogged(dir, job, now);
      await agentLog(dir, `added ${rec.woNumber} to the Tax App (status New, work-order PDF attached)`);
      return { kind: "new", label: rec.woNumber, text: `${rec.insuredName || ""} — ${rec.lossLocation || ""}` };
    }

    // existing record: apply the latest FCGA revision where the record still matches the old value
    const rev = (job.revisions || []).slice(-1)[0];
    const patch = {}, applied = [], kept = [];
    for (const c of (rev && rev.changes) || []) {
      if (!FIELDS.includes(c.field)) continue;
      const cur = existing[c.field];
      if (same(cur, c.new)) continue;
      if (same(cur, c.old) || blank(cur)) { patch[c.field] = c.new; applied.push(c.field); }
      else kept.push(`${c.field}: FCGA now says "${c.new}", your record has "${cur}" (left as is)`);
    }
    const lines = [];
    if (applied.length) lines.push(`FCGA revision applied ${stamp}: ${applied.join(", ")}.`);
    if (kept.length) lines.push(`FCGA revision ${stamp} — check: ${kept.join("; ")}.`);
    if (lines.length) patch.internalNotes = [existing.internalNotes, ...lines].filter(Boolean).join("\n");
    Store.update("workOrder", existing.id, { ...patch, intakeKey: key, jobFolder: path });
    const attached = await attachPdf(dir, job, existing);
    await markLogged(dir, job, now);
    if (!applied.length && !kept.length && !attached) return null;
    await agentLog(dir, [
      applied.length ? `applied the FCGA revision to ${existing.woNumber}: ${applied.join(", ")}` : "",
      kept.length ? `left ${kept.length} revised field(s) for your review (you had edited them): ${kept.map(k => k.split(":")[0]).join(", ")}` : "",
      attached && !applied.length && !kept.length ? `attached the new work-order PDF to ${existing.woNumber}` : "",
    ].filter(Boolean).join("; "));
    return {
      kind: kept.length ? "check" : "revised",
      label: existing.woNumber,
      text: applied.length || kept.length
        ? [applied.length ? `updated ${applied.join(", ")}` : "", kept.length ? `${kept.length} change(s) need your review` : ""].filter(Boolean).join("; ")
        : "new work-order PDF attached",
    };
  }

  /* ---------- scan ---------- */
  async function scan({ interactive = false } = {}) {
    if (!supported() || busy) return last;
    if (!root) root = await loadRoot();
    if (!root) return last;
    let perm = await root.queryPermission({ mode: "readwrite" });
    if (perm !== "granted" && interactive) perm = await root.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      last = { at: U.nowISO(), imported: [], needsPermission: true };
      return last;
    }
    busy = true;
    lastScanAt = Date.now();
    const imported = [];
    try {
      for await (const { handle, path } of jobDirs(root)) {
        const job = await readJson(handle, "job.json");
        if (!job || !String(job.schema || "").startsWith("fcga-job/")) continue;
        try {
          const r = await applyJob(handle, path, job);
          if (r) imported.push(r);
        } catch (e) {
          imported.push({ kind: "error", label: path, text: e.message || String(e) });
        }
      }
      last = { at: U.nowISO(), imported, needsPermission: false };
      if (imported.length) {
        const head = imported.slice(0, 3).map(r => `${r.label} (${r.kind})`).join(", ");
        UI.toast(`📥 Ledger: ${head}${imported.length > 3 ? ` +${imported.length - 3} more` : ""}`,
          imported.some(r => r.kind === "error" || r.kind === "check") ? "error" : "success", 7000);
        App.rerenderIfIdle();
      } else if (interactive) {
        UI.toast("📥 Ledger checked the job folders — nothing new", "default", 2500);
      }
    } catch (e) {
      console.warn("Inbox scan failed:", e);
      last = { at: U.nowISO(), imported, error: e.message || String(e) };
      if (interactive) UI.toast("Inbox check failed: " + last.error, "error", 6000);
    } finally {
      busy = false;
    }
    return last;
  }

  async function choose() {
    const h = await window.showDirectoryPicker({ id: "work-orders", mode: "readwrite" });
    if (!/work\s*orders/i.test(h.name)) {
      const ok = await UI.confirm("Is this the right folder?",
        `You picked <strong>${U.escapeHtml(h.name)}</strong>. The inbox expects your <strong>Work Orders</strong> folder (the one that holds CY26, CY25, …).`,
        { confirmLabel: "Use it anyway" });
      if (!ok) return last;
    }
    root = h;
    await saveRoot(h);
    return scan({ interactive: true });
  }

  async function disconnect() {
    root = null;
    last = null;
    await clearRoot();
  }

  function init() {
    if (!supported()) return;
    const quiet = () => { if (Date.now() - lastScanAt > 60 * 1000) scan().catch(() => {}); };
    setTimeout(() => scan().then(r => {
      if (r && r.needsPermission) {
        UI.toast("📥 Ledger needs your OK to read the job folders — Settings → Ledger → Check now", "default", 7000);
      }
    }).catch(() => {}), 3500);
    window.addEventListener("focus", quiet);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") quiet(); });
    setInterval(() => { if (document.visibilityState !== "hidden") quiet(); }, 5 * 60 * 1000);
  }

  return {
    init, scan, choose, disconnect, supported,
    /** The watched folder's name, or null when none is set on this computer. */
    async folderName() { if (!root) root = await loadRoot(); return root ? (root.name || "Work Orders") : null; },
    get last() { return last; },
  };
})();
