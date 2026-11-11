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
      officeState: "VA",           // where admin/research/report work happens
      defaultFieldWorkPct: 50,     // % of a job's fee sourced to the inspection state
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
      mileageRates: {},            // $/mile by tax year — blank years use the published IRS rate (see IRS_MILEAGE)
      mileageRatesH2: {},          // $/mile from July 1, for years the IRS changed the rate mid-year
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
      dupeIgnores: [],        // duplicate pairs reviewed and kept ("id1~id2")
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

  /* ---------- derived-data cache ----------
     `rev` counts changes. Every write path ends in save() or swaps the whole state,
     and each of those bumps it — so anything worked out purely from the records (the
     lookup tables below, a year's slice, its tax summary) can be kept until the next
     bump. A page that asks the same question for every row it draws now gets it
     answered once, instead of re-scanning every collection each time. */
  let rev = 0;
  let cacheRev = -1, cacheState = null, cache = new Map();
  function cached(key, fn) {
    if (cacheRev !== rev || cacheState !== state) { cache = new Map(); cacheRev = rev; cacheState = state; }
    if (cache.has(key)) return cache.get(key);
    const v = fn();
    cache.set(key, v);
    return v;
  }

  /* The same, for answers that also lean on things outside the records — today's date,
     a dialog that's mid-save. Those are kept only until the current burst of work is
     over: the page that asks five times while it draws gets one computation, and the
     next tap starts clean. */
  let turnRev = -1, turnState = null, turnCache = new Map(), turnTimer = 0;
  function cachedTurn(key, fn) {
    if (turnRev !== rev || turnState !== state) { turnCache = new Map(); turnRev = rev; turnState = state; }
    if (turnCache.has(key)) return turnCache.get(key);
    if (!turnTimer) turnTimer = setTimeout(() => { turnTimer = 0; turnCache = new Map(); }, 0);
    const v = fn();
    turnCache.set(key, v);
    return v;
  }

  function load() {
    rev++;
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
      // (UI is a top-level const, not a property of window — `window.UI` was always undefined,
      // so this warning never showed and a full disk failed silently)
      if (typeof UI !== "undefined") UI.toast("⚠️ Save failed — storage may be full. Export a backup now.", "error", 6000);
    }
  }, 150);

  function save() { rev++; persist(); }
  function onSave(fn) { saveListeners.push(fn); }

  /* ---------- year lock ---------- */
  function isYearLocked(year) { return state.lockedYears.includes(Number(year)); }
  function recordYear(rec) {
    const d = rec.date || rec.invoiceDate || rec.purchaseDate || rec.dateAssigned || null;
    return d ? U.yearOf(d) : null;
  }
  /** True when the record sits in a locked tax year (so edits to it will be refused). */
  function recordLocked(rec) {
    const y = recordYear(rec);
    return !!(y && isYearLocked(y));
  }
  let lockToastAt = 0;
  function lockGuard(rec) {
    const y = recordYear(rec);
    if (!(y && isYearLocked(y))) return false;
    // Say so only while a form or dialog is open — the user's own edit was just refused.
    // Background passes reach locked records too (the tidy-up after a sync; Ledger re-linking
    // a moved job folder on every scan) and must stay quiet, or the toast returns every pass.
    const dlg = document.getElementById("modal-root");
    if (typeof UI !== "undefined" && dlg && dlg.children.length && Date.now() - lockToastAt > 4000) {
      lockToastAt = Date.now();
      UI.toast(`Tax year ${y} is locked. Unlock it on the Taxes page to edit.`, "error", 5000);
    }
    return true;
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

  /** One record by id — off a lookup table rebuilt only when something changes. */
  function get(type, id) {
    if (id == null || id === "") return null;
    return cached("id:" + type, () => {
      const m = new Map();
      for (const r of coll(type)) if (!m.has(r.id)) m.set(r.id, r);   // first one wins, as find() did
      return m;
    }).get(id) || null;
  }
  function all(type) { return coll(type); }

  /** Every record of a type that points at `id` through `field`, in list order —
      linkedTo("invoice", "workOrderId", w.id) → that job's invoices. The arrays are
      shared with the cache: read them, never change them. */
  const NO_RECORDS = Object.freeze([]);
  function linkedTo(type, field, id) {
    if (id == null || id === "") return NO_RECORDS;
    return cached(`by:${type}.${field}`, () => {
      const m = new Map();
      for (const r of coll(type)) {
        const k = r[field];
        if (k == null || k === "") continue;
        const list = m.get(k);
        if (list) list.push(r); else m.set(k, [r]);
      }
      return m;
    }).get(id) || NO_RECORDS;
  }

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

  /* ---------- mileage math ----------
     The IRS standard mileage rates, $ per mile, as published. A year normally has one;
     when the IRS changes it mid-year (2011, 2022, 2026) the second figure applies to
     trips from July 1. Settings can override any year (mileageRates = the whole year or
     January–June; mileageRatesH2 = from July 1). A year with nothing in Settings uses
     these — and Settings is checked against them, so a stale rate doesn't quietly
     under-deduct every mile. Add each new year's rate here when the IRS announces it. */
  const IRS_MILEAGE = {
    2022: [0.585, 0.625], 2023: [0.655], 2024: [0.67], 2025: [0.70],
    2026: [0.725, 0.76],   // Notice 2026-10; Announcement 2026-11 (76¢ from July 1, 2026)
  };

  /** The rate for a year — for a split year, the January–June one. */
  function mileageRate(year) {
    const rates = state.settings.mileageRates || {};
    if (rates[year] != null && Number(rates[year]) > 0) return Number(rates[year]);
    if (IRS_MILEAGE[year]) return IRS_MILEAGE[year][0];
    // a year nothing is known about yet: the most recent rate in effect before it
    const known = [...new Set([...Object.keys(rates), ...Object.keys(IRS_MILEAGE)].map(Number))]
      .filter(y => y < Number(year) && (IRS_MILEAGE[y] || Number(rates[y]) > 0)).sort((a, b) => b - a);
    if (known.length) return mileageRateH2(known[0]) ?? mileageRate(known[0]);
    const ys = Object.keys(rates).map(Number).sort((a, b) => b - a);
    return ys.length ? Number(rates[ys[0]]) : 0.70;
  }
  /** The rate from July 1 of a year, if it has one (set in Settings, or published for a
      year Settings says nothing about) — else null. */
  function mileageRateH2(year) {
    const h2 = state.settings.mileageRatesH2 || {};
    if (h2[year] != null && Number(h2[year]) > 0) return Number(h2[year]);
    const rates = state.settings.mileageRates || {};
    const set = rates[year] != null && Number(rates[year]) > 0;
    return !set && IRS_MILEAGE[year] && IRS_MILEAGE[year][1] ? IRS_MILEAGE[year][1] : null;
  }
  /** The rate that applies to a trip on a given day. */
  function mileageRateOn(iso) {
    const y = U.yearOf(iso) || state.settings.taxYear;
    const h2 = mileageRateH2(y);
    return h2 != null && Number(String(iso || "").slice(5, 7)) >= 7 ? h2 : mileageRate(y);
  }
  /** "$0.70" · "$0.725" — as many decimals as the rate has (half-cents are real). */
  const fmtRate = r => "$" + (Math.round(Number(r) * 1000) % 10 ? Number(r).toFixed(3) : Number(r).toFixed(2));
  /** A year's rate for display: "$0.70/mi", or "$0.725/mi Jan–Jun · $0.76/mi Jul–Dec". */
  function mileageRateText(year) {
    const h2 = mileageRateH2(year);
    return h2 != null && h2 !== mileageRate(year)
      ? `${fmtRate(mileageRate(year))}/mi Jan–Jun · ${fmtRate(h2)}/mi Jul–Dec`
      : `${fmtRate(mileageRate(year))}/mi`;
  }
  /** How a year's configured rate compares with the published one.
      → {known, matches, irs: [h1, h2|null], set: [h1, h2|null], extra} where extra is the
      deduction this year's logged trips would gain (or lose, if negative) at the IRS rates. */
  function mileageRateCheck(year) {
    year = Number(year);
    const irs = IRS_MILEAGE[year];
    const set = [mileageRate(year), mileageRateH2(year)];
    if (!irs) return { known: false, matches: true, irs: null, set, extra: 0 };
    const irsOn = iso => (irs[1] && Number(String(iso || "").slice(5, 7)) >= 7 ? irs[1] : irs[0]);
    const trips = yearData(year).mileage;
    const extra = U.round2(U.sum(trips, t => (Number(t.miles) || 0) * (irsOn(t.date) - mileageRateOn(t.date))));
    const same = Math.abs(set[0] - irs[0]) < 0.0005 && Math.abs((set[1] ?? set[0]) - (irs[1] ?? irs[0])) < 0.0005;
    return { known: true, matches: same, irs: [irs[0], irs[1] || null], set, extra };
  }
  /** Put the published rates into Settings for a year (one tap from the Tax Savings page). */
  function useIrsMileageRates(year) {
    const irs = IRS_MILEAGE[Number(year)];
    if (!irs) return false;
    const s = state.settings;
    s.mileageRates = { ...(s.mileageRates || {}), [year]: irs[0] };
    const h2 = { ...(s.mileageRatesH2 || {}) };
    if (irs[1]) h2[year] = irs[1]; else delete h2[year];
    s.mileageRatesH2 = h2;
    logAudit("updated", "settings", { id: "assumptions" }, [{ field: `mileageRate${year}`, from: "", to: irs.join(" / ") }]);
    markSettingsChanged();
    return true;
  }
  function tripDeduction(trip) {
    return U.round2((Number(trip.miles) || 0) * mileageRateOn(trip.date || `${state.settings.taxYear}-01-01`));
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
  /** One tax year's slice of every collection. Worked out once per change and shared
      by everything that asks — treat it as read-only (filter/map it, never sort or
      push in place). */
  function yearData(y) {
    y = Number(y);
    return cached("year:" + y, () => ({
      income: state.income.filter(r => inYear(r.date, y)),
      expenses: state.expenses.filter(r => inYear(r.date, y)),
      mileage: state.mileage.filter(r => inYear(r.date, y)),
      invoices: state.invoices.filter(r => inYear(r.invoiceDate, y)),
      assets: state.assets.filter(r => inYear(r.purchaseDate, y)),
      taxPayments: state.taxPayments.filter(r => Number(r.taxYear) === y),
      workOrders: state.workOrders.filter(r => inYear(r.dateAssigned, y) || inYear(r.inspectionDate, y)),
    }));
  }

  /* ---------- tax estimates (organizer-level, CPA confirms) ---------- */
  function taxSummary(y) {
    y = Number(y);
    return cached("tax:" + y, () => computeTaxSummary(y));
  }
  function computeTaxSummary(y) {
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
      mileageMiles: U.sum(d.mileage, r => r.miles), mileageRate: mileageRate(y), mileageRateText: mileageRateText(y),
    };
  }

  /* ---------- state sourcing (which state's return the income belongs on) ----------
     A forensic job is usually split: the inspection happens on site (often out of
     state) while the research, analysis, and report write-up happen at the office.
     The work order carries that split; income inherits it unless it overrides. */

  /** The work order behind an income entry — linked directly, else via its invoice. */
  function incomeWorkOrder(inc) {
    if (!inc) return null;
    const id = inc.workOrderId || (inc.invoiceId ? (get("invoice", inc.invoiceId) || {}).workOrderId : null);
    return id ? get("workOrder", id) : null;
  }

  /** Where an income entry's state split comes from and what it is.
      → {from: "income"|"workOrder"|"settings", label, workState, officeState, pct} */
  function incomeStateSource(inc) {
    const s = state.settings;
    const w = incomeWorkOrder(inc);
    if (inc && inc.workState) {
      return {
        from: "income", label: "this entry",
        workState: String(inc.workState).toUpperCase(),
        officeState: ((w && w.officeState) || s.officeState || "").toUpperCase(),
        pct: inc.fieldWorkPct,
      };
    }
    if (w && w.workState) {
      return {
        from: "workOrder", label: w.woNumber || w.projectNumber || "the linked work order",
        workState: String(w.workState).toUpperCase(),
        officeState: String(w.officeState || s.officeState || "").toUpperCase(),
        pct: w.fieldWorkPct,
      };
    }
    return {
      from: "settings", label: "office default",
      workState: "",
      officeState: String((w && w.officeState) || s.officeState || "").toUpperCase(),
      pct: null,
    };
  }

  /** How one income entry splits across states → [{state, pct, amount}].
      Empty array means the entry can't be sourced yet (no office state set). */
  function incomeStateSplit(inc) {
    const src = incomeStateSource(inc);
    const amount = U.round2(Number(inc.amount) || 0);
    const { workState, officeState } = src;
    if (!workState || !officeState || workState === officeState) {
      const only = workState || officeState;
      return only ? [{ state: only, pct: 100, amount }] : [];
    }
    const p = SCHEMA.clampPct(src.pct);
    const fieldAmt = U.round2(amount * p / 100);
    return [
      { state: workState, pct: p, amount: fieldAmt },
      { state: officeState, pct: 100 - p, amount: U.round2(amount - fieldAmt) },  // absorbs rounding
    ];
  }

  /** Income for a tax year allocated by state, for the CPA's state returns.
      → {states:[{state, name, amount, entries}], unassigned:{amount, entries}, total} */
  function stateIncomeSummary(y) {
    const rows = {};
    let unassigned = { amount: 0, entries: 0 };
    let total = 0;
    for (const inc of yearData(y).income) {
      total += Number(inc.amount) || 0;
      const parts = incomeStateSplit(inc);
      if (!parts.length) { unassigned.amount += Number(inc.amount) || 0; unassigned.entries++; continue; }
      for (const p of parts) {
        rows[p.state] = rows[p.state] || { state: p.state, name: SCHEMA.stateName(p.state), amount: 0, entries: 0 };
        rows[p.state].amount = U.round2(rows[p.state].amount + p.amount);
        rows[p.state].entries++;
      }
    }
    return {
      states: U.sortBy(Object.values(rows), r => r.amount, -1),
      unassigned: { amount: U.round2(unassigned.amount), entries: unassigned.entries },
      total: U.round2(total),
    };
  }

  /* ---------- duplicate detection ---------- */

  /** Stable id for a duplicate pair — record ids sorted, so "keep both"
      survives reloads and syncs to the other devices. */
  function dupeKey(ids) { return [...ids].sort().join("~"); }

  /** Pairs of records that look like the same thing entered twice.
      Each: {type, key, ids:[a,b], records:[a,b], label, ignored}.
      Pairs the user marked "keep both" are filtered out unless asked for. */
  function findDuplicates({ includeIgnored = false } = {}) {
    const dupes = [];
    const ignored = new Set(state.dupeIgnores || []);
    const key = (parts) => parts.join("|").toLowerCase();
    const check = (type, list, keyFn, describe) => {
      const seen = {};
      for (const r of list) {
        const k = keyFn(r);
        if (!k) continue;
        if (seen[k]) {
          const ids = [seen[k].id, r.id];
          const pairKey = dupeKey(ids);
          if (includeIgnored || !ignored.has(pairKey))
            dupes.push({ type, key: pairKey, ids, records: [seen[k], r], label: describe(r), ignored: ignored.has(pairKey) });
        }
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

  /** "Keep both" / undo for a duplicate pair. Keys of pairs whose records are
      gone are pruned so the list can't grow forever. */
  function setDuplicateIgnored(pairKey, on = true) {
    const live = new Set([...state.expenses, ...state.income, ...state.mileage, ...state.invoices, ...state.workOrders].map(r => r.id));
    const keep = (state.dupeIgnores || []).filter(k => k !== pairKey && k.split("~").every(id => live.has(id)));
    state.dupeIgnores = on ? [...keep, pairKey] : keep;
    // noted in the audit trail, which is how sync tells a later "undo" from a pair the other
    // device simply hasn't reviewed yet
    logAudit("updated", "settings", { id: "dupeReview" }, [{ field: on ? "keptBoth" : "undidKeptBoth", from: "", to: pairKey }]);
    save();
  }

  /** Date (YYYY-MM-DD, local) a record's status was last changed to `status`,
      read back out of the audit trail. Null when the trail doesn't show it —
      e.g. the record was created with that status already set. */
  function statusChangedAt(type, id, status) {
    const hit = (state.auditLog || []).find(a =>            // audit log is newest-first
      a.recordType === type && a.recordId === id &&
      (a.changes || []).some(c => c.field === "status" && c.to === status));
    return hit ? U.localDateOf(hit.at) : null;
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

  /** asNewest: sync is on. Left as they are, restored records lose the merge that follows —
      the repo's copies are newer, and its tombstones delete what the backup brings back — so
      the restore would quietly undo itself a second later. They are stamped as edited now,
      in the same tick as the swap, so no sync pass can ever see them unstamped. */
  async function importJSON(text, { asNewest = false } = {}) {
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { throw new Error("Invalid JSON file: " + e.message); }
    const errors = validateImport(obj);
    if (errors.length) throw new Error(errors.join(" "));
    const data = obj.data || obj;
    state = migrate(data);
    if (asNewest) {
      const now = U.nowISO();
      for (const k of ["clients", "workOrders", "invoices", "income", "expenses", "mileage",
        "receipts", "assets", "contractors", "taxPayments", "form1099s"])   // the collections sync merges
        for (const r of (state[k] || [])) r.updatedAt = now;
      state.settingsUpdatedAt = now;
      state.homeOffice.updatedAt = now;
    }
    rev++;
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
    rev++;
    // a full disk must not abort the sync pass before it has pushed this device's edits
    let stored = true;
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch (e) {
      stored = false;
      console.error("Save failed:", e);
      if (typeof UI !== "undefined") UI.toast("⚠️ Save failed — storage may be full. Export a backup now.", "error", 6000);
    }
    if (stored) saveListeners.forEach(fn => fn(new Date()));
    return state;
  }

  function resetAll() {
    state = defaultState();
    rev++;
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    Attachments.clearAll().catch(() => {});
    saveListeners.forEach(fn => fn(new Date()));
  }

  function backupDue() {
    const s = state.settings;
    if (!s.lastBackupAt) return state.auditLog.length > 5; // only nag once they have data
    return U.daysBetween(s.lastBackupAt.slice(0, 10), U.todayISO()) >= (s.backupReminderDays || 14);
  }
  function markBackedUp() {
    state.settings.lastBackupAt = U.nowISO();
    // A backup is a settings change the other device should see (its reminder clears too) —
    // but a device that has never owned a stamp (fresh, not yet joined to the sync repo)
    // must not claim the whole profile just by exporting.
    if (state.settingsUpdatedAt) markSettingsChanged(); else save();
  }

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
    get rev() { return rev; },
    cached, cachedTurn,
    add, update, remove, get, all, linkedTo,
    clientName, woLabel, invLabel,
    invoiceTotal, invoiceBalance, invoiceIsOverdue,
    mileageRate, mileageRateH2, mileageRateOn, mileageRateText, mileageRateCheck, useIrsMileageRates, fmtRate, IRS_MILEAGE,
    tripDeduction, expenseDeductibleAmt,
    yearData, taxSummary,
    incomeWorkOrder, incomeStateSource, incomeStateSplit, stateIncomeSummary,
    findDuplicates, setDuplicateIgnored, statusChangedAt, integrityCheck,
    exportJSON, importJSON, validateImport, resetAll, applySynced,
    isYearLocked, recordLocked, backupDue, markBackedUp, markSettingsChanged,
    logAudit, labelFor,
    Attachments,
  };
})();
