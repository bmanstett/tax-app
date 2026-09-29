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
   A job folder and a tracker record are matched by project number (P#)
   only. FCGA gives every assignment its own P#, even a second or third
   report on a claim it has worked before, so the same claim number on a
   new P# is always a new work order, never a revision of the old one.
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
  const warnedTwice = new Set();   // P#s already reported as sitting in two job folders

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

  /** Stamps job.json: when Ledger logged the job, and under which tracker record
      (pipeline.trackerWO), so the Crew's status check can confirm it's the job's own P#. */
  async function markLogged(dir, job, at, woNumber) {
    try {
      job.pipeline = { ...(job.pipeline || {}), trackerLogged: at, ...(woNumber ? { trackerWO: woNumber } : {}) };
      const fh = await dir.getFileHandle("job.json");
      const w = await fh.createWritable();
      await w.write(JSON.stringify(job, null, 2));
      await w.close();
    } catch (e) { console.warn("Inbox: could not stamp job.json", e); }
  }

  /* ---------- record helpers ---------- */
  /** "21688", "P#21688", 21688 → "21688"; "" when there is no number. */
  const pnOf = v => (String(v ?? "").match(/\d+/) || [""])[0];
  /** The P# in a job-folder path: "CY26/Complete/P#21548_Supplment for P#21008" → "21548". */
  const folderPN = p => { const m = /^P#\s*(\d+)/i.exec(String(p || "").split("/").pop()); return m ? m[1] : ""; };

  /** The tracker record for this work order: same project number, nothing else.
      Never by claim number: FCGA opens a new P# for every assignment, including a
      supplement or a third report on the same claim, and each is its own work order.
      (Before 2026-09-29 a claim-number match filed P#21688 onto P#21548.) */
  function findExisting(wo) {
    const pn = pnOf(wo.projectNumber);
    if (!pn) return null;
    return Store.all("workOrder").find(w => pnOf(w.projectNumber) === pn) || null;
  }

  const blank = v => v === undefined || v === null || v === "";
  const same = (a, b) => (blank(a) && blank(b)) || String(a) === String(b);

  /** Drops repeated Ledger lines ("FCGA revision …") from a record's Internal Notes,
      keeping the first of each. Your own lines are never touched. null = nothing to do. */
  function tidyNotes(notes) {
    if (!notes) return null;
    const seen = new Set(), out = [];
    for (const line of String(notes).split("\n")) {
      if (/^FCGA revision /.test(line)) { if (seen.has(line)) continue; seen.add(line); }
      out.push(line);
    }
    const tidy = out.join("\n");
    return tidy === notes ? null : tidy;
  }

  function pickPE(wo) {
    if (wo.peNumber) return wo.peNumber;
    const pes = (Store.state.settings.peNumbers || []).filter(p => p.number);
    const byState = pes.find(p => p.state && p.state.toUpperCase() === wo.workState);
    return byState ? byState.number : (pes.length === 1 ? pes[0].number : "");
  }

  /** Attaches the job's work-order PDF to its record. Returns "attached", "moved from P#…"
      when the PDF had been filed under another P# (the old claim-number mix-up), or false. */
  async function attachPdf(dir, job, workOrder) {
    const name = job.source && job.source.pdf;
    if (!name) return false;
    const already = Store.all("receipt").some(r => r.workOrderId === workOrder.id && r.reference === name);
    if (already) return false;
    // This PDF already filed by Ledger under a different P#? Move that receipt here.
    const pn = pnOf(workOrder.projectNumber);
    const misfiled = Store.all("receipt").find(r => r.reference === name && r.workOrderId !== workOrder.id &&
      /\(filed by intake\)/.test(r.notes || "") && (() => {
        const other = Store.get("workOrder", r.workOrderId);
        return other && pnOf(other.projectNumber) !== pn;
      })());
    if (misfiled) {
      const from = Store.get("workOrder", misfiled.workOrderId).woNumber || "another job";
      const moved = Store.update("receipt", misfiled.id, {
        workOrderId: workOrder.id,
        date: workOrder.dateAssigned || misfiled.date,
        notes: `Work order PDF for ${workOrder.woNumber || workOrder.projectNumber || "job"} (filed by intake; moved from ${from}, where it had been filed by mistake).`,
      });
      if (moved) return `moved from ${from}`;
    }
    try {
      const file = await (await dir.getFileHandle(name)).getFile();
      const dataUrl = await Store.Attachments.fileToDataUrl(file);
      const attId = U.uid("att");
      await Store.Attachments.put({ id: attId, name, type: file.type || "application/pdf", dataUrl });
      const rec = Store.add("receipt", {
        date: workOrder.dateAssigned || U.todayISO(),
        vendor: "FCG Associates (FCGA)",
        amount: null, status: "Attached",
        reference: name,
        workOrderId: workOrder.id,
        attachmentId: attId, attachmentName: name,
        notes: `Work order PDF for ${workOrder.woNumber || workOrder.projectNumber || "job"} (filed by intake).`,
      });
      return rec ? "attached" : false;
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
    const now = U.nowISO();
    const stamp = U.fmtDate ? U.fmtDate(U.todayISO()) : U.todayISO();

    // Repair: the record is tied to another P#'s job folder. Only the old claim-number
    // match could do that (it filed P#21688 onto P#21548 and then flipped the record
    // between the two folders on every scan). Point it back at its own folder, keep
    // its fields as they are, and don't re-run a revision it already had.
    if (existing && existing.jobFolder && folderPN(existing.jobFolder) && folderPN(existing.jobFolder) !== pnOf(wo.projectNumber)) {
      const wrong = existing.jobFolder;
      const patch = { intakeKey: key, jobFolder: path };
      const notes = tidyNotes(existing.internalNotes);
      if (notes !== null) patch.internalNotes = notes;
      if (!Store.update("workOrder", existing.id, patch)) return { kind: "error", label: existing.woNumber, text: "year is locked — could not re-link" };
      await markLogged(dir, job, now, existing.woNumber);
      await agentLog(dir, `re-linked ${existing.woNumber} to its own job folder (it had been tied to P#${folderPN(wrong)}'s folder by the claim-number mix-up fixed 2026-09-29)`);
      return { kind: "fixed", label: existing.woNumber, text: `re-linked to its own job folder (was P#${folderPN(wrong)}'s)` };
    }

    if (existing && existing.intakeKey === key) {
      // Same PDF as last time. Keep the folder link current when Patti has moved the job,
      // and clear repeated Ledger lines out of Internal Notes.
      const patch = {};
      if (existing.jobFolder !== path) patch.jobFolder = path;
      const notes = tidyNotes(existing.internalNotes);
      if (notes !== null) patch.internalNotes = notes;
      if (Object.keys(patch).length) Store.update("workOrder", existing.id, patch);
      if (!(job.pipeline && job.pipeline.trackerLogged)) await markLogged(dir, job, now, existing.woNumber);
      return null;
    }

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
      const pdf = await attachPdf(dir, job, rec);
      await markLogged(dir, job, now, rec.woNumber);
      await agentLog(dir, `added ${rec.woNumber} to the Tax App (status New, ${
        pdf && pdf.startsWith("moved") ? `work-order PDF ${pdf}, where it had been filed by mistake` : pdf ? "work-order PDF attached" : "work-order PDF not attached"})`);
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
    await markLogged(dir, job, now, existing.woNumber);
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
      const jobs = [], places = new Map();   // P# → the job folders that carry it
      for await (const { handle, path } of jobDirs(root)) {
        const job = await readJson(handle, "job.json");
        if (!job || !String(job.schema || "").startsWith("fcga-job/")) continue;
        jobs.push({ handle, path, job });
        const pn = pnOf((job.workOrder || {}).projectNumber);
        if (pn) places.set(pn, [...(places.get(pn) || []), path]);
      }
      for (const { handle, path, job } of jobs) {
        // A P# in two job folders would pull one record back and forth between them.
        // Leave it alone until there is one folder (Patti does the same), and say so once.
        const pn = pnOf((job.workOrder || {}).projectNumber);
        const where = places.get(pn) || [];
        if (where.length > 1) {
          if (!warnedTwice.has(pn)) {
            warnedTwice.add(pn);
            imported.push({ kind: "check", label: `P#${pn}`, text: `is in ${where.length} job folders (${where.join("; ")}); left alone until there is one` });
          }
          continue;
        }
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
