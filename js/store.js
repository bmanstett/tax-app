/* =========================================================
   store.js — persistence, CRUD + audit trail, tax math,
   backup/restore, integrity checks, IndexedDB attachments.
   ========================================================= */
"use strict";

const Store = (() => {
  const LS_KEY = "anstett_books_v1";
  const SCHEMA_VERSION = 1;

  /* ---------- default state ---------- */
  function defaultSettings() {
    const y = new Date().getFullYear();
    return {
      businessName: "Anstett Consulting, LLC",
      entityType: "PLLC (single-member LLC — sole proprietor for tax purposes)",
      ownerName: "",
      engineerName: "",
      peNumber: "",            // legacy single value — migrated into peNumbers
      peNumbers: [],           // [{state: "VA", number: "0402068317"}, …]
      coaNumber: "",
      businessStartDate: "",
      homeBase: "Home office",
      businessAddress: "",
      businessEmail: "",
      businessPhone: "",
      defaultHourlyRate: 0,
      defaultPaymentTerms: "Net 30",
      defaultInvoiceNotes: "",
      taxYear: y,
      // Editable assumptions — clearly labeled estimates, confirm with CPA.
      seTaxRatePct: 15.3,          // self-employment tax rate applied to 92.35% of net
      federalReservePct: 15,       // federal income tax reserve % of net profit
      stateReservePct: 4,          // state income tax reserve % of net profit
      mileageRates: { [y - 1]: 0.70, [y]: 0.70 },  // $/mile by tax year — confirm current IRS rate
      largeExpenseThreshold: 2500, // flag for review above this
      backupReminderDays: 14,
      lastBackupAt: null,
      theme: "light",
    };
  }

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: U.nowISO(),
      clients: [],
      workOrders: [],
      invoices: [],
      income: [],
      expenses: [],
      mileage: [],
      receipts: [],
      assets: [],
      contractors: [],       // each has payments: []
      taxPayments: [],
      homeOffice: {
        usedRegularlyExclusively: false,
        officeSqFt: 0, homeSqFt: 0,
        utilities: 0, internet: 0, insurance: 0, repairs: 0,
        mortgageInterestRentNote: "", propertyTaxNote: "",
        cpaNotes: "", cpaReview: true, updatedAt: null,
      },
      form1099s: [],          // {id, clientId, taxYear, expected, received, amountReceived, notes}
      yearChecklists: {},     // { "2026": { itemKey: true } }
      lockedYears: [],        // [2025]
      tombstones: [],         // {id, type, at} — deleted records, so deletions sync across devices
      settingsUpdatedAt: null,// stamped by Sync when settings change, so newest settings win
      auditLog: [],           // {id, at, action, recordType, recordId, recordLabel, changes:[{field,from,to}]}
      settings: defaultSettings(),
      demoDataLoaded: false,
    };
  }

  /* ---------- state + persistence ---------- */
  let state = null;
  let saveListeners = [];

  function load() {
    try {
      const rawStr = localStorage.getItem(LS_KEY);
      if (!rawStr) { state = defaultState(); return state; }
      const raw = JSON.parse(rawStr);
      state = migrate(raw);
    } catch (e) {
      console.error("Failed to load saved data:", e);
      state = defaultState();
    }
    return state;
  }

  /** Merge loaded data over defaults so new fields appear after app updates. */
  function migrate(raw) {
    const base = defaultState();
    const merged = { ...base, ...raw };
    merged.settings = { ...base.settings, ...(raw.settings || {}) };
    merged.homeOffice = { ...base.homeOffice, ...(raw.homeOffice || {}) };
    // migrate legacy single PE number into the state-specific list
    if (!Array.isArray(merged.settings.peNumbers)) merged.settings.peNumbers = [];
    if (merged.settings.peNumber && !merged.settings.peNumbers.length) {
      merged.settings.peNumbers = [{ state: "", number: merged.settings.peNumber }];
    }
    // future: if (raw.schemaVersion < 2) { ...transform... }
    merged.schemaVersion = SCHEMA_VERSION;
    return merged;
  }

  const persist = U.debounce(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      saveListeners.forEach(fn => fn(new Date()));
    } catch (e) {
      console.error("Save failed:", e);
      if (window.UI) UI.toast("⚠️ Save failed — storage may be full. Export a backup now.", "error", 6000);
    }
  }, 150);

  function save() { persist(); }
  function onSave(fn) { saveListeners.push(fn); }

  /* ---------- year lock ---------- */
  function isYearLocked(year) { return state.lockedYears.includes(Number(year)); }
  function recordYear(rec) {
    const d = rec.date || rec.invoiceDate || rec.purchaseDate || rec.dateAssigned || null;
    return d ? U.yearOf(d) : null;
  }
  function lockGuard(rec) {
    const y = recordYear(rec);
    if (y && isYearLocked(y)) {
      if (window.UI) UI.toast(`Tax year ${y} is locked. Unlock it in Settings to edit.`, "error", 5000);
      return true;
    }
    return false;
  }

  /* ---------- audit trail ---------- */
  function logAudit(action, recordType, rec, changes = []) {
    state.auditLog.unshift({
      id: U.uid("au"), at: U.nowISO(), action, recordType,
      recordId: rec.id, recordLabel: labelFor(recordType, rec), changes,
    });
    if (state.auditLog.length > 4000) state.auditLog.length = 4000; // cap
  }

  function labelFor(type, rec) {
    switch (type) {
      case "workOrder": return rec.woNumber || rec.projectNumber || "(work order)";
      case "client": return rec.name || "(client)";
      case "invoice": return rec.invoiceNumber || "(invoice)";
      case "income": return `${U.fmtDate(rec.date)} ${U.money(rec.amount)}`;
      case "expense": return `${rec.vendor || "?"} ${U.money(rec.amount)}`;
      case "mileage": return `${U.fmtDate(rec.date)} ${U.num(rec.miles, 1)} mi`;
      case "receipt": return `${rec.vendor || "?"} ${rec.amount ? U.money(rec.amount) : ""}`.trim();
      case "asset": return rec.name || "(asset)";
      case "contractor": return rec.name || "(contractor)";
      case "taxPayment": return `${rec.taxYear} ${rec.quarter} ${U.money(rec.amount)}`;
      default: return rec.id;
    }
  }

  /* ---------- generic CRUD ---------- */
  function coll(type) { return state[SCHEMA.entities[type].store]; }

  function add(type, data) {
    if (lockGuard(data)) return null;
    const rec = { id: U.uid(type.slice(0, 2)), createdAt: U.nowISO(), updatedAt: U.nowISO(), ...data };
    coll(type).unshift(rec);
    logAudit("created", type, rec, []);
    save();
    return rec;
  }

  function update(type, id, data) {
    const list = coll(type);
    const idx = list.findIndex(r => r.id === id);
    if (idx < 0) return null;
    const before = list[idx];
    if (lockGuard(before) || lockGuard({ ...before, ...data })) return null;
    const after = { ...before, ...data, updatedAt: U.nowISO() };
    const changes = U.diff(before, after, ["updatedAt", "createdAt", "id"]);
    list[idx] = after;
    if (changes.length) logAudit("updated", type, after, changes);
    save();
    return after;
  }

  function remove(type, id) {
    const list = coll(type);
    const idx = list.findIndex(r => r.id === id);
    if (idx < 0) return false;
    if (lockGuard(list[idx])) return false;
    const [rec] = list.splice(idx, 1);
    state.tombstones = state.tombstones || [];
    state.tombstones.push({ id, type, at: U.nowISO() });
    if (state.tombstones.length > 2000) state.tombstones.splice(0, state.tombstones.length - 2000);
    logAudit("deleted", type, rec, []);
    save();
    return true;
  }

  function get(type, id) { return coll(type).find(r => r.id === id) || null; }
  function all(type) { return coll(type); }

  /* ---------- lookups ---------- */
  const clientName = id => (get("client", id) || {}).name || "";
  const woLabel = id => { const w = get("workOrder", id); return w ? (w.woNumber || w.projectNumber || "WO") : ""; };
  const invLabel = id => (get("invoice", id) || {}).invoiceNumber || "";

  /* ---------- invoice math ---------- */
  function invoiceTotal(inv) {
    const svc = inv.feeType === "Hourly"
      ? (Number(inv.hours) || 0) * (Number(inv.rate) || 0)
      : (Number(inv.flatFee) || 0);
    return U.round2(svc + (Number(inv.mileageReimb) || 0) + (Number(inv.expenseReimb) || 0) + (Number(inv.otherCharges) || 0));
  }
  function invoiceBalance(inv) { return U.round2(invoiceTotal(inv) - (Number(inv.amountPaid) || 0)); }
  function invoiceIsOverdue(inv) {
    return ["Sent", "Partial", "Overdue"].includes(inv.status) &&
      inv.dueDate && U.daysFromToday(inv.dueDate) < 0 && invoiceBalance(inv) > 0.005;
  }

  /* ---------- mileage math ---------- */
  function mileageRate(year) {
    const rates = state.settings.mileageRates || {};
    if (rates[year] != null) return Number(rates[year]);
    const ys = Object.keys(rates).map(Number).sort((a, b) => b - a);
    return ys.length ? Number(rates[ys[0]]) : 0.70;
  }
  function tripDeduction(trip) {
    const y = U.yearOf(trip.date) || state.settings.taxYear;
    return U.round2((Number(trip.miles) || 0) * mileageRate(y));
  }

  /* ---------- expense math ---------- */
  /** Estimated deductible amount for organizer purposes (CPA confirms). */
  function expenseDeductibleAmt(e) {
    if (e.deductible === false) return 0;
    if (e.reimbursable && e.reimbursed) return 0; // avoid double-dipping; CPA review
    const pct = e.businessUsePct == null ? 100 : Number(e.businessUsePct);
    return U.round2((Number(e.amount) || 0) * Math.min(Math.max(pct, 0), 100) / 100);
  }

  /* ---------- year filters ---------- */
  const inYear = (iso, y) => U.yearOf(iso) === Number(y);
  function yearData(y) {
    y = Number(y);
    return {
      income: state.income.filter(r => inYear(r.date, y)),
      expenses: state.expenses.filter(r => inYear(r.date, y)),
      mileage: state.mileage.filter(r => inYear(r.date, y)),
      invoices: state.invoices.filter(r => inYear(r.invoiceDate, y)),
      assets: state.assets.filter(r => inYear(r.purchaseDate, y)),
      taxPayments: state.taxPayments.filter(r => Number(r.taxYear) === y),
      workOrders: state.workOrders.filter(r => inYear(r.dateAssigned, y) || inYear(r.inspectionDate, y)),
    };
  }

  /* ---------- tax estimates (organizer-level, CPA confirms) ---------- */
  function taxSummary(y) {
    y = Number(y);
    const d = yearData(y);
    const s = state.settings;
    const grossIncome = U.sum(d.income, r => r.amount);
    const deductibleExpenses = U.sum(d.expenses, expenseDeductibleAmt);
    const mileageDeduction = U.sum(d.mileage, tripDeduction);
    const netProfit = U.round2(grossIncome - deductibleExpenses - mileageDeduction);
    const seBase = Math.max(netProfit, 0) * 0.9235;
    const seTax = U.round2(seBase * (Number(s.seTaxRatePct) || 0) / 100);
    const fedReserve = U.round2(Math.max(netProfit, 0) * (Number(s.federalReservePct) || 0) / 100);
    const stateReserve = U.round2(Math.max(netProfit, 0) * (Number(s.stateReservePct) || 0) / 100);
    const totalReserve = U.round2(seTax + fedReserve + stateReserve);
    const paid = U.sum(d.taxPayments, r => r.amount);
    return {
      year: y, grossIncome, deductibleExpenses, mileageDeduction, netProfit,
      seTax, fedReserve, stateReserve, totalReserve,
      taxPaymentsMade: paid, reserveRemaining: U.round2(totalReserve - paid),
      mileageMiles: U.sum(d.mileage, r => r.miles), mileageRate: mileageRate(y),
    };
  }

  /* ---------- duplicate detection ---------- */
  function findDuplicates() {
    const dupes = [];
    const key = (parts) => parts.join("|").toLowerCase();
    const check = (type, list, keyFn, describe) => {
      const seen = {};
      for (const r of list) {
        const k = keyFn(r);
        if (!k) continue;
        if (seen[k]) dupes.push({ type, ids: [seen[k].id, r.id], label: describe(r) });
        else seen[k] = r;
      }
    };
    check("expense", state.expenses, r => r.date && r.amount ? key([r.date, r.vendor, r.amount]) : null,
      r => `Expense: ${r.vendor} ${U.money(r.amount)} on ${U.fmtDate(r.date)}`);
    check("income", state.income, r => r.date && r.amount ? key([r.date, r.clientId || r.sourceOther, r.amount]) : null,
      r => `Income: ${U.money(r.amount)} on ${U.fmtDate(r.date)}`);
    check("mileage", state.mileage, r => r.date && r.miles ? key([r.date, r.destination, r.miles]) : null,
      r => `Mileage: ${U.num(r.miles, 1)} mi to ${r.destination || "?"} on ${U.fmtDate(r.date)}`);
    check("invoice", state.invoices, r => r.invoiceNumber ? key([r.invoiceNumber]) : null,
      r => `Invoice #: ${r.invoiceNumber} (duplicate number)`);
    check("workOrder", state.workOrders, r => r.woNumber ? key([r.woNumber]) : null,
      r => `Work Order #: ${r.woNumber} (duplicate number)`);
    return dupes;
  }

  /* ---------- integrity check ---------- */
  function integrityCheck() {
    const issues = [];
    const has = (type, id) => !id || !!get(type, id);
    const scan = (type, list, refs) => {
      for (const r of list) for (const [field, refType] of refs) {
        if (r[field] && !has(refType, r[field]))
          issues.push(`${SCHEMA.entities[type].label} "${labelFor(type, r)}" references a missing ${refType} (${field}).`);
      }
    };
    scan("workOrder", state.workOrders, [["clientId", "client"]]);
    scan("invoice", state.invoices, [["clientId", "client"], ["workOrderId", "workOrder"]]);
    scan("income", state.income, [["clientId", "client"], ["invoiceId", "invoice"], ["workOrderId", "workOrder"]]);
    scan("expense", state.expenses, [["clientId", "client"], ["workOrderId", "workOrder"]]);
    scan("mileage", state.mileage, [["clientId", "client"], ["workOrderId", "workOrder"]]);
    scan("receipt", state.receipts, [["expenseId", "expense"], ["workOrderId", "workOrder"]]);
    scan("asset", state.assets, [["expenseId", "expense"]]);
    for (const e of state.expenses) {
      if ((Number(e.amount) || 0) < 0) issues.push(`Expense "${labelFor("expense", e)}" has a negative amount.`);
      if (e.date && U.parseDate(e.date) > new Date(Date.now() + 86400000)) issues.push(`Expense "${labelFor("expense", e)}" is dated in the future.`);
    }
    for (const m of state.mileage) {
      if (m.odometerStart && m.odometerEnd && Number(m.odometerEnd) < Number(m.odometerStart))
        issues.push(`Mileage trip on ${U.fmtDate(m.date)}: odometer end is before start.`);
    }
    for (const i of state.invoices) {
      if ((Number(i.amountPaid) || 0) - invoiceTotal(i) - (Number(i.bonusAmount) || 0) > 0.01)
        issues.push(`Invoice ${i.invoiceNumber}: amount paid exceeds invoice total${i.bonusAmount ? " plus bonus" : ""} — if the extra is a bonus, record it in the invoice's Bonus field.`);
      if (i.status === "Paid" && (!i.paymentDate || !i.paymentMethod))
        issues.push(`Invoice ${i.invoiceNumber} is marked Paid but is missing payment date or method.`);
    }
    return issues;
  }

  /* ---------- export / import ---------- */
  async function exportJSON(includeAttachments = true) {
    const payload = {
      app: "Anstett Consulting — Books & Tax Organizer",
      exportedAt: U.nowISO(),
      schemaVersion: SCHEMA_VERSION,
      data: U.clone(state),
    };
    if (includeAttachments) {
      try { payload.attachments = await Attachments.exportAll(); }
      catch (e) { console.warn("Attachment export failed:", e); payload.attachments = []; }
    }
    return JSON.stringify(payload, null, 2);
  }

  function validateImport(obj) {
    const errors = [];
    if (!obj || typeof obj !== "object") { errors.push("Not a JSON object."); return errors; }
    const data = obj.data || obj; // accept raw state too
    if (typeof data !== "object") { errors.push("No data section found."); return errors; }
    if (data.schemaVersion && Number(data.schemaVersion) > SCHEMA_VERSION)
      errors.push(`Backup schema v${data.schemaVersion} is newer than this app (v${SCHEMA_VERSION}). Update the app first.`);
    for (const k of ["clients", "workOrders", "invoices", "income", "expenses", "mileage"]) {
      if (data[k] != null && !Array.isArray(data[k])) errors.push(`"${k}" should be a list.`);
    }
    const looksLikeOurs = ["clients", "workOrders", "expenses", "settings"].some(k => k in data);
    if (!looksLikeOurs) errors.push("This JSON doesn't look like a backup from this app.");
    return errors;
  }

  async function importJSON(text) {
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { throw new Error("Invalid JSON file: " + e.message); }
    const errors = validateImport(obj);
    if (errors.length) throw new Error(errors.join(" "));
    const data = obj.data || obj;
    state = migrate(data);
    logAudit("imported", "settings", { id: "backup" }, [{ field: "restore", from: "", to: obj.exportedAt || "unknown export date" }]);
    localStorage.setItem(LS_KEY, JSON.stringify(state)); // immediate, not debounced
    if (Array.isArray(obj.attachments) && obj.attachments.length) {
      try { await Attachments.importAll(obj.attachments); }
      catch (e) { console.warn("Attachment import failed:", e); }
    }
    saveListeners.forEach(fn => fn(new Date()));
    return state;
  }

  /** Replace state with a synced/merged snapshot (persists immediately, no audit entry). */
  function applySynced(next) {
    state = migrate(next);
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    saveListeners.forEach(fn => fn(new Date()));
    return state;
  }

  function resetAll() {
    state = defaultState();
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    Attachments.clearAll().catch(() => {});
    saveListeners.forEach(fn => fn(new Date()));
  }

  function backupDue() {
    const s = state.settings;
    if (!s.lastBackupAt) return state.auditLog.length > 5; // only nag once they have data
    return U.daysBetween(s.lastBackupAt.slice(0, 10), U.todayISO()) >= (s.backupReminderDays || 14);
  }
  function markBackedUp() { state.settings.lastBackupAt = U.nowISO(); save(); }

  /** Stamp settings as edited on this device *now*, then persist. Multi-device
      sync compares settingsUpdatedAt to decide whose profile wins, so this
      guarantees a fresh local edit is never overwritten by an older remote copy. */
  function markSettingsChanged() { state.settingsUpdatedAt = U.nowISO(); save(); }

  /* ---------- IndexedDB attachments (receipt images/PDFs) ---------- */
  const Attachments = (() => {
    const DB = "anstett_attachments", STORE = "files";
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbp;
    }
    async function tx(mode, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const out = fn(store);
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
        t.onerror = () => reject(t.error);
      });
    }
    return {
      /** put({id, name, type, dataUrl}) */
      put: rec => tx("readwrite", s => s.put(rec)),
      get: async id => {
        const db = await open();
        return new Promise((resolve, reject) => {
          const req = db.transaction(STORE).objectStore(STORE).get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      },
      delete: id => tx("readwrite", s => s.delete(id)),
      exportAll: async () => {
        const db = await open();
        return new Promise((resolve, reject) => {
          const req = db.transaction(STORE).objectStore(STORE).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      },
      importAll: async recs => { for (const r of recs) await tx("readwrite", s => s.put(r)); },
      clearAll: () => tx("readwrite", s => s.clear()),
      listIds: async () => {
        const db = await open();
        return new Promise((resolve, reject) => {
          const req = db.transaction(STORE).objectStore(STORE).getAllKeys();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      },
      /** Resize an image File to ≤1400px and return a dataURL (PDFs pass through). */
      fileToDataUrl: file => new Promise((resolve, reject) => {
        if (!/^image\//.test(file.type)) {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
          return;
        }
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const max = 1400;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
        img.src = url;
      }),
    };
  })();

  /* ---------- public API ---------- */
  return {
    load, save, onSave, defaultSettings,
    get state() { return state; },
    add, update, remove, get, all,
    clientName, woLabel, invLabel,
    invoiceTotal, invoiceBalance, invoiceIsOverdue,
    mileageRate, tripDeduction, expenseDeductibleAmt,
    yearData, taxSummary,
    findDuplicates, integrityCheck,
    exportJSON, importJSON, validateImport, resetAll, applySynced,
    isYearLocked, backupDue, markBackedUp, markSettingsChanged,
    logAudit, labelFor,
    Attachments,
  };
})();
