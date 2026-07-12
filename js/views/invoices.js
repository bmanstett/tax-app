/* =========================================================
   views/invoices.js — invoice tracker: aging, payments,
   printable preview, reconciliation to income.
   ========================================================= */
"use strict";

window.Views = window.Views || {};

const Invoices = (() => {

  /** Cascade invoice status to the linked work order:
      Sent → WO "Invoiced" · Paid → WO "Closed" (dates stamped). */
  function syncWorkOrder(inv) {
    if (!inv || !inv.workOrderId) return;
    const w = Store.get("workOrder", inv.workOrderId);
    if (!w) return;
    if (inv.status === "Sent" && [...SCHEMA.woOpenStatuses, "Submitted"].includes(w.status)) {
      Store.update("workOrder", w.id, { status: "Invoiced", invoiceDate: w.invoiceDate || inv.invoiceDate || U.todayISO() });
      UI.toast(`${w.woNumber || "Work order"} → Invoiced (auto)`, "success");
    } else if (inv.status === "Paid" && !["Closed", "Cancelled"].includes(w.status)) {
      Store.update("workOrder", w.id, { status: "Closed", paymentDate: w.paymentDate || inv.paymentDate || U.todayISO() });
      UI.toast(`${w.woNumber || "Work order"} → Closed (auto)`, "success");
    }
  }

  function openEditor(rec, presets) {
    UI.openForm("invoice", rec, {
      presets,
      onSave: vals => {
        // auto-derive Partial/Paid status from amounts if user left status stale
        const tot = Store.invoiceTotal(vals);
        const paid = Number(vals.amountPaid) || 0;
        if (paid > 0.005 && paid < tot - 0.005 && ["Draft", "Sent", "Paid"].includes(vals.status)) vals.status = "Partial";
        if (tot > 0 && paid >= tot - 0.005 && vals.status !== "Written Off") vals.status = "Paid";
        const saved = rec ? Store.update("invoice", rec.id, vals) : Store.add("invoice", vals);
        if (saved) syncWorkOrder(saved);
        // reconcile: if just marked paid, offer to log income (incl. any bonus)
        if (saved && saved.status === "Paid" && paid > 0) {
          const already = Store.state.income.some(i => i.invoiceId === saved.id && i.category !== BONUS_CATEGORY);
          if (!already) offerIncome(saved);
          else offerBonusIncome(saved); // bonus added after the payment was already logged
        } else if (saved) {
          offerBonusIncome(saved);
        }
        UI.toast(rec ? "Invoice updated" : "Invoice added", "success");
        App.rerender();
      },
      deleteFn: r => { Store.remove("invoice", r.id); UI.toast("Invoice deleted"); App.rerender(); },
    });
  }

  const BONUS_CATEGORY = "Bonus / Incentive Income";
  const bonusIncomeExists = inv => Store.state.income.some(i => i.invoiceId === inv.id && i.category === BONUS_CATEGORY);

  async function offerIncome(inv) {
    const bonus = Number(inv.bonusAmount) || 0;
    const ok = await UI.confirm("Log income for this payment?",
      `Invoice <strong>${U.escapeHtml(inv.invoiceNumber)}</strong> is paid (${U.money(inv.amountPaid)})${bonus ? ` plus a <strong>${U.money(bonus)} bonus</strong>` : ""}. Record matching income entr${bonus ? "ies" : "y"} so your books reconcile?`,
      { confirmLabel: "Log income" });
    if (ok) {
      Store.add("income", {
        date: inv.paymentDate || U.todayISO(), clientId: inv.clientId, amount: Number(inv.amountPaid) || Store.invoiceTotal(inv),
        paymentMethod: inv.paymentMethod || "", invoiceId: inv.id, workOrderId: inv.workOrderId || "",
        category: "Service Income (Invoiced)", is1099: true, notes: `Payment of ${inv.invoiceNumber}`,
      });
      if (bonus > 0 && !bonusIncomeExists(inv)) {
        Store.add("income", {
          date: inv.paymentDate || U.todayISO(), clientId: inv.clientId, amount: bonus,
          paymentMethod: inv.paymentMethod || "", invoiceId: inv.id, workOrderId: inv.workOrderId || "",
          category: BONUS_CATEGORY, is1099: true, notes: `Bonus on ${inv.invoiceNumber}`,
        });
      }
      UI.toast(bonus ? "Income + bonus entries created" : "Income entry created", "success");
      App.rerender();
    }
  }

  /** Bonus recorded on the invoice but not yet in income (e.g. added while editing later). */
  async function offerBonusIncome(inv) {
    const bonus = Number(inv.bonusAmount) || 0;
    if (bonus <= 0 || bonusIncomeExists(inv)) return;
    const ok = await UI.confirm("Log the bonus as income?",
      `Invoice <strong>${U.escapeHtml(inv.invoiceNumber)}</strong> has a <strong>${U.money(bonus)}</strong> bonus recorded. Add a matching “${BONUS_CATEGORY}” entry so it counts in YTD income and job profit?`,
      { confirmLabel: "Log bonus income" });
    if (ok) {
      Store.add("income", {
        date: inv.paymentDate || U.todayISO(), clientId: inv.clientId, amount: bonus,
        paymentMethod: inv.paymentMethod || "", invoiceId: inv.id, workOrderId: inv.workOrderId || "",
        category: BONUS_CATEGORY, is1099: true, notes: `Bonus on ${inv.invoiceNumber}`,
      });
      UI.toast("Bonus income logged", "success");
      App.rerender();
    }
  }

  /** Derived, no-manual-work verification of an invoice against logged income. */
  function verifiedBadge(inv) {
    const linked = Store.state.income.filter(r => r.invoiceId === inv.id);
    const nonBonus = U.sum(linked.filter(r => r.category !== BONUS_CATEGORY), r => r.amount);
    const bonus = Number(inv.bonusAmount) || 0;
    const bonusLogged = linked.some(r => r.category === BONUS_CATEGORY);
    if (inv.status === "Paid") {
      if (nonBonus >= Store.invoiceTotal(inv) - 0.005 && (!bonus || bonusLogged)) return UI.badge("✓ Paid · income logged", "green");
      if (bonus && !bonusLogged) return UI.badge("⚠ Bonus not in income", "amber");
      return UI.badge("⚠ Paid — income missing", "amber");
    }
    if (Store.invoiceIsOverdue(inv)) return UI.badge("Overdue", "red");
    if (["Sent", "Partial"].includes(inv.status)) return UI.badge("Awaiting payment", "blue");
    if (inv.status === "Written Off") return UI.badge("Written off", "slate");
    return UI.badge("Draft", "slate");
  }

  function markStatus(inv, status) {
    const patch = { status };
    if (status === "Paid") {
      patch.amountPaid = Store.invoiceTotal(inv);
      patch.paymentDate = inv.paymentDate || U.todayISO();
    }
    const saved = Store.update("invoice", inv.id, patch);
    if (saved) syncWorkOrder(saved);
    if (status === "Paid" && saved && !Store.state.income.some(i => i.invoiceId === inv.id)) offerIncome(saved);
    UI.toast(`Marked ${status.toLowerCase()}`, "success");
    App.rerender();
  }

  function agingBucket(inv) {
    if (!["Sent", "Partial", "Overdue"].includes(inv.status) || Store.invoiceBalance(inv) <= 0.005) return null;
    const late = inv.dueDate ? -U.daysFromToday(inv.dueDate) : 0;
    return late <= 0 ? "Current" : late <= 30 ? "1–30" : late <= 60 ? "31–60" : late <= 90 ? "61–90" : "90+";
  }

  /* ---- printable preview ---- */
  function preview(inv) {
    const s = Store.state.settings;
    const c = Store.get("client", inv.clientId) || {};
    const w = inv.workOrderId ? Store.get("workOrder", inv.workOrderId) : null;
    const svc = inv.feeType === "Hourly" ? (Number(inv.hours) || 0) * (Number(inv.rate) || 0) : Number(inv.flatFee) || 0;
    const rows = [
      [inv.serviceDescription || "Professional engineering services",
        inv.feeType === "Hourly" ? `${U.num(inv.hours, 2)} hrs × ${U.money(inv.rate)}` : "Flat fee", svc],
      Number(inv.mileageReimb) ? ["Mileage reimbursement", "", Number(inv.mileageReimb)] : null,
      Number(inv.expenseReimb) ? ["Expense reimbursement", "", Number(inv.expenseReimb)] : null,
      Number(inv.otherCharges) ? ["Other charges", "", Number(inv.otherCharges)] : null,
    ].filter(Boolean);
    const total = Store.invoiceTotal(inv);
    const bal = Store.invoiceBalance(inv);

    const m = UI.modal({
      title: `🧾 Invoice ${U.escapeHtml(inv.invoiceNumber)}`,
      size: "lg",
      body: `
        <div class="invoice-doc" id="invoice-print">
          <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap">
            <div>
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
                <svg viewBox="0 0 100 90" width="46" height="41" aria-hidden="true"><path d="M40 0 L60 0 L98 90 L76 90 L67.5 68 L32.5 68 L24 90 L2 90 Z" fill="#16324f"/><path d="M50 24 L61.5 56 L38.5 56 Z" fill="#fff"/><path d="M-2 63 L37 50 L41.5 61 L2.5 74 Z" fill="#fff"/></svg>
                <div>
                  <div style="font-weight:800;font-size:17px;letter-spacing:.2em;color:#16324f">ANSTETT</div>
                  <div style="font-size:9px;letter-spacing:.16em;color:#64748b">CONSULTING, LLC</div>
                </div>
              </div>
              <h1>INVOICE</h1>
              <div style="font-size:13px;margin-top:6px;color:#475569">
                <strong style="color:#0f172a">${U.escapeHtml(s.businessName)}</strong><br>
                ${U.escapeHtml(s.businessAddress || "").replace(/\n/g, "<br>")}${s.businessAddress ? "<br>" : ""}
                ${U.escapeHtml(s.businessEmail || "")}${s.businessEmail ? "<br>" : ""}${U.escapeHtml(s.businessPhone || "")}
              </div>
            </div>
            <div style="text-align:right;font-size:13px">
              <div><strong>Invoice #:</strong> ${U.escapeHtml(inv.invoiceNumber)}</div>
              <div><strong>Date:</strong> ${U.fmtDate(inv.invoiceDate)}</div>
              ${inv.dueDate ? `<div><strong>Due:</strong> ${U.fmtDate(inv.dueDate)}</div>` : ""}
              ${w ? `<div><strong>Ref:</strong> ${U.escapeHtml(w.woNumber || "")}${w.claimNumber ? " / Claim " + U.escapeHtml(w.claimNumber) : ""}</div>` : ""}
            </div>
          </div>
          <div style="margin-top:18px;font-size:13px">
            <strong>Bill to:</strong><br>
            ${U.escapeHtml(c.name || "")}<br>
            ${c.contactName ? U.escapeHtml(c.contactName) + "<br>" : ""}
            ${U.escapeHtml(c.billingAddress || "").replace(/\n/g, "<br>")}
          </div>
          <table>
            <thead><tr><th>Description</th><th>Detail</th><th style="text-align:right">Amount</th></tr></thead>
            <tbody>
              ${rows.map(r => `<tr><td>${U.escapeHtml(r[0])}</td><td>${U.escapeHtml(r[1])}</td><td style="text-align:right">${U.money(r[2])}</td></tr>`).join("")}
              <tr class="inv-total-row"><td colspan="2">Total</td><td style="text-align:right">${U.money(total)}</td></tr>
              ${Number(inv.amountPaid) ? `<tr><td colspan="2">Paid${inv.paymentDate ? " " + U.fmtDate(inv.paymentDate) : ""}${inv.paymentMethod ? " · " + U.escapeHtml(inv.paymentMethod) : ""}</td><td style="text-align:right">−${U.money(inv.amountPaid)}</td></tr>
              <tr class="inv-total-row"><td colspan="2">Balance due</td><td style="text-align:right">${U.money(bal)}</td></tr>` : ""}
            </tbody>
          </table>
          ${inv.notes ? `<div style="margin-top:16px;font-size:12.5px;color:#475569"><strong>Notes / remittance:</strong><br>${U.escapeHtml(inv.notes).replace(/\n/g, "<br>")}</div>` : ""}
          <div style="margin-top:22px;font-size:11px;color:#94a3b8">Thank you for your business.</div>
        </div>`,
      footer: `<button class="btn" id="inv-pv-close">Close</button>
               <button class="btn btn-primary" id="inv-pv-print">🖨️ Print / Save PDF</button>`,
    });
    m.footerEl.querySelector("#inv-pv-close").addEventListener("click", () => m.close());
    m.footerEl.querySelector("#inv-pv-print").addEventListener("click", () => window.print());
  }

  function openDetail(inv) {
    inv = Store.get("invoice", inv.id) || inv;
    const total = Store.invoiceTotal(inv);
    const bal = Store.invoiceBalance(inv);
    const incomeLinked = Store.state.income.filter(i => i.invoiceId === inv.id);
    const m = UI.modal({
      title: `🧾 ${U.escapeHtml(inv.invoiceNumber)} ${UI.statusBadge(SCHEMA.invoiceStatuses, Store.invoiceIsOverdue(inv) ? "Overdue" : inv.status)}`,
      body: `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          <button class="btn btn-sm btn-primary" data-act="edit">✏️ Edit</button>
          <button class="btn btn-sm" data-act="preview">🖨️ Preview / Print</button>
          ${inv.status === "Draft" ? `<button class="btn btn-sm" data-act="sent">📤 Mark sent</button>` : ""}
          ${["Sent", "Partial", "Overdue"].includes(inv.status) ? `<button class="btn btn-sm" data-act="paid">✅ Mark paid in full</button>` : ""}
          ${["Sent", "Partial"].includes(inv.status) && Store.invoiceIsOverdue(inv) ? `<button class="btn btn-sm" data-act="overdue">🔴 Mark overdue</button>` : ""}
        </div>
        ${UI.detailGrid([
          ["Client", U.escapeHtml(Store.clientName(inv.clientId))],
          ["Work order", inv.workOrderId ? U.escapeHtml(Store.woLabel(inv.workOrderId)) : "—"],
          ["Invoice date", U.fmtDate(inv.invoiceDate)],
          ["Due date", U.fmtDate(inv.dueDate)],
          ["Billing", inv.feeType === "Hourly" ? `${U.num(inv.hours, 2)} hrs × ${U.money(inv.rate)}` : U.money(inv.flatFee)],
          ["Mileage reimb.", inv.mileageReimb ? U.money(inv.mileageReimb) : "—"],
          ["Expense reimb.", inv.expenseReimb ? U.money(inv.expenseReimb) : "—"],
          ["Total", `<strong>${U.money(total)}</strong>`],
          ["Paid", U.money(inv.amountPaid || 0) + (inv.paymentDate ? ` on ${U.fmtDate(inv.paymentDate)}` : "")],
          inv.bonusAmount ? ["Bonus (not billed)", `<strong style="color:var(--green)">${U.money(inv.bonusAmount)}</strong> ${bonusIncomeExists(inv) ? "· ✓ in income" : "· " + UI.badge("not in income yet", "amber")}`] : null,
          ["Verified", verifiedBadge(inv)],
          ["Balance", `<strong style="color:${bal > 0.005 ? "var(--amber)" : "var(--green)"}">${U.money(bal)}</strong>`],
          ["Payment method", U.escapeHtml(inv.paymentMethod || "")],
          ["Income reconciled", incomeLinked.length ? `✓ ${incomeLinked.length} entr${incomeLinked.length > 1 ? "ies" : "y"} (${U.money(U.sum(incomeLinked, i => i.amount))})` : UI.badge("No income entry linked", "amber")],
          inv.serviceDescription ? ["Description", U.escapeHtml(inv.serviceDescription).replace(/\n/g, "<br>")] : null,
          inv.notes ? ["Notes", U.escapeHtml(inv.notes).replace(/\n/g, "<br>")] : null,
          inv.auditNotes ? ["Audit notes", U.escapeHtml(inv.auditNotes).replace(/\n/g, "<br>")] : null,
        ])}
        <div style="font-size:11.5px;color:var(--text-3);margin-top:12px">Created ${U.fmtDateTime(inv.createdAt)} · Modified ${U.fmtDateTime(inv.updatedAt)}</div>`,
      footer: `<button class="btn" id="inv-close">Close</button>`,
    });
    m.footerEl.querySelector("#inv-close").addEventListener("click", () => m.close());
    m.body.addEventListener("click", e => {
      const act = e.target.closest("[data-act]")?.getAttribute("data-act");
      if (!act) return;
      m.close();
      if (act === "edit") openEditor(inv);
      else if (act === "preview") preview(inv);
      else if (act === "sent") markStatus(inv, "Sent");
      else if (act === "paid") markStatus(inv, "Paid");
      else if (act === "overdue") markStatus(inv, "Overdue");
    });
  }

  return { openEditor, openDetail, preview, markStatus, agingBucket, syncWorkOrder, verifiedBadge, offerBonusIncome };
})();

Views.invoices = {
  title: "Invoices",
  render(el) {
    const S = Store.state;
    const open = S.invoices.filter(i => ["Sent", "Partial", "Overdue"].includes(i.status) && Store.invoiceBalance(i) > 0.005);
    const overdue = open.filter(Store.invoiceIsOverdue);
    const buckets = { "Current": 0, "1–30": 0, "31–60": 0, "61–90": 0, "90+": 0 };
    open.forEach(i => { const b = Invoices.agingBucket(i); if (b) buckets[b] += Store.invoiceBalance(i); });
    const yr = App.viewYear();
    const paidThisYear = S.invoices.filter(i => i.status === "Paid" && U.yearOf(i.paymentDate || i.invoiceDate) === yr);
    const noIncomeLink = S.invoices.filter(i => i.status === "Paid" && !S.income.some(r => r.invoiceId === i.id));

    el.innerHTML = UI.pageHeader("Invoices & Payments", "Billing, aging, and payment reconciliation.",
      `<button class="btn btn-primary" id="inv-add">＋ New Invoice</button>`) + `
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
        ${UI.statCard({ label: "Outstanding", value: U.money(U.sum(open, Store.invoiceBalance)), sub: `${open.length} invoice(s)`, color: "blue" })}
        ${UI.statCard({ label: "Overdue", value: U.money(U.sum(overdue, Store.invoiceBalance)), sub: `${overdue.length} invoice(s)`, color: overdue.length ? "red" : "green" })}
        ${UI.statCard({ label: `Collected ${yr}`, value: U.money(U.sum(paidThisYear, i => (Number(i.amountPaid) || 0) + (Number(i.bonusAmount) || 0))), sub: U.sum(paidThisYear, i => Number(i.bonusAmount) || 0) ? `incl. ${U.money(U.sum(paidThisYear, i => Number(i.bonusAmount) || 0))} bonuses` : "", color: "green" })}
        ${UI.statCard({ label: "Paid w/o income entry", value: String(noIncomeLink.length), sub: noIncomeLink.length ? "reconcile these" : "all reconciled", color: noIncomeLink.length ? "amber" : "green" })}
      </div>
      <div class="card">
        <div class="card-title">⏳ Aging (open balances)</div>
        ${Charts.hbar({ items: Object.entries(buckets).map(([name, value], i) => ({ name: name === "Current" ? "Current (not yet due)" : name + " days late", value, color: ["#16a34a", "#f59e0b", "#f97316", "#ef4444", "#991b1b"][i] })), maxItems: 5 })}
      </div>
      <div id="inv-list"></div>`;

    el.querySelector("#inv-add").addEventListener("click", () =>
      Invoices.openEditor(null, { invoiceNumber: `INV-${yr}-${String(S.invoices.length + 1).padStart(3, "0")}` }));

    UI.listView(el.querySelector("#inv-list"), {
      data: () => S.invoices,
      searchText: i => [i.invoiceNumber, Store.clientName(i.clientId), i.serviceDescription, Store.woLabel(i.workOrderId)].join(" "),
      filters: [
        { id: "status", label: "Status", options: SCHEMA.invoiceStatuses.map(s => s.value), apply: (i, v) => (v === "Overdue" ? Store.invoiceIsOverdue(i) || i.status === "Overdue" : i.status === v) },
        { id: "client", label: "Client", options: () => Store.all("client").map(c => ({ value: c.id, label: c.name })), apply: (i, v) => i.clientId === v },
      ],
      columns: [
        { label: "Invoice #", value: i => i.invoiceNumber },
        { label: "WO # / P #", value: i => Store.woLabel(i.workOrderId) || "—", sortVal: i => Store.woLabel(i.workOrderId) || "" },
        { label: "Status", html: i => UI.statusBadge(SCHEMA.invoiceStatuses, Store.invoiceIsOverdue(i) ? "Overdue" : i.status), sortVal: i => i.status },
        { label: "Client", value: i => Store.clientName(i.clientId) },
        { label: "Date", value: i => U.fmtDate(i.invoiceDate), sortVal: i => i.invoiceDate || "" },
        { label: "Total", html: i => U.money(Store.invoiceTotal(i)) + (Number(i.bonusAmount) ? ` <span style="color:var(--green);font-size:11px">+${U.money(i.bonusAmount)} bonus</span>` : ""), sortVal: i => Store.invoiceTotal(i), num: true },
        { label: "Balance", html: i => { const b = Store.invoiceBalance(i); return b > 0.005 ? `<strong>${U.money(b)}</strong>` : "—"; }, sortVal: i => Store.invoiceBalance(i), num: true },
        { label: "Verified", html: i => Invoices.verifiedBadge(i), sortVal: i => i.status === "Paid" ? 0 : 1 },
      ],
      defaultSort: { col: 3, dir: -1 },
      rowClass: i => Store.invoiceIsOverdue(i) ? "row-warn" : "",
      onRow: i => Invoices.openDetail(i),
      card: i => `<div class="record-card">
        <div class="record-card-top">
          <div class="record-card-title">${U.escapeHtml(i.invoiceNumber)}</div>
          <div class="record-card-amount">${U.money(Store.invoiceTotal(i))}</div>
        </div>
        <div class="record-card-sub">${U.escapeHtml(Store.woLabel(i.workOrderId) || "no WO")} · ${U.escapeHtml(Store.clientName(i.clientId))} · ${U.fmtDate(i.invoiceDate)}</div>
        <div class="record-card-meta">
          ${Invoices.verifiedBadge(i)}
          ${Number(i.bonusAmount) ? UI.badge(`+${U.money(i.bonusAmount)} bonus`, "green") : ""}
          ${Store.invoiceBalance(i) > 0.005 ? UI.badge(`${U.money(Store.invoiceBalance(i))} due`, "amber") : ""}
        </div>
      </div>`,
      empty: { icon: "🧾", title: "No invoices yet", sub: "Create invoices here or straight from a work order.", actionLabel: "＋ New Invoice", actionId: "inv-empty-add", onAction: () => Invoices.openEditor(null) },
    });
    Charts.bindTooltips(el);
  },
};
