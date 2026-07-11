/* =========================================================
   views/reports.js — printable reports, CSV exports, CPA
   year-end packet, IRS audit-readiness packet.
   ========================================================= */
"use strict";

window.Views = window.Views || {};

const Reports = (() => {

  /* ---------- year-end checklist (shared with Taxes & Dashboard) ---------- */
  function checklistItems(year) {
    const d = Store.yearData(year);
    const S = Store.state;
    const manual = S.yearChecklists[String(year)] || {};
    const recon = Alerts.reconcile1099(year);
    const auto = [
      { key: "expCat", label: "All expenses categorized", done: d.expenses.every(e => !!e.category), auto: true },
      { key: "receipts", label: "All receipts attached or referenced", done: d.expenses.every(e => e.receiptStatus && e.receiptStatus !== "Missing"), auto: true },
      { key: "purpose", label: "All expenses have a business purpose", done: d.expenses.every(e => String(e.businessPurpose || "").trim()), auto: true },
      { key: "mileage", label: "Mileage log complete (destination + purpose on every trip)", done: d.mileage.every(m => String(m.destination || "").trim() && String(m.businessPurpose || "").trim()), auto: true },
      { key: "recon99", label: "All 1099 income reconciled", done: recon.length > 0 && recon.every(r => !r.expected || (r.received && Math.abs(r.difference) <= 0.5)), sub: "Use the 1099 tool in Income", auto: true },
      { key: "invReviewed", label: "No invoices left unpaid/unreconciled", done: !S.invoices.some(i => ["Sent", "Partial", "Overdue"].includes(i.status) && Store.invoiceBalance(i) > 0.005), auto: true },
      { key: "assets", label: "Assets reviewed for depreciation / Sec. 179", done: S.assets.length === 0 || S.assets.every(a => !a.askCpaDepreciation || !["Not Reviewed", "Sent to CPA"].includes(a.depreciationStatus || "Not Reviewed")), auto: true },
      { key: "cpaFlags", label: "CPA review flags resolved or documented", done: ![...d.expenses, ...d.income].some(r => r.cpaReview), auto: true },
      { key: "qtrPaid", label: "Quarterly tax payments entered", done: d.taxPayments.length > 0, auto: true },
    ];
    const manualItems = [
      { key: "allIncome", label: "All income entered (checked against bank deposits)" },
      { key: "homeOffice", label: "Home office reviewed with CPA" },
      { key: "contractors", label: "Contractor payments reviewed for 1099 issuance" },
      { key: "cpaExport", label: "CPA year-end packet exported and sent" },
      { key: "backup", label: "JSON backup exported and stored safely" },
    ].map(i => ({ ...i, done: !!manual[i.key], auto: false }));
    return [...auto, ...manualItems];
  }

  /* ---------- report modal shell ---------- */
  function show(title, bodyHtml, csv) {
    const m = UI.modal({
      title: U.escapeHtml(title),
      size: "lg",
      body: `<div class="report-doc">${bodyHtml}</div>
        <div class="disclaimer no-print" style="margin-top:16px">${U.escapeHtml(SCHEMA.DISCLAIMER)}</div>`,
      footer: `${csv ? `<button class="btn btn-left" id="rp-csv">⬇️ CSV</button>` : ""}
        <button class="btn" id="rp-close">Close</button>
        <button class="btn btn-primary" id="rp-print">🖨️ Print / Save PDF</button>`,
    });
    m.footerEl.querySelector("#rp-close").addEventListener("click", () => m.close());
    m.footerEl.querySelector("#rp-print").addEventListener("click", () => window.print());
    if (csv) m.footerEl.querySelector("#rp-csv").addEventListener("click", () => { U.download(csv.name, csv.content, "text/csv"); UI.toast("CSV downloaded", "success"); });
  }

  const H = (t) => `<h2 style="font-size:16px;margin:18px 0 8px;border-bottom:2px solid var(--border);padding-bottom:4px">${U.escapeHtml(t)}</h2>`;
  const head = (title, year) => `
    <div style="margin-bottom:6px">
      <div style="font-size:19px;font-weight:800">${U.escapeHtml(Store.state.settings.businessName)}</div>
      <div style="font-size:14px;font-weight:700;color:var(--accent-strong)">${U.escapeHtml(title)}</div>
      <div style="font-size:12px;color:var(--text-3)">Tax year ${year} · Exported ${U.fmtDateTime(U.nowISO())} · ${U.escapeHtml(Store.state.settings.entityType)}</div>
    </div>`;
  function tbl(cols, rows, opts = {}) {
    return `<div class="table-wrap"><table class="data-table" style="font-size:12.5px">
      <thead><tr>${cols.map(c => `<th style="cursor:default" class="${c.num ? "num" : ""}">${U.escapeHtml(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => `<tr style="cursor:default">${cols.map(c => `<td class="${c.num ? "num" : ""}">${c.html ? c.html(r) : U.escapeHtml(String(c.value(r) ?? ""))}</td>`).join("")}</tr>`).join("")}
      ${opts.totalRow ? `<tr style="cursor:default;font-weight:800">${opts.totalRow.map((v, i) => `<td class="${cols[i] && cols[i].num ? "num" : ""}">${v}</td>`).join("")}</tr>` : ""}
      </tbody></table></div>`;
  }

  /* ---------- individual reports ---------- */
  function plByMonth(year) {
    const d = Store.yearData(year);
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    const rows = months.map(mm => {
      const inc = U.sum(d.income.filter(r => U.monthKey(r.date) === mm), r => r.amount);
      const exp = U.sum(d.expenses.filter(r => U.monthKey(r.date) === mm), Store.expenseDeductibleAmt);
      const mi = U.sum(d.mileage.filter(r => U.monthKey(r.date) === mm), Store.tripDeduction);
      return { m: U.monthLabel(mm) + " " + year, inc, exp, mi, net: U.round2(inc - exp - mi) };
    });
    const t = Store.taxSummary(year);
    show(`Profit & Loss — ${year}`, head("Profit & Loss (organizer estimate)", year) +
      tbl([
        { label: "Month", value: r => r.m },
        { label: "Income", value: r => U.money(r.inc), num: true },
        { label: "Est. deductible expenses", value: r => U.money(r.exp), num: true },
        { label: "Est. mileage deduction", value: r => U.money(r.mi), num: true },
        { label: "Est. net", value: r => U.money(r.net), num: true },
      ], rows, { totalRow: ["TOTAL", U.money(t.grossIncome), U.money(t.deductibleExpenses), U.money(t.mileageDeduction), U.money(t.netProfit)] }),
      { name: `pl-${year}.csv`, content: U.toCSV(rows, [{ key: "m", label: "Month" }, { key: "inc", label: "Income" }, { key: "exp", label: "Expenses" }, { key: "mi", label: "Mileage Deduction" }, { key: "net", label: "Net" }]) });
  }

  function incomeByClient(year) {
    const d = Store.yearData(year);
    const rows = Object.entries(U.groupBy(d.income, r => r.clientId ? Store.clientName(r.clientId) : (r.sourceOther || "Other")))
      .map(([name, rs]) => ({ name, count: rs.length, total: U.sum(rs, r => r.amount), t99: U.sum(rs.filter(r => r.is1099), r => r.amount) }));
    show(`Income by Client — ${year}`, head("Income by Client", year) +
      tbl([
        { label: "Client / source", value: r => r.name },
        { label: "Entries", value: r => r.count, num: true },
        { label: "1099 portion", value: r => U.money(r.t99), num: true },
        { label: "Total", value: r => U.money(r.total), num: true },
      ], U.sortBy(rows, r => r.total, -1), { totalRow: ["TOTAL", U.sum(rows, r => r.count), U.money(U.sum(rows, r => r.t99)), U.money(U.sum(rows, r => r.total))] }),
      { name: `income-by-client-${year}.csv`, content: U.toCSV(rows, [{ key: "name", label: "Client" }, { key: "count", label: "Entries" }, { key: "t99", label: "1099 Portion" }, { key: "total", label: "Total" }]) });
  }

  function incomeByService(year) {
    const d = Store.yearData(year);
    const rows = Object.entries(U.groupBy(d.income, r => r.serviceType || r.category || "Unspecified"))
      .map(([name, rs]) => ({ name, count: rs.length, total: U.sum(rs, r => r.amount) }));
    show(`Income by Service Type — ${year}`, head("Income by Service Type", year) +
      tbl([{ label: "Service type", value: r => r.name }, { label: "Entries", value: r => r.count, num: true }, { label: "Total", value: r => U.money(r.total), num: true }],
        U.sortBy(rows, r => r.total, -1), { totalRow: ["TOTAL", U.sum(rows, r => r.count), U.money(U.sum(rows, r => r.total))] }));
  }

  function scheduleCSummary(year) {
    const d = Store.yearData(year);
    const map = {};
    for (const e of d.expenses) {
      const line = SCHEMA.scheduleCFor(e.category);
      map[line] = map[line] || { line, gross: 0, deductible: 0, count: 0 };
      map[line].gross += Number(e.amount) || 0;
      map[line].deductible += Store.expenseDeductibleAmt(e);
      map[line].count++;
    }
    const rows = U.sortBy(Object.values(map), r => r.deductible, -1);
    const t = Store.taxSummary(year);
    show(`Schedule C-style Summary — ${year}`, head("Schedule C-style Category Summary (organizer)", year) +
      `<p style="font-size:12px;color:var(--text-2)">Estimated deductible = amount × business-use %, excluding reimbursed and non-deductible items. Your CPA determines the actual return treatment.</p>` +
      tbl([
        { label: "Organizer line", value: r => r.line },
        { label: "Entries", value: r => r.count, num: true },
        { label: "Gross spent", value: r => U.money(r.gross), num: true },
        { label: "Est. deductible", value: r => U.money(r.deductible), num: true },
      ], rows, { totalRow: ["TOTAL (+ mileage below)", U.sum(rows, r => r.count), U.money(U.sum(rows, r => r.gross)), U.money(U.sum(rows, r => r.deductible))] }) +
      `<p style="font-size:12.5px;margin-top:8px"><strong>Standard mileage (Car & Truck, Line 9):</strong> ${U.num(t.mileageMiles, 0)} business miles × $${t.mileageRate.toFixed(2)} ≈ ${U.money(t.mileageDeduction)}</p>`,
      { name: `schedule-c-summary-${year}.csv`, content: U.toCSV(rows, [{ key: "line", label: "Organizer Line" }, { key: "count", label: "Entries" }, { key: "gross", label: "Gross" }, { key: "deductible", label: "Est. Deductible" }]) });
  }

  function expenseDetail(year) {
    const rows = U.sortBy(Store.yearData(year).expenses, e => e.date || "", 1);
    show(`Expense Detail — ${year}`, head("Expense Detail", year) +
      tbl([
        { label: "Date", value: r => U.fmtDate(r.date) },
        { label: "Vendor", value: r => r.vendor || "" },
        { label: "Category", value: r => r.category || "⚠ none" },
        { label: "Purpose", value: r => U.truncate(r.businessPurpose || "⚠ missing", 44) },
        { label: "Receipt", value: r => r.receiptStatus || "Missing" },
        { label: "Biz %", value: r => (r.businessUsePct ?? 100) + "%", num: true },
        { label: "Amount", value: r => U.money(r.amount), num: true },
        { label: "Est. deductible", value: r => U.money(Store.expenseDeductibleAmt(r)), num: true },
      ], rows, { totalRow: ["TOTAL", "", "", "", "", "", U.money(U.sum(rows, r => r.amount)), U.money(U.sum(rows, Store.expenseDeductibleAmt))] }),
      { name: `expense-detail-${year}.csv`, content: U.toCSV(rows, [
        { key: "date", label: "Date" }, { key: "vendor", label: "Vendor" }, { key: "amount", label: "Amount" },
        { key: "category", label: "Category" }, { label: "Schedule C", value: r => SCHEMA.scheduleCFor(r.category) },
        { key: "businessPurpose", label: "Purpose" }, { key: "receiptStatus", label: "Receipt" },
        { key: "receiptRef", label: "Receipt Ref" }, { key: "businessUsePct", label: "Business %" },
        { label: "Est. Deductible", value: Store.expenseDeductibleAmt }, { key: "notes", label: "Notes" }]) });
  }

  function mileageReport(year) {
    const rows = U.sortBy(Store.yearData(year).mileage, m => m.date || "", 1);
    const t = Store.taxSummary(year);
    show(`Mileage Log — ${year}`, head("Business Mileage Log", year) +
      `<p style="font-size:12px;color:var(--text-2)">Standard rate $${t.mileageRate.toFixed(2)}/mi. Business trips only — commuting and personal miles excluded by policy.</p>` +
      tbl([
        { label: "Date", value: r => U.fmtDate(r.date) },
        { label: "From", value: r => U.truncate(r.startLocation || "", 20) },
        { label: "To", value: r => U.truncate(r.destination || "⚠", 26) },
        { label: "Purpose", value: r => U.truncate(r.businessPurpose || "⚠", 36) },
        { label: "WO", value: r => Store.woLabel(r.workOrderId) },
        { label: "Miles", value: r => U.num(r.miles, 1), num: true },
        { label: "Est. deduction", value: r => U.money(Store.tripDeduction(r)), num: true },
      ], rows, { totalRow: ["TOTAL", "", "", "", "", U.num(t.mileageMiles, 1), U.money(t.mileageDeduction)] }));
  }

  function workOrderStatus() {
    const rows = U.sortBy(Store.all("workOrder"), w => w.dateAssigned || "", -1);
    show("Work Order Status Report", head("Work Order Status Report", App.viewYear()) +
      tbl([
        { label: "WO #", value: w => w.woNumber || "" },
        { label: "Client", value: w => Store.clientName(w.clientId) },
        { label: "Type", value: w => w.jobType || "" },
        { label: "Assigned", value: w => U.fmtDate(w.dateAssigned) },
        { label: "Inspected", value: w => U.fmtDate(w.inspectionDate) },
        { label: "Submitted", value: w => U.fmtDate(w.reportSubmittedDate) },
        { label: "Status", value: w => w.status },
        { label: "Fee", value: w => WO.feeText(w), num: true },
      ], rows));
  }

  function invoiceReport(kind) {
    const S = Store.state;
    let rows, title;
    if (kind === "outstanding") { rows = S.invoices.filter(i => ["Sent", "Partial", "Overdue"].includes(i.status) && Store.invoiceBalance(i) > 0.005); title = "Outstanding Invoices"; }
    else if (kind === "paid") { rows = S.invoices.filter(i => i.status === "Paid"); title = "Paid Invoices"; }
    else { rows = S.invoices; title = "Invoice Aging Report"; }
    rows = U.sortBy(rows, i => i.invoiceDate || "", 1);
    show(title, head(title, App.viewYear()) +
      tbl([
        { label: "Invoice", value: i => i.invoiceNumber },
        { label: "Client", value: i => Store.clientName(i.clientId) },
        { label: "Date", value: i => U.fmtDate(i.invoiceDate) },
        { label: "Due", value: i => U.fmtDate(i.dueDate) },
        { label: "Status", value: i => Store.invoiceIsOverdue(i) ? "Overdue" : i.status },
        { label: "Days late", value: i => Store.invoiceIsOverdue(i) ? -U.daysFromToday(i.dueDate) : "", num: true },
        { label: "Total", value: i => U.money(Store.invoiceTotal(i)), num: true },
        { label: "Balance", value: i => U.money(Store.invoiceBalance(i)), num: true },
      ], rows, { totalRow: ["TOTAL", "", "", "", "", "", U.money(U.sum(rows, Store.invoiceTotal)), U.money(U.sum(rows, Store.invoiceBalance))] }));
  }

  function reimbursablesReport(year) {
    const d = Store.yearData(year);
    const exp = d.expenses.filter(e => e.reimbursable);
    const mi = d.mileage.filter(m => m.reimbursable);
    show(`Reimbursable Expenses — ${year}`, head("Reimbursable Expenses & Mileage", year) +
      H("Expenses") +
      tbl([
        { label: "Date", value: r => U.fmtDate(r.date) }, { label: "Vendor", value: r => r.vendor || "" },
        { label: "WO", value: r => Store.woLabel(r.workOrderId) },
        { label: "Reimbursed?", value: r => r.reimbursed ? "Yes" : "NO — bill it" },
        { label: "Amount", value: r => U.money(r.amount), num: true },
      ], exp) +
      H("Mileage") +
      tbl([
        { label: "Date", value: r => U.fmtDate(r.date) }, { label: "Destination", value: r => U.truncate(r.destination || "", 30) },
        { label: "WO", value: r => Store.woLabel(r.workOrderId) },
        { label: "Reimbursed?", value: r => r.reimbursed ? "Yes" : "NO — bill it" },
        { label: "Est. value", value: r => U.money(Store.tripDeduction(r) + (Number(r.parking) || 0) + (Number(r.tolls) || 0)), num: true },
      ], mi));
  }

  function missingDocs(year) {
    const d = Store.yearData(year);
    const noRec = d.expenses.filter(e => !e.receiptStatus || e.receiptStatus === "Missing");
    const noPurp = d.expenses.filter(e => !String(e.businessPurpose || "").trim());
    const badTrips = d.mileage.filter(m => !String(m.destination || "").trim() || !String(m.businessPurpose || "").trim());
    show(`Missing Documentation — ${year}`, head("Missing Documentation Report", year) +
      H(`Expenses missing receipts (${noRec.length})`) +
      tbl([{ label: "Date", value: r => U.fmtDate(r.date) }, { label: "Vendor", value: r => r.vendor || "" }, { label: "Amount", value: r => U.money(r.amount), num: true }], noRec) +
      H(`Expenses missing business purpose (${noPurp.length})`) +
      tbl([{ label: "Date", value: r => U.fmtDate(r.date) }, { label: "Vendor", value: r => r.vendor || "" }, { label: "Amount", value: r => U.money(r.amount), num: true }], noPurp) +
      H(`Incomplete mileage entries (${badTrips.length})`) +
      tbl([{ label: "Date", value: r => U.fmtDate(r.date) }, { label: "Destination", value: r => r.destination || "⚠ missing" }, { label: "Purpose", value: r => r.businessPurpose || "⚠ missing" }, { label: "Miles", value: r => U.num(r.miles, 1), num: true }], badTrips));
  }

  function assetReport() {
    const rows = U.sortBy(Store.all("asset"), a => a.purchaseDate || "", -1);
    show("Asset & Equipment Report", head("Asset / Equipment Report", App.viewYear()) +
      tbl([
        { label: "Item", value: a => a.name }, { label: "Purchased", value: a => U.fmtDate(a.purchaseDate) },
        { label: "Vendor", value: a => a.vendor || "" }, { label: "Category", value: a => a.category || "" },
        { label: "Biz %", value: a => (a.businessUsePct ?? 100) + "%", num: true },
        { label: "Status", value: a => a.status }, { label: "Depreciation", value: a => a.depreciationStatus || "Not Reviewed" },
        { label: "Cost", value: a => U.money(a.cost), num: true },
      ], rows, { totalRow: ["TOTAL", "", "", "", "", "", "", U.money(U.sum(rows, a => a.cost))] }));
  }

  function contractorReport(year) {
    const rows = Store.all("contractor").map(c => ({
      c, paid: U.sum((c.payments || []).filter(p => U.yearOf(p.date) === Number(year)), p => p.amount),
    })).filter(r => r.paid > 0 || r.c.may1099);
    show(`Contractor Payment Review — ${year}`, head("Contractor Payment Summary (1099-NEC review)", year) +
      `<p style="font-size:12px;color:var(--text-2)">Contractors paid $600+ for services generally require a 1099-NEC — confirm requirements and filing with your CPA.</p>` +
      tbl([
        { label: "Contractor", value: r => r.c.name },
        { label: "Business", value: r => r.c.businessName || "" },
        { label: "W-9", value: r => r.c.w9Received ? "On file" : "MISSING" },
        { label: "Likely 1099?", value: r => r.paid >= 600 ? "Yes — review" : "Below $600" },
        { label: `Paid ${year}`, value: r => U.money(r.paid), num: true },
      ], rows, { totalRow: ["TOTAL", "", "", "", U.money(U.sum(rows, r => r.paid))] }));
  }

  function taxPaymentReport(year) {
    const rows = U.sortBy(Store.yearData(year).taxPayments, p => p.date || "", 1);
    const t = Store.taxSummary(year);
    show(`Quarterly Tax Payments — ${year}`, head("Estimated Tax Payment Summary", year) +
      tbl([
        { label: "Date", value: p => U.fmtDate(p.date) }, { label: "Quarter", value: p => p.quarter },
        { label: "Jurisdiction", value: p => p.jurisdiction || "" }, { label: "Method", value: p => p.method || "" },
        { label: "Confirmation", value: p => p.confirmation || "" },
        { label: "Amount", value: p => U.money(p.amount), num: true },
      ], rows, { totalRow: ["TOTAL", "", "", "", "", U.money(t.taxPaymentsMade)] }) +
      `<p style="font-size:12.5px;margin-top:8px">Estimated total reserve for ${year}: <strong>${U.money(t.totalReserve)}</strong> · Remaining: <strong>${U.money(Math.max(t.reserveRemaining, 0))}</strong></p>`);
  }

  function recon1099Report(year) {
    const rows = Alerts.reconcile1099(year);
    show(`1099 Reconciliation — ${year}`, head("1099 Income Reconciliation", year) +
      tbl([
        { label: "Client", value: r => r.clientName },
        { label: "Expected", value: r => r.expected ? "Yes" : "No" },
        { label: "Received", value: r => r.received ? "Yes" : "No" },
        { label: "1099 amount", value: r => U.money(r.amountReceived), num: true },
        { label: "App income", value: r => U.money(r.appTotal), num: true },
        { label: "Difference", value: r => r.received ? U.money(r.difference) : "—", num: true },
        { label: "Status", value: r => !r.expected ? "N/A" : !r.received ? "Pending" : Math.abs(r.difference) > 0.5 ? "MISMATCH — CPA" : "Matches" },
      ], rows));
  }

  function homeOfficeReport(year) {
    const ho = Store.state.homeOffice;
    show(`Home Office Summary — ${year}`, head("Home Office Summary (for CPA review)", year) +
      UI.detailGrid([
        ["Regular & exclusive use", ho.usedRegularlyExclusively ? "Yes (per owner)" : "No / unconfirmed"],
        ["Office sq ft", String(ho.officeSqFt || "—")],
        ["Home sq ft", String(ho.homeSqFt || "—")],
        ["Office % of home", ho.officeSqFt && ho.homeSqFt ? U.pct(ho.officeSqFt / ho.homeSqFt * 100, 1) : "—"],
        ["Simplified est. ($5/sq ft ≤300)", ho.officeSqFt ? U.money(Math.min(ho.officeSqFt, 300) * 5) : "—"],
        ["Utilities (mo)", U.money(ho.utilities)], ["Internet (mo)", U.money(ho.internet)],
        ["Insurance (mo)", U.money(ho.insurance)], ["Repairs (mo)", U.money(ho.repairs)],
        ["Mortgage/rent note", U.escapeHtml(ho.mortgageInterestRentNote || "—")],
        ["Property tax note", U.escapeHtml(ho.propertyTaxNote || "—")],
        ["CPA notes", U.escapeHtml(ho.cpaNotes || "—")],
      ]) +
      `<div class="disclaimer" style="margin-top:14px">Home office deductions should be reviewed with a CPA. This summary organizes records only and does not determine final deductibility.</div>`);
  }

  /* ---------- CPA year-end packet ---------- */
  function cpaPacket(year) {
    const S = Store.state;
    const t = Store.taxSummary(year);
    const d = Store.yearData(year);
    const cpa = Alerts.cpaScore(year);
    const recon = Alerts.reconcile1099(year);
    const byLine = {};
    for (const e of d.expenses) {
      const line = SCHEMA.scheduleCFor(e.category);
      byLine[line] = byLine[line] || { line, deductible: 0, gross: 0, count: 0 };
      byLine[line].deductible += Store.expenseDeductibleAmt(e); byLine[line].gross += Number(e.amount) || 0; byLine[line].count++;
    }
    const flagged = [
      ...d.expenses.filter(e => e.cpaReview).map(e => `Expense: ${U.fmtDate(e.date)} ${e.vendor} ${U.money(e.amount)} — ${e.cpaNotes || e.notes || e.auditNotes || "flagged"}`),
      ...d.income.filter(i => i.cpaReview).map(i => `Income: ${U.fmtDate(i.date)} ${U.money(i.amount)} — ${i.notes || "flagged"}`),
      ...S.assets.filter(a => a.askCpaDepreciation && ["Not Reviewed", "Sent to CPA"].includes(a.depreciationStatus || "Not Reviewed")).map(a => `Asset: ${a.name} ${U.money(a.cost)} — depreciation/Sec. 179 review`),
      ...S.contractors.filter(c => Contractors.paidYtd(c, year) >= 600).map(c => `Contractor: ${c.name} paid ${U.money(Contractors.paidYtd(c, year))} — 1099-NEC review${c.w9Received ? "" : " (W-9 MISSING)"}`),
      ...(S.homeOffice.usedRegularlyExclusively && S.homeOffice.cpaReview ? ["Home office — confirm method and deductibility"] : []),
    ];
    const missing = Alerts.attention(year).filter(a => ["exp-missing-receipt", "exp-missing-purpose", "exp-uncategorized", "mi-missing-purpose"].includes(a.id));
    const ho = S.homeOffice;

    show(`CPA Year-End Packet — ${year}`, head("CPA YEAR-END PACKET", year) +
      H("1. Business summary") +
      UI.detailGrid([
        ["Business", U.escapeHtml(S.settings.businessName)],
        ["Entity", U.escapeHtml(S.settings.entityType)],
        ["Owner", U.escapeHtml(S.settings.ownerName || "—")],
        ["Business start", S.settings.businessStartDate ? U.fmtDate(S.settings.businessStartDate) : "—"],
        ["Records completeness (CPA score)", cpa.score + "/100"],
        ["Export date", U.fmtDate(U.todayISO())],
      ]) +
      H("2. Income summary") +
      UI.detailGrid([
        ["Gross income", U.money(t.grossIncome)],
        ["1099 income", U.money(U.sum(d.income.filter(i => i.is1099), i => i.amount))],
        ["Other income", U.money(U.sum(d.income.filter(i => !i.is1099), i => i.amount))],
        ["Income entries", String(d.income.length)],
      ]) +
      H("3. 1099 reconciliation") +
      tbl([
        { label: "Client", value: r => r.clientName }, { label: "1099 received", value: r => r.received ? "Yes" : "No" },
        { label: "1099 amt", value: r => U.money(r.amountReceived), num: true }, { label: "App income", value: r => U.money(r.appTotal), num: true },
        { label: "Diff", value: r => r.received ? U.money(r.difference) : "—", num: true },
      ], recon) +
      H("4. Expense summary (Schedule C-style organizer)") +
      tbl([
        { label: "Organizer line", value: r => r.line }, { label: "Entries", value: r => r.count, num: true },
        { label: "Gross", value: r => U.money(r.gross), num: true }, { label: "Est. deductible", value: r => U.money(r.deductible), num: true },
      ], U.sortBy(Object.values(byLine), r => r.deductible, -1),
        { totalRow: ["TOTAL", "", U.money(U.sum(Object.values(byLine), r => r.gross)), U.money(t.deductibleExpenses)] }) +
      H("5. Mileage") +
      `<p style="font-size:12.5px">${U.num(t.mileageMiles, 0)} business miles × $${t.mileageRate.toFixed(2)} ≈ <strong>${U.money(t.mileageDeduction)}</strong> (standard-rate estimate). Full log available as a separate report. ${Alerts.mileageScore(year).score}% of trips fully substantiated.</p>` +
      H("6. Assets purchased / in service") +
      tbl([
        { label: "Item", value: a => a.name }, { label: "Purchased", value: a => U.fmtDate(a.purchaseDate) },
        { label: "Cost", value: a => U.money(a.cost), num: true }, { label: "Biz %", value: a => (a.businessUsePct ?? 100) + "%", num: true },
        { label: "Depreciation status", value: a => a.depreciationStatus || "Not Reviewed" },
      ], S.assets) +
      H("7. Home office") +
      `<p style="font-size:12.5px">${ho.usedRegularlyExclusively ? `Claimed regular & exclusive use. Office ${ho.officeSqFt} sq ft of ${ho.homeSqFt} sq ft home (${ho.officeSqFt && ho.homeSqFt ? U.pct(ho.officeSqFt / ho.homeSqFt * 100, 1) : "—"}). Simplified est. ${U.money(Math.min(ho.officeSqFt || 0, 300) * 5)}. Monthly actuals recorded: utilities ${U.money(ho.utilities)}, internet ${U.money(ho.internet)}, insurance ${U.money(ho.insurance)}, repairs ${U.money(ho.repairs)}. Notes: ${U.escapeHtml(ho.cpaNotes || "—")}` : "Not claimed / not configured."}</p>` +
      H("8. Contractor payments") +
      tbl([
        { label: "Contractor", value: c => c.name }, { label: "W-9", value: c => c.w9Received ? "Yes" : "NO" },
        { label: `Paid ${year}`, value: c => U.money(Contractors.paidYtd(c, year)), num: true },
      ], S.contractors.filter(c => Contractors.paidYtd(c, year) > 0)) +
      H("9. Quarterly estimated payments") +
      tbl([
        { label: "Date", value: p => U.fmtDate(p.date) }, { label: "Q", value: p => p.quarter },
        { label: "Jurisdiction", value: p => p.jurisdiction || "" }, { label: "Amount", value: p => U.money(p.amount), num: true },
      ], d.taxPayments, { totalRow: ["TOTAL", "", "", U.money(t.taxPaymentsMade)] }) +
      H("10. Missing documentation") +
      (missing.length ? missing.map(a => `<p style="font-size:12.5px;margin:3px 0">• ${U.escapeHtml(a.title)}: <strong>${a.count}</strong></p>`).join("") : `<p style="font-size:12.5px">None — documentation complete. ✓</p>`) +
      H("11. Items flagged for CPA review") +
      (flagged.length ? flagged.map(f => `<p style="font-size:12.5px;margin:3px 0">• ${U.escapeHtml(f)}</p>`).join("") : `<p style="font-size:12.5px">None flagged.</p>`) +
      H("12. Assumptions used in estimates") +
      `<p style="font-size:12.5px">SE tax ${S.settings.seTaxRatePct}% of 92.35% of net · Federal reserve ${S.settings.federalReservePct}% · State reserve ${S.settings.stateReservePct}% · Mileage $${Store.mileageRate(year).toFixed(2)}/mi. All figures are bookkeeping estimates prepared by the owner, not tax determinations.</p>`);
    // mark checklist item
    const yc = S.yearChecklists[String(year)] = S.yearChecklists[String(year)] || {};
    yc.cpaExport = true; Store.save();
  }

  /* ---------- IRS audit-readiness packet ---------- */
  function auditPacket(year) {
    const audit = Alerts.auditScore(year);
    const d = Store.yearData(year);
    const dupes = Store.findDuplicates();
    const integ = Store.integrityCheck();
    show(`IRS Audit-Readiness Packet — ${year}`, head("IRS AUDIT-READINESS PACKET", year) +
      H("Substantiation posture") +
      `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">${Charts.scoreRing(audit.score, { size: 110, label: "Audit ready" })}
        <div style="flex:1;min-width:220px">${audit.detail.length ? audit.detail.map(x => `<div class="score-line"><span>${U.escapeHtml(x.title)} (${x.count})</span><span class="${x.severity === "bad" ? "bad" : "warn"}">−${x.penalty}</span></div>`).join("") : `<p style="font-size:13px">No substantiation gaps detected. ✓</p>`}</div></div>` +
      H("Records inventory") +
      UI.detailGrid([
        ["Income entries", String(d.income.length)],
        ["Expense entries", String(d.expenses.length)],
        ["— with receipt attached/referenced", String(d.expenses.filter(e => e.receiptStatus && e.receiptStatus !== "Missing").length)],
        ["— with business purpose", String(d.expenses.filter(e => String(e.businessPurpose || "").trim()).length)],
        ["Mileage trips", String(d.mileage.length)],
        ["— fully substantiated", String(Alerts.mileageScore(year).complete)],
        ["Invoices", String(d.invoices.length)],
        ["Receipts/documents", String(Store.all("receipt").filter(r => U.yearOf(r.date) === year).length)],
        ["Audit log entries", String(Store.state.auditLog.length)],
      ]) +
      H("Data integrity") +
      (integ.length ? integ.map(i => `<p style="font-size:12.5px;margin:3px 0;color:var(--red)">• ${U.escapeHtml(i)}</p>`).join("") : `<p style="font-size:12.5px">No referential integrity issues. ✓</p>`) +
      H("Possible duplicates") +
      (dupes.length ? dupes.map(x => `<p style="font-size:12.5px;margin:3px 0;color:var(--amber)">• ${U.escapeHtml(x.label)}</p>`).join("") : `<p style="font-size:12.5px">No duplicates detected. ✓</p>`) +
      H("Record-keeping practices") +
      `<p style="font-size:12.5px">All records carry created/modified timestamps and a field-level edit history (audit trail). Mileage logged contemporaneously with date, destination, purpose, and miles. Receipts attached or referenced with storage location. Reimbursed expenses are excluded from deductible totals to prevent double-counting. Business-use percentages applied to mixed-use expenses.</p>`);
  }

  return {
    checklistItems, show,
    plByMonth, incomeByClient, incomeByService, scheduleCSummary, expenseDetail, mileageReport,
    workOrderStatus, invoiceReport, reimbursablesReport, missingDocs, assetReport, contractorReport,
    taxPaymentReport, recon1099Report, homeOfficeReport, cpaPacket, auditPacket,
  };
})();

Views.reports = {
  title: "Reports",
  render(el) {
    const year = App.viewYear();
    const groups = [
      { name: "Financial", items: [
        { icon: "📈", label: "Profit & Loss (by month + year)", sub: "Income, expenses, mileage, net", fn: () => Reports.plByMonth(year) },
        { icon: "🏢", label: "Income by client", sub: "With 1099 portions", fn: () => Reports.incomeByClient(year) },
        { icon: "🧰", label: "Income by service type", sub: "", fn: () => Reports.incomeByService(year) },
        { icon: "🧾", label: "Invoice aging", sub: "All invoices with days late", fn: () => Reports.invoiceReport("aging") },
        { icon: "🔴", label: "Outstanding invoices", sub: "Open balances", fn: () => Reports.invoiceReport("outstanding") },
        { icon: "✅", label: "Paid invoices", sub: "", fn: () => Reports.invoiceReport("paid") },
        { icon: "↩️", label: "Reimbursable expenses", sub: "Billed and unbilled", fn: () => Reports.reimbursablesReport(year) },
      ]},
      { name: "Tax organizer", items: [
        { icon: "📋", label: "Schedule C-style category summary", sub: "The report your CPA wants first", fn: () => Reports.scheduleCSummary(year) },
        { icon: "💳", label: "Expense detail", sub: "Every expense with substantiation status", fn: () => Reports.expenseDetail(year) },
        { icon: "🚗", label: "Mileage log", sub: "IRS-style contemporaneous log", fn: () => Reports.mileageReport(year) },
        { icon: "🛠️", label: "Asset / equipment report", sub: "For depreciation review", fn: () => Reports.assetReport() },
        { icon: "🏠", label: "Home office summary", sub: "", fn: () => Reports.homeOfficeReport(year) },
        { icon: "👷", label: "Contractor payment review", sub: "1099-NEC candidates", fn: () => Reports.contractorReport(year) },
        { icon: "🏛️", label: "Quarterly tax payment summary", sub: "", fn: () => Reports.taxPaymentReport(year) },
        { icon: "🔀", label: "1099 income reconciliation", sub: "", fn: () => Reports.recon1099Report(year) },
      ]},
      { name: "Operations & documentation", items: [
        { icon: "📋", label: "Work order status report", sub: "", fn: () => Reports.workOrderStatus() },
        { icon: "🚨", label: "Missing documentation report", sub: "Receipts, purposes, incomplete trips", fn: () => Reports.missingDocs(year) },
      ]},
      { name: "Year-end packets", items: [
        { icon: "📦", label: "CPA year-end packet", sub: "Everything your CPA needs, in one printable document", fn: () => Reports.cpaPacket(year), primary: true },
        { icon: "🛡️", label: "IRS audit-readiness packet", sub: "Substantiation posture + integrity checks", fn: () => Reports.auditPacket(year), primary: true },
      ]},
    ];

    el.innerHTML = UI.pageHeader("Reports & Exports",
      `Printable, CPA-ready reports for tax year <strong>${year}</strong>. Use Print → Save as PDF for clean copies. JSON backup lives in Settings.`,
      App.yearPickerHtml()) +
      groups.map(g => `
        <div class="card">
          <div class="card-title">${U.escapeHtml(g.name)}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">
            ${g.items.map((it, i) => `
              <button class="btn" data-report="${g.name}|${i}" style="justify-content:flex-start;text-align:left;min-height:56px;${it.primary ? "border-color:var(--accent);background:var(--accent-soft)" : ""}">
                <span style="font-size:19px">${it.icon}</span>
                <span><span style="display:block;font-weight:700">${U.escapeHtml(it.label)}</span>
                ${it.sub ? `<span style="display:block;font-size:11.5px;color:var(--text-2);font-weight:400">${U.escapeHtml(it.sub)}</span>` : ""}</span>
              </button>`).join("")}
          </div>
        </div>`).join("") +
      UI.disclaimerHtml();

    el.querySelectorAll("[data-report]").forEach(btn => btn.addEventListener("click", () => {
      const [gname, i] = btn.getAttribute("data-report").split("|");
      const g = groups.find(x => x.name === gname);
      g.items[Number(i)].fn();
    }));
  },
};
