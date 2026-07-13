/* =========================================================
   views/workorders.js — forensic engineering job tracker:
   list, detail view, quick actions, alerts.
   ========================================================= */
"use strict";

window.Views = window.Views || {};

const WO = (() => {

  /* ---- derived helpers ---- */
  function linked(w) {
    const S = Store.state;
    return {
      invoices: S.invoices.filter(i => i.workOrderId === w.id),
      income: S.income.filter(i => i.workOrderId === w.id),
      expenses: S.expenses.filter(e => e.workOrderId === w.id),
      mileage: S.mileage.filter(m => m.workOrderId === w.id),
      receipts: S.receipts.filter(r => r.workOrderId === w.id),
    };
  }

  /** Billing stage derived purely from linked records — no manual updating. */
  function billingState(w) {
    const L = linked(w);
    if (L.invoices.some(i => i.status === "Paid")) return { label: "Paid ✓", color: "green", rank: 2 };
    if (L.invoices.length) return { label: "Invoiced ✓", color: "blue", rank: 1 };
    if (L.income.length) return { label: "Income logged", color: "green", rank: 2 };
    return { label: "Not invoiced", color: "slate", rank: 0 };
  }

  function warnings(w) {
    const L = linked(w);
    const out = [];
    // status vs. reality checks (catches manual status changes that don't match the records)
    if (["Invoiced", "Paid", "Closed"].includes(w.status) && !L.invoices.length && !L.income.length)
      out.push({ text: `Marked ${w.status} — no invoice or income linked`, color: "amber" });
    if (["Paid", "Closed"].includes(w.status) && L.invoices.length && !L.invoices.some(i => i.status === "Paid") && !L.income.length)
      out.push({ text: `Marked ${w.status} — invoice not paid`, color: "amber" });
    if (SCHEMA.woOpenStatuses.includes(w.status) && w.reportDueDate) {
      const dd = U.daysFromToday(w.reportDueDate);
      if (dd < 0) out.push({ text: `Report overdue by ${-dd}d`, color: "red" });
      else if (dd <= 5) out.push({ text: `Report due in ${dd}d`, color: "amber" });
    }
    if (w.status === "Submitted" && !L.invoices.length) out.push({ text: "Submitted — not invoiced", color: "amber" });
    if (L.invoices.some(Store.invoiceIsOverdue)) out.push({ text: "Invoice overdue", color: "red" });
    if (w.mileageAllowed && ["Inspected", "Report Drafting", "Submitted", "Invoiced", "Paid", "Closed"].includes(w.status) && !L.mileage.length)
      out.push({ text: "No mileage logged", color: "amber" });
    if ((Number(w.parkingTolls) || 0) > 0 && !L.expenses.length)
      out.push({ text: "Parking/tolls expected — no expenses linked", color: "amber" });
    return out;
  }

  function jobFinancials(w) {
    const L = linked(w);
    const income = U.sum(L.income, r => r.amount);
    const invoiced = U.sum(L.invoices, Store.invoiceTotal);
    const costs = U.sum(L.expenses.filter(e => !(e.reimbursable && e.reimbursed)), e => e.amount);
    const miCost = U.sum(L.mileage.filter(m => !(m.reimbursable && m.reimbursed)), Store.tripDeduction);
    const profit = U.round2((income || invoiced) - costs - miCost);
    const hrs = Number(w.actualHours) || 0;
    return { income, invoiced, costs: U.round2(costs + miCost), profit, ehr: hrs ? U.round2(profit / hrs) : null, miles: U.sum(L.mileage, m => m.miles) };
  }

  function feeText(w) {
    if (w.feeType === "Hourly") return `${U.money(w.hourlyRate)}/hr`;
    if (w.feeType === "T&E") return "T&E";
    return w.flatFee ? U.money(w.flatFee) : (w.feeType || "—");
  }

  /** Expected service fee for a job that hasn't been invoiced yet (organizer estimate). */
  function expectedFee(w) {
    if (w.feeType === "Hourly" || w.feeType === "T&E") {
      const hrs = Number(w.actualHours) || Number(w.estimatedHours) || 0;
      return U.round2(hrs * (Number(w.hourlyRate) || 0));
    }
    return Number(w.flatFee) || 0; // Flat Fee / Do-Not-Exceed Budget
  }

  /** true when the job is expected to produce an invoice but none exists yet */
  function isPendingInvoice(w) {
    if (![...SCHEMA.woOpenStatuses, "Submitted"].includes(w.status)) return false;
    return !Store.state.invoices.some(i => i.workOrderId === w.id);
  }

  /* ---- quick status change ---- */
  const STATUS_DATE_STAMPS = { Inspected: "inspectionDate", Submitted: "reportSubmittedDate", Invoiced: "invoiceDate", Paid: "paymentDate" };

  function changeStatus(w, status, { onDone } = {}) {
    if (!status || status === w.status) return;
    const patch = { status };
    const dateField = STATUS_DATE_STAMPS[status];
    let stamped = false;
    if (dateField && !w[dateField]) { patch[dateField] = U.todayISO(); stamped = true; }
    Store.update("workOrder", w.id, patch);
    UI.toast(`${w.woNumber || "Work order"} → ${status}${stamped ? " · today's date stamped" : ""}`, "success");
    App.rerender();
    if (onDone) onDone(Store.get("workOrder", w.id));
  }

  function openStatusSheet(w, opts) {
    UI.sheet({
      title: `Status — ${w.woNumber || "Work Order"} (now: ${w.status})`,
      items: SCHEMA.workOrderStatuses.map(s => ({
        icon: s.value === w.status ? "✅" : `<span style="color:var(--${s.color === "accent" ? "accent" : s.color})">●</span>`,
        label: s.value,
        action: () => changeStatus(w, s.value, opts),
      })),
    });
  }

  /* ---- CRUD ---- */
  function openEditor(rec, presets, opts = {}) {
    UI.openForm("workOrder", rec, {
      presets,
      onSave: vals => {
        const saved = rec ? Store.update("workOrder", rec.id, vals) : Store.add("workOrder", vals);
        UI.toast(rec ? "Work order updated" : "Work order added", "success");
        if (saved && opts.afterSave) opts.afterSave(saved);
        App.rerender();
      },
      deleteFn: r => { Store.remove("workOrder", r.id); UI.toast("Work order deleted"); App.rerender(); },
    });
  }

  function duplicate(w) {
    const copy = { ...U.clone(w) };
    delete copy.id; delete copy.createdAt; delete copy.updatedAt;
    Object.assign(copy, {
      woNumber: "", projectNumber: "", status: "New", dateAssigned: U.todayISO(),
      inspectionDate: "", reportDueDate: "", reportSubmittedDate: "", invoiceDate: "", paymentDate: "",
      actualHours: "", signatureDate: "",
    });
    openEditor(null, copy);
    UI.toast("Duplicated — set the new WO # and dates");
  }

  /** Per-mile reimbursement rate for a job: a "$0.70/mi"-style rate parsed from
      the work order's mileage note, else the configured IRS/agreed rate. */
  function mileageBillRate(w) {
    const m = String(w.mileageAmount || "").match(/\$?\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*mi/i);
    if (m) { const r = Number(m[1]); if (r > 0 && r < 10) return r; }
    // IRS rate for the year the driving happened (inspection), else assignment year
    return Store.mileageRate(U.yearOf(w.inspectionDate || w.dateAssigned || U.todayISO()));
  }

  function routeStart() {
    const s = Store.state.settings;
    return (s.homeBase && /\d/.test(s.homeBase)) ? s.homeBase : (s.businessAddress || s.homeBase || "").replace(/\n/g, ", ").trim();
  }

  /** Auto-calculate a mileage reimbursement from the office → loss-location round trip. */
  async function calcRouteMileageReimb(w) {
    const from = routeStart();
    if (!from) throw new Error("Set your office address in Settings → Home base first");
    const to = (w.lossLocation || "").split("\n").map(s => s.trim()).filter(Boolean).join(", ");
    if (!to) throw new Error("This work order has no loss-location address to route to");
    const oneWay = await U.drivingMiles(from, to);
    const miles = U.round2(oneWay * 2);
    const rate = mileageBillRate(w);
    return { oneWay: U.round2(oneWay), miles, rate, amount: U.round2(miles * rate) };
  }

  function createInvoiceFrom(w, detailModal) {
    const client = Store.get("client", w.clientId);
    const L = linked(w);
    const billableTrips = L.mileage.filter(m => m.reimbursable && !m.reimbursed);
    const loggedMi = U.round2(U.sum(billableTrips, m => Store.tripDeduction(m) + (Number(m.parking) || 0) + (Number(m.tolls) || 0)));
    const flatMi = w.mileageReimbType === "Flat fee" ? (Number(w.mileageFlatFee) || 0) : 0;
    const miReimb = flatMi || loggedMi;
    // when mileage is billable per-mile but no trips are logged, calculate from the route
    const autoCalc = w.mileageAllowed && w.mileageReimbType !== "Flat fee" && !billableTrips.length && !!(w.lossLocation || "").trim();
    const exReimb = U.round2(U.sum(L.expenses.filter(e => e.reimbursable && !e.reimbursed), e => e.amount));
    const nextNum = `INV-${App.viewYear()}-${String(Store.all("invoice").length + 1).padStart(3, "0")}`;
    const terms = (client && client.paymentTerms) || Store.state.settings.defaultPaymentTerms || "Net 30";
    const days = { "Due on Receipt": 0, "Net 15": 15, "Net 30": 30, "Net 45": 45, "Net 60": 60 }[terms] ?? 30;
    const due = new Date(); due.setDate(due.getDate() + days);
    const m = UI.openForm("invoice", null, {
      presets: {
        invoiceNumber: nextNum, clientId: w.clientId, workOrderId: w.id,
        invoiceDate: U.todayISO(), dueDate: due.toISOString().slice(0, 10),
        status: "Draft",
        serviceDescription: `${w.serviceType || "Professional engineering services"} — ${w.jobType ? w.jobType + " loss, " : ""}claim ${w.claimNumber || "—"} (${w.woNumber || "WO"})`,
        feeType: w.feeType === "Hourly" ? "Hourly" : "Flat Fee",
        flatFee: w.flatFee || (client && client.defaultFlatFee) || "",
        hours: w.actualHours || "", rate: w.hourlyRate || (client && client.defaultHourlyRate) || "",
        mileageReimb: w.mileageAllowed ? miReimb : 0, expenseReimb: exReimb,
        notes: w.invoiceRemittance || (client && client.remittanceInstructions) || "",
      },
      onSave: vals => {
        const inv = Store.add("invoice", vals);
        if (w.status === "Submitted" || SCHEMA.woOpenStatuses.includes(w.status)) Store.update("workOrder", w.id, { status: "Invoiced", invoiceDate: vals.invoiceDate });
        // mark reimbursables as billed
        L.mileage.filter(m => m.reimbursable && !m.reimbursed).forEach(m => Store.update("mileage", m.id, { reimbursed: true, notes: ((m.notes || "") + ` Billed on ${inv.invoiceNumber}.`).trim() }));
        L.expenses.filter(e => e.reimbursable && !e.reimbursed).forEach(e => Store.update("expense", e.id, { reimbursed: true, notes: ((e.notes || "") + ` Billed on ${inv.invoiceNumber}.`).trim() }));
        UI.toast(`Invoice ${inv.invoiceNumber} created`, "success");
        if (detailModal) detailModal.close();
        App.go("invoices");
      },
    });
    // fill the mileage line from the route once the form is open (non-blocking)
    if (autoCalc && m && m.body) {
      const field = m.body.querySelector('[data-key="mileageReimb"]');
      if (field) {
        field.disabled = true;
        UI.toast("Calculating mileage from the route…");
        calcRouteMileageReimb(w).then(res => {
          field.value = res.amount; field.disabled = false;
          UI.toast(`Mileage: ${U.num(res.miles, 1)} mi × $${res.rate.toFixed(2)}/mi = ${U.money(res.amount)} — edit if needed`, "success", 5000);
        }).catch(e => {
          field.disabled = false;
          UI.toast(`Mileage not auto-calculated (${e.message}). Use 📍 Calculate on the field.`, "error", 6000);
        });
      }
    }
    return m;
  }

  function exportSummary(w) {
    const L = linked(w);
    const fin = jobFinancials(w);
    const lines = [
      `WORK ORDER SUMMARY — ${Store.state.settings.businessName}`,
      `Exported ${U.fmtDateTime(U.nowISO())}`,
      ``,
      `WO #: ${w.woNumber || ""}    Project #: ${w.projectNumber || ""}    Status: ${w.status}`,
      `Client: ${Store.clientName(w.clientId)}    Carrier: ${w.insuranceCarrier || ""}`,
      `Claim #: ${w.claimNumber || ""}    Policy #: ${w.policyNumber || ""}    CAT: ${w.catNumber || ""}`,
      `Insured: ${w.insuredName || ""}    Loss location: ${(w.lossLocation || "").replace(/\n/g, ", ")}`,
      `Job type: ${w.jobType || ""} / ${w.residentialCommercial || ""}    Date of loss: ${U.fmtDate(w.dateOfLoss)}`,
      `Assigned: ${U.fmtDate(w.dateAssigned)}  Inspected: ${U.fmtDate(w.inspectionDate)}  Report due: ${U.fmtDate(w.reportDueDate)}  Submitted: ${U.fmtDate(w.reportSubmittedDate)}`,
      `Fee: ${w.feeType || ""} ${feeText(w)}    Hours (est/actual): ${w.estimatedHours || "—"}/${w.actualHours || "—"}`,
      ``,
      `Scope: ${w.scopeOfService || ""}`,
      `Description of loss: ${w.descriptionOfLoss || ""}`,
      ``,
      `FINANCIALS`,
      `  Invoiced: ${U.money(fin.invoiced)}   Income received: ${U.money(fin.income)}   Job costs: ${U.money(fin.costs)}   Est. profit: ${U.money(fin.profit)}${fin.ehr != null ? `   Effective rate: ${U.money(fin.ehr)}/hr` : ""}`,
      `  Linked: ${L.invoices.length} invoice(s), ${L.expenses.length} expense(s), ${L.mileage.length} mileage trip(s) (${U.num(fin.miles, 1)} mi), ${L.receipts.length} receipt(s)`,
      ``,
      `Internal notes: ${w.internalNotes || ""}`,
      `CPA notes: ${w.cpaNotes || ""}`,
      `Audit notes: ${w.auditNotes || ""}`,
    ];
    U.download(`${(w.woNumber || "workorder").replace(/\W+/g, "-")}-summary.txt`, lines.join("\n"), "text/plain");
    UI.toast("Job summary downloaded", "success");
  }

  /* ---- detail modal ---- */
  function openDetail(w) {
    w = Store.get("workOrder", w.id) || w;
    const L = linked(w);
    const fin = jobFinancials(w);
    const warns = warnings(w);
    const dg = UI.detailGrid;
    const val = v => v ? U.escapeHtml(v) : "";
    const multiline = v => v ? U.escapeHtml(v).replace(/\n/g, "<br>") : "";

    const m = UI.modal({
      title: `📋 ${U.escapeHtml(w.woNumber || "Work Order")} ${UI.statusBadge(SCHEMA.workOrderStatuses, w.status)}`,
      size: "lg",
      body: `
        ${warns.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${warns.map(x => UI.badge(x.text, x.color)).join("")}</div>` : ""}
        <div class="wo-status-track" id="wo-status-track" title="Tap a stage to change status">
          ${SCHEMA.workOrderStatuses.map(s => `<button type="button" class="status-chip badge-${s.color}${s.value === w.status ? " current" : ""}" data-status="${U.escapeHtml(s.value)}">${U.escapeHtml(s.value)}</button>`).join("")}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px" id="wo-actions">
          <button class="btn btn-sm btn-primary" data-act="edit">✏️ Edit</button>
          <button class="btn btn-sm" data-act="mileage">🚗 Add mileage</button>
          <button class="btn btn-sm" data-act="expense">💳 Add expense</button>
          <button class="btn btn-sm" data-act="receipt">📎 Add receipt</button>
          ${!L.invoices.length ? `<button class="btn btn-sm" data-act="invoice">🧾 Create invoice</button>` : ""}
          ${SCHEMA.woOpenStatuses.includes(w.status) ? `<button class="btn btn-sm" data-act="submitted">📤 Mark submitted</button>` : ""}
          ${w.status === "Invoiced" ? `<button class="btn btn-sm" data-act="paid">✅ Mark paid</button>` : ""}
          <button class="btn btn-sm" data-act="duplicate">🧬 Duplicate</button>
          <button class="btn btn-sm" data-act="export">⬇️ Export summary</button>
        </div>

        <div class="card" style="margin-bottom:14px">
          <div class="card-title">💼 Job financials (estimates)</div>
          <div class="detail-grid">
            ${isPendingInvoice(w) ? `<div class="detail-item"><div class="detail-label">Pending fee (not invoiced)</div><div class="detail-value" style="font-weight:800;color:var(--purple)">${U.money(expectedFee(w))}</div></div>` : ""}
            <div class="detail-item"><div class="detail-label">Invoiced</div><div class="detail-value">${U.money(fin.invoiced)}</div></div>
            <div class="detail-item"><div class="detail-label">Income received</div><div class="detail-value">${U.money(fin.income)}</div></div>
            <div class="detail-item"><div class="detail-label">Job costs (unreimbursed)</div><div class="detail-value">${U.money(fin.costs)}</div></div>
            <div class="detail-item"><div class="detail-label">Est. profit</div><div class="detail-value" style="font-weight:800;color:${fin.profit >= 0 ? "var(--green)" : "var(--red)"}">${U.money(fin.profit)}</div></div>
            ${fin.ehr != null ? `<div class="detail-item"><div class="detail-label">Effective rate</div><div class="detail-value">${U.money(fin.ehr)}/hr</div></div>` : ""}
            <div class="detail-item"><div class="detail-label">Miles logged</div><div class="detail-value">${U.num(fin.miles, 1)}</div></div>
          </div>
        </div>

        <h3 style="font-size:13px;margin:14px 0 6px;color:var(--accent-strong);text-transform:uppercase;letter-spacing:.05em">Assignment & claim</h3>
        ${dg([
          ["Client", val(Store.clientName(w.clientId))],
          ["Project #", val(w.projectNumber)],
          ["Assigned", U.fmtDate(w.dateAssigned)],
          ["Field engineer", val(w.fieldEngineer)],
          ["PE #", val(w.peNumber)],
          ["COA #", val(w.coaNumber)],
          ["Carrier", val(w.insuranceCarrier)],
          w.carrierContact ? ["Carrier contact", val(w.carrierContact) + (w.carrierContactPhone ? "<br>" + val(w.carrierContactPhone) : "")] : null,
          ["Claim #", val(w.claimNumber)],
          ["Policy #", val(w.policyNumber)],
          ["CAT", val(w.catNumber)],
          ["Date of loss", U.fmtDate(w.dateOfLoss)],
          ["Job type", val(w.jobType)],
          ["Service", val(w.serviceType)],
          ["Property class", val(w.residentialCommercial)],
        ])}

        <h3 style="font-size:13px;margin:14px 0 6px;color:var(--accent-strong);text-transform:uppercase;letter-spacing:.05em">Insured & property</h3>
        ${dg([
          ["Insured", val(w.insuredName)],
          ["Insured contact", val(w.insuredContact)],
          ["Phone", val(w.insuredPhone)],
          ["Email", val(w.insuredEmail)],
          ["Loss location", multiline(w.lossLocation)],
          ["Description of loss", multiline(w.descriptionOfLoss)],
          ["Property", multiline(w.descriptionOfProperty)],
          ["Scope of service", multiline(w.scopeOfService)],
          ["Instructions", multiline(w.additionalNotes)],
          w.paContact ? ["Public adjuster", val(w.paContact) + (w.paPhoneEmail ? "<br>" + val(w.paPhoneEmail) : "")] : null,
          w.attorneyContact ? ["Attorney", val(w.attorneyContact) + (w.attorneyPhoneEmail ? "<br>" + val(w.attorneyPhoneEmail) : "")] : null,
        ])}

        <h3 style="font-size:13px;margin:14px 0 6px;color:var(--accent-strong);text-transform:uppercase;letter-spacing:.05em">Schedule, fees & delivery</h3>
        ${dg([
          ["Inspection", U.fmtDate(w.inspectionDate)],
          ["Report due", U.fmtDate(w.reportDueDate)],
          ["Report submitted", U.fmtDate(w.reportSubmittedDate)],
          ["Invoice date", U.fmtDate(w.invoiceDate)],
          ["Payment date", U.fmtDate(w.paymentDate)],
          ["Fee", `${val(w.feeType)} · ${feeText(w)}`],
          ["Hours est / actual", `${w.estimatedHours || "—"} / ${w.actualHours || "—"}`],
          ["Mileage reimbursable", w.mileageAllowed
            ? (w.mileageReimbType === "Flat fee"
              ? `Yes — flat fee ${w.mileageFlatFee ? U.money(w.mileageFlatFee) : "(amount not set)"}`
              : "Yes" + (w.mileageAmount ? " — " + val(w.mileageAmount) : " — per mile"))
            : "No"],
          ["Parking/tolls budget", w.parkingTolls ? U.money(w.parkingTolls) : "—"],
          ["Upload location", val(w.uploadLocation)],
          ["Report remittance", multiline(w.reportRemittance)],
          ["Invoice remittance", multiline(w.invoiceRemittance)],
          w.signatureName ? ["Signature", `${val(w.signatureName)} · ${U.fmtDate(w.signatureDate)}`] : null,
        ])}

        ${(w.internalNotes || w.cpaNotes || w.auditNotes) ? `
        <h3 style="font-size:13px;margin:14px 0 6px;color:var(--accent-strong);text-transform:uppercase;letter-spacing:.05em">Notes</h3>
        ${dg([
          w.internalNotes ? ["Internal", multiline(w.internalNotes)] : null,
          w.cpaNotes ? ["CPA", multiline(w.cpaNotes)] : null,
          w.auditNotes ? ["Audit", multiline(w.auditNotes)] : null,
        ])}` : ""}

        <h3 style="font-size:13px;margin:16px 0 6px;color:var(--accent-strong);text-transform:uppercase;letter-spacing:.05em">Linked records</h3>
        ${linkedList("🧾 Invoices", L.invoices.map(i => `${i.invoiceNumber} — ${U.money(Store.invoiceTotal(i))} — ${i.status}`))}
        ${linkedList("💵 Income", L.income.map(i => `${U.fmtDate(i.date)} — ${U.money(i.amount)}`))}
        ${linkedList("💳 Expenses", L.expenses.map(e => `${U.fmtDate(e.date)} — ${e.vendor} — ${U.money(e.amount)}${e.reimbursable ? (e.reimbursed ? " (reimbursed)" : " (reimbursable)") : ""}`))}
        ${linkedList("🚗 Mileage", L.mileage.map(t => `${U.fmtDate(t.date)} — ${U.num(t.miles, 1)} mi — ${U.truncate(t.destination || "?", 34)}`))}
        ${linkedList("📎 Receipts", L.receipts.map(r => `${U.fmtDate(r.date)} — ${r.vendor}${r.amount ? " — " + U.money(r.amount) : ""}`))}
        <div style="font-size:11.5px;color:var(--text-3);margin-top:12px">Created ${U.fmtDateTime(w.createdAt)} · Modified ${U.fmtDateTime(w.updatedAt)} · Full history in the Audit Trail</div>
      `,
      footer: `<button class="btn" id="wo-close">Close</button>`,
    });

    function linkedList(title, items) {
      if (!items.length) return "";
      return `<div style="margin-bottom:8px"><div style="font-size:12.5px;font-weight:700;margin-bottom:3px">${title}</div>
        ${items.map(x => `<div style="font-size:12.5px;color:var(--text-2);padding:2px 0 2px 10px;border-left:2px solid var(--border)">${U.escapeHtml(x)}</div>`).join("")}</div>`;
    }

    m.footerEl.querySelector("#wo-close").addEventListener("click", () => m.close());
    m.body.querySelector("#wo-status-track").addEventListener("click", e => {
      const status = e.target.closest("[data-status]")?.getAttribute("data-status");
      if (!status || status === w.status) return;
      changeStatus(w, status, { onDone: nw => { m.close(); openDetail(nw); } });
    });
    m.body.querySelector("#wo-actions").addEventListener("click", e => {
      const act = e.target.closest("[data-act]")?.getAttribute("data-act");
      if (!act) return;
      const presets = { workOrderId: w.id, clientId: w.clientId };
      switch (act) {
        case "edit": m.close(); openEditor(w); break;
        case "mileage":
          UI.openForm("mileage", null, { presets: { ...presets, businessPurpose: `Inspection — ${w.jobType || "site"} (${w.woNumber || ""})`.trim(), destination: (w.lossLocation || "").split("\n")[0], reimbursable: !!w.mileageAllowed },
            onSave: v => { Store.add("mileage", v); UI.toast("Mileage logged", "success"); m.close(); openDetail(w); } });
          break;
        case "expense":
          UI.openForm("expense", null, { presets: { ...presets, businessPurpose: `Job expense — ${w.woNumber || ""}`.trim() },
            onSave: v => { Store.add("expense", v); UI.toast("Expense added", "success"); m.close(); openDetail(w); } });
          break;
        case "receipt":
          UI.openForm("receipt", null, { presets: { workOrderId: w.id },
            onSave: v => { Store.add("receipt", v); UI.toast("Receipt saved", "success"); m.close(); openDetail(w); } });
          break;
        case "invoice": createInvoiceFrom(w, m); break;
        case "submitted":
          Store.update("workOrder", w.id, { status: "Submitted", reportSubmittedDate: w.reportSubmittedDate || U.todayISO() });
          UI.toast("Marked submitted — remember to invoice", "success"); m.close(); App.rerender(); break;
        case "paid":
          Store.update("workOrder", w.id, { status: "Paid", paymentDate: w.paymentDate || U.todayISO() });
          UI.toast("Marked paid", "success"); m.close(); App.rerender(); break;
        case "duplicate": m.close(); duplicate(w); break;
        case "export": exportSummary(w); break;
      }
    });
  }

  return { openEditor, openDetail, duplicate, createInvoiceFrom, warnings, jobFinancials, feeText, linked, changeStatus, openStatusSheet, expectedFee, isPendingInvoice, billingState, calcRouteMileageReimb, mileageBillRate };
})();

Views.workorders = {
  title: "Work Orders",
  render(el) {
    el.innerHTML = UI.pageHeader("Work Orders",
      "Forensic engineering assignments — from work order to paid.",
      `<button class="btn" id="wo-import">📄 Import FCGA PDF</button>
       <button class="btn btn-primary" id="wo-add">＋ New Work Order</button>`) +
      `<div id="wo-list"></div>` + UI.disclaimerHtml();

    el.querySelector("#wo-add").addEventListener("click", () => WO.openEditor(null));
    el.querySelector("#wo-import").addEventListener("click", () => ImportWO.openImportModal());
    // tap a status badge → bottom sheet with all stages
    el.querySelector("#wo-list").addEventListener("click", e => {
      const t = e.target.closest("[data-wo-status]");
      if (!t) return;
      const w = Store.get("workOrder", t.getAttribute("data-wo-status"));
      if (w) WO.openStatusSheet(w);
    });

    UI.listView(el.querySelector("#wo-list"), {
      data: () => Store.all("workOrder"),
      searchText: w => [w.woNumber, w.projectNumber, Store.clientName(w.clientId), w.claimNumber, w.insuredName, w.lossLocation, w.jobType, w.insuranceCarrier].join(" "),
      filters: [
        { id: "status", label: "Status", options: SCHEMA.workOrderStatuses.map(s => s.value), apply: (w, v) => w.status === v },
        { id: "client", label: "Client", options: () => Store.all("client").map(c => ({ value: c.id, label: c.name })), apply: (w, v) => w.clientId === v },
        { id: "jobType", label: "Job Type", options: SCHEMA.jobTypes, apply: (w, v) => w.jobType === v },
        { id: "flag", label: "Alert", options: [
            { value: "unbilled", label: "Submitted, not invoiced" },
            { value: "overdue", label: "Report overdue" },
            { value: "nomiles", label: "Missing mileage" },
          ],
          apply: (w, v) => {
            const warns = WO.warnings(w);
            if (v === "unbilled") return w.status === "Submitted";
            if (v === "overdue") return warns.some(x => x.text.includes("overdue by"));
            if (v === "nomiles") return warns.some(x => x.text.includes("mileage"));
            return true;
          } },
      ],
      columns: [
        { label: "WO #", value: w => w.woNumber || "—", sortVal: w => w.woNumber || "" },
        { label: "Status", html: w => `<span class="status-tap" data-lv-stop data-wo-status="${w.id}" title="Tap to change status">${UI.statusBadge(SCHEMA.workOrderStatuses, w.status)}<span class="status-caret">▾</span></span>`, sortVal: w => SCHEMA.workOrderStatuses.findIndex(s => s.value === w.status) },
        { label: "Billing", html: w => { const b = WO.billingState(w); return UI.badge(b.label, b.color); }, sortVal: w => WO.billingState(w).rank },
        { label: "Client", value: w => Store.clientName(w.clientId) || "—" },
        { label: "Claim #", value: w => w.claimNumber || "—" },
        { label: "Type", html: w => w.jobType ? UI.badge(w.jobType, "slate") : "—", sortVal: w => w.jobType || "" },
        { label: "Assigned", value: w => U.fmtDate(w.dateAssigned), sortVal: w => w.dateAssigned || "" },
        { label: "Report due", html: w => {
            if (!w.reportDueDate) return "—";
            const dd = U.daysFromToday(w.reportDueDate);
            const open = SCHEMA.woOpenStatuses.includes(w.status);
            const cls = open && dd < 0 ? "var(--red)" : open && dd <= 5 ? "var(--amber)" : "inherit";
            return `<span style="color:${cls};font-weight:${open && dd <= 5 ? 700 : 400}">${U.fmtDate(w.reportDueDate)}</span>`;
          }, sortVal: w => w.reportDueDate || "" },
        { label: "Fee", value: w => WO.feeText(w), sortVal: w => Number(w.flatFee) || Number(w.hourlyRate) || 0, num: true },
        { label: "⚠", html: w => WO.warnings(w).map(x => `<span title="${U.escapeHtml(x.text)}">${x.color === "red" ? "🔴" : "🟡"}</span>`).join("") || "", sortVal: w => WO.warnings(w).length },
      ],
      defaultSort: { col: 5, dir: -1 },
      rowClass: w => WO.warnings(w).length ? "row-warn" : "",
      onRow: w => WO.openDetail(w),
      card: w => {
        const warns = WO.warnings(w);
        return `<div class="record-card">
          <div class="record-card-top">
            <div class="record-card-title">${U.escapeHtml(w.woNumber || "WO")} · ${U.escapeHtml(w.jobType || "")}</div>
            <span class="status-tap" data-lv-stop data-wo-status="${w.id}" title="Tap to change status">${UI.statusBadge(SCHEMA.workOrderStatuses, w.status)}<span class="status-caret">▾</span></span>
          </div>
          <div class="record-card-sub">${U.escapeHtml(Store.clientName(w.clientId))} · ${U.escapeHtml(U.truncate(w.insuredName || w.lossLocation || "", 36))}</div>
          <div class="record-card-meta">
            ${w.reportDueDate ? UI.badge(`Due ${U.fmtDateShort(w.reportDueDate)}`, SCHEMA.woOpenStatuses.includes(w.status) && U.daysFromToday(w.reportDueDate) < 0 ? "red" : "slate") : ""}
            ${UI.badge(WO.feeText(w), "blue")}
            ${(() => { const b = WO.billingState(w); return b.rank ? UI.badge(b.label, b.color) : ""; })()}
            ${warns.map(x => UI.badge(x.text, x.color)).join("")}
          </div>
        </div>`;
      },
      empty: { icon: "📋", title: "No work orders yet", sub: "Add your first assignment, or load demo data from Settings to explore.", actionLabel: "＋ New Work Order", actionId: "wo-empty-add", onAction: () => WO.openEditor(null) },
    });
  },
};
